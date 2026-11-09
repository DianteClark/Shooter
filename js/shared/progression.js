// The rules of progression as pure functions and data: no DOM, no storage, runs in node.
// js/ui/progress.js holds the one save and applies these rules to it.
import { CAMOS, TRACERS, KILL_EFFECTS } from './camos.js';
import { PERKS, TACTICALS, LETHALS, STREAKS, normalizeLoadout, gatePerks } from './catalog.js';
import { PRIMARY_IDS, WEAPON_IDS } from './constants.js';
import { attachmentsFor } from './attachments.js';
import { WEAPONS } from './weapons.js';

export const SAVE_VERSION = 2;
export const MAX_LEVEL = 50;
export const MAX_PRESTIGE = 10;
export const MAX_WEAPON_LEVEL = 30;
export const MAX_WEAPON_PRESTIGE = 3;
export const LOADOUT_COUNT = 5;

/* ---------- XP curves ---------- */
// Each level costs base + step * (level - 1). Player: a typical match (about 2300 XP) is roughly three
// levels early and just under one at the top, so level 50 lands near 35 matches. Weapon: about 8 matches of
// use to 30, four passes through weapon prestige.
export const MATCH_XP = { played: 200, kill: 100, headshot: 25, assist: 50, win: 500, draw: 200, medal: 25 };
export const WEAPON_XP = { kill: 100, headshot: 25, longshot: 50, slide: 50, clean: 15 };

function makeCurve(base, step, max) {
  const floor = n => (n - 1) * base + step * (n - 1) * (n - 2) / 2;
  const cap = floor(max);
  const levelOf = xp => {
    let n = 1;
    while (n < max && floor(n + 1) <= xp) n++;
    return n;
  };
  const progress = xp => {
    const level = levelOf(xp);
    if (level >= max) return { level, into: 1, span: 1, maxed: true };
    const start = floor(level);
    return { level, into: xp - start, span: floor(level + 1) - start, maxed: false };
  };
  return { base, step, max, floor, cap, levelOf, progress };
}

export const PLAYER_CURVE = makeCurve(800, 36, MAX_LEVEL);
export const WEAPON_CURVE = makeCurve(250, 12, MAX_WEAPON_LEVEL);
export const levelOf = PLAYER_CURVE.levelOf;

/* ---------- Player level unlock schedule ---------- */
// Level 1 fills every slot, so loadouts are always complete; the last item lands at 15.
export const UNLOCK_SCHEDULE = [
  { level: 1,  kind: 'perk',     id: 'scavenger' },
  { level: 1,  kind: 'perk',     id: 'marathon' },
  { level: 1,  kind: 'tactical', id: 'smoke' },
  { level: 1,  kind: 'lethal',   id: 'frag' },
  { level: 1,  kind: 'streak',   id: 'uav' },
  { level: 1,  kind: 'streak',   id: 'turret' },
  { level: 1,  kind: 'streak',   id: 'strike' },
  { level: 3,  kind: 'tactical', id: 'flash' },
  { level: 5,  kind: 'perk',     id: 'fasthands' },
  { level: 7,  kind: 'lethal',   id: 'sticky' },
  { level: 9,  kind: 'perk',     id: 'ghost' },
  { level: 11, kind: 'tactical', id: 'stim' },
  { level: 13, kind: 'perk',     id: 'flak' },
  { level: 6,  kind: 'perk',     id: 'strongarm' },
  { level: 15, kind: 'streak',   id: 'gunship' },
  { level: 4,  kind: 'weapon',   id: 'burst' },
  { level: 6,  kind: 'weapon',   id: 'pdw' },
  { level: 8,  kind: 'weapon',   id: 'dmr' },
  { level: 10, kind: 'weapon',   id: 'autoshot' },
  { level: 12, kind: 'weapon',   id: 'revolver' },
  { level: 14, kind: 'weapon',   id: 'launcher' },
  // Wave 5 perks, equipment and streaks. Tracker is the level 1 pick for the third perk tier.
  { level: 1,  kind: 'perk',     id: 'tracker' },
  { level: 2,  kind: 'perk',     id: 'quickmend' },
  { level: 4,  kind: 'perk',     id: 'tacmask' },
  { level: 7,  kind: 'perk',     id: 'deadsilence' },
  { level: 8,  kind: 'perk',     id: 'coldblood' },
  { level: 10, kind: 'perk',     id: 'bandolier' },
  { level: 11, kind: 'perk',     id: 'engineer' },
  { level: 12, kind: 'perk',     id: 'hardline' },
  { level: 14, kind: 'perk',     id: 'adrenaline' },
  { level: 5,  kind: 'tactical', id: 'decoy' },
  { level: 8,  kind: 'tactical', id: 'sensor' },
  { level: 14, kind: 'tactical', id: 'trophy' },
  { level: 4,  kind: 'lethal',   id: 'molotov' },
  { level: 9,  kind: 'lethal',   id: 'mine' },
  { level: 12, kind: 'lethal',   id: 'cluster' },
  { level: 13, kind: 'lethal',   id: 'hatchet' },
  { level: 3,  kind: 'streak',   id: 'jammer' },
  { level: 5,  kind: 'streak',   id: 'resupply' },
  { level: 7,  kind: 'streak',   id: 'mortar' },
  { level: 10, kind: 'streak',   id: 'overwatch' },
  { level: 12, kind: 'streak',   id: 'chopper' },
  { level: 14, kind: 'streak',   id: 'emp' },
];
export const SCHEDULE_TOP = Math.max(...UNLOCK_SCHEDULE.map(u => u.level));

export const ITEM_TABLES = { perk: PERKS, tactical: TACTICALS, lethal: LETHALS, streak: STREAKS, weapon: WEAPONS };

// Anything added to the catalog without a schedule line is available from level 1, never accidentally hidden.
export function itemUnlockLevel(kind, id) {
  return UNLOCK_SCHEDULE.find(u => u.kind === kind && u.id === id)?.level ?? 1;
}

const STARTER_GEAR = { perks: ['marathon', 'scavenger', 'tracker'], tactical: 'smoke', lethal: 'frag', streaks: ['uav', 'turret', 'strike'] };

// Replaces anything not yet reached with what is, keeping slot counts full.
export function gateLoadoutGear(l, peakLevel) {
  const has = (kind, id) => itemUnlockLevel(kind, id) <= peakLevel;
  const fill = (kind, picked, starter, n) => {
    const out = [...new Set((picked || []).filter(id => ITEM_TABLES[kind][id] && has(kind, id)))].slice(0, n);
    for (const id of starter) if (out.length < n && !out.includes(id)) out.push(id);
    return out;
  };
  return {
    ...l,
    perks: gatePerks(l.perks, id => has('perk', id)),
    streaks: fill('streak', l.streaks, STARTER_GEAR.streaks, 3).sort((a, b) => STREAKS[a].cost - STREAKS[b].cost),
    tactical: TACTICALS[l.tactical] && has('tactical', l.tactical) ? l.tactical : STARTER_GEAR.tactical,
    lethal: LETHALS[l.lethal] && has('lethal', l.lethal) ? l.lethal : STARTER_GEAR.lethal,
  };
}

/* ---------- Challenges and camo gates ---------- */
// A longshot means a long shot for that gun: 26 m from a shotgun is not a thing that happens.
export const LONGSHOT_DIST = { ar: 26, smg: 18, shotgun: 11, lmg: 26, sniper: 34, pistol: 18, burst: 26, pdw: 16, autoshot: 10, dmr: 30, revolver: 18, launcher: 20 };
export const LONGSHOT_DEFAULT = 26;
export const longshotDist = weapon => LONGSHOT_DIST[weapon] ?? LONGSHOT_DEFAULT;

export const TRACKS = [
  { track: 'kills', label: 'Kills' },
  { track: 'head',  label: 'Headshots' },
  { track: 'long',  label: 'Longshots' },
  { track: 'slide', label: 'Slide kills' },
  { track: 'clean', label: 'Equipment-free kills' },
];
const TRACK_LABEL = Object.fromEntries(TRACKS.map(t => [t.track, t.label]));

const CHALLENGE_CAMOS = CAMOS.filter(c => c.chal).sort((a, b) => a.chal.goal - b.chal.goal);

// [{id,track,label,goal,value,done,camo}] for one weapon's save entry, grouped by track and ascending by goal.
export function challengesFor(w) {
  return TRACKS.flatMap(({ track, label }) => CHALLENGE_CAMOS.filter(c => c.chal.track === track).map(c => {
    const value = w[track] ?? 0;
    return { id: `${track}:${c.chal.goal}`, track, label, goal: c.chal.goal, value: Math.min(value, c.chal.goal), done: value >= c.chal.goal, camo: c.id };
  }));
}

export function isMastered(w) {
  return challengesFor(w).every(c => c.done);
}

// The rule for one camo on one weapon, ignoring grandfathered ownership.
export function camoGateOpen(camo, w) {
  if (camo.prestige) return (w.prestige ?? 0) >= camo.prestige;
  if (camo.mastery) return isMastered(w) && (w.kills ?? 0) >= (camo.masteryKills ?? 0);
  if (camo.chal) return (w[camo.chal.track] ?? 0) >= camo.chal.goal;
  return true;
}

export function camoRequirement(camo) {
  if (camo.prestige) return `Weapon Prestige ${camo.prestige} on this weapon`;
  if (camo.mastery) return camo.masteryKills ? `Mastery and ${camo.masteryKills} kills` : 'Complete every challenge on this weapon';
  if (camo.chal) return `${camo.chal.goal} ${TRACK_LABEL[camo.chal.track]}`;
  return '';
}

export function prestigeRewards(rank) {
  const tag = (kind, list) => list.filter(i => i.prestige === rank).map(item => ({ kind, id: item.id, name: item.name }));
  return [...tag('camo', CAMOS), ...tag('tracer', TRACERS), ...tag('killFx', KILL_EFFECTS)];
}

export const cosmeticRequirement = item => (item.prestige ? `Weapon Prestige ${item.prestige} on this weapon` : '');

/* ---------- Save shape ---------- */
const DEFAULT_NAMES = ['Assault', 'Rush', 'Breach', 'Suppress', 'Overwatch'];
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const COUNT_MAX = 1e9;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v, max = COUNT_MAX) => (Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const idText = v => (typeof v === 'string' && v.length <= 24 && !UNSAFE_KEYS.has(v) ? v : '');

export function blankWeapon() {
  return { xp: 0, peak: 1, prestige: 0, kills: 0, head: 0, long: 0, slide: 0, clean: 0, owned: [], camo: 'none', tracer: 'none', killFx: 'none' };
}

function cleanWeapon(raw) {
  const w = blankWeapon();
  if (!isObj(raw)) return w;
  w.xp = count(raw.xp, WEAPON_CURVE.cap);
  w.peak = Math.max(WEAPON_CURVE.levelOf(w.xp), Math.min(MAX_WEAPON_LEVEL, Math.max(1, count(raw.peak))));
  w.prestige = count(raw.prestige, MAX_WEAPON_PRESTIGE);
  for (const k of ['kills', 'head', 'long', 'slide', 'clean']) w[k] = count(raw[k]);
  w.owned = Array.isArray(raw.owned) ? [...new Set(raw.owned.filter(id => CAMOS.some(c => c.id === id)))] : [];
  w.camo = CAMOS.some(c => c.id === raw.camo) ? raw.camo : 'none';
  w.tracer = TRACERS.some(t => t.id === raw.tracer) ? raw.tracer : 'none';
  w.killFx = KILL_EFFECTS.some(k => k.id === raw.killFx) ? raw.killFx : 'none';
  return w;
}

// Fresh loadout slots only ever start on guns available from level 1.
const BASE_PRIMARIES = ['ar', 'smg', 'shotgun', 'lmg', 'sniper'];

export function cleanLoadout(raw, index) {
  const src = isObj(raw) ? raw : {};
  const primary = PRIMARY_IDS.includes(src.primary) ? src.primary : BASE_PRIMARIES[index % BASE_PRIMARIES.length];
  // Stored per weapon so a swap keeps each gun's kit; attachmentsFor reads the flat form too and drops bad ids.
  const attachments = {};
  for (const weapon of WEAPON_IDS) {
    const kit = attachmentsFor({ primary, attachments: src.attachments }, weapon);
    if (Object.keys(kit).length) attachments[weapon] = { ...kit };
  }
  const { perks, tactical, lethal, streaks, secondary } = normalizeLoadout({
    primary, secondary: WEAPON_IDS.includes(src.secondary) ? src.secondary : undefined,
    perks: Array.isArray(src.perks) ? src.perks : STARTER_GEAR.perks,
    tactical: src.tactical ?? STARTER_GEAR.tactical,
    lethal: src.lethal ?? STARTER_GEAR.lethal,
    streaks: Array.isArray(src.streaks) ? src.streaks : STARTER_GEAR.streaks,
  });
  return { name: text(src.name, 16) || DEFAULT_NAMES[index % DEFAULT_NAMES.length], primary, secondary, attachments, perks, tactical, lethal, streaks, operator: typeof src.operator === 'string' ? src.operator : null };
}

export function blankSave() {
  return {
    version: SAVE_VERSION, name: '', flags: {}, xp: 0, totalXp: 0, prestige: 0, peakLevel: 1,
    weapons: {}, loadouts: Array.from({ length: LOADOUT_COUNT }, (_, i) => cleanLoadout(null, i)), active: 0,
  };
}

// Turns anything at all into a valid save: bad fields become defaults, good fields survive.
export function sanitizeSave(raw) {
  const s = blankSave();
  if (!isObj(raw)) return s;
  s.name = text(raw.name, 12);
  if (isObj(raw.flags)) for (const k of Object.keys(raw.flags)) if (!UNSAFE_KEYS.has(k) && raw.flags[k] === true) s.flags[k] = true;
  s.prestige = count(raw.prestige, MAX_PRESTIGE);
  s.xp = count(raw.xp, PLAYER_CURVE.cap);
  s.totalXp = Math.max(count(raw.totalXp), s.xp);
  s.peakLevel = Math.max(levelOf(s.xp), Math.min(MAX_LEVEL, Math.max(1, count(raw.peakLevel))));
  // A prestige means level 50 was reached at some point, whatever the field says.
  if (s.prestige > 0) s.peakLevel = MAX_LEVEL;
  if (isObj(raw.weapons)) {
    for (const k of Object.keys(raw.weapons)) {
      if (idText(k)) s.weapons[k] = cleanWeapon(raw.weapons[k]);
    }
  }
  if (Array.isArray(raw.loadouts)) {
    for (let i = 0; i < LOADOUT_COUNT; i++) if (raw.loadouts[i] !== undefined) s.loadouts[i] = cleanLoadout(raw.loadouts[i], i);
  }
  s.active = Math.min(LOADOUT_COUNT - 1, count(raw.active));
  return s;
}

// v1: {name, primary, camoByWeapon, kills, xp, flags, equipment}. Keeps name, XP, kills and every camo the
// old kill thresholds had earned. Old XP counts on the new curve; kills seed weapon XP so veterans keep some reach.
export function migrateV1(v1) {
  const src = isObj(v1) ? v1 : {};
  const s = blankSave();
  s.name = text(src.name, 12);
  s.xp = count(src.xp, PLAYER_CURVE.cap);
  s.totalXp = count(src.xp);
  s.peakLevel = levelOf(s.xp);
  if (isObj(src.flags)) for (const k of Object.keys(src.flags)) if (!UNSAFE_KEYS.has(k) && src.flags[k]) s.flags[k] = true;

  const kills = isObj(src.kills) ? src.kills : {};
  const camos = isObj(src.camoByWeapon) ? src.camoByWeapon : {};
  const totalKills = Object.values(kills).reduce((sum, v) => sum + count(v), 0);
  for (const weapon of new Set([...Object.keys(kills), ...Object.keys(camos)])) {
    if (!idText(weapon)) continue;
    const w = blankWeapon();
    w.kills = count(kills[weapon]);
    w.xp = Math.min(WEAPON_CURVE.cap, w.kills * WEAPON_XP.kill);
    w.peak = WEAPON_CURVE.levelOf(w.xp);
    w.owned = CAMOS.filter(c => c.unlockKills > 0 && w.kills >= c.unlockKills).map(c => c.id);
    w.camo = CAMOS.some(c => c.id === camos[weapon]) && (camos[weapon] === 'none' || w.owned.includes(camos[weapon])) ? camos[weapon] : 'none';
    s.weapons[weapon] = w;
  }

  // Everything a v1 player could equip stays equippable.
  if (s.xp > 0 || totalKills > 0) s.peakLevel = Math.max(s.peakLevel, SCHEDULE_TOP);
  const primary = PRIMARY_IDS.includes(src.primary) ? src.primary : undefined;
  s.loadouts[0] = cleanLoadout({ ...(isObj(src.equipment) ? src.equipment : {}), primary, name: DEFAULT_NAMES[0] }, 0);
  return s;
}

/* ---------- Export code: "SY2.<base64url>.<checksum>" ---------- */
const CODE_MAX = 32768;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

const GUN_STATS = ['xp', 'peak', 'prestige', 'kills', 'head', 'long', 'slide', 'clean'];

// Arrays by position instead of keyed objects roughly halves the code a player has to paste.
function pack(s) {
  return [
    s.version, s.name, s.xp, s.totalXp, s.prestige, s.peakLevel, s.active,
    Object.entries(s.weapons).map(([id, w]) => [id, ...GUN_STATS.map(k => w[k]), w.owned, w.camo, w.tracer, w.killFx]),
    s.loadouts.map(l => [l.name, l.primary, l.secondary, l.attachments, l.perks, l.tactical, l.lethal, l.streaks, l.operator]),
  ];
}

function unpack(a) {
  if (!Array.isArray(a) || a.length < 9 || !Array.isArray(a[7]) || !Array.isArray(a[8])) return null;
  const [version, name, xp, totalXp, prestige, peakLevel, active, guns, loadouts] = a;
  const weapons = {};
  for (const g of guns) {
    if (!Array.isArray(g) || !idText(g[0])) continue;
    const w = {};
    GUN_STATS.forEach((k, i) => { w[k] = g[i + 1]; });
    [w.owned, w.camo, w.tracer, w.killFx] = g.slice(GUN_STATS.length + 1);
    weapons[g[0]] = w;
  }
  return {
    version, name, xp, totalXp, prestige, peakLevel, active, weapons,
    loadouts: loadouts.map(l => (Array.isArray(l) ? { name: l[0], primary: l[1], secondary: l[2], attachments: l[3], perks: l[4], tactical: l[5], lethal: l[6], streaks: l[7], operator: l[8] } : null)),
  };
}

export function encodeSave(s) {
  const body = toBase64Url(JSON.stringify(pack(s)));
  return `SY${SAVE_VERSION}.${body}.${fnv1a(body)}`;
}

// Returns {ok:true, save} or {ok:false, error}. A checksum catches typos and truncated pastes; it is not security.
export function decodeSave(code) {
  if (typeof code !== 'string' || code.length > CODE_MAX) return { ok: false, error: 'format' };
  const m = /^SY(\d+)\.([A-Za-z0-9_-]+)\.([0-9a-z]+)$/.exec(code.trim());
  if (!m) return { ok: false, error: 'format' };
  if (Number(m[1]) !== SAVE_VERSION) return { ok: false, error: 'version' };
  if (fnv1a(m[2]) !== m[3]) return { ok: false, error: 'checksum' };
  let parsed;
  try {
    parsed = unpack(JSON.parse(fromBase64Url(m[2])));
  } catch {
    return { ok: false, error: 'data' };
  }
  if (!parsed || parsed.version !== SAVE_VERSION) return { ok: false, error: 'data' };
  return { ok: true, save: sanitizeSave(parsed) };
}

/* ---------- Prestige badges ---------- */
// Procedural flat-polygon emblems in a railway idiom. No gradients or filters, so no ids or defs: the same
// badge can appear many times in a page, and it stays legible at kill-feed size.
const PRESTIGE_NAMES = ['Recruit', 'Brakeman', 'Coupler', 'Signalman', 'Switchman', 'Dispatcher', 'Conductor', 'Engineer', 'Yardmaster', 'Roadmaster', 'Sovereign of the Yard'];

export const prestigeName = rank => PRESTIGE_NAMES[Math.min(MAX_PRESTIGE, Math.max(0, count(rank)))];

const f1 = v => Math.round(v * 10) / 10;
const pts = list => list.map(p => `${f1(p[0])},${f1(p[1])}`).join(' ');
const poly = (list, fill) => `<polygon points="${pts(list)}" fill="${fill}"/>`;
const polar = (r, a, cx = 50, cy = 50) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
const UP = -Math.PI / 2;

const ngon = (r, n, rot = UP, cx, cy) => Array.from({ length: n }, (_, i) => polar(r, rot + (i / n) * Math.PI * 2, cx, cy));
const star = (R, r, n, rot = UP, cx, cy) => Array.from({ length: n * 2 }, (_, i) => polar(i % 2 ? r : R, rot + (i / n) * Math.PI, cx, cy));

// Low-poly plate: each wedge shaded by which way it faces the dusk light.
function facets(outline, light, dark, cx = 50, cy = 50) {
  return outline.map((p, i) => {
    const q = outline[(i + 1) % outline.length];
    const face = ((p[0] + q[0]) / 2 - cx) * -0.5 + ((p[1] + q[1]) / 2 - cy) * -0.86;
    return poly([[cx, cy], p, q], face > 0 ? light : dark);
  }).join('');
}

function chevron(cy, w, h, t, fill) {
  const x0 = 50 - w / 2, x1 = 50 + w / 2;
  return poly([[x0, cy + h], [50, cy], [x1, cy + h], [x1, cy + h + t], [50, cy + t], [x0, cy + h + t]], fill);
}

const dots = (r, n, size, fill, rot = UP) => ngon(r, n, rot).map(p => poly(ngon(size, 6, 0, p[0], p[1]), fill)).join('');

function ring(r0, r1, n, fill, rot = UP) {
  const out = ngon(r1, n, rot), inn = ngon(r0, n, rot);
  return out.map((p, i) => poly([p, out[(i + 1) % n], inn[(i + 1) % n], inn[i]], fill)).join('');
}

function rays(r0, r1, n, width, fill, rot = UP) {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return poly([polar(r0, a - width), polar(r1, a), polar(r0, a + width)], fill);
  }).join('');
}

// One feathered wing; side is -1 left, 1 right.
function wing(side, feathers, fill, tip, spread = 1) {
  let s = '';
  for (let i = 0; i < feathers; i++) {
    const k = i / feathers, y = 37 + k * 26 * spread, len = (40 - k * 22);
    const x0 = 50 + side * 15, x1 = x0 + side * len;
    s += poly([[x0, y], [x1, y - 7 + k * 5], [x1 - side * 4, y + 2.2 + k * 3], [x0, y + 6]], i === 0 ? tip : fill);
  }
  return s;
}

function laurel(side, leaves, fill, shade) {
  let s = '';
  for (let i = 0; i < leaves; i++) {
    const a = Math.PI / 2 + side * (0.42 + i * (1.6 / leaves));
    const p = polar(39, a), dir = a + side * 1.15;
    const tip = [p[0] + Math.cos(dir) * 12, p[1] + Math.sin(dir) * 12];
    const n = [Math.cos(dir + Math.PI / 2) * 3.4, Math.sin(dir + Math.PI / 2) * 3.4];
    const mid = [(p[0] + tip[0]) / 2, (p[1] + tip[1]) / 2];
    s += poly([p, [mid[0] + n[0], mid[1] + n[1]], tip, [mid[0] - n[0], mid[1] - n[1]]], i % 2 ? shade : fill);
  }
  return s;
}

const gem = (r, a, b, c, cy = 50) => facets(ngon(r, 8, UP + Math.PI / 8, 50, cy), a, b, 50, cy) + poly(ngon(r * 0.42, 8, UP + Math.PI / 8, 50, cy), c);

function crown(cy, w, fill, tip) {
  const x0 = 50 - w / 2, x1 = 50 + w / 2, h = w * 0.42;
  return poly([[x0, cy + h], [x0 - 1.5, cy], [x0 + w * 0.26, cy + h * 0.5], [50, cy - h * 0.55], [x1 - w * 0.26, cy + h * 0.5], [x1 + 1.5, cy], [x1, cy + h]], fill)
    + poly(ngon(2.2, 4, UP, x0 - 1.5, cy - 1.5), tip) + poly(ngon(2.6, 4, UP, 50, cy - h * 0.55 - 2), tip) + poly(ngon(2.2, 4, UP, x1 + 1.5, cy - 1.5), tip);
}

function gear(r, teeth, depth, fill) {
  const list = [];
  for (let i = 0; i < teeth; i++) {
    const a = UP + (i / teeth) * Math.PI * 2, w = Math.PI / teeth;
    list.push(polar(r, a - w * 0.95), polar(r + depth, a - w * 0.5), polar(r + depth, a + w * 0.5), polar(r, a + w * 0.95));
  }
  return poly(list, fill);
}

const BADGES = [
  // 0 Recruit: a plain riveted plate, deliberately modest.
  () => facets(ngon(38, 6), '#5a6370', '#3d444e') + chevron(42, 34, 12, 8, '#c8ccd2'),
  // 1 Brakeman: iron hex and one heavy chevron.
  () => ring(38, 46, 6, '#8d6a3f') + facets(ngon(38, 6), '#4c5560', '#333a44') + chevron(40, 42, 16, 11, '#e0a23a'),
  // 2 Coupler: octagon, two interlocked chevrons, corner bolts.
  () => ring(38, 46, 8, '#b08a50') + facets(ngon(38, 8), '#4d5a64', '#2f3842')
    + chevron(32, 44, 15, 8, '#e8c26a') + chevron(50, 44, 15, 8, '#f3dfa4') + dots(42, 4, 2.6, '#f3dfa4', UP + Math.PI / 4),
  // 3 Signalman: a three-aspect signal head inside a teal rim.
  () => ring(38, 46, 12, '#1a7f7a') + facets(ngon(38, 12), '#23323c', '#16222b')
    + poly([[40, 20], [60, 20], [64, 26], [64, 74], [60, 80], [40, 80], [36, 74], [36, 26]], '#0d151c')
    + poly(ngon(7, 10, 0, 50, 32), '#ff4d3d') + poly(ngon(7, 10, 0, 50, 50), '#ffc23d') + poly(ngon(7, 10, 0, 50, 68), '#3dffa0')
    + dots(42.5, 12, 1.5, '#7fe6dc'),
  // 4 Switchman: crossed rails over a diamond with sleeper ticks.
  () => ring(38, 46, 16, '#2f6f9e') + facets(ngon(38, 4), '#2c4d6b', '#1b324a') + rays(38, 44, 16, 0.08, '#a8dcff')
    + poly([[24, 20], [31, 20], [76, 75], [76, 80], [69, 80], [24, 25]], '#d8eeff')
    + poly([[76, 20], [69, 20], [24, 75], [24, 80], [31, 80], [76, 25]], '#d8eeff')
    + poly(ngon(9, 4), '#ffb347') + poly(ngon(4.5, 4), '#fff3d6') + dots(33, 8, 1.7, '#a8dcff', UP + Math.PI / 8),
  // 5 Dispatcher: bright star on a double ring, clock ticks.
  () => ring(41, 47, 12, '#7a2d8c') + ring(34, 37, 12, '#d39bff') + facets(ngon(34, 10), '#3b2358', '#27173d')
    + rays(37, 41, 12, 0.09, '#f0d6ff') + facets(star(30, 12.5, 5), '#ffe08a', '#e8a93b') + poly(ngon(5, 5), '#fff6cf'),
  // 6 Conductor: first wings: a winged gem.
  () => wing(-1, 7, '#c7ccd6', '#fff') + wing(1, 7, '#c7ccd6', '#fff') + ring(21, 26, 12, '#d4a040')
    + facets(ngon(21, 12), '#2a3a55', '#1a2740') + gem(13, '#7ee0ff', '#2d8fd0', '#e8fbff') + chevron(70, 24, 8, 5, '#d4a040')
    + dots(23.5, 12, 1.2, '#fff3d6'),
  // 7 Engineer: a driving wheel: gear, spokes, faceted star.
  () => gear(38, 14, 7, '#c4562e') + ring(30, 38, 14, '#7a2f1a') + rays(0, 30, 14, 0.14, '#3a2118')
    + ring(30, 33, 14, '#ffb37a') + facets(star(25, 11, 7), '#ffd98a', '#f08a33') + gem(8, '#fff0b8', '#ffb347', '#ffffff') + dots(34, 7, 1.8, '#ffd98a'),
  // 8 Yardmaster: laurels, crowned shield.
  () => rays(46, 50, 28, 0.05, '#9fe8b8') + laurel(-1, 16, '#6fd08a', '#3a9a62') + laurel(1, 16, '#6fd08a', '#3a9a62')
    + poly([[50, 18], [74, 26], [72, 56], [50, 82], [28, 56], [26, 26]], '#123a2c')
    + facets([[50, 23], [69, 30], [67, 54], [50, 76], [33, 54], [31, 30]], '#2a8562', '#1f6a4e')
    + chevron(36, 30, 11, 6, '#ffe59a') + chevron(48, 30, 11, 6, '#ffe59a') + chevron(60, 30, 7, 5, '#ffe59a')
    + crown(12, 26, '#ffd659', '#ff5a7a'),
  // 9 Roadmaster: sunburst, great wings, jewelled gear, crown.
  () => rays(30, 48, 24, 0.09, '#ff8c3d') + rays(26, 42, 24, 0.06, '#ffd27a', UP + Math.PI / 24)
    + wing(-1, 7, '#ffe6b0', '#ffffff') + wing(1, 7, '#ffe6b0', '#ffffff')
    + gear(22, 12, 5, '#8c2f6e') + ring(17, 22, 12, '#ffb0d8') + facets(ngon(17, 12), '#401b4a', '#2c1136')
    + gem(12, '#ff7ad1', '#b0248c', '#fff0fa') + crown(16, 22, '#ffd659', '#7ae8ff') + chevron(74, 20, 6, 4, '#ffd659') + chevron(81, 16, 5, 3, '#ffd659'),
  // 10 Sovereign: everything at once, in gold and white-hot violet.
  () => rays(34, 50, 32, 0.075, '#ffcf40') + rays(30, 46, 32, 0.05, '#fff4bf', UP + Math.PI / 32)
    + laurel(-1, 9, '#ffe07a', '#c79322') + laurel(1, 9, '#ffe07a', '#c79322')
    + wing(-1, 8, '#b08cff', '#ffffff') + wing(1, 8, '#b08cff', '#ffffff')
    + gear(25, 16, 5, '#ffcf40') + ring(20, 25, 16, '#7a4dff') + facets(ngon(20, 16), '#26105c', '#170838')
    + rays(19, 24, 16, 0.05, '#ffffff') + facets(star(17, 7.5, 8), '#fff4bf', '#ffb020') + gem(8, '#7af0ff', '#7a4dff', '#ffffff')
    + crown(14, 24, '#ffe07a', '#ff4d7a') + dots(44, 8, 1.8, '#ffffff', UP + Math.PI / 8) + chevron(76, 22, 6, 4, '#ffe07a') + chevron(83, 18, 5, 3, '#fff4bf'),
];

// SVG markup for a prestige rank 0..10 (0 is the pre-prestige plate). Pure strings, safe to inline anywhere.
export function badgeSvg(prestige = 0, size = 48) {
  const rank = Math.min(MAX_PRESTIGE, Math.max(0, count(prestige)));
  const px = Math.max(8, count(size, 512));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${px}" height="${px}" role="img" aria-label="${prestigeName(rank)}">${BADGES[rank]()}</svg>`;
}
