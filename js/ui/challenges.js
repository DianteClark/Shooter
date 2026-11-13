// Daily and weekly challenges: the Challenges screen, the compact plate on the title, and the pieces the results screen
// shows (a strip of what moved, and the completion stamp in its reel). Rules live in js/shared/progression.js, the
// stored state in js/ui/progress.js (Challenges); MatchAwards settles each match.
//
// Results hook (results.js): `unlockStamp(u) ?? challengeStamp(u)` in unlockCard, and `${challengeStrip(data.challenges)}`
// in .res-choice. main.js passes `challenges` and puts one {kind:'challenge'} unlock first per finished challenge.
import { Challenges } from './progress.js';
import { esc } from './widgets.js';
import { icon } from './icons.js';
import { ico, header } from './yard.js';
import { enter, pop, sweep } from './motion.js';
import { playFor } from './shortcuts.js';

const PERIOD_NAME = { daily: 'Daily', weekly: 'Weekly' };
const fmtXp = n => Math.round(n).toLocaleString('en-US');

// "5h 12m", "3d 4h", "12m": time until a timestamp, for the reset labels.
export function timeLeft(at, now = Date.now()) {
  const m = Math.max(0, Math.round((at - now) / 60000));
  if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.max(1, m)}m`;
}

const mark = (id, size) => icon(id, { size, square: true });
const frac = c => Math.min(1, c.value / c.goal);

// ---- Title plate --------------------------------------------------------------------------------------------------
// Today's three, a bar each, and a line for the week. The whole plate opens the Challenges screen.
export function titleChallenges() {
  let daily, weekly;
  try { ({ daily, weekly } = Challenges.all()); } catch (err) { console.error('challenges', err); return ''; }
  const dn = daily.filter(c => c.done).length, wn = weekly.filter(c => c.done).length;
  return `<button class="tch${dn === daily.length ? ' all' : ''}" data-act="challenges" data-in="right" aria-label="Challenges">
    <span class="tch-head"><b>${ico('ui:flag')}Daily</b><em>${dn}/${daily.length}</em><small>${ico('timer')}${timeLeft(Challenges.endsAt('daily'))}</small></span>
    ${daily.map(c => `<span class="tch-row${c.done ? ' done' : ''}">
      <i class="tch-ico">${c.done ? ico('check') : mark(c.icon, 14)}</i>
      <span class="tch-lb">${esc(c.label)}</span>
      <i class="tch-bar"><i style="transform:scaleX(${frac(c).toFixed(3)})"></i></i>
      <small class="tch-n">${c.done ? 'Done' : `${c.value}/${c.goal}`}</small>
    </span>`).join('')}
    <span class="tch-foot"><span>Weekly <u>${wn}/${weekly.length}</u></span><small>${timeLeft(Challenges.endsAt('weekly'))} left</small>${ico('next', 'tch-go')}</span>
  </button>`;
}

// ---- Challenges screen ------------------------------------------------------------------------------------------
// The challenge's icon tile, or for one still open with somewhere to play it (QoL), a Play button in its place.
export function playTile(c, cls, size, canPlay) {
  const where = canPlay && !c.done ? playFor(c.stat) : null;
  if (!where) return `<span class="${cls}">${mark(c.icon, size)}${c.done ? `<i class="chc-check">${ico('check')}</i>` : ''}</span>`;
  return `<button class="${cls} ch-play" data-act="chPlay" data-stat="${esc(c.stat)}" data-sound="confirm" aria-label="Play ${esc(where.name)}: ${esc(c.label)}">${mark(c.icon, size)}<small class="ch-play-tag">${ico('play')}Play</small></button>`;
}

function card(c, i, { canReroll, arming, canPlay }) {
  const state = c.done ? ' done' : arming ? ' arming' : '';
  return `<div class="chc${state}" data-id="${esc(c.id)}" style="--i:${i}" data-in="up">
    ${playTile(c, 'chc-ico', 30, canPlay)}
    <span class="chc-body">
      <b class="chc-lb">${esc(c.label)}</b>
      <span class="chc-prog"><i class="chc-bar"><i style="transform:scaleX(${frac(c).toFixed(3)})"></i></i><small class="t-num">${c.value.toLocaleString('en-US')} / ${c.goal.toLocaleString('en-US')}</small></span>
    </span>
    <span class="chc-xp${c.done ? ' paid' : ''}"><b>+${fmtXp(c.xp)}</b><small>${c.done ? 'Earned' : 'XP'}</small></span>
    ${!c.done && canReroll ? `<button class="chc-swap${arming ? ' is-armed' : ''}" data-act="chReroll" data-id="${esc(c.id)}" data-sound="${arming ? 'confirm' : 'tap'}" aria-label="Swap this challenge">${ico('refresh')}<small>${arming ? 'Swap?' : 'Swap'}</small></button>` : ''}
  </div>`;
}

function panel(period, list, optsFor) {
  const n = list.filter(c => c.done).length;
  return `<section class="chp" data-period="${period}">
    <h3 class="chp-head" data-in="fade"><span>${PERIOD_NAME[period]}</span><em>${n}/${list.length}</em><small>${ico('timer')}Resets in ${timeLeft(Challenges.endsAt(period))}</small></h3>
    <div class="chp-list">${list.map((c, i) => card(c, i, optsFor(c.id))).join('')}</div>
  </section>`;
}

export function challengesScreen(menu, { onBack, onPlay = null }) {
  let arming = null;                // The card whose Swap was tapped once; a second tap confirms.
  menu.el.dataset.screen = 'challenges';
  const paint = (fresh = null) => {
    const { daily, weekly } = Challenges.all();
    const can = Challenges.canReroll();
    const optsFor = id => ({ canReroll: can, arming: arming === id, canPlay: !!onPlay });
    menu.el.innerHTML = `
      ${header({ back: 'chBack', label: 'Done', title: 'Challenges', cls: 'ch-bar', extra: `<span class="ch-swaps${can ? '' : ' used'}">${ico('refresh')}${can ? '1 swap left today' : 'Swap used today'}</span>` })}
      <div class="ch-cols">
        ${panel('daily', daily, optsFor)}${panel('weekly', weekly, optsFor)}
      </div>
      <p class="ch-foot" data-in="fade">${ico('info')}Every match counts, bots included. A finished challenge pays its XP at the end of that match.</p>`;
    if (fresh) {
      const el = menu.el.querySelector(`.chc[data-id="${CSS.escape(fresh)}"]`);
      if (el) { enter(el, 'stamp'); sweep(el, { delay: 200 }); }
    }
  };
  menu.on({
    chBack: () => onBack(),
    chPlay: ({ stat }) => { const where = playFor(stat); if (where) onPlay?.(where); },
    chReroll: ({ id }, el) => {
      if (!Challenges.canReroll()) { menu.deny(el, 'One swap a day'); return; }
      if (arming !== id) { arming = id; paint(); const b = menu.el.querySelector(`.chc[data-id="${CSS.escape(id)}"] .chc-swap`); if (b) pop(b, { scale: 1.12 }); return; }
      arming = null;
      const next = Challenges.reroll(id);
      if (!next) { paint(); menu.deny(menu.el.querySelector('.ch-swaps'), 'Nothing to swap it for'); return; }
      paint(next);
      menu.toast('Challenge swapped');
    },
  });
  paint();
  menu.show();
}

// ---- Results --------------------------------------------------------------------------------------------------------
// What moved this match, under the tables: up to three rows with the bar from before to after.
export function challengeStrip(list = [], max = 3) {
  if (!list?.length) return '';
  const rows = [...list].sort((a, b) => Number(b.fresh) - Number(a.fresh)).slice(0, max);
  return `<div class="rs-ch"><small class="rs-ch-h">${ico('ui:flag')}Challenges</small>${rows.map(c => `
    <div class="rs-ch-row${c.fresh ? ' done' : ''}">${mark(c.icon, 15)}<b>${esc(c.label)}</b>
      <i class="rs-ch-bar" style="--a:${(c.before / c.goal).toFixed(3)};--f:${(c.value / c.goal).toFixed(3)}"></i>
      <small>${c.fresh ? `+${fmtXp(c.xp)}` : `${c.value}/${c.goal}`}</small>
    </div>`).join('')}</div>`;
}

// The unlock the results reel stamps for a finished challenge, as main.js builds it.
export const challengeUnlock = c => ({ kind: 'challenge', id: c.id, name: c.label, xp: c.xp, period: c.period, icon: c.icon });

// The reel's card for a {kind:'challenge'} unlock, or null for every other kind.
export function challengeStamp(u) {
  if (u?.kind !== 'challenge') return null;
  return `<div class="rx-card rx-unlock rx-chal">
    <span class="rx-mark rx-chal-mark">${mark(u.icon ?? 'ui:flag', 72)}<i class="rx-chal-ok">${ico('check')}</i></span>
    <span class="rx-kick">${esc(PERIOD_NAME[u.period] ?? '')} challenge complete</span>
    <h2>${esc(u.name)}</h2>
    <small class="rx-chal-xp">+${fmtXp(u.xp ?? 0)} XP</small>
  </div>`;
}

