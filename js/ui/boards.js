// The Leaderboards screen (ROADMAP item 16): you, the friends you have played with (their cards as of that day) and
// the bot pool's players (js/shared/botpool.js careerAt, the same on every phone), ranked on one category at a time.
// Views: Everyone, Friends (you and them), Around me (your rank and its neighbours). The list on the left scrolls
// natively and opens on your row; the panel on the right shows whichever row was tapped (yours to begin with).
// Mount like the stats screen: boardsScreen(menu, { onBack, myId }).
import { CATEGORIES, VIEWS, AROUND, buildBoard, getCategory, weekOf, categoriesFor, SEASON_KD_MIN, compactNum } from '../shared/boards.js';
import { seasonAt } from '../shared/seasons.js';
import { division } from '../shared/ranked.js';
import { rankBadge } from './season.js';
import { Progress, Friends } from './progress.js';
import { getOperator, getSkin } from './operators.js';
import { emblemHtml } from './emblems.js';
import { cardHtml } from './cards.js';
import { esc, badgeMark } from './widgets.js';
import { ico, header } from './yard.js';
import { enter } from './motion.js';

const VIEW_LABEL = { everyone: 'Everyone', friends: 'Friends', around: 'Around me', season: 'Season' };
const VIEW_ICON = { everyone: 'ui:party', friends: 'ui:user', around: 'ui:aim', season: 'ui:star' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateText = at => { const d = new Date(at); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
const n = v => Math.round(v).toLocaleString('en-US');
const cn = v => compactNum(Math.round(v ?? 0));        // Stat cells: 2.09M XP fits where 2,090,000 did not.

// A row's value: one line, or (a maxed player on Level) the level over its XP, so the column stays narrow.
function rowVal(text) {
  const m = /^(.*) · ([\d.]+[kM]? XP)$/.exec(text);
  return m ? `<span class="bd-val t-num two"><b>${esc(m[1])}</b><small>${esc(m[2])}</small></span>` : `<span class="bd-val t-num">${esc(text)}</span>`;
}

// Kept for the session: the board opens where it was left.
const last = { view: 'everyone', cat: 'level' };

function row(r, i, open) {
  const e = r.e;
  const kind = e.kind === 'me' ? ' me' : e.kind === 'friend' ? ' friend' : '';
  return `<button class="bd-row${kind}${open ? ' open' : ''}" data-act="bdRow" data-i="${i}">
    <span class="bd-rank t-num">${r.rank}</span>
    <span class="bd-em">${emblemHtml(e.emblem, { size: 18 }) || ''}</span>
    <span class="bd-bdg">${badgeMark(e.prestige, 16)}<u>${e.level}</u></span>
    <span class="bd-name">${e.clan ? `<em class="bd-clan">[${esc(e.clan)}]</em>` : ''}<b>${esc(e.name)}</b>${e.kind === 'friend' ? `<i class="bd-pal" title="Friend">${ico('ui:user', '', 12)}</i>` : ''}${e.kind === 'me' ? '<small>You</small>' : ''}${(e.sn?.sr ?? -1) >= 0 ? `<i class="bd-rk">${rankBadge(division(e.sn.sr).code, 14)}</i>` : ''}</span>
    ${rowVal(r.text)}
  </button>`;
}

function detail(r, cat, now) {
  if (!r) return '';
  const e = r.e, wk = weekOf(e, now);
  const op = e.op ? getOperator(e.op) : null, skin = getSkin(e.skin);
  const kd = e.d ? (e.kdk / e.d).toFixed(2) : e.kdm ? e.kdk.toFixed(2) : '-';
  // A long value (P10 · 50, 11,427) steps its type down a size; nothing runs out of its cell.
  const stat = (label, value, on) => `<span class="bdd-stat${on ? ' on' : ''}${String(value).length > 6 ? ' long' : ''}"><b class="t-num">${value}</b><small>${label}</small></span>`;
  const sr = e.sn?.sr ?? -1, rank = sr >= 0 ? `${division(sr).name}` : 'Unranked';
  const sub = e.kind === 'friend' ? `Friend · as of ${dateText(e.asOf)}` : e.kind === 'me' ? 'You' : `${e.prestige ? `Prestige ${e.prestige} · ` : ''}Level ${e.level}`;
  return `<div class="bdd">
    <div class="bdd-card">${cardHtml(e.card, { size: 196, title: e.clan ? `[${e.clan}] ${e.name}` : e.name, sub })}</div>
    <div class="bdd-who">
      <span class="bdd-rank"><small>Rank</small><b class="t-num">${r.rank}</b></span>
      <span class="bdd-op">${ico('operator', '', 14)}<b>${esc(op ? op.name : 'Operator')}</b>${skin && skin.tier !== 'base' ? `<small>${esc(skin.name)}</small>` : ''}</span>
      <span class="bdd-rk">${rankBadge(sr >= 0 ? division(sr).code : -1, 22)}<b>${esc(rank)}</b>${sr >= 0 ? `<small>${n(sr)} SR</small>` : ''}</span>
    </div>
    <div class="bdd-stats">
      ${stat('Level', `${e.prestige ? `P${e.prestige} · ` : ''}${e.level}`, cat.id === 'level')}${stat('XP', cn(e.xp))}${stat('Matches', cn(e.m))}${stat('Kills', cn(e.k), cat.id === 'kills')}${stat('K/D', kd, cat.id === 'kd')}
      ${stat('Wins', cn(e.w + (e.brw ?? 0)), cat.id === 'wins')}${stat('BR played', cn(e.brm))}${stat('BR wins', cn(e.brw), cat.id === 'brwins')}${stat('BR top 5', cn(e.br5), cat.id === 'brtop5')}
      ${e.seasonView ? `${stat('Season tier', cn(e.sn?.t ?? 0), cat.id === 'tier')}${stat('Ranked', sr >= 0 ? cn(sr) : '-', cat.id === 'ranked')}${stat('BR top 5', cn(e.br5))}${stat('Matches', cn(e.m))}`
        : `${stat('Extract', cn(e.ex), cat.id === 'extract')}${stat('Mastery', cn(e.mst), cat.id === 'mastery')}${stat('Week kills', cn(wk.k), cat.id === 'wkills')}${stat('Week wins', cn(wk.w), cat.id === 'wwins')}`}
    </div>
  </div>`;
}

export function boardsScreen(menu, { onBack, myId = 'me', now = () => Date.now(), view = last.view, cat = last.cat }) {
  const state = { view: VIEWS.includes(view) ? view : 'everyone', cat: getCategory(cat).id, open: null, board: null };
  const fitCat = () => { const list = categoriesFor(state.view); if (!list.some(c => c.id === state.cat)) state.cat = list.find(c => c.id === 'kills')?.id ?? list[0].id; };
  fitCat();
  menu.el.dataset.screen = 'boards';

  const paint = (first = false) => {
    const friends = Friends.list(myId);
    const b = state.board = buildBoard({ me: Progress.careerCard(), myId, friends, cat: state.cat, view: state.view, now: now() });
    const cat = b.cat;
    if (state.open === null || !b.rows[state.open]) state.open = b.me >= 0 ? b.me : b.rows.length ? 0 : null;
    const lonely = state.view === 'friends' && !friends.length;
    const empty = !b.rows.length;
    menu.el.innerHTML = `
      ${header({ back: 'bdBack', label: 'Done', title: 'Boards', cls: 'bd-bar', extra: `
        <div class="bd-views">${VIEWS.map(v => `<button class="seg${state.view === v ? ' on' : ''}" data-act="bdView" data-v="${v}">${ico(VIEW_ICON[v], '', 14)}<b>${VIEW_LABEL[v]}</b></button>`).join('')}</div>` })}
      <div class="bd-cats scroll-x"${first ? ' data-in="fade"' : ''}>${categoriesFor(state.view).map(c =>
        `<button class="seg${state.cat === c.id ? ' on' : ''}" data-act="bdCat" data-c="${c.id}">${ico(`ui:${c.icon}`, '', 14)}<b>${c.label}</b></button>`).join('')}</div>
      <div class="bd-split">
        <div class="bd-list"${first ? ' data-in="up"' : ''}>
          <div class="bd-row bd-head"><span class="bd-rank">#</span><span class="bd-who">Player</span><span class="bd-val">${esc(cat.label)}</span></div>
          ${b.note ? `<p class="bd-note bd-pin">${ico('ui:info', '', 14)}${esc(b.note)}</p>` : ''}
          <div class="bd-body scroll-y">${b.rows.map((r, i) => row(r, i, i === state.open)).join('')}
            ${lonely ? `<p class="bd-note">${ico('ui:party', '', 14)}Friends you share a lobby with show up here, as of the last match you played together.</p>` : ''}
            ${empty && !b.note ? `<p class="bd-note">${ico('ui:info', '', 14)}Nobody to rank here yet.</p>` : ''}
          </div>
          <div class="bd-foot">${state.view === 'around' ? `Your rank and ${AROUND} either side` : `${b.total.toLocaleString('en-US')} ranked`}${cat.rule ? ` · ${esc(cat.rule)}` : ''}${cat.weekly ? ' · Week starts Monday' : ''}${state.view === 'season' ? ` · ${esc(seasonAt(new Date(now())).title)}${cat.id === 'kd' ? `, ${SEASON_KD_MIN}+ matches` : ''}` : ''}</div>
        </div>
        <div class="bd-detail"${first ? ' data-in="right"' : ''}>${detail(b.rows[state.open], cat, now())}</div>
      </div>`;
    // Open on your own row, in the middle of the list.
    const body = menu.el.querySelector('.bd-body'), mine = body?.querySelector('.bd-row.me');
    if (body && mine) body.scrollTop = Math.max(0, mine.offsetTop - body.offsetTop - (body.clientHeight - mine.offsetHeight) / 2);
    // Keep the chosen category in view in the sideways strip.
    const strip = menu.el.querySelector('.bd-cats'), on = strip?.querySelector('.seg.on');
    if (strip && on && (on.offsetLeft + on.offsetWidth > strip.scrollLeft + strip.clientWidth || on.offsetLeft < strip.scrollLeft)) strip.scrollLeft = on.offsetLeft - 8;
  };

  menu.on({
    bdBack: () => onBack(),
    bdView: ({ v }) => { if (!VIEWS.includes(v)) return; state.view = last.view = v; state.open = null; fitCat(); paint(); },
    bdCat: ({ c }) => { state.cat = last.cat = getCategory(c).id; state.open = null; paint(); },
    bdRow: ({ i }) => {
      const k = Number(i), r = state.board?.rows[k];
      if (!r || k === state.open) return;
      state.open = k;
      for (const el of menu.el.querySelectorAll('.bd-body .bd-row')) el.classList.toggle('open', Number(el.dataset.i) === k);
      const pane = menu.el.querySelector('.bd-detail');
      pane.innerHTML = detail(r, state.board.cat, now());
      enter(pane.firstElementChild, 'right', { duration: 180 });
    },
  });
  paint(true);
  menu.show();
}
