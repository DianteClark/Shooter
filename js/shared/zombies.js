// Graveyard Shift (ROADMAP item 26, docs/ZOMBIES.md): co-op wave survival for up to four. The numbers, the round
// formulas and each map's layout (fences, doors, wall-buys, the mystery crate's spots, perk machines, zombie risers),
// shared by the sim (js/sim/zombies.js), the renderer (js/render/zm-fx.js), the HUD (js/ui/zm-hud.js) and the tests.
// Pure data and functions: no DOM, runs in node, and every phone builds the same layout from the map alone.
//
// Layout model: a map is cut into bands by full-height fences on vertical lines (`cuts`). Each fence line is fenced
// across every open run it crosses except one, which takes a door; buying the door opens the next band. Players start
// in band `start`. Everything placed (wall-buys, crate spots, machines, risers) sits on open floor reachable inside its
// band, found from the map's walls on a 1 m grid, so the layout is the same on the host and every guest.
import { PLAYER_RADIUS } from './constants.js';
import { wallsInBox } from './geometry.js';

export const ZM_TEAM = 1;              // The horde's side; players (humans and bot teammates) are team 0.
export const ZM_SQUAD = 4;             // Seats on the players' side, bots filling what humans do not take.

export const ZM = {
  seats: 24,                           // Zombie seats in the roster: the cap on live zombies (phone budget).
  warmup: 6,                           // Seconds before round 1.
  between: 10,                         // Seconds between rounds.
  startPts: 500,
  pts: { hit: 10, kill: 60, head: 100, melee: 130, boss: 1500, revive: 100, nuke: 400 },
  bleed: 30,                           // Seconds a downed player bleeds out over.
  reviveTime: 4, reviveFast: 2,        // Mercy Run halves it.
  reviveReach: 1.9, reviveHp: 60,
  useReach: 2.2,                       // A player this close to a door, wall-buy, crate or machine can use it.
  // The mystery crate: pay, it rolls, then offers one gun to whoever paid for a while. After `moveAfter` rolls (a range)
  // a roll comes up empty: the money back, and the crate moves to another spot.
  box: { cost: 950, roll: 3, offer: 9, moveAfter: [4, 8], away: 6 },
  doorCost: [750, 1000, 1250, 1500, 1750],
  // Power-ups: a kill drops one now and then (at most `perRound` a round); they wait `life` s on the ground.
  drop: { chance: 0.03, perRound: 4, life: 25, reach: 1.6, double: 30 },
  // Zombies by kind: health and damage multipliers, stick speed (of a run), melee reach and windup.
  kinds: {
    shambler: { hp: 1, dmg: 40, speed: 0.36, reach: 1.25, windup: 0.45, cool: 1.1 },
    runner: { hp: 0.85, dmg: 36, speed: 0.84, reach: 1.25, windup: 0.4, cool: 1 },
    brute: { hp: 4, dmg: 70, speed: 0.5, reach: 1.5, windup: 0.6, cool: 1.4 },
    boss: { hp: 22, dmg: 90, speed: 0.62, reach: 1.9, windup: 0.7, cool: 1.5 },
  },
  roundMax: 220,                       // Zombies in one round, at most.
  xp: { kill: 12, head: 4, round: 120, boss: 400 },     // Account XP in place of the usual kill lines (awards.js).
  weaponXp: 0.3,                       // Share of the usual weapon XP a zombie kill pays.
};
export const ZM_KINDS = ['shambler', 'runner', 'brute', 'boss'];
export const ZM_KIND_NAMES = { shambler: 'Shambler', runner: 'Runner', brute: 'Brute', boss: 'Yardmaster' };

// Perk machines, our own: what each does is applied by the host (js/sim/zombies.js), Quickdraw also on the phone.
export const ZM_PERKS = {
  iron: { id: 'iron', name: 'Ironhide', cost: 2500, color: 0xd8402e, css: '#d8402e', desc: 'Take half damage from the undead' },
  quick: { id: 'quick', name: 'Quickdraw', cost: 3000, color: 0x3fb2ff, css: '#3fb2ff', desc: 'Faster reloads and swaps' },
  mercy: { id: 'mercy', name: 'Mercy Run', cost: 1500, color: 0x4fd36a, css: '#4fd36a', desc: 'Revive teammates twice as fast' },
  hammer: { id: 'hammer', name: 'Hammerfall', cost: 2000, color: 0xf2b630, css: '#f2b630', desc: 'Every round hits 50% harder' },
};
export const ZM_PERK_IDS = ['iron', 'quick', 'mercy', 'hammer'];
export const ZM_POWERUPS = ['ammo', 'double', 'nuke'];
export const ZM_POWERUP_NAMES = { ammo: 'Full Crate', double: 'Double Pay', nuke: 'Clean Sweep' };

// Wall-buy guns by how deep the band is (0: the start), two per band; prices CoD-ish, ammo is 40% of the gun.
const WALL_GUNS = [
  [['smg', 1000], ['shotgun', 900]],
  [['ar', 1200], ['pdw', 1100], ['dmr', 1000]],
  [['heavyar', 1500], ['autoshot', 1500], ['carbine', 1300]],
  [['lmg', 1800], ['heavysmg', 1400], ['battle', 1600]],
  [['saw', 1800], ['slug', 1500]],
];
export const ammoCost = cost => Math.round(cost * 0.4 / 10) * 10;
// What the crate can hand out: the specialists, the heavy hitters and a few sidearms. Never the start pistol.
export const BOX_GUNS = ['rotary', 'beltlmg', 'drumsmg', 'heavysmg', 'lightlmg', 'saw', 'rampar', 'heatar', 'magshot', 'flechette', 'slug', 'lever', 'battle',
  'twinshot', 'revolver', 'akimbo', 'thumper', 'launcher', 'salvo', 'crossbow', 'semisnipe', 'rail', 'antimat', 'carbine', 'tacsmg', 'hushsmg', 'burst', 'coach',
  'scatter', 'deuce', 'maul', 'heavyar', 'lmg', 'autoshot'];
export const START_GUN = 'pistol';
export const NO_GUN = 'knife';

// ---- Rounds ----

// Zombies in round r (1-based). Four seats always (bots fill), so no player scaling.
export function roundCount(r) {
  const base = r <= 5 ? [6, 9, 12, 16, 20][r - 1] : Math.round(0.15 * r * r + 2.3 * r + 8);
  return Math.min(ZM.roundMax, isBossRound(r) ? Math.round(base * 0.6) : base);
}
// A shambler's health in round r: linear to round 9, then 6% more a round.
export function roundHp(r) {
  return Math.round(r <= 9 ? 120 + 70 * (r - 1) : 680 * Math.pow(1.06, r - 9));
}
export const isBossRound = r => r > 0 && r % 10 === 0;
// The mix: runners from round 3 (most of the horde by round 12), brutes from round 5, never more than a few at once.
export function roundMix(r) {
  const runner = Math.max(0, Math.min(0.75, (r - 2) * 0.08));
  const brute = r < 5 ? 0 : Math.min(0.12, 0.03 + (r - 5) * 0.01);
  return { runner, brute };
}
// Seconds between spawns, and a shambler's pace bonus as rounds go on.
export const spawnGap = r => Math.max(0.45, 2.1 - 0.11 * r);
export const paceBonus = r => Math.min(0.12, r * 0.01);

// ---- Map layouts ----

// The maps that host the mode and how each is cut. `cuts`: fence lines (x, metres); `doors`: the z each door is
// centred near (one per cut, the open run nearest it takes the door); `start`: the band players start in.
export const ZM_MAPS = {
  neon: { cuts: [21.5, 42.0], doors: [22, 22], start: 1 },
  ruins: { cuts: [14.5, 37.5], doors: [17, 17], start: 1 },
  foundry: { cuts: [16.5, 38.5, 64.5, 86.5], doors: [31, 31, 31, 31], start: 2 },
  // A purpose-built map (ROADMAP item 38): its layout is declared on the map itself (`map.zm`, the graph form: areas
  // joined by gates in a loop; see graphLayout). `power`: the perk machines are dark until someone throws the switch.
  ashgrove: { graph: true, power: true },
};
export const ZM_MAP_IDS = Object.keys(ZM_MAPS);

const FENCE_T = 0.4, FENCE_H = 2.4, DOOR_H = 2.6, DOOR_MAX = 4;
const CELL = 1;
const CLEAR = PLAYER_RADIUS + 0.2;

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// The map's own movement blockers (never the mode's), as rects.
function baseWalls(map) {
  return map.walls.filter(w => w.blocksMove && !w.zm);
}
function hits(walls, x0, z0, x1, z1) {
  for (const w of walls) if (w.x < x1 && w.x + w.w > x0 && w.z < z1 && w.z + w.d > z0) return true;
  return false;
}

// Open runs along the fence line x = X: [z0, z1] spans a player could walk across.
function openRuns(map, walls, X) {
  const runs = [];
  const step = 0.25;
  let start = null;
  for (let z = 0; z <= map.height; z += step) {
    const open = z > CLEAR && z < map.height - CLEAR && !hits(walls, X - 0.3, z, X + 0.3, z + step);
    if (open && start === null) start = z;
    if ((!open || z + step > map.height) && start !== null) { if (z - start > 0.6) runs.push([start, z]); start = null; }
  }
  return runs;
}

// The layout for a map (cached on the map object, per walls list): fences and doors as wall rects, bands, and every
// placed thing. Null for a map that does not host the mode.
export function zmLayout(map) {
  const def = map && ZM_MAPS[map.id];
  if (!def) return null;
  if (map._zmLayout) return map._zmLayout;
  if (def.graph) return graphLayout(map, def);
  const walls = baseWalls(map);
  const rng = mulberry32(hashStr(`zm:${map.id}`));
  const fences = [], doors = [];
  def.cuts.forEach((X, k) => {
    const runs = openRuns(map, walls, X);
    let best = 0, bestD = Infinity;
    runs.forEach(([a, b], i) => {
      const mid = (a + b) / 2, d = Math.abs(mid - def.doors[k]) - Math.min(b - a, 6) * 0.3;
      if (d < bestD && b - a >= 2) { bestD = d; best = i; }
    });
    runs.forEach(([a, b], i) => {
      if (i !== best) { fences.push({ x: X - FENCE_T / 2, z: Math.max(0, a - 0.5), w: FENCE_T, d: Math.min(map.height, b + 0.5) - Math.max(0, a - 0.5), cut: k }); return; }
      const mid = (a + b) / 2, half = Math.min(DOOR_MAX, b - a) / 2;
      const d0 = mid - half, d1 = mid + half;
      doors.push({ i: k, x: X - FENCE_T / 2, z: d0, w: FENCE_T, d: d1 - d0, cx: X, cz: mid, cut: k, cost: 0 });
      if (d0 - a > 0.05) fences.push({ x: X - FENCE_T / 2, z: Math.max(0, a - 0.5), w: FENCE_T, d: d0 - Math.max(0, a - 0.5), cut: k });
      if (b - d1 > 0.05) fences.push({ x: X - FENCE_T / 2, z: d1, w: FENCE_T, d: Math.min(map.height, b + 0.5) - d1, cut: k });
    });
  });
  // Bands: [x0, x1) between cuts. Depth = cuts crossed from the start band; a door's price follows the band it opens.
  const xs = [0, ...def.cuts, map.width];
  const bands = [];
  for (let i = 0; i < xs.length - 1; i++) bands.push({ i, x0: xs[i], x1: xs[i + 1], depth: Math.abs(i - def.start), cells: [] });
  for (const d of doors) {
    // Cut k joins band k and k + 1; the far side from the start is the band it opens.
    d.opens = d.cut + 1 > def.start ? d.cut + 1 : d.cut;
    d.from = d.opens === d.cut + 1 ? d.cut : d.cut + 1;
    d.cost = ZM.doorCost[Math.min(ZM.doorCost.length - 1, bands[d.opens].depth - 1)];
  }

  // Floor: 1 m cells clear of the map's walls and the fences (doors count as closed), reachable within the band from
  // its biggest piece.
  const W = Math.ceil(map.width / CELL), H = Math.ceil(map.height / CELL);
  const all = [...walls, ...fences.map(f => ({ ...f })), ...doors.map(d => ({ ...d }))];
  const free = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = i + 0.5, z = j + 0.5;
      if (x < 1.2 || z < 1.2 || x > map.width - 1.2 || z > map.height - 1.2) continue;
      if (!hits(all, x - CLEAR, z - CLEAR, x + CLEAR, z + CLEAR)) free[j * W + i] = 1;
    }
  }
  const band = new Int8Array(W * H).fill(-1);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!free[j * W + i]) continue;
    const x = i + 0.5;
    band[j * W + i] = bands.findIndex(b => x >= b.x0 && x < b.x1);
  }
  const main = new Uint8Array(W * H);
  for (const b of bands) {
    const seen = new Uint8Array(W * H);
    let biggest = [];
    for (let k = 0; k < W * H; k++) {
      if (band[k] !== b.i || seen[k]) continue;
      const comp = [k], stack = [k];
      seen[k] = 1;
      while (stack.length) {
        const c = stack.pop(), ci = c % W, cj = (c - ci) / W;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const n = nj * W + ni;
          if (seen[n] || band[n] !== b.i) continue;
          seen[n] = 1; comp.push(n); stack.push(n);
        }
      }
      if (comp.length > biggest.length) biggest = comp;
    }
    for (const k of biggest) main[k] = 1;
    b.cells = biggest;
    let sx = 0, sz = 0;
    for (const k of biggest) { sx += k % W + 0.5; sz += Math.floor(k / W) + 0.5; }
    b.cx = biggest.length ? sx / biggest.length : (b.x0 + b.x1) / 2;
    b.cz = biggest.length ? sz / biggest.length : map.height / 2;
  }
  const cellAt = (x, z) => Math.floor(z) * W + Math.floor(x);

  // Spots against a tall wall: an open floor cell with vision-blocking wall within 1.1 m on one side; `face` is the
  // direction from the wall to the floor (the mark is drawn on the wall at wx, wz).
  const tall = map.walls.filter(w => w.blocksVision && w.blocksMove && w.kind !== 'border' && !w.zm);
  const nearDoor = (x, z, r) => doors.some(d => Math.hypot(d.cx - x, d.cz - z) < r);
  const wallSpots = b => {
    const out = [];
    for (const k of b.cells) {
      const x = k % W + 0.5, z = Math.floor(k / W) + 0.5;
      if (x < b.x0 + 1.5 || x > b.x1 - 1.5) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const wx = x + dx * 1.1, wz = z + dz * 1.1;
        if (!hits(tall, wx - 0.05, wz - 0.05, wx + 0.05, wz + 0.05)) continue;
        // The face itself: step back from the wall point toward the cell until clear.
        let fx = wx, fz = wz;
        for (let s = 0; s < 12 && hits(tall, fx - 0.02, fz - 0.02, fx + 0.02, fz + 0.02); s++) { fx -= dx * 0.1; fz -= dz * 0.1; }
        out.push({ x, z, wx: fx, wz: fz, face: Math.atan2(-dz, -dx) });
        break;
      }
    }
    return out;
  };
  const pickSpread = (cands, n, taken, cx, cz, minGap = 7) => {
    const out = [];
    const order = cands.map(c => ({ c, s: Math.hypot(c.x - cx, c.z - cz) * 0.35 + rng() * 6 })).sort((a, b) => a.s - b.s).map(o => o.c);
    for (const c of order) {
      if (out.length >= n) break;
      if ([...taken, ...out].some(t => Math.hypot(t.x - c.x, t.z - c.z) < minGap)) continue;
      if (nearDoor(c.x, c.z, 4)) continue;
      out.push(c);
    }
    return out;
  };

  const taken = [];
  const wallBuys = [], boxSpots = [], machines = [];
  const perkOrder = ['quick', 'mercy', 'hammer', 'iron'];
  const byDepth = [...bands].sort((a, b) => a.depth - b.depth || a.i - b.i);
  byDepth.forEach((b, n) => {
    const spots = wallSpots(b);
    const guns = WALL_GUNS[Math.min(WALL_GUNS.length - 1, b.depth)];
    const want = b.depth === 0 ? 2 : Math.min(2, guns.length);
    const picks = pickSpread(spots, want + 2, taken, b.cx, b.cz);
    picks.slice(0, want).forEach((s, k) => {
      const [gun, cost] = guns[(k + n) % guns.length];
      const wb = { i: wallBuys.length, band: b.i, gun, cost, ammo: ammoCost(cost), ...s };
      wallBuys.push(wb); taken.push(wb);
    });
    const rest = picks.slice(want);
    if (rest[0]) { const bs = { i: boxSpots.length, band: b.i, ...rest[0] }; boxSpots.push(bs); taken.push(bs); }
    if (machines.length < perkOrder.length) {
      const m = pickSpread(spots, 1, taken, b.cx, b.cz, 6)[0] ?? rest[1];
      if (m) { const mc = { i: machines.length, band: b.i, perk: perkOrder[machines.length], ...m }; machines.push(mc); taken.push(mc); }
    }
  });
  // Every machine is placed even on a small map: the deepest bands take the rest.
  for (let tries = 0; machines.length < perkOrder.length && tries < bands.length * 2; tries++) {
    const b = byDepth[byDepth.length - 1 - (tries % byDepth.length)];
    const m = pickSpread(wallSpots(b), 1, taken, b.cx, b.cz, 4)[0];
    if (m) { const mc = { i: machines.length, band: b.i, perk: perkOrder[machines.length], ...m }; machines.push(mc); taken.push(mc); }
  }

  // Risers: open cells on a 3 m lattice in each band, away from the doors.
  const risers = bands.map(b => b.cells.filter(k => {
    const i = k % W, j = Math.floor(k / W);
    return i % 3 === 1 && j % 3 === 1;
  }).map(k => ({ x: k % W + 0.5, z: Math.floor(k / W) + 0.5 })).filter(p => !nearDoor(p.x, p.z, 3)));

  // Player starts: open ground (every cell within 3 m clear: out in the yard, not in a room) nearest the start band's
  // middle; any floor if the band has no such ground.
  const sb = bands[def.start];
  const roomy = k => { const i = k % W, j = Math.floor(k / W); for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) if (!main[(j + dj) * W + i + di]) return false; return true; };
  const ground = sb.cells.filter(roomy);
  const pts = (ground.length >= 8 ? ground : sb.cells).map(k => ({ x: k % W + 0.5, z: Math.floor(k / W) + 0.5 }));
  const s0 = pts.reduce((b, p) => (Math.hypot(p.x - sb.cx, p.z - sb.cz) < Math.hypot(b.x - sb.cx, b.z - sb.cz) ? p : b), pts[0]);
  // The crew starts together: the three others nearest the first, a couple of metres apart.
  const starts = [];
  for (const p of pts.sort((a, b) => Math.hypot(a.x - s0.x, a.z - s0.z) - Math.hypot(b.x - s0.x, b.z - s0.z))) {
    if (starts.length < ZM_SQUAD && starts.every(q => Math.hypot(q.x - p.x, q.z - p.z) > 1.8)) starts.push(p);
  }

  const L = { mapId: map.id, def, start: def.start, bands, fences, doors, wallBuys, boxSpots, machines, risers, starts, W, H, main, band, cellAt };
  Object.defineProperty(map, '_zmLayout', { value: L, configurable: true, writable: true, enumerable: false });
  return L;
}

// ---- The graph form: a layout declared on the map (`map.zm`), for maps built for the mode ----
//
// Areas (each found by flooding out from its `seed` with every gate shut) joined by gates in any shape: a loop, side
// rooms, dead ends. Everything placed is named by the map: wall-buys, crate spots, machines, the power switch, the
// boss arena's spots, spawn windows (risers), starts and the spots kept for the economy (`reserved`, not used by the
// rules yet). Returns the same shape as the banded form, plus `graph`, `power`, `boss`, `reserved` and per door its
// two areas (`a`, `b`) and a stand point on each side (`stand[area]`).
const SIDE = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
function graphLayout(map, def) {
  const Z = map.zm;
  const walls = baseWalls(map);
  const W = Math.ceil(map.width / CELL), H = Math.ceil(map.height / CELL);
  const areaIdx = id => Z.areas.findIndex(a => a.id === id);
  const doors = Z.gates.map((g, i) => ({ i, x: g.x, z: g.z, w: g.w, d: g.d, cx: g.x + g.w / 2, cz: g.z + g.d / 2, a: areaIdx(g.a), b: areaIdx(g.b), cost: g.cost }));
  const all = [...walls, ...doors];
  const free = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = i + 0.5, z = j + 0.5;
      if (x < 1.2 || z < 1.2 || x > map.width - 1.2 || z > map.height - 1.2) continue;
      if (!hits(all, x - CLEAR, z - CLEAR, x + CLEAR, z + CLEAR)) free[j * W + i] = 1;
    }
  }
  const cellAt = (x, z) => Math.floor(z) * W + Math.floor(x);
  const band = new Int8Array(W * H).fill(-1), main = new Uint8Array(W * H);
  const bands = Z.areas.map((a, i) => {
    const s0 = cellAt(a.seed.x, a.seed.z), cells = [];
    if (free[s0] && band[s0] < 0) {
      const stack = [s0];
      band[s0] = i;
      while (stack.length) {
        const c = stack.pop(), ci = c % W, cj = (c - ci) / W;
        cells.push(c);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const n = nj * W + ni;
          if (!free[n] || band[n] >= 0) continue;
          band[n] = i; stack.push(n);
        }
      }
    }
    for (const k of cells) main[k] = 1;
    let sx = 0, sz = 0;
    for (const k of cells) { sx += k % W + 0.5; sz += Math.floor(k / W) + 0.5; }
    return { i, id: a.id, name: a.name, x0: 0, x1: map.width, depth: 0, cells, cx: cells.length ? sx / cells.length : a.seed.x, cz: cells.length ? sz / cells.length : a.seed.z };
  });
  const start = areaIdx(Z.start);
  // Depth: gates from the start area.
  const depth = bands.map(() => Infinity);
  depth[start] = 0;
  for (let q = [start]; q.length;) {
    const nq = [];
    for (const b of q) for (const d of doors) {
      const o = d.a === b ? d.b : d.b === b ? d.a : -1;
      if (o >= 0 && depth[o] === Infinity) { depth[o] = depth[b] + 1; nq.push(o); }
    }
    q = nq;
  }
  bands.forEach((b, i) => { b.depth = depth[i]; });
  // The area at a floor spot: its own cell, else the nearest cell of any area within 2 m.
  const bandAt = (x, z) => {
    const k = cellAt(x, z);
    if (band[k] >= 0) return band[k];
    let best = -1, bd = 4;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const n = k + dj * W + di;
      if (n >= 0 && n < W * H && band[n] >= 0 && di * di + dj * dj < bd) { bd = di * di + dj * dj; best = band[n]; }
    }
    return best;
  };
  for (const d of doors) {
    const across = d.w < d.d;                // A door in a north-south wall is crossed east-west.
    const sides = across ? [{ x: d.x - 1.2, z: d.cz }, { x: d.x + d.w + 1.2, z: d.cz }] : [{ x: d.cx, z: d.z - 1.2 }, { x: d.cx, z: d.z + d.d + 1.2 }];
    d.stand = {};
    for (const s of sides) { const b = bandAt(s.x, s.z); if (b >= 0) d.stand[b] = s; }
    const near = depth[d.a] <= depth[d.b] ? d.a : d.b;
    d.from = near; d.opens = near === d.a ? d.b : d.a;
  }
  // A spot against a wall: the wall point a mark is drawn on (wx, wz) and the way the face looks (face).
  const tall = map.walls.filter(w => w.blocksMove && w.kind !== 'border' && !w.zm);
  const onWall = s => {
    const [dx, dz] = SIDE[s.wall] ?? [0, 0];
    let wx = s.x, wz = s.z;
    for (let t = 0; t < 2; t += 0.02) {
      const px = s.x + dx * t, pz = s.z + dz * t;
      if (hits(tall, px - 0.01, pz - 0.01, px + 0.01, pz + 0.01)) break;
      wx = px; wz = pz;
    }
    return { x: s.x, z: s.z, wx, wz, face: Math.atan2(-dz, -dx), band: bandAt(s.x, s.z) };
  };
  const wallBuys = Z.wallBuys.map((s, i) => ({ i, gun: s.gun, cost: s.cost, ammo: ammoCost(s.cost), ...onWall(s) }));
  const boxSpots = Z.boxes.map((s, i) => ({ i, ...onWall(s) }));
  const machines = Z.machines.map((s, i) => ({ i, perk: s.perk, ...onWall(s) }));
  const risers = bands.map(() => []);
  for (const r of Z.risers) { const b = bandAt(r.x, r.z); if (b >= 0) risers[b].push({ x: r.x, z: r.z }); }
  const power = def.power && Z.power ? { ...onWall(Z.power) } : null;
  const boss = Z.boss ? { band: areaIdx(Z.boss.area), spots: Z.boss.spots.map(p => ({ x: p.x, z: p.z })) } : null;
  const reserved = {};
  for (const [k, v] of Object.entries(Z.reserved ?? {})) {
    reserved[k] = Array.isArray(v) ? v.map(p => ({ ...p, band: bandAt(p.x, p.z) })) : { ...(v.wall ? onWall(v) : { x: v.x, z: v.z }), ...v, band: bandAt(v.x, v.z) };
  }
  const L = {
    mapId: map.id, def, graph: true, start, bands, fences: [], doors, wallBuys, boxSpots, machines, risers, starts: Z.starts.map(p => ({ x: p.x, z: p.z })),
    power, boss, reserved, W, H, main, band, cellAt,
  };
  Object.defineProperty(map, '_zmLayout', { value: L, configurable: true, writable: true, enumerable: false });
  return L;
}

// ---- The mode's walls on the shared map object ----

// Puts the layout's fences and closed doors into map.walls (as tail walls, see geometry.js wallGrid), replacing any
// left there before. `open` is a bitmask of open doors. Returns the door walls by index.
export function placeZmWalls(map, open = 0) {
  clearZmWalls(map);
  const L = zmLayout(map);
  if (!L) return [];
  for (const f of L.fences) map.walls.push({ x: f.x, z: f.z, w: f.w, d: f.d, h: FENCE_H, kind: 'zfence', blocksMove: true, blocksBullet: true, blocksVision: true, zm: true });
  const doorWalls = L.doors.map(d => ({ x: d.x, z: d.z, w: d.w, d: d.d, h: DOOR_H, kind: 'zdoor', blocksMove: true, blocksBullet: true, blocksVision: true, zm: true, door: d.i }));
  map._zmDoors = doorWalls;
  doorWalls.forEach((w, i) => { if (!(open & (1 << i))) map.walls.push(w); });
  return doorWalls;
}

// Opens doors on the map to match `open`; returns the indices that changed.
export function syncZmDoors(map, open) {
  const doors = map._zmDoors;
  if (!doors) return [];
  const changed = [];
  doors.forEach((w, i) => {
    const want = !(open & (1 << i)), at = map.walls.indexOf(w);
    if (want && at < 0) { map.walls.push(w); changed.push(i); }
    else if (!want && at >= 0) { map.walls.splice(at, 1); changed.push(i); }
  });
  return changed;
}

// Takes every wall the mode added off the map (a new match on the same map, in any mode).
export function clearZmWalls(map) {
  if (!map?.walls) return;
  if (map.walls.some(w => w.zm)) {
    const keep = map.walls.filter(w => !w.zm);
    map.walls.length = 0;
    for (const w of keep) map.walls.push(w);
  }
  map._zmDoors = null;
}

// Re-marks a nav grid's blocked cells around a rect from the map's walls as they stand now (a door just opened).
// Same test as NavGrid._buildBlocked: a cell is blocked when its centre is within the clearance of a movement wall.
const _wb = [];
export function reblockNav(nav, map, r) {
  if (!nav) return;
  const reach = CLEAR + 1;
  const i0 = Math.max(0, Math.floor(r.x - reach)), i1 = Math.min(nav.w - 1, Math.floor(r.x + r.w + reach));
  const j0 = Math.max(0, Math.floor(r.z - reach)), j1 = Math.min(nav.h - 1, Math.floor(r.z + r.d + reach));
  const n = wallsInBox(map, i0 - 1, j0 - 1, i1 + 2, j1 + 2, _wb.length >= map.walls.length ? _wb : (_wb.length = map.walls.length + 16, _wb));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const cx = i + 0.5, cz = j + 0.5;
      let blocked = cx < CLEAR || cz < CLEAR || cx > map.width - CLEAR || cz > map.height - CLEAR;
      for (let k = 0; k < n && !blocked; k++) {
        const w = map.walls[_wb[k]];
        if (!w || !w.blocksMove) continue;
        const nx = Math.max(w.x, Math.min(cx, w.x + w.w)), nz = Math.max(w.z, Math.min(cz, w.z + w.d));
        if ((cx - nx) ** 2 + (cz - nz) ** 2 < CLEAR * CLEAR) blocked = true;
      }
      nav.blocked[j * nav.w + i] = blocked ? 1 : 0;
    }
  }
}

// ---- What a player can use where they stand (the HUD's prompt and the host's check are the same function) ----

// state: { open (door bits), box: {spot, state, gun, owner}, pts, perks: [ids], guns: [primary, secondary], power }.
// Returns { kind: 'door'|'wall'|'ammo'|'box'|'take'|'perk'|'power', i, cost, label, ok, off? } for the nearest usable
// thing, or null. `off`: a perk machine on a map whose power is still off (shown, never ok).
export function zmUsable(L, x, z, st) {
  if (!L) return null;
  let best = null, bestD = ZM.useReach;
  const near = (px, pz) => { const d = Math.hypot(px - x, pz - z); return d < bestD ? d : -1; };
  for (const d of L.doors) {
    if (st.open & (1 << d.i)) continue;
    // A door is used from either side, along its length.
    const dz = Math.max(d.z, Math.min(z, d.z + d.d)), dist = L.graph ? near(Math.max(d.x, Math.min(x, d.x + d.w)), dz) : near(d.cx, dz);
    if (dist >= 0) { bestD = dist; best = { kind: 'door', i: d.i, cost: d.cost, label: 'Open the gate' }; }
  }
  for (const w of L.wallBuys) {
    if (!bandOpen(L, st.open, w.band)) continue;
    const dist = near(w.x, w.z);
    if (dist < 0) continue;
    bestD = dist;
    const own = st.guns?.includes(w.gun);
    best = own ? { kind: 'ammo', i: w.i, cost: w.ammo, gun: w.gun, label: 'Ammo' } : { kind: 'wall', i: w.i, cost: w.cost, gun: w.gun, label: 'Buy' };
  }
  const box = st.box, bs = box && box.spot >= 0 ? L.boxSpots[box.spot] : null;
  if (bs && bandOpen(L, st.open, bs.band)) {
    const dist = near(bs.x, bs.z);
    if (dist >= 0) {
      if (box.state === 0) { bestD = dist; best = { kind: 'box', i: box.spot, cost: ZM.box.cost, label: 'Mystery crate' }; }
      else if (box.state === 2 && box.owner === st.me) { bestD = dist; best = { kind: 'take', i: box.spot, cost: 0, gun: box.gun, label: 'Take' }; }
    }
  }
  // A map with a power switch (`power: true`): the machines are dark until it is thrown, and the switch is free.
  const dark = !!L.power && !st.power;
  for (const m of L.machines) {
    if (!bandOpen(L, st.open, m.band) || st.perks?.includes(m.perk)) continue;
    const dist = near(m.x, m.z);
    if (dist < 0) continue;
    bestD = dist;
    best = { kind: 'perk', i: m.i, cost: ZM_PERKS[m.perk].cost, perk: m.perk, label: ZM_PERKS[m.perk].name, off: dark || undefined };
  }
  if (dark && bandOpen(L, st.open, L.power.band)) {
    const dist = near(L.power.x, L.power.z);
    if (dist >= 0) { bestD = dist; best = { kind: 'power', i: 0, cost: 0, label: 'Turn on the power' }; }
  }
  if (best) best.ok = !best.off && best.cost <= (st.pts ?? 0);
  return best;
}

// Where a player stands to open door d from an area that is open now (null when neither side is).
export function zmDoorStand(L, open, d) {
  if (!L.graph) return bandOpen(L, open, d.from) ? { x: d.cx + (d.from < d.opens ? -1.2 : 1.2), z: d.cz } : null;
  for (const b of [d.from, d.opens]) if (d.stand[b] && bandOpen(L, open, b)) return d.stand[b];
  return null;
}

// The graph form: which areas the open gates join to the start (cached per mask).
function graphReach(L, open) {
  const cache = L._reach ??= new Map();
  let r = cache.get(open);
  if (r) return r;
  r = new Uint8Array(L.bands.length);
  r[L.start] = 1;
  for (let grew = true; grew;) {
    grew = false;
    for (const d of L.doors) {
      if (!(open & (1 << d.i)) || r[d.a] === r[d.b]) continue;
      r[d.a] = r[d.b] = 1; grew = true;
    }
  }
  if (cache.size > 256) cache.clear();
  cache.set(open, r);
  return r;
}

// Whether band b is reachable with these doors open: walk out from the start band through open doors.
export function bandOpen(L, open, b) {
  if (b === L.start) return true;
  if (L.graph) return b >= 0 && !!graphReach(L, open)[b];
  const step = b > L.start ? 1 : -1;
  for (let k = L.start; k !== b; k += step) {
    const cut = step > 0 ? k : k - 1;
    const d = L.doors.find(x => x.cut === cut);
    if (!d || !(open & (1 << d.i))) return false;
  }
  return true;
}
