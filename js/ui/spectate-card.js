// Spectating card (QoL): whenever this phone watches someone else's eyes (js/sim/snd.js spectate: Search and Destroy,
// battle royale and Rebound, Extraction, Control, Showdown, Graveyard Shift bled out), a plate where the weapon panel
// sits (the aim side, which is empty while you are out) names who it is: player, level, operator, the gun in their
// hands with its health bar, their kills and deaths, and this round's kills in round modes. Previous and Next switch
// who; on a controller LB and RB do (js/ui/gamepad.js). It repaints on a key, a few text writes when something changes.
import { WEAPONS } from '../shared/weapons.js';
import { spectate, sndOf } from '../sim/snd.js';
import { getOperator } from './operators.js';
import { icon } from './icons.js';
import { esc, nameHtml, badgeMarkOf, badgeLevel } from './widgets.js';

const CSS = `
.spec-card { position: absolute; right: calc(var(--sr) + 8px); top: var(--arms-y, calc(var(--st) + 48px)); width: clamp(164px, calc(50vw - 152px), 214px); z-index: 2;
  display: grid; grid-template-columns: 40px minmax(0, 1fr) 40px; align-items: stretch; pointer-events: auto;
  background: var(--hud-glass); box-shadow: var(--hud-edge), inset 0 -2px 0 var(--my-team, var(--c-sodium));
  transform: scale(var(--chips-k, 1)); transform-origin: right top; }
.hud.lefty .spec-card { right: auto; left: calc(var(--sl) + 8px); transform-origin: left top; }
.spec-card[hidden] { display: none; }
body.killcam-on .spec-card { visibility: hidden; }     /* The replay is the killer's view, not anyone's to switch. */
.spc-step { display: grid; place-items: center; min-height: 44px; color: var(--c-chalk); font: 400 24px/1 var(--f-stencil); touch-action: manipulation; }
.spc-step:active, .spc-step.pressed { background: rgba(231,234,228,.12); }
.spc-step[disabled] { opacity: .3; }
.spc-mid { min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 5px 2px 6px; }
.spc-kick { font: 9px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-sodium); text-transform: uppercase; }
.spc-who { display: flex; align-items: center; gap: 4px; min-width: 0; }
.spc-who i { flex: none; line-height: 0; }
.spc-who u { flex: none; font: 9px/1 var(--f-plate); color: var(--c-haze); text-decoration: none; }
.spc-who b { min-width: 0; font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.spc-op, .spc-gun, .spc-stats { display: flex; align-items: center; gap: 5px; min-width: 0; font: var(--fs-micro)/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); white-space: nowrap; overflow: hidden; }
.spc-gun { color: var(--c-chalk); }
.spc-gun .gl, .spc-gun svg { flex: none; height: 12px; width: auto; }
.spc-stats b { color: var(--c-chalk); font-weight: 400; }
.spc-hp { position: relative; height: 3px; background: rgba(231,234,228,.15); overflow: hidden; }
.spc-hp i { position: absolute; inset: 0; background: var(--c-go, #4bd18a); transform-origin: left; transform: scaleX(var(--k, 1)); }
`;

// The round a round mode is on (Search and Destroy, Control, Showdown, Graveyard Shift), or null.
function roundOf(view) {
  const snd = sndOf(view);
  if (snd) return snd.round ?? null;
  const o = view?.obj ?? view?.points?.obj;
  if (o && (o.kind === 'ctl' || o.kind === 'gf' || o.zm)) return o.round ?? null;
  return null;
}

export class SpectateCard {
  constructor(hudEl) {
    if (!document.getElementById('spec-card-style')) {
      const st = document.createElement('style');
      st.id = 'spec-card-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = this.el = document.createElement('div');
    el.className = 'spec-card';
    el.hidden = true;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Spectating');
    el.innerHTML = `
      <button class="spc-step spc-prev" type="button" data-tap="1" data-sound="tab" aria-label="Previous player">&lsaquo;</button>
      <div class="spc-mid">
        <small class="spc-kick">Spectating</small>
        <span class="spc-who"><i></i><u></u><b></b></span>
        <span class="spc-op"></span>
        <span class="spc-gun"></span>
        <span class="spc-hp"><i></i></span>
        <span class="spc-stats"></span>
      </div>
      <button class="spc-step spc-next" type="button" data-tap="1" data-sound="tab" aria-label="Next player">&rsaquo;</button>`;
    hudEl.appendChild(el);
    const $ = s => el.querySelector(s);
    this.parts = { badge: $('.spc-who i'), lv: $('.spc-who u'), name: $('.spc-who b'), op: $('.spc-op'), gun: $('.spc-gun'), hp: $('.spc-hp'), stats: $('.spc-stats'), prev: $('.spc-prev'), next: $('.spc-next') };
    this.parts.prev.addEventListener('click', () => this.step(-1));
    this.parts.next.addEventListener('click', () => this.step(1));
    addEventListener('resize', () => { this.placeIn = 3; });     // A rotation or a new size: place again once the HUD has laid out.
    this.reset();
  }

  // roster: the match roster, for operators and badges.
  prepare(roster = []) {
    this.ops = new Map(roster.map(r => [r.id, r.operator ?? r.loadout?.operator ?? null]));
    this.badges = new Map(roster.map(r => [r.id, r.badge ?? null]));
    this.reset();
  }

  reset() {
    this.key = null;
    this.watch = null;
    this.round = null;
    this.atRound = new Map();      // id -> kills when the current round began.
    this.view = null;
    this.placeIn = 0;
    this.el.hidden = true;
  }

  step(dir) {
    if (!this.view) return false;
    const id = spectate.cycle(this.view, this.view.localId, dir);
    this.key = null;
    return !!id;
  }

  get shown() { return !this.el.hidden; }

  // Where the weapon panel would be, unless a death screen row (Next round, the wait plate) reaches across that side
  // on a narrow phone: then just under it. Measured on show and twice a second, never per frame.
  #place() {
    this.placeIn = 30;
    const el = this.el;
    el.style.top = '';
    const row = el.parentElement?.querySelector('.death.show .death-act');
    const a = row?.getBoundingClientRect(), b = el.getBoundingClientRect();
    if (!a || !a.width || !b.width) return;
    if (a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom) el.style.top = `${Math.round(a.bottom - el.parentElement.getBoundingClientRect().top + 6)}px`;
  }

  // Every frame; cheap unless who is watched or what they carry changed.
  update(view, me) {
    this.view = view;
    const watch = me && !me.alive && view.phase !== 'ended' ? spectate.target(view, me.id) : null;
    const p = watch ? view.players.find(q => q.id === watch) : null;
    const round = roundOf(view);
    if (round !== this.round) {
      this.round = round;
      this.atRound.clear();
      for (const q of view.players) this.atRound.set(q.id, q.kills ?? 0);
    }
    if (!p) {
      if (!this.el.hidden) { this.el.hidden = true; this.key = null; }
      return;
    }
    if (--this.placeIn <= 0) this.#place();
    const hp = Math.round(Math.max(0, Math.min(1, (p.hp ?? 100) / (p.maxHp ?? 100))) * 20);
    const roundKills = round !== null ? Math.max(0, (p.kills ?? 0) - (this.atRound.get(p.id) ?? p.kills ?? 0)) : null;
    const key = `${p.id}|${p.weapon}|${p.kills}|${p.deaths}|${hp}|${roundKills}`;
    if (key === this.key) return;
    this.key = key;
    if (this.el.hidden) { this.el.hidden = false; this.#place(); }
    const P = this.parts;
    if (this.watch !== p.id) {
      this.watch = p.id;
      const badge = this.badges?.get(p.id);
      P.badge.innerHTML = badge ? badgeMarkOf(badge, 14) : '';
      P.lv.textContent = badge ? badgeLevel(badge) : '';
      P.name.innerHTML = nameHtml(p.name ?? '');
      const op = this.ops?.get(p.id);
      P.op.innerHTML = op ? `${icon('ui:operator', { size: 10 })}<span>${esc(getOperator(op).name)}</span>` : '';
    }
    P.gun.innerHTML = p.weapon ? `${icon(p.weapon, { size: 12 })}<span>${esc(WEAPONS[p.weapon]?.name ?? '')}</span>` : '';
    P.hp.style.setProperty('--k', (hp / 20).toFixed(2));
    P.stats.innerHTML = `<span><b>${p.kills ?? 0}</b> K</span><span><b>${p.deaths ?? 0}</b> D</span>${roundKills !== null ? `<span title="Kills this round">Round <b>${roundKills}</b></span>` : ''}`;
  }
}
