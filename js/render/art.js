// Shared art direction: per-map themes, the lighting rig and the GLSL snippets every material uses.
// All shaders output display-referred colour directly (no tone map, no sRGB encode pass), so a hex
// colour written here is what lands on screen after lighting. That is what keeps the palette exact.
import * as THREE from 'three';

export function hexRGB(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// One rule for every map: the world is muted, only team colours, tracers, camos and signage are saturated.
// A theme's `ink` is the palette the shared wall dressers read; `extra` holds what only that map uses.
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));

export const THEMES = {
  // Freight yard at dusk. Low sun in the south-west: warm on camera-facing walls, long shadows up-right.
  railyard: {
    id: 'railyard',
    light: { dir: norm([-0.58, 0.56, 0.60]), sun: [1.02, 0.70, 0.44], sky: [0.40, 0.38, 0.56], amb: [0.30, 0.28, 0.36] },
    clear: 0x15141c,
    fog: [0.40, 0.44, 0.60], fogSeam: [0.16, 0.10, 0.04], desatTint: [0.8, 0.78, 0.9],
    shadow: { col: [0.42, 0.40, 0.62], strength: 0.62, len: 1 },
    lamp: [0.34, 0.24, 0.12],
    ink: ink({
      ground: 0x5a5552, asphalt: 0x4b4a52, dirt: 0x6a5c4e, gravel: 0x60595a,
      roof: 0x565f6b, wall: 0x6a5f58, wallB: 0x5b5f66, trim: 0x3f3d44,
      concrete: 0x7b7a78, crate: 0x9a7a4c, crateD: 0x5c4a30,
      rail: 0x7f8690, tie: 0x3f3530, hazardY: 0x9c7a2c, hazardK: 0x24222a,
      paint: 0xc9b48a, glow: 0xffcf8a, glowCool: 0xbdd8ff,
    }),
    containers: [0x3c6a72, 0x8a4634, 0xa8853c, 0x5b4a6e, 0x3e5a48],
    weather: { fields: [
      { kind: 'mote', count: 90, box: [40, 7, 32], vel: [0.5, 0.12, -0.2], size: 0.1, col: [1.0, 0.72, 0.42], alpha: 0.5 },
    ] },
  },

  // Storm at night: cold moon from the north-west, sodium pools on soaking concrete, lightning over the water.
  harbor: {
    id: 'harbor',
    light: { dir: norm([-0.42, 0.72, 0.42]), sun: [0.34, 0.44, 0.60], sky: [0.26, 0.34, 0.50], amb: [0.20, 0.24, 0.33] },
    clear: 0x070b12,
    fog: [0.26, 0.34, 0.50], fogSeam: [0.04, 0.10, 0.16], desatTint: [0.72, 0.8, 0.92],
    shadow: { col: [0.30, 0.36, 0.50], strength: 0.48, len: 0.7 },
    lamp: [0.42, 0.28, 0.10],
    wet: 0.9, sheen: norm([0.05, 0.92, -0.38]), sheenCol: [0.34, 0.46, 0.66], lightning: true,
    water: { deep: [0.03, 0.06, 0.11], shallow: [0.06, 0.13, 0.2], glint: [0.42, 0.6, 0.85] },
    ink: ink({
      ground: 0x41474f, asphalt: 0x333941, dirt: 0x3d4348, gravel: 0x484e55,
      roof: 0x3d4853, wall: 0x56626d, wallB: 0x4a5560, trim: 0x2d343c,
      concrete: 0x6d7680, crate: 0x7c7461, crateD: 0x4b4639,
      rail: 0x8a95a2, tie: 0x2e343c, hazardY: 0xa8892f, hazardK: 0x20252c,
      paint: 0xb6b09a, glow: 0xffd490, glowCool: 0xc9e4ff,
      hull: 0x2c3946, hullBand: 0x7a3d33, deck: 0x56606a, super: 0xa8b0b6, crane: 0x9a5a34,
    }),
    containers: [0x3a5e70, 0x7a4231, 0x93783c, 0x4a4a68, 0x3a564c],
    weather: { fields: [
      { kind: 'rain', count: 640, box: [38, 16, 30], vel: [-5, -24, 2], len: 1.1, width: 0.018, col: [0.72, 0.84, 1.0], alpha: 0.45 },
      { kind: 'ripple', count: 110, box: [36, 1, 28], life: 0.5, size: 0.75, col: [0.7, 0.84, 1.0], alpha: 0.4 },
      { kind: 'mote', count: 30, box: [40, 3, 32], vel: [-2, 0.05, 0.6], size: 0.4, col: [0.62, 0.74, 0.92], alpha: 0.05 },
    ] },
  },

  // Rain-slick night market: ultraviolet ambient, signage does the rest of the lighting.
  neon: {
    id: 'neon',
    light: { dir: norm([-0.25, 0.75, 0.55]), sun: [0.34, 0.26, 0.52], sky: [0.30, 0.26, 0.48], amb: [0.26, 0.22, 0.36] },
    clear: 0x08060f,
    fog: [0.26, 0.22, 0.46], fogSeam: [0.20, 0.02, 0.24], desatTint: [0.76, 0.72, 0.92],
    shadow: { col: [0.28, 0.24, 0.42], strength: 0.5, len: 0.45 },
    lamp: [0.24, 0.12, 0.28],
    wet: 1.0, sheen: norm([0.0, 0.8, -0.6]), sheenCol: [0.55, 0.32, 0.72],
    ink: ink({
      ground: 0x35333f, asphalt: 0x2b2a35, dirt: 0x37353d, gravel: 0x3d3b45,
      roof: 0x2d2c3a, wall: 0x3f3c4d, wallB: 0x4a4256, trim: 0x201f2a,
      concrete: 0x57566a, crate: 0x6b5a4a, crateD: 0x40362c,
      rail: 0x6a6878, tie: 0x24222c, hazardY: 0x7a6636, hazardK: 0x1e1c26,
      paint: 0x8a8690, glow: 0xffc27a, glowCool: 0xaad8ff,
      awningA: 0x7b4a5e, awningB: 0x4a6a72,
    }),
    containers: [0x4a4a68, 0x5a3a52, 0x3a5a62],
    // Sign colours stay clear of the two team hues so a sign never reads as a player.
    signs: [[1.0, 0.18, 0.62], [0.72, 0.3, 1.0], [0.2, 0.95, 0.72], [1.0, 0.66, 0.18], [0.62, 1.0, 0.34]],
    weather: { fields: [
      { kind: 'rain', count: 300, box: [36, 14, 28], vel: [1.2, -16, 1.2], len: 0.7, width: 0.012, col: [0.8, 0.72, 1.0], alpha: 0.32 },
      { kind: 'ripple', count: 70, box: [34, 1, 26], life: 0.6, size: 0.6, col: [0.85, 0.65, 1.0], alpha: 0.3 },
      { kind: 'mote', count: 40, box: [36, 5, 28], vel: [0.2, 0.55, 0.0], size: 0.6, col: [0.7, 0.5, 0.9], alpha: 0.06 },
    ] },
  },

  // Bright afternoon: hard low sun from the west, long shadows, warm dust hanging in the air.
  dust: {
    id: 'dust',
    light: { dir: norm([-0.8, 0.46, 0.34]), sun: [0.96, 0.84, 0.68], sky: [0.46, 0.44, 0.42], amb: [0.36, 0.33, 0.30] },
    clear: 0x4b3a29,
    fog: [0.56, 0.48, 0.42], fogSeam: [0.24, 0.13, 0.04], desatTint: [0.86, 0.8, 0.74],
    shadow: { col: [0.40, 0.33, 0.34], strength: 0.72, len: 1.45 },
    lamp: [0.1, 0.07, 0.03],
    ink: ink({
      ground: 0x978c78, asphalt: 0x867b68, dirt: 0xa39577, gravel: 0x7b7265,
      roof: 0x968670, wall: 0x9f9078, wallB: 0x8b7d68, trim: 0x5a4f42,
      concrete: 0x968a78, crate: 0x8f7650, crateD: 0x5a4a32,
      rail: 0x7f7a70, tie: 0x4d4034, hazardY: 0x8a6a30, hazardK: 0x3c3226,
      paint: 0xcabb9a, glow: 0xffe0a8, glowCool: 0xd6e4ec,
      rock: 0x8a7760, rockD: 0x69594a, rockL: 0xa8957a, adobe: 0xac9c82, adobeD: 0x897964,
      canvas: 0xc4b89c, canvasB: 0x8a6f4e, sandbag: 0x9a8a68,
    }),
    containers: [0x7a6a4a, 0x6f4a35, 0x5f6a5a],
    weather: { fields: [
      { kind: 'streak', count: 150, box: [38, 3.2, 30], vel: [11, 0.1, 2.5], len: 2.6, width: 0.03, col: [0.92, 0.8, 0.58], alpha: 0.2 },
      { kind: 'mote', count: 150, box: [40, 7, 32], vel: [4.5, 0.1, 1.0], size: 0.12, col: [1.0, 0.9, 0.7], alpha: 0.32 },
      { kind: 'mote', count: 16, box: [44, 3, 34], vel: [5.5, 0.04, 1.2], size: 3.2, col: [0.86, 0.72, 0.5], alpha: 0.05 },
    ] },
  },
};

// Snowbound rail depot at night: a cold moon high in the north-west, sodium yard lamps, snow coming in on the wind.
THEMES.frost = {
  id: 'frost',
  light: { dir: norm([-0.36, 0.8, 0.46]), sun: [0.34, 0.42, 0.60], sky: [0.27, 0.32, 0.47], amb: [0.19, 0.22, 0.32] },
  clear: 0x080d16,
  fog: [0.30, 0.38, 0.56], fogSeam: [0.06, 0.12, 0.22], desatTint: [0.76, 0.84, 0.96],
  shadow: { col: [0.40, 0.46, 0.66], strength: 0.5, len: 0.75 },
  lamp: [0.62, 0.36, 0.12],
  ink: ink({
    ground: 0x96a2b4, asphalt: 0x4c4f58, dirt: 0x737b8c, gravel: 0x585d6b,
    roof: 0xbcc7d6, wall: 0x6f5850, wallB: 0x56606c, trim: 0x2c2e36,
    concrete: 0x868d98, crate: 0x8a6e4c, crateD: 0x4e3e2c,
    rail: 0x9aa4b2, tie: 0x3b3431, hazardY: 0xa8892f, hazardK: 0x22252c,
    paint: 0xc0c6cc, glow: 0xffbe6c, glowCool: 0xc8e0ff,
    snow: 0xd2dce8, snowD: 0xa9b6c8, ice: 0x8db2d2, coal: 0x2a2a2e, timber: 0x4a3a2e,
  }),
  containers: [0x7a3a2e, 0x3e566a, 0x5f524a, 0x6a6236, 0x34503f],
  weather: { fields: [
    { kind: 'mote', count: 280, box: [40, 12, 32], vel: [1.6, -2.4, 0.5], size: 0.11, col: [0.92, 0.96, 1.0], alpha: 0.75 },
    { kind: 'streak', count: 110, box: [38, 4, 30], vel: [7.5, -0.9, 1.2], len: 1.1, width: 0.022, col: [0.86, 0.92, 1.0], alpha: 0.22 },
    { kind: 'mote', count: 18, box: [44, 3, 34], vel: [3.2, 0.02, 0.6], size: 3.4, col: [0.78, 0.86, 0.98], alpha: 0.05 },
  ] },
};

// Unfinished tower top at sunset: the sun low in the west, long shadows across the slab, the city a long way down.
THEMES.topside = {
  id: 'topside',
  light: { dir: norm([-0.84, 0.42, 0.34]), sun: [1.08, 0.66, 0.38], sky: [0.36, 0.34, 0.45], amb: [0.29, 0.27, 0.32] },
  clear: 0x1c1420,
  fog: [0.50, 0.42, 0.58], fogSeam: [0.26, 0.11, 0.05], desatTint: [0.88, 0.78, 0.86],
  shadow: { col: [0.44, 0.34, 0.52], strength: 0.68, len: 1.45 },
  lamp: [0.22, 0.15, 0.06],
  void: true,                  // Water rects are holes in the slab, not water.
  ink: ink({
    ground: 0x8e8a84, asphalt: 0x7b7772, dirt: 0x958a76, gravel: 0x6e6a68,
    roof: 0x6a6e76, wall: 0x9d958b, wallB: 0x868079, trim: 0x3d393c,
    concrete: 0x9a958e, crate: 0x9a7a4c, crateD: 0x5c4a30,
    rail: 0x8a8f96, tie: 0x3f3530, hazardY: 0xd2a030, hazardK: 0x26242a,
    paint: 0xd8c8a0, glow: 0xffd49a, glowCool: 0xcfe0ff,
    steel: 0x56606c, steelD: 0x363c46, primer: 0xa4522e, tarp: 0x2f6494, board: 0xd6cfc2, rebar: 0x6e4634,
    brick: 0x9a5038, crane: 0xd49a1e, glass: 0x2a3446,
  }),
  containers: [0x3e6a8a, 0x8a4634, 0xa8853c],
  weather: { fields: [
    { kind: 'mote', count: 110, box: [40, 7, 32], vel: [3.2, 0.25, 0.9], size: 0.1, col: [1.0, 0.78, 0.5], alpha: 0.45 },
    { kind: 'streak', count: 50, box: [38, 3, 30], vel: [12, 0.1, 2.2], len: 2.2, width: 0.02, col: [0.98, 0.84, 0.66], alpha: 0.14 },
  ] },
};

// Flooded sea temple on a tidal shore (region: coast), a grey, steaming morning: soft high light, drizzle on the moat,
// palms along the beach to the south and the old forest only behind the pyramid. The moat is sea-green tidewater.
THEMES.sunken = {
  id: 'sunken',
  light: { dir: norm([-0.3, 0.86, 0.42]), sun: [0.54, 0.57, 0.46], sky: [0.36, 0.42, 0.39], amb: [0.26, 0.29, 0.27] },
  clear: 0x111b16,
  fog: [0.38, 0.50, 0.46], fogSeam: [0.08, 0.18, 0.10], desatTint: [0.78, 0.86, 0.80],
  shadow: { col: [0.34, 0.44, 0.38], strength: 0.56, len: 0.6 },
  lamp: [0.34, 0.22, 0.08],
  wet: 0.45, sheen: norm([0.1, 0.9, -0.42]), sheenCol: [0.42, 0.52, 0.46],
  water: { deep: [0.03, 0.11, 0.11], shallow: [0.09, 0.24, 0.22], glint: [0.56, 0.74, 0.7] },
  ink: ink({
    ground: 0x6e6a50, sand: 0x8c8466, asphalt: 0x6e6d62, dirt: 0x4f4536, gravel: 0x67665a,
    roof: 0x55604a, wall: 0x7a7a66, wallB: 0x6a705c, trim: 0x383a30,
    concrete: 0x878774, crate: 0x7a6044, crateD: 0x4a3a28,
    rail: 0x6a6a60, tie: 0x3a3228, hazardY: 0x9a8a40, hazardK: 0x262a22,
    paint: 0xb0b090, glow: 0xffae5a, glowCool: 0xcfe8d0,
    rock: 0x7f7c6c, rockD: 0x625f52, rockL: 0x9a9684, moss: 0x52653a, mossD: 0x3c4c2c,
    leaf: 0x3a5a2c, leafD: 0x2a4022, bark: 0x5a4a38, vine: 0x4a7a36, bloom: 0xc84a6a,
  }),
  containers: [0x5a5a44, 0x4a5a4a, 0x6a5a40],
  weather: { fields: [
    { kind: 'rain', count: 170, box: [36, 14, 28], vel: [-0.8, -14, 0.8], len: 0.6, width: 0.012, col: [0.78, 0.88, 0.82], alpha: 0.2 },
    { kind: 'ripple', count: 60, box: [34, 1, 26], life: 0.7, size: 0.55, col: [0.75, 0.88, 0.8], alpha: 0.26 },
    { kind: 'mote', count: 46, box: [36, 4, 28], vel: [0.25, 0.18, 0.1], size: 0.09, col: [0.9, 1.0, 0.55], alpha: 0.7 },
    { kind: 'mote', count: 22, box: [44, 3, 34], vel: [0.7, 0.03, 0.25], size: 3.6, col: [0.72, 0.84, 0.78], alpha: 0.06 },
  ] },
};

// Farming valley on a clear autumn morning: low gold sun from the east, long shadows west, a haze over the fields.
// The barns are an old oxblood and the tractors a faded green, both kept dull so neither reads as a team colour.
THEMES.harvest = {
  id: 'harvest',
  light: { dir: norm([0.66, 0.5, 0.46]), sun: [1.04, 0.80, 0.52], sky: [0.42, 0.45, 0.54], amb: [0.31, 0.30, 0.32] },
  clear: 0x2e3330,
  fog: [0.44, 0.48, 0.54], fogSeam: [0.20, 0.13, 0.04], desatTint: [0.88, 0.86, 0.8],
  shadow: { col: [0.40, 0.40, 0.54], strength: 0.62, len: 1.3 },
  lamp: [0.3, 0.2, 0.08],
  water: { deep: [0.07, 0.11, 0.1], shallow: [0.16, 0.22, 0.18], glint: [0.85, 0.78, 0.58] },
  ink: ink({
    ground: 0x857a5e, asphalt: 0x786c58, dirt: 0x6a5e4a, gravel: 0x807868,
    roof: 0x4c4f58, wall: 0xc2b7a0, wallB: 0xb3a98f, trim: 0x3c332b,
    concrete: 0xaba392, crate: 0x9a7a4c, crateD: 0x5c4a30,
    rail: 0x7f8690, tie: 0x3f3530, hazardY: 0xa8873a, hazardK: 0x2a2620,
    paint: 0xd8cfb0, glow: 0xffd89a, glowCool: 0xd4e6ff,
    wheat: 0x9a8a60, wheatD: 0x887a54, earth: 0x655748, earthD: 0x54483b, grass: 0x666d50, grassD: 0x565c44,
    hedge: 0x46603a, hedgeD: 0x334a2c, hedgeL: 0x5c7444, hay: 0xb8a170, hayD: 0x988456,
    stone: 0x9d9686, stoneD: 0x7a7365, plank: 0x7a3c30, plankD: 0x55291f, timber: 0x6a5039, timberD: 0x4a382a,
    slate: 0x4a4e58, white: 0xd2cab6, vine: 0x5c7a38, vineD: 0x405a2a, grape: 0x553049,
    tractor: 0x52703e, tyre: 0x26241f, steel: 0x6e737a, rust: 0x8a5a3a, reed: 0x7c8a4c, bark: 0x5a4636, leaf: 0x58703c,
  }),
  containers: [0x7a4a36, 0x5a6a44, 0x8a7a4a],
  weather: { fields: [
    { kind: 'mote', count: 110, box: [42, 6, 32], vel: [-0.6, 0.15, 0.3], size: 0.09, col: [1.0, 0.86, 0.55], alpha: 0.55 },
    { kind: 'streak', count: 40, box: [40, 3, 30], vel: [-5, 0.05, 1.0], len: 1.4, width: 0.02, col: [0.95, 0.85, 0.6], alpha: 0.12 },
    { kind: 'mote', count: 20, box: [48, 2.5, 36], vel: [-0.8, 0.02, 0.2], size: 4.2, col: [0.86, 0.86, 0.8], alpha: 0.05 },
    { kind: 'leaf', count: 22, box: [42, 7, 32], vel: [-0.9, -0.5, 0.3], size: 0.5, col: [0.96, 0.66, 0.28], alpha: 0.92 },
  ] },
};

export const getTheme = id => THEMES[id] || THEMES.railyard;

// Railyard defaults, kept for anything that wants them statically.
export const SUN_DIR = THEMES.railyard.light.dir;
export const SUN_COL = THEMES.railyard.light.sun;
export const SKY_COL = THEMES.railyard.light.sky;
export const AMB_COL = THEMES.railyard.light.amb;

// Light arriving at a face with normal n; used to bake the static world on the CPU.
export function lightAt(nx, ny, nz, light = THEMES.railyard.light) {
  const sun = Math.max(0, nx * light.dir[0] + ny * light.dir[1] + nz * light.dir[2]);
  const sky = 0.5 + 0.5 * ny;
  return [
    light.amb[0] + light.sky[0] * sky + light.sun[0] * sun,
    light.amb[1] + light.sky[1] * sky + light.sun[1] * sun,
    light.amb[2] + light.sky[2] * sky + light.sun[2] * sun,
  ];
}

const v3 = c => `vec3(${c[0].toFixed(3)},${c[1].toFixed(3)},${c[2].toFixed(3)})`;

function lightGLSL(l) {
  return /* glsl */`
vec3 duskLight(vec3 n) {
  float sun = max(0.0, dot(n, ${v3(l.dir)}));
  float sky = 0.5 + 0.5 * n.y;
  return ${v3(l.amb)} + ${v3(l.sky)} * sky + ${v3(l.sun)} * sun;
}`;
}

// Vertex-stage version of lightAt, named duskLight for every map. The include resolves when a program
// compiles, and a program is compiled per WebGLRenderer, so one match's theme lights everything it draws.
THREE.ShaderChunk.sw_light = lightGLSL(THEMES.railyard.light);
export const GLSL_LIGHT = /* glsl */`
#include <sw_light>
`;

// GameRenderer calls this before it creates any material; dispose restores the default for the menus.
export function setThemeLighting(themeId) {
  THREE.ShaderChunk.sw_light = lightGLSL(getTheme(themeId).light);
}

// Screen-door fade so characters can fade in and out while staying in the opaque queue.
// Interleaved gradient noise: cheaper than a Bayer lookup and hides the pattern better while moving.
export const GLSL_DITHER = /* glsl */`
float screenDither(vec2 fc) {
  return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
}`;
