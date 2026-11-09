// Pure 2D collision and visibility helpers on the XZ plane. No allocations on hot paths
// beyond the small result object returned by a successful raycast.

// Ray vs one axis-aligned rectangle (slab test). Returns entry distance or -1.
function rayRect(ox, oz, dx, dz, r) {
  let tmin = 0, tmax = Infinity, axis = -1, sign = 0;
  if (Math.abs(dx) < 1e-9) {
    if (ox < r.x || ox > r.x + r.w) return null;
  } else {
    let t1 = (r.x - ox) / dx, t2 = (r.x + r.w - ox) / dx, s = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < r.z || oz > r.z + r.d) return null;
  } else {
    let t1 = (r.z - oz) / dz, t2 = (r.z + r.d - oz) / dz, s = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis === -1) return null;   // Origin inside the rectangle.
  return { t: tmin, axis, sign };
}

// Casts against walls for which wall[flag] is true ('blocksBullet' | 'blocksVision' | 'blocksMove').
// (dirX, dirZ) must be normalised. Returns {t,x,z,nx,nz,wall} or null when nothing is hit within maxDist.
export function raycastMap(map, ox, oz, dirX, dirZ, maxDist, flag = 'blocksBullet') {
  let best = null, bestT = maxDist;
  for (const w of map.walls) {
    if (!w[flag]) continue;
    const h = rayRect(ox, oz, dirX, dirZ, w);
    if (h && h.t < bestT) { bestT = h.t; best = { h, w }; }
  }
  if (!best) return null;
  const { h, w } = best;
  return { t: bestT, x: ox + dirX * bestT, z: oz + dirZ * bestT,
           nx: h.axis === 0 ? h.sign : 0, nz: h.axis === 1 ? h.sign : 0, wall: w };
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
