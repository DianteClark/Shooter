// Every unlock in the game, checked headless (docs/UNLOCKS-AUDIT-2026-11-12.md).
//   A. Data: ids unique, every reward id a track or season grants exists in its table, art and rules sane.
//   B. Reachability: bot matches in every mode, with the real trackers (ChallengeTally, ProTracker, MasteryTracker) on
//      every player and every piece of gear handed round, so each stat any unlock counts is shown to be emitted in the
//      modes it should count in.
//   C. Progress: matches applied through the real Progress API (js/ui/progress.js over a stand-in localStorage): each
//      unlock unlocks once, is reported once, shows unlocked in its list, equips, and survives an SY4 code round trip.
//   D. Generators: 120 days of daily and weekly sets and every season's weekly sets only ask for reachable stats.
// Run: node dev/sim-unlocks.mjs [quick]   (quick: one seed per mode)
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

const QUICK = process.argv.includes('quick');
const P = await import('../js/shared/progression.js');
const { CARDS, CARD_IDS, MASTERY_TRACKS, WEAPON_LADDER, UNLOCK_CHALLENGES, PRO_CHALLENGES, CHALLENGE_POOL, ChallengeTally, ProTracker,
  MasteryTracker, drawChallenges, periodKey, MASTER_REWARDS, encodeSave, decodeSave } = P;
const { CAMOS, RANK_CAMOS } = await import('../js/shared/camos.js');
const { TACTICALS, LETHALS, STREAKS, PERKS, PERK_IDS } = await import('../js/shared/catalog.js');
const { WEAPONS } = await import('../js/shared/weapons.js');
const { WEAPON_IDS, WEAPON_CATEGORY, CATEGORIES, SIM_HZ, GOLDEN_ID } = await import('../js/shared/constants.js');
const { MODES, MODE_IDS, modeFitsMap, modeRules } = await import('../js/shared/modes.js');
const { MAPS } = await import('../js/shared/map.js');
const { Sim, buildRoster } = await import('../js/sim/sim.js');
const { objOf } = await import('../js/sim/rules.js');
const { EX_UNLOCKS, extractionPay } = await import('../js/shared/extraction.js');
const { FINISHERS, EMOTES } = await import('../js/shared/finishers.js');
const { SEASON_DEFS, trackRewards, seasonCards, rankedCards, seasonCamos, seasonEmblems, rankedEmblems } = await import('../js/shared/season-items.js');
const { weeklyAll } = await import('../js/shared/seasons.js');
const OPS = await import('../js/ui/operators.js');
const { OPERATORS, SKINS, getSkin } = OPS;
const EMB = await import('../js/ui/emblems.js');
const { ALL_EMBLEMS, emblemSvg } = EMB;
const { EXTRA_CARD_IDS } = await import('../js/ui/cardbook.js');

let passed = 0;
const problems = [];
const test = (name, fn) => {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { problems.push(name); console.log(`FAIL ${name}\n     ${err.message.split('\n').join('\n     ')}`); }
};
const dupes = list => list.filter((x, i) => list.indexOf(x) !== i);

/* ================= A. Data ================= */
test('ids are unique in every unlock table', () => {
  assert.deepEqual(dupes(CARD_IDS), [], 'calling cards');
  assert.deepEqual(dupes(CAMOS.map(c => c.id)), [], 'camos');
  assert.deepEqual(dupes(ALL_EMBLEMS.map(e => e.id)), [], 'emblems');
  assert.deepEqual(dupes(SKINS.map(s => s.id)), [], 'skins');
  assert.deepEqual(dupes(OPERATORS.map(o => o.id)), [], 'operators');
  assert.deepEqual(dupes(FINISHERS.map(f => f.id)), [], 'finishers');
  assert.deepEqual(dupes(EMOTES.map(f => f.id)), [], 'emotes');
  assert.deepEqual(dupes(MASTERY_TRACKS.map(t => t.id)), [], 'mastery tracks');
  assert.deepEqual(dupes(CHALLENGE_POOL.map(c => c.id)), [], 'daily and weekly pool');
  for (const def of SEASON_DEFS) assert.deepEqual(dupes(weeklyAll(def).flat().map(c => c.id)), [], `${def.id} weekly ids`);
  // Names a player sees side by side in one picker.
  // The rifle once shared the Nightjar operator's name (both Master cards read "Nightjar Master"); it is the Lapwing now.
  assert.deepEqual(dupes(CARDS.map(c => c.name)), [], 'calling card names');
  assert.equal(WEAPONS.hushdmr.name, 'Lapwing', 'the rifle keeps its id under its new name');
  assert.equal(CARDS.find(c => c.id === 'gun-hushdmr')?.name, 'Lapwing Master');
  assert.equal(CARDS.find(c => c.id === 'mastery-nightjar')?.name.includes('Lapwing'), false);
  assert.deepEqual(dupes(ALL_EMBLEMS.map(e => e.name)), [], 'emblem names');
  assert.deepEqual(dupes(CAMOS.map(c => c.name)), [], 'camo names');
});

const cardIds = new Set(CARD_IDS), emblemIds = new Set(ALL_EMBLEMS.map(e => e.id)), camoIds = new Set(CAMOS.map(c => c.id));
const skinIds = new Set(SKINS.map(s => s.id)), opIds = new Set(OPERATORS.map(o => o.id));
const exists = own => {
  const [kind, id] = own.split(/:(.*)/s);
  if (kind === 'card') return cardIds.has(id);
  if (kind === 'emblem') return emblemIds.has(id);
  if (kind === 'camo') return camoIds.has(id);
  if (kind === 'skin') return skinIds.has(own);
  if (kind === 'operator') return opIds.has(id);
  if (kind === 'weapon') return !!WEAPONS[id];
  if (kind === 'badge') return true;        // Drawn from the track itself (js/ui/mastery.js).
  return false;
};

test('every reward a mastery track, a gun ladder, a season track, ranked or Master grants exists in its table', () => {
  const missing = [];
  for (const t of MASTERY_TRACKS) for (const c of t.tiers) for (const r of c.rewards) if (r.id && !exists(r.id)) missing.push(`${t.id} tier ${c.tier}: ${r.id}`);
  for (const w of WEAPON_IDS) for (const c of P.ladderTrack(w).tiers) for (const r of c.rewards) if (r.id && !exists(r.id)) missing.push(`ladder ${w}: ${r.id}`);
  for (const def of SEASON_DEFS) {
    for (const r of trackRewards(def)) if (!exists(r.own)) missing.push(`${def.id} tier ${r.tier}: ${r.own}`);
    assert.equal(trackRewards(def).length, 100, `${def.id} has 100 tiers`);
    for (const c of rankedCards(def)) if (!cardIds.has(c.id)) missing.push(`${def.id} ranked card ${c.id}`);
    for (const e of rankedEmblems(def)) if (!emblemIds.has(e[0])) missing.push(`${def.id} ranked emblem ${e[0]}`);
  }
  for (const r of MASTER_REWARDS) if (r.kind === 'card' && !cardIds.has(r.id)) missing.push(`Master ${r.level}: ${r.id}`);
  for (const r of MASTER_REWARDS) if (r.kind === 'emblem' && !emblemIds.has(r.id)) missing.push(`Master ${r.level}: ${r.id}`);
  assert.deepEqual(missing, []);
});

test('every calling card has a name, a requirement and art, and judges a blank career without throwing (locked)', () => {
  const blank = { prestige: 0, peakLevel: 1, level: 1, pro: [], proCounts: {}, kills: 0, head: 0, long: 0, slide: 0, clean: 0, mastered: 0, camos: new Set(), rewards: new Set(), trackTiers: {}, zmFeats: {} };
  for (const c of CARDS) {
    assert.ok(c.name && c.req && c.art?.p && c.art?.c?.length === 4, `${c.id} data`);
    const open = c.need(blank);
    assert.equal(open, c.id === 'yard', `${c.id}: ${open ? 'open' : 'locked'} on a blank career`);
    if (c.prog) { const [v, g] = c.prog(blank); assert.ok(Number.isFinite(v) && Number.isFinite(g), `${c.id} prog`); }
  }
});

const { readFileSync } = await import('node:fs');
test('every emblem draws; every camo pattern exists in the shader; every skin names a real operator', () => {
  for (const e of ALL_EMBLEMS) assert.ok(emblemSvg(e.id, 18).includes('<polygon'), `${e.id} draws`);
  // The shader imports three.js, so its pattern table is read as text.
  const src = readFileSync(new URL('../js/render/camo-shader.js', import.meta.url), 'utf8');
  const ids = new Set([.../PATTERN_IDS = \{([^}]+)\}/.exec(src)[1].matchAll(/(\w+):/g)].map(m => m[1]));
  for (const c of CAMOS) {
    assert.ok(ids.has(c.pattern), `${c.id}: pattern ${c.pattern}`);
    assert.ok(c.colors?.length >= 1 && c.colors.length <= 4 && c.scale > 0, `${c.id} colours and scale`);
  }
  for (const k of SKINS) assert.ok(opIds.has(k.operator), `${k.id}: operator ${k.operator}`);
});

test('every finisher and emote rule is one the unlock check knows', () => {
  for (const f of [...FINISHERS, ...EMOTES]) {
    const keys = Object.keys(f.unlock);
    assert.ok(keys.every(k => ['level', 'opTier', 'season'].includes(k)), `${f.id}: ${keys}`);
    if (f.unlock.level) assert.ok(f.unlock.level <= P.MAX_LEVEL, f.id);
    if (f.unlock.opTier) assert.ok(f.unlock.opTier <= 5, f.id);
    if (f.unlock.season) assert.ok(f.unlock.season <= 100, f.id);
  }
});

test('operator unlock rules: levels reachable, challenge labels match the goal, life stats are real tallies', () => {
  for (const op of OPERATORS) {
    const u = op.unlock;
    if (!u) continue;
    if (u.level) assert.ok(u.level <= P.MAX_LEVEL, op.id);
    if (u.prestige) assert.ok(u.prestige <= P.MAX_PRESTIGE, op.id);
    if (u.life) assert.ok(u.label.includes(String(u.goal)), `${op.id}: "${u.label}" vs goal ${u.goal}`);
  }
});

test('labels say the real number: challenges, mastery tiers, Pro steps, unlock challenges, emblems', () => {
  const bad = [];
  const has = (label, goal) => goal <= 1 || label.includes(goal.toLocaleString('en-US')) || label.includes(String(goal));
  for (const c of CHALLENGE_POOL) if (!has(c.label, c.goal)) bad.push(`${c.id}: "${c.label}" goal ${c.goal}`);
  for (const def of SEASON_DEFS) for (const c of weeklyAll(def).flat()) if (!has(c.label, c.goal)) bad.push(`${c.id}: "${c.label}" goal ${c.goal}`);
  for (const t of MASTERY_TRACKS) for (const c of t.tiers) {
    const goal = c.stat === 'secs' ? c.goal / 60 : c.goal;       // "Play 15 minutes"
    if (!has(c.label, goal)) bad.push(`${t.id} tier ${c.tier}: "${c.label}" goal ${c.goal}`);
  }
  for (const w of ['ar']) for (const c of P.ladderTrack(w).tiers) if (!has(c.label, c.goal)) bad.push(`ladder: "${c.label}"`);
  for (const [perk, steps] of Object.entries(PRO_CHALLENGES)) for (const c of steps) {
    const goal = c.stat === 'uavSec' ? c.goal / 60 : c.goal;     // "3 min"
    if (!has(c.label, goal)) bad.push(`${perk}: "${c.label}" goal ${c.goal}`);
  }
  for (const [k, c] of Object.entries(UNLOCK_CHALLENGES)) if (!has(c.label, c.goal)) bad.push(`${k}: "${c.label}"`);
  for (const u of EX_UNLOCKS) if (!has(u.label, u.goal)) bad.push(`${u.id}: "${u.label}"`);
  for (const e of ALL_EMBLEMS) {
    const m = /^mapwon:(.+)$/.exec(e.rule?.life ?? '');
    if (m && !e.rule.label.includes(MAPS[m[1]]?.name)) bad.push(`emblem ${e.id}: "${e.rule.label}" is not ${MAPS[m[1]]?.name}`);
  }
  assert.deepEqual(bad, []);
});

test('a Drill thrown into thin cover bores through (its wall kills are reachable; bots never aim for it)', async () => {
  const { EquipmentSystem } = await import('../js/sim/equipment.js');
  let tried = 0, through = 0;
  for (const id of ['railyard', 'neon', 'harbor', 'dust']) {
    for (const w of MAPS[id].walls) {
      if (!(w.w <= 1.6 || w.d <= 1.6) || tried >= 60) continue;
      const eq = new EquipmentSystem(MAPS[id]), evs = [];
      eq.throw('me', 'drill', w.x - 4, w.z + w.d / 2, 0, 6);
      for (let i = 0; i < 200 && !evs.some(e => e.t === 'bang'); i++) eq.step(1 / 30, [], e => evs.push(e), () => {});
      tried++;
      if (evs.some(e => e.t === 'bang' && e.wall)) through++;
    }
  }
  assert.ok(through >= 5, `${through} of ${tried} went through`);
});

/* ================= B. Reachability: bot matches in every mode ================= */
const ALL_TAC = Object.keys(TACTICALS), ALL_LETH = Object.keys(LETHALS), ALL_STREAKS = Object.keys(STREAKS);
const OP_IDS = OPERATORS.map(o => o.id);
const seen = {};            // mode -> { tally: {stat:n}, pro: {stat:n}, mastery: {`${track}.${stat}`: n}, ladder: {stat:n}, medals: {id:n}, ex: {key:n} }
const bump = (o, k, n = 1) => { if (n > 0) o[k] = (o[k] ?? 0) + n; };
let gearTurn = 0;

function mapFor(mode, seed) {
  const fits = Object.keys(MAPS).filter(m => m !== 'range' && m !== 'brtest' && modeFitsMap(MAPS[m], mode));
  return fits[seed % fits.length];
}

function runMode(mode, seed) {
  const map = mapFor(mode, seed);
  if (!map) return null;
  const roster = buildRoster([], { botSkill: 'mixed', mode, mapId: map, seed });
  // Hand every tactical, lethal, scorestreak, perk set and operator round the bots, so every track gets used somewhere.
  for (const r of roster) {
    if (!r.loadout || r.zk || r.isZombie) continue;
    const g = gearTurn++;
    r.loadout.tactical = ALL_TAC[g % ALL_TAC.length];
    r.loadout.lethal = ALL_LETH[(g * 7) % ALL_LETH.length];
    const s = [ALL_STREAKS[g % ALL_STREAKS.length], ALL_STREAKS[(g + 9) % ALL_STREAKS.length], ALL_STREAKS[(g + 17) % ALL_STREAKS.length]];
    r.loadout.streaks = [...new Set(s)].sort((a, b) => STREAKS[a].cost - STREAKS[b].cost);
    r.loadout.perks = [PERK_IDS[g % PERK_IDS.length], PERK_IDS[(g + 5) % PERK_IDS.length], PERK_IDS[(g + 11) % PERK_IDS.length]];
    r.loadout.operator = OP_IDS[g % OP_IDS.length];
  }
  const sim = new Sim({ roster, map, seed, mode });
  const ids = roster.map(r => r.id);
  const tallies = ids.map(id => new ChallengeTally(id));
  const pros = roster.map(r => new ProTracker(r.id, r.loadout?.perks ?? []));
  const masts = roster.map(r => new MasteryTracker(r.id, { loadout: r.loadout, bounced: () => true }));
  const s = seen[mode] ??= { tally: {}, pro: {}, mastery: {}, ladder: {}, medals: {}, ex: {}, matches: 0, ended: 0, best: { streak: 0, long: 0 } };
  const m = MODES[mode], span = m.rounds ? m.timeLimit * (m.scoreLimit * 2 - 1) : m.timeLimit;
  const limit = Math.min(QUICK && mode !== 'snd' && mode !== 'ctf' ? 420 : 1600, (span ?? 600) + 120);
  let view = null;
  for (let i = 0; i < limit * SIM_HZ && sim.phase !== 'ended'; i++) {
    sim.step(1 / SIM_HZ);
    const ev = sim.drainEvents();
    view = sim.getView(ids[0]);
    for (const e of ev) if (e.t === 'medal') bump(s.medals, e.medal);
    for (let k = 0; k < ids.length; k++) { tallies[k].onEvents(ev, view); pros[k].onEvents(ev, view); masts[k].onEvents(ev, view); }
  }
  s.matches++;
  if (sim.phase === 'ended') s.ended++;
  const ffa = !!MODES[mode].ffa;
  const ex = objOf(view)?.ex ? objOf(view) : null;
  const ended = sim.phase === 'ended';
  roster.forEach((r, k) => {
    const me = view.players.find(p => p.id === r.id);
    let place = null;
    if (ffa && me) place = Number.isFinite(me.place) ? me.place : 1 + view.players.filter(p => p.id !== me.id && (view.scores[p.team] ?? 0) > (view.scores[me.team] ?? 0)).length;
    let won = ended && (ffa ? place === 1 : view.winner === r.team);
    if (ex && me) {
      const squad = ex.squads?.find(q => q.team === me.team);
      const pay = extractionPay(squad, { primary: r.primary, operator: 'trooper' });
      won = pay.extracted;
      for (const [key, n] of Object.entries(pay.life)) bump(s.ex, key, n);
    }
    const brPlace = view.br && me ? (won ? 1 : me.place || null) : null;
    const counts = tallies[k].finish({ won, place: ended ? place : null, brPlace });
    const rec = tallies[k].records();
    s.best.streak = Math.max(s.best.streak, rec.streak); s.best.long = Math.max(s.best.long, rec.long);
    for (const [st, n] of Object.entries(counts)) bump(s.tally, st, n);
    for (const [st, n] of Object.entries(pros[k].raw)) bump(s.pro, st, n);
    const g = masts[k].finish({ won });
    for (const [track, stats] of Object.entries(g.tracks)) for (const [st, n] of Object.entries(stats)) bump(s.mastery, `${track}.${st}`, n);
    for (const stats of Object.values(g.weapons)) for (const [st, n] of Object.entries(stats)) bump(s.ladder, st, n);
  });
  return { map, ended, t: Math.round(sim.time) };
}

const SEEDS = QUICK ? [1] : [1, 2, 3];
const t0 = Date.now();
for (const mode of MODE_IDS) {
  // Quick still plays the round modes three times: a defuse or a flag capture is a rare thing in one bot match.
  const runs = (mode === 'snd' ? [1, 2, 3, 4, 5, 6] : QUICK && mode === 'ctf' ? [1, 2, 3] : SEEDS).map(seed => runMode(mode, seed)).filter(Boolean);
  console.log(`     ${mode.padEnd(6)} ${runs.map(r => `${r.map} ${r.t}s${r.ended ? '' : ' (cut)'}`).join(', ')}`);
}
console.log(`     ${MODE_IDS.length} modes played in ${Math.round((Date.now() - t0) / 1000)} s`);

// Where a stat showed up: the modes, by mode id.
const where = (kind, stat) => MODE_IDS.filter(m => (seen[m]?.[kind]?.[stat] ?? 0) > 0);
const anywhere = (kind, stat) => where(kind, stat).length > 0;
// A tally stat a challenge reads: 'played:<rules>' / 'won:<rules>' need a mode with those rules.
const rulesOf = stat => (/^(played|won|top3):/.test(stat) ? stat.split(':')[1] : null);

const unreachable = [];
const needTally = (who, stat, modes = null) => {
  const w = where('tally', stat);
  if (!w.length) unreachable.push(`${who}: '${stat}' never counted in any mode`);
  else if (modes && !modes.some(m => w.includes(m))) unreachable.push(`${who}: '${stat}' counted only in ${w.join(', ')}, not in ${modes.join('/')}`);
};
const modesWithRules = rules => MODE_IDS.filter(m => modeRules(m) === rules);

test('daily and weekly pool: every challenge counts in a mode that exists, the mode ones in their own mode', () => {
  unreachable.length = 0;
  for (const c of CHALLENGE_POOL) {
    const rules = rulesOf(c.stat);
    if (rules) { assert.ok(modesWithRules(rules).length, `${c.id}: no mode runs '${rules}'`); needTally(c.id, c.stat, modesWithRules(rules)); }
    else needTally(c.id, c.stat);
  }
  assert.deepEqual(unreachable, []);
});

test('season weekly sets: every template counts somewhere', () => {
  unreachable.length = 0;
  const stats = new Set(SEASON_DEFS.flatMap(d => weeklyAll(d).flat().map(c => c.stat)));
  for (const st of stats) if (st !== 'ranked') needTally(`season weekly '${st}'`, st, rulesOf(st) ? modesWithRules(rulesOf(st)) : null);
  assert.deepEqual(unreachable, []);
});

// The lifetime tallies: ChallengeTally counts plus map:<id>, mapwon:<id> (Progress.applyMatch) and ex:* (extraction).
const lifeReach = key => {
  if (/^map(won)?:/.test(key)) return MAPS[key.split(':')[1]] ? [] : [`no map ${key}`];
  if (key.startsWith('ex:')) return MODE_IDS.some(m => (seen[m]?.ex?.[key] ?? 0) > 0) ? [] : [`'${key}' never banked by a bot squad`];
  const rules = rulesOf(key);
  const w = where('tally', key);
  if (!w.length) return [`'${key}' never counted`];
  if (rules && !w.some(m => modeRules(m) === rules)) return [`'${key}' not counted in its own mode`];
  return [];
};

test('lifetime-tally unlocks (operators, emblems, calling cards) read stats the matches really count', () => {
  const out = [];
  for (const op of OPERATORS) if (op.unlock?.life) out.push(...lifeReach(op.unlock.life).map(x => `operator ${op.id}: ${x}`));
  // Feat emblems are checked below, with the bot-rare ones (a Showdown won 6-0) proved by synthetic matches.
  for (const e of ALL_EMBLEMS) if (e.rule?.life && !e.feat) out.push(...lifeReach(e.rule.life).map(x => `emblem ${e.id}: ${x}`));
  for (const u of EX_UNLOCKS) out.push(...lifeReach(u.key).map(x => `${u.id}: ${x}`));
  // Calling cards read `life(...)` inside their rules: find the keys by calling each rule with a recording career.
  const asked = new Set();
  const { setCareerExtras } = OPS.__cardbook ?? {};
  for (const c of CARDS) {
    const src = c.need.toString() + (c.prog?.toString() ?? '');
    for (const m of src.matchAll(/life\(([`'])([^`']+)\1\)/g)) asked.add(m[2].replace('${id}', '*'));
  }
  for (const key of asked) {
    if (key.includes('*')) continue;
    out.push(...lifeReach(key).map(x => `card life ${x}`));
  }
  assert.deepEqual(out, []);
});

test('mode calling cards: each counts in its mode', () => {
  const out = [];
  for (const c of CARDS.filter(c => c.group === 'Modes')) {
    const m = c.need.toString();
    void m;
  }
  // Cards by stat (cardbook.js MODE_CARDS); won:<rules> must be won somewhere that runs those rules.
  for (const [id, stat] of [['mode-tdm', 'won:tdm'], ['mode-kc', 'confirms'], ['mode-dom', 'won:dom'], ['mode-hard', 'won:hard'], ['mode-ffa', 'won:ffa'], ['mode-gun', 'won:gun'],
    ['snd-plant', 'plants'], ['snd-defuse', 'defuses'], ['snd-clutch', 'clutches'], ['ctf-cap', 'flagCaps'], ['ctf-return', 'flagReturns'], ['ctf-carrier', 'carrierKills']]) {
    assert.ok(cardIds.has(id), id);
    out.push(...lifeReach(stat).map(x => `${id}: ${x}`));
  }
  assert.deepEqual(out, []);
});

test('Pro perk challenges: every step stat is counted in play', () => {
  const out = [];
  for (const [perk, steps] of Object.entries(PRO_CHALLENGES)) for (const c of steps) if (!anywhere('pro', c.stat)) out.push(`${perk}: ${c.stat}`);
  assert.deepEqual(out, []);
});

test('mastery tracks: every tier stat of every tactical, lethal, streak and operator is counted in play', () => {
  const out = [];
  for (const t of MASTERY_TRACKS) for (const c of t.tiers) if (!anywhere('mastery', `${t.id}.${c.stat}`)) out.push(`${t.kind} ${t.id} tier ${c.tier}: ${c.stat} (${c.label})`);
  if (out.length) console.log(`     not seen in bot play (check by hand): \n       ${out.join('\n       ')}`);
  // Bots may never do some of these (a Trophy save needs an enemy throw into it): report, fail only on a whole kind.
  for (const kind of ['tactical', 'lethal', 'streak', 'operator']) {
    const stats = new Set(MASTERY_TRACKS.filter(t => t.kind === kind).flatMap(t => t.tiers.map(c => c.stat)));
    // Bot-rare (hand-checked, docs/UNLOCKS-AUDIT-2026-11-12.md): wallKills (bots never aim a Drill at a wall; the
    // Drill test above shows it bores through), melted (a Thermite on a device or Rampart), stolen (an enemy Airdrop).
    if (!QUICK) for (const st of stats) if (!['wallKills', 'melted', 'stolen'].includes(st)) assert.ok(MASTERY_TRACKS.filter(t => t.kind === kind).some(t => anywhere('mastery', `${t.id}.${st}`)), `${kind} stat ${st} never counted for any item`);
  }
});

test('weapon ladder and unlock challenges: their stats are counted', () => {
  for (const c of WEAPON_LADDER) assert.ok(anywhere('ladder', c.stat), `ladder ${c.stat}`);
  for (const k of Object.keys(UNLOCK_CHALLENGES)) assert.ok(UNLOCK_CHALLENGES[k].label, k);
});

test('Graveyard Shift: zombie kills count only as the mode\'s own (zm:kills), never as kills, class, gun, Pro, mastery or ladder stats', () => {
  const z = seen.zm;
  assert.ok(z && z.matches > 0, 'zm was played');
  assert.ok((z.tally['zm:kills'] ?? 0) > 0, 'the horde was killed (zm:kills)');
  const killish = Object.keys(z.tally).filter(k => /^(kills|head|long|closeKills|slideKills|hipKills|assists|streakKills|equipKills|multi|streak3|streak5|cat:|gun:)/.test(k));
  assert.deepEqual(killish, [], 'kill stats in the challenge tally');
  const proKills = ['kills', 'woundedKills', 'lowKills', 'closeKills', 'swapKills', 'flankKills', 'equipKills', 'hits', 'assists', 'multi', 'streak3'].filter(k => (z.pro[k] ?? 0) > 0);
  assert.deepEqual(proKills, [], 'Pro kill steps');
  assert.deepEqual(Object.keys(z.mastery).filter(k => /\.(kills|hurtKills|head|closeKills|slideKills|upKills|suitKills|multi|assists|\w+Kills)$/.test(k)), [], 'mastery kill stats');
  assert.deepEqual(z.ladder, {}, 'weapon ladder');
  assert.deepEqual(z.medals, {}, 'medals');
});

// The rewards pass (docs/UNLOCKS-AUDIT-2026-11-12.md): the feat tallies and the new cards' stats.
const FEAT_MODES = {
  ace: ['snd', 'gf'], 'gf:flawless': ['gf'], 'inf:survived': ['inf', 'gwinf'], 'br:won': ['br', 'brduo', 'brsolo'], 'br:top5': ['br', 'brduo', 'brsolo'],
  'br:lone': ['br', 'brduo'], 'rb:won': ['rb', 'rbduo'], 'rb:top5': ['rb', 'rbduo'], 'rb:lone': ['rb', 'rbduo'], 'zm:kills': ['zm'],
};
// Seen rarely or never in bot play (bots seldom survive Infected's clock, win a Showdown 6-0 or outlast a squad in a
// battle royale cut at 1,600 s): reported, and proved by the synthetic matches below.
const FEAT_RARE = new Set(['gf:flawless', 'inf:survived', 'br:won', 'br:lone', 'rb:won', 'rb:lone', 'long40', 'ace', 'br:top5']);
test('feat tallies count only in their own modes, and never in Graveyard Shift', () => {
  const bad = [], rare = [];
  for (const [k, ok] of Object.entries(FEAT_MODES)) {
    const w = where('tally', k);
    for (const m of w) if (!ok.includes(m)) bad.push(`${k} counted in ${m}`);
    if (!w.length) (FEAT_RARE.has(k) ? rare : bad).push(`${k} never counted`);
  }
  for (const k of ['streak10', 'finishers', 'long40', 'ace']) if ((seen.zm?.tally?.[k] ?? 0) > 0) bad.push(`${k} counted in zm`);
  for (const k of ['streak10', 'finishers']) if (!anywhere('tally', k)) bad.push(`${k} never counted`);
  if (!MODE_IDS.some(m => (seen[m]?.ex?.['ex:clean'] ?? 0) > 0)) rare.push('ex:clean never banked');
  if (rare.length) console.log(`     bot-rare feats (proved synthetically below): ${rare.join(', ')}`);
  const best = Object.fromEntries(MODE_IDS.map(m => [m, seen[m]?.best]));
  console.log(`     longest bot kill ${Math.max(...Object.values(best).map(b => b?.long ?? 0))} m, best streak ${Math.max(...Object.values(best).map(b => b?.streak ?? 0))}; zm ${JSON.stringify(best.zm)}`);
  assert.equal(best.zm?.streak ?? 0, 0, 'no streak record from the horde');
  assert.deepEqual(bad, []);
});

test('feat tallies from synthetic matches: ace, Showdown 6-0, Infected survivor, BR and Rebound lone wins, long kills', () => {
  const pl = (id, team, extra = {}) => ({ id, team, alive: true, x: 0, z: 0, ...extra });
  const view = (modeId, players, extra = {}) => ({ t: 1, phase: 'live', modeId, mode: modeId, players, scores: [0, 0], ...extra });
  // Showdown: both enemies in one round, then the match 6-0.
  let t = new ChallengeTally('a');
  let v = view('gf', [pl('a', 0), pl('b', 0), pl('x', 1), pl('y', 1)]);
  t.onEvents([{ t: 'gf', kind: 'go' }, { t: 'kill', by: 'a', target: 'x', weapon: 'ar', dist: 10 }, { t: 'kill', by: 'a', target: 'y', weapon: 'ar', dist: 41 }, { t: 'gf', kind: 'end', winner: 0 }], v);
  t.onEvents([], { ...v, scores: [6, 0] });
  let n = t.finish({ won: true });
  assert.equal(n.ace, 1, 'ace'); assert.equal(n['gf:flawless'], 1, 'flawless'); assert.equal(n.long40, 1, 'long40');
  t = new ChallengeTally('a'); t.onEvents([], { ...v, scores: [6, 1] }); assert.equal(t.finish({ won: true })['gf:flawless'], undefined, 'not 6-1');
  // An ace needs the whole side: one of two is not one.
  t = new ChallengeTally('a'); t.onEvents([{ t: 'gf', kind: 'go' }, { t: 'kill', by: 'a', target: 'x', weapon: 'ar' }, { t: 'gf', kind: 'end' }], v); assert.equal(t.finish({}).ace, undefined, 'half a side');
  // Search and Destroy ace across a 6 v 6.
  const six = [0, 1, 2, 3, 4, 5].flatMap(i => [pl(`m${i}`, 0), pl(`e${i}`, 1)]);
  t = new ChallengeTally('m0');
  t.onEvents([{ t: 'snd', kind: 'go' }, ...[0, 1, 2, 3, 4, 5].map(i => ({ t: 'kill', by: 'm0', target: `e${i}`, weapon: 'smg' })), { t: 'snd', kind: 'end', winner: 0 }], view('snd', six));
  assert.equal(t.finish({ won: true }).ace, 1, 'S&D ace');
  // Infected: the survivor medal.
  t = new ChallengeTally('a'); t.onEvents([{ t: 'medal', id: 'a', medal: 'survivor' }], view('inf', [pl('a', 0)])); assert.equal(t.finish({ won: true })['inf:survived'], 1, 'survivor');
  // Battle royale: won with every squadmate out is a lone win; Rebound counts as Rebound.
  for (const [mode, k] of [['br', 'br'], ['rb', 'rb']]) {
    t = new ChallengeTally('a');
    t.onEvents([], view(mode, [pl('a', 0), pl('b', 0, { alive: false }), pl('c', 0, { alive: false }), pl('x', 1, { alive: false })], { br: {} }));
    n = t.finish({ won: true, brPlace: 1 });
    assert.ok(n[`${k}:won`] === 1 && n[`${k}:top5`] === 1 && n[`${k}:lone`] === 1, `${mode}: ${JSON.stringify(n)}`);
    assert.equal(n[`${k === 'br' ? 'rb' : 'br'}:won`], undefined, `${mode} only`);
  }
  t = new ChallengeTally('a'); t.onEvents([], view('br', [pl('a', 0), pl('b', 0)], { br: {} })); n = t.finish({ won: false, brPlace: 4 });
  assert.ok(n['br:top5'] === 1 && !n['br:won'], 'a fourth place is a top five');
  // Records: the run of kills resets on a death; the horde adds nothing.
  t = new ChallengeTally('a');
  t.onEvents([1, 2, 3].map(i => ({ t: 'kill', by: 'a', target: `x${i}`, weapon: 'ar', dist: 12 })), view('tdm', [pl('a', 0)]));
  t.onEvents([{ t: 'kill', by: 'x', target: 'a', weapon: 'ar' }, { t: 'kill', by: 'a', target: 'y', weapon: 'ar', dist: 30 }], view('tdm', [pl('a', 0)]));
  assert.deepEqual(t.records(), { streak: 3, long: 30 });
  t = new ChallengeTally('a'); t.onEvents([{ t: 'kill', by: 'a', target: 'z1', weapon: 'ar', dist: 60 }, { t: 'fin', by: 'a', target: 'z1' }], view('zm', [pl('a', 0)]));
  assert.deepEqual(t.records(), { streak: 0, long: 0 }); assert.equal(t.finish({}).finishers, undefined, 'no finisher count from the horde');
  // Extraction: every contract the squad took, four or more, is a clean run.
  assert.equal(extractionPay({ extracted: true, banked: [1, 2, 3, 4].map(() => ({ type: 'intel', tier: 1 })), pot: [], taken: 4 }).life['ex:clean'], 1, 'clean run');
  assert.equal(extractionPay({ extracted: true, banked: [1, 2, 3, 4].map(() => ({ type: 'intel', tier: 1 })), pot: [], taken: 6 }).life['ex:clean'], undefined, 'contracts dropped');
});

test('every new calling card and feat emblem reads a stat the game counts, in its own mode', () => {
  const out = [];
  const newCards = CARDS.filter(c => /^(map-.+-[23]|modes-|zm-(escape|map))/.test(c.id) || (/^map-/.test(c.id) && !['railyard', 'harbor', 'neon', 'dust', 'frost', 'topside', 'sunken', 'harvest'].includes(c.id.slice(4))));
  assert.ok(newCards.length >= 95, `${newCards.length} new cards`);
  for (const c of newCards) {
    assert.ok(c.art?.tier || c.group === 'Zombies', `${c.id} tier`);
    assert.ok(c.play?.tab, `${c.id} has a Play now`);
    const m = /^modes-(\w+)-(\d)$/.exec(c.id);
    if (m) {
      const stat = { br: 'br:', rb: 'rb:', ex: 'ex:out', zm: null }[m[1]] ?? `won:${MODES[m[1]].rules}`;
      if (stat && stat.startsWith('won:')) out.push(...lifeReach(stat).map(x => `${c.id}: ${x}`));
    }
  }
  for (const e of ALL_EMBLEMS.filter(e => e.feat)) {
    assert.ok(e.play?.tab && e.rule.label, `${e.id} play and label`);
    if (e.rule.life && !FEAT_RARE.has(e.rule.life) && !e.rule.life.startsWith('ex:')) out.push(...lifeReach(e.rule.life).map(x => `${e.id}: ${x}`));
  }
  assert.equal(ALL_EMBLEMS.filter(e => e.feat).length, 12, 'twelve feat emblems');
  assert.deepEqual(out, []);
});

/* ================= D. Generators ================= */
test('120 days of dailies and 18 weeks of weeklies: three a set, no family twice, nothing unreachable', () => {
  const start = new Date(2026, 10, 12);
  const used = new Set();
  for (let d = 0; d < 120; d++) {
    const now = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
    for (const period of ['daily', 'weekly']) {
      const ids = drawChallenges(period, periodKey(period, now));
      assert.equal(ids.length, 3, `${period} ${periodKey(period, now)}`);
      const fam = ids.map(id => P.getChallenge(id).family);
      assert.equal(new Set(fam).size, 3, `${period} ${periodKey(period, now)} families ${fam}`);
      ids.forEach(id => used.add(id));
    }
  }
  console.log(`     ${used.size} of ${CHALLENGE_POOL.length} pool challenges came up in 120 days`);
  // A fresh player can do every gun and class goal: each names a level 1 gun, or a class with one.
  for (const c of CHALLENGE_POOL) {
    if (c.stat.startsWith('gun:')) assert.equal(P.itemUnlockLevel('weapon', c.stat.slice(4)), 1, `${c.id}: a level 1 gun`);
    if (c.stat.startsWith('cat:')) assert.ok(WEAPON_IDS.some(w => WEAPON_CATEGORY[w] === c.stat.slice(4) && P.itemUnlockLevel('weapon', w) <= 1), `${c.id}: a level 1 gun in the class`);
    if (c.mode) assert.ok(MODES[c.mode], c.id);
  }
  // No mode is date-locked in the schedule now; the draw leaves out any that a season will lock.
  for (let d = 0; d < 120; d++) assert.deepEqual(P.lockedChallenges(new Date(2026, 10, 12 + d)), []);
});

/* ================= C. Progress: a whole career through the real save ================= */
const C = await import('../js/ui/cards.js');           // Registers the card career extras, as the game does.
const { Progress, Challenges } = await import('../js/ui/progress.js');
const { seasonAt, TIER_XP } = await import('../js/shared/seasons.js');
const GEAR_KINDS = { perk: PERKS, tactical: TACTICALS, lethal: LETHALS, streak: STREAKS, weapon: WEAPONS };
const opened = () => {
  const careerNow = C.careerNow();
  return {
    card: new Set(Progress.cards().filter(c => c.unlocked).map(c => c.card.id)),
    operator: new Set(Progress.operators().filter(o => o.unlocked).map(o => o.op.id)),
    camo: new Set(WEAPON_IDS.flatMap(w => CAMOS.filter(c => Progress.isUnlocked(w, c.id)).map(c => `${w}/${c.id}`))),
    skin: new Set(OPERATORS.flatMap(o => C.skinStatus(o.id).filter(s => s.unlocked).map(s => s.skin.id))),
    emblem: new Set(ALL_EMBLEMS.filter(e => EMB.emblemUnlocked(e, careerNow).unlocked).map(e => e.id)),
    finisher: new Set(Progress.finishers().filter(f => f.unlocked).map(f => f.id)),
    emote: new Set(Progress.emotes().filter(f => f.unlocked).map(f => f.id)),
    gear: new Set(Object.entries(GEAR_KINDS).flatMap(([k, t]) => Object.keys(t).filter(id => Progress.isItemUnlocked(k, id)).map(id => `${k}:${id}`))),
    pro: new Set(Progress.proPerks()),
    attachment: new Set(WEAPON_IDS.flatMap(w => Progress.attachments(w).filter(a => a.unlocked).map(a => `${w}/${a.id}`))),
  };
};
const diff = (a, b) => [...b].filter(x => !a.has(x));

// Every tally stat the matches produced, so the synthetic career moves every lifetime unlock.
const TALLY_STATS = [...new Set(MODE_IDS.flatMap(m => Object.keys(seen[m]?.tally ?? {})))];
const EX_KEYS = [...new Set(EX_UNLOCKS.map(u => u.key)), 'ex:out'];
const MAP_LIST = Object.keys(MAPS).filter(m => m !== 'range' && m !== 'brtest');
// The rewards pass: every map's plays and wins (the map cards' gold tier is 75 wins), every rule set's wins, and every
// feat tally, so every new card and feat emblem opens over the career; Graveyard Shift's maps get round 31 and an escape
// on round 26 through applyMatch (matches 84-87), so their cards are stamped too.
const FEAT_KEYS = ['ace', 'streak10', 'finishers', 'long40', 'gf:flawless', 'inf:survived', 'br:won', 'br:top5', 'br:lone', 'rb:won', 'rb:top5', 'rb:lone', 'ex:clean', 'ex:out', 'zm:kills'];
const RULES = [...new Set(MODE_IDS.map(modeRules))];
const ZM_MAPS = MODES.zm.maps;
function bigMatch(i) {
  const life = Object.fromEntries([...TALLY_STATS, ...EX_KEYS].map(k => [k, k.startsWith('ex:') ? 2 : 8]));
  for (const m of MAP_LIST) { life[`map:${m}`] = 2; life[`mapwon:${m}`] = 1; }
  for (const r of RULES) life[`won:${r}`] = Math.max(life[`won:${r}`] ?? 0, 1);
  for (const k of FEAT_KEYS) life[k] = Math.max(life[k] ?? 0, 1);
  const zmAt = i >= 84 && i < 88 ? ZM_MAPS[i - 84] : null;
  const weapons = Object.fromEntries(WEAPON_IDS.filter(w => w !== GOLDEN_ID).map(w => [w, { xp: 9000, kills: 40, head: 12, long: 6, slide: 8, clean: 16 }]));
  const pro = Object.fromEntries(PERK_IDS.map(p => [p, Object.fromEntries((PRO_CHALLENGES[p] ?? []).map(c => [c.stat, Math.ceil(c.goal / 4)]))]));
  const tracks = Object.fromEntries(MASTERY_TRACKS.map(t => [t.id, Object.fromEntries(t.stats.map(st => [st, Math.ceil(Math.max(...t.tiers.map(c => (c.stat === st ? c.goal : 0)), 1) / 6)]))]));
  const ladder = Object.fromEntries(WEAPON_IDS.map(w => [w, { kills: 60, hurt: 6, multi: 3, run5: 1 }]));
  return { xp: 220000, weapons, pro, mastery: { tracks, weapons: ladder }, life, mapId: zmAt ?? MAP_LIST[i < 80 ? i % 8 : i % MAP_LIST.length], won: true,
    career: { kills: 40, deaths: 20, br: false, place: null, extracted: true }, extracted: true,
    zmFeat: i === 7 ? { escaped: 21, boss: true } : zmAt ? { escaped: 26, boss: false } : null, zmRounds: zmAt ? 31 : null,
    records: { streak: 5 + (i % 20), long: 20 + (i % 30), brPlace: 1 + (i % 7), exSecs: 600 - i } };
}

const stamped = new Map();      // 'kind:id' -> matches it was stamped in
const silent = [], twice = [];
test('a whole career: every unlock that opens is stamped on the results once, and never again', () => {
  Challenges.reset();
  let before = opened();
  for (let i = 0; i < 90; i++) {
    const r = Progress.applyMatch(bigMatch(i));
    const after = opened();
    const keys = [];
    for (const u of r.unlocks) {
      if (u.kind === 'mastery') { for (const x of u.rewards) if (x.kind === 'card' && !x.had) keys.push(`card:${x.id.slice(5)}`); keys.push(`mastery:${u.id}`); continue; }
      if (u.kind === 'camo') keys.push(`camo:${u.weapon ?? 'all'}/${u.id}`);
      else if (u.kind === 'attachment') keys.push(`attachment:${u.weapon}/${u.id}`);
      else if (u.kind === 'emblem' && u.feat) keys.push(`emblem:${u.id}`);
      else keys.push(`${u.kind}:${u.id}`);
    }
    for (const k of keys) { if (stamped.has(k)) twice.push(`${k} (matches ${stamped.get(k)} and ${i})`); stamped.set(k, i); }
    for (const id of diff(before.card, after.card)) if (!keys.includes(`card:${id}`)) silent.push(`card ${id}`);
    for (const id of diff(before.operator, after.operator)) if (!keys.includes(`operator:${id}`)) silent.push(`operator ${id}`);
    for (const id of diff(before.pro, after.pro)) if (!keys.includes(`pro:${id}`)) silent.push(`pro ${id}`);
    // Feat emblems are stamped like cards (Champion excepted: ranked moves after the match is applied, and never here).
    for (const id of diff(before.emblem, after.emblem)) if (EMB.getEmblem(id)?.feat && !keys.includes(`emblem:${id}`)) silent.push(`emblem ${id}`);
    for (const id of diff(before.gear, after.gear)) if (!keys.includes(id)) silent.push(`gear ${id}`);
    for (const id of diff(before.attachment, after.attachment)) if (!keys.includes(`attachment:${id}`)) silent.push(`attachment ${id}`);
    for (const id of diff(before.camo, after.camo)) {
      const [w, c] = id.split('/'), camo = CAMOS.find(x => x.id === c);
      if (camo.pp || camo.mlv) continue;            // Rank camos: the prestige screen and the Master stamps show them.
      if (camo.exfil) continue;                     // Extraction exclusives: awards.js stamps them once for every gun.
      if (!keys.includes(`camo:${w}/${c}`)) silent.push(`camo ${id}`);
    }
    // Weapon prestige and player prestige whenever they are open, as a player would.
    for (const w of WEAPON_IDS) while (Progress.canPrestigeWeapon(w)) Progress.prestigeWeapon(w);
    while (Progress.canPrestige()) Progress.doPrestige();
    before = opened();
  }
  console.log(`     ${stamped.size} unlocks stamped over 90 matches; prestige ${Progress.prestige}, Master ${Progress.master}`);
  assert.deepEqual(twice, [], 'stamped twice');
  assert.deepEqual(silent.slice(0, 40), [], `opened without a stamp (${silent.length})`);
});

test('after that career everything not tied to a season is open, in every menu', () => {
  const o = opened();
  const lockedCards = CARDS.filter(c => !c.season && !o.card.has(c.id)).map(c => c.id);
  assert.deepEqual(lockedCards, [], 'calling cards still locked');
  assert.deepEqual(OPERATORS.filter(op => !o.operator.has(op.id)).map(op => op.id), [], 'operators');
  const camoLocked = WEAPON_IDS.filter(w => w !== GOLDEN_ID).flatMap(w => Progress.camos(w).filter(c => !c.unlocked && !c.camo.season).map(c => `${w}/${c.camo.id}`));
  assert.deepEqual(camoLocked.slice(0, 20), [], `camos (${camoLocked.length})`);
  const skinLocked = SKINS.filter(s => !s.season && !o.skin.has(s.id)).map(s => s.id);
  assert.deepEqual(skinLocked, [], 'skins');
  // Champion (a feat emblem) is the best ranked division ever reached: checked with a ranked save below.
  assert.deepEqual(ALL_EMBLEMS.filter(e => !e.season && e.id !== 'feat-champion' && !o.emblem.has(e.id)).map(e => e.id), [], 'emblems');
  assert.deepEqual(FINISHERS.filter(f => !f.unlock.season && !o.finisher.has(f.id)).map(f => f.id), [], 'finishers');
  assert.deepEqual(EMOTES.filter(f => !f.unlock.season && !o.emote.has(f.id)).map(f => f.id), [], 'emotes');
  assert.deepEqual(Object.entries(GEAR_KINDS).flatMap(([k, t]) => Object.keys(t).map(id => `${k}:${id}`)).filter(k => !o.gear.has(k)), [], 'gear');
  assert.equal(o.pro.size, PERK_IDS.length, 'every Pro perk');
  const attLocked = WEAPON_IDS.filter(w => w !== GOLDEN_ID).flatMap(w => Progress.attachments(w).filter(a => !a.unlocked).map(a => `${w}/${a.id}`));
  assert.deepEqual(attLocked.slice(0, 20), [], `attachments (${attLocked.length})`);
  assert.equal(Progress.goldenEarned(), true, 'the Golden gun');
});

test('a season: the track pays its tiers once and every reward shows as owned and equips', () => {
  const day = new Date(2026, 10, 20);
  const info = seasonAt(day);
  assert.equal(info.def?.id, 'S1');
  const was = opened();
  Progress.applySeasonMatch({ xp: TIER_XP * 100, counts: { played: 1 }, career: { kills: 1, deaths: 1, won: true } }, day);
  const claims = Progress.claimSeason(day);
  assert.equal(claims.length, 100, 'every tier claimed once');
  assert.equal(Progress.claimSeason(day).length, 0, 'and not again');
  const o = opened();
  const owned = trackRewards(info.def);
  const notOpen = owned.filter(r => !(r.kind === 'card' ? o.card.has(r.id) : r.kind === 'emblem' ? o.emblem.has(r.id) : r.kind === 'camo' ? o.camo.has(`ar/${r.id}`)
    : r.kind === 'skin' ? o.skin.has(r.id) : r.kind === 'operator' ? o.operator.has(r.id) : r.kind === 'weapon' ? o.gear.has(`weapon:${r.id}`) : false)).map(r => `${r.tier} ${r.own}`);
  assert.deepEqual(notOpen, []);
  assert.ok(diff(was.finisher, o.finisher).length + diff(was.emote, o.emote).length >= 2, 'the season-tier finisher and emote');
  // Equip one of each.
  const card = owned.find(r => r.kind === 'card').id, emb = owned.find(r => r.kind === 'emblem').id, camo = owned.find(r => r.kind === 'camo').id;
  const skin = owned.find(r => r.kind === 'skin').id;
  assert.ok(Progress.setCard(card), 'season card equips');
  assert.ok(Progress.setEmblem(emb), 'season emblem equips');
  assert.ok(Progress.setCamo('ar', camo), 'season camo equips');
  assert.ok(Progress.setOperatorSkin(getSkin(skin).operator, skin), 'season skin equips');
  assert.ok(C.cardHtml(card, { size: 100 }).includes(info.def.name) || C.cardHtml(card, { size: 100 }).length > 200, 'season card draws');
});

test('SY4 code round trip: every unlock and every pick survives, and the code re-exports byte for byte', () => {
  assert.ok(Progress.setFinisher('trooper', 'derail'));
  Progress.setOperatorSkin('anvil', 'skin:anvil-5');
  Progress.recordZm('ashgrove', 23);
  // Graveyard Shift records ride the code too: the best round and the feats (Lantern Out's Gravewarden was match 7).
  const picks = () => ({ card: Progress.card, emblem: Progress.emblem(), camo: Progress.camo('ar'), skin: Progress.operatorSkin('anvil'), fin: Progress.finisherFor('trooper'),
    zm: [Progress.zmBest('ashgrove'), JSON.stringify(Progress.zmFeats(MAP_LIST[7]))] });
  const want = opened(), wantPicks = picks(), wantRecords = Progress.records();
  const code = Progress.exportCode();
  assert.ok(code.startsWith('SY4.'));
  const blank = encodeSave(P.blankSave());
  assert.ok(Progress.importCode(blank).ok);
  assert.ok(opened().card.size < want.card.size, 'a blank save has the cards locked again');
  assert.ok(Progress.importCode(code).ok);
  const got = opened();
  for (const k of Object.keys(want)) assert.deepEqual([...got[k]].sort(), [...want[k]].sort(), k);
  assert.deepEqual(picks(), wantPicks);
  assert.equal(Progress.exportCode(), code, 'byte for byte');
  const back = decodeSave(code);
  assert.ok(back.ok);
  // The personal bests ride the code (tail [22]); a code from before them imports and re-exports unchanged.
  assert.ok(Object.keys(back.save.records ?? {}).length === 4, `records in the code: ${JSON.stringify(back.save.records)}`);
  const old = { ...back.save }; delete old.records;
  const oldCode = encodeSave({ ...old, records: {} });
  assert.ok(Progress.importCode(oldCode).ok, 'a code without records imports');
  assert.equal(Progress.exportCode(), oldCode, 'and re-exports byte for byte');
  assert.equal(Progress.records().streak, 0, 'no records from it');
  assert.ok(Progress.importCode(code).ok);
  assert.equal(Progress.records().streak, wantRecords.streak, 'records back');
});

test('Champion (feat emblem): the best ranked division ever reached, from a past season or this one', () => {
  const champ = ALL_EMBLEMS.find(e => e.id === 'feat-champion');
  assert.equal(EMB.emblemUnlocked(champ, { ...C.careerNow(), rankedBest: 5 }).unlocked, false, 'Master is not Champion');
  assert.equal(EMB.emblemUnlocked(champ, { ...C.careerNow(), rankedBest: 6 }).unlocked, true, 'Champion');
  const code = Progress.exportCode(), s = decodeSave(code).save;
  s.season = { ...s.season, rr: { ...(s.season?.rr ?? {}), S1: 6 } };
  assert.ok(Progress.importCode(encodeSave(s)).ok);
  assert.equal(Progress.records().rankedBest, 6, 'a past season paid Champion');
  assert.ok(C.emblems().find(x => x.emblem.id === 'feat-champion')?.unlocked, 'the emblem shows earned');
  assert.ok(Progress.importCode(code).ok);
});

test('mastery rewards: every skin and card a track grants shows up once its tier is reached', () => {
  const got = Progress.rewards();
  for (const t of MASTERY_TRACKS) for (const c of t.tiers) for (const r of c.rewards) if (r.id) assert.ok(got.has(r.id), `${t.id}: ${r.id}`);
  for (const w of WEAPON_IDS) if (w !== GOLDEN_ID) assert.ok(got.has(`card:gun-${w}`), `ladder card ${w}`);
});

test('daily and weekly challenges: a real match tally moves them by exactly what it counted', () => {
  Challenges.reset();
  const now = new Date(2026, 10, 12, 12);
  const list = [...Challenges.list('daily', now), ...Challenges.list('weekly', now)];
  // A match from the sim that counted each challenge's stat.
  for (const c of list) {
    const mode = MODE_IDS.find(m => (seen[m]?.tally?.[c.stat] ?? 0) > 0);
    assert.ok(mode, `${c.id}: no mode counts ${c.stat}`);
    const before = Challenges.list(c.period, now).find(x => x.id === c.id).value;
    const out = Challenges.apply({ [c.stat]: 1 }, now);
    const after = Challenges.list(c.period, now).find(x => x.id === c.id).value;
    assert.equal(after, Math.min(c.goal, before + 1), c.id);
    if (before < c.goal) assert.ok(out.moved.some(m => m.id === c.id), `${c.id} reported`);
  }
});

test('Graveyard Shift through MatchAwards: weapon XP (capped) and the mode\'s records move; kills, challenges, camos and boards do not', async () => {
  const { MatchAwards } = await import('../js/game/awards.js');
  const { ZM } = await import('../js/shared/zombies.js');
  Challenges.reset();
  const now = new Date();
  const roster = buildRoster([], { mode: 'zm', mapId: 'neon', seed: 4 });
  const sim = new Sim({ roster, map: 'neon', seed: 4, mode: 'zm' });
  const me = roster.find(r => !r.zk && !r.isZombie && r.loadout);
  const aw = new MatchAwards({ localId: me.id, team: me.team, loadout: me.loadout });
  const lifeBefore = Progress.lifetime(), boardBefore = Progress.careerCard();
  const statsBefore = Object.fromEntries(WEAPON_IDS.map(w => [w, Progress.weaponStats(w)]));
  const chalBefore = JSON.stringify(Challenges.all(now));
  let view = null;
  for (let i = 0; i < 300 * SIM_HZ && sim.phase !== 'ended'; i++) {
    sim.step(1 / SIM_HZ);
    view = sim.getView(me.id);
    aw.onEvents(sim.drainEvents(), view);
  }
  const r = aw.finish(view);
  assert.ok(r.zm && aw.kills > 0, `the horde was killed (${aw.kills})`);
  for (const w of WEAPON_IDS) {
    const a = statsBefore[w], b = Progress.weaponStats(w);
    for (const k of ['kills', 'head', 'long', 'slide', 'clean']) assert.equal(b[k] ?? 0, a[k] ?? 0, `${w} ${k}`);
  }
  assert.ok(r.weapons.some(w => w.xpGained > 0) && r.weapons.every(w => w.xpGained <= ZM.weaponXpCap), 'weapon XP, capped');
  const life = Progress.lifetime();
  for (const k of Object.keys(life)) if (/^(kills|head|long|cat:|gun:|hipKills|closeKills|slideKills)/.test(k)) assert.equal(life[k], lifeBefore[k], `lifetime ${k}`);
  assert.ok((life['zm:kills'] ?? 0) > (lifeBefore['zm:kills'] ?? 0), 'lifetime zm:kills');
  assert.equal(Progress.careerCard().k, boardBefore.k, 'board kills');
  const chal = Challenges.all(now);
  for (const c of [...chal.daily, ...chal.weekly]) if (!/^played|^wins|^mode\.zm/.test(c.stat ?? '') && !/played/.test(P.getChallenge(c.id).stat)) {
    const was = JSON.parse(chalBefore)[c.period].find(x => x.id === c.id);
    assert.equal(c.value, was.value, `${c.id} (${P.getChallenge(c.id).stat}) moved in Graveyard Shift`);
  }
  assert.equal(r.unlocks.filter(u => u.kind === 'camo' || u.kind === 'operator' || u.kind === 'pro').length, 0, 'no camo, operator or Pro unlock from the horde');
});

/* ================= Report ================= */
export { seen, problems, test, store };
if (process.argv[1]?.endsWith('sim-unlocks.mjs')) {
  console.log(`\n${passed} checks passed${problems.length ? `, ${problems.length} failed:\n  ${problems.join('\n  ')}` : ''}`);
  if (process.argv.includes('dump')) console.log(JSON.stringify(seen, null, 1));
  process.exitCode = problems.length ? 1 : 0;
}
