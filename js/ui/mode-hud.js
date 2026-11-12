// The modes overhaul's HUD layer (docs/MODES.md): Headquarters, Kill Order, Infected, One in the Chamber, Control and
// Grind. The ordinary HUD owns one and calls it from a few hooks (prepare, update, onEvent, drawMini, meter, stat), the
// way it calls the battle royale layer. Zones (the HQ, Control's two, Grind's banks) are drawn by the ordinary objective
// chips, markers and renderer through the mode's `look`; this adds what those cannot say:
//
//   status   one plate under the scorebar: the mode's state in a few words and a number or two
//   wait     on the death screen, why there is no respawn (the HQ stands, no lives left) and what ends the wait
//   tags     VIP crowns over both VIPs (Kill Order), the carried tag count over your head (Grind)
//   minimap  VIPs always, the next HQ site, the Infected's prey
import { MODES, modeRules } from '../shared/modes.js';
import { MODS } from '../shared/playlist.js';
import { TEAMS } from '../shared/constants.js';
import { objOf } from '../sim/rules.js';
import { spectate } from '../sim/snd.js';
import { icon } from './icons.js';
import { esc } from './widgets.js';

const RULES = new Set(['hq', 'ko', 'inf', 'oic', 'ctl', 'grind']);
const clock = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const MARK_Y = 2.6;          // Metres above the ground a head tag floats.

const CSS = `
.mh-ui { position: absolute; inset: 0; pointer-events: none; }
.mh-status { position: absolute; left: 50%; top: calc(var(--st) + 43px); transform: translateX(-50%); display: flex; align-items: center; gap: 8px;
  min-height: 30px; padding: 3px 12px 3px 8px; background: var(--hud-glass, rgba(16,20,26,.78)); box-shadow: var(--hud-edge);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); white-space: nowrap; }
.mh-status[hidden], .mh-wait[hidden], .mh-tag[hidden], .mh-mods[hidden] { display: none; }
.mh-status .mh-ico { display: grid; place-items: center; width: 24px; height: 24px; color: var(--mh-accent, var(--c-sodium)); }
.mh-status .mh-txt { display: flex; flex-direction: column; gap: 2px; }
.mh-status b { font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); }
.mh-status small { font: 10px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); }
.mh-status .mh-num { font: 400 20px/1 var(--f-stencil); color: var(--mh-accent, var(--c-sodium)); font-variant-numeric: tabular-nums; margin-left: 4px; }
.mh-status .mh-bar { width: 64px; height: 4px; background: rgba(231,234,228,.15); position: relative; overflow: hidden; }
.mh-status .mh-bar i { position: absolute; inset: 0; background: var(--mh-accent, var(--c-sodium)); transform-origin: left; transform: scaleX(var(--k, 0)); }
.mh-status[data-side="mine"] { --mh-accent: var(--c-blue-hi, #6cc4ff); box-shadow: var(--hud-edge), inset 0 -2px 0 var(--c-blue, #38b6ff); }
.mh-status[data-side="enemy"] { --mh-accent: #ff8a7c; box-shadow: var(--hud-edge), inset 0 -2px 0 var(--c-red, #ff4d3d); }
.mh-status[data-side="alert"] { --mh-accent: var(--c-sodium); box-shadow: var(--hud-edge), inset 0 -2px 0 var(--c-sodium); }
.mh-lives { display: flex; gap: 3px; margin-left: 2px; }
.mh-lives i { width: 8px; height: 12px; background: rgba(231,234,228,.18); clip-path: polygon(50% 0, 100% 30%, 100% 100%, 0 100%, 0 30%); }
.mh-lives i.on { background: var(--mh-accent, var(--c-sodium)); }
.mh-wait { flex: none; max-width: 330px; padding: 7px 16px 8px; text-align: center;
  background: rgba(16,20,26,.88); box-shadow: var(--hud-edge), inset 0 2px 0 var(--c-sodium); clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); z-index: 2; }
.mh-wait b { display: block; font: 400 18px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-sodium); }
.mh-wait small { display: block; margin-top: 4px; font: 11px/1.2 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); }
.mh-tag { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.mh-tag span { position: absolute; left: -22px; top: -30px; width: 44px; display: flex; flex-direction: column; align-items: center; gap: 1px;
  font: 400 11px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #fff; text-shadow: 0 1px 2px #000; }
.mh-tag .ico { filter: drop-shadow(0 1px 1px #000); }
.mh-tag.mine { color: var(--c-blue-hi, #6cc4ff); }
.mh-tag.enemy { color: #ff7a6a; }
.mh-tag.carry span { color: var(--c-sodium); }
.mh-mods { position: absolute; left: calc(50% + 184px); top: calc(var(--st) + 10px); display: flex; gap: 3px; }
.mh-mods i { font: 400 10px/1 var(--f-stencil); font-style: normal; letter-spacing: var(--tr-stencil); padding: 3px 5px; color: var(--c-night); background: var(--c-sodium);
  clip-path: polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%); }
.hud.hc-on .minimap { display: none !important; }
.hud.mh-on .ctf-status, .hud.mh-on .obj-strip { display: none !important; }
/* Held off the field: the wait plate takes the Respawn row, and the respawn clock (which is not running) goes. */
.hud.mh-held .death-next, .hud.mh-held .death-go, .hud.mh-held .death-timer { display: none !important; }
/* Control, out of lives: the death screen steps aside for the player being watched; the wait plate cycles who. */
.hud.mh-watch .death { background: none; }
.hud.mh-watch .death-top { display: none !important; }
.hud.mh-watch .mh-wait { pointer-events: auto; cursor: pointer; }
/* A mode that deals everyone's kit has no loadout to pick for the next life. */
.hud.mh-dealt .death-next { display: none !important; }
`;

export class ModeHud {
  constructor(hud) {
    this.hud = hud;
    this.on = false;
    this.rules = null;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = this.el = document.createElement('div');
    el.className = 'mh-ui';
    el.innerHTML = `
      <div class="mh-status" hidden><i class="mh-ico"></i><span class="mh-txt"><b></b><small></small></span><span class="mh-extra"></span></div>
      <div class="mh-wait" hidden><b></b><small></small></div>
      <div class="mh-mods" hidden></div>
      ${'<div class="mh-tag" hidden><span></span></div>'.repeat(3)}`;
    hud.el.appendChild(el);
    this.status = el.querySelector('.mh-status');
    this.sIco = this.status.querySelector('.mh-ico');
    this.sWord = this.status.querySelector('b');
    this.sSub = this.status.querySelector('small');
    this.sExtra = this.status.querySelector('.mh-extra');
    this.wait = el.querySelector('.mh-wait');
    // The wait plate lives in the death screen's action row, where Respawn would be.
    hud.el.querySelector('.death-act')?.prepend(this.wait);
    this.wait.addEventListener('click', e => {
      if (!this.watching || !this.view) return;
      e.stopPropagation();
      spectate.cycle(this.view, this.view.localId, 1);
      this.cache.wait = null;
    });
    this.mods = el.querySelector('.mh-mods');
    this.tags = [...el.querySelectorAll('.mh-tag')].map(root => ({ root, span: root.querySelector('span'), html: '', x: NaN, y: NaN, cls: '' }));
    this.cache = {};
  }

  prepare(mode, mods = []) {
    this.modeId = mode;
    this.rules = modeRules(mode);
    this.on = RULES.has(this.rules);
    this.cache = {};
    this.status.hidden = true;
    this.wait.hidden = true;
    for (const t of this.tags) t.root.hidden = true;
    this.hud.el.classList.toggle('mh-on', this.on);
    this.hud.el.classList.toggle('mh-dealt', this.rules === 'oic' || this.rules === 'inf');
    this.hud.el.classList.remove('mh-held', 'mh-watch');
    this.watching = false;
    this.hud.el.classList.toggle('hc-on', mods.includes('hardcore'));
    // The match's modifiers, as small plates in the top corner, for the whole match.
    this.mods.hidden = !mods.length;
    this.mods.innerHTML = mods.map(id => `<i title="${esc(MODS[id]?.name ?? id)}">${esc(MODS[id]?.short ?? id)}</i>`).join('');
  }

  // One line of state, painted only when its text changes.
  #paint(key, { ico, word, sub = '', side = '', extra = '' }) {
    const c = this.cache;
    if (c.status === key) return;
    c.status = key;
    this.status.hidden = !word;
    if (!word) return;
    if (c.ico !== ico) { c.ico = ico; this.sIco.innerHTML = icon(ico, { size: 20 }); }
    this.sWord.textContent = word;
    this.sSub.textContent = sub;
    this.sSub.hidden = !sub;
    this.status.dataset.side = side;
    if (c.extra !== extra) { c.extra = extra; this.sExtra.innerHTML = extra; }
  }

  #waitFor(text, sub) {
    const key = text ? `${text}|${sub}` : '';
    if (this.cache.wait === key) return;
    this.cache.wait = key;
    this.wait.hidden = !text;
    this.hud.el.classList.toggle('mh-held', !!text);
    if (text) { this.wait.querySelector('b').textContent = text; this.wait.querySelector('small').textContent = sub; }
  }

  update(view, me) {
    if (!this.on) return;
    const o = objOf(view);
    const intro = this.hud.introOn || view.phase === 'ended';
    if (!o || intro) { this.#paint('', {}); this.#waitFor(''); this.#hideTags(); this.hud.el.classList.remove('mh-watch'); this.watching = false; return; }
    const fn = this[`_${this.rules}`];
    fn?.call(this, view, me, o);
    // Dead, the death screen and the wait plate do the talking.
    const hide = !me.alive && view.phase === 'live';
    if (this.cache.hid !== hide) { this.cache.hid = hide; this.status.style.visibility = hide ? 'hidden' : ''; }
  }

  // ---- Per mode ----

  _hq(view, me, o) {
    const mine = o.owner === me.team, held = o.phase === 'held';
    const pct = Math.round(o.progress * 100);
    const bar = `<span class="mh-bar" style="--k:${o.progress.toFixed(2)}"><i></i></span>`;
    if (o.phase === 'gap') this.#paint(`gap${Math.ceil(o.t)}`, { ico: 'ui:signal', word: 'Next HQ', sub: 'Moving to a new site', side: 'alert', extra: `<span class="mh-num">${Math.ceil(o.t)}</span>` });
    else if (o.phase === 'capture') {
      const who = o.by < 0 ? '' : o.by === me.team ? 'mine' : 'enemy';
      this.#paint(`cap${who}${pct}`, { ico: 'ui:flag', word: o.by < 0 || !pct ? 'Capture the HQ' : who === 'mine' ? 'Capturing HQ' : 'Enemy capturing', sub: 'Holders cannot respawn', side: who, extra: pct ? bar : '' });
    } else {
      const dz = o.by >= 0 && o.progress > 0.005;
      this.#paint(`held${mine}${dz ? pct : -1}${Math.ceil(o.t)}`, {
        ico: mine ? 'ui:lock' : 'ui:warning', word: mine ? (dz ? 'HQ under attack' : 'Defend your HQ') : (dz ? 'Destroying HQ' : 'Destroy their HQ'),
        sub: mine ? 'No respawns while it stands' : 'They cannot respawn', side: mine ? 'mine' : 'enemy',
        extra: dz ? bar : `<span class="mh-num">${clock(o.t)}</span>`,
      });
    }
    this.#waitFor(!me.alive && held && mine ? 'HQ standing' : '', `No respawn until it falls, or it moves in ${clock(o.t)}`);
    this.#hideTags();
  }

  _ko(view, me, o) {
    const mine = o.vip[me.team], theirs = o.vip[1 - me.team];
    const name = id => view.players.find(p => p.id === id)?.name ?? '...';
    if (mine === me.id) this.#paint(`me${theirs}`, { ico: 'ui:crown', word: 'You are the VIP', sub: 'Stay alive. Your team guards you', side: 'alert' });
    else this.#paint(`${mine}${theirs}`, { ico: 'ui:crown', word: `Kill ${name(theirs)}`, sub: `Guard ${name(mine)}`, side: 'enemy' });
    this.#waitFor('');
    let k = 0;
    for (let t = 0; t < 2; t++) {
      const p = view.players.find(q => q.id === o.vip[t]);
      if (!p || !p.alive || p.id === me.id) continue;
      this.#tag(k++, p.x, p.z, t === me.team ? 'mine' : 'enemy', `${icon('ui:crown', { size: 16 })}VIP`);
    }
    this.#hideTags(k);
  }

  _inf(view, me, o) {
    if (!o.started) { this.#paint('wait', { ico: 'ui:skull', word: 'Infection incoming', sub: 'One of you will turn when it starts', side: 'alert' }); return; }
    const infected = me.team === 1;
    const left = view.players.filter(p => p.team === 0 && !p.away).length;
    if (infected) this.#paint(`i${left}`, { ico: 'ui:skull', word: 'Infected', sub: 'Spread it. Blades and Shivs', side: 'enemy', extra: `<span class="mh-num">${left}</span><small>&nbsp;left</small>` });
    else this.#paint(`s${left}${o.last === me.id}`, { ico: 'ui:user', word: o.last === me.id ? 'Last survivor' : 'Survive', sub: 'Die and you turn', side: o.last === me.id ? 'alert' : 'mine', extra: `<span class="mh-num">${left}</span><small>&nbsp;alive</small>` });
    this.#waitFor('');
    this.#hideTags();
  }

  _oic(view, me, o) {
    const lives = me.oicLives ?? o.lives;
    const pips = `<span class="mh-lives">${Array.from({ length: o.lives }, (_, i) => `<i class="${i < lives ? 'on' : ''}"></i>`).join('')}</span>`;
    this.#paint(`${lives}${o.field}`, { ico: 'ui:aim', word: lives ? `${o.field} in the field` : 'Out', sub: 'One round. A kill gives it back', side: lives === 1 ? 'alert' : '', extra: pips });
    this.#waitFor(!me.alive && lives === 0 ? 'Out of lives' : '', `${o.field} still fighting. Last one standing wins.`);
    this.#hideTags();
  }

  _ctl(view, me, o) {
    const att = o.attackers === me.team;
    const mine = o.lives[me.team], theirs = o.lives[1 - me.team];
    const word = o.state === 'freeze' ? `Round ${o.round}: ${att ? 'Attack' : 'Defend'}` : o.state === 'post' ? `Round ${o.round} over` : o.overtime ? 'Overtime' : att ? 'Take both zones' : 'Hold both zones';
    this.#paint(`${o.state}${o.round}${mine}${theirs}${o.overtime}`, {
      ico: att ? 'ui:flag' : 'ui:lock', word, sub: `Lives ${mine} / theirs ${theirs}`, side: o.overtime ? 'alert' : att ? 'enemy' : 'mine',
      extra: `<span class="mh-num">${mine}</span>`,
    });
    // Out of lives: watch whoever is still up (spectate.ctlOut), teammates first; a tap on the plate switches.
    const out = !me.alive && o.state === 'live' && mine <= 0;
    const watch = out ? spectate.target(view, me.id) : null;
    const w = watch && view.players.find(p => p.id === watch);
    this.view = view;
    this.watching = !!w;
    this.hud.el.classList.toggle('mh-watch', !!w);
    this.#waitFor(!out ? '' : w ? `Watching ${w.name}` : 'No lives left',
      w ? `${w.team === me.team ? 'Teammate' : 'Enemy'} · out of respawns this round · tap to switch` : 'Your team is out of respawns this round.');
    this.#hideTags();
  }

  _grind(view, me, o) {
    const n = me.carry ?? 0;
    this.#paint(`g${n}`, n
      ? { ico: 'ui:save', word: `Carrying ${n} ${n === 1 ? 'tag' : 'tags'}`, sub: 'Bank them at A or B', side: 'alert', extra: `<span class="mh-num">${n}</span>` }
      : { ico: 'ui:save', word: 'Grab tags', sub: 'Carry them to a bank to score', side: '' });
    this.#waitFor('');
    this.#hideTags();
  }

  // ---- Head tags, projected like the objective markers ----
  #tag(k, x, z, cls, html) {
    const t = this.tags[k], cam = this.hud.camera;
    if (!t || !cam) return;
    const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
    const vx = v[0] * x + v[4] * MARK_Y + v[8] * z + v[12], vy = v[1] * x + v[5] * MARK_Y + v[9] * z + v[13], vz = v[2] * x + v[6] * MARK_Y + v[10] * z + v[14];
    const w = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
    if (w <= 0.01) { t.root.hidden = true; return; }
    const W = this.hud.viewW, H = this.hud.viewH;
    const sx = Math.round(((p[0] * vx + p[8] * vz + p[12]) / w * 0.5 + 0.5) * W), sy = Math.round((0.5 - (p[5] * vy + p[9] * vz + p[13]) / w * 0.5) * H);
    const off = sx < 10 || sx > W - 10 || sy < 30 || sy > H - 10;
    t.root.hidden = off;
    if (off) return;
    if (t.cls !== cls) { t.cls = cls; t.root.className = `mh-tag ${cls}`; }
    if (t.html !== html) { t.html = html; t.span.innerHTML = html; }
    if (sx !== t.x || sy !== t.y) { t.x = sx; t.y = sy; t.root.style.transform = `translate3d(${sx}px,${sy}px,0)`; }
  }
  #hideTags(from = 0) { for (let i = from; i < this.tags.length; i++) if (!this.tags[i].root.hidden) this.tags[i].root.hidden = true; }

  // ---- Events: banners and feed lines ----
  onEvent(e, view) {
    if (!this.on || !view) return;
    const hud = this.hud, me = view.players?.find(p => p.id === view.localId);
    if (!me) return;
    const name = id => esc(view.players.find(p => p.id === id)?.name ?? '');
    const ours = t => t === me.team;
    switch (e.t) {
      case 'hq':
        if (e.kind === 'live') hud.banner('HQ Online', 'Capture it. Holders cannot respawn', 1500);
        else if (e.kind === 'capture') hud.banner(ours(e.team) ? 'HQ Captured' : 'Enemy HQ', ours(e.team) ? 'Hold it: no respawns while it stands' : 'Destroy it: they cannot respawn', 1700, ours(e.team) ? 'mine' : 'enemy');
        else if (e.kind === 'destroy') hud.banner('HQ Destroyed', ours(e.by) ? 'Their team is back in' : 'Your team is back in', 1500, ours(e.by) ? 'mine' : 'enemy');
        else if (e.kind === 'expire') hud.banner('HQ Relocating', 'Everyone is back in', 1300);
        break;
      case 'ko':
        if (e.kind === 'vip' && e.id === me.id) hud.banner('You are the VIP', 'Every enemy can see you. Stay with your team', 2000, 'mine');
        else if (e.kind === 'kill') {
          if (e.by) hud.pushFeed(`<span class="f-note">${icon('ui:crown', { size: 13 })} ${name(e.by)} killed the VIP ${name(e.id)}</span>`, e.by === me.id, ours(e.team) ? 'enemy' : 'mine');
          if (!ours(e.team)) hud.banner('VIP Down', '+1 for your team', 1100, 'mine');
        }
        break;
      case 'inf':
        if (e.kind === 'first') hud.banner(e.id === me.id ? 'You are Infected' : 'Infection Started', e.id === me.id ? 'Turn them all before the clock runs out' : `${name(e.id)} turned. Do not let them reach you`, 2200, e.id === me.id ? 'enemy' : '');
        else if (e.kind === 'infected') {
          hud.pushFeed(`<span class="f-note">${icon('ui:skull', { size: 13 })} ${name(e.id)} was infected</span>`, e.id === me.id, 'enemy');
          if (e.id === me.id) hud.banner('Infected', 'Now hunt the survivors', 1800, 'enemy');
        } else if (e.kind === 'last') hud.banner(e.id === me.id ? 'Last Survivor' : 'One Left', e.id === me.id ? 'Hold out until the clock runs out' : `Find ${name(e.id)}`, 1800, 'alert');
        break;
      case 'oic':
        if (e.kind === 'out') {
          hud.pushFeed(`<span class="f-note">${name(e.id)} is out</span>`, e.id === me.id);
          if (e.id === me.id) hud.banner('Out of Lives', 'Watch the rest play it out', 1800, 'enemy');
        } else if (e.kind === 'last') hud.banner(`${e.n} Left`, 'Last one standing wins', 1300, 'alert');
        break;
      case 'ammo':
        if (e.id === me.id && modeRules(this.modeId) === 'oic') hud.banner('Round Back', 'A kill refills the chamber', 800, 'mine');
        break;
      case 'ctl': {
        const o = objOf(view), att = o && o.attackers === me.team;
        if (e.kind === 'round') hud.banner(`Round ${e.round}`, `${e.attackers === me.team ? 'Attack: take both zones' : 'Defend: hold both zones'}. ${e.lives} lives`, 2200);
        else if (e.kind === 'capture') hud.banner(`${e.id} Taken`, ours(e.team) ? 'One zone down' : 'Hold the other one', 1400, ours(e.team) ? 'mine' : 'enemy');
        else if (e.kind === 'end') hud.banner(ours(e.winner) ? 'Round Won' : 'Round Lost', { capture: 'Both zones taken', elim: 'Out of lives', time: 'Time ran out' }[e.reason] ?? '', 2000, ours(e.winner) ? 'mine' : 'enemy');
        else if (e.kind === 'lives') hud.banner(ours(e.team) ? `${e.left} Lives Left` : `They have ${e.left} lives`, ours(e.team) ? 'Make them count' : 'Finish them', 1300, ours(e.team) ? 'enemy' : 'mine');
        else if (e.kind === 'overtime') hud.banner('Overtime', att ? 'Stay on the zone' : 'Get them off the zone', 1300, 'alert');
        break;
      }
      case 'grind':
        if (e.kind === 'bank' && e.id === me.id) hud.banner(`Banked ${e.n}`, `+${e.n} for your team`, 1100, 'mine');
        else if (e.kind === 'bank') hud.pushFeed(`<span class="f-note">${name(e.id)} banked ${e.n}</span>`, false, view.players.find(p => p.id === e.id)?.team === me.team ? 'mine' : 'enemy');
        break;
      default: break;
    }
  }

  // ---- The objective meter (standing in a zone) in this mode's words. Returns [text, fraction, side] or null. ----
  meter(view, me, pt) {
    const o = objOf(view);
    if (!this.on || !o) return null;
    if (this.rules === 'grind') return (me.carry ?? 0) > 0 ? [pt.contested ? 'Bank blocked' : 'Banking', pt.contested ? 1 : 0.5, pt.contested ? 'contest' : 'mine'] : ['Bank: bring tags', 0, ''];
    if (this.rules === 'hq') {
      if (pt.contested) return ['HQ Contested', o.progress || 1, 'contest'];
      if (o.phase === 'capture') return ['Capturing HQ', o.by === me.team ? o.progress : 0, 'mine'];
      return o.owner === me.team ? ['Holding HQ', 1, 'mine'] : ['Destroying HQ', o.progress, 'mine'];
    }
    if (this.rules === 'ctl') {
      const att = o.attackers === me.team, done = pt.owner === o.attackers;
      if (done) return [`${pt.id} Taken`, 1, att ? 'mine' : 'enemy'];
      if (pt.contested) return [`${pt.id} Contested`, Math.abs(pt.capture) || 1, 'contest'];
      return att ? [`Taking ${pt.id}`, Math.abs(pt.capture), 'mine'] : [`Guarding ${pt.id}`, Math.abs(pt.capture), Math.abs(pt.capture) > 0 ? 'enemy' : 'mine'];
    }
    return null;
  }

  // ---- Scoreboard column ----
  head() { return modeColumn(this.rules)?.head ?? 'HS'; }
  stat(p) { return modeColumn(this.rules)?.stat(p) ?? p.head ?? 0; }

  // ---- Minimap ----
  drawMini(g, view, me, sx, sz, t) {
    const o = objOf(view);
    if (!this.on || !o) return;
    if (this.rules === 'ko') {
      for (let k = 0; k < 2; k++) {
        const p = view.players.find(q => q.id === o.vip[k]);
        if (!p || !p.alive) continue;
        const x = p.x * sx, y = p.z * sz, r = 6 + Math.sin(t * 6) * 1.2;
        g.fillStyle = TEAMS[k === me.team ? me.team : 1 - me.team]?.css ?? '#fff';
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x - r, y + r * 0.6); g.lineTo(x - r, y - r * 0.4); g.lineTo(x - r * 0.4, y); g.lineTo(x, y - r); g.lineTo(x + r * 0.4, y); g.lineTo(x + r, y - r * 0.4); g.lineTo(x + r, y + r * 0.6);
        g.closePath(); g.fill(); g.stroke();
      }
    } else if (this.rules === 'hq' && (o.phase === 'gap' || o.t < 10) && o.nx) {
      // Where the next HQ goes up.
      g.strokeStyle = 'rgba(255,190,70,.8)';
      g.setLineDash([3, 3]);
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(o.nx * sx, o.nz * sz, 7, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    } else if (this.rules === 'inf' && me.team === 1) {
      // The infected sense the survivors: faint pings, sharper the closer.
      g.fillStyle = 'rgba(255,120,100,.55)';
      for (const p of view.players) if (p.team === 0 && p.alive) { g.beginPath(); g.arc(p.x * sx, p.z * sz, 2.5, 0, Math.PI * 2); g.fill(); }
    }
  }

  // What the scorebar says under the clock, where "to <limit>" does not fit the mode. Null keeps the default.
  goal(limit) {
    return { inf: 'survive', oic: 'last alive', ctl: `${limit} rounds`, ko: `${limit} vips` }[this.rules] ?? null;
  }
}

// The scoreboard and results column of each rule set here: its header and each player's number. Null for the others.
const COLUMNS = {
  hq: { head: 'C/D', title: 'HQ captures / destroyed', stat: p => `${p.hqCaps ?? 0}/${p.hqKills ?? 0}` },
  ko: { head: 'VIP', title: 'VIP kills', stat: p => p.vipKills ?? 0 },
  inf: { head: 'Inf', title: 'Infections', stat: p => p.infections ?? 0 },
  oic: { head: 'Lives', title: 'Lives left', stat: p => p.oicLives ?? 0 },
  ctl: { head: 'Cap', title: 'Zones taken', stat: p => p.ctlCaps ?? 0 },
  grind: { head: 'Bank', title: 'Tags banked', stat: p => p.banked ?? 0 },
};
export const modeColumn = rules => COLUMNS[rules] ?? null;
