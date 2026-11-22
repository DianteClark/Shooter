// The North (docs/DISTRICTS.md "The North"): Kaldvik and its four districts (Trawler Basin, Telemark, Ice Core,
// Spillway). A blizzard dusk: the sun is a copper smear low in the west-south-west behind a snow squall, the snow goes
// warm grey-white with long violet shadows, sodium lamps and lit windows already on, snow driving in sideways from the
// west. Deliberately not the other snow maps: no blue hour, no aurora (Frostline, Icebreaker), no polar night (Polestar),
// no alpine dawn (Observatory). Timber, falu red, ochre, research yellow, slate and concrete instead of station red.
// Two palettes: THEMES.north (the districts as 6v6 maps, world.js reads `north` = { dress, stage, thumb }) and
// THEMES.kaldvik (the region, giant: true, through the giant-world streamer in themes/frontier.js, which merges this
// module's tables and calls its `giant` extras: a lights pass, zone ground, tile decor, the edge of the world).
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, mix, mass, rimPoints, skyRing, lattice, ball, waterBanks, WATER_Y } from './kit.js';
import { valueNoise } from '../../shared/maps/br-kit.js';

const H = hexRGB;
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));

const INK = {
  ground: 0xd4d0cc, asphalt: 0x5a555a, dirt: 0x8a8380, gravel: 0x6a6462,
  roof: 0xe6e0dc, wall: 0x7a5a48, wallB: 0x6a6266, trim: 0x2e2a2c,
  concrete: 0x9a948e, crate: 0x8a6a48, crateD: 0x4e3c2c,
  rail: 0x8a8a90, tie: 0x3a3230, hazardY: 0xc0902e, hazardK: 0x26242a,
  paint: 0xd8d0c4, glow: 0xffb866, glowCool: 0xe0d8ff,
  snow: 0xe4ded8, snowD: 0xb8b0b0, snowL: 0xf0ece8, ice: 0x98b0bc, iceD: 0x5a7482, iceL: 0xc4d2d8,
  timber: 0x6a4a34, timberD: 0x45301f, timberL: 0x8a6444, falu: 0x8a2e24, faluD: 0x64221c, ochre: 0xb08a3a, cream: 0xd8ccb0,
  slate: 0x4a4650, stone: 0x7a7470, steel: 0x7a8088, steelD: 0x464c54, yellow: 0xd8a028, blue: 0x3a6a9a, orange: 0xd06a20,
  cconc: 0xa09a92, cconcD: 0x6e6a66, glass: 0x2a3040, win: 0xffc070, fir: 0x2c4034, firD: 0x203028, bark: 0x3e3028,
  birch: 0xd8d4cc, hullB: 0x2a4460, hullR: 0x9a2e22, deck: 0x6a5e50, tyre: 0x1e2024, white: 0xdcd8d4,
};
const BASE = {
  // Low copper sun in the west-south-west, through the squall: long shadows to the east.
  light: { dir: norm([-0.82, 0.38, 0.32]), sun: [0.98, 0.7, 0.5], sky: [0.42, 0.42, 0.5], amb: [0.36, 0.34, 0.37] },
  clear: 0x2a2428,
  fog: [0.56, 0.5, 0.52], fogSeam: [0.2, 0.1, 0.06], desatTint: [0.9, 0.86, 0.84],
  shadow: { col: [0.48, 0.42, 0.54], strength: 0.45, len: 1.35 },
  lamp: [0.5, 0.3, 0.12],
  groundAmp: 0.16,
  wet: 0.15,
  water: { deep: [0.02, 0.04, 0.06], shallow: [0.06, 0.09, 0.12], glint: [1.0, 0.7, 0.5] },
  ink: ink(INK),
  containers: [0x8a3a2e, 0x3e5a72, 0x9a7a3a, 0x4a5e4a, 0x6a4a5a],
  // The squall: snow driving in from the west, fine flakes, and slow soft gusts. Same pool sizes as the arctic set.
  weather: { fields: [
    { kind: 'streak', count: 130, box: [40, 3, 30], vel: [7.5, -0.8, 1.8], len: 1.3, width: 0.035, col: [1.0, 0.96, 0.94], alpha: 0.2 },
    { kind: 'mote', count: 160, box: [40, 10, 30], vel: [3.4, -1.5, 0.8], size: 0.1, col: [1.0, 0.97, 0.95], alpha: 0.6 },
    { kind: 'mote', count: 14, box: [46, 3, 34], vel: [3.0, 0.02, 0.6], size: 4.2, col: [0.92, 0.86, 0.86], alpha: 0.06 },
  ] },
};
THEMES.north = { id: 'north', ...BASE };
THEMES.kaldvik = { id: 'kaldvik', giant: true, ...BASE };

const K = ctx => ctx.theme.ink;
const C = H;

// ---- Small helpers --------------------------------------------------------------------------------------------------

function snowTop(b, k, x, y, z, w, d) { b.setColor(k.snow); box3(b, x - 0.06, y, z - 0.06, w + 0.12, 0.14, d + 0.12); }

// A gable over (x, z, w, d) from y with the ridge along the long side: two slopes, two end triangles.
function gable(b, x, z, w, d, y, rise, col, end, o = 0.3) {
  const along = w >= d, X0 = x - o, X1 = x + w + o, Z0 = z - o, Z1 = z + d + o;
  if (along) {
    const zm = z + d / 2;
    b.setColor(col); b.quad([X0, y, Z0], [X0, y + rise, zm], [X1, y + rise, zm], [X1, y, Z0], [x + w / 2, -10, zm]);
    b.setColor(scale(col, 0.9)); b.quad([X0, y, Z1], [X1, y, Z1], [X1, y + rise, zm], [X0, y + rise, zm], [x + w / 2, -10, zm]);
    b.setColor(end); b.tri([x, y, z], [x, y, z + d], [x, y + rise, zm], [x + w / 2, y, zm]); b.tri([x + w, y, z], [x + w, y + rise, zm], [x + w, y, z + d], [x + w / 2, y, zm]);
  } else {
    const xm = x + w / 2;
    b.setColor(scale(col, 0.9)); b.quad([X0, y, Z0], [X0, y, Z1], [xm, y + rise, Z1], [xm, y + rise, Z0], [xm, -10, z + d / 2]);
    b.setColor(col); b.quad([X1, y, Z0], [xm, y + rise, Z0], [xm, y + rise, Z1], [X1, y, Z1], [xm, -10, z + d / 2]);
    b.setColor(end); b.tri([x, y, z], [xm, y + rise, z], [x + w, y, z], [xm, y, z + d / 2]); b.tri([x, y, z + d], [x + w, y, z + d], [xm, y + rise, z + d], [xm, y, z + d / 2]);
  }
}

// Lit windows along the long faces (emissive), and their pools on the snow.
function windows(ctx, x, z, w, d, y, every = 1.8, lit = 0.65) {
  const { b, rnd, lamps } = ctx;
  const along = w >= d, L = along ? w : d;
  emissive(b, () => {
    for (let u = 0.9; u < L - 0.7; u += every) {
      const on = rnd() < lit;
      b.setColor(on ? [1.0, 0.72, 0.4] : [0.16, 0.16, 0.2]);
      if (along) { box3(b, x + u, y, z + d + 0.01, 0.6, 0.7, 0.03); box3(b, x + u, y, z - 0.04, 0.6, 0.7, 0.03); }
      else { box3(b, x + w + 0.01, y, z + u, 0.03, 0.7, 0.6); box3(b, x - 0.04, y, z + u, 0.03, 0.7, 0.6); }
    }
  });
  if (lamps.length < 400) lamps.push({ x: x + w / 2, z: z + d / 2 + (along ? d / 2 + 1.2 : 0), r: Math.min(5, L * 0.4), col: [0.26, 0.15, 0.06] });
}

// A horizontal tube between (ax, az) and (bx, bz) at height y, radius r (a pipe, a log, a fuselage).
function tube(b, ax, az, bx, bz, y, r, sides = 6) {
  const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L;
  const ring = (px, pz) => Array.from({ length: sides }, (_, i) => { const a = (i / sides) * Math.PI * 2; return [px + nx * Math.cos(a) * r, y + Math.sin(a) * r, pz + nz * Math.cos(a) * r]; });
  b.loft([ring(ax, az), ring(bx, bz)]);
}

// ---- Buildings ------------------------------------------------------------------------------------------------------

function chalet(ctx, w) {
  const k = K(ctx), { b } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(k.stone); box3(b, x, 0, z, bw, 0.6, bd);
  const wallH = Math.max(2.2, h - Math.min(bw, bd) * 0.42);
  b.setColor(w.lodge ? k.timberD : k.timber); box3(b, x, 0.6, z, bw, wallH - 0.6, bd);
  b.setColor(k.timberL);
  for (let y = 1.0; y < wallH; y += 0.55) box3(b, x - 0.03, y, z - 0.03, bw + 0.06, 0.06, bd + 0.06);
  windows(ctx, x, z, bw, bd, 1.3, 2.2, 0.75);
  const rise = Math.max(0.6, h - wallH);
  gable(b, x, z, bw, bd, wallH, rise, k.snowL, k.timberD, 0.45);
  b.setColor(k.timberD); box3(b, x - 0.45, wallH - 0.12, z - 0.45, bw + 0.9, 0.12, bd + 0.9);
  // Chimney with its glow.
  const cx = x + bw * 0.72, cz = z + bd * 0.35;
  b.setColor(k.stone); box3(b, cx, wallH, cz, 0.6, rise + 0.6, 0.6);
  if (w.lodge) {
    b.setColor(k.timberD); box3(b, x + 1, 2.4, z + bd, bw - 2, 0.12, 0.9);
    for (let u = x + 1; u <= x + bw - 1; u += 1.2) box3(b, u, 2.5, z + bd + 0.8, 0.08, 0.8, 0.08);
  }
}

function nordic(ctx, w, col) {
  const k = K(ctx), { b, rnd } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  const cols = [k.falu, k.ochre, k.cream, H(0x3e5a6a), k.white];
  const c = col ?? cols[Math.abs(Math.round(x * 3.7 + z * 1.3)) % cols.length];
  const wallH = Math.max(2.6, h - Math.min(bw, bd) * 0.32);
  b.setColor(k.stone); box3(b, x, 0, z, bw, 0.4, bd);
  b.setColor(c); box3(b, x, 0.4, z, bw, wallH - 0.4, bd);
  b.setColor(scale(c, 0.82));
  const along = bw >= bd;
  for (let u = 0.5; u < (along ? bw : bd); u += 0.5) { if (along) { box3(b, x + u, 0.4, z + bd, 0.05, wallH - 0.4, 0.03); box3(b, x + u, 0.4, z - 0.03, 0.05, wallH - 0.4, 0.03); } else { box3(b, x + bw, 0.4, z + u, 0.03, wallH - 0.4, 0.05); box3(b, x - 0.03, 0.4, z + u, 0.03, wallH - 0.4, 0.05); } }
  b.setColor(k.white);
  for (const [cx, cz] of [[x, z], [x + bw - 0.15, z], [x, z + bd - 0.15], [x + bw - 0.15, z + bd - 0.15]]) box3(b, cx, 0.4, cz, 0.15, wallH - 0.4, 0.15);
  for (let y = 1.2; y < wallH - 0.6; y += 2.4) windows(ctx, x, z, bw, bd, y, 1.9, 0.55 + rnd() * 0.2);
  gable(b, x, z, bw, bd, wallH, Math.max(0.8, h - wallH), k.snowL, c, 0.35);
}

function shed(ctx, w, col) {
  const k = K(ctx), { b } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  const c = col ?? k.falu;
  b.setColor(c); box3(b, x, 0, z, bw, h - 0.8, bd);
  b.setColor(scale(c, 0.75));
  const along = bw >= bd;
  for (let u = 0.3; u < (along ? bw : bd); u += 0.6) { if (along) box3(b, x + u, 0, z + bd, 0.06, h - 0.8, 0.03); else box3(b, x + bw, 0, z + u, 0.03, h - 0.8, 0.06); }
  b.setColor(k.white); box3(b, x - 0.04, h - 0.9, z - 0.04, bw + 0.08, 0.1, bd + 0.08);
  gable(b, x, z, bw, bd, h - 0.8, 0.8, k.snowL, c, 0.25);
  emissive(b, () => { b.setColor([1.0, 0.66, 0.34]); box3(b, x + bw / 2 - 0.15, h - 1.3, along ? z + bd + 0.02 : z + bd / 2, 0.3, 0.2, 0.05); });
}

function fishhall(ctx, w) {
  const k = K(ctx), { b, glow } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  const c = Math.round(x + z) % 2 ? H(0x3e5a72) : k.ochre;
  b.setColor(c); box3(b, x, 0, z, bw, h - 0.4, bd);
  b.setColor(scale(c, 0.8));
  for (let u = 0.25; u < bw; u += 0.5) { box3(b, x + u, 0.1, z + bd, 0.08, h - 0.6, 0.03); box3(b, x + u, 0.1, z - 0.03, 0.08, h - 0.6, 0.03); }
  b.setColor(k.steelD); box3(b, x + bw * 0.3, 0, z + bd + 0.02, bw * 0.4, h * 0.6, 0.04);
  gable(b, x, z, bw, bd, h - 0.4, Math.min(bw, bd) * 0.14, k.snowL, c, 0.3);
  emissive(b, () => { b.setColor([1.0, 0.8, 0.5]); box3(b, x + bw * 0.25, h - 1.0, z + bd + 0.04, bw * 0.5, 0.35, 0.04); });
  glow.halo(x + bw / 2, z + bd + 1.5, 3.4, [0.14, 0.08, 0.03]);
}

function shanty(ctx, w) {
  const k = K(ctx), { b, glow } = ctx;
  const { x, z, w: sw, d: sd, h } = w;
  const cols = [k.falu, k.yellow, k.blue, H(0x3a6a4a), k.orange];
  const c = cols[Math.abs(Math.round(x * 5 + z * 3)) % cols.length];
  b.setColor(c); box3(b, x, 0, z, sw, h - 0.5, sd);
  b.setColor(k.snowL); b.quad([x - 0.15, h - 0.5, z - 0.15], [x - 0.15, h, z + sd + 0.15], [x + sw + 0.15, h, z + sd + 0.15], [x + sw + 0.15, h - 0.5, z - 0.15], [x + sw / 2, -5, z + sd / 2]);
  b.setColor(k.steelD); b.prismY(h - 0.3, h + 0.7, x + sw * 0.75, z + sd * 0.3, 0.07, 0.07, 5);
  emissive(b, () => { b.setColor([1.0, 0.7, 0.4]); box3(b, x + sw * 0.3, 1.0, z + sd + 0.01, 0.5, 0.4, 0.03); });
  glow.halo(x + sw / 2, z + sd + 0.8, 1.8, [0.1, 0.05, 0.02]);
}

function pod(ctx, w) {
  const k = K(ctx), { b, glow } = ctx;
  const { x, z, w: pw, d: pd, h } = w;
  if (w.garage) return shed(ctx, w, k.steel);
  const lift = 0.9, c = w.corestore ? k.white : Math.round(x * 2 + z) % 2 ? k.yellow : k.blue;
  b.setColor(k.steelD);
  const along = pw >= pd, L = along ? pw : pd;
  for (let u = 0.6; u < L - 0.4; u += Math.max(2, (L - 1.2) / Math.ceil((L - 1.2) / 3))) {
    if (along) { box3(b, x + u, 0, z + 0.4, 0.22, lift, 0.22); box3(b, x + u, 0, z + pd - 0.62, 0.22, lift, 0.22); }
    else { box3(b, x + 0.4, 0, z + u, 0.22, lift, 0.22); box3(b, x + pw - 0.62, 0, z + u, 0.22, lift, 0.22); }
  }
  b.setColor(c); box3(b, x, lift, z, pw, h - lift - 0.2, pd, 0.25);
  b.setColor(scale(c, 0.8)); box3(b, x - 0.03, lift + 0.2, z - 0.03, pw + 0.06, 0.18, pd + 0.06);
  if (w.corestore) { b.setColor(k.blue); box3(b, x - 0.03, h * 0.55, z - 0.03, pw + 0.06, 0.3, pd + 0.06); }
  windows(ctx, x, z, pw, pd, lift + 1.2, 1.4, 0.8);
  snowTop(b, k, x + 0.1, h - 0.2, z + 0.1, pw - 0.2, pd - 0.2);
  b.setColor(k.steel); box3(b, x + pw * 0.7, h - 0.1, z + pd * 0.3, 0.8, 0.5, 0.8);
  glow.halo(x + pw / 2, z + pd / 2, Math.max(pw, pd) * 0.6, [0.08, 0.05, 0.02]);
}

function concreteBlock(ctx, w, o = {}) {
  const k = K(ctx), { b } = ctx;
  const { x, z, w: cw, d: cd, h } = w;
  b.setColor(k.cconcD); box3(b, x, 0, z, cw, 0.4, cd);
  b.setColor(k.cconc); box3(b, x, 0.4, z, cw, h - 0.6, cd);
  b.setColor(scale(k.cconc, 0.88)); box3(b, x - 0.05, h - 0.4, z - 0.05, cw + 0.1, 0.3, cd + 0.1);
  snowTop(b, k, x, h - 0.1, z, cw, cd);
  if (o.lit !== false) windows(ctx, x, z, cw, cd, 1.4, 2, 0.5);
}

function intake(ctx, w) {
  const k = K(ctx), { b, glow } = ctx;
  const { x, z, w: iw, d: id, h } = w, cx = x + iw / 2, cz = z + id / 2, r = Math.min(iw, id) / 2;
  b.setColor(k.cconcD); b.prismY(0, 0.8, cx, cz, r, r, 12);
  b.setColor(k.cconc); b.prismY(0.8, h - 0.4, cx, cz, r - 0.1, r - 0.25, 12);
  b.setColor(k.steelD); b.prismY(h - 0.4, h, cx, cz, r, r, 12);
  b.setColor(k.snow); b.prismY(h, h + 0.12, cx, cz, r - 0.1, r - 0.3, 12);
  b.setColor(k.yellow); box3(b, cx - 0.2, h, cz - r, 0.4, 1.2, 2 * r);
  b.setColor(k.iceL);
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; b.prismY(0, 0.4 + ctx.rnd() * 0.4, cx + Math.cos(a) * (r + 0.25), cz + Math.sin(a) * (r + 0.25), 0.3, 0.05, 4); }
  emissive(b, () => { b.setColor([1, 0.25, 0.15]); box3(b, cx - 0.1, h + 1.2, cz - 0.1, 0.2, 0.2, 0.2); });
  glow.halo(cx, cz, 2, [0.1, 0.02, 0.01], h + 1.3);
}

function gatehouse(ctx, w) {
  const k = K(ctx), { b } = ctx;
  concreteBlock(ctx, w);
  const { x, z, w: gw, d: gd, h } = w;
  b.setColor(k.yellow); box3(b, x + 0.3, h, z + gd / 2 - 0.2, gw - 0.6, 0.9, 0.4);
  b.setColor(k.steelD); for (const u of [0.4, gw - 0.6]) box3(b, x + u, h, z + 0.3, 0.2, 1.4, gd - 0.6);
}

function liftstation(ctx, w) {
  const k = K(ctx), { b, glow, lamps } = ctx;
  const { x, z, w: lw, d: ld, h } = w, cx = x + lw / 2, cz = z + ld / 2;
  b.setColor(k.cconc); box3(b, x, 0, z, lw, h - 1.4, ld);
  windows(ctx, x, z, lw, ld, 1.2, 1.2, 0.9);
  b.setColor(k.steelD); box3(b, cx - 0.25, h - 1.4, cz - 0.25, 0.5, 1.4, 0.5);
  // The bullwheel and its canopy, the haul rope going north and south.
  b.setColor(k.steel); b.prismY(h - 0.2, h, cx, cz, Math.min(lw, ld) * 0.48, Math.min(lw, ld) * 0.48, 14);
  b.setColor(k.falu); box3(b, x - 0.3, h + 0.6, z - 0.3, lw + 0.6, 0.2, ld + 0.6);
  snowTop(b, k, x - 0.25, h + 0.8, z - 0.25, lw + 0.5, ld + 0.5);
  b.setColor(k.steelD); box3(b, cx - 0.9, h - 0.1, z - 8, 0.05, 0.05, ld + 16); box3(b, cx + 0.85, h - 0.1, z - 8, 0.05, 0.05, ld + 16);
  emissive(b, () => { b.setColor([1, 0.8, 0.5]); box3(b, x + 0.2, h - 1.3, z + ld + 0.02, lw - 0.4, 0.15, 0.04); });
  lamps.push({ x: cx, z: cz + ld, r: 7, col: [0.4, 0.26, 0.1] });
  glow.halo(cx, cz, 6, [0.12, 0.07, 0.03]);
}

function steeple(ctx, w) {
  const k = K(ctx), { b, glow } = ctx;
  const { x, z, w: sw, d: sd, h } = w, cx = x + sw / 2, cz = z + sd / 2;
  b.setColor(k.white); box3(b, x, 0, z, sw, h * 0.55, sd);
  b.setColor(scale(k.white, 0.9)); box3(b, x + 0.5, h * 0.55, z + 0.5, sw - 1, h * 0.15, sd - 1);
  b.setColor(k.slate); b.prismY(h * 0.7, h + 3, cx, cz, (sw - 1) * 0.72, 0.05, 4, Math.PI / 4);
  emissive(b, () => { b.setColor([1, 0.85, 0.6]); box3(b, cx - 0.5, h * 0.42, z + sd + 0.02, 1, 1, 0.04); box3(b, cx - 0.15, h * 0.6, z + sd - 0.48, 0.3, 0.8, 0.03); });
  glow.halo(cx, cz + sd, 4, [0.12, 0.08, 0.04]);
}

function tank(ctx, w) {
  const k = K(ctx), { b } = ctx;
  const { x, z, w: tw, d: td, h } = w, cx = x + tw / 2, cz = z + td / 2, r = Math.min(tw, td) / 2 - 0.05;
  b.setColor(k.white); b.prismY(0, h - 0.4, cx, cz, r, r, 14);
  b.setColor(k.steel); for (const y of [0.8, h * 0.5]) b.prismY(y, y + 0.12, cx, cz, r + 0.03, r + 0.03, 14);
  b.setColor(k.snow); b.prismY(h - 0.4, h, cx, cz, r, r * 0.3, 14);
  b.setColor(k.falu); box3(b, cx - 1.2, h * 0.3, z + td - 0.06, 2.4, 0.8, 0.08);
  b.setColor(k.steelD); for (let y = 0.3; y < h; y += 0.6) box3(b, x + tw - 0.2, y, cz - 0.5, 0.3, 0.06, 1);
}

function radome(ctx, w) {
  const k = K(ctx), { b } = ctx;
  const { x, z, w: dw, d: dd, h } = w, cx = x + dw / 2, cz = z + dd / 2, r = Math.min(dw, dd) / 2 - 0.1;
  b.setColor(k.steelD); box3(b, x + 0.4, 0, z + 0.4, dw - 0.8, 2.2, dd - 0.8);
  b.setColor(k.white); ball(b, cx, 2.2, cz, r, { bands: 4, sides: 12, from: 0, to: 1 });
  emissive(b, () => { b.setColor([1, 0.2, 0.15]); box3(b, cx - 0.1, 2.2 + r, cz - 0.1, 0.2, 0.2, 0.2); });
}

function skijump(ctx, w) {
  const k = K(ctx), { b } = ctx;
  const { x, z, w: jw, d: jd, h } = w;
  // Highest at the north end, running down to the take-off at the south end.
  b.setColor(k.steelD);
  for (let s = 1; s < jd; s += 3) { const y = h * (1 - s / jd) + 0.6; box3(b, x + 0.6, 0, z + s, 0.25, y, 0.25); box3(b, x + jw - 0.85, 0, z + s, 0.25, y, 0.25); }
  b.setColor(k.white);
  b.quad([x, h + 0.6, z], [x, 1.2, z + jd], [x + jw, 1.2, z + jd], [x + jw, h + 0.6, z], [x + jw / 2, -10, z + jd / 2]);
  b.setColor(k.blue); box3(b, x - 0.1, h + 0.6, z - 0.2, jw + 0.2, 2.2, 1.2);
  b.setColor(k.falu); box3(b, x + 0.2, h + 2.8, z - 0.1, jw - 0.4, 0.3, 1);
}

function tower(ctx, w) {
  if (w.controltower) {
    const k = K(ctx), { b } = ctx;
    b.setColor(k.steelD); lattice(b, w.x + 0.4, w.z + 0.4, Math.min(w.w, w.d) - 0.8, 0, w.h - 2);
    b.setColor(k.white); box3(b, w.x, w.h - 2, w.z, w.w, 1.8, w.d);
    emissive(b, () => { b.setColor([0.7, 0.9, 1.0]); box3(b, w.x - 0.02, w.h - 1.6, w.z - 0.02, w.w + 0.04, 0.9, w.d + 0.04); });
    snowTop(b, k, w.x, w.h - 0.2, w.z, w.w, w.d);
    return;
  }
  nordic(ctx, w);
}

function building(ctx, w) {
  if (w.chalet || w.lodge) return chalet(ctx, w);
  if (w.shed) return shed(ctx, w);
  if (w.fishhall) return fishhall(ctx, w);
  if (w.shanty) return shanty(ctx, w);
  if (w.pod) return pod(ctx, w);
  if (w.liftstation) return liftstation(ctx, w);
  if (w.intake) return intake(ctx, w);
  if (w.gatehouse) return gatehouse(ctx, w);
  if (w.valvehouse || w.damhut) return concreteBlock(ctx, w);
  if (w.steeple) return steeple(ctx, w);
  if (w.tank) return tank(ctx, w);
  if (w.radome) return radome(ctx, w);
  if (w.skijump) return skijump(ctx, w);
  if (w.tower) return tower(ctx, w);
  return nordic(ctx, w);
}

// ---- Vehicles, boats, cargo -----------------------------------------------------------------------------------------

function container(ctx, w) {
  const k = K(ctx), { b, rnd } = ctx;
  const { x, z, w: cw, d: cd, h } = w;
  const long = cw >= cd, L = long ? cw : cd, T = long ? cd : cw;
  const bx = (u, y, v, lu, hy, lv) => long ? box3(b, x + u, y, z + v, lu, hy, lv) : box3(b, x + v, y, z + u, lv, hy, lu);
  if (w.groomer || w.snowcat) {
    b.setColor(k.tyre); bx(0.2, 0, 0, L - 0.4, 0.8, T * 0.3); bx(0.2, 0, T * 0.7, L - 0.4, 0.8, T * 0.3);
    b.setColor(w.groomer ? k.falu : k.orange); bx(L * 0.3, 0.6, 0.15, L * 0.5, h - 0.6, T - 0.3);
    b.setColor(k.glass); bx(L * 0.78, 1.4, 0.25, 0.05, 0.6, T - 0.5);
    b.setColor(w.groomer ? k.steel : k.steelD); bx(w.groomer ? L - 0.2 : 0.1, 0.1, -0.2, 0.25, 0.9, T + 0.4);
    snowTop(b, k, long ? x + L * 0.32 : x + 0.2, h - 0.05, long ? z + 0.2 : z + L * 0.32, long ? L * 0.46 : T - 0.4, long ? T - 0.4 : L * 0.46);
    return;
  }
  if (w.wagon) {
    b.setColor(k.tyre); bx(0.6, 0, 0.3, L - 1.2, 0.7, T - 0.6);
    b.setColor(H(0x4a3a34)); bx(0, 0.7, 0, L, h - 0.9, T);
    b.setColor(H(0x2a2626)); bx(0.3, h - 0.2, 0.3, L - 0.6, 0.2, T - 0.6);
    snowTop(b, k, x + 0.4, h, z + 0.4, cw - 0.8, cd - 0.8);
    return;
  }
  if (w.logs) {
    for (let i = 0; i < 6; i++) {
      const row = i < 3 ? 0 : 1, j = i % 3, r = 0.38;
      if (row && j === 2) continue;
      const v = T * (j + 0.5 + row * 0.5) / 3.2, y = r + row * r * 1.7;
      b.setColor(scale(k.bark, 0.9 + rnd() * 0.25));
      if (long) tube(b, x, z + v, x + L, z + v, y, r); else tube(b, x + v, z, x + v, z + L, y, r);
    }
    b.setColor(k.snow); bx(0.2, h - 0.1, T * 0.3, L - 0.4, 0.1, T * 0.4);
    return;
  }
  if (w.transformer) {
    b.setColor(k.steel); box3(b, x, 0, z, cw, h, cd);
    b.setColor(k.steelD); for (let u = 0.2; u < cw; u += 0.35) box3(b, x + u, 0.3, z - 0.1, 0.08, h - 0.6, cd + 0.2);
    snowTop(b, k, x, h, z, cw, cd);
    return;
  }
  const base = hexRGB(ctx.theme.containers[Math.abs(Math.round(x * 3 + z * 7)) % ctx.theme.containers.length]);
  b.setColor(base); box3(b, x, 0, z, cw, h, cd);
  b.setColor(scale(base, 0.75));
  for (let u = 0.25; u < L - 0.1; u += 0.4) bx(u, 0.1, T, 0.1, h - 0.2, 0.04);
  snowTop(b, k, x, h, z, cw, cd);
}

function hull(ctx, w) {
  const k = K(ctx), { b, glow, lamps } = ctx;
  const { x, z, w: hw, d: hd, h } = w;
  if (w.plane) {
    const cz = z + hd / 2;
    b.setColor(k.falu); tube(b, x, cz, x + hw, cz, 1.2, 0.6, 8);
    b.setColor(k.white); box3(b, x + hw * 0.35, 1.2, z - 3.5, 1.6, 0.12, hd + 7); box3(b, x + 0.2, 1.4, cz - 0.06, 1.2, 1.6, 0.12);
    b.setColor(k.tyre); box3(b, x + hw * 0.4, 0, cz - 1.2, 0.3, 0.7, 2.4);
    snowTop(b, k, x + hw * 0.35, 1.32, z - 3.4, 1.6, hd + 6.8);
    return;
  }
  // A trawler locked in the ice: dark hull with a red boot-top, a white wheelhouse aft, the gantry over the stern,
  // a mast forward. `bow` +1 points east, -1 west.
  const bow = (w.bow ?? 1) > 0, cz = z + hd / 2;
  const sx = bow ? x : x + hw, tip = bow ? x + hw : x, mid = bow ? x + hw - 3 : x + 3;
  const loft = (y0, y1, col) => {
    b.setColor(col);
    const ring = y => [[sx, y, z], [mid, y, z], [tip, y, cz], [mid, y, z + hd], [sx, y, z + hd]];
    b.loft([ring(y0), ring(y1)]);
  };
  loft(0, 0.6, k.hullR); loft(0.6, h - 0.4, k.hullB); loft(h - 0.4, h, k.white);
  b.setColor(k.deck); b.quad([sx, h + 0.01, z + 0.2], [sx, h + 0.01, z + hd - 0.2], [mid, h + 0.01, z + hd - 0.2], [mid, h + 0.01, z + 0.2], [x + hw / 2, 0, cz]);
  b.tri([mid, h + 0.01, z + 0.2], [mid, h + 0.01, z + hd - 0.2], [tip + (bow ? -0.4 : 0.4), h + 0.01, cz], [mid, 0, cz]);
  const wx = bow ? x + 1.2 : x + hw - 5.2;
  b.setColor(k.white); box3(b, wx, h, z + 0.6, 4, 2.2, hd - 1.2);
  emissive(b, () => { b.setColor([1, 0.78, 0.45]); box3(b, bow ? wx + 4.01 : wx - 0.04, h + 1.3, z + 0.9, 0.03, 0.6, hd - 1.8); });
  snowTop(b, k, wx, h + 2.2, z + 0.6, 4, hd - 1.2);
  b.setColor(k.orange); const gx = bow ? x + 0.2 : x + hw - 0.5; box3(b, gx, h, z + 0.2, 0.3, 3.2, 0.3); box3(b, gx, h, z + hd - 0.5, 0.3, 3.2, 0.3); box3(b, gx, h + 3, z + 0.2, 0.3, 0.3, hd - 0.4);
  b.setColor(k.steelD); b.prismY(h, h + 5, bow ? x + hw - 4 : x + 4, cz, 0.1, 0.06, 5);
  b.setColor(k.iceL);
  for (let u = 0.4; u < hw; u += 1.1) for (const pz of [z - 0.2, z + hd + 0.2]) b.prismY(0, 0.3 + ctx.rnd() * 0.4, x + u, pz, 0.35, 0.05, 4, ctx.rnd() * 3);
  lamps.push({ x: wx + 2, z: cz, r: 5, col: [0.3, 0.2, 0.08] });
  glow.halo(bow ? x + hw - 4 : x + 4, cz, 1.4, [0.14, 0.04, 0.02], h + 5);
}

function crane(ctx, w) {
  const k = K(ctx), { b, glow } = ctx;
  const { x, z, w: cw, d: cd, h } = w;
  if (w.derrick) {
    b.setColor(k.steel); lattice(b, x, z, Math.min(cw, cd), 0, h, { leg: 0.2, step: 1.5 });
    b.setColor(k.falu); box3(b, x - 0.2, h, z - 0.2, cw + 0.4, 0.3, cd + 0.4);
    emissive(b, () => { b.setColor([1, 0.3, 0.2]); box3(b, x + cw / 2 - 0.1, h + 0.3, z + cd / 2 - 0.1, 0.2, 0.2, 0.2); });
    glow.halo(x + cw / 2, z + cd / 2, 4, [0.12, 0.06, 0.02]);
    return;
  }
  if (w.pylon) {
    b.setColor(k.steelD); lattice(b, x, z, Math.min(cw, cd), 0, h, { leg: 0.14, step: 1.6 });
    b.setColor(k.steel); box3(b, x - 2.4, h - 1, z + cd / 2 - 0.1, cw + 4.8, 0.2, 0.2);
    return;
  }
  b.setColor(k.yellow); box3(b, x, 0, z, cw, h, cd);
  b.setColor(k.hazardK); for (let y = 0.4; y < 1.6; y += 0.6) box3(b, x - 0.02, y, z - 0.02, cw + 0.04, 0.25, cd + 0.04);
  b.setColor(k.yellow); box3(b, x - 4, h, z + cd / 2 - 0.3, cw + 8, 0.6, 0.6);
  snowTop(b, k, x - 4, h + 0.6, z + cd / 2 - 0.3, cw + 8, 0.6);
}

// ---- Walls, cover --------------------------------------------------------------------------------------------------

function fir(ctx, w) {
  const k = K(ctx), { b, rnd, glow } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2, h = w.h, s = w.towntree ? 1.6 : 1;
  b.setColor(k.bark); b.prismY(0, h * 0.25, cx, cz, 0.18 * s, 0.14 * s, 5);
  for (let i = 0; i < 3; i++) {
    const y0 = h * (0.18 + i * 0.24), y1 = y0 + h * 0.36, r = (1.5 - i * 0.38) * s;
    b.setColor(i % 2 ? k.firD : k.fir); b.prismY(y0, y1, cx, cz, r, 0.08, 6, rnd() * 2);
    b.setColor(k.snow); b.prismY(y0 + (y1 - y0) * 0.45, y0 + (y1 - y0) * 0.62, cx, cz, r * 0.6, r * 0.38, 6, rnd() * 2);
  }
  if (w.towntree) {
    emissive(b, () => { for (let i = 0; i < 22; i++) { const a = rnd() * 6.28, y = 1.5 + rnd() * (h - 2.5), r = (1 - y / h) * 2.3 * s * 0.85; b.setColor(rnd() < 0.5 ? [1, 0.75, 0.35] : [1, 0.35, 0.25]); box3(b, cx + Math.cos(a) * r - 0.06, y, cz + Math.sin(a) * r - 0.06, 0.12, 0.12, 0.12); } b.setColor([1, 0.9, 0.5]); box3(b, cx - 0.15, h, cz - 0.15, 0.3, 0.3, 0.3); });
    glow.halo(cx, cz, 6, [0.16, 0.1, 0.04]);
  }
}

function birch(ctx, w) {
  const k = K(ctx), { b, rnd } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2, h = w.h;
  b.setColor(k.birch); b.prismY(0, h * 0.8, cx, cz, 0.14, 0.08, 5);
  b.setColor(k.trim); for (let y = 0.6; y < h * 0.7; y += 0.7) box3(b, cx - 0.15, y, cz - 0.04, 0.12, 0.08, 0.08);
  b.setColor(H(0x6a5a4e)); for (let i = 0; i < 4; i++) { const a = rnd() * 6.28; b.prismY(h * 0.45, h, cx + Math.cos(a) * 0.5, cz + Math.sin(a) * 0.5, 0.6, 0.15, 5, rnd()); }
}

function wallPiece(ctx, w) {
  const k = K(ctx), { b, glow } = ctx;
  if (w.tree || w.fir) return w.birch ? birch(ctx, w) : fir(ctx, w);
  const { x, z, w: ww, d: wd, h } = w, cx = x + ww / 2, cz = z + wd / 2;
  if (w.pylon) {
    b.setColor(k.steelD); b.prismY(0, h, cx, cz, 0.32, 0.22, 6);
    b.setColor(k.steel); box3(b, cx - 1.4, h - 0.3, cz - 0.1, 2.8, 0.2, 0.2);
    for (const s of [-1.2, 1.2]) { b.setColor(k.steelD); box3(b, cx + s - 0.03, h - 1.5, cz - 0.03, 0.06, 1.2, 0.06); b.setColor(k.falu); box3(b, cx + s - 0.35, h - 1.9, cz - 0.3, 0.7, 0.4, 0.6); }
    return;
  }
  if (w.anemometer) {
    b.setColor(k.steel); b.prismY(0, h, cx, cz, 0.12, 0.06, 5);
    b.setColor(k.white); for (const a of [0, 2.1, 4.2]) box3(b, cx + Math.cos(a) * 0.4 - 0.1, h, cz + Math.sin(a) * 0.4 - 0.1, 0.2, 0.15, 0.2);
    emissive(b, () => { b.setColor([1, 0.2, 0.15]); box3(b, cx - 0.08, h + 0.2, cz - 0.08, 0.16, 0.16, 0.16); });
    glow.halo(cx, cz, 1.5, [0.1, 0.02, 0.01], h + 0.3);
    return;
  }
  if (w.snowwall) { b.setColor(k.snowD); box3(b, x, 0, z, ww, h, wd, 0.2); b.setColor(k.snow); box3(b, x + 0.05, h - 0.1, z + 0.05, ww - 0.1, 0.18, wd - 0.1, 0.06); return; }
  b.setColor(k.cconc); box3(b, x, 0, z, ww, h, wd);
  snowTop(b, k, x, h, z, ww, wd);
}

function crate(ctx, w) {
  const k = K(ctx), { b } = ctx;
  const { x, z, w: cw, d: cd, h } = w;
  if (w.drums) {
    const n = cw > 1.4 ? 3 : 2;
    for (let i = 0; i < n; i++) { const px = x + 0.4 + (i % 2) * (cw - 0.8), pz = z + 0.4 + Math.floor(i / 2) * (cd - 0.8) * (n > 2 ? 1 : 0.5); b.setColor(i % 2 ? k.blue : k.falu); b.prismY(0, h, px, pz, 0.36, 0.36, 8); b.setColor(k.snow); b.prismY(h, h + 0.05, px, pz, 0.3, 0.2, 8); }
    return;
  }
  if (w.fishbox) {
    for (let y = 0; y < h - 0.05; y += h / 3) { b.setColor(y > 0.3 ? k.blue : H(0x2e5a8a)); box3(b, x, y, z, cw, h / 3 - 0.03, cd); }
    snowTop(b, k, x, h - 0.05, z, cw, cd);
    return;
  }
  b.setColor(k.crate); box3(b, x, 0, z, cw, h, cd);
  b.setColor(k.crateD); box3(b, x - 0.02, h * 0.45, z - 0.02, cw + 0.04, 0.1, cd + 0.04);
  snowTop(b, k, x, h, z, cw, cd);
}

function barrier(ctx, w) {
  const k = K(ctx), { b, rnd } = ctx;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd, L = long ? bw : bd, T = long ? bd : bw;
  const bx = (u, y, v, lu, hy, lv) => long ? box3(b, x + u, y, z + v, lu, hy, lv) : box3(b, x + v, y, z + u, lv, hy, lu);
  if (w.sled) {
    b.setColor(k.steelD); bx(0, 0, 0.05, L, 0.12, 0.15); bx(0, 0, T - 0.2, L, 0.12, 0.15);
    b.setColor([k.falu, k.yellow, k.blue][Math.abs(Math.round(x + z)) % 3]); bx(L * 0.15, 0.2, 0.15, L * 0.7, 0.55, T - 0.3);
    b.setColor(k.tyre); bx(L * 0.25, 0.75, 0.25, L * 0.35, 0.3, T - 0.5);
    b.setColor(k.glass); bx(L * 0.68, 0.7, 0.25, 0.1, 0.4, T - 0.5);
    return;
  }
  if (w.car) {
    const c = [k.falu, H(0x2e3e52), k.white, H(0x4a4a4e), k.ochre][Math.abs(Math.round(x * 3 + z * 5)) % 5];
    b.setColor(k.tyre); bx(0.5, 0, -0.03, 0.7, 0.55, T + 0.06); bx(L - 1.2, 0, -0.03, 0.7, 0.55, T + 0.06);
    b.setColor(c); bx(0, 0.3, 0, L, 0.6, T); bx(L * 0.2, 0.9, 0.08, L * 0.62, 0.5, T - 0.16);
    b.setColor(k.glass); bx(L * 0.2 - 0.02, 0.95, 0.12, 0.05, 0.38, T - 0.24); bx(L * 0.82, 0.95, 0.12, 0.05, 0.38, T - 0.24);
    b.setColor(k.snow); bx(L * 0.22, h - 0.02, 0.1, L * 0.58, 0.1, T - 0.2);
    return;
  }
  if (w.skirack) {
    b.setColor(k.timberD); bx(0, 0, 0, 0.1, h, T); bx(L - 0.1, 0, 0, 0.1, h, T); bx(0, h - 0.1, 0, L, 0.1, T);
    for (let u = 0.25; u < L - 0.2; u += 0.22) { b.setColor([k.falu, k.blue, k.yellow, k.white][Math.floor(u * 9) % 4]); bx(u, 0, T / 2 - 0.03, 0.07, h + 0.35, 0.06); }
    return;
  }
  if (w.snowfence) { b.setColor(k.orange); for (let u = 0; u < L; u += 0.25) bx(u, 0, T / 2 - 0.02, 0.1, h, 0.04); bx(0, h * 0.3, T / 2 - 0.02, L, 0.06, 0.04); bx(0, h * 0.8, T / 2 - 0.02, L, 0.06, 0.04); return; }
  if (w.bench) { b.setColor(k.timber); bx(0, 0.4, 0, L, 0.1, T); bx(0, 0.4, 0, L, 0.5, 0.08); b.setColor(k.steelD); bx(0.15, 0, 0.1, 0.1, 0.4, T - 0.2); bx(L - 0.25, 0, 0.1, 0.1, 0.4, T - 0.2); b.setColor(k.snow); bx(0.05, 0.5, 0.05, L - 0.1, 0.06, T - 0.1); return; }
  if (w.bollard) { b.setColor(k.steelD); b.prismY(0, h, x + bw / 2, z + bd / 2, bw / 2, bw / 2.4, 8); b.setColor(k.snow); b.prismY(h, h + 0.08, x + bw / 2, z + bd / 2, bw / 2.4, bw / 4, 8); return; }
  if (w.snowman) { const cx = x + bw / 2, cz = z + bd / 2; b.setColor(k.snowL); ball(b, cx, 0.5, cz, 0.6, { bands: 3, sides: 8 }); ball(b, cx, 1.3, cz, 0.4, { bands: 3, sides: 8 }); b.setColor(k.orange); box3(b, cx - 0.04, 1.35, cz + 0.35, 0.08, 0.08, 0.25); return; }
  if (w.stall) { b.setColor(k.timber); box3(b, x, 0, z, bw, 1.0, bd); b.setColor(rnd() < 0.5 ? k.falu : H(0x3a6a4a)); box3(b, x - 0.2, h - 0.2, z - 0.2, bw + 0.4, 0.2, bd + 0.4); b.setColor(k.snow); box3(b, x - 0.15, h, z - 0.15, bw + 0.3, 0.1, bd + 0.3); emissive(b, () => { b.setColor([1, 0.75, 0.4]); box3(b, x + 0.2, h - 0.35, z + bd + 0.18, bw - 0.4, 0.1, 0.03); }); return; }
  if (w.penstock) { b.setColor(k.steelD); for (let u = 0.6; u < L; u += 2.4) bx(u, 0, 0, 0.3, h * 0.5, T); b.setColor(H(0x5a6a5e)); if (long) tube(b, x, z + bd / 2, x + bw, z + bd / 2, h * 0.55, T * 0.45, 8); else tube(b, x + bw / 2, z, x + bw / 2, z + bd, h * 0.55, T * 0.45, 8); b.setColor(k.snow); bx(0, h - 0.05, T * 0.3, L, 0.08, T * 0.4); return; }
  // Jersey barrier or dam parapet: concrete under a cap of snow.
  b.setColor(w.parapet ? k.cconc : k.concrete); bx(0, 0, 0, L, h * 0.3, T); bx(0, h * 0.3, T * 0.15, L, h * 0.7, T * 0.7);
  b.setColor(k.snow); bx(0, h, T * 0.1, L, 0.1, T * 0.8);
}

function sandbag(ctx, w) {
  const k = K(ctx), { b, rnd } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  if (w.ridge) {
    b.setColor(k.snowD); box3(b, w.x + 0.05, 0, w.z + 0.05, w.w - 0.1, w.h * 0.4, w.d - 0.1);
    for (let s = 0.3; s < L - 0.1; s += 0.55) { const cx = long ? w.x + s : w.x + T / 2, cz = long ? w.z + T / 2 : w.z + s; b.setColor(rnd() < 0.5 ? k.iceL : k.ice); b.prismY(0, w.h * (0.7 + rnd() * 0.3), cx, cz, Math.min(T * 0.5, 0.45), 0.06, 4, rnd() * 3); }
    return;
  }
  // A drift: a long soft bank, highest a third of the way along.
  b.setColor(k.snow);
  const n = Math.max(2, Math.round(L / 1.2));
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, hh = w.h * (0.55 + 0.45 * Math.sin(Math.PI * t)), cx = long ? w.x + L * t : w.x + T / 2, cz = long ? w.z + T / 2 : w.z + L * t; b.prismY(0, hh, cx, cz, Math.max(T * 0.62, L / n * 0.75), 0.2, 7, i); }
}

function rock(ctx, w) {
  const k = K(ctx);
  if (w.berg) return mass(ctx, w.x, w.z, w.w, w.d, w.h, { cols: [k.iceL, k.ice, k.white], cap: k.snowL, levels: 3, taper: 0.38, jit: 0.3, sides: 6 });
  mass(ctx, w.x, w.z, w.w, w.d, w.h, { cols: [k.slate, k.stone], cap: k.snow, levels: 3, taper: 0.3 });
}

function water(ctx, w) {
  const k = K(ctx), { b, rnd, glow } = ctx;
  if (w.fountain) {
    b.setColor(k.stone); box3(b, w.x, 0, w.z, w.w, 0.55, w.d);
    b.setColor(k.iceL); box3(b, w.x + 0.3, 0.4, w.z + 0.3, w.w - 0.6, 0.2, w.d - 0.6);
    b.setColor(k.ice); b.prismY(0.5, 1.8, w.x + w.w / 2, w.z + w.d / 2, 0.35, 0.1, 6);
    return;
  }
  if (w.crevasse) {
    waterBanks(ctx, w, { face: k.iceD, lip: k.snowL, lip2: k.iceL, t: 0.4 });
    return;
  }
  if (w.hotspring) {
    waterBanks(ctx, w, { face: k.slate, lip: k.stone, lip2: k.snow, t: 0.5 });
    for (let i = 0; i < 3; i++) glow.halo(w.x + w.w * (0.25 + i * 0.25), w.z + w.d / 2, 2.4, [0.06, 0.06, 0.06], 1.2 + i * 0.5);
    return;
  }
  waterBanks(ctx, w, { face: k.iceD, lip: k.snow, lip2: k.iceL, t: 0.45 });
  for (let i = 0; i < w.w * w.d / 3; i++) { b.setColor(rnd() < 0.5 ? k.iceL : k.snowD); b.prismY(WATER_Y - 0.02, WATER_Y + 0.05, w.x + 0.3 + rnd() * (w.w - 0.6), w.z + 0.3 + rnd() * (w.d - 0.6), 0.15 + rnd() * 0.3, 0.12, 5, rnd() * 3); }
}

function shop(ctx, w) {
  const k = K(ctx), { b } = ctx;
  const { x, z, w: sw, d: sd, h } = w;
  b.setColor(k.falu); box3(b, x, 0, z, sw, h - 0.3, sd);
  b.setColor(k.snowL); box3(b, x - 0.2, h - 0.3, z - 0.2, sw + 0.4, 0.3, sd + 0.4);
  emissive(b, () => { b.setColor([1, 0.8, 0.5]); box3(b, x + 0.3, 1.0, z + sd + 0.02, sw - 0.6, 0.6, 0.03); });
}

// The 6v6 edge: a snowbank along it, firs behind.
function border(ctx, w) {
  const k = K(ctx), { b, rnd } = ctx;
  b.setColor(k.snowD); box3(b, w.x, 0, w.z, w.w, 1.2, w.d, 0.3);
  b.setColor(k.snow); box3(b, w.x - 0.1, 1.0, w.z - 0.1, w.w + 0.2, 0.4, w.d + 0.2, 0.15);
}

export const DRESS = { building, container, hull, crane, wall: wallPiece, crate, barrier, sandbag, rock, water, shop, border };

// ---- 6v6 stages -----------------------------------------------------------------------------------------------------

const zoneAt = (map, x, z) => { let hit = null; for (const zn of map.zones ?? []) if (x > zn.x && x < zn.x + zn.w && z > zn.z && z < zn.z + zn.d) hit = zn; return hit; };

function ground(ctx) {
  const { map, noise, rnd, W, H: Hh } = ctx;
  const k = K(ctx);
  return p => {
    const [x, , z] = p;
    ctx.groundWet = 0;
    if (x < 0 || z < 0 || x > W || z > Hh) return scale(k.snow, 0.8 + noise(x * 0.15, z * 0.15) * 0.14);
    const zn = zoneAt(map, x, z);
    const n = noise(x * 0.6, z * 0.6), j = 0.93 + n * 0.1 + (rnd() - 0.5) * 0.03;
    const c = zoneGround(k, zn?.kind, x, z, noise);
    if (c) { if (zn.kind === 'road') ctx.groundWet = 0.4; else if (/ice|reservoir|tailrace|lake|river/.test(zn.kind)) ctx.groundWet = 0.5; return scale(c, j); }
    const scour = noise(x * 0.09 + 3, z * 0.09) > 0.66;
    return scale(scour ? mix(k.snow, k.snowD, 0.5) : k.ground, j + Math.sin(x * 0.7 + z * 0.25 + n * 4) * 0.02);
  };
}

// Ground under a zone, shared by the 6v6 stage and the region's zoneColour. Null: no zone of ours.
function zoneGround(k, kind, x, z, noise) {
  switch (kind) {
    case 'road': return noise(x * 0.3, z * 0.3) > 0.55 ? k.dirt : mix(k.asphalt, k.dirt, 0.35);
    case 'quay': return (Math.floor(x / 3) + Math.floor(z / 3)) % 2 ? mix(k.stone, k.snow, 0.55) : mix(k.stone, k.snow, 0.45);
    case 'ice': case 'seaice': case 'reservoir': case 'tailrace': case 'lake': case 'river': {
      const crack = Math.abs(noise(x * 0.18, z * 0.18) - 0.5) < 0.012;
      const snowy = noise(x * 0.11 + 7, z * 0.11) > (kind === 'seaice' ? 0.45 : 0.6);
      return crack ? k.iceD : snowy ? mix(k.ice, k.snow, 0.6) : k.ice;
    }
    case 'piste': return Math.floor(x * 2.2) % 2 ? k.snowL : scale(k.snowL, 0.95);
    case 'lot': return mix(k.asphalt, k.snow, 0.45);
    case 'drillpad': return (Math.floor(x / 2) + Math.floor(z / 2)) % 2 ? k.steelD : mix(k.steelD, k.snow, 0.4);
    case 'crest': return (Math.floor(z / 4)) % 2 ? k.cconc : scale(k.cconc, 0.92);
    case 'square': case 'plaza': return (Math.floor(x / 1.5) + Math.floor(z / 1.5)) % 2 ? mix(k.stone, k.snow, 0.5) : mix(k.stone, k.snow, 0.62);
    case 'runway': { const lx = z % 16; return Math.abs(lx - 8) < 0.2 && Math.floor(x / 4) % 2 ? k.yellow : mix(k.asphalt, k.snow, 0.5); }
    case 'ballast': return mix(k.gravel, k.snow, 0.35);
    default: return null;
  }
}

function lights(ctx) {
  const { map, lamps, glow, W, H: Hh } = ctx;
  ctx.northLamps = [];
  for (const l of map.lanes) for (let x = 6; x < W - 4; x += 18) {
    const z = l.z + ((x / 18) % 2 ? 3 : -3);
    if (z < 1 || z > Hh - 1 || map.walls.some(w => w.kind !== 'border' && x > w.x - 0.8 && x < w.x + w.w + 0.8 && z > w.z - 0.8 && z < w.z + w.d + 0.8)) continue;
    ctx.northLamps.push([x, z]);
    lamps.push({ x, z, r: 7, col: [0.45, 0.27, 0.1] });
    glow.halo(x, z, 4, [0.12, 0.07, 0.03]);
  }
}

function lampPost(ctx, x, z) {
  const { b } = ctx;
  b.setColor(H(0x2c2a30)); b.prismY(0, 4, x, z, 0.08, 0.06, 6);
  emissive(b, () => { b.setColor([1, 0.68, 0.34]); box3(b, x - 0.18, 3.85, z - 0.18, 0.36, 0.14, 0.36); });
}

function paint(ctx) {
  const { b, map, rnd } = ctx;
  const k = K(ctx);
  // Drifts banked on the leeward (east) side of everything standing: the wind is from the west.
  for (const w of map.walls) {
    if (!w.blocksMove || w.kind === 'border' || w.kind === 'water') continue;
    b.setColor(scale(k.snowL, 0.97));
    for (let z = w.z; z < w.z + w.d; z += 0.9) if (rnd() < 0.8) b.groundRect(w.x + w.w, z, 0.5 + rnd() * 0.6, 0.8, 0.05);
  }
  // Tyre and ski tracks along the lanes.
  b.setColor(scale(k.snowD, 0.92));
  for (const lane of map.lanes) for (let x = 1; x < ctx.W - 1; x += 0.8) {
    const zc = lane.z - 0.9 + Math.sin(x * 0.05 + lane.z) * 0.6;
    if (rnd() < 0.15 || map.walls.some(w => x > w.x - 0.2 && x < w.x + w.w + 0.2 && zc > w.z - 0.2 && zc < w.z + w.d + 2)) continue;
    b.groundRect(x, zc - 0.1, 0.7, 0.2, 0.04); b.groundRect(x, zc + 1.5, 0.7, 0.2, 0.04);
  }
}

function decor(ctx) {
  const { b, rnd, W, H: Hh } = ctx;
  const k = K(ctx);
  for (const [x, z] of ctx.northLamps ?? []) lampPost(ctx, x, z);
  // Firs and snowbanks round the outside, the far mountains, the copper glow low in the west.
  for (const [x, z] of rimPoints(ctx, 36, 2, 14)) fir(ctx, { x: x - 0.5, z: z - 0.5, w: 1, d: 1, h: 4.5 + rnd() * 2.5 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.2, R = 60 + rnd() * 40;
    const mx = W / 2 + Math.cos(a) * R * 1.3, mz = Hh / 2 + Math.sin(a) * R, hh = 8 + rnd() * 14, r0 = 10 + rnd() * 10;
    b.setColor(mix(k.slate, ctx.theme.fog, 0.5)); b.prismY(-20, hh * 0.45, mx, mz, r0 * 1.6, r0 * 0.7, 6, rnd() * 3);
    b.setColor(mix(k.snowL, ctx.theme.fog, 0.35)); b.prismY(hh * 0.45, hh, mx, mz, r0 * 0.7, 0.5, 6, rnd() * 3);
  }
  skyRing(ctx, { low: [0.3, 0.26, 0.28], mid: [0.42, 0.36, 0.4], warm: [0.9, 0.5, 0.3], high: [0.2, 0.18, 0.24], warmDir: [-1, 0.3], y0: -20, y1: 9, y2: 55 });
}

export const north = {
  dress: DRESS,
  stage: { lights, ground: c => ground(c), paint, decor },
  thumb: { ground: '#d2cbc6', solid: '#5a4a48', low: '#a8a0a0', water: '#10181e', edge: '#2a2428' },
};

// ---- The region (giant-world streamer tables and extras) ------------------------------------------------------------

export const thumb = { ground: '#c8c0bc', solid: '#6a5450', low: '#9a9494', water: '#0e161c', edge: '#2a2428' };
const REGIONS = ['kvtown', 'kvsnow', 'kvice', 'kvshelf', 'kvforest', 'kvpiste', 'kvquay', 'kvlake'];
export const SKIN = Object.fromEntries(REGIONS.map(r => [r, 'north']));
export const GROUND = {
  kvtown: { a: H(0xccc4be), b: H(0xbab2ae), c: H(0x9a928e), amp: 0.04 },
  kvsnow: { a: H(0xd8d2cc), b: H(0xc8c0bc), c: H(0xe4dfda), amp: 0.16 },
  kvice: { a: H(0xa4b4bc), b: H(0xc4ccd0), c: H(0x8aa0ac), amp: 0.03 },
  kvshelf: { a: H(0xd4d8dc), b: H(0xbcc8d0), c: H(0xe8eaec), amp: 0.08 },
  kvforest: { a: H(0xc4beb6), b: H(0xb4b0a8), c: H(0xd2ccc4), amp: 0.14 },
  kvpiste: { a: H(0xeae6e2), b: H(0xdeDad6), c: H(0xf2efec), amp: 0.06 },
  kvquay: { a: H(0xb8b2ae), b: H(0xa8a29e), c: H(0xc8c2be), amp: 0.03 },
  kvlake: { a: H(0xaab8c0), b: H(0xc8d0d4), c: H(0x94a8b2), amp: 0.02 },
};
export const ROCK = Object.fromEntries(REGIONS.map(r => [r, { cols: [H(0x5a5660), H(0x46424c)], cap: H(0xe4ded8) }]));
export const BANK = Object.fromEntries(REGIONS.map(r => [r, { face: H(0x5a7482), lip: H(0xe4ded8) }]));
// New zone kinds only (existing kinds keep their colours on the other maps; zoneColour below repaints them here).
// Ploughed roads: packed grey slush, no kerbs or paint (themes/frontier.js paints only 'asphalt' ones).
export const ROAD = { plough: H(0x8a8486) };
export const ZONE = {
  seaice: H(0xa4b4bc), river: H(0x98b0bc), piste: H(0xeae6e2), lake: H(0xa0b2bc), reservoir: H(0xa0b2bc), tailrace: H(0x98aab4),
  crest: H(0xa09a92), drillpad: H(0x5a5e66),
};
export const STYLE = {
  kvnordic: { wall: [0x8a2e24, 0xb08a3a, 0xd8ccb0, 0x3e5a6a], trim: 0xdcd8d4, roof: 0xe6e2de, floor: 0x7a5a40, floorB: 0x6a4c36, roofKind: 'gable', planks: true },
  kvchalet: { wall: [0x6a4a34, 0x5a3e2c], trim: 0x45301f, roof: 0xeae6e2, floor: 0x8a6444, floorB: 0x7a5638, roofKind: 'gable', planks: true },
  kvboathouse: { wall: [0x8a2e24, 0x3e5a72, 0xb08a3a], trim: 0xdcd8d4, roof: 0xe2ded8, floor: 0x6a6460, floorB: 0x5e5854, roofKind: 'gable' },
  kvshed: { wall: [0x7a8088, 0x8a2e24, 0x6a6a62], trim: 0x464c54, roof: 0xdcd8d4, floor: 0x5e5c58, floorB: 0x56544f, roofKind: 'ridged' },
  kvlab: { wall: [0xd8a028, 0x3a6a9a, 0xdcd8d4], trim: 0x464c54, roof: 0xe4e0dc, floor: 0x6a7078, floorB: 0x5e646c, roofKind: 'flat', snow: true },
  kvplant: { wall: [0xa09a92, 0x8e8880], trim: 0x6e6a66, roof: 0xd8d4d0, floor: 0x6a6662, floorB: 0x5e5a56, roofKind: 'flat', parapet: true, snow: true },
  kvchurch: { wall: [0xe0dcd4], trim: 0x4a4650, roof: 0x4a4650, floor: 0x8a6444, floorB: 0x7a5638, roofKind: 'gable', planks: true },
  kvhall: { wall: [0xc8a878, 0xb89868], trim: 0xdcd8d4, roof: 0xe0dcd8, floor: 0x7a6a5a, floorB: 0x6a5a4c, roofKind: 'hip' },
};

// Street lamps along the region's roads, worked out once per map (no randomness, so every tile agrees).
const LAMP_REACH = 8;
function lampSpots(map) {
  if (map._kvLamps) return map._kvLamps;
  const out = [];
  const blocked = (x, z) => map.walls.some(w => w.kind !== 'border' && x > w.x - 0.6 && x < w.x + w.w + 0.6 && z > w.z - 0.6 && z < w.z + w.d + 0.6);
  for (const rd of map.roads ?? []) {
    if (rd.kind !== 'plough' || rd.w < 7) continue;
    for (let k = 1; k < rd.pts.length; k++) {
      const [ax, az] = rd.pts[k - 1], [bx, bz] = rd.pts[k], L = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
      for (let s = 8, i = 0; s < L - 4; s += 22, i++) {
        const side = i % 2 ? 1 : -1, off = rd.w / 2 + 0.5;
        const x = ax + ux * s + nx * off * side, z = az + uz * s + nz * off * side;
        if (x < 2 || z < 2 || x > map.width - 2 || z > map.height - 2 || blocked(x, z)) continue;
        out.push({ x, z });
      }
    }
  }
  return (map._kvLamps = out);
}

function gLights(ctx, t, TILE) {
  for (const l of lampSpots(ctx.full)) {
    if (l.x < t.x0 - LAMP_REACH || l.x > t.x0 + TILE + LAMP_REACH || l.z < t.z0 - LAMP_REACH || l.z > t.z0 + TILE + LAMP_REACH) continue;
    ctx.lamps.push({ x: l.x, z: l.z, r: 7, col: [0.5, 0.3, 0.11] });
  }
}

const VN = valueNoise(7717);
function zoneColour(zn, x, z, c) {
  const k = THEMES.kaldvik.ink;
  return zoneGround(k, zn.kind, x, z, VN) ?? c;
}

function gDecor(ctx, t, TILE) {
  const { b, rnd, full, W, H: Hh, glow } = ctx;
  const x0 = t.x0, z0 = t.z0, x1 = x0 + TILE, z1 = z0 + TILE;
  const inT = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
  for (const l of lampSpots(full)) if (inT(l.x, l.z)) { lampPost(ctx, l.x, l.z); glow.halo(l.x, l.z, 3.4, [0.12, 0.07, 0.03]); }
  const k = THEMES.kaldvik.ink;
  for (let i = 0; i < 16; i++) {
    const x = x0 + rnd() * TILE, z = z0 + rnd() * TILE;
    const out = x < -1 || z < -1 || x > W + 1 || z > Hh + 1;
    if (out) {
      if (z < 0) continue;                       // The open sea to the north.
      if (x > W) { if (i % 3 === 0) mass(ctx, x - 2, z - 2, 4 + rnd() * 4, 4 + rnd() * 4, 1 + rnd() * 2, { cols: [k.iceL, k.white], cap: k.snowL, levels: 2 }); continue; }
      if (i % 2 === 0) fir(ctx, { x, z, w: 1, d: 1, h: 4.5 + rnd() * 3 });
      continue;
    }
    if (ctx.wet(x, z) || ctx.road(x, z) || ctx.blocked(x, z, 0.4)) continue;
    b.setColor(scale(k.snowL, 0.95 + rnd() * 0.06)); b.prismY(0, 0.15 + rnd() * 0.25, x, z, 0.5 + rnd() * 0.7, 0.15, 5, rnd());
  }
  // Steam off the hot springs.
  for (const w of ctx.map.walls) if (w.hotspring && inT(w.x + w.w / 2, w.z + w.d / 2)) for (let i = 0; i < 4; i++) glow.halo(w.x + w.w / 2 + (rnd() - 0.5) * 2, w.z + w.d / 2, 2 + rnd() * 2, [0.05, 0.05, 0.05], 0.6 + i * 0.7);
}

// The edge of Kaldvik: open sea to the north (nothing), mountains to the south and west, the shelf's ice cliffs east.
function gEdge(ctx, w) {
  if (w.open) return;
  const { rnd } = ctx;
  const k = THEMES.kaldvik.ink;
  const long = w.w > w.d, L = long ? w.w : w.d;
  const east = !long && w.x > 0;
  for (let s = 0; s < L - 0.5; s += 6) {
    const len = Math.min(6.5, L - s), hh = east ? 2.4 + rnd() * 1.4 : 3 + rnd() * 3;
    const cols = east ? [k.iceL, k.white, k.ice] : [k.slate, k.stone];
    if (long) mass(ctx, w.x + s, w.z + (w.z < 0 ? -3 : 0), len, w.d + 3, hh, { cols, cap: k.snowL, levels: 2, jit: 0.3 });
    else mass(ctx, w.x + (w.x < 0 ? -3 : 0), w.z + s, w.w + 3, len, hh, { cols, cap: k.snowL, levels: 2, jit: 0.3 });
  }
}

export const giant = { lights: gLights, zoneColour, decor: gDecor, edge: gEdge };
