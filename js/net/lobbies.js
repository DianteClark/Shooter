// Open lobbies without a server. A host who marks a room Public announces it every ANNOUNCE_MS on the same public Nostr
// relays Trystero signals through; Browse games subscribes and lists what it heard in the last STALE_MS.
//
// The wire: ephemeral Nostr events (kinds 20000-29999, which relays pass to live subscribers and never store), tagged
// ['x', topic], signed by Trystero's own throwaway per-session key through its exported createEvent, so this file
// needs no crypto of its own. The kind is derived from the topic exactly as Trystero derives it. Ephemeral events mean
// a room that stops announcing (went private, started a full match, closed the app) simply ages out of every list.
//
// Squad tags: the topic carries a hash of the tag, so a tagged room reaches only phones with the same tag (the relay
// does the filtering) and untagged phones listen on the untagged topic only. The tag itself never goes on the wire.
import { createEvent, defaultRelayUrls, subscribe } from 'trystero';
import { APP_ID } from './net.js';

export const APP_VERSION = '8.3';      // Rooms from another version are listed greyed out: the two builds may not agree.
export const ANNOUNCE_MS = 5000;
export const STALE_MS = 15000;
const RELAY_COUNT = 5;                 // Trystero's own redundancy, so the lobby list rides the relays the game uses.
const OFFLINE_AFTER_MS = 6000;         // No relay open by then: the list says so (and keeps trying behind it).
const RETRY_MIN_MS = 2000, RETRY_MAX_MS = 30000;
const MAX_CONTENT = 600;               // Anything bigger is not ours.

// Trystero picks its relays by a seeded shuffle of its default list (seed: the app id's character sum). Doing the same
// lands the lobby traffic on the relays the phones already reach. ?relay= (the test hook net.js also reads) wins.
function charSum(s, mod = Number.MAX_SAFE_INTEGER) {
  let t = 0;
  for (const c of s) t += c.charCodeAt(0);
  return t % mod;
}

function seededShuffle(list, seed) {
  const out = [...list];
  const rand = () => { const s = Math.sin(seed++) * 1e4; return s - Math.floor(s); };
  for (let i = out.length; i;) {
    const k = Math.floor(rand() * i--);
    [out[i], out[k]] = [out[k], out[i]];
  }
  return out;
}

// Relay urls, normalised and without duplicates.
export function lobbyRelays(search = location.search) {
  const forced = new URLSearchParams(search).get('relay');
  const urls = forced ? forced.split(',') : seededShuffle(defaultRelayUrls, charSum(APP_ID)).slice(0, RELAY_COUNT);
  const seen = new Set();
  for (const raw of urls) {
    const url = String(raw).trim().replace(/\/+$/, '').toLowerCase();
    if (/^wss?:\/\//.test(url)) seen.add(url);
  }
  return [...seen];
}

export function cleanSquad(tag) {
  return String(tag ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

async function topicFor(squad) {
  const tag = cleanSquad(squad);
  if (!tag) return { topic: `${APP_ID}/lobbies/open`, sq: '' };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`switchyard-squad:${tag}`));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { topic: `${APP_ID}/lobbies/${hex.slice(0, 24)}`, sq: hex.slice(0, 8) };
}

// A few WebSockets that reconnect on their own. onOpen(socket) is where a subscriber (re)sends its REQ.
class RelayPool {
  constructor(urls, { onMessage = null, onOpen = null, onState = null } = {}) {
    this.urls = urls;
    this.onMessage = onMessage;
    this.onOpen = onOpen;
    this.onState = onState;
    this.links = new Map();          // url -> { ws, open, retryMs, timer, failed }
    this.closed = false;
    this.state = urls.length ? 'connecting' : 'offline';
    for (const url of urls) this.#connect(url);
    this.offlineTimer = setTimeout(() => this.#setState(this.#openCount() ? 'live' : 'offline'), OFFLINE_AFTER_MS);
  }

  #openCount() {
    let n = 0;
    for (const l of this.links.values()) if (l.open) n++;
    return n;
  }

  #setState(state) {
    if (this.closed || state === this.state) return;
    this.state = state;
    this.onState?.(state);
  }

  #connect(url) {
    if (this.closed) return;
    const link = this.links.get(url) ?? { ws: null, open: false, retryMs: RETRY_MIN_MS, timer: 0, failed: false };
    this.links.set(url, link);
    let ws;
    try { ws = new WebSocket(url); } catch { link.failed = true; this.#retry(url); return; }
    link.ws = ws;
    ws.onopen = () => {
      if (this.closed) { ws.close(); return; }
      link.open = true;
      link.failed = false;
      link.retryMs = RETRY_MIN_MS;
      this.onOpen?.(ws);
      this.#setState('live');
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (Array.isArray(msg)) this.onMessage?.(msg, url);
    };
    ws.onerror = () => {};             // onclose follows and does the work.
    ws.onclose = () => {
      const was = link.open;
      link.open = false;
      link.ws = null;
      if (this.closed) return;
      if (!was) link.failed = true;
      if (!this.#openCount() && [...this.links.values()].every(l => l.failed)) this.#setState('offline');
      this.#retry(url);
    };
  }

  #retry(url) {
    const link = this.links.get(url);
    if (this.closed || !link) return;
    clearTimeout(link.timer);
    link.timer = setTimeout(() => this.#connect(url), link.retryMs);
    link.retryMs = Math.min(link.retryMs * 2, RETRY_MAX_MS);
  }

  // A phone back from the background finds its sockets dead; try again now instead of at the backed-off time.
  wake() {
    for (const [url, link] of this.links) {
      if (link.open || link.ws) continue;
      clearTimeout(link.timer);
      link.retryMs = RETRY_MIN_MS;
      this.#connect(url);
    }
  }

  send(text) {
    let sent = 0;
    for (const link of this.links.values()) {
      if (!link.open) continue;
      try { link.ws.send(text); sent++; } catch { /* closing: onclose reconnects */ }
    }
    return sent;
  }

  close() {
    this.closed = true;
    clearTimeout(this.offlineTimer);
    for (const link of this.links.values()) {
      clearTimeout(link.timer);
      try { link.ws?.close(); } catch { /* already gone */ }
    }
    this.links.clear();
  }
}

// ---- Host side ---------------------------------------------------------------------------------------------------

// getInfo() is asked every ANNOUNCE_MS and returns the announcement, or null to stay quiet this round (a full match).
// The fields are documented at cleanLobby below.
export class LobbyAnnouncer {
  constructor({ squad = '', getInfo, urls = lobbyRelays() }) {
    this.getInfo = getInfo;
    this.since = Date.now();
    this.seq = 0;
    this.spoke = false;
    this.ready = topicFor(squad).then(t => { this.topic = t; });
    this.pool = new RelayPool(urls, { onOpen: () => this.#announce() });
    this.timer = setInterval(() => this.#announce(), ANNOUNCE_MS);
    this.onVisible = () => { if (!document.hidden) { this.pool.wake(); this.#announce(); } };
    document.addEventListener('visibilitychange', this.onVisible);
  }

  // Sends at once rather than at the next beat (a vote opened, a slot came free).
  poke() { this.#announce(); }

  async #publish(content) {
    await this.ready;
    if (this.pool.closed) return;
    if (!content.closed) content.sq = this.topic.sq;
    const event = await createEvent(this.topic.topic, JSON.stringify(content));
    this.pool.send(event);
  }

  #announce() {
    if (this.pool.closed || document.hidden) return;
    let info = null;
    try { info = this.getInfo(); } catch (err) { console.warn('[lobbies] announcement', err); }
    if (!info) {
      // Went quiet: say so once, so lists drop the room now rather than when it goes stale.
      if (this.spoke) this.#publish({ v: APP_VERSION, code: this.code, closed: 1, seq: ++this.seq }).catch(() => {});
      this.spoke = false;
      return;
    }
    this.spoke = true;
    this.code = info.code;
    this.#publish({ ...info, v: APP_VERSION, since: this.since, seq: ++this.seq }).catch(() => {});
  }

  async stop() {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.spoke) {
      this.spoke = false;
      try { await this.#publish({ v: APP_VERSION, code: this.code, closed: 1, seq: ++this.seq }); } catch { /* best effort */ }
      await new Promise(r => setTimeout(r, 150));
    }
    this.pool.close();
  }
}

// ---- Browsing ----------------------------------------------------------------------------------------------------

const PHASES = ['lobby', 'voting', 'match'];
const str = (v, max) => String(v ?? '').slice(0, max);
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v)) || 0));

// What an announcement may hold, and nothing else:
// { code, host (name), pid (host's player id), map, mode (null while unknown), phase: lobby|voting|match, humans,
//   slots, left (seconds of match left), open (open slots), held:[player ids holding a slot], v, since, sq, seq }
export function cleanLobby(c) {
  if (!c || typeof c !== 'object') return null;
  const code = str(c.code, 8).toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) return null;
  if (c.closed) return { code, closed: true, seq: int(c.seq, 0, 1e9) };
  return {
    code,
    host: str(c.host, 16) || 'Host',
    pid: str(c.pid, 24),
    map: c.map ? str(c.map, 24) : null,
    mode: c.mode ? str(c.mode, 16) : null,
    phase: PHASES.includes(c.phase) ? c.phase : 'lobby',
    humans: int(c.humans, 0, 64),
    slots: int(c.slots, 1, 64),
    left: int(c.left, 0, 36000),
    open: int(c.open, 0, 64),
    held: Array.isArray(c.held) ? c.held.slice(0, 32).map(id => str(id, 24)) : [],
    v: str(c.v, 12),
    since: int(c.since, 0, 9e15),
    sq: str(c.sq, 8),
    seq: int(c.seq, 0, 1e9),
  };
}

// lobbies: Map code -> { ...cleanLobby, seen (Date.now of the newest announcement), compatible }.
// onChange() fires on any change, including the state ('connecting' | 'live' | 'offline').
export class LobbyBrowser {
  constructor({ squad = '', selfId = '', onChange = null, urls = lobbyRelays() }) {
    this.selfId = selfId;
    this.onChange = onChange;
    this.lobbies = new Map();
    this.subId = 'sy' + Math.random().toString(36).slice(2, 10);
    this.ready = topicFor(squad).then(t => {
      this.topic = t;
      for (const link of this.pool.links.values()) if (link.open) this.#subscribe(link.ws);
    });
    this.pool = new RelayPool(urls, {
      onOpen: ws => this.#subscribe(ws),
      onMessage: msg => this.#receive(msg),
      onState: () => this.onChange?.(),
    });
    this.prune = setInterval(() => this.#prune(), 1000);
    this.onVisible = () => { if (!document.hidden) this.pool.wake(); };
    document.addEventListener('visibilitychange', this.onVisible);
  }

  get state() { return this.pool.state; }

  // Newest room first; stable between announcements.
  list() {
    return [...this.lobbies.values()].sort((a, b) => b.since - a.since || (a.code < b.code ? -1 : 1));
  }

  #subscribe(ws) {
    if (!this.topic) return;            // ready's then() subscribes every open socket once the topic is known.
    try { ws.send(subscribe(this.subId, this.topic.topic)); } catch { /* closing */ }
  }

  #receive(msg) {
    if (msg[0] !== 'EVENT' || msg[1] !== this.subId || !this.topic) return;
    const ev = msg[2];
    if (!ev || typeof ev.content !== 'string' || ev.content.length > MAX_CONTENT) return;
    if (!Array.isArray(ev.tags) || !ev.tags.some(t => t[0] === 'x' && t[1] === this.topic.topic)) return;
    let lobby;
    try { lobby = cleanLobby(JSON.parse(ev.content)); } catch { return; }
    if (!lobby) return;
    const known = this.lobbies.get(lobby.code);
    if (lobby.closed) {
      if (known && lobby.seq > known.seq) { this.lobbies.delete(lobby.code); this.onChange?.(); }
      return;
    }
    // The same announcement arrives once per relay, and an older one can overtake a newer one on another relay.
    if (known && known.since === lobby.since && lobby.seq <= known.seq) return;
    if (lobby.sq !== this.topic.sq) return;            // A tagged room on the untagged topic, or the reverse.
    if (lobby.pid && lobby.pid === this.selfId) return; // Our own room.
    lobby.seen = Date.now();
    lobby.compatible = lobby.v === APP_VERSION;
    this.lobbies.set(lobby.code, lobby);
    this.onChange?.();
  }

  #prune() {
    const now = Date.now();
    let changed = false;
    for (const [code, l] of this.lobbies) if (now - l.seen > STALE_MS) { this.lobbies.delete(code); changed = true; }
    if (changed) this.onChange?.();
  }

  close() {
    clearInterval(this.prune);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.pool.close();
  }
}
