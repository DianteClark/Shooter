// Navigation grid built once from map.walls, A* with string-pulled paths, and the tactical points
// (cover and angle-holding spots) bots reason about. Search state lives in typed arrays allocated once.

import { PLAYER_RADIUS } from '../shared/constants.js';
import { hasLineOfSight, raycastMap } from '../shared/geometry.js';

const CELL = 1;
const CLEARANCE = PLAYER_RADIUS + 0.2;
const SQRT2 = Math.SQRT2;

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
    this._buildBlocked();
    this.cover = [];    // Points next to vision-blocking walls.
    this.holds = [];    // Points with a long sightline, each with the best angle for each team.
    this._buildTactical();
  }

  _buildBlocked() {
    const { w, h, map, blocked } = this;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
        let b = cx < CLEARANCE || cz < CLEARANCE || cx > map.width - CLEARANCE || cz > map.height - CLEARANCE;
        for (const r of map.walls) {
          if (b) break;
          if (!r.blocksMove) continue;
          const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
          const nz = Math.max(r.z, Math.min(cz, r.z + r.d));
          const dx = cx - nx, dz = cz - nz;
          if (dx * dx + dz * dz < CLEARANCE * CLEARANCE) b = true;
        }
        blocked[j * w + i] = b ? 1 : 0;
      }
    }
  }

  _buildTactical() {
    const { w, h, map } = this;
    const taken = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (this.blocked[j * w + i]) continue;
        const cx = i + 0.5, cz = j + 0.5;
        let nearSolid = false, nearLow = false;
        for (const r of map.walls) {
          if (r.kind === 'border') continue;
          const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
          const nz = Math.max(r.z, Math.min(cz, r.z + r.d));
          if (Math.hypot(cx - nx, cz - nz) > 1.6) continue;
          if (r.blocksVision) nearSolid = true; else nearLow = true;
        }
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
  segmentClear(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / 0.4);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.blocked[this.idx(ax + dx * t, az + dz * t)]) return false;
    }
    return true;
  }

  // Writes [x0,z0,x1,z1,...] of a string-pulled path into `out` and returns the point count.
  // The first point is the first thing to walk to, not the start.
  findPath(ax, az, bx, bz, out, maxPoints) {
    const w = this.w, h = this.h;
    const startCell = this.nearestFree(ax, az);
    const goalCell = this.nearestFree(bx, bz);
    const { g, parent, stamp, closed, heap, heapF, blocked } = this;
    const id = ++this.search;
    const gx = goalCell % w, gz = (goalCell - gx) / w;

    const heuristic = (k) => {
      const i = k % w, j = (k - i) / w;
      const dx = Math.abs(i - gx), dz = Math.abs(j - gz);
      return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz);
    };

    let size = 0;
    const push = (k, f) => {
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= f) break;
        heap[i] = heap[p]; heapF[i] = heapF[p];
        i = p;
      }
      heap[i] = k; heapF[i] = f;
    };
    const pop = () => {
      const top = heap[0];
      size--;
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
    };

    g[startCell] = 0; stamp[startCell] = id; parent[startCell] = -1;
    push(startCell, heuristic(startCell));
    let found = false;
    while (size > 0) {
      const cur = pop();
      if (closed[cur] === id) continue;
      closed[cur] = id;
      if (cur === goalCell) { found = true; break; }
      const ci = cur % w, cj = (cur - ci) / w;
      const base = g[cur];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= w || j >= h) continue;
          const k = j * w + i;
          if (blocked[k] || closed[k] === id) continue;
          // No cutting corners past a blocked cell.
          if (di !== 0 && dj !== 0 && (blocked[cj * w + i] || blocked[j * w + ci])) continue;
          const cost = base + (di !== 0 && dj !== 0 ? SQRT2 : 1);
          if (stamp[k] === id && g[k] <= cost) continue;
          stamp[k] = id; g[k] = cost; parent[k] = cur;
          push(k, cost + heuristic(k));
        }
      }
    }
    if (!found) return 0;

    // Walk back, then pull the string: keep only the corners the straight line cannot skip.
    const raw = this.tmp;
    let rawN = 0;
    for (let k = goalCell; k !== -1; k = parent[k]) raw[rawN++] = k;
    let n = 0, anchorX = ax, anchorZ = az;
    let i = rawN - 1;
    while (i > 0 && n < maxPoints) {
      let j = i - 1, lastGood = j;
      for (; j >= 0; j--) {
        const k = raw[j], cx = k % w + 0.5, cz = (k - k % w) / w + 0.5;
        if (this.segmentClear(anchorX, anchorZ, cx, cz)) lastGood = j;
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

  // Closest cover point (from `pts`) hidden from the threat. Returns null when nothing qualifies.
  findCover(x, z, threatX, threatZ, rng, maxDist = 14) {
    let best = null, bestScore = Infinity;
    for (const c of this.cover) {
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
