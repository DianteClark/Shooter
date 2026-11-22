// Node tests for Conquest (ROADMAP 65, docs/MODES.md "Conquest and Breakthrough"): layouts on every map that hosts it,
// flag capture, ticket bleed, deploying on a flag, out of bounds on an island part, the wire and host migration, and a
// bot match on every map (finishes, both sides win somewhere, bots spread over the flags and do not get stuck, the
// host's tick within docs/BR-PERF.md's budget).
// Run: node dev/sim-conquest.mjs [quick] [--maps=harvest,frontier] [--seeds=2]
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { objOf } from '../js/sim/rules.js';
import { MODES, modeFitsMap, mapModes } from '../js/shared/modes.js';
import { MAPS, MAP_IDS } from '../js/shared/map.js';
import { BF, bfLayout, bfLayouts } from '../js/shared/bf.js';
import { stepFlag } from '../js/sim/bf-kit.js';
import { QUICK, STEP, botMatch, checkLayout, done, makeSim, run, test } from './sim-bf-kit.mjs';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const HOSTS = Object.keys(MAPS).filter(id => modeFitsMap(MAPS[id], 'cq'));
const MAPS_RUN = arg('maps')?.split(',') ?? (QUICK ? ['harvest', 'tidebreak', 'frontier'] : HOSTS);
const SEEDS = Array.from({ length: +(arg('seeds') ?? (QUICK ? 1 : 2)) }, (_, i) => 11 + i * 17);
const H = [{ id: 'h1', name: 'Host', team: 0, primary: 'ar', camo: 'none' }, { id: 'h2', name: 'Guest', team: 1, primary: 'smg', camo: 'none' }];
// Holds everyone but `keep` off the field (dead, no respawn) so a test sees the rules alone.
const bench = (sim, keep = []) => { for (const p of sim.players) if (!keep.includes(p.id)) { p.alive = false; p.respawnT = 1e6; p.deadT = 0; } };
const liven = sim => run(sim, 4, s => s.phase === 'live');

await test('maps: Conquest on every Ground War map and on Frontier and Jadefall, never a 6v6 map; 5-7 flags reachable', () => {
  for (const id of ['harvest', 'downtown', 'expedition', 'tidebreak', 'coral', 'frontier', 'jadefall']) {
    assert.ok(HOSTS.includes(id), `${id} hosts Conquest`);
    assert.ok(mapModes(MAPS[id]).includes('cq'), `${id} lists it`);
  }
  for (const id of MAP_IDS) if (!MAPS[id].large) assert.ok(!modeFitsMap(MAPS[id], 'cq'), `not on ${id}`);
  for (const id of HOSTS) {
    for (const l of bfLayouts(MAPS[id], 'conquest')) {
      assert.ok(l.flags.length >= 5 && l.flags.length <= 7, `${id}: ${l.flags.length} flags`);
      assert.equal(new Set(l.flags.map(f => f.id)).size, l.flags.length, 'flag ids unique');
      assert.ok(l.tickets >= 300, 'a real pool');
      checkLayout(MAPS[id], l);
    }
  }
  // The islands play a part of the map, so they have out of bounds; Ground War maps are whole.
  assert.ok(bfLayout(MAPS.frontier, 'conquest', 1).sub && !bfLayout(MAPS.harvest, 'conquest', 1).sub);
});

await test('flags: neutral to held in BF.capture s alone, faster with company, contested stalls, held flags go neutral first', () => {
  const z = { owner: -1, cap: 0, contested: false, by: -1 };
  let t = 0, what = null;
  while (z.owner !== 0 && t < 30) { what = stepFlag(z, [1, 0], STEP) ?? what; t += STEP; }
  assert.ok(Math.abs(t - BF.capture) < 0.1, `one player takes it in ${t.toFixed(2)} s`);
  assert.equal(what, 'capture');
  // Three of team 1 take it back: neutral first, then theirs, faster than one would.
  const evs = [];
  t = 0;
  while (z.owner !== 1 && t < 60) { const e = stepFlag(z, [0, 3], STEP); if (e) evs.push(e); t += STEP; }
  assert.deepEqual(evs, ['neutral', 'capture']);
  assert.ok(t < BF.capture * 2 / BF.crowd[3] + 0.2, `three take a held flag in ${t.toFixed(1)} s`);
  // Two against two: contested, nothing moves. Two against one: the two move it.
  const cap = z.cap;
  stepFlag(z, [2, 2], 1);
  assert.ok(z.contested && z.cap === cap);
  stepFlag(z, [2, 1], 1);
  assert.ok(z.contested && z.cap < cap, 'a majority still moves a contested flag');
  // Left alone part taken, it drifts back to its owner.
  stepFlag(z, [0, 0], 1);
  assert.ok(z.cap > cap - 0.1 && !z.contested);
});

await test('tickets: a death costs one; holding every flag bleeds the other side; empty pool loses', () => {
  const { sim } = makeSim('cq', 'harvest', { seed: 3 });
  liven(sim);
  const r = sim.rules;
  bench(sim);
  for (const z of r.zones) { z.owner = 0; z.cap = -1; }
  const before = r.tickets.slice();
  run(sim, 10);
  const rate = BF.cq.bleed[Math.min(r.zones.length, BF.cq.bleed.length - 1)] + BF.cq.allBleed;
  assert.ok(Math.abs((before[1] - r.tickets[1]) - rate * 10) < 1, `bled ${(before[1] - r.tickets[1]).toFixed(1)} in 10 s at ${rate}/s`);
  assert.equal(r.tickets[0], before[0], 'the holder does not bleed');
  assert.equal(sim.scores[1], Math.ceil(r.tickets[1] - 1e-6), 'scores are tickets');
  const p = sim.players.find(q => q.team === 0);
  p.alive = true; sim._selfKill(p, 'zone');
  assert.equal(r.tickets[0], before[0] - BF.cq.death, 'a death costs a ticket');
  r.tickets[1] = 3;
  run(sim, 5);
  assert.equal(sim.phase, 'ended');
  assert.equal(sim.winner, 0);
  // At the clock, more tickets wins.
  r.tickets = [100, 120];
  assert.equal(r.timeUp(), 1);
});

await test('deploy: a phone picks a held flag, the HQ, or the front; a flag with an enemy near is refused', () => {
  const { sim } = makeSim('cq', 'harvest', { seed: 5, humans: H });
  liven(sim);
  const r = sim.rules, me = sim.byId.get('h1');
  bench(sim, ['h1']);
  r.zones.forEach((z, i) => { z.owner = i < 3 ? 0 : 1; z.cap = i < 3 ? -1 : 1; });
  const respawnAt = at => {
    assert.ok(sim.applyCommand('h1', { cmd: 'bf', act: 'deploy', at }));
    me.alive = true; sim._selfKill(me, 'zone');
    sim.requestRespawn('h1');
    run(sim, 4, s => s.byId.get('h1').alive);
    assert.ok(me.alive, `respawned (${at})`);
    return { x: me.ps.x, z: me.ps.z };
  };
  const b = r.zones[1], s = respawnAt(b.id), d = Math.hypot(s.x - b.x, s.z - b.z);
  assert.ok(d >= BF.cq.flagSpawn[0] - 0.5 && d <= BF.cq.flagSpawn[1] + 0.5, `on flag ${b.id}'s ring (${d.toFixed(1)} m)`);
  const hq = r.layout.hq[0], s2 = respawnAt('hq');
  assert.ok(Math.hypot(s2.x - hq.x, s2.z - hq.z) <= hq.r + 1, 'at the HQ');
  // An enemy flag is not offered: the front (the held flag nearest one they do not hold) instead.
  const s3 = respawnAt(r.zones[4].id);
  const front = r.zones.slice(0, 3).reduce((a, z) => (Math.hypot(z.x - s3.x, z.z - s3.z) < Math.hypot(a.x - s3.x, a.z - s3.z) ? z : a));
  assert.ok(Math.hypot(front.x - s3.x, front.z - s3.z) < BF.cq.flagSpawn[1] + 1, 'the front instead of an enemy flag');
  // An enemy near the flag blocks it.
  const foe = sim.players.find(q => q.team === 1);
  foe.alive = true; foe.respawnT = 1e6; foe.ps.x = b.x + 3; foe.ps.z = b.z;
  assert.ok(!r.canDeploy(b, 0), 'enemy near: no spawning there');
  assert.ok(!sim.applyCommand('h1', { cmd: 'bf', act: 'nonsense' }));
});

await test('out of bounds on an island part: out for BF.oob s kills, coming back in clears the clock', () => {
  const { sim } = makeSim('cq', 'frontier', { seed: 2, humans: H });
  liven(sim);
  const r = sim.rules, me = sim.byId.get('h1'), a = r.layout.area;
  bench(sim, ['h1']);
  const inside = { x: r.layout.hq[0].x, z: r.layout.hq[0].z };
  me.ps.x = a.x - 6; me.ps.z = a.z + a.h / 2;
  run(sim, 3);
  assert.ok(me.alive && me.oob > 0 && me.oob < BF.oob, 'clock running');
  assert.ok(sim.getView('h1').players.find(p => p.id === 'h1').oob > 0, 'and on the view');
  me.ps.x = inside.x; me.ps.z = inside.z;
  run(sim, BF.ret + 0.3);
  assert.equal(me.oob, null, 'cleared once back in');
  me.ps.x = a.x - 6;
  const deaths = me.deaths;
  run(sim, BF.oob + 0.5);
  assert.equal(me.deaths, deaths + 1, 'killed by the boundary');
  // Ground War maps have no out of bounds: the whole map is the field.
  const gw = makeSim('cq', 'harvest', { seed: 2, humans: H }).sim;
  liven(gw);
  assert.ok(!gw.rules.layout.sub);
});

await test('wire: a guest reads tickets, flags and captures; the host keeps its own state; a host migration plays on', () => {
  const map = 'tidebreak';
  const { roster, sim } = makeSim('cq', map, { seed: 9, humans: H });
  const guest = new Sim({ roster, map, seed: 9, mode: 'cq' });
  run(sim, 150);
  assert.equal(sim.phase, 'live');
  const hv = sim.getView('h2'), gv = guest.decodeSnapshot(sim.encodeSnapshot(), 'h2');
  const ho = objOf(hv), go = objOf(gv);
  assert.equal(go.kind, 'cq');
  assert.deepEqual(go.tickets, ho.tickets);
  assert.equal(go.layout.id, ho.layout.id, 'same layout from the seed');
  assert.deepEqual(gv.points.map(p => [p.id, p.owner]), hv.points.map(p => [p.id, p.owner]));
  for (let i = 0; i < hv.points.length; i++) assert.ok(Math.abs(gv.points[i].capture - hv.points[i].capture) <= 0.011);
  assert.deepEqual(gv.players.map(p => p.cqCaps), hv.players.map(p => p.cqCaps));
  // The host decoding its own snapshot leaves the exact numbers alone.
  const t = sim.rules.tickets.slice(), caps = sim.rules.zones.map(z => z.cap);
  sim.decodeSnapshot(sim.encodeSnapshot(), 'h1');
  assert.deepEqual(sim.rules.tickets, t);
  assert.deepEqual(sim.rules.zones.map(z => z.cap), caps);
  const next = Sim.fromSnapshot(gv, roster, { map, seed: 9, gone: ['h1'] });
  const no = objOf(next.getView('h2'));
  assert.deepEqual(no.tickets, go.tickets);
  assert.equal(no.max, go.max, 'the pool size survives (the score limit is not scaled twice)');
  assert.deepEqual(next.points.map(p => p.owner), gv.points.map(p => p.owner));
  const evs = run(next, 200);
  assert.ok(evs.some(e => e.t === 'kill'), 'play goes on');
  assert.ok(evs.some(e => e.t === 'cq') || next.phase === 'ended', 'and the flags move');
});

const rows = [];
for (const map of MAPS_RUN) {
  for (const seed of SEEDS) {
    await test(`bots: ${map} seed ${seed} plays to an end`, () => {
      const r = botMatch('cq', map, seed, { maxSeconds: MODES.cq.timeLimit + 30 });
      const o = r.sim.rules;
      rows.push({ map, seed, winner: r.winner, min: (r.seconds / 60).toFixed(1), tickets: o.tickets.map(Math.ceil).join('/'), caps: r.ev['cq:capture'] ?? 0, kills: r.ev.kill ?? 0, spread: r.spread.toFixed(1), stuck: r.stuckPerBotMin.toFixed(2), mean: r.mean.toFixed(2), worst: r.worst.toFixed(1) });
      console.log('     ', JSON.stringify(rows.at(-1)));
      assert.equal(r.sim.phase, 'ended', 'the match ends');
      assert.ok((r.ev['cq:capture'] ?? 0) >= 4, 'flags change hands');
      assert.ok(r.spread >= 1.8, `bots spread over the flags (${r.spread.toFixed(1)} flags per side)`);
      assert.ok(r.stuckPerBotMin < 4, `stuck ${r.stuckPerBotMin.toFixed(2)} s per bot per minute`);
      // docs/BR-PERF.md: the host's mean tick under 3 ms on this machine (worst ticks are GC and JIT; reported).
      assert.ok(r.mean < 3, `tick ${r.mean.toFixed(2)} ms mean`);
    });
  }
}
// A balance check needs enough matches to mean anything: the full run (every map, two seeds), not quick.
if (rows.length) console.table(rows);
if (rows.length >= 6) {
  await test('bots: both sides win somewhere', () => {
    const wins = [0, 1].map(t => rows.filter(r => r.winner === t).length);
    assert.ok(wins[0] > 0 && wins[1] > 0, `wins ${wins.join(' / ')}`);
  });
}
done();
