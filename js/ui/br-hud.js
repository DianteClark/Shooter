// Battle royale HUD (docs/BR.md): everything a BR match adds on top of the ordinary HUD, which owns one of these and
// calls it from a few hooks (prepare, update, onEvent, drawMini, endBanner). Plain DOM plus two canvases.
//
//   top       players and squads left, the circle's clock (closes in / closing), a warning when you are outside it
//   plates    three armor segments over the health bar
//   inventory plates, medkits and the self-revive kit as one-tap buttons between health and ammo, with the use timer
//   jump      a big Jump button while aboard; a steer hint while gliding
//   take      "Take <gun>" when a ground gun is in reach and both hands are full (an empty hand fills itself)
//   squad     each squadmate's plates and health, down and out marks
//   down      the downed overlay: bleed bar, revive progress, the self-revive button
//   out       eliminated: placement, and who you are watching (Rebound: the redeploy countdown)
//   rebound   Rebound's note at the foot of the squad column: redeploys on until circle N, then over
//   map       the drop map before and during the flight (places, flight line, transport) and the full map on a tap of
//             the minimap: circle, next circle, squad.
import { BR, MODES, RB, brPhases, isRebound } from '../shared/modes.js';
import { MAX_HP, TEAMS, WEAPON_IDS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { BR_KIND, itemName, AMMO_TYPES } from '../sim/br.js';
import { spectate } from '../sim/snd.js';
import { esc, nameHtml } from './widgets.js';
import { icon } from './icons.js';

const ORD = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const clock = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const MAP_PX = 640;          // Backing pixels of the big map.
const MINI_SPAN = 120;       // Metres across the zoomed battle royale minimap.

const CSS = `
.br-ui { position: absolute; inset: 0; pointer-events: none; z-index: var(--z-hud-alert); }
.br-ui .br-map { z-index: var(--z-overlay); }
.br-ui [data-tap] { pointer-events: auto; }
.hud.br-on .scorebar, .hud.br-on .obj-strip, .hud.br-on .gun-rung { display: none !important; }
.hud.br-on .death { display: none !important; }
.br-top { display: flex; align-items: stretch; gap: 4px; }
.hud:not(.br-on) .br-top, .hud:not(.br-on) .br-reviving { display: none !important; }
.br-chip { display: flex; flex-direction: column; justify-content: center; align-items: center; min-width: 54px; height: 40px; padding: 0 9px;
  background: linear-gradient(180deg, rgba(42,51,61,.94), rgba(16,20,26,.9)); box-shadow: var(--hud-edge);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); }
.br-chip b { font: 400 21px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); font-variant-numeric: tabular-nums; }
.br-chip small { font: 9px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); margin-top: 2px; white-space: nowrap; }
.br-circle { min-width: 104px; box-shadow: var(--hud-edge), inset 0 -2px 0 var(--c-sodium); }
.br-circle.closing { box-shadow: var(--hud-edge), inset 0 -2px 0 var(--c-red); }
.br-circle.closing b { color: #ff8a7c; }
/* Outside the circle: the circle chip itself turns red and says so (it blinks), instead of a second plate. */
.br-circle.outside { background: linear-gradient(180deg, rgba(165,42,31,.95), rgba(90,18,12,.92)); box-shadow: var(--hud-edge), inset 0 -2px 0 #fff; animation: br-blink .7s steps(2, jump-none) infinite; }
.br-circle.outside b, .br-circle.outside small { color: #fff; }
.br-pips { display: flex; gap: 2px; margin-top: 3px; }
.br-pips i { width: 9px; height: 3px; background: rgba(231,234,228,.2); }
.br-pips i.on { background: var(--c-sodium); }
@keyframes br-blink { to { opacity: .55; } }
.br-plates { display: flex; gap: 3px; height: 5px; margin-bottom: 2px; }
.br-plates i { flex: 1; position: relative; background: rgba(16,20,26,.85); box-shadow: inset 0 0 0 1px rgba(231,234,228,.16); transform: skewX(-24deg); overflow: hidden; }
.br-plates i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, #9fd1ff, #3fa0ff); transform-origin: left center; transform: scaleX(var(--k, 0)); }
/* Plate, medkit and self-revive take the streak tiles' place in the dock beside health (js/ui/hud.js layout). */
.br-inv { position: absolute; left: var(--rp-x, 50%); bottom: calc(var(--sb) + 6px); transform: scale(var(--vit-k, var(--hud-k, 1))); transform-origin: left bottom; display: flex; gap: 4px; align-items: flex-end; pointer-events: none; }
.br-btn { position: relative; width: 46px; height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; border: 0; padding: 0;
  color: var(--c-chalk); background: linear-gradient(180deg, rgba(42,51,61,.92), rgba(16,20,26,.88)); box-shadow: var(--hud-edge);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); font: 400 15px/1 var(--f-stencil); }
.br-btn small { font: 8px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); }
.br-btn[disabled], .br-btn.off { opacity: .38; }
.br-btn.busy { box-shadow: var(--hud-edge), inset 0 -3px 0 var(--c-sodium); }
.br-btn .br-fill { position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; background: var(--c-sodium); transform-origin: left; transform: scaleX(0); }
.br-btn:active { filter: brightness(1.4); }
.br-jump { position: absolute; left: var(--lane-x, 50%); bottom: var(--lane-b, 70px); transform: translateX(-50%); min-width: 150px; height: 58px; padding: 0 22px; border: 0;
  font: 400 30px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-night); background: var(--c-sodium);
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); box-shadow: 0 0 0 2px #fff inset; }
.br-jump small { display: block; font: 10px/1 var(--f-plate); letter-spacing: var(--tr-plate); margin-top: 3px; }
.br-hint { position: absolute; left: var(--lane-x, 50%); bottom: var(--lane-b, 76px); transform: translateX(-50%); padding: 6px 12px; font: 13px/1.2 var(--f-plate);
  letter-spacing: var(--tr-plate); color: var(--c-chalk); background: var(--hud-glass, rgba(16,20,26,.75)); white-space: nowrap; text-align: center; }
.br-hint b { font: 400 16px/1 var(--f-stencil); color: var(--c-sodium); display: block; margin-bottom: 3px; }
/* The take prompt rides the prompt lane over the dock, between the sticks (js/ui/hud.js layout). */
.br-take, .br-recall { position: absolute; left: var(--lane-x, 50%); width: min(var(--lane-w, 220px), 240px); bottom: var(--lane-b, 64px); transform: translateX(-50%); display: flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 10px 0 10px; text-align: left;
  border: 0; color: #fff; background: linear-gradient(180deg, rgba(42,51,61,.95), rgba(16,20,26,.92)); box-shadow: var(--hud-edge), inset 3px 0 0 var(--rar);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); white-space: nowrap; }
.br-take > span:last-child, .br-recall > span:last-child { min-width: 0; overflow: hidden; }
.br-take .ti, .br-recall .ti { flex: none; line-height: 0; }
.br-take b, .br-take small, .br-recall b, .br-recall small { display: block; overflow: hidden; text-overflow: ellipsis; }
.br-take b, .br-recall b { font: 400 16px/1.05 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--rar); }
.br-take small, .br-recall small { margin-bottom: 3px; font: 10px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); text-transform: uppercase; }
.br-down { position: absolute; left: 50%; top: 32%; transform: translateX(-50%); width: 250px; text-align: center; }
.br-down b { display: block; font: 400 30px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #ff6b5c; text-shadow: 0 2px 0 rgba(0,0,0,.5); }
.br-down small { display: block; font: 12px/1.3 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); margin: 5px 0 8px; text-shadow: var(--text-lift); }
.br-down .bleed, .br-down .rev { height: 6px; background: rgba(16,20,26,.8); margin: 4px 0; position: relative; overflow: hidden; }
.br-down .bleed i, .br-down .rev i { position: absolute; inset: 0; transform-origin: left; transform: scaleX(0); }
.br-down .bleed i { background: var(--c-red); }
.br-down .rev i { background: var(--c-go, #59d36b); }
.br-down .br-self { margin: 8px auto 0; width: auto; padding: 0 14px; flex-direction: row; gap: 6px; height: 40px; font-size: 16px; }
.hud.br-down-on .vignette { opacity: 1 !important; background: radial-gradient(ellipse at center, transparent 40%, rgba(150,20,12,.55)); }
.br-out { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); text-align: center; min-width: 260px; padding: 12px 18px;
  background: linear-gradient(180deg, rgba(42,51,61,.92), rgba(16,20,26,.9)); box-shadow: var(--hud-edge); clip-path: polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px); }
.br-out b { display: block; font: 400 30px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); }
.br-rd { padding: 2px 5px 3px; white-space: normal; line-height: 1.25 !important;
  font: 10px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); background: rgba(16,20,26,.7); box-shadow: inset 0 -2px 0 #59d36b; }
.br-rd.off { color: var(--c-haze); box-shadow: inset 0 -2px 0 rgba(231,234,228,.3); }
.br-rd[hidden], .br-out .rd[hidden] { display: none; }
.br-out .rd { margin: 8px auto 0; width: 200px; height: 6px; background: rgba(231,234,228,.15); position: relative; }
.br-out .rd i { position: absolute; inset: 0; background: #59d36b; transform-origin: left; transform: scaleX(var(--k, 0)); }
.br-out .place { font: 400 44px/1 var(--f-stencil); color: var(--c-sodium); }
.br-out small { display: block; font: 12px/1.3 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); margin-top: 6px; }
.br-out button { height: 40px; min-width: 112px; padding: 0 14px; border: 0; font: 400 16px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-night); background: var(--c-chalk);
  clip-path: polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px); pointer-events: auto; }
.br-out .acts { display: flex; justify-content: center; gap: 8px; margin-top: 12px; }
.br-out button.go { background: var(--c-sodium); }
.br-out button.quiet { color: var(--c-chalk); background: rgba(231,234,228,.14); box-shadow: inset 0 0 0 1px rgba(231,234,228,.3); }
/* Watching: the plate shrinks to a strip at the bottom, clear of the middle of the screen. */
.br-out.watching { top: auto; bottom: calc(var(--sb) + 10px); min-width: 0; max-width: calc(100vw - 24px); padding: 8px 14px 8px 14px; display: flex; align-items: center; gap: 12px; text-align: left; }
.br-out.watching b { font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.br-out.watching .place { display: none; }
.br-out.watching small { margin-top: 3px; max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.br-out.watching .txt { min-width: 0; }
/* The death replay's Skip sits bottom right: the strip moves up out of its way until the replay is over. */
.killcam-on .br-out.watching { bottom: calc(var(--sb) + 62px); }
.br-out.watching .acts { margin-top: 0; gap: 6px; flex: none; }
.br-out.watching button { min-width: 0; height: 38px; font-size: 14px; padding: 0 12px; }
.br-map { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 14px; background: rgba(10,13,17,.62); pointer-events: auto; }
.br-map-frame { position: relative; height: min(calc(100vh - 24px), 92vw); aspect-ratio: 1; box-shadow: 0 0 0 1px rgba(231,234,228,.3), 0 0 0 4px rgba(16,20,26,.7); }
.br-map canvas { width: 100%; height: 100%; display: block; }
.br-map-side { display: flex; flex-direction: column; gap: 8px; max-width: 200px; }
.br-map-side h3 { margin: 0; font: 400 24px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); }
.br-map-side p { margin: 0; font: 12px/1.35 var(--f-body); color: var(--c-haze); }
.br-map-side .br-jump { position: static; transform: none; }
.hud.br-on .minimap { cursor: pointer; pointer-events: auto; z-index: var(--z-hud-alert); }
.hud.lefty .br-squad { left: auto; right: calc(var(--sr) + 134px); }
/* Hands: both guns and fists as three slots over the ammo readout, and the ammo pouch (rounds for guns not in hand). */
.br-hands { display: flex; gap: 3px; align-items: stretch; pointer-events: auto; padding: 4px; background: var(--hud-glass-lo, rgba(16,20,26,.6)); box-shadow: var(--hud-edge);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); }
.br-slot { position: relative; width: 46px; height: 36px; border: 0; padding: 2px 3px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  color: var(--c-chalk); background: linear-gradient(180deg, rgba(42,51,61,.9), rgba(16,20,26,.85)); box-shadow: var(--hud-edge), inset 0 2px 0 var(--rar, rgba(231,234,228,.25));
  clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px); }
.br-slot small { font: 9px/1 var(--f-plate); letter-spacing: .02em; color: var(--c-haze); font-variant-numeric: tabular-nums; white-space: nowrap; }
.br-slot.on { background: linear-gradient(180deg, rgba(74,62,30,.95), rgba(32,28,16,.9)); box-shadow: var(--hud-edge), inset 0 2px 0 var(--rar, var(--c-sodium)), inset 0 -2px 0 var(--c-sodium); }
.br-slot.on small { color: var(--c-chalk); }
.br-slot.empty { opacity: .45; }
.br-slot:active { filter: brightness(1.4); }
.br-slot.fist { width: 44px; }
.br-pouch { display: flex; flex-direction: column; gap: 1px; margin-left: 3px; font: 9px/1.05 var(--f-plate); letter-spacing: .02em; color: var(--c-haze); text-shadow: var(--text-lift); white-space: nowrap; }
.br-pouch b { color: var(--c-chalk); font-weight: 400; }
.br-hands-col { display: flex; flex-direction: column; justify-content: space-between; gap: 3px; }
.br-pouch { flex-direction: row; gap: 6px; margin-left: 1px; min-height: 9px; }
/* Recall Beacons: the take lane's button, the carried-tag note (amber) and the recall bar. */
.br-recall { --rar: #7dff8f; }
.br-recall b { color: #7dff8f; }
.br-tagnote { box-shadow: inset 0 -2px 0 #ffbe50; }
.br-recalling b { color: #ffd36b; }
.br-recalling i i { background: #ffbe50; }
/* The drop map's side: how many are still aboard the transport, and where each squadmate is. */
.br-aboard { display: flex; flex-direction: column; gap: 3px; padding: 7px 9px; background: rgba(16,20,26,.78); box-shadow: var(--hud-edge); }
.br-aboard .n { display: flex; align-items: baseline; gap: 6px; font: 12px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); }
.br-aboard .n b { font: 400 26px/1 var(--f-stencil); color: var(--c-sodium); font-variant-numeric: tabular-nums; }
.br-aboard .m { display: flex; justify-content: space-between; gap: 10px; font: 12px/1.25 var(--f-plate); color: var(--c-chalk); }
.br-aboard .m b { font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; }
.br-aboard .m span { color: var(--c-haze); white-space: nowrap; }
.br-aboard .m span.air { color: #ffbe50; }
.br-aboard .m span.gl { color: #8fd0ff; }
.br-aboard .m span.dn { color: #7be08a; }
.br-aboard .m span.out { color: #ff8a7c; }
@media (max-height: 380px) {
  .br-map-side { gap: 6px; }
  .br-map-side p { font-size: 11px; line-height: 1.25; }
  .br-aboard { padding: 5px 8px; gap: 2px; }
  .br-aboard .n b { font-size: 21px; }
  .br-aboard .m { font-size: 11px; line-height: 1.15; }
}
/* Reviving a teammate: your own bar, in the objective strip's progress row. */
.br-reviving { width: 190px; padding: 6px 10px 7px; text-align: center;
  background: var(--hud-glass, rgba(16,20,26,.78)); clip-path: polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px); }
.br-reviving b { display: block; font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #7be08a; }
.br-reviving i { display: block; height: 5px; margin-top: 5px; background: rgba(231,234,228,.15); position: relative; overflow: hidden; }
.br-reviving i i { position: absolute; inset: 0; margin: 0; height: auto; background: #59d36b; transform-origin: left; transform: scaleX(0); }
/* The big callout as the final circles start. */
.br-callout { position: absolute; left: 50%; top: 30%; transform: translateX(-50%); text-align: center; pointer-events: none; animation: br-call 3.4s ease-out forwards; }
.br-callout b { display: block; font: 400 38px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-sodium); text-shadow: 0 2px 0 rgba(0,0,0,.55), 0 0 18px rgba(255,190,60,.35); }
.br-callout small { display: block; margin-top: 4px; font: 13px/1.2 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); text-shadow: var(--text-lift); }
@keyframes br-call { 0% { opacity: 0; transform: translateX(-50%) scale(1.3); } 10% { opacity: 1; transform: translateX(-50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }
/* The downed panel sits below your character, not on it. */
.br-down { top: auto; left: var(--lane-x, 50%); bottom: var(--lane-b, 66px); }
/* Narrow screens: slimmer chips, so the strip fits between the squad panel and the corner. */
@media (max-width: 700px) {
  .br-chip { min-width: 46px; padding: 0 6px; }
  .br-circle { min-width: 92px; }
}
`;

export class BrHud {
  constructor(hud) {
    this.hud = hud;
    this.on = false;
    if (!document.getElementById('br-hud-css')) {
      const st = document.createElement('style');
      st.id = 'br-hud-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = this.el = document.createElement('div');
    el.className = 'br-ui';
    el.hidden = true;
    el.innerHTML = `
      <div class="br-top">
        <div class="br-chip br-alive"><b>32</b><small>Alive</small></div>
        <div class="br-chip br-circle"><b>0:00</b><small>Circle</small><span class="br-pips"></span></div>
        <div class="br-chip br-squads"><b>8</b><small>Squads</small></div>
      </div>
      <div class="br-outside" hidden>Outside the circle</div>
      <div class="br-rd" hidden></div>
      <div class="br-rd br-tagnote" hidden></div>
      <div class="br-squad"></div>
      <div class="br-inv">
        <button class="br-btn br-plate" data-tap="1" data-act="plate">${icon('plates', { size: 18 })}<span class="n">0</span><small>Plate</small><i class="br-fill"></i></button>
        <button class="br-btn br-med" data-tap="1" data-act="med">${icon('ui:plus', { size: 16 })}<span class="n">0</span><small>Medkit</small><i class="br-fill"></i></button>
        <button class="br-btn br-kit" data-tap="1" data-act="self" style="visibility:hidden">${icon('ui:refresh', { size: 16 })}<span class="n">0</span><small>Revive</small></button>
      </div>
      <button class="br-take" data-tap="1" hidden><span class="ti"></span><span><small></small><b></b></span></button>
      <button class="br-recall" data-tap="1" hidden><span class="ti">${icon('ui:beacon', { size: 18 })}</span><span><small>Recall at the beacon</small><b></b></span></button>
      <button class="br-jump br-jump-main" data-tap="1" hidden>JUMP<small>Leave the transport</small></button>
      <div class="br-hint" hidden></div>
      <div class="br-down" hidden><b>Down</b><small></small><div class="bleed"><i></i></div><div class="rev"><i></i></div>
        <button class="br-btn br-self" data-tap="1" hidden>${icon('ui:refresh', { size: 16 })}<span>Self-revive</span></button></div>
      <div class="br-reviving" hidden><b>Reviving</b><i><i></i></i></div>
      <div class="br-reviving br-recalling" hidden><b>Recalling</b><i><i></i></i></div>
      <div class="br-out" hidden><div class="txt"><b>Eliminated</b><div class="place"></div><small></small><div class="rd" hidden><i></i></div></div>
        <div class="acts"><button data-tap="1" class="br-spec go">Spectate</button><button data-tap="1" class="br-spec-next quiet" hidden>Next player</button><button data-tap="1" class="br-spec-squad quiet" hidden>Next squad</button><button data-tap="1" class="br-leave">Leave</button></div></div>
      <div class="br-map" hidden data-tap="1">
        <div class="br-map-frame"><canvas width="${MAP_PX}" height="${MAP_PX}"></canvas></div>
        <div class="br-map-side">
          <h3 class="br-map-title">Drop map</h3>
          <p class="br-map-note"></p>
          <div class="br-aboard" hidden></div>
          <button class="br-jump br-jump-map" data-tap="1" hidden>JUMP<small>Leave the transport</small></button>
        </div>
      </div>`;
    hud.el.appendChild(el);
    // The hand slots are part of the weapon panel, beside the ammo readout (left-handed layouts too).
    this.handsEl = document.createElement('div');
    this.handsEl.className = 'br-hands';
    this.handsEl.hidden = true;
    // No gun slots (owner notes: the swap button does that): fists, which come out by themselves once both guns are dry,
    // and the pouch. A tap on Fists puts them up or brings the gun back.
    this.handsEl.innerHTML = `<div class="br-hands-col"><div class="br-pouch"></div><div style="display:flex;gap:3px"><button class="br-slot fist" data-tap="1" data-k="2"><span class="gi">${icon('ui:glove', { size: 15 })}</span><small>Fists</small></button></div></div>`;
    hud.el.querySelector('.arms')?.appendChild(this.handsEl);
    for (const b of this.handsEl.querySelectorAll('.br-slot')) b.addEventListener('click', e => { e.stopPropagation(); this.cmd?.('slot', { k: Number(b.dataset.k) }); });
    const $ = s => el.querySelector(s);
    this.$ = $;
    this.aliveEl = $('.br-alive b'); this.squadsEl = $('.br-squads b');
    this.circleEl = $('.br-circle'); this.circleT = $('.br-circle b'); this.circleS = $('.br-circle small'); this.pips = $('.br-pips');
    this.outsideEl = $('.br-outside');
    this.squadEl = $('.br-squad');
    this.plateBtn = $('.br-plate'); this.medBtn = $('.br-med'); this.kitBtn = $('.br-kit');
    this.takeBtn = $('.br-take');
    this.recallBtn = $('.br-recall'); this.tagEl = $('.br-tagnote'); this.recEl = $('.br-recalling');
    this.jumpBtn = $('.br-jump-main'); this.jumpMap = $('.br-jump-map');
    this.hintEl = $('.br-hint');
    this.downEl = $('.br-down'); this.selfBtn = $('.br-self');
    this.outEl = $('.br-out');
    this.rdEl = $('.br-rd');
    this.mapEl = $('.br-map'); this.mapCanvas = $('.br-map canvas'); this.mapG = this.mapCanvas.getContext('2d');
    const act = (node, fn) => node.addEventListener('click', e => { e.stopPropagation(); fn(); });
    act(this.plateBtn, () => this.cmd?.('plate'));
    act(this.medBtn, () => this.cmd?.('med'));
    act(this.kitBtn, () => this.cmd?.('self'));
    act(this.selfBtn, () => this.cmd?.('self'));
    act(this.jumpBtn, () => this.#jump());
    act(this.jumpMap, () => this.#jump());
    act(this.recallBtn, () => { if (this.recallInv?.recall) this.cmd?.('cancel'); else if (this.recallB !== null) this.cmd?.('recall', { b: this.recallB }); });
    act(this.takeBtn, () => { if (this.takeId !== null) this.cmd?.('take', this.takeSlot >= 0 ? { item: this.takeId, slot: this.takeSlot } : { item: this.takeId }); });
    act($('.br-spec-next'), () => { if (this.view) { spectate.cycle(this.view, this.view.localId, 1); this.c.out = null; } });
    act($('.br-spec-squad'), () => { if (this.view) { spectate.cycle(this.view, this.view.localId, 1, true); this.c.out = null; } });
    act($('.br-spec'), () => { spectate.any = true; this.c.out = null; });
    act($('.br-leave'), () => this.hud.brLeaveCb?.());
    // Aboard (and while boarding) the drop map stays up until you jump; afterwards a tap outside it closes it.
    this.mapEl.addEventListener('click', e => { if (e.target === this.mapEl && !this.dropLock) this.toggleMap(false); });
    // A tap on the map marks a spot for the squad (a landing zone before the drop).
    this.mapCanvas.addEventListener('click', e => {
      e.stopPropagation();
      if (!this.map) return;
      const r = this.mapCanvas.getBoundingClientRect(), W = Math.max(this.map.width, this.map.height);
      this.cmd?.('ping', { x: (e.clientX - r.left) / r.width * W, z: (e.clientY - r.top) / r.height * W });
    });
    this.revEl = $('.br-reviving');
    // The circle chips are the objective strip's state row, your revive bar its progress row (js/ui/hud.js ObjStrip).
    hud.strip.mount($('.br-top'), { order: 0 });
    this.squadEl.appendChild($('.br-rd'));     // Rebound's redeploy note: the last row of the squad column.
    this.squadEl.appendChild(this.tagEl);
    hud.strip.mount(this.revEl, { row: 2 });
    hud.strip.mount(this.recEl, { row: 2 });
    this.pings = [];
    this.takeId = null;
    this.mapOpen = false;
    this.c = {};
  }

  // `cmd(act, extra)` is how the HUD's buttons reach the match (main.js wires it to Match.brCommand).
  onCommand(cb) { this.cmd = cb; }

  #jump() {
    this.cmd?.('jump');
    this.mapManual = false;
    this.toggleMap(false);
  }

  prepare(on, { map, roster, localId, mode }) {
    this.on = on;
    this.el.hidden = !on;
    this.handsEl.hidden = true;
    this.hud.el.classList.toggle('br-on', on);
    this.hud.el.classList.remove('br-down-on');
    if (!on) return;
    this.map = map; this.roster = roster; this.localId = localId; this.mode = mode;
    this.c = {};
    this.pings = []; this.leader = null; this.leaderAt = -99; this.calledFinal = false;
    this.mapManual = false;
    this.dropLock = false;
    this.base = null;
    this.toggleMap(true, true);
    this.phaseN = brPhases(mode).length;
    this.rebound = isRebound(mode);
    this.pips.innerHTML = '<i></i>'.repeat(this.phaseN);
    this.rdEl.hidden = true;
    const mm = this.hud.el.querySelector('.minimap');
    if (!this.mmWired) {
      this.mmWired = true;
      mm.setAttribute('data-tap', '1');
      mm.addEventListener('click', () => { if (this.on && !this.dropLock) this.toggleMap(!this.mapOpen); });
    }
  }

  toggleMap(open, auto = false) {
    this.mapOpen = open;
    this.mapEl.hidden = !open;
    if (!auto && open) this.mapManual = true;
    if (!open) this.mapManual = false;
    this.mapAuto = auto && open;
    if (open) this.hud.controls?.showAimHint(false);    // The first-match aim hint would sit over the map.
  }

  update(view, me, dt) {
    if (!this.on || !view.br) return;
    this.view = view;
    const br = view.br, c = this.c;
    const air = me.air ?? 0;
    // Top: alive, circle clock, squads.
    if (c.alive !== br.alive) { c.alive = br.alive; this.aliveEl.textContent = br.alive; }
    if (c.squads !== br.squadsLeft) { c.squads = br.squadsLeft; this.squadsEl.textContent = br.squadsLeft; }
    const phaseLabel = view.phase === 'warmup' ? 'Boarding' : br.plane.f < 1 && br.phase === 0 && br.state === 'wait' ? 'Circle after the drop'
      : br.state === 'final' ? 'Final circle' : br.state === 'shrink' ? 'Closing' : 'Circle closes in';
    const shown = view.phase === 'warmup' ? clock(view.timeLeft ?? 0) : br.state === 'final' ? '--' : clock(br.timer);
    if (c.circleT !== shown) { c.circleT = shown; this.circleT.textContent = shown; }
    const label = c.outside ? 'Outside the circle' : phaseLabel;
    if (c.circleS !== label) { c.circleS = label; this.circleS.textContent = label; this.circleEl.classList.toggle('closing', br.state !== 'wait'); }
    const pip = br.phase + (br.state === 'final' ? 1 : 0);
    if (c.pip !== pip) { c.pip = pip; [...this.pips.children].forEach((n, i) => n.classList.toggle('on', i < pip)); }
    const outside = me.alive && !air && Math.hypot(me.x - br.circle.x, me.z - br.circle.z) > br.circle.r;
    if (c.outside !== outside) { c.outside = outside; this.outsideEl.hidden = true; this.circleEl.classList.toggle('outside', outside); c.circleS = null; }
    this.#reboundNote(view, br);

    // Map: up by itself during boarding and the flight, until you jump (there is no close button).
    const wantAuto = (view.phase === 'warmup' || air === 1) && me.alive;
    this.dropLock = wantAuto && !c.mapDismissed;
    if (wantAuto && !this.mapOpen && !c.mapDismissed) this.toggleMap(true, true);
    if (!wantAuto && this.mapAuto) this.toggleMap(false);
    if (this.mapOpen) this.#drawBigMap(view, me);
    const aboard = air === 1 && me.alive;
    const canJump = aboard && view.phase === 'live';
    if (c.aboard !== canJump) {
      c.aboard = canJump;
      this.jumpBtn.hidden = !canJump; this.jumpMap.hidden = !canJump;
    }
    const title = view.phase === 'warmup' || aboard ? 'Drop map' : 'Map';
    if (c.mapTitle !== title) {
      c.mapTitle = title;
      this.$('.br-map-title').textContent = title;
      this.$('.br-map-note').textContent = aboard || view.phase === 'warmup'
        ? 'The transport flies the dotted line. Jump when it is near where you want to land, then steer the glide with the left stick. Gold names hold the best loot. Tap the map to mark a landing spot for your squad.'
        : 'White: the circle now. Dashed: where it closes to next. Tap the map to mark a spot; tap outside it to close.';
    }
    this.#aboard(view, me, aboard);
    const hint = air === 2 ? `<b>Gliding</b>Steer with the left stick` : aboard && view.phase === 'warmup' ? '<b>Boarding</b>The transport sets off in a moment' : '';
    if (c.hint !== hint) { c.hint = hint; this.hintEl.innerHTML = hint; this.hintEl.hidden = !hint || this.mapOpen; }
    if (c.hintMap !== this.mapOpen) { c.hintMap = this.mapOpen; this.hintEl.hidden = !c.hint || this.mapOpen; }

    // Plates over the health bar.
    this.#plates(me);
    // Inventory.
    const inv = br.inv;
    if (inv) {
      const key = `${inv.plates}|${inv.meds}|${inv.kits}|${me.downed}|${air}|${me.alive}`;
      if (c.inv !== key) {
        c.inv = key;
        this.plateBtn.querySelector('.n').textContent = inv.plates;
        this.medBtn.querySelector('.n').textContent = inv.meds;
        this.kitBtn.querySelector('.n').textContent = inv.kits;
        this.plateBtn.classList.toggle('off', !inv.plates);
        this.medBtn.classList.toggle('off', !inv.meds);
        // Hidden by visibility, so the dock keeps its measured width (js/ui/hud.js layout).
        this.kitBtn.style.visibility = !inv.kits || BR_SOLO(this.mode) ? 'hidden' : '';
        this.kitBtn.classList.toggle('off', !me.downed);     // Shown so you know you carry one; it works while down.
        this.$('.br-inv').style.visibility = !me.alive || air !== 0 ? 'hidden' : '';
        this.selfBtn.hidden = !inv.kits;
      }
      const using = inv.use;
      const k = using && inv.useDur > 0 ? 1 - inv.useT / inv.useDur : 0;
      const kk = Math.round(k * 20) / 20;
      if (c.use !== using || c.useK !== kk) {
        c.use = using; c.useK = kk;
        this.plateBtn.classList.toggle('busy', using === 'plate');
        this.medBtn.classList.toggle('busy', using === 'med');
        this.plateBtn.querySelector('.br-fill').style.transform = `scaleX(${using === 'plate' ? kk : 0})`;
        this.medBtn.querySelector('.br-fill').style.transform = `scaleX(${using === 'med' ? kk : 0})`;
      }
    }

    this.#hands(view, me, inv, air);
    // A ground gun in reach while both hands hold guns: tap to swap the one in hand for it.
    this.#take(view, me, air);
    this.#recall(view, me, air);
    this.#squad(view, me);
    this.#reviving(view, me);
    this.#leader(view, me);
    this.#downed(view, me, inv);
    this.#out(view, me);
  }

  // The transport (owner notes): how many are still aboard, and each squadmate's state, on the drop map's side and the
  // Jump button. Everyone's `air` rides the battle royale block (1 aboard, 2 gliding), so guests see the same count.
  #aboard(view, me, aboard) {
    const br = view.br;
    const flying = br.plane.f < 1 && view.phase !== 'ended';
    let n = 0;
    for (const p of view.players) if (p.alive && p.air === 1) n++;
    const mates = view.players.filter(p => p.team === me.team);
    const word = p => (!p.alive ? ['Out', 'out'] : p.air === 1 ? ['Aboard', 'air'] : p.air === 2 ? ['Gliding', 'gl'] : ['Landed', 'dn']);
    const key = flying ? `${n}|${mates.map(p => `${p.id}${word(p)[1]}`).join(',')}|${aboard}` : '';
    if (this.c.aboardKey === key) return;
    this.c.aboardKey = key;
    const el = this.$('.br-aboard');
    el.hidden = !flying;
    // The HUD's button stays as narrow as before (it sits between the sticks); the drop map's has room for both.
    this.jumpBtn.querySelector('small').textContent = aboard ? `${n} still aboard` : 'Leave the transport';
    this.jumpMap.querySelector('small').textContent = aboard ? `Leave the transport  /  ${n} aboard` : 'Leave the transport';
    if (!flying) return;
    const squad = (br.squad ?? 4) > 1 && mates.length > 1;
    el.innerHTML = `<div class="n"><b>${n}</b>${n === 1 ? 'player' : 'players'} still aboard</div>${squad ? mates.map(p => {
      const [w, cls] = word(p);
      return `<div class="m"><b>${p.id === me.id ? 'You' : nameHtml(p.name)}</b><span class="${cls}">${w}</span></div>`;
    }).join('') : ''}`;
  }

  // Fists (lit while they are out) and the pouch: rounds for guns not in hand.
  #hands(view, me, inv, air) {
    const ps = view.brPs;
    const show = !!ps && me.alive && !me.downed && !air;
    if (this.c.handsOn !== show) { this.c.handsOn = show; this.handsEl.hidden = !show; this.hud.layout(); }
    if (!show) return;
    const fists = ps.weapon === 'knife';
    const pouch = inv?.pouch ?? null;
    const key = `${fists}|${pouch}`;
    if (this.c.hands === key) return;
    this.c.hands = key;
    this.handsEl.querySelector('.br-slot').classList.toggle('on', fists);
    const P = ['Light', 'Rifle', 'Shell', 'Heavy', 'Rocket'];
    this.handsEl.querySelector('.br-pouch').innerHTML = pouch ? pouch.map((n, t) => (n > 0 ? `<span>${P[t]} <b>${n}</b></span>` : '')).join('') : '';
    void AMMO_TYPES;
  }

  #plates(me) {
    if (!this.platesEl) {
      const vit = this.hud.el.querySelector('.vitals');
      this.platesEl = document.createElement('div');
      this.platesEl.className = 'br-plates';
      this.platesEl.innerHTML = '<i></i><i></i><i></i>';
      (vit?.querySelector('.hp-bars') ?? vit)?.prepend(this.platesEl);
    }
    this.platesEl.hidden = !this.on;
    const a = me.alive ? me.brArmor ?? 0 : 0;
    if (this.c.armor === a) return;
    this.c.armor = a;
    [...this.platesEl.children].forEach((n, i) => n.style.setProperty('--k', Math.max(0, Math.min(1, (a - i * BR.plateHp) / BR.plateHp)).toFixed(2)));
  }

  #take(view, me, air) {
    const rules = view.br.rules;
    let best = null;
    if (rules && me.alive && !me.downed && !air) {
      const near = rules.near(me.x, me.z, BR.take, this.nearScratch || (this.nearScratch = []));
      let bestD = Infinity;
      for (const it of near) {
        if (it.kind !== BR_KIND.gun) continue;
        const d = Math.hypot(it.x - me.x, it.z - me.z);
        if (d < bestD) { bestD = d; best = it; }
      }
    }
    // An empty hand also fills itself by walking over a gun; with both full, the tap swaps the gun in your hand.
    const inv = view.br.inv;
    const handsFull = !!inv && inv.rarity[0] >= 0 && inv.rarity[1] >= 0;
    const id = best ? best.id : null;
    // With both hands full the swap replaces the gun in the hand you hold (fists out: the hand they are out in).
    const slot = handsFull ? view.brPs?.slot ?? 0 : -1;
    if (id === this.takeId && handsFull === this.takeFull && slot === this.takeSlot) return;
    this.takeId = id; this.takeFull = handsFull; this.takeSlot = slot;
    this.takeBtn.hidden = id === null;
    if (id === null) return;
    const gun = WEAPON_IDS[best.v], r = best.r;
    this.takeBtn.style.setProperty('--rar', BR.rarityCss[r]);
    this.takeBtn.dataset.r = r;
    this.takeBtn.dataset.pips = '◆'.repeat(r + 1);    // Colour modes show the tier as pips too (css/game.css).
    this.takeBtn.querySelector('.ti').innerHTML = icon(gun, { size: 15 });
    // Two short lines that fit the narrowest phone: what the tap does to which hand, then the gun in its rarity colour.
    this.takeBtn.querySelector('small').textContent = handsFull ? `Swap ${slot ? 'secondary' : 'primary'} for` : `Pick up as ${inv?.rarity[0] < 0 ? 'primary' : 'secondary'}`;
    this.takeBtn.querySelector('b').textContent = WEAPONS[gun]?.name ?? 'Gun';
    this.takeBtn.title = `${BR.rarityName[r]} ${WEAPONS[gun]?.name ?? 'gun'}`;
  }

  #squad(view, me) {
    const mates = view.players.filter(p => p.team === me.team && p.id !== me.id);
    const key = mates.map(p => `${p.id}|${Math.ceil(p.hp / 10)}|${Math.ceil((p.brArmor ?? 0) / 10)}|${p.alive}|${p.downed}|${p.out}|${p.away}|${p.air}|${p.redeploy}|${p.recallable}`).join(';');
    if (this.c.squad === key) return;
    this.c.squad = key;
    // Name, health and (a thin second bar) plates; downed is a red bar and a down mark, out a greyed row. No status
    // words: they crowded the names.
    this.squadEl.innerHTML = mates.map(p => {
      const state = !p.alive ? 'out' : p.downed ? 'down' : '';
      const plates = [0, 1, 2].map(i => `<i style="flex:1;--bar:#3fa0ff;--k:${p.alive ? Math.max(0, Math.min(1, ((p.brArmor ?? 0) - i * BR.plateHp) / BR.plateHp)).toFixed(2) : 0}"></i>`).join('');
      return `<div class="br-mate ${state}" style="--team:${TEAMS[p.team]?.css ?? '#fff'}"><b>${nameHtml(p.name)}</b><em>${p.downed && p.alive ? icon('ui:down', { size: 10, accent: 'currentColor' }) : !p.alive && p.redeploy ? icon('ui:refresh', { size: 10, accent: 'currentColor' }) : !p.alive && p.recallable ? icon('ui:beacon', { size: 10, accent: 'currentColor' }) : ''}</em>
        <span class="mbars"><i style="flex:1;--bar:${p.downed ? 'var(--c-red)' : 'var(--c-chalk)'};--k:${p.alive ? Math.max(0, Math.min(1, p.hp / MAX_HP)).toFixed(2) : 0}"></i></span><span class="mbars pl">${plates}</span></div>`;
    }).join('');
    this.squadEl.appendChild(this.rdEl);
    this.squadEl.appendChild(this.tagEl);
  }

  // Recall Beacons: the button at a beacon while you carry a squadmate's tag (it takes the take prompt's place), your
  // recall bar, and the note at the foot of the squad column (whose tag you carry, or that a squadmate can come back).
  #recall(view, me, air) {
    const br = view.br, inv = br.inv, c = this.c;
    this.recallInv = inv;
    const up = me.alive && !me.downed && !air;
    const tags = up ? inv?.tags ?? [] : [];
    const rec = up ? inv?.recall : null;
    let bc = null;
    if (br.recallOn && tags.length && !rec) {
      let bd = BR.recall.reach;
      for (const b of br.beacons ?? []) { if (b.used || b.user) continue; const d = Math.hypot(b.x - me.x, b.z - me.z); if (d <= bd) { bd = d; bc = b; } }
    }
    const nameOf = id => view.players.find(p => p.id === id)?.name ?? 'Squadmate';
    const show = !!bc || !!rec;
    this.recallB = bc ? bc.id : null;
    const bkey = show ? `${rec ? `r${rec.who}` : `b${bc.id}`}|${tags.join(',')}` : '';
    if (c.recallBtn !== bkey) {
      c.recallBtn = bkey;
      this.recallBtn.hidden = !show;
      if (!show) this.takeId = -2;          // The take prompt re-reads what is in reach.
      if (show) {
        this.recallBtn.querySelector('small').textContent = rec ? 'Hold still. Tap to stop' : 'Recall at the beacon';
        this.recallBtn.querySelector('b').textContent = nameOf(rec ? rec.who : tags[0]);
      }
    }
    if (show) this.takeBtn.hidden = true;
    const rkey = rec ? rec.who : '';
    if (c.recalling !== rkey) {
      c.recalling = rkey;
      this.recEl.hidden = !rec;
      if (rec) this.recEl.querySelector('b').textContent = `Recalling ${nameOf(rec.who)}`;
    }
    if (rec) this.recEl.querySelector('i i').style.transform = `scaleX(${Math.min(1, rec.k).toFixed(3)})`;
    // The note: the tag you carry, or a squadmate whose tag is lying where they fell.
    const lying = br.recallOn && me.alive ? view.players.find(p => p.team === me.team && p.id !== me.id && !p.alive && p.recallable) : null;
    const text = !br.recallOn || !me.alive ? '' : tags.length ? `${nameOf(tags[0])}'s tag: take it to a Recall Beacon` : lying ? `${lying.name}: pick up their tag where they fell` : '';
    if (c.tagNote !== text) { c.tagNote = text; this.tagEl.hidden = !text; this.tagEl.textContent = text; }
  }

  // Your own revive bar while you pick a teammate up (the downed one has theirs in the down panel).
  #reviving(view, me) {
    let pat = null;
    if (me.alive && !me.downed && !me.air) {
      let bd = 2.6;
      for (const p of view.players) {
        if (p.team !== me.team || p.id === me.id || !p.alive || !p.downed || !(p.reviveK > 0.01)) continue;
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < bd) { bd = d; pat = p; }
      }
    }
    const key = pat ? pat.id : '';
    if (this.c.rev !== key) {
      this.c.rev = key;
      this.revEl.hidden = !pat;
      if (pat) this.revEl.querySelector('b').textContent = `Reviving ${pat.name}`;
    }
    if (pat) this.revEl.querySelector('i i').style.transform = `scaleX(${Math.min(1, pat.reviveK).toFixed(3)})`;
  }

  // The kill leader: named when it changes, and (if not on your squad) shown on the maps where they were, every 30 s.
  #leader(view, me) {
    let best = null;
    for (const p of view.players) if (p.alive && (p.kills ?? 0) >= 3 && (!best || p.kills > best.kills)) best = p;
    const id = best?.id ?? null;
    if (id !== this.c.leaderId) {
      if (id && view.phase === 'live') this.hud.notify(id === me.id ? `You are the kill leader (${best.kills})` : `${best.name} is the kill leader (${best.kills})`);
      this.c.leaderId = id;
      this.leaderAt = -99;
    }
    const now = performance.now() / 1000;
    if (best && best.team !== me.team && now - this.leaderAt > 30) { this.leaderAt = now; this.leader = { x: best.x, z: best.z, name: best.name, kills: best.kills, t: now }; }
    if (!best || best.team === me.team) this.leader = null;
  }

  #downed(view, me, inv) {
    const down = me.alive && !!me.downed;
    const c = this.c;
    if (c.down !== down) {
      c.down = down;
      this.downEl.hidden = !down;
      this.hud.el.classList.toggle('br-down-on', down);
      if (down) this.toggleMap(false);
    }
    if (!down) return;
    const helping = (me.reviveK ?? 0) > 0.01;
    const text = inv?.use === 'self' ? 'Using your self-revive kit. Hold on.' : helping ? 'A teammate is reviving you. Stay close.' : 'Crawl to a teammate. They revive you by standing next to you.';
    if (c.downText !== text) { c.downText = text; this.downEl.querySelector('small').textContent = text; }
    this.downEl.querySelector('.bleed i').style.transform = `scaleX(${Math.max(0, Math.min(1, me.hp / BR.downHp)).toFixed(3)})`;
    this.downEl.querySelector('.rev i').style.transform = `scaleX(${Math.max(0, Math.min(1, me.reviveK ?? 0)).toFixed(3)})`;
    const self = !!inv?.kits && inv.use !== 'self';
    if (c.self !== self) { c.self = self; this.selfBtn.hidden = !self; }
  }

  // Out of the match: watching a teammate who is still in (Next player, Leave), or, the squad out, a clear choice of
  // Spectate (anyone left, player by player or squad by squad) or Leave (results now; main.js keeps the match running for
  // everyone else). Bots never hold it up: Leave is there from the moment you are out.
  #out(view, me) {
    const out = !me.alive && view.phase === 'live';
    const c = this.c;
    const watch = out ? spectate.target(view, me.id) : null;
    const mates = out ? view.players.filter(p => p.team === me.team && p.alive && p.id !== me.id).length : 0;
    const rd = out ? view.br.inv?.redeploy ?? 0 : 0;      // Rebound: seconds until you parachute back in.
    const recall = out && mates > 0 && !!me.recallable;    // Recall Beacons: your squad can still bring you back.
    const key = out ? `${watch}|${me.place}|${mates}|${spectate.any}|${view.br.squadsLeft}|${Math.ceil(rd)}|${recall}` : '';
    if (c.out === key) return;
    c.out = key;
    this.outEl.hidden = !out;
    this.hud.controls?.setDown(out);
    if (!out) return;
    const w = watch && view.players.find(p => p.id === watch);
    const others = !mates && !!w;            // Watching another squad.
    const choosing = !mates && !spectate.any;
    this.outEl.classList.toggle('watching', !!w);
    const $ = s => this.outEl.querySelector(s);
    $('b').innerHTML = mates ? 'Eliminated' : others ? `Watching ${nameHtml(w.name)}` : 'Squad out';
    $('.place').textContent = me.place ? `${ORD(me.place)} place` : '';
    const sq = others ? view.players.filter(p => p.team === w.team && p.alive).length : 0;
    $('small').textContent = mates ? (w ? `Spectating ${w.name}. Your squad can still win.` : 'Your squad can still win.')
      : others ? `${me.place ? `You: ${ORD(me.place)}  /  ` : ''}${view.br.squadsLeft ?? '?'} ${view.br.squad > 1 ? 'squads' : 'players'} left${view.br.squad > 1 ? `  /  ${sq} of theirs up` : ''}`
      : choosing ? 'Watch the rest, or see your results now.' : 'Nobody left to watch.';
    if (recall) $('small').textContent = `${w ? `Spectating ${w.name}. ` : ''}Your squad can recall you: your tag to a Recall Beacon.`;
    $('.br-spec').hidden = !choosing;
    $('.br-spec-next').hidden = choosing || (mates ? mates < 2 : !w);
    $('.br-spec-next').textContent = mates ? 'Next teammate' : 'Next player';
    $('.br-spec-squad').hidden = !others || view.br.squad < 2;
    const rdBar = $('.rd');
    rdBar.hidden = !(rd > 0);
    if (rd > 0) {
      const full = RB.redeploy[Math.min(view.br.phase, RB.redeploy.length - 1)];
      $('b').innerHTML = `Redeploying in ${Math.ceil(rd)}`;
      $('small').textContent = w ? `Watching ${w.name}. You parachute in next to your squad.` : 'You parachute in next to your squad.';
      rdBar.style.setProperty('--k', Math.max(0, Math.min(1, 1 - rd / full)).toFixed(2));
      $('.br-spec').hidden = true; $('.br-leave').hidden = false;
    }
  }

  // Rebound: at the foot of the squad column, whether a death still means a redeploy and until which circle.
  #reboundNote(view, br) {
    const on = this.rebound && view.phase !== 'ended';
    const live = on && br.phase < RB.redeployEnd && br.state !== 'final';
    const text = !on ? '' : live ? `Redeploys on until circle ${RB.redeployEnd + 1}` : 'Redeploys over';
    if (this.c.rd === text) return;
    this.c.rd = text;
    this.rdEl.hidden = !text;
    this.rdEl.textContent = text;
    this.rdEl.classList.toggle('off', on && !live);
  }

  // Feed rows and callouts for the battle royale's own events.
  onEvent(e, view) {
    if (!this.on || !view) return;
    const me = view.localId;
    const name = id => { const p = view.players.find(q => q.id === id); return p ? `<em style="color:${TEAMS[p.team]?.css ?? '#fff'}">${nameHtml(p.name)}</em>` : '?'; };
    const myTeam = view.players.find(p => p.id === me)?.team;
    switch (e.t) {
      case 'down': {
        const by = view.players.find(p => p.id === e.by);
        this.hud.pushFeed(`${name(e.by)}<span class="f-w">${icon(e.weapon, { size: 13 })}</span><span class="f-note" style="color:#ff9a8c">downed</span>${name(e.target)}`,
          e.by === me || e.target === me, by?.team === myTeam ? 'ally' : 'foe');
        if (e.by === me) this.hud.notify('Enemy down: finish them');
        break;
      }
      case 'revive':
        this.hud.pushFeed(`${name(e.by)}<span class="f-note" style="color:#7be08a">${e.by === e.id ? 'self-revived' : 'revived'}</span>${e.by === e.id ? '' : name(e.id)}`, e.id === me || e.by === me, 'ally');
        if (e.id === me) this.hud.notify(e.by === me ? 'Back up' : 'Revived');
        break;
      case 'brsquad':
        if (e.team === myTeam) this.hud.notify(`Squad out: ${ORD(e.place)} place`);
        else if (e.place <= 3) this.hud.notify(`${e.place - 1} squads left`);
        break;
      case 'brgive':
        if (e.id === me) {
          const w = WEAPONS[WEAPON_IDS[e.w]];
          this.hud.notify(`${BR.rarityName[e.r]} ${w?.name ?? 'gun'}`);
        }
        break;
      case 'brpick':
        if (e.id === me) this.hud.notify(`+ ${({ plate: 'Armor plate', med: 'Medkit', kit: 'Self-revive kit', lethal: 'Lethal', tactical: 'Tactical', ammo: 'Ammo' })[e.kind] ?? e.kind}`);
        break;
      case 'brping': {
        if (view.players.find(p => p.id === e.id)?.team !== myTeam) break;
        this.pings = this.pings.filter(g => g.id !== e.id);
        this.pings.push({ id: e.id, x: e.x, z: e.z, t: performance.now() / 1000, mine: e.id === me });
        if (e.id !== me) this.hud.notify(`${view.players.find(p => p.id === e.id)?.name ?? 'A squadmate'} marked a spot`);
        break;
      }
      case 'brphase':
        if (e.state === 'wait' && e.phase >= (this.phaseN ?? BR.phases.length) - 3 && !this.calledFinal) {
          this.calledFinal = true;
          const n = view.br?.squadsLeft ?? 0, solo = BR_SOLO(this.mode);
          const el = document.createElement('div');
          el.className = 'br-callout';
          el.innerHTML = `<b>Final circles</b><small>${n} ${solo ? (n === 1 ? 'player' : 'players') : n === 1 ? 'squad' : 'squads'} left. Hold inside the ring.</small>`;
          this.el.appendChild(el);
          setTimeout(() => el.remove(), 3500);
          break;
        }
        if (e.state === 'shrink') this.hud.notify('The circle is closing');
        else if (e.state === 'wait') this.hud.notify('Next circle marked on the map');
        else if (e.state === 'final') this.hud.notify('Final circle');
        break;
      case 'brjump': if (e.id === me) { this.c.mapDismissed = true; this.toggleMap(false); } break;
      case 'brtag': {
        const who = view.players.find(p => p.id === e.who)?.name ?? 'A squadmate';
        if (e.id === me) this.hud.notify(e.auto ? `${who}'s tag came to you: take it to a Recall Beacon` : `${who}'s tag: take it to a Recall Beacon`);
        else if (e.who === me) this.hud.notify(`${view.players.find(p => p.id === e.id)?.name ?? 'A squadmate'} has your tag`);
        break;
      }
      case 'brrecall': {
        const by = view.players.find(p => p.id === e.id), who = view.players.find(p => p.id === e.who);
        const bc = view.br?.beacons?.[e.b];
        if (e.kind === 'start') {
          this.recallPulse = { b: e.b, t: performance.now() / 1000 };
          if (by?.team === myTeam && e.id !== me) this.hud.notify(`${by.name} is recalling ${e.who === me ? 'you' : who?.name ?? 'a squadmate'}`);
          else if (by?.team !== myTeam) this.hud.notify(`A Recall Beacon is active${bc?.name ? ` at ${bc.name}` : ''}`);
        } else if (e.kind === 'done') {
          if (e.who === me) this.hud.notify('Recalled: steer the glide to the beacon');
          else if (who?.team === myTeam) this.hud.notify(`${who.name} is back in`);
          else this.hud.pushFeed(`${name(e.who)}<span class="f-note" style="color:#7be08a">recalled</span>`, false, 'foe');
        } else if (e.kind === 'stop' && e.id === me && e.why !== 'cancel' && e.why !== 'gone') this.hud.notify(e.why === 'left' ? 'Recall stopped: stay at the beacon' : 'Recall stopped');
        break;
      }
      case 'brbeacons':
        if (view.players.find(p => p.id === me)?.alive || !e.on) this.hud.notify(e.on ? 'Recall Beacons online' : 'Recall Beacons offline');
        break;
      case 'brwait':
        if (e.id === me) this.hud.notify(`Redeploy in ${Math.ceil(e.secs)} s while your squad holds on`);
        break;
      case 'brredeploy':
        if (e.id === me) this.hud.notify('Redeployed: steer the glide to your squad');
        else if (view.players.find(p => p.id === e.id)?.team === myTeam) this.hud.notify(`${view.players.find(p => p.id === e.id)?.name ?? 'A squadmate'} is back in`);
        break;
      default: break;
    }
  }

  // On the minimap (the whole map, scaled): the circle, the next one, the flight line while it matters.
  drawMini(g, view, me, sx, sz) {
    const br = view.br;
    if (!this.on || !br) return;
    g.save();
    // Outside the circle, darkened.
    g.fillStyle = 'rgba(120,20,40,.35)';
    g.beginPath();
    g.rect(-4000, -4000, 8000 + this.map.width * sx, 8000 + this.map.height * sz);    // The minimap may be translated (zoomed).
    g.arc(br.circle.x * sx, br.circle.z * sz, Math.max(0, br.circle.r * sx), 0, Math.PI * 2, true);
    g.fill('evenodd');
    // Outside the next circle: a dashed line in toward it.
    const dn = Math.hypot(me.x - br.next.x, me.z - br.next.z);
    if (me.alive && !me.air && br.state !== 'final' && dn > br.next.r && br.plane.f >= 1) {
      const k = (dn - br.next.r) / dn;
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(me.x * sx, me.z * sz); g.lineTo((me.x + (br.next.x - me.x) * k) * sx, (me.z + (br.next.z - me.z) * k) * sz); g.stroke(); g.setLineDash([]);
    }
    this.#marks(g, sx, sz, 1);
    this.#beacons(g, view, me, sx, sz, 1);
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(br.circle.x * sx, br.circle.z * sz, Math.max(0, br.circle.r * sx), 0, Math.PI * 2); g.stroke();
    if (br.state !== 'final') {
      g.setLineDash([5, 4]); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(br.next.x * sx, br.next.z * sz, Math.max(1, br.next.r * sx), 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
    if (br.plane.f < 1) {
      g.strokeStyle = 'rgba(255,190,80,.7)'; g.setLineDash([3, 4]); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(br.plane.fx * sx, br.plane.fz * sz); g.lineTo(br.plane.tx * sx, br.plane.tz * sz); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#ffbe50'; g.beginPath(); g.arc(br.plane.x * sx, br.plane.z * sz, 4, 0, Math.PI * 2); g.fill();
    }
    // Downed squadmates pulse red.
    for (const p of view.players) {
      if (p.team !== me.team || p.id === me.id || !p.alive || !p.downed) continue;
      g.strokeStyle = '#ff5a4a'; g.lineWidth = 2;
      g.beginPath(); g.arc(p.x * sx, p.z * sz, 5 + Math.sin(performance.now() / 150) * 2, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }

  // Recall Beacons on either map: shown while a squadmate can be recalled or you carry a tag (ready green, spent grey),
  // and to everyone while one is in use (pulsing amber). Your squad's tags on the ground as small white tags.
  #beacons(g, view, me, sx, sz, k) {
    const br = view.br;
    if (!br.recallOn || !br.beacons?.length) return;
    const need = (br.inv?.tags?.length ?? 0) > 0 || view.players.some(p => p.team === me.team && !p.alive && p.recallable);
    const now = performance.now() / 1000;
    for (const b of br.beacons) {
      const busy = !!b.user;
      if (!need && !busy) continue;
      const x = b.x * sx, y = b.z * sz, r = 5 * k;
      if (busy) {
        g.strokeStyle = '#ffbe50'; g.lineWidth = 2 * k;
        g.beginPath(); g.arc(x, y, r * (1.6 + 0.5 * Math.sin(now * 6)), 0, Math.PI * 2); g.stroke();
      }
      g.fillStyle = b.used ? '#6b7178' : busy ? '#ffbe50' : '#59d36b';
      g.strokeStyle = '#0a0d11'; g.lineWidth = 1.5 * k;
      g.beginPath(); g.moveTo(x, y - r * 1.3); g.lineTo(x + r, y); g.lineTo(x, y + r * 1.3); g.lineTo(x - r, y); g.closePath(); g.fill(); g.stroke();
      if (!b.used) { g.fillStyle = '#0a0d11'; g.fillRect(x - 0.8 * k, y - r * 0.7, 1.6 * k, r * 1.1); }
    }
    if (!need) return;
    for (const it of br.items) {
      if (!it || it.kind !== BR_KIND.tag || view.players[it.v]?.team !== me.team) continue;
      const x = it.x * sx, y = it.z * sz;
      g.fillStyle = '#ffffff'; g.strokeStyle = '#0a0d11'; g.lineWidth = 1.2 * k;
      g.beginPath(); g.rect(x - 3 * k, y - 4 * k, 6 * k, 8 * k); g.fill(); g.stroke();
      g.fillStyle = '#0a0d11'; g.beginPath(); g.arc(x, y - 2.2 * k, 0.9 * k, 0, Math.PI * 2); g.fill();
    }
  }

  // Squad pings and the kill leader's last reveal, on either map (k scales the marks).
  #marks(g, sx, sz, k) {
    const now = performance.now() / 1000;
    this.pings = this.pings.filter(p => now - p.t < 40);
    for (const p of this.pings) {
      const x = p.x * sx, y = p.z * sz, a = Math.max(0.35, 1 - (now - p.t) / 40);
      g.globalAlpha = a;
      g.fillStyle = p.mine ? '#ffffff' : '#ffc24a'; g.strokeStyle = '#0a0d11'; g.lineWidth = 1.5 * k;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 5 * k, y - 11 * k); g.arc(x, y - 11 * k, 5 * k, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
      g.globalAlpha = 1;
    }
    const L = this.leader;
    if (L && now - L.t < 30) {
      const x = L.x * sx, y = L.z * sz, r = (7 + Math.sin(now * 5) * 1.5) * k;
      g.strokeStyle = '#ffb21a'; g.lineWidth = 2 * k;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ffb21a';
      g.beginPath(); g.moveTo(x - 4 * k, y - 1 * k); g.lineTo(x - 4 * k, y - 6 * k); g.lineTo(x - 2 * k, y - 3 * k); g.lineTo(x, y - 7 * k); g.lineTo(x + 2 * k, y - 3 * k); g.lineTo(x + 4 * k, y - 6 * k); g.lineTo(x + 4 * k, y - 1 * k); g.closePath(); g.fill();
    }
  }

  // The zoomed minimap: a window of MINI_SPAN metres on the player (or the teammate watched), kept on the map.
  miniWindow(view, me, W, H) {
    if (!this.map || !view.br) return null;
    const eyeId = !me.alive ? spectate.target(view, me.id) : null;
    const eye = (eyeId && view.players.find(p => p.id === eyeId)) || me;
    const span = me.air === 1 || view.phase === 'warmup' ? Math.max(this.map.width, this.map.height) : MINI_SPAN;
    const k = W / span, spanZ = H / k;
    const ox = Math.max(0, Math.min(this.map.width - span, eye.x - span / 2)), oz = Math.max(0, Math.min(this.map.height - spanZ, eye.z - spanZ / 2));
    return { k, ox, oz, span, spanZ, W, H };
  }

  drawMiniBase(g, z) {
    const base = this.#mapBase(), s = this.baseS;
    g.fillStyle = '#1d242c'; g.fillRect(0, 0, z.W, z.H);
    g.drawImage(base, z.ox * s, z.oz * s, z.span * s, z.spanZ * s, 0, 0, z.W, z.H);
    g.fillStyle = 'rgba(10,13,17,.25)'; g.fillRect(0, 0, z.W, z.H);
  }

  #mapBase() {
    if (this.base) return this.base;
    const map = this.map, c = document.createElement('canvas');
    c.width = c.height = MAP_PX;
    const g = c.getContext('2d'), s = MAP_PX / Math.max(map.width, map.height);
    // A map with a painted overview (assets/maps/<id>-overview.jpg, north up, edge to edge) uses it once it loads.
    const img = new Image();
    img.onload = () => { g.drawImage(img, 0, 0, MAP_PX, MAP_PX); g.fillStyle = 'rgba(10,13,17,.18)'; g.fillRect(0, 0, MAP_PX, MAP_PX); };
    if (!map.devMap) img.src = `assets/maps/${map.id}-overview.jpg`;
    g.fillStyle = '#33402f'; g.fillRect(0, 0, MAP_PX, MAP_PX);
    for (const r of map.rooms ?? []) { g.fillStyle = '#5a5240'; g.fillRect(r.x * s, r.z * s, r.w * s, r.d * s); }
    for (const w of map.walls) {
      if (w.kind === 'border') continue;
      g.fillStyle = w.kind === 'water' ? '#2c4a54' : w.blocksVision ? '#b9b19a' : '#6f7660';
      g.fillRect(w.x * s, w.z * s, Math.max(1, w.w * s), Math.max(1, w.d * s));
    }
    this.base = c; this.baseS = s;
    return c;
  }

  #drawBigMap(view, me) {
    const g = this.mapG, br = view.br, s = MAP_PX / Math.max(this.map.width, this.map.height);
    g.drawImage(this.#mapBase(), 0, 0);
    // Circle and next circle.
    if (br.circle.r < Math.hypot(this.map.width, this.map.height) / 2) {
      g.fillStyle = 'rgba(120,20,40,.35)';
      g.beginPath(); g.rect(0, 0, MAP_PX, MAP_PX); g.arc(br.circle.x * s, br.circle.z * s, br.circle.r * s, 0, Math.PI * 2, true); g.fill('evenodd');
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(br.circle.x * s, br.circle.z * s, br.circle.r * s, 0, Math.PI * 2); g.stroke();
    }
    if (br.state !== 'final' && (br.plane.f >= 1 || br.phase > 0)) {
      g.setLineDash([10, 8]); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2;
      g.beginPath(); g.arc(br.next.x * s, br.next.z * s, Math.max(2, br.next.r * s), 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
    // Places.
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const poi of br.pois ?? []) {
      const x = poi.x * s, y = poi.z * s;
      g.font = `${poi.tier === 1 ? 20 : 16}px Oswald, "Arial Narrow", sans-serif`;
      const half = g.measureText(poi.name.toUpperCase()).width / 2 + 4;
      const lx = Math.max(half, Math.min(MAP_PX - half, x));
      g.lineWidth = 4; g.strokeStyle = 'rgba(10,13,17,.85)'; g.strokeText(poi.name.toUpperCase(), lx, y);
      g.fillStyle = poi.tier === 1 ? '#ffc24a' : poi.tier === 2 ? '#f2f0e6' : '#b8bfb6';
      g.fillText(poi.name.toUpperCase(), lx, y);
    }
    // Flight line and transport.
    if (br.plane.f < 1) {
      g.setLineDash([6, 8]); g.strokeStyle = 'rgba(255,190,80,.9)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(br.plane.fx * s, br.plane.fz * s); g.lineTo(br.plane.tx * s, br.plane.tz * s); g.stroke(); g.setLineDash([]);
      const a = Math.atan2(br.plane.tz - br.plane.fz, br.plane.tx - br.plane.fx), x = br.plane.x * s, y = br.plane.z * s;
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#ffbe50';
      g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -11); g.lineTo(-4, 0); g.lineTo(-8, 11); g.closePath(); g.fill();
      // Your squad still aboard: a dot each along the fuselage, in the squad's colour (you in white).
      const riders = view.players.filter(p => p.team === me.team && p.alive && p.air === 1);
      riders.forEach((p, i) => {
        g.fillStyle = p.id === me.id ? '#ffffff' : TEAMS[p.team]?.css ?? '#fff';
        g.strokeStyle = '#0a0d11'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(6 - i * 5, 0, 2.6, 0, Math.PI * 2); g.fill(); g.stroke();
      });
      g.restore();
      let aboardN = 0;
      for (const p of view.players) if (p.alive && p.air === 1) aboardN++;
      if (aboardN) {
        const label = `${aboardN} aboard`;
        g.font = '15px Oswald, "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        const ly = y + (y > MAP_PX - 40 ? -24 : 24), lx = Math.max(40, Math.min(MAP_PX - 40, x));
        g.lineWidth = 4; g.strokeStyle = 'rgba(10,13,17,.9)'; g.strokeText(label, lx, ly);
        g.fillStyle = '#ffbe50'; g.fillText(label, lx, ly);
      }
    }
    this.#marks(g, s, s, 1.8);
    this.#beacons(g, view, me, s, s, 1.8);
    // Squad and you.
    for (const p of view.players) {
      if (p.team !== me.team || !p.alive || p.air === 1) continue;
      const x = p.x * s, y = p.z * s;
      g.fillStyle = p.downed ? '#ff5a4a' : TEAMS[p.team]?.css ?? '#fff';
      g.strokeStyle = '#0a0d11'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, p.id === me.id ? 8 : 6, 0, Math.PI * 2); g.fill(); g.stroke();
      if (p.id === me.id) { g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.stroke(); }
    }
  }

  // The banner as the match ends: your placement.
  endBanner(endEl, winner, myTeam, view) {
    const me = view?.players.find(p => p.id === view.localId);
    const won = winner === myTeam;
    const squads = new Set(view?.players.map(p => p.team)).size;
    const place = won ? 1 : me?.place || squads;
    endEl.dataset.result = won ? 'win' : place <= 3 ? 'draw' : 'loss';
    endEl.querySelector('b').textContent = won ? 'Victory' : `${ORD(place)} place`;
    endEl.querySelector('small').textContent = won ? (MODES[this.mode]?.squad === 1 ? 'Last one standing' : 'Last squad standing') : `of ${squads} ${MODES[this.mode]?.squad === 1 ? 'players' : 'squads'}`;
  }
}

const BR_SOLO = mode => MODES[mode]?.squad === 1;
export { itemName };
