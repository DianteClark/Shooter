// Everything that outlives a match, in localStorage. Private browsing can throw on any access, so every
// read and write tolerates failure and the game simply plays without persistence.
import { CAMOS } from '../shared/camos.js';
import { PRIMARY_IDS } from '../shared/constants.js';

const KEY = 'switchyard.progress.v1';

function blank() {
  return { name: '', primary: PRIMARY_IDS[0], camoByWeapon: {}, kills: {}, xp: 0, flags: {} };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...blank(), ...JSON.parse(raw) };
  } catch { /* unavailable or corrupt */ }
  return blank();
}

const data = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch { /* quota or private mode */ }
}

const XP_STEP = 400;   // Level n needs XP_STEP * n * (n - 1) / 2 in total, so each level costs a little more.

export function levelOf(xp) {
  let level = 1;
  while (XP_STEP * level * (level + 1) / 2 <= xp) level++;
  return level;
}

function levelFloor(level) {
  return XP_STEP * level * (level - 1) / 2;
}

export const Progress = {
  get name() { return data.name; },
  set name(v) { data.name = String(v).slice(0, 12); save(); },

  get primary() { return data.primary; },
  set primary(v) { data.primary = v; save(); },

  get xp() { return data.xp; },
  get level() { return levelOf(data.xp); },

  // { level, into, span }: progress inside the current level.
  levelProgress() {
    const level = levelOf(data.xp);
    const floor = levelFloor(level);
    return { level, into: data.xp - floor, span: levelFloor(level + 1) - floor };
  },

  addXp(amount) {
    const before = levelOf(data.xp);
    data.xp += Math.round(amount);
    save();
    return { before, after: levelOf(data.xp), xp: data.xp };
  },

  kills(weapon) { return data.kills[weapon] ?? 0; },

  camo(weapon) {
    const id = data.camoByWeapon[weapon] ?? 'none';
    return this.isUnlocked(weapon, id) ? id : 'none';
  },

  setCamo(weapon, camoId) {
    data.camoByWeapon[weapon] = camoId;
    save();
  },

  isUnlocked(weapon, camoId) {
    const camo = CAMOS.find(c => c.id === camoId);
    return !!camo && this.kills(weapon) >= (camo.unlockKills ?? 0);
  },

  loadout(primary = data.primary) {
    return { primary, camo: this.camo(primary) };
  },

  // Returns camos newly earned on this weapon by this kill.
  recordKill(weapon) {
    const before = this.kills(weapon);
    const after = before + 1;
    data.kills[weapon] = after;
    save();
    return CAMOS.filter(c => before < (c.unlockKills ?? 0) && after >= (c.unlockKills ?? 0));
  },

  flag(name) { return !!data.flags[name]; },
  setFlag(name) { data.flags[name] = true; save(); },
};
