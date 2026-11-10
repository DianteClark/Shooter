// Match history: the last twenty matches (js/ui/progress.js MatchHistory, written by MatchAwards), a list on the left
// and the picked match in full on the right. Mount like the stats screen: historyScreen(menu, { onBack, onStats }).
// The title reaches the gun stats screen through here (its Gun stats button).
import { MAPS } from '../shared/map.js';
import { MODES } from '../shared/modes.js';
import { WEAPONS } from '../shared/weapons.js';
import { getChallenge } from '../shared/progression.js';
import { MatchHistory } from './progress.js';
import { mapImage } from './mapthumb.js';
import { esc } from './widgets.js';
import { icon } from './icons.js';
import { ico, header } from './yard.js';
import { enter } from './motion.js';

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
    <div class="hd-guns">
      <small class="hd-h">Guns used</small>
      ${e.guns.length ? e.guns.map(g => `<span class="hd-gun">${icon(g.id, { size: 13 })}<b>${esc(WEAPONS[g.id]?.name ?? g.id)}</b><small>${g.kills} ${g.kills === 1 ? 'kill' : 'kills'}${g.secs ? ` · ${mmss(g.secs)}` : ''}</small></span>`).join('')
        : '<span class="hd-none">No gun held long enough to count</span>'}
    </div>
    <div class="hd-foot">
      <span class="hd-xp">+${e.xp.toLocaleString('en-US')} XP${e.levelUp ? `<em>Level ${e.level}</em>` : ''}</span>
      ${e.challenges.length ? `<span class="hd-ch">${ico('ui:flag')}${e.challenges.length} challenge${e.challenges.length > 1 ? 's' : ''}: ${e.challenges.map(c => esc(getChallenge(c.id)?.label ?? '')).join(', ')}</span>` : ''}
      <span class="hd-who">${e.humans > 1 ? `${e.humans} players, ` : ''}${e.bots} bots</span>
    </div>
  </div>`;
}

export function historyScreen(menu, { onBack, onStats }) {
  const list = MatchHistory.list();
  let open = 0;
  menu.el.dataset.screen = 'history';
  const wins = list.filter(e => e.result === 'win').length;
  menu.el.innerHTML = `
    ${header({ back: 'hsBack', label: 'Done', title: 'Match history', cls: 'hs-bar', extra: `${list.length ? `<small class="hs-count">${ico('timer')}Last ${list.length} match${list.length === 1 ? '' : 'es'} · ${wins} won</small>` : ''}${onStats ? `<button class="btn hs-stats" data-act="hsStats">${ico('stats')}<b>Gun stats</b></button>` : ''}` })}
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
    hsRow: ({ i }) => {
      const n = Number(i);
      if (n === open || !list[n]) return;
      open = n;
      for (const r of menu.el.querySelectorAll('.hs-body .hs-row')) r.classList.toggle('open', Number(r.dataset.i) === open);
      const pane = menu.el.querySelector('.hs-detail');
      pane.innerHTML = detail(list[open]);
      enter(pane.firstElementChild, 'right', { duration: 180 });
    },
  });
  menu.show();
}
