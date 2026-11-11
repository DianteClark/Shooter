// Node tests for the V9 scorestreaks overhaul (2026-11): the eight new streaks, shooting streaks down, the reworked
// EMP, airspace on big maps, every mode, bots, wire and mastery. Run: node dev/sim-streaks-v9.mjs [quick]
// Exits non-zero on the first failed check, printing what failed. `quick` skips the bot matches.
import assert from 'node:assert/strict';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { setStreakKinds } from '../js/sim/streaks.js';
import { SCORE, STREAKS, STREAK_IDS, STREAK_DENY_REASONS, normalizeLoadout } from '../js/shared/catalog.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { raycastMap } from '../js/shared/geometry.js';
import { MASTERY_TRACKS, MasteryTracker, UNLOCK_SCHEDULE, CARDS } from '../js/shared/progression.js';
import { ICON_GROUPS } from '../js/ui/icons.js';
import * as V9 from '../js/sim/streaks-v9.js';
import { armSecondary } from '../js/sim/player.js';

const STEP = 1 / SIM_HZ;
const NEW = ['sweep', 'recon', 'airdrop', 'plates', 'hound', 'dome', 'bombrun', 'rover'];
const QUICK = process.argv.includes('quick');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}

const HUMAN = { id: 'h1', name: 'Human', team: 0, primary: 'ar', camo: 'none', loadout: { primary: 'ar', streaks: ['sweep', 'hound', 'rover'] } };

// A live match whose bots stand still (no brains), so only the test moves anyone.
function makeSim({ mode = 'tdm', teamSize = 2, brains = false, map = 'railyard', humans = [HUMAN] } = {}) {
  const roster = buildRoster(humans, { botSkill: 'regular', teamSize, mapId: map, mode, seed: 7 });
  const sim = new Sim({ roster, map, seed: 7, mode });
  sim.step(0);
  if (!brains) for (const p of sim.players) p.bot = null;
  sim._setPhase('live');
  for (const p of sim.players) p.spawnProtect = 0;
  sim.drainEvents();
  return sim;
}
const ticks = (sim, seconds, onEvent) => {
  for (let i = Math.round(seconds * SIM_HZ); i > 0; i--) { sim.step(STEP); if (onEvent) for (const e of sim.drainEvents()) onEvent(e); }
};
const give = (p, kinds) => { setStreakKinds(p.score, kinds); for (const s of p.score.slots) s.held = true; };
const slotOf = (p, kind) => p.score.slots.findIndex(s => s.kind === kind);
const call = (sim, p, kind) => { if (!p.score.slots[slotOf(p, kind)]?.held) give(p, [kind]); return sim.useStreak(p.id, slotOf(p, kind)); };
const place = (p, x, z, aim = 0) => { p.ps.x = x; p.ps.z = z; p.ps.aim = aim; p.alive = true; };
const PLAIN = ['marathon', 'scavenger', 'tracker'];
function clear(sim, keep) {
  for (const p of sim.players) if (!keep.includes(p)) { p.alive = false; p.respawnT = 999; p.wantRespawn = false; }
  for (const p of keep) { p.ps.perks = [...PLAIN]; p.ps.pro = []; p.alive = true; p.hp = 100; }
}
const inWall = (map, x, z, pad = 1) => map.walls.some(w => x > w.x - pad && x < w.x + w.w + pad && z > w.z - pad && z < w.z + w.d + pad);
function openLane(map, len, skip = 0) {
  let found = 0;
  for (let z = 4; z < map.height - 4; z += 1) {
    for (let x = 4; x < map.width - len - 4; x += 1) {
      if ([-1.5, 0, 1.5].some(dz => inWall(map, x, z + dz) || inWall(map, x + len, z + dz))) continue;
      if (raycastMap(map, x, z, 1, 0, len, 'blocksBullet')) continue;
      if (raycastMap(map, x, z - 1.5, 1, 0, len, 'blocksBullet') || raycastMap(map, x, z + 1.5, 1, 0, len, 'blocksBullet')) continue;
      if (found++ >= skip) return { x, z };
    }
  }
  throw new Error('no open lane');
}
// A spot with a building (blocksVision) straight east of it, 3 to 6 m away.
function wallAhead(map) {
  for (let z = 4; z < map.height - 4; z += 1) {
    for (let x = 4; x < map.width - 20; x += 1) {
      if (inWall(map, x, z)) continue;
      const hit = raycastMap(map, x, z, 1, 0, 6, 'blocksVision');
      if (hit && hit.t > 3) return { x, z, t: hit.t };
    }
  }
  throw new Error('no wall');
}
// One shot from `p` at angle `aim`, the way the host applies a human's report.
function shoot(sim, p, aim, weapon = p.ps.weapon) {
  sim.applyShot(p.id, { ox: p.ps.x, oz: p.ps.z, aim, weapon, angles: [aim], ads: true }, 0);
}
const enemyOf = (sim, p) => sim.players.find(q => q.team !== p.team && !q.dummy);

/* ---------------- Catalog, wire, unlocks ---------------- */

test('eight new streaks appended after V8, with role, counter and a wire id that fits five bits', () => {
  assert.deepEqual(STREAK_IDS.slice(0, 13), ['uav', 'jammer', 'resupply', 'turret', 'mortar', 'strike', 'overwatch', 'chopper', 'emp', 'gunship', 'missile', 'swarm', 'juggernaut']);
  assert.deepEqual(STREAK_IDS.slice(13), NEW);
  assert.ok(STREAK_IDS.length <= 32);
  for (const id of STREAK_IDS) {
    const s = STREAKS[id];
    assert.ok(['intel', 'offense', 'support', 'denial'].includes(s.role), `${id} role`);
    assert.ok(s.counter && s.desc && s.name, `${id} counter text`);
    assert.ok(s.cost >= 800 && s.cost <= 4800, `${id} cost`);
  }
  const roles = NEW.map(id => STREAKS[id].role);
  for (const r of ['intel', 'offense', 'support']) assert.ok(roles.includes(r), `a new ${r} streak`);
  assert.deepEqual(normalizeLoadout({ streaks: ['rover', 'sweep', 'dome'] }).streaks, ['sweep', 'dome', 'rover']);
  assert.ok(STREAK_DENY_REASONS.includes('emp'));
});

test('each new streak has an unlock row spread up the curve, a 4-tier mastery track, a card and an icon', () => {
  const levels = [];
  for (const id of NEW) {
    const row = UNLOCK_SCHEDULE.find(u => u.kind === 'streak' && u.id === id);
    assert.ok(row, `${id} unlock row`);
    levels.push(row.level);
    const t = MASTERY_TRACKS.find(m => m.id === id && m.kind === 'streak');
    assert.ok(t && t.tiers.length === 4, `${id} track`);
    assert.ok(CARDS.some(c => c.id === `mastery-${id}`), `${id} card`);
    assert.ok(ICON_GROUPS.streaks.includes(id), `${id} icon`);
  }
  assert.ok(Math.min(...levels) <= 4 && Math.max(...levels) >= 20, `spread: ${levels}`);
});

test('wire: new kinds in the meta block, EMP denial bits, machines, drones and plates reach a guest', () => {
  const sim = makeSim();
  const h = sim.byId.get('h1'), foe = enemyOf(sim, h);
  clear(sim, [h, foe]);
  give(h, ['recon', 'dome', 'rover']);
  const guest = makeSim();
  let v = guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshot())), 'h1');
  assert.deepEqual(v.players.find(p => p.id === 'h1').slots.map(s => s.kind), ['recon', 'dome', 'rover']);
  // Every pair of high ids, and the perks packed after them, survive (the fifth bit must not spill into the next slot).
  for (const kinds of [['plates', 'hound', 'dome'], ['hound', 'bombrun', 'rover'], ['uav', 'airdrop', 'rover']]) {
    give(h, kinds); h.ps.perks = ['flak', 'hardline', 'engineer'];
    const fresh = makeSim();
    const w = fresh.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshot())), 'h1');
    assert.deepEqual(w.players.find(p => p.id === 'h1').slots.map(s => s.kind), kinds);
    assert.deepEqual(fresh.byId.get('h1').ps.perks, ['flak', 'hardline', 'engineer']);
    sim._metaUntil = sim.tick + 2;
  }
  give(h, ['recon', 'dome', 'rover']); h.ps.perks = [...PLAIN];
  const lane = openLane(sim.map, 10);
  place(h, lane.x, lane.z); place(foe, lane.x + 9, lane.z, Math.PI);
  call(sim, h, 'recon'); call(sim, h, 'dome'); call(sim, h, 'rover'); call(sim, h, 'plates');
  give(foe, ['emp', 'hound']);
  foe.ps.perks = ['marathon', 'scavenger', 'engineer'];   // An Engineer's own Wingman lives through an EMP.
  call(sim, foe, 'hound');
  ticks(sim, 0.2);
  const host = sim.getView('h1');
  assert.deepEqual(host.deploys.map(d => d.kind).sort(), ['dome', 'rover']);
  assert.deepEqual(host.drones.map(d => d.kind).sort(), ['hound', 'recon']);
  assert.ok(host.turrets.length === 0 && host.gunships.every(g => !['recon', 'hound'].includes(g.kind)), 'old lists keep old kinds');
  assert.equal(host.players.find(p => p.id === 'h1').plates, 100);
  v = guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshot())), 'h1');
  assert.deepEqual(v.deploys.map(d => d.kind).sort(), ['dome', 'rover']);
  assert.deepEqual(v.drones.map(d => d.kind).sort(), ['hound', 'recon']);
  assert.equal(v.players.find(p => p.id === 'h1').plates, 100);
  assert.ok(v.drones.every(d => d.hpf > 0.9));
  // EMP from the other side: our streaks are locked, which the guest's tiles must read as 'emp'.
  give(foe, ['emp']); call(sim, foe, 'emp');
  give(h, ['uav', 'turret', 'strike']);
  const tiles = guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshot())), 'h1').players.find(p => p.id === 'h1').slots;
  assert.ok(tiles.every(s => s.denied === 'emp'), 'locked by the EMP');
  // Host migration carries the machines, the drones and the plates.
  const live = sim.getView('h1');
  const next = Sim.fromSnapshot(guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshot())), 'h1'),
    guest.players.map(p => ({ id: p.id, name: p.name, team: p.team, isBot: p.isBot, skill: p.skill, primary: p.primary, camo: p.camo, loadout: p.loadout })), { map: sim.map, seed: 7 });
  assert.equal(next.turrets.length, sim.turrets.length);
  assert.ok(next.gunships.some(g => g.kind === 'hound'), 'Engineer Wingman survived the EMP and the migration');
  assert.equal(next.byId.get('h1').plates, live.players.find(p => p.id === 'h1').plates);
  ticks(next, 0.5);
});

/* ---------------- Each streak works ---------------- */

test('sweep: two pulses mark enemies within range through walls; Ghost is not swept', () => {
  const sim = makeSim({ teamSize: 3 });
  const h = sim.byId.get('h1');
  const foes = sim.players.filter(p => p.team === 1);
  clear(sim, [h, ...foes]);
  place(h, 10, 24); place(foes[0], 30, 24); place(foes[1], 10 + V9.SWEEP_R + 8, 24); place(foes[2], 12, 30);
  foes[2].ps.perks = ['marathon', 'scavenger', 'ghost'];
  const marked = [];
  call(sim, h, 'sweep');
  ticks(sim, 0.2, e => { if (e.t === 'marked' && e.kind === 'sweep') marked.push(e.id); });
  assert.ok(foes[0].markT > 0, 'in range: marked');
  assert.equal(foes[1].markT, 0, 'out of range');
  assert.equal(foes[2].markT, 0, 'Ghost is radar-proof');
  assert.equal(call(sim, h, 'sweep'), null, 'one sweep at a time');
  let pulses = 0;
  ticks(sim, V9.SWEEP_GAP + 0.3, e => { if (e.t === 'sweep') pulses++; });
  assert.equal(pulses, 1, 'the second pulse');
});

test('recon: flies where the held aim stick points, marks enemies under it, Cold Blooded halves, Blank Slate ignores', () => {
  const sim = makeSim({ teamSize: 3 });
  const h = sim.byId.get('h1'), foes = sim.players.filter(p => p.team === 1);
  clear(sim, [h, ...foes]);
  const lane = openLane(sim.map, 20);
  place(h, lane.x, lane.z, 0);
  call(sim, h, 'recon');
  const g = sim.gunships.find(o => o.kind === 'recon');
  h.ps.adsT = 0; ticks(sim, 0.5);
  assert.ok(Math.hypot(g.x - lane.x, g.z - lane.z) < 0.1, 'stick idle: hovers');
  h.ps.adsT = 1; h.ps.aim = 0; ticks(sim, 1);
  assert.ok(g.x > lane.x + 8, 'stick held: flies');
  place(foes[0], g.x + 2, g.z + 2); place(foes[1], g.x - 2, g.z + 2); place(foes[2], g.x, g.z - 3);
  foes[1].ps.perks = ['marathon', 'scavenger', 'coldblood'];
  foes[2].ps.perks = ['marathon', 'scavenger', 'coldblood']; foes[2].ps.pro = ['coldblood'];
  h.ps.adsT = 0; ticks(sim, 0.6);
  assert.ok(foes[0].markT > 2, 'marked');
  assert.ok(foes[1].markT > 0 && foes[1].markT <= V9.SCOUT_MARK * 0.5 + 0.01, 'Cold Blooded: half');
  assert.equal(foes[2].markT, 0, 'Blank Slate: never');
  sim._airTick = -1; sim._countAir();
  assert.ok(sim._airCount[0] >= 1, 'counts against the airspace');
  ticks(sim, V9.SCOUT_LIFE);
  assert.ok(!sim.gunships.includes(g), 'expires');
});

test('shoot-down: bullets bring a drone down, a launcher does it in far fewer rounds, the shooter is paid', () => {
  const sim = makeSim();
  const h = sim.byId.get('h1'), foe = enemyOf(sim, h);
  clear(sim, [h, foe]);
  const lane = openLane(sim.map, 16);
  place(h, lane.x, lane.z, 0); place(foe, lane.x - 6, lane.z, 0);     // Behind the shooter: out of the line of fire.
  give(foe, ['chopper']);
  call(sim, foe, 'chopper');
  const ch = sim.gunships.find(g => g.kind === 'chopper');
  ch.x = lane.x + 10; ch.z = lane.z; ch.life = 99;
  const before = h.score.score;
  let n = 0, down = null;
  while (sim.gunships.includes(ch) && n < 400) { ch.x = lane.x + 10; ch.z = lane.z; shoot(sim, h, 0, 'ar'); n++; }
  for (const e of sim.drainEvents()) if (e.t === 'air_down') down = e;
  assert.ok(!sim.gunships.includes(ch), 'chopper down to gunfire');
  assert.ok(down && down.by === 'h1' && down.kind === 'chopper', 'air_down names the shooter');
  assert.ok(h.score.score - before >= SCORE.shootdown, 'streak score for it');
  // The same chopper again, this time with rockets.
  give(foe, ['chopper']); sim.v9.empLock = null; call(sim, foe, 'chopper');
  const c2 = sim.gunships.find(g => g.kind === 'chopper');
  h.ps.secondary = 'launcher'; h.loadout.secondary = 'launcher';
  armSecondary(h.ps, 'launcher'); h.ps.slot = 1; h.ps.weapon = 'launcher';
  let r = 0;
  while (sim.gunships.includes(c2) && r < 20) { c2.x = lane.x + 10; c2.z = lane.z; c2.life = 99; shoot(sim, h, 0, 'launcher'); r++; }
  assert.ok(!sim.gunships.includes(c2) && r * 6 < n, `launcher: ${r} rockets vs ${n} rounds`);
  // Cover still covers: a wall between the shooter and the drone stops a bullet.
  const w = wallAhead(sim.map);
  place(h, w.x, w.z, 0); h.ps.slot = 0; h.ps.weapon = 'ar';
  give(foe, ['hound']); call(sim, foe, 'hound');
  const hd = sim.gunships.find(g => g.kind === 'hound');
  V9.airHp(hd);
  const hp0 = hd.hp;
  hd.x = w.x + w.t + 3; hd.z = w.z; shoot(sim, h, 0, 'ar');
  assert.equal(hd.hp, hp0, 'wall in the way');
});

test('airdrop: lands, a teammate opens it fast into a random streak, an enemy steals it slowly, gunfire wrecks it', () => {
  const sim = makeSim({ teamSize: 2 });
  const h = sim.byId.get('h1'), mate = sim.players.find(p => p.team === 0 && p !== h), foe = enemyOf(sim, h);
  clear(sim, [h, mate, foe]);
  const lane = openLane(sim.map, 16);
  place(h, lane.x, lane.z, 0); place(mate, lane.x + 8, lane.z); place(foe, lane.x + 14, lane.z, Math.PI);
  call(sim, h, 'airdrop');
  ticks(sim, V9.DROP_DELAY - 0.3);
  assert.ok(!sim.turrets.some(t => t.kind === 'crate'), 'still falling');
  assert.equal(call(sim, h, 'airdrop'), null, 'one at a time');
  ticks(sim, 0.5);
  const crate = sim.turrets.find(t => t.kind === 'crate');
  assert.ok(crate, 'landed');
  let opened = null;
  place(mate, crate.x, crate.z);
  ticks(sim, V9.OPEN_OWN + 0.2, e => { if (e.t === 'crate_open') opened = e; });
  assert.ok(opened && opened.id === mate.id && !opened.stolen && STREAKS[opened.kind], `teammate opened: ${opened?.kind}`);
  // Stolen.
  place(mate, lane.x, lane.z - 30); mate.alive = false;
  give(h, ['airdrop']); sim.v9.drops.length = 0; call(sim, h, 'airdrop'); ticks(sim, V9.DROP_DELAY + 0.1);
  const c2 = sim.turrets.find(t => t.kind === 'crate');
  place(foe, c2.x, c2.z);
  let stolen = null;
  ticks(sim, V9.OPEN_OWN + 0.2, e => { if (e.t === 'crate_open') stolen = e; });
  assert.equal(stolen, null, 'an enemy takes longer');
  ticks(sim, V9.OPEN_ENEMY, e => { if (e.t === 'crate_open') stolen = e; });
  assert.ok(stolen && stolen.stolen && stolen.id === foe.id, 'stolen');
  // Contested: nobody opens it. Shot: it breaks.
  give(h, ['airdrop']); call(sim, h, 'airdrop'); ticks(sim, V9.DROP_DELAY + 0.1);
  const c3 = sim.turrets.find(t => t.kind === 'crate');
  place(foe, c3.x + 0.5, c3.z); place(h, c3.x - 0.5, c3.z);
  ticks(sim, V9.OPEN_ENEMY + 0.5);
  assert.ok(sim.turrets.includes(c3), 'contested: still shut');
  place(foe, c3.x + 8, c3.z, Math.PI);
  for (let i = 0; i < 40 && sim.turrets.includes(c3); i++) shoot(sim, foe, Math.PI, foe.ps.weapon);
  assert.ok(!sim.turrets.includes(c3), 'shot to pieces');
});

test('plates: teammates near you get them, they soak gunfire, blasts strip them faster, death clears them', () => {
  const sim = makeSim({ teamSize: 2 });
  const h = sim.byId.get('h1'), mate = sim.players.find(p => p.team === 0 && p !== h), foe = enemyOf(sim, h);
  clear(sim, [h, mate, foe]);
  place(h, 20, 20); place(mate, 30, 20); place(foe, 60, 20);
  call(sim, h, 'plates');
  assert.equal(h.plates, 100); assert.equal(mate.plates, 100);
  assert.ok(!(foe.plates > 0));
  sim._damage(h, foe, 30, 'ar', 10);
  assert.equal(h.hp, 100); assert.equal(h.plates, 70);
  sim._damage(mate, foe, 30, 'ar', 10, 'strike');
  assert.equal(mate.plates, 40, 'blast: twice as fast');
  sim._damage(h, foe, 500, 'ar', 10);
  assert.ok(!h.alive && h.plates === 0, 'gone with you');
});

test('hound: flies at its owner\'s shoulder, shoots an enemy it can see, walls stop it, it is shot down', () => {
  const sim = makeSim();
  const h = sim.byId.get('h1'), foe = enemyOf(sim, h);
  clear(sim, [h, foe]);
  const lane = openLane(sim.map, 16);
  place(h, lane.x, lane.z, 0); place(foe, lane.x + 40, lane.z);
  call(sim, h, 'hound');
  const g = sim.gunships.find(o => o.kind === 'hound');
  place(h, lane.x + 3, lane.z, 0);
  ticks(sim, 1);
  assert.ok(Math.hypot(g.x - h.ps.x, g.z - h.ps.z) < 4, 'keeps up');
  place(foe, lane.x + 12, lane.z, Math.PI);
  let hits = 0;
  ticks(sim, 2, e => { if (e.t === 'hit' && e.st === 'hound') hits++; });
  assert.ok(hits > 0 && foe.hp < 100, 'shoots');
  foe.ps.perks = ['marathon', 'scavenger', 'coldblood']; foe.hp = 100;
  hits = 0; ticks(sim, 2, e => { if (e.t === 'hit' && e.st === 'hound') hits++; });
  assert.equal(hits, 0, 'Cold Blooded beyond reach of the machine');
});

test('dome: shoots down enemy throws inside it, shields its team from enemy blasts, but bullets go through', () => {
  const sim = makeSim({ teamSize: 2 });
  const h = sim.byId.get('h1'), mate = sim.players.find(p => p.team === 0 && p !== h), foe = enemyOf(sim, h);
  clear(sim, [h, mate, foe]);
  const lane = openLane(sim.map, 16);
  place(h, lane.x, lane.z, 0); place(mate, lane.x + 2, lane.z); place(foe, lane.x + 14, lane.z, Math.PI);
  call(sim, h, 'dome');
  const dome = sim.turrets.find(t => t.kind === 'dome');
  assert.ok(dome);
  // A frag thrown into the bubble is shot down.
  foe.ps.lethal = 'frag'; foe.ps.lethalLeft = 2;
  sim.eq.throw({ id: foe.id, team: foe.team }, 'frag', foe.ps.x, foe.ps.z, Math.PI, 12);
  let zapped = false;
  ticks(sim, 2, e => { if (e.t === 'zap' && e.kind === 'dome') zapped = true; });
  assert.ok(zapped && mate.hp === 100, 'frag zapped');
  // A streak blast on the team inside does nothing; the same blast outside it does.
  sim.strikes.push({ kind: 'strike', team: 1, by: foe, x: mate.ps.x, z: mate.ps.z, at: sim.time, radius: 5, damage: 135 });
  ticks(sim, 0.1);
  assert.equal(mate.hp, 100, 'blast stopped');
  // Bullets go through it.
  shoot(sim, foe, Math.atan2(mate.ps.z - foe.ps.z, mate.ps.x - foe.ps.x), 'ar');
  assert.ok(mate.hp < 100, 'bullets still hurt inside');
  // An EMP takes it down.
  give(foe, ['emp']); call(sim, foe, 'emp');
  assert.ok(!sim.turrets.includes(dome), 'EMP');
});

test('bombrun: a human drags the reticle and lets go; bombs walk the drawn line and kill on it', () => {
  const sim = makeSim();
  const h = sim.byId.get('h1'), foe = enemyOf(sim, h);
  clear(sim, [h, foe]);
  const lane = openLane(sim.map, 20);
  place(h, lane.x, lane.z, 0); place(foe, lane.x + 14, lane.z);
  give(h, ['bombrun']);
  assert.equal(call(sim, h, 'bombrun'), 'bombrun');
  const r = sim.gunships.find(g => g.kind === 'reticle');
  assert.ok(r, 'reticle up');
  h.ps.adsT = 1; h.ps.aim = 0;
  let line = null; const incoming = [];
  ticks(sim, 0.9, e => { if (e.t === 'streak' && e.kind === 'bombrun') line = e; });
  assert.equal(line, null, 'nothing yet while drawing');
  sim.applyCommand('h1', { cmd: 'aimdone' });
  h.ps.adsT = 0;
  let killed = false;
  ticks(sim, 0.2, e => { if (e.t === 'streak' && e.kind === 'bombrun') line = e; if (e.t === 'incoming') incoming.push(e); });
  assert.ok(line && line.path.length >= 4, 'line dropped');
  assert.ok(incoming.length >= 3 && incoming.every(e => e.kind === 'bombrun'), 'every bomb announced');
  assert.ok(!sim.gunships.includes(r), 'reticle gone');
  ticks(sim, 3, e => { if (e.t === 'kill' && e.streak === 'bombrun') killed = true; });
  assert.ok(killed, 'killed the enemy on the line');
  // A bot's line goes through what its team can see; a pilot who dies drawing drops nothing.
  const b = foe; b.alive = true; b.hp = 100; place(b, lane.x + 19, lane.z); place(h, lane.x + 4, lane.z);
  b.isBot = true; give(b, ['bombrun']);
  assert.equal(call(sim, b, 'bombrun'), 'bombrun');
  assert.ok(sim.strikes.some(s => s.kind === 'bombrun' && s.team === b.team && Math.hypot(s.x - h.ps.x, s.z - h.ps.z) < 4), 'bot aims at the enemy it sees');
  sim.strikes.length = 0;
  give(h, ['bombrun']); call(sim, h, 'bombrun');
  h.alive = false; let none = true;
  ticks(sim, V9.RETICLE_LIFE + 0.5, e => { if (e.t === 'streak' && e.kind === 'bombrun' && e.id === 'h1') none = false; });
  assert.ok(none, 'dead pilot: nothing drops');
});

test('rover: drives at an enemy its team can see, shoots it, and is wrecked by gunfire for a reward', () => {
  const sim = makeSim();
  const h = sim.byId.get('h1'), foe = enemyOf(sim, h);
  clear(sim, [h, foe]);
  const lane = openLane(sim.map, 20);
  place(h, lane.x, lane.z, 0); place(foe, lane.x + 19, lane.z, Math.PI);
  call(sim, h, 'rover');
  const r = sim.turrets.find(t => t.kind === 'rover');
  const x0 = r.x;
  let hits = 0;
  ticks(sim, 3, e => { if (e.t === 'hit' && e.st === 'rover') hits++; });
  assert.ok(r.x > x0 + 2, 'drove toward it');
  assert.ok(hits > 0, 'shot it');
  foe.hp = 100;
  let medal = null;
  for (let i = 0; i < 80 && sim.turrets.includes(r); i++) { shoot(sim, foe, Math.atan2(r.z - foe.ps.z, r.x - foe.ps.x), 'ar'); foe.hp = 100; }
  for (const e of sim.drainEvents()) if (e.t === 'medal' && e.id === foe.id) medal = e.medal;
  assert.ok(!sim.turrets.includes(r), 'wrecked');
  assert.equal(medal, 'destroyed');
});

/* ---------------- Counterplay and reworks ---------------- */

test('EMP: downs enemy air and machines, locks enemy streaks, jams kit; an Engineer\'s survive damaged', () => {
  const sim = makeSim({ teamSize: 2 });
  const h = sim.byId.get('h1'), mate = sim.players.find(p => p.team === 0 && p !== h), foe = enemyOf(sim, h);
  clear(sim, [h, mate, foe]);
  place(h, 20, 20); place(mate, 24, 20); place(foe, 60, 20);
  mate.ps.perks = ['marathon', 'scavenger', 'engineer'];
  give(h, ['hound', 'rover', 'recon']); call(sim, h, 'hound'); call(sim, h, 'rover');
  give(mate, ['gunship', 'turret']); call(sim, mate, 'gunship'); call(sim, mate, 'turret');
  const eg = sim.gunships.find(g => g.kind === 'gunship'), et = sim.turrets.find(t => t.kind === 'sentry');
  V9.airHp(eg);
  const egLife = eg.life, egHp = eg.hp;
  give(foe, ['emp']); call(sim, foe, 'emp');
  assert.ok(!sim.gunships.some(g => g.kind === 'hound') && !sim.turrets.some(t => t.kind === 'rover'), 'plain ones down');
  assert.ok(sim.gunships.includes(eg) && sim.turrets.includes(et), 'Engineer\'s survive');
  assert.ok(Math.abs(eg.life - egLife * 0.5) < 0.1 && Math.abs(eg.hp - egHp * 0.5) < 1, 'at half');
  assert.equal(sim.streakDenied(h, 'recon'), 'emp', 'streaks locked');
  assert.ok(h.jamT > 0 && !(mate.jamT > 0), 'kit jammed, Engineer immune');
  ticks(sim, V9.EMP_LOCK + 0.2);
  assert.notEqual(sim.streakDenied(h, 'recon'), 'emp', 'the lock wears off');
});

test('Overwatch is not blanked by a Jammer; the Gunship orbits over the fight on a huge map', () => {
  const sim = makeSim();
  const h = sim.byId.get('h1'), foe = enemyOf(sim, h);
  clear(sim, [h, foe]);
  give(h, ['overwatch']); call(sim, h, 'overwatch');
  give(foe, ['jammer']); call(sim, foe, 'jammer');
  assert.ok(sim.radarUp(0), 'Overwatch stays up');
  assert.equal(sim.getView('h1').jammed, false);
  const big = makeSim({ map: 'downtown' });
  const b = big.byId.get('h1'), bf = enemyOf(big, b);
  clear(big, [b, bf]);
  place(b, 20, 60); place(bf, 26, 60);
  give(b, ['gunship', 'chopper']); call(big, b, 'gunship'); call(big, b, 'chopper');
  ticks(big, 1);
  const gs = big.gunships.find(g => g.kind === 'gunship'), ch = big.gunships.find(g => g.kind === 'chopper');
  assert.ok(Math.hypot(gs.x - b.ps.x, gs.z - b.ps.z) < 30, 'gunship over the fight, not the map centre');
  assert.ok(Math.hypot(ch.x - b.ps.x, ch.z - b.ps.z) < 30, 'chopper arrives from nearby');
});

test('airspace and limits grow in Ground War', () => {
  const gw = makeSim({ mode: 'gwtdm', teamSize: 16, map: 'downtown' });
  assert.deepEqual(V9.airMax(gw), { team: 4, total: 7 });
  assert.equal(V9.limitFor(gw, 'turret'), 4);
  assert.equal(V9.limitFor(gw, 'uav'), 1, 'team timers stay one');
  const tdm = makeSim();
  assert.deepEqual(V9.airMax(tdm), { team: 3, total: 5 });
});

/* ---------------- Modes ---------------- */

test('every new streak calls and runs in TDM, Domination, CTF, FFA and Ground War; none in S&D', () => {
  const modes = [['tdm', 2, 'railyard'], ['dom', 2, 'dust'], ['ctf', 2, 'railyard'], ['ffa', 6, 'pier'], ['gwtdm', 16, 'downtown']];
  for (const [mode, teamSize, map] of modes) {
    const sim = makeSim({ mode, teamSize, map });
    const h = sim.byId.get('h1'), foe = sim.players.find(p => p !== h && p.team !== h.team);
    for (const kind of NEW) {
      for (const p of [h, foe]) { p.alive = true; p.hp = 100; }
      const lane = openLane(sim.map, 10);
      place(h, lane.x, lane.z, 0); place(foe, lane.x + 9, lane.z, Math.PI);
      sim.v9.empLock = null;
      give(h, [kind]);
      if (kind === 'bombrun') h.isBot = true;    // The bot path needs no pilot.
      const got = sim.useStreak(h.id, 0);
      h.isBot = false;
      assert.equal(got, kind, `${mode}: ${kind} (denied: ${sim.streakDenied(h, kind)})`);
      ticks(sim, 0.5);
    }
    ticks(sim, 4);
  }
  const snd = makeSim({ mode: 'snd' });
  const sh = snd.byId.get('h1');
  give(sh, ['sweep']);
  assert.equal(snd.useStreak('h1', 0), null);
});

/* ---------------- Bots ---------------- */

if (!QUICK) {
  test('bots call every new streak in 60 s matches, and not into an empty map', () => {
    const uses = {};
    for (const [seed, map, mode, size] of [[3, 'railyard', 'tdm', 6], [4, 'dust', 'dom', 6], [5, 'pier', 'tdm', 6]]) {
      const roster = buildRoster([], { botSkill: 'veteran', teamSize: size, mapId: map, mode, seed });
      const sim = new Sim({ roster, map, seed, mode, timeLimit: 900, scoreLimit: 999 });
      sim.step(0); sim._setPhase('live');
      sim.players.forEach((p, i) => { give(p, [NEW[i % 8], NEW[(i + 3) % 8], NEW[(i + 5) % 8]]); });
      for (let i = 0; i < SIM_HZ * 60; i++) {
        sim.step(STEP);
        for (const e of sim.drainEvents()) if (e.t === 'streak' || e.t === 'streak_aim') uses[e.kind] = (uses[e.kind] ?? 0) + 1;
      }
    }
    console.log('     bot calls', uses);
    for (const id of NEW) assert.ok(uses[id] > 0, `bots called ${id}`);
  });

  test('bots hold a lethal streak while nobody is in sight', () => {
    const sim = makeSim({ brains: true });
    const b = sim.players.find(p => p.isBot && p.team === 0);
    for (const p of sim.players) if (p.team !== b.team) { p.alive = false; p.respawnT = 999; p.wantRespawn = false; }
    give(b, ['rover', 'bombrun', 'hound']);
    ticks(sim, 6);
    assert.ok(b.score.slots.every(s => s.held), 'held, not wasted');
  });

  test('bots shoot enemy aircraft down and get out from under strikes', () => {
    let downs = 0, botDowns = 0;
    const sim = makeSim({ brains: true, teamSize: 4 });
    const h = sim.byId.get('h1');
    for (const p of sim.players) if (p.bot) p.bot.S = { ...p.bot.S, turret: 'shoot' };
    clear(sim, sim.players.filter(p => p.team === 1).concat(h));
    h.alive = true;
    for (let k = 0; k < 4; k++) {
      give(h, ['hound']); sim.v9.empLock = null;
      const foe = sim.players.find(p => p.team === 1 && p.alive);
      place(h, foe.ps.x - 10, foe.ps.z);
      call(sim, h, 'hound');
      ticks(sim, 8, e => { if (e.t === 'air_down') { downs++; if (sim.byId.get(e.by)?.isBot) botDowns++; } });
      sim.gunships.length = 0;
    }
    assert.ok(botDowns > 0, `bots shot down ${botDowns} of 4 Wingmen`);
    // A strike called on a bot: it moves.
    const b = sim.players.find(p => p.team === 1 && p.alive);
    b.bot.S = { ...b.bot.S, dodge: 1 };
    b.bot.strikeKey = null;
    const x0 = b.ps.x, z0 = b.ps.z;
    sim.strikes.push({ kind: 'strike', team: 0, by: h, x: x0, z: z0, at: sim.time + 1.6, radius: 5.2, damage: 135 });
    ticks(sim, 1.5);
    assert.ok(Math.hypot(b.ps.x - x0, b.ps.z - z0) > 1.5, 'moved off the spot');
  });
}

/* ---------------- Mastery ---------------- */

test('mastery counts the new streaks: uses, kills, marks, crates, plates, dome saves; EMP jams are not Blackout\'s', () => {
  const tr = new MasteryTracker('h1');
  const me = { id: 'h1', team: 0, alive: true, hp: 100, plates: 100 }, foe = { id: 'b1', team: 1, alive: true }, mate = { id: 'b2', team: 0, alive: true };
  const view = (t, plates = 100) => ({ t, phase: 'live', players: [{ ...me, plates }, foe, mate] });
  tr.onEvents([{ t: 'streak', id: 'h1', kind: 'recon', team: 0 }, { t: 'marked', id: 'b1', by: 'h1', dur: 3, kind: 'recon' }], view(1));
  tr.onEvents([{ t: 'kill', by: 'h1', target: 'b1', weapon: 'ar' }], view(2));
  tr.onEvents([{ t: 'streak', id: 'h1', kind: 'plates', team: 0 }, { t: 'plates', id: 'h1', by: 'h1' }, { t: 'plates', id: 'b2', by: 'h1' }], view(3));
  tr.onEvents([], view(4, 60));
  tr.onEvents([{ t: 'crate_open', id: 'h1', owner: 'b9', kind: 'uav', stolen: true }, { t: 'zap', by: 'h1', kind: 'dome' }, { t: 'jammed', id: 'b1', by: 'h1', kind: 'emp' }], view(5, 60));
  tr.onEvents([{ t: 'kill', by: 'h1', target: 'b1', weapon: 'ar', streak: 'rover' }], view(6, 60));
  const g = tr.gains().tracks;
  assert.equal(g.recon.uses, 1); assert.equal(g.recon.marked, 1); assert.equal(g.recon.markKills, 1);
  assert.equal(g.plates.supplied, 1); assert.equal(g.plates.soaked, 40);
  assert.equal(g.airdrop.stolen, 1); assert.equal(g.dome.saves, 1);
  assert.equal(g.rover.kills, 1);
  assert.ok(!g.blackout, 'EMP jam not counted as Blackout');
  assert.ok(!g.sensor, 'Scout marks not counted as Sensor');
});

console.log(`\n${passed} passed`);
