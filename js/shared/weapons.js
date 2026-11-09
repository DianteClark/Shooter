// Weapon definitions. Numbers are tuned against a 100 HP player: see `shotsToKill` / `damageAt`
// and dev/sim-* for the time-to-kill table. Units: metres, seconds, radians (half-angle spread).
//
// Common stats (contract):
//   damage, rpm, magazine, reserve, reload, range, adsSpread, hipSpread, bloomPerShot, bloomRecover,
//   adsTime, sprintToFire, moveMult, adsMoveMult, pellets, falloff {start,end,min}, kickCam, tracerWidth, auto.
//
// What makes each gun play differently lives in the optional fields below, all read by stepPlayer:
//   swapTime        seconds to bring the gun up (the pistol's whole point)
//   bloomScale      how far full bloom widens the cone (1 + bloom * bloomScale)
//   holdRpm         semi-autos: rate when the trigger is simply held. 0 = must release between shots.
//   pattern         {amp, freq, ramp, drift?}: learnable side-to-side recoil by shot index, radians. drift is a
//                   one-sided pull added per shot (up to 12 of them), which is what makes a gun buck off target
//   burst           {count, gap}: the trigger fires `count` rounds `gap` seconds apart, committed once started.
//                   rpm is then the gun's true cadence: the recovery after a burst is whatever makes it come out right
//   spinup          {shots, from}: fire rate ramps from `from` x rpm to full over `shots`
//   heat            {rounds, coolDelay, coolTime, lockout, loosenFrom}: rounds to full bar, idle seconds before
//                   cooling, seconds full to empty, lockout at full, bar fraction past which accuracy loosens
//   headMult        damage multiplier for a head hit (see HEAD_RADIUS)
//   turnCap         max rad/s of aim rotation while aiming or firing; absent = uncapped
//   shellReload     reload is one round at a time, and firing interrupts it
//   slideFire       no spread penalty while sliding
//   adsGate         damage multiplier applied unless fully aimed (sniper hipfire)
//   boltKick        adsT is knocked back to this after a shot (bolt cycle costs you the scope)
//   unlimitedReserve reloading never drains reserve, so nobody is ever left unarmed
//   explosive       {radius, damage, inner, min}: the host detonates this shot at the end of its ray (see Sim);
//                   full damage inside inner, linear to min at the edge. Blocked by hard cover. No self damage.
//
// Attachments (js/shared/attachments.js) produce an effective def with these same fields; see effectiveWeapon.

import { applyAttachments } from './attachments.js';

// A ray passing this close to a target's centre is a head hit. Top-down, so the head is the bullseye.
export const HEAD_RADIUS = 0.2;
const DEFAULT_HEAD_MULT = 1.4;

export const WEAPONS = {
  // All-rounder. Wins at mid range; the recoil curve rewards players who learn it.
  ar: {
    id: 'ar', name: 'Halyard', role: 'Assault', auto: true,
    damage: 28, rpm: 700, magazine: 30, reserve: 150, reload: 2.05, range: 60,
    falloff: { start: 26, end: 44, min: 0.68 },
    adsSpread: 0.006, hipSpread: 0.052, bloomPerShot: 0.09, bloomRecover: 2.4, bloomScale: 1.5,
    pattern: { amp: 0.012, freq: 0.62, ramp: 5 },
    headMult: 1.4, turnCap: 15,
    adsTime: 0.2, sprintToFire: 0.17, swapTime: 0.34, moveMult: 1, adsMoveMult: 0.55,
    pellets: 1, kickCam: 0.5, tracerWidth: 1,
  },

  // Fire from the hip, on the move, out of a slide. Falls apart past its range.
  smg: {
    id: 'smg', name: 'Skitter', role: 'Rush', auto: true,
    damage: 22, rpm: 950, magazine: 32, reserve: 192, reload: 1.75, range: 40,
    falloff: { start: 12, end: 24, min: 0.5 },
    adsSpread: 0.018, hipSpread: 0.036, bloomPerShot: 0.05, bloomRecover: 3.2, bloomScale: 1.3,
    pattern: { amp: 0.009, freq: 1.3, ramp: 3 },
    headMult: 1.4,
    adsTime: 0.13, sprintToFire: 0.09, swapTime: 0.26, moveMult: 1.07, adsMoveMult: 0.8,
    pellets: 1, slideFire: true, kickCam: 0.32, tracerWidth: 0.75,
  },

  // A fan of pellets: one pump up close, two a little further. Loads shell by shell, fire to interrupt.
  shotgun: {
    id: 'shotgun', name: 'Thresher', role: 'Breach', auto: false, holdRpm: 140,
    damage: 15, rpm: 150, magazine: 7, reserve: 42, reload: 0.42, range: 24,
    falloff: { start: 7, end: 16, min: 0.3 },
    adsSpread: 0.055, hipSpread: 0.1, bloomPerShot: 0.15, bloomRecover: 1.6, bloomScale: 0.45,
    headMult: 1.1, turnCap: 7,
    adsTime: 0.17, sprintToFire: 0.14, swapTime: 0.42, moveMult: 1.02, adsMoveMult: 0.68,
    pellets: 8, shellReload: true, kickCam: 1, tracerWidth: 0.55,
  },

  // Slow to get going, then a wall of fire until the barrel gives out. Swings like a gate: guard an angle.
  lmg: {
    id: 'lmg', name: 'Bulwark', role: 'Suppress', auto: true,
    damage: 32, rpm: 720, magazine: 100, reserve: 200, reload: 4.5, range: 64,
    falloff: { start: 30, end: 50, min: 0.72 },
    adsSpread: 0.012, hipSpread: 0.095, bloomPerShot: 0, bloomRecover: 1.5, bloomScale: 1.7,
    spinup: { shots: 9, from: 0.68 },
    heat: { rounds: 40, coolDelay: 0.4, coolTime: 2.5, lockout: 2.2, loosenFrom: 0.75 },
    headMult: 1.4, turnCap: 2.4,
    pattern: { amp: 0.014, freq: 0.34, ramp: 8 },
    adsTime: 0.36, sprintToFire: 0.34, swapTime: 0.62, moveMult: 0.86, adsMoveMult: 0.42,
    pellets: 1, kickCam: 0.72, tracerWidth: 1.25,
  },

  // Fully aimed it erases anyone in range; from the hip it is a bad pistol. The bolt throws you off the scope.
  sniper: {
    id: 'sniper', name: 'Lancet', role: 'Overwatch', auto: false, holdRpm: 0,
    damage: 125, rpm: 46, magazine: 5, reserve: 30, reload: 3.1, range: 80,
    falloff: { start: 60, end: 80, min: 0.7 },
    adsSpread: 0.0015, hipSpread: 0.2, bloomPerShot: 0.6, bloomRecover: 1.0, bloomScale: 1,
    adsGate: 0.42, boltKick: 0.45, headMult: 1, turnCap: 4.5,
    adsTime: 0.4, sprintToFire: 0.4, swapTime: 0.6, moveMult: 0.9, adsMoveMult: 0.38,
    pellets: 1, kickCam: 1.2, tracerWidth: 1.6,
  },

  // Out in a blink, moves at full speed. Tap faster than it fires when held.
  pistol: {
    id: 'pistol', name: 'Flicker', role: 'Sidearm', auto: false, holdRpm: 330,
    damage: 36, rpm: 430, magazine: 12, reserve: 96, reload: 1.25, range: 42,
    falloff: { start: 15, end: 30, min: 0.6 },
    adsSpread: 0.012, hipSpread: 0.03, bloomPerShot: 0.13, bloomRecover: 3.5, bloomScale: 1.1,
    headMult: 1.4,
    adsTime: 0.1, sprintToFire: 0.06, swapTime: 0.15, moveMult: 1.1, adsMoveMult: 0.9,
    pellets: 1, slideFire: true, unlimitedReserve: true, kickCam: 0.4, tracerWidth: 0.8,
  },

  // Three rounds per pull, committed once started. One clean burst to the head is a kill; a body-only target
  // needs a second one, so it pays for accuracy and loses to anything that spots it first up close.
  burst: {
    id: 'burst', name: 'Cadence', role: 'Pacer', auto: true,
    damage: 29, rpm: 500, burst: { count: 3, gap: 0.07 }, magazine: 27, reserve: 135, reload: 2.1, range: 62,
    falloff: { start: 30, end: 50, min: 0.7 },
    adsSpread: 0.004, hipSpread: 0.05, bloomPerShot: 0.07, bloomRecover: 2.6, bloomScale: 1.4,
    pattern: { amp: 0.008, freq: 1, ramp: 1 },
    headMult: 1.4, turnCap: 14,
    adsTime: 0.22, sprintToFire: 0.2, swapTime: 0.36, moveMult: 0.98, adsMoveMult: 0.55,
    pellets: 1, kickCam: 0.55, tracerWidth: 1.05,
  },

  // The fastest kill in the game inside a room, and a fight with the muzzle everywhere else.
  pdw: {
    id: 'pdw', name: 'Rasp', role: 'Knife fight', auto: true,
    damage: 20, rpm: 1200, magazine: 28, reserve: 168, reload: 1.6, range: 34,
    falloff: { start: 9, end: 19, min: 0.45 },
    adsSpread: 0.024, hipSpread: 0.042, bloomPerShot: 0.07, bloomRecover: 3, bloomScale: 1.6,
    pattern: { amp: 0.028, freq: 1.75, ramp: 2, drift: 0.0028 },
    headMult: 1.3,
    adsTime: 0.12, sprintToFire: 0.08, swapTime: 0.24, moveMult: 1.08, adsMoveMult: 0.82,
    pellets: 1, slideFire: true, kickCam: 0.6, tracerWidth: 0.7,
  },

  // Two shells at arm's length and nothing much past a doorway. Drum fed: one long reload, no shell-by-shell.
  autoshot: {
    id: 'autoshot', name: 'Squall', role: 'Doorway', auto: true,
    damage: 11, rpm: 270, magazine: 14, reserve: 56, reload: 3.3, range: 18,
    falloff: { start: 5, end: 11, min: 0.3 },
    adsSpread: 0.07, hipSpread: 0.115, bloomPerShot: 0.12, bloomRecover: 1.8, bloomScale: 0.5,
    pattern: { amp: 0.02, freq: 1.1, ramp: 3 },
    headMult: 1.05, turnCap: 6.5,
    adsTime: 0.2, sprintToFire: 0.17, swapTime: 0.46, moveMult: 0.97, adsMoveMult: 0.62,
    pellets: 7, kickCam: 0.95, tracerWidth: 0.5,
  },

  // Strict semi-auto: every round is its own trigger pull. Two to the body through mid range, and it flinches the
  // scope a little each time, so a measured tap beats a frantic one.
  dmr: {
    id: 'dmr', name: 'Tallyman', role: 'Marksman', auto: false, holdRpm: 0,
    damage: 52, rpm: 210, magazine: 12, reserve: 72, reload: 2.5, range: 72,
    falloff: { start: 34, end: 56, min: 0.68 },
    adsSpread: 0.0025, hipSpread: 0.09, bloomPerShot: 0.6, bloomRecover: 2.1, bloomScale: 1.2,
    boltKick: 0.74, headMult: 1.6, turnCap: 8,
    adsTime: 0.26, sprintToFire: 0.26, swapTime: 0.42, moveMult: 0.95, adsMoveMult: 0.5,
    pellets: 1, kickCam: 0.85, tracerWidth: 1.3,
  },

  // Slow, heavy, and the only sidearm that ends a fight with one round: a head inside about 14 m.
  revolver: {
    id: 'revolver', name: 'Verdict', role: 'Sidearm', auto: false, holdRpm: 0,
    damage: 62, rpm: 110, magazine: 6, reserve: 48, reload: 2.4, range: 46,
    falloff: { start: 14, end: 30, min: 0.55 },
    adsSpread: 0.006, hipSpread: 0.05, bloomPerShot: 0.7, bloomRecover: 2.2, bloomScale: 1,
    headMult: 1.7,
    adsTime: 0.14, sprintToFire: 0.1, swapTime: 0.2, moveMult: 1.06, adsMoveMult: 0.8,
    pellets: 1, unlimitedReserve: true, kickCam: 1, tracerWidth: 1.15,
  },

  // One rocket, then a very long wait. Detonates at the end of its ray; `damage` here is the blast's centre.
  launcher: {
    id: 'launcher', name: 'Breaker', role: 'Demolition', auto: false, holdRpm: 0,
    damage: 130, explosive: { radius: 4.4, damage: 130, inner: 1.1, min: 20 },
    rpm: 40, magazine: 1, reserve: 3, reload: 5, range: 46,
    falloff: { start: 99, end: 100, min: 1 },
    adsSpread: 0.008, hipSpread: 0.07, bloomPerShot: 0.8, bloomRecover: 1.2, bloomScale: 1,
    headMult: 1,
    adsTime: 0.32, sprintToFire: 0.42, swapTime: 0.62, moveMult: 0.9, adsMoveMult: 0.55,
    pellets: 1, kickCam: 1.4, tracerWidth: 2,
  },
};

// Damage of one pellet/bullet at `dist` metres. `ads` is whether the shot was fully aimed.
export function damageAt(w, dist, ads = true) {
  const f = w.falloff;
  let k = 1;
  if (dist > f.start) k = dist >= f.end ? f.min : 1 + (f.min - 1) * (dist - f.start) / (f.end - f.start);
  if (w.adsGate && !ads) k *= w.adsGate;
  return w.damage * k;
}

// A gun's real stats with a kit fitted. Memoised: an empty kit returns the plain def, equal kits the same object.
export function effectiveWeapon(weaponId, attachments) {
  const w = WEAPONS[weaponId];
  return w && applyAttachments(w, attachments);
}

export function headMultFor(weaponId) {
  const w = WEAPONS[weaponId];
  return w && w.headMult !== undefined ? w.headMult : DEFAULT_HEAD_MULT;
}

// Bullets (not pellets) needed to deal `hp` at `dist`, assuming every pellet lands.
export function shotsToKill(w, dist, hp = 100, ads = true, head = false) {
  return Math.ceil(hp / (damageAt(w, dist, ads) * (w.pellets || 1) * (head ? headMultFor(w.id) : 1)));
}
