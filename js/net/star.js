// Star-shaped game session shared by the Trystero and BroadcastChannel transports.
// Guests only talk to the host and the host talks to everyone; the transport underneath may be a full mesh
// (voice uses that), but gameplay traffic never travels guest to guest.
//
// A transport provides: localId, send(kind, data, targets) returning a promise, on(kind, cb(data, peerId)),
// onJoin(cb(peerId)), onLeave(cb(peerId)), buffered(peerId), suspend(), resume(), close().

export const KINDS = ['hi', 'lob', 'snp', 'evt', 'sta', 'sho', 'bye', 'bg', 'png', 'pog'];

const PING_MS = 2000;
const PING_TIMEOUT_MS = 3000;
const LEAVE_GRACE_MS = 5000;        // A dropped connection gets this long to come back before a bot takes the slot.
const BACKGROUND_GRACE_MS = 15000;  // Longer when the peer told us it was backgrounding (app switch, notification).
const SILENCE_MS = 7000;            // No traffic at all for this long counts as a dropped connection.
const HOST_WINDOW_S = 20;           // Guests wait this long for a lost host before giving up.
const JOIN_TIMEOUT_MS = 20000;      // Public Nostr relays can take several seconds to pair two peers.
const MAX_BUFFERED = 24 * 1024;     // Channel backlog beyond which droppable traffic is skipped.
const MAX_INFLIGHT = 2;             // Sends the transport has not finished yet, per peer.
const RTT_SMOOTHING = 0.25;

export class StarNet {
  constructor(transport, { code, name, isHost }) {
    this.transport = transport;
    this.code = code;
    this.name = name;
    this.isHost = isHost;
    this.localId = transport.localId;
    this.hostId = isHost ? this.localId : null;
    this.status = isHost ? 'open' : 'connecting';   // open | connecting | connected | host-lost | closed
    this.rtt = null;                                // Milliseconds to the host; null on the host itself.
    this.dropped = 0;                               // Snapshots and states skipped because a channel was backed up.

    this.known = new Map();          // peerId -> { name, isHost, hidden, heard, rtt, inflight }
    this.leaveTimers = new Map();    // peerId -> pending, cancellable departure
    this.byeSeen = new Set();
    this.pings = new Map();          // ping id -> { peerId, at, resolve, timer }
    this.nextPing = 1;
    this.hostLostTimer = null;
    this.hostLostLeft = 0;

    this.cbs = { lobby: null, snapshot: null, events: null, state: null, shot: null };
    this.join = [];
    this.leaves = [];
    this.life = { hostLost: null, hostTick: null, hostBack: null, hostGone: null, joinFailed: null, connected: null, background: null };

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
  onHostLost(cb) { this.life.hostLost = cb; }         // cb(secondsLeft)
  onHostTick(cb) { this.life.hostTick = cb; }         // cb(secondsLeft), once a second while lost
  onHostBack(cb) { this.life.hostBack = cb; }
  onHostGone(cb) { this.life.hostGone = cb; }         // cb('ended' | 'timeout')
  onPeerBackground(cb) { this.life.background = cb; } // cb(peerId, hidden)

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
    clearInterval(this.hostLostTimer);
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

  #send(kind, data, targets) {
    if (targets && !targets.length) return;
    const sent = this.transport.send(kind, data, targets);
    // Peers vanish mid-send during normal churn; that is reported through onLeave.
    sent?.catch?.(() => {});
  }

  // Newest-wins traffic: a late snapshot is worse than a missing one, because the channels are reliable and ordered.
  #sendDroppable(kind, data, targets) {
    let ready = null;
    for (const id of targets) {
      const peer = this.known.get(id);
      if (!peer) continue;
      if (peer.inflight >= MAX_INFLIGHT || this.transport.buffered(id) > MAX_BUFFERED) {
        this.dropped++;
        continue;
      }
      (ready ??= []).push(id);
      peer.inflight++;
    }
    if (!ready) return;
    const done = () => {
      for (const id of ready) {
        const peer = this.known.get(id);
        if (peer) peer.inflight--;
      }
    };
    const sent = this.transport.send(kind, data, ready);
    if (sent?.then) sent.then(done, done);
    else done();
  }

  #transportJoin(id) {
    const peer = this.known.get(id);
    if (peer) peer.linked = true;     // Reconnected before its departure was announced.
    // ask: the other side answers even if it thinks it already knows us, in case our record of it was dropped.
    this.#send('hi', { name: this.name, host: this.isHost, ask: true }, [id]);
  }

  #transportLeave(id) {
    const peer = this.known.get(id);
    if (!peer || this.status === 'closed') return;
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

  #receive(kind, data, peerId) {
    if (this.status === 'closed') return;
    const peer = this.known.get(peerId);
    if (peer) {
      peer.heard = performance.now();
      peer.linked = true;
      // Any traffic means the link is alive, whatever the silence watchdog concluded.
      if (this.leaveTimers.has(peerId)) {
        clearTimeout(this.leaveTimers.get(peerId));
        this.leaveTimers.delete(peerId);
      }
      if (this.status === 'host-lost' && peerId === this.hostId && kind !== 'bye') this.#hostReturned();
    }

    if (kind === 'hi') return this.#hello(data, peerId);
    if (kind === 'png') return this.#send('pog', data, [peerId]);
    if (kind === 'pog') return this.#pong(data, peerId);
    if (!peer) return;                // Everything below needs an introduction first.

    if (kind === 'bye') {
      this.byeSeen.add(peerId);
      if (!this.isHost && peerId === this.hostId) {
        this.status = 'closed-by-host';
        this.life.hostGone?.('ended');
      } else {
        this.#departed(peerId);
      }
      return;
    }
    if (kind === 'bg') {
      peer.hidden = !!data;
      this.life.background?.(peerId, peer.hidden);
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

  #hello(data, peerId) {
    const name = String(data?.name ?? '').slice(0, 16);
    const isHostPeer = !!data?.host;
    const existing = this.known.get(peerId);
    clearTimeout(this.leaveTimers.get(peerId));
    this.leaveTimers.delete(peerId);

    if (!existing) {
      this.known.set(peerId, { name, isHost: isHostPeer, hidden: false, heard: performance.now(), rtt: null, inflight: 0, linked: true });
    } else {
      existing.heard = performance.now();
      existing.inflight = 0;
    }

    if (data?.ask) this.#send('hi', { name: this.name, host: this.isHost }, [peerId]);

    if (!this.isHost && isHostPeer) {
      this.hostId = peerId;
      clearTimeout(this.joinTimer);
      if (this.status === 'connecting') {
        this.status = 'connected';
        this.life.connected?.();
      } else if (this.status === 'host-lost') {
        this.#hostReturned();
      }
    }
    if (!existing) for (const h of this.join) h.cb(peerId, name);
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
    clearInterval(this.hostLostTimer);
    this.hostLostTimer = null;
    this.life.hostBack?.();
  }

  #loseHost() {
    if (this.status === 'host-lost' || this.status === 'closed') return;
    this.status = 'host-lost';
    this.hostLostLeft = HOST_WINDOW_S;
    this.life.hostLost?.(this.hostLostLeft);
    clearInterval(this.hostLostTimer);
    this.hostLostTimer = setInterval(() => {
      this.hostLostLeft--;
      this.life.hostTick?.(this.hostLostLeft);
      if (this.hostLostLeft > 0) return;
      clearInterval(this.hostLostTimer);
      this.hostLostTimer = null;
      this.life.hostGone?.('timeout');
    }, 1000);
  }

  #tick() {
    if (document.hidden) return;
    const now = performance.now();
    const targets = this.isHost ? this.#guests() : (this.hostId && this.status === 'connected' ? [this.hostId] : []);
    for (const id of targets) {
      const peer = this.known.get(id);
      if (!peer) continue;
      if (now - peer.heard > SILENCE_MS) {
        this.#transportLeave(id);
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
