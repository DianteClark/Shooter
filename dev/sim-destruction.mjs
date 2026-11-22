// Destruction headless test (docs/DESTRUCTION.md). node dev/sim-destruction.mjs [--quick]
//   resolve    every 6v6, Ground War and battle royale map has breakable pieces; the 180-degree maps have them in
//              pairs (a piece's image is a piece of the same material); spawns, borders and landmarks are untouched;
//              the off maps have none; piles leave >= 1.5 m clear
//   wire       break strings round-trip (random states, big maps), bad strings refused
//   rules      blasts break by material, LOS shields, heavy walls shrug off frags, heavy rounds chip wood, glass takes
//              any round, Search and Destroy keeps its sites, rounds stand pieces back up, off modes break nothing
//   determinism the same seed twice gives the same breaks, events and scores
//   snapshot   a guest (its own copy of the map) follows the host's walls; a late joiner gets every broken piece
//              within half a second; interest-managed snapshots carry it too; the bytes it costs
//   migration  Sim.fromSnapshot keeps the broken pieces and builds its nav grid round the openings
//   replay     a recorded clip keeps the break string per keyframe and the brk events; a SYR1 code reproduces both;
//              an older clip without the extra still unpacks
//   nav        breaking a wall between two points shortens the walk; a bot walking round it replans through the hole
//   bots       Ground War bot matches: bots throw frags at walls in their way, pieces break, nobody gets stuck
//   perf       tick cost with destruction on and off, blast cost, a big map's sector rebuild, snapshot size
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS, MAP_IDS, BR_MAP_IDS } from '../js/shared/map.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { NavGrid } from '../js/sim/nav.js';
import { MATERIALS, encodeBreak, decodeBreak, prepareBreakables, resetBreakables, setBreakState, applyStage, currentStages } from '../js/shared/destruction.js';
import { BREAKABLES } from '../js/shared/breakables.js';
import { ReplayRecorder, packClip, unpackClip, EXTRAS } from '../js/game/replay.js';
import * as RC from '../js/game/replay-code.js';

const STEP = 1 / SIM_HZ;
const QUICK = process.argv.includes('--quick');
let fails = 0, passes = 0;
function ok(cond, name, info = '') {
  if (cond) passes++; else fails++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${info !== '' ? `: ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`);
}
const cpu = () => { const c = process.cpuUsage(); return (c.user + c.system) / 1000; };

// A second copy of a map, as another phone has it: its own wall objects, resolved the same way.
function copyMap(map) {
  // Walls as the map file made them: a piece already down on the host's copy goes back to its whole rect.
  const m = { ...map, walls: map.walls.map(w => {
    const c = { ...w }, p = w.brk !== undefined ? map.breakables[w.brk] : null;
    if (p) { Object.assign(c, { x: p.x, z: p.z, w: p.w, d: p.d, h: p.h }); [c.blocksMove, c.blocksBullet, c.blocksVision] = p.flags; }
    delete c.brk; delete c._brk; return c;
  }), breakables: undefined };
  prepareBreakables(m);
  return m;
}
function makeSim(mapId, mode, seed, extra = {}) {
  const map = typeof mapId === 'string' ? MAPS[mapId] : mapId;
  const roster = buildRoster([], { botSkill: 'regular', mapId: map.id, mode, seed });
  return new Sim({ roster, map, seed, mode, ...extra });
}
const run = (sim, seconds, onEvent = null) => {
  for (let i = 0; i < seconds * SIM_HZ && sim.phase !== 'ended'; i++) {
    sim.step(STEP);
    const ev = sim.drainEvents();
    if (onEvent) for (const e of ev) onEvent(e);
  }
};
const centre = p => [p.x + p.w / 2, p.z + p.d / 2];

/* ---------- resolve ---------- */
console.log('resolve');
{
  const counts = {};
  for (const id of [...MAP_IDS, ...BR_MAP_IDS]) counts[id] = MAPS[id].breakables.length;
  const none = Object.entries(counts).filter(([, n]) => n === 0).map(([id]) => id);
  ok(none.length === 0, 'every 6v6, Ground War and battle royale map has breakable pieces', none.length ? none : `${Object.keys(counts).length} maps, ${Object.values(counts).reduce((a, b) => a + b, 0)} pieces`);
  console.log('    ' + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '));
  const off = Object.keys(BREAKABLES).filter(id => BREAKABLES[id].off && MAPS[id]);
  ok(off.every(id => MAPS[id].breakables.length === 0), 'Graveyard Shift maps and the range have none', off);
  // Pairs on 180-degree maps: every piece's image (same size, rotated about the centre) is a piece of the same material.
  const unpaired = [];
  for (const id of MAP_IDS) {
    const m = MAPS[id];
    if (m.size === 'giant' || m.giantWorld) continue;
    const key = (x, z, w, d) => `${Math.round(x * 10)},${Math.round(z * 10)},${Math.round(w * 10)},${Math.round(d * 10)}`;
    const at = new Map(m.breakables.map(p => [key(p.x, p.z, p.w, p.d), p.mat]));
    // Only maps whose own walls are symmetric are held to it.
    const walls = new Set(m.walls.map(w => key(w.x, w.z, w.w, w.d)));
    const sym = m.walls.filter(w => w.kind !== 'border').every(w => walls.has(key(m.width - w.x - w.w, m.height - w.z - w.d, w.w, w.d)));
    if (!sym) continue;
    for (const p of m.breakables) if (at.get(key(m.width - p.x - p.w, m.height - p.z - p.d, p.w, p.d)) !== p.mat) unpaired.push(`${id}:${p.id}`);
  }
  ok(unpaired.length === 0, 'on symmetric maps every piece has its image', unpaired.slice(0, 8));
  const bad = [];
  for (const id of [...MAP_IDS, ...BR_MAP_IDS]) {
    const m = MAPS[id], spawns = m.spawns.flat();
    for (const p of m.breakables) {
      const w = p.wall;
      if (w.kind === 'border' || w.kind === 'water' || w.landmark || (w.bwall && !w.inner)) bad.push(`${id}:${p.id}:${w.kind}`);
      if (spawns.some(s => Math.hypot(Math.max(p.x - s.x, 0, s.x - p.x - p.w), Math.max(p.z - s.z, 0, s.z - p.z - p.d)) < 5)) bad.push(`${id}:${p.id}:spawn`);
      if (p.pile && (p.pile.x - p.x < 1.49 || p.pile.z - p.z < 1.49 || p.x + p.w - p.pile.x - p.pile.w < 1.49 || p.z + p.d - p.pile.z - p.pile.d < 1.49)) bad.push(`${id}:${p.id}:pile`);
      if (!MATERIALS.includes(p.mat)) bad.push(`${id}:${p.id}:mat`);
    }
  }
  ok(bad.length === 0, 'no border, water, landmark, outer building wall or spawn screen breaks; piles leave 1.5 m', bad.slice(0, 8));
}

/* ---------- wire ---------- */
console.log('wire');
{
  let rt = true;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  let longest = 0;
  for (let k = 0; k < 300; k++) {
    const n = 1 + Math.floor(rnd() * 1200), st = new Uint8Array(n), density = rnd();
    for (let i = 0; i < n; i++) if (rnd() < density * 0.3) st[i] = 1 + Math.floor(rnd() * 2);
    const s = encodeBreak(st), back = decodeBreak(s, n);
    if (!back || back.some((v, i) => v !== st[i])) { rt = false; break; }
    if (n > 1000) longest = Math.max(longest, s.length);
  }
  ok(rt, 'random break states round-trip', `longest for 1000+ pieces: ${longest} chars`);
  ok(encodeBreak(new Uint8Array(50)) === '', 'all standing is the empty string');
  ok(decodeBreak('!!', 10) === null && decodeBreak('_____', 3) === null, 'garbage and out-of-range strings are refused');
  const st = new Uint8Array(419); st[3] = 2; st[400] = 1;
  ok(encodeBreak(st).length <= 4, 'two pieces of 419 take a few characters', encodeBreak(st));
}

/* ---------- rules ---------- */
console.log('rules');
{
  const sim = makeSim('riverbend', 'tdm', 3);
  const L = sim.brk.list;
  const light = L.find(p => p.mat === 'light' && !p.pile && p.wall.blocksVision), wood = L.find(p => p.mat === 'wood');
  const [lx, lz] = centre(light);
  sim._emit({ t: 'bang', kind: 'frag', x: lx, z: lz + light.d / 2 + 0.4, r: 6.2, by: sim.players[0].id });
  ok(sim.brk.stage[light.id] === 2 && !light.wall.blocksMove && !light.wall.blocksVision, 'a frag at its face breaks a light wall', sim.brk.stage[light.id]);
  const evs = sim.drainEvents().filter(e => e.t === 'brk');
  ok(evs.some(e => e.i === light.id && e.s === 2 && e.m === MATERIALS.indexOf('light')), 'and says so: a brk event with stage, material and push', evs[0]);
  // Shielded: a blast behind a solid wall does not reach the piece.
  const sim2 = makeSim('riverbend', 'tdm', 3);
  const shed = sim2.brk.list.find(p => p.pile);
  const solid = sim2.map.walls.find(w => w.blocksVision && w.kind === 'building' && w.brk === undefined && w.w > 4);
  ok(!!shed, 'riverbend has a shed with a rubble pile');
  const [sx, sz] = centre(shed);
  sim2._emit({ t: 'explosion', x: sx, z: sz - shed.d / 2 - 0.3, radius: 5.2, by: sim2.players[0].id, k: 'strike' });
  ok(sim2.brk.stage[shed.id] === 2 && shed.wall.blocksMove && !shed.wall.blocksVision && shed.wall.w < shed.w, 'an airstrike leaves a shed as a waist-high rubble pile', [shed.wall.w, shed.w]);
  if (solid) {
    // Find a piece right behind that solid building, out of its LOS from a point on the far side.
    const near = sim2.brk.list.find(p => p.wall._brk !== 2 && Math.hypot(centre(p)[0] - (solid.x + solid.w / 2), centre(p)[1] - (solid.z + solid.d / 2)) < 9);
    if (near) {
      const [nx, nz] = centre(near), ox = solid.x + solid.w / 2, oz = solid.z + solid.d / 2;
      const ux = ox - nx, uz = oz - nz, l = Math.hypot(ux, uz);
      const bx = ox + ux / l * (Math.max(solid.w, solid.d) / 2 + 0.6), bz = oz + uz / l * (Math.max(solid.w, solid.d) / 2 + 0.6);
      const before = sim2.brk.hp[near.id];
      sim2.brk.blast({ x: bx, z: bz }, 3, 'frag', 'bang');
      ok(sim2.brk.hp[near.id] === before || Math.hypot(nx - bx, nz - bz) < 2, 'a solid building between a blast and a piece shields it');
    }
  }
  // Heavy walls shrug off a frag, not a launcher.
  const simH = makeSim('turnstile', 'tdm', 4);
  const heavy = simH.brk.list.find(p => p.mat === 'heavy') ?? null;
  if (heavy) {
    const [hx, hz] = centre(heavy);
    simH.brk.blast({ x: hx, z: hz + heavy.d / 2 + 0.3 }, 6.2, 'frag', 'bang');
    const afterFrag = simH.brk.stage[heavy.id];
    simH.brk.blast({ x: hx, z: hz + heavy.d / 2 + 0.3 }, 3.6, 'launcher', 'gun');
    simH.brk.blast({ x: hx, z: hz + heavy.d / 2 + 0.3 }, 3.6, 'launcher', 'gun');
    ok(afterFrag === 0 && simH.brk.stage[heavy.id] === 2, 'a heavy wall takes a frag, falls to two rockets', [afterFrag, simH.brk.stage[heavy.id]]);
  } else ok(false, 'turnstile has a heavy wall');
  // Bullets: a sniper chips a crate, an SMG does nothing, glass breaks to anything.
  const sim3 = makeSim('riverbend', 'tdm', 5);
  const crate = sim3.brk.list.find(p => p.mat === 'wood');
  const [cx, cz] = centre(crate);
  const ray = { hit: 'wall', x: crate.x + crate.w / 2, z: crate.z, nx: 0, nz: -1 };
  const shot = (weapon) => ({ weapon, ox: cx, oz: crate.z - 8 });
  sim3.brk.bullet(shot('smg'), [ray], { damage: 30 });
  const smg = sim3.brk.hp[crate.id];
  sim3.brk.bullet(shot('sniper'), [ray], { damage: 110 });
  sim3.brk.bullet(shot('sniper'), [ray], { damage: 110 });
  ok(smg === crate.hp && sim3.brk.stage[crate.id] === 2, 'an SMG round leaves a crate, two sniper rounds break it', [smg, sim3.brk.hp[crate.id]]);
  const simG = makeSim('tidebreak', 'gwtdm', 5);
  const glass = simG.brk.list.find(p => p.mat === 'glass');
  if (glass) {
    const gray = { hit: 'wall', x: glass.x + glass.w / 2, z: glass.z, nx: 0, nz: -1 };
    simG.brk.bullet({ weapon: 'pistol', ox: glass.x + glass.w / 2, oz: glass.z - 6 }, [gray], { damage: 26 });
    ok(simG.brk.stage[glass.id] === 2 && !glass.wall.blocksMove, 'a pistol round breaks a window, and the window can be climbed through');
  } else ok(false, 'tidebreak has windows');
  // Search and Destroy keeps its sites; a new round stands everything back up.
  const snd = makeSim('riverbend', 'snd', 6);
  const near = snd.brk.list.filter(p => p.snd), far = snd.brk.list.find(p => !p.snd && p.mat !== 'heavy');
  for (const p of near) { const [x, z] = centre(p); snd.brk.blast({ x, z }, 6, 'charge', 'bang'); }
  ok(near.length === 0 || near.every(p => snd.brk.stage[p.id] === 0), 'S&D: pieces at the bomb sites never break', near.length);
  { const [x, z] = centre(far); snd.brk.blast({ x, z }, 6, 'charge', 'bang'); }
  const downThen = snd.brk.stage[far.id];
  snd.snd.startRound();
  ok(downThen === 2 && snd.brk.stage[far.id] === 0 && far.wall.blocksMove, 'S&D: a new round stands broken pieces back up', [downThen, snd.brk.stage[far.id]]);
  // Off modes.
  const zm = makeSim('neon', 'zm', 1);
  ok(!zm.brk.on, 'Graveyard Shift breaks nothing (its barricades are its own)');
  const tr = makeSim('railyard', 'tdm', 1, { training: { ammo: true } });
  ok(!tr.brk.on, 'Training breaks nothing');
  resetBreakables(MAPS.riverbend); resetBreakables(MAPS.turnstile); resetBreakables(MAPS.tidebreak);
}

/* ---------- determinism ---------- */
console.log('determinism');
{
  const go = () => {
    const sim = makeSim('downtown', 'gwtdm', 77);
    const log = [];
    run(sim, QUICK ? 60 : 120, e => { if (e.t === 'brk') log.push(`${sim.tick}:${e.i}:${e.s}`); });
    return { log: log.join(','), text: sim.brk.encode(), scores: sim.scores.join('-'), n: log.length };
  };
  const a = go(), b = go();
  ok(a.log === b.log && a.text === b.text && a.scores === b.scores, 'the same seed breaks the same pieces at the same ticks', `${a.n} stage changes, scores ${a.scores}`);
  ok(a.n > 0, 'bots break things in a Ground War match', a.n);
}

/* ---------- snapshot ---------- */
console.log('snapshot');
let snapBytes = null;
{
  const host = makeSim('riverbend', 'tdm', 9);
  const gmap = copyMap(MAPS.riverbend);
  const guest = new Sim({ roster: host.players.map(p => ({ id: p.id, name: p.name, team: p.team, isBot: p.isBot, primary: p.primary, camo: p.camo })), map: gmap, seed: 9, mode: 'tdm' });
  run(host, 4);
  const lights = host.brk.list.filter(p => p.mat !== 'heavy').slice(0, 6);
  for (const p of lights) { const [x, z] = centre(p); host.brk.blast({ x, z }, 6, 'charge', 'bang'); }
  const lens = [];
  let view = null;
  for (let i = 0; i < 6; i++) {
    host.step(STEP);
    const d = host.encodeSnapshot();
    lens.push(JSON.stringify(d).length);
    view = guest.decodeSnapshot(JSON.parse(JSON.stringify(d)), host.players[0].id);
  }
  const same = host.brk.list.every((p, i) => gmap.breakables[i].wall.blocksMove === p.wall.blocksMove && gmap.breakables[i].wall.blocksVision === p.wall.blocksVision && gmap.breakables[i].wall.w === p.wall.w);
  ok(same && view.brk === host.brk.encode(), "a guest's walls follow the host's", view.brk);
  // Late joiner: a fresh guest after the change window, gets the string within SEND_EVERY ticks.
  run(host, 3);
  const lmap = copyMap(MAPS.riverbend);
  const late = new Sim({ roster: host.players.map(p => ({ id: p.id, name: p.name, team: p.team, isBot: p.isBot, primary: p.primary, camo: p.camo })), map: lmap, seed: 9, mode: 'tdm' });
  let got = -1;
  for (let i = 0; i < 20 && got < 0; i++) {
    host.step(STEP);
    const v = late.decodeSnapshot(JSON.parse(JSON.stringify(host.encodeSnapshot())), host.players[0].id);
    if (v.brk === host.brk.encode() && v.brk) got = i + 1;
  }
  ok(got > 0 && got <= 16, 'a late joiner has every broken piece within half a second', `${got} ticks`);
  ok(lmap.breakables.every((p, i) => p.wall.blocksMove === host.brk.list[i].wall.blocksMove), "and the late joiner's walls match");
  // Size: the block's own bytes.
  const text = host.brk.encode();
  snapBytes = { pieces: host.brk.stats().broken, chars: text.length, snapshot: lens[0] };
  ok(text.length < 40, 'six broken pieces cost a few bytes a snapshot', snapBytes);
  // Interest-managed snapshots (big maps) carry it too.
  const gw = makeSim('frontier', 'br', 4);
  run(gw, 2);
  const fp = gw.brk.list.find(p => p.mat === 'wood');
  { const [x, z] = centre(fp); gw.brk.blast({ x, z }, 6, 'charge', 'bang'); }
  gw.step(STEP);
  const per = gw.encodeSnapshotFor(gw.players[3].id);
  ok(per.includes(gw.brk.encode()) && gw.brk.encode() !== '', 'per-guest snapshots on a battle royale map carry it');
  resetBreakables(MAPS.frontier);
  resetBreakables(MAPS.riverbend);
}

/* ---------- migration ---------- */
console.log('migration');
{
  const host = makeSim('riverbend', 'tdm', 12);
  run(host, 3);
  const shed = host.brk.list.find(p => p.pile), wall = host.brk.list.find(p => p.mat === 'light' && !p.pile && p.wall.blocksVision);
  for (const p of [shed, wall]) { const [x, z] = centre(p); host.brk.blast({ x, z }, 6, 'charge', 'bang'); }
  const dmg = host.brk.list.find(p => p.mat === 'wood' && host.brk.stage[p.id] === 0);
  host.brk._hit(dmg.id, dmg.hp * 0.6, 0, 1, null);
  host.step(STEP);
  const view = host.decodeSnapshot(host.encodeSnapshot(), host.players[0].id);
  const roster = host.players.map(p => ({ id: p.id, name: p.name, team: p.team, isBot: p.isBot, primary: p.primary, camo: p.camo }));
  const text = host.brk.encode();
  const next = Sim.fromSnapshot(view, roster, { map: 'riverbend', seed: 12 });
  ok(next.brk.encode() === text, 'the new host has the same broken and damaged pieces', text);
  ok(!wall.wall.blocksMove && shed.wall.blocksMove && shed.wall.w < shed.w, "and the map's walls stand as they did");
  const [wx, wz] = centre(wall);
  ok(next.nav.isWalkable(wx, wz), 'its nav grid is built round the opening');
  ok(next.brk.stage[dmg.id] === 1 && next.brk.hp[dmg.id] < dmg.hp, 'a damaged piece stays damaged (health at the top of its band)');
  run(next, 2);
  ok(next.brk.encode().length >= text.length, 'and the match goes on');
  resetBreakables(MAPS.riverbend);
}

/* ---------- replay ---------- */
console.log('replay');
{
  const sim = makeSim('riverbend', 'tdm', 21);
  const localId = sim.players[0].id;
  const rec = new ReplayRecorder({ localId });
  globalThis.performance ??= { now: () => Date.now() };
  let broke = 0;
  for (let i = 0; i < 20 * SIM_HZ; i++) {
    if (i === 6 * SIM_HZ) for (const p of sim.brk.list.filter(q => q.mat !== 'heavy').slice(0, 4)) { const [x, z] = centre(p); sim._emit({ t: 'explosion', x, z, radius: 5.2, by: localId, k: 'strike' }); }
    sim.step(STEP);
    const ev = sim.drainEvents();
    broke += ev.filter(e => e.t === 'brk').length;
    rec.record(sim.decodeSnapshot(sim.encodeSnapshot(), localId), ev, STEP);
  }
  const clip = rec.finish({ mapId: 'riverbend', mode: 'tdm', roster: [], myTeam: 0 });
  const last = clip.x[clip.x.length - 1].brk, first = clip.x[0].brk;
  ok(first === '' && last === sim.brk.encode() && last !== '', 'the clip keeps the break string per keyframe (before and after)', [first, last]);
  ok(clip.ev.filter(e => e.t === 'brk').length === broke && broke > 0, 'and every brk event', broke);
  const back = unpackClip(packClip(clip));
  ok(back.x[back.x.length - 1].brk === last, 'a stored clip keeps it');
  // A clip stored before the extra existed (one index fewer per keyframe) still unpacks.
  const old = packClip(clip), F = old.fat.length, NX = EXTRAS.length;
  const xi = new Uint16Array(F * (NX - 1));
  for (let k = 0; k < F; k++) for (let j = 0; j < NX - 1; j++) xi[k * (NX - 1) + j] = old.xi[k * NX + j];
  const oldBack = unpackClip({ ...old, xi });
  ok(oldBack.x.length === F && oldBack.x[F - 1].scores && oldBack.x[F - 1].brk === undefined, 'an older clip without it still unpacks');
  if (globalThis.CompressionStream) {
    const code = await RC.encodeReplay(clip, { from: 0, to: clip.dur, title: 'Riverbend' });
    const dec = code.ok && await RC.decodeReplay(code.code, { maps: new Set(Object.keys(MAPS)) });
    const dx = dec?.ok ? dec.clip.x : [];
    ok(dec?.ok && dx[dx.length - 1].brk === last && dx[0].brk === '', 'a SYR1 code reproduces the walls coming down', code.code?.length);
    ok(dec?.ok && dec.clip.ev.filter(e => e.t === 'brk').length === broke, 'and the breaks themselves (for the debris)');
  } else ok(true, 'no CompressionStream in this node: replay code skipped');
  resetBreakables(MAPS.riverbend);
}

/* ---------- nav ---------- */
console.log('nav');
{
  const sim = makeSim('pagoda', 'tdm', 31);
  sim.step(STEP);
  const nav = sim.nav, out = new Float32Array(256);
  // A light wall with walkable ground on both sides of its thin axis, far enough round that the walk is long.
  let best = null;
  for (const p of sim.brk.list) {
    if (p.mat !== 'light' || p.pile || !p.wall.blocksVision) continue;
    const [cx, cz] = centre(p), across = p.w < p.d ? [1, 0] : [0, 1], half = (p.w < p.d ? p.w : p.d) / 2 + 1.2;
    const a = [cx - across[0] * half, cz - across[1] * half], b = [cx + across[0] * half, cz + across[1] * half];
    if (!nav.isWalkable(...a) || !nav.isWalkable(...b)) continue;
    const n = nav.findPath(a[0], a[1], b[0], b[1], out, 128);
    let len = 0, x = a[0], z = a[1];
    for (let i = 0; i < n; i++) { len += Math.hypot(out[i * 2] - x, out[i * 2 + 1] - z); x = out[i * 2]; z = out[i * 2 + 1]; }
    if (!best || len > best.len) best = { p, a, b, len };
  }
  ok(!!best && best.len > 4, 'a wall with a walk round it', best && best.len.toFixed(1));
  if (best) {
    const bot = sim.players.find(q => q.bot && q.alive).bot, me = bot.p;
    me.ps.x = best.a[0]; me.ps.z = best.a[1];
    bot._goTo(best.b[0], best.b[1]);
    sim.pathBudget = 5; bot._solvePath();
    const before = bot.pathLen;
    const [cx, cz] = centre(best.p);
    sim.brk.blast({ x: cx, z: cz }, 6, 'charge', 'bang');
    const dirty = bot.pathDirty;
    sim.pathBudget = 5; bot._solvePath();
    const n = nav.findPath(best.a[0], best.a[1], best.b[0], best.b[1], out, 128);
    let len = 0, x = best.a[0], z = best.a[1];
    for (let i = 0; i < n; i++) { len += Math.hypot(out[i * 2] - x, out[i * 2 + 1] - z); x = out[i * 2]; z = out[i * 2 + 1]; }
    ok(len < best.len * 0.7, 'breaking it shortens the walk', `${best.len.toFixed(1)} m -> ${len.toFixed(1)} m`);
    ok(dirty && bot.pathLen <= before, 'the bot walking round it replans through the hole', `${before} -> ${bot.pathLen} corners`);
    ok(nav.isWalkable(cx, cz), 'the cells where it stood are walkable');
  }
  resetBreakables(MAPS.pagoda);
}

/* ---------- bots ---------- */
console.log('bots');
{
  const maps = QUICK ? ['downtown'] : ['downtown', 'expedition', 'harvest'];
  let breaches = 0, brkEv = 0, stuck = 0, kills = 0;
  for (const id of maps) {
    const sim = makeSim(id, 'gwtdm', 41);
    // Every bot carries frags, so the breach rule has the means.
    for (const p of sim.players) { p.ps.lethal = 'frag'; p.ps.lethalLeft = 2; }
    run(sim, QUICK ? 90 : 150, e => { if (e.t === 'brk' && e.s === 2) brkEv++; if (e.t === 'kill') kills++; });
    for (const p of sim.players) { breaches += p.bot?.breaches ?? 0; stuck += p.bot?.stuckN >= 3 ? 1 : 0; }
    resetBreakables(MAPS[id]);
  }
  ok(breaches > 0, 'bots throw frags at walls in their way, now and then', `${breaches} breach throws, ${brkEv} pieces broken, ${kills} kills over ${maps.join(', ')}`);
  ok(kills > 20, 'the matches still play', kills);
  ok(stuck <= 2, 'nobody is left stuck', stuck);
}

/* ---------- perf ---------- */
console.log('perf');
{
  const tick = (mapId, mode, on, seconds) => {
    const sim = makeSim(mapId, mode, 55);
    if (!on) sim.brk.on = false;
    run(sim, 4);
    const t0 = cpu();
    run(sim, seconds);
    const ms = (cpu() - t0) / (seconds * SIM_HZ);
    const st = sim.brk.stats();
    resetBreakables(MAPS[mapId]);
    return { ms: +ms.toFixed(2), broken: st.broken };
  };
  const secs = QUICK ? 30 : 60;
  const off = tick('downtown', 'gwtdm', false, secs), on = tick('downtown', 'gwtdm', true, secs);
  console.log(`    Ground War Downtown, 32 bots: ${off.ms} ms a tick off, ${on.ms} ms on (${on.broken} broken)`);
  ok(on.ms < off.ms * 1.5 + 0.5, 'destruction adds little to a Ground War tick', [off.ms, on.ms]);
  // One blast's own cost.
  const sim = makeSim('frontier', 'br', 8);
  sim.step(STEP);
  const p = sim.brk.list[Math.floor(sim.brk.list.length / 2)];
  const [x, z] = centre(p);
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) sim.brk.blast({ x: x + (i % 7), z: z + (i % 5) }, 4, 'cluster', 'bang');
  const blastUs = (performance.now() - t0) / 2000 * 1000;
  console.log(`    a blast on Frontier (${sim.brk.n} pieces): ${blastUs.toFixed(1)} us`);
  ok(blastUs < 200, 'a blast costs well under a millisecond', blastUs.toFixed(1));
  // The big map's sector rebuild after an opening.
  const t1 = performance.now();
  sim.nav._buildSectors();
  const secMs = performance.now() - t1;
  console.log(`    Frontier sector graph rebuild: ${secMs.toFixed(1)} ms (at most every 2 s, only after a break)`);
  ok(secMs < 400, 'the sector rebuild is a one-off cost', secMs.toFixed(1));
  if (snapBytes) console.log(`    snapshot: ${snapBytes.chars} characters for ${snapBytes.pieces} broken pieces (a 6v6 snapshot is about ${snapBytes.snapshot})`);
  resetBreakables(MAPS.frontier);
}

console.log(fails ? `FAILED: ${fails} (${passes} passed)` : `all ${passes} passed`);
process.exit(fails ? 1 : 0);
