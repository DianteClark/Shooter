// Ashgrove Halt's theme (farmland, Graveyard Shift only; js/shared/maps/ashgrove.js, docs/ZOMBIES.md): a country rail
// halt and its churchyard at night. Cold moonlight from the north-west, ground mist, and warm oil lamps in pools along
// the paths; the chapel's windows and the signal box are the only lit rooms. world.js reads `ashgrove` ({ dress, stage,
// thumb }) into its tables and hands every drawer ctx.kit, because this module cannot import world.js back.
import { THEMES, hexRGB } from '../art.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));
const sc = (c, k) => c.map(v => v * k);

THEMES.ashgrove = {
  id: 'ashgrove',
  light: { dir: norm([-0.5, 0.72, -0.48]), sun: [0.3, 0.38, 0.5], sky: [0.26, 0.31, 0.4], amb: [0.25, 0.27, 0.32] },
  clear: 0x080b0f,
  fog: [0.3, 0.36, 0.42], fogSeam: [0.12, 0.1, 0.05], desatTint: [0.76, 0.82, 0.86],
  shadow: { col: [0.3, 0.34, 0.44], strength: 0.5, len: 0.75 },
  lamp: [0.5, 0.34, 0.14],
  ink: ink({
    ground: 0x4a5444, asphalt: 0x4c4a48, dirt: 0x4e4538, gravel: 0x5c5a56,
    roof: 0x3e434c, wall: 0x6e6a62, wallB: 0x5e5c58, trim: 0x2c2a2a,
    concrete: 0x77736a, crate: 0x7a6040, crateD: 0x4c3c28,
    rail: 0x868c92, tie: 0x3a302a, hazardY: 0x9a7a30, hazardK: 0x222224,
    paint: 0xc4bca2, glow: 0xffc070, glowCool: 0xc8e0ff,
    grass: 0x46523e, grassD: 0x3a4434, moss: 0x4e5a3a, flag: 0x6e6a64, flagD: 0x5a5752,
    stone: 0x7a766c, stoneD: 0x5e5b54, flint: 0x4c4c4e, brick: 0x6a3e32, brickD: 0x52302a,
    slate: 0x343a44, timber: 0x5e4630, timberD: 0x3e2e22, green: 0x3e5a46, cream: 0xbab29a,
    iron: 0x2c2e32, ironL: 0x4a4e54, yew: 0x22301f, yewL: 0x2e3e28, bark: 0x3e3226, coal: 0x1e1e20,
    lampHot: 0xffd28a, glass: 0xffb860, stained: 0xe0a050, signal: 0xd8f0c0,
  }),
  containers: [0x5a3a2c, 0x3e4a3a, 0x4e4434],
  weather: { fields: [
    // Ground mist: big, faint, slow, low.
    { kind: 'mote', count: 30, box: [46, 1.6, 34], vel: [0.35, 0.02, 0.1], size: 5.2, col: [0.6, 0.66, 0.72], alpha: 0.075 },
    { kind: 'mote', count: 16, box: [46, 4, 34], vel: [0.2, 0.03, -0.1], size: 7, col: [0.5, 0.56, 0.64], alpha: 0.05 },
    // Moths round the lamps, and a few embers off the lamp glass.
    { kind: 'mote', count: 40, box: [40, 5, 30], vel: [0.1, 0.25, 0.05], size: 0.07, col: [1, 0.85, 0.55], alpha: 0.45 },
  ] },
};

// ---- Where things are (render only) --------------------------------------------------------------------------------

// Oil lamp posts: each stands against a wall or in a corner, so none stands in a path.
const LAMPS = [
  [23.4, 31.2], [1.2, 36], [12.6, 46.6], [22.8, 46.6],      // The Halt.
  [9.6, 9.6], [23.4, 2.4], [1.2, 27.2], [23.4, 26.8],       // Goods Yard.
  [25.6, 16.2], [35.4, 9.6], [46.6, 9.6], [55.4, 16.2],     // Churchyard.
  [25.6, 19.2], [55.4, 32.8], [36.4, 22.6],                 // Pump Yard.
  [57.6, 1.2], [75, 34.2], [57.6, 34.2],                    // Burial Field.
  [25.6, 46.6], [44.6, 46.6], [56.6, 36.4], [68.4, 46.6],   // Crossing Lane.
];
const RAIL_Z = 45.6;

function ashGround(ctx) {
  const { noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  return p => {
    const [x, , z] = p;
    const k = 0.86 + noise(x * 0.7, z * 0.7) * 0.22 + (rnd() - 0.5) * 0.05;
    if (x < 0 || z < 0 || x > W || z > H) return sc(noise(x * 0.1, z * 0.1) > 0.55 ? I.grassD : I.grass, k * 0.7);
    if (Math.abs(z - RAIL_Z) < 1.5) return sc(I.gravel, k * 0.82);                 // Ballast.
    if (x < 24 && z > 29) {                                                        // The Halt: platform flags.
      const f = (Math.floor(x / 1.5) + Math.floor(z / 1.5)) % 2;
      return sc(z > 44 ? I.concrete : f ? I.flag : I.flagD, k);
    }
    if (x < 24 || z > 35) return sc(noise(x * 0.2 + 3, z * 0.2) > 0.6 ? I.dirt : I.gravel, k);   // Yards and the lane.
    // Grass in the churchyard, the pump yard and the field, worn to earth on the paths.
    const path = (Math.abs(x - 39) < 1.2 && z < 33) || (Math.abs(z - 10.2) < 0.9 && x < 56) || (Math.abs(z - 11) < 0.9 && x > 56);
    if (path) return sc(I.dirt, k * 0.95);
    return sc(noise(x * 0.16 + 7, z * 0.16) > 0.6 ? I.moss : noise(x * 0.4, z * 0.4) > 0.5 ? I.grass : I.grassD, k);
  };
}

function ashPaint(ctx) {
  const { b, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  // The line: sleepers and rails along the south edge, the length of the map and out past both ends.
  b.setColor(I.tie);
  for (let x = -24; x < W + 24; x += 0.75) b.groundRect(x, RAIL_Z - 1.05, 0.26, 2.1, 0.05);
  b.setColor(I.rail);
  for (const o of [-0.72, 0.65]) b.groundRect(-24, RAIL_Z + o, W + 48, 0.08, 0.1);
  // The platform's white edge, and a worn yellow line on the level crossing.
  b.setColor(sc(I.paint, 0.8));
  b.groundRect(0.4, 44.1, 23.2, 0.18, 0.04);
  b.setColor(sc(I.hazardY, 0.7));
  for (let x = 36; x < 44; x += 1.1) b.groundRect(x, 43.6, 0.6, 0.14, 0.04);
  // Fallen leaves and puddles.
  for (let i = 0; i < 40; i++) {
    const x = 1 + rnd() * (W - 2), z = 1 + rnd() * (H - 2);
    b.setColor(i % 3 ? sc(I.bark, 0.9) : sc(I.asphalt, 0.6));
    b.groundRect(x, z, 0.3 + rnd() * 0.8, 0.25 + rnd() * 0.6, 0.03);
  }
  // Grave mounds in front of every headstone.
  for (const w of ctx.map.walls) {
    if (!w.grave) continue;
    b.setColor(sc(I.dirt, 0.9));
    b.groundRect(w.x + 0.05, w.z + w.d + 0.05, w.w - 0.1, 1.5, 0.04);
  }
}

function ashLights(ctx) {
  const { map, lamps, glow } = ctx;
  const oil = [1, 0.66, 0.3];
  for (const [x, z] of LAMPS) { lamps.push({ x, z, r: 7.5 }); glow.halo(x, z, 4.2, sc(oil, 0.09)); }
  for (const w of map.walls) {
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
    if (w.chapel) { lamps.push({ x: cx, z: w.z + w.d + 2, r: 8, col: [0.5, 0.32, 0.12] }); glow.halo(cx, w.z + w.d + 1.5, 5, [0.14, 0.08, 0.02]); }
    if (w.waiting) lamps.push({ x: cx, z: w.z + w.d + 1.8, r: 7, col: [0.46, 0.32, 0.14] });
    if (w.signalbox) { lamps.push({ x: cx, z: w.z + w.d + 1.6, r: 7, col: [0.36, 0.4, 0.3] }); glow.halo(cx, w.z + w.d + 1, 4, [0.06, 0.08, 0.05]); }
    if (w.pumphouse) lamps.push({ x: w.x - 1.2, z: cz, r: 6, col: [0.3, 0.42, 0.34] });
    if (w.obelisk) { lamps.push({ x: cx, z: cz, r: 8, col: [0.44, 0.3, 0.12] }); glow.halo(cx, cz, 5, [0.1, 0.06, 0.02]); }
  }
}

// ---- Drawers -------------------------------------------------------------------------------------------------------

function gable(b, x0, x1, z0, z1, y, rise, over = 0.25) {
  // A pitched roof along x: the ridge over the middle of z0..z1.
  const zm = (z0 + z1) / 2;
  b.loft([
    [[x0 - over, y, z0 - over], [x0 - over, y + rise, zm], [x0 - over, y, z1 + over]],
    [[x1 + over, y, z0 - over], [x1 + over, y + rise, zm], [x1 + over, y, z1 + over]],
  ]);
}

function ashBuilding(ctx, w) {
  const { b, rnd, theme, kit, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  if (w.chapel) {
    // Flint nave with stone quoins under a steep slate roof, a squat tower at the west end with a short spire, lit
    // lancet windows down the camera side and a lit door.
    const tx = x + 3;
    b.setColor(I.flint);
    kit.box3(b, tx, 0, z, bw - 3, h - 1.4, bd);
    b.setColor(I.stone);
    for (const [qx, qz] of [[tx, z], [x + bw - 0.4, z], [tx, z + bd - 0.4], [x + bw - 0.4, z + bd - 0.4]]) kit.box3(b, qx - 0.05, 0, qz - 0.05, 0.5, h - 1.3, 0.5);
    b.setColor(I.slate);
    gable(b, tx, x + bw, z, z + bd, h - 1.4, 3.2);
    b.setColor(I.stoneD);
    kit.box3(b, x, 0, z + 0.8, 3, h + 2, bd - 1.6);
    b.setColor(I.stone);
    kit.box3(b, x - 0.1, h + 2, z + 0.7, 3.2, 0.3, bd - 1.4);
    b.setColor(I.slate);
    b.prismY(h + 2.3, h + 6, x + 1.5, z + bd / 2, 1.5, 0.05, 4, Math.PI / 4);
    b.setColor(I.iron);
    kit.box3(b, x + 1.45, h + 6, z + bd / 2 - 0.05, 0.1, 0.9, 0.1);
    kit.box3(b, x + 1.2, h + 6.5, z + bd / 2 - 0.05, 0.6, 0.1, 0.1);
    kit.emissive(b, () => {
      b.setColor(I.stained);
      for (let s = tx + 1; s < x + bw - 1; s += 1.8) kit.box3(b, s, 1.2, z + bd + 0.01, 0.55, 1.8, 0.05);
      b.setColor(sc(I.stained, 0.8));
      for (let s = tx + 1; s < x + bw - 1; s += 1.8) kit.box3(b, s, 1.2, z - 0.06, 0.55, 1.8, 0.05);
      b.setColor(I.glass);
      kit.box3(b, x + 0.9, 0, z + bd - 0.75, 1.2, 2.1, 0.04);
      b.setColor(sc(I.stained, 0.9));
      b.prismZ(z + bd - 0.82, z + bd - 0.78, x + 1.5, h + 0.6, 0.45, 0.45, 8);
    });
    glow.streak(x + bw / 2 + 1.5, z + bd + 0.3, bw - 4, 2.4, [0.16, 0.09, 0.03], 0.12);
    return;
  }
  if (w.waiting) {
    // Brick waiting room with a cream band, a slate roof and warm windows onto the platform.
    b.setColor(I.brick);
    kit.box3(b, x, 0, z, bw, h - 0.4, bd);
    b.setColor(I.cream);
    kit.box3(b, x - 0.04, 1.0, z - 0.04, bw + 0.08, 0.25, bd + 0.08);
    b.setColor(I.slate);
    gable(b, x, x + bw, z, z + bd, h - 0.4, 1.4, 0.4);
    b.setColor(I.brickD);
    kit.box3(b, x + bw - 1.6, h - 0.4, z + 1, 0.6, 1.8, 0.6);
    kit.emissive(b, () => {
      b.setColor(I.glass);
      for (const s of [1, 3.4, 5.8]) kit.box3(b, x + s, 1.4, z + bd + 0.01, 1.2, 1.1, 0.04);
      b.setColor(sc(I.glass, 0.6));
      for (const s of [1.4, 4.6]) kit.box3(b, x + s, 1.4, z - 0.05, 1.2, 1.1, 0.04);
    });
    // The station nameboard on the gable end.
    b.setColor(I.green);
    kit.box3(b, x - 0.08, 2.3, z + bd / 2 - 1.2, 0.06, 0.6, 2.4);
    b.setColor(I.cream);
    kit.box3(b, x - 0.1, 2.42, z + bd / 2 - 1.0, 0.04, 0.36, 2.0);
    return;
  }
  if (w.shed) {
    // Timber goods shed on a brick plinth, a big sliding door, a gabled roof with a smoke vent.
    b.setColor(I.brickD);
    kit.box3(b, x, 0, z, bw, 0.7, bd);
    b.setColor(I.timber);
    kit.box3(b, x + 0.05, 0.7, z + 0.05, bw - 0.1, h - 1.5, bd - 0.1);
    b.setColor(I.timberD);
    for (let s = x + 0.4; s < x + bw; s += 0.7) kit.box3(b, s, 0.7, z + bd - 0.04, 0.08, h - 1.5, 0.06);
    b.setColor(I.green);
    kit.box3(b, x + bw / 2 - 1.4, 0, z + bd - 0.02, 2.8, 2.8, 0.1);
    b.setColor(I.slate);
    gable(b, x, x + bw, z, z + bd, h - 0.8, 1.8, 0.35);
    b.prismY(h + 0.9, h + 1.4, x + bw / 2, z + bd / 2, 0.5, 0.35, 4, Math.PI / 4);
    return;
  }
  if (w.pumphouse) {
    // The pump house: brick, a tall chimney, louvred windows, a big breaker cabinet on the west wall (the switch itself
    // is drawn by the mode, js/render/zm-power.js).
    b.setColor(I.brick);
    kit.box3(b, x, 0, z, bw, h, bd);
    b.setColor(I.stone);
    kit.box3(b, x - 0.06, h - 0.3, z - 0.06, bw + 0.12, 0.3, bd + 0.12);
    b.setColor(I.slate);
    gable(b, x, x + bw, z, z + bd, h, 1.5, 0.3);
    b.setColor(I.brickD);
    b.prismY(0, h + 6, x + bw - 1.2, z + 1.2, 0.75, 0.55, 8);
    b.setColor(I.stone);
    b.prismY(h + 5.6, h + 6.1, x + bw - 1.2, z + 1.2, 0.68, 0.68, 8);
    b.setColor(I.green);
    for (const s of [1.2, 4.2]) kit.box3(b, x + s, 1.3, z + bd + 0.01, 1.4, 1.3, 0.05);
    b.setColor(I.ironL);
    kit.box3(b, x - 0.25, 0.2, z + bd / 2 - 1.3, 0.25, 2.0, 0.7);
    kit.box3(b, x - 0.25, 0.2, z + bd / 2 + 0.6, 0.25, 2.0, 0.7);
    // Pipes from the well to the tower.
    b.setColor(I.iron);
    b.prismX(x + bw, x + bw + 4.2, 0.35, z + 1.5, 0.16, 0.16, 6);
    return;
  }
  if (w.signalbox) {
    // Signal box: brick base, a glazed timber cabin above with a hipped roof, its lamps on.
    const cab = 1.8;
    b.setColor(I.brick);
    kit.box3(b, x, 0, z, bw, cab, bd);
    b.setColor(I.cream);
    kit.box3(b, x - 0.1, cab, z - 0.1, bw + 0.2, h - cab - 0.6, bd + 0.2);
    kit.emissive(b, () => {
      b.setColor(I.signal);
      kit.box3(b, x + 0.3, cab + 0.6, z + bd + 0.11, bw - 0.6, 1.0, 0.04);
      kit.box3(b, x + 0.3, cab + 0.6, z - 0.15, bw - 0.6, 1.0, 0.04);
      b.setColor(sc(I.signal, 0.8));
      kit.box3(b, x - 0.15, cab + 0.6, z + 0.3, 0.04, 1.0, bd - 0.6);
      kit.box3(b, x + bw + 0.11, cab + 0.6, z + 0.3, 0.04, 1.0, bd - 0.6);
    });
    b.setColor(I.slate);
    b.prismY(h - 0.6, h + 0.8, x + bw / 2, z + bd / 2, Math.hypot(bw, bd) / 2 + 0.3, 0.2, 4, Math.PI / 4);
    b.setColor(I.timber);
    kit.box3(b, x + bw - 0.8, 0, z + bd, 0.7, cab, 0.6);        // The steps.
    return;
  }
  if (w.obelisk) {
    // The war memorial in the burial field: a stepped plinth and a tapering obelisk, lanterns at its foot.
    const cx = x + bw / 2, cz = z + bd / 2;
    b.setColor(I.stoneD);
    kit.box3(b, x, 0, z, bw, 0.5, bd);
    b.setColor(I.stone);
    kit.box3(b, x + 0.3, 0.5, z + 0.3, bw - 0.6, 0.6, bd - 0.6);
    b.prismY(1.1, h, cx, cz, (bw - 1.2) * 0.7, 0.25, 4, Math.PI / 4);
    b.prismY(h, h + 0.5, cx, cz, 0.25, 0.02, 4, Math.PI / 4);
    kit.emissive(b, () => {
      b.setColor(I.lampHot);
      for (const [lx, lz] of [[x - 0.2, z + bd + 0.05], [x + bw - 0.1, z + bd + 0.05]]) kit.box3(b, lx, 0, lz, 0.3, 0.4, 0.3);
    });
    return;
  }
  kit.building(b, w, rnd, ctx.lamps);
}

function ashWall(ctx, w) {
  const { b, theme, kit, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: ww, d: wd, h } = w;
  const long = ww >= wd, L = long ? ww : wd;
  if (w.coal) {
    // The coal stage's brick retaining wall.
    b.setColor(I.brickD);
    kit.box3(b, x, 0, z, ww, h, wd);
    b.setColor(I.stoneD);
    kit.box3(b, x - 0.05, h, z - 0.05, ww + 0.1, 0.18, wd + 0.1);
    return;
  }
  // Flint and stone walls: a dark flint body, stone piers every few metres, stone coping, moss along the foot.
  b.setColor(I.flint);
  kit.box3(b, x, 0, z, ww, h - 0.2, wd);
  b.setColor(I.stone);
  kit.box3(b, x - 0.06, h - 0.2, z - 0.06, ww + 0.12, 0.24, wd + 0.12);
  b.setColor(I.stoneD);
  for (let s = 0; s <= L - 0.6; s += 4) {
    const t = Math.min(s, L - 0.6);
    if (long) kit.box3(b, x + t, 0, z - 0.08, 0.6, h + 0.06, wd + 0.16);
    else kit.box3(b, x - 0.08, 0, z + t, ww + 0.16, h + 0.06, 0.6);
  }
  b.setColor(I.moss);
  for (let s = 0.3; s < L - 0.5; s += 1.3 + rnd()) {
    if (long) kit.box3(b, x + s, 0, z - 0.04, 0.6 + rnd() * 0.5, 0.25, wd + 0.08);
    else kit.box3(b, x - 0.04, 0, z + s, ww + 0.08, 0.25, 0.6 + rnd() * 0.5);
  }
}

function ashBarrier(ctx, w) {
  const { b, theme, kit, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  if (w.railing) {
    // A low stone plinth with iron railings: you can see over it, shoot over it, never climb it.
    const long = bw >= bd, L = long ? bw : bd;
    b.setColor(I.stone);
    kit.box3(b, x, 0, z, bw, 0.45, bd);
    b.setColor(I.stoneD);
    kit.box3(b, x - 0.04, 0.45, z - 0.04, bw + 0.08, 0.08, bd + 0.08);
    b.setColor(I.iron);
    const off = long ? bd / 2 : bw / 2;
    for (let s = 0.15; s < L; s += 0.32) {
      if (long) kit.box3(b, x + s, 0.53, z + off - 0.03, 0.05, h - 0.45, 0.05);
      else kit.box3(b, x + off - 0.03, 0.53, z + s, 0.05, h - 0.45, 0.05);
    }
    if (long) kit.box3(b, x, h - 0.08, z + off - 0.04, bw, 0.06, 0.08);
    else kit.box3(b, x + off - 0.04, h - 0.08, z, 0.08, 0.06, bd);
    return;
  }
  if (w.grave) {
    // A headstone, leaning a little, with a rounded top.
    const lean = (rnd() - 0.5) * 0.12;
    b.setColor(rnd() < 0.4 ? I.stoneD : I.stone);
    kit.box3(b, x + 0.08, 0, z + 0.08, bw - 0.16, h - 0.25, bd - 0.16);
    b.prismZ(z + 0.08, z + bd - 0.08, x + bw / 2 + lean, h - 0.25, (bw - 0.16) / 2, (bw - 0.16) / 2, 8);
    b.setColor(I.moss);
    kit.box3(b, x + 0.05, 0, z + 0.05, bw - 0.1, 0.12, bd - 0.1);
    return;
  }
  if (w.kiosk) {
    // The ticket kiosk: a green timber booth with a lit hatch.
    b.setColor(I.green);
    kit.box3(b, x, 0, z, bw, h, bd);
    b.setColor(I.slate);
    kit.box3(b, x - 0.1, h, z - 0.1, bw + 0.2, 0.15, bd + 0.2);
    kit.emissive(b, () => { b.setColor(I.glass); kit.box3(b, x + 0.25, h * 0.55, z + bd + 0.01, bw - 0.5, 0.35, 0.04); });
    return;
  }
  kit.barrier(b, w);
}

function ashCrate(ctx, w) {
  const { b, theme, kit, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  if (w.tomb) {
    // A chest tomb: a stone box on a step, its lid overhanging, lichen on the lid.
    b.setColor(I.stoneD);
    kit.box3(b, x, 0, z, cw, 0.2, cd);
    b.setColor(I.stone);
    kit.box3(b, x + 0.15, 0.2, z + 0.12, cw - 0.3, h - 0.35, cd - 0.24);
    b.setColor(sc(I.stone, 1.08));
    kit.box3(b, x + 0.05, h - 0.15, z + 0.02, cw - 0.1, 0.15, cd - 0.04);
    b.setColor(I.moss);
    kit.box3(b, x + 0.4, h, z + 0.2, cw * 0.4, 0.02, cd * 0.5);
    return;
  }
  if (w.bench) {
    b.setColor(I.iron);
    for (const s of [0.1, cw - 0.2]) kit.box3(b, x + s, 0, z + 0.1, 0.1, 0.5, cd - 0.2);
    b.setColor(I.timber);
    kit.box3(b, x, 0.45, z + 0.05, cw, 0.08, cd - 0.25);
    kit.box3(b, x, 0.55, z + cd - 0.18, cw, 0.4, 0.08);
    return;
  }
  if (w.trolley) {
    // A luggage trolley with trunks and a suitcase.
    b.setColor(I.iron);
    kit.box3(b, x, 0.25, z, cw, 0.1, cd);
    for (const [wx, wz] of [[x + 0.2, z], [x + cw - 0.2, z], [x + 0.2, z + cd], [x + cw - 0.2, z + cd]]) b.prismZ(wz - 0.05, wz + 0.05, wx, 0.2, 0.2, 0.2, 6);
    b.setColor(I.timberD);
    kit.box3(b, x + 0.1, 0.35, z + 0.1, 1.0, 0.45, cd - 0.2);
    b.setColor(I.brickD);
    kit.box3(b, x + 1.15, 0.35, z + 0.15, 0.7, 0.35, cd - 0.3);
    b.setColor(I.cream);
    kit.box3(b, x + 0.2, 0.8, z + 0.25, 0.7, 0.2, cd - 0.5);
    return;
  }
  if (w.transformer) {
    // A grey transformer cabinet with cooling fins and a hazard plate.
    b.setColor(I.ironL);
    kit.box3(b, x, 0, z, cw, h, cd);
    b.setColor(I.iron);
    for (let s = 0.15; s < cw - 0.1; s += 0.3) kit.box3(b, x + s, 0.2, z + cd, 0.08, h - 0.4, 0.12);
    b.setColor(I.hazardY);
    kit.box3(b, x + cw / 2 - 0.2, h * 0.5, z - 0.02, 0.4, 0.4, 0.03);
    return;
  }
  if (w.handcar) {
    b.setColor(I.iron);
    kit.box3(b, x, 0.3, z, cw, 0.15, cd);
    for (const [wx, wz] of [[x + 0.4, z], [x + cw - 0.4, z], [x + 0.4, z + cd], [x + cw - 0.4, z + cd]]) b.prismZ(wz - 0.06, wz + 0.06, wx, 0.3, 0.3, 0.3, 8);
    b.setColor(I.timber);
    kit.box3(b, x + cw / 2 - 0.1, 0.45, z + cd / 2 - 0.1, 0.2, 0.6, 0.2);
    b.setColor(I.ironL);
    kit.box3(b, x + cw / 2 - 0.9, 1.0, z + cd / 2 - 0.05, 1.8, 0.08, 0.1);
    return;
  }
  if (w.coalheap) {
    b.setColor(I.coal);
    b.prismY(0, h, x + cw / 2, z + cd / 2, Math.min(cw, cd) * 0.6, 0.2, 7);
    return;
  }
  if (w.sacks) {
    b.setColor(I.cream);
    for (let i = 0; i < 4; i++) kit.box3(b, x + (i % 2) * 0.8 + 0.05, Math.floor(i / 2) * 0.45, z + 0.1 + rnd() * 0.2, 0.7, 0.42, cd - 0.4);
    return;
  }
  kit.crate(b, w, rnd);
}

function ashContainer(ctx, w) {
  const { b, theme, kit } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  if (!w.van) return kit.container(b, w, ctx.rnd);
  // A goods van left in the yard: planked brown body, a curved roof, two axles, a sliding door.
  b.setColor(I.coal);
  for (const ax of [x + 1.2, x + cw - 1.2]) for (const zz of [z + 0.1, z + cd - 0.1]) b.prismZ(zz - 0.06, zz + 0.06, ax, 0.42, 0.42, 0.42, 8);
  b.setColor(I.iron);
  kit.box3(b, x - 0.2, 0.55, z + 0.15, cw + 0.4, 0.25, cd - 0.3);
  b.setColor(I.brickD);
  kit.box3(b, x, 0.8, z, cw, h - 1.2, cd);
  b.setColor(sc(I.brickD, 0.8));
  for (let s = 0.4; s < cw; s += 0.6) kit.box3(b, x + s, 0.8, z + cd - 0.01, 0.05, h - 1.2, 0.04);
  b.setColor(I.slate);
  b.loft([
    [[x - 0.05, h - 0.4, z - 0.05], [x - 0.05, h + 0.05, z + cd * 0.25], [x - 0.05, h + 0.15, z + cd / 2], [x - 0.05, h + 0.05, z + cd * 0.75], [x - 0.05, h - 0.4, z + cd + 0.05]],
    [[x + cw + 0.05, h - 0.4, z - 0.05], [x + cw + 0.05, h + 0.05, z + cd * 0.25], [x + cw + 0.05, h + 0.15, z + cd / 2], [x + cw + 0.05, h + 0.05, z + cd * 0.75], [x + cw + 0.05, h - 0.4, z + cd + 0.05]],
  ]);
  b.setColor(I.cream);
  kit.box3(b, x + cw / 2 - 0.8, 1.4, z + cd + 0.02, 1.6, 0.06, 0.04);
}

function ashTree(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  b.setColor(I.bark);
  b.prismY(0, w.dead ? 3.6 : 2, cx, cz, w.w * 0.45, w.w * 0.28, 6);
  if (w.dead) {
    // Bare branches.
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + rnd(), r = 1.3 + rnd() * 0.8, y = 2 + i * 0.4;
      b.loft([
        [[cx - 0.08, y, cz - 0.06], [cx + 0.08, y, cz - 0.06], [cx, y, cz + 0.09]],
        [[cx + Math.cos(a) * r - 0.03, y + 1.2, cz + Math.sin(a) * r], [cx + Math.cos(a) * r + 0.03, y + 1.2, cz + Math.sin(a) * r], [cx + Math.cos(a) * r, y + 1.2, cz + Math.sin(a) * r + 0.04]],
      ]);
    }
    return;
  }
  // A yew: three dark tiers.
  for (let k = 0; k < 3; k++) {
    b.setColor(k % 2 ? I.yewL : I.yew);
    b.prismY(1.4 + k * 1.5, 3.4 + k * 1.5, cx, cz, 2.4 - k * 0.6, 0.6 - k * 0.15, 8, rnd());
  }
}

function towerLeg(ctx, w) {
  const { b, theme, kit } = ctx;
  b.setColor(theme.ink.iron);
  kit.box3(b, w.x + 0.1, 0, w.z + 0.1, w.w - 0.2, w.h, w.d - 0.2);
  b.setColor(theme.ink.stoneD);
  kit.box3(b, w.x - 0.1, 0, w.z - 0.1, w.w + 0.2, 0.4, w.d + 0.2);
}

// Perimeter: a hedge on a stone bank, with the dark wood and the fields beyond.
function ashBorder(ctx, w) {
  const { b, theme, kit, rnd } = ctx;
  const I = theme.ink;
  b.setColor(I.stoneD);
  kit.box3(b, w.x, 0, w.z, w.w, 1.0, w.d);
  const long = w.w > w.d, L = long ? w.w : w.d;
  for (let s = 0; s < L; s += 1.4) {
    b.setColor(rnd() < 0.5 ? I.yew : I.yewL);
    const hh = w.z > ctx.H ? 1.8 + rnd() * 0.4 : 2.6 + rnd() * 1.2;
    if (long) kit.box3(b, w.x + s, 0.8, w.z - 0.2, 1.5, hh, w.d + 0.4);
    else kit.box3(b, w.x - 0.2, 0.8, w.z + s, w.w + 0.4, hh, 1.5);
  }
}

function ashDecor(ctx) {
  const { b, map, W, H, theme, kit, glow, rnd } = ctx;
  const I = theme.ink;
  // Oil lamp posts.
  for (const [x, z] of LAMPS) {
    b.setColor(I.iron);
    b.prismY(0, 3.2, x, z, 0.1, 0.07, 6);
    kit.box3(b, x - 0.18, 3.2, z - 0.18, 0.36, 0.06, 0.36);
    kit.emissive(b, () => { b.setColor(I.lampHot); b.prismY(3.26, 3.7, x, z, 0.16, 0.2, 4, Math.PI / 4); });
    b.setColor(I.iron);
    b.prismY(3.7, 3.9, x, z, 0.24, 0.04, 4, Math.PI / 4);
  }
  for (const d of map.decor || []) {
    if (d.type !== 'tank') continue;
    // The water tower's tank on its legs, with a ladder.
    b.setColor(I.ironL);
    kit.box3(b, d.x - 0.1, d.y, d.z - 0.1, d.w + 0.2, 0.25, d.d + 0.2);
    b.setColor(I.green);
    kit.box3(b, d.x, d.y + 0.25, d.z, d.w, 2.2, d.d);
    b.setColor(I.iron);
    for (let y = d.y + 0.6; y < d.y + 2.4; y += 0.6) kit.box3(b, d.x - 0.03, y, d.z - 0.03, d.w + 0.06, 0.08, d.d + 0.06);
    b.prismY(d.y - 0.5, d.y, d.x + d.w / 2, d.z + d.d + 0.15, 0.12, 0.12, 6);
  }
  // Level crossing gates either side of the lane, half open.
  b.setColor(I.cream);
  for (const [x, z] of [[35.5, 36.2], [44.5, 36.2]]) { b.prismY(0, 1.3, x, z, 0.12, 0.1, 6); kit.box3(b, x, 1.15, z - 0.05, 3, 0.1, 0.1); }
  b.setColor(I.hazardK);
  for (const x0 of [35.9, 44.9]) for (let s = 0; s < 2.6; s += 0.6) kit.box3(b, x0 + s, 1.16, 36.2 - 0.06, 0.25, 0.11, 0.12);
  // The wood beyond the hedges: dark conifers, taller to the north (the far side from the camera).
  for (let i = 0; i < 44; i++) {
    const side = i % 4, t = rnd();
    let x, z;
    if (side < 2) { x = -12 + t * (W + 24); z = -4 - rnd() * 12; }
    else if (side === 2) { x = -4 - rnd() * 10; z = t * H; }
    else { x = W + 4 + rnd() * 10; z = t * H; }
    const hgt = 6 + rnd() * 6;
    b.setColor(rnd() < 0.5 ? I.yew : sc(I.yew, 0.8));
    b.prismY(0, hgt, x, z, 1.6 + rnd(), 0.15, 6, rnd());
  }
  // A cold moon glow over the north and the sky round the map.
  glow.halo(W * 0.25, -18, 10, [0.05, 0.06, 0.08], 14, 16);
  kit.skyRing(ctx, { low: [0.02, 0.03, 0.04], mid: [0.08, 0.1, 0.13], warm: [0.16, 0.2, 0.26], high: [0.01, 0.02, 0.04], warmDir: [-0.5, -1], y0: -4, y1: 9, y2: 55 });
}

export const ashgrove = {
  dress: { building: ashBuilding, wall: ashWall, barrier: ashBarrier, crate: ashCrate, container: ashContainer, rock: ashTree, crane: towerLeg, border: ashBorder },
  stage: { lights: ashLights, ground: ashGround, paint: ashPaint, decor: ashDecor },
  thumb: { ground: '#3e4838', solid: '#5c5a56', low: '#7a766c', edge: '#0e1012' },
};
