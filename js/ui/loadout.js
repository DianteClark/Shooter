// The Loadouts screen: five named sets down the side, every slot of the chosen set visible at once.
// A slot opens a picker that slides over just the slots, so a swap is two taps and never loses the rail.
import { TACTICALS, LETHALS, PERKS, STREAKS } from '../shared/catalog.js';
import { WEAPONS } from '../shared/weapons.js';
import { getCamo } from '../shared/camos.js';
import { SLOTS, ATTACHMENTS, attachmentsFor } from '../shared/attachments.js';
import { LOADOUT_COUNT } from '../shared/progression.js';
import { Progress } from './progress.js';
import { esc, lockIcon, swatchCss, levelRequirement, SLOT_LABEL, ROMAN, itemMark } from './widgets.js';

const SECTIONS = {
  tactical: { kind: 'tactical', title: 'Tactical', table: TACTICALS },
  lethal: { kind: 'lethal', title: 'Lethal', table: LETHALS },
  perks: { kind: 'perk', title: 'Perk', table: PERKS, count: 2 },
  streaks: { kind: 'streak', title: 'Streak', table: STREAKS, count: 3 },
};

export class LoadoutsScreen {
  constructor(menu, { onBack, onChange, onGunsmith, onRename }) {
    this.menu = menu;
    this.onChange = onChange;
    this.onGunsmith = onGunsmith;
    this.onRename = onRename;
    this.selected = menu.lastLoadoutIndex ?? Progress.activeLoadout;
    this.sheet = null;           // { key, idx } while a picker is open.
    menu.on({
      loBack: () => { menu.lastLoadoutIndex = null; onBack(); },
      loPick: ({ i }) => { this.selected = Number(i); menu.lastLoadoutIndex = this.selected; this.render(); },
      loEquip: () => this.equip(),
      loGun: () => this.onGunsmith(this.selected),
      loRename: () => this.onRename(this.selected),
      loSlot: ({ key, idx }) => this.openSheet(key, Number(idx)),
      loChoose: ({ id }) => this.choose(id),
      loClose: () => this.closeSheet(),
    });
    this.render();
    menu.show();
  }

  equip() {
    Progress.activeLoadout = this.selected;
    this.onChange?.();
    this.render();
    this.menu.toast(`${Progress.loadouts()[this.selected].name} equipped`);
  }

  openSheet(key, idx) {
    this.sheet = { key, idx };
    this.paintSheet();
  }

  closeSheet() {
    this.sheet = null;
    this.menu.el.querySelector('.lo-sheet')?.classList.remove('open');
  }

  choose(id) {
    const { key, idx } = this.sheet;
    const sec = SECTIONS[key];
    if (!Progress.isItemUnlocked(sec.kind, id)) {
      this.menu.toast(`${sec.table[id].name}: ${levelRequirement(Progress.itemUnlockLevel(sec.kind, id))}`);
      return;
    }
    const l = Progress.loadouts()[this.selected];
    if (sec.count) {
      const list = [...l[key]];
      if (list.includes(id)) { this.closeSheet(); return; }   // Already held: picks stay distinct, nothing to change.
      list[idx] = id;
      Progress.updateLoadout(this.selected, { [key]: list });
    } else {
      Progress.updateLoadout(this.selected, { [key]: id });
    }
    this.onChange?.();
    this.sheet = null;
    this.render();
  }

  render() {
    const m = this.menu, all = Progress.loadouts(), active = Progress.activeLoadout;
    const l = all[this.selected], kit = attachmentsFor(l, l.primary), camo = getCamo(l.camo);
    const isActive = this.selected === active;
    m.el.dataset.screen = 'loadouts';
    m.el.innerHTML = `
      <header class="bar">
        <button class="back" data-act="loBack">Done</button>
        <h2>Loadouts</h2>
        <span class="eyebrow lo-hint">Equipped: ${esc(all[active].name)}</span>
      </header>
      <div class="lo enter">
        <div class="lo-rail">
          ${all.slice(0, LOADOUT_COUNT).map((x, i) => `
            <button class="lo-card${i === this.selected ? ' on' : ''}${i === active ? ' active' : ''}" data-act="loPick" data-i="${i}">
              <i class="lamp"></i>
              <b>${esc(x.name)}</b>
              <small>${esc(WEAPONS[x.primary]?.name ?? '')}</small>
            </button>`).join('')}
        </div>
        <div class="lo-main">
          <div class="lo-top">
            <button class="lo-gun" data-act="loGun">
              <span class="lo-gun-view"></span>
              <span class="lo-gun-text">
                <b>${esc(WEAPONS[l.primary]?.name ?? '')}</b>
                <small><i class="sw" style="background:${swatchCss(camo)}"></i>${esc(camo.name)}</small>
                <em>Lv ${Progress.weaponLevel(l.primary)}${Progress.weaponPrestige(l.primary) ? ` ${ROMAN[Progress.weaponPrestige(l.primary)]}` : ''}</em>
              </span>
              <span class="lo-kit">${SLOTS.map(s => `<i class="${kit[s] ? 'has' : ''}"><small>${SLOT_LABEL[s]}</small><b>${kit[s] ? esc(ATTACHMENTS[kit[s]].name) : 'Stock'}</b></i>`).join('')}</span>
            </button>
            <div class="lo-actions">
              <button class="route small" data-act="loRename"><b>Rename</b></button>
              <button class="route ${isActive ? 'lit' : 'primary'}" data-act="loEquip" ${isActive ? 'disabled' : ''}><i class="lamp"></i><b>${isActive ? 'Equipped' : 'Equip'}</b></button>
            </div>
          </div>
          <div class="lo-gear">
            ${this.slotTile('tactical', 0, l.tactical)}
            ${this.slotTile('lethal', 0, l.lethal)}
            ${this.slotTile('perks', 0, l.perks[0])}
            ${this.slotTile('perks', 1, l.perks[1])}
          </div>
          <div class="lo-gear lo-streaks">
            ${[0, 1, 2].map(i => this.slotTile('streaks', i, l.streaks[i])).join('')}
          </div>
          <div class="lo-sheet"></div>
        </div>
      </div>`;
    m.previewMount(m.el.querySelector('.lo-gun-view'), l.primary, l.camo, kit);
    if (this.sheet) this.paintSheet(true);
  }

  slotTile(key, idx, id) {
    const sec = SECTIONS[key], item = sec.table[id];
    const tag = key === 'streaks' ? item.cost : item.count ? `x${item.count}` : '';
    return `<button class="lo-tile" data-act="loSlot" data-key="${key}" data-idx="${idx}">
      <span class="lo-tile-icon">${itemMark(id, item.name)}</span>
      <span class="lo-text"><small>${sec.title}${sec.count ? ` ${idx + 1}` : ''}</small><b>${esc(item.name)}</b></span>
      ${tag ? `<em>${tag}</em>` : ''}
    </button>`;
  }

  paintSheet(instant) {
    const sheet = this.menu.el.querySelector('.lo-sheet');
    const { key, idx } = this.sheet;
    const sec = SECTIONS[key];
    const l = Progress.loadouts()[this.selected];
    const current = sec.count ? l[key][idx] : l[key];
    sheet.innerHTML = `
      <div class="lo-sheet-head"><b>${sec.title}${sec.count ? ` slot ${idx + 1}` : ''}</b><small>Tap to choose</small><button class="back" data-act="loClose">Close</button></div>
      <div class="lo-opts">
        ${Object.values(sec.table).map(item => {
          const unlocked = Progress.isItemUnlocked(sec.kind, item.id);
          const on = item.id === current;
          const held = sec.count && !on && l[key].includes(item.id);
          return `<button class="lo-opt${on ? ' on' : ''}${unlocked ? '' : ' locked'}${held ? ' held' : ''}" data-act="loChoose" data-id="${item.id}">
            <span class="lo-tile-icon">${itemMark(item.id, item.name)}</span>
            <span class="lo-text"><b>${esc(item.name)}</b><small>${unlocked ? esc(item.desc) : esc(levelRequirement(Progress.itemUnlockLevel(sec.kind, item.id)))}</small></span>
            ${unlocked ? (key === 'streaks' ? `<em>${item.cost}</em>` : item.count ? `<em>x${item.count}</em>` : held ? '<em class="in">In use</em>' : '') : `<em class="lock">${lockIcon()}</em>`}
          </button>`;
        }).join('')}
      </div>`;
    if (instant) sheet.classList.add('open');
    else requestAnimationFrame(() => sheet.classList.add('open'));
  }
}
