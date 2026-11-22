// Meridian City (docs/DISTRICTS.md): the first region's palette and the pieces only a region city has, for the
// giant-world streamer in themes/frontier.js (which builds every tile; this module adds tables, a lights pass, the
// tile decor and the edge of the city to it). Blue hour: the sun just down behind the west, a deep blue sky, sodium
// streetlights and lit windows coming on, wet pavement from an afternoon shower. Each district's pieces are still drawn
// by its own 6v6 drawers (skins 'metro', 'subway', 'topside'), so Downtown looks like Downtown inside the city.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale } from './kit.js';
import { segDist } from '../../shared/maps/br-kit.js';

const H = hexRGB;
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));

THEMES.city = {
  id: 'city', giant: true,
  // Blue hour: what is left of the sun low in the west, a cold sky over everything, lamps doing the rest.
  light: { dir: norm([-0.7, 0.5, 0.3]), sun: [0.62, 0.5, 0.5], sky: [0.34, 0.38, 0.56], amb: [0.3, 0.31, 0.4] },
  clear: 0x10141f,
  fog: [0.3, 0.33, 0.48], fogSeam: [0.12, 0.08, 0.18], desatTint: [0.76, 0.8, 0.92],
  shadow: { col: [0.34, 0.34, 0.5], strength: 0.5, len: 0.9 },
  lamp: [0.44, 0.27, 0.1],
  wet: 0.6, sheen: norm([0.3, 0.8, -0.5]), sheenCol: [0.4, 0.42, 0.62],
  water: { deep: [0.03, 0.06, 0.11], shallow: [0.07, 0.13, 0.2], glint: [0.8, 0.7, 0.9] },
  ink: ink({
    ground: 0x55555c, asphalt: 0x34353e, dirt: 0x4a4644, gravel: 0x55524e,
    roof: 0x3c3d46, wall: 0x6a6470, wallB: 0x5e5a66, trim: 0x2a2a32,
    concrete: 0x76767e, crate: 0x7a6650, crateD: 0x4a3e30,
    rail: 0x6a6878, tie: 0x24222c, hazardY: 0x9a7e30, hazardK: 0x1e1c26,
    paint: 0x9a9aa4, glow: 0xffc27a, glowCool: 0xaad8ff,
    rock: 0x76747a, rockD: 0x5a5860, rockL: 0x8a8890,
  }),
  containers: [0x4a5a78, 0x7a4a3a, 0x9a7a3a, 0x3a6a62, 0x5a4a6e],
  weather: { fields: [
    { kind: 'mote', count: 60, box: [42, 6, 32], vel: [0.6, 0.1, 0.2], size: 0.08, col: [0.9, 0.86, 1.0], alpha: 0.35 },
    { kind: 'mote', count: 12, box: [48, 2.5, 36], vel: [0.8, 0.02, 0.2], size: 4, col: [0.6, 0.62, 0.8], alpha: 0.05 },
    { kind: 'ripple', count: 40, box: [34, 1, 26], life: 0.7, size: 0.5, col: [0.8, 0.78, 1.0], alpha: 0.2 },
  ] },
};

export const thumb = { ground: '#4a4a52', solid: '#8a8698', low: '#64646e', water: '#16283a', edge: '#10121a' };

// ---- Tables merged into the streamer's (themes/frontier.js) -----------------------------------------------------------

export const SKIN = { city: 'metro', yard: 'foundry', quay: 'pier' };
export const GROUND = {
  city: { a: H(0x5a5a62), b: H(0x52525a), c: H(0x64646a), amp: 0.02 },
  yard: { a: H(0x5a564e), b: H(0x4e4a44), c: H(0x66625a), amp: 0.05 },
  quay: { a: H(0x66646a), b: H(0x5c5a5e), c: H(0x707076), amp: 0.02 },
};
export const ROCK = {
  city: { cols: [H(0x6e6c72), H(0x5a5860)], cap: H(0x7a7880) },
  yard: { cols: [H(0x6a665e), H(0x56524c)], cap: H(0x76726a) },
  quay: { cols: [H(0x6a6a6e), H(0x56565a)], cap: H(0x7a7a7e) },
};
export const BANK = {
  city: { face: H(0x4a4a50), lip: H(0x7a7a80) }, yard: { face: H(0x4a4640), lip: H(0x6a665e) }, quay: { face: H(0x4a4a50), lip: H(0x8a8a8e) },
};
// Ground under a district's own street zones and the region's own places.
export const ZONE = {
  road: H(0x34353e), lot: H(0x3e3f48), site: H(0x5c5650), hall: H(0x9a968a), platform: H(0x8a877e), track: H(0x3e3a38),
  stairs: H(0x6a6a72), slab: H(0x7a7672), ballast: H(0x4e4a46), square: H(0x6e6a68), helipad: H(0x3e4048),
  pitch: H(0x3e6a34), dock: H(0x5a5a5e),
};
// Old Town's brownstones: brick and sandstone, dark trim, flat roofs behind a parapet.
export const STYLE = {
  brownstone: { wall: [0x7a4a3a, 0x8a5a44, 0x6a4034, 0x9a7a5e], trim: 0x2e2420, roof: 0x3e3a3c, floor: 0x7a5a40, floorB: 0x6a4c36, roofKind: 'flat', parapet: true, planks: true },
};

// ---- Ground: the pitch's stripes and lines, the helipad's mark, the square's paving --------------------------------

export function zoneColour(zn, x, z, c) {
  if (zn.kind === 'pitch') {
    const lx = x - zn.x, lz = z - zn.z;
    const line = Math.abs(lx - zn.w / 2) < 0.15 || lx < 0.6 || lx > zn.w - 0.6 || lz < 0.6 || lz > zn.d - 0.6
      || Math.abs(Math.hypot(lx - zn.w / 2, lz - zn.d / 2) - 7) < 0.15;
    return line ? H(0xc8ccc0) : Math.floor(lx / 5) % 2 ? c : scale(c, 1.12);
  }
  if (zn.kind === 'helipad') {
    const lx = x - zn.x - 8, lz = z - zn.z - 8, r = Math.hypot(lx, lz);
    if (Math.abs(r - 5) < 0.3 || (r < 3.6 && (Math.abs(lx) < 0.4 && Math.abs(lz) < 2.6 || Math.abs(lz) < 0.35 && Math.abs(lx) < 1.6))) return H(0xd8d4c4);
    return c;
  }
  if (zn.kind === 'square' || zn.kind === 'plaza') return (Math.floor(x / 2) + Math.floor(z / 2)) % 2 ? c : scale(c, 0.92);
  return c;
}

// ---- Lights: streetlights down the kerbs of the region's roads --------------------------------------------------------
// Every lamp of the map, worked out once (no randomness, so every tile agrees): each tile bakes the pools of the
// lamps within reach of it into its ground and draws the posts of its own, so a pool never stops at a tile edge.

const LAMP_REACH = 8;
export function lampSpots(map) {
  if (map._lampSpots) return map._lampSpots;
  const out = [];
  const inDistrict = (x, z) => (map.districts ?? []).some(d => x > d.x - 1 && x < d.x + d.w + 1 && z > d.z - 1 && z < d.z + d.h + 1);
  const blocked = (x, z) => map.walls.some(w => w.kind !== 'border' && x > w.x - 0.6 && x < w.x + w.w + 0.6 && z > w.z - 0.6 && z < w.z + w.d + 0.6);
  const onOtherRoad = (x, z, self) => (map.roads ?? []).some(r => r !== self && r.pts.some((p, i) => i > 0 && segDist(x, z, ...r.pts[i - 1], ...p) < r.w / 2 + 0.3));
  for (const rd of map.roads ?? []) {
    for (let k = 1; k < rd.pts.length; k++) {
      const [ax, az] = rd.pts[k - 1], [bx, bz] = rd.pts[k], L = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
      for (let s = 7, i = 0; s < L - 3; s += 17, i++) {
        const side = i % 2 ? 1 : -1, off = rd.w / 2 + 0.5;
        const x = ax + ux * s + nx * off * side, z = az + uz * s + nz * off * side;
        if (x < 2 || z < 2 || x > map.width - 2 || z > map.height - 2 || inDistrict(x, z) || blocked(x, z) || onOtherRoad(x, z, rd)) continue;
        out.push({ x, z, dx: -nx * side, dz: -nz * side });
      }
    }
  }
  return (map._lampSpots = out);
}

const LAMP_COL = [1.0, 0.66, 0.3];
export function lights(ctx, t, TILE) {
  for (const l of lampSpots(ctx.full)) {
    if (l.x < t.x0 - LAMP_REACH || l.x > t.x0 + TILE + LAMP_REACH || l.z < t.z0 - LAMP_REACH || l.z > t.z0 + TILE + LAMP_REACH) continue;
    ctx.lamps.push({ x: l.x + l.dx, z: l.z + l.dz, r: 7, col: [0.5, 0.3, 0.1] });
  }
}

function lampPost(ctx, l) {
  const { b, glow } = ctx;
  b.setColor(H(0x2c3038));
  b.prismY(0, 4.2, l.x, l.z, 0.09, 0.07, 6);
  const ax = l.x + l.dx * 0.5, az = l.z + l.dz * 0.5;
  box3(b, Math.min(l.x, l.x + l.dx) - 0.04, 4.1, Math.min(l.z, l.z + l.dz) - 0.04, Math.abs(l.dx) + 0.08, 0.08, Math.abs(l.dz) + 0.08);
  emissive(b, () => { b.setColor(LAMP_COL); box3(b, l.x + l.dx * 0.95 - 0.18, 3.95, l.z + l.dz * 0.95 - 0.18, 0.36, 0.12, 0.36); });
  glow.halo(l.x + l.dx, l.z + l.dz, 3.6, scale(LAMP_COL, 0.13), 0.13);
  glow.streak(ax + l.dx * 0.5, az + l.dz * 0.5 + 0.2, 0.9, 5, scale(LAMP_COL, 0.14), 0.12);
}

// ---- Tile decor: lamp posts, the El, the market's lantern strings, the station's trains, litter ------------------

export function decor(ctx, t, TILE) {
  const { b, rnd, full } = ctx;
  const x0 = t.x0, z0 = t.z0, x1 = x0 + TILE, z1 = z0 + TILE;
  const inT = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
  for (const l of lampSpots(full)) if (inT(l.x, l.z)) lampPost(ctx, l);
  for (const el of full.el ?? []) elevated(ctx, el, Math.max(x0, el.x0), Math.min(x1, el.x1), x0, x1);
  for (const s of full.strings ?? []) if (inT(s[0], (s[1] + s[2]) / 2)) lanternString(ctx, s);
  for (const tr of full.trains ?? []) if (inT(tr.x + tr.w / 2, tr.z + tr.d / 2)) train(ctx, tr);
  // Litter and kerb grit in the open.
  for (let k = 0; k < 14; k++) {
    const x = x0 + rnd() * TILE, z = z0 + rnd() * TILE;
    if (x < 1 || z < 1 || x > ctx.W - 1 || z > ctx.H - 1 || ctx.wet(x, z) || ctx.blocked(x, z, 0.3)) continue;
    b.setColor(scale(H(0x5a5860), 0.7 + rnd() * 0.4));
    b.prismY(0, 0.08 + rnd() * 0.12, x, z, 0.12 + rnd() * 0.2, 0.05, 5, rnd());
  }
}

// The El's deck over [s0, s1] of its run (clipped to the tile): open girders, cross beams, ties, rails. Mostly air
// from above, so nobody under it is hidden. `end` decks finish in a buffer stop.
function elevated(ctx, el, s0, s1) {
  if (s1 <= s0) return;
  const { b, glow, lamps } = ctx;
  const y = el.y, L = s1 - s0;
  for (const gz of [el.z0 - 0.15, el.z1 - 0.15]) {
    b.setColor(H(0x34443e));
    box3(b, s0, y - 0.16, gz, L, 0.16, 0.3);
    box3(b, s0, y - 1.0, gz, L, 0.12, 0.3);
    b.setColor(H(0x2a3632));
    for (let x = Math.ceil(s0 / 2) * 2; x < s1; x += 2) box3(b, x, y - 0.9, gz + 0.1, 0.08, 0.76, 0.1);
  }
  b.setColor(H(0x34443e));
  for (let x = Math.ceil(s0 / 6) * 6; x < s1; x += 6) box3(b, x, y - 0.32, el.z0, 0.2, 0.16, el.z1 - el.z0);
  b.setColor(H(0x3a302a));
  for (let x = Math.ceil(s0 / 1.5) * 1.5; x < s1; x += 1.5) box3(b, x, y, el.z0 + 0.3, 0.12, 0.08, el.z1 - el.z0 - 0.6);
  b.setColor(H(0x8a9098));
  for (const rz of [el.z0 + 1.6, el.z0 + 3.0, el.z1 - 3.0, el.z1 - 1.6]) box3(b, s0, y + 0.08, rz, L, 0.08, 0.06);
  if (el.end && s1 >= el.x1 - 0.01) {
    b.setColor(H(0x8a3a2a)); box3(b, el.x1 - 0.6, y + 0.08, el.z0 + 1.2, 0.5, 1.0, el.z1 - el.z0 - 2.4);
    emissive(b, () => { b.setColor([1.0, 0.25, 0.15]); box3(b, el.x1 - 0.55, y + 1.1, el.z0 + 3.6, 0.3, 0.3, 0.8); });
  }
  for (let x = Math.ceil((s0 - 8) / 24) * 24 + 8; x < s1; x += 24) {
    emissive(b, () => { b.setColor([1.0, 0.7, 0.3]); box3(b, x, y - 0.6, el.z1 + 0.16, 0.25, 0.25, 0.06); });
    glow.halo(x, el.z1 + 1.6, 3.4, [0.12, 0.07, 0.02], 0.13, 10);
    lamps.push({ x, z: el.z1 + 1.2, r: 6, col: [0.3, 0.18, 0.06] });
  }
}

// The Night Market's lantern strings over its cross-alleys (as themes/metro.js draws them on the 6v6 map).
function lanternString(ctx, [x, z0, z1]) {
  const { b, sb, glow } = ctx;
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = 4 * t * (1 - t);
    const z = z0 + (z1 - z0) * t, y = 3.5 - 0.9 * s;
    if (i < n) { b.setColor(H(0x20202a)); box3(b, x - 0.012, y, z, 0.024, 0.02, Math.abs(z1 - z0) / n); }
    sb.setPart(0.4 + (i % 4) * 0.1);
    sb.setColor(i % 2 ? [1.0, 0.45, 0.16] : [1.0, 0.25, 0.32]);
    box3(sb, x - 0.08, y - 0.2, z - 0.08, 0.16, 0.2, 0.16);
  }
  glow.halo(x, (z0 + z1) / 2, 3.2, [0.1, 0.05, 0.02], 0.12, 10);
}

// A train at Turnstile's platform: floor, seats, poles, roof frame and its strip light (themes/metro.js trains).
function train(ctx, t) {
  const { b, lamps } = ctx;
  b.setColor(H(0x30353c)); box3(b, t.x, 0, t.z + 0.3, t.w, 0.34, t.d - 0.6);
  b.setColor(H(0x3e5a6e));
  for (const sz of [t.z + 0.3, t.z + t.d - 0.75]) for (let s = t.x + 0.4; s < t.x + t.w - 1.2; s += 4.4) box3(b, s + 0.3, 0.34, sz, 1.6, 0.42, 0.45);
  b.setColor(H(0x9aa0a8));
  for (let px = t.x + 2; px < t.x + t.w - 1; px += 3) b.prismY(0.34, 2.9, px, t.z + t.d / 2, 0.035, 0.035, 4);
  b.setColor(H(0x6a7078));
  box3(b, t.x, 2.95, t.z, t.w, 0.06, 0.35);
  box3(b, t.x, 2.95, t.z + t.d - 0.35, t.w, 0.06, 0.35);
  emissive(b, () => { b.setColor([0.86, 0.94, 0.9]); box3(b, t.x + 0.6, 2.9, t.z + t.d / 2 - 0.05, t.w - 1.2, 0.04, 0.1); });
  lamps.push({ x: t.x + t.w / 2, z: t.z + t.d / 2, r: 5, col: [0.14, 0.17, 0.16] });
}

// ---- The edge of the city: more city past it (low near, taller further out, lit windows), open sea to the east ------

export function edge(ctx, w) {
  if (w.open) return;
  const { b, rnd } = ctx;
  const long = w.w > w.d;
  const out = long ? (w.z < 0 ? -1 : 1) : (w.x < 0 ? -1 : 1);
  for (let s = 0; s < (long ? w.w : w.d) - 0.5; s += 6 + rnd() * 3) {
    const len = 4 + rnd() * 3;
    // Tall lit towers only off the north edge: anything tall to the south, east or west would stand between the
    // tilted camera and the street.
    const north = long && out < 0;
    for (const [off, depth, h, lit] of [[2, 4 + rnd() * 3, 2.2 + rnd() * 1.2, false], [9, 6 + rnd() * 4, north ? 7 + rnd() * 7 : 2.6 + rnd() * 1.4, north]]) {
      const bx = long ? w.x + s : out < 0 ? w.x - off - depth : w.x + w.w + off;
      const bz = long ? (out < 0 ? w.z - off - depth : w.z + w.d + off) : w.z + s;
      const bw = long ? len : depth, bd = long ? depth : len;
      b.setColor(scale(rnd() < 0.5 ? H(0x4a4652) : H(0x5a4440), 0.55 + rnd() * 0.2));
      box3(b, bx, 0, bz, bw, h, bd);
      if (!lit) continue;
      emissive(b, () => {
        for (let y = 2; y < h - 1; y += 1.6) for (let i = 0.6; i < (long ? bw : bd) - 0.5; i += 1.5) {
          if (rnd() < 0.6) continue;
          b.setColor(rnd() < 0.6 ? scale(H(0xffc27a), 0.45) : scale(H(0xaad8ff), 0.35));
          if (long) box3(b, bx + i, y, out < 0 ? bz + bd + 0.02 : bz - 0.05, 0.6, 0.7, 0.03);
          else box3(b, out < 0 ? bx + bw + 0.02 : bx - 0.05, y, bz + i, 0.03, 0.7, 0.6);
        }
      });
    }
  }
}
