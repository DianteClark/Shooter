// The play screens (docs/ROADMAP.md item 14): Multiplayer (tabs of playlists and modes, then Find match), the
// matchmaking moment, and Custom (Match: the full picker from js/ui/vote.js; Training: the range or a map with bots and
// practice switches). Markup and in-place paints only; js/main.js owns the state and the actions.
//
// Multiplayer actions: mpTab, mpPlaylist, mpMode, mpHardcore (the Hardcore switch in the footer), mpFind, mpBack.
// Custom actions: customTab, customHost, customVote (lobby: back to the map vote), plus the picker's own soloMap/soloMode/
// soloStart/soloBots and Training's trMap, trStep, trSkill, trDrill, trToggle, trStart.
import { MAPS, MAP_IDS, SIZES, SIZE_IDS } from '../shared/map.js';
import { MODES } from '../shared/modes.js';
import { MODS } from '../shared/playlist.js';
import { esc } from './widgets.js';
import { ico, header } from './yard.js';
import { mapCard, tierOf } from './vote.js';
import { MP_TABS, playlistsFor, modesFor, resolveSelection, HARDCORE_TABS } from './matchmaking.js';
import { SKILLS } from './botsettings.js';
import { Progress } from './progress.js';
import { rankBadge } from './season.js';      // Seasons: the Ranked playlist wears the player's rank.

// The Ranked playlist's line: the player's division and SR, or how far through placements they are.
function rankedSub(p) {
  try {
    const rk = Progress.ranked();
    return `<span class="mp-pl-rk">${rankBadge(rk.code, 26)}</span>`
      + `<span class="mp-pl-tx"><b>${esc(p.name)}</b><small>${esc(rk.placed ? `${rk.division.name} · ${rk.sr.toLocaleString('en-US')} SR` : `Placements ${rk.pm}/${rk.placements}`)}<u class="mp-pl-sub2"> · ${esc(p.modes.map(m => MODES[m]?.short ?? m).join(', '))}</u></small></span>`;
  } catch (err) { console.error('ranked', err); return `<span class="mp-pl-tx"><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></span>`; }
}

const tabsNav = (act, tabs, on) => `<nav class="mp-tabs scroll-x">${tabs.map(t => `<button class="seg${t.id === on ? ' on' : ''}${t.soon ? ' soon' : ''}" data-act="${act}" data-tab="${t.id}" data-sound="tab"${t.soon ? ' disabled aria-disabled="true"' : ''}>${ico(t.icon)}<span><b>${esc(t.name)}</b><small>${esc(t.note)}</small></span></button>`).join('')}</nav>`;

/* ---------- Multiplayer ---------- */
// One scroller under the tabs, a fixed foot (what fills the seats, the Hardcore switch, Find match). Standard opens on
// its Spotlight (Ranked, the season's event, today's featured playlist), then the playlists, then the single modes to
// tick. The big-card tabs (Battle Royale, Extraction, Zombies) fit on one screen: their cards in one row, under group
// heads (Battle Royale and Rebound), so a card's title is the playlist's own short name (Quads, Duos) under its family.
const BIG = ['br', 'extraction', 'zombies'];
const TAB_NOTE = {
  standard: 'Bots fill the seats nobody takes. The lobby votes on the map; friends join through a room code.',
  groundwar: '16 a side on the huge maps. Bots fill the seats nobody takes; the lobby votes on the map.',
  br: '32 players a drop. Friends share a squad; bots fill the seats nobody takes.',
  extraction: '16 players on Frontier with your own loadout. Bots fill the squads; AI patrols hold the map.',
  zombies: 'Graveyard Shift: hold off the undead round after round. Start with a pistol; your class stays home.',
};

// The tab's playlists in groups: [{ name, note, items }].
function mpGroups(tab, lists) {
  if (tab === 'standard') {
    const spot = lists.filter(p => p.ranked || p.event || p.featured);
    return [{ id: 'spot', name: 'Spotlight', note: 'Ranked and today\'s featured playlist', items: spot },
      { id: 'pl', name: 'Playlists', note: '6 v 6 and 2 v 2', items: lists.filter(p => !spot.includes(p)) }];
  }
  if (tab === 'br') {
    const rb = lists.filter(p => MODES[p.modes[0]]?.rebound);
    return [{ id: 'br', name: 'Battle Royale', note: 'One life, last squad up', items: lists.filter(p => !rb.includes(p)) },
      { id: 'rb', name: 'Rebound', note: 'Fast, redeploys', items: rb }];
  }
  return [{ id: 'pl', name: 'Playlists', note: '', items: lists }];
}

const EYEBROW = p => (p.ranked ? 'Ranked' : p.event ? 'Limited event' : p.featured ? 'Featured today' : '');

function plCard(p, group, big) {
  // Under a family's head the card drops the family from its title: "Rebound Quads" reads "Quads" under Rebound.
  const title = group && p.name.startsWith(group.name + ' ') ? p.name.slice(group.name.length + 1) : p.name;
  const brow = EYEBROW(p);
  const desc = big ? MODES[p.modes[0]]?.desc : '';
  return `
          <button class="mp-pl${p.featured ? ' feat' : ''}${p.ranked ? ' rk' : ''}${p.event ? ' ev' : ''}${big ? ' big' : ''}" data-act="mpPlaylist" data-id="${p.id}" data-in="up" aria-label="${esc(p.name)}">
            ${brow ? `<span class="mp-brow">${esc(brow)}</span>` : ''}
            ${p.ranked ? rankedSub(p) : `<span class="mp-pl-ico">${ico(p.icon)}</span>
            <span class="mp-pl-tx"><b>${esc(title)}</b><small>${esc(p.sub)}</small>${desc ? `<em>${esc(desc)}</em>` : ''}</span>`}
            <i class="mp-tick">${ico('check')}</i>
          </button>`;
}

const sectionHead = (icon, name, note) => `<h3 class="mp-h">${ico(icon)}<b>${esc(name)}</b>${note ? `<small>${esc(note)}</small>` : ''}</h3>`;

// state: { tab, sel: {playlist, modes} }
export function mpMarkup({ tab }) {
  const lists = playlistsFor(tab), modes = modesFor(tab), big = BIG.includes(tab);
  const groups = mpGroups(tab, lists).filter(g => g.items.length);
  const body = big
    // One row of cards, each group's head spanning its own cards.
    ? `<div class="mp-grid big" style="--n:${lists.length}">
        ${groups.map(g => `<div class="mp-gh" style="grid-column:span ${g.items.length}">${sectionHead(g.items[0].icon, g.name, g.note)}</div>`).join('')}
        ${groups.map(g => g.items.map(p => plCard(p, groups.length > 1 ? g : null, true)).join('')).join('')}
      </div>`
    : groups.map(g => `
      <section class="mp-sec mp-sec-${g.id}">
        ${sectionHead(g.id === 'spot' ? 'star' : 'menu', g.name, g.note)}
        <div class="mp-grid${g.id === 'spot' ? ' spot' : ''}">${g.items.map(p => plCard(p, null, false)).join('')}</div>
      </section>`).join('') + (modes.length ? `
      <section class="mp-sec mp-sec-modes">
        ${sectionHead('mode:dom', 'Modes', 'Tick one or more')}
        <div class="mp-modes">${modes.map(id => `
          <button class="mp-mode" data-act="mpMode" data-id="${id}" data-in="up">${ico(id)}<b>${esc(MODES[id].name.replace('Ground War ', 'GW ')).replace('Headquarters', 'Head&shy;quarters')}</b><i class="mp-tick">${ico('check')}</i></button>`).join('')}
        </div>
      </section>` : '');
  return `
    ${header({ back: 'mpBack', title: 'Multiplayer', cls: 'mp-bar', extra: tabsNav('mpTab', MP_TABS, tab) })}
    <div class="mp${big ? ' mp-big' : ''}" data-tab="${tab}">
      <div class="mp-body${big ? '' : ' scroll-y'}">${body}</div>
      <footer class="mp-foot" data-in="up">
        <p class="mp-note">${ico(tab === 'zombies' ? 'mode:zm' : 'bots')}<span>${esc(TAB_NOTE[tab] ?? TAB_NOTE.standard)}</span></p>
        <button class="mod-row mp-hc" data-act="mpHardcore" data-sound="tab" aria-pressed="false"${HARDCORE_TABS.includes(tab) ? '' : ' disabled'}>
          <span class="mod-ico">${ico('ui:skull')}</span><span class="mod-txt"><b>Hardcore</b><small>${HARDCORE_TABS.includes(tab) ? 'A third of the health, no minimap' : 'Not in this playlist'}</small></span><i class="mod-sw" aria-hidden="true"></i></button>
        <button class="btn is-primary mp-find" data-act="mpFind" data-sound="confirm">${ico('play')}<span><b>Find match</b><small class="mp-pick"></small></span></button>
      </footer>
    </div>`;
}

export function paintMp(root, { tab, sel, hardcore = false }) {
  const r = resolveSelection(tab, sel, { hardcore });
  const hc = root.querySelector('.mp-hc');
  if (hc) { const on = hardcore && HARDCORE_TABS.includes(tab); hc.classList.toggle('on', on); hc.setAttribute('aria-pressed', String(on)); }
  for (const b of root.querySelectorAll('.mp-pl')) b.classList.toggle('on', b.dataset.id === sel.playlist);
  for (const b of root.querySelectorAll('.mp-mode')) b.classList.toggle('on', !sel.playlist && sel.modes.includes(b.dataset.id));
  const find = root.querySelector('.mp-find');
  find.disabled = !r.modes.length;
  root.querySelector('.mp-pick').textContent = r.modes.length ? r.name : 'Pick a playlist or a mode';
}

/* ---------- Matchmaking moment ---------- */
export function searchMarkup({ name, tab, size }) {
  const t = MP_TABS.find(x => x.id === tab);
  return `
    ${header({ back: 'mpCancel', label: 'Cancel', title: 'Finding a match' })}
    <div class="waiting mp-search">
      <div class="radar" data-in="scale" aria-hidden="true"><i></i><i></i><i></i>${ico('signal')}</div>
      <h2 data-in="up">${esc(name)}</h2>
      <p class="mp-search-line" data-in="fade">${esc(t?.name ?? '')}: searching for ${size} players</p>
      <p class="mp-search-n" data-in="fade"><b class="mp-found">1</b> / ${size}</p>
    </div>`;
}

/* ---------- Custom ---------- */
export const CUSTOM_TABS = [
  { id: 'match', name: 'Match', note: 'Your rules', icon: 'options' },
  { id: 'training', name: 'Training', note: 'No progress', icon: 'range' },
];

// The Custom header: tabs, then Host room (from the title) or Map vote (editing a friend lobby's custom settings).
export function customHead(tab, { lobby = false } = {}) {
  const extra = tabsNav('customTab', lobby ? CUSTOM_TABS.slice(0, 1) : CUSTOM_TABS, tab)
    + (tab !== 'match' ? '' : lobby
      ? `<button class="btn cu-side" data-act="customVote">${ico('map')}<b>Use map vote</b></button>`
      : `<button class="btn cu-side" data-act="customHost">${ico('host')}<b>Host room</b></button>`);
  return header({ back: 'customBack', label: lobby ? 'Lobby' : 'Back', title: 'Custom', cls: 'mp-bar', extra });
}

/* ---------- Training ---------- */
const DRILLS = [['normal', 'Normal'], ['standing', 'Standing'], ['strafing', 'Strafing'], ['rushing', 'Rushing']];
export const TRAIN_MAX_BOTS = 12;
const KEY = 'switchyard-training';
const DEFAULTS = { map: 'range', bots: 4, skill: 'regular', behaviour: 'normal', ammo: true, noDeath: true };

export function loadTraining() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null') ?? {};
    return {
      map: v.map === 'range' || (MAPS[v.map] && MAP_IDS.includes(v.map)) ? v.map : DEFAULTS.map,
      bots: Number.isFinite(v.bots) ? Math.max(1, Math.min(TRAIN_MAX_BOTS, Math.round(v.bots))) : DEFAULTS.bots,
      skill: SKILLS.some(s => s[0] === v.skill) ? v.skill : DEFAULTS.skill,
      behaviour: DRILLS.some(d => d[0] === v.behaviour) ? v.behaviour : DEFAULTS.behaviour,
      ammo: typeof v.ammo === 'boolean' ? v.ammo : DEFAULTS.ammo,
      noDeath: typeof v.noDeath === 'boolean' ? v.noDeath : DEFAULTS.noDeath,
    };
  } catch { return { ...DEFAULTS }; }
}
export function saveTraining(t) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* private mode: this session only */ }
}

const toggle = (key, name, sub) => `<button class="mod-row trn-tog" data-act="trToggle" data-key="${key}" data-sound="tab">
  <span class="mod-ico">${ico(key === 'ammo' ? 'reload' : 'ui:skull')}</span><span class="mod-txt"><b>${name}</b><small>${sub}</small></span><i class="mod-sw"></i></button>`;

export function trainingMarkup(t) {
  const sections = SIZE_IDS.map(s => ({ s, ids: MAP_IDS.filter(id => tierOf(id) === s) })).filter(x => x.ids.length);
  return `
    ${customHead('training')}
    <div class="trn">
      <div class="solo-maps trn-maps">
        <button class="solo-map trn-rangecard" data-act="trMap" data-id="range" data-in="up">
          <span class="vc-art trn-rangecard-art" aria-hidden="true"></span>
          <span class="vc-shade"></span>
          <span class="sm-tick">${ico('check')}</span>
          <span class="sm-name">${ico('range')}<b>Range</b></span>
          <small class="sm-sub">Firing range: targets at marked distances</small>
        </button>
        <div class="solo-scroll scroll-y">${sections.map(({ s, ids }) => `
          <section class="solo-sec tier-${s}">
            <h3 class="solo-h">${ico(s === 'huge' ? 'party' : 'map')}<b>${SIZES[s].label}</b><small>${s === 'huge' ? 'Ground War maps' : SIZES[s].note}</small><i>${ids.length}</i></h3>
            <div class="solo-grid">${ids.map(id => mapCard(id, 'trMap')).join('')}</div>
          </section>`).join('')}
        </div>
      </div>
      <div class="trn-set" data-in="left">
        <div class="bm-row trn-bots" data-row="bots">
          <span class="bm-lb"><b>Bots</b><small>All on the other side</small></span>
          <span class="bm-step">
            <button class="bm-btn" data-act="trStep" data-dir="-1" aria-label="Fewer">${ico('minus')}</button>
            <output class="bm-val trn-n"></output>
            <button class="bm-btn" data-act="trStep" data-dir="1" aria-label="More">${ico('plus')}</button>
          </span>
        </div>
        <div class="trn-segs trn-skill"><span>Difficulty</span>${SKILLS.map(([id, name]) => `<button class="bm-seg" data-act="trSkill" data-id="${id}" data-sound="tab">${name}</button>`).join('')}</div>
        <div class="trn-segs trn-drill"><span>Bots do</span>${DRILLS.map(([id, name]) => `<button class="bm-seg" data-act="trDrill" data-id="${id}" data-sound="tab">${name}</button>`).join('')}</div>
        <div class="trn-togs">${toggle('ammo', 'Infinite ammo', 'Mags refill')}${toggle('noDeath', 'No death', 'Up again in place')}</div>
        <p class="trn-note">${ico('stats')}<span>Live damage and time-to-kill readout. Armory in the match: any gun you own, on at once.</span></p>
        <button class="btn is-primary trn-start" data-act="trStart" data-sound="confirm">${ico('play')}<span><b>Start training</b><small class="trn-line"></small></span></button>
      </div>
    </div>`;
}

export function paintTraining(root, t) {
  const range = t.map === 'range';
  for (const b of root.querySelectorAll('[data-act="trMap"]')) b.classList.toggle('on', b.dataset.id === t.map);
  root.querySelector('.trn-n').textContent = range ? '--' : String(t.bots);
  const [down, up] = root.querySelectorAll('[data-act="trStep"]');
  down.disabled = range || t.bots <= 1; up.disabled = range || t.bots >= TRAIN_MAX_BOTS;
  for (const b of root.querySelectorAll('[data-act="trSkill"]')) { b.classList.toggle('on', b.dataset.id === t.skill); b.disabled = range; }
  for (const b of root.querySelectorAll('[data-act="trDrill"]')) { b.classList.toggle('on', b.dataset.id === t.behaviour); b.disabled = range; }
  for (const b of root.querySelectorAll('[data-act="trToggle"]')) {
    const fixed = range;            // The range always refills and its targets never shoot back.
    b.classList.toggle('on', fixed || !!t[b.dataset.key]);
    b.disabled = fixed;
  }
  root.querySelector('.trn-set').classList.toggle('is-range', range);
  root.querySelector('.trn-line').textContent = range
    ? 'Firing range. No XP or stats.'
    : `${MAPS[t.map]?.name ?? ''}, ${t.bots} bot${t.bots === 1 ? '' : 's'}. No XP or stats.`;
}

/* ---------- Friend lobby: the custom settings plate ---------- */
// custom: { mapId, mode, mods, skill, bots, scoreLimit, timeLimit } or null (the room plays the map vote).
export function customLine(custom) {
  if (!custom) return 'Map vote';
  const mode = custom.mode === 'random' ? 'Any mode' : MODES[custom.mode]?.name ?? '';
  const map = custom.mapId === 'random' ? 'any map' : MAPS[custom.mapId]?.name ?? '';
  const mods = (custom.mods ?? []).map(id => MODS[id]?.short).filter(Boolean).join(' ');
  const skill = SKILLS.find(s => s[0] === custom.skill)?.[1] ?? '';
  return `${mods ? mods + ' ' : ''}${mode} on ${map} · ${skill}`;
}
