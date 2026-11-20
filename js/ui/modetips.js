// First-time mode tips on the match screen (js/shared/mode-tips.js, docs/TUTORIAL.md): one small card the first time a
// player enters a mode, shown once, Got it to dismiss (it also goes by itself). Built on first use; with nothing to say
// it costs nothing at all, and it never runs per frame.
import { Options } from './options.js';
import { tipFor, markSeen } from '../shared/mode-tips.js';
import { reducedMotion } from './motion.js';
import { esc } from './widgets.js';
import { icon } from './icons.js';

const SHOW_MS = 14000;
const CSS = `
#ui .mtip { position: absolute; left: 50%; top: calc(var(--env-t, 0px) + 30%); transform: translateX(-50%); z-index: var(--z-hud-alert); width: max-content; max-width: min(440px, 66vw);
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 4px 12px; padding: 10px 12px 10px 14px; background: rgba(10,12,16,.9);
  box-shadow: inset 3px 0 0 var(--c-sodium), inset 0 0 0 1px rgba(255,255,255,.14); color: var(--c-chalk); pointer-events: auto; }
#ui .mtip[hidden] { display: none; }
#ui .mtip > svg { grid-row: 1 / 3; color: var(--c-sodium); }
#ui .mtip h3 { margin: 0; font: 400 15px/1 var(--f-stencil); letter-spacing: .08em; color: var(--c-sodium); }
#ui .mtip h3 small { margin-left: 8px; font: 400 10px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); }
#ui .mtip p { grid-column: 2; margin: 0; font: 400 var(--mtip-fs, 13px)/1.3 var(--f-body); }
html[data-text="large"] #ui .mtip { --mtip-fs: 14.5px; }
html[data-text="larger"] #ui .mtip { --mtip-fs: 16px; }
#ui .mtip button { grid-column: 3; grid-row: 1 / 3; height: 40px; min-width: 64px; padding: 0 12px; font: 400 14px/1 var(--f-stencil); letter-spacing: .06em;
  color: var(--c-sodium-ink); background: var(--face-sodium); box-shadow: var(--bevel-sodium); touch-action: manipulation; }
`;

export class ModeTips {
  constructor(root) {
    this.root = root;
    this.el = null;
    this.timer = 0;
  }

  // At a match's start. Returns the tip shown, or null. enabled false: the tutorial, Training, the range, replays.
  show(mode, { enabled = true } = {}) {
    clearInterval(this.poll);
    clearTimeout(this.timer);
    if (!enabled) return null;
    const tip = tipFor(mode, Options.get('tipsSeen'));
    if (!tip) return null;
    Options.set('tipsSeen', markSeen(Options.get('tipsSeen'), tip.key));
    if (!this.el) {
      const s = document.createElement('style');
      s.textContent = CSS;
      document.head.appendChild(s);
      this.el = document.createElement('div');
      this.el.className = 'mtip';
      this.el.setAttribute('role', 'dialog');
      this.el.setAttribute('aria-live', 'polite');
      this.el.hidden = true;
      this.el.addEventListener('click', e => { if (e.target.closest('button')) this.hide(); });
      this.root.appendChild(this.el);
    }
    this.el.setAttribute('aria-label', `Tip: ${tip.title}`);
    this.el.innerHTML = `${icon('ui:info', { size: 26 })}<h3>${esc(tip.title)}<small>First time</small></h3><p>${tip.lines.map(esc).join(' ')}${tip.video ? ' <i>Help has a video of it.</i>' : ''}</p>
      <button data-sound="confirm" aria-label="Got it, close the tip">Got it</button>`;
    this.el.hidden = false;
    if (!reducedMotion()) this.el.animate?.([{ opacity: 0, transform: 'translate(-50%, -8px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 260, easing: 'cubic-bezier(.16,.84,.3,1)' });
    this.timer = setTimeout(() => this.hide(), SHOW_MS);
    return tip;
  }

  // Waits for the match intro to finish (ready() true: the match is live) before showing, so the tip never sits over the
  // intro's map card. Polled four times a second, never per frame; given up after a minute.
  showWhen(ready, mode, opts) {
    this.hide();
    if (opts?.enabled === false) return;
    let n = 0;
    this.poll = setInterval(() => {
      if (++n > 240) { clearInterval(this.poll); return; }
      if (!ready()) return;
      clearInterval(this.poll);
      this.show(mode, opts);
    }, 250);
  }

  hide() {
    clearInterval(this.poll);
    clearTimeout(this.timer);
    if (this.el) this.el.hidden = true;
  }

  get shown() { return !!this.el && !this.el.hidden; }
}
