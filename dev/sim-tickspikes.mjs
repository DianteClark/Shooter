// Host tick spikes (docs/BR-PERF.md, "Tick spikes"): wall-clock time of every host tick on the main thread, the
// worst, p99 and p99.9, and for each slow tick what it spent the time on: the sim phase (the call under Sim._tick), the
// functions with the most self time, and garbage collection. A sampling CPU profile (node:inspector, same clock as
// process.hrtime) is cut at the tick boundaries, so module functions (landingOf, findPath, hasLineOfSight) show by
// name, not only methods; GC comes from the 'gc' performance entries, timed on the same clock.
//   node dev/sim-tickspikes.mjs                          every scenario (BR x3, Ground War x2, Conquest and
//                                                        Breakthrough on Meridian, Graveyard Shift r20/r30, 6v6 TDM)
//   node dev/sim-tickspikes.mjs br-meridian gw-harvest   only these (prefix match: `br` runs all three BR maps)
//   --secs=N        live seconds per scenario (default: BR to the end, the rest 240 s; Graveyard Shift 60 s)
//   --seed=N        match seed (default 5)
//   --spike=MS      a tick at or over this many ms is a spike (default 4)
//   --top=N         spikes listed per scenario (default 6), functions per spike (5)
//   --cold          no warm-up at load (Sim.warm off, as before build NEXT); the match itself must be the same
//   --no-profile    timing only (the sampler costs a few % and adds a little jitter)
//   --interval=US   sampling interval (default 100 us)
//   --expose-gc     (node flag: node --expose-gc dev/sim-tickspikes.mjs) runs a full collection between ticks every
//                   --gc-every ticks (default 300), outside the timed window: the spikes left are the game's own
//   --alloc         also list the allocation sites (bytes a second, sampled, collected objects included): what
//                   feeds the garbage collector
//   --json=FILE     also write the numbers
//   --stats         bot stats per scenario (kills, objective events, stuck bot-seconds a minute)
//   --repeat=N      N runs a scenario, each in a fresh process (cold start included every time); the report is the
//                   per-tick minimum over the runs: the same match each time (checked by a fingerprint), so what is
//                   left is what the game costs, not what the neighbours on a shared machine took
// Ticks timed: every tick after the first step (which builds the nav grid and the bots: the match load), warmup
// included (the countdown runs on the host too). On a shared machine run before/after alternately and take medians.
import { Session } from 'node:inspector';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS } from '../js/shared/map.js';
import { SIM_HZ } from '../js/shared/constants.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const STEP = 1 / SIM_HZ;
const SEED = Number(opt('seed', 5));
const SPIKE = Number(opt('spike', 4));
const TOP = Number(opt('top', 6));
const PROFILE = !args.includes('--no-profile');
const INTERVAL = Number(opt('interval', 100));
const GC_EVERY = Number(opt('gc-every', 300));
const FORCE_GC = typeof globalThis.gc === 'function';
const STATS = args.includes('--stats');
const ALLOC = args.includes('--alloc');
const SECS = opt('secs', null);

// Graveyard Shift at a late round, as dev/sim-zombies.mjs's perf section sets it up: every gate open, the crew held
// on its feet, the horde kept full.
async function zmLate(sim, round) {
  while (sim.phase !== 'live') { sim.step(STEP); sim.drainEvents(); }
  const R = sim.rules;
  const { syncZmDoors, reblockNav } = await import('../js/shared/zombies.js');
  for (const d of R.L.doors) R.open |= 1 << d.i;
  syncZmDoors(sim.map, R.open);
  for (const d of R.L.doors) reblockNav(sim.nav, sim.map, d);
  // The crew takes its hits but never goes down, so the match does not end under the measurement.
  const dmg0 = R.damage.bind(R);
  R.damage = (t, ...a) => { const v = dmg0(t, ...a); return R.isZ(t) ? v : Math.min(v, Math.max(0, t.hp - 1)); };
  R._startRound(round);
  for (let k = 0; k < 200 && R.horde.some(p => !p.alive); k++) { R.spawnT = 0; R._stepSpawns(STEP); }
  return () => { for (const z of R.horde) if (!z.alive) { R.spawnT = 0; R._stepSpawns(STEP); } };
}

const SCENARIOS = {
  'br-frontier': { mode: 'br', map: 'frontier', secs: 1500 },
  'br-jadefall': { mode: 'br', map: 'jadefall', secs: 1500 },
  'br-meridian': { mode: 'br', map: 'meridian', secs: 1500 },
  'gw-harvest': { mode: 'gwtdm', map: 'harvest', secs: 240 },
  'gw-tidebreak': { mode: 'gwtdm', map: 'tidebreak', secs: 240 },
  'cq-meridian': { mode: 'cq', map: 'meridian', secs: 240 },
  'bt-meridian': { mode: 'bt', map: 'meridian', secs: 240 },
  'zm-r20': { mode: 'zm', map: 'saltmere', secs: 60, setup: s => zmLate(s, 20), clean: true },
  'zm-r30': { mode: 'zm', map: 'saltmere', secs: 60, setup: s => zmLate(s, 30), clean: true },
  'tdm-6v6': { mode: 'tdm', map: 'harbor', secs: 240 },
};

// ---- Sampling profile, cut by tick ----
const session = new Session();
session.connect();
const post = (m, p = {}) => { let out, err; session.post(m, p, (e, r) => { err = e; out = r; }); if (err) throw err; return out; };
const nowUs = () => Number(process.hrtime.bigint() / 1000n);

// Self time per tick window: for each sample inside [t0, t1), the leaf frame and the phase (the frame under _tick).
const GAP_K = 4;
function cutProfile(profile, windows, detailed) {
  const nodes = new Map();
  for (const n of profile.nodes) nodes.set(n.id, n);
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const label = n => {
    const f = n.callFrame, file = f.url ? f.url.slice(f.url.lastIndexOf('/') + 1) : '';
    return `${f.functionName || '(anon)'}${file ? ` ${file}:${f.lineNumber + 1}` : ''}`;
  };
  // Phase: the call under Sim._tick; under a bot's update, the BotBrain method under think/update (or the module
  // function it called), so a spike reads "bots > _thinkThreats".
  const phaseCache = new Map();
  const phaseOf = id => {
    if (phaseCache.has(id)) return phaseCache.get(id);
    const chain = [];
    for (let k = id; k != null; k = parent.get(k)) chain.push(nodes.get(k));
    chain.reverse();
    let ph = '(outside tick)';
    const ti = chain.findIndex(n => n.callFrame.functionName === '_tick');
    if (ti >= 0) {
      const a = chain[ti + 1];
      ph = a ? a.callFrame.functionName || '(anon)' : '_tick';
      if (a && (ph === 'update' || ph === 'driveBot')) {
        const ui = chain.findIndex((n, i) => i > ti && (n.callFrame.functionName === 'think' || n.callFrame.functionName === 'drive'));
        const b = ui >= 0 ? chain[ui + 1] : chain[ti + 2];
        ph = `bot.${ui >= 0 ? chain[ui].callFrame.functionName + '>' : ''}${b ? b.callFrame.functionName || '(anon)' : 'self'}`;
      }
    } else if (chain.some(n => n.callFrame.functionName === '(garbage collector)')) ph = '(gc)';
    const leaf = nodes.get(id);
    if (leaf.callFrame.functionName === '(garbage collector)') ph = '(gc)';
    phaseCache.set(id, ph);
    return ph;
  };
  // Each sample stands for the time up to the next one. A gap of more than GAP_K intervals means the thread was not
  // running (the OS or the hypervisor took the core: on this shared machine that is most single slow ticks); the sample
  // keeps one interval and the rest counts as '(descheduled)', not as the leaf's time.
  const out = windows.map((wd, k) => ({ busy: 0, self: detailed(k) ? new Map() : null, phase: detailed(k) ? new Map() : null }));
  const n = profile.samples.length, dt = profile.timeDeltas;
  const ts = new Float64Array(n + 1);
  let t = profile.startTime;
  for (let i = 0; i < n; i++) { t += dt[i]; ts[i] = t; }
  ts[n] = Math.max(t, profile.endTime ?? t);
  const add = (o, l, ph, v) => { o.self.set(l, (o.self.get(l) ?? 0) + v); o.phase.set(ph, (o.phase.get(ph) ?? 0) + v); };
  let i = 0;
  for (let w = 0; w < windows.length; w++) {
    const { t0, t1 } = windows[w], o = out[w];
    while (i < n && ts[i + 1] <= t0) i++;
    for (let j = i; j < n && ts[j] < t1; j++) {
      const s0 = ts[j], e0 = ts[j + 1], live = e0 - s0 > GAP_K * INTERVAL ? s0 + INTERVAL : e0;
      const a = Math.max(t0, s0), b = Math.min(t1, live), c = Math.min(t1, e0);
      const v = Math.max(0, b - a), gap = Math.max(0, c - Math.max(t0, live));
      o.busy += v;
      if (o.self) {
        const id = profile.samples[j];
        if (v > 0) add(o, label(nodes.get(id)), phaseOf(id), v);
        if (gap > 0) add(o, '(descheduled)', '(descheduled)', gap);
      }
    }
  }
  return out;
}

const gcEntries = [];
new PerformanceObserver(list => { for (const e of list.getEntries()) gcEntries.push({ t0: e.startTime, t1: e.startTime + e.duration, kind: e.detail?.kind ?? e.kind }); })
  .observe({ entryTypes: ['gc'] });
const yieldLoop = () => new Promise(r => setImmediate(r));

// One run of a scenario, in this process: per-tick wall time, running time (sampled), GC, and the profile cut for
// every slow tick. Returns plain data (a child process hands it to the parent as JSON).
async function runOnce(name, sc) {
  const roster = buildRoster([], { botSkill: 'mixed', mode: sc.mode, mapId: sc.map, seed: SEED });
  const sim = new Sim({ roster, map: sc.map, seed: SEED, mode: sc.mode });
  sim.warm = !args.includes('--cold');      // As the game's host does (js/game/match.js).
  const l0 = performance.now();
  sim.step(STEP);                       // The match load: nav grid, bots, the rules' onNav.
  const loadMs = performance.now() - l0;
  const keep = sc.setup ? await sc.setup(sim) : null;
  sim.drainEvents();
  const secs = Number(SECS ?? sc.secs);
  const end = Math.round(secs * SIM_HZ);
  const wall = [], perf0 = [], hr = [], live = [], cpu = [];
  const ev = { kill: 0, obj: 0, zkill: 0 };
  let stuck = 0, h = 0x811c9dc5;
  const hist = new Map();
  if (PROFILE) { post('Profiler.enable'); post('Profiler.setSamplingInterval', { interval: INTERVAL }); post('Profiler.start'); }
  if (ALLOC) { post('HeapProfiler.enable'); post('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
  gcEntries.length = 0;
  let chunkStart = 0;
  const profiles = [];
  for (let i = 0; i < end && sim.phase !== 'ended'; i++) {
    keep?.();
    if (FORCE_GC && i % GC_EVERY === GC_EVERY - 1) globalThis.gc();
    const c0 = process.cpuUsage(), h0 = nowUs(), w0 = performance.now();
    sim.step(STEP);
    const w1 = performance.now(), h1 = nowUs(), c1 = process.cpuUsage(c0);
    cpu.push((c1.user + c1.system) / 1000);
    wall.push(w1 - w0); perf0.push(w0); hr.push([h0, h1]); live.push(sim.phase === 'live' ? 1 : 0);
    for (const e of sim.drainEvents()) {
      if (e.t === 'kill') { ev.kill++; if (sim.mode === 'zm') ev.zkill++; }
      else if ((e.t === 'cq' || e.t === 'bt') && (e.kind === 'capture' || e.kind === 'neutral' || e.kind === 'retake' || e.kind === 'sector')) ev.obj++;
      else if (e.t === 'capture' || e.t === 'brchest' || e.t === 'brland') ev.obj++;
    }
    // A fingerprint of where everyone is, so runs of one scenario can be checked to be the same match.
    if (i % 30 === 0) for (const p of sim.players) { h = Math.imul(h ^ Math.round(p.ps.x * 100), 16777619) >>> 0; h = Math.imul(h ^ Math.round(p.ps.z * 100), 16777619) >>> 0; h = Math.imul(h ^ p.hp, 16777619) >>> 0; }
    if (i % SIM_HZ === 0 && sim.phase === 'live') {
      for (const p of sim.players) {
        if (!p.bot) continue;
        const hh = hist.get(p.id) ?? [];
        hh.push({ x: p.ps.x, z: p.ps.z, push: Math.hypot(p.bot.input.mx, p.bot.input.mz), alive: p.alive && !p.brAir && !p.downed });
        if (hh.length > 5) hh.shift();
        hist.set(p.id, hh);
        if (hh.length === 5 && hh.every(q => q.alive && q.push > 0.5) && Math.hypot(hh[4].x - hh[0].x, hh[4].z - hh[0].z) < 0.6) stuck++;
      }
    }
    // Let the GC observer deliver, and keep the profile in pieces (a whole BR match is a lot of samples).
    if (i % 900 === 899) {
      if (PROFILE) { profiles.push({ from: chunkStart, to: wall.length, p: post('Profiler.stop').profile }); post('Profiler.start'); chunkStart = wall.length; }
      await yieldLoop();
    }
  }
  if (PROFILE) profiles.push({ from: chunkStart, to: wall.length, p: post('Profiler.stop').profile });
  if (ALLOC) {
    // Bytes allocated per call site over the run (sampled; collected objects included): what feeds the collector.
    const prof = post('HeapProfiler.stopSampling').profile, sites = new Map();
    let total = 0;
    const walk = n => {
      const f = n.callFrame, k = `${f.functionName || '(anon)'} ${f.url.slice(f.url.lastIndexOf('/') + 1)}:${f.lineNumber + 1}`;
      if (n.selfSize) { sites.set(k, (sites.get(k) ?? 0) + n.selfSize); total += n.selfSize; }
      for (const c of n.children) walk(c);
    };
    walk(prof.head);
    const secsRun = wall.length / SIM_HZ;
    console.error(`\n${name}: about ${(total / secsRun / 1024).toFixed(0)} KB allocated a second; by site:`);
    for (const [k, v] of [...sites].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.error(`  ${(v / secsRun / 1024).toFixed(1).padStart(7)} KB/s  ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
  }
  await yieldLoop();
  // GC overlapping each tick, in ms.
  const gcIn = new Array(wall.length).fill(0);
  {
    let k = 0;
    const gcs = gcEntries.slice().sort((a, b) => a.t0 - b.t0);
    for (let i = 0; i < wall.length; i++) {
      const t0 = perf0[i], t1 = t0 + wall[i];
      while (k < gcs.length && gcs[k].t1 < t0) k++;
      for (let j = k; j < gcs.length && gcs[j].t0 < t1; j++) gcIn[i] += Math.max(0, Math.min(t1, gcs[j].t1) - Math.max(t0, gcs[j].t0));
    }
  }
  // Main-thread time per tick: the wall time the sampler saw the thread running (wall clock when not profiling).
  const busy = PROFILE ? new Array(wall.length).fill(0) : wall.slice();
  const detail = {};
  const topOf = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, +(v / 1000).toFixed(2)]);
  if (PROFILE) {
    for (const c of profiles) {
      const idx = [];
      for (let i = c.from; i < c.to; i++) idx.push(i);
      const cut = cutProfile(c.p, idx.map(i => ({ t0: hr[i][0], t1: hr[i][1] })), k => wall[idx[k]] >= SPIKE);
      idx.forEach((i, k) => {
        busy[i] = Math.min(wall[i], cut[k].busy / 1000);
        if (cut[k].self) detail[i] = { phase: topOf(cut[k].phase, 12), self: topOf(cut[k].self, 12) };
      });
    }
  }
  const liveTicks = live.reduce((a, b) => a + b, 0);
  return { name, wall, cpu, busy, gcIn, live, detail, loadMs, warmMs: sim.warmMs ?? 0, simMin: sim.time / 60, hash: h.toString(16), players: sim.players.length,
    kills: ev.kill, obj: ev.obj, stuck: stuck / Math.max(1, sim.players.length) / Math.max(1, liveTicks / SIM_HZ / 60) };
}

const pct = (arr, k) => { const s = Array.from(arr).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * k))] ?? 0; };
const f = (v, d = 2) => v.toFixed(d);

// Several runs of one scenario (each in a fresh process, so every run pays the cold start): the per-tick minimum is
// what the game itself costs (the same match each time; the neighbours' load and the OS are not the same twice).
function combine(name, sc, runs) {
  const n = Math.min(...runs.map(r => r.wall.length));
  const minWall = new Array(n), minBusy = new Array(n), from = new Array(n), minCpu = new Array(n);
  for (let i = 0; i < n; i++) {
    let b = 0;
    for (let r = 1; r < runs.length; r++) if (runs[r].wall[i] < runs[b].wall[i]) b = r;
    minWall[i] = runs[b].wall[i]; from[i] = b;
    minBusy[i] = Math.min(...runs.map(r => r.busy[i]));
    minCpu[i] = Math.min(...runs.map(r => r.cpu[i]));
  }
  const same = runs.every(r => r.hash === runs[0].hash);
  const firstLive = runs[0].live.indexOf(1);
  const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const res = { name, mode: sc.mode, map: sc.map, runs: runs.length, same, ticks: n, simMin: runs[0].simMin,
    load: pct(runs.map(r => r.loadMs), 0.5), warm: pct(runs.map(r => r.warmMs), 0.5), hash: runs[0].hash,
    // Single runs (medians over runs) and the per-tick minimum.
    one: { mean: pct(runs.map(r => mean(r.wall)), 0.5), p99: pct(runs.map(r => pct(r.wall, 0.99)), 0.5), p999: pct(runs.map(r => pct(r.wall, 0.999)), 0.5), worst: pct(runs.map(r => Math.max(...r.wall)), 0.5) },
    min: { mean: mean(minWall), p99: pct(minWall, 0.99), p999: pct(minWall, 0.999), worst: Math.max(...minWall), spikes: minWall.filter(v => v >= SPIKE).length,
      firstLive: firstLive >= 0 ? minWall[firstLive] : 0 },
    cpu: { mean: mean(minCpu), p99: pct(minCpu, 0.99), p999: pct(minCpu, 0.999), worst: Math.max(...minCpu) },
    run: PROFILE ? { p999: pct(minBusy, 0.999), worst: Math.max(...minBusy) } : null,
    kills: runs[0].kills, obj: runs[0].obj, stuck: runs[0].stuck };
  console.log(`\n== ${name} (${sc.mode} on ${sc.map}, seed ${SEED}): ${n} ticks (${f(res.simMin, 1)} sim min), ${runs.length} run${runs.length > 1 ? 's' : ''}${runs.length > 1 ? (same ? ', the same match each time' : ', NOT THE SAME MATCH (hashes differ)') : ''}, load ${f(res.load, 0)} ms (warm-up ${f(res.warm, 0)}), fingerprint ${res.hash}`);
  console.log(`   one run (median): mean ${f(res.one.mean)}  p99 ${f(res.one.p99)}  p99.9 ${f(res.one.p999)}  worst ${f(res.one.worst)} ms`);
  console.log(`   per-tick min:     mean ${f(res.min.mean)}  p99 ${f(res.min.p99)}  p99.9 ${f(res.min.p999)}  worst ${f(res.min.worst)} ms, first live tick ${f(res.min.firstLive)}, ticks >= ${SPIKE} ms: ${res.min.spikes}` +
    (res.run ? `   | running (sampled): p99.9 ${f(res.run.p999)} worst ${f(res.run.worst)}` : ''));
  console.log(`   process CPU, per-tick min (counts the collector's and compiler's threads too; little affected by the neighbours): mean ${f(res.cpu.mean)}  p99 ${f(res.cpu.p99)}  p99.9 ${f(res.cpu.p999)}  worst ${f(res.cpu.worst)}`);
  if (STATS) console.log(`   bots: kills ${res.kills}  objective ${res.obj}  stuck ${f(res.stuck)} bot-s/min`);
  // The slowest ticks by their minimum, each with the profile of its cleanest run.
  const order = minWall.map((v, i) => i).sort((a, b) => minWall[b] - minWall[a]);
  const aggP = new Map(), aggF = new Map();
  for (const i of order) {
    if (minWall[i] < SPIKE) break;
    const d = runs[from[i]].detail[i];
    if (!d) continue;
    for (const [k, v] of d.phase) aggP.set(k, (aggP.get(k) ?? 0) + v);
    for (const [k, v] of d.self) aggF.set(k, (aggF.get(k) ?? 0) + v);
  }
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([a, v]) => `${a} ${f(v, 1)}`).join(', ');
  if (aggP.size) {
    console.log(`   in spikes, by phase: ${top(aggP, 7)}`);
    console.log(`   in spikes, by function (self): ${top(aggF, 9)}`);
  }
  for (const i of order.slice(0, TOP)) {
    if (minWall[i] < SPIKE) break;
    const r = runs[from[i]], d = r.detail[i];
    console.log(`   tick ${i + 1} (${r.live[i] ? 'live' : 'warmup'}, t=${f((i + 1) / SIM_HZ, 1)} s): min ${f(minWall[i])} ms [${runs.map(q => f(q.wall[i], 1)).join(' ')}], gc ${f(r.gcIn[i])}` +
      (d ? `  | ${d.phase.slice(0, 3).map(([k, v]) => `${k} ${f(v, 1)}`).join(', ')}  | ${d.self.slice(0, 5).map(([k, v]) => `${k} ${f(v, 1)}`).join(', ')}` : ''));
  }
  res.topPhases = [...aggP].sort((a, b) => b[1] - a[1]).slice(0, 12);
  res.topFns = [...aggF].sort((a, b) => b[1] - a[1]).slice(0, 12);
  return res;
}

const ONE = opt('one', null);
if (ONE) {
  // Child: one run, the result as JSON on the file named.
  const r = await runOnce(ONE, SCENARIOS[ONE]);
  writeFileSync(opt('out', '/dev/stdout'), JSON.stringify(r));
  process.exit(0);
}
const REPEAT = Number(opt('repeat', 1));
const want = args.filter(a => !a.startsWith('--'));
const names = Object.keys(SCENARIOS).filter(n => !want.length || want.some(w => n.startsWith(w)));
console.log(`host tick spikes, node ${process.version}, ${REPEAT} run(s) a scenario${FORCE_GC ? `, full GC every ${GC_EVERY} ticks between ticks` : ''}${PROFILE ? `, sampling every ${INTERVAL} us` : ', no profile'}`);
const { execFileSync } = await import('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
const tmp = mkdtempSync('/tmp/tickspikes-');
const all = [];
for (const n of names) {
  const runs = [];
  for (let k = 0; k < REPEAT; k++) {
    const out = `${tmp}/${n}-${k}.json`;
    const pass = args.filter(a => !a.startsWith('--json=') && !a.startsWith('--repeat=') && a.startsWith('--'));
    execFileSync(process.execPath, [...process.execArgv, new URL(import.meta.url).pathname, `--one=${n}`, `--out=${out}`, ...pass], { stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 30 });
    runs.push(JSON.parse(readFileSync(out, 'utf8')));
  }
  all.push(combine(n, SCENARIOS[n], runs));
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\nscenario       runs   mean    p99  p99.9  worst  first-live  spikes  | cpu p99.9  worst   (per-tick min over runs; ms)`);
for (const r of all) console.log(`${r.name.padEnd(14)} ${String(r.runs).padStart(4)} ${f(r.min.mean).padStart(6)} ${f(r.min.p99).padStart(6)} ${f(r.min.p999).padStart(6)} ${f(r.min.worst, 1).padStart(6)} ${f(r.min.firstLive, 1).padStart(10)} ${String(r.min.spikes).padStart(7)}  | ${f(r.cpu.p999).padStart(9)} ${f(r.cpu.worst, 1).padStart(6)}` +
  `${STATS ? `   kills ${r.kills} obj ${r.obj} stuck ${f(r.stuck)}` : ''}${r.same ? '' : '  (runs differ!)'}`);
const json = opt('json', null);
if (json) writeFileSync(json, JSON.stringify(all.map(({ topPhases, topFns, ...r }) => ({ ...r, topPhases, topFns })), null, 1));
