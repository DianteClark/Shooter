// The end-of-match screen and its reel: XP fills, level-up ceremony, weapon bars, unlocks one by one.
// All of it is transform and opacity via WAAPI; the reel can be tapped through, and a tap ends the wait in progress.
import { TEAMS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER_CURVE, WEAPON_CURVE, MAX_LEVEL } from '../shared/progression.js';
import { matchScore } from './progress.js';
import { esc, hex, badgeMark, badgeTag, SLOT_LABEL, itemMark } from './widgets.js';
import { kindLabel } from './prestige.js';

const FILL_MS = 520;
const STAMP_MS = 1500;
const UNLOCK_MS = 1050;

const fillFrac = p => (p.maxed ? 1 : p.into / p.span);

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

  fill(el, from, to) {
    const dur = this.fast ? 60 : Math.max(180, FILL_MS * (to - from) * 1.6);
    const a = el.animate(
      [{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }],
      { duration: dur, easing: 'cubic-bezier(.25,.1,.25,1)', fill: 'forwards' },
    );
    this.anims.push(a);
    return a.finished.catch(() => {}).then(() => { this.anims.splice(this.anims.indexOf(a), 1); });
  }

  // Fills across any number of level boundaries. onLevel(n) fires as each new level is reached.
  async climb(bar, label, from, to, onLevel) {
    let level = from.level, frac = from.frac;
    while (level < to.level && !this.dead) {
      await this.fill(bar, frac, 1);
      level++;
      frac = 0;
      label.textContent = `Lv ${level}`;
      onLevel?.(level);
      await this.sleep(70);
    }
    if (!this.dead) await this.fill(bar, frac, to.frac);
  }

  // Full-screen card in the shared overlay. A tap wakes the sleep; the overlay stays until the next step.
  async stamp(html, ms = STAMP_MS) {
    if (this.dead || this.fast) return;
    const m = this.menu;
    m.overlay(`<div class="cer" data-act="reelTap">${html}<small class="cer-tap">Tap to continue</small></div>`);
    m.on({ reelTap: () => this.wake?.() });
    await this.sleep(ms);
    if (!this.dead) m.overlay('');
  }
}

export function resultsScreen(menu, data, { rematch, menu: toMenu }) {
  menu.el.dataset.screen = 'results';
  const { outcome, scores, myTeam, roster, badges, mvp, xp, level, weapons, unlocks, finalKill: fk } = data;
  const badgeOf = id => badges?.get(id) ?? null;
  const board = team => {
    const rows = roster.filter(p => p.team === team).sort((a, b) => matchScore(b) - matchScore(a) || a.deaths - b.deaths);
    return `<div class="rb" style="--team:${TEAMS[team].css}">
      <div class="rb-head"><b class="rb-team">${esc(TEAMS[team].name)}</b><b class="rb-pts">${scores[team]}</b>
        <span>K</span><span>D</span><span>A</span><span>HS</span><span class="wide">Score</span></div>
      ${rows.map(p => `<div class="rb-row${p.id === data.localId ? ' me' : ''}${p.id === mvp?.id ? ' mvp' : ''}">
        <span class="rb-name">${badgeTag(badgeOf(p.id), 14)}<b>${esc(p.name)}</b></span><span>${p.kills}</span><span>${p.deaths}</span><span>${p.assists ?? 0}</span><span>${p.head ?? 0}</span><span class="wide">${matchScore(p)}</span>
      </div>`).join('')}
    </div>`;
  };

  const lp = level ?? { before: 1, after: 1, level: 1, into: 0, span: 1, maxed: false, prestige: 0 };
  const startLevel = lp.before ?? lp.level;
  const xpFrom = beforeState(PLAYER_CURVE, totalPlayerXp(lp), xp?.total ?? 0, startLevel);
  const weaponRow = (w, i) => {
    return `
      <div class="wp" style="--i:${i}">
        <div class="wp-line"><b>${esc(w.name)}</b><span class="wp-lv" data-wl="${i}">Lv ${w.levelBefore}</span><span class="wp-gain">+${w.xpGained} XP</span></div>
        <i class="xp"><i class="xp-fill wp-fill" data-wf="${i}" style="transform:scaleX(0)"></i></i>
        <small data-wn="${i}">${w.maxed ? 'Max level' : `${Math.round(w.into)}/${w.span} to Lv ${w.level + 1}`}</small>
      </div>`;
  };

  menu.el.innerHTML = `
    <div class="res-top enter" data-outcome="${outcome}">
      <h2>${outcome === 'win' ? 'Victory' : outcome === 'loss' ? 'Defeat' : 'Stalemate'}</h2>
      <span class="res-score">${scores[myTeam]}<i>-</i>${scores[1 - myTeam]}</span>
      ${mvp ? `<div class="mvp-tag" style="--team:${TEAMS[mvp.team].css}"><span>MVP</span><b>${esc(mvp.name)}</b><small>${matchScore(mvp)} pts</small></div>` : ''}
      <button class="back res-skip" data-act="resSkip">Skip</button>
    </div>
    <div class="rb-pair enter">${board(myTeam)}${board(1 - myTeam)}</div>
    <div class="res-cards enter">
      <div class="finalcard">
        <div class="fk-canvas"></div>
        <div class="fk-cap">${fk ? `Final kill<br><b>${esc(fk.byName)}</b> on <b>${esc(fk.targetName)}</b><br>${esc(WEAPONS[fk.weapon]?.name ?? fk.weapon)}` : 'No final kill'}</div>
      </div>
      <div class="xp-card">
        <div class="xp-head"><b>+${xp?.total ?? 0} XP</b><span class="xp-lv">${badgeMark(lp.prestige ?? 0, 16)}<b class="xp-lvn">Lv ${startLevel}</b></span></div>
        <div class="xp-lines">${(xp?.lines ?? []).map(([label, amount]) => `<div class="xp-row"><span>${esc(label)}</span><b>+${amount}</b></div>`).join('')}</div>
        <i class="xp big"><i class="xp-fill xp-player" style="transform:scaleX(0)"></i></i>
        ${lp.canPrestige ? '<small class="res-prestige">Prestige available</small>' : ''}
      </div>
      <div class="wp-card">
        <h4>Weapons</h4>
        ${weapons.length ? weapons.map(weaponRow).join('') : '<small>No weapon kills this match</small>'}
      </div>
      <div class="res-choice">
        <button class="route primary" data-act="resRematch"><i class="lamp"></i><b>${esc(data.rematchLabel)}</b></button>
        <button class="route" data-act="resMenu"><i class="lamp"></i><b>Menu</b></button>
        <p class="res-note">${esc(data.note ?? '')}</p>
      </div>
    </div>`;
  menu.on({ resRematch: rematch, resMenu: toMenu });
  if (fk) menu.previewMount(menu.el.querySelector('.fk-canvas'), fk.weapon, fk.camo, undefined);

  // The reel runs over a live screen: Rematch and Menu always work, and leaving kills it.
  const reel = new Reel(menu);
  menu.reel?.cancel();
  menu.reel = reel;
  menu.on({ resSkip: () => { menu.overlay(''); reel.tapThrough(); } });
  runReel(menu, reel, { lp, xpFrom, weapons, unlocks });
  menu.show();
}

function totalPlayerXp(lp) {
  return PLAYER_CURVE.floor(lp.level) + (lp.maxed ? 0 : lp.into);
}

function weaponFrom(w) {
  const total = WEAPON_CURVE.floor(w.level) + (w.maxed ? 0 : w.into);
  return beforeState(WEAPON_CURVE, total, w.xpGained, w.levelBefore);
}

async function runReel(menu, reel, { lp, xpFrom, weapons, unlocks }) {
  const q = sel => menu.el.querySelector(sel);
  await reel.sleep(320);
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
      <div class="cer-rays"></div>
      <div class="cer-emblem"><div class="cer-badge sm">${badgeMark(lp.prestige ?? 0, 96)}</div></div>
      <div class="cer-text"><span class="cer-kick">Level up</span><h2>Level ${lp.level}</h2><p>${lp.level >= MAX_LEVEL ? 'Maximum level. Prestige awaits.' : 'Promotion earned'}</p></div>`);
    if (reel.dead) return;
  }

  // Each weapon bar in turn.
  for (let i = 0; i < weapons.length; i++) {
    const w = weapons[i], fill = q(`[data-wf="${i}"]`), lab = q(`[data-wl="${i}"]`), line = fill?.closest('.wp');
    if (!fill) continue;
    const from = weaponFrom(w);
    fill.style.transform = `scaleX(${from.frac.toFixed(3)})`;
    await reel.climb(fill, lab, from, { level: w.level, frac: w.maxed ? 1 : w.into / w.span }, () => line?.classList.remove('up'));
    if (reel.dead) return;
    if (w.levelAfter > w.levelBefore) line?.classList.add('up');
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
  reel.dead = true;              // Finished: nothing left for a later screen to cancel.
}

function unlockCard(u) {
  const mark = u.kind === 'camo'
    ? `<span class="un-swatch" style="background:${hex(u.colors?.[0] ?? 0x888888)}"></span>`
    : `<span class="un-mark">${itemMark(u.id, u.slot ? SLOT_LABEL[u.slot] : u.name)}</span>`;
  return `
    <div class="cer-rays"></div>
    <div class="un-card">
      ${mark}
      <span class="cer-kick">New ${esc(kindLabel(u.kind))}</span>
      <h2>${esc(u.name)}</h2>
      ${u.weaponName ? `<small>${esc(u.weaponName)}</small>` : ''}
    </div>`;
}
