// Weekly events, headless (docs/SEASONS.md "Weekly events", js/shared/events.js).
//   A. Rotation: a year of days from the epoch, deterministic (the same answer twice, and in other time zones for the
//      same local date), a new event every Monday 00:00 local, every event in turn, no week twice in a row.
//   B. Data: ids and reward ids unique and present in the card and emblem tables, the playlist's modifiers survive
//      cleanMods for its mode, the tab plays the mode, the Spotlight carries it in the agreed order.
//   C. Rewards: through the real Progress API (a stand-in localStorage): challenges move only for the event's own
//      matches, the reward is paid once ever (a later run of the same event pays nothing new), it is owned and survives
//      a save code round trip, and the unlock sheet's Play now follows the calendar.
//   D. Achievable: bot matches in each event's mode with its modifiers (the way dev/sim-unlocks.mjs plays its modes: a
//      ChallengeTally on every player), so every challenge's stat is shown to move in the event's own matches, and the
//      goal is within reach in a sensible number of matches.
// Run: node dev/sim-events.mjs [quick]   (quick: skips the Graveyard Shift match and plays one seed per event)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';

// js/ui/matchmaking.js reaches the renderer (the vote's map cards), which imports 'three' by bare name: point node at
// the vendored copy, as dev/sim-attachments.mjs does.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: ${JSON.stringify(new URL('../vendor/three.min.js', import.meta.url).href)}, shortCircuit: true };
  return next(s, c); }`));

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const QUICK = process.argv.includes('quick');

const EV = await import('../js/shared/events.js');
const { EVENTS, EVENT_IDS, weeklyEventAt, eventWeek, eventOfWeek, nextRun, applyEventMatch, blankEventState, cleanEventState, EVENT_CHALLENGE_XP } = EV;
const { cleanMods, dealLoadout } = await import('../js/shared/playlist.js');
const { MODES } = await import('../js/shared/modes.js');
const { MAPS } = await import('../js/shared/map.js');
const { SIM_HZ, WEAPON_CATEGORY } = await import('../js/shared/constants.js');
const { Sim, buildRoster } = await import('../js/sim/sim.js');
const { objOf } = await import('../js/sim/rules.js');
const { ChallengeTally, CARD_IDS } = await import('../js/shared/progression.js');
const { ALL_EMBLEMS } = await import('../js/ui/emblems.js');
const { playlistsFor, resolveSelection, mpVoteOptions, modesFor, MP_TAB_IDS } = await import('../js/ui/matchmaking.js');
await import('../js/ui/cards.js');
const { Progress } = await import('../js/ui/progress.js');
const { getCard } = await import('../js/shared/progression.js');

let passed = 0;
const problems = [];
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { problems.push(name); console.log(`FAIL ${name}\n     ${err.message.split('\n').join('\n     ')}`); }
};
const dupes = list => list.filter((x, i) => list.indexOf(x) !== i);
const day = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

/* ================= A. Rotation ================= */
await test('a year of days: one event a week, Monday to Sunday, in turn, deterministic', () => {
  assert.ok(EVENTS.length >= 8, 'at least eight events');
  const start = day(2026, 11, 16);
  assert.equal(start.getDay(), 1, 'the epoch is a Monday');
  let last = null, seen = new Set(), weeks = 0;
  for (let i = 0; i < 371; i++) {
    const d = new Date(2026, 10, 16 + i, 12), e = weeklyEventAt(d), again = weeklyEventAt(new Date(d));
    assert.deepEqual(e, again, 'same answer twice');
    const late = weeklyEventAt(new Date(2026, 10, 16 + i, 23, 59, 59)), early = weeklyEventAt(new Date(2026, 10, 16 + i, 0, 0, 0));
    assert.equal(late.key, e.key, 'the whole day is one event'); assert.equal(early.key, e.key);
    if (d.getDay() === 1) {
      assert.notEqual(e.key, last?.key, `a new week on Monday ${d.toDateString()}`);
      if (last) assert.notEqual(e.id, last.id, 'never the same event two weeks running');
      assert.equal(new Date(e.startsAt).getDay(), 1, 'starts on a Monday');
      assert.equal(new Date(e.startsAt).getHours(), 0, 'at local midnight');
      assert.equal(new Date(e.endsAt).getHours(), 0, 'ends at local midnight');
      assert.equal(new Date(e.endsAt).getDay(), 1, 'ends the next Monday');
      assert.ok(e.startsAt <= d.getTime() && d.getTime() < e.endsAt, 'now inside the window');
      weeks++;
    } else assert.equal(e.key, last.key, `${d.toDateString()} keeps the week's event`);
    assert.ok(e.daysLeft >= 1 && e.daysLeft <= 7, 'days left 1..7');
    seen.add(e.id); last = e;
  }
  assert.equal(weeks, 53);
  assert.deepEqual([...seen].sort(), [...EVENT_IDS].sort(), 'every event ran in the year');
  // In turn: week w is event w mod n, and it keeps going (ten years on).
  for (let w = 0; w < 600; w++) assert.equal(eventOfWeek(w).id, EVENT_IDS[w % EVENTS.length]);
  assert.equal(eventWeek(day(2036, 11, 17)), Math.floor((Date.UTC(2036, 10, 17) - Date.UTC(2026, 10, 16)) / 864e5 / 7));
  // nextRun: the week it is on, or the next time round.
  for (const id of EVENT_IDS) {
    const n = nextRun(id, day(2026, 11, 18));
    assert.equal(eventOfWeek(n.week).id, id);
    assert.ok(n.week >= 0 && n.week < EVENTS.length);
  }
});

await test('other time zones agree on the same local date', () => {
  const dates = ['2026-11-16T00:00:01', '2026-11-22T23:59:00', '2026-12-28T09:00:00', '2027-03-29T01:30:00', '2027-10-31T02:30:00'];
  const script = `import('${new URL('../js/shared/events.js', import.meta.url).href}').then(m => console.log(JSON.stringify(${JSON.stringify(dates)}.map(s => m.weeklyEventAt(new Date(s)).key))))`;
  const outs = ['UTC', 'Pacific/Auckland', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata'].map(TZ =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ } }).toString().trim());
  for (const o of outs) assert.equal(o, outs[0], 'every zone reads the same weeks');
});

/* ================= B. Data ================= */
await test('events: ids, rewards, challenges, modifiers and tabs', () => {
  assert.deepEqual(dupes(EVENT_IDS), [], 'event ids');
  assert.deepEqual(dupes(EVENTS.map(e => e.reward.id)), [], 'reward ids');
  assert.deepEqual(dupes(EVENTS.flatMap(e => e.challenges.map(c => c.id))), [], 'challenge ids');
  const cards = new Set(CARD_IDS), embs = new Set(ALL_EMBLEMS.map(e => e.id));
  for (const e of EVENTS) {
    assert.ok(e.challenges.length >= 3 && e.challenges.length <= 4, `${e.id}: 3-4 challenges`);
    assert.ok(e.reward.kind === 'card' ? cards.has(e.reward.id) : embs.has(e.reward.id), `${e.id}: reward ${e.reward.id} registered`);
    assert.ok(MODES[e.mode], `${e.id}: mode`);
    assert.deepEqual(cleanMods(e.mods, e.mode), e.mods, `${e.id}: modifiers survive cleanMods for ${e.mode}`);
    assert.ok(MP_TAB_IDS.includes(e.tab), `${e.id}: tab`);
    const onTab = modesFor(e.tab).includes(e.mode) || playlistsFor(e.tab).some(p => p.modes.includes(e.mode));
    assert.ok(onTab, `${e.id}: ${e.mode} plays on the ${e.tab} tab`);
    assert.ok(mpVoteOptions(e.tab, [e.mode], () => 0.3).length > 0, `${e.id}: the vote finds maps`);
  }
  // The event-only modifiers stay out of everything else.
  assert.deepEqual(cleanMods(['gloves'], 'tdm'), []);
  assert.deepEqual(cleanMods(['night'], 'tdm'), []);
  assert.deepEqual(cleanMods(['hardcore'], 'br'), [], 'battle royale still takes no ordinary modifier');
  assert.deepEqual(cleanMods(['pistols'], 'gun'), [], 'dealt modes ignore Pistols Only');
  const lo = dealLoadout({ primary: 'ar', secondary: 'launcher', streaks: [], camos: {}, attachments: {} }, ['pistols']);
  assert.equal(WEAPON_CATEGORY[lo.primary], 'Pistol'); assert.equal(WEAPON_CATEGORY[lo.secondary], 'Pistol'); assert.notEqual(lo.primary, lo.secondary);
});

await test('the Spotlight: the weekly event plays on its own tab, order tournament > event > ranked > featured', () => {
  for (let w = 0; w < EVENTS.length; w++) {
    const d = new Date(2026, 10, 17 + w * 7, 12), ev = weeklyEventAt(d);
    const list = playlistsFor('standard', d), p = list.find(x => x.id === 'wkevent');
    assert.ok(p, `${ev.id}: on Standard`);
    assert.equal(p.wkevent, ev.id); assert.equal(p.tab, ev.def.tab);
    assert.match(p.sub, /days left|last day/);
  }
  const d = new Date(2026, 10, 18, 12), id = weeklyEventAt(d).id;
  const r = resolveSelection('standard', { playlist: 'wkevent', modes: [] }, { hardcore: true });
  assert.equal(r.event, id); assert.equal(r.tab, weeklyEventAt().def.tab);
  // The layout's order rule (js/ui/playscreens.js mpGroups), checked on its source.
  return import('node:fs').then(fs => {
    const src = fs.readFileSync(new URL('../js/ui/playscreens.js', import.meta.url), 'utf8');
    assert.match(src, /p\.tournament \? 0 : p\.wkevent \? 1 : p\.event \? 2 : p\.ranked \? 3 : p\.featured \? 4/);
  });
});

/* ================= C. Rewards once ================= */
await test('state: challenges move only in the event\'s own matches; the reward is paid once', () => {
  const s = blankEventState(), wk0 = new Date(2026, 10, 18, 12), e0 = weeklyEventAt(wk0).def;
  const full = Object.fromEntries(e0.challenges.map(c => [c.stat, c.goal * 2]));
  assert.equal(applyEventMatch(s, 'nope', full, wk0), null, 'another event: nothing');
  assert.equal(applyEventMatch(s, null, full, wk0), null, 'not an event match: nothing');
  const r = applyEventMatch(s, e0.id, full, wk0);
  assert.equal(r.moved.length, e0.challenges.length);
  assert.equal(r.xp, e0.challenges.length * EVENT_CHALLENGE_XP);
  assert.equal(r.reward.fresh, true); assert.deepEqual(s.got, [e0.id]);
  const again = applyEventMatch(s, e0.id, full, wk0);
  assert.equal(again.moved.length, 0, 'done is done'); assert.equal(again.reward, null);
  // The same event a full cycle later: the challenges are fresh, the reward is not paid twice.
  const later = new Date(2026, 10, 18 + EVENTS.length * 7, 12);
  assert.equal(weeklyEventAt(later).id, e0.id);
  const r2 = applyEventMatch(s, e0.id, full, later);
  assert.equal(r2.moved.length, e0.challenges.length, 'a new run, new progress');
  assert.equal(r2.reward.fresh, false, 'owned already'); assert.deepEqual(s.got, [e0.id]);
  // A match from last week that ends on Monday counts for nothing.
  const monday = new Date(2026, 10, 23, 0, 5);
  assert.equal(applyEventMatch(s, e0.id, full, monday), null);
  // Clean: junk dropped, progress capped.
  const c = cleanEventState({ k: s.k, c: { [`${e0.id}.play`]: 999, junk: 3 }, got: ['nope', e0.id, e0.id] });
  assert.deepEqual(c.got, [e0.id]); assert.equal(c.c[`${e0.id}.play`], e0.challenges[0].goal); assert.equal(c.c.junk, undefined);
});

await test('Progress: every event pays its reward once, owned, in the unlock lists and through a save code', () => {
  const real = Date;
  for (let w = 0; w < EVENTS.length; w++) {
    const at = new real(2026, 10, 18 + w * 7, 12), e = weeklyEventAt(at).def;
    const own = `${e.reward.kind}:${e.reward.id}`;
    assert.equal(Progress.hasReward(own), false, `${e.id}: not owned before`);
    const st = Progress.weeklyEvent(at);
    assert.equal(st.info.id, e.id); assert.equal(st.done, 0); assert.equal(st.owned, false);
    // A part of the goals in one match, the rest in the next: one reward, paid in the second.
    const half = Object.fromEntries(e.challenges.map(c => [c.stat, Math.max(1, Math.floor(c.goal / 2))]));
    const a = Progress.applyEventMatch(e.id, half, at);
    assert.equal(a.reward, null, `${e.id}: not yet`);
    const b = Progress.applyEventMatch(e.id, Object.fromEntries(e.challenges.map(c => [c.stat, c.goal])), at);
    assert.equal(b.reward?.fresh, true, `${e.id}: paid`);
    assert.equal(Progress.hasReward(own), true, `${e.id}: owned`);
    assert.equal(Progress.weeklyEvent(at).owned, true);
    const c = Progress.applyEventMatch(e.id, Object.fromEntries(e.challenges.map(x => [x.stat, 99])), at);
    assert.equal(c.reward, null, `${e.id}: once`);
    if (e.reward.kind === 'card') assert.ok(Progress.cards().find(x => x.card.id === e.reward.id)?.unlocked, `${e.id}: the card shows unlocked`);
  }
  const code = Progress.exportCode();
  store.clear();
  return import('../js/shared/progression.js').then(P => {
    assert.ok(Progress.importCode(P.encodeSave(P.blankSave())).ok);
    assert.equal(Progress.hasReward(`card:${EVENTS[0].reward.id}`), false, 'a blank save owns nothing');
    assert.ok(Progress.importCode(code).ok);
    for (const e of EVENTS) assert.equal(Progress.hasReward(`${e.reward.kind}:${e.reward.id}`), true, `${e.id}: back from the code`);
  });
});

await test('unlock sheets: the reward says when its event runs and offers Play now only while it is on', () => {
  const on = weeklyEventAt(), other = EVENTS.find(e => e.id !== on.id);
  assert.match(EV.rewardHow(on.id), /on now/);
  assert.match(EV.rewardHow(other.id), /next on [A-Z][a-z]{2} \d{1,2}/);
  assert.deepEqual(EV.rewardPlay(on.id), { tab: 'standard', playlist: 'wkevent' });
  assert.equal(EV.rewardPlay(other.id), null);
  const card = EVENTS.find(e => e.reward.kind === 'card');
  assert.equal(getCard(card.reward.id).group, 'Events');
  assert.match(getCard(card.reward.id).req, /Weekly event/);
});

/* ================= D. Achievable in their own matches ================= */
const mapFor = (mode, seed) => {
  const fits = mpVoteOptions(EVENTS.find(e => e.mode === mode)?.tab ?? 'standard', [mode], () => (seed * 0.37) % 1);
  return fits[0]?.mapId;
};
function runEvent(e, seed) {
  const mapId = mapFor(e.mode, seed), map = MAPS[mapId];
  const roster = buildRoster([], { botSkill: 'mixed', mode: e.mode, mapId, seed });
  const sim = new Sim({ roster, map, seed, mode: e.mode, mods: cleanMods(e.mods, e.mode) });
  const ids = roster.filter(r => !(e.mode === 'zm' && r.team === 1)).map(r => r.id);     // Graveyard Shift: the crew, not the horde.
  const tallies = ids.map(id => new ChallengeTally(id));
  const m = MODES[e.mode], span = m.rounds ? m.timeLimit * (m.scoreLimit * 2 - 1) : m.timeLimit;
  const limit = Math.min(e.mode === 'zm' ? 900 : 1500, (span ?? 600) + 120);
  let view = null;
  for (let i = 0; i < limit * SIM_HZ && sim.phase !== 'ended'; i++) {
    sim.step(1 / SIM_HZ);
    const ev = sim.drainEvents();
    view = sim.getView(ids[0]);
    for (const t of tallies) t.onEvents(ev, view);
  }
  const ended = sim.phase === 'ended', ffa = !!m.ffa, zm = objOf(view)?.zm ? objOf(view) : null;
  const per = ids.map((id, k) => {
    const me = view.players.find(p => p.id === id);
    let place = null;
    if (ffa && me) place = Number.isFinite(me.place) ? me.place : 1 + view.players.filter(p => p.id !== me.id && (view.scores[p.team] ?? 0) > (view.scores[me.team] ?? 0)).length;
    const won = ended && (ffa ? place === 1 : view.winner === me?.team);
    const brPlace = view.br && me ? (won ? 1 : me.place || null) : null;
    const counts = { ...tallies[k].finish({ won, place: ended ? place : null, brPlace }) };
    if (zm) counts['zm:rounds'] = Math.max(0, (zm.round ?? 1) - 1);
    return counts;
  });
  return { mapId, ended, t: Math.round(sim.time), per, scores: view.scores, special: zm ? sim.rules.special : null, night: zm ? sim.rules.night : null };
}

for (const e of EVENTS) {
  if (QUICK && e.mode === 'zm') continue;
  if (process.argv.includes('zm') && e.mode !== 'zm') continue;
  await test(`${e.id}: every challenge moves in ${MODES[e.mode].name} with ${e.mods.join(', ') || 'no modifiers'}`, () => {
    const runs = (QUICK ? [1] : [1, 2]).map(seed => runEvent(e, seed));
    console.log(`     ${runs.map(r => `${r.mapId} ${r.t}s${r.ended ? '' : ' (cut)'}`).join(', ')}`);
    for (const c of e.challenges) {
      // The best player's share, and the field's average: the goal within ~8 matches for an average player.
      const vals = runs.flatMap(r => r.per.map(p => p[c.stat] ?? 0));
      const best = Math.max(...vals), mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      assert.ok(best > 0, `${c.label}: ${c.stat} never moved`);
      const matches = c.goal / Math.max(mean, 1e-9);
      console.log(`       ${c.label.padEnd(44)} best ${best}, mean ${mean.toFixed(2)} a match, ~${matches.toFixed(1)} matches`);
      assert.ok(matches <= 12 || /^(won|top3|rb:top5|inf:survived)/.test(c.stat), `${c.label}: about ${matches.toFixed(1)} matches for an average player`);
    }
    if (e.mods.includes('gloves')) {
      const kills = runs.flatMap(r => r.per.map(p => Object.keys(p).filter(k => k.startsWith('gun:') && k !== 'gun:knife'))).flat();
      assert.deepEqual([...new Set(kills)], [], 'Gloves Only: no gun kills');
    }
    if (e.mods.includes('snipers') && MODES[e.mode].rules === 'br') {
      const cats = new Set(runs.flatMap(r => r.per.flatMap(p => Object.keys(p).filter(k => k.startsWith('cat:')))));
      assert.ok([...cats].every(k => ['cat:Sniper', 'cat:Pistol', 'cat:Melee'].includes(k)), `Snipers Only Rebound: kills by ${[...cats]}`);
    }
    if (e.mods.includes('pistols')) {
      const cats = new Set(runs.flatMap(r => r.per.flatMap(p => Object.keys(p).filter(k => k.startsWith('cat:')))));
      assert.ok([...cats].every(k => ['cat:Pistol', 'cat:Melee'].includes(k)), `Pistols at Dawn: kills by ${[...cats]}`);
    }
    if (e.mods.includes('night')) assert.ok(runs.every(r => r.night), 'Night is on');
  });
}

await test('Night Graveyard: the fog every round but the boss rounds, points paid double', async () => {
  const { isBossRound } = await import('../js/shared/zombies.js');
  const mk = mods => new Sim({ roster: buildRoster([], { botSkill: 'mixed', mode: 'zm', mapId: 'neon', seed: 5 }), map: MAPS.neon, seed: 5, mode: 'zm', mods });
  const night = mk(['night']), day = mk([]);
  night.step(1 / SIM_HZ); day.step(1 / SIM_HZ);
  for (let r = 1; r <= 12; r++) {
    night.rules._startRound(r); day.rules._startRound(r);
    assert.equal(night.rules.special, isBossRound(r) ? day.rules.special : 'fog', `round ${r}`);
  }
  night.drainEvents(); day.drainEvents();
  const p = { zm: { pts: 0, earned: 0 } };
  night.rules._pay(p, 50); assert.equal(p.zm.pts, 100, 'double');
  const q = { zm: { pts: 0, earned: 0 } };
  day.rules._pay(q, 50); assert.equal(q.zm.pts, 50, 'normal without Night');
});

// The seasons' limited-time events (js/shared/season-items.js `event`, days 7-20 or 14-27): each one's playlist keeps
// its modifiers, plays to an end in bot matches, and the modifier holds (Lightning Rod, Season 3: Snipers Only Grind,
// so sniper rifles and the secondary slot only, and the tags still bank).
const { SEASON_DEFS } = await import('../js/shared/season-items.js');
for (const def of SEASON_DEFS) {
  const e = def.event;
  if (QUICK && def.n < SEASON_DEFS.length) continue;
  await test(`season ${def.n} event ${e.id}: ${MODES[e.mode].name} with ${e.mods.join(', ')} plays`, () => {
    assert.ok(MODES[e.mode] && modesFor('standard').includes(e.mode), 'a Standard mode');
    assert.deepEqual(cleanMods(e.mods, e.mode), e.mods, 'its modifiers survive cleanMods');
    assert.ok(e.from >= 0 && e.to > e.from && e.to <= 42, 'inside the season');
    assert.ok(!EVENTS.some(w => w.id === e.id || w.name === e.name), 'a name of its own (not a weekly event)');
    const runs = (QUICK ? [1] : [1, 2]).map(seed => runEvent({ ...e, challenges: [] }, seed));
    console.log(`     ${runs.map(r => `${r.mapId} ${r.t}s${r.ended ? '' : ' (cut)'}`).join(', ')}`);
    const kills = runs.flatMap(r => r.per.map(p => p.kills ?? 0)), total = kills.reduce((a, b) => a + b, 0);
    assert.ok(total > 10, `kills happen (${total})`);
    if (e.mods.includes('snipers')) {
      const cats = new Set(runs.flatMap(r => r.per.flatMap(p => Object.keys(p).filter(k => k.startsWith('cat:') && p[k] > 0))));
      // Snipers Only in a 6v6 mode swaps the primary only: the secondary slot (a pistol or a launcher) stays, as in the pickers.
      assert.ok([...cats].every(k => ['cat:Sniper', 'cat:Pistol', 'cat:Launcher', 'cat:Melee'].includes(k)), `Snipers Only: kills by ${[...cats]}`);
      assert.ok(cats.has('cat:Sniper'), 'sniper kills happen');
    }
    if (e.mode === 'grind') {
      const banked = runs.map(r => Object.values(r.scores ?? {}).reduce((a, b) => a + (Number(b) || 0), 0));
      console.log(`     team scores (tags banked): ${banked.join(', ')}`);
      assert.ok(banked.every(n => n > 0), 'tags are banked with sniper rifles too');
    }
  });
}

console.log(`\n${passed} passed, ${problems.length} failed${problems.length ? `: ${problems.join('; ')}` : ''}`);
process.exit(problems.length ? 1 : 0);
