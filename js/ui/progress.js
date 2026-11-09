/* Progress API (Wave 2). `w` is a weapon id, `i` a loadout index 0..4, `slot` optic|barrel|mag|grip.
 * setCamo/setTracer/setKillFx/setAttachment return false and change nothing when the item is locked.
 * Identity   name (get/set)  primary (get/set: active loadout's gun)  flag(n)  setFlag(n)
 * Player     xp  level  prestige  totalXp  levelProgress() -> {level,into,span,maxed,prestige}
 *            canPrestige()  doPrestige() -> {ok,prestige,badge}   badge() -> {prestige,level} (for roster)
 *            addXp(n) -> {before,after,xp}   (MatchAwards owns match XP; do not also add it in main.js)
 * Badges     import { badgeSvg, prestigeName, MAX_PRESTIGE } from '../shared/progression.js'
 *            badgeSvg(prestige, size=48) -> SVG markup string, safe to inline repeatedly (no ids/defs).
 * Unlocks    itemUnlockLevel(kind,id)  isItemUnlocked(kind,id)  unlockSchedule() -> [{level,kind,id,name}]
 *            kind: 'perk'|'tactical'|'lethal'|'streak'. Weapons are never locked.
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
 *            setEquipment(part)  (edits the active loadout)
 * Save       exportCode() -> string   importCode(code) -> {ok:true}|{ok:false,error:'format'|'checksum'|'version'|'data'}
 * Match      applyMatch(summary)  used by js/game/awards.js only.
 * Removed    recordKill(w) stays as a no-op returning []. MatchAwards counts kills now; hud.js should drop the call.
 */

// Everything that outlives a match, in one versioned localStorage save. Private browsing can throw on any
// access, so every read and write tolerates failure and the game simply plays without persistence.
// The rules live in js/shared/progression.js; this module owns the save and applies them.
import { CAMOS, TRACERS, KILL_EFFECTS, getTracer, getKillEffect } from '../shared/camos.js';
import { PRIMARY_IDS } from '../shared/constants.js';
import { normalizeLoadout, SCORE } from '../shared/catalog.js';
import { OPERATORS, DEFAULT_OPERATOR, OPERATOR_IDS, operatorUnlock, getOperator } from './operators.js';
import { WEAPONS } from '../shared/weapons.js';
import { SLOTS, ATTACHMENTS, availableFor, attachmentsFor, normalizeKit, unlockFor } from '../shared/attachments.js';
import {
  SAVE_VERSION, LOADOUT_COUNT, MAX_LEVEL, MAX_PRESTIGE, MAX_WEAPON_LEVEL, MAX_WEAPON_PRESTIGE,
  PLAYER_CURVE, WEAPON_CURVE, UNLOCK_SCHEDULE, ITEM_TABLES, levelOf, itemUnlockLevel, gateLoadoutGear,
  challengesFor, isMastered, camoGateOpen, camoRequirement, cosmeticRequirement, prestigeRewards,
  blankWeapon, blankSave, sanitizeSave, migrateV1, cleanLoadout, encodeSave, decodeSave, badgeSvg,
} from '../shared/progression.js';

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

function save() {
  write(KEY, JSON.stringify(data));
}

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

const hasCamo = (w, camo) => readWeapon(w).owned.includes(camo.id) || camoGateOpen(camo, readWeapon(w));
const hasCosmetic = (w, item) => readWeapon(w).prestige >= item.prestige;
const hasAttachment = (w, id) => {
  const level = unlockFor(w, id);
  return level !== null && readWeapon(w).peak >= level;
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
  const c = { level: data.peakLevel, prestige: data.prestige, kills: 0, head: 0, long: 0, slide: 0, clean: 0 };
  for (const w of Object.values(data.weapons)) for (const k of ['kills', 'head', 'long', 'slide', 'clean']) c[k] += w[k] ?? 0;
  return c;
}

const operatorOpen = (id, career = careerStats()) => OPERATOR_IDS.includes(id) && operatorUnlock(getOperator(id), career).unlocked;

function matchLoadout(saved, primary = saved.primary) {
  const base = normalizeLoadout({ ...saved, primary, attachments: saved.attachments });
  const gear = gateLoadoutGear(base, data.peakLevel);
  return {
    ...gear,
    name: saved.name,
    attachments: gatedKits(gear),
    camo: Progress.camo(primary),
    tracer: Progress.tracer(primary),
    killFx: Progress.killFx(primary),
    operator: operatorOpen(saved.operator) ? saved.operator : DEFAULT_OPERATOR,
  };
}

function weaponDiffBase(w) {
  const before = readWeapon(w);
  return {
    level: WEAPON_CURVE.levelOf(before.xp),
    peak: before.peak,
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
    data.prestige++;
    data.xp = 0;
    save();
    return { ok: true, prestige: data.prestige, badge: badgeSvg(data.prestige) };
  },

  badge() {
    return { prestige: data.prestige, level: levelOf(data.xp) };
  },

  /* ---------- Unlocks ---------- */
  itemUnlockLevel,
  isItemUnlocked(kind, id) { return itemUnlockLevel(kind, id) <= data.peakLevel; },

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
    const entry = writeWeapon(w);
    entry.prestige++;
    entry.xp = 0;
    save();
    return { ok: true, prestige: entry.prestige, rewards: prestigeRewards(entry.prestige) };
  },

  attachments(w) {
    return availableFor(w).map(a => {
      const unlockLevel = unlockFor(w, a.id);
      return { ...a, unlockLevel, unlocked: readWeapon(w).peak >= unlockLevel };
    });
  },
  isAttachmentUnlocked(w, id) { return hasAttachment(w, id); },

  /* ---------- Cosmetics ---------- */
  camos(w) {
    return CAMOS.map(camo => ({ camo, unlocked: hasCamo(w, camo), requirement: camoRequirement(camo) }));
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
    return TRACERS.map(item => ({ item, unlocked: hasCosmetic(w, item), requirement: cosmeticRequirement(item) }));
  },
  killEffects(w) {
    return KILL_EFFECTS.map(item => ({ item, unlocked: hasCosmetic(w, item), requirement: cosmeticRequirement(item) }));
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

  setAttachment(i, slot, id, weapon) {
    if (!validIndex(i) || !SLOTS.includes(slot)) return false;
    const l = data.loadouts[i];
    const gun = weapon ?? l.primary;
    if (id !== null && (ATTACHMENTS[id]?.slot !== slot || !hasAttachment(gun, id))) return false;
    const kit = { ...attachmentsFor(l, gun) };
    if (id === null) delete kit[slot]; else kit[slot] = id;
    this.updateLoadout(i, { attachments: { ...l.attachments, [gun]: kit } });
    return true;
  },

  /* ---------- Save code ---------- */
  exportCode() { return encodeSave(data); },

  importCode(code) {
    const result = decodeSave(code);
    if (!result.ok) return result;
    write(BAK_KEY, JSON.stringify(data));
    // Hints already shown are about this device, not the player, so they stay.
    data = { ...result.save, flags: data.flags };
    save();
    return { ok: true };
  },

  /* ---------- Match results (js/game/awards.js) ---------- */
  applyMatch({ xp, weapons }) {
    const beforeLevel = levelOf(data.xp), beforePeak = data.peakLevel;
    const opsBefore = new Set(this.operators().filter(o => o.unlocked).map(o => o.op.id));
    const diffs = new Map(Object.keys(weapons).map(w => [w, weaponDiffBase(w)]));

    gainXp(xp);
    for (const [w, gained] of Object.entries(weapons)) {
      const entry = writeWeapon(w);
      entry.xp = Math.min(WEAPON_CURVE.cap, entry.xp + Math.max(0, Math.round(gained.xp)));
      entry.peak = Math.max(entry.peak, WEAPON_CURVE.levelOf(entry.xp));
      for (const k of ['kills', 'head', 'long', 'slide', 'clean']) entry[k] += gained[k] ?? 0;
    }
    save();

    const unlocks = this.unlockSchedule()
      .filter(u => u.level > beforePeak && u.level <= data.peakLevel)
      .map(u => ({ kind: u.kind, id: u.id, name: u.name, level: u.level }));
    for (const o of this.operators()) {
      if (o.unlocked && !opsBefore.has(o.op.id)) unlocks.push({ kind: 'operator', id: o.op.id, name: o.op.name });
    }
    const weaponChanges = [];
    for (const [w, before] of diffs) {
      const entry = readWeapon(w);
      const name = WEAPONS[w]?.name ?? w;
      for (const a of availableFor(w)) {
        if (a.unlock > before.peak && a.unlock <= entry.peak) unlocks.push({ kind: 'attachment', id: a.id, name: a.name, slot: a.slot, weapon: w, weaponName: name });
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
    };
  },

  // Kills are counted once by MatchAwards at match end now.
  recordKill() { return []; },
};
