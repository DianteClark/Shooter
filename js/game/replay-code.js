// Shareable replay codes (docs/ROADMAP.md item 60, docs/REPLAYS.md): a match clip (js/game/replay.js) as a compact text
// code another phone pastes to watch it in the replay viewer. No server: the code is the whole replay.
//
//   const r = await encodeReplay(clip, { from, to, hz });   // { ok, code, bytes, seconds } | { ok: false, error }
//   const r = await decodeReplay(text);                     // { ok, clip } | { ok: false, error }
//   highlightRange(clip)                                    // { from, to }: the seconds around the final kill
//
// Code: "SYR1.<base64url body>.<checksum>". The body is deflate-raw of one binary record:
//   varint header length, header JSON { v, map, mode, mods, hz, dur, me (cast index or -1), team, cast, str, lk, at }
//   five length-prefixed column streams over the keyframes (deflate finds far more in each than in one interleaved):
//     heads: varint F, then per keyframe a varint step gap (in 1/hz), varint players n, and each player's cast index;
//     flags: u8 (bit 0..5 alive sprint slide protect ghost downed; 6: changed, then varint weapon, camo and team; 7 ADS);
//     positions: zigzag x and z in 1/16 m, the error of a straight-line guess from that player's last two (absolute
//       the first time); aims: zigzag turn since last time, 256 steps a circle; health: varint on a change, else delta.
//   varint extras-table length, the table JSON (distinct objective/score values), per keyframe a varint index.
//   varint events length, the events JSON: [[gap in ms, type, ...fields in EV_FIELDS order]] with player ids as cast
//     indices, a shot's pellets down to its first ray.
// A shared replay is smaller than a saved clip: 10 keyframes a second (the clip keeps 15), no velocities, reloads or
// heat (velocity comes back from the positions), only the events the picture and the kill feed use. A 6v6 highlight (the
// 8.5 seconds around the final kill) is about 4,000 characters, the whole 30 seconds about 10,000; Ground War 2.5x that.
// Refused cleanly: anything without the prefix ('format'), another version ('version'), a typo or cut paste
// ('checksum'), a body that will not read ('data'), a map this build lacks ('map'), too long ('size').
import { STRIDE, REC_HZ } from './replay.js';

export const CODE_PREFIX = 'SYR';
export const CODE_VERSION = 1;
export const CODE_MAX = 200000;          // Characters; a full 30 s Ground War clip stays well under.
export const SHARE_HZ = 10;
export const HIGHLIGHT_PRE = 7, HIGHLIGHT_POST = 1.5;
const POS = 16;                          // 1/16 m.
const MAX_CAST = 80, MAX_STR = 200, MAX_F = 30 * SHARE_HZ * 2 + 4, MAX_EV = 6000, MAX_N = 64;

// Clip player layout (js/game/replay.js STRIDE 20).
const CAST = 0, X = 1, Z = 2, AIM = 3, VX = 4, VZ = 5, HP = 6, FLAGS = 7, ADS = 8, WPN = 12, CAMO = 13, TEAM = 14;
const POS_Q = 32, AIM_Q = 10000 / Math.PI, VEL_Q = 100, T_Q = 1000;
const F_LOOK = 63;                       // The six flags a shared replay keeps.

// Events kept, and the fields of each in order. Ids (by, target, id, assist, owner) are cast indices in the code.
const EV_FIELDS = {
  shot: ['by', 'weapon', 'camo', 'ox', 'oz', 'aim', 'rays', 'sup'],
  hit: ['by', 'target', 'dmg', 'x', 'z', 'killed', 'head', 'down'],
  kill: ['by', 'target', 'weapon', 'camo', 'x', 'z', 'head', 'streak', 'equip', 'fin', 'assist', 'dist'],
  explosion: ['x', 'z', 'radius', 'by', 'weapon'],
  bang: ['kind', 'x', 'z', 'r', 'by'],
  spawn: ['id', 'x', 'z', 'aim'],
  throw: ['id', 'kind'],
  swap: ['id'],
  slide: ['id'],
  emote: ['id', 'e'],
};
const EV_TYPES = Object.keys(EV_FIELDS);
const ID_FIELDS = new Set(['by', 'target', 'id', 'assist', 'owner']);
const EXTRA_KEYS = ['points', 'mode', 'scores'];

/* ---------- Bytes ---------- */
class Writer {
  constructor() { this.buf = new Uint8Array(4096); this.n = 0; }
  #room(k) { if (this.n + k > this.buf.length) { const b = new Uint8Array(Math.max(this.buf.length * 2, this.n + k)); b.set(this.buf.subarray(0, this.n)); this.buf = b; } }
  u8(v) { this.#room(1); this.buf[this.n++] = v & 255; }
  vu(v) { v = Math.max(0, Math.floor(v)); this.#room(5); while (v > 127) { this.buf[this.n++] = (v & 127) | 128; v = Math.floor(v / 128); } this.buf[this.n++] = v; }
  vs(v) { v = Math.round(v); this.vu(v < 0 ? -2 * v - 1 : 2 * v); }
  bytes(b) { this.vu(b.length); this.#room(b.length); this.buf.set(b, this.n); this.n += b.length; }
  text(s) { this.bytes(new TextEncoder().encode(s)); }
  done() { return this.buf.subarray(0, this.n); }
}
class Reader {
  constructor(b) { this.b = b; this.i = 0; }
  u8() { if (this.i >= this.b.length) throw new Error('eof'); return this.b[this.i++]; }
  vu() { let v = 0, m = 1; for (let k = 0; k < 5; k++) { const x = this.u8(); v += (x & 127) * m; if (!(x & 128)) return v; m *= 128; } throw new Error('varint'); }
  vs() { const u = this.vu(); return u % 2 ? -(u + 1) / 2 : u / 2; }
  bytes() { const n = this.vu(); if (this.i + n > this.b.length) throw new Error('eof'); const s = this.b.subarray(this.i, this.i + n); this.i += n; return s; }
  text() { return new TextDecoder('utf-8', { fatal: true }).decode(this.bytes()); }
}

function fnv36(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
const b64url = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const canShare = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/* ---------- Ranges ---------- */
// The seconds around the clip's final kill (or its last HIGHLIGHT_PRE + HIGHLIGHT_POST seconds).
export function highlightRange(clip) {
  const dur = clip.dur || 0, at = clip.lastKill?.at;
  const to = Number.isFinite(at) && at >= 0 ? Math.min(dur, at + HIGHLIGHT_POST) : dur;
  return { from: Math.max(0, to - HIGHLIGHT_PRE - HIGHLIGHT_POST), to };
}

const r2 = v => Math.round(v * 100) / 100;
const r1 = v => Math.round((Number(v) || 0) * 10) / 10;     // A tracer's ends: 10 cm is plenty.
const cleanNum = v => (typeof v === 'number' && Number.isFinite(v) ? r2(v) : v);

/* ---------- Encode ---------- */
export async function encodeReplay(clip, { from = 0, to = clip?.dur ?? 0, hz = SHARE_HZ, title = '' } = {}) {
  if (!canShare()) return { ok: false, error: 'unsupported' };
  if (!clip?.frames?.at?.length || !clip.mapId) return { ok: false, error: 'empty' };
  const at = clip.frames.at, nArr = clip.frames.n, data = clip.frames.data, S = clip.stride ?? STRIDE;
  const off = new Uint32Array(at.length);
  for (let i = 1; i < at.length; i++) off[i] = off[i - 1] + nArr[i - 1] * S;
  from = Math.max(0, Math.min(from, clip.dur)); to = Math.max(from, Math.min(to, clip.dur));
  // Keyframes: every one at least 1/hz after the last kept, within [from, to].
  const keep = [];
  let lastT = -Infinity;
  for (let i = 0; i < at.length; i++) {
    if (at[i] < from - 1e-3 || at[i] > to + 1e-3) continue;
    if (at[i] - lastT >= 1 / hz - 0.25 / REC_HZ) { keep.push(i); lastT = at[i]; }
  }
  if (keep.length < 2) return { ok: false, error: 'empty' };
  const t0 = at[keep[0]];
  // Cast and strings: only those used.
  const castMap = new Map(), cast = [], strMap = new Map(), str = [];
  const castOf = ci => { let k = castMap.get(ci); if (k === undefined) { k = cast.length; castMap.set(ci, k); cast.push(ci); } return k; };
  const strOf = si => { const s = clip.strings[si] ?? ''; let k = strMap.get(s); if (k === undefined) { k = str.length; strMap.set(s, k); str.push(s); } return k; };
  const idCast = new Map(clip.cast.map((c, i) => [c.id, i]));
  const w = new Writer();
  // Frames first into their own writer (the header needs the cast they use).
  // Column streams (deflate finds far more repeats in each than in one interleaved stream): heads (gap, count, cast),
  // flags and their changes, positions, aims, health.
  const fw = new Writer(), fwF = new Writer(), fwP = new Writer(), fwA = new Writer(), fwH = new Writer();
  fw.vu(keep.length);
  const lastX = new Map(), lastZ = new Map(), lastVX = new Map(), lastVZ = new Map(), lastA = new Map(), lastHp = new Map(), lastSig = new Map();
  let prevStep = 0;
  for (const i of keep) {
    const step = Math.round((at[i] - t0) * hz);
    fw.vu(Math.max(0, step - prevStep)); prevStep = step;
    const n = Math.min(MAX_N, nArr[i]);
    fw.vu(n);
    for (let k = 0; k < n; k++) {
      const o = off[i] + k * S, c = castOf(data[o + CAST]);
      const x = Math.round(data[o + X] / POS_Q * POS), z = Math.round(data[o + Z] / POS_Q * POS);
      const wpn = strOf(data[o + WPN]), camo = strOf(data[o + CAMO]), team = data[o + TEAM], hp = Math.max(0, data[o + HP]);
      const sig = `${wpn}|${camo}|${team}`;
      const changed = lastSig.get(c) !== sig;
      const flags = (data[o + FLAGS] & F_LOOK) | (changed ? 64 : 0) | (data[o + ADS] > 0.5 * T_Q ? 128 : 0);
      fw.vu(c); fwF.u8(flags);
      // Positions against a straight-line guess from the last two (small numbers for anyone running steadily).
      const px = lastX.get(c), pz = lastZ.get(c), vx = lastVX.get(c) ?? 0, vz = lastVZ.get(c) ?? 0;
      fwP.vs(x - (px === undefined ? 0 : px + vx)); fwP.vs(z - (pz === undefined ? 0 : pz + vz));
      lastVX.set(c, px === undefined ? 0 : x - px); lastVZ.set(c, pz === undefined ? 0 : z - pz);
      lastX.set(c, x); lastZ.set(c, z);
      const aim = data[o + AIM] / AIM_Q;
      const a8 = Math.round(((aim % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * 256) & 255;
      fwA.vs(((a8 - (lastA.get(c) ?? 0) + 384) & 255) - 128);      // The turn since last time, -128..127.
      lastA.set(c, a8);
      if (changed) { fwF.vu(wpn); fwF.vu(camo); fwF.vu(team); fwH.vu(hp); lastSig.set(c, sig); }
      else fwH.vs(hp - (lastHp.get(c) ?? 0));
      lastHp.set(c, hp);
    }
  }
  // Extras: objectives and scores, as a table of distinct values.
  const xt = [], xSeen = new Map(), xIdx = [];
  for (const i of keep) {
    const x = clip.x?.[i] ?? {};
    const v = {};
    for (const key of EXTRA_KEYS) if (x[key] !== undefined && x[key] !== null) v[key] = x[key];
    const s = JSON.stringify(v);
    let j = xSeen.get(s);
    if (j === undefined) { j = xt.length; xt.push(s); xSeen.set(s, j); }
    xIdx.push(j);
  }
  let xJson = `[${xt.join(',')}]`;
  if (xJson.length > 60000) { xJson = '[{}]'; xIdx.fill(0); }      // Something huge (a battle royale's points): left out.
  // Events within the range, ids as cast indices (players never seen in a kept keyframe still get a cast slot).
  const ev = [];
  let lastMs = 0;
  const evAt = clip.evAt;
  for (let i = 0; i < clip.ev.length && ev.length < MAX_EV; i++) {
    const a = evAt[i];
    if (a < at[keep[0]] - 1e-3 || a > at[keep[keep.length - 1]] + 0.05) continue;
    const e = clip.ev[i], fields = EV_FIELDS[e.t];
    if (!fields) continue;
    const ms = Math.round((a - t0) * 1000);
    const row = [Math.max(0, ms - lastMs), EV_TYPES.indexOf(e.t)];
    lastMs = Math.max(lastMs, ms);
    let bad = false;
    for (const f of fields) {
      let v = e[f];
      if (ID_FIELDS.has(f)) {
        if (v === undefined || v === null) v = -1;
        else { const ci = idCast.get(v); if (ci === undefined) { if (f === 'assist') v = -1; else { bad = true; break; } } else v = castOf(ci); }
      } else if (f === 'rays') v = Array.isArray(v) && v.length ? [[r1(v[0].x), r1(v[0].z), v[0].hit ?? null]] : [];
      else if (e.t === 'shot' && (f === 'ox' || f === 'oz')) v = r1(v);
      else if (typeof v === 'boolean') v = v ? 1 : 0;
      else v = cleanNum(v);
      row.push(v === undefined ? null : v);
    }
    if (bad) continue;
    while (row.length > 2 && row[row.length - 1] === null) row.pop();
    ev.push(row);
  }
  const roster = clip.roster ?? [];
  const rosterOf = id => roster.find(r => r.id === id) ?? null;
  const me = idCast.get(clip.localId);
  const lk = clip.lastKill && idCast.has(clip.lastKill.by) && idCast.has(clip.lastKill.target)
    ? [castOf(idCast.get(clip.lastKill.by)), castOf(idCast.get(clip.lastKill.target)), clip.lastKill.at >= 0 ? r2(clip.lastKill.at - t0) : -1, clip.lastKill.weapon ?? null] : null;
  const header = {
    v: CODE_VERSION, map: clip.mapId, mode: clip.mode, mods: clip.mods ?? [], hz, dur: r2(at[keep[keep.length - 1]] - t0),
    me: me !== undefined && castMap.has(me) ? castMap.get(me) : -1, team: clip.myTeam ?? 0, lk, at: Math.round((clip.at ?? Date.now()) / 1000),
    title: String(title || '').slice(0, 60),
    cast: cast.map(ci => {
      const c = clip.cast[ci] ?? { id: '', name: '' }, r = rosterOf(c.id);
      return [String(c.name ?? '').slice(0, 24), r?.team ?? 0, r?.operator ?? null, r?.skin ?? r?.loadout?.skin ?? null, r?.loadout?.tracer ?? null, r?.loadout?.killFx ?? null, r?.isBot ? 1 : 0];
    }),
    str,
  };
  if (cast.length > MAX_CAST || str.length > MAX_STR) return { ok: false, error: 'big' };
  w.text(JSON.stringify(header));
  for (const x of [fw, fwF, fwP, fwA, fwH]) w.bytes(x.done());
  w.text(xJson);
  w.vu(xIdx.length); for (const j of xIdx) w.vu(j);
  w.text(JSON.stringify(ev));
  const raw = w.done();
  const packed = await pipe(raw, new CompressionStream('deflate-raw'));
  const body = b64url(packed);
  const head = `${CODE_PREFIX}${CODE_VERSION}`;
  const code = `${head}.${body}.${fnv36(`${head}.${body}`)}`;
  if (code.length > CODE_MAX) return { ok: false, error: 'big' };
  return { ok: true, code, bytes: packed.length, raw: raw.length, seconds: header.dur };
}

/* ---------- Decode ---------- */
// maps: the map ids this build knows ({ [id]: map } or a Set), so a code from a newer build is refused, not crashed on.
export async function decodeReplay(text, { maps = null } = {}) {
  if (typeof text !== 'string') return { ok: false, error: 'format' };
  const t = text.replace(/\s+/g, '');
  if (t.length > CODE_MAX) return { ok: false, error: 'size' };
  const m = /^SYR(\d+)\.([A-Za-z0-9_-]+)\.([0-9a-z]+)$/.exec(t);
  if (!m) return { ok: false, error: 'format' };
  if (Number(m[1]) !== CODE_VERSION) return { ok: false, error: 'version' };
  if (fnv36(`${CODE_PREFIX}${m[1]}.${m[2]}`) !== m[3]) return { ok: false, error: 'checksum' };
  if (!canShare()) return { ok: false, error: 'unsupported' };
  let clip;
  try {
    const raw = await pipe(unb64url(m[2]), new DecompressionStream('deflate-raw'));
    clip = readBody(raw);
  } catch {
    return { ok: false, error: 'data' };
  }
  if (!clip) return { ok: false, error: 'data' };
  const known = maps instanceof Set ? maps.has(clip.mapId) : maps ? !!maps[clip.mapId] : true;
  if (!known) return { ok: false, error: 'map' };
  return { ok: true, clip };
}

const isStr = v => typeof v === 'string';
const idOf = k => `p${k}`;

function readBody(raw) {
  const rd = new Reader(raw);
  const h = JSON.parse(rd.text());
  if (!h || h.v !== CODE_VERSION || !isStr(h.map) || !Array.isArray(h.cast) || !Array.isArray(h.str)) return null;
  if (h.cast.length > MAX_CAST || h.str.length > MAX_STR || !(h.hz > 0 && h.hz <= 30)) return null;
  const str = h.str.map(s => (isStr(s) ? s : ''));
  const nc = h.cast.length;
  const fr = new Reader(rd.bytes()), frF = new Reader(rd.bytes()), frP = new Reader(rd.bytes()), frA = new Reader(rd.bytes()), frH = new Reader(rd.bytes());
  const F = fr.vu();
  if (F < 2 || F > MAX_F) return null;
  const at = new Float32Array(F), n = new Uint8Array(F);
  const rows = [];
  const lx = new Float64Array(nc), lz = new Float64Array(nc), lvx = new Float64Array(nc), lvz = new Float64Array(nc), la = new Int32Array(nc), seen = new Uint8Array(nc);
  const lhp = new Float64Array(nc), lsig = Array.from({ length: nc }, () => null);
  let step = 0;
  const prev = new Map();          // cast -> [x, z, t] of its last keyframe, for velocities.
  for (let f = 0; f < F; f++) {
    step += fr.vu();
    at[f] = step / h.hz;
    const cnt = fr.vu();
    if (cnt > MAX_N) return null;
    n[f] = cnt;
    for (let k = 0; k < cnt; k++) {
      const c = fr.vu();
      if (c >= nc) return null;
      const flags = frF.u8();
      const nx = lx[c] + lvx[c] + frP.vs(), nz = lz[c] + lvz[c] + frP.vs();
      lvx[c] = seen[c] ? nx - lx[c] : 0; lvz[c] = seen[c] ? nz - lz[c] : 0; seen[c] = 1;
      lx[c] = nx; lz[c] = nz;
      la[c] = (la[c] + frA.vs() + 256) & 255;
      const aim = la[c] / 256 * 2 * Math.PI;
      let wpn, camo, team, hp;
      if (flags & 64) { wpn = frF.vu(); camo = frF.vu(); team = frF.vu(); hp = frH.vu(); lsig[c] = [wpn, camo, team]; }
      else { if (!lsig[c]) return null; [wpn, camo, team] = lsig[c]; hp = lhp[c] + frH.vs(); }
      lhp[c] = hp;
      if (wpn >= str.length || camo >= str.length) return null;
      rows.push([f, c, flags, lx[c] / POS, lz[c] / POS, aim, wpn, camo, team, hp]);
    }
  }
  // Rebuild the clip's Int16 layout (velocities from the positions either side).
  const data = new Int16Array(rows.length * STRIDE);
  const byCastFrame = new Map();
  for (let r = 0; r < rows.length; r++) byCastFrame.set(rows[r][1] * 4096 + rows[r][0], r);
  const i16 = v => (v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v));
  for (let r = 0; r < rows.length; r++) {
    const [f, c, flags, x, z, aim, wpn, camo, team, hp] = rows[r], o = r * STRIDE;
    let vx = 0, vz = 0;
    const nx = byCastFrame.get(c * 4096 + f + 1);
    if (nx !== undefined && f + 1 < F) {
      const dt = at[f + 1] - at[f];
      if (dt > 1e-3) { vx = (rows[nx][3] - x) / dt; vz = (rows[nx][4] - z) / dt; }
      if (Math.hypot(vx, vz) > 14) { vx = 0; vz = 0; }       // A respawn jump, not a run.
    }
    data[o + CAST] = c; data[o + X] = i16(x * POS_Q); data[o + Z] = i16(z * POS_Q);
    data[o + AIM] = i16((aim > Math.PI ? aim - 2 * Math.PI : aim) * AIM_Q);
    data[o + VX] = i16(vx * VEL_Q); data[o + VZ] = i16(vz * VEL_Q);
    data[o + HP] = i16(hp); data[o + FLAGS] = flags & F_LOOK; data[o + ADS] = flags & 128 ? T_Q : 0;
    data[o + WPN] = wpn; data[o + CAMO] = camo; data[o + TEAM] = team;
  }
  prev.clear();
  const xt = JSON.parse(rd.text());
  if (!Array.isArray(xt) || !xt.length) return null;
  const nx = rd.vu();
  if (nx !== F) return null;
  const x = new Array(F);
  for (let f = 0; f < F; f++) {
    const j = rd.vu(), v = xt[j];
    if (!v || typeof v !== 'object') return null;
    x[f] = { projectiles: null, smokes: null, turrets: null, gunships: null, deploys: null, drones: null, tags: null, uav: null, br: null,
      points: v.points ?? null, mode: v.mode ?? null, scores: v.scores ?? null };
  }
  const rawEv = JSON.parse(rd.text());
  if (!Array.isArray(rawEv) || rawEv.length > MAX_EV) return null;
  const ev = [], evAt = [];
  let ms = 0;
  for (const row of rawEv) {
    if (!Array.isArray(row) || row.length < 2) return null;
    ms += Number(row[0]) || 0;
    const type = EV_TYPES[row[1]];
    if (!type) continue;
    const e = { t: type };
    EV_FIELDS[type].forEach((f, i) => {
      let v = row[i + 2];
      if (v === undefined || v === null) return;
      if (ID_FIELDS.has(f)) { if (v >= 0 && v < nc) e[f] = idOf(v); else if (f === 'assist') e[f] = null; return; }
      if (f === 'rays') { e.rays = Array.isArray(v) ? v.slice(0, 1).map(a => ({ x: +a[0] || 0, z: +a[1] || 0, hit: a[2] ?? null, nx: 0, nz: 0 })) : []; return; }
      e[f] = v;
    });
    if (['killed', 'head', 'down', 'sup'].some(f => f in e)) for (const f of ['killed', 'head', 'down']) if (f in e) e[f] = !!e[f];
    ev.push(e); evAt.push(ms / 1000);
  }
  const cast = h.cast.map((c, i) => ({ id: idOf(i), name: isStr(c?.[0]) ? c[0].slice(0, 24) : '', att: null }));
  const roster = h.cast.map((c, i) => ({
    id: idOf(i), name: cast[i].name, team: Number.isInteger(c?.[1]) ? c[1] : 0, operator: isStr(c?.[2]) ? c[2] : null, isBot: !!c?.[6],
    skin: isStr(c?.[3]) ? c[3] : null,
    loadout: { skin: isStr(c?.[3]) ? c[3] : null, tracer: isStr(c?.[4]) ? c[4] : null, killFx: isStr(c?.[5]) ? c[5] : null, operator: isStr(c?.[2]) ? c[2] : null },
  }));
  const lk = Array.isArray(h.lk) && h.lk[0] < nc && h.lk[1] < nc ? { by: idOf(h.lk[0]), target: idOf(h.lk[1]), at: Number(h.lk[2]) >= 0 ? Number(h.lk[2]) : -1, weapon: isStr(h.lk[3]) ? h.lk[3] : null } : null;
  return {
    v: 1, hz: h.hz, stride: STRIDE, at: (Number(h.at) || 0) * 1000, localId: h.me >= 0 && h.me < nc ? idOf(h.me) : null,
    mapId: h.map, mode: isStr(h.mode) ? h.mode : 'tdm', mods: Array.isArray(h.mods) ? h.mods.filter(isStr) : [], myTeam: Number.isInteger(h.team) ? h.team : 0,
    roster, cast, strings: str, dur: at[F - 1], frames: { at, n, data }, x, fins: [],
    evAt: Float32Array.from(evAt), ev, lastKill: lk, quality: null, shared: true, title: isStr(h.title) ? h.title : '',
  };
}

// The words for a refused code, for the paste sheet.
export const CODE_ERRORS = {
  format: 'That is not a replay code. Replay codes start with SYR1.',
  version: 'That replay code was made by a different version of the game.',
  checksum: 'That replay code is incomplete or has a typo. Copy the whole code again.',
  data: 'That replay code could not be read.',
  map: 'That replay is on a map this version does not have yet. Update the game and try again.',
  size: 'That replay code is too long.',
  unsupported: 'This browser cannot open replay codes.',
  empty: 'There is nothing in this replay to share.',
  big: 'This replay is too big to share as a code.',
};
