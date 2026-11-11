// Node tests for the modes overhaul (docs/MODES.md): Headquarters, Kill Order, Infected, One in the Chamber, Control,
// Grind and the Ground War HQ and Kill Order, the modifiers and the featured playlist.
// Run: node dev/sim-modes-v10.mjs [quick]   (quick: one map size per mode and shorter matches)
import assert from 'node:assert/strict';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { objOf } from '../js/sim/rules.js';
import { MODES, MODE_IDS, mapModes, modeFitsMap } from '../js/shared/modes.js';
import { MAPS, MAP_IDS } from '../js/shared/map.js';
import { WEAPONS } from '../js/shared/weapons.js';
import { cleanMods, dealLoadout, featured, FEATURED, MODS } from '../js/shared/playlist.js';
import { SIM_HZ } from '../js/shared/constants.js';

const STEP = 1 / SIM_HZ;
const QUICK = process.argv.includes('quick');
const NEW = ['hq', 'ko', 'inf', 'oic', 'ctl', 'grind'];
let passed = 0;
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}

function makeSim(mode, map, { seed = 7, mods = [], humans = [], timeLimit } = {}) {
  const roster = buildRoster(humans, { botSkill: 'mixed', mode, mapId: map, seed });
  return { roster, sim: new Sim({ roster, map, seed, mode, mods, timeLimit }) };
}
// Steps until the match ends or `seconds` pass; returns every event that is not shooting noise.
function run(sim, seconds, until = () => false) {
  const out = [];
  for (let i = Math.round(seconds * SIM_HZ); i > 0 && sim.phase !== 'ended'; i--) {
    sim.step(STEP);
    for (const e of sim.drainEvents()) if (e.t !== 'shot' && e.t !== 'hit') out.push(e);
    if (until(sim)) break;
  }
  return out;
}
const count = (evs, t, kind) => evs.filter(e => e.t === t && (!kind || e.kind === kind)).length;
// What counts as the objective happening, per mode.
const OBJECTIVE = {
  hq: e => e.t === 'hq' && (e.kind === 'capture' || e.kind === 'destroy'),
  ko: e => e.t === 'ko' && e.kind === 'kill',
  inf: e => e.t === 'inf' && e.kind === 'infected',
  oic: e => e.t === 'oic' && e.kind === 'out',
  ctl: e => e.t === 'ctl' && e.kind === 'end',
  grind: e => e.t === 'grind' && e.kind === 'bank',
};

/* ---------------- Table and maps ---------------- */

await test('table: new modes appended after the old ones, each with rules, sizes and a one-line description', () => {
  const at = MODE_IDS.indexOf('hq');
  assert.ok(at > MODE_IDS.indexOf('gun'));
  for (const id of [...NEW, 'gwhq', 'gwko', 'gwinf']) {
    const m = MODES[id];
    assert.ok(m && m.rules && m.name && m.desc && m.short, id);
    assert.ok(m.desc.length < 90, `${id} description fits one line`);
  }
});

await test('maps: 6v6 modes on every small, medium and large map, never on huge or giant ones; GW HQ and GW KO on huge maps only', () => {
  for (const id of MAP_IDS) {
    const map = MAPS[id], size = map.large ? 'huge' : map.size ?? 'medium';
    for (const m of NEW) assert.equal(modeFitsMap(map, m), size !== 'huge', `${m} on ${id} (${size})`);
    for (const m of ['gwhq', 'gwko', 'gwinf']) assert.equal(modeFitsMap(map, m), size === 'huge', `${m} on ${id}`);
  }
  for (const id in MAPS) if (MAPS[id].size === 'giant') for (const m of [...NEW, 'gwhq', 'gwko', 'gwinf']) assert.ok(!mapModes(MAPS[id]).includes(m) || !modeFitsMap(MAPS[id], m), `${m} on ${id}`);
});

/* ---------------- Every mode to an end on two sizes ---------------- */

const PLAN = {
  hq: [['pier', 900], ['foundry', 900]],
  ko: [['turnstile', 900], ['dust', 900]],
  inf: [['oasis', 400], ['canyon', 400]],
  oic: [['ruins', 400], ['railyard', 400]],
  ctl: [['pier', 1200], ['overpass', 1200]],
  grind: [['railyard', 900], ['icebreaker', 900]],
  gwhq: [['harvest', 1000]],
  gwko: [['downtown', 1000]],
  gwinf: [['expedition', 1000]],
};
for (const mode in PLAN) {
  for (const [map, cap] of QUICK ? PLAN[mode].slice(0, 1) : PLAN[mode]) {
    await test(`${mode} on ${map} (${MAPS[map].size}): bots play it to an end, objectives happen, scores move`, () => {
      // Ground War matches run to a shorter clock here: the point is that they play, not a full quarter of an hour.
      const big = mode.startsWith('gw');
      const { sim } = makeSim(mode, map, { timeLimit: big || QUICK ? Math.min(MODES[mode].timeLimit, 300) : undefined });
      const evs = run(sim, cap);
      assert.equal(sim.phase, 'ended', `${mode} on ${map} still ${sim.phase} at ${sim.time.toFixed(0)} s`);
      const obj = evs.filter(OBJECTIVE[MODES[mode].rules]).length;
      assert.ok(obj > 0, `${mode} on ${map}: no objective events`);
      assert.ok(sim.scores.some(s => s > 0), `${mode} on ${map}: no score`);
      assert.ok(count(evs, 'kill') > 5, 'there was fighting');
      console.log(`     ${Math.round(sim.time)} s, scores ${sim.scores.slice(0, MODES[mode].ffa ? 99 : 2).join('-')}, ${obj} objective events, winner ${sim.winner}`);
    });
  }
}

/* ---------------- Rules in detail ---------------- */

await test('hq: the side holding the HQ cannot respawn; destroying it brings them back', () => {
  const { sim } = makeSim('hq', 'railyard');
  run(sim, 400, s => s.rules.phase === 'held');
  assert.equal(sim.rules.phase, 'held');
  const own = sim.rules.zone.owner;
  const p = sim.players.find(q => q.team === own && q.alive), foe = sim.players.find(q => q.team !== own);
  p.spawnProtect = 0;
  sim._damage(p, foe, 999, 'ar', 5);
  assert.ok(!p.alive);
  run(sim, 4, s => s.rules.phase !== 'held');
  if (sim.rules.phase === 'held') assert.ok(!p.alive, 'still waiting while the HQ stands');
  sim.rules._destroy(1 - own);
  run(sim, 4);
  assert.ok(p.alive || sim.phase === 'ended', 'back once it is gone');
});

await test('gwinf: two infected at the start of a 32-player match; they respawn near the survivors, who split over holds', () => {
  const { sim } = makeSim('gwinf', 'harvest');
  run(sim, 6);
  assert.equal(sim.players.length, 32);
  assert.equal(sim.scores[1], 2);
  assert.equal(sim.scores[0], 30);
  run(sim, 50);
  assert.equal(new Set(sim.rules.camps).size, 2, 'two survivor holds');
});

await test('ko: only the enemy VIP scores, and a new VIP is named at once', () => {
  const { sim } = makeSim('ko', 'railyard');
  run(sim, 4);
  const vip = sim.rules.vip[1], killer = sim.players.find(p => p.team === 0);
  const other = sim.players.find(p => p.team === 1 && p !== vip);
  other.spawnProtect = 0; sim._damage(other, killer, 999, 'ar', 5);
  assert.equal(sim.scores[0], 0);
  vip.spawnProtect = 0; sim._damage(vip, killer, 999, 'ar', 5);
  assert.equal(sim.scores[0], 1);
  assert.ok(sim.rules.vip[1] && sim.rules.vip[1] !== vip && sim.rules.vip[1].alive);
});

await test('inf: one infected at the start, a survivor killed joins them with blades, the last fall ends it', () => {
  const { sim } = makeSim('inf', 'railyard');
  const evs = run(sim, 4);
  assert.equal(sim.scores[1], 1);
  assert.ok(count(evs, 'team') >= 1, 'side changes are announced');
  const z = sim.players.find(p => p.team === 1), s = sim.players.find(p => p.team === 0);
  assert.equal(z.ps.primary, 'knife');
  s.spawnProtect = 0; sim._damage(s, z, 999, 'knife', 1);
  assert.equal(s.team, 1);
  assert.equal(s.loadout.primary, 'knife');
  run(sim, 4);
  assert.equal(s.ps.primary, 'knife');
});

await test('oic: one round, a hit kills, a kill gives the round back, out after the last life', () => {
  const { sim } = makeSim('oic', 'railyard');
  run(sim, 4);
  const [a, b] = sim.players;
  assert.equal(a.ps.ammo[0], 1); assert.equal(a.ps.reserve[0], 0); assert.equal(a.ps.secondary, 'knife');
  assert.equal(a.ps.lethalLeft, 0);
  b.spawnProtect = 0; a.ps.ammo[0] = 0;
  sim._damage(b, a, 30, 'pistol', 8);
  assert.ok(!b.alive);
  assert.equal(a.ps.ammo[0], 1);
  b.oicLives = 1; run(sim, 4);
  b.spawnProtect = 0; sim._damage(b, a, 30, 'pistol', 8);
  run(sim, 6);
  assert.ok(!b.alive && sim.rules.holdDead(b));
});

await test('ctl: lives run down, out of lives stays down, sides swap each round', () => {
  const { sim } = makeSim('ctl', 'railyard');
  run(sim, 7);
  const r = sim.rules, A = r.attackers;
  assert.equal(r.state, 'live');
  const before = r.lives[A];
  const p = sim.players.find(q => q.team === A), d = sim.players.find(q => q.team !== A);
  p.spawnProtect = 0; sim._damage(p, d, 999, 'ar', 5);
  assert.equal(r.lives[A], before - 1);
  r.lives[A] = 0;
  run(sim, 4);
  assert.ok(!p.alive);
  r._end(1 - A, 'elim');
  run(sim, 12);
  assert.equal(r.attackers, 1 - A);
  assert.ok(p.alive);
});

await test('grind: tags go in the pocket, bank in the zone, drop on death', () => {
  const { sim } = makeSim('grind', 'railyard');
  run(sim, 4);
  for (const p of sim.players) p.bot = null;
  const a = sim.players.find(p => p.team === 0), b = sim.players.find(p => p.team === 1);
  b.spawnProtect = 0; sim._damage(b, a, 999, 'ar', 5);
  const tag = sim.tags.find(t => t.team === 1);
  a.ps.x = tag.x; a.ps.z = tag.z;
  run(sim, 0.2);
  assert.equal(a.carry, 1);
  const bank = sim.rules.banks[0];
  for (const q of sim.players) if (q !== a) { q.ps.x = 2; q.ps.z = 2; }
  a.ps.x = bank.x; a.ps.z = bank.z;
  run(sim, 1);
  assert.equal(sim.scores[0], 1); assert.equal(a.carry, 0);
});

/* ---------------- Modifiers ---------------- */

await test('modifiers: clean lists, clashes and modes that deal their own guns', () => {
  assert.deepEqual(cleanMods(['melee', 'hardcore', 'bogus', 'snipers']), ['hardcore', 'snipers']);
  assert.deepEqual(cleanMods('nostreaks,hardcore'), ['hardcore', 'nostreaks']);
  assert.deepEqual(cleanMods(['snipers', 'hardcore'], 'oic'), ['hardcore']);
  assert.deepEqual(cleanMods(['hardcore'], 'br'), []);
  const l = dealLoadout({ primary: 'ar', secondary: 'pistol', streaks: ['uav'], camos: {} }, ['snipers']);
  assert.equal(WEAPONS[l.primary].category, 'Sniper');
});

for (const [mode, map] of [['tdm', 'pier'], ['hq', 'railyard'], ['ko', 'canyon']]) {
  await test(`modifiers apply in ${mode}: melee only, snipers only with no streaks, hardcore`, () => {
    let { sim } = makeSim(mode, map, { mods: ['melee'] });
    let evs = run(sim, 60);
    assert.ok(sim.players.every(p => p.ps.primary === 'knife' && WEAPONS[p.ps.secondary].melee));
    assert.equal(count(evs, 'streak'), 0);
    assert.ok(evs.filter(e => e.t === 'kill').every(e => WEAPONS[e.weapon]?.melee || e.equip), 'melee kills only');
    ({ sim } = makeSim(mode, map, { mods: ['snipers', 'nostreaks'] }));
    evs = run(sim, 60);
    assert.ok(sim.players.every(p => WEAPONS[p.ps.primary].category === 'Sniper'));
    assert.equal(count(evs, 'streak'), 0);
    ({ sim } = makeSim(mode, map, { mods: ['hardcore'] }));
    run(sim, 4);
    const [a] = sim.players, b = sim.players.find(p => p.team !== a.team && !sim.rules?.vip?.includes(p));     // A VIP takes less.
    b.spawnProtect = 0; b.hp = 100;
    sim._damage(b, a, 20, 'ar', 5);
    assert.equal(b.hp, 40);
    assert.deepEqual(sim.getView(a.id).mods, ['hardcore']);
  });
}

/* ---------------- Wire, phones and host migration ---------------- */

const WIRE = { hq: 'railyard', ko: 'railyard', inf: 'railyard', oic: 'railyard', ctl: 'railyard', grind: 'railyard', gwhq: 'harvest' };
for (const mode in WIRE) {
  await test(`${mode}: a guest reads the mode from the snapshot, and a host migration mid-match keeps it and plays on`, () => {
    const map = WIRE[mode], humans = [{ id: 'h1', name: 'Host', team: 0, primary: 'ar', camo: 'none' }, { id: 'h2', name: 'Guest', team: 1, primary: 'smg', camo: 'none' }];
    const { roster, sim } = makeSim(mode, map, { humans, mods: ['hardcore'], seed: 9 });
    const guest = new Sim({ roster, map, seed: 9, mode, mods: ['hardcore'] });
    run(sim, mode.startsWith('gw') ? 150 : 100);
    if (sim.phase === 'ended') return;
    const hv = sim.getView('h2'), gv = guest.decodeSnapshot(sim.encodeSnapshot(), 'h2');
    const ho = objOf(hv), go = objOf(gv);
    assert.equal(go.kind, ho.kind);
    for (const k of ['phase', 'id', 'owner', 'vip', 'started', 'state', 'round', 'attackers', 'lives', 'field']) if (k in ho) assert.deepEqual(go[k], ho[k], k);
    assert.deepEqual(gv.players.map(p => p.team), hv.players.map(p => p.team), 'sides');
    assert.equal(gv.mode, hv.mode);
    assert.deepEqual(gv.points.map(p => [p.id, p.owner]), hv.points.map(p => [p.id, p.owner]), 'zones');
    for (const k of ['hqCaps', 'vipKills', 'infections', 'oicLives', 'ctlCaps', 'carry', 'banked']) {
      if (k in hv.players[0]) assert.deepEqual(gv.players.map(p => p[k]), hv.players.map(p => p[k]), k);
    }
    // The guest deals its own player the same kit the host does.
    const g = sim.byId.get('h2');
    assert.equal(guest.dealFor('h2', { primary: 'smg', secondary: 'pistol' }).primary, sim.dealFor('h2', { primary: 'smg', secondary: 'pistol' }).primary);
    // The host drops; the guest takes over from its newest view.
    const next = Sim.fromSnapshot(gv, roster, { map, seed: 9, gone: ['h1'] });
    assert.deepEqual(next.mods, ['hardcore']);
    const nv = next.getView('h2'), no = objOf(nv);
    for (const k of ['id', 'owner', 'vip', 'started', 'round', 'attackers', 'lives']) {
      if (!(k in ho)) continue;
      // A VIP who was the old host hands the role on as they leave; the other side's stays.
      if (k === 'vip') { go.vip.forEach((id, t) => { if (id !== 'h1') assert.equal(no.vip[t], id, 'vip after migration'); else assert.notEqual(no.vip[t], 'h1'); }); continue; }
      assert.deepEqual(no[k], go[k], `${k} after migration`);
    }
    assert.deepEqual(nv.players.map(p => p.team), gv.players.map(p => p.team));
    // Infected counts heads, and the old host is no longer one.
    if (mode !== 'inf') assert.deepEqual(nv.scores.slice(0, 2), gv.scores.slice(0, 2));
    if (mode === 'grind') assert.equal(next.tags.length, gv.tags.length);
    void g;
    const evs = run(next, 200);
    assert.ok(count(evs, 'kill') > 0, 'play goes on');
    assert.ok(evs.some(OBJECTIVE[MODES[mode].rules]) || next.phase === 'ended', 'and so does the objective');
  });
}

await test('held slots: a human who drops in Infected and Kill Order neither breaks the mode nor ends it', () => {
  for (const mode of ['inf', 'ko', 'oic']) {
    const humans = [{ id: 'h1', name: 'A', team: 0, primary: 'ar' }];
    const { sim } = makeSim(mode, 'railyard', { humans });
    run(sim, 20);
    sim.humanLeft('h1');
    run(sim, 30);
    assert.ok(sim.byId.get('h1').away);
    const back = sim.humanRejoin('h1');
    assert.ok(back);
  }
});

/* ---------------- Featured playlist ---------------- */

await test('featured: the same pick all day, a different one tomorrow, every entry playable', () => {
  const a = featured(new Date(2026, 10, 11, 1)), b = featured(new Date(2026, 10, 11, 23)), c = featured(new Date(2026, 10, 12, 9));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.day, c.day);
  for (const f of FEATURED) {
    assert.ok(MODES[f.mode], f.mode);
    for (const m of f.mods) assert.ok(MODS[m], m);
    assert.ok(MAP_IDS.some(id => modeFitsMap(MAPS[id], f.mode)), `${f.mode} has a map`);
  }
});

console.log(`\n${passed} passed`);
