// Moods for the older city, port and industrial maps (ROADMAP 53): Railyard, Harbor, Neon, Overpass, Downtown,
// Turnstile, Topside, Foundry, Pier. Neon, Overpass and Downtown share the metro theme, so each gets its own hour and
// palette here: Neon an ultraviolet market night, Overpass a sodium-orange smog dusk, Downtown a teal rainy blue hour.
import { MOODS, THEMES } from '../../art.js';
import {
  box3, emissive, scale, norm, rgb, mid, flagged, first, ofKind, central, beacon, bloom, waterTower, mast, festoon,
  bunting, disc, stack, scatter, mixc, blocked,
} from './lib.js';

const hx = o => o;   // Ink overrides are hex, merged by themeFor.
const near = (x, z, cx, cz, r) => (x - cx) ** 2 + (z - cz) ** 2 < r * r;

// ---- Railyard: the sun going down behind the yard -----------------------------------------------------------------
MOODS.railyard = {
  theme: {
    light: { dir: norm([-0.64, 0.48, 0.6]), sun: [1.14, 0.62, 0.34], sky: [0.36, 0.33, 0.56], amb: [0.29, 0.25, 0.36] },
    clear: 0x1a1220,
    fog: [0.46, 0.36, 0.54], fogSeam: [0.24, 0.1, 0.04],
    shadow: { col: [0.4, 0.32, 0.62], strength: 0.64, len: 1.2 },
    lamp: [0.42, 0.28, 0.12],
    ink: hx({ ground: 0x5e5450, dirt: 0x6e5a48, glow: 0xffc070 }),
    weather: { fields: [
      { kind: 'mote', count: 90, box: [40, 7, 32], vel: [0.5, 0.12, -0.2], size: 0.1, col: [1.0, 0.66, 0.36], alpha: 0.55 },
    ] },
  },
  life: { flock: 11, vents: 4, emit: map => roofStacks(map).map(([x, z, y]) => ({ x, z, y: y + 0.2, kind: 'smoke', rate: 0.7 })) },
  lights(ctx) {
    // A wall lamp over every shed's roller door: warm pools in the lanes as the light goes.
    for (const w of ofKind(ctx.map, 'building')) if (!w.landmark) ctx.lamps.push({ x: w.x + w.w / 2, z: w.z + w.d + 1.4, r: 5.5 });
  },
  ground(ctx, p, c) {
    // Oil and diesel stains along the tracks.
    const [x, , z] = p;
    const n = ctx.noise(x * 0.5 + 40, z * 0.5);
    return ctx.map.lanes.some(l => l.id !== 'mid' && Math.abs(z - l.z) < 1.4) && n > 0.62 ? scale(c, 0.62) : c;
  },
  decor(ctx) {
    const { b, map, W } = ctx, I = ctx.theme.ink;
    const lm = first(map, 'landmark');
    if (lm) {
      // The yard's water tower on the signal box roof: the silhouette the whole map is read from.
      waterTower(ctx, lm.x + 1.5, lm.h - 0.2, lm.z + 1.6, { r: 1.15, legs: 2.2, tank: 1.7, col: 0x7a3a2c, band: 0xc9b48a, roof: 0x3f3d44, leg: 0x2e2c32 });
      beacon(ctx, lm.x + 1.5, lm.h + 4.9, lm.z + 1.6, [1, 0.2, 0.14], { size: 0.2, halo: 1.2, haloY: lm.h + 4.6 });
    }
    // Chimneys on the corner sheds.
    for (const [x, z, y] of roofStacks(map)) stack(ctx, x, y - 1.6, z, 1.6, 0.32, 0x5a4a44, 0x2a2628);
    // Signals at both ends of each track, red and green, standing off the map.
    for (const lane of map.lanes) {
      if (lane.id === 'mid') continue;
      for (const [x, col] of [[-3.5, [1, 0.16, 0.12]], [W + 3.5, [0.3, 1, 0.5]]]) {
        b.setColor(I.trim);
        box3(b, x - 0.09, 0, lane.z - 2.2, 0.18, 4.2, 0.18);
        box3(b, x - 0.3, 3.6, lane.z - 2.35, 0.6, 1.0, 0.3);
        beacon(ctx, x, 4.3, lane.z - 2.05, col, { size: 0.2, halo: 1.4, pool: 4 });
      }
    }
    // Ballast, scraps and leaves blown about the yard.
    scatter(ctx, 220, [I.gravel, I.tie, I.dirt, [0.62, 0.42, 0.22]], { size: 0.16 });
    ctx.kit.skyRing(ctx, { low: [0.1, 0.06, 0.1], mid: [0.4, 0.22, 0.28], warm: [1.1, 0.5, 0.2], high: [0.12, 0.08, 0.22], warmDir: [-1, 0.9], y0: -6, y1: 8, y2: 52 });
  },
  thumb: { ground: '#5e5450', solid: '#9aa0ae', low: '#6d665c', edge: '#1f1a22' },
};
function roofStacks(map) {
  const bs = ofKind(map, 'building').filter(w => !w.landmark);
  return bs.filter((_, i) => i % 2 === 0).map(w => [w.x + w.w - 1.0, w.z + 1.0, w.h + 1.4]);
}

// ---- Harbor: the storm, with the ships lit and smoking -------------------------------------------------------------
MOODS.harbor = {
  life: {
    flock: 13, vents: 3,
    emit: map => ofKind(map, 'hull').filter(w => w.ship).map(w => ({
      x: w.bow > 0 ? w.x + 2.6 : w.x + w.w - 2.6, z: w.z + w.d * 0.48 + 1, y: w.h + 3.1, kind: 'smoke', rate: 1.2, col: [0.2, 0.21, 0.24],
    })),
  },
  decor(ctx) {
    const { map } = ctx;
    for (const w of ofKind(map, 'hull')) {
      // Navigation lights: red to port, green to starboard at the bow, a white stern light.
      const bowX = w.bow > 0 ? w.x + w.w - 0.6 : w.x + 0.6, sternX = w.bow > 0 ? w.x + 0.4 : w.x + w.w - 0.4;
      const port = w.bow > 0 ? w.z + 0.5 : w.z + w.d - 0.5, star = w.bow > 0 ? w.z + w.d - 0.5 : w.z + 0.5;
      beacon(ctx, bowX - Math.sign(w.bow) * 0.6, w.h + 0.35, port, [1, 0.16, 0.12], { size: 0.18, halo: 1.3, haloY: w.h });
      beacon(ctx, bowX - Math.sign(w.bow) * 0.6, w.h + 0.35, star, [0.2, 1, 0.4], { size: 0.18, halo: 1.3, haloY: w.h });
      beacon(ctx, sternX, w.h + 0.3, w.z + w.d / 2, [1, 0.96, 0.84], { size: 0.16, halo: 1.1, haloY: w.h });
      if (w.ship) festoon(ctx, w.x + 1, w.z + w.d * 0.3, w.x + w.w - 1, w.z + w.d * 0.3, w.h + 2.6, [1, 0.86, 0.6], { sag: 0.9, step: 1.6 });
    }
    // Buoys riding in the basins, blinking red and green.
    ofKind(map, 'water').forEach((w, i) => {
      for (const [k, col] of [[0.18, [1, 0.2, 0.14]], [0.82, [0.24, 1, 0.42]]]) {
        const x = w.x + w.w * k, z = w.z + w.d * (i % 2 ? 0.25 : 0.75);
        if (blocked(map, x, z, 0.6) && !map.walls.some(q => q.kind === 'water' && x > q.x && x < q.x + q.w && z > q.z && z < q.z + q.d)) continue;
        ctx.b.setColor(col[0] > 0.5 ? 0x8a2a24 : 0x2a6a3a);
        ctx.b.prismY(ctx.kit.WATER_Y - 0.2, ctx.kit.WATER_Y + 0.5, x, z, 0.32, 0.18, 6);
        beacon(ctx, x, ctx.kit.WATER_Y + 0.62, z, col, { size: 0.14, halo: 1.6, haloY: ctx.kit.WATER_Y + 0.05 });
      }
    });
  },
};

// ---- Neon: the ultraviolet market night (the palette the map was first lit with) -----------------------------------
MOODS.neon = {
  theme: {
    light: THEMES.neon.light, clear: THEMES.neon.clear, fog: THEMES.neon.fog, fogSeam: THEMES.neon.fogSeam,
    desatTint: THEMES.neon.desatTint, shadow: THEMES.neon.shadow, lamp: [0.3, 0.14, 0.3],
    sheen: THEMES.neon.sheen, sheenCol: [0.62, 0.3, 0.78],
    ink: hx({ ground: 0x3a3646, asphalt: 0x2c2a38, roof: 0x2e2c3c, wall: 0x433e52, wallB: 0x4c4258, concrete: 0x5a5670 }),
    weather: THEMES.neon.weather,
    sky: { low: [0.06, 0.02, 0.08], mid: [0.26, 0.08, 0.3], warm: [0.6, 0.12, 0.42], high: [0.04, 0.02, 0.1] },
  },
  life: { flock: 0, ground: 5, vents: 7, emit: map => ofKind(map, 'stall').filter((_, i) => i % 2 === 0).map(w => ({ x: w.x + w.w / 2, z: w.z + w.d / 2, y: 1.1, kind: 'steam', rate: 0.6 })) },
  decor(ctx) {
    const { map } = ctx;
    // Paper lantern strings across the alleys between facing shops, red and amber.
    const shops = ofKind(map, 'shop');
    const done = new Set();
    for (const a of shops) {
      let best = null, bd = 9;
      for (const c of shops) {
        if (c === a || done.has(c)) continue;
        const dz = c.z - (a.z + a.d), ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
        if (dz > 2.5 && dz < bd && ox > 0.8) { bd = dz; best = c; }
      }
      if (!best) continue;
      done.add(a);
      const x = (Math.max(a.x, best.x) + Math.min(a.x + a.w, best.x + best.w)) / 2;
      festoon(ctx, x, a.z + a.d, x + 0.4, best.z, Math.min(a.h, best.h) + 0.3, done.size % 2 ? [1, 0.3, 0.2] : [1, 0.7, 0.3], { sag: 0.45, step: 1.0, pool: 2.4 });
    }
    // The market's centre: a big pink roundel painted on the tallest shop's roof.
    const top = shops.slice().sort((p, q) => q.w * q.d * q.h - p.w * p.d * p.h)[0];
    if (top) {
      const [x, z] = mid(top);
      emissive(ctx.b, () => disc(ctx, x, top.h + 0.06, z, [[Math.min(top.w, top.d) * 0.28, Math.min(top.w, top.d) * 0.36, [1, 0.2, 0.64]]], 18));
      bloom(ctx, x, top.h + 0.1, z, Math.min(top.w, top.d) * 0.6, [0.18, 0.03, 0.12]);
    }
    ctx.kit.skyRing(ctx, { low: [0, 0, 0], mid: [0, 0, 0], warm: [0, 0, 0], high: [0, 0, 0], warmDir: [-1, 0.3], y0: -6, y1: 8, y2: 52 });   // Coloured by theme.sky.
    scatter(ctx, 120, [[0.5, 0.2, 0.4], [0.3, 0.3, 0.38], [0.6, 0.5, 0.3]], { size: 0.14 });
  },
  thumb: { ground: '#2e2a3a', solid: '#7a5c94', low: '#54486a', edge: '#120f1c', accent: '#ff2e9e' },
};

// ---- Overpass: sodium-orange smog at dusk ---------------------------------------------------------------------------
MOODS.overpass = {
  theme: {
    light: { dir: norm([-0.74, 0.46, 0.4]), sun: [0.74, 0.46, 0.3], sky: [0.3, 0.26, 0.36], amb: [0.28, 0.24, 0.3] },
    clear: 0x150e10,
    fog: [0.46, 0.34, 0.34], fogSeam: [0.26, 0.1, 0.04], desatTint: [0.88, 0.78, 0.76],
    shadow: { col: [0.36, 0.28, 0.4], strength: 0.56, len: 1.0 },
    lamp: [0.62, 0.34, 0.1],
    wet: 0.45, sheenCol: [0.6, 0.42, 0.34],
    ink: hx({ ground: 0x4e4844, asphalt: 0x353034, dirt: 0x4a4038, roof: 0x3c363a, wall: 0x504844, wallB: 0x584c4a, concrete: 0x6a6460 }),
    weather: { fields: [
      { kind: 'mote', count: 90, box: [40, 7, 32], vel: [1.2, 0.2, 0.4], size: 0.1, col: [1.0, 0.7, 0.4], alpha: 0.45 },
      { kind: 'streak', count: 60, box: [38, 3, 30], vel: [8, 0.1, 1.8], len: 1.8, width: 0.02, col: [0.9, 0.7, 0.55], alpha: 0.12 },
      { kind: 'mote', count: 26, box: [44, 3.5, 34], vel: [0.8, 0.03, 0.2], size: 4.2, col: [0.62, 0.42, 0.34], alpha: 0.07 },
    ] },
    sky: { low: [0.12, 0.06, 0.06], mid: [0.44, 0.24, 0.18], warm: [1.1, 0.5, 0.18], high: [0.12, 0.08, 0.16], warmDir: [-1, 0.4] },
  },
  life: { flock: 8, ground: 6, col: [0.16, 0.14, 0.16], vents: 5 },
  lights(ctx) {
    // Sodium heads along the lanes, every 13 m, just off the kerb.
    for (const s of ofKind(ctx.map, 'crane')) ctx.lamps.push({ x: s.x + s.w / 2, z: s.z + s.d / 2, r: 6.5, col: [0.64, 0.36, 0.1] });
  },
  ground(ctx, p, c) {
    // A brick plaza round the clock tower: herringbone bands that read from the top of the screen.
    const lm = first(ctx.map, 'landmark');
    if (!lm) return c;
    const [cx, cz] = mid(lm), d = Math.hypot(p[0] - cx, p[2] - cz);
    if (d > 8.5) return c;
    return Math.floor(d * 1.2) % 3 === 0 ? [0.42, 0.26, 0.2] : mixc(c, [0.5, 0.36, 0.3], 0.55);
  },
  decor(ctx) {
    const { b, map } = ctx;
    const lm = first(map, 'landmark');
    if (lm) {
      // The clock tower over the old station kiosk.
      const [cx, cz] = mid(lm), s = 1.8, y0 = lm.h - 0.1, top = y0 + 4.2;
      b.setColor(0x5a4640);
      box3(b, cx - s / 2, y0, cz - s / 2, s, top - y0, s);
      b.setColor(0x34282a);
      box3(b, cx - s / 2 - 0.12, top - 1.6, cz - s / 2 - 0.12, s + 0.24, 0.14, s + 0.24);
      box3(b, cx - s / 2 - 0.12, top, cz - s / 2 - 0.12, s + 0.24, 0.16, s + 0.24);
      b.prismY(top + 0.16, top + 1.5, cx, cz, s * 0.72, 0.06, 4, Math.PI / 4);
      emissive(b, () => {
        b.setColor([1, 0.86, 0.56]);
        box3(b, cx - 0.55, top - 1.35, cz + s / 2 + 0.01, 1.1, 1.1, 0.03);
        box3(b, cx - 0.55, top - 1.35, cz - s / 2 - 0.04, 1.1, 1.1, 0.03);
        box3(b, cx + s / 2 + 0.01, top - 1.35, cz - 0.55, 0.03, 1.1, 1.1);
        box3(b, cx - s / 2 - 0.04, top - 1.35, cz - 0.55, 0.03, 1.1, 1.1);
        b.setColor([0.16, 0.12, 0.1]);
        box3(b, cx - 0.04, top - 0.85, cz + s / 2 + 0.05, 0.08, 0.45, 0.02);
        box3(b, cx - 0.04, top - 0.82, cz + s / 2 + 0.05, 0.36, 0.08, 0.02);
      });
      bloom(ctx, cx, top - 0.8, cz, 3.2, [0.14, 0.09, 0.04]);
      beacon(ctx, cx, top + 1.6, cz, [1, 0.2, 0.14], { size: 0.16, halo: 0.8, haloY: top + 1.4 });
    }
    // Uplights round the statues.
    for (const s of flagged(map, 'statue')) {
      const [x, z] = mid(s);
      ctx.glow.halo(x, z, 2.6, [0.16, 0.1, 0.04], 0.16);
    }
    // Advertising on the tower blocks: bright panels on their roofs facing the camera.
    flagged(map, 'tower').forEach((w, i) => {
      if (i % 2) return;
      const col = [[1, 0.6, 0.2], [0.3, 0.9, 0.8], [1, 0.3, 0.4]][i % 3];
      b.setColor(0x24222a);
      box3(b, w.x + 1, w.h, w.z + w.d - 0.6, Math.min(5, w.w - 2), 1.6, 0.18);
      emissive(b, () => { b.setColor(col); box3(b, w.x + 1.15, w.h + 0.15, w.z + w.d - 0.4, Math.min(5, w.w - 2) - 0.3, 1.3, 0.03); });
      bloom(ctx, w.x + 1 + Math.min(5, w.w - 2) / 2, w.h + 0.2, w.z + w.d + 0.4, 2.4, scale(col, 0.1));
    });
    ctx.kit.skyRing(ctx, { low: [0, 0, 0], mid: [0, 0, 0], warm: [0, 0, 0], high: [0, 0, 0], warmDir: [-1, 0.3], y0: -6, y1: 8, y2: 52 });   // Coloured by theme.sky.
    scatter(ctx, 200, [[0.36, 0.3, 0.26], [0.5, 0.42, 0.3], [0.26, 0.24, 0.26]], { size: 0.16 });
  },
  thumb: { ground: '#463e3a', solid: '#86766e', low: '#5e524a', water: '#1c3448', edge: '#140e10' },
};

// ---- Downtown: teal rainy blue hour, the fountain playing ------------------------------------------------------------
MOODS.downtown = {
  theme: {
    light: { dir: norm([-0.36, 0.76, 0.48]), sun: [0.38, 0.5, 0.6], sky: [0.28, 0.38, 0.5], amb: [0.24, 0.3, 0.36] },
    clear: 0x08121a,
    fog: [0.24, 0.38, 0.48], fogSeam: [0.04, 0.14, 0.18], desatTint: [0.72, 0.84, 0.9],
    shadow: { col: [0.26, 0.36, 0.46], strength: 0.5, len: 0.5 },
    lamp: [0.5, 0.36, 0.16],
    sheenCol: [0.36, 0.56, 0.7],
    water: { deep: [0.03, 0.08, 0.1], shallow: [0.08, 0.2, 0.24], glint: [0.6, 0.86, 0.95] },
    ink: hx({ ground: 0x434b52, asphalt: 0x2a3138, roof: 0x313a42, wall: 0x434c56, wallB: 0x48505c, concrete: 0x5a6670 }),
    weather: { fields: [
      { kind: 'rain', count: 420, box: [36, 14, 28], vel: [-2.5, -20, 1.4], len: 0.9, width: 0.014, col: [0.7, 0.86, 1.0], alpha: 0.34 },
      { kind: 'ripple', count: 90, box: [34, 1, 26], life: 0.5, size: 0.6, col: [0.72, 0.9, 1.0], alpha: 0.32 },
      { kind: 'mote', count: 30, box: [40, 4, 30], vel: [-0.6, 0.2, 0.3], size: 2.6, col: [0.4, 0.56, 0.66], alpha: 0.06 },
    ] },
    sky: { low: [0.02, 0.06, 0.08], mid: [0.08, 0.2, 0.28], warm: [0.3, 0.42, 0.5], high: [0.02, 0.04, 0.1] },
  },
  life: {
    flock: 6, ground: 8, col: [0.5, 0.52, 0.56], vents: 6,
    emit: map => {
      const out = [];
      for (const w of ofKind(map, 'water')) {
        const [x, z] = mid(w);
        out.push({ x, z, y: 0.6, kind: 'spray', rate: 1, r: 0.8 }, { x, z, y: 0.2, kind: 'mist', rate: 0.6 });
      }
      for (const c of flagged(map, 'towerCrane')) out.push({ x: c.x + 1, z: c.z + 1, y: c.h + 0.4, kind: 'spark', rate: 0.5 });
      return out;
    },
  },
  ground(ctx, p, c) {
    // Granite setts in rings round the fountain plaza.
    const f = ofKind(ctx.map, 'water')[0];
    if (!f) return c;
    const [cx, cz] = mid(f), d = Math.hypot(p[0] - cx, p[2] - cz);
    if (d > 9) return c;
    return Math.floor(d * 0.9) % 2 ? mixc(c, [0.52, 0.56, 0.58], 0.5) : mixc(c, [0.36, 0.4, 0.44], 0.5);
  },
  decor(ctx) {
    const { b, map } = ctx;
    for (const w of ofKind(map, 'water')) {
      // The fountain's centre: a bronze figure on a stepped plinth, uplit, its jet the landmark from above.
      const [x, z] = mid(w), Y = ctx.kit.WATER_Y;
      b.setColor(0x6a747c);
      b.prismY(Y, 0.4, x, z, 1.0, 0.9, 8);
      b.prismY(0.4, 0.8, x, z, 0.6, 0.5, 8);
      b.setColor(0x3e5a52);
      b.prismY(0.8, 2.0, x, z, 0.26, 0.18, 6);
      b.prismY(2.0, 2.4, x, z, 0.2, 0.12, 6);
      ctx.glow.halo(x, z, 3.4, [0.06, 0.14, 0.18], 0.0);
      for (let a = 0; a < 6; a++) beacon(ctx, x + Math.cos(a * 1.047) * 1.5, Y + 0.05, z + Math.sin(a * 1.047) * 1.5, [0.6, 0.9, 1], { size: 0.12, halo: 0 });
    }
    // Red lamps on the tower cranes' jibs and the tower blocks' corners.
    for (const c of flagged(map, 'towerCrane')) beacon(ctx, c.x + 1, c.h + 3.5, c.z + 1, [1, 0.18, 0.12], { size: 0.22, halo: 1.4, haloY: c.h + 3 });
    flagged(map, 'tower').forEach((w, i) => { if (i % 3 === 0) beacon(ctx, w.x + 0.3, w.h + 0.2, w.z + 0.3, [1, 0.18, 0.12], { size: 0.16, halo: 0.8, haloY: w.h }); });
    ctx.kit.skyRing(ctx, { low: [0, 0, 0], mid: [0, 0, 0], warm: [0, 0, 0], high: [0, 0, 0], warmDir: [-1, 0.3], y0: -6, y1: 8, y2: 52 });   // Coloured by theme.sky.
    scatter(ctx, 260, [[0.28, 0.36, 0.26], [0.4, 0.34, 0.24], [0.3, 0.32, 0.36]], { size: 0.16 });
  },
  thumb: { ground: '#36404a', solid: '#6e8494', low: '#4c5a66', water: '#1a3c4a', edge: '#0c141a' },
};

// ---- Turnstile: the station after the last train -------------------------------------------------------------------
MOODS.turnstile = {
  theme: {
    light: { dir: norm([-0.15, 0.94, 0.3]), sun: [0.6, 0.66, 0.6], sky: [0.34, 0.4, 0.4], amb: [0.29, 0.32, 0.32] },
    lamp: [0.24, 0.32, 0.28],
    weather: { fields: [
      { kind: 'mote', count: 120, box: [36, 4, 28], vel: [0.5, 0.06, 0.1], size: 0.08, col: [0.86, 0.94, 0.9], alpha: 0.4 },
      { kind: 'mote', count: 16, box: [40, 2.5, 30], vel: [1.4, 0.02, 0.1], size: 3.4, col: [0.56, 0.66, 0.62], alpha: 0.06 },
    ] },
  },
  life: {
    flock: 0, ground: 3, col: [0.3, 0.3, 0.32], vents: 4,
    emit: map => ofKind(map, 'wall').filter((_, i) => i % 3 === 0).map(w => ({ x: w.x + w.w / 2, z: w.z + w.d / 2, y: 3.2, kind: 'drip', rate: 1 })),
  },
  ground(ctx, p, c) {
    // Leaks pooling on the platforms and concourse.
    const x = p[0], z = p[2];
    if (ctx.noise(x * 0.6 + 70, z * 0.6) > 0.7) { ctx.groundWet = 1; return scale(c, 0.7); }
    return c;
  },
  decor(ctx) {
    // Ceiling lights read from above as tube fittings on the platform walls' tops.
    for (const w of ofKind(ctx.map, 'wall')) {
      if (w.w < 3 && w.d < 3) continue;
      const along = w.w > w.d;
      const n = Math.floor((along ? w.w : w.d) / 4);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, x = along ? w.x + w.w * t : w.x + w.w / 2, z = along ? w.z + w.d / 2 : w.z + w.d * t;
        beacon(ctx, x, w.h + 0.1, z, [0.86, 1, 0.94], { size: 0.14, halo: 1.6, pool: 4, haloY: 0.16 });
      }
    }
    scatter(ctx, 140, [[0.86, 0.84, 0.76], [0.4, 0.38, 0.36], [0.6, 0.3, 0.26]], { size: 0.12 });
  },
};

// ---- Topside: sunset on the slab, the crane lights coming on --------------------------------------------------------
MOODS.topside = {
  life: {
    flock: 11, ground: 9,
    emit: map => ofKind(map, 'container').filter((_, i) => i % 4 === 1).map(w => ({ x: w.x + w.w / 2, z: w.z - 0.3, y: 1.0, kind: 'spark', rate: 1 })),
  },
  decor(ctx) {
    const { map } = ctx;
    // Aviation reds on the steel columns and a beacon on the core's roof.
    ofKind(map, 'crane').forEach((c, i) => { if (i % 2 === 0) beacon(ctx, c.x + c.w / 2, c.h + 0.2, c.z + c.d / 2, [1, 0.2, 0.12], { size: 0.18, halo: 1.1, haloY: c.h }); });
    const lm = first(map, 'landmark');
    if (lm) {
      // The site's tower crane mast rising out of the lift core: the one thing taller than the slab.
      mast(ctx, lm.x + lm.w - 1, lm.h, lm.z + 1, 5.5, 0xd49a1e);
      bunting(ctx, lm.x, lm.z + lm.d + 0.02, lm.x + lm.w, lm.z + lm.d + 0.02, lm.h + 0.2, [0xd2a030, 0x2f6494, 0xd8c8a0], { sag: 0.5 });
    }
    scatter(ctx, 200, [[0.66, 0.62, 0.56], [0.5, 0.36, 0.26], [0.4, 0.4, 0.42]], { size: 0.14 });
  },
};

// ---- Foundry: the night shift, the furnace pouring ---------------------------------------------------------------
MOODS.foundry = {
  life: {
    flock: 5, vents: 7,
    emit: map => {
      const out = [];
      for (const s of flagged(map, 'stack')) out.push({ x: s.x + s.w / 2, z: s.z + s.d / 2, y: s.h + 0.3, kind: 'smoke', rate: 1.4, col: [0.22, 0.2, 0.22] });
      for (const f of flagged(map, 'furnace')) {
        const [x, z] = mid(f);
        out.push({ x, z: f.z + f.d + 0.4, y: 1.2, kind: 'ember', rate: 1.3 }, { x, z, y: f.h + 0.5, kind: 'smoke', rate: 1, col: [0.36, 0.3, 0.28] }, { x: x - 2, z: f.z + f.d + 0.3, y: 1.6, kind: 'spark', rate: 1 });
      }
      return out;
    },
  },
  decor(ctx) {
    const { map } = ctx;
    for (const f of flagged(map, 'furnace')) {
      // The tapping glow spilling out of the furnace front: the hottest thing on the map, readable from anywhere.
      const [x] = mid(f);
      ctx.glow.halo(x, f.z + f.d + 1, 5.5, [0.3, 0.12, 0.02], 0.16);
      ctx.lamps.push({ x, z: f.z + f.d + 1.6, r: 6, col: [0.8, 0.36, 0.08] });
    }
    for (const s of flagged(map, 'stack')) beacon(ctx, s.x + s.w / 2, s.h + 0.4, s.z + s.d / 2, [1, 0.18, 0.12], { size: 0.2, halo: 1.2, haloY: s.h });
    scatter(ctx, 240, [[0.2, 0.19, 0.2], [0.4, 0.3, 0.24], [0.5, 0.36, 0.2]], { size: 0.15 });
  },
};

const halls = map => flagged(map, 'boathouse').filter((_, i) => i % 2 === 0);   // Two of the boathouses keep a stove going.

// ---- Pier: a breezy grey morning, gulls and bunting ----------------------------------------------------------------
MOODS.pier = {
  life: { flock: 16, ground: 10, emit: map => halls(map).map(w => ({ x: w.x + w.w - 1, z: w.z + 1, y: w.h + 1.4, kind: 'smoke', rate: 0.6, col: [0.6, 0.62, 0.66] })) },
  decor(ctx) {
    const { map } = ctx, I = ctx.theme.ink;
    for (const w of halls(map)) {
      stack(ctx, w.x + w.w - 1, w.h - 0.2, w.z + 1, 1.5, 0.22, I.red, I.tar);
      bunting(ctx, w.x - 0.2, w.z + w.d + 0.1, w.x + w.w + 0.2, w.z + w.d + 0.1, w.h + 0.1, [I.red, I.white, I.blue, I.buoy], { sag: 0.5 });
    }
    for (const w of flagged(map, 'boathouse')) bunting(ctx, w.x, w.z - 0.05, w.x + w.w, w.z - 0.05, w.h + 0.2, [I.blue, I.white, I.buoy], { sag: 0.4 });
    // Buoys in the water, and lobster-pot floats.
    ofKind(map, 'water').forEach((w, i) => {
      const x = w.x + w.w * (0.3 + 0.4 * (i % 2)), z = w.z + w.d * 0.5;
      ctx.b.setColor(i % 2 ? I.buoy : I.white);
      ctx.b.prismY(ctx.kit.WATER_Y - 0.1, ctx.kit.WATER_Y + 0.3, x, z, 0.22, 0.12, 6);
    });
    scatter(ctx, 160, [I.rope, I.net, I.plankL, [0.86, 0.86, 0.84]], { size: 0.14 });
  },
};
