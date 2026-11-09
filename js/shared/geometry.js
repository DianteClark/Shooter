// Pure 2D collision and visibility helpers on the XZ plane. No allocations on hot paths
// beyond the small result object returned by a successful raycast.

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

// Casts against walls for which wall[flag] is true ('blocksBullet' | 'blocksVision' | 'blocksMove').
// (dirX, dirZ) must be normalised. Returns {t,x,z,nx,nz,wall} or null when nothing is hit within maxDist.
export function raycastMap(map, ox, oz, dirX, dirZ, maxDist, flag = 'blocksBullet') {
  let best = null, bestT = maxDist, bestAxis = 0, bestSign = 0;
  const walls = map.walls;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (!w[flag]) continue;
    if (rayRect(ox, oz, dirX, dirZ, w) && HIT.t < bestT) {
      bestT = HIT.t; best = w; bestAxis = HIT.axis; bestSign = HIT.sign;
    }
  }
  if (!best) return null;
  return { t: bestT, x: ox + dirX * bestT, z: oz + dirZ * bestT,
           nx: bestAxis === 0 ? bestSign : 0, nz: bestAxis === 1 ? bestSign : 0, wall: best };
}

// True when segment a-b passes through a smoke cloud ({x,z,r}). A viewer at a inside a cloud can see out
// of that cloud, but a target at b inside one stays hidden from outside it.
export function smokeBlocks(smokes, ax, az, bx, bz) {
  if (!smokes || !smokes.length) return false;
  const dx = bx - ax, dz = bz - az, lenSq = dx * dx + dz * dz;
  for (const s of smokes) {
    if ((ax - s.x) ** 2 + (az - s.z) ** 2 <= s.r * s.r) continue;
    const u = lenSq > 0 ? Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.z - az) * dz) / lenSq)) : 0;
    const px = ax + dx * u - s.x, pz = az + dz * u - s.z;
    if (px * px + pz * pz <= s.r * s.r) return true;
  }
  return false;
}

export function hasLineOfSight(map, ax, az, bx, bz, smokes) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  if (raycastMap(map, ax, az, dx / len, dz / len, len, 'blocksVision') !== null) return false;
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
export function resolveCircle(map, pos, radius) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const w of map.walls) {
      if (!w.blocksMove) continue;
      const nx = Math.max(w.x, Math.min(pos.x, w.x + w.w));
      const nz = Math.max(w.z, Math.min(pos.z, w.z + w.d));
      let dx = pos.x - nx, dz = pos.z - nz;
      const dSq = dx * dx + dz * dz;
      if (dSq >= radius * radius) continue;
      moved = true;
      if (dSq > 1e-9) {
        const d = Math.sqrt(dSq);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {            // Centre is inside the wall: leave by the nearest edge.
        const l = pos.x - w.x, r = w.x + w.w - pos.x, t = pos.z - w.z, b = w.z + w.d - pos.z;
        const m = Math.min(l, r, t, b);
        if (m === l) pos.x = w.x - radius;
        else if (m === r) pos.x = w.x + w.w + radius;
        else if (m === t) pos.z = w.z - radius;
        else pos.z = w.z + w.d + radius;
      }
    }
    if (!moved) break;
  }
  pos.x = Math.max(radius, Math.min(map.width - radius, pos.x));
  pos.z = Math.max(radius, Math.min(map.height - radius, pos.z));
  return pos;
}
