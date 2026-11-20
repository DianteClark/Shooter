// Jadefall (docs/BR.md "Jadefall"): the island's palette and the pieces only it has, for the giant-world streamer in
// themes/frontier.js (which builds every tile; this module adds tables and drawers to it). Bright tropical morning:
// a high sun from the east, turquoise shallows over white sand, deep teal channels, warm stone ruins under a green
// canopy. Also the look of the Ground War maps cut from its coast (js/shared/maps/jadefall-gw.js), drawn the same way.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, mix, mass, WATER_Y } from './kit.js';
import { palm as coastPalm } from './coast.js';
import { inShallows } from '../../shared/geometry.js';

const H = hexRGB;
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));

THEMES.jadefall = {
  id: 'jadefall', giant: true,
  // Mid-morning: the sun high in the east-south-east, short shadows to the west, a bright sky.
  light: { dir: norm([0.52, 0.7, 0.46]), sun: [0.94, 0.84, 0.66], sky: [0.38, 0.46, 0.5], amb: [0.28, 0.31, 0.31] },
  clear: 0x1c3a40,
  fog: [0.42, 0.56, 0.56], fogSeam: [0.08, 0.16, 0.12], desatTint: [0.82, 0.9, 0.88],
  shadow: { col: [0.36, 0.48, 0.5], strength: 0.55, len: 0.8 },
  lamp: [0.22, 0.16, 0.06],
  water: { deep: [0.02, 0.17, 0.22], shallow: [0.07, 0.36, 0.4], glint: [0.9, 1.0, 0.92] },
  ink: ink({
    ground: 0x5f7a3a, asphalt: 0x56544e, dirt: 0x8a7656, gravel: 0x9a8e74,
    roof: 0x8a4a32, wall: 0xd8ccb0, wallB: 0xc4b89a, trim: 0x5a4632,
    concrete: 0xb0a890, crate: 0x9a7a4c, crateD: 0x5c4a30,
    rail: 0x7f8690, tie: 0x3f3530, hazardY: 0xa8873a, hazardK: 0x2a2620,
    paint: 0xe8e0c8, glow: 0xffdc9a, glowCool: 0xd4f0ff,
    rock: 0x8a8670, rockD: 0x6c6a58, rockL: 0xa8a48c,
    bark: 0x6a5440, leaf: 0x4e8a3a, leafD: 0x356a2c,
  }),
  containers: [0x2e7a7a, 0xb0563a, 0xd0a040, 0x3e6a9a, 0x5a8a4a],
  weather: { fields: [
    { kind: 'mote', count: 70, box: [42, 6, 32], vel: [-0.5, 0.1, 0.2], size: 0.08, col: [1.0, 0.95, 0.8], alpha: 0.4 },
    { kind: 'mote', count: 12, box: [48, 2.5, 36], vel: [-0.6, 0.02, 0.2], size: 4, col: [0.8, 0.92, 0.9], alpha: 0.05 },
    { kind: 'leaf', count: 18, box: [42, 7, 32], vel: [-0.9, -0.5, 0.3], size: 0.45, col: [0.46, 0.72, 0.3], alpha: 0.9 },
  ] },
};

export const thumb = { ground: '#5f7a3a', solid: '#c8bc9a', low: '#8a9a5a', water: '#0f4a56', edge: '#10241a' };

// ---- Tables merged into the streamer's (themes/frontier.js) -----------------------------------------------------------

export const SKIN = { ruins: 'jungle', beach: 'pier', mangrove: 'jungle', highland: 'jungle' };
export const GROUND = {
  ruins: { a: H(0x5e6e3a), b: H(0x6c7244), c: H(0x847c60), amp: 0.08 },
  beach: { a: H(0x74843e), b: H(0x82884a), c: H(0xb4a47a), amp: 0.06 },
  mangrove: { a: H(0x41542a), b: H(0x4c5628), c: H(0x564a32), amp: 0.08 },
  highland: { a: H(0x4e663c), b: H(0x5c6c4a), c: H(0x6c6c5e), amp: 0.16 },
};
export const ROCK = {
  ruins: { cols: [H(0x948e74), H(0x76705c)], cap: H(0x5a7a34) },
  beach: { cols: [H(0x8a8478), H(0x6a6660)], cap: H(0x9a9070) },
  mangrove: { cols: [H(0x5e5a4a), H(0x4a463a)], cap: H(0x4a6a2a) },
  highland: { cols: [H(0x7a7a72), H(0x5e5e58)], cap: H(0x5a7a3e) },
};
export const BANK = {
  ruins: { face: H(0x7a705a), lip: H(0x9a9278) }, beach: { face: H(0xc8b88a), lip: H(0xdccca0) },
  mangrove: { face: H(0x4e4030), lip: H(0x5a4a36) }, highland: { face: H(0x5c5a50), lip: H(0x7a786c) },
};
export const STYLE = {
  colonial: { wall: [0xe0d6c0, 0xd8c8a0, 0xc8d8d0, 0xe4c8b0], trim: 0x6a4a32, roof: 0xa8543a, floor: 0x9a7858, floorB: 0x8a684a, roofKind: 'hip' },
  market: { wall: [0xc8b890], trim: 0x5a4632, roof: 0x3e7a6a, floor: 0x9a8c74, floorB: 0x8a7c64, roofKind: 'ridged' },
  thatch: { wall: [0x8a6a44, 0x7a5c3a], trim: 0x4a3a2a, roof: 0xb09a5a, floor: 0x6a5238, floorB: 0x5e482e, roofKind: 'hip', planks: true },
  tin: { wall: [0x7a8a84, 0x8a7a64, 0x6a7a8a], trim: 0x4a4a46, roof: 0x8a8e88, floor: 0x6a6862, floorB: 0x625f5a, roofKind: 'ridged' },
};
export const ROAD = { stone: H(0xa49a80), sand: H(0xcabc90) };
export const ZONE = { lagoon: H(0xc8c0a0) };

const EARTH = H(0x4e4030), TURF = H(0x56682e);
const SAND = H(0xc4b48a), WETSAND = H(0x9a8e6a), SHOAL = H(0x7aa494), MUD = H(0x5a4a34);

// Ground colour on an island map: sand along every shore (from the map's land/water lattice), wet sand under the
// shallows. Returns null to leave the region's own colour.
export function shoreColour(map, x, z, c, noise) {
  const cells = map.cells;
  if (!cells) return null;
  if (inShallows(map, x, z)) return mix(WETSAND, SHOAL, 0.25 + noise(x * 0.2, z * 0.2) * 0.3);
  const n = cells.n, nz = cells.nz ?? n, S = cells.size, i = Math.floor(x / S), j = Math.floor(z / S);
  let wet = 9, bank = 9;
  const R = Math.round(6 / S);
  for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) {
    const ii = i + a, jj = j + b, d = Math.max(Math.abs(a), Math.abs(b));
    const v = cells.cls[Math.max(0, Math.min(nz - 1, jj)) * n + Math.max(0, Math.min(n - 1, ii))];   // Past the edge: as the edge.
    if (v === 0 || v === 1) wet = Math.min(wet, d);
    else if (v === 3) bank = Math.min(bank, d);
  }
  // Earth along a channel's bank, sand along a beach.
  if (bank <= 1 && wet > R) return mix(c, MUD, 0.55);
  if (wet > R) return null;
  const k = wet * S <= 3 ? 0.85 : 0.4 + noise(x * 0.3, z * 0.3) * 0.3;
  return mix(c, SAND, k);
}

// Heights: the floor of the shallows sits a little under the water sheet.
export const SHALLOW_FLOOR = -0.14;
export const SHEET_Y = 0.13;

// ---- The shallow-water sheet: one mesh over every shallow rect, semi-transparent, rippling ----------------------------
export const SHEET_VERT = /* glsl */`
uniform vec4 uFogXf;
attribute float aA;
varying float vA;
varying vec3 vW;
varying vec2 vFogUv;
void main() {
  vW = position;
  vA = aA;
  vFogUv = position.xz * uFogXf.xy + uFogXf.zw;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
export const SHEET_FRAG = /* glsl */`
uniform sampler2D uFogTex;
uniform float uFogOn, uTime;
uniform vec3 uCol, uGlint;
varying vec3 vW;
varying vec2 vFogUv;
varying float vA;
void main() {
  vec2 p = vW.xz;
  float a = sin(p.x * 1.1 + uTime * 0.8) + sin(p.y * 1.4 - uTime * 0.7) + sin((p.x - p.y) * 0.6 + uTime * 0.5);
  float c = sin(p.x * 2.6 - uTime * 1.4 + a) * sin(p.y * 3.1 + uTime * 1.2 - a);
  float v = texture2D(uFogTex, vFogUv).r;
  vec2 q = abs(vFogUv - 0.5);
  v = max(v, smoothstep(0.495, 0.505, max(q.x, q.y)) * 0.6);
  float vis = smoothstep(0.1, 0.9, mix(1.0, v, uFogOn));
  vec3 col = uCol * (0.92 + 0.08 * a) + uGlint * smoothstep(0.6, 1.0, c) * 0.35;
  col *= 0.45 + 0.55 * vis;
  gl_FragColor = vec4(col, vA);
}`;

// The sheet on the island's lattice: each corner's opacity from how much shallow water lies round it (a 4 x 4 cell
// blur), so the shoreline and the edge of the deep water read soft, not stepped. Built per streamed tile (sheetTile),
// so it is culled and dropped with the tile; runs of cells at full opacity along a row are one quad.
const SHEET_MEMO = new WeakMap();
function sheetField(map) {
  let f = SHEET_MEMO.get(map);
  if (f) return f;
  const cells = map.cells, n = cells.n, nz = cells.nz ?? n, cls = cells.cls;
  const sh = (i, j) => (i < 0 || j < 0 || i >= n || j >= nz ? 0 : cls[j * n + i] === 1 ? 1 : 0);
  const A = new Float32Array((n + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= n; i++) {
    let s = 0;
    for (let b = -2; b < 2; b++) for (let a = -2; a < 2; a++) s += sh(i + a, j + b) * (a === -2 || a === 1 || b === -2 || b === 1 ? 0.5 : 1);
    A[j * (n + 1) + i] = Math.round(0.55 * Math.max(0, Math.min(1, (s / 8 - 0.12) / 0.5)) * 100) / 100;
  }
  // Never over a causeway, pier or bridge: those stand clear of the water.
  const decks = (map.rooms ?? []).filter(r => r.floor === 'causeway' || r.floor === 'pier' || r.floor === 'bridge');
  const skip = new Uint8Array(n * nz);
  for (const r of decks) {
    for (let j = Math.floor(r.z / cells.size); j < Math.ceil((r.z + r.d) / cells.size); j++) for (let i = Math.floor(r.x / cells.size); i < Math.ceil((r.x + r.w) / cells.size); i++) {
      if (i >= 0 && j >= 0 && i < n && j < nz) skip[j * n + i] = 1;
    }
  }
  f = { A, skip };
  SHEET_MEMO.set(map, f);
  return f;
}
export function sheetTile(map, x0, z0, x1, z1) {
  const pos = [], alpha = [], y = SHEET_Y;
  if (!map.cells) return { pos, alpha };
  const { A, skip } = sheetField(map);
  const n = map.cells.n, nz = map.cells.nz ?? n, S = map.cells.size, n1 = n + 1;
  const i0 = Math.max(0, Math.floor(x0 / S)), i1 = Math.min(n, Math.ceil(x1 / S)), j0 = Math.max(0, Math.floor(z0 / S)), j1 = Math.min(nz, Math.ceil(z1 / S));
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1;) {
      const a = A[j * n1 + i], b = A[(j + 1) * n1 + i], c = A[(j + 1) * n1 + i + 1], d = A[j * n1 + i + 1];
      if (skip[j * n + i] || a + b + c + d < 0.01) { i++; continue; }
      // A run of cells whose corners all match this one's (flat opacity) becomes one quad.
      let k = i + 1;
      if (a === b && b === c && c === d) {
        while (k < i1 && !skip[j * n + k] && A[j * n1 + k + 1] === a && A[(j + 1) * n1 + k + 1] === a) k++;
      }
      const xa = i * S, xb = k * S, za = j * S, zb = za + S;
      const e = k > i + 1 ? a : d, f = k > i + 1 ? a : c;
      pos.push(xa, y, za, xa, y, zb, xb, y, zb, xa, y, za, xb, y, zb, xb, y, za);
      alpha.push(a, b, f, a, f, e);
      i = k;
    }
  }
  return { pos, alpha };
}

// ---- Coast banks on the island lattice ----------------------------------------------------------------------------------
// A deep-water rect's edges, walked a cell at a time: next to dry land a sandy slope (beach) or a steep earth bank
// (channels, the falls' pool); next to the shallows a sunken sand shelf; next to more deep water nothing.
export function islandBank(ctx, w, k) {
  const { b, rnd } = ctx;
  const map = ctx.full ?? ctx.map, cells = map.cells;
  const S = cells.size, n = cells.n, nz = cells.nz ?? n;
  const cls = (x, z) => {
    const i = Math.floor(x / S), j = Math.floor(z / S);
    return i < 0 || j < 0 || i >= n || j >= nz ? 0 : cells.cls[j * n + i];
  };
  const steep = !!w.channel;
  const under = map.underDecks ?? [];
  const decked = (x, z) => under.some(r => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d);
  const side = (x0, z0, x1, z1, ox, oz) => {
    const L = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.round(L / S));
    for (let s = 0; s < steps; s++) {
      const ax = x0 + (x1 - x0) * s / steps, az = z0 + (z1 - z0) * s / steps;
      const bx = x0 + (x1 - x0) * (s + 1) / steps, bz = z0 + (z1 - z0) * (s + 1) / steps;
      const mx = (ax + bx) / 2 + ox * 0.5, mz = (az + bz) / 2 + oz * 0.5;
      const c = cls(mx, mz);
      if (c === 0 || c === 3) continue;
      const shallow = c === 1;
      if (!shallow && decked(mx, mz)) continue;
      const top = shallow ? SHALLOW_FLOOR : 0.02, run = shallow ? 1.4 : steep ? 0.6 : 2.4;
      // The slope runs from the edge into the deep water.
      const ix = -ox * run, iz = -oz * run;
      b.setColor(shallow ? scale(WETSAND, 0.8) : steep ? EARTH : mix(SAND, k.face, 0.25));
      b.quad([ax, top, az], [bx, top, bz], [bx + ix, WATER_Y - 0.7, bz + iz], [ax + ix, WATER_Y - 0.7, az + iz], [(ax + bx) / 2 - ix, -3, (az + bz) / 2 - iz]);
      if (!shallow && steep) {
        // A lip of earth and roots along a channel's bank.
        b.setColor(scale(rnd() < 0.5 ? TURF : EARTH, 0.85 + rnd() * 0.25));
        const t = 0.35;
        if (oz) box3(b, Math.min(ax, bx), 0, oz < 0 ? az : az - t, Math.abs(bx - ax) - 0.05, 0.1 + rnd() * 0.08, t);
        else box3(b, ox < 0 ? ax : ax - t, 0, Math.min(az, bz), t, 0.1 + rnd() * 0.08, Math.abs(bz - az) - 0.05);
      }
    }
  };
  side(w.x, w.z, w.x + w.w, w.z, 0, -1);
  side(w.x + w.w, w.z, w.x + w.w, w.z + w.d, 1, 0);
  side(w.x, w.z + w.d, w.x + w.w, w.z + w.d, 0, 1);
  side(w.x, w.z, w.x, w.z + w.d, -1, 0);
}

// ---- Pieces only the island has ------------------------------------------------------------------------------------------
// Returns true when it drew the piece.
const STONE = H(0xa49a7a), STONED = H(0x847a60), MOSS = H(0x5a7a34), JADE = H(0x3ac08a), TERRA = H(0xa8543a);

export function islandPiece(ctx, w) {
  if (w.pyramid) return pyramid(ctx, w), true;
  if (w.stonehead) return stoneHead(ctx, w), true;
  if (w.falls) return falls(ctx, w), true;
  if (w.cliff) return cliff(ctx, w), true;
  if (w.belltower) return belltower(ctx, w), true;
  if (w.fortwall) return fortWall(ctx, w), true;
  if (w.bastion) return bastion(ctx, w), true;
  if (w.cannon) return cannon(ctx, w), true;
  if (w.altar) return altar(ctx, w), true;
  if (w.stall && w.skin === 'jungle') return stall(ctx, w), true;
  if (w.waterwheel) return waterwheel(ctx, w), true;
  if (w.palm && ctx.full?.cells) return beachPalm(ctx, w), true;
  return false;
}

// The Jade Pyramid: five stepped tiers of mossy stone, a stair up each face, a jade shrine glowing on top.
function pyramid(ctx, w) {
  const { b, glow, rnd } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2, tiers = 5, step = w.h / (tiers + 1);
  for (let t = 0; t < tiers; t++) {
    const inset = t * (w.w * 0.42) / tiers, y0 = t * step;
    b.setColor(t % 2 ? STONE : scale(STONE, 0.9));
    box3(b, w.x + inset, y0, w.z + inset, w.w - 2 * inset, step, w.d - 2 * inset);
    b.setColor(mix(MOSS, STONE, 0.3 + rnd() * 0.3));
    box3(b, w.x + inset - 0.05, y0 + step - 0.12, w.z + inset - 0.05, w.w - 2 * inset + 0.1, 0.14, w.d - 2 * inset + 0.1);
  }
  // Stairs: a darker band up the middle of each face.
  b.setColor(STONED);
  for (let t = 0; t < tiers; t++) {
    const inset = t * (w.w * 0.42) / tiers, y0 = t * step, sw = 3;
    box3(b, cx - sw / 2, y0, w.z + inset - 0.3, sw, step + 0.05, 0.6);
    box3(b, cx - sw / 2, y0, w.z + w.d - inset - 0.3, sw, step + 0.05, 0.6);
    box3(b, w.x + inset - 0.3, y0, cz - sw / 2, 0.6, step + 0.05, sw);
    box3(b, w.x + w.w - inset - 0.3, y0, cz - sw / 2, 0.6, step + 0.05, sw);
  }
  const top = tiers * step, s = w.w * 0.14;
  b.setColor(STONED); box3(b, cx - s, top, cz - s, 2 * s, step * 0.8, 2 * s);
  b.setColor(scale(STONE, 1.1)); box3(b, cx - s - 0.15, top + step * 0.8, cz - s - 0.15, 2 * s + 0.3, 0.2, 2 * s + 0.3);
  b.setColor(H(0x1e2a24)); box3(b, cx - 0.8, top, cz - s - 0.02, 1.6, step * 0.6, 0.1);
  emissive(b, () => { b.setColor(JADE); b.prismY(top + step * 0.8 + 0.2, top + step * 0.8 + 1.4, cx, cz, 0.55, 0.08, 6, 0.4); });
  glow.halo(cx, cz, 6, [0.04, 0.16, 0.1], top + step + 0.8, 14);
  glow.halo(cx, cz, 16, [0.02, 0.07, 0.05], 0.2, 16);
}

// A great carved head, half sunk in the ground, looking out to sea.
function stoneHead(ctx, w) {
  const { b } = ctx;
  const cx = w.x + w.w / 2;
  b.setColor(STONED); box3(b, w.x, 0, w.z, w.w, 0.6, w.d);
  b.setColor(STONE); box3(b, w.x + 0.6, 0.6, w.z + 0.5, w.w - 1.2, w.h - 1.6, w.d - 1);
  b.setColor(scale(STONE, 1.08)); box3(b, w.x + 0.9, w.h - 1.0, w.z + 0.8, w.w - 1.8, 1.0, w.d - 1.6);
  b.setColor(STONED);
  box3(b, cx - 0.4, w.h * 0.45, w.z + 0.2, 0.8, 1.6, 0.6);                   // Nose.
  box3(b, w.x + 1.6, w.h * 0.62, w.z + 0.35, 1.4, 0.5, 0.3);                // Brows.
  box3(b, w.x + w.w - 3, w.h * 0.62, w.z + 0.35, 1.4, 0.5, 0.3);
  box3(b, cx - 1.4, w.h * 0.25, w.z + 0.35, 2.8, 0.35, 0.3);                // Mouth.
  b.setColor(MOSS); box3(b, w.x + 0.8, w.h - 0.05, w.z + 0.8, w.w - 1.6, 0.12, w.d - 1.6);
}

// A cliff face: layered rock, greener on top.
function cliff(ctx, w) {
  const k = { cols: [H(0x6e6c62), H(0x5a5850)], cap: H(0x4e7a36) };
  mass(ctx, w.x, w.z, w.w, w.d, w.h, { ...k, levels: 4, taper: 0.12, jit: 0.12 });
}

// Cascade Falls: the cliff in the middle with a lit sheet of water down its south face and spray in the pool.
function falls(ctx, w) {
  const { b, glow } = ctx;
  cliff(ctx, w);
  const x0 = w.x + w.w * 0.3, x1 = w.x + w.w * 0.7, z = w.z + w.d + 0.15;
  emissive(b, () => {
    b.setColor([0.55, 0.78, 0.8]);
    b.quad([x0, WATER_Y, z + 0.4], [x1, WATER_Y, z + 0.4], [x1 - 0.2, w.h, z - 1.2], [x0 + 0.2, w.h, z - 1.2], [(x0 + x1) / 2, w.h / 2, z - 6]);
    b.setColor([0.82, 0.92, 0.92]);
    for (let k = 0; k < 5; k++) b.prismY(WATER_Y, 0.6, x0 + 0.3 + k * (x1 - x0 - 0.6) / 4, z + 1.2, 0.7, 0.25, 5, k);
    b.setColor([0.7, 0.86, 0.88]);
    for (let k = 0; k < 3; k++) box3(b, x0 + 0.4 + k * (x1 - x0 - 1) / 2, w.h * (0.3 + k * 0.2), z - 0.6, 0.2, w.h * 0.3, 0.2);
  });
  glow.halo((x0 + x1) / 2, z + 2, 5, [0.1, 0.14, 0.14], 0.25, 12);
}

// Port Coral's church tower: white, a red tile cap, an open belfry with its bell.
function belltower(ctx, w) {
  const { b, glow } = ctx;
  const white = H(0xe4dcc8);
  b.setColor(scale(white, 0.85)); box3(b, w.x - 0.1, 0, w.z - 0.1, w.w + 0.2, 0.5, w.d + 0.2);
  b.setColor(white); box3(b, w.x, 0.5, w.z, w.w, w.h - 3.4, w.d);
  b.setColor(H(0x6a4a32)); box3(b, w.x - 0.1, w.h - 3.0, w.z - 0.1, w.w + 0.2, 0.2, w.d + 0.2);
  // Belfry posts and the bell.
  b.setColor(white);
  for (const [px, pz] of [[0, 0], [w.w - 0.6, 0], [0, w.d - 0.6], [w.w - 0.6, w.d - 0.6]]) box3(b, w.x + px, w.h - 3.0, w.z + pz, 0.6, 2.2, 0.6);
  b.setColor(H(0xb08a3a)); b.prismY(w.h - 2.4, w.h - 1.2, w.x + w.w / 2, w.z + w.d / 2, 0.7, 0.35, 8);
  b.setColor(TERRA); b.prismY(w.h - 0.8, w.h + 1.4, w.x + w.w / 2, w.z + w.d / 2, w.w * 0.72, 0.1, 4, Math.PI / 4);
  b.setColor(white); box3(b, w.x - 0.1, w.h - 0.8, w.z - 0.1, w.w + 0.2, 0.25, w.d + 0.2);
  emissive(b, () => { b.setColor([1, 0.9, 0.6]); box3(b, w.x + w.w / 2 - 0.5, w.h * 0.55, w.z - 0.05, 1, 1.2, 0.1); });
  glow.halo(w.x + w.w / 2, w.z - 0.5, 2.5, [0.08, 0.06, 0.03], 0.2);
}

// Fort Sentinel's curtain walls: coursed stone with a walkway lip and crenels; bastions with a cannon embrasure.
function fortWall(ctx, w) {
  const { b, rnd } = ctx;
  const stone = H(0xb4a888), dark = H(0x8a8064);
  b.setColor(dark); box3(b, w.x - 0.1, 0, w.z - 0.1, w.w + 0.2, 0.5, w.d + 0.2);
  b.setColor(stone); box3(b, w.x, 0.5, w.z, w.w, w.h - 0.5, w.d);
  b.setColor(scale(stone, 1.08)); box3(b, w.x - 0.05, w.h - 0.15, w.z - 0.05, w.w + 0.1, 0.15, w.d + 0.1);
  const along = w.w >= w.d, L = along ? w.w : w.d;
  for (let s = 0.3; s < L - 0.8; s += 1.6) {
    b.setColor(scale(stone, 0.95 + rnd() * 0.1));
    if (along) box3(b, w.x + s, w.h, w.z, 0.8, 0.55, w.d); else box3(b, w.x, w.h, w.z + s, w.w, 0.55, 0.8);
  }
  b.setColor(MOSS);
  for (let s = 0; s < L; s += 3 + rnd() * 3) if (along) box3(b, w.x + s, 0.5, w.z - 0.06, 0.8 + rnd(), 0.3 + rnd() * 0.6, 0.06); else box3(b, w.x - 0.06, 0.5, w.z + s, 0.06, 0.3 + rnd() * 0.6, 0.8 + rnd());
}
function bastion(ctx, w) {
  const { b } = ctx;
  const stone = H(0xb4a888);
  b.setColor(H(0x8a8064)); box3(b, w.x - 0.2, 0, w.z - 0.2, w.w + 0.4, 0.6, w.d + 0.4);
  b.setColor(stone);
  b.loft([
    [[w.x, 0.6, w.z + w.d / 2], [w.x + w.w / 2, 0.6, w.z], [w.x + w.w, 0.6, w.z + w.d / 2], [w.x + w.w / 2, 0.6, w.z + w.d]].map(p => [p[0], p[1], p[2]]),
    [[w.x + 0.4, w.h, w.z + w.d / 2], [w.x + w.w / 2, w.h, w.z + 0.4], [w.x + w.w - 0.4, w.h, w.z + w.d / 2], [w.x + w.w / 2, w.h, w.z + w.d - 0.4]],
  ]);
  box3(b, w.x + 1.2, 0.6, w.z + 1.2, w.w - 2.4, w.h - 0.6, w.d - 2.4);
  b.setColor(H(0x3a3a36)); b.prismX(w.x + w.w / 2 - 0.2, w.x + w.w + 0.6, w.h + 0.25, w.z + w.d / 2, 0.22, 0.16, 6);
  b.setColor(H(0x6a3a2a)); box3(b, w.x + w.w / 2 - 1.2, w.h, w.z + w.d / 2 - 0.5, 1.2, 0.4, 1);
}
function cannon(ctx, w) {
  const { b } = ctx;
  const along = w.w >= w.d;
  b.setColor(H(0x6a4a2e)); box3(b, w.x + 0.2, 0, w.z + 0.15, w.w - 0.4, 0.45, w.d - 0.3);
  b.setColor(H(0x3a3a38));
  if (along) b.prismX(w.x, w.x + w.w, 0.7, w.z + w.d / 2, 0.32, 0.24, 7);
  else b.prismZ(w.z, w.z + w.d, w.x + w.w / 2, 0.7, 0.32, 0.24, 7);
  b.setColor(H(0x2a2a28));
  for (const o of [0.25, w.w - 0.65]) if (along) box3(b, w.x + o, 0, w.z - 0.05, 0.4, 0.55, w.d + 0.1);
}
// The altar in the Serpent Ruins: a carved block with a jade serpent coiled on it.
function altar(ctx, w) {
  const { b, glow } = ctx;
  b.setColor(STONED); box3(b, w.x, 0, w.z, w.w, w.h * 0.7, w.d);
  b.setColor(STONE); box3(b, w.x - 0.1, w.h * 0.7, w.z - 0.1, w.w + 0.2, w.h * 0.3, w.d + 0.2);
  emissive(b, () => {
    b.setColor(JADE);
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
    for (let k = 0; k < 7; k++) { const a = k * 0.9, r = 0.7 - k * 0.07; b.prismY(w.h, w.h + 0.18 + k * 0.05, cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0.16, 0.14, 5); }
  });
  glow.halo(w.x + w.w / 2, w.z + w.d / 2, 3.2, [0.03, 0.12, 0.07], w.h + 0.2);
}
// A market stall on the piers: posts, a striped awning, baskets.
function stall(ctx, w) {
  const { b, rnd } = ctx;
  const cols = [H(0xc04a3a), H(0xe0c060), H(0x3a8a8a)];
  b.setColor(H(0x6a5038));
  for (const [px, pz] of [[0, 0], [w.w - 0.15, 0], [0, w.d - 0.15], [w.w - 0.15, w.d - 0.15]]) box3(b, w.x + px, 0, w.z + pz, 0.15, w.h, 0.15);
  box3(b, w.x, 0.85, w.z, w.w, 0.12, w.d);
  b.setColor(H(0x7a5a3a)); box3(b, w.x + 0.15, 0, w.z + 0.15, w.w - 0.3, 0.85, w.d - 0.3);
  const c0 = cols[Math.floor(rnd() * 3)];
  for (let s = 0; s < w.w; s += 0.5) {
    b.setColor(Math.round(s / 0.5) % 2 ? c0 : H(0xe8e0d0));
    b.quad([w.x + s, w.h, w.z - 0.3], [w.x + Math.min(w.w, s + 0.5), w.h, w.z - 0.3], [w.x + Math.min(w.w, s + 0.5), w.h + 0.5, w.z + w.d / 2], [w.x + s, w.h + 0.5, w.z + w.d / 2], [w.x + s, -5, w.z]);
    b.quad([w.x + s, w.h + 0.5, w.z + w.d / 2], [w.x + Math.min(w.w, s + 0.5), w.h + 0.5, w.z + w.d / 2], [w.x + Math.min(w.w, s + 0.5), w.h, w.z + w.d + 0.3], [w.x + s, w.h, w.z + w.d + 0.3], [w.x + s, -5, w.z + w.d]);
  }
  for (let k = 0; k < 3; k++) { b.setColor(cols[k]); b.prismY(0.97, 1.25, w.x + 0.5 + k * (w.w - 1) / 2, w.z + w.d / 2, 0.3, 0.36, 6); }
}
// A water wheel on a timber frame by the falls' stream.
function waterwheel(ctx, w) {
  const { b } = ctx;
  b.setColor(H(0x5a4430)); box3(b, w.x, 0, w.z, w.w, 0.3, w.d);
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  b.prismZ(w.z, w.z + w.d, cx, 1.4, 1.4, 1.4, 10);
  b.setColor(H(0x7a5c3e));
  for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; box3(b, cx + Math.cos(a) * 1.3 - 0.2, 1.4 + Math.sin(a) * 1.3 - 0.2, w.z - 0.05, 0.4, 0.4, w.d + 0.1); }
}
// A coconut palm on the beach (the coast's palm, taller, its bed of sand).
function beachPalm(ctx, w) {
  const { b, rnd } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  // A ring of stones round the foot (what you bump into), the trunk rising out of it.
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rnd() * 0.3, r = w.w * 0.36;
    b.setColor(scale(H(0x8a8478), 0.85 + rnd() * 0.25));
    b.prismY(0, 0.35 + rnd() * 0.3, cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0.36, 0.22, 5, rnd());
  }
  coastPalm(ctx, cx, cz, 5 + rnd() * 2.5, 0.25 + rnd() * 0.2, 1.8);
}

// ---- Floors only the island has -----------------------------------------------------------------------------------------
export function islandFloor(ctx, r) {
  const { b, rnd } = ctx;
  if (r.floor === 'causeway') {
    // Big worn stone slabs, edged with a kerb, posts with lamps every 16 m.
    const along = r.d > r.w, L = along ? r.d : r.w;
    for (let s = 0; s < L - 0.01; s += 1.5) {
      for (let k = 0; k < 2; k++) {
        b.setColor(scale(STONE, 0.86 + rnd() * 0.2));
        const half = (along ? r.w : r.d) / 2;
        if (along) b.groundRect(r.x + k * half + 0.04, r.z + s + 0.04, half - 0.08, Math.min(1.5, L - s) - 0.08, 0.08);
        else b.groundRect(r.x + s + 0.04, r.z + k * half + 0.04, Math.min(1.5, L - s) - 0.08, half - 0.08, 0.08);
      }
    }
    b.setColor(STONED);
    if (along) { box3(b, r.x - 0.3, -0.5, r.z, 0.4, 0.75, r.d); box3(b, r.x + r.w - 0.1, -0.5, r.z, 0.4, 0.75, r.d); }
    else { box3(b, r.x, -0.5, r.z - 0.3, r.w, 0.75, 0.4); box3(b, r.x, -0.5, r.z + r.d - 0.1, r.w, 0.75, 0.4); }
    return true;
  }
  return false;
}
