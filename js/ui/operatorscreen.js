// The Operators screen: a turntable on the left with the operator's skins down its right edge; on the right the
// operator's file (bio, how they are earned, skins owned) over the roster, a scrolling list with All / Owned / Locked
// tabs. Tapping a card or a skin previews it; a locked one still previews, since seeing the prize is the point, and the
// detail line says what earns it. Equip puts the operator on this loadout and the previewed skin on that operator.
import { DEFAULT_OPERATOR, getSkin, SKIN_TIERS } from './operators.js';
import { Progress } from './progress.js';
import { currentSkin, skinStatus, equipSkin } from './cards.js';
import { masteryChip } from './mastery.js';
import { esc, hex } from './widgets.js';
import { ico, header } from './yard.js';
import { flash, pop } from './motion.js';
import { unlockSheet } from './unlocksheet.js';

const GLOW_CLASS = ['', 'lit', 'pulse', 'prism'];
// Brings a card into the list's view without moving the page.
function scrollToCard(card) {
  const list = card?.parentElement;
  if (!list) return;
  const top = card.offsetTop - list.offsetTop, bottom = top + card.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top - 4;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
}

export class OperatorsScreen {
  constructor(menu, { loadoutIndex = Progress.activeLoadout, onBack, onChange }) {
    this.menu = menu;
    this.onChange = onChange;
    this.index = loadoutIndex;
    this.onBack = onBack;
    this.preview = this.equipped;
    this.skin = currentSkin(this.preview);
    this.filter = 'all';
    menu.on({
      opFilter: ({ id }) => this.setFilter(id),
      opBack: () => onBack(),
      opPick: ({ id }) => this.tap(id),
      opSkin: ({ id }) => this.tapSkin(id),
      opEquip: () => this.equip(),
      opFin: ({ id }) => this.pickFinisher(id),
    });
    this.render();
    menu.show();
  }

  get loadout() { return Progress.loadouts()[this.index]; }
  get equipped() { return this.loadout.operator ?? DEFAULT_OPERATOR; }

  tap(id) {
    if (id === this.preview) {
      if (!Progress.isOperatorUnlocked(id)) unlockSheet(this.menu, 'operator', id);
      else if (id !== this.equipped) this.equip();
      return;
    }
    this.preview = id;
    this.skin = currentSkin(id);
    this.renderSkins();
    this.paint();
    this.mount();
  }

  tapSkin(id) {
    if (id === this.skin) {
      const st = skinStatus(this.preview).find(s => s.skin.id === id);
      if (st && !st.unlocked) unlockSheet(this.menu, 'skin', id);
      else if (st?.unlocked && !st.equipped && Progress.isOperatorUnlocked(this.preview)) this.equip();
      return;
    }
    this.skin = id;
    this.paint();
    this.mount();
  }

  setFilter(id) {
    if (!['all', 'owned', 'locked'].includes(id) || id === this.filter) return;
    this.filter = id;
    const grid = this.menu.el.querySelector('.op-grid');
    grid.scrollTop = 0;
    this.paint();
  }

  equip() {
    const entry = Progress.operators().find(o => o.op.id === this.preview);
    if (!entry?.unlocked) {
      unlockSheet(this.menu, 'operator', this.preview);
      return;
    }
    const st = skinStatus(this.preview).find(s => s.skin.id === this.skin);
    if (!st?.unlocked) {
      unlockSheet(this.menu, 'skin', this.skin);
      return;
    }
    const opChanged = this.preview !== this.equipped && Progress.setOperator(this.index, this.preview);
    const skinChanged = !st.equipped && equipSkin(this.preview, this.skin);
    if (opChanged || skinChanged) {
      this.onChange?.();
      this.menu.toast(st.skin.tier === 'base' ? `${entry.op.name} equipped` : `${entry.op.name}: ${st.skin.name} equipped`);
      flash(this.menu.el.querySelector('.op-bay'), { color: 'var(--c-sodium-hi)', peak: 0.3 });
    }
    this.renderSkins();
    this.paint();
  }

  // The finishing move this operator plays (docs/FINISHERS.md): set at once for an earned one; a locked one says why.
  pickFinisher(id) {
    const f = Progress.finishers(this.preview).find(x => x.id === id);
    if (!f) return;
    const chip = this.menu.el.querySelector(`.op-finchip[data-id="${id}"]`);
    if (!f.unlocked) { unlockSheet(this.menu, 'finisher', id, { operator: this.preview }); return; }
    if (f.equipped) { this.menu.toast(`${f.name}: ${f.desc}`); return; }
    if (Progress.setFinisher(this.preview, id)) {
      this.onChange?.();
      const op = Progress.operators().find(o => o.op.id === this.preview)?.op;
      this.menu.toast(`${op?.name ?? 'Operator'}: ${f.name} equipped. ${f.desc}`);
      if (chip) pop(chip);
    }
    this.paint();
  }

  // The turntable takes a skin id in place of the operator id (OperatorPreview.show resolves it).
  mount() {
    const l = this.loadout;
    this.menu.operatorMount(this.menu.el.querySelector('.op-view'), this.skin, l.primary, l.camo, l.attachments?.[l.primary]);
  }

  render() {
    const m = this.menu;
    m.el.dataset.screen = 'operators';
    m.el.innerHTML = `
      ${header({ back: 'opBack', label: 'Done', title: 'Operators', extra: `<span class="hdr-tag">${ico('loadout')}${esc(this.loadout.name)}</span>` })}
      <div class="op">
        <div class="op-bay has-skins" data-in="left">
          <div class="op-floor" aria-hidden="true"></div>
          <div class="op-view"></div>
          <div class="op-name"><b></b><small></small><span class="op-skinname"></span><span class="op-mchip"></span></div>
          <div class="op-skins"></div>
          <div class="op-detail"></div>
        </div>
        <div class="op-side">
          <div class="op-file" data-in="up"><p class="op-bio"></p><div class="op-tags"></div>
            <div class="op-fin"><small>Finisher</small><div class="op-fins scroll-x"></div></div></div>
          <div class="op-tabs" role="tablist">
            ${[['all', 'All'], ['owned', 'Owned'], ['locked', 'Locked']].map(([id, label]) => `<button class="op-tab" data-act="opFilter" data-id="${id}" data-sound="tab"><b>${label}</b><small></small></button>`).join('')}
          </div>
        <div class="op-grid scroll-y">
          ${Progress.operators().map(({ op, unlocked }) => `
            <button class="op-card${unlocked ? '' : ' locked'}" data-act="opPick" data-id="${op.id}" style="--op:${hex(op.look.sleeve)};--op2:${hex(op.look.trouser)}" data-in="up">
              <span class="op-stripe" aria-hidden="true"></span>
              ${ico(unlocked ? 'operator' : 'lock', 'op-ico')}
              <b>${esc(op.name)}</b>
              <small></small>
              <i class="op-mini"><i></i></i>
            </button>`).join('')}
        </div>
        </div>
      </div>`;
    this.renderSkins();
    this.mount();
    this.paint();
    scrollToCard(m.el.querySelector(`.op-card[data-id="${this.preview}"]`));
  }

  // One swatch per skin: gear, sleeve and trouser colours on the diagonal, the accent along the foot.
  renderSkins() {
    const box = this.menu.el.querySelector('.op-skins');
    box.innerHTML = skinStatus(this.preview).map(({ skin, unlocked, equipped }) => {
      const gear = skin.gear ?? skin.sleeve;
      return `<button class="op-skin${unlocked ? '' : ' locked'}${equipped ? ' equipped' : ''} ${GLOW_CLASS[skin.glow]}" data-act="opSkin" data-id="${skin.id}"
        style="--g:${hex(gear)};--s:${hex(skin.sleeve)};--t:${hex(skin.trouser)};--a:${skin.accent != null ? hex(skin.accent) : 'var(--c-rail)'}" aria-label="${esc(skin.name)}">
        <i class="op-sw" aria-hidden="true"></i>${unlocked ? '' : ico('lock', 'op-sk-lock')}<small>${esc(SKIN_TIERS[skin.tier].label)}</small>
      </button>`;
    }).join('');
  }

  paint() {
    const el = this.menu.el;
    const roster = Progress.operators(), entry = roster.find(o => o.op.id === this.preview);
    const op = entry.op, equippedId = this.equipped;
    const skins = skinStatus(op.id), st = skins.find(s => s.skin.id === this.skin) ?? skins[0];
    el.querySelector('.op-name b').textContent = op.name;
    el.querySelector('.op-name small').textContent = op.role;
    el.querySelector('.op-skinname').innerHTML = `${esc(st.skin.name)}<u>${esc(SKIN_TIERS[st.skin.tier].label)}</u>`;
    el.querySelector('.op-mchip').innerHTML = masteryChip(op.id);
    const detail = el.querySelector('.op-detail');
    const wearing = op.id === equippedId && st.equipped;
    if (!entry.unlocked || !st.unlocked) {
      const lock = entry.unlocked ? st : entry;
      const frac = Math.min(1, lock.value / lock.goal);
      detail.innerHTML = `<span class="op-state locked">${ico('lock')}${esc(lock.requirement)}<small>${lock.goal > 1 ? `${lock.value.toLocaleString('en-US')} / ${lock.goal.toLocaleString('en-US')}` : ''}</small></span>
        <i class="xp"><i style="transform:scaleX(${frac.toFixed(3)})"></i></i>`;
    } else {
      detail.innerHTML = wearing
        ? `<span class="op-state ok">${ico('check')}Equipped on ${esc(this.loadout.name)}</span>`
        : `<button class="btn is-primary op-equip" data-sound="confirm" data-act="opEquip">${ico('equip')}<b>Equip ${esc(op.id === equippedId ? st.skin.name : op.name)}</b></button>`;
    }
    for (const b of el.querySelectorAll('.op-skin')) {
      const on = b.dataset.id === this.skin;
      if (on && !b.classList.contains('on')) pop(b);
      b.classList.toggle('on', on);
    }
    // The file: the bio, how this operator is earned, and how many of the skins are owned.
    el.querySelector('.op-bio').textContent = op.bio ?? op.role;
    const owned = skins.filter(k => k.unlocked).length;
    const how = !op.unlock ? 'Starter' : op.unlock.prestige ? `Prestige ${op.unlock.prestige}` : op.unlock.level ? `Level ${op.unlock.level}` : 'Challenge';
    el.querySelector('.op-tags').innerHTML = `<span class="op-tag${entry.unlocked ? ' ok' : ''}">${ico(entry.unlocked ? 'check' : 'lock')}${entry.unlocked ? 'Owned' : esc(how)}</span>`
      + `<span class="op-tag">${ico('operator')}${owned} / ${skins.length} skins</span>`;
    el.querySelector('.op-fins').innerHTML = Progress.finishers(op.id).map(f => `<button class="op-finchip${f.equipped ? ' on' : ''}${f.unlocked ? '' : ' locked'}" data-act="opFin" data-id="${f.id}" data-sound="tab">${f.unlocked ? '' : ico('lock')}${esc(f.name)}</button>`).join('');
    const counts = { all: roster.length, owned: roster.filter(o => o.unlocked).length };
    counts.locked = counts.all - counts.owned;
    for (const t of el.querySelectorAll('.op-tab')) {
      t.classList.toggle('on', t.dataset.id === this.filter);
      t.setAttribute('aria-selected', t.dataset.id === this.filter);
      t.querySelector('small').textContent = counts[t.dataset.id];
    }
    for (const card of el.querySelectorAll('.op-card')) {
      const id = card.dataset.id, e = roster.find(o => o.op.id === id);
      card.classList.toggle('hide', this.filter === 'owned' ? !e.unlocked : this.filter === 'locked' ? e.unlocked : false);
      card.classList.toggle('on', id === this.preview);
      card.classList.toggle('equipped', id === equippedId);
      const skin = id === equippedId ? getSkin(currentSkin(id)) : null;
      card.querySelector('small').textContent = e.unlocked ? (id === equippedId ? (skin && skin.tier !== 'base' ? `Equipped, ${skin.name}` : 'Equipped') : e.op.role) : e.requirement;
      card.querySelector('.op-mini i').style.transform = `scaleX(${e.unlocked ? 1 : Math.min(1, e.value / e.goal).toFixed(3)})`;
    }
  }
}
