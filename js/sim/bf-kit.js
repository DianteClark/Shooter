// What Conquest and Breakthrough (js/sim/conquest.js, breakthrough.js) share on the host: flag capture, spawn spots
// sampled from the nav grid, the out-of-bounds clock, and the bots' way back in bounds. docs/MODES.md "Conquest and
// Breakthrough"; the layouts and numbers are js/shared/bf.js.
import { hasLineOfSight } from '../shared/geometry.js';
import { BF, inArea } from '../shared/bf.js';

const GRID = 3;            // Spawn spot spacing (metres).

// One tick of a flag: whoever has more players on it moves the capture toward their side, faster with a bigger edge.
// cap runs -1 (team 0 owns) to +1 (team 1). A held flag goes neutral at 0 and changes hands at the far end. With no
// edge it stays where it is; with nobody on it a part-taken flag drifts back to whoever holds it (or to neutral).
// Returns 'neutral' | 'capture' | null for what happened this tick, and leaves z.by as the side that did it.
export function stepFlag(z, n, dt, capture = BF.capture) {
  const edge = n[0] - n[1];
  z.contested = n[0] > 0 && n[1] > 0;
  let out = null;
  if (edge !== 0) {
    const side = edge > 0 ? 0 : 1, sign = side ? 1 : -1;
    const k = BF.crowd[Math.min(Math.abs(edge), BF.crowd.length - 1)];
    z.cap = Math.max(-1, Math.min(1, z.cap + sign * k * dt / capture));
    if (z.owner === 1 - side && z.cap * sign >= 0) { z.owner = -1; z.by = side; out = 'neutral'; }
    if (z.owner !== side && z.cap * sign >= 1) { z.owner = side; z.by = side; out = 'capture'; }
  } else if (!n[0] && !n[1]) {
    const home = z.owner < 0 ? 0 : z.owner ? 1 : -1;
    const d = home - z.cap;
    if (Math.abs(d) > 1e-6) z.cap += Math.sign(d) * Math.min(Math.abs(d), dt / (capture * 2));
  }
  return out;
}

// Every walkable spot on a GRID lattice inside the area that a player can walk to from `from` (flood fill over the nav
// grid, kept inside the area), with a cell of clearance all round. Host only (needs sim.nav). Cached per rules object.
export function spawnSpots(sim, area, from) {
  const nav = sim.nav, { w, h, blocked } = nav;
  const i0 = Math.max(1, Math.floor(area.x)), i1 = Math.min(w - 2, Math.ceil(area.x + area.w));
  const j0 = Math.max(1, Math.floor(area.z)), j1 = Math.min(h - 2, Math.ceil(area.z + area.h));
  const reach = new Uint8Array(w * h);
  const seeds = (Array.isArray(from) ? from : [from]).map(p => nav.nearestFree(p.x, p.z));
  const stack = [];
  for (const k of seeds) if (k >= 0 && !reach[k]) { reach[k] = 1; stack.push(k); }
  while (stack.length) {
    const k = stack.pop(), i = k % w, j = (k - i) / w;
    const visit = (q, qi, qj) => { if (qi >= i0 && qi <= i1 && qj >= j0 && qj <= j1 && !blocked[q] && !reach[q]) { reach[q] = 1; stack.push(q); } };
    visit(k - 1, i - 1, j); visit(k + 1, i + 1, j); visit(k - w, i, j - 1); visit(k + w, i, j + 1);
  }
  const out = [];
  for (let z = area.z + GRID / 2; z < area.z + area.h; z += GRID) {
    for (let x = area.x + GRID / 2; x < area.x + area.w; x += GRID) {
      const i = Math.floor(x), j = Math.floor(z), k = j * w + i;
      if (i < 1 || j < 1 || i > w - 2 || j > h - 2) continue;
      if (!reach[k] || !reach[k - 1] || !reach[k + 1] || !reach[k - w] || !reach[k + w]) continue;
      out.push({ x: i + 0.5, z: j + 0.5 });
    }
  }
  return out;
}

// The best of `spots` for p: far from living enemies, out of their sight, not just used, nearer `toward` if given.
export function bestSpot(sim, p, spots, toward = null) {
  let best = null, bestScore = -Infinity;
  const foe = 1 - p.team;
  for (const s of spots) {
    let nearest = 60, seen = false;
    for (const q of sim.players) {
      if (q.team !== foe || !q.alive) continue;
      const dx = q.ps.x - s.x, dz = q.ps.z - s.z, d2 = dx * dx + dz * dz;
      if (d2 > 3600) continue;
      const d = Math.sqrt(d2);
      if (d < nearest) nearest = d;
      if (!seen && d < 36 && hasLineOfSight(sim.map, s.x, s.z, q.ps.x, q.ps.z)) seen = true;
    }
    const usedAgo = sim.time - (sim.spawnUsedAt.get(s) ?? -99);
    let score = Math.min(nearest, 40) - (seen ? 30 : 0) - (usedAgo < 2.5 ? 12 : 0) + sim.rng() * 4;
    if (toward) score -= Math.hypot(toward.x - s.x, toward.z - s.z) * 0.15;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (best) sim.spawnUsedAt.set(best, sim.time);
  return best;
}

export const faceTo = (s, t) => Math.atan2(t.z - s.z, t.x - s.x);

// The out-of-bounds clock. `inside(p)` says whether p may be where it is; `limit(p)` how long it may stay out. p.oob
// counts down while out (null while in, after BF.ret seconds back in); at 0 the player dies with no credit.
export function stepBounds(sim, dt, inside, limit) {
  for (const p of sim.players) {
    if (!p.alive || p.dummy || p.away) { p.oob = null; p.oobBack = 0; continue; }
    if (inside(p)) {
      if (p.oob != null && (p.oobBack = (p.oobBack ?? 0) + dt) >= BF.ret) { p.oob = null; p.oobBack = 0; }
      continue;
    }
    p.oobBack = 0;
    if (p.oob == null) p.oob = limit(p);
    p.oob -= dt;
    if (p.oob <= 0) { p.oob = null; sim._selfKill(p, 'zone'); }
  }
}

// A bot out of bounds (or close to it) walks back in: an objective at the nearest in-bounds spot, which it will not be
// pulled off. Returns true when it took over the bot.
export function sendBack(bot, x, z, key = 'oob') {
  bot.setObjective({ key: `${key}${Math.round(x / 4)},${Math.round(z / 4)}`, x, z, r: 3, role: 'attack', commit: true });
  return true;
}

// Clamped into the area by `pad` metres.
export function intoArea(a, x, z, pad = 6) {
  return { x: Math.max(a.x + pad, Math.min(a.x + a.w - pad, x)), z: Math.max(a.z + pad, Math.min(a.z + a.h - pad, z)) };
}

export const inBounds = (l, x, z) => inArea(l.area, x, z);
