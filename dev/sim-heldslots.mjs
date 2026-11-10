// Node tests for held slots: a human who drops mid-match keeps their slot (no bot), comes back with their stats, and
// after HOLD_OPEN_SECONDS the slot opens to a newcomer. Run: node dev/sim-heldslots.mjs
import assert from 'node:assert/strict';
import { Sim, buildRoster, HOLD_OPEN_SECONDS } from '../js/sim/sim.js';
import { SIM_HZ, RESPAWN_TIME } from '../js/shared/constants.js';
import { SND } from '../js/shared/modes.js';

const STEP = 1 / SIM_HZ;
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}

const HOST = { id: 'h1', name: 'Host', team: 0, primary: 'ar', camo: 'none' };
const GUEST = { id: 'g1', name: 'Guest', team: 1, primary: 'smg', camo: 'none' };
const HUMANS = [HOST, GUEST];

function makeSim({ mode = 'tdm', humans = HUMANS, teamSize = 3 } = {}) {
  const roster = buildRoster(humans, { botSkill: 'regular', teamSize, mapId: 'railyard', mode, seed: 7 });
  const sim = new Sim({ roster, map: 'railyard', seed: 7, mode, timeLimit: 3600, scoreLimit: 999 });
  sim.step(0);
  for (const p of sim.players) p.bot = null;     // Still bots: only the test decides who dies.
  sim._setPhase('live');
  sim.drainEvents();
  return { sim, roster };
}
const ticks = (sim, seconds) => { for (let i = Math.round(seconds * SIM_HZ); i > 0; i--) sim.step(STEP); };
const enemyOf = (sim, p) => sim.players.find(q => q.team !== p.team && !q.away);
function kill(sim, p) {
  p.spawnProtect = 0;
  sim._damage(p, enemyOf(sim, p), 999, 'ar', 5);
}

await test('a dropped human is not replaced by a bot: off the field, stats kept, no respawn', () => {
  const { sim } = makeSim();
  const g = sim.byId.get('g1');
  g.kills = 4; g.deaths = 2;
  const bots = sim.players.filter(p => p.isBot).length;
  sim.humanLeft('g1');
  assert.equal(g.isBot, false, 'no bot takes the slot');
  assert.equal(g.bot, null);
  assert.equal(sim.players.filter(p => p.isBot).length, bots, 'bot count unchanged');
  assert.equal(g.away, true);
  assert.equal(g.alive, false, 'not on the field');
  assert.ok(sim.drainEvents().some(e => e.t === 'away' && e.id === 'g1'));
  assert.ok(!sim.drainEvents().some(e => e.t === 'kill'), 'leaving is not a death');
  ticks(sim, RESPAWN_TIME + 20);
  assert.equal(g.alive, false, 'never respawns while held');
  assert.equal(g.kills, 4); assert.equal(g.deaths, 2);
  // Not targetable: a shot straight at where it stood hits nothing, and late states and commands are ignored.
  sim.applyHumanState('g1', { x: 10, z: 10, aim: 0, vx: 0, vz: 0, slot: 0, primary: 'smg', weapon: 'smg', ammo: [1, 1], reserve: [1, 1] });
  assert.equal(g.alive, false);
  assert.equal(sim.applyCommand('g1', { cmd: 'respawn' }), false);
  const v = sim.decodeSnapshot(sim.encodeSnapshot(), 'h1').players.find(p => p.id === 'g1');
  assert.equal(v.away, true, 'the snapshot carries the hold');
  assert.equal(v.alive, false);
  assert.equal(v.kills, 4);
});

await test('rejoin restores the slot with its stats and spawns it', () => {
  const { sim } = makeSim();
  const g = sim.byId.get('g1');
  g.kills = 7; g.deaths = 3; g.assists = 2;
  sim.humanLeft('g1');
  ticks(sim, 30);
  const r = sim.humanRejoin('g1');
  assert.ok(r, 'rejoined');
  assert.equal(g.away, false);
  assert.equal(g.alive, true, 'back on the field at once');
  assert.deepEqual([g.kills, g.deaths, g.assists], [7, 3, 2]);
  const ev = sim.drainEvents();
  assert.ok(ev.some(e => e.t === 'rejoin' && e.id === 'g1' && !e.fresh));
  assert.ok(ev.some(e => e.t === 'spawn' && e.id === 'g1'));
});

await test('after HOLD_OPEN_SECONDS the slot opens; a newcomer takes it fresh, still no bot', () => {
  const { sim } = makeSim();
  const g = sim.byId.get('g1');
  g.kills = 9;
  const before = sim.scores.slice();
  sim.humanLeft('g1');
  ticks(sim, HOLD_OPEN_SECONDS - 1);
  assert.equal(g.open, false, 'not yet');
  assert.equal(sim.claimOpenSlot('n1', 'Newbie'), null, 'nothing open yet');
  ticks(sim, 1.2);
  assert.equal(g.open, true);
  assert.ok(sim.drainEvents().some(e => e.t === 'slotOpen'));
  assert.equal(sim.decodeSnapshot(sim.encodeSnapshot(), 'h1').players[g.index].open, true);
  assert.deepEqual(sim.rejoinSlots().map(s => [s.id, s.open]), [['g1', true]]);
  const r = sim.claimOpenSlot('n1', 'Newbie', { primary: 'dmr' }, { badge: { level: 3 } });
  assert.ok(r);
  assert.equal(r.oldId, 'g1');
  assert.equal(sim.byId.get('n1'), g, 'the same seat under the new id');
  assert.equal(sim.byId.has('g1'), false);
  assert.equal(g.name, 'Newbie');
  assert.equal(g.team, 1, 'same side');
  assert.equal(g.isBot, false);
  assert.equal(g.kills, 0, 'fresh stats');
  assert.equal(g.alive, true);
  assert.deepEqual(sim.scores, before, 'team score untouched');
  const ev = sim.drainEvents().find(e => e.t === 'rejoin');
  assert.deepEqual([ev.oldId, ev.id, ev.fresh, ev.info.badge.level], ['g1', 'n1', true, 3]);
  // A guest's codec follows the rebind from the event.
  const guest = new Sim({ roster: buildRoster(HUMANS, { botSkill: 'regular', teamSize: 3, mapId: 'railyard', mode: 'tdm', seed: 7 }), map: 'railyard', seed: 7 });
  guest.rebindPlayer(ev.oldId, ev.id, ev.name);
  assert.equal(guest.decodeSnapshot(sim.encodeSnapshot(), 'h1').players[g.index].id, 'n1');
});

await test('the original player can still reclaim an open slot that nobody took, with stats', () => {
  const { sim } = makeSim();
  const g = sim.byId.get('g1');
  g.kills = 5;
  sim.humanLeft('g1');
  ticks(sim, HOLD_OPEN_SECONDS + 1);
  assert.ok(sim.humanRejoin('g1'));
  assert.equal(g.kills, 5);
  assert.equal(g.open, false);
});

await test('host migration keeps held slots held (and their clock), and the old host is held too', () => {
  const { sim, roster } = makeSim();
  const g = sim.byId.get('g1');
  g.kills = 3;
  sim.humanLeft('g1');
  ticks(sim, 60);
  const view = sim.decodeSnapshot(sim.encodeSnapshot(), 'g1');
  const next = Sim.fromSnapshot(view, roster, { map: 'railyard', seed: 7, gone: ['h1'] });
  for (const p of next.players) p.bot = null;
  const ng = next.byId.get('g1'), nh = next.byId.get('h1');
  assert.equal(ng.away, true, 'still held');
  assert.equal(ng.isBot, false);
  assert.equal(ng.kills, 3);
  assert.ok(Math.abs(ng.awayT - 60) < 0.2, `clock carried: ${ng.awayT}`);
  assert.equal(nh.away, true, 'old host held, not botted');
  assert.equal(nh.isBot, false);
  ticks(next, RESPAWN_TIME + 5);
  assert.equal(ng.alive, false);
  ticks(next, HOLD_OPEN_SECONDS - 60);
  assert.equal(ng.open, true, 'opens on time on the new host');
  assert.equal(nh.open, false);
  // A second migration keeps the open flag.
  const third = Sim.fromSnapshot(next.decodeSnapshot(next.encodeSnapshot(), 'x'), roster, { map: 'railyard', seed: 7 });
  assert.equal(third.byId.get('g1').open, true);
  assert.equal(third.byId.get('h1').away, true);
  assert.ok(third.humanRejoin('h1'));
  assert.equal(third.byId.get('h1').alive, true);
});

await test('every mode: dropping never makes a bot; S&D waits for the next round; FFA keeps its colour', () => {
  for (const mode of ['tdm', 'dom', 'hard', 'kc', 'ctf', 'snd', 'ffa', 'gun']) {
    const humans = mode === 'ffa' || mode === 'gun' ? [HOST, { ...GUEST, team: 0 }] : HUMANS;
    const { sim } = makeSim({ mode, humans, teamSize: mode === 'ffa' || mode === 'gun' ? 6 : 3 });
    const g = sim.byId.get('g1');
    const team = g.team;
    sim.humanLeft('g1');
    assert.equal(g.isBot, false, mode);
    ticks(sim, 12);
    assert.equal(g.alive, false, `${mode}: held off the field`);
    sim.humanRejoin('g1');
    assert.equal(g.team, team, `${mode}: same seat`);
    if (mode === 'snd') {
      assert.equal(g.alive, false, 'S&D: waits for the round');
      sim.snd._roundEnd(0, 'time');
      ticks(sim, SND.post + 0.2);
      assert.equal(g.alive, true, 'S&D: back for the next round');
    } else {
      assert.equal(g.alive, true, `${mode}: back at once`);
    }
  }
});

await test('S&D: a carrier who drops lets go of the bomb, and nobody away is dealt it', () => {
  const { sim } = makeSim({ mode: 'snd' });
  const carrier = sim.players.find(p => sim.snd.bomb.carrier === p);
  if (carrier) {
    // Make the carrier a human for this check.
    carrier.isBot = false;
    sim.humanLeft(carrier.id);
    assert.notEqual(sim.snd.bomb.carrier, carrier);
  }
  for (const p of sim.players) if (p.team === sim.snd.attackers && !p.isBot) sim.humanLeft(p.id);
  sim.snd._roundEnd(0, 'time');
  ticks(sim, SND.post + 0.2);
  assert.ok(!sim.snd.bomb.carrier?.away);
});

await test('old bots are unchanged and a human dying normally still respawns', () => {
  const { sim } = makeSim();
  const b = sim.players.find(p => p.isBot);
  kill(sim, b);
  ticks(sim, RESPAWN_TIME + 0.2);
  assert.equal(b.alive, true);
  sim.humanLeft(b.id);
  assert.equal(b.away, false, 'humanLeft ignores bots');
});

console.log(`\n${passed} passed`);
