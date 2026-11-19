// Graveyard Shift on the phone that owns a gun (docs/ZOMBIES.md): what the host's events hand the local player. The
// host does the same to bots directly (js/sim/zombies.js); a human's guns, ammo and reload live on their phone.
//   {t:'zarm', id, slot, w, tier?}  a wall-buy, the crate or the upgrade bench: gun w (a WEAPON_IDS index) into that
//                              slot, full; `tier` (1..3) gives it the bench's bigger magazine and reserve (zmTierDef);
//                              `to` (0/1) the slot in hand afterwards when not that one (a gun handed in at the bench)
//   {t:'zammo', id, slot?}     a refill of that slot (both when omitted)
//   {t:'zperk', id, perk|lost} Quickdraw adds Fast Hands' reload, Fleetfoot Marathon's sprint; going down loses them
import { WEAPON_IDS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { brArm, brDef } from './br.js';
import { ZE, zmFxOf, zmWonderOf } from '../shared/zombies.js';

// A gun's def at an upgrade bench tier (ROADMAP item 36): the magazine and reserve grow; `zt` is the tier and `zfx` the
// tier-3 round effect. Damage is the host's business (js/sim/zm-econ.js gunHit). Memoised and frozen like brDef.
const TIER_DEFS = new Map();
export function zmTierDef(id, tier) {
  const base = brDef(id);
  if (!(tier > 0) || base.melee) return base;
  const key = `${id}|${tier}`;
  let d = TIER_DEFS.get(key);
  if (d) return d;
  // A wonder weapon (tier 5 and up, ZM_WONDERS): its own def on the carrier gun's id, nothing of the carrier's handling.
  const Wd = tier >= 5 ? zmWonderOf(id) : null;
  if (Wd) {
    const o = Wd.def;
    d = Object.freeze({ ...base, ...o, name: Wd.name, role: 'Wonder weapon', falloff: { start: o.range, end: o.range + 1, min: 1 }, bloomPerShot: 0.02, bloomRecover: 4, bloomScale: 1,
      pattern: undefined, burst: undefined, spinup: undefined, heat: undefined, charge: undefined, adsGate: undefined, boltKick: undefined, explosive: undefined, shellReload: undefined,
      pellets: 1, unlimitedReserve: false, kickCam: 0.4, zt: tier, zfx: null, zw: Wd.id });
    TIER_DEFS.set(key, d);
    return d;
  }
  const T = ZE.tiers[Math.min(3, tier)];
  d = Object.freeze({ ...base, magazine: Math.round(base.magazine * T.mag), reserve: Math.round((base.reserve ?? base.magazine * 3) * T.res), zt: tier, zfx: tier >= 3 ? zmFxOf(id) : null });
  TIER_DEFS.set(key, d);
  return d;
}

export function zmEvent(ps, e) {
  switch (e.t) {
    case 'zarm': {
      const id = WEAPON_IDS[e.w], w = WEAPONS[id];
      if (!w) return;
      const slot = e.slot === 1 ? 1 : 0;
      brArm(ps, slot, id, undefined, 0, w.magazine, w.unlimitedReserve ? 999 : (w.reserve ?? w.magazine * 3));
      if (e.tier > 0) {
        const d = zmTierDef(id, e.tier);
        ps.defs[slot] = d; ps.ammo[slot] = d.magazine; ps.reserve[slot] = d.unlimitedReserve ? 999 : d.reserve;
      }
      const to = e.to === 0 || e.to === 1 ? e.to : slot;
      ps.slot = to; ps.weapon = to === slot ? id : to === 0 ? ps.primary : ps.secondary;
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
      if (e.lost) ps.perks = ps.perks.filter(k => k !== 'fasthands' && k !== 'marathon');
      else if (e.perk === 'quick' && !ps.perks.includes('fasthands')) ps.perks = [...ps.perks, 'fasthands'];
      else if (e.perk === 'stride' && !ps.perks.includes('marathon')) ps.perks = [...ps.perks, 'marathon'];
      return;
    default:
  }
}
