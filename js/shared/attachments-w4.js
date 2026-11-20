// Weapons wave 4 (js/shared/weapons-w4.js): one signature attachment for each new melee weapon, and the Slugger's own
// (weapons wave 3 shipped it without one). Same rules and the same boost as the V11 blade signatures
// (attachments-v11.js: strengths x1.5, damage and fire rate x1.25, costs halved). attachments.js appends these after
// wave 3, so every older id keeps its place in packKit's slot lists (append, never reorder). Blades have no `look`:
// the model stays the blade (dev/sim-attachments.mjs only fits looks).
import { boostSignature } from './attachments-v11.js';

const sig = (id, weapon, slot, name, unlock, fr, desc, mods, extra = {}) =>
  ({ id, slot, name, kind: 'sig', weapons: [weapon], unlock, for: fr, desc, mods, ...extra });

const LIST = [
  sig('s_corkhandle', 'bat', 'grip', 'Cork Handle', 15,
    'A lighter bat that comes round again sooner.',
    'Swings faster and moves faster. A little less reach.',
    { rpm: 1.12, moveMult: 1.02, range: 0.94 }),
  sig('s_longtang', 'katana', 'barrel', 'Long Tang', 10,
    'Reach the one the thrust did not quite.',
    'Longer reach and a longer lunge. Slower to swing.',
    { range: 1.1, lunge: 1.1, rpm: 0.9 }),
  sig('s_pickhead', 'fireaxe', 'barrel', 'Pick Head', 10,
    'A longer haft for the overhead blow.',
    'Longer reach. Slower to swing, heavier on foot.',
    { range: 1.15, rpm: 0.9, moveMult: 0.97 }),
  sig('s_sharpedge', 'shovel', 'barrel', 'Ground Edge', 10,
    'A filed edge: the second swing comes sooner.',
    'Swings faster. A little less reach.',
    { rpm: 1.14, range: 0.95 }),
  sig('s_wristcord', 'kama', 'grip', 'Wrist Cord', 10,
    'Throw the hook further into the cut.',
    'Lunges further and reaches further. Swings slower.',
    { lunge: 1.25, range: 1.06, rpm: 0.88 }),
  sig('s_sawback', 'machete', 'barrel', 'Sawback', 10,
    'A heavier blade with teeth on the spine.',
    'More damage per cut. Swings slower, heavier on foot.',
    { damage: 1.12, rpm: 0.9, moveMult: 0.97 }),
  sig('s_steelcore', 'tonfa', 'barrel', 'Steel Core', 10,
    'Weighted batons: hit harder, three still kill quicker.',
    'More damage per jab. Swings slower.',
    { damage: 1.1, rpm: 0.92 }),
];

export const W4_ATTACHMENTS = Object.fromEntries(LIST.map(boostSignature).map(a => [a.id, a]));
