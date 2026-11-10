// Weapon definitions. Numbers are tuned against a 100 HP player: see `shotsToKill` / `damageAt`.
// Units: metres, seconds, radians (half-angle spread). Every gun sits in one `category` (constants.js).
//
// Common stats (contract):
//   damage, rpm, magazine, reserve, reload, range, adsSpread, hipSpread, bloomPerShot, bloomRecover,
//   adsTime, sprintToFire, moveMult, adsMoveMult, pellets, falloff {start,end,min}, kickCam, tracerWidth, auto.
//   range is the HARD maximum: a ray simply ends there, whatever it would have hit. Damage is falloff.min from
//   falloff.end out to range.
//   rpm is the only cadence. Holding the trigger fires every gun at its rpm; `auto` only says whether a frame may
//   catch up with more than one round (and labels the gun for the UI).
//
// What makes each gun play differently lives in the optional fields below, all read by stepPlayer:
//   swapTime        seconds to bring the gun up (the pistol's whole point)
//   bloomScale      how far full bloom widens the cone (1 + bloom * bloomScale)
//   pattern         {amp, freq, ramp, drift?}: learnable side-to-side recoil by shot index, radians. drift is a
//                   one-sided pull added per shot (up to 12 of them), which is what makes a gun buck off target
//   burst           {count, gap}: the trigger fires `count` rounds `gap` seconds apart, committed once started.
//                   rpm is then the gun's true cadence: the recovery after a burst is whatever makes it come out right
//   spinup          {shots, from}: fire rate ramps from `from` x rpm to full over `shots`
//   heat            {rounds, coolDelay, coolTime, lockout, loosenFrom}: rounds to full bar, idle seconds before
//                   cooling, seconds full to empty, lockout at full, bar fraction past which accuracy loosens
//   headMult        damage multiplier for a head hit. Derived at the bottom of this file: any head hit kills.
//   turnCap         max rad/s of aim rotation while aiming or firing; absent = uncapped
//   shellReload     reload is one round at a time, and firing interrupts it
//   slideFire       no spread penalty while sliding
//   adsGate         damage multiplier applied unless fully aimed (sniper hipfire)
//   boltKick        adsT is knocked back to this after a shot (bolt cycle costs you the scope)
//   unlimitedReserve reloading never drains reserve, so nobody is ever left unarmed
//   explosive       {radius, damage, inner, min}: the host detonates this shot at the end of its ray (see Sim);
//                   full damage inside inner, linear to min at the edge. Stopped by solid walls, flies over
//                   waist-high cover. No self damage. Headshots do not apply.
//   penetrate       damage kept per piece of waist-high cover a round passes through (0..1). Absent: the round is a
//                   light round and cover stops it. Solid walls stop everything.
//   longshot        metres at which a kill with this gun counts as a longshot
//   botUse          compact hint for bots: {pref, hold, flank, advance, rush?, scoped?, fireMax?, adsMin?, precise?}.
//                   pref/hold/flank/advance/rush mean what they do in bots.js STYLE; scoped: always aims in;
//                   fireMax: do not fire beyond this; adsMin: do not fire below this adsT at range; precise: a one- or
//                   two-shot gun, so only pull the trigger with the sights on the body (bots.js _trigger).
//
// Wave 6 balance pass: numbers below were tuned from mirrored bot matches (equal carriers per gun, every map, mode
// and tier) to keep each gun within its category's median kills per carrier-minute; see the Stats screen for live data.
//
// Attachments (js/shared/attachments.js) produce an effective def with these same fields; see effectiveWeapon.

import { applyAttachments } from './attachments.js';
import { MAX_HP, WEAPON_CATEGORY } from './constants.js';

// A ray passing this close to a target's centre is a head hit. Top-down, so the head is the bullseye.
// Shrunk from 0.2 for Wave 5: with lethal heads, 0.2 let 35-50% of ordinary hits kill outright. 0.1 is about one hit
// in five at a thumb-stick aim error of 1.8 degrees.
export const HEAD_RADIUS = 0.1;
export const MAX_COVER_PIECES = 2;    // A round gives out after this many pieces of waist-high cover.

export const WEAPONS = {
  // ---------------- Assault ----------------
  // All-rounder. Wins at mid range; the recoil curve rewards players who learn it.
  ar: {
    id: 'ar', name: 'Halyard', role: 'All-rounder', auto: true,
    damage: 28, rpm: 700, magazine: 30, reserve: 150, reload: 2.05, range: 48,
    falloff: { start: 18, end: 32, min: 0.68 }, penetrate: 0.7,
    adsSpread: 0.006, hipSpread: 0.052, bloomPerShot: 0.09, bloomRecover: 2.4, bloomScale: 1.5,
    pattern: { amp: 0.012, freq: 0.62, ramp: 5 }, turnCap: 15,
    adsTime: 0.2, sprintToFire: 0.17, swapTime: 0.34, moveMult: 1, adsMoveMult: 0.55,
    pellets: 1, kickCam: 0.5, tracerWidth: 1, longshot: 26,
    botUse: { pref: 15, hold: 1, flank: 1, advance: 3 },
  },

  // Three rounds per pull, committed once started. Two clean bursts to the body, one if it finds the head; it pays
  // for accuracy and loses to anything that spots it first up close.
  burst: {
    id: 'burst', name: 'Cadence', role: 'Pacer', auto: true,
    damage: 29, rpm: 500, burst: { count: 3, gap: 0.07 }, magazine: 27, reserve: 135, reload: 2.1, range: 50,
    falloff: { start: 22, end: 36, min: 0.7 }, penetrate: 0.7,
    adsSpread: 0.004, hipSpread: 0.05, bloomPerShot: 0.07, bloomRecover: 2.6, bloomScale: 1.4,
    pattern: { amp: 0.008, freq: 1, ramp: 1 }, turnCap: 14,
    adsTime: 0.22, sprintToFire: 0.2, swapTime: 0.36, moveMult: 0.98, adsMoveMult: 0.55,
    pellets: 1, kickCam: 0.55, tracerWidth: 1.05, longshot: 27,
    botUse: { pref: 17, hold: 1.1, flank: 0.9, advance: 3 },
  },

  // Three to the body at a walking pace of fire, and every round drags the muzzle right. Hold it down or lose it.
  heavyar: {
    id: 'heavyar', name: 'Drayman', role: 'Heavy hitter', auto: true,
    damage: 36, rpm: 480, magazine: 25, reserve: 125, reload: 2.5, range: 50,
    falloff: { start: 20, end: 34, min: 0.72 }, penetrate: 0.8,
    adsSpread: 0.0055, hipSpread: 0.07, bloomPerShot: 0.13, bloomRecover: 2, bloomScale: 1.5,
    pattern: { amp: 0.009, freq: 0.5, ramp: 3, drift: 0.0026 }, turnCap: 11,
    adsTime: 0.27, sprintToFire: 0.24, swapTime: 0.42, moveMult: 0.95, adsMoveMult: 0.5,
    pellets: 1, kickCam: 0.85, tracerWidth: 1.25, longshot: 28,
    botUse: { pref: 17, hold: 1.2, flank: 0.8, advance: 2 },
  },

  // ---------------- SMG ----------------
  // Fire from the hip, on the move, out of a slide. Falls apart past its range.
  smg: {
    id: 'smg', name: 'Skitter', role: 'Rush', auto: true,
    damage: 22, rpm: 950, magazine: 32, reserve: 192, reload: 1.75, range: 28,
    falloff: { start: 8, end: 16, min: 0.5 },
    adsSpread: 0.018, hipSpread: 0.036, bloomPerShot: 0.05, bloomRecover: 3.2, bloomScale: 1.3,
    pattern: { amp: 0.009, freq: 1.3, ramp: 3 },
    adsTime: 0.13, sprintToFire: 0.09, swapTime: 0.26, moveMult: 1.07, adsMoveMult: 0.8,
    pellets: 1, slideFire: true, kickCam: 0.32, tracerWidth: 0.75, longshot: 16,
    botUse: { pref: 7, hold: 0.55, flank: 1.3, advance: 3, rush: 15 },
  },

  // The fastest kill in the game inside a room, and a fight with the muzzle everywhere else.
  pdw: {
    id: 'pdw', name: 'Rasp', role: 'Knife fight', auto: true,
    damage: 20, rpm: 1200, magazine: 28, reserve: 168, reload: 1.6, range: 22,
    falloff: { start: 6, end: 13, min: 0.45 },
    adsSpread: 0.024, hipSpread: 0.042, bloomPerShot: 0.07, bloomRecover: 3, bloomScale: 1.6,
    pattern: { amp: 0.028, freq: 1.75, ramp: 2, drift: 0.0028 },
    adsTime: 0.12, sprintToFire: 0.08, swapTime: 0.24, moveMult: 1.08, adsMoveMult: 0.82,
    pellets: 1, slideFire: true, kickCam: 0.6, tracerWidth: 0.7, longshot: 13,
    botUse: { pref: 6, hold: 0.4, flank: 1.4, advance: 3, rush: 13 },
  },

  // The SMG you aim. A laser down the sights with barely any bloom, useless from the hip.
  tacsmg: {
    id: 'tacsmg', name: 'Stitch', role: 'Precision', auto: true,
    damage: 24, rpm: 780, magazine: 30, reserve: 180, reload: 1.9, range: 34,
    falloff: { start: 12, end: 22, min: 0.6 },
    adsSpread: 0.009, hipSpread: 0.072, bloomPerShot: 0.04, bloomRecover: 3.4, bloomScale: 1.2,
    pattern: { amp: 0.006, freq: 0.9, ramp: 4 },
    adsTime: 0.18, sprintToFire: 0.14, swapTime: 0.3, moveMult: 1.02, adsMoveMult: 0.74,
    pellets: 1, kickCam: 0.36, tracerWidth: 0.8, longshot: 20,
    botUse: { pref: 11, hold: 0.8, flank: 1.1, advance: 3, rush: 20, scoped: true },
  },

  // ---------------- Shotgun ----------------
  // A fan of pellets: one pump up close, two a little further. Loads shell by shell, fire to interrupt.
  shotgun: {
    id: 'shotgun', name: 'Thresher', role: 'Breach', auto: false,
    damage: 18, rpm: 150, magazine: 7, reserve: 42, reload: 0.42, range: 15,
    falloff: { start: 5, end: 10, min: 0.3 },
    adsSpread: 0.05, hipSpread: 0.088, bloomPerShot: 0.15, bloomRecover: 1.6, bloomScale: 0.45, turnCap: 7,
    adsTime: 0.17, sprintToFire: 0.14, swapTime: 0.42, moveMult: 1.02, adsMoveMult: 0.68,
    pellets: 8, shellReload: true, kickCam: 1, tracerWidth: 0.55, longshot: 10,
    botUse: { pref: 4, hold: 0.5, flank: 1.5, advance: 3, rush: 9, fireMax: 12 },
  },

  // Two shells at arm's length and nothing much past a doorway. Drum fed: one long reload, no shell-by-shell.
  autoshot: {
    id: 'autoshot', name: 'Squall', role: 'Doorway', auto: true,
    damage: 14, rpm: 300, magazine: 14, reserve: 56, reload: 3, range: 12,
    falloff: { start: 4, end: 8, min: 0.3 },
    adsSpread: 0.07, hipSpread: 0.115, bloomPerShot: 0.12, bloomRecover: 1.8, bloomScale: 0.5,
    pattern: { amp: 0.02, freq: 1.1, ramp: 3 }, turnCap: 6.5,
    adsTime: 0.2, sprintToFire: 0.17, swapTime: 0.46, moveMult: 0.97, adsMoveMult: 0.62,
    pellets: 7, kickCam: 0.95, tracerWidth: 0.5, longshot: 8,
    botUse: { pref: 4, hold: 0.5, flank: 1.5, advance: 3, rush: 8, fireMax: 10 },
  },

  // Both barrels, quickly, then a full break-open reload. Two chances to end a fight and no third.
  coach: {
    id: 'coach', name: 'Doublet', role: 'Ambush', auto: false,
    damage: 14, rpm: 280, magazine: 2, reserve: 30, reload: 2.1, range: 14,
    falloff: { start: 5, end: 9, min: 0.35 },
    adsSpread: 0.04, hipSpread: 0.075, bloomPerShot: 0.1, bloomRecover: 2.2, bloomScale: 0.4, turnCap: 8,
    adsTime: 0.15, sprintToFire: 0.1, swapTime: 0.36, moveMult: 1.05, adsMoveMult: 0.75,
    pellets: 10, kickCam: 1.15, tracerWidth: 0.55, longshot: 9,
    botUse: { pref: 4, hold: 0.45, flank: 1.6, advance: 3, rush: 8, fireMax: 11 },
  },

  // ---------------- LMG ----------------
  // Slow to get going, then a wall of fire until the barrel gives out. Swings like a gate: guard an angle.
  lmg: {
    id: 'lmg', name: 'Bulwark', role: 'Suppress', auto: true,
    damage: 32, rpm: 720, magazine: 100, reserve: 200, reload: 4.5, range: 52,
    falloff: { start: 22, end: 38, min: 0.72 }, penetrate: 0.75,
    adsSpread: 0.012, hipSpread: 0.095, bloomPerShot: 0, bloomRecover: 1.5, bloomScale: 1.7,
    spinup: { shots: 9, from: 0.68 },
    heat: { rounds: 40, coolDelay: 0.4, coolTime: 2.5, lockout: 2.2, loosenFrom: 0.75 }, turnCap: 2.4,
    pattern: { amp: 0.014, freq: 0.34, ramp: 8 },
    adsTime: 0.36, sprintToFire: 0.34, swapTime: 0.62, moveMult: 0.86, adsMoveMult: 0.42,
    pellets: 1, kickCam: 0.72, tracerWidth: 1.25, longshot: 28,
    botUse: { pref: 20, hold: 1.6, flank: 0.5, advance: 2, scoped: true },
  },

  // The LMG that can walk. No spin-up and a lighter swing, paid for with damage and a much shorter belt of heat.
  saw: {
    id: 'saw', name: 'Drover', role: 'Mobile support', auto: true,
    damage: 25, rpm: 700, magazine: 60, reserve: 180, reload: 3.2, range: 42,
    falloff: { start: 14, end: 26, min: 0.66 }, penetrate: 0.65,
    adsSpread: 0.015, hipSpread: 0.075, bloomPerShot: 0, bloomRecover: 1.8, bloomScale: 1.5,
    heat: { rounds: 21, coolDelay: 0.3, coolTime: 1.7, lockout: 1.7, loosenFrom: 0.7 }, turnCap: 5,
    pattern: { amp: 0.016, freq: 0.75, ramp: 4 },
    adsTime: 0.3, sprintToFire: 0.24, swapTime: 0.48, moveMult: 0.95, adsMoveMult: 0.55,
    pellets: 1, kickCam: 0.55, tracerWidth: 1.05, longshot: 24,
    botUse: { pref: 14, hold: 1.1, flank: 0.9, advance: 3, scoped: true },
  },

  // Rotary. A second to wind up, then the highest rate in the game and a turning circle like a freight car.
  rotary: {
    id: 'rotary', name: 'Millrace', role: 'Area denial', auto: true,
    damage: 20, rpm: 1300, magazine: 150, reserve: 300, reload: 5, range: 38,
    falloff: { start: 14, end: 26, min: 0.55 }, penetrate: 0.6,
    adsSpread: 0.03, hipSpread: 0.11, bloomPerShot: 0, bloomRecover: 1.5, bloomScale: 1.3,
    spinup: { shots: 12, from: 0.55 },
    heat: { rounds: 90, coolDelay: 0.5, coolTime: 3, lockout: 2.6, loosenFrom: 0.8 }, turnCap: 2,
    pattern: { amp: 0.018, freq: 2.4, ramp: 6 },
    adsTime: 0.45, sprintToFire: 0.46, swapTime: 0.78, moveMult: 0.78, adsMoveMult: 0.42,
    pellets: 1, kickCam: 0.6, tracerWidth: 1.1, longshot: 22,
    botUse: { pref: 13, hold: 1.8, flank: 0.3, advance: 2, scoped: true },
  },

  // ---------------- Marksman ----------------
  // Two to the body through mid range, and it flinches the scope a little each time, so measured beats frantic.
  dmr: {
    id: 'dmr', name: 'Tallyman', role: 'Marksman', auto: false,
    damage: 52, rpm: 200, magazine: 12, reserve: 72, reload: 2.5, range: 58,
    falloff: { start: 26, end: 42, min: 0.68 }, penetrate: 0.8,
    adsSpread: 0.0025, hipSpread: 0.09, bloomPerShot: 0.6, bloomRecover: 2.1, bloomScale: 1.2,
    boltKick: 0.78, turnCap: 8,
    adsTime: 0.26, sprintToFire: 0.26, swapTime: 0.42, moveMult: 0.95, adsMoveMult: 0.5,
    pellets: 1, kickCam: 0.85, tracerWidth: 1.3, longshot: 30,
    botUse: { pref: 24, hold: 1.7, flank: 0.5, advance: 2, scoped: true, adsMin: 0.7, precise: true },
  },

  // A fast semi with a big magazine. Three to the body, no flinch: it keeps a target pinned rather than deleting it.
  battle: {
    id: 'battle', name: 'Foreman', role: 'Pressure', auto: false,
    damage: 39, rpm: 310, magazine: 20, reserve: 100, reload: 2.3, range: 52,
    falloff: { start: 22, end: 36, min: 0.7 }, penetrate: 0.75,
    adsSpread: 0.004, hipSpread: 0.075, bloomPerShot: 0.26, bloomRecover: 2.6, bloomScale: 1.3,
    pattern: { amp: 0.006, freq: 0.8, ramp: 2, drift: 0.0012 }, turnCap: 10,
    adsTime: 0.24, sprintToFire: 0.22, swapTime: 0.38, moveMult: 0.97, adsMoveMult: 0.55,
    pellets: 1, kickCam: 0.7, tracerWidth: 1.2, longshot: 27,
    botUse: { pref: 20, hold: 1.3, flank: 0.7, advance: 2, scoped: true },
  },

  // Lever gun. Two to the body, carried at the hip and on the move, one round at a time back into the tube.
  lever: {
    id: 'lever', name: 'Prospector', role: 'Skirmisher', auto: false,
    damage: 68, rpm: 120, magazine: 6, reserve: 42, reload: 0.46, range: 46,
    falloff: { start: 18, end: 32, min: 0.6 }, penetrate: 0.7,
    adsSpread: 0.004, hipSpread: 0.032, bloomPerShot: 0.55, bloomRecover: 2.8, bloomScale: 1.1, turnCap: 13,
    adsTime: 0.2, sprintToFire: 0.14, swapTime: 0.32, moveMult: 1.01, adsMoveMult: 0.72,
    pellets: 1, shellReload: true, slideFire: true, kickCam: 0.95, tracerWidth: 1.25, longshot: 26,
    botUse: { pref: 14, hold: 0.9, flank: 1.1, advance: 3, precise: true },
  },

  // ---------------- Sniper ----------------
  // Fully aimed it erases anyone in range; from the hip it is a bad pistol. The bolt throws you off the scope.
  sniper: {
    id: 'sniper', name: 'Lancet', role: 'Overwatch', auto: false,
    damage: 125, rpm: 46, magazine: 5, reserve: 30, reload: 3.1, range: 78,
    falloff: { start: 46, end: 62, min: 0.7 }, penetrate: 0.85,
    adsSpread: 0.0015, hipSpread: 0.2, bloomPerShot: 0.6, bloomRecover: 1.0, bloomScale: 1,
    adsGate: 0.42, boltKick: 0.45, turnCap: 4.5,
    adsTime: 0.4, sprintToFire: 0.4, swapTime: 0.6, moveMult: 0.9, adsMoveMult: 0.38,
    pellets: 1, kickCam: 1.2, tracerWidth: 1.6, longshot: 34,
    botUse: { pref: 30, hold: 2.2, flank: 0.3, advance: 2, scoped: true, adsMin: 0.85, precise: true },
  },

  // Anti-materiel. One body shot anywhere it reaches and through cover almost untouched. A very long time to aim,
  // four rounds, and you carry it like a railway sleeper.
  antimat: {
    id: 'antimat', name: 'Monolith', role: 'Siege', auto: false,
    damage: 175, rpm: 30, magazine: 4, reserve: 20, reload: 4.2, range: 88,
    falloff: { start: 60, end: 80, min: 0.8 }, penetrate: 0.95,
    adsSpread: 0.0012, hipSpread: 0.24, bloomPerShot: 0.8, bloomRecover: 0.8, bloomScale: 1,
    adsGate: 0.4, boltKick: 0.3, turnCap: 3.1,
    adsTime: 0.52, sprintToFire: 0.55, swapTime: 0.8, moveMult: 0.82, adsMoveMult: 0.34,
    pellets: 1, kickCam: 1.7, tracerWidth: 2, longshot: 38,
    botUse: { pref: 32, hold: 2.5, flank: 0.2, advance: 2, scoped: true, adsMin: 0.85, precise: true },
  },

  // A carbine-weight bolt gun for people who keep moving. One body shot inside a room, two beyond it, scoped in a blink.
  semisnipe: {
    id: 'semisnipe', name: 'Kestrel', role: 'Quickscope', auto: false,
    damage: 104, rpm: 62, magazine: 6, reserve: 36, reload: 2.5, range: 58,
    falloff: { start: 16, end: 28, min: 0.6 }, penetrate: 0.8,
    adsSpread: 0.002, hipSpread: 0.14, bloomPerShot: 0.55, bloomRecover: 1.5, bloomScale: 1,
    adsGate: 0.55, boltKick: 0.3, turnCap: 7,
    adsTime: 0.23, sprintToFire: 0.26, swapTime: 0.44, moveMult: 0.98, adsMoveMult: 0.6,
    pellets: 1, kickCam: 1, tracerWidth: 1.4, longshot: 28,
    botUse: { pref: 16, hold: 1.2, flank: 0.9, advance: 3, scoped: true, adsMin: 0.85, precise: true },
  },

  // ---------------- Pistol ----------------
  // Out in a blink, moves at full speed.
  pistol: {
    id: 'pistol', name: 'Flicker', role: 'Sidearm', auto: false,
    damage: 38, rpm: 400, magazine: 12, reserve: 96, reload: 1.25, range: 30,
    falloff: { start: 10, end: 20, min: 0.6 },
    adsSpread: 0.012, hipSpread: 0.03, bloomPerShot: 0.13, bloomRecover: 3.5, bloomScale: 1.1,
    adsTime: 0.1, sprintToFire: 0.06, swapTime: 0.15, moveMult: 1.1, adsMoveMult: 0.9,
    pellets: 1, slideFire: true, unlimitedReserve: true, kickCam: 0.4, tracerWidth: 0.8, longshot: 18,
    botUse: { pref: 9, hold: 0.8, flank: 1, advance: 3 },
  },

  // Slow, heavy, two to the body close in. Every shot lands with weight and costs a beat.
  revolver: {
    id: 'revolver', name: 'Verdict', role: 'Hand cannon', auto: false,
    damage: 62, rpm: 125, magazine: 6, reserve: 48, reload: 2.4, range: 34,
    falloff: { start: 12, end: 22, min: 0.55 },
    adsSpread: 0.006, hipSpread: 0.042, bloomPerShot: 0.7, bloomRecover: 2.2, bloomScale: 1,
    adsTime: 0.14, sprintToFire: 0.1, swapTime: 0.2, moveMult: 1.06, adsMoveMult: 0.8,
    pellets: 1, unlimitedReserve: true, kickCam: 1, tracerWidth: 1.15, longshot: 18,
    botUse: { pref: 10, hold: 0.9, flank: 1, advance: 3 },
  },

  // A pocket hose. Empties in a second and a half, climbs away from you, and saves your life at three metres.
  machpistol: {
    id: 'machpistol', name: 'Gnat', role: 'Panic button', auto: true,
    damage: 16, rpm: 960, magazine: 20, reserve: 160, reload: 1.35, range: 22,
    falloff: { start: 6, end: 13, min: 0.5 },
    adsSpread: 0.03, hipSpread: 0.04, bloomPerShot: 0.08, bloomRecover: 3, bloomScale: 1.5,
    pattern: { amp: 0.03, freq: 1.5, ramp: 2, drift: 0.0035 },
    adsTime: 0.1, sprintToFire: 0.06, swapTime: 0.14, moveMult: 1.1, adsMoveMult: 0.92,
    pellets: 1, slideFire: true, unlimitedReserve: true, kickCam: 0.45, tracerWidth: 0.65, longshot: 12,
    botUse: { pref: 6, hold: 0.5, flank: 1.3, advance: 3, rush: 13 },
  },

  // Two rounds per pull, on the same cadence every time. Rewards tapping the pair onto the target.
  deuce: {
    id: 'deuce', name: 'Deuce', role: 'Double tap', auto: true,
    damage: 31, rpm: 420, burst: { count: 2, gap: 0.075 }, magazine: 14, reserve: 112, reload: 1.45, range: 32,
    falloff: { start: 12, end: 22, min: 0.6 },
    adsSpread: 0.01, hipSpread: 0.036, bloomPerShot: 0.12, bloomRecover: 3.2, bloomScale: 1.2,
    pattern: { amp: 0.01, freq: 1, ramp: 1 },
    adsTime: 0.12, sprintToFire: 0.08, swapTime: 0.18, moveMult: 1.08, adsMoveMult: 0.86,
    pellets: 1, unlimitedReserve: true, kickCam: 0.55, tracerWidth: 0.85, longshot: 19,
    botUse: { pref: 10, hold: 0.8, flank: 1, advance: 3 },
  },

  // ---------------- Launcher ----------------
  // One rocket, then a very long wait. Detonates at the end of its ray; `damage` here is the blast's centre.
  launcher: {
    id: 'launcher', name: 'Breaker', role: 'Demolition', auto: false,
    damage: 130, explosive: { radius: 4.4, damage: 130, inner: 1.1, min: 20 },
    rpm: 40, magazine: 1, reserve: 3, reload: 5, range: 40,
    falloff: { start: 99, end: 100, min: 1 },
    adsSpread: 0.008, hipSpread: 0.07, bloomPerShot: 0.8, bloomRecover: 1.2, bloomScale: 1,
    adsTime: 0.32, sprintToFire: 0.42, swapTime: 0.62, moveMult: 0.9, adsMoveMult: 0.55,
    pellets: 1, kickCam: 1.4, tracerWidth: 2, longshot: 20,
    botUse: { pref: 16, hold: 1, flank: 0.6, advance: 2 },
  },

  // Four small bombs in quick order. Nowhere near a rocket per hit, but it clears a lane or a doorway.
  thumper: {
    id: 'thumper', name: 'Bombard', role: 'Area denial', auto: false,
    damage: 84, explosive: { radius: 3.2, damage: 84, inner: 1.1, min: 18 },
    rpm: 100, magazine: 4, reserve: 8, reload: 3.9, range: 30,
    falloff: { start: 99, end: 100, min: 1 },
    adsSpread: 0.012, hipSpread: 0.075, bloomPerShot: 0.5, bloomRecover: 1.6, bloomScale: 1,
    adsTime: 0.26, sprintToFire: 0.34, swapTime: 0.5, moveMult: 0.94, adsMoveMult: 0.6,
    pellets: 1, kickCam: 1, tracerWidth: 1.6, longshot: 16,
    botUse: { pref: 13, hold: 1, flank: 0.6, advance: 2 },
  },

  // ---------------- The Golden Gun ----------------
  // The reward for maxing everything (js/shared/progression.js goldenStatus). One round, and that round kills anyone
  // it touches inside its range: no falloff, no head needed. What keeps it fair is everything around the shot: one
  // round per magazine and a long reload, a range a little past the other sidearms, a wide hip cone so it is an
  // aimed gun, a light round that cover stops like any pistol's, and no attachments (attachments.js). Never on bots.
  golden: {
    id: 'golden', name: 'Golden Gun', role: 'One round, one kill', auto: false, golden: true,
    damage: 200, rpm: 60, magazine: 1, reserve: 12, reload: 3.2, range: 36,
    falloff: { start: 99, end: 100, min: 1 },
    adsSpread: 0.004, hipSpread: 0.06, bloomPerShot: 1, bloomRecover: 1.6, bloomScale: 1,
    adsTime: 0.2, sprintToFire: 0.14, swapTime: 0.32, moveMult: 1.04, adsMoveMult: 0.8,
    pellets: 1, unlimitedReserve: true, kickCam: 1.3, tracerWidth: 1.5, longshot: 24,
    botUse: { pref: 12, hold: 1, flank: 0.8, advance: 2, precise: true },
  },
};

// Any head hit kills, at any range, from the hip, through cover. Rather than a magic number per gun, the multiplier
// is derived from each gun's weakest possible round (full falloff, un-aimed, through the most cover). The 1.25
// margin is headroom for perks that reduce damage. Explosives stay at 1: splash is not a headshot.
const HEAD_LETHAL_HP = MAX_HP * 1.25;
for (const id in WEAPONS) {
  const w = WEAPONS[id];
  w.category = WEAPON_CATEGORY[id];
  if (w.explosive) { w.headMult = 1; continue; }
  const pen = w.penetrate ? w.penetrate ** MAX_COVER_PIECES : 1;
  // Never below 1: a gun that already kills to the body (the Golden Gun) must not do less to the head.
  w.headMult = Math.max(1, Math.ceil(10 * HEAD_LETHAL_HP / (w.damage * w.falloff.min * (w.adsGate || 1) * pen)) / 10);
}

// Damage of one pellet/bullet at `dist` metres. `ads` is whether the shot was fully aimed.
export function damageAt(w, dist, ads = true) {
  const f = w.falloff;
  let k = 1;
  if (dist > f.start) k = dist >= f.end ? f.min : 1 + (f.min - 1) * (dist - f.start) / (f.end - f.start);
  if (w.adsGate && !ads) k *= w.adsGate;
  return w.damage * k;
}

// Damage of one traced ray that hit a player. The whole rule in one place: falloff, head and cover.
export function rayDamage(w, ray, dist, ads = true) {
  return damageAt(w, dist, ads) * (ray.head ? headMultFor(w.id) : 1) * (ray.pen ?? 1);
}

// A gun's real stats with a kit fitted. Memoised: an empty kit returns the plain def, equal kits the same object.
export function effectiveWeapon(weaponId, attachments) {
  const w = WEAPONS[weaponId];
  return w && applyAttachments(w, attachments);
}

export function headMultFor(weaponId) {
  const w = WEAPONS[weaponId];
  return w ? w.headMult : 1;
}

// Rounds needed to deal `hp` at `dist`, assuming every pellet lands. A head hit is always 1, except on explosives.
export function shotsToKill(w, dist, hp = 100, ads = true, head = false) {
  return Math.ceil(hp / (damageAt(w, dist, ads) * (w.pellets || 1) * (head ? headMultFor(w.id) : 1)));
}

// The numbers the Gunsmith shows: full damage to falloff.start, down to falloff.min at falloff.end, nothing past range.
export function rangeBands(w) {
  return { full: w.falloff.start, fade: w.falloff.end, max: w.range, minDamage: w.damage * w.falloff.min };
}
