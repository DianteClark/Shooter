// Scorestreaks overhaul (V9, 2026-11): the eight new streaks, shooting streaks down, and the reworked EMP. Host only,
// pure, runs in node. Kept out of sim.js so that file only carries the hooks; every function takes the Sim.
//
// Entities ride the Sim's existing lists, so the old counters (EMP, Shock, grenades, Hijacker, airspace) reach them:
//   sim.gunships  aircraft. New kinds: 'recon' (piloted recon drone), 'hound' (Wingman gun drone), 'reticle' (a
//                 Carpet Line being drawn). Every aircraft now has hp and can be shot down (shootAir).
//   sim.turrets   ground machines, by `kind`: 'sentry' (the old Sentry), 'rover', 'dome' (Aegis Dome emitter) and
//                 'crate' (a landed Airdrop). Only sentries and rovers shoot; bullets, blasts and Shock hurt them all.
// Views split them back out (splitView): view.turrets and view.gunships keep exactly what they always held, the new
// kinds go to view.deploys and view.drones, and Plate Drop armour rides the aircraft rows like Juggernaut armour.
//
// Rules worth knowing:
//   Shoot-down    a ray through an aircraft's hit capsule (from its ground point to where the tilted camera draws
//                 it) chips it; a launcher round that passes it hits it for LAUNCHER_AIR times its damage. The
//                 shooter gets SCORE.shootdown scaled by cost (streak score, a medal, an 'air_down' event).
//   Aegis Dome    enemy throws inside it are shot down; enemy streak blasts, launcher blasts and grenade blasts do not
//                 hurt the owner's team inside it. Bullets go through: walk in and fight.
//   EMP           enemy air and machines go down, except an Engineer's, which lose half of what they had left; enemy
//                 streaks cannot be called for EMP_LOCK s; enemy kit is jammed EMP_KIT s (Engineer immune).

import { SCORE, STREAKS } from '../shared/catalog.js';
import { PLAYER_RADIUS, SIM_HZ } from '../shared/constants.js';
import { hasLineOfSight, raycastMap, rayCircle } from '../shared/geometry.js';
import { WEAPONS } from '../shared/weapons.js';
import { addScore } from './streaks.js';
import { EQUIPMENT } from './equipment.js';
import { angleDiff, hasPro, shotPassage } from './player.js';

const STEP = 1 / SIM_HZ;
const round2 = v => Math.round(v * 100) / 100;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Sonar Sweep: one pulse now and one SWEEP_GAP later, from wherever the caller is then.
export const SWEEP_R = 36, SWEEP_MARK = 4, SWEEP_GAP = 6;
// Recon Drone: piloted like the Cruise Missile, but slower, over rooftops, and it never blows up.
export const SCOUT_LIFE = 12, SCOUT_SPEED = 10, SCOUT_EYE = 8, SCOUT_MARK = 3, SCOUT_EVERY = 0.5;
const SCOUT_TURN = 14, SCOUT_TURN_BOT = 4;     // rad/s.
// A human pilot steers while the aim stick is held. That used to be read from ADS, which takes a moment to come up and
// never comes up while sprinting, swapping or reloading, so a fresh drone sat still under a held stick (roadmap 40).
// The phone now sends the held stick itself (encodeHumanState's steering bit); ADS still counts for older guests.
const steering = o => !!o.ps.steer || o.ps.adsT > 0.05;
// Airdrop: lands DROP_DELAY after the call; teammates open it fast, enemies slowly (stealing it).
export const DROP_DELAY = 3, CRATE_LIFE = 40, CRATE_HP = 250, CRATE_REACH = 1.6, OPEN_OWN = 0.8, OPEN_ENEMY = 2.5;
const AIRDROP_POOL = [['uav', 3], ['sweep', 2], ['resupply', 2], ['plates', 2], ['missile', 2], ['turret', 2], ['hound', 2],
  ['mortar', 1], ['strike', 1], ['swarm', 1], ['dome', 1], ['juggernaut', 1]];
// Plate Drop: armour that soaks after a Juggernaut's own. Blasts strip it PLATE_BLAST times as fast.
export const PLATES = STREAKS.plates.armor, PLATE_RADIUS = 14, PLATE_BLAST = 2;
// Wingman: shoulder-height gun drone. Low, so walls between it and you stop its rounds and yours.
export const HOUND_LIFE = 30, HOUND_SPEED = 9, HOUND_RANGE = 16, HOUND_BURST = 5, HOUND_GAP = 0.14, HOUND_PAUSE = 0.75;
const HOUND_DAMAGE = 15, HOUND_SPREAD = 0.06, HOUND_LAG = 0.25, HOUND_OFFSET = 2.4;
// Aegis Dome.
export const DOME_R = 6, DOME_LIFE = 20, DOME_HP = 350, DOME_ZAP = 0.15;
// Carpet Line: the reticle moves while the aim stick is held; letting go (or running out of time) drops the line.
export const RETICLE_LIFE = 4, RETICLE_SPEED = 13, RETICLE_START = 6;
export const BOMB_SPACING = 2.8, BOMB_MAX = 10, BOMB_DELAY = 1.5, BOMB_STEP = 0.12, BOMB_RADIUS = 3.6, BOMB_DAMAGE = 120;
const BOMB_MIN_LINE = 4, BOMB_DEFAULT_LINE = 22;
// Rover: a sentry gun on wheels.
export const ROVER_LIFE = 25, ROVER_HP = 300, ROVER_SPEED = 3.6, ROVER_STOP = 11, ROVER_REPATH = 1;
// EMP rework.
export const EMP_LOCK = 12, EMP_KIT = 6;

// Aircraft toughness and hit shape. A capsule from the ground point toward the camera-projected point: the camera is
// tilted 55 degrees (js/render/renderer.js TILT), so something AIR_Y up is drawn 0.7 * AIR_Y north of where it is.
export const AIR_HP = { gunship: 1800, chopper: 1100, missile: 40, swarm: 80, recon: 180, hound: 300 };
const AIR_R = { gunship: 2.4, chopper: 1.8, missile: 0.55, swarm: 0.6, recon: 0.8, hound: 0.8 };
export const AIR_Y = { gunship: 7.5, chopper: 5.6, missile: 1.7, swarm: 2.9, recon: 4, hound: 2.6 };
const TILT_K = 1 / Math.tan(55 * Math.PI / 180);
export const LAUNCHER_AIR = 4, BULLET_AIR = 0.5;
// Machines that can be shot to pieces, and their toughness (the Sentry's is sim.js TURRET_HP).
export const MACHINE_HP = { turret: 180, rover: ROVER_HP, dome: DOME_HP, crate: CRATE_HP };
// Shots (every pellet on target) that bring down `hp` of a streak with gun `w`: what the HUD's first-time hint, the
// target tags and How to play quote. Air takes BULLET_AIR of a bullet and LAUNCHER_AIR of a launcher round.
export function hitsToDown(hp, w, air) {
  if (!w || !(hp > 0)) return 0;
  const per = w.explosive ? w.explosive.damage * (air ? LAUNCHER_AIR : 1) : (w.damage ?? 20) * (w.pellets ?? 1) * (air ? BULLET_AIR : 1);
  return Math.max(1, Math.ceil(hp / per));
}
const ENGINEER_AIR = 1.25, ENGINEER_TURRET = 1.5;

// Kinds by where they live and how the wire names them. Appended only (indices are on the wire).
export const TURRET_KINDS = ['sentry', 'rover', 'dome', 'crate'];
export const V9_AIR = new Set(['recon', 'hound', 'reticle']);
export const PILOTED = new Set(['missile', 'recon', 'reticle']);
const SHOOTERS = new Set(['sentry', 'rover']);
// Limits double in the 16 v 16 modes for anything that is a thing on the map (not a team-wide timer).
const ENTITY_KINDS = new Set(['turret', 'mortar', 'strike', 'chopper', 'gunship', 'missile', 'swarm', 'recon', 'airdrop', 'hound', 'dome', 'bombrun', 'rover']);
// Enemy throws a Dome shoots down: anything thrown that hurts, blinds, marks or jams. Not smoke or cover.
const DOME_ZAPS = new Set(['frag', 'sticky', 'molotov', 'mine', 'cluster', 'bomblet', 'hatchet', 'impact', 'claymore', 'drill',
  'flash', 'stun', 'gas', 'shock', 'snapshot', 'blackout', 'tagger', 'charge', 'thermite', 'tripwire', 'crawler', 'sensor', 'decoy']);

export const kindOf = t => t.kind ?? 'sentry';
export const isShooter = t => SHOOTERS.has(kindOf(t));

// ---------------------------------------------------------------- availability

// Airspace grows with the match: 3 per side and 5 overall at 6 v 6, 4 and 7 at 16 v 16.
export function airMax(sim) {
  const large = isLarge(sim);
  return { team: large ? 4 : 3, total: large ? 7 : 5 };
}
export function isLarge(sim) { return !sim.ffa && sim.players.length >= 20; }
export function limitFor(sim, kind) {
  const def = STREAKS[kind];
  return def.limit * (isLarge(sim) && ENTITY_KINDS.has(kind) ? 2 : 1);
}

// How many of a V9 kind (and the old Sentry, which now shares the turret list) a team has going. undefined: not ours.
export function activeCount(sim, team, kind) {
  switch (kind) {
    case 'turret': return machines(sim, team, 'sentry');
    case 'rover': return machines(sim, team, 'rover');
    case 'dome': return machines(sim, team, 'dome');
    case 'airdrop': {
      let n = machines(sim, team, 'crate');
      for (const d of sim.v9.drops) if (d.team === team) n++;
      return n;
    }
    case 'sweep': for (const s of sim.v9.sweeps) if (s.team === team) return 1; return 0;
    case 'recon': return aircraft(sim, team, 'recon');
    case 'hound': return aircraft(sim, team, 'hound');
    case 'bombrun': {
      let n = aircraft(sim, team, 'reticle');
      for (const s of sim.strikes) if (s.kind === 'bombrun' && s.team === team) return n + 1;
      return n;
    }
    default: return undefined;
  }
}
function machines(sim, team, k) {
  let n = 0;
  for (const t of sim.turrets) if (t.team === team && kindOf(t) === k) n++;
  return n;
}
function aircraft(sim, team, k) {
  let n = 0;
  for (const g of sim.gunships) if (g.team === team && g.kind === k) n++;
  return n;
}

// ---------------------------------------------------------------- calling

export function createV9State() {
  return { sweeps: [], drops: [], nextDrop: 1, empLock: null };
}

// Fires a V9 kind. `spot` is the Airstrike-style target a bot's Carpet Line uses (sim._strikeTarget).
export function launch(sim, p, kind, spot) {
  switch (kind) {
    case 'sweep': return callSweep(sim, p);
    case 'recon': return callScout(sim, p);
    case 'airdrop': return callAirdrop(sim, p);
    case 'plates': return callPlates(sim, p);
    case 'hound': return callHound(sim, p);
    case 'dome': return callDome(sim, p);
    case 'bombrun': return callBombrun(sim, p, spot);
    case 'rover': return callRover(sim, p);
    default: return false;
  }
}

function emitStreak(sim, p, kind, extra) {
  sim._emit({ t: 'streak', id: p.id, kind, team: p.team, x: round2(p.ps.x), z: round2(p.ps.z), ...extra });
}

function callSweep(sim, p) {
  sim.v9.sweeps.push({ by: p, team: p.team, left: 2, t: 0 });
  emitStreak(sim, p, 'sweep');
}

// One pulse: every enemy within SWEEP_R of the caller goes on their minimap. Ghost is radar-proof; recon rules
// (Cold Blooded halves, Blank Slate ignores) come from the Sim's own 'marked' handling.
function sweepPulse(sim, s) {
  const o = s.by, x = o.ps.x, z = o.ps.z;
  sim._emit({ t: 'sweep', x: round2(x), z: round2(z), r: SWEEP_R, team: s.team, by: o.id });
  for (let i = 0; i < sim.players.length; i++) {
    const q = sim.players[i];
    if (q.team === s.team || !q.alive || q.dummy || q.ps.perks.includes('ghost')) continue;
    if (Math.hypot(q.ps.x - x, q.ps.z - z) > SWEEP_R) continue;
    sim._onEqEvent({ t: 'marked', id: q.id, by: o.id, dur: SWEEP_MARK, kind: 'sweep' });
  }
}

function callScout(sim, p) {
  const k = sim._engineerMult(p, ENGINEER_AIR);
  const g = { kind: 'recon', team: p.team, owner: p, x: p.ps.x, z: p.ps.z, aim: wrap(p.ps.aim), life: SCOUT_LIFE * k,
    hp: AIR_HP.recon * k, maxHp: AIR_HP.recon * k, age: 0, markT: 0, goalX: 0, goalZ: 0 };
  if (p.isBot) botScoutGoal(sim, g);
  sim.gunships.push(g);
  emitStreak(sim, p, 'recon');
}

// A bot pilot is honest: it flies toward the other half of the map (or what it last heard), not at anyone it knows.
function botScoutGoal(sim, g) {
  const o = g.owner, b = o.bot;
  if (b && b.hasKnown) { g.goalX = b.knownX; g.goalZ = b.knownZ; return; }
  g.goalX = sim.map.width - o.ps.x; g.goalZ = sim.map.height - o.ps.z;
}

function callAirdrop(sim, p) {
  const a = p.ps.aim, W = sim.map.width, H = sim.map.height;
  // A step ahead of the caller, on open ground if there is any.
  let x = p.ps.x + Math.cos(a) * 2.2, z = p.ps.z + Math.sin(a) * 2.2;
  if (raycastMap(sim.map, p.ps.x, p.ps.z, Math.cos(a), Math.sin(a), 2.6, 'blocksMove')) { x = p.ps.x; z = p.ps.z; }
  x = clamp(x, 1, W - 1); z = clamp(z, 1, H - 1);
  sim.v9.drops.push({ id: sim.v9.nextDrop++, by: p, team: p.team, x, z, at: sim.time + DROP_DELAY });
  sim._emit({ t: 'streak', id: p.id, kind: 'airdrop', team: p.team, x: round2(x), z: round2(z), delay: DROP_DELAY });
}

function callPlates(sim, p) {
  emitStreak(sim, p, 'plates');
  for (let i = 0; i < sim.players.length; i++) {
    const q = sim.players[i];
    if (q.team !== p.team || !q.alive || Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z) > PLATE_RADIUS) continue;
    q.plates = PLATES;
    sim._emit({ t: 'plates', id: q.id, by: p.id });
  }
}

function callHound(sim, p) {
  const k = sim._engineerMult(p, ENGINEER_AIR);
  sim.gunships.push({ kind: 'hound', team: p.team, owner: p, x: p.ps.x, z: p.ps.z, aim: wrap(p.ps.aim), life: HOUND_LIFE * k,
    hp: AIR_HP.hound * k, maxHp: AIR_HP.hound * k, age: 0, target: null, retarget: 0, burstLeft: 0, cooldown: 0, pause: 0.6 });
  emitStreak(sim, p, 'hound');
}

function callDome(sim, p) {
  const k = sim._engineerMult(p, ENGINEER_TURRET);
  const t = machine(sim, p, 'dome', p.ps.x, p.ps.z, DOME_HP * k, DOME_LIFE * k);
  t.zapT = 0;
  emitStreak(sim, p, 'dome', { r: DOME_R });
}

function callRover(sim, p) {
  const k = sim._engineerMult(p, ENGINEER_TURRET);
  const t = machine(sim, p, 'rover', p.ps.x, p.ps.z, ROVER_HP * k, ROVER_LIFE * k);
  t.path = []; t.pathN = 0; t.pathK = 0; t.repath = 0; t.vx = 0; t.vz = 0;
  sim._emit({ t: 'turret', id: t.id, team: t.team, x: round2(t.x), z: round2(t.z), kind: 'rover' });
  emitStreak(sim, p, 'rover');
}

function machine(sim, p, kind, x, z, hp, life) {
  const t = { id: sim.nextTurretId++, kind, team: p.team, owner: p, x, z, aim: wrap(p.ps.aim), hp, maxHp: hp, life,
    thinkT: 0, cooldown: 0.5, target: null };
  sim.turrets.push(t);
  return t;
}

// A human draws the line with a reticle; a bot (or a human the host refuses to wait for) gets the line at once.
function callBombrun(sim, p, spot) {
  if (p.isBot) {
    const half = BOMB_DEFAULT_LINE / 2, x = spot.x, z = spot.z;
    return commitLine(sim, p, [x - spot.dx * half, z - spot.dz * half, x + spot.dx * half, z + spot.dz * half]);
  }
  const a = p.ps.aim;
  sim.gunships.push({ kind: 'reticle', team: p.team, owner: p, aim: wrap(a), life: RETICLE_LIFE, hp: Infinity, maxHp: Infinity,
    x: clamp(p.ps.x + Math.cos(a) * RETICLE_START, 1, sim.map.width - 1), z: clamp(p.ps.z + Math.sin(a) * RETICLE_START, 1, sim.map.height - 1),
    path: [], done: false, held: false });
  sim._emit({ t: 'streak_aim', id: p.id, kind: 'bombrun', team: p.team });
}

// The aim stick let go while drawing: the host drops the line on its next step.
export function releaseAim(sim, id) {
  const g = sim.gunships.find(o => o.kind === 'reticle' && o.owner.id === id);
  if (!g) return false;
  g.done = true;
  return true;
}

// Resamples the drawn polyline into bombs every BOMB_SPACING, at most BOMB_MAX of them, and queues them.
function commitLine(sim, p, path) {
  const pts = [];
  let carry = 0;
  for (let i = 0; i + 3 < path.length && pts.length < BOMB_MAX * 2; i += 2) {
    const ax = path[i], az = path[i + 1], bx = path[i + 2], bz = path[i + 3], len = Math.hypot(bx - ax, bz - az);
    let u = carry;
    while (u <= len && pts.length < BOMB_MAX * 2) { pts.push(ax + (bx - ax) * u / len, az + (bz - az) * u / len); u += BOMB_SPACING; }
    carry = u - len;
  }
  if (pts.length === 0) pts.push(path[0], path[1]);
  const W = sim.map.width, H = sim.map.height;
  for (let i = 0, k = 0; i < pts.length; i += 2, k++) {
    const x = clamp(pts[i], 1, W - 1), z = clamp(pts[i + 1], 1, H - 1), delay = BOMB_DELAY + k * BOMB_STEP;
    sim.strikes.push({ kind: 'bombrun', team: p.team, by: p, x, z, at: sim.time + delay, radius: BOMB_RADIUS, damage: BOMB_DAMAGE });
    sim._emit({ t: 'incoming', kind: 'bombrun', x: round2(x), z: round2(z), delay: round2(delay), team: p.team });
  }
  sim._emit({ t: 'streak', id: p.id, kind: 'bombrun', team: p.team, x: round2(pts[0]), z: round2(pts[1]), path: pts.map(round2), delay: BOMB_DELAY });
  return true;
}

// ---------------------------------------------------------------- stepping

// Everything V9 that is not an aircraft or a machine: sweeps, falling crates, the EMP lock clock.
export function stepV9(sim) {
  const v = sim.v9;
  for (let i = v.sweeps.length - 1; i >= 0; i--) {
    const s = v.sweeps[i];
    s.t -= STEP;
    if (s.t > 0) continue;
    if (s.by.alive) sweepPulse(sim, s);
    s.t = SWEEP_GAP;
    if (--s.left <= 0) v.sweeps.splice(i, 1);
  }
  for (let i = v.drops.length - 1; i >= 0; i--) {
    const d = v.drops[i];
    if (d.at > sim.time) continue;
    v.drops.splice(i, 1);
    const t = machine(sim, d.by, 'crate', d.x, d.z, CRATE_HP, CRATE_LIFE);
    t.team = d.team; t.open = 0; t.opener = null;
    sim._emit({ t: 'crate', id: t.id, team: t.team, x: round2(t.x), z: round2(t.z) });
  }
  if (v.empLock) for (let t = 0; t < v.empLock.length; t++) if (v.empLock[t] > 0) v.empLock[t] = Math.max(0, v.empLock[t] - STEP);
}

// Per machine, from sim._stepTurrets before its own life and fire logic. Returns true when the Sim should skip the
// sentry fire step for it this tick (domes and crates never shoot).
export function stepMachine(sim, t) {
  switch (kindOf(t)) {
    case 'rover': driveRover(sim, t); return false;
    case 'dome': stepDome(sim, t); return true;
    case 'crate': stepCrate(sim, t); return true;
    default: return false;
  }
}

function stepDome(sim, t) {
  t.zapT -= STEP;
  if (t.zapT > 0) return;
  const list = sim.eq.projectiles;
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (q.dead || !DOME_ZAPS.has(q.kind)) continue;
    const team = q.team ?? sim.byId.get(q.owner)?.team;
    if (team === t.team || Math.hypot(q.x - t.x, q.z - t.z) > DOME_R) continue;
    q.dead = true;
    t.zapT = DOME_ZAP;
    sim._emit({ t: 'zap', x: round2(q.x), z: round2(q.z), ox: round2(t.x), oz: round2(t.z), by: t.owner.id, kind: 'dome' });
    return;
  }
}

// Whoever stands on it opens it: the caller's side quickly, the other side slowly. Both sides on it: nobody.
function stepCrate(sim, t) {
  let mine = null, theirs = null;
  for (let i = 0; i < sim.players.length; i++) {
    const q = sim.players[i];
    if (!q.alive || q.dummy || Math.hypot(q.ps.x - t.x, q.ps.z - t.z) > CRATE_REACH) continue;
    if (q.team === t.team) mine ??= q; else theirs ??= q;
  }
  const who = mine && theirs ? null : mine ?? theirs;
  if (!who) { t.open = Math.max(0, t.open - STEP); t.aim = 0; return; }
  if (t.opener !== who) { t.opener = who; t.open = 0; }
  const need = who.team === t.team ? OPEN_OWN : OPEN_ENEMY;
  t.open += STEP;
  t.aim = (who.team === t.team ? 1 : -1) * Math.min(1, t.open / need);   // Progress for the drawing, on the wire.
  if (t.open < need) return;
  openCrate(sim, t, who);
}

function openCrate(sim, t, who) {
  const strikeAt = sim._strikeTarget(who);
  const pool = AIRDROP_POOL.filter(([k]) => !sim.streakDenied(who, k) && (k !== 'strike' || strikeAt));
  let kind = 'uav';
  if (pool.length) {
    let sum = 0;
    for (const [, w] of pool) sum += w;
    let r = sim.rng() * sum;
    for (const [k, w] of pool) { kind = k; if ((r -= w) < 0) break; }
  }
  const stolen = who.team !== t.team;
  sim._emit({ t: 'crate_open', id: who.id, owner: t.owner.id, kind, stolen, x: round2(t.x), z: round2(t.z), team: who.team });
  // Gone without a turret_down (that is the sound and burst of something destroyed); crate_open draws and plays it.
  const i = sim.turrets.indexOf(t);
  if (i >= 0) sim.turrets.splice(i, 1);
  t.hp = 0;
  sim._callStreak(who, kind, kind === 'strike' ? strikeAt : null);
}

// Drives at the nearest enemy its team can see (Cold Blooded hides until close), stops in range with a clear shot, and
// otherwise trails its owner. Paths come from the nav grid every ROVER_REPATH seconds.
function driveRover(sim, t) {
  t.repath -= STEP;
  if (t.repath <= 0) {
    t.repath = ROVER_REPATH;
    const q = sim._seekerMark(t.team, t.x, t.z, t.chase);
    t.chase = q;
    let gx = null, gz = null;
    if (q) { gx = q.ps.x; gz = q.ps.z; }
    else if (t.owner.alive && Math.hypot(t.owner.ps.x - t.x, t.owner.ps.z - t.z) > 5) { gx = t.owner.ps.x; gz = t.owner.ps.z; }
    t.pathN = 0; t.pathK = 0;
    if (gx !== null && sim.nav) t.pathN = sim.nav.findPath(t.x, t.z, gx, gz, t.path, 8, t.team);
    else if (gx !== null) { t.path[0] = gx; t.path[1] = gz; t.pathN = 1; }
  }
  const q = t.chase && t.chase.alive ? t.chase : null;
  // In range with a clear view: park and let the gun work.
  if (q && Math.hypot(q.ps.x - t.x, q.ps.z - t.z) < ROVER_STOP && hasLineOfSight(sim.map, t.x, t.z, q.ps.x, q.ps.z, sim.eq.smokes)) { t.vx = 0; t.vz = 0; return; }
  if (t.pathK >= t.pathN) { t.vx = 0; t.vz = 0; return; }
  const px = t.path[t.pathK * 2], pz = t.path[t.pathK * 2 + 1];
  const dx = px - t.x, dz = pz - t.z, d = Math.hypot(dx, dz);
  if (d < 0.4) { t.pathK++; return; }
  const m = Math.min(ROVER_SPEED * STEP, d), ux = dx / d, uz = dz / d;
  if (raycastMap(sim.map, t.x, t.z, ux, uz, m + 0.5, 'blocksMove')) { t.pathK++; t.repath = Math.min(t.repath, 0.2); return; }
  t.x += ux * m; t.z += uz * m; t.vx = ux * ROVER_SPEED; t.vz = uz * ROVER_SPEED;
  if (!t.target) t.aim = wrap(t.aim + clamp(angleDiff(Math.atan2(uz, ux), t.aim), -0.15, 0.15));
}

// Aircraft. Called by sim._stepGunships for the V9 kinds; returns true when it should leave the list.
export function stepAir(sim, g) {
  switch (g.kind) {
    case 'recon': return stepScout(sim, g);
    case 'hound': return stepHound(sim, g);
    case 'reticle': return stepReticle(sim, g);
    default: return false;
  }
}

// The aim stick flies it while held; let go and it hovers. A bot flies it toward its goal with a weave.
function stepScout(sim, g) {
  g.age += STEP;
  const o = g.owner;
  let fly = false, want = g.aim;
  if (o.isBot) {
    if (Math.hypot(g.goalX - g.x, g.goalZ - g.z) < 3) {      // Reached it: on to somewhere else in the middle of the map.
      g.goalX = sim.map.width * (0.2 + sim.rng() * 0.6); g.goalZ = sim.map.height * (0.2 + sim.rng() * 0.6);
    }
    want = Math.atan2(g.goalZ - g.z, g.goalX - g.x) + Math.sin(g.age * 1.7) * 0.5; fly = true;
  } else if (o.alive && steering(o)) { want = o.ps.aim; fly = true; }
  if (fly) {
    // A human pilot gets the turn at once (the stick's direction is the drone's); a bot weaves at a drone's pace.
    const turn = (o.isBot ? SCOUT_TURN_BOT : SCOUT_TURN) * STEP;
    g.aim = wrap(g.aim + clamp(angleDiff(want, g.aim), -turn, turn));
    g.x = clamp(g.x + Math.cos(g.aim) * SCOUT_SPEED * STEP, 0.5, sim.map.width - 0.5);
    g.z = clamp(g.z + Math.sin(g.aim) * SCOUT_SPEED * STEP, 0.5, sim.map.height - 0.5);
  }
  g.markT -= STEP;
  if (g.markT <= 0) {
    g.markT = SCOUT_EVERY;
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      if (q.team === g.team || !q.alive || q.dummy) continue;
      if (Math.hypot(q.ps.x - g.x, q.ps.z - g.z) > SCOUT_EYE) continue;
      sim._onEqEvent({ t: 'marked', id: q.id, by: o.id, dur: SCOUT_MARK, kind: 'recon' });
    }
  }
  return false;
}

function stepHound(sim, g) {
  g.age += STEP;
  const o = g.owner;
  g.retarget -= STEP;
  if (g.retarget <= 0) {
    g.retarget = 0.3;
    g.target = houndTarget(sim, g);
  }
  // Station: at the owner's shoulder, a little behind their aim; with them dead, it holds where it is.
  if (o.alive) {
    const a = o.ps.aim + 2.4, sx = o.ps.x + Math.cos(a) * HOUND_OFFSET, sz = o.ps.z + Math.sin(a) * HOUND_OFFSET;
    const dx = sx - g.x, dz = sz - g.z, d = Math.hypot(dx, dz);
    if (d > 0.1) {
      const m = Math.min(HOUND_SPEED * STEP * (d > 6 ? 1.6 : 1), d);
      g.x = clamp(g.x + dx / d * m, 0.5, sim.map.width - 0.5); g.z = clamp(g.z + dz / d * m, 0.5, sim.map.height - 0.5);
    }
  }
  const q = g.target && g.target.alive ? g.target : null;
  if (q) g.aim = Math.atan2(q.ps.z - g.z, q.ps.x - g.x);
  else if (o.alive) g.aim = wrap(g.aim + clamp(angleDiff(o.ps.aim, g.aim), -0.2, 0.2));
  if (g.burstLeft > 0) {
    g.cooldown -= STEP;
    if (g.cooldown <= 0) { g.cooldown = HOUND_GAP; g.burstLeft--; houndRound(sim, g, q); }
    return false;
  }
  g.pause -= STEP;
  if (g.pause <= 0 && q) { g.burstLeft = HOUND_BURST; g.cooldown = 0; g.pause = HOUND_PAUSE; }
  return false;
}

// Nearest enemy within reach that the drone itself can see. Cold Blooded only once close to it.
function houndTarget(sim, g) {
  let best = null, bestD = HOUND_RANGE;
  for (let i = 0; i < sim.players.length; i++) {
    const q = sim.players[i];
    if (q.team === g.team || !q.alive || q.spawnProtect > 0 || q.dummy || sim._coldHidden(q, g.x, g.z)) continue;
    const d = Math.hypot(q.ps.x - g.x, q.ps.z - g.z);
    if (d < bestD && hasLineOfSight(sim.map, g.x, g.z, q.ps.x, q.ps.z, sim.eq.smokes)) { bestD = d; best = q; }
  }
  return best;
}

const POS = { x: 0, z: 0, sliding: false };
const HOUND_GUN = { range: HOUND_RANGE + 4, penetrate: 0.5 };
function houndRound(sim, g, q) {
  if (!q) { g.burstLeft = 0; return; }
  sim.posAt(q, HOUND_LAG, POS);
  const angle = Math.atan2(POS.z - g.z, POS.x - g.x) + bell(sim.rng) * HOUND_SPREAD;
  const dx = Math.cos(angle), dz = Math.sin(angle), reach = HOUND_RANGE + 4;
  const wall = raycastMap(sim.map, g.x, g.z, dx, dz, reach, 'blocksBullet');
  let bestT = wall ? wall.t : reach, victim = null;
  for (let i = 0; i < sim.players.length; i++) {
    const v = sim.players[i];
    if (v.team === g.team || !v.alive) continue;
    const hit = rayCircle(g.x, g.z, dx, dz, v.ps.x, v.ps.z, PLAYER_RADIUS + (v.ps.sliding ? 0 : 0.1));
    if (hit >= 0 && hit < bestT) { bestT = hit; victim = v; }
  }
  let pen = 1;
  if (victim) { pen = shotPassage(sim.map, g.x, g.z, g.x + dx * bestT, g.z + dz * bestT, HOUND_GUN); if (pen <= 0) victim = null; }
  sim._emit({ t: 'turret_shot', kind: 'hound', ox: round2(g.x), oz: round2(g.z), x: round2(g.x + dx * bestT), z: round2(g.z + dz * bestT) });
  if (victim) sim._damage(victim, g.owner, HOUND_DAMAGE * pen, g.owner.ps.weapon, bestT, 'hound');
}

function bell(rng) { return (rng() + rng() + rng() - 1.5) / 1.5; }

// The reticle moves where the aim stick points while it is held, laying the path. Returns true once the line is down.
function stepReticle(sim, g) {
  const o = g.owner;
  if (!o.alive) return true;                     // The pilot died drawing it: nothing drops, the streak is spent.
  const held = steering(o);
  if (held) {
    if (!g.held) { g.held = true; if (g.path.length === 0) g.path.push(g.x, g.z); }
    g.aim = o.ps.aim;
    g.x = clamp(g.x + Math.cos(g.aim) * RETICLE_SPEED * STEP, 1, sim.map.width - 1);
    g.z = clamp(g.z + Math.sin(g.aim) * RETICLE_SPEED * STEP, 1, sim.map.height - 1);
    const n = g.path.length;
    if (Math.hypot(g.x - g.path[n - 2], g.z - g.path[n - 1]) >= 1) g.path.push(round2(g.x), round2(g.z));
    if (lineLength(g.path) >= BOMB_SPACING * (BOMB_MAX - 1)) g.done = true;
  } else if (g.held && lineLength(g.path) >= BOMB_MIN_LINE) g.done = true;      // Let go after drawing: drop it.
  if (!g.done) return false;
  finishReticle(sim, g);
  return true;
}

// Out of time or released: the drawn path, or with too little drawn a straight line through the reticle along its aim.
export function finishReticle(sim, g) {
  let path = g.path;
  if (path.length < 4 || lineLength(path) < BOMB_MIN_LINE) {
    const half = BOMB_DEFAULT_LINE / 2, dx = Math.cos(g.aim), dz = Math.sin(g.aim);
    path = [g.x - dx * half, g.z - dz * half, g.x + dx * half, g.z + dz * half];
  }
  commitLine(sim, g.owner, path);
}

function lineLength(path) {
  let n = 0;
  for (let i = 0; i + 3 < path.length; i += 2) n += Math.hypot(path[i + 2] - path[i], path[i + 3] - path[i + 1]);
  return n;
}

// ---------------------------------------------------------------- shooting things down

export function airHp(g) {
  if (g.hp === undefined) {
    const base = AIR_HP[g.kind] ?? 100, k = g.owner?.ps?.perks?.includes('engineer') ? ENGINEER_AIR : 1;
    g.hp = g.maxHp = base * k;
  }
  return g.hp;
}

// Distance from a point to a segment (2D).
function ptSeg(px, pz, x0, z0, x1, z1) {
  const ux = x1 - x0, uz = z1 - z0, l2 = ux * ux + uz * uz || 1e-9;
  const u = clamp(((px - x0) * ux + (pz - z0) * uz) / l2, 0, 1);
  return Math.hypot(px - x0 - ux * u, pz - z0 - uz * u);
}

// Shortest distance from segment A to segment B (2D).
function segSeg(ax, az, bx, bz, cx, cz, dx, dz) {
  const p = ptSeg;
  // Crossing segments are distance 0.
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(p(ax, az, cx, cz, dx, dz), p(bx, bz, cx, cz, dx, dz), p(cx, cz, ax, az, bx, bz), p(dx, dz, ax, az, bx, bz));
}

// Gunfire against enemy aircraft: each ray chips every aircraft whose capsule it passes. A launcher's rocket is a
// lock-on round in effect: it hits the aircraft it passes for LAUNCHER_AIR times its damage (and still bursts below).
export function shootAir(sim, shooter, shot, rays, w) {
  const list = sim.gunships, launcher = !!w.explosive;
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i];
    if (g.kind === 'reticle' || g.team === shooter.team || !(g.kind in AIR_HP)) continue;
    const r = AIR_R[g.kind] + (launcher ? 0.8 : 0), lift = AIR_Y[g.kind] * TILT_K;
    let dmg = 0;
    for (let k = 0; k < rays.length; k++) {
      const ray = rays[k];
      // A launcher round can climb to it; a bullet's ray is cut by the wall it stopped at, so cover still covers.
      const ex = ray.x, ez = ray.z;
      if (segSeg(shot.ox, shot.oz, ex, ez, g.x, g.z, g.x, g.z - lift) > r) continue;
      dmg += launcher ? w.explosive.damage * LAUNCHER_AIR : (w.damage ?? 20) * BULLET_AIR;
      if (launcher) break;
    }
    if (dmg > 0) hurtAir(sim, g, dmg, shooter);
  }
}

export function hurtAir(sim, g, dmg, by) {
  airHp(g);
  g.hp -= dmg;
  if (by && by.team !== g.team && dmg > 0) streakHit(sim, by, g.kind, g.hp / g.maxHp, g.x, g.z);
  if (g.hp > 0) return false;
  const i = sim.gunships.indexOf(g);
  if (i < 0) return true;
  sim._emit({ t: 'air_down', kind: g.kind, team: g.team, owner: g.owner.id, by: by ? by.id : null, x: round2(g.x), z: round2(g.z) });
  if (g.kind === 'swarm') sim._emit({ t: 'drone_down', x: round2(g.x), z: round2(g.z), team: g.team });
  sim._dropAir(i);
  if (by && by.team !== g.team) reward(sim, by, g.kind, true);
  return true;
}

// A hit on an enemy streak, for the one who landed it: the HUD's hit marker and the target's health bar (roadmap 40).
// hpf is what is left (0 or less: this hit brought it down).
export function streakHit(sim, by, kind, hpf, x, z) {
  sim._emit({ t: 'streak_hit', by: by.id, kind, hpf: round2(Math.max(0, hpf)), x: round2(x), z: round2(z) });
}

// Streak score for bringing one down: more for dearer ones. A swarm drone is a third of its swarm.
function reward(sim, by, kind, air) {
  const cost = STREAKS[kind]?.cost ?? 1500;
  let pts = Math.max(air ? SCORE.shootdown / 2 : SCORE.destroy, Math.round(cost / 20 / 10) * 10);
  if (kind === 'swarm') pts = Math.round(pts / 30) * 10;
  addScore(by.score, pts);
  sim._medal(by, air ? 'shootdown' : 'destroyed');
}

// A ground machine killed by an enemy's gunfire or blast: the medal and the score.
export function machineDestroyed(sim, t, by) {
  if (!by || by.team === t.team) return;
  const k = kindOf(t);
  reward(sim, by, k === 'sentry' ? 'turret' : k === 'crate' ? 'airdrop' : k, false);
}

// ---------------------------------------------------------------- Aegis Dome and Plate Drop

// True when a living Dome of `team` covers (x, z). Blasts from outside on its team inside are stopped.
export function domeCovers(sim, x, z, team) {
  const list = sim.turrets;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.kind === 'dome' && t.team === team && Math.hypot(x - t.x, z - t.z) <= DOME_R) return true;
  }
  return false;
}

// Plates soak after Juggernaut armour. Returns what is left for health.
export function soakPlates(sim, target, dmg, weapon, streak, equip) {
  const blast = (equip && EQUIPMENT[equip]?.blast) || ['strike', 'mortar', 'gunship', 'missile', 'swarm', 'bombrun'].includes(streak)
    || (!streak && !equip && WEAPONS[weapon]?.explosive);
  const k = blast ? PLATE_BLAST : 1;
  const taken = Math.min(target.plates, dmg * k);
  target.plates -= taken;
  if (taken > 0) sim._soaked = true;
  if (target.plates < 0.5) {
    target.plates = 0;
    sim._emit({ t: 'plates_break', id: target.id, x: round2(target.ps.x), z: round2(target.ps.z) });
  }
  return dmg - taken / k;
}

// ---------------------------------------------------------------- EMP (reworked)

export function empBlast(sim, p) {
  const own = p.team;
  const v = sim.v9;
  if (!v.empLock) v.empLock = new Array(sim.teamCount).fill(0);
  const eng = q => q && q.ps.perks.includes('engineer');
  for (let i = sim.turrets.length - 1; i >= 0; i--) {
    const t = sim.turrets[i];
    if (t.team === own) continue;
    if (eng(t.owner) && kindOf(t) !== 'crate') { t.life *= 0.5; t.hp *= 0.5; continue; }   // Hardened: it limps on.
    if (kindOf(t) !== 'crate') sim._removeTurret(t);
  }
  for (let i = sim.gunships.length - 1; i >= 0; i--) {
    const g = sim.gunships[i];
    if (g.team === own) continue;
    if (eng(g.owner) && g.kind !== 'reticle') { airHp(g); g.life *= 0.5; g.hp *= 0.5; continue; }
    sim._emit({ t: 'air_down', kind: g.kind, team: g.team, owner: g.owner.id, by: null, emp: true, x: round2(g.x), z: round2(g.z) });
    sim._dropAir(i);
  }
  sim.strikes = sim.strikes.filter(s => !(s.team !== own && (s.kind === 'strike' || s.kind === 'bombrun')));
  v.sweeps = v.sweeps.filter(s => s.team === own);
  for (let enemy = 0; enemy < sim.teamCount; enemy++) if (enemy !== own) v.empLock[enemy] = EMP_LOCK;
  // Enemy kit goes dark, as if every one of them stood in a Blackout. Engineers are immune, as they are to Blackout.
  for (let i = 0; i < sim.players.length; i++) {
    const q = sim.players[i];
    if (q.team === own || !q.alive || q.dummy || eng(q)) continue;
    sim._onEqEvent({ t: 'jammed', id: q.id, by: p.id, dur: EMP_KIT, kind: 'emp' });
  }
}

export function empLocked(sim, team) { return !!(sim.v9.empLock && sim.v9.empLock[team] > 0); }

// ---------------------------------------------------------------- views and wire

const NEW_AIR_VIEW = new Set(['recon', 'hound', 'reticle']);

// Host view: the lists as they always were, plus the V9 ones.
export function viewLists(sim, view) {
  const tu = [], de = [], gs = [], dr = [];
  for (const t of sim.turrets) {
    const k = kindOf(t);
    const row = { id: t.id, team: t.team, owner: t.owner.id, x: t.x, z: t.z, aim: t.aim, hp: Math.ceil(t.hp), life: t.life };
    if (k === 'sentry') tu.push(row); else { row.kind = k; row.maxHp = t.maxHp; de.push(row); }
  }
  for (const g of sim.gunships) {
    const row = { kind: g.kind, team: g.team, owner: g.owner.id, x: g.x, z: g.z, aim: g.aim, life: g.life, hpf: hpFrac(g) };
    (NEW_AIR_VIEW.has(g.kind) ? dr : gs).push(row);
  }
  view.turrets = tu; view.deploys = de; view.gunships = gs; view.drones = dr;
  for (const v of view.players) v.plates = Math.ceil(sim.byId.get(v.id)?.plates ?? 0);
  const lock = sim.v9.empLock;
  view.empLock = lock ? lock.slice() : new Array(sim.teamCount).fill(0);
}

function hpFrac(g) {
  if (g.kind === 'reticle') return 1;
  airHp(g);
  return Math.max(0, Math.min(1, g.hp / g.maxHp));
}

// Wire rows. Turrets: [id, owner, x, z, aim, hp, life, kind]; aircraft: [owner, x, z, aim, life, kind, hp%].
export function turretRow(t) {
  return [t.id, t.owner.index, Math.round(t.x * 10), Math.round(t.z * 10), Math.round(t.aim * 20), Math.ceil(t.hp), Math.round(t.life * 10), TURRET_KINDS.indexOf(kindOf(t))];
}
export function airRow(g, kinds) {
  return [g.owner.index, Math.round(g.x * 10), Math.round(g.z * 10), Math.round(g.aim * 20), Math.round(g.life * 10), kinds.indexOf(g.kind), Math.round(hpFrac(g) * 100)];
}
export const TURRET_STRIDE = 8, AIR_STRIDE = 7;

// Guest view: move the V9 rows out of the old lists, and Plate Drop rows onto their players.
export function splitView(view) {
  const tl = view.turrets, de = [];
  let n = 0;
  for (let i = 0; i < tl.length; i++) {
    const t = tl[i];
    if (!t.kind || t.kind === 'sentry') { delete t.kind; tl[n++] = t; continue; }
    de.push(t);
  }
  tl.length = n;
  const gl = view.gunships, dr = [];
  for (let i = 0; i < view.players.length; i++) view.players[i].plates = 0;
  n = 0;
  for (let i = 0; i < gl.length; i++) {
    const g = gl[i];
    if (g.kind === 'plates') { const v = view.players.find(q => q.id === g.owner); if (v) v.plates = Math.round(g.life); continue; }
    if (NEW_AIR_VIEW.has(g.kind)) { dr.push(g); continue; }
    gl[n++] = g;
  }
  gl.length = n;
  view.deploys = de; view.drones = dr;
}

// Host migration: the V9 rows back into the Sim's lists. Called after the Sim has rebuilt its own.
export function restore(sim, view) {
  for (const t of view.deploys ?? []) {
    const owner = sim.byId.get(t.owner);
    if (!owner) continue;
    const m = { id: t.id, kind: t.kind, team: t.team, owner, x: t.x, z: t.z, aim: t.aim, hp: t.hp, maxHp: t.maxHp ?? t.hp, life: t.life ?? 10,
      thinkT: 0, cooldown: 0.4, target: null, zapT: 0, open: 0, opener: null, path: [], pathN: 0, pathK: 0, repath: 0, vx: 0, vz: 0 };
    sim.turrets.push(m);
  }
  sim.nextTurretId = sim.turrets.reduce((m, t) => Math.max(m, t.id + 1), 1);
  for (const g of view.drones ?? []) {
    const owner = sim.byId.get(g.owner);
    if (!owner || g.kind === 'reticle') continue;      // A line being drawn is lost with the old host.
    const hp = (AIR_HP[g.kind] ?? 100) * (g.hpf ?? 1);
    sim.gunships.push({ kind: g.kind, team: g.team, owner, x: g.x, z: g.z, aim: g.aim, life: g.life ?? 5, hp, maxHp: AIR_HP[g.kind] ?? 100,
      age: 1, markT: 0, goalX: g.x, goalZ: g.z, target: null, retarget: 0, burstLeft: 0, cooldown: 0, pause: 0.5 });
  }
  for (const g of sim.gunships) if (g.hpf !== undefined) { airHp(g); g.hp = g.maxHp * g.hpf; delete g.hpf; }
  for (const v of view.players ?? []) { const p = sim.byId.get(v.id); if (p) p.plates = v.plates ?? 0; }
  if (view.empLock) sim.v9.empLock = view.empLock.slice();
}

