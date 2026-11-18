// The weekly event's banner (js/shared/events.js, docs/SEASONS.md "Weekly events"): on the first visit to the title in
// a new event week, a short strip under the wordmark names the event and the time left; a tap opens Multiplayer on its
// playlist, otherwise it slides away by itself. Once per week per phone (localStorage), never on a brand-new save.
// The week a new season (or Season Replay) opens, the strip announces the season instead and opens the Season screen.
import { weeklyEventAt } from '../shared/events.js';
import { seasonAt } from '../shared/seasons.js';
import { esc } from './widgets.js';
import { ico } from './yard.js';
import { timeLeft } from './challenges.js';

const SEEN = 'switchyard.eventSeen', SEASON_SEEN = 'switchyard.seasonSeen';
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

export function seasonBannerHtml(season) {
  const def = season.def;
  return `
    <button class="ev-banner sn" data-act="season" data-sound="confirm" style="--sa:${def.theme[3]}" aria-label="${esc(season.title)}">
      <span class="evb-ico">${ico('ui:star')}</span>
      <span class="evb-tx"><small>${season.replay ? 'Season Replay' : 'New season'} · ${season.daysLeft} days</small><b>${esc(season.replay ? def.name : season.title)}</b></span>
      <span class="evb-go">${ico('next')}<b>Track</b></span>
    </button>`;
}

// Shows the banner over the title if this week's has not been shown. `fresh`: a save with no matches yet (it only
// records the week). Returns whether it showed.
export function maybeEventBanner(menu, { fresh = false, now = new Date() } = {}) {
  const ev = weeklyEventAt(now), season = seasonAt(now);
  let seen = null, seenSeason = null;
  try { seen = localStorage.getItem(SEEN); seenSeason = localStorage.getItem(SEASON_SEEN); } catch { return false; }
  if (seen === ev.key && seenSeason === season.key) return false;
  try { localStorage.setItem(SEEN, ev.key); localStorage.setItem(SEASON_SEEN, season.key); } catch { /* private mode */ }
  if (fresh || menu.el.dataset.screen !== 'title') return false;
  const newSeason = !!season.def && !!seenSeason && seenSeason !== season.key;
  if (!newSeason && seen === ev.key) return false;
  menu.el.querySelector('.ev-banner')?.remove();
  menu.el.insertAdjacentHTML('beforeend', newSeason ? seasonBannerHtml(season) : eventBannerHtml(ev, now));
  const el = menu.el.querySelector('.ev-banner');
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, SHOW_MS);
  return true;
}
