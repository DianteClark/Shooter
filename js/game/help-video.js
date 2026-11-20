// The help video player (docs/TUTORIAL.md, roadmap 63): a script from js/shared/help-videos.js played in the match
// renderer on the game canvas, over the Help screen (hidden by body.hv-on while it plays). Loaded on demand: Help
// imports this module only when a Play chip is tapped, so nothing here costs a byte or a frame until then.
//
//   const p = new HelpVideoPlayer({ canvas, root, video, quality, onClose });
//   p.close();        // also its own Close (Skip) button, Escape and a controller's B
//
// The match is built by js/game/help-director.js; its lead-in runs a slice per frame behind a loading bar, so the menu
// never freezes. Captions sit at the bottom (aria-live, so a screen reader reads each), sized by Menu text size; a
// controller swaps the touch words for its own button names. Replay rebuilds the same seeded match; Loop replays it
// whenever it ends. Basics videos show ghost thumbs and buttons for what the player would be pressing.
import { GameRenderer } from '../render/renderer.js';
import { MAPS } from '../shared/map.js';
import { TEAMS } from '../shared/constants.js';
import { captionText, fillButtons } from '../shared/help-videos.js';
import { HelpDirector, STAR_ID } from './help-director.js';
import { followable, tacticalFrame, aimShot, FOLLOW_DIST, FOLLOW_FOV, EASE_TACTICAL } from './caster-core.js';
import { Pad, buttonName, bindingOf } from '../ui/gamepad.js';
import { esc } from '../ui/widgets.js';
import { icon } from '../ui/icons.js';
import { Options } from '../ui/options.js';

const PREP_MS = 10;              // Lead-in steps per frame while loading: about a third of a frame on the phone.
const WIDE_DIST = 40, WIDE_FOV = 28;

const CSS = `
body.hv-on #ui > .menu, body.hv-on #ui > .overlay { visibility: hidden; }
#ui .hv { position: absolute; inset: 0; z-index: var(--z-overlay); pointer-events: none; color: var(--c-chalk); font-family: var(--f-body); }
#ui .hv > * { pointer-events: auto; }
#ui .hv .hv-names, #ui .hv .hv-ghost { pointer-events: none; }
#ui .hv-top { position: absolute; left: calc(var(--env-l, 0px) + 12px); right: calc(var(--env-r, 0px) + 12px); top: calc(var(--env-t, 0px) + 10px); display: flex; align-items: center; gap: 8px; pointer-events: none; }
#ui .hv-top > * { pointer-events: auto; }
#ui .hv-tag { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 12px 6px 10px; background: rgba(16,20,26,.84); box-shadow: var(--hud-edge, inset 0 0 0 1px rgba(255,255,255,.12));
  --cut: var(--cut-sm); clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)); }
#ui .hv-tag svg { flex: none; color: var(--c-sodium); }
#ui .hv-tag b { font: 400 15px/1 var(--f-stencil); letter-spacing: .1em; color: var(--c-sodium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ui .hv-tag small { font: 400 var(--fs-caption, 11px)/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); white-space: nowrap; }
#ui .hv-btns { display: flex; gap: 4px; margin-left: auto; flex: none; }
#ui .hv button { height: 40px; min-width: 44px; padding: 0 12px; display: flex; align-items: center; justify-content: center; gap: 6px; font: 400 14px/1 var(--f-stencil); letter-spacing: .07em;
  color: var(--c-chalk); background: var(--face-steel-hi); box-shadow: var(--bevel-hi), var(--edge-hi); touch-action: manipulation;
  --cut: var(--cut-sm); clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)); }
#ui .hv button.on { background: var(--face-sodium); color: var(--c-sodium-ink); box-shadow: var(--bevel-sodium); }
#ui .hv button:active { filter: brightness(1.2); }
#ui .hv-close { background: var(--face-sodium) !important; color: var(--c-sodium-ink) !important; }
#ui .hv-cap { position: absolute; left: 50%; bottom: calc(var(--env-b, 0px) + 26px); transform: translateX(-50%); width: max-content; max-width: min(600px, 72vw); padding: 8px 14px 9px;
  background: rgba(10,12,16,.86); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); text-align: center; pointer-events: none;
  font: 400 var(--hv-fs, 15px)/1.3 var(--f-body); color: #fff; text-shadow: 0 1px 2px #000; }
html[data-text="large"] #ui .hv-cap { --hv-fs: 17px; }
html[data-text="larger"] #ui .hv-cap { --hv-fs: 19px; }
#ui .hv-cap[hidden] { display: block !important; opacity: 0; }
#ui .hv-bar { position: absolute; left: calc(var(--env-l, 0px) + 16px); right: calc(var(--env-r, 0px) + 16px); bottom: calc(var(--env-b, 0px) + 10px); height: 4px; background: rgba(255,255,255,.18); pointer-events: none; }
#ui .hv-bar i { position: absolute; inset: 0; background: var(--c-sodium); transform-origin: 0 50%; transform: scaleX(0); }
#ui .hv-bar u { position: absolute; top: -3px; width: 2px; height: 10px; background: rgba(255,255,255,.6); }
#ui .hv-load { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: grid; gap: 8px; justify-items: center; padding: 14px 18px; background: rgba(10,12,16,.86); pointer-events: none; }
#ui .hv-load b { font: 400 16px/1 var(--f-stencil); letter-spacing: .12em; color: var(--c-sodium); }
#ui .hv-load i { display: block; width: 160px; height: 4px; background: rgba(255,255,255,.18); }
#ui .hv-load i::after { content: ''; display: block; height: 100%; width: calc(var(--k, 0) * 100%); background: var(--c-sodium); }
#ui .hv-end { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; gap: 8px; padding: 12px; background: rgba(10,12,16,.88); }
#ui .hv-end[hidden], #ui .hv-load[hidden] { display: none; }
#ui .hv-names span { position: absolute; left: 0; top: 0; font: 400 11px/1 var(--f-plate); letter-spacing: .05em; white-space: nowrap; text-shadow: 0 1px 2px #000, 0 0 3px rgba(0,0,0,.8); will-change: transform; }
#ui .hv-names span.me { font-size: 12px; color: var(--c-sodium) !important; }
#ui .hv-ghost { position: absolute; bottom: calc(var(--env-b, 0px) + 74px); width: 104px; height: 104px; border-radius: 50%; box-shadow: inset 0 0 0 2px rgba(255,255,255,.35); background: rgba(16,20,26,.28); }
#ui .hv-ghost.l { left: calc(var(--env-l, 0px) + 34px); }
#ui .hv-ghost.r { right: calc(var(--env-r, 0px) + 34px); }
#ui .hv-ghost .k { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px; border-radius: 50%; background: rgba(255,255,255,.28); box-shadow: inset 0 0 0 2px rgba(255,255,255,.7); will-change: transform; }
#ui .hv-ghost.r.fire { box-shadow: inset 0 0 0 3px var(--c-red); }
#ui .hv-ghost.r.aim .k { background: rgba(255,194,61,.4); }
#ui .hv-ghost em { position: absolute; left: 50%; top: -18px; transform: translateX(-50%); font: 400 10px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: #fff; text-shadow: 0 1px 2px #000; white-space: nowrap; font-style: normal; text-transform: uppercase; }
#ui .hv-keys { position: absolute; right: calc(var(--env-r, 0px) + 150px); bottom: calc(var(--env-b, 0px) + 74px); display: grid; grid-template-columns: repeat(2, 48px); gap: 6px; pointer-events: none; }
#ui .hv-key { height: 40px; display: grid; place-items: center; gap: 1px; border-radius: 8px; background: rgba(16,20,26,.5); box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.3); font: 400 9px/1 var(--f-plate); letter-spacing: .04em; color: rgba(255,255,255,.8); text-transform: uppercase; }
#ui .hv-key.lit { background: var(--face-sodium); color: var(--c-sodium-ink); box-shadow: 0 0 14px var(--c-sodium-glow, rgba(255,194,61,.5)); }
#ui .hv.lefty .hv-ghost.l { left: auto; right: calc(var(--env-r, 0px) + 34px); }
#ui .hv.lefty .hv-ghost.r { right: auto; left: calc(var(--env-l, 0px) + 34px); }
#ui .hv.lefty .hv-keys { right: auto; left: calc(var(--env-l, 0px) + 150px); }
@media (max-height: 400px) { #ui .hv-ghost { width: 84px; height: 84px; bottom: calc(var(--env-b, 0px) + 66px); } #ui .hv-ghost .k { width: 38px; height: 38px; margin: -19px; } #ui .hv-keys { right: calc(var(--env-r, 0px) + 128px); bottom: calc(var(--env-b, 0px) + 66px); } #ui .hv.lefty .hv-keys { left: calc(var(--env-l, 0px) + 128px); } }
`;
let styled = false;

// The ghost buttons and the events that light each, with the controller action whose button it names.
const KEYS = [['slide', 'Slide', 'slide'], ['lethal', 'Lethal', 'lethal'], ['tactical', 'Tactical', 'tactical'], ['streak', 'Streak', 'streak']];
const LIT_S = 0.45;

export class HelpVideoPlayer {
  constructor({ canvas, root, video, quality = 'auto', onClose = null, onNext = null }) {
    if (!styled) { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); styled = true; }
    const map = MAPS[video.map];
    if (!map) throw new Error(`help video: unknown map ${video.map}`);
    this.canvas = canvas;
    this.root = root;
    this.video = video;
    this.onClose = onClose;
    this.onNext = onNext;
    this.closed = false;
    this.loop = false;
    this.capI = -2;
    this.pad = null;
    this.lit = Object.fromEntries(KEYS.map(([k]) => [k, 0]));
    this.stats = { frames: 0, totalMs: 0, maxMs: 0, renderMs: 0, restarts: 0 };
    // The renderer first: it clears Graveyard Shift's fences off the shared map, which the Sim then puts back.
    const r = this.renderer = new GameRenderer(canvas, map);
    r.resize();
    r.setQuality?.(quality);
    this.shot = { rate: 1, px: 0, py: 20, pz: 0, tx: 0, ty: 0, tz: 0, fov: FOLLOW_FOV, roll: 0, bars: 0, desat: 0, cut: r.worldCut };
    this.frame = { x: 0, z: 0, dist: WIDE_DIST, fov: WIDE_FOV };
    this.#buildUi();
    this.#start();
    this.onResize = () => r.resize();
    this.onKey = e => { if (e.key === 'Escape') this.close(); };
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    Pad.owner = this;
    document.body.classList.add('hv-on');
    this.last = performance.now();
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  get t() { return this.dir?.t ?? 0; }

  close() {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    if (Pad.owner === this) Pad.owner = null;
    document.body.classList.remove('hv-on');
    this.el.remove();
    try { this.renderer.dispose(); } catch (err) { console.error('help video dispose', err); }
    this.onClose?.();
  }

  // Builds the match again from the same seed: the same video from the top.
  replay() {
    if (this.closed) return;
    this.stats.restarts++;
    this.#start();
  }

  setLoop(on) {
    this.loop = !!on;
    this.ui.loop.classList.toggle('on', this.loop);
    this.ui.loop.setAttribute('aria-pressed', String(this.loop));
  }

  #start() {
    const r = this.renderer;
    r.vfx.clear(); r.chars.resetTransient(); r.combat.reset();
    r.setCinematic(null);
    this.dir = new HelpDirector(this.video, { lazy: true });
    const roster = this.dir.sim.players.map(p => ({ id: p.id, name: p.name, team: p.team, isBot: true, operator: p.loadout?.operator ?? null, skin: null, loadout: p.loadout }));
    r.chars.setRoster(roster);
    r.vfx.setLoadouts(roster);
    this.camMode = null;
    this.snap = true;
    this.capI = -2;
    this.ui.end.hidden = true;
    this.ui.load.hidden = false;
    this.ui.cap.hidden = true;
    this.el.dataset.state = 'loading';
  }

  /* ---------- Frame ---------- */

  tick(now) {
    if (this.closed) return;
    this.raf = requestAnimationFrame(this.tick);
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const d = this.dir;
    if (!d.ready) {
      d.prepare(PREP_MS);
      this.ui.load.style.setProperty('--k', d.prepK.toFixed(3));
      if (!d.ready) return;
      this.ui.load.hidden = true;
      this.el.dataset.state = 'playing';
      this.snap = true;
    }
    const playing = !d.done;
    const events = playing ? d.advance(dt) : NO_EVENTS;
    const view = d.view();
    this.#camera(view, this.snap ? 1 : dt);
    this.snap = false;
    try { this.renderer.update(view, events, dt); } catch (err) { console.error('help video frame', err); }
    this.#names(view);
    this.#caption();
    if (this.video.sticks) this.#ghost(events, dt);
    this.ui.fill.style.transform = `scaleX(${(d.t / this.video.len).toFixed(4)})`;
    if (d.done && this.el.dataset.state === 'playing') {
      if (this.loop) this.replay();
      else { this.el.dataset.state = 'ended'; this.ui.end.hidden = false; this.ui.endReplay.focus?.({ preventScroll: true }); }
    }
    const ms = performance.now() - t0, s = this.stats;
    s.frames++; s.totalMs += ms; if (ms > s.maxMs) s.maxMs = ms; s.renderMs += this.renderer.getStats?.()?.renderMs ?? 0;
  }

  // follow: the match's own camera over the star. Otherwise a cinematic shot: wide over the star (or, once the star is
  // out, whoever the caster camera picks), the tactical frame over everyone, or the caster's cuts.
  #camera(view, dt) {
    const d = this.dir, r = this.renderer;
    const mode = d.cam;
    if (mode !== this.camMode) {
      this.camMode = mode;
      r.setLocal(mode === 'follow' ? STAR_ID : null);
      r.setCinematic(mode === 'follow' ? null : this.shot);
      dt = 1;
    }
    if (mode === 'follow') return;
    const g = this.frame;
    if (mode === 'tactical') tacticalFrame(view.players, this.renderer.map, g);
    else {
      let id = mode === 'caster' ? d.castId : STAR_ID;
      let p = view.players.find(q => q.id === id);
      if (!followable(p) && !(p && p.alive)) {
        p = view.players.find(q => followable(q) && q.team === (p?.team ?? 0)) ?? view.players.find(followable) ?? p;
        if (mode === 'caster' && p) d.castId = p.id;
      }
      if (p) { g.x = p.x; g.z = p.z; }
      // Aboard the transport or gliding (battle royale), higher: the transport and the ground both in shot.
      g.dist = p?.air === 1 ? 84 : p?.air === 2 ? 60 : mode === 'caster' ? FOLLOW_DIST * 1.15 : WIDE_DIST;
      g.fov = mode === 'caster' ? FOLLOW_FOV : WIDE_FOV;
    }
    const m = this.renderer.map;
    g.x = Math.max(8, Math.min(m.width - 8, g.x));
    g.z = Math.max(2, Math.min(m.height - 2, g.z));
    aimShot(this.shot, g, dt, mode === 'tactical' ? EASE_TACTICAL : 6);
    this.shot.cut = mode === 'tactical' ? Infinity : r.worldCut;
    r.camTarget.x = this.shot.tx; r.camTarget.z = this.shot.tz;
    r.chars.focusX = this.shot.tx; r.chars.focusZ = this.shot.tz;
  }

  // The caption for now: touch words, or the controller's button names when one is in use.
  #caption() {
    const pad = document.body.classList.contains('pad-on');
    const c = captionText(this.video, this.dir.t, pad ? 'pad' : 'touch');
    const key = c ? `${c.i}:${pad}` : '';
    if (key === this.capKey) return;
    this.capKey = key;
    this.ui.cap.hidden = !c;
    this.ui.cap.textContent = c ? fillButtons(c.text, id => buttonName(bindingOf(id))) : '';
  }

  // Ghost thumbs: the star's move stick and aim (the knob leans where it pushes), and the buttons it presses.
  #ghost(events, dt) {
    const d = this.dir, I = d.input, ui = this.ui;
    const k = 34;
    ui.lk.style.transform = `translate3d(${(I.mx * k).toFixed(1)}px,${(I.mz * k).toFixed(1)}px,0)`;
    const p = d.star?.ps, aimOn = I.aiming || I.fire;
    const ak = aimOn ? (I.fire ? 1 : 0.6) * k : 0;
    ui.rk.style.transform = p ? `translate3d(${(Math.cos(p.aim) * ak).toFixed(1)}px,${(Math.sin(p.aim) * ak).toFixed(1)}px,0)` : '';
    ui.rg.classList.toggle('fire', !!I.fire);
    ui.rg.classList.toggle('aim', !!aimOn);
    ui.lg.classList.toggle('sprint', !!I.sprint);
    for (const e of events) {
      if (e.id !== STAR_ID) continue;
      if (e.t === 'slide') this.lit.slide = LIT_S;
      else if (e.t === 'throw') this.lit[e.slot === 'tactical' || ['smoke', 'flash', 'stun', 'gas', 'shock', 'decoy', 'sensor', 'stim', 'trophy', 'jammer', 'tagger'].includes(e.kind) ? 'tactical' : 'lethal'] = LIT_S;
      else if (e.t === 'streak') this.lit.streak = LIT_S * 2;
    }
    for (const [id] of KEYS) {
      const on = this.lit[id] > 0;
      if (on) this.lit[id] -= dt;
      const el = ui.keys[id];
      if (el._on !== on) { el._on = on; el.classList.toggle('lit', on); }
    }
    const pad = document.body.classList.contains('pad-on');
    if (pad !== this.pad) {
      this.pad = pad;
      ui.lg.querySelector('em').textContent = pad ? 'Left stick' : 'Move';
      ui.rg.querySelector('em').textContent = pad ? `Right stick · ${buttonName(bindingOf('fire'))} fire` : 'Aim · fire';
      for (const [id, label, act] of KEYS) ui.keys[id].querySelector('b').textContent = pad ? buttonName(bindingOf(act)) || label : label;
    }
  }

  #names(view) {
    const cam = this.renderer.camera, v = this.v3 ??= cam.position.clone(), W = this.canvas.clientWidth || innerWidth, H = this.canvas.clientHeight || innerHeight;
    const pool = this.namePool ??= [], box = this.ui.names;
    let n = 0;
    for (let i = 0; i < view.players.length && n < 10; i++) {
      const p = view.players[i];
      if (!p.alive || p.zk || p.air === 1 || p.dummy) continue;
      if (p.id !== STAR_ID && this.dir.cam === 'follow') continue;     // The match camera: only "You", as in a match.
      v.set(p.x, 2.35, p.z).project(cam);
      if (v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) continue;
      let el = pool[n];
      if (!el) { el = pool[n] = document.createElement('span'); box.appendChild(el); }
      if (el._id !== p.id) {
        el._id = p.id;
        el.textContent = p.name || '';
        el.style.color = TEAMS[p.team]?.css ?? '#fff';
        el.classList.toggle('me', p.id === STAR_ID);
      }
      el.style.transform = `translate(${((v.x + 1) * 0.5 * W).toFixed(1)}px, ${((1 - v.y) * 0.5 * H).toFixed(1)}px) translate(-50%, -100%)`;
      if (el.hidden) el.hidden = false;
      n++;
    }
    for (; n < pool.length; n++) if (!pool[n].hidden) pool[n].hidden = true;
  }

  /* ---------- UI ---------- */

  #buildUi() {
    const v = this.video;
    const el = this.el = document.createElement('div');
    el.className = 'hv';
    el.classList.toggle('lefty', !!Options.get('lefty'));
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `Help video: ${v.title}`);
    const marks = (v.captions ?? []).slice(1).map(([t]) => `<u style="left:${(100 * t / v.len).toFixed(2)}%"></u>`).join('');
    el.innerHTML = `
      <div class="hv-names" aria-hidden="true"></div>
      ${v.sticks ? `<div class="hv-ghost l" aria-hidden="true"><em>Move</em><i class="k"></i></div>
      <div class="hv-ghost r" aria-hidden="true"><em>Aim · fire</em><i class="k"></i></div>
      <div class="hv-keys" aria-hidden="true">${KEYS.map(([id, label]) => `<span class="hv-key" data-k="${id}">${icon(id === 'streak' ? 'uav' : id === 'lethal' ? 'frag' : id === 'tactical' ? 'smoke' : 'slide', { size: 14 })}<b>${label}</b></span>`).join('')}</div>` : ''}
      <div class="hv-top">
        <span class="hv-tag">${icon(v.icon, { size: 18 })}<b>${esc(v.title)}</b><small>${Math.round(v.len)} s</small></span>
        <nav class="hv-btns">
          <button class="hv-loop" data-sound="tab" aria-pressed="false" aria-label="Loop">${icon('ui:refresh', { size: 16 })}<b>Loop</b></button>
          <button class="hv-replay" aria-label="Replay from the start">${icon('ui:play', { size: 16 })}<b>Replay</b></button>
          <button class="hv-close" data-sound="back" aria-label="Skip video">${icon('ui:close', { size: 16 })}<b>Skip</b></button>
        </nav>
      </div>
      <p class="hv-cap" role="status" aria-live="polite" hidden></p>
      <div class="hv-bar" aria-hidden="true"><i></i>${marks}</div>
      <div class="hv-load" role="status"><b>Loading</b><i></i></div>
      <div class="hv-end" hidden>
        <button class="hv-again" data-sound="confirm">${icon('ui:refresh', { size: 16 })}<b>Watch again</b></button>
        ${this.onNext ? `<button class="hv-next">${icon('ui:next', { size: 16 })}<b>Next video</b></button>` : ''}
        <button class="hv-done" data-sound="back">${icon('ui:check', { size: 16 })}<b>Done</b></button>
      </div>`;
    this.root.appendChild(el);
    const q = s => el.querySelector(s);
    this.ui = {
      cap: q('.hv-cap'), fill: q('.hv-bar i'), load: q('.hv-load'), end: q('.hv-end'), endReplay: q('.hv-again'), loop: q('.hv-loop'), names: q('.hv-names'),
      lg: q('.hv-ghost.l'), rg: q('.hv-ghost.r'), lk: q('.hv-ghost.l .k'), rk: q('.hv-ghost.r .k'),
      keys: Object.fromEntries([...el.querySelectorAll('.hv-key')].map(k => [k.dataset.k, k])),
    };
    q('.hv-close').addEventListener('click', () => this.close());
    q('.hv-done').addEventListener('click', () => this.close());
    q('.hv-replay').addEventListener('click', () => this.replay());
    q('.hv-again').addEventListener('click', () => this.replay());
    q('.hv-next')?.addEventListener('click', () => { const next = this.onNext; this.onNext = null; const cb = this.onClose; this.onClose = null; this.close(); cb?.(); next?.(); });
    this.ui.loop.addEventListener('click', () => this.setLoop(!this.loop));
  }

  // A controller: A replays, Y loops, B (or Start) closes.
  padTick(pad) {
    if (pad.pressed(1) || pad.pressed(9)) { this.close(); return; }
    if (pad.pressed(0)) this.replay();
    if (pad.pressed(3)) this.setLoop(!this.loop);
  }
}

const NO_EVENTS = [];
