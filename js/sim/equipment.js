// Grenades and other thrown equipment. Host-only, pure, runs in node: no DOM, no three, no randomness.
//
// Interface (sim.js owns one instance per match):
//   const eq = new EquipmentSystem(map);
//   eq.throw(owner, kind, ox, oz, aim)   owner is a player id, or {id, team}. kind: frag|sticky|smoke|flash|stim.
//                                        Does not check counts: the caller validates those first.
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

import { MAX_HP } from '../shared/constants.js';
import { hasLineOfSight, raycastMap, resolveCircle } from '../shared/geometry.js';

export const THROW_RANGE = 13;
export const FLAK_MULT = 0.55;

const THROW_SPEED = 15;
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
  throw(owner, kind, ox, oz, aim) {
    const spec = EQUIPMENT[kind];
    if (!spec) return null;
    const id = ownerIdOf(owner);
    if (spec.instant) {
      this._pending.push({ t: 'heal', id, amount: spec.heal });
      return null;
    }
    this._pending.push({ t: 'throw', id, kind, ox, oz, aim });
    const p = {
      id: this._nextId++, kind, owner: id,
      team: owner !== null && typeof owner === 'object' ? owner.team : undefined,
      x: ox, z: oz, y: 1.1,
      vx: Math.cos(aim) * THROW_SPEED, vz: Math.sin(aim) * THROW_SPEED,
      age: 0, stuck: false, grounded: false,
    };
    this._projectiles.push(p);
    return p;
  }

  step(dt, players, onEvent, onDamage) {
    for (let i = 0; i < this._pending.length; i++) if (onEvent) onEvent(this._pending[i]);
    this._pending.length = 0;

    const list = this._projectiles;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i], spec = EQUIPMENT[p.kind];
      p.age += dt;
      this._fly(p, spec, dt);
      const stopped = spec.popsOnStop && p.grounded && Math.hypot(p.vx, p.vz) < STOPPED_SPEED;
      if (p.age >= spec.fuse || stopped) this._burst(p, spec, players, onEvent, onDamage);
      else list[w++] = p;
    }
    list.length = w;

    this._stepSmokes(dt);
  }

  _fly(p, spec, dt) {
    if (p.stuck) return;
    if (!p.grounded) {
      const u = p.age / spec.air;
      if (u >= 1) {
        p.y = 0;
        p.grounded = true;
        if (spec.sticks) { p.stuck = true; p.vx = 0; p.vz = 0; return; }
        p.vx *= LAND_SPEED_KEEP; p.vz *= LAND_SPEED_KEEP;
        resolveCircle(this.map, p, SKIN);     // Coming down on a crate puts it beside the crate.
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
    this._sweep(p, spec, dt);
  }

  // In flight it clears waist-high cover; on the ground, crates and barriers stop it too.
  _sweep(p, spec, dt) {
    const flag = p.grounded ? 'blocksMove' : 'blocksBullet';
    let left = dt;
    for (let guard = 0; guard < 4 && left > 1e-5; guard++) {
      const speed = Math.hypot(p.vx, p.vz);
      if (speed < 1e-3) return;
      const dirX = p.vx / speed, dirZ = p.vz / speed, reach = speed * left;
      const hit = raycastMap(this.map, p.x, p.z, dirX, dirZ, reach + SKIN, flag);
      if (!hit) { p.x += dirX * reach; p.z += dirZ * reach; return; }
      const travel = Math.max(0, Math.min(reach, hit.t - SKIN));
      p.x += dirX * travel; p.z += dirZ * travel;
      left -= travel / speed;
      if (spec.sticks) { p.stuck = true; p.vx = 0; p.vz = 0; return; }
      const vn = p.vx * hit.nx + p.vz * hit.nz;
      p.vx = (p.vx - (1 + WALL_RESTITUTION) * vn * hit.nx) * WALL_SCRUB;
      p.vz = (p.vz - (1 + WALL_RESTITUTION) * vn * hit.nz) * WALL_SCRUB;
    }
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
