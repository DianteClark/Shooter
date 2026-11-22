// Match replays (docs/REPLAYS.md): a rolling record of the last 30 seconds of what this phone's renderer was fed, and the
// clip it becomes when the match ends. The player (js/game/replay-player.js) plays a clip; js/ui/clips.js stores one.
//
//   const rec = new ReplayRecorder({ localId });
//   frame():  rec.record(view, events, dt);         // the same view and events the killcam and renderer get
//   #close(): const clip = rec.finish({ mapId, mode, roster, ... });
//
// Recording is a copy and nothing else: every frame the renderer's events go into a ring (references: decoded events are
// never mutated afterwards), and at REC_HZ the players are quantised into one preallocated Int16Array per keyframe.
// The other arrays of the view (grenades, smokes, streaks, objectives) belong to one decoded snapshot and are never
// mutated, so a reference is a snapshot. Memory is bounded: FRAMES keyframes of MAX_REC players and EVENT_SLOTS events.
// Busy modes (battle royale, Graveyard Shift's horde) keep the MAX_REC players nearest this phone's player, always
// including this player and anyone in a kill of the last few seconds.

export const REC_HZ = 15;
export const REC_SECONDS = 30;
const FRAMES = REC_HZ * REC_SECONDS + 8;
const EVENT_SLOTS = 4000;              // Ground War at full tilt fires about 120 rounds a second; the feed matters most.
export const MAX_REC = 40;
const FAR = 90;                        // Over the cap, players further than this from you are skipped first.
const HOT_S = 4;                       // Killers and their victims stay in the record this long after the kill.
const MAX_LIST = 64;                   // Grenades, smokes and the like kept per keyframe.
const TAIL = 1.2;                      // Seconds kept after the match ends (the final kill's aftermath).

// Only what the renderer and the replay's kill feed react to.
export const KEEP_EVENTS = new Set(['gear', 'fried', 'shot', 'hit', 'kill', 'explosion', 'bang', 'swap', 'slide', 'throw', 'heal',
  'overheat', 'turret', 'turret_down', 'turret_shot', 'gunship_shot', 'emote', 'spawn', 'brk']);

// One player in a keyframe: STRIDE Int16 values.
export const STRIDE = 20;
const CAST = 0, X = 1, Z = 2, AIM = 3, VX = 4, VZ = 5, HP = 6, FLAGS = 7, ADS = 8, RLT = 9, RLD = 10, HEAT = 11, WPN = 12,
  CAMO = 13, TEAM = 14, AIR = 15, GLIDE = 16, RESP = 17, ZK = 18, ARMOR = 19;
const POS_Q = 32, AIM_Q = 10000 / Math.PI, VEL_Q = 100, T_Q = 1000, S_Q = 100;
const F_ALIVE = 1, F_SPRINT = 2, F_SLIDE = 4, F_PROTECT = 8, F_GHOST = 16, F_DOWNED = 32, F_HOT = 64, F_ZSHIELD = 128;
const i16 = v => (v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v));

// The extras of a keyframe, by name; a stored clip keeps each as an index into a table of distinct values.
// Append only: a stored clip keeps EXTRAS.length indices a keyframe, and an older clip's shorter row still reads.
export const EXTRAS = ['projectiles', 'smokes', 'turrets', 'gunships', 'deploys', 'drones', 'tags', 'points', 'mode', 'uav', 'br', 'scores', 'brk'];
const capList = a => (Array.isArray(a) && a.length > MAX_LIST ? a.slice(0, MAX_LIST) : a ?? null);

export class ReplayRecorder {
  constructor({ localId, maxPlayers = MAX_REC }) {
    this.localId = localId;
    this.maxP = maxPlayers;
    this.clock = 0;
    this.nextAt = 0;
    this.frames = Array.from({ length: FRAMES }, () => ({ at: -1, n: 0, d: new Int16Array(maxPlayers * STRIDE), x: {}, fins: null }));
    this.head = 0;
    this.count = 0;
    this.evAt = new Float64Array(EVENT_SLOTS);
    this.ev = new Array(EVENT_SLOTS).fill(null);
    this.evHead = 0;
    this.evCount = 0;
    this.castIndex = new Map();        // player id -> index into cast
    this.cast = [];                    // { id, name, att }
    this.strIndex = new Map();
    this.strings = [];
    this.hot = new Map();              // player id -> clock of their last kill (either side)
    this.endAt = -1;
    this.stopped = false;
    this.pick = [];                    // Scratch for the busy-mode selection.
    this.dist = new Float64Array(256);
    this.byDist = (a, b) => this.dist[a] - this.dist[b];
    this.stats = { frames: 0, keyframes: 0, totalMs: 0, maxMs: 0, keyMs: 0 };
  }

  #str(s) {
    if (s === undefined || s === null) return -1;
    let i = this.strIndex.get(s);
    if (i === undefined) { i = this.strings.length; this.strings.push(s); this.strIndex.set(s, i); }
    return i;
  }

  #castOf(p) {
    let i = this.castIndex.get(p.id);
    if (i === undefined) {
      i = this.cast.length;
      this.cast.push({ id: p.id, name: p.name ?? '', att: p.attachments });
      this.castIndex.set(p.id, i);
    } else {
      const c = this.cast[i];
      if (p.name && c.name !== p.name) c.name = p.name;
      if (p.attachments !== c.att) c.att = p.attachments;
    }
    return i;
  }

  record(view, events, dt) {
    const t0 = performance.now();
    this.clock += dt;
    if (this.stopped || !view) return;
    if (view.phase === 'ended') {
      if (this.endAt < 0) this.endAt = this.clock;
      else if (this.clock - this.endAt > TAIL) { this.stopped = true; return; }
    }
    const clock = this.clock;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!KEEP_EVENTS.has(e.t)) continue;
      this.evAt[this.evHead] = clock;
      this.ev[this.evHead] = e;
      this.evHead = (this.evHead + 1) % EVENT_SLOTS;
      if (this.evCount < EVENT_SLOTS) this.evCount++;
      if (e.t === 'kill') { this.hot.set(e.by, clock); this.hot.set(e.target, clock); }
    }
    let key = false;
    if (clock >= this.nextAt) {
      this.nextAt = Math.max(this.nextAt + 1 / REC_HZ, clock + 0.5 / REC_HZ);
      this.#keyframe(view, clock);
      key = true;
    }
    const ms = performance.now() - t0, s = this.stats;
    s.frames++; s.totalMs += ms; if (ms > s.maxMs) s.maxMs = ms;
    if (key) { s.keyframes++; s.keyMs += ms; }
  }

  #keyframe(view, clock) {
    const f = this.frames[this.head];
    this.head = (this.head + 1) % FRAMES;
    if (this.count < FRAMES) this.count++;
    f.at = clock;
    f.fins = null;
    const list = view.players, all = list.length;
    const pick = this.pick;
    pick.length = 0;
    if (all <= this.maxP) {
      for (let i = 0; i < all; i++) pick.push(i);
    } else {
      // Busy: you, the players of recent kills, then the nearest, up to the cap; nobody past FAR unless hot.
      let me = null;
      for (let i = 0; i < all; i++) if (list[i].id === this.localId) { me = list[i]; break; }
      const mx = me ? me.x : 0, mz = me ? me.z : 0;
      if (this.dist.length < all) this.dist = new Float64Array(all * 2);
      for (let i = 0; i < all; i++) {
        const p = list[i];
        const hotAt = this.hot.get(p.id);
        const hot = p.id === this.localId || (hotAt !== undefined && clock - hotAt < HOT_S);
        const d = (p.x - mx) * (p.x - mx) + (p.z - mz) * (p.z - mz);
        if (!hot && d > FAR * FAR) continue;
        this.dist[i] = hot ? -1 : d;
        pick.push(i);
      }
      if (pick.length > this.maxP) { pick.sort(this.byDist); pick.length = this.maxP; }
    }
    const n = pick.length, d = f.d;
    for (let k = 0; k < n; k++) {
      const p = list[pick[k]], o = k * STRIDE;
      d[o + CAST] = this.#castOf(p);
      d[o + X] = i16(p.x * POS_Q); d[o + Z] = i16(p.z * POS_Q);
      d[o + AIM] = i16((p.aim ?? 0) * AIM_Q);
      d[o + VX] = i16((p.vx || 0) * VEL_Q); d[o + VZ] = i16((p.vz || 0) * VEL_Q);
      d[o + HP] = i16(p.hp ?? 0);
      d[o + FLAGS] = (p.alive ? F_ALIVE : 0) | (p.sprinting ? F_SPRINT : 0) | (p.sliding ? F_SLIDE : 0) | (p.spawnProtect ? F_PROTECT : 0)
        | (p.ghost ? F_GHOST : 0) | (p.downed ? F_DOWNED : 0) | (p.overheated ? F_HOT : 0) | (p.zshield ? F_ZSHIELD : 0);
      d[o + ADS] = i16((p.adsT || 0) * T_Q);
      d[o + RLT] = i16((p.reloadT || 0) * T_Q); d[o + RLD] = i16((p.reloadDur || 0) * T_Q);
      d[o + HEAT] = i16((p.heat || 0) * T_Q);
      d[o + WPN] = this.#str(p.weapon); d[o + CAMO] = this.#str(p.camo);
      d[o + TEAM] = p.team | 0;
      d[o + AIR] = p.air | 0; d[o + GLIDE] = i16((p.glideT || 0) * S_Q);
      d[o + RESP] = i16((p.respawnT || 0) * S_Q);
      d[o + ZK] = p.zk | 0; d[o + ARMOR] = i16(p.armor || 0);
      if (p.fin) (f.fins ??= []).push(k, p.fin);
    }
    f.n = n;
    const x = f.x;
    x.projectiles = capList(view.projectiles); x.smokes = capList(view.smokes); x.turrets = view.turrets ?? null;
    x.gunships = view.gunships ?? null; x.deploys = view.deploys ?? null; x.drones = view.drones ?? null;
    x.tags = capList(view.tags); x.points = view.points ?? null; x.mode = view.mode ?? null; x.uav = view.uav ?? null;
    x.scores = view.scores ?? null;
    x.brk = view.brk ?? '';      // Destruction: which pieces are down (a string, so repeats share one table entry).
    // Battle royale: the circle and the transport, not the loot table or the inventory.
    const br = view.br;
    x.br = br ? { circle: br.circle, next: br.next, state: br.state, plane: br.plane } : null;
  }

  #frame(i) { return this.frames[(this.head - this.count + i + FRAMES * 2) % FRAMES]; }

  // The last REC_SECONDS as a clip (see the format in docs/REPLAYS.md), or null with less than a second recorded.
  // meta: { mapId, mode, mods, roster, myTeam, lastKill, title } and anything else to keep with it.
  finish(meta = {}) {
    this.stopped = true;
    if (this.count < REC_HZ) return null;
    const last = this.#frame(this.count - 1).at;
    let first = 0;
    while (first < this.count - 1 && this.#frame(first).at < last - REC_SECONDS) first++;
    const F = this.count - first, t0 = this.#frame(first).at;
    let total = 0;
    for (let i = first; i < this.count; i++) total += this.#frame(i).n;
    const at = new Float32Array(F), n = new Uint8Array(F), data = new Int16Array(total * STRIDE);
    const x = new Array(F), fins = [];
    let off = 0;
    for (let k = 0; k < F; k++) {
      const f = this.#frame(first + k);
      at[k] = f.at - t0; n[k] = f.n;
      data.set(f.d.subarray(0, f.n * STRIDE), off);
      off += f.n * STRIDE;
      x[k] = { ...f.x };
      if (f.fins) for (let j = 0; j < f.fins.length; j += 2) fins.push([k, f.fins[j], f.fins[j + 1]]);
    }
    const evAt = [], ev = [];
    for (let m = 0; m < this.evCount; m++) {
      const i = (this.evHead - this.evCount + m + EVENT_SLOTS * 2) % EVENT_SLOTS;
      const a = this.evAt[i] - t0;
      if (a < 0 || a > at[F - 1] + 0.05) continue;
      evAt.push(a); ev.push(this.ev[i]);
    }
    // The final kill: the last kill in the clip that the match names (or simply the last one).
    let lastKill = null;
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i];
      if (e.t !== 'kill') continue;
      if (meta.lastKill && (e.by !== meta.lastKill.by || e.target !== meta.lastKill.target)) continue;
      lastKill = { by: e.by, target: e.target, at: evAt[i], weapon: e.weapon };
      break;
    }
    if (!lastKill && meta.lastKill) lastKill = { by: meta.lastKill.by, target: meta.lastKill.target, at: -1, weapon: meta.lastKill.weapon };
    return {
      v: 1, hz: REC_HZ, stride: STRIDE,
      at: Date.now(), localId: this.localId,
      mapId: meta.mapId, mode: meta.mode, mods: meta.mods ?? [], myTeam: meta.myTeam ?? 0,
      roster: slimRoster(meta.roster ?? []),
      cast: this.cast.map(c => ({ id: c.id, name: c.name, att: c.att ?? null })),
      strings: this.strings.slice(),
      dur: at[F - 1], frames: { at, n, data }, x, fins,
      evAt: Float32Array.from(evAt), ev,
      lastKill, quality: meta.quality ?? null,
    };
  }
}

// What the character art needs of each roster entry: operator, skin, tracer and kill effect.
export function slimRoster(roster) {
  return roster.map(r => ({
    id: r.id, name: r.name ?? '', team: r.team ?? 0, operator: r.operator ?? r.loadout?.operator ?? null, isBot: !!r.isBot,
    skin: r.skin ?? r.loadout?.skin ?? null,
    loadout: { skin: r.loadout?.skin ?? null, tracer: r.loadout?.tracer ?? null, killFx: r.loadout?.killFx ?? null, operator: r.loadout?.operator ?? null },
  }));
}

/* ---------- Reading a clip ---------- */

// Offsets of each keyframe's players in clip.frames.data (computed once per clip).
export function frameOffsets(clip) {
  if (clip._off) return clip._off;
  const n = clip.frames.n, off = new Uint32Array(n.length);
  let o = 0;
  for (let i = 0; i < n.length; i++) { off[i] = o; o += n[i] * clip.stride; }
  clip._off = off;
  return off;
}

function blankPlayer() {
  return { id: null, name: '', team: 0, x: 0, z: 0, aim: 0, vx: 0, vz: 0, hp: 0, alive: false, weapon: 'ar', camo: 'none',
    attachments: undefined, adsT: 0, reloadT: 0, reloadDur: 0, sprinting: false, sliding: false, spawnProtect: false, heat: 0,
    overheated: false, ghost: false, respawnT: 0, fin: null, downed: false, air: 0, glideT: 0, zk: 0, armor: 0, zshield: false };
}

function readPlayer(to, clip, d, o) {
  const c = clip.cast[d[o + CAST]] ?? { id: -1, name: '' }, s = clip.strings;
  const fl = d[o + FLAGS];
  to.id = c.id; to.name = c.name; to.attachments = c.att ?? undefined;
  to.x = d[o + X] / POS_Q; to.z = d[o + Z] / POS_Q; to.aim = d[o + AIM] / AIM_Q;
  to.vx = d[o + VX] / VEL_Q; to.vz = d[o + VZ] / VEL_Q; to.hp = d[o + HP];
  to.alive = !!(fl & F_ALIVE); to.sprinting = !!(fl & F_SPRINT); to.sliding = !!(fl & F_SLIDE); to.spawnProtect = !!(fl & F_PROTECT);
  to.ghost = !!(fl & F_GHOST); to.downed = !!(fl & F_DOWNED); to.overheated = !!(fl & F_HOT); to.zshield = !!(fl & F_ZSHIELD);
  to.adsT = d[o + ADS] / T_Q; to.reloadT = d[o + RLT] / T_Q; to.reloadDur = d[o + RLD] / T_Q; to.heat = d[o + HEAT] / T_Q;
  to.weapon = s[d[o + WPN]] ?? 'ar'; to.camo = s[d[o + CAMO]] ?? 'none';
  to.team = d[o + TEAM]; to.air = d[o + AIR] || undefined; to.glideT = d[o + GLIDE] / S_Q; to.respawnT = d[o + RESP] / S_Q;
  to.zk = d[o + ZK]; to.armor = d[o + ARMOR];
  to.fin = null;
}

// Rebuilds views from a clip: sample(c) blends the two keyframes around clip time c into one reused view.
export class ClipReader {
  constructor(clip) {
    this.clip = clip;
    this.off = frameOffsets(clip);
    this.pool = [];
    this.tmp = blankPlayer();
    this.view = {
      t: 0, phase: 'live', timeLeft: 0, scores: [0, 0], winner: null, uav: [0, 0], players: [], localId: clip.localId,
      lastKill: null, projectiles: null, smokes: null, turrets: null, gunships: null, deploys: null, drones: null, tags: null,
      points: null, mode: null, br: null,
    };
    this.fins = new Map();             // keyframe -> [[slot, fin]]
    for (const [k, slot, fin] of clip.fins ?? []) {
      if (!this.fins.has(k)) this.fins.set(k, []);
      this.fins.get(k).push([slot, fin]);
    }
  }

  get duration() { return this.clip.dur; }

  // Index of the last keyframe at or before c.
  frameAt(c) {
    const at = this.clip.frames.at;
    let lo = 0, hi = at.length - 1;
    if (c <= at[0]) return 0;
    if (c >= at[hi]) return hi;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (at[mid] <= c) lo = mid; else hi = mid; }
    return lo;
  }

  sample(c) {
    const clip = this.clip, at = clip.frames.at, nArr = clip.frames.n, data = clip.frames.data, S = clip.stride;
    const ia = this.frameAt(c), ib = Math.min(ia + 1, at.length - 1);
    const span = at[ib] - at[ia];
    const k = span > 1e-4 ? Math.max(0, Math.min(1, (c - at[ia]) / span)) : 0;
    const na = nArr[ia], nb = nArr[ib], oa = this.off[ia], ob = this.off[ib];
    const out = this.view, pool = this.pool, B = this.tmp;
    out.players.length = na;
    // Keyframe b's slot for each cast index, for the blend (players can enter or leave the record between frames).
    for (let i = 0; i < na; i++) {
      const to = pool[i] ?? (pool[i] = blankPlayer());
      readPlayer(to, clip, data, oa + i * S);
      const cast = data[oa + i * S];
      let j = i < nb && data[ob + i * S] === cast ? i : -1;
      if (j < 0) for (let q = 0; q < nb; q++) if (data[ob + q * S] === cast) { j = q; break; }
      if (j >= 0 && ib !== ia) {
        readPlayer(B, clip, data, ob + j * S);
        if (k >= 0.5) {
          to.alive = B.alive; to.downed = B.downed; to.weapon = B.weapon; to.camo = B.camo; to.hp = B.hp; to.team = B.team;
          to.sprinting = B.sprinting; to.sliding = B.sliding; to.air = B.air; to.ghost = B.ghost; to.spawnProtect = B.spawnProtect;
        }
        const was = readFlagAlive(data, oa + i * S);
        // A life starting or ending between the two keyframes: from the half way on the flags are b's, and so is the
        // place (a respawn was drawn alive on the spot they died, for half a keyframe).
        if (was !== B.alive && k >= 0.5) { to.x = B.x; to.z = B.z; to.aim = B.aim; }
        else if (was === B.alive) {
          const dx = B.x - to.x, dz = B.z - to.z;
          if (dx * dx + dz * dz < 36) {
            to.x += dx * k; to.z += dz * k;
            let da = (B.aim - to.aim) % (Math.PI * 2);
            if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
            to.aim += da * k;
            to.adsT += (B.adsT - to.adsT) * k; to.reloadT += (B.reloadT - to.reloadT) * k; to.heat += (B.heat - to.heat) * k;
            to.glideT += (B.glideT - to.glideT) * k;
          }
        }
      }
      out.players[i] = to;
    }
    const fa = this.fins.get(ia);
    if (fa) for (const [slot, fin] of fa) if (out.players[slot]) {
      const fb = this.fins.get(ib)?.find(([s2, f2]) => f2.k === fin.k && f2.role === fin.role && data[ob + s2 * S] === data[oa + slot * S]);
      out.players[slot].fin = fb ? { ...fin, t: fin.t + (fb[1].t - fin.t) * k } : fin;
    }
    const x = clip.x[k < 0.5 ? ia : ib];
    out.t = c;
    out.projectiles = x.projectiles; out.smokes = x.smokes; out.turrets = x.turrets; out.gunships = x.gunships;
    out.deploys = x.deploys; out.drones = x.drones; out.tags = x.tags; out.points = x.points; out.mode = x.mode;
    out.uav = x.uav ?? [0, 0]; out.br = x.br; out.scores = x.scores ?? out.scores;
    out.brk = x.brk ?? '';
    return out;
  }

  // Index of the first event after clip time c.
  eventAfter(c) {
    const a = this.clip.evAt;
    let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= c) lo = mid + 1; else hi = mid; }
    return lo;
  }

  // A player's name by id, from the clip's cast.
  name(id) {
    return this.clip.cast.find(c => c.id === id)?.name ?? '';
  }
}

const readFlagAlive = (d, o) => !!(d[o + FLAGS] & F_ALIVE);

/* ---------- Storage form ---------- */

// A clip as stored (js/ui/clips.js): the typed arrays as they are, the keyframe extras as indices into a table of
// distinct values (most keyframes repeat the last one's objectives and scores), events as plain data.
export function packClip(clip) {
  const table = [], seen = new Map();
  const F = clip.frames.at.length, NX = EXTRAS.length;
  const xi = new Uint16Array(F * NX);
  const json = v => (v === null || v === undefined ? 'null' : JSON.stringify(v));
  for (let k = 0; k < F; k++) {
    const x = clip.x[k];
    for (let j = 0; j < NX; j++) {
      const v = x[EXTRAS[j]] ?? null;
      const s = json(v);
      let i = seen.get(s);
      if (i === undefined) { i = table.length; table.push(s); seen.set(s, i); }
      xi[k * NX + j] = i;
    }
  }
  const evJson = JSON.stringify(clip.ev);
  const castJson = JSON.stringify(clip.cast);
  const rec = {
    v: clip.v, hz: clip.hz, stride: clip.stride, at: clip.at, localId: clip.localId, mapId: clip.mapId, mode: clip.mode,
    mods: clip.mods, myTeam: clip.myTeam, roster: clip.roster, strings: clip.strings, dur: clip.dur, lastKill: clip.lastKill, quality: clip.quality ?? null,
    fat: clip.frames.at, fn: clip.frames.n, fdata: clip.frames.data, xi, xt: table, fins: JSON.stringify(clip.fins ?? []),
    evAt: clip.evAt, ev: evJson, cast: castJson,
  };
  rec.bytes = clip.frames.data.byteLength + clip.frames.at.byteLength + clip.frames.n.byteLength + xi.byteLength
    + clip.evAt.byteLength + table.reduce((s, t) => s + t.length, 0) + evJson.length + castJson.length + rec.fins.length;
  return rec;
}

export function unpackClip(rec) {
  const F = rec.fat.length, NX = F ? Math.round(rec.xi.length / F) : EXTRAS.length;     // A clip saved before an extra was appended has fewer.
  const parsed = rec.xt.map(s => JSON.parse(s));
  const x = new Array(F);
  for (let k = 0; k < F; k++) {
    const o = {};
    for (let j = 0; j < NX && j < EXTRAS.length; j++) o[EXTRAS[j]] = parsed[rec.xi[k * NX + j]];
    x[k] = o;
  }
  return {
    v: rec.v, hz: rec.hz, stride: rec.stride, at: rec.at, localId: rec.localId, mapId: rec.mapId, mode: rec.mode, mods: rec.mods ?? [],
    myTeam: rec.myTeam ?? 0, roster: rec.roster ?? [], cast: JSON.parse(rec.cast), strings: rec.strings, dur: rec.dur,
    lastKill: rec.lastKill ?? null, quality: rec.quality ?? null, frames: { at: rec.fat, n: rec.fn, data: rec.fdata }, x, fins: JSON.parse(rec.fins ?? '[]'),
    evAt: rec.evAt, ev: JSON.parse(rec.ev),
  };
}
