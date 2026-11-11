/* Progress API (Wave 2). `w` is a weapon id, `i` a loadout index 0..4, `slot` optic|barrel|mag|grip.
 * setCamo/setTracer/setKillFx/setAttachment return false and change nothing when the item is locked.
 * Identity   name (get/set)  primary (get/set: active loadout's gun)  flag(n)  setFlag(n)
 * Player     xp  level  prestige  totalXp  levelProgress() -> {level,into,span,maxed,prestige}
 *            canPrestige()  doPrestige() -> {ok,prestige,badge}   badge() -> {prestige,level} (for roster)
 *            addXp(n) -> {before,after,xp}   (MatchAwards owns match XP; do not also add it in main.js)
 * Badges     import { badgeSvg, prestigeName, MAX_PRESTIGE } from '../shared/progression.js'
 *            badgeSvg(prestige, size=48) -> SVG markup string, safe to inline repeatedly (no ids/defs).
 * Unlocks    itemUnlockLevel(kind,id)  isItemUnlocked(kind,id)  unlockSchedule() -> [{level,kind,id,name}]
 *            kind: 'weapon'|'perk'|'tactical'|'lethal'|'streak'. Locked guns are replaced in loadout()/loadouts().
 * Weapons    weaponLevel(w)  weaponProgress(w) -> {level,into,span,maxed,prestige}  weaponPrestige(w)
 *            canPrestigeWeapon(w)  prestigeWeapon(w) -> {ok,prestige,rewards[]}
 *            attachments(w) -> [{...attachmentDef,unlockLevel,unlocked}]  isAttachmentUnlocked(w,id)
 * Cosmetics  camos(w) -> [{camo,unlocked,requirement}]  camo(w)  setCamo(w,id)  isUnlocked(w,camoId)
 *            tracers(w) / killEffects(w) -> [{item,unlocked,requirement}]
 *            tracer(w)  setTracer(w,id)  killFx(w)  setKillFx(w,id)
 * Challenges challenges(w) -> [{id,track,label,goal,value,done,camo}]  isMastered(w)  kills(w)  weaponStats(w)
 * Operators  operators() -> [{op,unlocked,requirement,value,goal}]  isOperatorUnlocked(id)  setOperator(i,id) -> bool
 *            Each loadout's operator is `loadout.operator`, in loadouts() and loadout().
 * Loadouts   loadouts() -> 5 x {name,primary,secondary,attachments:{weapon:kit},perks,tactical,lethal,streaks,camo,tracer,killFx}
 *            activeLoadout (get/set index)  loadout(primary?) -> the full loadout for a match or roster
 *            updateLoadout(i,part)  renameLoadout(i,name)  setAttachment(i,slot,id|null,weapon=loadout primary) -> bool
 *            kitFor(i,weapon) -> the unlocked kit loadout i keeps for any gun, equipped or not
 *            setEquipment(part)  (edits the active loadout)
 * Save       exportCode() -> string   importCode(code) -> {ok:true}|{ok:false,error:'format'|'checksum'|'version'|'data'}
 * Pro        proStatus(perk) -> {perk,name,desc,steps:[{stat,label,goal,value,done}],done}  isPro(perk)  proPerks() -> [ids]
 *            Challenge rules and the Pro list live in js/shared/progression.js (PRO_CHALLENGES) and catalog.js (PRO).
 * Cards      cards() -> [{card,unlocked,equipped,progress:{value,goal}|null}]  card (get) -> equipped id  setCard(id) -> bool
 *            isVeteran()  identity() -> {pro:[ids], card, veteran}. loadout() carries `pro` and `card` to the roster.
 * Golden     goldenStatus() -> {earned, steps:[{id,label,value,goal,done}], requirement}  goldenEarned()
 *            goldenPending() -> true once, until markGoldenCelebrated(), when it has been earned and not yet shown
 *            debugGrantGolden(on=true) -> bool: ?debug=1 only (window.__game.Progress), for testing
 *            isItemUnlocked('weapon','golden') follows goldenEarned(). applyMatch, doPrestige and prestigeWeapon
 *            report it ({kind:'weapon', id:'golden', golden:true} first in unlocks; golden:true on the prestige results).
 * Mastery    mastery(trackId) / masteryAll(kind?) -> trackStatus shape (js/shared/progression.js), tracks: every tactical,
 *            lethal, streak and operator id.   weaponLadder(w) -> the same plus `open` (weapon level 30 reached)
 *            unlockChallenge(kind,id) -> {label,goal,value,done}|null   lockText(kind,id) -> what a locked item needs
 *            hasReward(id)  rewards() -> Set ('card:..','skin:..','badge:..')  badges() -> [{id,item,grade,name,kind}]
 *            skins(op) -> [{id:'skin:<op>-3'|'skin:<op>-5',tier,name,unlocked,requirement}] (the operator
 *            store in js/ui/operators.js keeps which skin is worn; hasReward is its `granted`)
 *            masteryXp(gains) -> XP the tiers those gains finish would pay (dry run)   lastMastery() -> last match's moved rows
 * Looks      operatorSkin(op) -> skin id|null  setOperatorSkin(op, id|null) -> bool (any earned skin of that operator)
 *            emblem() -> earned emblem id|null  setEmblem(id|null) -> bool   loadout() carries `skin` and `emblem`.
 *            Stored in the save (and its codes); js/ui/operators.js's own store is kept as a mirror.
 * Lifetime   lifetime() -> {stat: n} every match's ChallengeTally counts plus map:<id>, mapwon:<id>
 * Match      applyMatch(summary)  used by js/game/awards.js only. Summary may carry `mastery` (MasteryTracker.gains()).
 * Removed    recordKill(w) stays as a no-op returning []. MatchAwards counts kills now; hud.js should drop the call.
 *
 * Challenges (own versioned key; rules in js/shared/progression.js)
 *            Challenges.list(period) -> [{id,period,label,icon,goal,xp,value,done}]  period: 'daily'|'weekly'
 *            Challenges.endsAt(period) -> ms   canReroll()   reroll(id) -> new id | null
 *            Challenges.apply(counts) -> {moved, xp}   used by js/game/awards.js only; it pays the XP through applyMatch.
 * History    MatchHistory.list() -> newest first, at most 20 (cleanHistoryEntry shape)   add(entry)   clear()
 */

// Everything that outlives a match, in one versioned localStorage save. Private browsing can throw on any
// access, so every read and write tolerates failure and the game simply plays without persistence.
// The rules live in js/shared/progression.js; this module owns the save and applies them.
import { CAMOS, TRACERS, KILL_EFFECTS, getTracer, getKillEffect } from '../shared/camos.js';
import { GOLDEN_ID, PRIMARY_IDS, SECONDARY_IDS } from '../shared/constants.js';
import { normalizeLoadout, SCORE } from '../shared/catalog.js';
import { OPERATORS, DEFAULT_OPERATOR, OPERATOR_IDS, operatorUnlock, getOperator, getSkin, skinUnlock, localSkin, setLocalSkin, equippedEmblem, setEmblemChoice } from './operators.js';
import { getEmblem, emblemUnlocked } from './emblems.js';
import { WEAPONS } from '../shared/weapons.js';
import { SLOTS, ATTACHMENTS, availableFor, attachmentsFor, normalizeKit, unlockFor, unlockMet } from '../shared/attachments.js';
import {
  SAVE_VERSION, LOADOUT_COUNT, MAX_LEVEL, MAX_PRESTIGE, MAX_WEAPON_LEVEL, MAX_WEAPON_PRESTIGE,
  PLAYER_CURVE, WEAPON_CURVE, UNLOCK_SCHEDULE, ITEM_TABLES, levelOf, itemUnlockLevel, gateLoadoutGear,
  challengesFor, isMastered, camoGateOpen, camoRequirement, cosmeticRequirement, prestigeRewards,
  blankWeapon, blankSave, sanitizeSave, migrateV1, migrateSave, cleanLoadout, encodeSave, decodeSave, badgeSvg,
  proStatus, applyProGains, isVeteran, CARDS, CARD_IDS, cardsEarned, getCard,
  sanitizeChallengeState, challengeList, canReroll, rerollChallenge, applyChallengeTally, periodEnd, CHALLENGE_PERIODS,
  cleanHistory, cleanHistoryEntry, HISTORY_VERSION, HISTORY_MAX, goldenStatus, GOLDEN_REQUIREMENT,
  MASTERY_TRACKS, getTrack, trackStatus, ladderStatus, masteryRewards, operatorSkins, applyMasteryGains,
  unlockChallenge, itemOpen, UNLOCK_CHALLENGES, addLife,
} from '../shared/progression.js';
import { PERK_IDS, PERKS } from '../shared/catalog.js';
import { WEAPON_IDS } from '../shared/constants.js';

export { levelOf };

const KEY = 'switchyard.save';
const V1_KEY = 'switchyard.progress.v1';   // Left in place after migration as a backup.
const BAD_KEY = 'switchyard.save.bad';     // Last save we could not read, or one written by a newer build.
const BAK_KEY = 'switchyard.save.bak';     // The save an import replaced.

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function parse(raw) {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function migrateAndStore(v1) {
  const s = migrateV1(v1);
  write(KEY, JSON.stringify(s));
  return s;
}

function load() {
  const raw = read(KEY);
  if (raw !== null) {
    const parsed = parse(raw);
    if (parsed) {
      if (parsed.version === SAVE_VERSION) return keepOperators(sanitizeSave(parsed), parsed);
      if (parsed.version > SAVE_VERSION) { write(BAD_KEY, raw); return keepOperators(sanitizeSave(parsed), parsed); }
      if (Number.isFinite(parsed.version)) {
        // An older versioned save (v2): every field carries over, the new ones start at their defaults.
        const s = keepOperators(migrateSave(parsed), parsed);
        write(KEY, JSON.stringify(s));
        return s;
      }
      return migrateAndStore(parsed);      // No version: the old format under the new key.
    }
    write(BAD_KEY, raw);
  }
  const v1 = parse(read(V1_KEY));
  return v1 ? migrateAndStore(v1) : blankSave();
}

// cleanLoadout (shared) keeps only the fields it knows about, so operators are re-read from the raw save here.
function keepOperators(s, raw) {
  if (Array.isArray(raw?.loadouts)) {
    raw.loadouts.forEach((l, i) => { if (s.loadouts[i] && OPERATOR_IDS.includes(l?.operator)) s.loadouts[i].operator = l.operator; });
  }
  return s;
}

let data = load();
syncLooks(true);

// Skins and the emblem used to live only in js/ui/operators.js's own store (switchyard.custom.v1). The save is the real
// home now, so they sync and travel in save codes; that store stays a mirror, since cards.js still reads it. On load a
// pick only the mirror has is folded into the save; after an import the save's picks are pushed to the mirror.
function syncLooks(fold) {
  let changed = false;
  for (const op of OPERATOR_IDS) {
    const local = localSkin(op);
    if (fold && local && !data.skins[op] && getSkin(local)?.tier !== 'base') { data.skins[op] = getSkin(local).id; changed = true; }
    else if (!fold && (data.skins[op] ?? null) !== local) setLocalSkin(op, data.skins[op] ?? null);
  }
  const em = equippedEmblem();
  if (fold && em && !data.emblem) { data.emblem = em; changed = true; }
  else if (data.emblem && data.emblem !== em) setEmblemChoice(data.emblem);
  if (changed) save();
}

// The Golden Gun's test hook only exists with ?debug=1 in the address; a flag left in a save does nothing without it.
const DEBUG = (() => { try { return new URLSearchParams(globalThis.location?.search ?? '').get('debug') === '1'; } catch { return false; } })();
// Once earned it stays earned, even when new guns join the requirement: the reveal having been shown proves it.
const goldenEarned = () => goldenStatus(data).earned || !!data.flags.goldenShown || (DEBUG && !!data.flags.goldenDebug);
const GOLDEN_UNLOCK = () => ({ kind: 'weapon', id: GOLDEN_ID, name: WEAPONS[GOLDEN_ID].name, golden: true, req: GOLDEN_REQUIREMENT });

function save() {
  write(KEY, JSON.stringify(data));
}

const isOpen = (kind, id) => itemOpen(data, kind, id);
let lastMastery = [];

// Points a player earned over the whole match. PlayerView.score cannot serve here because it resets when a streak is cashed in.
export function matchScore(p) {
  return (p.kills ?? 0) * SCORE.kill + (p.head ?? 0) * SCORE.headshot + (p.assists ?? 0) * SCORE.assist
    + (p.confirms ?? 0) * SCORE.confirm + (p.captures ?? 0) * SCORE.capture;
}

function gainXp(amount) {
  const gain = Math.max(0, Math.round(Number(amount) || 0));
  data.xp = Math.min(PLAYER_CURVE.cap, data.xp + gain);
  data.totalXp += gain;
  data.peakLevel = Math.max(data.peakLevel, levelOf(data.xp));
}

const BLANK_WEAPON = Object.freeze(blankWeapon());

const readWeapon = w => data.weapons[w] ?? BLANK_WEAPON;
const writeWeapon = w => (data.weapons[w] ??= blankWeapon());
const activeSlot = () => data.loadouts[data.active];
const validIndex = i => Number.isInteger(i) && i >= 0 && i < LOADOUT_COUNT;

// The Golden Gun is gold, always: no camo, tracer or kill effect but its own.
const plainOnly = w => w === GOLDEN_ID;
const hasCamo = (w, camo) => (plainOnly(w) ? camo.id === 'none' : readWeapon(w).owned.includes(camo.id) || camoGateOpen(camo, readWeapon(w), data.life));
const hasCosmetic = (w, item) => (plainOnly(w) ? !item.prestige : readWeapon(w).prestige >= item.prestige);
// V11: an unlock above 30 is a mastery ladder tier (attachments.js LADDER_BASE), met by the gun's ladT.
const hasAttachment = (w, id) => {
  const level = unlockFor(w, id);
  return level !== null && unlockMet(level, readWeapon(w));
};

// Only what the player can use actually goes into a match, so a stale selection simply falls back.
function gatedKits(loadout) {
  const out = {};
  for (const weapon of [loadout.primary, loadout.secondary]) {
    const kit = {};
    const fitted = attachmentsFor(loadout, weapon);
    for (const slot of SLOTS) if (fitted[slot] && hasAttachment(weapon, fitted[slot])) kit[slot] = fitted[slot];
    if (Object.keys(kit).length) out[weapon] = normalizeKit(weapon, kit);
  }
  return out;
}

function careerStats() {
  const c = { level: data.peakLevel, prestige: data.prestige, kills: 0, head: 0, long: 0, slide: 0, clean: 0, life: data.life ?? {} };
  for (const w of Object.values(data.weapons)) for (const k of ['kills', 'head', 'long', 'slide', 'clean']) c[k] += w[k] ?? 0;
  return c;
}

const operatorOpen = (id, career = careerStats()) => OPERATOR_IDS.includes(id) && operatorUnlock(getOperator(id), career).unlocked;

const gunOpen = id => !!WEAPONS[id] && (id === GOLDEN_ID ? goldenEarned() : isOpen('weapon', id));

// A gun past the player's level falls back to the first one they own in that slot, so a stale save, an imported code or
// a stray caller can never take a locked gun into a match.
function gateGun(id, list, fallback) {
  if (gunOpen(id)) return id;
  return gunOpen(fallback) ? fallback : list.find(gunOpen) ?? fallback;
}

// Every weapon's own camo, tracer and kill effect, for modes that change your gun mid-match (Gun Game).
function weaponCosmetics() {
  const camos = {}, tracers = {}, killFxs = {};
  for (const w of WEAPON_IDS) {
    const c = Progress.camo(w), t = Progress.tracer(w), k = Progress.killFx(w);
    if (c && c !== 'none') camos[w] = c;
    if (t && t !== 'none') tracers[w] = t;
    if (k && k !== 'none') killFxs[w] = k;
  }
  return { camos, tracers, killFxs };
}

function matchLoadout(saved, wanted = saved.primary) {
  const primary = gateGun(wanted, PRIMARY_IDS, 'ar');
  const secondary = gateGun(saved.secondary, SECONDARY_IDS, 'pistol');
  const base = normalizeLoadout({ ...saved, primary, secondary, attachments: saved.attachments });
  const gear = gateLoadoutGear(base, isOpen);    // One perk per tier, through catalog gatePerks.
  return {
    ...gear,
    name: saved.name,
    attachments: gatedKits(gear),
    camo: Progress.camo(primary),
    tracer: Progress.tracer(primary),
    killFx: Progress.killFx(primary),
    ...weaponCosmetics(),
    operator: operatorOpen(saved.operator) ? saved.operator : DEFAULT_OPERATOR,
    skin: equippedSkin(operatorOpen(saved.operator) ? saved.operator : DEFAULT_OPERATOR),
    emblem: currentEmblemId(),
    pro: data.proDone.slice(),
    card: equippedCard(),
  };
}

// What the calling cards are judged on. Mastery camos count on any weapon.
const MASTERY_CAMOS = CAMOS.filter(c => c.mastery);
function cardCareer() {
  const c = careerStats();
  const camos = new Set();
  for (const camo of MASTERY_CAMOS) if (WEAPON_IDS.some(w => hasCamo(w, camo))) camos.add(camo.id);
  const trackTiers = {};
  for (const [id, e] of Object.entries(data.mastery ?? {})) trackTiers[id] = e?.t ?? 0;
  return { ...c, peakLevel: data.peakLevel, pro: data.proDone, proCounts: data.pro, trackTiers, mastered: WEAPON_IDS.filter(w => isMastered(readWeapon(w))).length, camos, rewards: masteryRewards(data) };
}

// The career the operator skins and emblems are judged on (js/ui/operators.js skinUnlock, js/ui/emblems.js).
function looksCareer() {
  const c = cardCareer(), camoOn = {};
  for (const camo of MASTERY_CAMOS) camoOn[camo.id] = WEAPON_IDS.filter(w => hasCamo(w, camo)).length;
  return { ...c, level: data.peakLevel, life: data.life, camoOn, granted: id => c.rewards.has(id) };
}

// The skin worn on an operator: the saved pick while it is still earned, else null (the issue look).
function equippedSkin(op) {
  const skin = getSkin(data.skins[op]);
  return skin && skin.operator === op && skin.tier !== 'base' && skinUnlock(skin, looksCareer()).unlocked ? skin.id : null;
}

function currentEmblemId() {
  if (equippedEmblem() !== data.emblem) { data.emblem = equippedEmblem(); save(); }   // Picked through the mirror.
  const e = getEmblem(data.emblem);
  return e && emblemUnlocked(e, looksCareer()).unlocked ? e.id : null;
}

// Gated items that are open now, as 'kind:id', to find the ones a match opened.
const openGated = () => new Set(Object.keys(UNLOCK_CHALLENGES).filter(k => isOpen(...k.split(':'))));

// How far a locked card is: {value, goal}, or null for a card with nothing to count.
function cardProgress(card, career) {
  if (!card.prog) return null;
  try {
    const [value, goal] = card.prog(career);
    return Number.isFinite(value) && goal > 0 ? { value: Math.max(0, Math.min(goal, Math.floor(value))), goal } : null;
  } catch { return null; }
}

function equippedCard() {
  return cardsEarned(cardCareer()).includes(data.card) ? data.card : 'yard';
}

function weaponDiffBase(w) {
  const before = readWeapon(w);
  return {
    level: WEAPON_CURVE.levelOf(before.xp),
    peak: before.peak,
    ladT: before.ladT ?? 0,
    camos: new Set(CAMOS.filter(c => hasCamo(w, c)).map(c => c.id)),
  };
}

export const Progress = {
  get name() { return data.name; },
  set name(v) { data.name = String(v).slice(0, 12); save(); },

  get primary() { return activeSlot().primary; },
  set primary(v) {
    if (!PRIMARY_IDS.includes(v)) return;
    this.updateLoadout(data.active, { primary: v });
  },

  flag(name) { return !!data.flags[name]; },
  setFlag(name) { data.flags[name] = true; save(); },

  /* ---------- Player ---------- */
  get xp() { return data.xp; },
  get totalXp() { return data.totalXp; },
  get level() { return levelOf(data.xp); },
  get prestige() { return data.prestige; },

  levelProgress() {
    return { ...PLAYER_CURVE.progress(data.xp), prestige: data.prestige };
  },

  addXp(amount) {
    const before = levelOf(data.xp);
    gainXp(amount);
    save();
    return { before, after: levelOf(data.xp), xp: data.xp };
  },

  canPrestige() {
    return levelOf(data.xp) >= MAX_LEVEL && data.prestige < MAX_PRESTIGE;
  },

  // Resets the level only. Unlocks read peakLevel, which never falls.
  doPrestige() {
    if (!this.canPrestige()) return { ok: false, prestige: data.prestige, badge: badgeSvg(data.prestige) };
    const had = goldenEarned();
    data.prestige++;
    data.xp = 0;
    save();
    return { ok: true, prestige: data.prestige, badge: badgeSvg(data.prestige), golden: !had && goldenEarned() };
  },

  badge() {
    return { prestige: data.prestige, level: levelOf(data.xp) };
  },

  /* ---------- Unlocks ---------- */
  itemUnlockLevel,
  isItemUnlocked(kind, id) {
    if (kind === 'weapon' && id === GOLDEN_ID) return goldenEarned();
    return isOpen(kind, id);
  },
  unlockChallenge(kind, id) { return unlockChallenge(data, kind, id); },
  // What a locked item still needs, in one line: the level first, then its challenge with the count so far.
  lockText(kind, id) {
    const level = itemUnlockLevel(kind, id);
    if (level > data.peakLevel) {
      const c = unlockChallenge(data, kind, id);
      return c ? `Level ${level}, then ${c.label.charAt(0).toLowerCase()}${c.label.slice(1)}` : `Reach level ${level}`;
    }
    const c = unlockChallenge(data, kind, id);
    return c && !c.done ? `${c.label} (${c.value}/${c.goal})` : '';
  },

  /* ---------- Mastery ---------- */
  mastery(id) {
    const track = getTrack(id);
    return track ? trackStatus(track, data.mastery[id]) : null;
  },
  masteryAll(kind) {
    return MASTERY_TRACKS.filter(t => !kind || t.kind === kind).map(t => trackStatus(t, data.mastery[t.id]));
  },
  weaponLadder(w) { return ladderStatus(w, readWeapon(w)); },
  hasReward(id) { return masteryRewards(data).has(id); },
  rewards() { return masteryRewards(data); },
  // Emblem badges earned: {id, item, grade (1 bronze, 2 gold), name, kind}, best grade per item only.
  badges() {
    const got = masteryRewards(data), out = new Map();
    const tracks = [...MASTERY_TRACKS.map(t => [t, t.tiers]), ...WEAPON_IDS.filter(w => readWeapon(w).ladT).map(w => { const s = this.weaponLadder(w); return [s, s.tiers]; })];
    for (const [t, tiers] of tracks) {
      for (const c of tiers) for (const r of c.rewards) {
        if (r.kind !== 'badge' || !got.has(r.id)) continue;
        const grade = Number(r.id.slice(r.id.lastIndexOf('-') + 1));
        if ((out.get(t.item)?.grade ?? 0) < grade) out.set(t.item, { id: r.id, item: t.item, grade, name: r.name, kind: t.kind });
      }
    }
    return [...out.values()];
  },
  // Any skin of that operator that is earned (field skins by their career rule, mastery ones by their tier); null or
  // a base id goes back to the issue look.
  operatorSkin(op) { return equippedSkin(op); },
  setOperatorSkin(op, id) {
    const skin = id === null ? null : getSkin(id);
    if (!OPERATOR_IDS.includes(op) || (id !== null && (!skin || skin.operator !== op))) return false;
    if (skin && skin.tier !== 'base' && !skinUnlock(skin, looksCareer()).unlocked) return false;
    if (!skin || skin.tier === 'base') delete data.skins[op]; else data.skins[op] = skin.id;
    setLocalSkin(op, data.skins[op] ?? null);
    save();
    return true;
  },
  emblem() { return currentEmblemId(); },
  setEmblem(id) {
    const e = id === null ? null : getEmblem(id);
    if (id !== null && (!e || !emblemUnlocked(e, looksCareer()).unlocked)) return false;
    data.emblem = e ? e.id : null;
    setEmblemChoice(data.emblem);
    save();
    return true;
  },
  // Lifetime totals of every match's challenge counts (kills, plants, won:dom, played:ctf, ...) plus map:<id> (played
  // there) and mapwon:<id>, for the map, mode and career cards.
  lifetime() { return { ...data.life }; },
  extractions() { return data.extractions ?? 0; },
  skins(op) {
    const got = masteryRewards(data);
    return operatorSkins(op).map(k => ({ ...k, unlocked: got.has(k.id), requirement: `${getTrack(op)?.name ?? op} mastery tier ${k.tier}` }));
  },
  // What the tiers these gains would finish pay, without touching the save (MatchAwards adds it to the match XP).
  masteryXp(gains) {
    const copy = { mastery: structuredClone(data.mastery), weapons: structuredClone(data.weapons) };
    return applyMasteryGains(copy, gains).xp;
  },
  lastMastery(list) {
    if (Array.isArray(list)) lastMastery = list;
    return lastMastery;
  },

  /* ---------- The Golden Gun ---------- */
  goldenEarned() { return goldenEarned(); },
  goldenStatus() { return { ...goldenStatus(data), earned: goldenEarned(), requirement: GOLDEN_REQUIREMENT }; },
  // The armory plays the reveal once per device, the first time it opens after the gun is earned.
  goldenPending() { return goldenEarned() && !data.flags.goldenShown; },
  markGoldenCelebrated() { if (!data.flags.goldenShown) this.setFlag('goldenShown'); },
  debugGrantGolden(on = true) {
    if (!DEBUG) return false;
    if (on) data.flags.goldenDebug = true; else { delete data.flags.goldenDebug; delete data.flags.goldenShown; }
    save();
    return goldenEarned();
  },

  unlockSchedule() {
    return UNLOCK_SCHEDULE.map(u => ({ ...u, name: ITEM_TABLES[u.kind]?.[u.id]?.name ?? u.id }));
  },

  /* ---------- Weapons ---------- */
  weaponLevel(w) { return WEAPON_CURVE.levelOf(readWeapon(w).xp); },
  weaponPrestige(w) { return readWeapon(w).prestige; },
  weaponProgress(w) {
    return { ...WEAPON_CURVE.progress(readWeapon(w).xp), prestige: readWeapon(w).prestige };
  },

  canPrestigeWeapon(w) {
    return this.weaponLevel(w) >= MAX_WEAPON_LEVEL && readWeapon(w).prestige < MAX_WEAPON_PRESTIGE;
  },

  // Resets that weapon's level. Attachments read peak, which never falls; challenge counters are untouched.
  prestigeWeapon(w) {
    if (!this.canPrestigeWeapon(w)) return { ok: false, prestige: readWeapon(w).prestige, rewards: [] };
    const had = goldenEarned();
    const entry = writeWeapon(w);
    entry.prestige++;
    entry.xp = 0;
    save();
    return { ok: true, prestige: entry.prestige, rewards: prestigeRewards(entry.prestige), golden: !had && goldenEarned() };
  },

  attachments(w) {
    return availableFor(w).map(a => {
      const unlockLevel = unlockFor(w, a.id);
      return { ...a, unlockLevel, unlocked: unlockMet(unlockLevel, readWeapon(w)) };
    });
  },
  isAttachmentUnlocked(w, id) { return hasAttachment(w, id); },

  /* ---------- Cosmetics ---------- */
  camos(w) {
    return (plainOnly(w) ? CAMOS.slice(0, 1) : CAMOS).map(camo => ({ camo, unlocked: hasCamo(w, camo), requirement: camoRequirement(camo) }));
  },

  isUnlocked(w, camoId) {
    const camo = CAMOS.find(c => c.id === camoId);
    return !!camo && hasCamo(w, camo);
  },

  camo(w) {
    const id = readWeapon(w).camo;
    return this.isUnlocked(w, id) ? id : 'none';
  },

  setCamo(w, camoId) {
    if (!this.isUnlocked(w, camoId)) return false;
    writeWeapon(w).camo = camoId;
    save();
    return true;
  },

  tracers(w) {
    return (plainOnly(w) ? TRACERS.slice(0, 1) : TRACERS).map(item => ({ item, unlocked: hasCosmetic(w, item), requirement: cosmeticRequirement(item) }));
  },
  killEffects(w) {
    return (plainOnly(w) ? KILL_EFFECTS.slice(0, 1) : KILL_EFFECTS).map(item => ({ item, unlocked: hasCosmetic(w, item), requirement: cosmeticRequirement(item) }));
  },

  tracer(w) {
    const item = getTracer(readWeapon(w).tracer);
    return hasCosmetic(w, item) ? item.id : 'none';
  },
  killFx(w) {
    const item = getKillEffect(readWeapon(w).killFx);
    return hasCosmetic(w, item) ? item.id : 'none';
  },

  setTracer(w, id) {
    const item = TRACERS.find(t => t.id === id);
    if (!item || !hasCosmetic(w, item)) return false;
    writeWeapon(w).tracer = id;
    save();
    return true;
  },
  setKillFx(w, id) {
    const item = KILL_EFFECTS.find(k => k.id === id);
    if (!item || !hasCosmetic(w, item)) return false;
    writeWeapon(w).killFx = id;
    save();
    return true;
  },

  /* ---------- Challenges ---------- */
  challenges(w) { return challengesFor(readWeapon(w)); },
  isMastered(w) { return isMastered(readWeapon(w)); },
  kills(w) { return readWeapon(w).kills; },
  weaponStats(w) {
    const e = readWeapon(w);
    return { kills: e.kills, head: e.head, long: e.long, slide: e.slide, clean: e.clean };
  },

  /* ---------- Loadouts ---------- */
  loadouts() { return data.loadouts.map(l => matchLoadout(l)); },

  get activeLoadout() { return data.active; },
  set activeLoadout(i) {
    if (!validIndex(i)) return;
    data.active = i;
    save();
  },

  // The full loadout for a match or roster entry, always normalized and limited to what is unlocked.
  loadout(primary) {
    return matchLoadout(activeSlot(), primary ?? activeSlot().primary);
  },

  updateLoadout(i, part) {
    if (!validIndex(i)) return;
    const { operator } = data.loadouts[i];
    data.loadouts[i] = cleanLoadout({ ...data.loadouts[i], ...part }, i);
    if (operator) data.loadouts[i].operator = operator;
    save();
  },

  operators() {
    const career = careerStats();
    return OPERATORS.map(op => ({ op, ...operatorUnlock(op, career) }));
  },
  isOperatorUnlocked(id) { return operatorOpen(id); },

  setOperator(i, id) {
    if (!validIndex(i) || !operatorOpen(id)) return false;
    data.loadouts[i].operator = id;
    save();
    return true;
  },

  renameLoadout(i, name) { this.updateLoadout(i, { name: String(name) }); },
  setEquipment(part) { this.updateLoadout(data.active, part); },

  // The kit loadout i keeps for any gun, equipped or not, minus anything locked. loadouts() only carries the kits of
  // the guns in the loadout (it is what goes into a match); the gunsmith browses every gun.
  kitFor(i, weapon) {
    if (!validIndex(i)) return normalizeKit(weapon, null);
    const fitted = attachmentsFor(data.loadouts[i], weapon), kit = {};
    for (const slot of SLOTS) if (fitted[slot] && hasAttachment(weapon, fitted[slot])) kit[slot] = fitted[slot];
    return normalizeKit(weapon, kit);
  },

  setAttachment(i, slot, id, weapon) {
    if (!validIndex(i) || !SLOTS.includes(slot)) return false;
    const l = data.loadouts[i];
    const gun = weapon ?? l.primary;
    if (id !== null && (ATTACHMENTS[id]?.slot !== slot || !hasAttachment(gun, id))) return false;
    const kit = { ...this.kitFor(i, gun) };
    if (id === null) delete kit[slot]; else kit[slot] = id;
    this.updateLoadout(i, { attachments: { ...l.attachments, [gun]: kit } });
    return true;
  },

  /* ---------- Pro perks ---------- */
  proStatus(perk) { return proStatus(perk, data.pro, data.proDone); },
  isPro(perk) { return data.proDone.includes(perk); },
  proPerks() { return data.proDone.slice(); },

  /* ---------- Calling cards and Veteran ---------- */
  cards() {
    const career = cardCareer(), earned = new Set(cardsEarned(career)), on = equippedCard();
    return CARDS.map(card => {
      const unlocked = earned.has(card.id);
      return { card, unlocked, equipped: card.id === on, progress: unlocked ? null : cardProgress(card, career) };
    });
  },
  get card() { return equippedCard(); },
  setCard(id) {
    if (!CARD_IDS.includes(id) || !cardsEarned(cardCareer()).includes(id)) return false;
    data.card = id;
    save();
    return true;
  },
  isVeteran() { return isVeteran({ prestige: data.prestige, level: levelOf(data.xp), pro: data.proDone }); },
  identity() { return { pro: data.proDone.slice(), card: equippedCard(), veteran: this.isVeteran() }; },

  /* ---------- Save code ---------- */
  exportCode() { return encodeSave(data); },

  importCode(code) {
    const result = decodeSave(code);
    if (!result.ok) return result;
    write(BAK_KEY, JSON.stringify(data));
    // Hints already shown are about this device, not the player, so they stay.
    data = { ...result.save, flags: data.flags };
    syncLooks(false);
    save();
    return { ok: true };
  },

  /* ---------- Match results (js/game/awards.js) ---------- */
  // `pro` is ProTracker.gains(): {perk: {stat: n}}. Pro perks and calling cards earned here come back in `unlocks`
  // ({kind:'pro', id:perk, name, desc} and {kind:'card', id, name, req}), Pro first: they are the bigger moment.
  applyMatch({ xp, weapons, pro, mastery, life, mapId, won, extracted = false }) {
    const beforeLevel = levelOf(data.xp), beforePeak = data.peakLevel;
    const opsBefore = new Set(this.operators().filter(o => o.unlocked).map(o => o.op.id));
    const diffs = new Map(Object.keys(weapons).map(w => [w, weaponDiffBase(w)]));
    const cardsBefore = new Set(cardsEarned(cardCareer()));
    const proBefore = PERK_IDS.map(id => [id, proStatus(id, data.pro, data.proDone)]);
    const goldenBefore = goldenEarned();
    const gatedBefore = openGated();

    // Mastery first, so the ladder only counts for guns that were already level 30 when the match began.
    const tiers = applyMasteryGains(data, mastery ?? {});
    addLife(data, { ...(life ?? {}), ...(mapId ? { [`map:${mapId}`]: 1, ...(won ? { [`mapwon:${mapId}`]: 1 } : {}) } : {}) });
    if (extracted) data.extractions = (data.extractions ?? 0) + 1;      // Extraction: the career count leaderboards read.
    lastMastery = tiers.moved;
    gainXp(xp);
    for (const [w, gained] of Object.entries(weapons)) {
      const entry = writeWeapon(w);
      entry.xp = Math.min(WEAPON_CURVE.cap, entry.xp + Math.max(0, Math.round(gained.xp)));
      entry.peak = Math.max(entry.peak, WEAPON_CURVE.levelOf(entry.xp));
      for (const k of ['kills', 'head', 'long', 'slide', 'clean']) entry[k] += gained[k] ?? 0;
    }
    const freshPro = applyProGains(data, pro);
    save();

    const unlocks = this.unlockSchedule()
      .filter(u => u.level > beforePeak && u.level <= data.peakLevel && isOpen(u.kind, u.id))
      .map(u => ({ kind: u.kind, id: u.id, name: u.name, level: u.level }));
    for (const o of this.operators()) {
      if (o.unlocked && !opsBefore.has(o.op.id)) unlocks.push({ kind: 'operator', id: o.op.id, name: o.op.name });
    }
    const proUnlocks = freshPro.map(id => ({ kind: 'pro', id, name: `${PERKS[id].name} Pro`, desc: proStatus(id, data.pro, data.proDone).desc }));
    // A mastery card shows inside its tier's ceremony, so it gets no second one.
    const viaTier = new Set(tiers.ups.flatMap(u => u.rewards.filter(r => r.kind === 'card').map(r => r.id.slice(5))));
    const cardUnlocks = cardsEarned(cardCareer()).filter(id => !cardsBefore.has(id) && !viaTier.has(id))
      .map(id => ({ kind: 'card', id, name: getCard(id).name, req: getCard(id).req }));
    // Items a challenge just opened (their level was already reached), with the level unlocks.
    for (const k of openGated()) {
      if (gatedBefore.has(k) || unlocks.some(u => `${u.kind}:${u.id}` === k)) continue;
      const [kind, id] = k.split(':');
      unlocks.push({ kind, id, name: ITEM_TABLES[kind]?.[id]?.name ?? id, req: UNLOCK_CHALLENGES[k].label });
    }
    unlocks.unshift(...proUnlocks, ...tiers.ups, ...cardUnlocks);
    // The biggest moment there is goes first of all.
    if (!goldenBefore && goldenEarned()) unlocks.unshift(GOLDEN_UNLOCK());
    // Steps moved this match, for the results screen: [{perk, name, steps:[{label,goal,before,value,done}]}].
    const proProgress = proBefore.map(([id, was]) => {
      const now = proStatus(id, data.pro, data.proDone);
      if (was.done || now.steps.every((c, i) => c.value === was.steps[i].value)) return null;
      return { perk: id, name: PERKS[id].name, done: now.done, steps: now.steps.map((c, i) => ({ ...c, before: was.steps[i].value })) };
    }).filter(Boolean);
    const weaponChanges = [];
    for (const [w, before] of diffs) {
      const entry = readWeapon(w);
      const name = WEAPONS[w]?.name ?? w;
      for (const a of availableFor(w)) {
        if (!unlockMet(a.unlock, before) && unlockMet(a.unlock, entry)) unlocks.push({ kind: 'attachment', id: a.id, name: a.name, slot: a.slot, weapon: w, weaponName: name });
      }
      for (const c of CAMOS) {
        if (!before.camos.has(c.id) && hasCamo(w, c)) unlocks.push({ kind: 'camo', id: c.id, name: c.name, colors: c.colors, weapon: w, weaponName: name });
      }
      weaponChanges.push({
        weapon: w, name, xpGained: Math.max(0, Math.round(weapons[w].xp)), kills: weapons[w].kills ?? 0,
        levelBefore: before.level, levelAfter: WEAPON_CURVE.levelOf(entry.xp), ...this.weaponProgress(w),
      });
    }
    return {
      level: { before: beforeLevel, after: levelOf(data.xp), ...this.levelProgress(), canPrestige: this.canPrestige() },
      weapons: weaponChanges,
      unlocks,
      proProgress,
      mastery: tiers.moved,
    };
  },

  // Kills are counted once by MatchAwards at match end now.
  recordKill() { return []; },
};

/* ---------- Daily and weekly challenges ---------- */
// Kept apart from the save: they turn over every day and have no place in a save code. A bad or old store simply
// starts the current day's set again.
const CHALLENGE_KEY = 'switchyard.challenges';
let challengeState = null;

function challenges(now = new Date()) {
  // Re-read through sanitize on every visit so a set that went stale while the app sat open turns over.
  challengeState = sanitizeChallengeState(challengeState ?? parse(read(CHALLENGE_KEY)), now);
  return challengeState;
}

const saveChallenges = () => write(CHALLENGE_KEY, JSON.stringify(challengeState));

export const Challenges = {
  list(period, now = new Date()) { return challengeList(challenges(now), period); },
  all(now = new Date()) { return Object.fromEntries(CHALLENGE_PERIODS.map(p => [p, this.list(p, now)])); },
  endsAt(period, now = new Date()) { return periodEnd(period, now); },
  canReroll(now = new Date()) { return canReroll(challenges(now), now); },
  reroll(id, now = new Date()) {
    const next = rerollChallenge(challenges(now), id, now);
    if (next) saveChallenges();
    return next;
  },
  // One match's ChallengeTally counts. Returns {moved, xp}; the caller pays the XP.
  apply(counts, now = new Date()) {
    const out = applyChallengeTally(challenges(now), counts, now);
    if (out.moved.length) saveChallenges();
    return out;
  },
  // Tests and the gallery: forget the stored state.
  reset() { challengeState = null; try { localStorage.removeItem(CHALLENGE_KEY); } catch { /* ignore */ } },
};

/* ---------- Match history ---------- */
const HISTORY_KEY = 'switchyard.history';
let historyCache = null;

const history = () => (historyCache ??= cleanHistory(parse(read(HISTORY_KEY))));

export const MatchHistory = {
  list() { return history().list.slice(); },
  add(entry) {
    const e = cleanHistoryEntry(entry);
    if (!e) return null;
    const h = history();
    h.list.unshift(e);
    h.list.length = Math.min(h.list.length, HISTORY_MAX);
    write(HISTORY_KEY, JSON.stringify({ v: HISTORY_VERSION, list: h.list }));
    return e;
  },
  clear() { historyCache = { v: HISTORY_VERSION, list: [] }; try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ } },
};
