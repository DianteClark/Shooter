// What the weapon screens need to know about the arsenal, in one place.
import { WEAPONS } from '../shared/weapons.js';
import { CATEGORIES as ALL_CATEGORIES, PRIMARY_IDS, SECONDARY_IDS, WEAPON_IDS } from '../shared/constants.js';

export const CATEGORIES = ALL_CATEGORIES;
export const categoryOf = id => WEAPONS[id]?.category ?? (SECONDARY_IDS.includes(id) ? 'Pistol' : 'Assault');
// The Golden Gun always last in its category, after guns added later.
export const gunsIn = cat => WEAPON_IDS.filter(id => WEAPONS[id] && categoryOf(id) === cat).sort((a, b) => (a === 'golden') - (b === 'golden'));
export const slotOf = id => (PRIMARY_IDS.includes(id) ? 'primary' : 'secondary');
export const SLOT_NAME = { primary: 'Primary', secondary: 'Secondary' };
