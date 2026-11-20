// Plays a match clip (js/game/replay.js) in the match renderer, through the killcam's path: a view rebuilt from the
// buffer, its events, and a cinematic shot (renderer.setCinematic) that this player aims. docs/REPLAYS.md.
//
//   const p = new ReplayPlayer({ canvas, root, clip, onClose, onSave });   // builds the renderer and starts playing
//   p.close();                                                             // also called by its own Close button
//
// Controls: play/pause, a scrub bar, 0.5x / 1x / 2x, and three cameras: you, the final kill's killer, and a free
// overview you drag (or push with a stick) around the map. A controller drives it directly (Pad.owner, js/ui/gamepad.js):
// A play/pause, B close, X save, Y camera, LB/RB speed, d-pad left/right 5 s back/on, LT/RT rewind/fast-forward, sticks pan.
import * as THREE from 'three';
import { GameRenderer } from '../render/renderer.js';
import { MAPS } from '../shared/map.js';
import { TEAMS } from '../shared/constants.js';
import { MODES } from '../shared/modes.js';
import { TUNING } from '../shared/tuning.js';
import { ClipReader } from './replay.js';
import { Pad } from '../ui/gamepad.js';
import { killCause } from '../ui/hud.js';
import { esc } from '../ui/widgets.js';
import { shareSheet } from '../ui/replaycode.js';     // Share as a replay code (docs/REPLAYS.md).

const SPEEDS = [0.5, 1, 2];
const TILT = THREE.MathUtils.degToRad(55);         // The match camera's tilt (js/render/renderer.js).
const FOLLOW_DIST = 30, FOLLOW_FOV = 26;
const OVER_DIST = 64, OVER_FOV = 32, OVER_CUT = 80;     // About 2x the ground of the match camera; see docs/REPLAYS.md.
const FEED_S = 6, FEED_ROWS = 4;
const MAX_NAMES = 14;
const CAMS = [['me', 'You'], ['killer', 'Killer'], ['free', 'Overview']];
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class ReplayPlayer {
  constructor({ canvas, root, clip, onClose = null, onSave = null, saved = false, quality = 'auto', title = '' }) {
    this.canvas = canvas;
    this.root = root;
    this.clip = clip;
    this.reader = new ClipReader(clip);
    this.onClose = onClose;
    this.onSave = onSave;
    this.saved = saved || !!clip.savedId;
    this.c = 0;                      // Clip time shown, seconds.
    this.speedI = 1;
    this.playing = true;
    this.cam = 'me';
    this.cursor = 0;                 // Next event to hand the renderer.
    this.events = [];
    this.killer = clip.lastKill?.by ?? null;
    this.follow = { x: 0, z: 0, ok: false };
    this.pan = { x: 0, z: 0 };
    this.snap = true;
    this.closed = false;
    this.stats = { frames: 0, totalMs: 0, maxMs: 0, renderMs: 0 };
    this.v3 = new THREE.Vector3();

    const map = MAPS[clip.mapId];
    if (!map) throw new Error(`replay: unknown map ${clip.mapId}`);
    this.map = map;
    const r = this.renderer = new GameRenderer(canvas, map);
    r.resize();
    // The quality the match was played at (kept with the clip), else the player's setting: never a different one.
    r.setQuality?.(clip.quality || quality);
    r.chars.setRoster(clip.roster);
    r.vfx.setLoadouts(clip.roster);
    r.setLocal(null);
    this.shot = { rate: 1, px: 0, py: 20, pz: 0, tx: 0, ty: 0, tz: 0, fov: FOLLOW_FOV, roll: 0, bars: 0, desat: 0, cut: r.worldCut };
    r.setCinematic(this.shot);

    this.#buildUi(title);
    this.#seek(0);
    this.onResize = () => r.resize();
    window.addEventListener('resize', this.onResize);
    Pad.owner = this;
    document.body.classList.add('replay-on');
    this.last = performance.now();
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  get speed() { return SPEEDS[this.speedI]; }

  close() {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    if (Pad.owner === this) Pad.owner = null;
    document.body.classList.remove('replay-on');
    this.el.remove();
    try { this.renderer.dispose(); } catch (err) { console.error('replay dispose', err); }
    this.onClose?.();
  }

  /* ---------- Time ---------- */

  #seek(c) {
    this.c = Math.max(0, Math.min(this.reader.duration, c));
    this.cursor = this.reader.eventAfter(this.c);
    // Effects in the air belong to the moment we left.
    const r = this.renderer;
    r.vfx.clear(); r.chars.resetTransient(); r.combat.reset();
    this.snap = true;
    this.#paintTime();
    this.feedKey = '';
  }

  setPlaying(on) {
    if (on && this.c >= this.reader.duration - 0.01) this.#seek(0);
    this.playing = on;
    this.ui.play.dataset.on = on ? '1' : '0';
    this.ui.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
  }

  setSpeed(i) {
    this.speedI = Math.max(0, Math.min(SPEEDS.length - 1, i));
    for (const b of this.ui.speeds) b.classList.toggle('on', Number(b.dataset.i) === this.speedI);
  }

  setCam(id) {
    if (id === 'killer' && !this.killer) return;
    if (id === 'free' && this.cam !== 'free') { this.pan.x = this.shot.tx; this.pan.z = this.shot.tz; }
    this.cam = id;
    for (const b of this.ui.cams) b.classList.toggle('on', b.dataset.cam === id);
    this.el.dataset.cam = id;
    if (id !== 'free') this.snap = true;
  }

  // The scrub bar, dragged or tapped.
  #scrubTo(clientX) {
    const r = this.ui.bar.getBoundingClientRect();
    const k = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
    this.#seek(k * this.reader.duration);
  }

  /* ---------- Frame ---------- */

  tick(now) {
    if (this.closed) return;
    this.raf = requestAnimationFrame(this.tick);
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const dur = this.reader.duration;
    const events = this.events;
    events.length = 0;
    if (this.playing && !this.scrubbing) {
      this.c += dt * this.speed;
      if (this.c >= dur) { this.c = dur; this.setPlaying(false); }
      const ev = this.clip.ev, at = this.clip.evAt;
      while (this.cursor < ev.length && at[this.cursor] <= this.c) events.push(ev[this.cursor++]);
      if (events.length > 400) events.splice(0, events.length - 400);     // A long stall: only the latest effects.
    }
    if (this.hold) { this.#seek(this.c + this.hold * dt); }
    const view = this.reader.sample(this.c);
    this.#direct(view, this.snap ? 1 : dt);
    this.snap = false;
    this.shot.rate = this.playing && !this.scrubbing ? this.speed : 0;
    const r = this.renderer;
    try { r.update(view, events, dt); } catch (err) { console.error('replay frame', err); }
    this.#names(view);
    this.#feed();
    this.#paintTime();
    const ms = performance.now() - t0, s = this.stats;
    s.frames++; s.totalMs += ms; if (ms > s.maxMs) s.maxMs = ms; s.renderMs += r.getStats().renderMs ?? 0;
  }

  #find(view, id) {
    const list = view.players;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // The camera: the match's own angle over you or the killer, or a high overview that pans.
  #direct(view, dt) {
    const shot = this.shot, map = this.map;
    let tx, tz, dist, fov, cut;
    if (this.cam === 'free') {
      this.pan.x = Math.max(0, Math.min(map.width, this.pan.x));
      this.pan.z = Math.max(0, Math.min(map.height, this.pan.z));
      tx = this.pan.x; tz = this.pan.z; dist = OVER_DIST; fov = OVER_FOV; cut = OVER_CUT;
    } else {
      const p = this.#find(view, this.cam === 'killer' ? this.killer : this.clip.localId);
      if (p) { this.follow.x = p.x; this.follow.z = p.z; this.follow.ok = true; }
      else if (!this.follow.ok) { const any = view.players[0]; this.follow.x = any?.x ?? map.width / 2; this.follow.z = any?.z ?? map.height / 2; }
      tx = this.follow.x; tz = this.follow.z; dist = FOLLOW_DIST * (TUNING.camZoom ?? 1); fov = FOLLOW_FOV; cut = this.renderer.worldCut;
    }
    tx = Math.max(10, Math.min(map.width - 10, tx));
    tz = Math.max(2, Math.min(map.height - 2, tz));
    const gx = tx, gy = dist * Math.sin(TILT), gz = tz + dist * Math.cos(TILT);
    const k = dt >= 1 ? 1 : damp(this.cam === 'free' ? 14 : 9, dt);
    shot.px += (gx - shot.px) * k; shot.py += (gy - shot.py) * k; shot.pz += (gz - shot.pz) * k;
    shot.tx += (tx - shot.tx) * k; shot.ty = 0; shot.tz += (tz - shot.tz) * k;
    shot.fov += (fov - shot.fov) * k;
    shot.cut = cut;
    // Ambience, props, culling and loot follow the camera's target as they do the player in a match.
    const r = this.renderer;
    r.camTarget.x = shot.tx; r.camTarget.z = shot.tz;
    r.chars.focusX = shot.tx; r.chars.focusZ = shot.tz;
  }

  /* ---------- Controller ---------- */

  // Called by GamepadInput.tick while this player owns the pad. `pad` has pressed(i), down(i), axes, triggers.
  padTick(pad, dt) {
    if (pad.pressed(0) || pad.pressed(9)) this.setPlaying(!this.playing);
    if (pad.pressed(1)) { this.close(); return; }
    if (pad.pressed(2)) this.#save();
    if (pad.pressed(3)) this.#nextCam(1);
    if (pad.pressed(4)) this.setSpeed(this.speedI - 1);
    if (pad.pressed(5)) this.setSpeed(this.speedI + 1);
    if (pad.pressed(14)) this.#seek(this.c - 5);
    if (pad.pressed(15)) this.#seek(this.c + 5);
    const [lt, rt] = pad.triggers ?? [0, 0];
    this.hold = rt > 0.3 ? 4 * rt : lt > 0.3 ? -4 * lt : 0;
    const [ax, ay, bx, by] = pad.axes;
    const sx = Math.abs(ax) > Math.abs(bx) ? ax : bx, sy = Math.abs(ay) > Math.abs(by) ? ay : by;
    if (Math.hypot(sx, sy) > 0.2) {
      if (this.cam !== 'free') this.setCam('free');
      this.pan.x += sx * 40 * dt; this.pan.z += sy * 40 * dt;
    }
  }

  #nextCam(step) {
    const ids = CAMS.map(c => c[0]).filter(id => id !== 'killer' || this.killer);
    const i = ids.indexOf(this.cam);
    this.setCam(ids[(i + step + ids.length) % ids.length]);
  }

  // Share: the code sheet over the player, paused meanwhile (docs/REPLAYS.md, replay codes).
  async share() {
    if (this.sharing) return;
    this.sharing = true;
    const was = this.playing;
    this.setPlaying(false);
    const map = this.map.name ?? this.clip.mapId, mode = MODES[this.clip.mode]?.name ?? '';
    try { await shareSheet(this.clip, { title: this.clip.title || `${map} · ${mode}` }); } finally { this.sharing = false; }
    if (!this.closed && was) this.setPlaying(true);
  }

  async #save() {
    if (this.saved || !this.onSave || this.saving) return;
    this.saving = true;
    const b = this.ui.save;
    b.disabled = true;
    b.querySelector('b').textContent = 'Saving';
    let res = null;
    try { res = await this.onSave(this.clip); } catch (err) { console.error('save clip', err); }
    this.saving = false;
    if (res?.ok) {
      this.saved = true;
      b.querySelector('b').textContent = 'Saved';
      b.classList.add('done');
      this.#toast('Clip saved. Watch it again from History, Clips.');
    } else {
      b.disabled = false;
      b.querySelector('b').textContent = 'Save clip';
      this.#toast(res?.reason === 'full' ? 'You have 5 clips already. Delete one in History, Clips, to save this one.'
        : 'This clip could not be saved on this device.');
    }
  }

  #toast(text) {
    const t = this.ui.toast;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('on'), 3200);
  }

  /* ---------- Overlay ---------- */

  #buildUi(title) {
    const clip = this.clip;
    const el = this.el = document.createElement('div');
    el.className = 'replay';
    el.dataset.cam = this.cam;
    const mode = MODES[clip.mode]?.name ?? '';
    const map = this.map.name ?? clip.mapId;
    const canSave = !!this.onSave && !this.saved;
    el.innerHTML = `
      <div class="rp-stage"></div>
      <div class="rp-names"></div>
      <div class="rp-top">
        <span class="rp-tag"><i class="kc-rec"></i><b>Replay</b><small>${esc(title || `${map} · ${mode}`)}</small></span>
        <nav class="rp-cams">${CAMS.map(([id, label]) => `<button class="seg rp-cam${id === this.cam ? ' on' : ''}" data-cam="${id}" data-sound="tab"${id === 'killer' && !this.killer ? ' disabled aria-disabled="true"' : ''}><b>${label}</b></button>`).join('')}</nav>
        <button class="rp-close" data-sound="back" aria-label="Close replay"><b>Close</b></button>
      </div>
      <div class="rp-feed"></div>
      <div class="rp-bar">
        <button class="rp-play" data-on="1" aria-label="Pause"><i></i></button>
        <span class="rp-time t-num">0:00</span>
        <div class="rp-scrub"><i class="rp-track"></i><i class="rp-fill"></i><i class="rp-kills"></i><i class="rp-knob"></i></div>
        <span class="rp-dur t-num">${mmss(this.reader.duration)}</span>
        <nav class="rp-speeds">${SPEEDS.map((s, i) => `<button class="seg rp-speed${i === this.speedI ? ' on' : ''}" data-i="${i}" data-sound="tab"><b>${s}x</b></button>`).join('')}</nav>
        ${canSave ? '<button class="rp-save" aria-label="Save clip"><b>Save clip</b></button>' : this.saved ? '<button class="rp-save done" disabled><b>Saved</b></button>' : ''}
        <button class="rp-share" aria-label="Share as a replay code"><b>Share</b></button>
      </div>
      <small class="rp-pad">A play · LB RB speed · Y camera · ◀ ▶ 5 s · LT RT rewind, forward${canSave ? ' · X save' : ''} · B close</small>
      <p class="rp-toast"></p>`;
    this.root.appendChild(el);
    const q = s => el.querySelector(s);
    this.ui = {
      play: q('.rp-play'), time: q('.rp-time'), bar: q('.rp-scrub'), fill: q('.rp-fill'), knob: q('.rp-knob'),
      speeds: [...el.querySelectorAll('.rp-speed')], cams: [...el.querySelectorAll('.rp-cam')], save: q('.rp-save'),
      feed: q('.rp-feed'), names: q('.rp-names'), toast: q('.rp-toast'), stage: q('.rp-stage'), kills: q('.rp-kills'),
    };
    // Kill ticks on the scrub bar, yours in your side's colour.
    const ev = clip.ev, dur = this.reader.duration || 1;
    this.ui.kills.innerHTML = ev.map((e, i) => (e.t === 'kill' ? `<u style="left:${(100 * clip.evAt[i] / dur).toFixed(2)}%"${e.by === clip.localId ? ' class="mine"' : e.target === clip.localId ? ' class="me"' : ''}></u>` : '')).join('');
    q('.rp-close').addEventListener('click', () => this.close());
    this.ui.play.addEventListener('click', () => this.setPlaying(!this.playing));
    for (const b of this.ui.speeds) b.addEventListener('click', () => this.setSpeed(Number(b.dataset.i)));
    for (const b of this.ui.cams) b.addEventListener('click', () => this.setCam(b.dataset.cam));
    this.ui.save?.addEventListener('click', () => this.#save());
    el.querySelector('.rp-share').addEventListener('click', () => this.share());
    // Scrubbing: press anywhere on the bar and drag; the picture follows the finger, paused, and play resumes on release.
    const bar = this.ui.bar;
    bar.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      this.scrubbing = true;
      bar.setPointerCapture?.(e.pointerId);
      this.#scrubTo(e.clientX);
    });
    bar.addEventListener('pointermove', e => { if (this.scrubbing) this.#scrubTo(e.clientX); });
    const end = () => { this.scrubbing = false; };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    // Overview: drag the map.
    const st = this.ui.stage;
    st.addEventListener('pointerdown', e => {
      if (this.cam !== 'free') return;
      this.drag = { x: e.clientX, y: e.clientY };
      st.setPointerCapture?.(e.pointerId);
    });
    st.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const scale = (2 * OVER_DIST * Math.tan(THREE.MathUtils.degToRad(OVER_FOV / 2))) / Math.max(1, window.innerHeight);
      this.pan.x -= (e.clientX - this.drag.x) * scale;
      this.pan.z -= (e.clientY - this.drag.y) * scale / Math.sin(TILT);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    });
    const stop = () => { this.drag = null; };
    st.addEventListener('pointerup', stop);
    st.addEventListener('pointercancel', stop);
    this.namePool = [];
  }

  #paintTime() {
    if (!this.ui) return;
    const dur = this.reader.duration || 1, k = Math.max(0, Math.min(1, this.c / dur));
    const sec = Math.floor(this.c);
    if (sec !== this.shownSec) { this.shownSec = sec; this.ui.time.textContent = mmss(this.c); }
    const w = (k * 100).toFixed(2);
    if (w !== this.shownW) {
      this.shownW = w;
      this.ui.fill.style.transform = `scaleX(${k.toFixed(4)})`;
      this.ui.knob.style.left = `${w}%`;
    }
  }

  // Names over heads: each player in shot (not the undead), a reused pool of labels.
  #names(view) {
    const cam = this.renderer.camera, v = this.v3, W = this.canvas.clientWidth || window.innerWidth, H = this.canvas.clientHeight || window.innerHeight;
    const pool = this.namePool, box = this.ui.names;
    let n = 0;
    for (let i = 0; i < view.players.length && n < MAX_NAMES; i++) {
      const p = view.players[i];
      if (!p.alive || p.zk || p.air === 1) continue;
      v.set(p.x, 2.35, p.z).project(cam);
      if (v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) continue;
      let el = pool[n];
      if (!el) { el = pool[n] = document.createElement('span'); box.appendChild(el); }
      if (el._id !== p.id || el._team !== p.team) {
        el._id = p.id; el._team = p.team;
        el.textContent = p.name || '';
        el.style.color = TEAMS[p.team]?.css ?? '#fff';
        el.classList.toggle('me', p.id === this.clip.localId);
      }
      el.style.transform = `translate(${((v.x + 1) * 0.5 * W).toFixed(1)}px, ${((1 - v.y) * 0.5 * H).toFixed(1)}px) translate(-50%, -100%)`;
      if (el.hidden) el.hidden = false;
      n++;
    }
    for (let i = n; i < pool.length; i++) if (!pool[i].hidden) pool[i].hidden = true;
  }

  // The kill feed: kills of the last few seconds of clip time, newest at the top.
  #feed() {
    const clip = this.clip, ev = clip.ev, at = clip.evAt;
    const rows = [];
    for (let i = this.reader.eventAfter(this.c) - 1; i >= 0 && rows.length < FEED_ROWS; i--) {
      if (at[i] < this.c - FEED_S) break;
      if (ev[i].t === 'kill') rows.push(i);
    }
    const key = rows.join(',');
    if (key === this.feedKey) return;
    this.feedKey = key;
    const name = id => esc(this.reader.name(id) || '?');
    const team = id => { const c = this.reader.view.players.find(p => p.id === id); return TEAMS[c?.team ?? 0]?.css ?? '#fff'; };
    this.ui.feed.innerHTML = rows.map(i => {
      const e = ev[i];
      const self = e.by === e.target;
      return `<div class="rp-kill${e.by === clip.localId ? ' mine' : ''}${e.target === clip.localId ? ' me' : ''}">${self ? '' : `<b style="color:${team(e.by)}">${name(e.by)}</b>`}<i>${esc(killCause(e))}${e.head ? ' ◎' : ''}</i><b style="color:${team(e.target)}">${name(e.target)}</b></div>`;
    }).join('');
  }
}
