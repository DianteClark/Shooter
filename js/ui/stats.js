// The Stats screen: per-gun numbers from every recorded match (js/game/telemetry.js), sortable, filterable by
// category, for everyone in those matches, human players only, or just you. Export makes the code for the lead.
// Mount like the options screen: statsScreen(menu, { onBack }).
import { CATEGORIES, WEAPON_CATEGORY, WEAPON_IDS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { DIST_LABELS, GunStats, gunRows, gearRows } from '../game/telemetry.js';
import { TACTICALS, LETHALS } from '../shared/catalog.js';
import { esc } from './widgets.js';
import { ico, backButton } from './yard.js';

const SCOPE_LABEL = { a: 'Everyone', h: 'Players', m: 'Mine' };
const SCOPE_ICON = { a: 'team', h: 'user', m: 'star' };
// Sort keys: what the header shows, the row field, and whether bigger is better (ttk: smaller first).
const COLUMNS = [
  { key: 'kills', label: 'Kills', fmt: r => r.kills },
  { key: 'kd', label: 'K/D', fmt: r => num(r.kd, 2) },
  { key: 'acc', label: 'Acc', fmt: r => pct(r.acc) },
  { key: 'ttk', label: 'TTK', fmt: r => r.ttk === null ? '-' : `${r.ttk.toFixed(2)}s`, low: true },
  { key: 'pick', label: 'Pick', fmt: r => pct(r.pick) },
  { key: 'head', label: 'HS', fmt: r => pct(r.head) },
  { key: 'kpm', label: 'K/min', fmt: r => num(r.kpm, 2) },
];

// The Gear tab: one row per tactical and lethal (telemetry's eq: rows).
const GEAR_TAB = 'Gear';
const GEAR_IDS = [...Object.keys(TACTICALS), ...Object.keys(LETHALS)];
const GEAR_COLUMNS = [
  { key: 'uses', label: 'Uses', fmt: r => r.uses },
  { key: 'kills', label: 'Kills', fmt: r => r.kills },
  { key: 'killsPerUse', label: 'K/use', fmt: r => num(r.killsPerUse, 2) },
  { key: 'dmg', label: 'Dmg', fmt: r => r.dmg },
  { key: 'effects', label: 'Effect', fmt: r => r.effects },
  { key: 'usesPerPick', label: 'Use/c', fmt: r => num(r.usesPerPick, 1) },
];

const num = (v, d) => v === null || v === undefined ? '-' : v.toFixed(d);
const pct = v => v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`;

export function statsScreen(menu, { onBack }) {
  const state = { scope: 'a', cat: 'All', sort: 'kills', open: null, code: null };
  menu.el.dataset.screen = 'stats';

  const paint = () => {
    const agg = GunStats.totals();
    const gear = state.cat === GEAR_TAB, cols = gear ? GEAR_COLUMNS : COLUMNS;
    if (!cols.some(c => c.key === state.sort)) state.sort = cols[0].key;
    const ids = WEAPON_IDS.filter(id => state.cat === 'All' || WEAPON_CATEGORY[id] === state.cat);
    const col = cols.find(c => c.key === state.sort);
    const rows = (gear ? gearRows(agg, state.scope, GEAR_IDS) : gunRows(agg, state.scope, ids)).sort((a, b) => {
      const va = a[state.sort], vb = b[state.sort];
      if (va === null && vb === null) return b.kills - a.kills;
      if (va === null) return 1;
      if (vb === null) return -1;
      return col.low ? va - vb : vb - va;
    });
    const empty = agg.matches === 0;
    const scopeEmpty = !empty && agg.pm[state.scope] === 0;
    const first = !menu.el.querySelector('.st-table');
    menu.el.innerHTML = `
      <header class="bar st-bar"${first ? ' data-in="down"' : ''}>
        ${backButton('stBack', 'Done')}
        <h2 class="bar-title">Gun stats</h2>
        <div class="st-segs">${Object.entries(SCOPE_LABEL).map(([s, l]) =>
          `<button class="seg${state.scope === s ? ' on' : ''}" data-act="stScope" data-s="${s}">${ico(SCOPE_ICON[s])}${l}</button>`).join('')}</div>
        <small class="st-count">${ico('timer')}${agg.matches} match${agg.matches === 1 ? '' : 'es'}</small>
      </header>
      <div class="st-cats"${first ? ' data-in="fade"' : ''}>${['All', ...CATEGORIES, GEAR_TAB].map(c =>
        `<button class="seg${state.cat === c ? ' on' : ''}" data-act="stCat" data-c="${c}">${c === 'All' ? '' : c === GEAR_TAB ? ico('frag') : ico(`cat:${c}`)}<b>${c}</b></button>`).join('')}</div>
      <div class="st-table"${first ? ' data-in="up"' : ''}>
        <div class="st-row st-head">
          <span class="st-gun">${gear ? 'Equipment' : 'Gun'}</span>
          ${cols.map(c => `<button class="st-h${state.sort === c.key ? ' on' : ''}" data-act="stSort" data-k="${c.key}">${c.label}${state.sort === c.key ? ico('down', 'st-arrow') : ''}</button>`).join('')}
        </div>
        <div class="st-body scroll-y">
          ${gear && !(empty || scopeEmpty) ? rows.map(r => `
          <div class="st-row">
            <span class="st-gun">${ico(r.id, 'st-ico', 14)}<b>${esc((TACTICALS[r.id] ?? LETHALS[r.id]).name)}</b><small>${TACTICALS[r.id] ? 'Tactical' : 'Lethal'}</small></span>
            ${cols.map(c => `<span class="${state.sort === c.key ? 'on' : ''}">${c.fmt(r)}</span>`).join('')}
          </div>`).join('') : empty || scopeEmpty ? `<div class="st-empty">${ico('stats')}<b>${empty ? 'No matches recorded yet' : `No matches with ${SCOPE_LABEL[state.scope].toLowerCase()} in them yet`}</b><p>${empty ? 'Play a match and every gun used in it shows up here.' : 'Switch to Everyone to see all recorded matches.'}</p></div>` : rows.map(r => `
          <button class="st-row${state.open === r.id ? ' open' : ''}" data-act="stRow" data-id="${r.id}">
            <span class="st-gun">${ico(r.id, 'st-ico', 14)}<b>${esc(WEAPONS[r.id].name)}</b><small>${esc(WEAPON_CATEGORY[r.id])}</small></span>
            ${COLUMNS.map(c => `<span class="${state.sort === c.key ? 'on' : ''}">${c.fmt(r)}</span>`).join('')}
          </button>
          ${state.open === r.id ? `<div class="st-detail">
            <span>Damage per hit by range</span>
            ${DIST_LABELS.map((l, i) => `<em><small>${l} m</small>${r.dmgPerHit[i] === null ? '-' : Math.round(r.dmgPerHit[i])}</em>`).join('')}
            <span>${r.shots} shots, ${r.hits} hits, ${r.deaths} deaths</span>
          </div>` : ''}`).join('')}
        </div>
      </div>
      <footer class="st-foot">
        ${state.code ? `<textarea class="st-code" readonly>${esc(state.code)}</textarea>
          <button class="btn is-primary" data-sound="confirm" data-act="stCopy">${ico('copy')}<b>Copy</b></button>
          <button class="btn" data-act="stHide">${ico('close')}<b>Close</b></button>`
        : `<p>Kills and K/D count gunfire only. TTK runs from the first hit to the kill. Pick is the share of players who used the gun. K/min is per minute held.</p>
          <button class="btn${state.confirm ? ' is-danger' : ''}" data-act="stClear"${empty ? ' disabled' : ''}>${ico('trash')}<b>${state.confirm ? 'Tap again to clear' : 'Clear'}</b></button>
          <button class="btn is-primary" data-sound="confirm" data-act="stExport"${empty ? ' disabled' : ''}>${ico('export')}<b>Export code</b></button>`}
      </footer>`;
    const body = menu.el.querySelector('.st-body');
    if (body) body.scrollTop = state.scroll || 0;
  };
  const keepScroll = () => { state.scroll = menu.el.querySelector('.st-body')?.scrollTop || 0; };

  menu.on({
    stBack: () => onBack(),
    stScope: ({ s }) => { state.scope = s; state.open = null; state.scroll = 0; paint(); },
    stCat: ({ c }) => { state.cat = c; state.open = null; state.scroll = 0; paint(); },
    stSort: ({ k }) => { state.sort = k; state.scroll = 0; paint(); },
    stRow: ({ id }) => { keepScroll(); state.open = state.open === id ? null : id; paint(); },
    stExport: () => { state.code = GunStats.exportCode(); state.confirm = false; paint(); menu.el.querySelector('.st-code')?.select(); },
    stHide: () => { state.code = null; paint(); },
    stCopy: async () => {
      const ta = menu.el.querySelector('.st-code');
      try {
        await navigator.clipboard.writeText(state.code);
        menu.toast?.('Stats code copied');
      } catch {
        // Clipboard refused (no user activation, old Safari): leave it selected for a manual copy.
        ta?.focus(); ta?.select();
        menu.toast?.('Select the code and copy it');
      }
    },
    stClear: () => {
      if (!state.confirm) { state.confirm = true; paint(); return; }
      GunStats.clear(); state.confirm = false; state.open = null; paint();
    },
  });
  paint();
  menu.show();
}
