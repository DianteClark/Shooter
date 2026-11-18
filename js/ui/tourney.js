// Weekend tournaments on screen (docs/TOURNAMENTS.md): the bracket screen, the Multiplayer Spotlight card's line, the
// results' stamps and the Trophy Case shelf. Data from Progress.tourney(); the rules are in js/shared/tourney-items.js
// and the bracket in js/shared/tournaments.js.
//
//   tourneyScreen(menu, { onBack, onPlay, owner, name, party })   the bracket; onPlay(plan) starts the player's round
//   tourneySpot()                       { brow, sub, live } for the Spotlight card
//   tourneyUnlocks(result)              the results reel's stamps for a round;  tourneyStamp(u) draws one
//   tourneyShelf()                      the Trophy Case's shelf of weekends played
import { Progress } from './progress.js';
import { esc, swatchCss } from './widgets.js';
import { ico, header } from './yard.js';
import { icon } from './icons.js';
import { cardHtml } from './cards.js';
import { emblemSvg } from './emblems.js';
import { stagger, pop } from './motion.js';
import { getCamo } from '../shared/camos.js';
import { MODES } from '../shared/modes.js';
import { MAPS } from '../shared/map.js';
import { bracketFor, resolveBracket, roundTitle } from '../shared/tournaments.js';
import { CUPS, ROUND_NAMES, PLACES, ENTRY_XP, ROUND_XP, TOURNEY_CARDS, TN_EMBLEM, TN_CAMO, MAX_ENTRIES, placeName, dayIso } from '../shared/tourney-items.js';

const fmt = n => Math.round(n).toLocaleString('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateText = key => { const [y, m, d] = dayIso(key).split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
// "2d 4h", "3h 12m", "12m"
export function leftText(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}
const sqName = s => (s ? `${s.tag ? `[${s.tag}] ` : ''}${s.name}` : '');
const planLine = r => `${MODES[r.mode]?.name ?? r.mode} · ${MAPS[r.mapId]?.name ?? r.mapId}`;

// The Spotlight card on Multiplayer > Standard: what the cup is doing right now.
export function tourneySpot(now = new Date()) {
  const t = Progress.tourney(now), info = t.info;
  if (!info.live) return { live: false, brow: 'Weekend tournament', name: info.cup.name, sub: `Opens in ${leftText(info.opensAt - now)} · ${info.cup.note}` };
  const left = `${leftText(info.closesAt - now)} left`, r = t.run;
  const sub = r.champion ? `Champion! · ${left}` : r.round !== null ? `${ROUND_NAMES[r.round]} next · ${left}`
    : r.canReenter ? `Knocked out · re-entry open · ${left}` : r.out ? `Out this weekend · ${left}` : `Live now · ${info.cup.note} · ${left}`;
  return { live: true, brow: 'Tournament · Live', name: info.cup.name, sub };
}

/* ---------- The bracket screen ---------- */
// What a match shows: each side's squad if it is known yet, and the winner if it is revealed.
function shownBracket(res) {
  const { matches, reveal } = res;
  const open = (round, m) => { const x = matches[round][m]; return x.you ? !!x.winner : round < reveal; };
  return matches.map((list, round) => list.map((x, m) => {
    const known = side => round === 0 || open(round - 1, 2 * m + side);
    return { ...x, a: known(0) ? x.a : null, b: known(1) ? x.b : null, winner: open(round, m) ? x.winner : null };
  }));
}

function sqRow(s, match, mineSide) {
  if (!s) return `<div class="tn-sq tbd"><i class="tn-seed"></i><b>To be decided</b></div>`;
  const cls = [s.kind === 'you' ? 'you' : '', match.winner ? (match.winner === s ? 'win' : 'lose') : ''].filter(Boolean).join(' ');
  return `<div class="tn-sq ${cls}"><i class="tn-seed">${s.seed}</i>${s.tag ? `<u>${esc(s.tag)}</u>` : `<u class="me">${ico('ui:party', '', 11)}</u>`}<b>${esc(s.name)}</b>${match.winner === s ? `<em>${ico('check', '', 11)}</em>` : ''}</div>`;
}

function bracketHtml(b, shown, champion) {
  const col = (list, round) => `
    <div class="tn-col" data-round="${round}">
      <h4><b>${esc(ROUND_NAMES[round])}</b><small>${esc(planLine(b.rounds[round]))}</small></h4>
      <div class="tn-ms">${list.map(x => `<div class="tn-m${x.you ? ' mine' : ''}">${sqRow(x.a, x)}${sqRow(x.b, x)}</div>`).join('')}</div>
    </div>`;
  return `<div class="tn-bracket">${shown.map(col).join('')}
    <div class="tn-col tn-champ"><h4><b>Champion</b><small>${esc(b.cup.name)}</small></h4>
      <div class="tn-ms"><div class="tn-m tn-cup${champion?.kind === 'you' ? ' mine' : ''}">${icon('ui:cup', { size: 26 })}<b>${champion ? esc(sqName(champion)) : 'To be decided'}</b></div></div>
    </div></div>`;
}

function rewardsHtml(best, weekBest) {
  return `<div class="tn-rw">${TOURNEY_CARDS.map(c => {
    const own = best >= c.place, xp = c.place === 1 ? ENTRY_XP : ROUND_XP[c.place - 2];
    return `<button class="tn-rw-row${own ? ' own' : ''}${weekBest >= c.place ? ' now' : ''}" data-act="tnReward" data-kind="card" data-id="${c.id}">
      <span class="tn-rw-card">${cardHtml(c.id, { size: 74, title: '', sub: '', locked: !own })}</span>
      <span class="tn-rw-tx"><b>${esc(PLACES[c.place].name)}</b><small>+${fmt(xp)} XP${c.place === 4 ? ' · crest and camo' : ''}</small></span>
      ${own ? `<i class="tn-ok">${ico('check', '', 12)}</i>` : ''}</button>`;
  }).join('')}
    <div class="tn-rw-x">
      <button class="tn-rw-mini${best >= 4 ? ' own' : ''}" data-act="tnReward" data-kind="emblem" data-id="${TN_EMBLEM}">${emblemSvg(TN_EMBLEM, 30)}<small>Crest</small></button>
      <button class="tn-rw-mini${best >= 4 ? ' own' : ''}" data-act="tnReward" data-kind="camo" data-id="${TN_CAMO}"><i class="tn-sw" style="background:${swatchCss(getCamo(TN_CAMO))}"></i><small>Camo</small></button>
    </div></div>`;
}

// state for the side panel: what the player can do now.
function sideHtml(t, b, res, { party }) {
  const info = t.info, r = t.run;
  let kick, line, sub = '', btn = '';
  if (!info.live) {
    kick = 'Next weekend';
    line = `${info.cup.name} opens in ${leftText(info.opensAt - Date.now())}`;
    sub = 'Friday 18:00 to Sunday midnight. Eight squads, three rounds, one champion.';
  } else if (r.champion) {
    kick = 'Your run'; line = `${info.cup.name} champion`; sub = 'Your crest and camo are in the Trophy Case.';
  } else if (res.next) {
    const plan = b.rounds[res.next.round];
    kick = r.entered ? `Entry ${MAX_ENTRIES - r.entriesLeft} of ${MAX_ENTRIES}` : `${info.cup.name} · ${info.cup.note}`;
    line = roundTitle(res.next.round, res.next.opponent);
    sub = planLine(plan);
    const label = r.entered ? `Play ${ROUND_NAMES[res.next.round]}` : 'Enter and play';
    btn = `<button class="btn is-primary tn-play" data-act="tnPlay" data-sound="confirm">${ico('play')}<span><b>${esc(label)}</b><small>${party ? `With your party · ${esc(sub)}` : esc(sub)}</small></span></button>`;
  } else if (r.canReenter) {
    kick = 'Knocked out'; line = `Out in the ${ROUND_NAMES[r.roundsWon]}`; sub = `One re-entry left this weekend: back to the quarter-final.`;
    btn = `<button class="btn is-primary tn-play" data-act="tnReenter" data-sound="confirm">${ico('reload')}<span><b>Re-enter</b><small>${MAX_ENTRIES - 1} re-entry a weekend</small></span></button>`;
  } else {
    kick = 'Knocked out'; line = `Out in the ${ROUND_NAMES[r.roundsWon] ?? 'Final'}`; sub = `Best this weekend: ${placeName(r.best) || 'none'}. The next cup opens Friday.`;
  }
  return `
    <section class="tn-now">
      <small class="tn-kick">${esc(kick)}</small>
      <b class="tn-line">${esc(line)}</b>
      ${sub ? `<small class="tn-sub">${esc(sub)}</small>` : ''}
      ${btn}
    </section>
    <h4 class="tn-h">${ico('ui:cup', '', 14)}Placing rewards<small>once each</small></h4>
    ${rewardsHtml(t.best, info.live ? r.best : 0)}`;
}

// The bracket screen. owner: whose bracket (this player's id, or the party host's); name: that squad's name; party:
// true in a friend room (the host plays the rounds with everyone in it). onPlay({ key, round, plan, opponent, bracket,
// enter }) starts a round (enter: this tap enters or re-enters the cup first).
export function tourneyScreen(menu, { onBack, onPlay, owner, name, party = false, onReward = null }) {
  const render = (fresh = false) => {
    menu.el.dataset.screen = 'tourney';
    const now = new Date(), t = Progress.tourney(now), info = t.info;
    const key = info.live ? info.key : info.next.key;
    const runOwner = info.live && t.owner ? t.owner : owner;
    const b = bracketFor(key, runOwner, { name });
    const run = info.live && t.run.entered ? { roundsWon: t.run.roundsWon, out: t.run.out } : null;
    const res = resolveBracket(b, run, { all: false });
    const shown = shownBracket(res);
    const champ = res.reveal >= 3 ? res.champion : null;
    const tag = info.live ? `${ico('timer', '', 14)}${leftText(info.closesAt - now)} left` : `${ico('timer', '', 14)}Opens in ${leftText(info.opensAt - now)}`;
    menu.el.innerHTML = `
      ${header({ back: 'tnBack', label: 'Back', title: `${b.cup.name}${info.live ? '' : ' · preview'}`, cls: 'tn-bar', extra: `<span class="hdr-tag tn-left${info.live ? ' live' : ''}">${tag}</span>` })}
      <div class="tn-wrap" data-cup="${b.cup.id}">
        <div class="tn-main scroll-x">${bracketHtml(b, shown, champ)}</div>
        <aside class="tn-side scroll-y" data-in="left">${sideHtml(t, b, res, { party })}</aside>
      </div>`;
    if (fresh) stagger(menu.el.querySelectorAll('.tn-m'), 'up', { step: 18, max: 8 });
    const forfeit = Progress.takeForfeit();
    if (forfeit) menu.toast(`Your ${ROUND_NAMES[forfeit.round]} was left unfinished: it counts as lost`, 'warn');
    return { b, res, t };
  };
  let view = render(true);
  const play = enter => {
    view = render();
    const { b, res, t } = view;
    if (!t.info.live) { menu.toast('The cup is not open yet'); return; }
    if (enter) {
      if (!Progress.enterTourney(owner)) { menu.toast('No entries left this weekend', 'warn'); return; }
      view = render();
    }
    const nx = view.res.next;
    if (!nx) return;
    onPlay({ key: view.b.key, round: nx.round, plan: view.b.rounds[nx.round], opponent: nx.opponent, bracket: view.b });
  };
  menu.on({
    tnBack: () => onBack(),
    tnPlay: () => play(!Progress.tourney().run.entered),
    tnReenter: () => play(true),
    tnReward: ({ kind, id }, el) => { pop(el); onReward?.(kind, id); },
  });
  menu.show();
  return { refresh: () => { view = render(); } };
}

/* ---------- Results ---------- */
// The reel's stamps for a round: the round's outcome first, then anything it newly owns.
export function tourneyUnlocks(r) {
  if (!r) return [];
  const out = [{ kind: 'tourney', what: 'round', round: r.round, won: r.won, place: r.place, champion: r.champion, out: r.out, opponent: r.opponent ?? null, cup: r.cup ?? '' }];
  for (const id of r.rewards ?? []) {
    const [kind, rid] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
    if (kind === 'card') out.push({ kind: 'card', id: rid, req: `Weekend tournament: ${TOURNEY_CARDS.find(c => c.id === rid)?.name ?? ''}` });
    else if (kind === 'camo') { const c = getCamo(rid); out.push({ kind: 'camo', id: rid, name: c.name, colors: c.colors, weaponName: 'every gun' }); }
    else if (kind === 'emblem') out.push({ kind: 'tourney', what: 'emblem', id: rid });
  }
  return out;
}

export function tourneyStamp(u) {
  if (u?.kind !== 'tourney') return null;
  if (u.what === 'emblem') {
    return `<div class="rx-card rx-unlock rx-tn"><span class="rx-mark">${emblemSvg(u.id, 84)}</span><span class="rx-kick">New emblem</span><h2>Champion's Crest</h2><small>Weekend tournament champion</small></div>`;
  }
  const head = u.champion ? 'Champion!' : u.won ? `${ROUND_NAMES[u.round]} won` : `Out in the ${ROUND_NAMES[u.round]}`;
  const sub = u.champion ? `${u.cup || 'The cup'} is yours` : u.won ? `Into the ${ROUND_NAMES[u.round + 1]}` : `Placed: ${placeName(u.place)}`;
  return `<div class="rx-card rx-unlock rx-tn${u.won ? ' won' : ''}">
    <span class="rx-mark">${icon(u.champion ? 'ui:crown' : 'ui:cup', { size: 72 })}</span>
    <span class="rx-kick">${esc(u.cup || 'Tournament')}${u.opponent ? ` · vs ${esc(u.opponent)}` : ''}</span>
    <h2>${esc(head)}</h2><small>${esc(sub)}</small></div>`;
}

/* ---------- The Trophy Case shelf ---------- */
export function tourneyShelf() {
  const t = Progress.tourney();
  const rows = t.log.slice().reverse();
  return `<section class="tc-tn" data-in="up">
    <h4>${ico('ui:cup')}Tournaments<small>${rows.length ? `${rows.length} weekend${rows.length === 1 ? '' : 's'} · best: ${esc(placeName(t.best))}` : 'Weekend cups'}</small></h4>
    ${rows.length ? `<div class="tc-tn-row">${rows.map(([key, cup, place]) => `
      <div class="tc-tn-t p${place}">${icon(place >= 4 ? 'ui:crown' : 'ui:cup', { size: 22 })}<b>${esc(placeName(place))}</b><small>${esc(CUPS[cup]?.name ?? '')}</small><em>${esc(dateText(key))}</em></div>`).join('')}</div>`
      : '<p class="tc-none">No cups played yet. Every weekend from Friday 18:00 there is one on Multiplayer.</p>'}
  </section>`;
}
