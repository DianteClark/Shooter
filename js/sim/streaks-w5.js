// Scorestreaks wave 5 (js/shared/catalog.js, 2026-11-22): the VTOL Jet and the SAM Turret. Host only, pure, runs in
// node. Same contract as streaks-v9.js, which dispatches to these from launch(), stepAir() and stepMachine(); entities
// ride the Sim's existing lists so EMP, Shock, grenades, airspace, the hit markers and the target tags reach them.
//
//   VTOL Jet    an aircraft ('vtol' in sim.gunships) that flies in from the edge and hovers over where it was called
//               for VTOL_LIFE s, turning on the spot: short gun bursts at the nearest enemy it can see from up there
//               (over waist-high cover, not through walls or smoke), and every VTOL_ROCKET_GAP s a pair of small rockets
//               at whoever it is shooting. Cold Blooded hides you from it until close. Shoot it down (Skyhook: two
//               locked rockets), roofs, EMP.
//   SAM Turret  a ground machine ('sam' in sim.turrets): a four-tube pod that turns to the nearest enemy aircraft in
//               SAM_RANGE and fires one missile every SAM_GAP s (SAM_DAMAGE to it, so a Wingman or a Recon Drone is
//               one, a Chopper three). It never shoots people, but it does shoot a Napalm Strike's jet down before it
//               drops. Shoot it, explosives, Shock, EMP.
//   Napalm      an Airstrike-style run (aimed like it: at the biggest group the team can see) that lays NAPALM_N
//               patches of burning fuel ('napalm' lying in the equipment list, drawn as fire) along a line for
//               NAPALM_LIFE s. Damage is the streak's, not a Molotov's. Tac Mask halves it; get off the line; an Aegis
//               Dome does not stop fire; an enemy SAM within SAM_RANGE of the line shoots the jet down first; EMP
//               before it drops calls it off.
import { PLAYER_RADIUS, SIM_HZ } from '../shared/constants.js';
import { hasLineOfSight, raycastMap, rayCircle } from '../shared/geometry.js';
import { angleDiff, shotPassage } from './player.js';
import { AIR_HP, airHp, hurtAir } from './streaks-v9.js';

const STEP = 1 / SIM_HZ;
const round2 = v => Math.round(v * 100) / 100;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const bell = rng => (rng() + rng() + rng() - 1.5) / 1.5;

// VTOL Jet.
export const VTOL_LIFE = 25, VTOL_HP = 1300, VTOL_SPEED = 14, VTOL_HOVER = 5, VTOL_RANGE = 22;
export const VTOL_BURST = 6, VTOL_GAP = 0.09, VTOL_PAUSE = 0.9, VTOL_DAMAGE = 14, VTOL_SPREAD = 0.07;
export const VTOL_ROCKET_GAP = 5, VTOL_ROCKET = { radius: 2.4, damage: 60, inner: 0.6, min: 12 };
const VTOL_ENTRY = 30;            // Metres out it starts its run in from (clamped to the map).
const VTOL_GUN = { range: VTOL_RANGE + 6, penetrate: 0.4 };
// SAM Turret.
export const SAM_LIFE = 45, SAM_HP = 260, SAM_RANGE = 40, SAM_GAP = 1.6, SAM_DAMAGE = 450, SAM_TURN = 3.5;
// Napalm Strike. The patches' size and burn are equipment.js EQUIPMENT.napalm.
export const NAPALM_DELAY = 1.6, NAPALM_N = 5, NAPALM_SPACING = 3.4, NAPALM_STEP = 0.12;

// ---------------------------------------------------------------- calling (streaks-v9.js launch)

export function launchW5(sim, p, kind, spot) {
  switch (kind) {
    case 'vtol': return callVtol(sim, p);
    case 'sam': return callSam(sim, p);
    case 'napalm': return callNapalm(sim, p, spot);
    default: return false;
  }
}

// Wave 5's own clocks: Napalm runs on their way in. Called every tick from streaks-v9.js stepV9.
export function stepW5(sim) {
  const runs = sim.w5Runs;
  if (!runs?.length) return;
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    if (r.at > sim.time) continue;
    runs.splice(i, 1);
    // An enemy SAM near the line shoots the jet down on its way in: no fire at all.
    const sam = sim.turrets.find(t => t.kind === 'sam' && t.team !== r.team && Math.hypot(t.x - r.x, t.z - r.z) <= SAM_RANGE);
    if (sam) {
      sim._emit({ t: 'sam_shot', id: sam.id, team: sam.team, ox: round2(sam.x), oz: round2(sam.z), x: round2(r.x), z: round2(r.z), kind: 'napalm' });
      sim._emit({ t: 'air_down', kind: 'napalm', team: r.team, owner: r.by.id, by: sam.owner.id, x: round2(r.x), z: round2(r.z) });
      sim._emit({ t: 'sam_kill', id: sam.owner.id, kind: 'napalm' });
      sim._medal(sam.owner, 'shootdown');
      continue;
    }
    for (let k = 0; k < NAPALM_N; k++) {
      const u = k - (NAPALM_N - 1) / 2;
      const x = clamp(r.x + r.dx * u * NAPALM_SPACING, 1, sim.map.width - 1), z = clamp(r.z + r.dz * u * NAPALM_SPACING, 1, sim.map.height - 1);
      sim.eq.lay('napalm', r.by.id, r.team, x, z, k * NAPALM_STEP);
    }
    sim._emit({ t: 'napalm', team: r.team, by: r.by.id, x: round2(r.x), z: round2(r.z), dx: r.dx, dz: r.dz, n: NAPALM_N, gap: NAPALM_SPACING });
  }
}

function callNapalm(sim, p, spot) {
  (sim.w5Runs ??= []).push({ team: p.team, by: p, x: spot.x, z: spot.z, dx: spot.dx ?? 1, dz: spot.dz ?? 0, at: sim.time + NAPALM_DELAY });
  sim._emit({ t: 'streak', id: p.id, kind: 'napalm', team: p.team, x: round2(spot.x), z: round2(spot.z), dx: round2(spot.dx ?? 1), dz: round2(spot.dz ?? 0),
    delay: NAPALM_DELAY, step: NAPALM_STEP, n: NAPALM_N, gap: NAPALM_SPACING });
  for (let k = 0; k < NAPALM_N; k++) {
    const u = k - (NAPALM_N - 1) / 2;
    sim._emit({ t: 'incoming', kind: 'napalm', x: round2(spot.x + (spot.dx ?? 1) * u * NAPALM_SPACING), z: round2(spot.z + (spot.dz ?? 0) * u * NAPALM_SPACING), delay: NAPALM_DELAY, team: p.team });
  }
}

function callVtol(sim, p) {
  const k = sim._engineerMult(p, 1.25);
  const W = sim.map.width, H = sim.map.height;
  const west = sim.ffa ? p.ps.x < W / 2 : p.team === 0;
  const hx = clamp(p.ps.x, 4, W - 4), hz = clamp(p.ps.z, 4, H - 4);
  const sx = clamp(hx + (west ? -VTOL_ENTRY : VTOL_ENTRY), 1, W - 1);
  sim.gunships.push({ kind: 'vtol', team: p.team, owner: p, x: sx, z: hz, aim: west ? 0 : Math.PI, life: VTOL_LIFE * k,
    hp: VTOL_HP * k, maxHp: VTOL_HP * k, hx, hz, age: 0, target: null, retarget: 0, burstLeft: 0, cooldown: 0, pause: 1, rocketT: 2.5 });
  sim._emit({ t: 'streak', id: p.id, kind: 'vtol', team: p.team, x: round2(hx), z: round2(hz) });
}

function callSam(sim, p) {
  const k = sim._engineerMult(p, 1.5);
  const t = { id: sim.nextTurretId++, kind: 'sam', team: p.team, owner: p, x: p.ps.x, z: p.ps.z, aim: wrap(p.ps.aim),
    hp: SAM_HP * k, maxHp: SAM_HP * k, life: SAM_LIFE * k, thinkT: 0, cooldown: 0.8, target: null };
  sim.turrets.push(t);
  sim._emit({ t: 'turret', id: t.id, team: t.team, x: round2(t.x), z: round2(t.z), kind: 'sam' });
  sim._emit({ t: 'streak', id: p.id, kind: 'sam', team: p.team, x: round2(t.x), z: round2(t.z) });
}

// ---------------------------------------------------------------- the VTOL (streaks-v9.js stepAir)

export function stepAirW5(sim, g) {
  if (g.kind === 'vtol') return stepVtol(sim, g);
  return false;
}

function stepVtol(sim, g) {
  g.age = (g.age ?? 0) + STEP;
  g.hx ??= g.x; g.hz ??= g.z; g.rocketT ??= VTOL_ROCKET_GAP;
  // Station: a slow figure of eight over the spot it was called to, flown in at speed.
  const ox = Math.cos(g.age * 0.45) * VTOL_HOVER, oz = Math.sin(g.age * 0.9) * VTOL_HOVER * 0.5;
  const sx = g.hx + ox, sz = g.hz + oz, dx = sx - g.x, dz = sz - g.z, d = Math.hypot(dx, dz);
  if (d > 0.05) {
    const m = Math.min(d, (d > 6 ? VTOL_SPEED : 4) * STEP);
    g.x = clamp(g.x + dx / d * m, 0.5, sim.map.width - 0.5); g.z = clamp(g.z + dz / d * m, 0.5, sim.map.height - 0.5);
  }
  g.retarget -= STEP;
  if (g.retarget <= 0) { g.retarget = 0.3; g.target = vtolTarget(sim, g); }
  const q = g.target && g.target.alive ? g.target : null;
  const want = q ? Math.atan2(q.ps.z - g.z, q.ps.x - g.x) : d > 1 ? Math.atan2(dz, dx) : g.aim;
  g.aim = wrap(g.aim + clamp(angleDiff(want, g.aim), -2.5 * STEP, 2.5 * STEP));
  g.rocketT -= STEP;
  if (q && g.rocketT <= 0 && Math.abs(angleDiff(want, g.aim)) < 0.3) { g.rocketT = VTOL_ROCKET_GAP; vtolRockets(sim, g, q); }
  if (g.burstLeft > 0) {
    g.cooldown -= STEP;
    if (g.cooldown <= 0) { g.cooldown = VTOL_GAP; g.burstLeft--; vtolRound(sim, g, q); }
    return false;
  }
  g.pause -= STEP;
  if (g.pause <= 0 && q && Math.abs(angleDiff(want, g.aim)) < 0.5) { g.burstLeft = VTOL_BURST; g.cooldown = 0; g.pause = VTOL_PAUSE; }
  return false;
}

// Nearest enemy in reach the jet can see from where it hangs (walls and smoke block it, crates do not). Cold Blooded
// only once close; Ghost does not hide you from a pilot looking down at you.
function vtolTarget(sim, g) {
  let best = null, bestD = VTOL_RANGE;
  for (let i = 0; i < sim.players.length; i++) {
    const q = sim.players[i];
    if (q.team === g.team || !q.alive || q.spawnProtect > 0 || q.dummy || sim._coldHidden(q, g.x, g.z)) continue;
    const d = Math.hypot(q.ps.x - g.x, q.ps.z - g.z);
    if (d < bestD && hasLineOfSight(sim.map, g.x, g.z, q.ps.x, q.ps.z, sim.eq.smokes)) { bestD = d; best = q; }
  }
  return best;
}

const POS = { x: 0, z: 0, sliding: false };
function vtolRound(sim, g, q) {
  if (!q) { g.burstLeft = 0; return; }
  sim.posAt(q, 0.2, POS);
  const angle = Math.atan2(POS.z - g.z, POS.x - g.x) + bell(sim.rng) * VTOL_SPREAD;
  const dx = Math.cos(angle), dz = Math.sin(angle), reach = VTOL_RANGE + 6;
  const wall = raycastMap(sim.map, g.x, g.z, dx, dz, reach, 'blocksVision');
  let bestT = wall ? wall.t : reach, victim = null;
  for (let i = 0; i < sim.players.length; i++) {
    const v = sim.players[i];
    if (v.team === g.team || !v.alive) continue;
    const hit = rayCircle(g.x, g.z, dx, dz, v.ps.x, v.ps.z, PLAYER_RADIUS + (v.ps.sliding ? 0 : 0.1));
    if (hit >= 0 && hit < bestT) { bestT = hit; victim = v; }
  }
  let pen = 1;
  if (victim) { pen = shotPassage(sim.map, g.x, g.z, g.x + dx * bestT, g.z + dz * bestT, VTOL_GUN); if (pen <= 0) pen = 0.6; }   // Fired from above: over a crate.
  sim._emit({ t: 'turret_shot', kind: 'vtol', ox: round2(g.x), oz: round2(g.z), x: round2(g.x + dx * bestT), z: round2(g.z + dz * bestT) });
  if (victim) sim._damage(victim, g.owner, VTOL_DAMAGE * pen, g.owner.ps.weapon, bestT, 'vtol');
}

// A pair of small rockets either side of the target, bursting a moment later (an 'incoming' warning first).
function vtolRockets(sim, g, q) {
  for (const side of [-1, 1]) {
    const x = clamp(q.ps.x + side * 1.1 + bell(sim.rng) * 0.6, 1, sim.map.width - 1), z = clamp(q.ps.z + bell(sim.rng) * 0.8, 1, sim.map.height - 1);
    sim.strikes.push({ kind: 'vtol', team: g.team, by: g.owner, x, z, at: sim.time + 0.45, radius: VTOL_ROCKET.radius, damage: VTOL_ROCKET.damage });
    sim._emit({ t: 'vtol_rocket', ox: round2(g.x), oz: round2(g.z), x: round2(x), z: round2(z), team: g.team });
  }
}

// ---------------------------------------------------------------- the SAM (streaks-v9.js stepMachine)

export function stepMachineW5(sim, t) {
  if (t.kind !== 'sam') return false;
  t.cooldown -= STEP;
  t.thinkT -= STEP;
  if (t.thinkT <= 0) { t.thinkT = 0.25; t.target = samTarget(sim, t); }
  const g = t.target && sim.gunships.includes(t.target) ? t.target : null;
  if (!g) return true;
  const off = angleDiff(Math.atan2(g.z - t.z, g.x - t.x), t.aim), lim = SAM_TURN * STEP;
  t.aim = wrap(t.aim + clamp(off, -lim, lim));
  if (t.cooldown <= 0 && Math.abs(off) < 0.25) {
    t.cooldown = SAM_GAP;
    sim._emit({ t: 'sam_shot', id: t.id, team: t.team, ox: round2(t.x), oz: round2(t.z), x: round2(g.x), z: round2(g.z), kind: g.kind });
    airHp(g);
    if (hurtAir(sim, g, SAM_DAMAGE, t.owner)) sim._emit({ t: 'sam_kill', id: t.owner.id, kind: g.kind });
  }
  return true;
}

// The nearest enemy aircraft in reach. A Carpet Line's reticle is not an aircraft; everything in AIR_HP is.
function samTarget(sim, t) {
  let best = null, bestD = SAM_RANGE;
  for (let i = 0; i < sim.gunships.length; i++) {
    const g = sim.gunships[i];
    if (g.team === t.team || !(g.kind in AIR_HP)) continue;
    const d = Math.hypot(g.x - t.x, g.z - t.z);
    if (d < bestD) { bestD = d; best = g; }
  }
  return best;
}
