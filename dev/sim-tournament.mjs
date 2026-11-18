// Weekend tournaments (js/shared/tourney-items.js, js/shared/tournaments.js; docs/TOURNAMENTS.md).
// node dev/sim-tournament.mjs
//   schedule     Friday 18:00 to Sunday 23:59 local, the cups alternating, nothing before the first weekend; the same
//                answers in five time zones (fresh processes)
//   bracket      eight squads, seven distinct clans with real members, a mix of strengths, seeds by strength, the
//                player seed 1; teammates from outside the clans; the rounds' modes and maps fit the cup
//   determinism  the same weekend and owner give the same bracket, rounds and bot results in a fresh process; another
//                owner or weekend gives another bracket
//   progression  wins carry the player through, a loss knocks them out, other branches reveal round by round, the
//                final's winner is the champion; strength rises round by round
//   rewards      XP per round paid once a weekend (re-entry never pays twice), placing cards, champion crest and camo,
//                owned through the log; ownership survives a new weekend
//   reentry      one re-entry a weekend, none after a champion; a new weekend starts over
//   forfeit      a round started and never finished counts as lost
//   party        a guest follows the host's bracket
//   roster       the round's roster: the cup's team size a side, the clan's members as the enemy with their tags
//   save         the block survives a save code; a code from before it re-exports unchanged
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

const I = await import('../js/shared/tourney-items.js');
const T = await import('../js/shared/tournaments.js');
const B = await import('../js/shared/botpool.js');

const dump = (key, owner) => {
  const b = T.bracketFor(key, owner, { name: 'X' });
  const res = T.resolveBracket(b, { roundsWon: 0, out: true }, { all: true });
  return JSON.stringify([b.rounds.map(r => `${r.mode}@${r.mapId}`), b.squads.map(s => `${s.seed}:${s.tag}:${s.members.join('.')}`),
    res.matches.map(l => l.map(m => m.winner?.tag ?? m.winner?.kind ?? '-'))]);
};

if (process.argv[2] === '--child') {
  const out = [];
  for (const [y, m, d, h, mi] of JSON.parse(process.argv[3])) {
    const t = I.tourneyAt(new Date(y, m - 1, d, h, mi));
    out.push([t.live, t.key, t.cup.id, t.next.key]);
  }
  console.log(JSON.stringify({ out, b: dump(20777, 'Pabc'), c: dump(20784, 'Pzz9') }));
  process.exit(0);
}

let fails = 0, checks = 0;
const ok = (cond, label, info = '') => { checks++; if (!cond) { fails++; console.log(`  FAIL ${label}${info !== '' ? ': ' + JSON.stringify(info) : ''}`); } };
const section = name => console.log(name);

/* ---------- schedule ---------- */
section('schedule');
const at = (s, h = 12, mi = 0) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, h, mi); };
ok(!I.tourneyAt(at('2026-11-13', 20)).live, 'no cup before the first weekend');
ok(I.tourneyAt(at('2026-11-18')).next.key === I.FIRST_WEEKEND, 'the first weekend is next on Wednesday');
ok(!I.tourneyAt(at('2026-11-20', 17, 59)).live, 'Friday 17:59 not yet');
ok(I.tourneyAt(at('2026-11-20', 18, 0)).live, 'Friday 18:00 open');
ok(I.tourneyAt(at('2026-11-21', 3)).live && I.tourneyAt(at('2026-11-22', 23, 59)).live, 'Saturday and Sunday 23:59 open');
ok(!I.tourneyAt(at('2026-11-23', 0, 0)).live, 'Monday 00:00 closed');
const keys = ['2026-11-20', '2026-11-21', '2026-11-22'].map(d => I.tourneyAt(at(d, 20)).key);
ok(new Set(keys).size === 1 && keys[0] === I.FIRST_WEEKEND, 'one key a weekend', keys);
const cups = [0, 1, 2, 3].map(w => I.tourneyAt(at('2026-11-21')).cup && I.cupFor(I.FIRST_WEEKEND + 7 * w).id);
ok(cups.join() === 'team,showdown,team,showdown', 'cups alternate', cups);
{
  const t = I.tourneyAt(at('2026-11-21', 10));
  ok(new Date(t.opensAt).getDay() === 5 && new Date(t.opensAt).getHours() === 18, 'opens Friday 18:00 local');
  ok(new Date(t.closesAt).getDay() === 1 && new Date(t.closesAt).getHours() === 0, 'closes Monday 00:00 local');
  const n = I.tourneyAt(at('2026-11-24'));
  ok(!n.live && n.next.key === I.FIRST_WEEKEND + 7 && n.cup.id === 'showdown', 'midweek: the next weekend and its cup', n.next);
}
const TIMES = [[2026, 11, 20, 17, 59], [2026, 11, 20, 18, 0], [2026, 11, 22, 23, 59], [2026, 11, 23, 0, 0], [2026, 12, 26, 19, 30], [2027, 3, 28, 2, 30], [2027, 10, 31, 1, 30]];
const me = fileURLToPath(import.meta.url);
const runs = ['UTC', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', 'Australia/Lord_Howe'].map(tz =>
  JSON.parse(execFileSync(process.execPath, [me, '--child', JSON.stringify(TIMES)], { env: { ...process.env, TZ: tz } }).toString()));
ok(runs.every(r => JSON.stringify(r) === JSON.stringify(runs[0])), 'the same schedule and brackets in five time zones', runs.map(r => r.out.map(x => x[0]).join()));

/* ---------- bracket ---------- */
section('bracket');
const K = I.FIRST_WEEKEND, K2 = K + 7;
for (const key of [K, K2, K + 14, K + 21, K + 70]) {
  for (const owner of ['Pabc', 'P0001', 'Pzzzzzzzzzzzz']) {
    const b = T.bracketFor(key, owner, { name: 'Tester' });
    const size = b.cup.size;
    const clans = b.squads.filter(s => s.kind === 'clan');
    ok(b.squads.length === 8 && clans.length === 7, 'eight squads, seven clans', [key, owner]);
    ok(new Set(clans.map(c => c.tag)).size === 7, 'distinct clans');
    ok(b.squads.every(s => s.members.length === (s.kind === 'you' ? size - 1 : size)), 'line-ups of the cup size', b.squads.map(s => s.members.length));
    const all = b.squads.flatMap(s => s.members);
    ok(new Set(all).size === all.length, 'nobody twice');
    ok(clans.every(c => c.members.every(id => B.clanOf(B.profileById(id)) === c.tag)), 'clans field their own members');
    ok(b.squads.find(s => s.kind === 'you').members.every(id => !B.clanOf(B.profileById(id))), 'teammates have no clan');
    ok(b.squads.find(s => s.kind === 'you').seed === 1 && b.squads[0].kind === 'you', 'the player is seed 1, position 0');
    const bySeed = clans.slice().sort((a, x) => a.seed - x.seed).map(c => c.strength);
    ok(bySeed.every((v, i) => i === 0 || v <= bySeed[i - 1]), 'seeds by strength', bySeed);
    ok(clans.some(c => c.skill === 'stacked') && clans.some(c => c.skill !== 'stacked'), 'a mix of strengths');
    ok(b.rounds.length === 3 && b.rounds.every((r, i) => b.cup.rounds[i].includes(r.mode)), 'round modes from the cup', b.rounds);
    ok(new Set(b.rounds.map(r => r.mapId)).size === 3, 'three different maps');
  }
}
ok(T.roundPlan(K2).every(r => r.mode === 'gf'), 'the Showdown Cup plays Showdown');

/* ---------- determinism ---------- */
section('determinism');
ok(dump(K, 'Pabc') === runs[0].b && dump(K2, 'Pzz9') === runs[0].c, 'a fresh process gives the same bracket and results');
ok(dump(K, 'Pabc') !== dump(K, 'Pabd'), 'another owner, another bracket');
ok(dump(K, 'Pabc') !== dump(K + 14, 'Pabc'), 'another weekend, another bracket');
ok(dump(K, 'Pabc') === dump(K, 'Pabc'), 'stable within a process');
ok(JSON.stringify(T.bracketFor(K, 'Pabc', { name: 'A' }).squads.map(s => s.members)) === JSON.stringify(T.bracketFor(K, 'Pabc', { name: 'B' }).squads.map(s => s.members)),
  'the squad name changes nothing else (a party guest sees the same squads)');

/* ---------- progression ---------- */
section('progression');
{
  const b = T.bracketFor(K, 'Pabc');
  let r = T.resolveBracket(b, null);
  ok(r.next?.round === 0 && r.next.opponent.seed === 8, 'not entered: the quarter-final against seed 8 is next');
  ok(r.reveal === 0 && r.matches[0].filter(m => !m.you).every(m => m.winner), 'other quarter-finals are decided (shown from round 1)');
  r = T.resolveBracket(b, { roundsWon: 1, out: false });
  ok(r.next?.round === 1 && r.reveal === 1, 'a quarter-final won: the semi-final is next, the quarter-finals revealed');
  ok(r.next.opponent === r.matches[0][1].winner, 'the semi-final opponent won the neighbouring quarter-final');
  r = T.resolveBracket(b, { roundsWon: 2, out: false });
  ok(r.next?.round === 2 && r.next.opponent === r.matches[1][1].winner, 'the final against the other half\'s winner');
  r = T.resolveBracket(b, { roundsWon: 3, out: false });
  ok(r.champion?.kind === 'you' && !r.next && r.reveal === 3, 'three wins: champion');
  r = T.resolveBracket(b, { roundsWon: 1, out: true });
  ok(r.matches[1][0].winner?.kind === 'clan' && r.champion?.kind === 'clan' && r.reveal === 3 && !r.next, 'knocked out: the opponent goes on, the cup resolves');
  // Strength rises: the average enemy rating by round over many weekends and owners.
  const sum = [0, 0, 0], n = 120;
  for (let k = 0; k < n; k++) {
    const bb = T.bracketFor(K + 14 * (k % 10), `P${k}`);
    for (let round = 0; round < 3; round++) {
      const rr = T.resolveBracket(bb, { roundsWon: round, out: false });
      const [, them] = T.matchSides(bb, round, rr.next.opponent, { target: 0.3 });
      sum[round] += them.reduce((a, x) => a + x.rating, 0) / them.length / n;
    }
  }
  ok(sum[0] < sum[1] && sum[1] < sum[2], 'enemy strength rises by round', sum.map(v => v.toFixed(3)));
  console.log(`  enemy rating by round (player 0.30): ${sum.map(v => v.toFixed(3)).join(' / ')}`);
}

/* ---------- rewards, re-entry, forfeit, party ---------- */
section('rewards');
{
  const t = I.blankTourney();
  ok(I.runStatus(t, K).canEnter && !I.tourneyOwned(t).size, 'fresh: can enter, owns nothing');
  ok(I.enterTourney(t, K, 'Pabc') && t.o === 'Pabc' && t.e === 1, 'enter');
  let r = I.applyTourneyRound(t, { key: K, round: 0, won: true });
  ok(r.xp.map(x => x[1]).join() === `${I.ENTRY_XP},${I.ROUND_XP[0]}` && r.place === 2, 'QF win: entry and round XP, semi-finalist', r);
  ok(r.rewards.includes('card:tn-entrant') && r.rewards.includes('card:tn-semi'), 'entrant and semi-finalist cards', r.rewards);
  ok(I.applyTourneyRound(t, { key: K, round: 0, won: true }) === null, 'a round cannot be played twice');
  r = I.applyTourneyRound(t, { key: K, round: 1, won: false });
  ok(r.out && r.place === 2 && !r.rewards.length && r.xp.length === 0, 'SF loss: out, no XP, nothing new', r);
  section('reentry');
  ok(I.runStatus(t, K).canReenter, 're-entry open');
  ok(I.enterTourney(t, K, 'Pabc') && t.e === 2 && t.r === 0, 're-enter: back to the quarter-final');
  r = I.applyTourneyRound(t, { key: K, round: 0, won: true });
  ok(r.xp.length === 0, 'the quarter-final pays nothing twice', r.xp);
  r = I.applyTourneyRound(t, { key: K, round: 1, won: true });
  ok(r.xp.length === 1 && r.xp[0][1] === I.ROUND_XP[1] && r.rewards.includes('card:tn-finalist'), 'SF win on the re-entry pays its round', r);
  r = I.applyTourneyRound(t, { key: K, round: 2, won: true });
  ok(r.champion && r.place === 4 && ['card:tn-champion', 'emblem:tn-champion', 'camo:tn-laurel'].every(id => r.rewards.includes(id)), 'champion: card, crest, camo', r.rewards);
  ok(!I.runStatus(t, K).canReenter && !I.enterTourney(t, K, 'Pabc'), 'no entry after the cup is won');
  ok(t.log.length === 1 && t.log[0][2] === 4, 'one shelf row, champion', t.log);
  const t2 = I.blankTourney();
  I.enterTourney(t2, K, 'P1'); I.applyTourneyRound(t2, { key: K, round: 0, won: false });
  ok(I.runStatus(t2, K).canReenter, 'out in the QF: re-entry');
  I.enterTourney(t2, K, 'P1'); I.applyTourneyRound(t2, { key: K, round: 0, won: false });
  ok(!I.runStatus(t2, K).canReenter && !I.enterTourney(t2, K, 'P1'), 'only one re-entry');
  ok(I.runStatus(t2, K2).canEnter && I.enterTourney(t2, K2, 'P1'), 'a new weekend starts over');
  ok(I.tourneyOwned(t2).has('card:tn-entrant') && t2.log.length === 1 && t2.log[0][2] === 1, 'last weekend\'s placing is kept');
  // Ownership survives rolling on (the log keeps the best).
  I.rollTourney(t, K + 70);
  ok(I.tourneyOwned(t).has('camo:tn-laurel'), 'champion rewards stay owned');
  section('forfeit');
  const t3 = I.blankTourney();
  I.enterTourney(t3, K, 'P3');
  ok(I.startRound(t3, K, 0) && t3.pl === 1, 'a round starts');
  ok(!I.startRound(t3, K, 1), 'not a round out of turn');
  const f = I.settleForfeit(t3);
  ok(f && f.out && I.runStatus(t3, K).canReenter && t3.pl === 0, 'left unfinished: lost', f);
  I.enterTourney(t3, K, 'P3'); I.startRound(t3, K, 0);
  const fin = I.applyTourneyRound(t3, { key: K, round: 0, won: true });
  ok(fin && t3.pl === 0 && I.settleForfeit(t3) === null, 'a finished round clears it');
  section('party');
  const g = I.blankTourney();
  I.joinTourney(g, K, 'Phost', 1);
  ok(g.o === 'Phost' && g.r === 1 && g.e === 1, 'a guest follows the host\'s run');
  const gr = I.applyTourneyRound(g, { key: K, round: 1, won: true });
  ok(gr && gr.place === 3 && I.tourneyOwned(g).has('card:tn-finalist'), 'and is paid its own placing', gr);
}

/* ---------- roster ---------- */
section('roster');
{
  const { buildRoster } = await import('../js/sim/sim.js');
  for (const key of [K, K2]) {
    const b = T.bracketFor(key, 'Pabc');
    const nx = T.resolveBracket(b, null).next, plan = b.rounds[0];
    const humans = [{ id: 'local', name: 'Tester', team: 0, loadout: {} }];
    const sides = T.matchSides(b, 0, nx.opponent, { humans: 1, target: 0.3, seed: 7 });
    const roster = buildRoster(humans, { botSkill: 'mixed', mode: plan.mode, mapId: plan.mapId, seed: 7, pool: { target: 0.3, sides } });
    const size = b.cup.size;
    ok(roster.filter(r => r.team === 0).length === size && roster.filter(r => r.team === 1).length === size, `${b.cup.name}: ${size} a side`, roster.map(r => r.team));
    const them = roster.filter(r => r.team === 1);
    ok(them.every(r => r.pool && nx.opponent.members.includes(r.pool) && r.name.startsWith(`[${nx.opponent.tag}] `)), 'the enemy is the clan, tagged', them.map(r => r.name));
    ok(new Set(roster.map(r => r.id)).size === roster.length, 'unique roster ids');
  }
  // Party: two humans take two teammates' seats.
  const b = T.bracketFor(K, 'Pabc');
  const [mates] = T.matchSides(b, 0, T.resolveBracket(b, null).next.opponent, { humans: 2 });
  ok(mates.length === b.cup.size - 2, 'a party of two leaves room for the rest', mates.length);
}

/* ---------- save ---------- */
section('save');
{
  const P = await import('../js/shared/progression.js');
  const s = P.blankSave();
  const plain = P.encodeSave(s);
  ok(P.encodeSave(P.decodeSave(plain).save) === plain, 'a code without tournaments re-exports unchanged');
  I.enterTourney(s.tn, K, 'Pabc'); I.applyTourneyRound(s.tn, { key: K, round: 0, won: true });
  s.tn.log.push([K2, 1, 3]);
  const code = P.encodeSave(s), back = P.decodeSave(code);
  ok(back.ok && JSON.stringify(back.save.tn) === JSON.stringify(P.sanitizeSave(s).tn) && back.save.tn.log.length === 2, 'the block survives a code', back.save?.tn);
  ok(P.encodeSave(back.save) === code, 'and re-exports the same code');
  const junk = I.cleanTourney({ k: 12345, o: '<x>', e: 9, r: 7, log: [[1, 0, 4], [K, 9, 1], [K, 0, 9], 'x', [K + 1, 0, 2]] });
  ok(junk.k === 0 && junk.log.length === 0, 'junk is dropped', junk);
  const fresh = P.blankSave();
  ok(P.encodeSave(fresh) === plain && P.sanitizeSave({}).tn.log.length === 0 && I.tourneyEmpty(P.sanitizeSave({}).tn), 'blank saves stay blank');
}

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
