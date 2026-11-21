// The spectator / caster camera (docs/RANKED.md, ROADMAP item 60): for a friend room's spectators and for players out
// of play (out of lives for the round, out of a battle royale), a camera of their own over the live match:
//   Follow    the match camera's angle over one player; Next / Previous, a tap on the list, or the shoulder buttons
//   Tactical  high overhead, framing everyone still in play (the whole map when nobody is)
//   Free      dragged with a finger (pinch or + / - to zoom), or a stick
// with the player list (side, HP, score), its own kill feed, and eased cuts between shots. The renderer is driven as the
// killcam drives it (renderer.setCinematic): the killcam calls direct() each frame it is idle (js/game/killcam.js), so a
// death replay still plays and the caster takes the picture back after it.
//
//   const cam = new CasterCam({ renderer, map, localId, spectator, canOpen, onExit, title });
//   match frame: cam.frame(view, events, dt)    (DOM: the list a few times a second, the feed on kills, nothing else)
//   cam.open() / cam.close() / cam.dispose()
//
// Fairness: no fog in a cinematic, so a player out of play sees everyone. That is fine in a friend room and a bot
// match, not in Ranked: Match passes canOpen false there for players (spectators are never in Ranked rooms' seats).
// Performance: one shot object, a reused list array and row pool; tactical and free views keep a distance cut.
import { TEAMS } from '../shared/constants.js';
import { TUNING } from '../shared/tuning.js';
import { Pad } from '../ui/gamepad.js';
import { killCause } from '../ui/hud.js';
import { esc, nameHtml } from '../ui/widgets.js';
import { spectate } from '../sim/snd.js';
import {
  followable, cycle, listOrder, tacticalFrame, aimShot, FOLLOW_DIST, FOLLOW_FOV, FREE_DIST, FREE_FOV, FREE_MIN, FREE_MAX,
  TACTICAL_FOV, EASE_FOLLOW, EASE_FREE, EASE_TACTICAL, TILT,
} from './caster-core.js';

const CAMS = [['follow', 'Follow'], ['tactical', 'Tactical'], ['free', 'Free']];
const LIST_EVERY = 0.2;        // Seconds between list refreshes.
const FEED_S = 6, FEED_ROWS = 5;
const AUTO_NEXT = 1.6;         // Seconds a followed player lies dead before the camera moves on.
const teamCss = t => TEAMS[t]?.css ?? '#e7eae4';

export class CasterCam {
  constructor({ renderer, map, localId, spectator = false, canOpen = true, onExit = null, title = '' }) {
    this.renderer = renderer;
    this.map = map;
    this.localId = localId;
    this.spectator = spectator;
    this.canOpen = canOpen;
    this.onExit = onExit;
    this.title = title;
    this.active = false;
    this.cam = 'follow';
    this.target = null;
    this.deadFor = 0;
    this.listT = 0;
    this.order = [];
    this.rows = [];
    this.feed = [];                // [{ at, html }]
    this.clock = 0;
    this.pan = { x: map.width / 2, z: map.height / 2 };
    this.freeDist = FREE_DIST;
    this.goal = { x: 0, z: 0, dist: FOLLOW_DIST, fov: FOLLOW_FOV };
    this.frameGoal = { x: 0, z: 0, dist: 0, fov: TACTICAL_FOV };
    this.shot = { rate: 1, px: map.width / 2, py: 30, pz: map.height / 2 + 20, tx: map.width / 2, ty: 0, tz: map.height / 2, fov: FOLLOW_FOV, roll: 0, bars: 0, desat: 0, cut: renderer.worldCut };
    this.snap = true;
    this.view = null;
    this.ptrs = new Map();
    this.#buildButton();
  }

  /* ---------- Opening ---------- */

  // Whether the caster can open now: a spectator always, a player only while out of play.
  available(view) {
    if (this.spectator) return true;
    if (!this.canOpen || !view || view.phase === 'ended') return false;
    const me = this.#find(view, this.localId);
    if (!me || me.alive) return false;
    // Out for the round or out of the match while others play on (the same rule as spectating a teammate,
    // js/sim/snd.js spectate.target), or out of a battle royale. A respawn wait is not "out".
    return !!(me.out || view.br || spectate.target(view, this.localId) !== null);
  }

  open() {
    if (this.active) return;
    this.active = true;
    this.snap = true;
    this.#buildUi();
    document.body.classList.add('caster-on');
    Pad.owner = this;
    if (this.view && !followable(this.#find(this.view, this.target))) this.target = cycle(this.view, null, 1);
    this.#paintCam();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('caster-on');
    if (Pad.owner === this) Pad.owner = null;
    this.el?.remove(); this.el = null; this.rows = []; this.ui = null;
    if (this.renderer.cine === this.shot) this.renderer.setCinematic(null);
  }

  dispose() {
    this.close();
    this.btn?.remove(); this.btn = null;
  }

  /* ---------- Frame ---------- */

  // Every match frame, before the killcam renders. Keeps the open button, the list and the feed; the shot is aimed in
  // direct(), which the killcam calls when it is not playing a replay.
  frame(view, events, dt) {
    this.view = view;
    this.clock += dt;
    const can = this.available(view);
    if (this.btn && this.btnOn !== (can && !this.active)) { this.btnOn = can && !this.active; this.btn.classList.toggle('on', this.btnOn); this.btnAt = -1; }
    if (this.btnOn && this.clock >= this.btnAt) this.#placeButton();
    if (this.spectator && !this.active && view) this.open();
    if (this.active && !can) { this.close(); return; }
    if (!this.active) return;
    for (let i = 0; i < events.length; i++) if (events[i].t === 'kill') this.#kill(view, events[i]);
    // A followed player who died: on to the next after a moment.
    const t = this.#find(view, this.target);
    if (!followable(t)) {
      this.deadFor += dt;
      if (this.deadFor > AUTO_NEXT || !t) { const n = cycle(view, this.target, 1); if (n !== null) { this.target = n; this.deadFor = 0; } }
    } else this.deadFor = 0;
    this.listT -= dt;
    if (this.listT <= 0) { this.listT = LIST_EVERY; this.#paintList(view); }
  }

  // Called by the killcam (js/game/killcam.js render) when it is idle: hand the renderer this shot, or take it back.
  direct(view, dt) {
    const r = this.renderer;
    if (!this.active) { if (r.cine === this.shot) r.setCinematic(null); return; }
    if (r.cine !== this.shot) { r.setCinematic(this.shot); this.snap = true; }
    const map = this.map, g = this.goal;
    let ease = EASE_FOLLOW;
    if (this.cam === 'tactical') {
      tacticalFrame(view.players, map, this.frameGoal);
      g.x = this.frameGoal.x; g.z = this.frameGoal.z; g.dist = this.frameGoal.dist; g.fov = this.frameGoal.fov;
      ease = EASE_TACTICAL;
    } else if (this.cam === 'free') {
      this.pan.x = Math.max(0, Math.min(map.width, this.pan.x));
      this.pan.z = Math.max(0, Math.min(map.height, this.pan.z));
      g.x = this.pan.x; g.z = this.pan.z; g.dist = this.freeDist; g.fov = FREE_FOV;
      ease = EASE_FREE;
    } else {
      const p = this.#find(view, this.target);
      if (p) { g.x = p.x; g.z = p.z; }
      g.dist = FOLLOW_DIST * (TUNING.camZoom ?? 1); g.fov = FOLLOW_FOV;
    }
    g.x = Math.max(10, Math.min(map.width - 10, g.x));
    g.z = Math.max(2, Math.min(map.height - 2, g.z));
    aimShot(this.shot, g, this.snap ? 1 : dt, ease);
    this.snap = false;
    this.shot.cut = this.cam === 'follow' ? r.worldCut : Math.max(80, Math.min(120, this.shot.py / Math.sin(TILT) * 1.25));
    r.camTarget.x = this.shot.tx; r.camTarget.z = this.shot.tz;
    r.chars.focusX = this.shot.tx; r.chars.focusZ = this.shot.tz;
  }

  #find(view, id) {
    if (!view || id === null || id === undefined) return null;
    const list = view.players;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------- Controls ---------- */

  setCam(id) {
    if (!CAMS.some(c => c[0] === id)) return;
    if (id === 'free' && this.cam !== 'free') { this.pan.x = this.shot.tx; this.pan.z = this.shot.tz; this.freeDist = Math.max(FREE_MIN, Math.min(FREE_MAX, this.shot.py / Math.sin(TILT))); }
    this.cam = id;
    this.#paintCam();
  }

  step(dir) {
    if (!this.view) return;
    const n = cycle(this.view, this.target, dir);
    if (n !== null) this.follow(n);
  }

  follow(id) {
    this.target = id;
    this.deadFor = 0;
    if (this.cam !== 'follow') this.cam = 'follow';
    this.#paintCam();
    this.listT = 0;
  }

  zoom(k) { this.freeDist = Math.max(FREE_MIN, Math.min(FREE_MAX, this.freeDist * k)); }

  // Pad (Pad.owner while open): LB / RB previous and next, Y the next camera, X the list, B close, sticks pan (free).
  padTick(pad, dt) {
    if (pad.pressed(4)) this.step(-1);
    if (pad.pressed(5)) this.step(1);
    if (pad.pressed(3)) { const i = CAMS.findIndex(c => c[0] === this.cam); this.setCam(CAMS[(i + 1) % CAMS.length][0]); }
    if (pad.pressed(2)) this.ui?.list.classList.toggle('shut');
    if (pad.pressed(1)) { this.#exit(); return; }
    const [ax, ay, bx, by] = pad.axes;
    const sx = Math.abs(ax) > Math.abs(bx) ? ax : bx, sy = Math.abs(ay) > Math.abs(by) ? ay : by;
    if (Math.hypot(sx, sy) > 0.2) {
      if (this.cam !== 'free') this.setCam('free');
      this.pan.x += sx * 40 * dt; this.pan.z += sy * 40 * dt;
    }
    const [lt, rt] = pad.triggers ?? [0, 0];
    if (this.cam === 'free' && (lt > 0.3 || rt > 0.3)) this.zoom(1 + (lt - rt) * dt * 1.5);
  }

  #exit() {
    if (this.spectator) { this.onExit?.(); return; }
    this.close();
  }

  /* ---------- Overlay ---------- */

  #buildButton() {
    if (typeof document === 'undefined') return;
    const b = this.btn = document.createElement('button');
    b.className = 'cs-open';
    b.type = 'button';
    b.dataset.tap = '1';
    b.dataset.sound = 'tab';
    b.innerHTML = '<b>Caster cam</b>';
    b.addEventListener('click', () => this.open());
    document.body.appendChild(b);
    this.btnOn = false;
  }

  // Under the spectate card when it shows on the button's side (extraction, battle royale): the card's height follows
  // the HUD size, so it is measured, twice a second while the button is up.
  #placeButton() {
    this.btnAt = this.clock + 0.5;
    const card = document.querySelector('.spec-card:not([hidden])');
    const r = card?.getBoundingClientRect(), b = this.btn.getBoundingClientRect();
    const top = r && r.width && r.right > b.left && r.left < b.right ? `${Math.round(r.bottom + 6)}px` : '';
    if (this.btn.style.top !== top) this.btn.style.top = top;
  }

  #buildUi() {
    const el = this.el = document.createElement('div');
    el.className = 'caster';
    el.innerHTML = `
      <div class="cs-stage"></div>
      <div class="cs-top">
        <span class="cs-tag"><b>${this.spectator ? 'Spectating' : 'Caster'}</b><small>${esc(this.title)}</small></span>
        <nav class="cs-modes">${CAMS.map(([id, label]) => `<button class="cs-mode" data-cam="${id}" data-sound="tab"><b>${label}</b></button>`).join('')}</nav>
        <button class="cs-listbtn" data-sound="tab" aria-label="Player list"><b>List</b></button>
        <button class="cs-exit" data-sound="back"><b>${this.spectator ? 'Leave' : 'Close'}</b></button>
      </div>
      <div class="cs-list"></div>
      <div class="cs-feed"></div>
      <div class="cs-foot">
        <button class="cs-prev" data-sound="tab" aria-label="Previous player"><b>&lsaquo;</b></button>
        <span class="cs-who"><b></b><small></small><i><u></u></i></span>
        <button class="cs-next" data-sound="tab" aria-label="Next player"><b>&rsaquo;</b></button>
      </div>
      <div class="cs-zoom"><button class="cs-zin" aria-label="Zoom in"><b>+</b></button><button class="cs-zout" aria-label="Zoom out"><b>&minus;</b></button></div>
      <small class="cs-hint">Drag to move · pinch to zoom</small>`;
    document.body.appendChild(el);
    const q = s => el.querySelector(s);
    this.ui = { list: q('.cs-list'), feed: q('.cs-feed'), who: q('.cs-who b'), whoSub: q('.cs-who small'), whoHp: q('.cs-who u'), modes: [...el.querySelectorAll('.cs-mode')], stage: q('.cs-stage') };
    for (const b of this.ui.modes) b.addEventListener('click', () => this.setCam(b.dataset.cam));
    q('.cs-exit').addEventListener('click', () => this.#exit());
    q('.cs-listbtn').addEventListener('click', () => this.ui.list.classList.toggle('shut'));
    q('.cs-prev').addEventListener('click', () => this.step(-1));
    q('.cs-next').addEventListener('click', () => this.step(1));
    q('.cs-zin').addEventListener('click', () => this.zoom(0.8));
    q('.cs-zout').addEventListener('click', () => this.zoom(1.25));
    this.ui.list.addEventListener('click', e => { const row = e.target.closest('.cs-row'); if (row?.dataset.id) this.follow(row.dataset.id); });
    // The stage: drag pans the free camera (a drag in follow or tactical switches to it), two fingers pinch its zoom.
    const st = this.ui.stage;
    st.addEventListener('pointerdown', e => { this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); st.setPointerCapture?.(e.pointerId); this.pinch = null; this.moved = 0; });
    st.addEventListener('pointermove', e => {
      const p = this.ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.ptrs.size >= 2) {
        const [a, b] = [...this.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoom(this.pinch / Math.max(20, d));
        this.pinch = d;
        if (this.cam !== 'free') this.setCam('free');
        return;
      }
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.moved < 8) return;
      if (this.cam !== 'free') this.setCam('free');
      const scale = (2 * this.freeDist * Math.tan((FREE_FOV / 2) * Math.PI / 180)) / Math.max(1, window.innerHeight);
      this.pan.x -= dx * scale; this.pan.z -= dy * scale / Math.sin(TILT);
    });
    const up = e => { this.ptrs.delete(e.pointerId); if (this.ptrs.size < 2) this.pinch = null; };
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', up);
    this.rows = [];
    this.feedKey = '';
    this.#paintFeed();
  }

  #paintCam() {
    if (!this.el) return;
    this.el.dataset.cam = this.cam;
    for (const b of this.ui.modes) b.classList.toggle('on', b.dataset.cam === this.cam);
    this.listT = 0;
  }

  // The list: a reused row per player, rewritten only where something changed.
  #paintList(view) {
    const ui = this.ui;
    if (!ui) return;
    const me = this.#find(view, this.localId);
    const order = listOrder(view.players, this.order, me?.team ?? 0);
    for (let i = 0; i < order.length; i++) {
      const p = order[i];
      let row = this.rows[i];
      if (!row) {
        row = document.createElement('button');
        row.className = 'cs-row';
        row.innerHTML = '<em></em><small></small><i><u></u></i>';
        row._em = row.firstChild; row._sm = row.children[1]; row._hp = row.querySelector('u');
        ui.list.appendChild(row);
        this.rows[i] = row;
      }
      if (row.dataset.id !== p.id) { row.dataset.id = p.id; row._name = null; }
      if (row._name !== p.name || row._team !== p.team) { row._name = p.name; row._team = p.team; row._em.innerHTML = nameHtml(p.name || '?'); row.style.setProperty('--tc', teamCss(p.team)); }
      const sc = `${p.kills ?? 0}-${p.deaths ?? 0} · ${p.score ?? 0}`;
      if (row._sc !== sc) { row._sc = sc; row._sm.textContent = sc; }
      const hp = p.alive ? Math.max(0, Math.min(1, (p.hp ?? 0) / 100)) : 0;
      if (row._hpv !== hp) { row._hpv = hp; row._hp.style.transform = `scaleX(${hp.toFixed(2)})`; }
      const dead = !p.alive, on = p.id === this.target && this.cam === 'follow';
      if (row._dead !== dead) { row._dead = dead; row.classList.toggle('dead', dead); }
      if (row._on !== on) { row._on = on; row.classList.toggle('on', on); }
      if (row.hidden) row.hidden = false;
    }
    for (let i = order.length; i < this.rows.length; i++) if (!this.rows[i].hidden) this.rows[i].hidden = true;
    // Who is on camera.
    const t = this.cam === 'follow' ? this.#find(view, this.target) : null;
    const who = this.cam === 'tactical' ? 'Tactical view' : this.cam === 'free' ? 'Free camera' : t ? t.name : 'Nobody to follow';
    const sub = t ? `${t.kills ?? 0} kills · ${t.alive ? `${Math.max(0, Math.round(t.hp ?? 0))} HP` : 'down'}` : this.cam === 'tactical' ? `${view.players.filter(followable).length} in play` : '';
    if (this.whoText !== who) { this.whoText = who; ui.who.textContent = who; ui.who.style.color = t ? teamCss(t.team) : ''; }
    if (this.whoSub !== sub) { this.whoSub = sub; ui.whoSub.textContent = sub; }
    const hp = t && t.alive ? Math.max(0, Math.min(1, (t.hp ?? 0) / 100)) : 0;
    if (this.whoHp !== hp) { this.whoHp = hp; ui.whoHp.style.transform = `scaleX(${hp.toFixed(2)})`; }
    // The feed's old rows age out here too.
    if (this.feed.length && this.clock - this.feed[0].at > FEED_S) { while (this.feed.length && this.clock - this.feed[0].at > FEED_S) this.feed.shift(); this.#paintFeed(); }
  }

  #kill(view, e) {
    const by = this.#find(view, e.by), tg = this.#find(view, e.target);
    const self = e.by === e.target;
    const html = `<div class="cs-kill">${self ? '' : `<b style="color:${teamCss(by?.team)}">${nameHtml(by?.name ?? '?')}</b>`}<i>${esc(killCause(e))}${e.head ? ' ◎' : ''}</i><b style="color:${teamCss(tg?.team)}">${nameHtml(tg?.name ?? '?')}</b></div>`;
    this.feed.push({ at: this.clock, html });
    if (this.feed.length > FEED_ROWS) this.feed.shift();
    this.#paintFeed();
  }

  #paintFeed() {
    if (!this.ui) return;
    this.ui.feed.innerHTML = this.feed.map(f => f.html).reverse().join('');
  }
}
