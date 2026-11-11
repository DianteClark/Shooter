// Grenades and other thrown equipment. Host-only, pure, runs in node: no DOM, no three, no randomness.
//
// Interface (sim.js owns one instance per match):
//   const eq = new EquipmentSystem(map);
//   eq.throw(owner, kind, ox, oz, aim, dist)  owner is a player id, or {id, team}. kind: any id in EQUIPMENT that a
//                                        loadout can hold. dist (optional, metres) is where it should end up on open
//                                        ground; absent means the default range. Does not check counts: the caller does.
//   previewThrow(map, ox, oz, aim, dist, kind, perks)   the same throw run forward: polyline, bounces and landing.
//   landingOf(map, ox, oz, aim, dist, kind, perks)      just the landing of that throw, with no allocation (bots).
//                                        perks: the thrower's perk list. Strong Arm throws higher as well as further,
//                                        so a preview without the thrower's perks does not match a Strong Arm throw.
//   throwArc(dist, perks), arcHeight(u, arc)   the height profile every throw flies; see HEIGHT PROFILE below.
//   eq.step(dt, players, onEvent, onDamage)
//       players    [{id, team, x, z, alive, perks?, spawnProtect?}], the flat shape traceShot takes.
//       onEvent(e) {t:'throw',id,kind,ox,oz,aim}    queued by throw(), delivered on the next step
//                  {t:'heal',id,amount}             the caller adds amount to HP, capped at MAX_HP
//                  {t:'bang',kind,x,z,r,by}         anything that goes off
//                  {t:'flashed',id,amount,dur,by}   amount 0..1, dur = seconds of blindness
//                  {t:'pulse',kind,x,z,r,by}        a Sensor reading, no damage and no flash
//                  {t:'marked',id,by,dur}           the sim shows that enemy to the thrower's team for dur seconds
//                  {t:'decoy',x,z,by,weapon}        one fake gunshot from a Decoy
//                  {t:'zap',x,z,ox,oz,by}           a Trophy shooting something down
//                  {t:'gear',kind,x,z,r,by,...}     a pop that does no blast damage (Stun, Gas, each Shock arc, a Drill
//                                                   biting into a wall); renderers must NOT draw an explosion for it
//                  {t:'dazed',id,amount,dur,by,kind} slowed and dragging aim for dur seconds (player.js applyDaze)
//                  {t:'fried',x,z,by,kind}          a Shock arc destroying an enemy device of that kind
//       onDamage(targetId, dmg, ownerId, kind)      Flak is ALREADY applied. Never called for the
//                                                   owner or the owner's team. dmg is a whole number.
//   eq.projectiles   live [{id,kind,x,z,y,owner,...}]  matches GameView.projectiles
//   eq.smokes        live [{id,x,z,r,a}]               pass straight to hasLineOfSight / smokeBlocks; a = opacity 0..1
//   eq.reset()       drops everything in flight (between rounds)
//   eq.setOffMines(x, z, r)   any explosion of radius r at (x, z): every mine in reach with a clear line goes off a
//                    moment later, whoever owns it. Grenade blasts call this themselves, so mines chain; the sim calls
//                    it for rockets, airstrikes and mortars.
//
// Pro (js/shared/catalog.js PRO): Fastball (Strong Arm Pro) flies a throw THROW_QUICK times faster to the same spot,
// so it lands and goes off sooner; previewThrow/landingOf take the thrower's `pro` list too and report the blast radius.
// Blank Slate (Cold Blooded Pro) players are never marked by a Sensor; players entries may carry `pro` for that.
//
// A Strike or other host-side explosion can share the falloff through blastDamage() and flakMult().
//
// V8: Stun, Gas, Shock (tacticals), Impact, Claymore, Drill (lethals).
// - A stuck Claymore keeps its facing in vx, vz as a unit vector (and in `dir`): nothing stuck ever moves, and the
//   facing then rides the existing snapshot and host-migration fields with no format change.
// - A Drill that sticks to a wall bores through up to DRILL_DEPTH of solid and goes off just past the far face;
//   previewThrow and landingOf report that point as the landing, so the HUD ring and bots aim at the real blast.
//
// Gear wave (2026-11): Snapshot, Blackout, Bulwark, Tagger, Medpack (tacticals), Satchel ('charge'), Thermite,
// Tripwire, Crawler, Shiv (lethals); Sensor reworked into a planted pinger, Sticky and Tagger stick to people.
//   more onEvent shapes  {t:'stuck',id,by,kind}         a Sticky or Tagger landed on player id
//                        {t:'jammed',id,by,dur}         a Blackout caught that enemy: no equipment, no minimap
//                        {t:'heal',id,amount,by,kind}   a Medpack tick (kind 'medpack'); Stim has no by/kind
//                        {t:'pickup',id,kind}           the owner walked over their Shiv and takes it back
//                        {t:'popped',kind,x,z,by}       a device destroyed by gunfire or burnt out (no blast)
//   eq.detonate(ownerId)  sets off that owner's armed Satchels; returns how many. eq.remoteOf(ownerId) -> count.
//   eq.shootDevices(...)  / eq.shootCover(...)  gunfire against enemy devices and Bulwarks (sim.applyShot).
//   syncCover(map, list)  keeps a waist-high wall in map.walls for every standing Bulwark (host and guests alike).
//   tripBeam(map, x, z, vx, vz, out)  a Tripwire's beam from its wire fields (renderer and bots draw/avoid it).
// Players entries may also carry `aim` (Shiv back hits) and `room` (has space for one more of its own lethal).
//
// Entries with `noThrow` (fire, bomblet) are the things a throw turns into. They live in the same list as everything
// else, so snapshots, host migration and the renderer's grenade dots all cover them without knowing they exist.

import { MAX_HP, SIM_HZ } from '../shared/constants.js';
import { hasLineOfSight, raycastMap, resolveCircle, wallsInBox, wallsOnRay, wallScratch } from '../shared/geometry.js';

export const THROW_RANGE = 13;           // Base maximum, and where a quick tap lands.
export const STRONGARM_RANGE = 19;       // Maximum with the Strong Arm perk.
export const MIN_THROW = 2;
export const FLAK_MULT = 0.55;

const THROW_SPEED = 15;
const STEP = 1 / SIM_HZ;                 // The host integrates throws at this rate, and so does the preview.

// HEIGHT PROFILE. A throw leaves the hand at RELEASE_Y and comes down at the end of its `air` time along
//   y(u) = RELEASE_Y (1 - u) + arc 4u(1 - u),   u = age / air
// `arc` grows with the distance asked for, and grows faster with Strong Arm. In flight a throw clears any wall whose
// top (`h`) is below the arc where it crosses the wall's face; it lands beyond if it still has the distance. ROOFED
// kinds (buildings and the map border) stop a throw at any height: nothing is lobbed over a building or out of the map.
// Base throws top out near 2.1 m at full range, under every wall and container, so they still only clear waist-high
// cover and low rocks. Strong Arm tops out near 3.9 m at 13 m and 4.8 m at 19 m: from a few metres back it lobs over
// walls and containers (the tallest are 3.3 m), never over buildings.
const RELEASE_Y = 1.1;
const ARC_BASE = 0.6, ARC_PER_M = 0.07;
const ARC_BASE_STRONG = 1.2, ARC_PER_M_STRONG = 0.16;
const ARC_RESTORE = 1.9;        // A projectile carried over by host migration with no arc of its own.
const ROOFED = new Set(['building', 'shop', 'adobe', 'tent', 'border']);
const SKIN = 0.12;
const DEVICE_R = 0.45;           // Footprint of a device left lying (mine, claymore, trophy...): it must sit fully on open ground.              // Kept between a projectile and any wall, so the next ray starts clear of it.
const WALL_RESTITUTION = 0.5;
const WALL_SCRUB = 0.85;        // Speed kept along the wall after a bounce.
const LAND_SPEED_KEEP = 0.5;
const ROLL_DECEL = 18;
const STOPPED_SPEED = 0.4;
const DIRECT_DAMAGE = 200;      // More than a full health bar, and still subject to spawn protection like anything else.
const BURN_TICK = 0.25;
const ENGINEER_TROPHY = 1;      // Extra shots a Trophy gets with the Engineer perk.
const TACMASK_FLASH = 0.4;      // Share of a flash a Tac Mask lets through, in both strength and length.
const TACMASK_FIRE = 0.5;
const COLD_TRIGGER = 0.45;      // Cold Blooded: fraction of a mine's trigger radius that still sets it off.
const CHAIN_DELAY = 0.14;       // A mine caught in a blast goes off this much later: chains read as a ripple.
export const THROW_QUICK = 1.35; // Fastball: flight runs this many times faster.
const DECOY_RHYTHM = [0.11, 0.11, 0.11, 0.85, 0.11, 0.11, 1.3];   // Seconds between fake shots: short bursts, like a person.
const TACMASK_DAZE = 0.4;       // Share of a Stun or Shock daze a Tac Mask lets through, in strength and length.
const GAS_DAZE_EVERY = 2;       // Gas re-sends its daze every this many burn ticks, so a cloud is not an event flood.
const DRILL_DEPTH = 1.6;        // Most solid a Drill bores through; anything thicker and it goes off on this side.
const DRILL_OUT = 0.45;         // How far past the far face the charge goes off.

// `air` is how long the throw flies before touching the ground. A rolling grenade flies 11.25 m and
// rolls about 1.5 m more, so every kind ends up near THROW_RANGE.
export const EQUIPMENT = {
  frag:   { fuse: 1.8, air: 0.75, blast: { radius: 6.2, inner: 1.4, max: 135, min: 15 } },
  sticky: { fuse: 1.2, air: THROW_RANGE / THROW_SPEED, sticks: true, attach: { contact: 0.6, hold: 1.1 }, blast: { radius: 4.6, inner: 1.6, max: 165, min: 20 } },
  flash:  { fuse: 0.95, air: 0.75, flash: { radius: 12, inner: 3, maxDur: 3.2 } },
  smoke:  { fuse: 2.2, air: 0.75, popsOnStop: true, cloud: { radius: 4.5, life: 9, grow: 0.8, fade: 1.8 } },
  stim:   { instant: true, heal: MAX_HP },

  molotov: { fuse: 3, air: 0.75, sticks: true, burstOnStick: true, spawns: 'fire', burstR: 3.2 },
  fire:    { noThrow: true, as: 'molotov', quietEnd: true, fuse: 5.5, burn: { radius: 3.2, dps: 34 } },
  mine:    { fuse: 45, air: 0.75, sticks: true, quietEnd: true, mine: { arm: 1.1, trigger: 2.4 }, blast: { radius: 4.4, inner: 1.4, max: 150, min: 30 } },
  cluster: { fuse: 1.6, air: 0.75, blast: { radius: 4, inner: 1, max: 70, min: 12 }, scatter: { kind: 'bomblet', n: 4, r: 3.1, gap: 0.16 } },
  bomblet: { noThrow: true, as: 'cluster', fuse: 0.3, sticks: true, blast: { radius: 3.3, inner: 0.9, max: 62, min: 15 } },
  hatchet: { fuse: 1.3, air: 0.62, sticks: true, quietEnd: true, direct: { radius: 0.62, damage: DIRECT_DAMAGE } },

  decoy:   { fuse: 8, air: 0.75, sticks: true, quietEnd: true, decoy: { weapon: 'ar' } },
  // Reworked: a planted pinger, not a one-off pulse (the one-off is now Snapshot).
  sensor:  { fuse: 20, air: 0.75, sticks: true, quietEnd: true, sensor: { radius: 10, dur: 1.6, every: 2.5, first: 0.6 } },
  trophy:  { fuse: 16, air: 0.75, sticks: true, quietEnd: true, trophy: { radius: 6.5, charges: 3, gap: 0.3 } },

  // V8. `soft` kinds announce themselves with a 'gear' event instead of a 'bang': no explosion is drawn or heard.
  stun:     { fuse: 1.1, air: 0.75, soft: true, daze: { radius: 8, inner: 2.5, maxDur: 3.2 } },
  gas:      { fuse: 1.5, air: 0.75, soft: true, popsOnStop: true, spawns: 'gascloud', burstR: 4.4 },
  gascloud: { noThrow: true, as: 'gas', quietEnd: true, fuse: 8, gas: { radius: 4.4, grow: 0.9, dps: 8, daze: 0.45, dazeDur: 0.8 } },
  shock:    { fuse: 3, air: 0.75, sticks: true, soft: true, quietEnd: true, shock: { radius: 4, first: 0.35, gap: 0.55, arcs: 3, damage: 18, daze: 0.75, dazeDur: 1.2, fry: 5 } },
  impact:   { fuse: 4, air: 0.75, sticks: true, burstOnStick: true, contact: 0.55, blast: { radius: 4.2, inner: 1.0, max: 130, min: 20 } },   // Gear wave: no fuse to dodge, so a softer blast.
  claymore: { fuse: 45, air: 0.62, sticks: true, quietEnd: true, faces: true, mine: { arm: 1.3, trigger: 3.6, cone: 0.6 },
    blast: { radius: 6, inner: 2.2, max: 180, min: 45, cone: 0.85, back: 1.3 } },
  drill:    { fuse: 2.1, air: 0.62, sticks: true, drill: true, blast: { radius: 3.9, inner: 1.3, max: 155, min: 25 } },

  // Gear wave. Tacticals.
  snapshot: { fuse: 0.9, air: 0.75, popsOnStop: true, snap: { radius: 12, dur: 3 } },
  blackout: { fuse: 1.0, air: 0.75, soft: true, emp: { radius: 7, dur: 6 } },
  bulwark:  { fuse: 25, air: 0.62, sticks: true, quietEnd: true, faces: true, cover: { half: 1.25, thick: 0.2, h: 1.1, hp: 700, blastMult: 4 } },
  tagger:   { fuse: 1.0, air: 0.4, sticks: true, tag: { contact: 0.55, dur: 8, radius: 5.5, surfDur: 3 } },
  medpack:  { fuse: 15, air: 0.62, sticks: true, quietEnd: true, medic: { radius: 3.5, every: 0.5, amount: 7 } },
  // Lethals.
  charge:   { fuse: 60, air: 0.75, sticks: true, quietEnd: true, remote: { arm: 0.35, keep: 2 }, blast: { radius: 5.6, inner: 1.8, max: 175, min: 30 } },
  thermite: { fuse: 7.6, air: 0.62, sticks: true, quietEnd: true, therm: { melt: 2.6, coverDps: 160 }, burn: { radius: 2.4, dps: 46 } },
  tripwire: { fuse: 50, air: 0.62, sticks: true, quietEnd: true, trip: { arm: 1.2, len: 7, width: 0.45, cold: 2 }, blast: { radius: 3.4, inner: 1.2, max: 165, min: 40 } },
  crawler:  { fuse: 7, air: 0.75, crawl: { arm: 0.8, speed: 4.2, seek: 8, contact: 0.85 }, blast: { radius: 3.6, inner: 1.0, max: 125, min: 25 } },
  shiv:     { fuse: 25, air: 0.36, sticks: true, quietEnd: true, direct: { radius: 0.5, damage: 60, back: DIRECT_DAMAGE, cone: 1.2 }, pickup: 1.3 },
};

// What a Trophy will shoot at.
const ZAPPABLE = new Set(['frag', 'sticky', 'molotov', 'mine', 'cluster', 'bomblet', 'hatchet', 'impact', 'claymore', 'drill',
  'charge', 'thermite', 'tripwire', 'crawler', 'shiv']);
// What a Shock arc, a Blackout or Thermite fries: enemy devices sitting on the map.
const FRYABLE = new Set(['mine', 'claymore', 'trophy', 'sensor', 'decoy', 'drill', 'sticky', 'shock', 'charge', 'tripwire', 'crawler', 'medpack', 'tagger']);
// What gunfire destroys: enemy devices on the ground (a Bulwark has health instead, see shootCover).
export const SHOOTABLE = new Set(['mine', 'claymore', 'trophy', 'sensor', 'decoy', 'shock', 'charge', 'tripwire', 'crawler', 'medpack', 'tagger']);
const DEVICE_HIT_R = 0.42;       // A bullet passing this close to a device's centre hits it.
const COLD_MARK = 0.5;           // Cold Blooded: recon marks (Sensor, Snapshot, Tagger) last this share (sim.js applies it).
export { COLD_MARK };

// Furthest a player with these perks may throw. The host clamps with this; so should anything drawing a preview.
export function maxThrowRange(perks) {
  return perks && perks.includes('strongarm') ? STRONGARM_RANGE : THROW_RANGE;
}

export function throwArc(dist, perks) {
  const strong = !!(perks && perks.includes('strongarm'));
  const d = Math.max(MIN_THROW, Math.min(strong ? STRONGARM_RANGE : THROW_RANGE, Number.isFinite(dist) ? dist : THROW_RANGE));
  return strong ? ARC_BASE_STRONG + d * ARC_PER_M_STRONG : ARC_BASE + d * ARC_PER_M;
}

// Height of a throw at fraction u of its air time.
export function arcHeight(u, arc) {
  return RELEASE_Y * (1 - u) + arc * 4 * u * (1 - u);
}

const hasProIn = (perks, pro, id) => !!(perks && pro && perks.includes(id) && pro.includes(id));

// Flight speed-up for a thrower's perks and Pro list: Fastball, or 1.
export function throwQuick(perks, pro) {
  return hasProIn(perks, pro, 'strongarm') ? THROW_QUICK : 1;
}

export function flakMult(perks) {
  return perks && perks.includes('flak') ? FLAK_MULT : 1;
}

// Full damage inside `inner`, then linear down to `min` at the edge, zero beyond it.
export function blastDamage(blast, dist, perks) {
  if (dist >= blast.radius) return 0;
  const k = dist <= blast.inner ? 1 : (blast.radius - dist) / (blast.radius - blast.inner);
  return Math.round((blast.min + (blast.max - blast.min) * k) * flakMult(perks));
}

// Whether v is within `half` radians of the way p faces.
function inCone(p, v, half) {
  let a = Math.atan2(v.z - p.z, v.x - p.x) - p.dir;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(a) <= half;
}

function ownerIdOf(owner) {
  return owner !== null && typeof owner === 'object' ? owner.id : owner;
}

// Radius a kind's effect covers, for anyone deciding where to throw it.
export function effectRadius(kind) {
  const s = EQUIPMENT[kind];
  if (!s) return 0;
  if (s.blast) return s.blast.radius;
  if (s.flash) return s.flash.radius;
  if (s.cloud) return s.cloud.radius;
  if (s.burstR) return s.burstR;
  if (s.sensor) return s.sensor.radius;
  if (s.direct) return s.direct.radius;
  if (s.daze) return s.daze.radius;
  if (s.shock) return s.shock.radius;
  if (s.snap) return s.snap.radius;
  if (s.emp) return s.emp.radius;
  if (s.burn) return s.burn.radius;
  if (s.tag) return s.tag.radius;
  if (s.medic) return s.medic.radius;
  if (s.cover) return s.cover.half;
  return 0;
}

function makeProjectile(id, kind, owner, ox, oz, aim, dist, perks, quick = 1) {
  const v = speedFor(kind, dist);
  return { id, kind, owner, team: undefined, x: ox, z: oz, y: RELEASE_Y, arc: throwArc(dist, perks),
    vx: Math.cos(aim) * v, vz: Math.sin(aim) * v, age: 0, stuck: false, grounded: false, t: 0, n: 0, charges: 0, quick, trip: 0,
    dir: aim, wnx: 0, wnz: 0, attached: null, hp: 0, land: -1, boom: false, x0: 0, z0: 0, x1: 0, z1: 0 };
}

// Something a burst left on the ground. A positive `delay` holds it back that many seconds.
function makeLying(id, kind, owner, team, x, z, delay = 0) {
  return { id, kind, owner, team, x, z, y: 0, arc: 0, vx: 0, vz: 0, age: -delay, stuck: true, grounded: true, t: 0, n: 0, charges: 0, quick: 1, trip: 0,
    dir: 0, wnx: 0, wnz: 0, attached: null, hp: 0, land: -1, boom: false, x0: 0, z0: 0, x1: 0, z1: 0 };
}

const isDevice = spec => !!(spec.mine || spec.trophy || spec.sensor || spec.decoy || spec.cover || spec.medic);

// One tick of a live projectile. Real throws and previews both go through here, so they cannot disagree.
// `onBounce` is optional; returns true once the thing has gone off.
// Fastball runs the flight's clock faster; once down, time is time again.
function advance(map, p, spec, dt, onBounce) {
  if (p.quick > 1 && !p.grounded) dt *= p.quick;
  p.age += dt;
  fly(map, p, spec, dt, onBounce);
  const stopped = spec.popsOnStop && p.grounded && Math.hypot(p.vx, p.vz) < STOPPED_SPEED;
  return p.age >= spec.fuse || stopped || (!!spec.burstOnStick && p.stuck);
}

function fly(map, p, spec, dt, onBounce) {
  if (p.stuck) return;
  if (!p.grounded) {
    const u = p.age / spec.air;
    if (u >= 1) {
      p.y = 0;
      p.grounded = true;
      if (onBounce) onBounce(p.x, p.z, 'land');
      if (spec.sticks) {
        // A device coming down on a crate, container or building rolls off the edge to open ground, whole and in
        // view, instead of sitting inside the object. Shared with the preview, so the landing ring agrees.
        if (isDevice(spec)) resolveCircle(map, p, DEVICE_R);
        p.stuck = true; p.vx = 0; p.vz = 0; return;
      }
      p.vx *= LAND_SPEED_KEEP; p.vz *= LAND_SPEED_KEEP;
      resolveCircle(map, p, SKIN);     // Coming down on a crate puts it beside the crate.
    } else {
      p.y = arcHeight(u, p.arc);
    }
  }
  if (p.grounded) {
    const speed = Math.hypot(p.vx, p.vz);
    if (speed < 1e-3) { p.vx = 0; p.vz = 0; return; }
    const k = Math.max(0, speed - ROLL_DECEL * dt) / speed;
    p.vx *= k; p.vz *= k;
  }
  sweep(map, p, spec, dt, onBounce);
}

// In flight it clears waist-high cover and anything lower than the arc (see HEIGHT PROFILE); on the ground, crates
// and barriers stop it too.
function sweep(map, p, spec, dt, onBounce) {
  let left = dt;
  for (let guard = 0; guard < 4 && left > 1e-5; guard++) {
    const speed = Math.hypot(p.vx, p.vz);
    if (speed < 1e-3) return;
    const dirX = p.vx / speed, dirZ = p.vz / speed, reach = speed * left;
    const hit = p.grounded ? raycastMap(map, p.x, p.z, dirX, dirZ, reach + SKIN, 'blocksMove')
      : airHit(map, p, spec, dirX, dirZ, reach + SKIN, speed, p.age - left);
    if (!hit) { p.x += dirX * reach; p.z += dirZ * reach; return; }
    const travel = Math.max(0, Math.min(reach, hit.t - SKIN));
    p.x += dirX * travel; p.z += dirZ * travel;
    left -= travel / speed;
    if (onBounce) onBounce(p.x, p.z, 'wall');
    // Devices left lying (mines, claymores, trophies, sensors, decoys) do not stick to a wall's face: they bounce off and
    // come down on open ground, where the whole thing is in view. Grenades that stick (sticky, molotov...) still do.
    if (spec.sticks && !isDevice(spec)) { p.stuck = true; p.vx = 0; p.vz = 0; p.wnx = hit.nx; p.wnz = hit.nz; return; }
    const vn = p.vx * hit.nx + p.vz * hit.nz;
    p.vx = (p.vx - (1 + WALL_RESTITUTION) * vn * hit.nx) * WALL_SCRUB;
    p.vz = (p.vz - (1 + WALL_RESTITUTION) * vn * hit.nz) * WALL_SCRUB;
  }
}

// The first wall a throw in the air meets along this ray: a solid whose top is at or above the arc where the ray
// crosses its face, or any ROOFED solid. `age0` is the projectile's age at the ray's start. A throw already over a
// wall's footprint is above it and carries on; if it comes down there, landing puts it beside the wall. Fills AIR_HIT.
const AIR_HIT = { t: 0, nx: 0, nz: 0 };
let AIR_NEAR = null, SOLID_NEAR = null;
function airHit(map, p, spec, dx, dz, maxT, speed, age0) {
  let best = maxT, found = false, bx = 0, bz = 0;
  const walls = map.walls, near = AIR_NEAR = wallScratch(map, AIR_NEAR);
  const count = wallsOnRay(map, p.x, p.z, dx, dz, maxT, near);    // The walls along the ray, in wall order.
  for (let q = 0; q < count; q++) {
    const w = walls[near[q]];
    if (!w.blocksBullet) continue;
    // Slab entry from outside; an origin on or inside the rectangle means the throw is over it.
    let tmin = -Infinity, tmax = Infinity, nx = 0, nz = 0;
    if (Math.abs(dx) < 1e-9) {
      if (p.x <= w.x || p.x >= w.x + w.w) continue;
    } else {
      let t1 = (w.x - p.x) / dx, t2 = (w.x + w.w - p.x) / dx, sgn = -1;
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; sgn = 1; }
      tmin = t1; tmax = t2; nx = sgn;
    }
    if (Math.abs(dz) < 1e-9) {
      if (p.z <= w.z || p.z >= w.z + w.d) continue;
    } else {
      let t1 = (w.z - p.z) / dz, t2 = (w.z + w.d - p.z) / dz, sgn = -1;
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; sgn = 1; }
      if (t1 > tmin) { tmin = t1; nx = 0; nz = sgn; }
      if (t2 < tmax) tmax = t2;
    }
    if (tmin > tmax || tmin < 0 || tmin >= best) continue;
    if (!ROOFED.has(w.kind) && w.h !== undefined) {
      const u = Math.min(1, (age0 + tmin / speed) / spec.air);
      if (arcHeight(u, p.arc) > w.h) continue;
    }
    best = tmin; found = true; bx = nx; bz = nz;
  }
  if (!found) return null;
  AIR_HIT.t = best; AIR_HIT.nx = bx; AIR_HIT.nz = bz;
  return AIR_HIT;
}

// Throw speed for "end up `dist` metres away on open ground". Worked out by flying each kind once at load across
// a ladder of speeds, so the answer includes roll and fuse without having to be derived for each kind.
const OPEN_GROUND = { walls: [], width: 1e7, height: 1e7 };
const SPEED_MIN = 1, SPEED_STEP = 1, SPEED_COUNT = 40;
const REACH_TABLE = {};
for (const kind of Object.keys(EQUIPMENT)) {
  if (EQUIPMENT[kind].instant || EQUIPMENT[kind].noThrow) continue;
  const spec = EQUIPMENT[kind], reach = new Float32Array(SPEED_COUNT);
  for (let i = 0; i < SPEED_COUNT; i++) {
    const p = { x: 5e6, z: 5e6, y: RELEASE_Y, arc: 0, vx: SPEED_MIN + i * SPEED_STEP, vz: 0, age: 0, stuck: false, grounded: false };
    for (let g = 0; g < 400 && !advance(OPEN_GROUND, p, spec, STEP); g++);
    reach[i] = p.x - 5e6;
  }
  REACH_TABLE[kind] = reach;
}

function speedFor(kind, dist) {
  const reach = REACH_TABLE[kind];
  if (!reach) return THROW_SPEED;
  const d = Math.max(MIN_THROW, Math.min(STRONGARM_RANGE, Number.isFinite(dist) ? dist : THROW_RANGE));
  let i = 0;
  while (i < SPEED_COUNT - 2 && reach[i + 1] < d) i++;
  const f = (d - reach[i]) / Math.max(1e-6, reach[i + 1] - reach[i]);
  return SPEED_MIN + (i + Math.max(0, Math.min(1, f))) * SPEED_STEP;
}

// Everything a preview needs, kept between calls: holding a throw recomputes the arc every frame, and a fresh polyline
// each time is steady garbage for as long as the thumb is down. Pools only grow; `points` and `bounces` are short lists
// of references into them, so a shrinking arc does not throw objects away.
const PREVIEW = { points: [], bounces: [], landing: { x: 0, z: 0, t: 0, kind: null } };
const pointPool = [], bouncePool = [];
function poolPoint(pool, i, x, z, y) {
  let p = pool[i];
  if (!p) { p = { x: 0, z: 0, y: 0 }; pool[i] = p; }
  p.x = x; p.z = z; p.y = y;
  return p;
}
let previewBounceN = 0;
function previewOnBounce(x, z) {
  PREVIEW.bounces[previewBounceN] = poolPoint(bouncePool, previewBounceN, x, z, 0);
  previewBounceN++;
}

// The one projectile the previews fly. Never escapes this file.
const FLYER = { id: 0, kind: '', owner: null, team: undefined, x: 0, z: 0, y: 0, arc: 0, vx: 0, vz: 0, age: 0, stuck: false, grounded: false, t: 0, n: 0, charges: 0, quick: 1, trip: 0,
  dir: 0, wnx: 0, wnz: 0, attached: null, hp: 0, land: -1, boom: false, x0: 0, z0: 0, x1: 0, z1: 0 };
function launchFlyer(kind, ox, oz, aim, dist, perks, pro) {
  const v = speedFor(kind, dist);
  FLYER.kind = kind; FLYER.x = ox; FLYER.z = oz; FLYER.y = RELEASE_Y; FLYER.arc = throwArc(dist, perks);
  FLYER.quick = throwQuick(perks, pro);
  FLYER.vx = Math.cos(aim) * v; FLYER.vz = Math.sin(aim) * v;
  FLYER.age = 0; FLYER.stuck = false; FLYER.grounded = false;
  FLYER.dir = aim; FLYER.wnx = 0; FLYER.wnz = 0;
  return FLYER;
}

// The exact path of the throw `eq.throw(.., ox, oz, aim, dist)` would make, ticked forward with no one in the way.
// Returns { points:[{x,z,y}], bounces:[{x,z}], landing:{x,z,t,kind,radius} }, or null for stim and unknown kinds.
// `landing` is where it goes off (or stops, for smoke). Callers clamp `dist` with maxThrowRange(perks) and pass the
// thrower's perks, which set the arc's height, and Pro list. `landing.radius` is the effect's radius for a Fastball
// thrower (the HUD rings it) and 0 otherwise. The result is reused by the next call: read it now, or copy it.
const PREVIEW_NO_PRO = [];
export function previewThrow(map, ox, oz, aim, dist, kind, perks, pro = PREVIEW_NO_PRO) {
  const spec = EQUIPMENT[kind];
  if (!spec || spec.instant || spec.noThrow) return null;
  const p = launchFlyer(kind, ox, oz, aim, dist, perks, pro);
  const points = PREVIEW.points;
  let n = 0;
  previewBounceN = 0;
  points[n++] = poolPoint(pointPool, 0, ox, oz, p.y);
  for (let g = 0; g < 400; g++) {
    const done = advance(map, p, spec, STEP, previewOnBounce);
    points[n] = poolPoint(pointPool, n, p.x, p.z, p.y);
    n++;
    // Things that sit until something happens have no interesting path after they stop.
    if (done || (p.stuck && spec.quietEnd)) break;
  }
  points.length = n; PREVIEW.bounces.length = previewBounceN;
  PREVIEW.landing.x = p.x; PREVIEW.landing.z = p.z; PREVIEW.landing.t = p.age; PREVIEW.landing.kind = kind;
  if (spec.drill && drillExit(map, p)) { PREVIEW.landing.x = DRILL_AT.x; PREVIEW.landing.z = DRILL_AT.z; }
  PREVIEW.landing.radius = hasProIn(perks, pro, 'strongarm') ? effectRadius(kind) : 0;
  return PREVIEW;
}

// Where a throw ends up, and nothing else. Returns a shared {x,z,t}, or null for stim and unknown kinds.
const LANDING = { x: 0, z: 0, t: 0 };
export function landingOf(map, ox, oz, aim, dist, kind, perks, pro = PREVIEW_NO_PRO) {
  const spec = EQUIPMENT[kind];
  if (!spec || spec.instant || spec.noThrow) return null;
  const p = launchFlyer(kind, ox, oz, aim, dist, perks, pro);
  for (let g = 0; g < 400; g++) if (advance(map, p, spec, STEP) || (p.stuck && spec.quietEnd)) break;
  LANDING.x = p.x; LANDING.z = p.z; LANDING.t = p.age;
  if (spec.drill && drillExit(map, p)) { LANDING.x = DRILL_AT.x; LANDING.z = DRILL_AT.z; }
  return LANDING;
}

// Where a Drill stuck to a wall goes off: just past the far face of the solid it is in, following any solid that
// carries straight on behind it, as long as the whole run is at most DRILL_DEPTH. Fills DRILL_AT and returns true, or
// returns false when it is not on a wall or the wall is too thick (it then goes off where it is).
const DRILL_AT = { x: 0, z: 0, depth: 0 };
export function drillExit(map, p) {
  const nx = p.wnx, nz = p.wnz;
  if (!p.stuck || (!nx && !nz)) return false;
  // Start just inside the face it hit, then hop from far face to far face.
  let x = p.x - nx * (SKIN + 0.05), z = p.z - nz * (SKIN + 0.05), depth = 0;
  for (let guard = 0; guard < 6; guard++) {
    const w = solidAt(map, x, z);
    if (!w) break;
    if (ROOFED.has(w.kind)) return false;          // Buildings and the border are not thin cover.
    const far = nx < 0 ? w.x + w.w - x : nx > 0 ? x - w.x : nz < 0 ? w.z + w.d - z : z - w.z;
    depth += far;
    if (depth > DRILL_DEPTH) return false;
    x -= nx * (far + 0.02); z -= nz * (far + 0.02);
  }
  if (depth <= 0) return false;
  DRILL_AT.x = x - nx * DRILL_OUT; DRILL_AT.z = z - nz * DRILL_OUT; DRILL_AT.depth = depth;
  if (solidAt(map, DRILL_AT.x, DRILL_AT.z)) { DRILL_AT.x = x - nx * 0.05; DRILL_AT.z = z - nz * 0.05; }
  return true;
}

function solidAt(map, x, z) {
  const walls = map.walls, near = SOLID_NEAR = wallScratch(map, SOLID_NEAR);
  const count = wallsInBox(map, x, z, x, z, near);
  for (let q = 0; q < count; q++) {
    const w = walls[near[q]];
    if (w.blocksMove && x > w.x && x < w.x + w.w && z > w.z && z < w.z + w.d) return w;
  }
  return null;
}

export class EquipmentSystem {
  constructor(map) {
    this.map = map;
    this._projectiles = [];
    this._smokes = [];
    this._pending = [];   // Events raised by throw(), delivered on the next step.
    this._nextId = 1;
    syncCover(map, null);  // A Bulwark wall left on this (shared) map by an earlier match goes.
  }

  get projectiles() { return this._projectiles; }
  get smokes() { return this._smokes; }

  reset() {
    this._projectiles.length = 0;
    this._smokes.length = 0;
    this._pending.length = 0;
    syncCover(this.map, null);
  }

  // Returns the new projectile, or null for stim (no projectile) and unknown kinds.
  throw(owner, kind, ox, oz, aim, dist) {
    const spec = EQUIPMENT[kind];
    if (!spec) return null;
    const id = ownerIdOf(owner);
    if (spec.instant) {
      this._pending.push({ t: 'heal', id, amount: spec.heal });
      return null;
    }
    if (spec.noThrow) return null;
    this._pending.push({ t: 'throw', id, kind, ox, oz, aim, dist: Number.isFinite(dist) ? dist : THROW_RANGE });
    const perks = owner !== null && typeof owner === 'object' ? owner.ps?.perks : null;
    const pro = owner !== null && typeof owner === 'object' ? owner.ps?.pro : null;
    const p = makeProjectile(this._nextId++, kind, id, ox, oz, aim, dist, perks, throwQuick(perks, pro));
    p.team = owner !== null && typeof owner === 'object' ? owner.team : undefined;
    if (spec.trophy) p.charges = spec.trophy.charges + (perks && perks.includes('engineer') ? ENGINEER_TROPHY : 0);
    if (spec.remote) this._limitRemotes(id, spec.remote.keep - 1);
    this._projectiles.push(p);
    return p;
  }

  // Host migration: picks up everything in flight from a snapshot. Entries are GameView projectiles and smokes.
  restore(projectiles, smokes, teamOf) {
    for (const v of projectiles || []) {
      if (!EQUIPMENT[v.kind] || EQUIPMENT[v.kind].instant) continue;
      // The arc is not on the wire; one in flight is worked back out of its height and age.
      const air = EQUIPMENT[v.kind].air, u = air ? (v.age || 0) / air : 0;
      const arc = u > 0.05 && u < 0.95 ? Math.max(0, (v.y - RELEASE_Y * (1 - u)) / (4 * u * (1 - u))) : ARC_RESTORE;
      this._projectiles.push({ id: v.id, kind: v.kind, owner: v.owner, team: teamOf(v.owner), x: v.x, z: v.z, y: v.y, arc,
        vx: v.vx || 0, vz: v.vz || 0, age: v.age || 0, stuck: !!v.stuck, grounded: !!v.grounded,
        t: 0, n: 0, charges: EQUIPMENT[v.kind].trophy ? EQUIPMENT[v.kind].trophy.charges : 0, quick: 1, trip: 0,
        dir: Math.atan2(v.vz || 0, v.vx || 0), wnx: 0, wnz: 0, attached: null, hp: 0, land: -1, boom: false, x0: 0, z0: 0, x1: 0, z1: 0 });
      this._nextId = Math.max(this._nextId, v.id + 1);
    }
    for (const v of smokes || []) {
      this._smokes.push({ id: v.id, x: v.x, z: v.z, r: v.r, a: 1, t: v.age || 0 });
      this._nextId = Math.max(this._nextId, v.id + 1);
    }
  }

  // An EMP's reach: whatever the enemy left sitting on the map stops working. Things in the air keep flying.
  clearDeployed(team, teamOf) {
    for (let i = 0; i < this._projectiles.length; i++) {
      const p = this._projectiles[i], spec = EQUIPMENT[p.kind];
      if ((spec.mine || spec.trophy || spec.decoy || spec.sensor || spec.remote || spec.trip || spec.medic || spec.crawl || spec.cover)
        && (p.team ?? teamOf(p.owner)) === team) p.dead = true;
    }
  }

  // Satchel: the owner's second tap. Every armed charge of theirs goes off on the next step. Returns how many.
  detonate(ownerId) {
    let n = 0;
    for (let i = 0; i < this._projectiles.length; i++) {
      const p = this._projectiles[i], spec = EQUIPMENT[p.kind];
      if (!spec.remote || p.dead || p.owner !== ownerId || !p.stuck || p.land < 0 || p.age - p.land < spec.remote.arm) continue;
      p.boom = true; n++;
    }
    return n;
  }

  // How many live Satchels this owner has on the map (armed or not).
  remoteOf(ownerId) {
    let n = 0;
    for (let i = 0; i < this._projectiles.length; i++) {
      const p = this._projectiles[i];
      if (EQUIPMENT[p.kind].remote && !p.dead && p.owner === ownerId) n++;
    }
    return n;
  }

  // Keeps at most `keep` Satchels per owner: throwing one more retires the oldest, quietly.
  _limitRemotes(ownerId, keep) {
    let n = this.remoteOf(ownerId);
    for (let i = 0; i < this._projectiles.length && n > keep; i++) {
      const p = this._projectiles[i];
      if (EQUIPMENT[p.kind].remote && !p.dead && p.owner === ownerId) { p.dead = true; n--; }
    }
  }

  // Gunfire against enemy devices: the nearest SHOOTABLE one within DEVICE_HIT_R of the ray before `len` is destroyed.
  // Returns the popped projectile or null. `team` is the shooter's; their own devices (and teammates') are safe.
  shootDevices(ox, oz, dx, dz, len, team, shooterId, onEvent) {
    let best = null, bestT = len + 0.2;
    const list = this._projectiles;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (q.dead || q.attached !== null || !SHOOTABLE.has(q.kind) || !(q.stuck || q.grounded)) continue;
      if (q.owner === shooterId || (team !== undefined && q.team === team)) continue;
      const t = rayCircleT(ox, oz, dx, dz, q.x, q.z, DEVICE_HIT_R);
      if (t >= 0 && t < bestT) { bestT = t; best = q; }
    }
    if (!best) return null;
    best.dead = true;
    if (onEvent) onEvent({ t: 'popped', kind: best.kind, x: best.x, z: best.z, by: shooterId, src: 'gun' });
    return best;
  }

  // Gunfire against an enemy Bulwark: `dmg` off the first one the ray crosses before `len`, unless the shooter is right
  // behind it (then they are firing over it, the same rule waist-high cover follows). Returns true when one was hit.
  shootCover(ox, oz, dx, dz, len, team, shooterId, dmg, onEvent) {
    const list = this._projectiles;
    let best = null, bestT = len + 0.15;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (q.dead || !EQUIPMENT[q.kind].cover || !q.stuck || q.n === 0) continue;
      if (q.owner === shooterId || (team !== undefined && q.team === team)) continue;
      const r = coverRect(q, EQUIPMENT[q.kind].cover, RECT);
      const t = raySlab(ox, oz, dx, dz, r);
      if (t < 0 || t >= bestT) continue;
      if (t < 1.2 && Math.max(r.x - ox, 0, ox - r.x - r.w) ** 2 + Math.max(r.z - oz, 0, oz - r.z - r.d) ** 2 < 1.44) continue;
      bestT = t; best = q;
    }
    if (!best) return false;
    this._hurtCover(best, dmg, shooterId, onEvent);
    return true;
  }

  _hurtCover(q, dmg, by, onEvent, src = 'gun') {
    if (q.dead) return;
    q.hp -= dmg;
    if (q.hp > 0) return;
    q.dead = true;
    if (onEvent) onEvent({ t: 'popped', kind: q.kind, x: q.x, z: q.z, by, src });
  }

  // Sympathetic detonation. Mines whose centre is inside the blast, with nothing solid between, are tripped; each goes
  // off CHAIN_DELAY later and its own blast trips the next. Unarmed mines count: the blast does not care.
  setOffMines(x, z, r, except = null) {
    const list = this._projectiles;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (q === except || q.dead || q.trip > 0 || !EQUIPMENT[q.kind].mine) continue;
      const d = Math.hypot(q.x - x, q.z - z);
      if (d >= r) continue;
      if (d > 1e-3 && raycastMap(this.map, x, z, (q.x - x) / d, (q.z - z) / d, d, 'blocksBullet')) continue;
      q.trip = CHAIN_DELAY;
    }
  }

  // A player came back under a new id: grenades still in the air are credited to it.
  rebindOwner(oldId, newId) {
    for (const p of this._projectiles) if (p.owner === oldId) p.owner = newId;
  }

  step(dt, players, onEvent, onDamage) {
    for (let i = 0; i < this._pending.length; i++) if (onEvent) onEvent(this._pending[i]);
    this._pending.length = 0;

    // A burst can add to the list while this runs (bomblets, fire); they are appended and picked up by the same loop.
    const list = this._projectiles;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i], spec = EQUIPMENT[p.kind];
      if (p.dead) continue;
      if (p.attached !== null && !this._follow(p, players)) {
        if (spec.tag) { p.dead = true; continue; }      // A Tagger dies with its carrier.
        p.attached = null;                               // A Sticky drops where they fell.
      }
      const px = p.x, pz = p.z, was = p.stuck;
      const done = advance(this.map, p, spec, dt);
      if ((p.grounded || p.stuck) && p.land < 0) p.land = p.age;
      // Hits on people are checked on the tick's whole path, including the tick it came down on them.
      if (spec.direct && !was && this._directHit(p, spec, px, pz, players, onDamage)) { if (!spec.pickup) continue; }
      if (spec.contact && !p.stuck && this._contact(p, spec, px, pz, players)) { this._burst(p, spec, players, onEvent, onDamage); continue; }
      if ((spec.attach || spec.tag) && !was && p.attached === null) this._stick(p, spec, px, pz, players, onEvent);
      if (spec.faces && p.stuck && p.n === 0) {
        p.n = 1; p.vx = Math.cos(p.dir); p.vz = Math.sin(p.dir);
        if (spec.cover) {
          // A Bulwark squares up to the nearest axis (walls are axis-aligned), exactly, so every peer builds the same wall.
          p.hp = spec.cover.hp;
          if (Math.abs(p.vx) >= Math.abs(p.vz)) { p.vx = Math.sign(p.vx) || 1; p.vz = 0; } else { p.vx = 0; p.vz = Math.sign(p.vz) || 1; }
          p.dir = Math.atan2(p.vz, p.vx);
        }
      }
      if (spec.remote && p.boom) { this._burst(p, spec, players, onEvent, onDamage); continue; }
      if (spec.trip && p.stuck && this._tripwire(p, spec, players)) { this._burst(p, spec, players, onEvent, onDamage); continue; }
      if (spec.crawl && p.grounded && !done && this._crawl(p, spec, dt, players)) { this._burst(p, spec, players, onEvent, onDamage); continue; }
      if (spec.therm && p.stuck) this._thermite(p, spec, dt, players, onEvent);
      if (spec.sensor && p.stuck) this._pinger(p, spec, dt, players, onEvent);
      if (spec.medic && p.stuck) this._medic(p, spec, dt, players, onEvent);
      if (spec.pickup && p.stuck && this._pickup(p, spec, players, onEvent)) continue;
      if (spec.drill && p.stuck && p.n === 0) {
        p.n = 1;
        if ((p.wnx || p.wnz) && onEvent) onEvent({ t: 'gear', kind: p.kind, x: p.x, z: p.z, r: 0, by: p.owner, nx: p.wnx, nz: p.wnz });
      }
      if (spec.mine && p.trip > 0 && (p.trip -= dt) <= 0) { this._burst(p, spec, players, onEvent, onDamage); continue; }
      if (spec.mine && p.age >= spec.mine.arm && this._tripped(p, spec, players)) { this._burst(p, spec, players, onEvent, onDamage); continue; }
      if (spec.burn && p.stuck) this._burn(p, spec, dt, players, onDamage);
      if (spec.gas) this._gas(p, spec, dt, players, onEvent, onDamage);
      if (spec.shock && p.stuck && this._shock(p, spec, dt, players, onEvent, onDamage)) continue;
      if (spec.decoy && p.stuck) this._decoy(p, spec, dt, onEvent);
      if (spec.trophy && p.stuck && this._zap(p, spec, dt, players, onEvent)) continue;
      if (done) { if (!spec.quietEnd) this._burst(p, spec, players, onEvent, onDamage); }
      else list[w++] = p;
    }
    list.length = w;
    syncCover(this.map, list);

    this._stepSmokes(dt);
  }

  // Finds the thrower's team once, at burst time, so a throw by bare id still respects teams.
  // Inside a burning patch that hurts `team`?
  inFire(x, z, team) {
    for (let i = 0; i < this._projectiles.length; i++) {
      const p = this._projectiles[i], b = EQUIPMENT[p.kind].burn || EQUIPMENT[p.kind].gas;   // Gas too: bots walk out of both.
      if (b && p.stuck && !p.dead && p.team !== team && Math.hypot(p.x - x, p.z - z) < b.radius) return p;
    }
    return null;
  }

  _teamOf(p, players) {
    if (p.team !== undefined) return p.team;
    for (let i = 0; i < players.length; i++) if (players[i].id === p.owner) return players[i].team;
    return undefined;
  }

  _enemyOf(p, v, team) {
    return v.alive && v.id !== p.owner && !(team !== undefined && v.team === team);
  }

  _burst(p, spec, players, onEvent, onDamage) {
    if (spec.cloud) {
      this._smokes.push({ id: p.id, x: p.x, z: p.z, r: 0.01, a: 1, t: 0 });
      if (onEvent) onEvent({ t: 'bang', kind: p.kind, x: p.x, z: p.z, r: spec.cloud.radius, by: p.owner });
      return;
    }
    if (spec.snap) { this._sense(p, spec.snap.radius, spec.snap.dur, players, onEvent); return; }
    if (spec.tag) { if (p.attached === null) this._sense(p, spec.tag.radius, spec.tag.surfDur, players, onEvent); return; }
    if (spec.emp) { this._blackout(p, spec, players, onEvent); return; }
    if (spec.daze) { this._stun(p, spec, players, onEvent); return; }
    if (spec.spawns) {
      if (onEvent) onEvent({ t: spec.soft ? 'gear' : 'bang', kind: p.kind, x: p.x, z: p.z, r: spec.burstR, by: p.owner });
      this._projectiles.push(makeLying(this._nextId++, spec.spawns, p.owner, p.team, p.x, p.z));
      return;
    }
    if (spec.scatter) this._scatter(p, spec);
    const r = spec.blast ? spec.blast.radius : spec.flash.radius;
    const bang = { t: 'bang', kind: p.kind, x: p.x, z: p.z, r, by: p.owner };
    if (spec.drill && drillExit(this.map, p)) {
      bang.ox = p.x; bang.oz = p.z; bang.wall = 1;       // Bored through: it goes off on the far side.
      p.x = DRILL_AT.x; p.z = DRILL_AT.z; bang.x = p.x; bang.z = p.z;
    }
    if (spec.faces) bang.aim = p.dir;
    if (p.direct) bang.direct = 1;                         // Impact: went off on someone, not on the ground.
    if (p.attached !== null) bang.on = p.attached;          // Sticky: went off on someone.
    if (onEvent) onEvent(bang);
    if (spec.blast) this.setOffMines(p.x, p.z, r, p);
    const team = this._teamOf(p, players);
    if (spec.blast) this._blastCover(p, spec.blast, team, onEvent);
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, team) || v.spawnProtect) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d >= r) continue;
      if (spec.blast) {
        if (d > 1e-3 && raycastMap(this.map, p.x, p.z, (v.x - p.x) / d, (v.z - p.z) / d, d, 'blocksBullet')) continue;
        if (spec.blast.cone && d > spec.blast.back && !inCone(p, v, spec.blast.cone)) continue;   // Claymore: the front only.
        const dmg = blastDamage(spec.blast, d, v.perks);
        if (dmg > 0 && onDamage) onDamage(v.id, dmg, p.owner, spec.as || p.kind);
      } else {
        if (!hasLineOfSight(this.map, p.x, p.z, v.x, v.z, this._smokes)) continue;
        const f = spec.flash, masked = v.perks && v.perks.includes('tacmask') ? TACMASK_FLASH : 1;
        const amount = (d <= f.inner ? 1 : (f.radius - d) / (f.radius - f.inner)) * masked;
        if (onEvent) onEvent({ t: 'flashed', id: v.id, amount, dur: amount * f.maxDur, by: p.owner });
      }
    }
  }

  // Bomblets land on a ring around the burst, staggered, each one kept on this side of any wall it would be behind.
  _scatter(p, spec) {
    const s = spec.scatter;
    for (let i = 0; i < s.n; i++) {
      const a = p.id * 2.399 + (i / s.n) * Math.PI * 2;      // Golden-angle offset: varied per grenade, repeatable per id.
      const dx = Math.cos(a), dz = Math.sin(a);
      const hit = raycastMap(this.map, p.x, p.z, dx, dz, s.r + SKIN, 'blocksMove');
      const r = hit ? Math.max(0, hit.t - SKIN) : s.r;
      this._projectiles.push(makeLying(this._nextId++, s.kind, p.owner, p.team, p.x + dx * r, p.z + dz * r, i * s.gap));
    }
  }

  // Returns true when it hit someone, which uses it up.
  _directHit(p, spec, px, pz, players, onDamage) {
    const team = p.team, dx = p.x - px, dz = p.z - pz, len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, team) || v.spawnProtect) continue;
      const u = Math.max(0, Math.min(1, ((v.x - px) * dx + (v.z - pz) * dz) / (len * len)));
      if (Math.hypot(px + dx * u - v.x, pz + dz * u - v.z) > spec.direct.radius) continue;
      // Shiv: a hit in the back (the target facing the way the blade flies) is the kill; anything else is a wound.
      let dmg = spec.direct.damage;
      if (spec.direct.back && Number.isFinite(v.aim)) {
        let a = v.aim - Math.atan2(dz, dx);
        a = Math.atan2(Math.sin(a), Math.cos(a));
        if (Math.abs(a) <= spec.direct.cone) dmg = spec.direct.back;
      }
      if (onDamage) onDamage(v.id, dmg, p.owner, p.kind);
      if (spec.pickup) { p.stuck = true; p.grounded = true; p.vx = 0; p.vz = 0; p.x = v.x; p.z = v.z; p.land = p.age; }
      return true;
    }
    return false;
  }

  _tripped(p, spec, players) {
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, p.team) || v.spawnProtect) continue;
      const reach = spec.mine.trigger * (v.perks && v.perks.includes('coldblood') ? COLD_TRIGGER : 1);
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d >= reach) continue;
      if (!spec.mine.cone) return true;
      // Claymore: only someone in front of it, with nothing solid between, sets it off.
      if (inCone(p, v, spec.mine.cone) && !(d > 1e-3 && raycastMap(this.map, p.x, p.z, (v.x - p.x) / d, (v.z - p.z) / d, d, 'blocksBullet'))) return true;
    }
    return false;
  }

  _burn(p, spec, dt, players, onDamage) {
    p.t += dt;
    if (p.t < BURN_TICK) return;
    p.t -= BURN_TICK;
    const { radius, dps } = spec.burn;
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, p.team) || v.spawnProtect) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d >= radius) continue;
      if (d > 1e-3 && raycastMap(this.map, p.x, p.z, (v.x - p.x) / d, (v.z - p.z) / d, d, 'blocksBullet')) continue;
      const k = v.perks && v.perks.includes('tacmask') ? TACMASK_FIRE : 1;
      if (onDamage) onDamage(v.id, Math.max(1, Math.round(dps * BURN_TICK * k)), p.owner, spec.as || p.kind);
    }
  }

  _decoy(p, spec, dt, onEvent) {
    p.t -= dt;
    if (p.t > 0) return;
    p.t += DECOY_RHYTHM[p.n++ % DECOY_RHYTHM.length];
    if (onEvent) onEvent({ t: 'decoy', x: p.x, z: p.z, by: p.owner, team: p.team, weapon: spec.decoy.weapon });
  }

  // A recon reading (Sensor ping, Snapshot, a Tagger dart on the ground): every enemy in reach, through walls.
  _sense(p, radius, dur, players, onEvent) {
    if (!onEvent) return;
    onEvent({ t: 'pulse', kind: p.kind, x: p.x, z: p.z, r: radius, by: p.owner });
    const team = this._teamOf(p, players);
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, team) || Math.hypot(v.x - p.x, v.z - p.z) >= radius) continue;
      if (hasProIn(v.perks, v.pro, 'coldblood')) continue;     // Blank Slate.
      onEvent({ t: 'marked', id: v.id, by: p.owner, dur, kind: p.kind });
    }
  }

  // Sensor: once planted, a ping every `every` seconds until its fuse runs out.
  _pinger(p, spec, dt, players, onEvent) {
    const s = spec.sensor;
    if (p.n === 0) { p.n = 1; p.t = s.first; }
    p.t -= dt;
    if (p.t > 0) return;
    p.t += s.every;
    this._sense(p, s.radius, s.dur, players, onEvent);
  }

  // Sticky and Tagger: a throw that touches an enemy in flight sticks to them and rides along.
  _stick(p, spec, px, pz, players, onEvent) {
    const reach = spec.attach ? spec.attach.contact : spec.tag.contact;
    const dx = p.x - px, dz = p.z - pz, len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    const team = p.team;
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, team) || v.spawnProtect) continue;
      const u = Math.max(0, Math.min(1, ((v.x - px) * dx + (v.z - pz) * dz) / (len * len)));
      if (Math.hypot(px + dx * u - v.x, pz + dz * u - v.z) > reach) continue;
      p.attached = v.id; p.stuck = true; p.grounded = true; p.vx = 0; p.vz = 0; p.x = v.x; p.z = v.z;
      if (spec.attach) p.age = Math.min(p.age, spec.fuse - spec.attach.hold);   // Time to know it, not to shake it.
      else p.age = spec.fuse - spec.tag.dur;
      if (onEvent) {
        onEvent({ t: 'stuck', id: v.id, by: p.owner, kind: p.kind });
        if (spec.tag && !hasProIn(v.perks, v.pro, 'coldblood')) onEvent({ t: 'marked', id: v.id, by: p.owner, dur: spec.tag.dur, kind: p.kind });
      }
      return;
    }
  }

  // Keeps an attached throw on its carrier. False once the carrier is dead or gone: it drops where they fell.
  _follow(p, players) {
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (v.id !== p.attached) continue;
      if (!v.alive) return false;
      p.x = v.x; p.z = v.z;
      return true;
    }
    return false;
  }

  // Blackout: fries enemy devices in reach and jams every enemy it catches with nothing solid between.
  _blackout(p, spec, players, onEvent) {
    if (!onEvent) return;
    const e = spec.emp, team = this._teamOf(p, players);
    onEvent({ t: 'gear', kind: p.kind, x: p.x, z: p.z, r: e.radius, by: p.owner });
    this._fry(p, e.radius, team, players, onEvent);
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, team) || v.spawnProtect) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d >= e.radius) continue;
      if (d > 1e-3 && raycastMap(this.map, p.x, p.z, (v.x - p.x) / d, (v.z - p.z) / d, d, 'blocksBullet')) continue;
      onEvent({ t: 'jammed', id: v.id, by: p.owner, dur: e.dur });
    }
  }

  // Medpack: every `every` seconds, a little health to each living teammate (and the owner) in reach and in view.
  _medic(p, spec, dt, players, onEvent) {
    const m = spec.medic;
    p.t -= dt;
    if (p.t > 0 || !onEvent) return;
    p.t += m.every;
    const team = this._teamOf(p, players);
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!v.alive || !(v.id === p.owner || (team !== undefined && v.team === team))) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d >= m.radius) continue;
      if (d > 1e-3 && raycastMap(this.map, p.x, p.z, (v.x - p.x) / d, (v.z - p.z) / d, d, 'blocksBullet')) continue;
      onEvent({ t: 'heal', id: v.id, amount: m.amount, by: p.owner, kind: p.kind });
    }
  }

  // Thermite: fries enemy devices it can reach once lit, and keeps eating into any enemy Bulwark in reach.
  _thermite(p, spec, dt, players, onEvent) {
    const th = spec.therm, team = this._teamOf(p, players);
    if (p.n === 0) {
      p.n = 1;
      if (onEvent) onEvent({ t: 'gear', kind: p.kind, x: p.x, z: p.z, r: spec.burn.radius, by: p.owner });
      this._fry(p, th.melt, team, players, onEvent);
    }
    const list = this._projectiles;
    for (let i = 0; i < list.length; i++) {
      const q = list[i], c = EQUIPMENT[q.kind].cover;
      if (!c || q.dead || q.n === 0 || (team !== undefined && q.team === team)) continue;
      const r = coverRect(q, c, RECT);
      const gx = Math.max(r.x - p.x, 0, p.x - r.x - r.w), gz = Math.max(r.z - p.z, 0, p.z - r.z - r.d);
      if (gx * gx + gz * gz < th.melt * th.melt) this._hurtCover(q, th.coverDps * dt, p.owner, onEvent, p.kind);
    }
  }

  // Tripwire: once armed, an enemy across the beam sets it off where they cross. Cold Blooded only trips it close in.
  // The beam is set up the first tick it is stuck: off a wall it runs out along the wall's normal; on open ground it
  // runs both ways across the throw. Its direction rides vx, vz (unit for one-way, half length for both ways).
  _tripwire(p, spec, players) {
    const t = spec.trip;
    if (p.n === 0) {
      p.n = 1;
      if (!(p.vx || p.vz)) {
        if (p.wnx || p.wnz) { p.vx = p.wnx; p.vz = p.wnz; }
        else { p.vx = -Math.sin(p.dir) * 0.5; p.vz = Math.cos(p.dir) * 0.5; }
      }
      const b = tripBeam(this.map, p.x, p.z, p.vx, p.vz, BEAM);
      p.x0 = b.x0; p.z0 = b.z0; p.x1 = b.x1; p.z1 = b.z1;
    }
    if (p.age - Math.max(0, p.land) < t.arm) return false;
    const dx = p.x1 - p.x0, dz = p.z1 - p.z0, l2 = dx * dx + dz * dz;
    if (l2 < 1e-6) return false;
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, p.team) || v.spawnProtect) continue;
      const u = Math.max(0, Math.min(1, ((v.x - p.x0) * dx + (v.z - p.z0) * dz) / l2));
      const cx = p.x0 + dx * u, cz = p.z0 + dz * u;
      if (Math.hypot(v.x - cx, v.z - cz) > t.width) continue;
      if (v.perks && v.perks.includes('coldblood') && Math.hypot(v.x - p.x, v.z - p.z) > t.cold) continue;
      p.x = cx; p.z = cz;
      return true;
    }
    return false;
  }

  // Crawler: once armed, scuttles after the nearest enemy in reach that it has a clear line to, and goes off on
  // contact. With nobody in reach it sits and waits for its fuse. Movement rides the normal ground roll (fly).
  _crawl(p, spec, dt, players) {
    const c = spec.crawl;
    if (p.land < 0 || p.age - p.land < c.arm) return false;
    let best = null, bestD = c.seek;
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, p.team) || v.spawnProtect) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d <= c.contact) return true;
      if (d >= bestD) continue;
      if (raycastMap(this.map, p.x, p.z, (v.x - p.x) / d, (v.z - p.z) / d, d, 'blocksMove')) continue;
      best = v; bestD = d;
    }
    if (!best) { p.vx = 0; p.vz = 0; return false; }
    const k = (c.speed + ROLL_DECEL * dt) / bestD;     // The roll takes ROLL_DECEL off each tick; this puts it back.
    p.vx = (best.x - p.x) * k; p.vz = (best.z - p.z) * k;
    p.dir = Math.atan2(p.vz, p.vx);
    return false;
  }

  // Shiv: the owner walking over one they threw takes it back, if they have room for it.
  _pickup(p, spec, players, onEvent) {
    if (p.age < 0.5) return false;
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (v.id !== p.owner) continue;
      if (!v.alive || !v.room || Math.hypot(v.x - p.x, v.z - p.z) > spec.pickup) return false;
      if (onEvent) onEvent({ t: 'pickup', id: v.id, kind: p.kind });
      return true;
    }
    return false;
  }

  // A blast against enemy Bulwarks in reach: explosives are what cover is weak to.
  _blastCover(p, blast, team, onEvent) {
    const list = this._projectiles;
    for (let i = 0; i < list.length; i++) {
      const q = list[i], c = EQUIPMENT[q.kind].cover;
      if (!c || q.dead || q.n === 0 || q.owner === p.owner || (team !== undefined && q.team === team)) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d >= blast.radius) continue;
      this._hurtCover(q, blastDamage(blast, d) * c.blastMult, p.owner, onEvent, p.kind);
    }
  }

  // Shoots down the nearest enemy device in reach. Returns true when that was its last charge.
  _zap(p, spec, dt, players, onEvent) {
    p.t -= dt;
    if (p.t > 0) return false;
    const team = this._teamOf(p, players), list = this._projectiles;
    let best = null, bestD = spec.trophy.radius;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (q === p || q.dead || !ZAPPABLE.has(q.kind) || q.owner === p.owner || (team !== undefined && this._teamOf(q, players) === team)) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (!best) return false;
    best.dead = true;
    p.t = spec.trophy.gap;
    if (onEvent) onEvent({ t: 'zap', x: best.x, z: best.z, ox: p.x, oz: p.z, by: p.owner });
    return --p.charges <= 0;
  }

  // Returns true when something hit an enemy in flight (Impact goes off on them).
  _contact(p, spec, px, pz, players) {
    const dx = p.x - px, dz = p.z - pz, len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, p.team) || v.spawnProtect) continue;
      const u = Math.max(0, Math.min(1, ((v.x - px) * dx + (v.z - pz) * dz) / (len * len)));
      if (Math.hypot(px + dx * u - v.x, pz + dz * u - v.z) <= spec.contact) { p.x = px + dx * u; p.z = pz + dz * u; p.direct = true; return true; }
    }
    return false;
  }

  // Stun: everyone in the blast with nothing solid between is dazed, more and longer the closer they were.
  _stun(p, spec, players, onEvent) {
    if (!onEvent) return;
    const f = spec.daze;
    onEvent({ t: 'gear', kind: p.kind, x: p.x, z: p.z, r: f.radius, by: p.owner });
    const team = this._teamOf(p, players);
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, team) || v.spawnProtect) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d >= f.radius) continue;
      if (d > 1e-3 && raycastMap(this.map, p.x, p.z, (v.x - p.x) / d, (v.z - p.z) / d, d, 'blocksBullet')) continue;
      const masked = v.perks && v.perks.includes('tacmask') ? TACMASK_DAZE : 1;
      const amount = (d <= f.inner ? 1 : (f.radius - d) / (f.radius - f.inner)) * masked;
      onEvent({ t: 'dazed', id: v.id, amount, dur: Math.max(0.4, amount * f.maxDur), by: p.owner, kind: p.kind });
    }
  }

  // Gas: a cloud that grows to its radius, chips enemies inside it and keeps them dazed. Walls keep it out; a Tac Mask
  // ignores it altogether. Damage ticks with the fire's rhythm.
  _gas(p, spec, dt, players, onEvent, onDamage) {
    if (p.age < 0) return;
    p.t += dt;
    if (p.t < BURN_TICK) return;
    p.t -= BURN_TICK;
    const g = spec.gas, radius = g.radius * Math.min(1, 0.35 + p.age / g.grow), daze = p.n++ % GAS_DAZE_EVERY === 0;
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, p.team) || v.spawnProtect || (v.perks && v.perks.includes('tacmask'))) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d >= radius) continue;
      if (d > 1e-3 && raycastMap(this.map, p.x, p.z, (v.x - p.x) / d, (v.z - p.z) / d, d, 'blocksBullet')) continue;
      if (onDamage) onDamage(v.id, Math.max(1, Math.round(g.dps * BURN_TICK)), p.owner, spec.as);
      if (daze && onEvent) onEvent({ t: 'dazed', id: v.id, amount: g.daze, dur: g.dazeDur, by: p.owner, kind: spec.as });
    }
  }

  // Shock: once stuck, arcs `arcs` times. Each arc jolts enemies in reach (damage and a daze); the first also fries
  // every enemy device in reach. Returns true after the last arc, which uses it up.
  _shock(p, spec, dt, players, onEvent, onDamage) {
    const s = spec.shock;
    if (p.n === 0 && p.t === 0) p.t = s.first;
    p.t -= dt;
    if (p.t > 0) return false;
    p.t = s.gap;
    const team = this._teamOf(p, players);
    if (onEvent) onEvent({ t: 'gear', kind: p.kind, x: p.x, z: p.z, r: s.radius, by: p.owner, n: p.n });
    if (p.n === 0) this._fry(p, s.radius + 0.5, team, players, onEvent);
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!this._enemyOf(p, v, team) || v.spawnProtect) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d >= s.radius) continue;
      if (d > 1e-3 && raycastMap(this.map, p.x, p.z, (v.x - p.x) / d, (v.z - p.z) / d, d, 'blocksBullet')) continue;
      const masked = v.perks && v.perks.includes('tacmask') ? TACMASK_DAZE : 1;
      if (onDamage) onDamage(v.id, s.damage, p.owner, p.kind);
      if (onEvent) onEvent({ t: 'dazed', id: v.id, amount: s.daze * masked, dur: s.dazeDur * masked, by: p.owner, kind: p.kind });
    }
    return ++p.n >= s.arcs;
  }

  _fry(p, r, team, players, onEvent) {
    const list = this._projectiles;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (q === p || q.dead || !q.stuck || !FRYABLE.has(q.kind) || q.owner === p.owner || (team !== undefined && this._teamOf(q, players) === team)) continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) >= r) continue;
      q.dead = true;
      if (onEvent) onEvent({ t: 'fried', x: q.x, z: q.z, ox: p.x, oz: p.z, by: p.owner, kind: q.kind, src: p.kind });
    }
  }

  _stepSmokes(dt) {
    const c = EQUIPMENT.smoke.cloud;
    const list = this._smokes;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      s.t += dt;
      if (s.t >= c.life) continue;
      const grow = Math.min(1, s.t / c.grow);
      const fade = Math.min(1, (c.life - s.t) / c.fade);
      // Radius shrinks with opacity: a cloud you can see through must not block line of sight.
      s.r = c.radius * (1 - (1 - grow) * (1 - grow)) * fade;
      s.a = fade;
      list[w++] = s;
    }
    list.length = w;
  }
}

// ---- Gear wave helpers ----

const RECT = { x: 0, z: 0, w: 0, d: 0 };
// The footprint of a standing Bulwark: long across the way it was thrown, thin along it. Axis-aligned, because every
// wall in the game is: a throw that is more east-west than north-south gives a north-south shield, and so on.
function coverRect(p, c, out) {
  const alongX = Math.abs(p.vx) >= Math.abs(p.vz);
  const hw = alongX ? c.thick : c.half, hd = alongX ? c.half : c.thick;
  out.x = p.x - hw; out.z = p.z - hd; out.w = hw * 2; out.d = hd * 2;
  return out;
}

// Ray entry distance into a rectangle, or -1. An origin inside counts as 0.
function raySlab(ox, oz, dx, dz, r) {
  let t0 = 0, t1 = Infinity;
  if (Math.abs(dx) < 1e-9) { if (ox < r.x || ox > r.x + r.w) return -1; }
  else {
    let a = (r.x - ox) / dx, b = (r.x + r.w - ox) / dx;
    if (a > b) { const q = a; a = b; b = q; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  if (Math.abs(dz) < 1e-9) { if (oz < r.z || oz > r.z + r.d) return -1; }
  else {
    let a = (r.z - oz) / dz, b = (r.z + r.d - oz) / dz;
    if (a > b) { const q = a; a = b; b = q; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t0 <= t1 ? t0 : -1;
}

function rayCircleT(ox, oz, dx, dz, cx, cz, r) {
  const fx = cx - ox, fz = cz - oz, along = fx * dx + fz * dz;
  if (along < 0) return -1;
  const perp = fx * fx + fz * fz - along * along;
  return perp > r * r ? -1 : along;
}

// A Tripwire's beam from its wire fields: (vx, vz) of length about 1 runs one way out from the anchor (it is stuck to a
// wall), about 0.5 runs both ways (it lies on open ground). Clipped by anything that blocks movement. Fills `out`.
const BEAM = { x0: 0, z0: 0, x1: 0, z1: 0 };
export function tripBeam(map, x, z, vx, vz, out = BEAM) {
  const len = EQUIPMENT.tripwire.trip.len, l = Math.hypot(vx, vz) || 1, dx = vx / l, dz = vz / l;
  const reach = (dirX, dirZ, max) => { const h = raycastMap(map, x, z, dirX, dirZ, max, 'blocksMove'); return h ? Math.max(0, h.t - 0.05) : max; };
  if (l > 0.75) {
    out.x0 = x; out.z0 = z;
    const r = reach(dx, dz, len);
    out.x1 = x + dx * r; out.z1 = z + dz * r;
  } else {
    const a = reach(-dx, -dz, len / 2), b = reach(dx, dz, len / 2);
    out.x0 = x - dx * a; out.z0 = z - dz * a; out.x1 = x + dx * b; out.z1 = z + dz * b;
  }
  return out;
}

// Keeps one waist-high wall in map.walls per standing Bulwark in `list` (null clears them all). Walls are keyed by
// projectile id, so the host (from its own list) and a guest (from each decoded snapshot) converge on the same set;
// maps are shared module objects, so every match also clears what an earlier one left. Bulwarks count as waist-high
// cover everywhere (player.js isWaistCover) with `proof` set: no round pierces one, and a player right behind it fires over it.
let coverGen = 0;
export function syncCover(map, list) {
  if (!map || !map.walls) return;
  const live = map._cover || (map._cover = new Map());
  const gen = ++coverGen;
  let seen = 0;
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i], c = EQUIPMENT[p.kind]?.cover;
      if (!c || p.dead || !p.stuck || !(p.vx || p.vz)) continue;
      let w = live.get(p.id);
      if (!w) {
        const r = coverRect(p, c, RECT);
        w = { x: r.x, z: r.z, w: r.w, d: r.d, h: c.h, kind: 'bulwark', blocksMove: true, blocksBullet: false, blocksVision: false, proof: true, coverId: p.id, gen };
        live.set(p.id, w);
        map.walls.push(w);
      }
      w.gen = gen; seen++;
    }
  }
  if (seen === live.size) return;
  for (const [id, w] of live) {
    if (w.gen === gen) continue;
    live.delete(id);
    const k = map.walls.indexOf(w);
    if (k >= 0) map.walls.splice(k, 1);
  }
}
