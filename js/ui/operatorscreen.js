// The Operators screen: a turntable on the left, the roster on the right. Tapping a card previews it; a locked
// card still previews, since seeing the prize is the point, and its detail line says what earns it.
import { DEFAULT_OPERATOR } from './operators.js';
import { Progress } from './progress.js';
import { esc, lockIcon } from './widgets.js';

export class OperatorsScreen {
  constructor(menu, { loadoutIndex = Progress.activeLoadout, onBack, onChange }) {
    this.menu = menu;
    this.onChange = onChange;
    this.index = loadoutIndex;
    this.onBack = onBack;
    this.preview = this.equipped;
    menu.on({
      opBack: () => onBack(),
      opPick: ({ id }) => this.tap(id),
      opEquip: () => this.equip(),
    });
    this.render();
    menu.show();
  }

  get loadout() { return Progress.loadouts()[this.index]; }
  get equipped() { return this.loadout.operator ?? DEFAULT_OPERATOR; }

  tap(id) {
    if (id === this.preview) {
      if (id !== this.equipped && Progress.isOperatorUnlocked(id)) this.equip();
      return;
    }
    this.preview = id;
    this.paint();
    this.mount();
  }

  equip() {
    const entry = Progress.operators().find(o => o.op.id === this.preview);
    if (!entry?.unlocked) {
      this.menu.toast(`${entry?.op.name}: ${entry?.requirement}`);
      return;
    }
    if (Progress.setOperator(this.index, this.preview)) {
      this.onChange?.();
      this.menu.toast(`${entry.op.name} equipped`);
    }
    this.paint();
  }

  mount() {
    const l = this.loadout;
    this.menu.operatorMount(this.menu.el.querySelector('.op-view'), this.preview, l.primary, l.camo, l.attachments?.[l.primary]);
  }

  render() {
    const m = this.menu;
    m.el.dataset.screen = 'operators';
    m.el.innerHTML = `
      <header class="bar">
        <button class="back" data-act="opBack">Done</button>
        <h2>Operators</h2>
        <span class="eyebrow op-lo">Loadout: ${esc(this.loadout.name)}</span>
      </header>
      <div class="op enter">
        <div class="op-bay">
          <div class="op-view"></div>
          <div class="op-name"><b></b><small></small></div>
          <div class="op-detail"></div>
        </div>
        <div class="op-grid">
          ${Progress.operators().map(({ op, unlocked }) => `
            <button class="op-card${unlocked ? '' : ' locked'}" data-act="opPick" data-id="${op.id}">
              <b>${esc(op.name)}</b>
              ${unlocked ? '' : `<span class="op-lock">${lockIcon()}</span>`}
              <small></small>
            </button>`).join('')}
        </div>
      </div>`;
    this.mount();
    this.paint();
  }

  paint() {
    const el = this.menu.el;
    const roster = Progress.operators(), entry = roster.find(o => o.op.id === this.preview);
    const op = entry.op, equippedId = this.equipped;
    el.querySelector('.op-name b').textContent = op.name;
    el.querySelector('.op-name small').textContent = op.role;
    const detail = el.querySelector('.op-detail');
    if (entry.unlocked) {
      detail.innerHTML = op.id === equippedId
        ? '<span class="op-state ok">Equipped on this loadout</span>'
        : '<button class="route primary op-equip" data-act="opEquip"><i class="lamp"></i><b>Equip</b></button>';
    } else {
      const frac = Math.min(1, entry.value / entry.goal);
      detail.innerHTML = `<span class="op-state">${esc(entry.requirement)}</span>
        <i class="xp"><i style="transform:scaleX(${frac.toFixed(3)})"></i></i>
        <small class="op-progress">${entry.value} / ${entry.goal}</small>`;
    }
    for (const card of el.querySelectorAll('.op-card')) {
      const id = card.dataset.id, e = roster.find(o => o.op.id === id);
      card.classList.toggle('on', id === this.preview);
      card.classList.toggle('equipped', id === equippedId);
      card.querySelector('small').textContent = e.unlocked ? (id === equippedId ? 'Equipped' : '') : e.requirement;
    }
  }
}
