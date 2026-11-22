// Weapons wave 5 (docs/WEAPONS-OVERHAUL.md "Wave 5"): five guns for the gaps the roster still had, and the first
// mechanics the arsenal had to grow since the charge shot: a burn and a lock-on. Same contract as weapons.js and the
// same plumbing as weapons-w3.js: weapons.js merges W5_WEAPONS into WEAPONS, constants.js appends W5_GUNS to every id
// list after wave 4 (so every older id keeps its wire index), weapons-v10.js fillV10 also reads W5_LIKE. No imports:
// constants.js imports this.
//
//   Gadfly    (SMG)       the SMG you never aim: the tightest hip cone of any automatic and a sight that adds almost
//                         nothing, slow to come up. The Stitch's opposite.
//   Carousel  (LMG)       pan-fed and heavy: three to the body out to 16 m with no wind-up and no heat bar, at a pace
//                         well under every belt gun's, and a pan that is slower to change than the Gantry's box.
//   Vigil     (Sniper)    a semi-automatic sniper: two to the body anywhere it reaches, seven in the magazine, the
//                         scope flinching on every round. The sniper that stays in a fight, never the one-shot.
//   Fusee     (Pistol)    a railway flare pistol: one slow, bright round that sets its target burning (`burn`) and
//                         lights them up on your team's map while they burn. Never a kill on its own at full health.
//   Skyhook   (Launcher)  a lock-on launcher (`lockon`): fully aimed at an enemy aircraft inside its cone it cannot
//                         miss it; at people it is a small rocket. The counter to the sky.
//
// New fields (read by js/sim/arsenal-w5.js; any gun may carry them, attachments do not touch them):
//   burn:   { dps, time, mark }   a hit sets the target burning for `time` s at `dps` (Tac Mask halves it); `mark` puts
//                                 them on the shooter's team map while they burn (Blank Slate keeps them off it).
//   lockon: { cone, range, air }  a fully aimed shot with an enemy aircraft within `cone` radians of the aim and `range`
//                                 metres homes on it for `air` damage instead of bursting on the ground.

export const W5_GUNS = {
  SMG: ['hipsmg'],
  LMG: ['panlmg'],
  Sniper: ['autosniper'],
  Pistol: ['flare'],
  Launcher: ['lockon'],
};

export const W5_WEAPONS = {
  // Nine hundred rounds a minute from a cone tighter than any other automatic's hip, and a sight that tightens it
  // only a little more for a long wait: aiming it is wasted time. Five to the body inside 9 m; spent past 18.
  hipsmg: {
    id: 'hipsmg', name: 'Gadfly', role: 'Hip-fire', auto: true,
    damage: 22, rpm: 900, magazine: 40, reserve: 200, reload: 1.95, range: 26,
    falloff: { start: 9, end: 18, min: 0.52 },
    adsSpread: 0.017, hipSpread: 0.021, bloomPerShot: 0.045, bloomRecover: 3.4, bloomScale: 1.15,
    pattern: { amp: 0.008, freq: 1.4, ramp: 3 },
    adsTime: 0.21, sprintToFire: 0.07, swapTime: 0.25, moveMult: 1.08, adsMoveMult: 0.7,
    pellets: 1, slideFire: true, kickCam: 0.3, tracerWidth: 0.7, longshot: 14,
    botUse: { pref: 7, hold: 0.5, flank: 1.4, advance: 3, rush: 13 },
    feel: {
      fx: { shape: 'cross', flash: [1.0, 0.85, 1.05] },
      voice: { pitch: 1.2 },
      foley: { kind: 'mag', pitch: 1.25, mass: 0.45 },
      recoil: { back: 0.7, climb: 0.45, twist: 0.55 },
    },
  },

  // A flat pan of 47 on top, turning a notch a round. No wind-up, no heat bar: three heavy rounds kill out to 16 m
  // from the first trigger pull, at a pace a belt gun would laugh at. Then a slow change of the pan.
  panlmg: {
    id: 'panlmg', name: 'Carousel', role: 'Pan-fed', auto: true,
    damage: 35, rpm: 430, magazine: 47, reserve: 141, reload: 4.4, range: 52,
    falloff: { start: 16, end: 32, min: 0.72 }, penetrate: 0.75,
    adsSpread: 0.008, hipSpread: 0.08, bloomPerShot: 0.07, bloomRecover: 1.8, bloomScale: 1.4,
    pattern: { amp: 0.015, freq: 0.45, ramp: 3 }, turnCap: 5,
    adsTime: 0.32, sprintToFire: 0.3, swapTime: 0.55, moveMult: 0.9, adsMoveMult: 0.48,
    pellets: 1, kickCam: 0.95, tracerWidth: 1.3, longshot: 28,
    botUse: { pref: 17, hold: 1.4, flank: 0.6, advance: 2, scoped: true },
    feel: {
      fx: { shape: 'star', flash: [1.7, 1.2, 1.25], light: 1.3, every: 3 },
      voice: { pitch: 0.8, len: 1.2 },
      foley: { kind: 'belt', pitch: 0.85, mass: 1 },
      recoil: { back: 1.5, climb: 1.4, twist: 0.2 },
    },
  },

  // Semi-automatic: two to the body anywhere it reaches, as fast as the scope comes back down, seven in the box.
  // Never a body one-shot, and every round throws the scope up: the follow-up is the skill.
  autosniper: {
    id: 'autosniper', name: 'Vigil', role: 'Semi-auto', auto: false,
    damage: 68, rpm: 160, magazine: 7, reserve: 35, reload: 2.8, range: 66,
    falloff: { start: 38, end: 56, min: 0.8 }, penetrate: 0.7,
    adsSpread: 0.0022, hipSpread: 0.16, bloomPerShot: 0.7, bloomRecover: 1.4, bloomScale: 1,
    adsGate: 0.6, boltKick: 0.5, turnCap: 5,
    adsTime: 0.36, sprintToFire: 0.32, swapTime: 0.5, moveMult: 0.91, adsMoveMult: 0.42,
    pellets: 1, kickCam: 1.05, tracerWidth: 1.4, longshot: 32,
    botUse: { pref: 26, hold: 2, flank: 0.4, advance: 2, scoped: true, adsMin: 0.8, precise: true, sight: 3 },
    feel: {
      fx: { shape: 'star', flash: [1.9, 1.3, 1.2], light: 1.4 },
      voice: { pitch: 0.92, len: 1.1 },
      foley: { kind: 'mag', pitch: 0.9, mass: 0.8, rack: 0.2 },
      recoil: { back: 1.6, climb: 2.1, twist: 0.15 },
    },
  },

  // A brass railway flare pistol. One fat, slow, blinding round: what it hits burns for three seconds and shows on
  // your team's map until it stops. Never a kill on its own, not even to the head: the burn and the round after it are.
  flare: {
    id: 'flare', name: 'Fusee', role: 'Flare gun', auto: false,
    damage: 40, rpm: 70, magazine: 1, reserve: 14, reload: 1.5, range: 32,
    falloff: { start: 14, end: 26, min: 0.6 },
    burn: { dps: 16, time: 3, mark: true },
    headMax: 1.5,     // Not even a head hit is a kill on its own: the burn and a second round finish it.
    adsSpread: 0.008, hipSpread: 0.03, bloomPerShot: 0.5, bloomRecover: 2, bloomScale: 1,
    adsTime: 0.14, sprintToFire: 0.1, swapTime: 0.22, moveMult: 1.06, adsMoveMult: 0.82,
    pellets: 1, kickCam: 0.85, tracerWidth: 2.2, longshot: 18,
    botUse: { pref: 12, hold: 0.9, flank: 1, advance: 3 },
    feel: {
      fx: { shape: 'star', flash: [2.2, 1.0, 1.6], light: 2.6, tail: 2.6, linger: 0.32, speed: 48 },
      voice: { pitch: 0.7, len: 1.3 },
      foley: { kind: 'break', pitch: 1.0, mass: 0.6 },
      recoil: { back: 0.9, climb: 2.4, twist: 0.3 },
    },
  },

  // Two tubes on a shoulder frame with a seeker head. Fully aimed at an enemy aircraft anywhere in its cone, the
  // rocket climbs to it and cannot miss: two bring down an Attack Chopper or a VTOL. At people it is a small rocket
  // that will not kill a healthy one on its own.
  lockon: {
    id: 'lockon', name: 'Skyhook', role: 'Lock-on', auto: false,
    damage: 90, explosive: { radius: 2.6, damage: 90, inner: 0.8, min: 15 },
    lockon: { cone: 0.42, range: 55, air: 650 },
    rpm: 60, magazine: 2, reserve: 4, reload: 3.8, range: 46,
    falloff: { start: 99, end: 100, min: 1 },
    adsSpread: 0.01, hipSpread: 0.07, bloomPerShot: 0.6, bloomRecover: 1.3, bloomScale: 1,
    adsTime: 0.42, sprintToFire: 0.4, swapTime: 0.58, moveMult: 0.92, adsMoveMult: 0.6,
    pellets: 1, kickCam: 1.2, tracerWidth: 1.8, longshot: 20,
    botUse: { pref: 16, hold: 1, flank: 0.6, advance: 2 },
    feel: {
      fx: { flash: [1.6, 1.4, 1.2] },
      voice: { pitch: 1.1 },
      recoil: { back: 1.2, climb: 0.9, twist: 0.1 },
    },
  },
};

// Player levels (js/shared/progression.js UNLOCK_SCHEDULE): on levels no gun opened yet.
export const W5_UNLOCKS = [[37, 'hipsmg'], [39, 'flare'], [41, 'panlmg'], [43, 'lockon'], [44, 'autosniper']]
  .map(([level, id]) => ({ level, kind: 'weapon', id }));

// The older gun whose hand-made reload, carry and death throw each new gun borrows (weapons-v10.js fillV10).
const like = (base, over = {}) => ({ sound: base, fx: base, reload: base, hold: base, force: base, ...over });
export const W5_LIKE = {
  hipsmg: like('smg'),
  panlmg: like('lmg', { reload: 'lightlmg' }),
  autosniper: like('sniper', { reload: 'dmr' }),
  flare: like('pistol', { reload: 'scatter', force: 'revolver' }),
  lockon: like('launcher'),
};

// Attachments a gun cannot take although its class can (attachments.js folds this into V10_DENY's pass).
export const W5_DENY = {
  panlmg: ['heatsink', 'shroud'],     // No heat bar to help.
  flare: ['suppressor', 'extmag', 'drummag', 'tapedmag'],   // One round in a break-open barrel; a flare is the opposite of quiet.
};

// Bot rotations (sim.js BOT_PRIMARIES, bots.js BOT_SECONDARIES), appended after wave 3's.
export const W5_BOT_PRIMARIES = ['hipsmg', 'panlmg', 'autosniper'];
export const W5_BOT_SECONDARIES = ['flare', 'lockon'];

// Bot kits (js/sim/bots.js BOT_KITS): three each, so battle royale floor loot (deals 0, 2, 4) reaches every one.
export const W5_BOT_KITS = {
  hipsmg: [
    { optic: 'pointdot', barrel: 'compensator', mag: 'extmag', grip: 'wrap' },
    { optic: 'laserbox', barrel: 'flashhider', mag: 'speedmag', grip: 'handstop' },
    { optic: 'holo', barrel: 'longbarrel', mag: 'subsonic', grip: 'angled' },
  ],
  panlmg: [
    { optic: 'reflex', barrel: 'heavybarrel', mag: 'speedmag', grip: 'vertical' },
    { optic: 'prism', barrel: 'compensator', mag: 'extmag', grip: 'bipod' },
    { optic: 'holo', barrel: 'longbarrel', mag: 'lightmag', grip: 'brace' },
  ],
  autosniper: [
    { optic: 'steady', barrel: 'fluted', mag: 'extmag', grip: 'bipod' },
    { optic: 'snapsight', barrel: 'muzzlebrake', mag: 'speedmag', grip: 'thumbrest' },
    { optic: 'hunter', barrel: 'suppressor', mag: 'lightmag', grip: 'angled' },
  ],
  flare: [
    { optic: 'reflex', barrel: 'longbarrel', mag: 'speedmag', grip: 'knurl' },
    { optic: 'irons', barrel: 'ported', mag: 'subsonic', grip: 'beavertail' },
    { optic: 'laserbox', barrel: 'flashhider', mag: 'speedmag', grip: 'thumbrest' },
  ],
  lockon: [
    { optic: 'rangefinder', barrel: 'guiderail', mag: 'lightrocket' },
    { optic: 'reflex', barrel: 'venturi', grip: 'thumbrest' },
    { optic: 'laserbox', mag: 'warhead', grip: 'rubber' },
  ],
};
