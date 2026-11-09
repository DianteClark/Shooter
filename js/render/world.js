// Generates the arena for the selected map from map.walls and the map's theme (see art.js).
// Everything static lands in one opaque merged mesh with lighting baked per triangle on the CPU (no
// realtime lights), plus one multiply-blended decal mesh for shadows, one additive mesh for glow and
// wet-ground light streaks, a flickering sign mesh, and a water mesh where the map has basins.
import * as THREE from 'three';
import { MeshBuilder } from './meshbuild.js';
import { hexRGB, lightAt, getTheme } from './art.js';

export const MAX_POPS = 4;   // Simultaneous dynamic light pops the ground shader evaluates.
const WATER_Y = -0.62;       // Basin surface, below the quay.

// Palette of the map being built. Generation is synchronous and one map at a time.
let INK = null;
let CONTAINER_COLORS = null;

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value noise for the ground: returns 0..1.
function makeNoise(seed) {
  const rnd = mulberry(seed);
  const size = 64, grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const at = (x, z) => grid[((z & (size - 1)) * size) | (x & (size - 1))];
  return (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z);
    let fx = x - xi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const a = at(xi, zi), b = at(xi + 1, zi), c = at(xi, zi + 1), d = at(xi + 1, zi + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}

const VERT = /* glsl */`
attribute vec3 aCol;
attribute float aPart;
uniform vec4 uFogXf;
varying vec3 vCol;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vFogUv;
varying float vWet;
void main() {
  vCol = aCol;
  vWet = aPart;
  vN = normal;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  // Vertical faces sample the mask just in front of themselves so a lit wall face matches lit ground.
  vec2 p = w.xz + normal.xz * 0.45;
  vFogUv = p * uFogXf.xy + uFogXf.zw;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */`
uniform sampler2D uFogTex;
uniform float uFogOn;
uniform float uDesat;
uniform float uWet;
uniform float uTime;
uniform float uFlash;
uniform vec3 uSheenDir;
uniform vec3 uSheenCol;
uniform vec3 uFogTint;
uniform vec3 uFogSeam;
uniform vec3 uDesatTint;
uniform vec4 uPopPos[${MAX_POPS}];   // x,y,z,radius
uniform vec3 uPopCol[${MAX_POPS}];
varying vec3 vCol;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vFogUv;
varying float vWet;
const vec3 LUM = vec3(0.3, 0.59, 0.11);
void main() {
  vec3 col = vCol;
  // Wet faces (aPart) mirror a soft sky: the facet noise breaks it into a sheen rather than a flat tint.
  if (uWet > 0.0 && vWet > 0.0) {
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 N = normalize(vN + vec3(sin(vWorld.x * 3.1 + uTime * 1.7) + sin(vWorld.z * 2.3 - uTime * 1.1),
                                  0.0,
                                  cos(vWorld.z * 3.7 + uTime * 1.3) - sin(vWorld.x * 1.9 + uTime)) * 0.018);
    vec3 R = reflect(-V, N);
    float s = max(dot(R, uSheenDir), 0.0);
    s = s * s * s; s = s * s * s;              // pow 9, cheap enough to run over the whole wet ground.
    float w = vWet * uWet;
    col *= 1.0 - 0.32 * w;
    col += uSheenCol * s * 0.85 * w;
    col += (col * 0.5 + uSheenCol * 0.25) * uFlash * w;
  }
  for (int i = 0; i < ${MAX_POPS}; i++) {
    vec3 d = vWorld - uPopPos[i].xyz;
    float r2 = uPopPos[i].w * uPopPos[i].w;
    float f = max(0.0, 1.0 - dot(d, d) / r2);
    col += col * uPopCol[i] * f * f;
  }
  col += col * uFlash * 0.42;
  float v = texture2D(uFogTex, vFogUv).r;
  vec2 q = abs(vFogUv - 0.5);
  float outside = smoothstep(0.495, 0.505, max(q.x, q.y));
  v = max(v, outside * 0.6);                // Off-map scenery stays dim but legible.
  v = mix(1.0, v, uFogOn);
  float vis = smoothstep(0.1, 0.9, v);
  float lum = dot(col, LUM);
  vec3 fogged = mix(vec3(lum), col, 0.3) * uFogTint;
  vec3 lit = mix(fogged, col, vis);
  lit += (vis * (1.0 - vis)) * uFogSeam;     // Thin seam where vision ends.
  if (uDesat > 0.0) lit = mix(lit, vec3(dot(lit, LUM)) * uDesatTint, uDesat);
  gl_FragColor = vec4(lit, 1.0);
}`;

export function createWorldMaterial(fogUniforms, theme = getTheme()) {
  const pos = [], col = [];
  for (let i = 0; i < MAX_POPS; i++) { pos.push(new THREE.Vector4(0, -100, 0, 1)); col.push(new THREE.Vector3()); }
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uFogTex: fogUniforms.tex, uFogXf: fogUniforms.xf, uFogOn: fogUniforms.on,
      uDesat: { value: 0 }, uPopPos: { value: pos }, uPopCol: { value: col },
      uWet: { value: theme.wet || 0 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uSheenDir: { value: new THREE.Vector3(...(theme.sheen || [0, 1, 0])) },
      uSheenCol: { value: new THREE.Vector3(...(theme.sheenCol || [0, 0, 0])) },
      uFogTint: { value: new THREE.Vector3(...theme.fog) },
      uFogSeam: { value: new THREE.Vector3(...theme.fogSeam) },
      uDesatTint: { value: new THREE.Vector3(...theme.desatTint) },
    },
  });
}

// Shared fragment: dims a light source where the local player's vision does not reach it.
const FOG_VIS = /* glsl */`
uniform sampler2D uFogTex;
uniform float uFogOn;
varying vec2 vFogUv;
float fogVis() {
  float v = texture2D(uFogTex, vFogUv).r;
  vec2 q = abs(vFogUv - 0.5);
  v = max(v, smoothstep(0.495, 0.505, max(q.x, q.y)) * 0.6);
  return smoothstep(0.1, 0.9, mix(1.0, v, uFogOn));
}`;

// Additive light: halos around sources and the long streaks light leaves on wet ground.
const GLOW_VERT = /* glsl */`
attribute vec3 aCol;
uniform vec4 uFogXf;
varying vec3 vC;
varying vec2 vFogUv;
void main() {
  vC = aCol;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vFogUv = w.xz * uFogXf.xy + uFogXf.zw;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GLOW_FRAG = /* glsl */`
${FOG_VIS}
varying vec3 vC;
void main() { gl_FragColor = vec4(vC * (0.3 + 0.7 * fogVis()), 1.0); }`;

// Signage. aPart holds a per-sign phase; the flicker runs here so a sign needs no CPU.
const SIGN_VERT = /* glsl */`
attribute vec3 aCol;
attribute float aPart;
uniform vec4 uFogXf;
uniform float uTime;
varying vec3 vC;
varying vec2 vFogUv;
void main() {
  float t = uTime * (1.3 + aPart * 2.0) + aPart * 37.0;
  float hum = 0.9 + 0.1 * sin(t * 13.0) * sin(t * 3.7);
  float drop = step(0.965, fract(sin(floor(t * 2.4) * 12.9898 + aPart * 78.233) * 43758.5453));
  vC = aCol * hum * (1.0 - drop * 0.72);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vFogUv = (w.xz + normal.xz * 0.45) * uFogXf.xy + uFogXf.zw;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SIGN_FRAG = /* glsl */`
${FOG_VIS}
varying vec3 vC;
void main() { float v = fogVis(); gl_FragColor = vec4(vC * (0.22 + 0.78 * v), 1.0); }`;

// Basin surface: dark water with drifting swell and a moving sky glint. Lightning lights it from above.
const WATER_VERT = /* glsl */`
uniform vec4 uFogXf;
varying vec3 vW;
varying vec2 vFogUv;
void main() {
  vW = position;
  vFogUv = position.xz * uFogXf.xy + uFogXf.zw;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const WATER_FRAG = /* glsl */`
${FOG_VIS}
uniform float uTime, uFlash;
uniform vec3 uDeep, uShallow, uGlint, uFogTint;
varying vec3 vW;
void main() {
  vec2 p = vW.xz;
  float a = sin(p.x * 0.9 + uTime * 0.7) + sin(p.y * 1.3 - uTime * 0.9) + sin((p.x + p.y) * 0.55 + uTime * 0.4);
  float b = sin(p.x * 2.1 - uTime * 1.3 + a) * sin(p.y * 2.7 + uTime * 1.1 - a);
  vec3 col = mix(uDeep, uShallow, 0.5 + 0.17 * a);
  float glint = smoothstep(0.55, 1.0, b);
  col += uGlint * glint * glint * 0.28;
  col += (col * 1.4 + uGlint * 0.08) * uFlash;
  float vis = fogVis();
  gl_FragColor = vec4(mix(col * uFogTint * 0.9, col, vis), 1.0);
}`;

// Additive vertex list. Colours fade per vertex, which MeshBuilder's per-face colours cannot do.
class GlowList {
  constructor() { this.pos = []; this.col = []; }
  _v(x, y, z, c) { this.pos.push(x, y, z); this.col.push(c[0], c[1], c[2]); }
  quad(a, b, c, d, ca, cb, cc, cd) {
    this._v(...a, ca); this._v(...b, cb); this._v(...c, cc);
    this._v(...a, ca); this._v(...c, cc); this._v(...d, cd);
  }
  // Soft pool on the ground, drawn as a fan. Centre colour c, edge black.
  halo(x, z, r, c, y = 0.16, segs = 14) {
    const zero = [0, 0, 0];
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      this._v(x, y, z, c);
      this._v(x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, zero);
      this._v(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, zero);
    }
  }
  // Long vertical smear toward the camera: how a light on wet ground reads from above.
  streak(x, z, w, len, c, y = 0.15) {
    const zero = [0, 0, 0];
    const mid = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55];
    const hw = w / 2, m = z + len * 0.3;
    this.quad([x - hw, y, z], [x - hw * 1.2, y, m], [x + hw * 1.2, y, m], [x + hw, y, z], c, mid, mid, c);
    this.quad([x - hw * 1.2, y, m], [x - hw * 1.5, y, z + len], [x + hw * 1.5, y, z + len], [x + hw * 1.2, y, m], mid, zero, zero, mid);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

// World-baking rules: every face is lit once, here, and emissive surfaces skip the bake.
function makeBake(theme, lamps) {
  const k = theme.lamp;
  return (nx, ny, nz, c, cx, cy, cz) => {
    const l = lightAt(nx, ny, nz, theme.light);
    let r = c[0] * l[0], g = c[1] * l[1], b = c[2] * l[2];
    if (ny > 0.5) {           // Lamp pools on horizontal faces.
      for (const lp of lamps) {
        const d2 = (cx - lp.x) ** 2 + (cz - lp.z) ** 2;
        const f = Math.max(0, 1 - d2 / (lp.r * lp.r));
        if (f <= 0) continue;
        const lc = lp.col || k;
        r += c[0] * f * lc[0]; g += c[1] * f * lc[1]; b += c[2] * f * lc[2];
      }
    }
    return [r, g, b];
  };
}

function box3(b, x, y, z, w, h, d, ch = 0) { b.box(x + w / 2, y + h / 2, z + d / 2, w, h, d, ch); }

function emissive(b, fn) {
  const saved = b.bake;
  b.bake = null;
  fn();
  b.bake = saved;
}

const scale = (c, k) => c.map(v => v * k);

// ---- Ground -----------------------------------------------------------------------------------------

// One continuous jittered, height-noised sheet, tinted per facet, extended well past the walls for
// off-map views. Grid lines snap to basin edges so basins are clean rectangular holes.
function ground(ctx) {
  const { b, map, theme, noise, rnd, W, H } = ctx;
  const pad = 28, cell = 1.5;
  const nx = Math.ceil((W + pad * 2) / cell), nz = Math.ceil((H + pad * 2) / cell);
  const xs = [], zs = [], fixedX = new Set(), fixedZ = new Set();
  for (let i = 0; i <= nx; i++) xs.push(-pad + i * cell);
  for (let j = 0; j <= nz; j++) zs.push(-pad + j * cell);
  const waters = map.walls.filter(w => w.kind === 'water');
  for (const w of waters) {
    for (const v of [w.x, w.x + w.w]) { const k = Math.round((v + pad) / cell); xs[k] = v; fixedX.add(k); }
    for (const v of [w.z, w.z + w.d]) { const k = Math.round((v + pad) / cell); zs[k] = v; fixedZ.add(k); }
  }
  const amp = theme.id === 'dust' ? 0.28 : 0.12;
  const pts = [];
  for (let j = 0; j <= nz; j++) {
    const row = [];
    for (let i = 0; i <= nx; i++) {
      const edge = i === 0 || j === 0 || i === nx || j === nz;
      const jx = edge || fixedX.has(i) ? 0 : (rnd() - 0.5) * cell * 0.55;
      const jz = edge || fixedZ.has(j) ? 0 : (rnd() - 0.5) * cell * 0.55;
      const x0 = xs[i], z0 = zs[j];
      row.push([x0 + jx, (noise(x0 * 0.5, z0 * 0.5) - 0.5) * amp, z0 + jz]);
    }
    pts.push(row);
  }
  const inWater = (x, z) => waters.some(w => x > w.x && x < w.x + w.w && z > w.z && z < w.z + w.d);
  const shade = groundShader(ctx);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = pts[j][i], b1 = pts[j + 1][i], c = pts[j + 1][i + 1], d = pts[j][i + 1];
      if (waters.length && inWater((a[0] + c[0]) / 2, (a[2] + c[2]) / 2)) continue;
      const flip = rnd() < 0.5;
      const t1 = flip ? [a, b1, c] : [a, b1, d];
      const t2 = flip ? [a, c, d] : [d, b1, c];
      for (const t of [t1, t2]) {
        b.color = shade(t[0]);
        b.setPart(ctx.groundWet);
        b.tri(t[0], t[1], t[2]);
      }
    }
  }
  b.setPart(0);
}

// Returns a shade(p) that sets ctx.groundWet as a side effect; wet surfaces carry it in aPart.
function groundShader(ctx) {
  const { map, theme, noise, rnd, W, H } = ctx;
  const inMap = (x, z) => x > 0 && x < W && z > 0 && z < H;
  const laneDist = z => { let d = 99; for (const l of map.lanes) d = Math.min(d, Math.abs(z - l.z)); return d; };
  ctx.groundWet = 0;
  if (theme.id === 'railyard') {
    return p => {
      const [x, , z] = p;
      const dLane = laneDist(z);
      let base = INK.ground;
      if (!inMap(x, z)) base = scale(INK.ground, 0.72);
      else if (dLane < 3.2) base = INK.asphalt;
      else if (noise(x * 0.18 + 9, z * 0.18) > 0.6) base = INK.dirt;
      return scale(base, 0.9 + noise(x * 0.8, z * 0.8) * 0.2 + (rnd() - 0.5) * 0.06);
    };
  }
  if (theme.id === 'harbor') {
    // Soaking concrete slabs on the quays, patches of standing water.
    return p => {
      const [x, , z] = p;
      if (!inMap(x, z)) { ctx.groundWet = z < 0 ? 0.9 : 0.3; return scale(z < 0 ? [0.05, 0.08, 0.13] : INK.ground, z < 0 ? 1 : 0.5); }
      const slab = (Math.floor(x / 6) + Math.floor(z / 6)) % 2 === 0;
      const puddle = noise(x * 0.34 + 3, z * 0.34) > 0.635;
      ctx.groundWet = puddle ? 1 : 0.55;
      if (puddle) return scale(INK.asphalt, 0.62);
      const base = laneDist(z) < 3.4 ? INK.asphalt : slab ? INK.ground : INK.gravel;
      return scale(base, 0.82 + noise(x * 0.7, z * 0.7) * 0.22 + (rnd() - 0.5) * 0.05);
    };
  }
  if (theme.id === 'neon') {
    // Dark pavers with a darker gutter down the middle of each alley.
    return p => {
      const [x, , z] = p;
      if (!inMap(x, z)) { ctx.groundWet = 0.4; return scale(INK.asphalt, 0.5); }
      const gutter = (Math.abs(x - Math.round(x / 4) * 4) < 0.5 && laneDist(z) > 4) || laneDist(z) < 0.5;
      const puddle = noise(x * 0.42 + 11, z * 0.42) > 0.62;
      ctx.groundWet = puddle ? 1 : gutter ? 0.8 : 0.6;
      if (puddle) return scale(INK.asphalt, 0.6);
      return scale(gutter ? INK.gravel : INK.ground, 0.8 + noise(x * 0.9, z * 0.9) * 0.28 + (rnd() - 0.5) * 0.06);
    };
  }
  // dust: warm sand with ripples, darker packed tracks down the lanes.
  return p => {
    const [x, , z] = p;
    if (!inMap(x, z)) return scale(INK.dirt, 0.72 + noise(x * 0.12, z * 0.12) * 0.25);
    const track = laneDist(z) < 2.8 && noise(x * 0.25, z * 0.25) > 0.42;
    const base = track ? INK.asphalt : noise(x * 0.12 + 5, z * 0.12) > 0.55 ? INK.dirt : INK.ground;
    const rip = Math.sin((x + noise(x * 0.3, z * 0.3) * 6) * 2.4) * 0.05;
    return scale(base, 0.92 + noise(x * 0.5, z * 0.5) * 0.2 + rip + (rnd() - 0.5) * 0.05);
  };
}

// ---- Flat paint per theme ------------------------------------------------------------------------------

function harborPaint(ctx) {
  const { b, map, rnd, W, H } = ctx;
  const blocked = (x, z) => map.walls.some(w => x > w.x - 0.2 && x < w.x + w.w + 0.2 && z > w.z - 0.2 && z < w.z + w.d + 0.2);
  // Worn yellow bay lines on the aprons, broken by anything standing on them.
  for (let z = 4; z < H - 3; z += 8) {
    for (let x = 1; x < 22; x += 0.9) {
      if (blocked(x, z) || rnd() < 0.18) continue;
      b.setColor(scale(INK.hazardY, 0.55 + rnd() * 0.25));
      b.groundRect(x, z - 0.05, 0.62, 0.1, 0.1);
      b.groundRect(W - x - 0.62, H - z - 0.05, 0.62, 0.1, 0.1);
    }
  }
  // Drain grates catching the runoff.
  for (let i = 0; i < 18; i++) {
    const x = 2 + rnd() * (W - 4), z = 2 + rnd() * (H - 4);
    if (blocked(x, z) || blocked(x + 1.2, z + 0.5)) continue;
    b.setColor(INK.hazardK);
    b.groundRect(x, z, 1.1, 0.42, 0.11);
    b.setColor(scale(INK.gravel, 0.9));
    for (let k = 0.14; k < 1.0; k += 0.2) b.groundRect(x + k, z + 0.04, 0.04, 0.34, 0.13);
  }
}

function neonPaint(ctx) {
  const { b, map, rnd, W, H } = ctx;
  const blocked = (x, z) => map.walls.some(w => x > w.x - 0.2 && x < w.x + w.w + 0.2 && z > w.z - 0.2 && z < w.z + w.d + 0.2);
  // Zebra crossings where the cross-alleys meet the main drag.
  for (const cx of [20, 30, 40]) {
    for (const cz of [19.1, 25.1]) {
      for (let k = -1.7; k <= 1.7; k += 0.68) {
        if (blocked(cx + k, cz)) continue;
        b.setColor(scale(INK.paint, 0.55));
        b.groundRect(cx + k - 0.2, cz - 0.7, 0.4, 1.4, 0.1);
      }
    }
  }
  // Fine cracks and stains so the wet paving has grain under the reflections.
  for (let i = 0; i < 60; i++) {
    const x = 4 + rnd() * (W - 8), z = 4 + rnd() * (H - 8);
    if (blocked(x, z)) continue;
    b.setColor(scale(INK.hazardK, 1.2));
    b.groundRect(x, z, 0.5 + rnd() * 1.6, 0.05, 0.1);
  }
}

function dustPaint(ctx) {
  const { b, map, rnd, W, H } = ctx;
  const blocked = (x, z, p = 0.3) => map.walls.some(w => x > w.x - p && x < w.x + w.w + p && z > w.z - p && z < w.z + w.d + p);
  // Tyre tracks wandering along each lane: dark enough to read, flat so they never lie about cover.
  for (const lane of map.lanes) {
    let zc = lane.z - 2;
    for (let x = 0; x < W; x += 0.85) {
      zc += (rnd() - 0.5) * 0.3;
      zc += (lane.z - zc) * 0.03;
      if (blocked(x, zc)) continue;
      const k = 0.68 + rnd() * 0.1;
      b.setColor(scale(INK.asphalt, k));
      b.groundRect(x, zc - 0.11, 0.85, 0.22, 0.04);
      b.groundRect(x, zc + 1.4, 0.85, 0.22, 0.04);
    }
  }
  // Scattered stones.
  for (let i = 0; i < 90; i++) {
    const x = 1 + rnd() * (W - 2), z = 1 + rnd() * (H - 2);
    if (blocked(x, z)) continue;
    b.setColor(scale(INK.rock, 0.75 + rnd() * 0.3));
    b.prismY(0.02, 0.14, x, z, 0.14 + rnd() * 0.16, 0.05, 5, rnd() * 3);
  }
}

// ---- Harbor --------------------------------------------------------------------------------------------

function harborLights(ctx) {
  const { map, W, H, lamps, glow } = ctx;
  const col = [1.0, 0.68, 0.3];
  const addLamp = (x, z, r) => {
    lamps.push({ x, z, r });
    glow.halo(x, z, r * 0.55, scale(col, 0.09));
  };
  ctx.lampSpots = [];
  const blocked = (x, z) => map.walls.some(w => w.kind !== 'water' && x > w.x - 1 && x < w.x + w.w + 1 && z > w.z - 1 && z < w.z + w.d + 1);
  for (let i = 0; i < 6; i++) {
    const z0 = 8.6, x = 28 + i * 9 + (i % 2) * 1.2;
    if (!blocked(x, z0)) { ctx.lampSpots.push([x, z0]); addLamp(x, z0 - 1.2, 9); }
    const z1 = H - 8.6, x1 = W - x;
    if (!blocked(x1, z1)) { ctx.lampSpots.push([x1, z1]); addLamp(x1, z1 + 1.2, 9); }
  }
  for (const [x, z] of [[21, 7], [21, 41], [59, 41], [59, 7], [17, 25], [63, 23]]) {
    if (!blocked(x, z)) { ctx.lampSpots.push([x, z]); addLamp(x, z, 10); }
  }
  // Warm spill from the causeway floods at the centre point.
  lamps.push({ x: 40, z: 24, r: 11 });
  glow.halo(40, 24, 7.5, scale(col, 0.1));
}

function quayEdges(ctx, w) {
  const { b, rnd } = ctx;
  const lip = (x0, z0, x1, z1) => {
    b.setColor(scale(INK.concrete, 0.6));
    const ox = x0 === x1 ? (x0 === w.x ? -1 : 1) : 0;
    const oz = z0 === z1 ? (z0 === w.z ? -1 : 1) : 0;
    b.quad([x0, 0.02, z0], [x1, 0.02, z1], [x1, WATER_Y - 0.6, z1], [x0, WATER_Y - 0.6, z0], [(x0 + x1) / 2 + ox, -0.3, (z0 + z1) / 2 + oz]);
    // Stone coping: a low kerb that hides the join between ground and basin.
    const t = 0.34;
    const cx = x0 === x1 ? (x0 === w.x ? x0 - t : x0) : Math.min(x0, x1);
    const cz = z0 === z1 ? (z0 === w.z ? z0 - t : z0) : Math.min(z0, z1);
    const lw = x0 === x1 ? t : Math.abs(x1 - x0), ld = z0 === z1 ? t : Math.abs(z1 - z0);
    const L = Math.max(lw, ld), n = Math.round(L / 0.95);
    for (let i = 0; i < n; i++) {
      b.setColor(scale(i % 2 ? INK.hazardY : INK.concrete, i % 2 ? 0.72 : 0.72));
      const s = (i / n) * L, e = ((i + 1) / n) * L;
      if (lw > ld) box3(b, cx + s, 0.02, cz, e - s - 0.04, 0.16, t);
      else box3(b, cx, 0.02, cz + s, t, 0.16, e - s - 0.04);
    }
  };
  lip(w.x, w.z, w.x + w.w, w.z);
  lip(w.x + w.w, w.z, w.x + w.w, w.z + w.d);
  lip(w.x + w.w, w.z + w.d, w.x, w.z + w.d);
  lip(w.x, w.z + w.d, w.x, w.z);
  // Mooring bollards along both long edges.
  for (const z of [w.z - 0.75, w.z + w.d + 0.5]) {
    for (let x = w.x + 2; x < w.x + w.w - 1; x += 6.1 + rnd()) {
      b.setColor(scale(INK.crane, 0.8));
      b.prismY(0.02, 0.5, x, z + 0.12, 0.18, 0.13, 8);
      b.setColor(scale(INK.hazardK, 1.4));
      b.prismY(0.5, 0.58, x, z + 0.12, 0.24, 0.24, 8);
    }
  }
}

function waterMesh(ctx, fogUniforms) {
  const { map, theme } = ctx;
  const pos = [];
  for (const w of map.walls) {
    if (w.kind !== 'water') continue;
    const y = WATER_Y;
    const p = [[w.x, y, w.z], [w.x, y, w.z + w.d], [w.x + w.w, y, w.z + w.d], [w.x + w.w, y, w.z]];
    for (const i of [0, 1, 2, 0, 2, 3]) pos.push(...p[i]);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
    uniforms: {
      uFogTex: fogUniforms.tex, uFogXf: fogUniforms.xf, uFogOn: fogUniforms.on,
      uTime: ctx.timeU, uFlash: ctx.flashU,
      uDeep: { value: new THREE.Vector3(...theme.water.deep) },
      uShallow: { value: new THREE.Vector3(...theme.water.shallow) },
      uGlint: { value: new THREE.Vector3(...theme.water.glint) },
      uFogTint: { value: new THREE.Vector3(...theme.fog) },
    },
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

// Hull outline is convex, so `loft` caps it correctly. u runs from stern to bow along the hull.
function hullRing(w, inset, y, tipIn) {
  const fx = w.bow > 0 ? (u => w.x + u) : (u => w.x + w.w - u);
  const zc = w.z + w.d / 2, L = w.w;
  const nose = Math.min(L * 0.22, 3.6);
  return [
    [fx(inset), y, w.z + inset],
    [fx(L - nose), y, w.z + inset],
    [fx(L - inset * 0.3 - tipIn), y, zc],
    [fx(L - nose), y, w.z + w.d - inset],
    [fx(inset), y, w.z + w.d - inset],
  ];
}

function ship(ctx, w) {
  const { b, rnd, glow } = ctx;
  const { x, z, w: L, d: D, h } = w;
  const bow = w.bow > 0 ? 1 : -1;
  const fx = u => (bow > 0 ? x + u : x + L - u);
  // Hull: anti-fouling band, dark plates, lighter top edge.
  b.setColor(INK.hullBand);
  b.loft([hullRing(w, 0.2, WATER_Y - 0.1, 0), hullRing(w, 0.06, 0.55, 0)]);
  b.setColor(INK.hull);
  b.loft([hullRing(w, 0.06, 0.55, 0), hullRing(w, 0, h - 0.5, 0)]);
  b.setColor(scale(INK.hull, 1.25));
  b.loft([hullRing(w, 0, h - 0.5, 0), hullRing(w, -0.02, h - 0.34, 0)]);
  // Deck.
  b.setPart(0.5);
  b.setColor(INK.deck);
  b.loft([hullRing(w, 0.25, h - 0.34, 0.2), hullRing(w, 0.25, h - 0.26, 0.2)]);
  b.setPart(0);
  // Faded weather stripes on the south-facing plating, what the camera sees.
  b.setColor(scale(INK.hullBand, 0.55));
  for (let u = 3; u < L - 5; u += 3.1) {
    if (u > L - 8) continue;
    box3(b, Math.min(fx(u), fx(u + 0.18)), 0.7, z + D - 0.015, 0.18, h - 1.4, 0.03);
  }
  const u0 = 1, superW = 6.5;
  if (w.tug) {
    // Tug cabin and rope fenders.
    b.setColor(INK.super);
    box3(b, Math.min(fx(1), fx(1 + L * 0.42)), h - 0.26, z + 1.1, L * 0.42, 1.0, D - 2.2);
    b.setColor(scale(INK.hazardK, 1.6));
    box3(b, Math.min(fx(1.2), fx(1.2 + L * 0.38)), h + 0.7, z + 1.3, L * 0.38, 0.14, D - 2.6);
    emissive(b, () => {
      b.setColor(INK.glowCool);
      box3(b, Math.min(fx(1.4), fx(1.4 + L * 0.34)), h + 0.2, z + D - 1.12, L * 0.34, 0.32, 0.03);
    });
    b.setColor(0x24262c);
    for (let u = 1.2; u < L - 1; u += 1.2) b.prismZ(z + D - 0.06, z + D + 0.08, fx(u), 0.12, 0.26, 0.26, 8);
    return;
  }
  // Superstructure on the south side of the stern, so its height never hides the north quay.
  const zT = z + D * 0.48;
  b.setColor(INK.super);
  box3(b, Math.min(fx(u0), fx(u0 + superW)), h - 0.26, zT, superW, 1.4, D - (zT - z) - 0.5);
  b.setColor(scale(INK.super, 0.92));
  box3(b, Math.min(fx(u0 + 0.6), fx(u0 + superW - 0.9)), h + 1.14, zT + 0.3, superW - 1.5, 1.1, D - (zT - z) - 1.1);
  emissive(b, () => {
    b.setColor(INK.glowCool);
    for (let i = 0; i < 5; i++) box3(b, Math.min(fx(u0 + 0.9 + i * 1.05), fx(u0 + 1.5 + i * 1.05)), h + 0.6, z + D - 0.51, 0.6, 0.5, 0.03);
    b.setColor(INK.glow);
    box3(b, Math.min(fx(u0 + 1.2), fx(u0 + superW - 1.6)), h + 1.65, z + D - 0.85, superW - 2.8, 0.34, 0.03);
  });
  // Funnel with a faded company band.
  b.setColor(INK.hull);
  b.prismY(h + 2.2, h + 3.0, fx(u0 + 1.6), zT + 1, 0.7, 0.62, 7);
  b.setColor(INK.hullBand);
  b.prismY(h + 2.55, h + 2.82, fx(u0 + 1.6), zT + 1, 0.72, 0.68, 7);
  // Radar mast and red aviation light.
  b.setColor(INK.trim);
  b.prismY(h + 2.2, h + 3.6, fx(u0 + superW - 2), zT + 1.1, 0.07, 0.04, 5);
  emissive(b, () => {
    b.setColor([1.0, 0.16, 0.14]);
    b.prismY(h + 3.5, h + 3.76, fx(u0 + superW - 2), zT + 1.1, 0.13, 0.13, 6);
  });
  // Hatch covers along the deck.
  const hatchStart = u0 + superW + 0.8;
  for (let u = hatchStart; u < L - 3.6; u += 3.4) {
    b.setColor(scale(INK.deck, 0.72));
    box3(b, Math.min(fx(u), fx(u + 2.7)), h - 0.26, z + 0.8, 2.7, 0.3, D - 1.6);
    b.setColor(scale(INK.deck, 1.05));
    box3(b, Math.min(fx(u + 0.2), fx(u + 2.5)), h + 0.04, z + 1, 2.3, 0.05, D - 2);
    // Some hatches carry a container stack.
    if (rnd() < 0.55) {
      b.setColor(hexRGB(CONTAINER_COLORS[Math.floor(rnd() * CONTAINER_COLORS.length)]));
      box3(b, Math.min(fx(u + 0.3), fx(u + 2.4)), h + 0.1, z + 1.3, 2.1, 1.4, D - 2.7);
      b.setColor(hexRGB(CONTAINER_COLORS[Math.floor(rnd() * CONTAINER_COLORS.length)]));
      if (rnd() < 0.5) box3(b, Math.min(fx(u + 0.3), fx(u + 2.4)), h + 1.5, z + 1.3, 2.1, 1.3, D - 2.7);
    }
  }
  // Navigation lights: the one saturated note on the hull.
  const tip = fx(L - 0.5);
  const port = [1, 0.18, 0.16], star = [0.2, 1.0, 0.45];
  emissive(b, () => {
    b.setColor(bow > 0 ? star : port);
    box3(b, tip - 0.1, h - 0.3, z + D / 2 + 0.3, 0.2, 0.3, 0.2);
    b.setColor(bow > 0 ? port : star);
    box3(b, tip - 0.1, h - 0.3, z + D / 2 - 0.5, 0.2, 0.3, 0.2);
  });
  glow.halo(tip, z + D + 0.4, 2.2, scale(star, 0.18), WATER_Y + 0.03, 10);
  glow.streak(fx(u0 + 3), z + D + 0.05, 3.4, 7, scale([1, 0.86, 0.6], 0.28), WATER_Y + 0.03);
  glow.streak(fx(L * 0.5), z + D + 0.05, 2.2, 5.5, scale([0.7, 0.8, 1], 0.2), WATER_Y + 0.03);
}

// Warehouse: pitched corrugated roof, big roller doors, dim office windows.
function warehouse(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  const wallC = rnd() < 0.5 ? INK.wall : INK.wallB;
  b.setColor(wallC);
  box3(b, x, 0, z, bw, h - 0.3, bd);
  b.setColor(INK.trim);
  box3(b, x - 0.05, 0, z - 0.05, bw + 0.1, 0.45, bd + 0.1);
  b.setColor(scale(wallC, 1.15));
  for (let i = 0.5; i < bw; i += 0.7) box3(b, x + i - 0.07, 0.45, z + bd, 0.14, h - 1.05, 0.06);
  for (let i = 0.5; i < bd; i += 0.7) { box3(b, x - 0.06, 0.45, z + i - 0.07, 0.06, h - 1.05, 0.14); box3(b, x + bw, 0.45, z + i - 0.07, 0.06, h - 1.05, 0.14); }
  // Roof: a low pitched prism running east-west.
  const y0 = h - 0.3, peak = y0 + 1.15;
  b.setPart(0.55);
  b.setColor(INK.roof);
  b.loft([
    [[x - 0.25, y0, z - 0.25], [x - 0.25, peak, z + bd / 2], [x - 0.25, y0, z + bd + 0.25]],
    [[x + bw + 0.25, y0, z - 0.25], [x + bw + 0.25, peak, z + bd / 2], [x + bw + 0.25, y0, z + bd + 0.25]],
  ]);
  b.setPart(0);
  b.setColor(scale(INK.roof, 1.2));
  b.prismX(x - 0.25, x + bw + 0.25, peak - 0.02, z + bd / 2, 0.12, 0.12, 4);
  for (let u = 1.2; u < bw - 0.8; u += 2.4) {       // Skylights catch the sheen.
    emissive(b, () => {
      b.setColor(scale(INK.glowCool, 0.42));
      b.quad([x + u, y0 + 0.5, z + bd * 0.78], [x + u + 1.3, y0 + 0.5, z + bd * 0.78], [x + u + 1.3, y0 + 0.2, z + bd * 0.88], [x + u, y0 + 0.2, z + bd * 0.88]);
    });
  }
  // South-facing doors and office.
  b.setColor(0x323a44);
  box3(b, x + bw * 0.14, 0, z + bd + 0.02, bw * 0.34, h * 0.68, 0.06);
  box3(b, x + bw * 0.6, 0, z + bd + 0.02, bw * 0.26, h * 0.68, 0.06);
  b.setColor(INK.hazardY);
  box3(b, x + bw * 0.14, h * 0.68, z + bd + 0.02, bw * 0.34, 0.1, 0.08);
  box3(b, x + bw * 0.6, h * 0.68, z + bd + 0.02, bw * 0.26, 0.1, 0.08);
  emissive(b, () => {
    b.setColor(scale(INK.glow, 0.72));
    box3(b, x + 0.5, h * 0.56, z + bd + 0.02, 0.9, 0.42, 0.05);
    box3(b, x + bw - 1.4, h * 0.56, z + bd + 0.02, 0.9, 0.42, 0.05);
  });
  // Door light spilling onto the wet concrete.
  ctx.glow.streak(x + bw * 0.5, z + bd + 0.3, 3.2, 4.6, scale(INK.glow, 0.15), 0.1);
}

function craneLeg(ctx, w) {
  const { b } = ctx;
  b.setColor(scale(INK.concrete, 0.8));
  box3(b, w.x - 0.1, 0, w.z - 0.1, w.w + 0.2, 0.4, w.d + 0.2);
  b.setColor(INK.crane);
  box3(b, w.x + 0.15, 0.4, w.z + 0.15, w.w - 0.3, w.h - 0.4, w.d - 0.3);
  b.setColor(INK.hazardK);
  box3(b, w.x + 0.1, 0.5, w.z + 0.1, w.w - 0.2, 0.22, w.d - 0.2);
  b.setColor(INK.hazardY);
  box3(b, w.x + 0.1, 0.72, w.z + 0.1, w.w - 0.2, 0.22, w.d - 0.2);
}

// Gantry crane straddling the quay: rendered only, it stands on two crane-kind leg walls.
function gantry(ctx, d) {
  const { b, glow, lamps } = ctx;
  const x = d.x, top = 9;
  const legZ = [d.z0, d.z1];
  b.setColor(INK.crane);
  const zMin = Math.min(d.z0, d.z1), zMax = Math.max(d.z0, d.z1);
  for (const z of legZ) b.prismY(2.4, top, x, z, 0.42, 0.3, 4, Math.PI / 4);
  // Cross-brace between the legs at mid height.
  box3(b, x - 0.1, 5.2, zMin, 0.2, 0.18, zMax - zMin);
  // Portal beam across the quay.
  b.setColor(scale(INK.crane, 1.1));
  box3(b, x - 0.32, top, zMin - 0.4, 0.64, 0.7, zMax - zMin + 0.8);
  // Boom out over the moored ship.
  const bz0 = d.boomZ < zMin ? d.boomZ : zMax, bz1 = d.boomZ < zMin ? zMin : d.boomZ;
  b.setColor(INK.crane);
  box3(b, x - 0.2, top + 0.2, Math.min(zMin, bz0) - 0.6, 0.4, 0.4, Math.max(zMax, bz1) - Math.min(zMin, bz0) + 1.5);
  // Lattice ribs along the boom.
  b.setColor(scale(INK.crane, 0.78));
  for (let z = Math.min(zMin, bz0) - 0.5; z < Math.max(zMax, bz1) + 0.9; z += 1.1) box3(b, x - 0.27, top + 0.16, z, 0.54, 0.06, 0.06);
  // Machine house and cab.
  b.setColor(scale(INK.super, 0.85));
  box3(b, x - 0.75, top + 0.7, (zMin + zMax) / 2 - 1.2, 1.5, 1.1, 2.4);
  // Trolley with a container hanging over the ship.
  const tz = d.boomZ;
  b.setColor(INK.hazardK);
  box3(b, x - 0.4, top - 0.2, tz - 0.4, 0.8, 0.4, 0.8);
  b.setColor(0x20252c);
  box3(b, x - 0.04, 4.8, tz - 0.02, 0.08, top - 5, 0.04);
  b.setColor(hexRGB(CONTAINER_COLORS[1]));
  box3(b, x - 1.5, 3.7, tz - 0.8, 3, 1.2, 1.6);
  emissive(b, () => {
    b.setColor([1, 0.2, 0.15]);
    box3(b, x - 0.1, top + 1.8, (zMin + zMax) / 2 - 0.1, 0.2, 0.22, 0.2);
    b.setColor(INK.glow);
    box3(b, x - 0.6, top + 0.86, Math.max(d.z0, d.z1), 1.2, 0.28, 0.03);
    box3(b, x - 0.75, top + 0.9, (zMin + zMax) / 2 + 1.2, 1.5, 0.3, 0.03);
  });
  lamps.push({ x, z: (d.z0 + d.z1) / 2, r: 7 });
  glow.halo(x, (d.z0 + d.z1) / 2, 4.5, scale([1, 0.7, 0.32], 0.1));
}

function harborDecor(ctx) {
  const { b, map, glow, W, H } = ctx;
  for (const d of map.decor || []) if (d.type === 'gantry') gantry(ctx, d);
  // Quay lamps: posts along the water and aprons, each leaving a warm streak on the wet.
  for (const [x, z] of ctx.lampSpots) {
    b.setColor(0x3a4048);
    b.prismY(0, 3.4, x, z, 0.11, 0.08, 6);
    box3(b, x - 0.06, 3.3, z - (z < H / 2 ? 0.9 : 0), 0.12, 0.1, 0.9);
    emissive(b, () => {
      b.setColor([1.0, 0.82, 0.48]);
      box3(b, x - 0.2, 3.22, z - (z < H / 2 ? 0.9 : 0), 0.4, 0.08, 0.3);
    });
    glow.streak(x, z + (z < H / 2 ? 0 : 0.3), 1.2, 6.5, [0.28, 0.19, 0.08], z < H / 2 && z > 8 ? WATER_Y + 0.03 : 0.12);
  }
  // Open sea north of the map and a breakwater so the quay ends in something.
  b.setColor([0.04, 0.07, 0.12]);
  box3(b, -28, -0.4, -28, W + 56, 0.05, 28 - 3);
  b.setColor(scale(INK.concrete, 0.3));
  box3(b, -10, -0.2, -13, W + 20, 0.9, 3);
  // Warehouse sheds, kept low on the south side so they never hide the fight.
  b.setColor(scale(INK.wall, 0.5));
  for (let z = -3; z < H + 6; z += 7) { box3(b, -9, 0, z, 6, 3.4, 5); box3(b, W + 3, 0, H - z - 5, 6, 3.4, 5); }
  b.setColor(scale(INK.wall, 0.45));
  for (let x = -6; x < W + 6; x += 8) box3(b, x, 0, H + 3, 5.5, 2.3, 2.6);
  // Moored ship silhouette out at sea.
  b.setColor([0.09, 0.13, 0.18]);
  box3(b, 8, 0, -22, 40, 3, 6);
  box3(b, 34, 3, -21.5, 8, 4, 5);
  emissive(b, () => {
    b.setColor(INK.glow);
    for (let i = 0; i < 9; i++) box3(b, 35 + i * 0.8, 6, -16.4, 0.3, 0.3, 0.02);
    b.setColor([1, 0.18, 0.15]);
    box3(b, 47, 3.2, -19, 0.2, 0.2, 0.2);
  });
}

// ---- Neon ----------------------------------------------------------------------------------------------

function neonLights(ctx) {
  const { map, theme, lamps, glow, rnd } = ctx;
  ctx.shopStyle = new Map();
  for (const w of map.walls) {
    if (w.kind !== 'shop') continue;
    const signCol = theme.signs[Math.floor(rnd() * theme.signs.length)];
    const accent = theme.signs[Math.floor(rnd() * theme.signs.length)];
    const phase = rnd();
    ctx.shopStyle.set(w, { signCol, accent, phase });
    lamps.push({ x: w.x + w.w / 2, z: w.z + w.d + 1.8, r: Math.min(w.w, 8) * 0.7, col: signCol.map(c => c * 0.34) });
  }
}

function shop(ctx, w) {
  const { b, sb, glow, rnd } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  const style = ctx.shopStyle.get(w);
  const c = rnd() < 0.5 ? INK.wall : INK.wallB;
  const tall = bd > 3.5 && bw > 4;
  b.setColor(c);
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(INK.trim);
  box3(b, x - 0.04, 0, z - 0.04, bw + 0.08, 0.3, bd + 0.08);
  // Roof and clutter: stepped upper volume, water tank, AC boxes, antennas.
  b.setPart(0.6);
  b.setColor(scale(INK.roof, 1.1));
  box3(b, x + 0.05, h - 0.02, z + 0.05, bw - 0.1, 0.04, bd - 0.1);
  b.setPart(0);
  b.setColor(INK.trim);
  box3(b, x, h, z, bw, 0.26, 0.2);
  box3(b, x, h, z + bd - 0.2, bw, 0.26, 0.2);
  box3(b, x, h, z, 0.2, 0.26, bd);
  box3(b, x + bw - 0.2, h, z, 0.2, 0.26, bd);
  if (tall) {
    b.setColor(scale(c, 0.88));
    const ux = x + bw * 0.22, uw = bw * 0.5;
    box3(b, ux, h + 0.02, z + 0.8, uw, 0.95, bd - 1.6);
    b.setColor(INK.trim);
    box3(b, ux - 0.08, h + 0.96, z + 0.72, uw + 0.16, 0.12, bd - 1.44);
    emissive(b, () => { b.setColor(scale(INK.glow, 0.78)); for (let i = 0; i < Math.floor(uw / 1.1); i++) if (rnd() < 0.55) box3(b, ux + 0.32 + i * 1.1, h + 0.42, z + bd - 0.78, 0.46, 0.34, 0.02); });
  }
  b.setColor(0x4b4a5a);
  for (let i = 0; i < 2; i++) {
    const ax = x + 0.5 + rnd() * (bw - 1.6), az = z + 0.4 + rnd() * (bd - 1.2);
    b.prismY(h + 0.02, h + 0.42, ax, az, 0.32, 0.3, 4, Math.PI / 4);
  }
  if (bw > 6 && rnd() < 0.6) {
    b.setColor(0x3b3a48);
    b.prismY(h + 0.02, h + 0.9, x + bw - 1.3, z + bd * 0.4, 0.42, 0.42, 8);
    b.prismY(h + 0.9, h + 1.1, x + bw - 1.3, z + bd * 0.4, 0.46, 0.12, 8);
  }
  b.setColor(0x2a2a34);
  if (rnd() < 0.5) b.prismY(h, h + 1.6, x + 0.6, z + 0.6, 0.03, 0.02, 4);

  // Storefront on the camera-facing wall: shutter, awning, then a big lit sign band above.
  const fz = z + bd + 0.03;
  b.setColor(scale(INK.trim, 1.5));
  box3(b, x + 0.3, 0, fz - 0.02, bw - 0.6, h * 0.42, 0.03);
  b.setColor(scale(INK.trim, 0.7));
  for (let y = 0.12; y < h * 0.42 - 0.02; y += 0.15) box3(b, x + 0.3, y, fz - 0.005, bw - 0.6, 0.04, 0.015);
  const glowLow = bw > 4;
  emissive(b, () => {
    // Warm shop interior peeking out from under the shutter.
    b.setColor(scale(INK.glow, 0.7));
    box3(b, x + 0.42, h * 0.42, fz, bw - 0.84, 0.32, 0.03);
  });
  b.setColor(scale(style.signCol, 0.32));
  b.loft([
    [[x + 0.2, h * 0.5, fz], [x + bw - 0.2, h * 0.5, fz], [x + bw - 0.2, h * 0.45, fz + 0.75], [x + 0.2, h * 0.45, fz + 0.75]],
    [[x + 0.2, h * 0.5 + 0.06, fz], [x + bw - 0.2, h * 0.5 + 0.06, fz], [x + bw - 0.2, h * 0.45 + 0.06, fz + 0.75], [x + 0.2, h * 0.45 + 0.06, fz + 0.75]],
  ]);
  // Lit sign plate: blocks of "characters" on a dark band read as lettering at gameplay zoom.
  const signY = h * 0.6, signH = h * 0.3, sw = Math.min(bw - 0.6, 5.2), sx = x + (bw - sw) / 2;
  sb.setPart(style.phase);
  sb.setColor(scale(style.signCol, 0.18));
  box3(sb, sx, signY, fz, sw, signH, 0.03);
  sb.setColor(style.signCol);
  const n = Math.max(2, Math.floor(sw / 0.62));
  for (let i = 0; i < n; i++) {
    const cx = sx + 0.18 + (i * (sw - 0.36)) / n, cw = (sw - 0.36) / n - 0.1;
    box3(sb, cx, signY + 0.08, fz + 0.012, cw, signH - 0.16, 0.025);
  }
  // Neon strip along the parapet.
  sb.setColor(style.accent);
  box3(sb, x + 0.14, h + 0.26, fz - 0.1, bw - 0.28, 0.05, 0.05);
  // Blade sign hung off the corner, sticking out into the alley above head height.
  if (bw >= 4 && bd >= 4) {
    sb.setPart(fract(style.phase * 3.7));
    sb.setColor(style.accent);
    box3(sb, x + bw - 0.2, 1.75, fz + 0.02, 0.1, 1.5, 0.05);
    box3(sb, x + bw - 0.1, 1.85, fz + 0.03, 0.42, 1.3, 0.04);
  }
  // Colour on the wet ground: a tight halo under the sign and long streaks toward the camera.
  const gc = scale(style.signCol, glowLow ? 0.3 : 0.2);
  glow.halo(x + bw / 2, z + bd + 1.1, Math.min(bw * 0.6, 4), scale(gc, 0.8), 0.13);
  const streaks = Math.max(1, Math.min(4, Math.floor(bw / 3)));
  for (let i = 0; i < streaks; i++) {
    const sxc = x + ((i + 0.5) / streaks) * bw;
    glow.streak(sxc, z + bd + 0.22, 0.75 + rnd() * 0.5, 4 + rnd() * 3, scale(style.signCol, 0.22 + rnd() * 0.12), 0.12);
  }
}

function fract(v) { return v - Math.floor(v); }

// Low market stall: counter of goods under a striped canvas awning on poles.
function stall(ctx, w) {
  const { b, sb, glow, rnd, theme } = ctx;
  const { x, z, w: sw, d: sd, h } = w;
  const long = sw >= sd;
  b.setColor(INK.crateD);
  box3(b, x, 0, z, sw, h * 0.7, sd);
  b.setColor(INK.crate);
  box3(b, x - 0.04, h * 0.7, z - 0.04, sw + 0.08, 0.1, sd + 0.08);
  const L = Math.max(sw, sd), T = Math.min(sw, sd);
  // Goods: small coloured boxes on the counter.
  for (let i = 0; i < L / 0.5 - 1; i++) {
    b.setColor(scale(theme.signs[Math.floor(rnd() * theme.signs.length)], 0.32));
    const a = 0.2 + i * 0.5, t = 0.1 + rnd() * (T - 0.5), s = 0.22 + rnd() * 0.12;
    if (long) box3(b, x + a, h * 0.7 + 0.1, z + t, s, 0.1 + rnd() * 0.14, s);
    else box3(b, x + t, h * 0.7 + 0.1, z + a, s, 0.1 + rnd() * 0.14, s);
  }
  // Poles and a tilted striped awning, wholly within the stall footprint.
  b.setColor(INK.trim);
  for (const [px, pz] of [[x + 0.07, z + 0.07], [x + sw - 0.07, z + 0.07], [x + 0.07, z + sd - 0.07], [x + sw - 0.07, z + sd - 0.07]]) {
    b.prismY(0, 1.75, px, pz, 0.035, 0.03, 4);
  }
  const stripes = Math.ceil(L / 0.38);
  for (let i = 0; i < stripes; i++) {
    b.setColor(i % 2 ? INK.awningA : INK.awningB);
    const s0 = (i / stripes) * L, s1 = ((i + 1) / stripes) * L;
    if (long) b.quad([x + s0, 1.86, z], [x + s0, 1.56, z + sd], [x + s1, 1.56, z + sd], [x + s1, 1.86, z]);
    else b.quad([x, 1.86, z + s0], [x + sw, 1.56, z + s0], [x + sw, 1.56, z + s1], [x, 1.86, z + s1]);
  }
  // Hanging bulb string: cheap, warm, and it marks low cover from a distance.
  sb.setPart(0.05 + rnd() * 0.9);
  sb.setColor(INK.glow);
  for (let i = 0; i < L / 0.42; i++) {
    const a = 0.2 + i * 0.42;
    if (long) box3(sb, x + a, 1.5, z + sd + 0.02, 0.06, 0.08, 0.06);
    else box3(sb, x + sw + 0.02, 1.5, z + a, 0.06, 0.08, 0.06);
  }
  if (long) glow.halo(x + sw / 2, z + sd + 0.5, 1.3, [0.14, 0.09, 0.03], 0.12, 10);
}

// Spawn screens: dark concrete hoarding with a neon line so they read at a glance.
function neonWall(ctx, w) {
  const { b, sb } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(scale(INK.concrete, 0.55));
  box3(b, x, 0, z, bw, h, bd);
  sb.setPart(0.33);
  sb.setColor(ctx.theme.signs[1]);
  const long = bw >= bd;
  if (long) box3(sb, x + 0.1, h - 0.3, z + bd + 0.01, bw - 0.2, 0.05, 0.02);
  else box3(sb, x + bw + 0.01, h - 0.3, z + 0.1, 0.02, 0.05, bd - 0.2);
}

// Perimeter: tenement walls with sparse lit windows.
function tenement(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(scale(INK.wall, 0.42));
  box3(b, x, 0, z, bw, h, bd);
  const southFace = bw > bd && z > ctx.H / 2;
  const northFace = bw > bd && z < 0;
  if (northFace || southFace) {
    const fz = southFace ? z - 0.05 : z + bd + 0.03;
    emissive(b, () => {
      for (let i = 1; i < bw - 1; i += 2.1) {
        if (rnd() < 0.5) continue;
        b.setColor(rnd() < 0.5 ? scale(INK.glow, 0.45) : scale(INK.glowCool, 0.32));
        box3(b, x + i, 1.8 + rnd() * 1.2, fz, 0.8, 0.5, 0.04);
      }
    });
  }
}

function neonDecor(ctx) {
  const { b, sb, glow, W, H, theme, rnd } = ctx;
  // Lantern strings across the cross-alleys, high enough never to hide anyone.
  const strings = [[20, 10.5, 20, 18], [20, 26, 20, 33.5], [30, 10.5, 30, 18], [30, 26, 30, 33.5], [40, 10.5, 40, 18], [40, 26, 40, 33.5]];
  for (const [x0, z0, x1, z1] of strings) {
    const y0 = 3.5, n = 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = 4 * t * (1 - t);
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 - 0.9 * s;
      if (i < n) {
        b.setColor(0x20202a);
        box3(b, x - 0.012, y, z, 0.024, 0.02, Math.abs(z1 - z0) / n);
      }
      sb.setPart(0.4 + (i % 4) * 0.1);
      sb.setColor(i % 2 ? [1.0, 0.45, 0.16] : [1.0, 0.25, 0.32]);
      box3(sb, x - 0.08, y - 0.2, z - 0.08, 0.16, 0.2, 0.16);
    }
    glow.halo(x0, (z0 + z1) / 2, 3.2, [0.1, 0.05, 0.02], 0.12, 10);
  }
  // Off-map: dark towers with lit windows and a few huge signs, low on the south so the view stays clear.
  const tower = (x, z, w, d, h, south) => {
    b.setColor(scale(INK.wall, 0.4));
    box3(b, x, 0, z, w, h, d);
    if (south) return;
    emissive(b, () => {
      for (let y = 2; y < h - 1; y += 1.5) {
        for (let i = 0.8; i < w - 0.5; i += 1.6) {
          if (rnd() < 0.55) continue;
          b.setColor(rnd() < 0.6 ? scale(INK.glow, 0.4) : scale(INK.glowCool, 0.3));
          box3(b, x + i, y, z + d + 0.02, 0.6, 0.7, 0.03);
        }
      }
    });
  };
  for (let x = -22; x < W + 22; x += 7 + rnd() * 4) {
    tower(x, -11 - rnd() * 3, 4 + rnd() * 4, 4, 9 + rnd() * 6, false);
    tower(x + 3, H + 3.5 + rnd() * 2, 4, 3, 2 + rnd() * 1.2, true);
  }
  for (let z = -6; z < H + 6; z += 7) {
    tower(-11, z, 6, 5, 4 + rnd() * 3, false);
    tower(W + 5, z, 6, 5, 4 + rnd() * 3, false);
  }
  // Big rooftop billboards off the north edge.
  for (let x = 5; x < W; x += 14) {
    const c = theme.signs[Math.floor(rnd() * theme.signs.length)];
    sb.setPart(rnd());
    sb.setColor(c);
    box3(sb, x, 7.5, -7.5, 6, 2.4, 0.08);
    sb.setColor(scale(c, 0.2));
    box3(sb, x - 0.2, 7.3, -7.46, 6.4, 2.8, 0.08);
    glow.streak(x + 3, -6, 2.6, 8, scale(c, 0.1), 0.1);
  }
}

// ---- Dust ----------------------------------------------------------------------------------------------

// Faceted rock mass inside its footprint: jittered stacked rings tapering upward, with strata colours.
function rockMass(ctx, x, z, w, d, h, opts = {}) {
  const { b, rnd } = ctx;
  const segs = Math.max(6, Math.min(12, Math.round((w + d) / 2.5)));
  const ring = (y, inset, jit) => {
    const pts = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2 + jit * 0.2;
      const rx = (w / 2 - inset) * (1 - rnd() * jit), rz = (d / 2 - inset) * (1 - rnd() * jit);
      pts.push([x + w / 2 + Math.cos(a) * rx * Math.SQRT2 * 0.92, y, z + d / 2 + Math.sin(a) * rz * Math.SQRT2 * 0.92]);
    }
    // Clamp to the footprint: the collision rect must never be smaller than what you can see.
    for (const p of pts) { p[0] = Math.max(x + 0.02, Math.min(x + w - 0.02, p[0])); p[2] = Math.max(z + 0.02, Math.min(z + d - 0.02, p[2])); }
    return pts;
  };
  const base = opts.colour || INK.rock;
  const levels = opts.levels || 4;
  let prev = ring(0, 0.02, 0.06);
  for (let k = 1; k <= levels; k++) {
    const t = k / levels;
    const next = ring(h * t, Math.min(w, d) * 0.28 * t + 0.02, 0.2);
    const c = scale(k % 2 ? INK.rockD : base, 1.05 + 0.1 * (k / levels));
    b.setColor(c);
    b.loft([prev, next]);
    prev = next;
  }
  // Flat mesa cap so the top of the rock reads as a walkable-looking stone table from above.
  b.setColor(scale(INK.rockL, 1.1));
  const capY = h;
  for (let j = 1; j < segs - 1; j++) b.tri([prev[0][0], capY + 0.01, prev[0][2]], [prev[j][0], capY + 0.01, prev[j][2]], [prev[j + 1][0], capY + 0.01, prev[j + 1][2]], [prev[0][0], capY - 2, prev[0][2]]);
}

function rockWall(ctx, w) { rockMass(ctx, w.x, w.z, w.w, w.d, w.h, { levels: w.w > 6 || w.d > 6 ? 4 : 3 }); }

function boulder(ctx, w) { rockMass(ctx, w.x, w.z, w.w, w.d, w.h, { levels: 2, colour: INK.rockL }); }

// Mud-brick courtyard wall: crenellated top, plaster patches flaking to brick on the sunny face.
function adobe(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd;
  b.setColor(INK.adobe);
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(INK.adobeD);
  box3(b, x - 0.03, 0, z - 0.03, bw + 0.06, 0.35, bd + 0.06);
  // Crenellations.
  const L = long ? bw : bd;
  b.setColor(scale(INK.adobe, 1.08));
  for (let i = 0.15; i < L - 0.45; i += 0.92) {
    if (long) box3(b, x + i, h, z, 0.5, 0.42, bd);
    else box3(b, x, h, z + i, bw, 0.42, 0.5);
  }
  // Exposed brick patches.
  b.setColor(INK.adobeD);
  for (let i = 0; i < L / 2; i++) {
    const s = 0.3 + rnd() * (L - 1), y = 0.5 + rnd() * (h - 1.4), pw = 0.3 + rnd() * 0.6;
    if (long) box3(b, x + s, y, z + bd + 0.01, pw, 0.22, 0.02);
    else box3(b, x + bw + 0.01, y, z + s, 0.02, 0.22, pw);
  }
  // Wall-top timber beams poking out on the south face.
  b.setColor(INK.canvasB);
  if (long) for (let i = 0.6; i < bw; i += 1.4) box3(b, x + i, h - 0.5, z + bd, 0.14, 0.14, 0.3);
}

function adobeScreen(ctx, w) {
  const { b } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(INK.adobeD);
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(INK.adobe);
  box3(b, x - 0.05, h - 0.2, z - 0.05, bw + 0.1, 0.2, bd + 0.1);
}

// Canvas tent: ridge pole and sloped canvas over a solid core, guy ropes staked inside the footprint.
function tent(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: tw, d: td, h } = w;
  const eastWest = tw >= td;
  const canvas = rnd() < 0.5 ? INK.canvas : scale(INK.canvas, 0.92);
  // Solid base (the collision box) in shadowed canvas.
  b.setColor(scale(canvas, 0.75));
  box3(b, x + 0.05, 0, z + 0.05, tw - 0.1, h * 0.62, td - 0.1);
  // Ridge roof.
  const ridge = h + 0.5, y0 = h * 0.62;
  b.setColor(canvas);
  if (eastWest) {
    const a = [x - 0.03, y0, z - 0.03], c = [x + tw + 0.03, y0, z - 0.03], d = [x + tw + 0.03, y0, z + td + 0.03], f = [x - 0.03, y0, z + td + 0.03], p = [x, ridge, z + td / 2], q = [x + tw, ridge, z + td / 2];
    b.quad(p, q, c, a, [x + tw / 2, -9, z + td / 2]);
    b.quad(q, p, f, d, [x + tw / 2, -9, z + td / 2]);
    b.setColor(scale(canvas, 0.72));
    b.tri(a, f, p, [x + tw / 2, ridge - 3, z + td / 2]);
    b.tri(d, c, q, [x + tw / 2, ridge - 3, z + td / 2]);
  } else {
    const a = [x - 0.03, y0, z - 0.03], c = [x + tw + 0.03, y0, z - 0.03], d = [x + tw + 0.03, y0, z + td + 0.03], f = [x - 0.03, y0, z + td + 0.03], p = [x + tw / 2, ridge, z], q = [x + tw / 2, ridge, z + td];
    b.quad(p, q, f, a, [x + tw / 2 + 9, -2, z + td / 2]);
    b.quad(q, p, c, d, [x + tw / 2 - 9, -2, z + td / 2]);
    b.setColor(scale(canvas, 0.72));
    b.tri(a, p, c, [x + tw / 2, ridge - 3, z + td / 2]);
    b.tri(f, d, q, [x + tw / 2, ridge - 3, z + td / 2]);
  }
  // A dark ridge pole and painted panel bands read as a canvas tent, not a roof.
  b.setColor(INK.canvasB);
  if (eastWest) {
    box3(b, x - 0.04, ridge - 0.05, z + td / 2 - 0.08, tw + 0.08, 0.1, 0.16);
    for (const u of [0.22, 0.72]) {
      const sx = x + tw * u, band = tw * 0.08;
      b.quad([sx, ridge + 0.015, z + td / 2], [sx + band, ridge + 0.015, z + td / 2], [sx + band, y0 + 0.015, z - 0.03], [sx, y0 + 0.015, z - 0.03], [sx, -9, z]);
      b.quad([sx, ridge + 0.015, z + td / 2], [sx, y0 + 0.015, z + td + 0.03], [sx + band, y0 + 0.015, z + td + 0.03], [sx + band, ridge + 0.015, z + td / 2], [sx, -9, z + td]);
    }
  } else {
    box3(b, x + tw / 2 - 0.08, ridge - 0.05, z - 0.04, 0.16, 0.1, td + 0.08);
    for (const u of [0.22, 0.72]) {
      const sz = z + td * u, band = td * 0.08;
      b.quad([x + tw / 2, ridge + 0.015, sz], [x + tw / 2, ridge + 0.015, sz + band], [x - 0.03, y0 + 0.015, sz + band], [x - 0.03, y0 + 0.015, sz], [x, -9, sz]);
      b.quad([x + tw / 2, ridge + 0.015, sz], [x + tw + 0.03, y0 + 0.015, sz], [x + tw + 0.03, y0 + 0.015, sz + band], [x + tw / 2, ridge + 0.015, sz + band], [x + tw, -9, sz]);
    }
  }
}

// Stacked sandbags: staggered rows of bevelled pouches.
function sandbags(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd;
  const L = long ? bw : bd, T = long ? bd : bw;
  const rows = Math.max(2, Math.round(h / 0.34));
  const bagL = 0.62;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 ? bagL / 2 : 0, y = r * (h / rows);
    for (let s = -offset; s < L; s += bagL) {
      const a = Math.max(0, s), e = Math.min(L, s + bagL - 0.03);
      if (e - a < 0.12) continue;
      b.setColor(scale(INK.sandbag, 0.92 + rnd() * 0.18));
      if (long) box3(b, x + a, y, z, e - a, h / rows - 0.02, T, 0.05);
      else box3(b, x, y, z + a, T, h / rows - 0.02, e - a, 0.05);
    }
  }
}

function ridge(ctx, w) {
  // Perimeter becomes a broken rock ridge so the arena looks like a canyon, not a pen.
  const { rnd } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw > bd;
  const L = long ? bw : bd;
  for (let s = 0; s < L; ) {
    const seg = 3 + rnd() * 3.5;
    const e = Math.min(L, s + seg);
    if (long) rockMass(ctx, x + s, z, e - s, bd, h + (rnd() - 0.5) * 1.2, { levels: 3 });
    else rockMass(ctx, x, z + s, bw, e - s, h + (rnd() - 0.5) * 1.2, { levels: 3 });
    s = e;
  }
}

function dustDecor(ctx) {
  const { b, rnd, W, H } = ctx;
  // Mesas on the horizon north and to the sides; low dunes south so the view stays clear.
  for (let x = -24; x < W + 24; x += 11 + rnd() * 6) {
    rockMass(ctx, x, -14 - rnd() * 6, 9 + rnd() * 7, 7 + rnd() * 4, 7 + rnd() * 6, { levels: 5 });
    if (rnd() < 0.5) rockMass(ctx, x + 2, H + 4 + rnd() * 3, 7, 4, 1.5 + rnd() * 1.4, { levels: 2, colour: INK.rockL });
  }
  for (let z = -6; z < H + 6; z += 9 + rnd() * 5) {
    rockMass(ctx, -13 - rnd() * 3, z, 8, 7, 5 + rnd() * 5, { levels: 4 });
    rockMass(ctx, W + 5 + rnd() * 3, z, 8, 7, 5 + rnd() * 5, { levels: 4 });
  }
  // A camel-thorn scrub scatter just beyond the ridge.
  b.setColor(scale(INK.canvasB, 0.7));
  for (let i = 0; i < 26; i++) b.prismY(0, 0.5 + rnd() * 0.4, -6 + rnd() * (W + 12), H + 1.5 + rnd() * 3, 0.5, 0.08, 5, rnd() * 3);
}

// ---- Railyard ------------------------------------------------------------------------------------------

function building(b, w, rnd, lamps) {
  const { x, z, w: bw, d: bd, h, landmark } = w;
  const wallC = landmark ? INK.concrete : (rnd() < 0.5 ? INK.wall : INK.wallB);
  b.setColor(wallC);
  box3(b, x, 0, z, bw, h - 0.25, bd);
  b.setColor(INK.trim);
  box3(b, x - 0.05, 0, z - 0.05, bw + 0.1, 0.45, bd + 0.1);       // Dark footing.

  // Corrugation ribs on all four sides.
  b.setColor(wallC.map(c => c * 1.14));
  for (let i = 0.5; i < bw; i += 0.8) {
    box3(b, x + i - 0.08, 0.45, z - 0.06, 0.16, h - 0.75, 0.06);
    box3(b, x + i - 0.08, 0.45, z + bd, 0.16, h - 0.75, 0.06);
  }
  for (let i = 0.5; i < bd; i += 0.8) {
    box3(b, x - 0.06, 0.45, z + i - 0.08, 0.06, h - 0.75, 0.16);
    box3(b, x + bw, 0.45, z + i - 0.08, 0.06, h - 0.75, 0.16);
  }

  // Sawn parapet ring and a recessed roof deck.
  b.setColor(INK.trim);
  box3(b, x - 0.1, h - 0.25, z - 0.1, bw + 0.2, 0.3, 0.3);
  box3(b, x - 0.1, h - 0.25, z + bd - 0.2, bw + 0.2, 0.3, 0.3);
  box3(b, x - 0.1, h - 0.25, z - 0.1, 0.3, 0.3, bd + 0.2);
  box3(b, x + bw - 0.2, h - 0.25, z - 0.1, 0.3, 0.3, bd + 0.2);
  b.setColor(INK.roof);
  box3(b, x + 0.2, h - 0.2, z + 0.2, bw - 0.4, 0.04, bd - 0.4);

  // Roof clutter: skylights give the top surface something to read at gameplay zoom.
  const units = Math.max(1, Math.floor(bw / 4));
  for (let i = 0; i < units; i++) {
    const ux = x + 1.2 + (i * (bw - 2.4)) / Math.max(1, units - 1);
    b.setColor(0x7c8590);
    box3(b, ux - 0.6, h - 0.18, z + bd * 0.28, 1.2, 0.45, 0.9, 0.05);
    b.setColor(0x4a505a);
    box3(b, ux - 0.4, h + 0.27, z + bd * 0.28 + 0.15, 0.8, 0.08, 0.6);
    emissive(b, () => {
      b.setColor(INK.glow.map(c => c * 0.55));
      box3(b, ux - 0.75, h - 0.15, z + bd * 0.64, 1.5, 0.05, 0.5);
    });
  }

  // Warm lit windows and a roller door on the camera-facing (south) wall.
  emissive(b, () => {
    b.setColor(INK.glow);
    const n = Math.floor(bw / 2.4);
    for (let i = 0; i < n; i++) {
      const wx = x + 0.9 + (i * (bw - 1.8 - 1.2)) / Math.max(1, n - 1);
      if (Math.abs(wx + 0.6 - (x + bw / 2)) < 1.5) continue;
      box3(b, wx, h * 0.52, z + bd + 0.02, 1.2, 0.55, 0.05);
    }
  });
  b.setColor(0x3a3f47);
  box3(b, x + bw / 2 - 1.3, 0.0, z + bd + 0.02, 2.6, h * 0.62, 0.06);
  b.setColor(INK.hazardY);
  box3(b, x + bw / 2 - 1.3, h * 0.62, z + bd + 0.02, 2.6, 0.14, 0.08);

  if (landmark) {
    // Signal mast on the centrepiece so the middle of the map has a silhouette.
    b.setColor(0x5a6370);
    b.prismY(h - 0.2, h + 2.4, x + bw / 2, z + bd / 2, 0.28, 0.14, 6);
    emissive(b, () => {
      b.setColor([1.0, 0.8, 0.35]);
      b.prismY(h + 1.9, h + 2.3, x + bw / 2, z + bd / 2, 0.26, 0.26, 6);
    });
    b.setColor(INK.hazardY);
    box3(b, x + 0.3, h - 0.14, z + 0.3, bw - 0.6, 0.03, 0.3);
    lamps.push({ x: x + bw / 2, z: z + bd / 2, r: 9 });
  }
}

function container(b, w, rnd) {
  const { x, z, w: cw, d: cd, h } = w;
  const base = hexRGB(CONTAINER_COLORS[Math.floor(rnd() * CONTAINER_COLORS.length)]);
  const long = cw >= cd;
  const dark = base.map(c => c * 0.72);
  b.setColor(base);
  box3(b, x, 0.12, z, cw, h - 0.18, cd);
  b.setColor(dark);
  box3(b, x - 0.04, 0, z - 0.04, cw + 0.08, 0.14, cd + 0.08);     // Bottom rail.
  box3(b, x - 0.04, h - 0.1, z - 0.04, cw + 0.08, 0.14, cd + 0.08);
  box3(b, x + 0.08, h + 0.04, z + 0.08, cw - 0.16, 0.03, cd - 0.16);
  const step = 0.36;
  b.setColor(dark);
  if (long) {
    for (let i = 0.3; i < cw - 0.15; i += step) {
      box3(b, x + i - 0.05, 0.15, z - 0.05, 0.1, h - 0.3, 0.05);
      box3(b, x + i - 0.05, 0.15, z + cd, 0.1, h - 0.3, 0.05);
    }
  } else {
    for (let i = 0.3; i < cd - 0.15; i += step) {
      box3(b, x - 0.05, 0.15, z + i - 0.05, 0.05, h - 0.3, 0.1);
      box3(b, x + cw, 0.15, z + i - 0.05, 0.05, h - 0.3, 0.1);
    }
  }
  b.setColor(base.map(c => c * 1.18));
  for (let i = 0.5; i < Math.max(cw, cd) - 0.3; i += 0.9) {
    if (long) box3(b, x + i, h + 0.05, z + 0.25, 0.5, 0.03, cd - 0.5);
    else box3(b, x + 0.25, h + 0.05, z + i, cw - 0.5, 0.03, 0.5);
  }
  b.setColor(0xd9d2c0);
  if (long) box3(b, x + cw * 0.3, h * 0.45, z + cd + 0.02, cw * 0.28, h * 0.32, 0.04);
  else box3(b, x + cw + 0.02, h * 0.45, z + cd * 0.3, 0.04, h * 0.32, cd * 0.28);
}

function crate(b, w, rnd) {
  const { x, z, w: cw, d: cd, h } = w;
  const c = rnd() < 0.5 ? INK.crate : INK.crate.map(v => v * 0.9);
  b.setColor(c);
  box3(b, x + 0.08, 0, z + 0.08, cw - 0.16, h - 0.12, cd - 0.16);
  b.setColor(INK.crateD);
  // Frame edges.
  for (const [fx, fz] of [[x, z], [x + cw - 0.2, z], [x, z + cd - 0.2], [x + cw - 0.2, z + cd - 0.2]]) {
    box3(b, fx, 0, fz, 0.2, h, 0.2);
  }
  box3(b, x, h - 0.16, z, cw, 0.16, 0.2);
  box3(b, x, h - 0.16, z + cd - 0.2, cw, 0.16, 0.2);
  box3(b, x, h - 0.16, z, 0.2, 0.16, cd);
  box3(b, x + cw - 0.2, h - 0.16, z, 0.2, 0.16, cd);
  b.setColor(c.map(v => v * 1.15));
  box3(b, x + 0.2, h - 0.1, z + 0.2, cw - 0.4, 0.04, cd - 0.4);
  b.setColor(INK.crateD);
  b.tri([x + 0.3, h - 0.05, z + 0.3], [x + 0.55, h - 0.05, z + 0.3], [x + cw - 0.3, h - 0.05, z + cd - 0.3]);
  b.tri([x + 0.3, h - 0.05, z + 0.3], [x + cw - 0.3, h - 0.05, z + cd - 0.3], [x + cw - 0.55, h - 0.05, z + cd - 0.3]);
}

// Jersey barrier: faceted concrete, hazard stripes on top so it reads as low cover from above.
function barrier(b, w) {
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd;
  const L = long ? bw : bd, T = long ? bd : bw;
  const ring = (t, inset, y) => {
    const a = long ? [x + t, y, z + inset] : [x + inset, y, z + t];
    const c = long ? [x + t, y, z + bd - inset] : [x + bw - inset, y, z + t];
    return [a, c];
  };
  const profile = (t) => [
    ...ring(t, 0, 0),
    ...ring(t, T * 0.18, h * 0.32),
    ...ring(t, T * 0.34, h),
  ];
  // Rebuild as a convex ring: bottom-near, bottom-far, mid-far, top-far, top-near, mid-near.
  const makeRing = (t) => {
    const p = profile(t);
    return [p[0], p[1], p[3], p[5], p[4], p[2]];
  };
  b.setColor(INK.concrete);
  b.loft([makeRing(0), makeRing(L)]);
  const segs = Math.round(L / 0.6);
  for (let i = 0; i < segs; i++) {
    b.setColor(i % 2 === 0 ? INK.hazardY : INK.hazardK);
    const s0 = (i + 0.06) * (L / segs), s1 = (i + 0.94) * (L / segs);
    const y = h + 0.02, in0 = T * 0.3;
    if (long) box3(b, x + s0, y - 0.03, z + in0, s1 - s0, 0.03, bd - in0 * 2);
    else box3(b, x + in0, y - 0.03, z + s0, bw - in0 * 2, 0.03, s1 - s0);
  }
}

function concreteWall(b, w) {
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(INK.concrete.map(c => c * 0.9));
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(INK.hazardY);
  box3(b, x - 0.04, h - 0.22, z - 0.04, bw + 0.08, 0.22, bd + 0.08);
  b.setColor(INK.hazardK);
  const long = bw >= bd, L = Math.max(bw, bd);
  for (let i = 0.2; i < L; i += 0.8) {
    if (long) box3(b, x + i, h - 0.24, z - 0.06, 0.4, 0.26, bd + 0.12);
    else box3(b, x - 0.06, h - 0.24, z + i, bw + 0.12, 0.26, 0.4);
  }
}

// Perimeter: precast panels with piers; lamp heads create the warm pools baked into the ground.
function border(b, w) {
  const { x, z, w: bw, d: bd, h } = w;
  const c = INK.concrete.map(v => v * 0.72);
  b.setColor(c);
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(c.map(v => v * 1.2));
  const long = bw >= bd;
  const n = Math.floor(Math.max(bw, bd) / 6);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.max(bw, bd);
    if (long) box3(b, x + t - 0.3, 0, z - 0.2, 0.6, h + 0.3, bd + 0.4);
    else box3(b, x - 0.2, 0, z + t - 0.3, bw + 0.4, h + 0.3, 0.6);
  }
  b.setColor(INK.hazardY.map(v => v * 0.8));
  if (long) box3(b, x, h - 0.5, z - 0.02, bw, 0.16, bd + 0.04);
  else box3(b, x - 0.02, h - 0.5, z, bw + 0.04, 0.16, bd);
}

// Things that lie flat, so they never lie about what blocks you.
function groundPaint(b, map, rnd, W, H) {
  const blocked = (x, z, pad = 0.2) => map.walls.some(w => x > w.x - pad && x < w.x + w.w + pad && z > w.z - pad && z < w.z + w.d + pad);
  const y = 0.1;

  // Rails down the north and south lanes, broken where a wall sits on them.
  for (const lane of map.lanes) {
    if (lane.id === 'mid') continue;
    const zc = lane.z;
    for (let x = -26; x < W + 26; x += 1.05) {
      if (blocked(x, zc)) continue;
      b.setColor(INK.tie);
      box3(b, x, 0.02, zc - 1.2, 0.34, 0.1, 2.4);
    }
    for (const dz of [-0.75, 0.75]) {
      b.setColor(INK.rail);
      let start = null;
      for (let x = -26; x < W + 26.5; x += 0.5) {
        const free = !blocked(x, zc + dz, 0.05);
        if (free && start === null) start = x;
        if (!free && start !== null) { box3(b, start, 0.1, zc + dz - 0.06, x - start, 0.08, 0.12); start = null; }
      }
      if (start !== null) box3(b, start, 0.1, zc + dz - 0.06, W + 26 - start, 0.08, 0.12);
    }
  }

  // Dashed centre line on the mid lane, stopping for the landmark.
  b.setColor(INK.paint.map(c => c * 0.75));
  for (let x = 5; x < W - 5; x += 3.2) {
    if (!blocked(x + 0.9, 24, 0.4)) b.groundRect(x, 23.9, 1.8, 0.2, y);
  }
  // Lane edge lines.
  for (const lane of map.lanes) {
    for (let x = 3; x < W - 3; x += 0.9) {
      for (const dz of [-3.6, 3.6]) {
        if (!blocked(x + 0.3, lane.z + dz, 0.2) && rnd() > 0.12) {
          const k = 0.45 + rnd() * 0.2;
          b.setColor(INK.paint.map(c => c * k));
          b.groundRect(x, lane.z + dz - 0.06, 0.7, 0.12, y);
        }
      }
    }
  }
  // Hazard chevrons framing the centre building.
  const lm = map.walls.find(w => w.landmark);
  if (lm) {
    for (let i = 0; i < 7; i++) {
      for (const side of [-1, 1]) {
        const sx = side < 0 ? lm.x - 1.0 : lm.x + lm.w + 0.1;
        b.setColor(i % 2 ? INK.hazardY.map(c => c * 0.8) : INK.hazardK);
        b.tri([sx, y, lm.z + i], [sx, y, lm.z + i + 1], [sx + 0.9, y, lm.z + i + 1]);
        b.tri([sx, y, lm.z + i], [sx + 0.9, y, lm.z + i + 1], [sx + 0.9, y, lm.z + i]);
      }
    }
  }
}

// Off-map silhouette: container stacks and sheds so the arena does not float in nothing.
function backdrop(b, W, H, rnd) {
  const place = (x, z) => {
    const base = hexRGB(CONTAINER_COLORS[Math.floor(rnd() * CONTAINER_COLORS.length)]).map(c => c * 0.6);
    b.setColor(base);
    const wid = 5 + rnd() * 2, dep = 2.5, stack = 1 + Math.floor(rnd() * 3);
    for (let s = 0; s < stack; s++) box3(b, x + (rnd() - 0.5) * 0.8, s * 2.7, z, wid, 2.6, dep);
  };
  for (let x = -22; x < W + 22; x += 8.5 + rnd() * 3) { place(x, -6.5 - rnd() * 5); place(x, -13 - rnd() * 5); place(x + 3, H + 3.5 + rnd() * 3); place(x + 1, H + 9 + rnd() * 3); }
  for (let z = -10; z < H + 10; z += 8 + rnd() * 3) { place(-11 - rnd() * 4, z); place(W + 4 + rnd() * 4, z); }
}

// Floodlight masts along the north wall. Lamp heads are emissive.
function floodlights(b, W, H, lamps) {
  for (let x = 12; x < W; x += 16) {
    b.setColor(0x4a505a);
    b.prismY(4, 7.8, x, -0.75, 0.13, 0.09, 6);
    b.setColor(0x383c44);
    box3(b, x - 1, 7.7, -1.1, 2, 0.14, 0.45);
    emissive(b, () => { b.setColor([1.0, 0.86, 0.58]); box3(b, x - 0.85, 7.6, -0.72, 1.7, 0.06, 0.26); });
    lamps.push({ x, z: 4, r: 13 });
  }
  for (let x = 4; x < W; x += 16) lamps.push({ x, z: H + 2, r: 12 });
}

// Saturated team paint is reserved for the spawn pads; everything else in the yard stays muted.
function spawnPads(b, map, teams, W) {
  const y = 0.09;
  map.spawns.forEach((list, team) => {
    const c = hexRGB(teams[team].color);
    const dim = c.map(v => v * 0.55);
    const x0 = team === 0 ? 0.6 : W - 5.6;
    emissive(b, () => {
      b.setColor(dim);
      for (const s of list) {
        b.tri([s.x - 1.1, y, s.z - 1.1], [s.x - 1.1, y, s.z + 1.1], [s.x + 1.1, y, s.z + 1.1]);
        b.tri([s.x - 1.1, y, s.z - 1.1], [s.x + 1.1, y, s.z + 1.1], [s.x + 1.1, y, s.z - 1.1]);
      }
      b.setColor(c);
      for (let z = 1; z < map.height - 1; z += 3) {
        b.tri([x0, y, z], [x0, y, z + 1.6], [x0 + 1.6, y, z + 0.8]);
      }
    });
  });
}


// ---- Assembly ------------------------------------------------------------------------------------------

// Drawers take (ctx, wall). The railyard set keeps its original (b, wall, ...) signature underneath.
const RAILYARD_DRESS = {
  building: (c, w) => building(c.b, w, c.rnd, c.lamps),
  container: (c, w) => container(c.b, w, c.rnd),
  wall: (c, w) => concreteWall(c.b, w),
  border: (c, w) => border(c.b, w),
  crate: (c, w) => crate(c.b, w, c.rnd),
  barrier: (c, w) => barrier(c.b, w),
};

const DRESS = {
  railyard: RAILYARD_DRESS,
  harbor: { ...RAILYARD_DRESS, building: warehouse, water: quayEdges, hull: ship, crane: craneLeg },
  neon: { ...RAILYARD_DRESS, shop, stall, wall: neonWall, border: tenement },
  dust: { ...RAILYARD_DRESS, rock: rockWall, boulder, adobe, tent, sandbag: sandbags, wall: adobeScreen, border: ridge },
};

const THEME_STAGES = {
  railyard: {
    lights: (c) => {
      floodlights(c.b, c.W, c.H, c.lamps);
      for (const w of c.map.walls) if (w.landmark) c.lamps.push({ x: w.x + w.w / 2, z: w.z + w.d / 2, r: 9 });
    },
    paint: (c) => groundPaint(c.b, c.map, c.rnd, c.W, c.H),
    decor: (c) => backdrop(c.b, c.W, c.H, c.rnd),
  },
  harbor: { lights: harborLights, paint: harborPaint, decor: harborDecor },
  neon: { lights: neonLights, paint: neonPaint, decor: neonDecor },
  dust: { lights: () => {}, paint: dustPaint, decor: dustDecor },
};

// Sun shadows and contact darkening: per-vertex strength a, drawn with multiply blending.
function buildDecals(map, theme) {
  const pos = [], str = [];
  const push = (x, z, a) => { pos.push(x, 0.14, z); str.push(a); };
  const tri = (ax, az, aa, bx, bz, ba, cx, cz, ca) => { push(ax, az, aa); push(bx, bz, ba); push(cx, cz, ca); };

  const dir = theme.light.dir;
  const sx = (-dir[0] / dir[1]) * theme.shadow.len, sz = (-dir[2] / dir[1]) * theme.shadow.len;
  const S = theme.shadow.strength;
  for (const w of map.walls) {
    if (w.kind === 'water') continue;
    const h = w.h * 0.82;
    const pts = [
      [w.x, w.z, S], [w.x + w.w, w.z, S], [w.x + w.w, w.z + w.d, S], [w.x, w.z + w.d, S],
      [w.x + sx * h, w.z + sz * h, 0.03], [w.x + w.w + sx * h, w.z + sz * h, 0.03],
      [w.x + w.w + sx * h, w.z + w.d + sz * h, 0.03], [w.x + sx * h, w.z + w.d + sz * h, 0.03],
    ];
    // Convex hull (monotone chain) so overlapping side quads never double-darken.
    const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of s) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = s.length - 1; i >= 0; i--) { const p = s[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    const c = [w.x + w.w / 2, w.z + w.d / 2];
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i], q = hull[(i + 1) % hull.length];
      // Winding is CCW in (x,z), which faces up; shadows are viewed from above.
      tri(c[0], c[1], S, q[0], q[1], q[2], p[0], p[1], p[2]);
    }

    // Soft contact band hugging the footprint.
    const e = 0.55;
    const band = (ax, az, bx, bz, ox, oz) => {
      tri(ax, az, 0.5, ax + ox, az + oz, 0, bx + ox, bz + oz, 0);
      tri(ax, az, 0.5, bx + ox, bz + oz, 0, bx, bz, 0.5);
    };
    band(w.x, w.z + w.d, w.x + w.w, w.z + w.d, 0, e);
    band(w.x + w.w, w.z, w.x, w.z, 0, -e);
    band(w.x, w.z, w.x, w.z + w.d, -e, 0);
    band(w.x + w.w, w.z + w.d, w.x + w.w, w.z, e, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aStr', new THREE.Float32BufferAttribute(str, 1));
  return g;
}

export function buildWorld(map, teams, fogUniforms) {
  const theme = getTheme(map.theme);
  INK = theme.ink;
  CONTAINER_COLORS = theme.containers;
  const W = map.width, H = map.height;
  const lamps = [];
  const b = new MeshBuilder(makeBake(theme, lamps));
  const sb = new MeshBuilder(null);
  const glow = new GlowList();
  const timeU = { value: 0 };
  const flashU = { value: 0 };
  const ctx = { b, sb, glow, map, theme, W, H, lamps, timeU, flashU, rnd: mulberry(7321), noise: makeNoise(991), groundWet: 0 };

  // Lights come first: the ground and walls bake them in as they are generated.
  const stages = THEME_STAGES[theme.id];
  const dress = DRESS[theme.id];
  stages.lights(ctx);
  ground(ctx);
  stages.paint(ctx);
  spawnPads(b, map, teams, W);
  for (const w of map.walls) {
    const draw = dress[w.kind];
    if (draw) draw(ctx, w);
  }
  stages.decor(ctx);

  const group = new THREE.Group();
  const material = createWorldMaterial(fogUniforms, theme);
  material.uniforms.uTime = timeU;
  material.uniforms.uFlash = flashU;
  const world = new THREE.Mesh(b.build(), material);
  world.frustumCulled = false;
  group.add(world);

  const decalMat = new THREE.ShaderMaterial({
    vertexShader: `attribute float aStr; varying float vS; void main(){ vS = aStr; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uShadow; varying float vS; void main(){ gl_FragColor = vec4(mix(vec3(1.0), uShadow, vS), 1.0); }`,
    uniforms: { uShadow: { value: new THREE.Vector3(...theme.shadow.col) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    side: THREE.DoubleSide,
  });
  const decals = new THREE.Mesh(buildDecals(map, theme), decalMat);
  decals.frustumCulled = false;
  decals.renderOrder = -1;
  group.add(decals);

  let tris = b.pos.length / 9 + decals.geometry.getAttribute('position').count / 3;
  const addFogMesh = (geo, vs, fs, order, transparent) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vs, fragmentShader: fs,
      uniforms: { uFogTex: fogUniforms.tex, uFogXf: fogUniforms.xf, uFogOn: fogUniforms.on, uTime: timeU },
      transparent, depthWrite: !transparent,
      ...(transparent ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor } : {}),
      side: transparent ? THREE.DoubleSide : THREE.FrontSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = order;
    group.add(m);
    tris += geo.getAttribute('position').count / 3;
  };
  const water = waterMesh(ctx, fogUniforms);
  if (water) { group.add(water); tris += 2 * map.walls.filter(w => w.kind === 'water').length; }
  if (sb.pos.length) addFogMesh(sb.build(), SIGN_VERT, SIGN_FRAG, 0, false);
  if (glow.pos.length) addFogMesh(glow.build(), GLOW_VERT, GLOW_FRAG, 5, true);

  return {
    group, material, tris, lamps,
    drawCalls: group.children.length,
    // Advances the world's shader clock (signs, water, wet sheen). Lightning writes uFlash through Weather.
    update(dt) { timeU.value = (timeU.value + dt) % 3600; },
  };
}

// ---- Map vote thumbnail ----------------------------------------------------------------------------------

const THUMB_STYLE = {
  railyard: { ground: '#5a5552', solid: '#9aa3ae', low: '#6d6a60', edge: '#1f1d22' },
  harbor: { ground: '#3c434c', solid: '#7f93a8', low: '#566070', water: '#16324d', edge: '#10151c', hull: '#a8b0b6' },
  neon: { ground: '#2c2a36', solid: '#7a6090', low: '#544a68', edge: '#120f1c', accent: '#ff2e9e' },
  dust: { ground: '#a08f72', solid: '#6e5a42', low: '#8f7c5e', edge: '#3c2f22' },
};

// A static top-down thumbnail of a map from its wall data. Returns an HTMLCanvasElement; `scale` is
// pixels per metre. Team spawns are the two team colours, domination points are the little diamonds.
export function mapThumbnail(map, { width = 160, teams = null } = {}) {
  const s = THUMB_STYLE[map.theme] || THUMB_STYLE.railyard;
  const k = width / map.width;
  const height = Math.round(map.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = s.ground;
  g.fillRect(0, 0, width, height);
  // Water first so anything standing in it draws on top.
  if (s.water) {
    g.fillStyle = s.water;
    for (const w of map.walls) if (w.kind === 'water') g.fillRect(w.x * k, w.z * k, w.w * k, w.d * k);
  }
  for (const w of map.walls) {
    if (w.kind === 'border' || w.kind === 'water') continue;
    g.fillStyle = w.kind === 'hull' && s.hull ? s.hull : w.blocksVision ? s.solid : s.low;
    g.fillRect(w.x * k, w.z * k, Math.max(w.w * k, 1.5), Math.max(w.d * k, 1.5));
  }
  g.strokeStyle = s.edge;
  g.lineWidth = 2;
  g.strokeRect(1, 1, width - 2, height - 2);
  const colors = (teams || [{ css: '#38b6ff' }, { css: '#ff4d3d' }]).map(t => t.css);
  map.spawns.forEach((list, team) => {
    g.fillStyle = colors[team];
    for (const p of list) g.fillRect(p.x * k - 1.5, p.z * k - 1.5, 3, 3);
  });
  if (map.points) {
    g.fillStyle = '#f2e8c8';
    for (const p of map.points.dom) {
      g.beginPath();
      const r = Math.max(2.5, p.r * k * 0.4), x = p.x * k, y = p.z * k;
      g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
      g.closePath();
      g.fill();
    }
  }
  return canvas;
}
