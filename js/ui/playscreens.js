// The play screens (docs/ROADMAP.md item 14): Multiplayer (tabs of playlists and modes, then Find match), the
// matchmaking moment, and Custom (Match: the full picker from js/ui/vote.js; Training: the range or a map with bots and
// practice switches). Markup and in-place paints only; js/main.js owns the state and the actions.
//
// Multiplayer actions: mpTab, mpPlaylist, mpMode, mpFind, mpBack.
// Custom actions: customTab, customHost, customVote (lobby: back to the map vote), plus the picker's own soloMap/soloMode/
// soloStart/soloBots and Training's trMap, trStep, trSkill, trDrill, trToggle, trStart.
import { MAPS, MAP_IDS, SIZES, SIZE_IDS } from '../shared/map.js';
import { MODES } from '../shared/modes.js';
import { MODS } from '../shared/playlist.js';
import { esc } from './widgets.js';
import { ico, header } from './yard.js';
import { mapCard, tierOf } from './vote.js';
import { MP_TABS, playlistsFor, modesFor, resolveSelection } from './matchmaking.js';
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

const tabsNav = (act, tabs, on) => `<nav class="mp-tabs">${tabs.map(t => `<button class="seg${t.id === on ? ' on' : ''}${t.soon ? ' soon' : ''}" data-act="${act}" data-tab="${t.id}" data-sound="tab"${t.soon ? ' disabled aria-disabled="true"' : ''}>${ico(t.icon)}<span><b>${esc(t.name)}</b><small>${esc(t.note)}</small></span></button>`).join('')}</nav>`;

/* ---------- Multiplayer ---------- */
// state: { tab, sel: {playlist, modes} }
export function mpMarkup({ tab }) {
  const lists = playlistsFor(tab), modes = modesFor(tab), br = tab === 'br';
  return `
    ${header({ back: 'mpBack', title: 'Multiplayer', cls: 'mp-bar', extra: tabsNav('mpTab', MP_TABS, tab) })}
    <div class="mp${br ? ' mp-br' : ''}" data-tab="${tab}">
      <section class="mp-lists">
        <h3 class="mp-h">${ico('menu')}<b>Playlists</b></h3>
        <div class="mp-pls">${lists.map(p => `
          <button class="mp-pl${p.featured ? ' feat' : ''}${p.ranked ? ' rk' : ''}${p.event ? ' ev' : ''}" data-act="mpPlaylist" data-id="${p.id}" data-in="up">
            ${p.ranked ? rankedSub(p) : `<span class="mp-pl-ico">${ico(p.icon)}</span>
            <span class="mp-pl-tx"><b>${esc(p.name)}</b><small>${esc(p.sub)}</small>${br ? `<em>${esc(MODES[p.modes[0]].desc)}</em>` : ''}</span>`}
            <i class="mp-tick">${ico('check')}</i>
          </button>`).join('')}
        </div>
      </section>
      ${modes.length ? `<section class="mp-modes-col">
        <h3 class="mp-h">${ico('mode:dom')}<b>Modes</b><small>Tick one or more</small></h3>
        <div class="mp-modes">${modes.map(id => `
          <button class="mp-mode" data-act="mpMode" data-id="${id}" data-in="up">${ico(id)}<b>${esc(MODES[id].name.replace('Ground War ', 'GW ')).replace('Headquarters', 'Head&shy;quarters')}</b><i class="mp-tick">${ico('check')}</i></button>`).join('')}
        </div>
      </section>` : ''}
      <footer class="mp-foot" data-in="up">
        <p class="mp-note">${ico('bots')}<span>${br ? '32 players a drop. Bots fill the seats nobody takes.' : 'Bots fill the seats nobody takes. The lobby votes on the map.'}</span></p>
        <button class="btn is-primary mp-find" data-act="mpFind" data-sound="confirm">${ico('play')}<span><b>Find match</b><small class="mp-pick"></small></span></button>
      </footer>
    </div>`;
}

export function paintMp(root, { tab, sel }) {
  const r = resolveSelection(tab, sel);
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
