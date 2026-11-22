// The co-op campaign's HUD layer (docs/CAMPAIGN.md), its own module and elements like extraction's: the mission chips
// (mission, timer, stealth state), the objective card (the step's line, what it needs, a bar), radio subtitles (who and
// what, typed in, with a radio blip from js/audio/cp-sfx.js), the boss bar, the watchmen's detection meter, screen tags
// on the objective (charges, the VIP, the hunted target's last ping), the downed and reviving bars, the mission
// intro card, checkpoint and objective callouts, and the failed panel (the reason, the retry countdown, Retry now and
// Abort). js/ui/hud.js makes one and forwards prepare/update/onEvent/endBanner/drawMini; on Frontier it zooms the
// minimap round you.
import { CP, CP_DIFFS, RADIO, missionLines, cpDecode, OPERATIONS } from '../shared/campaign.js';
import { MAPS } from '../shared/map.js';
import { objOf } from '../sim/rules.js';
import { spectate } from '../sim/snd.js';
import { esc, nameHtml } from './widgets.js';
import { icon } from './icons.js';
import { cpRadio } from '../audio/audio.js';

const MAP_PX = 640, MINI_SPAN = 130, MARK_Y = 1.6, TAGS = 5;
const FAIL_TEXT = { wipe: 'The squad was wiped out', vip: 'Kestrel is down', time: 'Out of time', lost: 'The position was lost', escaped: 'The target got away', abort: 'Mission aborted',
  trail: 'You lost him', hostage: 'They moved Kestrel' };
const clock = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const CSS = `
.cp-ui { position: absolute; inset: 0; pointer-events: none; z-index: var(--z-hud-alert); }
.cp-ui [data-tap] { pointer-events: auto; }
.hud.cp-on .scorebar, .hud.cp-on .streaks, .hud.cp-on .obj-strip, .hud.cp-on .gun-rung { display: none !important; }
.cp-top { display: flex; gap: 4px; align-items: stretch; }
/* Mounted into the shared objective strip, so out of .cp-ui's reach: hidden here outside a campaign match. */
.hud:not(.cp-on) .cp-top, .hud:not(.cp-on) .cp-card, .hud:not(.cp-on) .cp-boss, .hud:not(.cp-on) .cp-rev { display: none !important; }
.cp-chip { display: flex; flex-direction: column; justify-content: center; align-items: center; min-width: 52px; height: 40px; padding: 0 9px;
  background: linear-gradient(180deg, rgba(42,51,61,.94), rgba(16,20,26,.9)); box-shadow: var(--hud-edge);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); }
.cp-chip b { font: 400 19px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); white-space: nowrap; font-variant-numeric: tabular-nums; }
.cp-chip small { font: 9px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); margin-top: 2px; white-space: nowrap; }
.cp-chip[hidden] { display: none !important; }
.cp-mis { box-shadow: var(--hud-edge), inset 0 -3px 0 #7cc8ff; }
.cp-mis b { color: #bfe6ff; }
.cp-timer.low b { color: #ff6b5c; }
.cp-hide { box-shadow: var(--hud-edge), inset 0 -3px 0 #9a8cff; }
.cp-hide b { color: #d8d0ff; font-size: 15px; }
.cp-hide.alarm { box-shadow: var(--hud-edge), inset 0 -3px 0 var(--c-red); animation: cp-blink .5s steps(2) infinite; }
.cp-hide.alarm b { color: #ff8a7c; }
@keyframes cp-blink { 50% { filter: brightness(1.6); } }
.cp-card { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 1px 6px; width: 250px; box-sizing: border-box; padding: 4px 8px 5px 7px;
  background: var(--hud-glass, rgba(16,20,26,.8)); box-shadow: var(--hud-edge), inset 3px 0 0 #7cc8ff;
  clip-path: polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px); }
.cp-card .ci { grid-column: 1; grid-row: 1 / 3; align-self: center; color: #7cc8ff; line-height: 0; }
.cp-card .ci svg { width: 16px; height: 16px; }
.cp-card b { grid-column: 2; grid-row: 1; }
.cp-card b { font: 400 15px/1.05 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-card small { grid-column: 2; font: 11px/1.15 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-card em { grid-column: 3; grid-row: 1 / 3; align-self: center; font: 400 13px/1 var(--f-stencil); font-style: normal; color: #7cc8ff; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cp-card em:empty { display: none; }
.cp-card .cpbar { grid-column: 1 / -1; grid-row: 3; height: 3px; margin-top: 2px; background: rgba(231,234,228,.14); position: relative; overflow: hidden; }
.cp-card .cpbar i { position: absolute; inset: 0; background: #7cc8ff; transform-origin: left; transform: scaleX(var(--k, 0)); }
.cp-card.warn { box-shadow: var(--hud-edge), inset 3px 0 0 var(--c-red); }
.cp-card.warn .cpbar i { background: var(--c-red); }
.cp-card.done { box-shadow: var(--hud-edge), inset 3px 0 0 #59d36b; }
.cp-boss { width: 250px; box-sizing: border-box; padding: 3px 8px 5px; text-align: center;
  background: var(--hud-glass, rgba(16,20,26,.78)); clip-path: polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px); }
.cp-boss b { font: 400 13px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #ff7a5a; }
.cp-boss b span { color: var(--c-haze); font-size: 11px; margin-left: 6px; }
.cp-boss b em { font-style: normal; }
.cp-boss > i { display: block; height: 6px; margin-top: 4px; background: rgba(231,234,228,.15); position: relative; overflow: hidden; }
.cp-boss > i i { position: absolute; inset: 0; background: linear-gradient(90deg, #ff4a2a, #ffb21a); transform-origin: left; transform: scaleX(var(--k, 1)); }
.cp-boss > i u { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(10,13,17,.9); }
.cp-boss.inv > i i { filter: grayscale(.8) brightness(1.4); }
.cp-radio { position: absolute; left: 50%; bottom: calc(var(--lane-b, 66px) + 62px); transform: translateX(-50%); max-width: min(560px, 70vw); padding: 6px 12px 7px;
  background: rgba(10,13,17,.78); box-shadow: inset 3px 0 0 var(--who, #7cc8ff); clip-path: polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px);
  transition: opacity .3s; }
.cp-radio[hidden] { display: block !important; opacity: 0; }
.cp-radio b { font: 400 13px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--who, #7cc8ff); margin-right: 8px; }
.cp-radio b::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: var(--who, #7cc8ff); box-shadow: 0 0 6px var(--who, #7cc8ff); vertical-align: 1px; animation: cp-blink .35s steps(2) infinite; }
.cp-radio span { font: 400 14px/1.3 var(--f-body); color: var(--c-chalk); }
.cp-eye { position: absolute; left: 50%; top: calc(var(--st, 0px) + 150px); transform: translateX(-50%); width: 120px; text-align: center; }
.cp-eye b { display: block; font: 400 14px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #ffd27c; text-shadow: 0 2px 0 rgba(0,0,0,.5); }
.cp-eye i { display: block; height: 5px; margin-top: 4px; background: rgba(16,20,26,.8); position: relative; overflow: hidden; }
.cp-eye i i { position: absolute; inset: 0; margin: 0; height: auto; background: #ffb21a; transform-origin: left; transform: scaleX(var(--k, 0)); }
.cp-eye.hot b { color: #ff6b5c; } .cp-eye.hot i i { background: #ff4a2a; }
.cp-tag { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; }
.cp-tag span { position: absolute; transform: translate(-50%, -100%); display: flex; align-items: center; gap: 3px; padding: 2px 6px 2px 4px; white-space: nowrap;
  font: 400 12px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-night); background: #7cc8ff;
  clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px); }
.cp-tag span small { font: 9px/1 var(--f-plate); letter-spacing: .02em; opacity: .8; }
.cp-tag.warn span { background: #ff8a7c; } .cp-tag.vip span { background: #9ff0c0; } .cp-tag.hvt span { background: #ffd27c; } .cp-tag.done span { background: #59d36b; }
.cp-down { position: absolute; left: var(--lane-x, 50%); bottom: var(--lane-b, 66px); transform: translateX(-50%); width: 250px; text-align: center; }
.cp-down b { display: block; font: 400 30px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #ff6b5c; text-shadow: 0 2px 0 rgba(0,0,0,.5); }
.cp-down small { display: block; font: 12px/1.3 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); margin: 5px 0 8px; text-shadow: var(--text-lift); }
.cp-down .bleed, .cp-down .rev { height: 6px; background: rgba(16,20,26,.8); margin: 4px 0; position: relative; overflow: hidden; }
.cp-down .bleed i, .cp-down .rev i { position: absolute; inset: 0; transform-origin: left; transform: scaleX(0); }
.cp-down .bleed i { background: var(--c-red); } .cp-down .rev i { background: #59d36b; }
.hud.cp-down-on .vignette { opacity: 1 !important; background: radial-gradient(ellipse at center, transparent 40%, rgba(150,20,12,.55)); }
.hud.cp-down-on .death, .hud.cp-fail-on .death { display: none !important; }
.cp-rev { width: 190px; padding: 6px 10px 7px; text-align: center; background: var(--hud-glass, rgba(16,20,26,.78)); clip-path: polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px); }
.cp-rev b { display: block; font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #7be08a; }
.cp-rev i { display: block; height: 5px; margin-top: 5px; background: rgba(231,234,228,.15); position: relative; overflow: hidden; }
.cp-rev i i { position: absolute; inset: 0; margin: 0; height: auto; background: #59d36b; transform-origin: left; transform: scaleX(0); }
.cp-intro { position: absolute; left: 50%; top: 26%; transform: translateX(-50%); text-align: center; pointer-events: none; animation: cp-in 5.5s ease-out forwards; }
.cp-intro small { display: block; font: 12px/1 var(--f-plate); letter-spacing: .3em; color: #7cc8ff; text-transform: uppercase; }
.cp-intro b { display: block; margin: 6px 0; font: 400 46px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); text-shadow: 0 3px 0 rgba(0,0,0,.55); white-space: nowrap; }
.cp-intro span { display: block; font: 13px/1.3 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); text-shadow: var(--text-lift); }
@keyframes cp-in { 0% { opacity: 0; transform: translate(-50%, 10px); } 10% { opacity: 1; transform: translate(-50%, 0); } 80% { opacity: 1; } 100% { opacity: 0; } }
.cp-callout { position: absolute; left: 50%; top: 30%; transform: translateX(-50%); text-align: center; pointer-events: none; animation: cp-call 3.4s ease-out forwards; }
.cp-callout b { display: block; font: 400 32px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #bfe6ff; text-shadow: 0 2px 0 rgba(0,0,0,.55), 0 0 18px rgba(124,200,255,.35); white-space: nowrap; }
.cp-callout.bad b { color: #ff8a7c; text-shadow: 0 2px 0 rgba(0,0,0,.55), 0 0 18px rgba(255,80,60,.4); }
.cp-callout small { display: block; margin-top: 4px; font: 13px/1.2 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); text-shadow: var(--text-lift); }
@keyframes cp-call { 0% { opacity: 0; transform: translate(-50%, 8px) scale(.96); } 12% { opacity: 1; transform: translate(-50%, 0) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }
.cp-fail { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: radial-gradient(ellipse at center, rgba(40,6,4,.55), rgba(10,4,4,.8)); pointer-events: auto; }
.cp-fail[hidden] { display: none !important; }
.cp-fail h2 { margin: 0; font: 400 46px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #ff6b5c; text-shadow: 0 3px 0 rgba(0,0,0,.6); }
.cp-fail p { margin: 0; font: 15px/1.3 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); }
.cp-fail small { font: 12px/1.2 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); }
.cp-fail .acts { display: flex; gap: 10px; margin-top: 8px; }
.cp-fail button { height: 44px; min-width: 150px; padding: 0 16px; border: 0; font: 400 19px/1 var(--f-stencil); letter-spacing: var(--tr-stencil);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); }
.cp-fail .go { color: var(--c-night); background: var(--c-sodium); box-shadow: 0 0 0 2px #fff inset; }
.cp-fail .quiet { color: var(--c-chalk); background: rgba(42,51,61,.92); box-shadow: 0 0 0 2px rgba(231,234,228,.3) inset; }
`;

export class CpHud {
  constructor(hud) {
    this.hud = hud;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = this.el = document.createElement('div');
    el.className = 'cp-ui';
    el.hidden = true;
    el.innerHTML = `
      <div class="cp-top">
        <div class="cp-chip cp-mis"><b>1</b><small>Mission</small></div>
        <div class="cp-chip cp-timer" hidden><b>0:00</b><small>Left</small></div>
        <div class="cp-chip cp-hide" hidden><b>HIDDEN</b><small>Stealth</small></div>
      </div>
      <div class="cp-card"><span class="ci">${icon('mode:cp', { size: 16 })}</span><b></b><small></small><em></em><div class="cpbar"><i></i></div></div>
      <div class="cp-boss" hidden><b><em class="cp-bn">Marshal Kordell</em><span></span></b><i><i></i><u style="left:66%"></u><u style="left:33%"></u></i></div>
      <div class="cp-rev" hidden><b>Reviving</b><i><i></i></i></div>
      <div class="cp-radio" hidden><b></b><span></span></div>
      <div class="cp-eye" hidden><b>SEEN</b><i><i></i></i></div>
      ${'<div class="cp-tag" hidden><span></span></div>'.repeat(TAGS)}
      <div class="cp-down" hidden><b>Down</b><small></small><div class="bleed"><i></i></div><div class="rev"><i></i></div></div>
      <div class="cp-fail" hidden data-tap="1"><h2>Mission failed</h2><p></p><small></small>
        <div class="acts"><button class="go cp-retry" data-tap="1">Retry now</button><button class="quiet cp-abort" data-tap="1">Abort mission</button></div></div>`;
    hud.el.appendChild(el);
    hud.strip.mount(el.querySelector('.cp-top'), { order: 0 });
    hud.strip.mount(el.querySelector('.cp-card'), { row: 1 });
    hud.strip.mount(el.querySelector('.cp-boss'), { row: 2 });
    hud.strip.mount(el.querySelector('.cp-rev'), { row: 2 });
    const $ = s => hud.el.querySelector(s);
    this.misEl = $('.cp-mis b'); this.misS = $('.cp-mis small');
    this.timerChip = $('.cp-timer'); this.timerEl = $('.cp-timer b'); this.timerS = $('.cp-timer small');
    this.hideChip = $('.cp-hide'); this.hideEl = $('.cp-hide b');
    this.card = $('.cp-card'); this.cardB = $('.cp-card b'); this.cardS = $('.cp-card small'); this.cardE = $('.cp-card em'); this.cardBar = $('.cp-card .cpbar i');
    this.bossEl = $('.cp-boss'); this.bossBar = $('.cp-boss > i > i'); this.bossS = $('.cp-boss b span'); this.bossN = $('.cp-boss .cp-bn');
    this.radioEl = $('.cp-radio'); this.radioWho = $('.cp-radio b'); this.radioText = $('.cp-radio span');
    this.eyeEl = $('.cp-eye'); this.eyeBar = $('.cp-eye i i');
    this.tags = [...el.querySelectorAll('.cp-tag')].map(root => ({ root, span: root.querySelector('span'), html: '', x: NaN, y: NaN, cls: '' }));
    this.downEl = $('.cp-down'); this.revEl = $('.cp-rev');
    this.failEl = $('.cp-fail'); this.failP = $('.cp-fail p'); this.failS = $('.cp-fail small');
    const act = (node, fn) => node.addEventListener('click', e => { e.stopPropagation(); fn(e); });
    act($('.cp-retry'), () => this.cmd?.('retry'));
    act($('.cp-abort'), () => this.cmd?.('abort'));
    this.c = {};
    this.queue = [];
  }

  onCommand(cb) { this.cmd = cb; }

  prepare(on, { map, roster, localId, mode, scoreLimit }) {
    this.on = on;
    this.el.hidden = !on;
    this.hud.el.classList.toggle('cp-on', on);
    this.hud.el.classList.remove('cp-down-on', 'cp-fail-on');
    if (!on) return;
    this.map = map; this.roster = roster; this.localId = localId; this.mode = mode;
    const { k, mission, diff } = cpDecode(scoreLimit);
    this.k = k; this.m = mission; this.diff = diff; this.lines = missionLines(mission);
    this.c = {}; this.base = null; this.queue = []; this.radioT = 0; this.say = null; this.introShown = false;
    this.failEl.hidden = true; this.radioEl.hidden = true;
    this.misEl.textContent = String(mission.n);
    // The boss's name: the mission's own (Operation Starfall's Director Vane), else Kordell.
    this.bossN.textContent = mission.boss?.name ?? 'Marshal Kordell';
    this.misS.textContent = `Mission · ${CP_DIFFS[diff].name}`;
  }

  // ---- Per frame ----

  update(view, me, dt) {
    const cp = objOf(view);
    if (!this.on || !cp?.cp) return;
    this.view = view;
    const c = this.c;
    if (!this.introShown && (view.phase === 'warmup' || cp.state === 'brief' || cp.t < 3)) this.#intro();
    // Chips: a timer while one runs, the stealth state on a stealth mission.
    const timed = cp.state === 'live' && cp.timer > 0 && (cp.step?.type === 'chase' || (cp.step?.type === 'plant' && cp.step.timer && cp.prog < 1) || cp.hostage || (cp.step?.type === 'boss' && cp.step.timer));
    if (c.timed !== timed) { c.timed = timed; this.timerChip.hidden = !timed; }
    if (timed) {
      const t = clock(cp.timer);
      if (c.timer !== t) { c.timer = t; this.timerEl.textContent = t; this.timerChip.classList.toggle('low', cp.timer < 15); this.timerS.textContent = cp.hostage ? 'Kestrel' : cp.step.type === 'chase' ? 'To the relay' : cp.step.type === 'boss' ? 'To launch' : 'To set them'; }
    }
    const stealthy = !!this.m.stealth;
    const hide = stealthy ? (cp.alarm ? 'ALARM' : cp.stealth ? 'HIDDEN' : 'CLEAR') : '';
    if (c.hide !== hide) { c.hide = hide; this.hideChip.hidden = !hide; this.hideEl.textContent = hide; this.hideChip.classList.toggle('alarm', hide === 'ALARM'); }
    this.#card(view, me, cp);
    this.#boss(cp);
    this.#eye(view, cp);
    this.#marks(view, me, cp);
    this.#downed(me, cp);
    this.#reviving(view, me);
    this.#fail(cp, me);
    this.#radio(dt);
  }

  #intro() {
    this.introShown = true;
    const n = document.createElement('div');
    n.className = 'cp-intro';
    n.innerHTML = `<small>${esc((OPERATIONS.find(o => o.id === this.m.op) ?? OPERATIONS[0]).name)}</small><b>${this.m.n}. ${esc(this.m.name)}</b><span>${esc(MAPS[this.m.map]?.name ?? '')} · ${esc(CP_DIFFS[this.diff].name)} · ${esc(this.m.tag)}</span>`;
    this.el.appendChild(n);
    setTimeout(() => n.remove(), 5600);
  }

  // The step's line, and what it needs right now: distance, progress, the timer, the VIP's state.
  #card(view, me, cp) {
    const s = cp.step;
    let title = s?.label ?? 'Stand by', sub = '', em = '', k = cp.prog ?? 0, cls = '';
    const eye = me.alive ? me : view.players.find(p => p.id === spectate.target(view, me.id)) ?? me;
    const far = p => (p ? `${Math.round(Math.hypot(p.x - eye.x, p.z - eye.z))} m` : '');
    if (cp.state === 'complete') { title = 'Mission complete'; sub = 'Lantern: good work.'; k = 1; cls = 'done'; }
    else if (s) {
      switch (s.type) {
        case 'goto': sub = s.stealth && cp.stealth ? 'Stay out of the torchlight' : 'Get there'; em = far(cp.at); k = 0; break;
        case 'extract': sub = 'Everyone who is up, inside the zone'; em = cp.prog > 0 ? `${Math.round(cp.prog * 100)}%` : far(cp.at); break;
        case 'hack': sub = cp.contested ? 'Contested: clear the area' : 'Stand on the terminal'; em = `${Math.round(cp.prog * 100)}%`; if (cp.contested) cls = 'warn'; break;
        case 'defend': sub = cp.lost > 0.05 ? `They are taking it: ${Math.round(cp.lost * 100)}%` : `Hold for ${clock((s.time ?? 0) * (1 - cp.prog))}`; em = far(cp.at); if (cp.lost > 0.3) cls = 'warn'; break;
        case 'plant': {
          const on = (cp.sites ?? []).filter(x => x.state === 1).length;
          sub = cp.fuse > 0 ? `Charges blow in ${Math.ceil(cp.fuse)} s: keep them off` : `${on} of ${cp.sites?.length ?? 0} set: stand still on one`;
          if ((cp.sites ?? []).some(x => x.state === 1 && x.def > 0.05)) { sub = 'They are pulling a charge!'; cls = 'warn'; }
          let near = null, nd = Infinity;
          for (const x of cp.sites ?? []) { if (x.state === 1 && !cp.fuse) continue; const d = Math.hypot(x.x - eye.x, x.z - eye.z); if (d < nd) { nd = d; near = x; } }
          em = near ? far(near) : ''; break;
        }
        case 'escort': {
          const v = cp.vip;
          sub = !v ? 'Kestrel is on her way' : view.players[v.idx]?.alive === false ? 'Kestrel is down' : cp.vipMoving ? `Kestrel is moving · ${Math.round(view.players[v.idx]?.hp ?? 100)}% health` : cp.contested ? 'Kestrel is pinned: clear the street' : 'Kestrel waits for you: stay close';
          if (cp.contested) cls = 'warn';
          em = `${cp.gate}/${cp.route?.length ?? 0}`; break;
        }
        case 'chase': sub = `Relay ${Math.min((cp.route?.length ?? 0), cp.gate + 1)} of ${cp.route?.length ?? 0}`; em = far(cp.route?.[cp.gate]); if (cp.timer < 15) cls = 'warn'; break;
        case 'kill': {
          const t = cp.target;
          sub = !t ? 'Target down' : t.moving ? 'He is running: cut him off' : (cp.route?.length ? 'Lantern pings him every 20 s' : 'Find him and put him down');
          if (t && cp.prog > 0 && !t.moving) { sub = `He is about to leave: ${Math.ceil(CP.hvtEscape * (1 - cp.prog))} s`; cls = 'warn'; }
          em = cp.ping ? far(cp.ping) : ''; break;
        }
        case 'boss': sub = cp.boss?.inv ? 'He is calling his guard' : 'Watch the ground for his barrage'; em = cp.boss ? `${Math.round(cp.boss.frac * 100)}%` : ''; k = cp.boss ? 1 - cp.boss.frac : 1; break;
        case 'pursue': {
          // Operation Starfall's courier: plated while he runs, lost if nobody stays near him.
          const t = cp.target, tp = t ? view.players[t.idx] : null;
          sub = !t ? 'Target down' : t.moving ? 'Bullets will not stop him: stay on him' : cp.prog >= 1 ? 'Cornered: put him down' : 'He will run when he sees you';
          if (cp.lost > 0.05) { sub = `You are losing him: ${Math.round(cp.lost * 100)}%`; if (cp.lost > 0.3) cls = 'warn'; }
          em = tp?.alive ? far(tp) : cp.ping ? far(cp.ping) : ''; break;
        }
      }
      // A hostage being moved (an alarm before she is free): the clock is all that matters.
      if (cp.hostage) { sub = 'They are moving Kestrel: get to her!'; cls = 'warn'; }
    }
    const key = `${title}|${sub}|${em}|${cls}`;
    if (this.c.card !== key) { this.c.card = key; this.cardB.textContent = title; this.cardS.textContent = sub; this.cardE.textContent = em; this.card.className = `cp-card os-item ${cls}`; }
    const kk = Math.max(0, Math.min(1, k)).toFixed(3);
    if (this.c.k !== kk) { this.c.k = kk; this.cardBar.style.setProperty('--k', kk); }
  }

  #boss(cp) {
    const b = cp.boss;
    if (this.c.boss !== !!b) { this.c.boss = !!b; this.bossEl.hidden = !b; }
    if (!b) return;
    this.bossBar.style.setProperty('--k', b.frac.toFixed(3));
    this.bossEl.classList.toggle('inv', !!b.inv);
    const ph = `Phase ${b.phase + 1}`;
    if (this.c.ph !== ph) { this.c.ph = ph; this.bossS.textContent = ph; }
  }

  // The highest of the watchmen's meters (their torches on someone of the squad).
  #eye(view, cp) {
    let see = 0;
    if (cp.stealth) for (const p of view.players) if (p.alive && p.cpSee > see) see = p.cpSee;
    const on = see > 0.04;
    if (this.c.eye !== on) { this.c.eye = on; this.eyeEl.hidden = !on; }
    if (!on) return;
    this.eyeBar.style.setProperty('--k', see.toFixed(3));
    this.eyeEl.classList.toggle('hot', see > 0.6);
    const t = see > 0.6 ? 'ALMOST SEEN' : 'SUSPICIOUS';
    if (this.c.eyeT !== t) { this.c.eyeT = t; this.eyeEl.querySelector('b').textContent = t; }
  }

  #marks(view, me, cp) {
    const eye = me.alive ? me : view.players.find(p => p.id === spectate.target(view, me.id)) ?? me;
    let n = 0;
    const s = cp.step, d = p => `<small>${Math.round(Math.hypot(p.x - eye.x, p.z - eye.z))} m</small>`;
    if (cp.state === 'live' && s) {
      if (s.type === 'plant') {
        for (const x of cp.sites ?? []) {
          if (n >= TAGS) break;
          const pulled = x.state === 1 && x.def > 0.05;
          if (x.state === 1 && !pulled && !(cp.fuse > 0)) continue;
          n = this.#tag(n, x.x, x.z, pulled ? 'warn' : x.state ? 'done' : '', `${icon('ex:cache', { size: 12 })}${pulled ? 'Pulling!' : x.state ? `${Math.ceil(cp.fuse)} s` : s.tap ? 'Tap' : 'Charge'} ${d(x)}`, eye);
        }
      } else if (s.type === 'escort') {
        const v = cp.vip ? view.players[cp.vip.idx] : null;
        if (v?.alive) n = this.#tag(n, v.x, v.z, 'vip', `${icon('ui:user', { size: 12 })}Kestrel ${d(v)}`, eye);
        const g = cp.route?.[cp.gate];
        if (g) n = this.#tag(n, g.x, g.z, '', `${icon('mode:cp', { size: 12 })}Next stop ${d(g)}`, eye, false);
      } else if (s.type === 'chase') {
        const g = cp.route?.[cp.gate];
        if (g) n = this.#tag(n, g.x, g.z, cp.timer < 15 ? 'warn' : '', `${icon('ui:timer', { size: 12 })}Relay ${d(g)}`, eye);
      } else if (s.type === 'kill' || s.type === 'pursue') {
        const t = cp.target ? view.players[cp.target.idx] : null;
        const seenNow = t?.alive && Math.hypot(t.x - eye.x, t.z - eye.z) < (s.type === 'pursue' ? 60 : 30);
        const at = seenNow ? t : cp.ping;
        if (at) n = this.#tag(n, at.x, at.z, 'hvt', `${icon('ex:hvt', { size: 12 })}${esc(t?.name ?? 'Target')} ${d(at)}`, eye);
      } else if (s.type === 'boss') {
        // The boss is plain to see: no tag.
      } else if (cp.at) n = this.#tag(n, cp.at.x, cp.at.z, s.type === 'hack' && cp.contested ? 'warn' : '', `${icon(s.type === 'hack' ? 'ex:hack' : 'mode:cp', { size: 12 })}${s.type === 'extract' ? 'Exfil' : s.type === 'hack' ? 'Terminal' : s.type === 'defend' ? 'Hold' : 'Go'} ${d(cp.at)}`, eye);
    }
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
    const mx = 70, top = 112, bottom = H - 122;
    const off = sx < mx || sx > W - mx || sy < top || sy > bottom;
    if (off && !pin) { t.root.hidden = true; return k + 1; }
    if (off) {
      const cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy;
      const kx = dx ? ((dx > 0 ? W - mx : mx) - cx) / dx : Infinity, ky = dy ? ((dy > 0 ? bottom : top) - cy) / dy : Infinity;
      const s = Math.min(kx, ky);
      sx = cx + dx * s; sy = cy + dy * s;
      if (sx < 300 && sy < 150) sy = 150;      // Under the objective card, not on it.
    }
    sx = Math.round(sx); sy = Math.round(sy);
    t.root.hidden = false;
    const cl = `cp-tag ${cls}`;
    if (t.cls !== cl) { t.cls = cl; t.root.className = cl; }
    if (t.html !== html) { t.html = html; t.span.innerHTML = html; }
    if (sx !== t.x || sy !== t.y) { t.x = sx; t.y = sy; t.root.style.transform = `translate3d(${sx}px,${sy}px,0)`; }
    return k + 1;
  }

  #downed(me, cp) {
    const down = me.alive && !!me.downed && cp.state === 'live', c = this.c;
    if (c.down !== down) { c.down = down; this.downEl.hidden = !down; this.hud.el.classList.toggle('cp-down-on', down); }
    if (!down) return;
    const helping = (me.reviveK ?? 0) > 0.01;
    const text = helping ? 'A squadmate is reviving you. Stay close.' : 'Crawl to a squadmate. Standing next to you, they bring you back.';
    if (c.downText !== text) { c.downText = text; this.downEl.querySelector('small').textContent = text; }
    this.downEl.querySelector('.bleed i').style.transform = `scaleX(${Math.max(0, Math.min(1, me.hp / CP.downHp)).toFixed(3)})`;
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
    if (this.c.rev !== key) { this.c.rev = key; this.revEl.hidden = !pat; if (pat) this.revEl.querySelector('b').innerHTML = `Reviving ${nameHtml(pat.name)}`; }
    if (pat) this.revEl.querySelector('i i').style.transform = `scaleX(${Math.min(1, pat.reviveK).toFixed(3)})`;
  }

  // Failed: what went wrong, the retry from the checkpoint counting down, Retry now and Abort (a human's choice).
  #fail(cp, me) {
    const on = cp.state === 'failed';
    if (this.c.fail !== on) { this.c.fail = on; this.failEl.hidden = !on; this.hud.el.classList.toggle('cp-fail-on', on); this.failP.textContent = FAIL_TEXT[cp.why] ?? 'The mission failed'; }
    if (!on) return;
    const left = Math.max(0, Math.ceil(CP.failHold - (cp.stateT ?? 0)));
    const t = `Back to the last checkpoint in ${left} s · attempt ${cp.fails + 1}`;
    if (this.c.failT !== t) { this.c.failT = t; this.failS.textContent = t; }
    void me;
  }

  // ---- Radio ----

  #radio(dt) {
    if (this.say) {
      this.radioT += dt;
      const [, text] = this.say, shown = Math.min(text.length, Math.floor(this.radioT * 60));
      if (this.c.typed !== shown) { this.c.typed = shown; this.radioText.textContent = text.slice(0, shown); }
      if (this.radioT > 2.2 + text.length / 22) { this.say = null; this.radioEl.hidden = true; }
      return;
    }
    const next = this.queue.shift();
    if (!next) return;
    this.say = next; this.radioT = 0; this.c.typed = -1;
    const who = RADIO[next[0]] ?? RADIO.lantern;
    this.radioEl.style.setProperty('--who', who.css);
    this.radioWho.textContent = who.name;
    this.radioText.textContent = '';
    this.radioEl.hidden = false;
    cpRadio(next[0]);
  }

  onEvent(e, view) {
    if (!this.on || !view) return;
    const me = view.players.find(p => p.id === view.localId);
    const name = id => { const p = view.players.find(q => q.id === id); return p ? `<em style="color:${p.team === 0 ? '#38b6ff' : '#ff4d3d'}">${nameHtml(p.name)}</em>` : '?'; };
    switch (e.t) {
      case 'cpradio': { const l = this.lines[e.k]; if (l) { this.queue.push(l); if (this.queue.length > 4) this.queue.shift(); } break; }
      case 'cpstep': if (e.i > 0) this.hud.notify(`New objective: ${this.m.steps[e.i]?.label ?? ''}`); break;
      case 'cpdone': this.#callout('Objective complete', this.m.steps[e.i]?.label ?? ''); break;
      case 'cpcheck': if ((objOf(view)?.t ?? 0) > 4) this.hud.notify('Checkpoint reached'); break;
      case 'cpfail': this.queue.length = 0; this.say = null; this.radioEl.hidden = true; break;
      case 'cpretry': this.#callout('Checkpoint', 'Back where you left off'); break;
      case 'cpwin': this.#callout('Mission complete', `${this.m.n}. ${this.m.name}`); break;
      case 'cpalarm': this.#callout('Alarm!', this.m.hostage && !objOf(view)?.freed ? 'They are moving Kestrel: get to her!' : 'They know you are here', true); break;
      case 'cpflare': this.#callout('Flare!', 'Everyone can see: use it', true); break;
      case 'cpplant': this.hud.notify(e.pulled ? 'They pulled a charge: set it again' : this.m.steps.find(s => s.type === 'plant')?.tap ? 'Tap in place' : 'Charge set'); break;
      case 'cpgate': if (this.m.steps.find(s => s.type === 'chase')) this.hud.notify('Relay reached: more time'); else if (objOf(view)?.step?.type === 'pursue') this.hud.notify('He is still running: stay on him'); break;
      case 'cpphase': this.#callout(`Phase ${e.n + 1}`, e.n === 1 ? 'He calls his guard' : 'He charges: step aside when he lines up', true); break;
      case 'cpping': break;
      case 'down':
        this.hud.pushFeed(`${name(e.by)}<span class="f-w">${icon(e.weapon, { size: 13 })}</span><span class="f-note" style="color:#ff9a8c">downed</span>${name(e.target)}`, e.by === me?.id || e.target === me?.id, 'foe');
        break;
      case 'revive':
        this.hud.pushFeed(`${name(e.by)}<span class="f-note" style="color:#7be08a">revived</span>${name(e.id)}`, e.id === me?.id || e.by === me?.id, 'ally');
        if (e.id === me?.id) this.hud.notify('Revived');
        break;
    }
  }

  #callout(title, sub, bad = false) {
    this.el.querySelector('.cp-callout')?.remove();
    const n = document.createElement('div');
    n.className = `cp-callout${bad ? ' bad' : ''}`;
    n.innerHTML = `<b>${esc(title)}</b><small>${esc(sub)}</small>`;
    this.el.appendChild(n);
    setTimeout(() => n.remove(), 3500);
  }

  // ---- Minimap: on Frontier a window round you; the objective, the sites, the VIP, the ping ----

  miniWindow(view, me, W, H) {
    if (!this.map || this.map.size !== 'giant') return null;
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
    for (const w of map.walls) {
      if (w.kind === 'border') continue;
      g.fillStyle = w.kind === 'water' ? '#2c4a54' : w.blocksVision ? '#b9b19a' : '#6f7660';
      g.fillRect(w.x * s, w.z * s, Math.max(1, w.w * s), Math.max(1, w.d * s));
    }
    this.base = c;
    return c;
  }

  drawMini(g, view, me, sx, sz) {
    const cp = objOf(view);
    if (!this.on || !cp?.cp || cp.state !== 'live') return;
    const t = performance.now() / 1000, s = cp.step;
    const diamond = (x, z, col, r = 4 + Math.sin(t * 5) * 1.2) => {
      g.fillStyle = col;
      g.beginPath(); g.moveTo(x * sx, z * sz - r - 2); g.lineTo(x * sx + r, z * sz); g.lineTo(x * sx, z * sz + r + 2); g.lineTo(x * sx - r, z * sz); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(10,13,17,.8)'; g.lineWidth = 1; g.stroke();
    };
    if (s?.type === 'plant') for (const x of cp.sites ?? []) diamond(x.x, x.z, x.state ? (x.def > 0.05 ? '#ff6a5a' : '#59d36b') : '#7cc8ff');
    else if (s?.type === 'escort' || s?.type === 'chase') { const gte = cp.route?.[cp.gate]; if (gte) diamond(gte.x, gte.z, '#7cc8ff'); }
    else if (s?.type === 'kill') { if (cp.ping) diamond(cp.ping.x, cp.ping.z, '#ffd27c'); }
    else if (cp.at && s?.type !== 'boss') {
      if (s?.r && (s.type === 'defend' || s.type === 'hack' || s.type === 'extract')) { g.strokeStyle = cp.contested ? '#ff6a5a' : '#7cc8ff'; g.lineWidth = 1.5; g.beginPath(); g.arc(cp.at.x * sx, cp.at.z * sz, Math.max(3, s.r * sx), 0, Math.PI * 2); g.stroke(); }
      diamond(cp.at.x, cp.at.z, '#7cc8ff');
    }
    if (cp.vip) { const v = view.players[cp.vip.idx]; if (v?.alive) { g.fillStyle = '#9ff0c0'; g.beginPath(); g.arc(v.x * sx, v.z * sz, 3.5, 0, Math.PI * 2); g.fill(); } }
    for (const h of cp.hazards ?? []) {
      g.strokeStyle = 'rgba(255,90,60,.9)'; g.lineWidth = 1.5;
      if (h.k === 0) { g.beginPath(); g.arc(h.x * sx, h.z * sz, Math.max(2, h.r * sx), 0, Math.PI * 2); g.stroke(); }
      else { g.beginPath(); g.moveTo(h.x * sx, h.z * sz); g.lineTo(h.x2 * sx, h.z2 * sz); g.stroke(); }
    }
  }

  endBanner(endEl, winner, myTeam, view) {
    const cp = objOf(view), won = winner === 0 && cp?.state === 'complete';
    endEl.dataset.result = won ? 'win' : 'loss';
    endEl.querySelector('b').textContent = won ? 'Mission complete' : 'Mission failed';
    endEl.querySelector('small').textContent = `${this.m?.n ?? ''}. ${this.m?.name ?? ''} · ${CP_DIFFS[this.diff ?? 1].name}`;
  }
}
