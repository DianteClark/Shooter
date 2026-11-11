// Proves the wall grid (js/shared/geometry.js) changes no answer: raycastMap, hasLineOfSight and resolveCircle against
// the brute-force versions they replaced (kept here verbatim as the reference), on every map and the giant test map,
// with random queries plus the awkward ones (axis-aligned rays, origins on wall edges and corners, inside walls, cell
// boundaries, points pushed out of several walls at once). Compares bit for bit. Then times both.
//   node dev/perf-geometry.mjs [--n=4000]
//   node dev/perf-geometry.mjs --ref=/tmp/perf-before   also builds every map's NavGrid with that older checkout's
//                                                       js/sim/nav.js (and its brute-force geometry) and compares the
//                                                       blocked cells, cover points and holds with today's
import { MAPS } from '../js/shared/map.js';
import { brMap } from './br-map.mjs';
import { raycastMap, hasLineOfSight, resolveCircle, wallsInBox, wallsOnRay, wallScratch } from '../js/shared/geometry.js';
import { PLAYER_RADIUS } from '../js/shared/constants.js';

const N = Number(process.argv.find(a => a.startsWith('--n='))?.split('=')[1] ?? 4000);

// ---- Reference: the brute-force code as it was before the grid -------------------------------------------------
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
  if (axis === -1) {
    if (ox <= r.x || ox >= r.x + r.w || oz <= r.z || oz >= r.z + r.d) return false;
    HIT.t = 0; HIT.axis = Math.abs(dx) >= Math.abs(dz) ? 0 : 1;
    HIT.sign = HIT.axis === 0 ? (-Math.sign(dx) || -1) : (-Math.sign(dz) || -1);
    return true;
  }
  HIT.t = tmin; HIT.axis = axis; HIT.sign = sign;
  return true;
}
function raycastRef(map, ox, oz, dirX, dirZ, maxDist, flag = 'blocksBullet') {
  let best = null, bestT = maxDist, bestAxis = 0, bestSign = 0;
  const walls = map.walls;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (!w[flag]) continue;
    if (rayRect(ox, oz, dirX, dirZ, w) && HIT.t < bestT) { bestT = HIT.t; best = w; bestAxis = HIT.axis; bestSign = HIT.sign; }
  }
  if (!best) return null;
  return { t: bestT, x: ox + dirX * bestT, z: oz + dirZ * bestT, nx: bestAxis === 0 ? bestSign : 0, nz: bestAxis === 1 ? bestSign : 0, wall: best };
}
function losRef(map, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  return raycastRef(map, ax, az, dx / len, dz / len, len, 'blocksVision') === null;
}
function resolveRef(map, pos, radius) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const walls = map.walls;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
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
      } else {
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

// ---- Queries --------------------------------------------------------------------------------------------------------
function mulberry(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A point: anywhere on (and a little off) the map, or on a wall's edge or corner, or inside one, or on an 8 m line.
function point(map, rnd) {
  const r = rnd(), walls = map.walls;
  if (r < 0.45) return [rnd() * (map.width + 4) - 2, rnd() * (map.height + 4) - 2];
  const w = walls[Math.floor(rnd() * walls.length)];
  if (r < 0.6) return [w.x + (rnd() < 0.5 ? 0 : w.w), w.z + (rnd() < 0.5 ? 0 : w.d)];                    // corner
  if (r < 0.75) return rnd() < 0.5 ? [w.x + (rnd() < 0.5 ? 0 : w.w), w.z + rnd() * w.d] : [w.x + rnd() * w.w, w.z + (rnd() < 0.5 ? 0 : w.d)];   // edge
  if (r < 0.85) return [w.x + rnd() * w.w, w.z + rnd() * w.d];                                                // inside
  if (r < 0.92) return [w.x - PLAYER_RADIUS * rnd(), w.z + rnd() * w.d];                                     // hugging
  return [Math.round(rnd() * map.width / 8) * 8 + (rnd() < 0.5 ? 0 : 1e-9), rnd() * map.height];            // cell line
}
function dir(rnd) {
  const r = rnd();
  if (r < 0.15) return [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rnd() * 4)];
  if (r < 0.2) { const s = rnd() < 0.5 ? 1 : -1, t = rnd() < 0.5 ? 1 : -1; return [s * Math.SQRT1_2, t * Math.SQRT1_2]; }
  if (r < 0.23) return [1e-10, rnd() < 0.5 ? 1 : -1];
  const a = rnd() * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

const same = (a, b) => (a === null && b === null) || (a && b && Object.is(a.t, b.t) && Object.is(a.x, b.x) && Object.is(a.z, b.z) && a.nx === b.nx && a.nz === b.nz && a.wall === b.wall);

function check(name, map) {
  const rnd = mulberry(name.length * 7919 + map.walls.length);
  let bad = 0, rays = 0, los = 0, coll = 0;
  const flags = ['blocksBullet', 'blocksVision', 'blocksMove'];
  const scratch = wallScratch(map);
  const report = (what, ...v) => { if (bad++ < 5) console.log(`  MISMATCH ${name} ${what}`, ...v); };
  for (let q = 0; q < N; q++) {
    const [ox, oz] = point(map, rnd), [dx, dz] = dir(rnd);
    const len = rnd() < 0.1 ? Infinity : rnd() < 0.5 ? rnd() * 12 : rnd() * Math.max(map.width, map.height) * 1.2;
    for (const f of flags) {
      const a = raycastMap(map, ox, oz, dx, dz, len, f), b = raycastRef(map, ox, oz, dx, dz, len, f);
      rays++;
      if (!same(a, b)) report('ray', f, ox, oz, dx, dz, len, a?.t, b?.t);
    }
    // Every wall the segment crosses must be on the candidate list (player.js walkRay relies on it).
    if (Number.isFinite(len)) {
      const n = wallsOnRay(map, ox, oz, dx, dz, len, scratch), set = new Set(scratch.subarray(0, n));
      for (let i = 0; i < map.walls.length; i++) {
        const w = map.walls[i];
        if (rayRect(ox, oz, dx, dz, w) && HIT.t <= len && !set.has(i)) report('wallsOnRay misses', i);
      }
      for (let k = 1; k < n; k++) if (scratch[k] <= scratch[k - 1]) report('wallsOnRay order');
    }
    const [bx, bz] = point(map, rnd);
    los++;
    if (hasLineOfSight(map, ox, oz, bx, bz) !== losRef(map, ox, oz, bx, bz)) report('los', ox, oz, bx, bz);
    for (const r of [PLAYER_RADIUS, 0.25, 1.2]) {
      const p1 = { x: ox, z: oz }, p2 = { x: ox, z: oz };
      resolveCircle(map, p1, r); resolveRef(map, p2, r);
      coll++;
      if (!Object.is(p1.x, p2.x) || !Object.is(p1.z, p2.z)) report('resolveCircle', ox, oz, r, p1, p2);
    }
    // Box queries: a superset of the walls overlapping the box.
    const bw = rnd() * 6, bh = rnd() * 6, n = wallsInBox(map, ox, oz, ox + bw, oz + bh, scratch), set = new Set(scratch.subarray(0, n));
    for (let i = 0; i < map.walls.length; i++) {
      const w = map.walls[i];
      if (w.x <= ox + bw && w.x + w.w >= ox && w.z <= oz + bh && w.z + w.d >= oz && !set.has(i)) report('wallsInBox misses', i);
    }
  }
  return { bad, rays, los, coll };
}

function bench(map) {
  const rnd = mulberry(99);
  const qs = [];
  for (let i = 0; i < 4000; i++) { const a = rnd() * Math.PI * 2; qs.push([4 + rnd() * (map.width - 8), 4 + rnd() * (map.height - 8), Math.cos(a), Math.sin(a), 10 + rnd() * 50]); }
  const best = fn => { fn(); let m = Infinity; for (let k = 0; k < 5; k++) { const t = performance.now(); fn(); m = Math.min(m, performance.now() - t); } return m * 1000 / qs.length; };
  const rb = best(() => { for (const [x, z, dx, dz, L] of qs) raycastRef(map, x, z, dx, dz, L, 'blocksVision'); });
  const rg = best(() => { for (const [x, z, dx, dz, L] of qs) raycastMap(map, x, z, dx, dz, L, 'blocksVision'); });
  const cb = best(() => { for (const [x, z] of qs) resolveRef(map, { x, z }, PLAYER_RADIUS); });
  const cg = best(() => { for (const [x, z] of qs) resolveCircle(map, { x, z }, PLAYER_RADIUS); });
  return { rb, rg, cb, cg };
}

const maps = Object.entries(MAPS).map(([id, m]) => [id, m]);
maps.push(['giant1', brMap({ density: 1 })], ['giant2', brMap({ density: 2 })]);
let fails = 0, total = { rays: 0, los: 0, coll: 0 };
console.log(`Wall grid against brute force, ${N} random queries per map (x3 ray flags, x3 radii)`);
for (const [id, map] of maps) {
  const r = check(id, map);
  total.rays += r.rays; total.los += r.los; total.coll += r.coll;
  fails += r.bad;
  const b = ['harvest', 'downtown', 'pier', 'giant1', 'giant2'].includes(id) ? bench(map) : null;
  console.log(`  ${id.padEnd(11)} walls ${String(map.walls.length).padEnd(5)} ${r.bad ? `${r.bad} MISMATCHES` : 'identical'}` +
    (b ? `   ray ${b.rb.toFixed(2)} -> ${b.rg.toFixed(2)} us (${(b.rb / b.rg).toFixed(0)}x)   resolveCircle ${b.cb.toFixed(2)} -> ${b.cg.toFixed(2)} us (${(b.cb / b.cg).toFixed(0)}x)` : ''));
}
// Walls added and removed mid-match (a Bulwark's cover, equipment.js syncCover): pushed onto map.walls after the grid
// exists, then spliced out again. Answers must still match the brute force at every step, and the map ends as it began.
for (const [id, map] of maps.filter(([id]) => ['pier', 'harvest', 'giant1'].includes(id))) {
  const before = map.walls.length, rnd = mulberry(77);
  raycastMap(map, 1, 1, 1, 0, 10);                       // The grid exists before anything is added.
  const add = () => {
    const w = map.walls[Math.floor(rnd() * before)];
    const cover = { x: w.x + w.w + 0.5 + rnd(), z: w.z + rnd() * 2, w: rnd() < 0.5 ? 2.5 : 0.2, d: 0, h: 1.1, kind: 'bulwark',
      blocksMove: true, blocksBullet: rnd() < 0.3, blocksVision: rnd() < 0.3, proof: true };
    cover.d = cover.w > 1 ? 0.2 : 2.5;
    map.walls.push(cover);
  };
  for (let k = 0; k < 6; k++) add();
  map.walls.push({ ...map.walls[0], kind: 'bulwark' });  // One exactly on top of a wall: ties go to the older wall.
  const steps = [check(`${id}+7`, map)];
  map.walls.splice(before + 2, 1);                        // One goes from the middle of the added ones.
  steps.push(check(`${id}+6`, map));
  add();
  steps.push(check(`${id}+7b`, map));
  map.walls.length = before;
  steps.push(check(`${id}`, map));
  const bad = steps.reduce((a, r) => a + r.bad, 0);
  fails += bad;
  console.log(`  ${id.padEnd(11)} with cover added and removed mid-match: ${bad ? `${bad} MISMATCHES` : 'identical'}`);
}

const REF = process.argv.find(a => a.startsWith('--ref='))?.split('=')[1];
if (REF) {
  const { NavGrid: Old } = await import(`${REF}/js/sim/nav.js`);
  const { NavGrid: New } = await import('../js/sim/nav.js');
  for (const [id, map] of maps) {
    const t0 = performance.now(), a = new Old(map), t1 = performance.now(), b = new New(map), t2 = performance.now();
    const ok = a.blocked.every((v, i) => v === b.blocked[i]) && JSON.stringify(a.cover) === JSON.stringify(b.cover) && JSON.stringify(a.holds) === JSON.stringify(b.holds);
    if (!ok) fails++;
    console.log(`  nav ${id.padEnd(11)} ${ok ? 'identical' : 'DIFFERENT'}  build ${(t1 - t0).toFixed(0)} -> ${(t2 - t1).toFixed(0)} ms  (${b.cover.length} cover, ${b.holds.length} holds)`);
  }
}
console.log(`${total.rays} rays, ${total.los} sight lines, ${total.coll} collisions: ${fails ? `${fails} MISMATCHES` : 'all identical'}`);
process.exit(fails ? 1 : 0);
