// The player screen (rank ladder, prestige) and the prestige confirm and ceremony shared with weapons.
import { MAX_PRESTIGE, MAX_LEVEL, prestigeName, getCard } from '../shared/progression.js';
import { WEAPON_IDS } from '../shared/constants.js';
import { PERK_IDS, PERKS, PRO } from '../shared/catalog.js';
import { cardHtml, cardsSheet, vetTag, currentEmblem } from './cards.js';
import { icon } from './icons.js';
import { Progress } from './progress.js';
import { esc, badgeMark, ROMAN, levelRequirement } from './widgets.js';
import { ico, header } from './yard.js';
import { rollNumber } from './motion.js';
import { masteryScreen, masteryTotals } from './mastery.js';

const KIND_LABEL = { camo: 'Camo', tracer: 'Tracer', killFx: 'Kill effect', perk: 'Perk', tactical: 'Tactical', lethal: 'Lethal', streak: 'Streak', attachment: 'Attachment', operator: 'Operator', pro: 'Pro perk', card: 'Calling card' };
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
function ceremony(menu, { emblem, kicker, title, sub, rewards = [], onMount, onDone }) {
  menu.overlay(`
    <div class="cer" data-act="cerDone">
      <div class="cer-rays"></div>
      <div class="cer-emblem">${emblem}</div>
      <div class="cer-text">
        <span class="cer-kick">${esc(kicker)}</span>
        <h2>${esc(title)}</h2>
        <p>${esc(sub)}</p>
      </div>
      ${rewards.length ? `<div class="cer-rewards">${rewards.map((r, i) => `<span style="--i:${i}"><small>${esc(kindLabel(r.kind))}</small><b>${esc(r.name)}</b></span>`).join('')}</div>` : ''}
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
    const hint = peaked ? 'Top rank' : lp.level >= MAX_LEVEL ? 'Prestige' : `Prestige at ${MAX_LEVEL}`;
    const frac = lp.maxed ? 1 : lp.into / lp.span;
    menu.el.innerHTML = `
      ${header({ back: 'pfBack', label: 'Done', title: 'Service record', extra: masteryButton() })}
      <div class="pf">
        <div class="pf-card${can ? ' ready' : ''}" data-in="left">
          <div class="pf-badge">${badgeMark(p, 96)}</div>
          <div class="pf-id">
            <span class="pf-rankname">${esc(prestigeName(p))}${vetTag(Progress.isVeteran(), { emblem: currentEmblem() })}</span>
            <button class="pf-name" data-act="pfRename"><b>${esc(Progress.name || 'Rookie')}</b>${ico('edit')}</button>
          </div>
          <div class="pf-level">
            <span class="pf-lvbig"><small>Level</small><b class="pf-lvn">${lp.level}</b></span>
            <span class="pf-xp"><small>${lp.maxed ? 'Maximum level' : `${Math.round(lp.into).toLocaleString('en-US')} / ${lp.span.toLocaleString('en-US')} XP`}</small><i class="xp big"><i style="transform:scaleX(${frac.toFixed(3)})"></i></i></span>
          </div>
          <button class="pf-callcard" data-act="pfCards" aria-label="Calling card">${cardHtml(Progress.card, { size: 220, sub: 'Tap to change' })}</button>
          <div class="pf-actions">
            <button class="btn ${can ? 'is-primary' : ''}" data-act="pfPrestige" ${can ? '' : 'disabled'}>${ico(can ? 'prestige' : 'lock')}<b>${can ? 'Enter prestige' : esc(hint)}</b></button>
            <button class="btn" data-act="pfSave">${ico('save')}<b>Save code</b></button>
          </div>
        </div>
        <div class="pf-side">
          <section data-in="up">
            <h4>${ico('rank')}Rank ladder<small>${p} of ${MAX_PRESTIGE}</small></h4>
            <div class="pf-ladder" style="--n:${MAX_PRESTIGE + 1}">
              ${Array.from({ length: MAX_PRESTIGE + 1 }, (_, i) => `
                <div class="pf-rank${i === p ? ' on' : ''}${i > p ? ' locked' : ''}">${badgeMark(i, 30)}<small>${i ? ROMAN[i] : 'Start'}</small></div>`).join('')}
            </div>
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
    rollNumber(menu.el.querySelector('.pf-lvn'), lp.level, { from: Math.max(1, lp.level - 6), duration: 600 });
  };
  menu.on({
    pfCards: () => cardsSheet(menu, { onChange: () => onChange?.(), onClose: render }),
    pfBack: onBack,
    pfMastery: () => masteryScreen(menu, { onBack: () => profileScreen(menu, { onBack, onChange, onRename, onSave }) }),
    pfRename: onRename,
    pfSave: onSave,
    pfPrestige: () => confirmPrestige(menu, {
      title: `Prestige to ${ROMAN[Progress.prestige + 1]}: ${prestigeName(Progress.prestige + 1)}`,
      loses: `Your level goes back to 1.`,
      keeps: 'Every unlock, weapon level, camo and loadout, plus a new badge.',
      confirmLabel: 'Prestige',
      onYes: () => {
        const r = Progress.doPrestige();
        if (!r.ok) return;
        onChange?.();
        ceremony(menu, {
          emblem: `<div class="cer-badge">${badgeMark(r.prestige, 150)}</div>`,
          kicker: `Prestige ${r.prestige} of ${MAX_PRESTIGE}`,
          title: prestigeName(r.prestige),
          sub: 'Level reset. Everything you earned stays yours.',
          rewards: [{ kind: 'card', name: getCard(`prestige-${r.prestige}`).name }],
          onDone: render,
        });
      },
    }),
  });
  render();
  menu.show();
}

// The way into the Mastery screen, in the header: tiers done across every track and weapon ladder.
function masteryButton() {
  const { done, of } = masteryTotals();
  return `<button class="btn pf-mastery" data-act="pfMastery">${ico('star')}<b>Mastery</b><small>${done}/${of}</small></button>`;
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
