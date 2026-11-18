// The progress reset's wipe (js/shared/reset.js, docs/RESET.md). Imported first by js/main.js, and with no imports that
// touch storage, so it runs before any module reads the save, the stats tracker, friends or options at load.
import { wipeProgress } from '../shared/reset.js';
import { BUILD } from '../build.js';

let result = { wiped: [], notice: false };
try { if (typeof localStorage !== 'undefined') result = wipeProgress(localStorage, { buildId: BUILD }); } catch { /* no storage at all */ }

// { wiped: [keys], notice: bool } for this start (debug and tests).
export const WIPE = Object.freeze(result);
