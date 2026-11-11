// Mode modifiers and the featured playlist (docs/MODES.md). Pure data and functions: the sim, the lobby, the solo
// picker and the title screen all read them, so every phone in a match deals the same loadouts.
//
// A modifier changes one thing about any mode it is played with:
//   hardcore   everyone has a third of the health (damage x HARDCORE_DAMAGE) and the HUD drops its minimap
//   snipers    sniper rifles only: a primary that is not one becomes the Longbow (the sidearm stays)
//   melee      blades only: the Gaff and the Maul, Hatchets to throw, no scorestreaks
//   nostreaks  no scorestreaks
// Modes that deal everyone's gun themselves (Gun Game, One in the Chamber, Infected) ignore snipers and melee.
import { WEAPONS } from './weapons.js';
import { MODES } from './modes.js';

export const MODS = {
  hardcore:  { id: 'hardcore',  name: 'Hardcore',     short: 'HC',   desc: 'A third of the health. No minimap.' },
  snipers:   { id: 'snipers',   name: 'Snipers Only', short: 'SNP',  desc: 'Sniper rifles and sidearms only.' },
  melee:     { id: 'melee',     name: 'Melee Only',   short: 'MEL',  desc: 'Blades and Hatchets. No guns, no streaks.' },
  nostreaks: { id: 'nostreaks', name: 'No Streaks',   short: 'NOST', desc: 'Scorestreaks are off.' },
};
export const MOD_IDS = Object.keys(MODS);
export const HARDCORE_DAMAGE = 3;
// Modifiers that cannot be played together: the later one in a list wins.
const EXCLUSIVE = [['snipers', 'melee']];
// Rule sets that deal every gun themselves.
const DEALT = new Set(['gun', 'oic', 'inf']);
const SNIPER = 'sniper', BLADE = 'knife', SLEDGE = 'maul';

// The modifiers that apply to a mode, in MOD_IDS order, from any list (unknown ids, repeats and clashes dropped).
export function cleanMods(list, modeId = null) {
  if (!Array.isArray(list)) list = typeof list === 'string' && list ? list.split(',') : [];
  let keep = list.filter(id => MODS[id]);
  for (const pair of EXCLUSIVE) {
    const hit = keep.filter(id => pair.includes(id));
    if (hit.length > 1) keep = keep.filter(id => !pair.includes(id) || id === hit[hit.length - 1]);
  }
  const rules = MODES[modeId]?.rules ?? modeId;
  if (DEALT.has(rules)) keep = keep.filter(id => id !== 'snipers' && id !== 'melee');
  if (rules === 'snd') keep = keep.filter(id => id !== 'nostreaks');      // S&D has none to begin with.
  return MOD_IDS.filter(id => keep.includes(id));
}

// What a modifier list does to a loadout: a new object, the input untouched. Identity, cosmetics and perks stay.
export function dealLoadout(l, mods) {
  if (!mods?.length || !l) return l;
  const out = { ...l };
  if (mods.includes('snipers') && WEAPONS[out.primary]?.category !== 'Sniper') out.primary = SNIPER;
  if (mods.includes('melee')) {
    out.primary = BLADE; out.secondary = SLEDGE; out.lethal = 'hatchet';
    out.streaks = [];
  }
  if (mods.includes('nostreaks')) out.streaks = [];
  if (out.primary !== l.primary) out.camo = l.camos?.[out.primary] ?? 'none';
  return out;
}

// A short title for a mode with modifiers: "Hardcore Headquarters", "Snipers Only Kill Order".
export function playlistName(modeId, mods = []) {
  const m = MODES[modeId]?.name ?? '';
  return mods.length ? `${mods.map(id => MODS[id].name).join(' ')} ${m}` : m;
}

// ---- Featured playlist: one mode and modifier pairing a day, the same on every phone, no server ----
// Cycles through FEATURED by the local calendar day. Days count from 2026-01-01 so the order starts at the top.
export const FEATURED = [
  { mode: 'hq', mods: ['hardcore'] },
  { mode: 'inf', mods: [] },
  { mode: 'ko', mods: ['snipers'] },
  { mode: 'oic', mods: [] },
  { mode: 'ctl', mods: ['nostreaks'] },
  { mode: 'grind', mods: [] },
  { mode: 'tdm', mods: ['melee'] },
  { mode: 'dom', mods: ['hardcore'] },
  { mode: 'ffa', mods: ['snipers'] },
  { mode: 'hq', mods: [] },
  { mode: 'kc', mods: ['hardcore', 'nostreaks'] },
  { mode: 'ko', mods: [] },
  { mode: 'inf', mods: ['hardcore'] },
  { mode: 'ctl', mods: [] },
];
const EPOCH = Date.UTC(2026, 0, 1);

export function dayIndex(date = new Date()) {
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - EPOCH) / 86400000);
}

// Today's featured pairing: {mode, mods, name, desc, day}. `day` is the day number it was picked for.
export function featured(date = new Date()) {
  const day = dayIndex(date), n = FEATURED.length;
  const f = FEATURED[((day % n) + n) % n];
  const mods = cleanMods(f.mods, f.mode);
  return { mode: f.mode, mods, day, name: playlistName(f.mode, mods), desc: MODES[f.mode].desc };
}
