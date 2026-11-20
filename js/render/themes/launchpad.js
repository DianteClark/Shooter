// Launchpad's theme (desert, large; js/shared/maps/launchpad.js): a rocket on its pad in a white salt flat at high
// noon. The sun almost overhead and a little south-east, so shadows are short and blue; the salt crust is pale and
// cracked into plates, the concrete roads and aprons a cooler grey, the service tower and the crawler a muted
// international orange, the tanks and the rocket white. Clearly not Dust, Oasis or Canyon (low gold afternoon sun,
// sand, mud brick, red rock): cold white, grey and orange under a hard blue sky, heat haze over the flat.
// world.js reads `launchpad` ({ dress, stage, thumb }) into its tables and hands every drawer ctx.kit.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, mix, rimPoints, skyRing, ball, lattice } from './kit.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));
const sc = scale;

THEMES.launchpad = {
  id: 'launchpad',
  light: { dir: norm([0.26, 0.92, 0.3]), sun: [1.04, 1.0, 0.92], sky: [0.5, 0.56, 0.68], amb: [0.38, 0.4, 0.45] },
  clear: 0x7c96b2,
  fog: [0.74, 0.78, 0.84], fogSeam: [0.1, 0.1, 0.12], desatTint: [0.9, 0.92, 0.96],
  shadow: { col: [0.5, 0.56, 0.72], strength: 0.62, len: 0.42 },
  lamp: [0.06, 0.05, 0.04],
  groundAmp: 0.05,
  ink: ink({
    ground: 0xbdb8aa, asphalt: 0x77787a, dirt: 0xa49c8a, gravel: 0x8e8a82,
    roof: 0x8a8c90, wall: 0xb4b2aa, wallB: 0x9c9a94, trim: 0x44464c,
    concrete: 0xa4a39e, crate: 0x8a7a5a, crateD: 0x5a4e3a,
    rail: 0x8a9096, tie: 0x4a4440, hazardY: 0xb89a3a, hazardK: 0x2c2c30,
    paint: 0xd8d4c4, glow: 0xffe6b0, glowCool: 0xdcecff,
    salt: 0xc4bfb0, saltL: 0xd0ccbe, saltD: 0xa8a294, crack: 0x8c867a, damp: 0x9a978e,
    conc: 0x9a9a98, concL: 0xb0b0ac, concD: 0x7a7a7a, scorch: 0x3a3634, gravelD: 0x6e6a64,
    orange: 0xa85a36, orangeD: 0x7a4028, white: 0xd6d6d2, whiteD: 0xb4b4b2, black: 0x2a2a2e,
    steel: 0x9aa0a6, steelD: 0x6c7278, yellow: 0xb89a3a, blue: 0x3e5670, glass: 0x34404c,
    rubber: 0x2e2e30, earth: 0xa89c86, earthD: 0x8a7e6a, cable: 0x5a4632, flag: 0x8a3a30,
  }),
  containers: [0x8a8c90, 0x6e7a86, 0x9a7a5a],
  weather: { fields: [
    // Heat haze shimmering low over the flat, salt dust blown along it, and the odd big slow puff of vapour.
    { kind: 'mote', count: 26, box: [46, 1.2, 34], vel: [0.8, 0.05, 0.2], size: 4.4, col: [0.92, 0.94, 0.98], alpha: 0.05 },
    { kind: 'streak', count: 90, box: [40, 1.6, 30], vel: [7, 0.05, 1.4], len: 1.8, width: 0.025, col: [0.96, 0.95, 0.9], alpha: 0.16 },
    { kind: 'mote', count: 60, box: [40, 5, 30], vel: [2.2, 0.1, 0.5], size: 0.08, col: [1, 1, 0.96], alpha: 0.3 },
  ] },
};

// ---- Ground ----------------------------------------------------------------------------------------------------

// Where the concrete is: the pad apron, the pad road, and the slab under each blockhouse.
function slabs(map, W, H) {
  return [
    [41, 23, W - 82, H - 46],                         // Pad apron round the landmark.
    [0, 29.4, W, 5.2],                               // The pad road along the middle lane.
    [4.5, 22, 9, 12], [W - 13.5, H - 34, 9, 12],      // Blockhouse slabs.
    [14, 0, 36, 5.6], [W - 50, H - 5.6, 36, 5.6],     // Tank-farm hardstanding.
  ];
}
const inRect = (r, x, z, p = 0) => x > r[0] - p && x < r[0] + r[2] + p && z > r[1] - p && z < r[1] + r[3] + p;
const crawlerZ = map => (map.decor || []).find(d => d.type === 'crawlerway')?.z ?? [];

function padGround(ctx) {
  const { map, noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const S = slabs(map, W, H), CZ = crawlerZ(map);
  return p => {
    const [x, , z] = p;
    const k = 0.92 + noise(x * 0.6, z * 0.6) * 0.12 + (rnd() - 0.5) * 0.04;
    ctx.groundWet = 0;
    if (x < 0 || z < 0 || x > W || z > H) {
      // The flat runs on to the horizon: plates of crust, a damp brown sheen in the low spots.
      const n = noise(x * 0.07, z * 0.07);
      return sc(n > 0.62 ? I.damp : n > 0.45 ? I.salt : I.saltL, k * 0.96);
    }
    if (S.some(r => inRect(r, x, z))) return sc((Math.floor(x / 4) + Math.floor(z / 4)) % 2 ? I.conc : I.concL, k);
    if (CZ.some(cz => Math.abs(z - cz) < 1.5)) return sc(rnd() < 0.5 ? I.gravel : I.gravelD, k);
    const n = noise(x * 0.14 + 3, z * 0.14);
    return sc(n > 0.66 ? I.damp : n < 0.34 ? I.saltD : n > 0.52 ? I.saltL : I.salt, k);
  };
}

function padPaint(ctx) {
  const { b, map, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const solid = (x, z, p = 0.3) => map.walls.some(w => w.kind !== 'border' && x > w.x - p && x < w.x + w.w + p && z > w.z - p && z < w.z + w.d + p);
  const S = slabs(map, W, H);
  // Salt crust plates: short dark crack segments wandering across the flat, never on concrete.
  b.setColor(I.crack);
  for (let i = 0; i < 260; i++) {
    let x = rnd() * W, z = rnd() * H, a = rnd() * Math.PI * 2;
    for (let s = 0; s < 4; s++) {
      const len = 0.8 + rnd() * 1.4, nx = x + Math.cos(a) * len, nz = z + Math.sin(a) * len;
      if (!S.some(r => inRect(r, (x + nx) / 2, (z + nz) / 2, 0.3)) && !solid(x, z, 0.1)) {
        b.quad([x, 0.04, z], [nx, 0.04, nz], [nx + Math.sin(a) * 0.07, 0.04, nz - Math.cos(a) * 0.07], [x + Math.sin(a) * 0.07, 0.04, z - Math.cos(a) * 0.07]);
      }
      x = nx; z = nz; a += (rnd() - 0.5) * 1.6;
    }
  }
  // The pad road: a dashed yellow centre line, kerbs of darker concrete.
  b.setColor(I.yellow);
  for (let x = 1; x < W - 1; x += 3.2) if (!solid(x + 0.8, 32)) b.groundRect(x, 31.92, 1.6, 0.16, 0.05);
  b.setColor(I.concD);
  for (const z of [29.4, 34.45]) for (let x = 0; x < W; x += 2) if (!solid(x + 1, z + 0.07)) b.groundRect(x, z, 1.96, 0.15, 0.045);
  // The crawlerway: two gravel tracks with river-rock edging.
  b.setColor(I.gravelD);
  for (const cz of crawlerZ(map)) for (const o of [-1.5, 1.4]) for (let x = 0; x < W; x += 1.4) if (!solid(x + 0.6, cz + o)) b.groundRect(x, cz + o, 1.3, 0.12, 0.04);
  // The apron: a painted ring and hatching round the pad, scorch out of both ends of the flame trench.
  const cx = W / 2, cz = H / 2;
  b.setColor(I.paint);
  for (let i = 0; i < 40; i++) {
    const a0 = (i / 40) * Math.PI * 2, a1 = a0 + Math.PI / 40, R = 9.6;
    const x0 = cx + Math.cos(a0) * R, z0 = cz + Math.sin(a0) * R * 0.78, x1 = cx + Math.cos(a1) * R, z1 = cz + Math.sin(a1) * R * 0.78;
    if (!solid(x0, z0, 0.1)) b.quad([x0, 0.05, z0], [x1, 0.05, z1], [x1 * 0.985 + cx * 0.015, 0.05, z1 * 0.985 + cz * 0.015], [x0 * 0.985 + cx * 0.015, 0.05, z0 * 0.985 + cz * 0.015]);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      b.setColor(sc(I.scorch, 0.9 + rnd() * 0.3));
      const len = 3 + rnd() * 3, wd = 1.2 + rnd() * 1.6, x0 = s < 0 ? 47 - len - rnd() * 1.4 : 57 + rnd() * 1.4;
      b.groundRect(x0, cz - wd / 2 + (rnd() - 0.5) * 1.6, len, wd, 0.035 + i * 0.002);
    }
  }
  // Tyre tracks on the salt and a few salt nodules.
  for (let i = 0; i < 60; i++) {
    const x = 1 + rnd() * (W - 2), z = 1 + rnd() * (H - 2);
    if (solid(x, z) || S.some(r => inRect(r, x, z, 0.4))) continue;
    b.setColor(sc(I.saltL, 1.04 + rnd() * 0.08));
    b.prismY(0, 0.08 + rnd() * 0.1, x, z, 0.18 + rnd() * 0.2, 0.05, 5, rnd() * 3);
  }
}

// ---- Drawers ---------------------------------------------------------------------------------------------------

function blockhouse(ctx, w) {
  const { b, theme, W } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const east = x > W / 2;
  // A low reinforced-concrete bunker: battered walls, a thick rounded roof, slit windows facing the pad (lit inside).
  b.setColor(I.concD);
  box3(b, x - 0.15, 0, z - 0.15, bw + 0.3, 0.4, bd + 0.3);
  b.setColor(I.conc);
  b.loft([
    [[x, 0.4, z], [x + bw, 0.4, z], [x + bw, 0.4, z + bd], [x, 0.4, z + bd]],
    [[x + 0.25, h - 0.6, z + 0.25], [x + bw - 0.25, h - 0.6, z + 0.25], [x + bw - 0.25, h - 0.6, z + bd - 0.25], [x + 0.25, h - 0.6, z + bd - 0.25]],
  ]);
  b.setColor(I.concL);
  b.prismZ(z + 0.2, z + bd - 0.2, x + bw / 2, h - 0.6, bw / 2 - 0.2, bw / 2 - 0.2, 8, Math.PI / 8);
  // Antenna farm on the roof and a blast door.
  b.setColor(I.steel);
  for (const [ox, oz, hh] of [[0.8, 1, 2.4], [bw - 1, bd - 1.2, 1.8], [bw / 2, bd / 2, 3]]) b.prismY(h - 0.4, h + hh, x + ox, z + oz, 0.05, 0.03, 4);
  b.setColor(I.orangeD);
  box3(b, east ? x - 0.06 : x + bw - 0.04, 0.4, z + bd / 2 - 0.8, 0.1, 1.9, 1.6);
  emissive(b, () => {
    b.setColor(sc(I.glowCool, 0.75));
    const fx = east ? x - 0.04 : x + bw - 0.01;
    for (const oz of [0.7, bd - 1.5]) box3(b, fx, 1.7, z + oz, 0.05, 0.28, 0.8);
    b.setColor([1, 0.2, 0.15]);
    b.prismY(h + 2.9, h + 3.1, x + bw / 2, z + bd / 2, 0.1, 0.1, 4);
  });
}

function sphereTank(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: s } = w;
  const cx = x + s / 2, cz = z + s / 2, r = s / 2 - 0.1, cy = r + 1.1;
  // White sphere on a ring of legs, a stair spiralling up the camera side, a gauge platform on top.
  b.setColor(I.steelD);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    b.prismY(0, cy, cx + Math.cos(a) * r * 0.82, cz + Math.sin(a) * r * 0.82, 0.12, 0.12, 4);
  }
  b.setColor(I.white);
  ball(b, cx, cy, cz, r, { bands: 4, sides: 12, from: 0, to: 1 });
  b.setColor(I.whiteD);
  ball(b, cx, cy, cz, r, { bands: 3, sides: 12, from: -1, to: 0 });
  b.setColor(I.blue);
  b.prismY(cy - 0.05, cy + 0.3, cx, cz, r + 0.03, r + 0.03, 12);
  b.setColor(I.steel);
  b.prismY(cy + r - 0.05, cy + r + 0.15, cx, cz, 0.9, 0.9, 8);
  b.setColor(I.trim);
  for (let i = 0; i < 9; i++) {
    const a = 0.4 + i * 0.16, y = 0.4 + i * (cy + r - 0.6) / 9;
    const rr = Math.cos(Math.asin(Math.min(0.98, Math.abs(y - cy) / (r + 0.3)))) * (r + 0.3);
    box3(b, cx + Math.cos(a) * rr - 0.3, y, cz + Math.sin(a) * rr - 0.15, 0.6, 0.06, 0.3);
  }
}

function pumpShed(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  // Corrugated steel on a block plinth, a shallow roof, louvres and a roll-up door.
  b.setColor(I.concD);
  box3(b, x, 0, z, bw, 0.4, bd);
  for (let s = 0; s < bw - 0.01; s += 0.3) {
    b.setColor(Math.round(s / 0.3) % 2 ? I.whiteD : sc(I.whiteD, 0.9));
    box3(b, x + s, 0.4, z, Math.min(0.3, bw - s), h - 0.7, bd);
  }
  b.setColor(I.steelD);
  b.loft([[[x - 0.2, h - 0.3, z - 0.2], [x - 0.2, h + 0.1, z + bd / 2], [x - 0.2, h - 0.3, z + bd + 0.2]], [[x + bw + 0.2, h - 0.3, z - 0.2], [x + bw + 0.2, h + 0.1, z + bd / 2], [x + bw + 0.2, h - 0.3, z + bd + 0.2]]]);
  b.setColor(I.orangeD);
  box3(b, x + bw / 2 - 1, 0.4, z + bd - 0.02, 2, 1.9, 0.06);
  b.setColor(I.trim);
  for (let i = 0; i < 4; i++) box3(b, x + 0.5, 1.2 + i * 0.25, z + bd, 0.9, 0.06, 0.05);
}

// The tracking station's radar dish: a concrete plinth, a turret, the dish tilted up toward the south-east sky.
function radarDish(ctx, w) {
  const { b, theme, W } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const cx = x + bw / 2, cz = z + bd / 2, east = x > W / 2;
  b.setColor(I.conc);
  box3(b, x, 0, z, bw, h - 1.2, bd);
  b.setColor(I.concD);
  box3(b, x - 0.1, h - 1.3, z - 0.1, bw + 0.2, 0.15, bd + 0.2);
  b.setColor(I.whiteD);
  b.prismY(h - 1.2, h + 0.3, cx, cz, 0.9, 0.7, 8);
  // Dish: concentric rings lofted into a shallow bowl, tilted ~40 degrees, facing south (camera side) and a little out.
  const tilt = 0.75, face = east ? -0.5 : 0.5, R = 2.4, dy = h + 1.6;
  const dir = [Math.sin(face) * Math.sin(tilt), Math.cos(tilt), Math.cos(face) * Math.sin(tilt)];
  const u = norm([Math.cos(face), 0, -Math.sin(face)]);
  const v = norm([dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]]);
  const ring = (rr, depth) => {
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pts.push([cx + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * rr + dir[0] * depth, dy + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * rr + dir[1] * depth, cz + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * rr + dir[2] * depth]);
    }
    pts.push(pts[0]);
    return pts;
  };
  b.setColor(I.white);
  b.loft([ring(0.2, -0.05), ring(R * 0.55, 0.25), ring(R, 0.7)]);
  b.setColor(I.whiteD);
  b.loft([ring(R, 0.68), ring(R * 0.55, 0.2), ring(0.2, -0.1)]);
  b.setColor(I.steelD);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p0 = [cx + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * R + dir[0] * 0.7, dy + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * R + dir[1] * 0.7, cz + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * R + dir[2] * 0.7];
    const p1 = [cx + dir[0] * 1.9, dy + dir[1] * 1.9, cz + dir[2] * 1.9];
    b.quad(p0, [p0[0], p0[1] + 0.08, p0[2]], [p1[0], p1[1] + 0.08, p1[2]], p1);
    b.quad(p1, [p1[0], p1[1] + 0.08, p1[2]], [p0[0], p0[1] + 0.08, p0[2]], p0);
  }
  b.prismY(dy - 1.2, dy, cx, cz, 0.3, 0.25, 6);
}

function uplinkHut(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  // A portable equipment shelter on blocks, a whip antenna and a small dish on the roof, a lit door lamp.
  b.setColor(I.concD);
  box3(b, x + 0.1, 0, z + 0.1, bw - 0.2, 0.3, bd - 0.2);
  b.setColor(I.white);
  box3(b, x, 0.3, z, bw, h - 0.5, bd);
  b.setColor(I.blue);
  box3(b, x - 0.02, h - 0.9, z - 0.02, bw + 0.04, 0.3, bd + 0.04);
  b.setColor(I.whiteD);
  box3(b, x - 0.1, h - 0.2, z - 0.1, bw + 0.2, 0.2, bd + 0.2);
  b.setColor(I.steelD);
  b.prismY(h, h + 3.4, x + 0.6, z + 0.6, 0.06, 0.03, 4);
  b.prismY(h, h + 0.6, x + bw - 1.2, z + bd / 2, 0.12, 0.12, 4);
  b.setColor(I.white);
  b.prismZ(z + bd / 2 + 0.05, z + bd / 2 + 0.35, x + bw - 1.2, h + 0.95, 0.15, 0.7, 10);
  b.setColor(I.trim);
  box3(b, x + 1, 0.3, z + bd - 0.02, 0.9, 1.9, 0.05);
  emissive(b, () => { b.setColor(sc(I.glow, 0.7)); box3(b, x + 1.2, 2.35, z + bd + 0.01, 0.5, 0.15, 0.06); });
}

// The landmark: the apron, the launch mount over the flame trench, the rocket and its orange service tower.
function rocketPad(ctx, w) {
  const { b, theme, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd } = w;
  const cx = x + bw / 2 + 1, cz = z + bd / 2;
  // Apron, raised, with the flame trench cut across it east-west (dark), stepped edges.
  b.setColor(I.concD);
  box3(b, x, 0, z, bw, 0.5, bd);
  b.setColor(I.conc);
  box3(b, x + 0.3, 0.5, z + 0.3, bw - 0.6, 0.35, bd - 0.6);
  b.setColor(I.scorch);
  box3(b, x - 0.02, 0.05, cz - 1.1, bw + 0.04, 0.82, 2.2);
  // Launch mount: four legs and the table.
  b.setColor(I.steelD);
  for (const [ox, oz] of [[-1.8, -1.8], [1.5, -1.8], [-1.8, 1.5], [1.5, 1.5]]) box3(b, cx + ox, 0.85, cz + oz, 0.3, 2.4, 0.3);
  b.setColor(I.steel);
  box3(b, cx - 2, 3.2, cz - 2, 4, 0.5, 4);
  // The rocket: core stage with black roll pattern bands, two strap-on boosters, fins, interstage, nose.
  const y0 = 3.7;
  b.setColor(I.white);
  b.prismY(y0, y0 + 9, cx, cz, 1.25, 1.25, 12);
  b.setColor(I.black);
  b.prismY(y0 + 2, y0 + 2.6, cx, cz, 1.27, 1.27, 12);
  b.prismY(y0 + 9, y0 + 9.6, cx, cz, 1.25, 1.1, 12);
  b.setColor(I.white);
  b.prismY(y0 + 9.6, y0 + 13, cx, cz, 1.1, 1.1, 12);
  b.setColor(I.whiteD);
  b.prismY(y0 + 13, y0 + 14.4, cx, cz, 1.1, 0.75, 12);
  b.prismY(y0 + 14.4, y0 + 15.6, cx, cz, 0.75, 0.05, 12);
  b.setColor(I.black);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.quad([cx + Math.cos(a) * 1.2, y0, cz + Math.sin(a) * 1.2], [cx + Math.cos(a) * 2.1, y0 - 0.1, cz + Math.sin(a) * 2.1], [cx + Math.cos(a) * 2.1, y0 + 1, cz + Math.sin(a) * 2.1], [cx + Math.cos(a) * 1.2, y0 + 2.2, cz + Math.sin(a) * 1.2]);
    b.quad([cx + Math.cos(a) * 1.2, y0 + 2.2, cz + Math.sin(a) * 1.2], [cx + Math.cos(a) * 2.1, y0 + 1, cz + Math.sin(a) * 2.1], [cx + Math.cos(a) * 2.1, y0 - 0.1, cz + Math.sin(a) * 2.1], [cx + Math.cos(a) * 1.2, y0, cz + Math.sin(a) * 1.2]);
  }
  for (const s of [-1, 1]) {
    const bx = cx, bz = cz + s * 1.85;
    b.setColor(I.whiteD);
    b.prismY(y0 - 0.3, y0 + 6, bx, bz, 0.55, 0.55, 8);
    b.prismY(y0 + 6, y0 + 7.2, bx, bz, 0.55, 0.05, 8);
    b.setColor(I.black);
    b.prismY(y0 - 0.6, y0 - 0.3, bx, bz, 0.4, 0.55, 8);
  }
  // Service tower on the west side of the apron: orange lattice, swing arms to the rocket, a lightning mast on top.
  const tx = x + 0.5, tz = cz - 1.3, ts = 2.6, top = 20;
  b.setColor(I.orange);
  lattice(b, tx, tz, ts, 0.85, top, { leg: 0.22, step: 2.4, brace: 0.12 });
  b.setColor(I.orangeD);
  for (const y of [4.6, 9.8, 15]) box3(b, tx, y, tz, ts, 0.18, ts);
  b.setColor(I.steelD);
  for (const y of [7.4, 13.2, 16.8]) box3(b, tx + ts, y, cz - 0.3, cx - 1.2 - tx - ts, 0.3, 0.6);
  b.prismY(top, top + 4, tx + ts / 2, tz + ts / 2, 0.08, 0.04, 4);
  emissive(b, () => {
    b.setColor([1, 0.2, 0.14]);
    for (const y of [top, 12]) b.prismY(y + 0.05, y + 0.3, tx + ts / 2, tz + ts / 2, 0.12, 0.12, 4);
    // Vented oxygen boiling off the core stage: pale streaks just under the interstage.
    b.setColor([0.66, 0.7, 0.74]);
    box3(b, cx - 1.3, y0 + 8.2, cz - 0.15, 0.1, 0.9, 0.3);
  });
  glow.halo(cx, cz, 6, [0.06, 0.06, 0.07], 0.9);
}

function padBuilding(ctx, w) {
  if (w.rocket) return rocketPad(ctx, w);
  if (w.sphere) return sphereTank(ctx, w);
  if (w.blockhouse) return blockhouse(ctx, w);
  if (w.dish) return radarDish(ctx, w);
  if (w.hut) return uplinkHut(ctx, w);
  if (w.shed) return pumpShed(ctx, w);
  return ctx.kit.building(ctx.b, w, ctx.rnd, ctx.lamps);
}

function hTank(ctx, w, wheels = false) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  const r = Math.min(cd / 2, h / 2) - 0.05, cy = h - r, cz = z + cd / 2;
  b.setColor(wheels ? I.rubber : I.concD);
  if (wheels) for (const wx of [x + 0.8, x + 1.8, x + cw - 1.2]) for (const s of [-1, 1]) b.prismZ(cz + s * (r - 0.1) - 0.15, cz + s * (r - 0.1) + 0.15, wx, 0.45, 0.45, 0.45, 8);
  else for (const wx of [x + 0.8, x + cw - 1.4]) box3(b, wx, 0, z + 0.2, 0.6, cy - r * 0.5, cd - 0.4);
  if (wheels) { b.setColor(I.steelD); box3(b, x + 0.2, 0.7, z + 0.3, cw - 0.4, 0.2, cd - 0.6); }
  b.setColor(I.white);
  b.prismX(x + 0.3, x + cw - 0.3, cy, cz, r, r, 10);
  b.setColor(I.whiteD);
  b.prismX(x, x + 0.3, cy, cz, r * 0.6, r, 10);
  b.prismX(x + cw - 0.3, x + cw, cy, cz, r, r * 0.6, 10);
  b.setColor(wheels ? I.orangeD : I.blue);
  b.prismX(x + cw * 0.3, x + cw * 0.3 + 0.25, cy, cz, r + 0.02, r + 0.02, 10);
  b.prismX(x + cw * 0.7, x + cw * 0.7 + 0.25, cy, cz, r + 0.02, r + 0.02, 10);
  b.setColor(I.trim);
  box3(b, x + cw / 2 - 0.5, h - 0.05, cz - 0.4, 1, 0.12, 0.8);
}

function crawler(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  // Four tracked trucks at the corners, the deck on top, the operator cabs at the corners, jacking cylinders.
  for (const [ox, oz] of [[0, 0], [cw - 2.4, 0], [0, cd - 1.6], [cw - 2.4, cd - 1.6]]) {
    b.setColor(I.rubber);
    box3(b, x + ox, 0, z + oz, 2.4, 1, 1.6);
    b.setColor(I.steelD);
    for (let s = 0.1; s < 2.3; s += 0.35) box3(b, x + ox + s, 0, z + oz - 0.03, 0.12, 1.02, 1.66);
  }
  b.setColor(I.steelD);
  for (const [ox, oz] of [[1, 0.5], [cw - 1.4, 0.5], [1, cd - 1], [cw - 1.4, cd - 1]]) b.prismY(1, 2, x + ox + 0.2, z + oz + 0.25, 0.35, 0.35, 6);
  b.setColor(I.orange);
  box3(b, x - 0.1, 2, z - 0.1, cw + 0.2, 1.1, cd + 0.2);
  b.setColor(I.orangeD);
  box3(b, x + 0.8, h - 0.3, z + 0.8, cw - 1.6, 0.3, cd - 1.6);
  b.setColor(I.whiteD);
  for (const [ox, oz] of [[-0.3, -0.3], [cw - 1.1, cd - 1.1]]) box3(b, x + ox, 3.1, z + oz, 1.4, 1, 1.4);
  emissive(b, () => {
    b.setColor(sc(I.glowCool, 0.6));
    box3(b, x - 0.32, 3.4, z + 0.1, 0.03, 0.4, 0.8);
    box3(b, x + cw + 0.29, 3.4, z + cd - 0.9, 0.03, 0.4, 0.8);
  });
  b.setColor(I.yellow);
  for (let s = 0.4; s < cw; s += 1.2) box3(b, x + s, 2.05, z + cd + 0.1, 0.6, 0.3, 0.03);
}

function genset(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  b.setColor(I.blue);
  box3(b, x, 0, z, cw, h - 0.2, cd);
  b.setColor(sc(I.blue, 0.8));
  for (let s = 0.3; s < cw - 0.2; s += 0.35) { box3(b, x + s, 0.2, z + cd, 0.12, h - 0.6, 0.04); box3(b, x + s, 0.2, z - 0.04, 0.12, h - 0.6, 0.04); }
  b.setColor(I.steelD);
  box3(b, x - 0.05, h - 0.2, z - 0.05, cw + 0.1, 0.2, cd + 0.1);
  b.prismY(h, h + 1, x + cw - 0.8, z + cd / 2, 0.15, 0.15, 6);
  b.setColor(I.yellow);
  box3(b, x + 0.4, 1.2, z + cd + 0.03, 1.2, 0.5, 0.03);
}

function padContainer(ctx, w) {
  if (w.tank) return hTank(ctx, w);
  if (w.trailer) return hTank(ctx, w, true);
  if (w.crawler) return crawler(ctx, w);
  if (w.genset) return genset(ctx, w);
  return ctx.kit.container(ctx.b, w, ctx.rnd);
}

function padBarrier(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd, L = long ? bw : bd;
  if (w.pipe) {
    // Pipe rack: steel bents every 1.6 m carrying three insulated pipes; you can shoot over it.
    b.setColor(I.steelD);
    for (let s = 0; s <= L - 0.15; s += Math.max(1.2, (L - 0.15) / Math.ceil(L / 1.6))) {
      if (long) box3(b, x + s, 0, z, 0.15, h - 0.15, bd); else box3(b, x, 0, z + s, bw, h - 0.15, 0.15);
    }
    const cols = [I.white, I.yellow, I.steel];
    [0.18, 0.5, 0.82].forEach((t, i) => {
      b.setColor(cols[i]);
      const r = i === 0 ? 0.17 : 0.12;
      if (long) b.prismX(x, x + bw, h - 0.15 - r, z + bd * t, r, r, 6);
      else b.prismZ(z, z + bd, x + bw * t, h - 0.15 - r, r, r, 6);
    });
    return;
  }
  // Jersey barrier: sloped concrete sections with orange-and-white reflective bands.
  for (let s = 0; s < L - 0.05; s += 1.6) {
    const n = Math.min(1.56, L - s);
    b.setColor(I.concL);
    if (long) b.loft([[[x + s, 0, z], [x + s, h * 0.3, z + 0.05], [x + s, h, z + bd * 0.32], [x + s, h, z + bd * 0.68], [x + s, h * 0.3, z + bd - 0.05], [x + s, 0, z + bd]], [[x + s + n, 0, z], [x + s + n, h * 0.3, z + 0.05], [x + s + n, h, z + bd * 0.32], [x + s + n, h, z + bd * 0.68], [x + s + n, h * 0.3, z + bd - 0.05], [x + s + n, 0, z + bd]]]);
    else b.loft([[[x + bw, 0, z + s], [x + bw - 0.05, h * 0.3, z + s], [x + bw * 0.68, h, z + s], [x + bw * 0.32, h, z + s], [x + 0.05, h * 0.3, z + s], [x, 0, z + s]], [[x + bw, 0, z + s + n], [x + bw - 0.05, h * 0.3, z + s + n], [x + bw * 0.68, h, z + s + n], [x + bw * 0.32, h, z + s + n], [x + 0.05, h * 0.3, z + s + n], [x, 0, z + s + n]]]);
    b.setColor(I.orange);
    if (long) box3(b, x + s + 0.2, h * 0.55, z + bd * 0.2, n - 0.4, 0.14, bd * 0.6);
    else box3(b, x + bw * 0.2, h * 0.55, z + s + 0.2, bw * 0.6, 0.14, n - 0.4);
  }
}

function berm(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  // A bulldozed ridge of salt and earth, crusted white on top.
  const long = bw >= bd, n = 5;
  const row = t => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, y = Math.sin(u * Math.PI) * h * (0.9 + rnd() * 0.15);
      pts.push(long ? [x + t, y, z - 0.25 + u * (bd + 0.5)] : [x - 0.25 + u * (bw + 0.5), y, z + t]);
    }
    return long ? pts.reverse() : pts;
  };
  const L = long ? bw : bd, rings = [];
  for (let t = -0.2; t <= L + 0.21; t += (L + 0.4) / 4) rings.push(row(t));
  b.setColor(I.earth);
  b.loft(rings);
  b.setColor(I.saltL);
  if (long) box3(b, x + 0.2, h - 0.12, z + bd * 0.3, bw - 0.4, 0.14, bd * 0.4);
  else box3(b, x + bw * 0.3, h - 0.12, z + 0.2, bw * 0.4, 0.14, bd - 0.4);
}

function padCrate(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  if (w.drum) {
    // Cable drum standing on edge: two flanges, a core of wound cable.
    const r = h / 2, cx = x + cw / 2;
    b.setColor(I.crate);
    for (const oz of [z + 0.1, z + cd - 0.25]) b.prismZ(oz, oz + 0.15, cx, r, r, r, 10);
    b.setColor(I.rubber);
    b.prismZ(z + 0.25, z + cd - 0.25, cx, r, r * 0.7, r * 0.7, 10);
    return;
  }
  ctx.kit.crate(ctx.b, w, ctx.rnd);
  b.setColor(I.yellow);
  box3(b, x + 0.1, h - 0.02, z + cd / 2 - 0.1, cw - 0.2, 0.04, 0.2);
}

function blastWall(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd, L = long ? bw : bd;
  // Precast T-wall panels with lifting eyes, a band of hazard stripes, numbers stencilled.
  for (let s = 0; s < L - 0.05; s += 1.2) {
    const n = Math.min(1.18, L - s);
    b.setColor((Math.round(s / 1.2) % 2) ? I.conc : sc(I.conc, 0.94));
    if (long) box3(b, x + s, 0, z, n, h, bd); else box3(b, x, 0, z + s, bw, h, n);
    b.setColor(I.yellow);
    if (long) box3(b, x + s + 0.1, h * 0.7, z - 0.02, n - 0.2, 0.18, bd + 0.04); else box3(b, x - 0.02, h * 0.7, z + s + 0.1, bw + 0.04, 0.18, n - 0.2);
  }
  b.setColor(I.concD);
  if (long) box3(b, x - 0.2, 0, z - 0.4, bw + 0.4, 0.25, bd + 0.8); else box3(b, x - 0.4, 0, z - 0.2, bw + 0.8, 0.25, bd + 0.4);
}

function lightningMast(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: mw, h } = w;
  const cx = x + mw / 2, cz = z + mw / 2;
  b.setColor(I.concD);
  box3(b, x - 0.1, 0, z - 0.1, mw + 0.2, 0.5, mw + 0.2);
  b.setColor(I.orange);
  b.prismY(0.5, h, cx, cz, 0.4, 0.16, 6);
  b.setColor(I.white);
  for (const y of [h * 0.35, h * 0.7]) b.prismY(y, y + 0.8, cx, cz, 0.4 - (y / h) * 0.24 + 0.02, 0.4 - ((y + 0.8) / h) * 0.24 + 0.02, 6);
  b.setColor(I.steel);
  b.prismY(h, h + 2.4, cx, cz, 0.05, 0.02, 4);
  emissive(b, () => { b.setColor([1, 0.2, 0.14]); b.prismY(h - 0.3, h, cx, cz, 0.2, 0.2, 4); });
}

// Perimeter: a chain-link security fence on a low kerb, posts every 3 m; beyond it the flat.
function padBorder(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const long = w.w >= w.d, L = long ? w.w : w.d;
  const inner = long ? (w.z < 0 ? w.z + w.d - 0.15 : w.z + 0.05) : (w.x < 0 ? w.x + w.w - 0.15 : w.x + 0.05);
  b.setColor(I.concD);
  if (long) box3(b, w.x, 0, inner - 0.1, L, 0.3, 0.3); else box3(b, inner - 0.1, 0, w.z, 0.3, 0.3, L);
  b.setColor(I.steelD);
  for (let s = 0; s <= L; s += 3) {
    if (long) box3(b, w.x + s, 0, inner, 0.08, 2.2, 0.08); else box3(b, inner, 0, w.z + s, 0.08, 2.2, 0.08);
  }
  b.setColor(sc(I.steel, 0.85));
  for (const y of [0.3, 2.1]) { if (long) box3(b, w.x, y, inner, L, 0.05, 0.05); else box3(b, inner, y, w.z, 0.05, 0.05, L); }
  // The mesh: a thin see-through-looking band, drawn as a few horizontal wires.
  b.setColor(sc(I.steel, 0.7));
  for (let y = 0.55; y < 2.05; y += 0.3) { if (long) box3(b, w.x, y, inner + 0.02, L, 0.015, 0.015); else box3(b, inner + 0.02, y, w.z, 0.015, 0.015, L); }
}

// ---- Decor -----------------------------------------------------------------------------------------------------

function padDecor(ctx) {
  const { b, W, H, rnd, theme } = ctx;
  const I = theme.ink;
  // Crawlerway beyond the fence: the gravel tracks run on east and west out to the assembly building on the horizon.
  for (const cz of crawlerZ(ctx.map)) {
    b.setColor(I.gravel);
    if (cz < H / 2) b.groundRect(-30, cz - 1.5, 30, 3, 0.03); else b.groundRect(W, cz - 1.5, 30, 3, 0.03);
  }
  // Far off: another pad's service tower and a huge assembly building on the salt, low dark mountains beyond.
  const far = (x, z, s) => {
    b.setColor(mix(I.whiteD, theme.fog.map(v => v), 0.4));
    box3(b, x, 0, z, 12 * s, 14 * s, 10 * s);
    b.setColor(mix(I.blue, theme.fog.map(v => v), 0.4));
    box3(b, x + 2 * s, 14 * s, z + 2 * s, 8 * s, 0.4, 6 * s);
    box3(b, x + 1 * s, 2 * s, z + 10 * s + 0.01, 3 * s, 9 * s, 0.05);
  };
  far(-40, -26, 1.4);
  far(W + 22, H + 12, 1.1);
  b.setColor(mix(I.orange, theme.fog.map(v => v), 0.45));
  lattice(b, W + 18, -24, 2.4, 0, 18, { leg: 0.2, step: 3 });
  lattice(b, -24, H + 22, 2.4, 0, 15, { leg: 0.2, step: 3 });
  // Light towers and camera stands scattered just outside the fence.
  for (const [x, z] of rimPoints(ctx, 14, 3, 12)) {
    b.setColor(I.steelD);
    b.prismY(0, 6 + rnd() * 3, x, z, 0.12, 0.08, 4);
    b.setColor(I.whiteD);
    box3(b, x - 0.6, 6, z - 0.2, 1.2, 0.6, 0.4);
  }
  // A windsock on the blockhouse slabs.
  for (const [x, z, s] of [[5, 22.4, 1], [W - 5, H - 22.4, -1]]) {
    b.setColor(I.steelD);
    b.prismY(0, 4.2, x, z, 0.05, 0.04, 4);
    b.setColor(I.orange);
    b.prismX(x, x + 1.3 * s, 4, z, 0.22, 0.12, 6);
  }
  // Mountains on the far rim, purple-grey in the haze.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, R = 120 + rnd() * 30;
    const mx = W / 2 + Math.cos(a) * R * 1.2, mz = H / 2 + Math.sin(a) * R;
    b.setColor(mix([0.5, 0.48, 0.56], theme.fog.map(v => v), 0.35 + rnd() * 0.2));
    b.prismY(-1, 8 + rnd() * 12, mx, mz, 14 + rnd() * 10, 1.5, 5, rnd() * 3);
  }
  skyRing(ctx, { low: [0.62, 0.66, 0.72], mid: [0.66, 0.76, 0.88], warm: [0.86, 0.88, 0.9], high: [0.32, 0.48, 0.7], warmDir: [0.3, 1], y0: -4, y1: 14, y2: 70 });
}

export const launchpad = {
  dress: {
    building: padBuilding, container: padContainer, barrier: padBarrier, sandbag: berm, crate: padCrate,
    wall: blastWall, crane: lightningMast, border: padBorder,
  },
  stage: { lights: () => {}, ground: padGround, paint: padPaint, decor: padDecor },
  thumb: { ground: '#c4bfb0', solid: '#7c8088', low: '#a49c88', edge: '#4a4a52' },
};
