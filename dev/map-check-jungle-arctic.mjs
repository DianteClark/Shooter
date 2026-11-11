// Checks the jungle and arctic maps: footprint and fields, reachability on the nav grid, passages a player cannot fit
// through, fairness of spawn-to-objective walks, the longest sight lines, then a headless bot match in every mode the
// map hosts, reporting kills, stuck bots and objective play.
//   node dev/map-check-jungle-arctic.mjs                  every map, static checks and bot matches
//   node dev/map-check-jungle-arctic.mjs ruins canopy     just these
//   node dev/map-check-jungle-arctic.mjs --static         skip the bot matches
//   node dev/map-check-jungle-arctic.mjs --ascii ruins    print the map as text (walls, water, spawns, points)
//   node dev/map-check-jungle-arctic.mjs --secs 60        bot match length in seconds (default 90)
// Exits non-zero when any check fails.
import { MAPS } from '../js/shared/map.js';
import { MODES, mapModes, modeFitsMap } from '../js/shared/modes.js';
import { NavGrid } from '../js/sim/nav.js';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { SIM_HZ, PLAYER_RADIUS } from '../js/shared/constants.js';
import { raycastMap } from '../js/shared/geometry.js';

const OURS = ['ruins', 'canopy', 'riverbend', 'expedition', 'icebreaker', 'frost'];
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const secsAt = args.indexOf('--secs');
const SECS = secsAt >= 0 ? Number(args[secsAt + 1]) : 90;
const ids = args.filter((a, i) => !a.startsWith('--') && !(secsAt >= 0 && i === secsAt + 1));
const todo = ids.length ? ids : OURS;
const FOOT = { small: [46, 58, 30, 38], medium: [64, 84, 42, 52], large: [92, 112, 56, 70], huge: [120, 150, 72, 92] };
const SIGHT = { small: 25, medium: 45, large: 75, huge: 100 };    // Longest open line allowed along a lane,
const SIGHT_ANY = { small: 30, medium: 52, large: 90, huge: 120 }; // and anywhere (edges included).
const MIN_GAP = 2 * PLAYER_RADIUS + 0.45;

let failures = 0;
const fail = (id, msg) => { failures++; console.log(`  FAIL ${id}: ${msg}`); };
const note = (msg) => console.log(`  ${msg}`);

function ascii(map) {
  const rows = [], nav = new NavGrid(map), d0 = walkField(nav, map.spawns[0]);
  for (let z = 0; z < map.height; z++) {
    let row = '';
    for (let x = 0; x < map.width; x++) {
      const cx = x + 0.5, cz = z + 0.5;
      // '?' walkable but cut off, ':' too close to something for a bot's path.
      let ch = !nav.blocked[z * nav.w + x] && !isFinite(d0[z * nav.w + x]) ? '?' : nav.blocked[z * nav.w + x] ? ':' : '.';
      for (const w of map.walls) {
        if (w.kind === 'border' || cx < w.x || cx > w.x + w.w || cz < w.z || cz > w.z + w.d) continue;
        ch = w.kind === 'water' ? '~' : w.blocksVision ? '#' : 'o';
        if (w.kind !== 'water') break;
      }
      for (const [t, list] of map.spawns.entries()) for (const s of list) if (Math.floor(s.x) === x && Math.floor(s.z) === z) ch = t ? 'R' : 'B';
      for (const p of map.points?.dom ?? []) if (Math.floor(p.x) === x && Math.floor(p.z) === z) ch = p.id;
      for (const p of map.points?.hard ?? []) if (Math.floor(p.x) === x && Math.floor(p.z) === z) ch = 'h';
      for (const p of map.points?.snd ?? []) if (Math.floor(p.x) === x && Math.floor(p.z) === z) ch = p.id.toLowerCase();
      for (const p of map.points?.ctf ?? []) if (Math.floor(p.x) === x && Math.floor(p.z) === z) ch = 'F';
      row += ch;
    }
    rows.push(`${String(z).padStart(3)} ${row}`);
  }
  console.log(rows.join('\n'));
}

// Walking distance (metres) on the nav grid from a set of start points to every cell; 8-neighbour Dijkstra.
function walkField(nav, starts) {
  const { w, h, blocked } = nav, n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const heap = [];
  const push = (k, d) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const s of starts) { const k = nav.nearestFree(s.x, s.z); if (dist[k] > 0) { dist[k] = 0; push(k, 0); } }
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
      if (di && dj && (blocked[j * w + ni] || blocked[nj * w + i])) continue;     // No corner cutting.
      const nd = d + (di && dj ? Math.SQRT2 : 1);
      if (nd < dist[nk]) { dist[nk] = nd; push(nk, nd); }
    }
  }
  return dist;
}

// Distance to the nearest walkable cell inside a zone of radius r (or the cell itself for r 0).
function zoneDist(nav, dist, p, r = 0) {
  let best = Infinity;
  const R = Math.max(r, 0.8);
  for (let j = Math.floor(p.z - R); j <= Math.ceil(p.z + R); j++) for (let i = Math.floor(p.x - R); i <= Math.ceil(p.x + R); i++) {
    if (i < 0 || j < 0 || i >= nav.w || j >= nav.h || Math.hypot(i + 0.5 - p.x, j + 0.5 - p.z) > R) continue;
    best = Math.min(best, dist[j * nav.w + i]);
  }
  return best;
}

function staticChecks(map) {
  const id = map.id, W = map.width, H = map.height;
  const f = FOOT[map.size];
  if (!f) fail(id, `size ${map.size}`);
  else if (W < f[0] || W > f[1] || H < f[2] || H > f[3]) fail(id, `${W}x${H} outside the ${map.size} footprint`);
  if (!['jungle', 'arctic'].includes(map.region)) fail(id, `region ${map.region}`);
  const huge = map.size === 'huge';
  if (huge && !(map.large && map.modes.includes('gwdom') && map.points.dom.length === 5)) fail(id, 'huge map needs GW modes and five flags');
  if (!huge) for (const m of ['tdm', 'kc', 'dom', 'hard', 'snd', 'ctf', 'ffa', 'gun']) if (!modeFitsMap(map, m)) fail(id, `does not host ${m}`);
  const ffaNeed = map.size === 'large' ? 12 : 8;
  if (map.spawns.flat().length < Math.max(ffaNeed, 16)) fail(id, `only ${map.spawns.flat().length} spawns`);

  // Walls inside the map and not overlapping the pieces they sit beside in a way that hides a gap.
  const walls = map.walls.filter(w => w.kind !== 'border');
  for (const w of walls) if (w.x < -0.01 || w.z < -0.01 || w.x + w.w > W + 0.01 || w.z + w.d > H + 0.01) fail(id, `wall outside the map ${JSON.stringify([w.x, w.z, w.w, w.d, w.kind])}`);
  // Passages narrower than a player: two movement blockers (or one and the map edge) closer than MIN_GAP but apart.
  const sep = (a, b) => Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.z - (b.z + b.d), b.z - (a.z + a.d)));
  const narrow = [];
  for (let i = 0; i < walls.length; i++) {
    const a = walls[i];
    for (let k = i + 1; k < walls.length; k++) {
      const b = walls[k], d = sep(a, b);
      if (d > 0.001 && d < MIN_GAP) narrow.push(`${d.toFixed(2)} m between [${[a.x, a.z, a.w, a.d].map(v => +v.toFixed(2))} ${a.kind}] and [${[b.x, b.z, b.w, b.d].map(v => +v.toFixed(2))} ${b.kind}]`);
    }
    for (const e of [a.x, a.z, W - a.x - a.w, H - a.z - a.d]) if (e > 0.001 && e < MIN_GAP) narrow.push(`${e.toFixed(2)} m between [${[a.x, a.z, a.w, a.d].map(v => +v.toFixed(2))} ${a.kind}] and the edge`);
  }
  for (const n of narrow) fail(id, `narrow gap ${n}`);

  // Nav: one connected walkable region holds every spawn and objective.
  const nav = new NavGrid(map);
  const d0 = walkField(nav, map.spawns[0]), d1 = walkField(nav, map.spawns[1]);
  for (const [t, list] of map.spawns.entries()) for (const s of list) {
    if (!nav.isWalkable(s.x, s.z)) fail(id, `team ${t} spawn ${s.x},${s.z} not walkable`);
    if (!isFinite((t ? d0 : d1)[nav.nearestFree(s.x, s.z)])) fail(id, `spawn ${s.x},${s.z} cut off from the other team`);
  }
  let isolated = 0;
  for (let k = 0; k < d0.length; k++) if (!nav.blocked[k] && !isFinite(d0[k])) isolated++;
  if (isolated > 0) note(`warn: ${isolated} walkable cells unreachable from the spawns (closed pockets)`);
  const P = map.points;
  const image = p => ({ x: W - p.x, z: H - p.z });
  const objs = [];
  for (const p of P.dom ?? []) objs.push({ kind: 'dom', ...p });
  for (const p of P.hard ?? []) objs.push({ kind: 'hard', ...p });
  for (const p of P.snd ?? []) objs.push({ kind: 'snd', ...p, r: 0 });
  for (const p of P.ctf ?? []) objs.push({ kind: 'ctf', ...p, r: 0 });
  const lines = [];
  for (const o of objs) {
    const a = zoneDist(nav, d0, o, o.r), b = zoneDist(nav, d1, o, o.r);
    if (!isFinite(a) || !isFinite(b)) { fail(id, `${o.kind} ${o.id} unreachable`); continue; }
    if ((o.kind === 'snd' || o.kind === 'ctf') && !nav.isWalkable(o.x, o.z)) fail(id, `${o.kind} ${o.id} not on walkable ground`);
    // Fairness: team 0 to this point against team 1 to its image.
    const b2 = zoneDist(nav, d1, { ...image(o) }, o.r);
    if (o.kind !== 'snd' && Math.abs(a - b2) / Math.max(a, b2, 1) > 0.1) fail(id, `${o.kind} ${o.id} unfair: ${a.toFixed(1)} m vs image ${b2.toFixed(1)} m`);
    lines.push(`${o.kind} ${o.id}: ${a.toFixed(0)}/${b.toFixed(0)}`);
  }
  if (P.snd?.length === 2) {
    const [sa, sb] = P.snd.map(s => zoneDist(nav, d0, s, 0));
    const [da, db] = P.snd.map(s => zoneDist(nav, d1, s, 0));
    lines.push(`snd attack ${sa.toFixed(0)}/${sb.toFixed(0)} defend ${da.toFixed(0)}/${db.toFixed(0)}`);
    if (Math.abs(sa - sb) / Math.max(sa, sb) > 0.25) fail(id, `snd sites far apart in attack walk: ${sa.toFixed(0)} vs ${sb.toFixed(0)}`);
    if (da >= sa || db >= sb) fail(id, 'snd defenders do not reach the sites first');
  }
  if (P.ctf?.length === 2) {
    const take0 = zoneDist(nav, d0, P.ctf[1], 0), take1 = zoneDist(nav, d1, P.ctf[0], 0);
    if (Math.abs(take0 - take1) > 0.5) fail(id, `ctf runs differ ${take0} vs ${take1}`);
    for (const fl of P.ctf) for (const s of map.spawns[fl.team]) if (Math.hypot(s.x - fl.x, s.z - fl.z) < 4) fail(id, `flag ${fl.id} on top of a spawn`);
  }
  note(`walks (team0/team1): ${lines.join(', ')}`);

  // Sight: the longest open horizontal line inside each lane band, and the longest anywhere.
  const run = (x, z, dx, dz, max) => { const hit = raycastMap(map, x, z, dx, dz, max, 'blocksVision'); return hit ? hit.t : max; };
  const laneSight = [];
  let worst = 0;
  for (const lane of map.lanes) {
    let best = 0;
    for (let z = lane.z - 2; z <= lane.z + 2; z += 0.5) for (let x = 0.5; x < W; x += 1) {
      if (!nav.isWalkable(x, z)) continue;
      best = Math.max(best, run(x, z, 1, 0, W));
    }
    laneSight.push(`${lane.id} ${best.toFixed(0)}`);
    worst = Math.max(worst, best);
  }
  const laneWorst = worst;
  let at = '';
  for (let z = 0.5; z < H; z += 0.5) for (let x = 0.5; x < W; x += 1) {
    if (!nav.isWalkable(x, z)) continue;
    const t = run(x, z, 1, 0, W);
    if (t >= worst) { worst = t; at = `from ${x},${z}`; }
  }
  note(`longest east-west lines per lane (m): ${laneSight.join(', ')}; anywhere ${worst.toFixed(0)} ${at}`);
  if (laneWorst > SIGHT[map.size]) fail(id, `a ${laneWorst.toFixed(0)} m open line along a lane, over ${SIGHT[map.size]} for ${map.size}`);
  if (worst > SIGHT_ANY[map.size]) fail(id, `a ${worst.toFixed(0)} m open line, over ${SIGHT_ANY[map.size]} for ${map.size}`);
  let open = 0;
  for (const s of map.spawns[0]) for (let a = -0.8; a <= 0.8; a += 0.1) open = Math.max(open, run(s.x, s.z, Math.cos(a), Math.sin(a), W));
  note(`longest line out of a team-0 spawn: ${open.toFixed(0)} m; nav ${nav.cover.length} cover, ${nav.holds.length} holds`);
  return nav;
}

// One bot match in a mode: everyone a regular-skill bot.
function botMatch(map, mode) {
  const def = MODES[mode];
  const roster = buildRoster([], { botSkill: 'regular', teamSize: def.ffa ? null : def.teamSize, mapId: map.id, mode, seed: 11 });
  const sim = new Sim({ roster, map: map.id, seed: 11, mode });
  const STEP = 1 / SIM_HZ;
  const ev = { kill: 0, capture: 0, hard: 0, planted: 0, defused: 0, exploded: 0, take: 0, ctfCap: 0 };
  const last = new Map(), stuckFor = new Map(), stuck = new Set();
  let held = 0;
  for (let i = 0; i < SECS * SIM_HZ; i++) {
    sim.step(STEP);
    for (const e of sim.drainEvents()) {
      if (e.t === 'kill') ev.kill++;
      else if (e.t === 'capture') ev.capture++;
      else if (e.t === 'hard_move') ev.hard++;
      else if (e.t === 'snd' && e.kind in ev) ev[e.kind]++;
      else if (e.t === 'ctf' && e.kind === 'take') ev.take++;
      else if (e.t === 'ctf' && e.kind === 'capture') ev.ctfCap++;
    }
    if (sim.phase !== 'live') { last.clear(); continue; }
    if (mode === 'hard' && sim.points[0]?.owner >= 0) held++;
    if (i % 15) continue;
    for (const p of sim.players) {
      const prev = last.get(p.id);
      last.set(p.id, { x: p.ps.x, z: p.ps.z });
      if (!p.alive || !prev || sim.sndFrozen) { stuckFor.set(p.id, 0); continue; }
      // Stuck: wants to be somewhere more than 4 m away (or past the objective's own radius) and has not moved for 8 s. A bot holding an angle or
      // sitting on a flag stands still on purpose.
      const moved = Math.hypot(p.ps.x - prev.x, p.ps.z - prev.z);
      const b = p.bot, far = b && Math.hypot(b.goalX - p.ps.x, b.goalZ - p.ps.z) > Math.max(4, (b.objective?.r ?? 0) + 1);
      const t = moved < 0.25 && far ? (stuckFor.get(p.id) || 0) + 0.5 : 0;
      stuckFor.set(p.id, t);
      if (t >= 8) stuck.add(`${p.id}@${p.ps.x.toFixed(0)},${p.ps.z.toFixed(0)}(${b.mode})`);
    }
  }
  return { ev, stuck: [...stuck], held: held / SIM_HZ, scores: sim.scores?.slice?.(0, 2) };
}

for (const id of todo) {
  const map = MAPS[id];
  if (!map) { fail(id, 'no such map'); continue; }
  if (flag('--ascii')) { ascii(map); continue; }
  console.log(`${id} (${map.name}, ${map.size} ${map.region}, ${map.width}x${map.height}, ${map.walls.length} walls)`);
  staticChecks(map);
  if (flag('--static')) continue;
  for (const mode of mapModes(map)) {
    if (!modeFitsMap(map, mode)) continue;
    const r = botMatch(map, mode);
    const e = r.ev, rules = MODES[mode].rules;
    let obj = '';
    if (rules === 'dom') obj = `captures ${e.capture}`;
    if (rules === 'hard') obj = `zone held ${r.held.toFixed(0)} s, moves ${e.hard}`;
    if (rules === 'snd') obj = `plants ${e.planted} defuses ${e.defused} blasts ${e.exploded}`;
    if (rules === 'ctf') obj = `takes ${e.take} captures ${e.ctfCap}`;
    note(`${mode.padEnd(5)} kills ${String(e.kill).padStart(3)}  ${obj}${r.stuck.length ? `  STUCK ${r.stuck.join(' ')}` : ''}`);
    if (e.kill === 0) fail(id, `${mode}: no kills in ${SECS} s`);
    if (r.stuck.length) fail(id, `${mode}: ${r.stuck.length} bots stuck 8 s`);
    if (rules === 'dom' && e.capture === 0) fail(id, `${mode}: no flag captured`);
    if (rules === 'hard' && r.held < 5) fail(id, `${mode}: hardpoint never held`);
    if (rules === 'snd' && e.planted === 0 && e.kill < 6) fail(id, `${mode}: no plant and few kills`);
    if (rules === 'ctf' && e.take === 0) fail(id, `${mode}: no flag taken`);
  }
}
console.log(failures ? `${failures} failures` : 'all checks passed');
process.exit(failures ? 1 : 0);
