// Mastery: the screen that sums up every track (reached from the service record), and the pieces other screens show:
// the chip and strip where an item is picked (loadout sheets, operator picker), the emblem badges, the results strip of
// what moved and the tier-up card in the results reel. Rules live in js/shared/progression.js (MASTERY_TRACKS,
// WEAPON_LADDER); the save in js/ui/progress.js.
//
//   masteryBadge(item, grade, {size})   emblem badge: 0 not earned, 1 bronze, 2 gold, around the item's icon
//   masteryChip(trackId)                tier and a bar toward the next tier, for a picker card ('' for unknown ids)
//   masteryPips(status)                 one segment per tier along a card's edge (like the Pro strip)
//   masteryDetail(trackId)              the focused item's tier, current goal and next reward, for a sheet head
//   masteryStrip(list)                  results: up to three tracks that moved (AwardsResult.mastery)
//   masteryStamp(u)                     results reel card for a {kind:'mastery'} unlock, or null
//   masteryScreen(menu, {onBack})       masteryTotals() -> {done, of} tiers over every track and owned gun
import { WEAPON_IDS, GOLDEN_ID } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { MASTERY_KINDS } from '../shared/progression.js';
import { Progress } from './progress.js';
import { cardHtml } from './cards.js';
import { icon } from './icons.js';
import { esc, ROMAN } from './widgets.js';
import { ico, header } from './yard.js';
import { stagger, pop } from './motion.js';

const KIND_NAME = { tactical: 'Tactical', lethal: 'Lethal', streak: 'Scorestreaks', operator: 'Operators', weapon: 'Weapons' };
const SINGULAR = { tactical: 'Tactical', lethal: 'Lethal', streak: 'Scorestreak', operator: 'Operator', weapon: 'Weapon' };
const TABS = [...MASTERY_KINDS, 'weapon'];
const GRADE = ['#4c5a67', '#d08a4a', '#ffd659'];        // Rim: not earned, bronze, gold.
const GRADE_NAME = ['', 'Bronze', 'Gold'];
const fmt = n => Math.floor(n).toLocaleString('en-US');
const frac = c => (c ? Math.min(1, c.value / c.goal) : 1);
const art = (id, size) => icon(id, { size, square: true });

// A hex plate in the badge's metal with the item's icon on it. No ids or defs, so it can repeat on a page.
const HEX = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + (i * Math.PI) / 3; return `${(16 + Math.cos(a) * 15).toFixed(1)},${(16 + Math.sin(a) * 15).toFixed(1)}`; }).join(' ');
const HEX_IN = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + (i * Math.PI) / 3; return `${(16 + Math.cos(a) * 12).toFixed(1)},${(16 + Math.sin(a) * 12).toFixed(1)}`; }).join(' ');
export function masteryBadge(item, grade = 0, { size = 40 } = {}) {
  const rim = GRADE[grade] ?? GRADE[0];
  const glyph = WEAPONS[item] ? item : getIconFor(item);
  return `<span class="mb${grade ? ` g${grade}` : ''}" style="--mb:${size}px;--rim:${rim}" title="${esc(GRADE_NAME[grade] ? `${GRADE_NAME[grade]} badge` : 'Badge not earned')}">
    <svg viewBox="0 0 32 32" aria-hidden="true"><polygon points="${HEX}" fill="${rim}"/><polygon points="${HEX_IN}" fill="#151a20"/></svg>
    ${art(glyph, Math.round(size * 0.46))}
  </span>`;
}

const getIconFor = item => (Progress.mastery(item)?.icon ?? item);

const statusOf = id => (id.startsWith('gun:') ? Progress.weaponLadder(id.slice(4)) : Progress.mastery(id));

export function masteryPips(st) {
  if (!st) return '';
  return `<span class="m-pips${st.maxed ? ' done' : ''}">${st.tiers.map((c, i) => `<i style="--f:${(i < st.tier ? 1 : i === st.tier ? frac(c) : 0).toFixed(3)}"></i>`).join('')}</span>`;
}

export function masteryChip(id) {
  const st = statusOf(id);
  if (!st) return '';
  return `<span class="m-chip${st.maxed ? ' done' : ''}" title="${esc(st.next ? st.next.label : 'Mastered')}">
    <b>${st.maxed ? 'Mastered' : `Mastery ${ROMAN[st.tier] || '0'}/${ROMAN[st.count]}`}</b>${masteryPips(st)}
  </span>`;
}

// What a tier pays, as small chips. Cards and skins name themselves; XP shows the number.
function rewardChips(rewards, { got = false } = {}) {
  return rewards.map(r => {
    const mark = r.kind === 'badge' ? masteryBadge(r.id.slice(6, r.id.lastIndexOf('-')), Number(r.id.slice(-1)), { size: 18 })
      : ico(r.kind === 'xp' ? 'star' : r.kind === 'card' ? 'flag' : r.kind === 'skin' ? 'operator' : 'camo');
    return `<span class="m-rw k-${r.kind}${got ? ' got' : ''}">${mark}<small>${esc(r.kind === 'xp' ? `+${fmt(r.xp)} XP` : r.name)}</small></span>`;
  }).join('');
}

// The sheet head in the loadout pickers: tier, the goal being worked on, and what it pays.
export function masteryDetail(id) {
  const st = statusOf(id);
  if (!st) return '';
  const c = st.next;
  return `<div class="m-detail${st.maxed ? ' done' : ''}">
    <div class="m-detail-top">${masteryBadge(st.item, gradeOf(st), { size: 26 })}<b>${esc(st.name)} mastery</b><em>${st.maxed ? 'Mastered' : `${ROMAN[st.tier] || '0'} / ${ROMAN[st.count]} tiers`}</em></div>
    ${c ? `<div class="m-detail-goal"><small>${esc(c.label)}</small><u>${fmt(c.value)}/${fmt(c.goal)}</u><i class="m-bar"><i style="transform:scaleX(${frac(c).toFixed(3)})"></i></i></div>
      <div class="m-detail-rw">${rewardChips(c.rewards)}</div>` : `<small class="m-detail-done">Every tier done. ${esc(st.tiers.at(-1).label)}.</small>`}
  </div>`;
}

const gradeOf = st => {
  let g = 0;
  for (const c of st.tiers.slice(0, st.tier)) for (const r of c.rewards) if (r.kind === 'badge') g = Math.max(g, Number(r.id.slice(-1)));
  return g;
};

/* ---------- Results ---------- */
export function masteryStrip(list = [], max = 3) {
  if (!list?.length) return '';
  const rows = [...list].sort((a, b) => b.up - a.up || b.value / b.goal - a.value / a.goal).slice(0, max);
  return `<div class="rs-ch rs-mastery"><small class="rs-ch-h">${ico('star')}Mastery</small>${rows.map(m => `
    <div class="rs-ch-row${m.up ? ' done' : ''}">${art(m.icon, 15)}<b>${esc(m.name)} ${m.up ? `<em>Tier ${ROMAN[m.tier]}</em>` : ''}</b>
      <i class="rs-ch-bar" style="--a:${(m.before / m.goal).toFixed(3)};--f:${(m.value / m.goal).toFixed(3)}"></i>
      <small>${m.up ? 'Tier up' : `${fmt(m.value)}/${fmt(m.goal)}`}</small>
    </div>`).join('')}</div>`;
}

// The reel's card for a tier finished this match: the badge, the tier, the challenge and what it paid. A calling card
// reward is shown whole, since it gets no ceremony of its own.
export function masteryStamp(u) {
  if (u?.kind !== 'mastery') return null;
  const card = u.rewards.find(r => r.kind === 'card');
  // The badge as it stands after this tier: bronze from tier II, gold at the top.
  const st = statusOf(u.track);
  const grade = st ? gradeOf({ ...st, tier: u.tier }) : 0;
  return `<div class="rx-card rx-unlock rx-mastery">
    <span class="rx-mark rx-m-mark">${masteryBadge(u.item, grade, { size: 92 })}<i class="rx-m-tier">${ROMAN[u.tier]}</i></span>
    <span class="rx-kick">${esc(SINGULAR[u.trackKind] ?? '')} mastery: tier ${u.tier} of ${u.count}</span>
    <h2>${esc(u.name)}</h2>
    <small>${esc(u.label)}</small>
    ${card ? `<span class="rx-m-card">${cardHtml(card.id.slice(5), { size: 260, sub: 'New calling card' })}</span>` : ''}
    <span class="rx-m-rw">${rewardChips(u.rewards.filter(r => r.kind !== 'card'), { got: true })}</span>
  </div>`;
}

/* ---------- The screen ---------- */
function trackCard(st, i) {
  const c = st.next, locked = st.open === false;
  return `<button class="m-card${st.maxed ? ' done' : ''}${locked ? ' locked' : ''}" data-act="mOpen" data-id="${esc(st.id)}" style="--i:${i}">
    ${masteryBadge(st.item, gradeOf(st), { size: 40 })}
    <span class="m-card-tx">
      <b>${esc(st.name)}</b>
      <small>${locked ? `Reach weapon level 30 (now ${Progress.weaponLevel(st.item)})` : c ? esc(c.label) : 'Mastered'}</small>
      <span class="m-card-prog">${masteryPips(st)}<u>${locked ? '' : c ? `${fmt(c.value)}/${fmt(c.goal)}` : `${ROMAN[st.count]}/${ROMAN[st.count]}`}</u></span>
    </span>
    <em class="m-card-tier">${ROMAN[st.tier] || '0'}<small>/${ROMAN[st.count]}</small></em>
  </button>`;
}

function listFor(tab) {
  if (tab !== 'weapon') return Progress.masteryAll(tab);
  // Guns at level 30 first, then by how far along their ladder is; the Golden Gun has no ladder.
  return WEAPON_IDS.filter(w => w !== GOLDEN_ID && Progress.isItemUnlocked('weapon', w)).map(w => Progress.weaponLadder(w))
    .sort((a, b) => Number(b.open) - Number(a.open) || b.tier - a.tier);
}

function detailSheet(menu, id, onClose) {
  const st = statusOf(id);
  if (!st) return;
  const locked = st.open === false;
  menu.overlay(`
    <div class="sheet m-sheet" role="dialog" aria-label="${esc(st.name)} mastery">
      <div class="m-sheet-head">
        ${masteryBadge(st.item, gradeOf(st), { size: 52 })}
        <div><small>${esc(SINGULAR[st.kind])} mastery</small><h2>${esc(st.name)}</h2></div>
        <em>${st.maxed ? 'Mastered' : `${st.tier} of ${st.count} tiers`}</em>
        <button class="btn is-primary" data-act="mClose" data-sound="back">${ico('check')}<b>Done</b></button>
      </div>
      ${locked ? `<p class="m-sheet-note">${ico('lock')}The ladder opens at weapon level 30. Now level ${Progress.weaponLevel(st.item)}.</p>` : ''}
      <ol class="m-tiers scroll-y">${st.tiers.map((c, i) => {
        const state = c.done ? 'done' : i === st.tier && !locked ? 'now' : 'later';
        return `<li class="m-tier ${state}" style="--i:${i}">
          <span class="m-tier-n">${ROMAN[i + 1]}</span>
          <span class="m-tier-goal"><b>${esc(c.label)}</b>
            <span><i class="m-bar"><i style="transform:scaleX(${(c.done ? 1 : state === 'now' ? frac(c) : 0).toFixed(3)})"></i></i><u>${c.done ? 'Done' : state === 'now' ? `${fmt(c.value)}/${fmt(c.goal)}` : fmt(c.goal)}</u></span></span>
          <span class="m-tier-rw">${rewardChips(c.rewards, { got: c.done })}</span>
        </li>`;
      }).join('')}</ol>
    </div>`);
  stagger(menu.overlayEl?.querySelectorAll('.m-tier') ?? [], 'up', { step: 30 });
  menu.on({ mClose: () => { menu.overlay(''); onClose?.(); } });
}

// Tiers done and tiers in all, over every track and every owned gun's ladder (the service record shows it).
export function masteryTotals() {
  const all = [...Progress.masteryAll(), ...listFor('weapon')];
  return { done: all.reduce((n, s) => n + s.tier, 0), of: all.reduce((n, s) => n + s.count, 0) };
}

export function masteryScreen(menu, { onBack }) {
  let tab = 'lethal';
  const render = (fresh = false) => {
    menu.el.dataset.screen = 'mastery';
    const all = MASTERY_KINDS.flatMap(k => Progress.masteryAll(k));
    const weapons = listFor('weapon');
    const { done, of } = masteryTotals();
    const badges = Progress.badges();
    const counts = Object.fromEntries(TABS.map(k => {
      const list = k === 'weapon' ? weapons : all.filter(s => s.kind === k);
      return [k, `${list.reduce((n, s) => n + s.tier, 0)}/${list.reduce((n, s) => n + s.count, 0)}`];
    }));
    const list = listFor(tab);
    menu.el.innerHTML = `
      ${header({ back: 'mBack', label: 'Done', title: 'Mastery', cls: 'm-bar-head', extra: `<span class="hdr-tag">${ico('star')}${done} of ${of} tiers</span>` })}
      <div class="m-wrap">
        <aside class="m-side" data-in="left">
          <div class="m-total">
            <b class="t-num">${Math.round((done / Math.max(1, of)) * 100)}<small>%</small></b>
            <span><small>Tiers complete</small><i class="m-bar"><i style="transform:scaleX(${(done / Math.max(1, of)).toFixed(3)})"></i></i></span>
          </div>
          <nav class="m-tabs">${TABS.map(k => `<button class="m-tab${k === tab ? ' on' : ''}" data-act="mTab" data-tab="${k}" data-sound="tab"><b>${KIND_NAME[k]}</b><small>${counts[k]}</small></button>`).join('')}</nav>
          <div class="m-case">
            <small>Badges ${badges.length}</small>
            <div class="m-case-grid">${badges.length ? badges.slice(0, 12).map(b => masteryBadge(b.item, b.grade, { size: 26 })).join('') : '<em>Finish tier II of any track for a badge</em>'}</div>
          </div>
        </aside>
        <div class="m-grid scroll-y">${list.map(trackCard).join('')}</div>
      </div>`;
    if (fresh) stagger(menu.el.querySelectorAll('.m-card'), 'up', { step: 20, max: 12 });
  };
  menu.on({
    mBack: () => onBack(),
    mTab: ({ tab: t }) => { if (t === tab) return; tab = t; render(true); },
    mOpen: ({ id }, el) => { pop(el); detailSheet(menu, id, null); },
  });
  render(true);
  menu.show();
}
