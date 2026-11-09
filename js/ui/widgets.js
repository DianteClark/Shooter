// Small markup helpers shared by every screen outside a match, and by the HUD's badges.
import { badgeSvg } from '../shared/progression.js';
import { ITEM_ICONS } from './icons.js';

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

// The stroked icons shared with the touch controls, plus a padlock for anything not yet earned.
export const lockIcon = () => `<svg class="lk" viewBox="0 0 32 32" aria-hidden="true">${ITEM_ICONS.lock}</svg>`;

// An item's stroked icon, or a stencilled diamond of its initials for items without one (perks, attachments).
export function itemMark(id, name) {
  return ITEM_ICONS[id]
    ? `<svg class="item-svg" viewBox="0 0 32 32" aria-hidden="true">${ITEM_ICONS[id]}</svg>`
    : `<span class="perk-mark">${esc(String(name ?? id).slice(0, 2))}</span>`;
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

// Rolls an element's number from `from` to `to`, for results and other moments that deserve a beat.
export function countUp(el, from, to, ms = 700, format = n => Math.round(n)) {
  if (!el) return;
  const t0 = performance.now();
  const step = now => {
    if (!el.isConnected) return;
    const f = Math.min(1, (now - t0) / ms), eased = 1 - (1 - f) ** 3;
    el.textContent = format(from + (to - from) * eased);
    if (f < 1) requestAnimationFrame(step);
  };
  el.textContent = format(from);
  requestAnimationFrame(step);
}
