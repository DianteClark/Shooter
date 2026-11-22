// Weapons wave 5 (js/shared/weapons-w5.js): two signature attachments for each new gun. Same rules and the same boost
// as the V11 signatures (attachments-v11.js: strengths x1.5, damage and fire rate x1.25, costs halved). attachments.js
// appends these after wave 4, so every older id keeps its place in packKit's slot lists (append, never reorder).
// `look` draws each one as a part the gun's own model already fits (js/render/guns-w5.js).
import { boostSignature } from './attachments-v11.js';

const sig = (id, weapon, slot, name, unlock, fr, desc, mods, extra = {}) =>
  ({ id, slot, name, kind: 'sig', weapons: [weapon], unlock, for: fr, desc, mods, ...extra });
const M1 = 31;   // Mastery ladder tier I.

const LIST = [
  // ---- Gadfly (hip-fire SMG) ----
  sig('s_buzzspring', 'hipsmg', 'mag', 'Buzz Spring', 26,
    'Empties the Gadfly into a room before anyone turns round.',
    'Fires faster. A few rounds fewer, more recoil sway.',
    { rpm: 1.07, magazine: 0.88, patternAmp: 1.2 }, { look: { mag: 'extmag' } }),
  sig('s_gadflybrake', 'hipsmg', 'barrel', 'Gadfly Brake', M1,
    'An even tighter cone for the player who never aims at all.',
    'Tighter from the hip, reaches a little further. Slower to aim, a touch slower on foot.',
    { hipSpread: 0.9, range: 1.06, adsTime: 1.12, moveMult: 0.98 }, { look: { barrel: 'compensator' } }),

  // ---- Carousel (pan-fed LMG) ----
  sig('s_doublepan', 'panlmg', 'mag', 'Double Pan', 14,
    'A second layer on the pan: a lane held for twice as long.',
    'Many more rounds in the pan. Much slower to change, slower on foot.',
    { magazine: 1.4, reload: 1.25, moveMult: 0.96 }, { look: { mag: 'extmag' } }),
  sig('s_pangovernor', 'panlmg', 'grip', 'Rate Governor', M1,
    'Lets the Carousel run faster when the lane is full of people.',
    'Fires faster. More recoil sway and bloom per shot.',
    { rpm: 1.1, patternAmp: 1.25, bloomPerShot: 1.2 }, { look: { grip: 'vertical' } }),

  // ---- Vigil (semi-automatic sniper) ----
  sig('s_vigilbuffer', 'autosniper', 'grip', 'Recoil Buffer', 16,
    'Keeps the scope on the body for the second round.',
    'The scope is thrown up less per shot. Fires a little slower.',
    { boltKick: 1.35, rpm: 0.93 }, { look: { grip: 'angled' } }),
  sig('s_vigilmatch', 'autosniper', 'mag', 'Match Box', M1,
    'Heavier match rounds: the two-shot kill holds through a crate.',
    'More damage, more through cover. Fewer rounds, slower to reload.',
    { damage: 1.08, penetrate: 1.1, magazine: 0.72, reload: 1.12 }, { look: { mag: 'apmag' } }),

  // ---- Fusee (flare pistol) ----
  sig('s_magnesium', 'flare', 'mag', 'Magnesium Star', 25,
    'A hotter star: the round itself hurts more before the burn.',
    'More damage on the hit. Slower to reload, slower out of a sprint.',
    { damage: 1.15, reload: 1.15, sprintToFire: 1.1 }, { look: { mag: 'speedmag' } }),
  sig('s_signalbarrel', 'flare', 'barrel', 'Signal Barrel', M1,
    'A longer barrel for a flare that lands across a lane.',
    'Longer range, and the round keeps more damage past it. Slower to swap and out of a sprint.',
    { range: 1.15, falloffMin: 1.1, swapTime: 1.12, sprintToFire: 1.1 }, { look: { barrel: 'longbarrel' } }),

  // ---- Skyhook (lock-on launcher) ----
  sig('s_seeker', 'lockon', 'optic', 'Seeker Head', 24,
    'A quicker lock for the chopper that is already turning away.',
    'Aims (and locks) faster. Slower to swap, a touch slower on foot.',
    { adsTime: 0.86, swapTime: 1.12, moveMult: 0.97 }, { look: { optic: 'rangefinder' } }),
  sig('s_thirdtube', 'lockon', 'mag', 'Third Tube', M1,
    'A third rocket on the frame, enough for a Gunship on its own.',
    'One more rocket loaded. Much slower to reload, slower on foot.',
    { magazine: 1.5, reload: 1.3, moveMult: 0.95 }, { look: { mag: 'warhead' } }),
];

export const W5_ATTACHMENTS = Object.fromEntries(LIST.map(boostSignature).map(a => [a.id, a]));
