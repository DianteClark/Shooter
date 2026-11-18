// The progress reset's wipe (js/shared/reset.js, docs/RESET.md). Imported first by js/main.js, and with no imports that
// touch storage, so it runs before any module reads the save, the stats tracker, friends or options at load.
import { wipeProgress, WIPE_DBS } from '../shared/reset.js';
import { BUILD } from '../build.js';

let result = { wiped: [], notice: false };
try { if (typeof localStorage !== 'undefined') result = wipeProgress(localStorage, { buildId: BUILD }); } catch { /* no storage at all */ }
// Saved replay clips live in IndexedDB. A delete is queued ahead of any later open of the same database, so nothing can
// read the old clips after this line.
if (result.ran && typeof indexedDB !== 'undefined') for (const name of WIPE_DBS) { try { indexedDB.deleteDatabase(name); } catch { /* none */ } }

// { wiped: [keys], notice: bool } for this start (debug and tests).
export const WIPE = Object.freeze(result);
