// The player screen (rank ladder, prestige) and the prestige confirm and ceremony shared with weapons.
import { MAX_PRESTIGE, MAX_LEVEL, prestigeName } from '../shared/progression.js';
import { WEAPON_IDS } from '../shared/constants.js';
import { Progress } from './progress.js';
import { esc, badgeMark, ROMAN, levelRequirement, itemMark } from './widgets.js';

const KIND_LABEL = { camo: 'Camo', tracer: 'Tracer', killFx: 'Kill effect', perk: 'Perk', tactical: 'Tactical', lethal: 'Lethal', streak: 'Streak', attachment: 'Attachment', operator: 'Operator' };
export const kindLabel = kind => KIND_LABEL[kind] ?? kind;

// Confirm sheet: names what is lost and what stays. onYes runs once on the confirm button.
export function confirmPrestige(menu, { title, loses, keeps, confirmLabel, onYes }) {
  menu.overlay(`
    <div class="sheet confirm">
      <h2>${esc(title)}</h2>
      <div class="cf-cols">
        <div><b class="bad">Resets</b><p>${esc(loses)}</p></div>
        <div><b class="good">Stays</b><p>${esc(keeps)}</p></div>
      </div>
      <div class="cf-row">
        <button class="route small" data-act="cfNo"><b>Not yet</b></button>
        <button class="route small primary" data-act="cfYes"><i class="lamp"></i><b>${esc(confirmLabel)}</b></button>
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
    const hint = peaked ? 'Highest rank reached' : lp.level >= MAX_LEVEL ? `Prestige to ${prestigeName(p + 1)}` : `Reach level ${MAX_LEVEL} to prestige`;
    menu.el.innerHTML = `
      <header class="bar">
        <button class="back" data-act="pfBack">Done</button>
        <h2>Service Record</h2>
      </header>
      <div class="pf enter">
        <div class="pf-card">
          <div class="pf-badge">${badgeMark(p, 88)}</div>
          <div class="pf-id">
            <span class="eyebrow">${esc(prestigeName(p))}</span>
            <button class="pf-name" data-act="pfRename"><b>${esc(Progress.name || 'Rookie')}</b><small>Change</small></button>
            <div class="pf-level"><b>Level ${lp.level}</b><small>${lp.maxed ? 'Maximum level' : `${Math.round(lp.into)} / ${lp.span} XP`}</small></div>
            <i class="xp big"><i style="transform:scaleX(${(lp.maxed ? 1 : lp.into / lp.span).toFixed(3)})"></i></i>
          </div>
          <button class="route ${can ? 'primary' : ''}" data-act="pfPrestige" ${can ? '' : 'disabled'}><i class="lamp"></i><b>${can ? 'Enter Prestige' : esc(hint)}</b></button>
          <button class="route small" data-act="pfSave"><b>Save code</b></button>
        </div>
        <div class="pf-side">
          <h4>Rank ladder <small>${p} / ${MAX_PRESTIGE}</small></h4>
          <div class="pf-ladder">
            ${Array.from({ length: MAX_PRESTIGE + 1 }, (_, i) => `
              <div class="pf-rank${i === p ? ' on' : ''}${i > p ? ' locked' : ''}">${badgeMark(i, 42)}<small>${i ? ROMAN[i] : 'Start'}</small></div>`).join('')}
          </div>
          <h4>Career</h4>
          <div class="pf-career">${careerStats().map(([label, value]) => `<div><b>${value}</b><small>${label}</small></div>`).join('')}</div>
          <h4>Next unlocks</h4>
          <div class="pf-next">
            ${upcoming.length ? upcoming.map(u => `<div class="pf-item">${itemMark(u.id, u.name)}<span><b>${esc(u.name)}</b><small>${esc(levelRequirement(u.level))}</small></span></div>`).join('') : '<p class="pf-done">Every perk, tactical, lethal and streak is unlocked.</p>'}
          </div>
        </div>
      </div>`;
  };
  menu.on({
    pfBack: onBack,
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
          onDone: render,
        });
      },
    }),
  });
  render();
  menu.show();
}

function careerStats() {
  const sum = key => WEAPON_IDS.reduce((total, w) => total + Progress.weaponStats(w)[key], 0);
  const mastered = WEAPON_IDS.filter(w => Progress.isMastered(w)).length;
  return [['Total XP', Progress.totalXp.toLocaleString('en-US')], ['Gun kills', sum('kills')], ['Headshots', sum('head')], ['Longshots', sum('long')], ['Mastered', `${mastered}/${WEAPON_IDS.length}`]];
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
