// Battle royale (docs/BR.md), the host side and the pieces every phone shares. The Sim owns one of these when the mode's
// rule set is 'br' and calls in at the few places the mode changes ordinary play (the `this.br` checks in sim.js).
//
// Shape of a match:
//   warmup  everyone rides the transport at the start of its flight line (BR.warmup s); the drop map is up.
//   live    the transport flies the line. Tap Jump (bots pick their moment) to leave it; a short steerable glide
//           (BR.glide s) puts you down. Whoever is still aboard near the end is thrown out. Then loot, fight, and
//           stay inside the circle: BR.phases waits and shrinks, damage outside rises each phase. Last squad standing.
// Squads are sides: team FFA_TEAM + squad index (every `team !== myTeam` check already reads "enemy").
//
// Per player, on the Sim's player record: `brAir` 0 on the ground, 1 aboard, 2 gliding; `downed`; and `br` with the
// rest (armor, inventory, guns with rarity and kit, the action in progress, stats). Armor (plates) soaks gunfire and
// blasts before health; the circle ignores it. In squads, lethal damage downs you while a teammate is still up: you
// crawl, bleed out over BR.bleed s, and a teammate standing next to you for BR.reviveTime s brings you back. A squad is
// out once nobody in it is up. In solos lethal damage kills.
//
// Loot is a table of items (guns with rarity and kit, ammo by type, plates, medkits, self-revive kits, lethals and
// tacticals, and closed supply chests) built from the seed, the same on every phone, so the wire only carries changes:
// removals and additions with a sequence number, re-sent for a moment so a dropped snapshot cannot lose one, and sent
// in full to a guest that has not had them (a rejoin). Ammo, plates and consumables are picked up by walking over them
// when there is room; a gun fills an empty hand by itself and is tapped to swap otherwise.
//
// Human guns and ammo live on the human's phone (docs/ARCHITECTURE.md): the host decides a pickup and sends a `brgive`
// event, which the phone applies to its own player state with brArm/brAmmo (match.js), and the host to its copy.
//
// Events: {t:'brjump', id, x, z}, {t:'brland', id}, {t:'brgive', id, slot, w, r, kit, ammo, res}, {t:'bramm', id, slot,
// n}, {t:'brinv', id, guns}, {t:'brpick', id, kind}, {t:'brchest', x, z}, {t:'down', by, target, weapon, x, z},
// {t:'revive', id, by}, {t:'bruse', id, kind, done?}, {t:'brplate', id, broke?}, {t:'brsquad', team, place},
// {t:'brphase', phase, state}, {t:'brping', id, team, x, z}.

import { BR, MODES } from '../shared/modes.js';
import { FFA_TEAM, MAX_HP, WEAPON_CATEGORY, WEAPON_IDS, GOLDEN_ID } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { LETHALS, TACTICALS } from '../shared/catalog.js';
import { applyAttachments, availableFor, kitKey, NO_ATTACHMENTS, packKit, unpackKit, normalizeKit } from '../shared/attachments.js';
import { resolveCircle } from '../shared/geometry.js';
import { botAttachments } from './bots.js';
import { stepPlayer } from './player.js';

const r1 = v => Math.round(v * 10);
const KNIFE = 'knife';
export const BR_KINDS = ['gun', 'ammo', 'plate', 'med', 'kit', 'lethal', 'tactical', 'chest'];
const K = Object.fromEntries(BR_KINDS.map((k, i) => [k, i]));
export const AMMO_TYPES = ['light', 'rifle', 'shell', 'heavy', 'rocket'];
export const AMMO_NAMES = { light: 'Light ammo', rifle: 'Rifle ammo', shell: 'Shells', heavy: 'Heavy ammo', rocket: 'Rockets' };
const AMMO_OF = { SMG: 'light', Pistol: 'light', Assault: 'rifle', LMG: 'rifle', Shotgun: 'shell', Marksman: 'heavy', Sniper: 'heavy', Launcher: 'rocket' };
const AMMO_PACK = { light: 40, rifle: 45, shell: 12, heavy: 14, rocket: 2 };
// The ammo pouch: rounds for guns you are not holding are kept, up to these, and top up a gun of that type when you take
// one (docs/BR.md "Inventory").
export const POUCH_CAP = { light: 120, rifle: 135, shell: 36, heavy: 42, rocket: 4 };
const POUCH_CAPS = AMMO_TYPES.map(t => POUCH_CAP[t]);
export const ammoOf = id => AMMO_OF[WEAPON_CATEGORY[id]] ?? null;
const TACTICAL_IDS = Object.keys(TACTICALS), LETHAL_IDS = Object.keys(LETHALS);
const EQUIP_CAP = 3;
const USE_KINDS = [null, 'plate', 'med', 'self'];

// Guns on the floor, with how often each category turns up.
const CAT_WEIGHT = { Assault: 3, SMG: 3, LMG: 2, Marksman: 2, Shotgun: 2.2, Sniper: 1.4, Pistol: 1.6, Launcher: 0.5 };
const GUN_POOL = WEAPON_IDS.filter(id => id !== GOLDEN_ID && CAT_WEIGHT[WEAPON_CATEGORY[id]]);
const GUN_W = GUN_POOL.map(id => CAT_WEIGHT[WEAPON_CATEGORY[id]]);
// How much a bot wants a gun of each category: two long guns or a close one and a long one, never pistols if it can help it.
const CAT_SCORE = { Assault: 3.2, SMG: 3, LMG: 2.7, Marksman: 2.6, Shotgun: 2.4, Sniper: 2.2, Pistol: 1, Launcher: 0.6, Melee: 0 };
// Rarity rolls by where the loot lies: [common .. legendary] weights for tier 1, 2, 3, and a chest.
const RARITY_ROLL = { 1: [20, 30, 28, 15, 7], 2: [35, 32, 20, 10, 3], 3: [52, 30, 13, 4, 1], chest: [0, 18, 38, 30, 14] };
// Floor item kinds by share.
const FLOOR_ROLL = [['gun', 34], ['ammo', 26], ['plate', 16], ['med', 8], ['lethal', 7], ['tactical', 6], ['kit', 3]];
// Rarity handling: each step up shaves this share off aim time, reload, swap, sprint-to-fire and hip spread.
const RARITY_HANDLING = 0.04;
const KIT_SKILL = [null, 'regular', 'regular', 'veteran', 'elite'];
const KIT_KEEP = [0, 1, 2, 3, 4];
// V11 attachments wave: the gun's own parts on floor loot. An epic gun sometimes carries one of its signature
// attachments, a legendary one more often, and only a legendary can roll its conversion kit. Class parts fill the rest.
const SIG_CHANCE = [0, 0, 0, 0.35, 0.5];
const CONV_CHANCE = [0, 0, 0, 0, 0.2];
const CHANGE_REPEAT = 1.2;       // Seconds a loot change keeps riding along in snapshots.
const CELL = 8;                  // Loot grid cell, metres.
const PLAN_EVERY = 15;           // Ticks between squad plans (0.5 s).
const BACKUP_EVERY = 90;         // Ticks between host-migration backups to each human guest (3 s).
const NOISE_KEEP = 7;            // Seconds a gunfight stays interesting to bots that heard it.
const THIRD_PARTY = 75;          // Metres a geared bot squad will go to join a fight it hears.
// Pacing (docs/BR.md "Pacing"): the share of squads that pick a contested drop on purpose, by squad size; how far apart
// the rest land (metres, a Gaussian falloff); the chance a heard fight is joined, by circle phase (times the squad's
// aggro); and how long a squad keeps to its first place before it moves on.
const HOT_DROP = [0, 0.06, 0.08, 0.1, 0.1];
const DROP_GAP = 70;
const JOIN_FIGHT = [0, 0.15, 0.3, 0.25, 0.2, 0.15, 0.15];   // Late on, squads mostly hold and let fights come.
const LOOT_DWELL = 50;
const GREEDY_HP = 28;              // A greedy squad heads in once someone is below this.
const EDGE_RING = 1.08;            // Edge players hold this far out (a share of the next circle's radius).
const LOOT_SIGHT = [0.55, 0.7, 0.85];   // Sight range kept by a bot busy looting, by circle phase.
// Bots in a human's squad (ROADMAP 25: they used to copy the human's every move). In the glide each heads for its own
// slot FOLLOW_GLIDE m off the human and only moves the slot once the human's has drifted SLOT_SLACK m from it; on the
// ground they loot within LEAD_LOOT m of the human, regroup past LEAD_LEASH m, and between times hold a spot round the
// human (re-picked once the human has moved WITH_REPICK m) watching their own sector, not the human's aim.
const FOLLOW_GLIDE = 7;
const SLOT_SLACK = 8;
const LEAD_LOOT = 22;
const LEAD_LEASH = 34;
const WITH_REPICK = 12;
export const FOLLOW_TUNING = { FOLLOW_GLIDE, SLOT_SLACK, LEAD_LOOT, LEAD_LEASH, WITH_REPICK };

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickW(rng, weights) {
  let sum = 0;
  for (const w of weights) sum += w;
  let r = rng() * sum;
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i;
  return weights.length - 1;
}

// ---- Guns with rarity: the def a player carries, the same on the host and the phone ----

const DEFS = new Map();
// The effective def of a floor gun: its attachments, then the rarity's handling. Memoised and frozen, like
// applyAttachments, so weaponDef stays a field read.
export function brDef(id, kit = NO_ATTACHMENTS, rarity = 0) {
  const base = WEAPONS[id];
  if (!base) return WEAPONS[KNIFE];
  const key = `${id}|${kitKey(kit)}|${rarity}`;
  let d = DEFS.get(key);
  if (d) return d;
  const eff = applyAttachments(base, kit);
  if (rarity > 0 && !base.melee) {
    const m = 1 - RARITY_HANDLING * rarity;
    d = { ...eff, adsTime: eff.adsTime * m, reload: eff.reload * m, swapTime: eff.swapTime * m, sprintToFire: eff.sprintToFire * m, hipSpread: eff.hipSpread * m, rarity };
  } else d = { ...eff, rarity };
  Object.freeze(d);
  DEFS.set(key, d);
  return d;
}

// Puts a gun in a hand (slot 0 or 1) with its ammo. With `ammo` undefined the magazine is full and the reserve one more.
// The other hand keeps what it has. Picking a gun up into a hand you are not holding switches to it if you held a knife.
export function brArm(ps, slot, id, kit = NO_ATTACHMENTS, rarity = 0, ammo, reserve) {
  if (!WEAPONS[id]) id = KNIFE;
  const def = brDef(id, kit, rarity);
  if (slot === 0) ps.primary = id; else ps.secondary = id;
  ps.defs[slot] = def;
  ps.ammo[slot] = Math.max(0, Math.min(def.magazine, ammo ?? def.magazine));
  ps.reserve[slot] = Math.max(0, reserve ?? (def.unlimitedReserve ? 999 : def.magazine));
  const intoHand = ps.slot === slot || (id !== KNIFE && (ps.slot === 0 ? ps.primary : ps.secondary) === KNIFE);
  if (intoHand) {
    ps.slot = slot;
    ps.weapon = id;
    ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0; ps.holsterT = 0;
    ps.shotIndex = 0; ps.bloom = 0; ps.burstLeft = 0; ps.heat = 0; ps.overheated = false;
    ps.swapT = def.swapTime; ps.cooldown = Math.max(ps.cooldown, ps.swapT);
  }
  return ps;
}

// Ammo of a gun's type into its reserve, up to the cap.
export function brAmmoCap(def) { return def.unlimitedReserve ? 999 : Math.max(def.magazine * 4, Math.round((def.reserve ?? def.magazine * 3) * 1.5)); }
export function brAmmo(ps, slot, n) {
  const def = ps.defs[slot];
  if (!def || def.unlimitedReserve) return 0;
  const got = Math.max(0, Math.min(n, brAmmoCap(def) - ps.reserve[slot]));
  ps.reserve[slot] += got;
  return got;
}

// ---- The transport and the glide, the same on the host (bots, and the plane for everyone) and a phone (its own) ----

export function planeAt(plane, f, out = { x: 0, z: 0 }) {
  out.x = plane.fx + (plane.tx - plane.fx) * f;
  out.z = plane.fz + (plane.tz - plane.fz) * f;
  return out;
}

// A gliding player: the stick steers at BR.glideSpeed, nothing collides, and the map edge holds you in.
export function glideStep(ps, mx, mz, dt, map) {
  const len = Math.hypot(mx, mz);
  const k = len > 1 ? 1 / len : 1;
  ps.vx = mx * k * BR.glideSpeed; ps.vz = mz * k * BR.glideSpeed;
  ps.x = Math.max(2, Math.min(map.width - 2, ps.x + ps.vx * dt));
  ps.z = Math.max(2, Math.min(map.height - 2, ps.z + ps.vz * dt));
  if (len > 0.2) ps.aim = Math.atan2(mz, mx);
  ps.sprinting = false; ps.sliding = false;
}

// Touchdown: out of any wall the glide ended over.
export function land(ps, map) {
  ps.vx = 0; ps.vz = 0;
  for (let i = 0; i < 6; i++) resolveCircle(map, ps, 0.45);
}

// The transport's line for heading `a` (radians), with `u` and `lane` uniform draws in [0, 1): 40% of lines cross the
// middle (within 8% of the map's width of the centre), 35% a third (13-20%), 25% near an edge (24-32%), on either side.
// A line that would leave too little land under it (a chord under 70% of the width, or fewer than 40% of the named
// places within GLIDE_REACH of it, at least 4) is pulled in toward the centre until it does not.
const LANE_BANDS = [[0.4, 0, 0.08], [0.35, 0.13, 0.2], [0.25, 0.24, 0.32]];
const GLIDE_REACH = 110;
export function flightLine(W, H, a, u, lane, pois = []) {
  let band = LANE_BANDS[LANE_BANDS.length - 1], acc = 0;
  for (const b of LANE_BANDS) { acc += b[0]; if (lane < acc) { band = b; break; } }
  const side = u < 0.5 ? -1 : 1, v = (u < 0.5 ? u : u - 0.5) * 2;
  let off = side * (band[1] + (band[2] - band[1]) * v) * W;
  const ca = Math.cos(a), sa = Math.sin(a), half = Math.hypot(W, H) / 2 + BR.planeOver;
  const need = Math.min(pois.length, Math.max(4, Math.ceil(pois.length * 0.4)));
  for (let i = 0; i < 12; i++) {
    const cx = W / 2 - sa * off, cz = H / 2 + ca * off;
    // Land under the line: the chord of the map rectangle (slab clip), and the places within glide reach.
    let t0 = -half, t1 = half;
    for (const [p, d, lo, hi] of [[cx, ca, 0, W], [cz, sa, 0, H]]) {
      if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) t1 = t0 - 1; continue; }
      const ta = (lo - p) / d, tb = (hi - p) / d;
      t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
    }
    let near = 0;
    for (const q of pois) if (Math.abs((q.x - cx) * sa - (q.z - cz) * ca) < GLIDE_REACH) near++;
    if ((t1 - t0 >= 0.7 * Math.min(W, H) && near >= need) || Math.abs(off) < 1) break;
    off *= 0.8;
  }
  const cx = W / 2 - sa * off, cz = H / 2 + ca * off;
  return { from: { x: cx - ca * half, z: cz - sa * half }, to: { x: cx + ca * half, z: cz + sa * half }, off: off / W };
}

// A downed player's stick: a crawl, no trigger, no sprint, no slide, no equipment.
export function downedInput(input) {
  input.mx *= BR.crawl; input.mz *= BR.crawl;
  input.fire = false; input.sprint = false; input.slide = false; input.aiming = false;
  input.tactical = false; input.lethal = false; input.swap = false;
  return input;
}

// ---- Rules ----

export class BrRules {
  constructor(sim, seed) {
    this.sim = sim;
    const map = sim.map, def = map.br ?? { pois: [], loot: [], chests: [], drop: null, circleBias: [] };
    this.def = def;
    this.squad = MODES[sim.modeId]?.squad ?? 4;
    this.downs = this.squad > 1;
    this.authority = false;          // Set on the first host step; a guest's copy only mirrors.
    const rng = mulberry32((seed ^ 0x6b7a11) >>> 0);
    this.lootRng = rng;
    // Flight line: the map's own, or a random heading through the middle, a third or near an edge (flightLine).
    const W = map.width, H = map.height;
    let from, to;
    if (def.drop) { from = def.drop.from; to = def.drop.to; }
    else {
      // Two draws from the loot rng as before (the loot table is unchanged); the lane comes from its own rng.
      const a = rng() * Math.PI * 2, u = rng();
      ({ from, to } = flightLine(W, H, a, u, mulberry32((seed ^ 0x2f1a5c) >>> 0)(), def.pois ?? []));
    }
    this.plane = { fx: from.x, fz: from.z, tx: to.x, tz: to.z, len: Math.hypot(to.x - from.x, to.z - from.z), f: 0 };
    this.t = 0;                      // Seconds since the transport set off.
    // Circle: starts around the whole map, shrinks phase by phase toward centres chosen as it goes (host).
    const R0 = Math.hypot(W, H) / 2 + 6;
    this.circle = { x: W / 2, z: H / 2, r: R0 };
    this.from = { ...this.circle };
    this.next = { x: W / 2, z: H / 2, r: BR.phases[0].r * W };
    this.phase = 0;
    this.state = 'wait';             // 'wait' | 'shrink' | 'final'
    this.timer = BR.phases[0].wait;
    this.nextChosen = false;
    // Loot.
    this.items = [];                 // By id; removed ones are null.
    this.grid = new Map();
    this.log = [];                   // [{seq, t, rec}]
    this.seq = 0;
    this.sentTo = new Map();
    this.gone = new Set();           // Guest: ids removed, never to come back from a re-sent add.
    this._buildLoot(rng);
    this.squadsOut = new Map();      // team -> place.
    this.lastOut = null;
    this.noise = [];                 // Recent gunfire: {x, z, t, team}.
    this.plans = new Map();          // Bot squad plans by team.
    this.claims = new Map();         // Item id -> {bot, until}.
    this.stats = null;               // Guest: the latest stats block.
    this.view = { plane: null, circle: null, next: null, phase: 0, state: 'wait', timer: 0, squadsLeft: 0, alive: 0, inv: null, items: this.items, stats: null, pois: def.pois, rules: this };
    sim.phaseT = BR.warmup;
    this._fillView();
  }

  // The view object's shared fields, from this copy's state.
  _fillView() {
    const V = this.view;
    V.plane = { ...this.plane, ...planeAt(this.plane, this.plane.f) };
    V.circle = { ...this.circle }; V.next = { ...this.next }; V.phase = this.phase; V.state = this.state; V.timer = this.timer;
    V.items = this.items; V.t = this.t; V.squad = this.squad;
  }

  // ---- Loot table ----

  _rollGun(rng, tier) {
    const id = GUN_POOL[pickW(rng, GUN_W)];
    const r = pickW(rng, RARITY_ROLL[tier] ?? RARITY_ROLL[3]);
    let kit = NO_ATTACHMENTS;
    if (r > 0) {
      const raw = botAttachments(id, KIT_SKILL[r], Math.floor(rng() * 3) * 2, { own: false });
      const keep = {};
      let n = 0;
      for (const s in raw) if (n++ < KIT_KEEP[r]) keep[s] = raw[s];
      if (r >= 3) {
        const own = availableFor(id).filter(a => a.kind);
        const sigs = own.filter(a => a.kind === 'sig'), conv = own.find(a => a.kind === 'kit');
        const sigRoll = rng(), convRoll = rng(), pick = rng();
        if (sigs.length && sigRoll < SIG_CHANCE[r]) { const a = sigs[Math.floor(pick * sigs.length) % sigs.length]; keep[a.slot] = a.id; }
        if (conv && convRoll < CONV_CHANCE[r]) keep[conv.slot] = conv.id;
      }
      kit = normalizeKit(id, keep);
    }
    return { kind: K.gun, v: WEAPON_IDS.indexOf(id), r, n: 1, kit };
  }

  _rollItem(rng, tier, kindName = null) {
    const kind = kindName ?? FLOOR_ROLL[pickW(rng, FLOOR_ROLL.map(k => k[1]))][0];
    switch (kind) {
      case 'gun': return this._rollGun(rng, tier);
      case 'ammo': { const a = Math.floor(rng() * AMMO_TYPES.length * 0.999); const t = rng() < 0.12 ? 4 : a % 4; return { kind: K.ammo, v: t, r: 0, n: AMMO_PACK[AMMO_TYPES[t]] }; }
      case 'plate': return { kind: K.plate, v: 0, r: 0, n: rng() < 0.3 ? 2 : 1 };
      case 'med': return { kind: K.med, v: 0, r: 0, n: 1 };
      case 'kit': return { kind: K.kit, v: 0, r: 4, n: 1 };
      case 'lethal': { const v = Math.floor(rng() * LETHAL_IDS.length); return { kind: K.lethal, v, r: 0, n: LETHALS[LETHAL_IDS[v]].count }; }
      case 'tactical': { const v = Math.floor(rng() * TACTICAL_IDS.length); return { kind: K.tactical, v, r: 0, n: TACTICALS[TACTICAL_IDS[v]].count }; }
    }
    return { kind: K.med, v: 0, r: 0, n: 1 };
  }

  _buildLoot(rng) {
    for (const s of this.def.loot ?? []) {
      const it = this._rollItem(rng, s.tier);
      this._addItem({ ...it, x: s.x, z: s.z }, false);
      // A gun on the floor comes with some ammo for it, most of the time.
      if (it.kind === K.gun && rng() < 0.6) {
        const type = ammoOf(WEAPON_IDS[it.v]);
        if (type) this._addItem({ kind: K.ammo, v: AMMO_TYPES.indexOf(type), r: 0, n: AMMO_PACK[type], x: s.x + 0.6, z: s.z + 0.3 }, false);
      }
    }
    for (const c of this.def.chests ?? []) this._addItem({ kind: K.chest, v: c.tier, r: 3, n: 1, x: c.x, z: c.z }, false);
  }

  _cellKey(x, z) { return Math.floor(x / CELL) * 4096 + Math.floor(z / CELL); }

  _addItem(it, logged = true, id = this.items.length) {
    it.id = id;
    if (it.kit === undefined) it.kit = NO_ATTACHMENTS;
    this.items[id] = it;
    const k = this._cellKey(it.x, it.z);
    let cell = this.grid.get(k);
    if (!cell) this.grid.set(k, cell = []);
    cell.push(it);
    if (logged) this._log([0, 1, id, it.kind, it.v, it.r, it.n, r1(it.x), r1(it.z), packKit(it.kit)]);
    return it;
  }

  _removeItem(it, logged = true) {
    if (!it || this.items[it.id] !== it) return;
    this.items[it.id] = null;
    const cell = this.grid.get(this._cellKey(it.x, it.z));
    if (cell) { const i = cell.indexOf(it); if (i >= 0) cell.splice(i, 1); }
    if (logged) this._log([0, 0, it.id]);
  }

  _log(rec) {
    rec[0] = ++this.seq;
    this.log.push({ seq: this.seq, t: this.sim.time, rec });
  }

  // Items near (x, z) within r, into out.
  near(x, z, r, out = []) {
    out.length = 0;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cell = this.grid.get(i * 4096 + j);
      if (!cell) continue;
      for (const it of cell) if (Math.hypot(it.x - x, it.z - z) <= r) out.push(it);
    }
    return out;
  }

  // ---- Start: everyone aboard ----

  spawnAll() {
    const sim = this.sim, p0 = planeAt(this.plane, 0);
    const aim = Math.atan2(this.plane.tz - this.plane.fz, this.plane.tx - this.plane.fx);
    for (const p of sim.players) {
      sim._placeAt(p, { x: p0.x, z: p0.z }, aim);
      p.spawnProtect = 0;
      p.brAir = 1;
      p.downed = false;
      p.br = {
        armor: 0, plates: 0, meds: 0, kits: 0, guns: [null, null], useK: null, useT: 0, useDur: 0,
        reviveT: 0, downedBy: null, downWeapon: null, out: false, place: 0, dmg: 0, revives: 0, knocks: 0,
        pouch: [0, 0, 0, 0, 0], stash: null,      // Ammo kept by type; the gun put away while fists are out {slot, ammo, res}.
        glideT: 0, deathT: 0, jumpAt: 0.5, dropX: p0.x, dropZ: p0.z, follow: null, landed: false,
      };
      this._startKit(p);
    }
  }

  // Fists in one hand, a common sidearm with two magazines in the other.
  _startKit(p) {
    const ps = p.ps;
    ps.tacticalLeft = 0; ps.lethalLeft = 0;
    ps.perks = []; ps.pro = [];
    brArm(ps, 0, KNIFE);
    const side = WEAPONS.pistol;
    p.br.guns[1] = { id: 'pistol', r: 0, kit: NO_ATTACHMENTS };
    brArm(ps, 1, 'pistol', NO_ATTACHMENTS, 0, side.magazine, side.magazine * 2);
    ps.slot = 0; ps.weapon = KNIFE;
    p.primary = KNIFE;
    p.kits[0] = NO_ATTACHMENTS; p.kits[1] = NO_ATTACHMENTS;
    p.camo = this._camo(p, KNIFE);
    ps.camo = p.camo;
    if (!p.isBot) this.sim._emit({ t: 'brinv', id: p.id, guns: this._invGuns(p) });
  }

  // A floor gun wears the player's own camo for that gun if they have one, else none.
  _camo(p, id) { return p.isBot ? 'none' : (p.loadout?.camos?.[id] ?? 'none'); }

  _invGuns(p) {
    return [0, 1].map(s => {
      const g = p.br.guns[s];
      return g ? [WEAPON_IDS.indexOf(g.id), g.r, packKit(g.kit), this._ammoIn(p, s), this._resIn(p, s)] : null;
    });
  }

  // A hand's gun is held unless it is put away for fists (stash). Its rounds live in the stash meanwhile.
  _held(p, s) { return !!p.br.guns[s] && p.br.stash?.slot !== s; }
  _ammoIn(p, s) { return p.br.stash?.slot === s ? p.br.stash.ammo : p.ps.ammo[s]; }
  _resIn(p, s) { return p.br.stash?.slot === s ? p.br.stash.res : p.ps.reserve[s]; }

  // Rounds into the pouch for their type, up to its cap. Returns what did not fit.
  _toPouch(p, type, n) {
    const t = AMMO_TYPES.indexOf(type);
    if (t < 0 || n <= 0) return n;
    const k = Math.max(0, Math.min(n, POUCH_CAPS[t] - p.br.pouch[t]));
    p.br.pouch[t] += k;
    return n - k;
  }

  // ---- Commands from a phone ----

  command(p, msg) {
    if (!p.br || !p.alive) return false;
    const sim = this.sim;
    switch (msg.act) {
      case 'jump':
        if (p.brAir !== 1 || sim.phase !== 'live') return false;
        this._jump(p);
        return true;
      case 'take': {
        if (p.brAir || p.downed) return false;
        const it = this.items[msg.item | 0];
        if (!it || it.kind !== K.gun || Math.hypot(it.x - p.ps.x, it.z - p.ps.z) > BR.take + 0.8) return false;
        this._takeGun(p, it, msg.slot);
        return true;
      }
      case 'plate': return this._startUse(p, 'plate');
      case 'med': return this._startUse(p, 'med');
      case 'self': return this._startUse(p, 'self');
      case 'cancel': p.br.useK = null; return true;
      case 'fists': return this._fists(p, msg);
      case 'ping': {
        // A landing spot (or any spot) for the squad, at most every 1.5 s.
        const x = +msg.x, z = +msg.z;
        if (!Number.isFinite(x) || !Number.isFinite(z) || sim.time - (p.br.pingT ?? -9) < 1.5) return false;
        p.br.pingT = sim.time;
        sim._emit({ t: 'brping', id: p.id, team: p.team, x: Math.round(Math.max(0, Math.min(sim.map.width, x)) * 10) / 10, z: Math.round(Math.max(0, Math.min(sim.map.height, z)) * 10) / 10 });
        return true;
      }
    }
    return false;
  }

  // Fists as the third slot: the gun in a hand is put away (its rounds kept) and fists come out; again, and it is back.
  // The phone does it at once and tells the host, with the rounds it put away.
  _fists(p, msg) {
    const b = p.br, ps = p.ps;
    if (p.brAir || p.downed) return false;
    if (msg.on) {
      const slot = msg.slot === 1 ? 1 : 0, g = b.guns[slot];
      if (!g || b.stash) return false;
      const def = brDef(g.id, g.kit, g.r);
      b.stash = { slot, ammo: Math.max(0, Math.min(def.magazine, msg.ammo | 0)), res: Math.max(0, Math.min(brAmmoCap(def), msg.res | 0)) };
      brArm(ps, slot, KNIFE);
      ps.slot = slot; ps.weapon = KNIFE;
    } else {
      const st = b.stash;
      if (!st) return false;
      b.stash = null;
      const g = b.guns[st.slot];
      if (!g) return true;
      brArm(ps, st.slot, g.id, g.kit, g.r, st.ammo, st.res);
      ps.slot = st.slot; ps.weapon = g.id;
      // The pouch tops the gun back up.
      const t = AMMO_TYPES.indexOf(ammoOf(g.id)), def = ps.defs[st.slot];
      const n = t >= 0 && !def.unlimitedReserve ? Math.min(b.pouch[t], brAmmoCap(def) - ps.reserve[st.slot]) : 0;
      if (n > 0) { b.pouch[t] -= n; ps.reserve[st.slot] += n; if (!p.isBot) this.sim._emit({ t: 'bramm', id: p.id, slot: st.slot, n }); }
    }
    this.sim._metaUntil = this.sim.tick + 2;
    return true;
  }

  _startUse(p, kind) {
    const b = p.br;
    if (p.brAir || b.useK === kind) return false;
    if (kind === 'self') { if (!p.downed || b.kits <= 0) return false; b.useDur = BR.selfRevive; }
    else if (p.downed) return false;
    else if (kind === 'plate') { if (b.plates <= 0 || b.armor >= BR.plateSlots * BR.plateHp) return false; b.useDur = BR.plateTime; }
    else if (kind === 'med') { if (b.meds <= 0 || p.hp >= MAX_HP) return false; b.useDur = BR.medTime; }
    b.useK = kind; b.useT = b.useDur;
    this.sim._emit({ t: 'bruse', id: p.id, kind });
    return true;
  }

  _jump(p) {
    p.brAir = 2;
    p.br.glideT = BR.glide;
    this.sim._emit({ t: 'brjump', id: p.id, x: Math.round(p.ps.x * 10) / 10, z: Math.round(p.ps.z * 10) / 10 });
  }

  // ---- One tick ----

  step(dt) {
    const sim = this.sim;
    this.authority = true;
    if (sim.phase !== 'live') return;
    this.t += dt;
    const plane = this.plane;
    plane.f = Math.min(1, this.t * BR.planeSpeed / plane.len);
    const pos = planeAt(plane, plane.f, this._pp || (this._pp = { x: 0, z: 0 }));
    const vx = (plane.tx - plane.fx) / plane.len * BR.planeSpeed, vz = (plane.tz - plane.fz) / plane.len * BR.planeSpeed;
    this._stepCircle(dt);
    const outside = this._dps();
    for (const p of sim.players) {
      if (!p.alive || !p.br) continue;
      const b = p.br;
      if (p.brAir === 1) {
        // A bot in a human's squad goes out a moment after its human does.
        if (b.follow && b.jumpAt > 1) {
          const lead = sim.byId.get(b.follow);
          if (!lead || lead.brAir !== 1 || !lead.alive) {
            b.jumpAt = plane.f + 0.005 + sim.rng() * 0.02;
            // Its own landing slot, near the human (never the transport's start point the record was made with).
            const at = lead && lead.alive ? lead.ps : pos;
            b.dropX = at.x + b.offX; b.dropZ = at.z + b.offZ;
          }
        }
        p.ps.x = pos.x; p.ps.z = pos.z; p.ps.vx = vx; p.ps.vz = vz;
        if (plane.f >= BR.forceJump || (p.isBot && plane.f >= b.jumpAt && this._inMap(pos))) this._jump(p);
        continue;
      }
      if (p.brAir === 2) {
        b.glideT -= dt;
        if (b.glideT <= (p.isBot ? 0 : -0.4)) this._land(p);   // A phone lands itself; the host follows a moment later.
        continue;
      }
      // The circle.
      const c = this.circle;
      if (Math.hypot(p.ps.x - c.x, p.ps.z - c.z) > c.r) {
        p.hp -= outside * dt * (p.downed ? 1.5 : 1);
        p.regenT = Math.max(p.regenT, 1);
        if (p.hp <= 0) { this._die(p, p.downed ? this._downer(p) : null, p.downed ? b.downWeapon : null, 'zone'); continue; }
      }
      if (p.downed) { this._stepDowned(p, dt); continue; }
      if (b.useK) this._stepUse(p, dt);
      if ((sim.tick + p.index) % 3 === 0) this._pickups(p);
    }
    if (sim.tick % PLAN_EVERY === 0) this.plan();
    while (this.noise.length && sim.time - this.noise[0].t > NOISE_KEEP) this.noise.shift();
    // Changes older than the repeat window that every guest has had can go.
    if (this.log.length > 4000) this.log.splice(0, this.log.length - 4000);
  }

  _inMap(pos) { return pos.x > 8 && pos.z > 8 && pos.x < this.sim.map.width - 8 && pos.z < this.sim.map.height - 8; }

  _land(p) {
    const sim = this.sim, ps = p.ps;
    p.brAir = 0;
    p.br.landed = true;
    ps.x = Math.max(2, Math.min(sim.map.width - 2, ps.x));
    ps.z = Math.max(2, Math.min(sim.map.height - 2, ps.z));
    if (sim.nav && !sim.nav.isWalkable(ps.x, ps.z)) {
      const k = sim.nav.nearestFree(ps.x, ps.z);
      ps.x = k % sim.nav.w + 0.5; ps.z = Math.floor(k / sim.nav.w) + 0.5;
    }
    land(ps, sim.map);
    for (let i = 0; i < p.hx.length; i++) { p.hx[i] = ps.x; p.hz[i] = ps.z; }
    if (p.bot) { p.bot.reset(); p.bot.thinkT = 0.05; }
    sim._emit({ t: 'brland', id: p.id, x: Math.round(ps.x * 10) / 10, z: Math.round(ps.z * 10) / 10 });
  }

  // Circle: wait, then shrink; the next centre is chosen when a wait starts, so everyone sees it for the whole wait.
  _stepCircle(dt) {
    const W = this.sim.map.width;
    if (this.state === 'final') return;
    if (!this.nextChosen) this._chooseNext();
    if (this.plane.f < 1) return;          // The first wait starts once the transport has crossed.
    this.timer -= dt;
    const ph = BR.phases[this.phase];
    if (this.state === 'shrink') {
      const k = Math.max(0, Math.min(1, 1 - this.timer / ph.shrink));
      this.circle.x = this.from.x + (this.next.x - this.from.x) * k;
      this.circle.z = this.from.z + (this.next.z - this.from.z) * k;
      this.circle.r = this.from.r + (this.next.r - this.from.r) * k;
    }
    if (this.timer > 0) return;
    if (this.state === 'wait') {
      this.state = 'shrink';
      this.timer = ph.shrink;
      this.from = { ...this.circle };
    } else {
      this.circle = { ...this.next };
      this.phase++;
      if (this.phase >= BR.phases.length) { this.state = 'final'; this.phase = BR.phases.length - 1; this.timer = 0; }
      else { this.state = 'wait'; this.timer = BR.phases[this.phase].wait; this.nextChosen = false; this._chooseNext(); }
    }
    this.sim._emit({ t: 'brphase', phase: this.phase, state: this.state });
    void W;
  }

  // The next circle sits wholly inside this one, drawn toward the map's weighted places and kept on walkable ground.
  _chooseNext() {
    const sim = this.sim, W = sim.map.width, H = sim.map.height, rng = sim.rng;
    const r = BR.phases[this.phase].r * W;
    const cur = this.circle;
    const room = Math.max(0, Math.min(cur.r, Math.hypot(W, H) / 2) - r);
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * room;
      let x = cur.x + Math.cos(a) * d, z = cur.z + Math.sin(a) * d;
      // The map edge: the circle's centre stays inside it, with a margin while circles are big.
      const m = Math.min(r * 0.6, W * 0.2);
      x = Math.max(m, Math.min(W - m, x)); z = Math.max(m, Math.min(H - m, z));
      if (Math.hypot(x - cur.x, z - cur.z) > room + 1) continue;
      let score = rng() * 2;
      for (const b of this.def.circleBias ?? []) score += (b.w ?? 1) * Math.exp(-Math.hypot(b.x - x, b.z - z) / Math.max(30, r));
      if (sim.nav && !sim.nav.isWalkable(x, z)) score -= 1.5;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    best ??= { x: cur.x, z: cur.z };
    this.next = { x: best.x, z: best.z, r };
    this.nextChosen = true;
  }

  _dps() { return BR.phases[Math.min(this.phase, BR.phases.length - 1)].dps * (this.state === 'final' ? 1.4 : 1); }

  // ---- Downs, revives, deaths ----

  _upInSquad(p, except = null) {
    for (const q of this.sim.players) if (q !== p && q !== except && q.team === p.team && q.alive && !q.downed) return true;
    return false;
  }

  _downer(p) { return p.br.downedBy ? this.sim.byId.get(p.br.downedBy) ?? null : null; }

  // Called by the sim when damage would kill. True when the player goes down instead.
  tryDown(p, attacker, weapon) {
    if (!this.downs || p.downed || !this._upInSquad(p)) return false;
    const sim = this.sim;
    p.downed = true;
    p.hp = BR.downHp;
    p.br.reviveT = 0;
    p.br.useK = null;
    p.br.downedBy = attacker && attacker !== p ? attacker.id : null;
    p.br.downWeapon = weapon;
    p.ps.sprinting = false; p.ps.sliding = false;
    if (attacker && attacker !== p) attacker.br.knocks++;
    sim._emit({ t: 'down', by: attacker?.id ?? p.id, target: p.id, weapon, x: Math.round(p.ps.x * 100) / 100, z: Math.round(p.ps.z * 100) / 100 });
    return true;
  }

  _stepDowned(p, dt) {
    const sim = this.sim, b = p.br;
    p.hp -= BR.downHp / BR.bleed * dt;
    if (p.hp <= 0) { this._die(p, this._downer(p), b.downWeapon, 'bleed'); return; }
    if (b.useK === 'self') {
      b.useT -= dt;
      if (b.useT <= 0) { b.kits--; b.useK = null; this._revive(p, p); }
      return;
    }
    // A teammate standing next to you, not shooting and not running, brings you up.
    let helper = null;
    for (const q of sim.players) {
      if (q === p || q.team !== p.team || !q.alive || q.downed || q.brAir) continue;
      if (Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z) > BR.reviveReach) continue;
      if (q.ps.firingT > 1.2 || Math.hypot(q.ps.vx, q.ps.vz) > 2.6) continue;
      helper = q; break;
    }
    if (helper) {
      b.reviveT += dt;
      b.reviver = helper.id;
      if (b.reviveT >= BR.reviveTime) this._revive(p, helper);
    } else b.reviveT = Math.max(0, b.reviveT - dt * 1.5);
  }

  _revive(p, by) {
    p.downed = false;
    p.hp = BR.reviveHp;
    p.regenT = 2;
    p.br.reviveT = 0; p.br.downedBy = null; p.br.useK = null;
    if (by !== p) by.br.revives++;
    this.sim._emit({ t: 'revive', id: p.id, by: by.id });
  }

  // Death with or without someone to credit. The sim's _kill/_selfKill call back into onDeath.
  _die(p, killer, weapon, cause) {
    const sim = this.sim;
    if (!p.alive) return;
    p.downed = false;
    if (cause === 'zone') this.zoneDeaths = (this.zoneDeaths ?? 0) + 1;    // Counted for the pacing test (dev/sim-br.mjs).
    if (killer && killer !== p && killer.alive !== undefined) {
      sim._kill(p, killer, weapon ?? killer.ps.weapon, Math.hypot(killer.ps.x - p.ps.x, killer.ps.z - p.ps.z), null, false, null);
    } else sim._selfKill(p, cause);
  }

  // From the sim: someone died (any cause). Drops what they carried, and wipes their squad if nobody in it is up.
  onDeath(p) {
    const sim = this.sim;
    if (!p.br) return;
    p.downed = false;
    p.br.useK = null;
    p.br.deathT = this.t;
    p.ps.firingT = 0;
    this._dropAll(p);
    if (!this._upInSquad(p)) {
      // Everyone still down in the squad goes with it.
      for (const q of sim.players) {
        if (q !== p && q.team === p.team && q.alive && q.downed) this._die(q, this._downer(q), q.br.downWeapon, 'bleed');
      }
      this._squadOut(p.team);
    }
  }

  _squadsIn() {
    const teams = new Set();
    for (const q of this.sim.players) if (q.alive && !q.downed && q.br && !this.squadsOut.has(q.team)) teams.add(q.team);
    for (const q of this.sim.players) if (q.alive && q.br && !this.squadsOut.has(q.team)) teams.add(q.team);
    return teams;
  }

  _squadOut(team) {
    const sim = this.sim;
    if (this.squadsOut.has(team)) return;
    const left = this._squadsIn();
    left.delete(team);
    const place = left.size + 1;
    this.squadsOut.set(team, place);
    this.lastOut = team;
    for (const q of sim.players) if (q.team === team && q.br) { q.br.out = true; q.br.place = place; }
    sim._emit({ t: 'brsquad', team, place });
    if (left.size <= 1 && sim.phase === 'live') {
      const win = left.size ? [...left][0] : team;
      for (const q of sim.players) if (q.team === win && q.br) q.br.place = 1;
      if (left.size) this.squadsOut.set(win, 1);
      sim.lastKill = sim.lastKill && sim.byId.get(sim.lastKill.by)?.team === win ? sim.lastKill : sim.lastKill;
      sim._end(win);
    }
  }

  // A held human slot whose phone is gone: the character stays where it is, standing (or down) and never bot-driven.
  onAway(p) { if (p.br) p.br.useK = null; }

  // The human is back: the phone is told where it stands and what it carries.
  onRejoin(p) {
    const sim = this.sim, ps = p.ps;
    this.sentTo.delete(p.id);         // A fresh phone has none of the loot changes yet.
    p.ackX = ps.x; p.ackZ = ps.z; p.ackT = 1.5;
    if (p.alive) {
      sim._emit({ t: 'spawn', id: p.id, x: Math.round(ps.x * 100) / 100, z: Math.round(ps.z * 100) / 100, aim: Math.round(ps.aim * 100) / 100 });
      sim._emit({ t: 'brinv', id: p.id, guns: this._invGuns(p), air: p.brAir, glideT: p.br.glideT, fists: p.br.stash ? p.br.stash.slot : -1 });
    }
  }

  // ---- Damage ----

  // Plates take gunfire and blasts before health. Returns what is left for health; flags the hit for the HUD.
  absorb(target, dmg) {
    const b = target.br;
    if (!b || target.downed || b.armor <= 0) return dmg;
    const took = Math.min(b.armor, dmg);
    b.armor -= took;
    this.sim._plated = b.armor <= 0 ? 2 : 1;
    if (b.useK === 'plate') b.useK = null;     // Getting shot interrupts plating.
    return dmg - took;
  }

  onShot(p) {
    const b = p.br;
    if (b && b.useK && b.useK !== 'self') b.useK = null;
    const last = this.noise[this.noise.length - 1];
    if (!last || last.team !== p.team || this.sim.time - last.t > 0.5 || Math.hypot(last.x - p.ps.x, last.z - p.ps.z) > 20) {
      this.noise.push({ x: p.ps.x, z: p.ps.z, t: this.sim.time, team: p.team });
    }
  }

  onDamage(attacker, dmg) { if (attacker?.br) attacker.br.dmg += dmg; }

  // ---- Using things ----

  _stepUse(p, dt) {
    const b = p.br, sim = this.sim;
    b.useT -= dt;
    if (b.useT > 0) return;
    const cap = BR.plateSlots * BR.plateHp;
    if (b.useK === 'plate') {
      if (b.plates > 0 && b.armor < cap) {
        b.plates--;
        b.armor = Math.min(cap, b.armor + BR.plateHp);
        sim._emit({ t: 'brplate', id: p.id, armor: b.armor });
      }
      // One tap plates you all the way up.
      if (b.plates > 0 && b.armor < cap) { b.useT = b.useDur = BR.plateTime; return; }
    } else if (b.useK === 'med') {
      if (b.meds > 0) { b.meds--; p.hp = MAX_HP; sim._emit({ t: 'heal', id: p.id, kind: 'medkit' }); }
    }
    sim._emit({ t: 'bruse', id: p.id, kind: b.useK, done: true });
    b.useK = null;
  }

  // ---- Pickups ----

  // Walk-over pickups: ammo for a gun you hold, plates, medkits, a self-revive kit, equipment with room, a gun into an
  // empty hand, chests opened by standing at them. Bots also swap for a better gun.
  _pickups(p) {
    const list = this.near(p.ps.x, p.ps.z, Math.max(BR.pickup, BR.chestReach), this._near || (this._near = []));
    for (const it of list) {
      if (this.items[it.id] !== it) continue;
      const d = Math.hypot(it.x - p.ps.x, it.z - p.ps.z);
      if (it.kind === K.chest) { if (d <= BR.chestReach) this._openChest(it); continue; }
      if (d > BR.pickup) continue;
      this._autoPick(p, it);
    }
  }

  _autoPick(p, it) {
    const b = p.br, ps = p.ps, sim = this.sim;
    let took = false;
    switch (it.kind) {
      case K.gun: {
        const id = WEAPON_IDS[it.v];
        const empty = b.guns[0] ? (b.guns[1] ? -1 : 1) : 0;
        // A bot leaves guns lying at a human squadmate's feet alone: that is their pick to make.
        if (p.bot && this._humanMateNear(p, it.x, it.z, 4)) return;
        if (empty >= 0) { this._takeGun(p, it, empty); return; }
        if (p.bot && this._gunScore(id, it.r) > Math.min(this._heldScore(p, 0), this._heldScore(p, 1)) + 0.6 && !this._dupCat(p, id)) {
          this._takeGun(p, it, this._heldScore(p, 0) < this._heldScore(p, 1) ? 0 : 1);
        }
        return;
      }
      case K.ammo: {
        const type = AMMO_TYPES[it.v];
        let left = it.n;
        for (const s of [ps.slot, 1 - ps.slot]) {
          if (!left || !this._held(p, s) || ammoOf(b.guns[s].id) !== type) continue;
          const got = brAmmo(ps, s, left);
          if (got > 0) { left -= got; if (!p.isBot) sim._emit({ t: 'bramm', id: p.id, slot: s, n: got }); }
        }
        left = this._toPouch(p, type, left);       // The rest is kept for a gun of that type.
        if (left === it.n) return;
        if (left > 0) { it.n = left; this._removeItem(it); this._addItem({ ...it, kit: NO_ATTACHMENTS }); return; }
        took = true; break;
      }
      case K.plate: {
        const room = BR.plateCarry - b.plates;
        if (room <= 0) return;
        const n = Math.min(room, it.n);
        b.plates += n;
        if (n < it.n) { this._removeItem(it); this._addItem({ ...it, n: it.n - n }); return; }
        took = true; break;
      }
      case K.med: if (b.meds >= BR.medCarry) return; b.meds++; took = true; break;
      case K.kit: if (b.kits >= BR.kitCarry || !this.downs) return; b.kits++; took = true; break;
      case K.lethal: case K.tactical: {
        const lethal = it.kind === K.lethal, ids = lethal ? LETHAL_IDS : TACTICAL_IDS, kind = ids[it.v];
        const cur = lethal ? ps.lethal : ps.tactical, left = lethal ? ps.lethalLeft : ps.tacticalLeft;
        if (left > 0 && cur !== kind) return;
        if (left >= EQUIP_CAP) return;
        const n = Math.min(EQUIP_CAP - left, it.n);
        if (lethal) { ps.lethal = kind; ps.lethalLeft = left + n; } else { ps.tactical = kind; ps.tacticalLeft = left + n; }
        sim._metaUntil = sim.tick + 2;
        took = true; break;
      }
      default: return;
    }
    if (took) {
      this._removeItem(it);
      if (!p.isBot) sim._emit({ t: 'brpick', id: p.id, kind: BR_KINDS[it.kind] });
    }
  }

  _humanMateNear(p, x, z, r) {
    for (const q of this.sim.players) if (q !== p && !q.isBot && q.team === p.team && q.alive && Math.hypot(q.ps.x - x, q.ps.z - z) < r) return true;
    return false;
  }

  _gunScore(id, r) { return (CAT_SCORE[WEAPON_CATEGORY[id]] ?? 0) + r * 0.45; }
  _heldScore(p, s) { const g = p.br.guns[s]; return g ? this._gunScore(g.id, g.r) : -1; }
  _dupCat(p, id) {
    const c = WEAPON_CATEGORY[id];
    return p.br.guns.some(g => g && WEAPON_CATEGORY[g.id] === c && this._gunScore(g.id, g.r) >= this._gunScore(id, 0));
  }

  // A gun from the floor into a hand. The hand's old gun (if any) goes down where you stand, with its ammo.
  _takeGun(p, it, slot) {
    const sim = this.sim, ps = p.ps, b = p.br;
    if (slot !== 0 && slot !== 1) slot = !b.guns[0] ? 0 : !b.guns[1] ? 1 : ps.slot;
    const old = b.guns[slot];
    const id = WEAPON_IDS[it.v];
    const oldAmmo = this._ammoIn(p, slot), oldRes = this._resIn(p, slot);
    if (b.stash?.slot === slot) b.stash = null;
    this._removeItem(it);
    if (old) {
      // The old gun goes down with its magazine; its spare rounds go in the pouch, as far as they fit.
      const keep = brDef(old.id).unlimitedReserve ? oldRes : this._toPouch(p, ammoOf(old.id), oldRes);
      this._addItem({ kind: K.gun, v: WEAPON_IDS.indexOf(old.id), r: old.r, n: 1, kit: old.kit, ammo: oldAmmo, res: keep,
        x: it.x, z: it.z });
    }
    const def = brDef(id, it.kit, it.r);
    const ammo = it.ammo ?? def.magazine;
    let res = it.res ?? def.magazine * (1 + (it.r >> 1));
    // Topped up from the pouch.
    const pt = AMMO_TYPES.indexOf(ammoOf(id));
    if (pt >= 0 && !def.unlimitedReserve) { const n = Math.max(0, Math.min(b.pouch[pt], brAmmoCap(def) - res)); b.pouch[pt] -= n; res += n; }
    b.guns[slot] = { id, r: it.r, kit: it.kit };
    brArm(ps, slot, id, it.kit, it.r, ammo, res);
    p.kits[slot] = it.kit;
    if (slot === 0) p.primary = id;
    if (ps.weapon === id) { p.camo = ps.camo = this._camo(p, id); }
    sim._metaUntil = sim.tick + 2;
    sim._emit({ t: 'brgive', id: p.id, slot, w: it.v, r: it.r, kit: packKit(it.kit), ammo, res, camo: this._camo(p, id) });
    if (p.bot) p.bot.onArmed?.();
  }

  _openChest(it) {
    const sim = this.sim, rng = sim.rng;
    this._removeItem(it);
    sim._emit({ t: 'brchest', x: Math.round(it.x * 10) / 10, z: Math.round(it.z * 10) / 10 });
    const kinds = ['gun', rng() < 0.5 ? 'gun' : 'plate', 'plate', rng() < 0.4 ? 'kit' : rng() < 0.5 ? 'lethal' : 'med'];
    kinds.forEach((kind, i) => {
      const a = i / kinds.length * Math.PI * 2 + rng() * 0.6;
      const roll = kind === 'gun' ? this._rollGun(rng, 'chest') : this._rollItem(rng, 1, kind);
      const at = this._spot(it.x + Math.cos(a) * 1.1, it.z + Math.sin(a) * 1.1);
      this._addItem({ ...roll, x: at.x, z: at.z });
      if (kind === 'gun') {
        const type = ammoOf(WEAPON_IDS[roll.v]);
        const at2 = this._spot(it.x + Math.cos(a + 0.4) * 1.5, it.z + Math.sin(a + 0.4) * 1.5);
        if (type) this._addItem({ kind: K.ammo, v: AMMO_TYPES.indexOf(type), r: 0, n: AMMO_PACK[type] * 2, x: at2.x, z: at2.z });
      }
    });
  }

  _spot(x, z) {
    const nav = this.sim.nav, W = this.sim.map.width, H = this.sim.map.height;
    x = Math.max(1, Math.min(W - 1, x)); z = Math.max(1, Math.min(H - 1, z));
    if (nav && !nav.isWalkable(x, z)) { const k = nav.nearestFree(x, z); x = k % nav.w + 0.5; z = Math.floor(k / nav.w) + 0.5; }
    return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
  }

  // What a dead player carried goes down in a ring where they fell.
  _dropAll(p) {
    const ps = p.ps, b = p.br, drops = [];
    for (let s = 0; s < 2; s++) {
      const g = b.guns[s];
      if (!g) continue;
      drops.push({ kind: K.gun, v: WEAPON_IDS.indexOf(g.id), r: g.r, n: 1, kit: g.kit, ammo: this._ammoIn(p, s), res: 0 });
      const type = ammoOf(g.id), res = this._resIn(p, s);
      if (type && res > 0 && !brDef(g.id).unlimitedReserve) b.pouch[AMMO_TYPES.indexOf(type)] += res;
      b.guns[s] = null;
    }
    b.stash = null;
    b.pouch.forEach((n, t) => { if (n > 0) drops.push({ kind: K.ammo, v: t, r: 0, n: Math.min(n, AMMO_PACK[AMMO_TYPES[t]] * 3) }); });
    b.pouch = [0, 0, 0, 0, 0];
    if (b.plates) drops.push({ kind: K.plate, v: 0, r: 0, n: b.plates });
    if (b.meds) drops.push({ kind: K.med, v: 0, r: 0, n: 1 });
    if (b.kits) drops.push({ kind: K.kit, v: 0, r: 4, n: 1 });
    if (ps.lethalLeft > 0) drops.push({ kind: K.lethal, v: LETHAL_IDS.indexOf(ps.lethal), r: 0, n: ps.lethalLeft });
    if (ps.tacticalLeft > 0) drops.push({ kind: K.tactical, v: TACTICAL_IDS.indexOf(ps.tactical), r: 0, n: ps.tacticalLeft });
    b.plates = 0; b.meds = 0; b.kits = 0; b.armor = 0;
    ps.lethalLeft = 0; ps.tacticalLeft = 0;
    drops.forEach((d, i) => {
      const a = i / Math.max(1, drops.length) * Math.PI * 2;
      const at = this._spot(ps.x + Math.cos(a) * 0.9, ps.z + Math.sin(a) * 0.9);
      this._addItem({ ...d, x: at.x, z: at.z });
    });
  }

  // ---- Bots ----

  // Bots the rules drive themselves this tick (aboard, gliding, downed). True when BotBrain should not run.
  driveBot(p, dt) {
    const b = p.br;
    if (!b) return false;
    if (p.brAir === 1) return true;
    if (p.brAir === 2) {
      const lead = b.follow && this.sim.byId.get(b.follow);
      // Following a human: the slot moves only once the human's own slot has drifted well away from it, so their
      // steering is followed in broad strokes, never copied stroke for stroke.
      if (lead && lead.alive && lead.brAir === 2 && !lead.away) {
        const sx = lead.ps.x + b.offX, sz = lead.ps.z + b.offZ;
        if (Math.hypot(sx - b.dropX, sz - b.dropZ) > SLOT_SLACK) { b.dropX = sx; b.dropZ = sz; }
      }
      const dx = b.dropX - p.ps.x, dz = b.dropZ - p.ps.z, d = Math.hypot(dx, dz);
      glideStep(p.ps, d > 1.5 ? dx / d : 0, d > 1.5 ? dz / d : 0, dt, this.sim.map);
      return true;
    }
    if (p.downed) {
      // Crawl toward the nearest teammate who is up, or sit still and use a kit when nobody is coming.
      let best = null, bestD = 40;
      for (const q of this.sim.players) {
        if (q === p || q.team !== p.team || !q.alive || q.downed || q.brAir) continue;
        const d = Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z);
        if (d < bestD) { bestD = d; best = q; }
      }
      const I = this._downIn || (this._downIn = { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1 });
      I.mx = 0; I.mz = 0; I.aim = p.ps.aim;
      if (best && bestD > 1.4) {
        const dx = best.ps.x - p.ps.x, dz = best.ps.z - p.ps.z;
        if (this.sim.nav.isWalkable(p.ps.x + dx / bestD, p.ps.z + dz / bestD)) { I.mx = dx / bestD; I.mz = dz / bestD; I.aim = Math.atan2(dz, dx); }
      }
      if (!best && b.kits > 0 && !b.useK && this.sim.time % 3 < 0.1) this._startUse(p, 'self');
      downedInput(I);
      stepPlayer(p.ps, I, dt, this.sim.map, this.sim.rng);
      return true;
    }
    return false;
  }

  // Squad plans, twice a second: where each bot squad drops, loots, rotates and holds, and who revives whom.
  plan() {
    const sim = this.sim;
    if (!sim.nav) return;
    const squads = new Map();
    for (const p of sim.players) {
      if (!p.br || !p.alive) continue;
      let s = squads.get(p.team);
      if (!s) squads.set(p.team, s = []);
      s.push(p);
    }
    if (!this.dropsPlanned) { this._planDrops(squads); this.dropsPlanned = true; }
    for (const [team, members] of squads) this._planSquad(team, members);
  }

  // Bot squads pick places along the flight line, spread out, the best ones drawing more than one squad (hot drops).
  // Bots in a human's squad follow that human out of the transport and down.
  _planDrops(squads) {
    const sim = this.sim, rng = sim.rng, pois = this.def.pois ?? [], plane = this.plane;
    const picks = [];
    const dx = (plane.tx - plane.fx) / plane.len, dz = (plane.tz - plane.fz) / plane.len;
    for (const [team, members] of squads) {
      const human = members.find(p => !p.isBot);
      if (human) {
        let k = 0;
        for (const p of members) {
          if (!p.isBot) continue;
          const a = (k++ / 3) * Math.PI * 2 + rng() * 0.6, r = FOLLOW_GLIDE * (0.85 + rng() * 0.3);
          p.br.follow = human.id; p.br.offX = Math.cos(a) * r; p.br.offZ = Math.sin(a) * r; p.br.jumpAt = 2;   // Jumps with the human.
        }
        continue;
      }
      // Most squads land away from everyone else (real players spread out along the line); now and then a squad goes
      // for a contested tier 1 place on purpose. Duos and solos also land between the places, at any loot spot.
      const hot = rng() < HOT_DROP[Math.min(4, this.squad)];
      let best = null, bestW = -1;
      for (const c of this._dropCands(rng)) {
        const t = ((c.x - plane.fx) * dx + (c.z - plane.fz) * dz);
        const off = Math.abs((c.x - plane.fx) * dz - (c.z - plane.fz) * dx);
        let near = 0;
        for (const q of picks) { const d = Math.hypot(q.x - c.x, q.z - c.z); near = Math.max(near, Math.exp(-(d * d) / (DROP_GAP * DROP_GAP))); }
        // A hot drop joins one other squad at a tier 1 place, never a third.
        const crowd = picks.filter(q => Math.hypot(q.x - c.x, q.z - c.z) < 30).length;
        const spread = hot && crowd < 2 ? (c.tier === 1 ? 1 + near : 0.1) : (1 - 0.97 * near) * (crowd ? 0.05 : 1);
        const w = (c.tier === 1 ? 3 : c.tier === 2 ? 2 : 1.2) * spread * Math.exp(-off / 140) * (0.4 + rng()) * (t > 20 && t < plane.len - 20 ? 1 : 0.2);
        if (w > bestW) { bestW = w; best = c; }
      }
      if (!best) best = { x: sim.map.width / 2, z: sim.map.height / 2, r: 30, id: 'mid' };
      picks.push(best);
      const along = ((best.x - plane.fx) * dx + (best.z - plane.fz) * dz) / plane.len;
      // Out when the transport passes closest to the place; the glide covers what it can of the rest.
      const jump = Math.max(0.05, Math.min(BR.forceJump - 0.02, along - 0.01));
      for (const p of members) {
        p.br.jumpAt = jump + (rng() - 0.5) * 0.02;
        const a = rng() * Math.PI * 2, r = (best.r ?? 20) * 0.6 * Math.sqrt(rng());
        p.br.dropX = best.x + Math.cos(a) * r; p.br.dropZ = best.z + Math.sin(a) * r;
      }
      // A squad's habits for the match: how long it loots before it moves for the circle (late rotators sometimes get
      // caught), and how keen it is to join fights it hears.
      this.plans.set(team, { poi: best.poi ?? best, kind: 'loot', since: sim.time, late: rng(), aggro: 0.5 + rng() * 0.8 });
    }
  }

  // Where squads may land: the named places, and for duos and solos also loot spots between them (each tied to its
  // nearest place for the loot run that follows).
  _dropCands(rng) {
    const pois = this.def.pois ?? [];
    const out = pois.map(poi => ({ x: poi.x, z: poi.z, r: poi.r, tier: poi.tier, id: poi.id, poi }));
    if (this.squad <= 2) {
      const loot = this.def.loot ?? [];
      for (let i = 0; i < 40 && loot.length; i++) {
        const s = loot[Math.floor(rng() * loot.length)];
        let poi = null, bd = Infinity;
        for (const q of pois) { const d = Math.hypot(q.x - s.x, q.z - s.z); if (d < bd) { bd = d; poi = q; } }
        if (!poi) continue;
        out.push({ x: s.x, z: s.z, r: 8, tier: Math.min(3, s.tier + 1), id: `spot${i}`, poi: { id: `spot:${poi.id}:${i}`, x: s.x, z: s.z, r: 16, tier: s.tier } });
      }
    }
    return out;
  }

  _geared(p) {
    const b = p.br;
    const best = Math.max(this._heldScore(p, 0), this._heldScore(p, 1));
    return best >= 2.4 && b.armor + b.plates * BR.plateHp >= 100;
  }

  _planSquad(team, members) {
    const sim = this.sim, c = this.circle, n = this.next;
    const bots = members.filter(p => p.bot && !p.downed && !p.brAir);
    if (!bots.length) return;
    const lead = members.find(p => !p.isBot && !p.downed && !p.brAir && !p.away);
    let plan = this.plans.get(team);
    if (!plan) this.plans.set(team, plan = { poi: null, kind: 'loot', since: sim.time });
    const downed = members.filter(p => p.downed);
    const anchor = lead ?? bots[0];
    // Circle timing: how long until the edge reaches us, and how long the walk in takes.
    const ax = anchor.ps.x, az = anchor.ps.z;
    const toNext = Math.hypot(ax - n.x, az - n.z) - n.r * 0.7;
    const walk = Math.max(0, toNext) / 5 + 10;
    const outsideNow = Math.hypot(ax - c.x, az - c.z) > c.r - 6;
    // Late rotators (plan.late near 1) leave it until the shrink is under way; the rest move with time to spare.
    const late = plan.late ?? 0.5;
    // The first circle hurts so little that nobody leaves good loot for it before it moves.
    // While it shrinks, a squad moves once the edge comes near (they stagger as it sweeps across the map).
    const closing = this.phase === 0 ? Math.hypot(ax - c.x, az - c.z) > c.r - 25 : (this.state === 'shrink' && (late < 0.75 || toNext > n.r * 0.4)) || this.timer < walk * (1.3 - late) + 8 * (1 - late);
    const geared = bots.every(p => this._geared(p));
    let kind = 'loot';
    // A greedy squad (late, from phase 1) shrugs the circle off until it starts to hurt; sometimes it leaves it too late.
    const shrugs = late > 0.6 && this.phase >= 1 && this.state !== 'final' && bots.every(q => q.hp > GREEDY_HP);
    if ((outsideNow && !shrugs) || (closing && toNext > 0 && !shrugs)) kind = 'rotate';
    else if (geared || this.phase >= 2) kind = 'hold';
    // A fight nearby, inside where we need to be: sometimes worth taking a piece of. Each burst of gunfire is weighed
    // once. Nobody goes looking for trouble while the first circle waits; later, keener and further.
    let fight = plan.fight && sim.time - plan.fight.t < NOISE_KEEP ? plan.fight : null;
    const join = (JOIN_FIGHT[Math.min(this.phase + (this.state === 'wait' ? 0 : 1), JOIN_FIGHT.length - 1)] ?? 0.5) * (plan.aggro ?? 1);
    if (!fight && join > 0 && kind !== 'rotate' && (geared || this.phase >= 3) && bots.length >= Math.min(2, members.length) && bots.every(p => p.hp > 60)) {
      const reach = THIRD_PARTY * Math.min(0.7, 0.4 + this.phase * 0.1);
      for (let i = this.noise.length - 1; i >= 0; i--) {
        const s = this.noise[i];
        if (s.team === team || s.weighed?.has(team)) continue;
        (s.weighed || (s.weighed = new Set())).add(team);
        const d = Math.hypot(s.x - ax, s.z - az);
        if (d > 18 && d < reach && Math.hypot(s.x - n.x, s.z - n.z) < n.r + 10 && sim.rng() < join) { fight = s; break; }
      }
    }
    plan.fight = fight;
    if (fight && kind !== 'rotate') kind = 'fight';
    if (plan.kind !== kind) { plan.kind = kind; plan.since = sim.time; plan.spot = null; }

    // Where the squad goes, once per plan change or when the circle moves on.
    if (kind === 'rotate' && (!plan.spot || plan.circle !== this.phase)) {
      const a = Math.atan2(az - n.z, ax - n.x) + (sim.rng() - 0.5) * 0.8;
      // In at the near edge, not the middle: squads coming from all sides do not all meet in the centre.
      plan.spot = this._walkable(n.x + Math.cos(a) * n.r * 0.7, n.z + Math.sin(a) * n.r * 0.7);
      plan.circle = this.phase;
    } else if (kind === 'hold' && (!plan.spot || (plan.circle !== this.phase && Math.hypot(plan.spot.x - n.x, plan.spot.z - n.z) > n.r * 0.8))) {
      // A squad holds where it is while that stays inside the next circle: it does not wander between holds.
      plan.spot = this._holdSpot(n, ax, az, (plan.late ?? 0) > 0.65 ? EDGE_RING : 0.62);
      plan.circle = this.phase; plan.since = sim.time;
    } else if (kind === 'fight') {
      const d = Math.hypot(fight.x - ax, fight.z - az);
      plan.spot = this._walkable(fight.x + (ax - fight.x) / d * 16, fight.z + (az - fight.z) / d * 16);
    }

    let sqx = 0, sqz = 0;
    for (const q of bots) { sqx += q.ps.x / bots.length; sqz += q.ps.z / bots.length; }
    for (let i = 0; i < bots.length; i++) {
      const p = bots[i], bot = p.bot, b = p.br;
      bot.sightK = 1;
      // Look after yourself between fights: plates first, then a medkit.
      if (!bot.targetVisible && !b.useK) {
        if (b.plates > 0 && b.armor <= (BR.plateSlots - 1) * BR.plateHp) this._startUse(p, 'plate');
        // (A greedy squad sitting in the circle's damage does not think to heal until it heads in.)
        else if (b.meds > 0 && p.hp < 60 && !(shrugs && kind !== 'rotate' && Math.hypot(p.ps.x - c.x, p.ps.z - c.z) > c.r)) this._startUse(p, 'med');
      }
      // A teammate down nearby comes first, unless there is a fight in view.
      const mate = downed.length && !bot.targetVisible ? downed.reduce((m, q) => {
        const d = Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z);
        return d < 50 && (!m || d < m.d) ? { q, d } : m;
      }, null) : null;
      if (mate && (!this._reviverFor(mate.q, p) || this._reviverFor(mate.q, p) === p)) {
        mate.q.br.reviverBot = p.id;
        bot.setObjective({ key: `rev:${mate.q.id}:${Math.round(mate.q.ps.x)}:${Math.round(mate.q.ps.z)}`, role: 'collect', x: mate.q.ps.x, z: mate.q.ps.z, r: 1, commit: true });
        continue;
      }
      // A human leads: stay in reach of them, looting what is around, as a squadmate would (not a shadow: no copying
      // their moves or their aim).
      if (lead && kind !== 'rotate') {
        const dl = Math.hypot(lead.ps.x - p.ps.x, lead.ps.z - p.ps.z);
        const near = dl < LEAD_LEASH ? this._lootTarget(p, LEAD_LOOT, lead.ps.x, lead.ps.z) : null;
        if (near) { bot.setObjective(near); continue; }
        // A spot round the human, kept until the human has moved on; the bot watches its own side of the squad.
        if (!b.with || Math.hypot(lead.ps.x - b.with.lx, lead.ps.z - b.with.lz) > WITH_REPICK) {
          const a = (i / bots.length) * Math.PI * 2 + (sim.rng() - 0.5) * 0.9, r = 5 + sim.rng() * 4;
          const at = this._walkable(lead.ps.x + Math.cos(a) * r, lead.ps.z + Math.sin(a) * r);
          b.with = { x: at.x, z: at.z, lx: lead.ps.x, lz: lead.ps.z, aim: a, n: (b.with?.n ?? 0) + 1 };
        }
        const w = b.with;
        bot.setObjective({ key: `with:${w.n}`, role: 'hold', x: w.x, z: w.z, r: 3, aim: w.aim });
        continue;
      }
      if (kind === 'loot' || (kind === 'hold' && !this._geared(p))) {
        // The squad loots together: round the middle of the place and the squad (so a teammate is near enough to pick
        // you up), or round its hold once the circle has a say.
        const poi = plan.poi;
        let lx = sqx, lz = sqz, lr = 18;
        if (kind === 'loot' && poi) { lx = (poi.x + sqx) / 2; lz = (poi.z + sqz) / 2; lr = Math.max(16, Math.min(28, poi.r + 6)); }
        else if (plan.spot) { lx = plan.spot.x; lz = plan.spot.z; }
        const t = this._lootTarget(p, lr, lx, lz);
        if (t) { bot.setObjective(t); bot.sightK = LOOT_SIGHT[Math.min(this.phase, 2)]; continue; }
        // Nothing left here: the squad moves to the nearest quiet place it has not been, inside the next circle; while
        // the first circle waits it stays put a while first (a squad with a gun each settles in instead).
        const dwell = this.phase === 0 && this.state === 'wait' ? LOOT_DWELL : 6;
        if (kind === 'loot' && sim.time - plan.since > dwell && !(this.phase === 0 && this.state === 'wait' && bots.filter(q => this._heldScore(q, 0) >= 2.2 || this._heldScore(q, 1) >= 2.2).length * 2 >= bots.length)) {
          (plan.visited || (plan.visited = new Set())).add(plan.poi?.id);
          plan.poi = this._nextPoi(team, ax, az, n, plan.visited, this.phase === 0 ? 90 : Infinity);
          plan.since = sim.time;
        }
      }
      const spot = plan.spot ?? this._walkable(p.ps.x, p.ps.z);
      const a = (i / bots.length) * Math.PI * 2;
      const at = this._walkable(spot.x + Math.cos(a) * 3.5, spot.z + Math.sin(a) * 3.5);
      const aim = Math.atan2(n.z - at.z, n.x - at.x) + (kind === 'hold' ? Math.PI + a : 0);
      bot.setObjective({ key: `${kind}:${this.phase}:${Math.round(at.x)}:${Math.round(at.z)}`, role: kind === 'rotate' ? 'collect' : 'hold', x: at.x, z: at.z, r: kind === 'hold' ? 3 : 2,
        aim, commit: kind === 'rotate' && outsideNow });
    }
  }

  _reviverFor(q) { const id = q.br.reviverBot; const r = id && this.sim.byId.get(id); return r && r.alive && !r.downed ? r : null; }

  _walkable(x, z) {
    const nav = this.sim.nav, W = this.sim.map.width, H = this.sim.map.height;
    x = Math.max(3, Math.min(W - 3, x)); z = Math.max(3, Math.min(H - 3, z));
    if (!nav.isWalkable(x, z)) { const k = nav.nearestFree(x, z); x = k % nav.w + 0.5; z = Math.floor(k / nav.w) + 0.5; }
    return { x, z };
  }

  // A good place to sit out the wait inside the next circle: late in the match a roofless room or a hold with cover.
  // ringK: where in the next circle (a share of its radius) the squad likes to sit; edge players sit just outside it and
  // run in as it shrinks, which sometimes goes wrong.
  _holdSpot(n, ax, az, ringK = 0.62) {
    const sim = this.sim, rooms = sim.map.rooms ?? [], c = this.circle;
    const early = this.phase === 0 && this.state === 'wait';     // The first circle is far off: settle in where you are.
    let best = null, bestS = -Infinity;
    for (const r of rooms) {
      const x = r.x + r.w / 2, z = r.z + r.d / 2;
      const dc = Math.hypot(x - n.x, z - n.z);
      if ((dc > n.r * Math.max(0.85, ringK + 0.1) || Math.hypot(x - c.x, z - c.z) > c.r * 0.9) && !early) continue;
      // Late on, a ring inside the edge on our side rather than the middle, where every squad would meet.
      const ring = this.phase >= 1 ? Math.abs(dc / Math.max(1, n.r) - ringK) * 8 : 0;
      const s = -Math.hypot(x - ax, z - az) * 0.12 - ring + sim.rng() * 2;
      if (s > bestS) { bestS = s; best = { x, z }; }
    }
    if (!best) {
      const ix = sim.nav.holdIndex, k = ix.near(n.x, n.z, Math.max(10, n.r * Math.max(0.8, ringK + 0.12)));
      for (let q = 0; q < k; q++) {
        const h = sim.nav.holds[ix.out[q]];
        const ring = this.phase >= 1 ? Math.abs(Math.hypot(h.x - n.x, h.z - n.z) / Math.max(1, n.r) - ringK) * 8 : 0;
        const s = -Math.hypot(h.x - ax, h.z - az) * 0.12 - ring + sim.rng() * 2;
        if (s > bestS) { bestS = s; best = { x: h.x, z: h.z }; }
      }
    }
    return this._walkable(best?.x ?? n.x, best?.z ?? n.z);
  }

  // The next place to loot: near, inside the next circle, not been there, and nobody else heading for it.
  _nextPoi(team, x, z, n, visited, maxD = Infinity) {
    let best = null, bestS = -Infinity;
    for (const poi of this.def.pois ?? []) {
      const d = Math.hypot(poi.x - x, poi.z - z);
      if (Math.hypot(poi.x - n.x, poi.z - n.z) > n.r + 20 || visited?.has(poi.id) || d > maxD) continue;
      let others = 0;
      for (const [t, pl] of this.plans) if (t !== team && pl.poi === poi) others++;
      // Somebody is there already (any enemy within the place): a looting squad goes elsewhere.
      for (const q of this.sim.players) if (q.alive && q.team !== team && !q.brAir && Math.hypot(q.ps.x - poi.x, q.ps.z - poi.z) < poi.r + 20) { others++; break; }
      const s = -d + (poi.tier === 1 ? 25 : 0) - others * 80 + this.sim.rng() * 30;
      if (s > bestS) { bestS = s; best = poi; }
    }
    return best;
  }

  // The nearest item this bot would actually pick up, near (cx, cz), not claimed by a squadmate.
  _lootTarget(p, radius, cx, cz) {
    const sim = this.sim, b = p.br;
    const list = this.near(cx, cz, radius, this._lt || (this._lt = []));
    let best = null, bestD = Infinity;
    for (const it of list) {
      const claim = this.claims.get(it.id);
      if (claim && claim.bot !== p.id && claim.until > sim.time) continue;
      if (!this._wants(p, it)) continue;
      const d = Math.hypot(it.x - p.ps.x, it.z - p.ps.z) - (it.kind === K.chest ? 12 : it.kind === K.gun ? 4 : 0);
      if (d < bestD) { bestD = d; best = it; }
    }
    if (!best) return null;
    this.claims.set(best.id, { bot: p.id, until: sim.time + 8 });
    void b;
    return { key: `loot:${best.id}`, role: 'collect', x: best.x, z: best.z, r: 1 };
  }

  _wants(p, it) {
    const b = p.br, ps = p.ps;
    switch (it.kind) {
      case K.chest: return true;
      case K.gun: {
        const id = WEAPON_IDS[it.v];
        if (!b.guns[0] || !b.guns[1]) return true;
        return this._gunScore(id, it.r) > Math.min(this._heldScore(p, 0), this._heldScore(p, 1)) + 0.6 && !this._dupCat(p, id);
      }
      case K.ammo: {
        const type = AMMO_TYPES[it.v];
        return b.guns.some((g, s) => g && ammoOf(g.id) === type && ps.reserve[s] < brAmmoCap(ps.defs[s]) * 0.6);
      }
      case K.plate: return b.plates < BR.plateCarry;
      case K.med: return b.meds < BR.medCarry;
      case K.kit: return this.downs && b.kits < 1;
      case K.lethal: return ps.lethalLeft === 0;
      case K.tactical: return ps.tacticalLeft === 0;
    }
    return false;
  }

  // ---- View and wire ----

  // Packed per player: armor 8 bits | downed | air 2 bits | revive progress 4 bits | out | place 6 bits.
  _packPlayer(p) {
    const b = p.br;
    if (!b) return 0;
    const rev = p.downed ? Math.min(15, Math.round((b.useK === 'self' ? 1 - b.useT / BR.selfRevive : b.reviveT / BR.reviveTime) * 15)) : 0;
    return Math.min(255, Math.ceil(b.armor)) | (p.downed ? 256 : 0) | ((p.brAir & 3) << 9) | (rev << 11) | (b.out ? 32768 : 0) | ((b.place & 63) << 16);
  }

  _head() {
    const c = this.circle, n = this.next, pl = this.plane;
    const sq = this._squadsIn();
    let alive = 0;
    for (const p of this.sim.players) if (p.alive) alive++;
    return [Math.round(pl.f * 1000), r1(c.x), r1(c.z), r1(c.r), r1(n.x), r1(n.z), r1(n.r), this.phase, this.state === 'wait' ? 0 : this.state === 'shrink' ? 1 : 2,
      Math.ceil(this.timer * 10), sq.size, alive, Math.round(pl.fx), Math.round(pl.fz), Math.round(pl.tx), Math.round(pl.tz)];
  }

  _inv(p) {
    const b = p?.br;
    if (!b) return 0;
    return [b.plates, b.meds, b.kits, USE_KINDS.indexOf(b.useK), Math.ceil(b.useT * 10), Math.ceil(b.useDur * 10), b.guns[0]?.r ?? -1, b.guns[1]?.r ?? -1,
      b.pouch, b.stash ? b.stash.slot : -1];
  }

  _stats() {
    return this.sim.players.map(p => p.br ? [Math.round(p.br.dmg), p.br.revives, p.br.knocks, p.br.place, Math.round((p.br.out && !p.alive ? p.br.deathT : this.t) * 10)] : [0, 0, 0, 0, 0]);
  }

  // The block for one guest (or for everyone when guest is null: no inventory, recent changes only).
  encodeFor(guest) {
    const sim = this.sim;
    const out = this._head();
    out.push(sim.players.map(p => this._packPlayer(p)));
    out.push(guest ? this._inv(guest) : 0);
    // Loot changes this guest has not had, plus the last moment's again.
    const since = guest ? (this.sentTo.get(guest.id) ?? 0) : this.seq;
    const recent = sim.time - CHANGE_REPEAT;
    let ch = null;
    for (let i = this.log.length - 1; i >= 0; i--) {
      const e = this.log[i];
      if (e.seq <= since && e.t < recent) break;
      (ch || (ch = [])).push(e.rec);
    }
    if (ch) ch.reverse();
    if (guest) this.sentTo.set(guest.id, this.seq);
    out.push(ch ? ch.flat() : 0);
    out.push(sim.tick % 90 === 0 || sim.phase === 'ended' ? this._stats() : 0);   // For the results screen: rarely.
    // Host migration: now and then each human guest gets what only the host knows (everyone's inventory, the circle's
    // own clock, bot drop plans), so whichever phone takes over can carry the match on (restore).
    // Half the players at a time, so no one snapshot carries the whole pack list.
    const bt = sim.tick + guest?.index * 7;
    if (guest && !guest.isBot && bt % (BACKUP_EVERY / 2) === 0 && sim.tick % 90 > 4) out.push(this.backup((bt / (BACKUP_EVERY / 2)) & 1));
    return out;
  }

  // ---- Host migration ----

  // What a new host needs and the snapshots do not carry: per player [plates, meds, kits, gun0, gun1, ammo0, res0,
  // ammo1, res1, downedBy index, use kind, use time, glide time, jumpAt, dropX, dropZ, follow index, revive count, dmg,
  // knocks, deathT] with a gun as [weapon index, rarity, packed kit] or 0; then the rules' own clock and the circle's
  // shrink start.
  backup(half = -1) {
    const sim = this.sim, idx = id => (id ? sim.byId.get(id)?.index ?? -1 : -1), n = sim.players.length;
    const per = sim.players.map((p, i) => {
      const b = p.br, ps = p.ps;
      if (!b || !p.alive || (half === 0 && i >= n / 2) || (half === 1 && i < n / 2)) return 0;
      const air = p.brAir !== 0;      // Drop plans only matter until the landing; damage, revives and knocks ride the stats.
      const g = s => (b.guns[s] ? [WEAPON_IDS.indexOf(b.guns[s].id), b.guns[s].r, packKit(b.guns[s].kit)] : 0);
      void ps;
      return [b.plates, b.meds, b.kits, g(0), g(1), this._ammoIn(p, 0), this._resIn(p, 0), this._ammoIn(p, 1), this._resIn(p, 1), idx(b.downedBy), USE_KINDS.indexOf(b.useK),
        Math.round(b.useT * 10), air ? Math.round(b.glideT * 10) : 0, air ? Math.round(b.jumpAt * 1000) : 0, air ? Math.round(b.dropX) : 0, air ? Math.round(b.dropZ) : 0, air ? idx(b.follow) : -1,
        0, 0, 0, 0, b.pouch.some(Boolean) ? b.pouch : 0, b.stash ? b.stash.slot : -1];
    });
    return [Math.round(this.t * 10), r1(this.from.x), r1(this.from.z), r1(this.from.r), this.dropsPlanned ? 1 : 0, per];
  }

  // The new host (once a guest) rebuilds the rules from its old mirror (`old`, the guest copy with its loot table and
  // the latest backup) and the newest snapshot view. Called by Sim.fromSnapshot after the players are restored.
  restore(view, old) {
    const sim = this.sim, bk = old?.saved ?? null;
    this.authority = true;
    if (old) {
      Object.assign(this.plane, old.plane);
      this.circle = { ...old.circle }; this.next = { ...old.next };
      this.phase = old.phase; this.state = old.state; this.timer = old.timer;
      // The loot table as this phone last mirrored it: same ids, so other phones' mirrors stay in step.
      this.items = old.items; this.grid = old.grid;
      this.log = []; this.seq = 0; this.sentTo = new Map();
    }
    this.nextChosen = true;
    this.t = bk ? bk[0] / 10 : Math.max(0, view.t - (sim.phase === 'live' ? 0 : BR.warmup));
    this.from = bk ? { x: bk[1] / 10, z: bk[2] / 10, r: bk[3] / 10 } : { ...this.circle };
    if (this.state === 'shrink' && !bk) {
      // Where this shrink began, from how far along it is.
      const ph = BR.phases[this.phase], k = Math.max(0, Math.min(0.99, 1 - this.timer / ph.shrink));
      this.from = { x: (this.circle.x - this.next.x * k) / (1 - k), z: (this.circle.z - this.next.z * k) / (1 - k), r: (this.circle.r - this.next.r * k) / (1 - k) };
    }
    this.dropsPlanned = bk ? !!bk[4] : this.plane.f > 0;
    if (sim.phase === 'warmup') sim.phaseT = Math.max(0.5, BR.warmup - view.t);
    const stats = view.br?.stats ?? old?.stats ?? null;
    const byIndex = i => (i >= 0 ? sim.players[i]?.id ?? null : null);
    this.squadsOut = new Map();
    sim.players.forEach((p, i) => {
      const v = view.players[i], b = p.br, ps = p.ps;
      if (!b || !v) return;
      p.alive = !!v.alive;                     // A held (away) human's character stays on the field in battle royale.
      b.armor = v.brArmor ?? 0;
      p.brAir = v.air ?? 0;
      b.out = !!v.out; b.place = v.place ?? 0;
      if (b.out) this.squadsOut.set(p.team, b.place);
      p.downed = !!v.downed && p.alive;
      b.reviveT = p.downed ? (v.reviveK ?? 0) * BR.reviveTime : 0;
      if (p.downed) { p.hp = Math.max(1, v.hp ?? BR.downHp); ps.sprinting = false; }
      b.landed = p.brAir === 0;
      const st = stats?.[i];
      if (st) { b.dmg = st[0]; b.revives = st[1]; b.knocks = st[2]; }
      const e = p.alive ? bk?.[5]?.[i] : null;
      if (!p.alive) { b.guns = [null, null]; b.plates = 0; b.meds = 0; b.kits = 0; b.pouch = [0, 0, 0, 0, 0]; b.stash = null; }
      if (e) {
        [b.plates, b.meds, b.kits] = e;
        const weapon = ps.weapon;
        for (const s of [0, 1]) {
          const g = e[3 + s];
          const id = g ? WEAPON_IDS[g[0]] : null;
          if (id && WEAPONS[id]) {
            const kit = unpackKit(id, g[2]);
            b.guns[s] = { id, r: g[1], kit };
            brArm(ps, s, id, kit, g[1], e[5 + s * 2], e[6 + s * 2]);
            p.kits[s] = kit;
          } else { b.guns[s] = null; brArm(ps, s, KNIFE); }
        }
        // Back in the hand the snapshot showed.
        ps.slot = weapon === ps.secondary && weapon !== ps.primary ? 1 : 0;
        ps.weapon = ps.slot ? ps.secondary : ps.primary;
        ps.swapT = 0; ps.cooldown = 0;
        p.primary = ps.primary;
        b.downedBy = byIndex(e[9]); b.useK = USE_KINDS[e[10]] ?? null; b.useT = e[11] / 10;
        b.useDur = b.useK === 'plate' ? BR.plateTime : b.useK === 'med' ? BR.medTime : b.useK === 'self' ? BR.selfRevive : 0;
        if (p.brAir) { b.glideT = e[12] / 10; b.jumpAt = e[13] / 1000; b.dropX = e[14]; b.dropZ = e[15]; b.follow = byIndex(e[16]); }
        b.pouch = Array.isArray(e[21]) ? e[21].slice(0, 5) : [0, 0, 0, 0, 0];
        b.stash = null;
        const fs = e[22] ?? -1;
        if ((fs === 0 || fs === 1) && b.guns[fs]) {
          b.stash = { slot: fs, ammo: ps.ammo[fs], res: ps.reserve[fs] };
          brArm(ps, fs, KNIFE);
          if (weapon === KNIFE || ps.slot === fs) { ps.slot = fs; ps.weapon = KNIFE; }
        }
      }
      if (b.follow) { const k = sim.players.filter(q => q.br?.follow === b.follow).indexOf(p); const a = (k / 3) * Math.PI * 2; b.offX = Math.cos(a) * FOLLOW_GLIDE; b.offZ = Math.sin(a) * FOLLOW_GLIDE; }
    });
    // This phone's own pack is fresher in its own inventory block.
    const me = sim.byId.get(view.localId), inv = view.br?.inv;
    if (me?.br && inv) { me.br.plates = inv.plates; me.br.meds = inv.meds; me.br.kits = inv.kits; }
    this._fillView();
  }

  encode() { return this.encodeFor(null); }

  // A guest takes in a block: the mirror of the loot table, the circle and everyone's state. Fills view.br and the
  // per-player fields on view.players.
  decode(a, view) {
    const players = view.players;
    if (!a) { this._fillView(); view.br = this.view; return; }
    const [f, cx, cz, cr, nx, nz, nr, phase, state, timer, squads, alive, fx, fz, tx, tz, per, inv, ch, stats, backup] = a;
    if (backup) {                              // Kept for a host migration (restore); halves merge into one.
      const old = this.saved?.[5];
      if (old) backup[5] = backup[5].map((e, i) => e || old[i] || 0);
      this.saved = backup;
    }
    this.plane.f = f / 1000;
    this.plane.fx = fx; this.plane.fz = fz; this.plane.tx = tx; this.plane.tz = tz;
    this.plane.len = Math.hypot(tx - fx, tz - fz) || 1;
    this.circle = { x: cx / 10, z: cz / 10, r: cr / 10 };
    this.next = { x: nx / 10, z: nz / 10, r: nr / 10 };
    this.phase = phase; this.state = state === 0 ? 'wait' : state === 1 ? 'shrink' : 'final'; this.timer = timer / 10;
    if (ch) this.applyChanges(ch);
    if (stats) this.stats = stats;
    for (let i = 0; i < players.length; i++) {
      const v = per?.[i] ?? 0, q = players[i];
      q.brArmor = v & 255; q.downed = !!(v & 256); q.air = (v >> 9) & 3; q.reviveK = ((v >> 11) & 15) / 15; q.out = !!(v & 32768); q.place = (v >> 16) & 63;
    }
    const V = this.view;
    V.plane = { ...this.plane, ...planeAt(this.plane, this.plane.f) };
    V.circle = this.circle; V.next = this.next; V.phase = this.phase; V.state = this.state; V.timer = this.timer;
    V.squadsLeft = squads; V.alive = alive; V.items = this.items; V.stats = this.stats; V.t = this.t;
    V.inv = inv ? { plates: inv[0], meds: inv[1], kits: inv[2], use: USE_KINDS[inv[3]] ?? null, useT: inv[4] / 10, useDur: inv[5] / 10, rarity: [inv[6], inv[7]], pouch: inv[8] ?? null, fists: inv[9] ?? -1 } : null;
    V.squad = this.squad;
    view.br = V;
  }

  // The host's own view, straight from the rules.
  hostView(view) {
    const players = view.players, sim = this.sim;
    for (let i = 0; i < players.length && i < sim.players.length; i++) {
      const p = sim.players[i], q = players[i], b = p.br;
      q.brArmor = b ? Math.ceil(b.armor) : 0; q.downed = !!p.downed; q.air = p.brAir | 0;
      q.reviveK = p.downed && b ? (b.useK === 'self' ? 1 - b.useT / BR.selfRevive : b.reviveT / BR.reviveTime) : 0;
      q.out = !!b?.out; q.place = b?.place ?? 0;
    }
    const V = this.view;
    V.plane = { ...this.plane, ...planeAt(this.plane, this.plane.f) };
    V.circle = { ...this.circle }; V.next = { ...this.next }; V.phase = this.phase; V.state = this.state; V.timer = this.timer;
    V.squadsLeft = this._squadsIn().size; V.alive = sim.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
    V.items = this.items; V.t = this.t; V.squad = this.squad;
    V.stats = sim.tick % 30 === 0 || sim.phase === 'ended' || !V.stats ? this._stats() : V.stats;
    const me = sim.byId.get(view.localId);
    const inv = me && this._inv(me);
    V.inv = inv ? { plates: inv[0], meds: inv[1], kits: inv[2], use: USE_KINDS[inv[3]] ?? null, useT: inv[4] / 10, useDur: inv[5] / 10, rarity: [inv[6], inv[7]], pouch: inv[8] ?? null, fists: inv[9] ?? -1 } : null;
    view.br = V;
  }

  applyChanges(flat) {
    for (let i = 0; i < flat.length;) {
      const op = flat[i + 1], id = flat[i + 2];
      if (op === 0) {
        this.gone.add(id);
        const it = this.items[id];
        if (it) this._removeItem(it, false);
        i += 3;
      } else {
        const [, , , kind, v, r, n, x, z, kit] = flat.slice(i, i + 10);
        i += 10;
        if (this.gone.has(id) || this.items[id]) continue;
        const gun = kind === K.gun ? WEAPON_IDS[v] : null;
        this._addItem({ kind, v, r, n, x: x / 10, z: z / 10, kit: gun ? unpackKit(gun, kit) : NO_ATTACHMENTS }, false, id);
      }
    }
  }
}

// What an item is called on screen.
export function itemName(it) {
  if (!it) return '';
  switch (BR_KINDS[it.kind]) {
    case 'gun': return WEAPONS[WEAPON_IDS[it.v]]?.name ?? 'Gun';
    case 'ammo': return AMMO_NAMES[AMMO_TYPES[it.v]];
    case 'plate': return it.n > 1 ? `${it.n} Armor plates` : 'Armor plate';
    case 'med': return 'Medkit';
    case 'kit': return 'Self-revive kit';
    case 'lethal': return LETHALS[LETHAL_IDS[it.v]]?.name ?? 'Lethal';
    case 'tactical': return TACTICALS[TACTICAL_IDS[it.v]]?.name ?? 'Tactical';
    case 'chest': return 'Supply cache';
  }
  return '';
}

// The nearest ground gun the local player could tap to take, from a view (any phone).
export function takeable(view, me) {
  const items = view?.br?.items;
  if (!items || !me || !me.alive || me.downed || me.air) return null;
  let best = null, bestD = BR.take;
  // Scan the loot grid cells around the player only.
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || it.kind !== K.gun) continue;
    const dx = it.x - me.x, dz = it.z - me.z;
    if (dx > bestD || dx < -bestD || dz > bestD || dz < -bestD) continue;
    const d = Math.hypot(dx, dz);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

export const BR_KIND = K;
export { FFA_TEAM };
