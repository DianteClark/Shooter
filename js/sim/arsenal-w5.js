// Weapons wave 5's two new mechanics (js/shared/weapons-w5.js), host only, pure, runs in node. Kept out of sim.js so
// that file only carries the hooks; every function takes the Sim.
//
//   Burn     a hit from a gun with `burn` sets the target burning: BURN_TICK-second ticks of the gun's dps for its
//            `time`, credited to the shooter and the gun (a burn kill is the Fusee's kill). A new hit restarts the
//            clock, it never stacks. Tac Mask halves it (as it halves every fire). With `mark`, a burning target is on
//            the shooter's team map until the fire goes out (Blank Slate keeps them off it). An 'ignite' event tells
//            every phone to draw the flames; dying, or the clock, puts them out.
//   Lock-on  a fully aimed shot from a gun with `lockon`, with an enemy aircraft within `cone` of the aim and `range`
//            metres (ground distance), homes on the nearest-to-the-aim one: `air` damage to it, nothing on the
//            ground. The shot event carries `lk: [x, z]` so the rocket is drawn climbing to it.
import { WEAPONS } from '../shared/weapons.js';
import { angleDiff, hasPro } from './player.js';
import { AIR_HP, airHp, hurtAir } from './streaks-v9.js';

export const BURN_TICK = 0.5;
const TACMASK_BURN = 0.5;

// ---------------------------------------------------------------- burn

// After a gun hit lands (sim._damage, gunfire only). Starts or restarts the target's burn.
export function onGunHit(sim, target, attacker, weapon, dist) {
  const b = WEAPONS[weapon]?.burn;
  if (!b || !target.alive) return;
  const masked = target.ps.perks?.includes('tacmask');
  target.burn = { by: attacker, weapon, dist, left: b.time, tick: BURN_TICK, per: b.dps * BURN_TICK * (masked ? TACMASK_BURN : 1), mark: !!b.mark };
  if (b.mark && sim._markable(target)) target.markT = Math.max(target.markT, b.time);
  sim._emit({ t: 'ignite', id: target.id, by: attacker.id, dur: b.time });
}

// Every tick, for every player (sim._stepTimers): the burn's clock and its ticks of damage.
export function stepBurn(sim, p, dt) {
  const b = p.burn;
  if (!b) return;
  if (!p.alive || sim.phase !== 'live') { p.burn = null; return; }
  b.left -= dt; b.tick -= dt;
  if (b.tick <= 0) {
    b.tick += BURN_TICK;
    // The shooter may have left; the fire still burns, credited to nobody it can no longer be.
    if (b.by && sim.byId.get(b.by.id) === b.by) {
      sim._burning = true;            // A tick of the burn is not a fresh hit: it must not light it again.
      try { sim._damage(p, b.by, b.per, b.weapon, b.dist, null, false, null); } finally { sim._burning = false; }
    }
  }
  if (b.left <= 0 || !p.alive) p.burn = null;
}

// ---------------------------------------------------------------- lock-on

// The aircraft a shot locks on to, or null. Gunfire only reaches what it can see; a homing rocket climbs to anything
// flying inside its cone, so there is no line-of-sight test (aircraft are above the roofs).
export function lockTarget(sim, shooter, shot, w) {
  const L = w.lockon;
  if (!L || !sim.gunships.length) return null;
  const ads = shot.ads ?? (shooter.ps.adsT >= 0.85);
  if (!ads) return null;
  let best = null, bestA = L.cone;
  for (let i = 0; i < sim.gunships.length; i++) {
    const g = sim.gunships[i];
    if (g.team === shooter.team || !(g.kind in AIR_HP)) continue;
    const dx = g.x - shot.ox, dz = g.z - shot.oz, d = Math.hypot(dx, dz);
    if (d > L.range) continue;
    // Straight overhead counts as in the cone: the seeker looks up, not along the ground.
    const a = d < 3 ? 0 : Math.abs(angleDiff(Math.atan2(dz, dx), shot.aim));
    if (a <= bestA) { best = g; bestA = a; }
  }
  return best;
}

// The locked rocket arrives. Returns true when it brought the aircraft down.
export function hitLock(sim, shooter, g, w) {
  airHp(g);
  return hurtAir(sim, g, w.lockon.air, shooter);
}

// A lock-on gun's value against a kind of aircraft: rockets to bring it down (Help and the HUD hint read it).
export function locksToDown(kind, w) {
  const hp = AIR_HP[kind];
  return hp && w?.lockon ? Math.ceil(hp / w.lockon.air) : 0;
}


// ---------------------------------------------------------------- Skywatch (perks wave, catalog.js)

export const SKYWATCH_MULT = 1.4, SKYWATCH_PRO_MARK = 3;
// What a hit on an enemy streak (aircraft or machine) does with Skywatch: 40% more, and with Flak Gunner its owner goes
// on the hitter's team map. `owner` is the streak's owner (a player record), when it has one.
export function streakDamage(sim, by, owner, dmg) {
  if (!by?.ps?.perks?.includes('skywatch') || !(dmg > 0)) return dmg;
  if (owner && owner.alive && owner.team !== by.team && hasPro(by.ps, 'skywatch') && sim._markable(owner)) owner.markT = Math.max(owner.markT, SKYWATCH_PRO_MARK);
  return dmg * SKYWATCH_MULT;
}
