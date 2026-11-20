// Wrenfield Fair's theme (farmland, Graveyard Shift only; js/shared/maps/wrenfield.js, docs/ZOMBIES.md): a travelling
// fair left standing in a field the night it never packed up. A violet night with a low moon in the south-east, and
// the fair's own light: strings of coloured bulbs between the poles, the carousel's crown of bulbs, the big wheel's
// rim lit at the top of the map, painted hoardings in candy stripes, sawdust underfoot, the Big Top's canvas burned to
// rags on its poles. Clearly not Ashgrove's foggy churchyard (amber oil lamps, grass, flint) nor Polestar's polar
// station (blue snow, aurora, sodium floods): warm sawdust, red and cream stripes, many small colours. world.js reads
// `wrenfield` ({ dress, stage, thumb }) into its tables.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, skyRing } from './kit.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));
const sc = scale;

THEMES.wrenfield = {
  id: 'wrenfield',
  // A low violet moon from the south-east; the fair's bulbs do the rest.
  light: { dir: norm([0.45, 0.62, 0.55]), sun: [0.3, 0.26, 0.42], sky: [0.24, 0.2, 0.36], amb: [0.24, 0.2, 0.3] },
  clear: 0x0c0814,
  fog: [0.2, 0.15, 0.28], fogSeam: [0.12, 0.06, 0.1], desatTint: [0.86, 0.8, 0.9],
  shadow: { col: [0.3, 0.24, 0.42], strength: 0.5, len: 0.7 },
  lamp: [0.62, 0.42, 0.28],
  groundAmp: 0.18,
  ink: ink({
    ground: 0x4c5a3e, asphalt: 0x3a3a40, dirt: 0x6a5238, gravel: 0x55524e,
    roof: 0x8a3a3a, wall: 0xcfc2a4, wallB: 0x6e5a4a, trim: 0x2a2026,
    concrete: 0x6e6a66, crate: 0x8a6a42, crateD: 0x55402a,
    rail: 0x9a9aa2, tie: 0x3e3028, hazardY: 0xd8a830, hazardK: 0x1e1a1e,
    paint: 0xe0d6c0, glow: 0xffc070, glowCool: 0xd0b0ff,
    grass: 0x3e4c36, grassD: 0x323e2e, sawdust: 0xa07a4a, sawdustD: 0x7e5e38, mud: 0x4e3e30,
    red: 0xb0302e, redD: 0x74201e, cream: 0xe6d8b8, creamD: 0xb8aa8e, teal: 0x2e8a86, tealD: 0x1e5e5c,
    purple: 0x5a3a7a, purpleD: 0x3a2650, gold: 0xd8a83a, goldD: 0x9a7424, navy: 0x262c4a,
    timber: 0x6a4c32, timberD: 0x46321f, iron: 0x2e2c32, ironL: 0x5c5a62, canvas: 0x7a6a58, char: 0x241c1a,
    bulbA: 0xffd27a, bulbB: 0xff6ab0, bulbC: 0x7af0e0, bulbD: 0xfff4d8, bulbE: 0xffa040, sign: 0xffe0a0, window: 0xffc88a,
    hay: 0xb8964a, hayD: 0x8a6e34, ghost: 0x9affb0,
  }),
  containers: [0x8a3a3a, 0x2e5a5a, 0x5a3a6a],
  weather: { fields: [
    // Moths and midges round the bulbs, a little haze in the lights, and paper ticket stubs on the wind.
    { kind: 'mote', count: 60, box: [40, 5, 30], vel: [0.1, 0.22, 0.05], size: 0.07, col: [1, 0.86, 0.6], alpha: 0.5 },
    { kind: 'mote', count: 14, box: [44, 2.2, 34], vel: [0.3, 0.02, 0.1], size: 4.4, col: [0.5, 0.36, 0.6], alpha: 0.05 },
    { kind: 'leaf', count: 22, box: [42, 6, 32], vel: [0.5, -0.3, 0.2], size: 0.18, col: [0.86, 0.78, 0.62], alpha: 0.8 },
  ] },
};

// ---- Where things are (render only) --------------------------------------------------------------------------------

// Light poles (each against a fence or in a corner), and the strings of bulbs slung between them (or from a roof or the
// king pole: [x, z, height]). A string's bulbs cycle the fair's colours.
const POLES = [
  [26.8, 38.6], [53.2, 38.6], [26.8, 51.2], [53.2, 51.2],                    // Ticket Gate.
  [1.2, 26.2], [23.8, 26.2], [23.8, 41.2], [1.2, 36.2], [11.2, 43.2],        // The Midway.
  [12, 1.2], [23.8, 1.2], [1.2, 23.8], [23.8, 23.8],                         // Carousel Green.
  [26.8, 15.2], [53.2, 15.2],                                                // Wheel Yard.
  [55.8, 1.2], [78.8, 1.2], [78.8, 29.2], [55.8, 29.2],                      // The Big Top.
  [55.8, 31.8], [78.8, 31.8], [71.6, 40.4], [55.8, 41.6],                    // Ghost Train.
];
const POLE_H = 5.4;
const top = ([x, z]) => [x, POLE_H, z];
const STRINGS = [
  [top(POLES[0]), top(POLES[3])], [top(POLES[1]), top(POLES[2])],
  [top(POLES[4]), top(POLES[6])], [top(POLES[5]), top(POLES[7])], [top(POLES[7]), top(POLES[6])],
  ...[9, 10, 11, 12].map(i => [[15, 6.6, 16], top(POLES[i])]),               // The carousel's crown to the corners.
  [top(POLES[13]), top(POLES[14])],
  ...[15, 16, 17, 18].map(i => [[67.5, 7.4, 14], top(POLES[i])]),            // The king pole to the Big Top's corners.
  [top(POLES[19]), top(POLES[20])], [top(POLES[20]), top(POLES[21])], [top(POLES[19]), top(POLES[22])],
];
// Work lights in the Generator Yard: no bulbs there, hard white floods on stands.
const WORK = [[26.8, 17.8], [53.2, 17.8], [26.8, 36.2], [53.2, 36.2]];
const BULBS = ['bulbA', 'bulbB', 'bulbC', 'bulbD', 'bulbE'];
// Sawdust lanes between the gates: [x0, z0, x1, z1, half width].
const LANES = [
  [24, 44, 40, 44, 1.4], [40, 44, 56, 45, 1.4], [12, 26, 12, 46, 1.6], [12, 36, 24, 31, 1.2], [12, 24, 12, 8, 1.2], [12, 8, 26, 8, 1.2],
  [26, 8, 56, 8, 1.3], [68, 30, 68, 38, 1.3], [56, 23, 40, 32, 1.1],
];

function onLane(x, z) {
  return LANES.some(([x0, z0, x1, z1, r]) => {
    const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2));
    return Math.hypot(x - x0 - dx * t, z - z0 - dz * t) < r;
  });
}

function wrenGround(ctx) {
  const { noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  return p => {
    const [x, , z] = p;
    const k = 0.86 + noise(x * 0.6, z * 0.6) * 0.2 + (rnd() - 0.5) * 0.05;
    if (x < 0 || z < 0 || x > W || z > H) return sc(noise(x * 0.09, z * 0.09) > 0.55 ? I.grassD : I.grass, k * 0.72);
    // The ring: a sawdust circle with a darker edge; the car park's tarmac; the Generator Yard's churned mud.
    const rd = Math.hypot(x - 67.5, z - 14);
    if (rd < 7.4) return sc(rd > 6.6 ? I.sawdustD : I.sawdust, k * 1.02);
    if (x > 55 && z > 31 && z < 45) return sc(noise(x * 0.4, z * 0.4) > 0.6 ? I.gravel : I.asphalt, k);
    if (x > 26 && x < 54 && z > 17 && z < 37) return sc(noise(x * 0.25, z * 0.25) > 0.5 ? I.mud : I.dirt, k * 0.92);
    if (onLane(x, z)) return sc(noise(x * 0.8, z * 0.8) > 0.55 ? I.sawdustD : I.sawdust, k * 0.95);
    // Trampled grass everywhere else, worn to earth here and there.
    return sc(noise(x * 0.18 + 4, z * 0.18) > 0.62 ? I.dirt : noise(x * 0.5, z * 0.5) > 0.5 ? I.grass : I.grassD, k);
  };
}

function wrenPaint(ctx) {
  const { b, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  // Ticket stubs, popcorn boxes and straw.
  for (let i = 0; i < 46; i++) {
    const x = 1 + rnd() * (W - 2), z = 1 + rnd() * (H - 2);
    b.setColor(i % 3 === 0 ? sc(I.cream, 0.8) : i % 3 === 1 ? sc(I.red, 0.8) : sc(I.hay, 0.8));
    b.groundRect(x, z, 0.14 + rnd() * 0.2, 0.1 + rnd() * 0.16, 0.03);
  }
  for (const d of ctx.map.decor || []) {
    if (d.type === 'ring') {
      // The ring's curb: red and cream boards round the sawdust.
      for (let i = 0; i < 28; i++) {
        const a = i / 28 * Math.PI * 2, x = d.x + Math.cos(a) * d.r, z = d.z + Math.sin(a) * d.r;
        b.setColor(i % 2 ? I.red : I.cream);
        b.groundRect(x - 0.4, z - 0.4, 0.8, 0.8, 0.05);
      }
    }
    if (d.type === 'pad') {
      // The car park's landing mark: a painted ring and a cross.
      b.setColor(I.hazardY);
      for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; b.groundRect(d.x + Math.cos(a) * 2.8 - 0.22, d.z + Math.sin(a) * 2.8 - 0.22, 0.44, 0.44, 0.04); }
      b.setColor(I.paint);
      b.groundRect(d.x - 1.2, d.z - 0.18, 2.4, 0.36, 0.05); b.groundRect(d.x - 0.18, d.z - 1.2, 0.36, 2.4, 0.05);
    }
  }
  // Parking bays in the car park.
  b.setColor(sc(I.paint, 0.6));
  for (let x = 57; x < 80; x += 2.8) b.groundRect(x, 42.6, 0.12, 2, 0.03);
}

function wrenLights(ctx) {
  const { map, lamps, glow } = ctx;
  const warm = [1, 0.72, 0.5];
  POLES.forEach(([x, z], i) => { lamps.push({ x, z, r: 7, col: i % 3 === 0 ? [0.5, 0.34, 0.22] : i % 3 === 1 ? [0.5, 0.26, 0.36] : [0.3, 0.42, 0.4] }); glow.halo(x, z, 3.6, sc(warm, 0.08)); });
  // Each of the quest's lanterns has a little pool of its own colour on the ground, so a dead end reads as somewhere.
  (map.zm?.quest?.lanterns ?? []).forEach(({ x, z }, i) => { const c = [[0.5, 0.16, 0.12], [0.16, 0.42, 0.18], [0.14, 0.3, 0.5], [0.5, 0.38, 0.1]][i % 4]; lamps.push({ x, z, r: 4.5, col: c }); glow.halo(x, z, 2.2, sc(c, 0.25)); });
  for (const [x, z] of WORK) { lamps.push({ x, z, r: 8, col: [0.42, 0.44, 0.46] }); glow.halo(x, z, 4, [0.06, 0.06, 0.07]); }
  for (const w of map.walls) {
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
    if (w.carousel) { lamps.push({ x: cx, z: cz, r: 10, col: [0.6, 0.42, 0.26] }); glow.halo(cx, cz, 7, [0.14, 0.09, 0.05]); }
    if (w.booth) lamps.push({ x: cx, z: w.z - 1.6, r: 6, col: [0.5, 0.36, 0.2] });
    if (w.stall) lamps.push({ x: cx, z: w.z + w.d + 1.6, r: 6, col: w.stall === 'gallery' ? [0.5, 0.28, 0.3] : [0.46, 0.36, 0.2] });
    if (w.wheelbase) { lamps.push({ x: cx, z: w.z + w.d + 2.5, r: 10, col: [0.5, 0.3, 0.42] }); glow.halo(cx, w.z + w.d + 1.5, 6, [0.1, 0.05, 0.08]); }
    if (w.powerhouse) lamps.push({ x: w.x - 1.4, z: cz, r: 6, col: [0.44, 0.4, 0.3] });
    if (w.ghosttrain) { lamps.push({ x: cx, z: w.z - 2, r: 9, col: [0.24, 0.48, 0.3] }); glow.halo(cx, w.z - 1, 5, [0.03, 0.1, 0.05]); }
    if (w.kingpole) lamps.push({ x: cx, z: cz, r: 11, col: [0.42, 0.3, 0.24] });
    if (w.striker) lamps.push({ x: cx, z: w.z + w.d + 1.4, r: 5, col: [0.5, 0.3, 0.2] });
  }
}

// ---- Drawers -------------------------------------------------------------------------------------------------------

// A square beam between two points (four sides, capped).
function beam(b, p0, p1, r) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], l = Math.hypot(dx, dy, dz) || 1;
  // Two directions across the beam.
  let ux = -dz, uy = 0, uz = dx;
  if (Math.hypot(ux, uz) < 1e-4) { ux = 1; uz = 0; }
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = (dy * uz - dz * uy) / l, vy = (dz * ux - dx * uz) / l, vz = (dx * uy - dy * ux) / l;
  const ring = p => [[p[0] + (ux + vx) * r, p[1] + (uy + vy) * r, p[2] + (uz + vz) * r], [p[0] + (ux - vx) * r, p[1] + (uy - vy) * r, p[2] + (uz - vz) * r],
    [p[0] - (ux + vx) * r, p[1] - (uy + vy) * r, p[2] - (uz + vz) * r], [p[0] - (ux - vx) * r, p[1] - (uy - vy) * r, p[2] - (uz - vz) * r]];
  b.loft([ring(p0), ring(p1)]);
}

// A striped awning sloping out from a wall face: alternating red and cream bands.
function awning(b, I, x0, x1, z, y, out, drop = 0.6, a = I.red, c = I.cream) {
  const n = Math.max(2, Math.round((x1 - x0) / 0.9)), s = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    b.setColor(i % 2 ? c : a);
    const xa = x0 + i * s, xb = xa + s;
    b.quad([xa, y, z], [xa, y - drop, z + out], [xb, y - drop, z + out], [xb, y, z], [xa + s / 2, y + 5, z - 5]);
    b.quad([xa, y - drop, z + out], [xa, y - drop - 0.2, z + out], [xb, y - drop - 0.2, z + out], [xb, y - drop, z + out], [xa + s / 2, y - 1, z + out + 5]);
  }
}

// A row of bulbs: each a little four-sided point (four triangles: the fair has hundreds of them), lit.
function bulbs(b, I, pts, size = 0.09, k = 0) {
  emissive(b, () => pts.forEach(([x, y, z], i) => {
    b.setColor(I[BULBS[(i + k) % BULBS.length]]);
    const s = size * 1.3, t = [x, y + size * 1.6, z], c = [[x - s, y - size, z - s], [x + s, y - size, z - s], [x + s, y - size, z + s], [x - s, y - size, z + s]];
    for (let j = 0; j < 4; j++) b.tri(c[j], t, c[(j + 1) % 4], [x, y - 5, z]);
  }));
}

// A painted board hoarding face: panels in turn, a cap rail.
function stripes(b, I, w, cols, step = 1.4) {
  const { x, z, w: ww, d: wd, h } = w;
  const long = ww >= wd, L = long ? ww : wd;
  for (let s = 0, i = 0; s < L - 0.01; s += step, i++) {
    b.setColor(cols[i % cols.length]);
    const n = Math.min(step, L - s);
    if (long) box3(b, x + s, 0, z, n, h - 0.2, wd); else box3(b, x, 0, z + s, ww, h - 0.2, n);
  }
}

function wrenBuilding(ctx, w) {
  const { b, theme, kit, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  if (w.booth) {
    // A ticket booth: cream boards, a red roof with a gold finial, a lit window and a striped awning on the camera side.
    b.setColor(I.cream);
    box3(b, x, 0, z, bw, h - 0.6, bd);
    b.setColor(I.red);
    b.loft([[[x - 0.3, h - 0.6, z - 0.3], [x + bw / 2, h + 0.7, z + bd / 2], [x + bw + 0.3, h - 0.6, z - 0.3]], [[x - 0.3, h - 0.6, z + bd + 0.3], [x + bw / 2, h + 0.7, z + bd / 2], [x + bw + 0.3, h - 0.6, z + bd + 0.3]]]);
    b.setColor(I.gold);
    b.prismY(h + 0.6, h + 1.2, x + bw / 2, z + bd / 2, 0.14, 0.02, 5);
    emissive(b, () => { b.setColor(I.window); box3(b, x + 1, 1.1, z - 0.04, bw - 2, 0.9, 0.05); b.setColor(I.sign); box3(b, x + 0.6, h - 1.0, z - 0.06, bw - 1.2, 0.32, 0.04); });
    awning(b, I, x + 0.3, x + bw - 0.3, z - 0.02, 2.3, -0.9, 0.35);
    return;
  }
  if (w.stall) {
    // A game stall: a counter, a back wall, a striped canopy and a row of bulbs; the gallery has its ducks, the hoopla
    // its pegs, the shy its coconuts. Open to the south (the camera).
    const back = w.stall === 'gallery' ? I.navy : w.stall === 'hoopla' ? I.teal : I.purple;
    b.setColor(back);
    box3(b, x, 0, z, bw, h - 0.3, 0.4);
    box3(b, x, 0, z, 0.3, h - 0.3, bd); box3(b, x + bw - 0.3, 0, z, 0.3, h - 0.3, bd);
    b.setColor(I.timber);
    box3(b, x + 0.3, 0, z + bd - 0.7, bw - 0.6, 1.0, 0.7);
    b.setColor(I.gold);
    box3(b, x + 0.3, 1.0, z + bd - 0.75, bw - 0.6, 0.06, 0.8);
    b.setColor(sc(back, 0.6));
    box3(b, x + 0.3, 0, z + 0.4, bw - 0.6, 0.6, bd - 1.1);
    const cols = w.stall === 'gallery' ? [I.red, I.cream] : w.stall === 'hoopla' ? [I.teal, I.cream] : [I.purple, I.gold];
    awning(b, I, x - 0.2, x + bw + 0.2, z, h, bd + 0.6, 0.7, cols[0], cols[1]);
    if (w.stall === 'gallery') { b.setColor(I.gold); for (let s = 0.8; s < bw - 0.6; s += 0.8) box3(b, x + s, 1.8, z + 0.45, 0.3, 0.25, 0.12); }
    else if (w.stall === 'hoopla') { b.setColor(I.cream); for (let s = 0.8; s < bw - 0.6; s += 0.9) b.prismY(0.6, 1.0, x + s, z + 1.2, 0.05, 0.05, 4); }
    else { b.setColor(I.timberD); for (let s = 0.8; s < bw - 0.6; s += 1) { b.prismY(0.6, 1.5, x + s, z + 1, 0.04, 0.04, 4); b.prismY(1.5, 1.72, x + s, z + 1, 0.13, 0.1, 5); } }
    const row = []; for (let s = 0.2; s < bw; s += 0.7) row.push([x + s, h - 0.75, z + bd + 0.55]);
    bulbs(b, I, row, 0.08, x | 0);
    return;
  }
  if (w.carousel) {
    // The carousel: an octagonal platform, a drum in the middle, poles round the rim (a few horses still on them), a
    // striped cone roof, a crown of bulbs round its eaves and a flag on top.
    const cx = x + bw / 2, cz = z + bd / 2, R = bw / 2;
    b.setColor(I.goldD);
    b.prismY(0, 0.5, cx, cz, R, R, 8, Math.PI / 8);
    b.setColor(I.cream);
    b.prismY(0.5, h - 0.6, cx, cz, R * 0.32, R * 0.32, 8, Math.PI / 8);
    b.setColor(I.gold);
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; b.prismY(0.5, h - 0.4, cx + Math.cos(a) * R * 0.82, cz + Math.sin(a) * R * 0.82, 0.05, 0.05, 4); }
    b.setColor(I.cream);
    for (let i = 0; i < 8; i += 2) { const a = (i + 0.5) / 8 * Math.PI * 2, hx = cx + Math.cos(a) * R * 0.82, hz = cz + Math.sin(a) * R * 0.82; box3(b, hx - 0.45, 1.2 + (i % 4) * 0.15, hz - 0.14, 0.9, 0.45, 0.28); }
    for (let i = 0; i < 16; i++) {
      // Roof: sixteen striped wedges up to the peak.
      const a0 = i / 16 * Math.PI * 2, a1 = (i + 1) / 16 * Math.PI * 2;
      b.setColor(i % 2 ? I.red : I.cream);
      b.tri([cx + Math.cos(a0) * (R + 0.4), h - 0.4, cz + Math.sin(a0) * (R + 0.4)], [cx, h + 2.2, cz], [cx + Math.cos(a1) * (R + 0.4), h - 0.4, cz + Math.sin(a1) * (R + 0.4)], [cx, h - 10, cz]);
    }
    b.setColor(I.gold);
    b.prismY(h - 0.75, h - 0.4, cx, cz, R + 0.42, R + 0.42, 16);
    b.prismY(h + 2.1, h + 3.0, cx, cz, 0.05, 0.05, 4);
    b.setColor(I.red);
    b.quad([cx, h + 3.0, cz], [cx + 0.8, h + 2.8, cz], [cx + 0.8, h + 2.55, cz], [cx, h + 2.6, cz], [cx, h + 2.8, cz + 3]);
    const ring = []; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; ring.push([cx + Math.cos(a) * (R + 0.45), h - 0.58, cz + Math.sin(a) * (R + 0.45)]); }
    bulbs(b, I, ring, 0.1);
    return;
  }
  if (w.wheelbase) {
    // The big wheel's loading platform: timber deck, steps up from the yard, the operator's lever box (the wheel itself
    // is decor, over it).
    b.setColor(I.timber);
    box3(b, x, 0, z, bw, h - 1.4, bd);
    b.setColor(I.timberD);
    for (let s = 0; s < 3; s++) box3(b, x + bw / 2 - 1.5, 0, z + bd + s * 0.3 - 0.9, 3, (3 - s) * 0.3, 0.3);
    b.setColor(I.red);
    box3(b, x - 0.05, h - 1.4, z - 0.05, bw + 0.1, 0.25, bd + 0.1);
    b.setColor(I.navy);
    box3(b, x + bw - 1.6, h - 1.15, z + bd - 1.4, 1.2, 1.2, 1);
    emissive(b, () => { b.setColor(I.sign); box3(b, x + 0.6, h - 1.35, z + bd + 0.02, bw - 1.2, 0.18, 0.04); });
    return;
  }
  if (w.powerhouse) {
    // The show's main generator in its housing: a dark green box, louvres, an exhaust stack, a hazard-striped skirt and
    // a lit gauge panel (the switch itself is drawn by zm-power.js).
    b.setColor(I.tealD);
    box3(b, x, 0.3, z, bw, h - 0.6, bd);
    b.setColor(I.iron);
    box3(b, x - 0.1, 0, z - 0.1, bw + 0.2, 0.3, bd + 0.2);
    for (let s = 0.6; s < bw - 0.4; s += 0.5) box3(b, x + s, 1.2, z + bd - 0.02, 0.25, 1.4, 0.06);
    b.setColor(I.hazardY);
    for (let s = 0; s < bw; s += 0.8) box3(b, x + s, 0, z + bd + 0.08, 0.4, 0.3, 0.04);
    b.setColor(I.iron);
    b.prismY(h - 0.3, h + 2.2, x + bw - 1.2, z + 1, 0.2, 0.16, 6);
    emissive(b, () => { b.setColor(I.bulbC); box3(b, x + 0.8, 1.6, z + bd + 0.03, 0.8, 0.4, 0.03); });
    return;
  }
  if (w.ghosttrain) {
    // The ghost train: a black shed behind a tall painted false front (a grinning face in green over the tunnel mouth),
    // twin doors either side, a skeleton on the roof and green light.
    b.setColor(I.char);
    box3(b, x, 0, z + 0.6, bw, h - 0.8, bd - 0.6);
    b.setColor(I.purpleD);
    box3(b, x - 0.2, 0, z, bw + 0.4, h + 1.4, 0.6);
    b.setColor(I.purple);
    b.loft([[[x + 1, h + 1.4, z], [x + bw / 2, h + 2.8, z], [x + bw - 1, h + 1.4, z]], [[x + 1, h + 1.4, z + 0.6], [x + bw / 2, h + 2.8, z + 0.6], [x + bw - 1, h + 1.4, z + 0.6]]]);
    b.setColor(I.black ?? I.char);
    for (const ox of [1.2, bw - 3.2]) box3(b, x + ox, 0, z - 0.05, 2, 2.6, 0.06);
    emissive(b, () => {
      b.setColor(I.ghost);
      const fx = x + bw / 2;
      box3(b, fx - 1.3, h - 0.6, z - 0.06, 0.7, 0.5, 0.05); box3(b, fx + 0.6, h - 0.6, z - 0.06, 0.7, 0.5, 0.05);       // Eyes.
      for (let s = -1.5; s < 1.5; s += 0.5) box3(b, fx + s, h - 1.7 + Math.abs(s) * 0.25, z - 0.06, 0.32, 0.22, 0.05);  // Grin.
      b.setColor(I.bulbB);
      box3(b, x + 0.2, h + 0.9, z - 0.06, bw - 0.4, 0.12, 0.04);
    });
    b.setColor(I.cream);
    box3(b, x + bw - 3, h - 0.8, z + 2, 0.5, 1.2, 0.3); b.prismY(h + 0.4, h + 0.75, x + bw - 2.75, z + 2.15, 0.22, 0.2, 5);
    glow.streak(x + bw / 2, z - 0.2, 4, 3, [0.02, 0.12, 0.05], 0.12);
    return;
  }
  kit.building(b, w, ctx.rnd, ctx.lamps);
}

// The hoardings: painted boards in the fair's colours, a gold cap rail, bulbs along the top every few metres.
function wrenWall(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: ww, d: wd, h } = w;
  const long = ww >= wd, L = long ? ww : wd;
  const cols = w.tent ? [I.red, I.cream] : w.organ ? [I.purple, I.purpleD] : w.tunnel ? [I.char, I.purpleD] : [I.red, I.cream, I.teal, I.cream];
  stripes(b, I, w, cols, w.tent ? 1.1 : 2);
  b.setColor(I.timberD);
  for (let s = 0; s <= L - 0.2; s += 6) { const t = Math.min(s, L - 0.2); if (long) box3(b, x + t, 0, z - 0.06, 0.2, h + 0.05, wd + 0.12); else box3(b, x - 0.06, 0, z + t, ww + 0.12, h + 0.05, 0.2); }
  if (!w.hoard || w.tent || w.organ || w.tunnel) return;
  const pts = [];
  for (let s = 2; s < L - 0.5; s += 4) pts.push(long ? [x + s, h + 0.12, z + wd / 2] : [x + ww / 2, h + 0.12, z + s]);
  bulbs(b, I, pts, 0.1, Math.round(x + z));
}

function wrenBarrier(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  if (w.bleacher) {
    // Bleachers: three timber steps rising to the back (north), the benches painted.
    for (let s = 0; s < 3; s++) {
      b.setColor(s % 2 ? I.timber : I.timberD);
      box3(b, x, 0, z + s * bd / 3, bw, h * (1 - s / 3), bd / 3);
      b.setColor(s === 1 ? I.teal : I.red);
      box3(b, x, h * (1 - s / 3), z + s * bd / 3, bw, 0.06, 0.35);
    }
    return;
  }
  ctx.kit.barrier(b, w);
}

function wrenCrate(ctx, w) {
  const { b, theme, kit, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  if (w.hay) {
    // Hay bales, strung.
    b.setColor(I.hay);
    box3(b, x, 0, z, cw, h, cd, 0.06);
    b.setColor(I.hayD);
    const long = cw >= cd;
    for (const t of [0.3, 0.7]) { if (long) box3(b, x + cw * t, 0, z - 0.02, 0.05, h + 0.02, cd + 0.04); else box3(b, x - 0.02, 0, z + cd * t, cw + 0.04, h + 0.02, 0.05); }
    return;
  }
  if (w.barrels) {
    for (const [ox, oz, col] of [[0.4, 0.4, I.red], [cw - 0.4, 0.4, I.navy], [0.4, cd - 0.4, I.teal], [cw - 0.4, cd - 0.4, I.red]]) { b.setColor(col); b.prismY(0, h, x + ox, z + oz, 0.36, 0.36, 8); }
    return;
  }
  if (w.cars) {
    // A spare gondola off the wheel: a little tub with a bench, waiting on blocks.
    b.setColor(I.teal);
    box3(b, x, 0.2, z, cw, h - 0.2, cd, 0.08);
    b.setColor(I.gold);
    box3(b, x - 0.05, h - 0.1, z - 0.05, cw + 0.1, 0.1, cd + 0.1);
    return;
  }
  if (w.bowser) {
    // A fuel bowser: a tank on two wheels.
    b.setColor(I.red);
    b.prismX(x, x + cw, 0.95, z + cd / 2, cd * 0.42, cd * 0.42, 8);
    b.setColor(I.iron);
    b.prismZ(z - 0.05, z + cd + 0.05, x + cw / 2, 0.35, 0.35, 0.35, 8);
    return;
  }
  kit.crate(b, w, rnd);
}

function wrenContainer(ctx, w) {
  const { b, theme, kit } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  if (w.genset) {
    // A show generator on its trailer: a box with louvres, a fuel cap, cables snaking off to the fair.
    b.setColor(I.iron);
    box3(b, x - 0.3, 0.3, z + 0.2, cw + 0.6, 0.25, cd - 0.4);
    b.prismZ(z - 0.05, z + 0.3, x + cw / 2, 0.35, 0.35, 0.35, 8); b.prismZ(z + cd - 0.3, z + cd + 0.05, x + cw / 2, 0.35, 0.35, 0.35, 8);
    b.setColor(I.gold);
    box3(b, x, 0.55, z, cw, h - 0.55, cd);
    b.setColor(I.goldD);
    for (let s = 0.5; s < cw - 0.4; s += 0.45) box3(b, x + s, 1.1, z + cd - 0.02, 0.2, 1.1, 0.05);
    b.setColor(I.iron);
    b.prismY(h, h + 0.6, x + 0.8, z + cd / 2, 0.12, 0.1, 6);
    return;
  }
  kit.container(b, w, ctx.rnd);
}

// Poles: the Big Top's king pole (canvas rags hanging off it, the bulbs' strings run from it), the burned tent poles,
// and the high striker (a tall board with its scale, the puck's track and the bell on top).
function wrenCrane(ctx, w) {
  const { b, theme, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: mw, d: md, h } = w;
  const cx = x + mw / 2, cz = z + md / 2;
  if (w.kingpole || w.tentpole) {
    b.setColor(w.kingpole ? I.red : I.char);
    b.prismY(0, h, cx, cz, mw * 0.45, mw * 0.35, 6);
    if (w.kingpole) { b.setColor(I.gold); b.prismY(h, h + 0.4, cx, cz, 0.3, 0.05, 6); b.prismY(2, 2.3, cx, cz, 0.55, 0.55, 6); }
    // Burned canvas, hanging in strips.
    b.setColor(w.kingpole ? I.canvas : I.char);
    for (let i = 0; i < (w.kingpole ? 6 : 3); i++) {
      const a = i / (w.kingpole ? 6 : 3) * Math.PI * 2 + 0.3, len = 1.2 + (i % 3) * 0.9, r = w.kingpole ? 0.5 : 0.3;
      const ax = cx + Math.cos(a) * r, az = cz + Math.sin(a) * r, ex = cx + Math.cos(a) * (r + 1.2), ez = cz + Math.sin(a) * (r + 1.2);
      b.quad([ax, h - 0.3, az], [ex, h - 0.3 - len * 0.4, ez], [ex, h - 0.3 - len * 1.3, ez], [ax, h - 0.3 - len, az], [cx + Math.cos(a) * 9, h, cz + Math.sin(a) * 9]);
    }
    return;
  }
  if (w.striker) {
    // The high striker: a base, a tall red board with a white scale, the track and the brass bell at the top.
    b.setColor(I.timberD);
    box3(b, x - 0.3, 0, z - 0.3, mw + 0.6, 0.3, md + 0.6);
    b.setColor(I.red);
    box3(b, x + 0.2, 0.3, z + 0.3, mw - 0.4, h - 0.3, 0.3);
    b.setColor(I.cream);
    for (let y = 0.8; y < h - 0.4; y += 0.5) box3(b, x + 0.3, y, z + 0.6, mw - 0.6, 0.06, 0.03);
    b.setColor(I.ironL);
    box3(b, x + mw / 2 - 0.04, 0.3, z + 0.62, 0.08, h - 0.6, 0.06);
    b.setColor(I.gold);
    b.prismY(h - 0.1, h + 0.3, cx, z + 0.45, 0.28, 0.12, 8);
    b.setColor(I.timber);
    box3(b, x - 0.25, 0, z + md + 0.1, 0.9, 0.5, 0.6);
    emissive(b, () => { b.setColor(I.sign); box3(b, x + 0.25, h * 0.55, z + 0.62, mw - 0.5, 0.35, 0.03); });
    glow.halo(cx, z + md, 1.4, [0.1, 0.07, 0.02], h);
    return;
  }
  b.setColor(I.iron);
  box3(b, x, 0, z, mw, h, md);
}

// The perimeter: a picket fence painted cream, a dark hedge behind it, the field beyond.
function wrenBorder(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  b.setColor(I.grassD);
  box3(b, w.x, 0, w.z, w.w, 1.8, w.d);
  const long = w.w > w.d, L = long ? w.w : w.d;
  b.setColor(I.creamD);
  if (long) box3(b, w.x, 0.5, w.z + w.d / 2 - 0.04, w.w, 0.12, 0.08); else box3(b, w.x + w.w / 2 - 0.04, 0.5, w.z, 0.08, 0.12, w.d);
  for (let s = 0; s < L; s += 4) { if (long) box3(b, w.x + s, 0, w.z + w.d / 2 - 0.05, 0.12, 1.1, 0.1); else box3(b, w.x + w.w / 2 - 0.05, 0, w.z + s, 0.1, 1.1, 0.12); }
}

// The big wheel: two rims in the plane facing the camera (north of the yard), spokes, gondolas hanging off the rim, an
// A-frame each side, bulbs round the rim and on the hub.
function bigWheel(ctx, d) {
  const { b, theme, glow } = ctx;
  const I = theme.ink;
  const N = 20, R = d.r, hy = R + 1.6, cz = d.z;
  const pt = (a, r, zz) => [d.x + Math.cos(a) * r, hy + Math.sin(a) * r, zz];
  b.setColor(I.ironL);
  for (const zz of [cz - 0.6, cz + 0.6]) for (let i = 0; i < N; i++) beam(b, pt(i / N * Math.PI * 2, R, zz), pt((i + 1) / N * Math.PI * 2, R, zz), 0.07);
  b.setColor(I.iron);
  for (let i = 0; i < N; i += 2) beam(b, pt(i / N * Math.PI * 2, 0.4, cz + 0.62), pt(i / N * Math.PI * 2, R, cz + 0.62), 0.04);
  for (const s of [-1, 1]) { beam(b, [d.x - 3.4, 0, cz + s * 1.3], [d.x, hy, cz + s * 0.7], 0.12); beam(b, [d.x + 3.4, 0, cz + s * 1.3], [d.x, hy, cz + s * 0.7], 0.12); }
  b.prismZ(cz - 0.9, cz + 0.9, d.x, hy, 0.45, 0.45, 8);
  const cols = [I.red, I.teal, I.gold, I.purple, I.cream];
  for (let i = 0; i < N; i += 2) {
    const a = i / N * Math.PI * 2 + 0.1, [gx, gy] = pt(a, R, 0);
    b.setColor(cols[(i / 2) % cols.length]);
    box3(b, gx - 0.55, gy - 1.25, cz - 0.5, 1.1, 0.75, 1.0, 0.06);
    b.setColor(I.iron);
    box3(b, gx - 0.03, gy - 0.5, cz - 0.03, 0.06, 0.5, 0.06);
  }
  const ring = [];
  for (let i = 0; i < N * 2; i++) ring.push(pt(i / (N * 2) * Math.PI * 2, R + 0.12, cz + 0.68));
  bulbs(b, I, ring, 0.1);
  emissive(b, () => { b.setColor(I.bulbB); b.prismZ(cz + 0.9, cz + 1.0, d.x, hy, 0.5, 0.5, 8); });
  glow.halo(d.x, cz + 2, 8, [0.08, 0.04, 0.07]);
}

// The entrance arch over the south fence: two striped towers, a painted board between them with its lit sign.
function arch(ctx, d) {
  const { b, theme } = ctx;
  const I = theme.ink;
  for (const s of [-1, 1]) {
    const tx = d.x + s * 5;
    b.setColor(I.red); box3(b, tx - 0.5, 0, d.z - 0.2, 1, 6.2, 1);
    b.setColor(I.cream); for (let y = 0.8; y < 6; y += 1.6) box3(b, tx - 0.52, y, d.z - 0.22, 1.04, 0.6, 1.04);
    b.setColor(I.gold); b.prismY(6.2, 7.2, tx, d.z + 0.3, 0.6, 0.05, 4);
  }
  b.setColor(I.navy);
  b.loft([[[d.x - 4.6, 5.0, d.z], [d.x, 6.6, d.z], [d.x + 4.6, 5.0, d.z]], [[d.x - 4.6, 5.0, d.z + 0.3], [d.x, 6.6, d.z + 0.3], [d.x + 4.6, 5.0, d.z + 0.3]]]);
  b.setColor(I.navy);
  box3(b, d.x - 4.6, 4.2, d.z, 9.2, 0.8, 0.3);
  emissive(b, () => { b.setColor(I.sign); for (let s = -3.6; s <= 3.6; s += 0.8) box3(b, d.x + s - 0.25, 4.35, d.z - 0.04, 0.5, 0.5, 0.04); });
  const row = []; for (let i = 0; i <= 12; i++) { const t = i / 12, xx = d.x - 4.6 + t * 9.2; row.push([xx, 5.0 + Math.sin(t * Math.PI) * 1.6 + 0.05, d.z - 0.05]); }
  bulbs(b, I, row, 0.1);
}

function wrenDecor(ctx) {
  const { b, map, W, H, theme, glow, rnd } = ctx;
  const I = theme.ink;
  // Light poles and work lights.
  for (const [x, z] of POLES) {
    b.setColor(I.timberD);
    b.prismY(0, POLE_H + 0.2, x, z, 0.1, 0.08, 5);
    emissive(b, () => { b.setColor(I.bulbD); box3(b, x - 0.13, POLE_H - 0.1, z - 0.13, 0.26, 0.26, 0.26); });
  }
  for (const [x, z] of WORK) {
    b.setColor(I.iron);
    b.prismY(0, 4.4, x, z, 0.09, 0.07, 5);
    box3(b, x - 0.35, 4.3, z - 0.25, 0.7, 0.35, 0.5);
    emissive(b, () => { b.setColor([1, 0.98, 0.9]); box3(b, x - 0.3, 4.25, z - 0.2, 0.6, 0.06, 0.4); });
  }
  // Strings of bulbs: a sagging wire, a bulb every 1.3 m, colours in turn.
  STRINGS.forEach(([p0, p1], k) => {
    const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]), n = Math.max(3, Math.round(len / 1.5)), sag = Math.min(1.6, len * 0.06);
    const at = t => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - Math.sin(t * Math.PI) * sag, p0[2] + (p1[2] - p0[2]) * t];
    b.setColor(I.iron);
    for (let i = 0; i < 4; i++) beam(b, at(i / 4), at((i + 1) / 4), 0.02);
    const pts = [];
    for (let i = 1; i < n; i++) { const p = at(i / n); pts.push([p[0], p[1] - 0.12, p[2]]); }
    bulbs(b, I, pts, 0.08, k);
  });
  for (const d of map.decor || []) {
    if (d.type === 'bigwheel') bigWheel(ctx, d);
    if (d.type === 'arch') arch(ctx, d);
  }
  // Beyond the hedge: the field, a few caravans and lorries of the travelling show, parked dark.
  for (let i = 0; i < 14; i++) {
    const side = i % 3, t = rnd();
    let x, z;
    if (side === 0) { x = -4 + t * (W + 8); z = -5 - rnd() * 8; }
    else if (side === 1) { x = -5 - rnd() * 7; z = 4 + t * (H - 8); }
    else { x = W + 5 + rnd() * 7; z = 4 + t * (H - 8); }
    b.setColor(i % 2 ? sc(I.creamD, 0.55) : sc(I.teal, 0.5));
    box3(b, x - 1.6, 0.4, z - 0.9, 3.2, 2.0, 1.8, 0.08);
    b.setColor(I.iron);
    box3(b, x - 1.2, 0, z - 0.95, 0.5, 0.5, 1.9);
    if (i % 4 === 0) emissive(b, () => { b.setColor(sc(I.window, 0.6)); box3(b, x - 0.6, 1.3, z + 0.91, 0.6, 0.4, 0.03); });
  }
  for (let i = 0; i < 18; i++) {
    // Hedgerow trees round the field.
    const a = i / 18 * Math.PI * 2, rr = 1 + rnd() * 0.25, x = W / 2 + Math.cos(a) * (W * 0.62) * rr, z = H / 2 + Math.sin(a) * (H * 0.75) * rr;
    b.setColor(sc(I.grassD, 0.7));
    b.prismY(0, 3 + rnd() * 3, x, z, 1.4 + rnd(), 0.4, 6, rnd());
  }
  glow.halo(W * 0.85, H + 26, 10, [0.06, 0.05, 0.1], 22, 14);     // The moon's glow, low in the south-east.
  skyRing(ctx, { low: [0.03, 0.02, 0.05], mid: [0.07, 0.04, 0.12], warm: [0.2, 0.1, 0.2], high: [0.02, 0.01, 0.05], warmDir: [0.6, 1], y0: -4, y1: 10, y2: 60 });
}

export const wrenfield = {
  dress: { building: wrenBuilding, wall: wrenWall, barrier: wrenBarrier, crate: wrenCrate, container: wrenContainer, crane: wrenCrane, border: wrenBorder },
  stage: { lights: wrenLights, ground: wrenGround, paint: wrenPaint, decor: wrenDecor },
  thumb: { ground: '#6a5a40', solid: '#8a3a3a', low: '#c8a870', edge: '#140c18' },
};
