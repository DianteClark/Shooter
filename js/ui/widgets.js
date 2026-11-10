// Small markup helpers shared by every screen outside a match, and by the HUD's badges.
import { badgeSvg } from '../shared/progression.js';
import { icon, hasIcon, resolveIcon } from './icons.js';
import { rollNumber } from './motion.js';
import { ATTACHMENTS } from '../shared/attachments.js';
import { CAMOS } from '../shared/camos.js';

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const hex = n => '#' + n.toString(16).padStart(6, '0');

export const SLOT_LABEL = { optic: 'Optic', barrel: 'Barrel', mag: 'Magazine', grip: 'Grip' };
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const icons = new Map();
// Badge emblems repeat constantly in feeds and tables, so each rank/size string is built once.
export function badgeMark(prestige = 0, size = 18) {
  const key = prestige * 1000 + size;
  let svg = icons.get(key);
  if (!svg) icons.set(key, svg = badgeSvg(prestige, size));
  return svg;
}

// Badge plus level: what lobby and scoreboards print next to a name. Null badge renders nothing.
export function badgeTag(badge, size = 18) {
  if (!badge) return '';
  return `<span class="bdg">${badgeMark(badge.prestige ?? 0, size)}<b>${badge.level ?? 1}</b></span>`;
}

// A weapon's level and its weapon-prestige rank, as one unbreakable unit: "Lv 30" then a gold rank plate "III", with a
// fixed gap so the two never touch or read as one number ("Lv 301"). Every screen that prints both uses this
// (tokens.css, .wlv). `opts.max` swaps the number for "Max" where a row would rather say so.
export function weaponLevelHtml(level, prestige = 0, { cls = '' } = {}) {
  const rank = prestige ? `<em class="wlv-p" title="Weapon prestige ${prestige}">${ROMAN[prestige] ?? prestige}</em>` : '';
  return `<span class="wlv${cls ? ` ${cls}` : ''}"><span class="wlv-n">Lv ${level}</span>${rank}</span>`;
}

// The stroked icons shared with the touch controls, plus a padlock for anything not yet earned.
export const lockIcon = (size = 24) => icon('ui:lock', { size, cls: 'lk' });

// Re-exported so screens can take everything markup-related from one place.
export { icon, hasIcon };

// An item's icon: weapons as a square-fitted silhouette, attachments by their slot, anything unknown as the
// neutral lamp. `name` is kept for older callers and used as the accessible label only when asked.
export function itemMark(id, name, { size = 24, slot } = {}) {
  let key = resolveIcon(id);
  if (key === 'unknown') {
    const s = slot ?? ATTACHMENTS[id]?.slot;
    if (s) key = resolveIcon(s);
    else if (CAMOS.some(c => c.id === id)) key = 'ui:camo';
  }
  return icon(key, { size, square: true, cls: 'item-svg' });
}

// A swatch hints at the pattern family with CSS only; the real thing is on the gun in the preview.
export function swatchCss(c) {
  const [a, b = a, d = b, e = d] = c.colors.map(hex);
  switch (c.pattern) {
    case 'digital': return `conic-gradient(${a} 25%, ${b} 25% 50%, ${d} 50% 75%, ${e} 75%) 0 0 / 14px 14px`;
    case 'tiger': return `repeating-linear-gradient(112deg, ${a} 0 9px, ${b} 9px 15px, ${d} 15px 19px, ${b} 19px 25px)`;
    case 'splinter': return `linear-gradient(127deg, ${a} 34%, transparent 34.5%), linear-gradient(58deg, ${b} 46%, ${d} 46.5% 72%, ${e} 72.5%)`;
    case 'hex': return `radial-gradient(circle at 50% 50%, ${b} 34%, ${a} 36%) 0 0 / 12px 11px`;
    case 'carbon': return `repeating-linear-gradient(45deg, ${a} 0 5px, ${b} 5px 10px)`;
    case 'livewire': return `repeating-linear-gradient(100deg, ${a} 0 9px, ${b} 9px 11px, ${a} 11px 15px, ${d} 15px 16px)`;
    case 'aurora': return `linear-gradient(160deg, ${a} 10%, ${b} 40%, ${d} 70%, ${a})`;
    case 'singularity': return `radial-gradient(circle at 50% 55%, ${a} 0 28%, ${d} 32%, ${b} 46%, ${e} 80%)`;
    case 'solid': return a;
    default: return `linear-gradient(118deg, ${a}, ${b} 55%, ${d})`;
  }
}

// Requirement line for a locked item: consistent wording everywhere one can appear.
export const levelRequirement = level => `Unlocks at level ${level}`;

// Rolls an element's number from `from` to `to`. Kept for older callers; new code uses motion.rollNumber.
export function countUp(el, from, to, ms = 700, format = n => Math.round(n)) {
  return rollNumber(el, to, { from, duration: ms, format });
}
