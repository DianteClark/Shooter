// Attachments wave 2 (ROADMAP item 30): sixteen general attachments that fill out the thin slots (sniper and pistol
// optics, launcher everything, shotgun and pistol mags, pistol grips). Data only; attachments.js appends these after
// the V11 table, so every older id keeps its place in packKit's slot lists (append, never reorder).
//
// Same rules as the older general attachments: multipliers on MOD_INFO keys, never an identity key (damage, rpm,
// wind-up... belong to signatures and kits), every part gives something and costs something on every gun that takes
// it. Each one has its own model piece in js/render/guns.js (no `look` borrowing). `for` and `desc` are the gunsmith's
// two lines. `unlock` is a weapon level; wave 2 parts share a level with at most one older part on any gun.
// Range never grows past what the gun's own best part in that slot already gives, so kill ranges hold
// (dev/sim-attachments.mjs checks every gun's best reach).

import { idsIn } from './constants.js';

const not = (ids, ...out) => ids.filter(id => !out.includes(id));
const PISTOLS = not(idsIn('Pistol'), 'golden');
const SIGHTED_PISTOLS = not(PISTOLS, 'akimbo');          // Nobody sights down a pair.
const LAUNCHERS = idsIn('Launcher');

const part = (id, slot, name, unlock, weapons, fr, desc, mods, extra = {}) => ({ id, slot, name, unlock, weapons, for: fr, desc, mods, ...extra });

const LIST = [
  // ---- Optic ----
  part('irons', 'optic', 'Flip Irons', 17,
    [...idsIn('LMG', 'Sniper', 'Shotgun'), ...SIGHTED_PISTOLS, ...LAUNCHERS],
    'Fighting fast with the glass folded away.',
    'Aims, swaps and fires out of a sprint sooner. Much looser aimed fire, a little less reach.',
    { adsTime: 0.84, sprintToFire: 0.92, swapTime: 0.94, adsSpread: 1.28, range: 0.94 }),
  part('prism', 'optic', 'Prism 2x', 22,
    idsIn('Assault', 'LMG', 'Marksman', 'Sniper'),
    'Steady mid-range taps that settle quickly.',
    'Tighter aimed fire that settles sooner. Slower to aim, a little wider from the hip.',
    { adsSpread: 0.86, bloomRecover: 1.12, adsTime: 1.1, hipSpread: 1.08 }),
  part('rangefinder', 'optic', 'Rangefinder', 14,
    LAUNCHERS,
    'Dropping rounds on targets further off.',
    'Reaches a little further on a truer flight. Slower to aim and to bring up.',
    { range: 1.06, adsSpread: 0.92, adsTime: 1.12, swapTime: 1.08 }),
  part('laserbox', 'optic', 'Tac Laser', 21,
    [...idsIn('SMG', 'Shotgun'), ...SIGHTED_PISTOLS, ...LAUNCHERS],
    'Hip-firing on the move without aiming.',
    'Tighter from the hip and quicker out of a sprint. Looser aimed fire, slower to aim.',
    { hipSpread: 0.86, sprintToFire: 0.9, adsSpread: 1.14, adsTime: 1.06 }),

  // ---- Barrel ----
  part('flashhider', 'barrel', 'Birdcage Hider', 10,
    // Integrally suppressed guns, the silent crossbow and the coil and nail guns have no flash to hide.
    not([...idsIn('Assault', 'SMG', 'Marksman', 'Sniper'), ...PISTOLS, 'lightlmg', 'beltlmg'], 'hushsmg', 'hushdmr', 'crossbow', 'rail', 'nailer'),
    'Quick follow-ups out of a sprint.',
    'Fires sooner out of a sprint and settles sooner. Slightly shorter range, slower to swap.',
    { sprintToFire: 0.9, bloomRecover: 1.12, range: 0.94, swapTime: 1.06 }),
  part('muzzlebrake', 'barrel', 'Tank Brake', 26,
    [...idsIn('Sniper'), 'lightlmg', 'beltlmg'],
    'Back on target fast after a heavy shot.',
    'Settles much sooner with less sway. Wider from the hip, slower out of a sprint.',
    { bloomRecover: 1.2, patternAmp: 0.88, hipSpread: 1.12, sprintToFire: 1.08 }),
  part('ventrib', 'barrel', 'Vent Rib', 14,
    idsIn('Shotgun'),
    'Shell after shell at a run.',
    'Settles sooner between shells and fires sooner out of a sprint. A little less reach, slower to swap.',
    { bloomRecover: 1.2, sprintToFire: 0.88, range: 0.94, swapTime: 1.06 }),
  part('venturi', 'barrel', 'Venturi Nozzle', 4,
    LAUNCHERS,
    'Firing the moment you stop running.',
    'Fires and swaps much sooner. Less reach, looser aimed fire.',
    { sprintToFire: 0.86, swapTime: 0.9, range: 0.9, adsSpread: 1.12 }),
  part('guiderail', 'barrel', 'Guide Rail', 27,
    LAUNCHERS,
    'Putting the round exactly where you aim.',
    'Much tighter aimed and hip fire. Slower to aim, heavier on foot.',
    { adsSpread: 0.86, hipSpread: 0.94, adsTime: 1.1, moveMult: 0.97 }),

  // ---- Mag ----
  part('subsonic', 'mag', 'Subsonic Rounds', 23,
    not([...idsIn('SMG'), ...PISTOLS], 'scatter', 'nailer'),
    'Long strings that stay on target, up close.',
    'Less recoil sway and bloom. Shorter range, a little wider from the hip.',
    { patternAmp: 0.85, bloomPerShot: 0.85, range: 0.88, hipSpread: 1.05 }),
  part('magnum', 'mag', 'Magnum Shells', 25,
    idsIn('Shotgun'),
    'A fan that bites a step further out.',
    'Pellets carry a little further. Fewer shells, slower reload, slower out of a sprint.',
    { range: 1.05, magazine: 0.85, reload: 1.12, sprintToFire: 1.06 },
    // A break-action holds two shells whatever goes in them.
    { perWeapon: { coach: { range: 1.05, reload: 1.15, sprintToFire: 1.06, adsTime: 1.05 } } }),
  part('flitewad', 'mag', 'Flite Wads', 7,
    idsIn('Shotgun'),
    'A tighter fan from the hip.',
    'Tighter from the hip, a touch tighter aimed. Slower to reload and to swap.',
    { hipSpread: 0.92, adsSpread: 0.95, reload: 1.1, swapTime: 1.08 }),
  part('lightrocket', 'mag', 'Light Rockets', 16,
    LAUNCHERS,
    'A launcher you can carry into a fight.',
    'Much quicker to swap and lighter on foot. A smaller blast, slightly slower reload.',
    { swapTime: 0.85, moveMult: 1.03, blastRadius: 0.88, reload: 1.06 }),

  // ---- Grip ----
  part('rubber', 'grip', 'Rubber Sleeve', 28,
    [...idsIn('SMG', 'Shotgun'), ...PISTOLS, ...LAUNCHERS],
    'Soaking up recoil on light guns.',
    'Less recoil sway and bloom. Slower to swap and out of a sprint.',
    { patternAmp: 0.85, bloomPerShot: 0.88, swapTime: 1.1, sprintToFire: 1.06 }),
  part('thumbrest', 'grip', 'Thumb Rest', 13,
    [...idsIn('Sniper'), ...PISTOLS, ...LAUNCHERS],
    'A steadier hold for the aimed shot.',
    'Tighter aimed fire that settles a little sooner. Slower to aim and to swap.',
    { adsSpread: 0.9, bloomRecover: 1.08, adsTime: 1.06, swapTime: 1.08 },
    // A launcher already has the Guide Rail and Rangefinder for accuracy; on a tube this mostly helps it settle.
    { perWeapon: Object.fromEntries(LAUNCHERS.map(id => [id, { adsSpread: 0.94, bloomRecover: 1.1, adsTime: 1.06, swapTime: 1.08 }])) }),
  part('beavertail', 'grip', 'Beavertail', 6,
    PISTOLS,
    'Shooting from the hip on the move.',
    'Tighter from the hip and a little faster on foot. Looser aimed fire, slower to swap.',
    { hipSpread: 0.92, moveMult: 1.02, adsSpread: 1.1, swapTime: 1.06 }),
];

export const W2_ATTACHMENTS = Object.fromEntries(LIST.map(a => [a.id, a]));
// Older parts that wave 2 opens to more classes: [id, extra weapon ids]. Applied by attachments.js.
export const W2_EXTEND = [
  ['tapedmag', not([...idsIn('SMG'), ...PISTOLS], 'scatter', 'nailer', 'drumsmg')],   // Shells, nail strips and a pan drum cannot be taped.
];
