// Weapons wave 3 (js/shared/weapons-w3.js): two signature attachments for each new gun. Same rules and the same boost
// as the V11 signatures (attachments-v11.js: strengths x1.5, damage and fire rate x1.25, costs halved). attachments.js
// appends these after wave 2, so every older id keeps its place in packKit's slot lists (append, never reorder).
// `look` draws each one as a part the gun's own model already fits (js/render/guns-w3.js).
import { boostSignature } from './attachments-v11.js';

const sig = (id, weapon, slot, name, unlock, fr, desc, mods, extra = {}) =>
  ({ id, slot, name, kind: 'sig', weapons: [weapon], unlock, for: fr, desc, mods, ...extra });
const M1 = 31;   // Mastery ladder tier I.

const LIST = [
  // ---- Clatter (burst SMG) ----
  sig('s_clattershroud', 'burstsmg', 'barrel', 'Clatter Shroud', 26,
    'Pushes the Clatter\'s two-burst kill a few metres further down the lane.',
    'Longer range, and rounds keep more damage past it. Slower out of a sprint and to swap.',
    { range: 1.1, falloffMin: 1.06, sprintToFire: 1.12, swapTime: 1.1 }, { look: { barrel: 'longbarrel' } }),
  sig('s_snapsear', 'burstsmg', 'grip', 'Snap Sear', M1,
    'Lands the whole burst before the target can step out of it.',
    'Rounds in a burst come closer together and bursts come sooner. Each burst kicks harder and blooms more.',
    { burstGap: 0.75, rpm: 1.05, patternAmp: 1.3, bloomPerShot: 1.25 }, { look: { grip: 'vertical' } }),

  // ---- Bullhead (ten-gauge pump) ----
  sig('s_slickpump', 'heavyshot', 'grip', 'Slick Pump', 26,
    'A second shell before they close the gap the first one missed.',
    'Pumps faster. Slower to swap, a little slower on foot.',
    { rpm: 1.14, swapTime: 1.1, moveMult: 0.97 }, { look: { grip: 'wrap' } }),
  sig('s_gooseloads', 'heavyshot', 'mag', 'Goose Loads', M1,
    'Long ten-gauge shells for the shot across a wide room.',
    'Reaches further on a tighter fan. One shell fewer, slower to reload.',
    { range: 1.08, adsSpread: 0.88, magazine: 0.75, reload: 1.15 }, { look: { mag: 'magnum' } }),

  // ---- Gavel (battle pistol) ----
  sig('s_matchslide', 'battlepistol', 'barrel', 'Match Slide', 25,
    'Quick, straight follow-ups for the three-shot kill.',
    'Much less bloom per shot and settles sooner. Slower to swap and out of a sprint.',
    { bloomPerShot: 0.75, bloomRecover: 1.15, swapTime: 1.12, sprintToFire: 1.1 }, { look: { barrel: 'compensator' } }),
  sig('s_hotloads', 'battlepistol', 'mag', 'Hot Loads', M1,
    'A sidearm that still holds its kill across a medium lane.',
    'Longer range, and rounds keep more damage past it. Slower reload, more bloom per shot.',
    { range: 1.08, falloffMin: 1.06, reload: 1.15, bloomPerShot: 1.15 }, { look: { mag: 'apmag' } }),
];

export const W3_ATTACHMENTS = Object.fromEntries(LIST.map(boostSignature).map(a => [a.id, a]));
