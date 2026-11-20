// Observatory's theme (mountain, medium; js/shared/maps/observatory.js): a mountain-top observatory at first light.
// The sun just up in the east, low and rose-gold: sunlit snow goes pink, shadows long and lilac, granite near black,
// the dome silver with a copper band, a sea of cloud below the summit. Clearly not Frostline, Icebreaker or Polestar
// (night, sodium lamps, polar ice and rail wagons): high altitude, dawn colour, pines, timber and copper.
// world.js reads `observatory` ({ dress, stage, thumb }) into its tables and hands every drawer ctx.kit.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, mix, mass, rimPoints, skyRing, ball, lattice } from './kit.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));
const sc = scale;

THEMES.observatory = {
  id: 'observatory',
  light: { dir: norm([0.82, 0.4, 0.22]), sun: [1.0, 0.74, 0.7], sky: [0.4, 0.42, 0.62], amb: [0.33, 0.32, 0.44] },
  clear: 0x2e2a44,
  fog: [0.62, 0.56, 0.7], fogSeam: [0.16, 0.08, 0.1], desatTint: [0.88, 0.84, 0.94],
  shadow: { col: [0.5, 0.44, 0.7], strength: 0.6, len: 1.25 },
  lamp: [0.3, 0.2, 0.1],
  groundAmp: 0.18,
  ink: ink({
    ground: 0xc8c0cc, asphalt: 0x5c5a64, dirt: 0x7a6c66, gravel: 0x84808a,
    roof: 0x4a4650, wall: 0x9a8e88, wallB: 0x857a76, trim: 0x2e2c34,
    concrete: 0x8e8c94, crate: 0x7a5e44, crateD: 0x4e3c2c,
    rail: 0x8a909a, tie: 0x3a3230, hazardY: 0xb08a3a, hazardK: 0x26242a,
    paint: 0xd4ccd6, glow: 0xffd6a0, glowCool: 0xdce6ff,
    snow: 0xcac2ce, snowL: 0xd6cfd8, snowD: 0xaea8bc, path: 0x9a909c, pathD: 0x7e7684, ice: 0xa8b4c8,
    granite: 0x4c4852, graniteD: 0x38343e, graniteL: 0x625c66, lichen: 0x7a7a52,
    timber: 0x6a4a34, timberD: 0x45301f, stone: 0x7c7680, stoneD: 0x5e5862, shutter: 0x8a3430,
    silver: 0xb4b2ba, silverD: 0x8a8892, copper: 0x9a6a46, copperD: 0x6e4a34, steel: 0x8c929a, steelD: 0x5e646c,
    red: 0x9a3a32, redD: 0x6e2a26, black: 0x26242a, glass: 0x2a3040, pine: 0x2c3e34, pineD: 0x22302a, bark: 0x3e3028,
    panel: 0x2a3456, white: 0xd0ccd4,
  }),
  containers: [0x7a3a32, 0x4e5a6a, 0x6a5a48],
  weather: { fields: [
    // Spindrift blown off the ridge, glittering frost in the air, and the odd slow wisp of cloud coming over the top.
    { kind: 'streak', count: 110, box: [40, 1.4, 30], vel: [-6, 0.1, 1.2], len: 1.4, width: 0.03, col: [1, 0.94, 0.98], alpha: 0.2 },
    { kind: 'mote', count: 90, box: [40, 6, 30], vel: [-1.2, -0.2, 0.3], size: 0.07, col: [1, 0.92, 0.9], alpha: 0.5 },
    { kind: 'mote', count: 14, box: [46, 3, 34], vel: [-1.4, 0.05, 0.3], size: 5.5, col: [0.92, 0.86, 0.94], alpha: 0.06 },
  ] },
};

// ---- Ground ----------------------------------------------------------------------------------------------------

function obsGround(ctx) {
  const { map, noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const lanes = map.lanes.map(l => l.z);
  const dome = map.walls.find(w => w.dome);
  const cx = dome ? dome.x + dome.w / 2 : W / 2, cz = dome ? dome.z + dome.d / 2 : H / 2;
  return p => {
    const [x, , z] = p;
    const k = 0.92 + noise(x * 0.6, z * 0.6) * 0.12 + (rnd() - 0.5) * 0.04;
    ctx.groundWet = 0.15;
    if (x < 0 || z < 0 || x > W || z > H) {
      // Off the summit the ground falls away: wind-scoured snow and dark rock showing through.
      const n = noise(x * 0.1, z * 0.1);
      return sc(n > 0.6 ? I.graniteL : I.snowD, k * (0.78 - Math.min(0.3, Math.max(-x, x - W, -z, z - H, 0) * 0.012)));
    }
    // The flagged courtyard round the dome, swept clear.
    if (Math.abs(x - cx) < 11.5 && Math.abs(z - cz) < 9.5 && !(Math.abs(x - cx) > 8 && Math.abs(z - cz) > 6)) {
      ctx.groundWet = 0.35;
      return sc((Math.floor(x / 1.5) + Math.floor(z / 1.5)) % 2 ? I.stone : I.stoneD, k * 1.05);
    }
    // Trodden paths down the three lanes, wandering.
    let dl = 99;
    for (const lz of lanes) dl = Math.min(dl, Math.abs(z - lz - (noise(x * 0.07, lz) - 0.5) * 2.2));
    if (dl < 1.2) return sc(rnd() < 0.5 ? I.path : I.pathD, k);
    const n = noise(x * 0.15 + 4, z * 0.15);
    if (n > 0.7) return sc(I.graniteL, k);
    return sc(n > 0.55 ? I.snowL : n < 0.32 ? I.snowD : I.snow, k);
  };
}

function obsPaint(ctx) {
  const { b, map, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const solid = (x, z, p = 0.3) => map.walls.some(w => w.kind !== 'border' && x > w.x - p && x < w.x + w.w + p && z > w.z - p && z < w.z + w.d + p);
  // Boot prints along the paths and sastrugi (wind ridges) on the open snow.
  for (const lane of map.lanes) {
    for (let x = 1; x < W - 1; x += 0.7) {
      const z = lane.z + (rnd() - 0.5) * 1.6;
      if (solid(x, z)) continue;
      b.setColor(sc(I.pathD, 0.9));
      b.groundRect(x, z, 0.18, 0.28, 0.035);
    }
  }
  for (let i = 0; i < 70; i++) {
    const x = 1 + rnd() * (W - 2), z = 1 + rnd() * (H - 2), L = 1 + rnd() * 2;
    if (solid(x, z, 0.6) || solid(x + L, z, 0.6)) continue;
    b.setColor(sc(I.snowL, 1.03));
    b.loft([[[x, 0, z], [x, 0.14, z + 0.18], [x, 0, z + 0.4]], [[x + L, 0, z + 0.3], [x + L, 0.1, z + 0.45], [x + L, 0, z + 0.6]]]);
  }
  // Rocks breaking through the snow.
  for (let i = 0; i < 30; i++) {
    const x = 1 + rnd() * (W - 2), z = 1 + rnd() * (H - 2);
    if (solid(x, z, 0.5)) continue;
    b.setColor(rnd() < 0.5 ? I.granite : I.graniteL);
    b.prismY(0, 0.15 + rnd() * 0.25, x, z, 0.25 + rnd() * 0.35, 0.08, 5, rnd() * 3);
  }
}

function obsLights(ctx) {
  const { map, lamps, glow } = ctx;
  for (const w of map.walls) {
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
    if (w.lodge) { lamps.push({ x: cx, z: w.z + w.d + 1.6, r: 6, col: [0.42, 0.28, 0.12] }); glow.halo(cx, w.z + w.d + 1, 3.6, [0.12, 0.07, 0.02]); }
    if (w.station) lamps.push({ x: cx, z: w.z + w.d + 1.6, r: 6, col: [0.36, 0.26, 0.14] });
    if (w.dome) { lamps.push({ x: cx, z: cz + w.d / 2 + 2, r: 7, col: [0.22, 0.2, 0.3] }); }
  }
}

// ---- Drawers ---------------------------------------------------------------------------------------------------

function snowCap(b, I, x, z, w, d, y, t = 0.18) {
  b.setColor(I.snowL);
  box3(b, x - 0.12, y, z - 0.12, w + 0.24, t, d + 0.24);
}

function gable(b, x0, x1, z0, z1, y, rise, over = 0.35) {
  const zm = (z0 + z1) / 2;
  b.loft([
    [[x0 - over, y, z0 - over], [x0 - over, y + rise, zm], [x0 - over, y, z1 + over]],
    [[x1 + over, y, z0 - over], [x1 + over, y + rise, zm], [x1 + over, y, z1 + over]],
  ]);
}

function domeHouse(ctx, w) {
  const { b, theme, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const cx = x + bw / 2, cz = z + bd / 2, R = bw / 2;
  // A stone drum, a copper ring rail, the silver dome with its shutter slit open to the south, the telescope inside.
  b.setColor(I.stoneD);
  b.prismY(0, 0.6, cx, cz, R + 0.15, R + 0.1, 16);
  b.setColor(I.stone);
  b.prismY(0.6, h - R * 0.55, cx, cz, R, R, 16);
  b.setColor(I.copper);
  b.prismY(h - R * 0.55, h - R * 0.45, cx, cz, R + 0.12, R + 0.12, 16);
  const dy = h - R * 0.45;
  b.setColor(I.silver);
  ball(b, cx, dy, cz, R - 0.05, { bands: 4, sides: 16, from: 0, to: 1 });
  // The slit: a dark band over the top toward the camera, with the shutter rolled back beside it.
  b.setColor(I.black);
  b.loft([
    [[cx - 0.6, dy + R * 0.98, cz - 0.4], [cx - 0.6, dy + R * 0.78, cz + R * 0.62], [cx - 0.6, dy + 0.3, cz + R * 0.99]],
    [[cx + 0.6, dy + R * 0.98, cz - 0.4], [cx + 0.6, dy + R * 0.78, cz + R * 0.62], [cx + 0.6, dy + 0.3, cz + R * 0.99]],
  ]);
  b.setColor(I.silverD);
  for (const s of [-1, 1]) box3(b, cx + s * 0.62 - (s < 0 ? 0.12 : 0), dy, cz - R * 0.6, 0.12, R * 0.98, R * 1.55);
  b.setColor(I.white);
  b.prismZ(cz + R * 0.2, cz + R * 0.85, cx, dy + R * 0.62, 0.32, 0.4, 8);
  // Door, windows, a copper weathervane and an aircraft beacon.
  b.setColor(I.timberD);
  box3(b, cx - 0.7, 0.6, z + bd - 0.02 + 0.0, 1.4, 2.1, 0.06);
  b.setColor(I.copperD);
  b.prismY(dy + R - 0.1, dy + R + 1.2, cx, cz - 0.8, 0.05, 0.03, 4);
  emissive(b, () => {
    b.setColor(sc(I.glow, 0.7));
    for (const a of [0.8, 2.3, 3.9, 5.4]) box3(b, cx + Math.cos(a) * (R + 0.01) - 0.25, 2.2, cz + Math.sin(a) * (R + 0.01) - 0.25, 0.5, 0.7, 0.5);
    b.setColor([1, 0.24, 0.18]);
    b.prismY(dy + R + 1.2, dy + R + 1.45, cx, cz - 0.8, 0.12, 0.12, 4);
  });
  glow.halo(cx, cz + R + 0.6, 2.4, [0.08, 0.06, 0.03]);
}

function station(ctx, w) {
  const { b, theme, W } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const west = x < W / 2;
  // Concrete base, a timber-and-glass upper floor, the bullwheel housing out over the edge, a cabin docked.
  b.setColor(I.concrete);
  box3(b, x, 0, z, bw, h * 0.45, bd);
  b.setColor(I.timber);
  box3(b, x + 0.1, h * 0.45, z + 0.1, bw - 0.2, h * 0.55 - 0.4, bd - 0.2);
  emissive(b, () => {
    b.setColor(sc(I.glow, 0.55));
    for (let s = x + 0.5; s < x + bw - 0.6; s += 1.3) box3(b, s, h * 0.6, z + bd - 0.08, 0.9, 0.8, 0.04);
  });
  b.setColor(I.roof);
  b.loft([[[x - 0.3, h - 0.4, z - 0.3], [x - 0.3, h + 0.5, z + bd + 0.3]], [[x + bw + 0.3, h - 0.4, z - 0.3], [x + bw + 0.3, h + 0.5, z + bd + 0.3]]]);
  snowCap(b, I, x, z, bw, bd * 0.6, h - 0.2, 0.15);
  // Bullwheel and the cabin waiting on the outer side (off the map edge, so it never hides a player).
  const ex = west ? x - 1.6 : x + bw + 0.2;
  b.setColor(I.steelD);
  box3(b, ex, 1.6, z + 0.4, 1.4, 0.4, bd - 0.8);
  b.prismY(2, 2.2, ex + 0.7, z + bd / 2, 1.6, 1.6, 10);
  b.setColor(I.red);
  box3(b, ex - 0.2, 0.3, z + bd / 2 - 1, 1.8, 1.5, 2);
  b.setColor(I.glass);
  box3(b, ex - 0.22, 0.95, z + bd / 2 - 0.8, 1.84, 0.5, 1.6);
  b.setColor(I.white);
  box3(b, ex - 0.2, 1.8, z + bd / 2 - 1, 1.8, 0.1, 2);
}

function hut(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.stoneD);
  box3(b, x, 0, z, bw, 0.6, bd);
  b.setColor(I.timberD);
  box3(b, x + 0.05, 0.6, z + 0.05, bw - 0.1, h - 1.4, bd - 0.1);
  b.setColor(sc(I.timberD, 0.8));
  for (let s = 0.7; s < h - 0.8; s += 0.35) box3(b, x, s, z + bd - 0.04, bw, 0.05, 0.04);
  b.setColor(I.roof);
  gable(b, x, x + bw, z, z + bd, h - 0.8, 1.1, 0.3);
  b.setColor(I.snowL);
  b.loft([[[x - 0.3, h - 0.62, z - 0.3], [x - 0.3, h + 0.42, z + bd / 2]], [[x + bw + 0.3, h - 0.62, z - 0.3], [x + bw + 0.3, h + 0.42, z + bd / 2]]]);
  b.setColor(I.shutter);
  box3(b, x + bw / 2 - 0.5, 0.6, z + bd - 0.02, 1, 1.8, 0.05);
  b.setColor(I.steel);
  b.prismY(h + 0.3, h + 2.2, x + 0.5, z + bd / 2, 0.05, 0.03, 4);
  for (let i = 0; i < 3; i++) b.prismX(x + 0.5, x + 1.1, h + 2.2 - i * 0.05, z + bd / 2, 0.04, 0.04, 4);
}

function lodge(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  // A stone ground floor, a timber upper storey under a deep roof heavy with snow, red shutters, a balcony.
  b.setColor(I.stone);
  box3(b, x, 0, z, bw, 1.6, bd);
  b.setColor(I.timber);
  box3(b, x + 0.05, 1.6, z + 0.05, bw - 0.1, h - 2.2, bd - 0.1);
  b.setColor(I.roof);
  gable(b, x, x + bw, z, z + bd, h - 0.6, 1.6, 0.5);
  b.setColor(I.snowL);
  for (const s of [-1, 1]) {
    const zm = z + bd / 2, ze = s < 0 ? z - 0.5 : z + bd + 0.5;
    b.quad([x - 0.5, h - 0.42, ze], [x - 0.5, h + 1.18, zm], [x + bw + 0.5, h + 1.18, zm], [x + bw + 0.5, h - 0.42, ze], [x + bw / 2, h - 3, zm]);
  }
  b.setColor(I.timberD);
  box3(b, x - 0.1, 1.6, z + bd, bw + 0.2, 0.12, 0.6);
  for (let s = x; s <= x + bw; s += 0.5) box3(b, s, 1.72, z + bd + 0.52, 0.05, 0.7, 0.05);
  emissive(b, () => {
    b.setColor(sc(I.glow, 0.8));
    for (let s = x + 0.8; s < x + bw - 0.8; s += 1.6) { box3(b, s, 0.6, z + bd + 0.01, 0.7, 0.7, 0.04); box3(b, s, 2.2, z + bd - 0.02, 0.6, 0.7, 0.04); }
  });
  b.setColor(I.shutter);
  for (let s = x + 0.8; s < x + bw - 0.8; s += 1.6) { box3(b, s - 0.28, 2.2, z + bd - 0.01, 0.24, 0.7, 0.05); box3(b, s + 0.64, 2.2, z + bd - 0.01, 0.24, 0.7, 0.05); }
  b.setColor(I.stoneD);
  box3(b, x + bw - 1.2, h - 1, z + 1, 0.8, 2.4, 0.8);
}

function obsBuilding(ctx, w) {
  if (w.dome) return domeHouse(ctx, w);
  if (w.station) return station(ctx, w);
  if (w.lodge) return lodge(ctx, w);
  if (w.hut) return hut(ctx, w);
  return ctx.kit.building(ctx.b, w, ctx.rnd, ctx.lamps);
}

function tor(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: rw, d: rd, h } = w;
  // Stacked granite blocks, rounded by weather, snow lying on the ledges, lichen on the sunny side.
  mass(ctx, x, z, rw, rd, h, { cols: [I.granite, I.graniteD, I.graniteL], levels: 3, taper: 0.22, jit: 0.2 });
  b.setColor(I.snowL);
  b.prismY(h - 0.15, h + 0.12, x + rw / 2, z + rd / 2, Math.min(rw, rd) * 0.42, Math.min(rw, rd) * 0.3, 6, rnd());
  b.setColor(I.lichen);
  box3(b, x + rw - 0.3, h * 0.3, z + rd * 0.3, 0.32, h * 0.25, rd * 0.3);
}

function drift(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd, L = long ? bw : bd, rings = [];
  for (let t = -0.25; t <= L + 0.26; t += (L + 0.5) / 4) {
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5, y = Math.pow(Math.sin(u * Math.PI), 0.8) * h * (0.85 + rnd() * 0.2) * (t < 0 || t > L ? 0.6 : 1);
      pts.push(long ? [x + t, y, z - 0.3 + u * (bd + 0.6)] : [x - 0.3 + u * (bw + 0.6), y, z + t]);
    }
    rings.push(long ? pts.reverse() : pts);
  }
  b.setColor(I.snowL);
  b.loft(rings);
}

function obsBarrier(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd;
  if (w.solar) {
    // A row of solar panels on frames, tilted to the south, frost on the lower edge.
    b.setColor(I.steelD);
    for (let s = 0.2; s < bw; s += 1.2) box3(b, x + s, 0, z + bd / 2 - 0.05, 0.08, h * 0.7, 0.1);
    b.setColor(I.panel);
    b.quad([x, h * 0.4, z + bd], [x + bw, h * 0.4, z + bd], [x + bw, h, z], [x, h, z]);
    b.setColor(I.silverD);
    for (let s = 0; s < bw; s += 1) b.quad([x + s, h * 0.4 + 0.01, z + bd], [x + s + 0.04, h * 0.4 + 0.01, z + bd], [x + s + 0.04, h + 0.01, z], [x + s, h + 0.01, z]);
    return;
  }
  // Courtyard parapet: rough stone courses, a snow cap.
  const L = long ? bw : bd;
  for (let y = 0, row = 0; y < h - 0.2; y += 0.3, row++) {
    for (let s = (row % 2) * 0.3; s < L - 0.05; s += 0.6) {
      const n = Math.min(0.58, L - s);
      b.setColor(sc(rnd() < 0.5 ? I.stone : I.stoneD, 0.9 + rnd() * 0.15));
      if (long) box3(b, x + s, y, z, n, 0.29, bd); else box3(b, x, y, z + s, bw, 0.29, n);
    }
  }
  snowCap(b, I, x, z, bw, bd, h - 0.12, 0.16);
}

function pine(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2, hh = w.h;
  // A wind-bent mountain pine: trunk, three tiers of needles, snow on the upper face of each.
  b.setColor(I.bark);
  b.prismY(0, hh * 0.5, cx, cz, 0.22, 0.14, 5, rnd());
  for (let i = 0; i < 3; i++) {
    const y0 = hh * (0.28 + i * 0.22), r0 = 1.5 - i * 0.38;
    b.setColor(i % 2 ? I.pine : I.pineD);
    b.prismY(y0, y0 + hh * 0.3, cx - 0.1 * i, cz, r0, 0.08, 7, rnd() * 3);
    b.setColor(I.snowL);
    b.prismY(y0 + hh * 0.17, y0 + hh * 0.22, cx - 0.1 * i, cz, r0 * 0.5, r0 * 0.3, 7, rnd() * 3);
  }
}

function obsWall(ctx, w) {
  if (w.pine) return pine(ctx, w);
  return ctx.kit.concreteWall(ctx.b, w);
}

function radioMast(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: mw, h } = w;
  b.setColor(I.concrete);
  box3(b, x - 0.1, 0, z - 0.1, mw + 0.2, 0.4, mw + 0.2);
  // Red-and-white lattice with two dishes and a whip, a beacon at the top.
  for (let k = 0; k < 4; k++) {
    b.setColor(k % 2 ? I.white : I.red);
    lattice(b, x + 0.05, z + 0.05, mw - 0.1, 0.4 + k * (h - 0.4) / 4, 0.4 + (k + 1) * (h - 0.4) / 4, { leg: 0.1, step: 0.8, brace: 0.05 });
  }
  b.setColor(I.white);
  b.prismZ(z + mw, z + mw + 0.35, x + mw / 2, h * 0.7, 0.1, 0.55, 8);
  b.prismX(x + mw, x + mw + 0.3, h * 0.5, z + mw / 2, 0.1, 0.45, 8);
  b.setColor(I.steel);
  b.prismY(h, h + 2.4, x + mw / 2, z + mw / 2, 0.05, 0.02, 4);
  emissive(b, () => { b.setColor([1, 0.24, 0.18]); b.prismY(h - 0.05, h + 0.25, x + mw / 2, z + mw / 2, 0.14, 0.14, 4); });
}

function groomer(ctx, w) {
  const { b, theme, W } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  const front = x > W / 2 ? -1 : 1;
  // Snow groomer: wide rubber tracks, a red body, the glass cab, the front blade and the rear tiller.
  b.setColor(I.black);
  box3(b, x + 0.3, 0, z, cw - 0.6, 0.8, 0.6); box3(b, x + 0.3, 0, z + cd - 0.6, cw - 0.6, 0.8, 0.6);
  b.setColor(I.red);
  box3(b, x + 0.6, 0.8, z + 0.3, cw - 1.2, 0.7, cd - 0.6);
  const cab = front > 0 ? x + cw - 2.3 : x + 0.8;
  b.setColor(I.redD);
  box3(b, cab, 1.5, z + 0.4, 1.5, h - 1.5, cd - 0.8);
  b.setColor(I.glass);
  box3(b, cab - 0.02, 1.8, z + 0.38, 1.54, 0.6, cd - 0.76);
  b.setColor(I.steelD);
  box3(b, front > 0 ? x + cw - 0.3 : x, 0.1, z - 0.1, 0.3, 0.8, cd + 0.2);
  box3(b, front > 0 ? x : x + cw - 0.3, 0.2, z + 0.2, 0.3, 0.5, cd - 0.4);
  emissive(b, () => { b.setColor(sc(I.glow, 0.8)); for (const oz of [0.6, cd - 0.9]) box3(b, front > 0 ? cab + 1.5 : cab - 0.02, 2.5, z + oz, 0.04, 0.2, 0.3); });
}

function obsContainer(ctx, w) {
  if (w.groomer) return groomer(ctx, w);
  return ctx.kit.container(ctx.b, w, ctx.rnd);
}

function obsCrate(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  const cx = x + cw / 2, cz = z + cd / 2;
  if (w.scope) {
    // A small telescope on a concrete pier, pointed east at the sunrise.
    b.setColor(I.concrete);
    b.prismY(0, h - 0.3, cx, cz, 0.45, 0.35, 6);
    b.setColor(I.steelD);
    box3(b, cx - 0.15, h - 0.3, cz - 0.15, 0.3, 0.3, 0.3);
    b.setColor(I.white);
    b.prismX(cx - 0.6, cx + 0.8, h + 0.15, cz, 0.16, 0.2, 8);
    snowCap(b, I, cx - 0.4, cz - 0.4, 0.8, 0.8, h - 0.35, 0.06);
    return;
  }
  if (w.screen) {
    // Stevenson screen: a white louvred box on four legs.
    b.setColor(I.white);
    for (const [ox, oz] of [[0.1, 0.1], [cw - 0.2, 0.1], [0.1, cd - 0.2], [cw - 0.2, cd - 0.2]]) box3(b, x + ox, 0, z + oz, 0.1, h * 0.5, 0.1);
    box3(b, x, h * 0.5, z, cw, h * 0.45, cd);
    b.setColor(I.silverD);
    for (let y = h * 0.55; y < h * 0.92; y += 0.1) box3(b, x - 0.01, y, z + cd - 0.01, cw + 0.02, 0.03, 0.03);
    snowCap(b, I, x, z, cw, cd, h * 0.95, 0.08);
    return;
  }
  ctx.kit.crate(ctx.b, w, ctx.rnd);
  snowCap(b, I, x + 0.1, z + 0.1, cw - 0.2, cd - 0.2, h, 0.08);
}

// Perimeter: the summit's edge, a cornice of snow on dark rock, a rope-and-post safety line just inside.
function obsBorder(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const long = w.w >= w.d, L = long ? w.w : w.d;
  for (let s = 0; s < L; s += 2.2) {
    const n = Math.min(2.4, L - s), hh = 0.6 + rnd() * 0.9;
    b.setColor(rnd() < 0.5 ? I.granite : I.graniteD);
    if (long) box3(b, w.x + s, 0, w.z, n, hh, w.d); else box3(b, w.x, 0, w.z + s, w.w, hh, n);
    b.setColor(I.snowL);
    if (long) box3(b, w.x + s - 0.05, hh, w.z - 0.05, n + 0.1, 0.18, w.d + 0.1); else box3(b, w.x - 0.05, hh, w.z + s - 0.05, w.w + 0.1, 0.18, n + 0.1);
  }
  const inner = long ? (w.z < 0 ? w.z + w.d + 0.2 : w.z - 0.25) : (w.x < 0 ? w.x + w.w + 0.2 : w.x - 0.25);
  b.setColor(I.timberD);
  for (let s = 0; s <= L; s += 3) { if (long) box3(b, w.x + s, 0, inner, 0.08, 1, 0.08); else box3(b, inner, 0, w.z + s, 0.08, 1, 0.08); }
  b.setColor(I.red);
  if (long) box3(b, w.x, 0.85, inner + 0.02, L, 0.03, 0.03); else box3(b, inner + 0.02, 0.85, w.z, 0.03, 0.03, L);
}

// ---- Decor -----------------------------------------------------------------------------------------------------

function obsDecor(ctx) {
  const { b, W, H, rnd, theme, map } = ctx;
  const I = theme.ink;
  // The cable car's haul ropes running off the summit and down into the cloud, a pylon on the way.
  for (const d of map.decor || []) {
    if (d.type !== 'cable') continue;
    const s = d.x < W / 2 ? -1 : 1;
    b.setColor(I.black);
    for (const o of [-0.8, 0.8]) b.quad([d.x, 3.2, d.z + o], [d.x + s * 60, -14, d.z + o], [d.x + s * 60, -13.9, d.z + o + 0.05], [d.x, 3.3, d.z + o + 0.05]);
    b.setColor(I.steelD);
    lattice(b, d.x + s * 22 - 0.6, d.z - 0.6, 1.2, -6, -2.5, { leg: 0.14, step: 1.5 });
  }
  // The summit falls away: neighbouring peaks round the horizon, snow on their upper flanks, sunlit on the east.
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd() * 0.2, R = 70 + rnd() * 50;
    const mx = W / 2 + Math.cos(a) * R * 1.25, mz = H / 2 + Math.sin(a) * R;
    const hh = 6 + rnd() * 16, r0 = 10 + rnd() * 10, lit = Math.max(0, Math.cos(a)) * 0.3;
    b.setColor(mix(I.graniteD, theme.fog, 0.45));
    b.prismY(-30, hh * 0.4, mx, mz, r0 * 1.7, r0 * 0.75, 6, rnd() * 3);
    b.setColor(mix(sc(I.snowL, 1 + lit), theme.fog, 0.3));
    b.prismY(hh * 0.4, hh, mx, mz, r0 * 0.75, 0.6, 6, rnd() * 3);
  }
  // A sea of cloud below the summit, catching the dawn.
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, R = 40 + rnd() * 50;
    b.setColor(mix([0.86, 0.72, 0.78], theme.fog, 0.3));
    b.prismY(-12, -9 + rnd() * 2, W / 2 + Math.cos(a) * R * 1.3, H / 2 + Math.sin(a) * R, 14 + rnd() * 10, 10 + rnd() * 6, 7, rnd() * 3);
  }
  // Pines on the shoulders just over the edge.
  for (const [x, z] of rimPoints(ctx, 18, 2, 9)) pine(ctx, { x: x - 0.5, z: z - 0.5, w: 1, d: 1, h: 3.4 + rnd() * 2 });
  skyRing(ctx, { low: [0.62, 0.5, 0.62], mid: [0.56, 0.5, 0.72], warm: [1.0, 0.7, 0.56], high: [0.24, 0.26, 0.48], warmDir: [1, -0.2], y0: -20, y1: 10, y2: 60 });
}

export const observatory = {
  dress: {
    building: obsBuilding, rock: tor, sandbag: drift, barrier: obsBarrier, wall: obsWall, crane: radioMast,
    container: obsContainer, crate: obsCrate, border: obsBorder,
  },
  stage: { lights: obsLights, ground: obsGround, paint: obsPaint, decor: obsDecor },
  thumb: { ground: '#c8c0cc', solid: '#4c4852', low: '#a69aa8', edge: '#2e2a44' },
};
