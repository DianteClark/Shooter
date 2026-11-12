// Graveyard Shift on the phone that owns a gun (docs/ZOMBIES.md): what the host's events hand the local player. The
// host does the same to bots directly (js/sim/zombies.js); a human's guns, ammo and reload live on their phone.
//   {t:'zarm', id, slot, w}    a wall-buy or the crate: gun w (a WEAPON_IDS index) into that slot, full
//   {t:'zammo', id, slot?}     a refill of that slot (both when omitted)
//   {t:'zperk', id, perk|lost} Quickdraw adds Fast Hands' reload; going down loses every perk
import { WEAPON_IDS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { brArm } from './br.js';

export function zmEvent(ps, e) {
  switch (e.t) {
    case 'zarm': {
      const id = WEAPON_IDS[e.w], w = WEAPONS[id];
      if (!w) return;
      const slot = e.slot === 1 ? 1 : 0;
      brArm(ps, slot, id, undefined, 0, w.magazine, w.unlimitedReserve ? 999 : (w.reserve ?? w.magazine * 3));
      ps.slot = slot; ps.weapon = id;
      return;
    }
    case 'zammo':
      for (let s = 0; s < 2; s++) {
        if (e.slot !== undefined && e.slot !== s) continue;
        const w = ps.defs[s];
        if (!w || w.melee) continue;
        ps.ammo[s] = w.magazine;
        if (!w.unlimitedReserve) ps.reserve[s] = w.reserve ?? w.magazine * 3;
      }
      return;
    case 'zperk':
      if (e.lost) ps.perks = ps.perks.filter(k => k !== 'fasthands');
      else if (e.perk === 'quick' && !ps.perks.includes('fasthands')) ps.perks = [...ps.perks, 'fasthands'];
      return;
    default:
  }
}
