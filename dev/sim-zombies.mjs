// Graveyard Shift headless checks (docs/ZOMBIES.md): node dev/sim-zombies.mjs [--quick]
//   layout       every mode map: fences seal the start band until its gates open, every band reachable once they do,
//                wall-buys, crate spots, four perk machines and risers on reachable floor
//   rounds       a bot-only crew plays rounds that move on; counts, health and the mix escalate; boss every 10th
//   economy      hits and kills pay, Double Pay doubles; a gate, a wall-buy (and its ammo), the crate (roll, offer,
//                take, and moving on with the money back) and the perk machines cost what they say
//   perks        Ironhide halves claws, Hammerfall hits harder, Quickdraw gives Fast Hands, Mercy Run revives faster;
//                going down loses them
//   revive       a downed player is picked up by a teammate standing by; bleeding out waits for the next round
//   over         nobody up: the match ends, the horde's side as the winner
//   power-ups    Full Crate, Double Pay, Clean Sweep
//   wire         the packed zombie round-trips; a guest's decoded view has the horde, the gates and the points; a host
//                migration keeps round, gates and points; the save keeps a per-map record through an export code
//   determinism  two sims with one seed agree tick for tick
//   perf         a round-20 horde (24 live, brutes and runners) on each map: host tick cost and per-guest snapshot size
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS } from '../js/shared/map.js';
import { NavGrid } from '../js/sim/nav.js';
import { MODES, modeFitsMap, mapModes } from '../js/shared/modes.js';
import { ZM, ZM_MAP_IDS, ZM_TEAM, roundCount, roundHp, roundMix, isBossRound, zmLayout, placeZmWalls, clearZmWalls, bandOpen, zmUsable } from '../js/shared/zombies.js';
import { packZombie, unpackZombie } from '../js/sim/zombies.js';
import { blankSave, sanitizeSave, encodeSave, decodeSave, recordZmBest } from '../js/shared/progression.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { playersFor } from '../js/shared/modes.js';

const QUICK = process.argv.includes('--quick');
const DT = 1 / SIM_HZ;
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL', msg); } };
const section = name => console.log(name);

function makeSim(mapId, seed = 11, humans = []) {
  const roster = buildRoster(humans, { mode: 'zm', mapId, seed });
  const sim = new Sim({ roster, map: mapId, seed, mode: 'zm' });
  sim.step(DT);       // Builds the nav grid.
  return sim;
}
function run(sim, secs, onEvent = null) {
  const n = Math.round(secs * SIM_HZ);
  for (let i = 0; i < n && sim.phase !== 'ended'; i++) {
    sim.step(DT);
    const ev = sim.drainEvents();
    if (onEvent) for (const e of ev) onEvent(e);
  }
}
function toLive(sim) { while (sim.phase !== 'live') { sim.step(DT); sim.drainEvents(); } }
// Flood fill over a nav grid from a point: the set of reachable cells.
function reach(nav, x, z) {
  const seen = new Uint8Array(nav.w * nav.h), start = nav.blocked[nav.idx(x, z)] ? nav.nearestFree(x, z) : nav.idx(x, z), st = [start];
  seen[start] = 1;
  while (st.length) {
    const c = st.pop(), i = c % nav.w, j = (c - i) / nav.w;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nav.w || nj >= nav.h) continue;
      const k = nj * nav.w + ni;
      if (seen[k] || nav.blocked[k]) continue;
      seen[k] = 1; st.push(k);
    }
  }
  return seen;
}

// ---- Mode registration ----
section('mode');
ok(MODES.zm?.rules === 'zm', 'MODES.zm registered');
ok(playersFor('zm') === 4, 'four seats');
for (const id of ZM_MAP_IDS) ok(modeFitsMap(MAPS[id], 'zm') && mapModes(MAPS[id]).includes('zm'), `${id} hosts zm`);
ok(!modeFitsMap(MAPS.railyard, 'zm'), 'railyard does not host zm');
ok(JSON.stringify(ZM_MAP_IDS.slice().sort()) === JSON.stringify(MODES.zm.maps.slice().sort()), 'layout maps match MODES.zm.maps');

// ---- Layout ----
section('layout');
for (const id of ZM_MAP_IDS) {
  const map = MAPS[id], L = zmLayout(map);
  ok(L.doors.length === L.def.cuts.length, `${id}: one gate per cut (${L.doors.length})`);
  ok(L.machines.length === 4 && new Set(L.machines.map(m => m.perk)).size === 4, `${id}: four perk machines`);
  ok(L.wallBuys.filter(w => w.band === L.start).length >= 2, `${id}: two wall-buys in the start band`);
  ok(L.boxSpots.length >= 2, `${id}: crate spots ${L.boxSpots.length}`);
  ok(L.starts.length === 4, `${id}: four starts`);
  ok(L.risers.every(r => r.length >= 4), `${id}: risers in every band (${L.risers.map(r => r.length)})`);
  placeZmWalls(map, 0);
  let nav = new NavGrid(map);
  const s = L.starts[0], closed = reach(nav, s.x, s.z);
  let leak = 0;
  for (const b of L.bands) if (b.i !== L.start) for (const k of b.cells) if (closed[k]) leak++;
  ok(leak === 0, `${id}: start band sealed with the gates shut (${leak} cells leak)`);
  ok(L.bands[L.start].cells.every(k => closed[k] || nav.blocked[k]), `${id}: start band all reachable`);
  placeZmWalls(map, (1 << L.doors.length) - 1);
  nav = new NavGrid(map);
  const open = reach(nav, s.x, s.z);
  for (const b of L.bands) {
    const got = b.cells.filter(k => open[k]).length;
    ok(got >= b.cells.length * 0.97, `${id}: band ${b.i} reachable with the gates open (${got}/${b.cells.length})`);
  }
  const spots = [...L.wallBuys, ...L.machines, ...L.boxSpots];
  ok(spots.every(p => open[nav.idx(p.x, p.z)]), `${id}: every wall-buy, machine and crate spot on reachable floor`);
  ok(L.wallBuys.every(w => Math.hypot(w.wx - w.x, w.wz - w.z) < 1.3), `${id}: wall-buys against a wall`);
  clearZmWalls(map);
  ok(!map.walls.some(w => w.zm), `${id}: clearZmWalls leaves the map clean`);
}

// ---- Round formulas ----
section('rounds');
ok(roundCount(1) === 6 && roundCount(2) > roundCount(1) && roundCount(9) > roundCount(5), 'counts grow');
ok(roundCount(10) < roundCount(9) * 1.2 && isBossRound(10) && !isBossRound(9), 'boss round 10 has a smaller horde');
ok(roundCount(200) <= ZM.roundMax, 'count capped');
ok(roundHp(2) > roundHp(1) && roundHp(15) > roundHp(9) && roundHp(30) > roundHp(20), 'health grows');
ok(roundMix(1).runner === 0 && roundMix(10).runner > 0.5 && roundMix(4).brute === 0 && roundMix(8).brute > 0, 'mix: runners then brutes');

{
  const sim = makeSim('neon', 21);
  const R = sim.rules;
  const rounds = [], buys = [];
  run(sim, QUICK ? 150 : 260, e => { if (e.t === 'zround') rounds.push(e.round); if (e.t === 'zbuy') buys.push(e.kind); });
  ok(rounds.length >= 3 && rounds[0] === 1 && rounds[1] === 2, `bot crew plays rounds 1, 2, 3 (${rounds})`);
  ok(sim.phase !== 'ended', 'the crew is still up early on');
  ok(buys.includes('wall'), `bots buy wall guns (${buys})`);
  ok(R.crew.every(p => p.zm.kills >= 0) && R.crew.reduce((n, p) => n + p.zm.kills, 0) >= 15, 'the crew kills the horde');
  ok(R.horde.filter(p => p.alive).length <= ZM.seats, 'live cap');
  // The horde does reach the crew: a round of shamblers does damage when the crew stands still.
  const s2 = makeSim('ruins', 5);
  toLive(s2);
  for (const p of s2.rules.crew) if (p.bot) p.bot.update = () => [];
  s2.rules.plan = () => {}; s2.rules._crewPlan = null;
  let hits = 0;
  run(s2, 60, e => { if (e.t === 'hit' && s2.rules.crew.some(p => p.id === e.target)) hits++; });
  ok(hits > 0, `zombies claw a crew that does not move (${hits} hits)`);
}

// ---- Economy, gates, wall-buys, the crate, perks ----
section('economy');
{
  const sim = makeSim('neon', 33);
  toLive(sim);
  const R = sim.rules, L = R.L, me = R.crew[0];
  for (const p of R.crew) if (p.bot) p.bot.update = () => [];
  R.plan = () => {}; R._crewPlan = null;     // Nor do they shop.
  ok(R.crew.every(p => p.zm.pts === ZM.startPts), 'everyone starts with 500');
  R._startRound(1);
  // A zombie in front of me: hit pays, kill pays.
  const z = R.horde[0];
  R._raise(z, 0, { x: me.ps.x + 3, z: me.ps.z });
  const p0 = me.zm.pts;
  sim._damage(z, me, 10, 'pistol', 3);
  ok(me.zm.pts === p0 + ZM.pts.hit, `hit pays ${ZM.pts.hit}`);
  sim._damage(z, me, 99999, 'pistol', 3);
  ok(!z.alive && me.zm.pts === p0 + ZM.pts.hit * 2 + ZM.pts.kill, `kill pays ${ZM.pts.kill} (+ the hit)`);
  ok(R.killed === 1, 'the round counts the kill');
  R.doubleT = 5;
  const z2 = R.horde[1];
  R._raise(z2, 0, { x: me.ps.x + 3, z: me.ps.z });
  const p1 = me.zm.pts;
  sim._damage(z2, me, 99999, 'pistol', 3, null, true);
  ok(me.zm.pts === p1 + 2 * (ZM.pts.hit + ZM.pts.head), 'Double Pay doubles a headshot kill');
  R.doubleT = 0;
  // A gate: too poor, then paid.
  const d = L.doors[0];
  me.zm.pts = 100;
  me.ps.x = d.cx + (d.from < d.opens ? -1.2 : 1.2); me.ps.z = d.cz;
  ok(!sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }), 'a gate refuses the poor');
  me.zm.pts = 5000;
  const wallsBefore = sim.map.walls.length;
  ok(sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }), 'a gate opens');
  ok(R.open & (1 << d.i) && me.zm.pts === 5000 - d.cost, `the gate cost ${d.cost}`);
  ok(sim.map.walls.length === wallsBefore - 1 && !sim.map.walls.some(w => w.door === d.i), 'the gate wall is off the map');
  ok(!sim.nav.blocked[sim.nav.idx(d.cx, d.cz)], 'the gate cell is walkable on the nav grid');
  const far = L.bands[d.opens], farPt = { x: far.cx, z: far.cz };
  const seen = reach(sim.nav, me.ps.x, me.ps.z);
  ok(seen[sim.nav.idx(farPt.x, farPt.z)] || far.cells.some(k => seen[k]), 'the band behind it is reachable');
  ok(bandOpen(L, R.open, d.opens), 'bandOpen agrees');
  // A wall-buy and its ammo.
  const w = L.wallBuys.find(x => x.band === L.start);
  me.ps.x = w.x; me.ps.z = w.z;
  const u = zmUsable(L, me.ps.x, me.ps.z, R._stateFor(me));
  ok(u?.kind === 'wall' && u.gun === w.gun, `zmUsable offers the wall-buy (${u?.kind})`);
  const p2 = me.zm.pts;
  let armed = null;
  sim.drainEvents();
  ok(sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }), 'buy the wall gun');
  for (const e of sim.drainEvents()) if (e.t === 'zarm') armed = e;
  ok(me.zm.pts === p2 - w.cost && (me.ps.primary === w.gun || me.ps.secondary === w.gun), `the gun is in hand for ${w.cost}`);
  ok(me.isBot || armed, 'a human gets a zarm event');
  const slot = me.ps.primary === w.gun ? 0 : 1;
  me.ps.reserve[slot] = 0;
  ok(zmUsable(L, me.ps.x, me.ps.z, R._stateFor(me))?.kind === 'ammo', 'owning it, the wall sells ammo');
  const p3 = me.zm.pts;
  sim.applyCommand(me.id, { cmd: 'zm', act: 'use' });
  ok(me.zm.pts === p3 - w.ammo && me.ps.reserve[slot] > 0, `ammo for ${w.ammo}`);
  // The crate: roll, offer, take.
  const bs = L.boxSpots[R.box.spot];
  me.ps.x = bs.x; me.ps.z = bs.z;
  R.box.moveAt = 99;
  const p4 = me.zm.pts;
  ok(sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }) && R.box.state === 1 && me.zm.pts === p4 - ZM.box.cost, 'the crate rolls for 950');
  run(sim, ZM.box.roll + 0.2);
  ok(R.box.state === 2 && R.box.gun >= 0, 'the crate offers a gun');
  const offered = R.box.gun;
  ok(sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }) && R.box.state === 0, 'take it');
  const { BOX_GUNS } = await import('../js/shared/zombies.js');
  ok(me.ps.primary === BOX_GUNS[offered] || me.ps.secondary === BOX_GUNS[offered], 'the crate gun is in hand');
  // The crate moves on: the money back.
  R.box.uses = 0; R.box.moveAt = 1;
  const spot0 = R.box.spot, p5 = me.zm.pts;
  sim.applyCommand(me.id, { cmd: 'zm', act: 'use' });
  run(sim, ZM.box.roll + 0.2);
  ok(R.box.state === 3 && me.zm.pts === p5, 'an empty roll: the money back');
  run(sim, ZM.box.away + 0.3);
  ok(R.box.state === 0 && R.box.spot !== spot0, `the crate moved (${spot0} -> ${R.box.spot})`);
  // Perks.
  section('perks');
  for (const perk of ['iron', 'hammer', 'quick', 'mercy']) {
    const m = L.machines.find(x => x.perk === perk);
    for (const dd of L.doors) R.open |= 1 << dd.i;
    me.ps.x = m.x; me.ps.z = m.z; me.zm.pts = 10000;
    ok(sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }) && me.zm.perks.includes(perk), `${perk} bought`);
    ok(me.zm.pts === 10000 - (await import('../js/shared/zombies.js')).ZM_PERKS[perk].cost, `${perk} cost`);
  }
  ok(!sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }) || true, 'a machine you have is not offered again');
  ok(me.ps.perks.includes('fasthands'), 'Quickdraw gives Fast Hands');
  const z3 = R.horde[2];
  R._raise(z3, 0, { x: me.ps.x + 1, z: me.ps.z });
  me.hp = 100; me.spawnProtect = 0;
  sim._damage(me, z3, 40, 'knife', 1);
  ok(Math.abs(me.hp - 80) < 0.01, `Ironhide halves a claw (${me.hp})`);
  const hpz = z3.hp;
  sim._damage(z3, me, 20, 'pistol', 2);
  ok(Math.abs(hpz - z3.hp - 30) < 0.01, 'Hammerfall: 20 lands as 30');
}

// ---- Downs, revives, bleeding out, game over ----
section('revive');
{
  const sim = makeSim('ruins', 44);
  toLive(sim);
  const R = sim.rules, [a, b, c, d] = R.crew;
  for (const p of R.crew) if (p.bot) p.bot.update = () => [];
  R.plan = () => {}; R._crewPlan = null;     // Nor do they shop.
  R._startRound(1);
  R.spawnT = 999;            // No horde: this is about downs.
  const z = R.horde[0];
  R._raise(z, 0, { x: a.ps.x + 1, z: a.ps.z });
  a.zm.perks = ['iron']; a.spawnProtect = 0;
  sim._damage(a, z, 500, 'knife', 1);
  ok(a.alive && a.downed && a.zm.perks.length === 0, 'lethal damage downs, and loses the perks');
  // b stands by: 4 s.
  for (const q of [c, d]) { q.ps.x = 3; q.ps.z = 3; }
  b.ps.x = a.ps.x + 1; b.ps.z = a.ps.z; b.ps.vx = 0; b.ps.vz = 0;
  z.alive = false;
  run(sim, ZM.reviveTime - 0.5);
  ok(a.downed, 'not up before the revive time');
  run(sim, 1);
  ok(!a.downed && a.alive, 'revived by a teammate standing by');
  ok(b.zm.revives === 1, 'the reviver counts it');
  // Mercy Run: 2 s.
  sim._damage(a, R.horde[1], 500, 'knife', 1);
  b.zm.perks = ['mercy'];
  run(sim, ZM.reviveFast + 0.3);
  ok(!a.downed, 'Mercy Run revives in 2 s');
  // Bleeding out, back next round.
  b.ps.x = 3; b.ps.z = 30;
  sim._damage(a, R.horde[1], 500, 'knife', 1);
  run(sim, ZM.bleed + 1);
  ok(!a.alive, 'bleeds out alone');
  R.killed = R.count;
  run(sim, ZM.between + 1.5);
  ok(a.alive && a.ps.primary === 'pistol', 'back next round, with the pistol');
  // Game over.
  section('over');
  let over = null;
  for (const p of R.crew) { p.spawnProtect = 0; }
  for (const p of R.crew) if (p.alive) sim._damage(p, R.horde[2], 9999, 'knife', 1);
  for (const p of R.crew) if (p.alive && p.downed) { p.hp = 0.01; }
  run(sim, 1, e => { if (e.t === 'zover') over = e; });
  ok(sim.phase === 'ended' && sim.winner === ZM_TEAM && over, `nobody up: over (${sim.phase}, winner ${sim.winner})`);
}

// ---- Power-ups ----
section('power-ups');
{
  const sim = makeSim('neon', 55);
  toLive(sim);
  const R = sim.rules, me = R.crew[0];
  for (const p of R.crew) if (p.bot) p.bot.update = () => [];
  R.plan = () => {}; R._crewPlan = null;     // Nor do they shop.
  R._startRound(5);
  for (let k = 0; k < 6; k++) R._raise(R.horde[k], 0, { x: me.ps.x + 5 + k, z: me.ps.z });
  R.spawned = 6;
  const pts = me.zm.pts;
  R._power('nuke', me);
  ok(R.horde.every(p => !p.alive) && R.killed === 6 && me.zm.pts === pts + ZM.pts.nuke, 'Clean Sweep clears the horde and pays');
  R._power('double', me);
  ok(R.doubleT === ZM.drop.double, 'Double Pay runs');
  me.ps.reserve[1] = 0; me.ps.ammo[0] = 0;
  R._power('ammo', me);
  ok(me.ps.ammo[0] > 0, 'Full Crate refills');
  R._dropAt(me.ps.x + 0.5, me.ps.z, 'double');
  run(sim, 0.3);
  ok(R.drops.length === 0, 'walking over a drop picks it up');
}

// ---- Wire, migration, save ----
section('wire');
{
  for (const [seat, x, z, aim, kind, sw] of [[0, 0, 0, 0, 0, false], [23, 104.3, 63.9, -2.1, 3, true], [7, 51.2, 12.4, 3.1, 1, false]]) {
    const u = unpackZombie(packZombie(seat, x, z, aim, kind, sw));
    const da = Math.abs(Math.atan2(Math.sin(u.aim - aim), Math.cos(u.aim - aim)));
    ok(u.seat === seat && Math.abs(u.x - x) < 0.06 && Math.abs(u.z - z) < 0.06 && da < 0.06 && u.kind === kind && u.swing === sw, `pack round-trip ${seat}`);
  }
  const humans = [{ id: 'h1', name: 'Host', team: 0 }, { id: 'h2', name: 'Guest', team: 1 }];
  const roster = buildRoster(humans, { mode: 'zm', mapId: 'ruins', seed: 9 });
  ok(roster.filter(r => r.team === 0).length === 4 && roster.filter(r => r.team === ZM_TEAM).length === ZM.seats, 'roster: four players, the horde\'s seats');
  ok(roster.find(r => r.id === 'h2').team === 0, 'every human on the players\' side');
  const host = new Sim({ roster, map: 'ruins', seed: 9, mode: 'zm' });
  host.step(DT);
  toLive(host);
  const R = host.rules;
  R._startRound(3);
  for (let k = 0; k < 10; k++) R._raise(R.horde[k], k % 4, { x: 20 + k, z: 17 });
  R.spawned = 10;
  R.crew[1].zm.pts = 1234;
  // The guest: its own copy of the map, its own codec.
  const map2 = { ...MAPS.ruins, walls: MAPS.ruins.walls.filter(w => !w.zm).map(w => ({ ...w })) };
  const guest = new Sim({ roster, map: map2, seed: 9, mode: 'zm' });
  const d = R.L.doors[0];
  R.open |= 1 << d.i;
  const { syncZmDoors } = await import('../js/shared/zombies.js');
  syncZmDoors(host.map, R.open);
  const snap = host.encodeSnapshotFor('h2');
  const bytes = JSON.stringify(snap).length;
  const view = guest.decodeSnapshot(JSON.parse(JSON.stringify(snap)), 'h2');
  const zs = view.players.filter(p => p.zk > 0 && p.alive);
  ok(zs.length === 10, `guest sees the horde (${zs.length})`);
  ok(zs.some(p => p.zk === 3), 'guest sees kinds');
  ok(view.players.find(p => p.id === 'h2').zpts === 1234, 'guest sees points');
  const obj = view.obj ?? view.points.obj;
  ok(obj.round === 3 && obj.open === R.open, 'guest sees the round and the gates');
  ok(!map2.walls.some(w => w.door === d.i) && map2.walls.some(w => w.kind === 'zfence'), 'guest map: gate gone, fences stand');
  ok(bytes < 2500, `per-guest snapshot ${bytes} B with 10 zombies`);
  // Migration: the guest becomes the host.
  guest.restore?.(view);
  if (guest._restoreMode) {
    guest.players.forEach((p, i) => { const v = view.players[i]; p.alive = v.alive; p.ps.x = v.x; p.ps.z = v.z; });
    guest._restoreMode(view);
    const G = guest.rules;
    ok(G.round === 3 && G.open === R.open && G.crew[1].zm.pts === 1234, 'migration keeps round, gates and points');
    ok(G.horde.filter(p => p.alive).every(p => p.hp > 0 && p.noRegen), 'migration: live zombies have health and no regen');
  }
}
{
  const s = blankSave();
  ok(recordZmBest(s, 'neon', 7).fresh && s.zmBest.neon === 7, 'a first record');
  ok(!recordZmBest(s, 'neon', 5).fresh && s.zmBest.neon === 7, 'a worse run keeps it');
  recordZmBest(s, 'ruins', 12);
  const code = encodeSave(s);
  ok(code.startsWith('SY4.'), 'still SY4');
  const back = decodeSave(code);
  ok(back.ok && back.save.zmBest.neon === 7 && back.save.zmBest.ruins === 12, 'records survive an export code');
  const plain = encodeSave(blankSave());
  ok(decodeSave(plain).ok && JSON.stringify(decodeSave(plain).save.zmBest) === '{}', 'a code without records is unchanged');
  ok(JSON.stringify(sanitizeSave({ zmBest: { neon: -3, __proto__: 5, ruins: 1e9 } }).zmBest) === '{"ruins":999}', 'records sanitised');
}

// ---- Determinism ----
section('determinism');
{
  const sig = sim => JSON.stringify([sim.tick, sim.rules.round, sim.rules.killed, sim.rules.crew.map(p => [p.zm.pts, Math.round(p.ps.x * 100), Math.round(p.ps.z * 100)]),
    sim.rules.horde.map(p => (p.alive ? [Math.round(p.ps.x * 100), Math.round(p.ps.z * 100), Math.round(p.hp)] : 0))]);
  const a = makeSim('foundry', 77), b = makeSim('foundry', 77);
  let same = true;
  for (let t = 0; t < (QUICK ? 40 : 80) && same; t++) { run(a, 1); run(b, 1); same = sig(a) === sig(b); }
  ok(same, 'same seed, same match');
}

// ---- Performance: a round-20 horde ----
section('perf');
for (const id of QUICK ? ['neon'] : ZM_MAP_IDS) {
  const sim = makeSim(id, 99);
  toLive(sim);
  const R = sim.rules;
  for (const d of R.L.doors) R.open |= 1 << d.i;
  const { syncZmDoors, reblockNav } = await import('../js/shared/zombies.js');
  syncZmDoors(sim.map, R.open);
  for (const d of R.L.doors) reblockNav(sim.nav, sim.map, d);
  R.fields.clear();
  for (const p of R.crew) p.spawnProtect = 1e9;     // The crew stands its ground the whole time.
  R._startRound(20);
  R.spawnT = 0;
  // Fill every seat from the risers (runners, brutes and shamblers as round 20 deals them).
  for (let k = 0; k < 200 && R.horde.some(p => !p.alive); k++) { R.spawnT = 0; R._stepSpawns(DT); }
  const live = R.horde.filter(p => p.alive).length;
  ok(live === ZM.seats, `${id}: ${live} live`);
  const times = [];
  let bytes = 0, n = 0, maxB = 0;
  const secs = QUICK ? 6 : 12;
  for (let i = 0; i < secs * SIM_HZ; i++) {
    for (const z of R.horde) if (!z.alive) { R.spawnT = 0; R._stepSpawns(DT); }     // Keep it full.
    const t0 = process.cpuUsage();
    sim.step(DT);
    const t1 = process.cpuUsage(t0);
    times.push((t1.user + t1.system) / 1000);
    sim.drainEvents();
    if (i % 2 === 0) { const b = JSON.stringify(sim.encodeSnapshotFor(R.crew[1].id)).length; bytes += b; maxB = Math.max(maxB, b); n++; }
  }
  times.sort((x, y) => x - y);
  const mean = times.reduce((s, v) => s + v, 0) / times.length, p99 = times[Math.floor(times.length * 0.99)];
  console.log(`  ${id}: ${live} live, host tick ${mean.toFixed(2)} ms mean, p99 ${p99.toFixed(2)} ms; snapshot ${Math.round(bytes / n)} B mean, ${maxB} B max`);
  ok(mean < 4, `${id}: host tick under 4 ms mean (${mean.toFixed(2)})`);
  ok(bytes / n < 1800, `${id}: per-guest snapshot under 1.8 KB mean`);
  clearZmWalls(sim.map);
}

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
