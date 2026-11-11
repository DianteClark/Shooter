// V10 arsenal: sixteen guns added in one wave, kept in their own file so the older table in weapons.js can be
// rebalanced without touching them. weapons.js merges V10_WEAPONS into WEAPONS; constants.js reads V10_GUNS for the
// category and id lists; everything else that keeps a per-gun table reads V10_LIKE so a new gun borrows an existing
// gun's sound, reload animation, tracer and carry until it gets its own. No imports: constants.js imports this.
//
// Stats follow the contract at the top of weapons.js. Three small mechanics are new in this wave (js/sim/player.js):
//   settle   {shots, from}: the cone starts `from` times wider and tightens to its rated spread over `shots` rounds of
//            sustained fire (by shotIndex, so letting go of the trigger loses it). The opposite of bloom.
//   charge   {time}: the trigger has to be held this long before the round leaves, and it then leaves on its own.
//            Letting go bleeds the charge away. The charge is shown on the heat bar (ps.heat), so the gun must not
//            also have `heat`, and belongs in the primary slot.
//   melee    true: the swing spends no ammunition. `lunge` (m/s) throws the player forward along the aim on each swing;
//            ordinary braking takes it off again within about a metre and a half.

// Category -> ids, in display order. Melee is a new secondary-slot category (constants.js CATEGORIES).
export const V10_GUNS = {
  Assault: ['rampar', 'heatar'],
  SMG: ['hushsmg', 'drumsmg'],
  Shotgun: ['magshot', 'flechette'],
  LMG: ['beltlmg'],
  Marksman: ['twinshot', 'hushdmr'],
  Sniper: ['scout', 'rail'],
  Pistol: ['akimbo', 'nailer'],
  Launcher: ['salvo'],
  Melee: ['knife', 'maul'],
};

export const V10_WEAPONS = {
  // ---------------- Assault ----------------
  // Starts at a walking pace and winds up to the fastest rifle in the game. Wins the long exchange, loses the snap one:
  // the first three rounds leave slower than any other rifle's.
  rampar: {
    id: 'rampar', name: 'Flywheel', role: 'Wind-up', auto: true,
    damage: 25, rpm: 900, spinup: { shots: 10, from: 0.55 }, magazine: 36, reserve: 144, reload: 2.3, range: 46,
    falloff: { start: 16, end: 30, min: 0.66 }, penetrate: 0.65,
    adsSpread: 0.007, hipSpread: 0.056, bloomPerShot: 0.06, bloomRecover: 2.4, bloomScale: 1.5,
    pattern: { amp: 0.015, freq: 0.7, ramp: 8 }, turnCap: 14,
    adsTime: 0.21, sprintToFire: 0.18, swapTime: 0.36, moveMult: 0.99, adsMoveMult: 0.55,
    pellets: 1, kickCam: 0.45, tracerWidth: 0.95, longshot: 25,
    botUse: { pref: 14, hold: 1.1, flank: 1, advance: 3 },
  },

  // A rifle you never stop to reload: a 75-round casket and no bloom at all, governed by a heat bar instead. Short
  // strings stay laser straight; hold it down and it locks up in the open.
  heatar: {
    id: 'heatar', name: 'Kiln', role: 'Heat rifle', auto: true,
    damage: 27, rpm: 605, magazine: 75, reserve: 150, reload: 3.4, range: 46,
    falloff: { start: 18, end: 32, min: 0.68 }, penetrate: 0.7,
    adsSpread: 0.0075, hipSpread: 0.06, bloomPerShot: 0, bloomRecover: 2, bloomScale: 1.6,
    heat: { rounds: 17, coolDelay: 0.3, coolTime: 1.5, lockout: 1.8, loosenFrom: 0.6 },
    pattern: { amp: 0.01, freq: 0.6, ramp: 5 }, turnCap: 12,
    adsTime: 0.23, sprintToFire: 0.2, swapTime: 0.4, moveMult: 0.97, adsMoveMult: 0.52,
    pellets: 1, kickCam: 0.5, tracerWidth: 1.05, longshot: 26,
    botUse: { pref: 16, hold: 1.2, flank: 0.9, advance: 3 },
  },

  // ---------------- SMG ----------------
  // Suppressed from the factory: never on the minimap and hard to hear, with none of the Hush Can's handling cost.
  // It pays in reach instead, the shortest of the SMGs.
  hushsmg: {
    id: 'hushsmg', name: 'Murmur', role: 'Ghost', auto: true, suppressed: true,
    damage: 24, rpm: 900, magazine: 30, reserve: 180, reload: 1.8, range: 24,
    falloff: { start: 9, end: 16, min: 0.5 },
    adsSpread: 0.016, hipSpread: 0.032, bloomPerShot: 0.05, bloomRecover: 3.2, bloomScale: 1.3,
    pattern: { amp: 0.008, freq: 1.1, ramp: 3 },
    adsTime: 0.14, sprintToFire: 0.08, swapTime: 0.27, moveMult: 1.06, adsMoveMult: 0.8,
    pellets: 1, slideFire: true, kickCam: 0.26, tracerWidth: 0.6, longshot: 14,
    botUse: { pref: 7, hold: 0.5, flank: 1.5, advance: 3, rush: 14 },
  },

  // A 64-round pan on top: the only SMG that can take a room without reloading, and the worst one to be caught
  // changing drums with. Heavy for its class and loose from the hip.
  drumsmg: {
    id: 'drumsmg', name: 'Hopper', role: 'High capacity', auto: true,
    damage: 24, rpm: 920, magazine: 64, reserve: 192, reload: 2.8, range: 27,
    falloff: { start: 11, end: 18, min: 0.55 },
    adsSpread: 0.02, hipSpread: 0.036, bloomPerShot: 0.035, bloomRecover: 2.8, bloomScale: 1.4,
    pattern: { amp: 0.013, freq: 1.2, ramp: 6 },
    adsTime: 0.15, sprintToFire: 0.11, swapTime: 0.34, moveMult: 1.03, adsMoveMult: 0.72,
    pellets: 1, kickCam: 0.34, tracerWidth: 0.75, longshot: 15,
    botUse: { pref: 7, hold: 0.7, flank: 1.2, advance: 3, rush: 15 },
  },

  // ---------------- Shotgun ----------------
  // Box-fed semi-auto: six shells as fast as the trigger goes and then one magazine change instead of six thumbed
  // shells. Lighter pattern than the Thresher, so it wants two at anything past arm's length.
  magshot: {
    id: 'magshot', name: 'Trammel', role: 'Mag-fed', auto: false,
    damage: 20, rpm: 230, magazine: 8, reserve: 42, reload: 1.7, range: 14,
    falloff: { start: 7.5, end: 11, min: 0.3 },
    adsSpread: 0.045, hipSpread: 0.078, bloomPerShot: 0.14, bloomRecover: 1.8, bloomScale: 0.45, turnCap: 8,
    adsTime: 0.17, sprintToFire: 0.12, swapTime: 0.4, moveMult: 1.08, adsMoveMult: 0.7,
    pellets: 8, kickCam: 0.9, tracerWidth: 0.5, longshot: 9,
    botUse: { pref: 4, hold: 0.5, flank: 1.5, advance: 3, rush: 9, fireMax: 11, precise: true },
  },

  // Five steel darts in a fan a third the width of buckshot. No one-shot anywhere, but two aimed shells kill out to
  // twenty metres, where every other shotgun is spent, and the darts go through a crate.
  flechette: {
    id: 'flechette', name: 'Thistle', role: 'Flechette', auto: false,
    damage: 19, rpm: 140, magazine: 5, reserve: 40, reload: 0.5, range: 30,
    falloff: { start: 13, end: 24, min: 0.6 }, penetrate: 0.6,
    adsSpread: 0.013, hipSpread: 0.045, bloomPerShot: 0.3, bloomRecover: 2, bloomScale: 0.6, turnCap: 9,
    adsTime: 0.21, sprintToFire: 0.16, swapTime: 0.42, moveMult: 1.03, adsMoveMult: 0.66,
    pellets: 5, shellReload: true, kickCam: 0.95, tracerWidth: 0.45, longshot: 17,
    botUse: { pref: 11, hold: 0.8, flank: 1.2, advance: 3, rush: 20, scoped: true, fireMax: 24, precise: true },
  },

  // ---------------- LMG ----------------
  // Belt-fed and bedded in by its own recoil: the first rounds go wide and every one after lands closer, until by
  // the fifteenth it is the tightest automatic in the game. No heat bar. Let go and it has to settle again.
  beltlmg: {
    id: 'beltlmg', name: 'Stanchion', role: 'Settles in', auto: true,
    damage: 29, rpm: 650, magazine: 90, reserve: 180, reload: 4.3, range: 52,
    falloff: { start: 22, end: 38, min: 0.72 }, penetrate: 0.75,
    adsSpread: 0.005, hipSpread: 0.08, bloomPerShot: 0, bloomRecover: 1.5, bloomScale: 1.5,
    settle: { shots: 15, from: 4.5 },
    pattern: { amp: 0.008, freq: 0.4, ramp: 6 }, turnCap: 3.6,
    adsTime: 0.34, sprintToFire: 0.32, swapTime: 0.58, moveMult: 0.88, adsMoveMult: 0.44,
    pellets: 1, kickCam: 0.62, tracerWidth: 1.2, longshot: 28,
    botUse: { pref: 20, hold: 1.7, flank: 0.4, advance: 2, scoped: true },
  },

  // ---------------- Marksman ----------------
  // Two rounds per pull, a hair apart and committed. A pair and one more kills; a pair that finds the head is
  // over at once. Miss the first pair and the gap before the next is the longest of the semi rifles.
  twinshot: {
    id: 'twinshot', name: 'Tandem', role: 'Paired shots', auto: true,
    damage: 42, rpm: 290, burst: { count: 2, gap: 0.085 }, magazine: 16, reserve: 96, reload: 2.4, range: 54,
    falloff: { start: 25, end: 38, min: 0.75 }, penetrate: 0.75,
    adsSpread: 0.0035, hipSpread: 0.08, bloomPerShot: 0.18, bloomRecover: 2.4, bloomScale: 1.3,
    pattern: { amp: 0.009, freq: 1.2, ramp: 1 }, turnCap: 9,
    adsTime: 0.25, sprintToFire: 0.24, swapTime: 0.4, moveMult: 0.96, adsMoveMult: 0.52,
    pellets: 1, kickCam: 0.75, tracerWidth: 1.2, longshot: 28,
    botUse: { pref: 21, hold: 1.4, flank: 0.7, advance: 2, scoped: true, adsMin: 0.6 },
  },

  // A short suppressed rifle: two quiet rounds kill inside a room, three past it, and nobody's minimap ever shows
  // where they came from. Handles like a carbine and fades like one.
  hushdmr: {
    id: 'hushdmr', name: 'Nightjar', role: 'Quiet rifle', auto: false, suppressed: true,
    damage: 52, rpm: 255, magazine: 10, reserve: 70, reload: 2.2, range: 44,
    falloff: { start: 14, end: 28, min: 0.72 }, penetrate: 0.6,
    adsSpread: 0.0035, hipSpread: 0.07, bloomPerShot: 0.4, bloomRecover: 2.4, bloomScale: 1.2, turnCap: 11,
    adsTime: 0.21, sprintToFire: 0.19, swapTime: 0.36, moveMult: 1.0, adsMoveMult: 0.6,
    pellets: 1, kickCam: 0.55, tracerWidth: 0.85, longshot: 24,
    botUse: { pref: 17, hold: 1.2, flank: 1.1, advance: 3, scoped: true, adsMin: 0.6, precise: true },
  },

  // ---------------- Sniper ----------------
  // A straight-pull scout rifle that never leaves the scope: no one-shot to the body anywhere, but the second round
  // is there before a bolt gun has finished cycling, at any range it reaches.
  scout: {
    id: 'scout', name: 'Harrier', role: 'Straight-pull', auto: false,
    damage: 92, rpm: 130, magazine: 7, reserve: 42, reload: 2.6, range: 68,
    falloff: { start: 36, end: 52, min: 0.72 }, penetrate: 0.8,
    adsSpread: 0.002, hipSpread: 0.15, bloomPerShot: 0.4, bloomRecover: 1.8, bloomScale: 1,
    adsGate: 0.55, turnCap: 6.5,
    adsTime: 0.21, sprintToFire: 0.28, swapTime: 0.46, moveMult: 0.97, adsMoveMult: 0.55,
    pellets: 1, kickCam: 0.9, tracerWidth: 1.4, longshot: 30,
    botUse: { pref: 24, hold: 1.7, flank: 0.6, advance: 2, scoped: true, adsMin: 0.85, precise: true, sight: 4 },
  },

  // A coil rifle. Hold the trigger for six tenths of a second and the slug leaves on its own, through cover almost
  // untouched, killing anyone it reaches. No bolt to work, but the charge has to be held on target and starts over
  // if you let go.
  rail: {
    id: 'rail', name: 'Lodestone', role: 'Charge shot', auto: false,
    damage: 150, rpm: 70, charge: { time: 0.3 }, magazine: 4, reserve: 20, reload: 2.8, range: 82,
    falloff: { start: 55, end: 75, min: 0.8 }, penetrate: 0.95,
    adsSpread: 0.0012, hipSpread: 0.18, bloomPerShot: 0.7, bloomRecover: 1, bloomScale: 1,
    adsGate: 0.42, turnCap: 3.8,
    adsTime: 0.32, sprintToFire: 0.42, swapTime: 0.66, moveMult: 0.88, adsMoveMult: 0.36,
    pellets: 1, kickCam: 1.5, tracerWidth: 1.8, longshot: 36,
    botUse: { pref: 30, hold: 2.3, flank: 0.3, advance: 2, scoped: true, adsMin: 0.85, precise: true, sight: 6 },
  },

  // ---------------- Pistol ----------------
  // One in each hand. Twice the fire of any sidearm and no sights at all: aiming barely tightens them, and the pair
  // kick left and right in turn.
  akimbo: {
    id: 'akimbo', name: 'Magpies', role: 'Akimbo', auto: true,
    damage: 23, rpm: 640, magazine: 24, reserve: 144, reload: 2.3, range: 24,
    falloff: { start: 7, end: 15, min: 0.55 },
    adsSpread: 0.034, hipSpread: 0.042, bloomPerShot: 0.07, bloomRecover: 3, bloomScale: 1.3,
    pattern: { amp: 0.022, freq: 1.5708, ramp: 1 },
    adsTime: 0.1, sprintToFire: 0.07, swapTime: 0.24, moveMult: 1.08, adsMoveMult: 0.95,
    pellets: 1, slideFire: true, unlimitedReserve: true, kickCam: 0.5, tracerWidth: 0.75, longshot: 13,
    botUse: { pref: 6, hold: 0.5, flank: 1.3, advance: 3, rush: 13 },
  },

  // A framing nailer. Slow, light nails, but they go where the muzzle points without aiming and they are the only
  // sidearm rounds that pass through a crate.
  nailer: {
    id: 'nailer', name: 'Tacker', role: 'Nail gun', auto: true,
    damage: 18, rpm: 500, magazine: 32, reserve: 160, reload: 1.9, range: 26,
    falloff: { start: 10, end: 20, min: 0.6 }, penetrate: 0.6,
    adsSpread: 0.014, hipSpread: 0.02, bloomPerShot: 0.03, bloomRecover: 3.4, bloomScale: 1.1,
    adsTime: 0.12, sprintToFire: 0.08, swapTime: 0.2, moveMult: 1.07, adsMoveMult: 0.9,
    pellets: 1, unlimitedReserve: true, kickCam: 0.22, tracerWidth: 0.5, longshot: 17,
    botUse: { pref: 9, hold: 0.8, flank: 1, advance: 3 },
  },

  // ---------------- Launcher ----------------
  // A three-tube pod: one pull sends all three small rockets a beat apart, and the cone spreads them on purpose.
  // Sweeps a doorway or a lane; no single blast kills a healthy player.
  salvo: {
    id: 'salvo', name: 'Ripple', role: 'Salvo', auto: true,
    damage: 56, explosive: { radius: 2.4, damage: 56, inner: 0.8, min: 14 },
    rpm: 110, burst: { count: 3, gap: 0.15 }, magazine: 3, reserve: 6, reload: 4.4, range: 32,
    falloff: { start: 99, end: 100, min: 1 },
    adsSpread: 0.03, hipSpread: 0.07, bloomPerShot: 0.2, bloomRecover: 1.4, bloomScale: 1,
    adsTime: 0.28, sprintToFire: 0.36, swapTime: 0.54, moveMult: 0.93, adsMoveMult: 0.58,
    pellets: 1, kickCam: 0.9, tracerWidth: 1.4, longshot: 17,
    botUse: { pref: 13, hold: 1, flank: 0.6, advance: 2 },
  },

  // ---------------- Melee ----------------
  // A boat hook cut down to a hand's length. Two quick swings kill, each one carries you a step forward, it makes no
  // sound and nothing in the game runs faster. Everything past three metres outranges it.
  knife: {
    id: 'knife', name: 'Gaff', role: 'Blade', auto: false, suppressed: true, melee: true, lunge: 13,
    damage: 60, rpm: 190, magazine: 1, reserve: 999, reload: 0.5, range: 2.7,
    falloff: { start: 99, end: 100, min: 1 },
    adsSpread: 0.02, hipSpread: 0.02, bloomPerShot: 0, bloomRecover: 3, bloomScale: 1,
    adsTime: 0.1, sprintToFire: 0.04, swapTime: 0.12, moveMult: 1.14, adsMoveMult: 1,
    pellets: 1, slideFire: true, unlimitedReserve: true, kickCam: 0.3, tracerWidth: 0.5, longshot: 2.6,
    botUse: { pref: 1.2, hold: 0.3, flank: 1.6, advance: 3, rush: 2.4, fireMax: 3 },
  },

  // A spike maul off the track gang. One swing kills and throws you further than the Gaff's, then leaves you
  // recovering for a full second if it missed.
  maul: {
    id: 'maul', name: 'Maul', role: 'Sledge', auto: false, suppressed: true, melee: true, lunge: 17,
    damage: 140, rpm: 55, magazine: 1, reserve: 999, reload: 0.5, range: 3,
    falloff: { start: 99, end: 100, min: 1 },
    adsSpread: 0.03, hipSpread: 0.03, bloomPerShot: 0, bloomRecover: 3, bloomScale: 1, turnCap: 10,
    adsTime: 0.14, sprintToFire: 0.1, swapTime: 0.3, moveMult: 1.04, adsMoveMult: 0.9,
    pellets: 1, slideFire: true, unlimitedReserve: true, kickCam: 1.2, tracerWidth: 0.9, longshot: 3.1,
    botUse: { pref: 1.4, hold: 0.3, flank: 1.6, advance: 3, rush: 2.8, fireMax: 3.5 },
  },
};

// Player level each gun opens at (js/shared/progression.js UNLOCK_SCHEDULE): spread from 3 to 40, between and past the
// older guns, the specialist ones last.
export const V10_UNLOCKS = [
  [3, 'knife'], [7, 'hushsmg'], [9, 'magshot'], [12, 'akimbo'], [14, 'rampar'], [17, 'twinshot'], [19, 'scout'],
  [21, 'drumsmg'], [23, 'flechette'], [24, 'nailer'], [26, 'beltlmg'], [28, 'hushdmr'], [30, 'heatar'], [33, 'salvo'],
  [36, 'maul'], [40, 'rail'],
].map(([level, id]) => ({ level, kind: 'weapon', id }));

// Which existing gun each new one borrows from, per table that is keyed by weapon id:
//   sound  (no longer read: audio.js derives every gun's voice and foley from its class, see js/render/feel.js)
//   fx     (no longer read: vfx.js derives every gun's tracer, flash and casing the same way)
//   reload anim.js RELOADS (hands and magazine)                  hold   characters.js HOLD and GUN_SCALES (carry)
//   force  corpses.js FORCE (how hard a kill throws the body)
// One id for all of them unless a table needs another.
const like = (base, over = {}) => ({ sound: base, fx: base, reload: base, hold: base, force: base, ...over });
export const V10_LIKE = {
  rampar: like('ar'), heatar: like('heavyar', { reload: 'lightlmg' }),
  hushsmg: like('tacsmg'), drumsmg: like('smg', { reload: 'autoshot', sound: 'heavysmg' }),
  magshot: like('autoshot', { reload: 'ar', force: 'shotgun' }), flechette: like('slug', { fx: 'shotgun' }),
  beltlmg: like('lmg'),
  twinshot: like('battle'), hushdmr: like('dmr', { fx: 'carbine' }),
  scout: like('semisnipe'), rail: like('antimat'),
  akimbo: like('deuce'), nailer: like('machpistol', { sound: 'crossbow', fx: 'crossbow' }),
  salvo: like('thumper'),
  knife: like('crossbow', { hold: 'pistol', reload: 'pistol', force: 'pistol' }),
  maul: like('crossbow', { hold: 'shotgun', reload: 'pistol', force: 'coach' }),
};
// Fills a per-gun table in place: every V10 gun without its own entry gets its lookalike's. `key` picks the column.
export function fillV10(table, key) {
  for (const id in V10_LIKE) if (table[id] === undefined && table[V10_LIKE[id][key]] !== undefined) table[id] = table[V10_LIKE[id][key]];
  return table;
}

// Attachments a gun cannot take although its category can ('*' = none at all). attachments.js applies this.
export const V10_DENY = {
  hushsmg: ['suppressor'], hushdmr: ['suppressor'],         // Suppressed already.
  drumsmg: ['drummag'],                                     // Its drum is the gun.
  beltlmg: ['heatsink', 'shroud'],                          // No heat bar to help.
  rail: ['suppressor'],                                     // Nothing to suppress on a coil.
  nailer: ['suppressor'],
  akimbo: ['reflex', 'holo', 'pointdot', 'ghostring'],      // Nobody sights down a pair.
  knife: '*', maul: '*',
};

// Where the new guns join the bot rotations (sim.js BOT_PRIMARIES, bots.js BOT_SECONDARIES) and Gun Game's ladder
// (modes.js GUN_LADDER, [rung index to insert before, id]).
export const V10_BOT_PRIMARIES = ['rampar', 'magshot', 'hushsmg', 'twinshot', 'beltlmg', 'scout', 'drumsmg', 'flechette', 'heatar', 'hushdmr', 'rail'];
export const V10_BOT_SECONDARIES = ['akimbo', 'nailer', 'salvo', 'knife', 'maul'];
export const V10_LADDER = ['rampar', 'magshot', 'twinshot', 'akimbo'];
