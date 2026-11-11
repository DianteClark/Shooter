// The armory in Training and on the firing range (Custom > Training): every gun this player owns, primaries and
// sidearms, each with the attachments it is set up with in the active loadout's Gunsmith. A pick goes on at once:
// hud.onArmory hands the loadout to main.js, which sends it and the sim's trainSwap (a respawn where you stand).
import { WEAPONS } from '../shared/weapons.js';
import { PRIMARY_IDS, SECONDARY_IDS } from '../shared/constants.js';
import { Progress } from './progress.js';
import { icon } from './icons.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const owned = ids => ids.filter(id => WEAPONS[id] && Progress.isItemUnlocked('weapon', id));

// The active loadout with `id` swapped in, its own kit fitted.
export function armoryLoadout(id) {
  if (PRIMARY_IDS.includes(id)) return Progress.loadout(id);
  const base = Progress.loadout();
  return { ...base, secondary: id, attachments: { ...base.attachments, [id]: Progress.kitFor(Progress.activeLoadout, id) } };
}

export class ArmorySheet {
  constructor(host, onPick) {
    this.onPick = onPick;
    this.el = document.createElement('div');
    this.el.className = 'armory';
    this.el.hidden = true;
    this.el.dataset.tap = '1';        // Touches here never reach the sticks (controls.js hudTap).
    host.appendChild(this.el);
    this.el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.gun) { this.close(); this.onPick?.(armoryLoadout(b.dataset.gun)); }
      else this.close();
    });
  }

  get isOpen() { return !this.el.hidden; }

  open(current = {}) {
    const section = (title, ids, now) => `<h4>${title}</h4><div class="arm-grid">${ids.map(id => `
      <button class="arm-gun${id === now ? ' on' : ''}" data-gun="${id}" data-tap="1">
        <span class="arm-ico">${icon(id, { size: 16 })}</span><b>${esc(WEAPONS[id].name)}</b><small>${esc(WEAPONS[id].category ?? '')}</small>
      </button>`).join('')}</div>`;
    this.el.innerHTML = `
      <div class="arm-head"><b>Armory</b><small>Owned guns, your attachments. Goes on at once.</small><button class="arm-close" data-tap="1">Close</button></div>
      <div class="arm-body">${section('Primary', owned(PRIMARY_IDS), current.primary)}${section('Sidearm', owned(SECONDARY_IDS), current.secondary)}</div>`;
    this.el.hidden = false;
  }

  close() { this.el.hidden = true; }
}
