// Graveyard Shift's HUD layer (docs/ZOMBIES.md), its own module and elements like extraction's, so the HUD redesign
// can move it: the round plate (round, zombies left, Double Pay, the boss's health), the crew list (points, perks,
// downs), the use button bottom-centre clear of both sticks (open a gate, buy a gun or its ammo, the mystery crate,
// a perk machine), the downed and reviving bars, the "back next round" panel, points pops and round banners.
// The economy (ROADMAP item 36): the use button's prompts for the bench, the terminal, the armour bench, traps, the exfil
// pad, the relics and the altar; the plate bar over health; tier pips on the weapon panel; the supply terminal's sheet
// (five items, controller-navigable: js/ui/gamepad.js MATCH_PANELS); the exfil clock and the relic count on the plate.
// js/ui/hud.js makes one, forwards prepare/update/onEvent/endBanner, and asks quietKill() before a kill-feed row.
import { MODES } from '../shared/modes.js';
import { WEAPONS } from '../shared/weapons.js';
import { objOf } from '../sim/rules.js';
import { ZM, ZE, ZM_PERKS, ZM_PERK_IDS, ZM_POWERUP_NAMES, ZM_KIND_NAMES, ZM_ROUND_NAMES, ZM_FX, ZM_TRAP_NAMES, zmUsable, zmFxOf, supplyCost, zmGunName, zmWonderOf,
  zmQuestBoss, questBossByKind, ZM_LANTERNS, lanternOrderText } from '../shared/zombies.js';
import { kitRoom } from '../sim/zm-econ.js';     // The armour bench's kit refill, the same test as the host's.
// The relic quest's clue, once from round 3 (dev/ui-zombies-test.py checks it reads whole at every width).
export const QUEST_HINT = 'Something glows in the dead ends: old lanterns, still warm';
// Polestar Relay's radio quest (layout questKind 'radio'): its own clue, and the names that go with it.
export const RADIO_HINT = 'Static on the radios: with the power on, something might be listening';
// Wrenfield Fair's lantern quest (questKind 'lantern'): its clue.
export const LANTERN_HINT = 'The fair\'s lanterns are cold: with the power on, the Oracle knows the order';
const questBossName = z => zmQuestBoss(z?.layout).name;


const CSS = `
.zm-ui { position: absolute; inset: 0; pointer-events: none; z-index: var(--z-hud-alert); }
.zm-ui [data-tap] { pointer-events: auto; }
.hud.zm-on .scorebar, .hud.zm-on .obj-strip, .hud.zm-on .gun-rung, .hud.zm-on .streaks, .hud.zm-on .death { display: none !important; }
/* The round plate and the boss bar ride the objective strip (rows 0 and 1, js/ui/hud.js layout()); the feed goes under
   the crew list by the same pass. */
.zm-top { display: flex; gap: 4px; align-items: stretch; }
.zm-top[hidden], .zm-top [hidden], .zm-boss[hidden] { display: none !important; }
.zm-chip { display: flex; flex-direction: column; justify-content: center; align-items: center; min-width: 50px; height: 40px; padding: 0 9px;
  background: linear-gradient(180deg, rgba(42,51,61,.94), rgba(16,20,26,.9)); box-shadow: var(--hud-edge);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); }
.zm-chip b { font: 400 20px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); font-variant-numeric: tabular-nums; white-space: nowrap; }
.zm-chip small { font: 9px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); margin-top: 2px; white-space: nowrap; }
.zm-round { min-width: 64px; box-shadow: var(--hud-edge), inset 0 -3px 0 #b8241c; }
.zm-round b { font-size: 28px; color: #ff5446; text-shadow: 0 0 10px rgba(255,60,40,.45); }
.zm-round.boss b { color: #ffb21a; }
.zm-dbl { box-shadow: var(--hud-edge), inset 0 -2px 0 var(--c-sodium); }
.zm-dbl b { color: var(--c-sodium); }
.zm-pts b { color: var(--c-sodium); }
.zm-boss { width: 220px; box-sizing: border-box; padding: 3px 8px 5px; text-align: center;
  background: var(--hud-glass, rgba(16,20,26,.78)); clip-path: polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px); }
.zm-boss b { font: 400 13px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #ffb21a; }
.zm-boss i { display: block; height: 5px; margin-top: 4px; background: rgba(231,234,228,.15); position: relative; overflow: hidden; }
.zm-boss i i { position: absolute; inset: 0; margin: 0; height: auto; background: #ff7a1a; transform-origin: left; transform: scaleX(var(--k, 1)); }
.zm-crew { position: absolute; left: calc(var(--sl) + 134px); top: calc(var(--st) + 6px); display: flex; flex-direction: column; gap: 2px; width: 112px;
  transform: scale(var(--hud-k, 1)); transform-origin: left top; }
.hud.lefty .zm-crew { left: auto; right: calc(var(--sr) + 134px); transform-origin: right top; }
/* One fixed-height row per player (four at most): name and points, the perks under them. */
.zm-mate { box-sizing: border-box; height: 24px; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: 11px 6px; gap: 2px 4px; padding: 2px 5px 3px 7px; overflow: hidden; background: var(--hud-glass-lo, rgba(16,20,26,.6)); box-shadow: inset 2px 0 0 var(--team, #38b6ff); }
.zm-mate.me { background: rgba(60,48,16,.72); box-shadow: inset 2px 0 0 var(--c-sodium); }
.zm-mate b { min-width: 0; font: 11px/11px var(--f-plate); letter-spacing: .04em; color: var(--c-chalk); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.zm-mate em { font: 400 13px/11px var(--f-stencil); font-style: normal; letter-spacing: var(--tr-stencil); color: var(--c-sodium); font-variant-numeric: tabular-nums; }
.zm-mate span { grid-column: 1 / 3; display: flex; gap: 2px; height: 6px; }
.zm-mate span i { width: 10px; height: 6px; background: var(--k); box-shadow: 0 0 4px var(--k); }
.zm-mate.down { box-shadow: inset 2px 0 0 var(--c-red); background: rgba(120,28,20,.55); }
.zm-mate.dead { opacity: .45; }
.zm-use { position: absolute; left: var(--lane-x, 50%); bottom: var(--lane-b, calc(var(--sb) + 62px)); transform: translateX(-50%); min-height: 50px; min-width: 150px; width: max-content; max-width: 46vw; padding: 6px 16px; box-sizing: border-box; border: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font: 400 19px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-night); background: var(--c-sodium); white-space: nowrap;
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); box-shadow: 0 0 0 2px #fff inset; }
/* The second line wraps (three lines at most, on the narrowest phones) rather than cutting a reason or a perk's
   description short. */
.zm-use small { font: 10px/1.2 var(--f-plate); letter-spacing: var(--tr-plate); margin-top: 3px; overflow: hidden; max-width: 100%; white-space: normal; text-align: center; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.hud .zm-use { max-width: min(46vw, var(--lane-w, 46vw)); }
.zm-use.poor { color: var(--c-chalk); background: linear-gradient(180deg, rgba(60,60,60,.92), rgba(28,28,28,.9)); box-shadow: 0 0 0 2px rgba(255,255,255,.25) inset; }
.zm-use:active { filter: brightness(1.3); }
.zm-down, .zm-held, .zm-rev { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); width: 230px; padding: 8px 12px 10px; text-align: center;
  background: rgba(16,20,26,.82); clip-path: polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px); }
.zm-down b, .zm-held b, .zm-rev b { display: block; font: 400 20px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #ff8a7c; }
.zm-held b { color: var(--c-chalk); }
.zm-rev { top: 30%; } .zm-rev b { color: #8ff09c; font-size: 15px; }
.zm-down small, .zm-held small { display: block; font: 10px/1.2 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); margin-top: 4px; }
.zm-down i, .zm-rev i { display: block; height: 5px; margin-top: 6px; background: rgba(231,234,228,.15); position: relative; overflow: hidden; }
.zm-down i i, .zm-rev i i { position: absolute; inset: 0; margin: 0; height: auto; background: var(--c-red); transform-origin: left; transform: scaleX(var(--k, 0)); }
.zm-down .rv i { background: #59d36b; }
.zm-rev i i { background: #59d36b; }
.zm-pop { position: absolute; left: calc(var(--sl) + 236px); top: calc(var(--st) + 10px); font: 400 15px/1 var(--f-stencil); color: var(--c-sodium); letter-spacing: var(--tr-stencil);
  text-shadow: 0 1px 2px #000; pointer-events: none; animation: zmPop .8s ease-out forwards; }
.zm-pop.spend { color: #ff8a7c; }
@keyframes zmPop { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-22px); } }
.zm-ui [hidden] { display: none !important; }
.zm-xbig { position: absolute; left: 50%; top: calc(var(--st) + 58px); transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 6px 16px 7px;
  background: linear-gradient(180deg, rgba(20,48,28,.94), rgba(10,22,14,.9)); box-shadow: inset 0 0 0 2px #59d36b, 0 0 18px rgba(89,211,107,.35);
  clip-path: polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px); }
.zm-xbig > b { font: 400 40px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #8ff09c; font-variant-numeric: tabular-nums; text-shadow: 0 0 12px rgba(89,211,107,.5); }
.zm-xbig span { display: flex; flex-direction: column; gap: 3px; }
.zm-xbig span b { font: 400 16px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #fff; }
.zm-xbig span small { font: 11px/1.1 var(--f-plate); letter-spacing: var(--tr-plate); color: #c8f0cc; white-space: nowrap; }
.zm-xbig.on b:first-child { color: #fff; }
/* The held supply streak: over the move stick (the other thumb's side from Finish and the use button's lane). */
.zm-stk { position: absolute; left: calc(var(--sl) + 66px); bottom: calc(var(--sb) + 178px); height: 44px; min-width: 104px; padding: 0 12px; border: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: #fff; background: linear-gradient(180deg, rgba(255,194,61,.95), rgba(176,112,10,.92)); box-shadow: inset 0 0 0 2px rgba(255,255,255,.7);
  clip-path: polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px); touch-action: manipulation; }
.zm-stk b { font: 400 16px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #1a1408; }
.zm-stk small { font: 9px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: #2a1e08; margin-top: 3px; }
.zm-stk:active { filter: brightness(1.2); }
.hud.lefty .zm-stk { left: auto; right: calc(var(--sr) + 66px); }
.zm-exfil { box-shadow: var(--hud-edge), inset 0 -3px 0 #59d36b; } .zm-exfil b { color: #8ff09c; }
.zm-relic { box-shadow: var(--hud-edge), inset 0 -2px 0 #b070ff; } .zm-relic b { color: #d8b8ff; }
/* Plates: three segments over the health bar (as battle royale's). */
.zm-plates { display: flex; gap: 3px; height: 5px; margin-bottom: 2px; }
.zm-plates[hidden] { display: none !important; }
.zm-plates i { flex: 1; position: relative; background: rgba(16,20,26,.85); box-shadow: inset 0 0 0 1px rgba(231,234,228,.16); transform: skewX(-24deg); overflow: hidden; }
.zm-plates i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, #d7e6a8, #8aa04a); transform-origin: left center; transform: scaleX(var(--k, 0)); }
/* Upgrade bench tiers on the weapon panel: three pips, lit to the gun's tier (tier 3 in its round's colour). */
.zm-tier { display: inline-flex; gap: 2px; margin-left: 5px; vertical-align: middle; }
.zm-tier[hidden] { display: none !important; }
.zm-tier i { width: 6px; height: 6px; transform: rotate(45deg); background: rgba(231,234,228,.18); }
.zm-tier i.on { background: var(--k, #b070ff); box-shadow: 0 0 5px var(--k, #b070ff); }
/* The supply terminal's sheet. */
.zm-shop { position: absolute; inset: 0; z-index: var(--z-overlay); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(10,13,17,.66); pointer-events: auto; }
.zm-shop[hidden] { display: none !important; }
.zm-shop h3 { margin: 0; font: 400 24px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); text-align: center; }
.zm-shop h3 small { display: block; margin-top: 4px; font: 11px/1.2 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); }
.zm-shop-row { display: flex; gap: 7px; flex-wrap: wrap; justify-content: center; max-width: calc(100vw - var(--sl) - var(--sr) - 20px); }
.zm-item { width: 118px; min-height: 112px; padding: 9px; border: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; color: var(--c-chalk);
  background: linear-gradient(180deg, rgba(42,51,61,.96), rgba(16,20,26,.94)); box-shadow: var(--hud-edge), inset 0 3px 0 #4dffa0;
  clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px); }
.zm-item b { font: 400 16px/1.05 var(--f-stencil); letter-spacing: var(--tr-stencil); }
.zm-item small { font: 10px/1.25 var(--f-plate); letter-spacing: .02em; color: var(--c-haze); }
.zm-item em { font: 400 14px/1 var(--f-stencil); font-style: normal; color: var(--c-sodium); margin-top: auto; }
.zm-item.off { opacity: .45; }
.zm-item.off em { color: var(--c-haze); }
.zm-item:active { filter: brightness(1.3); }
.zm-shop .close { height: 36px; border: 0; padding: 0 18px; font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); background: rgba(42,51,61,.95); box-shadow: var(--hud-edge); }
@media (max-height: 400px) { .zm-item { width: 112px; min-height: 96px; padding: 7px; } .zm-item b { font-size: 14px; } .zm-shop { gap: 7px; } .zm-shop h3 { font-size: 20px; } }
`;

const fmt = n => Math.round(n).toLocaleString('en-US');

export class ZmHud {
  constructor(hud) {
    this.hud = hud;
    this.on = false;
    this.cmd = null;
    this.guns = null;          // () => [primary, secondary] of the local player's own guns (main.js sets it).
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = this.el = document.createElement('div');
    el.className = 'zm-ui';
    el.hidden = true;
    el.innerHTML = `
      <div class="zm-top">
        <div class="zm-chip zm-round"><b>1</b><small>Round</small></div>
        <div class="zm-chip zm-left"><b>0</b><small>Undead left</small></div>
        <div class="zm-chip zm-pts"><b>500</b><small>Points</small></div>
        <div class="zm-chip zm-dbl" hidden><b>30</b><small>Double Pay</small></div>
        <div class="zm-chip zm-exfil" hidden><b>60</b><small>Hold the pad</small></div>
        <div class="zm-chip zm-relic" hidden><b>0/3</b><small>Relics</small></div>
      </div>
      <div class="zm-xbig" hidden><b>60</b><span><b>EXFIL</b><small>Get to the pad</small><small class="xn">0 undead coming</small></span></div>
      <div class="zm-boss" hidden><b>Yardmaster</b><i><i></i></i></div>
      <div class="zm-crew"></div>
      <button class="zm-stk" data-tap="1" hidden><b>SENTRY</b><small>Tap to call it in</small></button>
      <button class="zm-use" data-tap="1" hidden><span class="t">BUY</span><small></small></button>
      <div class="zm-down" hidden><b>Down</b><small>Hold on: a teammate can get you up</small><i class="bl"><i></i></i><i class="rv"><i></i></i></div>
      <div class="zm-rev" hidden><b>Reviving</b><i><i></i></i></div>
      <div class="zm-held" hidden><b>Bled out</b><small>Back with the pistol next round</small></div>
      <div class="zm-shop" hidden data-tap="1"><h3>Supply terminal<small>Paid from your points. One of each a round.</small></h3><div class="zm-shop-row"></div><button class="close" data-tap="1">Close</button></div>`;
    hud.el.appendChild(el);
    const $ = s => el.querySelector(s);
    this.roundEl = $('.zm-round'); this.roundB = $('.zm-round b');
    this.leftB = $('.zm-left b'); this.ptsB = $('.zm-pts b');
    this.dblEl = $('.zm-dbl'); this.dblB = $('.zm-dbl b');
    this.bossEl = $('.zm-boss'); this.bossBar = $('.zm-boss i i');
    this.crewEl = $('.zm-crew');
    this.useEl = $('.zm-use'); this.useT = $('.zm-use .t'); this.useS = $('.zm-use small');
    this.downEl = $('.zm-down'); this.bleedBar = $('.zm-down .bl i'); this.revBar = $('.zm-down .rv i');
    this.revEl = $('.zm-rev'); this.revMine = $('.zm-rev i i');
    this.heldEl = $('.zm-held');
    this.xbig = $('.zm-xbig'); this.xbigB = $('.zm-xbig > b'); this.xbigS = $('.zm-xbig span small'); this.xbigN = $('.zm-xbig .xn');
    this.exfilEl = $('.zm-exfil'); this.exfilB = $('.zm-exfil b'); this.exfilS = $('.zm-exfil small');
    this.relicEl = $('.zm-relic'); this.relicB = $('.zm-relic b');
    this.stkEl = $('.zm-stk'); this.stkB = $('.zm-stk b');
    this.stkEl.addEventListener('click', e => { e.stopPropagation(); this.cmd?.('deploy'); });
    this.shopEl = $('.zm-shop'); this.shopRow = $('.zm-shop-row');
    this.shopRow.innerHTML = ZE.supplyOrder.map(k => `<button class="zm-item" data-tap="1" data-item="${k}"><b>${ZE.supply[k].name}</b><small>${ZE.supply[k].desc}</small><em></em></button>`).join('');
    this.shopRow.addEventListener('click', e => {
      const b = e.target.closest('.zm-item');
      if (!b) return;
      e.stopPropagation();
      if (b.classList.contains('off')) return;
      this.cmd?.('use', { item: b.dataset.item });
      this.#shop(false);
    });
    $('.zm-shop .close').addEventListener('click', e => { e.stopPropagation(); this.#shop(false); });
    this.shopEl.addEventListener('click', e => { if (e.target === this.shopEl) this.#shop(false); });
    this.hands = null;         // () => the local player's hands (ps): the gun tiers on its defs (main.js sets it).
    // The round plate and the boss bar go in the objective strip, which the HUD's layout pass keeps clear of the rest.
    this.topEl = hud.strip.mount($('.zm-top'), { order: 0 });
    hud.strip.mount(this.bossEl, { row: 1 });
    this.topEl.hidden = true;
    this.useEl.addEventListener('click', e => {
      e.stopPropagation();
      if (this.use?.kind === 'terminal') { this.#shop(true); return; }     // The terminal opens its sheet.
      if (this.use?.ok) this.cmd?.('use');
    });
    this.c = {};
  }

  onCommand(cb) { this.cmd = cb; }

  prepare(on, { map, roster, localId }) {
    this.on = on;
    this.el.hidden = !on;
    this.topEl.hidden = !on;
    if (!on) this.bossEl.hidden = true;
    this.hud.el.classList.toggle('zm-on', on);
    if (!on) return;
    this.map = map; this.roster = roster; this.localId = localId;
    this.c = {}; this.use = null; this.lastPts = null;
    this.crewEl.innerHTML = '';
    this.bought = {}; this.hinted = false;
    this.#shop(false);
  }

  #shop(on) {
    this.shopOpen = !!on;
    this.shopEl.hidden = !on;
    if (on) this.c.shop = null;
  }

  update(view, me, dt) {
    if (!this.on || !me) return;
    const z = objOf(view);
    if (!z?.zm) return;
    const c = this.c;
    const boss = z.round > 0 && z.round % 10 === 0;
    const round = String(Math.max(1, z.round || 1));
    if (c.round !== round) { c.round = round; this.roundB.textContent = round; }
    this.roundEl.classList.toggle('boss', boss);
    const left = z.state === 'round' ? fmt(z.left) : z.state === 'break' || z.state === 'pre' ? String(Math.max(0, Math.ceil(z.timer))) : '0';
    if (c.left !== left) { c.left = left; this.leftB.textContent = left; this.leftB.nextElementSibling.textContent = z.state === 'round' ? 'Undead left' : 'Next round'; }
    const pts = me.zpts ?? 0;
    if (c.pts !== pts) {
      if (c.pts !== undefined && pts !== c.pts) this.#pop(pts - c.pts);
      c.pts = pts; this.ptsB.textContent = fmt(pts);
    }
    const dbl = z.doubleT > 0 ? String(Math.ceil(z.doubleT)) : '';
    if (c.dbl !== dbl) { c.dbl = dbl; this.dblEl.hidden = !dbl; this.dblB.textContent = dbl; }
    this.bossEl.hidden = !z.boss;
    if (z.boss) this.bossBar.style.setProperty('--k', Math.max(0, z.boss.hp).toFixed(3));
    const bossName = z.boss?.warden ? questBossName(z) : ZM_KIND_NAMES.boss;
    if (c.bossName !== bossName) { c.bossName = bossName; this.bossEl.querySelector('b').textContent = bossName; }
    this.#econ(z, me, view);
    this.#crew(view, me);
    // Downed, reviving, out until the next round.
    const down = !!me.downed && me.alive;
    this.downEl.hidden = !down;
    if (down) {
      this.bleedBar.style.setProperty('--k', Math.max(0, Math.min(1, (me.hp ?? 0) / 100)).toFixed(3));
      this.revBar.style.setProperty('--k', (me.reviveK ?? 0).toFixed(3));
    }
    let rev = null;
    if (me.alive && !me.downed) {
      for (const q of view.players) {
        if (q === me || !q.alive || !q.downed || q.team !== me.team || !(q.reviveK > 0.01)) continue;
        if (Math.hypot(q.x - me.x, q.z - me.z) < ZM.reviveReach + 0.3) { rev = q; break; }
      }
    }
    this.revEl.hidden = !rev;
    if (rev) this.revMine.style.setProperty('--k', rev.reviveK.toFixed(3));
    this.heldEl.hidden = me.alive || view.phase !== 'live' || z.state === 'over';
    // The use button: whatever is in reach.
    const idx = view.players.indexOf(me);
    const guns = this.guns?.() ?? [me.weapon];
    const ps = this.hands?.(), held = ps?.weapon ?? me.weapon, tier = ps?.defs?.[ps.slot]?.zt ?? 0;
    const u = me.alive && !me.downed ? zmUsable(z.layout, me.x, me.z, { open: z.open, box: { spot: z.box?.spot ?? -1, state: z.box?.state ?? 0, gun: z.box?.gun, owner: z.box?.owner ?? -1 }, pts, perks: me.zperks ?? [], guns, me: idx, power: z.power ?? 1,
      limit: me.zlimit ?? ZM.perkLimit, held, tier, bench: z.bench, traps: z.traps?.map(t => t.state), plates: me.zplates ?? 0, exfil: z.exfil?.state ?? 0, round: z.round, quest: z.quest,
      kitRoom: me.tacticalLeft != null && me.lethalLeft != null && kitRoom({ perks: me.perks ?? this.hands?.()?.perks ?? [], tactical: me.tactical, lethal: me.lethal, tacticalLeft: me.tacticalLeft, lethalLeft: me.lethalLeft }) }) : null;
    this.use = u;
    if (this.shopOpen && u?.kind !== 'terminal') this.#shop(false);     // Walked away from the terminal.
    // A radio being tuned shows how far it has got.
    this.tunePct = u?.kind === 'relic' && z.quest?.tuneI === u.i ? Math.min(99, Math.floor((z.quest.tuneT ?? 0) / ZE.quest.tune * 100)) : -1;
    const key = u ? `${u.kind}:${u.i}:${u.ok}:${u.gun ?? ''}:${u.off ? 1 : 0}:${u.why ?? ''}:${u.cost}:${u.tier ?? ''}:${this.tunePct}` : '';
    if (c.use !== key) {
      c.use = key;
      this.useEl.hidden = !u;
      if (u) {
        const [title, sub] = this.#prompt(u, pts);
        this.useT.textContent = title;
        this.useS.textContent = sub;
        this.useEl.classList.toggle('poor', !u.ok);
      }
    }
    const stk = me.alive && !me.downed ? me.zstk ?? null : null;
    if (c.stk !== stk) { c.stk = stk; this.stkEl.hidden = !stk; if (stk) this.stkB.textContent = ZE.supply[stk].name.toUpperCase(); this.c.shop = null; }
    if (this.shopOpen) this.#shopItems(z, pts, me.zstk ?? null);
  }

  // The use button's two lines for what is in reach.
  #prompt(u, pts) {
    const gun = u.gun ? zmGunName(u.gun, WEAPONS) : '';
    const price = u.ok || u.off ? fmt(u.cost) : `${fmt(u.cost)} · need ${fmt(u.cost - pts)} more`;
    const why = (lead = '') => (u.why ? `${lead ? `${lead} · ` : ''}${u.why}` : lead);
    switch (u.kind) {
      case 'door': return ['OPEN GATE', price];
      case 'wall': return [`BUY ${gun}`, price];
      case 'ammo': return [`AMMO ${gun}`, price];
      case 'box': return ['MYSTERY CRATE', price];
      case 'take': return [`TAKE ${gun}`, zmWonderOf(u.gun) ? `Wonder weapon: ${zmWonderOf(u.gun).desc.toLowerCase()}` : 'Free: it is yours'];
      case 'power': return u.off ? ['POWER IS ON', why()] : [u.label.toUpperCase(), 'Free: lights the perk machines'];
      case 'perk': return [u.label.toUpperCase(), u.why ? why(fmt(u.cost)) : u.off ? `${fmt(u.cost)} · No power: find the switch` : u.ok ? `${fmt(u.cost)} · ${ZM_PERKS[u.perk].desc}` : price];
      case 'slot': return ['PERK SLOT', u.off ? `${fmt(u.cost)} · No power: find the switch` : u.ok ? `${fmt(u.cost)} · Hold up to ${ZM.perkMax} perks` : price];
      case 'terminal': return ['SUPPLY TERMINAL', 'Sentries, strikes, drones, lures, vests'];
      case 'kit': return ['KIT REFILL', u.ok ? `${fmt(u.cost)} · grenades and tacticals to full` : price];
      case 'armour': return ['ARMOUR PLATE', u.off ? why() : u.ok ? `${fmt(u.cost)} · up to ${ZE.plate.max} plates` : price];
      case 'bench': {
        if (u.off) return [u.gun ? `UPGRADE ${gun}` : 'UPGRADE BENCH', why()];
        const fx = u.tier >= 3 ? ` · ${ZM_FX[zmFxOf(u.gun)].name}` : '';
        return [`UPGRADE ${gun}`, u.ok ? `${fmt(u.cost)} · tier ${u.tier}${fx}` : price];
      }
      case 'benchwait': return [`UPGRADING ${gun}`, 'Back in a moment'];
      case 'benchtake': return [`TAKE ${gun}`, `Tier ${u.tier}: it is yours`];
      case 'trap': return [u.label.toUpperCase(), u.off ? why() : u.ok ? `${fmt(u.cost)} · armed for ${ZE.trap.on} s` : price];
      case 'exfil': return ['CALL EXFIL', u.off ? why(fmt(u.cost)) : u.ok ? `${fmt(u.cost)} · hold the pad ${ZE.exfil.hold} s` : price];
      case 'oracle': return u.off ? ['THE ORACLE', why()] : ['ASK THE ORACLE', 'Free: it knows the lanterns\' order'];
      case 'relic':
        if (u.lantern !== undefined) {
          const col = ZM_LANTERNS[u.lantern]?.name.toUpperCase() ?? '';
          return u.off ? ['COLD LANTERN', why()] : [`LIGHT THE ${col} LANTERN`, 'Free: in the Oracle\'s order, or they all go out'];
        }
        if (u.label === 'Tuning') return [`TUNING ${Math.max(0, this.tunePct)}%`, why()];
        if (u.label === 'Dead radio' || u.label === 'Tune the radio') return [u.label.toUpperCase(), u.off ? why() : `Free: stay by it ${ZE.quest.tune} s`];
        return ['PICK IT UP', 'An old lantern, still warm'];
      case 'altar':
        if (u.label === 'Ring the bell' || u.label === 'High striker') return [u.off ? 'HIGH STRIKER' : 'RING THE BELL', u.off ? why() : 'Something is waiting in the wings'];
        if (u.label === 'Transmit' || u.label === 'Relay console') return [u.off ? 'RELAY CONSOLE' : 'TRANSMIT', u.off ? why() : 'Something out there will hear'];
        return [u.off ? 'THE ALTAR' : 'SET THE RELICS', u.off ? why() : 'Something will answer'];
      default: return [u.label.toUpperCase(), price];
    }
  }

  // The terminal's sheet: each item's price this round, greyed when bought already or too dear.
  #shopItems(z, pts, stk = null) {
    const key = `${z.round}:${pts}:${stk}:${JSON.stringify(this.bought)}`;
    if (this.c.shop === key) return;
    this.c.shop = key;
    for (const b of this.shopRow.children) {
      const k = b.dataset.item, cost = supplyCost(k, z.round), had = this.bought[k] === z.round;
      const full = !!stk && k !== 'vest';     // One held streak at a time: call it in first.
      b.querySelector('em').textContent = had ? 'Bought this round' : full ? 'Holding one' : fmt(cost);
      b.classList.toggle('off', had || full || cost > pts);
    }
  }

  // The plate bar, the weapon panel's tier pips, the exfil clock and the relic count.
  #econ(z, me, view) {
    const c = this.c;
    if (!this.platesEl) {
      const vit = this.hud.el.querySelector('.vitals');
      this.platesEl = document.createElement('div');
      this.platesEl.className = 'zm-plates';
      this.platesEl.innerHTML = '<i></i><i></i><i></i>';
      (vit?.querySelector('.hp-bars') ?? vit)?.prepend(this.platesEl);
      const sub = this.hud.el.querySelector('.arms-sub');
      this.tierEl = document.createElement('span');
      this.tierEl.className = 'zm-tier';
      this.tierEl.innerHTML = '<i></i><i></i><i></i>';
      sub?.querySelector('.arms-name')?.after(this.tierEl);
    }
    const plates = me.alive ? me.zplates ?? 0 : 0;
    if (c.plates !== plates) {
      c.plates = plates;
      this.platesEl.hidden = !(plates > 0);
      [...this.platesEl.children].forEach((n, i) => n.style.setProperty('--k', Math.max(0, Math.min(1, (plates - i * ZE.plate.hp) / ZE.plate.hp)).toFixed(2)));
    }
    const ps = this.hands?.(), tier = ps?.defs?.[ps.slot]?.zt ?? 0, gun = ps?.weapon ?? me.weapon;
    const tk = `${tier}:${gun}`;
    if (c.tier !== tk) {
      c.tier = tk;
      // A wonder weapon (tier 5 and up): no pips (its own name says it all, and needs the room).
      const W = tier >= 5 ? zmWonderOf(gun) : null;
      this.tierEl.hidden = !tier || !!W;
      const col = W ? W.css : tier >= 3 ? ZM_FX[zmFxOf(gun)].css : tier === 2 ? '#ffd659' : '#8fe08a';
      [...this.tierEl.children].forEach((n, i) => { n.classList.toggle('on', i < tier); n.style.setProperty('--k', col); });
      this.tierEl.title = W ? `${W.name}: ${W.desc}` : tier ? `Tier ${tier}${tier >= 3 ? `: ${ZM_FX[zmFxOf(gun)].name}` : ''}` : '';
    }
    // The exfil: a big clock under the strip, with the pad and the undead still on their way (the round plate's own
    // count stands still while the exfil holds the round). The small chip stays out of the strip's way.
    const X = z.exfil;
    const ex = X?.state === 1 ? (t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`)(Math.max(0, Math.ceil(X.timer))) : '';
    if (c.exfil !== ex) {
      c.exfil = ex;
      this.exfilEl.hidden = true;
      this.xbig.hidden = !ex;
      this.xbigB.textContent = ex;
    }
    if (ex) {
      let n = 0;
      for (const p of view.players) if (p.zk && p.alive) n++;
      const nk = `${n}`;
      if (c.xn !== nk) { c.xn = nk; this.xbigN.textContent = `${n} undead coming`; }
      const on = z.layout?.exfil ? Math.hypot(me.x - z.layout.exfil.x, me.z - z.layout.exfil.z) < z.layout.exfil.r + 0.8 : false;
      if (c.onPad !== on) { c.onPad = on; this.xbigS.textContent = on ? 'On the pad: hold it' : 'Get to the pad'; this.xbig.classList.toggle('on', on); }
    } else c.onPad = undefined;
    const q = z.quest, n = q && !q.state ? (z.layout?.relics ?? []).filter(r => q.got & (1 << r.i)).length : 0;
    const kind = z.layout?.questKind;
    // Wrenfield Fair: from the Oracle on, the count, the burn's seconds and the order as coloured dots (lit ones bright).
    const lan = kind === 'lantern' && q && !q.state && q.read;
    const rel = lan ? `${n}/${z.layout.relics.length}${q.burnT > 0 ? ` ${Math.ceil(q.burnT)}s` : ''}|${q.got}|${(q.order ?? []).join('')}` : n ? `${n}/${z.layout.relics.length}` : '';
    if (c.relic !== rel) {
      c.relic = rel; this.relicEl.hidden = !rel; this.relicB.textContent = rel.split('|')[0];
      const label = this.relicB.nextElementSibling;
      if (lan) label.innerHTML = (q.order ?? []).map(i => `<i style="color:${ZM_LANTERNS[i].css};opacity:${q.got & (1 << i) ? 1 : 0.35};font-style:normal">\u25cf</i>`).join('');
      else label.textContent = kind === 'radio' ? 'Radios' : 'Relics';
      this.relicEl.title = lan ? `Lanterns: ${lanternOrderText(q.order)}` : '';
    }
    // A hint at the quest: from round 3, once, while nobody has found a relic.
    if (!this.hinted && z.round >= 3 && z.state === 'round' && q && !q.got && z.layout?.relics?.length) {
      this.hinted = true;
      this.hud.notify(z.layout.questKind === 'radio' ? RADIO_HINT : z.layout.questKind === 'lantern' ? LANTERN_HINT : QUEST_HINT);
    }
  }

  #crew(view, me) {
    const z = objOf(view);
    const crew = view.players.filter(p => p.team === me.team && !p.ai);
    const key = crew.map(p => `${p.id}:${p.zpts}:${(p.zperks ?? []).join('')}:${p.downed ? 1 : 0}:${p.alive ? 1 : 0}:${p.zbreath ?? -1}`).join('|');
    if (this.c.crew === key) return;
    this.c.crew = key;
    this.crewEl.innerHTML = crew.map(p => `<div class="zm-mate${p.id === me.id ? ' me' : ''}${p.alive && p.downed ? ' down' : ''}${!p.alive ? ' dead' : ''}">
      <b>${escape(p.name)}</b><em>${fmt(p.zpts ?? 0)}</em>
      <span>${(p.zperks ?? []).map(k => `<i style="--k:${ZM_PERKS[k]?.css ?? '#fff'}${k === 'breath' && p.zbreath === 0 ? ';opacity:.3' : ''}" title="${escape(ZM_PERKS[k]?.name ?? k)}"></i>`).join('')}</span></div>`).join('');
    void z;
  }

  #pop(n) {
    const el = document.createElement('div');
    el.className = `zm-pop${n < 0 ? ' spend' : ''}`;
    el.textContent = n > 0 ? `+${fmt(n)}` : `-${fmt(-n)}`;
    this.el.appendChild(el);
    setTimeout(() => el.remove(), 850);
  }

  // A zombie's death is the horde's business: no kill-feed row (the boss's aside). True means the HUD skips the row.
  quietKill(e, view) {
    const t = view?.players?.find(p => p.id === e.target);
    if (!t?.ai) return false;
    return t.zk !== 4 && t.zk !== 5 && t.zk !== 11 && t.zk !== 12;     // The Yardmaster's (4), the Gravewarden's (5), the Listener's (11) and the Barker's (12) deaths make the feed.
  }

  onEvent(e, view) {
    if (!this.on) return;
    const me = view?.players?.find(p => p.id === view.localId);
    const name = id => view?.players?.find(p => p.id === id)?.name ?? '';
    switch (e.t) {
      case 'zround': {
        const sp = ZM_ROUND_NAMES[e.special];     // A special round: its own banner (js/sim/zm-kinds.js).
        this.hud.banner(sp ? `Round ${e.round}: ${sp[0]}` : `Round ${e.round}`, sp ? sp[1] : e.boss ? `The ${ZM_KIND_NAMES.boss} walks tonight` : 'Here they come', sp ? 2600 : 1800, 'enemy');
        const z = objOf(view);
        if (e.round === 1 && z?.layout?.power && !z.power) this.hud.notify(`Power out: the switch is in the ${z.layout.bands[z.layout.power.band]?.name ?? 'yard'}`);
        break;
      }
      case 'zbreak': this.hud.banner(`Round ${e.round} survived`, `Next round in ${ZM.between} s`, 1600); break;
      case 'zpower': this.hud.banner(ZM_POWERUP_NAMES[e.kind] ?? 'Power-up', e.kind === 'ammo' ? 'Every gun topped up' : e.kind === 'double' ? `Double points for ${ZM.drop.double} s` : 'The horde drops where it stands', 1500); break;
      case 'zdoor': this.hud.notify(`${name(e.by)} opened a gate`); break;
      case 'zlights': this.hud.banner(`${name(e.by) || 'Someone'} turned on the power`, 'The perk machines are live', 2200); break;
      case 'zbox':
        if (e.state === 2 && e.by === me?.id && zmWonderOf(e.gun)) this.hud.banner(zmWonderOf(e.gun).name, 'A wonder weapon: take it', 1800);
        else if (e.state === 2 && e.by === me?.id) this.hud.notify(`The crate offers a ${WEAPONS[e.gun]?.name ?? e.gun}: take it`);
        if (e.state === 3) this.hud.notify('The crate is moving on');
        break;
      case 'zperk': if (e.id === me?.id && e.perk) this.hud.notify(`${ZM_PERKS[e.perk]?.name}: ${ZM_PERKS[e.perk]?.desc}`); break;
      case 'down': if (e.target !== me?.id && view?.players?.find(p => p.id === e.target)?.team === me?.team) this.hud.notify(`${name(e.target)} is down: revive them`); break;
      case 'revive': if (e.id === me?.id && e.by !== me?.id) this.hud.notify(`${name(e.by)} got you up`); break;
      case 'zbreath': if (e.id === me?.id) this.hud.notify('Last Breath: getting yourself up'); break;
      case 'zbench':
        if (e.state === 1 && e.by === me?.id) this.hud.notify(`The ${WEAPONS[e.gun]?.name ?? e.gun} is on the bench: tier ${e.tier}`);
        if (e.state === 2 && e.by === me?.id) this.hud.notify(`Your ${WEAPONS[e.gun]?.name ?? e.gun} is ready at the bench`);
        if (e.state === 0 && e.by === me?.id && e.tier >= 3) this.hud.banner(ZM_FX[zmFxOf(e.gun)].name, `${WEAPONS[e.gun]?.name ?? e.gun}: ${ZM_FX[zmFxOf(e.gun)].desc.toLowerCase()}`, 1600);
        break;
      case 'zstk':     // A supply streak bought into the held slot (js/sim/zm-econ.js): called in from its button.
        if (e.by === me?.id) { this.bought[e.item] = objOf(view)?.round ?? 0; this.hud.notify(`${ZE.supply[e.item]?.name ?? e.item} held: tap it to call it in`); }
        break;
      case 'zsupply':
        if (e.by === me?.id && e.item === 'vest') this.bought[e.item] = objOf(view)?.round ?? 0;
        this.hud.notify(`${e.by === me?.id ? 'You' : name(e.by)} called ${ZE.supply[e.item]?.name ?? e.item}`);
        break;
      case 'ztrap': {
        const t = objOf(view)?.layout?.traps?.[e.i];
        if (e.state === 1 && t) this.hud.notify(`${e.by === me?.id ? 'You' : name(e.by)} armed the ${ZM_TRAP_NAMES[t.kind]}`);
        break;
      }
      case 'zexfil':
        if (e.state === 1) this.hud.banner('Exfil called', `Hold the pad for ${ZE.exfil.hold} s: everything is coming`, 2000, 'enemy');
        else if (e.fail) this.hud.banner('Nobody on the pad', 'The exfil left without you', 1800);
        break;
      case 'zescape': this.hud.banner(e.ids?.includes(me?.id) ? 'Escaped' : 'They got out', `Round ${e.round}`, 2400); break;
      case 'ztune':
        if (e.state === 1) this.hud.notify(`${e.by === me?.id ? 'You are' : `${name(e.by)} is`} tuning a radio: stay by it`);
        else this.hud.notify('The radio lost the signal');
        break;
      case 'zoracle': this.hud.banner('The Oracle speaks', lanternOrderText(e.order), 2600); break;
      case 'zlantern':
        if (e.state === 0) this.hud.banner('Wrong lantern', 'Every lantern went out', 1800, 'enemy');
        else this.hud.notify('The lanterns burned out: light them again, faster');
        break;
      case 'zrelic': {
        const z = objOf(view);
        if (e.lantern) {
          const ring = z?.layout?.altar ? z.layout.bands[z.layout.altar.band]?.name : null;
          this.hud.notify(e.n >= e.of ? `All ${e.of} lanterns lit: ring the bell${ring ? ` in ${ring}` : ''}` : `${e.by === me?.id ? 'You' : name(e.by)} lit the ${ZM_LANTERNS[e.i]?.name ?? ''} lantern: ${e.n} of ${e.of}${e.n === 1 ? `, ${ZE.quest.burn} s to light the rest` : ''}`);
          break;
        }
        if (e.radio || z?.layout?.questKind === 'radio') {
          const con = z?.layout?.altar ? z.layout.bands[z.layout.altar.band]?.name : null;
          this.hud.notify(e.n >= e.of ? `Radio ${e.n} of ${e.of} tuned: transmit from the console${con ? ` in the ${con}` : ''}` : `${e.by === me?.id ? 'You' : name(e.by)} tuned a radio: ${e.n} of ${e.of}`);
          break;
        }
        const altar = z?.layout?.altar ? z.layout.bands[z.layout.altar.band]?.name : null;
        this.hud.notify(e.n >= e.of ? `Relic ${e.n} of ${e.of}: set them on the altar${altar ? ` in the ${altar}` : ''}` : `${e.by === me?.id ? 'You' : name(e.by)} found a relic: ${e.n} of ${e.of}`);
        break;
      }
      case 'zwarden':
        if (e.state === 1) this.hud.banner(...questBossByKind(e.k).rise, 2000, 'enemy');
        else if (e.state === 2) this.hud.banner(`The ${questBossByKind(e.k).name} falls`, `+${fmt(ZE.quest.pts)} each, and a calling card`, 2400);
        break;
      default:
    }
  }

  endBanner(endEl, winner, myTeam, view) {
    const z = objOf(view);
    if (z?.escaped?.length) {
      const me = view?.players?.find(p => p.id === view.localId);
      endEl.dataset.result = z.escaped.includes(me?.id) ? 'win' : 'loss';
      endEl.querySelector('b').textContent = z.escaped.includes(me?.id) ? 'Escaped' : 'Left behind';
      endEl.querySelector('small').textContent = `Out on round ${z.round}`;
      return;
    }
    endEl.dataset.result = 'loss';
    endEl.querySelector('b').textContent = 'Overrun';
    endEl.querySelector('small').textContent = `Survived ${Math.max(0, (z?.round ?? 1) - 1)} round${(z?.round ?? 1) - 1 === 1 ? '' : 's'}`;
  }
}

function escape(s) { return String(s ?? '').replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`); }
export const zmModeName = id => MODES[id]?.name ?? 'Graveyard Shift';
export { ZM_PERK_IDS };
