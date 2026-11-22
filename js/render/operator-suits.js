// Operators remade (ROADMAP item 49, docs/OPERATORS-ART.md): the active-skin effects every Elite skin wears, a showpiece
// suit for every operator's Mastery skin, and the suits' distance versions.
//
//   SKIN_FX_GLSL    skinFx(c, k, p, a): effect k of operators.js SKIN_FX over a fragment of plain gear (characters.js)
//   farSuitBuilder  a MeshBuilder that records each piece and cuts the suit to its biggest ones (`cut(budget)`)
//   SUITS           (operator-kit.js) gets every suit below added to the pilot's bear and mech
//
// Suit frames are operator-kit.js's: forward +X, up +Y, the wearer's left +Z; torso origin at the hips (chest top ~0.62),
// head origin at the top of the chest (a face's front at x ~0.17). Plain part-0 pieces take the skin's gear colour, KEEP
// pieces keep theirs, ACC pieces take the accent and glow, TONE pieces the operator's skin tone, part 1 the team colour.
import * as THREE from 'three';
import { MeshBuilder } from './meshbuild.js';
import { ACC, KEEP, TONE, LOCKS, SUITS, tag, seg, plate } from './operator-kit.js';
import { W5_SUITS } from './operator-suits-w5.js';     // The wave 5 operators' suits.

/* ---------- Active skins ---------- */
// skinFx(c, k, p, a) colours a fragment of gear wearing effect k (operators.js SKIN_FX): c is the lit colour, p the object
// position (metres), a the skin's accent; vLight and uTime come from CHAR_FRAG. 1-3 are the pilot's own code; 4.. are
// rows of FX_ROWS run by fxUber().
// One parametric effect, fixed cost: every branch of a shader is paid by every fragment on a software renderer (and
// grows the register budget on a phone GPU), so effects 4.. are rows of numbers for fxUber() rather than code of their
// own. A row: a band pattern (direction in cycles per metre, or rings out of the chest, or a turn round the body, or a
// grid of two), warped and scrolled; a hash grid of cells, lit, twinkling or reshuffling; how they mix and colour.
//   dir [x, y, z] cycles/m (mode 1: rings per metre in x; mode 2: sweeps per turn in x, cycles/m up in y)
//   speed cycles/s, warp [amount, frequency], sharp (pow; < 0 hard stripes), band (weight),
//   cells [per metre, share lit (1: shade by hash), twinkle /s (< 0 reshuffle /s), climb m/s], cell (weight),
//   both (weight of band x cells), pal (0 accent, 1 fire, 2 prism, 3 thermal, 4 white), base (gear kept), gain,
//   amb (accent wash), mode (0 along dir, 1 rings, 2 turning, 3 grid, 4 chevron: |z|), step (time steps /s: jumps
//   the warp and flickers), beat (a pulse /s on the gain)
const FX_ROWS = {
  flame: { dir: [0, 3.2, 0], speed: 1.6, warp: [0.25, 12], sharp: 2.5, band: 1, pal: 1, base: 0.55, gain: 1.5 },
  frost: { dir: [1.5, 2.5, 1.0], speed: 0.1, warp: [0.3, 9], sharp: 10, band: 0.5, cells: [16, 0.12, 2.5, 0], cell: 1.1, pal: 4, base: 0.6, gain: 1, amb: 0.25 },
  glitch: { dir: [0, 40, 0], speed: 3, sharp: 1, band: 0.12, cells: [9, 0.25, -7, 0], cell: 0.9, pal: 2, base: 0.9, gain: 1, step: 7 },
  starfield: { dir: [0.6, 4, 3], speed: 0.3, warp: [0.4, 5], sharp: 2, band: 0.4, cells: [22, 0.07, 3, 0], cell: 1.4, pal: 0, base: 0.3, gain: 1, amb: 0.06 },
  lightning: { dir: [2.2, 0, 3.5], speed: 0, warp: [0.12, 17], sharp: 14, band: 2.2, pal: 4, base: 0.8, gain: 1, amb: 0.1, step: 9 },
  camo: { dir: [0, 0.7, 0], speed: 0.35, sharp: 12, band: 0.6, cells: [9, 1, -1.5, 0], cell: 0.45, pal: 0, base: 0.55, gain: 1 },
  lava: { dir: [0.4, 1.6, 0.6], speed: 0.1, warp: [0.8, 7], sharp: 16, band: 1.6, pal: 1, base: 0.45, gain: 1, amb: 0.08 },
  aurora: { dir: [1.2, 0, 1.6], speed: 0.4, warp: [0.4, 3], sharp: 3, band: 1.1, pal: 2, base: 0.55, gain: 1 },
  hex: { dir: [0, 9, 6], speed: 0.4, sharp: 18, band: 0.9, cells: [9, 0.15, 3, 0], cell: 0.4, pal: 0, base: 0.8, gain: 1, mode: 3 },
  void: { dir: [0.3, 1.4, 0.3], speed: 0.35, warp: [1.8, 6.5], sharp: 6, band: 1.1, cells: [26, 0.05, 2, 0], cell: 0.9, pal: 0, base: 0.15, gain: 1, amb: 0.08 },
  sparkle: { dir: [0.5, 0.5, 0.2], speed: 0.33, sharp: 14, band: 0.45, cells: [18, 0.16, 4, 0], cell: 1.6, pal: 4, base: 1.05, gain: 1, amb: 0.05 },
  caustics: { dir: [1.6, 1.4, 1.7], speed: 0.2, warp: [0.6, 10], sharp: 4, band: 1, pal: 0, base: 0.7, gain: 1, amb: 0.08 },
  radar: { dir: [1, 0, 0], speed: 0.45, sharp: 4, band: 1.4, cells: [5, 0.2, 2, 0], cell: 0.2, pal: 0, base: 0.75, gain: 1, mode: 2 },
  bubbles: { dir: [0, 1, 0], speed: 0.2, sharp: 2, band: 0.1, cells: [7, 0.4, 0, 0.2], cell: 1.2, pal: 0, base: 0.78, gain: 1, amb: 0.1 },
  coderain: { dir: [0, 0.9, 0], speed: -0.45, sharp: 5, band: 0.1, cells: [16, 0.5, -4, -0.25], cell: 0.15, both: 1.3, pal: 0, base: 0.45, gain: 1 },
  embers: { dir: [1.4, 0.8, 0], speed: 0.27, sharp: 1, band: 0.25, cells: [9, 0.3, 9, 0.3], cell: 2, pal: 1, base: 0.65, gain: 1 },
  hazard: { dir: [2.25, 4.5, 4.5], speed: 0.9, sharp: -1, band: 0.7, pal: 0, base: 0.55, gain: 1, mode: 4, beat: 1.2 },
  morse: { dir: [0, 11, 0], speed: 0, sharp: 4, band: 0.1, cells: [9, 0.5, -3, 0], both: 1.9, pal: 0, base: 0.78, gain: 1 },
  heartbeat: { dir: [1, 2.6, 0], speed: 0.35, sharp: 3, band: 1.6, pal: 0, base: 0.78, gain: 1, mode: 2, beat: 1 },
  thermal: { dir: [0, 0.64, 0], speed: 0.18, warp: [0.5, 6], sharp: 1, band: 0, pal: 3, base: 0.35, gain: 0, amb: 0.65 },
  sandstorm: { dir: [0.64, 0, -0.26], speed: 0.9, warp: [0.3, 18], sharp: 10, band: 1.5, cells: [40, 0.1, -6, 0], cell: 0.5, pal: 0, base: 0.75, gain: 1, amb: 0.12 },
  chevron: { dir: [3, 0.4, -2.5], speed: 1.4, sharp: 9, band: 1.2, pal: 0, base: 0.72, gain: 1, mode: 4 },
  ink: { dir: [0, 1, 0], speed: 0.1, warp: [0.5, 5], sharp: 28, band: 1.4, cells: [7, 1, -0.5, 0], cell: 0.15, pal: 0, base: 0.5, gain: 1 },
  checker: { dir: [7, 0, 7], speed: 0.1, sharp: -1, band: 0.7, pal: 0, base: 0.4, gain: 1, mode: 3 },
  clouds: { dir: [1, 0.5, 0.8], speed: 0.08, warp: [1, 5], sharp: 2, band: 0.7, pal: 4, base: 0.5, gain: 1, amb: 0.3 },
  snow: { dir: [0, 1, 0], speed: 0, sharp: 1, band: 0.05, cells: [10, 0.25, 0, -0.13], cell: 1, pal: 4, base: 0.8, gain: 1, amb: 0.1 },
  rays: { dir: [7, 0, 0], speed: 0.2, sharp: 3, band: 1.2, pal: 4, base: 0.85, gain: 1, amb: 0.08, mode: 2 },
  scan: { dir: [0, 0.75, 0], speed: 0.22, sharp: 10, band: 1.6, cells: [24, 0.12, 0, 0], cell: 0.3, pal: 0, base: 0.82, gain: 1 },
  smoke: { dir: [0.7, 0.8, 0.6], speed: 0.15, warp: [2, 6], sharp: 2, band: 0.55, pal: 0, base: 0.7, gain: 1, amb: 0.05 },
  harlequin: { dir: [3.5, 3.5, 3.5], speed: 0.06, sharp: -1, band: 0.75, pal: 0, base: 0.5, gain: 1, mode: 3 },
  tracer: { dir: [-0.3, 0, 1.4], speed: 2, sharp: 8, band: 0.3, cells: [14, 0.45, 0, 0], both: 2.2, pal: 1, base: 0.8, gain: 1 },
  shockwave: { dir: [3, 0, 0], speed: 1.3, sharp: 12, band: 1.4, pal: 0, base: 0.78, gain: 1, mode: 1 },
  // Wave 5 operators (js/ui/operators.js): a lamp's pulse, a seeker's heat swirl, oil on water, fireworks.
  pulsar: { dir: [4, 0, 0], speed: 2.2, sharp: 20, band: 1.6, pal: 4, base: 0.7, gain: 1, mode: 1, beat: 1 },
  plasma: { dir: [1.1, 1.7, 0.9], speed: 0.9, warp: [1.4, 9], sharp: 7, band: 1.3, pal: 2, base: 0.5, gain: 1.2, amb: 0.1 },
  oilslick: { dir: [0.8, 2.2, 1.4], speed: 0.15, warp: [0.9, 4], sharp: 1.5, band: 1, pal: 2, base: 0.35, gain: 1, amb: 0.2 },
  fireworks: { dir: [0, 1, 0], speed: 0, sharp: 1, band: 0.05, cells: [14, 0.3, -2.5, 0.2], cell: 1.4, pal: 2, base: 0.8, gain: 1, step: 4 },
};
// A beat is one pulse a second, carried as a negative gain.
const fxRow = r => {
  const d = r.dir ?? [0, 1, 0], w = r.warp ?? [0, 0], c = r.cells ?? [1, 0, 0, 0];
  return [d[0], d[1], d[2], r.speed ?? 0, w[0], w[1], r.sharp ?? 1, r.band ?? 0, c[0], c[1], c[2], c[3],
    r.cell ?? 0, r.both ?? 0, r.pal ?? 0, r.mode ?? 0, r.base ?? 1, (r.gain ?? 1) * (r.beat ? -1 : 1), r.amb ?? 0, r.step ?? 0];
};
const ROW = 5;     // vec4s a row
// SKIN_FX names in order (kept in step with js/ui/operators.js SKIN_FX: append only).
const FX_ORDER = ['flame', 'frost', 'glitch', 'starfield', 'lightning', 'camo', 'lava', 'aurora', 'hex', 'void', 'sparkle', 'caustics',
  'radar', 'bubbles', 'coderain', 'embers', 'hazard', 'morse', 'heartbeat', 'thermal', 'sandstorm', 'chevron', 'ink', 'checker',
  'clouds', 'snow', 'rays', 'scan', 'smoke', 'harlequin', 'tracer', 'shockwave', 'pulsar', 'plasma', 'oilslick', 'fireworks'];
const FX_FIRST = 4;
// The table is a uniform array, not a const one: a software renderer copies a dynamically indexed const array into
// every fragment's own memory. 180 vec4s of the fragment budget since wave 5 (WebGL 2 guarantees 224).
const FXT = FX_ORDER.flatMap(n => fxRow(FX_ROWS[n]));
export const FX_TABLE = Array.from({ length: FXT.length / 4 }, (_, i) => new THREE.Vector4(...FXT.slice(i * 4, i * 4 + 4)));

export const SKIN_FX_GLSL = /* glsl */`
float fxH3(vec3 q) { return fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
uniform vec4 FXT[${FXT.length / 4}];
vec3 fxUber(vec3 c, int i, vec3 p, vec3 a, float lum) {
  float t = uTime;
  vec4 A = FXT[i], B = FXT[i + 1], C = FXT[i + 2], D = FXT[i + 3], E = FXT[i + 4];
  float beat = E.y < 0.0 ? 1.0 : 0.0;
  float st = E.w > 0.0 ? floor(t * E.w) : 0.0;
  vec3 pz = D.w > 3.5 ? vec3(p.xy, abs(p.z)) : p;
  float u = dot(pz, A.xyz);
  if (D.w > 0.5 && D.w < 1.5) u = length(p - vec3(0.25, 0.4, 0.0)) * A.x;
  else if (D.w > 1.5 && D.w < 2.5) u = (atan(p.z, p.x) / 6.2832) * A.x + p.y * A.y;
  float u2 = A.y == 0.0 ? p.y * A.x : dot(p, vec3(A.x, -A.y, A.z));
  float w = B.x * sin(dot(p, vec3(B.y, B.y * 0.7, B.y * 0.9)) + t * 1.7 + st * 2.3);
  u += w - t * A.w + st * 0.37;
  u2 += w - t * A.w;
  float band;
  if (B.z < 0.0) {
    float s1 = step(0.5, fract(u));
    band = D.w > 2.5 && D.w < 3.5 ? abs(s1 - step(0.5, fract(u2))) : s1;
  } else {
    band = pow(0.5 + 0.5 * sin(u * 6.2832), B.z);
    if (D.w > 2.5 && D.w < 3.5) band = max(band, pow(0.5 + 0.5 * sin(u2 * 6.2832), B.z));
  }
  vec3 q = floor(vec3(p.x, p.y - t * C.w, p.z) * C.x);
  float h = fxH3(q + (C.z < 0.0 ? floor(t * -C.z) : 0.0) * vec3(1.7, 3.1, 0.7));
  float cell = C.y >= 1.0 ? h : step(1.0 - C.y, h) * (C.z > 0.0 ? 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * C.z + h * 40.0), 3.0) : 1.0);
  float m = band * B.w + cell * D.x + band * cell * D.y;
  float g = abs(E.y) * (beat > 0.0 ? 0.6 + 0.8 * pow(max(0.0, sin(t * beat * 6.2832)), 8.0) : 1.0);
  if (E.w > 0.0) g *= step(0.3, fract(sin(st * 12.9898) * 43758.5453));
  vec3 pal = a;
  if (D.z > 0.5 && D.z < 1.5) pal = mix(a, vec3(1.0, 0.9, 0.45), clamp(band * band, 0.0, 1.0));
  else if (D.z > 1.5 && D.z < 2.5) pal = 0.5 + 0.5 * cos(6.2832 * (u * 0.15 + t * 0.05 + vec3(0.0, 0.33, 0.67)));
  else if (D.z > 2.5 && D.z < 3.5) { float v = 0.5 + 0.5 * sin(u * 6.2832); pal = clamp(vec3(v * 2.2 - 0.6, v * 2.4 - 1.3, 0.9 - abs(v * 2.0 - 0.5) * 1.6), 0.0, 1.0) * (0.6 + 0.4 * lum); }
  else if (D.z > 3.5) pal = mix(vec3(0.92, 0.96, 1.0), a, 0.3);
  return c * E.x + pal * m * g + (D.z > 2.5 && D.z < 3.5 ? pal : a) * E.z;
}
vec3 skinFx(vec3 c, float k, vec3 p, vec3 a) {
  float t = uTime;
  float lum = dot(vLight, vec3(0.333));
  if (k > ${FX_FIRST - 0.5}) return fxUber(c, (int(k + 0.5) - ${FX_FIRST}) * ${ROW}, p, a, lum);
  if (k < 1.5) {                                           // 1 holo
    vec3 h = 0.55 + 0.45 * cos(6.2832 * (p.y * 1.7 + (p.x + p.z) * 0.9 + t * 0.3 + vec3(0.0, 0.33, 0.67)));
    float scan = smoothstep(0.82, 1.0, fract(p.y * 12.0 - t * 1.4));
    return mix(c, h * (0.35 + 0.65 * vLight), 0.6) + h * scan * 0.35;
  }
  if (k < 2.5) {                                           // 2 circuit
    vec3 q = p * 9.0;
    float row = floor(q.y);
    float hl = step(0.42, abs(fract(q.y) - 0.5));
    float vl = step(0.44, abs(fract(q.z + q.x + row * 0.37) - 0.5)) * step(0.5, fract(row * 0.618 + 0.2));
    float line = max(hl, vl);
    float pulse = pow(0.5 + 0.5 * sin(t * 3.2 - p.y * 11.0 + p.z * 3.0), 6.0);
    return c * 0.8 + a * line * (0.3 + 1.3 * pulse);
  }
  float w = sin(p.y * 16.0 + sin(p.x * 11.0 + p.z * 9.0 + t * 2.6) * 2.2 - t * 5.0);   // 3 shimmer
  float w2 = 0.5 + 0.5 * w;
  return mix(c, a * (0.55 + 0.45 * vLight), 0.18 + 0.32 * w2) + a * pow(w2, 10.0) * 0.7;
}`;

/* ---------- Distance versions ---------- */
// The far twin of a suit is the same code run through a builder that drops bevels, caps prisms at six sides and keeps
// a record of every piece (thin ones get four sides); cut(budget) keeps the pieces that show most from the match camera (top-down area plus some
// height, team colour weighted up so sides still read) until the vertex budget, in their original order.
export const FAR_BUDGET = [360, 210];     // Torso, head.
export function farSuitBuilder() {
  const b = new MeshBuilder();
  const rec = [];
  const wrap = (name, fix) => {
    const orig = b[name].bind(b);
    b[name] = (...args) => {
      const from = b.pos.length / 3;
      orig(...fix(args));
      const to = b.pos.length / 3;
      if (to > from) rec.push([from, to, b.part]);
      return b;
    };
  };
  wrap('box', a => { const o = a.slice(0, 6); o.push(0); return o; });
  for (const n of ['prismX', 'prismY', 'prismZ']) wrap(n, a => { const o = a.slice(); o[6] = Math.min(o[6] ?? 6, Math.max(o[4], o[5]) < 0.1 ? 4 : 6); return o; });
  wrap('extrude', a => a);
  b.cut = budget => {
    const P = b.pos;
    const scored = rec.map(([from, to, part], i) => {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let v = from; v < to; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const score = (dx * dz + 0.45 * Math.max(dx, dz) * dy) * (part === 1 ? 1.8 : 1);
      return { i, from, to, score };
    }).sort((p, q) => q.score - p.score);
    const keep = new Set();
    let n = 0;
    for (const s of scored) {
      if (n + (s.to - s.from) > budget) continue;
      keep.add(s.i); n += s.to - s.from;
    }
    // Rebuild a plain builder with the kept vertices, carrying each vertex's tags over.
    const tags = new Uint16Array(P.length / 3);
    for (const [from, to, t] of b.tags ?? []) for (let v = from; v < to; v++) tags[v] |= t;
    const out = new MeshBuilder();
    out.tags = [];
    rec.forEach(([from, to], i) => {
      if (!keep.has(i)) return;
      for (let v = from; v < to; v++) {
        const o = out.pos.length / 3;
        out.pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        out.nor.push(b.nor[v * 3], b.nor[v * 3 + 1], b.nor[v * 3 + 2]);
        out.col.push(b.col[v * 3], b.col[v * 3 + 1], b.col[v * 3 + 2]);
        out.par.push(b.par[v]);
        if (tags[v]) out.tags.push([o, o + 1, tags[v]]);
      }
    });
    return out;
  };
  return b;
}

/* ---------- Suits ---------- */
const TAU = Math.PI * 2;
// A ring of n boxes round the Y axis at height y (a ruff, a mane, a collar of plates).
function ring(b, y, r, n, sx, sy, sz, cx = 0, tilt = 0) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const x = cx + Math.cos(a) * r, z = Math.sin(a) * r;
    plate(b, [x - Math.cos(a) * sx * 0.5, y - sy * 0.5 * Math.cos(tilt), z - Math.sin(a) * sx * 0.5],
      [x + Math.cos(a) * sx * 0.5, y + sy * 0.5 * Math.sin(tilt), z + Math.sin(a) * sx * 0.5], sz, sy);
  }
}
// A curve of prisms through points (horns, tails, hoses), radius tapering r0 -> r1.
function chain(b, pts, r0, r1 = r0, sides = 5) {
  for (let i = 0; i < pts.length - 1; i++) {
    const u = i / (pts.length - 1), v = (i + 1) / (pts.length - 1);
    seg(b, pts[i], pts[i + 1], r0 + (r1 - r0) * u, r0 + (r1 - r0) * v, sides);
  }
}
// A seeded scatter, so strips and tufts land the same on every client.
function rng(seed) {
  let h = seed >>> 0;
  return () => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = (h + 0x6d2b79f5) >>> 0; return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
}
// The round body of an animal suit: hips, belly, shoulders, as three octagons.
function roundBody(b, r = 0.34, top = 0.68) {
  b.prismY(-0.06, 0.18, 0, 0, r * 0.82, r, 8, Math.PI / 8);
  b.prismY(0.18, top - 0.2, 0, 0, r, r, 8, Math.PI / 8);
  b.prismY(top - 0.2, top, 0, 0, r, r * 0.66, 8, Math.PI / 8);
}
// A team harness over any suit: belt and four straps, the bear's fix from build 1119-12.
function harness(b, r = 0.36, y = 0.2) {
  b.setPart(1).prismY(y - 0.045, y + 0.045, 0, 0, r + 0.015, r + 0.015, 8, Math.PI / 8);
  b.box(r - 0.005, 0.47, 0.15, 0.04, 0.3, 0.07).box(r - 0.005, 0.47, -0.15, 0.04, 0.3, 0.07);
  b.box(-r + 0.005, 0.47, 0.15, 0.04, 0.3, 0.07).box(-r + 0.005, 0.47, -0.15, 0.04, 0.3, 0.07);
}

// A flat profile (z, y points) standing upright across the body at depth x0..x1: shields, banners, wings seen edge on.
const _rot = new THREE.Matrix4();
function profileX(b, pts, x0, x1) {
  const keep = b.matrix;
  _rot.makeRotationY(Math.PI / 2).setPosition(x0, 0, 0);
  if (keep) _rot.premultiply(keep);
  b.matrix = _rot;
  b.extrude(pts.map(([z, y]) => [-z, y]), 0, x1 - x0);
  b.matrix = keep;
  return b;
}
// A flat profile (x, z points) lying level at height y0..y1: capes and wings seen from above.
const _rot2 = new THREE.Matrix4();
function profileY(b, pts, y0, y1) {
  const keep = b.matrix;
  _rot2.makeRotationX(-Math.PI / 2);
  if (keep) _rot2.premultiply(keep);
  b.matrix = _rot2;
  b.extrude(pts.map(([x, z]) => [x, -z]), y0, y1);
  b.matrix = keep;
  return b;
}
// Seeded strips hanging off a body: shaggy fur, ghillie, straw. `cols` are KEEP colours picked at random.
function shag(b, seed, n, { y0, y1, r0, r1, drop, len = 0.2, w = 0.035, cols, skipFront = 0, cx = 0 }) {
  const R = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = R() * TAU;
    if (skipFront && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < skipFront) continue;
    const y = y0 + (y1 - y0) * R(), ca = Math.cos(a), sa = Math.sin(a), l = len * (0.7 + 0.6 * R());
    b.setColor(cols[Math.floor(R() * cols.length)]);
    seg(b, [cx + ca * r0, y, sa * r0], [cx + ca * (r1 + l * 0.3), y - drop * l * 3, sa * (r1 + l * 0.3)], w, w * 0.5, 4);
  }
}

// The back of a skull in the hair colour, for suits that show hair (LOCKS).
const skullBack = b => b.prismY(0.2, 0.36, -0.03, 0, 0.17, 0.12, 8, Math.PI / 8);

export const MORE_SUITS = {};
// Trooper: a knight in plate. Layered pauldrons and a cuirass in the skin's metal, a team tabard, a kite shield on the
// back with a lit cross, and a great helm with a gold circlet and a long team plume (the plume is what reads from above).
MORE_SUITS.trooper = {
  limbs: { bulk: 1.16, hands: null, sleeve: 0x7a828c, trouser: 0x5c626a },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x50565e).prismY(-0.12, 0.16, 0, 0, 0.29, 0.27, 8, Math.PI / 8);      // Mail skirt.
      b.setColor(0x3a2a1c).box(0, 0.15, 0, 0.5, 0.06, 0.6);                                       // Sword belt.
      b.setColor(0x2a2a2e).prismY(-0.02, 0.2, 0.06, 0.32, 0.03, 0.03, 4);
    });
    b.setPart(0).setColor(0x8a9098);
    b.prismY(0.16, 0.5, 0, 0, 0.26, 0.3, 8, Math.PI / 8);                                         // Cuirass.
    b.prismY(0.5, 0.66, 0, 0, 0.3, 0.2, 8, Math.PI / 8);
    b.setColor(0x6a7078).prismY(0.62, 0.72, 0, 0, 0.19, 0.17, 8, Math.PI / 8);                   // Gorget.
    for (const s of [1, -1]) {                                                                     // Three lames a shoulder.
      b.setColor(0x9aa0a8).box(0.0, 0.7, s * 0.33, 0.32, 0.07, 0.26, 0.025);
      b.setColor(0x7a8088).box(0.0, 0.63, s * 0.38, 0.3, 0.07, 0.22, 0.02);
      b.setColor(0x6a7078).box(0.0, 0.56, s * 0.42, 0.26, 0.07, 0.16, 0.02);
      b.setPart(1).box(0.0, 0.745, s * 0.33, 0.2, 0.025, 0.14).setPart(0);
    }
    b.setPart(1);                                                                                  // Tabard front and back.
    b.box(0.31, 0.2, 0, 0.025, 0.66, 0.3).box(-0.31, 0.26, 0, 0.025, 0.56, 0.32);
    profileX(b, [[0, 0.8], [0.21, 0.7], [0.21, 0.42], [0, 0.04], [-0.21, 0.42], [-0.21, 0.7]], -0.43, -0.36);   // Kite shield.
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffe08a);
      b.box(-0.44, 0.48, 0, 0.02, 0.56, 0.06).box(-0.44, 0.58, 0, 0.02, 0.06, 0.32);                 // Cross on the shield.
      b.box(0.325, 0.36, 0, 0.012, 0.3, 0.05).box(0.325, 0.42, 0, 0.012, 0.05, 0.2);              // And on the tabard.
    });
  },
  head(b) {
    b.setPart(0).setColor(0x9aa0a8).prismY(0.02, 0.36, 0, 0, 0.215, 0.225, 8, Math.PI / 8);      // Great helm.
    b.setColor(0x8a9098).prismY(0.36, 0.45, 0, 0, 0.225, 0.11, 8, Math.PI / 8);
    b.setColor(0x6a7078).box(0.2, 0.18, 0, 0.06, 0.2, 0.06);                                     // Nasal ridge.
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x0c0d10).box(0.2, 0.25, 0, 0.06, 0.04, 0.36);                       // Eye slit.
      for (const z of [-0.1, -0.05, 0.05, 0.1]) b.box(0.212, 0.12, z, 0.03, 0.025, 0.025);         // Breaths.
    });
    tag(b, ACC, () => b.setPart(0).setColor(0xffe08a).prismY(0.3, 0.335, 0, 0, 0.232, 0.232, 8, Math.PI / 8));   // Circlet.
    b.setPart(1);
    chain(b, [[0.02, 0.43, 0], [-0.04, 0.6, 0], [-0.18, 0.68, 0], [-0.34, 0.6, 0], [-0.44, 0.42, 0]], 0.065, 0.03, 5);   // Plume.
    b.box(0.0, 0.47, 0, 0.12, 0.05, 0.05);
  },
};

// Wisp: a ghillie monster. A shaggy mound of strips in four greens with team tufts across the shoulders, two lit eyes
// in the dark of the hood, and will-o'-the-wisps hanging round it (the accent, prism-cycling on the mastery skin).
const GHILLIE = [0x4c5a32, 0x5a6a3a, 0x6b6147, 0x3e4a2a, 0x7a7040, 0x55603e];
MORE_SUITS.wisp = {
  limbs: { bulk: 1.3, hands: 0x3a4028, sleeve: 0x4c5a32, trouser: 0x3e4a2a },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x3a4628).prismY(-0.1, 0.62, 0, 0, 0.34, 0.27, 7);
      b.setColor(0x4c5a32).prismY(0.62, 0.72, 0, 0, 0.27, 0.16, 7);
      shag(b, 11, 46, { y0: -0.05, y1: 0.66, r0: 0.28, r1: 0.36, drop: 0.55, len: 0.26, w: 0.055, cols: GHILLIE });
    });
    b.setPart(1).prismY(0.6, 0.7, 0, 0, 0.33, 0.29, 7);                                         // Team scrim and tufts.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + 0.2, c = Math.cos(a), s = Math.sin(a);
      seg(b, [c * 0.2, 0.72, s * 0.2], [c * 0.48, 0.48, s * 0.48], 0.065, 0.03, 4);
    }
    tag(b, ACC, () => {                                                                           // The wisps.
      b.setPart(0).setColor(0x9fffd0);
      for (const [x, y, z] of [[-0.42, 0.95, 0.3], [0.1, 1.1, -0.42], [-0.3, 0.75, -0.5], [0.35, 0.85, 0.46]]) b.prismY(y, y + 0.08, x, z, 0.04, 0.04, 5);
    });
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x3e4a2a).prismY(0.0, 0.4, -0.02, 0, 0.27, 0.14, 7);
      shag(b, 23, 22, { y0: 0.18, y1: 0.42, r0: 0.12, r1: 0.26, drop: 0.7, len: 0.22, w: 0.04, cols: GHILLIE, skipFront: 0.5 });
      b.setColor(0x0a0c08).box(0.19, 0.2, 0, 0.08, 0.16, 0.24);                                   // The dark under the hood.
    });
    tag(b, ACC, () => b.setPart(0).setColor(0x9fffd0).prismX(0.22, 0.24, 0.23, 0.06, 0.03, 0.03, 6).prismX(0.22, 0.24, 0.23, -0.06, 0.03, 0.03, 6));
    b.setPart(1);
    seg(b, [0, 0.38, 0], [-0.08, 0.6, 0.06], 0.05, 0.02, 4);
    seg(b, [0, 0.38, 0], [-0.12, 0.54, -0.1], 0.045, 0.02, 4);
  },
};

// Relay: a tin robot. A riveted silver body with a team chest panel and team shoulder joints, a set of lit dials, the
// radio set on its back with a mast taller than anyone's, and a box head with round lit eyes and its own antenna.
const TIN = 0xa8b0b8, TIN_D = 0x6a727c;
MORE_SUITS.relay = {
  limbs: { bulk: 1.22, hands: 0x4a5058, sleeve: 0x8a929c, trouser: 0x7a828c },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(TIN_D).box(0, 0.02, 0, 0.32, 0.22, 0.44);
      b.setColor(TIN).box(0, 0.38, 0, 0.42, 0.58, 0.58, 0.04);
      b.setColor(0x8a929c).box(0, 0.7, 0, 0.3, 0.06, 0.4);
      b.setColor(0x2a2e34);
      for (const y of [0.2, 0.56]) for (const z of [-0.22, 0.22]) b.box(0.215, y, z, 0.012, 0.03, 0.03);   // Rivets.
    });
    b.setPart(1).box(0.215, 0.4, 0, 0.02, 0.28, 0.32);                                            // Team chest panel.
    b.prismZ(0.27, 0.36, 0, 0.56, 0.12, 0.11, 8).prismZ(-0.36, -0.27, 0, 0.56, 0.11, 0.12, 8);    // Shoulder joints.
    b.box(-0.3, 0.5, 0, 0.17, 0.06, 0.42);
    b.setPart(0).setColor(0x3f4a3a).box(-0.3, 0.32, 0, 0.18, 0.38, 0.4, 0.03);                   // Radio set.
    b.setColor(0x1a1c1e).prismY(0.55, 1.8, -0.34, 0.12, 0.028, 0.012, 4);                         // Mast.
    b.prismY(0.55, 1.2, -0.34, -0.12, 0.022, 0.01, 4);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0x7cf8ff);
      b.prismX(0.225, 0.24, 0.47, 0.08, 0.04, 0.04, 8).prismX(0.225, 0.24, 0.47, -0.08, 0.04, 0.04, 8);   // Dials.
      b.box(0.232, 0.33, 0, 0.012, 0.04, 0.2);
      b.prismY(1.8, 1.88, -0.34, 0.12, 0.05, 0.05, 6).prismY(1.2, 1.26, -0.34, -0.12, 0.04, 0.04, 6);
      b.box(-0.395, 0.38, 0.08, 0.012, 0.06, 0.12);
    });
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(TIN).box(0.02, 0.24, 0, 0.4, 0.34, 0.4, 0.03);
      b.setColor(TIN_D).box(0.0, 0.06, 0, 0.18, 0.08, 0.18);                                     // Neck.
      b.setColor(0x1a1c20).box(0.22, 0.13, 0, 0.02, 0.08, 0.22);                                  // Mouth grille.
      b.setColor(0x8a929c);
      for (const z of [-0.06, 0, 0.06]) b.box(0.232, 0.13, z, 0.012, 0.08, 0.015);
      b.setColor(0x2a2e34).prismX(0.2, 0.225, 0.27, 0.09, 0.075, 0.075, 8).prismX(0.2, 0.225, 0.27, -0.09, 0.075, 0.075, 8);
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0x7cf8ff).prismX(0.225, 0.24, 0.27, 0.09, 0.055, 0.055, 8).prismX(0.225, 0.24, 0.27, -0.09, 0.055, 0.055, 8);
      b.prismY(0.68, 0.76, -0.04, 0, 0.045, 0.045, 6);
    });
    b.setPart(1).box(0.02, 0.42, 0, 0.3, 0.025, 0.3);                                             // Team lid and ear bolts.
    b.prismZ(0.2, 0.27, 0.02, 0.26, 0.07, 0.06, 6).prismZ(-0.27, -0.2, 0.02, 0.26, 0.06, 0.07, 6);
    b.setPart(0).setColor(0x1a1c20).prismY(0.43, 0.68, -0.04, 0, 0.016, 0.012, 4);
  },
};

// Yard Dog: a firefighter. A turnout coat with lit reflective bands, an air cylinder and an axe on the back, a coiled
// hose over the shoulder, and the classic helmet with its long back brim in the team colour and a lit front shield.
const TURNOUT = 0x8a7848;
MORE_SUITS.yarddog = {
  limbs: { bulk: 1.26, hands: 0x2a2620, feet: 0x161616, sleeve: 0x7e6e42, trouser: 0x6e603a },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(TURNOUT).box(0, 0.26, 0, 0.44, 0.78, 0.62, 0.05);
      b.setColor(0x6a5a34).box(0.225, 0.3, 0, 0.02, 0.6, 0.06);                                 // Storm flap.
      b.setColor(0xb02a20);                                                                       // Hose coil over the left shoulder.
      chain(b, [[0.16, 0.2, 0.3], [0.18, 0.5, 0.26], [0.06, 0.72, 0.2], [-0.12, 0.72, 0.2], [-0.24, 0.5, 0.26], [-0.22, 0.2, 0.3]], 0.04, 0.04, 5);
      b.setColor(0x3a2a1a);
      seg(b, [-0.4, 0.05, -0.18], [-0.4, 0.82, -0.28], 0.025, 0.025, 4);                          // Axe.
      b.setColor(0xb02a20).box(-0.4, 0.8, -0.34, 0.05, 0.08, 0.16);
      b.setColor(0x8a9098).box(-0.4, 0.8, -0.44, 0.03, 0.16, 0.04);
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xfff1a0);
      for (const y of [0.0, 0.4]) b.box(0, y, 0, 0.45, 0.05, 0.63);                                // Reflective bands.
      b.box(0, 0.66, 0.2, 0.3, 0.012, 0.05).box(0, 0.66, -0.2, 0.3, 0.012, 0.05);
    });
    b.setPart(0).setColor(0x8a9098).prismY(0.08, 0.6, -0.33, 0, 0.1, 0.1, 8);                     // Air cylinder.
    b.setColor(0x2a2c30).prismY(0.6, 0.66, -0.33, 0, 0.05, 0.04, 6);
    b.setPart(1).box(-0.225, 0.26, 0, 0.02, 0.2, 0.5);                                            // Team back panel and yoke.
    b.box(0, 0.65, 0, 0.36, 0.04, 0.56);
    b.prismY(0.36, 0.42, -0.33, 0, 0.106, 0.106, 8);
  },
  head(b) {
    tag(b, TONE, () => b.setPart(0).setColor(0x7a5c43).prismY(0.04, 0.26, 0, 0, 0.16, 0.16, 7));
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x15110e).box(0.152, 0.21, 0.06, 0.02, 0.025, 0.04).box(0.152, 0.21, -0.06, 0.02, 0.025, 0.04);
      b.setColor(TURNOUT).box(-0.15, 0.12, 0, 0.08, 0.2, 0.32);                                   // Neck flap.
    });
    b.setPart(1);
    b.prismY(0.22, 0.28, -0.02, 0, 0.23, 0.23, 8, Math.PI / 8);
    b.prismY(0.28, 0.46, -0.02, 0, 0.23, 0.13, 8, Math.PI / 8);
    b.box(-0.14, 0.24, 0, 0.42, 0.03, 0.5);                                                      // The long back brim.
    b.box(0.2, 0.25, 0, 0.12, 0.03, 0.36);
    b.setPart(0).setColor(0xc9a240).box(-0.04, 0.46, 0, 0.42, 0.05, 0.05);                       // Comb.
    tag(b, ACC, () => b.setPart(0).setColor(0xfff1a0).box(0.24, 0.36, 0, 0.03, 0.16, 0.14));     // Front shield.
  },
};

// Ronin: a samurai. A lacquered do in the team colour with dark lacing, broad sode on the shoulders, a plated skirt,
// two swords, a sashimono banner on the back, and a kabuto whose team neck guard flares wide under a gold crescent.
MORE_SUITS.ronin = {
  limbs: { bulk: 1.14, hands: 0x2a1a1a, sleeve: 0x26222e, trouser: 0x1c1a24 },
  torso(b) {
    b.setPart(1).prismY(0.12, 0.6, 0, 0, 0.25, 0.29, 8, Math.PI / 8);                             // Do.
    b.prismY(0.6, 0.68, 0, 0, 0.29, 0.2, 8, Math.PI / 8);
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x14121a);
      for (const y of [0.22, 0.32, 0.42, 0.52]) b.box(0.0, y, 0, 0.56, 0.018, 0.6);               // Lacing rows.
      b.setColor(0x1a1820);                                                                       // Swords on the left hip.
      seg(b, [0.24, 0.14, 0.3], [-0.62, 0.02, 0.38], 0.03, 0.025, 4);
      seg(b, [0.2, 0.18, 0.34], [-0.36, 0.12, 0.42], 0.026, 0.022, 4);
      b.setColor(0xd8d0c0);
      seg(b, [0.24, 0.14, 0.3], [0.42, 0.17, 0.28], 0.026, 0.026, 4);
      b.setColor(0x3a2a1c);
      seg(b, [-0.24, 0.2, 0], [-0.3, 1.5, 0], 0.022, 0.018, 4);                                   // Banner pole.
    });
    b.setPart(0).setColor(0x2a2a3a);
    for (const [x, z, w] of [[0.24, 0, 0.3], [-0.24, 0, 0.32], [0, 0.26, 0.3], [0, -0.26, 0.3]]) {   // Kusazuri.
      if (z) b.box(0.0, 0.0, z, w, 0.26, 0.05); else b.box(x, 0.0, 0, 0.05, 0.26, w);
    }
    for (const s of [1, -1]) {                                                                     // Sode.
      plate(b, [0.04, 0.72, s * 0.32], [0.0, 0.36, s * 0.46], 0.34, 0.04);
      b.setPart(1);
      plate(b, [0.04, 0.73, s * 0.33], [0.035, 0.64, s * 0.36], 0.35, 0.046);
      b.setPart(0);
    }
    b.setPart(1);
    profileX(b, [[-0.02, 1.48], [0.22, 1.48], [0.22, 0.98], [-0.02, 0.98]], -0.32, -0.3);          // Sashimono.
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xd9b44a);
      b.prismX(-0.34, -0.33, 1.23, 0.1, 0.07, 0.07, 8);
      for (const s of [1, -1]) plate(b, [0.04, 0.665, s * 0.33], [0.0, 0.48, s * 0.42], 0.36, 0.05, 0);
    });
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x6a1a1a).box(0.18, 0.14, 0, 0.08, 0.16, 0.26, 0.02);                 // Menpo.
      b.setColor(0x0c0a0e).box(0.17, 0.24, 0, 0.06, 0.06, 0.28);
      b.setColor(0xe8e0d0).box(0.225, 0.11, 0, 0.012, 0.03, 0.12);
    });
    b.setPart(0).setColor(0x2a2a3a).prismY(0.22, 0.42, 0, 0, 0.22, 0.09, 8, Math.PI / 8);          // Bowl.
    b.setPart(1).prismY(0.08, 0.24, -0.05, 0, 0.36, 0.24, 8, Math.PI / 8);                       // Shikoro, flared.
    b.setPart(0).setColor(0x2a2a3a);
    for (const s of [1, -1]) plate(b, [0.16, 0.24, s * 0.2], [0.04, 0.3, s * 0.34], 0.14, 0.03);  // Fukigaeshi.
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xd9b44a).box(0.2, 0.31, 0, 0.06, 0.06, 0.08);
      for (const s of [1, -1]) chain(b, [[0.21, 0.32, 0], [0.26, 0.44, s * 0.1], [0.24, 0.58, s * 0.2], [0.18, 0.7, s * 0.26]], 0.032, 0.012, 4);
    });
  },
};

// Ghoul: a hazmat suit. Puffed yellow coveralls with team tape round the chest and waist, an air cylinder on the back
// with a hose to the chest and a lit biohazard mark, and a hood whose broad visor glows (the accent).
const HAZ = 0xd8b830;
MORE_SUITS.ghoul = {
  limbs: { bulk: 1.32, hands: 0x1a1a1a, feet: 0x1a1a1a, sleeve: 0xd0b02c, trouser: 0xc8a828 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(HAZ);
      roundBody(b, 0.33, 0.68);
      b.setColor(0x8a9098).prismY(0.1, 0.6, -0.4, 0, 0.11, 0.11, 8);                              // Cylinder.
      b.setColor(0x1a1a1a);
      chain(b, [[-0.36, 0.6, 0.06], [-0.18, 0.74, 0.22], [0.12, 0.66, 0.26], [0.3, 0.44, 0.16]], 0.03, 0.03, 4);
      b.box(0.33, 0.3, 0, 0.03, 0.4, 0.04);                                                      // Zip.
    });
    b.setPart(1);
    b.prismY(0.16, 0.22, 0, 0, 0.34, 0.34, 8, Math.PI / 8).prismY(0.44, 0.5, 0, 0, 0.34, 0.34, 8, Math.PI / 8);
    b.prismY(0.66, 0.7, 0, 0, 0.24, 0.23, 8, Math.PI / 8);
    b.prismY(0.42, 0.48, -0.4, 0, 0.115, 0.115, 8);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xff2bd6);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + Math.PI / 2; b.prismX(-0.52, -0.51, 0.34 + Math.sin(a) * 0.045, Math.cos(a) * 0.045, 0.035, 0.035, 6); }
      b.box(0.335, 0.52, 0.12, 0.015, 0.06, 0.06);
    });
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(HAZ).prismY(0.0, 0.38, -0.03, 0, 0.26, 0.26, 8, Math.PI / 8);
      b.prismY(0.38, 0.48, -0.03, 0, 0.26, 0.14, 8, Math.PI / 8);
      b.setColor(0x1a1a1a).box(0.22, 0.25, 0, 0.05, 0.22, 0.36);                                 // Visor frame.
      b.prismX(0.2, 0.34, 0.08, 0.1, 0.055, 0.06, 6).prismX(0.2, 0.34, 0.08, -0.1, 0.055, 0.06, 6);   // Filters.
    });
    tag(b, ACC, () => b.setPart(0).setColor(0xff2bd6).box(0.248, 0.25, 0, 0.012, 0.17, 0.31));
    b.setPart(1).prismY(0.47, 0.51, -0.03, 0, 0.17, 0.12, 8, Math.PI / 8);
    b.box(-0.02, 0.3, 0, 0.5, 0.05, 0.56);
  },
};

// Ram: a bighorn. A wool coat in fat cream curls with a team harness and a brass bell, a long dark face, and two huge
// horns curling round the ears in the team colour: from above, two team spirals either side of the head.
const WOOL = 0xe8e0d0, RAMFACE = 0x5a4a3a;
function ramHorn(b, s) {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const th = (i / 10) * TAU * 0.86, r = 0.2 - i * 0.01;
    pts.push([-0.02 - Math.sin(th) * r, 0.28 + Math.cos(th) * r, s * (0.22 + i * 0.016)]);
  }
  chain(b, pts, 0.085, 0.03, 6);
}
MORE_SUITS.ram = {
  limbs: { bulk: 1.3, hands: 0x3a3028, feet: 0x2a2420, sleeve: 0xd8d0c0, trouser: 0x5a4a3a },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(WOOL);
      roundBody(b, 0.34, 0.68);
      const R = rng(5);
      for (let i = 0; i < 26; i++) {
        const a = R() * TAU, y = 0.0 + R() * 0.66, r = y > 0.5 ? 0.3 : 0.35;
        b.setColor(R() < 0.5 ? 0xf0eadc : 0xd8cfbe).box(Math.cos(a) * r, y, Math.sin(a) * r, 0.13, 0.11, 0.13);
      }
      b.setColor(0x5a4a3a).box(-0.36, 0.14, 0, 0.08, 0.1, 0.1);
    });
    harness(b, 0.35, 0.2);
    b.prismY(0.64, 0.7, 0, 0, 0.27, 0.25, 8, Math.PI / 8);
    tag(b, ACC, () => b.setPart(0).setColor(0xffcf4a).prismY(0.5, 0.62, 0.3, 0, 0.06, 0.04, 6));
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(WOOL).prismY(0.18, 0.42, -0.04, 0, 0.23, 0.13, 8, Math.PI / 8);
      b.setColor(RAMFACE).box(0.08, 0.2, 0, 0.22, 0.22, 0.26, 0.03);
      b.box(0.24, 0.12, 0, 0.18, 0.16, 0.18, 0.03);                                               // Long snout.
      b.setColor(0x2a2018).box(0.335, 0.14, 0, 0.02, 0.05, 0.1);
      b.setColor(0xd0a020).box(0.19, 0.27, 0.12, 0.04, 0.035, 0.03).box(0.19, 0.27, -0.12, 0.04, 0.035, 0.03);
      b.setColor(0x15110e).box(0.205, 0.27, 0.12, 0.012, 0.018, 0.03).box(0.205, 0.27, -0.12, 0.012, 0.018, 0.03);
      b.setColor(RAMFACE).box(-0.02, 0.26, 0.24, 0.1, 0.05, 0.08).box(-0.02, 0.26, -0.24, 0.1, 0.05, 0.08);   // Ears.
    });
    b.setPart(1);
    ramHorn(b, 1); ramHorn(b, -1);
  },
};

// Monarch: a lion king. Golden fur, a team cape with an ermine collar over the shoulders, a tufted tail, a great mane
// all round the head (the biggest disc on the roster from above) and a crown in the accent.
const LION = 0xc89030, MANE = [0x8a4a1a, 0x9a5a22, 0x7a3e16];
MORE_SUITS.monarch = {
  limbs: { bulk: 1.3, hands: 0x8a5a28, feet: 0x6a4420, sleeve: 0xc08a2c, trouser: 0xb07a22 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(LION);
      roundBody(b, 0.32, 0.66);
      b.setColor(0xe8c878).box(0.3, 0.3, 0, 0.06, 0.34, 0.26, 0.03);                             // Pale belly.
      b.setColor(LION);
      chain(b, [[-0.3, 0.06, 0], [-0.52, -0.06, 0.08], [-0.68, 0.04, 0.2], [-0.74, 0.2, 0.26]], 0.035, 0.03, 4);
      b.setColor(0x6a3412).box(-0.75, 0.24, 0.27, 0.12, 0.12, 0.12);                             // Tuft.
      b.setColor(0xf2f0ea).prismY(0.62, 0.72, -0.02, 0, 0.33, 0.29, 10);                           // Ermine collar.
      b.setColor(0x15110e);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + 0.3; b.box(Math.cos(a) * 0.31 - 0.02, 0.73, Math.sin(a) * 0.31, 0.03, 0.02, 0.05); }
    });
    b.setPart(1);                                                                                  // Cape.
    b.prismY(0.48, 0.62, -0.05, 0, 0.42, 0.36, 10);
    profileX(b, [[-0.36, 0.6], [0.36, 0.6], [0.42, -0.12], [-0.42, -0.12]], -0.39, -0.34);
    tag(b, ACC, () => b.setPart(0).setColor(0xffd659).box(-0.4, -0.08, 0, 0.02, 0.05, 0.84));
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(LION).prismY(0.04, 0.38, 0, 0, 0.2, 0.17, 8, Math.PI / 8);
      b.setColor(0xe8c878).box(0.18, 0.13, 0, 0.12, 0.12, 0.18, 0.02);                            // Muzzle.
      b.setColor(0x2a1810).box(0.245, 0.18, 0, 0.03, 0.05, 0.08);
      b.setColor(0x15110e).box(0.165, 0.27, 0.075, 0.03, 0.03, 0.05).box(0.165, 0.27, -0.075, 0.03, 0.03, 0.05);
      b.setColor(LION).box(-0.02, 0.4, 0.13, 0.06, 0.07, 0.07).box(-0.02, 0.4, -0.13, 0.06, 0.07, 0.07);
      // Mane: a disc framing the face and two rings of spikes round it, like a sun from the front, a wide fan from above.
      b.setColor(MANE[0]).prismX(-0.16, 0.06, 0.2, 0, 0.36, 0.3, 10);
      const R = rng(9);
      for (const [n, r0, r1, x0, x1, w] of [[14, 0.2, 0.46, -0.04, -0.16, 0.085], [11, 0.16, 0.36, 0.04, -0.04, 0.07]]) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + r0, c = Math.cos(a), s = Math.sin(a);
          if (c < -0.85) continue;
          b.setColor(MANE[Math.floor(R() * MANE.length)]);
          seg(b, [x0, 0.2 + c * r0, s * r0], [x1, 0.2 + c * r1 * (0.9 + 0.2 * R()), s * r1 * (0.9 + 0.2 * R())], w, 0.025, 5);
        }
      }
    });
    tag(b, ACC, () => {                                                                           // Crown.
      b.setPart(0).setColor(0xffd659).prismY(0.4, 0.45, -0.01, 0, 0.14, 0.14, 8, Math.PI / 8);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; b.prismY(0.45, 0.56, -0.01 + Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.035, 0.008, 4); }
    });
  },
};
// Sparrow: a plague doctor. A long waxed coat flaring past the knees, a team capelet, a belt of lit vials, a wide
// black hat with a team band (the brim is the disc from above) and the beaked mask with round lit goggles.
const WAX = 0x2a2622;
MORE_SUITS.sparrow = {
  limbs: { bulk: 1.1, hands: 0x2a2420, feet: 0x1a1612, sleeve: 0x2c2824, trouser: 0x221e1a },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(WAX).prismY(-0.36, 0.2, 0, 0, 0.36, 0.27, 8, Math.PI / 8);
      b.prismY(0.2, 0.62, 0, 0, 0.27, 0.29, 8, Math.PI / 8);
      b.setColor(0x4a3a28).box(0, 0.16, 0, 0.58, 0.05, 0.6);                                     // Belt.
      b.setColor(0x6a5236).box(-0.04, 0.0, 0.33, 0.2, 0.2, 0.08);                                 // Satchel.
      b.setColor(0x1a1612).box(0.27, 0.3, 0, 0.02, 0.5, 0.04);
    });
    b.setPart(1).prismY(0.48, 0.66, -0.02, 0, 0.4, 0.3, 8, Math.PI / 8);                         // Capelet.
    b.prismY(0.66, 0.72, -0.02, 0, 0.3, 0.2, 8, Math.PI / 8);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffe08a);
      for (const z of [-0.18, -0.06, 0.06, 0.18]) b.prismY(0.18, 0.28, 0.29, z, 0.03, 0.025, 5);  // Vials.
      b.box(0.0, 0.04, 0.375, 0.04, 0.12, 0.012).box(0.0, 0.04, 0.375, 0.12, 0.04, 0.012);
    });
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x1e1c1a).prismY(0.0, 0.34, -0.03, 0, 0.22, 0.2, 8, Math.PI / 8);     // Hood.
      b.setColor(0x141210).prismY(0.34, 0.37, -0.02, 0, 0.4, 0.4, 12);                           // Brim.
      b.prismY(0.37, 0.58, -0.02, 0, 0.19, 0.16, 8, Math.PI / 8);
      b.setColor(0xc8b48a).box(0.16, 0.2, 0, 0.08, 0.22, 0.26, 0.02);                            // Mask and beak.
      b.setColor(0xd8c8a0);
      chain(b, [[0.18, 0.18, 0], [0.34, 0.15, 0], [0.48, 0.08, 0], [0.56, -0.02, 0]], 0.08, 0.012, 5);
      b.setColor(0x8a6a2a).prismX(0.18, 0.21, 0.27, 0.075, 0.055, 0.055, 8).prismX(0.18, 0.21, 0.27, -0.075, 0.055, 0.055, 8);
    });
    tag(b, ACC, () => b.setPart(0).setColor(0xffe08a).prismX(0.21, 0.222, 0.27, 0.075, 0.042, 0.042, 8).prismX(0.21, 0.222, 0.27, -0.075, 0.042, 0.042, 8));
    b.setPart(1).prismY(0.37, 0.43, -0.02, 0, 0.196, 0.19, 8, Math.PI / 8);                       // Hat band.
    b.box(-0.02, 0.36, 0, 0.62, 0.012, 0.08);
  },
};

// Vesper: an owl. A round brown body with a pale barred breast, folded wings whose coverts are the team colour, a big
// round head with two pale facial discs round huge lit eyes, and team ear tufts (two horns from above).
const OWL = 0x7a5a3a, OWL_D = 0x5a3e26;
MORE_SUITS.vesper = {
  limbs: { bulk: 1.28, hands: 0x3a2a1a, feet: 0xd8a020, sleeve: 0x7a5a3a, trouser: 0x6a4a2e },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(OWL);
      roundBody(b, 0.32, 0.66);
      b.setColor(0xd8c8a8).box(0.3, 0.3, 0, 0.07, 0.46, 0.34, 0.03);                             // Breast.
      b.setColor(OWL_D);
      for (const [y, z] of [[0.18, 0.08], [0.18, -0.08], [0.3, 0], [0.42, 0.08], [0.42, -0.08], [0.52, 0]]) b.box(0.338, y, z, 0.012, 0.035, 0.06);
      for (const s of [1, -1]) plate(b, [0.04, 0.6, s * 0.33], [-0.2, -0.04, s * 0.4], 0.3, 0.06);   // Primaries.
      b.setColor(OWL_D);
      for (const z of [-0.12, 0, 0.12]) plate(b, [-0.28, 0.12, z * 0.6], [-0.46, -0.14, z], 0.1, 0.03);   // Tail.
    });
    b.setPart(1);
    for (const s of [1, -1]) plate(b, [0.08, 0.68, s * 0.34], [-0.06, 0.34, s * 0.41], 0.34, 0.065);   // Coverts.
    b.prismY(0.64, 0.7, 0, 0, 0.23, 0.2, 8, Math.PI / 8);
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(OWL).prismY(0.02, 0.36, 0, 0, 0.25, 0.25, 8, Math.PI / 8);
      b.prismY(0.36, 0.46, 0, 0, 0.25, 0.14, 8, Math.PI / 8);
      b.setColor(0xe8dcc0).prismX(0.17, 0.235, 0.24, 0.1, 0.12, 0.11, 8).prismX(0.17, 0.235, 0.24, -0.1, 0.12, 0.11, 8);
      b.setColor(0xd8a020).prismX(0.22, 0.33, 0.15, 0, 0.045, 0.0, 4);                           // Beak.
      b.setColor(0x0c0a08).prismX(0.245, 0.255, 0.25, 0.1, 0.03, 0.03, 6).prismX(0.245, 0.255, 0.25, -0.1, 0.03, 0.03, 6);
    });
    tag(b, ACC, () => b.setPart(0).setColor(0x5affb0).prismX(0.235, 0.245, 0.25, 0.1, 0.065, 0.065, 8).prismX(0.235, 0.245, 0.25, -0.1, 0.065, 0.065, 8));
    b.setPart(1);
    for (const s of [1, -1]) seg(b, [0.02, 0.38, s * 0.14], [-0.04, 0.6, s * 0.26], 0.07, 0.02, 5);   // Ear tufts.
  },
};

// Wren: a bee (her drones were always bees). A striped body with a stinger, two pairs of wings off the back (the big
// pair in the team colour: from above a team X), a fuzzy collar, a black head with big lit eyes and two antennae.
const BEE_Y = 0xf0c020, BEE_K = 0x1a1a1a;
MORE_SUITS.wren = {
  limbs: { bulk: 1.22, hands: BEE_K, feet: BEE_K, sleeve: 0x222222, trouser: 0x1e1e1e },
  torso(b) {
    tag(b, KEEP, () => {
      const bands = [[-0.1, 0.06, BEE_Y, 0.27, 0.31], [0.06, 0.2, BEE_K, 0.31, 0.33], [0.2, 0.34, BEE_Y, 0.33, 0.33], [0.34, 0.48, BEE_K, 0.33, 0.32], [0.48, 0.6, BEE_Y, 0.32, 0.28], [0.6, 0.7, BEE_K, 0.28, 0.18]];
      for (const [y0, y1, c, r0, r1] of bands) b.setPart(0).setColor(c).prismY(y0, y1, 0, 0, r0, r1, 8, Math.PI / 8);
      b.setColor(BEE_Y).prismX(-0.5, -0.24, 0.14, 0, 0.0, 0.17, 6);                              // Abdomen tip.
      b.setColor(BEE_K).prismX(-0.62, -0.49, 0.14, 0, 0.0, 0.04, 4);                             // Stinger.
      b.setColor(0xf6dc6a).prismY(0.64, 0.74, 0, 0, 0.24, 0.2, 8, Math.PI / 8);                  // Fuzz collar.
      b.setColor(0xd8eef8);
      for (const s of [1, -1]) plate(b, [-0.22, 0.56, s * 0.08], [-0.56, 0.62, s * 0.36], 0.18, 0.018);
    });
    b.setPart(1);
    for (const s of [1, -1]) plate(b, [-0.2, 0.64, s * 0.08], [-0.5, 0.84, s * 0.56], 0.3, 0.02);   // Big wings, lying flat.
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(BEE_K).prismY(0.02, 0.36, 0, 0, 0.21, 0.18, 8, Math.PI / 8);
      b.setColor(0xf0c020).box(0.18, 0.12, 0, 0.06, 0.08, 0.14);
      b.setColor(BEE_K);
      for (const s of [1, -1]) chain(b, [[0.1, 0.34, s * 0.06], [0.16, 0.52, s * 0.12], [0.28, 0.6, s * 0.2]], 0.02, 0.014, 4);
    });
    tag(b, ACC, () => b.setPart(0).setColor(0x18e8ff).prismX(0.1, 0.22, 0.24, 0.12, 0.11, 0.09, 6).prismX(0.1, 0.22, 0.24, -0.12, 0.11, 0.09, 6));
    b.setPart(1).prismY(0.58, 0.66, 0.28, 0.2, 0.05, 0.04, 6).prismY(0.58, 0.66, 0.28, -0.2, 0.05, 0.04, 6);
    b.box(-0.02, 0.37, 0, 0.26, 0.04, 0.2);
  },
};

// Ox: a silverback gorilla. A huge hunched black body with a silver saddle across the back, crossed team ammo belts
// with brass rounds, a heavy brow, and a team headband with its tails flying.
const APE = 0x24221f, APE_SKIN = 0x3a3633;
MORE_SUITS.ox = {
  limbs: { bulk: 1.5, hands: 0x2a2826, feet: 0x2a2826, sleeve: 0x26241f, trouser: 0x24221f },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(APE).prismY(-0.06, 0.2, 0, 0, 0.31, 0.36, 8, Math.PI / 8);
      b.prismY(0.2, 0.5, 0, 0, 0.36, 0.4, 8, Math.PI / 8);
      b.prismY(0.5, 0.78, 0, 0, 0.42, 0.26, 8, Math.PI / 8);
      b.setColor(0xa8a8a4).prismY(0.48, 0.8, -0.12, 0, 0.3, 0.16, 8, Math.PI / 8);              // Silver saddle.
      b.box(-0.3, 0.38, 0, 0.12, 0.3, 0.46, 0.03);
      b.setColor(APE_SKIN).box(0.36, 0.48, 0.1, 0.06, 0.18, 0.16, 0.03).box(0.36, 0.48, -0.1, 0.06, 0.18, 0.16, 0.03);   // Chest.
    });
    b.setPart(1);
    for (const s of [1, -1]) { plate(b, [0.38, 0.76, -0.26 * s], [0.38, 0.06, 0.28 * s], 0.09, 0.05); plate(b, [-0.38, 0.76, -0.26 * s], [-0.38, 0.06, 0.28 * s], 0.09, 0.05); }
    b.prismY(0.12, 0.2, 0, 0, 0.37, 0.37, 8, Math.PI / 8);
    for (const s of [1, -1]) b.box(0, 0.79, s * 0.24, 0.62, 0.05, 0.1);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffcc33);
      for (let i = 0; i < 5; i++) { const t = 0.12 + i * 0.18; b.box(0.41, 0.76 - 0.7 * t, -0.26 + 0.54 * t, 0.02, 0.06, 0.03).box(0.41, 0.76 - 0.7 * t, 0.26 - 0.54 * t, 0.02, 0.06, 0.03); }
    });
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(APE).prismY(0.02, 0.34, 0.0, 0, 0.21, 0.19, 8, Math.PI / 8);
      b.box(-0.02, 0.38, 0, 0.24, 0.07, 0.1);                                                    // Crest.
      b.setColor(APE_SKIN).box(0.15, 0.17, 0, 0.12, 0.22, 0.28, 0.03);
      b.box(0.23, 0.09, 0, 0.1, 0.1, 0.22, 0.02);                                                 // Muzzle.
      b.setColor(0x0c0b0a).box(0.21, 0.29, 0, 0.1, 0.055, 0.32);                                 // Brow.
      b.box(0.285, 0.12, 0.04, 0.012, 0.03, 0.03).box(0.285, 0.12, -0.04, 0.012, 0.03, 0.03);
    });
    tag(b, ACC, () => b.setPart(0).setColor(0xffcc33).box(0.215, 0.235, 0.07, 0.012, 0.025, 0.04).box(0.215, 0.235, -0.07, 0.012, 0.025, 0.04));
    b.setPart(1).prismY(0.24, 0.3, 0.0, 0, 0.215, 0.205, 8, Math.PI / 8);                        // Headband and tails.
    seg(b, [-0.2, 0.27, 0.04], [-0.42, 0.18, 0.14], 0.035, 0.02, 4);
    seg(b, [-0.2, 0.27, -0.04], [-0.44, 0.22, -0.08], 0.035, 0.02, 4);
  },
};

// Morse: a panda in a beret. A round white body with the black shoulder band, a stalk of bamboo slung on the back, a
// team scarf, black ears and eye patches, and her team beret with the lit cap badge.
const PANDA_W = 0xf0f0ea, PANDA_K = 0x1a1a1c;
MORE_SUITS.morse = {
  limbs: { bulk: 1.32, hands: 0x161616, feet: 0x161616, sleeve: PANDA_K, trouser: PANDA_K },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(PANDA_W).prismY(-0.06, 0.18, 0, 0, 0.28, 0.34, 8, Math.PI / 8);
      b.prismY(0.18, 0.44, 0, 0, 0.34, 0.34, 8, Math.PI / 8);
      b.setColor(PANDA_K).prismY(0.44, 0.68, 0, 0, 0.34, 0.24, 8, Math.PI / 8);                  // Shoulder band.
      b.setColor(PANDA_W).box(0.31, 0.3, 0, 0.06, 0.24, 0.24, 0.03);
      b.setColor(0x5a9a3a);                                                                       // Bamboo.
      seg(b, [-0.36, -0.1, 0.3], [-0.38, 1.0, -0.26], 0.035, 0.03, 5);
      b.setColor(0x3a6a28);
      for (const t of [0.25, 0.5, 0.75]) b.prismY(-0.1 + 1.1 * t - 0.015, -0.1 + 1.1 * t + 0.015, -0.365, 0.3 - 0.56 * t, 0.045, 0.045, 5);
      b.setColor(0x6aba4a);
      plate(b, [-0.38, 0.96, -0.24], [-0.3, 1.12, -0.12], 0.08, 0.012);
      plate(b, [-0.38, 0.9, -0.22], [-0.46, 1.04, -0.08], 0.07, 0.012);
    });
    b.setPart(1).prismY(0.62, 0.74, 0, 0, 0.27, 0.24, 8, Math.PI / 8);                          // Scarf.
    seg(b, [0.2, 0.66, 0.12], [0.32, 0.36, 0.18], 0.05, 0.04, 4);
    b.setPart(0).setColor(0x3f4a3a).box(-0.32, 0.3, 0, 0.12, 0.26, 0.3, 0.02);                    // The radio, as ever.
    tag(b, ACC, () => b.setPart(0).setColor(0xffd659).box(-0.385, 0.34, 0.06, 0.012, 0.04, 0.08));
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(PANDA_W).prismY(0.02, 0.36, 0, 0, 0.24, 0.21, 8, Math.PI / 8);
      b.setColor(PANDA_K);
      for (const s of [1, -1]) b.prismZ(s > 0 ? 0.14 : -0.22, s > 0 ? 0.22 : -0.14, -0.02, 0.36, 0.09, 0.09, 7);   // Ears.
      for (const s of [1, -1]) plate(b, [0.205, 0.29, s * 0.045], [0.2, 0.2, s * 0.15], 0.085, 0.04);   // Eye patches.
      b.box(0.24, 0.14, 0, 0.04, 0.05, 0.08);
      b.setColor(PANDA_W).box(0.2, 0.12, 0, 0.08, 0.1, 0.16, 0.02);
      b.setColor(PANDA_K).box(0.245, 0.15, 0, 0.012, 0.04, 0.07);
      b.setColor(0xf8f8f0).box(0.232, 0.25, 0.1, 0.012, 0.025, 0.025).box(0.232, 0.25, -0.1, 0.012, 0.025, 0.025);
    });
    b.setPart(1).prismY(0.33, 0.42, -0.01, 0.04, 0.25, 0.17, 10);                                // Beret.
    tag(b, ACC, () => b.setPart(0).setColor(0xffd659).box(0.21, 0.37, -0.08, 0.03, 0.05, 0.04));
  },
};

// Cipher: a little green man in a team flight suit. A flared silver collar standing up behind the head (a ring from
// above), a lit chest emblem, a ray gun on the hip, and a huge bulbous head with black almond eyes and two antennae.
const ALIEN = 0x8ab89a, SILVER = 0xc8ccd4;
MORE_SUITS.cipher = {
  limbs: { bulk: 0.95, hands: ALIEN, feet: 0x2a2e34, sleeve: 0x3a3f4a, trouser: 0x343a44 },
  torso(b) {
    b.setPart(1).prismY(-0.06, 0.6, 0, 0, 0.25, 0.27, 8, Math.PI / 8);                           // Flight suit.
    tag(b, KEEP, () => {
      b.setPart(0).setColor(SILVER).box(0, 0.12, 0, 0.52, 0.06, 0.56);
      b.prismY(0.58, 0.64, 0, 0, 0.28, 0.25, 8, Math.PI / 8);
      for (let i = 0; i < 9; i++) {                                                               // Flared collar.
        const a = Math.PI * 0.5 + (i / 8) * Math.PI, c = Math.cos(a), s = Math.sin(a);
        plate(b, [c * 0.18, 0.62, s * 0.18], [c * 0.34, 0.92, s * 0.34], 0.13, 0.02);
      }
      for (const s of [1, -1]) b.box(0.0, 0.62, s * 0.3, 0.26, 0.06, 0.16, 0.02);                // Shoulder pads.
      b.setColor(0x4a5058).box(0.02, 0.02, 0.32, 0.18, 0.1, 0.06);                              // Ray gun.
      b.setColor(SILVER).prismX(0.1, 0.26, 0.04, 0.32, 0.025, 0.04, 6);
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xc6ff2a).prismX(0.26, 0.28, 0.42, 0, 0.07, 0.07, 6);
      b.prismX(0.26, 0.3, 0.04, 0.32, 0.03, 0.03, 6);
    });
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(ALIEN).prismY(0.0, 0.12, 0, 0, 0.07, 0.08, 6);
      b.prismY(0.08, 0.3, 0.02, 0, 0.13, 0.26, 8, Math.PI / 8);
      b.prismY(0.3, 0.52, -0.01, 0, 0.26, 0.24, 8, Math.PI / 8);
      b.prismY(0.52, 0.6, -0.01, 0, 0.24, 0.12, 8, Math.PI / 8);
      b.setColor(0x08090a);
      for (const s of [1, -1]) plate(b, [0.17, 0.2, s * 0.03], [0.15, 0.34, s * 0.2], 0.12, 0.05, s * 0.5);   // Eyes.
      b.setColor(0x3a5a44).box(0.15, 0.13, 0, 0.012, 0.012, 0.06);
      b.setColor(ALIEN);
      for (const s of [1, -1]) chain(b, [[0.0, 0.58, s * 0.08], [-0.02, 0.72, s * 0.14], [0.04, 0.82, s * 0.2]], 0.018, 0.012, 4);
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xc6ff2a).prismY(0.81, 0.88, 0.04, 0.2, 0.04, 0.035, 6).prismY(0.81, 0.88, 0.04, -0.2, 0.04, 0.035, 6);
      for (const s of [1, -1]) b.box(0.185, 0.3, s * 0.14, 0.012, 0.03, 0.03);
    });
  },
};

// Harrow: a yeti. A huge shaggy white body, an ice axe and a team harness, a blue-grey face with fangs and lit eyes,
// small horns, and a team bobble hat (from above: a white mound with a team dot).
const YETI = [0xe8ecf0, 0xdae0e8, 0xf4f6f8, 0xc8d4e0];
MORE_SUITS.harrow = {
  limbs: { bulk: 1.48, hands: 0x6a8aa0, feet: 0x6a8aa0, sleeve: 0xe0e6ec, trouser: 0xd8dee6 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(YETI[0]);
      b.prismY(-0.06, 0.2, 0, 0, 0.32, 0.37, 8, Math.PI / 8);
      b.prismY(0.2, 0.52, 0, 0, 0.37, 0.39, 8, Math.PI / 8);
      b.prismY(0.52, 0.76, 0, 0, 0.39, 0.24, 8, Math.PI / 8);
      shag(b, 17, 34, { y0: 0.0, y1: 0.7, r0: 0.34, r1: 0.4, drop: 0.5, len: 0.2, w: 0.06, cols: YETI });
      b.setColor(0x2a2c30);
      seg(b, [-0.42, 0.0, -0.2], [-0.42, 0.9, -0.3], 0.025, 0.025, 4);                            // Ice axe.
      b.setColor(0x8a9098).box(-0.42, 0.9, -0.3, 0.04, 0.04, 0.26);
    });
    harness(b, 0.38, 0.22);
    b.prismY(0.66, 0.76, 0, 0, 0.3, 0.26, 8, Math.PI / 8);
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(YETI[0]).prismY(0.02, 0.34, -0.02, 0, 0.26, 0.24, 8, Math.PI / 8);
      shag(b, 29, 12, { y0: 0.06, y1: 0.3, r0: 0.2, r1: 0.26, drop: 0.6, len: 0.16, w: 0.05, cols: YETI, skipFront: 0.7 });
      b.setColor(0x6a8aa0).box(0.18, 0.18, 0, 0.1, 0.22, 0.26, 0.03);                            // Face.
      b.setColor(0x1a2028).box(0.235, 0.1, 0, 0.02, 0.05, 0.16);
      b.setColor(0xf8f8f0).box(0.24, 0.1, 0.05, 0.015, 0.06, 0.025).box(0.24, 0.1, -0.05, 0.015, 0.06, 0.025);
      b.setColor(0xd8d0b8);
      for (const s of [1, -1]) chain(b, [[0.0, 0.3, s * 0.2], [0.02, 0.4, s * 0.3], [0.1, 0.46, s * 0.32]], 0.04, 0.015, 4);
    });
    tag(b, ACC, () => b.setPart(0).setColor(0x9ad8ff).box(0.235, 0.23, 0.07, 0.012, 0.035, 0.05).box(0.235, 0.23, -0.07, 0.012, 0.035, 0.05));
    b.setPart(1).prismY(0.3, 0.46, -0.03, 0, 0.23, 0.12, 8, Math.PI / 8);                        // Bobble hat.
    b.prismY(0.44, 0.56, -0.04, 0, 0.08, 0.06, 7);
    tag(b, KEEP, () => b.setPart(0).setColor(0xf4f6f8).prismY(0.28, 0.34, -0.03, 0, 0.245, 0.245, 8, Math.PI / 8));
  },
};

// Sable: a pharaoh. A linen shift under a broad collar of team and gold rings (concentric rings from above), a gold
// belt and a team apron, a crook on the back, and the striped nemes headdress flaring past her shoulders with a lit
// cobra on the brow.
const GOLD = 0xd9b44a, LINEN = 0xe8e0cc;
MORE_SUITS.sable = {
  limbs: { bulk: 1.06, hands: GOLD, feet: 0xb08a3a, sleeve: 0xa86f4c, trouser: LINEN },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(LINEN).prismY(-0.14, 0.58, 0, 0, 0.27, 0.25, 8, Math.PI / 8);
      b.setColor(GOLD);
      seg(b, [-0.3, -0.05, 0.16], [-0.32, 0.96, -0.1], 0.025, 0.025, 4);                          // Crook.
      chain(b, [[-0.32, 0.96, -0.1], [-0.32, 1.08, -0.06], [-0.32, 1.1, 0.04], [-0.32, 1.02, 0.08]], 0.025, 0.025, 4);
    });
    b.setPart(1).prismY(0.56, 0.6, 0, 0, 0.4, 0.38, 12);                                         // Usekh collar.
    b.prismY(0.63, 0.66, 0, 0, 0.3, 0.29, 12);
    b.box(0.27, -0.02, 0, 0.03, 0.3, 0.2);                                                       // Apron.
    tag(b, ACC, () => {
      b.setPart(0).setColor(GOLD).prismY(0.6, 0.63, 0, 0, 0.36, 0.33, 12);
      b.prismY(0.66, 0.69, 0, 0, 0.26, 0.22, 12);
      b.box(0, 0.14, 0, 0.56, 0.06, 0.58);
      b.box(0.29, -0.02, 0, 0.012, 0.26, 0.04);
    });
  },
  head(b) {
    tag(b, TONE, () => b.setPart(0).setColor(0x7a5c43).prismY(0.04, 0.3, 0, 0, 0.16, 0.16, 7));
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x0c0a08).box(0.158, 0.21, 0.07, 0.02, 0.025, 0.07).box(0.158, 0.21, -0.07, 0.02, 0.025, 0.07);
      b.setColor(GOLD).prismY(0.14, 0.4, -0.04, 0, 0.23, 0.2, 8, Math.PI / 8);                   // Nemes.
      b.prismY(0.4, 0.47, -0.04, 0, 0.2, 0.1, 8, Math.PI / 8);
      for (const s of [1, -1]) b.box(0.07, 0.0, s * 0.2, 0.1, 0.32, 0.1);                         // Lappets.
      b.box(-0.2, 0.02, 0, 0.1, 0.3, 0.2);
    });
    b.setPart(1).prismY(0.0, 0.26, -0.08, 0, 0.32, 0.25, 8, Math.PI / 8);                         // The flare and its stripes.
    for (const y of [0.2, 0.28, 0.36]) b.prismY(y, y + 0.03, -0.04, 0, 0.233, 0.225, 8, Math.PI / 8);
    for (const s of [1, -1]) for (const y of [-0.08, 0.04]) b.box(0.07, y, s * 0.2, 0.105, 0.04, 0.105);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xff5a10).box(0.19, 0.33, 0, 0.04, 0.03, 0.2);
      chain(b, [[0.19, 0.34, 0], [0.24, 0.42, 0], [0.22, 0.5, 0]], 0.03, 0.02, 4);
    });
  },
};
// Flint: a tyrannosaur. A green scaly body with a pale belly, a long tail swinging behind, tiny arms, a row of team
// plates from the crown down the spine to the tail tip (the line that reads from above), and a big toothy head.
const DINO = 0x4a7a3a, DINO_D = 0x3a6430;
function dinoSpikes(b, pts) { for (const [x, y, h] of pts) b.prismY(y, y + h * 1.4, x, 0, 0.1, 0.0, 4, Math.PI / 4); }
MORE_SUITS.flint = {
  limbs: { bulk: 1.36, hands: 0x3a6a2a, feet: 0x2a4a20, sleeve: 0x4a7a3a, trouser: 0x3e6a32 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(DINO);
      roundBody(b, 0.33, 0.66);
      b.setColor(0xc8c890).box(0.3, 0.3, 0, 0.07, 0.46, 0.34, 0.04);
      b.setColor(DINO);
      chain(b, [[-0.22, 0.14, 0], [-0.5, 0.06, 0.02], [-0.76, 0.02, 0.08], [-1.0, 0.06, 0.16]], 0.2, 0.035, 6);   // Tail.
      b.setColor(DINO_D);
      for (const s of [1, -1]) {                                                                  // Tiny arms.
        seg(b, [0.26, 0.5, s * 0.2], [0.42, 0.42, s * 0.2], 0.04, 0.035, 4);
        b.box(0.45, 0.4, s * 0.2, 0.05, 0.04, 0.06);
      }
    });
    b.setPart(1);
    dinoSpikes(b, [[-0.2, 0.62, 0.14], [-0.3, 0.46, 0.14], [-0.34, 0.3, 0.13], [-0.5, 0.2, 0.13], [-0.72, 0.15, 0.11], [-0.92, 0.15, 0.09]]);
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(DINO).box(0.1, 0.26, 0, 0.36, 0.24, 0.32, 0.04);                     // Skull.
      b.box(0.36, 0.22, 0, 0.22, 0.16, 0.26, 0.03);                                               // Snout.
      b.setColor(DINO_D).box(0.26, 0.07, 0, 0.36, 0.07, 0.26, 0.02);                             // Jaw, open.
      b.box(0.04, 0.12, 0, 0.2, 0.14, 0.28);
      b.setColor(0xf2eee0);
      for (const z of [-0.1, -0.03, 0.04, 0.11]) b.prismY(0.08, 0.14, 0.4, z, 0.02, 0.0, 4).prismY(0.15, 0.1, 0.32, z * 0.9, 0.02, 0.0, 4);   // Teeth.
      b.setColor(0x1a1a14).box(0.47, 0.25, 0.06, 0.012, 0.02, 0.025).box(0.47, 0.25, -0.06, 0.012, 0.02, 0.025);
      b.setColor(DINO_D).box(0.2, 0.39, 0.1, 0.12, 0.04, 0.06).box(0.2, 0.39, -0.1, 0.12, 0.04, 0.06);   // Brows.
    });
    tag(b, ACC, () => b.setPart(0).setColor(0xff5a10).box(0.22, 0.33, 0.165, 0.06, 0.04, 0.012).box(0.22, 0.33, -0.165, 0.06, 0.04, 0.012));
    b.setPart(1);
    dinoSpikes(b, [[0.06, 0.38, 0.12], [-0.06, 0.36, 0.11], [-0.16, 0.3, 0.1]]);
  },
};

// Nyx: a spider. A dark body with a great abdomen behind wearing a team band and marking, eight legs arching off the
// back (from above, the widest outline on the roster), a hood with eight lit eyes and two fangs.
const SPIDER = 0x1e1a26, SPIDER_D = 0x14111a;
MORE_SUITS.nyx = {
  limbs: { bulk: 1.12, hands: SPIDER_D, feet: SPIDER_D, sleeve: 0x1e1c24, trouser: 0x1a1820 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(SPIDER).prismY(-0.06, 0.62, 0, 0, 0.27, 0.27, 8, Math.PI / 8);
      b.prismY(0.62, 0.7, 0, 0, 0.27, 0.18, 8, Math.PI / 8);
      b.prismX(-0.44, -0.2, 0.44, 0, 0.18, 0.31, 8, Math.PI / 8);                                 // Abdomen.
      b.prismX(-0.74, -0.44, 0.44, 0, 0.31, 0.1, 8, Math.PI / 8);
      b.setColor(SPIDER_D);
      for (const s of [1, -1]) for (const [dx, lift] of [[0.26, 0.92], [0.08, 0.98], [-0.1, 0.96], [-0.28, 0.88]]) {
        chain(b, [[-0.06, 0.58, s * 0.2], [-0.06 + dx * 0.8, lift, s * 0.48], [-0.06 + dx * 1.5, 0.66, s * 0.74], [-0.06 + dx * 1.9, 0.12, s * 0.88]], 0.04, 0.02, 4);
      }
    });
    b.setPart(1).prismX(-0.5, -0.42, 0.44, 0, 0.32, 0.32, 8, Math.PI / 8);                        // Team band and marking.
    b.box(-0.6, 0.66, 0, 0.16, 0.06, 0.1).box(-0.34, 0.71, 0, 0.12, 0.06, 0.12);
    for (const s of [1, -1]) for (const [dx, lift] of [[0.26, 0.92], [0.08, 0.98], [-0.1, 0.96], [-0.28, 0.88]]) b.box(-0.06 + dx * 0.8, lift, s * 0.48, 0.07, 0.07, 0.07);
    tag(b, ACC, () => b.setPart(0).setColor(0xff2bd6).box(-0.5, 0.75, 0, 0.1, 0.02, 0.05));
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(SPIDER).prismY(0.0, 0.36, -0.02, 0, 0.24, 0.22, 8, Math.PI / 8);
      b.prismY(0.36, 0.44, -0.02, 0, 0.22, 0.12, 8, Math.PI / 8);
      b.setColor(SPIDER_D);
      for (const s of [1, -1]) chain(b, [[0.18, 0.12, s * 0.05], [0.26, 0.04, s * 0.05], [0.24, -0.06, s * 0.02]], 0.035, 0.012, 4);
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xff2bd6);
      for (const [y, z, r] of [[0.24, 0.06, 0.045], [0.24, -0.06, 0.045], [0.31, 0.12, 0.03], [0.31, -0.12, 0.03], [0.33, 0.04, 0.025], [0.33, -0.04, 0.025], [0.18, 0.14, 0.022], [0.18, -0.14, 0.022]]) {
        b.prismX(0.215, 0.235, y, z, r, r, 6);
      }
    });
    b.setPart(1).box(-0.06, 0.44, 0, 0.2, 0.03, 0.1).box(-0.12, 0.4, 0, 0.08, 0.06, 0.2);
  },
};

// Halcyon: a penguin. A black body with a white front, a team scarf with its tail streaming out, flippers in black and
// feet in orange, a white-masked head with an orange beak, team ear muffs and her goggles pushed up.
const PENG = 0x1a1c22;
MORE_SUITS.halcyon = {
  limbs: { bulk: 1.24, hands: PENG, feet: 0xe8902a, sleeve: PENG, trouser: 0x22242a },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(PENG);
      roundBody(b, 0.32, 0.66);
      b.setColor(0xf2f2ee).box(0.24, 0.26, 0, 0.18, 0.62, 0.44, 0.08);                           // Front.
      b.setColor(PENG).prismX(-0.46, -0.26, 0.04, 0, 0.0, 0.14, 5);                               // Tail.
    });
    b.setPart(1).prismY(0.6, 0.72, 0, 0, 0.29, 0.24, 8, Math.PI / 8);
    chain(b, [[-0.22, 0.66, 0.1], [-0.42, 0.6, 0.22], [-0.6, 0.52, 0.26]], 0.07, 0.05, 4);
    b.box(0.26, 0.5, 0.14, 0.05, 0.22, 0.1);
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(PENG).prismY(0.02, 0.36, 0, 0, 0.22, 0.21, 8, Math.PI / 8);
      b.prismY(0.36, 0.44, 0, 0, 0.21, 0.12, 8, Math.PI / 8);
      b.setColor(0xf2f2ee).box(0.17, 0.2, 0, 0.08, 0.2, 0.3, 0.03);                              // Face mask.
      b.setColor(0x0c0c0e).box(0.215, 0.25, 0.08, 0.012, 0.04, 0.035).box(0.215, 0.25, -0.08, 0.012, 0.04, 0.035);
      b.setColor(0xe8902a).prismX(0.2, 0.38, 0.17, 0, 0.065, 0.0, 4, Math.PI / 4);              // Beak.
      b.setColor(0x1a1c20).box(0.08, 0.38, 0, 0.1, 0.05, 0.36);
    });
    b.setPart(1);
    b.prismZ(0.2, 0.28, 0.0, 0.24, 0.085, 0.08, 8).prismZ(-0.28, -0.2, 0.0, 0.24, 0.08, 0.085, 8);   // Ear muffs.
    b.box(-0.02, 0.43, 0, 0.06, 0.04, 0.48);
    tag(b, ACC, () => b.setPart(0).setColor(0x5affb0).box(0.12, 0.39, 0.075, 0.08, 0.04, 0.09).box(0.12, 0.39, -0.075, 0.08, 0.04, 0.09));
  },
};

// Tinker: a deep-sea diver. A team canvas suit under a riveted brass corselet, a lead weight belt, an air hose off the
// back up to the helmet, and the big brass helmet with a lit front port and two side ports.
const BRASS = 0xc9a240, BRASS_D = 0x8a6a2a;
MORE_SUITS.tinker = {
  limbs: { bulk: 1.36, hands: 0x5a4a30, feet: 0x3a3a3c, sleeve: 0x8a8070, trouser: 0x7a7062 },
  torso(b) {
    b.setPart(1).prismY(-0.08, 0.5, 0, 0, 0.3, 0.31, 8, Math.PI / 8);                             // Canvas suit.
    b.setPart(0).setColor(BRASS).prismY(0.46, 0.68, 0, 0, 0.38, 0.24, 10);                       // Corselet.
    b.setColor(0xa8882e).box(-0.36, 0.34, 0, 0.1, 0.3, 0.28, 0.03);                              // Air manifold.
    tag(b, KEEP, () => {
      b.setPart(0).setColor(BRASS_D);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; b.box(Math.cos(a) * 0.33, 0.55, Math.sin(a) * 0.33, 0.04, 0.03, 0.04); }
      b.setColor(0x4a4a4c).box(0, 0.1, 0, 0.64, 0.08, 0.66);                                      // Weight belt.
      for (const [x, z] of [[0.32, 0.14], [0.32, -0.14], [-0.32, 0.14], [-0.32, -0.14]]) b.box(x, 0.06, z, 0.06, 0.14, 0.12);
      b.setColor(0x1a1a1a);
      chain(b, [[-0.42, 0.4, 0.06], [-0.48, 0.66, 0.16], [-0.36, 0.84, 0.2], [-0.2, 0.86, 0.18]], 0.035, 0.035, 5);
      b.setColor(0x8a9098).box(0.05, 0.06, -0.36, 0.2, 0.05, 0.03);                             // Knife.
    });
    tag(b, ACC, () => b.setPart(0).setColor(0x3affd8).prismX(0.3, 0.33, 0.6, 0.16, 0.04, 0.04, 6));
  },
  head(b) {
    b.setPart(0).setColor(BRASS).prismY(-0.02, 0.36, 0, 0, 0.3, 0.3, 10);                       // Helmet.
    b.prismY(0.36, 0.5, 0, 0, 0.3, 0.14, 10);
    tag(b, KEEP, () => {
      b.setPart(0).setColor(BRASS_D).prismX(0.26, 0.32, 0.2, 0, 0.15, 0.15, 8);                 // Port rims.
      b.prismZ(0.26, 0.32, 0.0, 0.22, 0.09, 0.09, 8).prismZ(-0.32, -0.26, 0.0, 0.22, 0.09, 0.09, 8);
      b.setColor(0x2a2a2a);
      for (const y of [0.15, 0.25]) b.box(0.335, y, 0, 0.012, 0.012, 0.2);                        // Grille.
      b.box(0.335, 0.2, 0, 0.012, 0.2, 0.012);
      b.setColor(BRASS_D).prismY(0.5, 0.56, -0.04, 0, 0.06, 0.05, 6);
      b.prismX(-0.36, -0.28, 0.32, 0, 0.05, 0.05, 6);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; b.box(Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3, 0.035, 0.03, 0.035); }
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0x3affd8).prismX(0.3, 0.33, 0.2, 0, 0.12, 0.12, 8);
      b.prismZ(0.3, 0.33, 0.0, 0.22, 0.07, 0.07, 8).prismZ(-0.33, -0.3, 0.0, 0.22, 0.07, 0.07, 8);
    });
    b.setPart(1).prismY(-0.04, 0.04, 0, 0, 0.315, 0.315, 10);                                     // Team collar.
    b.prismY(0.44, 0.48, 0, 0, 0.22, 0.2, 10);
  },
};

// Rook: a viking. Mail under a team tunic, a fur cloak on the shoulders, a round team shield with a gold boss on the
// back (the big disc from above), a horned helm, and a braided red beard.
const MAIL = 0x7a7e84, FURB = 0x6a5038;
MORE_SUITS.rook = {
  limbs: { bulk: 1.24, hands: 0x4a3020, feet: 0x3a2a1a, sleeve: 0x6a5a48, trouser: 0x4a4a52 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(MAIL).prismY(-0.16, 0.04, 0, 0, 0.31, 0.29, 8, Math.PI / 8);
      b.setColor(FURB).prismY(0.54, 0.7, -0.03, 0, 0.42, 0.27, 8, Math.PI / 8);
      shag(b, 41, 14, { y0: 0.56, y1: 0.66, r0: 0.34, r1: 0.42, drop: 0.5, len: 0.14, w: 0.05, cols: [FURB, 0x5a4030, 0x7a6048] });
      b.setColor(0x3a2a1a).box(0, 0.12, 0, 0.6, 0.06, 0.62);
      b.setColor(0x2a2a2e).prismX(-0.46, -0.35, 0.38, 0, 0.37, 0.37, 12);                        // Shield rim.
      b.setColor(0x5a4030);
      seg(b, [0.1, 0.16, 0.3], [-0.3, -0.1, 0.36], 0.025, 0.025, 4);                              // Axe at the hip.
      b.setColor(0x8a9098).box(-0.28, -0.12, 0.36, 0.1, 0.14, 0.03);
    });
    b.setPart(1).prismY(0.02, 0.56, 0, 0, 0.3, 0.295, 8, Math.PI / 8);                           // Tunic.
    b.prismX(-0.49, -0.45, 0.38, 0, 0.33, 0.33, 12);                                             // Shield.
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xd9b44a).prismX(-0.56, -0.48, 0.38, 0, 0.05, 0.09, 8);
      b.box(0.31, 0.12, 0, 0.03, 0.08, 0.1);
    });
  },
  head(b) {
    tag(b, TONE, () => b.setPart(0).setColor(0x7a5c43).prismY(0.04, 0.3, 0, 0, 0.17, 0.16, 7));
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x0c0a08).box(0.16, 0.22, 0.06, 0.02, 0.025, 0.04).box(0.16, 0.22, -0.06, 0.02, 0.025, 0.04);
      b.setColor(0xc8602a).box(0.12, 0.08, 0, 0.14, 0.16, 0.28);                                  // Beard and braid.
      b.box(0.18, 0.15, 0, 0.04, 0.03, 0.18);
      seg(b, [0.18, 0.0, 0], [0.22, -0.2, 0], 0.045, 0.025, 4);
      b.setColor(0xe8dcc0);
      for (const s of [1, -1]) chain(b, [[-0.01, 0.32, s * 0.2], [0.0, 0.4, s * 0.32], [0.08, 0.56, s * 0.36]], 0.065, 0.018, 5);
    });
    b.setPart(0).setColor(0x5a6068).prismY(0.24, 0.44, -0.01, 0, 0.21, 0.08, 8, Math.PI / 8);    // Helm.
    b.setColor(0x4a5058).box(0.19, 0.2, 0, 0.04, 0.16, 0.04);
    b.setPart(1).prismY(0.24, 0.29, -0.01, 0, 0.215, 0.215, 8, Math.PI / 8);
    b.box(-0.01, 0.42, 0, 0.36, 0.04, 0.05);
  },
};

// Mako: a shark. A grey body with a white belly, a tall team dorsal fin (the shark from above), pectoral fins, a tail
// with its fin, lit gill slits, and a shark-head hood with the wearer's face looking out of the toothy mouth.
const SHARK = 0x6a7a88;
MORE_SUITS.mako = {
  limbs: { bulk: 1.28, hands: 0x5a6a78, feet: 0x4a5a68, sleeve: SHARK, trouser: 0x5a6a78 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(SHARK);
      roundBody(b, 0.32, 0.66);
      b.setColor(0xe8ecee).box(0.27, 0.28, 0, 0.1, 0.52, 0.36, 0.05);
      b.setColor(SHARK);
      for (const s of [1, -1]) plate(b, [0.04, 0.46, s * 0.3], [-0.12, 0.2, s * 0.56], 0.2, 0.04);   // Pectoral fins.
      chain(b, [[-0.24, 0.12, 0], [-0.5, 0.04, 0], [-0.72, 0.02, 0]], 0.16, 0.05, 6);               // Tail.
      b.extrude([[-0.68, 0.0], [-0.92, 0.26], [-0.84, 0.0], [-0.92, -0.18]], -0.02, 0.02);
    });
    b.setPart(1).extrude([[0.02, 0.6], [-0.32, 0.58], [-0.3, 1.08], [-0.16, 0.86]], -0.04, 0.04);   // Dorsal fin.
    harness(b, 0.33, 0.2);
    b.prismY(0.6, 0.66, 0, 0, 0.25, 0.22, 8, Math.PI / 8);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xff2bd6);
      for (const s of [1, -1]) for (const x of [0.06, 0.12, 0.18]) b.box(x, 0.52, s * 0.29, 0.02, 0.12, 0.02);
    });
  },
  head(b) {
    tag(b, TONE, () => b.setPart(0).setColor(0x7a5c43).box(0.12, 0.17, 0, 0.12, 0.16, 0.22));
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x0c0a08).box(0.185, 0.2, 0.05, 0.012, 0.025, 0.035).box(0.185, 0.2, -0.05, 0.012, 0.025, 0.035);
      b.setColor(SHARK).prismY(0.26, 0.44, -0.04, 0, 0.25, 0.15, 8, Math.PI / 8);                // Upper head.
      b.box(0.26, 0.33, 0, 0.26, 0.14, 0.28, 0.04);                                               // Snout.
      b.prismY(0.0, 0.26, -0.06, 0, 0.22, 0.24, 8, Math.PI / 8);
      b.setColor(0xe8ecee).box(0.2, 0.03, 0, 0.18, 0.06, 0.3);                                   // Lower jaw.
      b.setColor(0xffffff);
      for (const z of [-0.1, -0.05, 0, 0.05, 0.1]) b.prismY(0.26, 0.2, 0.22, z, 0.022, 0.0, 4).prismY(0.06, 0.12, 0.22, z, 0.02, 0.0, 4);
      b.setColor(0x0c0a08).box(0.28, 0.37, 0.14, 0.04, 0.035, 0.012).box(0.28, 0.37, -0.14, 0.04, 0.035, 0.012);
    });
    b.setPart(1).extrude([[0.0, 0.42], [-0.18, 0.42], [-0.16, 0.62]], -0.03, 0.03);
  },
};

// Seraph: a phoenix. Flame-red plumage, two great wings fanned off the back with team coverts and lit tips (from above
// a fan of team and fire), long tail feathers, a beaked head and a crest of lit flame feathers.
const PHX = 0xc83a1a, PHX_O = 0xe86a1a, PHX_Y = 0xf0b030;
MORE_SUITS.seraph = {
  limbs: { bulk: 1.1, hands: 0xd84a1a, feet: 0xd8a020, sleeve: 0xc83a1a, trouser: 0xa82a14 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(PHX).prismY(-0.06, 0.62, 0, 0, 0.26, 0.29, 8, Math.PI / 8);
      b.prismY(0.62, 0.7, 0, 0, 0.29, 0.18, 8, Math.PI / 8);
      b.setColor(PHX_Y);
      for (let i = 0; i < 3; i++) plate(b, [0.27, 0.56 - i * 0.14, 0], [0.31, 0.44 - i * 0.14, 0], 0.3 - i * 0.05, 0.03);   // Breast.
      for (const s of [1, -1]) for (let i = 0; i < 5; i++) {                                       // Primaries.
        const a = 0.25 + i * 0.28;
        b.setColor(i < 2 ? PHX : i < 4 ? PHX_O : PHX_Y);
        plate(b, [-0.24, 0.6, s * 0.14], [-0.28 - Math.sin(a) * 0.4, 0.66 + Math.cos(a) * 0.32, s * (0.32 + Math.sin(a) * 0.5)], 0.13, 0.025);
      }
      for (const z of [-0.08, 0, 0.08]) { b.setColor(z ? PHX_O : PHX); plate(b, [-0.24, 0.1, z * 0.5], [-0.72, -0.2, z * 1.6], 0.09, 0.025); }
    });
    b.setPart(1);
    for (const s of [1, -1]) for (let i = 0; i < 3; i++) {                                         // Coverts.
      const a = 0.4 + i * 0.36;
      plate(b, [-0.22, 0.62, s * 0.14], [-0.24 - Math.sin(a) * 0.26, 0.68 + Math.cos(a) * 0.2, s * (0.26 + Math.sin(a) * 0.3)], 0.16, 0.035);
    }
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffd659);
      for (const s of [1, -1]) for (let i = 0; i < 5; i++) {
        const a = 0.25 + i * 0.28;
        b.prismY(0.66 + Math.cos(a) * 0.32 - 0.03, 0.66 + Math.cos(a) * 0.32 + 0.09, -0.28 - Math.sin(a) * 0.4, s * (0.32 + Math.sin(a) * 0.5), 0.06, 0.0, 4);
      }
      b.prismX(0.3, 0.32, 0.44, 0, 0.05, 0.05, 6);
    });
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(PHX).prismY(0.02, 0.36, 0, 0, 0.2, 0.19, 8, Math.PI / 8);
      b.setColor(PHX_O).box(0.16, 0.22, 0, 0.08, 0.16, 0.28, 0.02);
      b.setColor(PHX_Y).prismX(0.2, 0.36, 0.17, 0, 0.06, 0.0, 4, Math.PI / 4);
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffd659).box(0.205, 0.26, 0.08, 0.012, 0.03, 0.05).box(0.205, 0.26, -0.08, 0.012, 0.03, 0.05);
      for (const [x, y, z, l] of [[0.08, 0.36, 0, 0.3], [0.0, 0.36, 0.07, 0.34], [0.0, 0.36, -0.07, 0.34], [-0.08, 0.34, 0, 0.36]]) {
        seg(b, [x, y, z], [x - l * 0.7, y + l * 0.8, z * 2.2], 0.05, 0.01, 4);
      }
    });
    b.setPart(1).prismY(0.33, 0.38, -0.02, 0, 0.2, 0.17, 8, Math.PI / 8);
  },
};

// Warden: a wizard. A team robe sweeping to the floor scattered with lit stars, a rope belt, a staff on the back with
// a lit orb (his lantern, still), a long white beard, and a broad pointed hat with a team band and a crooked tip.
const NIGHT = 0x2a2a5a;
MORE_SUITS.warden = {
  limbs: { bulk: 1.12, hands: 0x8a6a4a, feet: 0x3a2a1a, sleeve: 0x2c2c5c, trouser: 0x22224a },
  torso(b) {
    b.setPart(1).prismY(-0.42, 0.2, 0, 0, 0.38, 0.27, 8, Math.PI / 8);                           // Robe.
    b.prismY(0.2, 0.62, 0, 0, 0.27, 0.29, 8, Math.PI / 8);
    tag(b, KEEP, () => {
      b.setPart(0).setColor(NIGHT).prismY(0.52, 0.68, -0.02, 0, 0.36, 0.22, 8, Math.PI / 8);     // Mantle.
      b.setColor(0xc8b080).prismY(0.12, 0.17, 0, 0, 0.3, 0.3, 8, Math.PI / 8);                   // Rope belt.
      seg(b, [0.28, 0.14, 0.08], [0.32, -0.1, 0.1], 0.02, 0.02, 4);
      b.setColor(0x5a3a1c);
      seg(b, [-0.34, -0.3, 0.22], [-0.36, 1.2, -0.2], 0.03, 0.035, 5);                            // Staff.
      b.prismY(1.16, 1.24, -0.36, -0.2, 0.07, 0.05, 6);
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffe08a);
      b.prismY(1.24, 1.38, -0.36, -0.2, 0.08, 0.06, 7);                                           // The orb.
      for (const [x, y, z] of [[0.3, -0.2, 0.12], [0.24, 0.0, -0.2], [0.0, -0.3, 0.33], [-0.2, -0.1, -0.3], [0.2, 0.4, 0.2], [-0.28, 0.32, 0.1]]) b.box(x, y, z, 0.04, 0.04, 0.04);
    });
  },
  head(b) {
    tag(b, TONE, () => b.setPart(0).setColor(0x7a5c43).prismY(0.06, 0.3, 0, 0, 0.16, 0.16, 7));
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x0c0a08).box(0.158, 0.22, 0.06, 0.02, 0.025, 0.04).box(0.158, 0.22, -0.06, 0.02, 0.025, 0.04);
      b.setColor(0xf0ece4).box(0.16, 0.26, 0, 0.04, 0.03, 0.26);                                 // Brows.
      b.box(0.14, 0.06, 0, 0.12, 0.16, 0.28, 0.03);                                               // Beard.
      b.prismY(-0.34, 0.0, 0.17, 0, 0.0, 0.12, 6);
      b.setColor(NIGHT).prismY(0.3, 0.33, -0.02, 0, 0.42, 0.42, 12);                            // Hat.
      b.prismY(0.33, 0.7, -0.04, 0, 0.2, 0.08, 8, Math.PI / 8);
      seg(b, [-0.04, 0.68, 0], [-0.26, 0.88, 0.04], 0.085, 0.0, 6);
    });
    b.setPart(1).prismY(0.33, 0.4, -0.04, 0, 0.205, 0.19, 8, Math.PI / 8);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffe08a);
      for (const [x, z] of [[0.3, 0.1], [-0.12, 0.33], [-0.3, -0.18], [0.1, -0.32]]) b.box(x, 0.34, z, 0.05, 0.02, 0.05);
      b.box(0.17, 0.5, 0, 0.04, 0.05, 0.05);
    });
  },
};
// Courier: a ninja. A black gi with a team sash whose tails stream behind, a sword across the back with a team-wrapped
// hilt, the case strapped across the small of the back, lit shuriken on the belt, and a hood with a team headband.
const SHINOBI = 0x1c1c22;
MORE_SUITS.courier = {
  limbs: { bulk: 1.04, hands: 0x18181c, feet: 0x18181c, sleeve: 0x1e1e24, trouser: 0x1a1a20 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(SHINOBI).prismY(-0.1, 0.62, 0, 0, 0.27, 0.28, 8, Math.PI / 8);
      b.prismY(0.62, 0.7, 0, 0, 0.28, 0.18, 8, Math.PI / 8);
      b.setColor(0x2a2a32);
      plate(b, [0.29, 0.64, 0.2], [0.29, 0.14, -0.16], 0.1, 0.02);
      plate(b, [0.29, 0.64, -0.2], [0.29, 0.14, 0.16], 0.1, 0.02);
      b.setColor(0x101014);
      seg(b, [-0.34, 0.04, 0.3], [-0.36, 0.96, -0.26], 0.03, 0.03, 4);                            // Sword.
    });
    b.setPart(0).setColor(0xc9a240).prismZ(-0.26, 0.26, -0.33, 0.24, 0.08, 0.08, 7);             // The case.
    b.setPart(1).prismY(0.1, 0.19, 0, 0, 0.29, 0.29, 8, Math.PI / 8);                             // Sash.
    for (const s of [1, -1]) b.box(-0.01, 0.66, s * 0.27, 0.3, 0.05, 0.16, 0.02);                // Shoulder guards.
    chain(b, [[-0.28, 0.16, 0.06], [-0.46, 0.08, 0.12], [-0.64, 0.06, 0.2]], 0.05, 0.03, 4);
    chain(b, [[-0.28, 0.16, -0.04], [-0.48, 0.12, -0.08], [-0.62, 0.02, -0.16]], 0.05, 0.03, 4);
    seg(b, [-0.36, 0.96, -0.26], [-0.37, 1.16, -0.38], 0.035, 0.035, 4);                         // Hilt.
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffe08a).prismX(-0.4, -0.32, 0.96, -0.26, 0.06, 0.06, 6);
      for (const z of [0.12, -0.12]) { b.box(0.29, 0.15, z, 0.02, 0.1, 0.03).box(0.29, 0.15, z, 0.02, 0.03, 0.1); }
    });
  },
  head(b) {
    tag(b, TONE, () => b.setPart(0).setColor(0x7a5c43).box(0.17, 0.23, 0, 0.05, 0.08, 0.26));
    tag(b, KEEP, () => {
      b.setPart(0).setColor(SHINOBI).prismY(0.0, 0.38, -0.01, 0, 0.21, 0.19, 8, Math.PI / 8);
      b.prismY(0.38, 0.46, -0.01, 0, 0.19, 0.1, 8, Math.PI / 8);
      b.setColor(0x0c0a08).box(0.2, 0.235, 0.065, 0.012, 0.025, 0.045).box(0.2, 0.235, -0.065, 0.012, 0.025, 0.045);
    });
    b.setPart(1).prismY(0.28, 0.34, -0.01, 0, 0.215, 0.205, 8, Math.PI / 8);                     // Hachimaki and tails.
    chain(b, [[-0.2, 0.31, 0.04], [-0.38, 0.28, 0.12], [-0.54, 0.2, 0.18]], 0.035, 0.02, 4);
    chain(b, [[-0.2, 0.31, -0.04], [-0.4, 0.3, -0.06], [-0.56, 0.24, -0.12]], 0.035, 0.02, 4);
    tag(b, ACC, () => b.setPart(0).setColor(0xffe08a).box(0.21, 0.31, 0, 0.02, 0.05, 0.12));
  },
};

// Nightjar: a wolf. Grey fur with a pale ruff, a big brush of a tail, a torn team bandana and harness, and a long
// wolf's head with tall ears and lit eyes.
const WOLF = 0x6a6e74, WOLF_L = 0xc8ccd0, WOLF_D = 0x4a4e54;
MORE_SUITS.nightjar = {
  limbs: { bulk: 1.32, hands: WOLF_D, feet: 0x3a3e44, sleeve: WOLF, trouser: 0x5a5e64 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(WOLF);
      roundBody(b, 0.32, 0.66);
      b.setColor(WOLF_L).box(0.29, 0.38, 0, 0.08, 0.4, 0.3, 0.04);
      shag(b, 51, 14, { y0: 0.56, y1: 0.66, r0: 0.26, r1: 0.32, drop: 0.5, len: 0.14, w: 0.05, cols: [WOLF_L, WOLF, 0xa8acb2], skipFront: 0 });
      b.setColor(WOLF);
      seg(b, [-0.26, 0.16, 0], [-0.52, 0.0, 0.06], 0.08, 0.13, 6);                               // Tail.
      seg(b, [-0.52, 0.0, 0.06], [-0.78, -0.04, 0.12], 0.13, 0.05, 6);
      b.setColor(WOLF_L).prismX(-0.86, -0.76, -0.04, 0.12, 0.05, 0.0, 5);
    });
    harness(b, 0.33, 0.2);
    b.prismY(0.6, 0.7, 0, 0, 0.29, 0.25, 8, Math.PI / 8);                                       // Bandana, torn tail.
    plate(b, [-0.24, 0.66, 0.02], [-0.42, 0.5, 0.1], 0.1, 0.02);
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(WOLF).prismY(0.02, 0.34, 0, 0, 0.21, 0.19, 8, Math.PI / 8);
      b.box(0.28, 0.17, 0, 0.26, 0.12, 0.16, 0.03);                                               // Snout.
      b.setColor(WOLF_L).box(0.27, 0.09, 0, 0.24, 0.05, 0.14).box(0.12, 0.12, 0, 0.12, 0.14, 0.3);
      b.setColor(0x101012).box(0.415, 0.2, 0, 0.03, 0.05, 0.07);
      b.setColor(WOLF);
      for (const s of [1, -1]) b.prismY(0.3, 0.52, -0.02, s * 0.12, 0.08, 0.0, 4, Math.PI / 4);   // Ears.
      b.setColor(WOLF_D);
      for (const s of [1, -1]) b.prismY(0.32, 0.46, 0.012, s * 0.12, 0.045, 0.0, 4, Math.PI / 4);
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0x18e8ff);
      for (const s of [1, -1]) plate(b, [0.18, 0.25, s * 0.05], [0.18, 0.28, s * 0.13], 0.03, 0.02);
    });
  },
};

// Skylark: an astronaut. A white suit with team patches, a chest control unit in the skin's colours with lit buttons,
// a big life-support pack with a team stripe, and the round helmet with a lit gold visor.
const EVA = 0xe8e8ec;
MORE_SUITS.skylark = {
  limbs: { bulk: 1.34, hands: 0xd0d0d4, feet: 0xd8d8dc, sleeve: EVA, trouser: 0xe0e0e4 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(EVA).box(0, 0.32, 0, 0.44, 0.72, 0.58, 0.06);
      b.setColor(0xb8bcc4).prismY(0.0, 0.06, 0, 0, 0.31, 0.31, 8, Math.PI / 8);
      b.setColor(EVA).box(-0.37, 0.42, 0, 0.24, 0.56, 0.52, 0.04);                               // Life support pack.
      b.setColor(0x6a7888);
      chain(b, [[0.24, 0.3, 0.16], [0.2, 0.12, 0.3], [-0.06, 0.1, 0.34], [-0.26, 0.24, 0.28]], 0.025, 0.025, 4);
    });
    b.setPart(0).setColor(0x5a7888).box(0.27, 0.42, 0, 0.1, 0.18, 0.32, 0.02);                   // Control unit.
    b.setPart(1);
    for (const s of [1, -1]) b.box(0.0, 0.66, s * 0.26, 0.24, 0.04, 0.14);
    b.box(-0.495, 0.42, 0, 0.02, 0.1, 0.52).box(-0.37, 0.705, 0, 0.2, 0.02, 0.46);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0x5affb0);
      for (const z of [-0.08, 0, 0.08]) b.box(0.325, 0.45, z, 0.012, 0.03, 0.04);
      b.box(-0.495, 0.58, 0.14, 0.02, 0.04, 0.06);
    });
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(EVA).prismY(-0.02, 0.36, 0, 0, 0.27, 0.28, 10);
      b.prismY(0.36, 0.5, 0, 0, 0.28, 0.14, 10);
      b.setColor(0xb8bcc4).box(0.12, 0.4, 0.24, 0.1, 0.06, 0.06);
      b.setColor(0x8a9098).prismY(0.48, 0.62, -0.1, -0.12, 0.012, 0.008, 4);
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0x5affb0).box(0.22, 0.22, 0, 0.12, 0.22, 0.38, 0.04);                // Visor.
      b.box(0.18, 0.4, 0.3, 0.04, 0.04, 0.012);
    });
    b.setPart(1).prismY(-0.04, 0.03, 0, 0, 0.29, 0.29, 10);
    b.box(-0.02, 0.5, 0, 0.36, 0.025, 0.08);
  },
};

// Gambit: a cowboy. A team shirt under a leather vest with a lit star, a gun belt with two holsters and a lariat, a team
// bandana, a handlebar moustache, and a tall tan hat whose brim curls up at the sides.
const LEATHER = 0x6a4022, TAN = 0xc8a070;
MORE_SUITS.gambit = {
  limbs: { bulk: 1.1, hands: 0x6a4a2a, feet: 0x5a3a20, sleeve: 0xd8c8a8, trouser: 0x3a4a6a },
  torso(b) {
    b.setPart(1).prismY(0.0, 0.62, 0, 0, 0.26, 0.28, 8, Math.PI / 8);                             // Shirt.
    b.prismY(0.6, 0.7, 0, 0, 0.24, 0.2, 8, Math.PI / 8);                                         // Bandana.
    b.prismX(0.2, 0.3, 0.52, 0, 0.12, 0.0, 4, Math.PI / 4);
    tag(b, KEEP, () => {
      b.setPart(0).setColor(LEATHER);
      for (const s of [1, -1]) b.box(0.24, 0.38, s * 0.15, 0.06, 0.48, 0.14, 0.02);               // Vest.
      b.box(-0.24, 0.38, 0, 0.06, 0.5, 0.48, 0.02);
      for (const s of [1, -1]) b.box(0.0, 0.6, s * 0.21, 0.42, 0.06, 0.12);
      b.setColor(0x3a2414).box(0, 0.08, 0, 0.6, 0.07, 0.62);                                      // Gun belt.
      for (const s of [1, -1]) b.box(0.02, -0.06, s * 0.33, 0.12, 0.2, 0.07);
      b.setColor(0x2a2a2e);
      for (const s of [1, -1]) b.box(0.08, 0.06, s * 0.36, 0.06, 0.08, 0.04);
      b.setColor(0xb89a5a);                                                                       // Lariat on the hip.
      const pts = [];
      for (let i = 0; i <= 8; i++) { const a = (i / 8) * TAU; pts.push([-0.12 + Math.cos(a) * 0.12, 0.12 + Math.sin(a) * 0.12, -0.36]); }
      chain(b, pts, 0.022, 0.022, 4);
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffd659).prismX(0.27, 0.285, 0.48, 0.15, 0.05, 0.05, 5, Math.PI / 2);
      for (const z of [-0.2, -0.1, 0.1, 0.2]) b.box(0.3, 0.08, z, 0.012, 0.04, 0.02);
    });
  },
  head(b) {
    tag(b, TONE, () => b.setPart(0).setColor(0x7a5c43).prismY(0.04, 0.3, 0, 0, 0.165, 0.16, 7));
    tag(b, LOCKS, () => {
      b.setPart(0).box(0.175, 0.16, 0, 0.03, 0.03, 0.14);                                          // Handlebar.
      for (const s of [1, -1]) seg(b, [0.175, 0.16, s * 0.07], [0.17, 0.2, s * 0.13], 0.016, 0.01, 4);
    });
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x0c0a08).box(0.158, 0.23, 0.06, 0.02, 0.025, 0.04).box(0.158, 0.23, -0.06, 0.02, 0.025, 0.04);
      b.setColor(TAN).prismY(0.3, 0.33, -0.02, 0, 0.36, 0.36, 12);                               // Brim.
      for (const s of [1, -1]) plate(b, [-0.24, 0.33, s * 0.3], [0.24, 0.33, s * 0.3], 0.16, 0.03, s * 0.9);
      b.prismY(0.33, 0.52, -0.02, 0, 0.19, 0.15, 8, Math.PI / 8);
      b.setColor(0xa8844e).box(-0.02, 0.52, 0, 0.18, 0.02, 0.04);
    });
    b.setPart(1).prismY(0.33, 0.39, -0.02, 0, 0.195, 0.188, 8, Math.PI / 8);
  },
};

// Corvid: a scarecrow. A patched team coat stuffed with straw, a rope belt, the crossbar of his post across the shoulders
// (from above, the widest bar on the roster) with a crow riding on it, a stitched sack head with lit eyes, and a
// floppy straw hat with a team band.
const BURLAP = 0xc8b078, STRAW = 0xd8c060;
MORE_SUITS.corvid = {
  limbs: { bulk: 1.12, hands: STRAW, feet: 0x3a2a1a, sleeve: 0x4a3e30, trouser: 0x6a5a40 },
  torso(b) {
    b.setPart(1).prismY(-0.16, 0.62, 0, 0, 0.31, 0.29, 8, Math.PI / 8);                           // Coat.
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x8a7a50).box(0.29, 0.36, 0.1, 0.02, 0.14, 0.12).box(-0.29, 0.2, -0.08, 0.02, 0.16, 0.14);   // Patches.
      b.setColor(0x6a5a8a).box(0.27, 0.0, -0.12, 0.02, 0.12, 0.1);
      b.setColor(0xb89a5a).prismY(0.08, 0.13, 0, 0, 0.32, 0.32, 8, Math.PI / 8);                  // Rope belt.
      shag(b, 61, 18, { y0: 0.6, y1: 0.66, r0: 0.18, r1: 0.26, drop: -0.2, len: 0.12, w: 0.03, cols: [STRAW, 0xe8d070, 0xb8a050] });
      shag(b, 62, 12, { y0: -0.14, y1: -0.1, r0: 0.28, r1: 0.32, drop: 0.6, len: 0.12, w: 0.03, cols: [STRAW, 0xe8d070] });
      b.setColor(0x5a4030);
      seg(b, [-0.22, 0.62, -0.78], [-0.22, 0.62, 0.78], 0.04, 0.04, 5);                           // Crossbar and post.
      seg(b, [-0.22, -0.2, 0], [-0.22, 0.92, 0], 0.045, 0.045, 5);
      b.setColor(0x141216).prismX(-0.34, -0.08, 0.72, 0.66, 0.06, 0.08, 6);                       // The crow.
      b.prismY(0.74, 0.86, -0.04, 0.66, 0.06, 0.05, 6);
      b.setColor(0xe8a020).prismX(0.0, 0.08, 0.81, 0.66, 0.02, 0.0, 4);
      plate(b, [-0.3, 0.74, 0.66], [-0.46, 0.7, 0.66], 0.08, 0.015);
    });
    tag(b, ACC, () => b.setPart(0).setColor(0xff2bd6).box(-0.01, 0.83, 0.69, 0.012, 0.015, 0.015).box(-0.01, 0.83, 0.63, 0.012, 0.015, 0.015));
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(BURLAP).prismY(0.02, 0.36, 0, 0, 0.19, 0.21, 8, Math.PI / 8);         // Sack.
      b.setColor(0xb89a5a).prismY(0.02, 0.07, 0, 0, 0.2, 0.2, 8, Math.PI / 8);
      b.setColor(0x2a2018).box(0.2, 0.12, 0, 0.012, 0.015, 0.2);                                 // Stitched mouth.
      for (const z of [-0.08, -0.03, 0.02, 0.07]) b.box(0.2, 0.12, z, 0.012, 0.05, 0.01);
      b.setColor(STRAW).prismY(0.33, 0.36, -0.02, 0, 0.38, 0.35, 9);                              // Straw hat.
      b.prismY(0.36, 0.5, -0.02, 0, 0.18, 0.14, 7);
      shag(b, 63, 8, { y0: 0.3, y1: 0.33, r0: 0.18, r1: 0.22, drop: 0.5, len: 0.1, w: 0.025, cols: [STRAW, 0xe8d070] });
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xff2bd6);
      for (const s of [1, -1]) b.prismX(0.2, 0.215, 0.22, s * 0.075, 0.04, 0.04, 3, Math.PI / 2);
    });
    b.setPart(1).prismY(0.36, 0.41, -0.02, 0, 0.185, 0.18, 7);
  },
};

// Linnet: a pirate. A long team coat with gold buttons, a cutlass, a treasure chest on her back spilling lit gold, a
// parrot on her shoulder, an eye patch, and a black tricorn (a triangle from above) with a team plume.
MORE_SUITS.linnet = {
  limbs: { bulk: 1.1, hands: 0x6a4a2a, feet: 0x2a1a10, sleeve: 0xe8e0d0, trouser: 0x3a2a24 },
  torso(b) {
    b.setPart(1).prismY(-0.3, 0.2, 0, 0, 0.33, 0.27, 8, Math.PI / 8);                             // Coat.
    b.prismY(0.2, 0.62, 0, 0, 0.27, 0.29, 8, Math.PI / 8);
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0xe8e0d0).box(0.28, 0.42, 0, 0.03, 0.34, 0.12);                       // Shirt front.
      b.setColor(0x2a1a10).box(0, 0.14, 0, 0.6, 0.07, 0.62);
      b.setColor(0x8a9098);
      seg(b, [0.04, 0.1, -0.33], [-0.5, -0.12, -0.38], 0.03, 0.015, 4);                          // Cutlass.
      b.setColor(0x6a4422).box(-0.38, 0.4, 0, 0.24, 0.3, 0.5, 0.02);                             // Treasure chest.
      b.prismZ(-0.25, 0.25, -0.38, 0.55, 0.13, 0.13, 6);
      b.setColor(0xc82a1a).prismY(0.66, 0.84, 0.0, 0.28, 0.06, 0.05, 6);                         // Parrot.
      b.setColor(0x2a9a3a);
      plate(b, [-0.02, 0.8, 0.28], [-0.2, 0.62, 0.3], 0.07, 0.02);
      b.setColor(0x2a6ab0);
      plate(b, [-0.02, 0.74, 0.3], [-0.16, 0.56, 0.34], 0.05, 0.02);
      b.setColor(0xe8c020).prismX(0.05, 0.11, 0.8, 0.28, 0.02, 0.0, 4);
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffe08a);
      for (const y of [0.24, 0.36, 0.48]) b.box(0.295, y, 0.1, 0.012, 0.03, 0.03).box(0.295, y, -0.1, 0.012, 0.03, 0.03);
      b.box(0.31, 0.14, 0, 0.012, 0.06, 0.08);
      b.box(-0.38, 0.4, 0, 0.25, 0.04, 0.51).box(-0.38, 0.4, 0, 0.04, 0.31, 0.51);
      for (const [x, z] of [[-0.34, 0.1], [-0.4, -0.06], [-0.32, -0.16], [-0.44, 0.16]]) b.prismY(0.66, 0.7, x, z, 0.04, 0.04, 6);
    });
  },
  head(b) {
    tag(b, TONE, () => b.setPart(0).setColor(0x7a5c43).prismY(0.04, 0.3, 0, 0, 0.165, 0.16, 7));
    tag(b, LOCKS, () => {
      b.setPart(0);
      skullBack(b);
      seg(b, [-0.16, 0.24, 0], [-0.28, 0.0, 0], 0.05, 0.035, 5);
      seg(b, [-0.28, 0.0, 0], [-0.3, -0.24, 0], 0.035, 0.025, 5);
    });
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x0c0a08).box(0.158, 0.23, 0.06, 0.02, 0.025, 0.04);
      b.box(0.165, 0.23, -0.06, 0.02, 0.07, 0.07);                                              // Eye patch.
      b.box(0.08, 0.27, -0.0, 0.18, 0.015, 0.34);
      b.setColor(0x16141a).prismY(0.3, 0.37, -0.02, 0, 0.4, 0.36, 3);                            // Tricorn.
      b.prismY(0.37, 0.48, -0.03, 0, 0.18, 0.14, 8, Math.PI / 8);
      b.setColor(0xf2eee0).box(0.15, 0.42, 0, 0.012, 0.05, 0.05);
    });
    tag(b, ACC, () => b.setPart(0).setColor(0xffe08a).prismY(0.365, 0.385, -0.02, 0, 0.385, 0.385, 3));
    b.setPart(1);
    chain(b, [[-0.06, 0.44, 0.1], [-0.22, 0.58, 0.16], [-0.42, 0.56, 0.2]], 0.05, 0.02, 4);
  },
};

// Garrison: a walking tank. A hull in the skin's armour with team fenders over two tracks, exhausts and the company
// radio's whip, and a turret for a head with a team hatch and a long gun laid along his aim.
MORE_SUITS.garrison = {
  limbs: { bulk: 1.36, hands: 0x3a3a30, feet: 0x2a2a24, sleeve: 0x4a5040, trouser: 0x3a4030 },
  torso(b) {
    b.setPart(0).setColor(0x5a6048).box(0, 0.34, 0, 0.52, 0.5, 0.56, 0.04);                       // Hull.
    b.setColor(0x6a7058);
    plate(b, [0.26, 0.12, 0], [0.34, 0.5, 0], 0.5, 0.05);                                         // Glacis.
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x22221e);
      for (const s of [1, -1]) {
        b.box(0, 0.22, s * 0.38, 0.72, 0.28, 0.14, 0.07);                                        // Tracks.
        b.setColor(0x6a6a62);
        for (const x of [-0.24, -0.08, 0.08, 0.24]) b.prismZ(s > 0 ? 0.45 : -0.47, s > 0 ? 0.47 : -0.45, x, 0.2, 0.08, 0.08, 7);
        b.setColor(0x22221e);
      }
      b.setColor(0x3a3a34).prismY(0.5, 0.74, -0.28, 0.16, 0.035, 0.03, 5).prismY(0.5, 0.74, -0.28, -0.16, 0.035, 0.03, 5);
      b.setColor(0x141414).prismY(0.6, 1.5, -0.2, -0.22, 0.012, 0.008, 4);
    });
    b.setPart(1).box(0, 0.6, 0, 0.48, 0.03, 0.52);                                                // Deck and fenders.
    for (const s of [1, -1]) b.box(0, 0.37, s * 0.38, 0.76, 0.03, 0.18);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xff5a10).prismY(0.74, 0.78, -0.28, 0.16, 0.03, 0.03, 5).prismY(0.74, 0.78, -0.28, -0.16, 0.03, 0.03, 5);
      b.prismY(1.5, 1.55, -0.2, -0.22, 0.025, 0.025, 5);
      b.box(0.35, 0.36, 0.18, 0.02, 0.04, 0.06).box(0.35, 0.36, -0.18, 0.02, 0.04, 0.06);
    });
  },
  head(b) {
    b.setPart(0).setColor(0x5a6048).box(-0.02, 0.2, 0, 0.48, 0.24, 0.44, 0.05);                   // Turret.
    b.setColor(0x4a5040).box(0.25, 0.2, 0, 0.08, 0.16, 0.22, 0.02);                               // Mantlet.
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x2a2a26).prismX(0.28, 0.8, 0.2, 0, 0.045, 0.04, 6);
      b.box(0.8, 0.2, 0, 0.1, 0.07, 0.09);
      b.setColor(0x3a3a34).prismX(0.12, 0.3, 0.34, -0.12, 0.015, 0.015, 4);
    });
    b.setPart(1).box(-0.04, 0.33, 0, 0.38, 0.03, 0.36);
    b.prismY(0.34, 0.41, -0.1, 0.1, 0.09, 0.08, 8);
    tag(b, ACC, () => b.setPart(0).setColor(0xff5a10).box(0.226, 0.26, 0.12, 0.012, 0.025, 0.08).box(0.226, 0.26, -0.12, 0.012, 0.025, 0.08));
  },
};

// Brigid: a dragon. Purple scales with a gold-plated belly, two bat wings off the back with team membranes (from above
// two team sails), spines and a long tail ending in a lit spade, and a horned head with lit eyes.
const DRAKE = 0x4a2a6a, DRAKE_D = 0x34184e, HORN = 0xe8dcc0;
MORE_SUITS.brigid = {
  limbs: { bulk: 1.28, hands: 0x3a2a5a, feet: 0x2a1a4a, sleeve: DRAKE, trouser: 0x3a2058 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(DRAKE);
      roundBody(b, 0.31, 0.66);
      b.setColor(0xd8b060);
      for (const y of [0.12, 0.24, 0.36, 0.48]) b.box(0.28, y, 0, 0.06, 0.09, 0.3 - y * 0.15);
      b.setColor(DRAKE);
      chain(b, [[-0.24, 0.12, 0], [-0.5, 0.02, 0.04], [-0.76, 0.0, 0.14], [-1.0, 0.04, 0.26]], 0.14, 0.03, 6);
      b.setColor(DRAKE_D);
      for (const s of [1, -1]) chain(b, [[-0.2, 0.62, s * 0.14], [-0.28, 0.98, s * 0.44], [-0.5, 0.84, s * 0.86]], 0.04, 0.02, 4);   // Wing arms.
      for (const [x, y] of [[-0.24, 0.64], [-0.3, 0.46], [-0.33, 0.3], [-0.52, 0.16], [-0.74, 0.12]]) b.prismY(y, y + 0.12, x, 0, 0.06, 0.0, 4, Math.PI / 4);
    });
    b.setPart(1);
    for (const s of [1, -1]) {                                                                     // Membranes.
      plate(b, [-0.22, 0.64, s * 0.14], [-0.52, 0.74, s * 0.82], 0.36, 0.02);
      plate(b, [-0.26, 0.8, s * 0.36], [-0.5, 0.82, s * 0.84], 0.16, 0.02);
    }
    tag(b, ACC, () => b.setPart(0).setColor(0x18e8ff).prismY(0.0, 0.05, -1.08, 0.3, 0.12, 0.12, 3, 0.4));
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(DRAKE).box(0.08, 0.24, 0, 0.32, 0.22, 0.3, 0.04);
      b.box(0.32, 0.18, 0, 0.24, 0.13, 0.2, 0.03);
      b.setColor(DRAKE_D).box(0.26, 0.08, 0, 0.3, 0.06, 0.18);
      b.setColor(0x0c0a10).box(0.44, 0.22, 0.05, 0.012, 0.025, 0.025).box(0.44, 0.22, -0.05, 0.012, 0.025, 0.025);
      b.setColor(HORN);
      for (const s of [1, -1]) chain(b, [[0.0, 0.34, s * 0.1], [-0.16, 0.48, s * 0.16], [-0.36, 0.52, s * 0.2]], 0.055, 0.012, 5);
      b.setColor(DRAKE_D);
      for (const s of [1, -1]) plate(b, [-0.04, 0.2, s * 0.14], [-0.2, 0.3, s * 0.26], 0.12, 0.02);
    });
    tag(b, ACC, () => b.setPart(0).setColor(0x18e8ff).box(0.2, 0.3, 0.155, 0.07, 0.035, 0.012).box(0.2, 0.3, -0.155, 0.07, 0.035, 0.012));
    b.setPart(1);
    for (const x of [0.12, 0.0, -0.12]) b.prismY(0.35, 0.45, x, 0, 0.05, 0.0, 4, Math.PI / 4);
  },
};
// Marshal: a nutcracker. A team tunic with white cross belts, gold buttons and big gold epaulettes (two gold bars from
// above), a wooden face with painted cheeks, a great white moustache and beard, and a tall black shako with gold bands,
// a team cockade and plume.
const WOOD = 0xe8c8a0;
MORE_SUITS.marshal = {
  limbs: { bulk: 1.12, hands: 0xf2f2ea, feet: 0x141414, sleeve: 0x2a2a3a, trouser: 0xf2f2ea },
  torso(b) {
    b.setPart(1).prismY(-0.1, 0.62, 0, 0, 0.27, 0.29, 8, Math.PI / 8);                            // Tunic and its tails.
    b.box(-0.26, -0.12, 0, 0.06, 0.34, 0.36);
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0xf2f2ea);
      for (const x of [0.29, -0.29]) { plate(b, [x, 0.62, 0.2], [x, 0.1, -0.2], 0.07, 0.02); plate(b, [x, 0.62, -0.2], [x, 0.1, 0.2], 0.07, 0.02); }
      b.setColor(0x141414).box(0, 0.1, 0, 0.6, 0.07, 0.62);
      b.setColor(0xc9a240);
      for (const s of [1, -1]) for (let i = 0; i < 5; i++) b.box(0.0, 0.6, s * (0.3 + i * 0.03), 0.22 - i * 0.02, 0.14 - i * 0.01, 0.012);   // Fringe.
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffd659);
      for (const s of [1, -1]) b.box(0.0, 0.67, s * 0.31, 0.26, 0.05, 0.2, 0.02);                 // Epaulettes.
      for (const z of [0.08, -0.08]) for (const y of [0.22, 0.34, 0.46]) b.box(0.29, y, z, 0.012, 0.035, 0.035);
      b.box(0.31, 0.1, 0, 0.012, 0.06, 0.08);
    });
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(WOOD).box(0.02, 0.18, 0, 0.3, 0.3, 0.3, 0.03);                       // Wooden head.
      b.setColor(0xf2f2ea).box(0.12, 0.04, 0, 0.14, 0.14, 0.32, 0.03);                            // Beard.
      b.box(0.19, 0.14, 0, 0.04, 0.05, 0.3);                                                       // Moustache.
      b.setColor(0x7a3a2a).box(0.165, 0.09, 0, 0.012, 0.025, 0.12);                               // The hinge of the mouth.
      b.setColor(0x141414).box(0.17, 0.23, 0.07, 0.012, 0.04, 0.035).box(0.17, 0.23, -0.07, 0.012, 0.04, 0.035);
      b.setColor(0xe86a6a).box(0.168, 0.17, 0.11, 0.012, 0.035, 0.035).box(0.168, 0.17, -0.11, 0.012, 0.035, 0.035);
      b.setColor(WOOD).box(0.2, 0.19, 0, 0.05, 0.05, 0.04);
      b.setColor(0x141414).prismY(0.32, 0.74, -0.01, 0, 0.18, 0.21, 8, Math.PI / 8);              // Shako.
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xffd659).prismY(0.32, 0.36, -0.01, 0, 0.185, 0.188, 8, Math.PI / 8);
      b.prismY(0.7, 0.74, -0.01, 0, 0.205, 0.212, 8, Math.PI / 8);
      b.box(0.17, 0.56, 0, 0.012, 0.03, 0.18);
    });
    b.setPart(1).prismX(0.17, 0.21, 0.48, 0, 0.06, 0.06, 8);                                      // Cockade and plume.
    chain(b, [[0.12, 0.72, 0], [0.12, 0.86, 0], [0.06, 0.96, 0]], 0.06, 0.03, 5);
  },
};

Object.assign(SUITS, MORE_SUITS);
Object.assign(SUITS, W5_SUITS);
