// Leaderboards (ROADMAP item 16). Pure: no DOM, no storage, so dev/sim-boards.mjs runs it in node.
//
// Three kinds of row, one shape (an "entry"):
//   me      this phone's player, from Progress.careerCard() (js/ui/progress.js)
//   friend  a career card another phone sent while sharing a lobby, kept "as of" when it was last seen (Friends store)
//   pool    the 200 bot players (js/shared/botpool.js) through careerAt(profile, now): the same on every phone, since
//           it depends only on the date. They look like players: their tag, badge, card, emblem and operator.
// entry: { id, kind, name, level, prestige, xp, m, k, w, brm, brw, br5, ex, kdm, kdk, d, mst, wk: {key, k, w},
//          op, skin, card, emblem, asOf (friends: ms) }. Field meanings as recordCareer (js/shared/progression.js).
//
// Bots you played against do not get a bump from that match: it would live only on the phones that were there, so
// two friends' boards would disagree about the same bot. Their careers stay a function of the date alone.
import { BOT_POOL, careerAt, hash32 } from './botpool.js';
import { CARD_IDS, MAX_LEVEL, MAX_PRESTIGE, MASTERY_TOTAL, weekStart, periodKey, dayKey } from './progression.js';
import { OPERATOR_IDS, getSkin } from '../ui/operators.js';
import { cleanEmblem } from '../ui/emblems.js';

export const CARD_VERSION = 1;
export const FRIENDS_MAX = 100;
export const KD_MIN_MATCHES = 25;      // K/D ranks only careers with at least this many tracked matches.
export const AROUND = 6;               // Around me: this many rows either side of yours.

const BIG = 1e9;
const num = v => (Number.isFinite(v) ? Math.min(BIG, Math.max(0, Math.floor(v))) : 0);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const NAME_BAD = /[\u0000-\u001f\u007f<>]/g;

// A career card off the wire (or out of storage): anything at all in, only known totals and known looks out.
// Returns null when it is not a card.
export function cleanCard(raw) {
  if (!isObj(raw) || raw.v !== CARD_VERSION) return null;
  const name = String(raw.name ?? '').replace(NAME_BAD, '').trim().slice(0, 12);
  if (!name) return null;
  const c = {
    v: CARD_VERSION, name,
    level: Math.min(MAX_LEVEL, Math.max(1, num(raw.level))), prestige: Math.min(MAX_PRESTIGE, num(raw.prestige)), xp: num(raw.xp),
    m: num(raw.m), k: num(raw.k), w: num(raw.w), brm: num(raw.brm), brw: num(raw.brw), br5: num(raw.br5), ex: num(raw.ex),
    kdm: num(raw.kdm), kdk: num(raw.kdk), d: num(raw.d), mst: Math.min(MASTERY_TOTAL(), num(raw.mst)),
    wk: { key: '', k: 0, w: 0 },
    op: OPERATOR_IDS.includes(raw.op) ? raw.op : null,
    skin: null, card: CARD_IDS.includes(raw.card) ? raw.card : 'yard', emblem: cleanEmblem(raw.emblem),
  };
  c.brw = Math.min(c.brw, c.brm); c.br5 = Math.min(Math.max(c.br5, c.brw), c.brm);
  c.kdm = Math.min(c.kdm, c.m); c.kdk = Math.min(c.kdk, c.k);
  if (c.op && getSkin(raw.skin)?.operator === c.op) c.skin = getSkin(raw.skin).id;
  if (isObj(raw.wk) && typeof raw.wk.key === 'string' && /^W\d{4}-\d{2}-\d{2}$/.test(raw.wk.key)) c.wk = { key: raw.wk.key, k: num(raw.wk.k), w: num(raw.wk.w) };
  return c;
}

/* ---------- Friends: { id, at, card } newest first, at most FRIENDS_MAX ---------- */
const PID = /^[A-Za-z0-9_-]{1,24}$/;

export function cleanFriends(raw) {
  const list = Array.isArray(raw?.list) ? raw.list : [];
  const out = [], seen = new Set();
  for (const f of list) {
    if (!isObj(f) || !PID.test(f.id) || seen.has(f.id) || !Number.isFinite(f.at)) continue;
    const card = cleanCard(f.card);
    if (!card) continue;
    seen.add(f.id);
    out.push({ id: f.id, at: f.at, card });
  }
  out.sort((a, b) => b.at - a.at);
  return out.slice(0, FRIENDS_MAX);
}

// A card seen now: replaces that friend's older one; past the cap the friend seen longest ago drops off.
// Returns the new list, or null if the card or id was no good. selfId is never stored as a friend.
export function seeFriend(list, id, raw, now = Date.now(), selfId = null) {
  const card = cleanCard(raw);
  if (!card || typeof id !== 'string' || !PID.test(id) || id === selfId) return null;
  const next = [{ id, at: now, card }, ...list.filter(f => f.id !== id && f.id !== selfId)];
  next.sort((a, b) => b.at - a.at);
  return next.slice(0, FRIENDS_MAX);
}

/* ---------- Entries ---------- */
const entryOf = (id, kind, card, extra = {}) => ({ id, kind, ...card, ...extra });

// A friend's or my weekly numbers count only in the week they were for.
const weekly = (e, key) => (e.wk?.key === key ? e.wk : { key, k: 0, w: 0 });
export const weekOf = (e, now = Date.now()) => weekly(e, periodKey('weekly', new Date(now)));

// Mastery for a bot: no tracks to read, so a steady share of their matches, set by their id and usual skill; never
// falls (matches never do) and never passes what there is to finish.
function botMastery(p, matches) {
  const rate = (0.0015 + 0.012 * (hash32('mastery', p.id) / 4294967296)) * (0.5 + p.skill.mu);
  return Math.min(MASTERY_TOTAL(), Math.floor(matches * rate));
}

// Every pool bot as an entry on `now`'s date, cached per day (careerAt runs one loop step a week, twice per bot).
let poolCache = { key: null, list: null };
export function poolEntries(now = Date.now()) {
  const d = new Date(now), key = `${dayKey(d)}|${periodKey('weekly', d)}`;
  if (poolCache.key === key) return poolCache.list;
  // Careers move by whole days. The board reads the local calendar date as that day in UTC, so every phone on the same
  // date gets the same rows, wherever it is; the week from this Monday's date the same way.
  const utc = x => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const wkKey = periodKey('weekly', d), from = utc(weekStart(d)), today = utc(d);
  const list = BOT_POOL.map(p => {
    const c = careerAt(p, today), was = careerAt(p, from);
    return entryOf(p.id, 'pool', {
      name: p.name, level: c.level, prestige: c.prestige, xp: c.xp,
      m: c.matches, k: c.kills, w: c.wins, brm: c.brMatches, brw: c.brWins, br5: c.brTop5, ex: c.extractions,
      kdm: c.matches, kdk: c.kills, d: c.deaths, mst: botMastery(p, c.matches),
      wk: { key: wkKey, k: c.kills - was.kills, w: (c.wins - was.wins) + (c.brWins - was.brWins) },
      op: p.operator, skin: p.skin, card: p.card, emblem: p.emblem,
    });
  });
  poolCache = { key, list };
  return list;
}

/* ---------- Categories ---------- */
const kdOf = e => (e.d ? e.kdk / e.d : e.kdk);
const fmtInt = v => Math.round(v).toLocaleString('en-US');
export const CATEGORIES = [
  { id: 'level', label: 'Level', icon: 'rank', value: e => e.prestige * MAX_LEVEL + e.level, tie: e => e.xp, fmt: (v, e) => `${e.prestige ? `P${e.prestige} · ` : ''}${e.level}` },
  { id: 'kills', label: 'Kills', icon: 'skull', value: e => e.k, fmt: fmtInt },
  { id: 'kd', label: 'K/D', icon: 'aim', value: kdOf, eligible: e => e.kdm >= KD_MIN_MATCHES, tie: e => e.kdm, fmt: v => v.toFixed(2),
    rule: `At least ${KD_MIN_MATCHES} matches` },
  { id: 'wins', label: 'Wins', icon: 'cup', value: e => e.w, fmt: fmtInt },
  { id: 'brwins', label: 'BR wins', icon: 'crown', value: e => e.brw, fmt: fmtInt },
  { id: 'brtop5', label: 'BR top 5', icon: 'star', value: e => e.br5, fmt: fmtInt },
  { id: 'extract', label: 'Extractions', icon: 'exit', value: e => e.ex, fmt: fmtInt },
  { id: 'mastery', label: 'Mastery', icon: 'flag', value: e => e.mst, fmt: fmtInt },
  { id: 'wkills', label: 'Week kills', icon: 'skull', weekly: true, value: (e, wk) => weekly(e, wk).k, fmt: fmtInt },
  { id: 'wwins', label: 'Week wins', icon: 'cup', weekly: true, value: (e, wk) => weekly(e, wk).w, fmt: fmtInt },
];
export const CATEGORY_IDS = CATEGORIES.map(c => c.id);
export const getCategory = id => CATEGORIES.find(c => c.id === id) ?? CATEGORIES[0];
export const VIEWS = ['everyone', 'friends', 'around'];

// Ranks entries on a category: highest first; ties share a rank (1, 2, 2, 4), ordered by the category's tie-break and
// then the name and id so every phone lists them alike. Entries the category does not admit (K/D under the minimum)
// come back in `unranked`.
export function rankEntries(entries, catId, now = Date.now()) {
  const cat = getCategory(catId), wk = periodKey('weekly', new Date(now));
  const rows = [], unranked = [];
  for (const e of entries) {
    if (cat.eligible && !cat.eligible(e)) { unranked.push(e); continue; }
    rows.push({ e, value: cat.value(e, wk), tie: cat.tie ? cat.tie(e) : 0 });
  }
  rows.sort((a, b) => b.value - a.value || b.tie - a.tie || (a.e.name < b.e.name ? -1 : a.e.name > b.e.name ? 1 : 0) || (a.e.id < b.e.id ? -1 : 1));
  let rank = 0;
  rows.forEach((r, i) => { r.rank = i && r.value === rows[i - 1].value ? rank : (rank = i + 1); });
  return { rows, unranked };
}

// The board one screen shows. me: my card (Progress.careerCard()), friends: the Friends list, view: everyone |
// friends | around. Returns { rows: [{e, value, rank, text}], me: index of my row or -1, total ranked, note }.
export function buildBoard({ me, myId = 'me', friends = [], cat = 'level', view = 'everyone', now = Date.now() }) {
  const mine = entryOf(myId, 'me', cleanCard(me) ?? cleanCard({ v: CARD_VERSION, name: 'Rookie' }));
  const pals = friends.map(f => entryOf(f.id, 'friend', f.card, { asOf: f.at }));
  const entries = view === 'friends' ? [mine, ...pals] : [mine, ...pals, ...poolEntries(now)];
  const c = getCategory(cat);
  const { rows, unranked } = rankEntries(entries, c.id, now);
  for (const r of rows) r.text = c.fmt(r.value, r.e);
  let at = rows.findIndex(r => r.e.kind === 'me');
  let list = rows, note = null;
  if (at < 0 && unranked.some(e => e.kind === 'me')) {
    const left = KD_MIN_MATCHES - mine.kdm;
    note = `Play ${left} more match${left === 1 ? '' : 'es'} to rank on K/D`;
  }
  if (view === 'around') {
    if (at < 0) list = [];
    else {
      const lo = Math.max(0, at - AROUND), hi = Math.min(rows.length, at + AROUND + 1);
      list = rows.slice(lo, hi);
      at -= lo;
    }
  }
  return { rows: list, me: at, total: rows.length, note, cat: c };
}
