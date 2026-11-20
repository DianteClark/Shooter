// Match history: the last matches (js/ui/progress.js MatchHistory, written by MatchAwards), a list on the left and the
// picked match's summary on the right. Tapping a match opens its detail (matchDetail below): the map with your kill and
// death spots, the guns of that match from its gun stats record (js/game/telemetry.js GunStats.match), medals, streaks,
// challenge progress and the mode's own numbers. Only the newest HISTORY_DETAIL matches keep their detail.
// Mount like the stats screen: historyScreen(menu, { onBack, onStats }). The title reaches the gun stats screen through
// here (its Gun stats button).
import { MAPS } from '../shared/map.js';
import { MODES, BR, CONTRACT_NAMES, isFfa, modeRules } from '../shared/modes.js';
import { WEAPONS } from '../shared/weapons.js';
import { STREAKS } from '../shared/catalog.js';
import { getChallenge, HISTORY_DETAIL } from '../shared/progression.js';
import { MatchHistory } from './progress.js';
import { GunStats, matchGunRows } from '../game/telemetry.js';
import { matchHeader } from './outcome.js';
import { medalTitle } from './hud.js';
import { mapThumbnail } from '../render/world.js';
import { mapImage } from './mapthumb.js';
import { esc } from './widgets.js';
import { icon } from './icons.js';
import { ico, header } from './yard.js';
import { listClips, deleteClip, MAX_CLIPS } from './clips.js';
import { pasteSheet } from './replaycode.js';     // Replay codes: watch one a friend shared (docs/REPLAYS.md).      // Saved replay clips (docs/REPLAYS.md).

const RESULT = { win: 'Victory', loss: 'Defeat', draw: 'Draw' };
const ord = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Just now", "25 min ago", "3 h ago", "Yesterday", "Nov 3".
export function whenText(at, now = Date.now()) {
  const m = Math.floor((now - at) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const d = new Date(at), today = new Date(now);
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days === 0) return `${Math.floor(m / 60)} h ago`;
  if (days === 1) return 'Yesterday';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const clock = at => { const d = new Date(at); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const mapName = id => MAPS[id]?.name ?? id;
const modeOf = id => MODES[id] ?? { id, name: id, short: String(id).toUpperCase() };
// What the result column says: placing in a free-for-all, the outcome otherwise.
const resultText = e => (e.place ? `${ord(e.place)} of ${e.field}` : RESULT[e.result]);
const kd = e => (e.deaths ? (e.kills / e.deaths).toFixed(2) : e.kills.toFixed(2));

function row(e, i, open) {
  const m = modeOf(e.mode);
  return `<button class="hs-row${open ? ' open' : ''}" data-act="hsRow" data-i="${i}" data-result="${e.result}">
    <i class="hs-lamp"></i>
    <span class="hs-mode">${icon(`mode:${m.id}`, { size: 18 })}</span>
    <span class="hs-where"><b>${esc(mapName(e.map))}</b><small>${esc(m.short)} · ${esc(whenText(e.at))}</small></span>
    <span class="hs-res">${esc(resultText(e))}</span>
    <span class="hs-kda t-num">${e.kills}<i>/</i>${e.deaths}<i>/</i>${e.assists}</span>
    <span class="hs-score t-num">${e.score.toLocaleString('en-US')}</span>
    <span class="hs-xp t-num">+${e.xp.toLocaleString('en-US')}</span>
  </button>`;
}

function detail(e) {
  if (!e) return '';
  const m = modeOf(e.mode), map = MAPS[e.map];
  const art = map ? mapImage(map) : '';
  const stat = (label, value) => `<span class="hd-stat"><b class="t-num">${value}</b><small>${label}</small></span>`;
  const team = e.place ? `<span class="hd-sc">${ord(e.place)}<small>of ${e.field}</small></span>`
    : `<span class="hd-sc"><u class="us">${e.scores[0]}</u><i></i><u class="them">${e.scores[1]}</u></span>`;
  return `<div class="hd" data-result="${e.result}">
    <div class="hd-art"${art ? ` style="background-image:url('${art}')"` : ''}>
      <span class="hd-tag">${icon(`mode:${m.id}`, { size: 14 })}${esc(m.name)}</span>
      <h3>${esc(RESULT[e.result])}</h3>
      ${team}
      <small class="hd-when">${esc(mapName(e.map))} · ${esc(clock(e.at))}${e.secs ? ` · ${mmss(e.secs)}` : ''}</small>
    </div>
    <div class="hd-stats">
      ${stat('Kills', e.kills)}${stat('Deaths', e.deaths)}${stat('Assists', e.assists)}${stat('K/D', kd(e))}
      ${stat('Score', e.score.toLocaleString('en-US'))}${stat('Headshots', e.head)}${stat(e.obj ? 'Objective' : 'Longshots', e.obj || e.long)}${stat('Medals', e.medals)}
    </div>
    <div class="hd-guns scroll-y">
      <small class="hd-h">Guns used</small>
      ${e.guns.length ? e.guns.map(g => `<span class="hd-gun">${icon(g.id, { size: 13 })}<b>${esc(WEAPONS[g.id]?.name ?? g.id)}</b><small>${g.kills} ${g.kills === 1 ? 'kill' : 'kills'}${g.secs ? ` · ${mmss(g.secs)}` : ''}</small></span>`).join('')
        : '<span class="hd-none">No gun held long enough to count</span>'}
    </div>
    <div class="hd-foot">
      <span class="hd-xp">+${e.xp.toLocaleString('en-US')} XP${e.levelUp ? `<em>Level ${e.level}</em>` : ''}</span>
      ${e.challenges.length ? `<span class="hd-ch">${ico('ui:flag')}${e.challenges.length} challenge${e.challenges.length > 1 ? 's' : ''}: ${e.challenges.map(c => esc(getChallenge(c.id)?.label ?? '')).join(', ')}</span>` : ''}
      <span class="hd-who">${e.humans > 1 ? `${e.humans} players, ` : ''}${e.bots} bots</span>
    </div>
    <button class="btn hd-open" data-act="hsOpen">${ico('stats')}<b>Match details</b></button>
  </div>`;
}

/* ---------- The match detail ---------- */

// The results header (js/ui/outcome.js matchHeader) from what the history kept: a stand-in of the end-of-match data.
function headerOf(e) {
  const d = e.d ?? {}, rules = modeRules(e.mode);
  const data = { modeId: e.mode, outcome: e.result, localId: 'me', myTeam: 0, scores: [], roster: [] };
  if (isFfa(e.mode)) {
    // Places 1..field: as many ahead of you as your place says (the best of them on the best other score).
    const place = e.place || 1, field = Math.max(e.field, place);
    data.roster.push({ id: 'me', team: 0, kills: 0, deaths: 0 });
    data.scores[0] = e.scores[0];
    for (let t = 1; t < field; t++) {
      const ahead = t < place;
      data.roster.push({ id: `p${t}`, team: t, kills: 0, deaths: ahead ? -1 : 1e6 });
      data.scores[t] = t === 1 ? e.scores[1] : ahead ? e.scores[0] : -1;
    }
  } else if (rules === 'br') {
    const of = Math.max(1, d.br?.of || e.field || 1);
    data.roster = Array.from({ length: of }, (_, t) => ({ id: t ? `p${t}` : 'me', team: t, place: t ? 0 : d.br?.place || e.place || of }));
  } else if (rules === 'ex') {
    data.ex = { extracted: d.ex ? d.ex.out : e.result === 'win', banked: (d.ex?.c ?? []).map(([type, tier]) => ({ type, tier })), lost: Array(d.ex?.lost ?? 0).fill(null), lives: d.ex?.lives ?? 0 };
  } else if (rules === 'zm') {
    data.zm = { survived: d.zm?.survived ?? 0, escaped: d.zm?.escaped ?? 0, fresh: !!d.zm?.fresh, warden: !!d.zm?.warden };
    data.zmView = { round: d.zm?.round ?? 0, escaped: [] };
  } else {
    const t = e.team === 1 ? 1 : 0;
    data.myTeam = t;
    data.scores[t] = e.scores[0];
    data.scores[1 - t] = e.scores[1];
  }
  try { return matchHeader(data); } catch { return { word: RESULT[e.result], line: '', tone: 'var(--c-sodium)', score: { kind: 'none' } }; }
}

// The map's top-down art without spawns, made once per map (js/render/world.js mapThumbnail: metres scale linearly).
const plans = new Map();
function planOf(map) {
  if (!plans.has(map.id)) {
    let url = '';
    try { url = mapThumbnail(map, { width: 480, spawns: false }).toDataURL('image/png'); } catch { /* no canvas: the spots alone */ }
    plans.set(map.id, url);
  }
  return plans.get(map.id);
}

// Kill spots (where your victims fell), death spots (where you fell) and a short line from where the killer stood.
function spotsSvg(map, d) {
  const W = map.width, H = map.height, r = Math.max(W, H) / 70;
  const deaths = (d?.x ?? []).map(([x, z, kx, kz]) => `<g class="hm-death">${kx !== undefined ? `<line x1="${kx}" y1="${kz}" x2="${x}" y2="${z}"/><circle class="hm-from" cx="${kx}" cy="${kz}" r="${r * 0.45}"/>` : ''}
    <path d="M${x - r} ${z - r}L${x + r} ${z + r}M${x + r} ${z - r}L${x - r} ${z + r}"/><path class="c" d="M${x - r} ${z - r}L${x + r} ${z + r}M${x + r} ${z - r}L${x - r} ${z + r}"/></g>`).join('');
  const kills = (d?.k ?? []).map(([x, z]) => `<circle class="hm-kill" cx="${x}" cy="${z}" r="${r * 0.9}"/>`).join('');
  return `<svg class="hm-spots" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${deaths}${kills}</svg>`;
}

const pct = v => (v === null ? '-' : `${Math.round(v * 100)}%`);
const gunName = id => esc(WEAPONS[id]?.name ?? id);

// The guns of the match: from its gun stats record while that is kept, else the history's own short list.
function gunsPane(e) {
  const rec = GunStats.match(e.d?.gs);
  const rows = rec ? matchGunRows(rec) : [];
  if (rows.length) {
    return `<table class="hm-guns"><thead><tr><th>Gun</th><th>Kills</th><th>Deaths</th><th>Dmg</th><th title="Accuracy">Acc</th><th title="Headshot kills">HS%</th><th>Held</th></tr></thead>
      <tbody>${rows.map(g => `<tr><td><span>${icon(g.id, { size: 12 })}<b>${gunName(g.id)}</b></span></td><td>${g.kills}</td><td>${g.deaths}</td><td>${g.dmg.toLocaleString('en-US')}</td><td>${pct(g.acc)}</td><td>${pct(g.head)}</td><td>${mmss(Math.round(g.held))}</td></tr>`).join('')}</tbody></table>`;
  }
  if (!e.guns.length) return '<p class="hm-none">No gun held long enough to count.</p>';
  return `<table class="hm-guns"><thead><tr><th>Gun</th><th>Kills</th><th title="Headshot kills">HS%</th><th>Held</th></tr></thead>
    <tbody>${e.guns.map(g => `<tr><td><span>${icon(g.id, { size: 12 })}<b>${gunName(g.id)}</b></span></td><td>${g.kills}</td><td>${g.kills ? pct(g.head / g.kills) : '-'}</td><td>${mmss(g.secs)}</td></tr>`).join('')}</tbody></table>
    <p class="hm-none">Damage and accuracy are kept for your last 40 matches with gunfire.</p>`;
}

function awardsPane(d) {
  const medals = Object.entries(d.md ?? {}).sort((a, b) => b[1] - a[1]);
  const named = medals.map(([id, n]) => `<span class="hm-chip">${icon(`medal:${id}`, { size: 16 })}<b>${esc(medalTitle(id) ?? id)}</b>${n > 1 ? `<small>x${n}</small>` : ''}</span>`).join('');
  const streaks = (d.sk ?? []).map(k => `<span class="hm-chip is-streak">${icon(k, { size: 16 })}<b>${esc(STREAKS[k]?.name ?? k)}</b></span>`).join('');
  return `<small class="hd-h">Medals</small><div class="hm-chips">${named || '<span class="hm-none">No medals this match</span>'}</div>
    <small class="hd-h">Streaks called</small><div class="hm-chips">${streaks || '<span class="hm-none">No streaks called</span>'}</div>`;
}

function challengesPane(d) {
  const rows = (d.ch ?? []).map(([id, before, after]) => {
    const c = getChallenge(id);
    if (!c) return '';
    const done = after >= c.goal;
    return `<div class="hm-ch${done ? ' done' : ''}"><b>${esc(c.label)}</b><small class="t-num">${done ? 'Done' : `${after}/${c.goal}`} <i>+${after - before}</i></small>
      <span class="hm-bar"><i style="width:${Math.min(100, before / c.goal * 100)}%"></i><u style="width:${Math.min(100, (after - before) / c.goal * 100)}%"></u></span></div>`;
  }).join('');
  return rows || '<p class="hm-none">No challenge moved this match.</p>';
}

const fact = (label, value, cls = '') => `<span class="hm-fact${cls ? ' ' + cls : ''}"><b class="t-num">${value}</b><small>${label}</small></span>`;

// The mode's own numbers: [tab label, pane html], or null for a mode without any.
function extrasOf(e) {
  const d = e.d ?? {};
  if (d.br) {
    const b = d.br, solo = MODES[e.mode]?.squad === 1;
    return ['Placement', `<div class="hm-facts">${fact(`of ${b.of} ${solo ? 'players' : 'squads'}`, `#${b.place || '-'}`, 'big')}${fact('Damage', b.dmg.toLocaleString('en-US'))}${fact('Knocks', b.knocks)}${fact('Revives', b.rev)}</div>
      <small class="hd-h">Loot</small><div class="hm-facts">${fact('Guns picked up', b.guns)}${fact('Best gun', b.guns ? `<em style="color:${BR.rarityCss[b.rar] ?? 'inherit'}">${BR.rarityName[b.rar] ?? '-'}</em>` : '-')}${fact('Items picked up', b.items)}</div>`];
  }
  if (d.ex) {
    const x = d.ex;
    const list = x.c.map(([type, tier]) => `<span class="hm-chip">${ico('ui:flag')}<b>${esc(CONTRACT_NAMES[type] ?? 'Contract')}</b><small>Tier ${tier}</small></span>`).join('');
    return ['Contracts', `<div class="hm-facts">${fact('Extraction', x.out ? 'Out' : 'Not out', 'big')}${fact('Contracts banked', x.c.length)}${fact('Contracts lost', x.lost)}${fact('Lives left', x.lives)}</div>
      <small class="hd-h">Banked</small><div class="hm-chips">${list || '<span class="hm-none">None banked</span>'}</div>`];
  }
  if (d.zm) {
    const z = d.zm;
    return ['Rounds', `<div class="hm-facts">${fact('Round reached', z.round, 'big')}${fact('Rounds survived', z.survived)}${fact('Escape', z.escaped ? `Round ${z.escaped}` : 'No')}${fact({ radio: 'Listener', lantern: 'Barker' }[MAPS[e.map]?.zm?.quest?.kind] ?? 'Gravewarden', z.warden ? 'Down' : 'Standing')}</div>
      ${z.fresh ? '<p class="hm-note">A new best round on this map.</p>' : ''}`];
  }
  if (d.sd) {
    const won = [...d.sd].filter(c => c === 'w').length, lost = [...d.sd].filter(c => c === 'l').length;
    return ['Rounds', `<div class="hm-facts">${fact('Rounds won', won, 'big')}${fact('Rounds lost', lost)}${fact('Rounds played', d.sd.length)}</div>
      <small class="hd-h">Round by round</small><div class="hm-rounds">${[...d.sd].map((c, i) => `<span class="r-${c}"><small>${i + 1}</small><b>${{ w: 'Won', l: 'Lost', d: 'Draw' }[c]}</b></span>`).join('')}</div>`];
  }
  return null;
}

function heroHtml(e) {
  const m = modeOf(e.mode), h = headerOf(e), s = h.score;
  const score = s.kind === 'pair' ? `<span class="hm-sc"><u style="color:${s.mineCss ?? 'var(--c-blue)'}">${s.mine}</u><i></i><u style="color:${s.themCss ?? 'var(--c-red)'}">${s.them}</u></span>`
    : s.kind === 'one' ? `<span class="hm-sc"><u style="color:${s.mineCss ?? 'inherit'}">${esc(String(s.value))}</u><small>${esc(s.label)}</small></span>` : '';
  return `<div class="hm-hero" data-result="${e.result}" style="--tone:${h.tone}">
    <span class="hd-tag">${icon(`mode:${m.id}`, { size: 14 })}${esc(m.name)}</span>
    <h3>${esc(h.word)}</h3>${score}
    <small class="hm-line">${esc(h.line)}</small>
    <small class="hm-meta">${esc(mapName(e.map))} · ${esc(clock(e.at))}${e.secs ? ` · ${mmss(e.secs)}` : ''} · <b>+${e.xp.toLocaleString('en-US')} XP</b></small>
  </div>`;
}

// The detail of list[i]. back(i) returns to the list with that match picked.
function matchDetail(menu, list, i, back) {
  const e = list[i], d = e.d ?? null, map = MAPS[e.map];
  const extras = d ? extrasOf(e) : null;
  const tabs = [['guns', 'Guns'], ...(extras ? [['mode', extras[0]]] : []), ...(d ? [['awards', 'Medals'], ['ch', 'Challenges']] : [])];
  let tab = 'guns';
  const pane = () => (tab === 'guns' ? gunsPane(e) : tab === 'mode' ? extras[1] : tab === 'awards' ? awardsPane(d) : challengesPane(d));
  const nk = d?.k?.length ?? 0, nx = d?.x?.length ?? 0;
  menu.el.dataset.screen = 'historyMatch';
  menu.el.innerHTML = `
    ${header({ back: 'hmBack', label: 'History', title: 'Match details', cls: 'hs-bar', extra: `<span class="hm-step">
      <button class="btn" data-act="hmStep" data-d="-1"${i > 0 ? '' : ' disabled'} aria-label="Newer match">${ico('ui:back')}<b>Newer</b></button>
      <button class="btn" data-act="hmStep" data-d="1"${i < list.length - 1 ? '' : ' disabled'} aria-label="Older match"><b>Older</b>${ico('ui:next')}</button></span>` })}
    <div class="hm" data-result="${e.result}">
      <div class="hm-mapcol" data-in="up">
        <div class="hm-map"${map ? ` style="--ar:${map.width / map.height}"` : ''}>
          ${map ? `<img src="${planOf(map)}" alt="">${spotsSvg(map, d)}` : ''}
          ${d ? '' : `<p class="hm-old">Map spots are kept for your last ${HISTORY_DETAIL} matches</p>`}
        </div>
        ${d ? `<div class="hm-key"><span><i class="k"></i>Kills ${nk}</span><span><i class="x"></i>Deaths ${nx}</span><span><i class="l"></i>Killed from</span></div>` : ''}
      </div>
      <div class="hm-side" data-in="right">
        ${heroHtml(e)}
        <nav class="hm-tabs">${tabs.map(([id, label]) => `<button class="seg${id === tab ? ' on' : ''}" data-act="hmTab" data-tab="${id}" data-sound="tab"><b>${esc(label)}</b></button>`).join('')}</nav>
        <div class="hm-pane scroll-y" data-tab-pane="${tab}">${pane()}</div>
      </div>
    </div>`;
  fitMap(menu.el);
  menu.on({
    hmBack: () => back(i),
    hmStep: ({ d: step }) => { const n = i + Number(step); if (list[n]) matchDetail(menu, list, n, back); },
    hmTab: ({ tab: t }) => {
      if (t === tab) return;
      tab = t;
      for (const b of menu.el.querySelectorAll('.hm-tabs .seg')) b.classList.toggle('on', b.dataset.tab === tab);
      const el = menu.el.querySelector('.hm-pane');
      el.dataset.tabPane = tab;
      el.innerHTML = pane();
      el.scrollTop = 0;
    },
  });
  menu.show();
}

// The map keeps its own proportions inside its column (the spots are drawn in metres over it).
function fitMap(root) {
  const col = root.querySelector('.hm-mapcol'), box = root.querySelector('.hm-map');
  if (!col || !box) return;
  const fit = () => {
    if (!box.isConnected) return ro?.disconnect();
    const ar = Number(box.style.getPropertyValue('--ar')) || 1;
    const key = root.querySelector('.hm-key');
    const w = col.clientWidth, h = col.clientHeight - (key?.offsetHeight ?? 0) - 6;
    if (w <= 0 || h <= 0) return;
    const bw = Math.min(w, h * ar);
    box.style.width = `${Math.floor(bw)}px`;
    box.style.height = `${Math.floor(bw / ar)}px`;
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(col);
  fit();
}

// The two tabs: the matches, and the saved replay clips.
const tabsHtml = tab => `<nav class="hs-tabs">${[['matches', 'Matches', 'ui:clock'], ['clips', 'Clips', 'ui:play']].map(([id, label, i]) =>
  `<button class="seg${id === tab ? ' on' : ''}" data-act="hsTab" data-tab="${id}" data-sound="tab">${ico(i)}<b>${label}</b></button>`).join('')}</nav>`;

export function historyScreen(menu, { onBack, onStats, open: start = 0, tab = 'matches', onWatch = null, onWatchCode = null }) {
  if (tab === 'clips') { clipsScreen(menu, { onBack, onStats, onWatch, onWatchCode }); return; }
  const list = MatchHistory.list();
  let open = list[start] ? start : 0;
  const detailOf = n => matchDetail(menu, list, n, i => {
    historyScreen(menu, { onBack, onStats, open: i, onWatch, onWatchCode });
    const row = menu.el.querySelector(`.hs-body .hs-row[data-i="${i}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  });
  menu.el.dataset.screen = 'history';
  const wins = list.filter(e => e.result === 'win').length;
  menu.el.innerHTML = `
    ${header({ back: 'hsBack', label: 'Done', title: 'Match history', cls: 'hs-bar', extra: `${tabsHtml('matches')}${list.length ? `<small class="hs-count">${ico('timer')}Last ${list.length} match${list.length === 1 ? '' : 'es'} · ${wins} won</small>` : ''}${onStats ? `<button class="btn hs-stats" data-act="hsStats">${ico('stats')}<b>Gun stats</b></button>` : ''}` })}
    ${list.length ? `<div class="hs-split">
      <div class="hs-list" data-in="up">
        <div class="hs-row hs-head"><i></i><span></span><span class="hs-where">Match</span><span class="hs-res">Result</span><span class="hs-kda">K/D/A</span><span class="hs-score">Score</span><span class="hs-xp">XP</span></div>
        <div class="hs-body scroll-y">${list.map((e, i) => row(e, i, i === open)).join('')}</div>
      </div>
      <div class="hs-detail" data-in="right">${detail(list[open])}</div>
    </div>` : `<div class="hs-empty" data-in="up">${ico('ui:clock')}<b>No matches yet</b><p>Every match you finish, against bots or friends, lands here with how it went.</p></div>`}`;
  menu.on({
    hsBack: () => onBack(),
    hsStats: () => onStats?.(),
    hsOpen: () => detailOf(open),
    hsTab: ({ tab: t }) => { if (t === 'clips') clipsScreen(menu, { onBack, onStats, onWatch, onWatchCode }); },
    // Tapping a match opens its detail; the summary beside the list follows the last one looked at.
    hsRow: ({ i }) => {
      const n = Number(i);
      if (list[n]) detailOf(n);
    },
  });
  menu.show();
}

/* ---------- Clips ---------- */

const clipRow = (c, i) => {
  const m = modeOf(c.mode);
  return `<div class="hc-row" data-i="${i}" style="--i:${i}">
    <span class="hs-mode">${icon(`mode:${m.id}`, { size: 18 })}</span>
    <span class="hs-where"><b>${esc(mapName(c.mapId))}</b><small>${esc(m.name)} · ${esc(clock(c.at))}</small></span>
    <span class="hc-len t-num">${mmss(Math.round(c.dur ?? 0))}${c.kills ? `<small>${c.kills} ${c.kills === 1 ? 'kill' : 'kills'}</small>` : ''}</span>
    <button class="btn hc-watch" data-act="hcWatch" data-id="${esc(c.id)}">${ico('ui:play')}<b>Watch</b></button>
    <button class="btn hc-del" data-act="hcDel" data-id="${esc(c.id)}" data-sound="deny" aria-label="Delete clip">${ico('ui:close')}<b>Delete</b></button>
  </div>`;
};

async function clipsScreen(menu, { onBack, onStats, onWatch, onWatchCode }) {
  menu.el.dataset.screen = 'history';
  const paint = clips => {
    menu.el.innerHTML = `
      ${header({ back: 'hsBack', label: 'Done', title: 'Match history', cls: 'hs-bar', extra: `${tabsHtml('clips')}<small class="hs-count">${ico('ui:play')}${clips.length} of ${MAX_CLIPS} clips</small>${onWatchCode ? `<button class="btn hc-code" data-act="hcCode" data-sound="tab">${ico('ui:play')}<b>Replay code</b></button>` : ''}` })}
      ${clips.length ? `<div class="hc-list scroll-y" data-in="up">${clips.map(clipRow).join('')}</div>`
        : `<div class="hs-empty" data-in="up">${ico('ui:play')}<b>No clips yet</b><p>After a match, tap Watch replay on the results, then Save clip to keep the last 30 seconds here. Up to ${MAX_CLIPS} clips. A friend's replay code plays from Replay code above.</p></div>`}`;
  };
  paint([]);
  menu.on({
    hsBack: () => onBack(),
    hsStats: () => onStats?.(),
    hsTab: ({ tab: t }) => { if (t === 'matches') historyScreen(menu, { onBack, onStats, onWatch, onWatchCode }); },
    hcWatch: ({ id }) => onWatch?.(id),
    hcCode: () => pasteSheet({ onWatch: clip => onWatchCode?.(clip) }),
    hcDel: ({ id }) => {
      // A second tap on the same Delete confirms.
      const b = menu.el.querySelector(`.hc-del[data-id="${CSS.escape(id)}"]`);
      if (b && !b.classList.contains('arm')) {
        b.classList.add('arm');
        b.querySelector('b').textContent = 'Sure?';
        setTimeout(() => { if (b.isConnected) { b.classList.remove('arm'); b.querySelector('b').textContent = 'Delete'; } }, 2500);
        return;
      }
      deleteClip(id).then(() => clipsScreen(menu, { onBack, onStats, onWatch, onWatchCode }));
    },
  });
  menu.show();
  const clips = await listClips();
  if (menu.el.dataset.screen !== 'history' || !menu.el.querySelector('.hs-tabs .seg.on[data-tab="clips"]')) return;     // Left meanwhile.
  paint(clips);
}
