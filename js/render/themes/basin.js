// Sirocco Basin (docs/DISTRICTS.md): the second region's palette and the pieces only the basin has, for the giant-world
// streamer in themes/frontier.js (which builds every tile; this module adds tables, a lights pass, zone patterns, the
// tile decor and the edge of the basin to it). Desert dusk under a rising sandstorm: the sun a smear of orange on the
// western dunes, violet overhead, everything hazed with blown sand; lanterns and windows coming on in the towns. Each
// district's pieces are still drawn by its own 6v6 drawers (skin 'sirocco', themes/sirocco.js).
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, mass } from './kit.js';

const H = hexRGB;
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));

THEMES.basin = {
  id: 'basin', giant: true,
  // The same dusk as the districts (themes/sirocco.js), a touch hazier: from the air the storm hangs over everything.
  light: { dir: norm([-0.86, 0.32, 0.22]), sun: [1.0, 0.6, 0.38], sky: [0.4, 0.32, 0.46], amb: [0.37, 0.28, 0.31] },
  clear: 0x34202c,
  fog: [0.52, 0.38, 0.33], fogSeam: [0.24, 0.1, 0.06], desatTint: [0.9, 0.76, 0.7],
  shadow: { col: [0.36, 0.24, 0.34], strength: 0.62, len: 1.7 },
  lamp: [0.36, 0.2, 0.08],
  water: { deep: [0.05, 0.1, 0.12], shallow: [0.14, 0.22, 0.22], glint: [1.0, 0.62, 0.36] },
  ink: ink({
    ground: 0x9a7a5c, asphalt: 0x4e4448, dirt: 0x8e6e52, gravel: 0x6e6058,
    roof: 0x8a5a40, wall: 0x9a6248, wallB: 0x86523c, trim: 0x4a2e24,
    concrete: 0x8e8478, crate: 0x8a6644, crateD: 0x56402c,
    rail: 0x7a7070, tie: 0x46362c, hazardY: 0x9a7030, hazardK: 0x34261e,
    paint: 0xc8a888, glow: 0xffc070, glowCool: 0xd0d8ec,
    rock: 0x9a5a3e, rockD: 0x7a4232, rockL: 0xb47452, adobe: 0xa86a4a, adobeD: 0x7e4a34,
    canvas: 0xc8a882, canvasB: 0x7a4e36, sandbag: 0x9a7a5a,
  }),
  containers: [0x7a4a32, 0x5a6a5e, 0x8a6a3a, 0x4a4a5e],
  weather: { fields: [
    { kind: 'streak', count: 200, box: [42, 3.4, 32], vel: [14, 0.2, 3], len: 3.2, width: 0.035, col: [0.96, 0.7, 0.48], alpha: 0.22 },
    { kind: 'mote', count: 150, box: [42, 7, 32], vel: [6, 0.2, 1.4], size: 0.12, col: [1.0, 0.76, 0.56], alpha: 0.32 },
    { kind: 'mote', count: 20, box: [48, 3.4, 36], vel: [7, 0.06, 1.6], size: 5, col: [0.86, 0.6, 0.46], alpha: 0.07 },
  ] },
};

export const thumb = { ground: '#94745a', solid: '#6e3e2e', low: '#a8845e', water: '#22403e', edge: '#2c1a22' };

// ---- Tables merged into the streamer's (themes/frontier.js) -----------------------------------------------------------

export const SKIN = { dunes: 'sirocco', scrub: 'sirocco', gulch: 'sirocco', saltpan: 'sirocco', spoil: 'sirocco' };
export const GROUND = {
  dunes: { a: H(0xa8845e), b: H(0x9a7656), c: H(0xb89470), amp: 0.22 },
  scrub: { a: H(0x8e7254), b: H(0x7e664c), c: H(0x9a7e5e), amp: 0.14 },
  gulch: { a: H(0x9a5e42), b: H(0x8a5038), c: H(0xa86c4c), amp: 0.16 },
  saltpan: { a: H(0xc8bcae), b: H(0xb8ac9c), c: H(0xd6ccc0), amp: 0.03 },
  spoil: { a: H(0x7a7060), b: H(0x6a6454), c: H(0x868070), amp: 0.12 },
};
export const ROCK = {
  dunes: { cols: [H(0xa86848), H(0x8a5038)], cap: H(0xb47a56) },
  scrub: { cols: [H(0x8e5a40), H(0x744634)], cap: H(0x9a6a4c) },
  gulch: { cols: [H(0x9a4a32), H(0x7a3a2a), H(0xb06a44)], cap: H(0xa85e40) },
  saltpan: { cols: [H(0xa8988a), H(0x8a7a6e)], cap: H(0xc8bcae) },
  spoil: { cols: [H(0x6e6656), H(0x5a5448)], cap: H(0x7a7262) },
};
export const BANK = {
  dunes: { face: H(0x6e5038), lip: H(0x9a7a58) }, scrub: { face: H(0x5a4a34), lip: H(0x6a6a3a) },
  gulch: { face: H(0x6a3a2a), lip: H(0x8a5a40) }, saltpan: { face: H(0x8a8070), lip: H(0xc8bcae) }, spoil: { face: H(0x5a5448), lip: H(0x7a7262) },
};
// Ground under the districts' own zones and the basin's places (keys of their own: the streamer's table is shared).
export const ZONE = {
  souk: H(0x9a826a), serai: H(0xa88e70), gulchsq: H(0x9a826a), ledge: H(0x9a6248), bench: H(0x6a6454), step: H(0x7a7060),
  pit: H(0x5e5a4a), pad: H(0x7e766c), compound: H(0x7a7268), forecourt: H(0x4e4448), saltpan: H(0xd8d0c4), slag: H(0x3e3632),
};
// The basin's buildings: red mud ksar houses, plastered mud brick, tin sheds, prefab huts, rock-cut tombs, the diner and
// the nomads' tents.
export const STYLE = {
  ksar: { wall: [0x9a5a3e, 0xa86848, 0x8a5038], trim: 0x4a2e24, roof: 0x7a4a34, floor: 0x7a5a40, floorB: 0x6a4c36, roofKind: 'flat', parapet: true },
  mudbrick: { wall: [0xc0a088, 0xb89478, 0xc8a890], trim: 0x5a3a2a, roof: 0x9a7a5e, floor: 0x8a6a4a, floorB: 0x7a5c40, roofKind: 'flat', parapet: true },
  tinshed: { wall: [0x8a8a84, 0x8a5a3e, 0x7a7a74], trim: 0x4a4a46, roof: 0x6a6a66, floor: 0x5e5a54, floorB: 0x56524c, roofKind: 'ridged' },
  prefab: { wall: [0xd4ccc4, 0xc8c0b8], trim: 0x5a6068, roof: 0x8a8a84, floor: 0x7a766e, floorB: 0x6e6a62, roofKind: 'flat' },
  tomb: { wall: [0x9a6a4c, 0x8a5a40], trim: 0x5a3a2a, roof: 0x9a5a3e, floor: 0x7a6650, floorB: 0x6e5a46, roofKind: 'stepped' },
  diner: { wall: [0xd8ccb8, 0xc8b8a0], trim: 0x9a2e2e, roof: 0x5a5458, floor: 0x9a8a7a, floorB: 0x2e6a66, roofKind: 'flat', parapet: true },
  tentcloth: { wall: [0x4a2e26, 0x5a3a2e], trim: 0x2e1e18, roof: 0x5a3a2e, floor: 0x9a3a2e, floorB: 0x8a5a2e, roofKind: 'hip', planks: true },
};

// ---- Ground patterns: paving, flagstones, salt crust, runway marks ------------------------------------------------

const stoneJit = (x, z) => ((Math.floor(x * 1.7) * 31 + Math.floor(z * 1.3) * 17) % 7) / 7;
export function zoneColour(zn, x, z, c) {
  const k = zn.kind;
  if (k === 'souk' || k === 'gulchsq') return (Math.floor(x / 1.2) + Math.floor(z / 1.2)) % 2 ? c : scale(c, 0.9);
  if (k === 'serai') return scale(c, 0.92 + stoneJit(x / 2, z / 2) * 0.12);
  if (k === 'saltpan') {
    const cx = Math.abs(((x * 0.37 + z * 0.11) % 3) - 1.5), cz = Math.abs(((z * 0.41 - x * 0.07) % 3) - 1.5);
    return Math.min(cx, cz) < 0.07 ? scale(c, 0.82) : c;
  }
  if (k === 'pit') return scale(c, 0.94 + (Math.floor(z / 2) % 2) * 0.08);
  if (k === 'runway') {
    const lx = x - zn.x, lz = z - zn.z, mid = zn.d / 2;
    if (Math.abs(lz - mid) < 0.2 && Math.floor(lx / 4) % 2 === 0) return H(0xd8ccb8);
    if ((lx < 8 || lx > zn.w - 8) && Math.floor(lz / 1.4) % 2 === 0 && lz > 1 && lz < zn.d - 1) return H(0xd8ccb8);
    return c;
  }
  if (k === 'forecourt') return (Math.floor(x / 3) + Math.floor(z / 3)) % 2 ? c : scale(c, 1.06);
  return c;
}

// ---- Lights: a lantern by every building's door side, the Highway's lamps ---------------------------------------------
// No randomness, so every tile agrees: each tile bakes the pools of the lanterns within reach of it into its ground.

const REACH = 7;
export function lampSpots(map) {
  if (map._lampSpots) return map._lampSpots;
  const out = [];
  for (const r of map.roofs ?? []) {
    if (r.w * r.d < 30) continue;
    out.push({ x: r.x + r.w / 2, z: r.z + r.d + 1.2, r: Math.min(6, 3 + r.w * 0.2), col: [0.34, 0.19, 0.07] });
  }
  for (const rd of map.roads ?? []) {
    if (rd.kind !== 'asphalt') continue;
    const [[ax, az], [bx, bz]] = [rd.pts[0], rd.pts[rd.pts.length - 1]], L = Math.hypot(bx - ax, bz - az);
    for (let s = 12; s < L - 6; s += 26) {
      const x = ax + (bx - ax) * s / L, z = az + (bz - az) * s / L + rd.w / 2 + 0.6;
      if (map.walls.some(w => w.kind !== 'border' && x > w.x - 0.6 && x < w.x + w.w + 0.6 && z > w.z - 0.6 && z < w.z + w.d + 0.6)) continue;
      out.push({ x, z, r: 7, col: [0.46, 0.28, 0.1], post: true });
    }
  }
  return (map._lampSpots = out);
}

export function lights(ctx, t, TILE) {
  for (const l of lampSpots(ctx.full)) {
    if (l.x < t.x0 - REACH || l.x > t.x0 + TILE + REACH || l.z < t.z0 - REACH || l.z > t.z0 + TILE + REACH) continue;
    ctx.lamps.push({ x: l.x, z: l.z, r: l.r, col: l.col });
  }
}

function lampPost(ctx, l) {
  const { b, glow } = ctx;
  b.setColor(H(0x2c2420));
  b.prismY(0, 4.4, l.x, l.z, 0.09, 0.07, 6);
  box3(b, l.x - 0.04, 4.3, l.z - 0.9, 0.08, 0.08, 0.9);
  emissive(b, () => { b.setColor([1.0, 0.64, 0.3]); box3(b, l.x - 0.18, 4.15, l.z - 1.0, 0.36, 0.12, 0.36); });
  glow.halo(l.x, l.z - 0.8, 3.4, scale([1.0, 0.6, 0.3], 0.13), 0.13);
}

// ---- Tile decor: lamp posts, scrub, stones, wind ripples in the sand ------------------------------------------------

export function decor(ctx, t, TILE) {
  const { b, rnd, full, W, H: Hh } = ctx;
  const x0 = t.x0, z0 = t.z0;
  for (const l of lampSpots(full)) if (l.post && l.x >= x0 && l.x < x0 + TILE && l.z >= z0 && l.z < z0 + TILE) lampPost(ctx, l);
  for (let k = 0; k < 30; k++) {
    const x = x0 + rnd() * TILE, z = z0 + rnd() * TILE;
    const out = x < -2 || z < -2 || x > W + 2 || z > Hh + 2;
    if (out ? x < -40 || z < -40 || x > W + 40 || z > Hh + 40 : ctx.blocked(x, z, 0.3)) continue;
    if (ctx.wet(x, z) || ctx.road(x, z)) continue;
    const reg = ctx.field(Math.max(1, Math.min(W - 1, x)), Math.max(1, Math.min(Hh - 1, z)))[0];
    if (out && k % 3 === 0) { const R = ROCK[reg] ?? ROCK.dunes; mass(ctx, x - 2, z - 2, 4 + rnd() * 3, 4 + rnd() * 3, 2 + rnd() * 3, { cols: R.cols, cap: R.cap, levels: 2 }); continue; }
    const r = rnd();
    if (reg === 'saltpan') { b.setColor(scale(H(0xe4dcd0), 0.95 + rnd() * 0.08)); b.prismY(0, 0.06 + rnd() * 0.08, x, z, 0.3 + rnd() * 0.4, 0.2, 5, rnd()); }
    else if (reg === 'dunes' && r < 0.5) {
      // A wind ripple: a long low crescent of lighter sand across the wind.
      b.setColor(scale(H(0xb89470), 0.96 + rnd() * 0.08));
      const len = 1.4 + rnd() * 1.6;
      b.quad([x, 0.03, z], [x + 0.25, 0.09, z + len * 0.5], [x, 0.03, z + len], [x - 0.2, 0.03, z + len * 0.5], [x, -5, z + len / 2]);
    } else if (r < 0.75) { b.setColor(scale(H(0x4a4a2a), 0.8 + rnd() * 0.4)); b.prismY(0, 0.3 + rnd() * 0.35, x, z, 0.35 + rnd() * 0.25, 0.06, 5, rnd() * 3); }
    else { b.setColor(scale(H(0x7a4a34), 0.8 + rnd() * 0.3)); b.prismY(0, 0.1 + rnd() * 0.16, x, z, 0.15 + rnd() * 0.22, 0.06, 5, rnd()); }
  }
}

// ---- The edge of the basin: the mountains that ring it, tall to the north and west (behind the camera's view), low
// red hills east and south so they never stand between the tilted camera and the ground ----------------------------

export function edge(ctx, w) {
  const { rnd } = ctx;
  const long = w.w > w.d;
  const out = long ? (w.z < 0 ? -1 : 1) : (w.x < 0 ? -1 : 1);
  const north = long && out < 0;
  const R = ROCK.gulch;
  for (let s = 0; s < (long ? w.w : w.d) - 0.5; s += 7 + rnd() * 3) {
    for (const [off, depth, h] of [[1, 5 + rnd() * 3, 2.4 + rnd() * 1.6], [8, 8 + rnd() * 6, north ? 9 + rnd() * 10 : 3 + rnd() * 2]]) {
      const len = 6 + rnd() * 4;
      const bx = long ? w.x + s : out < 0 ? w.x - off - depth : w.x + w.w + off;
      const bz = long ? (out < 0 ? w.z - off - depth : w.z + w.d + off) : w.z + s;
      mass(ctx, bx, bz, long ? len : depth, long ? depth : len, h, { cols: R.cols, cap: R.cap, levels: h > 6 ? 4 : 2 });
    }
  }
}

