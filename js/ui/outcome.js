// The results header for every mode (docs/MODES.md "End of match"): the headline word, the line under it, its tone,
// and the score beside it only where a score means something. Pure: js/ui/results.js draws it, dev tests read it.
//
//   score.kind  'pair'  mine against theirs (team score, rounds, captures; a free-for-all: yours against the best other)
//               'one'   a single number with a label ("Round 18", "#3 of 8 squads", "Survivors 2")
//               'none'  no number (Extraction, training)
import { TEAMS } from '../shared/constants.js';
import { GUN_LADDER, isFfa, MODES, modeRules, EX } from '../shared/modes.js';

export const ORDINAL = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const FFA_LINE = { 1: 'Nobody else came close', 2: 'One short of the top', 3: 'On the podium' };
const OUTCOME = {
  win: ['Victory', 'The yard is yours'],
  loss: ['Defeat', 'The yard is lost'],
  draw: ['Draw', 'Neither side broke through'],
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// A free-for-all's standings: by the mode's score, then fewer deaths, then kills.
export function ffaStandings(data) {
  const scoreOf = p => data.scores?.[p.team] ?? 0;
  const ranked = (data.roster ?? []).filter(p => !p.dummy).sort((a, b) => scoreOf(b) - scoreOf(a) || a.deaths - b.deaths || b.kills - a.kills);
  const me = ranked.find(p => p.id === data.localId) ?? null;
  return { ranked, me, place: me ? ranked.indexOf(me) + 1 : 0, scoreOf };
}

// Battle royale and Rebound: the squads and where yours finished.
export function brPlacing(data) {
  const roster = data.roster ?? [];
  const squadTeams = [...new Set(roster.map(p => p.team))];
  const myPlace = data.outcome === 'win' ? 1 : roster.find(p => p.id === data.localId)?.place || squadTeams.length;
  return { squadTeams, myPlace };
}

// How an Extraction ended for this squad: 'out' (extracted), 'wiped' (out of lives and players), 'time' (the clock ran
// out first), 'left' (this player walked away while the match went on).
export function exEnding(data) {
  const sv = data.exView?.squads?.find(s => s.team === data.myTeam) ?? null;
  if (data.ex?.extracted ?? sv?.extracted) return 'out';
  if (sv?.wiped || (sv && sv.lives <= 0 && (sv.done || !data.early)) || (data.ex && data.ex.lives <= 0 && !data.early)) return 'wiped';
  if (data.early) return 'left';
  return 'time';
}

export function matchHeader(data) {
  const modeId = data.modeId ?? data.mode, rules = modeRules(modeId), outcome = data.outcome;
  const { scores, myTeam } = data;
  let [word, line] = OUTCOME[outcome] ?? OUTCOME.draw;
  const winTeam = outcome === 'win' ? myTeam : outcome === 'loss' ? 1 - myTeam : null;
  let tone = TEAMS[winTeam]?.css ?? 'var(--c-sodium)';
  let score = { kind: 'pair', mine: scores?.[myTeam] ?? 0, them: scores?.[1 - myTeam] ?? 0, mineCss: TEAMS[myTeam]?.css, themCss: TEAMS[1 - myTeam]?.css };

  if (data.practice) {
    return { word: 'Training over', line: 'Practice: no XP, no record', tone: 'var(--c-sodium)', score: { kind: 'none' } };
  }
  if (isFfa(modeId)) {
    // Placement, not sides; the pair is yours against the best score that is not yours.
    const gun = rules === 'gun', { ranked, me, place, scoreOf } = ffaStandings(data);
    const rival = ranked[0] === me ? ranked[1] : ranked[0];
    word = place ? `${ORDINAL(place)} place` : 'Match over';
    line = place === 1 ? (outcome === 'draw' ? 'Tied at the top' : gun ? 'Through every gun to the Verdict' : FFA_LINE[1]) : FFA_LINE[place] ?? `${ranked[0]?.name ?? 'Someone'} took the yard`;
    tone = place === 1 ? 'var(--c-gold)' : place <= 3 ? 'var(--c-sodium)' : TEAMS[ranked[0]?.team]?.css ?? 'var(--c-sodium)';
    const shown = p => (gun ? Math.min(GUN_LADDER.length, scoreOf(p)) : scoreOf(p));
    score = { kind: 'pair', mine: me ? shown(me) : 0, them: rival ? shown(rival) : 0, mineCss: TEAMS[myTeam]?.css, themCss: rival ? TEAMS[rival.team]?.css : 'var(--c-haze)' };
  } else if (rules === 'br') {
    // Placement among the squads: one number, "#3 of 8 squads".
    const { squadTeams, myPlace } = brPlacing(data), solo = MODES[modeId]?.squad === 1;
    const of = `of ${squadTeams.length} ${solo ? 'players' : 'squads'}`;
    word = outcome === 'win' ? 'Victory' : `${ORDINAL(myPlace)} place`;
    line = outcome === 'win' ? (solo ? 'Last one standing' : 'Last squad standing') : `#${myPlace} ${of}`;
    tone = myPlace === 1 ? 'var(--c-gold)' : myPlace <= 3 ? 'var(--c-sodium)' : 'var(--c-haze)';
    score = { kind: 'one', label: of, value: `#${myPlace}`, mineCss: tone };
  } else if (rules === 'ex') {
    // No score: whether the squad got out, and what it banked or lost.
    const sv = data.exView?.squads?.find(s => s.team === myTeam) ?? null;
    const banked = data.ex?.banked ?? sv?.banked ?? [], lost = data.ex?.lost ?? [...(sv?.pot ?? [])];
    const xp = banked.reduce((n, c) => n + (EX.reward.xp[c.tier] ?? 0), 0);
    const end = exEnding(data);
    word = { out: 'Extracted', wiped: 'Squad wiped', time: 'Out of time', left: 'Left the match' }[end];
    line = end === 'out' ? (banked.length ? `${plural(banked.length, 'contract')} banked · ${xp.toLocaleString('en-US')} XP` : 'Out alive, no contracts banked')
      : lost.length ? `${plural(lost.length, 'contract')} lost: nobody got out` : end === 'wiped' ? 'Out of lives before anyone got out' : 'Nobody in the squad got out';
    tone = end === 'out' ? 'var(--c-gold)' : 'var(--c-haze)';
    score = { kind: 'none' };
  } else if (rules === 'zm') {
    // One number: the round the crew reached (or got out on).
    const z = data.zm ?? {}, survived = z.survived ?? Math.max(0, (data.zmView?.round ?? 1) - 1);
    const left = !z.escaped && !!data.zmView?.escaped?.length;
    word = z.escaped ? 'Escaped' : left ? 'Left behind' : 'Overrun';
    line = z.escaped ? `Escaped on round ${z.escaped}${z.freshEscape ? ': a new record on this map' : ''}`
      : `Survived ${plural(survived, 'round')}${z.fresh ? ': a new record on this map' : z.best ? ` · best ${z.best}` : ''}`;
    if (z.warden) line += ' · the Gravewarden is down';
    tone = z.fresh || z.escaped ? 'var(--c-gold)' : 'var(--c-haze)';
    score = { kind: 'one', label: 'Round', value: z.escaped || data.zmView?.round || survived, mineCss: tone };
  } else if (rules === 'inf') {
    // Sides change hands all match: the number is how many held out, not a side's score.
    const survivors = scores?.[0] ?? 0;
    line = survivors > 0 ? (myTeam === 0 ? 'You held out to the end' : `${plural(survivors, 'survivor')} held out`) : 'Everyone was infected';
    score = { kind: 'one', label: 'Survivors', value: survivors, mineCss: TEAMS[0]?.css };
  } else if (rules === 'snd' || rules === 'ctl' || rules === 'gf') {
    const m = score.mine, t = score.them;
    line = outcome === 'win' ? `Won ${m} rounds to ${t}` : outcome === 'loss' ? `Lost ${m} rounds to ${t}` : `Level at ${m} rounds each`;
  } else if (rules === 'ctf') {
    const caps = `${plural(score.mine, 'capture')} to ${score.them}`;
    line = outcome === 'win' ? `Won ${caps}` : outcome === 'loss' ? `Lost ${caps}` : `Level at ${caps}`;
  }
  // Left a team match early: a loss, said plainly.
  if (data.early && !['br', 'ex', 'zm'].includes(rules) && !isFfa(modeId)) { word = 'Defeat'; line = 'You left before the end'; }
  // Ranked: the rating's move rides the line.
  const r = data.ranked;
  if (r) line += r.after && r.before ? ` · ${r.delta > 0 ? '+' : ''}${r.delta} SR` : r.placedNow ? ' · Placed' : r.placement ? ` · Placement ${r.placement}/${r.placements}` : '';
  return { word, line, tone, score };
}
