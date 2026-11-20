// Seasons and ranked (js/shared/seasons.js, js/shared/ranked.js, js/shared/season-items.js; docs/SEASONS.md).
// node dev/sim-seasons.mjs
//   schedule   season resolution on and across every boundary, the same in five time zones (fresh processes);
//              Preseason before Season 1; the event window
//   weekly     one set a week, opening on schedule, five challenges of different families, the same in every process;
//              only open weeks count; stars fill the track
//   replay     after the last scheduled season: Season Replay rotates the past seasons, fresh instances with their
//              tracks, weekly sets and events
//   track      tiers from XP, claims, ownership (cards, emblems, camos on every gun, skins, the early weapon and
//              operator paths), a rollover claims reached tiers for the player
//   dated      date-locked content waits for its season
//   ranked     placements, divisions, rating movement, the floor's protection, promotions, the seasonal reset,
//              end-of-season rewards; the pool's ranks are a function of the date alone
//   save       old SY4 codes load and re-export unchanged; this build's codes keep the season block (with or without a
//              career entry before it)
//   names      every season and ranked cosmetic name is unique against the game's other names
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

const S = await import('../js/shared/seasons.js');
const R = await import('../js/shared/ranked.js');
const I = await import('../js/shared/season-items.js');
const P = await import('../js/shared/progression.js');
const B = await import('../js/shared/boards.js');

// Child mode: print what this process (and its TZ) makes of a list of local times.
if (process.argv[2] === '--child') {
  const out = [];
  for (const [y, m, d, h, mi] of JSON.parse(process.argv[3])) {
    const at = new Date(y, m - 1, d, h, mi), s = S.seasonAt(at);
    out.push([s.key, s.week, s.daysLeft, S.eventAt(at)?.id ?? null, S.weeklySet(s.def ?? I.SEASON_DEFS[0], s.week).map(c => c.id).join(',')]);
  }
  const pool = B.poolEntries(new Date(2026, 11, 2, 15)).map(e => `${e.id}:${e.sn.sr}:${e.sn.t}:${e.sn.k}`).join('|');
  console.log(JSON.stringify({ out, pool }));
  process.exit(0);
}

const { Progress } = await import('../js/ui/progress.js');
const { CAMOS } = await import('../js/shared/camos.js');
const { SKINS, OPERATORS, getSkin, skinUnlock } = await import('../js/ui/operators.js');
const { ALL_EMBLEMS, EMBLEMS, getEmblem } = await import('../js/ui/emblems.js');

let failed = 0;
const ok = (cond, label, info = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${info ? `: ${info}` : ''}`); if (!cond) failed++; };
const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi);
const [S1, S2, S3] = I.SEASON_DEFS;

// ---- Schedule ----
console.log('schedule');
{
  const cases = [
    [[2026, 11, 11, 12], 'pre'], [[2026, 11, 15, 23, 59], 'pre'], [[2026, 11, 16, 0, 0], 'S1'], [[2026, 11, 16, 0, 1], 'S1'],
    [[2026, 12, 27, 23, 59], 'S1'], [[2026, 12, 28, 0, 0], 'S2'], [[2027, 2, 7, 23, 59], 'S2'], [[2027, 2, 8, 0, 0], 'S3'],
    [[2027, 3, 21, 23, 59], 'S3'], [[2027, 3, 22, 0, 0], 'S1R1'], [[2027, 5, 2, 23, 59], 'S1R1'], [[2027, 5, 3, 0, 0], 'S2R1'],
    [[2027, 6, 14, 0, 0], 'S3R1'], [[2027, 7, 26, 0, 0], 'S1R2'], [[2031, 6, 1, 9], null],
  ];
  for (const [t, key] of cases) if (key) ok(S.seasonAt(at(...t)).key === key, `${t.join('-')} is ${key}`, S.seasonAt(at(...t)).key);
  const s1 = S.seasonAt(at(2026, 11, 16, 9));
  ok(s1.title === 'Season 1: Cold Iron' && s1.day === 0 && s1.week === 0 && s1.daysLeft === 42, 'Season 1 opens on day 0 of 42', JSON.stringify([s1.title, s1.day, s1.daysLeft]));
  ok(S.seasonAt(at(2026, 12, 27, 20)).daysLeft === 1, 'the last day says one day left');
  ok(S.seasonAt(at(2026, 11, 11)).daysLeft === 5 && S.seasonAt(at(2026, 11, 11)).next.id === 'S1', 'the Preseason counts down to Season 1');
  ok(new Date(s1.endsAt).getDate() === 28 && new Date(s1.endsAt).getHours() === 0, 'a season ends at local midnight');
  ok(!S.eventAt(at(2026, 11, 29, 23)) && S.eventAt(at(2026, 11, 30, 0, 1))?.id === 'coldsnap' && S.eventAt(at(2026, 12, 13, 23))?.id === 'coldsnap' && !S.eventAt(at(2026, 12, 14, 0, 1)),
    'Cold Snap runs days 14 to 27 of Season 1');
  ok(S.eventAt(at(2027, 1, 4, 10))?.id === 'lightsout', 'Lights Out runs in Season 2');
  ok(!S.eventAt(at(2027, 2, 14, 23, 59)) && S.eventAt(at(2027, 2, 15, 0, 1))?.id === 'lightningrod' && S.eventAt(at(2027, 2, 28, 23, 59))?.id === 'lightningrod' && !S.eventAt(at(2027, 3, 1, 0, 1)),
    'Lightning Rod runs days 7 to 20 of Season 3 (Feb 15 - Feb 28)');
  const s3 = S.seasonAt(at(2027, 2, 8, 0, 0));
  ok(s3.title === 'Season 3: Third Rail' && s3.daysLeft === 42 && new Date(s3.endsAt).getMonth() === 2 && new Date(s3.endsAt).getDate() === 22, 'Season 3: Third Rail, 42 days to Mar 22', s3.title);
  // Five time zones, fresh processes: the same local times resolve alike everywhere.
  const times = [[2026, 11, 15, 23, 59], [2026, 11, 16, 0, 0], [2026, 11, 22, 23, 59], [2026, 11, 23, 0, 0], [2026, 11, 30, 0, 0], [2026, 12, 28, 0, 0], [2027, 2, 8, 0, 0], [2027, 2, 15, 0, 0], [2027, 3, 22, 0, 0], [2027, 6, 1, 13, 0]];
  const runs = ['UTC', 'Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Honolulu'].map(tz =>
    JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--child', JSON.stringify(times)], { env: { ...process.env, TZ: tz } }).toString()));
  ok(runs.every(r => JSON.stringify(r.out) === JSON.stringify(runs[0].out)), 'every time zone resolves the same local times alike', JSON.stringify(runs[0].out.map(o => o[0])));
  ok(runs.every(r => r.pool === runs[0].pool), "the pool's season ranks and windows are identical in every time zone");
}

// ---- Weekly sets ----
console.log('weekly');
{
  const weeks = S.weeklyAll(S1);
  ok(weeks.length === 6 && weeks.every(w => w.length === S.WEEKLY_PER_WEEK), 'six sets of five');
  ok(weeks.every(w => new Set(w.map(c => c.stat)).size === w.length), 'no repeated stat within a week');
  ok(new Set(weeks.flat().map(c => c.id)).size === 30, 'ids unique');
  const st = S.blankSeasonState();
  S.rollover(st, at(2026, 11, 22, 20));
  ok(S.weeklyStatus(st, at(2026, 11, 22, 23, 59)).filter(w => w.open).length === 1, 'day 6: week 1 only');
  ok(S.weeklyStatus(st, at(2026, 11, 23, 0, 0)).filter(w => w.open).length === 2, 'day 7 at midnight: week 2 opens');
  ok(S.weeklyStatus(st, at(2026, 12, 21, 9)).filter(w => w.open).length === 6, 'day 35: all six open');
  // Counting: a stat that only a later week asks for does not move it.
  const w2only = weeks[1].find(c => !weeks[0].some(x => x.stat === c.stat));
  const r = S.applySeasonMatch(st, { xp: 0, counts: { [w2only.stat]: 999 } }, at(2026, 11, 22, 21));
  ok(!r.challenges.some(c => c.id === w2only.id), 'a closed week does not count', w2only.id);
  const r2 = S.applySeasonMatch(st, { xp: 0, counts: { [w2only.stat]: 999 } }, at(2026, 11, 23, 9));
  ok(r2.challenges.some(c => c.id === w2only.id && c.fresh) && r2.stars >= w2only.stars, 'once open it counts and pays its stars', JSON.stringify(r2.challenges.map(c => c.id)));
  ok(r2.tierAfter >= r2.stars * S.STAR_TIERS, 'a star is a tier', `${r2.tierAfter}`);
  ok(S.weeklySet(S1, 2).map(c => c.label).join('|') === S.weeklySet(S1, 2).map(c => c.label).join('|'), 'sets are stable');
}

// ---- Season Replay ----
console.log('replay');
{
  // Season Replay starts once Season 3 ends (Mar 22, 2027): Cold Iron, Signal Fire, Third Rail, then round again.
  const r1 = S.seasonAt(at(2027, 3, 22, 10)), r2 = S.seasonAt(at(2027, 5, 3, 10)), r3 = S.seasonAt(at(2027, 6, 14, 10)), r4 = S.seasonAt(at(2027, 7, 26, 10));
  ok(r1.def.id === 'S1' && r1.replay === 1 && r1.title === 'Season Replay: Cold Iron', 'after Season 3: Cold Iron again', r1.title);
  ok(r2.def.id === 'S2' && r2.replay === 1 && r3.def.id === 'S3' && r3.replay === 1 && r3.title === 'Season Replay: Third Rail' && r4.def.id === 'S1' && r4.replay === 2,
    'then Signal Fire, then Third Rail, then round again', [r1, r2, r3, r4].map(r => r.key).join(','));
  ok(r1.startDay === S.seasonAt(at(2027, 3, 21, 23)).endDay && [r1, r2, r3, r4].every((r, i, a) => !i || r.startDay === a[i - 1].endDay) && [r1, r2, r3, r4].every(r => r.endDay - r.startDay === 42),
    'the replays run back to back from the end of Season 3, 42 days each');
  ok(S.eventAt(at(2027, 4, 7, 10))?.id === 'coldsnap' && S.eventAt(at(2027, 6, 22, 10))?.id === 'lightningrod', "a replay brings its season's event back");
  const st = S.blankSeasonState();
  S.rollover(st, at(2027, 3, 15));
  S.applySeasonMatch(st, { xp: S.TIER_XP * 30 }, at(2027, 3, 15));
  const ro = S.rollover(st, at(2027, 3, 23));
  ok(ro.changed && ro.claimed.length === 30 && st.k === 'S1R1' && st.xp === 0 && st.cl.S3 === 30, 'Season 3 ending claims its 30 reached tiers and starts the replay fresh', JSON.stringify([st.k, st.cl]));
  S.applySeasonMatch(st, { xp: S.TIER_XP * 5 }, at(2027, 3, 23));
  ok(S.claimTiers(st).length === 5 && st.cl.S1 === 5, 'the replay track pays its tiers');
  ok(S.weeklyStatus(st, at(2027, 3, 23)).length === 6, 'the replay has its weekly sets');
}

// ---- Track and ownership ----
console.log('track');
{
  ok(S.tierOf(0) === 0 && S.tierOf(S.TIER_XP - 1) === 0 && S.tierOf(S.TIER_XP) === 1 && S.tierOf(1e9) === 100, 'tiers from XP, capped at 100');
  const tr = I.trackRewards(S1);
  ok(tr.length === 100 && tr.every((r, i) => r.tier === i + 1), '100 tiers');
  const kinds = k => tr.filter(r => r.kind === k).length;
  ok(kinds('camo') === 10 && kinds('skin') === 8 && kinds('card') === 40 && kinds('emblem') === 40 && kinds('weapon') === 1 && kinds('operator') === 1, 'rewards across camos, skins, cards, emblems and two unlocks',
    ['camo', 'skin', 'card', 'emblem'].map(kinds).join('/'));
  ok(tr[24].kind === 'weapon' && tr[24].id === 'rotary' && tr[74].kind === 'operator' && tr[74].id === 'ghoul', 'tier 25 the Rotary early, tier 75 Ghoul early');
  ok(new Set(tr.map(r => r.own)).size === 100, 'no reward twice');
  // Through Progress, on a fresh save, in Season 1.
  const day = at(2026, 11, 20);
  Progress.season(day);
  ok(!Progress.isItemUnlocked('weapon', 'rotary') && !Progress.isOperatorUnlocked('ghoul'), 'a new player has neither yet');
  Progress.applySeasonMatch({ xp: S.TIER_XP * 80, counts: {}, career: { kills: 10, deaths: 5, won: true } }, day);
  const s = Progress.season(day);
  ok(s.tier === 80 && s.claimable === 80, 'eighty tiers to claim', `${s.tier}/${s.claimable}`);
  const got = Progress.claimSeason(day);
  ok(got.length === 80 && got.every(g => g.fresh) && Progress.season(day).claimable === 0, 'claimed, each new');
  const camo = tr.find(r => r.kind === 'camo'), skin = tr.find(r => r.kind === 'skin'), card = tr.find(r => r.kind === 'card'), emb = tr.find(r => r.kind === 'emblem');
  ok(Progress.isUnlocked('ar', camo.id) && Progress.isUnlocked('sniper', camo.id), 'a season camo is on every gun', camo.id);
  ok(Progress.setCamo('smg', camo.id) !== false && Progress.camo('smg') === camo.id, 'and can be worn');
  ok(Progress.hasReward(skin.id) && Progress.setOperatorSkin(getSkin(skin.id).operator, skin.id), 'the skin is earned and wearable', skin.id);
  ok(Progress.hasReward(card.own) && Progress.setCard(card.id), 'the calling card is earned and equips', card.id);
  ok(Progress.setEmblem(emb.id) && Progress.emblem() === emb.id, 'the emblem equips', emb.id);
  ok(Progress.isItemUnlocked('weapon', 'rotary') && Progress.isOperatorUnlocked('ghoul'), 'the early paths opened the Rotary and Ghoul');
  ok(!Progress.hasReward(tr[90].own), 'a tier not reached is not owned');
}

// ---- Date-locked content ----
console.log('dated');
{
  const c = I.seasonCamos(S2)[0];
  ok(S.dateLocked('camo', c.id, at(2026, 12, 27, 23, 59)) && !S.dateLocked('camo', c.id, at(2026, 12, 28, 0, 0)), 'a Season 2 camo waits for Season 2', c.id);
  ok(S.dateLocked('skin', `skin:${S2.skins[0][0]}-s2`, at(2026, 12, 1)) && !S.dateLocked('skin', `skin:${S2.skins[0][0]}-s2`, at(2027, 1, 1)), 'so does its skin set');
  ok(!S.dateLocked('map', 'railyard', at(2026, 11, 1)) && !S.dateLocked('weapon', 'ar', at(2026, 11, 1)), 'content no season names is never locked');
  ok(S.lockDay('camo', c.id) === S.dayNumber(at(2026, 12, 28)), 'its lock day is the season start');
  ok(I.seasonCamos(S3).every(x => S.dateLocked('camo', x.id, at(2027, 2, 7, 23, 59)) && !S.dateLocked('camo', x.id, at(2027, 2, 8, 0, 0)) && S.lockDay('camo', x.id) === S.dayNumber(at(2027, 2, 8))),
    'every Season 3 camo waits for Feb 8');
  ok(S3.skins.every(([op]) => S.dateLocked('skin', `skin:${op}-s3`, at(2027, 2, 7)) && !S.dateLocked('skin', `skin:${op}-s3`, at(2027, 2, 8))), 'so does the Third Rail skin set');
}

// ---- Ranked ----
console.log('ranked');
{
  ok(R.division(0).name === 'Bronze I' && R.division(299).name === 'Bronze I' && R.division(300).name === 'Bronze II' && R.division(899).name === 'Bronze III'
    && R.division(900).name === 'Silver I' && R.division(5399).name === 'Master III' && R.division(5400).name === 'Champion' && R.division(9999).code === 18, 'divisions and tiers');
  ok(R.fromCode(R.division(2000).code).name === R.division(2000).name && R.cleanCode(99) === -1 && R.cleanCode('x') === -1, 'badge codes');
  // Placements: five matches, then an SR from the base and how they went.
  const rk = R.blankRanked('S1');
  const res = [];
  for (let i = 0; i < 5; i++) res.push(R.applyRanked(rk, { outcome: i < 4 ? 'win' : 'loss', perf: 0.5, lobby: 1500, rating: 0.3 }));
  ok(res.slice(0, 4).every(r => !r.after && r.placement) && res[4].placedNow && R.placed(rk), 'placed after five', JSON.stringify(res.map(r => r.placement)));
  ok(rk.sr === R.placementSr({ base: -1, rating: 0.3, wins: 4, perf: 0.5 }) && rk.sr > R.ratingToSr(0.3) - 250, '4 of 5 won places above the rating', String(rk.sr));
  const strong = R.blankRanked('S1');
  for (let i = 0; i < 5; i++) R.applyRanked(strong, { outcome: 'win', perf: 1, rating: 1.2 });
  ok(strong.sr <= R.PLACEMENT_CAP, 'placements stop at Diamond III', String(strong.sr));
  // Movement.
  const w = R.srDelta({ outcome: 'win', perf: 0, sr: 2000, lobby: 2000 }), l = R.srDelta({ outcome: 'loss', perf: 0, sr: 2000, lobby: 2000 });
  ok(w === R.MOVE.win && l === -R.MOVE.loss, 'even strength: +48 / -42', `${w}/${l}`);
  ok(R.srDelta({ outcome: 'win', perf: 1, sr: 2000, lobby: 2000 }) > w && R.srDelta({ outcome: 'loss', perf: 1, sr: 2000, lobby: 2000 }) > l, 'playing well wins more and loses less');
  ok(R.srDelta({ outcome: 'win', perf: 0, sr: 2000, lobby: 2600 }) > w && R.srDelta({ outcome: 'loss', perf: 0, sr: 2000, lobby: 1400 }) < l, 'a stronger lobby pays more, a weaker one costs more');
  ok(R.srDelta({ outcome: 'win', perf: -1, sr: 5000, lobby: 1000 }) >= R.MOVE.min && R.srDelta({ outcome: 'loss', perf: 1, sr: 1000, lobby: 5000 }) <= -R.MOVE.min, 'a win always gains and a loss always costs');
  // The floor holds once, then gives.
  const fl = { ...R.blankRanked('S1'), pm: 5, sr: 1810, peak: 1810 };
  const a = R.applyRanked(fl, { outcome: 'loss', perf: 0, lobby: 1810 });
  ok(a.protectedLoss && fl.sr === 1800, 'the first loss below Gold stops on Gold I', String(fl.sr));
  R.applyRanked(fl, { outcome: 'loss', perf: 0, lobby: 1800 });
  ok(fl.sr < 1800 && R.division(fl.sr).div === 1, 'the next one drops to Silver', String(fl.sr));
  const up = { ...R.blankRanked('S1'), pm: 5, sr: 2690, peak: 2690, prot: 0 };
  const u = R.applyRanked(up, { outcome: 'win', perf: 0, lobby: 2690 });
  ok(u.promoted && u.after.name === 'Platinum I' && up.prot === 1 && up.peak === up.sr, 'promoted to Platinum, protected again', u.after.name);
  // The seasonal reset and its rewards.
  const st = S.blankSeasonState();
  S.rollover(st, at(2026, 12, 20));
  Object.assign(st.rk, { pm: 5, sr: 3000, peak: 3700 });
  const ro = S.rollover(st, at(2026, 12, 28, 8));
  ok(ro.ranked?.peakDiv === 4 && st.rr.S1 === 4, 'Season 1 pays on the best division reached (Diamond)', JSON.stringify(st.rr));
  ok(st.rk.k === 'S2' && !R.placed(st.rk) && st.rk.base === Math.floor(3000 * R.CARRY), 'Season 2 starts in placements from three quarters of the SR', JSON.stringify(st.rk));
  const own = S.seasonOwned(st);
  ok(['bronze', 'silver', 'gold', 'platinum', 'diamond'].every(d => own.has(`card:rk-s1-${d}`) && own.has(`emblem:rk-s1-${d}`)) && !own.has('card:rk-s1-master'), 'a card and an emblem for every division up to it');
  const pre = S.blankSeasonState();
  S.rollover(pre, at(2026, 11, 12));
  Object.assign(pre.rk, { pm: 5, sr: 2500, peak: 2600 });
  S.rollover(pre, at(2026, 11, 16, 1));
  ok(Object.keys(pre.rr).length === 0 && pre.rk.k === 'S1' && pre.rk.base === 1875, 'the Preseason resets but pays nothing');
  // Through Progress: a ranked match moves the rating; a normal one does not.
  const before = Progress.ranked(at(2026, 11, 20)).pm;
  Progress.applySeasonMatch({ xp: 3000, counts: {}, ranked: null }, at(2026, 11, 20));
  ok(Progress.ranked(at(2026, 11, 20)).pm === before, 'a normal match leaves ranked alone');
  const r1 = Progress.applySeasonMatch({ xp: 3000, counts: {}, ranked: { outcome: 'win', perf: 0.2, lobby: 1500, rating: 0.3 } }, at(2026, 11, 20));
  ok(r1.ranked?.placement === before + 1 && Progress.ranked(at(2026, 11, 20)).w >= 1, 'a ranked match counts a placement', JSON.stringify(r1.ranked?.placement));
  // Bots: ranks from the date alone; about half play ranked; spread over the divisions.
  const pe = B.poolEntries(at(2026, 12, 20));
  const placedBots = pe.filter(e => e.sn.sr >= 0), divs = new Set(placedBots.map(e => R.division(e.sn.sr).div));
  ok(placedBots.length > 40 && placedBots.length < 160 && divs.size >= 5, 'pool bots hold ranks across the divisions', `${placedBots.length} placed, ${divs.size} divisions`);
  const early = B.poolEntries(at(2026, 11, 16, 20));
  ok(early.filter(e => e.sn.sr >= 0).length < placedBots.length, 'fewer have placed on the first day');
  const board = B.buildBoard({ me: Progress.careerCard(at(2026, 12, 20)), cat: 'ranked', view: 'everyone', now: at(2026, 12, 20).getTime() });
  ok(board.rows.length === board.total && board.rows.every((r, i) => !i || r.value <= board.rows[i - 1].value), 'the Ranked board ranks by SR');
  const sb = B.buildBoard({ me: Progress.careerCard(at(2026, 12, 20)), cat: 'kills', view: 'season', now: at(2026, 12, 20).getTime() });
  ok(sb.rows.length > 100 && sb.cat.id === 'kills' && B.categoriesFor('season').every(c => !['level', 'mastery', 'wkills'].includes(c.id)), 'the Season view ranks the season window');
}

// ---- Save codes ----
console.log('save');
{
  const OLD = 'SY4.WzQsIk9sZE9wcyIsMCwwLDEsMzAsMCxbXSxbWyJBc3NhdWx0IiwiYXIiLCJwaXN0b2wiLHt9LFsibWFyYXRob24iLCJzY2F2ZW5nZXIiLCJ0cmFja2VyIl0sInNtb2tlIiwiZnJhZyIsWyJ1YXYiLCJ0dXJyZXQiLCJzdHJpa2UiXSwicmFtIl0sWyJSdXNoIiwic21nIiwicGlzdG9sIix7fSxbIm1hcmF0aG9uIiwic2NhdmVuZ2VyIiwidHJhY2tlciJdLCJzbW9rZSIsImZyYWciLFsidWF2IiwidHVycmV0Iiwic3RyaWtlIl0sIm1vbmFyY2giXSxbIkJyZWFjaCIsInNob3RndW4iLCJwaXN0b2wiLHt9LFsibWFyYXRob24iLCJzY2F2ZW5nZXIiLCJ0cmFja2VyIl0sInNtb2tlIiwiZnJhZyIsWyJ1YXYiLCJ0dXJyZXQiLCJzdHJpa2UiXSxudWxsXSxbIlN1cHByZXNzIiwibG1nIiwicGlzdG9sIix7fSxbIm1hcmF0aG9uIiwic2NhdmVuZ2VyIiwidHJhY2tlciJdLCJzbW9rZSIsImZyYWciLFsidWF2IiwidHVycmV0Iiwic3RyaWtlIl0sbnVsbF0sWyJPdmVyd2F0Y2giLCJzbmlwZXIiLCJwaXN0b2wiLHt9LFsibWFyYXRob24iLCJzY2F2ZW5nZXIiLCJ0cmFja2VyIl0sInNtb2tlIiwiZnJhZyIsWyJ1YXYiLCJ0dXJyZXQiLCJzdHJpa2UiXSxudWxsXV0sW10sW10sInlhcmQiLFtbInRyb29wZXIiLDUsWzAsNDAwLDEwMDAsMjAsMTJdXSxbImFudmlsIiwzLFswLDYwLDkwMCw0MSwzXV1dLFtdLFtbImFudmlsIiwic2tpbjphbnZpbC0zIl0sWyJ0cm9vcGVyIiwic2tpbjp0cm9vcGVyLTUiXSxbIndpc3AiLCJza2luOndpc3AtZmllbGQiXV0sbnVsbCxbWyJraWxscyIsNTAwXSxbImNhdDpTTUciLDYwXSxbInBsYW50cyIsMl1dXQ.9fu58v';
  // A code from before the progress reset (docs/RESET.md) is refused by the game; read past that, it still migrates.
  ok(P.decodeSave(OLD).error === 'reset', 'a code from before the reset is refused');
  const d = P.decodeSave(OLD, { preReset: true });
  ok(d.ok, 'an SY4 code from before seasons loads (read past the reset)');
  // (This one gains its prestige's peak level on its first load, before seasons; from then on it is stable.)
  const NORM = P.encodeSave(d.save);
  ok(P.encodeSave(P.decodeSave(NORM).save) === NORM, 'and its code re-exports unchanged');
  // A boards-era code (career entry, no season): loads and re-exports unchanged too.
  const withCareer = P.decodeSave(OLD, { preReset: true }).save;
  P.recordCareer(withCareer, { kills: 7, deaths: 3, won: true });
  const boardsCode = P.encodeSave(withCareer);
  ok(P.encodeSave(P.decodeSave(boardsCode).save) === boardsCode, 'a code with the boards entry and no season re-exports unchanged');
  // A rolled but untouched season block stays out of the code.
  const rolled = P.decodeSave(OLD, { preReset: true }).save;
  S.rollover(rolled.season, at(2026, 11, 20));
  ok(P.encodeSave(rolled) === NORM, 'a season block that only knows the date adds nothing');
  // This build's codes: the season block is the 19th entry, with null in the 18th when there is no career entry.
  const s = P.decodeSave(OLD, { preReset: true }).save;
  S.rollover(s.season, at(2026, 11, 20));
  S.applySeasonMatch(s.season, { xp: S.TIER_XP * 12, counts: { kills: 70 }, ranked: null }, at(2026, 11, 20));
  S.claimTiers(s.season);
  Object.assign(s.season.rk, { pm: 5, sr: 2222, peak: 2400, w: 9, l: 4 });
  s.season.rr.S1 = 2;
  const code = P.encodeSave(s), arr = JSON.parse(Buffer.from(code.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  ok(arr.length === 19 && arr[17] === null && arr[18].k === 'S1', 'the season block goes 19th, after a null career', arr.length);
  const back = P.decodeSave(code);
  ok(back.ok && JSON.stringify(back.save.season) === JSON.stringify(S.cleanSeasonState(s.season)), 'and comes back whole', JSON.stringify(back.save.season.cl));
  ok(P.encodeSave(back.save) === code, 'and re-exports unchanged');
  P.recordCareer(s, { kills: 4, deaths: 2, won: false });
  const both = P.encodeSave(s), arr2 = JSON.parse(Buffer.from(both.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  ok(arr2[17]?.m >= 1 && arr2[18]?.k === 'S1' && P.decodeSave(both).save.career.m === s.career.m, 'with a career, both entries survive');
  ok(both.length < 4000, 'the code stays short', both.length);
  // Through Progress: import a code with season progress and the rewards come with it.
  ok(Progress.importCode(code).ok && Progress.hasReward(I.trackRewards(S1)[11].own) && Progress.ranked(at(2026, 11, 20)).sr === 2222, 'Progress imports it with its rewards and rank');
  ok(Progress.hasReward('card:rk-s1-gold') && !Progress.hasReward('card:rk-s1-platinum'), 'ranked rewards come with it');
  // Junk in the block is cleaned, never thrown.
  const junk = S.cleanSeasonState({ k: '<x>', xp: -5, c: 999, wc: { 'S1.w1.kills': 1e12 }, cl: { S1: 1e9, S9: 4 }, rr: { S1: 99 }, rk: { sr: 1e12, pm: 99, k: 'S1' }, sn: { key: 'S2', m: 'x' } });
  ok(junk.k === '' && junk.xp === 0 && junk.c === 100 && junk.cl.S1 === 100 && !junk.cl.S9 && junk.rr.S1 === 6 && junk.rk.sr === R.SR_MAX && junk.rk.pm === 5, 'junk is cleaned', JSON.stringify(junk));
}

// ---- Season 2 (2026-12-28) and Season 3 (2027-02-08): the switches, played through Progress on a mocked clock, then Season Replay ----
console.log('season 2 and season 3');
{
  const { register } = await import('node:module');
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
    if (s === 'three') return { url: ${JSON.stringify(new URL('../vendor/three.min.js', import.meta.url).href)}, shortCircuit: true };
    return next(s, c); }`));
  const { playlistsFor, resolveSelection } = await import('../js/ui/matchmaking.js');
  const { WEAPONS } = await import('../js/shared/weapons.js');
  const { weeklyEventAt } = await import('../js/shared/events.js');
  const { CARD_IDS } = P;
  // Date is mocked the way the browser tests do it (every `new Date()` and Date.now() read the fake clock), so the code
  // paths that take no date (Progress.season(), the pickers, the boards) are exercised too.
  const Real = Date;
  let clock = new Real(2026, 11, 27, 22, 0).getTime();
  class Fake extends Real { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
  globalThis.Date = Fake;
  const setNow = (...a) => { clock = new Real(...a).getTime(); };
  try {
    store.clear();
    ok(Progress.importCode(P.encodeSave(P.blankSave())).ok, 'a fresh save');
    // The last evening of Season 1: 20 tiers reached, 10 claimed, placed in Diamond (peak), a weekly challenge moved.
    ok(Progress.season().info.key === 'S1' && Progress.season().info.daysLeft === 1, 'Dec 27: Season 1, last day');
    Progress.applySeasonMatch({ xp: S.TIER_XP * 10, counts: { kills: 30 }, career: { kills: 30, deaths: 10, won: true } });
    Progress.claimSeason();
    Progress.applySeasonMatch({ xp: S.TIER_XP * 10, counts: {}, career: { kills: 5, deaths: 5, won: false } });
    const rk = Progress.ranked();
    for (let i = 0; i < 5; i++) Progress.applySeasonMatch({ xp: 0, counts: {}, ranked: { outcome: 'win', perf: 1, lobby: 3600, rating: 0.9 } });
    ok(Progress.ranked().placed && rk.pm === 0, 'placed in Season 1', String(Progress.ranked().sr));
    const s1sr = Progress.ranked().sr, s1peak = R.division(Math.max(Progress.ranked().peak, s1sr)).div;
    // (The ranked matches finish a weekly ranked challenge too: its stars are tiers.)
    const s1tier = Progress.season().tier;
    ok(s1tier >= 20 && s1tier < 40 && Progress.season().claimed === 10, '20+ tiers reached, 10 claimed', String(s1tier));
    const s2camo = I.seasonCamos(S2)[0].id;
    ok(!Progress.camos('ar').some(c => c.camo.id === s2camo), 'a Season 2 camo is not in the picker before it starts');
    // Midnight: Season 2.
    setNow(2026, 11, 28, 0, 0, 30);
    const s = Progress.season();
    ok(s.info.key === 'S2' && s.info.title === 'Season 2: Signal Fire' && s.info.daysLeft === 42 && s.info.week === 0, 'Dec 28 00:00: Season 2: Signal Fire, 42 days', s.info.title);
    ok(s.tier === 0 && s.claimed === 0 && s.claimable === 0 && s.xp === 0, 'the track starts at tier 0');
    const ro = Progress.takeRollover();
    ok(ro && ro.claimed.length === s1tier - 10 && ro.ranked?.peakDiv === s1peak, 'the rollover claimed the waiting tiers and paid ranked', JSON.stringify([ro?.claimed.length, ro?.ranked?.peakDiv]));
    ok(I.trackRewards(S1).slice(0, s1tier).every(r => Progress.hasReward(r.own)) && !Progress.hasReward(I.trackRewards(S1)[s1tier].own), 'the Season 1 tiers reached are kept, the next is not');
    ok(Progress.hasReward(`card:rk-s1-${I.DIVISIONS[s1peak].id}`), 'the Season 1 ranked card is owned');
    // The track: 100 tiers, every reward real.
    const tr = I.trackRewards(S2), emb = new Set(ALL_EMBLEMS.map(e => e.id)), cards = new Set(CARD_IDS), camos = new Set(CAMOS.map(c => c.id)), skins = new Set(SKINS.map(x => x.id));
    const real = r => (r.kind === 'card' ? cards.has(r.id) : r.kind === 'emblem' ? emb.has(r.id) : r.kind === 'camo' ? camos.has(r.id) : r.kind === 'skin' ? skins.has(r.id)
      : r.kind === 'weapon' ? !!WEAPONS[r.id] : r.kind === 'operator' ? OPERATORS.some(o => o.id === r.id) : false);
    ok(tr.length === 100 && tr.every(real), 'Season 2: 100 tiers, every reward in its table', tr.filter(r => !real(r)).map(r => r.own).join(','));
    ok(tr[24].id === 'antimat' && tr[74].id === 'mako', 'tier 25 the Anti-Materiel, tier 75 Mako');
    // The Signal Fire set: 14 skins, the six new ones on tiers that held an emblem; every other tier as the S1 layout.
    const base = I.trackRewards(S1);
    ok(tr.filter(r => r.kind === 'skin').length === 14 && S2.fillerSkinTiers.every((t, i) => tr[t - 1].id === `skin:${S2.skins[8 + i][0]}-s2` && base[t - 1].kind === 'emblem'),
      'Season 2: six more skins on former emblem tiers');
    ok(tr.every((r, i) => S2.fillerSkinTiers.includes(r.tier) || r.kind === base[i].kind) && new Set(tr.map(r => r.own)).size === 100, 'every other Season 2 reward keeps its tier; no reward twice');
    ok(I.seasonEmblems(S2).every(e => tr.some(r => r.id === e[0])), 'every Season 2 emblem is still on the track');
    ok(S2.skins.every(([op]) => S.dateLocked('skin', `skin:${op}-s2`, at(2026, 12, 27)) && !S.dateLocked('skin', `skin:${op}-s2`, at(2026, 12, 28))), 'the whole Signal Fire set waits for Season 2');
    ok(Progress.camos('ar').some(c => c.camo.id === s2camo), 'Season 2 camos show in the picker now');
    Progress.applySeasonMatch({ xp: S.TIER_XP * 100, counts: {}, career: { kills: 1, deaths: 1, won: true } });
    const got = Progress.claimSeason();
    ok(got.length === 100 && got.every(g => g.fresh) && Progress.isItemUnlocked('weapon', 'antimat') && Progress.isOperatorUnlocked('mako'), 'all 100 claim; the early paths open', String(got.length));
    ok(Progress.setCard(tr[0].id) && Progress.setCamo('smg', s2camo) !== false, 'Season 2 cosmetics equip');
    // Weekly sets.
    const wk = Progress.weekly();
    ok(wk.length === 6 && wk.filter(w => w.open).length === 1 && wk[0].list.every(c => c.id.startsWith('S2.w1.')), 'Season 2 weekly: six sets, the first open', wk[0].list[0]?.id);
    const one = wk[0].list[0];
    const m = Progress.applySeasonMatch({ xp: 0, counts: { [one.stat]: one.goal }, career: null });
    ok(m.track.challenges.some(c => c.id === one.id && c.fresh), 'a Season 2 weekly challenge completes');
    setNow(2027, 0, 4, 0, 0, 30);
    ok(Progress.weekly().filter(w => w.open).length === 2, 'Jan 4: week 2 opens');
    // The event playlist: Lights Out from day 7 to day 20 (Jan 4 - Jan 17), in the Spotlight.
    const ev = S.eventAt();
    const pl = playlistsFor('standard').find(p => p.id === 'event');
    ok(ev?.id === 'lightsout' && pl?.name === 'Lights Out' && pl.modes[0] === 'ko' && pl.mods.includes('hardcore'), 'Lights Out (Hardcore Kill Order) is in the Spotlight', pl?.sub);
    const order = playlistsFor('standard').filter(p => p.wkevent || p.event || p.ranked || p.featured).map(p => p.id);
    ok(order.includes('wkevent') && order.includes('event') && order.includes('ranked') && order.includes('featured'), 'the weekly event, the season event, Ranked and the featured playlist share the Spotlight', order.join(','));
    setNow(2026, 11, 28, 12);
    ok(!playlistsFor('standard').some(p => p.id === 'event'), 'not before day 7');
    setNow(2027, 0, 17, 23, 59);
    ok(playlistsFor('standard').some(p => p.id === 'event'), 'still on Jan 17');
    setNow(2027, 0, 18, 0, 1);
    ok(!playlistsFor('standard').some(p => p.id === 'event'), 'gone on Jan 18');
    // Ranked: placements again from 75% of the SR.
    const r2 = Progress.ranked();
    ok(r2.k === 'S2' && !r2.placed && r2.pm === 0 && r2.base === Math.floor(s1sr * R.CARRY), 'Season 2 Ranked: placements again from three quarters of the SR', JSON.stringify([r2.base, s1sr]));
    for (let i = 0; i < 5; i++) Progress.applySeasonMatch({ xp: 0, counts: {}, ranked: { outcome: i % 2 ? 'loss' : 'win', perf: 0.3, lobby: r2.base, rating: 0.9 } });
    const r3 = Progress.ranked();
    ok(r3.placed && Math.abs(r3.sr - r2.base) < 600 && r3.sr <= R.PLACEMENT_CAP, 'placed near the carried SR', `${r3.sr} from ${r2.base}`);
    // The seasonal boards: the Season view reads the Season 2 window.
    const card = Progress.careerCard();
    ok(card.sn.key === 'S2' && card.sn.m === 1 && card.sn.k === 1, "the career card's season window is Season 2's alone", JSON.stringify(card.sn));
    const sb = B.buildBoard({ me: card, cat: 'kills', view: 'season', now: Date.now() });
    const meRow = sb.rows[sb.me];
    ok(sb.rows.length > 50 && meRow && meRow.value === card.sn.k, 'the Season board ranks Season 2 (mine: this season only)', `${meRow?.value} / ${card.sn.k}`);
    const rb = B.buildBoard({ me: card, cat: 'ranked', view: 'season', now: Date.now() });
    ok(rb.rows[rb.me]?.value === r3.sr, 'the Ranked board has my Season 2 SR', String(rb.rows[rb.me]?.value));
    // The weekly event rolls on in Season 2: a new one on Dec 28 (a Monday).
    ok(weeklyEventAt(new Real(2026, 11, 28, 1)).key !== weeklyEventAt(new Real(2026, 11, 27, 23)).key, 'the weekly event turns over with the season');
    // Season 3 (Feb 8): Third Rail. Season 2 pays out; the new track, its camos and skins, weekly sets and event.
    setNow(2027, 1, 7, 23, 59);
    ok(Progress.season().info.key === 'S2' && Progress.season().info.daysLeft === 1, 'Feb 7: Season 2, last day');
    const s3cam = I.seasonCamos(S3), s3camo = s3cam[0].id, s3anim = s3cam.filter(c => c.animated);
    ok(!Progress.camos('ar').some(c => s3cam.some(x => x.id === c.camo.id)), 'no Season 3 camo is in the picker before it starts');
    ok(!Progress.isItemUnlocked('weapon', 'rail') && !Progress.isOperatorUnlocked('halcyon'), 'the Lodestone and Halcyon are still locked (level 40, 10 S&D rounds)');
    setNow(2027, 1, 8, 0, 0, 30);
    const s3 = Progress.season();
    ok(s3.info.key === 'S3' && s3.info.title === 'Season 3: Third Rail' && s3.info.daysLeft === 42 && s3.info.week === 0 && s3.tier === 0, 'Feb 8 00:00: Season 3: Third Rail, 42 days, tier 0', s3.info.title);
    const ro2 = Progress.takeRollover();
    ok(ro2?.ranked?.def?.id === 'S2' && Progress.hasReward(`card:rk-s2-${I.DIVISIONS[ro2.ranked.peakDiv].id}`), 'Season 2 ranked pays at the end', JSON.stringify(ro2?.ranked?.peakDiv));
    ok(tr.every(r => Progress.hasReward(r.own) || r.kind === 'weapon' || r.kind === 'operator'), 'every Season 2 reward is still owned');
    const tr3 = I.trackRewards(S3), k3 = k => tr3.filter(r => r.kind === k).length;
    ok(tr3.length === 100 && tr3.every(real) && new Set(tr3.map(r => r.own)).size === 100, 'Season 3: 100 tiers, every reward in its table, none twice', tr3.filter(r => !real(r)).map(r => r.own).join(','));
    ok(k3('camo') === 10 && k3('skin') === 8 && k3('card') === 40 && k3('emblem') === 40 && k3('weapon') === 1 && k3('operator') === 1, 'Season 3: 10 camos, 8 skins, 40 cards, 40 emblems, two early unlocks',
      ['camo', 'skin', 'card', 'emblem'].map(k3).join('/'));
    ok(tr3[24].kind === 'weapon' && tr3[24].id === 'rail' && tr3[74].kind === 'operator' && tr3[74].id === 'halcyon', 'tier 25 the Lodestone early, tier 75 Halcyon early');
    const c3 = I.seasonCards(S3);
    ok(tr3[0].id === c3[0].id && c3[0].name === 'Third Rail' && c3[0].art.c === S3.theme && c3.slice(36).every(c => c.art.anim) && c3.slice(0, 36).every(c => !c.art.anim), "tier 1 is the season's own card; cards 37-40 animated");
    const basePatterns = new Set(CAMOS.filter(c => !c.season).map(c => c.pattern)), baseAnim = new Set(CAMOS.filter(c => !c.season && c.animated).map(c => c.pattern));
    ok(s3cam.length === 10 && s3anim.length === 2 && s3cam.every(c => basePatterns.has(c.pattern)) && s3anim.every(c => baseAnim.has(c.pattern)), 'Season 3 camos: 8 static, 2 animated, all on existing shader patterns');
    ok(I.seasonEmblems(S3).length === 40 && I.seasonEmblems(S3).every(e => !EMBLEMS.some(x => x.id === e[0]) && getEmblem(e[0])), "Season 3 emblems: in ALL_EMBLEMS, never in the pool's list");
    ok(S3.skins.every(([op]) => getSkin(`skin:${op}-s3`)?.season === 'S3'), 'the Third Rail skin set is in the skin table');
    ok(Progress.camos('ar').some(c => c.camo.id === s3camo), 'Season 3 camos show in the picker now');
    const wk3 = Progress.weekly();
    ok(wk3.length === 6 && wk3.filter(w => w.open).length === 1 && wk3.every((w, i) => w.list.length === 5 && w.list.every(c => c.id.startsWith(`S3.w${i + 1}.`))), 'Season 3 weekly: six sets of five, the first open', wk3[0].list[0]?.id);
    const r4 = Progress.ranked();
    ok(r4.k === 'S3' && !r4.placed && r4.base === Math.floor(r3.sr * R.CARRY), 'Season 3 Ranked: placements again', JSON.stringify([r4.base, r3.sr]));
    Progress.applySeasonMatch({ xp: S.TIER_XP * 100, counts: {}, career: { kills: 1, deaths: 1, won: true } });
    const got3 = Progress.claimSeason();
    ok(got3.length === 100 && got3.every(g => g.fresh) && Progress.isItemUnlocked('weapon', 'rail') && Progress.isOperatorUnlocked('halcyon'), 'all 100 claim; the Lodestone and Halcyon open', String(got3.length));
    const sk3 = getSkin(`skin:${S3.skins[0][0]}-s3`);
    ok(Progress.setCard(tr3[0].id) && Progress.setCamo('rail', s3anim[0].id) !== false && Progress.camo('rail') === s3anim[0].id && Progress.setOperatorSkin(sk3.operator, sk3.id), 'Season 3 cosmetics equip (an animated camo on the Lodestone)');
    // Lightning Rod: Snipers Only Grind, days 7-20 (Feb 15 - Feb 28), in the Spotlight.
    setNow(2027, 1, 14, 23, 59);
    ok(!playlistsFor('standard').some(p => p.id === 'event'), 'no season event before day 7');
    setNow(2027, 1, 15, 0, 1);
    const pl3 = playlistsFor('standard').find(p => p.id === 'event');
    ok(S.eventAt()?.id === 'lightningrod' && pl3?.name === 'Lightning Rod' && pl3.modes[0] === 'grind' && pl3.mods.includes('snipers'), 'Lightning Rod (Snipers Only Grind) is in the Spotlight', pl3?.sub);
    const sel3 = resolveSelection('standard', { playlist: 'event', modes: [] });
    ok(sel3.modes[0] === 'grind' && sel3.mods.includes('snipers') && !sel3.ranked, 'and Find match plays it', JSON.stringify(sel3));
    ok(Progress.weekly().filter(w => w.open).length === 2, 'Feb 15: week 2 opens');
    setNow(2027, 1, 28, 23, 59);
    ok(playlistsFor('standard').some(p => p.id === 'event'), 'still on Feb 28');
    setNow(2027, 2, 1, 0, 1);
    ok(!playlistsFor('standard').some(p => p.id === 'event'), 'gone on Mar 1');
    // Season Replay after Season 3 (Mar 22): Cold Iron again, fresh; owned rewards stay owned.
    setNow(2027, 2, 21, 23, 59);
    ok(Progress.season().info.key === 'S3' && Progress.season().info.daysLeft === 1, 'Mar 21: Season 3, last day');
    setNow(2027, 2, 22, 0, 0, 30);
    const rp = Progress.season();
    ok(rp.info.key === 'S1R1' && rp.info.title === 'Season Replay: Cold Iron' && rp.info.short === 'Replay' && rp.tier === 0, 'Mar 22: Season Replay: Cold Iron starts fresh', rp.info.title);
    const ro3 = Progress.takeRollover();
    ok(!ro3?.claimed?.length, 'the Season 3 rollover had nothing left to claim (all 100 were)', JSON.stringify(ro3?.claimed?.length));
    ok(tr3.every(r => Progress.hasReward(r.own) || r.kind === 'weapon' || r.kind === 'operator') && Progress.isItemUnlocked('weapon', 'rail'), 'every Season 3 reward is still owned');
    Progress.applySeasonMatch({ xp: S.TIER_XP * (s1tier + 5), counts: {}, career: null });
    const again = Progress.claimSeason();
    ok(again.length === s1tier + 5 && again.slice(0, s1tier).every(g => !g.fresh) && again.slice(s1tier).every(g => g.fresh), 'the replay track shows owned rewards as owned and pays the rest', `${again.filter(g => g.fresh).length} fresh of ${again.length}`);
    ok(Progress.weekly()[0].list.every(c => c.id.startsWith('S1.w1.')) && Progress.weekly()[0].list.every(c => c.value === 0), 'the replay\'s weekly sets start over');
    const rr = Progress.ranked();
    ok(rr.k === 'S1R1' && !rr.placed, 'replay Ranked: placements again', JSON.stringify([rr.k, rr.base]));
    setNow(2027, 3, 7, 12);
    ok(S.eventAt()?.id === 'coldsnap' && playlistsFor('standard').some(p => p.id === 'event' && p.name === 'Cold Snap'), 'the replay brings Cold Snap back to the Spotlight (Apr 7)');
    setNow(2027, 4, 3, 0, 0, 30);
    ok(Progress.season().info.key === 'S2R1' && Progress.season().info.title === 'Season Replay: Signal Fire', 'then Signal Fire again (May 3)');
    setNow(2027, 5, 14, 0, 0, 30);
    ok(Progress.season().info.key === 'S3R1' && Progress.season().info.title === 'Season Replay: Third Rail', 'then Third Rail again (Jun 14)');
    setNow(2027, 5, 22, 12);
    ok(playlistsFor('standard').some(p => p.id === 'event' && p.name === 'Lightning Rod'), 'with Lightning Rod back in the Spotlight');
    setNow(2027, 6, 26, 0, 0, 30);
    ok(Progress.season().info.key === 'S1R2', 'and round again (Jul 26)');
    ok(Progress.exportCode().length < 4000 && P.decodeSave(Progress.exportCode()).ok, 'the save code stays short and loads');
  } finally { globalThis.Date = Real; }
}

// ---- Names ----
console.log('names');
{
  const { CARDS } = P;
  const { WEAPONS } = await import('../js/shared/weapons.js');
  const { MAPS } = await import('../js/shared/map.js');
  const { MODES } = await import('../js/shared/modes.js');
  const { PERKS, TACTICALS, LETHALS, STREAKS } = await import('../js/shared/catalog.js');
  const fresh = [...I.SEASON_DEFS.flatMap(d => [...I.seasonCards(d).map(c => c.name), ...I.seasonEmblems(d).map(e => e[1]), ...I.seasonCamos(d).map(c => c.name), ...d.skins.map(s => s[1]), ...I.rankedCards(d).map(c => c.name), ...I.rankedEmblems(d).map(e => e[1])]), ...I.SEASON_DEFS.map(d => d.event.name)];
  const seasonCardIds = new Set(I.SEASON_DEFS.flatMap(d => [...I.seasonCards(d), ...I.rankedCards(d)].map(c => c.id)));
  const seasonSkin = new Set(SKINS.filter(s => s.season).map(s => s.id)), seasonCamo = new Set(I.SEASON_DEFS.flatMap(d => I.seasonCamos(d).map(c => c.id)));
  // A season's first card is named after the season itself, on purpose.
  const others = [
    ...Object.values(WEAPONS).map(w => w.name), ...Object.values(MAPS).map(m => m.name), ...Object.values(MODES).map(m => m.name),
    ...[PERKS, TACTICALS, LETHALS, STREAKS].flatMap(t => Object.values(t).map(x => x.name)), ...OPERATORS.map(o => o.name),
    ...CARDS.filter(c => !seasonCardIds.has(c.id)).map(c => c.name), ...EMBLEMS.map(e => e.name), ...CAMOS.filter(c => !seasonCamo.has(c.id)).map(c => c.name),
    ...SKINS.filter(s => !seasonSkin.has(s.id) && s.tier !== 'base').map(s => s.name),
  ].map(n => String(n).toLowerCase());
  const clash = fresh.filter(n => others.includes(n.toLowerCase()));
  ok(!clash.length, 'no season name clashes with the rest of the game', clash.join(', '));
  const dup = fresh.filter((n, i) => fresh.indexOf(n) !== i && !I.SEASON_DEFS.some(d => d.name === n));
  ok(!dup.length, 'and none repeats', dup.join(', '));
  // + 1: the Master Prestige emblem (docs/PRESTIGE.md), + 12 feat emblems (the rewards pass), kept out of the pool's
  // list the same way.
  // + the weekly events' emblems (js/shared/events.js) and the tournament crest (docs/TOURNAMENTS.md), kept out the same way.
  const { EVENT_EMBLEMS, TOURNEY_EMBLEMS } = await import('../js/ui/emblems.js');
  // 14 feats: the Listener's Dead Frequency (Polestar Relay, 1118-6) is the thirteenth, the Barker's (Wrenfield Fair) the fourteenth.
  // 141 (three seasons of 40 + 7 ranked crests) - 6: Season 2's Signal Fire skin set took six emblem tiers (fillerSkinTiers), and those emblems left the season.
  ok(EMBLEMS.length === 22 && ALL_EMBLEMS.length === 22 + 141 - 6 + 1 + 14 + EVENT_EMBLEMS.length + TOURNEY_EMBLEMS.length && getEmblem('s1-emb-01') && EVENT_EMBLEMS.length >= 4, 'season and event emblems stay out of the pool\'s list');
  // The weekly events' rewards and names clash with nothing either.
  const { EVENTS } = await import('../js/shared/events.js');
  const evNames = EVENTS.flatMap(e => [e.reward.name]);
  const evCards = new Set(EVENTS.map(e => e.reward.name.toLowerCase()));
  const evClash = evNames.filter(n => others.filter(o => !evCards.has(o)).includes(n.toLowerCase()) || fresh.includes(n));
  ok(!evClash.length && new Set(evNames).size === evNames.length, 'weekly event rewards have names of their own', evClash.join(', '));
  const sk = SKINS.find(s => s.id === 'skin:anvil-s1');
  ok(sk && skinUnlock(sk, { granted: () => false }).requirement === 'Season 1 reward track', 'season skins name their track');
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
