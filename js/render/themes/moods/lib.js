// Helpers the per-map moods (ROADMAP 53) share. Same rules as every theme module: everything lands in the one merged
// world mesh (ctx.b) or the glow batch (ctx.glow), so a mood adds triangles, never draw calls. Nothing here stands in
// walkable space: new solids sit on top of blocking pieces, outside the border, or lie flat on the ground.
import { hexRGB } from '../../art.js';
import { box3, emissive, scale, ball } from '../kit.js';

export { box3, emissive, scale, ball, hexRGB };
export const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
export const rgb = c => (typeof c === 'number' ? hexRGB(c) : c);
export const mid = w => [w.x + w.w / 2, w.z + w.d / 2];
export const flagged = (map, f) => map.walls.filter(w => w[f]);
export const first = (map, f) => map.walls.find(w => w[f]);
export const ofKind = (map, k) => map.walls.filter(w => w.kind === k);
export const inMap = (ctx, x, z) => x > 0 && z > 0 && x < ctx.W && z < ctx.H;
export const blocked = (map, x, z, pad = 0.2) =>
  map.walls.some(w => w.kind !== 'border' && x > w.x - pad && x < w.x + w.w + pad && z > w.z - pad && z < w.z + w.d + pad);
// The wall nearest the middle of the map among `list` (by default every blocking non-border piece).
export function central(map, list = map.walls.filter(w => w.kind !== 'border' && w.kind !== 'water')) {
  let best = null, bd = 1e9;
  for (const w of list) {
    const [x, z] = mid(w), d = Math.hypot(x - map.width / 2, z - map.height / 2);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}
export const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// A lit point: an emissive block, a soft halo below it and (optionally) a baked lamp pool. `pool` is its radius.
export function beacon(ctx, x, y, z, col, { size = 0.22, halo = 1.6, pool = 0, haloY = 0.16 } = {}) {
  const c = rgb(col);
  emissive(ctx.b, () => { ctx.b.setColor(c); box3(ctx.b, x - size / 2, y - size / 2, z - size / 2, size, size, size); });
  if (halo) ctx.glow.halo(x, z, halo, scale(c, 0.12), haloY);
  if (pool) ctx.lamps.push({ x, z, r: pool, col: scale(c, 0.4) });
}

// Additive halo high up (a lamp seen from above, a sign's bloom).
export const bloom = (ctx, x, y, z, r, col) => ctx.glow.halo(x, z, r, rgb(col), y, 10);

// A water tower: four legs, a cross brace, a banded tank and a cone roof. (x, z) is the centre, y its foot.
export function waterTower(ctx, x, y, z, { r = 1.2, legs = 2.4, tank = 1.8, col, band, roof, leg } = {}) {
  const b = ctx.b, L = r * 0.75;
  b.setColor(rgb(leg));
  for (const [ox, oz] of [[-L, -L], [L, -L], [-L, L], [L, L]]) box3(b, x + ox - 0.08, y, z + oz - 0.08, 0.16, legs, 0.16);
  box3(b, x - L, y + legs * 0.5, z - L - 0.04, 2 * L, 0.08, 0.08);
  box3(b, x - L, y + legs * 0.5, z + L - 0.04, 2 * L, 0.08, 0.08);
  b.setColor(rgb(col));
  b.prismY(y + legs, y + legs + tank, x, z, r, r, 10);
  b.setColor(rgb(band));
  b.prismY(y + legs + tank * 0.42, y + legs + tank * 0.58, x, z, r + 0.04, r + 0.04, 10);
  b.setColor(rgb(roof));
  b.prismY(y + legs + tank, y + legs + tank + r * 0.6, x, z, r + 0.12, 0.08, 10);
}

// A lattice mast of `h` metres with a blinking-red top (the red ambient light is the blink: ambient.js flickers lamps).
export function mast(ctx, x, y, z, h, col, { lamp = [1, 0.18, 0.12] } = {}) {
  const b = ctx.b;
  b.setColor(rgb(col));
  b.prismY(y, y + h, x, z, 0.16, 0.06, 4);
  for (let k = 1; k < 4; k++) box3(b, x - 0.35 + k * 0.04, y + h * k / 4, z - 0.03, 0.7 - k * 0.08, 0.05, 0.06);
  beacon(ctx, x, y + h + 0.1, z, lamp, { size: 0.18, halo: 0.9, haloY: y + h });
}

// Bunting: a line of little pennants from a to b at height y, sagging in the middle. Thin, high and see-through
// from above, so it reads as dressing and never as cover.
export function bunting(ctx, ax, az, bx, bz, y, cols, { sag = 0.6, step = 0.55, size = 0.32 } = {}) {
  const b = ctx.b, L = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(L / step));
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  b.setColor([0.16, 0.15, 0.15]);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const y0 = y - Math.sin(t0 * Math.PI) * sag, y1 = y - Math.sin(t1 * Math.PI) * sag;
    b.tri([ax + (bx - ax) * t0, y0, az + (bz - az) * t0], [ax + (bx - ax) * t1, y1, az + (bz - az) * t1], [ax + (bx - ax) * t1, y1 + 0.03, az + (bz - az) * t1]);
  }
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, yy = y - Math.sin(t * Math.PI) * sag;
    b.setColor(rgb(cols[i % cols.length]));
    const hx = ux * size * 0.5, hz = uz * size * 0.5;
    b.tri([x - hx, yy, z - hz], [x + hx, yy, z + hz], [x, yy - size, z], [x, yy - 0.2, z - 2]);
    b.tri([x + hx, yy, z + hz], [x - hx, yy, z - hz], [x, yy - size, z], [x, yy - 0.2, z + 2]);
  }
}

// A string of lamps (festoon) from a to b: glowing beads on a dark cord, each with a little bloom.
export function festoon(ctx, ax, az, bx, bz, y, col, { sag = 0.5, step = 1.1, pool = 0 } = {}) {
  const L = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(L / step)), c = rgb(col);
  const b = ctx.b;
  b.setColor([0.12, 0.12, 0.13]);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    b.tri([ax + (bx - ax) * t0, y - Math.sin(t0 * Math.PI) * sag, az + (bz - az) * t0], [ax + (bx - ax) * t1, y - Math.sin(t1 * Math.PI) * sag, az + (bz - az) * t1],
      [ax + (bx - ax) * t1, y - Math.sin(t1 * Math.PI) * sag + 0.03, az + (bz - az) * t1]);
  }
  for (let i = 1; i < n; i++) {
    const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, yy = y - Math.sin(t * Math.PI) * sag - 0.06;
    emissive(b, () => { b.setColor(c); box3(b, x - 0.07, yy - 0.07, z - 0.07, 0.14, 0.14, 0.14); });
    ctx.glow.halo(x, z, 0.55, scale(c, 0.16), yy, 8);
    if (pool && i % 2) ctx.lamps.push({ x, z, r: pool, col: scale(c, 0.3) });
  }
}

// A flat painted disc on a roof or the ground (a helipad ring, a mosaic): `rings` [[r0, r1, colour], ...].
export function disc(ctx, x, y, z, rings, segs = 20) {
  const b = ctx.b;
  for (const [r0, r1, col] of rings) {
    b.setColor(rgb(col));
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const p = (r, a) => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
      if (r0 <= 0) b.tri(p(0, 0), p(r1, a1), p(r1, a0));
      else { b.tri(p(r0, a0), p(r1, a1), p(r1, a0)); b.tri(p(r0, a0), p(r0, a1), p(r1, a1)); }
    }
  }
}

// A smokestack or chimney: a tapered prism with a dark lip. Pair it with an ambient `smoke` emitter at its top.
export function stack(ctx, x, y, z, h, r, col, lip) {
  const b = ctx.b;
  b.setColor(rgb(col));
  b.prismY(y, y + h, x, z, r, r * 0.82, 8);
  b.setColor(rgb(lip));
  b.prismY(y + h - 0.25, y + h, x, z, r * 0.9, r * 0.9, 8);
}

// Little flat bits on open ground (litter, leaves, petals, ballast), kept off walls and objectives.
export function scatter(ctx, n, cols, { size = 0.18, y = 0.035, where = null, pad = 0.15 } = {}) {
  const { b, rnd, map, W, H } = ctx;
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, z = rnd() * H;
    if (where && !where(x, z)) continue;
    if (blocked(map, x, z, pad)) continue;
    b.setColor(scale(rgb(cols[i % cols.length]), 0.85 + rnd() * 0.25));
    const a = rnd() * 3.14, s = size * (0.7 + rnd() * 0.6);
    const ca = Math.cos(a) * s, sa = Math.sin(a) * s;
    b.tri([x - ca, y, z - sa], [x + sa * 0.6, y, z - ca * 0.6], [x + ca, y, z + sa]);
  }
}

// Points round a wall's footprint, `off` metres outside it, `step` apart: where to tuck clutter against cover.
export function hug(w, off, step) {
  const out = [];
  for (let x = w.x + step / 2; x < w.x + w.w; x += step) out.push([x, w.z - off], [x, w.z + w.d + off]);
  for (let z = w.z + step / 2; z < w.z + w.d; z += step) out.push([w.x - off, z], [w.x + w.w + off, z]);
  return out;
}
