// "What's new": once per update, a sheet over the title listing the changelog entries this phone has not seen
// (js/shared/changelog.js). A brand-new player sees nothing (everything is new to them); the build is just recorded.
// Help > Updates (js/ui/help.js) uses changelogHtml for the full history.
import { CHANGELOG } from '../shared/changelog.js';
import { BUILD } from '../build.js';
import { esc } from './widgets.js';
import { ico } from './yard.js';

const SEEN = 'switchyard.seenBuild';
const MAX_SHOWN = 10;                 // Entries on the sheet at most; the rest are in Help > Updates.
const order = b => CHANGELOG.findIndex(e => e.build === b);

// Entries newer than `since` (newest first); all of them when `since` is unknown to the log but older entries exist.
export function unseenEntries(since) {
  const i = order(since);
  return i < 0 ? CHANGELOG.slice(0, 1) : CHANGELOG.slice(0, i);
}

export function changelogHtml(entries = CHANGELOG) {
  return entries.map(e => `
    <section class="cl-entry">
      <h4><b>${esc(e.title)}</b><small>${esc(e.build)} · ${esc(e.date)}</small></h4>
      <ul>${e.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </section>`).join('');
}

// Call on the title screen. `fresh` is true for a save with no matches played (first run).
export function maybeShowWhatsNew(menu, { fresh = false } = {}) {
  let seen = null;
  try { seen = localStorage.getItem(SEEN); } catch { return false; }
  const mark = () => { try { localStorage.setItem(SEEN, BUILD); } catch { /* private mode */ } };
  if (seen === BUILD) return false;
  if (fresh || !CHANGELOG.length) { mark(); return false; }
  // Every entry since the last build this phone saw (a player back after a few weeks catches up on all of them), on
  // a scrolling sheet; past the cap the rest wait in Help > Updates.
  const all = unseenEntries(seen), list = all.slice(0, MAX_SHOWN), more = all.length - list.length;
  if (!list.length) { mark(); return false; }
  menu.overlay(`
    <div class="sheet slim whats-new" role="dialog" aria-label="What's new">
      <div class="sheet-head">${ico('star')}<h2>What's new</h2></div>
      <div class="wn-body scroll-y">${changelogHtml(list)}${more > 0 ? `<p class="wn-more">${more === 1 ? 'One more update' : `${more} more updates`}: see all in How to play &gt; Updates.</p>` : ''}</div>
      <div class="sheet-row">
        <small class="wn-note">${ico('info')}Every update is in How to play &gt; Updates.</small>
        <button class="btn is-primary" data-sound="confirm" data-act="wnClose">${ico('check')}<b>Got it</b></button>
      </div>
    </div>`);
  menu.on({ wnClose: () => { mark(); menu.overlay(''); } });
  return true;
}
