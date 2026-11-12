// Extraction HUD (docs/EXTRACT.md): everything an extraction match adds on top of the ordinary HUD, which owns one of
// these and calls it from a few hooks (prepare, update, onEvent, drawMini, miniWindow, endBanner). Plain DOM plus one
// canvas for the big map.
//
//   top       match clock, the squad's lives, the pending pot (contracts and XP), the exfil status
//   squad     each squadmate's health, down, out and lifted-out marks
//   contract  the squad's contract: what, where, the next step, progress, how far
//   actions   Call exfil (in an open zone), Contracts (at a phone: the offers sheet)
//   marks     screen markers on the objective, the intel drop, open exfil zones and the nearest phone
//   down      the downed overlay; your own revive bar while you pick someone up
//   held      out of lives or lifted out: what happened and who you are watching (the death screen goes)
//   map       the full map on a tap of the minimap: places, phones, exfil sites, your contract
import { EX, EX_AI_TEAM, CONTRACT_NAMES, BR, MODES } from '../shared/modes.js';
import { MAX_HP, TEAMS } from '../shared/constants.js';
import { objOf } from '../sim/rules.js';
import { spectate } from '../sim/snd.js';
import { esc, nameHtml } from './widgets.js';
import { icon } from './icons.js';

const clock = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const MAP_PX = 640, MINI_SPAN = 120, MARK_Y = 1.6, TAGS = 6;
export const AI_CSS = '#ff6a3c';
const TIER = ['', 'Tier 1', 'Tier 2', 'Tier 3'];
const xpOf = list => list.reduce((n, c) => n + (EX.reward.xp[c.tier] ?? 0), 0);

const CSS = `
.ex-ui { position: absolute; inset: 0; pointer-events: none; z-index: var(--z-hud-alert); }
.ex-ui [data-tap] { pointer-events: auto; }
.ex-ui .ex-map, .ex-ui .ex-offers { z-index: var(--z-overlay); }
.hud.ex-on .scorebar, .hud.ex-on .obj-strip, .hud.ex-on .gun-rung { display: none !important; }
.hud.ex-on .feed { top: calc(var(--st) + 134px); }
.hud.ex-held .death { display: none !important; }
.hud.ex-on .minimap { cursor: pointer; pointer-events: auto; z-index: var(--z-hud-alert); }
.ex-top { position: absolute; left: 50%; top: calc(var(--st) + 6px); transform: translateX(-50%); display: flex; gap: 4px; }
.ex-chip { display: flex; flex-direction: column; justify-content: center; align-items: center; min-width: 50px; height: 38px; padding: 0 8px;
  background: linear-gradient(180deg, rgba(42,51,61,.94), rgba(16,20,26,.9)); box-shadow: var(--hud-edge);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); }
.ex-chip b { font: 400 19px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); font-variant-numeric: tabular-nums; white-space: nowrap; display: flex; align-items: center; gap: 3px; }
.ex-chip small { font: 9px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); margin-top: 2px; white-space: nowrap; }
.ex-chip.low b { color: #ff8a7c; }
.ex-chip.go { box-shadow: var(--hud-edge), inset 0 -2px 0 var(--c-go, #59d36b); }
.ex-chip.go b { color: #8ff09c; }
.ex-chip.warn { box-shadow: var(--hud-edge), inset 0 -2px 0 var(--c-sodium); }
.ex-chip.warn b { color: var(--c-sodium); }
.ex-exfil { min-width: 96px; }
.ex-pot b { color: var(--c-sodium); }
.ex-squad { position: absolute; left: calc(var(--sl) + 134px); top: calc(var(--st) + 6px); display: flex; flex-direction: column; gap: 3px; width: 84px; }
.ex-mate { display: grid; grid-template-columns: 1fr auto; gap: 1px 4px; padding: 3px 5px 3px 7px; background: var(--hud-glass-lo, rgba(16,20,26,.6)); box-shadow: inset 2px 0 0 var(--team); }
.ex-mate b { font: 11px/1 var(--f-plate); letter-spacing: .04em; color: var(--c-chalk); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ex-mate em { font: 9px/1 var(--f-plate); font-style: normal; letter-spacing: var(--tr-plate); color: var(--c-haze); }
.ex-mate i { grid-column: 1 / 3; height: 4px; background: rgba(231,234,228,.12); position: relative; overflow: hidden; }
.ex-mate i::after { content: ''; position: absolute; inset: 0; background: var(--bar, var(--c-chalk)); transform-origin: left; transform: scaleX(var(--k, 0)); }
.ex-mate.down { box-shadow: inset 2px 0 0 var(--c-red); background: rgba(120,28,20,.55); }
.ex-mate.down em { color: #ff9a8c; }
.ex-mate.out { opacity: .4; }
.ex-mate.lifted { box-shadow: inset 2px 0 0 #59d36b; }
.ex-mate.lifted em { color: #8ff09c; }
.hud.lefty .ex-squad { left: auto; right: calc(var(--sr) + 134px); }
.ex-con { position: absolute; right: calc(var(--sr) + 8px); top: calc(var(--st) + 48px); width: 178px; padding: 7px 9px 8px; display: grid; grid-template-columns: 26px 1fr; gap: 2px 7px;
  background: linear-gradient(180deg, rgba(42,51,61,.9), rgba(16,20,26,.86)); box-shadow: var(--hud-edge), inset 3px 0 0 var(--c-sodium);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); }
.ex-con .ci { grid-row: 1 / 3; color: var(--c-sodium); display: grid; place-items: center; }
.ex-con b { font: 400 15px/1.05 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ex-con small { font: 9px/1.1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ex-con p { grid-column: 1 / 3; margin: 3px 0 0; font: 11px/1.25 var(--f-plate); letter-spacing: .02em; color: var(--c-chalk); }
.ex-con p em { font-style: normal; color: var(--c-sodium); }
.ex-con .ex-bar { grid-column: 1 / 3; height: 4px; margin-top: 3px; background: rgba(231,234,228,.14); position: relative; overflow: hidden; }
.ex-con .ex-bar div { position: absolute; inset: 0; background: var(--c-sodium); transform-origin: left; transform: scaleX(var(--k, 0)); }
.ex-con.warn { box-shadow: var(--hud-edge), inset 3px 0 0 var(--c-red); }
.ex-con.warn .ex-bar div { background: var(--c-red); }
.hud.lefty .ex-con { right: auto; left: calc(var(--sl) + 8px); top: calc(var(--st) + 92px); }
.ex-acts { position: absolute; left: 50%; bottom: calc(var(--sb) + 66px); transform: translateX(-50%); display: flex; gap: 8px; }
.ex-act { height: 48px; min-width: 128px; padding: 0 16px; border: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  font: 400 21px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-night); background: var(--c-sodium);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); box-shadow: 0 0 0 2px #fff inset; }
.ex-act small { font: 9px/1 var(--f-plate); letter-spacing: var(--tr-plate); margin-top: 2px; }
.ex-act.alt { color: var(--c-chalk); background: linear-gradient(180deg, rgba(74,62,30,.96), rgba(32,28,16,.94)); box-shadow: 0 0 0 2px var(--c-sodium) inset; }
.ex-act:active { filter: brightness(1.3); }
.ex-hold { position: absolute; left: 50%; top: calc(var(--st) + 50px); transform: translateX(-50%); width: 210px; padding: 5px 10px 7px; text-align: center;
  background: var(--hud-glass, rgba(16,20,26,.78)); clip-path: polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px); }
.ex-hold b { display: block; font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #8ff09c; }
.ex-hold.contested b { color: #ff8a7c; }
.ex-hold i { display: block; height: 5px; margin-top: 5px; background: rgba(231,234,228,.15); position: relative; overflow: hidden; }
.ex-hold i i { position: absolute; inset: 0; margin: 0; height: auto; background: #59d36b; transform-origin: left; transform: scaleX(0); }
.ex-tag { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; }
.ex-tag span { position: absolute; transform: translate(-50%, -100%); display: flex; align-items: center; gap: 3px; padding: 2px 6px 2px 4px; white-space: nowrap;
  font: 400 12px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-night); background: var(--c-sodium);
  clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px); }
.ex-tag span small { font: 9px/1 var(--f-plate); letter-spacing: .02em; opacity: .8; }
.ex-tag.go span { background: #8ff09c; }
.ex-tag.open span { background: var(--c-chalk); }
.ex-tag.phone span { background: rgba(224,169,42,.85); }
.ex-tag.warn span { background: #ff8a7c; }
.ex-down { position: absolute; left: 50%; top: 30%; transform: translateX(-50%); width: 250px; text-align: center; }
.ex-down b { display: block; font: 400 30px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #ff6b5c; text-shadow: 0 2px 0 rgba(0,0,0,.5); }
.ex-down small { display: block; font: 12px/1.3 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); margin: 5px 0 8px; text-shadow: var(--text-lift); }
.ex-down .bleed, .ex-down .rev { height: 6px; background: rgba(16,20,26,.8); margin: 4px 0; position: relative; overflow: hidden; }
.ex-down .bleed i, .ex-down .rev i { position: absolute; inset: 0; transform-origin: left; transform: scaleX(0); }
.ex-down .bleed i { background: var(--c-red); }
.ex-down .rev i { background: #59d36b; }
.hud.ex-down-on .vignette { opacity: 1 !important; background: radial-gradient(ellipse at center, transparent 40%, rgba(150,20,12,.55)); }
.ex-rev { position: absolute; left: 50%; top: calc(var(--st) + 50px); transform: translateX(-50%); width: 190px; padding: 6px 10px 7px; text-align: center;
  background: var(--hud-glass, rgba(16,20,26,.78)); clip-path: polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px); }
.ex-rev b { display: block; font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #7be08a; }
.ex-rev i { display: block; height: 5px; margin-top: 5px; background: rgba(231,234,228,.15); position: relative; overflow: hidden; }
.ex-rev i i { position: absolute; inset: 0; margin: 0; height: auto; background: #59d36b; transform-origin: left; transform: scaleX(0); }
.ex-held.won b, .ex-held.won .place { color: #8ff09c; }
.ex-lives-note { position: absolute; left: 50%; top: calc(var(--st) + 50px); transform: translateX(-50%); padding: 4px 10px; font: 12px/1 var(--f-plate); letter-spacing: var(--tr-plate);
  color: var(--c-chalk); background: var(--hud-glass, rgba(16,20,26,.78)); white-space: nowrap; }
.hud.ex-offers-on .ex-acts { visibility: hidden; }
.ex-offers { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(10,13,17,.66); pointer-events: auto; }
.ex-offers h3 { margin: 0; font: 400 24px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); }
.ex-offers h3 small { display: block; margin-top: 4px; font: 11px/1.2 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); }
.ex-offer-row { display: flex; gap: 8px; max-width: calc(100vw - var(--sl) - var(--sr) - 24px); }
.ex-offer { width: 168px; min-height: 128px; padding: 10px; border: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; color: var(--c-chalk);
  background: linear-gradient(180deg, rgba(42,51,61,.96), rgba(16,20,26,.94)); box-shadow: var(--hud-edge), inset 0 3px 0 var(--c-sodium);
  clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px); }
.ex-offer .oi { color: var(--c-sodium); }
.ex-offer b { font: 400 17px/1.05 var(--f-stencil); letter-spacing: var(--tr-stencil); }
.ex-offer small { font: 10px/1.25 var(--f-plate); letter-spacing: .02em; color: var(--c-haze); }
.ex-offer em { font: 400 13px/1 var(--f-stencil); font-style: normal; color: var(--c-sodium); margin-top: auto; }
.ex-offer:active { filter: brightness(1.3); }
.ex-offer.cur { opacity: .5; }
.ex-offers .close { height: 36px; border: 0; padding: 0 18px; font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); background: rgba(42,51,61,.95); box-shadow: var(--hud-edge); }
.ex-map { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 14px; background: rgba(10,13,17,.62); pointer-events: auto; }
.ex-map-frame { height: min(calc(100vh - 24px), 92vw); aspect-ratio: 1; box-shadow: 0 0 0 1px rgba(231,234,228,.3), 0 0 0 4px rgba(16,20,26,.7); }
.ex-map canvas { width: 100%; height: 100%; display: block; }
.ex-map-side { display: flex; flex-direction: column; gap: 8px; max-width: 190px; }
.ex-map-side h3 { margin: 0; font: 400 24px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); }
.ex-map-side p { margin: 0; font: 12px/1.35 var(--f-body); color: var(--c-haze); }
.ex-map-side button { height: 36px; border: 0; padding: 0 14px; font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); background: rgba(42,51,61,.95); box-shadow: var(--hud-edge); }
.ex-callout { position: absolute; left: 50%; top: 30%; transform: translateX(-50%); text-align: center; pointer-events: none; animation: ex-call 3.4s ease-out forwards; }
.ex-callout b { display: block; font: 400 34px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-sodium); text-shadow: 0 2px 0 rgba(0,0,0,.55), 0 0 18px rgba(255,190,60,.35); white-space: nowrap; }
.ex-callout small { display: block; margin-top: 4px; font: 13px/1.2 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); text-shadow: var(--text-lift); }
@keyframes ex-call { 0% { opacity: 0; transform: translateX(-50%) scale(1.3); } 10% { opacity: 1; transform: translateX(-50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }
@media (max-width: 700px) {
  .ex-top { gap: 3px; transform: translateX(calc(-50% + 14px)); }
  .ex-chip { min-width: 40px; padding: 0 5px; }
  .ex-chip b { font-size: 16px; }
  .ex-chip small { font-size: 8px; }
  .ex-exfil { min-width: 80px; }
  .ex-squad { width: 74px; }
  .ex-con { width: 160px; }
  .ex-offer { width: 150px; }
}
`;

export class ExHud {
  constructor(hud) {
    this.hud = hud;
    this.on = false;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = this.el = document.createElement('div');
    el.className = 'ex-ui';
    el.hidden = true;
    el.innerHTML = `
      <div class="ex-top">
        <div class="ex-chip ex-clock"><b>15:00</b><small>Match</small></div>
        <div class="ex-chip ex-lives"><b>${icon('ex:lives', { size: 15 })}<span>8</span></b><small>Lives</small></div>
        <div class="ex-chip ex-pot"><b>0</b><small>Pending</small></div>
        <div class="ex-chip ex-exfil"><b>3:30</b><small>Exfil opens</small></div>
      </div>
      <div class="ex-squad"></div>
      <div class="ex-con" hidden><span class="ci"></span><b></b><small></small><p></p><div class="ex-bar"><div></div></div></div>
      <div class="ex-acts">
        <button class="ex-act ex-call" data-tap="1" hidden>CALL EXFIL<small>Helicopter in ${EX.inbound} s</small></button>
        <button class="ex-act alt ex-phone" data-tap="1" hidden>CONTRACTS<small>Pick a new one</small></button>
      </div>
      <div class="ex-hold" hidden><b>Hold the zone</b><i><i></i></i></div>
      <div class="ex-lives-note" hidden></div>
      ${'<div class="ex-tag" hidden><span></span></div>'.repeat(TAGS)}
      <div class="ex-down" hidden><b>Down</b><small></small><div class="bleed"><i></i></div><div class="rev"><i></i></div></div>
      <div class="ex-rev" hidden><b>Reviving</b><i><i></i></i></div>
      <div class="br-out ex-held" hidden><div class="txt"><b></b><div class="place"></div><small></small></div>
        <div class="acts"><button data-tap="1" class="br-spec go ex-spec">Spectate</button><button data-tap="1" class="br-spec-next quiet ex-spec-next" hidden>Next player</button><button data-tap="1" class="br-spec-squad quiet ex-spec-squad" hidden>Next squad</button><button data-tap="1" class="br-leave ex-leave">Leave</button></div></div>
      <div class="ex-offers" hidden data-tap="1"><h3>Contract phone<small>Take one: it replaces the contract your squad has now</small></h3><div class="ex-offer-row"></div><button class="close" data-tap="1">Close</button></div>
      <div class="ex-map" hidden data-tap="1">
        <div class="ex-map-frame"><canvas width="${MAP_PX}" height="${MAP_PX}"></canvas></div>
        <div class="ex-map-side"><h3>Frontier</h3><p>Gold: your contract. Rings: exfil sites (white open, amber called, green down). Yellow squares: contract phones.</p><button class="ex-map-close" data-tap="1">Close map</button></div>
      </div>`;
    hud.el.appendChild(el);
    const $ = s => el.querySelector(s);
    this.$ = $;
    this.clockEl = $('.ex-clock b'); this.clockS = $('.ex-clock small');
    this.livesChip = $('.ex-lives'); this.livesEl = $('.ex-lives span');
    this.potEl = $('.ex-pot b'); this.potS = $('.ex-pot small');
    this.exfilChip = $('.ex-exfil'); this.exfilEl = $('.ex-exfil b'); this.exfilS = $('.ex-exfil small');
    this.squadEl = $('.ex-squad');
    this.conEl = $('.ex-con');
    this.callBtn = $('.ex-call'); this.phoneBtn = $('.ex-phone');
    this.holdEl = $('.ex-hold'); this.noteEl = $('.ex-lives-note');
    this.tags = [...el.querySelectorAll('.ex-tag')].map(root => ({ root, span: root.querySelector('span'), html: '', x: NaN, y: NaN, cls: '' }));
    this.downEl = $('.ex-down'); this.revEl = $('.ex-rev'); this.heldEl = $('.ex-held');
    this.offersEl = $('.ex-offers'); this.offerRow = $('.ex-offer-row');
    this.mapEl = $('.ex-map'); this.mapCanvas = $('.ex-map canvas'); this.mapG = this.mapCanvas.getContext('2d');
    const act = (node, fn) => node.addEventListener('click', e => { e.stopPropagation(); fn(e); });
    act(this.callBtn, () => this.cmd?.('call'));
    act(this.phoneBtn, () => this.#openOffers(true));
    act($('.ex-offers .close'), () => this.#openOffers(false));
    this.offersEl.addEventListener('click', e => { if (e.target === this.offersEl) this.#openOffers(false); });
    this.offerRow.addEventListener('click', e => {
      const b = e.target.closest('.ex-offer');
      if (!b || this.phone === null) return;
      e.stopPropagation();
      this.cmd?.('take', { phone: this.phone, k: Number(b.dataset.k) });
      this.#openOffers(false);
    });
    act($('.ex-map-close'), () => this.toggleMap(false));
    this.mapEl.addEventListener('click', e => { if (e.target === this.mapEl) this.toggleMap(false); });
    // The battle royale's out panel (js/ui/br-hud.js #out), driven the same way: Spectate opens anyone still playing
    // once your squad has nobody left to watch, Next player / Next squad step through them.
    act($('.ex-spec'), () => { spectate.any = true; this.c.held = null; });
    act($('.ex-spec-next'), () => { if (this.view) spectate.cycle(this.view, this.view.localId, 1); this.c.held = null; });
    act($('.ex-spec-squad'), () => { if (this.view) spectate.cycle(this.view, this.view.localId, 1, true); this.c.held = null; });
    // Out for good: results now for this phone (main.js leaveBrEarly, the battle royale's own Leave), the match goes on.
    act($('.ex-leave'), () => this.hud.brLeaveCb?.());
    this.c = {};
    this.phone = null;
  }

  onCommand(cb) { this.cmd = cb; }

  prepare(on, { map, roster, localId, mode }) {
    this.on = on;
    this.el.hidden = !on;
    this.hud.el.classList.toggle('ex-on', on);
    this.hud.el.classList.remove('ex-held', 'ex-down-on');
    if (!on) return;
    this.map = map; this.roster = roster; this.localId = localId; this.mode = mode;
    this.c = {}; this.base = null; this.phone = null;
    this.#openOffers(false);
    this.toggleMap(false);
    const mm = this.hud.el.querySelector('.minimap');
    if (!this.mmWired) {
      this.mmWired = true;
      mm.setAttribute('data-tap', '1');
      mm.addEventListener('click', () => { if (this.on) this.toggleMap(!this.mapOpen); });
    }
  }

  toggleMap(open) {
    this.mapOpen = open;
    this.mapEl.hidden = !open;
    if (open) this.hud.controls?.showAimHint(false);
  }

  #openOffers(open) {
    this.offersOpen = open;
    this.offersEl.hidden = !open;
    this.hud.el.classList.toggle('ex-offers-on', open);
    this.c.offers = null;
  }

  // ---- Per frame ----

  update(view, me, dt) {
    const ex = objOf(view);
    if (!this.on || !ex?.ex) return;
    this.view = view;
    const c = this.c;
    const squad = ex.squads?.find(s => s.team === me.team) ?? null;
    const live = view.phase === 'live';
    // Top chips.
    const left = live ? (ex.length ?? EX.length) - (ex.t ?? 0) : view.phase === 'warmup' ? view.timeLeft ?? EX.length : 0;
    const clk = clock(left);
    if (c.clk !== clk) { c.clk = clk; this.clockEl.textContent = clk; }
    const lives = squad?.lives ?? 0;
    if (c.lives !== lives) { c.lives = lives; this.livesEl.textContent = lives; this.livesChip.classList.toggle('low', lives <= 2); }
    const pot = squad?.pot ?? [], banked = squad?.banked ?? [];
    const potKey = `${pot.length}|${banked.length}|${squad?.extracted ?? 0}`;
    if (c.pot !== potKey) {
      c.pot = potKey;
      this.potEl.textContent = squad?.extracted ? `${banked.length}` : `${pot.length}`;
      this.potS.textContent = squad?.extracted ? `Banked ${xpOf(banked).toLocaleString('en-US')}` : pot.length ? `${xpOf(pot).toLocaleString('en-US')} XP` : 'Pending';
    }
    const ef = this.#exfilStatus(ex, me);
    if (c.ef !== ef.key) { c.ef = ef.key; this.exfilEl.textContent = ef.big; this.exfilS.textContent = ef.small; this.exfilChip.className = `ex-chip ex-exfil ${ef.cls}`; }
    this.#squad(view, me, ex);
    this.#contract(view, me, squad);
    this.#actions(view, me, ex, squad);
    this.#marks(view, me, ex, squad);
    this.#downed(me);
    this.#reviving(view, me);
    this.#held(view, me, squad);
    if (this.mapOpen) this.#drawBigMap(view, me, ex, squad);
  }

  #exfilStatus(ex, me) {
    const t = ex.t ?? 0;
    const sites = ex.exfils ?? [];
    const landed = sites.filter(e => e.state === 3), inbound = sites.filter(e => e.state === 2), open = sites.filter(e => e.state === 1);
    const near = list => list.reduce((b, e) => (!b || Math.hypot(e.x - me.x, e.z - me.z) < Math.hypot(b.x - me.x, b.z - me.z) ? e : b), null);
    if (landed.length) { const e = near(landed); return { key: `l${e.i}${Math.ceil(e.timer)}`, big: clock(e.timer), small: e.final ? 'Final exfil down' : 'Helicopter down', cls: 'go' }; }
    if (inbound.length) { const e = near(inbound); return { key: `i${e.i}${Math.ceil(e.timer)}`, big: clock(e.timer), small: e.final ? 'Final exfil lands' : 'Helicopter inbound', cls: 'warn' }; }
    if (open.length) { const e = near(open); return { key: `o${open.length}${Math.ceil(e.timer)}`, big: clock(e.timer), small: `${open.length} exfil${open.length > 1 ? 's' : ''} open`, cls: 'go' }; }
    const next = [...EX.windows.map(w => w.open), EX.final.open].find(o => o > t);
    if (next !== undefined) return { key: `n${Math.ceil(next - t)}`, big: clock(next - t), small: next === EX.final.open ? 'Final exfil' : 'Exfil opens', cls: '' };
    return { key: 'none', big: '--', small: 'No exfil', cls: '' };
  }

  #squad(view, me, ex) {
    const mates = view.players.filter(p => p.team === me.team && p.id !== me.id);
    const key = mates.map(p => `${p.id}|${Math.ceil(p.hp / 10)}|${p.alive}|${p.downed}|${p.out}|${p.away}`).join(';');
    if (this.c.squad === key) return;
    this.c.squad = key;
    this.squadEl.innerHTML = mates.map(p => {
      const state = p.out ? 'lifted' : !p.alive ? 'out' : p.downed ? 'down' : '';
      const note = p.out ? 'Out' : !p.alive ? 'Dead' : p.downed ? 'Down' : p.away ? 'Away' : '';
      return `<div class="ex-mate ${state}" style="--team:${TEAMS[p.team]?.css ?? '#fff'}"><b>${nameHtml(p.name)}</b><em>${note}</em>
        <i style="--bar:${p.downed ? 'var(--c-red)' : 'var(--c-chalk)'};--k:${p.alive ? Math.max(0, Math.min(1, p.hp / MAX_HP)).toFixed(2) : 0}"></i></div>`;
    }).join('');
  }

  // The squad's contract: the next step in words, its progress, how far.
  #contract(view, me, squad) {
    const k = squad?.contract;
    const show = !!k && view.phase !== 'ended' && !squad?.done && !me.out;      // Lifted out: nothing left to do.
    if (this.c.conShow !== show) { this.c.conShow = show; this.conEl.hidden = !show; }
    if (!show) return;
    const poi = objOf(view).pois?.[k.poi];
    const goal = this.#goal(k, me);
    const d = Math.round(Math.hypot(goal.x - me.x, goal.z - me.z));
    let step = '', prog = k.prog ?? 0, warn = false;
    switch (k.type) {
      case 'intel': step = k.carrier >= 0 ? (view.players[k.carrier]?.id === me.id ? `Carry the case to the drop <em>${d} m</em>` : `${esc(view.players[k.carrier]?.name ?? 'A teammate')} has the case: cover them`) : k.state === 2 ? `The case is down: pick it up <em>${d} m</em>` : `Find the intel case <em>${d} m</em>`; prog = k.carrier >= 0 ? 0.5 : 0; break;
      case 'hvt': step = `Kill the commander and his guards <em>${d} m</em>`; break;
      case 'cache': warn = k.state === 1 && k.def > 0; step = k.state === 1 ? (warn ? 'They are pulling the charge!' : 'Charge set: get clear and defend it') : prog > 0 ? 'Planting the charge...' : `Reach the cache and stand still to plant <em>${d} m</em>`; break;
      case 'hack': warn = !!k.contested; step = warn ? 'Contested: clear the area' : prog > 0 ? `Hacking: stay within ${EX.hackR} m` : `Hold the terminal area <em>${d} m</em>`; break;
      case 'escort': warn = !k.moving && prog > 0; step = k.moving ? 'Moving: stay beside it' : `Walk with the mule to its point <em>${d} m</em>`; break;
    }
    const key = `${k.id}|${k.type}|${step}|${warn}`;
    if (this.c.con !== key) {
      this.c.con = key;
      this.conEl.querySelector('.ci').innerHTML = icon(`ex:${k.type}`, { size: 24 });
      this.conEl.querySelector('b').textContent = CONTRACT_NAMES[k.type] ?? 'Contract';
      this.conEl.querySelector('small').textContent = `${poi?.name ?? ''} · ${TIER[k.tier] ?? ''} · ${(EX.reward.xp[k.tier] ?? 0).toLocaleString('en-US')} XP`;
      this.conEl.querySelector('p').innerHTML = step;
      this.conEl.classList.toggle('warn', warn);
    }
    const pk = Math.round(prog * 100) / 100;
    if (this.c.conK !== pk) { this.c.conK = pk; this.conEl.querySelector('.ex-bar div').style.setProperty('--k', pk.toFixed(2)); }
  }

  // Where the squad's contract wants you now.
  #goal(k, me) {
    if (k.type === 'intel' && k.carrier >= 0) return { x: k.dx, z: k.dz };
    return { x: k.x, z: k.z };
  }

  // Call exfil and Contracts sit where the battle royale's take prompt does (js/ui/br-hud.js #placeTake): bottom-centre in
  // the gap between the vitals and the aim stick's ring, never on a stick or a button. Measured once per screen size.
  #placeActs() {
    const key = `${innerWidth}x${innerHeight}`;
    if (this.actsAt === key) return;
    this.actsAt = key;
    const ring = document.querySelector('.controls .stick-aim .ring-fire')?.getBoundingClientRect();
    const vit = this.hud.el.querySelector('.vitals')?.getBoundingClientRect();
    const lo = (vit?.width ? vit.right : innerWidth * 0.3) + 6, hi = (ring?.width ? ring.left : innerWidth * 0.62) - 6;
    const st = this.$('.ex-acts').style;
    st.left = `${Math.round((lo + hi) / 2)}px`;
    st.maxWidth = `${Math.max(140, Math.round(hi - lo))}px`;
  }

  #actions(view, me, ex, squad) {
    this.#placeActs();
    const up = me.alive && !me.downed && view.phase === 'live';
    const zone = up ? (ex.exfils ?? []).find(e => e.state === 1 && Math.hypot(me.x - e.x, me.z - e.z) <= e.r) : null;
    if (this.c.call !== !!zone) { this.c.call = !!zone; this.callBtn.hidden = !zone; }
    let phone = null;
    if (up && !squad?.done) for (const ph of ex.phones ?? []) if (Math.hypot(me.x - ph.x, me.z - ph.z) <= EX.phoneReach) { phone = ph.i; break; }
    if (this.phone !== phone) { this.phone = phone; this.phoneBtn.hidden = phone === null; if (phone === null && this.offersOpen) this.#openOffers(false); }
    if (this.offersOpen && phone !== null) {
      const taken = squad?.taken ?? 0, key = `${phone}|${taken}|${squad?.contract?.id}`;
      if (this.c.offers !== key) {
        this.c.offers = key;
        const offers = ex.rules?.offers?.(phone, me.team, taken) ?? [];
        this.offerRow.innerHTML = offers.map((o, i) => {
          const poi = ex.pois?.[o.poi];
          const cur = squad?.contract && squad.contract.type === o.type && squad.contract.poi === o.poi;
          const d = poi ? Math.round(Math.hypot(poi.x - me.x, poi.z - me.z)) : 0;
          return `<button class="ex-offer${cur ? ' cur' : ''}" data-k="${i}" data-tap="1"><span class="oi">${icon(`ex:${o.type}`, { size: 26 })}</span><b>${esc(CONTRACT_NAMES[o.type])}</b>
            <small>${esc(poi?.name ?? '')}, ${d} m<br>${TIER[o.tier]}${o.tier === 1 ? ': heavy guard' : o.tier === 3 ? ': light guard' : ''}</small><em>${(EX.reward.xp[o.tier] ?? 0).toLocaleString('en-US')} XP</em></button>`;
        }).join('');
      }
    }
    // Holding a landed zone: the lift bar.
    const landed = me.alive && !me.downed ? (ex.exfils ?? []).find(e => e.state === 3 && Math.hypot(me.x - e.x, me.z - e.z) <= e.r) : null;
    const hk = landed ? `${landed.contested}|${landed.holder === me.team}` : '';
    if (this.c.hold !== hk) {
      this.c.hold = hk;
      this.holdEl.hidden = !landed;
      if (landed) {
        this.holdEl.classList.toggle('contested', !!landed.contested);
        this.holdEl.querySelector('b').textContent = landed.contested ? 'Contested: clear the zone' : landed.holder === me.team ? 'Boarding: hold the zone' : 'Hold the zone';
      }
    }
    if (landed) this.holdEl.querySelector('i i').style.transform = `scaleX(${Math.min(1, landed.holder === me.team ? landed.hold / EX.hold : 0).toFixed(3)})`;
  }

  // Screen markers: the objective (and the intel drop), exfil zones that are open or busy, the nearest phone.
  #marks(view, me, ex, squad) {
    const eye = me.alive ? me : view.players.find(p => p.id === spectate.target(view, me.id)) ?? me;
    let n = 0;
    const k = squad?.contract;
    if (k && !squad.done && !me.out && view.phase === 'live') {
      const g = this.#goal(k, eye);
      const mine = k.type === 'intel' && k.carrier >= 0 && view.players[k.carrier]?.id === me.id;
      if (!(k.type === 'intel' && k.carrier >= 0 && !mine)) n = this.#tag(n, g.x, g.z, k.contested || (k.type === 'cache' && k.def > 0) ? 'warn' : '', `${icon(`ex:${k.type}`, { size: 13 })}${mine ? 'Drop' : CONTRACT_NAMES[k.type].split(' ').pop()} <small>${Math.round(Math.hypot(g.x - eye.x, g.z - eye.z))} m</small>`, eye);
    }
    for (const e of ex.exfils ?? []) {
      if (e.state < 1 || e.state > 3 || n >= TAGS) continue;
      const d = Math.round(Math.hypot(e.x - eye.x, e.z - eye.z));
      if ((e.state === 1 && d > 220) || d < e.r) continue;      // Standing in it, the ring says enough.
      n = this.#tag(n, e.x, e.z, e.state === 3 ? 'go' : e.state === 2 ? '' : 'open', `${icon('mode:ex', { size: 13 })}${e.final ? 'Final exfil' : 'Exfil'} <small>${d} m</small>`, eye);
    }
    // The nearest phone, when close enough to matter.
    let ph = null, pd = 60;
    for (const p of ex.phones ?? []) { const d = Math.hypot(p.x - eye.x, p.z - eye.z); if (d < pd && d > EX.phoneReach) { pd = d; ph = p; } }
    if (ph && n < TAGS && view.phase === 'live') n = this.#tag(n, ph.x, ph.z, 'phone', `${icon('ui:chat', { size: 12 })}Phone`, eye, false);
    for (let i = n; i < TAGS; i++) if (!this.tags[i].root.hidden) this.tags[i].root.hidden = true;
  }

  // Projects a world point; off screen it pins to the edge (when `pin`), so a far objective still shows its way.
  #tag(k, x, z, cls, html, eye, pin = true) {
    const t = this.tags[k], cam = this.hud.camera;
    if (!t || !cam) return k;
    const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
    const vx = v[0] * x + v[4] * MARK_Y + v[8] * z + v[12], vy = v[1] * x + v[5] * MARK_Y + v[9] * z + v[13], vz = v[2] * x + v[6] * MARK_Y + v[10] * z + v[14];
    const w = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
    const W = this.hud.viewW, H = this.hud.viewH;
    let sx, sy;
    if (w > 0.01) { sx = ((p[0] * vx + p[8] * vz + p[12]) / w * 0.5 + 0.5) * W; sy = (0.5 - (p[5] * vy + p[9] * vz + p[13]) / w * 0.5) * H; }
    else { sx = W / 2 + (x - eye.x) * 100; sy = H / 2 + (z - eye.z) * 100; }
    const mx = 70, top = 112, bottom = H - 122;      // Clear of the minimap and chips above, the sticks and buttons below.
    const off = sx < mx || sx > W - mx || sy < top || sy > bottom;
    if (off && !pin) { t.root.hidden = true; return k + 1; }
    if (off) {
      // Along the line from the middle of the screen toward it, onto the inset frame.
      const cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy;
      const kx = dx ? ((dx > 0 ? W - mx : mx) - cx) / dx : Infinity, ky = dy ? ((dy > 0 ? bottom : top) - cy) / dy : Infinity;
      const s = Math.min(kx, ky);
      sx = cx + dx * s; sy = cy + dy * s;
      if (sx > W - 210 && sy < 150) sy = 150;      // Under the contract card, not on it.
    }
    sx = Math.round(sx); sy = Math.round(sy);
    t.root.hidden = false;
    const cl = `ex-tag ${cls}`;
    if (t.cls !== cl) { t.cls = cl; t.root.className = cl; }
    if (t.html !== html) { t.html = html; t.span.innerHTML = html; }
    if (sx !== t.x || sy !== t.y) { t.x = sx; t.y = sy; t.root.style.transform = `translate3d(${sx}px,${sy}px,0)`; }
    return k + 1;
  }

  #downed(me) {
    const down = me.alive && !!me.downed, c = this.c;
    if (c.down !== down) {
      c.down = down;
      this.downEl.hidden = !down;
      this.hud.el.classList.toggle('ex-down-on', down);
      if (down) { this.toggleMap(false); this.#openOffers(false); }
    }
    if (!down) return;
    const helping = (me.reviveK ?? 0) > 0.01;
    const text = helping ? 'A squadmate is reviving you. Stay close.' : 'Crawl to a squadmate. Standing next to you, they bring you back.';
    if (c.downText !== text) { c.downText = text; this.downEl.querySelector('small').textContent = text; }
    this.downEl.querySelector('.bleed i').style.transform = `scaleX(${Math.max(0, Math.min(1, me.hp / BR.downHp)).toFixed(3)})`;
    this.downEl.querySelector('.rev i').style.transform = `scaleX(${Math.max(0, Math.min(1, me.reviveK ?? 0)).toFixed(3)})`;
  }

  #reviving(view, me) {
    let pat = null;
    if (me.alive && !me.downed) {
      let bd = 2.6;
      for (const p of view.players) {
        if (p.team !== me.team || p.id === me.id || !p.alive || !p.downed || !(p.reviveK > 0.01)) continue;
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < bd) { bd = d; pat = p; }
      }
    }
    const key = pat ? pat.id : '';
    if (this.c.rev !== key) { this.c.rev = key; this.revEl.hidden = !pat; if (pat) this.revEl.querySelector('b').textContent = `Reviving ${pat.name}`; }
    if (pat) this.revEl.querySelector('i i').style.transform = `scaleX(${Math.min(1, pat.reviveK).toFixed(3)})`;
  }

  // Off the field for good: out of lives, or lifted out. The death screen goes and the battle royale's out panel says what
  // is left to happen: watch your squad (it can still bank the pot for you), anyone once nobody of yours is left, or leave
  // for your results now (main.js leaveBrEarly: Match.leaveNow, headless for a host with others still playing).
  #held(view, me, squad) {
    const live = view.phase === 'live';
    const lifted = !!me.out;
    const held = live && !me.alive && (lifted || (squad?.lives ?? 0) <= 0);
    const note = live && !me.alive && !held ? `Squad lives left: ${squad?.lives ?? 0}. Respawn near a squadmate.` : '';
    if (this.c.note !== note) { this.c.note = note; this.noteEl.hidden = !note; this.noteEl.textContent = note; }
    const watch = held ? spectate.target(view, me.id) : null;
    const mates = held ? view.players.filter(p => p.team === me.team && p.alive && p.id !== me.id).length : 0;
    const key = held ? `${lifted}|${watch}|${mates}|${spectate.any}|${squad?.extracted ?? 0}|${squad?.banked?.length ?? 0}` : '';
    if (this.c.held === key) return;
    this.c.held = key;
    this.heldEl.hidden = !held;
    this.hud.el.classList.toggle('ex-held', held);
    if (held) this.hud.controls?.setDown(true);
    if (!held) return;
    const w = watch && view.players.find(p => p.id === watch);
    const others = !mates && !!w, choosing = !mates && !spectate.any;
    const banked = squad?.banked ?? [], out = lifted || !!squad?.extracted;
    const $ = q => this.heldEl.querySelector(q);
    this.heldEl.classList.toggle('watching', !!w);
    this.heldEl.classList.toggle('won', out);
    $('b').innerHTML = others ? `Watching ${nameHtml(w.name)}` : lifted ? 'Extracted' : out ? 'Squad got out' : 'Out of lives';
    $('.place').textContent = out ? `${banked.length} banked` : `${squad?.pot?.length ?? 0} pending`;
    $('small').textContent = mates ? (out ? `Watching ${w?.name ?? 'your squad'}. Leave whenever you like: it is banked.` : `Watching ${w?.name ?? 'your squad'}. If anyone of your squad gets out, the pot is banked for you too.`)
      : others ? `${out ? `${banked.length} banked` : 'Nothing banked'}  /  ${view.players.filter(p => p.team === w.team && p.alive).length} of theirs up`
      : choosing ? 'Watch the rest, or see your results now.' : 'Nobody left to watch.';
    $('.ex-spec').hidden = !choosing;
    $('.ex-spec-next').hidden = choosing || (mates ? mates < 2 : !w);
    $('.ex-spec-next').textContent = mates ? 'Next teammate' : 'Next player';
    $('.ex-spec-squad').hidden = !others;
  }

  // ---- Events: feed lines and callouts ----
  onEvent(e, view) {
    if (!this.on || !view) return;
    const me = view.players.find(p => p.id === view.localId);
    if (!me) return;
    const name = id => { const p = view.players.find(q => q.id === id); return p ? `<em style="color:${p.team === EX_AI_TEAM ? AI_CSS : TEAMS[p.team]?.css ?? '#fff'}">${nameHtml(p.name)}</em>` : '?'; };
    const mine = t => t === me.team;
    switch (e.t) {
      case 'down':
        this.hud.pushFeed(`${name(e.by)}<span class="f-w">${icon(e.weapon, { size: 13 })}</span><span class="f-note" style="color:#ff9a8c">downed</span>${name(e.target)}`, e.by === me.id || e.target === me.id,
          view.players.find(p => p.id === e.by)?.team === me.team ? 'ally' : 'foe');
        break;
      case 'revive':
        this.hud.pushFeed(`${name(e.by)}<span class="f-note" style="color:#7be08a">revived</span>${name(e.id)}`, e.id === me.id || e.by === me.id, 'ally');
        if (e.id === me.id) this.hud.notify('Revived');
        break;
      case 'excontract':
        if (!mine(e.team)) break;
        if (e.done) { this.#callout('Contract complete', `${CONTRACT_NAMES[e.type]}: +${(EX.reward.xp[e.tier] ?? 0).toLocaleString('en-US')} XP pending. Extract to keep it.`); this.hud.audio?.uiSound?.('confirm'); }
        else if (e.taken) this.hud.notify(`New contract: ${CONTRACT_NAMES[e.type]}`);
        break;
      case 'excase':
        if (mine(e.team)) this.hud.notify(e.drop ? 'The case is down: pick it up' : e.id === me.id ? 'You have the case: get it to the drop' : 'Case secured');
        break;
      case 'explant':
        if (mine(e.team)) this.hud.notify(e.defused ? 'They pulled the charge: plant it again' : 'Charge set: defend the cache');
        break;
      case 'exwindow':
        this.#callout(e.final ? 'Final exfil' : 'Exfil open', e.final ? 'One last helicopter. It lands soon and stays to the end.' : `${e.sites.length} landing zones open. Stand in one and call it.`);
        break;
      case 'excall':
        if (mine(e.team)) {
          this.#callout('Exfil called', `The helicopter lands in ${EX.inbound} s. Hold the zone.`);
          this.hud.music?.cue?.('exfil');      // The music engine's exfil moment (a no-op until it is wired).
        }
        else if (Math.hypot(e.x - me.x, e.z - me.z) < 160) this.hud.notify('Another squad called an exfil nearby');
        break;
      case 'exland':
        if (Math.hypot(e.x - me.x, e.z - me.z) < 120) this.hud.notify('Helicopter down: hold the zone alone to board');
        break;
      case 'exfil':
        if (mine(e.team)) {
          if (e.ids.includes(me.id)) this.#callout('Extracted', 'Your squad\'s pot is banked.');
          else this.#callout('Squad extracted', 'The pot is banked for all of you. Anything you finish now needs another exfil.');
        } else this.hud.pushFeed(`<span class="f-note" style="color:#8ff09c">A squad extracted</span>`, false, 'foe');
        break;
      case 'exwave':
        if (Math.hypot(e.x - me.x, e.z - me.z) < 70) this.hud.notify('Enemy reinforcements inbound');
        break;
      case 'exwipe':
        if (mine(e.team)) this.#callout('Squad lost', 'Nothing banked this time.');
        break;
      case 'exboom':
        if (mine(e.team)) this.hud.notify('Cache destroyed');
        break;
    }
  }

  #callout(title, sub) {
    this.el.querySelector('.ex-callout')?.remove();
    const n = document.createElement('div');
    n.className = 'ex-callout';
    n.innerHTML = `<b>${esc(title)}</b><small>${esc(sub)}</small>`;
    this.el.appendChild(n);
    setTimeout(() => n.remove(), 3500);
  }

  // ---- Minimap: a window round you, with the mode's marks ----

  miniWindow(view, me, W, H) {
    if (!this.map) return null;
    const eyeId = !me.alive ? spectate.target(view, me.id) : null;
    const eye = (eyeId && view.players.find(p => p.id === eyeId)) || me;
    const span = MINI_SPAN, k = W / span, spanZ = H / k;
    const ox = Math.max(0, Math.min(this.map.width - span, eye.x - span / 2)), oz = Math.max(0, Math.min(this.map.height - spanZ, eye.z - spanZ / 2));
    return { k, ox, oz, span, spanZ, W, H };
  }

  drawMiniBase(g, z) {
    const base = this.#mapBase(), s = MAP_PX / Math.max(this.map.width, this.map.height);
    g.fillStyle = '#1d242c'; g.fillRect(0, 0, z.W, z.H);
    g.drawImage(base, z.ox * s, z.oz * s, z.span * s, z.spanZ * s, 0, 0, z.W, z.H);
    g.fillStyle = 'rgba(10,13,17,.25)'; g.fillRect(0, 0, z.W, z.H);
  }

  #mapBase() {
    if (this.base) return this.base;
    const map = this.map, c = document.createElement('canvas');
    c.width = c.height = MAP_PX;
    const g = c.getContext('2d'), s = MAP_PX / Math.max(map.width, map.height);
    const img = new Image();
    img.onload = () => { g.drawImage(img, 0, 0, MAP_PX, MAP_PX); g.fillStyle = 'rgba(10,13,17,.18)'; g.fillRect(0, 0, MAP_PX, MAP_PX); };
    img.onerror = () => {};
    if (!map.devMap) img.src = `assets/maps/${map.id}-overview.jpg`;
    g.fillStyle = '#33402f'; g.fillRect(0, 0, MAP_PX, MAP_PX);
    for (const r of map.rooms ?? []) { g.fillStyle = '#5a5240'; g.fillRect(r.x * s, r.z * s, r.w * s, r.d * s); }
    for (const w of map.walls) {
      if (w.kind === 'border') continue;
      g.fillStyle = w.kind === 'water' ? '#2c4a54' : w.blocksVision ? '#b9b19a' : '#6f7660';
      g.fillRect(w.x * s, w.z * s, Math.max(1, w.w * s), Math.max(1, w.d * s));
    }
    this.base = c;
    return c;
  }

  drawMini(g, view, me, sx, sz) {
    const ex = objOf(view);
    if (!this.on || !ex?.ex) return;
    const t = performance.now() / 1000;
    for (const ph of ex.phones ?? []) { g.fillStyle = 'rgba(224,169,42,.9)'; g.fillRect(ph.x * sx - 2.5, ph.z * sz - 2.5, 5, 5); }
    for (const e of ex.exfils ?? []) {
      if (e.state < 1 || e.state > 3) continue;
      g.strokeStyle = e.state === 3 ? (e.contested ? '#ff6a5a' : '#7be08a') : e.state === 2 ? '#ffc24a' : '#f2f0e6';
      g.lineWidth = 2;
      g.beginPath(); g.arc(e.x * sx, e.z * sz, Math.max(3, e.r * sx), 0, Math.PI * 2); g.stroke();
    }
    const squad = ex.squads?.find(s => s.team === me.team), k = squad?.contract;
    if (k && !squad.done) {
      const g0 = this.#goal(k, me), r = 4 + Math.sin(t * 5) * 1.2;
      g.fillStyle = '#ffc24a';
      g.beginPath(); g.moveTo(g0.x * sx, g0.z * sz - r - 2); g.lineTo(g0.x * sx + r, g0.z * sz); g.lineTo(g0.x * sx, g0.z * sz + r + 2); g.lineTo(g0.x * sx - r, g0.z * sz); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(10,13,17,.8)'; g.lineWidth = 1; g.stroke();
    }
  }

  #drawBigMap(view, me, ex, squad) {
    const g = this.mapG, s = MAP_PX / Math.max(this.map.width, this.map.height);
    g.drawImage(this.#mapBase(), 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const poi of ex.pois ?? []) {
      const x = poi.x * s, y = poi.z * s;
      g.font = `${poi.tier === 1 ? 19 : 15}px Oswald, "Arial Narrow", sans-serif`;
      g.lineWidth = 4; g.strokeStyle = 'rgba(10,13,17,.85)'; g.strokeText(poi.name.toUpperCase(), x, y - 10);
      g.fillStyle = poi.tier === 1 ? '#ff9a6a' : poi.tier === 2 ? '#f2f0e6' : '#b8bfb6';
      g.fillText(poi.name.toUpperCase(), x, y - 10);
    }
    for (const ph of ex.phones ?? []) { g.fillStyle = '#e0a92a'; g.fillRect(ph.x * s - 4, ph.z * s - 4, 8, 8); }
    for (const e of ex.exfils ?? []) {
      g.lineWidth = 3;
      g.strokeStyle = e.state === 3 ? '#7be08a' : e.state === 2 ? '#ffc24a' : e.state === 1 ? '#f2f0e6' : 'rgba(242,240,230,.25)';
      g.beginPath(); g.arc(e.x * s, e.z * s, 9, 0, Math.PI * 2); g.stroke();
      if (e.final) { g.fillStyle = g.strokeStyle; g.font = '12px Oswald, sans-serif'; g.fillText('FINAL', e.x * s, e.z * s + 18); }
    }
    const k = squad?.contract;
    if (k && !squad.done) {
      const gl = this.#goal(k, me);
      g.fillStyle = '#ffc24a'; g.strokeStyle = 'rgba(10,13,17,.9)'; g.lineWidth = 2;
      g.beginPath(); g.arc(gl.x * s, gl.z * s, 8, 0, Math.PI * 2); g.fill(); g.stroke();
      if (k.type === 'intel' && k.carrier < 0) { g.beginPath(); g.arc(k.dx * s, k.dz * s, 5, 0, Math.PI * 2); g.stroke(); }
    }
    for (const p of view.players) {
      if (p.team !== me.team || !p.alive) continue;
      g.fillStyle = p.id === me.id ? '#fff' : TEAMS[p.team]?.css ?? '#fff';
      g.fillRect(p.x * s - 4, p.z * s - 4, 8, 8);
    }
  }

  endBanner(endEl, winner, myTeam, view) {
    const ex = objOf(view), squad = ex?.squads?.find(s => s.team === myTeam);
    const out = !!squad?.extracted, n = squad?.banked?.length ?? 0;
    endEl.dataset.result = out ? 'win' : 'loss';
    endEl.querySelector('b').textContent = out ? 'Extracted' : 'Missing in action';
    endEl.querySelector('small').textContent = out ? `${n} contract${n === 1 ? '' : 's'} banked` : `${(squad?.pot?.length ?? 0) + (squad?.banked?.length ?? 0)} contracts lost`;
  }
}

export const exModeName = id => MODES[id]?.name ?? 'Extraction';
