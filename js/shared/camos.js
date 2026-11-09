// Camo catalogue. Data only: adding a camo is one line here and nothing else.
// pattern: solid | digital | tiger | splinter | hex | gold | molten | prism (see js/render/camo-shader.js)
// colors:  up to four 0xRRGGBB swatches, most common first. scale: pattern cells per metre (fewer = bigger, bolder).
// tier:    0 default, 1 standard, 2 rare, 3 mastery. unlockKills: kills with that weapon, ascending.
// tint:    optional; mastery camos recolor tracers and muzzle flash so they read in play.
export const CAMOS = [
  { id: 'none',    name: 'Factory',     pattern: 'solid',    colors: [0x3b4048],                               scale: 1.0,                 tier: 0, unlockKills: 0 },
  { id: 'ash',     name: 'Ash Grid',    pattern: 'digital',  colors: [0x6b6f73, 0x30343a, 0xb6b4ab, 0x1a1c20], scale: 9.0,                 tier: 1, unlockKills: 25 },
  { id: 'stalker', name: 'Stalker',     pattern: 'tiger',    colors: [0xd8751f, 0x16120f, 0xe9c177],           scale: 3.4,                 tier: 1, unlockKills: 50 },
  { id: 'rust',    name: 'Rail Rust',   pattern: 'splinter', colors: [0xa2482a, 0x5f3a2c, 0xd1a06c, 0x241a18], scale: 3.2,                 tier: 1, unlockKills: 100 },
  { id: 'comb',    name: 'Honeycomb',   pattern: 'hex',      colors: [0xf0b429, 0xbf7a12, 0x402a0b, 0x120d05], scale: 8.0,                 tier: 1, unlockKills: 150 },
  { id: 'cobalt',  name: 'Cobalt Bit',  pattern: 'digital',  colors: [0x1763ff, 0x0b2a78, 0x7cc8ff, 0x050f33], scale: 9.0,                 tier: 2, unlockKills: 200 },
  { id: 'crimson', name: 'Red Tiger',   pattern: 'tiger',    colors: [0xe01a3c, 0x120a0e, 0xff7a6b],           scale: 3.4,                 tier: 2, unlockKills: 300 },
  { id: 'glacier', name: 'Glacier',     pattern: 'splinter', colors: [0xdff4ff, 0x65b8e8, 0x1d5e94, 0x0d2338], scale: 3.2,                 tier: 2, unlockKills: 400 },
  { id: 'toxin',   name: 'Toxin Cell',  pattern: 'hex',      colors: [0x7dff1f, 0x2aa61a, 0x0d3d17, 0x050f08], scale: 8.0,                 tier: 2, unlockKills: 500 },
  { id: 'gold',    name: 'Sovereign',   pattern: 'gold',     colors: [0xffd659, 0xb27616, 0xfff4bf],           scale: 7.0, animated: true, tier: 3, unlockKills: 750,  tint: 0xffcf40 },
  { id: 'molten',  name: 'Molten Core', pattern: 'molten',   colors: [0x1a0d0a, 0xff4a0a, 0xffd23f],           scale: 3.0, animated: true, tier: 3, unlockKills: 1000, tint: 0xff6a1a },
  { id: 'prism',   name: 'Prism',       pattern: 'prism',    colors: [0xff2bd6, 0x18e8ff, 0xfff200],           scale: 6.0, animated: true, tier: 3, unlockKills: 1500, tint: 0xd67bff },
];

const BY_ID = new Map(CAMOS.map(c => [c.id, c]));

// Unknown or missing ids fall back to the first entry so a stale save never breaks rendering.
export function getCamo(id) {
  return BY_ID.get(id) || CAMOS[0];
}
