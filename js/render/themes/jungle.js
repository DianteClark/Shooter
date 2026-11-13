// Jungle region (Ruins, Canopy, Riverbend, Expedition): a hot, humid afternoon under a hazy sun. Rich greens, pale
// temple limestone furred with moss, red laterite paths, jade water, thatch and tin. Everything is merged into the
// world mesh like every theme; foliage is a handful of faceted clumps per plant, kept inside its footprint so what you
// see is what blocks you. Exported as { dress, stage, thumb } for world.js; registers its palette in THEMES.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, mix, blockedAt, mass, skyRing, rimPoints, waterBanks, WATER_Y } from './kit.js';

const norm = v => { const l = Math.hypot(...v); return v.map(c => c / l); };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));

THEMES.jungle = {
  id: 'jungle',
  light: { dir: norm([-0.42, 0.78, 0.46]), sun: [0.92, 0.8, 0.56], sky: [0.3, 0.37, 0.31], amb: [0.22, 0.25, 0.21] },
  clear: 0x1b2617,
  fog: [0.44, 0.56, 0.4], fogSeam: [0.16, 0.2, 0.06], desatTint: [0.84, 0.9, 0.78],
  shadow: { col: [0.3, 0.42, 0.3], strength: 0.6, len: 0.85 },
  lamp: [0.36, 0.24, 0.1],
  groundAmp: 0.16,
  water: { deep: [0.03, 0.15, 0.12], shallow: [0.1, 0.33, 0.26], glint: [0.85, 0.95, 0.7] },
  ink: ink({
    ground: 0x4c5c2e, asphalt: 0x8f8a74, dirt: 0x7e5434, gravel: 0x6e6a50,
    roof: 0x5a6a44, wall: 0xa89c7c, wallB: 0x8e866a, trim: 0x3a3828,
    concrete: 0x9a9888, crate: 0x8a6a40, crateD: 0x4e3a24,
    rail: 0x6a6a60, tie: 0x3a3228, hazardY: 0xb09a3a, hazardK: 0x262a22,
    paint: 0xd8d0b0, glow: 0xffc070, glowCool: 0xd8f0d0,
    rock: 0xb0a27e, rockD: 0x887c60, rockL: 0xcbbd96, moss: 0x52692c, mossD: 0x3e5426,
    leaf: 0x386c2a, leafD: 0x244a20, leafL: 0x5c8a32, leafY: 0x7e963c, bark: 0x5e4630, barkD: 0x3e2e20,
    vine: 0x4e8a34, bloom: 0xd8463a, bloomY: 0xe8b83a, mud: 0x5a4430, grass: 0x5a7232, grassD: 0x3e5426,
    thatch: 0x9a7846, thatchD: 0x6e5430, timber: 0x6a4a2e, plank: 0x8c6a44, bamboo: 0xa8a050, bambooD: 0x7a7a38,
    tin: 0x8a949a, rust: 0x8e5a36, canvas: 0x7a7e4e, canvasD: 0x5a5e38, white: 0xd8d4c4, olive: 0x5a6438,
    steel: 0x6e747a, tyre: 0x22221e, glass: 0x2a3a40, coffee: 0x2e5a26, cherry: 0xb8302a,
  }),
  containers: [0x5a6a44, 0x6a5a40, 0x4a5a5a],
  weather: { fields: [
    { kind: 'mote', count: 26, box: [46, 3.5, 36], vel: [0.5, 0.02, 0.2], size: 4.4, col: [0.9, 0.95, 0.75], alpha: 0.06 },
    { kind: 'mote', count: 70, box: [38, 5, 30], vel: [0.3, 0.12, 0.15], size: 0.08, col: [1.0, 0.95, 0.6], alpha: 0.6 },
    { kind: 'mote', count: 24, box: [36, 2.5, 28], vel: [0.4, 0.3, -0.2], size: 0.13, col: [0.75, 1.0, 0.45], alpha: 0.85 },
    { kind: 'leaf', count: 22, box: [40, 8, 30], vel: [0.35, -0.5, 0.15], size: 0.5, col: [0.42, 0.64, 0.22], alpha: 0.92 },
  ] },
};

let K = null;       // Palette of the map being built (theme.ink).

// ---- Foliage ---------------------------------------------------------------------------------------------------

// A leafy clump: a squat faceted dome, darker underneath.
function clump(b, x, y, z, r, hgt, top, rnd) {
  b.setColor(scale(K.leafD, 0.9 + rnd() * 0.15));
  b.prismY(y, y + hgt * 0.45, x, z, r * 0.7, r, 6, rnd() * 3);
  b.setColor(top);
  b.prismY(y + hgt * 0.45, y + hgt, x, z, r, r * 0.3, 6, rnd() * 3);
}

// A fan of fern fronds from (x, z): flat-ish blades that rise and droop.
function frondFan(b, x, z, n, len, y0, rnd, col = K.leafL) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5, l = len * (0.75 + rnd() * 0.4);
    const ex = x + Math.cos(a) * l, ez = z + Math.sin(a) * l, mx = x + Math.cos(a) * l * 0.5, mz = z + Math.sin(a) * l * 0.5;
    const px = -Math.sin(a) * l * 0.18, pz = Math.cos(a) * l * 0.18;
    b.setColor(scale(col, 0.85 + rnd() * 0.25));
    b.tri([x, y0, z], [mx + px, y0 + l * 0.5, mz + pz], [ex, y0 + l * 0.15, ez], [x, y0 - 3, z]);
    b.tri([x, y0, z], [ex, y0 + l * 0.15, ez], [mx - px, y0 + l * 0.5, mz - pz], [x, y0 - 3, z]);
  }
}

// Kapok / fig: flared buttress roots, a tall trunk, a canopy kept close over the footprint.
function tree(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: tw, d: td, h } = w;
  const cx = x + tw / 2, cz = z + td / 2, r = Math.min(tw, td) / 2;
  b.setColor(K.bark);
  for (let k = 0; k < 5; k++) {
    const a = k * 1.2566 + rnd() * 0.4, ex = cx + Math.cos(a) * r * 0.95, ez = cz + Math.sin(a) * r * 0.95;
    b.loft([
      [[cx - 0.15, 0, cz - 0.15], [ex, 0, ez], [cx + 0.15, 0, cz + 0.15]],
      [[cx - 0.1, h * 0.4, cz - 0.1], [cx + Math.cos(a) * 0.35, h * 0.4, cz + Math.sin(a) * 0.35], [cx + 0.1, h * 0.4, cz + 0.1]],
    ]);
  }
  b.setColor(scale(K.bark, 1.1));
  b.prismY(0, h + 0.4, cx, cz, r * 0.5, r * 0.32, 7, rnd());
  b.setColor(K.vine);
  b.prismY(0.3, h * 0.85, cx + r * 0.32, cz + r * 0.3, 0.07, 0.05, 4);
  if (rnd() < 0.5) { b.setColor(K.bloom); b.prismY(h * 0.5, h * 0.62, cx + r * 0.3, cz + r * 0.4, 0.14, 0.05, 4); }
  const cr = r * 1.45;
  clump(b, cx, h - 0.4, cz, cr, 1.3, K.leaf, rnd);
  clump(b, cx + cr * 0.35, h + 0.5, cz - cr * 0.2, cr * 0.65, 1.0, K.leafL, rnd);
  clump(b, cx - cr * 0.3, h + 0.35, cz + cr * 0.3, cr * 0.6, 0.9, scale(K.leaf, 1.12), rnd);
}

// Dense growth filling its footprint: a dark core, then irregular clumps at varied heights (staggered, not a grid),
// ferns at the camera-facing foot, a few flowers.
function thicket(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: tw, d: td, h } = w;
  b.setColor(K.leafD);
  box3(b, x + 0.15, 0, z + 0.15, tw - 0.3, h * 0.5, td - 0.3);
  const n = Math.max(2, Math.round((tw * td) / 2.2));
  for (let i = 0; i < n; i++) {
    const r = Math.min(tw, td) * (0.28 + rnd() * 0.14);
    const cx = x + r * 0.8 + rnd() * Math.max(0.01, tw - r * 1.6), cz = z + r * 0.8 + rnd() * Math.max(0.01, td - r * 1.6);
    const y = h * (0.25 + rnd() * 0.3);
    const top = rnd() < 0.35 ? K.leafL : rnd() < 0.5 ? scale(K.leaf, 1.08) : K.leaf;
    b.setColor(scale(K.leafD, 0.95 + rnd() * 0.15));
    b.prismY(y, y + (h - y) * 0.5, cx, cz, r * 0.75, r, 7, rnd() * 3);
    b.setColor(top);
    b.prismY(y + (h - y) * 0.5, h + rnd() * 0.25, cx, cz, r, r * 0.45, 7, rnd() * 3);
  }
  for (let s = 0.4; s < tw - 0.2; s += 0.8) frondFan(b, x + s, z + td - 0.3, 4, 0.55, 0.05, rnd);
  if (rnd() < 0.7) {
    b.setColor(rnd() < 0.5 ? K.bloom : K.bloomY);
    for (let k = 0; k < 3; k++) b.prismY(h * 0.62, h * 0.62 + 0.12, x + 0.3 + rnd() * (tw - 0.6), z + td - 0.22, 0.1, 0.06, 4);
  }
}

// Banana grove: ringed trunks and long ragged blades.
function banana(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: tw, d: td, h } = w;
  b.setColor(K.grassD);
  box3(b, x + 0.15, 0, z + 0.15, tw - 0.3, h * 0.35, td - 0.3);
  const nx = Math.max(1, Math.round(tw / 1.4)), nz = Math.max(1, Math.round(td / 1.4));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const cx = x + (i + 0.5) * tw / nx + (rnd() - 0.5) * 0.3, cz = z + (j + 0.5) * td / nz + (rnd() - 0.5) * 0.3;
    const th = h * (0.55 + rnd() * 0.2);
    b.setColor(K.bambooD);
    b.prismY(0, th, cx, cz, 0.16, 0.12, 5);
    const reach = Math.min(tw / nx, td / nz) * 0.75;
    for (let k = 0; k < 6; k++) {
      const a = k * 1.047 + rnd() * 0.4, ex = cx + Math.cos(a) * reach, ez = cz + Math.sin(a) * reach;
      const px = -Math.sin(a) * 0.32, pz = Math.cos(a) * 0.32;
      b.setColor(rnd() < 0.3 ? K.leafY : rnd() < 0.5 ? K.leafL : K.leaf);
      b.quad([cx, th, cz], [cx + px * 0.5 + (ex - cx) * 0.5, th + 0.6, cz + pz * 0.5 + (ez - cz) * 0.5], [ex, h - 0.3, ez], [cx - px * 0.5 + (ex - cx) * 0.5, th + 0.55, cz - pz * 0.5 + (ez - cz) * 0.5], [cx, th - 4, cz]);
    }
  }
}

// ---- Stone -----------------------------------------------------------------------------------------------------

// Temple masonry: limestone courses, a carved band, moss on top and vines down the camera side; the top is broken.
function ruinWall(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: rw, d: rd, h } = w;
  const long = rw >= rd, L = long ? rw : rd;
  const n = Math.max(1, Math.round(L / 1.6));
  for (let i = 0; i < n; i++) {
    const s = (i / n) * L, e = ((i + 1) / n) * L;
    const top = h * (0.74 + rnd() * 0.26);
    const courses = Math.max(2, Math.round(top / 0.8));
    for (let c = 0; c < courses; c++) {
      const y0 = (c / courses) * top, y1 = ((c + 1) / courses) * top;
      b.setColor(scale(c === 1 ? K.rockL : c % 2 ? K.rock : K.rockD, 0.92 + rnd() * 0.14));
      const off = (c % 2) * 0.03;
      if (long) box3(b, x + s + 0.02, y0, z + off, e - s - 0.04, y1 - y0 - 0.03, rd - off * 2);
      else box3(b, x + off, y0, z + s + 0.02, rw - off * 2, y1 - y0 - 0.03, e - s - 0.04);
    }
    b.setColor(scale(K.moss, 0.9 + rnd() * 0.25));
    const m = 0.4 + rnd() * 0.5;
    if (long) box3(b, x + s + (e - s) * rnd() * (1 - m), top - 0.02, z + 0.04, (e - s) * m, 0.1, rd - 0.08);
    else box3(b, x + 0.04, top - 0.02, z + s + (e - s) * rnd() * (1 - m), rw - 0.08, 0.1, (e - s) * m);
    if (rnd() < 0.6) {
      b.setColor(K.vine);
      const vx = long ? x + s + (e - s) * rnd() : x + rw, vz = long ? z + rd : z + s + (e - s) * rnd();
      box3(b, vx - 0.07, top * (0.15 + rnd() * 0.3), vz - 0.01, 0.14, top * 0.7, 0.05);
    }
  }
}

function pillarOrStatue(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: pw, d: pd, h } = w;
  const cx = x + pw / 2, cz = z + pd / 2, r = Math.min(pw, pd) / 2;
  b.setColor(K.rockD);
  box3(b, x, 0, z, pw, 0.35, pd);
  if (w.ruin === 'statue') {
    // A seated guardian: plinth, body, a big carved head with jade eyes.
    b.setColor(K.rock);
    box3(b, x + 0.06, 0.35, z + 0.06, pw - 0.12, h * 0.38, pd - 0.12);
    b.setColor(K.rockL);
    box3(b, x + 0.1, 0.35 + h * 0.38, z + 0.1, pw - 0.2, h * 0.42, pd - 0.2, 0.06);
    b.setColor(K.rockD);
    box3(b, x + 0.02, h * 0.62, z + pd * 0.2, pw - 0.04, 0.16, pd * 0.6);
    b.setColor(K.moss);
    box3(b, x + 0.14, h - 0.06, z + 0.14, pw - 0.28, 0.1, pd - 0.28);
    emissive(b, () => { b.setColor([0.35, 0.95, 0.6]); box3(b, cx - 0.24, h * 0.7, z + pd - 0.08, 0.14, 0.08, 0.03); box3(b, cx + 0.1, h * 0.7, z + pd - 0.08, 0.14, 0.08, 0.03); });
    return;
  }
  b.setColor(K.rock);
  b.prismY(0.35, h - 0.4, cx, cz, r * 0.84, r * 0.76, 8, Math.PI / 8);
  b.setColor(K.rockD);
  for (let y = 0.9; y < h - 0.6; y += 0.75) b.prismY(y, y + 0.06, cx, cz, r * 0.86, r * 0.86, 8, Math.PI / 8);
  b.setColor(K.rockL);
  box3(b, x, h - 0.4, z, pw, 0.32, pd);
  b.setColor(K.moss);
  box3(b, x + 0.05, h - 0.1, z + 0.05, pw - 0.1, 0.12, pd - 0.1);
  if (rnd() < 0.6) { b.setColor(K.vine); box3(b, cx - 0.06, 0.4, z + pd - 0.02, 0.12, h * 0.6, 0.05); }
}

function fallen(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: sw, d: sd, h } = w;
  const long = sw >= sd, L = long ? sw : sd, n = Math.max(1, Math.round(L / 1.2));
  for (let i = 0; i < n; i++) {
    const s = (i / n) * L, e = ((i + 1) / n) * L, top = h * (0.65 + rnd() * 0.35);
    b.setColor(scale(K.rockL, 0.85 + rnd() * 0.2));
    if (long) box3(b, x + s + 0.04, 0, z + 0.04, e - s - 0.08, top, sd - 0.08, 0.06);
    else box3(b, x + 0.04, 0, z + s + 0.04, sw - 0.08, top, e - s - 0.08, 0.06);
    b.setColor(K.moss);
    if (long) box3(b, x + s + 0.1, top - 0.02, z + 0.1, (e - s) * 0.6, 0.07, sd - 0.2);
    else box3(b, x + 0.1, top - 0.02, z + s + 0.1, sw - 0.2, 0.07, (e - s) * 0.6);
  }
}

function fernBed(ctx, w) {
  const { b, rnd } = ctx;
  b.setColor(K.leafD);
  box3(b, w.x + 0.2, 0, w.z + 0.2, w.w - 0.4, w.h * 0.3, w.d - 0.4);
  const n = Math.max(2, Math.round((w.w * w.d) / 0.7));
  for (let i = 0; i < n; i++) {
    const fx = w.x + 0.3 + rnd() * (w.w - 0.6), fz = w.z + 0.3 + rnd() * (w.d - 0.6);
    frondFan(b, fx, fz, 6, Math.min(0.7, Math.min(w.w, w.d) * 0.5), w.h * 0.25, rnd, rnd() < 0.3 ? K.leafY : rnd() < 0.5 ? K.leafL : K.leaf);
  }
}

function logPiece(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: lw, d: ld, h } = w;
  const long = lw >= ld, r = (long ? ld : lw) / 2;
  b.setColor(K.bark);
  if (long) b.prismX(x + 0.05, x + lw - 0.05, r, z + ld / 2, r * 0.95, r * 0.85, 7, rnd());
  else b.prismZ(z + 0.05, z + ld - 0.05, x + lw / 2, r, r * 0.95, r * 0.85, 7, rnd());
  b.setColor(K.moss);
  if (long) box3(b, x + lw * 0.2, r * 1.75, z + ld * 0.3, lw * 0.5, 0.08, ld * 0.4);
  else box3(b, x + lw * 0.3, r * 1.75, z + ld * 0.2, lw * 0.4, 0.08, ld * 0.5);
  b.setColor(K.barkD);
  if (long) b.prismX(x, x + 0.06, r, z + ld / 2, r * 0.8, r * 0.8, 7); else b.prismZ(z, z + 0.06, x + lw / 2, r, r * 0.8, r * 0.8, 7);
}

function rockDress(ctx, w) {
  if (w.tree) return tree(ctx, w);
  if (w.thicket) return thicket(ctx, w);
  if (w.banana) return banana(ctx, w);
  if (w.ruin === true) return ruinWall(ctx, w);
  if (w.ruin) return pillarOrStatue(ctx, w);
  mass(ctx, w.x, w.z, w.w, w.d, w.h, { cols: [K.rock, K.rockD], cap: K.moss });
}

function boulderDress(ctx, w) {
  if (w.fern) return fernBed(ctx, w);
  if (w.log) return logPiece(ctx, w);
  return fallen(ctx, w);
}

// ---- Buildings -------------------------------------------------------------------------------------------------

// Hip roof over (x, z, w, d) from eave height y, rising `rise`, overhanging `o`. The ridge runs along the long side.
function hipRoof(b, x, y, z, w, d, rise, o, col, colD) {
  const x0 = x - o, x1 = x + w + o, z0 = z - o, z1 = z + d + o, cx = x + w / 2, cz = z + d / 2, top = y + rise;
  const under = [cx, y - 2, cz];
  if (w >= d) {
    const r = (w - d) / 2, A = [cx - r, top, cz], C = [cx + r, top, cz];
    b.setColor(colD); b.quad([x0, y, z0], [x1, y, z0], C, A, under);
    b.setColor(col); b.quad([x1, y, z1], [x0, y, z1], A, C, under);
    b.setColor(scale(col, 0.9)); b.tri([x0, y, z1], [x0, y, z0], A, under);
    b.setColor(scale(col, 1.06)); b.tri([x1, y, z0], [x1, y, z1], C, under);
  } else {
    const r = (d - w) / 2, A = [cx, top, cz - r], C = [cx, top, cz + r];
    b.setColor(scale(col, 0.9)); b.quad([x0, y, z1], [x0, y, z0], A, C, under);
    b.setColor(scale(col, 1.06)); b.quad([x1, y, z0], [x1, y, z1], C, A, under);
    b.setColor(colD); b.tri([x0, y, z0], [x1, y, z0], A, under);
    b.setColor(col); b.tri([x1, y, z1], [x0, y, z1], C, under);
  }
}

// Thatched hut on stilts: posts, a plank floor, woven walls, a deep thatch roof, a lantern in the door.
function hut(ctx, w) {
  const { b, glow, lamps, rnd } = ctx;
  const { x, z, w: hw, d: hd, h } = w;
  const floor = 0.9;
  b.setColor(K.timber);
  for (const [px, pz] of [[x + 0.1, z + 0.1], [x + hw - 0.3, z + 0.1], [x + 0.1, z + hd - 0.3], [x + hw - 0.3, z + hd - 0.3], [x + hw / 2 - 0.1, z + hd - 0.3]]) box3(b, px, 0, pz, 0.2, floor, 0.2);
  b.setColor(K.mud);
  box3(b, x + 0.3, 0, z + 0.3, hw - 0.6, 0.3, hd - 0.6);
  b.setColor(K.plank);
  box3(b, x, floor - 0.12, z, hw, 0.14, hd);
  b.setColor(K.bamboo);
  box3(b, x + 0.15, floor, z + 0.15, hw - 0.3, h - floor - 1.1, hd - 0.3);
  b.setColor(K.bambooD);
  for (let u = 0.4; u < hw - 0.3; u += 0.5) box3(b, x + u, floor, z + hd - 0.17, 0.06, h - floor - 1.1, 0.04);
  b.setColor(0x2a2016);
  box3(b, x + hw / 2 - 0.4, floor, z + hd - 0.16, 0.8, 1.3, 0.03);
  emissive(b, () => { b.setColor([1.0, 0.7, 0.32]); box3(b, x + hw / 2 + 0.55, floor + 1.0, z + hd - 0.1, 0.14, 0.2, 0.08); });
  lamps.push({ x: x + hw / 2, z: z + hd + 1.2, r: 3.4, col: [0.3, 0.2, 0.08] });
  glow.halo(x + hw / 2 + 0.6, z + hd + 0.3, 1.4, [0.12, 0.07, 0.02]);
  hipRoof(b, x, h - 1.15, z, hw, hd, 1.15, 0.18, scale(K.thatch, 0.95 + rnd() * 0.1), K.thatchD);
  b.setColor(K.thatchD);
  box3(b, x - 0.18, h - 1.2, z + hd + 0.12, hw + 0.36, 0.08, 0.06);
}

// Research cabin: raised on blocks, painted boards, a corrugated tin roof, lit windows and an aerial.
function lab(ctx, w) {
  const { b, glow, lamps } = ctx;
  const { x, z, w: lw, d: ld, h } = w;
  b.setColor(K.concrete);
  box3(b, x + 0.1, 0, z + 0.1, lw - 0.2, 0.5, ld - 0.2);
  b.setColor(K.white);
  box3(b, x + 0.05, 0.5, z + 0.05, lw - 0.1, h - 1.1, ld - 0.1);
  b.setColor(K.olive);
  box3(b, x, 0.5, z, lw, 0.25, ld);
  emissive(b, () => {
    b.setColor([0.95, 0.9, 0.62]);
    for (let u = 0.6; u < lw - 0.8; u += 1.6) box3(b, x + u, 1.4, z + ld - 0.02, 0.8, 0.6, 0.04);
  });
  for (let u = 0.6; u < lw - 0.8; u += 1.6) lamps.push({ x: x + u + 0.4, z: z + ld + 1, r: 2.6, col: [0.22, 0.2, 0.1] });
  glow.streak(x + lw / 2, z + ld + 0.1, lw * 0.6, 1.6, [0.07, 0.065, 0.03], 0.07);
  // Corrugated roof: alternating strips, a gentle pitch toward the camera.
  const y0 = h - 0.6;
  for (let u = -0.2, i = 0; u < lw + 0.2; u += 0.32, i++) {
    b.setColor(i % 2 ? K.tin : scale(K.tin, 0.82));
    b.quad([x + u, y0 + 0.5, z - 0.2], [x + u + 0.32, y0 + 0.5, z - 0.2], [x + u + 0.32, y0, z + ld + 0.2], [x + u, y0, z + ld + 0.2], [x + lw / 2, y0 - 3, z + ld / 2]);
  }
  b.setColor(K.rust);
  b.quad([x + lw * 0.2, y0 + 0.36, z + ld * 0.3], [x + lw * 0.45, y0 + 0.36, z + ld * 0.3], [x + lw * 0.45, y0 + 0.26, z + ld * 0.6], [x + lw * 0.2, y0 + 0.26, z + ld * 0.6], [x + lw / 2, y0 - 3, z + ld / 2]);
  b.setColor(K.steel);
  b.prismY(y0 + 0.4, h + 1.8, x + lw - 0.4, z + 0.4, 0.04, 0.03, 4);
  emissive(b, () => { b.setColor([1, 0.25, 0.2]); box3(b, x + lw - 0.46, h + 1.8, z + 0.34, 0.12, 0.12, 0.12); });
}

function tent(ctx, w) {
  const { b } = ctx;
  const { x, z, w: tw, d: td, h } = w;
  const ew = tw >= td;
  b.setColor(K.canvas);
  if (ew) b.loft([[[x, 0, z], [x, h, z + td / 2], [x, 0, z + td]], [[x + tw, 0, z], [x + tw, h, z + td / 2], [x + tw, 0, z + td]]]);
  else b.loft([[[x, 0, z], [x + tw / 2, h, z], [x + tw, 0, z]], [[x, 0, z + td], [x + tw / 2, h, z + td], [x + tw, 0, z + td]]]);
  b.setColor(K.canvasD);
  if (ew) box3(b, x + tw - 0.05, 0, z + td / 2 - 0.4, 0.06, h * 0.6, 0.8);
  else box3(b, x + tw / 2 - 0.4, 0, z + td - 0.05, 0.8, h * 0.6, 0.06);
  b.setColor(K.timber);
  box3(b, x - 0.05, h - 0.05, z + td / 2 - 0.05, tw + 0.1, 0.1, 0.1);
}

// The stepped temple: terraces up to a shrine with a dark doorway, a stair up the camera-facing side.
function temple(ctx, w, steps = 4) {
  const { b, glow, lamps } = ctx;
  const { x, z, w: sw, d: sd, h } = w;
  const top = h - 1.3, sh = top / steps, inset = Math.min(sw, sd) * 0.09;
  for (let i = 0; i < steps; i++) {
    const k = i * inset;
    b.setColor(scale(i % 2 ? K.rockD : K.rock, 1));
    box3(b, x + k, i * sh, z + k, sw - 2 * k, sh, sd - 2 * k);
    b.setColor(K.moss);
    box3(b, x + k + 0.05, (i + 1) * sh - 0.03, z + k + 0.05, sw - 2 * k - 0.1, 0.06, 0.3);
    box3(b, x + k + 0.05, (i + 1) * sh - 0.03, z + sd - k - 0.35, sw - 2 * k - 0.1, 0.06, 0.3);
  }
  // Stair: a run of light treads down the south face.
  b.setColor(K.rockL);
  const sw2 = Math.min(1.6, sw * 0.28);
  for (let i = 0; i < steps * 2; i++) box3(b, x + sw / 2 - sw2 / 2, i * sh / 2, z + sd - (i * inset) / 2 - 0.3, sw2, sh / 2, 0.3);
  const k = steps * inset;
  b.setColor(K.rockL);
  box3(b, x + k + 0.2, top, z + k + 0.2, sw - 2 * k - 0.4, 1.0, sd - 2 * k - 0.4);
  b.setColor(K.rockD);
  b.prismY(top + 1.0, h, x + sw / 2, z + sd / 2, Math.min(sw, sd) / 2 - k, 0.15, 4, Math.PI / 4);
  b.setColor(0x1a140e);
  box3(b, x + sw / 2 - 0.35, top, z + sd - k - 0.22, 0.7, 0.8, 0.04);
  emissive(b, () => { b.setColor([1.0, 0.6, 0.24]); box3(b, x + sw / 2 - 0.22, top + 0.05, z + sd - k - 0.19, 0.44, 0.55, 0.03); });
  lamps.push({ x: x + sw / 2, z: z + sd + 1, r: 4, col: [0.3, 0.18, 0.06] });
  glow.halo(x + sw / 2, z + sd + 0.4, 2.2, [0.12, 0.06, 0.02]);
  b.setColor(K.vine);
  box3(b, x + 0.3, 0.1, z + sd - 0.02, 0.14, top * 0.7, 0.05);
  box3(b, x + sw - 0.5, 0.3, z + sd - inset - 0.02, 0.14, top * 0.5, 0.05);
}

// Ruins' altar: three steps, an offering bowl with a fire.
function altar(ctx, w) {
  const { b, glow, lamps } = ctx;
  const { x, z, w: aw, d: ad, h } = w;
  for (let i = 0; i < 3; i++) {
    const k = i * 0.45;
    b.setColor(i % 2 ? K.rockD : K.rock);
    box3(b, x + k, i * 0.7, z + k, aw - 2 * k, 0.7, ad - 2 * k);
    b.setColor(K.moss);
    box3(b, x + k + 0.04, (i + 1) * 0.7 - 0.03, z + k + 0.04, aw - 2 * k - 0.08, 0.06, 0.25);
  }
  b.setColor(K.rockL);
  box3(b, x + 1.4, 2.1, z + 1.4, aw - 2.8, h - 2.5, ad - 2.8);
  b.setColor(0x2a241c);
  b.prismY(h - 0.4, h, x + aw / 2, z + ad / 2, 0.38, 0.55, 8);
  emissive(b, () => { b.setColor([1.0, 0.56, 0.18]); b.prismY(h - 0.05, h + 0.45, x + aw / 2, z + ad / 2, 0.38, 0.04, 6); });
  lamps.push({ x: x + aw / 2, z: z + ad / 2, r: 7, col: [0.4, 0.22, 0.06] });
  glow.halo(x + aw / 2, z + ad / 2, 4.2, [0.16, 0.08, 0.02]);
}

// Canopy's lookout: four legs, a platform, a thatched cap, and the rope bridges' anchor.
function lookout(ctx, w) {
  const { b, glow } = ctx;
  const { x, z, w: tw, d: td, h } = w;
  b.setColor(K.timber);
  for (const [px, pz] of [[x, z], [x + tw - 0.3, z], [x, z + td - 0.3], [x + tw - 0.3, z + td - 0.3]]) box3(b, px, 0, pz, 0.3, h - 0.6, 0.3);
  b.setColor(scale(K.timber, 0.8));
  for (const y of [0.8, 1.9]) { box3(b, x, y, z + td - 0.25, tw, 0.12, 0.12); box3(b, x, y, z + 0.1, tw, 0.12, 0.12); box3(b, x + 0.1, y, z, 0.12, 0.12, td); box3(b, x + tw - 0.25, y, z, 0.12, 0.12, td); }
  b.setColor(K.plank);
  box3(b, x - 0.1, h - 1.9, z - 0.1, tw + 0.2, 0.16, td + 0.2);
  b.setColor(K.bamboo);
  box3(b, x - 0.1, h - 1.74, z - 0.1, tw + 0.2, 0.55, 0.08); box3(b, x - 0.1, h - 1.74, z + td + 0.02, tw + 0.2, 0.55, 0.08);
  box3(b, x - 0.1, h - 1.74, z - 0.1, 0.08, 0.55, td + 0.2); box3(b, x + tw + 0.02, h - 1.74, z - 0.1, 0.08, 0.55, td + 0.2);
  b.setColor(K.timber);
  for (const [px, pz] of [[x, z], [x + tw - 0.12, z], [x, z + td - 0.12], [x + tw - 0.12, z + td - 0.12]]) box3(b, px, h - 1.8, pz, 0.12, 1.1, 0.12);
  hipRoof(b, x, h - 0.7, z, tw, td, 1.0, 0.12, K.thatch, K.thatchD);
  b.setColor(0xd8c040);
  box3(b, x + tw / 2 - 0.02, h + 0.3, z + td / 2 - 0.02, 0.04, 1.2, 0.04);
  emissive(b, () => { b.setColor([1, 0.85, 0.4]); box3(b, x + tw / 2 - 0.1, h - 1.5, z + td / 2 - 0.1, 0.2, 0.25, 0.2); });
  glow.halo(x + tw / 2, z + td / 2, 3, [0.08, 0.06, 0.02]);
}

// Expedition's control tower: a block base, a glazed cab, a windsock.
function controlTower(ctx, w) {
  const { b, glow, lamps } = ctx;
  const { x, z, w: tw, d: td, h } = w;
  b.setColor(K.white);
  box3(b, x + 0.3, 0, z + 0.3, tw - 0.6, h - 2.2, td - 0.6);
  b.setColor(scale(K.white, 0.82));
  for (let y = 0.9; y < h - 2.4; y += 1.2) box3(b, x + 0.28, y, z + 0.28, tw - 0.56, 0.08, td - 0.56);
  b.setColor(K.trim);
  box3(b, x, h - 2.2, z, tw, 0.2, td);
  b.setColor(K.glass);
  box3(b, x + 0.15, h - 2.0, z + 0.15, tw - 0.3, 1.3, td - 0.3);
  emissive(b, () => { b.setColor([0.55, 0.85, 0.75]); box3(b, x + 0.2, h - 1.6, z + td - 0.13, tw - 0.4, 0.5, 0.02); });
  b.setColor(K.rust);
  box3(b, x - 0.15, h - 0.7, z - 0.15, tw + 0.3, 0.25, td + 0.3);
  b.setColor(K.steel);
  b.prismY(h - 0.45, h + 1.6, x + tw - 0.3, z + 0.3, 0.04, 0.03, 4);
  b.setColor([0.95, 0.45, 0.15]);
  b.prismX(x + tw - 0.3, x + tw + 0.9, h + 1.4, z + 0.3, 0.16, 0.06, 5);
  lamps.push({ x: x + tw / 2, z: z + td + 1.5, r: 4.5, col: [0.18, 0.2, 0.14] });
  glow.halo(x + tw / 2, z + td + 0.8, 2.5, [0.04, 0.07, 0.06]);
}

// Plantation house: whitewashed walls, a veranda roof on posts, green shutters.
function house(ctx, w) {
  const { b, lamps } = ctx;
  const { x, z, w: hw, d: hd, h } = w;
  b.setColor(K.white);
  box3(b, x + 0.1, 0, z + 0.1, hw - 0.2, h - 1.3, hd - 0.2);
  b.setColor(K.trim);
  box3(b, x, 0, z, hw, 0.35, hd);
  b.setColor(0x3e6a44);
  for (let u = 0.6; u < hw - 0.6; u += 1.4) box3(b, x + u, 1.1, z + hd - 0.1, 0.7, 1.0, 0.04);
  emissive(b, () => { b.setColor([0.95, 0.82, 0.5]); for (let u = 0.6; u < hw - 0.6; u += 1.4) box3(b, x + u + 0.15, 1.2, z + hd - 0.08, 0.4, 0.8, 0.02); });
  lamps.push({ x: x + hw / 2, z: z + hd + 1.4, r: 4, col: [0.24, 0.18, 0.08] });
  hipRoof(b, x, h - 1.3, z, hw, hd, 1.3, 0.2, K.rust, scale(K.rust, 0.8));
}

function buildingDress(ctx, w) {
  if (w.altar) return altar(ctx, w);
  if (w.lookout) return lookout(ctx, w);
  if (w.temple) return temple(ctx, w);
  if (w.tower) return controlTower(ctx, w);
  if (w.house) return house(ctx, w);
  if (w.lab) return lab(ctx, w);
  hut(ctx, w);
}

// ---- Vehicles, walls and low cover -------------------------------------------------------------------------------

function truck(ctx, w) {
  const { b } = ctx;
  const { x, z, w: tw, d: td, h } = w;
  const long = tw >= td, L = long ? tw : td, T = long ? td : tw;
  const P = (u, v) => long ? [x + u, z + v] : [x + v, z + u];
  const box = (u, y, v, lu, hy, lv) => { const [px, pz] = P(u, v); box3(b, px, y, pz, long ? lu : lv, hy, long ? lv : lu); };
  b.setColor(K.tyre);
  for (const u of [0.5, L - 1.3]) { box(u, 0, 0, 0.8, 0.8, 0.25); box(u, 0, T - 0.25, 0.8, 0.8, 0.25); }
  b.setColor(K.olive);
  box(0.1, 0.5, 0.15, L - 0.2, 0.35, T - 0.3);
  box(L - 1.6, 0.85, 0.15, 1.5, 1.2, T - 0.3);
  b.setColor(K.glass);
  box(L - 0.12, 1.3, 0.3, 0.04, 0.55, T - 0.6);
  b.setColor(K.canvasD);
  box(0.15, 0.85, 0.12, L - 1.9, h - 0.85, T - 0.24);
  b.setColor(K.canvas);
  for (let u = 0.3; u < L - 1.9; u += 0.8) box(u, h - 0.05, 0.1, 0.1, 0.06, T - 0.2);
}

// A cargo plane, broken in two: a fuselage half with windows, the torn end facing the gap (the map centre).
function planeHalf(ctx, w) {
  const { b, map } = ctx;
  const { x, z, w: pw, d: pd, h } = w;
  const cz = z + pd / 2, r = pd / 2;
  const tornEast = x + pw / 2 < map.width / 2;
  b.setColor(K.white);
  b.prismX(x + 0.1, x + pw - 0.1, r + 0.05, cz, r * 0.98, r * 0.98, 8, Math.PI / 8);
  b.setColor(K.olive);
  b.prismX(x + 0.1, x + pw - 0.1, r * 0.55, cz, r * 1.0, r * 1.0, 8, Math.PI / 8);
  b.setColor(K.glass);
  for (let u = 0.8; u < pw - 0.8; u += 0.9) box3(b, x + u, r * 1.25, z + pd - 0.12, 0.4, 0.3, 0.05);
  b.setColor(0x2a2622);
  b.prismX(tornEast ? x + pw - 0.12 : x + 0.06, tornEast ? x + pw - 0.06 : x + 0.12, r + 0.05, cz, r * 0.85, r * 0.85, 8, Math.PI / 8);
  b.setColor(K.rust);
  box3(b, tornEast ? x + pw - 1.2 : x + 0.2, h - 0.2, cz - 0.4, 1.0, 0.12, 0.8);
  // The tail fin stands on the west half's far end, the nose cone on the east half's.
  b.setColor(K.white);
  if (tornEast) b.loft([[[x + 0.2, h - 0.3, cz - 0.1], [x + 2.2, h - 0.3, cz - 0.1], [x + 0.6, h + 1.8, cz - 0.1]], [[x + 0.2, h - 0.3, cz + 0.1], [x + 2.2, h - 0.3, cz + 0.1], [x + 0.6, h + 1.8, cz + 0.1]]]);
  else { b.setColor(K.glass); box3(b, x + pw - 0.5, r * 1.2, cz - r * 0.6, 0.3, 0.4, r * 1.2); }
}

function smallPlane(ctx, w) {
  const { b } = ctx;
  const { x, z, w: pw, d: pd, h } = w;
  const cz = z + pd / 2;
  b.setColor(K.tyre);
  box3(b, x + pw * 0.3, 0, z + 0.2, 0.3, 0.5, 0.3); box3(b, x + pw * 0.3, 0, z + pd - 0.5, 0.3, 0.5, 0.3);
  b.setColor(0xc8c0a8);
  b.prismX(x + 0.3, x + pw - 0.2, 1.1, cz, 0.55, 0.35, 6);
  b.setColor(0xb04a32);
  box3(b, x + pw * 0.38, 1.25, z, 1.2, 0.12, pd);
  b.setColor(K.glass);
  box3(b, x + pw * 0.62, 1.4, cz - 0.35, 0.7, 0.3, 0.7);
  b.setColor(0xc8c0a8);
  box3(b, x + 0.2, 1.3, cz - 0.05, 0.9, 1.2, 0.1);
  b.setColor(0x2a2622);
  box3(b, x + pw - 0.2, 0.5, cz - 1.0, 0.06, 1.2, 2.0);
}

function containerDress(ctx, w) {
  if (w.truck) return truck(ctx, w);
  if (w.plane) return w.w > 7 ? planeHalf(ctx, w) : smallPlane(ctx, w);
  const { b } = ctx;
  b.setColor(K.olive);
  box3(b, w.x, 0, w.z, w.w, w.h, w.d);
}

function bambooScreen(ctx, w) {
  const { b, rnd } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  b.setColor(K.bambooD);
  if (long) box3(b, w.x, 0, w.z + T * 0.25, w.w, w.h * 0.9, T * 0.5); else box3(b, w.x + T * 0.25, 0, w.z, T * 0.5, w.h * 0.9, w.d);
  for (let s = 0.08; s < L; s += 0.17) {
    const top = w.h * (0.88 + rnd() * 0.12);
    b.setColor(rnd() < 0.3 ? K.bambooD : K.bamboo);
    if (long) b.prismY(0, top, w.x + s, w.z + T / 2, 0.08, 0.07, 5); else b.prismY(0, top, w.x + T / 2, w.z + s, 0.08, 0.07, 5);
  }
  b.setColor(K.timber);
  for (const y of [0.6, w.h * 0.7]) { if (long) box3(b, w.x, y, w.z + T - 0.05, w.w, 0.08, 0.08); else box3(b, w.x + T - 0.05, y, w.z, 0.08, 0.08, w.d); }
}

function tinWall(ctx, w) {
  const { b } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d;
  for (let s = 0, i = 0; s < L; s += 0.9, i++) {
    b.setColor(i % 5 === 3 ? K.rust : i % 2 ? K.tin : scale(K.tin, 0.85));
    const e = Math.min(L, s + 0.9);
    if (long) box3(b, w.x + s, 0, w.z, e - s, w.h, w.d); else box3(b, w.x, 0, w.z + s, w.w, w.h, e - s);
  }
  b.setColor(K.steel);
  box3(b, w.x - 0.03, w.h - 0.1, w.z - 0.03, w.w + 0.06, 0.12, w.d + 0.06);
}

function wallDress(ctx, w) {
  if (w.tin) return tinWall(ctx, w);
  bambooScreen(ctx, w);
}

function cropRow(ctx, w) {
  const { b, rnd } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  b.setColor(K.mud);
  if (long) box3(b, w.x, 0, w.z, w.w, 0.12, w.d); else box3(b, w.x, 0, w.z, w.w, 0.12, w.d);
  for (let s = 0.45; s < L - 0.3; s += 0.9) {
    const cx = long ? w.x + s : w.x + T / 2, cz = long ? w.z + T / 2 : w.z + s, top = w.h * (0.85 + rnd() * 0.15);
    b.setColor(scale(K.coffee, 0.9 + rnd() * 0.2));
    b.prismY(0.1, top, cx, cz, T * 0.66, T * 0.3, 4, rnd());
    if (rnd() < 0.35) { b.setColor(K.cherry); b.tri([cx - 0.1, top * 0.7, cz + T * 0.45], [cx + 0.1, top * 0.7, cz + T * 0.45], [cx, top * 0.85, cz + T * 0.45], [cx, top * 0.7, cz]); }
  }
}

function drums(ctx, w) {
  const { b, rnd } = ctx;
  const n = Math.max(1, Math.round(w.w / 0.62)), m = Math.max(1, Math.round(w.d / 0.62));
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const cx = w.x + (i + 0.5) * w.w / n, cz = w.z + (j + 0.5) * w.d / m;
    b.setColor(rnd() < 0.5 ? K.rust : 0x3e5a3a);
    b.prismY(0, w.h, cx, cz, 0.29, 0.29, 6);
    b.setColor(K.steel);
    box3(b, cx - 0.15, w.h, cz - 0.15, 0.3, 0.02, 0.3);
  }
}

function wing(ctx, w) {
  const { b } = ctx;
  b.setColor(K.white);
  box3(b, w.x + 0.05, w.h - 0.45, w.z, w.w - 0.1, 0.3, w.d);
  b.setColor(K.olive);
  box3(b, w.x + 0.1, w.h - 0.16, w.z + 0.1, w.w - 0.2, 0.06, w.d - 0.2);
  b.setColor(K.steel);
  box3(b, w.x + w.w * 0.4, 0, w.z + w.d * 0.4, 0.2, w.h - 0.45, 0.2);
  b.setColor(0x2a2622);
  b.prismZ(w.z + w.d * 0.45, w.z + w.d * 0.75, w.x + w.w / 2, w.h - 0.6, 0.36, 0.36, 7);
}

function barrierDress(ctx, w) {
  if (w.crop) return cropRow(ctx, w);
  if (w.drums) return drums(ctx, w);
  if (w.wing) return wing(ctx, w);
  sandbags(ctx, w);
}

function sandbags(ctx, w) {
  const { b, rnd } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  const rows = 3, rh = w.h / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * 0.3;
    for (let s = -off; s < L; s += 0.7) {
      const a = Math.max(0, s), e = Math.min(L, s + 0.66);
      if (e - a < 0.12) continue;
      b.setColor(scale(K.canvas, 0.9 + rnd() * 0.2));
      if (long) box3(b, w.x + a, r * rh, w.z + 0.04, e - a, rh - 0.03, T - 0.08);
      else box3(b, w.x + 0.04, r * rh, w.z + a, T - 0.08, rh - 0.03, e - a);
    }
  }
}

function canoe(ctx, w) {
  const { b } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  const c = long ? [w.x, w.z + T / 2] : [w.x + T / 2, w.z];
  const pt = (u, v, y) => long ? [c[0] + u, y, c[1] + v] : [c[0] + v, y, c[1] + u];
  const ring = (u, half, y0, y1) => [pt(u, -half, y1), pt(u, half, y1), pt(u, half * 0.5, y0), pt(u, -half * 0.5, y0)];
  b.setColor(K.timber);
  b.loft([ring(0.05, 0.05, 0.3, w.h), ring(L * 0.25, T * 0.46, 0.05, w.h), ring(L * 0.75, T * 0.46, 0.05, w.h), ring(L - 0.05, 0.05, 0.3, w.h)]);
  b.setColor(K.barkD);
  const [ix, iz] = long ? [w.x + L * 0.2, w.z + 0.18] : [w.x + 0.18, w.z + L * 0.2];
  box3(b, ix, w.h - 0.01, iz, long ? L * 0.6 : T - 0.36, 0.02, long ? T - 0.36 : L * 0.6);
}

function crateDress(ctx, w, base) {
  if (w.canoe) return canoe(ctx, w);
  base(ctx, w);
  if (ctx.rnd() < 0.5) { ctx.b.setColor(K.vine); box3(ctx.b, w.x + 0.2, w.h - 0.02, w.z + 0.15, w.w * 0.5, 0.05, w.d * 0.3); }
}

function riverBank(ctx, w) {
  waterBanks(ctx, w, { face: scale(K.mud, 0.7), lip: K.mud, lip2: K.moss });
  // Reeds along the banks.
  const { b, rnd } = ctx;
  const n = Math.round((w.w + w.d) / 4.5);
  for (let i = 0; i < n; i++) {
    const onX = rnd() < 0.5, t = rnd();
    const x = onX ? w.x + t * w.w : (rnd() < 0.5 ? w.x + 0.25 : w.x + w.w - 0.25);
    const z = onX ? (rnd() < 0.5 ? w.z + 0.25 : w.z + w.d - 0.25) : w.z + t * w.d;
    b.setColor(rnd() < 0.5 ? K.grass : K.leafY);
    for (let k = 0; k < 3; k++) b.prismY(WATER_Y, 0.5 + rnd() * 0.5, x + (rnd() - 0.5) * 0.4, z + (rnd() - 0.5) * 0.4, 0.04, 0.01, 3);
  }
}

// The jungle wall at the map edge: broken rock with growth spilling over, never tidy.
function jungleBorder(ctx, w) {
  const { b, rnd } = ctx;
  const long = w.w > w.d, L = long ? w.w : w.d;
  for (let s = 0; s < L;) {
    const seg = 4 + rnd() * 3, e = Math.min(L, s + seg), hh = w.h + (rnd() - 0.5);
    if (long) mass(ctx, w.x + s, w.z, e - s, w.d, hh, { cols: [K.rockD, K.rock], cap: K.moss, levels: 2, sides: 5 });
    else mass(ctx, w.x, w.z + s, w.w, e - s, hh, { cols: [K.rockD, K.rock], cap: K.moss, levels: 2, sides: 5 });
    s = e;
  }
  for (let s = 0.6; s < L; s += 3.4 + rnd() * 2.2) {
    const cx = long ? w.x + s : w.x + w.w / 2, cz = long ? w.z + w.d / 2 : w.z + s, r = 0.9 + rnd() * 0.7;
    b.setColor(rnd() < 0.5 ? K.leaf : K.leafL);
    b.prismY(w.h * 0.6, w.h + 1 + rnd(), cx, cz, r, r * 0.3, 6, rnd() * 3);
  }
}

// ---- Ground, paint, lights, decor ---------------------------------------------------------------------------------

function inRoom(map, x, z, floor) {
  for (const r of map.rooms || []) if ((!floor || r.floor === floor) && x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d) return r;
  return null;
}

function ground(ctx) {
  const { map, noise, rnd, W, H } = ctx;
  const trees = map.walls.filter(w => w.tree || w.thicket || w.banana);
  const waters = map.walls.filter(w => w.kind === 'water');
  const laneDist = z => { let d = 99; for (const l of map.lanes) d = Math.min(d, Math.abs(z - l.z)); return d; };
  const near = (list, x, z, r) => list.some(w => x > w.x - r && x < w.x + w.w + r && z > w.z - r && z < w.z + w.d + r);
  return p => {
    const [x, , z] = p;
    ctx.groundWet = 0.1;
    if (x < 0 || z < 0 || x > W || z > H) return scale(K.leafD, 0.7 + noise(x * 0.2, z * 0.2) * 0.25);
    const room = inRoom(map, x, z);
    if (room?.floor === 'runway') return scale(K.asphalt, 0.8 + noise(x * 0.5, z * 0.5) * 0.14);
    if (room?.floor === 'concrete') return scale(K.concrete, 0.8 + noise(x, z) * 0.12);
    if (room?.floor === 'flags') return scale((Math.floor(x / 1.4) + Math.floor(z / 1.4)) % 3 === 0 ? K.rockD : K.rock, 0.82 + noise(x * 0.6, z * 0.6) * 0.18);
    if (near(waters, x, z, 1.3)) { ctx.groundWet = 0.8; return scale(K.mud, 0.85 + noise(x, z) * 0.2); }
    const dl = laneDist(z) + noise(x * 0.15, z * 0.15) * 2.2;
    const path = dl < 1.6 && noise(x * 0.35 + 3, z * 0.35) > 0.3;
    let base = path ? K.dirt : noise(x * 0.11 + 7, z * 0.11) > 0.58 ? K.grass : noise(x * 0.2, z * 0.2 + 4) > 0.64 ? K.moss : K.ground;
    if (near(trees, x, z, 1.2)) base = mix(base, K.leafD, 0.45);
    // Sun dapple through the canopy: warm bright patches.
    const sun = noise(x * 0.45 + 11, z * 0.45 + 2) > 0.68 ? 1.12 : 1;
    return scale(base, (0.9 + noise(x * 0.8, z * 0.8) * 0.16 + (rnd() - 0.5) * 0.05) * sun);
  };
}

function lights(ctx) {
  // Huts, labs and the temple push their own lanterns as they are dressed; the sun does the rest.
}

function paint(ctx) {
  const { b, map, rnd, W, H } = ctx;
  // Leaf litter, flowers and grass tufts; density capped so a Ground War map costs no more than a 6v6 one does.
  const n = Math.min(map.large ? 420 : 640, Math.round(W * H * 0.14));
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, z = rnd() * H;
    if (blockedAt(map, x, z, 0.05) || inRoom(map, x, z)) continue;
    const k = rnd();
    if (k < 0.3) {
      b.setColor(rnd() < 0.5 ? K.grass : K.leafY);
      for (let j = 0; j < 3; j++) { const a = rnd() * 6.28; b.tri([x, 0.02, z], [x + Math.cos(a) * 0.08, 0.02, z + Math.sin(a) * 0.08], [x + Math.cos(a + 0.4) * 0.25, 0.32 + rnd() * 0.2, z + Math.sin(a + 0.4) * 0.25]); }
      continue;
    }
    b.setColor(k < 0.36 ? K.bloom : k < 0.4 ? K.bloomY : k < 0.7 ? K.leaf : k < 0.9 ? K.leafD : scale(K.dirt, 1.2));
    const a = rnd() * 6.28, r = 0.12 + rnd() * 0.14;
    b.tri([x + Math.cos(a) * r, 0.05, z + Math.sin(a) * r], [x + Math.cos(a + 2.4) * r * 0.6, 0.05, z + Math.sin(a + 2.4) * r * 0.6], [x + Math.cos(a - 2.4) * r * 0.6, 0.05, z + Math.sin(a - 2.4) * r * 0.6]);
  }
  // Roots from every big tree.
  b.setColor(K.bark);
  for (const w of map.walls) {
    if (!w.tree) continue;
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
    for (let k = 0; k < 5; k++) {
      let a = k * 1.25 + rnd() * 0.5, x = cx + Math.cos(a) * w.w * 0.5, z = cz + Math.sin(a) * w.d * 0.5;
      for (let s = 0; s < 4; s++) {
        const nx = x + Math.cos(a) * 0.5, nz = z + Math.sin(a) * 0.5;
        if (s > 0 && blockedAt(map, nx, nz, 0)) break;
        b.quad([x, 0.06, z], [nx, 0.06, nz], [nx + Math.sin(a) * 0.08, 0.06, nz - Math.cos(a) * 0.08], [x + Math.sin(a) * 0.15, 0.06, z - Math.cos(a) * 0.15]);
        x = nx; z = nz; a += (rnd() - 0.5) * 0.8;
      }
    }
  }
  // Floors: plank bridges and decks, the ford's stepping stones, the dock's moored boats.
  for (const r of map.rooms || []) {
    if (r.floor === 'bridge' || r.floor === 'deck') {
      const along = r.floor === 'bridge' && r.d > r.w ? 'z' : 'x';
      // Planks run across the direction of travel.
      if (along === 'x') for (let x = r.x; x < r.x + r.w - 0.05; x += 0.42) { b.setColor(scale(K.plank, 0.85 + rnd() * 0.25)); box3(b, x, 0.02, r.z - (r.floor === 'bridge' ? 0.3 : 0), 0.38, 0.1, r.d + (r.floor === 'bridge' ? 0.6 : 0)); }
      else for (let z = r.z; z < r.z + r.d - 0.05; z += 0.42) { b.setColor(scale(K.plank, 0.85 + rnd() * 0.25)); box3(b, r.x - 0.3, 0.02, z, r.w + 0.6, 0.1, 0.38); }
      if (r.floor === 'bridge') {
        // Rope rails on posts, standing over the water just outside the walkway.
        const posts = along === 'x' ? [[r.z - 0.25], [r.z + r.d + 0.15]] : [[r.x - 0.25], [r.x + r.w + 0.15]];
        b.setColor(K.timber);
        for (const [o] of posts) {
          for (let s = 0; s <= 1.001; s += 0.5) {
            const px = along === 'x' ? r.x + s * r.w - 0.05 : o, pz = along === 'x' ? o : r.z + s * r.d - 0.05;
            box3(b, px, WATER_Y, pz, 0.1, 1.5 - WATER_Y, 0.1);
          }
          b.setColor(K.thatchD);
          if (along === 'x') box3(b, r.x, 1.1, o + 0.02, r.w, 0.05, 0.05); else box3(b, o + 0.02, 1.1, r.z, 0.05, 0.05, r.d);
          b.setColor(K.timber);
        }
      }
    } else if (r.floor === 'ford') {
      b.setColor(scale(K.mud, 0.75));
      box3(b, r.x, -0.05, r.z, r.w, 0.06, r.d);
      for (let i = 0; i < r.w * r.d * 0.5; i++) {
        b.setColor(scale(K.rockL, 0.75 + rnd() * 0.25));
        b.prismY(-0.02, 0.06 + rnd() * 0.06, r.x + 0.3 + rnd() * (r.w - 0.6), r.z + 0.3 + rnd() * (r.d - 0.6), 0.2 + rnd() * 0.25, 0.15, 6, rnd());
      }
      ctx.glow.halo(r.x + r.w / 2, r.z + r.d / 2, Math.max(r.w, r.d) * 0.45, [0.03, 0.05, 0.04], 0.1, 12);
    } else if (r.floor === 'runway') {
      // Faded markings: a dashed centre line, edge stripes, threshold bars at each end.
      const cz = r.z + r.d / 2;
      b.setColor(scale(K.paint, 0.8));
      for (let x = r.x + 6; x < r.x + r.w - 6; x += 4) if (!blockedAt(map, x + 1.2, cz, 0.1)) b.groundRect(x, cz - 0.15, 2.4, 0.3, 0.04);
      for (const ez of [r.z + 0.6, r.z + r.d - 0.85]) for (let x = r.x + 2; x < r.x + r.w - 2; x += 3) if (!blockedAt(map, x + 1.4, ez, 0.1)) b.groundRect(x, ez, 2.8, 0.25, 0.04);
      for (const ex of [r.x + 1, r.x + r.w - 3]) for (let z = r.z + 1.6; z < r.z + r.d - 1.6; z += 1.1) if (!blockedAt(map, ex + 1, z, 0.1)) b.groundRect(ex, z, 2, 0.5, 0.04);
    } else if (r.floor === 'dock') {
      // Three boats lashed side by side, gunwale to gunwale, decked over with planks.
      const n = 3, bw = r.d / n;
      for (let i = 0; i < n; i++) {
        b.setColor(i % 2 ? K.timber : scale(K.timber, 0.85));
        box3(b, r.x - 0.4, -0.3, r.z + i * bw + 0.05, r.w + 0.8, 0.36, bw - 0.1);
        b.setColor(i === 1 ? 0x3e6a6a : 0x8a3a2a);
        box3(b, r.x - 0.5, -0.1, r.z + i * bw + 0.02, r.w + 1.0, 0.12, 0.08);
      }
      for (let x = r.x; x < r.x + r.w; x += 0.5) { b.setColor(scale(K.plank, 0.85 + rnd() * 0.25)); box3(b, x, 0.04, r.z, 0.44, 0.08, r.d); }
    }
  }
}

function decor(ctx) {
  const { b, glow, rnd, W, H, map } = ctx;
  // The forest beyond the edge: big trees, close where the camera can see them, sparse further out.
  const count = Math.min(map.large ? 44 : 80, Math.round((W + H) * 0.42));
  for (const [x, z] of rimPoints(ctx, count, 4, 20)) {
    const hgt = 5 + rnd() * 5, cr = 2 + rnd() * 2;
    b.setColor(K.bark);
    b.prismY(0, hgt, x, z, 0.5, 0.32, 5, rnd());
    clump(b, x, hgt - 1.2, z, cr, 2, rnd() < 0.4 ? K.leafL : K.leaf, rnd);
    if (rnd() < 0.4) clump(b, x + cr * 0.4, hgt + 0.4, z - cr * 0.3, cr * 0.6, 1.2, K.leafL, rnd);
  }
  // A waterfall over a cliff where a stream leaves the north edge (Canopy): a rock face, a lit sheet of water, spray.
  for (const w of map.walls) {
    if (w.kind !== 'water' || w.z > 0.01 || w.w > 4) continue;
    mass(ctx, w.x - 7, -11, 6.6, 8, 8.5, { cols: [K.rockD, K.rock], cap: K.moss, levels: 3, taper: 0.2 });
    mass(ctx, w.x + w.w + 0.4, -11, 6.6, 8, 8, { cols: [K.rockD, K.rock], cap: K.moss, levels: 3, taper: 0.2 });
    b.setColor(K.rockD);
    box3(b, w.x - 0.6, 0, -11, w.w + 1.2, 7.4, 8.4);
    emissive(b, () => {
      b.setColor([0.5, 0.66, 0.64]);
      b.quad([w.x - 0.3, 0, -2.5], [w.x + w.w + 0.3, 0, -2.5], [w.x + w.w + 0.1, 7.6, -2.62], [w.x - 0.1, 7.6, -2.62], [w.x + w.w / 2, 3, -6]);
      b.setColor([0.8, 0.88, 0.86]);
      for (let k = 0; k < 4; k++) b.prismY(-0.1, 0.5, w.x + 0.3 + k * (w.w - 0.6) / 3, -1.9, 0.5, 0.2, 5, k);
    });
    glow.halo(w.x + w.w / 2, -1, 3.6, [0.12, 0.15, 0.13], 0.2, 12);
  }
  skyRing(ctx, { low: [0.16, 0.22, 0.14], mid: [0.42, 0.5, 0.4], warm: [0.7, 0.62, 0.42], high: [0.3, 0.42, 0.42], warmDir: [-0.4, -1], y0: -4, y1: 12, y2: 60 });
  // Humidity: soft mist pools over the water.
  for (const w of map.walls) if (w.kind === 'water') glow.halo(w.x + w.w / 2, w.z + w.d / 2, Math.max(w.w, w.d) * 0.5, [0.03, 0.045, 0.035], WATER_Y + 0.1, 10);
}

export default {
  dress: (base) => ({
    ...base,
    rock: rockDress, boulder: boulderDress, building: buildingDress, container: containerDress,
    wall: wallDress, barrier: barrierDress, sandbag: sandbags, tent, water: riverBank, border: jungleBorder,
    crate: (ctx, w) => crateDress(ctx, w, base.crate),
  }),
  stage: {
    // world.js calls these in order; `ground` replaces the ground shader, the rest add to the world mesh.
    lights: (ctx) => { K = ctx.theme.ink; lights(ctx); },
    ground: (ctx) => { K = ctx.theme.ink; return ground(ctx); },
    paint, decor,
  },
  thumb: { ground: '#5d6e36', solid: '#a89c7c', low: '#7a8a4a', water: '#1d5a48', edge: '#16200f' },
};
