// Battle royale map kit (docs/BR.md): what the giant map is assembled from. Runs in node (sim, validator) and the
// browser (renderer). A Plan collects walls like any map, plus what only a battle royale map has:
//   enterable buildings  walls with door gaps and windows, an inside partition on the bigger ones, furniture flush
//                        against the walls, a floor (rooms) and a roof (roofs) the renderer cuts away round the player
//   loot and chests      spots on the floor of every room (indoor) and round each place's cover (outdoor), tiered
//   roads, rails, rivers what the renderer paints, and where the open-field scatter keeps clear of
// Every piece carries the region it stands in (`region`); a piece dressed by another region's drawer says so (`skin`).
import { wall } from './build.js';
import { PLAYER_RADIUS } from '../constants.js';

export const WALL_T = 0.5;          // Building wall thickness.
export const DOOR = 2.4;            // Door gap: the nav grid (1 m cells, clearance PLAYER_RADIUS + 0.2) always finds a cell.
export const WINDOW = 1.6;
const GAP = 2 * PLAYER_RADIUS + 0.1;   // Two blocking pieces closer than this (but not touching) trap a player.
const CELL = 8;                     // Spatial index cell for placement checks.

export function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise, 0..1, the same in node and the browser.
export function valueNoise(seed) {
  const rnd = mulberry(seed);
  const size = 64, grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const at = (x, z) => grid[((z & (size - 1)) * size) | (x & (size - 1))];
  return (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z);
    let fx = x - xi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const a = at(xi, zi), b = at(xi + 1, zi), c = at(xi, zi + 1), d = at(xi + 1, zi + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}

// Region of a point: the nearest seed (each region has several), on coordinates warped by noise so borders wander.
// Returns [region, other, t]: `other` the runner-up and t (0..0.5) how much of it shows at the border (for blending).
export function regionField(seeds, blend = 18) {
  const n = valueNoise(4242);
  const names = [...new Set(seeds.map(s => s[0]))];
  const best = new Float64Array(names.length);
  const idx = seeds.map(s => names.indexOf(s[0]));
  const out = ['', '', 0];
  return (x, z) => {
    const wx = x + (n(x * 0.018, z * 0.018) - 0.5) * 46, wz = z + (n(x * 0.018 + 17, z * 0.018 + 5) - 0.5) * 46;
    best.fill(Infinity);
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i], d = Math.hypot(wx - s[1], wz - s[2]) - (s[3] ?? 0);
      if (d < best[idx[i]]) best[idx[i]] = d;
    }
    let a = 0, b = -1;
    for (let k = 1; k < names.length; k++) if (best[k] < best[a]) a = k;
    for (let k = 0; k < names.length; k++) if (k !== a && (b < 0 || best[k] < best[b])) b = k;
    out[0] = names[a]; out[1] = names[b];
    out[2] = 0.5 * Math.max(0, 1 - (best[b] - best[a]) / blend);
    return out;
  };
}

// Distance from (x, z) to the segment a-b.
export function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

export class Plan {
  constructor(W, H, seed = 1) {
    this.W = W; this.H = H;
    this.walls = []; this.rooms = []; this.roofs = []; this.loot = []; this.chests = [];
    this.pois = []; this.roads = []; this.rails = []; this.zones = [];
    this.region = 'farmland'; this.tier = 3; this.skin = null;
    this.rnd = mulberry(seed);
    this.cells = new Map();
  }

  // ---- Pieces ------------------------------------------------------------------------------------------------

  add(x, z, w, d, h, kind, extra = {}) {
    const o = wall(+x.toFixed(2), +z.toFixed(2), +w.toFixed(2), +d.toFixed(2), h, kind, { region: this.region, ...(this.skin ? { skin: this.skin } : {}), ...extra });
    const i = this.walls.length;
    this.walls.push(o);
    this._index(o, i);
    return o;
  }

  // Entries in the region maps' form, [x, z, w, d, h, kind, extra] (js/shared/maps/jungle-kit.js), offset by (ox, oz).
  put(list, ox = 0, oz = 0) { for (const [x, z, w, d, h, kind, extra] of list) this.add(x + ox, z + oz, w, d, h, kind, extra ?? {}); }

  _index(o, i) {
    const i0 = Math.floor(o.x / CELL), i1 = Math.floor((o.x + o.w) / CELL), j0 = Math.floor(o.z / CELL), j1 = Math.floor((o.z + o.d) / CELL);
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
      const key = j * 4096 + k;
      let l = this.cells.get(key);
      if (!l) this.cells.set(key, l = []);
      l.push(i);
    }
  }

  // Walls whose rect comes within m of the rect.
  near(x, z, w, d, m = 0) {
    const out = new Set();
    const i0 = Math.floor((x - m) / CELL), i1 = Math.floor((x + w + m) / CELL), j0 = Math.floor((z - m) / CELL), j1 = Math.floor((z + d + m) / CELL);
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
      for (const i of this.cells.get(j * 4096 + k) ?? []) {
        const o = this.walls[i];
        if (x - m < o.x + o.w && x + w + m > o.x && z - m < o.z + o.d && z + d + m > o.z) out.add(o);
      }
    }
    return out;
  }

  // Room for a piece: nothing within m (default: enough that no narrow gap can form), inside the map.
  free(x, z, w, d, m = 1.6) {
    if (x < 1.5 || z < 1.5 || x + w > this.W - 1.5 || z + d > this.H - 1.5) return false;
    return this.near(x, z, w, d, m).size === 0;
  }

  // A point a player can stand on: clear of every wall by m.
  open(x, z, m = 0.9) { return x > 2 && z > 2 && x < this.W - 2 && z < this.H - 2 && this.near(x - 0.001, z - 0.001, 0.002, 0.002, m).size === 0; }

  // Under a roof (inside an enterable building's footprint).
  roofAt(x, z) { return this.roofs.find(r => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d) ?? null; }

  // ---- Enterable building -------------------------------------------------------------------------------------
  // Walls WALL_T thick with door gaps (DOOR wide) and windows (waist-high sills you can see and shoot over), split in
  // two by an inside wall with a doorway when its long side is 11 m or more, furnished, floored and roofed, with loot
  // on its floor. o: { h, style, floor, roof, doors: [[side, t, len]], windows (false: none), split (false: never),
  // furnish (pieces per room), loot (spots per room, default by area), chest, tier, solid }. side is n, s, w or e;
  // t is 0..1 along it (west to east, north to south). Default doors: the middle of both long sides, so every
  // building has two ways out.
  building(x, z, w, d, o = {}) {
    const h = o.h ?? 3.4, style = o.style ?? this.region, tier = o.tier ?? this.tier;
    const id = this.roofs.length;
    const T = WALL_T;
    const tag = { bwall: true, style, bld: id };
    const opens = { n: [], s: [], w: [], e: [] };
    const split = o.split !== false && Math.max(w, d) >= 11;
    const doors = o.doors ?? (w >= d ? [['n', split ? 0.25 : 0.5], ['s', split ? 0.75 : 0.5]] : [['w', split ? 0.25 : 0.5], ['e', split ? 0.75 : 0.5]]);
    for (let [side, t, len] of doors) {
      // A door never lands on the end of the inside wall: it would be split between the two rooms.
      const across = w >= d ? side === 'n' || side === 's' : side === 'w' || side === 'e';
      if (split && across && Math.abs(t - 0.5) * Math.max(w, d) < (len ?? DOOR) / 2 + 0.8) t = t < 0.5 ? 0.27 : 0.73;
      opens[side].push({ t, len: len ?? DOOR, door: true });
    }
    const span = { n: [x, x + w], s: [x, x + w], w: [z + T, z + d - T], e: [z + T, z + d - T] };
    const winEvery = o.windowEvery ?? 4.5;
    if (o.windows !== false) {
      for (const side of ['n', 's', 'w', 'e']) {
        const [a, b] = span[side], L = b - a;
        const n = Math.floor((L - 2) / winEvery);
        for (let k = 1; k <= n; k++) {
          const c = a + (L * k) / (n + 1);
          const clash = opens[side].some(p => Math.abs(a + p.t * L - c) < (p.len + WINDOW) / 2 + 0.7);
          if (!clash) opens[side].push({ t: k / (n + 1), len: WINDOW, door: false });
        }
      }
    }
    const doorPts = [];
    for (const side of ['n', 's', 'w', 'e']) {
      const [a, b] = span[side], L = b - a;
      const list = opens[side].map(p => {
        const c = Math.max(a + 0.9 + p.len / 2, Math.min(b - 0.9 - p.len / 2, a + p.t * L));
        return { s: c - p.len / 2, e: c + p.len / 2, door: p.door };
      }).sort((p, q) => p.s - q.s);
      let at = a;
      const seg = (s, e, kind) => {
        if (e - s < 0.05) return;
        const len = e - s;
        const hh = kind === 'wall' ? h : 1.0;
        const extra = kind === 'wall' ? tag : { window: true, style, bld: id };
        if (side === 'n') this.add(s, z, len, T, hh, kind, extra);
        else if (side === 's') this.add(s, z + d - T, len, T, hh, kind, extra);
        else if (side === 'w') this.add(x, s, T, len, hh, kind, extra);
        else this.add(x + w - T, s, T, len, hh, kind, extra);
      };
      for (const p of list) {
        if (p.s < at) continue;
        seg(at, p.s, 'wall');
        if (!p.door) seg(p.s, p.e, 'barrier');
        else {
          const c = (p.s + p.e) / 2;
          doorPts.push(side === 'n' ? [c, z] : side === 's' ? [c, z + d] : side === 'w' ? [x, c] : [x + w, c]);
        }
        at = p.e;
      }
      seg(at, b, 'wall');
    }
    // Rooms: one, or two either side of an inside wall with a doorway off-centre.
    const rooms = [];
    const inner = { x: x + T, z: z + T, w: w - 2 * T, d: d - 2 * T };
    if (split) {
      const t = this.rnd() < 0.5 ? 0.28 : 0.72;
      if (w >= d) {
        const px = +(x + w / 2 - T / 2).toFixed(2);
        const c = inner.z + inner.d * t;
        const s0 = Math.max(inner.z + 0.9, c - DOOR / 2), s1 = s0 + DOOR;
        if (s0 - inner.z > 0.05) this.add(px, inner.z, T, s0 - inner.z, h, 'wall', { ...tag, inner: true });
        if (inner.z + inner.d - s1 > 0.05) this.add(px, s1, T, inner.z + inner.d - s1, h, 'wall', { ...tag, inner: true });
        doorPts.push([px + T / 2, (s0 + s1) / 2]);
        rooms.push({ x: inner.x, z: inner.z, w: px - inner.x, d: inner.d }, { x: px + T, z: inner.z, w: inner.x + inner.w - px - T, d: inner.d });
      } else {
        const pz = +(z + d / 2 - T / 2).toFixed(2);
        const c = inner.x + inner.w * t;
        const s0 = Math.max(inner.x + 0.9, c - DOOR / 2), s1 = s0 + DOOR;
        if (s0 - inner.x > 0.05) this.add(inner.x, pz, s0 - inner.x, T, h, 'wall', { ...tag, inner: true });
        if (inner.x + inner.w - s1 > 0.05) this.add(s1, pz, inner.x + inner.w - s1, T, h, 'wall', { ...tag, inner: true });
        doorPts.push([(s0 + s1) / 2, pz + T / 2]);
        rooms.push({ x: inner.x, z: inner.z, w: inner.w, d: pz - inner.z }, { x: inner.x, z: pz + T, w: inner.w, d: inner.z + inner.d - pz - T });
      }
    } else rooms.push(inner);
    for (const r of rooms) {
      r.floor = o.floor ?? style;
      r.bld = id;
      this.rooms.push(r);
    }
    this.roofs.push({ id, x, z, w, d, h, style, roof: o.roof ?? style, region: this.region });
    o.inside?.(rooms, doorPts);
    const furnish = o.furnish ?? 1;
    for (const r of rooms) {
      for (let k = 0; k < furnish; k++) this._furnish(r, doorPts, style);
    }
    for (const r of rooms) this._roomLoot(r, doorPts, tier, o.loot);
    if (o.chest) this._chestFrom(rooms, tier);
    return { id, rooms, doors: doorPts };
  }

  // One piece of furniture flush against a room wall, well clear of the corners and of any doorway: a table or
  // counter (waist high) or a shelf (solid, head high).
  _furnish(r, doorPts, style) {
    const sides = ['n', 's', 'w', 'e'];
    for (let tries = 0; tries < 6; tries++) {
      const side = sides[Math.floor(this.rnd() * 4)];
      const along = side === 'n' || side === 's';
      const L = along ? r.w : r.d;
      const a = Math.min(2.6, L - 3.2);
      if (a < 1.2) continue;
      const dep = 0.9;
      const off = (L - a) / 2 + (this.rnd() - 0.5) * Math.max(0, L - a - 3.2);
      let px, pz, pw, pd;
      if (side === 'n') { px = r.x + off; pz = r.z; pw = a; pd = dep; }
      else if (side === 's') { px = r.x + off; pz = r.z + r.d - dep; pw = a; pd = dep; }
      else if (side === 'w') { px = r.x; pz = r.z + off; pw = dep; pd = a; }
      else { px = r.x + r.w - dep; pz = r.z + off; pw = dep; pd = a; }
      // Clear of doorways (and the walk through them) and of other furniture.
      if (doorPts.some(([dx, dz]) => dx > px - 2.2 && dx < px + pw + 2.2 && dz > pz - 2.2 && dz < pz + pd + 2.2)) continue;
      const hits = [...this.near(px, pz, pw, pd, GAP + 0.4)].filter(q => !q.bwall && !q.window);
      if (hits.length) continue;
      const shelf = this.rnd() < 0.35;
      this.add(px, pz, pw, pd, shelf ? 2.1 : 1.0, shelf ? 'wall' : 'crate', { furn: shelf ? 'shelf' : this.rnd() < 0.5 ? 'table' : 'counter', style });
      return;
    }
  }

  // Loot on a room's floor: points on a 1.8 m lattice clear of walls and furniture and out of the doorways, spread
  // apart by picking each next spot farthest from those already taken.
  _roomLoot(r, doorPts, tier, per) {
    const cand = [];
    for (let z = r.z + 1.0; z <= r.z + r.d - 1.0; z += 1.8) {
      for (let x = r.x + 1.0; x <= r.x + r.w - 1.0; x += 1.8) {
        if (!this.open(x, z, 1.0)) continue;
        if (doorPts.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < 1.6)) continue;
        cand.push([x, z]);
      }
    }
    if (!cand.length) return;
    const n = Math.min(cand.length, per ?? Math.max(1, Math.min(7, Math.round(r.w * r.d / 8.5))));
    const taken = [cand[Math.floor(this.rnd() * cand.length)]];
    while (taken.length < n) {
      let best = null, bd = -1;
      for (const c of cand) {
        let m = Infinity;
        for (const t of taken) m = Math.min(m, Math.hypot(c[0] - t[0], c[1] - t[1]));
        if (m > bd) { bd = m; best = c; }
      }
      if (bd < 1.5) break;
      taken.push(best);
    }
    for (const [x, z] of taken) this.loot.push({ x: +x.toFixed(2), z: +z.toFixed(2), tier, indoor: true });
  }

  // Turns the loot spot of these rooms farthest from the walls' doors into a supply cache.
  _chestFrom(rooms, tier) {
    const inRooms = this.loot.filter(l => l.indoor && rooms.some(r => l.x > r.x && l.x < r.x + r.w && l.z > r.z && l.z < r.z + r.d));
    if (!inRooms.length) return;
    const l = inRooms[Math.floor(this.rnd() * inRooms.length)];
    this.loot.splice(this.loot.indexOf(l), 1);
    this.chests.push({ x: l.x, z: l.z, tier, indoor: true });
  }

  // Outdoor loot round a place: random open points within r of (x, z), not under a roof, preferring spots next to
  // cover (within 2.5 m of a wall), at least 3 m apart.
  outdoorLoot(x, z, r, n, tier) {
    const got = [];
    for (let tries = 0; tries < n * 40 && got.length < n; tries++) {
      const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!this.open(px, pz, 1.3) || this.roofAt(px, pz)) continue;
      if (this.near(px - 0.01, pz - 0.01, 0.02, 0.02, 2.5).size === 0 && this.rnd() < 0.7) continue;
      if (got.some(g => Math.hypot(g.x - px, g.z - pz) < 3) || this.loot.some(g => Math.hypot(g.x - px, g.z - pz) < 2)) continue;
      got.push({ x: +px.toFixed(2), z: +pz.toFixed(2), tier, indoor: false });
    }
    this.loot.push(...got);
    return got;
  }

  // Named place. Its tier sets the loot of everything built while it is current.
  poi(id, name, x, z, r, region, tier) {
    this.pois.push({ id, name, x, z, r, region, tier });
    this.region = region; this.tier = tier;
  }
}
