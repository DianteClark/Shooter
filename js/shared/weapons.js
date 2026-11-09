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
//   pattern         {amp, freq, ramp}: learnable side-to-side recoil, degrees-free radians, by shot index
//   spinup          {shots, from}: fire rate ramps from `from` x rpm to full over `shots`
//   settle          {after, recover}: past `after` shots bloom falls instead of rising
//   shellReload     reload is one round at a time, and firing interrupts it
//   slideFire       no spread penalty while sliding
//   adsGate         damage multiplier applied unless fully aimed (sniper hipfire)
//   boltKick        adsT is knocked back to this after a shot (bolt cycle costs you the scope)
//   unlimitedReserve reloading never drains reserve, so nobody is ever left unarmed

export const WEAPONS = {
  // All-rounder. Wins at mid range; the recoil curve rewards players who learn it.
  ar: {
    id: 'ar', name: 'Halyard', role: 'Assault', auto: true,
    damage: 28, rpm: 700, magazine: 30, reserve: 150, reload: 2.05, range: 60,
    falloff: { start: 26, end: 44, min: 0.68 },
    adsSpread: 0.006, hipSpread: 0.052, bloomPerShot: 0.09, bloomRecover: 2.4, bloomScale: 1.5,
    pattern: { amp: 0.012, freq: 0.62, ramp: 5 },
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
    adsTime: 0.13, sprintToFire: 0.09, swapTime: 0.26, moveMult: 1.07, adsMoveMult: 0.8,
    pellets: 1, slideFire: true, kickCam: 0.32, tracerWidth: 0.75,
  },

  // A fan of pellets: one pump up close, two a little further. Loads shell by shell, fire to interrupt.
  shotgun: {
    id: 'shotgun', name: 'Thresher', role: 'Breach', auto: false, holdRpm: 140,
    damage: 15, rpm: 150, magazine: 7, reserve: 42, reload: 0.42, range: 24,
    falloff: { start: 7, end: 16, min: 0.3 },
    adsSpread: 0.055, hipSpread: 0.1, bloomPerShot: 0.15, bloomRecover: 1.6, bloomScale: 0.45,
    adsTime: 0.17, sprintToFire: 0.14, swapTime: 0.42, moveMult: 1.02, adsMoveMult: 0.68,
    pellets: 8, shellReload: true, kickCam: 1, tracerWidth: 0.55,
  },

  // Slow to get going, then a wall of fire. Spins up and steadies the longer you hold the trigger.
  lmg: {
    id: 'lmg', name: 'Bulwark', role: 'Suppress', auto: true,
    damage: 32, rpm: 720, magazine: 100, reserve: 200, reload: 5.2, range: 64,
    falloff: { start: 30, end: 50, min: 0.72 },
    adsSpread: 0.012, hipSpread: 0.095, bloomPerShot: 0.11, bloomRecover: 1.5, bloomScale: 1.2,
    spinup: { shots: 9, from: 0.68 }, settle: { after: 8, recover: 0.07 },
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
    adsGate: 0.42, boltKick: 0.45,
    adsTime: 0.4, sprintToFire: 0.4, swapTime: 0.6, moveMult: 0.9, adsMoveMult: 0.38,
    pellets: 1, kickCam: 1.2, tracerWidth: 1.6,
  },

  // Out in a blink, moves at full speed. Tap faster than it fires when held.
  pistol: {
    id: 'pistol', name: 'Flicker', role: 'Sidearm', auto: false, holdRpm: 330,
    damage: 36, rpm: 430, magazine: 12, reserve: 96, reload: 1.25, range: 42,
    falloff: { start: 15, end: 30, min: 0.6 },
    adsSpread: 0.012, hipSpread: 0.03, bloomPerShot: 0.13, bloomRecover: 3.5, bloomScale: 1.1,
    adsTime: 0.1, sprintToFire: 0.06, swapTime: 0.15, moveMult: 1.1, adsMoveMult: 0.9,
    pellets: 1, slideFire: true, unlimitedReserve: true, kickCam: 0.4, tracerWidth: 0.8,
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

// Bullets (not pellets) needed to deal `hp` at `dist`, assuming every pellet lands.
export function shotsToKill(w, dist, hp = 100, ads = true) {
  return Math.ceil(hp / (damageAt(w, dist, ads) * (w.pellets || 1)));
}
