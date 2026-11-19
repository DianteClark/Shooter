// The progress reset (docs/ROADMAP.md item 41, docs/RESET.md): one hard wipe of every player's progress, on every phone,
// with no way back. Pure: no DOM, and storage only through the object handed in, so node tests run it on a Map.
//
//   PROGRESS_RESET / RESET_AT   the reset date ('2026-11-19', and that day at 00:00 UTC in ms)
//   RESET_GEN                   the reset generation; bump it (and the date) only for another full wipe
//   wipeProgress(storage)       on app start (js/ui/wipe.js, before anything reads progress): a phone whose stored
//                               generation differs loses every progress key, keeps its settings, then stores RESET_GEN.
//                               Returns { wiped: [keys removed], notice: bool, ran: bool }; with `ran` the caller also
//                               deletes the IndexedDB databases in WIPE_DBS (saved clips).
//
// Save codes carry the generation too (js/shared/progression.js encodeSave: "SY4R1.<body>.<sum>"), so a code made
// before the reset is refused on import. The bot pool's careers start from RESET_AT (js/shared/botpool.js CAREER_START).

export const PROGRESS_RESET = '2026-11-19';
export const RESET_AT = Date.UTC(2026, 10, 19);
export const RESET_GEN = 1;

// This phone's generation, and the pending one-time notice on the title (js/ui/resetnotice.js).
export const GEN_KEY = 'switchyard.resetGen';
export const NOTICE_KEY = 'switchyard.resetNotice';

// Device settings, kept through a reset. Everything else under the app's prefix goes (see wipeProgress).
//   switchyard-options        graphics, audio, controls, touch layout, HUD size, accessibility, controller mapping,
//                             haptics, full screen, squad tag, Hardcore switch (its `recall` entry is emptied: menu picks)
//   switchyard-quality        the Auto graphics governor's settled step for this phone
//   switchyard-gpu            this phone's GPU name, for that governor
//   switchyard.tuning.v1      the hidden tuning panel's control and camera values
//   switchyard.tuner.ui.v1    where that panel sits
export const OPTIONS_KEY = 'switchyard-options';
export const KEEP_KEYS = Object.freeze([OPTIONS_KEY, 'switchyard-quality', 'switchyard-gpu', 'switchyard.tuning.v1', 'switchyard.tuner.ui.v1', GEN_KEY, NOTICE_KEY]);

// Every progress key the game wrote before the reset (docs/RESET.md lists what each holds). wipeProgress removes any
// other key under the prefix too, so a key added later (a tournament, a new tracker) can never slip through.
export const WIPE_KEYS = Object.freeze([
  'switchyard.save', 'switchyard.progress.v1', 'switchyard.save.bad', 'switchyard.save.bak',
  'switchyard.challenges', 'switchyard.history', 'switchyard.friends', 'switchyard.gunstats',
  'switchyard-seen', 'switchyard.custom.v1', 'switchyard-mods', 'switchyard-botmatch', 'switchyard-training',
  'switchyard.eventSeen', 'switchyard.seasonSeen', 'switchyard.seenBuild', 'switchyard-last-room', 'switchyard-player',
  'switchyard-backdrop', 'switchyard.clan',
]);

// IndexedDB databases that hold progress: saved replay clips (js/ui/clips.js). js/ui/wipe.js deletes each of these
// whenever wipeProgress runs (`ran`), so a wipe takes them with the localStorage keys.
export const CLIPS_DB = 'switchyard-clips';
export const WIPE_DBS = Object.freeze([CLIPS_DB]);

const PREFIX = /^switchyard[.-]/;

// Keys in a Storage (or anything with length/key(i)), or a Map stand-in's own keys.
function keysOf(storage) {
  if (typeof storage.length === 'number' && typeof storage.key === 'function') {
    const out = [];
    for (let i = 0; i < storage.length; i++) out.push(storage.key(i));
    return out.filter(k => typeof k === 'string');
  }
  if (typeof storage.keys === 'function') return [...storage.keys()];
  return [];
}

// buildId: the running build (js/build.js), recorded as seen so "What's new" stays quiet: the notice speaks instead.
export function wipeProgress(storage, { buildId = null } = {}) {
  let gen = null;
  try { gen = storage.getItem(GEN_KEY); } catch { return { wiped: [], notice: false, ran: false }; }
  if (gen === String(RESET_GEN)) return { wiped: [], notice: false, ran: false };
  const wiped = [];
  try {
    for (const k of new Set([...WIPE_KEYS, ...keysOf(storage).filter(k => PREFIX.test(k))])) {
      if (KEEP_KEYS.includes(k) || storage.getItem(k) === null) continue;
      storage.removeItem(k);
      wiped.push(k);
    }
    // Options stay, but the remembered menu picks (Multiplayer tab and playlists, Custom map and mode, squad size)
    // can name things a fresh save has not unlocked.
    const raw = storage.getItem(OPTIONS_KEY);
    if (raw) {
      let o = null;
      try { o = JSON.parse(raw); } catch { /* unreadable: options.js falls back to defaults */ }
      if (o && typeof o === 'object' && !Array.isArray(o) && o.recall && Object.keys(o.recall).length) {
        o.recall = {};
        storage.setItem(OPTIONS_KEY, JSON.stringify(o));
        wiped.push(`${OPTIONS_KEY}#recall`);
      }
    }
    // A brand-new phone had nothing to lose: no notice. One that had progress hears about it once.
    const notice = wiped.some(k => k !== `${OPTIONS_KEY}#recall`);
    if (notice) storage.setItem(NOTICE_KEY, String(RESET_GEN));
    if (buildId) storage.setItem('switchyard.seenBuild', buildId);
    storage.setItem(GEN_KEY, String(RESET_GEN));
    return { wiped, notice, ran: true };
  } catch {
    // Private mode or a full store: whatever was removed stays removed; the next start tries again.
    return { wiped, notice: false, ran: true };
  }
}

// The title's notice is pending (set by a wipe, cleared once the player has seen it).
export function noticePending(storage) {
  try { return storage.getItem(NOTICE_KEY) === String(RESET_GEN); } catch { return false; }
}
export function noticeSeen(storage) {
  try { storage.removeItem(NOTICE_KEY); } catch { /* private mode: it may show once more */ }
}
