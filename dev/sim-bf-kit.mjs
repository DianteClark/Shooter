// Shared by dev/sim-conquest.mjs and dev/sim-breakthrough.mjs (ROADMAP 65): bot matches with the measurements both
// report (ticks, stuck bots, where the bots stand), layout checks against the nav grid, and the test runner.
import assert from 'node:assert/strict';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { NavGrid } from '../js/sim/nav.js';
import { SIM_HZ } from '../js/shared/constants.js';

export const STEP = 1 / SIM_HZ;
export const QUICK = process.argv.includes('quick') || process.argv.includes('--quick');
let passed = 0;
export async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}
export const done = () => console.log(`\n${passed} passed`);

export function makeSim(mode, map, { seed = 7, humans = [], mods = [], scoreLimit, timeLimit } = {}) {
  const roster = buildRoster(humans, { botSkill: 'mixed', mode, mapId: map, seed });
  return { roster, sim: new Sim({ roster, map, seed, mode, mods, scoreLimit, timeLimit }) };
}

export function run(sim, seconds, until = () => false) {
  const out = [];
  for (let i = Math.round(seconds * SIM_HZ); i > 0 && sim.phase !== 'ended'; i--) {
    sim.step(STEP);
    for (const e of sim.drainEvents()) if (e.t !== 'shot' && e.t !== 'hit') out.push(e);
    if (until(sim)) break;
  }
  return out;
}

// Every point of a layout reachable on foot from its first HQ, inside its area (flood fill over the nav grid).
export function checkLayout(map, l) {
  const nav = new NavGrid(map), { w, h, blocked } = nav, reach = new Uint8Array(w * h), a = l.area;
  const st = [nav.nearestFree(l.hq[0].x, l.hq[0].z)];
  reach[st[0]] = 1;
  while (st.length) {
    const k = st.pop(), i = k % w, j = (k - i) / w;
    for (const [q, qi, qj] of [[k - 1, i - 1, j], [k + 1, i + 1, j], [k - w, i, j - 1], [k + w, i, j + 1]]) {
      if (qi >= a.x && qi < a.x + a.w && qj >= a.z && qj < a.z + a.h && !blocked[q] && !reach[q]) { reach[q] = 1; st.push(q); }
    }
  }
  const pts = [...l.hq.map((q, i) => ({ id: `HQ${i}`, ...q })), ...(l.flags ?? l.sectors.flatMap(s => s.objs))];
  for (const p of pts) {
    const k = nav.nearestFree(p.x, p.z), fx = k % w + 0.5, fz = Math.floor(k / w) + 0.5;
    assert.ok(Math.hypot(fx - p.x, fz - p.z) < (p.r ?? 4) * 0.8, `${map.id} ${l.id} ${p.id}: walkable ground on it`);
    assert.ok(reach[k], `${map.id} ${l.id} ${p.id}: reachable from HQ inside the area`);
    assert.ok(p.x >= a.x && p.x <= a.x + a.w && p.z >= a.z && p.z <= a.z + a.h, `${map.id} ${l.id} ${p.id}: inside the area`);
  }
}

// A bot-only match to its end. Returns what the reports need: winner, length, events by key, tick cost, stuck seconds
// (a bot pushing its stick for 4 s that moved under 0.6 m), and how spread over the objectives each side was.
export function botMatch(mode, map, seed, { maxSeconds = 1500, every = null } = {}) {
  const { sim } = makeSim(mode, map, { seed });
  const ev = {}, hist = new Map();
  let stuck = 0, ticks = 0, cpu = 0, worst = 0, spreadN = 0, spreadSum = 0;
  const walls = [];
  const end = Math.round(maxSeconds * SIM_HZ);
  for (let i = 0; i < end && sim.phase !== 'ended'; i++) {
    // Mean: CPU time of the process. Worst: the main thread's wall time (CPU time also counts the collector's and the
    // compiler's own threads, which do not stall the tick), from the first live tick on (the warmup builds the nav grid).
    const a = process.cpuUsage(), w0 = performance.now();
    sim.step(STEP);
    const wall = performance.now() - w0, u = process.cpuUsage(a), ms = (u.user + u.system) / 1000;
    if (sim.phase === 'live') { ticks++; cpu += ms; worst = Math.max(worst, wall); walls.push(wall); }
    for (const e of sim.drainEvents()) {
      const k = e.kind && (e.t === 'cq' || e.t === 'bt') ? `${e.t}:${e.kind}` : e.t;
      ev[k] = (ev[k] ?? 0) + 1;
    }
    if (i % SIM_HZ === 0 && sim.phase === 'live') {
      for (const p of sim.players) {
        if (!p.bot) continue;
        const h = hist.get(p.id) ?? [];
        h.push({ x: p.ps.x, z: p.ps.z, push: Math.hypot(p.bot.input.mx, p.bot.input.mz), alive: p.alive });
        if (h.length > 5) h.shift();
        hist.set(p.id, h);
        if (h.length === 5 && h.every(s => s.alive && s.push > 0.5) && Math.hypot(h[4].x - h[0].x, h[4].z - h[0].z) < 0.6) stuck++;
      }
      // Spread: how many of the live objectives have a bot of a side within r + 6, per side, every 10 s.
      if (i % (10 * SIM_HZ) === 0) {
        for (let t = 0; t < 2; t++) {
          let n = 0;
          for (const z of sim.points) if (sim.players.some(p => p.alive && p.team === t && Math.hypot(p.ps.x - z.x, p.ps.z - z.z) < z.r + 6)) n++;
          spreadSum += n; spreadN++;
        }
      }
      every?.(sim);
    }
  }
  // p999: the tick only one in a thousand is slower than (on a shared, busy test machine the single worst is often the
  // machine, not the game).
  walls.sort((a, b) => a - b);
  const p999 = walls[Math.min(walls.length - 1, Math.floor(walls.length * 0.999))] ?? 0;
  return { sim, winner: sim.winner, seconds: sim.time, ev, mean: cpu / Math.max(1, ticks), worst, p999, stuckPerBotMin: stuck / sim.players.length / Math.max(1, sim.time / 60), spread: spreadSum / Math.max(1, spreadN) };
}
