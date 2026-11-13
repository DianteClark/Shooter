// The player screen (rank ladder, prestige), the Prestige view (every rank's icon, camo and calling card, the Master
// levels and what is next; docs/PRESTIGE.md), the prestige reveal, and the confirm and ceremony shared with weapons.
import { MAX_PRESTIGE, MAX_LEVEL, prestigeName, rankName, masterTier, masterTierName, masterTierStart, masterTierSvg,
  MASTER_MAX, MASTER_TIERS, MASTER_LEVEL_XP, nextMasterReward, prestigeRankRewards } from '../shared/progression.js';
import { getCamo } from '../shared/camos.js';
import { emblemSvg } from './emblems.js';
import { WEAPON_IDS } from '../shared/constants.js';
import { PERK_IDS, PERKS, PRO } from '../shared/catalog.js';
import { cardHtml, cardsSheet, vetTag, currentEmblem } from './cards.js';
import { icon } from './icons.js';
import { Progress } from './progress.js';
import { esc, badgeMark, ROMAN, levelRequirement, swatchCss } from './widgets.js';
import { ico, header } from './yard.js';
import { rollNumber } from './motion.js';
import { masteryScreen, masteryTotals } from './mastery.js';
import { trophyScreen, trophyTotals } from './trophy.js';
import { playUi } from '../audio/audio.js';

const KIND_LABEL = { rank: 'Rank icon', emblem: 'Emblem', camo: 'Camo', tracer: 'Tracer', killFx: 'Kill effect', perk: 'Perk', tactical: 'Tactical', lethal: 'Lethal', streak: 'Streak', attachment: 'Attachment', operator: 'Operator', pro: 'Pro perk', card: 'Calling card' };
export const kindLabel = kind => KIND_LABEL[kind] ?? kind;

// Confirm sheet: names what is lost and what stays. onYes runs once on the confirm button.
export function confirmPrestige(menu, { title, loses, keeps, confirmLabel, onYes, danger = false }) {
  menu.overlay(`
    <div class="sheet confirm">
      <div class="sheet-head">${ico(danger ? 'warn' : 'prestige')}<h2>${esc(title)}</h2></div>
      <div class="cf-cols">
        <div class="cf-lose"><b>${ico('minus')}Resets</b><p>${esc(loses)}</p></div>
        <div class="cf-keep"><b>${ico('check')}Stays</b><p>${esc(keeps)}</p></div>
      </div>
      <div class="sheet-row">
        <button class="btn" data-act="cfNo">${ico('close')}<b>Not yet</b></button>
        <button class="btn ${danger ? 'is-danger' : 'is-primary'}" data-act="cfYes">${ico(danger ? 'load' : 'prestige')}<b>${esc(confirmLabel)}</b></button>
      </div>
    </div>`);
  menu.on({
    cfNo: () => menu.overlay(''),
    cfYes: () => { menu.overlay(''); onYes(); },
  });
}

// One full-screen moment: rays turning behind the emblem, stamped in. Tap anywhere dismisses.
function ceremony(menu, { emblem, kicker, title, sub, rewards = [], rewardsHtml = '', next = '', onMount, onDone }) {
  playUi('prestige');
  menu.overlay(`
    <div class="cer" data-act="cerDone">
      <div class="cer-rays"></div>
      <div class="cer-emblem">${emblem}</div>
      <div class="cer-text">
        <span class="cer-kick">${esc(kicker)}</span>
        <h2>${esc(title)}</h2>
        <p>${esc(sub)}</p>
        ${next ? `<small class="pr-cer-next">${esc(next)}</small>` : ''}
      </div>
      ${rewardsHtml ? `<div class="pr-rewards">${rewardsHtml}</div>`
        : rewards.length ? `<div class="cer-rewards">${rewards.map((r, i) => `<span style="--i:${i}"><small>${esc(kindLabel(r.kind))}</small><b>${esc(r.name)}</b></span>`).join('')}</div>` : ''}
      <small class="cer-tap">Tap to continue</small>
    </div>`);
  onMount?.(menu.overlayEl.querySelector('.cer-emblem'));
  menu.on({ cerDone: () => { menu.overlay(''); onDone?.(); } });
}

export function weaponPrestigeCeremony(menu, { weaponId, name, prestige, rewards, onDone, mountGun }) {
  ceremony(menu, {
    emblem: `<div class="cer-gun"></div><b class="cer-numeral">${ROMAN[prestige]}</b>`,
    kicker: `${name} prestige`,
    title: `Rank ${ROMAN[prestige]}`,
    sub: rewards.length ? 'New cosmetics for this weapon' : 'This weapon has every reward',
    rewards,
    onMount: node => mountGun?.(node.querySelector('.cer-gun'), weaponId),
    onDone,
  });
}

export function profileScreen(menu, { onBack, onChange, onRename, onSave }) {
  const render = () => {
    menu.el.dataset.screen = 'profile';
    const lp = Progress.levelProgress();
    const p = Progress.prestige;
    const can = Progress.canPrestige();
    const peaked = p >= MAX_PRESTIGE;
    const upcoming = Progress.unlockSchedule().filter(u => !Progress.isItemUnlocked(u.kind, u.id)).slice(0, 4);
    // Master Prestige (docs/PRESTIGE.md): the card shows the Master level and its own bar.
    const mp = lp.master > 0 ? lp.mp : null, bar = mp ?? lp;
    const hint = peaked ? (mp ? 'Master Prestige' : `Master at ${MAX_LEVEL}`) : lp.level >= MAX_LEVEL ? 'Prestige' : `Prestige at ${MAX_LEVEL}`;
    const frac = bar.maxed ? 1 : bar.into / bar.span;
    menu.el.innerHTML = `
      ${header({ back: 'pfBack', label: 'Done', title: 'Service record', extra: masteryButton() })}
      <div class="pf">
        <div class="pf-card${can ? ' ready' : ''}" data-in="left">
          <div class="pf-badge">${badgeMark(p, 96, lp.master)}</div>
          <div class="pf-id">
            <span class="pf-rankname">${esc(rankName(p, lp.master))}${vetTag(Progress.isVeteran(), { emblem: currentEmblem() })}</span>
            <button class="pf-name" data-act="pfRename"><b>${esc(Progress.name || 'Rookie')}</b>${ico('edit')}</button>
          </div>
          <div class="pf-level">
            <span class="pf-lvbig"><small>${mp ? 'Master' : 'Level'}</small><b class="pf-lvn">${mp ? lp.master : lp.level}</b></span>
            <span class="pf-xp"><small>${bar.maxed ? 'Maximum level' : `${Math.round(bar.into).toLocaleString('en-US')} / ${bar.span.toLocaleString('en-US')} XP`}</small><i class="xp big"><i style="transform:scaleX(${frac.toFixed(3)})"></i></i></span>
          </div>
          <button class="pf-callcard" data-act="pfCards" aria-label="Calling card">${cardHtml(Progress.card, { size: 220, sub: 'Tap to change' })}</button>
          <div class="pf-actions">
            <button class="btn ${can ? 'is-primary' : ''}" data-act="pfPrestige" ${can ? '' : 'disabled'}>${ico(can ? 'prestige' : 'lock')}<b>${can ? 'Enter prestige' : esc(hint)}</b></button>
            <button class="btn" data-act="pfSave">${ico('save')}<b>Save code</b></button>
          </div>
        </div>
        <div class="pf-side">
          <section data-in="up">${trophyButton()}</section>
          <section data-in="up">
            <button class="pf-ladder-open" data-act="pfPrestigeView" aria-label="Prestige: every rank's rewards">
              <h4>${ico('rank')}Rank ladder<small>${mp ? `Master ${lp.master}` : `${p} of ${MAX_PRESTIGE}`}</small><em class="pf-ladder-go">Rewards${ico('next')}</em></h4>
              <span class="pf-ladder" style="--n:${MAX_PRESTIGE + 2}">
                ${Array.from({ length: MAX_PRESTIGE + 1 }, (_, i) => `
                  <span class="pf-rank${i === p && !mp ? ' on' : ''}${i > p ? ' locked' : ''}">${badgeMark(i, 30)}<small>${i ? ROMAN[i] : 'Start'}</small></span>`).join('')}
                <span class="pf-rank${mp ? ' on' : ' locked'}">${badgeMark(MAX_PRESTIGE, 30, Math.max(1, lp.master))}<small>M</small></span>
              </span>
            </button>
          </section>
          <section data-in="up">
            <h4>${ico('stats')}Career</h4>
            <div class="pf-career">${careerStats().map(([label, value, icon]) => `<div>${ico(icon)}<b>${value}</b><small>${label}</small></div>`).join('')}</div>
          </section>
          <section data-in="up">
            <h4>${ico('star')}Pro perks<small>${Progress.proPerks().length} of ${PERK_IDS.length}</small></h4>
            <div class="pf-pro">${PERK_IDS.map(id => {
              const on = Progress.isPro(id), st = Progress.proStatus(id);
              const frac = st.steps.reduce((a, c) => a + c.value / c.goal, 0) / st.steps.length;
              return `<span class="${on ? 'on' : ''}" title="${esc(`${PERKS[id].name} Pro: ${PRO[id].name}`)}" style="--f:${frac.toFixed(3)}">${icon(id, { size: 22 })}<i></i></span>`;
            }).join('')}</div>
          </section>
          <section data-in="up">
            <h4>${ico('unlock')}Next unlocks</h4>
            <div class="pf-next">
              ${upcoming.length ? upcoming.map(u => `<div class="pf-item">${ico(u.id)}<span><b>${esc(u.name)}</b><small>${esc(Progress.lockText(u.kind, u.id) || levelRequirement(u.level))}</small></span></div>`).join('') : `<p class="pf-done">${ico('check')}Every perk, tactical, lethal and streak is unlocked.</p>`}
            </div>
          </section>
        </div>
      </div>`;
    const shown = mp ? lp.master : lp.level;
    rollNumber(menu.el.querySelector('.pf-lvn'), shown, { from: Math.max(1, shown - 6), duration: 600 });
  };
  menu.on({
    pfCards: () => cardsSheet(menu, { onChange: () => onChange?.(), onClose: render }),
    pfBack: onBack,
    pfMastery: () => masteryScreen(menu, { onBack: () => profileScreen(menu, { onBack, onChange, onRename, onSave }) }),
    pfTrophy: () => trophyScreen(menu, { onBack: () => profileScreen(menu, { onBack, onChange, onRename, onSave }) }),
    pfPrestigeView: () => prestigeScreen(menu, { onBack: () => profileScreen(menu, { onBack, onChange, onRename, onSave }), onChange }),
    pfRename: onRename,
    pfSave: onSave,
    pfPrestige: () => enterPrestige(menu, { onChange, onDone: render }),
  });
  render();
  menu.show();
}

// The way into the Mastery screen, in the header: tiers done across every track and weapon ladder.
function masteryButton() {
  const { done, of } = masteryTotals();
  return `<button class="btn pf-mastery" data-act="pfMastery">${ico('star')}<b>Mastery</b><small>${done}/${of}</small></button>`;
}

// The way into the Trophy Case (js/ui/trophy.js): how complete the collection is.
function trophyButton() {
  const { have, of } = trophyTotals(), f = have / Math.max(1, of);
  return `<button class="pf-trophy" data-act="pfTrophy" aria-label="Trophy case">${ico('star')}<span><b>Trophy case</b><small>Rarest unlocks, personal bests, collections</small></span><em>${Math.floor(f * 100)}%</em><i class="pf-trophy-bar"><i style="transform:scaleX(${f.toFixed(3)})"></i></i></button>`;
}

// Big totals in the space of a tile: 9,870 stays as it is, 200,000 reads 200K, 3,400,000 reads 3.4M.
const compact = n => (n < 10000 ? n.toLocaleString('en-US') : n < 1e6 ? `${Math.round(n / 1000)}K` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`);

function careerStats() {
  const sum = key => WEAPON_IDS.reduce((total, w) => total + Progress.weaponStats(w)[key], 0);
  const mastered = WEAPON_IDS.filter(w => Progress.isMastered(w)).length;
  return [
    ['Total XP', compact(Progress.totalXp), 'star'], ['Gun kills', sum('kills').toLocaleString('en-US'), 'skull'],
    ['Headshots', sum('head').toLocaleString('en-US'), 'medal:headshot'], ['Longshots', sum('long').toLocaleString('en-US'), 'medal:longshot'],
    ['Mastered', `${mastered}/${WEAPON_IDS.length}`, 'camo'],
  ];
}

export function prestigeWeaponNow(menu, w, name, { onDone, mountGun }) {
  const next = Progress.weaponPrestige(w) + 1;
  confirmPrestige(menu, {
    title: `Prestige the ${name} to ${ROMAN[next]}`,
    loses: `This weapon's level goes back to 1.`,
    keeps: 'Every attachment you unlocked on it, its kills and its camos.',
    confirmLabel: 'Prestige',
    onYes: () => {
      const r = Progress.prestigeWeapon(w);
      if (!r.ok) return;
      weaponPrestigeCeremony(menu, { weaponId: w, name, prestige: r.prestige, rewards: r.rewards, mountGun, onDone });
    },
  });
}

/* ---------- Prestige (ROADMAP item 39, docs/PRESTIGE.md) ---------- */

// The confirm, then the reveal: the new badge stamped in, its camo and calling card, and what the next rank brings.
export function enterPrestige(menu, { onChange, onDone } = {}) {
  const n = Progress.prestige + 1;
  const camo = prestigeRankRewards(n).find(r => r.kind === 'camo');
  confirmPrestige(menu, {
    title: `Prestige to ${ROMAN[n]}: ${prestigeName(n)}`,
    loses: 'Your level goes back to 1.',
    keeps: `Every unlock, weapon level, camo and loadout, plus a new icon, ${camo ? `the ${camo.name} camo` : 'a camo'} and a calling card.`,
    confirmLabel: 'Prestige',
    onYes: () => {
      const r = Progress.doPrestige();
      if (!r.ok) return;
      onChange?.();
      prestigeReveal(menu, { prestige: r.prestige, rewards: r.rewards, onDone });
    },
  });
}

// The reveal sheet for a new prestige rank (also the gallery's and the browser test's way in).
export function prestigeReveal(menu, { prestige, rewards = prestigeRankRewards(prestige), onDone }) {
  const next = prestige < MAX_PRESTIGE ? `Next: Prestige ${ROMAN[prestige + 1]}, ${prestigeName(prestige + 1)}, at level ${MAX_LEVEL}`
    : `Next: Master Prestige at level ${MAX_LEVEL}`;
  ceremony(menu, {
    emblem: `<div class="cer-badge">${badgeMark(prestige, 150)}</div>`,
    kicker: `Prestige ${ROMAN[prestige]} of ${ROMAN[MAX_PRESTIGE]}`,
    title: prestigeName(prestige),
    sub: 'Level reset to 1. Everything you earned stays yours.',
    rewardsHtml: rewards.filter(r => r.kind !== 'rank').map((r, i) => rewardTile(r, i, { big: true })).join(''),
    next,
    onDone,
  });
}

// One reward as a tile: its picture, what kind it is, its name.
function rewardTile(r, i = 0, { small = false, big = false } = {}) {
  // A calling card carries its own name, so the reveal shows the card itself under its kind.
  if (big && r.kind === 'card') return `<span class="pr-tile pr-card" style="--i:${i}"><span><small>${esc(kindLabel(r.kind))}</small>${cardHtml(r.id, { size: 196, sub: '' })}</span></span>`;
  return `<span class="pr-tile pr-${r.kind}" style="--i:${i}">${rewardMark(r, small ? 26 : big ? 40 : 34)}<span><small>${esc(kindLabel(r.kind))}</small><b>${esc(r.name)}</b></span></span>`;
}

// The picture for a reward: badge or Master icon, camo swatch, calling card sliver, emblem.
export function rewardMark(r, px = 34) {
  if (r.kind === 'rank') return `<i class="pr-mk">${r.master ? badgeMark(MAX_PRESTIGE, px, r.master) : badgeMark(r.prestige ?? 0, px)}</i>`;
  if (r.kind === 'camo') return `<i class="pr-mk pr-sw" style="--s:${px}px;background:${swatchCss(getCamo(r.id))}"></i>`;
  if (r.kind === 'card') return `<i class="pr-mk pr-cd">${cardHtml(r.id, { size: px * 3.4, sub: '' })}</i>`;
  if (r.kind === 'emblem') return `<i class="pr-mk">${emblemSvg(r.id, px)}</i>`;
  return '';
}

// The results reel's Master stamp: the tier's icon, the level, and the next Master reward.
export function masterStampHtml(m, before = 0) {
  const nx = nextMasterReward(m);
  const first = before <= 0;
  const tierUp = !first && masterTier(m) > masterTier(before);
  const line = first ? `Every ${MASTER_LEVEL_XP.toLocaleString('en-US')} XP from here is a Master level, up to ${MASTER_MAX.toLocaleString('en-US')}.`
    : nx ? `Next: ${nx.rewards.map(r => r.name).join(', ')} at Master ${nx.level}` : 'The top of the line';
  return `
    <div class="rx-card rx-level rx-master">
      <div class="rx-emblem">${badgeMark(MAX_PRESTIGE, 92, m)}</div>
      <div class="rx-text"><span class="rx-kick">${first ? 'Master Prestige' : tierUp ? `${esc(masterTierName(masterTier(m)))} Master` : 'Master level up'}</span><h2>Master ${m}</h2><p>${esc(line)}</p></div>
    </div>`;
}

// Stamps for the rank rewards in the results reel: a new Master icon tier, a rank camo (every gun), the Master emblem.
export function rankStamp(u) {
  const rank = u.kind === 'rank', every = u.kind === 'camo' && u.every, emb = u.kind === 'emblem' && u.level;
  if (!rank && !every && !emb) return null;
  const mark = rank ? `<span class="rx-mark">${rewardMark(u, 92)}</span>`
    : every ? `<span class="rx-swatch" style="background:${swatchCss(getCamo(u.id))}"></span>`
    : `<span class="rx-mark">${emblemSvg(u.id, 84)}</span>`;
  const kick = rank ? 'New rank icon' : every ? 'New camo' : 'New emblem';
  const sub = every ? `Every weapon · ${u.req ?? ''}` : u.req ?? '';
  return `
    <div class="rx-card rx-unlock">
      ${mark}
      <span class="rx-kick">${kick}</span>
      <h2>${esc(u.name)}</h2>
      ${sub ? `<small>${esc(sub)}</small>` : ''}
    </div>`;
}

// The Prestige view: where you stand, what comes next, and every rank's icon, camo and calling card, then the Master
// icon tiers and milestones. Opened from the service record (the title's player card).
export function prestigeScreen(menu, { onBack, onChange } = {}) {
  const render = () => {
    menu.el.dataset.screen = 'prestige';
    const lp = Progress.levelProgress(), t = Progress.prestigeTrack();
    const p = t.prestige, m = t.master, can = Progress.canPrestige();
    const mp = m > 0 ? lp.mp : null, bar = mp ?? lp;
    const frac = bar.maxed ? 1 : bar.into / bar.span;
    const nx = t.next;
    const nextTitle = !nx ? 'Every reward earned' : nx.kind === 'prestige' ? `Prestige ${ROMAN[nx.rank]} · ${prestigeName(nx.rank)}` : nx.level === 1 ? 'Master Prestige' : `Master ${nx.level}`;
    const nextReq = !nx ? 'You hold every rank and reward there is.'
      : nx.kind === 'prestige' ? (can ? 'Ready: enter prestige to claim it' : `Reach level ${MAX_LEVEL} (now ${lp.level}), then prestige`)
      : nx.level === 1 ? `Reach level ${MAX_LEVEL} at Prestige ${ROMAN[MAX_PRESTIGE]} (now ${lp.level})`
      : `${(nx.level - m).toLocaleString('en-US')} more Master level${nx.level - m === 1 ? '' : 's'}`;
    const status = on => `<i class="pr-st${on ? ' on' : ''}">${ico(on ? 'check' : 'lock')}</i>`;
    const rankRow = r => {
      const camo = r.rewards.find(x => x.kind === 'camo'), card = r.rewards.find(x => x.kind === 'card');
      const here = r.rank === p && !m;
      return `<div class="pr-row${r.earned ? ' earned' : ''}${here ? ' here' : ''}">
        <i class="pr-bdg">${badgeMark(r.rank, 40)}</i>
        <span class="pr-nm"><b>${esc(prestigeName(r.rank))}</b><small>Prestige ${ROMAN[r.rank]}</small></span>
        <span class="pr-cm" title="${esc(camo?.name ?? '')}">${camo ? rewardMark(camo, 26) : ''}<small>${esc(camo?.name ?? '')}</small></span>
        <span class="pr-cdw">${card ? cardHtml(card.id, { size: 116, sub: '', locked: !r.earned }) : ''}</span>
        ${status(r.earned)}
      </div>`;
    };
    const tiers = Array.from({ length: MASTER_TIERS }, (_, i) => {
      const at = masterTierStart(i), got = m >= at;
      return `<span class="pr-tier${got ? '' : ' locked'}${m > 0 && masterTier(m) === i ? ' on' : ''}" title="${esc(masterTierName(i))} Master">${masterTierSvg(i, 28)}<small>${at}</small></span>`;
    }).join('');
    // A milestone: the Master icon of its level, its name, and the reward itself (card, camo swatch or emblem).
    const masterRow = r => `<div class="pr-row pr-mrow${r.earned ? ' earned' : ''}">
        <i class="pr-bdg">${badgeMark(MAX_PRESTIGE, 36, r.level)}</i>
        <span class="pr-nm"><b>${esc(r.name)}</b><small>${esc(kindLabel(r.kind))} · Master ${r.level}</small></span>
        ${r.kind === 'card' ? `<span class="pr-cdw">${cardHtml(r.id, { size: 116, sub: '', locked: !r.earned })}</span>`
          : `<span class="pr-cm pr-rw">${rewardMark(r, 26)}</span>`}
        ${status(r.earned)}
      </div>`;
    menu.el.innerHTML = `
      ${header({ back: 'prBack', title: 'Prestige' })}
      <div class="pr">
        <div class="pr-now" data-in="left">
          <div class="pr-head">
            <i class="pr-big">${badgeMark(p, 84, m)}</i>
            <span class="pr-id"><small>${mp ? 'Master Prestige' : p ? `Prestige ${ROMAN[p]}` : 'No prestige yet'}</small><b>${esc(rankName(p, m))}</b>
              <span class="pr-lv">${mp ? `Master <u>${m}</u>` : `Level <u>${lp.level}</u>`}<small>${bar.maxed ? 'Maximum' : `${Math.round(bar.into).toLocaleString('en-US')} / ${bar.span.toLocaleString('en-US')} XP`}</small></span>
              <i class="xp"><i style="transform:scaleX(${frac.toFixed(3)})"></i></i>
            </span>
          </div>
          <div class="pr-next">
            <h4>${ico('next')}Next<small>${esc(nextTitle)}</small></h4>
            ${nx ? `<div class="pr-tiles">${nx.rewards.map((r, i) => rewardTile(r, i, { small: true })).join('')}</div>` : ''}
            <p>${esc(nextReq)}</p>
          </div>
          ${p < MAX_PRESTIGE ? `<button class="btn ${can ? 'is-primary' : ''}" data-act="prEnter" ${can ? '' : 'disabled'}>${ico(can ? 'prestige' : 'lock')}<b>${can ? 'Enter prestige' : `Prestige at ${MAX_LEVEL}`}</b></button>` : ''}
        </div>
        <div class="pr-list scroll-y" data-in="up">
          <h4>${ico('rank')}Prestige ranks<small>${p} of ${MAX_PRESTIGE}</small></h4>
          ${t.ranks.map(rankRow).join('')}
          <h4>${ico('star')}Master Prestige<small>${m ? `Master ${m} of ${MASTER_MAX.toLocaleString('en-US')}` : 'After Prestige X'}</small></h4>
          <p class="pr-note">Past Prestige ${ROMAN[MAX_PRESTIGE]} at level ${MAX_LEVEL}, every ${MASTER_LEVEL_XP.toLocaleString('en-US')} XP is a Master level, up to ${MASTER_MAX.toLocaleString('en-US')}, with a new icon every ${masterTierStart(1)}.</p>
          <div class="pr-tiers">${tiers}</div>
          ${t.masterRewards.map(masterRow).join('')}
        </div>
      </div>`;
  };
  menu.on({
    prBack: () => onBack?.(),
    prEnter: () => enterPrestige(menu, { onChange, onDone: render }),
  });
  render();
  menu.show();
}
