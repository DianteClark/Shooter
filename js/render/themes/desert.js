// Desert region (theme 'desert': Dust, Oasis, Canyon). Extends Dust's look: hard afternoon sun, sand, rock and mud
// brick, plus mud-brick houses, palm beds round a spring pool, a dry riverbed and an old concrete dam. Registers the
// palette with art.js and exports what world.js's tables take: `dress`, `stage` and the thumbnail style.
import { THEMES, hexRGB } from '../art.js';
import {
  box3, scale, rockMass, rockWall, boulder, adobe, adobeScreen, tent, sandbags, ridge, crate, container, skyRing,
} from '../world.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));
const WATER_Y = -0.62;     // world.js draws the water surface here.

THEMES.desert = {
  id: 'desert',
  // Late afternoon: the sun low in the west, long shadows east, warm dust in the air.
  light: { dir: norm([-0.8, 0.48, 0.34]), sun: [1.0, 0.84, 0.64], sky: [0.46, 0.45, 0.46], amb: [0.36, 0.33, 0.31] },
  clear: 0x4b3a29,
  fog: [0.56, 0.48, 0.42], fogSeam: [0.24, 0.13, 0.04], desatTint: [0.86, 0.8, 0.74],
  shadow: { col: [0.40, 0.33, 0.36], strength: 0.72, len: 1.4 },
  lamp: [0.1, 0.07, 0.03],
  groundAmp: 0.28,
  water: { deep: [0.07, 0.17, 0.16], shallow: [0.16, 0.32, 0.27], glint: [1.0, 0.86, 0.6] },
  ink: ink({
    ground: 0x978c78, asphalt: 0x867b68, dirt: 0xa39577, gravel: 0x7b7265,
    roof: 0x968670, wall: 0x9f9078, wallB: 0x8b7d68, trim: 0x5a4f42,
    concrete: 0x9a958a, crate: 0x8f7650, crateD: 0x5a4a32,
    rail: 0x7f7a70, tie: 0x4d4034, hazardY: 0x8a6a30, hazardK: 0x3c3226,
    paint: 0xcabb9a, glow: 0xffe0a8, glowCool: 0xd6e4ec,
    rock: 0x8a7760, rockD: 0x69594a, rockL: 0xa8957a, adobe: 0xac9c82, adobeD: 0x897964,
    canvas: 0xc4b89c, canvasB: 0x8a6f4e, sandbag: 0x9a8a68,
    mud: 0x7c6a54, mudD: 0x5e5040, silt: 0xbab2a0, siltD: 0xa49c8a, grass: 0x6e7a46, grassD: 0x58653a,
    palm: 0x4e6a34, palmD: 0x3c5228, trunk: 0x6a5640, trunkD: 0x50402e, reed: 0x7c8a4c,
    damC: 0xa29c90, damD: 0x7e786c, rust: 0x8a5a3a, steel: 0x5e6268, beam: 0x5a4430, door: 0x4a3a2c,
    cloth: 0x7a4a3c, clothB: 0x3e5a6a,
  }),
  containers: [0x7a6a4a, 0x6f4a35, 0x5f6a5a],
  weather: { fields: [
    { kind: 'streak', count: 150, box: [38, 3.2, 30], vel: [11, 0.1, 2.5], len: 2.6, width: 0.03, col: [0.92, 0.8, 0.58], alpha: 0.2 },
    { kind: 'mote', count: 150, box: [40, 7, 32], vel: [4.5, 0.1, 1.0], size: 0.12, col: [1.0, 0.9, 0.7], alpha: 0.32 },
    { kind: 'mote', count: 16, box: [44, 3, 34], vel: [5.5, 0.04, 1.2], size: 3.2, col: [0.86, 0.72, 0.5], alpha: 0.05 },
  ] },
};

export const thumb = { ground: '#a08f72', solid: '#6e5a42', low: '#8f7c5e', water: '#2c5a52', edge: '#3c2f22' };

const zonesOf = map => map.zones || [];
const inZone = (map, kind, x, z) => zonesOf(map).some(r => r.kind === kind && x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d);
const near = (map, x, z, p = 0.3) => map.walls.some(w => w.kind !== 'border' && x > w.x - p && x < w.x + w.w + p && z > w.z - p && z < w.z + w.d + p);
function waterDist(map, x, z) {
  let d = 99;
  for (const w of map.walls) if (w.kind === 'water') d = Math.min(d, Math.hypot(Math.max(w.x - x, 0, x - w.x - w.w), Math.max(w.z - z, 0, z - w.z - w.d)));
  return d;
}

// ---- Ground and paint -----------------------------------------------------------------------------------------

function ground(ctx) {
  const { map, noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const laneDist = z => { let d = 99; for (const l of map.lanes) d = Math.min(d, Math.abs(z - l.z)); return d; };
  const hasWater = map.walls.some(w => w.kind === 'water');
  return p => {
    const [x, , z] = p;
    if (!(x > 0 && x < W && z > 0 && z < H)) return scale(I.dirt, 0.72 + noise(x * 0.12, z * 0.12) * 0.25);
    const n = 0.92 + noise(x * 0.5, z * 0.5) * 0.2 + (rnd() - 0.5) * 0.05;
    // The riverbed meanders inside its zone: pale silt in the channel, darker mud at its edges.
    if (inZone(map, 'riverbed', x, z)) {
      const r = zonesOf(map).find(q => q.kind === 'riverbed');
      const mid = r.z + r.d / 2 + Math.sin(x * 0.09) * r.d * 0.22;
      const off = Math.abs(z - mid) / (r.d / 2);
      return scale(off < 0.55 ? (noise(x * 0.6, z * 0.6) > 0.5 ? I.silt : I.siltD) : I.mud, n);
    }
    if (hasWater) {
      const d = waterDist(map, x, z);
      if (d < 1.2) return scale(I.mudD, n);
      if (d < 3.6 + noise(x * 0.4, z * 0.4) * 1.5) return scale(noise(x * 0.5 + 3, z * 0.5) > 0.5 ? I.grass : I.grassD, n);
    }
    const track = laneDist(z) < 2.8 && noise(x * 0.25, z * 0.25) > 0.42;
    const base = track ? I.asphalt : noise(x * 0.12 + 5, z * 0.12) > 0.55 ? I.dirt : I.ground;
    const rip = Math.sin((x + noise(x * 0.3, z * 0.3) * 6) * 2.4) * 0.05;
    return scale(base, n + rip);
  };
}

function paint(ctx) {
  const { b, map, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const blocked = (x, z, p = 0.3) => near(map, x, z, p);
  // Tyre tracks wandering along each lane, but not through the riverbed or the water.
  for (const lane of map.lanes) {
    let zc = lane.z - 2;
    for (let x = 0; x < W; x += 0.85) {
      zc += (rnd() - 0.5) * 0.3;
      zc += (lane.z - zc) * 0.03;
      if (blocked(x, zc) || inZone(map, 'riverbed', x, zc) || waterDist(map, x, zc) < 3) continue;
      b.setColor(scale(I.asphalt, 0.68 + rnd() * 0.1));
      b.groundRect(x, zc - 0.11, 0.85, 0.22, 0.04);
      b.groundRect(x, zc + 1.4, 0.85, 0.22, 0.04);
    }
  }
  // Cracked mud in the riverbed: short dark strokes in a loose polygon net.
  for (let i = 0; i < W * H / 14; i++) {
    const x = rnd() * W, z = rnd() * H;
    if (!inZone(map, 'riverbed', x, z) || blocked(x, z)) continue;
    b.setColor(scale(I.mudD, 0.8));
    if (rnd() < 0.5) b.groundRect(x, z, 0.6 + rnd() * 0.9, 0.05, 0.05);
    else b.groundRect(x, z, 0.05, 0.6 + rnd() * 0.9, 0.05);
  }
  // Scattered stones; grass tufts by the water.
  for (let i = 0; i < W * H / 40; i++) {
    const x = 1 + rnd() * (W - 2), z = 1 + rnd() * (H - 2);
    if (blocked(x, z)) continue;
    const wet = waterDist(map, x, z);
    if (wet < 4 && wet > 0.6) {
      b.setColor(scale(I.grass, 0.9 + rnd() * 0.3));
      b.prismY(0, 0.25 + rnd() * 0.25, x, z, 0.16, 0.02, 3, rnd() * 3);
      continue;
    }
    if (wet <= 0.6) continue;
    b.setColor(scale(I.rock, 0.75 + rnd() * 0.3));
    b.prismY(0.02, 0.14, x, z, 0.14 + rnd() * 0.16, 0.05, 5, rnd() * 3);
  }
}

// ---- Pieces ----------------------------------------------------------------------------------------------------

// Mud-brick house: rendered walls, a parapet round the flat roof, beam ends (vigas) poking out of the south face,
// a dark door, small shuttered windows, jars by the door. Closed: nobody goes in.
function hut(ctx, w) {
  const { b, rnd, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const c = rnd() < 0.5 ? I.adobe : scale(I.adobe, 0.94);
  b.setColor(c);
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(I.adobeD);
  box3(b, x - 0.04, 0, z - 0.04, bw + 0.08, 0.4, bd + 0.08);
  // Parapet with rounded corners (stepped), roof deck below it.
  b.setColor(scale(c, 1.06));
  box3(b, x, h, z, bw, 0.4, 0.25);
  box3(b, x, h, z + bd - 0.25, bw, 0.4, 0.25);
  box3(b, x, h, z, 0.25, 0.4, bd);
  box3(b, x + bw - 0.25, h, z, 0.25, 0.4, bd);
  b.setColor(scale(I.roof, 1.04));
  box3(b, x + 0.25, h - 0.02, z + 0.25, bw - 0.5, 0.04, bd - 0.5);
  // Roof life: a rolled mat, a water jar, sometimes a small dome over the stair.
  b.setColor(I.cloth);
  box3(b, x + 0.5, h, z + 0.6, Math.min(1.6, bw - 1), 0.12, 0.7);
  if (bw * bd > 16 && rnd() < 0.6) {
    b.setColor(scale(c, 1.1));
    const dx = x + bw * 0.7, dz = z + bd * 0.6;
    b.prismY(h, h + 0.5, dx, dz, 0.8, 0.7, 8);
    b.prismY(h + 0.5, h + 0.9, dx, dz, 0.7, 0.15, 8);
  }
  b.setColor(I.beam);
  for (let i = 0.5; i < bw - 0.3; i += 0.8) box3(b, x + i, h - 0.55, z + bd, 0.12, 0.12, 0.35);
  // Door and windows on the south face, a window on the west.
  const fz = z + bd + 0.01;
  b.setColor(I.door);
  const dx = x + bw * (0.3 + rnd() * 0.3);
  box3(b, dx, 0, fz, 0.9, Math.min(2, h - 0.6), 0.04);
  b.setColor(I.beam);
  box3(b, dx - 0.1, Math.min(2, h - 0.6), fz, 1.1, 0.12, 0.08);
  b.setColor(scale(I.door, 0.8));
  for (const wx of [x + 0.5, x + bw - 1.1]) if (Math.abs(wx - dx) > 1) box3(b, wx, h * 0.5, fz, 0.55, 0.5, 0.03);
  box3(b, x - 0.03, h * 0.5, z + bd / 2 - 0.3, 0.03, 0.5, 0.6);
  // A clay jar by the door.
  b.setColor(scale(I.rust, 1.1));
  b.prismY(0, 0.55, dx + 1.25, fz + 0.3, 0.22, 0.12, 7);
  if (w.h < 3) return;
  // A cloth awning over the door on taller houses.
  b.setColor(rnd() < 0.5 ? I.cloth : I.clothB);
  b.quad([dx - 0.3, 2.3, fz], [dx + 1.2, 2.3, fz], [dx + 1.2, 2.05, fz + 0.7], [dx - 0.3, 2.05, fz + 0.7]);
}

// Low mud garden wall with a rounded cap.
function mudWall(ctx, w) {
  const { b, rnd, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.mud);
  box3(b, x, 0, z, bw, h * 0.85, bd);
  b.setColor(scale(I.adobe, 0.98));
  box3(b, x - 0.03, h * 0.85, z - 0.03, bw + 0.06, h * 0.15, bd + 0.06, 0.05);
  b.setColor(I.mudD);
  const long = bw >= bd, L = long ? bw : bd;
  for (let i = 0; i < L / 1.5; i++) {
    const s = rnd() * (L - 0.5), y = 0.15 + rnd() * (h * 0.5);
    if (long) box3(b, x + s, y, z + bd + 0.01, 0.3 + rnd() * 0.3, 0.15, 0.02);
    else box3(b, x + bw + 0.01, y, z + s, 0.02, 0.15, 0.3 + rnd() * 0.3);
  }
}

// A date palm: a ringed, slightly leaning trunk and a crown of drooping fronds (flat blades: from above they read as
// a star and hide little).
function palmTree(b, I, x, z, hgt, rnd) {
  const lean = (rnd() - 0.5) * 0.8, leanZ = (rnd() - 0.5) * 0.6;
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    b.setColor(i % 2 ? I.trunk : I.trunkD);
    const x0 = x + lean * t0 * t0, z0 = z + leanZ * t0 * t0, x1 = x + lean * t1 * t1, z1 = z + leanZ * t1 * t1;
    b.loft([ring(x0, hgt * t0, z0, 0.2 - 0.05 * t0), ring(x1, hgt * t1, z1, 0.2 - 0.05 * t1)]);
  }
  const tx = x + lean, tz = z + leanZ;
  const n = 8, off = rnd() * 6;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2, len = 1.7 + rnd() * 0.6;
    const ca = Math.cos(a), sa = Math.sin(a), px = -sa * 0.28, pz = ca * 0.28;
    const mx = tx + ca * len * 0.55, mz = tz + sa * len * 0.55, ex = tx + ca * len, ez = tz + sa * len;
    b.setColor(i % 2 ? I.palm : I.palmD);
    b.tri([tx, hgt + 0.1, tz], [mx + px, hgt + 0.25, mz + pz], [mx - px, hgt + 0.25, mz - pz], [tx, hgt - 5, tz]);
    b.tri([mx + px, hgt + 0.25, mz + pz], [ex, hgt - 0.55, ez], [mx - px, hgt + 0.25, mz - pz], [tx, hgt - 5, tz]);
  }
  b.setColor(I.rust);
  b.prismY(hgt - 0.35, hgt + 0.05, tx + 0.15, tz + 0.2, 0.18, 0.1, 5);
}
function ring(x, y, z, r, n = 6) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r]); }
  return out;
}

// Stone-ringed palm bed: low cover with a palm in it.
function palmBed(ctx, w) {
  const { b, rnd, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.rockL);
  box3(b, x, 0, z, bw, h, bd, 0.1);
  b.setColor(I.mudD);
  box3(b, x + 0.18, h, z + 0.18, bw - 0.36, 0.02, bd - 0.36);
  palmTree(b, I, x + bw / 2, z + bd / 2, 3.6 + rnd() * 0.8, rnd);
}

// Spring pool: a stone kerb at ground level, a sloping mud bank down to the water, reeds and lily pads.
function pool(ctx, w) {
  const { b, rnd, theme } = ctx;
  const I = theme.ink;
  const lip = (x0, z0, x1, z1, ox, oz) => {
    b.setColor(I.mudD);
    b.quad([x0, 0.02, z0], [x1, 0.02, z1], [x1, WATER_Y - 0.6, z1], [x0, WATER_Y - 0.6, z0], [(x0 + x1) / 2 + ox, -0.3, (z0 + z1) / 2 + oz]);
  };
  lip(w.x, w.z, w.x + w.w, w.z, 0, -1);
  lip(w.x + w.w, w.z, w.x + w.w, w.z + w.d, 1, 0);
  lip(w.x + w.w, w.z + w.d, w.x, w.z + w.d, 0, 1);
  lip(w.x, w.z + w.d, w.x, w.z, -1, 0);
  // Kerb stones round the edge.
  for (let s = 0; s < w.w; s += 0.7) {
    b.setColor(scale(I.rockL, 0.85 + rnd() * 0.25));
    box3(b, w.x + s, 0, w.z - 0.35, 0.62, 0.18, 0.35, 0.04);
    box3(b, w.x + s, 0, w.z + w.d, 0.62, 0.18, 0.35, 0.04);
  }
  for (let s = 0; s < w.d; s += 0.7) {
    b.setColor(scale(I.rockL, 0.85 + rnd() * 0.25));
    box3(b, w.x - 0.35, 0, w.z + s, 0.35, 0.18, 0.62, 0.04);
    box3(b, w.x + w.w, 0, w.z + s, 0.35, 0.18, 0.62, 0.04);
  }
  for (let i = 0; i < (w.w + w.d) * 1.6; i++) {
    const side = Math.floor(rnd() * 4), t = rnd();
    const x = side < 2 ? w.x + t * w.w : side === 2 ? w.x + 0.2 : w.x + w.w - 0.2;
    const z = side === 0 ? w.z + 0.2 : side === 1 ? w.z + w.d - 0.2 : w.z + t * w.d;
    b.setColor(scale(I.reed, 0.8 + rnd() * 0.3));
    b.prismY(WATER_Y, 0.4 + rnd() * 0.6, x, z, 0.1, 0.02, 3, rnd() * 3);
  }
  b.setColor(I.grass);
  for (let i = 0; i < 7; i++) b.prismY(WATER_Y + 0.02, WATER_Y + 0.05, w.x + 0.8 + rnd() * (w.w - 1.6), w.z + 0.8 + rnd() * (w.d - 1.6), 0.35, 0.35, 7);
}

// The dam: a concrete wall with buttress ribs on its downstream (east) face, a walkway rail on top, steel gate frames
// facing the spillways and water stains. The middle pier carries the gate house.
function dam(ctx, w) {
  const { b, rnd, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(I.damC);
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(I.damD);
  box3(b, x - 0.05, 0, z - 0.05, bw + 0.1, 0.5, bd + 0.1);
  for (let s = 1; s < bd - 0.5; s += 2.5) {
    for (const fx of [x - 0.35, x + bw]) {
      b.setColor(scale(I.damC, 0.92));
      b.loft([[[fx, 0, z + s], [fx + 0.35, 0, z + s], [fx + 0.35, h - 0.2, z + s], [fx + (fx < x + 1 ? 0.35 : 0), h - 0.2, z + s]],
        [[fx, 0, z + s + 0.6], [fx + 0.35, 0, z + s + 0.6], [fx + 0.35, h - 0.2, z + s + 0.6], [fx + (fx < x + 1 ? 0.35 : 0), h - 0.2, z + s + 0.6]]]);
    }
  }
  // Stains running down from the top, darker on the old waterline.
  b.setColor(scale(I.damD, 0.9));
  for (let i = 0; i < bd / 1.5; i++) {
    const s = 0.3 + rnd() * (bd - 0.8), len = 0.8 + rnd() * (h - 1.2);
    box3(b, x - 0.01, h - len, z + s, 0.02, len, 0.18 + rnd() * 0.2);
    box3(b, x + bw - 0.01, h - len, z + s, 0.02, len, 0.18 + rnd() * 0.2);
  }
  // Walkway rails along the top.
  b.setColor(I.steel);
  for (const rx of [x + 0.15, x + bw - 0.2]) {
    box3(b, rx, h + 0.75, z, 0.05, 0.05, bd);
    for (let s = 0.2; s < bd; s += 1.5) box3(b, rx, h, z + s, 0.05, 0.8, 0.05);
  }
  // Gate frames on the faces that look into a spillway.
  b.setColor(I.rust);
  for (const gz of [z - 0.15, z + bd]) {
    box3(b, x + 0.4, 0, gz, 0.25, h + 0.6, 0.15);
    box3(b, x + bw - 0.65, 0, gz, 0.25, h + 0.6, 0.15);
    box3(b, x + 0.4, h + 0.4, gz, bw - 0.8, 0.25, 0.15);
  }
  if (w.landmark) {
    b.setColor(scale(I.damC, 1.08));
    box3(b, x + 1.2, h, z + 1, bw - 2.4, 1.3, bd - 2);
    b.setColor(I.trim);
    box3(b, x + 1.1, h + 1.3, z + 0.9, bw - 2.2, 0.12, bd - 1.8);
    b.setColor(scale(I.door, 0.8));
    box3(b, x + bw / 2 - 0.4, h, z + bd - 1.02, 0.8, 1.0, 0.03);
    b.setColor(I.steel);
    b.prismY(h + 1.42, h + 2.6, x + bw - 1.6, z + 1.4, 0.04, 0.03, 4);
  }
}

// A fallen water tank on its side, rust streaked.
function tank(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: tw, d: td, h } = w;
  const r = Math.min(tw, h) / 2;
  b.setColor(I.rust);
  if (td >= tw) b.prismZ(z + 0.05, z + td - 0.05, x + tw / 2, r, r, r, 10);
  else b.prismX(x + 0.05, x + tw - 0.05, r, z + td / 2, r, r, 10);
  b.setColor(scale(I.rust, 0.75));
  for (let s = 0.4; s < Math.max(tw, td) - 0.2; s += 1.1) {
    if (td >= tw) b.prismZ(z + s, z + s + 0.1, x + tw / 2, r, r + 0.03, r + 0.03, 10);
    else b.prismX(x + s, x + s + 0.1, r, z + td / 2, r + 0.03, r + 0.03, 10);
  }
}

// The old well in Dust's courtyard: a stone ring with a timber frame and a bucket on its rope.
function well(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const cx = x + bw / 2, cz = z + bd / 2, r = Math.min(bw, bd) / 2;
  b.setColor(I.rockL);
  b.prismY(0, h * 0.7, cx, cz, r, r * 0.95, 10);
  b.setColor(scale(I.rockD, 0.5));
  b.prismY(h * 0.7, h * 0.72, cx, cz, r * 0.7, r * 0.7, 10);
  b.setColor(I.beam);
  for (const s of [-1, 1]) box3(b, cx + s * (r - 0.12) - 0.06, h * 0.7, cz - 0.06, 0.12, 1.4, 0.12);
  box3(b, cx - r, h * 0.7 + 1.3, cz - 0.06, 2 * r, 0.12, 0.12);
  b.setColor(I.rust);
  b.prismY(h * 0.7 + 0.5, h * 0.7 + 0.8, cx, cz, 0.16, 0.2, 6);
}

const has = (w, k) => !!w[k];
export const dress = {
  rock: (c, w) => (has(w, 'landmark') && w.w < 3 ? well(c, w) : rockWall(c, w)),
  boulder: (c, w) => (has(w, 'palm') ? palmBed(c, w) : boulder(c, w)),
  adobe: (c, w) => (has(w, 'hut') ? hut(c, w) : adobe(c, w)),
  tent,
  sandbag: sandbags,
  wall: adobeScreen,
  border: ridge,
  barrier: mudWall,
  building: (c, w) => (has(w, 'dam') ? dam(c, w) : hut(c, w)),
  container: (c, w) => (has(w, 'tank') ? tank(c, w) : container(c.b, w, c.rnd)),
  crate: (c, w) => crate(c.b, w, c.rnd),
  water: (c, w) => pool(c, w),
};

// ---- Decor -----------------------------------------------------------------------------------------------------

function decor(ctx) {
  const { b, rnd, W, H, map, theme } = ctx;
  const I = theme.ink;
  // Mesas on the horizon north and to the sides; low dunes south so the view stays clear.
  const far = map.size === 'large' ? 30 : 24;
  for (let x = -far; x < W + far; x += 11 + rnd() * 6) {
    rockMass(ctx, x, -14 - rnd() * 6, 9 + rnd() * 7, 7 + rnd() * 4, 7 + rnd() * 6, { levels: 5 });
    if (rnd() < 0.5) rockMass(ctx, x + 2, H + 4 + rnd() * 3, 7, 4, 1.5 + rnd() * 1.4, { levels: 2, colour: I.rockL });
  }
  for (let z = -6; z < H + 6; z += 9 + rnd() * 5) {
    rockMass(ctx, -13 - rnd() * 3, z, 8, 7, 5 + rnd() * 5, { levels: 4 });
    rockMass(ctx, W + 5 + rnd() * 3, z, 8, 7, 5 + rnd() * 5, { levels: 4 });
  }
  // Camel-thorn scrub just beyond the ridge, and palms over the walls where the map has a spring.
  b.setColor(scale(I.canvasB, 0.7));
  for (let i = 0; i < 26; i++) b.prismY(0, 0.5 + rnd() * 0.4, -6 + rnd() * (W + 12), H + 1.5 + rnd() * 3, 0.5, 0.08, 5, rnd() * 3);
  {
    // Palms beyond the walls: a grove where the map has a spring, a few elsewhere.
    const n = map.walls.some(w => w.kind === 'water') ? 18 : 7;
    for (let i = 0; i < n; i++) {
      const side = i % 3, t = rnd();
      const x = side === 0 ? -3 - rnd() * 5 : side === 1 ? W + 3 + rnd() * 5 : t * W;
      const z = side === 2 ? -3 - rnd() * 4 : t * H;
      palmTree(b, I, x, z, 4 + rnd() * 2, rnd);
    }
  }
  // The riverbed carries on past both ends of the map: boulders on its banks where it leaves.
  for (const r of zonesOf(map)) {
    if (r.kind !== 'riverbed') continue;
    for (const ex of [-8, W + 2]) for (let k = 0; k < 4; k++) rockMass(ctx, ex + rnd() * 5, r.z - 2 + (k < 2 ? 0 : r.d), 2 + rnd() * 2, 2, 1 + rnd(), { levels: 2, colour: I.rockL });
  }
  skyRing(ctx, { low: [0.1, 0.07, 0.04], mid: [0.32, 0.22, 0.14], warm: [0.62, 0.38, 0.18], high: [0.18, 0.2, 0.26], warmDir: [-1, 0.3], y0: -8, y1: 10, y2: 60 });
}

export const stage = { lights: () => {}, ground, paint, decor };
