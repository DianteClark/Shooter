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
//   out       eliminated: placement, and who you are watching
//   map       the drop map before and during the flight (places, flight line, transport) and the full map on a tap of
//             the minimap: circle, next circle, squad.
import { BR, MODES } from '../shared/modes.js';
import { MAX_HP, TEAMS, WEAPON_IDS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { BR_KIND, itemName } from '../sim/br.js';
import { spectate } from '../sim/snd.js';
import { esc } from './widgets.js';
import { icon } from './icons.js';

const ORD = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const clock = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const MAP_PX = 640;          // Backing pixels of the big map.

const CSS = `
.br-ui { position: absolute; inset: 0; pointer-events: none; z-index: var(--z-hud-alert); }
.br-ui .br-map { z-index: var(--z-overlay); }
.br-ui [data-tap] { pointer-events: auto; }
.hud.br-on .scorebar, .hud.br-on .obj-strip, .hud.br-on .gun-rung { display: none !important; }
.hud.br-on .feed { top: calc(var(--st) + 134px); }
.hud.br-on .death { display: none !important; }
.br-top { position: absolute; left: 50%; top: calc(var(--st) + 6px); transform: translateX(-50%); display: flex; align-items: stretch; gap: 4px; }
.br-chip { display: flex; flex-direction: column; justify-content: center; align-items: center; min-width: 54px; height: 40px; padding: 0 9px;
  background: linear-gradient(180deg, rgba(42,51,61,.94), rgba(16,20,26,.9)); box-shadow: var(--hud-edge);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); }
.br-chip b { font: 400 21px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); font-variant-numeric: tabular-nums; }
.br-chip small { font: 9px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); margin-top: 2px; white-space: nowrap; }
.br-circle { min-width: 104px; box-shadow: var(--hud-edge), inset 0 -2px 0 var(--c-sodium); }
.br-circle.closing { box-shadow: var(--hud-edge), inset 0 -2px 0 var(--c-red); }
.br-circle.closing b { color: #ff8a7c; }
.br-pips { display: flex; gap: 2px; margin-top: 3px; }
.br-pips i { width: 9px; height: 3px; background: rgba(231,234,228,.2); }
.br-pips i.on { background: var(--c-sodium); }
.br-outside { position: absolute; left: 50%; top: calc(var(--st) + 52px); transform: translateX(-50%); padding: 4px 10px; font: 400 13px/1 var(--f-stencil);
  letter-spacing: var(--tr-stencil); color: #fff; background: rgba(165,42,31,.9); clip-path: polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%); animation: br-blink .7s steps(2, jump-none) infinite; }
@keyframes br-blink { to { opacity: .55; } }
.br-plates { display: flex; gap: 3px; height: 6px; margin-top: 1px; }
.br-plates i { flex: 1; position: relative; background: rgba(16,20,26,.85); box-shadow: inset 0 0 0 1px rgba(231,234,228,.16); transform: skewX(-24deg); overflow: hidden; }
.br-plates i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, #9fd1ff, #3fa0ff); transform-origin: left center; transform: scaleX(var(--k, 0)); }
.br-inv { position: absolute; left: 50%; bottom: calc(var(--sb) + 8px); transform: translateX(-50%); display: flex; gap: 6px; align-items: flex-end; }
.br-btn { position: relative; width: 50px; height: 46px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; border: 0; padding: 0;
  color: var(--c-chalk); background: linear-gradient(180deg, rgba(42,51,61,.92), rgba(16,20,26,.88)); box-shadow: var(--hud-edge);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); font: 400 15px/1 var(--f-stencil); }
.br-btn small { font: 8px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); }
.br-btn[disabled], .br-btn.off { opacity: .38; }
.br-btn.busy { box-shadow: var(--hud-edge), inset 0 -3px 0 var(--c-sodium); }
.br-btn .br-fill { position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; background: var(--c-sodium); transform-origin: left; transform: scaleX(0); }
.br-btn:active { filter: brightness(1.4); }
.br-jump { position: absolute; left: 50%; bottom: calc(var(--sb) + 70px); transform: translateX(-50%); min-width: 150px; height: 58px; padding: 0 22px; border: 0;
  font: 400 30px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-night); background: var(--c-sodium);
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); box-shadow: 0 0 0 2px #fff inset; }
.br-jump small { display: block; font: 10px/1 var(--f-plate); letter-spacing: var(--tr-plate); margin-top: 3px; }
.br-hint { position: absolute; left: 50%; bottom: calc(var(--sb) + 76px); transform: translateX(-50%); padding: 6px 12px; font: 13px/1.2 var(--f-plate);
  letter-spacing: var(--tr-plate); color: var(--c-chalk); background: var(--hud-glass, rgba(16,20,26,.75)); white-space: nowrap; text-align: center; }
.br-hint b { font: 400 16px/1 var(--f-stencil); color: var(--c-sodium); display: block; margin-bottom: 3px; }
.br-take { position: absolute; left: 50%; bottom: calc(var(--sb) + 104px); transform: translateX(-50%); display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 10px;
  border: 0; color: #fff; background: linear-gradient(180deg, rgba(42,51,61,.95), rgba(16,20,26,.92)); box-shadow: var(--hud-edge), inset 3px 0 0 var(--rar);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); white-space: nowrap; }
.br-take b { font: 400 16px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--rar); }
.br-take small { font: 10px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); }
.br-squad { position: absolute; left: calc(var(--sl) + 134px); top: calc(var(--st) + 6px); display: flex; flex-direction: column; gap: 3px; width: 84px; }
.br-mate { position: relative; display: grid; grid-template-columns: 1fr auto; gap: 1px 4px; padding: 3px 5px 3px 7px; background: var(--hud-glass-lo, rgba(16,20,26,.6)); box-shadow: inset 2px 0 0 var(--team); }
.br-mate b { font: 11px/1 var(--f-plate); letter-spacing: .04em; color: var(--c-chalk); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.br-mate em { font: 9px/1 var(--f-plate); font-style: normal; letter-spacing: var(--tr-plate); color: var(--c-haze); }
.br-mate .bars { grid-column: 1 / 3; display: flex; gap: 2px; height: 4px; }
.br-mate .bars i { position: relative; background: rgba(231,234,228,.12); overflow: hidden; }
.br-mate .bars i::after { content: ''; position: absolute; inset: 0; background: var(--bar); transform-origin: left; transform: scaleX(var(--k, 0)); }
.br-mate.down { box-shadow: inset 2px 0 0 var(--c-red); background: rgba(120,28,20,.55); }
.br-mate.down em { color: #ff9a8c; }
.br-mate.out { opacity: .4; }
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
.br-out .place { font: 400 44px/1 var(--f-stencil); color: var(--c-sodium); }
.br-out small { display: block; font: 12px/1.3 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); margin-top: 6px; }
.br-out button { margin-top: 10px; height: 36px; padding: 0 14px; border: 0; font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-night); background: var(--c-chalk);
  clip-path: polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px); }
.br-map { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 14px; background: rgba(10,13,17,.62); pointer-events: auto; }
.br-map-frame { position: relative; height: min(calc(100vh - 24px), 92vw); aspect-ratio: 1; box-shadow: 0 0 0 1px rgba(231,234,228,.3), 0 0 0 4px rgba(16,20,26,.7); }
.br-map canvas { width: 100%; height: 100%; display: block; }
.br-map-side { display: flex; flex-direction: column; gap: 8px; max-width: 200px; }
.br-map-side h3 { margin: 0; font: 400 24px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); }
.br-map-side p { margin: 0; font: 12px/1.35 var(--f-body); color: var(--c-haze); }
.br-map-side .br-jump { position: static; transform: none; }
.br-map-close { height: 36px; border: 0; padding: 0 14px; font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); background: rgba(42,51,61,.95); box-shadow: var(--hud-edge); }
.hud.br-on .minimap { cursor: pointer; pointer-events: auto; z-index: var(--z-hud-alert); }
.hud.lefty .br-squad { left: auto; right: calc(var(--sr) + 134px); }
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
      <div class="br-squad"></div>
      <div class="br-inv">
        <button class="br-btn br-plate" data-tap="1" data-act="plate">${icon('plates', { size: 18 })}<span class="n">0</span><small>Plate</small><i class="br-fill"></i></button>
        <button class="br-btn br-med" data-tap="1" data-act="med">${icon('ui:plus', { size: 16 })}<span class="n">0</span><small>Medkit</small><i class="br-fill"></i></button>
        <button class="br-btn br-kit" data-tap="1" data-act="self" hidden>${icon('ui:refresh', { size: 16 })}<span class="n">0</span><small>Revive</small></button>
      </div>
      <button class="br-take" data-tap="1" hidden><span class="ti"></span><span><b></b><br><small></small></span></button>
      <button class="br-jump br-jump-main" data-tap="1" hidden>JUMP<small>Leave the transport</small></button>
      <div class="br-hint" hidden></div>
      <div class="br-down" hidden><b>Down</b><small></small><div class="bleed"><i></i></div><div class="rev"><i></i></div>
        <button class="br-btn br-self" data-tap="1" hidden>${icon('ui:refresh', { size: 16 })}<span>Self-revive</span></button></div>
      <div class="br-out" hidden><b>Eliminated</b><div class="place"></div><small></small><button data-tap="1" class="br-spec-next" hidden>Next teammate</button></div>
      <div class="br-map" hidden data-tap="1">
        <div class="br-map-frame"><canvas width="${MAP_PX}" height="${MAP_PX}"></canvas></div>
        <div class="br-map-side">
          <h3 class="br-map-title">Drop map</h3>
          <p class="br-map-note"></p>
          <button class="br-jump br-jump-map" data-tap="1" hidden>JUMP<small>Leave the transport</small></button>
          <button class="br-map-close" data-tap="1">Close map</button>
        </div>
      </div>`;
    hud.el.appendChild(el);
    const $ = s => el.querySelector(s);
    this.$ = $;
    this.aliveEl = $('.br-alive b'); this.squadsEl = $('.br-squads b');
    this.circleEl = $('.br-circle'); this.circleT = $('.br-circle b'); this.circleS = $('.br-circle small'); this.pips = $('.br-pips');
    this.outsideEl = $('.br-outside');
    this.squadEl = $('.br-squad');
    this.plateBtn = $('.br-plate'); this.medBtn = $('.br-med'); this.kitBtn = $('.br-kit');
    this.takeBtn = $('.br-take');
    this.jumpBtn = $('.br-jump-main'); this.jumpMap = $('.br-jump-map');
    this.hintEl = $('.br-hint');
    this.downEl = $('.br-down'); this.selfBtn = $('.br-self');
    this.outEl = $('.br-out');
    this.mapEl = $('.br-map'); this.mapCanvas = $('.br-map canvas'); this.mapG = this.mapCanvas.getContext('2d');
    const act = (node, fn) => node.addEventListener('click', e => { e.stopPropagation(); fn(); });
    act(this.plateBtn, () => this.cmd?.('plate'));
    act(this.medBtn, () => this.cmd?.('med'));
    act(this.kitBtn, () => this.cmd?.('self'));
    act(this.selfBtn, () => this.cmd?.('self'));
    act(this.jumpBtn, () => this.#jump());
    act(this.jumpMap, () => this.#jump());
    act(this.takeBtn, () => { if (this.takeId !== null) this.cmd?.('take', { item: this.takeId }); });
    act($('.br-map-close'), () => this.toggleMap(false));
    act($('.br-spec-next'), () => { if (this.view) spectate.cycle(this.view, this.view.localId, 1); });
    this.mapEl.addEventListener('click', e => { if (e.target === this.mapEl) this.toggleMap(false); });
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
    this.hud.el.classList.toggle('br-on', on);
    this.hud.el.classList.remove('br-down-on');
    if (!on) return;
    this.map = map; this.roster = roster; this.localId = localId; this.mode = mode;
    this.c = {};
    this.mapManual = false;
    this.base = null;
    this.toggleMap(true, true);
    this.pips.innerHTML = '<i></i>'.repeat(BR.phases.length);
    const mm = this.hud.el.querySelector('.minimap');
    if (!this.mmWired) {
      this.mmWired = true;
      mm.setAttribute('data-tap', '1');
      mm.addEventListener('click', () => { if (this.on) this.toggleMap(!this.mapOpen); });
    }
  }

  toggleMap(open, auto = false) {
    this.mapOpen = open;
    this.mapEl.hidden = !open;
    if (!auto && open) this.mapManual = true;
    if (!open) this.mapManual = false;
    this.mapAuto = auto && open;
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
    if (c.circleS !== phaseLabel) { c.circleS = phaseLabel; this.circleS.textContent = phaseLabel; this.circleEl.classList.toggle('closing', br.state !== 'wait'); }
    const pip = br.phase + (br.state === 'final' ? 1 : 0);
    if (c.pip !== pip) { c.pip = pip; [...this.pips.children].forEach((n, i) => n.classList.toggle('on', i < pip)); }
    const outside = me.alive && !air && Math.hypot(me.x - br.circle.x, me.z - br.circle.z) > br.circle.r;
    if (c.outside !== outside) { c.outside = outside; this.outsideEl.hidden = !outside; }

    // Map: up by itself during boarding and the flight, until you jump or close it.
    const wantAuto = (view.phase === 'warmup' || air === 1) && me.alive;
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
        ? 'The transport flies the dotted line. Jump when it is near where you want to land, then steer the glide with the left stick. Gold names hold the best loot.'
        : 'White: the circle now. Dashed: where it closes to next. Tap outside the map to close.';
    }
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
        this.kitBtn.hidden = !inv.kits || BR_SOLO(this.mode);
        this.$('.br-inv').hidden = !me.alive || air !== 0;
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

    // A ground gun in reach while both hands hold guns: tap to swap the one in hand for it.
    this.#take(view, me, air);
    this.#squad(view, me);
    this.#downed(view, me, inv);
    this.#out(view, me);
  }

  #plates(me) {
    if (!this.platesEl) {
      const vit = this.hud.el.querySelector('.vitals');
      this.platesEl = document.createElement('div');
      this.platesEl.className = 'br-plates';
      this.platesEl.innerHTML = '<i></i><i></i><i></i>';
      vit?.appendChild(this.platesEl);
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
    if (id === this.takeId && handsFull === this.takeFull) return;
    this.takeId = id; this.takeFull = handsFull;
    this.takeBtn.hidden = id === null;
    if (id === null) return;
    const gun = WEAPON_IDS[best.v], r = best.r;
    this.takeBtn.style.setProperty('--rar', BR.rarityCss[r]);
    this.takeBtn.querySelector('.ti').innerHTML = icon(gun, { size: 18 });
    this.takeBtn.querySelector('b').textContent = `${handsFull ? 'Swap for' : 'Pick up'} ${WEAPONS[gun]?.name ?? 'gun'}`;
    this.takeBtn.querySelector('small').textContent = handsFull ? `${BR.rarityName[r]}  /  drops the gun in your hand` : `${BR.rarityName[r]}  /  into your empty hand`;
  }

  #squad(view, me) {
    const mates = view.players.filter(p => p.team === me.team && p.id !== me.id);
    const key = mates.map(p => `${p.id}|${Math.ceil(p.hp / 10)}|${Math.ceil((p.brArmor ?? 0) / 10)}|${p.alive}|${p.downed}|${p.out}|${p.away}|${p.air}`).join(';');
    if (this.c.squad === key) return;
    this.c.squad = key;
    this.squadEl.innerHTML = mates.map(p => {
      const state = !p.alive ? 'out' : p.downed ? 'down' : '';
      const note = !p.alive ? 'Out' : p.downed ? 'Down' : p.away ? 'Away' : p.air ? 'Air' : '';
      const plates = [0, 1, 2].map(i => `<i style="flex:1;--bar:#3fa0ff;--k:${Math.max(0, Math.min(1, ((p.brArmor ?? 0) - i * BR.plateHp) / BR.plateHp)).toFixed(2)}"></i>`).join('');
      return `<div class="br-mate ${state}" style="--team:${TEAMS[p.team]?.css ?? '#fff'}"><b>${esc(p.name)}</b><em>${note}</em>
        <span class="bars">${plates}<i style="flex:2.2;--bar:${p.downed ? 'var(--c-red)' : 'var(--c-chalk)'};--k:${p.alive ? Math.max(0, Math.min(1, p.hp / MAX_HP)).toFixed(2) : 0}"></i></span></div>`;
    }).join('');
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

  #out(view, me) {
    const out = !me.alive && view.phase === 'live';
    const c = this.c;
    const watch = out ? spectate.target(view, me.id) : null;
    const key = out ? `${watch}|${me.place}` : '';
    if (c.out === key) return;
    c.out = key;
    this.outEl.hidden = !out;
    this.hud.controls?.setDown(out);
    if (!out) return;
    const w = watch && view.players.find(p => p.id === watch);
    this.outEl.querySelector('b').textContent = w ? 'Eliminated' : 'Squad out';
    this.outEl.querySelector('.place').textContent = me.place ? `${ORD(me.place)} place` : '';
    this.outEl.querySelector('small').textContent = w ? `Spectating ${w.name}. Your squad can still win.` : 'Results come up when the match ends. You can leave from the scoreboard.';
    const left = view.players.filter(p => p.team === me.team && p.alive && p.id !== me.id).length;
    this.outEl.querySelector('.br-spec-next').hidden = left < 2;
  }

  // Feed rows and callouts for the battle royale's own events.
  onEvent(e, view) {
    if (!this.on || !view) return;
    const me = view.localId;
    const name = id => { const p = view.players.find(q => q.id === id); return p ? `<em style="color:${TEAMS[p.team]?.css ?? '#fff'}">${esc(p.name)}</em>` : '?'; };
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
      case 'brphase':
        if (e.state === 'shrink') this.hud.notify('The circle is closing');
        else if (e.state === 'wait') this.hud.notify('Next circle marked on the map');
        else if (e.state === 'final') this.hud.notify('Final circle');
        break;
      case 'brjump': if (e.id === me) { this.c.mapDismissed = true; this.toggleMap(false); } break;
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
    g.rect(0, 0, g.canvas.width, g.canvas.height);
    g.arc(br.circle.x * sx, br.circle.z * sz, Math.max(0, br.circle.r * sx), 0, Math.PI * 2, true);
    g.fill('evenodd');
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
      g.lineWidth = 4; g.strokeStyle = 'rgba(10,13,17,.85)'; g.strokeText(poi.name.toUpperCase(), x, y);
      g.fillStyle = poi.tier === 1 ? '#ffc24a' : poi.tier === 2 ? '#f2f0e6' : '#b8bfb6';
      g.fillText(poi.name.toUpperCase(), x, y);
    }
    // Flight line and transport.
    if (br.plane.f < 1) {
      g.setLineDash([6, 8]); g.strokeStyle = 'rgba(255,190,80,.9)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(br.plane.fx * s, br.plane.fz * s); g.lineTo(br.plane.tx * s, br.plane.tz * s); g.stroke(); g.setLineDash([]);
      const a = Math.atan2(br.plane.tz - br.plane.fz, br.plane.tx - br.plane.fx), x = br.plane.x * s, y = br.plane.z * s;
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#ffbe50';
      g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -11); g.lineTo(-4, 0); g.lineTo(-8, 11); g.closePath(); g.fill(); g.restore();
    }
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
