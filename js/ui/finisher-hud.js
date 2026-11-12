// Finishers and emotes on the match HUD (docs/FINISHERS.md), its own module like zm-hud.js:
//  - the Finish button, in the prompt lane over the dock, while an enemy is in finishing reach (view.finTarget, which
//    js/game/match.js works out every frame). A controller's Melee does the same (match.js), so does a blade's swing.
//  - an Emote chip in the HUD corner beside quick chat, opening a 4 x 2 wheel in the quick chat wheel's style: a tap
//    plays the emote (locked ones say what earns them). Moving or firing ends an emote early (js/render/characters.js).
//  - while a squadmate (or you) is aboard the battle royale transport, where nobody is drawn, an emote shows as a line
//    in the feed instead.
// js/ui/hud.js makes one and forwards prepare/update/onEvent; main.js wires onCommand to the match.
import { icon } from './icons.js';
import { esc } from './widgets.js';
import { EMOTES, unlockText } from '../shared/finishers.js';
import { TEAMS } from '../shared/constants.js';

const CSS = `
.fin-btn { position: absolute; left: var(--lane-x, 50%); bottom: calc(var(--lane-b, 64px) + 50px); transform: translateX(-50%); z-index: var(--z-hud-alert);
  height: 46px; min-width: 132px; padding: 0 16px; border: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: auto;
  font: 400 19px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #fff; background: linear-gradient(180deg, #d8402e, #8e1c12);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); box-shadow: 0 0 0 2px rgba(255,255,255,.75) inset;
  animation: fin-in .16s ease-out both; touch-action: manipulation; }
.fin-btn small { font: 10px/1.1 var(--f-plate); letter-spacing: var(--tr-plate); margin-top: 3px; opacity: .9; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fin-btn[hidden] { display: none; }
.fin-btn.pressed, .fin-btn:active { filter: brightness(1.25); }
@keyframes fin-in { from { opacity: 0; transform: translateX(-50%) scale(.9); } }
body.pad-on .fin-btn::after { content: var(--pad-melee, "RS"); position: absolute; right: -6px; top: -8px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px;
  background: rgba(16,20,26,.92); color: #fff; font: 700 11px/18px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 1.5px rgba(255,255,255,.6); }
.em-btn.on { background: var(--face-sodium); }
.em-btn.on .gl { color: var(--c-sodium-ink); }
.em-wheel { position: absolute; right: calc(var(--sr) + 8px); top: calc(var(--st) + 46px); z-index: var(--z-hud-alert);
  display: grid; grid-template-columns: repeat(4, 86px); grid-auto-rows: 34px; gap: 3px; padding: 3px; pointer-events: auto;
  background: var(--hud-glass); box-shadow: var(--hud-edge), inset 0 2px 0 var(--c-sodium);
  --cut: var(--cut-sm); clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut));
  transform-origin: top right; animation: qc-in var(--dur-fast) var(--ease-out) both; }
.em-wheel[hidden] { display: none; }
.hud.lefty .em-wheel { right: auto; left: calc(var(--sl) + 8px); transform-origin: top left; }
.em-item { display: flex; align-items: center; gap: 5px; padding: 0 6px; min-width: 0; text-align: left; color: var(--c-chalk);
  background: rgba(47,57,68,.9); box-shadow: inset 0 0 0 1px rgba(231,234,228,.1); touch-action: manipulation; }
.em-item b { font: 400 var(--fs-caption)/1.05 var(--f-plate); letter-spacing: .04em; overflow: hidden; }
.em-item .qc-ico { color: var(--c-sodium); }
.em-item.locked { opacity: .45; }
.em-item.locked .qc-ico { color: var(--c-haze); }
.em-item.pressed { background: var(--face-sodium); color: var(--c-sodium-ink); }
.em-wheel.cool .em-item:not(.locked) { opacity: .6; }
.f-fin { margin: 0 3px; padding: 0 4px; font: 400 10px/14px var(--f-stencil); letter-spacing: var(--tr-stencil); color: #fff; background: #b02a1c; }
`;

const WHEEL_MS = 5000;
const COOL_MS = 1200;

export class FinHud {
  constructor(hud) {
    this.hud = hud;
    this.cmd = null;
    this.enabled = false;
    this.open = new Set(EMOTES.filter(e => !Object.keys(e.unlock).length).map(e => e.id));
    this.sentAt = 0;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.btn = document.createElement('button');
    this.btn.className = 'fin-btn';
    this.btn.type = 'button';
    this.btn.hidden = true;
    this.btn.dataset.tap = 'finish';
    this.btn.dataset.sound = 'none';
    this.btn.innerHTML = '<span class="t">FINISH</span><small></small>';
    this.btnName = this.btn.querySelector('small');
    this.btn.addEventListener('click', e => { e.stopPropagation(); this.cmd?.('finish'); });
    hud.el.appendChild(this.btn);

    this.chip = document.createElement('button');
    this.chip.className = 'chip-btn em-btn';
    this.chip.type = 'button';
    this.chip.hidden = true;
    this.chip.dataset.tap = 'emote';
    this.chip.dataset.sound = 'tab';
    this.chip.setAttribute('aria-label', 'Emotes');
    this.chip.innerHTML = icon('ui:user', { size: 19, cls: 'gl' });
    const corner = hud.el.querySelector('.corner');
    if (corner) corner.prepend(this.chip); else hud.el.appendChild(this.chip);
    this.chip.addEventListener('click', () => this.#show(this.wheel.hidden));

    this.wheel = document.createElement('div');
    this.wheel.className = 'em-wheel';
    this.wheel.hidden = true;
    this.wheel.setAttribute('role', 'menu');
    hud.el.appendChild(this.wheel);
    this.wheel.addEventListener('click', e => {
      const item = e.target.closest?.('.em-item');
      if (item) this.play(Number(item.dataset.e));
    });
    this.#fill();
  }

  onCommand(cb) { this.cmd = cb; }

  // `emotes`: the ids this save has open (main.js reads Progress). `enabled` false in the tutorial and the range.
  prepare({ enabled = true, emotes = null, localId = null } = {}) {
    this.enabled = enabled;
    this.localId = localId;
    if (emotes) this.open = new Set(emotes);
    this.chip.hidden = !enabled;
    this.btn.hidden = true;
    this.target = null;
    this.#show(false);
    this.#fill();
  }

  stop() { this.enabled = false; this.chip.hidden = true; this.btn.hidden = true; this.#show(false); }

  #fill() {
    this.wheel.innerHTML = EMOTES.map((em, i) => {
      const on = this.open.has(em.id);
      return `<button class="em-item${on ? '' : ' locked'}" type="button" role="menuitem" data-tap="emote" data-e="${i}" data-sound="none">
        <span class="qc-ico">${icon(on ? em.icon : 'ui:lock', { size: 15 })}</span><b>${esc(em.name)}</b></button>`;
    }).join('');
  }

  #show(on) {
    clearTimeout(this.timer);
    if (on) {
      // One wheel at a time: quick chat's goes away.
      const qc = this.hud.el.querySelector('.qc-wheel');
      if (qc && !qc.hidden) this.hud.el.querySelector('.qc-btn')?.click();
    }
    this.wheel.hidden = !on;
    this.chip.classList.toggle('on', on);
    if (on) {
      this.wheel.classList.toggle('cool', performance.now() - this.sentAt < COOL_MS);
      this.timer = setTimeout(() => this.#show(false), WHEEL_MS);
    }
  }

  play(i) {
    const em = EMOTES[i];
    if (!em) return;
    if (!this.open.has(em.id)) { this.hud.notify?.(`${em.name}: ${unlockText(em.unlock)}`); return; }
    const now = performance.now();
    if (now - this.sentAt < COOL_MS) return;
    this.sentAt = now;
    this.#show(false);
    this.cmd?.('emote', i);
  }

  update(view, me) {
    if (!this.enabled) return;
    const id = me?.alive && !me.fin ? view.finTarget : null;
    if (id !== this.target) {
      this.target = id;
      this.btn.hidden = !id;
      if (id) {
        const p = view.players.find(q => q.id === id);
        this.btnName.textContent = p ? `${p.downed ? 'Downed: ' : ''}${p.name}` : '';
      }
    }
    const alive = !!me?.alive;
    if (this.chip.hidden === alive) { this.chip.hidden = !alive; if (!alive) this.#show(false); }
  }

  // Emotes nobody can see (aboard the transport) go in the feed for the emoter's side.
  onEvent(e, view) {
    if (e.t !== 'emote' || !view) return;
    const p = view.players.find(q => q.id === e.id), me = view.players.find(q => q.id === view.localId);
    if (!p || p.air !== 1 || (me && p.team !== me.team)) return;
    const em = EMOTES[e.e];
    if (!em) return;
    this.hud.pushFeed?.(`<span class="qc-ico">${icon(em.icon, { size: 12 })}</span><em style="color:${TEAMS[p.team]?.css ?? '#fff'}">${esc(p.name)}</em><span class="qc-say">${esc(em.name)}</span>`, e.id === view.localId, 'ally');
  }
}
