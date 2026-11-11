// Map validator: runs over every registered map (or the ones named) and checks the rules in docs/MAPS-OVERHAUL.md.
//   node dev/map-validate.mjs                    every map in MAP_IDS, geometry checks and a 60 s bot match per mode
//   node dev/map-validate.mjs pier foundry       just these
//   node dev/map-validate.mjs --quick            geometry only, no bot matches
//   node dev/map-validate.mjs --seconds=30 --modes=tdm,dom --ascii --all   (--all lists every gap)
// Checks, per map:
//   fields     size and region set and known; footprint inside the size tier's range; modes the tier must host
//   nav        the nav grid (js/sim/nav.js) reaches every spawn, objective, lane and waypoint from the first spawn;
//              walkable pockets nobody can reach are listed (a player pushed in there would be trapped)
//   gaps       two blocking pieces closer than a player can pass (2 x PLAYER_RADIUS + margin) but not touching:
//              they look passable and are not
//   fair       mean walking distance from each team's spawns to every objective, compared with the other team's to the
//              objective's counterpart (the same point for a shared one): within 10%
//   sight      the longest clear sight line from walkable ground, and the share of long ones, against the tier
//   bots       a bot-only match per mode the map hosts: kills, objective events, bots stuck pushing into a wall
//   giant      (size 'giant', battle royale maps, docs/BR.md) the br contract (places, loot, caches, circle bias),
//              every place, loot spot and cache reachable, no sealed rooms (every room floor reachable), door gaps at
//              least 2 m; no fairness check (nobody spawns in teams); sight sampled coarser; instead of the mode's own
//              match (the sim cannot host 'br' here) a 32-bot free roam under Ground War TDM rules for 120 s
//              (--seconds doubles) for stuck bots and the host's tick cost (fails over 4 ms mean)
// Exits non-zero if any map fails a hard check (fields, nav, gaps, fair, bots); sight lines are reported, not failed.
import { MAPS, MAP_IDS, BR_MAP_IDS, sizeOf, REGIONS } from '../js/shared/map.js';
import { MODES, mapModes, modeFitsMap, playersFor, isFfa, teamSizeFor } from '../js/shared/modes.js';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { NavGrid } from '../js/sim/nav.js';
import { raycastMap } from '../js/shared/geometry.js';
import { PLAYER_RADIUS, SIM_HZ } from '../js/shared/constants.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const QUICK = args.includes('--quick'), ASCII = args.includes('--ascii'), ARGS_ALL = args.includes('--all');
const SECONDS = Number(opt('seconds', 60));
const ONLY_MODES = opt('modes', null)?.split(',');
const ids = args.filter(a => !a.startsWith('--'));
const todo = ids.length ? ids : [...MAP_IDS, ...BR_MAP_IDS];

const GAP = 2 * PLAYER_RADIUS + 0.1;           // Narrower than this and a player cannot get through (or only by luck).
const TOUCH = 0.05;                            // Closer than this counts as touching: no gap at all.
const FOOTPRINT = { small: [[46, 58], [30, 38]], medium: [[64, 84], [42, 52]], large: [[92, 112], [56, 70]], huge: [[120, 150], [72, 92]] };
const STANDARD = ['tdm', 'kc', 'dom', 'hard', 'snd', 'ctf', 'ffa', 'gun'];
const SIGHT = { small: 25, medium: 40, large: 50, huge: 60, giant: 80 };   // Longest line the tier is built around.

// ---- Checks ---------------------------------------------------------------------------------------------------------

const isGiant = map => map.size === 'giant';

function checkFields(map, size, out) {
  if (isGiant(map)) return checkGiantFields(map, out);
  if (!map.size) out.warn.push('no size field (counts as medium)');
  if (!map.region) out.warn.push('no region field');
  else if (!REGIONS[map.region]) out.fail.push(`unknown region '${map.region}'`);
  const [[w0, w1], [h0, h1]] = FOOTPRINT[size];
  if (map.width < w0 || map.width > w1 || map.height < h0 || map.height > h1) {
    (map.size ? out.fail : out.warn).push(`footprint ${map.width} x ${map.height} outside ${size} (${w0}-${w1} x ${h0}-${h1})`);
  }
  const hosts = mapModes(map).filter(m => modeFitsMap(map, m));
  const need = size === 'huge' ? ['gwtdm', 'gwdom'] : STANDARD;
  const missing = need.filter(m => !hosts.includes(m));
  if (missing.length) out.fail.push(`does not host ${missing.join(', ')}`);
  if (size === 'huge' && (map.points?.dom?.length ?? 0) < 5) out.fail.push('huge map needs five Domination flags');
  const seats = Math.max(...hosts.filter(isFfa).map(m => playersFor(m, map)), 0);
  const spawnCount = map.spawns.flat().length;
  if (seats && spawnCount < seats) out.fail.push(`${spawnCount} spawns for ${seats} free-for-all players`);
  out.info.push(`${size} ${map.region ?? '-'} ${map.width}x${map.height}, ${map.walls.length} walls, modes ${hosts.join(' ')}`);
}

// The battle royale contract (docs/BR.md).
function checkGiantFields(map, out) {
  const br = map.br;
  if (map.width < 380 || map.width > 480 || map.height < 380 || map.height > 480) out.fail.push(`footprint ${map.width} x ${map.height} outside giant (380-480)`);
  if (!(map.modes?.length === 1 && map.modes[0] === 'br') || !map.large) out.fail.push("giant map must list modes ['br'] and large: true");
  if (!br) { out.fail.push('no br block'); return; }
  const n = (k, lo, hi) => { const c = br[k]?.length ?? 0; if (c < lo || c > hi) out.fail.push(`br.${k}: ${c} (wants ${lo}-${hi})`); return c; };
  n('pois', 12, 18); n('loot', 500, 900); n('chests', 30, 60);
  for (const p of br.pois) if (!p.id || !p.name || !(p.r > 0) || !REGIONS[p.region] || ![1, 2, 3].includes(p.tier)) out.fail.push(`poi ${p.id}: bad fields`);
  const inside = l => l.x > 0 && l.z > 0 && l.x < map.width && l.z < map.height;
  if (!br.loot.every(l => inside(l) && [1, 2, 3].includes(l.tier) && typeof l.indoor === 'boolean')) out.fail.push('loot spot with bad fields');
  if (!(br.drop === null || (br.drop?.from && br.drop?.to))) out.fail.push('br.drop must be null or {from, to}');
  const indoor = br.loot.filter(l => l.indoor).length;
  if (indoor * 2 < br.loot.length) out.fail.push(`only ${indoor} of ${br.loot.length} loot spots indoors`);
  const tiers = [1, 2, 3].map(t => br.loot.filter(l => l.tier === t).length);
  out.info.push(`giant ${map.width}x${map.height}, ${map.walls.length} walls, ${br.pois.length} places, loot ${br.loot.length} (${indoor} indoors; tiers ${tiers.join('/')}), ${br.chests.length} caches, ${map.roofs?.length ?? 0} buildings`);
}

// Battle royale reachability: every place, loot spot and cache, every room's floor (no sealed rooms) and door widths.
function checkGiant(map, nav, reach, out) {
  const br = map.br;
  for (const p of br.pois) if (!reachableNear(nav, reach, p.x, p.z, Math.min(6, p.r))) out.fail.push(`poi ${p.id} unreachable`);
  const lost = [...br.loot, ...br.chests].filter(l => !reachableNear(nav, reach, l.x, l.z, 0.6));
  if (lost.length) out.fail.push(`${lost.length} loot spots/caches unreachable: ${lost.slice(0, 6).map(l => `(${l.x}, ${l.z})`).join(' ')}`);
  const sealed = (map.rooms ?? []).filter(r => r.bld !== undefined).filter(r => {
    for (let z = r.z + 0.5; z < r.z + r.d; z += 1) for (let x = r.x + 0.5; x < r.x + r.w; x += 1) if (reach[cellOf(nav, x, z)]) return false;
    return true;
  });
  if (sealed.length) out.fail.push(`${sealed.length} sealed rooms: ${sealed.slice(0, 6).map(r => `(${r.x}, ${r.z})`).join(' ')}`);
  // Door gaps: consecutive pieces of one building on one wall line, with nothing between them, at least 2 m apart.
  const byLine = new Map();
  for (const w of map.walls) {
    if (w.bld === undefined) continue;
    const horiz = w.w >= w.d;
    const key = `${w.bld}:${horiz ? 'h' : 'v'}:${horiz ? w.z : w.x}`;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(horiz ? [w.x, w.x + w.w] : [w.z, w.z + w.d]);
  }
  let narrow = 0, doors = 0;
  for (const list of byLine.values()) {
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < list.length; i++) {
      const g = list[i][0] - list[i - 1][1];
      if (g > 0.05) { doors++; if (g < 2) narrow++; }
    }
  }
  if (narrow) out.fail.push(`${narrow} door gaps narrower than 2 m`);
  out.info.push(`giant: ${br.pois.length} places, ${br.loot.length + br.chests.length} loot spots and caches, ${(map.rooms ?? []).filter(r => r.bld !== undefined).length} rooms all reachable; ${doors} doorways`);
}

// Walkable cells reachable from a point (4-neighbour, like the sim's free-for-all spawn search).
function flood(nav, from) {
  const { w, h, blocked } = nav, reach = new Uint8Array(w * h);
  const start = nav.nearestFree(from.x, from.z);
  const stack = [start];
  reach[start] = 1;
  while (stack.length) {
    const k = stack.pop(), i = k % w, j = (k - i) / w;
    for (const n of [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, j > 0 ? k - w : -1, j < h - 1 ? k + w : -1]) {
      if (n >= 0 && !blocked[n] && !reach[n]) { reach[n] = 1; stack.push(n); }
    }
  }
  return reach;
}

const cellOf = (nav, x, z) => Math.floor(z) * nav.w + Math.floor(x);
const reachableNear = (nav, reach, x, z, r = 1.2) => {
  for (let dz = -r; dz <= r; dz += 0.5) for (let dx = -r; dx <= r; dx += 0.5) {
    const cx = x + dx, cz = z + dz;
    if (cx < 0 || cz < 0 || cx >= nav.w || cz >= nav.h) continue;
    if (reach[cellOf(nav, cx, cz)]) return true;
  }
  return false;
};

function objectives(map) {
  const p = map.points ?? {}, list = [];
  for (const k of ['dom', 'hard', 'snd', 'ctf']) for (const o of p[k] ?? []) list.push({ kind: k, ...o });
  return list;
}

function checkNav(map, nav, reach, out) {
  const { w, h, blocked } = nav;
  let free = 0, got = 0;
  for (let k = 0; k < w * h; k++) if (!blocked[k]) { free++; if (reach[k]) got++; }
  out.info.push(`nav ${got}/${free} walkable cells reachable (${(100 * got / free).toFixed(1)}%)`);
  map.spawns.forEach((list, t) => list.forEach((s, i) => { if (!reachableNear(nav, reach, s.x, s.z, 0.6)) out.fail.push(`team ${t} spawn ${i} (${s.x}, ${s.z}) unreachable`); }));
  for (const o of objectives(map)) {
    // A zone around a building (Railyard's B) counts if any of it is walkable and reachable.
    if (!reachableNear(nav, reach, o.x, o.z, Math.max(1, (o.r ?? 1.5) * 0.8))) out.fail.push(`${o.kind} ${o.id} (${o.x}, ${o.z}) unreachable`);
  }
  for (const p of map.nav ?? []) if (!reachableNear(nav, reach, p.x, p.z, 1)) out.fail.push(`nav waypoint (${p.x}, ${p.z}) unreachable`);
  for (const l of map.lanes ?? []) {
    let n = 0;
    for (let x = 0.5; x < map.width; x += 1) if (reach[cellOf(nav, x, l.z)]) n++;
    if (n < map.width * 0.35) out.fail.push(`lane ${l.id} (z ${l.z}) is mostly not walkable (${n} m of ${map.width})`);
  }
  // Pockets: walkable cells that cannot be reached. Grouped, so one corner is one line.
  const seen = new Uint8Array(w * h), pockets = [];
  for (let k = 0; k < w * h; k++) {
    if (blocked[k] || reach[k] || seen[k]) continue;
    const cells = [k]; seen[k] = 1;
    for (let q = 0; q < cells.length; q++) {
      const c = cells[q], i = c % w, j = (c - i) / w;
      for (const n of [i > 0 ? c - 1 : -1, i < w - 1 ? c + 1 : -1, j > 0 ? c - w : -1, j < h - 1 ? c + w : -1]) if (n >= 0 && !blocked[n] && !reach[n] && !seen[n]) { seen[n] = 1; cells.push(n); }
    }
    const i = cells[0] % w, j = (cells[0] - i) / w;
    pockets.push(`${cells.length} cell(s) near (${i + 0.5}, ${j + 0.5})`);
  }
  if (pockets.length) out.warn.push(`unreachable pockets: ${pockets.slice(0, 6).join('; ')}${pockets.length > 6 ? ` and ${pockets.length - 6} more` : ''}`);
}

// Gaps between blocking rectangles that a player cannot fit through. Borders count (a crack against the edge traps too).
function checkGaps(map, out) {
  const ws = map.walls.filter(r => r.blocksMove);
  const found = [];
  for (let a = 0; a < ws.length; a++) for (let b = a + 1; b < ws.length; b++) {
    const A = ws[a], B = ws[b];
    if (A.kind === 'border' && B.kind === 'border') continue;
    const gx = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w));        // > 0: apart on x
    const gz = Math.max(B.z - (A.z + A.d), A.z - (B.z + B.d));
    const ox = -gx, oz = -gz;                                          // > 0: overlap length on that axis
    let gap = null;
    if (gx > TOUCH && oz > 0.4 && gx < GAP) gap = gx;
    else if (gz > TOUCH && ox > 0.4 && gz < GAP) gap = gz;
    else if (gx > 0 && gz > 0 && Math.hypot(gx, gz) < GAP && Math.hypot(gx, gz) > TOUCH && gx > TOUCH && gz > TOUCH) gap = Math.hypot(gx, gz);
    if (gap === null || gap > GAP - 0.005) continue;
    // Not a gap if something else that blocks fills it (a hull's basin between the hull and the quay).
    const mx = gx > 0 ? (gx === Math.max(B.x - (A.x + A.w), -Infinity) ? A.x + A.w + gx / 2 : B.x + B.w + gx / 2) : (Math.max(A.x, B.x) + Math.min(A.x + A.w, B.x + B.w)) / 2;
    const mz = gz > 0 ? (gz === B.z - (A.z + A.d) ? A.z + A.d + gz / 2 : B.z + B.d + gz / 2) : (Math.max(A.z, B.z) + Math.min(A.z + A.d, B.z + B.d)) / 2;
    if (ws.some(C => C !== A && C !== B && mx > C.x - 0.01 && mx < C.x + C.w + 0.01 && mz > C.z - 0.01 && mz < C.z + C.d + 0.01)) continue;
    // Water beside a wall is fine when it is the wall's own footing (a hull in its basin).
    if ((A.kind === 'water') !== (B.kind === 'water') && (A.ship || B.ship || A.tug || B.tug)) continue;
    found.push(`${A.kind}@(${A.x},${A.z}) ~ ${B.kind}@(${B.x},${B.z}) ${gap.toFixed(2)} m`);
  }
  if (found.length) out.fail.push(`narrow gaps (< ${GAP.toFixed(2)} m): ${found.slice(0, ARGS_ALL ? 999 : 8).join('; ')}${!ARGS_ALL && found.length > 8 ? ` and ${found.length - 8} more` : ''}`);
}

// Walking distance (8-neighbour Dijkstra on the nav grid) from one point to every cell.
function distances(nav, from) {
  const { w, h, blocked } = nav, n = w * h, d = new Float32Array(n).fill(Infinity);
  const start = nav.nearestFree(from.x, from.z);
  d[start] = 0;
  // A binary heap would be quicker; a bucketed queue at 0.1 m resolution is plenty for grids this size.
  const buckets = new Map(); const push = (k, v) => { const b = Math.round(v * 10); if (!buckets.has(b)) buckets.set(b, []); buckets.get(b).push(k); };
  push(start, 0);
  let b = 0, left = 1;
  const S2 = Math.SQRT2;
  while (left) {
    const list = buckets.get(b);
    if (!list || !list.length) { buckets.delete(b); b++; continue; }
    const k = list.pop(); left--;
    const dk = d[k];
    if (Math.round(dk * 10) !== b) continue;
    const i = k % w, j = (k - i) / w;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const m = nj * w + ni;
      if (blocked[m]) continue;
      if (di && dj && (blocked[j * w + ni] || blocked[nj * w + i])) continue;
      const v = dk + (di && dj ? S2 : 1);
      if (v < d[m]) { d[m] = v; push(m, v); left++; }
    }
  }
  return d;
}

function checkFair(map, nav, out) {
  const W = map.width, H = map.height;
  const field = map.spawns.map(list => list.map(s => distances(nav, s)));
  const mean = (t, x, z, r = 1.2) => {
    let best = Infinity;
    // The objective's nearest walkable cell (anywhere in its zone), from each of the team's spawns, averaged.
    const ks = [];
    for (let dz = -r; dz <= r; dz += 0.5) for (let dx = -r; dx <= r; dx += 0.5) {
      const cx = x + dx, cz = z + dz;
      if (cx >= 0 && cz >= 0 && cx < W && cz < H && !nav.blocked[cellOf(nav, cx, cz)]) ks.push(cellOf(nav, cx, cz));
    }
    let sum = 0;
    for (const d of field[t]) { best = Infinity; for (const k of ks) best = Math.min(best, d[k]); sum += best; }
    return sum / field[t].length;
  };
  const rows = [];
  const pair = (label, a, b) => {
    const r = Math.max(1.2, (a.r ?? 1.5) * 0.8);
    const d0 = mean(0, a.x, a.z, r), d1 = mean(1, b.x, b.z, r);
    const off = Math.abs(d0 - d1) / Math.max(d0, d1);
    rows.push(`${label} ${d0.toFixed(0)}/${d1.toFixed(0)}`);
    if (!(off <= 0.1)) out.fail.push(`unfair ${label}: team 0 walks ${d0.toFixed(1)} m, team 1 ${d1.toFixed(1)} m (${(off * 100).toFixed(0)}%)`);
  };
  // Each team's way to an objective against the other team's way to its counterpart: the 180-degree image, or for a
  // point with none (a lone centre flag) the same point.
  const image = o => ({ x: W - o.x, z: H - o.z });
  const counterpart = (list, o) => list.reduce((best, q) => (Math.hypot(q.x - image(o).x, q.z - image(o).z) < Math.hypot(best.x - image(o).x, best.z - image(o).z) ? q : best), list[0]);
  for (const kind of ['dom', 'hard']) {
    const list = map.points?.[kind] ?? [];
    for (const o of list) pair(`${kind} ${o.id}`, o, counterpart(list, o));
  }
  const ctf = map.points?.ctf;
  if (ctf?.length === 2) pair('ctf enemy flag', ctf[1], ctf[0]);
  // S&D is one-sided by design: attackers walk, defenders hold. Reported for reading, never failed.
  for (const s of map.points?.snd ?? []) out.info.push(`snd ${s.id}: attackers ${mean(0, s.x, s.z).toFixed(0)} m, defenders ${mean(1, s.x, s.z).toFixed(0)} m`);
  if (rows.length) out.info.push(`fair (team 0/1 metres): ${rows.join(', ')}`);
}

function checkSight(map, nav, reach, size, out, step = 2) {
  const N = 24, cap = 140;
  let longest = 0, at = null, long = 0, rays = 0;
  for (let z = 1; z < map.height; z += step) for (let x = 1; x < map.width; x += step) {
    if (!reach[cellOf(nav, x, z)]) continue;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      const hit = raycastMap(map, x, z, dx, dz, cap, 'blocksVision');
      const t = hit ? hit.t : cap;
      rays++;
      if (t > SIGHT[size]) long++;
      if (t > longest) { longest = t; at = `(${x}, ${z}) heading ${Math.round(a * 180 / Math.PI)}`; }
    }
  }
  const msg = `sight: longest ${longest.toFixed(0)} m from ${at}; ${(100 * long / rays).toFixed(1)}% of lines over ${SIGHT[size]} m`;
  out.info.push(msg);
}

// ---- Bot match ---------------------------------------------------------------------------------------------------

function botMatch(map, mode, out) {
  const seed = 1234;
  const teamSize = isFfa(mode) ? playersFor(mode, map) : teamSizeFor(mode);
  const roster = buildRoster([], { botSkill: 'regular', teamSize, mapId: map.id, mode, seed });
  const sim = new Sim({ roster, map, seed, mode });
  const STEP = 1 / SIM_HZ;
  const ev = {};
  const stuck = new Map();
  const hist = new Map();
  let tick = 0;
  // Flag runs are rarer than fights: Capture the Flag gets twice as long to show one.
  const seconds = MODES[mode].rules === 'ctf' ? SECONDS * 2 : SECONDS;
  const end = Math.round((3.2 + seconds) * SIM_HZ);
  const t0 = performance.now();
  for (; tick < end && sim.phase !== 'ended'; tick++) {
    sim.step(STEP);
    for (const e of sim.drainEvents()) {
      const k = e.t === 'snd' || e.t === 'ctf' ? `${e.t}:${e.kind}` : e.t;
      ev[k] = (ev[k] ?? 0) + 1;
    }
    // Once a second: a bot that has been pushing its stick for 4 s and gone less than 0.6 m is stuck on something.
    if (tick % SIM_HZ === 0 && sim.phase === 'live' && (!sim.snd || sim.snd.state === 'live')) {
      for (const p of sim.players) {
        if (!p.bot) continue;
        const h = hist.get(p.id) ?? [];
        const push = Math.hypot(p.bot.input.mx, p.bot.input.mz);
        h.push({ x: p.ps.x, z: p.ps.z, push, alive: p.alive });
        if (h.length > 5) h.shift();
        hist.set(p.id, h);
        if (h.length === 5 && h.every(s => s.alive && s.push > 0.5) && Math.hypot(h[4].x - h[0].x, h[4].z - h[0].z) < 0.6) {
          const key = `${Math.round(p.ps.x)},${Math.round(p.ps.z)}`;
          stuck.set(key, (stuck.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const ms = (performance.now() - t0) / tick;
  const kills = ev.kill ?? 0;
  const obj = { dom: ev.capture ?? 0, hard: sim.scores[0] + sim.scores[1], kc: ev.tag ?? 0, snd: (ev['snd:plant'] ?? 0) + (ev['snd:defuse'] ?? 0) + (ev['snd:round'] ?? 0), ctf: (ev['ctf:take'] ?? 0) + (ev['ctf:capture'] ?? 0) + (ev['ctf:return'] ?? 0) };
  const rules = MODES[mode].rules;
  const objective = obj[rules];
  const stuckSpots = [...stuck.entries()].sort((a, b) => b[1] - a[1]);
  const stuckTotal = stuckSpots.reduce((a, [, n]) => a + n, 0);
  const line = `${mode.padEnd(5)} ${(sim.time - 3).toFixed(0)}s kills ${kills}${objective !== undefined ? `, objective events ${objective}` : ''}, scores ${sim.scores.slice(0, isFfa(mode) ? 3 : 2).join('/')}, stuck ${stuckTotal}${stuckSpots.length ? ` at ${stuckSpots.slice(0, 4).map(([k, n]) => `(${k})x${n}`).join(' ')}` : ''}, ${ms.toFixed(2)} ms/tick`;
  out.info.push(`bots ${line}`);
  if (kills === 0) out.fail.push(`${mode}: no kills in ${seconds} s`);
  // Bots take flags and plant bombs rarely enough that a quiet minute is not a map fault on its own: reported only.
  if (objective === 0) (rules === 'snd' || rules === 'ctf' ? out.warn : out.fail).push(`${mode}: no objective activity in ${seconds} s`);
  // Stuck-seconds per bot per minute: a little is a bot waiting at a corner; a lot is a trap.
  const perBot = stuckTotal / sim.players.length / (seconds / 60);
  if (perBot > 4) out.fail.push(`${mode}: bots stuck ${perBot.toFixed(1)} s per bot per minute`);
}

// A giant map's bot check: 32 bots, 16 v 16 under Ground War TDM rules, spread over the places, for 120 s.
function freeRoam(map, out) {
  const seconds = SECONDS * 2, seed = 1234;
  const roster = buildRoster([], { botSkill: 'regular', teamSize: 16, mapId: map.id, mode: 'gwtdm', seed });
  const sim = new Sim({ roster, map, seed, mode: 'gwtdm', timeLimit: 3600, scoreLimit: 9999 });
  const STEP = 1 / SIM_HZ;
  const hist = new Map(), stuck = new Map();
  let kills = 0, cpu = 0, live = 0, worst = 0;
  const end = Math.round((3.2 + seconds) * SIM_HZ);
  for (let tick = 0; tick < end; tick++) {
    const c = process.cpuUsage();
    sim.step(STEP);
    const cu = process.cpuUsage(c), ms = (cu.user + cu.system) / 1000;
    if (sim.phase === 'live' && tick > 1) { cpu += ms; live++; worst = Math.max(worst, ms); }
    for (const e of sim.drainEvents()) if (e.t === 'kill') kills++;
    if (tick % SIM_HZ === 0 && sim.phase === 'live') {
      for (const p of sim.players) {
        const h = hist.get(p.id) ?? [];
        h.push({ x: p.ps.x, z: p.ps.z, push: Math.hypot(p.bot.input.mx, p.bot.input.mz), alive: p.alive });
        if (h.length > 5) h.shift();
        hist.set(p.id, h);
        if (h.length === 5 && h.every(s => s.alive && s.push > 0.5) && Math.hypot(h[4].x - h[0].x, h[4].z - h[0].z) < 0.6) {
          const key = `${Math.round(p.ps.x)},${Math.round(p.ps.z)}`;
          stuck.set(key, (stuck.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const spots = [...stuck.entries()].sort((a, b) => b[1] - a[1]);
  const total = spots.reduce((a, [, n]) => a + n, 0);
  const mean = cpu / live;
  out.info.push(`bots free roam (32, gwtdm rules) ${seconds}s kills ${kills}, stuck ${total}${spots.length ? ` at ${spots.slice(0, 5).map(([k, n]) => `(${k})x${n}`).join(' ')}` : ''}, tick ${mean.toFixed(2)} ms mean, ${worst.toFixed(1)} worst (CPU)`);
  if (total / 32 / (seconds / 60) > 4) out.fail.push(`free roam: bots stuck ${(total / 32 / (seconds / 60)).toFixed(1)} s per bot per minute`);
  if (mean > 4) out.fail.push(`free roam: host tick ${mean.toFixed(2)} ms mean (budget 4)`);
}

// ---- Output ------------------------------------------------------------------------------------------------------

function print(out) {
  console.log(`\n${out.fail.length ? 'FAIL' : 'ok  '} ${out.id}`);
  for (const l of out.info) console.log(`     ${l}`);
  for (const l of out.warn) console.log(`  !  ${l}`);
  for (const l of out.fail) console.log(`  X  ${l}`);
}

// Top-down character map, one character per metre: # solid, + low cover, ~ water, . walkable, ' ' unreachable,
// digits spawn teams, letters objectives.
function ascii(map, nav, reach) {
  const rows = [];
  for (let j = 0; j < nav.h; j++) {
    let s = '';
    for (let i = 0; i < nav.w; i++) {
      const x = i + 0.5, z = j + 0.5;
      const wall = map.walls.find(r => r.kind !== 'border' && x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d);
      s += wall ? (wall.kind === 'water' ? '~' : wall.blocksVision ? '#' : '+') : nav.blocked[j * nav.w + i] ? ',' : reach[j * nav.w + i] ? '.' : ' ';
    }
    rows.push(s.split(''));
  }
  const put = (x, z, c) => { const i = Math.floor(x), j = Math.floor(z); if (rows[j]?.[i] !== undefined) rows[j][i] = c; };
  map.spawns.forEach((l, t) => l.forEach(s => put(s.x, s.z, String(t))));
  for (const o of map.points?.dom ?? []) put(o.x, o.z, o.id);
  for (const o of map.points?.hard ?? []) put(o.x, o.z, 'h');
  for (const o of map.points?.snd ?? []) put(o.x, o.z, o.id.toLowerCase());
  for (const o of map.points?.ctf ?? []) put(o.x, o.z, 'F');
  return `${map.id}\n${rows.map(r => r.join('')).join('\n')}`;
}

// ---- Run ---------------------------------------------------------------------------------------------------------

let failed = 0;
const report = [];

for (const id of todo) {
  const map = MAPS[id];
  if (!map) { console.log(`?? ${id}: not a registered map`); failed++; continue; }
  const out = { id, fail: [], warn: [], info: [] };
  const size = isGiant(map) ? 'giant' : sizeOf(map);
  checkFields(map, size, out);
  const nav = new NavGrid(map);
  const reach = flood(nav, map.spawns[0][0]);
  checkNav(map, nav, reach, out);
  checkGaps(map, out);
  if (isGiant(map)) checkGiant(map, nav, reach, out);
  else checkFair(map, nav, out);
  checkSight(map, nav, reach, size, out, isGiant(map) ? 6 : 2);
  if (ASCII) console.log(ascii(map, nav, reach));
  if (!QUICK && isGiant(map)) freeRoam(map, out);
  else if (!QUICK) for (const mode of mapModes(map)) {
    if (!modeFitsMap(map, mode) || (ONLY_MODES && !ONLY_MODES.includes(mode))) continue;
    botMatch(map, mode, out);
  }
  print(out);
  if (out.fail.length) failed++;
  report.push(out);
}
console.log(failed ? `\n${failed} map(s) failed` : `\nall ${report.length} map(s) pass`);
process.exit(failed ? 1 : 0);
