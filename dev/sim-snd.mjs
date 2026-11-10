// Node tests for Search and Destroy (js/sim/snd.js and its hooks in sim.js and bots.js). Run: node dev/sim-snd.mjs
// Add `quick` to skip the full bot matches. Exits non-zero on the first failed check, printing what failed.
import assert from 'node:assert/strict';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { RESPAWN_IDLE } from '../js/sim/player.js';
import { sndOf, spectate } from '../js/sim/snd.js';
import { SND, MODES, modeFitsMap, mapModes } from '../js/shared/modes.js';
import { MAPS, MAP_IDS } from '../js/shared/map.js';
import { SIM_HZ, MAX_HP } from '../js/shared/constants.js';

const STEP = 1 / SIM_HZ;
const QUICK = process.argv.includes('quick');
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}

const HUMAN = { id: 'h1', name: 'Human', team: 0, primary: 'ar', camo: 'none', loadout: { primary: 'ar', streaks: ['uav', 'turret', 'strike'] } };
const ticks = (sim, seconds) => { for (let i = Math.round(seconds * SIM_HZ); i > 0; i--) sim.step(STEP); };

// A match whose bots stand still (no brains), so only the test moves anyone. Starts in the first round's freeze.
function makeSim({ humans = [HUMAN], teamSize = 3, map = 'railyard', seed = 7 } = {}) {
  const roster = buildRoster(humans, { botSkill: 'regular', teamSize, mapId: map, mode: 'snd', seed });
  const sim = new Sim({ roster, map, seed, mode: 'snd' });
  sim.step(0);
  for (const p of sim.players) p.bot = null;
  return sim;
}
// Freeze over: the round is live.
function goLive(sim) {
  ticks(sim, SND.freeze + STEP * 2);
  assert.equal(sim.phase, 'live');
  assert.equal(sim.snd.state, 'live');
}
const att = sim => sim.players.filter(p => p.team === sim.snd.attackers);
const def = sim => sim.players.filter(p => p.team === sim.snd.defenders);
const carrier = sim => sim.snd.bomb.carrier;
function put(p, x, z) { p.ps.x = x; p.ps.z = z; p.ps.vx = 0; p.ps.vz = 0; for (let i = 0; i < p.hx.length; i++) { p.hx[i] = x; p.hz[i] = z; } }
function kill(sim, p) {
  p.spawnProtect = 0;
  sim._damage(p, sim.players.find(q => q.team !== p.team), 999, 'ar', 5);
  assert.equal(p.alive, false);
}
// Everyone not under test out of the way: far corners of their own side, so nothing ends the round by accident.
function park(sim) {
  sim.players.forEach((p, i) => put(p, sim.snd.sideOf(p.team) === 0 ? 3 : sim.map.width - 3, 2 + i * 1.5));
}
function plantAt(sim, siteIdx = 0) {
  const c = carrier(sim), s = sim.snd.sites[siteIdx];
  put(c, s.x, s.z);
  ticks(sim, SND.plant + 0.1);
  assert.equal(sim.snd.bomb.state, 'planted');
  return c;
}
const events = (sim, kind) => sim.drainEvents().filter(e => e.t === 'snd' && (!kind || e.kind === kind));

/* ---------------- Setup ---------------- */

await test('mode: S&D is offered on the seven standard maps, not on Harvest or the range', () => {
  assert.equal(MODES.snd.rules, 'snd');
  assert.equal(MODES.snd.teamSize, 6);
  assert.equal(MODES.snd.scoreLimit, 4);
  const standard = ['railyard', 'harbor', 'neon', 'dust', 'frost', 'topside', 'sunken'];
  for (const id of standard) assert.ok(modeFitsMap(MAPS[id], 'snd'), id);
  assert.ok(!modeFitsMap(MAPS.harvest, 'snd') && !mapModes(MAPS.harvest).includes('snd'));
  assert.ok(!MAP_IDS.includes('range'));
  for (const id of standard) {
    const [a, b] = MAPS[id].points.snd;
    assert.equal(a.id, 'A'); assert.equal(b.id, 'B');
    for (const s of [a, b]) assert.ok(s.x > MAPS[id].width / 2, `${id} ${s.id} on the defenders' half`);
  }
});

await test('round 1: freeze at the spawns, one attacker carries the bomb, no streaks', () => {
  const sim = makeSim();
  const snd = sim.snd;
  assert.equal(sim.phase, 'warmup');
  assert.equal(snd.round, 1);
  assert.equal(snd.attackers, 0);
  assert.equal(snd.bomb.state, 'carried');
  assert.equal(carrier(sim).team, 0);
  for (const p of sim.players) {
    const west = p.ps.x < sim.map.width / 2;
    assert.equal(west, p.team === snd.attackers, `${p.id} spawned at its end`);
    assert.equal(p.score.slots.length, 0, 'no scorestreaks');
  }
  assert.equal(sim.useStreak('h1', 0), null);
  goLive(sim);
  assert.ok(Math.abs(sim.timeLeft - sim.timeLimit) < 0.2);
  assert.equal(sim.timeLimit, MODES.snd.timeLimit);
});

/* ---------------- Planting ---------------- */

await test('plant: 4 s standing still on a site plants it; one tick short does not', () => {
  const sim = makeSim(); goLive(sim); park(sim);
  const c = carrier(sim), s = sim.snd.sites[1];
  put(c, s.x, s.z);
  ticks(sim, SND.plant - 0.15);
  assert.equal(sim.snd.bomb.state, 'carried');
  assert.ok(sim.snd.plant.p === c);
  ticks(sim, 0.3);
  assert.equal(sim.snd.bomb.state, 'planted');
  assert.equal(sim.snd.bomb.site, 1);
  assert.equal(c.plants, 1);
  assert.ok(Math.abs(sim.snd.bomb.fuse - SND.fuse) < 0.3);
  const evs = sim.drainEvents();
  assert.ok(evs.some(e => e.t === 'snd' && e.kind === 'planted' && e.site === 'B'));
  assert.ok(evs.some(e => e.t === 'medal' && e.medal === 'plant' && e.id === c.id));
});

await test('plant: moving starts it over from nothing; off the site it never starts', () => {
  const sim = makeSim(); goLive(sim); park(sim);
  const c = carrier(sim), s = sim.snd.sites[0];
  put(c, s.x - s.r - 1, s.z);
  ticks(sim, SND.plant + 1);
  assert.equal(sim.snd.plant.p, null, 'not on the site');
  put(c, s.x, s.z);
  ticks(sim, SND.plant * 0.75);
  c.ps.vx = 3;                                  // A step.
  ticks(sim, STEP);
  assert.equal(sim.snd.plant.p, null);
  assert.ok(events(sim, 'stop').length >= 1);
  c.ps.vx = 0;
  ticks(sim, SND.plant * 0.75);
  assert.equal(sim.snd.bomb.state, 'carried', 'progress did not resume');
  ticks(sim, SND.plant * 0.3);
  assert.equal(sim.snd.bomb.state, 'planted');
});

await test('plant: taking damage starts it over', () => {
  const sim = makeSim(); goLive(sim); park(sim);
  const c = carrier(sim), s = sim.snd.sites[0];
  put(c, s.x, s.z);
  ticks(sim, SND.plant * 0.8);
  const foe = def(sim)[0];
  c.spawnProtect = 0;
  sim._damage(c, foe, 10, 'ar', 10);
  assert.equal(sim.snd.plant.p, null);
  ticks(sim, SND.plant * 0.8);
  assert.equal(sim.snd.bomb.state, 'carried');
  ticks(sim, SND.plant * 0.3);
  assert.equal(sim.snd.bomb.state, 'planted');
});

/* ---------------- The bomb ---------------- */

await test('bomb: the carrier\'s death drops it; defenders walk over it, an attacker picks it up', () => {
  const sim = makeSim(); goLive(sim); park(sim);
  const c = carrier(sim);
  put(c, 30, 24);
  kill(sim, c);
  assert.equal(sim.snd.bomb.state, 'dropped');
  assert.ok(Math.hypot(sim.snd.bomb.x - 30, sim.snd.bomb.z - 24) < 1.5);
  assert.equal(events(sim, 'drop').length, 1);
  const d = def(sim)[0];
  put(d, sim.snd.bomb.x, sim.snd.bomb.z);
  ticks(sim, 0.5);
  assert.equal(sim.snd.bomb.state, 'dropped', 'defenders cannot take it');
  put(d, sim.map.width - 3, 40);
  const a = att(sim).find(p => p.alive);
  put(a, sim.snd.bomb.x + 0.8, sim.snd.bomb.z);
  ticks(sim, STEP * 2);
  assert.equal(sim.snd.bomb.state, 'carried');
  assert.equal(carrier(sim), a);
  assert.ok(events(sim, 'pickup').some(e => e.id === a.id));
});

await test('defuse: 6 s still at the bomb wins the round for the defenders; interrupted means from nothing', () => {
  const sim = makeSim(); goLive(sim); park(sim);
  plantAt(sim, 0);
  const b = sim.snd.bomb, d = def(sim)[0];
  put(d, b.x + 1, b.z);
  ticks(sim, SND.defuse * 0.7);
  assert.equal(sim.snd.defuse.p, d);
  d.ps.vz = 2;
  ticks(sim, STEP);
  assert.equal(sim.snd.defuse.p, null, 'moving stops it');
  d.ps.vz = 0;
  ticks(sim, SND.defuse * 0.7);
  assert.equal(b.state, 'planted', 'no resume');
  d.spawnProtect = 0;
  sim._damage(d, att(sim)[0], 5, 'ar', 10);
  assert.equal(sim.snd.defuse.t, 0, 'a hit starts it over');
  ticks(sim, SND.defuse + 0.1);
  assert.equal(b.state, 'defused');
  assert.equal(d.defuses, 1);
  assert.equal(sim.scores[sim.snd.defenders], 1);
  assert.deepEqual(sim.snd.history.at(-1), { winner: sim.snd.defenders, reason: 'defuse' });
  assert.equal(sim.snd.state, 'post');
});

await test('detonation: at 40 s the bomb kills everyone close, either side, and the attackers take the round', () => {
  const sim = makeSim(); goLive(sim); park(sim);
  const planter = plantAt(sim, 0);
  const b = sim.snd.bomb;
  const d = def(sim)[0], d2 = def(sim)[1], a2 = att(sim).find(p => p !== planter);
  put(d, b.x + 3, b.z); put(a2, b.x - 3, b.z);
  d.ps.vx = 2;                                   // Near, but not defusing.
  put(d2, sim.map.width - 3, 46);
  sim.drainEvents();
  ticks(sim, SND.fuse - 1);
  assert.equal(b.state, 'planted');
  assert.ok(sim.timeLeft > 0, 'the round clock stops at the plant');
  ticks(sim, 1.2);
  assert.equal(b.state, 'exploded');
  assert.equal(d.alive, false); assert.equal(a2.alive, false); assert.equal(d2.alive, true);
  const evs = sim.drainEvents();
  assert.ok(evs.some(e => e.t === 'explosion' && e.radius === SND.blast));
  assert.ok(evs.some(e => e.t === 'kill' && e.target === d.id && e.by === planter.id && e.equip === 'bomb'));
  assert.ok(evs.some(e => e.t === 'kill' && e.target === a2.id && e.by === a2.id), 'own side: no kill credit');
  assert.equal(sim.snd.history.at(-1).reason, 'bomb');
  assert.equal(sim.scores[sim.snd.attackers], 1);
});

/* ---------------- Round ends ---------------- */

await test('elimination: a side wiped out loses; a planted bomb outlives its attackers', () => {
  let sim = makeSim(); goLive(sim); park(sim);
  for (const p of def(sim)) kill(sim, p);
  ticks(sim, STEP);
  assert.deepEqual(sim.snd.history.at(-1), { winner: sim.snd.attackers, reason: 'elim' });

  sim = makeSim(); goLive(sim); park(sim);
  for (const p of att(sim)) kill(sim, p);
  ticks(sim, STEP);
  assert.deepEqual(sim.snd.history.at(-1), { winner: sim.snd.defenders, reason: 'elim' });

  sim = makeSim(); goLive(sim); park(sim);
  plantAt(sim, 1);
  for (const p of att(sim)) kill(sim, p);
  ticks(sim, 1);
  assert.equal(sim.snd.state, 'live', 'still has to be defused');
  ticks(sim, SND.fuse);
  assert.deepEqual(sim.snd.history.at(-1), { winner: sim.snd.attackers, reason: 'bomb' });
});

await test('timer: the round clock running out with no plant is the defenders\' round', () => {
  const sim = makeSim(); goLive(sim); park(sim);
  ticks(sim, sim.timeLimit - 1);
  assert.equal(sim.snd.state, 'live');
  ticks(sim, 1.2);
  assert.deepEqual(sim.snd.history.at(-1), { winner: sim.snd.defenders, reason: 'time' });
});

await test('no respawn: out until the next round, whatever is tapped; then everyone is back, refilled', () => {
  const sim = makeSim(); goLive(sim); park(sim);
  const h = sim.byId.get('h1');
  h.ps.tacticalLeft = 0; h.ps.lethalLeft = 0;
  kill(sim, h);
  assert.equal(sim.applyCommand('h1', { cmd: 'respawn' }), false);
  ticks(sim, RESPAWN_IDLE + 2);
  assert.equal(h.alive, false, 'no idle respawn either');
  for (const p of def(sim)) kill(sim, p);
  ticks(sim, STEP);
  assert.equal(sim.snd.state, 'post');
  // Between rounds nothing hurts.
  const a = att(sim).find(p => p.alive);
  sim._damage(a, def(sim)[0], 50, 'ar', 5);
  assert.equal(a.hp, MAX_HP);
  sim.drainEvents();
  ticks(sim, SND.post + STEP * 2);
  assert.equal(sim.snd.round, 2);
  assert.equal(sim.phase, 'warmup');
  for (const p of sim.players) { assert.ok(p.alive, `${p.id} back`); assert.equal(p.hp, MAX_HP); }
  assert.ok(h.ps.tacticalLeft > 0 && h.ps.lethalLeft > 0, 'equipment refilled');
  const evs = sim.drainEvents();
  assert.ok(evs.some(e => e.t === 'spawn' && e.id === 'h1'), 'the phone is told to respawn');
  assert.equal(sim.snd.bomb.state, 'carried');
});

await test('buy-in: a loadout picked in the freeze is put on at once; picked mid-round it waits', () => {
  const sim = makeSim();
  sim.drainEvents();
  assert.ok(sim.setLoadout('h1', { primary: 'smg', secondary: 'pistol' }));
  const h = sim.byId.get('h1');
  assert.equal(h.ps.primary, 'smg');
  assert.ok(sim.drainEvents().some(e => e.t === 'spawn' && e.id === 'h1'));
  assert.deepEqual(h.loadout.streaks, [], 'still no streaks');
  goLive(sim);
  sim.setLoadout('h1', { primary: 'sniper', secondary: 'pistol' });
  assert.equal(h.ps.primary, 'smg');
  assert.ok(h.pendingLoadout);
});

/* ---------------- Match flow ---------------- */

// Plays one round to a quick finish: the given team wins by wiping the other out.
function winRound(sim, winner) {
  if (sim.phase === 'warmup') goLive(sim);
  for (const p of sim.players) if (p.team !== winner && p.alive) kill(sim, p);
  ticks(sim, STEP);
  if (sim.phase !== 'ended') ticks(sim, SND.post + STEP * 2);
}

await test('halftime: after round 3 the teams swap roles and ends of the map', () => {
  const sim = makeSim();
  winRound(sim, 0); winRound(sim, 1); winRound(sim, 0);
  sim.drainEvents();
  assert.equal(sim.snd.round, 4);
  assert.equal(sim.snd.attackers, 1);
  for (const p of sim.players) assert.equal(p.ps.x < sim.map.width / 2, p.team === 1, `${p.id} at its new end`);
  assert.equal(carrier(sim).team, 1);
  assert.deepEqual(sim.scores, [2, 1]);
});

await test('match end: first to 4 rounds wins at once; match point and halftime are announced', () => {
  const sim = makeSim();
  const all = [];
  for (const w of [0, 0, 1, 0, 1, 1]) { winRound(sim, w); all.push(...sim.drainEvents()); }
  assert.deepEqual(sim.scores, [3, 3]);
  assert.ok(all.some(e => e.t === 'snd' && e.kind === 'round' && e.halftime && e.round === 4));
  assert.ok(all.some(e => e.t === 'snd' && e.kind === 'round' && e.matchPoint === 0), 'match point for team 0');
  assert.ok(all.some(e => e.t === 'snd' && e.kind === 'round' && e.matchPoint === 2), 'both at match point');
  winRound(sim, 1);
  assert.equal(sim.phase, 'ended');
  assert.equal(sim.winner, 1);
  assert.equal(sim.snd.history.length, 7);
});

await test('clutch: the last one standing, outnumbered, who wins the round gets the medal', () => {
  const sim = makeSim(); goLive(sim); park(sim);
  const mates = def(sim);
  for (const p of mates.slice(1)) kill(sim, p);
  sim.drainEvents();
  for (const p of att(sim)) kill(sim, p);
  ticks(sim, STEP);
  const evs = sim.drainEvents();
  assert.ok(evs.some(e => e.t === 'medal' && e.medal === 'clutch' && e.id === mates[0].id));
});

/* ---------------- Wire and host migration ---------------- */

await test('snapshot: round, bomb, progress, history and plants/defuses survive the codec', () => {
  const sim = makeSim(); goLive(sim); park(sim);
  const planter = plantAt(sim, 1);
  const d = def(sim)[0];
  put(d, sim.snd.bomb.x, sim.snd.bomb.z + 1);
  ticks(sim, 2);
  const guest = makeSim();
  const v = guest.decodeSnapshot(sim.encodeSnapshot(), 'h1');
  const s = sndOf(v);
  assert.equal(s, v.points.snd, 'carried on the site list too, for the interpolated view');
  assert.equal(s.state, 'live'); assert.equal(s.round, 1);
  assert.equal(s.bomb.state, 'planted'); assert.equal(s.bomb.site, 'B');
  assert.ok(Math.abs(s.fuse - sim.snd.bomb.fuse) < 0.11);
  assert.equal(s.defuse.id, d.id);
  assert.ok(Math.abs(s.defuse.t - 2 / SND.defuse) < 0.05);
  assert.equal(v.players.find(p => p.id === planter.id).plants, 1);
  assert.deepEqual(v.points.map(p => p.id), ['A', 'B']);
  // An interpolator copies `points` but not `snd`: the state is still found.
  assert.equal(sndOf({ points: v.points }).bomb.site, 'B');
  // History and the carrier.
  winRound(sim, 0);
  const v2 = guest.decodeSnapshot(sim.encodeSnapshot(), 'h1');
  assert.deepEqual(sndOf(v2).history, sim.snd.history);
  assert.equal(sndOf(v2).carrier, carrier(sim).id);
});

await test('host migration mid-round: the planted bomb keeps ticking on the new host and still ends the round', () => {
  const humans = [HUMAN, { id: 'g1', name: 'Guest', team: 1, primary: 'smg', camo: 'none' }];
  const sim = makeSim({ humans });
  winRound(sim, 1);
  goLive(sim); park(sim);
  plantAt(sim, 0);
  ticks(sim, 10);
  const view = sim.decodeSnapshot(sim.encodeSnapshot(), 'g1');
  const roster = buildRoster(humans, { botSkill: 'regular', teamSize: 3, mapId: 'railyard', mode: 'snd', seed: 7 });
  const next = Sim.fromSnapshot(view, roster, { map: 'railyard', seed: 7, gone: ['h1'] });
  for (const p of next.players) p.bot = null;
  assert.equal(next.snd.round, 2);
  assert.equal(next.snd.state, 'live');
  assert.equal(next.snd.bomb.state, 'planted');
  assert.ok(Math.abs(next.snd.bomb.fuse - sim.snd.bomb.fuse) < 0.2);
  assert.deepEqual(next.scores, sim.scores);
  assert.equal(next.snd.history.length, 1);
  assert.equal(next.snd.bomb.planter?.id, sim.snd.bomb.planter.id, 'the planter still gets the credit');
  for (let i = 0; i < sim.players.length; i++) if (sim.players[i].id !== 'h1') assert.equal(next.players[i].alive, sim.players[i].alive);   // h1 left: held off the field.
  ticks(next, next.snd.bomb.fuse + 0.2);
  assert.equal(next.snd.history.at(-1).reason, 'bomb');
  assert.deepEqual(next.scores, [sim.scores[0] + 1, sim.scores[1]]);
  ticks(next, SND.post + 0.2);
  assert.equal(next.snd.round, 3, 'rounds carry on');
});

await test('host migration in the freeze and with the bomb dropped', () => {
  const sim = makeSim();
  ticks(sim, 2);
  let next = Sim.fromSnapshot(sim.decodeSnapshot(sim.encodeSnapshot(), 'h1'), buildRoster([HUMAN], { botSkill: 'regular', teamSize: 3, mapId: 'railyard', mode: 'snd', seed: 7 }), { map: 'railyard', seed: 7 });
  assert.equal(next.phase, 'warmup');
  assert.equal(next.snd.state, 'freeze');
  assert.ok(Math.abs(next.phaseT - (SND.freeze - 2)) < 0.3);
  assert.equal(next.snd.bomb.carrier.id, carrier(sim).id);
  goLive(sim); park(sim);
  const c = carrier(sim);
  put(c, 30, 24);
  kill(sim, c);
  next = Sim.fromSnapshot(sim.decodeSnapshot(sim.encodeSnapshot(), 'h1'), buildRoster([HUMAN], { botSkill: 'regular', teamSize: 3, mapId: 'railyard', mode: 'snd', seed: 7 }), { map: 'railyard', seed: 7 });
  assert.equal(next.snd.bomb.state, 'dropped');
  assert.ok(Math.abs(next.snd.bomb.x - sim.snd.bomb.x) < 0.11);
});

await test('spectate: a player out for the round watches living teammates, and taps cycle through them', () => {
  const sim = makeSim(); goLive(sim); park(sim);
  const view = () => sim.getView('h1');
  spectate.reset();
  assert.equal(spectate.target(view(), 'h1'), null, 'alive: nothing to spectate');
  kill(sim, sim.byId.get('h1'));
  const mates = sim.players.filter(p => p.team === 0 && p.id !== 'h1');
  assert.equal(spectate.target(view(), 'h1'), mates[0].id);
  assert.equal(spectate.cycle(view(), 'h1'), mates[1].id);
  assert.equal(spectate.target(view(), 'h1'), mates[1].id);
  kill(sim, mates[1]);
  assert.equal(spectate.target(view(), 'h1'), mates[0].id, 'falls back when the watched one dies');
  kill(sim, mates[0]);
  ticks(sim, STEP);
  assert.equal(spectate.target(view(), 'h1'), null, 'nobody left');
});

/* ---------------- Bots ---------------- */

function runMatch(mapId, seed, skills = null, limit = 1500) {
  const roster = buildRoster([], { botSkill: 'mixed', mapId, mode: 'snd', seed });
  if (skills) for (const r of roster) r.skill = skills[r.team];
  const sim = new Sim({ roster, map: mapId, seed, mode: 'snd' });
  const tally = { planted: 0, defused: 0, exploded: 0, pickup: 0, rounds: 0 };
  let t = 0;
  while (sim.phase !== 'ended' && t < limit) {
    sim.step(STEP); t += STEP;
    for (const e of sim.drainEvents()) if (e.t === 'snd' && e.kind in tally) tally[e.kind]++;
  }
  tally.rounds = sim.snd.history.length;
  return { sim, t, tally };
}

if (!QUICK) {
  const STANDARD = ['railyard', 'harbor', 'neon', 'dust', 'frost', 'sunken', 'topside'];

  await test('bots: full mixed matches finish on all seven maps, with plants and pickups', () => {
    const sum = { planted: 0, defused: 0, exploded: 0, pickup: 0 };
    let attackWins = 0, rounds = 0;
    for (const id of STANDARD) {
      for (const seed of [1, 2]) {
        const { sim, t, tally } = runMatch(id, seed);
        assert.equal(sim.phase, 'ended', `${id}/${seed} finished`);
        assert.ok(sim.winner === 0 || sim.winner === 1);
        assert.equal(Math.max(...sim.scores), 4);
        assert.ok(tally.rounds >= 4 && tally.rounds <= 7);
        for (const k in sum) sum[k] += tally[k];
        sim.snd.history.forEach((h, i) => { rounds++; if (h.winner === (i < SND.halftime ? 0 : 1)) attackWins++; });
        console.log(`     ${id.padEnd(8)} seed ${seed}: ${sim.scores.join('-')} in ${Math.round(t)} s, ${sim.snd.history.map(h => `${h.winner}${h.reason[0]}`).join(' ')}  plants ${tally.planted} defuses ${tally.defused} booms ${tally.exploded}`);
      }
    }
    console.log(`     attackers took ${attackWins} of ${rounds} rounds; ${JSON.stringify(sum)}`);
    assert.ok(attackWins > rounds * 0.2 && attackWins < rounds * 0.8, 'neither role is hopeless');
    assert.ok(sum.planted >= 10, `bots plant (${sum.planted})`);
    assert.ok(sum.defused >= 1, `bots defuse (${sum.defused})`);
    assert.ok(sum.pickup >= 5, `dropped bombs get picked up (${sum.pickup})`);
  });

  await test('bots: tiers separate; elites beat recruits on every map, from either side', () => {
    let eliteRounds = 0, recruitRounds = 0, eliteMatches = 0;
    for (const id of STANDARD) {
      for (const [seed, eliteTeam] of [[3, 0], [4, 1]]) {
        const skills = eliteTeam === 0 ? ['elite', 'recruit'] : ['recruit', 'elite'];
        const { sim } = runMatch(id, seed, skills);
        eliteRounds += sim.scores[eliteTeam]; recruitRounds += sim.scores[1 - eliteTeam];
        if (sim.winner === eliteTeam) eliteMatches++;
      }
    }
    console.log(`     elite ${eliteMatches}/14 matches, rounds ${eliteRounds}-${recruitRounds}`);
    assert.ok(eliteMatches >= 12, 'elites win nearly every match');
    assert.ok(eliteRounds >= recruitRounds * 2.5);
    // And one step apart still shows: veterans over regulars.
    let vet = 0, reg = 0;
    for (const id of STANDARD) {
      const a = runMatch(id, 5, ['veteran', 'regular']).sim, b = runMatch(id, 6, ['regular', 'veteran']).sim;
      vet += a.scores[0] + b.scores[1]; reg += a.scores[1] + b.scores[0];
    }
    console.log(`     veteran v regular rounds ${vet}-${reg}`);
    assert.ok(vet > reg * 1.3);
  });
}

console.log(`\n${passed} passed`);
