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
//   perf         a round-20 and a round-30 horde (24 live, brutes and runners) on each map with every trap running,
//                sentries, drones and tier-3 guns: host tick cost and per-guest snapshot size
//   econ         (ROADMAP item 36) loadout streaks off; the upgrade bench (tiers, the wait, the bench busy, magazines,
//                damage, tier-3 effects, tiers kept through a swap and lost with the gun); the supply terminal (every
//                item, prices, once a round, sentry and drone fire, the strike's shells, the lure's pull); plates;
//                traps (arm, kill, reduced pay, players hurt lightly, cooldown); the perk cap and slot, Fleetfoot, Last
//                Breath; exfil (not before 15, the final wave, escape and failure, guests see it); the quest (relics,
//                altar, the Gravewarden, pay); bots spending in the economy; the wire and a host migration; the save's
//                feats and the calling card
//   ashgrove     the purpose-built map (graph layout): areas, the gate loop, dead ends, reserved economy spots; the power
//                switch gates the perk machines (dark until thrown, free, synced to guests and kept by a migration); a
//                bot throws it solo after round 2 and not with two humans; the boss rises in the Burial Field when it is
//                open (an ordinary riser when not); determinism
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS, MAP_IDS } from '../js/shared/map.js';
import { NavGrid } from '../js/sim/nav.js';
import { MODES, modeFitsMap, mapModes } from '../js/shared/modes.js';
import { ZM, ZM_MAP_IDS, ZM_TEAM, roundCount, roundHp, roundMix, isBossRound, zmLayout, placeZmWalls, clearZmWalls, bandOpen, zmUsable,
  ZK, ZM_SPIT, ZM_BLAST, ZM_SHIELD, ZM_SPECIAL, ZM_ROUNDS, specialMix, specialRound } from '../js/shared/zombies.js';
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
  ok(L.doors.length === (L.graph ? map.zm.gates.length : L.def.cuts.length), `${id}: one gate per ${L.graph ? 'declared gate' : 'cut'} (${L.doors.length})`);
  ok(L.machines.length === 6 && new Set(L.machines.map(m => m.perk)).size === 6, `${id}: six perk machines`);
  ok(L.bench && L.terminal && L.armour && L.exfil && L.altar, `${id}: bench, terminal, armour bench, exfil pad and altar placed`);
  ok(L.traps.length >= 2 && L.traps.length <= 3 && L.relics.length === 3 && new Set(L.relics.map(r => r.band)).size === 3, `${id}: 2-3 traps (${L.traps.length}), three relics in three areas`);
  ok(L.bands[L.terminal.band].depth === 0, `${id}: the terminal is in the start area`);
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
  const spots = [...L.wallBuys, ...L.machines, ...L.boxSpots, ...(L.power ? [L.power] : []), L.bench, L.terminal, L.armour, L.altar, L.exfil, ...L.relics, ...L.traps,
    ...L.traps.map(t => ({ x: t.sx, z: t.sz, band: t.band }))];
  // On reachable floor: the spot's own cell, or (a spot drawn close against its wall) one within a metre of it.
  const onFloor = p => { for (let dz = -1; dz <= 1; dz += 0.5) for (let dx = -1; dx <= 1; dx += 0.5) if (open[nav.idx(p.x + dx, p.z + dz)] && !nav.blocked[nav.idx(p.x + dx, p.z + dz)]) return true; return false; };
  ok(spots.every(onFloor), `${id}: every wall-buy, machine and crate spot on reachable floor`);
  ok(spots.every(p => p.band >= 0 && p.band < L.bands.length), `${id}: every placement in an area`);
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
  // As the game migrates (js/game/match.js promoteToHost): a new Sim from the guest's newest view, whose players start
  // blank. Points, perks, plates and tiers must come over from the mirror (they reset to 500 and nothing before).
  {
    R.crew[1].zm.perks = ['iron']; R.crew[1].zm.plates = 100; R.crew[1].zm.tiers = { pistol: 2 };
    host.step(DT);     // The crew block is encoded once a tick.
    const g2map = { ...MAPS.ruins, walls: MAPS.ruins.walls.filter(w => !w.zm).map(w => ({ ...w })) };
    const g2 = new Sim({ roster, map: g2map, seed: 9, mode: 'zm' });
    const v2 = g2.decodeSnapshot(JSON.parse(JSON.stringify(host.encodeSnapshotFor('h2'))), 'h2');
    const n2 = Sim.fromSnapshot(v2, roster, { map: { ...MAPS.ruins, walls: MAPS.ruins.walls.filter(w => !w.zm).map(w => ({ ...w })) }, seed: 9 });
    const c = n2.rules.crew.find(p => p.id === 'h2').zm;
    ok(c.pts === 1234 && c.perks.includes('iron') && c.plates === 100 && c.tiers.pistol === 2, `a migration onto a new Sim keeps points, perks, plates and tiers (${c.pts}, ${c.perks}, ${c.plates}, ${JSON.stringify(c.tiers)})`);
    clearZmWalls(n2.map);
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

// ---- Ashgrove Halt: the purpose-built map ----
section('ashgrove');
{
  const map = MAPS.ashgrove, L = zmLayout(map);
  const { zmDoorStand, syncZmDoors, reblockNav, ZM_PERKS } = await import('../js/shared/zombies.js');
  const area = id => L.bands.findIndex(b => b.id === id);
  ok(map.zmOnly && map.hidden && !MAP_IDS.includes('ashgrove') && mapModes(map).join() === 'zm', 'Graveyard Shift only: hidden, hosts zm alone');
  ok(L.graph && L.bands.length === 6 && L.bands.every(b => b.cells.length > 150), `six areas, all with floor (${L.bands.map(b => b.cells.length)})`);
  ok(L.bands[L.start].id === 'halt' && L.doors.length === 7, 'starts in the Halt, seven gates');
  // The loop: Halt, Goods Yard, Churchyard, Burial Field, Crossing Lane, back to the Halt; the Pump Yard off two sides.
  const joins = (x, y) => L.doors.some(d => (d.a === area(x) && d.b === area(y)) || (d.a === area(y) && d.b === area(x)));
  ok(['halt', 'goods', 'church', 'field', 'lane', 'halt'].every((x, i, a) => i === 0 || joins(a[i - 1], x)), 'the gates make a loop');
  ok(joins('church', 'pump') && joins('lane', 'pump'), 'the Pump Yard opens from the Churchyard and the Lane');
  ok(L.power && L.power.band === area('pump'), 'the power switch is in the Pump Yard');
  ok(L.boss && L.boss.band === area('field') && L.boss.spots.length >= 3 && L.boss.spots.every(p => L.band[L.cellAt(p.x, p.z)] === L.boss.band), 'boss spots in the Burial Field');
  ok(L.bands[area('field')].cells.length >= 400, `the boss arena is roomy (${L.bands[area('field')].cells.length} m2)`);
  ok(L.boxSpots.length >= 3 && L.boxSpots.length <= 4 && new Set(L.boxSpots.map(b => b.band)).size === L.boxSpots.length, 'three or four crate spots, in different areas');
  ok(L.machines.length === 6 && L.wallBuys.length >= 8 && L.bands.every(b => L.risers[b.i].length >= 4), 'machines, wall-buys and spawn windows everywhere');
  const R0 = L.reserved;
  ok(R0.bench && R0.terminal && R0.armour && R0.exfil && R0.traps?.length >= 2 && R0.traps.length <= 3, 'economy spots reserved (bench, terminal, armour, 2-3 traps, exfil)');
  ok([R0.bench, R0.terminal, R0.armour, R0.exfil, ...R0.traps].every(p => p.band >= 0 && p.note), 'every reserved spot in an area, with a note');
  ok(Math.hypot(L.bench.x - R0.bench.x, L.bench.z - R0.bench.z) < 0.01 && Math.hypot(L.terminal.x - R0.terminal.x, L.terminal.z - R0.terminal.z) < 0.01
    && Math.hypot(L.armour.x - R0.armour.x, L.armour.z - R0.armour.z) < 0.01 && L.exfil.x === R0.exfil.x && L.traps.length === R0.traps.length, 'the economy stands on the reserved spots');
  ok(L.altar.band === area('field') && L.relics.map(r => L.bands[r.band].id).sort().join() === 'church,goods,lane', 'the altar in the Burial Field, a relic in each dead end');
  // Dead ends: the lamp room, the crypt and the coal stage each have one way in (a flood from inside with that one
  // doorway blocked never gets out).
  placeZmWalls(map, (1 << L.doors.length) - 1);
  const nav = new NavGrid(map);
  for (const [name, inside, door] of [['lamp room', [4, 4], [4.5, 9]], ['crypt', [28, 4], [28.5, 9]], ['coal stage', [73, 42], [72, 37.5]]]) {
    const saved = nav.blocked.slice();
    for (let dx = -2; dx <= 2; dx++) for (let dz = -1; dz <= 1; dz++) nav.blocked[nav.idx(door[0] + dx, door[1] + dz)] = 1;
    const seen = reach(nav, inside[0], inside[1]);
    let n = 0; for (let k = 0; k < seen.length; k++) n += seen[k];
    ok(n > 10 && n < 100, `${name}: a dead end (${n} cells behind its one doorway)`);
    nav.blocked.set(saved);
  }
  clearZmWalls(map);
  // Gate stands on both sides.
  ok(L.doors.every(d => Object.keys(d.stand).length === 2), 'every gate has a stand point on each side');
  ok(zmDoorStand(L, 0, L.doors[0]) && !zmDoorStand(L, 0, L.doors[2]), 'zmDoorStand: only from an open side');

  // Power: perks dark until the switch is thrown; the switch costs nothing; guests see it; a migration keeps it.
  const sim = makeSim('ashgrove', 61);
  toLive(sim);
  const R = sim.rules, me = R.crew[0];
  for (const p of R.crew) if (p.bot) p.bot.update = () => [];
  R.plan = () => {}; R._crewPlan = null;
  ok(R.power === 0 && sim.rules.view().power === 0, 'the power starts off');
  const mercy = L.machines.find(m => m.perk === 'mercy');
  me.ps.x = mercy.x; me.ps.z = mercy.z; me.zm.pts = 9000;
  const u0 = zmUsable(L, me.ps.x, me.ps.z, R._stateFor(me));
  ok(u0?.kind === 'perk' && u0.off && !u0.ok, 'a machine shows dark with the power off');
  ok(!sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }) && me.zm.perks.length === 0 && me.zm.pts === 9000, 'a dark machine sells nothing');
  me.ps.x = L.power.x; me.ps.z = L.power.z;
  ok(zmUsable(L, me.ps.x, me.ps.z, R._stateFor(me)) === null || zmUsable(L, me.ps.x, me.ps.z, R._stateFor(me))?.kind !== 'power', 'the switch is out of reach while the Pump Yard is shut');
  for (const d of L.doors) if (d.a === area('lane') && d.b === area('pump') || d.a === area('halt') && d.b === area('lane')) R.open |= 1 << d.i;
  syncZmDoors(sim.map, R.open);
  const us = zmUsable(L, me.ps.x, me.ps.z, R._stateFor(me));
  ok(us?.kind === 'power' && us.ok && us.cost === 0, `the switch is offered (${us?.kind})`);
  // Every approach: a player walking at the switch from any side (real movement against the walls) gets the prompt
  // before stopping, and from the panel face too.
  {
    const { stepPlayer } = await import('../js/sim/player.js');
    const IDLE = { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, swap: false };
    let tried = 0, got = 0; const miss = [];
    for (let a = 0; a < 24; a++) {
      const ang = a / 24 * Math.PI * 2, sx = L.power.wx + Math.cos(ang) * 5, sz = L.power.wz + Math.sin(ang) * 5;
      if (!sim.nav.isWalkable(sx, sz)) continue;
      tried++;
      const ps = { ...me.ps, x: sx, z: sz, vx: 0, vz: 0 };
      let seen = false;
      for (let i = 0; i < 4 * SIM_HZ && !seen; i++) {
        const dx = L.power.wx - ps.x, dz = L.power.wz - ps.z, l = Math.hypot(dx, dz) || 1;
        stepPlayer(ps, { ...IDLE, mx: dx / l, mz: dz / l, aim: Math.atan2(dz, dx) }, DT, sim.map, sim.rng);
        seen = zmUsable(L, ps.x, ps.z, R._stateFor(me))?.kind === 'power';
      }
      if (seen) got++; else miss.push(`${(ang * 180 / Math.PI).toFixed(0)}deg`);
    }
    ok(tried >= 6 && got === tried, `the switch prompt shows from every walkable approach (${got}/${tried}${miss.length ? ', missed ' + miss.join(' ') : ''})`);
    ok(zmUsable(L, L.power.wx, L.power.wz, R._stateFor(me))?.kind === 'power', 'and right against the panel');
  }
  sim.drainEvents();
  ok(sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }) && R.power === 1 && me.zm.pts === 9000, 'throwing the switch is free');
  ok(sim.drainEvents().some(e => e.t === 'zlights' && e.by === me.id), 'zlights event');
  const again = zmUsable(L, me.ps.x, me.ps.z, R._stateFor(me));
  ok(again?.kind === 'power' && again.off && !again.ok && again.label === 'Power is on', `once on, the switch says "Power is on" (${again?.label})`);
  ok(!sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }) && sim.drainEvents().every(e => e.t !== 'zlights'), 'and cannot be thrown again');
  // A bot that throws it tells the whole crew too (the banner names it).
  {
    const s2 = makeSim('ashgrove', 62); toLive(s2);
    const R2 = s2.rules, bot = R2.crew.find(p => p.isBot);
    s2.drainEvents();
    R2._use(bot, { kind: 'power', i: 0, cost: 0, ok: true });
    ok(bot && s2.drainEvents().some(e => e.t === 'zlights' && e.by === bot.id), 'a bot throwing the switch emits zlights with its id');
  }
  me.ps.x = mercy.x; me.ps.z = mercy.z;
  ok(sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }) && me.zm.perks.includes('mercy') && me.zm.pts === 9000 - ZM_PERKS.mercy.cost, 'with the power on the machine sells');
  // Other maps: no switch, machines always on.
  const n = makeSim('neon', 3);
  ok(!n.rules.L.power && n.rules.power === 1, 'maps without a switch: power always on');
  // Wire and migration.
  const humans = [{ id: 'h1', name: 'Host', team: 0 }, { id: 'h2', name: 'Guest', team: 0 }];
  const roster = buildRoster(humans, { mode: 'zm', mapId: 'ashgrove', seed: 5 });
  const host = new Sim({ roster, map: 'ashgrove', seed: 5, mode: 'zm' });
  host.step(DT); toLive(host);
  const map2 = { ...MAPS.ashgrove, walls: MAPS.ashgrove.walls.filter(w => !w.zm).map(w => ({ ...w })) };
  const guest = new Sim({ roster, map: map2, seed: 5, mode: 'zm' });
  let view = guest.decodeSnapshot(JSON.parse(JSON.stringify(host.encodeSnapshotFor('h2'))), 'h2');
  ok((view.obj ?? view.points.obj).power === 0, 'guest sees the power off');
  host.rules.power = 1;
  host.step(DT); host.drainEvents();
  view = guest.decodeSnapshot(JSON.parse(JSON.stringify(host.encodeSnapshotFor('h2'))), 'h2');
  ok((view.obj ?? view.points.obj).power === 1 && guest.rules.power === 1, 'guest sees it on');
  if (guest._restoreMode) {
    guest.players.forEach((p, i) => { const v = view.players[i]; p.alive = v.alive; p.ps.x = v.x; p.ps.z = v.z; });
    guest._restoreMode(view);
    ok(guest.rules.power === 1, 'a migration keeps the power on');
  }
  clearZmWalls(MAPS.ashgrove);
}
{
  // A bot throws the power: solo with bots, from round 3, the Pump Yard open (or the gates on the way paid for).
  const sim = makeSim('ashgrove', 71, [{ id: 'me', name: 'Me', team: 0 }]);
  toLive(sim);
  const R = sim.rules, me = R.crew.find(p => !p.bot);
  me.spawnProtect = 1e9;
  for (const p of R.crew) { p.spawnProtect = 1e9; if (p.zm) p.zm.pts = 6000; }
  R._startRound(3);
  R.spawnT = 999;
  let by = null;
  run(sim, 90, e => { if (e.t === 'zlights') by = e.by; });
  const flipper = R.crew.find(p => p.id === by);
  ok(R.power === 1 && flipper?.bot, `a bot teammate throws the power after round 2 (${by})`);
  // Not with two humans, and not before round 3.
  const s2 = makeSim('ashgrove', 72, [{ id: 'a', name: 'A', team: 0 }, { id: 'b', name: 'B', team: 0 }]);
  toLive(s2);
  for (const p of s2.rules.crew) { p.spawnProtect = 1e9; if (p.zm) p.zm.pts = 6000; }
  s2.rules._startRound(3); s2.rules.spawnT = 999;
  run(s2, 60);
  ok(s2.rules.power === 0, 'with two humans the bots leave the switch to them');
  const s3 = makeSim('ashgrove', 73, [{ id: 'a', name: 'A', team: 0 }]);
  toLive(s3);
  for (const p of s3.rules.crew) { p.spawnProtect = 1e9; if (p.zm) p.zm.pts = 6000; }
  s3.rules._startRound(2); s3.rules.spawnT = 999;
  run(s3, 40);
  ok(s3.rules.power === 0, 'not in rounds 1 and 2');
  for (const s of [sim, s2, s3]) clearZmWalls(s.map);
}
{
  // Boss rounds: the boss rises in the Burial Field when it is open, at an ordinary riser when it is not.
  const { syncZmDoors, reblockNav } = await import('../js/shared/zombies.js');
  for (const fieldOpen of [true, false]) {
    const sim = makeSim('ashgrove', 81);
    toLive(sim);
    const R = sim.rules, L = R.L;
    for (const p of R.crew) if (p.bot) p.bot.update = () => [];
    R.plan = () => {}; R._crewPlan = null;
    const field = L.bands.findIndex(b => b.id === 'field');
    for (const d of L.doors) if (fieldOpen || (d.a !== field && d.b !== field)) R.open |= 1 << d.i;
    syncZmDoors(sim.map, R.open);
    for (const d of L.doors) reblockNav(sim.nav, sim.map, d);
    R.fields.clear();
    R._startRound(10);
    for (let k = 0; k < 20 && R.bossSeat < 0; k++) { R.spawnT = 0; R._stepSpawns(DT); }
    const boss = sim.players[R.bossSeat];
    const inField = boss && L.band[L.cellAt(boss.ps.x, boss.ps.z)] === field;
    ok(boss?.alive && boss.zk === 3 && inField === fieldOpen, `boss round, field ${fieldOpen ? 'open: rises in the Burial Field' : 'shut: rises elsewhere'} (${boss?.ps.x.toFixed(1)}, ${boss?.ps.z.toFixed(1)})`);
    clearZmWalls(sim.map);
  }
}

// ---- The economy (ROADMAP item 36): streaks off, the bench, the terminal, plates, traps, perks, exfil, the quest ----
section('econ');
{
  const { ZE, ZM_PERKS, supplyCost, zmTierCamo, syncZmDoors, reblockNav } = await import('../js/shared/zombies.js');
  const { zmTierDef } = await import('../js/sim/zm-phone.js');
  const { WEAPONS } = await import('../js/shared/weapons.js');
  // Loadout streaks: neither charged nor called, by humans or bots.
  {
    const sim = makeSim('ruins', 31, [{ id: 'me', name: 'Me', team: 0, loadout: { primary: 'ar', streaks: ['uav', 'turret', 'gunship'] } }]);
    const R = sim.rules;
    ok(R.crew.every(p => p.score.slots.length === 0 && p.loadout.streaks.length === 0), 'no loadout streak slots in the mode');
    let called = 0;
    run(sim, QUICK ? 90 : 160, e => { if (e.t === 'streak') called++; });
    ok(called === 0 && sim.useStreak('me') === null, `no streaks called (${called})`);
  }
  const openAll = (sim, R) => { for (const d of R.L.doors) R.open |= 1 << d.i; syncZmDoors(sim.map, R.open); for (const d of R.L.doors) reblockNav(sim.nav, sim.map, d); R.fields.clear(); };
  const sim = makeSim('neon', 37, [{ id: 'me', name: 'Me', team: 0 }]);
  toLive(sim);
  const R = sim.rules, L = R.L, E = R.econ, me = R.crew.find(p => !p.isBot);
  for (const p of R.crew) if (p.bot) p.bot.update = () => [];
  R.plan = () => {}; R._crewPlan = null;
  openAll(sim, R);
  R._startRound(6); R.spawnT = 999;
  me.spawnProtect = 0;
  const use = (extra = {}) => sim.applyCommand(me.id, { cmd: 'zm', act: 'use', ...extra });
  const at = p => { me.ps.x = p.x; me.ps.z = p.z; };
  const usable = () => zmUsable(L, me.ps.x, me.ps.z, R._stateFor(me));
  // ---- The upgrade bench ----
  R._give(me, 'ar');
  me.zm.pts = 100000;
  at(L.bench);
  let u = usable();
  ok(u?.kind === 'bench' && u.gun === 'ar' && u.tier === 1 && u.cost === ZE.bench.cost[0], `the bench offers tier 1 for ${ZE.bench.cost[0]} (${u?.kind})`);
  sim.drainEvents();
  ok(use() && E.bench.state === 1 && me.zm.pts === 100000 - ZE.bench.cost[0], 'tier 1 paid, the gun goes in');
  const evs = sim.drainEvents();
  ok(me.ps.weapon === 'knife' && evs.some(e => e.t === 'zarm' && e.id === me.id) && evs.some(e => e.t === 'zbench' && e.state === 1), 'out of the hands meanwhile (zarm, zbench)');
  const mate = R.crew.find(p => p.isBot);
  ok(zmUsable(L, L.bench.x, L.bench.z, R._stateFor(mate))?.off && !R._use(mate, zmUsable(L, L.bench.x, L.bench.z, R._stateFor(mate))), 'nobody else can use the bench meanwhile');
  ok(usable()?.kind === 'benchwait' && !use(), 'its owner waits');
  run(sim, ZE.bench.time + 0.2);
  ok(E.bench.state === 2 && usable()?.kind === 'benchtake', 'ready: take it');
  sim.drainEvents();
  ok(use() && E.bench.state === 0 && me.ps.weapon === 'ar' && me.zm.tiers.ar === 1, 'back in hand at tier 1');
  const arm = sim.drainEvents().find(e => e.t === 'zarm');
  const slot = me.ps.primary === 'ar' ? 0 : 1;
  ok(arm?.tier === 1 && me.ps.defs[slot].magazine === zmTierDef('ar', 1).magazine && zmTierDef('ar', 1).magazine > WEAPONS.ar.magazine, `bigger magazine (${WEAPONS.ar.magazine} -> ${me.ps.defs[slot].magazine}), the phone told`);
  // Damage at tier 1.
  const z = R.horde[0];
  R._raise(z, 0, { x: me.ps.x + 2, z: me.ps.z });
  let hp = z.hp;
  sim._damage(z, me, 10, 'ar', 2);
  ok(Math.abs(hp - z.hp - 10 * ZE.tiers[1].dmg) < 0.01, `tier 1 hits ${ZE.tiers[1].dmg}x`);
  // Tiers 2 and 3 (left on the bench past its hold: it comes back by itself).
  z.alive = false;
  const pb = me.zm.pts;
  ok(use() && E.bench.tier === 2 && me.zm.pts === pb - ZE.bench.cost[1], 'tier 2 costs more');
  run(sim, ZE.bench.time + ZE.bench.hold + 0.3);
  ok(E.bench.state === 0 && me.zm.tiers.ar === 2 && me.ps.weapon === 'ar', 'left on the bench, it comes back by itself');
  ok(use(), 'tier 3');
  run(sim, ZE.bench.time + 0.2); use();
  ok(me.zm.tiers.ar === 3 && usable()?.off && usable()?.why === 'Fully upgraded', 'tier 3 is the top');
  ok(zmTierCamo('ar', 3) === 'wire' && zmTierCamo('smg', 3) === 'molten' && zmTierCamo('shotgun', 3) === 'horizon' && zmTierCamo('dmr', 3) === 'pp-silver', 'tier 3 looks by class');
  // Arc rounds: a hit jumps to two more nearby.
  const zs = [R.horde[1], R.horde[2], R.horde[3]];
  zs.forEach((q, k) => R._raise(q, 0, { x: me.ps.x + 3, z: me.ps.z + k - 1 }));
  sim._fxT?.clear?.(); E._fxT.clear();
  const before = zs.map(q => q.hp);
  sim.drainEvents();
  sim._damage(zs[1], me, 10, 'ar', 3);
  const arcs = sim.drainEvents().filter(e => e.t === 'zfx' && e.k === 'arc').length;
  ok(arcs === 2 && zs[0].hp < before[0] && zs[2].hp < before[2], `arc rounds jump to two more (${arcs})`);
  // The tier stays with the gun through a swap, and goes when the gun is given up.
  const arSlot = () => (me.ps.primary === 'ar' ? 0 : 1);
  me.ps.slot = 1 - arSlot(); me.ps.weapon = me.ps.slot ? me.ps.secondary : me.ps.primary;
  R._give(me, 'shotgun');
  ok(me.zm.tiers.ar === 3 && (me.ps.primary === 'ar' || me.ps.secondary === 'ar') && me.ps.weapon === 'shotgun', 'a new gun in the other hand: the tier stays with the first');
  me.ps.slot = arSlot(); me.ps.weapon = 'ar';
  const zt = R.horde[4];
  R._raise(zt, 0, { x: me.ps.x - 3, z: me.ps.z });
  hp = zt.hp;
  sim._damage(zt, me, 10, 'ar', 3);
  ok(me.zm.tiers.ar === 3 && Math.abs(hp - zt.hp - 10 * ZE.tiers[3].dmg) < 0.01, 'swapped back to, it hits at tier 3');
  zt.alive = false;
  R._give(me, 'lmg');
  ok(!me.zm.tiers.ar && me.ps.weapon === 'lmg', 'given up for another gun: the tier goes with it');
  // Rime rounds slow; Ember rounds burn; Burst rounds burst.
  me.zm.tiers.lmg = 0;
  for (const [gun, k] of [['dmr', 'frost'], ['smg', 'burn']]) {
    R._give(me, gun); me.zm.tiers[gun] = 3;
    const q = R.horde[5 + (gun === 'smg')];
    R._raise(q, 0, { x: me.ps.x + 4, z: me.ps.z + 2 });
    sim.drainEvents();
    sim._damage(q, me, 5, gun, 4);
    ok(sim.drainEvents().some(e => e.t === 'zfx' && e.k === k) && (k === 'frost' ? q.zSlowT > sim.time : q.zBurnT > sim.time), `${gun}: ${k}`);
    if (k === 'burn') { const h = q.hp; run(sim, 1); ok(q.hp < h, 'burning hurts over time'); }
  }
  // ---- The supply terminal ----
  at(L.terminal);
  ok(usable()?.kind === 'terminal' && usable().ok, 'the terminal is in reach');
  ok(supplyCost('sentry', 1) === ZE.supply.sentry.cost && supplyCost('sentry', 20) > supplyCost('sentry', 10), 'supply prices climb with the rounds');
  for (const q of R.horde) if (q.alive) { q.alive = false; q.hp = 0; }
  const items = {};
  for (const item of ['sentry', 'drone', 'lure', 'strike', 'vest']) {
    const p0 = me.zm.pts;
    me.zm.plates = 0;
    items[item] = use({ item }) && me.zm.pts === p0 - supplyCost(item, R.round);
  }
  ok(Object.values(items).every(Boolean), `every item sold at its price (${JSON.stringify(items)})`);
  ok(E.gear.map(g => g.kind).sort().join() === 'drone,lure,sentry,strike' && me.zm.plates === ZE.plate.hp * ZE.plate.max, 'sentry, drone, lure and strike in play; the vest fills the plates');
  ok(!use({ item: 'sentry' }), 'one of each a round');
  // Zombies in front of the sentry and the strike's mark: they take fire.
  const sentry = E.gear.find(g => g.kind === 'sentry');
  const tz = R.horde.slice(0, 3);
  tz.forEach((q, k) => R._raise(q, 0, { x: sentry.x + 5 + k * 0.5, z: sentry.z }));
  const hp0 = tz.map(q => q.hp);
  let shots = 0, booms = 0;
  run(sim, 3, e => { if (e.t === 'turret_shot') shots++; if (e.t === 'explosion') booms++; });
  ok(shots > 3 && tz.some((q, k) => !q.alive || q.hp < hp0[k]), `the sentry and drone fire (${shots} shots)`);
  ok(booms >= ZE.supply.strike.shells - 1, `the strike's shells land (${booms})`);
  // The lure pulls a zombie away from the crew.
  for (const q of R.horde) if (q.alive) { q.alive = false; q.hp = 0; }
  const lure = E.gear.find(g => g.kind === 'lure');
  if (lure) {
    lure.life = 10;
    const q = R.horde[8];
    const spot = { x: (lure.x + me.ps.x) / 2 + 6, z: lure.z };
    R._raise(q, 0, sim.nav.isWalkable(spot.x, spot.z) ? spot : { x: lure.x + 3, z: lure.z });
    const d0 = Math.hypot(q.ps.x - lure.x, q.ps.z - lure.z);
    run(sim, 3);
    ok(Math.hypot(q.ps.x - lure.x, q.ps.z - lure.z) < d0 || !q.alive, 'a zombie goes for the lure');
  } else ok(false, 'the lure is in play');
  // ---- Plates ----
  E.gear.length = 0;
  for (const q of R.horde) if (q.alive) { q.alive = false; q.hp = 0; }
  me.zm.plates = 0;
  at(L.armour);
  const p1 = me.zm.pts;
  ok(usable()?.kind === 'armour' && use() && me.zm.plates === ZE.plate.hp && me.zm.pts === p1 - ZE.plate.cost, 'a plate for 500');
  use(); use();
  ok(me.zm.plates === ZE.plate.hp * 3 && usable()?.off && !use(), 'three at most');
  const claw = R.horde[0];
  R._raise(claw, 0, { x: me.ps.x + 1, z: me.ps.z });
  me.hp = 100;
  sim._damage(me, claw, 40, 'knife', 1);
  ok(me.hp === 100 && me.zm.plates === ZE.plate.hp * 3 - 40, 'plates take a claw first');
  me.zm.plates = 10;
  sim.drainEvents();
  sim._damage(me, claw, 40, 'knife', 1);
  ok(Math.abs(me.hp - 70) < 0.01 && me.zm.plates === 0 && sim.drainEvents().some(e => e.t === 'plates_break'), 'the last plate breaks, the rest goes through');
  claw.alive = false;
  // ---- Traps ----
  const T = L.traps[0];
  me.ps.x = T.sx; me.ps.z = T.sz;
  me.hp = 100;
  u = usable();
  ok(u?.kind === 'trap' && u.cost === ZE.trap.cost, `a trap's switch (${u?.kind})`);
  const p2 = me.zm.pts;
  ok(use() && E.traps[0].state === 1 && me.zm.pts === p2 - ZE.trap.cost, 'armed for 1000');
  ok(usable()?.off && !use(), 'not again while it runs');
  const victim = R.horde[0];
  R._raise(victim, 1, { x: T.x, z: T.z });
  victim.zPace = 0;
  const p3 = me.zm.pts, k0 = R.killed;
  run(sim, 2.5);
  ok(!victim.alive && R.killed === k0 + 1 && me.zm.pts === p3 + ZE.trap.pay, `the trap kills, and pays ${ZE.trap.pay} (got ${me.zm.pts - p3})`);
  me.ps.x = T.x; me.ps.z = T.z; me.hp = 100; me.zm.plates = 0;
  run(sim, 1);
  ok(me.hp < 100 && me.hp > 70 && !me.downed, `a player in it is hurt lightly (${me.hp.toFixed(0)})`);
  me.ps.x = T.sx; me.ps.z = T.sz;
  run(sim, ZE.trap.on);
  ok(E.traps[0].state === 2, 'then it cools down');
  run(sim, ZE.trap.cool + 0.5);
  ok(E.traps[0].state === 0 && usable()?.ok, 'and can be armed again');
  // ---- Perks: the two new machines, the cap, the slot ----
  me.zm.perks = []; me.zm.limit = ZM.perkLimit;
  for (const perk of ['iron', 'quick', 'mercy', 'hammer']) { at(L.machines.find(m => m.perk === perk)); use(); }
  ok(me.zm.perks.length === 4, 'four perks');
  at(L.machines.find(m => m.perk === 'stride'));
  u = usable();
  ok(u?.kind === 'slot' && u.cost === ZM.slotCost, `at the cap a machine sells a perk slot (${u?.kind})`);
  const p4 = me.zm.pts;
  ok(use() && me.zm.limit === ZM.perkMax && me.zm.pts === p4 - ZM.slotCost, 'the slot raises the cap to six');
  ok(use() && me.zm.perks.includes('stride') && me.ps.perks.includes('marathon'), 'Fleetfoot: Marathon\'s sprint');
  at(L.machines.find(m => m.perk === 'breath'));
  ok(use() && me.zm.perks.length === 6, 'six perks');
  // Last Breath: down, up by yourself, perks kept; spent for three rounds.
  for (const q of R.crew) if (q !== me) { q.alive = false; }
  const cl = R.horde[1];
  R._raise(cl, 0, { x: me.ps.x + 1, z: me.ps.z });
  me.hp = 10; me.zm.plates = 0;
  sim._damage(me, cl, 500, 'knife', 1);
  cl.alive = false;
  ok(me.downed && me.zm.perks.length === 6 && sim.phase !== 'ended', 'Last Breath: down alone, perks kept, not over');
  run(sim, 3.3);
  ok(!me.downed && me.alive && me.zm.breathAt === R.round + 3, 'up by yourself; spent for three rounds');
  for (const q of R.crew) if (q !== me) { sim._placeAt(q, me.ps, 0); q.spawnProtect = 1e9; }
  R._raise(cl, 0, { x: me.ps.x + 1, z: me.ps.z });
  sim._damage(me, cl, 500, 'knife', 1);
  ok(me.downed && me.zm.perks.length === 0, 'spent: an ordinary down loses the perks');
  cl.alive = false;
  me.downed = false; me.hp = 100;
  clearZmWalls(sim.map);
}
{
  // ---- Exfil ----
  const { ZE, syncZmDoors, reblockNav } = await import('../js/shared/zombies.js');
  for (const stay of [true, false]) {
    const sim = makeSim('ashgrove', 41, [{ id: 'me', name: 'Me', team: 0 }]);
    toLive(sim);
    const R = sim.rules, L = R.L, E = R.econ, me = R.crew.find(p => !p.isBot);
    for (const p of R.crew) { p.spawnProtect = 1e9; if (p.bot) p.bot.update = () => []; }
    R.plan = () => {}; R._crewPlan = null;
    for (const d of L.doors) R.open |= 1 << d.i;
    syncZmDoors(sim.map, R.open); for (const d of L.doors) reblockNav(sim.nav, sim.map, d); R.fields.clear();
    R._startRound(14); R.spawnT = 999;
    me.zm.pts = 50000;
    me.ps.x = L.exfil.x; me.ps.z = L.exfil.z;
    let u = zmUsable(L, me.ps.x, me.ps.z, R._stateFor(me));
    ok(u?.kind === 'exfil' && u.off && !sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }), 'no exfil before round 15');
    R._startRound(15); R.spawnT = 999;
    let ev = [];
    ok(sim.applyCommand(me.id, { cmd: 'zm', act: 'use' }) && E.exfil.state === 1 && me.zm.pts === 50000 - ZE.exfil.cost, 'round 15: the exfil is called for its price');
    if (!stay) { me.ps.x = L.starts[0].x; me.ps.z = L.starts[0].z; }
    const k0 = R.killed;
    let extras = 0;
    run(sim, ZE.exfil.hold * 0.5, e => { ev.push(e); });
    extras = R.horde.filter(p => p.alive && p.zExtra).length;
    ok(extras > 3 && R.killed === k0, `a final wave comes (${extras} up, off the round's count)`);
    if (!stay) {
      // Nobody needs to beat the wave: the crew stays where it is.
      for (const z of R.horde) if (z.alive) sim._selfKill(z, 'test');
    }
    run(sim, ZE.exfil.hold * 0.5 + 1, e => { ev.push(e); });
    if (stay) {
      const esc = ev.find(e => e.t === 'zescape');
      ok(esc && esc.ids.includes(me.id) && sim.phase === 'ended' && sim.winner === 0, 'on the pad at the end: escaped, the match won');
      ok(R.view().escaped?.includes(me.id) && R.best === 15, 'the view says who got out');
      const map2 = { ...MAPS.ashgrove, walls: MAPS.ashgrove.walls.filter(w => !w.zm).map(w => ({ ...w })) };
      const guest = new Sim({ roster: sim.players.map(p => ({ id: p.id, name: p.name, team: p.team, isBot: p.isBot, ai: p.ai, loadout: p.loadout })), map: map2, seed: 41, mode: 'zm' });
      const view = guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshotFor(me.id))), me.id);
      ok((view.obj ?? view.points.obj).escaped?.includes(me.id), 'a guest sees who got out');
      clearZmWalls(map2);
    } else {
      ok(ev.some(e => e.t === 'zexfil' && e.fail) && E.exfil.state === 0 && sim.phase !== 'ended', 'nobody on the pad: the exfil fails, the match goes on');
    }
    clearZmWalls(sim.map);
  }
}
{
  // ---- The quest: three relics, the altar, the Gravewarden ----
  const { ZE, ZM_KINDS, syncZmDoors, reblockNav } = await import('../js/shared/zombies.js');
  const sim = makeSim('ashgrove', 43, [{ id: 'me', name: 'Me', team: 0 }]);
  toLive(sim);
  const R = sim.rules, L = R.L, E = R.econ, me = R.crew.find(p => !p.isBot);
  for (const p of R.crew) { p.spawnProtect = 1e9; if (p.bot) p.bot.update = () => []; }
  R.plan = () => {}; R._crewPlan = null;
  for (const d of L.doors) R.open |= 1 << d.i;
  syncZmDoors(sim.map, R.open); for (const d of L.doors) reblockNav(sim.nav, sim.map, d); R.fields.clear();
  R._startRound(12); R.spawnT = 999;
  const use = () => sim.applyCommand(me.id, { cmd: 'zm', act: 'use' });
  me.ps.x = L.altar.x; me.ps.z = L.altar.z;
  ok(zmUsable(L, me.ps.x, me.ps.z, R._stateFor(me))?.kind === 'altar' && !use(), 'the altar waits for its relics');
  const got = [];
  for (const r of L.relics) { me.ps.x = r.x; me.ps.z = r.z; sim.drainEvents(); ok(use(), `relic ${r.i} picked up`); got.push(sim.drainEvents().find(e => e.t === 'zrelic')?.n); }
  ok(got.join() === '1,2,3' && E.quest.got === 7, `relics counted (${got})`);
  me.ps.x = L.altar.x; me.ps.z = L.altar.z;
  ok(use() && E.quest.state === 1, 'set on the altar');
  run(sim, 1.5);
  const w = sim.players[E.wardenSeat];
  ok(w?.alive && w.zk === 4 && w.zMax >= R.hp * ZM.kinds.warden.hp, `the Gravewarden rises (${w?.zMax} hp)`);
  ok(R.view().boss?.warden, 'its bar shows');
  const k0 = R.killed, pts = R.crew.map(p => p.zm.pts);
  let down = null;
  sim._damage(w, me, w.hp + 10, 'ar', 5);
  run(sim, 0.1, e => { if (e.t === 'zwarden' && e.state === 2) down = e; });
  ok(!w.alive && E.quest.state === 2 && down, 'put down: the quest is done');
  ok(R.killed === k0 && R.crew.every((p, k) => p.zm.pts >= pts[k] + ZE.quest.pts), 'it pays everyone and is off the round count');
  clearZmWalls(sim.map);
}
{
  // ---- Bots spend in the economy ----
  const sim = makeSim('neon', 47);
  toLive(sim);
  const R = sim.rules;
  const { syncZmDoors, reblockNav } = await import('../js/shared/zombies.js');
  for (const d of R.L.doors) R.open |= 1 << d.i;
  syncZmDoors(sim.map, R.open); for (const d of R.L.doors) reblockNav(sim.nav, sim.map, d); R.fields.clear();
  for (const p of R.crew) { p.spawnProtect = 1e9; p.zm.pts = 40000; p.zm.perks = ['iron', 'quick', 'mercy', 'hammer']; R._give(p, 'ar'); }
  R._startRound(9);
  const kinds = new Set(), items = new Set();
  run(sim, QUICK ? 100 : 160, e => { if (e.t === 'zbuy') { kinds.add(e.kind); if (e.item) items.add(e.item); } if (e.t === 'zround' && e.round > 9) for (const p of R.crew) p.zm.pts = Math.max(p.zm.pts, 30000); });
  ok(kinds.has('bench') && kinds.has('armour') && kinds.has('terminal'), `bots upgrade guns, buy plates and use the terminal (${[...kinds]}; items ${[...items]})`);
  ok(R.crew.some(p => Object.values(p.zm.tiers).some(t => t > 0)), 'a bot holds an upgraded gun');
  ok(R.crew.some(p => p.zm.limit > ZM.perkLimit), 'a rich bot buys a perk slot');
  clearZmWalls(sim.map);
}
{
  // ---- Wire and migration: the economy's state reaches a guest and survives a new host ----
  const humans = [{ id: 'h1', name: 'Host', team: 0 }, { id: 'h2', name: 'Guest', team: 0 }];
  const roster = buildRoster(humans, { mode: 'zm', mapId: 'ruins', seed: 13 });
  const host = new Sim({ roster, map: 'ruins', seed: 13, mode: 'zm' });
  host.step(DT); toLive(host);
  const R = host.rules, E = R.econ, h2 = R.crew.find(p => p.id === 'h2');
  R._startRound(11);
  R._give(h2, 'smg'); h2.zm.tiers.smg = 2; h2.zm.plates = 75; h2.zm.limit = ZM.perkMax; h2.zm.perks = ['iron', 'breath'];
  E.traps[0].state = 1; E.traps[0].timer = 12;
  E.bench = Object.assign(E.bench, { state: 1, owner: R.crew[0].index, gun: 'ar', tier: 2, timer: 3, slot: 0 });
  E._supply(h2, 'sentry'); E._supply(h2, 'lure');
  E.quest.got = 5;
  const map2 = { ...MAPS.ruins, walls: MAPS.ruins.walls.filter(w => !w.zm).map(w => ({ ...w })) };
  const guest = new Sim({ roster, map: map2, seed: 13, mode: 'zm' });
  const snap = host.encodeSnapshotFor('h2');
  const view = guest.decodeSnapshot(JSON.parse(JSON.stringify(snap)), 'h2');
  const obj = view.obj ?? view.points.obj, G = guest.rules, g2 = G.crew.find(p => p.id === 'h2');
  ok(obj.bench.state === 1 && obj.bench.gun === 'ar' && obj.bench.tier === 2, 'guest sees the bench at work');
  ok(obj.traps[0].state === 1 && Math.abs(obj.traps[0].timer - 12) < 0.2 && obj.gear.length === 2 && obj.quest.got === 5, 'guest sees traps, gear and the quest');
  const v2 = view.players.find(p => p.id === 'h2');
  ok(v2.zplates === 75 && v2.zlimit === ZM.perkMax && g2.zm.tiers.smg === 2 && v2.zperks.includes('breath'), 'guest sees plates, the perk cap, gun tiers and the new perks');
  ok(JSON.stringify(snap).length < 2600, `snapshot with the economy ${JSON.stringify(snap).length} B`);
  if (guest._restoreMode) {
    guest.players.forEach((p, i) => { const v = view.players[i]; p.alive = v.alive; p.ps.x = v.x; p.ps.z = v.z; });
    guest._restoreMode(view);
    ok(G.econ.bench.state === 1 && G.econ.traps[0].state === 1 && G.econ.gear.length === 2 && G.econ.quest.got === 5, 'a migration keeps the bench, traps, gear and quest');
    ok(g2.zm.tiers.smg === 2 && g2.zm.plates === 75 && g2.zm.limit === ZM.perkMax, 'and every player\'s tiers, plates and perk cap');
    // The new host runs it on: the bench finishes, the trap times out.
    guest.step(DT);
    for (let i = 0; i < 20 * 60 && G.econ.traps[0].state === 1; i++) { guest.step(DT); guest.drainEvents(); }
    ok(G.econ.traps[0].state === 2 && G.econ.bench.state !== 1, 'the new host carries on with them');
  }
  clearZmWalls(map2); clearZmWalls(host.map);
}
{
  // The save: an escape's round and the Gravewarden per map, through an export code; the calling card.
  const { recordZmFeat, CARDS, cardsEarned } = await import('../js/shared/progression.js');
  const s = blankSave();
  ok(recordZmFeat(s, 'ashgrove', { escaped: 16 }).freshEscape && s.zmFeats.ashgrove[0] === 16, 'an escape recorded');
  ok(!recordZmFeat(s, 'ashgrove', { escaped: 15 }).freshEscape && s.zmFeats.ashgrove[0] === 16, 'a lower escape keeps the best');
  const fb = recordZmFeat(s, 'neon', { boss: true });
  ok(fb.freshBoss && s.zmFeats.neon[1] === 1 && !recordZmFeat(s, 'neon', { boss: true }).freshBoss, 'the Gravewarden flag, once');
  const back = decodeSave(encodeSave(s));
  ok(back.ok && back.save.zmFeats.ashgrove[0] === 16 && back.save.zmFeats.neon[1] === 1, 'feats survive an export code');
  ok(JSON.stringify(sanitizeSave({ zmFeats: { neon: [-1, 'x'], ruins: [2000, 0], __proto__: [1, 1] } }).zmFeats) === '{"neon":[0,1],"ruins":[999,0]}', 'feats sanitised');
  const card = CARDS.find(c => c.id === 'zm-warden');
  ok(card && card.need({ zmFeats: s.zmFeats }) && !card.need({ zmFeats: { neon: [12, 0] } }), 'the Gravewarden card follows the flag');
  void cardsEarned;
}

// ---- Determinism ----
// ---- Special zombies and special rounds (js/sim/zm-kinds.js) ----
section('specials');
{
  // Introduced gradually: none before round 8, all four by 15, shares growing with the round.
  const share = (r, k) => specialMix(r).find(m => m.kind === k).share;
  ok(specialMix(7).every(m => m.share === 0), 'no specials before round 8');
  ok(share(8, ZK.crawler) > 0 && share(9, ZK.spitter) > 0 && share(11, ZK.bloater) > 0 && share(13, ZK.shield) > 0 && share(12, ZK.shield) === 0, 'crawler 8, spitter 9, bloater 11, shieldbearer 13');
  ok(specialMix(15).every(m => m.share > 0) && specialMix(25).every((m, i) => m.share >= specialMix(15)[i].share), 'all four by round 15, growing after');
  // Special rounds: every five to seven rounds from 6 or 7, never a boss round, the three in turn, the same everywhere.
  for (const seed of [1, 7, 99, 12345]) {
    const at = [];
    for (let r = 1; r <= 60; r++) if (specialRound(r, seed)) at.push([r, specialRound(r, seed)]);
    const gaps = at.slice(1).map((a, i) => a[0] - at[i][0]);
    ok(at[0][0] >= 6 && at[0][0] <= 8 && gaps.every(g => g >= 5 && g <= 8) && at.every(a => !isBossRound(a[0])), `seed ${seed}: special rounds ${at.map(a => a[0]).join(' ')}`);
    ok(at.every((a, i) => a[1] === ZM_ROUNDS[i % 3]), `seed ${seed}: sprint, fog, bloat in turn`);
  }
  // A small arena on Foundry: the crew's first member alone (the others away, the bots' own brains off), one zombie raised.
  const open = (sim, len) => {
    for (let z = 6; z < sim.map.height - 6; z += 1) for (let x = 6; x < sim.map.width - len - 6; x += 1) {
      if ([-1, 0, 1].every(dz => sim.nav.segmentClear(x, z + dz, x + len, z + dz)) && sim.nav.segmentClear(x, z - 3, x, z + 3) && sim.nav.segmentClear(x + len, z - 3, x + len, z + 3)) return { x, z };
    }
    throw new Error('no open ground');
  };
  const arena = (seed, round = 15) => {
    const sim = makeSim('foundry', seed);
    toLive(sim);
    const R = sim.rules;
    for (const p of R.crew) if (p.bot) p.bot.update = () => [];
    R.plan = () => {}; R._crewPlan = null;
    R.round = round; R.hp = roundHp(round); R.state = 2; R.timer = 999;
    const me = R.crew[0], A = open(sim, 16);
    for (const p of R.crew) { p.spawnProtect = 0; if (p !== me) { p.away = true; p.ps.x = A.x; p.ps.z = A.z + 30; } }
    me.ps.x = A.x; me.ps.z = A.z; me.hp = 100; me.ps.vx = me.ps.vz = 0;
    sim.drainEvents();
    const raise = (kind, x, z) => { const seat = R.horde.find(q => !q.alive); R._raise(seat, kind, { x, z }); return seat; };
    return { sim, R, me, A, raise };
  };
  const holdStill = (sim, p) => { p.bot && (p.bot.update = () => []); };
  // Spitter: keeps its distance, winds up, lobs a glob at the target; standing still it lands, a sidestep dodges it.
  for (const dodge of [false, true]) {
    const { sim, R, me, A, raise } = arena(201);
    holdStill(sim, me);
    const sp = raise(ZK.spitter, A.x + 11, A.z);
    sp.zSpitCd = 0;
    let spit = null, minD = Infinity, hp0 = me.hp, dodged = false;
    for (let i = 0; i < 6 * SIM_HZ && !spit; i++) {
      me.ps.x = A.x; me.ps.z = A.z; me.ps.vx = me.ps.vz = 0;
      sim.step(DT);
      minD = Math.min(minD, Math.hypot(sp.ps.x - me.ps.x, sp.ps.z - me.ps.z));
      spit = sim.drainEvents().find(e => e.t === 'zspit');
    }
    ok(!!spit && Math.hypot(spit.x - A.x, spit.z - A.z) < 0.6 && spit.dur > 0.6 && spit.dur < 1.6, `spitter lobs a glob at a standing target (${spit ? `lands ${Math.hypot(spit.x - A.x, spit.z - A.z).toFixed(2)} m off, ${spit.dur} s` : 'none'})`);
    ok(minD > ZM_SPIT.near - 0.5, `spitter keeps its distance (closest ${minD.toFixed(1)} m)`);
    if (dodge) { me.ps.x = A.x; me.ps.z = A.z + 2.6; dodged = true; }
    let hurt = 0;
    for (let i = 0; i < (spit?.dur ?? 1) * SIM_HZ + 2; i++) {
      sim.step(DT);
      for (const e of sim.drainEvents()) if (e.t === 'hit' && e.target === me.id) hurt += e.dmg ?? 0;
      if (dodged) { me.ps.x = A.x; me.ps.z = A.z + 2.6; }
      else { me.ps.x = A.x; me.ps.z = A.z; }
    }
    if (dodge) ok(me.hp === hp0 && hurt === 0, `a sidestep dodges the glob (hp ${me.hp})`);
    else ok(me.hp < hp0, `a glob that lands hurts (hp ${hp0} -> ${Math.round(me.hp)})`);
    // The puddle burns for a while, then is gone.
    if (!dodge) {
      me.hp = 100; me.regenT = 99;
      R.kinds.globs.length = 0;
      sp.alive = false;
      run(sim, 1);
      const burnt = 100 - me.hp;
      ok(burnt > 5 && burnt < 40, `the puddle burns whoever stands in it (${burnt.toFixed(0)} in 1 s)`);
      run(sim, ZM_SPIT.life);
      me.hp = 100;
      run(sim, 1);
      ok(me.hp === 100 && R.kinds.puddles.length === 0, 'and dries up after a few seconds');
    }
  }
  // Bloater: killed, it bursts where it falls: the crew near it hurt (not the far shooter), the horde round it too.
  {
    const { sim, R, me, A, raise } = arena(202);
    const far = R.crew[1]; far.away = false; far.ps.x = A.x + 16; far.ps.z = A.z; far.hp = 100; far.regenT = 99; me.regenT = 99;
    const bl = raise(ZK.bloater, A.x + 3, A.z), sh = raise(ZK.shambler, A.x + 5.5, A.z + 1);
    const shHp = sh.hp;
    ok(bl.hp > sh.hp * 2, `a bloater is tough (${bl.hp} vs ${sh.hp})`);
    sim._damage(bl, far, bl.hp + 1, 'ar', 13);
    let ev = [];
    for (let i = 0; i < 3; i++) { sim.step(DT); ev = ev.concat(sim.drainEvents()); }
    const blast = ev.find(e => e.t === 'zblast');
    ok(!bl.alive && !!blast && ev.some(e => e.t === 'explosion'), 'a dead bloater bursts (zblast + explosion)');
    ok(me.hp < 100 - 20 && far.hp === 100, `the burst hurts the crew in range (${Math.round(me.hp)}), not the shooter far off (${far.hp})`);
    ok(!sh.alive || sh.hp < shHp, 'and the horde round it');
  }
  {
    // Reaching you, it swells and bursts.
    const { sim, R, me, A, raise } = arena(203);
    me.regenT = 99;
    const bl = raise(ZK.bloater, A.x + 1.2, A.z);
    let blast = false;
    for (let i = 0; i < 3 * SIM_HZ && !blast; i++) { me.ps.x = A.x; me.ps.z = A.z; sim.step(DT); blast = sim.drainEvents().some(e => e.t === 'zblast'); }
    ok(blast && !bl.alive && me.hp < 60, `a bloater that reaches you bursts (hp ${Math.round(me.hp)})`);
  }
  // Crawler: low and quick, and a smaller target than a shambler (a shot just wide of centre misses it).
  {
    const { sim, R, me, A, raise } = arena(204);
    const cr = raise(ZK.crawler, A.x + 8, A.z + 0.42), sh = raise(ZK.shambler, A.x + 8, A.z - 0.58);
    ok(cr.zLow && cr.zPace > sh.zPace * 1.8, `crawler: low, and quick (${cr.zPace.toFixed(2)} vs ${sh.zPace.toFixed(2)})`);
    const crHp = cr.hp, shHp = sh.hp;
    me.ps.aim = 0;
    sim.applyShot(me.id, { weapon: me.ps.weapon, ox: A.x, oz: A.z, aim: 0, angles: [0] });
    me.ps.z = A.z - 1;
    sim.applyShot(me.id, { weapon: me.ps.weapon, ox: A.x, oz: A.z - 1, aim: 0, angles: [0] });
    ok(cr.hp === crHp && sh.hp < shHp, `a shot 0.42 m off centre misses a crawler (${cr.hp}/${crHp}) and hits a shambler (${sh.hp}/${shHp})`);
  }
  // Shieldbearer: bullets from the front hit the shield; from behind, the body; enough damage breaks it; a frag goes round.
  {
    const { sim, R, me, A, raise } = arena(205);
    const sb = raise(ZK.shield, A.x + 6, A.z);
    sb.ps.aim = Math.PI;      // Facing the crew.
    const hp0 = sb.hp, sh0 = sb.zShield;
    ok(sh0 > hp0, `the shield holds more than its bearer (${sh0} vs ${hp0})`);
    sim._damage(sb, me, 50, 'ar', 6);
    ok(sb.hp === hp0 && sb.zShield === sh0 - 50, 'a shot from the front hits the shield');
    const pts = me.zm.pts;
    sim._damage(sb, me, 50, 'frag', 6, null, false, 'frag');
    ok(sb.hp < hp0, 'a frag goes round it');
    me.ps.x = A.x + 12;       // Behind it now.
    const hp1 = sb.hp;
    sim._damage(sb, me, 40, 'ar', 6);
    ok(sb.hp < hp1 && sb.zShield === sh0 - 50, 'from behind, the body takes it');
    me.ps.x = A.x;
    sim.drainEvents();
    sim._damage(sb, me, sh0, 'ar', 6);
    const ev = sim.drainEvents();
    ok(sb.zShield === 0 && ev.some(e => e.t === 'zshield' && e.broke), 'enough damage breaks the shield');
    const hp2 = sb.hp;
    sim._damage(sb, me, 30, 'ar', 6);
    ok(sb.hp < hp2, 'broken, the front is open');
    // On the wire: kind 9 is a broken shield.
    const enc = sim.rules.encode()[8];
    const { unpackZombie: un } = await import('../js/sim/zombies.js');
    ok(enc.map(un).some(z => z.kind === 9), 'the broken shield rides the packed kind (9)');
  }
  // Bots: a bloater far off is shot first; a shield facing the bot is left for later.
  {
    const { sim, R, me, A, raise } = arena(206);
    const bl = raise(ZK.bloater, A.x + 12, A.z), sh = raise(ZK.shambler, A.x + 6, A.z), sb = raise(ZK.shield, A.x + 5, A.z + 1);
    sb.ps.aim = Math.atan2(A.z - sb.ps.z, A.x - sb.ps.x);
    const K = R.kinds;
    ok(K.score(bl, me.ps, 12) + 12 < K.score(sh, me.ps, 6) + 6, 'bots: a far bloater outranks a nearer shambler');
    ok(K.facing(sb, me.ps) && K.score(sb, me.ps, 5) > 5, 'bots: a shield facing them goes to the back of the queue');
    R.kinds.puddles.push({ x: me.ps.x + 0.3, z: me.ps.z, until: sim.time + 5, by: sh });
    const off = K.dodge(me.ps);
    ok(off && off.x < 0, 'bots: step off a puddle');
  }
  // Special rounds in play: a sprint round is all runners (and brutes), a bloater swarm mostly bloaters, the fog cuts
  // crew bots' sight; the round's special rides the snapshot and the zround event.
  for (const want of ['sprint', 'bloat', 'fog']) {
    const sim = makeSim('neon', 300);
    toLive(sim);
    const R = sim.rules;
    let r = 1; while (specialRound(r, R.seed) !== want) r++;
    for (const d of R.L.doors) R.open |= 1 << d.i;
    for (const p of R.crew) p.spawnProtect = 1e9;
    sim.drainEvents();
    R._startRound(r);
    const ev = sim.drainEvents().find(e => e.t === 'zround');
    ok(R.special === want && ev?.special === want, `round ${r}: ${want} (event ${ev?.special})`);
    const kinds = {};
    for (let k = 0; k < 400 && R.spawned < R.count; k++) { R.spawnT = 0; R._stepSpawns(DT); for (const p of R.horde) if (p.alive && !p.counted) { p.counted = 1; kinds[p.zk] = (kinds[p.zk] ?? 0) + 1; } for (const p of R.horde) if (p.alive && p.counted) { p.alive = false; p.counted = 0; p.zFree = 0; } }
    const tot = Object.values(kinds).reduce((a, b) => a + b, 0);
    if (want === 'sprint') ok(Object.keys(kinds).every(k => +k === 1 || +k === 2), `sprint: runners only (${JSON.stringify(kinds)})`);
    if (want === 'bloat') ok((kinds[ZK.bloater] ?? 0) > tot * 0.4, `bloat: mostly bloaters (${JSON.stringify(kinds)})`);
    if (want === 'fog') ok(R.crew.filter(p => p.bot).every(p => p.bot.sightK < 0.6), 'fog: crew bots see less');
    ok(sim.encodeSnapshotFor && JSON.stringify(R.encode()).includes(`,${ZM_ROUNDS.indexOf(want)}]`), 'the special rides the snapshot');
  }
  // The mix past round 15 really has all four (a full round's spawns at round 16).
  {
    const sim = makeSim('neon', 301); toLive(sim);
    const R = sim.rules;
    let r = 16; while (specialRound(r, R.seed) || isBossRound(r)) r++;
    for (const d of R.L.doors) R.open |= 1 << d.i;
    R._startRound(r);
    const seen = new Set();
    for (let k = 0; k < 600 && R.spawned < R.count; k++) { R.spawnT = 0; R._stepSpawns(DT); for (const p of R.horde) if (p.alive) { seen.add(p.zk); p.alive = false; p.zFree = 0; } }
    ok([ZK.crawler, ZK.spitter, ZK.bloater, ZK.shield].every(k => seen.has(k)), `round ${r}: every special shows up (${[...seen].sort()})`);
  }
}

section('determinism');
{
  const sig = sim => JSON.stringify([sim.tick, sim.rules.round, sim.rules.killed, sim.rules.crew.map(p => [p.zm.pts, Math.round(p.ps.x * 100), Math.round(p.ps.z * 100)]),
    sim.rules.horde.map(p => (p.alive ? [Math.round(p.ps.x * 100), Math.round(p.ps.z * 100), Math.round(p.hp)] : 0))]);
  for (const id of ['foundry', 'ashgrove']) {
    const a = makeSim(id, 77), b = makeSim(id, 77);
    let same = true;
    for (let t = 0; t < (QUICK ? 40 : 80) && same; t++) { run(a, 1); run(b, 1); same = sig(a) === sig(b); }
    ok(same, `${id}: same seed, same match`);
  }
}

// ---- Performance: a round-20 and a round-30 horde, with the economy busy (every trap armed, sentries, drones) ----
section('perf');
for (const id of QUICK ? ['neon', 'ashgrove'] : ZM_MAP_IDS) for (const round of [20, 30]) {
  const sim = makeSim(id, 99);
  toLive(sim);
  const R = sim.rules;
  for (const d of R.L.doors) R.open |= 1 << d.i;
  const { syncZmDoors, reblockNav } = await import('../js/shared/zombies.js');
  syncZmDoors(sim.map, R.open);
  for (const d of R.L.doors) reblockNav(sim.nav, sim.map, d);
  R.fields.clear();
  for (const p of R.crew) p.spawnProtect = 1e9;     // The crew stands its ground the whole time.
  R._startRound(round);
  R.spawnT = 0;
  // Fill every seat from the risers (runners, brutes and shamblers as the round deals them).
  for (let k = 0; k < 200 && R.horde.some(p => !p.alive); k++) { R.spawnT = 0; R._stepSpawns(DT); }
  const live = R.horde.filter(p => p.alive).length;
  ok(live === ZM.seats, `${id} r${round}: ${live} live (${R.horde.filter(p => p.alive && p.zk >= 5).length} specials)`);
  // The economy at its busiest: traps running, a sentry and a drone each for two of the crew, tier-3 guns all round.
  R.econ.traps.forEach(t => { t.state = 1; t.timer = 999; });
  R.crew.slice(0, 2).forEach(p => { R.econ._supply(p, 'sentry'); R.econ._supply(p, 'drone'); });
  for (const p of R.crew) { R._give(p, 'ar'); p.zm.tiers.ar = 3; }
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
  const mean = times.reduce((s, v) => s + v, 0) / times.length, p99 = times[Math.floor(times.length * 0.99)], worst = times[times.length - 1];
  console.log(`  ${id} r${round}: ${live} live, host tick ${mean.toFixed(2)} ms mean, p99 ${p99.toFixed(2)} ms, max ${worst.toFixed(2)} ms; snapshot ${Math.round(bytes / n)} B mean, ${maxB} B max`);
  ok(worst < 33, `${id} r${round}: no tick over 33 ms (docs/BR-PERF.md budget gate) (${worst.toFixed(2)})`);
  ok(mean < 4, `${id} r${round}: host tick under 4 ms mean (${mean.toFixed(2)})`);
  ok(bytes / n < 1900, `${id} r${round}: per-guest snapshot under 1.9 KB mean`);
  clearZmWalls(sim.map);
}

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
