// Pure 2D collision and visibility helpers on the XZ plane. No allocations on hot paths
// beyond the small result object returned by a successful raycast. Every query goes through a spatial grid over the
// walls (below), so its cost follows the walls near it, not the size of the map.

// Ray vs one axis-aligned rectangle (slab test). On a hit fills HIT and returns true; no allocation,
// because this runs for every wall on every line-of-sight check.
const HIT = { t: 0, axis: 0, sign: 0 };
function rayRect(ox, oz, dx, dz, r) {
  let tmin = 0, tmax = Infinity, axis = -1, sign = 0;
  if (Math.abs(dx) < 1e-9) {
    if (ox < r.x || ox > r.x + r.w) return false;
  } else {
    let t1 = (r.x - ox) / dx, t2 = (r.x + r.w - ox) / dx, s = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < r.z || oz > r.z + r.d) return false;
  } else {
    let t1 = (r.z - oz) / dz, t2 = (r.z + r.d - oz) / dz, s = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  // Origin strictly inside: the ray starts in the wall, so it hits at once. On the face it is leaving.
  if (axis === -1) {
    if (ox <= r.x || ox >= r.x + r.w || oz <= r.z || oz >= r.z + r.d) return false;
    HIT.t = 0; HIT.axis = Math.abs(dx) >= Math.abs(dz) ? 0 : 1;
    HIT.sign = HIT.axis === 0 ? (-Math.sign(dx) || -1) : (-Math.sign(dz) || -1);
    return true;
  }
  HIT.t = tmin; HIT.axis = axis; HIT.sign = sign;
  return true;
}

// ---- Wall grid -------------------------------------------------------------------------------------------------
// map.walls stays the source of truth; this is an index over it, built once per walls array (maps are static) and
// cached. Each GRID_CELL square cell lists, in ascending order, the walls whose rectangle grown by GRID_PAD touches
// it. The pad absorbs floating-point error at cell edges, so every query below returns exactly what the old loop over
// every wall returned: candidates are visited in wall-index order wherever order matters, and ray hits tie-break on
// the lower index, as the old first-wins loop did. dev/perf-geometry.mjs checks this against the brute-force code.
const GRID_CELL = 8;
const GRID_PAD = 0.05;
const GRIDS = new WeakMap();

class WallGrid {
  constructor(walls) {
    this.walls = walls;
    this.n = walls.length;
    this.last = walls[walls.length - 1];
    let x0 = 0, z0 = 0, x1 = 1, z1 = 1;
    for (const w of walls) {
      if (w.x < x0) x0 = w.x; if (w.z < z0) z0 = w.z;
      if (w.x + w.w > x1) x1 = w.x + w.w; if (w.z + w.d > z1) z1 = w.z + w.d;
    }
    this.x0 = Math.floor(x0 - 1); this.z0 = Math.floor(z0 - 1);
    this.nx = Math.ceil((x1 + 1 - this.x0) / GRID_CELL); this.nz = Math.ceil((z1 + 1 - this.z0) / GRID_CELL);
    this.x1 = this.x0 + this.nx * GRID_CELL; this.z1 = this.z0 + this.nz * GRID_CELL;
    const cells = this.nx * this.nz, count = new Int32Array(cells + 1);
    const span = (w, f) => {
      const i0 = this.ci(w.x - GRID_PAD), i1 = this.ci(w.x + w.w + GRID_PAD);
      const j0 = this.cj(w.z - GRID_PAD), j1 = this.cj(w.z + w.d + GRID_PAD);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * this.nx + i);
    };
    for (const w of walls) span(w, c => count[c + 1]++);
    for (let c = 0; c < cells; c++) count[c + 1] += count[c];
    this.start = count;
    this.items = new Int32Array(count[cells]);
    const fill = count.slice(0, cells);
    walls.forEach((w, k) => span(w, c => { this.items[fill[c]++] = k; }));
    this.stamp = new Uint32Array(walls.length);
    this.mark = 0;
  }
  ci(x) { const i = Math.floor((x - this.x0) / GRID_CELL); return i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i; }
  cj(z) { const j = Math.floor((z - this.z0) / GRID_CELL); return j < 0 ? 0 : j >= this.nz ? this.nz - 1 : j; }
  _next() {
    if (++this.mark === 0xffffffff) { this.stamp.fill(0); this.mark = 1; }
    return this.mark;
  }
}

// The grid for this map's walls, built on first use. Walls pushed onto map.walls later (a Bulwark's cover, see
// equipment.js syncCover) are the tail past g.n: every query adds them, after the grid's own (they have the highest
// indices, so wall order holds), and they may be spliced out again freely. Anything else (a wall below g.n removed,
// a new array) rebuilds the grid; checking that costs two comparisons.
export function wallGrid(map) {
  const walls = map.walls;
  let g = GRIDS.get(walls);
  if (!g || walls.length < g.n || (g.n > 0 && walls[g.n - 1] !== g.last)) { g = new WallGrid(walls); GRIDS.set(walls, g); }
  return g;
}

// Sorts out[0..n) ascending. Candidate lists are short (a few cells' worth), so insertion sort wins.
function sortIdx(out, n) {
  for (let i = 1; i < n; i++) {
    const v = out[i];
    let j = i - 1;
    while (j >= 0 && out[j] > v) { out[j + 1] = out[j]; j--; }
    out[j + 1] = v;
  }
}

// Indices (ascending, each once) of every wall that may touch the box [x0,x1] x [z0,z1]: a superset of the walls that
// do. `out` is an Int32Array with room for map.walls.length entries (see wallScratch). Returns the count.
export function wallsInBox(map, x0, z0, x1, z1, out) {
  const g = wallGrid(map), { items, start, stamp, nx } = g, mark = g._next();
  const i0 = g.ci(x0), i1 = g.ci(x1), j0 = g.cj(z0), j1 = g.cj(z1);
  let n = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = j * nx + i;
      for (let k = start[c], e = start[c + 1]; k < e; k++) {
        const w = items[k];
        if (stamp[w] === mark) continue;
        stamp[w] = mark; out[n++] = w;
      }
    }
  }
  if (i0 !== i1 || j0 !== j1) sortIdx(out, n);
  for (let k = g.n; k < map.walls.length; k++) out[n++] = k;
  return n;
}

// A scratch index buffer big enough for any wallsInBox / wallsOnRay answer on this map. Callers keep their own, so
// queries made inside each other's loops never share one.
export function wallScratch(map, prev = null) {
  const n = Math.max(16, map.walls.length);
  return prev && prev.length >= n ? prev : new Int32Array(n);
}

// Amanatides-Woo walk over the cells a ray crosses, as module state so the hot loops need no closures. rayBegin
// clips the ray [0, maxT] to the grid and returns false when it misses it; then rCell is the current cell, and
// rayStep moves to the next one and returns the ray parameter where it enters (NaN once off the grid, so every
// `t <= limit` loop test fails, an infinite limit included).
let rG = null, rI = 0, rJ = 0, rSX = 0, rSZ = 0, rTX = 0, rTZ = 0, rDX = 0, rDZ = 0, rCell = 0;
function rayBegin(g, ox, oz, dx, dz, maxT) {
  let t0 = 0, t1 = maxT;
  if (dx === 0) { if (ox < g.x0 || ox > g.x1) return false; } else {
    let a = (g.x0 - ox) / dx, b = (g.x1 - ox) / dx;
    if (a > b) { const q = a; a = b; b = q; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
  }
  if (dz === 0) { if (oz < g.z0 || oz > g.z1) return false; } else {
    let a = (g.z0 - oz) / dz, b = (g.z1 - oz) / dz;
    if (a > b) { const q = a; a = b; b = q; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
  }
  if (t0 > t1) return false;
  rG = g;
  rI = g.ci(ox + dx * t0); rJ = g.cj(oz + dz * t0);
  rSX = dx > 0 ? 1 : -1; rSZ = dz > 0 ? 1 : -1;
  rTX = dx > 0 ? (g.x0 + (rI + 1) * GRID_CELL - ox) / dx : dx < 0 ? (g.x0 + rI * GRID_CELL - ox) / dx : Infinity;
  rTZ = dz > 0 ? (g.z0 + (rJ + 1) * GRID_CELL - oz) / dz : dz < 0 ? (g.z0 + rJ * GRID_CELL - oz) / dz : Infinity;
  rDX = dx !== 0 ? GRID_CELL / Math.abs(dx) : Infinity;
  rDZ = dz !== 0 ? GRID_CELL / Math.abs(dz) : Infinity;
  rCell = rJ * g.nx + rI;
  return true;
}
function rayStep() {
  let t;
  if (rTX < rTZ) { t = rTX; rI += rSX; rTX += rDX; } else { t = rTZ; rJ += rSZ; rTZ += rDZ; }
  if (t === Infinity || rI < 0 || rJ < 0 || rI >= rG.nx || rJ >= rG.nz) return NaN;
  rCell = rJ * rG.nx + rI;
  return t;
}

// Indices (ascending, each once) of every wall that may touch the segment from (ox, oz) along the normalised
// direction for maxT metres: a superset of the walls it crosses. Returns the count.
export function wallsOnRay(map, ox, oz, dx, dz, maxT, out) {
  if (!(maxT <= Infinity)) maxT = Infinity;      // An undefined reach limits nothing, as in a loop over every wall.
  const g = wallGrid(map);
  let n = 0;
  if (rayBegin(g, ox, oz, dx, dz, maxT)) {
    const { items, start, stamp } = g, mark = g._next();
    for (let t = 0; t <= maxT;) {
      for (let k = start[rCell], e = start[rCell + 1]; k < e; k++) {
        const w = items[k];
        if (stamp[w] === mark) continue;
        stamp[w] = mark; out[n++] = w;
      }
      t = rayStep();
    }
    sortIdx(out, n);
  }
  for (let k = g.n; k < map.walls.length; k++) out[n++] = k;
  return n;
}

// Casts against walls for which wall[flag] is true ('blocksBullet' | 'blocksVision' | 'blocksMove').
// (dirX, dirZ) must be normalised. Returns {t,x,z,nx,nz,wall} or null when nothing is hit within maxDist.
// Walks the wall grid along the ray and stops once a hit is nearer than the next cell; the nearest hit wins, the lower
// wall index on a tie, which is what one pass over every wall in order gives.
export function raycastMap(map, ox, oz, dirX, dirZ, maxDist, flag = 'blocksBullet') {
  const g = wallGrid(map);
  const walls = map.walls;
  let bestI = -1, bestT = maxDist, bestAxis = 0, bestSign = 0;
  if (rayBegin(g, ox, oz, dirX, dirZ, maxDist)) {
    const { items, start, stamp } = g, mark = g._next();
    for (let t = 0; t <= maxDist && t <= bestT;) {
      for (let k = start[rCell], e = start[rCell + 1]; k < e; k++) {
        const i = items[k];
        if (stamp[i] === mark) continue;
        stamp[i] = mark;
        const w = walls[i];
        if (!w[flag]) continue;
        if (rayRect(ox, oz, dirX, dirZ, w) && (HIT.t < bestT || (HIT.t === bestT && bestI >= 0 && i < bestI))) {
          bestT = HIT.t; bestI = i; bestAxis = HIT.axis; bestSign = HIT.sign;
        }
      }
      t = rayStep();
    }
  }
  // Walls added since the grid was built come last in wall order, so a tie never goes to them.
  for (let i = g.n; i < walls.length; i++) {
    const w = walls[i];
    if (w[flag] && rayRect(ox, oz, dirX, dirZ, w) && HIT.t < bestT) { bestT = HIT.t; bestI = i; bestAxis = HIT.axis; bestSign = HIT.sign; }
  }
  if (bestI < 0) return null;
  return { t: bestT, x: ox + dirX * bestT, z: oz + dirZ * bestT,
           nx: bestAxis === 0 ? bestSign : 0, nz: bestAxis === 1 ? bestSign : 0, wall: walls[bestI] };
}

// True when segment a-b passes through a smoke cloud ({x,z,r}). A viewer at a inside a cloud can see out
// of that cloud, but a target at b inside one stays hidden from outside it.
export function smokeBlocks(smokes, ax, az, bx, bz) {
  if (!smokes || !smokes.length) return false;
  const dx = bx - ax, dz = bz - az, lenSq = dx * dx + dz * dz;
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i];
    if ((ax - s.x) ** 2 + (az - s.z) ** 2 <= s.r * s.r) continue;
    const u = lenSq > 0 ? Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.z - az) * dz) / lenSq)) : 0;
    const px = ax + dx * u - s.x, pz = az + dz * u - s.z;
    if (px * px + pz * pz <= s.r * s.r) return true;
  }
  return false;
}

// True when nothing that blocks vision (or smoke) lies between a and b. Any one wall settles it, so the walk stops at
// the first hit.
export function hasLineOfSight(map, ax, az, bx, bz, smokes) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const ux = dx / len, uz = dz / len;
  const g = wallGrid(map);
  if (rayBegin(g, ax, az, ux, uz, len)) {
    const walls = map.walls, { items, start, stamp } = g, mark = g._next();
    for (let t = 0; t <= len;) {
      for (let k = start[rCell], e = start[rCell + 1]; k < e; k++) {
        const i = items[k];
        if (stamp[i] === mark) continue;
        stamp[i] = mark;
        const w = walls[i];
        if (w.blocksVision && rayRect(ax, az, ux, uz, w) && HIT.t < len) return false;
      }
      t = rayStep();
    }
  }
  const walls = map.walls;
  for (let i = g.n; i < walls.length; i++) {
    const w = walls[i];
    if (w.blocksVision && rayRect(ax, az, ux, uz, w) && HIT.t < len) return false;
  }
  return !smokeBlocks(smokes, ax, az, bx, bz);
}

// Distance along a normalised ray to a circle, or -1 for a miss.
export function rayCircle(ox, oz, dirX, dirZ, cx, cz, radius) {
  const fx = cx - ox, fz = cz - oz;
  const along = fx * dirX + fz * dirZ;
  if (along < 0) return -1;
  const perpSq = fx * fx + fz * fz - along * along;
  const rSq = radius * radius;
  if (perpSq > rSq) return -1;
  return Math.max(0, along - Math.sqrt(rSq - perpSq));
}

// Pushes pos ({x,z}, mutated) out of every movement-blocking wall and keeps it on the map.
// Each pass visits, in wall order, only the walls near where the pass starts (RESOLVE_SLACK metres around the circle).
// Should a push carry the centre further than that within one pass, the pass is redone over every wall, so the answer
// is always exactly the old one.
const RESOLVE_SLACK = 2;
let NEAR = new Int32Array(16);
export function resolveCircle(map, pos, radius) {
  const walls = map.walls;
  if (NEAR.length < walls.length) NEAR = new Int32Array(walls.length);
  // Works on locals and writes pos back once: the same arithmetic as before, without a store per push.
  let px = pos.x, pz = pos.z;
  for (let pass = 0; pass < 3; pass++) {
    const sx = px, sz = pz, m = radius + RESOLVE_SLACK;
    let n = wallsInBox(map, sx - m, sz - m, sx + m, sz + m, NEAR), all = false, moved = false;
    for (let k = 0; k < n; k++) {
      const w = walls[all ? k : NEAR[k]];
      if (!w.blocksMove) continue;
      const nx = Math.max(w.x, Math.min(px, w.x + w.w));
      const nz = Math.max(w.z, Math.min(pz, w.z + w.d));
      const dx = px - nx, dz = pz - nz;
      const dSq = dx * dx + dz * dz;
      if (dSq >= radius * radius) continue;
      moved = true;
      if (dSq > 1e-9) {
        const d = Math.sqrt(dSq);
        px = nx + (dx / d) * radius;
        pz = nz + (dz / d) * radius;
      } else {            // Centre is inside the wall: leave by the nearest edge.
        const l = px - w.x, r = w.x + w.w - px, t = pz - w.z, b = w.z + w.d - pz;
        const e = Math.min(l, r, t, b);
        if (e === l) px = w.x - radius;
        else if (e === r) px = w.x + w.w + radius;
        else if (e === t) pz = w.z - radius;
        else pz = w.z + w.d + radius;
      }
      // Carried out of the walls this pass looked at: start the pass again over every wall.
      if (!all && (Math.abs(px - sx) > RESOLVE_SLACK || Math.abs(pz - sz) > RESOLVE_SLACK)) {
        px = sx; pz = sz; moved = false; all = true; n = walls.length; k = -1;
      }
    }
    if (!moved) break;
  }
  pos.x = Math.max(radius, Math.min(map.width - radius, px));
  pos.z = Math.max(radius, Math.min(map.height - radius, pz));
  return pos;
}
