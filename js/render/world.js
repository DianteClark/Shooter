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
  // A rooftop has nothing around it at ground level: the slab stops just under its own parapet.
  // A Ground War map is big enough that the camera never sees far past its edge, so it needs less skirt.
  const pad = theme.void ? 1.6 : map.large ? 18 : 28, cell = 1.5;
  const nx = Math.ceil((W + pad * 2) / cell), nz = Math.ceil((H + pad * 2) / cell);
  const xs = [], zs = [], fixedX = new Set(), fixedZ = new Set();
  for (let i = 0; i <= nx; i++) xs.push(-pad + i * cell);
  for (let j = 0; j <= nz; j++) zs.push(-pad + j * cell);
  const waters = map.walls.filter(w => w.kind === 'water');
  for (const w of waters) {
    for (const v of [w.x, w.x + w.w]) { const k = Math.round((v + pad) / cell); xs[k] = v; fixedX.add(k); }
    for (const v of [w.z, w.z + w.d]) { const k = Math.round((v + pad) / cell); zs[k] = v; fixedZ.add(k); }
  }
  const amp = theme.id === 'dust' ? 0.28 : theme.id === 'frost' ? 0.2 : theme.void ? 0.03 : 0.12;
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
  if (theme.id === 'frost') {
    // Snow, with dark ballast down every track and ploughed slush along the lanes.
    const tracks = ctx.tracks;
    return p => {
      const [x, , z] = p;
      if (!inMap(x, z)) return scale(INK.ground, 0.8 + noise(x * 0.15, z * 0.15) * 0.18);
      let dT = 99;
      for (const tx of tracks) dT = Math.min(dT, Math.abs(x - tx));
      if (dT < 1.6) return scale(INK.gravel, 0.84 + noise(x * 1.3, z * 1.3) * 0.26 + (rnd() - 0.5) * 0.06);
      const ploughed = laneDist(z) < 1.5 && noise(x * 0.2, z * 0.2) > 0.32;
      return scale(ploughed ? INK.dirt : INK.ground, 0.9 + noise(x * 0.6, z * 0.6) * 0.16 + (rnd() - 0.5) * 0.04);
    };
  }
  if (theme.id === 'topside') {
    // Poured slab: bays of slightly different concrete, with dust and cement stains.
    return p => {
      const [x, , z] = p;
      if (!inMap(x, z)) return scale(INK.concrete, 0.66);
      const bay = (Math.floor(x / 11.33) + Math.floor(z / 11)) % 2;
      const stain = noise(x * 0.22 + 4, z * 0.22) > 0.63;
      const base = stain ? INK.dirt : bay ? INK.ground : INK.asphalt;
      return scale(base, 0.93 + noise(x * 0.7, z * 0.7) * 0.13 + (rnd() - 0.5) * 0.04);
    };
  }
  if (theme.id === 'sunken') {
    // Moss and leaf litter on the banks, worn paving inside the moat ring, mud and puddles at the water.
    const waters = map.walls.filter(w => w.kind === 'water');
    const ring = waters.reduce((r, w) => [Math.min(r[0], w.x), Math.min(r[1], w.z), Math.max(r[2], w.x + w.w), Math.max(r[3], w.z + w.d)], [W, H, 0, 0]);
    const toWater = (x, z) => { let d = 99; for (const w of waters) d = Math.min(d, Math.hypot(Math.max(w.x - x, 0, x - w.x - w.w), Math.max(w.z - z, 0, z - w.z - w.d))); return d; };
    return p => {
      const [x, , z] = p;
      if (!inMap(x, z)) { ctx.groundWet = 0.2; return scale(INK.ground, 0.62 + noise(x * 0.2, z * 0.2) * 0.22); }
      const paved = x > ring[0] && x < ring[2] && z > ring[1] && z < ring[3];
      const dW = toWater(x, z);
      const puddle = noise(x * 0.4 + 7, z * 0.4) > 0.66;
      ctx.groundWet = puddle ? 1 : dW < 1.4 ? 0.7 : 0.15;
      if (puddle) return scale(INK.dirt, 0.55);
      let base = paved ? ((Math.floor(x / 1.5) + Math.floor(z / 1.5)) % 3 === 0 ? INK.gravel : INK.asphalt)
        : dW < 1.4 ? INK.dirt : noise(x * 0.12 + 2, z * 0.12) > 0.62 ? INK.moss : INK.ground;
      if (paved && noise(x * 0.5, z * 0.5 + 9) > 0.66) base = INK.moss;
      return scale(base, 0.92 + noise(x * 0.8, z * 0.8) * 0.14 + (rnd() - 0.5) * 0.04);
    };
  }
  if (theme.id === 'harvest') return harvestGround(ctx);
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
  if (!theme.water) return null;          // A void is a hole, drawn by its dresser.
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

// ---- Sky -----------------------------------------------------------------------------------------------

// A ring of additive gradient quads around the map, close enough to stay inside the camera's far plane, so a
// high camera sees a horizon instead of the clear colour. `sky` is {low, mid, high, warm, warmDir:[x,z]}: the
// horizon band is tinted toward `warm` on the side the light comes from. Costs no draw call (glow batch).
function skyRing(ctx, sky) {
  const { glow, W, H } = ctx;
  const cx = W / 2, cz = H / 2, R = Math.max(W, H) * 0.5 + 34, N = 28;
  const y0 = sky.y0 ?? -30, y1 = sky.y1 ?? 10, y2 = sky.y2 ?? 60;
  const wd = sky.warmDir || [-1, 0], wl = Math.hypot(wd[0], wd[1]);
  const band = a => {
    const k = Math.max(0, (Math.cos(a) * wd[0] + Math.sin(a) * wd[1]) / wl);
    const t = k * k;
    return [sky.mid[0] + (sky.warm[0] - sky.mid[0]) * t, sky.mid[1] + (sky.warm[1] - sky.mid[1]) * t, sky.mid[2] + (sky.warm[2] - sky.mid[2]) * t];
  };
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * R * 1.25, cz + Math.sin(a0) * R], p1 = [cx + Math.cos(a1) * R * 1.25, cz + Math.sin(a1) * R];
    const m0 = band(a0), m1 = band(a1);
    glow.quad([p0[0], y0, p0[1]], [p0[0], y1, p0[1]], [p1[0], y1, p1[1]], [p1[0], y0, p1[1]], sky.low, m0, m1, sky.low);
    glow.quad([p0[0], y1, p0[1]], [p0[0], y2, p0[1]], [p1[0], y2, p1[1]], [p1[0], y1, p1[1]], m0, sky.high, sky.high, m1);
  }
}

// ---- Frostline ------------------------------------------------------------------------------------------

// x of every track centre-line: each row of wagons standing north-south sits on one.
function frostTracks(map) {
  const xs = [];
  for (const w of map.walls) {
    if (!w.wagon || w.across) continue;
    const cx = Math.round((w.x + w.w / 2) * 100) / 100;
    if (!xs.includes(cx)) xs.push(cx);
  }
  return xs;
}

// Snow lying on top of something: a slab slightly inside the top face, lumpy at the ends.
function snowCap(b, x, y, z, w, d, k = 1) {
  b.setColor(scale(INK.snow, k));
  box3(b, x + 0.06, y, z + 0.06, w - 0.12, 0.1, d - 0.12, 0.04);
  b.setColor(scale(INK.snow, k * 1.04));
  box3(b, x + w * 0.2, y + 0.08, z + d * 0.2, w * 0.6, 0.07, d * 0.6, 0.03);
}

function frostLights(ctx) {
  const { lamps, glow, W, H } = ctx;
  const sodium = [1.0, 0.62, 0.26];
  // Yard masts stand just off the map; their pools are what lights the snow between the wagons.
  ctx.masts = [];
  for (let x = 9; x < W; x += 17) {
    ctx.masts.push([x, -1.1], [W - x, H + 1.1]);
    lamps.push({ x, z: 3.5, r: 12 }, { x: W - x, z: H - 3.5, r: 12 });
    glow.halo(x, 3.5, 8.5, scale(sodium, 0.17));
    glow.halo(W - x, H - 3.5, 8.5, scale(sodium, 0.17));
  }
  for (const w of ctx.map.walls) if (w.landmark) {
    lamps.push({ x: w.x + w.w / 2, z: w.z + w.d + 2, r: 8, col: [0.42, 0.3, 0.14] });
    glow.halo(w.x + w.w / 2, w.z + w.d + 1.6, 5, scale(sodium, 0.1));
  }
}

function frostPaint(ctx) {
  const { b, map, rnd, W, H } = ctx;
  const blocked = (x, z, pad = 0.2) => map.walls.some(w => w.kind !== 'border' && x > w.x - pad && x < w.x + w.w + pad && z > w.z - pad && z < w.z + w.d + pad);
  // Rails and sleepers down every track, running out under the snow beyond the yard.
  for (const tx of ctx.tracks) {
    for (let z = -6; z < H + 6; z += 1.05) {
      if (blocked(tx, z)) continue;
      b.setColor(INK.tie);
      box3(b, tx - 1.15, 0.02, z, 2.3, 0.1, 0.32);
    }
    for (const dx of [-0.72, 0.72]) {
      b.setColor(INK.rail);
      let start = null;
      for (let z = -26; z < H + 26.5; z += 0.5) {
        const free = !blocked(tx + dx, z, 0.05);
        if (free && start === null) start = z;
        if (!free && start !== null) { box3(b, tx + dx - 0.06, 0.1, start, 0.12, 0.08, z - start); start = null; }
      }
      if (start !== null) box3(b, tx + dx - 0.06, 0.1, start, 0.12, 0.08, H + 26 - start);
    }
  }
  // Drifts banked against the windward (north-west) faces of anything solid.
  for (const w of map.walls) {
    if (!w.blocksVision || w.kind === 'border') continue;
    b.setColor(scale(INK.snow, 0.92));
    for (let x = w.x - 0.3; x < w.x + w.w; x += 0.9) if (rnd() < 0.8) b.groundRect(x, w.z - 0.55 - rnd() * 0.25, 0.8, 0.5, 0.05);
    for (let z = w.z; z < w.z + w.d; z += 0.9) if (rnd() < 0.8) b.groundRect(w.x - 0.55 - rnd() * 0.25, z, 0.5, 0.8, 0.05);
  }
  // Boot prints and tyre ruts in the slush along the lanes.
  b.setColor(scale(INK.asphalt, 0.95));
  for (const lane of map.lanes) {
    let zc = lane.z - 0.7;
    for (let x = 1; x < W - 1; x += 0.8) {
      zc += (rnd() - 0.5) * 0.25; zc += (lane.z - 0.7 - zc) * 0.05;
      if (blocked(x, zc) || rnd() < 0.15) continue;
      b.groundRect(x, zc - 0.08, 0.7, 0.16, 0.04);
      b.groundRect(x, zc + 1.3, 0.7, 0.16, 0.04);
    }
  }
}

// Bogies, frame and buffers. Local frame: u along the wagon, v across it.
function wagonRunningGear(b, L, T) {
  for (const u of [1.25, L - 1.25]) {
    b.setColor(0x1d1f25);
    box3(b, u - 0.95, 0.14, 0.3, 1.9, 0.36, T - 0.6);
    b.setColor(0x2b2d33);
    // One wheel showing each side of a bogie is all the top-down camera can tell apart.
    b.prismZ(0.08, 0.3, u, 0.36, 0.4, 0.4, 6);
    b.prismZ(T - 0.3, T - 0.08, u, 0.36, 0.4, 0.4, 6);
  }
  b.setColor(0x24262c);
  box3(b, 0.1, 0.5, 0.25, L - 0.2, 0.28, T - 0.5);
  b.setColor(0x3a3d44);
  for (const u of [0.0, L - 0.16]) for (const v of [0.45, T - 0.75]) box3(b, u, 0.56, v, 0.16, 0.2, 0.3);
}

function wagon(ctx, w) {
  const { b, rnd } = ctx;
  const across = !!w.across;
  const L = across ? w.w : w.d, T = across ? w.d : w.w, h = w.h;
  // Lay the local frame onto the footprint: u runs along the wagon, v across it.
  b.matrix = across ? new THREE.Matrix4().makeTranslation(w.x, 0, w.z)
    : new THREE.Matrix4().makeTranslation(w.x + w.w, 0, w.z).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  wagonRunningGear(b, L, T);
  const base = hexRGB(CONTAINER_COLORS[Math.floor(rnd() * CONTAINER_COLORS.length)]);
  if (w.wagon === 'tank') {
    const r = Math.min(T / 2 - 0.06, (h - 0.82) / 2), cy = 0.8 + r;
    b.setColor(scale(base, 0.55));
    b.prismX(0.45, L - 0.45, cy, T / 2, r, r, 10, Math.PI / 10);
    b.prismX(0.12, 0.45, cy, T / 2, r * 0.62, r, 10, Math.PI / 10);
    b.prismX(L - 0.45, L - 0.12, cy, T / 2, r, r * 0.62, 10, Math.PI / 10);
    b.setColor(scale(base, 0.7));
    for (const u of [L * 0.3, L * 0.7]) b.prismX(u - 0.07, u + 0.07, cy, T / 2, r + 0.03, r + 0.03, 10, Math.PI / 10);
    b.setColor(0x34363c);
    b.prismY(cy + r - 0.1, cy + r + 0.3, L / 2, T / 2, 0.36, 0.3, 8);
    b.setColor(INK.hazardY);
    box3(b, 0.5, cy - 0.12, -0.02, 1.0, 0.24, 0.04);
    box3(b, L - 1.5, cy - 0.12, T - 0.02, 1.0, 0.24, 0.04);
    b.setColor(INK.snow);
    box3(b, 0.7, cy + r - 0.06, T / 2 - 0.42, L - 1.4, 0.1, 0.84, 0.04);
    box3(b, L / 2 - 0.3, cy + r + 0.28, T / 2 - 0.3, 0.6, 0.06, 0.6);
  } else if (w.wagon === 'loco') {
    const red = [0.5, 0.15, 0.12];
    b.setColor(red);
    box3(b, 1.0, 0.8, 0.4, L - 3.2, 1.55, T - 0.8, 0.06);
    b.setColor(INK.hazardY);
    box3(b, 1.0, 0.8, 0.36, L - 3.2, 0.22, T - 0.72);
    b.setColor(scale(red, 0.85));
    box3(b, L - 2.25, 0.8, 0.12, 2.1, h - 0.8, T - 0.24, 0.05);
    b.setColor(0x2a2c32);
    box3(b, L - 2.35, h - 0.08, 0.05, 2.3, 0.12, T - 0.1);
    emissive(b, () => {
      b.setColor(scale(INK.glow, 0.85));
      box3(b, L - 2.0, h - 1.1, -0.02, 1.6, 0.55, 0.04);
      box3(b, L - 2.0, h - 1.1, T - 0.02, 1.6, 0.55, 0.04);
      b.setColor([1, 0.96, 0.82]);
      box3(b, -0.02, 1.7, T / 2 - 0.5, 0.04, 0.22, 0.22);
      box3(b, -0.02, 1.7, T / 2 + 0.28, 0.04, 0.22, 0.22);
      b.setColor([1, 0.2, 0.15]);
      box3(b, L - 0.02, 1.2, 0.3, 0.04, 0.16, 0.16);
    });
    b.setColor(0x24262c);
    b.prismY(2.35, 2.75, 2.0, T / 2, 0.14, 0.12, 6);
    // Hazard chevrons on both ends.
    for (const u of [0.02, L - 0.06]) for (let k = 0; k < 4; k++) {
      b.setColor(k % 2 ? INK.hazardK : INK.hazardY);
      box3(b, u, 0.62, 0.3 + k * (T - 0.6) / 4, 0.04, 0.16, (T - 0.6) / 4);
    }
    snowCap(b, 1.0, 2.35, 0.4, L - 3.2, T - 0.8);
    snowCap(b, L - 2.3, h + 0.04, 0.05, 2.2, T - 0.1);
    ctx.glow.streak(across ? w.x - 0.3 : w.x + w.w / 2, across ? w.z + w.d / 2 : w.z - 0.3, 1.6, 4, [0.22, 0.2, 0.15], 0.08);
  } else {
    // Box wagon: ribbed sides, a sliding door each side, snow on the roof.
    b.setColor(base);
    box3(b, 0.1, 0.78, 0.06, L - 0.2, h - 0.95, T - 0.12);
    b.setColor(scale(base, 1.16));
    for (let u = 0.4; u < L - 0.3; u += 0.95) {
      box3(b, u, 0.82, 0.02, 0.1, h - 1.05, 0.05);
      box3(b, u, 0.82, T - 0.07, 0.1, h - 1.05, 0.05);
    }
    b.setColor(scale(base, 0.68));
    box3(b, L / 2 - 0.85, 0.86, 0.0, 1.7, h - 1.2, 0.07);
    box3(b, L / 2 - 0.85, 0.86, T - 0.07, 1.7, h - 1.2, 0.07);
    b.setColor(0xd2cab8);
    box3(b, 0.6, h - 0.75, -0.01, 1.1, 0.32, 0.03);
    box3(b, L - 1.7, h - 0.75, T - 0.02, 1.1, 0.32, 0.03);
    b.setColor(scale(base, 0.8));
    box3(b, 0.04, h - 0.2, 0.02, L - 0.08, 0.14, T - 0.04);
    snowCap(b, 0.04, h - 0.07, 0.02, L - 0.08, T - 0.04);
    // Icicles along the eaves of the long, camera-facing side.
    b.setColor(INK.ice);
    for (let u = 0.6; u < L - 0.4; u += 0.9 + rnd() * 0.7) b.prismY(h - 0.55 - rnd() * 0.3, h - 0.2, u, T + 0.01, 0.0, 0.05, 3);
  }
  b.matrix = null;
}

// Snowbank: lumpy mound of ploughed snow, nothing sticking out of its footprint.
function snowbank(ctx, w) {
  const { b, rnd } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  const n = Math.max(2, Math.round(L / 0.8));
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * (L / n), r = T * (0.42 + rnd() * 0.08), top = w.h * (0.75 + rnd() * 0.25);
    b.setColor(scale(INK.snow, 0.9 + rnd() * 0.12));
    const cx = long ? w.x + s : w.x + w.w / 2, cz = long ? w.z + w.d / 2 : w.z + s;
    b.prismY(0, top * 0.6, cx, cz, Math.min(r * 1.15, T / 2), r, 7, rnd());
    b.prismY(top * 0.6, top, cx, cz, r, r * 0.35, 7, rnd());
  }
}

function frostWall(ctx, w) {
  concreteWall(ctx.b, w);
  snowCap(ctx.b, w.x - 0.04, w.h, w.z - 0.04, w.w + 0.08, w.d + 0.08);
}

function frostCrate(ctx, w) {
  crate(ctx.b, w, ctx.rnd);
  snowCap(ctx.b, w.x, w.h, w.z, w.w, w.d);
}

function frostBarrier(ctx, w) {
  barrier(ctx.b, w);
  const long = w.w >= w.d;
  ctx.b.setColor(INK.snow);
  if (long) box3(ctx.b, w.x + 0.1, w.h, w.z + w.d * 0.3, w.w - 0.2, 0.08, w.d * 0.4);
  else box3(ctx.b, w.x + w.w * 0.3, w.h, w.z + 0.1, w.w * 0.4, 0.08, w.d - 0.2);
}

// Pitched roof along the long axis, with snow on it.
function snowRoof(b, x, y, z, w, d, rise, over = 0.25) {
  const ew = w >= d;
  b.setColor(INK.roof);
  if (ew) {
    b.loft([
      [[x - over, y, z - over], [x - over, y + rise, z + d / 2], [x - over, y, z + d + over]],
      [[x + w + over, y, z - over], [x + w + over, y + rise, z + d / 2], [x + w + over, y, z + d + over]],
    ]);
  } else {
    b.loft([
      [[x - over, y, z - over], [x + w / 2, y + rise, z - over], [x + w + over, y, z - over]],
      [[x - over, y, z + d + over], [x + w / 2, y + rise, z + d + over], [x + w + over, y, z + d + over]],
    ]);
  }
}

function frostBuilding(ctx, w) {
  const { b, glow, lamps } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  if (w.landmark) {
    // Signal box: brick locking room below, a glazed cabin above with the lever frame lit inside.
    b.setColor(INK.wall);
    box3(b, x, 0, z, bw, h * 0.5, bd);
    b.setColor(scale(INK.wall, 0.8));
    box3(b, x - 0.05, 0, z - 0.05, bw + 0.1, 0.4, bd + 0.1);
    b.setColor(INK.timber);
    box3(b, x - 0.12, h * 0.5, z - 0.12, bw + 0.24, h * 0.5 - 0.35, bd + 0.24);
    emissive(b, () => {
      b.setColor(INK.glow);
      for (const [fx, fz, fw, fd] of [[x + 0.3, z + bd + 0.12, bw - 0.6, 0.04], [x + 0.3, z - 0.16, bw - 0.6, 0.04], [x - 0.16, z + 0.3, 0.04, bd - 0.6], [x + bw + 0.12, z + 0.3, 0.04, bd - 0.6]]) {
        box3(b, fx, h * 0.5 + 0.35, fz, fw, h * 0.32, fd);
      }
    });
    b.setColor(INK.timber);
    for (let u = 0.3; u < bw - 0.1; u += 1.1) box3(b, x + u, h * 0.5 + 0.3, z + bd + 0.1, 0.12, h * 0.36, 0.1);
    snowRoof(b, x - 0.1, h - 0.35, z - 0.1, bw + 0.2, bd + 0.2, 1.1);
    b.setColor(INK.snow);
    box3(b, x - 0.2, h + 0.6, z + bd / 2 - 0.15, bw + 0.4, 0.14, 0.3);
    // Name board and a chimney.
    b.setColor(0x1f2a3a);
    box3(b, x + bw / 2 - 1.2, h * 0.5 - 0.1, z + bd + 0.12, 2.4, 0.4, 0.05);
    b.setColor(scale(INK.wall, 0.9));
    box3(b, x + bw - 1.1, h - 0.2, z + 0.8, 0.6, 1.8, 0.6);
    glow.streak(x + bw / 2, z + bd + 0.3, 3.5, 4.5, scale(INK.glow, 0.14), 0.08);
    return;
  }
  if (w.stage) {
    // Coal stage: a timber trestle with a heap of coal on it, and a chute.
    b.setColor(INK.timber);
    box3(b, x, 0, z, bw, h * 0.55, bd);
    b.setColor(scale(INK.timber, 1.25));
    for (let u = 0.3; u < bw; u += 0.9) box3(b, x + u, 0, z + bd, 0.16, h * 0.55, 0.06);
    b.setColor(INK.coal);
    b.prismY(h * 0.55, h, x + bw / 2, z + bd / 2, Math.min(bw, bd) * 0.62, Math.min(bw, bd) * 0.18, 7, 0.3);
    b.setColor(INK.snow);
    b.prismY(h - 0.05, h + 0.06, x + bw / 2, z + bd / 2, Math.min(bw, bd) * 0.2, Math.min(bw, bd) * 0.05, 7, 0.3);
    b.setColor(scale(INK.timber, 0.7));
    box3(b, x + bw * 0.3, h * 0.35, z + bd, 1.0, 0.16, 0.9);
    return;
  }
  if (w.tower) {
    // Water tower: brick base, riveted tank, conical snow-covered roof, and the filling arm.
    b.setColor(INK.wall);
    box3(b, x + 0.15, 0, z + 0.15, bw - 0.3, 1.9, bd - 0.3);
    b.setColor(0x3a4450);
    b.prismY(1.9, h - 0.1, x + bw / 2, z + bd / 2, bw / 2, bw / 2, 10, Math.PI / 10);
    b.setColor(0x2e3640);
    for (const y of [2.3, 2.9]) b.prismY(y, y + 0.07, x + bw / 2, z + bd / 2, bw / 2 + 0.03, bw / 2 + 0.03, 10, Math.PI / 10);
    b.setColor(INK.snow);
    b.prismY(h - 0.1, h + 0.9, x + bw / 2, z + bd / 2, bw / 2 + 0.1, 0.12, 10, Math.PI / 10);
    b.setColor(0x24262c);
    box3(b, x + bw - 0.2, h - 0.8, z + bd / 2 - 0.1, 1.2, 0.2, 0.2);
    return;
  }
  // Relay hut and the lamp-room sheds: brick or concrete, a snowy pitched roof, one lit window.
  b.setColor(w.hut ? INK.concrete : INK.wall);
  box3(b, x, 0, z, bw, h - 0.4, bd);
  b.setColor(INK.trim);
  box3(b, x - 0.04, 0, z - 0.04, bw + 0.08, 0.3, bd + 0.08);
  snowRoof(b, x, h - 0.4, z, bw, bd, 0.65, 0.18);
  if (w.hut) {
    b.setColor(0x31404e);
    box3(b, x + bw / 2 - 0.35, 0, z + bd + 0.01, 0.7, 1.7, 0.05);
    emissive(b, () => { b.setColor([1, 0.22, 0.16]); box3(b, x + bw - 0.4, h - 0.8, z + bd + 0.02, 0.16, 0.16, 0.04); });
  } else {
    emissive(b, () => { b.setColor(INK.glow); box3(b, x + bw + 0.01, 1.2, z + bd / 2 - 0.5, 0.04, 0.6, 1.0); });
    lamps.push({ x: x + bw + 1.5, z: z + bd / 2, r: 4.5, col: [0.32, 0.22, 0.1] });
  }
}

function frostBorder(ctx, w) {
  border(ctx.b, w);
  snowCap(ctx.b, w.x - 0.2, w.h + 0.3, w.z - 0.2, w.w + 0.4, w.d + 0.4, 0.95);
}

function pine(b, x, z, hgt, rnd) {
  b.setColor(INK.timber);
  b.prismY(0, hgt * 0.25, x, z, 0.18, 0.14, 4);
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const y0 = hgt * (0.18 + i * 0.24), y1 = y0 + hgt * 0.42, r = hgt * (0.3 - i * 0.07);
    b.setColor([0.12, 0.2, 0.2]);
    b.prismY(y0, y1, x, z, r, 0.02, 6, rnd() * 3);
    b.setColor(scale(INK.snow, 0.9));
    b.prismY(y1 - hgt * 0.16, y1 - hgt * 0.06, x, z, r * 0.42, r * 0.14, 5, rnd() * 3);
  }
}

function frostDecor(ctx) {
  const { b, glow, rnd, W, H } = ctx;
  // Yard lamp masts.
  for (const [x, z] of ctx.masts) {
    const s = z < 0 ? 1 : -1;
    b.setColor(0x3c424c);
    b.prismY(4, 8.2, x, z, 0.14, 0.1, 6);
    b.setColor(0x2c3038);
    box3(b, x - 0.9, 8.1, z + (s > 0 ? -0.2 : -0.25), 1.8, 0.14, 0.45);
    emissive(b, () => { b.setColor([1.0, 0.72, 0.4]); box3(b, x - 0.75, 8.0, z + (s > 0 ? 0.1 : -0.36), 1.5, 0.06, 0.26); });
  }
  // A long freight standing on the through road north of the yard, and a goods shed south.
  for (let x = -24; x < W + 20; x += 9.4) {
    const c = hexRGB(CONTAINER_COLORS[Math.floor(rnd() * CONTAINER_COLORS.length)]);
    b.setColor(scale(c, 0.62));
    box3(b, x, 0.7, -7.4, 8.8, 2.4, 2.6);
    b.setColor(scale(INK.snow, 0.85));
    box3(b, x + 0.1, 3.1, -7.3, 8.6, 0.12, 2.4);
    b.setColor(0x1d1f25);
    box3(b, x + 0.6, 0.1, -7.1, 7.6, 0.6, 2.0);
  }
  b.setColor(scale(INK.wall, 0.55));
  box3(b, -8, 0, H + 6, W + 16, 4.5, 8);
  snowRoof(b, -8, 4.5, H + 6, W + 16, 8, 1.6);
  emissive(b, () => {
    b.setColor(scale(INK.glow, 0.7));
    for (let x = -4; x < W + 6; x += 6.5) box3(b, x, 1.6, H + 5.98, 1.6, 1.0, 0.04);
  });
  for (let x = -4; x < W + 6; x += 6.5) glow.streak(x + 0.8, H + 5.2, 1.6, -3, scale(INK.glow, 0.08), 0.08);
  skyRing(ctx, { low: [0.03, 0.05, 0.09], mid: [0.08, 0.12, 0.2], warm: [0.2, 0.26, 0.38], high: [0.01, 0.02, 0.05], warmDir: [-0.4, -1], y0: -6, y1: 8, y2: 50 });
  // Snowed-in pines round the edges.
  for (let i = 0; i < 52; i++) {
    const side = i % 4;
    const t = rnd();
    let x, z;
    if (side === 0) { x = -26 + t * (W + 52); z = -11 - rnd() * 14; }
    else if (side === 1) { x = -26 + t * (W + 52); z = H + 15 + rnd() * 12; }
    else if (side === 2) { x = -5 - rnd() * 18; z = -8 + t * (H + 16); }
    else { x = W + 5 + rnd() * 18; z = -8 + t * (H + 16); }
    pine(b, x, z, 4 + rnd() * 4.5, rnd);
  }
}

// ---- Topside -------------------------------------------------------------------------------------------

const VOID_FLOOR = -3.4;        // The floor below, seen through a light well.
const STREET_Y = -46;           // The city, a long way down.

function topsideLights(ctx) {
  const { map, lamps, glow, W, H } = ctx;
  // Work lights on stands: weak against the low sun, but they warm the shadow side of the cores.
  ctx.workLights = [];
  for (const w of map.walls) {
    if (w.kind !== 'building') continue;
    const x = w.x + w.w / 2, z = w.z + w.d + 1.2;
    if (z > H - 1) continue;
    ctx.workLights.push([x, z - 0.6]);
    lamps.push({ x, z: z + 1, r: 6 });
    glow.halo(x, z + 0.6, 3.6, [0.12, 0.09, 0.05]);
  }
}

function topsidePaint(ctx) {
  const { b, map, rnd, W, H } = ctx;
  const blocked = (x, z, pad = 0.2) => map.walls.some(w => w.kind !== 'border' && x > w.x - pad && x < w.x + w.w + pad && z > w.z - pad && z < w.z + w.d + pad);
  // Saw-cut pour joints, and the setting-out chalk lines the next floor will be built on.
  b.setColor(scale(INK.ground, 0.62));
  for (let x = 11.33; x < W - 1; x += 11.33) for (let z = 0.3; z < H; z += 0.9) if (!blocked(x, z)) b.groundRect(x - 0.04, z, 0.08, 0.8, 0.03);
  for (let z = 11; z < H - 1; z += 11) for (let x = 0.3; x < W; x += 0.9) if (!blocked(x, z)) b.groundRect(x, z - 0.04, 0.8, 0.08, 0.03);
  b.setColor(scale(INK.paint, 0.9));
  for (const w of map.walls) {
    if (!w.column) continue;
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let s = 0.9; s < 3.2; s += 0.5) {
        const x = cx + dx * s, z = cz + dz * s;
        if (!blocked(x, z, 0.05)) b.groundRect(x - (dz ? 0.02 : 0.2), z - (dx ? 0.02 : 0.2), dz ? 0.04 : 0.4, dx ? 0.04 : 0.4, 0.035);
      }
    }
  }
  // Offcuts lying flat: planks, a sheet of ply, a tangle of tie wire.
  for (let i = 0; i < 46; i++) {
    const x = 2 + rnd() * (W - 4), z = 2 + rnd() * (H - 4);
    if (blocked(x, z, 0.6)) continue;
    const k = rnd();
    if (k < 0.5) { b.setColor(scale(INK.crate, 0.8 + rnd() * 0.3)); b.groundRect(x, z, rnd() < 0.5 ? 1.6 : 0.16, rnd() < 0.5 ? 0.16 : 1.6, 0.05); }
    else if (k < 0.75) { b.setColor(scale(INK.board, 0.8)); b.groundRect(x, z, 1.2, 0.8, 0.045); }
    else { b.setColor(INK.rebar); b.groundRect(x, z, 0.9, 0.05, 0.05); b.groundRect(x + 0.2, z - 0.3, 0.05, 0.8, 0.05); }
  }
}

// Steel column: an I-section with a primed foot, base plate and the stubs of tomorrow's beams.
function steelColumn(ctx, w) {
  const { b } = ctx;
  const { x, z, w: cw, d: cd, h } = w;
  b.setColor(scale(INK.concrete, 0.85));
  box3(b, x - 0.12, 0, z - 0.12, cw + 0.24, 0.14, cd + 0.24);
  for (const [y0, y1, c] of [[0.14, 1.0, INK.primer], [1.0, h, INK.steel]]) {
    b.setColor(c);
    box3(b, x, y0, z, cw, y1 - y0, 0.16);
    box3(b, x, y0, z + cd - 0.16, cw, y1 - y0, 0.16);
    b.setColor(scale(c, 0.78));
    box3(b, x + cw / 2 - 0.07, y0, z + 0.16, 0.14, y1 - y0, cd - 0.32);
  }
  b.setColor(INK.steelD);
  box3(b, x - 0.05, h, z - 0.05, cw + 0.1, 0.1, cd + 0.1);
  box3(b, x + cw, h - 0.5, z + cd / 2 - 0.12, 0.5, 0.4, 0.24);
  box3(b, x + cw / 2 - 0.12, h - 0.5, z + cd, 0.24, 0.4, 0.5);
}

// Half-built blockwork: courses of block with a stepped top where the gang stopped for the day.
function blockwork(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd, L = long ? bw : bd;
  const course = 0.4, n = Math.floor(h / course);
  for (let i = 0; i < n; i++) {
    b.setColor(scale(i % 2 ? INK.wall : INK.wallB, 0.96 + rnd() * 0.08));
    const y = i * course;
    box3(b, x, y, z, bw, course - 0.03, bd);
    b.setColor(scale(INK.wall, 0.7));
    box3(b, x + (long ? 0 : -0.01), y + course - 0.03, z + (long ? -0.01 : 0), bw + (long ? 0 : 0.02), 0.03, bd + (long ? 0.02 : 0));
  }
  // The top course runs only part of the way; a few loose blocks wait on it.
  const top = n * course, part = L * (0.4 + rnd() * 0.3);
  b.setColor(INK.wall);
  if (long) box3(b, x, top, z, part, h - top + 0.2, bd); else box3(b, x, top, z, bw, h - top + 0.2, part);
  b.setColor(INK.rebar);
  for (let s = 0.3; s < L; s += 0.8) {
    if (long) b.prismY(top, top + 0.7, x + s, z + bd / 2, 0.025, 0.025, 4);
    else b.prismY(top, top + 0.7, x + bw / 2, z + s, 0.025, 0.025, 4);
  }
}

// Palletised material: plasterboard under a blue tarp, or rebar bundles on timber bearers.
function materialStack(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: sw, d: sd, h } = w;
  const long = sw >= sd;
  b.setColor(INK.crate);
  box3(b, x + 0.05, 0, z + 0.05, sw - 0.1, 0.16, sd - 0.1);
  if (w.stack === 'rebar') {
    const layers = 5, lh = (h - 0.2) / layers;
    for (let i = 0; i < layers; i++) {
      const y = 0.16 + i * lh;
      b.setColor(INK.crateD);
      if (long) for (const u of [0.4, sw - 0.6]) box3(b, x + u, y, z + 0.05, 0.2, 0.1, sd - 0.1);
      else for (const u of [0.4, sd - 0.6]) box3(b, x + 0.05, y, z + u, sw - 0.1, 0.1, 0.2);
      const n = Math.max(2, Math.floor((long ? sd : sw) / 0.45));
      for (let k = 0; k < n; k++) {
        b.setColor(scale(INK.rebar, 0.85 + rnd() * 0.3));
        const off = (k + 0.5) * ((long ? sd : sw) - 0.1) / n + 0.05;
        if (long) b.prismX(x, x + sw, y + 0.1 + lh * 0.4, z + off, lh * 0.42, lh * 0.42, 5, rnd());
        else b.prismZ(z, z + sd, x + off, y + 0.1 + lh * 0.4, lh * 0.42, lh * 0.42, 5, rnd());
      }
    }
    return;
  }
  const layers = 4, lh = (h - 0.2) / layers;
  for (let i = 0; i < layers; i++) {
    const y = 0.16 + i * lh, inset = (i % 2) * 0.04;
    b.setColor(scale(INK.board, 0.9 + (i % 2) * 0.08));
    box3(b, x + 0.08 + inset, y, z + 0.08 + inset, sw - 0.16 - inset * 2, lh - 0.04, sd - 0.16 - inset * 2);
    b.setColor(INK.crateD);
    box3(b, x + 0.08, y + lh - 0.04, z + 0.08, sw - 0.16, 0.04, sd - 0.16);
  }
  // The tarp is thrown over the top and hangs down the north and east faces.
  b.setColor(INK.tarp);
  box3(b, x + 0.02, h - 0.06, z + 0.02, sw - 0.04, 0.08, sd - 0.04);
  box3(b, x + 0.02, h * 0.45, z - 0.01, sw - 0.04, h * 0.55 - 0.04, 0.05);
  box3(b, x + sw - 0.04, h * 0.55, z + 0.02, 0.05, h * 0.45 - 0.04, sd - 0.04);
  b.setColor(INK.hazardY);
  if (long) for (const u of [0.25, 0.7]) box3(b, x + sw * u, h + 0.02, z, 0.08, 0.03, sd);
  else for (const u of [0.25, 0.7]) box3(b, x, h + 0.02, z + sd * u, sw, 0.03, 0.08);
}

// A pallet of bricks wrapped in film.
function brickPallet(ctx, w) {
  const { b } = ctx;
  const { x, z, w: pw, d: pd, h } = w;
  b.setColor(INK.crate);
  box3(b, x + 0.05, 0, z + 0.05, pw - 0.1, 0.15, pd - 0.1);
  b.setColor(INK.brick);
  box3(b, x + 0.08, 0.15, z + 0.08, pw - 0.16, h - 0.17, pd - 0.16);
  b.setColor(scale(INK.brick, 0.72));
  for (let y = 0.3; y < h - 0.05; y += 0.16) {
    box3(b, x + 0.07, y, z + pd - 0.1, pw - 0.14, 0.025, 0.03);
    box3(b, x + pw - 0.1, y, z + 0.07, 0.03, 0.025, pd - 0.14);
  }
  b.setColor([0.78, 0.82, 0.86]);
  box3(b, x + 0.1, h - 0.03, z + 0.1, pw - 0.2, 0.03, pd - 0.2);
}

// Rooftop plant: a galvanised box with two fan grilles on top.
function plantUnit(ctx, w) {
  const { b } = ctx;
  const { x, z, w: uw, d: ud, h } = w;
  b.setColor([0.56, 0.6, 0.64]);
  box3(b, x + 0.04, 0.1, z + 0.04, uw - 0.08, h - 0.12, ud - 0.08, 0.04);
  b.setColor(0x34383e);
  box3(b, x, 0, z, uw, 0.12, ud);
  const long = uw >= ud;
  for (const k of [0.28, 0.72]) {
    const cx = long ? x + uw * k : x + uw / 2, cz = long ? z + ud / 2 : z + ud * k;
    const r = Math.min(long ? ud : uw, (long ? uw : ud) / 2) * 0.36;
    b.setColor(0x2a2d33);
    b.prismY(h - 0.02, h + 0.03, cx, cz, r, r, 10);
    b.setColor([0.44, 0.48, 0.52]);
    box3(b, cx - r, h + 0.03, cz - 0.03, r * 2, 0.03, 0.06);
    box3(b, cx - 0.03, h + 0.03, cz - r, 0.06, 0.03, r * 2);
  }
  b.setColor(0x3a3e44);
  b.prismX(x - 0.3, x + 0.04, 0.5, z + ud / 2, 0.12, 0.12, 6);
}

function topsideBarrier(ctx, w) {
  if (w.plant) plantUnit(ctx, w); else barrier(ctx.b, w);
}

// Light well: the cut slab face, a hazard edge, a guard rail, and the dim floor below.
function lightWell(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: vw, d: vd } = w;
  b.setColor(scale(INK.concrete, 0.55));
  b.quad([x, 0, z], [x + vw, 0, z], [x + vw, VOID_FLOOR, z], [x, VOID_FLOOR, z], [x + vw / 2, -1, z - 1]);
  b.quad([x + vw, 0, z + vd], [x, 0, z + vd], [x, VOID_FLOOR, z + vd], [x + vw, VOID_FLOOR, z + vd], [x + vw / 2, -1, z + vd + 1]);
  b.quad([x, 0, z + vd], [x, 0, z], [x, VOID_FLOOR, z], [x, VOID_FLOOR, z + vd], [x - 1, -1, z + vd / 2]);
  b.quad([x + vw, 0, z], [x + vw, 0, z + vd], [x + vw, VOID_FLOOR, z + vd], [x + vw, VOID_FLOOR, z], [x + vw + 1, -1, z + vd / 2]);
  b.setColor(scale(INK.concrete, 0.3));
  b.groundRect(x - 0.5, z - 0.5, vw + 1, vd + 1, VOID_FLOOR);
  // Clutter on the floor below and a work lamp down there, so the hole has depth.
  for (let i = 0; i < 4; i++) {
    b.setColor(scale(i % 2 ? INK.board : INK.crate, 0.4));
    box3(b, x + 0.4 + rnd() * (vw - 1.4), VOID_FLOOR, z + 0.4 + rnd() * (vd - 1.4), 0.6 + rnd() * 0.5, 0.3 + rnd() * 0.4, 0.6 + rnd() * 0.5);
  }
  emissive(b, () => { b.setColor(scale(INK.glow, 0.6)); box3(b, x + vw * 0.5, VOID_FLOOR + 1.6, z + 0.05, 0.4, 0.16, 0.1); });
  ctx.glow.halo(x + vw / 2, z + 0.9, 1.8, [0.1, 0.07, 0.03], VOID_FLOOR + 0.04, 10);
  // Hazard edge and guard rail. The rail is visual: the hole already stops feet.
  const edge = (x0, z0, x1, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / 0.5));
    const dx = (x1 - x0) / L, dz = (z1 - z0) / L;
    for (let i = 0; i < n; i++) {
      b.setColor(i % 2 ? INK.hazardK : INK.hazardY);
      const s = (i / n) * L, e = ((i + 1) / n) * L;
      const ax = x0 + dx * s, az = z0 + dz * s, bx = x0 + dx * e, bz = z0 + dz * e;
      box3(b, Math.min(ax, bx) - (dz ? 0.08 : 0), 0, Math.min(az, bz) - (dx ? 0.08 : 0), Math.abs(bx - ax) + (dz ? 0.16 : 0), 0.06, Math.abs(bz - az) + (dx ? 0.16 : 0));
    }
    b.setColor(INK.hazardY);
    for (let s = 0; s <= L + 0.01; s += L / Math.max(1, Math.round(L / 1.6))) b.prismY(0, 1.0, x0 + dx * s, z0 + dz * s, 0.04, 0.04, 4);
    b.setColor([0.86, 0.3, 0.2]);
    box3(b, Math.min(x0, x1) - 0.03, 0.96, Math.min(z0, z1) - 0.03, Math.abs(x1 - x0) + 0.06, 0.06, Math.abs(z1 - z0) + 0.06);
    b.setColor([0.9, 0.88, 0.84]);
    box3(b, Math.min(x0, x1) - 0.02, 0.5, Math.min(z0, z1) - 0.02, Math.abs(x1 - x0) + 0.04, 0.05, Math.abs(z1 - z0) + 0.04);
  };
  edge(x, z, x + vw, z); edge(x + vw, z, x + vw, z + vd); edge(x, z + vd, x + vw, z + vd); edge(x, z, x, z + vd);
}

// Concrete cores: the lift core in the middle, and the stair cores the teams spawn behind.
function topsideCore(ctx, w) {
  const { b, glow } = ctx;
  const { x, z, w: cw, d: cd, h } = w;
  b.setColor(INK.concrete);
  box3(b, x, 0, z, cw, h, cd);
  b.setColor(scale(INK.concrete, 0.86));
  for (let y = 0.9; y < h; y += 0.9) box3(b, x - 0.02, y, z - 0.02, cw + 0.04, 0.04, cd + 0.04);
  // Formwork and props around the top where the next lift will be poured.
  b.setColor(INK.crate);
  box3(b, x - 0.1, h - 0.1, z - 0.1, cw + 0.2, 0.5, 0.12);
  box3(b, x - 0.1, h - 0.1, z + cd - 0.02, cw + 0.2, 0.5, 0.12);
  box3(b, x - 0.1, h - 0.1, z, 0.12, 0.5, cd);
  box3(b, x + cw - 0.02, h - 0.1, z, 0.12, 0.5, cd);
  b.setColor(INK.rebar);
  for (let u = 0.4; u < cw - 0.2; u += 0.6) b.prismY(h, h + 1.1, x + u, z + 0.25, 0.03, 0.03, 4);
  b.setColor(0x2c2f36);
  box3(b, x + cw / 2 - 0.6, 0, z + cd + 0.01, 1.2, 2.1, 0.05);
  if (w.landmark) {
    // Hoist cage up the south face, and the lift car's light in the shaft.
    b.setColor(INK.crane);
    for (const u of [cw * 0.2, cw * 0.2 + 1.6]) b.prismY(0, h + 1.6, x + u, z + cd + 0.12, 0.06, 0.06, 4);
    for (let y = 0.5; y < h + 1.6; y += 0.8) box3(b, x + cw * 0.2, y, z + cd + 0.08, 1.6, 0.06, 0.08);
    emissive(b, () => { b.setColor(INK.glow); box3(b, x + cw * 0.2 + 0.2, 1.0, z + cd + 0.02, 1.2, 1.6, 0.04); });
    glow.streak(x + cw * 0.2 + 0.8, z + cd + 0.2, 1.6, 3, [0.16, 0.12, 0.06], 0.05);
    b.setColor(INK.hazardY);
    box3(b, x + 0.2, h + 0.4, z + 0.2, cw - 0.4, 0.04, 0.3);
  } else {
    b.setColor(INK.hazardY);
    box3(b, x + cw / 2 - 0.7, 2.1, z + cd + 0.01, 1.4, 0.12, 0.06);
  }
}

// The parapet at the slab edge, and the tower's glass face falling away to the street outside it.
function topsideEdge(ctx, w) {
  const { b, W, H } = ctx;
  const { x, z, w: bw, d: bd } = w;
  const long = bw > bd;
  b.setColor(scale(INK.concrete, 0.8));
  box3(b, x, 0, z, bw, 0.5, bd);
  // Edge protection: yellow posts with mesh panels.
  const L = long ? bw : bd, n = Math.round(L / 2.4);
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * L;
    b.setColor(INK.hazardY);
    if (long) box3(b, x + s - 0.05, 0.5, z + bd * 0.4, 0.1, 1.1, 0.1); else box3(b, x + bd * 0.4, 0.5, z + s - 0.05, 0.1, 1.1, 0.1);
  }
  b.setColor([0.3, 0.32, 0.36]);
  if (long) { box3(b, x, 0.55, z + bd * 0.45, bw, 1.0, 0.03); box3(b, x, 1.55, z + bd * 0.4, bw, 0.06, 0.12); }
  else { box3(b, x + bw * 0.45, 0.55, z, 0.03, 1.0, bd); box3(b, x + bw * 0.4, 1.55, z, 0.12, 0.06, bd); }
  // The facade: curtain wall down to the street, mullions and a band of lit floors.
  const out = long ? (z < H / 2 ? [0, -1] : [0, 1]) : (x < W / 2 ? [-1, 0] : [1, 0]);
  const fx = out[0] < 0 ? x : out[0] > 0 ? x + bw : x, fz = out[1] < 0 ? z : out[1] > 0 ? z + bd : z;
  b.setColor(INK.glass);
  if (long) b.quad([x, 0, fz], [x + bw, 0, fz], [x + bw, STREET_Y, fz], [x, STREET_Y, fz], [x + bw / 2, -20, fz - out[1]]);
  else b.quad([fx, 0, z], [fx, 0, z + bd], [fx, STREET_Y, z + bd], [fx, STREET_Y, z], [fx - out[0], -20, z + bd / 2]);
  b.setColor(scale(INK.steel, 0.7));
  for (let y = -0.6; y > STREET_Y; y -= 3.4) {
    if (long) box3(b, x, y - 0.25, fz + (out[1] > 0 ? 0 : -0.2), bw, 0.25, 0.2);
    else box3(b, fx + (out[0] > 0 ? 0 : -0.2), y - 0.25, z, 0.2, 0.25, bd);
  }
  emissive(b, () => {
    for (let y = -4.4; y > STREET_Y + 4; y -= 3.4) {
      for (let s = 0.6; s < L - 1; s += 2.2) {
        if (((y * 7 + s * 13) | 0) % 5 > 1) continue;
        b.setColor(scale(INK.glow, 0.35));
        if (long) box3(b, x + s, y, fz + (out[1] > 0 ? 0.01 : -0.05), 1.6, 1.4, 0.04);
        else box3(b, fx + (out[0] > 0 ? 0.01 : -0.05), y, z + s, 0.04, 1.4, 1.6);
      }
    }
  });
}

function topsideWall(ctx, w) {
  if (w.block) blockwork(ctx, w);
  else { concreteWall(ctx.b, w); }
}

function topsideDecor(ctx) {
  const { b, glow, rnd, W, H } = ctx;
  for (const [x, z] of ctx.workLights) {
    b.setColor(0x2c2f36);
    for (const a of [0, 2.1, 4.2]) b.prismY(0, 1.8, x + Math.cos(a) * 0.25, z + Math.sin(a) * 0.25, 0.03, 0.03, 4);
    b.prismY(1.8, 2.6, x, z, 0.04, 0.04, 4);
    b.setColor(INK.hazardY);
    box3(b, x - 0.3, 2.5, z - 0.12, 0.6, 0.36, 0.24);
    emissive(b, () => { b.setColor([1, 0.92, 0.7]); box3(b, x - 0.25, 2.55, z + 0.12, 0.5, 0.26, 0.03); });
  }
  // The city: streets far below with traffic streaks, and the tops of lesser towers.
  b.setColor([0.08, 0.07, 0.1]);
  box3(b, -90, STREET_Y - 0.5, -90, W + 180, 0.5, H + 180);
  emissive(b, () => {
    for (let k = -4; k < 6; k++) {
      const zs = H / 2 + k * 15, xs = W / 2 + k * 17;
      b.setColor(rnd() < 0.5 ? [0.9, 0.6, 0.3] : [0.5, 0.12, 0.1]);
      box3(b, -90, STREET_Y, zs, W + 180, 0.02, 0.3);
      b.setColor([0.95, 0.85, 0.6]);
      box3(b, xs, STREET_Y, -90, 0.3, 0.02, H + 180);
    }
  });
  const towers = [];
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2, r = 46 + rnd() * 48;
    const cx = W / 2 + Math.cos(a) * r * 1.2, cz = H / 2 + Math.sin(a) * r;
    if (cx > -14 && cx < W + 14 && cz > -14 && cz < H + 14) continue;
    const tw = 9 + rnd() * 9, td = 8 + rnd() * 8, top = -8 - rnd() * 26;
    towers.push([cx - tw / 2, cz - td / 2, tw, td, top]);
  }
  for (const [tx, tz, tw, td, top] of towers) {
    b.setColor(scale([0.32, 0.3, 0.36], 0.7 + rnd() * 0.5));
    box3(b, tx, STREET_Y, tz, tw, top - STREET_Y, td);
    b.setColor(scale(INK.concrete, 0.55));
    box3(b, tx + 1, top, tz + 1, tw * 0.35, 1.2, td * 0.3);
    emissive(b, () => {
      b.setColor(scale(INK.glow, 0.32 + rnd() * 0.2));
      for (let y = top - 2; y > top - 22 && y > STREET_Y + 2; y -= 2.6) {
        if (rnd() < 0.4) box3(b, tx + 0.6, y, tz + td + 0.01, tw - 1.2, 0.5, 0.04);
      }
      b.setColor([1, 0.2, 0.15]);
      box3(b, tx + tw / 2, top + 1.2, tz + td / 2, 0.25, 0.25, 0.25);
    });
  }
  skyRing(ctx, { low: [0.14, 0.06, 0.08], mid: [0.5, 0.2, 0.16], warm: [1.15, 0.58, 0.2], high: [0.12, 0.06, 0.2], warmDir: [-1, -0.25], y0: STREET_Y, y1: 4, y2: 60 });
  // A tower crane standing off the north-east corner, its jib swung away over the street.
  const cx = W + 7, cz = -7, mastTop = 15;
  b.setColor(INK.crane);
  for (const [ox, oz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) b.prismY(STREET_Y, mastTop, cx + ox, cz + oz, 0.1, 0.1, 4);
  for (let y = -2; y < mastTop; y += 1.6) { box3(b, cx - 0.7, y, cz - 0.75, 1.4, 0.08, 0.08); box3(b, cx - 0.75, y, cz - 0.7, 0.08, 0.08, 1.4); }
  box3(b, cx - 26, mastTop, cz - 0.5, 34, 0.7, 1.0);
  b.setColor(scale(INK.crane, 0.8));
  for (let x = cx - 25; x < cx + 8; x += 1.4) box3(b, x, mastTop + 0.05, cz - 0.55, 0.08, 0.6, 1.1);
  b.setColor(0x3a3f47);
  box3(b, cx + 4, mastTop - 1.2, cz - 1.2, 3.6, 1.6, 2.4);
  box3(b, cx - 1.2, mastTop - 1.6, cz + 0.8, 1.4, 1.4, 1.2);
  b.setColor(0x20242a);
  box3(b, cx - 18, 2, cz - 0.04, 0.08, mastTop - 2, 0.08);
  b.setColor(hexRGB(CONTAINER_COLORS[1]));
  box3(b, cx - 19.5, 1.0, cz - 1, 3, 1.0, 2);
  emissive(b, () => { b.setColor([1, 0.2, 0.15]); box3(b, cx - 26, mastTop + 0.75, cz - 0.15, 0.3, 0.3, 0.3); box3(b, cx - 0.15, mastTop + 2.4, cz - 0.15, 0.3, 0.3, 0.3); });
  b.setColor(INK.crane);
  b.prismY(mastTop, mastTop + 2.4, cx, cz, 0.5, 0.1, 4, Math.PI / 4);
}

// ---- Sunken --------------------------------------------------------------------------------------------

function sunkenLights(ctx) {
  const { map, lamps, glow } = ctx;
  const fire = [1.0, 0.56, 0.2];
  // Braziers stand in the water at the corners of every causeway, where nobody can walk into them,
  // and on the shrine's lowest step.
  ctx.braziers = [];
  const statues = map.walls.filter(w => w.ruin === 'statue');
  for (const q of map.walls) {
    if (q.kind !== 'water') continue;
    for (const [cx, cz, ix, iz] of [[q.x, q.z, 1, 1], [q.x + q.w, q.z, -1, 1], [q.x, q.z + q.d, 1, -1], [q.x + q.w, q.z + q.d, -1, -1]]) {
      if (statues.some(s => Math.hypot(s.x + s.w / 2 - cx, s.z + s.d / 2 - cz) < 3.4)) ctx.braziers.push([cx + ix * 0.35, cz + iz * 0.35, WATER_Y + 0.1]);
    }
  }
  for (const w of map.walls) if (w.landmark) ctx.braziers.push([w.x + 0.2, w.z + w.d - 0.2, 0.55], [w.x + w.w - 0.2, w.z + 0.2, 0.55]);
  for (const [x, z] of ctx.braziers) {
    lamps.push({ x, z, r: 5, col: [0.42, 0.24, 0.08] });
    glow.halo(x, z, 2.8, scale(fire, 0.12));
  }
}

function sunkenPaint(ctx) {
  const { b, map, rnd, W, H } = ctx;
  const blocked = (x, z, pad = 0.25) => map.walls.some(w => w.kind !== 'border' && x > w.x - pad && x < w.x + w.w + pad && z > w.z - pad && z < w.z + w.d + pad);
  // Leaf litter: little flat flakes in three greens, a few fallen blooms.
  for (let i = 0; i < 420; i++) {
    const x = rnd() * W, z = rnd() * H;
    if (blocked(x, z, 0.05)) continue;
    const k = rnd();
    b.setColor(k < 0.08 ? INK.bloom : k < 0.45 ? INK.leaf : k < 0.75 ? INK.leafD : scale(INK.dirt, 1.25));
    const a = rnd() * 6.28, r = 0.12 + rnd() * 0.12, y = 0.05;
    b.tri([x + Math.cos(a) * r, y, z + Math.sin(a) * r], [x + Math.cos(a + 2.4) * r * 0.6, y, z + Math.sin(a + 2.4) * r * 0.6], [x + Math.cos(a - 2.4) * r * 0.6, y, z + Math.sin(a - 2.4) * r * 0.6]);
  }
  // Roots snaking out from every fig trunk.
  b.setColor(INK.bark);
  for (const w of map.walls) {
    if (!w.tree) continue;
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
    for (let k = 0; k < 6; k++) {
      let a = k * 1.047 + rnd() * 0.5, x = cx + Math.cos(a) * w.w * 0.5, z = cz + Math.sin(a) * w.d * 0.5;
      for (let s = 0; s < 5; s++) {
        const nx = x + Math.cos(a) * 0.5, nz = z + Math.sin(a) * 0.5;
        if (blocked(nx, nz, 0) && s > 0) break;
        b.quad([x, 0.06, z], [nx, 0.06, nz], [nx + Math.sin(a) * 0.08, 0.06, nz - Math.cos(a) * 0.08], [x + Math.sin(a) * 0.14, 0.06, z - Math.cos(a) * 0.14]);
        x = nx; z = nz; a += (rnd() - 0.5) * 0.8;
      }
    }
  }
  // Lily pads on the moat.
  for (const w of map.walls) {
    if (w.kind !== 'water') continue;
    const n = Math.round(w.w * w.d / 6);
    for (let i = 0; i < n; i++) {
      const x = w.x + 0.5 + rnd() * (w.w - 1), z = w.z + 0.5 + rnd() * (w.d - 1);
      b.setColor(scale(INK.leaf, 0.7 + rnd() * 0.3));
      b.prismY(WATER_Y + 0.02, WATER_Y + 0.04, x, z, 0.3 + rnd() * 0.25, 0.3, 7, rnd() * 3);
      if (rnd() < 0.2) { b.setColor(INK.bloom); b.prismY(WATER_Y + 0.04, WATER_Y + 0.14, x, z, 0.1, 0.04, 5); }
    }
  }
}

// Mossy stone embankment round the moat: the stone face, coping blocks, ferns at the edge.
function sunkenBank(ctx, w) {
  const { b, rnd } = ctx;
  const lip = (x0, z0, x1, z1) => {
    b.setColor(scale(INK.rockD, 0.75));
    const ox = x0 === x1 ? (x0 === w.x ? -1 : 1) : 0;
    const oz = z0 === z1 ? (z0 === w.z ? -1 : 1) : 0;
    b.quad([x0, 0.02, z0], [x1, 0.02, z1], [x1, WATER_Y - 0.6, z1], [x0, WATER_Y - 0.6, z0], [(x0 + x1) / 2 + ox, -0.3, (z0 + z1) / 2 + oz]);
    const t = 0.36;
    const cx = x0 === x1 ? (x0 === w.x ? x0 - t : x0) : Math.min(x0, x1);
    const cz = z0 === z1 ? (z0 === w.z ? z0 - t : z0) : Math.min(z0, z1);
    const lw = x0 === x1 ? t : Math.abs(x1 - x0), ld = z0 === z1 ? t : Math.abs(z1 - z0);
    const L = Math.max(lw, ld), n = Math.max(1, Math.round(L / 0.8));
    for (let i = 0; i < n; i++) {
      const s = (i / n) * L, e = ((i + 1) / n) * L, k = 0.85 + rnd() * 0.25;
      const top = 0.1 + rnd() * 0.08;
      b.setColor(scale(rnd() < 0.3 ? INK.moss : INK.rock, k));
      if (lw > ld) box3(b, cx + s, 0.0, cz, e - s - 0.04, top, t);
      else box3(b, cx, 0.0, cz + s, t, top, e - s - 0.04);
    }
  };
  lip(w.x, w.z, w.x + w.w, w.z);
  lip(w.x + w.w, w.z, w.x + w.w, w.z + w.d);
  lip(w.x + w.w, w.z + w.d, w.x, w.z + w.d);
  lip(w.x, w.z + w.d, w.x, w.z);
}

// Stone courses with moss on top and vines down the camera-facing side; the top is broken, never above w.h.
function ruinWall(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: rw, d: rd, h } = w;
  const long = rw >= rd, L = long ? rw : rd;
  const n = Math.max(1, Math.round(L / 1.1));
  for (let i = 0; i < n; i++) {
    const s = (i / n) * L, e = ((i + 1) / n) * L;
    const top = h * (0.72 + rnd() * 0.28);
    const courses = Math.max(2, Math.round(top / 0.7));
    for (let c = 0; c < courses; c++) {
      const y0 = (c / courses) * top, y1 = ((c + 1) / courses) * top;
      b.setColor(scale(c % 2 ? INK.rock : INK.rockD, 0.92 + rnd() * 0.16));
      const off = (c % 2) * 0.03;
      if (long) box3(b, x + s + 0.02, y0, z + off, e - s - 0.04, y1 - y0 - 0.03, rd - off * 2);
      else box3(b, x + off, y0, z + s + 0.02, rw - off * 2, y1 - y0 - 0.03, e - s - 0.04);
    }
    if (rnd() < 0.5) {
      b.setColor(scale(INK.moss, 0.9 + rnd() * 0.2));
      const m = 0.3 + rnd() * 0.4;
      if (long) box3(b, x + s + (e - s) * rnd() * (1 - m), top - 0.03, z + 0.06, (e - s) * m, 0.08, rd - 0.12);
      else box3(b, x + 0.06, top - 0.03, z + s + (e - s) * rnd() * (1 - m), rw - 0.12, 0.08, (e - s) * m);
    }
    if (rnd() < 0.55) {
      b.setColor(INK.vine);
      const vx = long ? x + s + (e - s) * rnd() : x + rw, vz = long ? z + rd : z + s + (e - s) * rnd();
      box3(b, vx - 0.06, top * (0.2 + rnd() * 0.3), vz - 0.01, 0.12, top * 0.6, 0.04);
    }
  }
}

function ruinPillar(ctx, w) {
  const { b } = ctx;
  const { x, z, w: pw, d: pd, h } = w;
  const cx = x + pw / 2, cz = z + pd / 2, r = Math.min(pw, pd) / 2;
  b.setColor(INK.rockD);
  box3(b, x, 0, z, pw, 0.35, pd);
  if (w.ruin === 'statue') {
    // A squat guardian on a plinth: body, head and the stubs of folded arms.
    b.setColor(INK.rock);
    box3(b, x + 0.05, 0.35, z + 0.05, pw - 0.1, 0.9, pd - 0.1);
    b.setColor(INK.rockL);
    box3(b, x + 0.12, 1.25, z + 0.12, pw - 0.24, 0.9, pd - 0.24, 0.06);
    box3(b, x + 0.02, 1.55, z + 0.25, pw - 0.04, 0.24, pd - 0.5);
    b.setColor(INK.rock);
    box3(b, x + 0.16, 2.15, z + 0.16, pw - 0.32, 0.6, pd - 0.32, 0.05);
    b.setColor(INK.moss);
    box3(b, x + 0.2, h - 0.08, z + 0.2, pw - 0.4, 0.1, pd - 0.4);
    emissive(b, () => { b.setColor([0.4, 1.0, 0.7]); box3(b, x + pw / 2 - 0.2, 2.4, z + pd - 0.17, 0.12, 0.08, 0.03); box3(b, x + pw / 2 + 0.08, 2.4, z + pd - 0.17, 0.12, 0.08, 0.03); });
    return;
  }
  b.setColor(INK.rock);
  b.prismY(0.35, h - 0.45, cx, cz, r * 0.82, r * 0.74, 8, Math.PI / 8);
  b.setColor(INK.rockD);
  for (let y = 0.9; y < h - 0.6; y += 0.7) b.prismY(y, y + 0.05, cx, cz, r * 0.84, r * 0.84, 8, Math.PI / 8);
  b.setColor(INK.rockL);
  box3(b, x, h - 0.45, z, pw, 0.35, pd);
  b.setColor(INK.moss);
  box3(b, x + 0.06, h - 0.1, z + 0.06, pw - 0.12, 0.1, pd - 0.12);
}

// Strangler fig: buttress roots and a fat trunk inside the footprint, a modest canopy on top.
function figTree(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: tw, d: td, h } = w;
  const cx = x + tw / 2, cz = z + td / 2, r = Math.min(tw, td) / 2;
  b.setColor(INK.bark);
  for (let k = 0; k < 5; k++) {
    const a = k * 1.2566 + rnd() * 0.4;
    const ex = cx + Math.cos(a) * r * 0.92, ez = cz + Math.sin(a) * r * 0.92;
    b.loft([
      [[cx - 0.12, 0, cz - 0.12], [ex, 0, ez], [cx + 0.12, 0, cz + 0.12]],
      [[cx - 0.1, h * 0.45, cz - 0.1], [cx + Math.cos(a) * 0.3, h * 0.45, cz + Math.sin(a) * 0.3], [cx + 0.1, h * 0.45, cz + 0.1]],
    ]);
  }
  b.setColor(scale(INK.bark, 1.12));
  b.prismY(0, h, cx, cz, r * 0.55, r * 0.38, 7, rnd());
  b.setColor(INK.vine);
  b.prismY(0.4, h * 0.9, cx + r * 0.3, cz + r * 0.3, 0.07, 0.05, 4);
  // Canopy: two stacked faceted clumps, kept close over the trunk so it never hides a player for long.
  const cr = r * 1.4;
  b.setColor(INK.leafD);
  b.prismY(h - 0.5, h + 0.25, cx, cz, cr * 0.6, cr, 7, rnd());
  b.setColor(INK.leaf);
  b.prismY(h + 0.25, h + 0.85, cx, cz, cr, cr * 0.45, 7, rnd());
  b.setColor(scale(INK.leaf, 1.2));
  b.prismY(h + 0.85, h + 1.05, cx, cz, cr * 0.45, cr * 0.1, 7, rnd());
}

function sunkenRock(ctx, w) {
  if (w.tree) return figTree(ctx, w);
  if (w.ruin === true) return ruinWall(ctx, w);
  if (w.ruin) return ruinPillar(ctx, w);
  rockWall(ctx, w);
}

// Fallen carved blocks, or the toppled head of an idol.
function fallenStone(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: sw, d: sd, h } = w;
  if (w.idol) {
    b.setColor(INK.rockL);
    box3(b, x + 0.1, 0, z + 0.05, sw - 0.2, h - 0.1, sd - 0.1, 0.12);
    b.setColor(INK.rockD);
    box3(b, x + sw * 0.25, h * 0.45, z + sd - 0.07, sw * 0.18, h * 0.18, 0.04);
    box3(b, x + sw * 0.57, h * 0.45, z + sd - 0.07, sw * 0.18, h * 0.18, 0.04);
    box3(b, x + sw * 0.35, h * 0.12, z + sd - 0.07, sw * 0.3, h * 0.12, 0.04);
    b.setColor(INK.moss);
    box3(b, x + 0.2, h - 0.12, z + 0.15, sw - 0.6, 0.1, sd - 0.3);
    return;
  }
  const long = sw >= sd, L = long ? sw : sd;
  const n = Math.max(1, Math.round(L / 1.2));
  for (let i = 0; i < n; i++) {
    const s = (i / n) * L, e = ((i + 1) / n) * L, top = h * (0.7 + rnd() * 0.3);
    b.setColor(scale(INK.rockL, 0.85 + rnd() * 0.2));
    if (long) box3(b, x + s + 0.04, 0, z + 0.03, e - s - 0.08, top, sd - 0.06, 0.06);
    else box3(b, x + 0.03, 0, z + s + 0.04, sw - 0.06, top, e - s - 0.08, 0.06);
    b.setColor(INK.moss);
    if (long) box3(b, x + s + 0.1, top - 0.02, z + 0.1, (e - s) * 0.6, 0.06, sd - 0.2);
    else box3(b, x + 0.1, top - 0.02, z + s + 0.1, sw - 0.2, 0.06, (e - s) * 0.6);
  }
}

// The shrine: a stepped base and a small temple on top, its doorway lit from inside.
function shrine(ctx, w) {
  const { b, glow } = ctx;
  const { x, z, w: sw, d: sd, h } = w;
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const inset = i * 0.35, y0 = i * 0.55;
    b.setColor(scale(i % 2 ? INK.rockD : INK.rock, 1.0));
    box3(b, x + inset, y0, z + inset, sw - inset * 2, 0.55, sd - inset * 2);
    b.setColor(INK.moss);
    box3(b, x + inset + 0.05, y0 + 0.53, z + inset + 0.05, sw - inset * 2 - 0.1, 0.05, 0.25);
  }
  const y0 = steps * 0.55, inset = steps * 0.35 + 0.1;
  b.setColor(INK.rockL);
  box3(b, x + inset, y0, z + inset, sw - inset * 2, h - y0, sd - inset * 2);
  b.setColor(INK.rockD);
  box3(b, x + inset - 0.15, h - 0.15, z + inset - 0.15, sw - inset * 2 + 0.3, 0.25, sd - inset * 2 + 0.3);
  b.setColor(INK.rock);
  b.prismY(h + 0.1, h + 1.1, x + sw / 2, z + sd / 2, Math.min(sw, sd) / 2 - inset, 0.2, 4, Math.PI / 4);
  b.setColor(0x1a1612);
  box3(b, x + sw / 2 - 0.4, y0, z + sd - inset - 0.02, 0.8, 1.2, 0.05);
  emissive(b, () => { b.setColor([1.0, 0.62, 0.26]); box3(b, x + sw / 2 - 0.25, y0 + 0.1, z + sd - inset, 0.5, 0.8, 0.03); });
  glow.streak(x + sw / 2, z + sd + 0.1, 1.2, 2.4, [0.2, 0.11, 0.04], 0.07);
  b.setColor(INK.vine);
  box3(b, x + inset + 0.3, y0, z + sd - inset - 0.01, 0.12, h - y0 - 0.3, 0.04);
  box3(b, x + sw - inset - 0.6, y0 + 0.3, z + sd - inset - 0.01, 0.12, h - y0 - 0.6, 0.04);
}

function sunkenWall(ctx, w) { ruinWall(ctx, { ...w }); }

// The jungle closes in at the edge of the map: broken rock and thick growth, never tidy.
function jungleEdge(ctx, w) {
  const { b, rnd } = ctx;
  ridge(ctx, w);
  const long = w.w > w.d, L = long ? w.w : w.d;
  for (let s = 0.5; s < L; s += 1.6 + rnd() * 1.2) {
    const cx = long ? w.x + s : w.x + w.w / 2, cz = long ? w.z + w.d / 2 : w.z + s, r = 0.9 + rnd() * 0.8;
    b.setColor(rnd() < 0.5 ? INK.leaf : INK.leafD);
    b.prismY(w.h * 0.6, w.h + 0.6 + rnd() * 0.8, cx, cz, r, r * 0.3, 6, rnd() * 3);
  }
}

function jungleTree(b, x, z, hgt, cr, rnd) {
  b.setColor(INK.bark);
  b.prismY(0, hgt, x, z, 0.5, 0.3, 6, rnd());
  b.setColor(INK.leafD);
  b.prismY(hgt - 1.2, hgt + 0.6, x, z, cr * 0.5, cr, 7, rnd() * 3);
  b.setColor(INK.leaf);
  b.prismY(hgt + 0.6, hgt + 1.8, x, z, cr, cr * 0.35, 7, rnd() * 3);
}

function sunkenDecor(ctx) {
  const { b, glow, rnd, W, H } = ctx;
  for (const [x, z, y] of ctx.braziers) {
    b.setColor(INK.rockD);
    b.prismY(y, 0.8, x, z, 0.22, 0.16, 6);
    b.setColor(0x2a2622);
    b.prismY(0.8, 1.05, x, z, 0.18, 0.34, 6);
    emissive(b, () => { b.setColor([1.0, 0.6, 0.22]); b.prismY(1.05, 1.35, x, z, 0.26, 0.05, 5); });
  }
  // A great stepped pyramid swallowed by the forest north of the map, and canopy all round.
  const px = W / 2 - 11, pz = -30;
  for (let i = 0; i < 6; i++) {
    const k = i * 1.6;
    b.setColor(scale(i % 2 ? INK.rockD : INK.rock, 0.8));
    box3(b, px + k, i * 1.8, pz + k, 22 - k * 2, 1.8, 18 - k * 2);
    b.setColor(scale(INK.moss, 0.85));
    box3(b, px + k + 0.2, i * 1.8 + 1.75, pz + k + 0.2, 22 - k * 2 - 0.4, 0.1, 1.2);
  }
  b.setColor(scale(INK.rock, 0.85));
  box3(b, px + 8.5, 10.8, pz + 7.5, 5, 3, 3);
  b.setColor(scale(INK.rock, 0.7));
  box3(b, px + 9.6, 0, pz + 16.9, 2.8, 10.8, 1.2);
  for (let i = 0; i < 64; i++) {
    const side = i % 4, t = rnd();
    let x, z;
    if (side === 0) { x = -26 + t * (W + 52); z = -6 - rnd() * 18; if (x > px - 2 && x < px + 24 && z < -10) continue; }
    else if (side === 1) { x = -26 + t * (W + 52); z = H + 5 + rnd() * 16; }
    else if (side === 2) { x = -5 - rnd() * 18; z = -8 + t * (H + 16); }
    else { x = W + 5 + rnd() * 18; z = -8 + t * (H + 16); }
    jungleTree(b, x, z, 4 + rnd() * 5, 2.2 + rnd() * 2, rnd);
  }
  skyRing(ctx, { low: [0.1, 0.14, 0.12], mid: [0.2, 0.26, 0.23], warm: [0.3, 0.34, 0.28], high: [0.07, 0.1, 0.1], warmDir: [-0.3, -1], y0: -4, y1: 10, y2: 50 });
  // Mist pools in the low ground beside the moat, as soft additive glow.
  for (const w of ctx.map.walls) if (w.kind === 'water') glow.halo(w.x + w.w / 2, w.z + w.d / 2, Math.max(w.w, w.d) * 0.55, [0.035, 0.05, 0.045], WATER_Y + 0.05, 12);
}

// ---- Harvest -------------------------------------------------------------------------------------------

// Field plots: a coarse patchwork of stubble, ploughed earth and pasture, the same wherever it is asked.
function harvestPlot(x, z) {
  const px = Math.floor((x + 3) / 13), pz = Math.floor((z + 2) / 9.5);
  let h = (px * 73856093) ^ (pz * 19349663);
  h = ((h >>> 0) % 1000) / 1000;
  return h < 0.46 ? 0 : h < 0.72 ? 1 : 2;      // 0 stubble, 1 ploughed, 2 pasture.
}

function harvestNearYard(map) {
  const yards = map.walls.filter(w => w.kind === 'building' || w.plank || w.stone || w.tractor);
  const rooms = map.rooms || [];
  return (x, z) => {
    for (const r of rooms) if (x > r.x - 0.4 && x < r.x + r.w + 0.4 && z > r.z - 0.4 && z < r.z + r.d + 0.4) return 2;
    for (const w of yards) {
      const dx = Math.max(w.x - x, 0, x - w.x - w.w), dz = Math.max(w.z - z, 0, z - w.z - w.d);
      if (dx * dx + dz * dz < 6.5) return 1;
    }
    return 0;
  };
}

function harvestGround(ctx) {
  const { map, noise, rnd, W, H } = ctx;
  const inMap = (x, z) => x > 0 && x < W && z > 0 && z < H;
  const laneDist = z => { let d = 99; for (const l of map.lanes) d = Math.min(d, Math.abs(z - l.z)); return d; };
  const yard = harvestNearYard(map);
  return p => {
    const [x, , z] = p;
    const off = inMap(x, z) ? 1 : 0.8;
    const n = noise(x * 0.7, z * 0.7) * 0.16 + (rnd() - 0.5) * 0.05;
    if (off === 1) {
      const y = yard(x, z);
      if (y) return scale(y === 2 ? INK.earthD : INK.dirt, 0.92 + n);
      const wig = (noise(x * 0.08, z * 0.08) - 0.5) * 2.4;
      if (laneDist(z + wig) < 1.5) return scale(INK.asphalt, 0.9 + n);
    }
    const t = harvestPlot(x, z);
    if (t === 1) return scale(Math.sin(z * 3.4) > 0 ? INK.earth : INK.earthD, (0.92 + n) * off);
    if (t === 2) return scale(noise(x * 0.3 + 5, z * 0.3) > 0.55 ? INK.grassD : INK.grass, (0.92 + n) * off);
    return scale(noise(x * 0.25 + 2, z * 0.25) > 0.62 ? INK.wheatD : INK.wheat, (0.9 + n) * off);
  };
}

function harvestPaint(ctx) {
  const { b, map, rnd, W, H } = ctx;
  const blocked = (x, z, p = 0.25) => map.walls.some(w => w.kind !== 'border' && x > w.x - p && x < w.x + w.w + p && z > w.z - p && z < w.z + w.d + p);
  const yard = harvestNearYard(map);
  // Floors of the roofless interiors: boards in barns and sheds, flagstones in the ruins.
  for (const r of map.rooms || []) {
    if (r.floor === 'boards') {
      for (let z = r.z + 0.3, i = 0; z < r.z + r.d - 0.3; z += 0.42, i++) {
        b.setColor(scale(i % 2 ? INK.timber : INK.timberD, 0.85 + rnd() * 0.15));
        b.groundRect(r.x + 0.3, z, r.w - 0.6, 0.36, 0.05);
      }
    } else {
      for (let z = r.z + 0.3; z < r.z + r.d - 0.6; z += 0.95) {
        for (let x = r.x + 0.3 + (Math.floor(z) % 2) * 0.45; x < r.x + r.w - 0.8; x += 0.95) {
          if (rnd() < 0.12) continue;
          b.setColor(scale(rnd() < 0.5 ? INK.stone : INK.stoneD, 0.78 + rnd() * 0.18));
          b.groundRect(x, z, 0.86, 0.86, 0.05);
        }
      }
    }
  }
  // Wheel ruts down every track, wandering a little, broken by whatever stands on them.
  for (const lane of map.lanes) {
    let zc = lane.z - 0.8;
    for (let x = -12; x < W + 12; x += 0.9) {
      zc += (rnd() - 0.5) * 0.22;
      zc += (lane.z - 0.8 - zc) * 0.05;
      if (blocked(x, zc) || blocked(x, zc + 1.6)) continue;
      b.setColor(scale(INK.earthD, 0.82 + rnd() * 0.1));
      b.groundRect(x, zc - 0.14, 0.9, 0.28, 0.04);
      b.groundRect(x, zc + 1.46, 0.9, 0.28, 0.04);
    }
  }
  // Furrows across the ploughed plots, and stubble tufts and straw over the cut fields.
  b.setColor(scale(INK.earthD, 0.78));
  for (let z = 0.6; z < H; z += 0.85) {
    let start = null;
    for (let x = 0; x <= W; x += 1.5) {
      const on = x < W && harvestPlot(x + 0.75, z) === 1 && !yard(x + 0.75, z) && !blocked(x + 0.75, z, 0.1);
      if (on && start === null) start = x;
      if (!on && start !== null) { b.groundRect(start, z, x - start, 0.2, 0.035); start = null; }
    }
  }
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, z = rnd() * H;
    if (harvestPlot(x, z) !== 0 || yard(x, z) || blocked(x, z)) continue;
    b.setColor(scale(rnd() < 0.5 ? INK.wheat : INK.hay, 0.95 + rnd() * 0.2));
    b.prismY(0, 0.16 + rnd() * 0.12, x, z, 0.12, 0.03, 3, rnd() * 3);
  }
  // Loose straw around the bales and stacks.
  for (const w of map.walls) {
    if (!w.bale && !w.hay) continue;
    for (let k = 0; k < 7; k++) {
      const a = rnd() * 6.28, r = Math.max(w.w, w.d) * 0.55 + rnd() * 0.9;
      const x = w.x + w.w / 2 + Math.cos(a) * r, z = w.z + w.d / 2 + Math.sin(a) * r;
      if (blocked(x, z, 0.05)) continue;
      b.setColor(scale(INK.hay, 0.8 + rnd() * 0.25));
      b.groundRect(x, z, 0.5 + rnd() * 0.5, 0.06, 0.06);
    }
  }
}

// Clipped hedge: a dark core and leafy lumps along it, never taller than the wall it stands for.
function hedgeWall(ctx, w) {
  const { b, rnd } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  b.setColor(INK.hedgeD);
  box3(b, w.x + 0.06, 0, w.z + 0.06, w.w - 0.12, w.h * 0.8, w.d - 0.12);
  const n = Math.max(1, Math.round(L / (w.kind === 'border' ? 2.6 : 1.3)));
  for (let i = 0; i < n; i++) {
    const s = (i / n) * L - 0.08, e = ((i + 1) / n) * L + 0.08, top = w.h * (0.84 + rnd() * 0.16);
    const lo = w.h * (0.25 + rnd() * 0.2);
    b.setColor(scale(rnd() < 0.55 ? INK.hedge : INK.hedgeL, 0.88 + rnd() * 0.2));
    const s0 = Math.max(0, s), e0 = Math.min(L, e), inset = -0.06 + rnd() * 0.1;
    if (long) box3(b, w.x + s0, lo, w.z + inset, e0 - s0, top - lo, T - inset * 2);
    else box3(b, w.x + inset, lo, w.z + s0, T - inset * 2, top - lo, e0 - s0);
  }
}

// Barn and shed boards: oxblood planks with battens both sides, a timber cap and corner posts.
function plankWall(ctx, w) {
  const { b, rnd } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d;
  b.setColor(INK.plank);
  box3(b, w.x, 0, w.z, w.w, w.h - 0.2, w.d);
  b.setColor(INK.plankD);
  for (let s = 0.3; s < L - 0.1; s += 0.55) {
    const k = 0.9 + rnd() * 0.2;
    b.setColor(scale(INK.plankD, k));
    if (long) { box3(b, w.x + s, 0.1, w.z - 0.05, 0.1, w.h - 0.35, 0.05); box3(b, w.x + s, 0.1, w.z + w.d, 0.1, w.h - 0.35, 0.05); }
    else { box3(b, w.x - 0.05, 0.1, w.z + s, 0.05, w.h - 0.35, 0.1); box3(b, w.x + w.w, 0.1, w.z + s, 0.05, w.h - 0.35, 0.1); }
  }
  b.setColor(INK.timber);
  box3(b, w.x - 0.06, w.h - 0.24, w.z - 0.06, w.w + 0.12, 0.24, w.d + 0.12);
  b.setColor(INK.timberD);
  const post = 0.32;
  if (long) { box3(b, w.x - 0.04, 0, w.z - 0.04, post, w.h, w.d + 0.08); box3(b, w.x + w.w - post + 0.04, 0, w.z - 0.04, post, w.h, w.d + 0.08); }
  else { box3(b, w.x - 0.04, 0, w.z - 0.04, w.w + 0.08, w.h, post); box3(b, w.x - 0.04, 0, w.z + w.d - post + 0.04, w.w + 0.08, w.h, post); }
  b.setColor(INK.white);
  if (long) box3(b, w.x, 0, w.z - 0.02, w.w, 0.35, w.d + 0.04);
  else box3(b, w.x - 0.02, 0, w.z, w.w + 0.04, 0.35, w.d);
}

// Ruined fieldstone: blocks in two tones with a broken top, full height only at the ends.
function stoneRuin(ctx, w) {
  const { b, rnd } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  const n = Math.max(1, Math.round(L / 0.85));
  for (let i = 0; i < n; i++) {
    const s = (i / n) * L, e = ((i + 1) / n) * L;
    const top = i === 0 || i === n - 1 ? w.h : w.h * (0.62 + rnd() * 0.38);
    b.setColor(scale(rnd() < 0.5 ? INK.stone : INK.stoneD, 0.88 + rnd() * 0.16));
    if (long) box3(b, w.x + s, 0, w.z, e - s, top, T);
    else box3(b, w.x, 0, w.z + s, T, top, e - s);
    b.setColor(scale(INK.stone, 1.12));
    if (long) box3(b, w.x + s + 0.05, top - 0.02, w.z - 0.04, e - s - 0.1, 0.12, T + 0.08);
    else box3(b, w.x - 0.04, top - 0.02, w.z + s + 0.05, T + 0.08, 0.12, e - s - 0.1);
  }
  b.setColor(INK.hedge);
  const iv = Math.floor(rnd() * n);
  if (long) box3(b, w.x + (iv / n) * L, 0, w.z + T, 0.6, w.h * 0.55, 0.06);
  else box3(b, w.x + T, 0, w.z + (iv / n) * L, 0.06, w.h * 0.55, 0.6);
}

function harvestWall(ctx, w) {
  if (w.hedge) hedgeWall(ctx, w);
  else if (w.plank) plankWall(ctx, w);
  else stoneRuin(ctx, w);
}

// Dry-stone dyke: rounded field stones with a row of upright copes.
function dyke(ctx, w) {
  const { b, rnd } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  const n = Math.max(1, Math.round(L / 0.75));
  for (let i = 0; i < n; i++) {
    const s = (i / n) * L, e = ((i + 1) / n) * L, top = w.h * (0.78 + rnd() * 0.12);
    b.setColor(scale(rnd() < 0.5 ? INK.stone : INK.stoneD, 0.85 + rnd() * 0.2));
    if (long) box3(b, w.x + s, 0, w.z, e - s, top, T);
    else box3(b, w.x, 0, w.z + s, T, top, e - s);
    if (i % 2) continue;
    b.setColor(scale(INK.stoneD, 0.95 + rnd() * 0.2));
    if (long) box3(b, w.x + s + 0.06, top, w.z + T * 0.3, 0.14, w.h - top, T * 0.4);
    else box3(b, w.x + T * 0.3, top, w.z + s + 0.06, T * 0.4, w.h - top, 0.14);
  }
}

// A trained vine row: posts, foliage along the wire, dark grapes on the sunny side.
function vineRow(ctx, w) {
  const { b, rnd } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  b.setColor(INK.timberD);
  for (let s = 0.1; s <= L - 0.1; s += Math.max(1.5, (L - 0.2) / Math.round(L / 2))) {
    if (long) b.prismY(0, w.h + 0.12, w.x + s, w.z + T / 2, 0.07, 0.05, 4);
    else b.prismY(0, w.h + 0.12, w.x + T / 2, w.z + s, 0.07, 0.05, 4);
  }
  const n = Math.max(1, Math.round(L / 1.0));
  for (let i = 0; i < n; i++) {
    const s = (i / n) * L, e = ((i + 1) / n) * L, lo = 0.35 + rnd() * 0.15, top = w.h * (0.85 + rnd() * 0.15);
    b.setColor(scale(rnd() < 0.6 ? INK.vine : INK.vineD, 0.9 + rnd() * 0.2));
    if (long) box3(b, w.x + s, lo, w.z - 0.05, e - s, top - lo, T + 0.1);
    else box3(b, w.x - 0.05, lo, w.z + s, T + 0.1, top - lo, e - s);
    if (rnd() < 0.35) {
      b.setColor(INK.grape);
      if (long) box3(b, w.x + s + 0.2, lo - 0.05, w.z + T + 0.04, 0.16, 0.2, 0.1);
      else box3(b, w.x + T + 0.04, lo - 0.05, w.z + s + 0.2, 0.1, 0.2, 0.16);
    }
  }
}

function harvestBarrier(ctx, w) {
  const { b } = ctx;
  if (w.vine) return vineRow(ctx, w);
  if (w.stall) {
    // Workbench: thick top on four legs, a vice and a box of tools.
    b.setColor(INK.timber);
    box3(b, w.x, w.h - 0.12, w.z, w.w, 0.12, w.d);
    b.setColor(INK.timberD);
    for (const [lx, lz] of [[0.05, 0.05], [w.w - 0.17, 0.05], [0.05, w.d - 0.17], [w.w - 0.17, w.d - 0.17]]) box3(b, w.x + lx, 0, w.z + lz, 0.12, w.h - 0.12, 0.12);
    box3(b, w.x + 0.1, 0.2, w.z + 0.1, w.w - 0.2, 0.06, w.d - 0.2);
    b.setColor(INK.steel);
    box3(b, w.x + 0.25, w.h, w.z + 0.1, 0.24, 0.16, 0.22);
    b.setColor(INK.rust);
    box3(b, w.x + w.w - 0.9, w.h, w.z + 0.12, 0.6, 0.2, 0.32);
    return;
  }
  if (w.altar) {
    b.setColor(INK.stone);
    box3(b, w.x, 0, w.z, w.w, w.h - 0.12, w.d);
    b.setColor(scale(INK.stone, 1.15));
    box3(b, w.x - 0.08, w.h - 0.14, w.z - 0.08, w.w + 0.16, 0.14, w.d + 0.16);
    b.setColor(0x6a2a2a);
    box3(b, w.x + w.w * 0.3, w.h - 0.02, w.z - 0.09, w.w * 0.4, 0.04, w.d + 0.18);
    return;
  }
  dyke(ctx, w);
}

// Round bale lying on its side, wrapped with two twine bands.
function roundBale(ctx, w) {
  const { b, rnd } = ctx;
  if (w.well) {
    // Stone well head: low ring, dark water, posts and a winch.
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2, r = Math.min(w.w, w.d) / 2;
    b.setColor(INK.stone);
    b.prismY(0, w.h, cx, cz, r, r * 0.96, 10);
    b.setColor(0x1c2420);
    b.prismY(w.h, w.h + 0.01, cx, cz, r * 0.7, r * 0.7, 10);
    b.setColor(INK.timberD);
    box3(b, cx - r - 0.05, 0, cz - 0.08, 0.14, 2.1, 0.16);
    box3(b, cx + r - 0.09, 0, cz - 0.08, 0.14, 2.1, 0.16);
    b.setColor(INK.timber);
    b.prismX(cx - r, cx + r, 1.85, cz, 0.08, 0.08, 6);
    b.setColor(INK.slate);
    b.quad([cx - r - 0.2, 2.1, cz - 0.6], [cx + r + 0.2, 2.1, cz - 0.6], [cx + r + 0.2, 2.45, cz], [cx - r - 0.2, 2.45, cz]);
    b.quad([cx - r - 0.2, 2.45, cz], [cx + r + 0.2, 2.45, cz], [cx + r + 0.2, 2.1, cz + 0.6], [cx - r - 0.2, 2.1, cz + 0.6]);
    return;
  }
  const along = rnd() < 0.5, r = w.h / 2, cx = w.x + w.w / 2, cz = w.z + w.d / 2, half = Math.min(w.w, w.d) / 2 - 0.05;
  b.setColor(scale(INK.hay, 0.92 + rnd() * 0.12));
  if (along) b.prismX(cx - half, cx + half, r, cz, r, r, 10);
  else b.prismZ(cz - half, cz + half, cx, r, r, r, 10);
  b.setColor(INK.hayD);
  for (const k of [-0.45, 0.45]) {
    if (along) b.prismX(cx + k * half - 0.03, cx + k * half + 0.03, r, cz, r + 0.02, r + 0.02, 10);
    else b.prismZ(cz + k * half - 0.03, cz + k * half + 0.03, cx, r, r + 0.02, r + 0.02, 10);
  }
}

// Stacked square bales, in courses, brick-bonded so the stack reads as built.
function hayStack(ctx, w) {
  const { b, rnd } = ctx;
  const courses = Math.max(2, Math.round(w.h / 0.55)), ch = w.h / courses;
  const long = w.w >= w.d;
  for (let c = 0; c < courses; c++) {
    const along = (c % 2 === 0) === long, L = along ? w.w : w.d, T = along ? w.d : w.w;
    const n = Math.max(1, Math.round(L / 1.1));
    for (let i = 0; i < n; i++) {
      const s = (i / n) * L, e = ((i + 1) / n) * L;
      b.setColor(scale(rnd() < 0.5 ? INK.hay : INK.hayD, 0.9 + rnd() * 0.15));
      const y = c * ch, inset = c === courses - 1 ? 0.12 : 0.02;
      if (along) box3(b, w.x + s + 0.02, y, w.z + inset, e - s - 0.04, ch - 0.03, T - inset * 2);
      else box3(b, w.x + inset, y, w.z + s + 0.02, T - inset * 2, ch - 0.03, e - s - 0.04);
    }
  }
}

// Old tractor: bonnet forward along the long axis, an open cab under a flat roof, big rear wheels.
function tractor(ctx, w) {
  const { b } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  // Local frame: u along the length (bonnet at u=L), v across.
  const at = (u, v) => (long ? [w.x + u, w.z + v] : [w.x + v, w.z + u]);
  const box = (u, y, v, lu, ly, lv) => { const [x, z] = at(u, v); if (long) box3(b, x, y, z, lu, ly, lv); else box3(b, x, y, z, lv, ly, lu); };
  const wheel = (u, v, r, wid) => {
    const [x, z] = at(u, v);
    b.setColor(INK.tyre);
    if (long) b.prismZ(z - wid / 2, z + wid / 2, x, r, r, r, 10);
    else b.prismX(x - wid / 2, x + wid / 2, r, z, r, r, 10);
    b.setColor(INK.rust);
    if (long) b.prismZ(z - wid / 2 - 0.01, z + wid / 2 + 0.01, x, r, r * 0.45, r * 0.45, 8);
    else b.prismX(x - wid / 2 - 0.01, x + wid / 2 + 0.01, r, z, r * 0.45, r * 0.45, 8);
  };
  b.setColor(INK.tractor);
  box(L * 0.45, 0.55, T * 0.28, L * 0.52, 0.75, T * 0.44);        // Bonnet.
  box(0.2, 0.45, T * 0.18, L * 0.38, 0.5, T * 0.64);               // Seat deck.
  b.setColor(scale(INK.tractor, 0.75));
  box(L * 0.95, 0.4, T * 0.3, 0.12, 0.7, T * 0.4);                 // Grille.
  b.setColor(INK.steel);
  for (const v of [T * 0.2, T * 0.8]) box(L * 0.06, 0.95, v - 0.04, 0.08, w.h - 1.0, 0.08);   // Cab posts.
  for (const v of [T * 0.2, T * 0.8]) box(L * 0.4, 0.95, v - 0.04, 0.08, w.h - 1.0, 0.08);
  b.setColor(scale(INK.tractor, 0.85));
  box(0, w.h - 0.08, T * 0.14, L * 0.5, 0.08, T * 0.72);           // Roof.
  b.setColor(INK.tyre);
  box(L * 0.62, 1.3, T * 0.62, 0.08, 0.6, 0.08);                    // Exhaust.
  wheel(L * 0.22, T * 0.1, 0.72, 0.42); wheel(L * 0.22, T * 0.9, 0.72, 0.42);
  wheel(L * 0.82, T * 0.14, 0.42, 0.26); wheel(L * 0.82, T * 0.86, 0.42, 0.26);
}

// Farm trailer: flatbed on two axles with a load of bales.
function trailer(ctx, w) {
  const { b, rnd } = ctx;
  b.setColor(INK.rust);
  box3(b, w.x, 0.62, w.z, w.w, 0.18, w.d);
  b.setColor(INK.timber);
  box3(b, w.x + 0.05, 0.8, w.z + 0.05, w.w - 0.1, 0.06, w.d - 0.1);
  const long = w.w >= w.d;
  for (const k of [0.25, 0.75]) {
    b.setColor(INK.tyre);
    if (long) b.prismZ(w.z - 0.05, w.z + w.d + 0.05, w.x + w.w * k, 0.38, 0.38, 0.38, 8);
    else b.prismX(w.x - 0.05, w.x + w.w + 0.05, 0.38, w.z + w.d * k, 0.38, 0.38, 8);
  }
  const L = long ? w.w : w.d, n = Math.max(1, Math.round(L / 1.2));
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < n; i++) {
      const s = (i / n) * L, e = ((i + 1) / n) * L, y = 0.86 + c * 0.76;
      b.setColor(scale(rnd() < 0.5 ? INK.hay : INK.hayD, 0.9 + rnd() * 0.15));
      if (long) box3(b, w.x + s + 0.04, y, w.z + 0.1, e - s - 0.08, Math.min(0.72, w.h - y), w.d - 0.2);
      else box3(b, w.x + 0.1, y, w.z + s + 0.04, w.w - 0.2, Math.min(0.72, w.h - y), e - s - 0.08);
    }
  }
}

function harvestContainer(ctx, w) {
  if (w.tractor) tractor(ctx, w);
  else if (w.trailer) trailer(ctx, w);
  else hayStack(ctx, w);
}

// Whitewashed farmhouse: walls to the eaves, a slate roof ridged along the long side, a chimney, small windows.
function farmhouse(ctx, w) {
  const { b, rnd } = ctx;
  const eave = w.h * 0.66, long = w.w >= w.d;
  b.setColor(INK.white);
  box3(b, w.x, 0, w.z, w.w, eave, w.d);
  b.setColor(INK.stoneD);
  box3(b, w.x - 0.05, 0, w.z - 0.05, w.w + 0.1, 0.4, w.d + 0.1);
  const o = 0.25;
  b.setColor(INK.slate);
  if (long) {
    const zm = w.z + w.d / 2;
    b.quad([w.x - o, eave, w.z - o], [w.x + w.w + o, eave, w.z - o], [w.x + w.w + o, w.h, zm], [w.x - o, w.h, zm]);
    b.quad([w.x - o, w.h, zm], [w.x + w.w + o, w.h, zm], [w.x + w.w + o, eave, w.z + w.d + o], [w.x - o, eave, w.z + w.d + o]);
    b.setColor(INK.white);
    b.tri([w.x, eave, w.z], [w.x, eave, w.z + w.d], [w.x, w.h - 0.05, zm], [w.x - 1, eave, zm]);
    b.tri([w.x + w.w, eave, w.z], [w.x + w.w, eave, w.z + w.d], [w.x + w.w, w.h - 0.05, zm], [w.x + w.w + 1, eave, zm]);
  } else {
    const xm = w.x + w.w / 2;
    b.quad([w.x - o, eave, w.z + w.d + o], [w.x - o, eave, w.z - o], [xm, w.h, w.z - o], [xm, w.h, w.z + w.d + o]);
    b.quad([xm, w.h, w.z + w.d + o], [xm, w.h, w.z - o], [w.x + w.w + o, eave, w.z - o], [w.x + w.w + o, eave, w.z + w.d + o]);
    b.setColor(INK.white);
    b.tri([w.x, eave, w.z], [w.x + w.w, eave, w.z], [xm, w.h - 0.05, w.z], [xm, eave, w.z - 1]);
    b.tri([w.x, eave, w.z + w.d], [w.x + w.w, eave, w.z + w.d], [xm, w.h - 0.05, w.z + w.d], [xm, eave, w.z + w.d + 1]);
  }
  b.setColor(scale(INK.slate, 1.25));
  if (long) box3(b, w.x - o, w.h - 0.06, w.z + w.d / 2 - 0.1, w.w + o * 2, 0.12, 0.2);
  else box3(b, w.x + w.w / 2 - 0.1, w.h - 0.06, w.z - o, 0.2, 0.12, w.d + o * 2);
  b.setColor(INK.stoneD);
  box3(b, w.x + w.w * 0.75, w.h * 0.7, w.z + w.d * 0.3, 0.6, w.h * 0.45, 0.6);
  // Windows on every face, a door on the camera side; one or two lit.
  const win = (x, z, alongX, lit) => {
    if (lit) emissive(b, () => { b.setColor(scale(INK.glow, 0.7)); alongX ? box3(b, x, eave * 0.45, z, 0.7, 0.75, 0.05) : box3(b, x, eave * 0.45, z, 0.05, 0.75, 0.7); });
    else { b.setColor(0x2a2c30); alongX ? box3(b, x, eave * 0.45, z, 0.7, 0.75, 0.05) : box3(b, x, eave * 0.45, z, 0.05, 0.75, 0.7); }
  };
  for (let x = w.x + 0.8; x < w.x + w.w - 1.2; x += 1.9) { win(x, w.z + w.d + 0.01, true, rnd() < 0.2); win(x, w.z - 0.06, true, false); }
  for (let z = w.z + 0.8; z < w.z + w.d - 1.2; z += 1.9) { win(w.x - 0.06, z, false, false); win(w.x + w.w + 0.01, z, false, rnd() < 0.2); }
  b.setColor(INK.plankD);
  box3(b, w.x + w.w / 2 - 0.5, 0, w.z + w.d + 0.01, 1.0, 1.95, 0.06);
}

// Galvanised silo: a ribbed drum with a cone cap, a ladder up the camera side.
function silo(ctx, w) {
  const { b } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2, r = Math.min(w.w, w.d) / 2;
  const drum = w.h - r * 0.7;
  b.setColor(scale(INK.steel, 1.25));
  b.prismY(0, drum, cx, cz, r, r, 14);
  b.setColor(INK.steel);
  for (let y = 1.2; y < drum - 0.2; y += 1.4) b.prismY(y, y + 0.1, cx, cz, r + 0.03, r + 0.03, 14);
  b.setColor(scale(INK.steel, 1.1));
  b.prismY(drum, w.h, cx, cz, r + 0.12, 0.25, 14);
  b.setColor(INK.concrete);
  b.prismY(0, 0.35, cx, cz, r + 0.15, r + 0.15, 14);
  b.setColor(INK.trim);
  box3(b, cx - 0.22, 0.4, cz + r, 0.06, drum - 0.4, 0.06);
  box3(b, cx + 0.16, 0.4, cz + r, 0.06, drum - 0.4, 0.06);
  for (let y = 0.7; y < drum - 0.2; y += 0.45) box3(b, cx - 0.22, y, cz + r, 0.44, 0.04, 0.05);
}

// Co-op grain elevator: three pairs of concrete bins, a head house on top and a spout reaching down the side.
function elevator(ctx, w) {
  const { b } = ctx;
  const long = w.d >= w.w, n = 3, binR = Math.min(w.w, w.d) / 4 + 0.05;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 2; j++) {
      const u = (i + 0.5) / n, v = (j + 0.5) / 2;
      const cx = long ? w.x + w.w * v : w.x + w.w * u, cz = long ? w.z + w.d * u : w.z + w.d * v;
      b.setColor(scale(INK.concrete, 0.94 + ((i + j) % 2) * 0.08));
      b.prismY(0, w.h, cx, cz, binR, binR, 12);
    }
  }
  b.setColor(scale(INK.concrete, 1.08));
  box3(b, w.x + 0.2, w.h - 0.1, w.z + 0.2, w.w - 0.4, 0.3, w.d - 0.4);
  b.setColor(INK.wallB);
  box3(b, w.x + w.w * 0.25, w.h + 0.2, w.z + w.d * 0.3, w.w * 0.5, 2.4, w.d * 0.4);
  b.setColor(INK.slate);
  box3(b, w.x + w.w * 0.22, w.h + 2.6, w.z + w.d * 0.28, w.w * 0.56, 0.12, w.d * 0.44);
  b.setColor(0x2a2c30);
  box3(b, w.x + w.w * 0.4, w.h + 1.1, w.z + w.d * 0.7 + 0.01, w.w * 0.2, 0.6, 0.04);
  b.setColor(INK.rust);
  box3(b, w.x + w.w - 0.5, 0.6, w.z + w.d * 0.45, 0.3, w.h - 0.6, 0.3);
  b.setColor(scale(INK.white, 0.9));
  box3(b, w.x + w.w * 0.1, w.h * 0.62, w.z + w.d + 0.01, w.w * 0.8, 0.7, 0.04);
}

function harvestBuilding(ctx, w) {
  if (w.silo) silo(ctx, w);
  else if (w.elevator) elevator(ctx, w);
  else farmhouse(ctx, w);
}

// Pond: a muddy bank and reeds at the margins.
function pondBank(ctx, w) {
  const { b, rnd } = ctx;
  const lip = (x0, z0, x1, z1) => {
    b.setColor(scale(INK.earthD, 0.7));
    const ox = x0 === x1 ? (x0 === w.x ? -1 : 1) : 0;
    const oz = z0 === z1 ? (z0 === w.z ? -1 : 1) : 0;
    b.quad([x0, 0.02, z0], [x1, 0.02, z1], [x1, WATER_Y - 0.6, z1], [x0, WATER_Y - 0.6, z0], [(x0 + x1) / 2 + ox, -0.3, (z0 + z1) / 2 + oz]);
  };
  lip(w.x, w.z, w.x + w.w, w.z);
  lip(w.x + w.w, w.z, w.x + w.w, w.z + w.d);
  lip(w.x + w.w, w.z + w.d, w.x, w.z + w.d);
  lip(w.x, w.z + w.d, w.x, w.z);
  const per = 2 * (w.w + w.d);
  for (let s = 0; s < per; s += 0.55 + rnd() * 0.7) {
    let x, z;
    if (s < w.w) { x = w.x + s; z = w.z + 0.15; }
    else if (s < w.w + w.d) { x = w.x + w.w - 0.15; z = w.z + s - w.w; }
    else if (s < 2 * w.w + w.d) { x = w.x + w.w - (s - w.w - w.d); z = w.z + w.d - 0.15; }
    else { x = w.x + 0.15; z = w.z + w.d - (s - 2 * w.w - w.d); }
    b.setColor(scale(INK.reed, 0.8 + rnd() * 0.3));
    b.prismY(WATER_Y, 0.5 + rnd() * 0.7, x, z, 0.12, 0.02, 3, rnd() * 3);
  }
}

// Perimeter: an overgrown field boundary, a hedge thick enough to stop anyone, with trees beyond it.
function hedgeBorder(ctx, w) {
  const { b, rnd } = ctx;
  hedgeWall(ctx, { ...w, h: w.h });
  const long = w.w > w.d, L = long ? w.w : w.d;
  const out = long ? (w.z < 0 ? -1 : 1) : (w.x < 0 ? -1 : 1);
  for (let s = 2 + rnd() * 4; s < L - 1; s += 7 + rnd() * 9) {
    const x = long ? w.x + s : w.x + w.w / 2 + out * (2.2 + rnd() * 1.5);
    const z = long ? w.z + w.d / 2 + out * (2.2 + rnd() * 1.5) : w.z + s;
    harvestTree(b, x, z, 4.5 + rnd() * 3, 1.8 + rnd() * 1.2, rnd);
  }
}

function harvestTree(b, x, z, hgt, cr, rnd) {
  b.setColor(INK.bark);
  b.prismY(0, hgt * 0.55, x, z, 0.3, 0.2, 6, rnd());
  b.setColor(INK.hedgeD);
  b.prismY(hgt * 0.35, hgt * 0.8, x, z, cr * 0.6, cr, 7, rnd() * 3);
  b.setColor(rnd() < 0.3 ? scale(INK.wheatD, 0.9) : INK.leaf);
  b.prismY(hgt * 0.8, hgt, x, z, cr, cr * 0.35, 7, rnd() * 3);
}

function harvestDecor(ctx) {
  const { b, rnd, W, H } = ctx;
  // Tree lines and poplars along the far field boundaries, a barn or two in the distance, a wind pump.
  for (let i = 0; i < 46; i++) {
    const side = i % 4, t = rnd();
    let x, z;
    if (side === 0) { x = -18 + t * (W + 36); z = -6 - rnd() * 12; }
    else if (side === 1) { x = -18 + t * (W + 36); z = H + 6 + rnd() * 10; }
    else if (side === 2) { x = -6 - rnd() * 12; z = -6 + t * (H + 12); }
    else { x = W + 6 + rnd() * 12; z = -6 + t * (H + 12); }
    if (rnd() < 0.4) {
      b.setColor(INK.bark); b.prismY(0, 2, x, z, 0.25, 0.18, 5);
      b.setColor(INK.hedge); b.prismY(1.5, 9 + rnd() * 3, x, z, 0.9, 0.2, 6, rnd());
    } else harvestTree(b, x, z, 5 + rnd() * 4, 2 + rnd() * 1.6, rnd);
  }
  for (const [x, z] of [[-14, 18], [W + 9, H - 22]]) {
    farmhouse(ctx, { x, z, w: 7, d: 5, h: 4.6 });
  }
  for (const [x, z] of [[W * 0.3, -14], [W * 0.7, H + 10]]) plankWall(ctx, { x, z, w: 10, d: 6, h: 5, kind: 'wall' });
  // Wind pump: a lattice tower and a fan, beside the west track.
  const px = -8, pz = H * 0.5 + 4;
  b.setColor(INK.steel);
  for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]) {
    b.prismY(0, 9, px + dx, pz + dz, 0.07, 0.07, 4);
  }
  b.setColor(scale(INK.steel, 0.8));
  for (let y = 1.5; y < 9; y += 1.8) box3(b, px - 0.85, y, pz - 0.85, 1.7, 0.06, 1.7);
  b.setColor(scale(INK.white, 0.85));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.tri([px, 9.6, pz + 0.9], [px + Math.cos(a) * 2.2, 9.6 + Math.sin(a) * 2.2, pz + 0.9], [px + Math.cos(a + 0.22) * 2.2, 9.6 + Math.sin(a + 0.22) * 2.2, pz + 0.9]);
  }
  skyRing(ctx, { low: [0.36, 0.38, 0.34], mid: [0.56, 0.6, 0.62], warm: [0.86, 0.72, 0.5], high: [0.42, 0.52, 0.66], warmDir: [1, 0.6], y0: -4, y1: 12, y2: 60 });
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
  frost: { ...RAILYARD_DRESS, container: wagon, building: frostBuilding, wall: frostWall, crate: frostCrate, barrier: frostBarrier, sandbag: snowbank, border: frostBorder },
  topside: { ...RAILYARD_DRESS, crane: steelColumn, building: topsideCore, wall: topsideWall, container: materialStack, crate: brickPallet, barrier: topsideBarrier, water: lightWell, border: topsideEdge },
  sunken: { ...RAILYARD_DRESS, rock: sunkenRock, boulder: fallenStone, building: shrine, water: sunkenBank, wall: sunkenWall, border: jungleEdge },
  harvest: { ...RAILYARD_DRESS, wall: harvestWall, barrier: harvestBarrier, crate: roundBale, container: harvestContainer, building: harvestBuilding, water: pondBank, border: hedgeBorder },
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
  frost: { lights: frostLights, paint: frostPaint, decor: frostDecor },
  topside: { lights: topsideLights, paint: topsidePaint, decor: topsideDecor },
  sunken: { lights: sunkenLights, paint: sunkenPaint, decor: sunkenDecor },
  harvest: { lights: () => {}, paint: harvestPaint, decor: harvestDecor },
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
  const ctx = { b, sb, glow, map, theme, W, H, lamps, timeU, flashU, rnd: mulberry(7321), noise: makeNoise(991), groundWet: 0, tracks: frostTracks(map) };

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
    group, material, tris, lamps, decals,
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
  frost: { ground: '#9aa6b8', solid: '#4f5a6c', low: '#c8d2e0', edge: '#151b26' },
  topside: { ground: '#8a847e', solid: '#4c4a52', low: '#a8865a', water: '#1a1418', edge: '#241a22' },
  sunken: { ground: '#4f5c3e', solid: '#8a8a72', low: '#6c6c58', water: '#18342c', edge: '#121a14' },
  harvest: { ground: '#9a8a58', solid: '#6e4a3c', low: '#c0a462', water: '#2c4a44', edge: '#2a2418' },
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
