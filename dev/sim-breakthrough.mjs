// Node tests for Breakthrough (ROADMAP 65, docs/MODES.md "Conquest and Breakthrough"): layouts and front lines on every
// map that hosts it, a sector falling (tickets refill, the clock restarts, defenders fall back), out of bounds for both
// sides, attackers out of tickets, overtime, the wire and host migration, and a bot match on every map (finishes, both
// sides win somewhere, no stuck bots, the host's tick within docs/BR-PERF.md's budget).
// Run: node dev/sim-breakthrough.mjs [quick] [--maps=harvest,jadefall] [--seeds=2]
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { objOf } from '../js/sim/rules.js';
import { MODES, modeFitsMap, mapModes } from '../js/shared/modes.js';
import { MAPS, MAP_IDS } from '../js/shared/map.js';
import { BF, along, bfLayout, bfLayouts, btAttackers, lineSegment, sectorBand } from '../js/shared/bf.js';
import { QUICK, botMatch, checkLayout, done, makeSim, run, test } from './sim-bf-kit.mjs';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const HOSTS = Object.keys(MAPS).filter(id => modeFitsMap(MAPS[id], 'bt'));
const MAPS_RUN = arg('maps')?.split(',') ?? (QUICK ? ['harvest', 'coral', 'jadefall'] : HOSTS);
const SEEDS = Array.from({ length: +(arg('seeds') ?? (QUICK ? 1 : 2)) }, (_, i) => 5 + i * 13);
const human = team => [{ id: 'h1', name: 'Host', team, primary: 'ar', camo: 'none' }, { id: 'h2', name: 'Guest', team: 1 - team, primary: 'smg', camo: 'none' }];
const bench = (sim, keep = []) => { for (const p of sim.players) if (!keep.includes(p.id)) { p.alive = false; p.respawnT = 1e6; p.deadT = 0; } };
const liven = sim => run(sim, 4, s => s.phase === 'live');
// A seed whose attackers are team `t`.
const seedFor = t => { let s = 1; while (btAttackers(s) !== t) s++; return s; };

await test('maps: Breakthrough on every Ground War map and on Frontier and Jadefall; 3-4 sectors of 1-2 objectives, lines in order', () => {
  for (const id of ['harvest', 'downtown', 'expedition', 'tidebreak', 'coral', 'frontier', 'jadefall']) {
    assert.ok(HOSTS.includes(id) && mapModes(MAPS[id]).includes('bt'), `${id} hosts Breakthrough`);
  }
  for (const id of MAP_IDS) if (!MAPS[id].large) assert.ok(!modeFitsMap(MAPS[id], 'bt'), `not on ${id}`);
  for (const id of HOSTS) {
    for (const l of bfLayouts(MAPS[id], 'breakthrough')) {
      assert.ok(l.sectors.length >= 3 && l.sectors.length <= 4, `${id}: ${l.sectors.length} sectors`);
      for (const s of l.sectors) assert.ok(s.objs.length >= 1 && s.objs.length <= 2);
      for (let i = 1; i < l.lines.length; i++) assert.ok(l.lines[i] > l.lines[i - 1] + 8, `${id}: lines apart`);
      l.sectors.forEach((s, i) => { const b = sectorBand(l, i); for (const o of s.objs) { const a = along(l, o.x, o.z); assert.ok(a > b.lo && a < b.hi, `${id} ${o.id} inside its sector`); } });
      for (const s of l.lines) assert.ok(lineSegment(l, s), `${id}: the line crosses the area`);
      checkLayout(MAPS[id], l);
    }
  }
  // Both sides attack, by seed.
  assert.notEqual(btAttackers(seedFor(0)), btAttackers(seedFor(1)));
});

await test('sector: all objectives held falls it; tickets refill, the clock restarts, defenders behind the line must fall back', () => {
  const seed = seedFor(1);
  const { sim } = makeSim('bt', 'harvest', { seed, humans: human(0) });
  liven(sim);
  const r = sim.rules, me = sim.byId.get('h1');      // A defender (team 0).
  assert.equal(r.att, 1);
  bench(sim, ['h1']);
  // Stand the defender on sector one's ground, behind where the line will be.
  const o = r.zones[0];
  me.ps.x = o.x; me.ps.z = o.z;
  const t0 = r.tickets, evs = [];
  for (const z of r.zones) { z.owner = 1; z.cap = 1; }
  evs.push(...run(sim, 0.2));
  assert.ok(evs.some(e => e.t === 'bt' && e.kind === 'sector' && e.sector === 1), 'the sector fell');
  assert.equal(r.sector, 1);
  assert.equal(r.tickets, t0 + r.refill, 'refill');
  assert.ok(Math.abs(sim.timeLeft - r.clock) < 1, 'clock restarted');
  assert.deepEqual(sim.points.map(p => p.id), r.layout.sectors[1].objs.map(q => q.id), 'next objectives live');
  assert.deepEqual([sim.scores[1], sim.scores[0]], [1, r.layout.sectors.length - 1]);
  assert.ok(me.oob > BF.oob, `the defender has the longer fall-back clock (${me.oob?.toFixed(1)} s)`);
  run(sim, BF.bt.fallBack + 0.5);
  assert.ok(!me.alive || me.deaths > 0, 'and dies if they stay');
});

await test('bounds: attackers may not run past the next line; defenders inside their band are fine', () => {
  const seed = seedFor(0);
  const { sim } = makeSim('bt', 'expedition', { seed, humans: human(0) });
  liven(sim);
  const r = sim.rules, me = sim.byId.get('h1'), l = r.layout;    // An attacker (team 0).
  assert.equal(r.att, 0);
  bench(sim, ['h1']);
  const ahead = l.lines[0] + BF.bt.margin + 8, { ox, oz, dx, dz } = l.axis;
  me.ps.x = ox + dx * ahead; me.ps.z = oz + dz * ahead;
  run(sim, 1);
  assert.ok(me.oob > 0, 'past the line: out of bounds');
  const back = l.lines[0] - 12;
  me.ps.x = ox + dx * back; me.ps.z = oz + dz * back;
  run(sim, BF.ret + 0.5);
  assert.equal(me.oob, null);
});

await test('tickets: an attacker death costs one, a defender death nothing; at zero attackers stay down and lose', () => {
  const seed = seedFor(0);
  const { sim } = makeSim('bt', 'coral', { seed });
  liven(sim);
  const r = sim.rules;
  const a = sim.players.find(p => p.team === r.att && p.alive), d = sim.players.find(p => p.team === r.def && p.alive);
  const t = r.tickets;
  sim._selfKill(a, 'zone');
  sim._selfKill(d, 'zone');
  assert.equal(r.tickets, t - 1);
  r.tickets = 0;
  assert.ok(r.holdDead(a) && !r.holdDead(d));
  bench(sim);
  run(sim, 1);
  assert.equal(sim.phase, 'ended');
  assert.equal(sim.winner, r.def);
  assert.equal(r.reason, 'tickets');
});

await test('clock: time up with an attacker on a live objective is overtime; off it, the defenders win', () => {
  const { sim } = makeSim('bt', 'tidebreak', { seed: 4 });
  liven(sim);
  const r = sim.rules;
  bench(sim);
  const a = sim.players.find(p => p.team === r.att);
  a.alive = true; a.respawnT = 1e6;
  const z = r.zones[0];
  a.ps.x = z.x; a.ps.z = z.z;
  sim.timeLeft = 0.1;
  const evs = run(sim, 1);
  assert.ok(evs.some(e => e.t === 'bt' && e.kind === 'overtime') && sim.phase === 'live', 'overtime');
  a.ps.x = r.layout.hq[0].x; a.ps.z = r.layout.hq[0].z;
  run(sim, 1);
  assert.equal(sim.phase, 'ended');
  assert.equal(sim.winner, r.def);
  assert.equal(r.reason, 'time');
});

await test('wire: a guest follows sectors, tickets and objectives; a host migration in sector two plays on', () => {
  const map = 'downtown', seed = 21;
  const humans = human(0);
  const { roster, sim } = makeSim('bt', map, { seed, humans });
  const guest = new Sim({ roster, map, seed, mode: 'bt' });
  liven(sim);
  for (const z of sim.rules.zones) { z.owner = sim.rules.att; z.cap = sim.rules.att ? 1 : -1; }
  run(sim, 30);
  if (sim.phase === 'ended') return;
  const hv = sim.getView('h2'), gv = guest.decodeSnapshot(sim.encodeSnapshot(), 'h2');
  const ho = objOf(hv), go = objOf(gv);
  for (const k of ['kind', 'att', 'sector', 'sectors', 'tickets', 'max', 'overtime', 'done']) assert.deepEqual(go[k], ho[k], k);
  assert.deepEqual(gv.points.map(p => [p.id, p.owner]), hv.points.map(p => [p.id, p.owner]));
  assert.deepEqual(gv.scores.slice(0, 2), hv.scores.slice(0, 2));
  const next = Sim.fromSnapshot(gv, roster, { map, seed, gone: ['h1'] });
  const no = objOf(next.getView('h2'));
  for (const k of ['att', 'sector', 'tickets']) assert.deepEqual(no[k], go[k], `${k} after migration`);
  assert.deepEqual(next.points.map(p => p.id), gv.points.map(p => p.id));
  const evs = run(next, 120);
  assert.ok(evs.some(e => e.t === 'kill'), 'play goes on');
});

const rows = [];
for (const map of MAPS_RUN) {
  for (const seed of SEEDS) {
    await test(`bots: ${map} seed ${seed} plays to an end`, () => {
      const r = botMatch('bt', map, seed, { maxSeconds: 4 * 450 + 60 });
      const o = r.sim.rules;
      rows.push({ map, seed, att: o.att, winner: r.winner, attWon: r.winner === o.att, reason: o.reason, sector: `${o.sector}/${o.sectors.length}`, min: (r.seconds / 60).toFixed(1), tickets: o.tickets, caps: r.ev['bt:capture'] ?? 0, retakes: r.ev['bt:retake'] ?? 0, kills: r.ev.kill ?? 0, spread: r.spread.toFixed(1), stuck: r.stuckPerBotMin.toFixed(2), mean: r.mean.toFixed(2), worst: r.worst.toFixed(1) });
      console.log('     ', JSON.stringify(rows.at(-1)));
      assert.equal(r.sim.phase, 'ended', 'the match ends');
      assert.ok((r.ev['bt:capture'] ?? 0) + (r.ev['bt:neutral'] ?? 0) >= 1, 'the attackers get onto an objective');
      assert.ok(r.stuckPerBotMin < 4, `stuck ${r.stuckPerBotMin.toFixed(2)} s per bot per minute`);
      assert.ok(r.mean < 3, `tick ${r.mean.toFixed(2)} ms mean`);
    });
  }
}
if (rows.length > 1) {
  await test('bots: attackers and defenders both win somewhere', () => {
    console.table(rows);
    const att = rows.filter(r => r.attWon).length;
    assert.ok(att > 0 && att < rows.length, `attackers won ${att} of ${rows.length}`);
  });
}
done();
