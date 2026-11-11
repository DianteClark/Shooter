// Small geometry helpers the jungle and arctic theme modules share. Same conventions as world.js: everything lands in
// the one merged MeshBuilder (ctx.b), lit once on the CPU; emissive faces skip the bake; additive glow goes in ctx.glow.
export const WATER_Y = -0.62;     // Basin surface, as world.js.

export function box3(b, x, y, z, w, h, d, ch = 0) { b.box(x + w / 2, y + h / 2, z + d / 2, w, h, d, ch); }

export function emissive(b, fn) {
  const saved = b.bake;
  b.bake = null;
  fn();
  b.bake = saved;
}

export const scale = (c, k) => c.map(v => v * k);
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// True when (x, z) is within `pad` of any wall but the border.
export function blockedAt(map, x, z, pad = 0.2) {
  for (const w of map.walls) {
    if (w.kind !== 'border' && x > w.x - pad && x < w.x + w.w + pad && z > w.z - pad && z < w.z + w.d + pad) return true;
  }
  return false;
}

// Faceted mass inside its footprint: jittered rings tapering upward, alternating two colours, a flat cap.
// `sides` per ring, `levels` rings; `taper` how far the top pulls in (0..0.45 of the short side).
export function mass(ctx, x, z, w, d, h, { cols, cap, levels = 3, taper = 0.28, jit = 0.18, sides = 0 } = {}) {
  const { b, rnd } = ctx;
  const segs = sides || Math.max(6, Math.min(11, Math.round((w + d) / 2.4)));
  const ring = (y, inset, j) => {
    const pts = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2 + 0.3;
      const rx = (w / 2 - inset) * (1 - rnd() * j), rz = (d / 2 - inset) * (1 - rnd() * j);
      pts.push([
        Math.max(x + 0.02, Math.min(x + w - 0.02, x + w / 2 + Math.cos(a) * rx * 1.3)), y,
        Math.max(z + 0.02, Math.min(z + d - 0.02, z + d / 2 + Math.sin(a) * rz * 1.3)),
      ]);
    }
    return pts;
  };
  let prev = ring(0, 0.02, 0.05);
  for (let k = 1; k <= levels; k++) {
    const t = k / levels;
    const next = ring(h * t, Math.min(w, d) * taper * t + 0.02, jit);
    b.setColor(cols[k % cols.length]);
    b.loft([prev, next]);
    prev = next;
  }
  if (cap) {
    b.setColor(cap);
    for (let j = 1; j < segs - 1; j++) b.tri([prev[0][0], h + 0.01, prev[0][2]], [prev[j][0], h + 0.01, prev[j][2]], [prev[j + 1][0], h + 0.01, prev[j + 1][2]], [prev[0][0], h - 2, prev[0][2]]);
  }
}

// A ring of additive gradient quads round the map, so a high camera sees a horizon (see skyRing in world.js).
export function skyRing(ctx, sky) {
  const { glow, W, H } = ctx;
  const cx = W / 2, cz = H / 2, R = Math.max(W, H) * 0.5 + 34, N = 28;
  const y0 = sky.y0 ?? -30, y1 = sky.y1 ?? 10, y2 = sky.y2 ?? 60;
  const wd = sky.warmDir || [-1, 0], wl = Math.hypot(wd[0], wd[1]);
  const band = a => {
    const k = Math.max(0, (Math.cos(a) * wd[0] + Math.sin(a) * wd[1]) / wl), t = k * k;
    return sky.mid.map((v, i) => v + (sky.warm[i] - v) * t);
  };
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * R * 1.25, cz + Math.sin(a0) * R], p1 = [cx + Math.cos(a1) * R * 1.25, cz + Math.sin(a1) * R];
    const m0 = band(a0), m1 = band(a1);
    glow.quad([p0[0], y0, p0[1]], [p0[0], y1, p0[1]], [p1[0], y1, p1[1]], [p1[0], y0, p1[1]], sky.low, m0, m1, sky.low);
    glow.quad([p0[0], y1, p0[1]], [p0[0], y2, p0[1]], [p1[0], y2, p1[1]], [p1[0], y1, p1[1]], m0, sky.high, sky.high, m1);
  }
}

// Points scattered round the outside of the map, `n` of them in a band `near`..`far` metres past the edge.
export function rimPoints(ctx, n, near, far) {
  const { rnd, W, H } = ctx;
  const out = [];
  for (let i = 0; i < n; i++) {
    const side = i % 4, t = rnd(), o = near + rnd() * (far - near);
    if (side === 0) out.push([-far + t * (W + 2 * far), -o]);
    else if (side === 1) out.push([-far + t * (W + 2 * far), H + o]);
    else if (side === 2) out.push([-o, -near + t * (H + 2 * near)]);
    else out.push([W + o, -near + t * (H + 2 * near)]);
  }
  return out;
}

// The banks of a water rect: a sloped face down to below the surface and a lip of `lipCol` blocks along the edge,
// skipping the edges where another water rect continues the basin.
export function waterBanks(ctx, w, { face, lip, lip2, t = 0.34 }) {
  const { b, rnd, map } = ctx;
  const waters = map.walls.filter(q => q.kind === 'water' && q !== w);
  const open = (x0, z0, x1, z1) => {
    // An edge is interior when its midpoint, nudged outward, lies in another basin.
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const ox = x0 === x1 ? (x0 === w.x ? -0.1 : 0.1) : 0, oz = z0 === z1 ? (z0 === w.z ? -0.1 : 0.1) : 0;
    return !waters.some(q => mx + ox > q.x && mx + ox < q.x + q.w && mz + oz > q.z && mz + oz < q.z + q.d);
  };
  const edge = (x0, z0, x1, z1) => {
    if (!open(x0, z0, x1, z1)) return;
    const ox = x0 === x1 ? (x0 === w.x ? -1 : 1) : 0, oz = z0 === z1 ? (z0 === w.z ? -1 : 1) : 0;
    b.setColor(face);
    b.quad([x0, 0.02, z0], [x1, 0.02, z1], [x1, WATER_Y - 0.6, z1], [x0, WATER_Y - 0.6, z0], [(x0 + x1) / 2 + ox, -0.3, (z0 + z1) / 2 + oz]);
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 0.9));
    for (let i = 0; i < n; i++) {
      const s = i / n, e = (i + 1) / n, top = 0.06 + rnd() * 0.08;
      b.setColor(scale(rnd() < 0.3 ? lip2 || lip : lip, 0.88 + rnd() * 0.2));
      const ax = x0 + (x1 - x0) * s, az = z0 + (z1 - z0) * s, bx = x0 + (x1 - x0) * e, bz = z0 + (z1 - z0) * e;
      if (oz) box3(b, Math.min(ax, bx), 0, oz < 0 ? z0 - t : z0, Math.abs(bx - ax) - 0.04, top, t);
      else box3(b, ox < 0 ? x0 - t : x0, 0, Math.min(az, bz), t, top, Math.abs(bz - az) - 0.04);
    }
  };
  edge(w.x, w.z, w.x + w.w, w.z);
  edge(w.x + w.w, w.z, w.x + w.w, w.z + w.d);
  edge(w.x + w.w, w.z + w.d, w.x, w.z + w.d);
  edge(w.x, w.z + w.d, w.x, w.z);
}
