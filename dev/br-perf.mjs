// Battle royale feasibility (docs/BR-PERF.md). Dev only: measures what the host would pay to run 32 players on a
// 400 x 400 m map with today's engine, and how much a spatial grid for walls would save.
//   node dev/br-perf.mjs                  sim cost per 30 Hz tick, its scaling with wall count, snapshot size,
//                                         nav build cost, and ray / collision micro-benchmarks
//   node dev/br-perf.mjs --seconds=30     shorter matches
//   node dev/br-perf.mjs --micro          only the nav build and the ray / collision micro-benchmarks
//   node dev/br-perf.mjs --profile        one dense match; self time by function over the live ticks only (the nav
//                                         build is left out), top 25
// Times are CPU time (process.cpuUsage), so a busy machine inflates them less than wall clock would; p95 and max are
// wall clock per tick.
// The renderer half is dev/br-render.html, driven by dev/br-render.mjs.
import { brMap } from './br-map.mjs';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { NavGrid } from '../js/sim/nav.js';
import { raycastMap, resolveCircle } from '../js/shared/geometry.js';
import { SIM_HZ, PLAYER_RADIUS } from '../js/shared/constants.js';
import { MAPS } from '../js/shared/map.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const SECONDS = Number(opt('seconds', 60));
const STEP = 1 / SIM_HZ;

if (args.includes('--profile')) {
  // An in-process inspector session answers synchronously, so the profile starts exactly after the nav build.
  const { Session } = await import('node:inspector');
  const session = new Session();
  session.connect();
  const r = match(brMap({ density: 1, spawnArea: 'dense' }), SECONDS, 'gwtdm', {
    start: () => { session.post('Profiler.enable'); session.post('Profiler.start'); },
  });
  session.post('Profiler.stop', (err, { profile }) => {
    console.log(`profile run: ${r.ms.toFixed(2)} ms/tick CPU mean, ${r.walls} walls`);
    readProfile(profile);
    process.exit(0);
  });
}

// ---- A match: 16 v 16 bots (Ground War TDM rules), timed tick by tick -----------------------------------------

function match(map, seconds, mode = 'gwtdm', hooks = {}) {
  const t0 = performance.now();
  const roster = buildRoster([], { botSkill: 'regular', teamSize: 16, mapId: map.id, mode, seed: 5 });
  const sim = new Sim({ roster, map, seed: 5, mode, timeLimit: 3600, scoreLimit: 9999 });
  const build = performance.now() - t0;
  const t1 = performance.now();
  sim.step(STEP);                       // The first tick builds the nav grid and the bots.
  const first = performance.now() - t1;
  hooks.start?.();
  const times = [], snap = [];
  let cpu = 0, live = 0;
  let kills = 0;
  const ticks = Math.round((3.2 + seconds) * SIM_HZ);
  for (let i = 0; i < ticks; i++) {
    const a = performance.now(), c = process.cpuUsage();
    sim.step(STEP);
    const dt = performance.now() - a, cu = process.cpuUsage(c);
    if (sim.phase === 'live') { times.push(dt); cpu += (cu.user + cu.system) / 1000; live++; }
    // The host broadcasts every other tick; the snapshot as it goes on the wire (Trystero sends JSON).
    if (i % 2 === 0 && sim.phase === 'live') snap.push(JSON.stringify(sim.encodeSnapshot()).length);
    for (const e of sim.drainEvents()) if (e.t === 'kill') kills++;
  }
  times.sort((x, y) => x - y);
  const mean = cpu / live;
  return {
    walls: map.walls.length, build, first, ms: mean, p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1],
    snapMean: snap.reduce((a, b) => a + b, 0) / snap.length, snapMax: Math.max(...snap), kills, players: sim.players.length,
  };
}

// ---- Spatial grid prototype (dev only): the same answers as raycastMap / resolveCircle, from a bucket grid -----------

class WallGrid {
  constructor(map, cell = 8) {
    this.cell = cell; this.nx = Math.ceil(map.width / cell) + 2; this.nz = Math.ceil(map.height / cell) + 2;
    this.buckets = Array.from({ length: this.nx * this.nz }, () => []);
    this.walls = map.walls; this.stamp = new Uint32Array(map.walls.length); this.mark = 0;
    map.walls.forEach((w, i) => {
      for (let j = this._c(w.z); j <= this._c(w.z + w.d); j++) for (let k = this._c(w.x); k <= this._c(w.x + w.w); k++) this.buckets[j * this.nx + k].push(i);
    });
  }
  _c(v) { return Math.max(0, Math.min(this.nx - 1, Math.floor(v / this.cell) + 1)); }
  // Walls in the cells a box touches, each once.
  query(x0, z0, x1, z1, fn) {
    this.mark++;
    for (let j = this._c(z0); j <= this._c(z1); j++) for (let k = this._c(x0); k <= this._c(x1); k++) {
      for (const i of this.buckets[j * this.nx + k]) { if (this.stamp[i] === this.mark) continue; this.stamp[i] = this.mark; fn(this.walls[i]); }
    }
  }
  // Ray: walk the cells along it (Amanatides-Woo), testing each cell's walls, stopping once a hit is nearer than the
  // next cell boundary.
  raycast(ox, oz, dx, dz, maxDist, flag) {
    const c = this.cell;
    let k = this._c(ox), j = this._c(oz);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const nextX = (k - 1 + (dx > 0 ? 1 : 0)) * c, nextZ = (j - 1 + (dz > 0 ? 1 : 0)) * c;
    let tMaxX = dx !== 0 ? (nextX - ox) / dx : Infinity, tMaxZ = dz !== 0 ? (nextZ - oz) / dz : Infinity;
    const tDX = dx !== 0 ? Math.abs(c / dx) : Infinity, tDZ = dz !== 0 ? Math.abs(c / dz) : Infinity;
    let best = maxDist, hit = null;
    this.mark++;
    const one = { walls: null };
    for (;;) {
      const list = this.buckets[j * this.nx + k];
      for (const i of list) {
        if (this.stamp[i] === this.mark) continue;
        this.stamp[i] = this.mark;
        const w = this.walls[i];
        if (!w[flag]) continue;
        one.walls = [w]; one.width = 1e9; one.height = 1e9;
        const r = raycastMap(one, ox, oz, dx, dz, best, flag);
        if (r) { best = r.t; hit = r; }
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (tNext > best || tNext > maxDist) break;
      if (tMaxX < tMaxZ) { k += sx; tMaxX += tDX; } else { j += sz; tMaxZ += tDZ; }
      if (k < 0 || j < 0 || k >= this.nx || j >= this.nz) break;
    }
    return hit;
  }
}

function microBench(map) {
  const grid = new WallGrid(map);
  const rnd = (() => { let s = 99; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const rays = [];
  for (let i = 0; i < 4000; i++) {
    const a = rnd() * Math.PI * 2;
    rays.push([4 + rnd() * (map.width - 8), 4 + rnd() * (map.height - 8), Math.cos(a), Math.sin(a), 10 + rnd() * 50]);
  }
  // Best of five rounds each, after a warm-up, so JIT and a busy machine count as little as they can.
  const best = fn => { fn(); let m = Infinity; for (let k = 0; k < 5; k++) { const c = process.cpuUsage(); fn(); const u = process.cpuUsage(c); m = Math.min(m, (u.user + u.system) / 1000); } return m; };
  let sum = 0, sum2 = 0;
  const brute = best(() => { sum = 0; for (const [x, z, dx, dz, L] of rays) { const r = raycastMap(map, x, z, dx, dz, L, 'blocksVision'); sum += r ? r.t : L; } }) / rays.length;
  const gridMs = best(() => { sum2 = 0; for (const [x, z, dx, dz, L] of rays) { const r = grid.raycast(x, z, dx, dz, L, 'blocksVision'); sum2 += r ? r.t : L; } }) / rays.length;
  // Collision: the brute pass against a pass that only sees walls near the player.
  const pts = rays.map(([x, z]) => ({ x, z }));
  const collBrute = best(() => { for (const p of pts) resolveCircle(map, { x: p.x, z: p.z }, PLAYER_RADIUS); }) / pts.length;
  const local = { walls: [], width: map.width, height: map.height };
  const collGrid = best(() => {
    for (const p of pts) {
      local.walls.length = 0;
      grid.query(p.x - 1, p.z - 1, p.x + 1, p.z + 1, w => local.walls.push(w));
      resolveCircle(local, { x: p.x, z: p.z }, PLAYER_RADIUS);
    }
  }) / pts.length;
  return { rayBrute: brute * 1000, rayGrid: gridMs * 1000, same: Math.abs(sum - sum2) < 1e-3, collBrute: collBrute * 1000, collGrid: collGrid * 1000 };
}

function navCost(map) {
  const c = process.cpuUsage();
  const nav = new NavGrid(map);
  const cu = process.cpuUsage(c), build = (cu.user + cu.system) / 1000;
  const out = new Array(64);
  const t2 = performance.now();
  let n = 0;
  for (let i = 0; i < 20; i++) { nav.findPath(10 + i * 3, 10, map.width - 10, map.height - 10 - i * 3, out, 64); n++; }
  return { build, cells: nav.w * nav.h, cover: nav.cover.length, holds: nav.holds.length, path: (performance.now() - t2) / n };
}

// ---- Run ---------------------------------------------------------------------------------------------------------

function run() {
  const f = (v, d = 2) => v.toFixed(d);
  console.log(`Battle royale feasibility: 32 bots (16 v 16), ${SECONDS} s live per run, node ${process.version}\n`);
  console.log('Baseline: Harvest (Ground War, 120 x 72 m)');
  const h = match(MAPS.harvest, SECONDS);
  console.log(`  walls ${h.walls}  ${f(h.ms)} ms/tick mean, p95 ${f(h.p95)}, max ${f(h.max)}  first tick ${f(h.first, 0)} ms  snapshot ${f(h.snapMean, 0)} B mean, ${h.snapMax} B max  kills ${h.kills}`);

  console.log('\nGiant 400 x 400 m, by wall density (spread = squads dropped all over; dense = everyone in the middle 120 m)');
  console.log('  density  walls  spawn   ms/tick  p95    max     first tick  nav build  snapshot B  kills');
  for (const density of [0.25, 0.5, 1, 2]) {
    for (const spawnArea of density === 1 ? ['spread', 'dense'] : ['spread']) {
      const map = brMap({ density, spawnArea });
      const r = match(map, SECONDS);
      const nv = navCost(map);
      console.log(`  ${String(density).padEnd(8)} ${String(r.walls).padEnd(6)} ${spawnArea.padEnd(7)} ${f(r.ms).padEnd(8)} ${f(r.p95).padEnd(6)} ${f(r.max).padEnd(7)} ${f(r.first, 0).padEnd(11)} ${f(nv.build, 0).padEnd(10)} ${f(r.snapMean, 0).padEnd(11)} ${r.kills}`);
    }
  }

  micro();
}

function micro() {
  const f = (v, d = 2) => v.toFixed(d);
  const map = brMap({ density: 1 });
  const nv = navCost(map);
  console.log(`\nNav (density 1): ${nv.cells} cells, ${f(nv.build, 0)} ms to build (${nv.cover} cover points, ${nv.holds} holds), ${f(nv.path)} ms per cross-map path`);
  const mb = microBench(map);
  console.log(`Ray (vision, 10-60 m) brute ${f(mb.rayBrute, 1)} us, 8 m grid ${f(mb.rayGrid, 1)} us (${f(mb.rayBrute / mb.rayGrid, 0)}x, same answers: ${mb.same})`);
  console.log(`resolveCircle brute ${f(mb.collBrute, 1)} us, grid ${f(mb.collGrid, 1)} us (${f(mb.collBrute / mb.collGrid, 0)}x)`);
  const mh = microBench(MAPS.harvest);
  console.log(`Harvest for comparison: ray ${f(mh.rayBrute, 1)} us brute / ${f(mh.rayGrid, 1)} us grid; resolveCircle ${f(mh.collBrute, 1)} / ${f(mh.collGrid, 1)} us`);
}

// ---- CPU profile reader -------------------------------------------------------------------------------------------

function readProfile(prof) {
  const byId = new Map(prof.nodes.map(n => [n.id, n]));
  const self = new Map();
  const dt = prof.timeDeltas;
  for (let i = 0; i < prof.samples.length; i++) {
    const n = byId.get(prof.samples[i]);
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anon)'}  ${(cf.url || '').split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [k, v] of top) console.log(`${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
}

// Dispatch last: run() uses the classes and functions above.
if (!args.includes('--profile')) args.includes('--micro') ? micro() : run();
