// Weapons wave 3 (docs/WEAPONS-OVERHAUL.md "Wave 3"): three guns for the gaps the roster still had. Same contract as
// weapons.js and the same plumbing as weapons-v10.js: weapons.js merges W3_WEAPONS into WEAPONS, constants.js appends
// W3_GUNS to every id list after the V10 guns (so every older id keeps its wire index), weapons-v10.js fillV10 also
// reads W3_LIKE. No imports: constants.js imports this.
//
//   Clatter  (SMG)      the class had no burst gun: three-round bursts that keep four-to-kill out to 17 m, where
//                       every other SMG is spent, paid for by the slowest kill up close.
//   Bullhead (Shotgun)  a heavy ten-gauge pump: the longest one-shot reach of any pellet gun, four shells and the
//                       slowest pump in the class. The ambusher's shotgun, not the runner's.
//   Gavel    (Pistol)   a battle pistol: three to the body out to 22 m at twice the Verdict's pace, the quickest
//                       sidearm kill past 18 m; slower than the Flicker and heavier to draw, and the Verdict still
//                       wins a room.
//
// Each carries its own `feel` (js/render/feel.js): flash shape and size, voice pitch and weight, recoil.

export const W3_GUNS = {
  SMG: ['burstsmg'],
  Shotgun: ['heavyshot'],
  Pistol: ['battlepistol'],
};

export const W3_WEAPONS = {
  // Three rounds a pull, a hair apart and committed, then a beat. Two bursts kill to 17 m; the burst itself barely
  // moves, so a careful player lands all three past the range every other SMG has given up. Up close a full-auto SMG
  // is already done by the time the second burst leaves.
  burstsmg: {
    id: 'burstsmg', name: 'Clatter', role: 'Burst SMG', auto: true,
    damage: 27, rpm: 650, burst: { count: 3, gap: 0.045 }, magazine: 30, reserve: 180, reload: 1.9, range: 36,
    falloff: { start: 17, end: 28, min: 0.62 },
    adsSpread: 0.007, hipSpread: 0.04, bloomPerShot: 0.05, bloomRecover: 3.4, bloomScale: 1.2,
    pattern: { amp: 0.005, freq: 1.1, ramp: 1 },
    adsTime: 0.15, sprintToFire: 0.1, swapTime: 0.28, moveMult: 1.05, adsMoveMult: 0.76,
    pellets: 1, slideFire: true, kickCam: 0.38, tracerWidth: 0.8, longshot: 19,
    botUse: { pref: 11, hold: 0.8, flank: 1.2, advance: 3, rush: 20 },
    feel: {
      fx: { shape: 'cross', flash: [1.2, 0.9, 1.1] },
      voice: { pitch: 1.12 },
      foley: { kind: 'mag', pitch: 1.2, mass: 0.5 },
      recoil: { back: 0.85, climb: 0.7, twist: 0.4 },
    },
  },

  // A ten-gauge pump. Nine heavy pellets in a tight fan: one shell kills out to 12 m, past where any other pellet gun
  // can, and it goes through a crate. Then the pump: two thirds of a second, four in the tube, a slow hand on each.
  heavyshot: {
    id: 'heavyshot', name: 'Bullhead', role: 'Ten-gauge', auto: false,
    damage: 23, rpm: 95, magazine: 4, reserve: 32, reload: 0.5, range: 19,
    falloff: { start: 12.5, end: 17, min: 0.3 }, penetrate: 0.45,
    adsSpread: 0.03, hipSpread: 0.056, bloomPerShot: 0.2, bloomRecover: 1.5, bloomScale: 0.45, turnCap: 6.5,
    adsTime: 0.19, sprintToFire: 0.13, swapTime: 0.46, moveMult: 1.05, adsMoveMult: 0.66,
    pellets: 9, shellReload: true, kickCam: 1.25, tracerWidth: 0.6, longshot: 12,
    botUse: { pref: 6, hold: 0.6, flank: 1.4, advance: 3, rush: 12, fireMax: 15, precise: true },
    feel: {
      fx: { shape: 'fan', flash: [2.9, 0.95, 2.3], light: 1.9 },
      voice: { pitch: 0.82, len: 1.2 },
      foley: { kind: 'tube', pitch: 0.78, mass: 1, rack: 0.26 },
      recoil: { back: 2.2, climb: 1.9, twist: 0.15 },
    },
  },

  // A full-size battle pistol. Three to the body out to 22 m at twice the Verdict's pace, straight down the sights:
  // the quickest sidearm kill across a lane. In a room the Verdict's two shots and the Flicker's pace beat it.
  battlepistol: {
    id: 'battlepistol', name: 'Gavel', role: 'Battle pistol', auto: false,
    damage: 40, rpm: 270, magazine: 9, reserve: 72, reload: 1.7, range: 38,
    falloff: { start: 22, end: 34, min: 0.75 },
    adsSpread: 0.005, hipSpread: 0.034, bloomPerShot: 0.24, bloomRecover: 3, bloomScale: 1.1,
    adsTime: 0.14, sprintToFire: 0.11, swapTime: 0.26, moveMult: 1.06, adsMoveMult: 0.82,
    pellets: 1, unlimitedReserve: true, kickCam: 0.62, tracerWidth: 0.95, longshot: 22,
    botUse: { pref: 13, hold: 1, flank: 0.9, advance: 3, precise: true },
    feel: {
      fx: { shape: 'star', flash: [1.5, 1.1, 1.0] },
      voice: { pitch: 0.86, len: 1.15 },
      foley: { kind: 'slide', pitch: 1.05, mass: 0.5, rack: 0.22 },
      recoil: { back: 0.7, climb: 2.7, twist: 0.25 },
    },
  },
};

// Player levels (js/shared/progression.js UNLOCK_SCHEDULE): on levels no gun opened yet.
export const W3_UNLOCKS = [[25, 'burstsmg'], [27, 'battlepistol'], [29, 'heavyshot']]
  .map(([level, id]) => ({ level, kind: 'weapon', id }));

// The older gun whose hand-made reload, carry and death throw each new gun borrows (weapons-v10.js fillV10).
const like = (base, over = {}) => ({ sound: base, fx: base, reload: base, hold: base, force: base, ...over });
export const W3_LIKE = {
  burstsmg: like('tacsmg'),
  heavyshot: like('shotgun', { force: 'coach' }),
  battlepistol: like('pistol', { force: 'revolver' }),
};

// Bot rotations (sim.js BOT_PRIMARIES, bots.js BOT_SECONDARIES), appended after the V10 ones.
export const W3_BOT_PRIMARIES = ['burstsmg', 'heavyshot'];
export const W3_BOT_SECONDARIES = ['battlepistol'];

// Bot kits (js/sim/bots.js BOT_KITS): three each, so battle royale floor loot (deals 0, 2, 4) reaches every one.
export const W3_BOT_KITS = {
  burstsmg: [
    { optic: 'reflex', barrel: 'longbarrel', mag: 'extmag', grip: 'angled' },
    { optic: 'holo', barrel: 'compensator', mag: 'speedmag', grip: 'vertical' },
    { optic: 'laserbox', barrel: 'flashhider', mag: 'subsonic', grip: 'handstop' },
  ],
  heavyshot: [
    { barrel: 'choke', optic: 'reflex', mag: 'extmag', grip: 'angled' },
    { barrel: 'ventrib', optic: 'ghostring', mag: 'flitewad', grip: 'wrap' },
    { optic: 'laserbox', barrel: 'breacher', mag: 'speedmag', grip: 'handstop' },
  ],
  battlepistol: [
    { optic: 'reflex', barrel: 'longbarrel', mag: 'extmag', grip: 'knurl' },
    { barrel: 'flashhider', optic: 'irons', mag: 'speedmag', grip: 'thumbrest' },
    { optic: 'laserbox', barrel: 'ported', mag: 'subsonic', grip: 'beavertail' },
  ],
};
