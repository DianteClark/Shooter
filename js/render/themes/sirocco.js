// Sirocco's theme (the desert districts of Sirocco Basin: Caravanserai, Red Gulch, Copperstep, Signal Ridge; docs/
// DISTRICTS.md). Desert dusk with a sandstorm coming in from the west: the sun a swollen orange disc low over the
// dunes, the sky violet overhead, everything washed in airborne sand, shadows long and plum, lanterns coming on in the
// souk. Clearly not Dust, Oasis or Canyon (a hard white afternoon, pale adobe, palms and a dam): red sandstone and red
// mud brick, striped canvas, copper-green spoil and steel dishes. world.js reads `sirocco` ({ dress, stage, thumb })
// into its tables; the giant-world streamer (themes/frontier.js) draws the districts' pieces with the same dress inside
// Sirocco Basin (its own palette and extras: themes/basin.js).
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, mix, skyRing, lattice } from './kit.js';
import { rockMass, adobe, adobeScreen, tent, sandbags, crate, container } from '../world.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));
const sc = scale;
const WATER_Y = -0.62;

THEMES.sirocco = {
  id: 'sirocco',
  // Dusk: the sun on the western horizon, orange through the dust; a violet sky; long plum shadows east.
  light: { dir: norm([-0.86, 0.3, 0.22]), sun: [1.0, 0.6, 0.38], sky: [0.4, 0.32, 0.46], amb: [0.36, 0.27, 0.3] },
  clear: 0x34202c,
  fog: [0.5, 0.36, 0.32], fogSeam: [0.24, 0.1, 0.06], desatTint: [0.9, 0.76, 0.7],
  shadow: { col: [0.36, 0.24, 0.34], strength: 0.68, len: 1.9 },
  lamp: [0.34, 0.2, 0.08],
  groundAmp: 0.22,
  water: { deep: [0.06, 0.12, 0.14], shallow: [0.16, 0.24, 0.24], glint: [1.0, 0.66, 0.4] },
  ink: ink({
    ground: 0x9a7a5c, asphalt: 0x6e5a4a, dirt: 0x8e6e52, gravel: 0x6e6058,
    roof: 0x8a5a40, wall: 0x9a6248, wallB: 0x86523c, trim: 0x4a2e24,
    concrete: 0x8e8478, crate: 0x8a6644, crateD: 0x56402c,
    rail: 0x7a7070, tie: 0x46362c, hazardY: 0x9a7030, hazardK: 0x34261e,
    paint: 0xc8a888, glow: 0xffc070, glowCool: 0xd0d8ec,
    rock: 0x9a5a3e, rockD: 0x7a4232, rockL: 0xb47452, adobe: 0xa86a4a, adobeD: 0x7e4a34,
    canvas: 0xc8a882, canvasB: 0x7a4e36, sandbag: 0x9a7a5a,
    sand: 0xa8845e, sandL: 0xb89470, sandD: 0x8a6a4e, red: 0x9a4a34, redD: 0x6e3226, ochre: 0xb8864a,
    mud: 0xa06246, mudL: 0xb47656, mudD: 0x7a4634, plaster: 0xc0a088, stone: 0xa08a72, stoneD: 0x7e6a58,
    beam: 0x5a3a26, door: 0x3e2a20, shutter: 0x3a5a5a, teal: 0x2e6a66, indigo: 0x3a3a6a, saffron: 0xd89a3a, crimson: 0x9a2e2e,
    copper: 0x5a8a6e, copperD: 0x3e6a54, ore: 0x6a5a4e, spoil: 0x7a7060, spoilD: 0x5e564a, tin: 0x8a8a84, tinD: 0x6a6a66, rust: 0x8a4a2e,
    steel: 0x8a9098, steelD: 0x5a6068, white: 0xd4ccc4, dish: 0xc8c4be, dishD: 0x9a968e, black: 0x26201e,
    grass: 0x6a6a3a, palm: 0x4e5a2e, palmD: 0x3a4424, trunk: 0x6a4a34, trunkD: 0x4e3626, water: 0x2a4a4a,
    salt: 0xdcd4ca, saltD: 0xbab0a4, slag: 0x3a3230,
  }),
  containers: [0x7a4a32, 0x5a6a5e, 0x8a6a3a, 0x4a4a5e],
  weather: { fields: [
    // The sandstorm: streaks of blown sand low and fast, grit in the air, and big slow veils of haze.
    { kind: 'streak', count: 220, box: [40, 3.4, 30], vel: [14, 0.2, 3], len: 3.2, width: 0.035, col: [0.96, 0.7, 0.48], alpha: 0.24 },
    { kind: 'mote', count: 170, box: [40, 7, 32], vel: [6, 0.2, 1.4], size: 0.12, col: [1.0, 0.76, 0.56], alpha: 0.34 },
    { kind: 'mote', count: 22, box: [46, 3.4, 36], vel: [7, 0.06, 1.6], size: 5, col: [0.86, 0.6, 0.46], alpha: 0.07 },
  ] },
};

const has = (w, k) => !!w[k];
const hash = (x, z) => Math.abs(Math.round(x * 7.31 + z * 3.17));

// ---- Pieces ----------------------------------------------------------------------------------------------------

// A crenellated parapet round a flat top at height h.
function parapet(b, x, z, w, d, h, col, t = 0.28, hh = 0.42, step = 0.9) {
  b.setColor(col);
  box3(b, x, h, z, w, 0.16, t); box3(b, x, h, z + d - t, w, 0.16, t);
  box3(b, x, h, z + t, t, 0.16, d - 2 * t); box3(b, x + w - t, h, z + t, t, 0.16, d - 2 * t);
  for (let s = 0.1; s < w - 0.3; s += step) { box3(b, x + s, h + 0.16, z, 0.42, hh, t); box3(b, x + s, h + 0.16, z + d - t, 0.42, hh, t); }
  for (let s = 0.1 + step; s < d - 0.3 - step * 0.5; s += step) { box3(b, x, h + 0.16, z + s, t, hh, 0.42); box3(b, x + w - t, h + 0.16, z + s, t, hh, 0.42); }
}

// Red mud tower house (Red Gulch, the basin's ksar towns): tall, slightly battered walls, rows of small dark windows,
// a crenellated top, beam ends, a painted door. Solid in 6v6 (it opens up in the basin as a building).
function towerHouse(ctx, w) {
  const { b, theme, rnd, lamps, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const c = hash(x, z) % 3 === 0 ? I.mudL : hash(x, z) % 3 === 1 ? I.mud : sc(I.mud, 0.92);
  b.setColor(sc(c, 0.9));
  box3(b, x, 0, z, bw, 0.5, bd);
  b.setColor(c);
  b.loft([[[x, 0.5, z], [x + bw, 0.5, z], [x + bw, 0.5, z + bd], [x, 0.5, z + bd]],
    [[x + 0.15, h, z + 0.15], [x + bw - 0.15, h, z + 0.15], [x + bw - 0.15, h, z + bd - 0.15], [x + 0.15, h, z + bd - 0.15]]]);
  b.setColor(sc(I.roof, 0.95));
  box3(b, x + 0.15, h - 0.02, z + 0.15, bw - 0.3, 0.04, bd - 0.3);
  parapet(b, x + 0.15, z + 0.15, bw - 0.3, bd - 0.3, h, sc(c, 1.06));
  // Window rows on the long faces, a band of whitewash under the top.
  b.setColor(I.plaster);
  box3(b, x + 0.1, h - 0.7, z + bd - 0.12, bw - 0.2, 0.18, 0.02);
  box3(b, x + 0.1, h - 0.7, z + 0.1, bw - 0.2, 0.18, 0.02);
  for (let y = 1.4; y < h - 1.2; y += 1.7) {
    for (let s = 0.8; s < bw - 0.8; s += 1.5) {
      b.setColor(I.door);
      box3(b, x + s, y, z + bd - 0.1 - (y / h) * 0.15, 0.36, 0.6, 0.03);
      box3(b, x + s, y, z + 0.08 + (y / h) * 0.15, 0.36, 0.6, 0.03);
    }
  }
  b.setColor(I.beam);
  for (let s = 0.4; s < bw - 0.2; s += 0.9) box3(b, x + s, h - 1.1, z + bd - 0.15, 0.12, 0.12, 0.38);
  const dx = x + bw * (0.35 + (hash(x, z) % 5) * 0.06);
  b.setColor(hash(x, z) % 2 ? I.teal : I.indigo);
  box3(b, dx, 0, z + bd + 0.01, 0.95, 2.0, 0.04);
  b.setColor(I.plaster);
  box3(b, dx - 0.12, 2.0, z + bd + 0.01, 1.2, 0.14, 0.06);
  if (rnd() < 0.55) {
    emissive(b, () => { b.setColor([1.0, 0.62, 0.3]); box3(b, dx + 0.32, 2.3, z + bd + 0.05, 0.3, 0.3, 0.06); });
    glow.halo(dx + 0.47, z + bd + 0.9, 1.6, [0.13, 0.07, 0.02], 0.13, 10);
    lamps.push({ x: dx + 0.47, z: z + bd + 1.4, r: 4, col: [0.32, 0.18, 0.07] });
  }
}

// A souk shopfront: mud walls, a striped awning out over the street on the side away from the map edge, goods on
// trestles under it, a lantern.
function soukShop(ctx, w) {
  const { b, theme, rnd, glow, lamps, H } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(hash(x, z) % 2 ? I.mud : I.mudL);
  box3(b, x, 0, z, bw, h, bd);
  parapet(b, x, z, bw, bd, h, sc(I.mudL, 1.04), 0.24, 0.34, 1.0);
  b.setColor(sc(I.roof, 1.02)); box3(b, x + 0.24, h - 0.02, z + 0.24, bw - 0.48, 0.04, bd - 0.48);
  const south = z + bd / 2 < H / 2 || w.faceS;
  const fz = south ? z + bd : z;
  const out = south ? 1 : -1;
  const cols = [I.crimson, I.saffron, I.teal, I.indigo];
  const ca = cols[hash(x, z) % 4], cb = I.plaster;
  // Striped awning on poles.
  const n = Math.ceil(bw / 0.6);
  for (let i = 0; i < n; i++) {
    const s0 = x + (i / n) * bw, s1 = x + ((i + 1) / n) * bw;
    b.setColor(i % 2 ? ca : cb);
    b.quad([s0, 2.6, fz], [s1, 2.6, fz], [s1, 2.15, fz + out * 1.2], [s0, 2.15, fz + out * 1.2]);
  }
  b.setColor(I.beam);
  for (const px of [x + 0.2, x + bw - 0.3]) box3(b, px, 0, fz + (south ? 1.1 : -1.2), 0.1, 2.15, 0.1);
  // Doorways and shuttered stalls on the face.
  for (let s = 0.8; s < bw - 1; s += 2.4) {
    b.setColor(I.door); box3(b, x + s, 0, south ? fz + 0.01 : fz - 0.05, 1.2, 2.0, 0.04);
    b.setColor(cols[(hash(x, z) + Math.round(s)) % 4]);
    box3(b, x + s + 0.1, 0.8, south ? fz + 0.06 : fz - 0.4, 1.0, 0.1, 0.35);
    for (let k = 0; k < 3; k++) { b.setColor(sc(cols[(k + Math.round(s)) % 4], 0.9 + rnd() * 0.2)); b.prismY(0.9, 1.05 + rnd() * 0.1, x + s + 0.25 + k * 0.3, south ? fz + 0.24 : fz - 0.22, 0.12, 0.1, 6); }
  }
  emissive(b, () => { b.setColor([1.0, 0.66, 0.32]); box3(b, x + bw / 2 - 0.12, 2.2, fz + out * 0.6 - 0.12, 0.24, 0.3, 0.24); });
  glow.halo(x + bw / 2, fz + out * 1.6, 2.4, [0.14, 0.08, 0.02], 0.12, 10);
  lamps.push({ x: x + bw / 2, z: fz + out * 2, r: 5.5, col: [0.36, 0.2, 0.07] });
}

// A merchant's house: plastered mud walls, a small dome, a wooden balcony screen (mashrabiya) over the door.
function merchantHouse(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.plaster); box3(b, x, 0, z, bw, h, bd);
  b.setColor(I.mudD); box3(b, x - 0.03, 0, z - 0.03, bw + 0.06, 0.45, bd + 0.06);
  parapet(b, x, z, bw, bd, h, sc(I.plaster, 1.05), 0.25, 0.32, 1.1);
  b.setColor(sc(I.roof, 1.1)); box3(b, x + 0.25, h - 0.02, z + 0.25, bw - 0.5, 0.04, bd - 0.5);
  const cx = x + bw * 0.68, cz = z + bd * 0.5, r = Math.min(bw, bd) * 0.2;
  b.setColor(sc(I.plaster, 1.08)); b.prismY(h, h + 0.5, cx, cz, r, r, 10);
  b.setColor(I.copper); b.prismY(h + 0.5, h + 0.5 + r * 0.9, cx, cz, r, 0.12, 10);
  b.setColor(I.beam);
  for (const fz of [z + bd + 0.02, z - 0.4]) {
    box3(b, x + bw * 0.3, h * 0.55, fz, bw * 0.3, 1.1, 0.38);
    b.setColor(sc(I.beam, 1.3));
    for (let s = 0; s < bw * 0.3; s += 0.25) box3(b, x + bw * 0.3 + s, h * 0.55 + 0.1, fz + (fz > z ? 0.38 : -0.02), 0.06, 0.9, 0.03);
    b.setColor(I.beam);
  }
  b.setColor(I.teal); box3(b, x + bw * 0.38, 0, z + bd + 0.01, 1, 2, 0.04);
}

// Corrugated tin shed (the mine): ribbed walls, a shallow ridged roof, a sliding door, rust streaks.
function tinShed(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const col = hash(x, z) % 2 ? I.tin : sc(I.rust, 1.1);
  b.setColor(col); box3(b, x, 0, z, bw, h, bd);
  b.setColor(sc(col, 0.85));
  const along = bw >= bd;
  for (let s = 0.2; s < (along ? bw : bd); s += 0.5) {
    if (along) { box3(b, x + s, 0.1, z - 0.03, 0.08, h - 0.2, 0.03); box3(b, x + s, 0.1, z + bd, 0.08, h - 0.2, 0.03); }
    else { box3(b, x - 0.03, 0.1, z + s, 0.03, h - 0.2, 0.08); box3(b, x + bw, 0.1, z + s, 0.03, h - 0.2, 0.08); }
  }
  const rise = Math.min(bw, bd) * 0.14;
  b.setColor(I.tinD);
  if (along) {
    b.quad([x - 0.2, h, z - 0.2], [x - 0.2, h + rise, z + bd / 2], [x + bw + 0.2, h + rise, z + bd / 2], [x + bw + 0.2, h, z - 0.2], [x + bw / 2, -9, z + bd / 2]);
    b.quad([x - 0.2, h, z + bd + 0.2], [x + bw + 0.2, h, z + bd + 0.2], [x + bw + 0.2, h + rise, z + bd / 2], [x - 0.2, h + rise, z + bd / 2], [x + bw / 2, -9, z + bd / 2]);
  } else {
    b.quad([x - 0.2, h, z - 0.2], [x - 0.2, h, z + bd + 0.2], [x + bw / 2, h + rise, z + bd + 0.2], [x + bw / 2, h + rise, z - 0.2], [x + bw / 2, -9, z + bd / 2]);
    b.quad([x + bw + 0.2, h, z - 0.2], [x + bw / 2, h + rise, z - 0.2], [x + bw / 2, h + rise, z + bd + 0.2], [x + bw + 0.2, h, z + bd + 0.2], [x + bw / 2, -9, z + bd / 2]);
  }
  b.setColor(I.rust);
  for (let i = 0; i < 4; i++) box3(b, x + rnd() * (bw - 0.4), 0.3, z + bd + 0.04, 0.2, 0.6 + rnd() * (h - 1), 0.02);
  b.setColor(I.steelD); box3(b, x + bw * 0.3, 0, z + bd + 0.04, Math.min(3, bw * 0.4), 2.6, 0.05);
  b.setColor(I.hazardY); box3(b, x + bw * 0.3, 2.6, z + bd + 0.05, Math.min(3, bw * 0.4), 0.12, 0.05);
}

// The mine office: whitewashed block, a veranda roof on posts, a sign board.
function mineOffice(ctx, w) {
  const { b, theme, lamps, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.white); box3(b, x, 0, z, bw, h, bd);
  b.setColor(I.stoneD); box3(b, x - 0.03, 0, z - 0.03, bw + 0.06, 0.4, bd + 0.06);
  b.setColor(I.tinD); box3(b, x - 0.25, h, z - 0.25, bw + 0.5, 0.18, bd + 0.5);
  b.setColor(I.copper); box3(b, x + 0.5, h * 0.62, z + bd + 0.02, bw - 1, 0.5, 0.05);
  b.setColor(I.shutter);
  for (let s = 0.8; s < bw - 0.6; s += 1.6) box3(b, x + s, 1.0, z - 0.04, 0.7, 0.9, 0.04);
  emissive(b, () => { b.setColor([1.0, 0.78, 0.5]); box3(b, x + bw / 2 - 0.4, 1.0, z + bd + 0.03, 0.8, 0.8, 0.03); });
  glow.halo(x + bw / 2, z + bd + 1, 2, [0.1, 0.07, 0.03], 0.12, 10);
  lamps.push({ x: x + bw / 2, z: z + bd + 1.5, r: 5, col: [0.3, 0.2, 0.1] });
}

// A dish antenna on its pedestal: a concrete plinth, the yoke, the reflector tipped up toward the west, its feed horn.
function dishAntenna(ctx, w) {
  const { b, theme, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const cx = x + bw / 2, cz = z + bd / 2;
  const big = has(w, 'big');
  b.setColor(I.concrete); box3(b, x, 0, z, bw, h * 0.6, bd);
  b.setColor(sc(I.concrete, 0.85)); box3(b, x - 0.05, h * 0.6, z - 0.05, bw + 0.1, 0.12, bd + 0.1);
  b.setColor(I.steelD); b.prismY(h * 0.6, h, cx, cz, bw * 0.22, bw * 0.18, 8);
  // The reflector: a shallow cone of quads, tipped (normal toward the low sun in the west and up).
  const R = big ? 4.6 : 2.4, depth = R * 0.32, yc = h + R * 0.55;
  const nx = -0.55, ny = 0.83, nz = 0.1;
  const ux = 0.83, uy = 0.55, uz = 0;           // In the dish plane, roughly up-east.
  const vx = 0, vy = 0, vz = 1;                 // In the dish plane, south.
  const N = big ? 16 : 12;
  const rim = [], mid = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    rim.push([cx + (ux * ca + vx * sa) * R, yc + (uy * ca + vy * sa) * R, cz + (uz * ca + vz * sa) * R]);
    mid.push([cx + (ux * ca + vx * sa) * R * 0.55 - nx * depth * 0.6, yc + (uy * ca + vy * sa) * R * 0.55 - ny * depth * 0.6, cz + (uz * ca + vz * sa) * R * 0.55 - nz * depth * 0.6]);
  }
  const hub = [cx - nx * depth, yc - ny * depth, cz - nz * depth];
  const front = [cx + nx * 6, yc + ny * 6, cz + nz * 6], back = [cx - nx * 6, yc - ny * 6, cz - nz * 6];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    b.setColor(i % 2 ? I.dish : sc(I.dish, 0.95));
    b.quad(mid[i], rim[i], rim[j], mid[j], back);
    b.tri(hub, mid[i], mid[j], back);
    b.setColor(I.dishD);
    b.quad(mid[i], mid[j], rim[j], rim[i], front);
  }
  // Feed horn on three struts.
  const fx = cx + nx * R * 0.7, fy = yc + ny * R * 0.7, fz = cz + nz * R * 0.7;
  b.setColor(I.steel);
  for (const k of [0, Math.floor(N / 3), Math.floor(2 * N / 3)]) {
    const p = rim[k];
    b.quad([p[0], p[1], p[2]], [p[0] + 0.06, p[1] + 0.06, p[2]], [fx + 0.06, fy + 0.06, fz], [fx, fy, fz], back);
  }
  b.setColor(I.white); b.prismY(fy - 0.3, fy + 0.3, fx, fz, 0.22, 0.16, 6);
  // A red aircraft light on the big one.
  if (big) {
    emissive(b, () => { b.setColor([1.0, 0.2, 0.12]); box3(b, fx - 0.12, fy + 0.3, fz - 0.12, 0.24, 0.24, 0.24); });
    glow.halo(fx, fz, 2.4, [0.12, 0.02, 0.01], fy + 0.5);
  }
}

// Prefab hut: white panels on a skid base, a door, an AC box, a little roof overhang.
function prefabHut(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.steelD); box3(b, x, 0, z, bw, 0.3, bd);
  b.setColor(I.white); box3(b, x + 0.05, 0.3, z + 0.05, bw - 0.1, h - 0.3, bd - 0.1);
  b.setColor(sc(I.white, 0.88));
  for (let s = 1.2; s < bw - 0.2; s += 1.2) box3(b, x + s, 0.3, z + bd - 0.06, 0.05, h - 0.4, 0.03);
  b.setColor(I.tinD); box3(b, x - 0.2, h, z - 0.2, bw + 0.4, 0.15, bd + 0.4);
  b.setColor(I.steel); box3(b, x + bw - 1.2, h + 0.15, z + 0.5, 0.8, 0.5, 0.8);
  b.setColor(I.indigo); box3(b, x + 0.6, 0.3, z + bd - 0.03, 0.9, 1.9, 0.04);
}

// The control block: low concrete, a band of dark windows, antennas and a lit sign.
function controlBlock(ctx, w) {
  const { b, theme, lamps, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.concrete); box3(b, x, 0, z, bw, h, bd);
  b.setColor(sc(I.concrete, 0.85)); box3(b, x - 0.1, h, z - 0.1, bw + 0.2, 0.25, bd + 0.2);
  emissive(b, () => {
    b.setColor([0.5, 0.62, 0.7]);
    box3(b, x + 0.4, h * 0.45, z + bd + 0.02, bw - 0.8, 0.7, 0.03);
    box3(b, x + 0.4, h * 0.45, z - 0.05, bw - 0.8, 0.7, 0.03);
  });
  b.setColor(I.steel);
  for (const [ax, az] of [[x + 1, z + 1], [x + bw - 1.4, z + bd - 1.4]]) b.prismY(h + 0.25, h + 2.6, ax, az, 0.05, 0.03, 4);
  lamps.push({ x: x + bw / 2, z: z + bd + 1.6, r: 6, col: [0.16, 0.2, 0.24] });
  glow.halo(x + bw / 2, z + bd + 1, 2.4, [0.04, 0.06, 0.08], 0.12, 10);
}

// A ksar tower (the serai's corners, the Citadel): square, battered, crenellated, arrow slits.
function ksarTower(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.mud);
  b.loft([[[x, 0, z], [x + bw, 0, z], [x + bw, 0, z + bd], [x, 0, z + bd]],
    [[x + 0.3, h, z + 0.3], [x + bw - 0.3, h, z + 0.3], [x + bw - 0.3, h, z + bd - 0.3], [x + 0.3, h, z + bd - 0.3]]]);
  b.setColor(sc(I.roof, 0.9)); box3(b, x + 0.3, h - 0.02, z + 0.3, bw - 0.6, 0.04, bd - 0.6);
  parapet(b, x + 0.25, z + 0.25, bw - 0.5, bd - 0.5, h, I.mudL, 0.3, 0.55, 0.85);
  b.setColor(I.door);
  for (let y = 1.6; y < h - 1; y += 1.8) {
    box3(b, x + bw / 2 - 0.08, y, z + bd - 0.2, 0.16, 0.7, 0.03);
    box3(b, x + bw / 2 - 0.08, y, z + 0.17, 0.16, 0.7, 0.03);
    box3(b, x + 0.17, y, z + bd / 2 - 0.08, 0.03, 0.7, 0.16);
    box3(b, x + bw - 0.2, y, z + bd / 2 - 0.08, 0.03, 0.7, 0.16);
  }
  b.setColor(I.plaster); box3(b, x + 0.2, h - 1.0, z + bd - 0.22, bw - 0.4, 0.14, 0.03);
}

// The serai's outer wall: thick red mud, a rounded crest with merlons, a plinth, beam holes.
function seraiWall(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd, L = long ? bw : bd;
  b.setColor(I.mud); box3(b, x, 0, z, bw, h, bd);
  b.setColor(I.mudD); box3(b, x - 0.04, 0, z - 0.04, bw + 0.08, 0.5, bd + 0.08);
  b.setColor(I.mudL);
  for (let s = 0.15; s < L - 0.3; s += 1.0) { if (long) box3(b, x + s, h, z, 0.55, 0.45, bd); else box3(b, x, h, z + s, bw, 0.45, 0.55); }
  b.setColor(I.beam);
  for (let s = 0.5; s < L - 0.3; s += 1.4) { if (long) { box3(b, x + s, h - 0.6, z - 0.05, 0.12, 0.12, 0.05); box3(b, x + s, h - 0.6, z + bd, 0.12, 0.12, 0.05); } else { box3(b, x - 0.05, h - 0.6, z + s, 0.05, 0.12, 0.12); box3(b, x + bw, h - 0.6, z + s, 0.05, 0.12, 0.12); } }
}

// The Citadel's ramparts: stone below, mud brick above, a wall walk with merlons.
function rampart(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd, L = long ? bw : bd;
  b.setColor(I.stoneD); box3(b, x, 0, z, bw, h * 0.45, bd);
  b.setColor(I.mud); box3(b, x + 0.05, h * 0.45, z + 0.05, bw - 0.1, h * 0.55, bd - 0.1);
  b.setColor(I.mudL);
  for (let s = 0.2; s < L - 0.4; s += 1.1) { if (long) box3(b, x + s, h, z, 0.6, 0.6, bd); else box3(b, x, h, z + s, bw, 0.6, 0.6); }
  // Breaches patched with stone, cracks.
  b.setColor(I.stone);
  for (let i = 0; i < L / 5; i++) { const s = rnd() * (L - 1.5), y = h * 0.45 + rnd() * h * 0.4; if (long) box3(b, x + s, y, z + bd, 0.8 + rnd(), 0.4, 0.03); else box3(b, x + bw, y, z + s, 0.03, 0.4, 0.8 + rnd()); }
}

// An arcade pillar: square pier, an impost, and the arch to the next pier east (`arch` metres), drawn overhead.
function pillar(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: pw, d: pd, h } = w;
  b.setColor(I.plaster); box3(b, x, 0, z, pw, h - 0.6, pd);
  b.setColor(I.mudL); box3(b, x - 0.08, h - 0.6, z - 0.08, pw + 0.16, 0.18, pd + 0.16);
  const span = w.arch ?? 3.5;
  // The arch: a pointed curve of short segments, from this pier's top to the next.
  b.setColor(I.plaster);
  const n = 6, x0 = x + pw, x1 = x + span, y0 = h - 0.42;
  let px = x0, py = y0;
  for (let i = 1; i <= n; i++) {
    const t = i / n, ax = x0 + (x1 - x0) * t, ay = y0 + Math.sin(t * Math.PI) * 0.9;
    b.quad([px, py, z], [ax, ay, z], [ax, ay + 0.35, z], [px, py + 0.35, z], [px, py, z - 5]);
    b.quad([px, py, z + pd], [px, py + 0.35, z + pd], [ax, ay + 0.35, z + pd], [ax, ay, z + pd], [px, py, z + pd + 5]);
    b.quad([px, py + 0.35, z], [ax, ay + 0.35, z], [ax, ay + 0.35, z + pd], [px, py + 0.35, z + pd], [px, py - 5, z + pd / 2]);
    px = ax; py = ay;
  }
}

// An arch pier over Red Gulch's main street: stone, and the arch to its partner pier across the street.
function archPier(ctx, w) {
  const { b, theme, map } = ctx;
  const I = theme.ink;
  const { x, z, w: pw, d: pd, h } = w;
  b.setColor(I.stone); box3(b, x, 0, z, pw, h, pd);
  b.setColor(I.stoneD); box3(b, x - 0.1, h - 0.4, z - 0.1, pw + 0.2, 0.3, pd + 0.2);
  const other = map.walls.find(q => q !== w && q.arch === true && Math.abs(q.x - x) < 0.01 && q.z > z && q.z - z < 12);
  if (!other) return;
  const z0 = z + pd, z1 = other.z, n = 8;
  let pz = z0, py = h - 0.3;
  b.setColor(I.stone);
  for (let i = 1; i <= n; i++) {
    const t = i / n, az = z0 + (z1 - z0) * t, ay = h - 0.3 + Math.sin(t * Math.PI) * 1.2;
    b.quad([x, py, pz], [x, ay, az], [x, ay + 0.6, az], [x, py + 0.6, pz], [x - 5, py, pz]);
    b.quad([x + pw, py, pz], [x + pw, py + 0.6, pz], [x + pw, ay + 0.6, az], [x + pw, ay, az], [x + pw + 5, py, pz]);
    b.quad([x, py + 0.6, pz], [x, ay + 0.6, az], [x + pw, ay + 0.6, az], [x + pw, py + 0.6, pz], [x + pw / 2, py - 5, pz]);
    pz = az; py = ay;
  }
  // A string of lanterns hung under the arch.
  const mz = (z0 + z1) / 2;
  emissive(b, () => { b.setColor([1.0, 0.6, 0.28]); box3(b, x + pw / 2 - 0.15, h + 0.2, mz - 0.15, 0.3, 0.35, 0.3); });
  ctx.glow.halo(x + pw / 2, mz, 2.6, [0.14, 0.08, 0.02], 0.12, 10);
  ctx.lamps.push({ x: x + pw / 2, z: mz, r: 6, col: [0.36, 0.2, 0.07] });
}

// The Sunwell: the domed well house in the middle of the Caravanserai, open arches on four sides showing the well head.
function wellHouse(ctx, w) {
  const { b, theme, glow, lamps } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const cx = x + bw / 2, cz = z + bd / 2;
  b.setColor(I.plaster);
  for (const [px, pz] of [[x, z], [x + bw - 0.7, z], [x, z + bd - 0.7], [x + bw - 0.7, z + bd - 0.7]]) box3(b, px, 0, pz, 0.7, h - 0.8, 0.7);
  b.setColor(sc(I.plaster, 0.96)); box3(b, x - 0.1, h - 0.8, z - 0.1, bw + 0.2, 0.8, bd + 0.2);
  b.setColor(I.teal); box3(b, x - 0.12, h - 0.5, z - 0.12, bw + 0.24, 0.14, bd + 0.24);
  b.setColor(I.plaster); b.prismY(h, h + 0.4, cx, cz, bw * 0.48, bw * 0.48, 12);
  // The dome, in bands, tiled turquoise, a brass finial.
  const R = bw * 0.48;
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * Math.PI / 2, a1 = ((k + 1) / 4) * Math.PI / 2;
    b.setColor(k % 2 ? I.teal : sc(I.teal, 1.15));
    b.prismY(h + 0.4 + Math.sin(a0) * R, h + 0.4 + Math.sin(a1) * R, cx, cz, Math.cos(a0) * R, Math.max(0.08, Math.cos(a1) * R), 12);
  }
  b.setColor(I.saffron); b.prismY(h + 0.4 + R, h + 1.1 + R, cx, cz, 0.08, 0.03, 6);
  b.setColor(I.stoneD); b.prismY(0, 0.9, cx, cz, 0.9, 0.85, 10);
  b.setColor(I.water); b.prismY(0.9, 0.92, cx, cz, 0.65, 0.65, 10);
  emissive(b, () => { b.setColor([1.0, 0.7, 0.36]); box3(b, cx - 0.12, h - 1.2, cz - 0.12, 0.24, 0.3, 0.24); });
  glow.halo(cx, cz, 4.5, [0.16, 0.09, 0.03], 0.12, 14);
  lamps.push({ x: cx, z: cz, r: 8, col: [0.4, 0.24, 0.09] });
}

// Layered sandstone cliff (Red Gulch): strata in red and ochre, ledges stepping back, a cap of darker rock.
// The camera looks north at 55 degrees: a cliff on the south side of the ground it walls in (the south half of the map,
// or flagged `low`) is drawn as a low lip, so it never hides who stands at its foot.
function cliff(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd } = w;
  const h = w.low || z + bd / 2 > ctx.H / 2 ? Math.min(w.h, 2.8) : w.h;
  const long = bw >= bd, L = long ? bw : bd, D = long ? bd : bw;
  for (let s = 0; s < L - 0.01; s += 4) {
    const n = Math.min(4, L - s);
    const hh = h * (0.8 + rnd() * 0.4);
    const layers = 4;
    for (let k = 0; k < layers; k++) {
      const y0 = (hh * k) / layers, y1 = (hh * (k + 1)) / layers;
      const inset = Math.min(D * 0.35, k * D * 0.08 + rnd() * 0.15);
      b.setColor(k % 2 ? I.rock : k === 3 ? I.rockD : I.ochre);
      if (long) box3(b, x + s, y0, z + inset * (z < 1 ? 0 : 1), n, y1 - y0, Math.max(0.3, D - inset));
      else box3(b, x + inset * (x < 1 ? 0 : 1), y0, z + s, Math.max(0.3, D - inset), y1 - y0, n);
    }
    b.setColor(I.rockD);
    if (long) box3(b, x + s, hh, z, n, 0.08, D * 0.7); else box3(b, x, hh, z + s, D * 0.7, 0.08, n);
  }
}

// Spoil heap (the mine): a mound of broken rock in grey-green and ochre, copper stains.
function spoil(ctx, w, cols) {
  const { theme } = ctx;
  const I = theme.ink;
  rockMass(ctx, w.x, w.z, w.w, w.d, w.h, { levels: 3, colour: cols ?? I.spoil });
}

// A stepped terrace face (the mine's benches): a waist-high rock lip with a lighter tread on top.
function terraceFace(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd, L = long ? bw : bd;
  for (let s = 0; s < L - 0.01; s += 1.4) {
    const n = Math.min(1.4, L - s), hh = h * (0.9 + rnd() * 0.15);
    b.setColor(sc(rnd() < 0.5 ? I.spoil : I.ore, 0.9 + rnd() * 0.2));
    if (long) box3(b, x + s, 0, z, n, hh, bd, 0.05); else box3(b, x, 0, z + s, bw, hh, n, 0.05);
  }
  b.setColor(I.copper);
  for (let i = 0; i < L / 3; i++) { const s = rnd() * (L - 0.6); if (long) box3(b, x + s, h * 0.4, z + bd + 0.01, 0.5, 0.2, 0.02); else box3(b, x + bw + 0.01, h * 0.4, z + s, 0.02, 0.2, 0.5); }
}

// An ore cart: a steel tub on wheels, heaped with ore.
function oreCart(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  b.setColor(I.black);
  for (const ox of [0.35, cw - 0.75]) { box3(b, x + ox, 0, z + 0.05, 0.4, 0.45, 0.12); box3(b, x + ox, 0, z + cd - 0.17, 0.4, 0.45, 0.12); }
  b.setColor(I.rust);
  b.loft([[[x + 0.1, 0.35, z + 0.15], [x + cw - 0.1, 0.35, z + 0.15], [x + cw - 0.1, 0.35, z + cd - 0.15], [x + 0.1, 0.35, z + cd - 0.15]],
    [[x, h - 0.15, z], [x + cw, h - 0.15, z], [x + cw, h - 0.15, z + cd], [x, h - 0.15, z + cd]]]);
  b.setColor(I.copper); b.prismY(h - 0.2, h + 0.15, x + cw / 2, z + cd / 2, Math.min(cw, cd) * 0.55, 0.2, 7);
}

// Ore hopper: a steel bin on legs over a chute, painted rust-red, ore spilling.
function hopper(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: hw, d: hd, h } = w;
  b.setColor(I.steelD);
  for (const [ox, oz] of [[0, 0], [hw - 0.3, 0], [0, hd - 0.3], [hw - 0.3, hd - 0.3]]) box3(b, x + ox, 0, z + oz, 0.3, h * 0.5, 0.3);
  b.setColor(I.rust);
  b.loft([[[x + hw * 0.35, h * 0.35, z + hd * 0.35], [x + hw * 0.65, h * 0.35, z + hd * 0.35], [x + hw * 0.65, h * 0.35, z + hd * 0.65], [x + hw * 0.35, h * 0.35, z + hd * 0.65]],
    [[x, h * 0.6, z], [x + hw, h * 0.6, z], [x + hw, h * 0.6, z + hd], [x, h * 0.6, z + hd]]]);
  box3(b, x, h * 0.6, z, hw, h * 0.4, hd);
  b.setColor(I.ore); box3(b, x + 0.15, h, z + 0.15, hw - 0.3, 0.06, hd - 0.3);
  b.setColor(I.copper); b.prismY(h, h + 0.5, x + hw / 2, z + hd / 2, hw * 0.35, 0.2, 7);
  // The conveyor running up to it from the west, on a trestle.
  b.setColor(I.steelD);
  b.quad([x - 6, 0.8, z + hd / 2 - 0.4], [x, h + 0.2, z + hd / 2 - 0.4], [x, h + 0.2, z + hd / 2 + 0.4], [x - 6, 0.8, z + hd / 2 + 0.4], [x - 3, -9, z + hd / 2]);
}

// Explosives magazine: a squat concrete bunker, a steel door, a red diamond.
function magazine(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: mw, d: md, h } = w;
  b.setColor(I.concrete); box3(b, x, 0, z, mw, h, md);
  b.setColor(I.sand); b.prismY(h, h + 0.5, x + mw / 2, z + md / 2, Math.min(mw, md) * 0.55, Math.min(mw, md) * 0.3, 6);
  b.setColor(I.steelD); box3(b, x + mw / 2 - 0.5, 0, z + md + 0.01, 1, 1.9, 0.04);
  b.setColor(I.crimson); box3(b, x + mw / 2 - 0.25, 2.0, z + md + 0.02, 0.5, 0.36, 0.03);
}

// The headframe over the shaft: a steel A-frame tower, the sheave wheel on top, a cage house at its foot.
function headframe(ctx, w) {
  const { b, theme, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: hw, d: hd, h } = w;
  const cx = x + hw / 2, cz = z + hd / 2;
  b.setColor(I.concrete); box3(b, x, 0, z, hw, 1.2, hd);
  b.setColor(I.tinD); box3(b, x + 0.3, 1.2, z + 0.3, hw - 0.6, 1.6, hd - 0.6);
  b.setColor(I.rust);
  lattice(b, x + 0.2, z + 0.2, hw - 0.4, 2.8, h - 0.6, { leg: 0.16, step: 1.6, brace: 0.07 });
  // The back stays, leaning down toward the winder house (east).
  b.quad([cx, h - 0.6, cz - 0.6], [x + hw + 3.2, 0.2, cz - 0.6], [x + hw + 3.2, 0.5, cz - 0.6], [cx, h - 0.3, cz - 0.6], [cx, h, cz - 9]);
  b.quad([cx, h - 0.6, cz + 0.6], [cx, h - 0.3, cz + 0.6], [x + hw + 3.2, 0.5, cz + 0.6], [x + hw + 3.2, 0.2, cz + 0.6], [cx, h, cz + 9]);
  b.setColor(I.black);
  b.prismZ(cz - 0.12, cz + 0.12, cx, h + 0.2, 1.1, 1.1, 12);
  b.setColor(I.rust); b.prismZ(cz - 0.14, cz + 0.14, cx, h + 0.2, 0.25, 0.25, 6);
  emissive(b, () => { b.setColor([1.0, 0.25, 0.12]); box3(b, cx - 0.15, h + 1.35, cz - 0.15, 0.3, 0.3, 0.3); });
  glow.halo(cx, cz, 2.6, [0.12, 0.02, 0.01], h + 1.5);
}

// Radio mast: a tall red-and-white lattice, a beacon.
function radioMast(ctx, w) {
  const { b, theme, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: mw, h } = w;
  const cx = x + mw / 2, cz = z + w.d / 2;
  b.setColor(I.concrete); box3(b, x - 0.1, 0, z - 0.1, mw + 0.2, 0.4, w.d + 0.2);
  const n = 6;
  for (let k = 0; k < n; k++) {
    b.setColor(k % 2 ? I.white : I.crimson);
    b.prismY((h / n) * k, (h / n) * (k + 1), cx, cz, (mw / 2) * (1 - k / n * 0.6), (mw / 2) * (1 - (k + 1) / n * 0.6), 3);
  }
  emissive(b, () => { b.setColor([1.0, 0.22, 0.12]); box3(b, cx - 0.15, h, cz - 0.15, 0.3, 0.3, 0.3); });
  glow.halo(cx, cz, 2.2, [0.12, 0.02, 0.01], h + 0.2);
}

// A water tower on four legs (the Rail Halt).
function waterTower(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: tw, d: td, h } = w;
  const cx = x + tw / 2, cz = z + td / 2;
  b.setColor(I.beam);
  for (const [ox, oz] of [[0, 0], [tw - 0.25, 0], [0, td - 0.25], [tw - 0.25, td - 0.25]]) box3(b, x + ox, 0, z + oz, 0.25, h - 2.6, 0.25);
  b.setColor(I.rust); b.prismY(h - 2.6, h, cx, cz, tw * 0.62, tw * 0.62, 10);
  b.setColor(I.tinD); b.prismY(h, h + 0.8, cx, cz, tw * 0.66, 0.15, 10);
}

// Upright tank (fuel, water): a cylinder with bands and a ladder.
function uprightTank(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: tw, d: td, h } = w;
  const cx = x + tw / 2, cz = z + td / 2, r = Math.min(tw, td) / 2;
  b.setColor(has(w, 'fueltank') ? I.white : I.tin); b.prismY(0, h, cx, cz, r, r, 12);
  b.setColor(I.steelD);
  for (let y = 0.8; y < h; y += 1.1) b.prismY(y, y + 0.08, cx, cz, r + 0.03, r + 0.03, 12);
  b.prismY(h, h + 0.35, cx, cz, r, r * 0.3, 12);
  b.setColor(I.black); box3(b, cx - 0.2, 0, z + td - 0.02, 0.4, h, 0.06);
}

// A caravan wagon: a timber bed on wheels, canvas over hoops, bales roped on the back; or a rail boxcar.
function wagon(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: ww, d: wd, h } = w;
  const along = ww >= wd, L = along ? ww : wd, T = along ? wd : ww;
  if (has(w, 'boxcar')) {
    b.setColor(I.black); box3(b, x, 0, z, ww, 0.6, wd);
    b.setColor(hash(x, z) % 2 ? I.rust : I.redD); box3(b, x + 0.05, 0.6, z + 0.05, ww - 0.1, h - 0.6, wd - 0.1);
    b.setColor(I.tinD); box3(b, x - 0.05, h, z - 0.05, ww + 0.1, 0.12, wd + 0.1);
    b.setColor(I.beam); box3(b, x + ww / 2 - 1, 0.7, z + wd - 0.02, 2, h - 1, 0.05);
    return;
  }
  b.setColor(I.black);
  for (const t of [0.18, 0.82]) {
    if (along) { b.prismZ(z - 0.05, z + 0.1, x + ww * t, 0.5, 0.5, 0.5, 8); b.prismZ(z + wd - 0.1, z + wd + 0.05, x + ww * t, 0.5, 0.5, 0.5, 8); }
    else { b.prismX(x - 0.05, x + 0.1, 0.5, z + wd * t, 0.5, 0.5, 8); b.prismX(x + ww - 0.1, x + ww + 0.05, 0.5, z + wd * t, 0.5, 0.5, 8); }
  }
  b.setColor(I.beam); box3(b, x + 0.1, 0.55, z + 0.1, ww - 0.2, 0.35, wd - 0.2);
  // Canvas over hoops: a half-barrel along the wagon.
  const canvas = hash(x, z) % 3 === 0 ? I.plaster : hash(x, z) % 3 === 1 ? I.canvas : sc(I.saffron, 0.85);
  const segs = 6, r = T / 2 - 0.05, c0 = along ? z + wd / 2 : x + ww / 2, cover = L * 0.72;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI, a1 = ((i + 1) / segs) * Math.PI;
    b.setColor(sc(canvas, 0.85 + 0.25 * Math.sin((a0 + a1) / 2)));
    const p = (a, s) => along ? [x + 0.1 + s, 0.9 + Math.sin(a) * (h - 0.9), c0 + Math.cos(a) * r] : [c0 + Math.cos(a) * r, 0.9 + Math.sin(a) * (h - 0.9), z + 0.1 + s];
    b.quad(p(a0, 0), p(a1, 0), p(a1, cover), p(a0, cover), along ? [x + L / 2, -9, c0] : [c0, -9, z + L / 2]);
  }
  b.setColor(I.canvasB);
  for (let k = 0; k < 2; k++) { const s = cover + 0.2 + k * 0.6; if (along) box3(b, x + s, 0.9, z + 0.3, 0.55, 0.6 + rnd() * 0.2, wd - 0.6); else box3(b, x + 0.3, 0.9, z + s, ww - 0.6, 0.6 + rnd() * 0.2, 0.55); }
}

// A camel, couched or standing: a humped body, the long neck, a saddle blanket.
function camel(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  const along = cw >= cd, L = along ? cw : cd;
  const fur = hash(x, z) % 2 ? I.ochre : sc(I.sand, 0.92);
  const at = (s, y, t) => (along ? [x + s, y, z + cd / 2 + t] : [x + cw / 2 + t, y, z + s]);
  const bx = (s0, s1, y0, y1, t) => { const a = at(s0, y0, -t), c = at(s1, y1, t); box3(b, Math.min(a[0], c[0]), y0, Math.min(a[2], c[2]), Math.abs(c[0] - a[0]) || 2 * t, y1 - y0, Math.abs(c[2] - a[2]) || 2 * t); };
  b.setColor(sc(fur, 0.8));
  for (const s of [0.4, L - 0.6]) bx(s, s + 0.18, 0, h * 0.52, 0.3);
  b.setColor(fur);
  bx(0.25, L - 0.45, h * 0.5, h * 0.78, 0.36);
  b.prismY(h * 0.78, h, ...(along ? [x + L * 0.45, z + cd / 2] : [x + cw / 2, z + L * 0.45]), 0.34, 0.12, 6);
  bx(L - 0.55, L - 0.3, h * 0.65, h * 1.02, 0.12);
  bx(L - 0.55, L, h * 0.92, h * 1.06, 0.13);
  b.setColor(hash(x, z) % 2 ? I.crimson : I.indigo);
  bx(L * 0.3, L * 0.62, h * 0.74, h * 0.8, 0.4);
}

// Timber rail fence (the camel pen).
function railFence(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: fw, d: fd, h } = w;
  const long = fw >= fd, L = long ? fw : fd;
  b.setColor(I.beam);
  for (let s = 0; s <= L - 0.1; s += 2) { if (long) box3(b, x + s, 0, z, 0.14, h, fd); else box3(b, x, 0, z + s, fw, h, 0.14); }
  if (long) { box3(b, x + L - 0.14, 0, z, 0.14, h, fd); } else box3(b, x, 0, z + L - 0.14, fw, h, 0.14);
  b.setColor(sc(I.beam, 1.25));
  for (const y of [h * 0.45, h * 0.9]) { if (long) box3(b, x, y, z, fw, 0.1, fd); else box3(b, x, y, z, fw, 0.1, fd); }
}

// Chain-link fence on steel posts (Signal Ridge's yards): see-through mesh, barbed wire on top.
function chainFence(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: fw, d: fd, h } = w;
  const long = fw >= fd, L = long ? fw : fd;
  b.setColor(I.steelD);
  for (let s = 0; s <= L + 0.01; s += 2.5) { const o = Math.min(s, L - 0.08); if (long) b.prismY(0, h, x + o, z + fd / 2, 0.05, 0.05, 4); else b.prismY(0, h, x + fw / 2, z + o, 0.05, 0.05, 4); }
  b.setColor(I.steel);
  for (const y of [0.1, h * 0.5, h - 0.05]) { if (long) box3(b, x, y, z + fd / 2 - 0.02, fw, 0.04, 0.04); else box3(b, x + fw / 2 - 0.02, y, z, 0.04, 0.04, fd); }
  b.setColor(sc(I.steel, 0.8));
  for (let s = 0.25; s < L; s += 0.5) { if (long) box3(b, x + s, 0.1, z + fd / 2 - 0.01, 0.015, h - 0.15, 0.02); else box3(b, x + fw / 2 - 0.01, 0.1, z + s, 0.02, h - 0.15, 0.015); }
}

// Stone trough with water in it.
function trough(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: tw, d: td, h } = w;
  b.setColor(I.stone); box3(b, x, 0, z, tw, h, td);
  b.setColor(I.water); box3(b, x + 0.12, h - 0.06, z + 0.12, tw - 0.24, 0.07, td - 0.24);
}

// A two-wheeled handcart with sacks.
function handcart(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  const along = cw >= cd;
  b.setColor(I.black);
  if (along) { b.prismZ(z - 0.05, z + 0.08, x + cw * 0.5, 0.45, 0.45, 0.45, 8); b.prismZ(z + cd - 0.08, z + cd + 0.05, x + cw * 0.5, 0.45, 0.45, 0.45, 8); }
  else { b.prismX(x - 0.05, x + 0.08, 0.45, z + cd * 0.5, 0.45, 0.45, 8); b.prismX(x + cw - 0.08, x + cw + 0.05, 0.45, z + cd * 0.5, 0.45, 0.45, 8); }
  b.setColor(I.beam); box3(b, x + 0.1, 0.5, z + 0.1, cw - 0.2, 0.2, cd - 0.2);
  b.setColor(I.canvas); box3(b, x + 0.3, 0.7, z + 0.25, cw * 0.6, h - 0.7, cd - 0.5, 0.1);
}

// A stone well ring with a timber frame (the Citadel's courtyard).
function wellRing(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const cx = x + bw / 2, cz = z + bd / 2, r = Math.min(bw, bd) / 2;
  b.setColor(I.stone); b.prismY(0, h, cx, cz, r, r * 0.95, 10);
  b.setColor(I.water); b.prismY(h, h + 0.01, cx, cz, r * 0.7, r * 0.7, 10);
  b.setColor(I.beam);
  for (const s of [-1, 1]) box3(b, cx + s * (r - 0.15) - 0.07, h, cz - 0.07, 0.14, 1.5, 0.14);
  box3(b, cx - r, h + 1.4, cz - 0.07, 2 * r, 0.14, 0.14);
}

// Fuel pump, pickup truck, pipeline, sarcophagus, fire pit, wings and planes: the basin's small pieces.
function fuelPump(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  b.setColor(I.concrete); box3(ctx.b, w.x, 0, w.z, w.w, 0.2, w.d);
  b.setColor(I.crimson); box3(b, w.x + 0.3, 0.2, w.z + 0.35, w.w - 0.6, w.h - 0.2, w.d - 0.7);
  b.setColor(I.white); box3(b, w.x + 0.35, w.h - 0.4, w.z + 0.33, w.w - 0.7, 0.25, 0.04);
}
function pickup(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  const along = cw >= cd;
  const col = hash(x, z) % 2 ? sc(I.teal, 1.1) : sc(I.ochre, 0.9);
  b.setColor(I.black); box3(b, x + 0.1, 0, z + 0.1, cw - 0.2, 0.5, cd - 0.2);
  b.setColor(col); box3(b, x, 0.4, z, cw, 0.55, cd);
  if (along) box3(b, x + cw * 0.15, 0.95, z + 0.1, cw * 0.35, 0.45, cd - 0.2); else box3(b, x + 0.1, 0.95, z + cd * 0.15, cw - 0.2, 0.45, cd * 0.35);
  b.setColor(I.glowCool);
  if (along) box3(b, x + cw * 0.5 - 0.02, 1.0, z + 0.15, 0.03, 0.35, cd - 0.3); else box3(b, x + 0.15, 1.0, z + cd * 0.5 - 0.02, cw - 0.3, 0.35, 0.03);
}
function pipeline(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const along = w.w >= w.d;
  b.setColor(I.steelD);
  for (let s = 0.4; s < (along ? w.w : w.d); s += 2.5) { if (along) box3(b, w.x + s, 0, w.z + 0.2, 0.2, 0.5, w.d - 0.4); else box3(b, w.x + 0.2, 0, w.z + s, w.w - 0.4, 0.5, 0.2); }
  b.setColor(I.tin);
  if (along) b.prismX(w.x, w.x + w.w, w.h * 0.7, w.z + w.d / 2, w.d * 0.32, w.d * 0.32, 8); else b.prismZ(w.z, w.z + w.d, w.x + w.w / 2, w.h * 0.7, w.w * 0.32, w.w * 0.32, 8);
}
function sarcophagus(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  b.setColor(I.stone); box3(b, w.x, 0, w.z, w.w, w.h * 0.8, w.d);
  b.setColor(sc(I.stone, 1.1)); box3(b, w.x - 0.06, w.h * 0.8, w.z - 0.06, w.w + 0.12, w.h * 0.2, w.d + 0.12);
}
function firePit(ctx, w) {
  const { b, theme, glow, lamps } = ctx;
  const I = theme.ink;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  b.setColor(I.stoneD); b.prismY(0, w.h, cx, cz, w.w / 2, w.w / 2 - 0.1, 9);
  emissive(b, () => { b.setColor([1.0, 0.5, 0.18]); b.prismY(w.h, w.h + 0.5, cx, cz, w.w / 2 - 0.3, 0.05, 6); });
  glow.halo(cx, cz, 4, [0.2, 0.09, 0.02], 0.14, 14);
  lamps.push({ x: cx, z: cz, r: 8, col: [0.46, 0.22, 0.06] });
}
function wing(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  b.setColor(I.dish); box3(b, w.x, 0, w.z, w.w, w.h * 0.6, w.d);
  b.setColor(I.dishD); box3(b, w.x + 0.3, w.h * 0.6, w.z + 0.1, w.w - 0.6, w.h * 0.4, w.d - 0.2);
  b.setColor(I.crimson); box3(b, w.x + w.w - 1.2, w.h * 0.6, w.z - 0.01, 1, 0.1, w.d + 0.02);
}
function lightPlane(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: pw, d: pd } = w;
  b.setColor(I.white); box3(b, x, 0.5, z + pd / 2 - 0.4, pw, 0.8, 0.8);
  b.setColor(sc(I.white, 0.92)); box3(b, x + pw * 0.3, 1.2, z - 2.2, 1.2, 0.12, pd + 4.4);
  b.setColor(I.crimson); box3(b, x + pw - 0.6, 0.9, z + pd / 2 - 0.05, 0.5, 1.1, 0.1);
  b.setColor(I.black); for (const oz of [0.1, pd - 0.3]) box3(b, x + pw * 0.35, 0, z + oz, 0.3, 0.5, 0.2);
}

// The cargo plane's wreck: fuselage sides, the cockpit, the tail fin.
function hull(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: hw, d: hd, h } = w;
  if (has(w, 'cockpit') || has(w, 'tail')) {
    b.setColor(I.dishD); box3(b, x, 0, z, hw, h * 0.7, hd);
    b.setColor(I.dish); b.prismX(x, x + hw, h * 0.7, z + hd / 2, hd / 2, hd / 2 - 0.4, 8);
    if (has(w, 'tail')) { b.setColor(I.dish); b.loft([[[x, h * 0.9, z + hd / 2 - 0.1], [x + hw * 0.8, h * 0.9, z + hd / 2 - 0.1], [x + hw * 0.8, h * 0.9, z + hd / 2 + 0.1], [x, h * 0.9, z + hd / 2 + 0.1]], [[x, h + 3, z + hd / 2 - 0.06], [x + 1.6, h + 3, z + hd / 2 - 0.06], [x + 1.6, h + 3, z + hd / 2 + 0.06], [x, h + 3, z + hd / 2 + 0.06]]]); b.setColor(I.crimson); box3(b, x + 0.2, h + 1.8, z + hd / 2 - 0.12, 1.2, 0.6, 0.24); }
    else { b.setColor(I.black); box3(b, x + hw - 1.4, h * 0.65, z + 0.4, 1, 0.5, hd - 0.8); }
    return;
  }
  // A fuselage side: a curved skin panel, ribs, torn edges, the paint band.
  b.setColor(I.dish); box3(b, x, 0, z, hw, h, hd);
  b.setColor(I.dishD);
  for (let s = 0.4; s < hw; s += 1.2) box3(b, x + s, 0, z - 0.02, 0.1, h, hd + 0.04);
  b.setColor(I.indigo); box3(b, x, h * 0.55, z - 0.03, hw, 0.35, hd + 0.06);
  b.setColor(sc(I.sand, 1.05));
  for (let i = 0; i < hw / 3; i++) b.prismY(0, 0.3 + rnd() * 0.4, x + rnd() * hw, z + (rnd() < 0.5 ? -0.5 : hd + 0.5), 0.7, 0.1, 6, rnd());
}

// Sand dune: a long smooth ridge of sand, steep on the lee (east) side.
function dune(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: dw, d: dd, h } = w;
  const along = dw >= dd, L = along ? dw : dd, T = along ? dd : dw;
  const n = Math.max(3, Math.round(L / 2));
  const prof = [[0, 0], [0.45, 0.85], [0.62, 1], [1, 0]];
  for (let i = 0; i < n; i++) {
    const s0 = (i / n) * L, s1 = ((i + 1) / n) * L, k0 = Math.sin((i / n) * Math.PI) * 0.7 + 0.3, k1 = Math.sin(((i + 1) / n) * Math.PI) * 0.7 + 0.3;
    for (let j = 0; j < prof.length - 1; j++) {
      const [ta, ya] = prof[j], [tb, yb] = prof[j + 1];
      const p = (s, t, y, k) => (along ? [x + s, y * h * k, z + t * T] : [x + t * T, y * h * k, z + s]);
      b.setColor(sc(j === 2 ? I.sandD : j === 1 ? I.sandL : I.sand, 1));
      b.quad(p(s0, ta, ya, k0), p(s0, tb, yb, k0), p(s1, tb, yb, k1), p(s1, ta, ya, k1), along ? [x + L / 2, -9, z + T / 2] : [x + T / 2, -9, z + L / 2]);
    }
  }
}

// An acacia: a thin crooked trunk and a flat, wide crown (from above a dark umbrella that hides little).
function acacia(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2, h = w.h;
  b.setColor(I.trunkD); b.prismY(0, h * 0.7, cx, cz, 0.2, 0.12, 5);
  for (const a of [0.4, 2.4, 4.2]) { b.setColor(I.trunk); b.prismY(h * 0.6, h * 0.85, cx + Math.cos(a) * 0.4, cz + Math.sin(a) * 0.4, 0.08, 0.05, 4); }
  b.setColor(I.palm); b.prismY(h * 0.82, h * 0.92, cx, cz, 2.0 + rnd() * 0.4, 1.7, 7, rnd());
  b.setColor(I.palmD); b.prismY(h * 0.92, h, cx + 0.2, cz - 0.2, 1.5, 0.8, 7, rnd());
}

// The Necropolis's obelisks.
function obelisk(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  b.setColor(I.stoneD); box3(b, w.x - 0.1, 0, w.z - 0.1, w.w + 0.2, 0.4, w.d + 0.2);
  b.setColor(I.stone); b.prismY(0.4, w.h, cx, cz, w.w * 0.42, w.w * 0.28, 4, Math.PI / 4);
  b.setColor(I.saffron); b.prismY(w.h, w.h + 0.4, cx, cz, w.w * 0.28, 0.02, 4, Math.PI / 4);
}

// A palm in a stone bed (Date Grove).
function palmBed(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.stone); box3(b, x, 0, z, bw, h * 0.5, bd, 0.08);
  const cx = x + bw / 2, cz = z + bd / 2, th = 4 + rnd() * 1.4;
  b.setColor(I.trunk); b.prismY(0, th, cx, cz, 0.18, 0.13, 6);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rnd(), len = 1.8 + rnd() * 0.5;
    b.setColor(i % 2 ? I.palm : I.palmD);
    b.tri([cx, th + 0.1, cz], [cx + Math.cos(a - 0.2) * len * 0.6, th + 0.15, cz + Math.sin(a - 0.2) * len * 0.6], [cx + Math.cos(a) * len, th - 0.6, cz + Math.sin(a) * len], [cx, th - 5, cz]);
  }
}

// A spring pool: a sandstone kerb, a reed fringe.
function spring(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  b.setColor(I.mudD);
  for (const [x0, z0, x1, z1] of [[w.x, w.z, w.x + w.w, w.z], [w.x + w.w, w.z, w.x + w.w, w.z + w.d], [w.x + w.w, w.z + w.d, w.x, w.z + w.d], [w.x, w.z + w.d, w.x, w.z]]) b.quad([x0, 0.02, z0], [x1, 0.02, z1], [x1, WATER_Y - 0.5, z1], [x0, WATER_Y - 0.5, z0], [(x0 + x1) / 2 + (z1 - z0), -0.3, (z0 + z1) / 2 - (x1 - x0)]);
  b.setColor(I.stone);
  for (let s = 0; s < w.w; s += 0.8) { box3(b, w.x + s, 0, w.z - 0.35, 0.7, 0.16, 0.35); box3(b, w.x + s, 0, w.z + w.d, 0.7, 0.16, 0.35); }
  for (let s = 0; s < w.d; s += 0.8) { box3(b, w.x - 0.35, 0, w.z + s, 0.35, 0.16, 0.7); box3(b, w.x + w.w, 0, w.z + s, 0.35, 0.16, 0.7); }
  b.setColor(I.grass);
  for (let i = 0; i < (w.w + w.d); i++) b.prismY(WATER_Y, 0.4 + rnd() * 0.5, w.x + 0.3 + rnd() * (w.w - 0.6), rnd() < 0.5 ? w.z + 0.2 : w.z + w.d - 0.2, 0.1, 0.02, 3, rnd() * 3);
}

// Canopy stall: a trestle with goods, a striped cloth on four poles.
function canopyStall(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: sw, d: sd, h } = w;
  const cols = [I.crimson, I.saffron, I.teal, I.indigo];
  b.setColor(I.crateD); box3(b, x, 0, z, sw, h * 0.75, sd);
  b.setColor(I.crate); box3(b, x - 0.04, h * 0.75, z - 0.04, sw + 0.08, 0.08, sd + 0.08);
  const L = Math.max(sw, sd), long = sw >= sd;
  for (let i = 0; i < L / 0.45 - 1; i++) {
    b.setColor(sc(cols[(i + hash(x, z)) % 4], 0.8 + rnd() * 0.3));
    const a = 0.2 + i * 0.45;
    if (long) b.prismY(h * 0.83, h * 0.83 + 0.2, x + a, z + sd / 2, 0.18, 0.12, 6); else b.prismY(h * 0.83, h * 0.83 + 0.2, x + sw / 2, z + a, 0.18, 0.12, 6);
  }
  b.setColor(I.beam);
  for (const [px, pz] of [[x + 0.06, z + 0.06], [x + sw - 0.06, z + 0.06], [x + 0.06, z + sd - 0.06], [x + sw - 0.06, z + sd - 0.06]]) b.prismY(0, 2.1, px, pz, 0.04, 0.035, 4);
  const ca = cols[hash(x, z) % 4], n = Math.ceil(L / 0.5);
  for (let i = 0; i < n; i++) {
    b.setColor(i % 2 ? ca : I.plaster);
    const s0 = (i / n) * L, s1 = ((i + 1) / n) * L;
    if (long) b.quad([x + s0, 2.2, z - 0.1], [x + s0, 2.0, z + sd + 0.1], [x + s1, 2.0, z + sd + 0.1], [x + s1, 2.2, z - 0.1]);
    else b.quad([x - 0.1, 2.2, z + s0], [x + sw + 0.1, 2.0, z + s0], [x + sw + 0.1, 2.0, z + s1], [x - 0.1, 2.2, z + s1]);
  }
}

// The spice pavilion: a striped tent with a scalloped valance, brass finial, spice sacks round it.
function pavilion(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: pw, d: pd, h } = w;
  const cx = x + pw / 2, cz = z + pd / 2;
  b.setColor(sc(I.crimson, 0.8)); box3(b, x + 0.05, 0, z + 0.05, pw - 0.1, h * 0.8, pd - 0.1);
  const n = 8;
  for (let i = 0; i < n; i++) {
    b.setColor(i % 2 ? I.crimson : I.saffron);
    const a0 = (i / n) * Math.PI * 2 + Math.PI / 8, a1 = ((i + 1) / n) * Math.PI * 2 + Math.PI / 8;
    const rx = pw * 0.7, rz = pd * 0.7;
    b.tri([cx + Math.cos(a0) * rx, h * 0.8, cz + Math.sin(a0) * rz], [cx + Math.cos(a1) * rx, h * 0.8, cz + Math.sin(a1) * rz], [cx, h + 1, cz], [cx, -9, cz]);
  }
  b.setColor(I.saffron); b.prismY(h + 1, h + 1.4, cx, cz, 0.06, 0.02, 4);
  const S = [I.saffron, I.crimson, I.ochre, I.copper];
  for (let k = 0; k < 4; k++) { b.setColor(S[k]); b.prismY(0, 0.5, x + 0.4 + k * (pw - 0.8) / 3, z + pd - 0.35, 0.25, 0.18, 6); }
}

// Grain and spice sacks: lumpy bags in a pile.
function sacks(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: sw, d: sd, h } = w;
  const long = sw >= sd, L = long ? sw : sd;
  for (let r = 0; r < 2; r++) for (let s = r * 0.3; s < L - 0.4; s += 0.6) {
    b.setColor(sc(rnd() < 0.3 ? I.saffron : I.canvas, 0.85 + rnd() * 0.2));
    const y = r * h * 0.5;
    if (long) box3(b, x + s, y, z + 0.05, 0.55, h * 0.5 - 0.02, sd - 0.1, 0.12); else box3(b, x + 0.05, y, z + s, sw - 0.1, h * 0.5 - 0.02, 0.55, 0.12);
  }
}

// Oil drums and cable spools.
function drums(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: dw, d: dd, h } = w;
  const cols = [I.rust, I.teal, I.crimson];
  for (const [ox, oz] of [[0.4, 0.4], [dw - 0.4, 0.4], [0.4, dd - 0.4], [dw - 0.4, dd - 0.4]]) {
    b.setColor(cols[hash(x + ox, z + oz) % 3]); b.prismY(0, h, x + ox, z + oz, 0.36, 0.36, 8);
    b.setColor(I.black); b.prismY(h, h + 0.02, x + ox, z + oz, 0.3, 0.3, 8);
  }
}
function spool(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: sw, d: sd, h } = w;
  b.setColor(I.beam); b.prismX(x, x + 0.15, h / 2, z + sd / 2, h / 2, h / 2, 10); b.prismX(x + sw - 0.15, x + sw, h / 2, z + sd / 2, h / 2, h / 2, 10);
  b.setColor(I.black); b.prismX(x + 0.15, x + sw - 0.15, h / 2, z + sd / 2, h * 0.38, h * 0.38, 10);
}

// Mine and station machinery: the haul truck, the crusher house, transformers, generators, the drill rig, a bowser.
function haulTruck(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: tw, d: td, h } = w;
  b.setColor(I.black);
  for (const t of [0.15, 0.75]) { b.prismZ(z - 0.1, z + 0.5, x + tw * t + 0.5, 0.75, 0.75, 0.75, 10); b.prismZ(z + td - 0.5, z + td + 0.1, x + tw * t + 0.5, 0.75, 0.75, 0.75, 10); }
  b.setColor(I.saffron); box3(b, x + 0.2, 0.8, z + 0.2, tw - 0.4, 0.6, td - 0.4);
  b.loft([[[x + 1.4, 1.4, z + 0.1], [x + tw, 1.4, z + 0.1], [x + tw, 1.4, z + td - 0.1], [x + 1.4, 1.4, z + td - 0.1]], [[x + 1.2, h, z], [x + tw + 0.2, h, z], [x + tw + 0.2, h, z + td], [x + 1.2, h, z + td]]]);
  b.setColor(I.ore); box3(b, x + 1.4, h - 0.2, z + 0.2, tw - 1.4, 0.1, td - 0.4);
  b.setColor(sc(I.saffron, 0.85)); box3(b, x, 1.4, z + 0.3, 1.2, 1.2, td - 0.6);
  b.setColor(I.glowCool); box3(b, x - 0.02, 1.8, z + 0.5, 0.04, 0.6, td - 1);
}
function crusher(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  b.setColor(I.concrete); box3(b, x, 0, z, cw, h * 0.4, cd);
  b.setColor(I.tin); box3(b, x + 0.2, h * 0.4, z + 0.2, cw - 0.4, h * 0.6, cd - 0.4);
  b.setColor(I.rust); box3(b, x + 0.1, h, z + 0.1, cw - 0.2, 0.15, cd - 0.2);
  b.setColor(I.steelD);
  b.quad([x + cw / 2 - 0.4, h * 0.8, z + cd], [x + cw / 2 + 0.4, h * 0.8, z + cd], [x + cw / 2 + 0.4, 1.2, z + cd + 3.5], [x + cw / 2 - 0.4, 1.2, z + cd + 3.5], [x + cw / 2, -9, z + cd + 2]);
}
function transformer(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: tw, d: td, h } = w;
  b.setColor(I.concrete); box3(b, x - 0.1, 0, z - 0.1, tw + 0.2, 0.2, td + 0.2);
  b.setColor(I.copperD); box3(b, x, 0.2, z, tw, h - 0.4, td);
  b.setColor(I.white);
  for (const ox of [0.3, tw / 2, tw - 0.3]) b.prismY(h - 0.4, h + 0.3, x + ox, z + td / 2, 0.08, 0.06, 6);
}
function generator(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: gw, d: gd, h } = w;
  b.setColor(I.steelD); box3(b, x, 0, z, gw, 0.25, gd);
  b.setColor(hash(x, z) % 2 ? I.saffron : I.teal); box3(b, x + 0.1, 0.25, z + 0.1, gw - 0.2, h - 0.25, gd - 0.2);
  b.setColor(I.black); for (let s = 0.4; s < Math.max(gw, gd) - 0.4; s += 0.3) { if (gw >= gd) box3(b, x + s, h * 0.4, z + gd - 0.09, 0.12, h * 0.4, 0.02); else box3(b, x + gw - 0.09, h * 0.4, z + s, 0.02, h * 0.4, 0.12); }
  b.setColor(I.steel); b.prismY(h, h + 0.6, x + 0.5, z + 0.5, 0.1, 0.1, 6);
}
function drillRig(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: rw, d: rd, h } = w;
  b.setColor(I.black); box3(b, x, 0, z, rw, 0.5, 0.4); box3(b, x, 0, z + rd - 0.4, rw, 0.5, 0.4);
  b.setColor(I.saffron); box3(b, x + 0.1, 0.5, z + 0.2, rw - 0.2, h * 0.5, rd - 0.4);
  b.setColor(I.steelD); box3(b, x + rw - 0.6, 0.5, z + rd / 2 - 0.2, 0.4, h + 2.6, 0.4);
}
function truck(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: tw, d: td, h } = w;
  const along = tw >= td;
  b.setColor(I.black); box3(b, x + 0.2, 0, z + 0.2, tw - 0.4, 0.6, td - 0.4);
  b.setColor(I.white); if (along) box3(b, x + 1.4, 0.6, z, tw - 1.4, h - 0.6, td); else box3(b, x, 0.6, z + 1.4, tw, h - 0.6, td - 1.4);
  b.setColor(I.teal); if (along) box3(b, x, 0.6, z + 0.15, 1.3, h * 0.65, td - 0.3); else box3(b, x + 0.15, 0.6, z, tw - 0.3, h * 0.65, 1.3);
}

// ---- Dress table -----------------------------------------------------------------------------------------------

const KIT_BUILDING = (ctx, w) => ctx.kit.building(ctx.b, w, ctx.rnd, ctx.lamps);
export const dress = {
  building: (c, w) => (has(w, 'towerhouse') || has(w, 'tower') ? towerHouse(c, w) : has(w, 'souk') ? soukShop(c, w) : has(w, 'merchant') ? merchantHouse(c, w)
    : has(w, 'tinshed') ? tinShed(c, w) : has(w, 'mineoffice') ? mineOffice(c, w) : has(w, 'dish') ? dishAntenna(c, w) : has(w, 'prefab') ? prefabHut(c, w)
    : has(w, 'control') ? controlBlock(c, w) : towerHouse(c, w)),
  adobe: (c, w) => (has(w, 'ksar') ? ksarTower(c, w) : adobe(c, w)),
  wall: (c, w) => (has(w, 'serai') ? seraiWall(c, w) : has(w, 'pillar') ? pillar(c, w) : has(w, 'arch') ? archPier(c, w) : has(w, 'wellhouse') ? wellHouse(c, w)
    : has(w, 'acacia') ? acacia(c, w) : has(w, 'obelisk') ? obelisk(c, w) : has(w, 'rampart') ? rampart(c, w) : adobeScreen(c, w)),
  rock: (c, w) => (has(w, 'cliff') ? cliff(c, w) : has(w, 'spoil') ? spoil(c, w) : has(w, 'slag') ? spoil(c, w, c.theme.ink.slag)
    : has(w, 'saltheap') ? spoil(c, w, c.theme.ink.salt) : has(w, 'dune') ? dune(c, w) : rockMass(c, w.x, w.z, w.w, w.d, w.h, { levels: w.w > 6 || w.d > 6 ? 4 : 3 })),
  boulder: (c, w) => (has(w, 'palm') ? palmBed(c, w) : rockMass(c, w.x, w.z, w.w, w.d, w.h, { levels: 2, colour: c.theme.ink.rockL })),
  barrier: (c, w) => (has(w, 'terrace') ? terraceFace(c, w) : has(w, 'orecart') ? oreCart(c, w) : has(w, 'rail') ? railFence(c, w) : has(w, 'fence') ? chainFence(c, w)
    : has(w, 'camel') ? camel(c, w) : has(w, 'trough') ? trough(c, w) : has(w, 'cart') ? handcart(c, w) : has(w, 'well') ? wellRing(c, w)
    : has(w, 'pump') ? fuelPump(c, w) : has(w, 'car') ? pickup(c, w) : has(w, 'pipe') ? pipeline(c, w) : has(w, 'sarcophagus') ? sarcophagus(c, w)
    : has(w, 'fire') ? firePit(c, w) : has(w, 'wing') ? wing(c, w) : has(w, 'plane') ? lightPlane(c, w) : trough(c, w)),
  container: (c, w) => (has(w, 'wagon') ? wagon(c, w) : has(w, 'hopper') ? hopper(c, w) : has(w, 'magazine') ? magazine(c, w) : has(w, 'drill') ? drillRig(c, w)
    : has(w, 'haultruck') ? haulTruck(c, w) : has(w, 'crusher') ? crusher(c, w) : has(w, 'transformer') ? transformer(c, w) : has(w, 'generator') ? generator(c, w)
    : has(w, 'truck') || has(w, 'bowser') ? truck(c, w) : has(w, 'tank') ? uprightTank(c, w) : container(c.b, w, c.rnd)),
  crate: (c, w) => (has(w, 'drums') ? drums(c, w) : has(w, 'spool') ? spool(c, w) : crate(c.b, w, c.rnd)),
  crane: (c, w) => (has(w, 'headframe') ? headframe(c, w) : has(w, 'watertower') ? waterTower(c, w) : radioMast(c, w)),
  tent: (c, w) => (has(w, 'pavilion') ? pavilion(c, w) : tent(c, w)),
  stall: canopyStall,
  sandbag: (c, w) => (has(w, 'sacks') ? sacks(c, w) : sandbags(c, w)),
  hull,
  water: spring,
  border: (c, w) => cliff(c, { ...w, h: w.h + 2 }),
  shop: KIT_BUILDING,
};

// ---- Ground, paint, lights, decor (6v6) -----------------------------------------------------------------------

const zonesOf = map => map.zones || [];
const zoneAt = (map, x, z) => { let k = null; for (const r of zonesOf(map)) if (x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d) k = r.kind; return k; };

function ground(ctx) {
  const { map, noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  return p => {
    const [x, , z] = p;
    const n = 0.92 + noise(x * 0.5, z * 0.5) * 0.16 + (rnd() - 0.5) * 0.04;
    if (!(x > 0 && x < W && z > 0 && z < H)) return sc(noise(x * 0.1, z * 0.1) > 0.55 ? I.sandD : I.sand, 0.74 + noise(x * 0.12, z * 0.12) * 0.2);
    const k = zoneAt(map, x, z);
    const rip = Math.sin((x * 0.8 + z * 0.35 + noise(x * 0.2, z * 0.2) * 5) * 2.2) * 0.04;
    if (k === 'road') return sc(noise(x * 0.3, z * 0.9) > 0.5 ? I.dirt : sc(I.dirt, 0.92), n);
    if (k === 'souk' || k === 'gulchsq') return sc((Math.floor(x / 1.2) + Math.floor(z / 1.2)) % 2 ? I.stone : I.stoneD, n);
    if (k === 'serai') return sc((Math.floor(x / 2) + Math.floor(z / 2)) % 2 ? I.sandL : sc(I.stone, 0.98), n);
    if (k === 'ledge') return sc(noise(x * 0.4, z * 0.4) > 0.5 ? I.rockL : I.ochre, n * 0.94);
    if (k === 'pit') return sc(noise(x * 0.2, z * 0.2) > 0.6 ? I.copperD : I.ore, n);
    if (k === 'step') return sc(I.spoil, n);
    if (k === 'bench') return sc(I.spoilD, n * 1.05);
    if (k === 'pad' || k === 'compound') return sc(I.concrete, n * 0.95);
    return sc(noise(x * 0.12 + 5, z * 0.12) > 0.56 ? I.sandL : I.sand, n + rip);
  };
}

function paint(ctx) {
  const { b, map, rnd, W, theme } = ctx;
  const I = theme.ink;
  const solid = (x, z, p = 0.3) => map.walls.some(w => w.kind !== 'border' && x > w.x - p && x < w.x + w.w + p && z > w.z - p && z < w.z + w.d + p);
  // Wheel ruts down the road.
  for (const r of zonesOf(map)) {
    if (r.kind !== 'road') continue;
    for (const off of [-1.2, 1.2]) {
      let zc = r.z + r.d / 2 + off;
      for (let x = r.x; x < r.x + r.w; x += 0.8) {
        zc += (rnd() - 0.5) * 0.12; zc += (r.z + r.d / 2 + off - zc) * 0.05;
        if (solid(x, zc)) continue;
        b.setColor(sc(I.dirt, 0.7 + rnd() * 0.08)); b.groundRect(x, zc - 0.12, 0.8, 0.24, 0.035);
      }
    }
  }
  // Mine tracks under the ore carts: sleepers and rails along the pit floor.
  const tracks = [...new Set(map.walls.filter(w => w.orecart).map(w => +(w.z + w.d / 2).toFixed(1)))];
  for (const tz of tracks) {
    b.setColor(I.tie);
    for (let x = 1; x < W - 1; x += 0.8) if (!solid(x, tz, 0.1) || map.walls.some(w => w.orecart && Math.abs(w.z + w.d / 2 - tz) < 0.2 && x > w.x - 0.2 && x < w.x + w.w + 0.2)) box3(b, x, 0.02, tz - 0.7, 0.2, 0.06, 1.4);
    b.setColor(I.rail);
    for (const o of [-0.45, 0.4]) box3(b, 1, 0.08, tz + o, W - 2, 0.06, 0.06);
  }
  // Stones and grit; dark scrub tufts.
  for (let i = 0; i < map.width * map.height / 30; i++) {
    const x = 1 + rnd() * (W - 2), z = 1 + rnd() * (map.height - 2);
    if (solid(x, z)) continue;
    if (rnd() < 0.25) { b.setColor(sc(I.palmD, 0.8 + rnd() * 0.3)); b.prismY(0, 0.25 + rnd() * 0.25, x, z, 0.3, 0.05, 5, rnd() * 3); continue; }
    b.setColor(sc(I.rock, 0.7 + rnd() * 0.3)); b.prismY(0.02, 0.12, x, z, 0.12 + rnd() * 0.14, 0.05, 5, rnd() * 3);
  }
}

function lights(ctx) {
  const { map, lamps } = ctx;
  for (const w of map.walls) if (w.landmark) lamps.push({ x: w.x + w.w / 2, z: w.z + w.d / 2, r: 7, col: [0.3, 0.17, 0.06] });
}

function decor(ctx) {
  const { b, W, H, rnd, theme } = ctx;
  const I = theme.ink;
  // Red mesas on the horizon (tall north, low south so the camera's view stays clear), dunes between.
  for (let x = -30; x < W + 30; x += 12 + rnd() * 8) {
    rockMass(ctx, x, -16 - rnd() * 8, 10 + rnd() * 8, 8 + rnd() * 5, 8 + rnd() * 8, { levels: 5 });
    if (rnd() < 0.6) dune(ctx, { x: x + 2, z: H + 3 + rnd() * 4, w: 9 + rnd() * 5, d: 4, h: 1.4 + rnd() });
  }
  for (let z = -8; z < H + 8; z += 10 + rnd() * 5) {
    rockMass(ctx, -14 - rnd() * 4, z, 9, 8, 6 + rnd() * 6, { levels: 4 });
    rockMass(ctx, W + 5 + rnd() * 4, z, 9, 8, 6 + rnd() * 6, { levels: 4 });
  }
  b.setColor(sc(I.palmD, 0.7));
  for (let i = 0; i < 30; i++) b.prismY(0, 0.4 + rnd() * 0.4, -6 + rnd() * (W + 12), H + 1.5 + rnd() * 3, 0.5, 0.08, 5, rnd() * 3);
  // The dusk sky: the sun's last orange low in the west, violet and plum overhead, a band of dust along the horizon.
  skyRing(ctx, { low: [0.16, 0.08, 0.06], mid: [0.42, 0.22, 0.2], warm: [0.9, 0.44, 0.18], high: [0.2, 0.14, 0.26], warmDir: [-1, 0.15], y0: -10, y1: 9, y2: 60 });
  // The sun itself, a swollen disc in the haze.
  const sx = -60, sz = H * 0.45;
  ctx.glow.halo(sx, sz, 14, [0.5, 0.22, 0.06], 6, 18);
}

export const sirocco = {
  dress,
  stage: { lights, ground, paint, decor },
  thumb: { ground: '#9a7a5c', solid: '#7a4232', low: '#a8845e', water: '#2a4a4a', edge: '#34202c' },
};
