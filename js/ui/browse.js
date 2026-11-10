// Browse games: public rooms heard on the lobby relays (js/net/lobbies.js), newest first. Joining goes through the same
// join-by-code path as the keypad and invite links. The list repaints when an announcement arrives or a room ages out,
// and once a second for the match clocks; rows are rebuilt only when what they show changed.
import { MAPS } from '../shared/map.js';
import { MODES } from '../shared/modes.js';
import { mapImage, followMapArt } from './mapthumb.js';
import { esc } from './widgets.js';
import { ico, header } from './yard.js';

const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// What a row says about the room, and what its button does. join: 'join' | 'rejoin' | 'open' | null (greyed).
function describe(l, selfId, now) {
  const left = Math.max(0, l.left - (now - l.seen) / 1000);
  const mine = l.held.includes(selfId);
  let phase, tone, join;
  if (l.phase === 'match') {
    if (mine) { phase = 'Your slot is held'; tone = 'go'; join = 'rejoin'; }
    else if (l.open > 0) { phase = l.open > 1 ? `${l.open} open slots` : 'Open slot'; tone = 'go'; join = 'open'; }
    else { phase = 'In match'; tone = 'busy'; join = null; }
  } else if (l.phase === 'voting') {
    phase = 'Map vote'; tone = 'lobby'; join = l.humans < l.slots ? 'join' : null;
  } else {
    phase = 'In lobby'; tone = 'lobby'; join = l.humans < l.slots ? 'join' : null;
  }
  if (!l.compatible) { join = null; tone = 'old'; }
  return { phase, tone, join, left: l.phase === 'match' && left > 0 ? clock(left) : '', full: !join && l.compatible && l.phase !== 'match' };
}

function row(l, selfId, now) {
  const d = describe(l, selfId, now);
  const map = l.map && MAPS[l.map];
  const mode = l.mode && MODES[l.mode];
  const art = map
    ? `<span class="vc-art br-art" data-map="${esc(map.id)}" style="background-image:url(${mapImage(map)})"></span>`
    : `<span class="br-art br-art-vote">${ico('random', '', 26)}</span>`;
  const label = d.join === 'rejoin' ? 'Rejoin' : d.join ? 'Join' : !l.compatible ? 'Update' : d.full ? 'Full' : 'Busy';
  const icon = d.join === 'rejoin' ? 'rejoin' : d.join ? 'join' : !l.compatible ? 'warn' : 'lock';
  return `<div class="br-row cut${d.join ? '' : ' is-off'}${l.compatible ? '' : ' is-old'}" data-code="${esc(l.code)}">
    ${art}
    <span class="br-main">
      <span class="br-top"><b class="br-host t-clip">${esc(l.host)}</b><em class="br-code">${esc(l.code)}</em></span>
      <span class="br-sub">
        ${mode ? `<span class="br-mode">${ico(`mode:${mode.id}`, '', 16)}<b>${esc(mode.short ?? mode.name)}</b></span>` : `<span class="br-mode">${ico('random', '', 16)}<b>Vote</b></span>`}
        <span class="br-map t-clip">${esc(map ? map.name : l.phase === 'voting' ? 'Voting now' : 'Map by vote')}</span>
      </span>
      ${l.compatible ? '' : `<small class="br-ver">Version ${esc(l.v || '?')}: update to play together</small>`}
    </span>
    <span class="br-count">${ico('user', '', 16)}<b>${l.humans}<small>/${l.slots}</small></b></span>
    <span class="br-phase" data-tone="${d.tone}"><i class="lamp"></i><b>${esc(d.phase)}</b>${l.phase === 'match' ? '<small class="br-left"></small>' : ''}</span>
    <button class="btn br-join${d.join ? ' is-primary' : ''}" ${d.join ? `data-act="brJoin" data-code="${esc(l.code)}" data-sound="confirm"` : 'disabled aria-disabled="true"'}>${ico(icon)}<b>${label}</b></button>
  </div>`;
}

function emptyState(state, squad) {
  if (state === 'offline') {
    return `<div class="waiting br-empty is-error">
      <div class="err-mark" data-in="stamp">${ico('warn')}</div>
      <h2 data-in="up">Lobby list offline</h2>
      <p data-in="fade">This phone can't reach the lobby relays right now. Joining with a room code still works, and the list keeps trying.</p>
      <div class="row" data-in="up"><button class="btn is-primary" data-act="brCode" data-sound="confirm">${ico('join')}<b>Enter a code</b></button></div>
    </div>`;
  }
  if (state === 'connecting') {
    return `<div class="waiting br-empty">
      <div class="radar" data-in="scale" aria-hidden="true"><i></i><i></i><i></i>${ico('signal')}</div>
      <h2 data-in="up">Scanning for games</h2>
      <p data-in="fade">Public rooms announce themselves every few seconds.</p>
    </div>`;
  }
  return `<div class="waiting br-empty">
    <div class="radar" data-in="scale" aria-hidden="true"><i></i><i></i><i></i>${ico('signal')}</div>
    <h2 data-in="up">No public games${squad ? ` for ${esc(squad)}` : ''}</h2>
    <p data-in="fade">${squad ? `Only rooms tagged ${esc(squad)} show here. Change the tag in Options.` : 'Rooms show here when their host makes them Public in the lobby.'} Still listening.</p>
    <div class="row" data-in="up">
      <button class="btn" data-act="brCode">${ico('join')}<b>Enter a code</b></button>
      <button class="btn is-primary" data-act="brHost" data-sound="confirm">${ico('host')}<b>Host a room</b></button>
    </div>
  </div>`;
}

// browser: a LobbyBrowser this screen does not own (main.js closes it).
export function browseScreen(menu, { browser, squad = '', selfId = '', onJoin, onCode, onHost, onBack }) {
  menu.el.dataset.screen = 'browse';
  const extra = `<div class="br-tools">
    ${squad ? `<span class="br-squad">${ico('team', '', 16)}<b>${esc(squad)}</b></span>` : ''}
    <span class="br-live"><i class="lamp"></i><b></b></span>
  </div>`;
  menu.el.innerHTML = `${header({ back: 'brBack', title: 'Browse games', extra })}<div class="br-body"></div>`;
  const body = menu.el.querySelector('.br-body');
  const live = menu.el.querySelector('.br-live');
  let shown = '';      // 'list' or the empty state's name: the markup only changes when this does, or a row does.
  const rows = new Map();

  const paint = () => {
    if (!body.isConnected) { stop(); return; }
    const state = browser.state, list = browser.list(), now = Date.now();
    live.dataset.state = state;
    live.querySelector('b').textContent = state === 'offline' ? 'Offline' : state === 'connecting' ? 'Connecting' : `${list.length} ${list.length === 1 ? 'game' : 'games'}`;
    if (!list.length) {
      const key = state === 'live' ? 'empty' : state;
      if (shown !== key) {
        shown = key;
        rows.clear();
        body.innerHTML = emptyState(key, squad);
        menu.stagger(body);
      }
      return;
    }
    if (shown !== 'list') {
      shown = 'list';
      body.innerHTML = '<div class="br-list scroll-y"></div>';
    }
    const host = body.firstElementChild;
    const keep = new Set();
    let prev = null;
    for (const l of list) {
      keep.add(l.code);
      const html = row(l, selfId, now);
      let known = rows.get(l.code);
      if (!known || known.html !== html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        const el = t.content.firstElementChild;
        if (known) known.el.replaceWith(el); else el.classList.add('is-new');
        known = { el, html };
        rows.set(l.code, known);
        followMapArt(el);
      }
      // The match clock ticks in place, so a row (and a finger on its button) is never swapped out just for the time.
      const left = known.el.querySelector('.br-left');
      if (left) { const t = describe(l, selfId, now).left; left.textContent = t ? `${t} left` : ''; }
      // Keep the order: newest room first.
      const want = prev ? prev.nextElementSibling : host.firstElementChild;
      if (want !== known.el) host.insertBefore(known.el, want);
      prev = known.el;
    }
    for (const [code, r] of rows) if (!keep.has(code)) { r.el.remove(); rows.delete(code); }
  };
  const timer = setInterval(paint, 1000);
  const stop = () => { clearInterval(timer); if (browser.onChange === paint) browser.onChange = null; };
  browser.onChange = paint;

  menu.on({
    brBack: () => { stop(); onBack(); },
    brJoin: ({ code }) => { stop(); onJoin(code); },
    brCode: () => { stop(); onCode(); },
    brHost: () => { stop(); onHost(); },
  });
  paint();
  menu.show();
}
