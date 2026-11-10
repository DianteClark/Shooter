// Node tests for the Golden Gun and tap-to-respawn (sim side). Run: node dev/sim-golden-respawn.mjs
// Exits non-zero on the first failed check, printing what failed.
import assert from 'node:assert/strict';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { RESPAWN_IDLE, createPlayerState, encodeHumanState, decodeHumanState, shotPassage, traceShot } from '../js/sim/player.js';
import { WEAPONS, shotsToKill } from '../js/shared/weapons.js';
import { GOLDEN_ID, RESPAWN_TIME, SECONDARY_IDS, WEAPON_IDS, SIM_HZ, PLAYER_RADIUS } from '../js/shared/constants.js';
import { availableFor, normalizeKit } from '../js/shared/attachments.js';
import { goldenStatus, blankSave, MAX_PRESTIGE, MAX_WEAPON_PRESTIGE, WEAPON_CURVE, PLAYER_CURVE, GOLDEN_REQ_WEAPONS } from '../js/shared/progression.js';
import { PERK_IDS, normalizeLoadout } from '../js/shared/catalog.js';
import { MAPS } from '../js/shared/map.js';
import { hasLineOfSight } from '../js/shared/geometry.js';

const STEP = 1 / SIM_HZ;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}

const HUMAN = { id: 'h1', name: 'Human', team: 0, primary: 'ar', camo: 'none', loadout: { primary: 'ar', secondary: GOLDEN_ID } };

// A live match whose bots stand still (no brains), so only the test decides who dies.
function makeSim({ mode = 'tdm', humans = [HUMAN], teamSize = 2 } = {}) {
  const roster = buildRoster(humans, { botSkill: 'regular', teamSize, mapId: 'railyard', mode, seed: 7 });
  const sim = new Sim({ roster, map: 'railyard', seed: 7, mode });
  sim.step(0);                       // Builds nav and the bot brains...
  for (const p of sim.players) p.bot = null;   // ...which these tests do not want.
  sim._setPhase('live');
  sim.drainEvents();
  return sim;
}
const ticks = (sim, seconds) => { for (let i = Math.round(seconds * SIM_HZ); i > 0; i--) sim.step(STEP); };
const enemyOf = (sim, p) => sim.players.find(q => q.team !== p.team);
function kill(sim, id) {
  const p = sim.byId.get(id);
  p.spawnProtect = 0;
  sim._damage(p, enemyOf(sim, p), 999, 'ar', 5);
  assert.equal(p.alive, false, `${id} should be dead`);
  return p;
}

/* ---------------- Tap to respawn ---------------- */

test('human waits on the death screen past the minimum time', () => {
  const sim = makeSim();
  const p = kill(sim, 'h1');
  ticks(sim, RESPAWN_TIME + 2);
  assert.equal(p.alive, false);
});

test('respawn command after the minimum time spawns on the next tick', () => {
  const sim = makeSim();
  const p = kill(sim, 'h1');
  ticks(sim, RESPAWN_TIME + 1);
  sim.drainEvents();
  assert.equal(sim.applyCommand('h1', { cmd: 'respawn' }), true);
  ticks(sim, STEP);
  assert.equal(p.alive, true);
  assert.ok(sim.drainEvents().some(e => e.t === 'spawn' && e.id === 'h1'), 'spawn event for h1');
});

test('an early tap is kept and honoured the moment the minimum time is up', () => {
  const sim = makeSim();
  const p = kill(sim, 'h1');
  ticks(sim, 0.5);
  sim.applyCommand('h1', { cmd: 'respawn' });
  ticks(sim, RESPAWN_TIME - 0.5 - 0.1);
  assert.equal(p.alive, false, 'not before RESPAWN_TIME');
  ticks(sim, 0.2);
  assert.equal(p.alive, true, 'right after RESPAWN_TIME');
});

test('auto-respawn on: the request sent at death respawns the moment RESPAWN_TIME is up', () => {
  const sim = makeSim();
  const p = kill(sim, 'h1');
  sim.applyCommand('h1', { cmd: 'respawn' });         // What the HUD sends at death with the option on.
  ticks(sim, RESPAWN_TIME - 0.1);
  assert.equal(p.alive, false, 'not before the minimum');
  ticks(sim, 0.2);
  assert.equal(p.alive, true, 'right at the minimum, no 10 s wait');
});

test('auto-respawn off: waits for the tap, idle fallback at RESPAWN_IDLE (20 s)', () => {
  assert.equal(RESPAWN_IDLE, 20);
  const sim = makeSim();
  const p = kill(sim, 'h1');
  ticks(sim, 10.5);
  assert.equal(p.alive, false, 'no auto-respawn at the old 10 s');
  ticks(sim, RESPAWN_IDLE - 10.5 - 0.2);
  assert.equal(p.alive, false);
  ticks(sim, 0.4);
  assert.equal(p.alive, true, 'idle fallback');
});

test('an old phone sending hold changes nothing; the tap still works', () => {
  const sim = makeSim();
  const p = kill(sim, 'h1');
  assert.equal(sim.applyCommand('h1', { cmd: 'respawn', hold: true }), true);
  ticks(sim, RESPAWN_TIME + 1);
  assert.equal(p.alive, false, 'hold is not a request');
  sim.applyCommand('h1', { cmd: 'respawn' });
  ticks(sim, STEP);
  assert.equal(p.alive, true);
  kill(sim, 'h1');
  ticks(sim, RESPAWN_IDLE + 0.2);
  assert.equal(p.alive, true, 'idle fallback still applies');
});

test('a tap from a previous life does not carry into the next death', () => {
  const sim = makeSim();
  const p = kill(sim, 'h1');
  ticks(sim, RESPAWN_TIME + 0.1);
  sim.applyCommand('h1', { cmd: 'respawn' });
  sim.applyCommand('h1', { cmd: 'respawn' });        // Phones resend; duplicates are harmless.
  ticks(sim, STEP);
  assert.equal(p.alive, true);
  assert.equal(sim.applyCommand('h1', { cmd: 'respawn' }), false, 'ignored while alive');
  kill(sim, 'h1');
  ticks(sim, RESPAWN_TIME + 1);
  assert.equal(p.alive, false);
});

test('bots respawn at RESPAWN_TIME as before, and bots ignore respawn commands', () => {
  const sim = makeSim();
  const bot = sim.players.find(q => q.isBot && q.team === 1);
  kill(sim, bot.id);
  assert.equal(sim.applyCommand(bot.id, { cmd: 'respawn', hold: true }), false);
  ticks(sim, RESPAWN_TIME + 0.1);
  assert.equal(bot.alive, true);
});

test('works in free-for-all and Gun Game', () => {
  for (const mode of ['ffa', 'gun']) {
    const sim = makeSim({ mode, teamSize: 4 });
    const p = kill(sim, 'h1');
    ticks(sim, RESPAWN_TIME + 2);
    assert.equal(p.alive, false, `${mode}: waits`);
    sim.applyCommand('h1', { cmd: 'respawn' });
    ticks(sim, STEP);
    assert.equal(p.alive, true, `${mode}: respawns on tap`);
  }
});

test('a dropped human\'s slot is held off the field; rejoining spawns it, and the next death waits for a tap', () => {
  const sim = makeSim();
  const p = kill(sim, 'h1');
  sim.humanLeft('h1');
  ticks(sim, RESPAWN_TIME + 0.1);
  assert.equal(p.alive, false, 'held slots never respawn on their own (see dev/sim-heldslots.mjs)');
  sim.humanRejoin('h1', { id: 'h1b' });
  assert.equal(p.alive, true, 'back at once');
  kill(sim, 'h1b');
  ticks(sim, RESPAWN_TIME + 1);
  assert.equal(p.alive, false, 'human again: waits');
  sim.applyCommand('h1b', { cmd: 'respawn' });
  ticks(sim, STEP);
  assert.equal(p.alive, true);
});

test('host migration: a dead human stays dead on the new host until they tap', () => {
  const humans = [HUMAN, { id: 'g1', name: 'Guest', team: 1, primary: 'smg', camo: 'none' }];
  const sim = makeSim({ humans });
  kill(sim, 'g1');
  ticks(sim, 1);
  const view = sim.decodeSnapshot(sim.encodeSnapshot(), 'g1');
  const roster = buildRoster(humans, { botSkill: 'regular', teamSize: 2, mapId: 'railyard', mode: 'tdm', seed: 7 });
  const next = Sim.fromSnapshot(view, roster, { map: 'railyard', seed: 7, gone: ['h1'] });
  for (const q of next.players) if (q.id !== 'h1') q.bot = null;
  const g = next.byId.get('g1');
  assert.equal(g.alive, false);
  assert.equal(next.byId.get('h1').away, true, 'the old host\'s slot is held for them, not botted');
  assert.equal(next.byId.get('h1').ps.secondary, GOLDEN_ID, 'and keeps their Golden Gun for when they return');
  ticks(next, RESPAWN_TIME + 1);
  assert.equal(g.alive, false, 'still waiting after migration');
  next.applyCommand('g1', { cmd: 'respawn' });
  ticks(next, STEP);
  assert.equal(g.alive, true);
  // The auto-respawn clock carries on from the death, as far as the snapshot can tell.
  const g2 = next.byId.get('g1');
  kill(next, 'g1');
  const view2 = next.decodeSnapshot(next.encodeSnapshot(), 'g1');
  const third = Sim.fromSnapshot(view2, roster, { map: 'railyard', seed: 7 });
  for (const q of third.players) q.bot = null;
  ticks(third, RESPAWN_IDLE + 0.2);
  assert.equal(third.byId.get('g1').alive, true, 'idle fallback still applies after migration');
  assert.ok(g2);
});

/* ---------------- The Golden Gun ---------------- */

test('golden keeps its wire index (last pre-V8 id), a secondary, and takes no attachments', () => {
  assert.equal(WEAPON_IDS.indexOf(GOLDEN_ID), 24);   // V8 guns are appended after it (constants.js).
  assert.ok(WEAPON_IDS.slice(25).every(id => id !== GOLDEN_ID));
  assert.ok(SECONDARY_IDS.includes(GOLDEN_ID));
  assert.equal(WEAPONS.golden.category, 'Pistol');
  assert.equal(availableFor(GOLDEN_ID).length, 0);
  assert.equal(Object.keys(normalizeKit(GOLDEN_ID, { optic: 'reflex', barrel: 'suppressor', mag: 'extended', grip: 'wrap' })).length, 0);
  assert.equal(WEAPONS.golden.magazine, 1);
  assert.ok(WEAPONS.golden.reload >= 3, 'slow reload');
  assert.equal(WEAPONS.golden.penetrate, undefined, 'light round: cover stops it');
  assert.ok(WEAPONS.golden.headMult >= 1);
});

test('one body hit kills anywhere inside its range, from the hip too, and nothing past it', () => {
  const w = WEAPONS.golden;
  for (const d of [2, 15, 30, w.range - 1]) {
    assert.equal(shotsToKill(w, d, 100, true), 1, `aimed at ${d} m`);
    assert.equal(shotsToKill(w, d, 100, false), 1, `hip at ${d} m`);
  }
  const rays = traceShot({ ox: 0, oz: 0, aim: 0, weapon: GOLDEN_ID, angles: [0] }, { width: 200, height: 200, walls: [], cover: [], solids: [], obstacles: [] },
    [{ id: 'a', x: 0, z: 0, alive: true }, { id: 'b', x: w.range + 2, z: 0.2, alive: true }], 'a');
  assert.notEqual(rays[0].hit, 'player', 'out of range');
  const near = traceShot({ ox: 0, oz: 0, aim: 0, weapon: GOLDEN_ID, angles: [0] }, { width: 200, height: 200, walls: [], cover: [], solids: [], obstacles: [] },
    [{ id: 'a', x: 0, z: 0, alive: true }, { id: 'b', x: w.range - 1, z: 0.2, alive: true }], 'a');
  assert.equal(near[0].hit, 'player', 'in range');
});

// A clear lane on the real map for live shots: a point and a direction with nothing in the way for `len` metres.
function findLane(map, len) {
  for (let x = 4; x < map.width - 4; x += 1.5) {
    for (let z = 4; z < map.height - 4; z += 1.5) {
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const bx = x + dx * len, bz = z + dz * len;
        if (bx < 1 || bz < 1 || bx > map.width - 1 || bz > map.height - 1) continue;
        if (shotPassage(map, x, z, bx, bz, WEAPONS.golden) === 1 && shotPassage(map, x, z + 0.6, bx, bz + 0.6, WEAPONS.golden) === 1) return { x, z, dx, dz };
      }
    }
  }
  return null;
}

test('live shot: a body hit at range kills, emits the golden medal and names the gun', () => {
  const sim = makeSim();
  const map = MAPS.railyard, lane = findLane(map, 32);
  assert.ok(lane, 'found a clear 32 m lane');
  const me = sim.byId.get('h1'), foe = enemyOf(sim, me);
  me.ps.x = lane.x; me.ps.z = lane.z;
  // 0.3 m off the centre line: a body hit, not the head.
  const off = 0.3;
  foe.ps.x = lane.x + lane.dx * 32 - lane.dz * off; foe.ps.z = lane.z + lane.dz * 32 + lane.dx * off;
  foe.spawnProtect = 0; foe.hp = 100;
  me.ps.secondary = GOLDEN_ID; me.ps.slot = 1; me.ps.weapon = GOLDEN_ID;
  const aim = Math.atan2(lane.dz, lane.dx);
  sim.drainEvents();
  sim.applyShot('h1', { ox: me.ps.x, oz: me.ps.z, aim, weapon: GOLDEN_ID, angles: [aim], ads: false }, 0);
  const ev = sim.drainEvents();
  assert.equal(foe.alive, false, 'one round kills');
  const k = ev.find(e => e.t === 'kill');
  assert.equal(k.weapon, GOLDEN_ID);
  assert.ok(!k.head, 'body hit');
  assert.ok(ev.some(e => e.t === 'medal' && e.medal === 'golden' && e.id === 'h1'), 'golden medal');
});

test('cover stops it the way it stops any sidearm', () => {
  const map = MAPS.railyard;
  let found = 0;
  for (let x = 3; x < map.width - 3 && found < 5; x += 0.9) {
    for (let z = 3; z < map.height - 3 && found < 5; z += 0.9) {
      const bx = x + 12, bz = z;
      if (bx > map.width - 2) continue;
      // A rifle round gets through (penetrating) where the line is blocked by waist-high cover only.
      if (!hasLineOfSight(map, x, z, bx, bz) || shotPassage(map, x, z, bx, bz, WEAPONS.ar) >= 1 || shotPassage(map, x, z, bx, bz, WEAPONS.ar) === 0) continue;
      assert.equal(shotPassage(map, x, z, bx, bz, WEAPONS.golden), shotPassage(map, x, z, bx, bz, WEAPONS.pistol), 'same as the pistol');
      assert.equal(shotPassage(map, x, z, bx, bz, WEAPONS.golden), 0);
      found++;
    }
  }
  assert.ok(found > 0, 'found cover to test against');
});

test('bots never carry it: rosters, a bot taking over a human slot, and a migrated bot slot', () => {
  for (const mode of ['tdm', 'ffa', 'dom', 'gun']) {
    const roster = buildRoster([HUMAN], { botSkill: 'mixed', teamSize: 6, mapId: 'railyard', mode, seed: 3 });
    for (const r of roster) if (r.isBot) assert.notEqual(r.loadout.secondary, GOLDEN_ID, `${mode} roster`);
  }
  // A roster from elsewhere that hands a bot the gun anyway.
  const bad = [{ id: 'b', name: 'B', team: 1, isBot: true, skill: 'elite', primary: 'ar', camo: 'none', loadout: normalizeLoadout({ primary: 'ar', secondary: GOLDEN_ID }) }];
  const s0 = new Sim({ roster: [...buildRoster([HUMAN], { teamSize: 1, mapId: 'railyard' }), ...bad], map: 'railyard' });
  assert.notEqual(s0.byId.get('b').ps.secondary, GOLDEN_ID);
  const sim = makeSim();
  const h = sim.byId.get('h1');
  assert.equal(h.ps.secondary, GOLDEN_ID, 'humans keep it');
  h.ps.slot = 1; h.ps.weapon = GOLDEN_ID;
  // Dropping holds the slot (no bot), so nothing to take; a bot given the slot by older code still loses it.
  sim.humanLeft('h1');
  assert.equal(h.ps.secondary, GOLDEN_ID, 'a held slot keeps it');
  sim.humanRejoin('h1');
  h.ps.slot = 1; h.ps.weapon = GOLDEN_ID;
  h.isBot = true; h.humanId = 'h1';
  sim._noGoldForBots(h);
  assert.equal(h.ps.secondary, 'pistol');
  assert.equal(h.ps.weapon, 'pistol', 'was holding it: now holds the pistol');
  assert.equal(h.loadout.secondary, 'pistol');
  kill(sim, 'h1');
  ticks(sim, RESPAWN_TIME + 0.1);
  assert.equal(h.ps.secondary, 'pistol', 'still not after a respawn');
});

test('wire: the golden id survives the human-state and snapshot codecs', () => {
  const ps = createPlayerState({ id: 'x', primary: 'ar', loadout: { primary: 'ar', secondary: GOLDEN_ID } });
  ps.slot = 1; ps.weapon = GOLDEN_ID;
  const d = decodeHumanState(encodeHumanState(ps));
  assert.equal(d.secondary, GOLDEN_ID);
  assert.equal(d.weapon, GOLDEN_ID);
  const sim = makeSim();
  const h = sim.byId.get('h1');
  h.ps.slot = 1; h.ps.weapon = GOLDEN_ID;
  const view = sim.decodeSnapshot(sim.encodeSnapshot(), 'h1');
  assert.equal(view.players.find(p => p.id === 'h1').weapon, GOLDEN_ID);
});

test('unlock rule: every perk Pro, every other gun maxed at max prestige, Prestige X at level 50', () => {
  const maxed = () => {
    const s = blankSave();
    s.prestige = MAX_PRESTIGE; s.xp = PLAYER_CURVE.cap;
    s.proDone = [...PERK_IDS];
    for (const id of GOLDEN_REQ_WEAPONS) s.weapons[id] = { xp: WEAPON_CURVE.cap, prestige: MAX_WEAPON_PRESTIGE };
    return s;
  };
  assert.equal(goldenStatus(maxed()).earned, true);
  assert.ok(!GOLDEN_REQ_WEAPONS.includes(GOLDEN_ID), 'the gun itself is not a requirement');
  let s = maxed(); s.proDone.pop();
  assert.equal(goldenStatus(s).earned, false, 'one perk short');
  s = maxed(); s.weapons.ar.prestige = MAX_WEAPON_PRESTIGE - 1;
  assert.equal(goldenStatus(s).earned, false, 'one gun short of max prestige');
  s = maxed(); s.weapons.smg.xp = 0;
  assert.equal(goldenStatus(s).earned, false, 'one gun not back at max level');
  s = maxed(); s.xp = 0;
  assert.equal(goldenStatus(s).earned, false, 'Prestige X but not level 50');
  s = maxed(); s.prestige = MAX_PRESTIGE - 1;
  assert.equal(goldenStatus(s).earned, false, 'level 50 without Prestige X');
  assert.equal(goldenStatus(blankSave()).earned, false);
});

console.log(`\n${passed} passed`);
assert.ok(PLAYER_RADIUS > 0);
