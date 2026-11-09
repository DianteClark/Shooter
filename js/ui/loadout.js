// The loadout picker. Works in any container, so the menu and the between-lives sheet share it.
// Every tile acts at once: picks are never left unselected, an extra pick replaces the oldest one.
import { TACTICALS, LETHALS, PERKS, STREAKS } from '../shared/catalog.js';
import { Progress } from './progress.js';
import { icon } from './icons.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SECTIONS = [
  { key: 'tactical', title: 'Tactical', table: TACTICALS, pick: 1, tag: i => `x${i.count}` },
  { key: 'lethal', title: 'Lethal', table: LETHALS, pick: 1, tag: i => `x${i.count}` },
  { key: 'perks', title: 'Perks', sub: 'Pick 2', table: PERKS, pick: 2, tag: () => '' },
  { key: 'streaks', title: 'Streaks', sub: 'Pick 3', table: STREAKS, pick: 3, tag: i => `${i.cost}` },
];

export class LoadoutEditor {
  constructor(mount, onChange) {
    this.mount = mount;
    this.onChange = onChange;
    const l = Progress.loadout();
    this.order = { perks: [...l.perks], streaks: [...l.streaks] };   // Oldest first; decides what an extra pick replaces.
    this.click = e => {
      const tile = e.target.closest('[data-pick]');
      if (tile) this.#pick(tile.dataset.pick, tile.dataset.id);
    };
    mount.addEventListener('click', this.click);
    this.paint();
  }

  #pick(section, id) {
    const sec = SECTIONS.find(s => s.key === section);
    if (sec.pick === 1) {
      Progress.setEquipment({ [section]: id });
    } else {
      const list = this.order[section];
      if (list.includes(id)) return;          // Already held: picks stay full, so a tap on one changes nothing.
      list.shift();
      list.push(id);
      Progress.setEquipment({ [section]: [...list] });
    }
    this.paint();
    this.onChange?.(Progress.loadout());
  }

  paint() {
    const l = Progress.loadout();
    const has = (key, id) => (Array.isArray(l[key]) ? l[key].includes(id) : l[key] === id);
    this.mount.innerHTML = SECTIONS.map(s => `
      <div class="lo-row">
        <div class="lo-head"><b>${s.title}</b>${s.sub ? `<small>${s.sub}</small>` : ''}</div>
        <div class="lo-tiles">
          ${Object.values(s.table).map(item => `
          <button class="lo-tile${has(s.key, item.id) ? ' on' : ''}" data-pick="${s.key}" data-id="${item.id}" data-tap="1">
            ${s.key === 'perks' ? '' : icon(item.id)}
            <span class="lo-text"><b>${esc(item.name)}</b><small>${esc(item.desc)}</small></span>
            ${s.tag(item) ? `<em>${s.tag(item)}</em>` : ''}
          </button>`).join('')}
        </div>
      </div>`).join('');
  }

  dispose() {
    this.mount.removeEventListener('click', this.click);
    this.mount.textContent = '';
  }
}
