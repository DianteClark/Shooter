// Node tests for the gear wave (2026-11): ten new tacticals and lethals, the reworked old ones, their counters, the
// wire, saves, mastery and bots. Run: node dev/sim-gear.mjs   (add `quick` to skip the bot matches)
// Every item is thrown and shown to do its job; every counter the catalog promises is shown to work; every mode
// (S&D, CTF, FFA, Ground War) runs with all the gear in play; bots carrying each item use it and react to the others'.
// Exits non-zero on the first failed check, printing what failed.
import assert from 'node:assert/strict';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { stepPlayer, createPlayerState } from '../js/sim/player.js';
import { EQUIPMENT, SHOOTABLE, syncCover, tripBeam } from '../js/sim/equipment.js';
import { TACTICALS, LETHALS, normalizeLoadout } from '../js/shared/catalog.js';
import { SIM_HZ, MAX_HP } from '../js/shared/constants.js';
import { raycastMap } from '../js/shared/geometry.js';
import { MAPS } from '../js/shared/map.js';
import { MODES } from '../js/shared/modes.js';
import { MASTERY_TRACKS, MasteryTracker, UNLOCK_SCHEDULE, itemUnlockLevel, decodeSave, encodeSave, blankSave, sanitizeSave, cleanLoadout,
  PLAYER_CURVE, itemOpen } from '../js/shared/progression.js';
import { MatchTelemetry, gearRows, EQ_PREFIX } from '../js/game/telemetry.js';
import { hasIcon } from '../js/ui/icons.js';

const QUICK = process.argv.includes('quick');
const STEP = 1 / SIM_HZ;
const NEW_T = ['snapshot', 'blackout', 'bulwark', 'tagger', 'medpack'];
const NEW_L = ['charge', 'thermite', 'tripwire', 'crawler', 'shiv'];
const OLD_T = ['smoke', 'flash', 'stim', 'decoy', 'sensor', 'trophy', 'stun', 'gas', 'shock'];
const OLD_L = ['frag', 'sticky', 'molotov', 'mine', 'cluster', 'hatchet', 'impact', 'claymore', 'drill'];
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}

/* ---------------- Harness ---------------- */
const MAP = MAPS.foundry;
const inWall = (map, x, z, pad = 1) => map.walls.some(w => x > w.x - pad && x < w.x + w.w + pad && z > w.z - pad && z < w.z + w.d + pad);
function openLane(map, len) {
  for (let z = 6; z < map.height - 6; z += 1) {
    for (let x = 6; x < map.width - len - 6; x += 1) {
      if ([-3, 0, 3].some(dz => inWall(map, x, z + dz, 0.6))) continue;
      if ([-3, -1.5, 0, 1.5, 3].some(dz => raycastMap(map, x - 1, z + dz, 1, 0, len + 2, 'blocksMove'))) continue;
      return { x, z };
    }
  }
  throw new Error('no open lane');
}
const LANE = openLane(MAP, 22);
const IDLE = { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, reload: false, swap: false, streak: false };

// A live railyard match with brainless players: `a` (human 'h1') at the head of an open lane facing east, `v` an enemy
// `dist` metres down it facing west. Loadouts are partial; perks default to the plain set.
function arena({ a = {}, v = {}, dist = 8, mode = 'tdm', map = 'foundry' } = {}) {
  const HUMAN = { id: 'h1', name: 'Thrower', team: 0, primary: 'ar', camo: 'none', loadout: { primary: 'ar', ...a } };
  const roster = buildRoster([HUMAN], { botSkill: 'regular', teamSize: 2, mapId: map, mode, seed: 7 });
  const sim = new Sim({ roster, map, seed: 7, mode });
  sim.step(0);
  for (const p of sim.players) p.bot = null;
  sim._setPhase('live');
  const h = sim.byId.get('h1'), foe = sim.players.find(p => p.team !== h.team);
  for (const p of sim.players) {
    p.spawnProtect = 0; p.regenT = 99;
    if (p !== h && p !== foe) { p.alive = false; p.respawnT = 999; p.wantRespawn = false; p.ps.x = 1; p.ps.z = 1; }
  }
  const apply = (p, l) => {
    const n = normalizeLoadout({ primary: 'ar', ...l });
    p.ps.tactical = n.tactical; p.ps.lethal = n.lethal; p.ps.perks = l.perks ?? ['marathon', 'scavenger', 'tracker']; p.ps.pro = l.pro ?? [];
    p.ps.tacticalLeft = TACTICALS[n.tactical].count; p.ps.lethalLeft = LETHALS[n.lethal].count;
  };
  apply(h, a); apply(foe, v);
  h.ps.x = LANE.x; h.ps.z = LANE.z; h.ps.aim = 0;
  foe.ps.x = LANE.x + dist; foe.ps.z = LANE.z; foe.ps.aim = Math.PI;
  sim.drainEvents();
  return { sim, h, v: foe, events: [] };
}
function run(A, seconds, each) {
  for (let t = 0; t < seconds; t += STEP) {
    if (each) each(t);
    A.sim.step(STEP);
    for (const e of A.sim.drainEvents()) A.events.push(e);
  }
  return A.events;
}
const throwAt = (A, who, slot, x, z, dist) => A.sim.applyCommand(who.id, { cmd: 'throw', slot, ox: who.ps.x, oz: who.ps.z, aim: Math.atan2(z - who.ps.z, x - who.ps.x), dist: dist ?? Math.hypot(x - who.ps.x, z - who.ps.z) });
const live = (A, kind) => A.sim.eq.projectiles.filter(p => p.kind === kind && !p.dead);
// Fires `who`'s gun at (x, z) for `seconds`, the way the phone would: stepPlayer, then applyShot.
function shootAt(A, who, x, z, seconds) {
  const inp = { ...IDLE, aim: Math.atan2(z - who.ps.z, x - who.ps.x), aiming: true, fire: false };
  for (let t = 0; t < 0.6; t += STEP) { stepPlayer(who.ps, inp, STEP, A.sim.map, () => 0.5); A.sim.step(STEP); }
  inp.fire = true;
  run(A, seconds, () => { inp.aim = Math.atan2(z - who.ps.z, x - who.ps.x); for (const s of stepPlayer(who.ps, inp, STEP, A.sim.map, () => 0.5)) A.sim.applyShot(who.id, s, 0); });
}
const dmgTo = (events, id, kind) => events.filter(e => e.t === 'hit' && e.target === id && (!kind || e.eq === kind)).reduce((n, e) => n + e.dmg, 0);

/* ---------------- Data, wire, saves ---------------- */

test('ten new items, appended: old ids keep their wire positions, every slot fits its 4 bits', () => {
  assert.deepEqual(Object.keys(TACTICALS), [...OLD_T, ...NEW_T]);
  assert.deepEqual(Object.keys(LETHALS), [...OLD_L, ...NEW_L]);
  assert.ok(Object.keys(TACTICALS).length <= 16 && Object.keys(LETHALS).length <= 16);
  for (const id of [...NEW_T, ...NEW_L, ...OLD_T, ...OLD_L]) {
    const it = TACTICALS[id] ?? LETHALS[id];
    assert.ok(it.job && it.counter && it.desc && it.name, `${id} has a job, a counter and a line`);
    assert.ok(EQUIPMENT[id], `${id} has behaviour`);
    assert.ok(hasIcon(id), `${id} has an icon`);
  }
});

test('unlock levels, mastery tracks with real tiers, and an unlock challenge for Blackout', () => {
  for (const [kind, ids] of [['tactical', NEW_T], ['lethal', NEW_L]]) {
    for (const id of ids) {
      const lvl = itemUnlockLevel(kind, id);
      assert.ok(lvl >= 3 && lvl <= 17, `${id} unlocks at ${lvl}`);
      assert.ok(UNLOCK_SCHEDULE.some(u => u.kind === kind && u.id === id));
      const track = MASTERY_TRACKS.find(t => t.id === id);
      assert.ok(track && track.tiers.length === 4, `${id} has a 4-tier track`);
      assert.ok(!track.tiers[0].label.startsWith('Use '), `${id} has its own goals, not the fallback`);
    }
  }
  const s = blankSave(); s.xp = s.totalXp = PLAYER_CURVE.floor(20); s.peakLevel = 20;
  assert.ok(itemOpen(s, 'lethal', 'charge') && !itemOpen(s, 'tactical', 'blackout'), 'Blackout also needs its challenge');
});

test('a save with new gear round-trips through an SY4 code; an old loadout keeps its picks', () => {
  const n = blankSave(); n.xp = n.totalXp = PLAYER_CURVE.floor(30); n.peakLevel = 30;
  n.loadouts[0] = cleanLoadout({ name: 'Gear', primary: 'ar', secondary: 'pistol', perks: ['marathon', 'scavenger', 'tracker'], tactical: 'bulwark', lethal: 'charge', streaks: ['uav', 'turret', 'gunship'] }, 0);
  n.loadouts[1] = cleanLoadout({ name: 'Old', primary: 'smg', perks: ['marathon', 'scavenger', 'tracker'], tactical: 'shock', lethal: 'drill', streaks: ['uav', 'turret', 'gunship'] }, 1);
  const code = encodeSave(sanitizeSave(n));
  assert.ok(code.startsWith('SY4.'));
  const back = decodeSave(code);
  assert.ok(back.ok);
  assert.equal(back.save.loadouts[0].tactical, 'bulwark'); assert.equal(back.save.loadouts[0].lethal, 'charge');
  assert.equal(back.save.loadouts[1].tactical, 'shock'); assert.equal(back.save.loadouts[1].lethal, 'drill');
});

test('wire: new kinds, the attached flag and a Blackout jam survive a snapshot; a guest map gets the Bulwark wall', () => {
  const A = arena({ a: { tactical: 'bulwark', lethal: 'sticky' }, v: { tactical: 'smoke' }, dist: 9 });
  throwAt(A, A.h, 'tactical', LANE.x + 3, LANE.z, 3);
  throwAt(A, A.h, 'lethal', A.v.ps.x, A.v.ps.z);
  A.v.jamT = 3;
  run(A, 0.9);
  const map2 = { ...MAP, walls: MAP.walls.filter(w => w.kind !== 'bulwark'), _cover: undefined };
  const guest = new Sim({ roster: A.sim.roster ?? A.sim.players.map(p => ({ id: p.id, name: p.name, team: p.team, isBot: p.isBot, skill: p.skill, primary: p.primary, camo: p.camo, loadout: p.loadout })), map: map2, seed: 7 });
  const before = map2.walls.length;
  const view = guest.decodeSnapshot(A.sim.encodeSnapshot(), A.v.id);
  assert.ok(view.projectiles.some(p => p.kind === 'bulwark' && p.stuck), 'bulwark on the wire');
  assert.ok(view.projectiles.some(p => p.kind === 'sticky' && p.attached), 'the sticky rides the victim');
  assert.ok(view.jammed, 'the jammed guest sees a jammed radar');
  assert.equal(map2.walls.length, before + 1, 'the guest map has the shield');
  assert.ok(map2.walls.some(w => w.kind === 'bulwark' && !w.blocksBullet && w.blocksMove));
  syncCover(map2, []);
  assert.equal(map2.walls.length, before);
});

/* ---------------- Every new item does its job, and its counter works ---------------- */

test('Snapshot: reveals an enemy behind it through walls; Cold Blooded halves it, Blank Slate ignores it', () => {
  const marks = perks => {
    const A = arena({ a: { tactical: 'snapshot' }, v: { perks, pro: perks.includes('coldblood') && perks.pro ? ['coldblood'] : [] }, dist: 9 });
    throwAt(A, A.h, 'tactical', LANE.x + 6, LANE.z);
    run(A, 1.6);
    return { e: A.events.find(e => e.t === 'marked' && e.id === A.v.id), A };
  };
  const plain = marks(['marathon', 'scavenger', 'tracker']);
  assert.ok(plain.e && plain.e.kind === 'snapshot' && plain.A.v.markT > 2, 'marked for its full 3 s');
  const cold = marks(['marathon', 'scavenger', 'coldblood']);
  assert.ok(cold.e && cold.e.dur <= 1.6, `Cold Blooded halves it (${cold.e?.dur})`);
  const A = arena({ a: { tactical: 'snapshot' }, v: { perks: ['marathon', 'scavenger', 'coldblood'], pro: ['coldblood'] }, dist: 9 });
  throwAt(A, A.h, 'tactical', LANE.x + 6, LANE.z);
  run(A, 1.6);
  assert.ok(!A.events.some(e => e.t === 'marked' && e.id === A.v.id), 'Blank Slate is never marked');
});

test('Blackout: jams an enemy (no equipment), fries their device; Engineer is immune', () => {
  const A = arena({ a: { tactical: 'blackout' }, v: { lethal: 'mine' }, dist: 8 });
  throwAt(A, A.v, 'lethal', A.v.ps.x - 1.5, A.v.ps.z, 1.5);
  run(A, 1.5);
  throwAt(A, A.h, 'tactical', A.v.ps.x - 0.8, A.v.ps.z);
  run(A, 1.6);
  assert.ok(A.events.some(e => e.t === 'jammed' && e.id === A.v.id) && A.v.jamT > 3, 'jammed');
  assert.ok(A.events.some(e => e.t === 'fried' && e.src === 'blackout'), 'their mine is fried');
  A.v.ps.lethalLeft = 1;
  assert.equal(throwAt(A, A.v, 'lethal', A.h.ps.x, A.h.ps.z), false, 'a jammed player cannot throw');
  const B = arena({ a: { tactical: 'blackout' }, v: { perks: ['marathon', 'scavenger', 'engineer'] }, dist: 8 });
  throwAt(B, B.h, 'tactical', B.v.ps.x - 0.8, B.v.ps.z);
  run(B, 1.6);
  assert.equal(B.v.jamT, 0, 'Engineer shrugs it off');
});

test('Bulwark: stands as waist-high cover, stops enemy rounds; explosives break it faster than bullets; it goes', () => {
  const A = arena({ a: { tactical: 'bulwark' }, v: { lethal: 'frag' }, dist: 12 });
  const walls = A.sim.map.walls.length;
  throwAt(A, A.h, 'tactical', LANE.x + 2, LANE.z, 2);
  run(A, 1);
  const b = live(A, 'bulwark')[0];
  assert.ok(b && b.stuck && A.sim.map.walls.length === walls + 1, 'a wall went up');
  const hp0 = A.h.hp;
  shootAt(A, A.v, A.h.ps.x, A.h.ps.z, 1.2);
  assert.equal(A.h.hp, hp0, 'the thrower behind it takes nothing');
  assert.ok(b.hp < EQUIPMENT.bulwark.cover.hp, 'the shield soaked it');
  const afterGun = b.hp;
  throwAt(A, A.v, 'lethal', b.x + 1.2, b.z);
  run(A, 2.6);
  assert.ok(b.dead || afterGun - b.hp > 300, 'a frag next to it tears it up');
  run(A, 26);
  assert.equal(A.sim.map.walls.length, walls, 'the wall is gone with it');
});

test('Tagger: sticks to the enemy it hits and shows them for 8 s; Blank Slate ignores it', () => {
  const A = arena({ a: { tactical: 'tagger' }, dist: 7 });
  throwAt(A, A.h, 'tactical', A.v.ps.x, A.v.ps.z, 8);
  run(A, 1);
  assert.ok(A.events.some(e => e.t === 'stuck' && e.id === A.v.id && e.kind === 'tagger'));
  assert.ok(A.v.markT > 6, `marked ${A.v.markT}`);
  A.v.ps.x += 4;
  run(A, 0.2);
  assert.ok(Math.abs(live(A, 'tagger')[0].x - A.v.ps.x) < 0.01, 'the dart rides along');
  const B = arena({ a: { tactical: 'tagger' }, v: { perks: ['marathon', 'scavenger', 'coldblood'], pro: ['coldblood'] }, dist: 7 });
  throwAt(B, B.h, 'tactical', B.v.ps.x, B.v.ps.z, 8);
  run(B, 1);
  assert.equal(B.v.markT, 0);
});

test('Medpack: heals the thrower and teammates in reach; gunfire destroys it', () => {
  const A = arena({ a: { tactical: 'medpack' }, dist: 14 });
  A.h.hp = 30;
  throwAt(A, A.h, 'tactical', A.h.ps.x + 1.2, A.h.ps.z, 1.2);
  run(A, 3);
  assert.ok(A.h.hp >= 60, `healed to ${A.h.hp}`);
  assert.ok(A.events.some(e => e.t === 'heal' && e.kind === 'medpack' && e.by === 'h1'));
  const m = live(A, 'medpack')[0];
  shootAt(A, A.v, m.x, m.z, 1);
  assert.ok(m.dead && A.events.some(e => e.t === 'popped' && e.kind === 'medpack'), 'shot dead');
});

test('Satchel: sticks, the second Lethal tap sets it off (no count spent); shooting it first kills it', () => {
  const A = arena({ a: { lethal: 'charge' }, dist: 9 });
  throwAt(A, A.h, 'lethal', A.v.ps.x - 1, A.v.ps.z);
  run(A, 1.5);
  assert.equal(A.h.ps.lethalLeft, 0);
  assert.equal(live(A, 'charge').length, 1);
  assert.ok(throwAt(A, A.h, 'lethal', 0, 0), 'the tap is accepted as a detonation');
  run(A, 0.3);
  assert.ok(A.events.some(e => e.t === 'bang' && e.kind === 'charge'));
  assert.ok(!A.v.alive || dmgTo(A.events, A.v.id, 'charge') >= 100, 'the enemy on it is dead');
  const B = arena({ a: { lethal: 'charge' }, dist: 12 });
  throwAt(B, B.h, 'lethal', B.v.ps.x - 4, B.v.ps.z);
  run(B, 1.2);
  const c = live(B, 'charge')[0];
  shootAt(B, B.v, c.x, c.z, 1);
  assert.ok(c.dead && B.events.some(e => e.t === 'popped' && e.kind === 'charge'), 'shot before it went');
  throwAt(B, B.h, 'lethal', 0, 0);
  run(B, 0.3);
  assert.ok(!B.events.some(e => e.t === 'bang' && e.kind === 'charge'), 'nothing left to set off');
});

test('Thermite: sticks and burns a tight circle; Tac Mask halves the burn; it melts devices', () => {
  const burn = perks => {
    const A = arena({ a: { lethal: 'thermite' }, v: { perks, tactical: 'sensor' }, dist: 9 });
    A.v.hp = 1000;
    throwAt(A, A.v, 'tactical', A.v.ps.x - 1, A.v.ps.z, 1);
    run(A, 1);
    throwAt(A, A.h, 'lethal', A.v.ps.x - 0.5, A.v.ps.z);
    run(A, 3);
    return A;
  };
  const A = burn(['marathon', 'scavenger', 'tracker']);
  const d = dmgTo(A.events, A.v.id, 'thermite');
  assert.ok(d > 60, `burned ${d}`);
  assert.ok(A.events.some(e => e.t === 'fried' && e.src === 'thermite'), 'the Sensor melted');
  const M = burn(['tacmask', 'scavenger', 'tracker']);
  const dm = dmgTo(M.events, M.v.id, 'thermite');
  assert.ok(dm < d * 0.6, `Tac Mask ${dm} vs ${d}`);
  // Tight: a step outside the circle is safe.
  const F = arena({ a: { lethal: 'thermite' }, dist: 9 });
  throwAt(F, F.h, 'lethal', F.v.ps.x - 3.2, F.v.ps.z);
  run(F, 3);
  assert.equal(dmgTo(F.events, F.v.id, 'thermite'), 0);
});

test('Tripwire: a beam across the lane blows on whoever crosses it; Cold Blooded slips past the far end', () => {
  const cross = perks => {
    const A = arena({ a: { lethal: 'tripwire' }, v: { perks }, dist: 12 });
    throwAt(A, A.h, 'lethal', LANE.x + 5, LANE.z, 5);
    run(A, 1.6);
    const t = live(A, 'tripwire')[0];
    const b = tripBeam(A.sim.map, t.x, t.z, t.vx, t.vz);
    assert.ok(Math.hypot(b.x1 - b.x0, b.z1 - b.z0) > 4, 'the beam spans the lane');
    A.v.ps.x = LANE.x + 8; A.v.ps.z = LANE.z + 2.6;     // Crosses near the beam's end, 2.6 m from the anchor.
    run(A, 1.2, () => { A.v.ps.x -= 5 * STEP; });
    return A;
  };
  assert.ok(cross(['marathon', 'scavenger', 'tracker']).events.some(e => e.t === 'bang' && e.kind === 'tripwire'), 'blown');
  assert.ok(!cross(['marathon', 'scavenger', 'coldblood']).events.some(e => e.t === 'bang' && e.kind === 'tripwire'), 'Cold Blooded passes');
});

test('Crawler: chases a nearby enemy it can see and blows on them; a sprinting enemy outruns it; gunfire kills it', () => {
  const A = arena({ a: { lethal: 'crawler' }, dist: 11 });
  throwAt(A, A.h, 'lethal', A.v.ps.x - 5, A.v.ps.z);
  run(A, 4);
  assert.ok(A.events.some(e => e.t === 'bang' && e.kind === 'crawler'));
  assert.ok(dmgTo(A.events, A.v.id, 'crawler') > 60);
  const B = arena({ a: { lethal: 'crawler' }, dist: 11 });
  throwAt(B, B.h, 'lethal', B.v.ps.x - 5, B.v.ps.z);
  run(B, 7.5, () => { B.v.ps.x += 7.9 * STEP; });      // A full sprint east.
  assert.equal(dmgTo(B.events, B.v.id, 'crawler'), 0, 'outrun');
  const C = arena({ a: { lethal: 'crawler' }, dist: 14 });
  throwAt(C, C.h, 'lethal', C.v.ps.x - 9.5, C.v.ps.z);
  run(C, 1.1);
  const c = live(C, 'crawler')[0];
  shootAt(C, C.v, c.x, c.z, 0.8);
  assert.ok(C.events.some(e => e.t === 'popped' && e.kind === 'crawler'), 'shot');
});

test('Shiv: 60 to the front, a kill in the back, and its owner picks it back up', () => {
  const A = arena({ a: { lethal: 'shiv' }, dist: 7 });
  throwAt(A, A.h, 'lethal', A.v.ps.x, A.v.ps.z);
  run(A, 0.6);
  assert.equal(dmgTo(A.events, A.v.id, 'shiv'), 60);
  const B = arena({ a: { lethal: 'shiv' }, dist: 7 });
  B.v.ps.aim = 0;                                         // Facing away.
  throwAt(B, B.h, 'lethal', B.v.ps.x, B.v.ps.z);
  run(B, 0.6);
  assert.ok(!B.v.alive, 'one in the back kills');
  assert.equal(B.h.ps.lethalLeft, 1);
  const k = live(B, 'shiv')[0];
  B.h.ps.x = k.x; B.h.ps.z = k.z;
  run(B, 0.3);
  assert.equal(B.h.ps.lethalLeft, 2, 'picked back up');
  assert.ok(B.events.some(e => e.t === 'pickup' && e.id === 'h1'));
});

/* ---------------- The reworked old ones ---------------- */

test('Sticky sticks to the enemy it hits, rides them, and kills; Flak survives it', () => {
  const stick = perks => {
    const A = arena({ a: { lethal: 'sticky' }, v: { perks }, dist: 8 });
    throwAt(A, A.h, 'lethal', A.v.ps.x, A.v.ps.z);
    run(A, 2.4, t => { if (t > 1) A.v.ps.z += 2 * STEP; });
    return A;
  };
  const A = stick(['marathon', 'scavenger', 'tracker']);
  assert.ok(A.events.some(e => e.t === 'stuck' && e.id === A.v.id && e.kind === 'sticky'));
  assert.ok(!A.v.alive, 'killed where they ran to');
  assert.ok(stick(['flak', 'scavenger', 'tracker']).v.alive, 'Flak lives through it');
});

test('Sensor is planted and pings again and again; Trophy stops three throws; Decoy pings carry a team', () => {
  const A = arena({ a: { tactical: 'sensor' }, dist: 8 });
  throwAt(A, A.h, 'tactical', LANE.x + 3, LANE.z, 3);
  run(A, 8);
  assert.ok(A.events.filter(e => e.t === 'pulse' && e.kind === 'sensor').length >= 3);
  const B = arena({ a: { lethal: 'frag' }, v: { tactical: 'trophy' }, dist: 8 });
  throwAt(B, B.v, 'tactical', B.v.ps.x - 1, B.v.ps.z, 1);
  run(B, 1);
  B.h.ps.lethalLeft = 5;
  for (let i = 0; i < 4; i++) { throwAt(B, B.h, 'lethal', B.v.ps.x - 1, B.v.ps.z); run(B, 1.2); }
  assert.equal(B.events.filter(e => e.t === 'zap').length, 3, 'three charges');
  const C = arena({ a: { tactical: 'decoy' }, dist: 8 });
  throwAt(C, C.h, 'tactical', LANE.x + 4, LANE.z);
  run(C, 2);
  assert.ok(C.events.some(e => e.t === 'decoy' && e.team === C.h.team));
});

test('every shootable device dies to gunfire; nobody can shoot their own team\'s', () => {
  for (const kind of ['mine', 'claymore', 'tripwire', 'sensor', 'charge', 'medpack', 'trophy', 'decoy']) {
    const slot = TACTICALS[kind] ? 'tactical' : 'lethal';
    const A = arena({ a: { [slot]: kind }, dist: 14 });
    throwAt(A, A.h, slot, LANE.x + 6, LANE.z + 2.4);   // Off the line between the two, so nobody shoots the other.
    run(A, 1.5);
    const d = live(A, kind)[0];
    assert.ok(d && SHOOTABLE.has(kind), kind);
    shootAt(A, A.h, d.x, d.z, 0.5);
    assert.ok(!d.dead, `${kind}: own team's survives`);
    shootAt(A, A.v, d.x, d.z, 1);
    assert.ok(d.dead, `${kind}: shot by the enemy`);
  }
});

test('telemetry keeps equipment rows: uses, kills, damage and effects', () => {
  const A = arena({ a: { lethal: 'charge', tactical: 'snapshot' }, dist: 9 });
  const tel = new MatchTelemetry({ localId: 'h1' });
  throwAt(A, A.h, 'tactical', LANE.x + 6, LANE.z);
  throwAt(A, A.h, 'lethal', A.v.ps.x - 1, A.v.ps.z);
  run(A, 1.5);
  throwAt(A, A.h, 'lethal', 0, 0);
  run(A, 0.4);
  tel.onEvents(A.events, A.sim.getView('h1'));
  const agg = { g: { a: tel.scopes.a }, pm: { a: 1 } };
  const [snap, charge] = gearRows(agg, 'a', ['snapshot', 'charge']);
  assert.equal(snap.uses, 1); assert.ok(snap.effects >= 1);
  assert.equal(charge.uses, 1); assert.equal(charge.kills, 1); assert.ok(charge.dmg > 0);
  assert.ok(tel.scopes.a[EQ_PREFIX + 'charge']);
});

test('mastery counts the new stats: reveals, jams, tags, heals, melts, back kills', () => {
  const A = arena({ a: { tactical: 'tagger', lethal: 'shiv' }, dist: 7 });
  const mt = new MasteryTracker('h1', { loadout: { operator: null } });
  A.v.ps.aim = 0;
  throwAt(A, A.h, 'tactical', A.v.ps.x, A.v.ps.z, 8);
  run(A, 0.5);
  throwAt(A, A.h, 'lethal', A.v.ps.x, A.v.ps.z);
  run(A, 0.5);
  mt.onEvents(A.events, A.sim.getView('h1'));
  const g = mt.gains().tracks;
  assert.equal(g.tagger?.tagged, 1); assert.equal(g.tagger?.markKills, 1);
  assert.equal(g.shiv?.backKills, 1); assert.equal(g.shiv?.kills, 1);
});

/* ---------------- Bots, every mode ---------------- */

// A bot match where every bot carries `tac` and `leth` (or the normal deal when both are null).
function botMatch({ mode = 'tdm', map = 'railyard', secs = 60, tac = null, leth = null, seed = 3 } = {}) {
  const roster = buildRoster([], { botSkill: 'mixed', mapId: map, mode, seed });
  if (tac || leth) for (const r of roster) { r.loadout = normalizeLoadout({ ...r.loadout, tactical: tac ?? r.loadout.tactical, lethal: leth ?? r.loadout.lethal }); }
  const sim = new Sim({ roster, map, seed, mode });
  const ev = [];
  let dodges = 0;
  const seen = new Set();
  for (let t = 0; t < secs * SIM_HZ; t++) {
    sim.step(STEP);
    for (const e of sim.drainEvents()) ev.push(e);
    if (t % 6 === 0) for (const p of sim.players) if (p.bot?.dodgeId != null && p.bot.dodgeRoll && !seen.has(p.id + ':' + p.bot.dodgeId)) { seen.add(p.id + ':' + p.bot.dodgeId); dodges++; }
  }
  return { sim, ev, dodges };
}

if (!QUICK) {
  test('bots use every new item (each in a 60 s match where everyone carries it) and the old ones too', () => {
    const out = [];
    for (const id of [...NEW_T, ...NEW_L, 'sensor', 'trophy', 'sticky', 'claymore', 'mine']) {
      const tac = TACTICALS[id] ? id : null, leth = LETHALS[id] ? id : null;
      const { ev } = botMatch({ tac, leth, mode: 'dom', map: 'railyard', seed: 5 });
      const uses = ev.filter(e => e.t === 'throw' && e.kind === id).length;
      const det = ev.filter(e => e.t === 'bang' && e.kind === id).length;
      const fx = ev.filter(e => (e.kind === id || e.src === id) && ['marked', 'jammed', 'stuck', 'heal', 'gear', 'fried', 'pulse'].includes(e.t)).length;
      const kills = ev.filter(e => e.t === 'kill' && e.equip === id).length;
      out.push(`${id} ${uses}/${det}/${fx}/${kills}`);
      assert.ok(uses >= 3, `${id}: bots threw it ${uses} times`);
      if (id === 'charge') assert.ok(det >= 1, 'bots set off their Satchels');
    }
    console.log(`     uses/bangs/effects/kills: ${out.join('  ')}`);
  });

  test('bots react: run from live grenades, shoot devices they can see', () => {
    const frag = botMatch({ leth: 'frag', mode: 'tdm', seed: 8 });
    assert.ok(frag.dodges >= 3, `dodged ${frag.dodges} grenades`);
    const dev = botMatch({ leth: 'claymore', tac: 'sensor', mode: 'dom', seed: 9 });
    const popped = dev.ev.filter(e => e.t === 'popped' && e.src === 'gun').length;
    assert.ok(popped >= 2, `shot ${popped} devices`);
    const therm = botMatch({ leth: 'thermite', mode: 'tdm', seed: 4 });
    const burned = therm.ev.filter(e => e.t === 'hit' && e.eq === 'thermite').length;
    assert.ok(burned > 0 && therm.dodges >= 1, `backed off thermite (${therm.dodges} dodges, ${burned} burn ticks)`);
  });

  test('every mode runs with all the gear dealt: S&D, CTF, FFA, Ground War', () => {
    const want = new Set([...NEW_T, ...NEW_L]);
    const thrown = new Set();
    for (const [mode, map] of [['snd', 'railyard'], ['ctf', 'pier'], ['ffa', 'foundry'], ['gwtdm', MODES.gwtdm?.maps?.[0] ?? 'canyon'], ['gwdom', MODES.gwdom?.maps?.[0] ?? 'canyon']]) {
      for (let k = 0; k < 2; k++) {
        const { sim, ev } = botMatch({ mode, map, secs: 60, seed: 11 + k });
        for (const e of ev) if (e.t === 'throw') thrown.add(e.kind);
        assert.ok(ev.some(e => e.t === 'kill'), `${mode}: kills happen`);
        assert.ok(!sim.eq.projectiles.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z)), `${mode}: nothing flew off`);
      }
    }
    const missing = [...want].filter(k => !thrown.has(k));
    assert.ok(missing.length <= 2, `thrown across the modes; never: ${missing.join(', ')}`);
  });
}

console.log(`\n${passed} checks passed`);
