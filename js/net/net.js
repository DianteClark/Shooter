// Trystero transport (Nostr signalling, WebRTC data channels) behind the star session in star.js.
import { joinRoom, selfId, pauseRelayReconnection, resumeRelayReconnection, getRelaySockets } from 'trystero';
import { StarNet, KINDS } from './star.js';
import { TURN_SERVERS } from './turn.js';
import { mungeOpus } from './opus.js';

export const APP_ID = 'switchyard-6v6-1';

// Trystero does not expose its data channels, so this subclass notes them as they appear;
// their bufferedAmount is what tells the session a phone has fallen behind.
const channels = new WeakMap();

// How far the latest join got, for the failure screen. Trystero prepares a pool of offers before it has heard from
// anyone, so a connection existing proves nothing; what proves the other phone answered over the relays is a remote
// description arriving. answered and no link: the networks would not let the phones reach each other. Link up and then
// lost: dropped. No answer: the host was never found (relays, wrong code, or the host's phone not listening).
const diag = { answered: 0, connected: 0, failed: 0, checking: 0 };
export function resetJoinDiagnosis() { diag.answered = diag.connected = diag.failed = diag.checking = 0; }
export function joinDiagnosis() {
  const kind = diag.connected ? 'dropped' : diag.answered ? 'blocked' : 'unseen';
  let relays = '?';
  try {
    const socks = Object.values(getRelaySockets?.() ?? {});
    relays = `${socks.filter(s => s?.readyState === 1).length}/${socks.length}`;
  } catch { /* not exposed */ }
  return { kind, detail: `relays ${relays} · answered ${diag.answered} · checking ${diag.checking} · linked ${diag.connected} · failed ${diag.failed}` };
}

export class TrackedPeerConnection extends RTCPeerConnection {
  constructor(config) {
    super(config);
    this.addEventListener('datachannel', e => channels.set(this, e.channel));
    this.addEventListener('iceconnectionstatechange', () => {
      const s = this.iceConnectionState;
      if (s === 'checking') diag.checking++;
      else if (s === 'connected' || s === 'completed') diag.connected++;
      else if (s === 'failed') diag.failed++;
    });
  }

  createDataChannel(...args) {
    const channel = super.createDataChannel(...args);
    channels.set(this, channel);
    return channel;
  }

  // Trystero relies on the no-argument form, where the browser would choose the SDP itself. Rewriting Opus means making
  // the description here; if the state moved on while it was being made, the browser's own form still gets to run.
  setRemoteDescription(description) {
    if (description?.type) diag.answered++;
    return super.setRemoteDescription(description);
  }

  async setLocalDescription(description) {
    if (description?.type === 'rollback') return super.setLocalDescription(description);
    try {
      const d = description?.sdp ? description : await this.#createDescription();
      return await super.setLocalDescription({ type: d.type, sdp: mungeOpus(d.sdp) });
    } catch (err) {
      if (description) throw err;
      return super.setLocalDescription();
    }
  }

  #createDescription() {
    return this.signalingState === 'have-remote-offer' || this.signalingState === 'have-local-pranswer' ? this.createAnswer() : this.createOffer();
  }
}

class TrysteroTransport {
  constructor(roomCode) {
    this.localId = selfId;
    const params = new URLSearchParams(location.search);
    const relay = params.get('relay');   // Test hook for a local relay; absent in normal play.
    const config = { appId: APP_ID, rtcPolyfill: TrackedPeerConnection };
    if (TURN_SERVERS.length) config.turnConfig = TURN_SERVERS;
    if (relay) config.relayConfig = { urls: relay.split(','), redundancy: 1 };
    this.room = joinRoom(config, `room-${roomCode}`, {
      onJoinError: details => console.warn('[net] join error', details?.error ?? details),
    });
    this.actions = {};
    for (const kind of KINDS) this.actions[kind] = this.room.makeAction(kind);
  }

  send(kind, data, targets) {
    return this.actions[kind].send(data ?? 0, targets ? { target: targets } : {});
  }

  on(kind, cb) {
    this.actions[kind].onMessage = (data, meta) => cb(data, meta.peerId);
  }

  onJoin(cb) { this.room.onPeerJoin = cb; }
  onLeave(cb) { this.room.onPeerLeave = cb; }

  buffered(peerId) {
    const peer = this.room.getPeers()[peerId];
    const channel = peer && channels.get(peer);
    return channel ? channel.bufferedAmount : 0;
  }

  // On iOS relay sockets die while backgrounded; hold reconnection attempts until we are awake again.
  suspend() { pauseRelayReconnection(); }
  resume() { resumeRelayReconnection(); }

  close() {
    this.room.leave();
  }
}

export class Net extends StarNet {
  static host(code, name) {
    return new Net(new TrysteroTransport(code), { code, name, isHost: true });
  }

  static join(code, name) {
    resetJoinDiagnosis();
    return new Net(new TrysteroTransport(code), { code, name, isHost: false });
  }

  // Voice needs the mesh room directly; the local transport has none.
  get room() {
    return this.transport.room;
  }

  // Short and unambiguous when read aloud; no 0/O or 1/I/L.
  static makeCode() {
    const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const values = crypto.getRandomValues(new Uint8Array(4));
    let code = '';
    for (const v of values) code += letters[v % letters.length];
    return code;
  }
}
