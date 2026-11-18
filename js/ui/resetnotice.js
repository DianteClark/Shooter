// The progress reset's one-time notice (docs/RESET.md): on the first title after a wipe that took something, a sheet says
// so; dismissing it goes on to the usual first-run flow (the training offer, then the callsign when they first play).
// Marked seen as it shows, so a reload never shows it twice.
import { noticePending, noticeSeen } from '../shared/reset.js';
import { ico } from './yard.js';

export const RESET_NOTICE = 'Fresh start: all progress has been reset for everyone. Your settings were kept.';

// Returns whether it showed. then(): called once it is dismissed.
export function maybeResetNotice(menu, { then = () => {} } = {}) {
  if (typeof localStorage === 'undefined' || !noticePending(localStorage)) return false;
  noticeSeen(localStorage);
  menu.overlay(`
    <div class="sheet slim whats-new reset-notice" role="dialog" aria-label="Fresh start">
      <div class="sheet-head">${ico('star')}<h2>Fresh start</h2></div>
      <div class="wn-body"><p class="rn-text">${RESET_NOTICE}</p>
        <p class="rn-sub">Everyone starts again from level 1: levels, unlocks, stats, records, friends' cards, season and ranked progress. Save codes from before the reset no longer load.</p></div>
      <div class="sheet-row">
        <button class="btn is-primary" data-sound="confirm" data-act="rnClose">${ico('check')}<b>Got it</b></button>
      </div>
    </div>`);
  menu.on({ rnClose: () => { menu.overlay(''); then(); } });
  return true;
}
