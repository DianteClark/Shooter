// Vibration on hits (Options: Vibrate on hits, off by default). Android Chrome and Samsung Internet have the Vibration
// API; iPhone Safari does not, so the option is only offered where navigator.vibrate exists.
import { Options } from './options.js';

export const hapticsSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

// 1 a hit landed, 2 a kill or a headshot (a double tap), 3 hit yourself, 4 a multi-kill (a triple roll).
const PATTERNS = [0, 8, [14, 40, 14], 35, [14, 36, 14, 36, 22]];
const MULTI = new Set(['double', 'triple', 'fury']);
const GAP_MS = 90;             // A shotgun's pellets or an LMG burst land as one buzz, not a drone.
let lastAt = 0;

// events: one frame of sim events. Taking a hit buzzes longer than landing one; a kill gets a double tap.
export function hapticEvents(events, me) {
  if (!Options.get('haptics') || !hapticsSupported() || document.hidden) return;
  let pattern = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.t === 'hit') {
      if (e.target === me && e.by !== me) pattern = Math.max(pattern, 3);
      else if (e.by === me) pattern = Math.max(pattern, e.head ? 2 : 1);
    } else if (e.t === 'kill' && e.by === me && e.target !== me) pattern = Math.max(pattern, 2);
    else if (e.t === 'medal' && e.id === me && MULTI.has(e.medal)) pattern = Math.max(pattern, 4);
  }
  if (!pattern) return;
  const now = performance.now();
  if (now - lastAt < GAP_MS) return;
  lastAt = now;
  try { navigator.vibrate(PATTERNS[pattern]); } catch { /* blocked: no gesture yet */ }
}
