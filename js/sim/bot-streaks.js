// Bot scorestreak sense (V9 overhaul, 2026-11): when a streak is worth calling, shooting enemy aircraft and machines
// down, and getting out from under incoming strikes. Kept out of bots.js (which is being restructured elsewhere):
// BotBrain calls these three functions and nothing here reaches into its internals beyond the fields it already
// shares with its own turret and device logic (turretTarget, reactLeft, useAds, wantSwap, _coverFrom, _goTo).
//
// Honesty: a bot only reacts to what a player could know. Aircraft overhead are in plain view; strikes are announced
// (red markers, the whistle, the 'incoming' callout) before they land; machines need line of sight like sentries do.

import { hasLineOfSight } from '../shared/geometry.js';
import { WEAPONS } from '../shared/weapons.js';
import { airHp, DOME_R } from './streaks-v9.js';

const WAIT = 10;                 // bots.js STREAK_WAIT: a bot sitting on a streak this long calls it anyway.
const AIR_SEE = 26;              // Metres (ground distance) at which a bot notices and engages an enemy aircraft.
const HIGH = new Set(['gunship', 'chopper']);    // Flying high enough to see over buildings.
const SHOOTABLE_AIR = new Set(['gunship', 'chopper', 'recon', 'hound', 'swarm']);
const STRIKE_WARN = 2;           // Seconds before a bomb lands that a bot starts to move out from under it.

// Is now a good moment for `kind`? `visible`: the bot is looking at an enemy. Answers for every kind bots.js does not
// decide itself; returning true for unknown kinds keeps a bot from sitting on something forever.
export function streakMoment(b, kind, visible) {
  const { sim, p, ps } = b;
  const seen = () => sim._teamVisible(p.team).length;
  const busy = visible || b.hasKnown;
  const mates = r => sim.players.reduce((n, q) => n + (q !== p && q.team === p.team && q.alive && Math.hypot(q.ps.x - ps.x, q.ps.z - ps.z) <= r ? 1 : 0), 0);
  switch (kind) {
    // Intel: between fights, when it will tell the team something new.
    case 'sweep':
    case 'recon': return !visible;
    // Support: when someone is there to get it, or the bot is about to need it.
    case 'airdrop': return !visible;
    case 'plates': return mates(14) >= 1 || p.hp < 70;
    case 'dome': return (busy && mates(DOME_R) >= 1) || b.mode === 'hold' || incomingNear(sim, p, 8);
    // Lethal: never into an empty map. A Carpet Line wants a group; one target will do once it has waited.
    case 'hound': return busy;
    case 'rover': return seen() > 0;
    case 'bombrun': return seen() >= 2 || (seen() >= 1 && b.streakWait >= WAIT / 2);
    case 'chopper':
    case 'gunship': return seen() > 0 || b.streakWait >= WAIT;
    default: return true;
  }
}

function incomingNear(sim, p, r) {
  for (const s of sim.strikes) if (s.team !== p.team && Math.hypot(s.x - p.ps.x, s.z - p.ps.z) < r) return true;
  return false;
}

// Shoots enemy aircraft and V9 machines between fights. The tiers that shoot sentries (S.turret === 'shoot', and
// 'cover' half the time) do this; a bot carrying a launcher swaps to it for aircraft. Called every think, after the
// bot's own turret and device logic, which clear turretTarget when they have nothing: so the choice is remembered in
// b.airTarget and the reaction delay only restarts when the target changes.
export function thinkAir(b, visible) {
  const { sim, p, ps, S } = b;
  if (visible || b.flashT > 0 || !S.turret) { b.airTarget = null; return; }
  if (b.turretTarget && b.turretTarget !== b.airTarget && b.turretTarget !== b.devTarget) return;   // Busy with a sentry.
  let best = null, bestD = AIR_SEE, air = false;
  for (let i = 0; i < sim.gunships.length; i++) {
    const g = sim.gunships[i];
    if (g.team === p.team || !SHOOTABLE_AIR.has(g.kind)) continue;
    const d = Math.hypot(g.x - ps.x, g.z - ps.z);
    if (d >= bestD) continue;
    if (!HIGH.has(g.kind) && !hasLineOfSight(sim.map, ps.x, ps.z, g.x, g.z, sim.smokes)) continue;
    best = g; bestD = d; air = true;
  }
  // Rovers, Domes and Airdrop crates on the ground: like a sentry, only in plain view.
  for (let i = 0; i < sim.turrets.length; i++) {
    const t = sim.turrets[i];
    if (t.team === p.team || !t.kind || t.kind === 'sentry') continue;
    const d = Math.hypot(t.x - ps.x, t.z - ps.z);
    if (d >= Math.min(bestD, 20) || !hasLineOfSight(sim.map, ps.x, ps.z, t.x, t.z, sim.smokes)) continue;
    best = t; bestD = d; air = false;
  }
  if (!best || (S.turret === 'cover' && !b.airRoll)) {
    if (!best) b.airRoll = sim.rng() < 0.5;
    if (b.turretTarget === b.airTarget) b.turretTarget = null;
    b.airTarget = null;
    return;
  }
  if (air) airHp(best);          // Older aircraft get their health on first use.
  if (b.airTarget !== best) {
    b.reactLeft = between(sim.rng, S.reaction[0], S.reaction[1]);
    b.reactTotal = b.reactLeft;
    b.useAds = bestD > 7;
    b.airTarget = best;
    // A launcher in the holster is the right tool for anything flying.
    if (air && ps.slot === 0 && WEAPONS[ps.secondary]?.explosive && ps.ammo[1] + ps.reserve[1] > 0) b.wantSwap = true;
  }
  b.turretTarget = best;
}

// Gets out from under an enemy strike that has been called on this bot's spot (mortar, airstrike, Carpet Line), and
// otherwise walks over to open an Airdrop crate it can see: its own side's, or (the shooting tiers) to steal one.
export function thinkStrikes(b, visible) {
  const { sim, p, ps, S } = b;
  if (b.objective?.commit) return;
  if (!sim.strikes.length) { if (!visible) thinkCrate(b); return; }
  let threat = null, worst = 0;
  for (let i = 0; i < sim.strikes.length; i++) {
    const s = sim.strikes[i];
    if (s.team === p.team) continue;
    const left = s.at - sim.time, d = Math.hypot(s.x - ps.x, s.z - ps.z);
    if (left > STRIKE_WARN || d > s.radius + 1) continue;
    const danger = (s.radius + 1 - d) / (s.radius + 1);
    if (danger > worst) { worst = danger; threat = s; }
  }
  if (!threat) return;
  const key = `${threat.kind}${Math.round(threat.x)}:${Math.round(threat.z)}`;
  if (b.strikeKey !== key) { b.strikeKey = key; b.strikeRoll = sim.rng() < S.dodge; }
  if (!b.strikeRoll || b.mode === 'cover') return;
  if (!b._coverFrom(threat.x, threat.z)) {
    const a = Math.atan2(ps.z - threat.z, ps.x - threat.x);
    b.mode = 'cover'; b.modeT = 1.5;
    b._goTo(ps.x + Math.cos(a) * (threat.radius + 2), ps.z + Math.sin(a) * (threat.radius + 2));
  }
}

const CRATE_SEE = 22;
function thinkCrate(b) {
  const { sim, p, ps, S } = b;
  if (b.mode === 'cover') return;
  let best = null, bestD = CRATE_SEE;
  for (let i = 0; i < sim.turrets.length; i++) {
    const t = sim.turrets[i];
    if (t.kind !== 'crate' || (t.team !== p.team && S.turret !== 'shoot')) continue;
    const d = Math.hypot(t.x - ps.x, t.z - ps.z);
    if (d >= bestD || !hasLineOfSight(sim.map, ps.x, ps.z, t.x, t.z, sim.smokes)) continue;
    best = t; bestD = d;
  }
  if (!best) return;
  if (b.mode === 'hold' && b.goalX === best.x && b.goalZ === best.z) return;
  b._setMode('hold');
  b.holdT = best.team === p.team ? 1.2 : 3;
  b._goTo(best.x, best.z);
}

function between(rng, a, b) { return a + (b - a) * rng(); }
