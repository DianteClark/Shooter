// Node tests for mastery (save v4): the counting (MasteryTracker), applying gains, unlock challenges, the migration of
// older saves and codes, the Progress API over a stored v3 save, and one bot match fed through the tracker so the event
// shapes it reads are the sim's real ones. Run: node dev/ui-mastery-test.mjs   (add `quick` to skip the bot match)
import assert from 'node:assert/strict';

// progress.js keeps its save in localStorage: a Map stands in, filled before the module loads.
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

const P = await import('../js/shared/progression.js');
const { MasteryTracker, applyMasteryGains, blankSave, sanitizeSave, migrateSave, encodeSave, decodeSave, itemOpen,
  unlockChallenge, masteryRewards, trackStatus, getTrack, MASTERY_TRACKS, WEAPON_LADDER, camoGateOpen, CARDS, SAVE_VERSION } = P;
const { CAMOS } = await import('../js/shared/camos.js');
const { TACTICALS, LETHALS, STREAKS } = await import('../js/shared/catalog.js');
const OPS = await import('../js/ui/operators.js');
const { OPERATORS } = OPS;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok  ${name}`); };
const ME = 'me', FOE = 'foe', MATE = 'mate';
const view = (t, me = {}, extra = {}) => ({
  t, phase: 'live', uav: [0, 0], mapId: 'railyard',
  players: [{ id: ME, team: 0, alive: true, hp: 100, x: 0, z: 0, aim: 0, ...me }, { id: FOE, team: 1, alive: true, hp: 100, x: 5, z: 0, aim: Math.PI }, { id: MATE, team: 0, alive: true, hp: 60, x: 1, z: 0, aim: 0 }],
  ...extra,
});
const kill = (extra = {}) => ({ t: 'kill', by: ME, target: FOE, weapon: 'ar', dist: 10, assist: null, ...extra });

/* ---------- Data ---------- */
test('every tactical, lethal, streak and operator has a track of 3 to 5 tiers with rewards', () => {
  const ids = [...Object.keys(TACTICALS), ...Object.keys(LETHALS), ...Object.keys(STREAKS), ...OPERATORS.map(o => o.id)];
  assert.deepEqual(MASTERY_TRACKS.map(t => t.id).sort(), ids.sort());
  for (const t of MASTERY_TRACKS) {
    assert.ok(t.tiers.length >= 3 && t.tiers.length <= 5, t.id);
    assert.ok(t.tiers.every(c => c.rewards.length && c.goal > 0 && c.label), t.id);
    const card = t.tiers.flatMap(c => c.rewards).find(r => r.kind === 'card');
    assert.ok(CARDS.some(c => `card:${c.id}` === card.id), `${t.id} card row`);
  }
  const { SKINS } = OPS;
  for (const op of OPERATORS) {
    const ids = getTrack(op.id).tiers.flatMap(c => c.rewards).filter(r => r.kind === 'skin').map(r => r.id);
    assert.deepEqual(ids, [`skin:${op.id}-3`, `skin:${op.id}-5`]);
    for (const id of ids) assert.ok(SKINS.some(k => k.id === id), `${id} exists in the operator roster`);
  }
});

/* ---------- Counting ---------- */
test('frag: throws, kills, banked kills and a multi-kill from one throw', () => {
  const m = new MasteryTracker(ME, { loadout: { operator: 'anvil' }, bounced: () => true });
  m.onEvents([{ t: 'throw', id: ME, kind: 'frag', ox: 0, oz: 0, aim: 0, dist: 10 }], view(1));
  m.onEvents([kill({ equip: 'frag' }), kill({ equip: 'frag', target: MATE })], view(2.8));
  m.onEvents([{ t: 'throw', id: FOE, kind: 'frag' }], view(3));          // Someone else's throw counts for nothing.
  const g = m.gains().tracks;
  assert.deepEqual(g.frag, { uses: 1, kills: 2, multi: 1, bankKills: 2 });
  assert.equal(g.anvil.kills, 2);
  assert.equal(m.gains().weapons.ar, undefined, 'a grenade kill is not a gun kill');
});

test('a frag that did not bank gives no banked kill; a slow second kill is no multi', () => {
  const m = new MasteryTracker(ME, { bounced: () => false });
  m.onEvents([{ t: 'throw', id: ME, kind: 'frag', ox: 0, oz: 0, aim: 0, dist: 10 }], view(1));
  m.onEvents([kill({ equip: 'frag' })], view(2.8));
  m.onEvents([kill({ equip: 'frag' })], view(3.6));
  assert.deepEqual(m.gains().tracks.frag, { uses: 1, kills: 2 });
});

test('tacticals: smoke cover kills, flash kills, sensor marks, stim from heals, trophy saves, decoy shots', () => {
  const m = new MasteryTracker(ME);
  m.onEvents([{ t: 'throw', id: ME, kind: 'smoke' }, { t: 'flashed', id: FOE, by: ME, amount: 1, dur: 3 }, { t: 'marked', id: FOE, by: ME, dur: 4 }, { t: 'flashed', id: MATE, by: ME }], view(10));
  m.onEvents([kill()], view(12));
  m.onEvents([kill()], view(30));                                           // Too late for all three.
  m.onEvents([{ t: 'heal', id: ME }], view(40));                            // A Stim.
  m.onEvents([kill()], view(42));
  m.onEvents([{ t: 'heal', id: ME }], view(42.1));                          // Adrenaline after a kill: not a Stim.
  m.onEvents([{ t: 'zap', by: ME }, { t: 'decoy', by: ME }, { t: 'decoy', by: FOE }], view(50));
  const g = m.gains().tracks;
  assert.deepEqual(g.smoke, { uses: 1, coverKills: 1 });
  assert.deepEqual(g.flash, { blinded: 1, flashKills: 1 }, 'a flashed teammate is not counted');
  assert.deepEqual(g.sensor, { marked: 1, markKills: 1 });
  assert.deepEqual(g.stim, { uses: 1, stimKills: 1 });
  assert.equal(g.trophy.saves, 1);
  assert.equal(g.decoy.shots, 1);
});

test('streaks: calls, kills while up, streak kills and multi-kills, resupplied teammates', () => {
  const m = new MasteryTracker(ME);
  m.onEvents([{ t: 'streak', id: ME, kind: 'uav', team: 0 }], view(1));
  m.onEvents([kill()], view(15));
  m.onEvents([kill()], view(25));                                           // UAV is down after 20 s.
  m.onEvents([{ t: 'streak', id: ME, kind: 'turret', team: 0 }], view(30));
  m.onEvents([kill({ streak: 'turret' })], view(31));
  m.onEvents([kill({ streak: 'turret' })], view(32));
  m.onEvents([{ t: 'streak', id: ME, kind: 'resupply', team: 0 }, { t: 'heal', id: MATE }, { t: 'heal', id: ME }], view(40));
  const g = m.gains().tracks;
  assert.deepEqual(g.uav, { uses: 1, upKills: 1 });
  assert.deepEqual(g.turret, { uses: 1, kills: 2, multi: 1 });
  assert.deepEqual(g.resupply, { uses: 1, supplied: 1 });
  assert.equal(g.stim, undefined, 'a Supply Drop heal is not a Stim');
});

test('operator: time alive in the live phase, kills while hurt, signature stats, wins; loadout change at spawn', () => {
  const m = new MasteryTracker(ME, { loadout: { operator: 'ghoul' } });
  for (let t = 0; t <= 10; t += 0.1) m.onEvents([], view(t));
  m.onEvents([], view(10.1, { hp: 40 }));
  m.onEvents([kill({ head: true }), { t: 'medal', id: ME, medal: 'capture' }, { t: 'kill', by: MATE, target: FOE, assist: ME }], view(10.2, { hp: 40 }));
  m.onEvents([], view(20, {}, { phase: 'ended' }));
  m.setLoadout({ operator: 'relay' });
  m.finish({ won: true });
  const g = m.gains().tracks;
  assert.ok(Math.abs(g.ghoul.secs - 10.2) < 0.15, `secs ${g.ghoul.secs}`);
  assert.deepEqual({ k: g.ghoul.kills, h: g.ghoul.head, hk: g.ghoul.hurtKills, o: g.ghoul.obj, a: g.ghoul.assists }, { k: 1, h: 1, hk: 1, o: 1, a: 1 });
  assert.equal(g.relay.wins, 1);
});

test('weapon ladder counters: kills, kills while hurt, five-kill lives, multi-kills', () => {
  const m = new MasteryTracker(ME);
  m.onEvents([], view(0, { hp: 50 }));
  for (let i = 0; i < 6; i++) m.onEvents([kill({ weapon: 'smg' })], view(1 + i, { hp: 50 }));
  m.onEvents([{ t: 'medal', id: ME, medal: 'double' }], view(6.2));
  m.onEvents([{ t: 'kill', by: FOE, target: ME }], view(7));
  for (let i = 0; i < 4; i++) m.onEvents([kill({ weapon: 'smg' })], view(10 + i));
  assert.deepEqual(m.gains().weapons.smg, { kills: 10, hurt: 6, run5: 1, multi: 1 });
});

/* ---------- Applying ---------- */
test('tiers complete in order, pay XP and grant reward ids; a retuned goal never takes a tier back', () => {
  const s = blankSave();
  let r = applyMasteryGains(s, { tracks: { frag: { uses: 30, kills: 30, multi: 10 } } });
  assert.equal(s.mastery.frag.t, 2, 'banked kills still missing, so tier 4 waits behind tier 3');
  assert.equal(r.ups.length, 2);
  assert.equal(r.xp, 1000);
  assert.deepEqual([...masteryRewards(s)], ['badge:frag-1']);
  assert.equal(r.moved[0].before, 0);
  r = applyMasteryGains(s, { tracks: { frag: { bankKills: 5 }, nonsense: { uses: 5 } } });
  assert.equal(s.mastery.frag.t, 4);
  assert.equal(r.xp, 3000);
  assert.ok(masteryRewards(s).has('card:mastery-frag') && masteryRewards(s).has('badge:frag-2'));
  s.mastery.frag.s = {};
  assert.equal(sanitizeSave(s).mastery.frag.t, 4);
});

test('the weapon ladder only counts at level 30, and opens the mastery camos', () => {
  const s = blankSave();
  s.weapons.ar = sanitizeSave({ weapons: { ar: { kills: 5000, head: 5000, long: 5000, slide: 5000, clean: 5000 } } }).weapons.ar;
  applyMasteryGains(s, { weapons: { ar: { kills: 400, hurt: 50, multi: 20, run5: 9 } } });
  assert.equal(s.weapons.ar.ladT, 0, 'below level 30 nothing counts');
  const gold = CAMOS.find(c => c.id === 'gold');
  assert.equal(camoGateOpen(gold, s.weapons.ar), false);
  s.weapons.ar.peak = 30;
  const r = applyMasteryGains(s, { weapons: { ar: { kills: 400, hurt: 50, multi: 20, run5: 9 } } });
  assert.equal(s.weapons.ar.ladT, WEAPON_LADDER.length);
  assert.equal(r.xp, 2000 + 3000 + 4000 + 5000 + 6000);
  assert.equal(camoGateOpen(gold, s.weapons.ar), true);
});

test('unlock challenges gate late gear, never level 1 gear', () => {
  const s = blankSave();
  s.peakLevel = 20;
  assert.equal(itemOpen(s, 'lethal', 'cluster'), false);
  assert.equal(itemOpen(s, 'lethal', 'frag'), true);
  assert.equal(itemOpen(s, 'streak', 'uav'), true);
  assert.deepEqual(unlockChallenge(s, 'lethal', 'cluster'), { label: 'Get 10 Frag kills', goal: 10, value: 0, done: false });
  applyMasteryGains(s, { tracks: { frag: { kills: 10 } } });
  assert.equal(itemOpen(s, 'lethal', 'cluster'), true);
  s.peakLevel = 5;
  assert.equal(itemOpen(s, 'lethal', 'cluster'), false, 'the level still applies');
  // A fresh player's loadout is complete and contains only open items.
  const fresh = blankSave();
  for (const [kind, id] of [['tactical', fresh.loadouts[0].tactical], ['lethal', fresh.loadouts[0].lethal], ...fresh.loadouts[0].streaks.map(x => ['streak', x])]) assert.ok(itemOpen(fresh, kind, id), id);
});

/* ---------- Migration ---------- */
const v3Save = () => ({
  version: 3, name: 'Vet', xp: 5000, totalXp: 900000, prestige: 0, peakLevel: 20, flags: { tutorialOffered: true },
  weapons: { smg: { xp: 99999, peak: 30, kills: 2000, head: 900, long: 500, slide: 300, clean: 1200, owned: [], camo: 'gold' } },
  loadouts: [{ name: 'Mine', primary: 'smg', lethal: 'cluster', streaks: ['uav', 'chopper', 'gunship'], tactical: 'trophy' }],
  pro: { marathon: { sprintM: 100 } }, proDone: ['tracker'], card: 'yard',
});

test('a v3 save migrates to v4 keeping everything: gated gear it had, mastery camos it had, the loadout', () => {
  const s = migrateSave(v3Save());
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.name, 'Vet');
  assert.equal(s.weapons.smg.kills, 2000);
  for (const k of ['lethal:cluster', 'lethal:hatchet', 'tactical:trophy', 'streak:chopper', 'streak:emp', 'streak:gunship']) assert.ok(s.granted.includes(k), k);
  assert.ok(['gold', 'molten', 'prism'].every(id => s.weapons.smg.owned.includes(id)), 'mastery camos grandfathered');
  assert.equal(s.weapons.smg.camo, 'gold');
  assert.equal(s.loadouts[0].lethal, 'cluster');
  assert.deepEqual(s.proDone, ['tracker']);
  // A v3 save below a gate's level gets no grant: it earns it the v4 way.
  const low = migrateSave({ ...v3Save(), peakLevel: 9 });
  assert.equal(low.granted.length, 0);
  // A v4 save is never re-granted.
  assert.equal(migrateSave({ ...v3Save(), version: 4 }).granted.length, 0);
});

test('a v1 save still migrates, and is grandfathered too', () => {
  const s = migrateSave({ name: 'Old', xp: 4000, kills: { ar: 900 }, camoByWeapon: { ar: 'gold' } });
  assert.equal(s.version, SAVE_VERSION);
  assert.ok(s.granted.includes('lethal:hatchet'), 'v1 players kept gear to level 15');
  assert.equal(s.weapons.ar.kills, 900);
});

// The SY3 packer, as it was: the v4 code minus the ladder columns and the tail.
function fnv1a(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
const b64 = str => Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function asV3Code(save) {
  const body = encodeSave(save).split('.')[1];
  const a = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  a[0] = 3;
  a[7] = a[7].map(g => g.slice(0, 13));
  const out = b64(JSON.stringify(a.slice(0, 12)));
  return `SY3.${out}.${fnv1a(out)}`;
}

test('save codes: v4 round trip keeps mastery, ladder, grants and skins; an SY3 code imports through the migration', () => {
  const s = migrateSave(v3Save());
  applyMasteryGains(s, { tracks: { anvil: { secs: 900, kills: 50, hurtKills: 40 }, uav: { uses: 3 } }, weapons: { smg: { kills: 120, hurt: 4 } } });
  const back = decodeSave(encodeSave(s));
  assert.ok(back.ok, back.error);
  assert.deepEqual(back.save.mastery, s.mastery);
  assert.deepEqual(back.save.weapons.smg.lad, s.weapons.smg.lad);
  assert.equal(back.save.weapons.smg.ladT, 1);
  assert.deepEqual(back.save.granted, s.granted);
  assert.ok(encodeSave(s).startsWith('SY4.'));
  s.skins = { anvil: 'skin:anvil-field', wisp: 'skin:anvil-3' }; s.emblem = 'rivet'; s.life = { kills: 40, 'mapwon:dust': 2, __proto__x: 1 };
  const looks = decodeSave(encodeSave(s)).save;
  assert.deepEqual(looks.skins, { anvil: 'skin:anvil-field' }, 'a skin filed under another operator is dropped');
  assert.equal(looks.emblem, 'rivet');
  assert.deepEqual(looks.life, { kills: 40, 'mapwon:dust': 2, __proto__x: 1 });
  const old = decodeSave(asV3Code(sanitizeSave({ ...v3Save(), version: 4 })));
  assert.ok(old.ok, old.error);
  assert.ok(old.save.granted.includes('lethal:cluster'));
  assert.ok(old.save.weapons.smg.owned.includes('gold'));
});

/* ---------- Progress over a stored v3 save ---------- */
store.set('switchyard.save', JSON.stringify(v3Save()));
const { Progress } = await import('../js/ui/progress.js');
test('Progress: migrated save keeps gated gear in its loadout and stores v4', () => {
  assert.equal(JSON.parse(store.get('switchyard.save')).version, SAVE_VERSION);
  assert.ok(Progress.isItemUnlocked('lethal', 'cluster'));
  assert.equal(Progress.loadout().lethal, 'cluster');
  assert.ok(Progress.loadout().streaks.includes('gunship'));
});
test('Progress: applyMatch moves tracks, stamps tier-ups first, pays mastery XP, grants the card and skin', () => {
  const gains = { tracks: { anvil: { secs: 900, kills: 50, hurtKills: 40 } }, weapons: {} };
  assert.equal(Progress.masteryXp(gains), 1000);
  const r = Progress.applyMatch({ xp: 1000, weapons: {}, pro: {}, mastery: gains });
  assert.deepEqual(r.unlocks.filter(u => u.kind === 'mastery').map(u => u.tier), [1, 2, 3]);
  assert.equal(r.unlocks[0].kind, 'mastery');
  assert.equal(r.mastery[0].id, 'anvil');
  assert.deepEqual(Progress.lastMastery(), r.mastery);
  assert.ok(Progress.hasReward('skin:anvil-3'));
  assert.equal(Progress.hasReward('skin:anvil-5'), false);
  assert.equal(Progress.mastery('anvil').tier, 3);
  assert.deepEqual(Progress.skins('anvil').map(k => k.unlocked), [true, false]);
  assert.deepEqual(Progress.badges().map(b => b.id), ['badge:anvil-1']);
  assert.ok(Progress.setOperatorSkin('anvil', 'skin:anvil-3'));
  assert.equal(Progress.setOperatorSkin('anvil', 'skin:anvil-5'), false, 'not earned yet');
  assert.equal(Progress.operatorSkin('anvil'), 'skin:anvil-3');
  Progress.applyMatch({ xp: 0, weapons: {}, pro: {}, life: { kills: 12, 'won:dom': 1 }, mapId: 'dust', won: true });
  Progress.applyMatch({ xp: 0, weapons: {}, pro: {}, life: { kills: 3 }, mapId: 'dust', won: false });
  assert.deepEqual(Progress.lifetime(), { kills: 15, 'won:dom': 1, 'map:dust': 2, 'mapwon:dust': 1 });
  assert.equal(JSON.parse(store.get('switchyard.custom.v1')).skins.anvil, 'skin:anvil-3', 'the operators store mirrors the save');
});

/* ---------- One bot match through the tracker ---------- */
if (!process.argv.includes('quick')) {
  const { Sim, buildRoster } = await import('../js/sim/sim.js');
  const { MAPS } = await import('../js/shared/map.js');
  const { SIM_HZ } = await import('../js/shared/constants.js');
  test('a bot match: every bot tracker counts throws, equipment kills, operator time and gun kills', () => {
    const roster = buildRoster([], { botSkill: 'elite', teamSize: 6, mapId: 'railyard', mode: 'tdm', seed: 7 });
    const sim = new Sim({ roster, map: MAPS.railyard, seed: 7, mode: 'tdm', timeLimit: 600, scoreLimit: 999 });
    const trackers = roster.map(r => new MasteryTracker(r.id, { loadout: { operator: 'trooper' } }));
    for (let i = 0; i < SIM_HZ * 240; i++) {
      sim.step(1 / SIM_HZ);
      const ev = sim.drainEvents(), v = sim.getView(roster[0].id);
      for (const m of trackers) m.onEvents(ev, v);
    }
    const sum = (fn) => trackers.reduce((n, m) => n + fn(m.gains()), 0);
    const throws = sum(g => Object.entries(g.tracks).filter(([k]) => TACTICALS[k] || LETHALS[k]).reduce((n, [, s]) => n + (s.uses ?? 0), 0));
    const gunKills = sum(g => Object.values(g.weapons).reduce((n, s) => n + (s.kills ?? 0), 0));
    const secs = sum(g => g.tracks.trooper?.secs ?? 0);
    console.log(`    bot match: ${throws} pieces of kit used, ${gunKills} gun kills, ${Math.round(secs)} s alive as operators`);
    assert.ok(throws > 10 && gunKills > 20 && secs > 1000);
  });
}

console.log(`\n${passed} checks passed`);
