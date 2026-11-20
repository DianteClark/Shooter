// Visual sound cues (Options > Accessibility > Sound cues, docs/ACCESSIBILITY.md): what a player hears, also shown.
//  - Grenades (on by default): a thrown explosive or flash within earshot of the blast gets a marker around the
//    middle of the screen, pointing at it, with its name. Your own and enemies' throws; a teammate's cannot hurt you.
//  - Steps (off by default): an enemy's footsteps, exactly when js/audio/audio.js plays them (moving at a run or a
//    walk, not sliding, not running Dead Silence, within its step range), as a thin arc on the side they come from.
//    Direction and loudness only, never a position: the same as what the sound gives.
//  - Gunfire (Options > Accessibility, off by default): an enemy's unsuppressed shot within earshot, as a short dashed
//    red arc on its side that fades in under a second. Suppressed fire stays silent here as it is quiet in the mix.
//  - Sound captions (off by default): one line per important sound, with the side it came from: gunfire, explosions,
//    footsteps close by, an enemy streak called. At most three lines; each goes after a few seconds. The campaign's
//    radio has its own subtitles (js/ui/cp-hud.js).
// The HUD makes one and calls update() every frame; nothing here allocates once warm, and writes happen on change.
// With gunfire and captions off, onEvents returns at once: they cost nothing.
import { icon } from './icons.js';
import { LETHALS, TACTICALS, STREAKS } from '../shared/catalog.js';

const CSS = `
.cues { position: absolute; inset: 0; pointer-events: none; z-index: var(--z-hud-alert); }
.cues[hidden] { display: none; }
.cue-nade { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; will-change: transform, opacity; }
.cue-nade .cn-face { position: absolute; left: -19px; top: -19px; width: 38px; height: 38px; display: grid; place-items: center; border-radius: var(--radius-round);
  background: rgba(16,20,26,.78); box-shadow: inset 0 0 0 2.5px var(--c-red), 0 0 12px var(--c-red-glow); color: #fff; }
.cue-nade .cn-arrow { position: absolute; left: -7px; top: -7px; width: 14px; height: 14px; will-change: transform; }
.cue-nade .cn-arrow::before { content: ''; position: absolute; inset: 0; background: var(--c-red); clip-path: polygon(0 0, 100% 50%, 0 100%, 25% 50%); }
.cue-nade small { position: absolute; left: -40px; top: 21px; width: 80px; text-align: center; font: 9px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: #fff; text-shadow: var(--text-lift); text-transform: uppercase; }
.cue-nade.near .cn-face { animation: cue-blink .3s steps(2, jump-none) infinite alternate; }
@keyframes cue-blink { to { box-shadow: inset 0 0 0 2.5px #fff, 0 0 16px var(--c-red-glow); } }
html[data-calm] .cue-nade.near .cn-face { animation: none; }
@media (prefers-reduced-motion: reduce) { .cue-nade.near .cn-face { animation: none; } }
.cue-step { position: absolute; left: 50%; top: 50%; width: 300px; height: 300px; margin: -150px 0 0 -150px; opacity: 0; overflow: visible; will-change: transform, opacity; }
.cue-step path { fill: none; stroke: var(--c-chalk); stroke-width: 4; stroke-linecap: round; filter: drop-shadow(0 0 2px rgba(0,0,0,.9)); }
.cue-step.run path { stroke-width: 6; }
.cue-shot { position: absolute; left: 50%; top: 50%; width: 340px; height: 340px; margin: -170px 0 0 -170px; opacity: 0; overflow: visible; will-change: transform, opacity; }
.cue-shot path { fill: none; stroke: var(--c-red); stroke-width: 6; stroke-dasharray: 9 6; stroke-linecap: butt; filter: drop-shadow(0 0 2px rgba(0,0,0,.9)); }
.cue-caps { position: absolute; left: 50%; bottom: calc(var(--lane-b, 66px) + 108px); transform: translateX(-50%); display: grid; justify-items: center; gap: 3px; pointer-events: none; }
.cue-cap { padding: 3px 9px 4px; background: rgba(10,12,16,.82); color: #fff; font: 400 var(--cap-fs, 13px)/1.25 var(--f-body); white-space: nowrap; opacity: 0; }
.cue-cap.on { opacity: 1; }
html[data-text="large"] .cue-cap { --cap-fs: 14.5px; }
html[data-text="larger"] .cue-cap { --cap-fs: 16px; }
`;
const SHOT_RANGE = 40;      // Metres: unsuppressed gunfire you would clearly hear.
const SHOT_MAX = 4, SHOT_FADE = 0.8;
const CAP_MAX = 3, CAP_S = 3, CAP_SAME_S = 2.5;
const BOOM_RANGE = 34, STEP_CAP_RANGE = 12;
// The side a sound came from, as the screen shows it (the camera looks north: up is -z).
const SIDES = ['right', 'below right', 'below', 'below left', 'left', 'above left', 'above', 'above right'];
export const sideOf = (dx, dz) => SIDES[((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8];

// What counts as a grenade coming your way: thrown things that go off, not traps already lying in wait (mines,
// claymores, tripwires, satchels) or clouds and fire pools.
const NADES = new Set(['frag', 'sticky', 'cluster', 'bomblet', 'molotov', 'impact', 'drill', 'crawler', 'thermite', 'flash', 'stun', 'gas', 'shock']);
const NADE_RANGE = 10;      // Metres: a little past the biggest blast, as far as a bounce is worth reacting to.
const NADE_NEAR = 5;        // Inside this the marker blinks.
const STEP_RANGE = 24;      // js/audio/audio.js STEP_RANGE.
const STEP_SPEED = 2.2;     // js/audio/audio.js: slower than this makes no steps.
const RUN_SPEED = 6.8;
const NADE_MAX = 3, STEP_MAX = 4;
const nameOf = kind => LETHALS[kind]?.name ?? TACTICALS[kind]?.name ?? (kind === 'bomblet' ? 'Bomblet' : 'Grenade');

export class CuesHud {
  constructor(hud) {
    this.hud = hud;
    this.level = 'nades';
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = this.el = document.createElement('div');
    el.className = 'cues';
    el.innerHTML = Array.from({ length: STEP_MAX }, () => '<svg class="cue-step" viewBox="-150 -150 300 300" aria-hidden="true"><path d="M-42 -132 A139 139 0 0 1 42 -132" /></svg>').join('')
      + Array.from({ length: SHOT_MAX }, () => '<svg class="cue-shot" viewBox="-170 -170 340 340" aria-hidden="true"><path d="M-36 -162 A166 166 0 0 1 36 -162" /></svg>').join('')
      + '<div class="cue-caps" role="log" aria-live="polite" aria-label="Sound captions"></div>'
      + Array.from({ length: NADE_MAX }, () => `<div class="cue-nade"><i class="cn-arrow"></i><span class="cn-face">${icon('frag', { size: 20 })}</span><small></small></div>`).join('');
    hud.el.appendChild(el);
    this.steps = [...el.querySelectorAll('.cue-step')].map(node => ({ node, on: false, key: '' }));
    this.nades = [...el.querySelectorAll('.cue-nade')].map(node => ({ node, arrow: node.querySelector('.cn-arrow'), face: node.querySelector('.cn-face'), label: node.querySelector('small'), on: false, kind: '', key: '', near: false }));
    this.pick = [];         // Reused: candidates this frame.
    this.shotsOn = false;
    this.capsOn = false;
    this.shots = [...el.querySelectorAll('.cue-shot')].map(node => ({ node, life: 0, by: null }));
    this.capBox = el.querySelector('.cue-caps');
    this.caps = [];         // { node, life, text }
    this.capLast = new Map();     // text -> last time shown, so a burst is one line.
    this.clock = 0;
  }

  // Gunfire marks and sound captions (Options shotCues, captions).
  setShots(on) { this.shotsOn = !!on; if (!on) for (const s of this.shots) if (s.life > 0) { s.life = 0; s.node.style.opacity = '0'; } this.#sync(); }
  setCaptions(on) { this.capsOn = !!on; if (!on) { for (const c of this.caps) c.node.remove(); this.caps.length = 0; } this.#sync(); }
  #sync() { this.el.hidden = this.level === 'off' && !this.shotsOn && !this.capsOn; }

  // One frame's sim events: gunfire and the captioned sounds. view: the HUD's view; me: the local player.
  onEvents(events, view, me) {
    if (!this.shotsOn && !this.capsOn) return;
    if (!me?.alive || !view) return;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.t === 'shot') {
        if (e.by === me.id || e.sup) continue;
        const dx = e.ox - me.x, dz = e.oz - me.z, d = Math.hypot(dx, dz);
        if (d > SHOT_RANGE) continue;
        const who = view.players.find(p => p.id === e.by);
        if (!who || (who.team === me.team && !view.ffa)) continue;
        if (this.shotsOn) this.#shot(e.by, dx, dz, d);
        if (this.capsOn) this.#cap(`Gunfire, ${sideOf(dx, dz)}`);
      } else if (!this.capsOn) continue;
      else if (e.t === 'explosion' || e.t === 'bang') {
        if (!Number.isFinite(e.x)) continue;
        const dx = e.x - me.x, dz = e.z - me.z, d = Math.hypot(dx, dz);
        if (d <= BOOM_RANGE) this.#cap(d < 4 ? 'Explosion, right here' : `Explosion, ${sideOf(dx, dz)}`);
      } else if (e.t === 'streak') {
        const who = view.players.find(p => p.id === e.id);
        if (who && who.team !== me.team) this.#cap(`Enemy ${STREAKS[e.kind]?.name ?? 'streak'} called`);
      } else if (e.t === 'emp') this.#cap('EMP blast');
    }
  }

  #shot(by, dx, dz, d) {
    let s = this.shots.find(q => q.by === by && q.life > 0) ?? this.shots.find(q => q.life <= 0);
    if (!s) s = this.shots.reduce((a, b) => (a.life < b.life ? a : b));
    s.by = by;
    s.life = SHOT_FADE;
    s.k = Math.max(0.35, 1 - d / SHOT_RANGE);
    const deg = Math.atan2(dz, dx) * 180 / Math.PI + 90;
    s.node.style.transform = `rotate(${deg.toFixed(1)}deg)`;
  }

  #cap(text) {
    const last = this.capLast.get(text);
    if (last !== undefined && this.clock - last < CAP_SAME_S) {
      const c = this.caps.find(q => q.text === text);
      if (c) c.life = CAP_S;
      return;
    }
    this.capLast.set(text, this.clock);
    if (this.capLast.size > 40) this.capLast.clear();
    let c = this.caps.length >= CAP_MAX ? this.caps.shift() : null;
    if (!c) { c = { node: document.createElement('span') }; c.node.className = 'cue-cap'; }
    c.text = text; c.life = CAP_S;
    c.node.textContent = text;
    c.node.classList.add('on');
    this.capBox.appendChild(c.node);
    this.caps.push(c);
  }

  // Fades the gunfire marks and the captions (called from update; dt seconds).
  #age(dt) {
    this.clock += dt;
    for (const s of this.shots) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.node.style.opacity = s.life > 0 ? (s.k * Math.min(1, s.life / SHOT_FADE * 1.4)).toFixed(2) : '0';
    }
    for (let i = this.caps.length - 1; i >= 0; i--) {
      const c = this.caps[i];
      c.life -= dt;
      if (c.life <= 0) { c.node.remove(); this.caps.splice(i, 1); }
    }
  }

  // 'off', 'nades' or 'all' (Options cues).
  setLevel(level) {
    this.level = level;
    this.#sync();
    if (level !== 'all') this.#hideFrom(this.steps, 0);
    if (level === 'off') this.#hideFrom(this.nades, 0);
  }

  reset() { this.#hideFrom(this.steps, 0); this.#hideFrom(this.nades, 0); }

  #hideFrom(list, i) {
    for (; i < list.length; i++) if (list[i].on) { list[i].on = false; list[i].node.style.opacity = '0'; }
  }

  update(view, me, dt = 1 / 60) {
    if (this.shotsOn || this.capsOn) this.#age(dt);
    if (this.level === 'off') return;
    if (!me?.alive || document.body.classList.contains('killcam-on')) { this.reset(); return; }
    const W = this.hud.viewW || innerWidth, H = this.hud.viewH || innerHeight;
    const R = Math.min(W, H) * 0.3;
    // Grenades: nearest first.
    const pick = this.pick;
    pick.length = 0;
    for (const q of view.projectiles ?? []) {
      if (!NADES.has(q.kind) || q.stuck && (q.kind === 'thermite')) continue;
      const d = Math.hypot(q.x - me.x, q.z - me.z);
      if (d > NADE_RANGE) continue;
      if (q.owner !== me.id) {
        const owner = view.players.find(p => p.id === q.owner);
        if (owner && owner.team === me.team) continue;
      }
      pick.push({ q, d });
    }
    pick.sort((a, b) => a.d - b.d);
    let n = 0;
    for (; n < Math.min(NADE_MAX, pick.length); n++) {
      const { q, d } = pick[n], s = this.nades[n];
      const a = Math.atan2(q.z - me.z, q.x - me.x);
      // Close in, the marker sits nearer the middle; it never covers the player at the centre.
      const r = R * (0.55 + 0.45 * Math.min(1, d / NADE_RANGE));
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      s.node.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      s.arrow.style.transform = `rotate(${a.toFixed(3)}rad) translateX(27px)`;
      if (s.kind !== q.kind) {
        s.kind = q.kind;
        s.face.innerHTML = icon(q.kind === 'bomblet' ? 'cluster' : q.kind, { size: 20 });
        s.label.textContent = nameOf(q.kind);
      }
      const near = d < NADE_NEAR;
      if (near !== s.near) { s.near = near; s.node.classList.toggle('near', near); }
      if (!s.on) { s.on = true; s.node.style.opacity = '1'; }
    }
    this.#hideFrom(this.nades, n);

    if (this.level !== 'all') return;
    pick.length = 0;
    for (const p of view.players) {
      if (p.team === me.team || !p.alive || p.quiet || p.sliding) continue;
      const speed = Math.hypot(p.vx ?? 0, p.vz ?? 0);
      if (speed < STEP_SPEED) continue;
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d > STEP_RANGE) continue;
      pick.push({ q: p, d, run: speed > RUN_SPEED || p.sprinting });
    }
    pick.sort((a, b) => a.d - b.d);
    n = 0;
    for (; n < Math.min(STEP_MAX, pick.length); n++) {
      const { q, d, run } = pick[n], s = this.steps[n];
      const deg = Math.atan2(q.z - me.z, q.x - me.x) * 180 / Math.PI + 90;
      s.node.style.transform = `rotate(${deg.toFixed(1)}deg)`;
      // Louder (nearer, running) reads stronger, the same falloff as the sound's gain.
      s.node.style.opacity = ((run ? 0.85 : 0.55) * Math.max(0.25, 1 - d / STEP_RANGE)).toFixed(2);
      if (s.run !== run) { s.run = run; s.node.classList.toggle('run', run); }
      s.on = true;
    }
    this.#hideFrom(this.steps, n);
  }
}
