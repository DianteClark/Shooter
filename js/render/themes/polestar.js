// Polestar Relay's theme (arctic, Graveyard Shift only; js/shared/maps/polestar.js, docs/ZOMBIES.md): an iced-in
// polar station in the middle of the long night. No sun at all: a green aurora overhead lights the snow cold and
// teal, the station's sodium floods throw orange pools along the paths, the ochre huts have lit windows, and a red
// beacon blinks up the relay mast. Clearly not Ashgrove's foggy churchyard (amber oil lamps, grass, flint): blue snow,
// ochre and steel, a big sky. world.js reads `polestar` ({ dress, stage, thumb }) into its tables.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, skyRing } from './kit.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));
const sc = scale;

THEMES.polestar = {
  id: 'polestar',
  // The aurora is the key light: high, from the north, green-teal.
  light: { dir: norm([0.15, 0.85, -0.5]), sun: [0.24, 0.44, 0.4], sky: [0.22, 0.32, 0.42], amb: [0.2, 0.25, 0.34] },
  clear: 0x050a10,
  fog: [0.16, 0.26, 0.32], fogSeam: [0.04, 0.1, 0.1], desatTint: [0.78, 0.9, 0.92],
  shadow: { col: [0.26, 0.36, 0.5], strength: 0.55, len: 0.6 },
  lamp: [0.62, 0.36, 0.1],
  groundAmp: 0.2,
  ink: ink({
    ground: 0x7e94a6, asphalt: 0x3c4048, dirt: 0x6e7c8c, gravel: 0x4c525c,
    roof: 0xb4c4d2, wall: 0x9a7a3a, wallB: 0x5a626c, trim: 0x22262c,
    concrete: 0x7c848e, crate: 0x7a6440, crateD: 0x46382a,
    rail: 0x8a96a2, tie: 0x3a3430, hazardY: 0xc89a2c, hazardK: 0x1e2026,
    paint: 0xc8d0d6, glow: 0xffb050, glowCool: 0xb0f0e0,
    snow: 0x9cb0c2, snowD: 0x7a90a6, snowL: 0xb8c8d8, ice: 0x6aa6c4, iceD: 0x4a7e9e, track: 0x7a8ea2,
    ochre: 0xb08a34, ochreD: 0x7c5e22, steel: 0x5e6874, steelD: 0x343a44, steelL: 0x8a96a4, white: 0xc8d2dc,
    panel: 0x6c7682, panelD: 0x4a525c, red: 0xa83a2c, redD: 0x6c241c, black: 0x16181c, timber: 0x4e3e30,
    sodium: 0xffb048, window: 0xffcc78, beacon: 0xff3a2a, screen: 0x7affd8, aurora: 0x5affb0,
  }),
  containers: [0x9a7a3a, 0x5e6874, 0x6c3a2c],
  weather: { fields: [
    // Fine snow on the wind, spindrift low over the ground, and ice glitter in the air.
    { kind: 'mote', count: 140, box: [40, 12, 32], vel: [1.6, -1.2, 0.5], size: 0.08, col: [0.86, 0.96, 1.0], alpha: 0.6 },
    { kind: 'streak', count: 70, box: [38, 1.0, 30], vel: [7, 0, 1.2], len: 1.4, width: 0.03, col: [0.8, 0.95, 1.0], alpha: 0.16 },
    { kind: 'mote', count: 24, box: [36, 4, 28], vel: [0.15, -0.08, 0.1], size: 0.05, col: [0.6, 1.0, 0.85], alpha: 0.9 },
    { kind: 'mote', count: 14, box: [44, 2.5, 34], vel: [2.2, 0.02, 0.4], size: 3.4, col: [0.5, 0.7, 0.8], alpha: 0.05 },
  ] },
};

// ---- Where things are (render only) --------------------------------------------------------------------------------

// Sodium flood poles: each against a wall or in a corner, out of the paths.
const FLOODS = [
  [1.2, 30.8], [22.8, 30.8], [22.8, 50.8], [14.6, 42],       // Mess Hall.
  [1.2, 10.4], [22.8, 1.2], [22.8, 27.8], [10.6, 27.8],      // Kennels.
  [25.8, 1.2], [47.2, 1.2], [25.8, 15.2], [54.2, 15.2],      // Lab Block.
  [25.8, 17.8], [54.2, 33.2], [25.8, 33.2],                  // Boiler House.
  [25.8, 35.8], [54.2, 35.8], [51.8, 44.2],                  // Hangar.
  [56.8, 1.2], [78.8, 30], [56.8, 30], [78.8, 1.2],          // Mast Field.
  [56.8, 32.8], [71.4, 50.8], [78.8, 32.8],                  // Fuel Depot.
];
const PATHS = [
  // Trodden snow between the gates: [x0, z0, x1, z1, half width].
  [12, 30, 12, 40, 1.1], [12, 38, 24, 42, 1.1], [24, 8, 40, 8, 1.1], [40, 8, 40, 34, 1.0], [40, 42, 56, 43, 1.0], [56, 12, 67, 15, 1.1], [68, 31, 62, 38, 1.1],
];

function polGround(ctx) {
  const { noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const onPath = (x, z) => PATHS.some(([x0, z0, x1, z1, r]) => {
    const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2));
    return Math.hypot(x - x0 - dx * t, z - z0 - dz * t) < r;
  });
  return p => {
    const [x, , z] = p;
    const k = 0.88 + noise(x * 0.6, z * 0.6) * 0.18 + (rnd() - 0.5) * 0.04;
    if (x < 0 || z < 0 || x > W || z > H) return sc(noise(x * 0.08, z * 0.08) > 0.5 ? I.snowL : I.snow, k * 0.78);
    // The helipad's concrete, the hangar apron, the boiler yard's grating.
    if (Math.hypot(x - 62, z - 38.5) < 3.4) return sc(I.concrete, k * 0.9);
    if (x > 25 && x < 55 && z > 17 && z < 34) return sc(noise(x * 0.3, z * 0.3) > 0.55 ? I.gravel : I.asphalt, k * 1.05);
    if (x > 38 && x < 54 && z > 40 && z < 45) return sc(I.concrete, k * 0.85);
    if (onPath(x, z)) return sc(I.track, k);
    // Wind-scoured ice in the open field and the dog run, snow everywhere else.
    if (x > 56 && z < 31 && noise(x * 0.12 + 5, z * 0.12) > 0.62) return sc(I.ice, k * 0.95);
    return sc(noise(x * 0.18 + 3, z * 0.18) > 0.58 ? I.snowD : I.snow, k);
  };
}

function polPaint(ctx) {
  const { b, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  // The helipad: a yellow ring and the H.
  b.setColor(I.hazardY);
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * Math.PI * 2;
    b.groundRect(62 + Math.cos(a) * 2.9 - 0.25, 38.5 + Math.sin(a) * 2.9 - 0.25, 0.5, 0.5, 0.04);
  }
  b.setColor(I.white);
  b.groundRect(61, 37.3, 0.35, 2.4, 0.05); b.groundRect(62.65, 37.3, 0.35, 2.4, 0.05); b.groundRect(61.35, 38.32, 1.3, 0.36, 0.05);
  // Hazard stripes on the hangar apron, sledge tracks and boot prints.
  b.setColor(I.hazardK);
  for (let x = 40.5; x < 51; x += 1.2) b.groundRect(x, 44.4, 0.6, 0.18, 0.04);
  b.setColor(sc(I.track, 0.8));
  for (let i = 0; i < 30; i++) {
    const x = 1 + rnd() * (W - 2), z = 1 + rnd() * (H - 2);
    b.groundRect(x, z, 0.18 + rnd() * 0.25, 0.3 + rnd() * 0.4, 0.03);
  }
  for (const [x0, z0, l] of [[3, 26, 12], [58, 20, 14]]) { b.groundRect(x0, z0, l, 0.12, 0.03); b.groundRect(x0, z0 + 0.7, l, 0.12, 0.03); }
}

function polLights(ctx) {
  const { map, lamps, glow } = ctx;
  const na = [1, 0.6, 0.22];
  for (const [x, z] of FLOODS) { lamps.push({ x, z, r: 8 }); glow.halo(x, z, 4.4, sc(na, 0.1)); }
  for (const w of map.walls) {
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
    if (w.messhut) { lamps.push({ x: cx, z: w.z - 1.8, r: 8, col: [0.52, 0.34, 0.12] }); glow.streak(cx, w.z - 0.3, w.w - 2, 2.4, [0.14, 0.08, 0.02], 0.12); }
    if (w.labhut) lamps.push({ x: cx, z: w.z + w.d + 1.8, r: 8, col: [0.3, 0.46, 0.44] });
    if (w.boiler) { lamps.push({ x: w.x - 1.4, z: cz, r: 6, col: [0.5, 0.26, 0.08] }); glow.halo(w.x + w.w / 2, w.z + w.d + 0.8, 4, [0.12, 0.05, 0.01]); }
    if (w.hangar) lamps.push({ x: cx, z: w.z - 2, r: 9, col: [0.44, 0.34, 0.16] });
    if (w.mast) { lamps.push({ x: cx, z: cz + 2.5, r: 7, col: [0.2, 0.4, 0.34] }); glow.halo(cx, cz, 6, [0.03, 0.09, 0.06]); }
    if (w.dish) lamps.push({ x: cx, z: w.z + w.d + 1.5, r: 5, col: [0.24, 0.38, 0.36] });
  }
}

// ---- Drawers -------------------------------------------------------------------------------------------------------

function snowCap(b, I, x, y, z, w, d) {
  b.setColor(I.snowL);
  box3(b, x + 0.05, y, z + 0.05, w - 0.1, 0.14, d - 0.1, 0.05);
}

// A prefab hut: ochre panels on a steel skid, a snowed flat roof, a band of lit windows facing the camera (south).
function hut(ctx, w, { col, dark, win = true, lit = true }) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: hw, d: hd, h } = w;
  b.setColor(I.steelD);
  box3(b, x - 0.1, 0, z - 0.1, hw + 0.2, 0.45, hd + 0.2);
  b.setColor(col);
  box3(b, x, 0.45, z, hw, h - 0.75, hd);
  b.setColor(dark);
  for (let s = 0; s <= hw - 0.15; s += 1.6) {
    box3(b, x + Math.min(s, hw - 0.15), 0.45, z - 0.03, 0.15, h - 0.75, 0.06);
    box3(b, x + Math.min(s, hw - 0.15), 0.45, z + hd - 0.03, 0.15, h - 0.75, 0.06);
  }
  b.setColor(I.white);
  box3(b, x - 0.15, h - 0.3, z - 0.15, hw + 0.3, 0.2, hd + 0.3);
  snowCap(b, I, x - 0.15, h - 0.1, z - 0.15, hw + 0.3, hd + 0.3);
  if (win) {
    emissive(b, () => {
      b.setColor(lit ? I.window : sc(I.window, 0.4));
      for (let s = 0.8; s < hw - 1; s += 1.9) box3(b, x + s, 1.4, z + hd + 0.01, 0.9, 0.6, 0.04);
      b.setColor(sc(I.window, 0.55));
      for (let s = 1.2; s < hw - 1; s += 2.6) box3(b, x + s, 1.4, z - 0.05, 0.8, 0.5, 0.04);
    });
  }
}

function polBuilding(ctx, w) {
  const { b, theme, kit, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  if (w.messhut) {
    // The mess: the biggest hut, a chimney with a warm glow, a vestibule on the camera side and a sign.
    hut(ctx, w, { col: I.ochre, dark: I.ochreD });
    emissive(b, () => { b.setColor(I.window); for (let s = 0.8; s < bw - 1; s += 1.9) box3(b, x + s, 1.4, z - 0.05, 0.9, 0.6, 0.04); });
    b.setColor(I.steel);
    b.prismY(h - 0.3, h + 1.6, x + bw - 1.4, z + 1.2, 0.28, 0.24, 6);
    b.setColor(I.ochreD);
    box3(b, x + 1, 0.45, z - 1.1, 1.8, 2.2, 1.1);
    snowCap(b, I, x + 0.9, 2.65, z - 1.2, 2, 1.3);
    b.setColor(I.red);
    box3(b, x + bw / 2 - 1.5, h - 0.9, z - 0.06, 3, 0.45, 0.04);
    glow.halo(x + bw - 1.4, z + 1.2, 1.2, [0.08, 0.04, 0.01]);
    return;
  }
  if (w.dogshed) {
    // The dog shed: timber, low, a row of kennel hatches along the front.
    b.setColor(I.timber);
    box3(b, x, 0, z, bw, h - 0.6, bd);
    b.setColor(sc(I.timber, 0.75));
    for (let s = 0.6; s < bw - 0.5; s += 1.5) box3(b, x + s, 0, z + bd - 0.02, 0.8, 0.8, 0.06);
    b.setColor(I.steelD);
    b.loft([[[x - 0.3, h - 0.6, z - 0.3], [x - 0.3, h + 0.6, z + bd / 2], [x - 0.3, h - 0.6, z + bd + 0.3]], [[x + bw + 0.3, h - 0.6, z - 0.3], [x + bw + 0.3, h + 0.6, z + bd / 2], [x + bw + 0.3, h - 0.6, z + bd + 0.3]]]);
    b.setColor(I.snowL);
    b.loft([[[x - 0.25, h + 0.62, z + bd / 2 - 1.2], [x - 0.25, h + 0.68, z + bd / 2], [x - 0.25, h + 0.62, z + bd / 2 + 1.2]], [[x + bw + 0.25, h + 0.62, z + bd / 2 - 1.2], [x + bw + 0.25, h + 0.68, z + bd / 2], [x + bw + 0.25, h + 0.62, z + bd / 2 + 1.2]]]);
    return;
  }
  if (w.labhut) {
    // The lab: a long white module with a teal stripe, instrument masts on the roof, screens glowing inside.
    hut(ctx, w, { col: I.white, dark: I.panelD, lit: true });
    b.setColor(I.iceD);
    box3(b, x - 0.04, 1.0, z - 0.04, bw + 0.08, 0.22, bd + 0.08);
    b.setColor(I.steelD);
    for (const s of [1.5, bw - 2]) { b.prismY(h, h + 2.6, x + s, z + bd / 2, 0.06, 0.04, 5); box3(b, x + s - 0.4, h + 2.2, z + bd / 2 - 0.04, 0.8, 0.06, 0.08); }
    b.prismY(h, h + 0.9, x + bw / 2, z + bd / 2, 0.35, 0.35, 8);
    emissive(b, () => { b.setColor(I.screen); box3(b, x + 2, 1.5, z + bd + 0.02, 0.6, 0.35, 0.03); box3(b, x + bw - 3, 1.5, z + bd + 0.02, 0.6, 0.35, 0.03); });
    return;
  }
  if (w.boiler) {
    // The boiler house: steel, two stacks, a riveted firebox door glowing orange (the switch is drawn by zm-power.js).
    b.setColor(I.panel);
    box3(b, x, 0, z, bw, h - 0.4, bd);
    b.setColor(I.panelD);
    for (let s = 0; s < bw; s += 1.3) box3(b, x + s, 0, z + bd - 0.02, 0.12, h - 0.4, 0.06);
    b.setColor(I.steelD);
    box3(b, x - 0.1, h - 0.4, z - 0.1, bw + 0.2, 0.2, bd + 0.2);
    snowCap(b, I, x - 0.1, h - 0.2, z - 0.1, bw + 0.2, bd + 0.2);
    b.setColor(I.black);
    for (const s of [1.6, 3.4]) b.prismY(h - 0.4, h + 4.5, x + s, z + 1.6, 0.42, 0.36, 8);
    b.setColor(I.red);
    for (const s of [1.6, 3.4]) b.prismY(h + 3.6, h + 4.0, x + s, z + 1.6, 0.44, 0.44, 8);
    emissive(b, () => { b.setColor([1, 0.5, 0.15]); box3(b, x + bw / 2 - 0.7, 0.4, z + bd + 0.02, 1.4, 1.0, 0.04); });
    glow.streak(x + bw / 2, z + bd + 0.2, 1.8, 2.2, [0.2, 0.08, 0.01], 0.1);
    return;
  }
  if (w.hangar) {
    // The hangar: a big arched steel shed, the doors half open on a dark plane nose, its yellow tail fin over the roof.
    const r = h - 1.2;
    b.setColor(I.steel);
    box3(b, x, 0, z, bw, 1.2, bd);
    const N = 7, arc = [];
    for (let i = 0; i <= N; i++) { const a = Math.PI * i / N; arc.push([x + bw / 2 - Math.cos(a) * bw / 2, 1.2 + Math.sin(a) * r]); }
    b.loft([arc.map(([ax, ay]) => [ax, ay, z]), arc.map(([ax, ay]) => [ax, ay, z + bd])]);
    b.setColor(I.snowL);
    b.loft([arc.slice(2, 6).map(([ax, ay]) => [ax, ay + 0.06, z + 0.1]), arc.slice(2, 6).map(([ax, ay]) => [ax, ay + 0.06, z + bd - 0.1])]);
    b.setColor(I.black);
    box3(b, x + 2.5, 0, z - 0.04, bw - 5, 3.2, 0.06);
    b.setColor(I.steelL);
    box3(b, x + 0.8, 0, z - 0.1, 2, 3.6, 0.12); box3(b, x + bw - 2.8, 0, z - 0.1, 2, 3.6, 0.12);
    b.setColor(I.hazardY);
    b.prismZ(z - 0.4, z + 0.2, x + bw / 2, 1.2, 0.7, 0.7, 6);
    b.setColor(I.hazardY);
    box3(b, x + bw / 2 - 0.12, h - 0.2, z + bd - 2.6, 0.24, 1.6, 2.2);
    emissive(b, () => { b.setColor(I.sodium); box3(b, x + bw / 2 - 1, 3.4, z - 0.12, 2, 0.15, 0.06); });
    return;
  }
  if (w.dish) {
    // The dish: a concrete plinth, a yoke, a big bowl tilted at the sky, a feed horn.
    const cx = x + bw / 2, cz = z + bd / 2;
    b.setColor(I.concrete);
    box3(b, x, 0, z, bw, h - 0.8, bd);
    b.setColor(I.steelD);
    box3(b, cx - 0.3, h - 0.8, cz - 0.3, 0.6, 1.4, 0.6);
    b.setColor(I.white);
    b.prismY(h + 0.4, h + 2.2, cx, cz + 0.4, 0.5, 2.6, 10);
    b.setColor(I.steel);
    b.prismY(h + 2.2, h + 3.6, cx, cz + 0.4, 0.06, 0.04, 4);
    snowCap(b, I, x, h - 0.8, z, bw, bd);
    return;
  }
  kit.building(b, w, ctx.rnd, ctx.lamps);
}

// The panel walls between the areas: grey sandwich panels between steel posts, a cornice, snow banked at the foot.
function polWall(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: ww, d: wd, h } = w;
  const long = ww >= wd, L = long ? ww : wd;
  b.setColor(w.run ? I.timber : I.panel);
  box3(b, x, 0, z, ww, h - 0.15, wd);
  b.setColor(I.steelD);
  box3(b, x - 0.05, h - 0.15, z - 0.05, ww + 0.1, 0.18, wd + 0.1);
  for (let s = 0; s <= L - 0.25; s += 3) {
    const t = Math.min(s, L - 0.25);
    if (long) box3(b, x + t, 0, z - 0.06, 0.25, h + 0.05, wd + 0.12); else box3(b, x - 0.06, 0, z + t, ww + 0.12, h + 0.05, 0.25);
  }
  b.setColor(I.snowL);
  for (let s = 0.2; s < L - 0.4; s += 1.6 + rnd() * 0.8) {
    const len = 1.2 + rnd() * 1.2, hh = 0.3 + rnd() * 0.35;
    if (long) box3(b, x + s, 0, z - 0.25, Math.min(len, L - s), hh, wd + 0.5);
    else box3(b, x - 0.25, 0, z + s, ww + 0.5, hh, Math.min(len, L - s));
  }
  snowCap(b, I, x - 0.05, h + 0.03, z - 0.05, ww + 0.1, wd + 0.1);
}

function polBarrier(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  if (w.drift) {
    // A snowdrift: soft stepped mounds.
    b.setColor(I.snowL);
    b.prismY(0, h * 0.6, x + bw / 2, z + bd / 2, bw * 0.55, bw * 0.42, 7);
    b.setColor(I.snow);
    b.prismY(h * 0.6, h, x + bw / 2, z + bd / 2, bw * 0.42, bw * 0.18, 7);
    return;
  }
  ctx.kit.barrier(b, w);
}

function polCrate(ctx, w) {
  const { b, theme, kit, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  if (w.drums) {
    // Fuel drums, red and black, snow on the lids.
    for (const [ox, oz, col] of [[0.4, 0.4, I.red], [cw - 0.4, 0.4, I.black], [0.4, cd - 0.4, I.black], [cw - 0.4, cd - 0.4, I.red]]) {
      b.setColor(col);
      b.prismY(0, h - 0.1, x + ox, z + oz, 0.36, 0.36, 8);
      b.setColor(I.snowL);
      b.prismY(h - 0.1, h, x + ox, z + oz, 0.34, 0.3, 8);
    }
    return;
  }
  if (w.sled) {
    b.setColor(I.timber);
    box3(b, x, 0.25, z, cw, 0.1, cd);
    b.setColor(I.steelD);
    box3(b, x - 0.2, 0, z + 0.05, cw + 0.3, 0.08, 0.08); box3(b, x - 0.2, 0, z + cd - 0.13, cw + 0.3, 0.08, 0.08);
    b.setColor(I.red);
    box3(b, x + 0.2, 0.35, z + 0.15, cw - 0.4, 0.45, cd - 0.3);
    return;
  }
  if (w.lab || w.instrument) {
    // Instrument cases: steel boxes with a lit dial.
    b.setColor(w.lab ? I.white : I.steel);
    box3(b, x, 0, z, cw, h, cd);
    b.setColor(I.steelD);
    box3(b, x - 0.03, h - 0.12, z - 0.03, cw + 0.06, 0.12, cd + 0.06);
    snowCap(b, I, x, h, z, cw, cd);
    emissive(b, () => { b.setColor(I.screen); box3(b, x + cw * 0.3, h * 0.55, z + cd + 0.01, cw * 0.4, 0.2, 0.03); });
    return;
  }
  if (w.bunker) {
    b.setColor(I.steelD);
    box3(b, x, 0, z, cw, h, cd);
    b.setColor(I.black);
    b.prismY(h, h + 0.3, x + cw / 2, z + cd / 2, Math.min(cw, cd) * 0.45, 0.2, 7);
    return;
  }
  kit.crate(b, w, rnd);
  snowCap(b, I, x, h, z, cw, cd);
}

function polContainer(ctx, w) {
  const { b, theme, kit } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  if (w.snowcat) {
    // A snowcat: two black tracks, a red cab forward with lit windows, a load bed behind.
    b.setColor(I.black);
    box3(b, x, 0, z, cw, 0.8, 0.6); box3(b, x, 0, z + cd - 0.6, cw, 0.8, 0.6);
    b.setColor(I.red);
    box3(b, x + 0.1, 0.8, z + 0.3, cw * 0.42, h - 0.9, cd - 0.6);
    b.setColor(I.redD);
    box3(b, x + cw * 0.42, 0.8, z + 0.3, cw * 0.56, 0.7, cd - 0.6);
    snowCap(b, I, x + 0.1, h - 0.1, z + 0.3, cw * 0.42, cd - 0.6);
    emissive(b, () => { b.setColor(I.window); box3(b, x + 0.3, 1.6, z + cd - 0.31, cw * 0.3, 0.5, 0.03); b.setColor(I.sodium); box3(b, x - 0.02, 1.0, z + 0.5, 0.04, 0.25, 0.4); box3(b, x - 0.02, 1.0, z + cd - 0.9, 0.04, 0.25, 0.4); });
    return;
  }
  if (w.tank || w.fueltank) {
    // A tank: a steel cylinder on a cradle (upright for the boiler's header tank, lying for the fuel tank).
    if (w.tank) {
      b.setColor(I.steel);
      b.prismY(0, h, x + cw / 2, z + cd / 2, cw / 2, cw / 2, 10);
      b.setColor(I.snowL);
      b.prismY(h, h + 0.2, x + cw / 2, z + cd / 2, cw / 2, cw * 0.3, 10);
      b.setColor(I.hazardY);
      b.prismY(h * 0.55, h * 0.62, x + cw / 2, z + cd / 2, cw / 2 + 0.02, cw / 2 + 0.02, 10);
      return;
    }
    b.setColor(I.steelD);
    for (const s of [0.6, cw - 1]) box3(b, x + s, 0, z, 0.4, 0.8, cd);
    b.setColor(I.white);
    b.prismX(x, x + cw, 1.4, z + cd / 2, cd / 2, cd / 2, 10);
    b.setColor(I.red);
    b.prismX(x + cw / 2 - 0.6, x + cw / 2 + 0.6, 1.4, z + cd / 2, cd / 2 + 0.02, cd / 2 + 0.02, 10);
    return;
  }
  kit.container(b, w, ctx.rnd);
}

// The relay mast: a steel lattice tower (three legs, cross bracing) with dishes; the guyed aerial above is decor.
function polCrane(ctx, w) {
  const { b, theme, kit } = ctx;
  const I = theme.ink;
  const { x, z, w: mw, d: md, h } = w;
  if (!w.mast) { b.setColor(I.steelD); kit.box3?.(b, x, 0, z, mw, h, md); return; }
  const cx = x + mw / 2, cz = z + md / 2;
  b.setColor(I.concrete);
  box3(b, x - 0.2, 0, z - 0.2, mw + 0.4, 0.5, md + 0.4);
  b.setColor(I.red);
  for (const [lx, lz] of [[x + 0.15, z + 0.15], [x + mw - 0.3, z + 0.15], [x + 0.15, z + md - 0.3], [x + mw - 0.3, z + md - 0.3]]) box3(b, lx, 0.5, lz, 0.15, h - 0.5, 0.15);
  b.setColor(I.white);
  for (let y = 1.5; y < h; y += 1.8) {
    box3(b, x + 0.15, y, z + 0.15, mw - 0.3, 0.07, 0.07); box3(b, x + 0.15, y, z + md - 0.22, mw - 0.3, 0.07, 0.07);
    box3(b, x + 0.15, y, z + 0.15, 0.07, 0.07, md - 0.3); box3(b, x + mw - 0.22, y, z + 0.15, 0.07, 0.07, md - 0.3);
  }
  // Cross bracing on the camera face, and a hut for the transmitter at the foot.
  for (let y = 1.5; y < h - 1.8; y += 1.8) b.loft([[[x + 0.2, y, z + md - 0.1], [x + 0.28, y, z + md - 0.1], [x + 0.24, y, z + md - 0.02]], [[x + mw - 0.28, y + 1.8, z + md - 0.1], [x + mw - 0.2, y + 1.8, z + md - 0.1], [x + mw - 0.24, y + 1.8, z + md - 0.02]]]);
  b.setColor(I.white);
  b.prismZ(z - 0.4, z - 0.1, cx, h - 1.5, 0.6, 0.6, 8);
}

// The perimeter: a snow berm with a wind fence, the ice sheet beyond.
function polBorder(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  b.setColor(I.snow);
  box3(b, w.x, 0, w.z, w.w, 0.9, w.d);
  const long = w.w > w.d, L = long ? w.w : w.d;
  b.setColor(I.steelD);
  for (let s = 0; s < L; s += 2.5) {
    if (long) box3(b, w.x + s, 0.8, w.z + w.d / 2 - 0.05, 0.1, 1.8, 0.1); else box3(b, w.x + w.w / 2 - 0.05, 0.8, w.z + s, 0.1, 1.8, 0.1);
  }
  b.setColor(I.red);
  if (long) { box3(b, w.x, 1.9, w.z + w.d / 2 - 0.03, w.w, 0.4, 0.06); box3(b, w.x, 1.2, w.z + w.d / 2 - 0.03, w.w, 0.25, 0.06); }
  else { box3(b, w.x + w.w / 2 - 0.03, 1.9, w.z, 0.06, 0.4, w.d); box3(b, w.x + w.w / 2 - 0.03, 1.2, w.z, 0.06, 0.25, w.d); }
  b.setColor(I.snowL);
  for (let s = 0; s < L; s += 3 + rnd() * 3) {
    if (long) box3(b, w.x + s, 0.85, w.z - 0.3, 1.5, 0.3, w.d + 0.6); else box3(b, w.x - 0.3, 0.85, w.z + s, w.w + 0.6, 0.3, 1.5);
  }
}

// Aurora: three curtains of green and teal over the whole sky, the brightest straight overhead to the north.
function aurora(ctx) {
  const { glow, W } = ctx;
  for (let k = 0; k < 3; k++) {
    const z0 = -22 - k * 10, y0 = 18 + k * 4, y1 = y0 + 18 + k * 4, N = 24;
    for (let i = 0; i < N; i++) {
      const x0 = -40 + (i / N) * (W + 80), x1 = -40 + ((i + 1) / N) * (W + 80);
      const w0 = Math.sin(i * 0.5 + k * 1.7) * 7, w1 = Math.sin((i + 1) * 0.5 + k * 1.7) * 7;
      const f0 = 0.55 + 0.45 * Math.sin(i * 0.7 + k * 2), f1 = 0.55 + 0.45 * Math.sin((i + 1) * 0.7 + k * 2);
      const g = [0.06, 0.3, 0.18], t = [0.02, 0.14, 0.18], z = [0, 0, 0];
      glow.quad([x0, y0, z0 + w0], [x0, y1, z0 + w0 - 8], [x1, y1, z0 + w1 - 8], [x1, y0, z0 + w1], scale(g, f0), scale(t, f0 * 0.5), scale(t, f1 * 0.5), scale(g, f1));
      glow.quad([x0, y0 - 4, z0 + w0 + 3], [x0, y0, z0 + w0], [x1, y0, z0 + w1], [x1, y0 - 4, z0 + w1 + 3], z, scale(g, f0 * 0.7), scale(g, f1 * 0.7), z);
    }
  }
}

function polDecor(ctx) {
  const { b, map, W, H, theme, glow, rnd } = ctx;
  const I = theme.ink;
  // Sodium flood poles: a lattice pole and a lamp head leaning toward the yard.
  for (const [x, z] of FLOODS) {
    b.setColor(I.steelD);
    b.prismY(0, 4.2, x, z, 0.1, 0.07, 5);
    box3(b, x - 0.3, 4.2, z - 0.2, 0.6, 0.18, 0.4);
    emissive(b, () => { b.setColor(I.sodium); box3(b, x - 0.25, 4.12, z - 0.15, 0.5, 0.06, 0.3); });
  }
  for (const d of map.decor || []) {
    if (d.type === 'aerial') {
      // The relay aerial above the mast, its guy wires to the snow, a red beacon at the top.
      b.setColor(I.white);
      b.prismY(9, d.h, d.x, d.z, 0.12, 0.05, 4);
      b.setColor(I.steelD);
      for (const [gx, gz] of [[d.x - 9, d.z - 7], [d.x + 9, d.z - 7], [d.x, d.z + 11]]) {
        b.loft([[[d.x - 0.02, d.h - 4, d.z], [d.x + 0.02, d.h - 4, d.z], [d.x, d.h - 4, d.z + 0.03]], [[gx - 0.02, 0, gz], [gx + 0.02, 0, gz], [gx, 0, gz + 0.03]]]);
      }
      emissive(b, () => { b.setColor(I.beacon); b.prismY(d.h, d.h + 0.4, d.x, d.z, 0.2, 0.2, 6); b.prismY(d.h - 6, d.h - 5.7, d.x, d.z, 0.16, 0.16, 6); });
      glow.halo(d.x, d.z, 3, [0.18, 0.02, 0.01], d.h, 3);
    }
  }
  // The ice sheet beyond the berm: low pressure ridges and a few lonely huts far out.
  for (let i = 0; i < 28; i++) {
    const side = i % 4, t = rnd();
    let x, z;
    if (side < 2) { x = -12 + t * (W + 24); z = -4 - rnd() * 12; }
    else if (side === 2) { x = -4 - rnd() * 10; z = t * H; }
    else { x = W + 4 + rnd() * 10; z = t * H; }
    b.setColor(rnd() < 0.5 ? sc(I.snow, 0.8) : sc(I.iceD, 0.8));
    b.prismY(0, 0.4 + rnd() * 1.0, x, z, 1.6 + rnd() * 1.6, 0.3, 5, rnd());
  }
  aurora(ctx);
  glow.halo(W * 0.5, -20, 12, [0.02, 0.08, 0.05], 18, 18);
  skyRing(ctx, { low: [0.01, 0.03, 0.04], mid: [0.03, 0.09, 0.1], warm: [0.06, 0.2, 0.16], high: [0.01, 0.02, 0.05], warmDir: [0, -1], y0: -4, y1: 10, y2: 60 });
}

export const polestar = {
  dress: { building: polBuilding, wall: polWall, barrier: polBarrier, crate: polCrate, container: polContainer, crane: polCrane, border: polBorder },
  stage: { lights: polLights, ground: polGround, paint: polPaint, decor: polDecor },
  thumb: { ground: '#8ea4b4', solid: '#5e6874', low: '#b6c8d8', edge: '#0a1218' },
};
