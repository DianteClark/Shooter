// Node tests for Capture the Flag (js/sim/ctf.js and its hooks in sim.js, bots.js and player.js). Run: node dev/sim-ctf.mjs
// Add `quick` to skip the full bot matches. Exits non-zero on the first failed check, printing what failed.
import assert from 'node:assert/strict';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { stepPlayer } from '../js/sim/player.js';
import { ctfOf, ctfCarrying } from '../js/sim/ctf.js';
import { CTF, MODES, modeFitsMap, mapModes } from '../js/shared/modes.js';
import { MAPS } from '../js/shared/map.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { NavGrid } from '../js/sim/nav.js';

const STEP = 1 / SIM_HZ;
const QUICK = process.argv.includes('quick');
const STANDARD = ['railyard', 'harbor', 'neon', 'dust', 'frost', 'topside', 'sunken'];
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}

const HUMAN = { id: 'h1', name: 'Human', team: 0, primary: 'ar', camo: 'none', loadout: { primary: 'ar', streaks: ['uav', 'turret', 'strike'] } };
const ticks = (sim, seconds) => { for (let i = Math.round(seconds * SIM_HZ); i > 0; i--) sim.step(STEP); };

// A live match whose bots stand still (no brains), so only the test moves anyone, everyone parked out of the way.
function makeSim({ humans = [HUMAN], teamSize = 3, map = 'railyard', seed = 7, timeLimit } = {}) {
  const roster = buildRoster(humans, { botSkill: 'regular', teamSize, mapId: map, mode: 'ctf', seed });
  const sim = new Sim({ roster, map, seed, mode: 'ctf', timeLimit });
  sim.step(0);
  for (const p of sim.players) p.bot = null;
  ticks(sim, 3.2);
  assert.equal(sim.phase, 'live');
  park(sim);
  sim.drainEvents();
  return sim;
}
function put(p, x, z) { p.ps.x = x; p.ps.z = z; p.ps.vx = 0; p.ps.vz = 0; for (let i = 0; i < p.hx.length; i++) { p.hx[i] = x; p.hz[i] = z; } }
// Everyone along the north edge of their own half, well clear of both flags.
function park(sim) {
  sim.players.forEach((p, i) => { put(p, p.team === 0 ? 20 + i : sim.map.width - 20 - i, 1.5); p.spawnProtect = 0; });
}
function kill(sim, p, by = sim.players.find(q => q.team !== p.team)) {
  p.spawnProtect = 0;
  sim._damage(p, by, 999, 'ar', 5);
  assert.equal(p.alive, false);
}
const team = (sim, t) => sim.players.filter(p => p.team === t);
const base = (sim, t) => sim.ctf.bases[t];
const flag = (sim, t) => sim.ctf.flags[t];
const evs = (list, kind) => list.filter(e => e.t === 'ctf' && (!kind || e.kind === kind));
const medals = (list, id, medal) => list.filter(e => e.t === 'medal' && e.id === id && e.medal === medal);
// p walks onto team t's flag (wherever it is) and the rules get a tick.
function touch(sim, p, t) {
  const f = flag(sim, t);
  put(p, f.x + 0.4, f.z);
  ticks(sim, STEP * 2);
  return sim.drainEvents();
}
// Red (team 1) player takes blue's flag (team 0).
function redTakes(sim) {
  const r = team(sim, 1)[0];
  const e = touch(sim, r, 0);
  assert.equal(flag(sim, 0).state, 'carried');
  return { r, e };
}

/* ---------------- Setup ---------------- */

await test('mode: CTF is 6v6 on the seven standard maps, first to 3 in 10 minutes, not on Harvest', () => {
  assert.equal(MODES.ctf.rules, 'ctf');
  assert.equal(MODES.ctf.teamSize, 6);
  assert.equal(MODES.ctf.scoreLimit, 3);
  assert.equal(MODES.ctf.timeLimit, 600);
  for (const id of STANDARD) assert.ok(modeFitsMap(MAPS[id], 'ctf'), id);
  assert.ok(!modeFitsMap(MAPS.harvest, 'ctf') && !mapModes(MAPS.harvest).includes('ctf'));
});

await test('maps: two flag stands, 180-degree images, each on its own half, on open walkable ground', () => {
  for (const id of STANDARD) {
    const m = MAPS[id], [a, b] = m.points.ctf, nav = new NavGrid(m);
    assert.equal(a.team, 0); assert.equal(b.team, 1);
    assert.ok(Math.abs(a.x + b.x - m.width) < 1e-6 && Math.abs(a.z + b.z - m.height) < 1e-6, `${id} symmetric`);
    assert.ok(a.x < m.width / 2 && b.x > m.width / 2, `${id} own halves`);
    for (const f of [a, b]) {
      assert.ok(nav.isWalkable(f.x, f.z), `${id} ${f.id} walkable`);
      // Nothing solid within reach of the stand: it can be touched from every side.
      const tight = m.walls.some(w => w.kind !== 'border' && f.x > w.x - CTF.reach && f.x < w.x + w.w + CTF.reach && f.z > w.z - CTF.reach && f.z < w.z + w.d + CTF.reach);
      assert.ok(!tight, `${id} ${f.id} clear of walls`);
      // Both ends of the map can walk to it.
      assert.ok(nav.findPath(m.spawns[0][0].x, m.spawns[0][0].z, f.x, f.z, new Float32Array(48), 24) > 0, `${id} ${f.id} reachable`);
    }
  }
});

await test('start: both flags home, no carrier, the view and an interpolated view both find them', () => {
  const sim = makeSim();
  const v = sim.getView('h1');
  const c = ctfOf(v);
  assert.equal(c, v.ctf);
  assert.equal(ctfOf({ points: v.points }), c, 'riding on the point list for js/game/interp.js');
  assert.deepEqual(c.flags.map(f => f.state), ['home', 'home']);
  assert.equal(c.toWin, 3);
  assert.equal(c.flags[1].x, base(sim, 1).x);
  assert.deepEqual(v.points.length, 0, 'no zones drawn as points');
});

/* ---------------- Rules ---------------- */

await test('take: an enemy touching the flag at its base takes it; its own team touching it does nothing', () => {
  const sim = makeSim();
  const blue = team(sim, 0)[1];
  touch(sim, blue, 0);
  assert.equal(flag(sim, 0).state, 'home', 'own flag at home is left alone');
  const { r, e } = redTakes(sim);
  assert.equal(flag(sim, 0).carrier, r);
  assert.equal(evs(e, 'take')[0].from, 'base');
  assert.equal(evs(e, 'take')[0].team, 0);
  assert.equal(medals(e, r.id, 'flag_take').length, 1);
  assert.equal(r.ps.noSlide, true);
  assert.ok(ctfCarrying(sim.getView('h1'), r.id));
  // The flag rides with its carrier.
  put(r, 30, 30); ticks(sim, STEP);
  assert.equal(flag(sim, 0).x, 30);
  assert.equal(r.score.score >= CTF.score.take, true);
});

await test('no slide: a carrier\'s slide input does nothing; the same player slides once the flag is gone', () => {
  const sim = makeSim();
  const { r } = redTakes(sim);
  // Sprinting east along the open north edge.
  const input = { mx: 1, mz: 0, aim: 0, aiming: false, fire: false, sprint: true, slide: false, swap: false };
  put(r, 3, 1.5);
  for (let i = 0; i < 40; i++) stepPlayer(r.ps, input, STEP, sim.map, Math.random);
  stepPlayer(r.ps, { ...input, slide: true }, STEP, sim.map, Math.random);
  assert.equal(r.ps.sliding, false, 'carrier cannot slide');
  kill(sim, r);
  assert.equal(r.ps.noSlide, false, 'dropped with the flag');
  put(r, 3, 1.5);
  for (let i = 0; i < 40; i++) stepPlayer(r.ps, input, STEP, sim.map, Math.random);
  stepPlayer(r.ps, { ...input, slide: true }, STEP, sim.map, Math.random);
  assert.equal(r.ps.sliding, true, 'slides again without it');
});

await test('capture: carrying it to your own flag scores, only while your own flag is home', () => {
  const sim = makeSim();
  const { r } = redTakes(sim);                       // Red has blue's flag.
  const blue = team(sim, 0)[0];
  touch(sim, blue, 1);                               // Blue has red's flag too: a standoff.
  assert.equal(flag(sim, 1).carrier, blue);
  put(r, base(sim, 1).x + 0.5, base(sim, 1).z);      // Red's carrier home, red's own flag away.
  ticks(sim, 1);
  assert.equal(flag(sim, 0).state, 'carried', 'no capture with the own flag gone');
  assert.deepEqual(sim.scores, [0, 0]);
  // Red kills blue's carrier, touches the drop: red's flag goes home, and the waiting carrier scores at once.
  const red2 = team(sim, 1)[1];
  kill(sim, blue, red2);
  assert.equal(flag(sim, 1).state, 'dropped');
  const e = touch(sim, red2, 1);
  assert.equal(evs(e, 'return').length, 1);
  const cap = evs(e, 'capture')[0];
  assert.ok(cap, 'captured');
  assert.equal(cap.team, 0, 'the flag captured is blue\'s');
  assert.equal(cap.id, r.id);
  assert.deepEqual(sim.scores, [0, 1]);
  assert.equal(flag(sim, 0).state, 'home', 'the captured flag goes back to its stand');
  assert.equal(flag(sim, 0).x, base(sim, 0).x);
  assert.equal(r.captures, 1);
  assert.equal(r.ps.noSlide, false);
  assert.equal(medals(e, r.id, 'flag_capture').length, 1);
});

await test('drop on death: the flag lands where the carrier fell, the killer gets a carrier kill', () => {
  const sim = makeSim();
  const { r } = redTakes(sim);
  put(r, 33.3, 29.1);
  const blue = team(sim, 0)[2];
  kill(sim, r, blue);
  const e = sim.drainEvents();
  const f = flag(sim, 0);
  assert.equal(f.state, 'dropped');
  assert.ok(Math.abs(f.x - 33.3) < 1.1 && Math.abs(f.z - 29.1) < 1.1, 'at the body (or the nearest open cell)');
  assert.equal(f.returnT, CTF.returnTime);
  assert.equal(evs(e, 'drop')[0].id, r.id);
  assert.equal(medals(e, blue.id, 'carrier_kill').length, 1);
  assert.equal(blue.carrierKills, 1);
  assert.equal(r.ps.noSlide, false);
});

await test('return: touching your own dropped flag sends it home at once; an enemy touching it takes it again', () => {
  const sim = makeSim();
  const { r } = redTakes(sim);
  put(r, 36, 40); kill(sim, r);
  sim.drainEvents();
  const red2 = team(sim, 1)[1];
  let e = touch(sim, red2, 0);
  assert.equal(flag(sim, 0).state, 'carried', 'enemy picks the dropped flag up');
  assert.equal(evs(e, 'take')[0].from, 'field');
  put(red2, 36, 40); kill(sim, red2);
  const blue = team(sim, 0)[1];
  e = touch(sim, blue, 0);
  assert.equal(flag(sim, 0).state, 'home');
  assert.equal(flag(sim, 0).x, base(sim, 0).x);
  const ret = evs(e, 'return')[0];
  assert.equal(ret.id, blue.id);
  assert.ok(!ret.auto);
  assert.equal(blue.returns, 1);
  assert.equal(medals(e, blue.id, 'flag_return').length, 1);
});

await test('auto return: a dropped flag nobody touches goes home after 15 s, not before', () => {
  const sim = makeSim();
  const { r } = redTakes(sim);
  put(r, 36, 40); kill(sim, r);
  sim.drainEvents();
  ticks(sim, CTF.returnTime - 0.3);
  assert.equal(flag(sim, 0).state, 'dropped');
  assert.ok(ctfOf(sim.getView('h1')).flags[0].returnT < 0.5);
  ticks(sim, 0.5);
  assert.equal(flag(sim, 0).state, 'home');
  const ret = evs(sim.drainEvents(), 'return')[0];
  assert.ok(ret.auto && !ret.id);
});

await test('defend: a kill near your own flag is a flag defense; not with the flag gone', () => {
  const sim = makeSim();
  const blue = team(sim, 0)[0], red = team(sim, 1)[0];
  put(blue, base(sim, 0).x + 3, base(sim, 0).z);
  put(red, base(sim, 0).x + 6, base(sim, 0).z);
  kill(sim, red, blue);
  let e = sim.drainEvents();
  assert.equal(medals(e, blue.id, 'flag_defend').length, 1);
  const red2 = team(sim, 1)[1];
  put(blue, 40, 1.5); put(red2, 44, 1.5);
  kill(sim, red2, blue);                             // Both far from the flag: an ordinary kill.
  e = sim.drainEvents();
  assert.equal(medals(e, blue.id, 'flag_defend').length, 0);
  // With blue's flag carried off there is nothing at the stand to defend.
  const red3 = team(sim, 1)[2];
  touch(sim, red3, 0);
  put(red3, 50, 1.5);
  const red4 = team(sim, 1)[0];
  ticks(sim, 3);
  put(blue, base(sim, 0).x + 3, base(sim, 0).z); put(red4, base(sim, 0).x + 6, base(sim, 0).z);
  kill(sim, red4, blue);
  e = sim.drainEvents();
  assert.equal(medals(e, blue.id, 'flag_defend').length, 0);
});

await test('score end: the third capture wins at once', () => {
  const sim = makeSim();
  for (let n = 0; n < 3; n++) {
    const { r } = redTakes(sim);
    put(r, base(sim, 1).x, base(sim, 1).z);
    ticks(sim, STEP * 2);
    park(sim);
    if (n < 2) { assert.equal(sim.phase, 'live'); ticks(sim, STEP); }
  }
  assert.deepEqual(sim.scores, [0, 3]);
  assert.equal(sim.phase, 'ended');
  assert.equal(sim.winner, 1);
  assert.equal(sim.lastKill, null, 'no stale kill for the final replay');
});

await test('time end: most captures wins; level is a draw; kills do not score', () => {
  let sim = makeSim({ timeLimit: 20 });
  kill(sim, team(sim, 1)[2], team(sim, 0)[0]);
  assert.deepEqual(sim.scores, [0, 0], 'a kill is not a point');
  const { r } = redTakes(sim);
  put(r, base(sim, 1).x, base(sim, 1).z);
  ticks(sim, 25);
  assert.equal(sim.phase, 'ended');
  assert.equal(sim.winner, 1);
  sim = makeSim({ timeLimit: 10 });
  ticks(sim, 12);
  assert.equal(sim.phase, 'ended');
  assert.equal(sim.winner, null, 'draw');
});

await test('respawn: never on the enemy half', () => {
  const sim = makeSim();
  // Crowd blue's whole end with red, which would normally push blue's respawns to the far side.
  team(sim, 1).forEach((p, i) => put(p, 6 + i * 2, 24));
  for (let n = 0; n < 12; n++) {
    const b = team(sim, 0).filter(p => p.isBot)[n % 2];
    put(b, 30, 40); kill(sim, b);
    ticks(sim, 3);
    assert.ok(b.alive);
    assert.ok(b.ps.x < sim.map.width / 2, `respawned at ${b.ps.x.toFixed(1)}`);
  }
});

/* ---------------- Wire and host migration ---------------- */

await test('snapshot: flags, carriers, return clocks and per-player tallies survive the codec', () => {
  const sim = makeSim();
  const { r } = redTakes(sim);
  const blue = team(sim, 0)[0];
  touch(sim, blue, 1);
  put(blue, 40, 40); kill(sim, blue, team(sim, 1)[2]);
  ticks(sim, 2);
  r.captures = 2; r.returns = 1; team(sim, 1)[2].carrierKills = 3;
  const guest = makeSim();
  const v = guest.decodeSnapshot(sim.encodeSnapshot(), 'h1');
  const c = ctfOf(v);
  assert.equal(c, v.points.ctf);
  assert.equal(c.flags[0].state, 'carried');
  assert.equal(c.flags[0].carrier, r.id);
  assert.equal(c.flags[1].state, 'dropped');
  assert.ok(Math.abs(c.flags[1].returnT - flag(sim, 1).returnT) < 0.11);
  assert.ok(Math.abs(c.flags[1].x - flag(sim, 1).x) < 0.06);
  assert.equal(c.flags[1].baseX, base(sim, 1).x);
  const vr = v.players.find(p => p.id === r.id);
  assert.equal(vr.captures, 2); assert.equal(vr.returns, 1);
  assert.equal(v.players.find(p => p.id === team(sim, 1)[2].id).carrierKills, 3);
  assert.ok(ctfCarrying(v, r.id));
  assert.ok(!ctfCarrying(v, 'h1'));
});

await test('host migration: carried, dropped (with its clock) and home flags carry over, and play goes on', () => {
  const humans = [HUMAN, { id: 'g1', name: 'Guest', team: 1, primary: 'smg', camo: 'none' }];
  const sim = makeSim({ humans });
  const { r } = redTakes(sim);
  const blue = team(sim, 0)[1];
  touch(sim, blue, 1);
  put(blue, 40, 40); kill(sim, blue);
  ticks(sim, 4);
  sim.scores[1] = 1; r.captures = 1;
  const roster = buildRoster(humans, { botSkill: 'regular', teamSize: 3, mapId: 'railyard', mode: 'ctf', seed: 7 });
  const view = sim.decodeSnapshot(sim.encodeSnapshot(), 'g1');
  const next = Sim.fromSnapshot(view, roster, { map: 'railyard', seed: 7, gone: ['h1'] });
  for (const p of next.players) p.bot = null;
  const nr = next.byId.get(r.id);
  assert.equal(next.ctf.flags[0].state, 'carried');
  assert.equal(next.ctf.flags[0].carrier, nr);
  assert.equal(nr.ps.noSlide, true);
  assert.equal(next.ctf.flags[1].state, 'dropped');
  assert.ok(Math.abs(next.ctf.flags[1].returnT - (CTF.returnTime - 4)) < 0.2);
  assert.deepEqual(next.scores, [0, 1]);
  assert.equal(nr.captures, 1);
  // The dropped flag still returns on time, and the carrier still scores on the new host.
  ticks(next, CTF.returnTime - 4 + 0.2);
  assert.equal(next.ctf.flags[1].state, 'home');
  put(nr, base(next, 1).x, base(next, 1).z);
  ticks(next, STEP * 2);
  assert.deepEqual(next.scores, [0, 2]);
  // A carrier the snapshot shows dead (it lost the race with the drop event) leaves the flag on the ground.
  const s2 = makeSim();
  const { r: r2 } = redTakes(s2);
  const v2 = s2.decodeSnapshot(s2.encodeSnapshot(), 'h1');
  v2.players.find(p => p.id === r2.id).alive = false;
  const n2 = Sim.fromSnapshot(v2, buildRoster([HUMAN], { botSkill: 'regular', teamSize: 3, mapId: 'railyard', mode: 'ctf', seed: 7 }), { map: 'railyard', seed: 7 });
  assert.equal(n2.ctf.flags[0].state, 'dropped');
  assert.equal(n2.ctf.flags[0].returnT, CTF.returnTime);
});

/* ---------------- Bots ---------------- */

function runMatch(mapId, seed, skills = null, limit = 620) {
  const roster = buildRoster([], { botSkill: 'mixed', mapId, mode: 'ctf', seed });
  if (skills) for (const r of roster) r.skill = skills[r.team];
  const sim = new Sim({ roster, map: mapId, seed, mode: 'ctf' });
  const tally = { take: 0, capture: 0, drop: 0, return: 0, auto: 0, slides: 0 };
  let t = 0;
  while (sim.phase !== 'ended' && t < limit) {
    sim.step(STEP); t += STEP;
    for (const e of sim.drainEvents()) {
      if (e.t === 'ctf' && e.kind in tally) { tally[e.kind]++; if (e.auto) tally.auto++; }
      if (e.t === 'slide' && sim.players.some(p => p.id === e.id && sim.ctf.isCarrier(p))) tally.slides++;
    }
  }
  return { sim, t, tally };
}

if (!QUICK) {
  await test('bots: full mixed matches finish on all seven maps, with captures on every map', () => {
    const sum = { take: 0, capture: 0, drop: 0, return: 0, auto: 0, slides: 0 };
    for (const id of STANDARD) {
      let caps = 0;
      for (const seed of [1, 2]) {
        const { sim, t, tally } = runMatch(id, seed);
        assert.equal(sim.phase, 'ended', `${id}/${seed} finished`);
        assert.ok(t <= 604, 'inside the time limit');
        caps += tally.capture;
        for (const k in sum) sum[k] += tally[k];
        console.log(`     ${id.padEnd(8)} seed ${seed}: ${sim.scores.join('-')} in ${Math.round(t)} s  takes ${tally.take} caps ${tally.capture} returns ${tally.return} (${tally.auto} on the clock)`);
      }
      assert.ok(caps >= 1, `${id}: bots capture`);
    }
    console.log(`     ${JSON.stringify(sum)}`);
    assert.equal(sum.slides, 0, 'no carrier ever slides');
    assert.ok(sum.return - sum.auto >= 10, 'bots return their dropped flags');
    assert.ok(sum.capture >= 20, 'captures are a normal part of a match');
  });

  await test('bots: tiers separate; elites beat recruits on every map, from either side', () => {
    let eliteCaps = 0, recruitCaps = 0, eliteWins = 0;
    for (const id of STANDARD) {
      for (const [seed, eliteTeam] of [[3, 0], [4, 1]]) {
        const skills = eliteTeam === 0 ? ['elite', 'recruit'] : ['recruit', 'elite'];
        const { sim } = runMatch(id, seed, skills);
        eliteCaps += sim.scores[eliteTeam]; recruitCaps += sim.scores[1 - eliteTeam];
        if (sim.winner === eliteTeam) eliteWins++;
      }
    }
    console.log(`     elite ${eliteWins}/14 matches, captures ${eliteCaps}-${recruitCaps}`);
    assert.ok(eliteWins >= 12, 'elites win nearly every match');
    assert.ok(eliteCaps >= recruitCaps * 4 + 8);
    let vet = 0, reg = 0, vetWins = 0, regWins = 0;
    for (const id of STANDARD) {
      const a = runMatch(id, 5, ['veteran', 'regular']).sim, b = runMatch(id, 6, ['regular', 'veteran']).sim;
      vet += a.scores[0] + b.scores[1]; reg += a.scores[1] + b.scores[0];
      vetWins += (a.winner === 0) + (b.winner === 1); regWins += (a.winner === 1) + (b.winner === 0);
    }
    console.log(`     veteran v regular captures ${vet}-${reg}, matches ${vetWins}-${regWins}`);
    assert.ok(vet > reg * 1.3 && vetWins > regWins);
  });
}

console.log(`\n${passed} passed`);
