// Star-shaped game session shared by the Trystero and BroadcastChannel transports.
// Guests only talk to the host and the host talks to everyone; the transport underneath may be a full mesh
// (voice uses that), but gameplay traffic never travels guest to guest.
//
// A transport provides: localId, send(kind, data, targets) returning a promise, on(kind, cb(data, peerId)),
// onJoin(cb(peerId)), onLeave(cb(peerId)), buffered(peerId), suspend(), resume(), close().
//
// Two identities. A transport id names one connection and changes on every reload. A player id (`localId` here, and
// every id the game ever sees, roster included) is stable per device, so a returning player is recognised and gets
// its slot back. The 'hi' handshake pairs them; nothing above this file touches a transport id except voice.
//
// Host migration. Every peer holds the same full mesh and the same rule: when the host is gone, the lowest player id
// among the still linked, not backgrounded peers takes over and announces it with a higher epoch. Two peers can reach
// different conclusions while links flap, so a claim with a higher epoch, or the same epoch and a lower id, wins.

export const KINDS = ['hi', 'lob', 'snp', 'evt', 'sta', 'sho', 'bye', 'bg', 'png', 'pog', 'cht'];
const CHAT_MAX_BYTES = 96;          // A quick-chat message is a callout index and a position; anything bigger is junk.

const PING_MS = 2000;
const PING_TIMEOUT_MS = 3000;
const LEAVE_GRACE_MS = 5000;        // A dropped connection gets this long to come back before a bot takes the slot.
const BACKGROUND_GRACE_MS = 15000;  // Longer when the peer told us it was backgrounding (app switch, notification).
const SILENCE_MS = 7000;            // No traffic at all for this long counts as a dropped connection.
const ELECT_MS = 1600;              // How long a lost host gets to reappear before someone takes over.
const ELECT_BACKGROUND_MS = 6000;   // A host that said it was backgrounding gets longer, as a guest would.
const CLAIM_WAIT_MS = 2500;         // How long a peer waits for the chosen successor before skipping it.
const JOIN_TIMEOUT_MS = 20000;      // Public Nostr relays can take several seconds to pair two peers.
const MAX_BUFFERED = 24 * 1024;     // Channel backlog beyond which droppable traffic is skipped.
const MAX_INFLIGHT = 2;             // Sends the transport has not finished yet, per peer.
const OWED_RETRY_MS = 150;          // How soon a skipped snapshot or state is offered again (see #sendDroppable).
const RTT_SMOOTHING = 0.25;

// Stable for the device, so a reload or a closed tab can retake its slot. Tabs on one machine share localStorage, so
// the two-tab test transport keeps its identity per tab instead.
export function playerId(store = localStorage) {
  const KEY = 'switchyard-player';
  try {
    let id = store.getItem(KEY);
    if (!id) {
      id = 'P' + [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(36).padStart(2, '0')).join('');
      store.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'P' + Math.random().toString(36).slice(2, 14);
  }
}

export class StarNet {
  constructor(transport, { code, name, isHost, store }) {
    this.transport = transport;
    this.code = code;
    this.name = name;
    this.isHost = isHost;
    this.localId = playerId(store);
    this.epoch = 0;                  // Rises on each host change, so a stale claim cannot win.
    this.hostId = isHost ? this.localId : null;
    this.status = isHost ? 'open' : 'connecting';   // open | connecting | connected | host-lost | closed
    this.rtt = null;                                // Milliseconds to the host; null on the host itself.
    this.dropped = 0;                               // Snapshots and states skipped because a channel was backed up.
    this.owedTimer = 0;                             // Pending re-offer of skipped snapshots and states.

    this.known = new Map();          // player id -> { tid, name, isHost, hidden, heard, rtt, inflight, linked }
    this.pidOf = new Map();          // transport id -> player id
    this.leaveTimers = new Map();    // peerId -> pending, cancellable departure
    this.byeSeen = new Set();
    this.pings = new Map();          // ping id -> { peerId, at, resolve, timer }
    this.nextPing = 1;
    this.electTimer = null;
    this.skipped = new Set();        // Successors that never announced themselves during this election.

    this.cbs = { lobby: null, snapshot: null, events: null, state: null, shot: null, chat: null };
    this.join = [];
    this.leaves = [];
    this.life = { hostLost: null, hostBack: null, hostChanged: null, promoted: null, demoted: null, joinFailed: null, connected: null, background: null };

    for (const kind of KINDS) transport.on(kind, (data, peerId) => this.#receive(kind, data, peerId));
    transport.onJoin(id => this.#transportJoin(id));
    transport.onLeave(id => this.#transportLeave(id));

    this.onVisibility = () => this.#visibility();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.pingTimer = setInterval(() => this.#tick(), PING_MS);
    if (!isHost) {
      this.joinTimer = setTimeout(() => {
        if (this.status === 'connecting') this.life.joinFailed?.();
      }, transport.joinTimeoutMs ?? JOIN_TIMEOUT_MS);
    }
  }

  get peers() {
    return [...this.known.keys()];
  }

  // Guests' names, keyed by id, as introduced over the wire.
  peerName(id) {
    return this.known.get(id)?.name ?? '';
  }

  rttOf(id) {
    return this.known.get(id)?.rtt ?? null;
  }

  // --- Game traffic. Handlers are single-slot so a later Match replaces an earlier one. ---
  sendLobby(o, target) {
    if (this.status === 'closed') return;
    if (this.isHost) this.#send('lob', o, target ? [target] : this.#guests());
    else if (this.#hostLinked()) this.#send('lob', o, [this.hostId]);
  }
  onLobby(cb) { this.cbs.lobby = cb; }

  sendSnapshot(d) { this.#sendDroppable('snp', d, this.#guests()); }
  onSnapshot(cb) { this.cbs.snapshot = cb; }

  sendEvents(e) { this.#send('evt', e, this.#guests()); }
  onEvents(cb) { this.cbs.events = cb; }

  sendState(d) { if (this.#hostLinked()) this.#sendDroppable('sta', d, [this.hostId]); }
  onState(cb) { this.cbs.state = cb; }

  sendShot(s) { if (this.#hostLinked()) this.#send('sho', s, [this.hostId]); }
  onShot(cb) { this.cbs.shot = cb; }

  // Quick chat (js/ui/quickchat.js). Not gameplay, so it skips the star: it goes straight to the teammates named (player
  // ids), over the same mesh voice uses, and any known peer may send one. Survives resetGameHandlers; QuickChat owns it.
  sendChat(d, targets) {
    if (this.status === 'closed') return;
    const to = targets.filter(id => this.known.get(id)?.linked);
    this.#send('cht', d, to);
  }
  onChat(cb) { this.cbs.chat = cb; }

  // { persist: true } keeps a handler across resetGameHandlers(); Match's handlers are per-match.
  onPeerJoin(cb, { persist = false } = {}) { this.join.push({ cb, persist }); }
  onPeerLeave(cb, { persist = false } = {}) { this.leaves.push({ cb, persist }); }

  // Called between matches so a finished Match stops receiving traffic.
  resetGameHandlers() {
    this.cbs.snapshot = this.cbs.events = this.cbs.state = this.cbs.shot = null;
    this.join = this.join.filter(h => h.persist);
    this.leaves = this.leaves.filter(h => h.persist);
  }

  // Session life cycle, for the menu flow and the "host lost" overlay.
  onConnected(cb) { this.life.connected = cb; }       // Guest found the host.
  onJoinFailed(cb) { this.life.joinFailed = cb; }     // Guest never found a host.
  onHostLost(cb) { this.life.hostLost = cb; }         // cb(): the host stopped answering; an election is under way.
  onHostBack(cb) { this.life.hostBack = cb; }         // cb(): the same host came back in time.
  onHostChanged(cb) { this.life.hostChanged = cb; }   // cb(newHostId, name, oldHostId): someone else took over.
  onPromoted(cb) { this.life.promoted = cb; }         // cb(oldHostId): this peer is now the host.
  onDemoted(cb) { this.life.demoted = cb; }           // cb(newHostId): another peer took over while this one was away.
  onPeerBackground(cb) { this.life.background = cb; } // cb(peerId, hidden)

  // Voice talks to the transport directly, so it needs the connection behind a player id and back.
  transportIdOf(playerId) { return this.known.get(playerId)?.tid ?? null; }
  playerIdOf(transportId) { return this.pidOf.get(transportId) ?? null; }

  // Resolves to round-trip milliseconds, or null if there was no answer.
  ping(peerId) {
    return new Promise(resolve => {
      const id = this.nextPing++;
      const timer = setTimeout(() => {
        this.pings.delete(id);
        resolve(null);
      }, PING_TIMEOUT_MS);
      this.pings.set(id, { peerId, at: performance.now(), resolve, timer });
      this.#send('png', id, [peerId]);
    });
  }

  async leave() {
    if (this.status === 'closed') return;
    this.#send('bye', 1, null);
    this.status = 'closed';
    clearInterval(this.pingTimer);
    clearTimeout(this.joinTimer);
    clearTimeout(this.electTimer);
    clearTimeout(this.owedTimer);
    for (const t of this.leaveTimers.values()) clearTimeout(t);
    for (const p of this.pings.values()) { clearTimeout(p.timer); p.resolve(null); }
    this.pings.clear();
    document.removeEventListener('visibilitychange', this.onVisibility);
    // Give the farewell a moment to leave before the channels are torn down.
    await new Promise(r => setTimeout(r, 120));
    this.transport.close();
  }

  // --- Internals ---
  #hostLinked() {
    return !!this.hostId && this.known.get(this.hostId)?.linked === true;
  }

  #guests() {
    const out = [];
    for (const [id, peer] of this.known) if (peer.linked) out.push(id);
    return out;
  }

  // targets are player ids; a player whose connection is gone is simply skipped. null broadcasts.
  #send(kind, data, targets) {
    if (targets && !targets.length) return;
    const tids = targets ? targets.map(id => this.known.get(id)?.tid).filter(Boolean) : null;
    if (tids && !tids.length) return;
    const sent = this.transport.send(kind, data, tids);
    // Peers vanish mid-send during normal churn; that is reported through onLeave.
    sent?.catch?.(() => {});
  }

  // Newest-wins traffic: a late snapshot is worse than a missing one, because the channels are reliable and ordered.
  // A skipped one is still owed, though: the newest a peer missed is offered again shortly, and dropped for good only
  // when a newer one goes out. Otherwise the last snapshot before the host stops sending, which at the end of a match
  // is the one that says 'ended', could be skipped on a busy channel and leave that guest in a match that never ends.
  #sendDroppable(kind, data, targets) {
    let ready = null;
    for (const id of targets) {
      const peer = this.known.get(id);
      if (!peer) continue;
      if (peer.inflight >= MAX_INFLIGHT || this.transport.buffered(peer.tid) > MAX_BUFFERED) {
        this.dropped++;
        (peer.owed ??= new Map()).set(kind, data);
        this.#retryOwed();
        continue;
      }
      peer.owed?.delete(kind);
      (ready ??= []).push(peer.tid);
      peer.inflight++;
    }
    if (!ready) return;
    const done = () => {
      for (const tid of ready) {
        const peer = this.known.get(this.pidOf.get(tid));
        if (peer) peer.inflight--;
      }
    };
    const sent = this.transport.send(kind, data, ready);
    if (sent?.then) sent.then(done, done);
    else done();
  }

  #retryOwed() {
    if (this.owedTimer || this.status === 'closed') return;
    this.owedTimer = setTimeout(() => {
      this.owedTimer = 0;
      if (this.status === 'closed') return;
      for (const [id, peer] of this.known) {
        if (!peer.owed?.size) continue;
        if (!peer.linked) { peer.owed.clear(); continue; }
        for (const [kind, data] of [...peer.owed]) this.#sendDroppable(kind, data, [id]);
      }
    }, OWED_RETRY_MS);
  }

  #hi(extra = {}) {
    return { name: this.name, host: this.isHost, pid: this.localId, epoch: this.epoch, ...extra };
  }

  #transportJoin(tid) {
    const id = this.pidOf.get(tid);
    const peer = id && this.known.get(id);
    if (peer) peer.linked = true;     // Reconnected before its departure was announced.
    // ask: the other side answers even if it thinks it already knows us, in case our record of it was dropped.
    this.transport.send('hi', this.#hi({ ask: true }), [tid])?.catch?.(() => {});
  }

  #transportLeave(tid) {
    const id = this.pidOf.get(tid);
    const peer = id && this.known.get(id);
    if (!peer || peer.tid !== tid || this.status === 'closed') return;   // An old connection closing after a new one arrived.
    peer.linked = false;
    if (this.byeSeen.has(id)) return this.#departed(id);
    if (!this.isHost && id === this.hostId) {
      this.#loseHost();
      return;
    }
    this.#scheduleLeave(id, peer.hidden ? BACKGROUND_GRACE_MS : LEAVE_GRACE_MS);
  }

  #scheduleLeave(id, ms) {
    clearTimeout(this.leaveTimers.get(id));
    this.leaveTimers.set(id, setTimeout(() => this.#departed(id), ms));
  }

  #departed(id) {
    clearTimeout(this.leaveTimers.get(id));
    this.leaveTimers.delete(id);
    this.byeSeen.delete(id);
    if (!this.known.delete(id)) return;
    for (const h of this.leaves) h.cb(id);
  }

  #receive(kind, data, tid) {
    if (this.status === 'closed') return;
    if (kind === 'hi') return this.#hello(data, tid);
    const peerId = this.pidOf.get(tid);
    const peer = peerId && this.known.get(peerId);
    if (!peer) return;                // Everything below needs an introduction first.
    peer.heard = performance.now();
    peer.linked = true;
    // Any traffic means the link is alive, whatever the silence watchdog concluded.
    if (this.leaveTimers.has(peerId)) {
      clearTimeout(this.leaveTimers.get(peerId));
      this.leaveTimers.delete(peerId);
    }
    if (this.status === 'host-lost' && peerId === this.hostId && kind !== 'bye') this.#hostReturned();

    if (kind === 'png') return this.#send('pog', data, [peerId]);
    if (kind === 'pog') return this.#pong(data, peerId);
    if (kind === 'bye') {
      this.byeSeen.add(peerId);
      if (!this.isHost && peerId === this.hostId) this.#loseHost(true);
      else this.#departed(peerId);
      return;
    }
    if (kind === 'bg') {
      peer.hidden = !!data;
      this.life.background?.(peerId, peer.hidden);
      return;
    }

    if (kind === 'cht') {
      if (data && typeof data === 'object' && JSON.stringify(data).length <= CHAT_MAX_BYTES) this.cbs.chat?.(peerId, data);
      return;
    }

    const fromHost = peerId === this.hostId;
    if (this.isHost) {
      if (kind === 'sta') this.cbs.state?.(peerId, data);
      else if (kind === 'sho') this.cbs.shot?.(peerId, data);
      else if (kind === 'lob') this.cbs.lobby?.(data, peerId);
    } else if (fromHost) {
      if (kind === 'snp') this.cbs.snapshot?.(data);
      else if (kind === 'evt') this.cbs.events?.(data);
      else if (kind === 'lob') this.cbs.lobby?.(data, peerId);
    }
  }

  #hello(data, tid) {
    const pid = data?.pid ? String(data.pid) : tid;
    this.pidOf.set(tid, pid);
    const name = String(data?.name ?? '').slice(0, 16);
    const isHostPeer = !!data?.host;
    const existing = this.known.get(pid);
    clearTimeout(this.leaveTimers.get(pid));
    this.leaveTimers.delete(pid);

    if (!existing) {
      this.known.set(pid, { tid, name, isHost: isHostPeer, hidden: false, heard: performance.now(), rtt: null, inflight: 0, linked: true });
    } else {
      existing.tid = tid;
      existing.linked = true;
      existing.isHost = isHostPeer;
      existing.heard = performance.now();
      existing.inflight = 0;
    }

    if (data?.ask) this.#send('hi', this.#hi(), [pid]);
    if (isHostPeer) this.#hostClaim(pid, name, Number(data.epoch) || 0);
    if (!existing) for (const h of this.join) h.cb(pid, name);
  }

  // Someone says they host. Settles who does; called for every peer's every 'hi', so repeats must be harmless.
  #hostClaim(pid, name, epoch) {
    if (pid === this.localId) return;
    if (this.isHost) {
      if (epoch < this.epoch || (epoch === this.epoch && pid > this.localId)) {
        // Their claim loses, and they may not know it; tell them ours.
        this.#send('hi', this.#hi(), [pid]);
        return;
      }
      this.isHost = false;
      this.epoch = epoch;
      this.hostId = pid;
      this.status = 'connected';
      this.life.demoted?.(pid);
      return;
    }
    if (epoch < this.epoch) return;
    const changed = this.hostId !== pid;
    const old = this.hostId;
    this.epoch = epoch;
    this.hostId = pid;
    clearTimeout(this.joinTimer);
    clearTimeout(this.electTimer);
    this.electTimer = null;
    this.skipped.clear();
    if (this.status === 'connecting') {
      this.status = 'connected';
      this.life.connected?.();
    } else if (this.status === 'host-lost') {
      this.status = 'connected';
      if (changed) this.life.hostChanged?.(pid, name, old); else this.life.hostBack?.();
    } else if (changed) {
      this.life.hostChanged?.(pid, name, old);
    }
  }

  #pong(id, peerId) {
    const pending = this.pings.get(id);
    if (!pending || pending.peerId !== peerId) return;
    this.pings.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(performance.now() - pending.at);
  }

  #hostReturned() {
    this.status = 'connected';
    clearTimeout(this.electTimer);
    this.electTimer = null;
    this.skipped.clear();
    this.life.hostBack?.();
  }

  #loseHost(immediately = false) {
    if (this.status === 'closed') return;
    if (this.status !== 'host-lost') {
      this.status = 'host-lost';
      this.life.hostLost?.();
    }
    if (this.electTimer && !immediately) return;   // Silence and a closed connection often both report the same loss.
    clearTimeout(this.electTimer);
    const waited = this.known.get(this.hostId)?.hidden;
    this.electTimer = setTimeout(() => this.#elect(), immediately ? 0 : waited ? ELECT_BACKGROUND_MS : ELECT_MS);
  }

  // Everyone runs this rule and normally lands on the same peer. Hidden peers are poor hosts, so they go last.
  #elect() {
    this.electTimer = null;
    if (this.isHost || this.status === 'closed' || this.status === 'connected') return;
    const rank = id => (this.known.get(id)?.hidden ? 1 : 0);
    const open = [this.localId];
    for (const [id, peer] of this.known) if (peer.linked && id !== this.hostId && !this.skipped.has(id)) open.push(id);
    open.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
    if (open[0] === this.localId) return this.#promote();
    this.electTimer = setTimeout(() => {
      this.skipped.add(open[0]);
      this.#elect();
    }, CLAIM_WAIT_MS);
  }

  #promote() {
    const old = this.hostId;
    this.isHost = true;
    this.epoch++;
    this.hostId = this.localId;
    this.status = 'open';
    this.skipped.clear();
    if (old) {
      clearTimeout(this.leaveTimers.get(old));
      this.leaveTimers.delete(old);
      this.known.delete(old);
    }
    this.#broadcastHi();
    this.life.promoted?.(old);
  }

  #broadcastHi() {
    this.transport.send('hi', this.#hi(), null)?.catch?.(() => {});
  }

  #tick() {
    if (document.hidden) return;
    const now = performance.now();
    const targets = this.isHost ? this.#guests() : (this.hostId && this.status === 'connected' ? [this.hostId] : []);
    for (const id of targets) {
      const peer = this.known.get(id);
      if (!peer) continue;
      if (now - peer.heard > SILENCE_MS) {
        this.#transportLeave(peer.tid);
        continue;
      }
      this.ping(id).then(ms => {
        if (ms === null) return;
        const p = this.known.get(id);
        if (p) p.rtt = p.rtt === null ? ms : p.rtt + (ms - p.rtt) * RTT_SMOOTHING;
        if (id === this.hostId) this.rtt = p?.rtt ?? ms;
      });
    }
  }

  // iOS freezes timers and may kill sockets while the app is in the background. Warn peers on the way out,
  // and on return forgive the silence we caused ourselves.
  #visibility() {
    if (this.status === 'closed') return;
    const hidden = document.hidden;
    this.#send('bg', hidden ? 1 : 0, null);
    if (hidden) {
      this.transport.suspend();
      return;
    }
    this.transport.resume();
    const now = performance.now();
    for (const peer of this.known.values()) peer.heard = now;
    for (const id of this.leaveTimers.keys()) {
      this.#scheduleLeave(id, LEAVE_GRACE_MS);
    }
  }
}
