// Mode modifiers in the menus (docs/MODES.md): the toggles in the Custom match settings sheet and the friend lobby's
// sheet, the chip that shows what is on, and the featured playlist's button. The rules are in js/shared/playlist.js.
//
//   soloMods() / setSoloMods(list)            this device's picks for bot matches, saved
//   modsRows(mods, mode)                      toggle rows for a sheet (data-act="modToggle" data-id)
//   toggleMod(mods, id)                       the list with one modifier flipped (clashing ones dropped)
//   modsSheet(menu, {mods, mode, onChange})   the friend lobby's sheet (host only)
//   modsChip(mods, {act, fixed})              the lobby's chip
//   featuredButton(cls)                       today's featured playlist as a button (data-act="featured")
import { MODS, MOD_IDS, cleanMods, featured } from '../shared/playlist.js';
import { MODES } from '../shared/modes.js';
import { esc } from './widgets.js';
import { ico } from './yard.js';

const KEY = 'switchyard-mods';
let saved = load();
function load() {
  try { return cleanMods(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; }
}
export const soloMods = () => saved.slice();
export function setSoloMods(list) {
  saved = cleanMods(list);
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode: this session only */ }
}

export function toggleMod(mods, id) {
  if (!MODS[id]) return mods;
  return mods.includes(id) ? mods.filter(m => m !== id) : cleanMods([...mods, id]);
}

const ICON = { hardcore: 'skull', snipers: 'aim', melee: 'shiv', nostreaks: 'lock' };

// One row per modifier: name, what it does, and an on/off seg. A modifier the mode ignores is shown disabled with why.
export function modsRows(mods, mode = null) {
  const usable = mode && MODES[mode] ? cleanMods(MOD_IDS, mode) : MOD_IDS;
  return `<div class="mods-rows">${MOD_IDS.map(id => {
    const m = MODS[id], on = mods.includes(id), ok = usable.includes(id);
    return `<button class="mod-row${on && ok ? ' on' : ''}" data-act="modToggle" data-id="${id}" data-sound="tab" ${ok ? '' : 'disabled'} aria-pressed="${on && ok}">
      <i class="mod-ico">${ico(ICON[id] ?? 'star')}</i>
      <span class="mod-txt"><b>${esc(m.name)}</b><small>${esc(ok ? m.desc : 'This mode deals its own guns')}</small></span>
      <i class="mod-sw" aria-hidden="true"></i>
    </button>`;
  }).join('')}</div>`;
}

export function modsLabel(mods) {
  return mods.length ? mods.map(id => MODS[id]?.name ?? id).join(', ') : 'No modifiers';
}

export function modsChip(mods, { act = 'lobbyMods', fixed = false } = {}) {
  return `<button class="chip mods-chip${mods.length ? ' on' : ''}" ${fixed ? 'disabled' : `data-act="${act}"`}>${ico('options')}<b>${esc(mods.length ? mods.map(id => MODS[id].short).join(' ') : 'Modifiers')}</b></button>`;
}

export function modsSheet(menu, { mods, mode = null, onChange }) {
  let list = mods.slice();
  const paint = () => menu.overlay(`
    <div class="sheet bm-sheet mods-sheet" role="dialog" aria-label="Modifiers">
      <div class="bm-head">
        <span class="bm-title"><b>Modifiers</b><small>Every match in this room</small></span>
        <button class="btn is-primary bm-done" data-act="modsDone" data-sound="confirm">${ico('check')}<b>Done</b></button>
      </div>
      ${modsRows(list, mode)}
    </div>`);
  menu.on({
    modToggle: ({ id }) => { list = toggleMod(list, id); paint(); onChange?.(list); },
    modsDone: () => { menu.overlay(''); onChange?.(list); },
  });
  paint();
}

export function featuredButton(cls = 'tl-btn tl-featured') {
  const f = featured();
  return `<button class="${cls}" data-act="featured" data-in="rail">${ico('star')}<span><small>Featured today</small><b>${esc(f.name)}</b></span></button>`;
}

export const MODS_CSS = `
.mods-rows { display: flex; flex-direction: column; gap: 6px; }
.mod-row { display: grid; grid-template-columns: 30px 1fr 40px; align-items: center; gap: 10px; min-height: 46px; padding: 6px 10px; border: 0; text-align: left;
  color: var(--c-chalk); background: var(--face-steel, #222a33); box-shadow: var(--bevel); clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px); }
.mod-row .mod-ico { display: grid; place-items: center; color: var(--c-haze); }
.mod-row .mod-txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.mod-row b { font: 400 var(--fs-lead)/1 var(--f-stencil); letter-spacing: var(--tr-stencil); }
.mod-row small { font: var(--fs-caption)/1.2 var(--f-body); color: var(--c-haze); }
.mod-row .mod-sw { width: 38px; height: 20px; background: rgba(231,234,228,.14); position: relative; clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); }
.mod-row .mod-sw::after { content: ''; position: absolute; top: 3px; left: 4px; width: 14px; height: 14px; background: var(--c-haze); transition: transform var(--dur-fast) var(--ease-out); }
.mod-row.on { box-shadow: var(--bevel), inset 3px 0 0 var(--c-sodium); }
.mod-row.on .mod-ico { color: var(--c-sodium); }
.mod-row.on .mod-sw { background: var(--c-sodium-lo, #7a5418); }
.mod-row.on .mod-sw::after { transform: translateX(16px); background: var(--c-sodium); }
.mod-row:disabled { opacity: .45; }
.mods-sheet .mods-rows { max-height: min(62vh, 300px); overflow-y: auto; }
/* In the bot match sheet: two columns, and the sheet scrolls when a short phone cannot hold it all. */
#ui .bm-sheet { max-height: calc(100dvh - 12px); }
#ui .bm-sheet .mods-rows { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; flex: none; }
#ui .bm-sheet .mod-row { min-height: 40px; padding: 4px 8px; grid-template-columns: 22px 1fr 34px; gap: 7px; }
#ui .bm-sheet .mod-row b { font-size: var(--fs-body); }
#ui .bm-sheet .mod-row small { font-size: var(--fs-micro); }
#ui .bm-sheet .mod-row .mod-sw { width: 32px; height: 18px; }
#ui .bm-sheet .mod-row.on .mod-sw::after { transform: translateX(12px); }
#ui .bm-sheet .mod-row .mod-sw::after { width: 12px; height: 12px; }
#ui .bm-sheet > * { flex: none; }
.chip.mods-chip.on { box-shadow: var(--bevel), inset 0 -2px 0 var(--c-sodium); }
.chip.mods-chip.on b { color: var(--c-sodium); }
.bm-mods-h { margin: 8px 0 4px; font: var(--fs-micro)/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); text-transform: uppercase; }
.tl-featured span, .solo-feat span { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
.tl-featured small, .solo-feat small { font: var(--fs-micro)/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-sodium); text-transform: uppercase; }
.tl-featured b, .solo-feat b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
`;
// The sheet and chip styles go in once, with the module.
if (typeof document !== 'undefined' && !document.getElementById('mods-css')) {
  const st = document.createElement('style');
  st.id = 'mods-css';
  st.textContent = MODS_CSS;
  document.head.appendChild(st);
}
