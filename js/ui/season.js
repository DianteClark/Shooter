// Seasons and ranked on screen (docs/SEASONS.md): the title's season panel, the Season screen (Track, Weekly, Ranked),
// the rank badge, and the results strip and stamps. Data from Progress.season() / Progress.ranked(); the rules are in
// js/shared/seasons.js and js/shared/ranked.js.
//
//   seasonChip() / profileRank()        the title's Season chip (days left, a dot when tiers wait) and the card's rank
//   seasonScreen(menu, { onBack, onPlayRanked, tab })   tabs: track | weekly | ranked
//   rankBadge(code, size) / rankChip(code)             the division mark (code from ranked.js codeOf; -1 unranked)
//   seasonStrip(track, ranked)          rows for the results' progress card;  seasonStamp(u) reel cards
//   seasonUnlocks(track, ranked)        the reel's stamps for a match: placed, promoted, tiers reached
import { Progress } from './progress.js';
import { esc, swatchCss } from './widgets.js';
import { icon } from './icons.js';
import { ico, header } from './yard.js';
import { cardHtml } from './cards.js';
import { emblemSvg, getEmblem } from './emblems.js';
import { getSkin, getOperator } from './operators.js';
import { getCamo } from '../shared/camos.js';
import { WEAPONS } from '../shared/weapons.js';
import { MODES } from '../shared/modes.js';
import { TRACK_TIERS, trackRewards, seasonAt, rankedRewards, SEASON_DEFS } from '../shared/seasons.js';
import { DIVISIONS, DIVISION_SPAN } from '../shared/season-items.js';
import { fromCode, division, RANKED_RULES, MOVE, PLACEMENTS, CHAMPION, ladder, carriedSr, countdownText } from '../shared/ranked.js';
import { getCard } from '../shared/progression.js';
import { enter, play, pop, DUR, reducedMotion } from './motion.js';
import { playTile } from './challenges.js';     // QoL: a weekly challenge's Play shortcut.
import { playFor } from './shortcuts.js';

const fmt = n => Math.round(n).toLocaleString('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateText = ms => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const daysText = n => (n <= 1 ? 'Last day' : `${n} days left`);
const KIND = { card: 'Calling card', emblem: 'Emblem', camo: 'Camo', skin: 'Operator skin', weapon: 'Weapon unlock', operator: 'Operator unlock' };

/* ---------- The rank badge ---------- */
// A cut shield in the division colour with its tier as one to three bars; Champion wears a crown; unranked a grey
// shield with a question mark. Flat polygons, no ids, safe to repeat anywhere.
export function rankBadge(code, size = 24) {
  const r = fromCode(code);
  const d = r ? DIVISIONS[r.div] : { color: '#5a6470', light: '#c8ccd2', dark: '#151a20' };
  const outer = '16,1 30,7 30,19 16,31 2,19 2,7', inner = '16,4.5 27,9 27,18 16,27.5 5,18 5,9';
  let glyph;
  if (!r) glyph = `<text x="16" y="21.5" text-anchor="middle" font-size="14" font-family="sans-serif" font-weight="700" fill="${d.light}">?</text>`;
  else if (r.tier === null) glyph = `<polygon points="8,20 8,10 12,14 16,8 20,14 24,10 24,20" fill="${d.light}"/><rect x="8" y="21" width="16" height="2.6" fill="${d.color}"/>`;
  else glyph = Array.from({ length: r.tier + 1 }, (_, i) => `<polygon points="9,${20 - i * 5} 16,${16 - i * 5} 23,${20 - i * 5} 23,${22.6 - i * 5} 16,${18.6 - i * 5} 9,${22.6 - i * 5}" fill="${d.light}"/>`).join('');
  return `<svg class="rk-badge" viewBox="0 0 32 32" width="${size}" height="${size}" overflow="visible" aria-hidden="true"><polygon points="${outer}" fill="#000" opacity=".4" transform="translate(0 1.2)"/><polygon points="${outer}" fill="${d.color}"/><polygon points="${inner}" fill="${d.dark}"/>${glyph}</svg>`;
}
export const rankName = code => fromCode(code)?.name ?? 'Unranked';
export const rankChip = (code, { size = 16, label = true } = {}) =>
  `<i class="rk-chip" title="${esc(rankName(code))}">${rankBadge(code, size)}${label ? `<b>${esc(rankName(code))}</b>` : ''}</i>`;

/* ---------- Reward art ---------- */
function rewardArt(r, size = 64) {
  switch (r.kind) {
    case 'card': return `<span class="sz-art sz-card">${cardHtml(r.id, { size: size * 1.5, title: '', sub: '' })}</span>`;
    case 'emblem': return `<span class="sz-art sz-emb">${emblemSvg(r.id, size * 0.8)}</span>`;
    case 'camo': return `<span class="sz-art sz-camo" style="background:${swatchCss(getCamo(r.id))}"></span>`;
    case 'skin': {
      const s = getSkin(r.id), c = n => `#${(n ?? 0).toString(16).padStart(6, '0')}`;
      return `<span class="sz-art sz-skin" style="--g:${c(s?.gear)};--s:${c(s?.sleeve)};--a:${c(s?.accent)}">${icon('ui:operator', { size: size * 0.62 })}</span>`;
    }
    case 'weapon': return `<span class="sz-art sz-gun">${icon(r.id, { size: size * 0.9 })}</span>`;
    case 'operator': return `<span class="sz-art sz-op">${icon('ui:operator', { size: size * 0.7 })}</span>`;
  }
  return '';
}
function rewardName(r) {
  switch (r.kind) {
    case 'card': return getCard(r.id)?.name ?? r.id;
    case 'emblem': return getEmblem(r.id)?.name ?? r.id;
    case 'camo': return getCamo(r.id).name;
    case 'skin': { const s = getSkin(r.id); return s ? `${getOperator(s.operator)?.name ?? ''}: ${s.name}` : r.id; }
    case 'weapon': return WEAPONS[r.id]?.name ?? r.id;
    case 'operator': return getOperator(r.id)?.name ?? r.id;
  }
  return r.id;
}

/* ---------- Title: the season chip (the free slot of the title's button grid) and the rank on the profile card ---------- */
export function seasonChip() {
  let s;
  try { s = Progress.season(); } catch (err) { console.error('season', err); return ''; }
  const { info } = s, def = info.def ?? info.next;
  const left = info.def ? (info.daysLeft <= 1 ? 'Last day' : `${info.daysLeft}d left`) : `In ${info.daysLeft}d`;
  return `<button class="chip tsn-chip${s.claimable ? ' has-claim' : ''}" data-act="season" data-in="up" style="--sa:${def.theme[3]}" aria-label="Season, ${esc(left)}">
    ${icon('ui:star', { size: 15 })}<b>${esc(info.def ? (info.replay ? 'Replay' : `Season ${def.n}`) : `Season ${def.n}`)}</b><small>${esc(left)}</small>${s.claimable ? '<i class="tsn-dot"></i>' : ''}</button>`;
}
// The rank on the title's profile card: the division badge once placed (nothing while unranked).
export function profileRank() {
  try {
    const rk = Progress.ranked();
    return rk.placed ? `<i class="pc-rk" title="${esc(rk.division.name)}">${rankBadge(rk.code, 20)}</i>` : '';
  } catch { return ''; }
}

/* ---------- The Season screen ---------- */
const TABS = [['track', 'Track', 'ui:star'], ['weekly', 'Weekly', 'timer'], ['ranked', 'Ranked', 'ui:rank']];
const last = { tab: 'track' };
let countdownTimer = 0;

function trackTile(r, s, open) {
  const reached = s.info.def && r.tier <= s.tier, claimed = r.tier <= s.claimed && reached;
  const state = claimed ? 'got' : reached ? 'claim' : r.tier === s.tier + 1 ? 'next' : 'later';
  const big = r.kind === 'skin' || r.kind === 'weapon' || r.kind === 'operator' || r.tier % 25 === 0;
  return `<button class="sz-tile ${state}${big ? ' big' : ''}${open ? ' open' : ''}" data-act="szTier" data-t="${r.tier}" style="--i:${r.tier}">
    <span class="sz-n t-num">${r.tier}</span>
    ${rewardArt(r, 52)}
    <b class="sz-name">${esc(rewardName(r))}</b>
    <small class="sz-kind">${esc(KIND[r.kind])}</small>
    ${claimed ? `<i class="sz-ok">${ico('check', '', 14)}</i>` : state === 'claim' ? '<i class="sz-dot"></i>' : ''}
  </button>`;
}

function trackPane(s, open) {
  const def = s.info.def ?? s.info.next;
  const rewards = trackRewards(def);
  const r = rewards[Math.max(0, Math.min(TRACK_TIERS, open) - 1)];
  const owned = Progress.hasReward(r.own) || (r.kind === 'weapon' && Progress.isItemUnlocked('weapon', r.id)) || (r.kind === 'operator' && Progress.isOperatorUnlocked(r.id));
  const pre = !s.info.def;
  return `
    <div class="sz-top">
      <span class="sz-tierbig"><small>Tier</small><b class="t-num">${pre ? 0 : s.tier}</b><small>of ${TRACK_TIERS}</small></span>
      <span class="sz-prog">
        <span class="sz-line"><b>${pre ? `Season ${def.n} opens ${dateText(s.info.endsAt)}` : s.maxed ? 'Track complete' : `${fmt(s.into)} / ${fmt(s.span)} XP to tier ${s.tier + 1}`}</b><small>${ico('ui:star', '', 12)}${s.stars} star${s.stars === 1 ? '' : 's'} · Match XP and weekly stars fill it</small></span>
        <i class="sz-bar"><i style="transform:scaleX(${(pre ? 0 : s.maxed ? 1 : s.into / s.span).toFixed(3)})"></i></i>
      </span>
      <button class="btn is-primary sz-claimall" data-act="szClaim" data-sound="confirm" ${s.claimable ? '' : 'disabled'}>${ico('check')}<span><b>Claim</b><small>${s.claimable ? `${s.claimable} reward${s.claimable === 1 ? '' : 's'}` : 'Nothing yet'}</small></span></button>
    </div>
    <div class="sz-strip scroll-x">${rewards.map(x => trackTile(x, s, x.tier === open)).join('')}</div>
    <div class="sz-detail">
      ${rewardArt(r, 36)}
      <span class="sz-dt"><b>Tier ${r.tier}: ${esc(rewardName(r))}</b><small>${esc(KIND[r.kind])}${r.kind === 'weapon' || r.kind === 'operator' ? ' · early: its usual unlock still works' : ''}${owned ? ' · Owned' : r.tier <= s.tier && !pre ? ' · Ready to claim' : ''}</small></span>
      <small class="sz-free">Free for everyone. No boosts, nothing to buy.</small>
    </div>`;
}

function weeklyPane(s, week, canPlay = false) {
  const weeks = Progress.weekly();
  if (!weeks.length) return `<p class="sz-empty">${ico('ui:info', '', 14)}Weekly sets open with Season ${(s.info.next ?? s.info.def).n} on ${dateText(s.info.endsAt)}: five challenges a week, each worth one or two stars, a star a tier.</p>`;
  const w = weeks[Math.max(0, Math.min(weeks.length - 1, week))];
  return `
    <nav class="sz-weeks">${weeks.map(x => {
      const done = x.list.filter(c => c.done).length;
      return `<button class="seg${x.week === w.week ? ' on' : ''}${x.open ? '' : ' shut'}" data-act="szWeek" data-w="${x.week}">${x.open ? '' : ico('lock', '', 12)}<b>Week ${x.week + 1}</b><small>${x.open ? `${done}/${x.list.length}` : dateText(x.opensAt)}</small></button>`;
    }).join('')}</nav>
    <div class="sz-chs scroll-y">${w.list.map((c, i) => `
      <div class="sz-ch${c.done ? ' done' : ''}${w.open ? '' : ' shut'}" style="--i:${i}">
        ${w.open && canPlay ? playTile(c, 'sz-ch-ico', 22, true) : `<span class="sz-ch-ico">${icon(c.icon, { size: 22, square: true })}</span>`}
        <span class="sz-ch-body"><b>${esc(c.label)}</b><span class="sz-ch-prog"><i class="sz-bar"><i style="transform:scaleX(${(c.value / c.goal).toFixed(3)})"></i></i><small class="t-num">${w.open ? `${fmt(c.value)} / ${fmt(c.goal)}` : `Opens ${dateText(w.opensAt)}`}</small></span></span>
        <span class="sz-ch-stars">${'<i></i>'.repeat(c.stars)}<small>${c.done ? 'Earned' : `${c.stars} tier${c.stars > 1 ? 's' : ''}`}</small></span>
      </div>`).join('')}
    </div>`;
}

// The Ranked hub (docs/RANKED.md, ROADMAP item 60): your division and progress (placement pips while placing), the
// season's countdown and soft reset, the rewards track (every division's card, crest and title, the ranked camo at
// Gold) and the titles to wear. The countdown ticks on a 30 s timer while the tab shows (seasonScreen), never per frame.
function rankedPane(s) {
  const rk = s.ranked, def = s.info.def;
  const d = rk.division;
  const into = d ? (d.next === null ? 1 : (rk.sr - d.floor) / (d.next - d.floor)) : rk.pm / PLACEMENTS;
  const rewards = def ? rankedRewards(def) : [];
  const steps = ladder(rk), peak = rk.placed ? division(Math.max(rk.peak, rk.sr)).div : -1;
  const modes = RANKED_RULES.modes.map(m => MODES[m]?.name ?? m).join(', ');
  const worn = Progress.title(), titles = Progress.titles().filter(t => t.owned);
  const carry = carriedSr(rk);
  const pips = Array.from({ length: PLACEMENTS }, (_, i) => `<i class="${i < rk.pw ? 'w' : i < rk.pm ? 'l' : ''}"></i>`).join('');
  // Where your SR sits along the track (Champion's column open-ended).
  const at = rk.placed ? Math.min(6.5, rk.sr >= CHAMPION ? 6 + Math.min(0.5, (rk.sr - CHAMPION) / 1800) : rk.sr / DIVISION_SPAN) : -1;
  const col = (st, i) => {
    const dv = DIVISIONS[i], rw = rewards[i];
    const state = st.current ? 'now' : st.reached ? 'got' : 'later';
    return `<div class="rk-step ${state}" style="--dc:${dv.color};--dl:${dv.light}">
      <span class="rk-step-h">${rankBadge(i === 6 ? 18 : i * 3 + (st.current && d ? d.tier ?? 0 : 0), 30)}<b>${esc(dv.name)}</b><small class="t-num">${i === 6 ? `${fmt(CHAMPION)}+` : fmt(i * DIVISION_SPAN)}</small></span>
      ${rw ? `<span class="rk-step-rw">
        <span class="rk-rw-card">${cardHtml(rw.card, { size: 62, title: '', sub: '' })}</span>
        <span class="rk-rw-row">${emblemSvg(rw.emblem, 22)}${rw.camo ? `<i class="rk-rw-camo" style="background:${swatchCss(getCamo(rw.camo))}" title="${esc(getCamo(rw.camo).name)} camo"></i>` : ''}</span>
        <small class="rk-rw-title">${esc(rw.titleName)}</small>
      </span>` : '<span class="rk-step-rw"><small class="rk-rw-title">Rewards from Season 1</small></span>'}
      ${st.reached ? `<i class="rk-step-ok">${ico('check', '', 12)}</i>` : ''}
    </div>`;
  };
  return `
    <div class="sz-rk rk-hub">
      <div class="sz-rk-me">
        <span class="sz-rk-badge">${rankBadge(rk.code, 70)}</span>
        <b class="sz-rk-name">${esc(d ? d.name : rk.pm ? 'Placements' : 'Unranked')}</b>
        <small class="sz-rk-sr">${d ? `${fmt(rk.sr)} SR${rk.last ? ` <em class="${rk.last > 0 ? 'up' : 'down'}">${rk.last > 0 ? '+' : ''}${rk.last}</em>` : ''}` : `${rk.pm} of ${PLACEMENTS} placement matches`}</small>
        ${d ? `<i class="sz-bar"><i style="transform:scaleX(${Math.max(0, Math.min(1, into)).toFixed(3)})"></i></i>` : `<span class="rk-pips" aria-label="${rk.pw} won of ${rk.pm} placements">${pips}</span>`}
        <small class="sz-rk-next">${d ? (d.next === null ? 'Top division' : `${fmt(d.next - rk.sr)} SR to ${esc(division(d.next).name)}`) : `${PLACEMENTS - rk.pm} to go${rk.base >= 0 ? ` · from ${fmt(rk.base)} SR` : ''}`}</small>
        <span class="sz-rk-wl"><span><b>${rk.w}</b><small>Wins</small></span><span><b>${rk.l}</b><small>Losses</small></span><span><b>${rk.placed ? fmt(rk.peak) : '-'}</b><small>Best</small></span></span>
        <button class="rk-worn${worn ? '' : ' none'}" data-act="rkTitles" data-sound="tab">${ico('ui:rank', '', 12)}<b>${esc(worn ? worn.name : titles.length ? 'Wear a title' : 'No titles yet')}</b>${worn ? `<small>S${worn.n}</small>` : ''}</button>
        <button class="btn is-primary sz-rk-play" data-act="szPlayRanked" data-sound="confirm">${ico('play')}<b>Play Ranked</b></button>
      </div>
      <div class="sz-rk-side scroll-y">
        <div class="rk-season">
          <span class="rk-sn">${ico('ui:star', '', 13)}<b>${esc(s.info.def ? s.info.title : 'Preseason')}</b><small>Ranked</small></span>
          <span class="rk-count">${ico('timer', '', 13)}<b class="rk-count-t t-num" data-ends="${s.info.endsAt}">${countdownText(s.info.endsAt - Date.now())}</b><small>${def ? 'left' : 'to Season 1'}</small></span>
          <small class="rk-reset">${def ? `Soft reset ${dateText(s.info.endsAt)}: ${rk.placed ? `you would carry ${fmt(carry)} SR into next season's placements` : 'three quarters of your SR carries into next season\'s placements'}.` : `Season 1 opens ${dateText(s.info.endsAt)}.`}</small>
        </div>
        <div class="rk-track scroll-x" style="--at:${at}">
          ${at >= 0 ? '<i class="rk-you" aria-hidden="true"></i>' : ''}
          ${steps.map(col).join('')}
        </div>
        <p class="sz-rk-note">${def ? `End of season: the calling card, crest and title of every division up to your best, and the ${esc(getCamo(rewards[2]?.camo ?? '').name)} camo from ${DIVISIONS[2].name} up.${peak >= 0 ? ` So far: ${esc(DIVISIONS[peak].name)}.` : ''}` : 'Season 1 pays a calling card, crest and title for every division reached, and a camo from Gold up.'}</p>
        <p class="sz-rk-rules"><b>${esc(s.info.title)} Ranked</b> ${esc(modes)} on medium maps, set rules, no modifiers. ${PLACEMENTS} placement matches, then a win moves you about +${MOVE.win} and a loss about -${MOVE.loss}, more or less by how you played and who you played. You meet players near your rating. The first loss that would drop you out of a division stops on its floor. Training and Custom never count.</p>
      </div>
    </div>`;
}

// The title picker: every title owned (newest season first), and None.
function titlesSheet() {
  const all = Progress.titles().filter(t => t.owned).sort((a, b) => b.n - a.n || b.division - a.division);
  return `<div class="rk-titles" data-in="up">
    <b class="rk-titles-h">Titles</b>
    <div class="rk-titles-list scroll-y">
      <button class="rk-tl${all.some(t => t.worn) ? '' : ' on'}" data-act="rkWear" data-id="" data-sound="tab"><b>None</b></button>
      ${all.map(t => `<button class="rk-tl${t.worn ? ' on' : ''}" data-act="rkWear" data-id="${esc(t.id)}" data-sound="tab" style="--dc:${DIVISIONS[t.division].color}"><b>${esc(t.name)}</b><small>Season ${t.n}</small></button>`).join('')}
    </div>
    ${all.length ? '' : '<small class="rk-titles-none">Titles are paid when a season ends: one for every division you reached.</small>'}
    <button class="btn rk-titles-done" data-act="rkTitlesDone" data-sound="back"><b>Done</b></button>
  </div>`;
}

export function seasonScreen(menu, { onBack, onPlayRanked, onPlay = null, tab = last.tab }) {
  const state = { tab: TABS.some(t => t[0] === tab) ? tab : 'track', open: null, week: null, claiming: false };
  menu.el.dataset.screen = 'season';
  const paint = (first = false) => {
    const s = Progress.season();
    const def = s.info.def ?? s.info.next;
    if (state.open === null) state.open = s.info.def ? Math.min(TRACK_TIERS, Math.max(1, s.claimable ? s.claimed + 1 : s.tier + 1)) : 1;
    if (state.week === null) state.week = s.info.week;
    const body = state.tab === 'track' ? trackPane(s, state.open) : state.tab === 'weekly' ? weeklyPane(s, state.week, !!onPlay) : rankedPane(s);
    menu.el.style.setProperty('--sa', def.theme[3]);
    menu.el.style.setProperty('--sg', def.theme[1]);
    menu.el.innerHTML = `
      ${header({ back: 'szBack', label: 'Done', title: s.info.def ? s.info.title : `Season ${def.n}: ${def.name}`, cls: 'sz-bar-h', extra: `
        <nav class="sz-tabs">${TABS.map(([id, name, icn]) => `<button class="seg${state.tab === id ? ' on' : ''}" data-act="szTab" data-tab="${id}" data-sound="tab">${ico(icn, '', 14)}<b>${name}</b></button>`).join('')}</nav>
        <span class="sz-left">${ico('timer', '', 14)}${s.info.def ? daysText(s.info.daysLeft) : `Opens in ${s.info.daysLeft}d`}</span>` })}
      <div class="sz sz-${state.tab}"${first ? ' data-in="up"' : ''}>${body}</div>`;
    const strip = menu.el.querySelector('.sz-strip'), on = strip?.querySelector('.sz-tile.open');
    if (strip && on) strip.scrollLeft = Math.max(0, on.offsetLeft - strip.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2);
  };
  // Claim: each reached tile pops in turn and turns to a tick, then the rewards are named in a toast.
  const claim = async () => {
    if (state.claiming) return;
    const s = Progress.season();
    if (!s.claimable) return;
    state.claiming = true;
    const from = s.claimed + 1;
    const got = Progress.claimSeason();
    const tiles = [...menu.el.querySelectorAll('.sz-tile.claim')];
    if (!reducedMotion()) {
      for (const [i, t] of tiles.slice(0, 12).entries()) {
        t.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        t.classList.add('claiming');
        play(t, [{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.12)', filter: 'brightness(1.6)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: DUR.slow, delay: 0 });
        await new Promise(r => setTimeout(r, i < 3 ? 260 : 120));
        t.classList.replace('claim', 'got');
        t.querySelector('.sz-dot')?.remove();
        t.insertAdjacentHTML('beforeend', `<i class="sz-ok">${ico('check', '', 14)}</i>`);
      }
    }
    state.claiming = false;
    state.open = Math.min(TRACK_TIERS, from + got.length - 1);
    paint();
    const fresh = got.filter(r => r.fresh);
    menu.toast(fresh.length === 1 ? `Claimed ${rewardName(fresh[0])}` : `Claimed ${got.length} tiers${fresh.length ? `: ${fresh.length} new item${fresh.length === 1 ? '' : 's'}` : ''}`);
    const box = menu.el.querySelector('.sz-claimall');
    if (box) pop(box);
  };
  menu.on({
    szBack: () => onBack(),
    szTab: ({ tab }) => { if (TABS.some(t => t[0] === tab)) { state.tab = last.tab = tab; paint(); } },
    szTier: ({ t }) => {
      state.open = Number(t);
      for (const el of menu.el.querySelectorAll('.sz-tile')) el.classList.toggle('open', Number(el.dataset.t) === state.open);
      const s = Progress.season(), pane = menu.el.querySelector('.sz-detail');
      if (pane) {
        const tmp = document.createElement('div');
        tmp.innerHTML = trackPane(s, state.open);
        pane.replaceWith(tmp.querySelector('.sz-detail'));
        enter(menu.el.querySelector('.sz-detail'), 'fade', { duration: 140 });
      }
    },
    szClaim: () => { claim(); },
    szWeek: ({ w }) => { state.week = Number(w); paint(); },
    chPlay: ({ stat }) => { const where = playFor(stat); if (where) onPlay?.(where); },
    szPlayRanked: () => onPlayRanked?.(),
    // Ranked hub: the title picker over the pane.
    rkTitles: () => {
      if (menu.el.querySelector('.rk-titles')) return;
      menu.el.querySelector('.sz')?.insertAdjacentHTML('beforeend', titlesSheet());
    },
    rkWear: ({ id }) => { if (Progress.setTitle(id || null)) { paint(); menu.el.querySelector('.sz')?.insertAdjacentHTML('beforeend', titlesSheet()); } },
    rkTitlesDone: () => menu.el.querySelector('.rk-titles')?.remove(),
  });
  // The hub's countdown: every 30 s while the Season screen shows (the timer stops itself once it is gone).
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const el = menu.el.querySelector('.rk-count-t');
    if (menu.el.dataset.screen !== 'season') { clearInterval(countdownTimer); return; }
    if (el) el.textContent = countdownText(Number(el.dataset.ends) - Date.now());
  }, 30000);
  paint(true);
  menu.show();
  // A season that ended since the last look: say what was claimed and paid for the player.
  const r = Progress.takeRollover();
  if (r) menu.toast(`${r.claimed.length ? `Season over: ${r.claimed.length} reached tier${r.claimed.length === 1 ? '' : 's'} claimed for you` : 'Season over'}${r.ranked ? `. Ranked reward: ${DIVISIONS[r.ranked.peakDiv].name}` : ''}`);
}

/* ---------- Results ---------- */
// Rows for the results' progress card: the track's tier move, the rank move, and weekly season challenges that moved.
export function seasonStrip(track, ranked) {
  if (!track && !ranked) return '';
  const info = seasonAt();
  const rows = [];
  if (track) {
    const span = track.tierXp, a = (track.xpBefore % span) / span, f = track.tierAfter > track.tierBefore ? 1 : (track.xpAfter % span) / span;
    rows.push(`<div class="rs-ch-row${track.tierAfter > track.tierBefore ? ' done' : ''}">${icon('ui:star', { size: 15, square: true })}<b>Tier ${track.tierBefore}${track.tierAfter > track.tierBefore ? ` to ${track.tierAfter}` : ''}</b>
      <i class="rs-ch-bar" style="--a:${track.tierAfter > track.tierBefore ? 0 : a.toFixed(3)};--f:${f.toFixed(3)}"></i><small>+${fmt(track.xpGained)}</small></div>`);
    for (const c of track.challenges.slice(0, 3)) rows.push(`<div class="rs-ch-row${c.fresh ? ' done' : ''}">${icon(c.icon, { size: 15, square: true })}<b>${esc(c.label)}</b>
      <i class="rs-ch-bar" style="--a:${(c.before / c.goal).toFixed(3)};--f:${(c.value / c.goal).toFixed(3)}"></i><small>${c.fresh ? `+${c.stars} star${c.stars > 1 ? 's' : ''}` : `${c.value}/${c.goal}`}</small></div>`);
  }
  if (ranked) {
    const after = ranked.after, code = after ? after.code : -1;
    const label = after ? `${after.name} · ${fmt(after.sr)} SR` : `Placement ${ranked.placement}/${ranked.placements}`;
    const d = after && after.next !== null ? (after.sr - after.floor) / (after.next - after.floor) : after ? 1 : ranked.placement / ranked.placements;
    const b = ranked.before && after ? Math.max(0, Math.min(1, (ranked.before.sr - after.floor) / ((after.next ?? after.floor + 1) - after.floor))) : 0;
    rows.push(`<div class="rs-ch-row rs-rk${ranked.promoted || ranked.placedNow ? ' done' : ''}">${rankBadge(code, 15)}<b>${esc(label)}</b>
      <i class="rs-ch-bar" style="--a:${Math.min(b, d).toFixed(3)};--f:${Math.max(0, Math.min(1, d)).toFixed(3)}"></i><small class="${ranked.delta > 0 ? 'up' : ranked.delta < 0 ? 'down' : ''}">${ranked.before ? `${ranked.delta > 0 ? '+' : ''}${ranked.delta}` : ranked.placedNow ? 'Placed' : 'Placing'}</small></div>`);
  }
  return `<div class="rs-ch rs-sn"><small class="rs-ch-h">${ico('ui:star', '', 10)}${esc(info.def ? info.short : 'Preseason')}${ranked ? ' · Ranked' : ''}</small>${rows.join('')}</div>`;
}

// The reel's stamps for a match: placed or promoted in ranked, and new tiers on the track.
export function seasonUnlocks(track, ranked) {
  const out = [];
  if (ranked?.placedNow && ranked.after) out.push({ kind: 'season', what: 'placed', code: ranked.after.code, name: ranked.after.name, sr: ranked.after.sr });
  else if (ranked?.promoted && ranked.after) out.push({ kind: 'season', what: 'promoted', code: ranked.after.code, name: ranked.after.name, sr: ranked.after.sr });
  if (track && track.tierAfter > track.tierBefore) out.push({ kind: 'season', what: 'tier', tier: track.tierAfter, from: track.tierBefore });
  return out;
}

export function seasonStamp(u) {
  if (u?.kind !== 'season') return null;
  if (u.what === 'tier') {
    const def = seasonAt().def;
    const r = def ? trackRewards(def)[u.tier - 1] : null;
    return `<div class="rx-card rx-unlock rx-season">
      <span class="rx-mark">${r ? rewardArt(r, 72) : icon('ui:star', { size: 72 })}</span>
      <span class="rx-kick">Season tier ${u.tier} reached</span>
      <h2>${r ? esc(rewardName(r)) : `Tier ${u.tier}`}</h2>
      <small>${u.tier - u.from > 1 ? `${u.tier - u.from} tiers ready` : 'Ready'} to claim on the Season screen</small>
    </div>`;
  }
  return `<div class="rx-card rx-unlock rx-season">
    <span class="rx-mark">${rankBadge(u.code, 84)}</span>
    <span class="rx-kick">${u.what === 'placed' ? 'Placement complete' : 'Promoted'}</span>
    <h2>${esc(u.name)}</h2>
    <small>${fmt(u.sr)} SR</small>
  </div>`;
}

export { SEASON_DEFS };
