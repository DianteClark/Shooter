// Cosmetic catalogue: camos, tracer colours, kill effects. Data only: adding one is one line here.
// pattern: solid | digital | tiger | splinter | hex | gold | molten | prism | carbon | livewire | aurora | singularity
//          (see js/render/camo-shader.js)
// colors:  up to four 0xRRGGBB swatches, most common first. scale: pattern cells per metre (fewer = bigger, bolder).
// tier:    0 default, 1 standard, 2 rare, 3 mastery, 4 prestige.
// tint:    optional; mastery and prestige camos recolor tracers and muzzle flash so they read in play.
//
// How a camo is earned, per weapon (see js/shared/progression.js):
//   chal: {track, goal}    a challenge: `goal` of track kills|head|long|slide|clean.
//   mastery: true          every challenge on the weapon complete, plus masteryKills if set.
//   prestige: n            weapon prestige n on that weapon.
//   season: 'S1'           a season's reward track (js/shared/season-items.js); appended below, owned through the save's
//                          season block (js/ui/progress.js), hidden before that season starts.
// unlockKills is the v1 kill threshold and is read only by the save migration, so saves keep what they earned.
//
// Append new camos at the end. Index order is what snapshots and the shader uniform array use.
import { SEASON_DEFS, seasonCamos } from './season-items.js';

export const CAMOS = [
  { id: 'none',    name: 'Factory',     pattern: 'solid',    colors: [0x3b4048],                               scale: 1.0,                 tier: 0, unlockKills: 0 },
  { id: 'ash',     name: 'Ash Grid',    pattern: 'digital',  colors: [0x6b6f73, 0x30343a, 0xb6b4ab, 0x1a1c20], scale: 9.0,                 tier: 1, unlockKills: 25,   chal: { track: 'kills', goal: 25 } },
  { id: 'stalker', name: 'Stalker',     pattern: 'tiger',    colors: [0xd8751f, 0x16120f, 0xe9c177],           scale: 3.4,                 tier: 1, unlockKills: 50,   chal: { track: 'head', goal: 10 } },
  { id: 'rust',    name: 'Rail Rust',   pattern: 'splinter', colors: [0xa2482a, 0x5f3a2c, 0xd1a06c, 0x241a18], scale: 3.2,                 tier: 1, unlockKills: 100,  chal: { track: 'long', goal: 5 } },
  { id: 'comb',    name: 'Honeycomb',   pattern: 'hex',      colors: [0xf0b429, 0xbf7a12, 0x402a0b, 0x120d05], scale: 8.0,                 tier: 1, unlockKills: 150,  chal: { track: 'slide', goal: 10 } },
  { id: 'cobalt',  name: 'Cobalt Bit',  pattern: 'digital',  colors: [0x1763ff, 0x0b2a78, 0x7cc8ff, 0x050f33], scale: 9.0,                 tier: 2, unlockKills: 200,  chal: { track: 'kills', goal: 150 } },
  { id: 'crimson', name: 'Red Tiger',   pattern: 'tiger',    colors: [0xe01a3c, 0x120a0e, 0xff7a6b],           scale: 3.4,                 tier: 2, unlockKills: 300,  chal: { track: 'head', goal: 60 } },
  { id: 'glacier', name: 'Glacier',     pattern: 'splinter', colors: [0xdff4ff, 0x65b8e8, 0x1d5e94, 0x0d2338], scale: 3.2,                 tier: 2, unlockKills: 400,  chal: { track: 'long', goal: 30 } },
  { id: 'toxin',   name: 'Toxin Cell',  pattern: 'hex',      colors: [0x7dff1f, 0x2aa61a, 0x0d3d17, 0x050f08], scale: 8.0,                 tier: 2, unlockKills: 500,  chal: { track: 'slide', goal: 40 } },
  { id: 'gold',    name: 'Sovereign',   pattern: 'gold',     colors: [0xffd659, 0xb27616, 0xfff4bf],           scale: 7.0, animated: true, tier: 3, unlockKills: 750,  tint: 0xffcf40, mastery: true },
  { id: 'molten',  name: 'Molten Core', pattern: 'molten',   colors: [0x1a0d0a, 0xff4a0a, 0xffd23f],           scale: 3.0, animated: true, tier: 3, unlockKills: 1000, tint: 0xff6a1a, mastery: true, masteryKills: 1000 },
  { id: 'prism',   name: 'Prism',       pattern: 'prism',    colors: [0xff2bd6, 0x18e8ff, 0xfff200],           scale: 6.0, animated: true, tier: 3, unlockKills: 1500, tint: 0xd67bff, mastery: true, masteryKills: 1500 },
  { id: 'bare',    name: 'Bare Steel',  pattern: 'splinter', colors: [0x9aa4ad, 0x5b646c, 0xdde3e8, 0x2a2f35], scale: 3.2,                 tier: 1, chal: { track: 'clean', goal: 20 } },
  { id: 'iron',    name: 'Ironclad',    pattern: 'hex',      colors: [0x4a5560, 0x2c343c, 0xc9d3dc, 0x10151a], scale: 8.0,                 tier: 2, chal: { track: 'clean', goal: 80 } },
  { id: 'carbon',  name: 'Carbon Weave',pattern: 'carbon',   colors: [0x20232a, 0x0c0d11, 0xff5a2a],           scale: 11.0,                tier: 4, prestige: 1 },
  { id: 'wire',    name: 'Live Wire',   pattern: 'livewire', colors: [0x12141c, 0x35c8ff, 0xf2fbff],           scale: 5.0, animated: true, tier: 4, tint: 0x5ad2ff, prestige: 1 },
  { id: 'aurora',  name: 'Polar Night', pattern: 'aurora',   colors: [0x060a1c, 0x1fff9a, 0xc23dff, 0xf4fbff], scale: 4.0, animated: true, tier: 4, tint: 0x4dffb0, prestige: 2 },
  { id: 'horizon', name: 'Event Horizon', pattern: 'singularity', colors: [0x05030a, 0xff7a1a, 0xfff0c2, 0x4d2bff], scale: 7.0, animated: true, tier: 4, tint: 0xffa040, prestige: 3 },
];
// Seasons (docs/SEASONS.md): every season's camos go on the end, in season order, so indices only ever grow.
for (const def of SEASON_DEFS) CAMOS.push(...seasonCamos(def));

const BY_ID = new Map(CAMOS.map(c => [c.id, c]));

// Unknown or missing ids fall back to the first entry so a stale save never breaks rendering.
export function getCamo(id) {
  return BY_ID.get(id) || CAMOS[0];
}

// Rendered by js/render/vfx.js. id 'none' keeps the camo tint or team colour. cycle sweeps the hue over time.
export const TRACERS = [
  { id: 'none',     name: 'Standard',      prestige: 0 },
  { id: 'hazard',   name: 'Hazard Amber',  color: 0xffb01f, prestige: 1 },
  { id: 'signal',   name: 'Signal Green',  color: 0x3dff7a, prestige: 1 },
  { id: 'plasma',   name: 'Plasma Violet', color: 0xb45cff, prestige: 2 },
  { id: 'coolant',  name: 'Coolant Cyan',  color: 0x22e6ff, prestige: 2 },
  { id: 'whitehot', name: 'White Hot',     color: 0xfff3d6, prestige: 3 },
  { id: 'spectrum', name: 'Spectrum',      color: 0xff2bd6, cycle: true, prestige: 3 },
];

export const KILL_EFFECTS = [
  { id: 'none',      name: 'No Effect',       prestige: 0 },
  { id: 'embers',    name: 'Ember Shower',    prestige: 1 },
  { id: 'shockring', name: 'Shock Ring',      prestige: 1 },
  { id: 'shatter',   name: 'Crystal Shatter', prestige: 2 },
  { id: 'overload',  name: 'Overload',        prestige: 2 },
  { id: 'implode',   name: 'Implosion',       prestige: 3 },
  { id: 'phoenix',   name: 'Phoenix',         prestige: 3 },
];

export function getTracer(id) { return TRACERS.find(t => t.id === id) || TRACERS[0]; }
export function getKillEffect(id) { return KILL_EFFECTS.find(k => k.id === id) || KILL_EFFECTS[0]; }
