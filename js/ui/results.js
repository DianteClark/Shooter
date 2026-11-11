// The end-of-match screen and its reel: the outcome moment, then the tables, XP fills, level-up ceremony, weapon
// bars and unlocks one by one. All of it is transform and opacity via WAAPI; the reel can be tapped through, and a tap
// ends the wait in progress. Rematch and Menu work from the first frame.
import { TEAMS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { GUN_LADDER, isFfa, MODES, modeRules } from '../shared/modes.js';
import { PLAYER_CURVE, WEAPON_CURVE, MAX_LEVEL } from '../shared/progression.js';
import { matchScore, Progress } from './progress.js';
import { esc, hex, badgeMark, badgeTag, SLOT_LABEL, ROMAN } from './widgets.js';
import { kindLabel } from './prestige.js';
import { icon, resolveIcon } from './icons.js';
import { rollNumber, sweep, reducedMotion } from './motion.js';
import { playerBanner, proProgressHtml, unlockStamp } from './cards.js';
import { challengeStamp, challengeStrip } from './challenges.js';
import { masteryStamp, masteryStrip } from './mastery.js';

const FILL_MS = 520;
const STAMP_MS = 1700;
const UNLOCK_MS = 1250;
const HERO_MS = 1500;           // The outcome word holds the screen this long before the tables take over.
const BOARD_ROWS = 6;           // Rows per team table, the last one a "+N more" line on bigger teams.

const OUTCOME = {
  win: ['Victory', 'The yard is yours'],
  loss: ['Defeat', 'The yard is lost'],
  draw: ['Stalemate', 'Neither side broke through'],
};

const ORDINAL = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const FFA_LINE = { 1: 'Nobody else came close', 2: 'One short of the top', 3: 'On the podium' };

const fillFrac = p => (p.maxed ? 1 : p.into / p.span);
const art = (id, size, cls = '') => (id != null && resolveIcon(id) !== 'unknown' ? icon(id, { size, cls }) : '');

// Where the bar should start: the level before this match plus how far into it the player was.
function beforeState(curve, total, gained, levelBefore) {
  const was = Math.max(0, total - gained);
  const p = curve.progress(was);
  return { level: levelBefore, frac: fillFrac(p) };
}

class Reel {
  constructor(menu) {
    this.menu = menu;
    this.dead = false;
    this.fast = false;
    this.anims = [];
    this.wake = null;
    this.rematchLabel = 'Rematch';
  }

  cancel() {
    this.dead = true;
    for (const a of this.anims) a.cancel();
    this.anims.length = 0;
    this.wake?.();
  }

  tapThrough() {
    this.fast = true;
    for (const a of this.anims) a.finish();
    this.wake?.();
  }

  sleep(ms) {
    if (this.dead) return Promise.resolve();
    return new Promise(res => {
      const t = setTimeout(done, this.fast ? Math.min(ms, 60) : ms);
      const self = this;
      function done() { clearTimeout(t); self.wake = null; res(); }
      this.wake = done;
    });
  }

  track(a) {
    this.anims.push(a);
    return a.finished.catch(() => {}).then(() => { const i = this.anims.indexOf(a); if (i >= 0) this.anims.splice(i, 1); });
  }

  fill(el, from, to) {
    const dur = this.fast ? 60 : Math.max(180, FILL_MS * (to - from) * 1.6);
    return this.track(el.animate(
      [{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }],
      { duration: dur, easing: 'cubic-bezier(.25,.1,.25,1)', fill: 'forwards' },
    ));
  }

  // Fills across any number of level boundaries. onLevel(n) fires as each new level is reached.
  async climb(bar, label, from, to, onLevel) {
    let level = from.level, frac = from.frac;
    while (level < to.level && !this.dead) {
      await this.fill(bar, frac, 1);
      level++;
      frac = 0;
      label.textContent = `Lv ${level}`;
      label.animate([{ transform: 'scale(1.5)', color: '#fff' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.3,1.55,.45,1)' });
      onLevel?.(level);
      await this.sleep(70);
    }
    if (!this.dead) await this.fill(bar, frac, to.frac);
  }

  // Full-screen card in the shared overlay. A tap wakes the sleep; the overlay stays until the next step.
  async stamp(html, ms = STAMP_MS) {
    if (this.dead || this.fast) return;
    const m = this.menu;
    // A ceremony fills the screen, so it carries its own Rematch and Menu: they must work the moment results appear.
    m.overlay(`<div class="rx-cer" data-act="reelTap"><i class="rx-rays"></i><i class="rx-floor"></i>${html}
      <small class="rx-tap">Tap to continue</small>
      <div class="rx-cer-actions">
        <button class="rs-btn primary" data-act="resRematch">${esc(this.rematchLabel)}</button>
        <button class="rs-btn" data-act="resMenu">Menu</button>
      </div></div>`);
    m.on({ reelTap: () => this.wake?.() });
    const card = m.overlayEl?.querySelector('.rx-card');
    if (card) sweep(card, { delay: 380 });
    await this.sleep(ms);
    if (!this.dead) m.overlay('');
  }
}

export function resultsScreen(menu, data, { rematch, menu: toMenu }) {
  menu.el.dataset.screen = 'results';
  const { outcome, scores, myTeam, roster, badges, mvp, xp, level, weapons, unlocks, finalKill: fk } = data;
  const badgeOf = id => badges?.get(id) ?? null;
  // The mode's own number takes the headshot column where the mode has one.
  const rules = modeRules(data.modeId ?? data.mode);      // Ground War modes keep the columns of their rule set.
  // Search and Destroy: plants and defuses, as "plants/defuses". Capture the Flag: "captures/returns/carrier kills".
  const modeHead = rules === 'kc' ? 'Conf' : rules === 'dom' || rules === 'hard' ? 'Cap' : rules === 'snd' ? 'P/D' : rules === 'ctf' ? 'C/R/K' : 'HS';
  const modeStat = p => (rules === 'kc' ? p.confirms ?? 0 : rules === 'dom' || rules === 'hard' ? p.captures ?? 0
    : rules === 'snd' ? `${p.plants ?? 0}/${p.defuses ?? 0}`
    : rules === 'ctf' ? `${p.captures ?? 0}/${p.returns ?? 0}/${p.carrierKills ?? 0}` : p.head ?? 0);
  let [word, line] = OUTCOME[outcome] ?? OUTCOME.draw;
  const winTeam = outcome === 'win' ? myTeam : outcome === 'loss' ? 1 - myTeam : null;
  let tone = TEAMS[winTeam]?.css ?? 'var(--c-sodium)';      // A free-for-all sets its own below.

  // Free-for-all: placement, not sides. Standings by the mode's score, then fewer deaths, then kills.
  const ffa = isFfa(data.modeId ?? data.mode), gun = rules === 'gun';
  const scoreOf = p => scores?.[p.team] ?? 0;
  const ranked = ffa ? roster.filter(p => !p.dummy).sort((a, b) => scoreOf(b) - scoreOf(a) || a.deaths - b.deaths || b.kills - a.kills) : [];
  const me = ranked.find(p => p.id === data.localId);
  const place = me ? ranked.indexOf(me) + 1 : 0;
  // The pair of numbers by the outcome word: yours against your team's rival, or in a free-for-all against the best
  // score that is not yours.
  let mineNum = scores?.[myTeam] ?? 0, themNum = scores?.[1 - myTeam] ?? 0, mineCss = TEAMS[myTeam]?.css, themCss = TEAMS[1 - myTeam]?.css;
  const shown = p => (gun ? `${Math.min(GUN_LADDER.length, scoreOf(p))}/${GUN_LADDER.length}` : `${scoreOf(p)}`);
  if (ffa) {
    const rival = ranked[0] === me ? ranked[1] : ranked[0];
    word = place ? `${ORDINAL(place)} place` : 'Match over';
    line = place === 1 ? (outcome === 'draw' ? 'Tied at the top' : gun ? 'Through every gun to the Verdict' : FFA_LINE[1]) : FFA_LINE[place] ?? `${ranked[0]?.name ?? 'Someone'} took the yard`;
    tone = place === 1 ? 'var(--c-gold)' : place <= 3 ? 'var(--c-sodium)' : TEAMS[ranked[0]?.team]?.css ?? 'var(--c-sodium)';
    mineNum = me ? scoreOf(me) : 0; themNum = rival ? scoreOf(rival) : 0;
    mineCss = TEAMS[myTeam]?.css; themCss = rival ? TEAMS[rival.team]?.css : 'var(--c-haze)';
  }

  // Battle royale (js/sim/br.js): placement among the squads, your squad's own numbers, and how the squads finished.
  // data.br.stats is per roster index: [damage, revives, downs dealt, placement, seconds alive x10].
  const br = rules === 'br';
  const brStat = p => data.br?.stats?.[roster.indexOf(p)] ?? [0, 0, 0, p.place ?? 0, 0];
  const solo = MODES[data.modeId ?? data.mode]?.squad === 1;
  const squadTeams = br ? [...new Set(roster.map(p => p.team))] : [];
  const myPlace = br ? (outcome === 'win' ? 1 : roster.find(p => p.id === data.localId)?.place || squadTeams.length) : 0;
  if (br) {
    word = outcome === 'win' ? 'Victory' : `${ORDINAL(myPlace)} place`;
    line = outcome === 'win' ? (solo ? 'Last one standing' : 'Last squad standing') : `out of ${squadTeams.length} ${solo ? 'players' : 'squads'}`;
    tone = myPlace === 1 ? 'var(--c-gold)' : myPlace <= 3 ? 'var(--c-sodium)' : 'var(--c-haze)';
    mineNum = myPlace; themNum = squadTeams.length; mineCss = 'var(--c-gold)'; themCss = 'var(--c-haze)';
  }
  const mmss = ds => { const s = Math.round(ds / 10); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const brSquad = () => {
    const mates = roster.filter(p => p.team === myTeam);
    return `<div class="rb ours${outcome === 'win' ? ' won' : ''}" style="--team:${TEAMS[myTeam]?.css}">
      <div class="rb-head"><b class="rb-team">${solo ? 'You' : 'Your squad'}</b><b class="rb-pts">${ORDINAL(myPlace)}</b>
        <span>K</span><span title="Downs">Dn</span><span title="Revives">Rv</span><span title="Damage">Dmg</span><span class="wide">Alive</span></div>
      ${mates.map((p, i) => { const st = brStat(p); return `<div class="rb-row${p.id === data.localId ? ' me' : ''}" style="--i:${i}">
        <span class="rb-name">${badgeTag(badgeOf(p.id), 14)}<b>${esc(p.name)}</b></span><span>${p.kills}</span><span>${st[2]}</span><span>${st[1]}</span><span>${st[0]}</span><span class="wide">${mmss(st[4])}</span>
      </div>`; }).join('')}
    </div>`;
  };
  const brSquads = () => {
    const rows = squadTeams.map(t => {
      const ms = roster.filter(p => p.team === t);
      const place = ms.reduce((m, p) => Math.max(m, p.place || 0), 0) || (t === (outcome === 'win' ? myTeam : null) ? 1 : squadTeams.length);
      return { t, ms, place, kills: ms.reduce((n, p) => n + p.kills, 0) };
    }).sort((a, b) => a.place - b.place);
    let shownRows = rows.slice(0, BOARD_ROWS - 1);
    const mine = rows.find(r => r.t === myTeam);
    if (mine && !shownRows.includes(mine)) shownRows = [...rows.slice(0, BOARD_ROWS - 2), mine];
    return `<div class="rb theirs" style="--team:var(--c-gold)">
      <div class="rb-head"><b class="rb-team">${solo ? 'Standings' : 'Squads'}</b><b class="rb-pts"></b>
        <span></span><span></span><span></span><span>K</span><span class="wide">Place</span></div>
      ${shownRows.map((r, i) => `<div class="rb-row${r.t === myTeam ? ' me' : ''}" style="--i:${i}">
        <span class="rb-name" style="grid-column:span 4"><i style="flex:none;width:7px;height:7px;background:${TEAMS[r.t]?.css}"></i><b>${esc(r.ms.map(p => p.name).join(', '))}</b></span><span>${r.kills}</span><span class="wide">${ORDINAL(r.place)}</span>
      </div>`).join('')}
      ${rows.length > shownRows.length ? `<div class="rb-row" style="--i:${shownRows.length}"><span class="rb-name"><b>+${rows.length - shownRows.length} more</b></span></div>` : ''}
    </div>`;
  };

  // A podium for the top three, in their own colours, the winner raised in the middle.
  const podium = () => {
    const step = [ranked[1], ranked[0], ranked[2]];
    const heights = [62, 86, 46];
    return `<div class="rb ours rs-podium" style="--team:var(--c-gold);display:flex;flex-direction:column">
      <div class="rb-head" style="grid-template-columns:1fr"><b class="rb-team">Podium</b></div>
      <div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);align-items:end;gap:6px;padding:6px 10px 0">
        ${step.map((p, k) => p ? `<div class="rb-row${p.id === data.localId ? ' me' : ''}" style="--i:${k};height:auto;display:flex;flex-direction:column;align-items:stretch;gap:3px;padding:0;background:none;box-shadow:none">
          <span style="text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${TEAMS[p.team]?.css}">${badgeTag(badgeOf(p.id), 12)}<b style="font-weight:400">${esc(p.name)}</b></span>
          <span style="text-align:center;font:400 15px/1 var(--f-stencil);color:var(--c-chalk)">${shown(p)}</span>
          <i style="display:flex;align-items:flex-start;justify-content:center;height:${heights[k]}px;padding-top:5px;background:linear-gradient(180deg, color-mix(in srgb, ${TEAMS[p.team]?.css} 70%, transparent), color-mix(in srgb, ${TEAMS[p.team]?.css} 18%, transparent));box-shadow:inset 0 2px 0 ${TEAMS[p.team]?.css};font:400 20px/1 var(--f-stencil);font-style:normal;color:#fff">${[2, 1, 3][k]}</i>
        </div>` : '<div></div>').join('')}
      </div>
    </div>`;
  };

  // Every player ranked: the leaders, you wherever you placed, and a count of the rest, in the 6v6 table's height.
  const standings = () => {
    let rows = ranked.map((p, i) => [p, i + 1]), rest = 0;
    if (rows.length > BOARD_ROWS) {
      const mine = place - 1;
      const keep = rows.slice(0, mine >= BOARD_ROWS - 1 ? BOARD_ROWS - 2 : BOARD_ROWS - 1);
      if (mine >= keep.length) keep.push(rows[mine]);
      rest = rows.length - keep.length;
      rows = keep;
    }
    return `<div class="rb theirs" style="--team:${TEAMS[myTeam]?.css}">
      <div class="rb-head"><b class="rb-team">Standings</b><b class="rb-pts"></b>
        <span>K</span><span>D</span><span>A</span><span>${gun ? 'Gun' : 'HS'}</span><span class="wide">${gun ? 'Score' : 'Kills'}</span></div>
      ${rows.map(([p, n], i) => `<div class="rb-row${p.id === data.localId ? ' me' : ''}${p.id === mvp?.id ? ' mvp' : ''}" style="--i:${i}">
        <span class="rb-name"><u style="text-decoration:none;min-width:2.3ch;color:var(--c-haze)">${ORDINAL(n)}</u><i style="flex:none;width:7px;height:7px;background:${TEAMS[p.team]?.css}"></i>${badgeTag(badgeOf(p.id), 14)}<b>${esc(p.name)}</b></span><span>${p.kills}</span><span>${p.deaths}</span><span>${p.assists ?? 0}</span><span>${gun ? Math.min(GUN_LADDER.length, scoreOf(p) + 1) : p.head ?? 0}</span><span class="wide">${gun ? matchScore(p) : scoreOf(p)}</span>
      </div>`).join('')}
      ${rest ? `<div class="rb-row" style="--i:${rows.length}"><span class="rb-name"><b>+${rest} more</b></span></div>` : ''}
    </div>`;
  };

  const board = (team, side) => {
    const ranked = roster.filter(p => p.team === team).sort((a, b) => matchScore(b) - matchScore(a) || a.deaths - b.deaths);
    // Ground War fields 16 a side; the table keeps the 6v6 height so the cards below stay on screen: the leaders, you
    // wherever you placed, and a count of the rest.
    let rows = ranked, rest = 0;
    if (ranked.length > BOARD_ROWS) {
      const mine = ranked.findIndex(p => p.id === data.localId);
      rows = ranked.slice(0, mine >= BOARD_ROWS - 1 ? BOARD_ROWS - 2 : BOARD_ROWS - 1);
      if (mine >= rows.length) rows.push(ranked[mine]);
      rest = ranked.length - rows.length;
    }
    const won = winTeam === team;
    return `<div class="rb ${side}${won ? ' won' : ''}" style="--team:${TEAMS[team].css}">
      <div class="rb-head"><b class="rb-team">${esc(TEAMS[team].name)}</b><b class="rb-pts">${scores[team]}</b>
        <span>K</span><span>D</span><span>A</span><span>${modeHead}</span><span class="wide">Score</span></div>
      ${rows.map((p, i) => `<div class="rb-row${p.id === data.localId ? ' me' : ''}${p.id === mvp?.id ? ' mvp' : ''}" style="--i:${i}">
        <span class="rb-name">${badgeTag(badgeOf(p.id), 14)}<b>${esc(p.name)}</b>${p.id === mvp?.id ? `<i class="rb-star">${art('ui:star', 11)}</i>` : ''}</span><span>${p.kills}</span><span>${p.deaths}</span><span>${p.assists ?? 0}</span><span>${modeStat(p)}</span><span class="wide">${matchScore(p)}</span>
      </div>`).join('')}
      ${rest ? `<div class="rb-row" style="--i:${rows.length}"><span class="rb-name"><b>+${rest} more</b></span></div>` : ''}
    </div>`;
  };

  const lp = level ?? { before: 1, after: 1, level: 1, into: 0, span: 1, maxed: false, prestige: 0 };
  const startLevel = lp.before ?? lp.level;
  const xpFrom = beforeState(PLAYER_CURVE, totalPlayerXp(lp), xp?.total ?? 0, startLevel);
  const weaponRow = (w, i) => `
      <div class="wp" style="--i:${i}">
        <span class="wp-icon">${art(w.weapon, 14)}</span>
        <div class="wp-body">
          <div class="wp-line"><b>${esc(w.name)}</b><span class="wlv"><span class="wp-lv wlv-n" data-wl="${i}">Lv ${w.levelBefore}</span>${w.prestige ? `<em class="wlv-p">${ROMAN[w.prestige] ?? w.prestige}</em>` : ''}</span><span class="wp-gain">+${w.xpGained}</span></div>
          <i class="rs-bar"><i class="rs-fill wp-fill" data-wf="${i}" style="transform:scaleX(0)"></i></i>
          <small data-wn="${i}">${w.maxed ? 'Max level' : `${Math.round(w.into)} / ${w.span} to Lv ${w.level + 1}`}</small>
        </div>
      </div>`;
  const mvpCard = mvp ? `
      <div class="rs-mvp" style="--team:${TEAMS[mvp.team]?.css ?? 'var(--c-sodium)'}">
        <span class="rs-mvp-tag">${art('ui:star', 12)}MVP</span>
        ${playerBanner(mvp.id, mvp.name, { size: 168, sub: `${mvp.kills} ${mvp.kills === 1 ? 'kill' : 'kills'}, ${matchScore(mvp)} pts` })}
      </div>` : '';
  const modeName = MODES[data.modeId ?? data.mode]?.name ?? '';
  // Search and Destroy: one chip per round in the order played, in the colour of the side that took it, marked with
  // how (wipe, detonation, defuse, time). data.snd is the match's final S&D state when the match passes it on.
  const ROUND_ICON = { elim: 'ui:skull', bomb: 'bomb', defuse: 'medal:defuse', time: 'ui:clock' };
  const ROUND_WORD = { elim: 'Eliminated', bomb: 'Detonated', defuse: 'Defused', time: 'Time' };
  const history = rules === 'snd' ? data.snd?.history ?? [] : [];
  const roundStrip = history.length ? `<span class="rs-rounds" style="display:inline-flex;gap:2px;margin-left:8px;vertical-align:middle">${history.map((h, i) =>
    `<i title="Round ${i + 1}: ${ROUND_WORD[h.reason] ?? ''}" style="width:14px;height:14px;display:grid;place-items:center;line-height:0;color:#fff;--icon-accent:currentColor;background:${TEAMS[h.winner]?.css};box-shadow:inset 0 -2px 0 rgba(0,0,0,.35);opacity:${h.winner === myTeam ? 1 : 0.75}">${art(ROUND_ICON[h.reason], 10)}</i>`).join('')}</span>` : '';
  if (rules === 'snd' && !ffa) line = outcome === 'win' ? `Won ${mineNum} rounds to ${themNum}` : outcome === 'loss' ? `Lost ${mineNum} rounds to ${themNum}` : line;
  if (rules === 'ctf') {
    const caps = `${mineNum} ${mineNum === 1 ? 'capture' : 'captures'} to ${themNum}`;
    line = outcome === 'win' ? `Won ${caps}` : outcome === 'loss' ? `Lost ${caps}` : `Level at ${caps}`;
  }
  // Challenges and Pro challenges get a card of their own, so Rematch and Menu always keep their column. A single row
  // would leave that card nearly empty, so one row sits over the buttons instead, where it fits on every phone.
  // Mastery tracks that moved: main.js may pass them as data.mastery; MatchAwards also leaves them with Progress.
  const mastery = data.mastery ?? Progress.lastMastery();
  const progress = challengeStrip(data.challenges) + proProgressHtml(data.proProgress) + masteryStrip(mastery);
  const progressRows = Math.min(3, data.challenges?.length ?? 0) + Math.min(2, data.proProgress?.length ?? 0) + Math.min(3, mastery?.length ?? 0);
  const progCard = progressRows > 1;

  menu.el.innerHTML = `
    <div class="rs" data-outcome="${outcome}" style="--tone:${tone}">
      <div class="rs-top">
        <div class="rs-word"><h2>${esc(word)}</h2><small>${esc(modeName)}${roundStrip}</small></div>
        <span class="rs-score"><u class="rs-mine" style="color:${mineCss}">0</u><i></i><u class="rs-them" style="color:${themCss}">0</u></span>
        ${mvpCard}
        <button class="rs-btn quiet res-skip" data-act="resSkip">Skip</button>
      </div>
      <div class="rb-pair">${br ? brSquad() + brSquads() : ffa ? podium() + standings() : board(myTeam, 'ours') + board(1 - myTeam, 'theirs')}</div>
      <div class="rs-cards${progCard ? ' has-prog' : ''}">
        <div class="rs-card finalcard${fk ? '' : ' none'}">
          <div class="fk-canvas"></div>
          <div class="fk-cap">${fk ? `<small>Final kill</small><b>${esc(fk.byName)}</b><span>on ${esc(fk.targetName)}</span><em>${art(fk.weapon, 10)}${esc(WEAPONS[fk.weapon]?.name ?? fk.weapon)}</em>` : '<small>Final kill</small><span>The match ended without one</span>'}</div>
        </div>
        <div class="rs-card xp-card">
          <div class="xp-head"><b class="xp-sum">+<u class="xp-total">0</u><small>XP</small></b><span class="xp-lv">${badgeMark(lp.prestige ?? 0, 22)}<b class="xp-lvn">Lv ${startLevel}</b></span></div>
          <div class="xp-lines">${(xp?.lines ?? []).map(([label, amount], i) => `<div class="xp-row" style="--i:${i}"><span>${esc(label)}</span><b>+${amount}</b></div>`).join('') || '<small class="empty">No XP this time</small>'}</div>
          <i class="rs-bar big"><i class="rs-fill xp-player" style="transform:scaleX(0)"></i></i>
          <small class="xp-next">${lp.maxed ? 'Maximum level' : `${Math.round(lp.into)} / ${lp.span} to Lv ${lp.level + 1}`}</small>
          ${lp.canPrestige ? '<small class="res-prestige">Prestige available</small>' : ''}
        </div>
        <div class="rs-card wp-card">
          <h4>Weapons</h4>
          ${weapons.length ? `<div class="wp-list">${weapons.map(weaponRow).join('')}</div>` : '<small class="empty">No weapon kills this match</small>'}
        </div>
        ${progCard ? `<div class="rs-card prog-card">${progress}</div>` : ''}
        <div class="res-choice">
          ${progCard ? '' : progress}
          <button class="rs-btn primary" data-act="resRematch">${esc(data.rematchLabel)}</button>
          <button class="rs-btn" data-act="resMenu">Menu</button>
          <p class="res-note">${esc(data.note ?? '')}</p>
        </div>
      </div>
      <div class="rs-hero" data-act="resHero">
        <i class="rs-hero-band"></i>
        <h1>${esc(word)}</h1>
        <p class="rs-hero-score"><u style="color:${mineCss}">${mineNum}</u><i></i><u style="color:${themCss}">${themNum}</u></p>
        <small>${esc(line)}</small>
      </div>
    </div>`;
  menu.on({ resRematch: () => { menu.overlay(''); rematch(); }, resMenu: () => { menu.overlay(''); toMenu(); } });
  // The screen is up before anything that could fail: the turntable needs WebGL, which a phone can refuse or lose.
  menu.show();
  if (fk) {
    try { menu.previewMount(menu.el.querySelector('.fk-canvas'), fk.weapon, fk.camo, undefined); } catch (err) { console.error('final kill preview', err); }
  }

  // The reel runs over a live screen: Rematch and Menu always work, and leaving kills it.
  const reel = new Reel(menu);
  menu.reel?.cancel();
  menu.reel = reel;
  reel.rematchLabel = data.rematchLabel;
  menu.on({
    resSkip: () => { menu.overlay(''); reel.tapThrough(); },
    resHero: () => reel.wake?.(),
  });
  runReel(menu, reel, { lp, xpFrom, weapons, unlocks, mineNum, themNum, xp }).catch(err => {
    // A reel that fails partway still leaves the whole screen readable.
    console.error('results reel', err);
    menu.el.querySelector('.rs-hero')?.remove();
    menu.el.querySelector('.rs')?.classList.add('in');
  });
}

function totalPlayerXp(lp) {
  return PLAYER_CURVE.floor(lp.level) + (lp.maxed ? 0 : lp.into);
}

function weaponFrom(w) {
  const total = WEAPON_CURVE.floor(w.level) + (w.maxed ? 0 : w.into);
  return beforeState(WEAPON_CURVE, total, w.xpGained, w.levelBefore);
}

async function runReel(menu, reel, { lp, xpFrom, weapons, unlocks, mineNum, themNum, xp }) {
  const q = sel => menu.el.querySelector(sel);
  const root = q('.rs');

  // The moment: the outcome word fills the screen, then lifts away and the tables arrive in order.
  const hero = q('.rs-hero');
  if (reducedMotion()) hero.remove();
  else {
    await reel.sleep(HERO_MS);
    if (reel.dead) return;
    const ms = reel.fast ? 60 : 320;
    const out = hero.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(1.06)' }], { duration: ms, easing: 'cubic-bezier(.55,0,.85,.35)', fill: 'forwards' });
    // An animation the page stops ticking (backgrounded, throttled) never settles; the tables must still come.
    await Promise.race([out.finished.catch(() => {}), new Promise(res => setTimeout(res, ms + 400))]);
    hero.remove();
  }
  if (reel.dead) return;
  root.classList.add('in');
  rollNumber(q('.rs-mine'), mineNum, { from: 0, duration: 600 });
  rollNumber(q('.rs-them'), themNum, { from: 0, duration: 600 });
  rollNumber(q('.xp-total'), xp?.total ?? 0, { from: 0, duration: 900, delay: 300 });
  await reel.sleep(520);
  if (reel.dead) return;

  // Player XP, then the level-up moment.
  const bar = q('.xp-player'), label = q('.xp-lvn');
  bar.style.transform = `scaleX(${xpFrom.frac.toFixed(3)})`;
  const to = { level: lp.level, frac: lp.maxed ? 1 : lp.into / lp.span };
  await reel.climb(bar, label, xpFrom, to);
  if (reel.dead) return;
  if (lp.after > lp.before) {
    q('.xp-card').classList.add('levelled');
    await reel.stamp(`
      <div class="rx-card rx-level">
        <div class="rx-emblem">${badgeMark(lp.prestige ?? 0, 92)}</div>
        <div class="rx-text"><span class="rx-kick">Level up</span><h2>Level ${lp.level}</h2><p>${lp.level >= MAX_LEVEL ? 'Maximum level. Prestige awaits.' : 'New gear may be waiting in the armory'}</p></div>
      </div>`);
    if (reel.dead) return;
  }

  // Each weapon bar in turn.
  for (let i = 0; i < weapons.length; i++) {
    const w = weapons[i], fill = q(`[data-wf="${i}"]`), lab = q(`[data-wl="${i}"]`), row = fill?.closest('.wp');
    if (!fill) continue;
    const from = weaponFrom(w);
    fill.style.transform = `scaleX(${from.frac.toFixed(3)})`;
    await reel.climb(fill, lab, from, { level: w.level, frac: w.maxed ? 1 : w.into / w.span }, () => row?.classList.add('up'));
    if (reel.dead) return;
    await reel.sleep(90);
    if (reel.dead) return;
  }

  // Unlocks, one card each, then done.
  for (const u of unlocks) {
    await reel.stamp(unlockCard(u), UNLOCK_MS);
    if (reel.dead) return;
  }
  if (reel.dead) return;
  q('.res-skip')?.setAttribute('hidden', '');
  const primary = q('.res-choice .primary');
  if (primary) sweep(primary);
  reel.dead = true;              // Finished: nothing left for a later screen to cancel.
}

function unlockCard(u) {
  // Pro perks and calling cards have their own ceremony (js/ui/cards.js), mastery tiers theirs (js/ui/mastery.js).
  const special = unlockStamp(u) ?? challengeStamp(u) ?? masteryStamp(u);
  if (special) return special;
  let mark;
  if (u.kind === 'camo') {
    const c = (u.colors ?? [0x888888]).map(hex);
    mark = `<span class="rx-swatch" style="background:linear-gradient(135deg, ${c[0]} 0 34%, ${c[1] ?? c[0]} 34% 67%, ${c[2] ?? c[0]} 67%)"></span>`;
  } else {
    const id = u.kind === 'attachment' ? u.slot : u.kind === 'operator' ? 'ui:operator' : u.id;
    const isGun = !!WEAPONS[u.id];
    mark = `<span class="rx-mark${isGun ? ' gun' : ''}">${art(id, isGun ? 56 : 84) || art('ui:new', 84)}</span>`;
  }
  const label = u.kind === 'weapon' ? 'Weapon' : kindLabel(u.kind);
  const sub = u.weaponName ? `${u.slot ? `${SLOT_LABEL[u.slot] ?? ''} for ` : 'For '}${u.weaponName}` : u.level ? `Level ${u.level} reward` : u.req ? `Challenge done: ${u.req}` : '';
  return `
    <div class="rx-card rx-unlock">
      ${mark}
      <span class="rx-kick">New ${esc(label)}</span>
      <h2>${esc(u.name)}</h2>
      ${sub ? `<small>${esc(sub)}</small>` : ''}
    </div>`;
}
