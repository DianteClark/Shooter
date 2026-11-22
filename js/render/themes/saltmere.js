// Saltmere Abbey's theme (coast, Graveyard Shift only; js/shared/maps/saltmere.js, docs/ZOMBIES.md): a drowned abbey
// town on the salt marsh at night, in a cold drizzle. A pale green moon high in the north-east, brine standing in the
// streets (dark teal sheets that catch the light), wet slate and rubble stone, bladderwrack on the walls; the only warm
// light is candles in the windows, ship's lanterns on the quay and the abbey's stained glass. Clearly not Ashgrove's
// foggy churchyard (amber oil lamps, grass and flint), Polestar's polar station (blue snow, aurora, sodium floods) nor
// Wrenfield's fair (violet night, a hundred coloured bulbs): sea-green and black water, candle amber, ruby and
// sapphire glass. world.js reads `saltmere` ({ dress, stage, thumb }) into its tables.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, skyRing } from './kit.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));
const sc = scale;

THEMES.saltmere = {
  id: 'saltmere',
  // A pale green moon high in the north-east; candles and lanterns do the rest.
  light: { dir: norm([0.4, 0.78, -0.46]), sun: [0.24, 0.32, 0.3], sky: [0.16, 0.24, 0.25], amb: [0.17, 0.23, 0.24] },
  clear: 0x050b0c,
  fog: [0.14, 0.22, 0.22], fogSeam: [0.05, 0.1, 0.09], desatTint: [0.74, 0.84, 0.82],
  shadow: { col: [0.2, 0.3, 0.32], strength: 0.52, len: 0.72 },
  lamp: [0.56, 0.4, 0.18],
  groundAmp: 0.14,
  ink: ink({
    ground: 0x3a4640, asphalt: 0x343c3c, dirt: 0x45403a, gravel: 0x4e5452,
    roof: 0x2e363c, wall: 0x6a6e66, wallB: 0x52564f, trim: 0x22282a,
    concrete: 0x646a66, crate: 0x6a5840, crateD: 0x443828,
    rail: 0x7c868a, tie: 0x32302a, hazardY: 0xa88a3a, hazardK: 0x1c2022,
    paint: 0xc8ccc0, glow: 0xffc070, glowCool: 0xb8fff0,
    cobble: 0x4a504c, cobbleD: 0x383e3b, brine: 0x163a3a, brineL: 0x2a5a56, brineD: 0x0c2626, silt: 0x4e4a3c, weed: 0x2c3a24,
    grass: 0x34442e, grassD: 0x2a3826, flag: 0x5c605a, flagD: 0x474b46, slab: 0x6e7068,
    stone: 0x6a6c62, stoneD: 0x4e5049, stoneL: 0x868a7e, slate: 0x2c3238, slateL: 0x3c444a, brick: 0x5e3a30, brickD: 0x452a24,
    timber: 0x5a4632, timberD: 0x3a2c20, tar: 0x1c1c1e, white: 0xd8dcd4, lifeblue: 0x2a4a7a, lifered: 0x9a2e26,
    iron: 0x262a2c, ironL: 0x4a5052, copper: 0x3e7a68, wrack: 0x3a3a1e, rope: 0x8a7a5a, bell: 0x9a7a3a,
    candle: 0xffc674, lampHot: 0xffd28a, window: 0xffb860, ruby: 0xd8303a, sapphire: 0x3a6ae0, emerald: 0x3ac08a, amber: 0xe0a040,
    ghost: 0x7affe0, hull: 0x2a3a44, hullB: 0x7a2e2a, sail: 0x8a8270,
  }),
  containers: [0x3e5a4a, 0x2e4250, 0x4a4032],
  weather: { fields: [
    // A cold drizzle off the sea, rings on the flood, sea fret low over the water.
    { kind: 'rain', count: 260, box: [36, 14, 28], vel: [-1.6, -15, 1.2], len: 0.7, width: 0.012, col: [0.72, 0.9, 0.86], alpha: 0.26 },
    { kind: 'ripple', count: 80, box: [34, 1, 26], life: 0.6, size: 0.6, col: [0.7, 0.92, 0.86], alpha: 0.3 },
    { kind: 'mote', count: 24, box: [46, 1.4, 34], vel: [0.4, 0.02, 0.15], size: 5, col: [0.5, 0.64, 0.62], alpha: 0.07 },
    // Candle smoke and the odd moth round the windows.
    { kind: 'mote', count: 26, box: [40, 5, 30], vel: [0.05, 0.3, 0.05], size: 0.07, col: [1, 0.84, 0.6], alpha: 0.4 },
  ] },
};

// ---- Where things are (render only) --------------------------------------------------------------------------------

// Ship's lanterns on posts along the quay and the streets (each against a wall or in a corner, so none stands in a path).
const LAMPS = [
  [26.8, 38.6], [53.2, 38.6], [27, 51], [53, 51], [36.2, 46.2],           // Fish Quay.
  [1.2, 26.2], [23.8, 26.2], [23.8, 41.2], [1.2, 36.2], [10.6, 43.2],     // Market Row.
  [23.8, 1.2], [1.2, 23.8], [23.8, 23.8],                                 // The Cloister.
  [26.8, 15.2], [53.2, 15.2], [34.6, 4.6],                                // Cathedral Close.
  [55.8, 31.8], [78.8, 31.8], [71.6, 40.4], [55.8, 41.6],                 // Lifeboat Slip.
];
// Candles on the nave's pier bases and the altar (the arena reads by them).
const CANDLES = [[58.8, 6.8], [58.8, 13.8], [58.8, 20.8], [76.2, 6.8], [76.2, 13.8], [76.2, 20.8], [65, 2.2], [70, 2.2]];
// Where the flood stands deep enough to shine: pools as [x, z, rx, rz].
const POOLS = [
  [33, 41.5, 5, 2], [48, 44, 4, 2.4], [12, 28.5, 5, 2.2], [16, 46, 4, 3], [5, 34.5, 3, 1.6], [40, 23.5, 4, 2.5], [48, 34, 3, 1.6],
  [67, 14, 6, 9], [62, 38, 5, 4], [70, 35, 3, 2], [38, 11, 4, 2.6], [20, 3, 3, 2],
];

function inPool(x, z, pad = 0) {
  for (const [px, pz, rx, rz] of POOLS) { const d = ((x - px) / (rx + pad)) ** 2 + ((z - pz) / (rz + pad)) ** 2; if (d < 1) return d; }
  return -1;
}

function saltGround(ctx) {
  const { noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  return p => {
    const [x, , z] = p;
    const k = 0.86 + noise(x * 0.6, z * 0.6) * 0.2 + (rnd() - 0.5) * 0.05;
    // The sea beyond the sea wall; the marsh everywhere else outside.
    if (z > H + 0.5) return sc(noise(x * 0.2, z * 0.2) > 0.5 ? I.brineD : I.brine, k * 0.7);
    if (x < 0 || z < 0 || x > W) return sc(noise(x * 0.12, z * 0.12) > 0.55 ? I.weed : I.grassD, k * 0.62);
    // Standing brine: a dark sheet with a lighter skin, darker at its heart.
    const pd = inPool(x, z);
    if (pd >= 0) return sc(pd < 0.35 ? I.brineD : pd < 0.8 ? I.brine : I.brineL, k * (1.05 + noise(x * 1.4, z * 1.4) * 0.15));
    // The cloister garth: drowned grass; the nave: flags and grave slabs; the quay: wet cobbles and silt.
    if (x < 25 && z < 25 && x > 3 && z > 3 && !(x < 9 && z < 9)) return sc(noise(x * 0.5, z * 0.5) > 0.6 ? I.weed : I.grass, k);
    if (x > 55 && z < 30) {
      const slab = (Math.floor(x / 1.6) + Math.floor(z / 1.1)) % 2;
      return sc(slab ? I.flag : I.flagD, k * (0.94 + noise(x * 2, z * 2) * 0.1));
    }
    if (z > 38 && x > 26 && x < 54) return sc(noise(x * 0.4, z * 0.4) > 0.62 ? I.silt : (Math.floor(x * 2) + Math.floor(z * 2)) % 2 ? I.cobble : I.cobbleD, k);
    if (x > 26 && x < 54 && z > 17 && z < 37) return sc(noise(x * 0.25, z * 0.25) > 0.5 ? I.silt : I.dirt, k * 0.92);
    // Cobbled streets everywhere else, silted here and there.
    return sc(noise(x * 0.2 + 7, z * 0.2) > 0.64 ? I.silt : (Math.floor(x * 2.2) + Math.floor(z * 2.2)) % 2 ? I.cobble : I.cobbleD, k);
  };
}

function saltPaint(ctx) {
  const { b, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  // Wrack and wreckage left by the tide: weed, planks, floats.
  for (let i = 0; i < 52; i++) {
    const x = 1 + rnd() * (W - 2), z = 1 + rnd() * (H - 2);
    b.setColor(i % 3 === 0 ? sc(I.wrack, 0.9) : i % 3 === 1 ? sc(I.timber, 0.8) : sc(I.stoneL, 0.7));
    b.groundRect(x, z, 0.16 + rnd() * 0.3, 0.1 + rnd() * 0.18, 0.03);
  }
  // The brine's shine: a lighter skin on each pool where the light catches it.
  for (const [px, pz, rx, rz] of POOLS) {
    b.setColor(sc(I.brineL, 0.9));
    for (let i = 0; i < 5; i++) b.groundRect(px - rx * 0.5 + rnd() * rx * 0.6, pz - rz * 0.4 + rnd() * rz * 0.5, 0.6 + rnd() * rx * 0.3, 0.06, 0.035);
  }
  // Grave slabs set in the nave floor.
  for (let i = 0; i < 10; i++) {
    const x = 61.5 + (i % 5) * 2.4, z = 6 + Math.floor(i / 5) * 9 + (i % 2) * 2;
    b.setColor(I.slab);
    b.groundRect(x, z, 0.9, 1.9, 0.04);
    b.setColor(I.stoneD);
    b.groundRect(x + 0.25, z + 0.3, 0.4, 0.06, 0.05);
  }
  for (const d of ctx.map.decor || []) {
    if (d.type === 'pad') {
      // The lifeboat hard: a painted ring and a white anchor on the wet stone.
      b.setColor(I.white);
      for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; b.groundRect(d.x + Math.cos(a) * 2.8 - 0.22, d.z + Math.sin(a) * 2.8 - 0.22, 0.44, 0.44, 0.04); }
      b.setColor(I.lifered);
      b.groundRect(d.x - 0.18, d.z - 1.3, 0.36, 2.4, 0.05); b.groundRect(d.x - 1.0, d.z - 0.9, 2, 0.32, 0.05); b.groundRect(d.x - 1.2, d.z + 0.8, 2.4, 0.3, 0.05);
    }
  }
  // Mooring rings and bollards' rust along the sea wall.
  b.setColor(sc(I.ironL, 0.7));
  for (let x = 28; x < 53; x += 3.2) b.groundRect(x, 51.4, 0.3, 0.3, 0.04);
}

function saltLights(ctx) {
  const { map, lamps, glow } = ctx;
  for (const [x, z] of LAMPS) { lamps.push({ x, z, r: 6.5, col: [0.5, 0.34, 0.14] }); glow.halo(x, z, 3.2, [0.07, 0.045, 0.015]); }
  for (const [x, z] of CANDLES) { lamps.push({ x, z, r: 4.5, col: [0.44, 0.3, 0.12] }); glow.halo(x, z, 1.6, [0.08, 0.05, 0.02]); }
  // Each font has a cold glow of its own, so a dead end reads as somewhere.
  (map.zm?.quest?.fonts ?? []).forEach(({ x, z }) => { lamps.push({ x, z, r: 4.5, col: [0.12, 0.4, 0.36] }); glow.halo(x, z, 2.2, [0.03, 0.14, 0.12]); });
  for (const w of map.walls) {
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
    if (w.westfront) {
      // The rose window throws ruby and sapphire on the Close.
      lamps.push({ x: cx - 1.5, z: w.z + w.d + 2.5, r: 7, col: [0.46, 0.12, 0.14] });
      lamps.push({ x: cx + 1.5, z: w.z + w.d + 2.5, r: 7, col: [0.14, 0.2, 0.5] });
      glow.halo(cx, w.z + w.d + 2, 5, [0.09, 0.04, 0.07]);
    }
    if (w.fishhall) lamps.push({ x: cx, z: w.z - 1.6, r: 7, col: [0.5, 0.36, 0.16] });
    if (w.office) lamps.push({ x: w.x - 1, z: cz, r: 5, col: [0.48, 0.34, 0.16] });
    if (w.shop) lamps.push({ x: cx, z: w.z + w.d + 1.4, r: 5.5, col: [0.48, 0.32, 0.14] });
    if (w.lavabo) { lamps.push({ x: cx, z: cz, r: 7, col: [0.16, 0.34, 0.32] }); glow.halo(cx, cz, 4, [0.03, 0.08, 0.07]); }
    if (w.enginehouse) lamps.push({ x: w.x - 1.4, z: cz, r: 6, col: [0.44, 0.38, 0.26] });
    if (w.lifeboat) { lamps.push({ x: cx, z: w.z - 2, r: 8, col: [0.46, 0.36, 0.2] }); glow.halo(cx, w.z - 1, 4, [0.06, 0.045, 0.02]); }
    if (w.belltower) { lamps.push({ x: w.x - 1.6, z: cz, r: 6, col: [0.42, 0.34, 0.2] }); glow.halo(w.x - 1, cz, 2.4, [0.07, 0.05, 0.02]); }
    if (w.altar) { lamps.push({ x: cx, z: w.z + w.d + 1.6, r: 8, col: [0.5, 0.34, 0.14] }); glow.halo(cx, w.z + w.d + 1, 4, [0.08, 0.05, 0.02]); }
  }
}

// ---- Drawers -------------------------------------------------------------------------------------------------------

// A gabled roof over a box: ridge along the long side, eaves overhanging a little.
function gable(b, x, z, w, d, y, rise, col, over = 0.3) {
  b.setColor(col);
  if (w >= d) {
    const r = z + d / 2;
    b.loft([[[x - over, y, z - over], [x - over, y + rise, r], [x - over, y, z + d + over]], [[x + w + over, y, z - over], [x + w + over, y + rise, r], [x + w + over, y, z + d + over]]]);
  } else {
    const r = x + w / 2;
    b.loft([[[x - over, y, z - over], [r, y + rise, z - over], [x + w + over, y, z - over]], [[x - over, y, z + d + over], [r, y + rise, z + d + over], [x + w + over, y, z + d + over]]]);
  }
}

// Lit windows along a face (z = face, facing +z when out > 0): small panes, a candle's amber.
function windows(b, I, x0, x1, z, y, out = 1, n = 0, col = 'window') {
  const k = n || Math.max(1, Math.round((x1 - x0) / 1.8));
  emissive(b, () => {
    b.setColor(I[col]);
    for (let i = 0; i < k; i++) { const x = x0 + (i + 0.5) * (x1 - x0) / k; box3(b, x - 0.28, y, z + (out > 0 ? 0.01 : -0.05), 0.56, 0.72, 0.04); }
  });
}

// Bladderwrack: dark weed along the foot of a wall face, the tide's mark.
function wrack(b, I, x, z, w, d) {
  b.setColor(I.wrack);
  if (w >= d) { box3(b, x - 0.02, 0, z - 0.04, w + 0.04, 0.45, 0.06); box3(b, x - 0.02, 0, z + d - 0.02, w + 0.04, 0.45, 0.06); }
  else { box3(b, x - 0.04, 0, z - 0.02, 0.06, 0.45, d + 0.04); box3(b, x + w - 0.02, 0, z - 0.02, 0.06, 0.45, d + 0.04); }
}

function saltBuilding(ctx, w) {
  const { b, theme, kit, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  if (w.fishhall) {
    // The fish market hall: tarred timber on a stone plinth, a slate roof, an open arcade of posts on the quay side,
    // lit within; a weathervane fish on the ridge.
    b.setColor(I.stoneD); box3(b, x, 0, z, bw, 0.6, bd);
    b.setColor(I.tar); box3(b, x + 0.1, 0.6, z + 0.6, bw - 0.2, h - 0.6, bd - 0.7);
    b.setColor(I.timber); for (let s = 0; s <= bw; s += bw / 4) box3(b, x + Math.min(s, bw - 0.25), 0.6, z, 0.25, h - 0.6, 0.25);
    box3(b, x, h - 0.35, z, bw, 0.35, 0.3);
    gable(b, x, z, bw, bd, h, 1.6, I.slate);
    windows(b, I, x + 0.6, x + bw - 0.6, z + 0.58, 1.4, -1, 3);
    b.setColor(I.copper); b.prismY(h + 1.6, h + 2.4, x + bw / 2, z + bd / 2, 0.04, 0.04, 4); box3(b, x + bw / 2 - 0.4, h + 2.3, z + bd / 2 - 0.05, 0.8, 0.22, 0.1);
    wrack(b, I, x, z, bw, bd);
    return;
  }
  if (w.office) {
    // The harbour office: whitewashed brick, a slate roof, a lit window and a lamp over the door.
    b.setColor(I.white); box3(b, x, 0, z, bw, h - 0.4, bd);
    b.setColor(I.lifeblue); box3(b, x - 0.04, 0, z - 0.04, bw + 0.08, 0.5, bd + 0.08);
    gable(b, x, z, bw, bd, h - 0.4, 1.2, I.slate);
    windows(b, I, x + 0.8, x + bw - 0.8, z - 0.02, 1.2, -1, 2);
    return;
  }
  if (w.shop) {
    // A narrow-fronted town house over a shop: rendered walls, a jettied upper floor, a steep slate roof, a lit shop
    // window and a hanging sign on the street side (south).
    const col = w.shop === 'baker' ? I.stone : w.shop === 'inn' ? I.brick : I.wallB;
    b.setColor(col); box3(b, x, 0, z, bw, h - 0.3, bd);
    b.setColor(I.timberD); box3(b, x - 0.1, 1.9, z + bd - 0.05, bw + 0.2, 0.18, 0.3);
    gable(b, x, z, bw, bd, h - 0.3, 1.5, I.slateL);
    b.setColor(I.stoneD); b.prismY(h - 0.3, h + 1.6, x + bw - 0.9, z + bd / 2, 0.3, 0.26, 4);
    windows(b, I, x + 0.6, x + bw - 0.6, z + bd, 0.8, 1, 2);
    windows(b, I, x + 0.8, x + bw - 0.8, z + bd, 2.35, 1, 3, 'candle');
    b.setColor(I.iron); box3(b, x + bw - 0.6, 2.5, z + bd + 0.05, 0.06, 0.06, 0.7);
    b.setColor(w.shop === 'inn' ? I.lifered : I.timber); box3(b, x + bw - 0.62, 1.95, z + bd + 0.5, 0.05, 0.5, 0.36);
    wrack(b, I, x, z, bw, bd);
    return;
  }
  if (w.lavabo) {
    // The cloister's lavabo: an octagonal stone basin under a canopy on eight columns, dark water in it glowing faintly.
    const cx = x + bw / 2, cz = z + bd / 2, R = bw / 2;
    b.setColor(I.stoneD); b.prismY(0, 0.9, cx, cz, R, R * 0.96, 8, Math.PI / 8);
    b.setColor(I.stoneL); b.prismY(0.9, 1.05, cx, cz, R + 0.1, R + 0.1, 8, Math.PI / 8);
    emissive(b, () => { b.setColor(sc(I.ghost, 0.32)); b.prismY(0.86, 0.92, cx, cz, R * 0.82, R * 0.82, 8, Math.PI / 8); });
    b.setColor(I.stone);
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; b.prismY(1.05, h, cx + Math.cos(a) * R * 0.86, cz + Math.sin(a) * R * 0.86, 0.14, 0.12, 6); }
    b.setColor(I.slate); b.prismY(h, h + 1.6, cx, cz, R + 0.4, 0.1, 8, Math.PI / 8);
    b.setColor(I.stoneL); b.prismY(h + 1.5, h + 2.1, cx, cz, 0.12, 0.04, 4);
    return;
  }
  if (w.westfront) {
    // The abbey's west front against the north wall: a tall gabled screen with two buttressed towers, a deep arched
    // door, and the rose window lit ruby and sapphire from the candles inside.
    b.setColor(I.stone); box3(b, x, 0, z, bw, h + 3.2, bd);
    b.setColor(I.stoneD);
    for (const tx of [x - 0.6, x + bw - 0.8]) box3(b, tx, 0, z, 1.4, h + 6.2, bd + 0.4);
    b.loft([[[x, h + 3.2, z], [x + bw / 2, h + 6.4, z], [x + bw, h + 3.2, z]], [[x, h + 3.2, z + bd], [x + bw / 2, h + 6.4, z + bd], [x + bw, h + 3.2, z + bd]]]);
    for (const tx of [x - 0.6, x + bw - 0.8]) { b.setColor(I.slate); b.prismY(h + 6.2, h + 8.4, tx + 0.7, z + bd / 2 + 0.2, 0.9, 0.06, 4, Math.PI / 4); }
    b.setColor(I.tar); box3(b, x + bw / 2 - 1, 0, z + bd - 0.02, 2, 2.6, 0.06);
    b.setColor(I.stoneL); b.loft([[[x + bw / 2 - 1.2, 2.6, z + bd + 0.04], [x + bw / 2, 3.4, z + bd + 0.04], [x + bw / 2 + 1.2, 2.6, z + bd + 0.04]], [[x + bw / 2 - 1.2, 2.6, z + bd + 0.2], [x + bw / 2, 3.4, z + bd + 0.2], [x + bw / 2 + 1.2, 2.6, z + bd + 0.2]]]);
    emissive(b, () => {
      // The rose: petals in turn round a hub.
      const cx = x + bw / 2, cy = h + 1.6, R = 1.2;
      for (let i = 0; i < 12; i++) {
        const a0 = i / 12 * Math.PI * 2, a1 = (i + 1) / 12 * Math.PI * 2;
        b.setColor(i % 3 === 0 ? I.ruby : i % 3 === 1 ? I.sapphire : I.amber);
        b.tri([cx, cy, z + bd + 0.03], [cx + Math.cos(a0) * R, cy + Math.sin(a0) * R, z + bd + 0.03], [cx + Math.cos(a1) * R, cy + Math.sin(a1) * R, z + bd + 0.03], [cx, cy, z + bd - 5]);
      }
      b.setColor(I.candle); b.prismZ(z + bd + 0.02, z + bd + 0.06, cx, cy, 0.3, 0.3, 8);
      // Lancets either side.
      for (const ox of [-2.4, 2.4]) { b.setColor(I.sapphire); box3(b, cx + ox - 0.22, 2.2, z + bd + 0.01, 0.44, 1.6, 0.04); b.setColor(I.ruby); box3(b, cx + ox - 0.22, 3.8, z + bd + 0.01, 0.44, 0.4, 0.04); }
    });
    glow.streak(x + bw / 2, z + bd + 0.2, 3, 3, [0.08, 0.03, 0.05], 0.12);
    return;
  }
  if (w.enginehouse) {
    // The marsh pumps' engine house: dark brick, tall round-headed windows, a slate roof and a chimney stack, a gauge
    // panel lit green by the door (the switch itself is drawn by zm-power.js).
    b.setColor(I.brickD); box3(b, x, 0, z, bw, h, bd);
    b.setColor(I.stoneL); box3(b, x - 0.05, h - 0.3, z - 0.05, bw + 0.1, 0.3, bd + 0.1); box3(b, x - 0.05, 0, z - 0.05, bw + 0.1, 0.5, bd + 0.1);
    gable(b, x, z, bw, bd, h, 1.4, I.slate);
    b.setColor(I.brick); b.prismY(h, h + 4.6, x + bw - 1, z + 1, 0.45, 0.38, 4, Math.PI / 4);
    b.setColor(I.iron); b.prismY(h + 4.6, h + 4.9, x + bw - 1, z + 1, 0.5, 0.5, 4, Math.PI / 4);
    windows(b, I, x + 0.8, x + bw - 0.8, z + bd, 1.2, 1, 3);
    emissive(b, () => { b.setColor(I.emerald); box3(b, x + bw / 2 - 0.4, 1.4, z + bd + 0.03, 0.8, 0.35, 0.03); });
    return;
  }
  if (w.lifeboat) {
    // The lifeboat house: white boards, a blue band, big doors on the slip side, the station's name board lit; the
    // lifeboat's red bow showing through the half-open doors.
    b.setColor(I.white); box3(b, x, 0, z + 0.4, bw, h - 0.6, bd - 0.4);
    b.setColor(I.lifeblue); box3(b, x - 0.05, 0, z + 0.36, bw + 0.1, 0.6, bd - 0.3); box3(b, x - 0.05, h - 1.0, z + 0.36, bw + 0.1, 0.25, bd - 0.3);
    gable(b, x, z + 0.4, bw, bd - 0.4, h - 0.6, 1.8, I.slate, 0.4);
    b.setColor(I.lifeblue); box3(b, x + bw / 2 - 2.4, 0, z + 0.3, 1.8, 3, 0.12); box3(b, x + bw / 2 + 0.6, 0, z + 0.3, 1.8, 3, 0.12);
    b.setColor(I.lifered); b.loft([[[x + bw / 2 - 0.5, 0.4, z + 0.6], [x + bw / 2, 1.4, z + 0.36], [x + bw / 2 + 0.5, 0.4, z + 0.6]], [[x + bw / 2 - 0.9, 0.4, z + 2.4], [x + bw / 2, 1.7, z + 2.4], [x + bw / 2 + 0.9, 0.4, z + 2.4]]]);
    emissive(b, () => { b.setColor(I.lampHot); box3(b, x + 1, h - 1.5, z + 0.32, bw - 2, 0.32, 0.04); });
    windows(b, I, x + 0.6, x + 3, z + 0.34, 1.4, -1, 1);
    return;
  }
  if (w.belltower) {
    // The bell tower: a tall square of stone, a louvred belfry with the bell in its opening, a short spire, the rope
    // hanging down its west face to the bell rope's spot (the quest's last step).
    b.setColor(I.stoneD); box3(b, x, 0, z, bw, h - 2.2, bd);
    b.setColor(I.stone); box3(b, x - 0.15, h - 2.2, z - 0.15, bw + 0.3, 0.3, bd + 0.3);
    b.setColor(I.stoneD);
    for (const [ox, oz] of [[0, 0], [bw - 0.4, 0], [0, bd - 0.4], [bw - 0.4, bd - 0.4]]) box3(b, x + ox, h - 1.9, z + oz, 0.4, 1.9, 0.4);
    b.setColor(I.bell); b.prismY(h - 1.7, h - 0.6, x + bw / 2, z + bd / 2, 0.75, 0.32, 8);
    b.setColor(I.stone); box3(b, x - 0.15, h, z - 0.15, bw + 0.3, 0.3, bd + 0.3);
    b.setColor(I.slate); b.prismY(h + 0.3, h + 3.2, x + bw / 2, z + bd / 2, bw * 0.62, 0.05, 4, Math.PI / 4);
    b.setColor(I.rope); box3(b, x - 0.12, 0.9, z + bd / 2 - 0.03, 0.06, h - 2.6, 0.06);
    b.setColor(I.lifered); box3(b, x - 0.16, 0.9, z + bd / 2 - 0.07, 0.14, 0.5, 0.14);
    windows(b, I, x + 0.4, x + bw - 0.4, z - 0.02, 2.6, -1, 1, 'candle');
    return;
  }
  kit.building(b, w, ctx.rnd, ctx.lamps);
}

// The walls: rubble stone with a cut coping, the tide's weed along their foot; buttresses every few metres on the
// abbey's precinct wall.
function saltWall(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: ww, d: wd, h } = w;
  const long = ww >= wd, L = long ? ww : wd;
  for (let s = 0, i = 0; s < L - 0.01; s += 1.3, i++) {
    const n = Math.min(1.3, L - s), k = 0.88 + rnd() * 0.2;
    b.setColor(sc(i % 3 === 1 ? I.stoneD : I.stone, k));
    if (long) box3(b, x + s, 0, z, n, h - 0.2, wd); else box3(b, x, 0, z + s, ww, h - 0.2, n);
  }
  b.setColor(I.stoneL);
  if (long) box3(b, x - 0.04, h - 0.2, z - 0.06, ww + 0.08, 0.2, wd + 0.12); else box3(b, x - 0.06, h - 0.2, z - 0.04, ww + 0.12, 0.2, wd + 0.08);
  wrack(b, I, x, z, ww, wd);
  if (w.precinct || w.seawall) {
    b.setColor(I.stoneD);
    for (let s = 2; s < L - 1; s += 5) { if (long) box3(b, x + s, 0, z - 0.4, 0.7, h - 0.6, wd + 0.8); else box3(b, x - 0.4, 0, z + s, ww + 0.8, h - 0.6, 0.7); }
  }
}

function saltBarrier(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  if (w.altar) {
    // The high altar: a stone table on a step, candles burning along it, a cloth gone green with the sea.
    b.setColor(I.stoneD); box3(b, x - 0.3, 0, z, bw + 0.6, 0.3, bd + 0.4);
    b.setColor(I.stoneL); box3(b, x, 0.3, z, bw, h - 0.3, bd);
    b.setColor(sc(I.emerald, 0.45)); box3(b, x + 0.6, h - 0.05, z - 0.02, bw - 1.2, 0.08, bd + 0.04); box3(b, x + 0.6, 0.6, z + bd - 0.02, bw - 1.2, h - 0.6, 0.04);
    emissive(b, () => { b.setColor(I.candle); for (let s = 0.5; s < bw; s += 0.9) b.prismY(h + 0.02, h + 0.32, x + s, z + 0.5, 0.05, 0.05, 4); });
    return;
  }
  if (w.fallen) {
    // A fallen pier: drums of stone lying in a row, the last one cracked.
    b.setColor(I.stone);
    for (let s = 0; s < bw - 0.1; s += 1.05) b.prismX(x + s, x + s + 0.95, h / 2, z + bd / 2, bd / 2, bd / 2 * 0.96, 8);
    return;
  }
  if (w.cross) {
    // The market cross: steps, a shaft, a weathered head.
    b.setColor(I.stoneD); box3(b, x, 0, z, bw, 0.4, bd); box3(b, x + 0.2, 0.4, z + 0.2, bw - 0.4, 0.35, bd - 0.4);
    b.setColor(I.stone); b.prismY(0.75, 3.4, x + bw / 2, z + bd / 2, 0.14, 0.1, 4, Math.PI / 4);
    box3(b, x + bw / 2 - 0.42, 2.9, z + bd / 2 - 0.08, 0.84, 0.18, 0.16);
    return;
  }
  ctx.kit.barrier(b, w);
}

function saltCrate(ctx, w) {
  const { b, theme, kit, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  if (w.pots) {
    // Lobster pots stacked: netted half-barrels, a coil of rope, a float.
    const n = Math.max(2, Math.round(cw / 0.6) * Math.round(cd / 0.6));
    for (let i = 0; i < n; i++) {
      const ox = x + 0.3 + (i % Math.max(1, Math.round(cw / 0.6))) * 0.6, oz = z + 0.3 + Math.floor(i / Math.max(1, Math.round(cw / 0.6))) * 0.6;
      if (ox > x + cw - 0.2 || oz > z + cd - 0.2) continue;
      b.setColor(i % 2 ? I.timber : I.rope);
      b.prismY(0, 0.5 + (i % 3) * 0.2, ox, oz, 0.27, 0.22, 6);
    }
    b.setColor(I.lifered); b.prismY(h - 0.3, h, x + cw - 0.3, z + 0.3, 0.16, 0.16, 6);
    return;
  }
  if (w.smack) {
    // A fishing smack fetched up on the quay by the flood: a tarred hull on its side, a stub of mast, a rag of sail.
    b.setColor(I.hull);
    b.loft([[[x, 0, z + cd / 2], [x + 0.6, h, z], [x + 0.6, h, z + cd]], [[x + cw * 0.5, 0, z + cd / 2], [x + cw * 0.5, h + 0.1, z - 0.05], [x + cw * 0.5, h + 0.1, z + cd + 0.05]], [[x + cw, 0, z + cd / 2], [x + cw - 0.3, h, z + 0.2], [x + cw - 0.3, h, z + cd - 0.2]]]);
    b.setColor(I.hullB); box3(b, x + 0.6, h - 0.15, z - 0.05, cw - 0.9, 0.15, 0.08);
    b.setColor(I.timberD); b.prismX(x + cw * 0.45, x + cw * 0.45 + 3.2, h + 0.15, z + cd / 2, 0.08, 0.05, 5);
    b.setColor(I.sail); b.quad([x + cw * 0.5, h + 0.2, z + cd / 2], [x + cw * 0.5 + 2.6, h + 0.25, z + cd / 2], [x + cw * 0.5 + 2.2, h + 0.05, z + cd + 0.6], [x + cw * 0.5 + 0.2, h + 0.05, z + cd + 0.5], [x + cw * 0.5 + 1.3, h - 4, z + cd / 2]);
    return;
  }
  if (w.statue) {
    // A saint off the west front, fallen on its face in the flood.
    b.setColor(I.stoneL);
    box3(b, x, 0, z + 0.2, cw * 0.7, h * 0.55, cd - 0.4, 0.06);
    b.prismX(x + cw * 0.7, x + cw, h * 0.3, z + cd / 2, 0.32, 0.3, 6);
    b.setColor(I.stoneD); box3(b, x + cw * 0.2, 0, z - 0.1, 0.8, h, 0.4);
    return;
  }
  if (w.yew) {
    // A yew's stump, its roots in the brine.
    b.setColor(I.timberD); b.prismY(0, h, x + cw / 2, z + cd / 2, cw * 0.48, cw * 0.36, 7);
    b.setColor(I.weed); b.prismY(h - 0.1, h + 0.5, x + cw / 2, z + cd / 2, cw * 0.4, 0.1, 6);
    return;
  }
  if (w.sluice) {
    // The sluice gate's winding gear on its stone box: a wheel and a rack.
    b.setColor(I.stoneD); box3(b, x, 0, z, cw, h * 0.7, cd);
    b.setColor(I.iron); b.prismZ(z + cd / 2 - 0.08, z + cd / 2 + 0.08, x + cw / 2, h * 0.7 + 0.5, 0.5, 0.5, 10);
    box3(b, x + cw / 2 - 0.08, h * 0.7, z + cd / 2 - 0.08, 0.16, 1.4, 0.16);
    return;
  }
  kit.crate(b, w, rnd);
}

function saltContainer(ctx, w) {
  const { b, theme, kit } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  if (w.pump) {
    // A marsh pump: a green boiler on a brick bed, a flywheel at one end and a stand pipe dribbling into the flood.
    b.setColor(I.brickD); box3(b, x - 0.2, 0, z - 0.1, cw + 0.4, 0.5, cd + 0.2);
    b.setColor(I.copper); b.prismX(x + 0.6, x + cw - 0.4, 1.45, z + cd / 2, cd * 0.42, cd * 0.42, 10);
    b.setColor(I.iron); b.prismX(x + 0.6, x + cw - 0.4, 1.45, z + cd / 2, cd * 0.44, cd * 0.44, 10, 0.3);
    b.setColor(I.copper); b.prismX(x + 0.7, x + cw - 0.5, 1.45, z + cd / 2, cd * 0.43, cd * 0.43, 10);
    b.setColor(I.iron); b.prismX(x - 0.05, x + 0.25, 1.45, z + cd / 2, 1.2, 1.2, 12);
    b.prismY(1.4, h + 1.2, x + cw - 1, z + cd / 2, 0.16, 0.14, 6);
    return;
  }
  kit.container(b, w, ctx.rnd);
}

// Piers: the nave's great piers (clustered shafts, a capital, the stump of the arch springing off it, ivy up the
// north face) and the cloister walk's smaller ones.
function saltCrane(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: mw, d: md, h } = w;
  const cx = x + mw / 2, cz = z + md / 2;
  if (w.pier) {
    const big = !w.arcade;
    b.setColor(I.stoneD); box3(b, x - 0.15, 0, z - 0.15, mw + 0.3, 0.5, md + 0.3);
    b.setColor(I.stone);
    b.prismY(0.5, h, cx, cz, mw * 0.42, mw * 0.4, 8, Math.PI / 8);
    if (big) for (const [ox, oz] of [[-0.42, 0], [0.42, 0], [0, -0.42], [0, 0.42]]) b.prismY(0.5, h - 0.2, cx + ox, cz + oz, 0.14, 0.13, 6);
    b.setColor(I.stoneL); box3(b, x - 0.2, h - 0.3, z - 0.2, mw + 0.4, 0.4, md + 0.4);
    if (big) {
      // The arch's springers, broken off: east and west, toward the next pier in the row.
      b.setColor(I.stone);
      b.loft([[[cx - 0.4, h, z + 0.1], [cx + 0.4, h, z + 0.1], [cx + 0.4, h, z + md - 0.1], [cx - 0.4, h, z + md - 0.1]],
        [[cx - 0.3, h + 1.4, z - 1.6], [cx + 0.3, h + 1.4, z - 1.6], [cx + 0.3, h + 1.4, z - 0.6], [cx - 0.3, h + 1.4, z - 0.6]]]);
      b.loft([[[cx - 0.4, h, z + md - 0.1], [cx + 0.4, h, z + md - 0.1], [cx + 0.4, h, z + 0.1], [cx - 0.4, h, z + 0.1]],
        [[cx - 0.3, h + 1.2, z + md + 1.3], [cx + 0.3, h + 1.2, z + md + 1.3], [cx + 0.3, h + 1.2, z + md + 0.4], [cx - 0.3, h + 1.2, z + md + 0.4]]]);
      b.setColor(I.weed); box3(b, x - 0.05, 0.5, z - 0.12, mw * 0.7, h * 0.55, 0.08);
    }
    b.setColor(I.wrack); box3(b, x - 0.17, 0.5, z - 0.17, mw + 0.34, 0.3, md + 0.34);
    return;
  }
  b.setColor(I.iron);
  box3(b, x, 0, z, mw, h, md);
}

// The perimeter: the town's outer wall, low enough to see the marsh and the sea over; the sea wall along the south.
function saltBorder(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const south = w.z >= ctx.H - 0.1 && w.w > w.d;
  b.setColor(south ? I.stoneD : I.stone);
  box3(b, w.x, 0, w.z, w.w, south ? 1.3 : 1.9, w.d);
  b.setColor(I.stoneL);
  box3(b, w.x, south ? 1.3 : 1.9, w.z, w.w, 0.12, w.d);
  b.setColor(I.wrack);
  if (w.w > w.d) box3(b, w.x, 0, w.z - 0.03, w.w, 0.5, w.d + 0.06); else box3(b, w.x - 0.03, 0, w.z, w.w + 0.06, 0.5, w.d);
}

// The abbey round the nave: its north wall standing to the clerestory with empty window arches, the east gable with
// the great window (its tracery lit from within).
function abbey(ctx, d) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const x0 = 55, x1 = 80, zN = -1.4;
  b.setColor(I.stone);
  for (let x = x0; x < x1; x += 3.5) {
    // A bay: a solid pier of wall, an empty pointed arch over the window.
    box3(b, x, 0, zN - 0.9, 1.1, 9, 0.9);
    b.loft([[[x + 1.1, 6, zN - 0.9], [x + 2.3, 8.2, zN - 0.9], [x + 3.5, 6, zN - 0.9]], [[x + 1.1, 6, zN], [x + 2.3, 8.2, zN], [x + 3.5, 6, zN]]]);
    box3(b, x + 1.1, 8.2, zN - 0.9, 2.4, 0.8, 0.9);
    box3(b, x + 1.1, 0, zN - 0.9, 2.4, 2.4, 0.9);
  }
  // The east gable, beyond the boss arena's east wall.
  b.setColor(I.stoneD);
  box3(b, 81.6, 0, -1.4, 1.2, 10, 32);
  b.loft([[[81.6, 10, -1.4], [81.6, 14, 14], [81.6, 10, 30.6]], [[82.8, 10, -1.4], [82.8, 14, 14], [82.8, 10, 30.6]]]);
  emissive(b, () => {
    b.setColor(sc(I.ghost, 0.5));
    for (let i = 0; i < 5; i++) box3(b, 81.55, 3.5, 9 + i * 2.2, 0.04, 6 - Math.abs(i - 2) * 0.8, 1.2);
  });
  void d;
}

// Beyond the sea wall: the harbour mouth, black water to the horizon, the stubs of masts of boats sunk at their
// moorings, the harbour light on its jetty blinking green.
function harbour(ctx, d) {
  const { b, theme, glow, W } = ctx;
  const I = theme.ink;
  b.setColor(I.brineD);
  b.quad([-20, -0.35, d.z + 1.6], [W + 20, -0.35, d.z + 1.6], [W + 20, -0.35, d.z + 40], [-20, -0.35, d.z + 40], [0, -10, d.z + 10]);
  b.setColor(I.stoneD);
  box3(b, 8, -0.5, d.z + 1.6, 2, 0.9, 16);
  emissive(b, () => { b.setColor(I.emerald); box3(b, 8.6, 0.4, d.z + 17, 0.8, 1.2, 0.8); });
  glow.halo(9, d.z + 17.4, 3, [0.02, 0.12, 0.07], 0.3);
  b.setColor(I.timberD);
  for (const [mx, mz, mh] of [[24, 8, 4], [33, 12, 6], [55, 7, 3.4], [62, 15, 5], [70, 9, 4.6]]) {
    b.prismY(-0.4, mh, mx, d.z + mz, 0.07, 0.05, 5);
    box3(b, mx - 0.9, mh * 0.7, d.z + mz - 0.03, 1.8, 0.06, 0.06);
  }
}

function saltDecor(ctx) {
  const { b, map, W, H, theme, glow, rnd } = ctx;
  const I = theme.ink;
  // Ship's lanterns on posts.
  for (const [x, z] of LAMPS) {
    b.setColor(I.timberD); b.prismY(0, 3.4, x, z, 0.08, 0.07, 5);
    b.setColor(I.iron); box3(b, x - 0.05, 3.3, z - 0.05, 0.5, 0.08, 0.1);
    emissive(b, () => { b.setColor(I.lampHot); box3(b, x + 0.28, 2.95, z - 0.11, 0.22, 0.32, 0.22); });
  }
  // Candles on the pier bases and their pools.
  emissive(b, () => { b.setColor(I.candle); for (const [x, z] of CANDLES) for (let k = 0; k < 3; k++) b.prismY(0.5, 0.75 + k * 0.08, x + k * 0.16, z + (k % 2) * 0.14, 0.04, 0.04, 4); });
  // The fonts' basins: a stone bowl on a stem (the quest draws the water and its glow over them, zm-econ-fx).
  for (const { x, z } of map.zm?.quest?.fonts ?? []) {
    b.setColor(I.stoneD); box3(b, x - 0.6, 0, z - 0.6, 1.2, 0.2, 1.2);
    b.setColor(I.stone); b.prismY(0.2, 0.7, x, z, 0.2, 0.16, 8); b.prismY(0.7, 1.0, x, z, 0.5, 0.62, 8);
  }
  for (const d of map.decor || []) {
    if (d.type === 'abbey') abbey(ctx, d);
    if (d.type === 'seawall') harbour(ctx, d);
  }
  // The marsh beyond the town wall: drowned fence posts, reeds, a few cottages' roofs above the flood.
  for (let i = 0; i < 26; i++) {
    const side = i % 3, t = rnd();
    let x, z;
    if (side === 0) { x = -4 + t * (W - 20); z = -4 - rnd() * 9; }
    else if (side === 1) { x = -4 - rnd() * 8; z = 3 + t * (H - 6); }
    else { x = W + 4 + rnd() * 8; z = 34 + t * (H - 36); }
    b.setColor(sc(I.weed, 0.8 + rnd() * 0.3));
    b.prismY(0, 0.8 + rnd() * 0.8, x, z, 0.5 + rnd() * 0.5, 0.1, 5, rnd());
    if (i % 5 === 0) {
      b.setColor(sc(I.slate, 0.8)); gable(b, x - 1.5, z + 1.5, 3, 2, 0.4, 1.3, sc(I.slate, 0.8));
      if (i % 10 === 0) emissive(b, () => { b.setColor(sc(I.candle, 0.6)); box3(b, x - 0.3, 0.6, z + 3.52, 0.4, 0.3, 0.03); });
    }
  }
  glow.halo(W * 0.8, -26, 12, [0.05, 0.09, 0.07], 24, 14);     // The moon's glow, high in the north-east.
  skyRing(ctx, { low: [0.02, 0.04, 0.04], mid: [0.04, 0.08, 0.08], warm: [0.08, 0.14, 0.12], high: [0.01, 0.02, 0.03], warmDir: [0.6, -1], y0: -4, y1: 10, y2: 60 });
}

export const saltmere = {
  dress: { building: saltBuilding, wall: saltWall, barrier: saltBarrier, crate: saltCrate, container: saltContainer, crane: saltCrane, border: saltBorder },
  stage: { lights: saltLights, ground: saltGround, paint: saltPaint, decor: saltDecor },
  thumb: { ground: '#3a4a44', solid: '#6a6c62', low: '#2a5a56', edge: '#060c0c' },
};
