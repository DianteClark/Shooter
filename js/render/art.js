// Shared art direction: dusk lighting rig and the GLSL snippets every material uses.
// All shaders output display-referred colour directly (no tone map, no sRGB encode pass), so a hex
// colour written here is what lands on screen after lighting. That is what keeps the palette exact.

export function hexRGB(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Low sun in the south-west: warm on the faces the camera sees, long shadows falling up-right on screen.
export const SUN_DIR = norm([-0.58, 0.56, 0.60]);
export const SUN_COL = [1.02, 0.70, 0.44];
export const SKY_COL = [0.40, 0.38, 0.56];     // Cool fill from above.
export const AMB_COL = [0.30, 0.28, 0.36];     // Everything, including faces turned away from the sun.

// Light arriving at a face with normal n; used to bake the static world on the CPU.
export function lightAt(nx, ny, nz) {
  const sun = Math.max(0, nx * SUN_DIR[0] + ny * SUN_DIR[1] + nz * SUN_DIR[2]);
  const sky = 0.5 + 0.5 * ny;
  return [
    AMB_COL[0] + SKY_COL[0] * sky + SUN_COL[0] * sun,
    AMB_COL[1] + SKY_COL[1] * sky + SUN_COL[1] * sun,
    AMB_COL[2] + SKY_COL[2] * sky + SUN_COL[2] * sun,
  ];
}

const v3 = c => `vec3(${c[0].toFixed(3)},${c[1].toFixed(3)},${c[2].toFixed(3)})`;

// Vertex-stage version of lightAt. On non-indexed flat geometry per-vertex equals per-face.
export const GLSL_LIGHT = /* glsl */`
vec3 duskLight(vec3 n) {
  float sun = max(0.0, dot(n, ${v3(SUN_DIR)}));
  float sky = 0.5 + 0.5 * n.y;
  return ${v3(AMB_COL)} + ${v3(SKY_COL)} * sky + ${v3(SUN_COL)} * sun;
}`;

// Screen-door fade so characters can fade in and out while staying in the opaque queue.
// Interleaved gradient noise: cheaper than a Bayer lookup and hides the pattern better while moving.
export const GLSL_DITHER = /* glsl */`
float screenDither(vec2 fc) {
  return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
}`;
