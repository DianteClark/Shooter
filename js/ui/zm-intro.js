// Graveyard Shift's boss intros (ROADMAP item 50, docs/ZOMBIES.md "Bodies"): when the Yardmaster, the Gravewarden, the
// Listener, the Barker or the Ferryman rises, a short camera beat and a title card. The renderer's bodies (js/render/zm-bodies.js) start it,
// GameRenderer steps it and leans the camera toward the boss for a moment (never taking the player's controls: the
// match runs on underneath), and the zombies HUD shows the card. Tapping the card skips it (the camera eases straight
// back). Reduced motion: no camera move, the card fades in and out where it stands.
import { reducedMotion } from './motion.js';

const TITLES = {
  4: ['The Yardmaster', 'Foreman of the dead shift'],
  5: ['The Gravewarden', 'Keeper of the last lantern'],
  11: ['The Listener', 'It heard the radios'],
  12: ['The Barker', 'The show must go on'],
  13: ['The Ferryman', 'Pays its toll in the drowned'],
};
const EASE = 0.5;

export const ZM_INTRO = {
  on: false, t: 0, dur: 2.9, zk: 0, x: 0, z: 0, still: false, seq: 0, skipped: false,
  start(zk, x, z) {
    if (!TITLES[zk]) return;
    Object.assign(this, { on: true, t: 0, zk, x, z, still: reducedMotion(), skipped: false });
    this.seq++;
  },
  // Straight to the ease back.
  skip() { if (this.on && !this.skipped) { this.skipped = true; this.t = Math.max(this.t, this.dur - EASE); } },
  step(dt) { if (this.on) { this.t += dt; if (this.t >= this.dur) this.on = false; } },
  // How far the camera leans to the boss, 0..1 (eased in and out).
  cam() {
    if (!this.on || this.still) return 0;
    const k = Math.max(0, Math.min(1, this.t / EASE, (this.dur - this.t) / EASE));
    return k * k * (3 - 2 * k);
  },
  reset() { this.on = false; },
};

const CSS = `
.zm-intro { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); min-width: 280px; padding: 10px 26px 9px; text-align: center;
  background: linear-gradient(180deg, rgba(12,10,14,.0), rgba(12,10,14,.82) 22%, rgba(12,10,14,.82) 78%, rgba(12,10,14,0));
  opacity: 0; transition: opacity .25s ease-out; pointer-events: auto; }
.zm-intro.on { opacity: 1; }
.zm-intro small { display: block; font: 10px/1 var(--f-plate); letter-spacing: .32em; color: #ff5446; text-transform: uppercase; }
.zm-intro b { display: block; margin: 6px 0 4px; font: 400 38px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk, #e7eae4);
  text-transform: uppercase; text-shadow: 0 0 18px var(--zm-glow, rgba(255,120,30,.6)); white-space: nowrap; }
.zm-intro i { display: block; font: italic 13px/1.2 var(--f-plate); color: var(--c-haze, #a9b0a8); font-style: italic; }
.zm-intro em { display: block; margin-top: 7px; font: 9px/1 var(--f-plate); font-style: normal; letter-spacing: .2em; color: rgba(231,234,228,.5); text-transform: uppercase; }
.zm-intro .zm-ib { height: 2px; margin: 6px auto 0; width: 70%; background: var(--zm-glow, #ff7a1a); transform-origin: center; }
.zm-intro.anim b { animation: zmIntroIn .5s cubic-bezier(.2,.9,.3,1.2) both; }
.zm-intro.anim .zm-ib { animation: zmIntroBar .6s .1s ease-out both; }
@keyframes zmIntroIn { from { transform: scale(1.35); letter-spacing: .4em; opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes zmIntroBar { from { transform: scaleX(0); } to { transform: none; } }
@media (max-height: 400px) { .zm-intro { top: 17%; } .zm-intro b { font-size: 31px; } }
`;
const GLOW = { 4: 'rgba(255,122,26,.75)', 5: 'rgba(176,112,255,.75)', 11: 'rgba(90,240,255,.7)', 12: 'rgba(255,192,64,.75)', 13: 'rgba(90,255,208,.7)' };

export class ZmIntroCard {
  constructor(parent) {
    if (!document.getElementById('zm-intro-css')) {
      const st = document.createElement('style');
      st.id = 'zm-intro-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = this.el = document.createElement('div');
    el.className = 'zm-intro';
    el.dataset.tap = '1';
    el.hidden = true;
    el.innerHTML = '<small>Boss</small><b></b><i></i><div class="zm-ib"></div><em>Tap to skip</em>';
    parent.appendChild(el);
    el.addEventListener('click', e => { e.stopPropagation(); ZM_INTRO.skip(); });
    el.addEventListener('touchstart', e => { e.stopPropagation(); ZM_INTRO.skip(); }, { passive: true });
    this.seq = 0;
  }

  update() {
    const I = ZM_INTRO, el = this.el;
    if (I.on && I.seq !== this.seq) {
      this.seq = I.seq;
      const [name, line] = TITLES[I.zk];
      el.querySelector('b').textContent = name;
      el.querySelector('i').textContent = line;
      el.style.setProperty('--zm-glow', GLOW[I.zk]);
      el.classList.toggle('anim', !I.still);
      el.hidden = false;
      void el.offsetWidth;
      el.classList.add('on');
    }
    const showing = I.on && I.t < I.dur - 0.3;
    if (!showing && el.classList.contains('on')) el.classList.remove('on');
    if (!I.on && !el.hidden && !this.hideT) this.hideT = setTimeout(() => { this.hideT = 0; if (!ZM_INTRO.on) el.hidden = true; }, 300);
  }

  hide() { this.el.classList.remove('on'); this.el.hidden = true; }
}
