// Player clans (no server). Pure: no DOM, no storage, so dev/sim-clans.mjs runs it in node. The store is Clan in
// js/ui/progress.js (its own key, 'switchyard.clan': membership is per phone and not part of a save code).
//
// A clan: { id, tag, name, c, mk, rv, own }
//   id     six hex digits the founder's phone rolled: what makes two clans with one tag different clans
//   tag    2-4 of A-Z 0-9, never one of the bot pool's clan tags (js/shared/botpool.js CLANS)
//   name   1-16 of letters, digits, space and hyphen
//   c, mk  colour and mark (indices into CLAN_COLORS and CLAN_MARKS)
//   rv     rename count: a clanmate's card with the same id and a higher rv carries the newer tag and name
//   own    this phone founded it (stored only; never on a card or in a code)
//
// Sharing: the founder (or any member) shows a join code that carries the whole clan, so a friend can join without
// a lobby; in a friend lobby a clanmate's career card (js/shared/boards.js cleanCard `cl`) offers "Join [TAG]".
import { CLANS } from './botpool.js';

export const TAG_MIN = 2, TAG_MAX = 4, NAME_MAX = 16;
export const BOT_TAGS = Object.freeze(new Set(CLANS.map(c => c.tag)));
// Plate colours and marks (marks are js/ui/icons.js ids). Append only: cards and codes carry the index.
export const CLAN_COLORS = Object.freeze(['#e8b04a', '#d9553f', '#4fa3d9', '#5fbf6a', '#b06ad9', '#e07fb0', '#43c2b5', '#c9ccd1']);
export const CLAN_MARKS = Object.freeze(['ui:star', 'ui:crown', 'ui:skull', 'ui:flag', 'ui:aim', 'ui:cup', 'ui:eye', 'ui:rank']);

const NAME_OK = /[^A-Za-z0-9 -]/g;
export const normTag = t => String(t ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normName = n => String(n ?? '').replace(NAME_OK, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// Why a tag cannot be used (a short line for the player), or null when it can.
export function tagProblem(raw) {
  const t = String(raw ?? '').toUpperCase();
  if (/[^A-Z0-9]/.test(t)) return 'Letters and numbers only';
  if (t.length < TAG_MIN || t.length > TAG_MAX) return `${TAG_MIN} to ${TAG_MAX} letters or numbers`;
  if (BOT_TAGS.has(t)) return `[${t}] is taken by another clan`;
  return null;
}
export const tagOk = t => tagProblem(t) === null;

const int = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);
// A clan off the wire, a card, a code or storage: anything in, a valid clan or null out. keepOwn: storage only.
export function cleanClan(raw, { keepOwn = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' && /^[0-9a-f]{6}$/.test(raw.id) ? raw.id : null;
  const tag = typeof raw.tag === 'string' ? raw.tag : '';
  const name = normName(raw.name);
  if (!id || !tagOk(tag) || !name) return null;
  const out = { id, tag, name, c: int(raw.c, CLAN_COLORS.length), mk: int(raw.mk, CLAN_MARKS.length), rv: Number.isInteger(raw.rv) && raw.rv >= 0 ? Math.min(raw.rv, 9999) : 0 };
  if (keepOwn && raw.own === true) out.own = true;
  return out;
}
// What a career card carries: the clan without `own`.
export const cardClan = c => (c ? cleanClan(c) : null);

// A new clan. rand: () => 0..1 (Math.random on a phone). Returns { clan } or { error }.
export function foundClan({ tag, name, c = 0, mk = 0 }, rand = Math.random) {
  const t = normTag(tag), problem = tagProblem(t);
  if (problem) return { error: problem };
  const n = normName(name);
  if (!n) return { error: 'Give the clan a name' };
  const id = Math.floor(rand() * 0x1000000).toString(16).padStart(6, '0');
  return { clan: { ...cleanClan({ id, tag: t, name: n, c, mk, rv: 0 }), own: true } };
}

// A rename (tag and name; colour and mark too). Keeps the id, bumps rv so clanmates' phones pick it up.
export function renameClan(clan, { tag = clan.tag, name = clan.name, c = clan.c, mk = clan.mk }) {
  const t = normTag(tag), problem = tagProblem(t);
  if (problem) return { error: problem };
  const n = normName(name);
  if (!n) return { error: 'Give the clan a name' };
  return { clan: { ...cleanClan({ id: clan.id, tag: t, name: n, c, mk, rv: clan.rv + 1 }), ...(clan.own ? { own: true } : {}) } };
}

// A clanmate's card clan that is newer than mine (same id, higher rv): mine updated, else null.
export function newerClan(mine, theirs) {
  const t = cleanClan(theirs);
  if (!mine || !t || t.id !== mine.id || t.rv <= mine.rv) return null;
  return { ...t, ...(mine.own ? { own: true } : {}) };
}

/* ---------- Join codes ---------- */
// Crockford base32, read back forgivingly (O as 0, I and L as 1, dashes and spaces ignored). The code is the clan
// packed into bits: id 24, colour 4, mark 4, tag 4 x 6, name length 4 (+1), name 6 a character, a check byte.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -';
const TAG_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';      // 0: no character (tags shorter than four)

function check(bits) {
  let h = 0x5c;
  for (let i = 0; i < bits.length; i++) h = ((h * 31) ^ bits.charCodeAt(i) ^ (i & 7)) & 0xff;
  return h;
}
const put = (v, n) => v.toString(2).padStart(n, '0');

export function clanCode(clan) {
  const c = cleanClan(clan);
  if (!c) return null;
  let bits = put(parseInt(c.id, 16), 24) + put(c.c, 4) + put(c.mk, 4);
  for (let i = 0; i < TAG_MAX; i++) bits += put(c.tag[i] ? TAG_CHARS.indexOf(c.tag[i]) : 0, 6);
  bits += put(c.name.length - 1, 4);
  for (const ch of c.name) bits += put(NAME_CHARS.indexOf(ch), 6);
  bits += put(check(bits), 8);
  while (bits.length % 5) bits += '0';
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{1,4}/g).join('-');
}

// A code typed or pasted: the clan it carries (no `own`), or null.
export function readClanCode(code) {
  const s = String(code ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!s || s.length > 40 || /[^0-9A-Z]/.test(s)) return null;
  let bits = '';
  for (const ch of s) { const v = B32.indexOf(ch); if (v < 0) return null; bits += put(v, 5); }
  let o = 0;
  const take = n => { if (o + n > bits.length) throw new Error('short'); const v = parseInt(bits.slice(o, o + n), 2); o += n; return v; };
  try {
    const id = take(24).toString(16).padStart(6, '0'), c = take(4), mk = take(4);
    let tag = '';
    for (let i = 0; i < TAG_MAX; i++) { const v = take(6); if (v >= TAG_CHARS.length) return null; if (v) tag += TAG_CHARS[v]; }
    const len = take(4) + 1;
    let name = '';
    for (let i = 0; i < len; i++) name += NAME_CHARS[take(6)];
    const body = bits.slice(0, o), sum = take(8);
    if (sum !== check(body) || /1/.test(bits.slice(o))) return null;
    if (c >= CLAN_COLORS.length || mk >= CLAN_MARKS.length) return null;
    return cleanClan({ id, tag, name, c, mk, rv: 0 });
  } catch {
    return null;
  }
}

// "[TAG] Name": how a clan member's name shows in lobbies, scoreboards, the kill feed and results (like a pool bot's,
// js/shared/botpool.js displayName). A bad or bot tag gives the plain name.
export const taggedName = (name, tag) => (tag && tagOk(tag) ? `[${tag}] ${name}` : name);
