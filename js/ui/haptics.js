// Vibration on hits (Options: Vibrate on hits, off by default). Android Chrome and Samsung Internet have the Vibration
// API; iPhone Safari does not, so the option is only offered where navigator.vibrate exists.
import { Options } from './options.js';

export const hapticsSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

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
      else if (e.by === me) pattern = Math.max(pattern, 1);
    } else if (e.t === 'kill' && e.by === me && e.target !== me) pattern = Math.max(pattern, 2);
  }
  if (!pattern) return;
  const now = performance.now();
  if (now - lastAt < GAP_MS) return;
  lastAt = now;
  try { navigator.vibrate(pattern === 3 ? 35 : pattern === 2 ? [14, 40, 14] : 8); } catch { /* blocked: no gesture yet */ }
}
