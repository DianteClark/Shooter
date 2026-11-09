// Grenades and other thrown equipment. Host-only, pure, runs in node: no DOM, no three, no randomness.
//
// Interface (sim.js owns one instance per match):
//   const eq = new EquipmentSystem(map);
//   eq.throw(owner, kind, ox, oz, aim, dist)  owner is a player id, or {id, team}. kind: frag|sticky|smoke|flash|stim.
//                                        dist (optional, metres) is where it should end up on open ground; absent
//                                        means the default range. Does not check counts: the caller validates those.
//   previewThrow(map, ox, oz, aim, dist, kind)   the same throw run forward: polyline, bounces and landing.
//   eq.step(dt, players, onEvent, onDamage)
//       players    [{id, team, x, z, alive, perks?, spawnProtect?}], the flat shape traceShot takes.
//       onEvent(e) {t:'throw',id,kind,ox,oz,aim}    queued by throw(), delivered on the next step
//                  {t:'heal',id,amount}             the caller adds amount to HP, capped at MAX_HP
//                  {t:'bang',kind,x,z,r,by}         frag, sticky, flash, smoke bursts
//                  {t:'flashed',id,amount,dur,by}   amount 0..1, dur = seconds of blindness
//       onDamage(targetId, dmg, ownerId, kind)      Flak is ALREADY applied. Never called for the
//                                                   owner or the owner's team. dmg is a whole number.
//   eq.projectiles   live [{id,kind,x,z,y,owner,...}]  matches GameView.projectiles
//   eq.smokes        live [{id,x,z,r,a}]               pass straight to hasLineOfSight / smokeBlocks; a = opacity 0..1
//   eq.reset()       drops everything in flight (between rounds)
//
// A Strike or other host-side explosion can share the falloff through blastDamage() and flakMult().

import { MAX_HP, SIM_HZ } from '../shared/constants.js';
import { hasLineOfSight, raycastMap, resolveCircle } from '../shared/geometry.js';

export const THROW_RANGE = 13;           // Base maximum, and where a quick tap lands.
export const STRONGARM_RANGE = 19;       // Maximum with the Strong Arm perk.
export const MIN_THROW = 2;
export const FLAK_MULT = 0.55;

const THROW_SPEED = 15;
const STEP = 1 / SIM_HZ;                 // The host integrates throws at this rate, and so does the preview.
const ARC_HEIGHT = 1.9;
const SKIN = 0.12;              // Kept between a projectile and any wall, so the next ray starts clear of it.
const WALL_RESTITUTION = 0.5;
const WALL_SCRUB = 0.85;        // Speed kept along the wall after a bounce.
const LAND_SPEED_KEEP = 0.5;
const ROLL_DECEL = 18;
const STOPPED_SPEED = 0.4;

// `air` is how long the throw flies before touching the ground. A rolling grenade flies 11.25 m and
// rolls about 1.5 m more, so every kind ends up near THROW_RANGE.
export const EQUIPMENT = {
  frag:   { fuse: 1.8, air: 0.75, blast: { radius: 6.2, inner: 1.4, max: 135, min: 15 } },
  sticky: { fuse: 1.2, air: THROW_RANGE / THROW_SPEED, sticks: true, blast: { radius: 4.6, inner: 1.6, max: 165, min: 20 } },
  flash:  { fuse: 0.95, air: 0.75, flash: { radius: 12, inner: 3, maxDur: 3.2 } },
  smoke:  { fuse: 2.2, air: 0.75, popsOnStop: true, cloud: { radius: 4.5, life: 9, grow: 0.8, fade: 1.8 } },
  stim:   { instant: true, heal: MAX_HP },
};

// Furthest a player with these perks may throw. The host clamps with this; so should anything drawing a preview.
export function maxThrowRange(perks) {
  return perks && perks.includes('strongarm') ? STRONGARM_RANGE : THROW_RANGE;
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

function ownerIdOf(owner) {
  return owner !== null && typeof owner === 'object' ? owner.id : owner;
}

function makeProjectile(id, kind, owner, ox, oz, aim, dist) {
  const v = speedFor(kind, dist);
  return { id, kind, owner, team: undefined, x: ox, z: oz, y: 1.1,
    vx: Math.cos(aim) * v, vz: Math.sin(aim) * v, age: 0, stuck: false, grounded: false };
}

// One tick of a live projectile. Real throws and previews both go through here, so they cannot disagree.
// `onBounce` is optional; returns true once the thing has gone off.
function advance(map, p, spec, dt, onBounce) {
  p.age += dt;
  fly(map, p, spec, dt, onBounce);
  const stopped = spec.popsOnStop && p.grounded && Math.hypot(p.vx, p.vz) < STOPPED_SPEED;
  return p.age >= spec.fuse || stopped;
}

function fly(map, p, spec, dt, onBounce) {
  if (p.stuck) return;
  if (!p.grounded) {
    const u = p.age / spec.air;
    if (u >= 1) {
      p.y = 0;
      p.grounded = true;
      if (onBounce) onBounce(p.x, p.z, 'land');
      if (spec.sticks) { p.stuck = true; p.vx = 0; p.vz = 0; return; }
      p.vx *= LAND_SPEED_KEEP; p.vz *= LAND_SPEED_KEEP;
      resolveCircle(map, p, SKIN);     // Coming down on a crate puts it beside the crate.
    } else {
      p.y = 1.1 * (1 - u) + ARC_HEIGHT * 4 * u * (1 - u);
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

// In flight it clears waist-high cover; on the ground, crates and barriers stop it too.
function sweep(map, p, spec, dt, onBounce) {
  const flag = p.grounded ? 'blocksMove' : 'blocksBullet';
  let left = dt;
  for (let guard = 0; guard < 4 && left > 1e-5; guard++) {
    const speed = Math.hypot(p.vx, p.vz);
    if (speed < 1e-3) return;
    const dirX = p.vx / speed, dirZ = p.vz / speed, reach = speed * left;
    const hit = raycastMap(map, p.x, p.z, dirX, dirZ, reach + SKIN, flag);
    if (!hit) { p.x += dirX * reach; p.z += dirZ * reach; return; }
    const travel = Math.max(0, Math.min(reach, hit.t - SKIN));
    p.x += dirX * travel; p.z += dirZ * travel;
    left -= travel / speed;
    if (onBounce) onBounce(p.x, p.z, 'wall');
    if (spec.sticks) { p.stuck = true; p.vx = 0; p.vz = 0; return; }
    const vn = p.vx * hit.nx + p.vz * hit.nz;
    p.vx = (p.vx - (1 + WALL_RESTITUTION) * vn * hit.nx) * WALL_SCRUB;
    p.vz = (p.vz - (1 + WALL_RESTITUTION) * vn * hit.nz) * WALL_SCRUB;
  }
}

// Throw speed for "end up `dist` metres away on open ground". Worked out by flying each kind once at load across
// a ladder of speeds, so the answer includes roll and fuse without having to be derived for each kind.
const OPEN_GROUND = { walls: [], width: 1e7, height: 1e7 };
const SPEED_MIN = 1, SPEED_STEP = 1, SPEED_COUNT = 40;
const REACH_TABLE = {};
for (const kind of Object.keys(EQUIPMENT)) {
  if (EQUIPMENT[kind].instant) continue;
  const spec = EQUIPMENT[kind], reach = new Float32Array(SPEED_COUNT);
  for (let i = 0; i < SPEED_COUNT; i++) {
    const p = { x: 5e6, z: 5e6, y: 1.1, vx: SPEED_MIN + i * SPEED_STEP, vz: 0, age: 0, stuck: false, grounded: false };
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

// The exact path of the throw `eq.throw(.., ox, oz, aim, dist)` would make, ticked forward with no one in the way.
// Returns { points:[{x,z,y}], bounces:[{x,z}], landing:{x,z,t,kind} }, or null for stim and unknown kinds.
// `landing` is where it goes off (or stops, for smoke). Callers clamp `dist` with maxThrowRange(perks).
export function previewThrow(map, ox, oz, aim, dist, kind) {
  const spec = EQUIPMENT[kind];
  if (!spec || spec.instant) return null;
  const p = makeProjectile(0, kind, null, ox, oz, aim, dist);
  const points = [{ x: ox, z: oz, y: p.y }], bounces = [];
  const onBounce = (x, z) => { bounces.push({ x, z }); };
  for (let g = 0; g < 400; g++) {
    const done = advance(map, p, spec, STEP, onBounce);
    points.push({ x: p.x, z: p.z, y: p.y });
    if (done) break;
  }
  return { points, bounces, landing: { x: p.x, z: p.z, t: p.age, kind } };
}

export class EquipmentSystem {
  constructor(map) {
    this.map = map;
    this._projectiles = [];
    this._smokes = [];
    this._pending = [];   // Events raised by throw(), delivered on the next step.
    this._nextId = 1;
  }

  get projectiles() { return this._projectiles; }
  get smokes() { return this._smokes; }

  reset() {
    this._projectiles.length = 0;
    this._smokes.length = 0;
    this._pending.length = 0;
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
    this._pending.push({ t: 'throw', id, kind, ox, oz, aim, dist: Number.isFinite(dist) ? dist : THROW_RANGE });
    const p = makeProjectile(this._nextId++, kind, id, ox, oz, aim, dist);
    p.team = owner !== null && typeof owner === 'object' ? owner.team : undefined;
    this._projectiles.push(p);
    return p;
  }

  // Host migration: picks up everything in flight from a snapshot. Entries are GameView projectiles and smokes.
  restore(projectiles, smokes, teamOf) {
    for (const v of projectiles || []) {
      if (!EQUIPMENT[v.kind] || EQUIPMENT[v.kind].instant) continue;
      this._projectiles.push({ id: v.id, kind: v.kind, owner: v.owner, team: teamOf(v.owner), x: v.x, z: v.z, y: v.y,
        vx: v.vx || 0, vz: v.vz || 0, age: v.age || 0, stuck: !!v.stuck, grounded: !!v.grounded });
      this._nextId = Math.max(this._nextId, v.id + 1);
    }
    for (const v of smokes || []) {
      this._smokes.push({ id: v.id, x: v.x, z: v.z, r: v.r, a: 1, t: v.age || 0 });
      this._nextId = Math.max(this._nextId, v.id + 1);
    }
  }

  // A player came back under a new id: grenades still in the air are credited to it.
  rebindOwner(oldId, newId) {
    for (const p of this._projectiles) if (p.owner === oldId) p.owner = newId;
  }

  step(dt, players, onEvent, onDamage) {
    for (let i = 0; i < this._pending.length; i++) if (onEvent) onEvent(this._pending[i]);
    this._pending.length = 0;

    const list = this._projectiles;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i], spec = EQUIPMENT[p.kind];
      if (advance(this.map, p, spec, dt)) this._burst(p, spec, players, onEvent, onDamage);
      else list[w++] = p;
    }
    list.length = w;

    this._stepSmokes(dt);
  }

  // Finds the thrower's team once, at burst time, so a throw by bare id still respects teams.
  _teamOf(p, players) {
    if (p.team !== undefined) return p.team;
    for (let i = 0; i < players.length; i++) if (players[i].id === p.owner) return players[i].team;
    return undefined;
  }

  _burst(p, spec, players, onEvent, onDamage) {
    if (spec.cloud) {
      this._smokes.push({ id: p.id, x: p.x, z: p.z, r: 0.01, a: 1, t: 0 });
      if (onEvent) onEvent({ t: 'bang', kind: p.kind, x: p.x, z: p.z, r: spec.cloud.radius, by: p.owner });
      return;
    }
    const r = spec.blast ? spec.blast.radius : spec.flash.radius;
    if (onEvent) onEvent({ t: 'bang', kind: p.kind, x: p.x, z: p.z, r, by: p.owner });
    const team = this._teamOf(p, players);
    for (let i = 0; i < players.length; i++) {
      const v = players[i];
      if (!v.alive || v.id === p.owner || v.spawnProtect) continue;
      if (team !== undefined && v.team === team) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d >= r) continue;
      if (spec.blast) {
        if (d > 1e-3 && raycastMap(this.map, p.x, p.z, (v.x - p.x) / d, (v.z - p.z) / d, d, 'blocksBullet')) continue;
        const dmg = blastDamage(spec.blast, d, v.perks);
        if (dmg > 0 && onDamage) onDamage(v.id, dmg, p.owner, p.kind);
      } else {
        if (!hasLineOfSight(this.map, p.x, p.z, v.x, v.z, this._smokes)) continue;
        const f = spec.flash;
        const amount = d <= f.inner ? 1 : (f.radius - d) / (f.radius - f.inner);
        if (onEvent) onEvent({ t: 'flashed', id: v.id, amount, dur: amount * f.maxDur, by: p.owner });
      }
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
