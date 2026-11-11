// Small helpers the modes overhaul's rule modules share (js/sim/hq.js, ko.js, inf.js, oic.js, ctl.js, grind.js).
export const r2 = v => Math.round(v * 100) / 100;

// Zone records in the shape the Sim's own zones have, so sim._countIn, _pointView and _checkDefend work on them.
export function makeZones(defs) {
  return (defs ?? []).map(d => ({ id: d.id, x: d.x, z: d.z, r: d.r ?? 4, owner: -1, cap: 0, contested: false, taken: [false, false] }));
}

// A seeded shuffle of 0..n-1 (the rotation order of a Headquarters, say), from the match seed.
export function seededOrder(n, seed, salt) {
  let a = (seed ^ salt) >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [out[i], out[k]] = [out[k], out[i]]; }
  return out;
}

// Zone state for the wire: owner (-1..1), capture (-1..1 in hundredths) and contested in one number.
export const packZone = z => ((Math.round(z.cap * 100) + 100) << 3) | ((z.owner + 1) << 1) | (z.contested ? 1 : 0);
export function unpackZone(z, n) {
  z.contested = !!(n & 1); z.owner = ((n >> 1) & 3) - 1; z.cap = ((n >> 3) - 100) / 100;
  return z;
}

// Per-player tallies on the wire: [index, ...values] for every player with any, after `at` in the block.
export function encodeStats(out, players, keys) {
  for (const p of players) {
    let any = false;
    for (const k of keys) if (p[k]) { any = true; break; }
    if (!any) continue;
    out.push(p.index);
    for (const k of keys) out.push(p[k] ?? 0);
  }
  return out;
}
export function decodeStats(a, at, players, keys) {
  for (const p of players) for (const k of keys) p[k] = 0;
  if (!a) return;
  const n = keys.length + 1;
  for (let i = at; i + n - 1 < a.length; i += n) {
    const p = players[a[i]];
    if (p) keys.forEach((k, j) => { p[k] = a[i + 1 + j]; });
  }
}
// Host migration: copies the same tallies from a decoded view onto the new host's players.
export function restoreStats(sim, view, keys) {
  for (let i = 0; i < view.players.length && i < sim.players.length; i++) {
    for (const k of keys) sim.players[i][k] = view.players[i][k] ?? 0;
  }
}

// A walkable spot near (x, z), for objectives placed by arithmetic.
export function walkable(sim, x, z) {
  const nav = sim.nav;
  if (!nav || nav.isWalkable(x, z)) return { x, z };
  const k = nav.nearestFree(x, z);
  return { x: k % nav.w + 0.5, z: Math.floor(k / nav.w) + 0.5 };
}

export function closestBot(free, x, z) {
  let best = null, bestD = Infinity;
  for (const bot of free) {
    const d = Math.hypot(bot.ps.x - x, bot.ps.z - z);
    if (d < bestD) { bestD = d; best = bot; }
  }
  return best;
}

export const zoneObjective = (z, role, tag = '') => ({ key: `${z.id}${role}${tag}`, x: z.x, z: z.z, r: z.r, role });

// An objective on a moving target, rounded so the key (and with it the bot's path) changes only every few metres.
export function chaseObjective(sim, key, x, z, role = 'attack', commit = false) {
  const gx = Math.round(x / 4) * 4, gz = Math.round(z / 4) * 4;
  const at = walkable(sim, x, z);
  return { key: `${key}@${gx},${gz}`, x: at.x, z: at.z, r: 0, role, commit };
}

// Living, present players of a side.
export function alive(sim, team) {
  let n = 0;
  for (const p of sim.players) if (p.team === team && p.alive && !p.dummy && !p.away) n++;
  return n;
}
