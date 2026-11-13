// The giant battle royale map's world (docs/BR.md, docs/BR-PERF.md "After"): Frontier and any other map of size
// 'giant'. One light for the whole map (a clear late afternoon), and per region its own ground, palette and drawers:
// each piece is dressed by its region's theme module (or the one its `skin` names), so the places look as they do in
// the 6v6 maps they come from. Ground colours blend across region borders.
//
// Streaming: nothing is built up front but the water. The world is cut into TILE x TILE metre tiles; setView builds
// the tiles near the camera target at once (the first frame and after a teleport), the rest of those within reach a
// few per frame inside a time budget, nearest first, and drops tiles far out of reach, so memory and load time follow
// the view instead of the map. Each tile is a few meshes (ground and pieces, shadow decals, signs, glow, roofs).
//
// Enterable buildings (js/shared/maps/br-kit.js) get walls with door gaps and window sills, furniture, a floor and a
// roof. Roofs are their own layer: a roof dissolves (dithered) when the local player or a teammate near them is inside
// its footprint or right outside a door, so you always see who is in the room with you.
import * as THREE from 'three';
import { THEMES, hexRGB } from '../art.js';
import { MeshBuilder, settleCoplanar } from '../meshbuild.js';
import { mass, waterBanks, box3, emissive, scale, mix } from './kit.js';
import { lighthouse } from './coast.js';
import { regionField, segDist, mulberry as mul2 } from '../../shared/maps/br-kit.js';

const TILE = 32;
const PAD = 40;                 // Ground drawn past the map edge, for the off-map view.
const CELL = 2;                 // Ground lattice.
const URGENT = 20;              // Tiles this close to the camera target are built the frame they are needed.
const BUDGET_MS = 5;            // Per frame for the rest.
const KEEP = 190;               // Tiles further than this are dropped (rebuilt, identically, if the camera returns).
const IDLE = 120;               // With nothing urgent, tiles within this are built ahead.

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));
const H = hexRGB;

THEMES.frontier = {
  id: 'frontier',
  // Late afternoon over the whole world: warm sun low in the south-west, long shadows north-east.
  light: { dir: norm([-0.62, 0.56, 0.5]), sun: [1.0, 0.84, 0.64], sky: [0.44, 0.46, 0.54], amb: [0.33, 0.32, 0.34] },
  clear: 0x2c3036,
  fog: [0.46, 0.48, 0.54], fogSeam: [0.2, 0.13, 0.05], desatTint: [0.86, 0.84, 0.8],
  shadow: { col: [0.42, 0.4, 0.52], strength: 0.6, len: 1.25 },
  lamp: [0.18, 0.12, 0.05],
  water: { deep: [0.05, 0.11, 0.14], shallow: [0.12, 0.22, 0.24], glint: [0.95, 0.82, 0.6] },
  ink: ink({
    ground: 0x857a5e, asphalt: 0x4c4d52, dirt: 0x6a5e4a, gravel: 0x807868,
    roof: 0x4c4f58, wall: 0x9a8f80, wallB: 0x86807a, trim: 0x3c3830,
    concrete: 0x9a968c, crate: 0x9a7a4c, crateD: 0x5c4a30,
    rail: 0x7f8690, tie: 0x3f3530, hazardY: 0xa8873a, hazardK: 0x2a2620,
    paint: 0xd8cfb0, glow: 0xffd89a, glowCool: 0xd4e6ff,
    rock: 0x86827a, rockD: 0x6a6660, rockL: 0x9a968c,
  }),
  containers: [0x3c6a72, 0x8a4634, 0xa8853c, 0x5b4a6e, 0x3e5a48],
  weather: { fields: [
    { kind: 'mote', count: 90, box: [42, 6, 32], vel: [0.8, 0.12, 0.3], size: 0.09, col: [1.0, 0.86, 0.6], alpha: 0.45 },
    { kind: 'mote', count: 14, box: [48, 2.5, 36], vel: [1.0, 0.02, 0.3], size: 4, col: [0.86, 0.84, 0.8], alpha: 0.04 },
    // A few dry leaves blowing through (js/render/weather.js 'leaf').
    { kind: 'leaf', count: 22, box: [42, 7, 32], vel: [1.1, -0.55, 0.35], size: 0.5, col: [0.96, 0.62, 0.26], alpha: 0.92 },
  ] },
};

export const thumb = { ground: '#7a7460', solid: '#a8a294', low: '#8a846c', water: '#1d3a46', edge: '#1c1c1c' };

// Which theme module dresses a region's pieces (a piece's own `skin` wins).
const SKIN = { metro: 'metro', industrial: 'foundry', coast: 'pier', arctic: 'arctic', farmland: 'harvest', desert: 'desert', jungle: 'jungle' };

// Ground per region: base, second patch colour, a path colour, and how much the height noise shows.
const GROUND = {
  arctic: { a: H(0xd0d8e4), b: H(0xb4c0d0), c: H(0x9aa8bc), amp: 0.12 },
  industrial: { a: H(0x6e6a62), b: H(0x635a4e), c: H(0x7c7a74), amp: 0.06 },
  coast: { a: H(0x7a8256), b: H(0x8a8a62), c: H(0xb0a684), amp: 0.08 },
  farmland: { a: H(0x6c7450), b: H(0x9a8c5e), c: H(0x6a5c48), amp: 0.08 },
  metro: { a: H(0x77756f), b: H(0x6a6862), c: H(0x828078), amp: 0.03 },
  desert: { a: H(0xa39577), b: H(0x978c78), c: H(0xb4a688), amp: 0.16 },
  jungle: { a: H(0x56682f), b: H(0x4a5c2a), c: H(0x6a5a3a), amp: 0.1 },
};
const ZONE = {
  runway: H(0x4e5056), apron: H(0x8a877e), plaza: H(0x8c877c), park: H(0x5e7040), court: H(0x8a8a72), quay: H(0x8a8880),
  riverbed: H(0xbab2a0), ice: H(0x9cc0da), field: H(0x9a8a5a),
};
const ROAD = { asphalt: H(0x46474c), dirt: H(0x7a6a50) };

// Building styles: walls, trim, roof, floor, and the roof's shape.
const STYLE = {
  metro: { wall: [0x8a7a6c, 0x7a7c84, 0x9a8a76, 0x6e6a70], trim: 0x3a3a42, roof: 0x55585e, floor: 0x7a7670, floorB: 0x6c6862, roofKind: 'flat', parapet: true },
  station: { wall: [0xa8a49a], trim: 0x2f5a52, roof: 0x5c6066, floor: 0xa09a8e, floorB: 0x8e897e, roofKind: 'flat', parapet: true },
  industrial: { wall: [0x6f7880, 0x7a6e60], trim: 0x8a6a2e, roof: 0x5a6068, floor: 0x5e5c58, floorB: 0x56544f, roofKind: 'ridged' },
  hangar: { wall: [0x8a8e88], trim: 0x5a5e58, roof: 0x7a7e78, floor: 0x6a6862, floorB: 0x625f5a, roofKind: 'ridged' },
  tower: { wall: [0xb0a894], trim: 0x4a4a4a, roof: 0x6a6a6a, floor: 0x8a8478, floorB: 0x7e786c, roofKind: 'cab' },
  coast: { wall: [0x4a6a8a, 0x8a3e34, 0xc4c2b8, 0x3e6650], trim: 0xd8d4c4, roof: 0x3a3c44, floor: 0x7c6a52, floorB: 0x6a5a44, roofKind: 'gable', planks: true },
  arctic: { wall: [0xb84a32, 0xc8ccd0, 0xd0a030], trim: 0x30343c, roof: 0xd8e0ea, floor: 0x5a6068, floorB: 0x50565e, roofKind: 'flat', snow: true },
  ship: { wall: [0xd0d2cc], trim: 0x8a2a24, roof: 0x8a8e90, floor: 0x5a6068, floorB: 0x50565e, roofKind: 'flat' },
  farm: { wall: [0xc2b7a0, 0xb3a98f], trim: 0x3c332b, roof: 0x4a4e58, floor: 0x7a6650, floorB: 0x6a5842, roofKind: 'gable', planks: true },
  barn: { wall: [0x7a3c30, 0x6e4a36], trim: 0xd2cab6, roof: 0x5a5148, floor: 0x6a5039, floorB: 0x5c4430, roofKind: 'gable', planks: true },
  desert: { wall: [0xac9c82, 0xb8a88c, 0x9f9078], trim: 0x897964, roof: 0xa08e74, floor: 0x8f7c60, floorB: 0x857258, roofKind: 'flat', parapet: true },
  jungle: { wall: [0x6a5039, 0x7a5e40], trim: 0x4a382a, roof: 0x9a8450, floor: 0x5a4630, floorB: 0x4e3c28, roofKind: 'hip', planks: true },
  temple: { wall: [0x8a8a72, 0x7e7e68], trim: 0x6c6c58, roof: 0x7a7a64, floor: 0x6c6c58, floorB: 0x626250, roofKind: 'stepped' },
};
for (const s of Object.values(STYLE)) { s.wall = s.wall.map(H); s.trim = H(s.trim); s.roof = H(s.roof); s.floor = H(s.floor); s.floorB = H(s.floorB); }
const styleOf = id => STYLE[id] || STYLE.metro;
const wallCol = (S, id) => S.wall[(id * 7 + 3) % S.wall.length];

const ROCK = {
  arctic: { cols: [H(0x8a96a8), H(0x74808f)], cap: H(0xdce4ee) },
  desert: { cols: [H(0x8a7760), H(0x69594a)], cap: H(0xa8957a) },
  jungle: { cols: [H(0x6e6c5a), H(0x56544a)], cap: H(0x4f6a2e) },
  farmland: { cols: [H(0x86827a), H(0x6a6660)], cap: H(0x66704a) },
  coast: { cols: [H(0x7a7a76), H(0x5e5e5a)], cap: H(0x7a8256) },
  industrial: { cols: [H(0x7c7872), H(0x625e58)], cap: H(0x8a8680) },
  metro: { cols: [H(0x8a8884), H(0x6e6c68)], cap: H(0x9a968c) },
};
const BANK = {
  arctic: { face: H(0x6e7a8c), lip: H(0xc8d2de) }, desert: { face: H(0x7c6a54), lip: H(0x9a8a6c) },
  jungle: { face: H(0x4e4030), lip: H(0x5a4a36) }, farmland: { face: H(0x5a4c3a), lip: H(0x6a705a) },
  coast: { face: H(0x5a5650), lip: H(0x8a8880) }, industrial: { face: H(0x5c5a56), lip: H(0x8a8882) },
  metro: { face: H(0x5c5a56), lip: H(0x8e8c86) },
};

// Roof layer: baked colour plus the building's footprint per vertex; a roof dissolves round the cutters (the local
// player and nearby teammates): fully when one stands inside its footprint, partly just outside.
const ROOF_VERT = /* glsl */`
attribute vec3 aCol;
attribute vec4 aRect;
uniform vec4 uFogXf;
uniform vec4 uCut[4];
varying vec3 vCol;
varying vec2 vFogUv;
varying float vFade;
void main() {
  vCol = aCol;
  float f = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 c = uCut[i];
    float dx = max(max(aRect.x - c.x, 0.0), c.x - aRect.z);
    float dz = max(max(aRect.y - c.y, 0.0), c.y - aRect.w);
    f = max(f, c.z * (1.0 - smoothstep(0.2, 2.6, length(vec2(dx, dz)))));
  }
  vFade = f;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vFogUv = w.xz * uFogXf.xy + uFogXf.zw;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const ROOF_FRAG = /* glsl */`
uniform sampler2D uFogTex;
uniform float uFogOn, uDesat;
uniform vec3 uFogTint, uDesatTint;
varying vec3 vCol;
varying vec2 vFogUv;
varying float vFade;
const vec3 LUM = vec3(0.3, 0.59, 0.11);
void main() {
  // Ordered dither: no blending, no sorting, and the roof thins out evenly.
  vec2 p = mod(floor(gl_FragCoord.xy), 4.0);
  float d = mod(p.x * 2.0 + p.y * 3.0 + p.x * p.y, 4.0) / 4.0 + mod(p.y, 2.0) * 0.125 + 0.06;
  if (vFade > d) discard;
  vec3 col = vCol;
  float v = texture2D(uFogTex, vFogUv).r;
  vec2 q = abs(vFogUv - 0.5);
  v = max(v, smoothstep(0.495, 0.505, max(q.x, q.y)) * 0.6);
  // A roof is seen from above, past what blocks your eyes at head height: never darker than half lit.
  float vis = smoothstep(0.1, 0.9, mix(1.0, max(v, 0.45), uFogOn));
  vec3 fogged = mix(vec3(dot(col, LUM)), col, 0.3) * uFogTint;
  vec3 lit = mix(fogged, col, vis);
  if (uDesat > 0.0) lit = mix(lit, vec3(dot(lit, LUM)) * uDesatTint, uDesat);
  gl_FragColor = vec4(lit, 1.0);
}`;

const VIEW_M = new THREE.Matrix4(), VIEW_F = new THREE.Frustum();

// Value noise like world.js's (seeded the same), for ground variation.
function hash2(i, j) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function geometry(attrs) {
  const g = new THREE.BufferGeometry();
  for (const a of attrs) {
    const d = Array.isArray(a.data) ? new Float32Array(a.data) : a.data;
    g.setAttribute(a.name, new THREE.BufferAttribute(d, a.size, !!a.normalized));
  }
  g.computeBoundingBox();
  return g;
}

export function buildGiantWorld(map, fogUniforms, X) {
  const theme = THEMES.frontier;
  const W = map.width, Hh = map.height;
  const field0 = regionField(map.regionSeeds);
  // The region field on a 2 m lattice, memoised (the ground asks it for every triangle).
  const fieldMemo = new Map();
  const field = (x, z) => {
    const key = Math.round(x / 2) * 4096 + Math.round(z / 2);
    let v = fieldMemo.get(key);
    if (!v) {
      if (fieldMemo.size > 60000) fieldMemo.clear();
      fieldMemo.set(key, v = field0(Math.round(x / 2) * 2, Math.round(z / 2) * 2).slice());
    }
    return v;
  };
  const noise = X.makeNoise(991);
  const timeU = { value: 0 }, flashU = { value: 0 };
  const group = new THREE.Group();
  const material = X.createWorldMaterial(fogUniforms, theme);
  material.uniforms.uTime = timeU;
  material.uniforms.uFlash = flashU;
  const U = material.uniforms;
  const cutters = [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0));
  const roofMat = new THREE.ShaderMaterial({
    vertexShader: ROOF_VERT, fragmentShader: ROOF_FRAG,
    uniforms: { uFogTex: fogUniforms.tex, uFogXf: fogUniforms.xf, uFogOn: fogUniforms.on, uDesat: U.uDesat, uFogTint: U.uFogTint, uDesatTint: U.uDesatTint, uCut: { value: cutters } },
  });
  const decalMat = new THREE.ShaderMaterial({
    vertexShader: `attribute float aStr; varying float vS; void main(){ vS = aStr; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uShadow; varying float vS; void main(){ gl_FragColor = vec4(mix(vec3(1.0), uShadow, vS), 1.0); }`,
    uniforms: { uShadow: { value: new THREE.Vector3(...theme.shadow.col) } },
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    side: THREE.DoubleSide,
  });
  const fogMat = (vs, fs, transparent) => new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: fs,
    uniforms: { uFogTex: fogUniforms.tex, uFogXf: fogUniforms.xf, uFogOn: fogUniforms.on, uTime: timeU },
    transparent, depthWrite: !transparent,
    ...(transparent ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor } : {}),
    side: transparent ? THREE.DoubleSide : THREE.FrontSide,
  });
  const signMat = fogMat(X.SIGN_VERT, X.SIGN_FRAG, false);
  const glowMat = fogMat(X.GLOW_VERT, X.GLOW_FRAG, true);
  const decals = new THREE.Group();
  group.add(decals);

  // ---- Map data, indexed by tile ------------------------------------------------------------------------------
  const ti0 = Math.floor(-PAD / TILE), ti1 = Math.floor((W + PAD - 0.001) / TILE);
  const tj0 = Math.floor(-PAD / TILE), tj1 = Math.floor((Hh + PAD - 0.001) / TILE);
  const NI = ti1 - ti0 + 1, NJ = tj1 - tj0 + 1;
  const tiles = [];
  for (let j = tj0; j <= tj1; j++) for (let i = ti0; i <= ti1; i++) {
    tiles.push({ i, j, x0: i * TILE, z0: j * TILE, walls: [], rooms: [], roofs: [], built: false, meshes: [], box: null });
  }
  const tileAt = (x, z) => {
    const i = Math.max(ti0, Math.min(ti1, Math.floor(x / TILE))), j = Math.max(tj0, Math.min(tj1, Math.floor(z / TILE)));
    return tiles[(j - tj0) * NI + (i - ti0)];
  };
  for (const w of map.walls) tileAt(w.x + w.w / 2, w.z + w.d / 2).walls.push(w);
  for (const r of map.rooms ?? []) tileAt(r.x + r.w / 2, r.z + r.d / 2).rooms.push(r);
  for (const r of map.roofs ?? []) tileAt(r.x + r.w / 2, r.z + r.d / 2).roofs.push(r);
  const waters = map.walls.filter(w => w.kind === 'water');
  const zones = map.zones ?? [];
  const roads = map.roads ?? [];
  const roofs = map.roofs ?? [];
  // Off-map sea beyond the coast edges (no walls: nobody gets there).
  const seaOff = [];
  for (const w of waters) {
    if (!w.sea) continue;
    if (w.z <= 0.01) seaOff.push({ x: w.x, z: -PAD - 8, w: w.w + (w.x + w.w >= W - 0.01 ? PAD + 8 : 0), d: PAD + 8 + w.z });
    if (w.x + w.w >= W - 0.01) seaOff.push({ x: W, z: w.z, w: PAD + 8, d: w.d + 6 });
  }
  const inRect = (r, x, z, m = 0) => x > r.x - m && x < r.x + r.w + m && z > r.z - m && z < r.z + r.d + m;
  // What lies near the tile being built (focus), so the per-vertex tests stay local.
  const segs = [];
  for (const rd of roads) for (let k = 1; k < rd.pts.length; k++) segs.push([...rd.pts[k - 1], ...rd.pts[k], rd.w / 2]);
  const N = { wet: [], segs: [], roofs: [] };
  const focus = (x0, z0, x1, z1, m = 14) => {
    const hit = r => r.x < x1 + m && r.x + r.w > x0 - m && r.z < z1 + m && r.z + r.d > z0 - m;
    N.wet = [...waters.filter(w => !w.fountain), ...seaOff].filter(hit);
    N.roofs = roofs.filter(hit);
    N.segs = segs.filter(([ax, az, bx, bz, hw]) => Math.min(ax, bx) - hw < x1 + m && Math.max(ax, bx) + hw > x0 - m && Math.min(az, bz) - hw < z1 + m && Math.max(az, bz) + hw > z0 - m);
  };
  const onRoad = (x, z, m = 0.4) => {
    for (const [ax, az, bx, bz, hw] of N.segs) if (segDist(x, z, ax, az, bx, bz) < hw + m) return true;
    return false;
  };
  const wetAt = (x, z) => N.wet.some(w => inRect(w, x, z));

  // ---- Ground colour ------------------------------------------------------------------------------------------
  const regionColour = (reg, x, z) => {
    const G = GROUND[reg];
    const n = noise(x * 0.09 + 5, z * 0.09);
    let c = n > 0.62 ? G.b : n < 0.3 ? mix(G.a, G.c, 0.5) : G.a;
    if (reg === 'arctic' && noise(x * 0.05 + 3, z * 0.05) > 0.7) c = mix(c, H(0x8db2d2), 0.5);
    if (reg === 'coast' && (z < 26 && x > 262 || x > 374)) c = mix(c, G.c, 0.7);         // Sand by the sea.
    if (reg === 'metro' && (Math.floor(x / 3) + Math.floor(z / 3)) % 2) c = scale(c, 0.95);
    return c;
  };
  const groundColour = (x, z) => {
    if (x < 0 || z < 0 || x > W || z > Hh) {
      const [r] = field(Math.max(1, Math.min(W - 1, x)), Math.max(1, Math.min(Hh - 1, z)));
      return scale(regionColour(r, x, z), 0.78 + noise(x * 0.15, z * 0.15) * 0.15);
    }
    const [r1, r2, t] = field(x, z);
    let c = regionColour(r1, x, z);
    if (t > 0.01) c = mix(c, regionColour(r2, x, z), t);
    for (const zn of zones) {
      if (!inRect(zn, x, z)) continue;
      const zc = ZONE[zn.kind];
      if (!zc) continue;
      if (zn.kind === 'riverbed') {
        const mid = zn.z + zn.d / 2 + Math.sin(x * 0.07) * zn.d * 0.2;
        c = Math.abs(z - mid) < zn.d * 0.3 ? mix(zc, H(0xa49c8a), noise(x * 0.6, z * 0.6)) : mix(c, H(0x7c6a54), 0.4);
      } else if (zn.kind === 'ice') c = mix(c, zc, 0.35 + noise(x * 0.12, z * 0.12) * 0.4);
      else if (zn.kind === 'field') c = noise(x * 0.04, z * 0.3) > 0.45 ? zc : mix(zc, H(0x6a5c48), 0.6);
      else if (zn.kind === 'court') c = (Math.floor(x / 1.6) + Math.floor(z / 1.6)) % 3 ? zc : scale(zc, 0.85);
      else c = zc;
    }
    return scale(c, 0.92 + noise(x * 0.7, z * 0.7) * 0.14);
  };

  // Lattice vertex: jittered and height-noised, except where a cell next to it holds water (those cells are cut
  // exactly along the water's edges).
  const wetCell = (gi, gj) => {
    const x = gi * CELL, z = gj * CELL;
    return N.wet.some(w => w.x < x + CELL && w.x + w.w > x && w.z < z + CELL && w.z + w.d > z);
  };
  // Flat under roads and buildings, so their strips and floors never sink into a bump.
  const heightAt = (x, z) => {
    if (onRoad(x, z, 1.5) || N.roofs.some(r => inRect(r, x, z, 1))) return 0;
    const [r] = field(Math.max(1, Math.min(W - 1, x)), Math.max(1, Math.min(Hh - 1, z)));
    return (noise(x * 0.5, z * 0.5) - 0.5) * GROUND[r].amp;
  };

  // ---- One tile -----------------------------------------------------------------------------------------------
  const skinState = (ctx, skin) => {
    const th = THEMES[skin] || theme;
    ctx.theme = th;
    X.setPalette(th);
    if (skin === 'jungle') X.THEME_STAGES.jungle.lights(ctx);
    if (skin === 'arctic') X.THEME_STAGES.arctic.ground(ctx);
    if (skin === 'metro' && !ctx.shopStyle) ctx.shopStyle = new Map();
  };

  function buildTile(t) {
    const lamps = [];
    const b = new MeshBuilder(X.makeBake(theme, lamps));
    const rb = new MeshBuilder(X.makeBake(theme, lamps));
    const rect = [];
    const sb = new MeshBuilder(null);
    const glow = new X.GlowList();
    const x0 = t.x0, z0 = t.z0, x1 = x0 + TILE, z1 = z0 + TILE;
    const local = {
      id: map.id, width: W, height: Hh, large: true, lanes: [], zones, spawns: [[], []],
      walls: map.walls.filter(w => w.x < x1 + 12 && w.x + w.w > x0 - 12 && w.z < z1 + 12 && w.z + w.d > z0 - 12),
      rooms: (map.rooms ?? []).filter(r => r.x < x1 + 12 && r.x + r.w > x0 - 12 && r.z < z1 + 12 && r.z + r.d > z0 - 12),
    };
    const ctx = { b, sb, glow, map: local, theme, W, H: Hh, lamps, timeU, flashU, rnd: mul2(t.i * 7919 + t.j * 104729 + 17), noise, groundWet: 0, tracks: [], kit: X.KIT,
      field, wet: wetAt, road: onRoad, roads, rails: map.rails ?? [] };
    X.setPalette(theme);
    focus(x0, z0, x1, z1);

    // Ground.
    const gi0 = Math.round(x0 / CELL), gj0 = Math.round(z0 / CELL), n = TILE / CELL;
    const memo = new Map();
    const vert = (gi, gj) => {
      const key = gi * 65536 + gj;
      let v = memo.get(key);
      if (!v) memo.set(key, v = vertAt(gi, gj));
      return v;
    };
    const vertAt = (gi, gj) => {
      const x = gi * CELL, z = gj * CELL;
      const free = !(wetCell(gi - 1, gj - 1) || wetCell(gi, gj - 1) || wetCell(gi - 1, gj) || wetCell(gi, gj));
      const jx = free ? (hash2(gi, gj) - 0.5) * CELL * 0.36 : 0, jz = free ? (hash2(gj + 911, gi) - 0.5) * CELL * 0.36 : 0;
      return [x + jx, heightAt(x + jx, z + jz), z + jz];
    };
    const outside = (x, z) => x < -PAD || z < -PAD || x > W + PAD || z > Hh + PAD;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gi = gi0 + i, gj = gj0 + j;
      const cx = gi * CELL, cz = gj * CELL;
      if (outside(cx + 1, cz + 1)) continue;
      if (!wetCell(gi, gj)) {
        const a = vert(gi, gj), bb = vert(gi, gj + 1), c = vert(gi + 1, gj + 1), d = vert(gi + 1, gj);
        const flip = hash2(gi * 3, gj * 5) < 0.5;
        for (const tr of flip ? [[a, bb, c], [a, c, d]] : [[a, bb, d], [d, bb, c]]) {
          b.color = groundColour((tr[0][0] + tr[1][0] + tr[2][0]) / 3, (tr[0][2] + tr[1][2] + tr[2][2]) / 3);
          b.tri(tr[0], tr[1], tr[2]);
        }
        continue;
      }
      // Cut the cell along every water edge inside it; keep the dry pieces.
      const xs = [cx, cx + CELL], zs = [cz, cz + CELL];
      for (const w of N.wet) {
        for (const v of [w.x, w.x + w.w]) if (v > cx && v < cx + CELL) xs.push(v);
        for (const v of [w.z, w.z + w.d]) if (v > cz && v < cz + CELL) zs.push(v);
      }
      xs.sort((p, q) => p - q); zs.sort((p, q) => p - q);
      for (let q = 0; q < zs.length - 1; q++) for (let p = 0; p < xs.length - 1; p++) {
        const ax = xs[p], bx = xs[p + 1], az = zs[q], bz = zs[q + 1];
        if (bx - ax < 1e-3 || bz - az < 1e-3 || wetAt((ax + bx) / 2, (az + bz) / 2)) continue;
        b.color = groundColour((ax + bx) / 2, (az + bz) / 2);
        b.quad([ax, 0, az], [ax, 0, bz], [bx, 0, bz], [bx, 0, az]);
      }
    }

    // Floors, decks and bridges.
    for (const r of t.rooms) floor(ctx, r);
    paintRoads(ctx, x0, z0, x1, z1);
    rails(ctx, x0, z0, x1, z1);

    // Pieces.
    let skin = null;
    for (const w of t.walls) {
      const reg = w.region || 'farmland';
      if (w.bwall || w.window || w.furn) { X.setPalette(theme); ctx.theme = theme; skin = null; kitPiece(ctx, w); continue; }
      if (w.kind === 'border') { edge(ctx, w); continue; }
      if (w.kind === 'water' && !w.fountain) { const k = BANK[reg] || BANK.coast; waterBanks(ctx, w, { face: k.face, lip: k.lip }); continue; }
      if (w.crag) { const k = ROCK[reg] || ROCK.farmland; mass(ctx, w.x, w.z, w.w, w.d, w.h, { cols: k.cols, cap: k.cap, levels: 3 }); continue; }
      if (w.mast) { mast(ctx, w); continue; }
      if (w.generator) { ctx.b.setColor(H(0x52603e)); box3(ctx.b, w.x, 0, w.z, w.w, w.h, w.d); continue; }
      if (w.lighthouse) { skinState(ctx, 'pier'); skin = 'pier'; lighthouse(ctx, w.x + w.w / 2, w.z + w.d / 2, w.h + 1); continue; }
      const s = w.skin || SKIN[reg] || 'harvest';
      if (s !== skin) { skinState(ctx, s); skin = s; }
      const draw = X.DRESS[s]?.[w.kind] || X.DRESS.railyard[w.kind];
      if (draw) draw(ctx, w);
    }
    X.setPalette(theme); ctx.theme = theme;
    decor(ctx, t);

    // Roofs.
    for (const r of t.roofs) {
      const before = rb.pos.length;
      roof(rb, r, ctx);
      for (let v = before / 3; v < rb.pos.length / 3; v++) rect.push(r.x, r.z, r.x + r.w, r.z + r.d);
    }

    settleCoplanar([b, rb, sb]);       // Trims and caps flat on roofs and walls: lift them so they never flicker.

    // Meshes.
    const add = (geo, mat, order, parent = group) => {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = order;
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      m.updateMatrixWorld(true);
      parent.add(m);
      t.meshes.push(m);
      t.box = t.box ? t.box.union(geo.boundingBox) : geo.boundingBox.clone();
    };
    if (b.pos.length) add(geometry(X.packWorld(b)), material, 0);
    const dec = X.buildDecals({ walls: t.walls.filter(w => w.kind !== 'border') }, theme);
    if (dec[0].data.length) add(geometry(dec), decalMat, -1, decals);
    if (sb.pos.length) add(geometry(X.floatAttrs(sb)), signMat, 0);
    if (glow.pos.length) add(geometry([{ name: 'position', data: glow.pos, size: 3 }, { name: 'aCol', data: glow.col, size: 3 }]), glowMat, 5);
    if (rb.pos.length) add(geometry([{ name: 'position', data: rb.pos, size: 3 }, { name: 'aCol', data: rb.col, size: 3 }, { name: 'aRect', data: rect, size: 4 }]), roofMat, 2);
    if (t.box) { t.box.min.y = Math.min(t.box.min.y, -1); t.box.max.y = Math.max(t.box.max.y, 1); }
    t.tris = (b.pos.length + rb.pos.length + sb.pos.length + glow.pos.length) / 9 + dec[0].data.length / 9;
    t.built = true;
    world.lamps.push(...lamps.slice(0, 4));
  }

  function dropTile(t) {
    for (const m of t.meshes) { m.parent.remove(m); m.geometry.dispose(); }
    t.meshes = []; t.box = null; t.built = false;
  }

  // ---- Water (all of it, built once: two triangles a rect) ----------------------------------------------------------
  {
    const pos = [];
    for (const w of [...waters, ...seaOff]) {
      if (w.fountain) continue;
      const y = X.KIT.WATER_Y;
      const p = [[w.x, y, w.z], [w.x, y, w.z + w.d], [w.x + w.w, y, w.z + w.d], [w.x + w.w, y, w.z]];
      for (const i of [0, 1, 2, 0, 2, 3]) pos.push(...p[i]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: X.WATER_VERT, fragmentShader: X.WATER_FRAG,
      uniforms: {
        uFogTex: fogUniforms.tex, uFogXf: fogUniforms.xf, uFogOn: fogUniforms.on, uTime: timeU, uFlash: flashU,
        uDeep: { value: new THREE.Vector3(...theme.water.deep) }, uShallow: { value: new THREE.Vector3(...theme.water.shallow) },
        uGlint: { value: new THREE.Vector3(...theme.water.glint) }, uFogTint: { value: new THREE.Vector3(...theme.fog) },
      },
    }));
    m.frustumCulled = false;
    group.add(m);
  }

  // One empty-ish mesh per material until the first tiles land, so the renderer's up-front compile covers them.
  const stubs = [];
  for (const [mat, attrs, parent] of [
    [material, [{ name: 'position', data: [0, -9, 0, 0, -9, 0.01, 0.01, -9, 0], size: 3 }, { name: 'aCol', data: new Uint16Array(12), size: 4, normalized: true }, { name: 'aNP', data: new Int8Array(12), size: 4, normalized: true }], group],
    [decalMat, [{ name: 'position', data: [0, -9, 0, 0, -9, 0.01, 0.01, -9, 0], size: 3 }, { name: 'aStr', data: [0, 0, 0], size: 1 }], decals],
    [signMat, [{ name: 'position', data: [0, -9, 0, 0, -9, 0.01, 0.01, -9, 0], size: 3 }, { name: 'normal', data: [0, 1, 0, 0, 1, 0, 0, 1, 0], size: 3 }, { name: 'aCol', data: [0, 0, 0, 0, 0, 0, 0, 0, 0], size: 3 }, { name: 'aPart', data: [0, 0, 0], size: 1 }], group],
    [glowMat, [{ name: 'position', data: [0, -9, 0, 0, -9, 0.01, 0.01, -9, 0], size: 3 }, { name: 'aCol', data: [0, 0, 0, 0, 0, 0, 0, 0, 0], size: 3 }], group],
    [roofMat, [{ name: 'position', data: [0, -9, 0, 0, -9, 0.01, 0.01, -9, 0], size: 3 }, { name: 'aCol', data: [0, 0, 0, 0, 0, 0, 0, 0, 0], size: 3 }, { name: 'aRect', data: new Array(12).fill(0), size: 4 }], group],
  ]) {
    const m = new THREE.Mesh(geometry(attrs), mat);
    m.frustumCulled = false;
    parent.add(m);
    stubs.push(m);
  }
  group.updateMatrixWorld(true);

  const order = [];
  const world = {
    group, material, decals, lamps: [], chunks: [], tris: 0, drawCalls: 0, tiles,
    stats: { built: 0, buildMs: 0, maxTileMs: 0, dropped: 0 },
    update(dt) { timeU.value = (timeU.value + dt) % 3600; },
    // Builds what the view needs (see the top of this file), then culls: a tile shows when its box is in the frustum
    // and within `cut` metres of (x, z).
    setView(camera, x, z, cut) {
      for (const s of stubs) s.visible = false;
      const st = this.stats;
      order.length = 0;
      const reach = Math.min(IDLE, cut === Infinity ? IDLE : cut + 24);
      for (const t of tiles) {
        const dx = Math.max(t.x0 - x, 0, x - t.x0 - TILE), dz = Math.max(t.z0 - z, 0, z - t.z0 - TILE);
        t.d = Math.hypot(dx, dz);
        if (t.built && t.d > KEEP) { dropTile(t); st.dropped++; }
        else if (!t.built && t.d < reach) order.push(t);
      }
      if (order.length) {
        order.sort((a, b) => a.d - b.d);
        const start = performance.now();
        for (const t of order) {
          if (t.d > URGENT && performance.now() - start > BUDGET_MS) break;
          const t0 = performance.now();
          buildTile(t);
          const ms = performance.now() - t0;
          st.built++; st.buildMs += ms; st.maxTileMs = Math.max(st.maxTileMs, ms);
        }
      }
      VIEW_M.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      VIEW_F.setFromProjectionMatrix(VIEW_M);
      let tris = 0;
      for (const t of tiles) {
        if (!t.built) continue;
        const on = !!t.box && t.d < cut && VIEW_F.intersectsBox(t.box);
        for (const m of t.meshes) m.visible = on;
        if (on) tris += t.tris;
      }
      this.tris = tris;
    },
    // Roof cutters: the local player (or whoever the camera follows) and up to three teammates within 30 m of them.
    setCutters(players, me) {
      let k = 0;
      if (me && me.alive !== false) cutters[k++].set(me.x, me.z, 1, 0);
      if (me && players) {
        for (const p of players) {
          if (k >= 4) break;
          if (p === me || p.team !== me.team || !p.alive || Math.abs(p.x - me.x) > 30 || Math.abs(p.z - me.z) > 30) continue;
          cutters[k++].set(p.x, p.z, 1, 0);
        }
      }
      for (; k < 4; k++) cutters[k].set(0, 0, 0, 0);
    },
    // Every tile at once (the overview render and tests).
    buildAll() { for (const t of tiles) if (!t.built) buildTile(t); for (const t of tiles) { t.d = 0; for (const m of t.meshes) m.visible = true; } },
    roofsAt(x, z) { return roofs.filter(r => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d); },
  };
  return world;
}

// ---- Drawers --------------------------------------------------------------------------------------------------

// Building walls, window sills and furniture from the kit.
function kitPiece(ctx, w) {
  const { b } = ctx;
  const S = styleOf(w.style);
  const col = wallCol(S, w.bld ?? 0);
  if (w.furn) {
    const wood = w.style === 'industrial' || w.style === 'hangar' || w.style === 'station' || w.style === 'ship' ? H(0x6a6e74) : H(0x7a5a3a);
    if (w.furn === 'shelf') {
      b.setColor(scale(wood, 0.8)); box3(b, w.x, 0, w.z, w.w, w.h, w.d);
      b.setColor(scale(wood, 1.15));
      for (let y = 0.5; y < w.h; y += 0.55) box3(b, w.x - 0.02, y, w.z - 0.02, w.w + 0.04, 0.06, w.d + 0.04);
      b.setColor(H(0x8a7a5a)); box3(b, w.x + 0.15, w.h, w.z + 0.15, Math.max(0.3, w.w - 0.5), 0.25, Math.max(0.3, w.d - 0.5));
    } else if (w.furn === 'table') {
      b.setColor(scale(wood, 0.7)); box3(b, w.x + 0.15, 0, w.z + 0.15, w.w - 0.3, w.h - 0.12, w.d - 0.3);
      b.setColor(wood); box3(b, w.x, w.h - 0.12, w.z, w.w, 0.12, w.d);
    } else {
      b.setColor(scale(wood, 0.85)); box3(b, w.x, 0, w.z, w.w, w.h, w.d);
      b.setColor(scale(wood, 1.2)); box3(b, w.x - 0.03, w.h - 0.06, w.z - 0.03, w.w + 0.06, 0.08, w.d + 0.06);
    }
    return;
  }
  if (w.window) {
    const bh = ctx.map.walls.find(q => q.bwall && q.bld === w.bld)?.h ?? 3.4;
    b.setColor(col); box3(b, w.x, 0, w.z, w.w, w.h, w.d);
    b.setColor(S.trim); box3(b, w.x - 0.04, w.h, w.z - 0.04, w.w + 0.08, 0.08, w.d + 0.08);
    const along = w.w >= w.d;
    b.setColor(col);
    // Lintel over the opening, posts at its ends.
    box3(b, w.x, bh - 0.5, w.z, w.w, 0.5, w.d);
    if (along) { box3(b, w.x, w.h, w.z, 0.1, bh - 0.5 - w.h, w.d); box3(b, w.x + w.w - 0.1, w.h, w.z, 0.1, bh - 0.5 - w.h, w.d); }
    else { box3(b, w.x, w.h, w.z, w.w, bh - 0.5 - w.h, 0.1); box3(b, w.x, w.h, w.z + w.d - 0.1, w.w, bh - 0.5 - w.h, 0.1); }
    return;
  }
  // Wall: plinth, body, a cap along the top that reads from above.
  b.setColor(scale(S.trim, 0.9)); box3(b, w.x - 0.02, 0, w.z - 0.02, w.w + 0.04, 0.35, w.d + 0.04);
  b.setColor(col); box3(b, w.x, 0.35, w.z, w.w, w.h - 0.35, w.d);
  b.setColor(w.inner ? scale(col, 0.8) : S.trim); box3(b, w.x - 0.03, w.h, w.z - 0.03, w.w + 0.06, 0.12, w.d + 0.06);
}

// Floors: kit rooms (planks or tiles by style), ship decks, piers, bridges and the ford.
function floor(ctx, r) {
  const { b, rnd } = ctx;
  const y = 0.07;
  if (r.floor === 'bridge' || r.floor === 'pier' || r.floor === 'ford') {
    if (r.floor === 'ford') {
      b.setColor(H(0x8a8478)); b.groundRect(r.x, r.z, r.w, r.d, 0.05);
      for (let i = 0; i < 14; i++) { b.setColor(scale(H(0x7a766c), 0.9 + rnd() * 0.2)); b.prismY(0, 0.25, r.x + rnd() * r.w, r.z + rnd() * r.d, 0.3 + rnd() * 0.3, 0.2, 6, rnd()); }
      return;
    }
    const plank = r.floor === 'pier';
    const along = r.floor === 'pier';             // Piers run north-south, bridges east-west.
    const L = along ? r.d : r.w;
    for (let s = 0; s < L; s += 0.6) {
      b.setColor(scale(plank ? H(0x7c6a52) : H(0x8a8680), 0.88 + rnd() * 0.18));
      if (along) b.groundRect(r.x, r.z + s, r.w, Math.min(0.6, L - s) - 0.05, 0.12);
      else b.groundRect(r.x + s, r.z, Math.min(0.6, L - s) - 0.05, r.d, 0.12);
    }
    // Rails along the open sides, posts every 2 m.
    b.setColor(H(0x4a4440));
    if (along) for (const x of [r.x, r.x + r.w - 0.12]) { box3(b, x, 0.12, r.z, 0.12, 0.9, 0.12); for (let s = 0; s < r.d; s += 2) box3(b, x, 0, r.z + s, 0.12, 1.0, 0.12); box3(b, x, 0.95, r.z, 0.12, 0.08, r.d); }
    else for (const z of [r.z, r.z + r.d - 0.12]) { for (let s = 0; s < r.w; s += 2) box3(b, r.x + s, -0.6, z, 0.14, 1.6, 0.14); box3(b, r.x, 0.95, z, r.w, 0.1, 0.12); }
    return;
  }
  if (r.floor === 'deck') { b.setColor(H(0x5a6068)); b.groundRect(r.x, r.z, r.w, r.d, 0.04); return; }
  const S = styleOf(r.floor);
  if (S.planks) {
    const along = r.w >= r.d, L = along ? r.w : r.d;
    for (let s = 0; s < L; s += 0.5) {
      b.setColor(Math.floor(s / 0.5) % 2 ? S.floor : S.floorB);
      if (along) b.groundRect(r.x + s, r.z, Math.min(0.5, L - s), r.d, y);
      else b.groundRect(r.x, r.z + s, r.w, Math.min(0.5, L - s), y);
    }
  } else {
    // Tiles: a two-tone check every 1.2 m.
    b.setColor(S.floor); b.groundRect(r.x, r.z, r.w, r.d, y);
    b.setColor(S.floorB);
    for (let z = r.z; z < r.z + r.d - 0.01; z += 1.2) for (let x = r.x + ((Math.round((z - r.z) / 1.2) % 2) ? 1.2 : 0); x < r.x + r.w - 0.01; x += 2.4) {
      b.groundRect(x, z, Math.min(1.2, r.x + r.w - x), Math.min(1.2, r.z + r.d - z), y + 0.005);
    }
  }
}

// Roofs by style. Everything lands in the roof builder with the building's footprint (see ROOF_VERT).
function roof(rb, r, ctx) {
  const S = styleOf(r.style);
  const kind = r.roof === 'gable' ? 'gable' : (STYLE[r.roof]?.roofKind ?? S.roofKind);
  const { x, z, w, d, h } = r;
  const o = 0.25;
  const rnd = ctx.rnd;
  if (kind === 'gable' || kind === 'hip' || kind === 'ridged') {
    const along = w >= d;                          // Ridge along the long side.
    const rise = kind === 'ridged' ? Math.min(w, d) * 0.12 : kind === 'hip' ? Math.min(w, d) * 0.55 : Math.min(w, d) * 0.38;
    const ov = kind === 'hip' ? 0.6 : o;
    const X0 = x - ov, X1 = x + w + ov, Z0 = z - ov, Z1 = z + d + ov, Y = h;
    const col = S.roof, colB = scale(S.roof, 0.82);
    if (along) {
      const zm = z + d / 2, inset = kind === 'hip' ? Math.min(w / 2 - 0.5, d * 0.5) : 0;
      rb.setColor(col); rb.quad([X0, Y, Z0], [X0 + inset, Y + rise, zm], [X1 - inset, Y + rise, zm], [X1, Y, Z0], [x + w / 2, -10, zm]);
      rb.setColor(colB); rb.quad([X0, Y, Z1], [X1, Y, Z1], [X1 - inset, Y + rise, zm], [X0 + inset, Y + rise, zm], [x + w / 2, -10, zm]);
      rb.setColor(scale(col, 0.9));
      rb.tri([X0, Y, Z0], [X0, Y, Z1], [X0 + inset, Y + rise, zm], [x + w / 2, Y, zm]);
      rb.tri([X1, Y, Z0], [X1 - inset, Y + rise, zm], [X1, Y, Z1], [x + w / 2, Y, zm]);
      if (kind === 'ridged') { rb.setColor(scale(col, 1.12)); for (let s = X0 + 1; s < X1 - 0.5; s += 2.2) rb.quad([s, Y + 0.02, Z0], [s, Y + rise + 0.02, zm], [s + 0.3, Y + rise + 0.02, zm], [s + 0.3, Y + 0.02, Z0], [s, -10, zm]); }
    } else {
      const xm = x + w / 2, inset = kind === 'hip' ? Math.min(d / 2 - 0.5, w * 0.5) : 0;
      rb.setColor(colB); rb.quad([X0, Y, Z0], [X0, Y, Z1], [xm, Y + rise, Z1 - inset], [xm, Y + rise, Z0 + inset], [xm, -10, z + d / 2]);
      rb.setColor(col); rb.quad([X1, Y, Z0], [xm, Y + rise, Z0 + inset], [xm, Y + rise, Z1 - inset], [X1, Y, Z1], [xm, -10, z + d / 2]);
      rb.setColor(scale(col, 0.9));
      rb.tri([X0, Y, Z0], [xm, Y + rise, Z0 + inset], [X1, Y, Z0], [xm, Y, z + d / 2]);
      rb.tri([X0, Y, Z1], [X1, Y, Z1], [xm, Y + rise, Z1 - inset], [xm, Y, z + d / 2]);
    }
    return;
  }
  // Flat roofs: a slab, a parapet where the style has one, roof clutter.
  rb.setColor(S.roof); box3(rb, x - 0.1, h, z - 0.1, w + 0.2, 0.22, d + 0.2);
  if (S.parapet || kind === 'stepped') {
    rb.setColor(scale(wallCol(S, r.id), 0.95));
    box3(rb, x - 0.1, h + 0.22, z - 0.1, w + 0.2, 0.45, 0.3); box3(rb, x - 0.1, h + 0.22, z + d - 0.2, w + 0.2, 0.45, 0.3);
    box3(rb, x - 0.1, h + 0.22, z + 0.2, 0.3, 0.45, d - 0.4); box3(rb, x + w - 0.2, h + 0.22, z + 0.2, 0.3, 0.45, d - 0.4);
  }
  if (kind === 'stepped') { rb.setColor(scale(S.roof, 0.9)); box3(rb, x + w * 0.2, h + 0.22, z + d * 0.2, w * 0.6, 0.8, d * 0.6); box3(rb, x + w * 0.35, h + 1.02, z + d * 0.35, w * 0.3, 0.7, d * 0.3); }
  if (S.snow) { rb.setColor(H(0xe4eaf2)); box3(rb, x + 0.2, h + 0.22, z + 0.2, w - 0.4, 0.12, d - 0.4); }
  if (kind === 'cab') {
    rb.setColor(H(0x3a4450)); box3(rb, x + 0.6, h + 0.22, z + 0.6, w - 1.2, 1.8, d - 1.2);
    emissive(rb, () => { rb.setColor(H(0x6a9ab0)); box3(rb, x + 0.55, h + 0.8, z + 0.55, w - 1.1, 0.8, d - 1.1); });
    rb.setColor(H(0x55585e)); box3(rb, x + 0.3, h + 2.02, z + 0.3, w - 0.6, 0.2, d - 0.6);
  }
  if (r.style === 'metro' || r.style === 'station' || r.style === 'industrial') {
    rb.setColor(H(0x8a8c90));
    const n = Math.max(1, Math.floor(w * d / 60));
    for (let k = 0; k < n; k++) box3(rb, x + 1 + rnd() * (w - 3), h + 0.22, z + 1 + rnd() * (d - 3), 1.2, 0.7, 0.9);
  }
}

// Radio mast: a tapered lattice-coloured spire with red bands and a beacon.
function mast(ctx, w) {
  const { b, glow } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  b.setColor(H(0x5a5c60)); box3(b, w.x, 0, w.z, w.w, 0.4, w.d);
  const n = 6;
  for (let k = 0; k < n; k++) {
    const y0 = (w.h / n) * k, y1 = (w.h / n) * (k + 1), r0 = (w.w / 2) * (1 - k / n * 0.7), r1 = (w.w / 2) * (1 - (k + 1) / n * 0.7);
    b.setColor(k % 2 ? H(0xc8c4bc) : H(0x9a3a30));
    b.prismY(y0, y1, cx, cz, r0, r1, 4, Math.PI / 4);
  }
  emissive(b, () => { b.setColor([1, 0.2, 0.15]); box3(b, cx - 0.15, w.h, cz - 0.15, 0.3, 0.3, 0.3); });
  glow.halo(cx, cz, 2.2, [0.12, 0.02, 0.01], w.h + 0.2);
}

// The edge of the world on land: a low run of rock, coloured by region.
function edge(ctx, w) {
  if (w.x >= 262 && w.z < 0) return;             // Sea edges stay open.
  if (w.x >= ctx.W && w.z < 176) return;
  const k = ROCK[w.region] || ROCK.farmland;
  const long = w.w > w.d;
  for (let s = 0; s < (long ? w.w : w.d) - 0.5; s += 8) {
    const L = Math.min(8, (long ? w.w : w.d) - s);
    if (long) mass(ctx, w.x + s, w.z, L, w.d, 2.2, { cols: k.cols, cap: k.cap, levels: 2 });
    else mass(ctx, w.x, w.z + s, w.w, L, 2.2, { cols: k.cols, cap: k.cap, levels: 2 });
  }
}

// Road paint: dashed centre lines on asphalt.
function paintRoads(ctx, x0, z0, x1, z1) {
  const { b, rnd } = ctx;
  const inT = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
  // The surface: 4 m pieces along each segment (each drawn by the tile holding its middle), a disc at each bend.
  for (const rd of ctx.roads) {
    const base = ROAD[rd.kind], y = rd.kind === 'asphalt' ? 0.045 : 0.035, hw = rd.w / 2;
    for (let k = 1; k < rd.pts.length; k++) {
      const [ax, az] = rd.pts[k - 1], [bx, bz] = rd.pts[k], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      const nx = -uz, nz = ux;
      for (let s = 0; s < L; s += 4) {
        const e = Math.min(L, s + 4), m = (s + e) / 2;
        if (!inT(ax + ux * m, az + uz * m)) continue;
        const px = ax + ux * s, pz = az + uz * s, qx = ax + ux * e, qz = az + uz * e;
        b.setColor(scale(base, 0.94 + rnd() * 0.1));
        b.quad([px + nx * hw, y, pz + nz * hw], [px - nx * hw, y, pz - nz * hw], [qx - nx * hw, y, qz - nz * hw], [qx + nx * hw, y, qz + nz * hw], [px, -5, pz]);
        if (rd.kind === 'asphalt') {
          b.setColor(H(0x8a8880));
          for (const sd of [hw - 0.3, -hw]) b.quad([px + nx * (sd + 0.3), y + 0.01, pz + nz * (sd + 0.3)], [px + nx * sd, y + 0.01, pz + nz * sd], [qx + nx * sd, y + 0.01, qz + nz * sd], [qx + nx * (sd + 0.3), y + 0.01, qz + nz * (sd + 0.3)], [px, -5, pz]);
        }
      }
      if (k < rd.pts.length - 1 && inT(bx, bz)) { b.setColor(base); b.prismY(0, y - 0.005, bx, bz, hw, hw, 12); }
    }
  }
  b.setColor(H(0xc8bc8a));
  for (const rd of ctx.roads) {
    if (rd.kind !== 'asphalt') continue;
    for (let k = 1; k < rd.pts.length; k++) {
      const [ax, az] = rd.pts[k - 1], [bx, bz] = rd.pts[k], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let s = 0; s < L; s += 4) {
        const px = ax + ux * s, pz = az + uz * s;
        if (px < x0 || px >= x1 || pz < z0 || pz >= z1 || blocked(ctx, px, pz)) continue;
        const ex = px + ux * 1.8, ez = pz + uz * 1.8, nx = -uz * 0.08, nz = ux * 0.08;
        b.quad([px + nx, 0.065, pz + nz], [px - nx, 0.065, pz - nz], [ex - nx, 0.065, ez - nz], [ex + nx, 0.065, ez + nz], [px, -5, pz]);
      }
    }
  }
}

// Rail lines: sleepers and two rails.
function rails(ctx, x0, z0, x1, z1) {
  const { b } = ctx;
  for (const r of ctx.rails) {
    const [[ax, az], [bx]] = r.pts;
    const s0 = Math.max(ax, x0), s1 = Math.min(bx, x1);
    if (s1 <= s0 || az < z0 || az >= z1) continue;
    b.setColor(H(0x5e5650)); b.groundRect(s0, az - 1.3, s1 - s0, 2.6, 0.04);
    b.setColor(H(0x3f3530));
    for (let x = Math.ceil(s0 / 0.9) * 0.9; x < s1; x += 0.9) if (!blocked(ctx, x, az)) box3(b, x, 0.04, az - 1.1, 0.24, 0.08, 2.2);
    b.setColor(H(0x8a909a));
    box3(b, s0, 0.12, az - 0.75, s1 - s0, 0.1, 0.1); box3(b, s0, 0.12, az + 0.65, s1 - s0, 0.1, 0.1);
  }
}

function blocked(ctx, x, z, m = 0.2) {
  for (const w of ctx.map.walls) if (w.kind !== 'border' && x > w.x - m && x < w.x + w.w + m && z > w.z - m && z < w.z + w.d + m) return true;
  return false;
}

// Small things on the ground, by region, and big scenery past the map edge.
function decor(ctx, t) {
  const { b, rnd, W, H: Hh } = ctx;
  const field = ctx.field;
  for (let k = 0; k < 34; k++) {
    const x = t.x0 + rnd() * TILE, z = t.z0 + rnd() * TILE;
    const out = x < -2 || z < -2 || x > W + 2 || z > Hh + 2;
    if (out ? x < -PAD || z < -PAD || x > W + PAD || z > Hh + PAD : blocked(ctx, x, z, 0.3)) continue;
    if (ctx.wet(x, z) || ctx.road(x, z)) continue;
    const reg = field(Math.max(1, Math.min(W - 1, x)), Math.max(1, Math.min(Hh - 1, z)))[0];
    if (out && (reg === 'coast' && (z < 0 || x > W))) continue;
    if (out && k % 3 === 0) { bigScenery(ctx, reg, x, z); continue; }
    const r = rnd();
    if (reg === 'arctic') { b.setColor(scale(H(0xe0e8f2), 0.95 + rnd() * 0.1)); b.prismY(0, 0.2 + rnd() * 0.25, x, z, 0.5 + rnd() * 0.6, 0.15, 5, rnd()); }
    else if (reg === 'desert' || reg === 'industrial' || reg === 'metro') { b.setColor(scale(reg === 'desert' ? H(0x8a7760) : H(0x6a6660), 0.8 + rnd() * 0.3)); b.prismY(0, 0.12 + rnd() * 0.18, x, z, 0.15 + rnd() * 0.25, 0.06, 5, rnd()); }
    else {
      const leaf = reg === 'jungle' ? H(0x4a6a2a) : reg === 'coast' ? H(0x8a9060) : H(0x6a7a44);
      b.setColor(r < 0.12 ? (reg === 'jungle' ? H(0xb04a5a) : H(0xc8b050)) : scale(leaf, 0.85 + rnd() * 0.3));
      for (let j = 0; j < 3; j++) { const a = rnd() * 6.28; b.tri([x, 0.02, z], [x + Math.cos(a) * 0.1, 0.02, z + Math.sin(a) * 0.1], [x + Math.cos(a + 0.4) * 0.35, 0.35 + rnd() * 0.3, z + Math.sin(a + 0.4) * 0.35]); }
    }
  }
}

function bigScenery(ctx, reg, x, z) {
  const { b, rnd } = ctx;
  if (reg === 'jungle' || reg === 'farmland' || reg === 'coast') {
    const h = 4 + rnd() * 3;
    b.setColor(H(0x4a3a2c)); b.prismY(0, h * 0.6, x, z, 0.3, 0.2, 5);
    b.setColor(reg === 'jungle' ? H(0x3e5a26) : H(0x56683a)); b.prismY(h * 0.45, h, x, z, 1.8 + rnd(), 0.4, 6, rnd());
  } else if (reg === 'arctic') {
    const h = 4 + rnd() * 3;
    b.setColor(H(0x3a4a3e)); b.prismY(0, h, x, z, 1.4, 0.05, 6, rnd());
    b.setColor(H(0xdce4ee)); b.prismY(h * 0.55, h * 0.85, x, z, 0.8, 0.2, 6, rnd());
  } else {
    const k = ROCK[reg] || ROCK.desert;
    mass(ctx, x - 2, z - 2, 4 + rnd() * 3, 4 + rnd() * 3, 2 + rnd() * 3, { cols: k.cols, cap: k.cap, levels: 2 });
  }
}
