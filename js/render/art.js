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
