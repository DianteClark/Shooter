// Moods for the older desert, jungle, arctic, coast and farm maps (ROADMAP 53). Maps that share a theme get their own
// hour so no two read alike: Dust a pink-gold evening, Oasis a cool misty dawn, Canyon a red-rock sunset; Ruins a misty
// sunrise, Canopy an overcast hour after rain, Riverbend a gold afternoon, Expedition a monsoon storm; Frostline a
// night under the aurora, Icebreaker a crisp polar noon.
import { MOODS, THEMES } from '../../art.js';
import {
  box3, emissive, scale, norm, rgb, mid, flagged, first, ofKind, beacon, bloom, mast, festoon, bunting, disc, stack,
  scatter, mixc,
} from './lib.js';

const inWater = (map, x, z) => map.walls.some(w => w.kind === 'water' && x > w.x && x < w.x + w.w && z > w.z && z < w.z + w.d);
const mistOver = (map, every = 6, y = 0.1) => {
  const out = [];
  for (const w of ofKind(map, 'water')) {
    for (let x = w.x + every / 2; x < w.x + w.w; x += every) for (let z = w.z + every / 2; z < w.z + w.d; z += every) out.push({ x, z, y, kind: 'mist', rate: 0.7 });
    if (w.w < every || w.d < every) out.push({ x: w.x + w.w / 2, z: w.z + w.d / 2, y, kind: 'mist', rate: 0.7 });
  }
  return out;
};
// A brazier on top of a blocking piece: an iron bowl, a flame, its pool and glow. Pair with an `ember` emitter.
function brazier(ctx, x, y, z) {
  const b = ctx.b;
  b.setColor([0.16, 0.14, 0.14]);
  b.prismY(y, y + 0.3, x, z, 0.12, 0.3, 6);
  emissive(b, () => { b.setColor([1, 0.56, 0.18]); b.prismY(y + 0.28, y + 0.62, x, z, 0.24, 0.04, 5); });
  ctx.glow.halo(x, z, 2.4, [0.26, 0.12, 0.03], y + 0.1);
  ctx.lamps.push({ x, z, r: 5, col: [0.62, 0.32, 0.08] });
}

// ---- Dust: a pink-gold evening over the town --------------------------------------------------------------------
MOODS.dust = {
  theme: {
    light: { dir: norm([-0.86, 0.36, 0.3]), sun: [1.08, 0.74, 0.52], sky: [0.46, 0.38, 0.44], amb: [0.36, 0.3, 0.33] },
    clear: 0x4a2a26,
    fog: [0.62, 0.44, 0.42], fogSeam: [0.28, 0.12, 0.06], desatTint: [0.9, 0.8, 0.78],
    shadow: { col: [0.44, 0.3, 0.44], strength: 0.72, len: 1.7 },
    lamp: [0.3, 0.16, 0.06],
    ink: { ground: 0x9e8a76, dirt: 0xaa9174, adobe: 0xb49a80, adobeD: 0x8f7562, rock: 0x93745e, rockL: 0xb09078 },
    sky: { low: [0.12, 0.06, 0.06], mid: [0.48, 0.28, 0.26], warm: [1.15, 0.58, 0.26], high: [0.2, 0.16, 0.3] },
  },
  life: { flock: 6, ground: 6, devils: 4, emit: map => ofKind(map, 'tent').filter((_, i) => i % 2 === 0).map(w => ({ x: w.x + w.w / 2, z: w.z - 0.4, y: 0.3, kind: 'smoke', rate: 0.5, col: [0.5, 0.44, 0.4] })) },
  ground(ctx, p, c) {
    // A tiled star round the well in the square: the town's centre, readable from the top of the screen.
    const lm = first(ctx.map, 'landmark');
    if (!lm) return c;
    const [cx, cz] = mid(lm), dx = p[0] - cx, dz = p[2] - cz, d = Math.hypot(dx, dz);
    if (d > 6) return c;
    const a = Math.atan2(dz, dx), star = 4.2 + Math.cos(a * 8) * 1.2;
    if (d < star && d > star - 0.9) return [0.28, 0.4, 0.46];
    return d < star ? mixc(c, [0.78, 0.66, 0.5], 0.5) : c;
  },
  decor(ctx) {
    const { map } = ctx, I = ctx.theme.ink;
    const lm = first(map, 'landmark');
    if (lm) {
      // The well-head: an A-frame and pulley over the well, a lantern hung from it.
      const [x, z] = mid(lm), y = lm.h;
      ctx.b.setColor(I.beam);
      for (const s of [-1, 1]) { box3(ctx.b, x + s * 0.7 - 0.07, y - 0.2, z - 0.07, 0.14, 1.7, 0.14); }
      box3(ctx.b, x - 0.8, y + 1.45, z - 0.06, 1.6, 0.12, 0.12);
      ctx.b.setColor(I.rust);
      ctx.b.prismZ(z - 0.12, z + 0.12, x, y + 1.3, 0.16, 0.16, 6);
      beacon(ctx, x + 0.4, y + 1.0, z + 0.1, [1, 0.72, 0.36], { size: 0.16, halo: 3, pool: 6, haloY: 0.16 });
      // Bunting from the well-head out to the nearest adobes.
      const adobes = ofKind(map, 'adobe').map(w => ({ w, d: Math.hypot(mid(w)[0] - x, mid(w)[1] - z) })).sort((a, b) => a.d - b.d).slice(0, 4);
      for (const { w } of adobes) {
        const ex = Math.max(w.x, Math.min(x, w.x + w.w)), ez = Math.max(w.z, Math.min(z, w.z + w.d));
        bunting(ctx, x, z, ex, ez, w.h + 0.2, [I.cloth, I.clothB, 0xc89a40, 0xcabb9a], { sag: 0.7, step: 0.6 });
      }
    }
    scatter(ctx, 180, [I.rockD, I.trim, I.canvasB, [0.6, 0.52, 0.4]], { size: 0.16 });
  },
  thumb: { ground: '#a48a74', solid: '#76584a', low: '#957a62', edge: '#3c2622' },
};

// ---- Oasis: a cool dawn, mist off the pool -------------------------------------------------------------------------
MOODS.oasis = {
  theme: {
    light: { dir: norm([0.74, 0.42, 0.3]), sun: [1.0, 0.76, 0.66], sky: [0.42, 0.46, 0.62], amb: [0.32, 0.32, 0.42] },
    clear: 0x2a2a3c,
    fog: [0.56, 0.56, 0.68], fogSeam: [0.16, 0.12, 0.14], desatTint: [0.84, 0.84, 0.92],
    shadow: { col: [0.38, 0.38, 0.6], strength: 0.62, len: 1.5 },
    lamp: [0.36, 0.22, 0.1],
    water: { deep: [0.06, 0.14, 0.18], shallow: [0.18, 0.3, 0.34], glint: [1.0, 0.8, 0.7] },
    ink: { ground: 0xa49a8c, dirt: 0xaea08e, adobe: 0xbaa892, adobeD: 0x948472, grass: 0x6a8048, palm: 0x4a6e3c },
    weather: { fields: [
      { kind: 'mote', count: 60, box: [40, 6, 32], vel: [0.5, 0.1, 0.2], size: 0.1, col: [1.0, 0.9, 0.82], alpha: 0.4 },
      { kind: 'mote', count: 26, box: [44, 1.6, 34], vel: [0.4, 0.02, 0.1], size: 4.2, col: [0.78, 0.8, 0.9], alpha: 0.08 },
      { kind: 'leaf', count: 10, box: [40, 6, 30], vel: [0.5, -0.4, 0.2], size: 0.32, col: [0.6, 0.66, 0.36], alpha: 0.9 },
    ] },
    sky: { low: [0.12, 0.1, 0.16], mid: [0.4, 0.38, 0.52], warm: [1.05, 0.66, 0.52], high: [0.26, 0.32, 0.5], warmDir: [1, 0.3] },
  },
  life: { flock: 10, ground: 8, col: [0.86, 0.84, 0.8], size: 0.42, devils: 0, emit: map => mistOver(map, 3.4) },
  decor(ctx) {
    const { map, b } = ctx, I = ctx.theme.ink, Y = ctx.kit.WATER_Y;
    for (const w of flagged(map, 'pool')) {
      // Lily pads, reeds at the corners and a lantern string across the pool.
      for (let i = 0; i < 16; i++) {
        const x = w.x + 0.6 + ctx.rnd() * (w.w - 1.2), z = w.z + 0.5 + ctx.rnd() * (w.d - 1);
        b.setColor(scale(I.grass, 0.8 + ctx.rnd() * 0.3));
        b.prismY(Y + 0.01, Y + 0.03, x, z, 0.26 + ctx.rnd() * 0.18, 0.26, 6, ctx.rnd());
        if (i % 5 === 0) { b.setColor([0.94, 0.86, 0.9]); b.prismY(Y + 0.03, Y + 0.12, x, z, 0.08, 0.03, 5); }
      }
      for (const [x, z] of [[w.x + 0.3, w.z + 0.3], [w.x + w.w - 0.3, w.z + w.d - 0.3], [w.x + w.w - 0.3, w.z + 0.3], [w.x + 0.3, w.z + w.d - 0.3]]) {
        b.setColor(I.reed);
        for (let k = 0; k < 5; k++) box3(b, x + (k % 3 - 1) * 0.12, Y, z + (k % 2) * 0.1, 0.04, 1.1 + k * 0.08, 0.04);
      }
      festoon(ctx, w.x - 0.2, w.z + w.d / 2, w.x + w.w + 0.2, w.z + w.d / 2, 2.7, [1, 0.74, 0.4], { sag: 0.5, step: 1.0, pool: 3 });
    }
    scatter(ctx, 120, [I.palmD, I.rockD, [0.66, 0.6, 0.52]], { size: 0.16 });
  },
  thumb: { ground: '#a49a8e', solid: '#74665a', low: '#968a7a', water: '#2c5a62', edge: '#2a2a36' },
};

// ---- Canyon: red rock at sunset ---------------------------------------------------------------------------------
MOODS.canyon = {
  theme: {
    light: { dir: norm([-0.84, 0.32, 0.36]), sun: [1.16, 0.54, 0.32], sky: [0.4, 0.3, 0.42], amb: [0.32, 0.24, 0.3] },
    clear: 0x2a1418,
    fog: [0.58, 0.34, 0.36], fogSeam: [0.3, 0.1, 0.04], desatTint: [0.92, 0.76, 0.76],
    shadow: { col: [0.42, 0.24, 0.44], strength: 0.74, len: 1.9 },
    lamp: [0.4, 0.2, 0.06],
    water: { deep: [0.08, 0.1, 0.14], shallow: [0.2, 0.2, 0.26], glint: [1.0, 0.6, 0.36] },
    ink: { ground: 0x9e7a64, dirt: 0xa67a5c, asphalt: 0x8a6a56, rock: 0x9c5e44, rockD: 0x704030, rockL: 0xb87a58, damC: 0xa89488, damD: 0x7e6c64 },
    weather: { fields: [
      { kind: 'streak', count: 130, box: [38, 3.2, 30], vel: [12, 0.1, 2.5], len: 2.8, width: 0.03, col: [0.96, 0.66, 0.48], alpha: 0.18 },
      { kind: 'mote', count: 120, box: [40, 7, 32], vel: [4.5, 0.1, 1.0], size: 0.12, col: [1.0, 0.72, 0.5], alpha: 0.32 },
      { kind: 'mote', count: 16, box: [44, 3, 34], vel: [5.5, 0.04, 1.2], size: 3.4, col: [0.86, 0.5, 0.4], alpha: 0.06 },
    ] },
    sky: { low: [0.14, 0.05, 0.05], mid: [0.5, 0.2, 0.2], warm: [1.2, 0.46, 0.18], high: [0.16, 0.08, 0.22] },
  },
  life: {
    flock: 5, ground: 4, col: [0.12, 0.08, 0.08], size: 0.7, flockY: 13, devils: 4,
    emit: map => flagged(map, 'dam').filter(w => !w.landmark).map(w => ({ x: w.x + w.w + 0.6, z: w.z + w.d / 2, y: 0.4, kind: 'mist', rate: 0.8 })),
  },
  decor(ctx) {
    const { map } = ctx;
    const lm = first(map, 'landmark');
    if (lm) {
      // The dam's control house: a radio mast and a floodlight down onto the river crossing.
      mast(ctx, lm.x + lm.w - 0.8, lm.h, lm.z + 0.8, 4.5, 0x5e6268);
      beacon(ctx, lm.x + 0.6, lm.h + 0.4, lm.z + lm.d - 0.3, [1, 0.86, 0.6], { size: 0.24, halo: 4.5, pool: 9, haloY: 0.16 });
    }
    for (const w of flagged(map, 'dam')) {
      if (w.landmark) continue;
      for (let z = w.z + 2; z < w.z + w.d - 1; z += 4) beacon(ctx, w.x + w.w / 2, w.h + 0.15, z, [1, 0.74, 0.4], { size: 0.14, halo: 1.6, pool: 4, haloY: w.h });
    }
    scatter(ctx, 220, [[0.5, 0.32, 0.24], [0.6, 0.44, 0.34], [0.36, 0.26, 0.22]], { size: 0.2 });
  },
  thumb: { ground: '#9e7a64', solid: '#7a4434', low: '#94684e', water: '#2c3a46', edge: '#2a1418' },
};

// ---- Ruins: sunrise mist in the clearing ---------------------------------------------------------------------------
MOODS.ruins = {
  theme: {
    light: { dir: norm([0.7, 0.42, 0.4]), sun: [1.12, 0.74, 0.46], sky: [0.34, 0.38, 0.42], amb: [0.25, 0.26, 0.3] },
    clear: 0x262c22,
    fog: [0.6, 0.62, 0.54], fogSeam: [0.22, 0.16, 0.06], desatTint: [0.88, 0.88, 0.8],
    shadow: { col: [0.32, 0.38, 0.4], strength: 0.62, len: 1.3 },
    ink: { ground: 0x4c5634, grass: 0x58663a, moss: 0x55663a, leaf: 0x3a5e30, leafL: 0x5a7a3a },
    weather: { fields: [
      { kind: 'mote', count: 34, box: [46, 2.2, 36], vel: [0.3, 0.02, 0.1], size: 4.6, col: [0.92, 0.92, 0.84], alpha: 0.09 },
      { kind: 'mote', count: 70, box: [38, 5, 30], vel: [0.2, 0.14, 0.1], size: 0.08, col: [1.0, 0.92, 0.6], alpha: 0.6 },
      { kind: 'leaf', count: 20, box: [40, 8, 30], vel: [0.3, -0.5, 0.15], size: 0.45, col: [0.5, 0.66, 0.24], alpha: 0.9 },
    ] },
    sky: { low: [0.2, 0.22, 0.16], mid: [0.56, 0.56, 0.46], warm: [1.0, 0.76, 0.46], high: [0.36, 0.44, 0.46], warmDir: [1, 0.6] },
  },
  life: {
    flock: 9, col: [0.86, 0.84, 0.78], size: 0.56,
    emit: map => flagged(map, 'altar').flatMap(w => [[w.x + 0.4, w.z + 0.4], [w.x + w.w - 0.4, w.z + w.d - 0.4]].map(([x, z]) => ({ x, z, y: w.h + 0.6, kind: 'ember', rate: 0.8 }))),
  },
  decor(ctx) {
    for (const w of flagged(ctx.map, 'altar')) {
      brazier(ctx, w.x + 0.4, w.h, w.z + 0.4);
      brazier(ctx, w.x + w.w - 0.4, w.h, w.z + w.d - 0.4);
      // An offering of marigolds round the altar's foot.
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2, r = Math.max(w.w, w.d) * 0.72 + 0.35;
        const [x, z] = mid(w);
        ctx.b.setColor(i % 3 ? [0.92, 0.56, 0.12] : [0.86, 0.3, 0.16]);
        ctx.b.groundRect(x + Math.cos(a) * r - 0.07, z + Math.sin(a) * r - 0.07, 0.14, 0.14, 0.05);
      }
    }
    scatter(ctx, 140, [[0.42, 0.5, 0.2], [0.5, 0.36, 0.2], [0.62, 0.58, 0.44]], { size: 0.16 });
  },
  thumb: { ground: '#566234', solid: '#a89c7e', low: '#6e7a48', edge: '#1e2418' },
};

// ---- Canopy: the hour after the rain --------------------------------------------------------------------------------
MOODS.canopy = {
  theme: {
    light: { dir: norm([-0.22, 0.9, 0.38]), sun: [0.5, 0.56, 0.5], sky: [0.34, 0.4, 0.36], amb: [0.26, 0.3, 0.27] },
    clear: 0x141c16,
    fog: [0.38, 0.48, 0.42], fogSeam: [0.08, 0.14, 0.1], desatTint: [0.8, 0.88, 0.82],
    shadow: { col: [0.3, 0.4, 0.36], strength: 0.5, len: 0.45 },
    wet: 0.6, sheen: norm([0.1, 0.9, -0.42]), sheenCol: [0.4, 0.5, 0.44],
    ink: { ground: 0x3a4a2a, grass: 0x445c2e, leaf: 0x2e6026, leafL: 0x4e7c2c },
    weather: { fields: [
      { kind: 'rain', count: 140, box: [36, 14, 28], vel: [-0.6, -12, 0.6], len: 0.5, width: 0.011, col: [0.8, 0.9, 0.84], alpha: 0.18 },
      { kind: 'ripple', count: 60, box: [34, 1, 26], life: 0.7, size: 0.5, col: [0.76, 0.9, 0.82], alpha: 0.28 },
      { kind: 'mote', count: 26, box: [46, 2.4, 36], vel: [0.3, 0.02, 0.15], size: 4.4, col: [0.7, 0.82, 0.74], alpha: 0.08 },
      { kind: 'leaf', count: 18, box: [40, 8, 30], vel: [0.3, -0.6, 0.15], size: 0.45, col: [0.36, 0.56, 0.2], alpha: 0.92 },
    ] },
    sky: { low: [0.1, 0.14, 0.1], mid: [0.3, 0.38, 0.32], warm: [0.48, 0.52, 0.42], high: [0.2, 0.26, 0.26] },
  },
  life: {
    flock: 12, col: [0.1, 0.1, 0.08],
    emit: map => [...mistOver(map, 5), ...flagged(map, 'tree').filter((_, i) => i % 2 === 0).map(w => ({ x: w.x + w.w / 2, z: w.z + w.d / 2, y: 3, kind: 'drip', rate: 1 }))],
  },
  decor(ctx) {
    const lm = first(ctx.map, 'lookout');
    if (lm) {
      // A lantern and a tattered flag on the lookout: the camp's centre from any lane.
      beacon(ctx, lm.x + lm.w / 2, lm.h + 0.5, lm.z + lm.d / 2, [1, 0.74, 0.36], { size: 0.22, halo: 4, pool: 7, haloY: 0.16 });
      ctx.b.setColor([0.3, 0.24, 0.16]);
      box3(ctx.b, lm.x + 0.2, lm.h, lm.z + 0.2, 0.08, 2.4, 0.08);
      ctx.b.setColor([0.66, 0.2, 0.16]);
      ctx.b.tri([lm.x + 0.28, lm.h + 2.3, lm.z + 0.24], [lm.x + 1.4, lm.h + 2.0, lm.z + 0.5], [lm.x + 0.28, lm.h + 1.7, lm.z + 0.24], [lm.x + 0.8, lm.h + 2, lm.z - 2]);
      ctx.b.tri([lm.x + 1.4, lm.h + 2.0, lm.z + 0.5], [lm.x + 0.28, lm.h + 2.3, lm.z + 0.24], [lm.x + 0.28, lm.h + 1.7, lm.z + 0.24], [lm.x + 0.8, lm.h + 2, lm.z + 2]);
    }
    for (const w of flagged(ctx.map, 'lab')) beacon(ctx, w.x + w.w / 2, w.h + 0.1, w.z + w.d + 0.1, [0.8, 0.95, 1], { size: 0.16, halo: 2, pool: 5, haloY: 0.16 });
    scatter(ctx, 160, [[0.3, 0.42, 0.18], [0.4, 0.3, 0.2], [0.24, 0.3, 0.16]], { size: 0.18 });
  },
  thumb: { ground: '#40522c', solid: '#7e8a68', low: '#56683a', water: '#183a30', edge: '#121a12' },
};

// ---- Riverbend: gold afternoon on the river ---------------------------------------------------------------------
MOODS.riverbend = {
  theme: {
    light: { dir: norm([-0.78, 0.44, 0.42]), sun: [1.12, 0.8, 0.46], sky: [0.36, 0.36, 0.3], amb: [0.28, 0.26, 0.2] },
    clear: 0x2a2414,
    fog: [0.6, 0.52, 0.34], fogSeam: [0.24, 0.16, 0.04], desatTint: [0.9, 0.86, 0.74],
    shadow: { col: [0.34, 0.34, 0.3], strength: 0.66, len: 1.35 },
    water: { deep: [0.05, 0.12, 0.08], shallow: [0.16, 0.28, 0.16], glint: [1.0, 0.84, 0.5] },
    ink: { ground: 0x586230, grass: 0x667434, leaf: 0x4a6e28, leafL: 0x6e8e30, dirt: 0x8a5e34 },
    weather: { fields: [
      { kind: 'mote', count: 26, box: [46, 3.5, 36], vel: [0.5, 0.02, 0.2], size: 4.4, col: [0.96, 0.86, 0.6], alpha: 0.06 },
      { kind: 'mote', count: 80, box: [38, 5, 30], vel: [0.3, 0.12, 0.15], size: 0.08, col: [1.0, 0.86, 0.46], alpha: 0.65 },
      { kind: 'mote', count: 30, box: [36, 2.5, 28], vel: [0.4, 0.3, -0.2], size: 0.13, col: [1.0, 0.9, 0.3], alpha: 0.85 },
      { kind: 'leaf', count: 22, box: [40, 8, 30], vel: [0.35, -0.5, 0.15], size: 0.5, col: [0.66, 0.6, 0.22], alpha: 0.92 },
    ] },
    sky: { low: [0.2, 0.18, 0.1], mid: [0.56, 0.5, 0.34], warm: [1.1, 0.72, 0.32], high: [0.3, 0.36, 0.36], warmDir: [-1, 0.5] },
  },
  life: { flock: 12, col: [0.86, 0.86, 0.82], size: 0.6, flockY: 10, emit: map => mistOver(map, 7) },
  decor(ctx) {
    const lm = first(ctx.map, 'landmark');
    if (lm) {
      // The river god: a ring of oil lamps on the stones round the standing idol.
      const [x, z] = mid(lm);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, r = 1.25;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (inWater(ctx.map, px, pz)) continue;
        ctx.b.setColor([0.5, 0.4, 0.3]);
        ctx.b.prismY(0, 0.06, px, pz, 0.12, 0.1, 5);
        emissive(ctx.b, () => { ctx.b.setColor([1, 0.7, 0.3]); ctx.b.prismY(0.06, 0.12, px, pz, 0.05, 0.02, 4); });
      }
      ctx.glow.halo(x, z, 3.2, [0.2, 0.12, 0.03], 0.16);
      ctx.lamps.push({ x, z, r: 5, col: [0.5, 0.3, 0.08] });
      ctx.b.setColor([0.84, 0.66, 0.24]);
      ctx.b.prismY(lm.h, lm.h + 0.4, x, z, 0.5, 0.18, 6);
    }
    scatter(ctx, 260, [[0.62, 0.52, 0.22], [0.44, 0.34, 0.2], [0.34, 0.44, 0.18]], { size: 0.18 });
  },
  thumb: { ground: '#5e6432', solid: '#a89c74', low: '#707a3e', water: '#2a4a2c', edge: '#201c10' },
};

// ---- Expedition: the monsoon breaking over the airstrip -------------------------------------------------------
MOODS.expedition = {
  theme: {
    light: { dir: norm([-0.3, 0.8, 0.5]), sun: [0.52, 0.5, 0.52], sky: [0.3, 0.34, 0.38], amb: [0.24, 0.26, 0.29] },
    clear: 0x10141a,
    fog: [0.32, 0.38, 0.42], fogSeam: [0.06, 0.1, 0.12], desatTint: [0.76, 0.82, 0.86],
    shadow: { col: [0.28, 0.32, 0.38], strength: 0.46, len: 0.5 },
    lamp: [0.46, 0.3, 0.12],
    wet: 0.75, sheen: norm([0.05, 0.92, -0.38]), sheenCol: [0.36, 0.44, 0.5], lightning: true,
    water: { deep: [0.03, 0.08, 0.08], shallow: [0.08, 0.18, 0.18], glint: [0.5, 0.66, 0.74] },
    ink: { ground: 0x3e4c2c, grass: 0x485a2c, dirt: 0x6a4a30, asphalt: 0x6e6c62 },
    weather: { fields: [
      { kind: 'rain', count: 520, box: [38, 16, 30], vel: [-4, -22, 2], len: 1.0, width: 0.016, col: [0.74, 0.84, 0.9], alpha: 0.38 },
      { kind: 'ripple', count: 100, box: [36, 1, 28], life: 0.5, size: 0.7, col: [0.7, 0.84, 0.88], alpha: 0.36 },
      { kind: 'mote', count: 24, box: [44, 3, 34], vel: [-1.6, 0.04, 0.6], size: 4, col: [0.5, 0.58, 0.62], alpha: 0.07 },
      { kind: 'leaf', count: 26, box: [42, 8, 32], vel: [-2.4, -1.2, 0.8], size: 0.45, col: [0.36, 0.52, 0.2], alpha: 0.92 },
    ] },
    sky: { low: [0.04, 0.06, 0.07], mid: [0.14, 0.18, 0.2], warm: [0.3, 0.32, 0.3], high: [0.04, 0.05, 0.08] },
  },
  life: {
    flock: 6, col: [0.08, 0.08, 0.08],
    emit: map => flagged(map, 'plane').flatMap(w => [
      { x: w.x + w.w / 2, z: w.z + w.d / 2, y: w.h + 0.2, kind: 'smoke', rate: 1.3, col: [0.18, 0.18, 0.2] },
      { x: w.x + w.w * 0.3, z: w.z + w.d / 2, y: w.h, kind: 'ember', rate: 0.7 },
    ]),
  },
  decor(ctx) {
    for (const w of flagged(ctx.map, 'plane')) {
      // Fuel still burning in the wreck: the fire glow is what the eye finds first through the rain.
      ctx.glow.halo(w.x + w.w * 0.3, w.z + w.d / 2, 3.4, [0.24, 0.1, 0.02], 0.16);
      ctx.lamps.push({ x: w.x + w.w * 0.3, z: w.z + w.d + 1, r: 5, col: [0.6, 0.28, 0.06] });
    }
    for (const w of flagged(ctx.map, 'tower')) {
      beacon(ctx, w.x + w.w / 2, w.h + 0.4, w.z + w.d / 2, [1, 0.2, 0.14], { size: 0.22, halo: 1.6, haloY: w.h });
      beacon(ctx, w.x + w.w / 2, w.h - 0.6, w.z + w.d + 0.1, [1, 0.9, 0.7], { size: 0.2, halo: 5, pool: 10, haloY: 0.16 });
    }
    scatter(ctx, 280, [[0.28, 0.36, 0.16], [0.36, 0.28, 0.18], [0.5, 0.48, 0.42]], { size: 0.2 });
  },
  thumb: { ground: '#3e4a2c', solid: '#7e8670', low: '#545e3c', water: '#1e3a34', edge: '#0e1210' },
};

// ---- Sunken: the steaming morning, braziers lit at the shrine -------------------------------------------------
MOODS.sunken = {
  life: {
    flock: 9, ground: 0,
    emit: map => [...mistOver(map, 5, 0), ...flagged(map, 'idol').map(w => ({ x: w.x + w.w / 2, z: w.z + w.d / 2, y: w.h + 0.2, kind: 'smoke', rate: 0.5, col: [0.66, 0.66, 0.6] }))],
  },
  decor(ctx) {
    for (const w of flagged(ctx.map, 'idol')) {
      // Incense at the idols: a bowl and a thin glow, and garlands laid round them.
      const [x, z] = mid(w);
      ctx.b.setColor([0.34, 0.3, 0.26]);
      ctx.b.prismY(w.h, w.h + 0.16, x, z, 0.18, 0.24, 6);
      ctx.glow.halo(x, z, 1.8, [0.16, 0.1, 0.03], w.h + 0.1);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        ctx.b.setColor(i % 2 ? [0.84, 0.3, 0.42] : [0.92, 0.66, 0.2]);
        ctx.b.groundRect(x + Math.cos(a) * (w.w * 0.62 + 0.3) - 0.06, z + Math.sin(a) * (w.d * 0.62 + 0.4) - 0.06, 0.12, 0.12, 0.05);
      }
    }
    scatter(ctx, 160, [[0.3, 0.4, 0.22], [0.44, 0.36, 0.24], [0.56, 0.54, 0.44]], { size: 0.16 });
  },
};

// ---- Frostline: night, the aurora over the depot -----------------------------------------------------------------
MOODS.frost = {
  theme: {
    light: THEMES.frost.light, clear: 0x050b14, fog: [0.24, 0.36, 0.48], fogSeam: [0.04, 0.14, 0.14], desatTint: THEMES.frost.desatTint,
    shadow: THEMES.frost.shadow, lamp: [0.66, 0.38, 0.12],
    ink: { ground: 0xa8b4c6, roof: 0xbcc8d8, snow: 0xccd8e6, snowD: 0x9eaec2 },
    weather: THEMES.frost.weather,
    sky: { low: [0.02, 0.05, 0.07], mid: [0.05, 0.2, 0.18], warm: [0.16, 0.66, 0.44], high: [0.06, 0.04, 0.18], warmDir: [0, -1] },
  },
  life: {
    flock: 0, ground: 6, vents: 4,
    emit: map => flagged(map, 'landmark').map(w => ({ x: w.x + w.w - 1, z: w.z + 1, y: w.h + 2.6, kind: 'smoke', rate: 1, col: [0.42, 0.44, 0.5] })),
  },
  decor(ctx) {
    const lm = first(ctx.map, 'landmark');
    if (lm) {
      // The depot's chimney, its smoke lit by the yard lamps, and a lit clock over the doors.
      stack(ctx, lm.x + lm.w - 1, lm.h, lm.z + 1, 2.6, 0.32, 0x6f5850, 0x2c2e36);
      emissive(ctx.b, () => { ctx.b.setColor([1, 0.86, 0.56]); ctx.b.prismZ(lm.z + lm.d + 0.02, lm.z + lm.d + 0.08, lm.x + lm.w / 2, lm.h - 0.5, 0.42, 0.42, 10); });
      bloom(ctx, lm.x + lm.w / 2, lm.h - 0.4, lm.z + lm.d + 0.6, 2.6, [0.16, 0.1, 0.04]);
    }
  },
  thumb: { ground: '#a2aec0', solid: '#4c5868', low: '#c4cede', edge: '#0c141e' },
};

// ---- Icebreaker: a crisp polar noon on the pack ice -----------------------------------------------------------------
MOODS.icebreaker = {
  theme: {
    light: { dir: norm([0.32, 0.66, 0.68]), sun: [0.96, 0.9, 0.84], sky: [0.44, 0.54, 0.72], amb: [0.3, 0.34, 0.44] },
    clear: 0x1c2a3c,
    fog: [0.62, 0.7, 0.84], fogSeam: [0.12, 0.16, 0.26], desatTint: [0.86, 0.9, 0.98],
    shadow: { col: [0.42, 0.52, 0.8], strength: 0.56, len: 0.9 },
    water: { deep: [0.02, 0.06, 0.12], shallow: [0.06, 0.14, 0.22], glint: [0.9, 0.96, 1.0] },
    weather: { fields: [
      { kind: 'mote', count: 90, box: [40, 10, 32], vel: [2.2, -0.8, 0.5], size: 0.08, col: [0.96, 0.98, 1.0], alpha: 0.6 },
      { kind: 'streak', count: 100, box: [38, 1.2, 30], vel: [8, 0, 1.6], len: 1.8, width: 0.03, col: [0.92, 0.96, 1.0], alpha: 0.2 },
      { kind: 'mote', count: 50, box: [36, 4, 28], vel: [0.2, -0.05, 0.1], size: 0.05, col: [1.0, 1.0, 1.0], alpha: 0.95 },
      { kind: 'mote', count: 16, box: [44, 3, 34], vel: [3, 0.02, 0.5], size: 3.6, col: [0.86, 0.92, 1.0], alpha: 0.05 },
    ] },
    sky: { low: [0.3, 0.38, 0.5], mid: [0.5, 0.6, 0.76], warm: [0.9, 0.86, 0.8], high: [0.2, 0.3, 0.5], warmDir: [-0.3, -1] },
  },
  life: {
    flock: 8, ground: 6, col: [0.9, 0.92, 0.94], size: 0.5,
    emit: map => flagged(map, 'deckhouse').map(w => ({ x: w.x + w.w / 2, z: w.z + w.d / 2, y: w.h + 2.4, kind: 'smoke', rate: 1.4, col: [0.24, 0.24, 0.28] })),
  },
  decor(ctx) {
    for (const w of flagged(ctx.map, 'deckhouse')) {
      // A funnel on each deckhouse, red with a black top, smoking: the ship reads end to end from above.
      stack(ctx, w.x + w.w / 2, w.h, w.z + w.d / 2, 2.2, 0.62, 0x8a2a24, 0x241e22);
      ctx.b.setColor([0.84, 0.86, 0.88]);
      ctx.b.prismY(w.h + 1.1, w.h + 1.4, w.x + w.w / 2, w.z + w.d / 2, 0.66, 0.6, 8);
      beacon(ctx, w.x + 0.3, w.h + 0.2, w.z + 0.3, [1, 0.2, 0.14], { size: 0.16, halo: 1, haloY: w.h });
    }
    scatter(ctx, 140, [[0.7, 0.78, 0.86], [0.4, 0.44, 0.5]], { size: 0.2 });
  },
  thumb: { ground: '#c4d0e0', solid: '#5a6a80', low: '#d8e2ee', water: '#1a2a40', edge: '#1c2a3c' },
};

// ---- Harvest: the autumn morning, chimneys going ------------------------------------------------------------------
MOODS.harvest = {
  life: {
    flock: 14, ground: 12, col: [0.06, 0.06, 0.07],
    emit: map => flagged(map, 'house').map(w => ({ x: w.x + w.w - 0.8, z: w.z + 0.8, y: w.h + 2.2, kind: 'smoke', rate: 0.6, col: [0.66, 0.64, 0.62] })),
  },
  decor(ctx) {
    const I = ctx.theme.ink;
    for (const w of flagged(ctx.map, 'house')) stack(ctx, w.x + w.w - 0.8, w.h, w.z + 0.8, 2.0, 0.28, I.stone, I.stoneD);
    for (const w of flagged(ctx.map, 'elevator')) {
      // The grain elevators carry the co-op's name band and a red lamp: the map's two towers.
      beacon(ctx, w.x + w.w / 2, w.h + 1.4, w.z + w.d / 2, [1, 0.2, 0.14], { size: 0.2, halo: 1.2, haloY: w.h });
      bunting(ctx, w.x, w.z + w.d + 0.05, w.x + w.w, w.z + w.d + 0.05, w.h * 0.62, [I.plank, I.white, I.hay], { sag: 0.3 });
    }
    scatter(ctx, 320, [I.hay, I.hayD, [0.82, 0.5, 0.2], [0.6, 0.3, 0.16]], { size: 0.18 });
  },
};

// ---- Millbrook: the spring morning, the wheel turning -------------------------------------------------------------
MOODS.millbrook = {
  life: {
    flock: 10, ground: 8,
    emit: map => [
      ...flagged(map, 'mill').map(w => ({ x: w.x + w.w / 2, z: w.z + w.d + 0.6, y: 0.2, kind: 'spray', rate: 0.6, r: 0.5 })),
      ...flagged(map, 'house').map(w => ({ x: w.x + w.w - 0.8, z: w.z + 0.8, y: w.h + 2.0, kind: 'smoke', rate: 0.5, col: [0.7, 0.7, 0.7] })),
    ],
  },
  decor(ctx) {
    const I = ctx.theme.ink;
    for (const w of flagged(ctx.map, 'house')) stack(ctx, w.x + w.w - 0.8, w.h, w.z + 0.8, 1.9, 0.26, I.wallB || [0.6, 0.58, 0.54], I.trim);
    for (const w of flagged(ctx.map, 'mill')) bunting(ctx, w.x, w.z + w.d + 0.05, w.x + w.w, w.z + w.d + 0.05, w.h - 1.2, [0xd8a0b0, 0xf0ecd8, 0x9ab8d0, 0xe0c870], { sag: 0.4 });
    // Blossom drifted against everything.
    scatter(ctx, 260, [[0.96, 0.82, 0.88], [0.98, 0.94, 0.96], [0.86, 0.66, 0.76]], { size: 0.1 });
  },
};
