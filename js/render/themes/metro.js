// Metro region: a rain-soaked city at night (theme 'metro': Night Market, Overpass, Downtown) and an underground
// station under fluorescent tubes (theme 'subway': Turnstile). Registers both palettes with art.js and exports what
// world.js's tables take: `dress` (wall drawers by kind, refined by the map's piece flags), `stage` (lights, ground,
// paint, decor) and the vote thumbnail styles.
//
// Rules this module keeps: nothing on the map stands much over 5 m (a tall wall hides the street behind it from the
// tilted camera), the El's deck is open steel and ties so a player under it stays visible, and sign colours stay clear
// of the two team hues.
import { THEMES, hexRGB } from '../art.js';
import {
  box3, emissive, scale, shop, stall, neonWall, tenement, building, container, crate, barrier, concreteWall,
} from '../world.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));

// Shared by both palettes: the dressers below read these keys.
const CITY_INK = {
  rail: 0x6a6878, tie: 0x24222c, hazardY: 0x9a7e30, hazardK: 0x1e1c26,
  paint: 0x8a8a94, glow: 0xffc27a, glowCool: 0xaad8ff,
  awningA: 0x7b4a5e, awningB: 0x4a6a72,
  road: 0x2a2c34, kerb: 0x5c5c64, slab: 0x4a4b54, paver: 0x544c4c, grass: 0x34442f, grassD: 0x2a3826, earth: 0x4a4036,
  lineY: 0xa08a3a, lineW: 0x9a9aa0, steel: 0x4c535c, steelD: 0x30353c, glass: 0x3c5466, glassL: 0x7a9ab0,
  brick: 0x5a3e3a, brickD: 0x46302e, stone: 0x6a6870, plywood: 0x8a7656, bus: 0xb08a2e, busD: 0x6a5420,
  taxi: 0xb89a32, carA: 0x5a6068, carB: 0x6a4a52, carC: 0x3e4e5a, leaf: 0x2e4a2c, leafD: 0x23391f, bark: 0x3e3228,
  tile: 0xb8b4a6, tileD: 0x8e8a7e, band: 0x2c7a62, bandD: 0x1e5444, silver: 0x9aa0a8, silverD: 0x6a7078, seat: 0x3e5a6e,
  ballast: 0x3a3634, poster: 0x8a6a52,
};

THEMES.metro = {
  id: 'metro',
  // Wet city night: a cold sky from the north-west, sodium streetlights and shop signs doing the rest.
  light: { dir: norm([-0.3, 0.78, 0.5]), sun: [0.34, 0.36, 0.54], sky: [0.28, 0.30, 0.48], amb: [0.25, 0.25, 0.37] },
  clear: 0x090b13,
  fog: [0.26, 0.28, 0.46], fogSeam: [0.12, 0.06, 0.22], desatTint: [0.74, 0.76, 0.92],
  shadow: { col: [0.30, 0.30, 0.46], strength: 0.5, len: 0.5 },
  lamp: [0.46, 0.28, 0.1],
  wet: 0.95, sheen: norm([0.0, 0.8, -0.6]), sheenCol: [0.42, 0.42, 0.7],
  groundAmp: 0.05,               // Paved city: nearly flat, so the wet sheen reads as puddles, not crumpled paper.
  water: { deep: [0.04, 0.06, 0.1], shallow: [0.08, 0.14, 0.2], glint: [0.6, 0.62, 0.9] },
  ink: ink({
    ground: 0x46464f, asphalt: 0x2e2e38, dirt: 0x3e3c44, gravel: 0x3d3b45,
    roof: 0x34343f, wall: 0x45424f, wallB: 0x4c4656, trim: 0x22212c,
    concrete: 0x5c5c6c, crate: 0x6b5a4a, crateD: 0x40362c,
    ...CITY_INK,
  }),
  containers: [0x4a4a68, 0x5a4a3a, 0x3a5a62],
  signs: [[1.0, 0.18, 0.62], [0.72, 0.3, 1.0], [0.2, 0.95, 0.72], [1.0, 0.66, 0.18], [0.62, 1.0, 0.34]],
  weather: { fields: [
    { kind: 'rain', count: 360, box: [36, 14, 28], vel: [-1.5, -18, 1.2], len: 0.8, width: 0.013, col: [0.76, 0.78, 1.0], alpha: 0.32 },
    { kind: 'ripple', count: 80, box: [34, 1, 26], life: 0.55, size: 0.6, col: [0.8, 0.78, 1.0], alpha: 0.3 },
    { kind: 'mote', count: 30, box: [40, 4, 30], vel: [-0.6, 0.2, 0.3], size: 2.6, col: [0.5, 0.52, 0.7], alpha: 0.05 },
  ] },
};

THEMES.subway = {
  id: 'subway',
  // Under the street: flat, cool fluorescent light from straight above, short soft shadows, dust in the air.
  light: { dir: norm([-0.15, 0.94, 0.3]), sun: [0.62, 0.64, 0.62], sky: [0.36, 0.38, 0.42], amb: [0.3, 0.31, 0.33] },
  clear: 0x07080a,
  fog: [0.3, 0.32, 0.36], fogSeam: [0.04, 0.14, 0.1], desatTint: [0.82, 0.86, 0.84],
  shadow: { col: [0.36, 0.38, 0.42], strength: 0.46, len: 0.25 },
  lamp: [0.26, 0.3, 0.3],
  wet: 0.35, sheen: norm([0.0, 0.9, -0.44]), sheenCol: [0.4, 0.46, 0.46],
  groundAmp: 0.02,
  ink: ink({
    ground: 0x6c6a64, asphalt: 0x58565a, dirt: 0x4a4644, gravel: 0x4c4a4a,
    roof: 0x4a4c52, wall: 0x6a6a66, wallB: 0x5e6262, trim: 0x2a2c30,
    concrete: 0x76767a, crate: 0x6b5a4a, crateD: 0x40362c,
    ...CITY_INK,
  }),
  containers: [0x4a5a6a],
  signs: [[0.2, 0.95, 0.72], [1.0, 0.66, 0.18], [0.72, 0.3, 1.0], [0.62, 1.0, 0.34]],
  weather: { fields: [
    { kind: 'mote', count: 120, box: [36, 4, 28], vel: [0.5, 0.06, 0.1], size: 0.08, col: [0.86, 0.92, 0.9], alpha: 0.4 },
    { kind: 'mote', count: 14, box: [40, 2.5, 30], vel: [0.9, 0.02, 0.1], size: 3.2, col: [0.6, 0.66, 0.64], alpha: 0.05 },
  ] },
};

export const thumb = { ground: '#3a3b44', solid: '#727790', low: '#535866', water: '#1c3448', edge: '#10121a' };
export const thumbSubway = { ground: '#6a6862', solid: '#a8a89a', low: '#4e7a6a', edge: '#16181c' };

// ---- Helpers ---------------------------------------------------------------------------------------------------

const zonesOf = map => map.zones || [];
function zoneAt(map, x, z) {
  let k = null;
  for (const r of zonesOf(map)) if (x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d) k = r.kind;
  return k;
}
const near = (map, x, z, p = 0.3) => map.walls.some(w => w.kind !== 'border' && x > w.x - p && x < w.x + w.w + p && z > w.z - p && z < w.z + w.d + p);

// A lamp: post, arm and head (emissive), a sodium pool baked into the ground and a streak on the wet road.
function streetLamp(ctx, x, z, armDir = 1) {
  const { b, glow, lamps } = ctx;
  const col = [1.0, 0.66, 0.3];
  b.setColor(0x2c3038);
  b.prismY(0, 4.2, x, z, 0.09, 0.07, 6);
  box3(b, x - 0.04, 4.1, armDir > 0 ? z : z - 1.0, 0.08, 0.08, 1.0);
  emissive(b, () => { b.setColor(col); box3(b, x - 0.16, 3.95, z + armDir * 0.95 - 0.2, 0.32, 0.12, 0.4); });
  lamps.push({ x, z: z + armDir, r: 7, col: [0.5, 0.3, 0.1] });
  glow.halo(x, z + armDir, 3.6, scale(col, 0.13), 0.13);
  glow.streak(x, z + armDir + 0.2, 0.9, 5.5, scale(col, 0.16), 0.12);
}

// ---- Lights ----------------------------------------------------------------------------------------------------

function lights(ctx) {
  const { map, theme, lamps, rnd } = ctx;
  // Neon shopfronts (the market's shophouses) keep the market's sign styles.
  ctx.shopStyle = new Map();
  for (const w of map.walls) {
    if (w.kind !== 'shop' || pieceOf(w)) continue;
    const signCol = theme.signs[Math.floor(rnd() * theme.signs.length)];
    const accent = theme.signs[Math.floor(rnd() * theme.signs.length)];
    ctx.shopStyle.set(w, { signCol, accent, phase: rnd() });
    lamps.push({ x: w.x + w.w / 2, z: w.z + w.d + 1.8, r: Math.min(w.w, 8) * 0.7, col: signCol.map(c => c * 0.34) });
  }
  if (map.underground) { stationLights(ctx); return; }
  // Streetlights down the kerbs of every road running east-west, staggered so pools alternate sides.
  const spots = [];
  for (const r of zonesOf(map)) {
    if (r.kind !== 'road' || r.w < r.d) continue;
    for (let x = r.x + 6, i = 0; x < r.x + r.w - 2; x += 13, i++) {
      const z = i % 2 ? r.z - 0.4 : r.z + r.d + 0.4, dir = i % 2 ? 1 : -1;
      if (x < 4 || x > map.width - 4 || z < 0.6 || z > map.height - 0.6 || near(map, x, z, 0.5)) continue;
      spots.push([x, z, dir]);
    }
  }
  // The market has no roads: lamps at the ends of its lanes, by the spawn streets.
  if (!zonesOf(map).length) for (const l of map.lanes) for (const x of [5.5, map.width - 5.5]) if (!near(map, x, l.z - 1.6, 0.5)) spots.push([x, l.z - 1.6, 1]);
  ctx.lampSpots = spots;
  for (const [x, z, dir] of spots) streetLamp(ctx, x, z, dir);
}

// Fluorescent tube rows over the halls and platforms, hung high enough to hide nobody.
function stationLights(ctx) {
  const { map, b, glow, lamps } = ctx;
  const col = [0.86, 0.96, 0.92];
  for (const r of zonesOf(map)) {
    if (r.kind !== 'hall' && r.kind !== 'platform') continue;
    const z = r.z + r.d / 2;
    for (let x = 4; x < map.width - 2; x += 6.5) {
      emissive(b, () => { b.setColor(col); box3(b, x - 0.9, 3.9, z - 0.06, 1.8, 0.06, 0.12); });
      b.setColor(0x30343a);
      box3(b, x - 0.95, 3.96, z - 0.1, 1.9, 0.05, 0.2);
      lamps.push({ x, z, r: 5.5, col: [0.16, 0.2, 0.19] });
      glow.halo(x, z, 2.6, [0.05, 0.07, 0.065], 0.12, 10);
    }
  }
}

// ---- Ground ----------------------------------------------------------------------------------------------------

function ground(ctx) {
  const { map, noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const inMap = (x, z) => x > 0 && x < W && z > 0 && z < H;
  const laneDist = z => { let d = 99; for (const l of map.lanes) d = Math.min(d, Math.abs(z - l.z)); return d; };
  const n = (x, z, k = 0.8) => 0.9 + noise(x * k, z * k) * 0.2 + (rnd() - 0.5) * 0.05;
  if (map.underground) {
    return p => {
      const [x, , z] = p;
      ctx.groundWet = 0.3;
      if (!inMap(x, z)) return scale(I.ballast, 0.55 + noise(x * 0.3, z * 0.3) * 0.15);
      const k = zoneAt(map, x, z);
      if (k === 'track') { ctx.groundWet = 0.1; return scale(I.ballast, n(x, z, 1.4)); }
      // Terrazzo: quiet, with only a faint grain, so the players and the yellow edge lines carry the picture.
      const g = 0.96 + noise(x * 0.6, z * 0.6) * 0.08 + (rnd() - 0.5) * 0.02;
      if (k === 'platform') return scale(I.tileD, 0.78 * g);
      return scale(I.ground, 0.92 * g);
    };
  }
  return p => {
    const [x, , z] = p;
    if (!inMap(x, z)) { ctx.groundWet = 0.5; return scale(z < 0 || z > H ? I.road : I.slab, 0.6 + noise(x * 0.2, z * 0.2) * 0.2); }
    const k = zoneAt(map, x, z);
    const puddle = noise(x * 0.42 + 11, z * 0.42) > 0.63;
    if (k === 'road' || k === 'lot') {
      ctx.groundWet = puddle ? 1 : 0.75;
      return scale(k === 'lot' ? I.asphalt : I.road, (puddle ? 0.7 : 1) * n(x, z));
    }
    if (k === 'park') {
      ctx.groundWet = 0.15;
      const path = Math.abs(z - map.height / 2) < 1.6 || Math.abs(x - map.width / 2) < 1.4;
      return scale(path ? I.paver : noise(x * 0.3, z * 0.3) > 0.55 ? I.grassD : I.grass, n(x, z));
    }
    if (k === 'site') { ctx.groundWet = 0.35; return scale(noise(x * 0.25 + 3, z * 0.25) > 0.5 ? I.earth : I.gravel, n(x, z)); }
    if (k === 'plaza') {
      ctx.groundWet = puddle ? 0.9 : 0.55;
      const chk = (Math.floor(x / 3) + Math.floor(z / 3)) % 2;
      return scale(chk ? I.paver : I.slab, n(x, z, 1));
    }
    if (!zonesOf(map).length) {
      // The market: dark pavers with a gutter down the middle of each alley.
      const gutter = (Math.abs(x - 2 - Math.round((x - 2) / 4) * 4) < 0.5 && laneDist(z) > 4) || laneDist(z) < 0.5;
      ctx.groundWet = puddle ? 1 : gutter ? 0.8 : 0.6;
      if (puddle) return scale(I.asphalt, 0.62);
      return scale(gutter ? I.gravel : I.ground, 0.8 + noise(x * 0.9, z * 0.9) * 0.28 + (rnd() - 0.5) * 0.06);
    }
    // Pavement: big concrete slabs.
    ctx.groundWet = puddle ? 0.9 : 0.5;
    const slab = (Math.floor(x / 2.4) + Math.floor(z / 2.4)) % 2;
    return scale(slab ? I.slab : I.ground, n(x, z));
  };
}

// ---- Flat paint ------------------------------------------------------------------------------------------------

function paint(ctx) {
  const { b, map, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const free = (x, z, w = 0.4, d = 0.4) => !near(map, x, z, 0.15) && !near(map, x + w, z + d, 0.15);
  const zones = zonesOf(map);
  // Roads: a dashed yellow centre line and white edge lines, with zebra crossings where two roads meet.
  for (const r of zones) {
    if (r.kind !== 'road') continue;
    const along = r.w >= r.d;
    const L = along ? r.w : r.d;
    for (let s = 1; s < L - 2; s += 3) {
      const [x, z] = along ? [r.x + s, r.z + r.d / 2 - 0.06] : [r.x + r.w / 2 - 0.06, r.z + s];
      if (!free(x, z, along ? 1.6 : 0.12, along ? 0.12 : 1.6) || crossing(zones, r, x, z)) continue;
      b.setColor(scale(I.lineY, 0.8 + rnd() * 0.15));
      b.groundRect(x, z, along ? 1.6 : 0.12, along ? 0.12 : 1.6, 0.06);
    }
    for (const e of [0.25, (along ? r.d : r.w) - 0.35]) {
      for (let s = 0; s < L; s += 1.2) {
        const [x, z] = along ? [r.x + s, r.z + e] : [r.x + e, r.z + s];
        if (!free(x, z, along ? 1.1 : 0.1, along ? 0.1 : 1.1) || crossing(zones, r, x, z) || rnd() < 0.12) continue;
        b.setColor(scale(I.lineW, 0.55 + rnd() * 0.15));
        b.groundRect(x, z, along ? 1.1 : 0.1, along ? 0.1 : 1.1, 0.05);
      }
    }
  }
  for (const r of zones) for (const q of zones) {
    if (r.kind !== 'road' || q.kind !== 'road' || r.w < r.d || q.w >= q.d) continue;
    const x0 = Math.max(r.x, q.x), x1 = Math.min(r.x + r.w, q.x + q.w), z0 = Math.max(r.z, q.z), z1 = Math.min(r.z + r.d, q.z + q.d);
    if (x1 <= x0 || z1 <= z0) continue;
    // Zebras across the cross street, just outside the junction on both sides.
    for (const zc of [z0 - 1.6, z1 + 0.2]) {
      for (let x = x0 + 0.3; x < x1 - 0.4; x += 0.8) {
        if (!free(x, zc, 0.45, 1.4)) continue;
        b.setColor(scale(I.lineW, 0.7));
        b.groundRect(x, zc, 0.45, 1.4, 0.06);
      }
    }
  }
  // Parking bays.
  for (const r of zones) {
    if (r.kind !== 'lot') continue;
    for (let x = r.x + 0.6; x < r.x + r.w; x += 4) {
      for (const z of [r.z + 1, r.z + r.d - 5.5]) if (free(x, z, 0.1, 4.5)) { b.setColor(scale(I.lineW, 0.6)); b.groundRect(x, z, 0.1, 4.5, 0.05); }
    }
  }
  // The station: a yellow safety line and tactile strip along each platform edge, rails and sleepers on the track.
  for (const r of zones) {
    if (r.kind !== 'track') continue;
    for (const ez of [r.z - 0.75, r.z + r.d + 0.45]) {
      for (let x = 0.4; x < W; x += 1) if (free(x, ez, 0.9, 0.3)) { b.setColor(scale(I.hazardY, 1.15)); b.groundRect(x, ez, 0.9, 0.3, 0.05); }
    }
    for (let x = -12; x < W + 12; x += 0.7) { b.setColor(scale(I.tie, 1.4)); b.groundRect(x, r.z + 0.5, 0.28, r.d - 1, 0.04); }
    b.setColor(I.silver);
    for (const rz of [r.z + 0.85, r.z + r.d - 0.95]) box3(b, -12, 0.04, rz, W + 24, 0.1, 0.1);
  }
  // The market's zebra crossings.
  for (const [cx, cz] of map.crossings || []) {
    for (let k = -1.7; k <= 1.7; k += 0.68) {
      if (near(map, cx + k, cz, 0.2)) continue;
      b.setColor(scale(I.paint, 0.55));
      b.groundRect(cx + k - 0.2, cz - 0.7, 0.4, 1.4, 0.1);
    }
  }
  // Manholes and drains, and fine cracks so the wet paving has grain under the reflections.
  for (let i = 0; i < W * H / (map.large ? 140 : 60); i++) {
    const x = 2 + rnd() * (W - 4), z = 2 + rnd() * (H - 4);
    if (!free(x, z, 0.9, 0.9)) continue;
    if (i % 5 === 0) { b.setColor(scale(I.steelD, 0.9)); b.prismY(0.02, 0.07, x, z, 0.45, 0.45, 8); continue; }
    b.setColor(scale(I.hazardK, 1.2));
    b.groundRect(x, z, 0.5 + rnd() * 1.6, 0.05, 0.08);
  }
}

// True when (x,z) lies in another road crossing road r: centre lines stop at junctions.
function crossing(zones, r, x, z) {
  return zones.some(q => q !== r && q.kind === 'road' && x >= q.x - 0.5 && x <= q.x + q.w + 0.5 && z >= q.z - 0.5 && z <= q.z + q.d + 0.5);
}

// ---- Pieces ----------------------------------------------------------------------------------------------------

// The renderer-side identity of a wall: the first piece flag it carries.
const PIECES = ['tower', 'store', 'tile', 'column', 'stairs', 'car', 'turnstile', 'bench', 'vending', 'ticket', 'kiosk', 'buffer',
  'newsstand', 'metro', 'booth', 'el', 'bus', 'jersey', 'planter', 'shelter', 'hoarding', 'statue', 'frame', 'materials',
  'pallet', 'tree', 'hedge', 'towerCrane', 'fountain'];
function pieceOf(w) { for (const k of PIECES) if (w[k]) return k; return null; }

// City block: brick or render with lit window bands, a storefront on the camera-facing side and a cluttered roof.
function tower(ctx, w) {
  const { b, sb, glow, rnd, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const body = [I.brick, I.wall, I.wallB, I.stone][Math.floor(rnd() * 4)];
  b.setColor(body);
  box3(b, x, 0, z, bw, h, bd);
  // Cornice and roof deck.
  b.setColor(I.trim);
  box3(b, x - 0.08, h - 0.3, z - 0.08, bw + 0.16, 0.3, bd + 0.16);
  b.setColor(scale(I.roof, 1.05));
  box3(b, x + 0.25, h, z + 0.25, bw - 0.5, 0.05, bd - 0.5);
  // Roof clutter: AC units, a water tank on bigger blocks, a stair hut.
  b.setColor(0x4a4c58);
  for (let i = 0; i < Math.max(1, Math.floor(bw * bd / 30)); i++) {
    box3(b, x + 0.8 + rnd() * (bw - 2.4), h, z + 0.8 + rnd() * (bd - 2.2), 1.1, 0.5, 0.8, 0.04);
  }
  if (bw * bd > 70) {
    b.setColor(0x3e3630);
    const tx = x + bw * (0.25 + rnd() * 0.5), tz = z + bd * 0.4;
    for (const [lx, lz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) b.prismY(h, h + 0.7, tx + lx, tz + lz, 0.05, 0.05, 4);
    b.setColor(0x5a4636);
    b.prismY(h + 0.7, h + 1.8, tx, tz, 0.8, 0.8, 8);
    b.prismY(h + 1.8, h + 2.1, tx, tz, 0.8, 0.1, 8);
  }
  // Windows on the south face, upper floor: some lit warm, some cool, some dark.
  const fz = z + bd + 0.02;
  emissive(b, () => {
    for (let wx = x + 0.6; wx < x + bw - 1; wx += 1.5) {
      const r = rnd();
      b.setColor(r < 0.35 ? scale(I.glow, 0.6) : r < 0.5 ? scale(I.glowCool, 0.45) : scale(I.glass, 0.7));
      box3(b, wx, h * 0.62, fz, 0.8, Math.min(1, h * 0.22), 0.03);
    }
  });
  // Storefront: lit glass, an awning and a sign band.
  if (bw >= 3.5) {
    const sw = Math.min(bw - 1, 6), sx = x + (bw - sw) / 2;
    emissive(b, () => { b.setColor(scale(I.glow, 0.5)); box3(b, sx, 0.3, fz, sw, 1.5, 0.03); });
    b.setColor(I.trim);
    for (let mx = sx; mx <= sx + sw + 0.01; mx += sw / 3) box3(b, mx - 0.05, 0.3, fz, 0.1, 1.5, 0.05);
    const col = theme.signs[Math.floor(rnd() * theme.signs.length)];
    b.setColor(scale(col, 0.3));
    b.quad([sx, 2.05, fz], [sx + sw, 2.05, fz], [sx + sw, 1.9, fz + 0.7], [sx, 1.9, fz + 0.7]);
    sb.setPart(rnd());
    sb.setColor(scale(col, 0.2));
    box3(sb, sx + 0.3, 2.3, fz, sw - 0.6, 0.55, 0.03);
    sb.setColor(col);
    const nch = Math.max(2, Math.floor((sw - 0.8) / 0.55));
    for (let i = 0; i < nch; i++) box3(sb, sx + 0.45 + i * (sw - 0.9) / nch, 2.38, fz + 0.012, (sw - 0.9) / nch - 0.1, 0.38, 0.025);
    glow.halo(sx + sw / 2, fz + 1.1, Math.min(sw * 0.5, 3), scale(col, 0.12), 0.13);
    glow.streak(sx + sw / 2, fz + 0.3, 1.2, 4, scale(col, 0.12), 0.12);
  }
  // Fire escape on the east face of deep blocks.
  if (bd > 6) {
    b.setColor(0x2a2c32);
    for (let y = 1.6; y < h - 0.4; y += 1.3) box3(b, x + bw, y, z + bd * 0.3, 0.45, 0.05, bd * 0.4);
    box3(b, x + bw + 0.4, 1.6, z + bd * 0.3, 0.05, h - 2, 0.05);
  }
}

// Shopfront strip along the map edge: low, its sign facing the street.
function store(ctx, w) {
  tower(ctx, w);
}

// Station wall: cream tile with a coloured band, adverts and the station's name in lit panels.
function tileWall(ctx, w) {
  const { b, sb, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.tile);
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(I.band);
  box3(b, x - 0.02, h * 0.55, z - 0.02, bw + 0.04, 0.32, bd + 0.04);
  b.setColor(I.tileD);
  box3(b, x - 0.03, 0, z - 0.03, bw + 0.06, 0.25, bd + 0.06);
  b.setColor(scale(I.tile, 1.12));
  box3(b, x - 0.06, h - 0.1, z - 0.06, bw + 0.12, 0.12, bd + 0.12);
  if (bw > 3) {
    // Posters on both long faces, the name board on the south one.
    for (const fz of [z - 0.02, z + bd + 0.01]) {
      for (let px = x + 0.8; px < x + bw - 1.6; px += 3.2) {
        b.setColor(scale(I.poster, 0.8 + rnd() * 0.5));
        box3(b, px, 0.7, fz, 1.2, 1.1, 0.02);
      }
    }
    sb.setPart(0.2);
    sb.setColor(scale(I.band, 0.9));
    box3(sb, x + bw / 2 - 1.2, h * 0.55 + 0.4, z + bd + 0.02, 2.4, 0.4, 0.03);
    sb.setColor([0.9, 0.96, 0.92]);
    for (let i = 0; i < 6; i++) box3(sb, x + bw / 2 - 1.05 + i * 0.36, h * 0.55 + 0.48, z + bd + 0.04, 0.26, 0.24, 0.02);
  }
}

function column(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.tile);
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(I.band);
  box3(b, x - 0.02, h * 0.55, z - 0.02, bw + 0.04, 0.3, bd + 0.04);
  b.setColor(I.tileD);
  box3(b, x - 0.03, 0, z - 0.03, bw + 0.06, 0.3, bd + 0.06);
}

// Escalator housing: steel sides with the steps on top, running down toward the platform.
function stairs(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.steel);
  box3(b, x, 0, z, bw, h * 0.4, bd);
  b.setColor(I.steelD);
  const n = Math.floor(bw / 0.35);
  for (let i = 0; i < n; i++) box3(b, x + i * (bw / n), h * 0.4, z + 0.15, bw / n - 0.04, (h * 0.6 * (n - i)) / n, bd - 0.3);
  b.setColor(I.silver);
  box3(b, x, h * 0.4, z, bw, 0.1, 0.15);
  box3(b, x, h * 0.4, z + bd - 0.15, bw, 0.1, 0.15);
  b.setColor(scale(I.glass, 1.2));
  box3(b, x, h - 0.1, z, 0.12, 0.1, bd);
}

// Subway car side panel: brushed steel, a coloured stripe and a window band.
function carPanel(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.silver);
  box3(b, x, 0.35, z, bw, h - 0.35, bd);
  b.setColor(I.silverD);
  box3(b, x, 0, z + 0.05, bw, 0.35, bd - 0.1);
  b.setColor(I.band);
  box3(b, x - 0.01, 0.9, z - 0.02, bw + 0.02, 0.25, bd + 0.04);
  b.setColor(scale(I.glass, 0.9));
  if (bw > bd) for (const fz of [z - 0.02, z + bd]) box3(b, x + 0.15, 1.5, fz, bw - 0.3, 0.8, 0.02);
  b.setColor(I.silverD);
  box3(b, x - 0.02, h - 0.12, z - 0.04, bw + 0.04, 0.12, bd + 0.08);
}

// Car interiors: floor, bench seats along the walls, grab poles, a roof rim (no roof: the camera sees in), lights.
function trains(ctx) {
  const { b, map, theme, glow, lamps } = ctx;
  const I = theme.ink;
  for (const t of map.trains || []) {
    b.setColor(scale(I.steelD, 1.1));
    box3(b, t.x, 0, t.z + 0.3, t.w, 0.34, t.d - 0.6);
    b.setColor(I.seat);
    for (const sz of [t.z + 0.3, t.z + t.d - 0.75]) {
      for (let s = t.x + 0.4; s < t.x + t.w - 1.2; s += 4.4) {
        // Seats sit between the doors: skip the door bays.
        box3(b, s + 0.3, 0.34, sz, 1.6, 0.42, 0.45);
      }
    }
    b.setColor(I.silver);
    for (let px = t.x + 2; px < t.x + t.w - 1; px += 3) b.prismY(0.34, 2.9, px, t.z + t.d / 2, 0.035, 0.035, 4);
    b.setColor(I.silverD);
    box3(b, t.x, 2.95, t.z, t.w, 0.06, 0.35);
    box3(b, t.x, 2.95, t.z + t.d - 0.35, t.w, 0.06, 0.35);
    for (let rx = t.x; rx <= t.x + t.w + 0.01; rx += t.w / 4) box3(b, rx - 0.06, 2.95, t.z, 0.12, 0.06, t.d);
    emissive(b, () => { b.setColor([0.86, 0.94, 0.9]); box3(b, t.x + 0.6, 2.9, t.z + t.d / 2 - 0.05, t.w - 1.2, 0.04, 0.1); });
    lamps.push({ x: t.x + t.w / 2, z: t.z + t.d / 2, r: 5, col: [0.14, 0.17, 0.16] });
    // End walls of the shut car carry a destination board; open ends get headlights at the train's ends.
    if (!t.closed) {
      const end = t.x < map.width / 2 ? t.x : t.x + t.w;
      emissive(b, () => { b.setColor([1.0, 0.95, 0.8]); for (const hz of [t.z + 0.6, t.z + t.d - 0.8]) box3(b, end - 0.05, 1.0, hz, 0.1, 0.2, 0.2); });
      glow.halo(end + (end === t.x ? -1.2 : 1.2), t.z + t.d / 2, 2.2, [0.12, 0.11, 0.08], 0.12, 10);
    }
  }
}

function turnstile(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  for (let s = 0; s < bd - 0.2; s += 0.75) {
    b.setColor(I.steel);
    box3(b, x + 0.1, 0, z + s + 0.05, bw - 0.2, h, Math.min(0.28, bd - s - 0.05));
    b.setColor(I.silver);
    box3(b, x + 0.12, h, z + s + 0.06, bw - 0.24, 0.04, Math.min(0.26, bd - s - 0.07));
    emissive(b, () => { b.setColor([0.3, 1.0, 0.6]); box3(b, x + bw / 2 - 0.05, h + 0.04, z + s + 0.1, 0.1, 0.02, 0.1); });
  }
  b.setColor(I.silverD);
  box3(b, x + bw / 2 - 0.03, h * 0.6, z, 0.06, 0.06, bd);
}

function bench(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.steelD);
  const long = bw >= bd;
  for (const t of [0.2, 0.8]) {
    if (long) box3(b, x + bw * t - 0.05, 0, z + 0.05, 0.1, h * 0.5, bd - 0.1);
    else box3(b, x + 0.05, 0, z + bd * t - 0.05, bw - 0.1, h * 0.5, 0.1);
  }
  b.setColor(I.crate);
  box3(b, x, h * 0.5, z, bw, 0.08, bd);
  b.setColor(scale(I.crate, 0.85));
  if (long) box3(b, x, h * 0.5, z + bd - 0.12, bw, h * 0.5, 0.1);
  else box3(b, x + bw - 0.12, h * 0.5, z, 0.1, h * 0.5, bd);
}

// Lit box kiosks: vending machines, the ticket office, newsstands, the pay booth.
function kiosk(ctx, w) {
  const { b, sb, glow, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const piece = pieceOf(w);
  const col = theme.signs[Math.floor(rnd() * theme.signs.length)];
  const body = piece === 'vending' ? scale(col, 0.35) : piece === 'ticket' ? I.tile : I.steel;
  b.setColor(body);
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(I.trim);
  box3(b, x - 0.06, h, z - 0.06, bw + 0.12, 0.14, bd + 0.12);
  const fz = z + bd + 0.02;
  if (piece === 'vending') {
    emissive(b, () => { b.setColor(scale(col, 0.85)); box3(b, x + 0.12, 0.9, fz, bw * 0.6, 1.0, 0.02); });
    glow.halo(x + bw / 2, fz + 0.6, 1.4, scale(col, 0.1), 0.12, 10);
    return;
  }
  // Glazed counter windows on all four sides, a sign board on the roof.
  emissive(b, () => {
    b.setColor(scale(I.glow, 0.55));
    box3(b, x + 0.2, 1.0, fz, bw - 0.4, 0.8, 0.02);
    box3(b, x + 0.2, 1.0, z - 0.04, bw - 0.4, 0.8, 0.02);
    if (bd > 1.4) { box3(b, x - 0.04, 1.0, z + 0.2, 0.02, 0.8, bd - 0.4); box3(b, x + bw + 0.02, 1.0, z + 0.2, 0.02, 0.8, bd - 0.4); }
  });
  sb.setPart(rnd());
  sb.setColor(piece === 'ticket' ? scale(I.band, 1.4) : col);
  box3(sb, x + 0.2, h + 0.14, z + bd / 2 - 0.05, bw - 0.4, 0.4, 0.1);
  glow.halo(x + bw / 2, fz + 0.8, Math.max(bw, 2) * 0.7, scale(I.glow, 0.07), 0.12, 10);
}

// Subway entrance: a low glazed canopy over the stairs, a lit roundel on a post at each front corner.
function metroEntrance(ctx, w) {
  const { b, sb, glow, theme, lamps } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.steelD);
  box3(b, x, 0, z, bw, 1.1, bd);
  b.setColor(I.tileD);
  // The stair well: steps falling away to the north inside the parapet.
  const n = 7;
  for (let i = 0; i < n; i++) box3(b, x + 0.4, 1.1 - (i + 1) * 0.14, z + 0.4 + i * ((bd - 1.6) / n), bw - 0.8, 0.02, (bd - 1.6) / n);
  b.setColor(I.band);
  box3(b, x - 0.04, 0.85, z - 0.04, bw + 0.08, 0.2, bd + 0.08);
  // Canopy frame, glass roof raised on four posts.
  b.setColor(I.steel);
  for (const [px, pz] of [[x + 0.15, z + 0.15], [x + bw - 0.15, z + 0.15], [x + 0.15, z + bd - 0.15], [x + bw - 0.15, z + bd - 0.15]]) b.prismY(1.1, h, px, pz, 0.07, 0.07, 6);
  b.setColor(scale(I.glassL, 0.8));
  b.quad([x, h + 0.25, z], [x + bw, h + 0.25, z], [x + bw, h, z + bd], [x, h, z + bd]);
  b.setColor(I.steelD);
  box3(b, x - 0.05, h - 0.05, z + bd - 0.1, bw + 0.1, 0.12, 0.12);
  for (const px of [x - 0.4, x + bw + 0.4]) {
    b.setColor(I.steelD);
    b.prismY(0, 2.6, px, z + bd + 0.2, 0.06, 0.06, 6);
    sb.setPart(0.1);
    sb.setColor([0.2, 0.95, 0.72]);
    sb.prismZ(z + bd + 0.14, z + bd + 0.26, px, 2.9, 0.34, 0.34, 10);
    sb.setColor([0.95, 0.98, 0.96]);
    box3(sb, px - 0.28, 2.84, z + bd + 0.27, 0.56, 0.12, 0.02);
  }
  lamps.push({ x: x + bw / 2, z: z + bd + 1, r: 6, col: [0.08, 0.2, 0.16] });
  glow.halo(x + bw / 2, z + bd + 1.2, 3.4, [0.03, 0.1, 0.08], 0.13);
}

// El column: riveted steel post with a knee brace, painted the old dark green.
function elColumn(ctx, w) {
  const { b } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(0x34443e);
  box3(b, x + 0.1, 0, z + 0.1, bw - 0.2, h, bd - 0.2);
  b.setColor(0x2a3632);
  box3(b, x, 0, z, bw, 0.35, bd);
  box3(b, x, h - 0.4, z, bw, 0.4, bd);
  for (let y = 0.8; y < h - 0.6; y += 0.9) box3(b, x + 0.06, y, z + 0.06, bw - 0.12, 0.06, bd - 0.12);
}

// The El's deck: two side girders on the columns, cross beams, open ties and two pairs of rails. Mostly air from
// above, so it never hides who is underneath.
function elevated(ctx) {
  const { b, map, W, glow, lamps } = ctx;
  const el = map.el;
  if (!el) return;
  const y = el.y;
  // Side girders as open trusses: a thin top and bottom chord and slim posts, so the band they draw across the
  // screen is mostly see-through.
  for (const gz of [el.z0 - 0.15, el.z1 - 0.15]) {
    b.setColor(0x34443e);
    box3(b, -14, y - 0.16, gz, W + 28, 0.16, 0.3);
    box3(b, -14, y - 1.0, gz, W + 28, 0.12, 0.3);
    b.setColor(0x2a3632);
    for (let x = -14; x < W + 14; x += 2) box3(b, x, y - 0.9, gz + 0.1, 0.08, 0.76, 0.1);
  }
  b.setColor(0x34443e);
  for (let x = -12; x < W + 12; x += 6) box3(b, x, y - 0.32, el.z0, 0.2, 0.16, el.z1 - el.z0);
  b.setColor(0x3a302a);
  for (let x = -14; x < W + 14; x += 1.5) box3(b, x, y, el.z0 + 0.3, 0.12, 0.08, el.z1 - el.z0 - 0.6);
  b.setColor(0x8a9098);
  for (const rz of [el.z0 + 1.6, el.z0 + 3.0, el.z1 - 3.0, el.z1 - 1.6]) box3(b, -14, y + 0.08, rz, W + 28, 0.08, 0.06);
  // Signal lamps on the girders.
  for (let x = 8; x < W; x += 24) {
    emissive(b, () => { b.setColor([1.0, 0.7, 0.3]); box3(b, x, y - 0.6, el.z1 + 0.16, 0.25, 0.25, 0.06); });
    glow.halo(x, el.z1 + 1.6, 3.4, [0.12, 0.07, 0.02], 0.13, 10);
    lamps.push({ x, z: el.z1 + 1.2, r: 6, col: [0.3, 0.18, 0.06] });
  }
}

function bus(ctx, w) {
  const { b, theme, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.bus);
  box3(b, x, 0.45, z, bw, h - 0.45, bd, 0.1);
  b.setColor(I.busD);
  box3(b, x + 0.05, 0, z + 0.05, bw - 0.1, 0.5, bd - 0.1);
  b.setColor(scale(I.glass, 0.8));
  box3(b, x + 0.3, h * 0.55, z - 0.02, bw - 0.6, h * 0.3, bd + 0.04);
  b.setColor(I.steel);
  box3(b, x + 0.2, h, z + 0.2, bw - 0.4, 0.06, bd - 0.4);
  b.setColor(0x4a4c52);
  box3(b, x + bw * 0.55, h, z + 0.6, 1.4, 0.3, bd - 1.2);
  b.setColor(0x1c1c20);
  for (const wx of [x + 1.4, x + bw - 1.8]) for (const wz of [z - 0.06, z + bd - 0.2]) b.prismZ(wz, wz + 0.26, wx, 0.45, 0.45, 0.45, 8);
  emissive(b, () => { b.setColor([1.0, 0.95, 0.8]); for (const hz of [z + 0.3, z + bd - 0.5]) box3(b, x + bw, 0.8, hz, 0.04, 0.2, 0.2); });
  glow.streak(x + bw + 0.5, z + bd / 2, 1.6, 4, [0.08, 0.075, 0.06], 0.12);
}

// Sedan or taxi: low body, a glass cabin, wheels.
function car(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  const along = cw >= cd;
  const r = rnd();
  const paint = r < 0.25 ? I.taxi : [I.carA, I.carB, I.carC][Math.floor(rnd() * 3)];
  b.setColor(0x16161a);
  const wheel = (wx, wz) => (along ? b.prismZ(wz, wz + 0.22, wx, 0.32, 0.32, 0.32, 8) : b.prismX(wx, wx + 0.22, 0.32, wz, 0.32, 0.32, 8));
  if (along) for (const wx of [x + 0.8, x + cw - 0.8]) { wheel(wx, z - 0.02); wheel(wx, z + cd - 0.2); }
  else for (const wz of [z + 0.8, z + cd - 0.8]) { wheel(x - 0.02, wz); wheel(x + cw - 0.2, wz); }
  b.setColor(paint);
  box3(b, x + 0.05, 0.3, z + 0.05, cw - 0.1, 0.55, cd - 0.1, 0.08);
  const L = along ? cw : cd;
  b.setColor(scale(I.glass, 0.85));
  if (along) box3(b, x + L * 0.28, 0.85, z + 0.18, L * 0.44, 0.45, cd - 0.36, 0.06);
  else box3(b, x + 0.18, 0.85, z + L * 0.28, cw - 0.36, 0.45, L * 0.44, 0.06);
  b.setColor(paint);
  if (along) box3(b, x + L * 0.3, 1.28, z + 0.22, L * 0.4, 0.08, cd - 0.44);
  else box3(b, x + 0.22, 1.28, z + L * 0.3, cw - 0.44, 0.08, L * 0.4);
  if (paint === I.taxi) {
    emissive(b, () => { b.setColor([1.0, 0.86, 0.4]); if (along) box3(b, x + cw / 2 - 0.25, 1.36, z + cd / 2 - 0.1, 0.5, 0.12, 0.2); else box3(b, x + cw / 2 - 0.1, 1.36, z + cd / 2 - 0.25, 0.2, 0.12, 0.5); });
  }
}

function jersey(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd;
  b.setColor(I.concrete);
  if (long) b.loft([[[x, 0, z], [x, 0, z + bd], [x, h, z + bd * 0.7], [x, h, z + bd * 0.3]], [[x + bw, 0, z], [x + bw, 0, z + bd], [x + bw, h, z + bd * 0.7], [x + bw, h, z + bd * 0.3]]]);
  else b.loft([[[x, 0, z], [x + bw * 0.3, h, z], [x + bw * 0.7, h, z], [x + bw, 0, z]], [[x, 0, z + bd], [x + bw * 0.3, h, z + bd], [x + bw * 0.7, h, z + bd], [x + bw, 0, z + bd]]]);
  b.setColor(I.hazardY);
  for (let s = 0.2; s < (long ? bw : bd) - 0.3; s += 1.2) {
    if (long) box3(b, x + s, h * 0.6, z - 0.01, 0.5, 0.12, bd + 0.02);
    else box3(b, x - 0.01, h * 0.6, z + s, bw + 0.02, 0.12, 0.5);
  }
}

function planter(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.stone);
  box3(b, x, 0, z, bw, h * 0.75, bd);
  b.setColor(I.earth);
  box3(b, x + 0.1, h * 0.75, z + 0.1, bw - 0.2, 0.02, bd - 0.2);
  for (let i = 0; i < Math.max(2, Math.floor(bw * bd)); i++) {
    b.setColor(rnd() < 0.5 ? I.leaf : I.leafD);
    b.prismY(h * 0.7, h + 0.25 + rnd() * 0.3, x + 0.35 + rnd() * (bw - 0.7), z + 0.35 + rnd() * (bd - 0.7), 0.32, 0.1, 5, rnd() * 3);
  }
}

// Bus shelter: steel frame, glass back and sides (low kind: you see and shoot through it), a lit advert.
function shelter(ctx, w) {
  const { b, sb, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.steelD);
  for (const [px, pz] of [[x + 0.1, z + 0.1], [x + bw - 0.1, z + 0.1], [x + 0.1, z + bd - 0.1], [x + bw - 0.1, z + bd - 0.1]]) b.prismY(0, h, px, pz, 0.05, 0.05, 4);
  b.setColor(scale(I.glassL, 0.7));
  box3(b, x + 0.1, 0.25, z + 0.06, bw - 0.2, h - 0.4, 0.03);
  box3(b, x + 0.06, 0.25, z + 0.1, 0.03, h - 0.4, bd - 0.2);
  b.setColor(I.steel);
  box3(b, x - 0.05, h, z - 0.05, bw + 0.1, 0.08, bd + 0.1);
  b.setColor(I.crate);
  box3(b, x + 0.4, 0.42, z + 0.15, bw - 0.8, 0.06, 0.38);
  sb.setPart(0.6);
  sb.setColor([0.9, 0.86, 0.7]);
  box3(sb, x + bw - 0.12, 0.5, z + 0.2, 0.04, 1.3, bd - 0.4);
}

// Plywood hoarding round the building site, painted and postered, with a lamp on top every few metres.
function hoarding(ctx, w) {
  const { b, theme, rnd, sb } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.plywood);
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(scale(I.plywood, 0.75));
  const long = bw >= bd, L = long ? bw : bd;
  for (let s = 1.2; s < L; s += 1.22) {
    if (long) box3(b, x + s, 0, z - 0.02, 0.05, h, bd + 0.04);
    else box3(b, x - 0.02, 0, z + s, bw + 0.04, h, 0.05);
  }
  for (let s = 0.4; s < L - 1.4; s += 2.7) {
    b.setColor(scale(I.poster, 0.7 + rnd() * 0.6));
    if (long) box3(b, x + s, 0.6, z + bd + 0.01, 1.1, 1.4, 0.02);
    else box3(b, x + bw + 0.01, 0.6, z + s, 0.02, 1.4, 1.1);
  }
  sb.setPart(0.8);
  sb.setColor([1.0, 0.5, 0.15]);
  for (let s = 0.5; s < L; s += 4) {
    if (long) box3(sb, x + s, h, z + bd / 2 - 0.08, 0.16, 0.16, 0.16);
    else box3(sb, x + bw / 2 - 0.08, h, z + s, 0.16, 0.16, 0.16);
  }
}

function statue(ctx, w) {
  const { b, theme, lamps, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.stone);
  box3(b, x, 0, z, bw, 0.3, bd);
  box3(b, x + 0.2, 0.3, z + 0.2, bw - 0.4, h * 0.45, bd - 0.4);
  b.setColor(0x3e5a52);
  const cx = x + bw / 2, cz = z + bd / 2, y0 = 0.3 + h * 0.45;
  b.prismY(y0, y0 + 1.1, cx, cz, 0.35, 0.28, 6);
  b.prismY(y0 + 1.1, y0 + 1.5, cx, cz, 0.18, 0.16, 6);
  box3(b, cx - 0.06, y0 + 1.0, cz - 0.6, 0.12, 0.12, 0.6);
  box3(b, cx - 0.06, y0 + 1.0, cz - 0.6, 0.12, 0.7, 0.12);
  lamps.push({ x: cx, z: cz + bd, r: 5, col: [0.2, 0.2, 0.26] });
  glow.halo(cx, cz + 1, 2.6, [0.06, 0.06, 0.08], 0.12, 10);
}

function frame(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(scale(I.concrete, 1.15));
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(0x6e4634);
  for (const [rx, rz] of [[0.2, 0.2], [bw - 0.25, 0.2], [0.2, bd - 0.25], [bw - 0.25, bd - 0.25]]) box3(b, x + rx, h, z + rz, 0.05, 0.7, 0.05);
}

function materials(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  // Banded stacks of blocks and timber under a tarp corner.
  const long = bw >= bd;
  const L = long ? bw : bd, T = long ? bd : bw;
  for (let y = 0; y < h - 0.1; y += 0.55) {
    b.setColor(rnd() < 0.5 ? I.plywood : scale(I.concrete, 1.2));
    if (long) box3(b, x + 0.05, y, z + 0.05, L - 0.1, 0.5, T - 0.1, 0.03);
    else box3(b, x + 0.05, y, z + 0.05, T - 0.1, 0.5, L - 0.1, 0.03);
  }
  b.setColor(0x2f5a7a);
  b.quad([x - 0.02, h + 0.02, z - 0.02], [x + bw * 0.6, h + 0.02, z - 0.02], [x + bw * 0.6, h * 0.4, z + bd + 0.02], [x - 0.02, h * 0.4, z + bd + 0.02]);
}

// Tower crane: the base and the first mast sections only. The mast is open lattice; the jib is off the top of the
// picture, so nothing big hangs over the play.
function towerCrane(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.concrete);
  box3(b, x - 0.2, 0, z - 0.2, bw + 0.4, 0.5, bd + 0.4);
  b.setColor(0xb08a2e);
  const top = h + 6;
  for (const [cx, cz] of [[x + 0.15, z + 0.15], [x + bw - 0.15, z + 0.15], [x + 0.15, z + bd - 0.15], [x + bw - 0.15, z + bd - 0.15]]) b.prismY(0.5, top, cx, cz, 0.08, 0.08, 4);
  for (let y = 1.2; y < top; y += 1.4) {
    box3(b, x, y, z, bw, 0.08, 0.08);
    box3(b, x, y, z + bd - 0.08, bw, 0.08, 0.08);
    box3(b, x, y, z, 0.08, 0.08, bd);
    box3(b, x + bw - 0.08, y, z, 0.08, 0.08, bd);
  }
  emissive(b, () => { b.setColor([1.0, 0.25, 0.15]); box3(b, x + bw / 2 - 0.1, top, z + bd / 2 - 0.1, 0.2, 0.2, 0.2); });
}

function tree(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const cx = x + bw / 2, cz = z + bd / 2;
  b.setColor(I.stone);
  box3(b, x, 0, z, bw, 0.25, bd);
  b.setColor(I.bark);
  b.prismY(0, h * 0.6, cx, cz, 0.2, 0.14, 6);
  // A small canopy: it sits above the trunk's footprint mostly, so it hides little.
  b.setColor(rnd() < 0.5 ? I.leaf : I.leafD);
  b.prismY(h * 0.5, h * 0.82, cx, cz, 0.95, 1.05, 7, rnd() * 3);
  b.setColor(scale(I.leaf, 1.15));
  b.prismY(h * 0.82, h, cx, cz, 1.05, 0.4, 7, rnd() * 3);
}

function hedge(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.leafD);
  box3(b, x, 0, z, bw, h * 0.85, bd, 0.08);
  b.setColor(I.leaf);
  const long = bw >= bd, L = long ? bw : bd;
  for (let s = 0.3; s < L - 0.2; s += 0.6) {
    if (long) b.prismY(h * 0.7, h, x + s, z + bd / 2, bd * 0.55, bd * 0.3, 5, rnd() * 3);
    else b.prismY(h * 0.7, h, x + bw / 2, z + s, bw * 0.55, bw * 0.3, 5, rnd() * 3);
  }
}

function buffer(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(0x6a2a24);
  box3(b, x, 0, z, bw, h * 0.7, bd);
  b.setColor(I.hazardY);
  box3(b, x + bw - 0.1, h * 0.35, z + 0.1, 0.14, h * 0.35, bd - 0.2);
  b.setColor(I.steelD);
  for (const bz of [z + 0.4, z + bd - 0.6]) b.prismX(x + bw, x + bw + 0.3, h * 0.55, bz + 0.1, 0.16, 0.16, 8);
  emissive(b, () => { b.setColor([1.0, 0.2, 0.15]); box3(b, x + bw / 2 - 0.1, h * 0.7, z + bd / 2 - 0.1, 0.2, 0.2, 0.2); });
}

// Fountain basin rim: a stone ring standing round the water.
function fountain(ctx, w) {
  const { b, theme, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd } = w;
  b.setColor(I.stone);
  box3(b, x - 0.35, 0, z - 0.35, bw + 0.7, 0.5, 0.35);
  box3(b, x - 0.35, 0, z + bd, bw + 0.7, 0.5, 0.35);
  box3(b, x - 0.35, 0, z, 0.35, 0.5, bd);
  box3(b, x + bw, 0, z, 0.35, 0.5, bd);
  // The basin's inner walls, down to below the water line.
  b.setColor(scale(I.stone, 0.7));
  box3(b, x, -1.3, z, bw, 1.3, 0.04);
  box3(b, x, -1.3, z + bd - 0.04, bw, 1.3, 0.04);
  box3(b, x, -1.3, z, 0.04, 1.3, bd);
  box3(b, x + bw - 0.04, -1.3, z, 0.04, 1.3, bd);
  b.setColor(scale(I.stone, 1.15));
  b.prismY(-0.6, 1.2, x + bw / 2, z + bd / 2, 0.45, 0.3, 8);
  b.prismY(1.2, 1.35, x + bw / 2, z + bd / 2, 0.8, 0.8, 8);
  glow.halo(x + bw / 2, z + bd / 2, 3.2, [0.04, 0.08, 0.1], 0.1, 12);
}

// The station's outer walls: tall tile with adverts and the tunnel mouths at each end of the track.
function stationBorder(ctx, w) {
  const { b, theme, map } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd } = w;
  const h = 4.2;
  const track = zonesOf(map).find(r => r.kind === 'track');
  const endWall = bd > bw;
  if (endWall && track) {
    // Leave the tunnel mouth open: wall above and either side of the track.
    b.setColor(I.tile);
    box3(b, x, 0, z, bw, h, track.z - z);
    box3(b, x, 0, track.z + track.d, bw, h, z + bd - track.z - track.d);
    box3(b, x, 3.2, track.z, bw, h - 3.2, track.d);
    b.setColor(0x050506);
    box3(b, x < 0 ? x - 6 : x + bw, 0, track.z, 6, 3.2, track.d);
    b.setColor(I.hazardY);
    box3(b, x + (x < 0 ? bw - 0.05 : 0), 3.0, track.z, 0.08, 0.2, track.d);
  } else {
    b.setColor(I.tile);
    box3(b, x, 0, z, bw, h, bd);
  }
  b.setColor(I.band);
  box3(b, x - 0.02, 2.2, z - 0.02, bw + 0.04, 0.35, bd + 0.04);
  b.setColor(I.tileD);
  box3(b, x - 0.03, 0, z - 0.03, bw + 0.06, 0.3, bd + 0.06);
  // Rock and darkness behind the wall, so the edge of the view is not the clear colour.
  b.setColor(0x15151a);
  box3(b, x < 0 ? x - 12 : x + bw, 0, z < 0 ? z - 12 : z + bd, endWall ? 12 : bw, h + 0.4, endWall ? bd : 12);
  if (!endWall) {
    const fz = z < 0 ? z + bd + 0.01 : z - 0.03;
    for (let px = 2; px < bw - 3; px += 5.5) {
      b.setColor(scale(I.poster, 0.8 + ((px * 7) % 5) / 10));
      box3(b, x + px, 0.8, fz, 2.4, 1.3, 0.02);
    }
  }
}

function cityBorder(ctx, w) {
  if (ctx.map.underground) stationBorder(ctx, w);
  else tenement(ctx, w);
}

// ---- Dress table -----------------------------------------------------------------------------------------------

const BY_PIECE = {
  tower, store, tile: tileWall, column, stairs, car: (c, w) => (w.kind === 'container' ? carPanel(c, w) : car(c, w)),
  turnstile, bench, vending: kiosk, ticket: kiosk, kiosk, newsstand: kiosk, booth: kiosk, metro: metroEntrance,
  buffer, el: elColumn, bus, jersey, planter, shelter, hoarding, statue, frame, materials, pallet: (c, w) => crate(c.b, w, c.rnd),
  tree, hedge, towerCrane, fountain,
};
const piece = fallback => (ctx, w) => { const k = pieceOf(w); (k ? BY_PIECE[k] : fallback)(ctx, w); };

export const dress = {
  building: piece((c, w) => building(c.b, w, c.rnd, c.lamps)),
  container: piece((c, w) => container(c.b, w, c.rnd)),
  wall: piece(neonWall),
  border: cityBorder,
  crate: piece((c, w) => crate(c.b, w, c.rnd)),
  barrier: piece((c, w) => barrier(c.b, w)),
  shop: piece(shop),
  stall,
  crane: piece((c, w) => concreteWall(c.b, w)),
  water: piece(() => {}),
};

// ---- Decor -----------------------------------------------------------------------------------------------------

function decor(ctx) {
  const { map } = ctx;
  trains(ctx);
  elevated(ctx);
  lanternStrings(ctx);
  if (!map.underground) skyline(ctx);
}

// The market's lantern strings over the cross-alleys, high enough never to hide anyone.
function lanternStrings(ctx) {
  const { b, sb, glow, map } = ctx;
  for (const [x, z0, z1] of map.strings || []) {
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = 4 * t * (1 - t);
      const z = z0 + (z1 - z0) * t, y = 3.5 - 0.9 * s;
      if (i < n) { b.setColor(0x20202a); box3(b, x - 0.012, y, z, 0.024, 0.02, Math.abs(z1 - z0) / n); }
      sb.setPart(0.4 + (i % 4) * 0.1);
      sb.setColor(i % 2 ? [1.0, 0.45, 0.16] : [1.0, 0.25, 0.32]);
      box3(sb, x - 0.08, y - 0.2, z - 0.08, 0.16, 0.2, 0.16);
    }
    glow.halo(x, (z0 + z1) / 2, 3.2, [0.1, 0.05, 0.02], 0.12, 10);
  }
}

// Off the map: tall towers with lit windows and rooftop billboards to the north (they hide nothing in play), low
// blocks to the east, west and south so the view off those edges stays open.
function skyline(ctx) {
  const { b, sb, glow, W, H, theme, rnd } = ctx;
  const I = theme.ink;
  const far = ctx.map.large ? 16 : 24;
  const sparse = ctx.map.large ? 0.75 : 0.55;     // Fewer lit windows on a Ground War map: it has a lot more skyline.
  const tower = (x, z, w, d, h, lit) => {
    b.setColor(scale(rnd() < 0.5 ? I.wall : I.brick, 0.42));
    box3(b, x, 0, z, w, h, d);
    if (!lit) return;
    emissive(b, () => {
      for (let y = 2; y < h - 1; y += 1.5) {
        for (let i = 0.8; i < w - 0.5; i += 1.6) {
          if (rnd() < sparse) continue;
          b.setColor(rnd() < 0.6 ? scale(I.glow, 0.4) : scale(I.glowCool, 0.3));
          box3(b, x + i, y, z + d + 0.02, 0.6, 0.7, 0.03);
        }
      }
    });
  };
  for (let x = -far; x < W + far; x += 7 + rnd() * 4) {
    tower(x, -11 - rnd() * 3, 4 + rnd() * 4, 4, 9 + rnd() * 7, true);
    tower(x + 3, H + 3.5 + rnd() * 2, 4, 3, 2 + rnd() * 1.2, false);
  }
  for (let z = -6; z < H + 6; z += 7) {
    tower(-11, z, 6, 5, 4 + rnd() * 3, true);
    tower(W + 5, z, 6, 5, 4 + rnd() * 3, true);
  }
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

export const stage = { lights, ground, paint, decor };
