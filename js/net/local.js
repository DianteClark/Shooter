// Same session interface over BroadcastChannel, for two-tab testing without WebRTC (?net=local).
import { StarNet } from './star.js';

const HEARTBEAT_MS = 1000;
const PEER_TIMEOUT_MS = 4000;

function shortId() {
  return 'L' + Math.random().toString(36).slice(2, 10);
}

class LocalTransport {
  constructor(code) {
    this.localId = shortId();
    this.joinTimeoutMs = 6000;
    this.channel = new BroadcastChannel(`switchyard-${code}`);
    this.handlers = {};
    this.joinCb = null;
    this.leaveCb = null;
    this.peers = new Map();         // peerId -> last heard (performance.now)
    this.channel.onmessage = e => this.#receive(e.data);
    this.post('@hello');
    this.beat = setInterval(() => this.#heartbeat(), HEARTBEAT_MS);
    this.onPageHide = () => this.post('@leave');
    addEventListener('pagehide', this.onPageHide);
  }

  post(kind, data, to = null) {
    this.channel.postMessage({ kind, data, from: this.localId, to });
  }

  send(kind, data, targets) {
    if (!targets) {
      this.post(kind, data);
      return Promise.resolve();
    }
    for (const to of targets) this.post(kind, data, to);
    return Promise.resolve();
  }

  on(kind, cb) { this.handlers[kind] = cb; }
  onJoin(cb) { this.joinCb = cb; }
  onLeave(cb) { this.leaveCb = cb; }
  buffered() { return 0; }
  suspend() {}
  resume() {}

  close() {
    this.post('@leave');
    clearInterval(this.beat);
    removeEventListener('pagehide', this.onPageHide);
    this.channel.close();
  }

  #touch(id) {
    const fresh = !this.peers.has(id);
    this.peers.set(id, performance.now());
    if (fresh) this.joinCb?.(id);
  }

  #receive(msg) {
    if (msg.from === this.localId || (msg.to && msg.to !== this.localId)) return;
    if (msg.kind === '@leave') {
      if (this.peers.delete(msg.from)) this.leaveCb?.(msg.from);
      return;
    }
    if (msg.kind === '@hello') {
      this.#touch(msg.from);
      this.post('@here', undefined, msg.from);
      return;
    }
    if (msg.kind === '@here') {
      this.#touch(msg.from);
      return;
    }
    if (this.peers.has(msg.from)) this.peers.set(msg.from, performance.now());
    this.handlers[msg.kind]?.(msg.data, msg.from);
  }

  #heartbeat() {
    this.post('@here');
    const now = performance.now();
    for (const [id, heard] of this.peers) {
      if (now - heard <= PEER_TIMEOUT_MS) continue;
      this.peers.delete(id);
      this.leaveCb?.(id);
    }
  }
}

export class LocalNet extends StarNet {
  static host(code, name) {
    return new LocalNet(new LocalTransport(code), { code, name, isHost: true });
  }

  static join(code, name) {
    return new LocalNet(new LocalTransport(code), { code, name, isHost: false });
  }

  get room() {
    return null;
  }

  static makeCode() {
    const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
    return code;
  }
}
