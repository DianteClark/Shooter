// Weapons wave 4: six melee weapons (docs/WEAPONS-OVERHAUL.md "Wave 4: six melee weapons"). Same contract and plumbing
// as weapons-w3.js: weapons.js merges W4_WEAPONS into WEAPONS, constants.js appends W4_GUNS to every id list after the
// wave 3 guns (so every older id keeps its wire index), weapons-v10.js fillV10 also reads W4_LIKE. No imports.
//
// Every one is a sidearm-slot Melee weapon with its own swing (js/render/melee-anim.js), hit sound (js/audio/melee-sfx.js),
// finisher (js/shared/finishers.js, `weapon`), model (js/render/guns-w4.js) and icon (js/ui/icons-w4.js). Where each sits
// against the Gaff (2 quick lunging cuts), the Slugger (2 level swings) and the Maul (1 slow overhead):
//
//   Kagero     katana      thrust: the longest lunge in the game and a long blade. Two to kill, a beat slower than the Gaff.
//   Kindling   fire axe    overhead: one blow kills like the Maul, quicker to come again, but short and only a small step.
//   Spade      shovel      level: the longest reach of any melee and no lunge at all; two to kill, slow. Swings in place.
//   Gleaner    kama        double: each pull is two quick hooked cuts (a two-round burst); three cuts kill.
//   Bushwhack  machete     slash: two to kill at a hair under the Gaff's pace, a little more reach, a shorter lunge.
//   Nightstick tonfa       jab: the fastest swings there are, three to kill, a short step in each.
//
// Never in the bot rotations or the pool's picks (botpool.js LATER_GUNS keeps them out), so no bot's loadout moves.

export const W4_GUNS = {
  Melee: ['katana', 'fireaxe', 'shovel', 'kama', 'machete', 'tonfa'],
};

// What every one of them shares (the Slugger's melee block).
const MELEE = {
  auto: false, suppressed: true, melee: true, magazine: 1, reserve: 999, reload: 0.5,
  falloff: { start: 99, end: 100, min: 1 }, bloomPerShot: 0, bloomRecover: 3, bloomScale: 1,
  pellets: 1, slideFire: true, unlimitedReserve: true,
};

export const W4_WEAPONS = {
  // A long curved blade driven straight out from both hands: the thrust throws you further than any other swing, so
  // it closes a gap nothing else can. Two to kill, a little slower than the Gaff once you are there.
  katana: {
    ...MELEE, id: 'katana', name: 'Kagero', role: 'Katana', swing: 'thrust', lunge: 15,
    damage: 55, rpm: 125, range: 3.1, adsSpread: 0.02, hipSpread: 0.02, turnCap: 12,
    adsTime: 0.12, sprintToFire: 0.06, swapTime: 0.2, moveMult: 1.1, adsMoveMult: 0.96,
    kickCam: 0.5, tracerWidth: 0.6, longshot: 3,
    botUse: { pref: 1.4, hold: 0.3, flank: 1.6, advance: 3, rush: 2.8, fireMax: 3.4 },
    feel: { fx: { shape: 'none' }, voice: { pitch: 1.15 }, recoil: { back: -2.2, climb: 0.1, twist: 0.3 } },
  },

  // A firefighter's axe, pick on the back. Up and over like the Maul and one blow kills, but it comes again a third
  // sooner; the reach is short and the step in small, so you have to be on top of them already.
  fireaxe: {
    ...MELEE, id: 'fireaxe', name: 'Kindling', role: 'Fire axe', swing: 'overhead', lunge: 5,
    damage: 105, rpm: 70, range: 2.6, adsSpread: 0.03, hipSpread: 0.03, turnCap: 10,
    adsTime: 0.14, sprintToFire: 0.09, swapTime: 0.28, moveMult: 1.05, adsMoveMult: 0.92,
    kickCam: 1.1, tracerWidth: 0.85, longshot: 2.6,
    botUse: { pref: 1.2, hold: 0.3, flank: 1.6, advance: 3, rush: 2.4, fireMax: 2.9 },
    feel: { fx: { shape: 'none' }, voice: { pitch: 0.82 }, recoil: { back: -1.6, climb: -1.2, twist: 0.4 } },
  },

  // A trench shovel swung flat by the end of its long handle: reaches further than anything else you can swing, and
  // never moves you, so it holds a doorway. Two to kill and slow to come round again.
  shovel: {
    ...MELEE, id: 'shovel', name: 'Spade', role: 'Shovel', swing: 'level', lunge: 0,
    damage: 68, rpm: 88, range: 3.3, adsSpread: 0.025, hipSpread: 0.025, turnCap: 11,
    adsTime: 0.13, sprintToFire: 0.08, swapTime: 0.26, moveMult: 1.05, adsMoveMult: 0.94,
    kickCam: 0.9, tracerWidth: 0.8, longshot: 3.2,
    botUse: { pref: 1.5, hold: 0.4, flank: 1.4, advance: 3, rush: 2.9, fireMax: 3.6 },
    feel: { fx: { shape: 'none' }, voice: { pitch: 0.92 }, recoil: { back: -1.2, climb: -0.2, twist: 2.2 } },
  },

  // A hooked harvest blade. Each pull is two quick cuts, forehand then back (a two-round burst); the third cut kills,
  // so it is the second pull that finishes. Short, light and quick on your feet.
  kama: {
    ...MELEE, id: 'kama', name: 'Gleaner', role: 'Sickle', swing: 'double', lunge: 8, burst: { count: 2, gap: 0.12 },
    damage: 36, rpm: 160, range: 2.45, adsSpread: 0.02, hipSpread: 0.02, turnCap: 13,
    adsTime: 0.1, sprintToFire: 0.05, swapTime: 0.14, moveMult: 1.12, adsMoveMult: 1,
    kickCam: 0.32, tracerWidth: 0.5, longshot: 2.4,
    botUse: { pref: 1.1, hold: 0.3, flank: 1.7, advance: 3, rush: 2.3, fireMax: 2.8 },
    feel: { fx: { shape: 'none' }, voice: { pitch: 1.3 }, recoil: { back: -1, climb: -0.4, twist: 1.6 } },
  },

  // A long brush machete. Wide cuts from side to side like the Gaff, a little more reach, a shorter lunge and a hair
  // slower: the blade for players who would rather not be thrown into the room.
  machete: {
    ...MELEE, id: 'machete', name: 'Bushwhack', role: 'Machete', swing: 'slash', lunge: 9,
    damage: 52, rpm: 172, range: 2.85, adsSpread: 0.02, hipSpread: 0.02, turnCap: 13,
    adsTime: 0.1, sprintToFire: 0.05, swapTime: 0.15, moveMult: 1.11, adsMoveMult: 1,
    kickCam: 0.4, tracerWidth: 0.6, longshot: 2.8,
    botUse: { pref: 1.2, hold: 0.3, flank: 1.6, advance: 3, rush: 2.5, fireMax: 3.1 },
    feel: { fx: { shape: 'none' }, voice: { pitch: 1.1 }, recoil: { back: -1.6, climb: -0.7, twist: 1.5 } },
  },

  // A pair of side-handled batons, the long arm along the forearm. Short spinning jabs, the quickest swings there are,
  // a small step in each; three to kill. Only the Gaff is quicker on foot.
  tonfa: {
    ...MELEE, id: 'tonfa', name: 'Nightstick', role: 'Tonfa', swing: 'jab', lunge: 7,
    damage: 36, rpm: 265, range: 2.5, adsSpread: 0.02, hipSpread: 0.02, turnCap: 14,
    adsTime: 0.1, sprintToFire: 0.04, swapTime: 0.12, moveMult: 1.13, adsMoveMult: 1,
    kickCam: 0.28, tracerWidth: 0.5, longshot: 2.4,
    botUse: { pref: 1.1, hold: 0.3, flank: 1.7, advance: 3, rush: 2.3, fireMax: 2.8 },
    feel: { fx: { shape: 'none' }, voice: { pitch: 1.2 }, recoil: { back: -1.8, climb: 0, twist: 0.8 } },
  },
};

// Player levels (js/shared/progression.js UNLOCK_SCHEDULE): on levels no gun opened yet, the last ones near the cap.
export const W4_UNLOCKS = [[31, 'machete'], [34, 'kama'], [35, 'shovel'], [38, 'tonfa'], [42, 'fireaxe'], [45, 'katana']]
  .map(([level, id]) => ({ level, kind: 'weapon', id }));

// The older weapon whose carry, reload (none: a blade has no rounds) and death throw each borrows (weapons-v10.js fillV10).
const like = (base, over = {}) => ({ sound: base, fx: base, reload: base, hold: base, force: base, ...over });
export const W4_LIKE = {
  katana: like('knife', { hold: 'shotgun', force: 'coach' }),
  fireaxe: like('maul'),
  shovel: like('maul', { force: 'bat' }),
  kama: like('knife'),
  machete: like('knife', { force: 'shotgun' }),
  tonfa: like('knife'),
};

// Graveyard Shift (js/shared/zombies.js): melee weapons the mystery crate can hand out.
export const W4_BOX = ['katana', 'fireaxe', 'machete'];
