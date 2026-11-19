// Millbrook's theme (farmland, small; js/shared/maps/millbrook.js): a stone water mill on a creek through an apple
// orchard, on a spring morning just after rain. Soft, fairly high light from the south-east, short cool shadows, wet
// grass and puddles on the tracks, blossom on the trees and petals on the wind, mist low over the creek. Clearly not
// Harvest (low gold autumn sun, stubble, oxblood barns) nor Ashgrove (night, lamps, ash): fresh green, whitewash, grey
// stone and slate. world.js reads `millbrook` ({ dress, stage, thumb }) into its tables and hands every drawer ctx.kit.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, mix, WATER_Y, waterBanks, rimPoints, skyRing } from './kit.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));
const sc = scale;

THEMES.millbrook = {
  id: 'millbrook',
  light: { dir: norm([0.42, 0.78, 0.46]), sun: [0.86, 0.84, 0.74], sky: [0.44, 0.5, 0.56], amb: [0.32, 0.34, 0.35] },
  clear: 0x26302e,
  fog: [0.56, 0.62, 0.62], fogSeam: [0.12, 0.14, 0.1], desatTint: [0.84, 0.9, 0.86],
  shadow: { col: [0.42, 0.48, 0.52], strength: 0.5, len: 0.65 },
  lamp: [0.26, 0.2, 0.1],
  wet: 0.4, sheen: norm([0.2, 0.9, -0.38]), sheenCol: [0.42, 0.48, 0.5],
  groundAmp: 0.14,
  water: { deep: [0.08, 0.16, 0.16], shallow: [0.2, 0.32, 0.3], glint: [0.82, 0.88, 0.84] },
  ink: ink({
    ground: 0x667a4c, asphalt: 0x5e584c, dirt: 0x6a5c48, gravel: 0x7c786c,
    roof: 0x4a505a, wall: 0xc8c2b2, wallB: 0xaea898, trim: 0x2e302c,
    concrete: 0x8e8a80, crate: 0x8e7250, crateD: 0x5a4632,
    rail: 0x7f8690, tie: 0x3f3530, hazardY: 0xa8873a, hazardK: 0x2a2620,
    paint: 0xd8d2bc, glow: 0xffe0a8, glowCool: 0xdcecf4,
    grass: 0x667a4c, grassD: 0x546840, grassL: 0x7a8c56, mud: 0x5a4c3c, mudD: 0x463c30, track: 0x76664e,
    stone: 0x8e8a80, stoneD: 0x6e6a62, stoneL: 0xa8a498, moss: 0x5a6a40, slate: 0x454b56, slateD: 0x363b44,
    white: 0xd2ccbc, whiteD: 0xb4ae9e, timber: 0x5c4834, timberD: 0x3e3226, plank: 0x7a6248, plankD: 0x5a4834,
    steel: 0x9aa2a8, steelD: 0x707880, rust: 0x8a5e40, hay: 0xbaa36e, hayD: 0x9a8656,
    blossom: 0xe8c0cc, blossomD: 0xcf9eb0, leaf: 0x5e7a40, leafD: 0x465e32, bark: 0x4e3e30,
    hedge: 0x46603a, hedgeD: 0x344a2c, apple: 0xa8402e, appleG: 0x8a9a3c, green: 0x3e5a46, glass: 0x2a3438,
  }),
  containers: [0x6e5a3e, 0x56664a, 0x7a6a50],
  weather: { fields: [
    // Blossom petals on a light breeze, a little pollen, and mist lying low over the creek and the grass.
    { kind: 'leaf', count: 34, box: [42, 6, 32], vel: [0.7, -0.35, 0.25], size: 0.16, col: [0.96, 0.88, 0.9], alpha: 0.85 },
    { kind: 'mote', count: 50, box: [40, 4, 30], vel: [0.25, 0.08, 0.1], size: 0.06, col: [1.0, 0.96, 0.8], alpha: 0.45 },
    { kind: 'mote', count: 20, box: [46, 1.4, 34], vel: [0.3, 0.02, 0.06], size: 4.6, col: [0.84, 0.9, 0.9], alpha: 0.06 },
  ] },
};

// ---- Ground ----------------------------------------------------------------------------------------------------

const CREEK = [25.5, 28.5];

function millGround(ctx) {
  const { map, noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const lanes = map.lanes.map(l => l.z);
  const houses = map.walls.filter(w => w.house || w.mill || w.silo);
  const nearHouse = (x, z, p) => houses.some(w => x > w.x - p && x < w.x + w.w + p && z > w.z - p && z < w.z + w.d + p);
  return p => {
    const [x, , z] = p;
    const k = 0.88 + noise(x * 0.7, z * 0.7) * 0.2 + (rnd() - 0.5) * 0.05;
    ctx.groundWet = 0.2;
    if (x < 0 || z < 0 || x > W || z > H) {
      // Fields beyond the hedges: young crop rows to east and west, meadow north and south.
      if (x < -3 || x > W + 3) return sc(Math.floor((z + 40) / 1.6) % 2 ? I.grass : I.grassL, k * 0.74);
      return sc(noise(x * 0.12, z * 0.12) > 0.55 ? I.grassL : I.grass, k * 0.8);
    }
    // Muddy banks along the creek.
    if (x > CREEK[0] - 1.1 && x < CREEK[1] + 1.1) { ctx.groundWet = 0.8; return sc(I.mud, k); }
    // Farm tracks down the three lanes, wandering a little, with puddles in the ruts.
    let dl = 99;
    for (const lz of lanes) dl = Math.min(dl, Math.abs(z - lz - (noise(x * 0.08, lz) - 0.5) * 1.6));
    if (dl < 1.4) {
      const puddle = noise(x * 0.45 + 5, z * 0.45) > 0.64;
      ctx.groundWet = puddle ? 1 : 0.5;
      return sc(puddle ? I.mudD : I.track, puddle ? 0.7 : k);
    }
    // Gravel yards round the buildings.
    if (nearHouse(x, z, 1.4)) return sc(I.gravel, k);
    // The pig pens: trodden mud.
    if ((x > 10 && x < 17.4 && z > 24.6 && z < 31) || (x > 36.6 && x < 44 && z > 5 && z < 11.4)) { ctx.groundWet = 0.7; return sc(I.mud, k * 1.05); }
    const n = noise(x * 0.16 + 7, z * 0.16);
    return sc(n > 0.62 ? I.grassL : n < 0.36 ? I.grassD : I.grass, k);
  };
}

function millPaint(ctx) {
  const { b, map, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  // Bridges: plank footbridges (boards across the span) and the stone mill bridge's setts.
  for (const r of map.rooms || []) {
    if (r.floor === 'bridge') {
      for (let x = r.x - 0.5, i = 0; x < r.x + r.w + 0.5; x += 0.38, i++) {
        b.setColor(sc(i % 2 ? I.plank : I.plankD, 0.88 + rnd() * 0.16));
        b.groundRect(x, r.z + 0.1, 0.34, r.d - 0.2, 0.06);
      }
      b.setColor(I.timberD);
      for (const zz of [r.z + 0.05, r.z + r.d - 0.17]) {
        box3(b, r.x - 0.5, 0.06, zz, r.w + 1, 0.12, 0.12);
        for (let x = r.x - 0.4; x <= r.x + r.w + 0.4; x += (r.w + 0.8) / 3) box3(b, x, 0.06, zz, 0.1, 0.55, 0.12);
      }
    } else {
      for (let z = r.z + 0.1; z < r.z + r.d - 0.1; z += 0.62) {
        for (let x = r.x - 0.6 + (Math.round(z * 3) % 2) * 0.3; x < r.x + r.w + 0.6; x += 0.62) {
          b.setColor(sc(rnd() < 0.5 ? I.stone : I.stoneD, 0.82 + rnd() * 0.18));
          b.groundRect(x, z, 0.56, 0.56, 0.06);
        }
      }
    }
  }
  // Petals fallen under the apple trees.
  for (const w of map.walls) {
    if (!w.apple) continue;
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, d = 0.6 + rnd() * 1.1;
      b.setColor(sc(rnd() < 0.6 ? I.blossom : I.blossomD, 0.9));
      b.groundRect(w.x + 0.5 + Math.cos(a) * d, w.z + 0.5 + Math.sin(a) * d, 0.18, 0.14, 0.03);
    }
  }
  // Wheel ruts along the tracks and a few tufts of grass and stones.
  b.setColor(sc(I.mudD, 0.9));
  const solid = (x, z) => map.walls.some(w => w.kind !== 'border' && x > w.x - 0.3 && x < w.x + w.w + 0.3 && z > w.z - 0.3 && z < w.z + w.d + 0.3);
  for (const lane of map.lanes) {
    for (let x = 0.5; x < W - 0.5; x += 0.8) {
      if (x > CREEK[0] - 0.6 && x < CREEK[1] + 0.6) continue;
      for (const o of [-0.55, 0.55]) if (!solid(x, lane.z + o)) b.groundRect(x, lane.z + o - 0.07, 0.75, 0.14, 0.035);
    }
  }
  for (let i = 0; i < 50; i++) {
    const x = 1 + rnd() * (W - 2), z = 1 + rnd() * (H - 2);
    if (solid(x, z)) continue;
    b.setColor(sc(i % 3 ? I.grassD : I.stoneD, 0.8 + rnd() * 0.2));
    b.prismY(0, 0.12 + rnd() * 0.14, x, z, 0.12 + rnd() * 0.12, 0.04, 4, rnd() * 3);
  }
}

// ---- Drawers ---------------------------------------------------------------------------------------------------

// A pitched roof with its ridge along x over the middle of z0..z1.
function gableX(b, x0, x1, z0, z1, y, rise, over = 0.3) {
  const zm = (z0 + z1) / 2;
  b.loft([
    [[x0 - over, y, z0 - over], [x0 - over, y + rise, zm], [x0 - over, y, z1 + over]],
    [[x1 + over, y, z0 - over], [x1 + over, y + rise, zm], [x1 + over, y, z1 + over]],
  ]);
}

function windows(ctx, list, col) {
  const { b } = ctx;
  b.setColor(col);
  for (const [x, y, z, w, h, d] of list) box3(b, x, y, z, w, h, d);
}

function farmhouse(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  // Whitewashed walls on a stone plinth, a slate roof, a chimney stack at one gable, small dark windows.
  b.setColor(I.stoneD);
  box3(b, x - 0.05, 0, z - 0.05, bw + 0.1, 0.5, bd + 0.1);
  b.setColor(I.white);
  box3(b, x, 0.5, z, bw, h - 1.8, bd);
  b.setColor(I.slate);
  gableX(b, x, x + bw, z, z + bd, h - 1.3, 1.9);
  b.setColor(I.slateD);
  box3(b, x - 0.3, h + 0.55, z + bd / 2 - 0.12, bw + 0.6, 0.12, 0.24);
  b.setColor(I.stone);
  const cx = z < ctx.H / 2 ? x + 0.5 : x + bw - 1.3;
  box3(b, cx, h - 1.3, z + bd / 2 - 0.5, 0.8, 2.6, 1.0);
  b.setColor(I.stoneD);
  box3(b, cx - 0.05, h + 1.3, z + bd / 2 - 0.55, 0.9, 0.12, 1.1);
  const win = [];
  for (let s = x + 0.8; s < x + bw - 0.8; s += 1.6) { win.push([s, 1.3, z + bd, 0.7, 0.9, 0.04]); win.push([s, 1.3, z - 0.04, 0.7, 0.9, 0.04]); }
  windows(ctx, win, I.glass);
  b.setColor(I.green);
  box3(b, x + bw / 2 - 0.45, 0.5, z + bd, 0.9, 1.7, 0.05);
  box3(b, x + bw / 2 - 0.45, 0.5, z - 0.05, 0.9, 1.7, 0.05);
}

function stable(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  // Black-tarred timber on a stone base, a lower slate roof, split stable doors on both long sides.
  b.setColor(I.stoneD);
  box3(b, x, 0, z, bw, 0.7, bd);
  b.setColor(I.timberD);
  box3(b, x + 0.05, 0.7, z + 0.05, bw - 0.1, h - 1.6, bd - 0.1);
  b.setColor(sc(I.timberD, 0.8));
  for (let s = x + 0.3; s < x + bw; s += 0.45) { box3(b, s, 0.7, z + bd - 0.04, 0.05, h - 1.6, 0.04); box3(b, s, 0.7, z, 0.05, h - 1.6, 0.04); }
  b.setColor(I.slate);
  gableX(b, x, x + bw, z, z + bd, h - 0.9, 1.4, 0.35);
  b.setColor(I.green);
  for (let s = x + 0.9; s < x + bw - 1; s += 2.1) {
    box3(b, s, 0.2, z + bd - 0.02, 1.2, 1.0, 0.06); box3(b, s, 1.3, z + bd - 0.02, 1.2, 0.8, 0.06);
    box3(b, s, 0.2, z - 0.04, 1.2, 1.0, 0.06); box3(b, s, 1.3, z - 0.04, 1.2, 0.8, 0.06);
  }
}

// The mill (north) and the cider house (its image, south): one stone body over the creek, an arch where the water
// runs under, a slate roof. The mill carries a hoist loft on its north face and the waterwheel on its south face, in
// the race above the mill bridge where the camera sees it; the cider house has timber-clad upper walls and barrels.
function millHouse(ctx, w) {
  const { b, theme, H } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const cider = z > H / 2;
  b.setColor(I.stone);
  box3(b, x, 0, z, bw, cider ? 2.2 : h - 1.4, bd);
  if (cider) {
    b.setColor(I.plank);
    box3(b, x + 0.05, 2.2, z + 0.05, bw - 0.1, h - 3.6, bd - 0.1);
    b.setColor(I.plankD);
    for (let s = x + 0.3; s < x + bw; s += 0.5) { box3(b, s, 2.2, z + bd - 0.03, 0.06, h - 3.6, 0.04); box3(b, s, 2.2, z - 0.01, 0.06, h - 3.6, 0.04); }
  }
  // Quoins.
  b.setColor(I.stoneL);
  for (const qx of [x, x + bw - 0.45]) for (let y = 0; y < (cider ? 2.2 : h - 1.4); y += 0.7) {
    box3(b, qx - 0.03, y, z - 0.03, 0.48, 0.32, 0.12); box3(b, qx - 0.03, y, z + bd - 0.09, 0.48, 0.32, 0.12);
  }
  b.setColor(I.slate);
  gableX(b, x, x + bw, z, z + bd, h - 1.4, 2.4, 0.4);
  b.setColor(I.slateD);
  box3(b, x - 0.4, h + 0.95, z + bd / 2 - 0.12, bw + 0.8, 0.14, 0.24);
  // The race arch on both faces, dark water running under.
  b.setColor([0.08, 0.1, 0.1]);
  for (const fz of [z - 0.06, z + bd + 0.01]) box3(b, CREEK[0] + 0.25, WATER_Y, fz, CREEK[1] - CREEK[0] - 0.5, 1.4 - WATER_Y, 0.05);
  b.setColor(I.stoneL);
  for (const fz of [z - 0.1, z + bd]) box3(b, CREEK[0], 1.4, fz, CREEK[1] - CREEK[0], 0.35, 0.1);
  windows(ctx, [[x + 1, 1.6, z + bd, 0.7, 1.0, 0.05], [x + bw - 1.7, 1.6, z + bd, 0.7, 1.0, 0.05], [x + 1, 1.6, z - 0.05, 0.7, 1.0, 0.05], [x + bw - 1.7, 1.6, z - 0.05, 0.7, 1.0, 0.05]], I.glass);
  if (cider) {
    // Barrels against the west wall and a painted sign board.
    b.setColor(I.timber);
    for (const [bx, bz] of [[x - 0.45, z + 1.2], [x - 0.45, z + 2.2]]) b.prismY(0, 1, bx, bz, 0.4, 0.4, 8);
    b.setColor(I.paint);
    box3(b, x + bw / 2 - 1.2, 2.5, z + bd + 0.02, 2.4, 0.6, 0.05);
    b.setColor(I.apple);
    for (let i = 0; i < 4; i++) b.prismZ(z + bd + 0.07, z + bd + 0.1, x + bw / 2 - 0.8 + i * 0.55, 2.8, 0.14, 0.14, 6);
    return;
  }
  // The hoist loft over the north face, and the waterwheel in the race below the arch.
  b.setColor(I.timber);
  box3(b, x + 1.4, h - 2.4, z - 0.9, 1.6, 1.6, 0.9);
  b.setColor(I.slate);
  b.quad([x + 1.2, h - 0.6, z - 1.1], [x + 3.2, h - 0.6, z - 1.1], [x + 3.2, h - 0.4, z + 0.2], [x + 1.2, h - 0.4, z + 0.2]);
  waterwheel(ctx, (CREEK[0] + CREEK[1]) / 2, z + bd + 1.05, 0.95);
}

function waterwheel(ctx, cx, cz, r) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const cy = 0.55, half = 0.7, n = 12;
  // Two rims, an axle into the wall, and paddles between the rims.
  b.setColor(I.timberD);
  for (const ox of [-half, half]) b.prismX(cx + ox - 0.06, cx + ox + 0.06, cy, cz, r, r, n);
  b.setColor(I.steelD);
  b.prismX(cx - half - 0.2, cx + half + 0.2, cy, cz, 0.12, 0.12, 6);
  b.prismZ(cz - 1.1, cz, cx, cy, 0.1, 0.1, 6);
  b.setColor(I.plank);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
    const r0 = r * 0.55, r1 = r + 0.08;
    b.quad([cx - half, cy + s * r0, cz + c * r0], [cx + half, cy + s * r0, cz + c * r0], [cx + half, cy + s * r1, cz + c * r1], [cx - half, cy + s * r1, cz + c * r1]);
    b.quad([cx - half, cy + s * r1, cz + c * r1], [cx + half, cy + s * r1, cz + c * r1], [cx + half, cy + s * r0, cz + c * r0], [cx - half, cy + s * r0, cz + c * r0]);
  }
  // White water off the paddles.
  emissive(b, () => {
    b.setColor([0.42, 0.48, 0.48]);
    b.groundRect(cx - 1.2, cz + r - 0.1, 2.4, 0.45, WATER_Y + 0.03);
    b.groundRect(cx - 0.9, cz - r - 0.05, 1.8, 0.3, WATER_Y + 0.03);
  });
}

function silo(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2, r = w.w / 2;
  b.setColor(I.stoneD);
  b.prismY(0, 0.4, cx, cz, r + 0.05, r + 0.05, 12);
  // Galvanised rings, a little rust towards the bottom, a cone cap and a ladder up the camera side.
  for (let y = 0.4, i = 0; y < w.h - 0.8; y += 0.9, i++) {
    b.setColor(i < 2 ? mix(I.steelD, I.rust, 0.4) : i % 2 ? I.steel : I.steelD);
    b.prismY(y, Math.min(y + 0.9, w.h - 0.8), cx, cz, r, r, 12);
  }
  b.setColor(I.steelD);
  b.prismY(w.h - 0.8, w.h + 0.6, cx, cz, r + 0.12, 0.25, 12);
  b.setColor(I.steel);
  b.prismY(w.h + 0.6, w.h + 0.9, cx, cz, 0.3, 0.2, 6);
  b.setColor(I.trim);
  for (const ox of [-0.25, 0.25]) box3(b, cx + ox - 0.03, 0.4, cz + r - 0.02, 0.06, w.h - 1.2, 0.08);
  for (let y = 0.8; y < w.h - 1; y += 0.5) box3(b, cx - 0.25, y, cz + r, 0.5, 0.04, 0.06);
}

function millBuilding(ctx, w) {
  if (w.mill) return millHouse(ctx, w);
  if (w.silo) return silo(ctx, w);
  if (w.h < 4) return stable(ctx, w);
  return farmhouse(ctx, w);
}

function appleTree(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  b.setColor(I.bark);
  b.prismY(0, 1.7, cx, cz, 0.2, 0.15, 6, rnd());
  // A low, wide crown: green under, blossom on top, kept over the trunk so it never hides a player for long.
  b.setColor(I.leafD);
  b.prismY(1.5, 2.3, cx, cz, 0.6, 1.25, 7, rnd() * 3);
  b.setColor(rnd() < 0.5 ? I.blossom : I.blossomD);
  b.prismY(2.3, 3.2, cx, cz, 1.25, 0.45, 7, rnd() * 3);
  b.setColor(I.leaf);
  for (let i = 0; i < 3; i++) { const a = rnd() * 6.3; b.prismY(2.2, 2.7, cx + Math.cos(a) * 0.9, cz + Math.sin(a) * 0.9, 0.3, 0.1, 4, rnd()); }
}

function oakTree(ctx, x, z, hgt, cr) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  b.setColor(I.bark);
  b.prismY(0, hgt * 0.55, x, z, 0.38, 0.24, 6, rnd());
  b.setColor(I.leafD);
  b.prismY(hgt * 0.4, hgt * 0.78, x, z, cr * 0.6, cr, 8, rnd() * 3);
  b.setColor(I.leaf);
  b.prismY(hgt * 0.78, hgt, x, z, cr, cr * 0.35, 8, rnd() * 3);
}

function hedgeBlock(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const long = w.w >= w.d, L = long ? w.w : w.d;
  b.setColor(I.hedgeD);
  box3(b, w.x + 0.05, 0, w.z + 0.05, w.w - 0.1, w.h * 0.6, w.d - 0.1);
  for (let s = 0; s < L - 0.1; s += 0.9) {
    const n = Math.min(1.1, L - s), hh = w.h - 0.2 + rnd() * 0.35;
    b.setColor(rnd() < 0.5 ? I.hedge : sc(I.hedge, 0.88));
    if (long) box3(b, w.x + s, w.h * 0.4, w.z - 0.05, n, hh - w.h * 0.4, w.d + 0.1);
    else box3(b, w.x - 0.05, w.h * 0.4, w.z + s, w.w + 0.1, hh - w.h * 0.4, n);
  }
}

function millWall(ctx, w) {
  if (w.apple) return appleTree(ctx, w);
  if (w.oak) return oakTree(ctx, w.x + w.w / 2, w.z + w.d / 2, 6.2, 2.2);
  if (w.hedge) return hedgeBlock(ctx, w);
  return ctx.kit.concreteWall(ctx.b, w);
}

function hayStack(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  // Square bales stacked in a block, the top course stepped in, a tarp weighed down over the top.
  for (let y = 0, row = 0; y < h - 0.8; y += 0.6, row++) {
    for (let s = 0; s < cw - 0.05; s += 1.1) {
      b.setColor(sc(rnd() < 0.5 ? I.hay : I.hayD, 0.92 + rnd() * 0.12));
      box3(b, x + s + (row % 2) * 0.05, y, z, Math.min(1.08, cw - s), 0.58, cd);
    }
  }
  b.setColor(I.green);
  b.loft([
    [[x - 0.06, h - 0.9, z - 0.06], [x - 0.06, h, z + cd / 2], [x - 0.06, h - 0.9, z + cd + 0.06]],
    [[x + cw + 0.06, h - 0.9, z - 0.06], [x + cw + 0.06, h, z + cd / 2], [x + cw + 0.06, h - 0.9, z + cd + 0.06]],
  ]);
  b.setColor(I.trim);
  for (const s of [0.3, cw - 0.4]) b.prismY(0, h - 0.95, x + s, z - 0.08, 0.05, 0.05, 4);
}

function hayCart(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  // A four-wheeled farm wagon: plank bed, rails, a load of hay, the shafts resting on the ground.
  b.setColor(I.timberD);
  for (const wx of [x + 0.6, x + cw - 0.6]) for (const wz of [z + 0.08, z + cd - 0.08]) b.prismZ(wz - 0.07, wz + 0.07, wx, 0.5, 0.5, 0.5, 10);
  b.setColor(I.plank);
  box3(b, x, 0.8, z + 0.15, cw, 0.2, cd - 0.3);
  b.setColor(I.plankD);
  box3(b, x, 1.0, z + 0.15, cw, 0.5, 0.08); box3(b, x, 1.0, z + cd - 0.23, cw, 0.5, 0.08);
  b.setColor(I.hay);
  b.loft([
    [[x + 0.1, 1.0, z + 0.25], [x + 0.2, h, z + cd * 0.4], [x + 0.2, h, z + cd * 0.6], [x + 0.1, 1.0, z + cd - 0.25]],
    [[x + cw - 0.1, 1.0, z + 0.25], [x + cw - 0.2, h, z + cd * 0.4], [x + cw - 0.2, h, z + cd * 0.6], [x + cw - 0.1, 1.0, z + cd - 0.25]],
  ]);
  b.setColor(I.timber);
  const front = z < ctx.H / 2 ? x - 1.6 : x + cw;
  for (const oz of [0.45, cd - 0.55]) box3(b, front, 0.15 + rnd() * 0.05, z + oz, 1.6, 0.1, 0.1);
}

function appleCrates(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  const n = Math.round(h / 0.52);
  for (let i = 0; i < n; i++) {
    const y = i * 0.52, o = (rnd() - 0.5) * 0.08;
    b.setColor(sc(I.crate, 0.88 + rnd() * 0.14));
    box3(b, x + 0.04 + o, y, z + 0.04, cw - 0.08, 0.48, cd - 0.08);
    b.setColor(I.crateD);
    box3(b, x + o, y + 0.2, z + 0.02, cw, 0.06, cd - 0.04);
  }
  b.setColor(I.apple);
  for (let i = 0; i < 6; i++) b.prismY(n * 0.52, n * 0.52 + 0.12, x + 0.3 + rnd() * (cw - 0.6), z + 0.3 + rnd() * (cd - 0.6), 0.12, 0.08, 5);
  b.setColor(I.appleG);
  for (let i = 0; i < 3; i++) b.prismY(n * 0.52, n * 0.52 + 0.12, x + 0.3 + rnd() * (cw - 0.6), z + 0.3 + rnd() * (cd - 0.6), 0.12, 0.08, 5);
}

function millContainer(ctx, w) {
  if (w.hay) return hayStack(ctx, w);
  if (w.cart) return hayCart(ctx, w);
  if (w.apples) return appleCrates(ctx, w);
  return ctx.kit.container(ctx.b, w, ctx.rnd);
}

function roundBale(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const r = w.h / 2, cx = w.x + w.w / 2, cz = w.z + w.d / 2, half = Math.min(w.w, w.d) / 2 - 0.05;
  b.setColor(sc(I.hay, 0.92 + rnd() * 0.12));
  b.prismX(cx - half, cx + half, r, cz, r, r, 10);
  b.setColor(I.hayD);
  for (const ox of [-half - 0.01, half - 0.01]) b.prismX(cx + ox, cx + ox + 0.02, r, cz, r * 0.7, r * 0.7, 10);
}

function millBarrier(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd, L = long ? bw : bd;
  if (w.fence) {
    // Posts and two rails, weathered grey.
    b.setColor(I.timber);
    for (let s = 0; s <= L + 0.01; s += Math.max(0.9, L / Math.ceil(L / 1.6))) {
      if (long) box3(b, x + Math.min(s, L - 0.14), 0, z + bd / 2 - 0.07, 0.14, h, 0.14);
      else box3(b, x + bw / 2 - 0.07, 0, z + Math.min(s, L - 0.14), 0.14, h, 0.14);
    }
    b.setColor(sc(I.plank, 0.85));
    for (const y of [0.45, 0.85]) {
      if (long) box3(b, x, y, z + bd / 2 - 0.04, bw, 0.12, 0.08);
      else box3(b, x + bw / 2 - 0.04, y, z, 0.08, 0.12, bd);
    }
    return;
  }
  if (w.trough) {
    b.setColor(I.stoneD);
    box3(b, x, 0, z, bw, h, bd);
    b.setColor([0.12, 0.18, 0.18]);
    box3(b, x + 0.12, h - 0.05, z + 0.12, bw - 0.24, 0.06, bd - 0.24);
    return;
  }
  if (w.parapet) {
    b.setColor(I.stone);
    box3(b, x - 0.4, 0, z, bw + 0.8, h - 0.12, bd);
    b.setColor(I.stoneL);
    box3(b, x - 0.45, h - 0.12, z - 0.03, bw + 0.9, 0.14, bd + 0.06);
    return;
  }
  // Dry-stone wall: courses of flat stones, a row of upright coping stones, moss in places.
  for (let y = 0, row = 0; y < h - 0.25; y += 0.25, row++) {
    for (let s = (row % 2) * 0.25; s < L - 0.05; s += 0.5 + rnd() * 0.2) {
      const n = Math.min(0.5, L - s);
      b.setColor(sc(rnd() < 0.5 ? I.stone : I.stoneD, 0.85 + rnd() * 0.2));
      if (long) box3(b, x + s, y, z, n - 0.03, 0.24, bd);
      else box3(b, x, y, z + s, bw, 0.24, n - 0.03);
    }
  }
  b.setColor(I.moss);
  for (let s = 0; s < L - 0.1; s += 0.22) {
    if (long) box3(b, x + s, h - 0.25, z + 0.05, 0.18, 0.25 + rnd() * 0.05, bd - 0.1);
    else box3(b, x + 0.05, h - 0.25, z + s, bw - 0.1, 0.25 + rnd() * 0.05, 0.18);
  }
}

function creekBank(ctx, w) {
  const I = ctx.theme.ink;
  waterBanks(ctx, w, { face: sc(I.stoneD, 0.7), lip: I.stone, lip2: I.moss, t: 0.3 });
  // Reeds at the foot of the banks.
  const { b, rnd } = ctx;
  for (let z = w.z + 0.3; z < w.z + w.d - 0.2; z += 0.5 + rnd() * 0.5) {
    for (const x of [w.x + 0.12, w.x + w.w - 0.12]) {
      if (rnd() < 0.5) continue;
      b.setColor(sc(I.leaf, 0.75 + rnd() * 0.3));
      b.prismY(WATER_Y, 0.2 + rnd() * 0.5, x, z, 0.1, 0.02, 3, rnd() * 3);
    }
  }
}

// Perimeter: a laid hedge on a low bank, with ash and oak beyond.
function millBorder(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  b.setColor(I.mud);
  box3(b, w.x, 0, w.z, w.w, 0.5, w.d);
  hedgeBlock(ctx, { x: w.x, z: w.z, w: w.w, d: w.d, h: w.z > ctx.H ? 1.8 : 2.6 });
  void rnd;
}

// ---- Decor -----------------------------------------------------------------------------------------------------

function millDecor(ctx) {
  const { b, W, H, rnd, theme } = ctx;
  const I = theme.ink;
  // The creek running on out of the map under the hedges: a stone culvert mouth at each end.
  for (const zz of [-1.7, H + 1.5]) {
    b.setColor(I.stoneD);
    box3(b, CREEK[0] - 0.6, 0, zz, 0.6, 1.6, 0.2); box3(b, CREEK[1], 0, zz, 0.6, 1.6, 0.2);
    box3(b, CREEK[0] - 0.6, 1.6, zz, CREEK[1] - CREEK[0] + 1.2, 0.5, 0.2);
  }
  // Trees beyond the hedges: rounded oaks, lower to the south (the camera side).
  for (const [x, z] of rimPoints(ctx, 40, 4, 16)) {
    const south = z > H;
    oakTree(ctx, x, z, (south ? 3.5 : 5) + rnd() * 3, 1.8 + rnd() * 1.2);
  }
  // A few more apple trees in blossom just over the hedge, so the orchard reads as a bigger one.
  for (let i = 0; i < 10; i++) {
    const x = -3 - rnd() * 6, z = 2 + rnd() * (H - 4);
    appleTree(ctx, { x: i % 2 ? x : W - x - 1, z: i % 2 ? z : H - z - 1, w: 1, d: 1 });
  }
  skyRing(ctx, { low: [0.44, 0.5, 0.48], mid: [0.64, 0.72, 0.74], warm: [0.9, 0.86, 0.74], high: [0.5, 0.62, 0.74], warmDir: [1, 0.4], y0: -4, y1: 12, y2: 60 });
}

export const millbrook = {
  dress: { building: millBuilding, wall: millWall, container: millContainer, crate: roundBale, barrier: millBarrier, water: creekBank, border: millBorder },
  stage: { lights: () => {}, ground: millGround, paint: millPaint, decor: millDecor },
  thumb: { ground: '#667a4c', solid: '#9a948a', low: '#b4a272', water: '#2a4a4c', edge: '#1c2418' },
};
