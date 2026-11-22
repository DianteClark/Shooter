// Conquest and Breakthrough (ROADMAP 65, docs/MODES.md "Conquest and Breakthrough"): the numbers both rule sets share,
// and the layouts they play on. Pure data and geometry, no nav and no DOM: the host, every phone, the HUD, the renderer
// and the bots all read the same layout from the map and the match seed, so nothing about it rides the wire.
//
// A map declares its layouts in `map.bf` (any map: a Ground War map, a battle royale island's part, a district map):
//
//   map.bf = {
//     conquest: [{
//       id, name,                         // 'downtown', 'Downtown' (the HUD's intro names it)
//       area: { x, z, w, h },             // the playable rectangle; outside it is out of bounds. Omit: the whole map
//       hq: [{ x, z, r }, { x, z, r }],   // each team's HQ (team 0, team 1): always a spawn, never capturable
//       flags: [{ id, x, z, r }],         // 5 to 7 flags, ids 'A'.. in reading order; r the capture radius (5 to 7 m)
//       tickets,                          // optional: each team's pool (default BF.cq.tickets by flag count)
//     }],
//     breakthrough: [{
//       id, name, area,
//       hq: [{ x, z, r }, { x, z, r }],   // hq[0] the attackers' end, hq[1] the defenders' last stand
//       sectors: [{ name, objs: [{ id, x, z, r }] }],   // 3 or 4 sectors from hq[0] toward hq[1], 1 or 2 objectives each
//       tickets, refill,                  // optional: the attackers' starting pool and what each fallen sector adds
//       clock, defendDelay,               // optional: seconds a sector and extra seconds a defender waits to respawn
//                                         // (default 300 and 0 on a whole map, 420 and 1.5 on a part of a big one)
//     }],
//   };
//
// Front lines are not data: each lies across the attack axis (hq[0] to hq[1]) halfway between one sector's farthest
// objective and the next sector's nearest, so a map only places objectives. A map with no `bf` but at least three
// Domination flags and two spawn lists (every Ground War map) gets layouts derived from those (`derived` below).
// Which side attacks in Breakthrough, and which layout a map with several plays, come from the match seed.

export const BF = {
  // Flags and objectives. A flag is taken in `capture` seconds by one player from neutral; from the enemy it is
  // neutralised first (the same again). More of a side on it is faster (`crowd`, indexed by how many more than the
  // other side stand there, capped at the last entry). Both sides on it with equal numbers: contested, nothing moves.
  capture: 10,
  crowd: [0, 1, 1.5, 1.85, 2.1, 2.3],
  radius: 5.5,              // A derived flag's radius at least this (Domination flags are drawn for six players a side).
  oob: 8,                   // Seconds outside the play area before it kills you.
  ret: 3,                   // Seconds back inside before the warning clears.
  cq: {
    // Tickets each side starts with, by flag count (more flags, bigger map, longer match).
    tickets: { 3: 600, 4: 700, 5: 850, 6: 950, 7: 1050 },
    death: 1,               // A death spends one of your side's tickets.
    // Bleed: the side holding more flags drains the other's pool, per second, by how many more (index: lead).
    bleed: [0, 0.5, 1.0, 1.5, 2.0, 2.6, 3.2, 4.0],
    allBleed: 2,          // Extra when one side holds every flag.
    safe: 22,               // No spawning on a flag with an enemy this close.
    hqSpawn: 9,             // An HQ spawns within this of its centre.
    flagSpawn: [6, 13],     // A flag spawns within this ring round it (metres from the flag).
    capScore: 200, neutralScore: 100, defendScore: 75,
    low: 50,                // The "tickets low" warning fires once at this.
  },
  bt: {
    tickets: 360,           // The attackers' pool to start, and what a fallen sector adds (scaled by sector count).
    refill: 260,
    margin: 10,             // How far past their line each side may go before the out-of-bounds clock starts.
    fallBack: 12,           // Defenders caught behind a fallen line get this long to get out, not the usual 8 s.
    capture: 25,            // An objective is slower to take than a Conquest flag (one player, from neutral).
    capTime: 60,            // An objective taken by the attackers puts this back on the sector clock (up to a full clock).
    lock: 12,               // After a sector falls, the next one's objectives cannot be taken for this long (regroup).
    // Spawns, in metres along the axis: attackers this far short of the sector's nearest objective (never past the line
    // behind it), defenders this far behind its farthest one, so both sides walk about as far to the fight.
    attackBand: [18, 34],
    defendBand: [14, 30],
    clear: 16,              // ...and no nearer than this to a live objective.
    retake: 0.55,           // The share of the defenders sent to take back a lost objective (the rest hold the other).
    flank: 22,              // Attackers off the middle gather this far to one side of the axis...
    flankBack: 16,          // ...this far short of the objective, then close in (js/sim/breakthrough.js plan).
    flankFrom: 30,          // Only from further back than this along the axis.
    push: 28,               // Bots this close to an objective they are taking push onto it (js/sim/breakthrough.js plan).
    capScore: 250, sectorScore: 300, defendScore: 75,
    low: 25,
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// The integer hash the layouts and sides are picked with: stable, cheap, the same on every phone.
export function bfHash(seed, salt) {
  let h = ((seed >>> 0) ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const centroid = list => ({ x: list.reduce((a, s) => a + s.x, 0) / list.length, z: list.reduce((a, s) => a + s.z, 0) / list.length });
const fullArea = map => ({ x: 0, z: 0, w: map.width, h: map.height });

// Layouts a map has of a kind: its own, else derived from its Domination flags and spawns. Cached on the map object.
export function bfLayouts(map, kind) {
  if (!map) return [];
  const cache = map._bfLayouts ??= {};
  if (cache[kind]) return cache[kind];
  const own = map.bf?.[kind];
  const list = own?.length ? own.map(l => normalize(map, kind, l)) : derived(map, kind);
  return (cache[kind] = list);
}

// The layout a match plays: one of the map's, picked by the seed.
export function bfLayout(map, kind, seed) {
  const list = bfLayouts(map, kind);
  return list.length ? list[bfHash(seed, kind === 'conquest' ? 0x0c0a : 0xb7a1) % list.length] : null;
}

// Breakthrough's attacking side, from the seed.
export const btAttackers = seed => bfHash(seed, 0xa77a) & 1;

function derived(map, kind) {
  const dom = map.points?.dom ?? [];
  if (dom.length < 3 || !map.spawns?.[0]?.length || !map.spawns?.[1]?.length) return [];
  const hq = [0, 1].map(t => {
    const c = centroid(map.spawns[t]);
    const r = Math.max(4, ...map.spawns[t].map(s => Math.hypot(s.x - c.x, s.z - c.z))) + 2;
    return { x: c.x, z: c.z, r, spawns: map.spawns[t] };
  });
  const flags = dom.map(d => ({ id: d.id, x: d.x, z: d.z, r: Math.max(d.r ?? 4, BF.radius) }));
  if (kind === 'conquest') return [normalize(map, kind, { id: map.id, name: map.name, area: fullArea(map), hq, flags })];
  // Breakthrough: the flags in order along the axis, grouped 1-2 to a sector.
  const ax = hq[1].x - hq[0].x, az = hq[1].z - hq[0].z, len = Math.hypot(ax, az) || 1;
  const along = f => ((f.x - hq[0].x) * ax + (f.z - hq[0].z) * az) / len;
  const order = flags.slice().sort((a, b) => along(a) - along(b));
  const groups = { 3: [1, 1, 1], 4: [1, 2, 1], 5: [2, 1, 2], 6: [2, 2, 2], 7: [2, 1, 2, 2] }[order.length] ?? Array.from({ length: Math.ceil(order.length / 2) }, (_, i) => Math.min(2, order.length - i * 2));
  const names = ['Outskirts', 'Middle', 'Inner', 'Last Stand'];
  let k = 0;
  const sectors = groups.map((n, i) => ({ name: i === groups.length - 1 ? 'Last Stand' : names[i], objs: order.slice(k, k += n) }));
  // Objectives are lettered per match in the order they come up, A and B a sector.
  return [normalize(map, kind, { id: map.id, name: map.name, area: fullArea(map), hq, sectors })];
}

// Fills in what a declared layout leaves out and works out Breakthrough's axis and lines.
function normalize(map, kind, l) {
  const area = l.area ? { ...l.area } : fullArea(map);
  const hq = l.hq.map(h => ({ x: h.x, z: h.z, r: h.r ?? BF.cq.hqSpawn, spawns: h.spawns ?? null }));
  const out = { kind, id: l.id ?? map.id, name: l.name ?? map.name, area, hq, sub: !!l.area && (area.w < map.width - 1 || area.h < map.height - 1) };
  if (kind === 'conquest') {
    out.flags = l.flags.map((f, i) => ({ id: f.id ?? String.fromCharCode(65 + i), x: f.x, z: f.z, r: f.r ?? BF.radius, name: f.name ?? null }));
    out.tickets = l.tickets ?? BF.cq.tickets[clamp(out.flags.length, 3, 7)];
    return out;
  }
  const ox = hq[0].x, oz = hq[0].z, ax = hq[1].x - ox, az = hq[1].z - oz, len = Math.hypot(ax, az) || 1;
  out.axis = { ox, oz, dx: ax / len, dz: az / len, len };
  let n = 0;
  out.sectors = l.sectors.map((s, i) => ({
    name: s.name ?? `Sector ${i + 1}`,
    objs: s.objs.map((o, j) => ({ id: o.id ?? String.fromCharCode(65 + n++), x: o.x, z: o.z, r: o.r ?? BF.radius, name: o.name ?? null, sector: i, slot: j })),
  }));
  // Re-letter in play order: the first sector's are A and B, the next C, and so on.
  n = 0;
  for (const s of out.sectors) for (const o of s.objs) o.id = String.fromCharCode(65 + n++);
  const proj = o => (o.x - ox) * out.axis.dx + (o.z - oz) * out.axis.dz;
  for (const s of out.sectors) { s.min = Math.min(...s.objs.map(proj)); s.max = Math.max(...s.objs.map(proj)); }
  // lines[i]: the line between sector i and i + 1 (in metres along the axis).
  out.lines = out.sectors.slice(0, -1).map((s, i) => (s.max + out.sectors[i + 1].min) / 2);
  const k = out.sectors.length;
  out.tickets = l.tickets ?? Math.round(BF.bt.tickets * (k <= 3 ? 1 : 0.85));
  out.refill = l.refill ?? Math.round(BF.bt.refill * (k <= 3 ? 1 : 0.85));
  // A part of a big map (a battle royale island, a city) takes longer to cross: a longer sector clock and a beat more
  // on the defenders' respawn unless the layout says otherwise.
  out.clock = l.clock ?? (out.sub ? 420 : null);
  out.defendDelay = l.defendDelay ?? (out.sub ? 1.5 : 0);
  return out;
}

// ---- Geometry helpers both rule sets, the HUD and the renderer use ----

export const inArea = (a, x, z, pad = 0) => x >= a.x - pad && x <= a.x + a.w + pad && z >= a.z - pad && z <= a.z + a.h + pad;

// Metres along a Breakthrough layout's axis.
export const along = (l, x, z) => (x - l.axis.ox) * l.axis.dx + (z - l.axis.oz) * l.axis.dz;

// The sector band [lo, hi] along the axis: lo the line behind it (toward the attackers), hi the one ahead.
export function sectorBand(l, i) {
  return { lo: i > 0 ? l.lines[i - 1] : -Infinity, hi: i < l.lines.length ? l.lines[i] : Infinity };
}

// The segment of a front line (s metres along the axis) inside the layout's area, for drawing: [x0, z0, x1, z1].
export function lineSegment(l, s) {
  const { ox, oz, dx, dz } = l.axis, px = ox + dx * s, pz = oz + dz * s, tx = -dz, tz = dx;
  let t0 = -1e4, t1 = 1e4;
  const a = l.area;
  const clip = (p, d, lo, hi) => {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) t0 = 1, t1 = 0; return; }
    let u = (lo - p) / d, v = (hi - p) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
  };
  clip(px, tx, a.x, a.x + a.w);
  clip(pz, tz, a.z, a.z + a.h);
  if (t1 <= t0) return null;
  return [px + tx * t0, pz + tz * t0, px + tx * t1, pz + tz * t1];
}

// Whether a mode id is one of these two (by rule set).
export const isBf = rules => rules === 'cq' || rules === 'bt';
