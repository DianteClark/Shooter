// Procedural animation data: reload tracks per weapon family, and the two-bone solver the limbs use.
// A reload is authored as a list of key poses over progress 0..1 and sampled into a shared array,
// so a soldier mid-reload costs a few multiplies and allocates nothing.
import { fillGaps, reloadLike } from './feel.js';

import { fillV10 } from '../shared/weapons-v10.js';

// Row layout of a track. Gun offsets are in upper-body space; the hand target is in gun space.
export const T = { U: 0, DX: 1, DY: 2, DZ: 3, ROLL: 4, YAW: 5, PITCH: 6, HX: 7, HY: 8, HZ: 9, W: 10, MAG: 11 };
const STRIDE = 12;

// Keys are [u, dx, dy, dz, roll, yaw, pitch, handX, handY, handZ, handWeight, magInHand].
// handWeight 0 leaves the support hand on the gun's fore point.
function track(keys) {
  const data = new Float32Array(keys.length * STRIDE);
  keys.forEach((k, i) => data.set(k, i * STRIDE));
  return { data, n: keys.length };
}

const RIFLE = track([
  [0.00,  0,     0,    0,     0,    0,     0,      0.12, -0.30,  0.00, 0, 0],
  [0.10,  0,    -0.10, 0.02,  0.75, -0.10, -0.25,  0.12, -0.32, -0.02, 1, 0],
  [0.24,  0,    -0.12, 0.02,  0.85, -0.10, -0.30,  0.12, -0.64, -0.06, 1, 1],
  [0.30,  0,    -0.12, 0.02,  0.85, -0.10, -0.30,  0.04, -0.72, -0.20, 1, 0],
  [0.46,  0,    -0.13, 0.02,  0.80, -0.12, -0.32, -0.30, -0.72, -0.40, 1, 1],
  [0.64,  0,    -0.12, 0.02,  0.78, -0.10, -0.28,  0.14, -0.64, -0.04, 1, 1],
  [0.72,  0,    -0.09, 0.02,  0.74, -0.10, -0.22,  0.12, -0.30,  0.00, 1, 1],
  [0.76,  0.02, -0.16, 0.02,  0.66, -0.10, -0.30,  0.12, -0.26,  0.00, 1, 0],
  [0.86,  0,    -0.06, 0.02,  0.38, -0.06, -0.08, -0.02,  0.24, -0.14, 1, 0],
  [0.93, -0.03, -0.05, 0.02,  0.32, -0.06, -0.05, -0.34,  0.24, -0.14, 1, 0],
  [1.00,  0,     0,    0,     0,    0,     0,      0.12, -0.30,  0.00, 0, 0],
]);

const BOLT = track([
  [0.00,  0,     0,    0,     0,    0,     0,      0.12, -0.30,  0.00, 0, 0],
  [0.12,  0,    -0.08, 0.02,  0.62, -0.08, -0.12,  0.12, -0.32, -0.02, 1, 0],
  [0.24,  0,    -0.10, 0.02,  0.72, -0.08, -0.18,  0.10, -0.62, -0.06, 1, 1],
  [0.44,  0,    -0.10, 0.02,  0.72, -0.08, -0.18, -0.30, -0.72, -0.36, 1, 1],
  [0.60,  0,    -0.10, 0.02,  0.70, -0.08, -0.16,  0.12, -0.62, -0.04, 1, 1],
  [0.68,  0.02, -0.15, 0.02,  0.62, -0.08, -0.22,  0.12, -0.28,  0.00, 1, 0],
  [0.80,  0,    -0.02, 0.00,  0.10,  0.00,  0.18, -0.06,  0.20,  0.20, 1, 0],
  [0.88, -0.04, -0.02, 0.00,  0.12,  0.00,  0.20, -0.42,  0.20,  0.20, 1, 0],
  [0.94,  0.02, -0.02, 0.00,  0.06,  0.00,  0.12, -0.06,  0.20,  0.20, 1, 0],
  [1.00,  0,     0,    0,     0,    0,     0,      0.12, -0.30,  0.00, 0, 0],
]);

const SIDE_MAG = track([
  [0.00,  0,     0,    0,     0,    0,     0,      0.12,  0.13, -0.62, 0, 0],
  [0.12,  0,    -0.04, 0.06, -0.50,  0.18,  0.00,  0.12,  0.13, -0.62, 1, 0],
  [0.26,  0,    -0.04, 0.08, -0.58,  0.20,  0.00,  0.12,  0.13, -1.02, 1, 1],
  [0.32,  0,    -0.05, 0.08, -0.58,  0.20, -0.02,  0.02, -0.14, -0.86, 1, 0],
  [0.50,  0,    -0.06, 0.08, -0.54,  0.20, -0.04, -0.20, -0.42, -0.72, 1, 1],
  [0.68,  0,    -0.04, 0.08, -0.56,  0.20,  0.00,  0.12,  0.13, -0.98, 1, 1],
  [0.76,  0,    -0.03, 0.12, -0.50,  0.18,  0.00,  0.12,  0.13, -0.62, 1, 0],
  [0.88,  0,     0.00, 0.03, -0.14,  0.05,  0.05,  0.10,  0.30, -0.10, 1, 0],
  [0.94, -0.03,  0.00, 0.03, -0.10,  0.05,  0.05, -0.22,  0.30, -0.10, 1, 0],
  [1.00,  0,     0,    0,     0,    0,     0,      0.12,  0.13, -0.62, 0, 0],
]);

const TOP_MAG = track([
  [0.00,  0,     0,    0,     0,    0,     0,      0.10,  0.36, -0.02, 0, 0],
  [0.12,  0,    -0.10, 0.02,  0.25, -0.04, -0.20,  0.10,  0.36, -0.02, 1, 0],
  [0.26,  0,    -0.12, 0.02,  0.30, -0.04, -0.24,  0.10,  0.82, -0.10, 1, 1],
  [0.34,  0,    -0.12, 0.02,  0.30, -0.04, -0.24, -0.08,  0.50, -0.42, 1, 0],
  [0.50,  0,    -0.12, 0.02,  0.28, -0.04, -0.24, -0.25,  0.34, -0.55, 1, 1],
  [0.68,  0,    -0.12, 0.02,  0.28, -0.04, -0.22,  0.10,  0.76, -0.05, 1, 1],
  [0.76,  0,    -0.17, 0.02,  0.28, -0.04, -0.30,  0.10,  0.36, -0.02, 1, 0],
  [0.92,  0,    -0.02, 0.01,  0.05,  0.00, -0.04,  0.10,  0.36, -0.02, 1, 0],
  [1.00,  0,     0,    0,     0,    0,     0,      0.10,  0.36, -0.02, 0, 0],
]);

const LMG = track([
  [0.00,  0,     0,    0,     0,    0,     0,      0.15,  0.36, -0.10, 0, 0],
  [0.06,  0,    -0.22, 0.02,  0.14,  0.00, -0.18,  0.15,  0.36, -0.10, 1, 0],
  [0.14,  0,    -0.25, 0.02,  0.16,  0.00, -0.20,  0.15,  0.60, -0.05, 1, 0],
  [0.24,  0,    -0.26, 0.04,  0.24,  0.00, -0.20,  0.15,  0.04, -0.46, 1, 0],
  [0.32,  0,    -0.26, 0.04,  0.28,  0.00, -0.20,  0.10, -0.24, -0.88, 1, 1],
  [0.50,  0,    -0.27, 0.04,  0.26,  0.00, -0.20, -0.20, -0.55, -0.70, 1, 1],
  [0.66,  0,    -0.26, 0.04,  0.26,  0.00, -0.20,  0.15, -0.06, -0.72, 1, 1],
  [0.74,  0.02, -0.31, 0.04,  0.24,  0.00, -0.26,  0.15,  0.04, -0.46, 1, 0],
  [0.83,  0,    -0.25, 0.03,  0.14,  0.00, -0.20,  0.15,  0.60, -0.05, 1, 0],
  [0.90,  0.02, -0.32, 0.03,  0.12,  0.00, -0.28,  0.15,  0.30, -0.05, 1, 0],
  [0.96,  0,    -0.08, 0.01,  0.03,  0.00, -0.06,  0.15,  0.36, -0.10, 1, 0],
  [1.00,  0,     0,    0,     0,    0,     0,      0.15,  0.36, -0.10, 0, 0],
]);

const PISTOL = track([
  [0.00,  0,     0,    0,     0,    0,     0,     -0.06, -0.36, -0.02, 0, 0],
  [0.12, -0.04,  0.02, 0.00,  0.45,  0.00,  0.55, -0.06, -0.38, -0.02, 1, 0],
  [0.26, -0.04,  0.02, 0.00,  0.50,  0.00,  0.60, -0.10, -0.72, -0.18, 1, 0],
  [0.48, -0.04,  0.00, 0.00,  0.46,  0.00,  0.50, -0.24, -0.72, -0.36, 1, 1],
  [0.66, -0.04,  0.00, 0.00,  0.46,  0.00,  0.45, -0.06, -0.62, -0.04, 1, 1],
  [0.74, -0.02, -0.06, 0.00,  0.40,  0.00,  0.36, -0.06, -0.36, -0.02, 1, 0],
  [0.86,  0.00,  0.02, 0.00,  0.20,  0.00,  0.25,  0.14,  0.26, -0.04, 1, 0],
  [0.93, -0.03,  0.02, 0.00,  0.18,  0.00,  0.22, -0.12,  0.26, -0.04, 1, 0],
  [1.00,  0,     0,    0,     0,    0,     0,     -0.06, -0.36, -0.02, 0, 0],
]);

const REVOLVER = track([
  [0.00,  0,     0,    0,     0,    0,     0,      0.18,  0.02, -0.20, 0, 0],
  [0.10, -0.04,  0.05, 0.00,  0.95,  0.00,  0.95,  0.18,  0.02, -0.20, 1, 0],
  [0.22, -0.06,  0.12, 0.00,  1.00,  0.00,  1.25,  0.18,  0.02, -0.20, 1, 0],
  [0.42, -0.04,  0.04, 0.00,  0.95,  0.00,  1.00, -0.22, -0.70, -0.40, 1, 1],
  [0.62, -0.04,  0.04, 0.00,  0.92,  0.00,  0.80,  0.16,  0.02, -0.24, 1, 1],
  [0.76, -0.04,  0.02, 0.00,  0.90,  0.00,  0.70,  0.16,  0.02, -0.18, 1, 0],
  [0.86,  0.00,  0.05, 0.00, -0.16,  0.00,  0.12,  0.18,  0.02, -0.20, 1, 0],
  [1.00,  0,     0,    0,     0,    0,     0,      0.18,  0.02, -0.20, 0, 0],
]);

const TUBE = track([
  [0.00,  0,     0,    0,     0,    0,     0,      0.46, -0.16,  0.00, 0, 0],
  [0.10,  0,    -0.35, 0.10,  0.10,  0.00, -0.55,  0.46, -0.16,  0.00, 0, 0],
  [0.30,  0,    -0.38, 0.10,  0.14,  0.00, -0.58, -0.60, -0.30, -0.35, 1, 1],
  [0.55,  0,    -0.38, 0.10,  0.14,  0.00, -0.58, -1.25,  0.20,  0.00, 1, 1],
  [0.74,  0.03, -0.42, 0.10,  0.14,  0.00, -0.62, -0.42,  0.20,  0.00, 1, 0],
  [0.90,  0,    -0.06, 0.02,  0.02,  0.00, -0.08,  0.46, -0.16,  0.00, 0, 0],
  [1.00,  0,     0,    0,     0,    0,     0,      0.46, -0.16,  0.00, 0, 0],
]);

// One shell, repeated for as long as the tube needs filling; the loop posture holds across all of them.
export const SHELL_CYCLE = track([
  [0.00,  0, -0.07, 0.02, 0.85, -0.08, 0.20, -0.26, -0.56, -0.34, 1, 1],
  [0.56,  0, -0.07, 0.02, 0.85, -0.08, 0.20,  0.10,  0.08,  0.20, 1, 1],
  [0.72,  0, -0.12, 0.02, 0.82, -0.08, 0.14,  0.10,  0.05,  0.14, 1, 0],
  [1.00,  0, -0.07, 0.02, 0.85, -0.08, 0.20, -0.26, -0.56, -0.34, 1, 1],
]);

// What the support hand carries (drawn with the shared box mesh) and when the old one leaves the gun.
const BOX_MAG = { size: [0.13, 0.42, 0.09], rgb: [0.15, 0.16, 0.19], drop: 0.2 };
export const RELOADS = {
  ar:       { track: RIFLE, mag: BOX_MAG },
  burst:    { track: RIFLE, mag: BOX_MAG },
  dmr:      { track: RIFLE, mag: { size: [0.14, 0.3, 0.09], rgb: BOX_MAG.rgb, drop: 0.2 } },
  sniper:   { track: BOLT, mag: { size: [0.16, 0.26, 0.1], rgb: BOX_MAG.rgb, drop: 0.2 } },
  smg:      { track: SIDE_MAG, mag: { size: [0.11, 0.11, 0.5], rgb: BOX_MAG.rgb, drop: 0.22 } },
  pdw:      { track: TOP_MAG, mag: { size: [0.46, 0.09, 0.15], rgb: BOX_MAG.rgb, drop: 0.22 } },
  lmg:      { track: LMG, mag: { size: [0.46, 0.46, 0.28], rgb: [0.2, 0.22, 0.2], drop: 0.28 } },
  autoshot: { track: RIFLE, mag: { size: [0.42, 0.42, 0.22], rgb: [0.22, 0.2, 0.17], drop: 0.2 } },
  pistol:   { track: PISTOL, mag: { size: [0.1, 0.3, 0.07], rgb: BOX_MAG.rgb, drop: 0.2 } },
  revolver: { track: REVOLVER, mag: { size: [0.16, 0.16, 0.16], rgb: [0.5, 0.42, 0.22], drop: -1, dump: 0.2 } },
  launcher: { track: TUBE, mag: { size: [0.8, 0.17, 0.17], rgb: [0.3, 0.34, 0.24], drop: -1 } },
  shotgun:  { track: null, mag: { size: [0.2, 0.09, 0.09], rgb: [0.72, 0.13, 0.1], drop: -1 } },
  // Wave 5. track null is a shell-by-shell loader (SHELL_CYCLE repeated); dump spills dumpN casings of dumpKind.
  heavyar:  { track: RIFLE, mag: { size: [0.14, 0.4, 0.1], rgb: BOX_MAG.rgb, drop: 0.2 } },
  tacsmg:   { track: RIFLE, mag: { size: [0.11, 0.34, 0.08], rgb: BOX_MAG.rgb, drop: 0.2 } },
  battle:   { track: RIFLE, mag: { size: [0.14, 0.48, 0.09], rgb: BOX_MAG.rgb, drop: 0.2 } },
  coach:    { track: REVOLVER, mag: { size: [0.2, 0.09, 0.09], rgb: [0.72, 0.13, 0.1], drop: -1, dump: 0.2, dumpN: 2, dumpKind: 'hull' } },
  saw:      { track: LMG, mag: { size: [0.3, 0.3, 0.22], rgb: [0.2, 0.22, 0.2], drop: 0.28 } },
  rotary:   { track: LMG, mag: { size: [0.42, 0.36, 0.3], rgb: [0.24, 0.26, 0.2], drop: 0.28 } },
  lever:    { track: null, mag: { size: [0.16, 0.06, 0.06], rgb: [0.9, 0.7, 0.3], drop: -1 } },
  antimat:  { track: BOLT, mag: { size: [0.18, 0.3, 0.12], rgb: BOX_MAG.rgb, drop: 0.2 } },
  semisnipe:{ track: BOLT, mag: { size: [0.15, 0.24, 0.1], rgb: BOX_MAG.rgb, drop: 0.2 } },
  machpistol:{ track: PISTOL, mag: { size: [0.1, 0.4, 0.07], rgb: BOX_MAG.rgb, drop: 0.2 } },
  deuce:    { track: PISTOL, mag: { size: [0.1, 0.32, 0.07], rgb: BOX_MAG.rgb, drop: 0.2 } },
  thumper:  { track: REVOLVER, mag: { size: [0.2, 0.2, 0.2], rgb: [0.35, 0.42, 0.28], drop: -1, dump: 0.2, dumpN: 4, dumpKind: 'magnum' } },
  // V8. The slug gun and crossbow load one at a time (a slug, a bolt); the scattergun breaks open like the Doublet.
  carbine:  { track: RIFLE, mag: { size: [0.12, 0.36, 0.09], rgb: BOX_MAG.rgb, drop: 0.2 } },
  heavysmg: { track: RIFLE, mag: { size: [0.12, 0.42, 0.1], rgb: BOX_MAG.rgb, drop: 0.2 } },
  slug:     { track: null, mag: { size: [0.2, 0.09, 0.09], rgb: [0.85, 0.62, 0.2], drop: -1 } },
  lightlmg: { track: LMG, mag: { size: [0.34, 0.36, 0.26], rgb: [0.2, 0.22, 0.2], drop: 0.28 } },
  crossbow: { track: null, mag: { size: [0.5, 0.04, 0.04], rgb: [0.9, 0.85, 0.7], drop: -1 } },
  scatter:  { track: REVOLVER, mag: { size: [0.16, 0.08, 0.08], rgb: [0.72, 0.13, 0.1], drop: -1, dump: 0.2, dumpN: 1, dumpKind: 'hull' } },
};
fillV10(RELOADS, 'reload');   // V10 guns reload like their nearest older gun.

// A gun with no entry (a new one) reloads like the gun it names in `feel.like`, or like its class: see feel.js.
fillGaps(RELOADS, (id, def, cls) => RELOADS[reloadLike(id, def, cls)]);

const sstep = t => t * t * (3 - 2 * t);

// Writes the pose at u (0..1) into out. Returns nothing, allocates nothing.
export function sampleTrack(tr, u, out) {
  const d = tr.data, n = tr.n;
  let i = 0;
  while (i < n - 2 && d[(i + 1) * STRIDE] <= u) i++;
  const a = i * STRIDE, b = a + STRIDE;
  const span = d[b] - d[a];
  const k = span > 1e-5 ? sstep(Math.min(1, Math.max(0, (u - d[a]) / span))) : 1;
  for (let f = 1; f < 11; f++) out[f] = d[a + f] + (d[b + f] - d[a + f]) * k;
  out[T.MAG] = d[b + T.MAG] > 0.5 && d[a + T.MAG] > 0.5 ? 1 : (k < 0.5 ? d[a + T.MAG] : d[b + T.MAG]);
}

// Two-bone IK. Solves the mid joint between a and b for bone lengths l1, l2, bending toward pole (px,py,pz).
// Results land in out[0..2]; a reach beyond the bones scales them, so a hand never leaves the gun.
export function solveJoint(ax, ay, az, bx, by, bz, l1, l2, px, py, pz, out) {
  let dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1e-4);
  dx /= d; dy /= d; dz /= d;
  const reach = l1 + l2;
  const s = d > reach * 0.998 ? d / (reach * 0.998) : 1;
  const L1 = l1 * s, L2 = l2 * s;
  const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
  const dot = px * dx + py * dy + pz * dz;
  let ox = px - dx * dot, oy = py - dy * dot, oz = pz - dz * dot;
  const ol = Math.sqrt(ox * ox + oy * oy + oz * oz) + 1e-6;
  ox /= ol; oy /= ol; oz /= ol;
  out[0] = ax + dx * along + ox * h;
  out[1] = ay + dy * along + oy * h;
  out[2] = az + dz * along + oz * h;
}
