// Weekend tournaments (docs/TOURNAMENTS.md): the schedule, the two cups, the rewards and the save's tournament block,
// as plain data and pure functions. No imports, so the save (js/shared/progression.js) and the cosmetic catalogues
// (camos.js, emblems.js, cardbook.js) can read it without a cycle; js/shared/tournaments.js builds the brackets from the
// bot pool.
//
// Dates work the way seasons do (js/shared/seasons.js): every boundary is a local calendar day (the local Y-M-D taken as
// a UTC day number), so two phones on the same local date and hour agree wherever they are. A tournament weekend opens
// Friday 18:00 local and closes at the end of Sunday (Monday 00:00). Its key is the Friday's day number.
//
// The save's block (save.tn, appended to save v4 and to the save code as its 24th entry):
//   { k: Friday of the weekend the run belongs to (0 none), o: bracket owner id (whose bracket: this player's id, or
//     the party host's), e: entries used this weekend (0..MAX_ENTRIES), r: rounds won in this entry (0..3),
//     x: RUN_LIVE | RUN_OUT | RUN_CHAMP, b: best placing this weekend (0 none, 1 entrant .. 4 champion),
//     pd: rounds whose XP this weekend has paid (0..3; a re-entry never pays a round twice), ep: entry XP paid (0/1),
//     pl: the round being played + 1 while a round's match is on (0 none): a match left or reloaded away counts as lost,
//     log: [[friday, cup index, placing]] one row per weekend played, oldest first (the Trophy Case shelf) }
// Ownership is derived from the log: the calling card of every placing up to the best ever, and the champion's
// emblem and camo once any cup was won. Nothing else to keep, so codes stay short.

const DAY = 86400000;
const OPEN_HOUR = 18;                                  // Friday, local.
export const MAX_ENTRIES = 2;                          // The first entry and one re-entry a weekend.
export const RUN_LIVE = 0, RUN_OUT = 1, RUN_CHAMP = 2;
export const LOG_MAX = 104;                            // Two years of weekends.

const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const dayNumber = (date = new Date()) => { const d = new Date(date); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); };
const dayStart = n => { const u = new Date(n * DAY); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime(); };
// 'YYYY-MM-DD' of a day number.
export const dayIso = n => new Date(n * DAY).toISOString().slice(0, 10);

// The first weekend with a cup: Friday 2026-11-20.
export const FIRST_WEEKEND = parseDay('2026-11-20');

/* ---------- The cups ---------- */
// Alternating weekends: the Team Cup (4 v 4, objective and slaying modes, small and medium maps) and the Showdown Cup
// (Showdown 2 v 2 rounds). Each round of a weekend has its mode and map, drawn from `rounds` by the weekend
// (js/shared/tournaments.js roundPlan), so every squad in the bracket plays the same card that round.
export const CUPS = [
  {
    id: 'team', name: 'Team Cup', size: 4, icon: 'mode:hard', note: '4 v 4 squads',
    rounds: [['tdm', 'kc'], ['hard', 'dom'], ['snd', 'ctl']], maps: ['small', 'medium'],
    limits: { tdm: 50, kc: 45, dom: 150, hard: 120 },
  },
  {
    id: 'showdown', name: 'Showdown Cup', size: 2, icon: 'mode:gf', note: '2 v 2 rounds',
    rounds: [['gf'], ['gf'], ['gf']], maps: ['small'], limits: {},
  },
];
export const cupById = id => CUPS.find(c => c.id === id) ?? null;
export const ROUND_NAMES = ['Quarter-final', 'Semi-final', 'Final'];
export const ROUND_SHORT = ['QF', 'SF', 'F'];

// The weekend a date belongs to: the most recent Friday on or before it.
const fridayOf = n => n - (((n - 1) % 7) + 7) % 7;        // Day 1 (1970-01-02) was a Friday.
const cupOf = friday => CUPS[(((friday - FIRST_WEEKEND) / 7) % CUPS.length + CUPS.length) % CUPS.length];

// The tournament on a date:
// { live, key (the Friday's day number, while live; else null), cup, opensAt, closesAt (ms, this weekend's or, when
//   none is live, the next one's), next: { key, cup, opensAt } (the next weekend once this one is over or not open yet) }
export function tourneyAt(date = new Date()) {
  const d = new Date(date), n = dayNumber(d), fri = fridayOf(n), dow = n - fri;
  const live = fri >= FIRST_WEEKEND && ((dow === 0 && d.getHours() >= OPEN_HOUR) || dow === 1 || dow === 2);
  const opens = f => dayStart(f) + OPEN_HOUR * 3600000;
  let nextFri = dow === 0 && d.getHours() < OPEN_HOUR ? fri : fri + 7;
  if (nextFri < FIRST_WEEKEND) nextFri = FIRST_WEEKEND;
  const cur = live ? fri : nextFri;
  return {
    live, key: live ? fri : null, cup: cupOf(cur), opensAt: opens(cur), closesAt: dayStart(cur + 3),
    next: { key: live ? fri + 7 : nextFri, cup: cupOf(live ? fri + 7 : nextFri), opensAt: opens(live ? fri + 7 : nextFri) },
  };
}
// The cup a weekend key (its Friday) plays.
export const cupFor = key => cupOf(key);

/* ---------- Rewards ---------- */
// Placings: 1 entrant (played a quarter-final), 2 semi-finalist, 3 finalist, 4 champion.
export const PLACES = [
  null,
  { id: 'entrant', name: 'Entrant', card: 'Cup Entrant' },
  { id: 'semi', name: 'Semi-finalist', card: 'Semi-finalist' },
  { id: 'finalist', name: 'Finalist', card: 'Finalist' },
  { id: 'champion', name: 'Champion', card: 'Cup Champion' },
];
export const placeName = p => PLACES[p]?.name ?? '';
// XP: the first match of a weekend pays ENTRY_XP; each round won pays its ROUND_XP, once a weekend (a re-entry that
// wins the same round again does not pay it twice). It goes on the match's XP lines, so the season track takes it too.
export const ENTRY_XP = 500;
export const ROUND_XP = [1500, 2500, 4000];

export const tnCardId = p => `tn-${PLACES[p].id}`;
export const TN_EMBLEM = 'tn-champion';
export const TN_CAMO = 'tn-laurel';
// Calling cards (art as js/ui/cards.js draws it), one per placing; the champion's animated.
export const TOURNEY_CARDS = [1, 2, 3, 4].map(p => ({
  id: tnCardId(p), name: PLACES[p].card, place: p,
  art: [
    { p: 'rails', c: ['#14181e', '#3a4654', '#e6ecf2', '#9fb4c8'], e: 'ui:cup' },
    { p: 'chevrons', c: ['#101a22', '#2a5674', '#dff4ff', '#7cd8ff'], e: 'ui:cup', gold: true },
    { p: 'rays', c: ['#1c1408', '#6a4a14', '#fff0c8', '#ffcf40'], e: 'ui:cup', gold: true },
    { p: 'rays', c: ['#1a0e04', '#b27616', '#fff4bf', '#ffd659'], e: 'ui:crown', gold: true, anim: 'gold' },
  ][p - 1],
}));
// The champion's emblem: a row like js/ui/emblems.js ROWS.
export const TOURNEY_EMBLEM_ROW = [TN_EMBLEM, 'Champion\'s Crest', 'shield', '#ffd659', ['#fff4bf', '#ffd659'], 'crown'];
// The champion's camo, every gun: a CAMOS row (`tourney` marks it; ownership comes from the block).
export const TOURNEY_CAMO = { id: TN_CAMO, name: 'Champion\'s Laurel', pattern: 'gold', colors: [0xffe08a, 0x7a3a10, 0xfffbe6], scale: 7.0, animated: true, tier: 3, tint: 0xffd060, tourney: true };

/* ---------- The save block ---------- */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const cnt = (v, max) => (Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0);
const OWNER_OK = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(s);
export const blankTourney = () => ({ k: 0, o: '', e: 0, r: 0, x: RUN_LIVE, b: 0, pd: 0, ep: 0, pl: 0, log: [] });

export function cleanTourney(raw) {
  const t = blankTourney();
  if (!isObj(raw)) return t;
  const k = cnt(raw.k, 1e6);
  if (k >= FIRST_WEEKEND && fridayOf(k) === k) {
    t.k = k;
    t.o = OWNER_OK(raw.o) ? raw.o : '';
    t.e = cnt(raw.e, MAX_ENTRIES);
    t.r = cnt(raw.r, 3);
    t.x = [RUN_LIVE, RUN_OUT, RUN_CHAMP].includes(raw.x) ? raw.x : RUN_LIVE;
    if (t.r >= 3) t.x = RUN_CHAMP;
    t.b = cnt(raw.b, 4);
    t.pd = cnt(raw.pd, 3);
    t.ep = cnt(raw.ep, 1);
    t.pl = t.x === RUN_LIVE && cnt(raw.pl, 3) === t.r + 1 ? t.r + 1 : 0;
  }
  if (Array.isArray(raw.log)) {
    const seen = new Set();
    for (const row of raw.log) {
      if (!Array.isArray(row)) continue;
      const [f, c, p] = row;
      if (!Number.isInteger(f) || f < FIRST_WEEKEND || fridayOf(f) !== f || seen.has(f)) continue;
      if (!Number.isInteger(c) || c < 0 || c >= CUPS.length || !Number.isInteger(p) || p < 1 || p > 4) continue;
      seen.add(f);
      t.log.push([f, c, p]);
    }
    t.log.sort((a, b) => a[0] - b[0]);
    if (t.log.length > LOG_MAX) t.log = t.log.slice(-LOG_MAX);
  }
  return t;
}
// Nothing worth a place in the save code yet.
export const tourneyEmpty = raw => { const t = cleanTourney(raw); return !t.k && !t.log.length; };

// Everything the block owns: Set of 'card:tn-..', 'emblem:tn-champion', 'camo:tn-laurel'.
const ownCache = { key: null, set: null };
export function tourneyOwned(t) {
  const best = Math.max(0, ...(t?.log ?? []).map(r => r[2]), t?.b ?? 0);
  if (ownCache.key === best) return ownCache.set;
  const set = new Set();
  for (let p = 1; p <= best; p++) set.add(`card:${tnCardId(p)}`);
  if (best >= 4) { set.add(`emblem:${TN_EMBLEM}`); set.add(`camo:${TN_CAMO}`); }
  ownCache.key = best; ownCache.set = set;
  return set;
}
export const bestPlace = t => Math.max(0, ...(t?.log ?? []).map(r => r[2]));

// The block brought to a weekend: a run from an earlier weekend is over (its log row already holds its placing).
export function rollTourney(t, key) {
  if (t.k === key) return false;
  Object.assign(t, { k: key, o: '', e: 0, r: 0, x: RUN_LIVE, b: 0, pd: 0, ep: 0, pl: 0 });
  return true;
}

// What this weekend's run allows: { entered, round (the next round to play, 0..2, or null), out, champion,
//   canEnter (no entry used yet), canReenter (knocked out with a re-entry left), entriesLeft }.
export function runStatus(t, key) {
  const same = t.k === key;
  const e = same ? t.e : 0, x = same ? t.x : RUN_LIVE, r = same ? t.r : 0;
  const entered = e > 0;
  return {
    entered, round: entered && x === RUN_LIVE ? r : null, out: entered && x === RUN_OUT, champion: entered && x === RUN_CHAMP,
    canEnter: !entered, canReenter: entered && x === RUN_OUT && e < MAX_ENTRIES, entriesLeft: MAX_ENTRIES - e, roundsWon: r, best: same ? t.b : 0,
  };
}

// Starts an entry (the first, or the re-entry after a knock-out) in `owner`'s bracket. Returns false when not allowed.
export function enterTourney(t, key, owner) {
  rollTourney(t, key);
  const s = runStatus(t, key);
  if (!(s.canEnter || s.canReenter)) return false;
  t.e += 1; t.r = 0; t.x = RUN_LIVE;
  if (OWNER_OK(owner)) t.o = owner;
  return true;
}

// A party match in someone else's bracket (the host's): this phone's run follows it. `round` is the round played.
export function joinTourney(t, key, owner, round) {
  rollTourney(t, key);
  if (OWNER_OK(owner)) t.o = owner;
  if (t.e === 0) t.e = 1;
  t.r = Math.max(0, Math.min(2, round | 0));
  t.x = RUN_LIVE;
  t.pl = t.r + 1;
}

// A round's match starts: until its result lands, leaving it (or closing the app) is a forfeit (settleForfeit).
export function startRound(t, key, round) {
  if (t.k !== key || t.x !== RUN_LIVE || round !== t.r) return false;
  t.pl = round + 1;
  return true;
}
// A round started and never finished: it counts as lost. Returns applyTourneyRound's result, or null.
export function settleForfeit(t) {
  if (!t.pl || t.x !== RUN_LIVE) { t.pl = 0; return null; }
  return applyTourneyRound(t, { key: t.k, round: t.pl - 1, won: false });
}

// One finished round. ctx: { key, round, won }. Returns { round, won, place, placeBefore, xp: [[label, n]],
//   rewards: ['card:..', ...] newly owned, champion, out } or null when the run cannot take it.
export function applyTourneyRound(t, { key, round, won }) {
  if (t.k !== key || t.x !== RUN_LIVE || round !== t.r) return null;
  t.pl = 0;
  const ownedBefore = tourneyOwned(t), placeBefore = t.b;
  const xp = [];
  if (!t.ep) { t.ep = 1; xp.push(['Tournament entry', ENTRY_XP]); }
  let place;
  if (won) {
    t.r = round + 1;
    if (t.pd < t.r) { t.pd = t.r; xp.push([`${ROUND_NAMES[round]} won`, ROUND_XP[round]]); }
    if (t.r >= 3) t.x = RUN_CHAMP;
    place = 1 + t.r;
  } else {
    t.x = RUN_OUT;
    place = 1 + round;
  }
  t.b = Math.max(t.b, place);
  const cup = CUPS.indexOf(cupOf(key));
  const row = t.log.find(r => r[0] === key);
  if (row) row[2] = Math.max(row[2], t.b);
  else { t.log.push([key, cup, t.b]); if (t.log.length > LOG_MAX) t.log.shift(); }
  const after = tourneyOwned(t);
  return {
    round, won, place: t.b, placeBefore, xp, rewards: [...after].filter(id => !ownedBefore.has(id)),
    champion: t.x === RUN_CHAMP, out: t.x === RUN_OUT,
  };
}
