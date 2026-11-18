// The weekly event's banner (js/shared/events.js, docs/SEASONS.md "Weekly events"): on the first visit to the title in
// a new event week, a short strip at the top names the event and the time left; a tap opens Multiplayer on its
// playlist, otherwise it slides away by itself. Once per week per phone (localStorage), never on a brand-new save.
import { weeklyEventAt } from '../shared/events.js';
import { esc } from './widgets.js';
import { ico } from './yard.js';
import { timeLeft } from './challenges.js';

const SEEN = 'switchyard.eventSeen';
const SHOW_MS = 8000;

// The banner's markup (the gallery shows it too).
export function eventBannerHtml(ev, now = new Date()) {
  return `
    <button class="ev-banner" data-act="eventBanner" data-sound="confirm" aria-label="Weekly event: ${esc(ev.name)}">
      <span class="evb-ico">${ico(ev.def.icon)}</span>
      <span class="evb-tx"><small>New weekly event · ${timeLeft(ev.endsAt, now.getTime())} left</small><b>${esc(ev.name)}</b></span>
      <span class="evb-go">${ico('play')}<b>Play</b></span>
    </button>`;
}

// Shows the banner over the title if this week's has not been shown. `fresh`: a save with no matches yet (it only
// records the week). Returns whether it showed.
export function maybeEventBanner(menu, { fresh = false, now = new Date() } = {}) {
  const ev = weeklyEventAt(now);
  let seen = null;
  try { seen = localStorage.getItem(SEEN); } catch { return false; }
  if (seen === ev.key) return false;
  try { localStorage.setItem(SEEN, ev.key); } catch { /* private mode */ }
  if (fresh || menu.el.dataset.screen !== 'title') return false;
  menu.el.querySelector('.ev-banner')?.remove();
  menu.el.insertAdjacentHTML('beforeend', eventBannerHtml(ev, now));
  const el = menu.el.querySelector('.ev-banner');
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, SHOW_MS);
  return true;
}
