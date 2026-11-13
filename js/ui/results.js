// The end-of-match screen and its reel: the outcome moment, then the tables, XP fills, level-up ceremony, weapon
// bars and unlocks one by one. All of it is transform and opacity via WAAPI; the reel can be tapped through, and a tap
// ends the wait in progress. Rematch and Menu work from the first frame.
import { TEAMS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { GUN_LADDER, isFfa, MODES, modeRules, EX, CONTRACT_NAMES } from '../shared/modes.js';
import { PLAYER_CURVE, WEAPON_CURVE, MAX_LEVEL, MASTER_CURVE } from '../shared/progression.js';
import { matchScore, Progress } from './progress.js';
import { esc, hex, badgeMark, badgeTag, nameHtml, SLOT_LABEL, ROMAN } from './widgets.js';
import { kindLabel, rankStamp, masterStampHtml } from './prestige.js';
import { icon, resolveIcon } from './icons.js';
import { rollNumber, sweep, reducedMotion, celebrate } from './motion.js';
import { playerBanner, proProgressHtml, unlockStamp, cardHtml, cardProgressHtml, cardsInReach } from './cards.js';
import { challengeStamp, challengeStrip } from './challenges.js';
import { modeColumn } from './mode-hud.js';
import { playlistName } from '../shared/playlist.js';
import { masteryStamp, masteryStrip } from './mastery.js';
import { playUi } from '../audio/audio.js';
import { seasonStrip, seasonStamp } from './season.js';
import { matchHeader, ffaStandings, brPlacing, ORDINAL } from './outcome.js';

const FILL_MS = 520;
const STAMP_MS = 1700;
const UNLOCK_MS = 1250;
const HERO_MS = 1500;           // The outcome word holds the screen this long before the tables take over.
const BOARD_ROWS = 6;           // Rows per team table, the last one a "+N more" line on bigger teams.


const fillFrac = p => (p.maxed ? 1 : p.into / p.span);
const art = (id, size, cls = '') => (id != null && resolveIcon(id) !== 'unknown' ? icon(id, { size, cls }) : '');

// Where the bar should start: the level before this match plus how far into it the player was.
function beforeState(curve, total, gained, levelBefore) {
  const was = Math.max(0, total - gained);
  const p = curve.progress(was);
  return { level: levelBefore, frac: fillFrac(p) };
}

// Counters that tick up with a sound: a detent every few frames, rising in pitch as the number climbs, a firmer one
// where it lands. Under reduced motion the number lands at once and only the landing plays.
function counterTick(base = 1) {
  let last = -1;
  return (v, f) => {
    const now = performance.now();
    if (f >= 1) { playUi('tick', { pitch: base * 1.35, gain: 1.1 }); return; }
    if (now - last < 55) return;
    last = now;
    playUi('tick', { pitch: base * (0.85 + 0.45 * f), gain: 0.7 });
  };
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
      label.textContent = `${to.prefix ?? 'Lv'} ${level}`;
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
    // Every ceremony throws shards as its stamp lands; a level up throws more of them.
    const cer = m.overlayEl?.querySelector('.rx-cer');
    if (cer) setTimeout(() => { if (!this.dead && cer.isConnected) celebrate(cer, { count: /rx-level|rx-m-/.test(html) ? 34 : 20 }); }, 160);
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
  let modeHead = rules === 'kc' ? 'Conf' : rules === 'dom' || rules === 'hard' ? 'Cap' : rules === 'snd' ? 'P/D' : rules === 'ctf' ? 'C/R/K' : 'HS';
  let modeStat = p => (rules === 'kc' ? p.confirms ?? 0 : rules === 'dom' || rules === 'hard' ? p.captures ?? 0
    : rules === 'snd' ? `${p.plants ?? 0}/${p.defuses ?? 0}`
    : rules === 'ctf' ? `${p.captures ?? 0}/${p.returns ?? 0}/${p.carrierKills ?? 0}` : p.head ?? 0);
  // The modes overhaul's rule sets bring their own column (js/ui/mode-hud.js).
  const ownCol = modeColumn(rules);
  if (ownCol) { modeHead = ownCol.head; modeStat = ownCol.stat; }
  // The header (word, line, tone, score) comes from js/ui/outcome.js, the table in docs/MODES.md.
  const head = matchHeader(data);
  const { word, line, tone } = head;
  const sc = head.score;
  const mineNum = sc.kind === 'pair' ? sc.mine : sc.kind === 'one' ? sc.value : 0, themNum = sc.kind === 'pair' ? sc.them : null;
  const mineCss = sc.mineCss ?? 'var(--c-sodium)', themCss = sc.themCss ?? 'var(--c-haze)';
  const winTeam = outcome === 'win' ? myTeam : outcome === 'loss' ? 1 - myTeam : null;

  // Free-for-all: placement, not sides.
  const ffa = isFfa(data.modeId ?? data.mode), gun = rules === 'gun';
  const { ranked, place, scoreOf } = ffa ? ffaStandings(data) : { ranked: [], place: 0, scoreOf: p => scores?.[p.team] ?? 0 };
  const shown = p => (gun ? `${Math.min(GUN_LADDER.length, scoreOf(p))}/${GUN_LADDER.length}` : `${scoreOf(p)}`);

  // Battle royale (js/sim/br.js): placement among the squads, your squad's own numbers, and how the squads finished.
  // data.br.stats is per roster index: [damage, revives, downs dealt, placement, seconds alive x10].
  const br = rules === 'br';
  const brStat = p => data.br?.stats?.[roster.indexOf(p)] ?? [0, 0, 0, p.place ?? 0, 0];
  const solo = MODES[data.modeId ?? data.mode]?.squad === 1;
  const { squadTeams, myPlace } = br ? brPlacing(data) : { squadTeams: [], myPlace: 0 };
  const mmss = ds => { const s = Math.round(ds / 10); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  // Extraction (js/sim/extract.js): out or not, what the squad banked or lost, and the exclusive unlocks' progress.
  // data.ex is this phone's pay (js/game/awards.js); data.exView the match's final squads and per-roster [revives, downs].
  const exr = rules === 'ex';
  const exSquadView = exr ? data.exView?.squads?.find(s => s.team === myTeam) ?? null : null;
  // Graveyard Shift (js/sim/zombies.js): how many rounds the crew lasted, the map's record, and the crew's own numbers.
  // data.zm is this phone's record line (js/game/awards.js); data.zmView the match's final round and crew.
  const zmr = rules === 'zm';
  const zmCrew = () => {
    const crew = data.zmView?.crew ?? [];
    const mates = roster.filter(p => p.team === myTeam && !p.ai);
    return `<div class="rb ours" style="--team:${TEAMS[myTeam]?.css}">
      <div class="rb-head"><b class="rb-team">Your crew</b><b class="rb-pts"></b>
        <span>K</span><span title="Headshots">HS</span><span title="Downs">Dn</span><span title="Revives">Rv</span><span class="wide">Points</span></div>
      ${mates.map((p, i) => { const c = crew.find(x => x.id === p.id) ?? {}; return `<div class="rb-row${p.id === data.localId ? ' me' : ''}" style="--i:${i}">
        <span class="rb-name">${badgeTag(badgeOf(p.id), 14)}<b>${nameHtml(p.name)}</b></span><span>${c.kills ?? p.kills}</span><span>${c.head ?? 0}</span><span>${c.downs ?? 0}</span><span>${c.revives ?? 0}</span><span class="wide">${(c.pts ?? 0).toLocaleString('en-US')}</span>
      </div>`; }).join('')}
    </div>`;
  };
  const zmRecord = () => {
    const z = data.zm ?? {}, map = z.mapName ?? '';
    const rows = [['Round reached', data.zmView?.round ?? 0], ['Rounds survived', z.survived ?? 0], [`Best on ${esc(map) || 'this map'}`, z.best ?? 0], ['Undead put down', z.kills ?? 0]];
    // Values stay short: the column is a number's width at 667 px (owner notes: "Round 18" and "Down: card earned" spilled).
    if (z.escaped || z.bestEscape) rows.push(['Best escape', z.bestEscape ? `R${z.bestEscape}` : '-']);
    if (z.warden) rows.push([z.freshBoss ? 'Gravewarden (card earned)' : 'Gravewarden', 'Down']);
    return `<div class="rb theirs" style="--team:#b8241c">
      <div class="rb-head"><b class="rb-team">Graveyard Shift</b><b class="rb-pts">${z.fresh ? 'Record' : ''}</b><span></span><span></span><span></span><span></span><span class="wide"></span></div>
      ${rows.map(([k, v], i) => `<div class="rb-row" style="--i:${i}"><span class="rb-name" style="grid-column:span 5"><b>${k}</b></span><span class="wide" style="color:${i === 2 && z.fresh ? 'var(--c-gold)' : 'var(--c-chalk)'}">${v}</span></div>`).join('')}
    </div>`;
  };
  const exStat = p => data.exView?.stats?.[roster.indexOf(p)] ?? [0, 0];
  const exSquad = () => {
    const mates = roster.filter(p => p.team === myTeam && !p.ai);
    return `<div class="rb ours${exSquadView?.extracted ? ' won' : ''}" style="--team:${TEAMS[myTeam]?.css}">
      <div class="rb-head"><b class="rb-team">Your squad</b><b class="rb-pts">${exSquadView?.extracted ? 'Out' : ''}</b>
        <span>K</span><span>D</span><span title="Downs dealt">Dn</span><span title="Revives">Rv</span><span class="wide">State</span></div>
      ${mates.map((p, i) => { const st = exStat(p); return `<div class="rb-row${p.id === data.localId ? ' me' : ''}" style="--i:${i}">
        <span class="rb-name">${badgeTag(badgeOf(p.id), 14)}<b>${esc(p.name)}</b></span><span>${p.kills}</span><span>${p.deaths}</span><span>${st[1]}</span><span>${st[0]}</span><span class="wide">${p.out ? 'Lifted' : p.alive ? 'Behind' : 'Dead'}</span>
      </div>`; }).join('')}
    </div>`;
  };
  const exRewards = () => {
    const banked = data.ex?.banked ?? exSquadView?.banked ?? [], lost = data.ex?.lost ?? [];
    const rows = [...banked.map(c => ({ c, ok: true })), ...lost.map(c => ({ c, ok: false }))];
    const unl = (data.ex?.unlocks ?? []).filter(u => !u.done || u.before < u.goal).sort((a, b) => (b.value - b.before) - (a.value - a.before) || b.value / b.goal - a.value / a.goal).slice(0, 3);
    const lines = rows.slice(0, 4).map(({ c, ok }, i) => `<div class="rb-row" style="--i:${i}">
        <span class="rb-name" style="grid-column:span 4">${art(`ex:${c.type}`, 13)}<b style="${ok ? '' : 'text-decoration:line-through;opacity:.55'}">${esc(CONTRACT_NAMES[c.type] ?? c.type)}</b></span><span>T${c.tier}</span><span class="wide" style="color:${ok ? 'var(--c-gold)' : 'var(--c-haze)'}">${ok ? `+${(EX.reward.xp[c.tier] ?? 0).toLocaleString('en-US')}` : 'Lost'}</span></div>`);
    if (rows.length > 4) lines.push(`<div class="rb-row" style="--i:4"><span class="rb-name"><b>+${rows.length - 4} more</b></span></div>`);
    const bars = unl.map((u, i) => `<div class="rb-row" style="--i:${lines.length + i}"><span class="rb-name" style="grid-column:span 5" title="${esc(u.label)}">${art(u.kind === 'camo' ? 'ui:camo' : u.kind === 'operator' ? 'ui:operator' : u.item, 13)}<b>${esc(u.name)}</b><small style="margin-left:6px;color:var(--c-haze);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.label)}</small></span><span class="wide" style="color:${u.value > u.before ? 'var(--c-gold)' : 'var(--c-haze)'}">${u.value}/${u.goal}</span></div>`);
    return `<div class="rb theirs" style="--team:var(--c-gold)">
      <div class="rb-head"><b class="rb-team">Contracts</b><b class="rb-pts"></b><span></span><span></span><span></span><span></span><span class="wide">XP</span></div>
      ${lines.join('') || '<div class="rb-row" style="--i:0"><span class="rb-name"><b>No contracts finished</b></span></div>'}
      ${bars.join('')}
    </div>`;
  };
  const brSquad = () => {
    const mates = roster.filter(p => p.team === myTeam);
    return `<div class="rb ours${outcome === 'win' ? ' won' : ''}" style="--team:${TEAMS[myTeam]?.css}">
      <div class="rb-head"><b class="rb-team">${solo ? 'You' : 'Your squad'}</b><b class="rb-pts">${ORDINAL(myPlace)}</b>
        <span>K</span><span title="Downs">Dn</span><span title="Revives">Rv</span><span title="Damage">Dmg</span><span class="wide">Alive</span></div>
      ${mates.map((p, i) => { const st = brStat(p); return `<div class="rb-row${p.id === data.localId ? ' me' : ''}" style="--i:${i}">
        <span class="rb-name">${badgeTag(badgeOf(p.id), 14)}<b>${nameHtml(p.name)}</b></span><span>${p.kills}</span><span>${st[2]}</span><span>${st[1]}</span><span>${st[0]}</span><span class="wide">${mmss(st[4])}</span>
      </div>`; }).join('')}
    </div>`;
  };
  // A squad's names; a clan squad wears its tag once, before them all.
  const squadNames = ms => {
    const tags = ms.map(p => /^\[([A-Z]{2,4})\] /.exec(p.name)?.[1] ?? null);
    if (ms.length > 1 && tags[0] && tags.every(t => t === tags[0])) return `<i class="ctag">${tags[0]}</i> ${ms.map(p => esc(p.name.slice(tags[0].length + 3))).join(', ')}`;
    return ms.map(p => nameHtml(p.name)).join(', ');
  };
  const brSquads = () => {
    const rows = squadTeams.map(t => {
      const ms = roster.filter(p => p.team === t);
      const placed = ms.reduce((m, p) => Math.max(m, p.place || 0), 0);
      // Left early (data.early): squads not out yet are still playing, listed first.
      const live = !!data.early && !placed && t !== myTeam;
      const place = placed || (live ? 0 : t === (outcome === 'win' ? myTeam : null) ? 1 : squadTeams.length);
      return { t, ms, place, live, kills: ms.reduce((n, p) => n + p.kills, 0) };
    }).sort((a, b) => a.place - b.place);
    let shownRows = rows.slice(0, BOARD_ROWS - 1);
    const mine = rows.find(r => r.t === myTeam);
    if (mine && !shownRows.includes(mine)) shownRows = [...rows.slice(0, BOARD_ROWS - 2), mine];
    return `<div class="rb theirs" style="--team:var(--c-gold)">
      <div class="rb-head"><b class="rb-team">${solo ? 'Standings' : 'Squads'}</b><b class="rb-pts"></b>
        <span></span><span></span><span></span><span>K</span><span class="wide">Place</span></div>
      ${shownRows.map((r, i) => `<div class="rb-row${r.t === myTeam ? ' me' : ''}" style="--i:${i}">
        <span class="rb-name" style="grid-column:span 4"><i style="flex:none;width:7px;height:7px;background:${TEAMS[r.t]?.css}"></i><b>${squadNames(r.ms)}</b></span><span>${r.kills}</span><span class="wide">${r.live ? 'In' : ORDINAL(r.place)}</span>
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
          <span style="text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${TEAMS[p.team]?.css}">${badgeTag(badgeOf(p.id), 12)}<b style="font-weight:400">${nameHtml(p.name)}</b></span>
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
        <span>K</span><span>D</span><span>A</span><span>${gun ? 'Gun' : ownCol ? ownCol.head : 'HS'}</span><span class="wide">${gun ? 'Score' : 'Kills'}</span></div>
      ${rows.map(([p, n], i) => `<div class="rb-row${p.id === data.localId ? ' me' : ''}${p.id === mvp?.id ? ' mvp' : ''}" style="--i:${i}">
        <span class="rb-name"><u style="text-decoration:none;min-width:2.3ch;color:var(--c-haze)">${ORDINAL(n)}</u><i style="flex:none;width:7px;height:7px;background:${TEAMS[p.team]?.css}"></i>${badgeTag(badgeOf(p.id), 14)}<b>${nameHtml(p.name)}</b></span><span>${p.kills}</span><span>${p.deaths}</span><span>${p.assists ?? 0}</span><span>${gun ? Math.min(GUN_LADDER.length, scoreOf(p) + 1) : ownCol ? ownCol.stat(p) : p.head ?? 0}</span><span class="wide">${gun ? matchScore(p) : scoreOf(p)}</span>
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
        <span class="rb-name">${badgeTag(badgeOf(p.id), 14)}<b>${nameHtml(p.name)}</b>${p.id === mvp?.id ? `<i class="rb-star">${art('ui:star', 11)}</i>` : ''}</span><span>${p.kills}</span><span>${p.deaths}</span><span>${p.assists ?? 0}</span><span>${modeStat(p)}</span><span class="wide">${matchScore(p)}</span>
      </div>`).join('')}
      ${rest ? `<div class="rb-row" style="--i:${rows.length}"><span class="rb-name"><b>+${rest} more</b></span></div>` : ''}
    </div>`;
  };

  const lp = level ?? { before: 1, after: 1, level: 1, into: 0, span: 1, maxed: false, prestige: 0 };
  // Master Prestige (docs/PRESTIGE.md): a Master before the match fills the Master bar ("M 137") instead of the level's.
  const master = lp.master > 0 && lp.masterBefore > 0 && lp.mp ? { ...lp.mp, before: lp.masterBefore } : null;
  const startLevel = master ? master.before : lp.before ?? lp.level;
  const xpFrom = master ? beforeState(MASTER_CURVE, MASTER_CURVE.floor(master.level) + (master.maxed ? 0 : master.into), xp?.total ?? 0, startLevel)
    : beforeState(PLAYER_CURVE, totalPlayerXp(lp), xp?.total ?? 0, startLevel);
  const barNow = master ?? lp;
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
  const modeName = playlistName(data.modeId ?? data.mode, data.mods ?? []) || (MODES[data.modeId ?? data.mode]?.name ?? '');
  // Search and Destroy: one chip per round in the order played, in the colour of the side that took it, marked with
  // how (wipe, detonation, defuse, time). data.snd is the match's final S&D state when the match passes it on.
  const ROUND_ICON = { elim: 'ui:skull', bomb: 'bomb', defuse: 'medal:defuse', time: 'ui:clock' };
  const ROUND_WORD = { elim: 'Eliminated', bomb: 'Detonated', defuse: 'Defused', time: 'Time' };
  const history = rules === 'snd' ? data.snd?.history ?? [] : [];
  const roundStrip = history.length ? `<span class="rs-rounds" style="display:inline-flex;gap:2px;margin-left:8px;vertical-align:middle">${history.map((h, i) =>
    `<i title="Round ${i + 1}: ${ROUND_WORD[h.reason] ?? ''}" style="width:14px;height:14px;display:grid;place-items:center;line-height:0;color:#fff;--icon-accent:currentColor;background:${TEAMS[h.winner]?.css};box-shadow:inset 0 -2px 0 rgba(0,0,0,.35);opacity:${h.winner === myTeam ? 1 : 0.75}">${art(ROUND_ICON[h.reason], 10)}</i>`).join('')}</span>` : '';
  // Challenges and Pro challenges get a card of their own, so Rematch and Menu always keep their column. A single row
  // would leave that card nearly empty, so one row sits over the buttons instead, where it fits on every phone.
  // Mastery tracks that moved: main.js may pass them as data.mastery; MatchAwards also leaves them with Progress.
  const mastery = data.mastery ?? Progress.lastMastery();
  // Every row is shown: the card scrolls natively when they outgrow it. Calling cards closest to done come last.
  const reach = data.challenges?.length || data.proProgress?.length || mastery?.length ? cardsInReach(3) : [];
  // Seasons (js/ui/season.js): the track's tier move and the rank's, first.
  const progress = seasonStrip(data.season, data.ranked) + challengeStrip(data.challenges, Infinity) + proProgressHtml(data.proProgress, Infinity) + masteryStrip(mastery, Infinity) + cardsStrip(reach);
  const progressRows = (data.season ? 2 : 0) + (data.ranked ? 1 : 0) + (data.challenges?.length ?? 0) + (data.proProgress?.length ?? 0) + (mastery?.length ?? 0) + reach.length;
  const progCard = progressRows > 1;

  menu.el.innerHTML = `
    <div class="rs" data-outcome="${outcome}" style="--tone:${tone}">
      <div class="rs-top">
        <div class="rs-word"><h2>${esc(word)}</h2><small>${esc(modeName)}${roundStrip}</small></div>
        ${sc.kind === 'one' ? `<span class="rs-score rs-round" data-kind="one"><small>${esc(sc.label)}</small><u class="rs-mine" style="color:${mineCss}">${typeof mineNum === 'number' ? 0 : esc(mineNum)}</u></span>`
          : sc.kind === 'pair' ? `<span class="rs-score" data-kind="pair"><u class="rs-mine" style="color:${mineCss}">0</u><i></i><u class="rs-them" style="color:${themCss}">0</u></span>` : ''}
        ${mvpCard}
        <button class="rs-btn quiet res-skip" data-act="resSkip">Skip</button>
      </div>
      <div class="rb-pair">${zmr ? zmCrew() + zmRecord() : exr ? exSquad() + exRewards() : br ? brSquad() + brSquads() : ffa ? podium() + standings() : board(myTeam, 'ours') + board(1 - myTeam, 'theirs')}</div>
      <div class="rs-cards${progCard ? ' has-prog' : ''}">
        <div class="rs-card finalcard${fk ? '' : ' none'}">
          <div class="fk-canvas"></div>
          <div class="fk-cap">${fk ? `<small>Final kill</small><b>${esc(fk.byName)}</b><span>on ${esc(fk.targetName)}</span><em>${art(fk.weapon, 10)}${esc(WEAPONS[fk.weapon]?.name ?? fk.weapon)}</em>` : zmr && data.zm?.escaped ? `<small>Escaped</small><span>Out on the exfil on round ${data.zm.escaped}</span>` : '<small>Final kill</small><span>The match ended without one</span>'}</div>
        </div>
        <div class="rs-card xp-card">
          <div class="xp-head"><b class="xp-sum">+<u class="xp-total">0</u><small>XP</small></b><span class="xp-lv">${badgeMark(lp.prestige ?? 0, 22, lp.masterBefore ?? 0)}<b class="xp-lvn">${master ? 'M' : 'Lv'} ${startLevel}</b></span></div>
          <div class="xp-lines scroll-y">${(xp?.lines ?? []).map(([label, amount], i) => `<div class="xp-row" style="--i:${i}"><span>${esc(label)}</span><b>+${amount}</b></div>`).join('') || '<small class="empty">No XP this time</small>'}</div>
          <i class="rs-bar big"><i class="rs-fill xp-player" style="transform:scaleX(0)"></i></i>
          <small class="xp-next">${barNow.maxed ? 'Maximum level' : `${Math.round(barNow.into)} / ${barNow.span} to ${master ? 'Master' : 'Lv'} ${barNow.level + 1}`}</small>
          ${lp.canPrestige ? '<small class="res-prestige">Prestige available</small>' : ''}
        </div>
        <div class="rs-card wp-card">
          <h4>Weapons</h4>
          ${weapons.length ? `<div class="wp-list">${weapons.map(weaponRow).join('')}</div>` : '<small class="empty">No weapon kills this match</small>'}
        </div>
        ${progCard ? `<div class="rs-card prog-card scroll-y">${progress}</div>` : ''}
        <div class="res-choice">
          ${progCard ? '' : progress}
          <button class="rs-btn primary rs-again" data-act="resRematch"${data.rematchSub ? ` aria-label="${esc(`${data.rematchLabel}: ${data.rematchSub}`)}"` : ''}><span class="rs-again-tx"><b>${esc(data.rematchLabel)}</b>${data.rematchSub ? `<small>${esc(data.rematchSub)}</small>` : ''}</span></button>
          <button class="rs-btn" data-act="resMenu">Menu</button>
          <p class="res-note">${esc(data.note ?? '')}</p>
        </div>
      </div>
      <div class="rs-hero" data-act="resHero">
        <i class="rs-hero-band"></i>
        <h1>${esc(word)}</h1>
        ${sc.kind === 'one' ? `<p class="rs-hero-score"><small>${esc(sc.label)}</small><u style="color:${mineCss}">${esc(mineNum)}</u></p>`
          : sc.kind === 'pair' ? `<p class="rs-hero-score"><u style="color:${mineCss}">${mineNum}</u><i></i><u style="color:${themCss}">${themNum}</u></p>` : ''}
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
  runReel(menu, reel, { lp, master, xpFrom, weapons, unlocks, mineNum, themNum, xp }).catch(err => {
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

async function runReel(menu, reel, { lp, master, xpFrom, weapons, unlocks, mineNum, themNum, xp }) {
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
  if (typeof mineNum === 'number') rollNumber(q('.rs-mine'), mineNum, { from: 0, duration: 600, onTick: counterTick() });
  if (themNum !== null) rollNumber(q('.rs-them'), themNum, { from: 0, duration: 600 });
  rollNumber(q('.xp-total'), xp?.total ?? 0, { from: 0, duration: 900, delay: 300, onTick: counterTick(1.15) });
  await reel.sleep(520);
  if (reel.dead) return;

  // Player XP, then the level-up moment.
  const bar = q('.xp-player'), label = q('.xp-lvn');
  if (!bar || !label) return;       // The screen was replaced while the reel played.
  bar.style.transform = `scaleX(${xpFrom.frac.toFixed(3)})`;
  const to = master ? { level: master.level, frac: master.maxed ? 1 : master.into / master.span, prefix: 'M' }
    : { level: lp.level, frac: lp.maxed ? 1 : lp.into / lp.span };
  await reel.climb(bar, label, xpFrom, to);
  if (reel.dead) return;
  if (master && master.level > master.before) {
    // A Master level (or several): its own stamp, with the tier's icon.
    q('.xp-card').classList.add('levelled');
    playUi('levelUp');
    await reel.stamp(masterStampHtml(lp.master, lp.masterBefore));
    if (reel.dead) return;
  } else if (!master && lp.master > 0) {
    // This match reached Prestige X level 50: Master Prestige begins, with its reveal.
    q('.xp-card').classList.add('levelled');
    playUi('prestige');
    label.textContent = `M ${lp.master}`;
    await reel.stamp(masterStampHtml(lp.master, 0), STAMP_MS + 600);
    if (reel.dead) return;
  } else if (lp.after > lp.before) {
    q('.xp-card').classList.add('levelled');
    playUi('levelUp');
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
    playUi('unlock');
    await reel.stamp(unlockCard(u), UNLOCK_MS);
    if (reel.dead) return;
  }
  if (reel.dead) return;
  q('.res-skip')?.setAttribute('hidden', '');
  const primary = q('.res-choice .primary');
  if (primary) sweep(primary);
  reel.dead = true;              // Finished: nothing left for a later screen to cancel.
}

// Calling cards still being earned, closest first: a sliver of the card, its name and its progress bar.
function cardsStrip(list) {
  if (!list.length) return '';
  return `<div class="rs-ch rs-cc"><small class="rs-ch-h">${art('ui:flag', 10)}Calling cards</small>${list.map(({ card, progress }) => `
    <div class="rs-cc-row">${cardHtml(card.id, { size: 64, title: '', sub: '', locked: true })}<b>${esc(card.name)}</b>${cardProgressHtml(progress)}</div>`).join('')}</div>`;
}

function unlockCard(u) {
  // Pro perks and calling cards have their own ceremony (js/ui/cards.js), mastery tiers theirs (js/ui/mastery.js).
  const special = rankStamp(u) ?? unlockStamp(u) ?? challengeStamp(u) ?? masteryStamp(u) ?? seasonStamp(u);
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
