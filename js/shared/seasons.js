// Seasons (docs/ROADMAP.md item 22, docs/SEASONS.md): which season a date is in, its weekly challenge sets, the free
// reward track, and the save's season block. Pure: no DOM, no storage (js/ui/progress.js keeps the block in the save).
//
// Dates: a season opens at local midnight of its start day and every boundary is a local calendar day, read the way
// the boards read it (the local Y-M-D taken as a UTC day number), so every phone on the same date agrees wherever it is.
// Before Season 1: the Preseason (ranked plays, the track waits). After the last scheduled season ends: Season Replay,
// the past seasons again in order, each a fresh SEASON_DAYS instance (`S1R1`, `S2R1`, `S1R2`, ...) with its track,
// weekly sets and event, so there is always something to earn.
//
// The save's block (save.season), appended to save v4 and to the save code as its 19th entry:
//   { k: instance key the progress belongs to, xp: track XP this instance, st: stars this instance, c: tiers claimed this
//     instance, wc: {challengeId: progress} this instance, cl: {seasonId: best tier claimed in any instance},
//     rr: {seasonId: best ranked division paid}, rk: ranked block (js/shared/ranked.js),
//     sn: {key, m, k, d, w, brw, br5, ex}: this season's career window for the Season boards }
// Ownership is derived: the rewards of tiers 1..cl[id] of each season, and the ranked card and emblem of every division
// up to rr[id]. Nothing is lost at a rollover: reached tiers are claimed for the player first.
import { SEASON_DEFS, SEASON_DAYS, SEASON_WEEKS, TRACK_TIERS, trackRewards, rankedCards, DIVISIONS, rankRewardId, seasonCamos } from './season-items.js';
import { blankRanked, cleanRanked, rolloverRanked } from './ranked.js';

export { SEASON_DEFS, SEASON_DAYS, SEASON_WEEKS, TRACK_TIERS, trackRewards };
export const TIER_XP = 5000;           // Match XP per tier.
export const STAR_TIERS = 1;           // A weekly challenge star is worth one tier.
export const WEEKLY_PER_WEEK = 5;
const DAY = 86400000;

const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
// The local calendar day of a date, as a day number (days since 1970-01-01 of that Y-M-D).
export const dayNumber = (date = new Date()) => { const d = new Date(date); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); };
// Local midnight that starts day number n on this phone.
export const dayStart = n => { const u = new Date(n * DAY); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime(); };

const STARTS = SEASON_DEFS.map(d => parseDay(d.start));
const LAST_END = STARTS[STARTS.length - 1] + SEASON_DEFS[SEASON_DEFS.length - 1].days;
export const PRESEASON_START = parseDay('2026-11-01');     // The bot pool's epoch: the Season boards' preseason window.
export const defById = id => SEASON_DEFS.find(d => d.id === id) ?? null;

// The season instance a date falls in:
// { key, def (null in the Preseason), name, title, replay (0, or the replay cycle), startDay, endDay, day (days in),
//   week (0-based), daysLeft, endsAt (ms) }.
export function seasonAt(date = new Date()) {
  const day = dayNumber(date);
  let def = null, startDay, endDay, replay = 0, key;
  if (day < STARTS[0]) { key = 'pre'; startDay = PRESEASON_START; endDay = STARTS[0]; }
  else if (day < LAST_END) {
    let i = STARTS.length - 1;
    while (STARTS[i] > day) i--;
    def = SEASON_DEFS[i]; startDay = STARTS[i]; endDay = startDay + def.days; key = def.id;
    // A gap in the schedule (a season ending before the next starts) is covered by the season before it running long.
    if (i + 1 < STARTS.length) endDay = STARTS[i + 1];
  } else {
    const idx = Math.floor((day - LAST_END) / SEASON_DAYS);
    def = SEASON_DEFS[idx % SEASON_DEFS.length];
    replay = 1 + Math.floor(idx / SEASON_DEFS.length);
    startDay = LAST_END + idx * SEASON_DAYS; endDay = startDay + SEASON_DAYS; key = `${def.id}R${replay}`;
  }
  const into = Math.max(0, day - startDay);
  return {
    key, def, replay, startDay, endDay, day: into, week: def ? Math.min(SEASON_WEEKS - 1, Math.floor(into / 7)) : 0,
    daysLeft: endDay - day, endsAt: dayStart(endDay), startsAt: dayStart(startDay),
    name: def ? def.name : 'Preseason',
    title: !def ? 'Preseason' : replay ? `Season Replay: ${def.name}` : `Season ${def.n}: ${def.name}`,
    short: !def ? 'Preseason' : replay ? 'Replay' : `Season ${def.n}`,
    next: !def ? SEASON_DEFS[0] : null,
  };
}

// The instance a stored key names: { key, def, replay } or null.
export function parseKey(key) {
  if (key === 'pre') return { key, def: null, replay: 0 };
  const m = /^(S\d{1,3})(?:R(\d{1,4}))?$/.exec(key ?? '');
  const def = m && defById(m[1]);
  return def ? { key, def, replay: m[2] ? Number(m[2]) : 0 } : null;
}

// The season's limited-time event if it is on that date: { ...event, endsAt, daysLeft } or null.
export function eventAt(date = new Date()) {
  const s = seasonAt(date), e = s.def?.event;
  if (!e || s.day < e.from || s.day >= e.to) return null;
  const end = s.startDay + e.to;
  return { ...e, season: s.key, daysLeft: end - dayNumber(date), endsAt: dayStart(end) };
}

// Date-locked content: an item a season declares (its camos and skins, and anything in `content`) stays locked until
// that season first starts. kind: 'map'|'mode'|'weapon'|'operator'|'camo'|'skin'.
const LOCKS = new Map();
for (const [i, def] of SEASON_DEFS.entries()) {
  for (const c of def.content ?? []) LOCKS.set(`${c.kind}:${c.id}`, STARTS[i]);
  for (const c of seasonCamos(def)) LOCKS.set(`camo:${c.id}`, STARTS[i]);
  for (const [op] of def.skins) LOCKS.set(`skin:skin:${op}-s${def.n}`, STARTS[i]);
}
export const dateLocked = (kind, id, date = new Date()) => (LOCKS.get(`${kind}:${id}`) ?? -Infinity) > dayNumber(date);
export const lockDay = (kind, id) => LOCKS.get(`${kind}:${id}`) ?? null;

/* ---------- Weekly challenge sets ---------- */
// One set of WEEKLY_PER_WEEK a week, drawn from these templates by the season and week (the same on every phone), no
// two of a family in a week. A set opens at the start of its week and stays open to the end of the season. Goals rise
// a little each week. Stats are ChallengeTally counts (js/shared/progression.js) plus `ranked` (a ranked match played).
const T = (key, family, stat, goals, stars, icon, label) => ({ key, family, stat, goals, stars, icon, label });
const WEEKLY_TEMPLATES = [
  T('kills', 'kills', 'kills', [60, 80, 100, 120, 140, 160], 1, 'ui:skull', g => `Get ${g} kills`),
  T('head', 'head', 'head', [15, 20, 25, 30, 35, 40], 1, 'medal:headshot', g => `Get ${g} headshot kills`),
  T('long', 'long', 'long', [8, 10, 12, 14, 16, 18], 1, 'medal:longshot', g => `Get ${g} longshot kills`),
  T('wins', 'wins', 'wins', [3, 4, 5, 6, 7, 8], 2, 'ui:cup', g => `Win ${g} matches`),
  T('played', 'wins', 'played', [5, 6, 7, 8, 9, 10], 1, 'ui:play', g => `Play ${g} matches`),
  T('ranked', 'ranked', 'ranked', [2, 3, 3, 4, 4, 5], 2, 'ui:rank', g => `Play ${g} Ranked matches`),
  T('capture', 'obj', 'captures', [8, 10, 12, 14, 16, 18], 1, 'medal:capture', g => `Capture ${g} flags or zones`),
  T('bombs', 'obj', 'bombs', [2, 3, 4, 5, 6, 7], 2, 'medal:plant', g => `Plant or defuse the bomb ${g} times`),
  T('assists', 'team', 'assists', [10, 12, 15, 18, 20, 25], 1, 'ui:party', g => `Get ${g} assists`),
  T('equip', 'equip', 'equipKills', [4, 5, 6, 7, 8, 10], 1, 'frag', g => `Get ${g} kills with lethal equipment`),
  T('streaks', 'streak', 'streaksCalled', [3, 4, 5, 6, 7, 8], 1, 'uav', g => `Call in ${g} scorestreaks`),
  T('multi', 'multi', 'multi', [4, 5, 6, 7, 8, 9], 2, 'medal:double', g => `Get ${g} multi-kills`),
  T('slide', 'slide', 'slideKills', [5, 6, 7, 8, 9, 10], 1, 'slide', g => `Get ${g} kills while sliding`),
  T('hip', 'style', 'hipKills', [20, 25, 30, 35, 40, 45], 1, 'ui:aim', g => `Get ${g} kills from the hip`),
  T('ar', 'gun', 'cat:Assault', [30, 35, 40, 45, 50, 55], 1, 'cat:Assault', g => `Get ${g} kills with assault rifles`),
  T('smg', 'gun', 'cat:SMG', [30, 35, 40, 45, 50, 55], 1, 'cat:SMG', g => `Get ${g} kills with SMGs`),
  T('sniper', 'gun', 'cat:Sniper', [10, 12, 14, 16, 18, 20], 1, 'cat:Sniper', g => `Get ${g} kills with sniper rifles`),
  T('shotgun', 'gun', 'cat:Shotgun', [20, 24, 28, 32, 36, 40], 1, 'cat:Shotgun', g => `Get ${g} kills with shotguns`),
  T('hp', 'mode', 'played:hard', [2, 2, 3, 3, 4, 4], 1, 'mode:hard', g => `Play ${g} Hardpoint matches`),
  T('ctl', 'mode', 'played:ctl', [2, 2, 3, 3, 4, 4], 1, 'mode:ctl', g => `Play ${g} Control matches`),
];

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const weekCache = new Map();
// The set of week `w` (0-based) of a season: [{ id, week, stat, goal, stars, icon, label }].
export function weeklySet(def, w) {
  const ck = `${def.id}:${w}`;
  if (weekCache.has(ck)) return weekCache.get(ck);
  const r = rng(hash32(`${def.id}:week:${w}`)), list = WEEKLY_TEMPLATES.slice();
  for (let i = list.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [list[i], list[k]] = [list[k], list[i]]; }
  // Every week has one ranked or wins goal and one objective or mode goal, so the stars pull people into those.
  const pick = [], fams = new Set();
  const take = t => { if (pick.length < WEEKLY_PER_WEEK && !fams.has(t.family)) { pick.push(t); fams.add(t.family); } };
  take(list.find(t => t.family === (w % 2 ? 'wins' : 'ranked')));
  take(list.find(t => t.family === (w % 2 ? 'obj' : 'mode')));
  for (const t of list) take(t);
  const out = pick.map(t => ({ id: `${def.id}.w${w + 1}.${t.key}`, week: w, stat: t.stat, goal: t.goals[w], stars: t.stars, icon: t.icon, label: t.label(t.goals[w]) }));
  weekCache.set(ck, out);
  return out;
}
export const weeklyAll = def => Array.from({ length: SEASON_WEEKS }, (_, w) => weeklySet(def, w));
const challengeById = (def, id) => weeklyAll(def).flat().find(c => c.id === id) ?? null;
// Whether week w of a season instance is open on a date.
export const weekOpen = (season, w) => !!season.def && w <= season.week;
export const weekOpensAt = (season, w) => dayStart(season.startDay + w * 7);

/* ---------- The track ---------- */
export const tierOf = xp => Math.min(TRACK_TIERS, Math.floor(Math.max(0, xp) / TIER_XP));
export function tierProgress(xp) {
  const tier = tierOf(xp), maxed = tier >= TRACK_TIERS;
  return { tier, into: maxed ? TIER_XP : xp - tier * TIER_XP, span: TIER_XP, maxed };
}

/* ---------- The save block ---------- */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const cnt = (v, max = 1e9) => (Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0);
const blankWindow = (key = '') => ({ key, m: 0, k: 0, d: 0, w: 0, brw: 0, br5: 0, ex: 0 });
export const blankSeasonState = () => ({ k: '', xp: 0, st: 0, c: 0, wc: {}, cl: {}, rr: {}, rk: blankRanked(), sn: blankWindow() });
const KEY_OK = k => typeof k === 'string' && !!parseKey(k);

export function cleanSeasonState(raw) {
  const s = blankSeasonState();
  if (!isObj(raw)) return s;
  s.k = KEY_OK(raw.k) ? raw.k : '';
  s.xp = cnt(raw.xp, TIER_XP * TRACK_TIERS * 4);
  s.st = cnt(raw.st, 1000);
  s.c = Math.min(TRACK_TIERS, cnt(raw.c));
  const def = parseKey(s.k)?.def;
  if (def && isObj(raw.wc)) {
    for (const c of weeklyAll(def).flat()) if (Number.isFinite(raw.wc[c.id]) && raw.wc[c.id] > 0) s.wc[c.id] = Math.min(c.goal, cnt(raw.wc[c.id]));
  }
  for (const d of SEASON_DEFS) {
    if (Number.isFinite(raw.cl?.[d.id]) && raw.cl[d.id] > 0) s.cl[d.id] = Math.min(TRACK_TIERS, cnt(raw.cl[d.id]));
    if (Number.isFinite(raw.rr?.[d.id]) && raw.rr[d.id] >= 0) s.rr[d.id] = Math.min(DIVISIONS.length - 1, cnt(raw.rr[d.id]));
  }
  s.rk = cleanRanked(raw.rk);
  if (isObj(raw.sn) && KEY_OK(raw.sn.key)) {
    s.sn = blankWindow(raw.sn.key);
    for (const k of ['m', 'k', 'd', 'w', 'brw', 'br5', 'ex']) s.sn[k] = cnt(raw.sn[k]);
  }
  return s;
}
// Whether a block says anything (an untouched one stays out of the save code, so old codes re-export unchanged).
// Only the keys (which instance it was rolled to) count as nothing: a fresh block is rolled to today on every load.
export function seasonStateEmpty(raw) {
  if (!raw) return true;
  const s = cleanSeasonState(raw), b = blankSeasonState();
  s.k = ''; s.rk.k = ''; s.sn.key = '';
  return JSON.stringify(s) === JSON.stringify(b);
}

// Everything a block owns: Set of 'card:..', 'emblem:..', 'camo:..', 'skin:..', 'weapon:..', 'operator:..'.
const ownCache = { key: null, set: null };
export function seasonOwned(s) {
  const key = JSON.stringify([s?.cl ?? {}, s?.rr ?? {}]);
  if (ownCache.key === key) return ownCache.set;
  const set = new Set();
  for (const d of SEASON_DEFS) {
    for (const r of trackRewards(d).slice(0, s?.cl?.[d.id] ?? 0)) set.add(r.own);
    const rr = s?.rr?.[d.id];
    if (Number.isFinite(rr)) for (let i = 0; i <= rr; i++) { set.add(`card:${rankRewardId(d, i)}`); set.add(`emblem:${rankRewardId(d, i)}`); }
  }
  ownCache.key = key; ownCache.set = set;
  return set;
}

// Claims every reached tier of the block's instance. Returns the rewards newly owned (tier order).
export function claimTiers(s) {
  const def = parseKey(s.k)?.def;
  if (!def) return [];
  const reached = tierOf(s.xp), before = seasonOwned(s);
  if (reached <= s.c) return [];
  const list = trackRewards(def).slice(s.c, reached);
  s.c = reached;
  s.cl[def.id] = Math.max(s.cl[def.id] ?? 0, reached);
  return list.map(r => ({ ...r, fresh: !before.has(r.own) }));
}

// Brings a block to the instance of `now`: an older instance's reached tiers are claimed for the player and its ranked
// season paid out, then the track, weekly progress, career window and ranked season start over.
// Returns { changed, claimed: [rewards], ranked: { key, peakDiv } | null, from }.
export function rollover(s, now = new Date()) {
  const season = seasonAt(now);
  const out = { changed: false, claimed: [], ranked: null, from: s.k };
  if (s.k !== season.key) {
    out.claimed = claimTiers(s);
    Object.assign(s, { k: season.key, xp: 0, st: 0, c: 0, wc: {} });
    out.changed = true;
  }
  if (s.sn.key !== season.key) { s.sn = blankWindow(season.key); out.changed = true; }
  if (s.rk.k !== season.key) {
    const r = rolloverRanked(s.rk, season.key);
    s.rk = r.rk; out.changed = true;
    const def = r.ended && parseKey(r.ended.key)?.def;
    if (def) {
      s.rr[def.id] = Math.max(s.rr[def.id] ?? -1, r.ended.peakDiv);
      out.ranked = { ...r.ended, def };
    }
  }
  return out;
}

// One match into the block (already rolled over to `now`). m: { xp (the match's XP total), counts (ChallengeTally
// counts, plus `ranked: 1` for a ranked match), career: { kills, deaths, won, br, place, extracted } }.
// Returns { key, tierBefore, tierAfter, xpBefore, xpAfter, xpGained, stars, challenges: [moved] } or null in the
// Preseason (no track).
export function applySeasonMatch(s, m, now = new Date()) {
  const season = seasonAt(now);
  const c = m.career;
  if (c) {
    const sn = s.sn;
    sn.m++; sn.k += cnt(c.kills); sn.d += cnt(c.deaths);
    if (c.won) sn.w++;
    if (c.br && (c.won || c.place === 1)) sn.brw++;
    if (c.br && (c.won || (Number.isFinite(c.place) && c.place <= 5))) sn.br5++;
    if (c.extracted) sn.ex++;
  }
  if (!season.def) return null;
  const xpBefore = s.xp, tierBefore = tierOf(s.xp), moved = [];
  let stars = 0;
  for (let w = 0; w <= season.week; w++) {
    for (const ch of weeklySet(season.def, w)) {
      const gain = m.counts?.[ch.stat] ?? 0, before = s.wc[ch.id] ?? 0;
      if (!(gain > 0) || before >= ch.goal) continue;
      const value = Math.min(ch.goal, before + Math.round(gain));
      s.wc[ch.id] = value;
      const fresh = value >= ch.goal;
      if (fresh) stars += ch.stars;
      moved.push({ ...ch, before, value, done: fresh, fresh, period: 'season' });
    }
  }
  s.st += stars;
  const gained = Math.max(0, Math.round(m.xp ?? 0)) + stars * STAR_TIERS * TIER_XP;
  s.xp = Math.min(TIER_XP * TRACK_TIERS * 4, s.xp + gained);
  return { key: season.key, tierBefore, tierAfter: tierOf(s.xp), xpBefore, xpAfter: s.xp, xpGained: gained, stars, challenges: moved };
}

// The weekly sets for a block on a date: [{ week, open, opensAt, list: [{...challenge, value, done}] }].
export function weeklyStatus(s, now = new Date()) {
  const season = seasonAt(now);
  if (!season.def) return [];
  return weeklyAll(season.def).map((list, w) => ({
    week: w, open: weekOpen(season, w), opensAt: weekOpensAt(season, w),
    list: list.map(c => ({ ...c, value: Math.min(c.goal, s.k === season.key ? s.wc[c.id] ?? 0 : 0), done: s.k === season.key && (s.wc[c.id] ?? 0) >= c.goal })),
  }));
}

// The ranked rewards a season pays, for the screens: [{ div, card, emblem }].
export const rankedRewards = def => rankedCards(def).map((c, i) => ({ div: i, card: c.id, emblem: rankRewardId(def, i) }));
