// Navigation grid built once from map.walls, A* with string-pulled paths, and the tactical points
// (cover and angle-holding spots) bots reason about. Search state lives in typed arrays allocated once.

import { PLAYER_RADIUS } from '../shared/constants.js';
import { hasLineOfSight, raycastMap } from '../shared/geometry.js';

const CELL = 1;
const CLEARANCE = PLAYER_RADIUS + 0.2;
const SQRT2 = Math.SQRT2;
const DANGER_COST = 6;      // Extra metres of walking a bot accepts to stay out of one cell a turret covers.
const DANGER_RANGE = 18;
// Big maps (more than BIG_CELLS cells; every map in the rotation today is far below) search paths in two levels: see
// findPath. A sector is SECTOR x SECTOR cells.
const BIG_CELLS = 40000;
const SECTOR_SHIFT = 4, SECTOR = 1 << SECTOR_SHIFT;
const MAX_EXPAND = 4000;    // Cells one big-map search may expand before it settles for the closest it reached (see partial).
const PULL_REACH = 40;      // Cells ahead a big-map path corner looks when pulling the string.

export class NavGrid {
  constructor(map) {
    this.map = map;
    this.w = Math.ceil(map.width / CELL);
    this.h = Math.ceil(map.height / CELL);
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.parent = new Int32Array(n);
    this.g = new Float32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.search = 0;
    this.heap = new Int32Array(n * 8);
    this.heapF = new Float32Array(n * 8);
    this.tmp = new Int32Array(n);
    // Per team: cells covered by enemy turrets. A free-for-all (team 2 and up, see TEAMS) shares the first grid, painted
    // with every sentry on the map: there, everyone's turret is someone else's problem.
    this.danger = [new Uint8Array(n), new Uint8Array(n)];
    this._buildBlocked();
    this.cover = [];    // Points next to vision-blocking walls.
    this.holds = [];    // Points with a long sightline, each with the best angle for each team.
    this._buildTactical();
    // Cell indexes over both lists: a bot looking for cover or a hold near it visits the points near it, in list
    // order, instead of every point on the map.
    this.coverIndex = new PointIndex(this.cover);
    this.holdIndex = new PointIndex(this.holds);
    this.regionOf = null;
    if (n > BIG_CELLS) this._buildSectors();
  }

  // Each movement-blocking wall marks the cells whose centre is within CLEARANCE of it: the same test the old
  // every-cell-against-every-wall loop made, run only over the cells near each wall.
  _buildBlocked() {
    const { w, h, map, blocked } = this;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
        if (cx < CLEARANCE || cz < CLEARANCE || cx > map.width - CLEARANCE || cz > map.height - CLEARANCE) blocked[j * w + i] = 1;
      }
    }
    for (const r of map.walls) {
      if (!r.blocksMove) continue;
      this._near(r, CLEARANCE, (k, cx, cz) => {
        if (blocked[k]) return;
        const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
        const nz = Math.max(r.z, Math.min(cz, r.z + r.d));
        const dx = cx - nx, dz = cz - nz;
        if (dx * dx + dz * dz < CLEARANCE * CLEARANCE) blocked[k] = 1;
      });
    }
  }

  // Calls fn(cellIndex, centreX, centreZ) for every cell whose centre may lie within `reach` of wall r (a cell of
  // margin each side, so rounding never drops one).
  _near(r, reach, fn) {
    const { w, h } = this;
    const i0 = Math.max(0, Math.floor((r.x - reach) / CELL) - 1), i1 = Math.min(w - 1, Math.floor((r.x + r.w + reach) / CELL) + 1);
    const j0 = Math.max(0, Math.floor((r.z - reach) / CELL) - 1), j1 = Math.min(h - 1, Math.floor((r.z + r.d + reach) / CELL) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * w + i, (i + 0.5) * CELL, (j + 0.5) * CELL);
  }

  _buildTactical() {
    const { w, h, map } = this;
    const taken = new Uint8Array(w * h);
    // Cells within 1.6 m of a vision-blocking (bit 1) or a low (bit 2) piece, borders aside: per wall, as above.
    const near = new Uint8Array(w * h);
    for (const r of map.walls) {
      if (r.kind === 'border') continue;
      const bit = r.blocksVision ? 1 : 2;
      this._near(r, 1.6, (k, cx, cz) => {
        if (near[k] & bit) return;
        const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
        const nz = Math.max(r.z, Math.min(cz, r.z + r.d));
        if (Math.hypot(cx - nx, cz - nz) <= 1.6) near[k] |= bit;
      });
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (this.blocked[j * w + i]) continue;
        const cx = i + 0.5, cz = j + 0.5;
        const nearSolid = (near[j * w + i] & 1) !== 0, nearLow = (near[j * w + i] & 2) !== 0;
        if (!nearSolid && !nearLow) continue;
        // Thin the set: one point per 3x3 m block is plenty.
        const key = Math.floor(j / 3) * w + Math.floor(i / 3);
        if (taken[key]) continue;
        taken[key] = 1;
        const point = { x: cx, z: cz, solid: nearSolid };
        if (nearSolid) this.cover.push(point);
        this._rateHold(point);
      }
    }
  }

  // Finds the longest open sightline in each team's forward half, biased toward looking down a lane.
  _rateHold(point) {
    const map = this.map;
    const best = [{ aim: 0, sight: -1 }, { aim: Math.PI, sight: -1 }];
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const hit = raycastMap(map, point.x, point.z, dx, dz, 45, 'blocksVision');
      const t = hit ? hit.t : 45;
      for (let team = 0; team < 2; team++) {
        const forward = team === 0 ? dx : -dx;
        if (forward < 0.15) continue;
        const score = t * (0.45 + 0.55 * forward);
        if (score > best[team].sight) { best[team].sight = score; best[team].aim = ang; }
      }
    }
    if (best[0].sight < 9 && best[1].sight < 9) return;
    this.holds.push({ x: point.x, z: point.z, solid: point.solid,
      aim: [best[0].aim, best[1].aim], sight: [best[0].sight, best[1].sight] });
  }

  // Rebuilds both teams' danger maps. Called only when a turret appears or goes away.
  paintDanger(turrets) {
    const { w, h, map } = this;
    this.danger[0].fill(0); this.danger[1].fill(0);
    for (const t of turrets) {
      const grid = this.danger[t.team > 1 ? 0 : 1 - t.team];
      const i0 = Math.max(0, Math.floor(t.x - DANGER_RANGE)), i1 = Math.min(w - 1, Math.ceil(t.x + DANGER_RANGE));
      const j0 = Math.max(0, Math.floor(t.z - DANGER_RANGE)), j1 = Math.min(h - 1, Math.ceil(t.z + DANGER_RANGE));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * w + i;
          if (this.blocked[k] || grid[k]) continue;
          const cx = i + 0.5, cz = j + 0.5;
          if (Math.hypot(cx - t.x, cz - t.z) <= DANGER_RANGE && hasLineOfSight(map, t.x, t.z, cx, cz)) grid[k] = 1;
        }
      }
    }
  }

  // A big map searches in two levels and lets far-off bots think less often (bots.js).
  get big() { return this.regionOf !== null; }

  idx(x, z) {
    const i = Math.max(0, Math.min(this.w - 1, Math.floor(x / CELL)));
    const j = Math.max(0, Math.min(this.h - 1, Math.floor(z / CELL)));
    return j * this.w + i;
  }

  isWalkable(x, z) {
    if (x < 0 || z < 0 || x >= this.map.width || z >= this.map.height) return false;
    return !this.blocked[this.idx(x, z)];
  }

  // Index of the closest free cell, spiralling outward from (x, z).
  nearestFree(x, z) {
    const start = this.idx(x, z);
    if (!this.blocked[start]) return start;
    const ci = start % this.w, cj = (start - ci) / this.w;
    for (let r = 1; r < 16; r++) {
      let best = -1, bestD = Infinity;
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          const k = j * this.w + i;
          if (this.blocked[k]) continue;
          const d = (i + 0.5 - x) ** 2 + (j + 0.5 - z) ** 2;
          if (d < bestD) { bestD = d; best = k; }
        }
      }
      if (best >= 0) return best;
    }
    return start;
  }

  // True when a player-sized circle can walk the straight segment. Samples the inflated grid.
  // With `danger`, a straight shortcut may not cross cells that map marks and the path around avoided.
  segmentClear(ax, az, bx, bz, danger = null) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / 0.4);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const k = this.idx(ax + dx * t, az + dz * t);
      if (this.blocked[k] || (danger && danger[k])) return false;
    }
    return true;
  }

  // Writes [x0,z0,x1,z1,...] of a string-pulled path into `out` and returns the point count.
  // The first point is the first thing to walk to, not the start.
  // With a `team`, routes around the cells that team's enemy turrets cover, when a detour exists.
  // On a big map (see SECTOR) the search first finds a route over the sector graph and then only opens cells of the
  // sectors along that route (and their neighbours), with a cap on cells expanded; a goal nobody can reach costs a
  // coarse search, not a sweep of the whole map. Small maps search exactly as they always have.
  findPath(ax, az, bx, bz, out, maxPoints, team = -1) {
    const w = this.w, h = this.h;
    const startCell = this.nearestFree(ax, az);
    let goalCell = this.nearestFree(bx, bz);
    const { g, parent, stamp, closed, blocked } = this;
    const danger = team >= 0 ? this.danger[team > 1 ? 0 : team] : null;
    const id = ++this.search;
    this.partial = false;
    let corridor = null, cap = Infinity;
    if (this.regionOf) {
      if (!this._route(startCell, goalCell, id)) return 0;
      corridor = this.sectorMark;
      cap = MAX_EXPAND;
    }
    this.gx = goalCell % w; this.gz = (goalCell - this.gx) / w;

    this.size = 0;
    g[startCell] = 0; stamp[startCell] = id; parent[startCell] = -1;
    this._push(startCell, this._h(startCell));
    let found = false, expanded = 0, nearest = startCell, nearestH = Infinity;
    while (this.size > 0) {
      const cur = this._pop();
      if (closed[cur] === id) continue;
      closed[cur] = id;
      if (cur === goalCell) { found = true; break; }
      const ci = cur % w, cj = (cur - ci) / w;
      if (corridor) {
        // Capped: remember the closest cell so far, and settle for it when the cap runs out.
        const hc = this._h(cur);
        if (hc < nearestH) { nearestH = hc; nearest = cur; }
        if (++expanded > cap) break;
      }
      const base = g[cur];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= w || j >= h) continue;
          const k = j * w + i;
          if (blocked[k] || closed[k] === id) continue;
          if (corridor && corridor[(j >> SECTOR_SHIFT) * this.sw + (i >> SECTOR_SHIFT)] !== id) continue;
          // No cutting corners past a blocked cell.
          if (di !== 0 && dj !== 0 && (blocked[cj * w + i] || blocked[j * w + ci])) continue;
          const cost = base + (di !== 0 && dj !== 0 ? SQRT2 : 1) + (danger && danger[k] ? DANGER_COST : 0);
          if (stamp[k] === id && g[k] <= cost) continue;
          stamp[k] = id; g[k] = cost; parent[k] = cur;
          this._push(k, cost + this._h(k));
        }
      }
    }
    // A capped search that ran out hands back the way to the closest cell it reached and says so in `partial`: the
    // bot walks that far and asks again from there.
    this.partial = false;
    if (!found) {
      if (!corridor || nearest === startCell) return 0;
      goalCell = nearest;
      this.partial = true;
    }

    // Walk back, then pull the string: keep only the corners the straight line cannot skip. On a big map a corner
    // looks at most PULL_REACH cells ahead, so a long straight street does not cost a test per cell along it.
    const raw = this.tmp;
    const reach = corridor ? PULL_REACH : Infinity;
    let rawN = 0;
    for (let k = goalCell; k !== -1; k = parent[k]) raw[rawN++] = k;
    let n = 0, anchorX = ax, anchorZ = az;
    let i = rawN - 1;
    while (i > 0 && n < maxPoints) {
      let j = i - 1, lastGood = j;
      for (; j >= 0 && i - j <= reach; j--) {
        const k = raw[j], cx = k % w + 0.5, cz = (k - k % w) / w + 0.5;
        // Once already inside covered ground the only goal is out, so shortcuts are fine again.
        const avoid = danger && !danger[this.idx(anchorX, anchorZ)] ? danger : null;
        if (this.segmentClear(anchorX, anchorZ, cx, cz, avoid)) lastGood = j;
        else if (j < lastGood - 3) break;
      }
      const k = raw[lastGood];
      anchorX = k % w + 0.5; anchorZ = (k - k % w) / w + 0.5;
      out[n * 2] = anchorX; out[n * 2 + 1] = anchorZ;
      n++;
      i = lastGood;
    }
    return n;
  }

  // Octile distance from cell k to the current search's goal.
  _h(k) {
    const w = this.w, i = k % w, j = (k - i) / w;
    const dx = Math.abs(i - this.gx), dz = Math.abs(j - this.gz);
    return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz);
  }

  // Binary heap on (heap, heapF), this.size entries.
  _push(k, f) {
    const { heap, heapF } = this;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heap[i] = heap[p]; heapF[i] = heapF[p];
      i = p;
    }
    heap[i] = k; heapF[i] = f;
  }

  _pop() {
    const { heap, heapF } = this;
    const top = heap[0];
    const size = --this.size;
    if (size > 0) {
      const k = heap[size], f = heapF[size];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && heapF[c + 1] < heapF[c]) c++;
        if (heapF[c] >= f) break;
        heap[i] = heap[c]; heapF[i] = heapF[c];
        i = c;
      }
      heap[i] = k; heapF[i] = f;
    }
    return top;
  }

  // ---- Sector graph (big maps only) ----
  // The map is cut into SECTOR x SECTOR-cell squares, and each square's walkable cells into regions (4-connected
  // inside the square, which is how the fine search's no-corner-cutting moves connect cells). Two regions are linked
  // when cells of theirs touch across a square's edge. A route over that graph is exact about what can reach what.
  _buildSectors() {
    const { w, h, blocked } = this;
    const sw = this.sw = Math.ceil(w / SECTOR), sh = Math.ceil(h / SECTOR);
    const regionOf = this.regionOf = new Int32Array(w * h).fill(-1);
    const cx = [], cz = [], sector = [];
    const stack = new Int32Array(SECTOR * SECTOR);
    for (let sj = 0; sj < sh; sj++) {
      for (let si = 0; si < sw; si++) {
        const i0 = si * SECTOR, j0 = sj * SECTOR, i1 = Math.min(w, i0 + SECTOR), j1 = Math.min(h, j0 + SECTOR);
        for (let j = j0; j < j1; j++) {
          for (let i = i0; i < i1; i++) {
            const k0 = j * w + i;
            if (blocked[k0] || regionOf[k0] >= 0) continue;
            const r = cx.length;
            let n = 0, sx = 0, sz = 0, count = 0;
            stack[n++] = k0; regionOf[k0] = r;
            while (n > 0) {
              const k = stack[--n], ki = k % w, kj = (k - ki) / w;
              sx += ki + 0.5; sz += kj + 0.5; count++;
              if (ki > i0 && !blocked[k - 1] && regionOf[k - 1] < 0) { regionOf[k - 1] = r; stack[n++] = k - 1; }
              if (ki < i1 - 1 && !blocked[k + 1] && regionOf[k + 1] < 0) { regionOf[k + 1] = r; stack[n++] = k + 1; }
              if (kj > j0 && !blocked[k - w] && regionOf[k - w] < 0) { regionOf[k - w] = r; stack[n++] = k - w; }
              if (kj < j1 - 1 && !blocked[k + w] && regionOf[k + w] < 0) { regionOf[k + w] = r; stack[n++] = k + w; }
            }
            cx.push(sx / count); cz.push(sz / count); sector.push(sj * sw + si);
          }
        }
      }
    }
    const R = cx.length;
    this.regionX = Float32Array.from(cx); this.regionZ = Float32Array.from(cz); this.regionSector = Int32Array.from(sector);
    // Links across each sector's east and south edges, deduplicated per region pair.
    const links = Array.from({ length: R }, () => new Set());
    const link = (a, b) => { if (a >= 0 && b >= 0 && a !== b) { links[a].add(b); links[b].add(a); } };
    for (let j = 0; j < h; j++) {
      for (let i = SECTOR - 1; i < w - 1; i += SECTOR) link(regionOf[j * w + i], regionOf[j * w + i + 1]);
    }
    for (let j = SECTOR - 1; j < h - 1; j += SECTOR) {
      for (let i = 0; i < w; i++) link(regionOf[j * w + i], regionOf[(j + 1) * w + i]);
    }
    const start = this.linkStart = new Int32Array(R + 1);
    for (let r = 0; r < R; r++) start[r + 1] = start[r] + links[r].size;
    this.linkTo = new Int32Array(start[R]);
    for (let r = 0; r < R; r++) { let k = start[r]; for (const b of links[r]) this.linkTo[k++] = b; }
    this.sectorMark = new Uint32Array(sw * sh);
    this.rG = new Float32Array(R); this.rParent = new Int32Array(R); this.rStamp = new Uint32Array(R); this.rClosed = new Uint32Array(R);
    this.rHeap = new Int32Array(start[R] + R + 1); this.rHeapF = new Float32Array(start[R] + R + 1);
  }

  // A* over regions from the start cell's region to the goal cell's. On success marks, in sectorMark with this search
  // id, every sector the route passes through and the ring of sectors around each, and returns true.
  _route(startCell, goalCell, id) {
    const { regionOf, regionX, regionZ, linkStart, linkTo, rG, rParent, rStamp, rClosed, rHeap, rHeapF } = this;
    const a = regionOf[startCell], b = regionOf[goalCell];
    if (a < 0 || b < 0) return false;
    const bx = regionX[b], bz = regionZ[b];
    let size = 0;
    rG[a] = 0; rStamp[a] = id; rParent[a] = -1;
    rHeap[0] = a; rHeapF[0] = Math.hypot(regionX[a] - bx, regionZ[a] - bz); size = 1;
    let found = false;
    while (size > 0) {
      const cur = rHeap[0];
      size--;
      if (size > 0) {
        const k = rHeap[size], f = rHeapF[size];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= size) break;
          if (c + 1 < size && rHeapF[c + 1] < rHeapF[c]) c++;
          if (rHeapF[c] >= f) break;
          rHeap[i] = rHeap[c]; rHeapF[i] = rHeapF[c]; i = c;
        }
        rHeap[i] = k; rHeapF[i] = f;
      }
      if (rClosed[cur] === id) continue;
      rClosed[cur] = id;
      if (cur === b) { found = true; break; }
      for (let e = linkStart[cur]; e < linkStart[cur + 1]; e++) {
        const r = linkTo[e];
        if (rClosed[r] === id) continue;
        const cost = rG[cur] + Math.hypot(regionX[r] - regionX[cur], regionZ[r] - regionZ[cur]);
        if (rStamp[r] === id && rG[r] <= cost) continue;
        rStamp[r] = id; rG[r] = cost; rParent[r] = cur;
        const f = cost + Math.hypot(regionX[r] - bx, regionZ[r] - bz);
        let i = size++;
        while (i > 0) { const q = (i - 1) >> 1; if (rHeapF[q] <= f) break; rHeap[i] = rHeap[q]; rHeapF[i] = rHeapF[q]; i = q; }
        rHeap[i] = r; rHeapF[i] = f;
      }
    }
    if (!found) return false;
    const { sw, sectorMark, regionSector } = this, sh = sectorMark.length / sw;
    for (let r = b; r !== -1; r = rParent[r]) {
      const s = regionSector[r], si = s % sw, sj = (s - si) / sw;
      for (let j = Math.max(0, sj - 1); j <= Math.min(sh - 1, sj + 1); j++) {
        for (let i = Math.max(0, si - 1); i <= Math.min(sw - 1, si + 1); i++) sectorMark[j * sw + i] = id;
      }
    }
    return true;
  }

  // Closest cover point (from `pts`) hidden from the threat. Returns null when nothing qualifies.
  findCover(x, z, threatX, threatZ, rng, maxDist = 14) {
    let best = null, bestScore = Infinity;
    const ix = this.coverIndex, n = ix.near(x, z, maxDist);
    for (let q = 0; q < n; q++) {
      const c = this.cover[ix.out[q]];
      const d = Math.hypot(c.x - x, c.z - z);
      if (d > maxDist) continue;
      if (hasLineOfSight(this.map, c.x, c.z, threatX, threatZ)) continue;
      // Prefer close cover that does not mean running toward the threat.
      const towardThreat = Math.hypot(threatX - c.x, threatZ - c.z) < Math.hypot(threatX - x, threatZ - z) ? 5 : 0;
      const score = d + towardThreat + rng() * 2.5;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }
}

// Points ({x, z}) bucketed by PT_CELL squares. near(x, z, r) fills `out` with the list indices, ascending, of every
// point that may lie within r of (x, z) (a superset: callers still test the distance) and returns how many.
const PT_CELL = 8;
export class PointIndex {
  constructor(points) {
    this.points = points;
    let w = 1, h = 1;
    for (const p of points) { w = Math.max(w, p.x + 1); h = Math.max(h, p.z + 1); }
    this.nx = Math.ceil(w / PT_CELL); this.nz = Math.ceil(h / PT_CELL);
    const cells = this.nx * this.nz, start = new Int32Array(cells + 1);
    const cellOf = p => Math.min(this.nz - 1, Math.max(0, Math.floor(p.z / PT_CELL))) * this.nx + Math.min(this.nx - 1, Math.max(0, Math.floor(p.x / PT_CELL)));
    for (const p of points) start[cellOf(p) + 1]++;
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cells);
    this.items = new Int32Array(points.length);
    points.forEach((p, k) => { this.items[fill[cellOf(p)]++] = k; });
    this.start = start;
    this.out = new Int32Array(Math.max(1, points.length));
  }

  near(x, z, r) {
    const { nx, nz, start, items, out } = this;
    const i0 = Math.max(0, Math.floor((x - r) / PT_CELL) - 1), i1 = Math.min(nx - 1, Math.floor((x + r) / PT_CELL) + 1);
    const j0 = Math.max(0, Math.floor((z - r) / PT_CELL) - 1), j1 = Math.min(nz - 1, Math.floor((z + r) / PT_CELL) + 1);
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * nx + i;
        for (let k = start[c], e = start[c + 1]; k < e; k++) out[n++] = items[k];
      }
    }
    // Each cell's run is ascending; merge the runs by insertion (a few dozen points at most near anyone).
    for (let a = 1; a < n; a++) {
      const v = out[a];
      let b = a - 1;
      while (b >= 0 && out[b] > v) { out[b + 1] = out[b]; b--; }
      out[b + 1] = v;
    }
    return n;
  }
}
