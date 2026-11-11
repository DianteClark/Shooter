// Checks the Metro and Desert maps: footprint for the size tier, nav reach, narrow gaps, fairness, sight lines, and a
// headless bot match in every mode each map hosts.
//   node dev/map-check-metro-desert.mjs                  every map, 90 s bot matches
//   node dev/map-check-metro-desert.mjs oasis canyon     just these
//   node dev/map-check-metro-desert.mjs --quick          static checks only, no bot matches
//   node dev/map-check-metro-desert.mjs --secs=30        shorter bot matches
// Exits non-zero when a check fails. Bot-match numbers are reported; a match fails only when bots are stuck walking
// into scenery, nobody dies, or an objective mode never sees its objective played (capture, plant or flag touch).
import { MAPS } from '../js/shared/map.js';
import { MODES, SND, mapModes, modeFitsMap } from '../js/shared/modes.js';
import { NavGrid } from '../js/sim/nav.js';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { SIM_HZ, PLAYER_RADIUS } from '../js/shared/constants.js';
import { raycastMap } from '../js/shared/geometry.js';

const OURS = ['turnstile', 'neon', 'overpass', 'downtown', 'oasis', 'dust', 'canyon'];
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const secs = +(args.find(a => a.startsWith('--secs='))?.slice(7) ?? 90);
const ids = args.filter(a => !a.startsWith('--'));
const TIERS = { small: [46, 58, 30, 38], medium: [60, 84, 42, 52], large: [92, 112, 56, 70], huge: [120, 150, 72, 92] };
const LOS_LIMIT = { small: 25, medium: 35, large: 55, huge: 70 };   // A sight line past this is "long" for the tier.
const MIN_GAP = 2 * PLAYER_RADIUS + 0.15;

let failures = 0;
const fail = (map, msg) => { failures++; console.log(`  FAIL ${map}: ${msg}`); };
const info = msg => console.log(`  ${msg}`);

// Multi-source Dijkstra over the nav grid, 8-connected without cutting corners. Returns metres per cell.
function distances(nav, sources) {
  const { w, h, blocked } = nav;
  const dist = new Float64Array(w * h).fill(Infinity);
  const heap = [];
  const push = (k, d) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const s of sources) { const k = nav.nearestFree(s.x, s.z); if (dist[k] > 0) { dist[k] = 0; push(k, 0); } }
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]) continue;
    const i = k % w, j = (k - i) / w;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nk = nj * w + ni;
      if (blocked[nk]) continue;
      if (di && dj && (blocked[j * w + ni] || blocked[nj * w + i])) continue;
      const nd = d + (di && dj ? Math.SQRT2 : 1);
      if (nd < dist[nk]) { dist[nk] = nd; push(nk, nd); }
    }
  }
  return dist;
}

// Distance to an objective zone: the nearest walkable cell inside 90% of its radius.
function zoneDist(nav, dist, p) {
  const r = (p.r ?? 1) * 0.9;
  let best = Infinity;
  for (let j = Math.floor(p.z - r); j <= p.z + r; j++) for (let i = Math.floor(p.x - r); i <= p.x + r; i++) {
    if (i < 0 || j < 0 || i >= nav.w || j >= nav.h) continue;
    if (Math.hypot(i + 0.5 - p.x, j + 0.5 - p.z) > Math.max(r, 0.8)) continue;
    best = Math.min(best, dist[j * nav.w + i]);
  }
  return best;
}

function checkStatic(id, map) {
  const nav = new NavGrid(map);
  const tier = TIERS[map.size];
  if (!tier) fail(id, `size '${map.size}' is not a tier`);
  else if (map.width < tier[0] || map.width > tier[1] || map.height < tier[2] || map.height > tier[3]) fail(id, `${map.width} x ${map.height} is outside the ${map.size} footprint`);
  if (!['metro', 'desert'].includes(map.region)) fail(id, `region '${map.region}'`);
  if (map.size === 'huge' && !(map.large && map.modes?.join() === 'gwtdm,gwdom')) fail(id, 'huge map must be Ground War only');
  if (map.size !== 'huge') for (const m of ['dom', 'hard', 'snd', 'ctf', 'ffa', 'gun', 'tdm', 'kc']) if (!modeFitsMap(map, m)) fail(id, `does not host ${m}`);
  if (map.size === 'huge' && map.points.dom.length !== 5) fail(id, 'Ground War Domination needs five flags');
  const spawnCount = map.spawns.flat().length;
  if (spawnCount < (map.size === 'large' || map.size === 'huge' ? 24 : 16)) fail(id, `only ${spawnCount} spawns`);

  // Reach: everything from team 0's spawns; walkable cells nobody can reach are pockets.
  const all = map.spawns.flat();
  for (const s of all) if (!nav.isWalkable(s.x, s.z)) fail(id, `spawn ${s.x},${s.z} is not walkable`);
  const reach = distances(nav, map.spawns[0]);
  const objectives = [...(map.points.dom || []), ...(map.points.hard || []), ...(map.points.snd || []), ...(map.points.ctf || []).map(p => ({ ...p, r: 1.2 }))];
  for (const p of [...all.map(s => ({ ...s, r: 1 })), ...objectives]) if (!Number.isFinite(zoneDist(nav, reach, p))) fail(id, `unreachable ${p.id ?? 'spawn'} at ${p.x},${p.z}`);
  let pocket = 0, open = 0;
  for (let k = 0; k < reach.length; k++) if (!nav.blocked[k]) { open++; if (!Number.isFinite(reach[k])) pocket++; }
  if (pocket) fail(id, `${pocket} walkable cells cannot be reached (sealed pockets)`);
  for (const l of map.lanes) {
    let run = 0; for (let i = 0; i < nav.w; i++) if (Number.isFinite(reach[Math.floor(l.z) * nav.w + i])) run++;
    if (run < nav.w * 0.35) fail(id, `lane ${l.id} (z ${l.z}) is walkable on only ${run} of ${nav.w} cells`);
  }

  // Gaps between two pieces of scenery that a player could not fit through but might try.
  const solid = map.walls.filter(w => w.kind !== 'water');
  for (let a = 0; a < solid.length; a++) for (let b = a + 1; b < solid.length; b++) {
    const p = solid[a], q = solid[b];
    if (p.kind === 'border' && q.kind === 'border') continue;
    const gx = Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w));
    const gz = Math.max(q.z - (p.z + p.d), p.z - (q.z + q.d));
    // Facing each other across a gap (overlapping by at least a player on the other axis).
    const narrow = (gx > 0.02 && gx < MIN_GAP && gz < -0.9) || (gz > 0.02 && gz < MIN_GAP && gx < -0.9);
    // A third piece filling the gap (a wall between a bench and the stairs behind it) makes it no gap at all.
    const mx = gx > 0 ? (p.x < q.x ? p.x + p.w + gx / 2 : q.x + q.w + gx / 2) : (Math.max(p.x, q.x) + Math.min(p.x + p.w, q.x + q.w)) / 2;
    const mz = gz > 0 ? (p.z < q.z ? p.z + p.d + gz / 2 : q.z + q.d + gz / 2) : (Math.max(p.z, q.z) + Math.min(p.z + p.d, q.z + q.d)) / 2;
    if (narrow && solid.some(o => o !== p && o !== q && mx >= o.x && mx <= o.x + o.w && mz >= o.z && mz <= o.z + o.d)) continue;
    if (narrow) fail(id, `narrow gap ${Math.max(gx, gz).toFixed(2)} m between ${p.kind}@${p.x},${p.z} and ${q.kind}@${q.x},${q.z}`);
  }
  // Spawns too close to scenery to move off cleanly.
  for (const s of all) for (const w of map.walls) {
    const dx = Math.max(w.x - s.x, 0, s.x - w.x - w.w), dz = Math.max(w.z - s.z, 0, s.z - w.z - w.d);
    if (w.kind !== 'border' && Math.hypot(dx, dz) < PLAYER_RADIUS + 0.4) fail(id, `spawn ${s.x},${s.z} hugs a ${w.kind}`);
  }

  // Fairness: each team's path distance to the objectives the 180-degree image hands it.
  const d0 = reach, d1 = distances(nav, map.spawns[1]);
  const compare = (label, list0, list1) => {
    for (let i = 0; i < list0.length; i++) {
      const a = zoneDist(nav, d0, list0[i]), b = zoneDist(nav, d1, list1[i]);
      const diff = Math.abs(a - b) / Math.max(1, Math.min(a, b));
      if (diff > 0.1 && Math.abs(a - b) > 1.5) fail(id, `${label} ${list0[i].id}: team 0 walks ${a.toFixed(1)} m, team 1 ${b.toFixed(1)} m`);
    }
  };
  const image = p => ({ ...p, x: map.width - p.x, z: map.height - p.z });
  const dom = map.points.dom;
  compare('dom', dom, dom.map(p => dom.reduce((best, q) => (Math.hypot(q.x - image(p).x, q.z - image(p).z) < Math.hypot(best.x - image(p).x, best.z - image(p).z) ? q : best))));
  if (map.points.hard?.length) compare('hard', map.points.hard, map.points.hard.map(image));
  if (map.points.ctf?.length) compare('ctf (to enemy flag)', [{ ...map.points.ctf[1], r: 1.2 }], [{ ...map.points.ctf[0], r: 1.2 }]);
  const domTxt = dom.map(p => `${p.id} ${zoneDist(nav, d0, p).toFixed(0)}/${zoneDist(nav, d1, p).toFixed(0)}`).join('  ');
  let sndTxt = '';
  if (map.points.snd?.length === 2) {
    const [A, B] = map.points.snd;
    const att = [zoneDist(nav, d0, A), zoneDist(nav, d0, B)], def = [zoneDist(nav, d1, A), zoneDist(nav, d1, B)];
    sndTxt = `  snd attack ${att.map(v => v.toFixed(0)).join('/')} defend ${def.map(v => v.toFixed(0)).join('/')}`;
    // S&D is asymmetric by design (see bombSites); its balance is judged by the bot matches below, not by distances.
    for (let i = 0; i < 2; i++) if (def[i] > att[i] * 1.1) fail(id, `S&D site ${i ? 'B' : 'A'}: defenders (${def[i].toFixed(0)} m) are farther than attackers (${att[i].toFixed(0)} m)`);
  }

  // Sight lines: from every open cell, the clear run east and the clear run north. Fraction past the tier's limit.
  const lim = LOS_LIMIT[map.size] ?? 40;
  let longest = 0, longRuns = 0, samples = 0;
  for (let j = 0; j < nav.h; j += 2) for (let i = 0; i < nav.w; i += 2) {
    if (nav.blocked[j * nav.w + i]) continue;
    for (const [dx, dz] of [[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]]) {
      const hit = raycastMap(map, i + 0.5, j + 0.5, dx, dz, 200, 'blocksVision');
      const t = hit ? hit.t : 200;
      samples++; longest = Math.max(longest, t); if (t > lim) longRuns++;
    }
  }
  info(`${id}: ${map.size} ${map.region} ${map.width}x${map.height}, ${open} open cells, ${map.walls.length} walls, ${spawnCount} spawns`);
  info(`   dom path t0/t1: ${domTxt}${sndTxt}`);
  info(`   sight: longest ${longest.toFixed(0)} m, ${(100 * longRuns / samples).toFixed(1)}% of rays past ${lim} m`);
  return nav;
}

function botMatch(id, map, mode, seed = 11) {
  const roster = buildRoster([], { botSkill: mode === 'snd' ? 'mixed' : 'regular', mapId: id, mode, seed });
  const sim = new Sim({ roster, map: id, seed, mode });
  const STEP = 1 / SIM_HZ;
  const track = new Map(sim.players.map(p => [p, { samples: [], stuck: false }]));
  const stuckAt = [];
  const ev = { kill: 0, capture: 0, planted: 0, ctfTake: 0, ctfCapture: 0, hardMove: 0, defused: 0, exploded: 0 };
  let liveT = 0;
  // Search and Destroy rounds mostly end in a wipe, so it plays whole matches (two of them, see below).
  const length = mode === 'snd' ? 1500 : secs;
  for (let n = 0; n < length * SIM_HZ && sim.phase !== 'ended'; n++) {
    sim.step(STEP);
    if (sim.phase === 'live') liveT += STEP;
    for (const e of sim.drainEvents()) {
      if (e.t === 'kill') ev.kill++;
      else if (e.t === 'capture') ev.capture++;
      else if (e.t === 'hard_move') ev.hardMove++;
      else if (e.t === 'snd' && e.kind === 'planted') ev.planted++;
      else if (e.t === 'snd' && e.kind === 'defused') ev.defused++;
      else if (e.t === 'snd' && (e.kind === 'boom' || e.kind === 'exploded')) ev.exploded++;
      else if (e.t === 'ctf' && e.kind === 'take') ev.ctfTake++;
      else if (e.t === 'ctf' && e.kind === 'capture') ev.ctfCapture++;
    }
    if (sim.phase !== 'live' || n % SIM_HZ) continue;
    // Once a second: a bot that has wanted to walk somewhere for 8 s, with nobody in sight, and is still within 1.5 m
    // of where it was is stuck. Standing still on purpose (holding an angle, sitting on a flag, trading shots) is play.
    for (const p of sim.players) {
      const tr = track.get(p), b = p.bot;
      const away = b ? Math.hypot(b.goalX - p.ps.x, b.goalZ - p.ps.z) : 0;
      const wants = !!b && p.alive && !b.targetVisible && away > 2.5 && Math.hypot(b.input.mx, b.input.mz) > 0.3;
      tr.samples.push(wants ? [p.ps.x, p.ps.z] : null);
      if (tr.samples.length > 9) tr.samples.shift();
      if (tr.samples.length < 9 || tr.samples.some(q => !q)) { tr.stuck = false; continue; }
      const [x0, z0] = tr.samples[0];
      const still = tr.samples.every(([x, z]) => Math.hypot(x - x0, z - z0) < 1.5);
      if (still && !tr.stuck) { tr.stuck = true; stuckAt.push(`${p.ps.x.toFixed(1)},${p.ps.z.toFixed(1)}->${b.goalX.toFixed(1)},${b.goalZ.toFixed(1)}(${b.mode})`); }
      if (!still) tr.stuck = false;
    }
  }
  const objective = MODES[mode].rules;
  const played = objective === 'dom' ? ev.capture > 0 : objective === 'hard' ? ev.capture > 0 : objective === 'snd' ? ev.planted > 0 : objective === 'ctf' ? ev.ctfTake > 0 : true;
  const line = `${mode.padEnd(6)} ${liveT.toFixed(0)}s live, kills ${ev.kill}, captures ${ev.capture}, plants ${ev.planted}, flag takes ${ev.ctfTake}/caps ${ev.ctfCapture}, stuck ${stuckAt.length}`;
  info(`   ${line}${stuckAt.length ? '  ' + stuckAt.slice(0, 4).join(' ') : ''}`);
  if (!ev.kill) fail(id, `${mode}: no kills`);
  if (!played && mode !== 'snd') fail(id, `${mode}: objective never played`);
  if (stuckAt.length > 1) fail(id, `${mode}: ${stuckAt.length} bots stuck`);
  if (sim.snd) {
    ev.rounds = sim.snd.history.length;
    ev.attackWins = sim.snd.history.filter((h, i) => h.winner === (i < SND.halftime ? 0 : 1)).length;
  }
  return ev;
}

for (const id of ids.length ? ids : OURS) {
  const map = MAPS[id];
  if (!map) { fail(id, 'not registered'); continue; }
  checkStatic(id, map);
  if (quick) continue;
  for (const mode of mapModes(map)) {
    if (!modeFitsMap(map, mode)) continue;
    if (mode !== 'snd') { botMatch(id, map, mode); continue; }
    // Three whole matches: between them the bots have to plant, and neither side may be hopeless.
    const runs = [1, 2, 3].map(seed => botMatch(id, map, mode, seed));
    const plants = runs.reduce((n, r) => n + r.planted, 0), rounds = runs.reduce((n, r) => n + r.rounds, 0);
    const att = runs.reduce((n, r) => n + r.attackWins, 0);
    info(`   snd    attackers took ${att} of ${rounds} rounds, ${plants} plants`);
    if (!plants) fail(id, 'snd: three whole matches without a plant');
    if (att < rounds * 0.2 || att > rounds * 0.8) fail(id, `snd: attackers took ${att} of ${rounds} rounds`);
  }
}
console.log(failures ? `${failures} failure(s)` : 'all checks passed');
process.exit(failures ? 1 : 0);
