// Remembered menu choices (QoL): the Multiplayer tab and each tab's pick, the friend room's battle royale squad size,
// the Custom picker's map and mode, the last Graveyard Shift map. Kept in Options under 'recall' (this phone's
// settings, never the save code), read once at startup and written as the player changes them. Every value is checked
// on the way out, so a stale or hand-edited entry falls back to the default instead of breaking a screen.
import { Options } from './options.js';

const MAX_SELS = 8;

function store() {
  const r = Options.get('recall');
  return r && typeof r === 'object' && !Array.isArray(r) ? r : {};
}

export const Recall = {
  get(key, fallback = null) {
    const v = store()[key];
    return v === undefined || v === null ? fallback : v;
  },
  set(key, value) {
    const now = store();
    if (JSON.stringify(now[key]) === JSON.stringify(value)) return;
    Options.set('recall', { ...now, [key]: value });
  },

  // Multiplayer: { tab, sels: {tab: {playlist, modes}} } restored for the ids that still exist.
  mp(tabIds) {
    const tab = this.get('mpTab');
    const raw = this.get('mpSels', {});
    const sels = {};
    for (const t of tabIds) {
      const s = raw?.[t];
      if (!s || typeof s !== 'object') continue;
      const playlist = typeof s.playlist === 'string' ? s.playlist.slice(0, 24) : null;
      const modes = Array.isArray(s.modes) ? s.modes.filter(m => typeof m === 'string').slice(0, 24) : [];
      if (playlist || modes.length) sels[t] = { playlist, modes };
    }
    return { tab: tabIds.includes(tab) ? tab : tabIds[0], sels };
  },
  saveMp(mp) {
    const sels = {};
    for (const [t, s] of Object.entries(mp.sels ?? {}).slice(0, MAX_SELS)) sels[t] = { playlist: s?.playlist ?? null, modes: [...(s?.modes ?? [])] };
    this.set('mpTab', mp.tab);
    this.set('mpSels', sels);
  },
};
