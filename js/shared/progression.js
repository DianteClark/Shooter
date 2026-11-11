// The rules of progression as pure functions and data: no DOM, no storage, runs in node.
// js/ui/progress.js holds the one save and applies these rules to it.
import { CAMOS, TRACERS, KILL_EFFECTS } from './camos.js';
import { PERKS, PERK_IDS, PRO, TACTICALS, LETHALS, STREAKS, normalizeLoadout, gatePerks } from './catalog.js';
import { MAX_HP, PRIMARY_IDS, WEAPON_IDS, WEAPON_CATEGORY, FFA_TEAM, GOLDEN_ID } from './constants.js';
import { MODES, modeRules } from './modes.js';
import { attachmentsFor } from './attachments.js';
import { WEAPONS } from './weapons.js';
import { V10_UNLOCKS } from './weapons-v10.js';
import { EX_UNLOCKS } from './extraction.js';

// 4: mastery tracks, the weapon ladder, unlock challenges and operator skins (docs/PROGRESSION.md). 3: Pro perk
// progress and the calling card (V7). Every older save, and every SY2/SY3 code, migrates without losing anything.
export const SAVE_VERSION = 4;
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
// Level 1 fills every slot, so loadouts are always complete. Gear tops out at 15; the Wave 5 guns run on to 22.
// The six base guns (ar, smg, shotgun, lmg, sniper, pistol) have no line: level 1.
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
  // V8 equipment.
  { level: 5,  kind: 'lethal',   id: 'impact' },
  { level: 6,  kind: 'tactical', id: 'stun' },
  { level: 10, kind: 'lethal',   id: 'claymore' },
  { level: 11, kind: 'tactical', id: 'gas' },
  { level: 15, kind: 'lethal',   id: 'drill' },
  { level: 16, kind: 'tactical', id: 'shock' },
  // Gear wave (2026-11): one new piece most levels from 3 to 17, so every few levels opens something to try.
  { level: 3,  kind: 'lethal',   id: 'shiv' },
  { level: 4,  kind: 'tactical', id: 'medpack' },
  { level: 6,  kind: 'lethal',   id: 'thermite' },
  { level: 7,  kind: 'tactical', id: 'snapshot' },
  { level: 8,  kind: 'lethal',   id: 'crawler' },
  { level: 9,  kind: 'tactical', id: 'bulwark' },
  { level: 10, kind: 'lethal',   id: 'charge' },
  { level: 12, kind: 'tactical', id: 'tagger' },
  { level: 13, kind: 'lethal',   id: 'tripwire' },
  { level: 17, kind: 'tactical', id: 'blackout' },
  { level: 3,  kind: 'streak',   id: 'jammer' },
  { level: 5,  kind: 'streak',   id: 'resupply' },
  { level: 7,  kind: 'streak',   id: 'mortar' },
  { level: 10, kind: 'streak',   id: 'overwatch' },
  { level: 12, kind: 'streak',   id: 'chopper' },
  { level: 14, kind: 'streak',   id: 'emp' },
  { level: 6,  kind: 'streak',   id: 'missile' },
  { level: 11, kind: 'streak',   id: 'swarm' },
  { level: 16, kind: 'streak',   id: 'juggernaut' },
  // V9 streaks (2026-11), spread up the curve: a cheap intel pick early, the heavy machines late.
  { level: 2,  kind: 'streak',   id: 'sweep' },
  { level: 4,  kind: 'streak',   id: 'airdrop' },
  { level: 8,  kind: 'streak',   id: 'recon' },
  { level: 9,  kind: 'streak',   id: 'plates' },
  { level: 13, kind: 'streak',   id: 'hound' },
  { level: 18, kind: 'streak',   id: 'dome' },
  { level: 20, kind: 'streak',   id: 'bombrun' },
  { level: 24, kind: 'streak',   id: 'rover' },
  // Wave 5 guns, between the Wave 3 ones: one roughly every level from 2 to 22, the specialist ones last.
  { level: 2,  kind: 'weapon',   id: 'tacsmg' },
  { level: 3,  kind: 'weapon',   id: 'deuce' },
  { level: 5,  kind: 'weapon',   id: 'heavyar' },
  { level: 7,  kind: 'weapon',   id: 'coach' },
  { level: 9,  kind: 'weapon',   id: 'lever' },
  { level: 11, kind: 'weapon',   id: 'saw' },
  { level: 13, kind: 'weapon',   id: 'machpistol' },
  { level: 15, kind: 'weapon',   id: 'battle' },
  { level: 17, kind: 'weapon',   id: 'semisnipe' },
  { level: 19, kind: 'weapon',   id: 'thumper' },
  { level: 20, kind: 'weapon',   id: 'rotary' },
  { level: 22, kind: 'weapon',   id: 'antimat' },
  // V8 guns, on the even levels the Wave 5 ones left free.
  { level: 4,  kind: 'weapon',   id: 'scatter' },
  { level: 6,  kind: 'weapon',   id: 'carbine' },
  { level: 8,  kind: 'weapon',   id: 'slug' },
  { level: 10, kind: 'weapon',   id: 'heavysmg' },
  { level: 16, kind: 'weapon',   id: 'lightlmg' },
  { level: 18, kind: 'weapon',   id: 'crossbow' },
  ...V10_UNLOCKS,   // V10 guns, levels 3 to 40 (js/shared/weapons-v10.js).
];
export const SCHEDULE_TOP = Math.max(...UNLOCK_SCHEDULE.map(u => u.level));
const V1_GRANT_LEVEL = 15;

export const ITEM_TABLES = { perk: PERKS, tactical: TACTICALS, lethal: LETHALS, streak: STREAKS, weapon: WEAPONS };

// Anything added to the catalog without a schedule line is available from level 1, never accidentally hidden.
export function itemUnlockLevel(kind, id) {
  return UNLOCK_SCHEDULE.find(u => u.kind === kind && u.id === id)?.level ?? 1;
}

const STARTER_GEAR = { perks: ['marathon', 'scavenger', 'tracker'], tactical: 'smoke', lethal: 'frag', streaks: ['uav', 'turret', 'strike'] };

// Replaces anything not yet reached with what is, keeping slot counts full. `open` is the player's peak level, or a
// function (kind, id) -> bool when unlocks also depend on challenges (itemOpen below).
export function gateLoadoutGear(l, open) {
  const has = typeof open === 'function' ? open : (kind, id) => itemUnlockLevel(kind, id) <= open;
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
// The distance is weapon data (`longshot` in weapons.js), so a new gun brings its own.
export const LONGSHOT_DEFAULT = 26;
export const longshotDist = weapon => WEAPONS[weapon]?.longshot ?? LONGSHOT_DEFAULT;
export const LONGSHOT_DIST = Object.fromEntries(WEAPON_IDS.map(id => [id, longshotDist(id)]));

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
  // Mastery camos sit at the end of the weapon ladder (v4); ones earned before it existed are in `owned`.
  if (camo.mastery) return isMastered(w) && ladderDone(w) && (w.kills ?? 0) >= (camo.masteryKills ?? 0);
  if (camo.chal) return (w[camo.chal.track] ?? 0) >= camo.chal.goal;
  return true;
}

export function camoRequirement(camo) {
  if (camo.prestige) return `Weapon Prestige ${camo.prestige} on this weapon`;
  if (camo.mastery) return camo.masteryKills ? `Mastery and ${camo.masteryKills} kills` : 'Every challenge and the mastery ladder on this weapon';
  if (camo.chal) return `${camo.chal.goal} ${TRACK_LABEL[camo.chal.track]}`;
  return '';
}

export function prestigeRewards(rank) {
  const tag = (kind, list) => list.filter(i => i.prestige === rank).map(item => ({ kind, id: item.id, name: item.name }));
  return [...tag('camo', CAMOS), ...tag('tracer', TRACERS), ...tag('killFx', KILL_EFFECTS)];
}

export const cosmeticRequirement = item => (item.prestige ? `Weapon Prestige ${item.prestige} on this weapon` : '');

/* ---------- The Golden Gun ---------- */
// Earned by maxing everything there is: every perk Pro, every other weapon at Weapon Prestige MAX_WEAPON_PRESTIGE and
// back up to MAX_WEAPON_LEVEL, and the player at Prestige MAX_PRESTIGE and MAX_LEVEL. New guns join the requirement;
// a player who already earned it keeps it (js/ui/progress.js goldenEarned).
export const GOLDEN_REQ_WEAPONS = WEAPON_IDS.filter(id => id !== GOLDEN_ID);
export const GOLDEN_REQUIREMENT = 'Max everything: every perk Pro, every weapon at max prestige and level, Prestige X at level 50';

// {earned, steps:[{id, label, value, goal, done}]} for a save (sanitized shape).
export function goldenStatus(save) {
  const maxedGun = id => {
    const w = save.weapons?.[id];
    return !!w && (w.prestige ?? 0) >= MAX_WEAPON_PRESTIGE && WEAPON_CURVE.levelOf(w.xp ?? 0) >= MAX_WEAPON_LEVEL;
  };
  const level = levelOf(save.xp ?? 0);
  const steps = [
    { id: 'pro', label: 'Perks at Pro', value: PERK_IDS.filter(id => save.proDone?.includes(id)).length, goal: PERK_IDS.length },
    { id: 'weapons', label: `Weapons at Prestige ${MAX_WEAPON_PRESTIGE}, level ${MAX_WEAPON_LEVEL}`, value: GOLDEN_REQ_WEAPONS.filter(maxedGun).length, goal: GOLDEN_REQ_WEAPONS.length },
    { id: 'prestige', label: `Prestige ${MAX_PRESTIGE}`, value: Math.min(save.prestige ?? 0, MAX_PRESTIGE), goal: MAX_PRESTIGE },
    { id: 'level', label: `Level ${MAX_LEVEL} at Prestige ${MAX_PRESTIGE}`, value: (save.prestige ?? 0) >= MAX_PRESTIGE ? level : 0, goal: MAX_LEVEL },
  ].map(st => ({ ...st, done: st.value >= st.goal }));
  return { earned: steps.every(st => st.done), steps };
}

/* ---------- Prestige names ---------- */
// Above the cards, which are named from them when the module loads.
const PRESTIGE_NAMES = ['Yard Hand', 'Brakeman', 'Coupler', 'Signalman', 'Switchman', 'Dispatcher', 'Conductor', 'Engine Driver', 'Yardmaster', 'Roadmaster', 'Sovereign of the Yard'];

export const prestigeName = rank => PRESTIGE_NAMES[Math.min(MAX_PRESTIGE, Math.max(0, Math.floor(Number(rank)) || 0))];

// Card colours per prestige rank, after each rank's badge: ground, mid, light, accent.
const PRESTIGE_ART = [
  ['#2a2016', '#6b5030', '#f3dfa4', '#e0a23a'], ['#1e2830', '#4d5a64', '#f3dfa4', '#e8c26a'],
  ['#0f2224', '#1a7f7a', '#bff6ee', '#3dffa0'], ['#14243a', '#2f6f9e', '#d8eeff', '#ffb347'],
  ['#1e1030', '#7a2d8c', '#f0d6ff', '#ffe08a'], ['#141e34', '#2a3a55', '#e8fbff', '#d4a040'],
  ['#2a120c', '#c4562e', '#ffd98a', '#ffb37a'], ['#0e2a1e', '#2a8562', '#ffe59a', '#ff5a7a'],
  ['#28102c', '#8c2f6e', '#ffd27a', '#7ae8ff'], ['#170838', '#7a4dff', '#fff4bf', '#ffcf40'],
];

/* ---------- Pro perks (V7) ---------- */
// Each perk turns Pro (js/shared/catalog.js PRO) when every step of its challenge is done. Steps count only while the
// perk is equipped, in any match, bots included. Goals were set from bot matches (each mixed-skill bot's per-match rate
// of the stat, times about six) so focused use finishes a perk in roughly five to eight matches; a strong player is
// faster. `stat` names come from ProTracker below.
export const PRO_CHALLENGES = {
  marathon:    [{ stat: 'sprintM', goal: 3000, label: 'Sprint 3,000 m' }, { stat: 'slides', goal: 50, label: 'Slide 50 times' }],
  flak:        [{ stat: 'blastHits', goal: 10, label: 'Survive 10 explosive hits' }, { stat: 'kills', goal: 60, label: 'Get 60 kills' }],
  quickmend:   [{ stat: 'regenHp', goal: 900, label: 'Regenerate 900 health' }, { stat: 'lowKills', goal: 8, label: 'Get 8 kills under half health' }],
  tacmask:     [{ stat: 'shrugged', goal: 10, label: 'Shrug off 10 flashes or fires' }, { stat: 'kills', goal: 60, label: 'Get 60 kills' }],
  adrenaline:  [{ stat: 'woundedKills', goal: 22, label: 'Get 22 gun kills while hurt' }, { stat: 'multi', goal: 15, label: 'Get 15 multi-kills' }],
  scavenger:   [{ stat: 'kills', goal: 70, label: 'Scavenge from 70 kills' }, { stat: 'streak3', goal: 6, label: 'Get 6 three-kill streaks' }],
  fasthands:   [{ stat: 'reloads', goal: 25, label: 'Reload 25 times' }, { stat: 'swapKills', goal: 8, label: 'Get 8 kills just after a swap' }],
  strongarm:   [{ stat: 'farThrows', goal: 15, label: 'Throw past 13 m 15 times' }, { stat: 'equipKills', goal: 5, label: 'Get 5 lethal equipment kills' }],
  bandolier:   [{ stat: 'throws', goal: 45, label: 'Throw 45 pieces of equipment' }, { stat: 'bothKit', goal: 9, label: 'Use tactical and lethal in one life 9 times' }],
  hardline:    [{ stat: 'streaksCalled', goal: 5, label: 'Call in 5 scorestreaks' }, { stat: 'assists', goal: 18, label: 'Get 18 assists' }],
  ghost:       [{ stat: 'uavSec', goal: 180, label: 'Stay alive 3 min under enemy UAV' }, { stat: 'kills', goal: 60, label: 'Get 60 kills' }],
  coldblood:   [{ stat: 'enemyStreaks', goal: 8, label: 'Be alive for 8 enemy scorestreaks' }, { stat: 'kills', goal: 60, label: 'Get 60 kills' }],
  deadsilence: [{ stat: 'flankKills', goal: 7, label: 'Get 7 kills from the side or behind' }, { stat: 'closeKills', goal: 15, label: 'Get 15 kills within 8 m' }],
  tracker:     [{ stat: 'hits', goal: 160, label: 'Land 160 hits' }, { stat: 'assists', goal: 18, label: 'Get 18 assists' }],
  engineer:    [{ stat: 'deploys', goal: 8, label: 'Make 8 Trophy saves or Sentry and aircraft calls' }, { stat: 'kills', goal: 50, label: 'Get 50 kills' }],
};
export const PRO_STATS = [...new Set(Object.values(PRO_CHALLENGES).flatMap(list => list.map(c => c.stat)))];

// {perk, name, desc, steps:[{stat,label,goal,value,done}], done} from one save's counters and the list of finished perks.
export function proStatus(perk, progress = {}, done = []) {
  const counts = progress[perk] ?? {};
  const finished = done.includes(perk);
  const steps = (PRO_CHALLENGES[perk] ?? []).map(c => {
    const value = finished ? c.goal : Math.min(c.goal, counts[c.stat] ?? 0);
    return { stat: c.stat, label: c.label, goal: c.goal, value, done: value >= c.goal };
  });
  return { perk, name: PRO[perk]?.name ?? perk, desc: PRO[perk]?.desc ?? '', steps, done: finished || steps.every(c => c.done) };
}

// Veteran / Recruit: the tag in lobby, intro and scoreboard. Tunable here and nowhere else.
export const VETERAN = { prestige: 1, level: 30, pro: 5 };
export function isVeteran({ prestige = 0, level = 1, pro = 0 } = {}) {
  const n = Array.isArray(pro) ? pro.length : pro;
  return prestige >= VETERAN.prestige || level >= VETERAN.level || n >= VETERAN.pro;
}

const BLAST_EQUIP = new Set(['frag', 'sticky', 'mine', 'cluster']);
const BLAST_STREAK = new Set(['strike', 'mortar', 'gunship', 'missile', 'swarm', 'bombrun']);
const MULTI_MEDALS = new Set(['double', 'triple', 'fury']);
const DEPLOY_STREAKS = new Set(['turret', 'chopper', 'gunship', 'missile', 'swarm', 'recon', 'hound', 'rover', 'dome']);
const FAR_THROW = 13;            // Past the base throw range (js/sim/equipment.js THROW_RANGE): a Strong Arm throw.
const SWAP_WINDOW = 2.5;
const BURN_GAP = 1.5;            // Burn ticks closer together than this are one fire.
const CLOSE_KILL = 8;
const FLANK = 1.3;               // Radians between a victim's aim and the way to the killer: a kill from the side or behind.

// Counts what one player did in one match, for the Pro challenges. Pure: no DOM, no storage, runs in node.
// Feed onEvents(events, view) every frame with that player's view (its `t` is the clock). gains() returns
// {perk: {stat: n}} for the perks that were equipped when each thing happened; setPerks() whenever the loadout in use
// changes (MatchAwards does it at each spawn). `raw` holds every stat regardless of perks.
export class ProTracker {
  constructor(localId, perks = []) {
    this.id = localId;
    this.raw = Object.fromEntries(PRO_STATS.map(k => [k, 0]));
    this.byPerk = {};
    this.setPerks(perks);
    this.prevT = null; this.prevHp = MAX_HP; this.prevX = null; this.prevZ = 0; this.wasAlive = false;
    this.swapT = -99; this.burnT = -99;
    this.life = { tactical: false, lethal: false, both: false };
  }

  setPerks(perks) { this.perks = (perks ?? []).filter(id => PRO_CHALLENGES[id]); }

  add(stat, n = 1) {
    if (!(n > 0) || !(stat in this.raw)) return;
    this.raw[stat] += n;
    for (const perk of this.perks) {
      if (!PRO_CHALLENGES[perk].some(c => c.stat === stat)) continue;
      const g = this.byPerk[perk] ??= {};
      g[stat] = (g[stat] ?? 0) + n;
    }
  }

  gains() { return this.byPerk; }

  onEvents(events, view) {
    const id = this.id, me = view?.players?.find(p => p.id === id);
    const t = view?.t ?? 0, dt = this.prevT === null ? 0 : Math.min(0.25, Math.max(0, t - this.prevT));
    let healed = false, spawned = false;
    for (const e of events) {
      switch (e.t) {
        case 'kill':
          if (e.assist === id) this.add('assists');
          if (e.by !== id || e.target === id) break;
          this.add('kills');
          if (e.streak) break;
          if (e.equip) { if (LETHALS[e.equip]) this.add('equipKills'); break; }
          if (this.prevHp < MAX_HP) this.add('woundedKills');
          if (this.prevHp <= MAX_HP / 2) this.add('lowKills');
          if ((e.dist ?? 99) <= CLOSE_KILL) this.add('closeKills');
          if (t - this.swapT <= SWAP_WINDOW) this.add('swapKills');
          if (me) {
            const v = view.players.find(p => p.id === e.target);
            if (v) {
              const toKiller = Math.atan2(me.z - v.z, me.x - v.x);
              let d = Math.abs(toKiller - v.aim) % (Math.PI * 2);
              if (d > Math.PI) d = Math.PI * 2 - d;
              if (d >= FLANK) this.add('flankKills');
            }
          }
          break;
        case 'hit':
          if (e.by === id && e.target !== id && e.w) this.add('hits');
          if (e.target === id && !e.killed) {
            if (BLAST_EQUIP.has(e.eq) || BLAST_STREAK.has(e.st)) this.add('blastHits');
            if (e.eq === 'molotov') { if (t - this.burnT > BURN_GAP) this.add('shrugged'); this.burnT = t; }
          }
          break;
        case 'flashed': if (e.id === id) this.add('shrugged'); break;
        case 'zap': if (e.by === id) this.add('deploys'); break;
        case 'medal':
          if (e.id !== id) break;
          if (MULTI_MEDALS.has(e.medal)) this.add('multi');
          if (e.medal === 'streak3') this.add('streak3');
          break;
        case 'slide': if (e.id === id) this.add('slides'); break;
        case 'reload': if (e.id === id && e.stage === 'start') this.add('reloads'); break;
        case 'swap': if (e.id === id) this.swapT = t; break;
        case 'heal': if (e.id === id) healed = true; break;
        case 'spawn':
          if (e.id === id) { spawned = true; this.life.tactical = this.life.lethal = this.life.both = false; }
          break;
        case 'throw': {
          if (e.id !== id) break;
          this.add('throws');
          if ((e.dist ?? 0) > FAR_THROW) this.add('farThrows');
          const L = this.life;
          if (TACTICALS[e.kind]) L.tactical = true; else if (LETHALS[e.kind]) L.lethal = true;
          if (L.tactical && L.lethal && !L.both) { L.both = true; this.add('bothKit'); }
          break;
        }
        case 'streak':
          if (e.id !== id) {
            if (me?.alive && e.team !== me.team) this.add('enemyStreaks');
            break;
          }
          this.add('streaksCalled');
          if (DEPLOY_STREAKS.has(e.kind)) this.add('deploys');
          break;
      }
    }
    if (me) {
      if (me.alive && this.wasAlive && !spawned) {
        if (me.hp > this.prevHp && !healed) this.add('regenHp', me.hp - this.prevHp);
        if (me.sprinting && this.prevX !== null) {
          const d = Math.hypot(me.x - this.prevX, me.z - this.prevZ);
          if (d < 3) this.add('sprintM', d);       // More than this in a frame is a respawn or a stall.
        }
        if (dt > 0) {
          const enemy = 1 - me.team;
          if ((view.uav?.[enemy] ?? 0) > 0) this.add('uavSec', dt);
        }
      }
      this.prevHp = me.alive ? me.hp : MAX_HP;
      this.prevX = me.x; this.prevZ = me.z;
      this.wasAlive = me.alive;
    }
    this.prevT = t;
  }
}

// Adds one match's gains into a save's counters. Returns the perks that just turned Pro.
export function applyProGains(save, gains) {
  const fresh = [];
  for (const [perk, stats] of Object.entries(gains ?? {})) {
    if (!PRO_CHALLENGES[perk] || save.proDone.includes(perk)) continue;
    const counts = save.pro[perk] ??= {};
    for (const [stat, n] of Object.entries(stats)) {
      if (PRO_STATS.includes(stat) && Number.isFinite(n) && n > 0) counts[stat] = Math.min(COUNT_MAX, Math.round(((counts[stat] ?? 0) + n) * 10) / 10);
    }
    if (proStatus(perk, save.pro, save.proDone).done) { save.proDone.push(perk); fresh.push(perk); }
  }
  return fresh;
}

/* ---------- Mastery tracks (save v4, docs/PROGRESSION.md) ---------- */
// Every tactical, lethal, scorestreak and operator has a track of sequential tiers. Each tier is one challenge on a
// cumulative counter of that item; a tier only completes once the one before it has, and a completed tier stays
// completed even if its goal is retuned later. Counters are kept per track as {stat: n}; MasteryTracker below counts
// them from the event stream. Goals were set like the Pro ones: a track's first tier is a match or two of using it,
// the last one a long project.
const T = (stat, goal, label) => ({ stat, goal, label });
const GEAR_TRACKS = {
  tactical: {
    smoke:  [T('uses', 25, 'Throw 25 Smokes'), T('coverKills', 10, 'Get 10 kills within 9 s of a Smoke'), T('uses', 75, 'Throw 75 Smokes'), T('coverKills', 40, 'Get 40 kills within 9 s of a Smoke')],
    flash:  [T('uses', 20, 'Throw 20 Flashes'), T('blinded', 30, 'Blind 30 enemies'), T('flashKills', 10, 'Kill 10 enemies you flashed'), T('flashKills', 35, 'Kill 35 enemies you flashed')],
    stim:   [T('uses', 20, 'Use 20 Stims'), T('stimKills', 12, 'Get 12 kills within 5 s of a Stim'), T('uses', 60, 'Use 60 Stims'), T('stimKills', 40, 'Get 40 kills within 5 s of a Stim')],
    decoy:  [T('uses', 15, 'Throw 15 Decoys'), T('shots', 120, 'Fake 120 shots with Decoys'), T('decoyKills', 10, 'Get 10 kills within 10 s of a Decoy'), T('decoyKills', 35, 'Get 35 kills within 10 s of a Decoy')],
    sensor: [T('uses', 15, 'Throw 15 Sensors'), T('marked', 30, 'Mark 30 enemies'), T('markKills', 10, 'Kill 10 marked enemies'), T('markKills', 35, 'Kill 35 marked enemies')],
    trophy: [T('uses', 15, 'Place 15 Trophies'), T('saves', 8, 'Stop 8 enemy throws'), T('saves', 25, 'Stop 25 enemy throws'), T('saves', 60, 'Stop 60 enemy throws')],
    stun:   [T('uses', 20, 'Throw 20 Stuns'), T('dazed', 30, 'Stun 30 enemies'), T('dazeKills', 10, 'Kill 10 enemies you stunned'), T('dazeKills', 35, 'Kill 35 enemies you stunned')],
    gas:    [T('uses', 15, 'Throw 15 Gas grenades'), T('dazed', 25, 'Gas 25 enemies'), T('dazeKills', 10, 'Kill 10 enemies you gassed'), T('dazeKills', 35, 'Kill 35 enemies you gassed')],
    shock:  [T('uses', 15, 'Throw 15 Shocks'), T('fried', 8, 'Fry 8 enemy devices'), T('dazeKills', 10, 'Kill 10 enemies you shocked'), T('fried', 30, 'Fry 30 enemy devices')],
    // Gear wave.
    snapshot: [T('uses', 15, 'Throw 15 Snapshots'), T('marked', 30, 'Reveal 30 enemies'), T('markKills', 10, 'Kill 10 enemies you revealed'), T('markKills', 35, 'Kill 35 enemies you revealed')],
    blackout: [T('uses', 15, 'Throw 15 Blackouts'), T('jammed', 25, 'Jam 25 enemies'), T('jamKills', 10, 'Kill 10 enemies you jammed'), T('fried', 25, 'Destroy 25 enemy devices with Blackout')],
    bulwark:  [T('uses', 15, 'Deploy 15 Ramparts'), T('coverKills', 10, 'Get 10 kills within 12 s of a Rampart'), T('uses', 50, 'Deploy 50 Ramparts'), T('coverKills', 40, 'Get 40 kills within 12 s of a Rampart')],
    tagger:   [T('uses', 15, 'Throw 15 Taggers'), T('tagged', 10, 'Stick a Tagger on 10 enemies'), T('markKills', 10, 'Kill 10 enemies you tagged'), T('markKills', 35, 'Kill 35 enemies you tagged')],
    medpack:  [T('uses', 15, 'Drop 15 Medpacks'), T('healed', 800, 'Heal 800 health'), T('mates', 500, 'Heal teammates for 500 health'), T('healed', 4000, 'Heal 4,000 health')],
  },
  lethal: {
    frag:    [T('uses', 30, 'Throw 30 Frags'), T('kills', 25, 'Get 25 Frag kills'), T('bankKills', 5, 'Get 5 kills with a Frag banked off a wall'), T('multi', 10, 'Kill 2 or more with one Frag 10 times')],
    sticky:  [T('uses', 20, 'Throw 20 Stickies'), T('kills', 20, 'Get 20 Sticky kills'), T('longKills', 5, 'Get 5 Sticky kills from 12 m or more'), T('multi', 5, 'Kill 2 or more with one Sticky 5 times')],
    molotov: [T('uses', 20, 'Throw 20 Molotovs'), T('kills', 12, 'Get 12 Molotov kills'), T('multi', 4, 'Burn 2 or more at once 4 times'), T('kills', 40, 'Get 40 Molotov kills')],
    mine:    [T('uses', 15, 'Place 15 Mines'), T('kills', 10, 'Get 10 Mine kills'), T('multi', 3, 'Kill 2 or more with one Mine 3 times'), T('kills', 40, 'Get 40 Mine kills')],
    cluster: [T('uses', 20, 'Throw 20 Clusters'), T('kills', 15, 'Get 15 Cluster kills'), T('multi', 6, 'Kill 2 or more with one Cluster 6 times'), T('kills', 50, 'Get 50 Cluster kills')],
    hatchet: [T('uses', 20, 'Throw 20 Hatchets'), T('kills', 10, 'Get 10 Hatchet kills'), T('longKills', 5, 'Get 5 Hatchet kills from 12 m or more'), T('kills', 40, 'Get 40 Hatchet kills')],
    impact:   [T('uses', 25, 'Throw 25 Impacts'), T('kills', 20, 'Get 20 Impact kills'), T('directKills', 5, 'Get 5 Impact kills on a direct hit'), T('multi', 5, 'Kill 2 or more with one Impact 5 times')],
    claymore: [T('uses', 15, 'Place 15 Claymores'), T('kills', 10, 'Get 10 Claymore kills'), T('multi', 3, 'Kill 2 or more with one Claymore 3 times'), T('kills', 40, 'Get 40 Claymore kills')],
    drill:    [T('uses', 20, 'Throw 20 Drills'), T('kills', 10, 'Get 10 Drill kills'), T('wallKills', 8, 'Get 8 Drill kills through a wall'), T('wallKills', 30, 'Get 30 Drill kills through a wall')],
    // Gear wave.
    charge:   [T('uses', 20, 'Plant 20 Satchels'), T('kills', 15, 'Get 15 Satchel kills'), T('multi', 4, 'Kill 2 or more with one Satchel 4 times'), T('kills', 45, 'Get 45 Satchel kills')],
    thermite: [T('uses', 20, 'Throw 20 Thermites'), T('kills', 10, 'Get 10 Thermite kills'), T('melted', 10, 'Melt 10 enemy devices or Ramparts'), T('kills', 35, 'Get 35 Thermite kills')],
    tripwire: [T('uses', 15, 'Set 15 Tripwires'), T('kills', 10, 'Get 10 Tripwire kills'), T('multi', 3, 'Kill 2 or more with one Tripwire 3 times'), T('kills', 35, 'Get 35 Tripwire kills')],
    crawler:  [T('uses', 20, 'Throw 20 Crawlers'), T('kills', 15, 'Get 15 Crawler kills'), T('multi', 4, 'Kill 2 or more with one Crawler 4 times'), T('kills', 45, 'Get 45 Crawler kills')],
    shiv:     [T('uses', 25, 'Throw 25 Shivs'), T('kills', 10, 'Get 10 Shiv kills'), T('backKills', 8, 'Get 8 Shiv kills in the back'), T('kills', 40, 'Get 40 Shiv kills')],
  },
  streak: {
    uav:       [T('uses', 5, 'Call in 5 UAVs'), T('upKills', 15, 'Get 15 kills while your UAV is up'), T('uses', 20, 'Call in 20 UAVs'), T('upKills', 60, 'Get 60 kills while your UAV is up')],
    jammer:    [T('uses', 5, 'Call in 5 Jammers'), T('upKills', 10, 'Get 10 kills while your Jammer is up'), T('uses', 15, 'Call in 15 Jammers'), T('upKills', 40, 'Get 40 kills while your Jammer is up')],
    resupply:  [T('uses', 5, 'Call in 5 Supply Drops'), T('supplied', 10, 'Resupply 10 teammates'), T('uses', 15, 'Call in 15 Supply Drops'), T('supplied', 40, 'Resupply 40 teammates')],
    turret:    [T('uses', 5, 'Deploy 5 Sentries'), T('kills', 10, 'Get 10 Sentry kills'), T('multi', 3, 'Get 3 Sentry multi-kills'), T('kills', 40, 'Get 40 Sentry kills')],
    mortar:    [T('uses', 5, 'Call in 5 Mortar Teams'), T('kills', 10, 'Get 10 Mortar kills'), T('multi', 3, 'Get 3 Mortar multi-kills'), T('kills', 40, 'Get 40 Mortar kills')],
    strike:    [T('uses', 5, 'Call in 5 Airstrikes'), T('kills', 10, 'Get 10 Airstrike kills'), T('multi', 4, 'Get 4 Airstrike multi-kills'), T('kills', 40, 'Get 40 Airstrike kills')],
    overwatch: [T('uses', 3, 'Call in 3 Overwatches'), T('upKills', 10, 'Get 10 kills during Overwatch'), T('uses', 12, 'Call in 12 Overwatches'), T('upKills', 40, 'Get 40 kills during Overwatch')],
    chopper:   [T('uses', 3, 'Call in 3 Attack Choppers'), T('kills', 10, 'Get 10 Chopper kills'), T('multi', 3, 'Get 3 Chopper multi-kills'), T('kills', 35, 'Get 35 Chopper kills')],
    emp:       [T('uses', 3, 'Call in 3 EMPs'), T('upKills', 8, 'Get 8 kills within 20 s of an EMP'), T('uses', 10, 'Call in 10 EMPs'), T('upKills', 30, 'Get 30 kills within 20 s of an EMP')],
    gunship:   [T('uses', 3, 'Call in 3 Gunships'), T('kills', 15, 'Get 15 Gunship kills'), T('multi', 4, 'Get 4 Gunship multi-kills'), T('kills', 50, 'Get 50 Gunship kills')],
    missile:   [T('uses', 5, 'Launch 5 Cruise Missiles'), T('kills', 10, 'Get 10 Cruise Missile kills'), T('multi', 3, 'Kill 2 or more with one Cruise Missile 3 times'), T('kills', 35, 'Get 35 Cruise Missile kills')],
    swarm:     [T('uses', 3, 'Launch 3 Drone Swarms'), T('kills', 10, 'Get 10 Drone Swarm kills'), T('multi', 3, 'Get 3 Drone Swarm multi-kills'), T('kills', 35, 'Get 35 Drone Swarm kills')],
    juggernaut: [T('uses', 3, 'Suit up as a Juggernaut 3 times'), T('suitKills', 15, 'Get 15 kills as a Juggernaut'), T('soaked', 2500, 'Soak 2,500 damage with Juggernaut armour'), T('suitKills', 50, 'Get 50 kills as a Juggernaut')],
    // V9.
    sweep:     [T('uses', 5, 'Call in 5 Sonar Sweeps'), T('marked', 20, 'Reveal 20 enemies with Sonar Sweep'), T('markKills', 10, 'Kill 10 enemies your Sweep revealed'), T('markKills', 40, 'Kill 40 enemies your Sweep revealed')],
    recon:     [T('uses', 5, 'Fly 5 Recon Drones'), T('marked', 25, 'Mark 25 enemies with a Recon Drone'), T('markKills', 10, 'Kill 10 enemies your drone marked'), T('marked', 120, 'Mark 120 enemies with a Recon Drone')],
    airdrop:   [T('uses', 5, 'Call in 5 Airdrops'), T('opened', 5, 'Open 5 of your own Airdrops'), T('stolen', 3, 'Steal 3 enemy Airdrops'), T('uses', 25, 'Call in 25 Airdrops')],
    plates:    [T('uses', 5, 'Call in 5 Plate Drops'), T('supplied', 10, 'Plate up 10 teammates'), T('soaked', 1500, 'Soak 1,500 damage with plates'), T('supplied', 50, 'Plate up 50 teammates')],
    hound:     [T('uses', 5, 'Deploy 5 Wingmen'), T('kills', 8, 'Get 8 Wingman kills'), T('multi', 2, 'Get 2 Wingman multi-kills'), T('kills', 35, 'Get 35 Wingman kills')],
    dome:      [T('uses', 5, 'Raise 5 Aegis Domes'), T('saves', 8, 'Shoot down 8 enemy throws with a Dome'), T('uses', 20, 'Raise 20 Aegis Domes'), T('saves', 40, 'Shoot down 40 enemy throws with a Dome')],
    bombrun:   [T('uses', 5, 'Draw 5 Carpet Lines'), T('kills', 10, 'Get 10 Carpet Line kills'), T('multi', 4, 'Get 4 Carpet Line multi-kills'), T('kills', 40, 'Get 40 Carpet Line kills')],
    rover:     [T('uses', 3, 'Deploy 3 Rovers'), T('kills', 10, 'Get 10 Rover kills'), T('multi', 3, 'Get 3 Rover multi-kills'), T('kills', 35, 'Get 35 Rover kills')],
  },
};
// Operators: time, kills, a signature that fits the character, wins, then a long kill count. The roster itself lives in
// js/ui/operators.js, which imports the card registry (cardbook.js), which imports this file: so the ids and names are
// repeated here rather than imported. An operator added there needs a line here to get a track.
const MASTERY_OPERATORS = [['trooper', 'Trooper'], ['wisp', 'Wisp'], ['anvil', 'Anvil'], ['relay', 'Relay'], ['yarddog', 'Yard Dog'],
  ['ronin', 'Ronin'], ['ghoul', 'Ghoul'], ['ram', 'Ram'], ['monarch', 'Monarch'],
  // Operators wave (roadmap 11), in js/ui/operators.js order.
  ['sparrow', 'Sparrow'], ['coyote', 'Coyote'], ['vesper', 'Vesper'], ['wren', 'Wren'], ['ox', 'Ox'], ['morse', 'Morse'],
  ['cipher', 'Cipher'], ['harrow', 'Harrow'], ['sable', 'Sable'], ['marshal', 'Marshal'], ['flint', 'Flint'], ['nyx', 'Nyx'],
  ['halcyon', 'Halcyon'], ['tinker', 'Tinker'], ['rook', 'Rook'], ['mako', 'Mako'], ['seraph', 'Seraph'], ['warden', 'Warden']];
const OPERATOR_SIGNATURE = {
  trooper: T('multi', 15, 'Get 15 multi-kills'),
  wisp: T('slideKills', 20, 'Get 20 kills while sliding'),
  anvil: T('hurtKills', 40, 'Get 40 kills while hurt'),
  relay: T('assists', 40, 'Get 40 assists'),
  yarddog: T('obj', 20, 'Capture, confirm, plant or defuse 20 times'),
  ronin: T('long', 25, 'Get 25 longshots'),
  ghoul: T('head', 40, 'Get 40 headshots'),
  ram: T('closeKills', 50, 'Get 50 kills within 8 m'),
  monarch: T('streak5', 10, 'Reach a 5-kill streak 10 times'),
  sparrow: T('assists', 40, 'Get 40 assists'),
  coyote: T('long', 25, 'Get 25 longshots'),
  vesper: T('head', 40, 'Get 40 headshots'),
  wren: T('multi', 15, 'Get 15 multi-kills'),
  ox: T('hurtKills', 40, 'Get 40 kills while hurt'),
  morse: T('assists', 40, 'Get 40 assists'),
  cipher: T('obj', 20, 'Capture, confirm, plant or defuse 20 times'),
  harrow: T('long', 25, 'Get 25 longshots'),
  sable: T('slideKills', 20, 'Get 20 kills while sliding'),
  marshal: T('streak5', 10, 'Reach a 5-kill streak 10 times'),
  flint: T('obj', 20, 'Capture, confirm, plant or defuse 20 times'),
  nyx: T('closeKills', 50, 'Get 50 kills within 8 m'),
  halcyon: T('hurtKills', 40, 'Get 40 kills while hurt'),
  tinker: T('obj', 20, 'Capture, confirm, plant or defuse 20 times'),
  rook: T('closeKills', 50, 'Get 50 kills within 8 m'),
  mako: T('head', 40, 'Get 40 headshots'),
  seraph: T('multi', 15, 'Get 15 multi-kills'),
  warden: T('streak5', 10, 'Reach a 5-kill streak 10 times'),
};
const operatorTiers = (id, name) => [
  T('secs', 900, `Play 15 minutes as ${name}`), T('kills', 50, `Get 50 kills as ${name}`),
  OPERATOR_SIGNATURE[id] ?? T('assists', 40, 'Get 40 assists'), T('wins', 10, `Win 10 matches as ${name}`), T('kills', 300, `Get 300 kills as ${name}`),
];

// Rewards by tier. Gear (4 tiers): XP, bronze badge, calling card, gold badge and XP. Operators (5 tiers): XP, bronze
// badge and veteran skin, elite skin, calling card and specialist skin, mastery skin with the gold badge and XP. Skin ids
// are the operator roster's own (js/ui/operators.js SKINS: 'skin:<op>-2' .. 'skin:<op>-5'); the tier 2 and 4 skins came
// with the operators wave, and saves past those tiers have them at once (rewards are read from the tiers reached).
// Cards are rows in CARDS; badges are drawn by js/ui/mastery.js.
const OP_SKIN_NAME = { 2: 'veteran', 3: 'elite', 4: 'specialist', 5: 'mastery' };
function trackRewards(kind, item, name, tier, count) {
  const op = kind === 'operator', out = [];
  if (tier === 1) out.push({ kind: 'xp', xp: 1000, name: '1,000 XP' });
  if (tier === 2) out.push({ kind: 'badge', id: `badge:${item}-1`, name: `${name} bronze badge` });
  if (op && tier >= 2) out.push({ kind: 'skin', id: `skin:${item}-${tier}`, name: `${name} ${OP_SKIN_NAME[tier]} skin` });
  if (tier === (op ? 4 : 3)) out.push({ kind: 'card', id: `card:mastery-${item}`, name: `${name} Master` });
  if (tier === count) out.push({ kind: 'badge', id: `badge:${item}-2`, name: `${name} gold badge` }, { kind: 'xp', xp: op ? 5000 : 3000, name: `${op ? '5,000' : '3,000'} XP` });
  return out;
}

// Every stat a track keeps: its tiers' stats plus uses and kills, which the unlock challenges total across tracks.
function makeTrack(kind, item, name, icon, tiers, rewards) {
  const list = tiers.map((c, i) => ({ ...c, tier: i + 1, rewards: rewards(i + 1, tiers.length) }));
  return { id: item, kind, item, name, icon, tiers: list, stats: [...new Set(['uses', 'kills', ...tiers.map(c => c.stat)])] };
}

const KIND_TABLE = { tactical: TACTICALS, lethal: LETHALS, streak: STREAKS };
export const MASTERY_KINDS = ['tactical', 'lethal', 'streak', 'operator'];
export const MASTERY_TRACKS = [
  ...['tactical', 'lethal', 'streak'].flatMap(kind => Object.keys(KIND_TABLE[kind]).map(id => {
    const name = KIND_TABLE[kind][id].name;
    // An item added to the catalog without a line above still gets a plain track, never a missing one.
    const tiers = GEAR_TRACKS[kind][id] ?? [T('uses', 20, `Use ${name} 20 times`), T('uses', 50, `Use ${name} 50 times`), T('uses', 100, `Use ${name} 100 times`), T('uses', 200, `Use ${name} 200 times`)];
    return makeTrack(kind, id, name, id, tiers, (tier, n) => trackRewards(kind, id, name, tier, n));
  })),
  ...MASTERY_OPERATORS.map(([id, name]) => makeTrack('operator', id, name, 'ui:operator', operatorTiers(id, name), (tier, n) => trackRewards('operator', id, name, tier, n))),
];
const TRACK_BY_ID = new Map(MASTERY_TRACKS.map(t => [t.id, t]));
export const getTrack = id => TRACK_BY_ID.get(id) ?? null;

// The weapon ladder: five tiers after weapon level 30, counted only once the gun has reached it. Finishing it opens the
// mastery camos (with every camo challenge, as before).
export const WEAPON_LADDER = [
  T('kills', 100, 'Get 100 kills past level 30'), T('hurt', 30, 'Get 30 kills while hurt'), T('multi', 15, 'Get 15 multi-kills'),
  T('run5', 5, 'Get 5 kills in one life, 5 times'), T('kills', 300, 'Get 300 kills past level 30'),
];
const LADDER_XP = [2000, 3000, 4000, 5000, 6000];
const LADDER_STATS = [...new Set(WEAPON_LADDER.map(c => c.stat))];
const ladderTracks = new Map();
export function ladderTrack(w) {
  let t = ladderTracks.get(w);
  if (t) return t;
  const name = WEAPONS[w]?.name ?? w;
  t = makeTrack('weapon', w, name, w, WEAPON_LADDER, (tier, n) => [
    { kind: 'xp', xp: LADDER_XP[tier - 1], name: `${LADDER_XP[tier - 1].toLocaleString('en-US')} XP` },
    ...(tier === 2 ? [{ kind: 'badge', id: `badge:${w}-1`, name: `${name} bronze badge` }] : []),
    ...(tier === n ? [{ kind: 'badge', id: `badge:${w}-2`, name: `${name} gold badge` }, { kind: 'card', id: `card:mastery-${w}`, name: `${name} Master` }, { kind: 'camos', name: 'Mastery camos open' }] : []),
  ]);
  t.id = `gun:${w}`;
  t.stats = LADDER_STATS;
  ladderTracks.set(w, t);
  return t;
}
export const ladderDone = w => (w?.ladT ?? 0) >= WEAPON_LADDER.length;

// A counter entry, {s:{stat:n}, t:tiers}, raised to every tier its counters already meet, in order.
function advance(track, entry) {
  let t = Math.min(track.tiers.length, entry.t ?? 0);
  while (t < track.tiers.length && (entry.s?.[track.tiers[t].stat] ?? 0) >= track.tiers[t].goal) t++;
  entry.t = t;
  return entry;
}

// {id, kind, item, name, icon, tier, count, tiers:[{stat,goal,label,tier,rewards,value,done}], next, maxed}.
export function trackStatus(track, entry = {}) {
  const t = Math.min(track.tiers.length, entry.t ?? 0), s = entry.s ?? {};
  const tiers = track.tiers.map((c, i) => ({ ...c, value: i < t ? c.goal : Math.min(c.goal, Math.floor(s[c.stat] ?? 0)), done: i < t }));
  return { id: track.id, kind: track.kind, item: track.item, name: track.name, icon: track.icon, tier: t, count: tiers.length, tiers, next: tiers[t] ?? null, maxed: t >= tiers.length };
}

const weaponEntry = w => ({ s: w?.lad ?? {}, t: w?.ladT ?? 0 });
export const ladderStatus = (id, w) => ({ ...trackStatus(ladderTrack(id), weaponEntry(w)), open: (w?.peak ?? 1) >= MAX_WEAPON_LEVEL });

// Every reward id a save has earned from mastery: 'card:mastery-frag', 'skin:anvil-3', 'badge:frag-1', ...
export function masteryRewards(save) {
  const out = new Set();
  const collect = (track, t) => { for (const c of track.tiers.slice(0, t)) for (const r of c.rewards) if (r.id) out.add(r.id); };
  for (const track of MASTERY_TRACKS) collect(track, save.mastery?.[track.id]?.t ?? 0);
  for (const [w, entry] of Object.entries(save.weapons ?? {})) if (WEAPONS[w] && entry.ladT) collect(ladderTrack(w), entry.ladT);
  return out;
}

// The skins an operator's track grants, in tier order.
export const operatorSkins = op => (getTrack(op)?.tiers ?? []).flatMap(c => c.rewards.filter(r => r.kind === 'skin').map(r => ({ id: r.id, tier: c.tier, name: r.name })));

// Adds one match's MasteryTracker gains into a save. Weapon ladder gains only count for guns at level 30 or past it.
// Returns {moved, ups, xp}: moved is one row per track that moved, for the results strip:
//   {id, kind, item, name, icon, label, goal, before, value, tierBefore, tier, count, up}
// (label/goal/before/value describe the tier that was current at the start); ups is one entry per tier gained:
//   {kind:'mastery', id, track, trackKind, item, name, icon, tier, count, label, rewards:[...]}; xp is what they pay.
export function applyMasteryGains(save, gains = {}) {
  const moved = [], ups = [];
  const add = (track, entry, stats) => {
    const before = trackStatus(track, entry);
    let any = false;
    for (const [stat, n] of Object.entries(stats ?? {})) {
      if (!track.stats.includes(stat) || !Number.isFinite(n) || n <= 0) continue;
      entry.s[stat] = Math.min(COUNT_MAX, Math.round(((entry.s[stat] ?? 0) + n) * 10) / 10);
      any = true;
    }
    if (!any) return;
    advance(track, entry);
    const after = trackStatus(track, entry);
    const cur = before.next;
    if (cur && (after.tiers[before.tier].value > cur.value || after.tier > before.tier)) {
      moved.push({ id: track.id, kind: track.kind, item: track.item, name: track.name, icon: track.icon, label: cur.label, goal: cur.goal,
        before: cur.value, value: after.tiers[before.tier].value, tierBefore: before.tier, tier: after.tier, count: after.count, up: after.tier - before.tier });
    }
    for (let k = before.tier; k < after.tier; k++) {
      const c = track.tiers[k];
      ups.push({ kind: 'mastery', id: `${track.id}:${k + 1}`, track: track.id, trackKind: track.kind, item: track.item, name: track.name, icon: track.icon, tier: k + 1, count: track.tiers.length, label: c.label, rewards: c.rewards });
    }
  };
  for (const [id, stats] of Object.entries(gains.tracks ?? {})) {
    const track = getTrack(id);
    if (track) add(track, save.mastery[id] ??= { s: {}, t: 0 }, stats);
  }
  for (const [w, stats] of Object.entries(gains.weapons ?? {})) {
    const entry = save.weapons[w];
    if (!WEAPONS[w] || !entry || entry.peak < MAX_WEAPON_LEVEL) continue;
    const box = { s: entry.lad ??= {}, t: entry.ladT ?? 0 };
    add(ladderTrack(w), box, stats);
    entry.ladT = box.t;
  }
  const xp = ups.reduce((n, u) => n + u.rewards.reduce((m, r) => m + (r.xp ?? 0), 0), 0);
  return { moved, ups, xp };
}

/* ---------- Unlock challenges ---------- */
// A few late items need a small challenge on top of their level, read from the mastery counters. Level 1 gear never
// has one, so a new player always has a full loadout. Saves from before v4 keep anything their level had opened
// (`granted`, filled by the migration).
const total = (save, kind, stat) => MASTERY_TRACKS.filter(t => t.kind === kind).reduce((n, t) => n + (save.mastery?.[t.id]?.s?.[stat] ?? 0), 0);
export const UNLOCK_CHALLENGES = {
  'lethal:cluster':  { label: 'Get 10 Frag kills', goal: 10, value: s => s.mastery?.frag?.s?.kills ?? 0 },
  'lethal:hatchet':  { label: 'Get 15 lethal equipment kills', goal: 15, value: s => total(s, 'lethal', 'kills') },
  'tactical:trophy': { label: 'Throw 40 tactical equipment', goal: 40, value: s => total(s, 'tactical', 'uses') },
  'tactical:blackout': { label: 'Throw 60 tactical equipment', goal: 60, value: s => total(s, 'tactical', 'uses') },
  'streak:chopper':  { label: 'Call in 5 scorestreaks', goal: 5, value: s => total(s, 'streak', 'uses') },
  'streak:emp':      { label: 'Call in 10 scorestreaks', goal: 10, value: s => total(s, 'streak', 'uses') },
  'streak:gunship':  { label: 'Get 15 scorestreak kills', goal: 15, value: s => total(s, 'streak', 'kills') },
  'streak:juggernaut': { label: 'Call in 8 scorestreaks', goal: 8, value: s => total(s, 'streak', 'uses') },
  'streak:dome':     { label: 'Call in 12 scorestreaks', goal: 12, value: s => total(s, 'streak', 'uses') },
  'streak:rover':    { label: 'Get 25 scorestreak kills', goal: 25, value: s => total(s, 'streak', 'kills') },
  // Extraction exclusives (js/shared/extraction.js): contracts banked by getting out, counted in the lifetime tallies.
  ...Object.fromEntries(EX_UNLOCKS.filter(u => u.kind === 'streak' || u.kind === 'perk').map(u => [u.id, { label: u.label, goal: u.goal, value: s => s.life?.[u.key] ?? 0, extraction: true }])),
};

// {label, goal, value, done} for an item's challenge in a save, or null when it has none.
export function unlockChallenge(save, kind, id) {
  const c = UNLOCK_CHALLENGES[`${kind}:${id}`];
  if (!c) return null;
  const granted = save.granted?.includes(`${kind}:${id}`);
  const value = granted ? c.goal : Math.min(c.goal, Math.floor(c.value(save)));
  return { label: c.label, goal: c.goal, value, done: value >= c.goal };
}

export function itemOpen(save, kind, id) {
  if (itemUnlockLevel(kind, id) > (save.peakLevel ?? 1)) return false;
  return unlockChallenge(save, kind, id)?.done ?? true;
}

// Before v4: everything a level had opened stays open, and mastery camos earned under the old rule stay earned.
function grandfather(s) {
  for (const key of Object.keys(UNLOCK_CHALLENGES)) {
    const [kind, id] = key.split(':');
    if (itemUnlockLevel(kind, id) <= s.peakLevel && !s.granted.includes(key)) s.granted.push(key);
  }
  for (const w of Object.values(s.weapons)) {
    for (const c of CAMOS) {
      if (c.mastery && isMastered(w) && (w.kills ?? 0) >= (c.masteryKills ?? 0) && !w.owned.includes(c.id)) w.owned.push(c.id);
    }
  }
  return s;
}

/* ---------- Counting mastery in a match ---------- */
const UP_SECS = { uav: 20, jammer: 15, overwatch: 30, emp: 20 };   // How long each counts as "up" for upKills.
const AFTER_SECS = { smoke: 9, stim: 5, decoy: 10, bulwark: 12 };                // A kill this soon after using it counts for it.
const AFTER_STAT = { smoke: 'coverKills', stim: 'stimKills', decoy: 'decoyKills', bulwark: 'coverKills' };
const JAM_KILL_SECS = 6;         // Blackout: a kill on an enemy this player jammed, while they are jammed.
const MEDPACK_TICK = 7;          // Health per Medpack heal event (js/sim/equipment.js medpack.medic.amount).
const FLASH_KILL_SECS = 4;
const MULTI_GAP = { molotov: 1.5, mine: 0.6, claymore: 0.6, thermite: 1.5, tripwire: 0.6, charge: 0.6, crawler: 0.6 };       // Kills by one item this close are one multi-kill.
const DAZE_KILL_SECS = 4;        // A kill this soon after this player stunned, gassed or shocked the victim counts for that item.
const DAZE_RECOUNT = 3;          // Gas keeps re-dazing: the same enemy counts again only after this long.
const BANG_KILL_SECS = 0.4;      // A Drill or Impact kill this soon after its bang belongs to that bang (wall, direct).
const STREAK_MULTI_GAP = 1.5;
const LONG_THROW = 12;
const BANK_WINDOW = 3.5;         // A frag kill this soon after a banked throw is the banked frag's.
const OBJ_MEDALS = new Set(['capture', 'confirm', 'plant', 'defuse', 'flag_capture', 'flag_return']);

// Counts one match for the mastery tracks and the weapon ladder. Pure, like ProTracker: feed onEvents(events, view)
// every frame; setLoadout(loadout) at each spawn (the operator in use); finish({won}) once. gains() is
// {tracks: {trackId: {stat: n}}, weapons: {weaponId: {stat: n}}}. `bounced(throwEvent)` says whether a throw banked off
// a wall (awards.js runs the throw through the shared throw preview); without it banked kills are not counted.
export class MasteryTracker {
  constructor(localId, { loadout = null, bounced = null } = {}) {
    this.id = localId;
    this.bounced = bounced;
    this.tracks = {};
    this.weapons = {};
    this.op = null;
    this.setLoadout(loadout);
    this.t = 0; this.prevT = null; this.prevHp = MAX_HP; this.team = null;
    this.used = {};              // item -> last time used; frag also keeps whether it banked
    this.fragBank = false;
    this.flashed = new Map();    // enemy id -> when this player flashed them
    this.marked = new Map();     // enemy id -> {until, kind}: this player's recon (Sensor, Snapshot, Tagger) shows them
    this.jammed = new Map();     // enemy id -> until when this player's Blackout jams them
    this.backT = -99;            // When this player last landed a Shiv in someone's back
    this.dazedBy = new Map();    // enemy id -> {kind, t} this player last stunned, gassed or shocked them
    this.bangs = {};             // Drill and Impact: when this player's last one went off, and how
    this.up = {};                // streak -> until
    this.supplyT = -99;          // A Supply Drop from this player's team, for telling it apart from a Stim
    this.supplyMine = false;
    this.killT = -99;
    this.chain = {};
    this.life = {};              // weapon -> kills this life
    this.lastGun = null; this.lastGunT = -99;
  }

  setLoadout(l) { this.op = l?.operator ?? null; }

  add(track, stat, n = 1) {
    if (!(n > 0) || !track) return;
    const g = this.tracks[track] ??= {};
    g[stat] = (g[stat] ?? 0) + n;
  }

  addGun(w, stat, n = 1) {
    const g = this.weapons[w] ??= {};
    g[stat] = (g[stat] ?? 0) + n;
  }

  // True when this kill makes a run of kills by one source a multi-kill (once per run).
  #chained(key, gap) {
    const c = this.chain[key];
    if (c && this.t - c.t <= gap) { c.t = this.t; c.n++; return c.n === 2; }
    this.chain[key] = { t: this.t, n: 1 };
    return false;
  }

  #enemy(view, id) {
    const p = view?.players?.find(q => q.id === id);
    return !!p && p.team !== this.team;
  }

  gains() { return { tracks: this.tracks, weapons: this.weapons }; }

  finish({ won = false } = {}) {
    if (won) this.add(this.op, 'wins');
    return this.gains();
  }

  onEvents(events, view) {
    const id = this.id, me = view?.players?.find(p => p.id === id) ?? null;
    const t = typeof view?.t === 'number' ? view.t : this.t;
    const dt = this.prevT === null ? 0 : Math.min(0.25, Math.max(0, t - this.prevT));
    this.t = t;
    if (me) this.team = me.team;
    const op = this.op;
    for (const e of events) {
      switch (e.t) {
        case 'throw':
          if (e.id !== id || !(TACTICALS[e.kind] || LETHALS[e.kind])) break;
          this.add(e.kind, 'uses');
          this.used[e.kind] = t;
          if (e.kind === 'frag') this.fragBank = !!this.bounced?.(e);
          break;
        case 'heal':
          // A Stim has no throw: it is a heal of this player that no kill (Adrenaline) or Supply Drop explains.
          if (e.kind) {                 // Medpack ticks carry their kind and owner.
            if (e.by === id && TACTICALS[e.kind]) { this.add(e.kind, 'healed', MEDPACK_TICK); if (e.id !== id) this.add(e.kind, 'mates', MEDPACK_TICK); }
          } else if (e.id === id) {
            if (t - this.killT > 0.3 && t - this.supplyT > 0.6) { this.add('stim', 'uses'); this.used.stim = t; }
          } else if (t - this.supplyT <= 0.6 && this.supplyMine && !this.#enemy(view, e.id)) this.add('resupply', 'supplied');
          break;
        case 'flashed':
          if (e.by === id && e.id !== id && this.#enemy(view, e.id)) { this.add('flash', 'blinded'); this.flashed.set(e.id, t); }
          break;
        case 'marked': {
          const k = TACTICALS[e.kind] || STREAKS[e.kind] ? e.kind : 'sensor';     // Recon Drone and Sonar Sweep mark too.
          if (e.by === id && this.#enemy(view, e.id)) {
            const was = this.marked.get(e.id);
            if (!was || was.kind !== k || was.until < t) this.add(k, 'marked');    // A planted Sensor re-pings: one count per sighting.
            this.marked.set(e.id, { until: t + (e.dur ?? 3), kind: k });
          }
          break;
        }
        case 'jammed': if (e.by === id && e.kind !== 'emp') { this.add('blackout', 'jammed'); this.jammed.set(e.id, t + JAM_KILL_SECS); } break;
        case 'stuck': if (e.by === id && e.kind === 'tagger') this.add('tagger', 'tagged'); break;
        case 'hit': if (e.by === id && e.eq === 'shiv' && e.dmg >= MAX_HP) this.backT = t; break;
        case 'zap': if (e.by === id) this.add(e.kind === 'dome' ? 'dome' : 'trophy', 'saves'); break;
        // V9: Airdrops opened and stolen, plates handed out.
        case 'crate_open':
          if (e.owner === id && e.id === id) this.add('airdrop', 'opened');
          if (e.id === id && e.stolen) this.add('airdrop', 'stolen');
          break;
        case 'plates':
          if (e.by === id && e.id !== id) this.add('plates', 'supplied');
          if (e.id === id) this.platesOwn = e.by === id;     // Plates soaked count for the Plate Drop that gave them.
          break;
        case 'dazed': {
          if (e.by !== id || e.id === id || !TACTICALS[e.kind] || !this.#enemy(view, e.id)) break;
          const last = this.dazedBy.get(e.id);
          if (!last || last.kind !== e.kind || t - last.t > DAZE_RECOUNT) this.add(e.kind, 'dazed');
          this.dazedBy.set(e.id, { kind: e.kind, t });
          break;
        }
        case 'fried': if (e.by === id) this.add(e.src === 'thermite' ? 'thermite' : e.src === 'blackout' ? 'blackout' : 'shock', e.src === 'thermite' ? 'melted' : 'fried'); break;
        case 'popped': if (e.by === id && e.src === 'thermite') this.add('thermite', 'melted'); break;
        case 'bang':
          if (e.by === id && (e.kind === 'drill' || e.kind === 'impact')) this.bangs[e.kind] = { t, wall: !!e.wall, direct: !!e.direct };
          break;
        case 'decoy': if (e.by === id) this.add('decoy', 'shots'); break;
        case 'streak':
          if (e.kind === 'resupply' && e.team === this.team) { this.supplyT = t; this.supplyMine = e.id === id; }
          if (e.id !== id || !STREAKS[e.kind]) break;
          this.add(e.kind, 'uses');
          if (UP_SECS[e.kind]) this.up[e.kind] = t + UP_SECS[e.kind];
          break;
        case 'medal':
          if (e.id !== id) break;
          if (MULTI_MEDALS.has(e.medal)) {
            this.add(op, 'multi');
            if (this.lastGun && t - this.lastGunT <= 0.5) this.addGun(this.lastGun, 'multi');
          }
          if (e.medal === 'streak5') this.add(op, 'streak5');
          if (e.medal === 'longshot') this.add(op, 'long');
          if (OBJ_MEDALS.has(e.medal)) this.add(op, 'obj');
          break;
        case 'spawn': if (e.id === id) this.life = {}; break;
        case 'kill':
          if (e.assist === id) this.add(op, 'assists');
          if (e.target === id) this.life = {};
          if (e.by === id && e.target !== id) this.#kill(e, me);
          break;
      }
    }
    if (me) {
      if (op && me.alive && view.phase === 'live' && dt > 0) this.add(op, 'secs', dt);
      this.prevHp = me.alive ? me.hp : MAX_HP;
      // Juggernaut: armour lost since last frame is damage soaked. Read from the view, which carries it per player.
      const armor = me.alive ? (me.armor ?? 0) : 0;
      if (me.alive && armor < (this.prevArmor ?? 0)) this.add('juggernaut', 'soaked', this.prevArmor - armor);
      this.prevArmor = armor;
      const plates = me.alive ? (me.plates ?? 0) : 0;
      if (me.alive && this.platesOwn && plates < (this.prevPlates ?? 0)) this.add('plates', 'soaked', this.prevPlates - plates);
      this.prevPlates = plates;
    }
    this.prevT = t;
  }

  #kill(e, me) {
    const t = this.t, op = this.op, gun = !e.streak && !e.equip;
    this.killT = t;
    this.add(op, 'kills');
    if (this.prevHp < MAX_HP) this.add(op, 'hurtKills');
    if (e.head) this.add(op, 'head');
    if (gun && (e.dist ?? 99) <= CLOSE_KILL) this.add(op, 'closeKills');
    if (gun && me?.sliding) this.add(op, 'slideKills');
    for (const [k, until] of Object.entries(this.up)) if (until >= t) this.add(k, 'upKills');
    if ((me?.armor ?? 0) > 0 || (this.prevArmor ?? 0) > 0) this.add('juggernaut', 'suitKills');
    if (e.streak) {
      if (STREAKS[e.streak]) {
        this.add(e.streak, 'kills');
        if (this.#chained(`s:${e.streak}`, STREAK_MULTI_GAP)) this.add(e.streak, 'multi');
      }
      return;
    }
    for (const k of Object.keys(AFTER_SECS)) if (t - (this.used[k] ?? -99) <= AFTER_SECS[k]) this.add(k, AFTER_STAT[k]);
    if (t - (this.flashed.get(e.target) ?? -99) <= FLASH_KILL_SECS) this.add('flash', 'flashKills');
    const mk = this.marked.get(e.target);
    if (mk && mk.until >= t) this.add(mk.kind, 'markKills');
    if ((this.jammed.get(e.target) ?? -1) >= t) this.add('blackout', 'jamKills');
    if (e.equip === 'shiv' && t - this.backT <= 0.3) this.add('shiv', 'backKills');
    const dz = this.dazedBy.get(e.target);
    if (dz && t - dz.t <= DAZE_KILL_SECS) this.add(dz.kind, 'dazeKills');
    if (e.equip) {
      const k = e.equip;
      if (TACTICALS[k]) { this.add(k, 'kills'); return; }      // Gas and Shock can finish someone off.
      if (!LETHALS[k]) return;
      const bang = this.bangs[k];
      if (bang && t - bang.t <= BANG_KILL_SECS) {
        if (bang.wall) this.add(k, 'wallKills');
        if (bang.direct) this.add(k, 'directKills');
      }
      this.add(k, 'kills');
      if (this.#chained(`e:${k}`, MULTI_GAP[k] ?? 0.5)) this.add(k, 'multi');
      if ((e.dist ?? 0) >= LONG_THROW) this.add(k, 'longKills');
      if (k === 'frag' && this.fragBank && t - (this.used.frag ?? -99) <= BANK_WINDOW) this.add('frag', 'bankKills');
      return;
    }
    const w = e.weapon;
    if (!WEAPONS[w]) return;
    this.addGun(w, 'kills');
    if (this.prevHp < MAX_HP) this.addGun(w, 'hurt');
    this.life[w] = (this.life[w] ?? 0) + 1;
    if (this.life[w] === 5) this.addGun(w, 'run5');
    this.lastGun = w; this.lastGunT = t;
  }
}

/* ---------- Calling cards (V7) ---------- */
// Banners shown on the killer card and in results. Pure data: the art is drawn by js/ui/cards.js from `art`, so a new
// card is one line here. `need(c)` reads a career summary (see cardCareer in js/ui/progress.js):
// {prestige, peakLevel, level, pro:[perks], kills, head, long, slide, clean, mastered, camos:Set}.
// `art`: {p: pattern, c: [ground, mid, light, accent], e: emblem} with the emblem an icon id, `badge:<rank>` or a camo.
// `prog(c)` (optional) reads the same career and returns [value, goal]: how far a locked card is, for its progress bar.
const card = (id, name, group, req, need, art, prog) => ({ id, name, group, req, need, art, ...(prog ? { prog } : {}) });
// The closest of several routes to one card, as [value, goal].
const bestOf = (...routes) => routes.reduce((a, b) => (b[0] / b[1] > a[0] / a[1] ? b : a));
export const CARD_GROUPS = ['Starter', 'Pro', 'Prestige', 'Mastery', 'Career'];
const PRO_ART = {
  marathon: ['rails', '#1d3b2f', '#2f7a55', '#b7f5cf'], flak: ['plates', '#3a2a1c', '#7a5530', '#ffcf8a'],
  quickmend: ['cross', '#14323a', '#21747e', '#9ff2ea'], tacmask: ['hex', '#262a3a', '#4f5a85', '#c9d3ff'],
  adrenaline: ['pulse', '#3a1414', '#a12b2b', '#ff9a8a'], scavenger: ['crates', '#2e2a18', '#6c6430', '#efe08a'],
  fasthands: ['speed', '#1a2a3e', '#2c5f9e', '#a8d4ff'], strongarm: ['arc', '#30200f', '#8a4d14', '#ffc06a'],
  bandolier: ['belts', '#2b2216', '#6b5434', '#f0d39a'], hardline: ['chevrons', '#2a1838', '#6a3a8e', '#e2b8ff'],
  ghost: ['fog', '#151a22', '#3d4a5c', '#d6e2f0'], coldblood: ['frost', '#0f2233', '#2a6e99', '#bfefff'],
  deadsilence: ['waves', '#16161e', '#3a3a50', '#c6c6e6'], tracker: ['prints', '#24200f', '#5e5426', '#f5e7a0'],
  engineer: ['circuit', '#12261c', '#2b6b4a', '#9dffc8'],
};
// Default art for the mastery cards by kind: the item's own icon on a pattern in that kind's colours.
const MASTERY_CARD_ART = {
  tactical: t => ({ p: 'fog', c: ['#14222a', '#2f5868', '#cfeef6', '#7ae8ff'], e: t.icon, gold: true }),
  lethal: t => ({ p: 'plates', c: ['#2a1810', '#7a3a1c', '#ffd2a8', '#ff7a3a'], e: t.icon, gold: true }),
  streak: t => ({ p: 'chevrons', c: ['#181a30', '#3a3f7a', '#d8dcff', '#ffcf40'], e: t.icon, gold: true }),
  operator: () => ({ p: 'rails', c: ['#1e2018', '#4e553a', '#eef2d8', '#ff9f1c'], e: 'ui:operator', gold: true }),
};
export const CARDS = [
  card('yard', 'Switchyard', 'Starter', 'Every player starts with it', () => true, { p: 'hazard', c: ['#1d232b', '#39424d', '#c8ccd2', '#ff9f1c'], e: 'ui:flag' }),
  ...PERK_IDS.map(perk => card(`pro-${perk}`, PRO[perk].name, 'Pro', `${PERKS[perk].name} Pro`, c => c.pro.includes(perk),
    { p: PRO_ART[perk][0], c: [PRO_ART[perk][1], PRO_ART[perk][2], PRO_ART[perk][3], '#ffd659'], e: perk, gold: true },
    c => { const st = proStatus(perk, c.proCounts ?? {}, c.pro).steps; return [st.filter(x => x.done).length, st.length]; })),
  ...Array.from({ length: MAX_PRESTIGE }, (_, i) => i + 1).map(n => card(`prestige-${n}`, prestigeName(n), 'Prestige', `Prestige ${n}`, c => c.prestige >= n,
    { p: n >= 8 ? 'rays' : n >= 5 ? 'chevrons' : 'rails', c: PRESTIGE_ART[n - 1], e: `badge:${n}` }, c => [c.prestige ?? 0, n])),
  card('camo-gold', 'Gold Standard', 'Mastery', 'Sovereign camo on any weapon', c => c.camos.has('gold'), { p: 'rays', c: ['#3a2a08', '#b27616', '#fff4bf', '#ffd659'], e: 'camo:gold', gold: true }),
  card('mastery-5', 'Armorer', 'Mastery', 'Master 5 weapons', c => c.mastered >= 5, { p: 'plates', c: ['#2a2410', '#7a6420', '#ffe9a0', '#ffd659'], e: 'ui:gunsmith', gold: true }, c => [c.mastered, 5]),
  card('camo-molten', 'Meltdown', 'Mastery', 'Molten Core camo on any weapon', c => c.camos.has('molten'), { p: 'pulse', c: ['#1a0d0a', '#a3270a', '#ffd23f', '#ff4a0a'], e: 'camo:molten', gold: true }),
  card('camo-prism', 'Kaleidoscope', 'Mastery', 'Prism camo on any weapon', c => c.camos.has('prism'), { p: 'speed', c: ['#1c0c2a', '#5a2a9e', '#18e8ff', '#ff2bd6'], e: 'camo:prism', gold: true }),
  card('kills-100', 'Blooded', 'Career', '100 gun kills', c => c.kills >= 100, { p: 'rails', c: ['#2a1416', '#6e2a30', '#ffb0a8', '#ff5a4a'], e: 'ui:skull' }, c => [c.kills, 100]),
  card('kills-1000', 'Thousand Yard', 'Career', '1,000 gun kills', c => c.kills >= 1000, { p: 'chevrons', c: ['#2e0e12', '#8e1a26', '#ffd0c8', '#ff3040'], e: 'ui:skull', gold: true }, c => [c.kills, 1000]),
  card('head-250', 'Dead Eye', 'Career', '250 headshots', c => c.head >= 250, { p: 'rings', c: ['#101c24', '#22475c', '#bfe6ff', '#ff9f1c'], e: 'medal:headshot' }, c => [c.head, 250]),
  card('long-100', 'Long Haul', 'Career', '100 longshots', c => c.long >= 100, { p: 'speed', c: ['#13202a', '#2a4a62', '#cfe8ff', '#7cc8ff'], e: 'medal:longshot' }, c => [c.long, 100]),
  card('slide-100', 'Low Rider', 'Career', '100 slide kills', c => c.slide >= 100, { p: 'waves', c: ['#1a1830', '#3e3a7a', '#d8d4ff', '#9a8cff'], e: 'slide' }, c => [c.slide, 100]),
  card('clean-250', 'Bare Hands', 'Career', '250 equipment-free kills', c => c.clean >= 250, { p: 'plates', c: ['#1e2328', '#4a545e', '#e6ecf2', '#9aa4ad'], e: 'ui:aim' }, c => [c.clean, 250]),
  card('level-30', 'Thirty Up', 'Career', 'Reach level 30', c => c.peakLevel >= 30, { p: 'hazard', c: ['#24180a', '#5c3c14', '#ffd9a0', '#ff9f1c'], e: 'ui:rank' }, c => [c.peakLevel, 30]),
  card('pro-5', 'Pro Shop', 'Career', 'Earn 5 Pro perks', c => c.pro.length >= 5, { p: 'circuit', c: ['#221a08', '#6a5214', '#fff0b8', '#ffd659'], e: 'ui:star', gold: true }, c => [c.pro.length, 5]),
  card('pro-all', 'Full Kit', 'Career', 'Earn every Pro perk', c => c.pro.length >= PERK_IDS.length, { p: 'rays', c: ['#2a1e04', '#9c7414', '#fff8d8', '#ffd659'], e: 'ui:crown', gold: true }, c => [c.pro.length, PERK_IDS.length]),
  card('veteran', 'Old Hand', 'Career', 'Become a Veteran', c => isVeteran({ prestige: c.prestige, level: c.peakLevel, pro: c.pro }), { p: 'rings', c: ['#1c1a14', '#4e4a34', '#f2ead0', '#ff9f1c'], e: 'ui:cup' },
    c => bestOf([c.prestige ?? 0, VETERAN.prestige], [c.peakLevel, VETERAN.level], [c.pro.length, VETERAN.pro])),
  // One per mastery track, granted at its card tier (docs/PROGRESSION.md). `c.rewards` is masteryRewards(save).
  ...MASTERY_TRACKS.map(t => {
    const r = t.tiers.flatMap(c => c.rewards.map(x => ({ ...x, tier: c.tier }))).find(x => x.kind === 'card');
    return card(r.id.slice(5), r.name, 'Mastery', `${t.name} mastery tier ${r.tier}`, c => !!c.rewards?.has(r.id), MASTERY_CARD_ART[t.kind](t),
      c => [Math.min(r.tier, c.trackTiers?.[t.id] ?? 0), r.tier]);
  }),
];
export const CARD_IDS = CARDS.map(c => c.id);
export const getCard = id => CARDS.find(c => c.id === id) ?? CARDS[0];

// Ids of every card a career has earned.
export function cardsEarned(career) {
  return CARDS.filter(c => c.need(career)).map(c => c.id);
}

/* ---------- Save shape ---------- */
const DEFAULT_NAMES = ['Assault', 'Rush', 'Breach', 'Suppress', 'Overwatch'];
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const COUNT_MAX = 1e9;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v, max = COUNT_MAX) => (Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const idText = v => (typeof v === 'string' && v.length <= 24 && !UNSAFE_KEYS.has(v) ? v : '');

export function blankWeapon() {
  return { xp: 0, peak: 1, prestige: 0, kills: 0, head: 0, long: 0, slide: 0, clean: 0, owned: [], camo: 'none', tracer: 'none', killFx: 'none', lad: {}, ladT: 0 };
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
  // The ladder (v4): counters for its stats and the tiers done, which never fall.
  w.lad = cleanCounts(raw.lad, LADDER_STATS);
  w.ladT = count(raw.ladT, WEAPON_LADDER.length);
  if (w.peak >= MAX_WEAPON_LEVEL) w.ladT = advance({ tiers: WEAPON_LADDER }, { s: w.lad, t: w.ladT }).t;
  return w;
}

// {stat: n} for the listed stats, positive finite values only, at one decimal.
function cleanCounts(raw, stats) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of stats) if (Number.isFinite(raw[k]) && raw[k] > 0) out[k] = Math.min(COUNT_MAX, Math.round(raw[k] * 10) / 10);
  return out;
}

// Mastery: {track: {s, t}} for known tracks; tiers never fall, and counters that already meet a goal complete it.
function cleanMastery(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const track of MASTERY_TRACKS) {
    const r = raw[track.id];
    if (!isObj(r)) continue;
    const entry = advance(track, { s: cleanCounts(r.s, track.stats), t: count(r.t, track.tiers.length) });
    if (entry.t || Object.keys(entry.s).length) out[track.id] = entry;
  }
  return out;
}

// Skin ids look like 'skin:<operator>-<tier>' and must name the operator they are filed under; whether one exists and
// is earned is for js/ui/progress.js, which can see the roster.
const SHORT_ID = /^[a-z0-9_:.-]{1,40}$/i;
const OPERATOR_IDS_HERE = new Set(MASTERY_OPERATORS.map(o => o[0]));
function cleanSkins(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const op of Object.keys(raw)) {
    const id = raw[op];
    if (OPERATOR_IDS_HERE.has(op) && typeof id === 'string' && SHORT_ID.test(id) && id.startsWith(`skin:${op}-`)) out[op] = id;
  }
  return out;
}

// Lifetime counts: short keys, whole positive numbers, a bounded number of keys.
const LIFE_KEY = /^[a-z0-9_.:-]{1,40}$/i;
function cleanLife(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw).slice(0, 400)) if (LIFE_KEY.test(k) && !UNSAFE_KEYS.has(k) && Number.isFinite(raw[k]) && raw[k] > 0) out[k] = count(raw[k]);
  return out;
}

// Adds one match's counts into the lifetime totals.
export function addLife(save, counts = {}) {
  const life = save.life ??= {};
  for (const [k, n] of Object.entries(counts)) {
    if (!LIFE_KEY.test(k) || UNSAFE_KEYS.has(k) || !Number.isFinite(n) || n <= 0) continue;
    if (!(k in life) && Object.keys(life).length >= 400) continue;
    life[k] = Math.min(COUNT_MAX, (life[k] ?? 0) + Math.round(n));
  }
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
    pro: {}, proDone: [], card: 'yard',
    mastery: {}, granted: [],
    // Looks (save v4): the skin worn per operator and the player-card emblem, checked against what is earned where
    // they are read (js/ui/progress.js); `life` is the lifetime sum of every match's ChallengeTally counts plus
    // map:<id> and mapwon:<id>, for the map, mode and career cards.
    skins: {}, emblem: null, life: {},
    // Lifetime extractions (Extraction mode): every match this player's squad got out of. Leaderboards read it.
    extractions: 0,
  };
}

// Pro counters: {perk: {stat: n}} for known perks and the stats their challenges use; finished perks as a list.
function cleanPro(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const perk of PERK_IDS) {
    if (!isObj(raw[perk])) continue;
    const counts = {};
    for (const c of PRO_CHALLENGES[perk]) {
      const v = raw[perk][c.stat];
      if (Number.isFinite(v) && v > 0) counts[c.stat] = Math.min(COUNT_MAX, Math.round(v * 10) / 10);
    }
    if (Object.keys(counts).length) out[perk] = counts;
  }
  return out;
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
  s.pro = cleanPro(raw.pro);
  // A perk stays Pro once earned, even if its goals are retuned later; one whose counters already meet them is Pro too.
  const listed = Array.isArray(raw.proDone) ? raw.proDone : [];
  s.proDone = PERK_IDS.filter(id => listed.includes(id) || proStatus(id, s.pro, []).done);
  s.card = CARD_IDS.includes(raw.card) ? raw.card : 'yard';
  s.mastery = cleanMastery(raw.mastery);
  s.granted = Array.isArray(raw.granted) ? Object.keys(UNLOCK_CHALLENGES).filter(k => raw.granted.includes(k)) : [];
  s.skins = cleanSkins(raw.skins);
  s.emblem = typeof raw.emblem === 'string' && SHORT_ID.test(raw.emblem) ? raw.emblem : null;
  s.life = cleanLife(raw.life);
  s.extractions = count(raw.extractions);
  return s;
}

// Any stored save, of any version this build knows, to the current shape. v1 has no version field; v2 lacks the Pro
// and card fields and v3 the mastery ones, which sanitizeSave fills with defaults; anything before v4 is grandfathered
// into the v4 unlock rules so nothing it had is lost.
export function migrateSave(raw) {
  if (!isObj(raw)) return blankSave();
  if (!Number.isFinite(raw.version)) return migrateV1(raw);
  const s = sanitizeSave(raw);
  return raw.version < 4 ? grandfather(s) : s;
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

  // Everything a v1 player could equip stays equippable: the gear schedule as it stood (to 15). Guns added since
  // are earned like anyone else's.
  if (s.xp > 0 || totalKills > 0) s.peakLevel = Math.max(s.peakLevel, V1_GRANT_LEVEL);
  const primary = PRIMARY_IDS.includes(src.primary) ? src.primary : undefined;
  s.loadouts[0] = cleanLoadout({ ...(isObj(src.equipment) ? src.equipment : {}), primary, name: DEFAULT_NAMES[0] }, 0);
  return grandfather(s);
}

/* ---------- Export code: "SY4.<base64url>.<checksum>" (SY2 and SY3 codes still import) ---------- */
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
    Object.entries(s.weapons).map(([id, w]) => [id, ...GUN_STATS.map(k => w[k]), w.owned, w.camo, w.tracer, w.killFx, LADDER_STATS.map(k => w.lad?.[k] ?? 0), w.ladT ?? 0]),
    s.loadouts.map(l => [l.name, l.primary, l.secondary, l.attachments, l.perks, l.tactical, l.lethal, l.streaks, l.operator]),
    PERK_IDS.filter(id => s.pro?.[id]).map(id => [id, PRO_CHALLENGES[id].map(c => s.pro[id][c.stat] ?? 0)]),
    s.proDone ?? [], s.card ?? 'yard',
    // v4 tail: mastery counters by track (stats in the track's order), grandfathered unlocks, skins, emblem, lifetime.
    MASTERY_TRACKS.filter(t => s.mastery?.[t.id]).map(t => [t.id, s.mastery[t.id].t, t.stats.map(k => s.mastery[t.id].s[k] ?? 0)]),
    s.granted ?? [], Object.entries(s.skins ?? {}), s.emblem ?? null, Object.entries(s.life ?? {}),
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
    let ladder;
    [w.owned, w.camo, w.tracer, w.killFx, ladder, w.ladT] = g.slice(GUN_STATS.length + 1);
    if (Array.isArray(ladder)) w.lad = Object.fromEntries(LADDER_STATS.map((k, i) => [k, ladder[i]]));
    weapons[g[0]] = w;
  }
  // v3 tail: Pro counters by step, finished perks, the calling card. A v2 code simply has none of it.
  const pro = {};
  for (const row of Array.isArray(a[9]) ? a[9] : []) {
    if (!Array.isArray(row) || !PRO_CHALLENGES[row[0]] || !Array.isArray(row[1])) continue;
    pro[row[0]] = Object.fromEntries(PRO_CHALLENGES[row[0]].map((c, i) => [c.stat, row[1][i]]));
  }
  const mastery = {};
  for (const row of Array.isArray(a[12]) ? a[12] : []) {
    const track = Array.isArray(row) ? getTrack(row[0]) : null;
    if (!track || !Array.isArray(row[2])) continue;
    mastery[track.id] = { t: row[1], s: Object.fromEntries(track.stats.map((k, i) => [k, row[2][i]])) };
  }
  return {
    version, name, xp, totalXp, prestige, peakLevel, active, weapons, mastery, granted: a[13],
    skins: Array.isArray(a[14]) ? Object.fromEntries(a[14].filter(e => Array.isArray(e) && typeof e[0] === 'string' && !UNSAFE_KEYS.has(e[0]))) : {},
    emblem: a[15],
    life: Array.isArray(a[16]) ? Object.fromEntries(a[16].filter(e => Array.isArray(e) && typeof e[0] === 'string' && !UNSAFE_KEYS.has(e[0]))) : {},
    loadouts: loadouts.map(l => (Array.isArray(l) ? { name: l[0], primary: l[1], secondary: l[2], attachments: l[3], perks: l[4], tactical: l[5], lethal: l[6], streaks: l[7], operator: l[8] } : null)),
    pro, proDone: a[10], card: a[11],
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
  const version = Number(m[1]);
  if (version < 2 || version > SAVE_VERSION) return { ok: false, error: 'version' };
  if (fnv1a(m[2]) !== m[3]) return { ok: false, error: 'checksum' };
  let parsed;
  try {
    parsed = unpack(JSON.parse(fromBase64Url(m[2])));
  } catch {
    return { ok: false, error: 'data' };
  }
  if (!parsed || parsed.version !== version) return { ok: false, error: 'data' };
  return { ok: true, save: migrateSave(parsed) };
}

/* ---------- Prestige badges ---------- */
// Procedural flat-polygon emblems in a railway idiom. No gradients or filters, so no ids or defs: the same
// badge can appear many times in a page, and it stays legible at kill-feed size.

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

/* ---------- Daily and weekly challenges (V7 round 2) ---------- */
// Three daily and three weekly XP goals, drawn from one pool with a seed made of the local date, so a set stays the same
// all day (or all week, from Monday) on this phone, however often the game is opened. Every match counts, bots included;
// the firing range and the tutorial do not. ChallengeTally counts one match from the event stream, applyChallengeTally
// adds it to the stored state at the end and says what moved; js/ui/progress.js keeps the state, js/ui/challenges.js
// draws it. Goals were set from per-match rates against mixed bots: a daily is one to three matches of play that
// leans toward it, a weekly about a dozen.
export const CHALLENGE_VERSION = 1;
export const CHALLENGE_COUNT = 3;
export const CHALLENGE_PERIODS = ['daily', 'weekly'];
const CLOSE_RANGE = 8;           // Metres: a close-quarters kill (same as the Dead Silence Pro step).
const HIP_ADS = 0.3;             // ADS blend below this when the kill lands: fired from the hip.

// Categories with a gun at level 1, so a fresh player can always do the category goal of the day.
const CAT_PLURAL = { Assault: 'assault rifles', SMG: 'SMGs', Shotgun: 'shotguns', LMG: 'LMGs', Sniper: 'sniper rifles', Pistol: 'pistols' };
const CAT_GOAL = { Assault: [15, 90], SMG: [15, 90], Shotgun: [12, 70], LMG: [15, 80], Sniper: [8, 45], Pistol: [6, 35] };
const BASE_GUNS = { ar: 12, smg: 12, shotgun: 10, lmg: 12, sniper: 6, pistol: 5 };
const TEAM_RULES = new Set(['tdm', 'kc', 'dom', 'hard', 'snd', 'ctf']);    // S&D and CTF have their own rows above.

const def = (period, key, family, stat, goal, xp, icon, label) => ({ id: `${period === 'daily' ? 'd' : 'w'}.${key}`, period, family, stat, goal, xp, icon, label });

function buildPool() {
  const d = (...a) => def('daily', ...a), w = (...a) => def('weekly', ...a);
  const pool = [
    d('kills', 'kills', 'kills', 25, 1500, 'ui:skull', 'Get 25 kills'),
    d('head', 'head', 'head', 8, 2000, 'medal:headshot', 'Get 8 headshot kills'),
    d('long', 'long', 'long', 5, 2000, 'medal:longshot', 'Get 5 longshot kills'),
    d('slide', 'slide', 'slideKills', 4, 2000, 'slide', 'Get 4 kills while sliding'),
    d('hip', 'style', 'hipKills', 10, 1500, 'ui:aim', 'Get 10 kills from the hip'),
    d('close', 'style', 'closeKills', 10, 1500, 'cat:Shotgun', 'Get 10 kills within 8 m'),
    d('assist', 'team', 'assists', 6, 1500, 'ui:party', 'Get 6 assists'),
    d('equip', 'equip', 'equipKills', 2, 2000, 'frag', 'Get 2 kills with lethal equipment'),
    d('throws', 'equip', 'throws', 10, 1200, 'smoke', 'Throw 10 pieces of equipment'),
    d('called', 'streak', 'streaksCalled', 2, 2000, 'uav', 'Call in 2 scorestreaks'),
    d('streak3', 'streak', 'streak3', 2, 2000, 'medal:streak3', 'Get 2 three-kill streaks'),
    d('multi', 'multi', 'multi', 3, 2000, 'medal:double', 'Get 3 multi-kills'),
    d('wins', 'wins', 'wins', 2, 2000, 'ui:cup', 'Win 2 matches'),
    d('played', 'wins', 'played', 3, 1500, 'ui:play', 'Play 3 matches'),
    d('capture', 'obj', 'captures', 4, 2000, 'medal:capture', 'Capture 4 flags or zones'),
    d('confirm', 'obj', 'confirms', 8, 2000, 'medal:confirm', 'Confirm 8 kills in Kill Confirmed'),
    d('dom', 'mode', 'won:dom', 1, 1800, 'mode:dom', 'Win a Domination match'),
    d('hard', 'mode', 'played:hard', 2, 1500, 'mode:hard', 'Play 2 Hardpoint matches'),
    d('kc', 'mode', 'played:kc', 2, 1500, 'mode:kc', 'Play 2 Kill Confirmed matches'),
    d('plant', 'obj', 'plants', 2, 2000, 'medal:plant', 'Plant the bomb 2 times in Search and Destroy'),
    d('defuse', 'obj', 'defuses', 1, 2000, 'medal:defuse', 'Defuse the bomb in Search and Destroy'),
    d('snd', 'mode', 'won:snd', 1, 1800, 'mode:snd', 'Win a Search and Destroy match'),
    d('flagcap', 'obj', 'flagCaps', 1, 2000, 'medal:flag_capture', 'Capture a flag in Capture the Flag'),
    d('flagret', 'obj', 'flagReturns', 2, 1800, 'medal:flag_return', 'Return your flag 2 times in Capture the Flag'),
    d('ctf', 'mode', 'won:ctf', 1, 1800, 'mode:ctf', 'Win a Capture the Flag match'),
    w('kills', 'kills', 'kills', 200, 6000, 'ui:skull', 'Get 200 kills'),
    w('head', 'head', 'head', 50, 7000, 'medal:headshot', 'Get 50 headshot kills'),
    w('long', 'long', 'long', 25, 7000, 'medal:longshot', 'Get 25 longshot kills'),
    w('slide', 'slide', 'slideKills', 20, 7000, 'slide', 'Get 20 kills while sliding'),
    w('equip', 'equip', 'equipKills', 12, 6500, 'frag', 'Get 12 kills with lethal equipment'),
    w('called', 'streak', 'streaksCalled', 12, 7000, 'uav', 'Call in 12 scorestreaks'),
    w('streak5', 'streak', 'streak5', 3, 7500, 'medal:streak5', 'Get 3 five-kill streaks'),
    w('multi', 'multi', 'multi', 15, 6500, 'medal:double', 'Get 15 multi-kills'),
    w('wins', 'wins', 'wins', 10, 7500, 'ui:cup', 'Win 10 matches'),
    w('played', 'wins', 'played', 15, 6000, 'ui:play', 'Play 15 matches'),
    w('capture', 'obj', 'captures', 25, 7000, 'medal:capture', 'Capture 25 flags or zones'),
    w('bomb', 'obj', 'bombs', 10, 7000, 'medal:plant', 'Plant or defuse the bomb 10 times'),
    w('clutch', 'obj', 'clutches', 2, 7500, 'medal:clutch', 'Clutch 2 Search and Destroy rounds'),
    w('flagcap', 'obj', 'flagCaps', 6, 7500, 'medal:flag_capture', 'Capture 6 flags in Capture the Flag'),
    w('carrier', 'obj', 'carrierKills', 10, 7000, 'medal:carrier_kill', 'Kill 10 flag carriers in Capture the Flag'),
    w('assist', 'team', 'assists', 40, 6000, 'ui:party', 'Get 40 assists'),
    w('hip', 'style', 'hipKills', 60, 6000, 'ui:aim', 'Get 60 kills from the hip'),
  ];
  for (const [cat, [dg, wg]] of Object.entries(CAT_GOAL)) {
    pool.push(d(`cat.${cat}`, 'gun', `cat:${cat}`, dg, 1800, `cat:${cat}`, `Get ${dg} kills with ${CAT_PLURAL[cat]}`));
    pool.push(w(`cat.${cat}`, 'gun', `cat:${cat}`, wg, 6500, `cat:${cat}`, `Get ${wg} kills with ${CAT_PLURAL[cat]}`));
  }
  for (const [gun, goal] of Object.entries(BASE_GUNS)) {
    pool.push(d(`gun.${gun}`, 'gun', `gun:${gun}`, goal, 1800, gun, `Get ${goal} kills with the ${WEAPONS[gun].name}`));
  }
  // Modes beyond the four team rule sets (Free-for-All, Gun Game, ...) join the pool when they exist. A free-for-all
  // also brings a placing goal.
  const extra = new Map();
  for (const m of Object.values(MODES)) if (!TEAM_RULES.has(m.rules) && !extra.has(m.rules)) extra.set(m.rules, m);
  for (const [rules, m] of extra) {
    pool.push(d(`mode.${rules}`, 'mode', `played:${rules}`, 2, 1500, `mode:${m.id}`, `Play 2 ${m.name} matches`));
    if (m.ffa || rules === 'ffa') pool.push(w(`top3.${rules}`, 'mode', 'top3', 5, 6500, `mode:${m.id}`, `Finish top 3 in ${m.name} 5 times`));
  }
  return pool;
}

export const CHALLENGE_POOL = buildPool();
const POOL_BY_ID = new Map(CHALLENGE_POOL.map(c => [c.id, c]));
export const getChallenge = id => POOL_BY_ID.get(id) ?? null;

// Local calendar, not UTC: a daily turns over at the player's own midnight, a weekly at Monday 00:00.
const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function weekStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
export const dayKey = (now = new Date()) => dateKey(now);
export const periodKey = (period, now = new Date()) => (period === 'weekly' ? `W${dateKey(weekStart(now))}` : `D${dateKey(now)}`);

// When the current set is replaced, as a timestamp.
export function periodEnd(period, now = new Date()) {
  const d = period === 'weekly' ? weekStart(now) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + (period === 'weekly' ? 7 : 1));
  return d.getTime();
}

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The pool for a period in the seed's order. Same key, same order, on every device.
function shuffled(period, key) {
  const list = CHALLENGE_POOL.filter(c => c.period === period);
  const rng = seeded(hash32(key));
  for (let i = list.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [list[i], list[k]] = [list[k], list[i]];
  }
  return list;
}

// `count` ids for a period's key: no two from one family (no kills-and-more-kills days), none of `exclude`.
export function drawChallenges(period, key, { count = CHALLENGE_COUNT, exclude = [], families = [] } = {}) {
  const used = new Set(families), out = [];
  for (const c of shuffled(period, key)) {
    if (out.length >= count) break;
    if (exclude.includes(c.id) || used.has(c.family)) continue;
    used.add(c.family);
    out.push(c.id);
  }
  return out;
}

const blankPeriod = (period, now) => {
  const key = periodKey(period, now);
  return { key, ids: drawChallenges(period, key), prog: {}, done: [], retired: [] };
};

export function blankChallengeState(now = new Date()) {
  return { v: CHALLENGE_VERSION, daily: blankPeriod('daily', now), weekly: blankPeriod('weekly', now), reroll: '' };
}

// Anything to a valid state for `now`. A period whose key has passed starts over; a stored set whose challenges
// left the pool (a later build) is redrawn rather than shown half empty.
export function sanitizeChallengeState(raw, now = new Date()) {
  const s = blankChallengeState(now);
  if (!isObj(raw) || raw.v !== CHALLENGE_VERSION) return s;
  for (const period of CHALLENGE_PERIODS) {
    const r = raw[period];
    if (!isObj(r) || r.key !== s[period].key || !Array.isArray(r.ids)) continue;
    const ids = r.ids.filter(id => getChallenge(id)?.period === period);
    if (ids.length !== CHALLENGE_COUNT) continue;
    const prog = {};
    for (const id of ids) prog[id] = Math.min(getChallenge(id).goal, count(r.prog?.[id]));
    s[period] = {
      key: r.key, ids, prog,
      done: ids.filter(id => prog[id] >= getChallenge(id).goal),
      retired: Array.isArray(r.retired) ? r.retired.filter(id => getChallenge(id)?.period === period).slice(0, 20) : [],
    };
  }
  s.reroll = typeof raw.reroll === 'string' && raw.reroll === dayKey(now) ? raw.reroll : '';
  return s;
}

// [{...definition, value, done}] for one period, in display order.
export function challengeList(state, period) {
  const p = state[period];
  return p.ids.map(id => {
    const c = getChallenge(id), value = Math.min(c.goal, p.prog[id] ?? 0);
    return { ...c, value, done: value >= c.goal };
  });
}

export const canReroll = (state, now = new Date()) => state.reroll !== dayKey(now);

// Swaps one unfinished challenge for a fresh draw from the same period. One reroll a day, daily or weekly. The new
// one is seeded from the period key and the swaps so far, so it is the same on a second look. Returns the new id or null.
export function rerollChallenge(state, id, now = new Date()) {
  const period = getChallenge(id)?.period;
  if (!period || !canReroll(state, now)) return null;
  const p = state[period];
  const i = p.ids.indexOf(id);
  if (i < 0 || p.done.includes(id)) return null;
  const others = p.ids.filter(x => x !== id);
  const [next] = drawChallenges(period, `${p.key}:r${p.retired.length + 1}`, {
    count: 1, exclude: [...p.ids, ...p.retired], families: others.map(x => getChallenge(x).family),
  });
  if (!next) return null;
  p.retired.push(id);
  p.ids[i] = next;
  delete p.prog[id];
  p.prog[next] = 0;
  state.reroll = dayKey(now);
  return next;
}

// Counts what the local player did in one match, for the challenges. Pure, like ProTracker: feed onEvents(events,
// view) every frame, then finish({won, place}) once. counts() is {stat: n}.
export class ChallengeTally {
  constructor(localId) {
    this.id = localId;
    this.n = {};
    this.rules = null;
  }

  add(stat, k = 1) { this.n[stat] = (this.n[stat] ?? 0) + k; }

  onEvents(events, view) {
    const id = this.id;
    const mode = view?.modeId ?? view?.mode;
    if (mode) this.rules = modeRules(mode);
    let me = null;
    for (const e of events) {
      switch (e.t) {
        case 'kill': {
          if (e.assist === id) this.add('assists');
          if (e.by !== id || e.target === id) break;
          this.add('kills');
          if (e.streak) { this.add('streakKills'); break; }
          if (e.equip) { if (LETHALS[e.equip]) this.add('equipKills'); break; }
          me ??= view?.players?.find(p => p.id === id) ?? {};
          const cat = WEAPON_CATEGORY[e.weapon];
          if (cat) this.add(`cat:${cat}`);
          this.add(`gun:${e.weapon}`);
          if (e.head) this.add('head');
          if ((e.dist ?? 0) >= longshotDist(e.weapon)) this.add('long');
          if ((e.dist ?? 99) <= CLOSE_RANGE) this.add('closeKills');
          if (me.sliding) this.add('slideKills');
          if ((me.adsT ?? 1) < HIP_ADS) this.add('hipKills');
          break;
        }
        case 'medal':
          if (e.id !== id) break;
          if (MULTI_MEDALS.has(e.medal)) this.add('multi');
          else if (e.medal === 'streak3' || e.medal === 'streak5') this.add(e.medal);
          else if (e.medal === 'capture') this.add('captures');
          else if (e.medal === 'confirm') this.add('confirms');
          else if (e.medal === 'plant' || e.medal === 'defuse') { this.add(`${e.medal}s`); this.add('bombs'); }
          else if (e.medal === 'clutch') this.add('clutches');
          else if (e.medal === 'flag_capture') { this.add('flagCaps'); this.add('captures'); }
          else if (e.medal === 'flag_return') this.add('flagReturns');
          else if (e.medal === 'carrier_kill') this.add('carrierKills');
          break;
        case 'slide': if (e.id === id) this.add('slides'); break;
        case 'throw': if (e.id === id) this.add('throws'); break;
        case 'snd': {
          // A Search and Destroy round won by this player's side (operator challenges read it from the lifetime tally).
          if (e.kind !== 'end' || e.winner == null) break;
          me ??= view?.players?.find(p => p.id === id) ?? {};
          if (me.team != null && e.winner === me.team) this.add('sndRounds');
          break;
        }
        case 'streak': if (e.id === id) this.add('streaksCalled'); break;
      }
    }
  }

  finish({ won = false, place = null } = {}) {
    const rules = this.rules ?? 'tdm';
    this.add('played');
    this.add(`played:${rules}`);
    if (won) { this.add('wins'); this.add(`won:${rules}`); }
    if (place !== null && place <= 3) this.add('top3');
    return this.n;
  }

  counts() { return this.n; }
}

// Adds one match into the state (already rolled over to `now`). Returns the challenges that moved, in display order,
// daily first: [{id, period, label, icon, goal, xp, before, value, done, fresh}], and the XP the finished ones pay.
export function applyChallengeTally(state, counts, now = new Date()) {
  const moved = [];
  let xp = 0;
  for (const period of CHALLENGE_PERIODS) {
    const p = state[period];
    for (const id of p.ids) {
      const c = getChallenge(id);
      const gain = counts?.[c.stat] ?? 0;
      const before = Math.min(c.goal, p.prog[id] ?? 0);
      if (!(gain > 0) || before >= c.goal) continue;
      const value = Math.min(c.goal, before + Math.round(gain));
      p.prog[id] = value;
      const fresh = value >= c.goal;
      if (fresh) { p.done.push(id); xp += c.xp; }
      moved.push({ id, period, label: c.label, icon: c.icon, goal: c.goal, xp: c.xp, before, value, done: fresh, fresh });
    }
  }
  return { moved, xp };
}

/* ---------- Match history (V7 round 2) ---------- */
// The last HISTORY_MAX matches, newest first, built by MatchAwards at the end of each match and kept by
// js/ui/progress.js. Versioned: a store from another version starts over.
export const HISTORY_VERSION = 1;
export const HISTORY_MAX = 20;
const RESULTS = ['win', 'loss', 'draw'];

// Anything to one valid entry, or null.
export function cleanHistoryEntry(raw) {
  if (!isObj(raw) || !Number.isFinite(raw.at)) return null;
  const n = v => count(v, 1e6);
  const guns = Array.isArray(raw.guns) ? raw.guns.filter(g => isObj(g) && WEAPONS[g.id]).slice(0, 6)
    .map(g => ({ id: g.id, kills: n(g.kills), head: n(g.head), secs: n(g.secs) })) : [];
  const done = Array.isArray(raw.challenges) ? raw.challenges.filter(c => isObj(c) && getChallenge(c.id))
    .slice(0, 6).map(c => ({ id: c.id, xp: n(c.xp) })) : [];
  return {
    at: raw.at, map: idText(raw.map) || 'railyard', mode: idText(raw.mode) || 'tdm',
    result: RESULTS.includes(raw.result) ? raw.result : 'draw',
    place: Number.isFinite(raw.place) ? n(raw.place) : null, field: n(raw.field),
    team: Number.isFinite(raw.team) ? n(raw.team) : 0,
    scores: Array.isArray(raw.scores) ? raw.scores.slice(0, 2).map(n) : [0, 0],
    kills: n(raw.kills), deaths: n(raw.deaths), assists: n(raw.assists), score: n(raw.score),
    head: n(raw.head), long: n(raw.long), medals: n(raw.medals), obj: n(raw.obj),
    xp: n(raw.xp), level: Math.max(1, n(raw.level)), levelUp: !!raw.levelUp, mvp: !!raw.mvp,
    bots: n(raw.bots), humans: n(raw.humans), secs: n(raw.secs), guns, challenges: done,
  };
}

export function cleanHistory(raw) {
  if (!isObj(raw) || raw.v !== HISTORY_VERSION || !Array.isArray(raw.list)) return { v: HISTORY_VERSION, list: [] };
  return { v: HISTORY_VERSION, list: raw.list.map(cleanHistoryEntry).filter(Boolean).slice(0, HISTORY_MAX) };
}
