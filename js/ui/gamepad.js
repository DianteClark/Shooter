// Game controllers through the Gamepad API (docs/CONTROLLER.md, roadmap item 29): PlayStation, Xbox and MFi pads on
// iPhone Safari and the Home Screen app, and on Android Chrome. Everything here reads the "standard" button layout.
//
// One poll per animation frame does one of three things:
//  - in a match with nothing open over it: twin-stick play. The pad's Input is written over the touch Input inside
//    Controls.read() (Controls.pad = this, see merge), so a controller feeds exactly the path the thumbs feed;
//  - in a menu, or over an in-match panel (pause, quick chat, death screen, BR map...): a focus ring that the d-pad and
//    left stick move between the tappable elements of the topmost layer; A/Cross presses, B/Circle goes back, L1/R1
//    (LB/RB) switch tabs. Pressing is el.click(), the same call tap.js makes for a finger, so touch is untouched;
//  - while the remap screen waits for a button: hands that button to it and nothing else.
// The pad counts as "in use" from its first press or stick push until the next touch on the glass. In use, <body> has
// .pad-on: the on-screen sticks and buttons hide and a few prompts show the pad's glyphs.
import { TAPPABLE } from './tap.js';
import { Options } from './options.js';

const STD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

// The in-match actions, in the order the remap screen lists them. def is the standard-mapping button; -1 is unbound.
export const PAD_ACTIONS = [
  { id: 'fire', name: 'Fire', def: STD.RT },
  { id: 'aim', name: 'Aim', def: STD.LT },
  { id: 'sprint', name: 'Sprint', def: STD.L3 },
  { id: 'slide', name: 'Slide', def: STD.B },
  { id: 'reload', name: 'Reload', def: STD.X },
  { id: 'swap', name: 'Swap weapon', def: STD.Y },
  { id: 'tactical', name: 'Tactical', def: STD.LB },
  { id: 'lethal', name: 'Lethal', def: STD.RB },
  { id: 'melee', name: 'Melee', def: STD.R3 },
  { id: 'interact', name: 'Interact, pick up, buy', def: STD.A },
  { id: 'streak', name: 'Streak (next ready)', def: STD.LEFT },
  { id: 'streak1', name: 'Streak 1', def: -1 },
  { id: 'streak2', name: 'Streak 2', def: -1 },
  { id: 'streak3', name: 'Streak 3', def: -1 },
  { id: 'ping', name: 'Ping', def: STD.UP },
  { id: 'chat', name: 'Quick chat', def: STD.DOWN },
  { id: 'talk', name: 'Push to talk', def: STD.RIGHT },
  { id: 'board', name: 'Scoreboard (hold)', def: STD.SELECT },
  { id: 'pause', name: 'Pause', def: STD.START },
];
const ACTION_IDS = new Set(PAD_ACTIONS.map(a => a.id));

// Button names per family. PlayStation uses its shapes; Xbox and MFi (Apple's layout copies Xbox) use letters.
const NAMES = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right', 'Home'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'PS'],
};
const DPAD_ARROWS = { 12: '▲', 13: '▼', 14: '◀', 15: '▶' };

export function padFamily(id = '') {
  return /054c|playstation|dualsense|dualshock|wireless controller/i.test(id) ? 'ps' : 'xbox';
}

// Short label for a button: "RT", "R2", "✕", "D-pad ▲"; '' when unbound.
export function buttonName(i, family = Pad.family) {
  if (i < 0 || i === undefined) return '';
  if (DPAD_ARROWS[i]) return `D-pad ${DPAD_ARROWS[i]}`;
  return NAMES[family]?.[i] ?? `Button ${i}`;
}

// The button an action is bound to now (Options padMap over the defaults).
export function bindingOf(id) {
  const m = Options.get('padMap') ?? {};
  if (Object.hasOwn(m, id)) return m[id];
  return PAD_ACTIONS.find(a => a.id === id)?.def ?? -1;
}

// Binds a button to an action. The action that held that button before takes this action's old one (a swap), so no
// two actions ever share a button. Only differences from the defaults are saved.
export function bindAction(id, button) {
  if (!ACTION_IDS.has(id)) return;
  const old = bindingOf(id);
  const next = {};
  for (const a of PAD_ACTIONS) next[a.id] = bindingOf(a.id);
  if (button >= 0) for (const a of PAD_ACTIONS) if (a.id !== id && next[a.id] === button) next[a.id] = old;
  next[id] = button;
  const diff = {};
  for (const a of PAD_ACTIONS) if (next[a.id] !== a.def) diff[a.id] = next[a.id];
  Options.set('padMap', diff);
}

export function resetBindings() { Options.set('padMap', {}); }

const THROW_MIN_M = 2.5, THROW_HELD_M = 9;       // As Controls: shortest aimed toss, range of a held, unaimed one.
const INSTANT = new Set(['stim']);
const REPEAT_FIRST_MS = 380, REPEAT_MS = 130;     // Menu focus: hold a direction to keep moving.
const AXIS_NAV = 0.55;
const TRIGGER_ON = 0.35;

// Shown over in-match play: the first visible one takes the focus ring instead of the sticks.
const MATCH_PANELS = ['.qc-wheel', '.br-map', '.ex-map', '.ex-offers', '.armory', '.br-out', '.hud .death.show.picking .picker', '.hud .death.show'];
// The in-match buttons Interact presses, first visible wins: leave the transport, take loot, buy, call exfil, revive.
const INTERACT = ['.br-jump-main', '.br-take', '.zm-use', '.ex-call', '.ex-phone', '.br-self', '.hud .death.show .death-go'];
const BACKISH = '.back, .pk-close, .close, .br-map-close, .ex-map-close, .arm-close, [data-sound="back"], [data-act$="Back"], [data-act$="back"], [data-act$="Close"], [data-act$="close"], [data-act*="Cancel"]';

const shown = el => !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden';
const usable = el => shown(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
// Identifies an element across a repaint (lobby, vote and tabs rebuild their markup).
function keyOf(el) {
  let key = el.tagName + '|' + el.className.toString().split(' ')[0];
  for (const name of el.getAttributeNames()) if (name.startsWith('data-') && name !== 'data-in') key += `|${name}=${el.getAttribute(name)}`;
  return key;
}

const CSS = `
body.pad-on .controls .stick, body.pad-on .controls .tbtn, body.pad-on .controls .rest, body.pad-on .controls .aim-hint, body.pad-on .controls .throw-rig { opacity: 0 !important; pointer-events: none !important; }
body.pad-on .pad-focus { outline: 3px solid var(--c-sodium, #ffc23d) !important; outline-offset: 2px; box-shadow: 0 0 0 6px rgba(255,194,61,.25), 0 0 18px rgba(255,194,61,.45) !important; position: relative; z-index: 3; }
body:not(.pad-on) .pad-glyph { display: none !important; }
.pad-glyph { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: rgba(16,20,26,.88); color: #fff; font: 700 11px/1 system-ui, sans-serif; box-shadow: 0 0 0 1.5px rgba(255,255,255,.55); pointer-events: none; white-space: nowrap; }
body.pad-on .br-take, body.pad-on .zm-use, body.pad-on .ex-call, body.pad-on .br-jump-main, body.pad-on .death-go, body.pad-on .br-self { position: relative; }
body.pad-on .br-take::after, body.pad-on .zm-use::after, body.pad-on .ex-call::after, body.pad-on .br-jump-main::after, body.pad-on .death-go::after, body.pad-on .br-self::after {
  content: var(--pad-interact, "A"); position: absolute; right: -6px; top: -8px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: rgba(16,20,26,.92); color: #fff;
  font: 700 11px/18px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 1.5px rgba(255,255,255,.6); pointer-events: none; }
body.pad-on .st-tile.held::after { content: var(--pad-streak, ""); position: absolute; left: 50%; bottom: -10px; transform: translateX(-50%); padding: 0 4px; height: 16px; border-radius: 8px;
  background: rgba(16,20,26,.92); color: #fff; font: 700 10px/16px system-ui, sans-serif; white-space: nowrap; box-shadow: 0 0 0 1.5px rgba(255,255,255,.55); pointer-events: none; }
`;

export const Pad = {
  family: 'xbox',
  connected: false,
  name: '',
  input: null,       // The GamepadInput, once main.js has made it
};

export class GamepadInput {
  // deps: { controls, hud, menu, quickChat, voice: () => Voice|null, inMatch: () => bool, toast(text) }
  constructor(deps) {
    Object.assign(this, deps);
    this.supported = typeof navigator.getGamepads === 'function';
    this.active = false;           // In use (see the header); cleared by a touch.
    this.prev = new Array(20).fill(false);
    this.now = new Array(20).fill(false);
    this.axes = [0, 0, 0, 0];
    this.latch = { slide: false, swap: false, reload: false, tactical: false, lethal: false, streak: -1 };
    this.throwHeld = null;         // { slot, at } while LB/RB is held for an aimed throw
    this.throwOut = { slot: '', aim: 0, dist: 0 };
    this.released = null;          // The aimed throw released since the last merge
    this.aim = null;               // Smoothed right-stick aim, radians
    this.sprint = false;
    this.paused = false;           // Pause opened the scoreboard as a menu
    this.peek = false;             // Scoreboard held open by its button
    this.talking = false;
    this.focusEl = null;
    this.focusKey = '';
    this.scopeEl = null;
    this.navDir = null;
    this.navAt = 0;
    this.capture = null;           // (button) => void: the remap screen waiting for a press
    this.glyphKey = '';
    this.lastT = performance.now();

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    if (this.controls) this.controls.pad = this;
    Pad.input = this;
    window.addEventListener('touchstart', () => this.#setActive(false), { passive: true, capture: true });
    window.addEventListener('gamepadconnected', e => this.#connected(e.gamepad, true));
    window.addEventListener('gamepaddisconnected', e => this.#connected(e.gamepad, false));
    window.addEventListener('blur', () => this.#releaseAll());
    if (this.supported) this.tick = this.tick.bind(this), requestAnimationFrame(this.tick);
  }

  #connected(gp, on) {
    const fam = padFamily(gp?.id);
    const label = fam === 'ps' ? 'PlayStation controller' : /xbox|045e/i.test(gp?.id ?? '') ? 'Xbox controller' : 'Controller';
    if (on) {
      Pad.family = fam;
      Pad.connected = true;
      Pad.name = label;
      this.#glyphs(true);
      this.toast?.(`${label} connected`);
    } else {
      Pad.connected = this.#pads().length > 0;
      this.toast?.(`${label} disconnected`);
      if (!Pad.connected) { this.#releaseAll(); this.#setActive(false); }
    }
    this.onChange?.();
  }

  #pads() {
    let list;
    try { list = navigator.getGamepads(); } catch { return []; }
    const out = [];
    for (const gp of list ?? []) if (gp && gp.connected !== false) out.push(gp);
    return out;
  }

  // The pad in hand: the one that changed most recently.
  #pad() {
    let best = null;
    for (const gp of this.#pads()) if (!best || (gp.timestamp ?? 0) > (best.timestamp ?? 0)) best = gp;
    return best;
  }

  #setActive(on) {
    if (this.active === on) return;
    this.active = on;
    document.body.classList.toggle('pad-on', on);
    if (!on) {
      this.#ring(null);
      this.#releaseAll();
    } else {
      this.#glyphs(true);
    }
    this.controls?.remeasure?.();
  }

  // Everything held lets go: a pad that vanished or a page that lost focus must not keep firing or talking.
  #releaseAll() {
    this.now.fill(false);
    this.prev.fill(false);
    this.axes = [0, 0, 0, 0];
    this.throwHeld = null;
    this.sprint = false;
    if (this.talking) { this.talking = false; this.voice?.()?.talk(false); }
    if (this.peek && this.hud?.boardOpen) this.hud.toggleBoard();
    this.peek = false;
  }

  down(i) { return i >= 0 && this.now[i]; }
  pressed(i) { return i >= 0 && this.now[i] && !this.prev[i]; }
  released_(i) { return i >= 0 && !this.now[i] && this.prev[i]; }
  #act(id) { return bindingOf(id); }

  tick(t) {
    requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    if (document.hidden) return;
    const gp = this.#pad();
    if (!gp) return;
    if (!Pad.connected) { Pad.connected = true; Pad.family = padFamily(gp.id); this.#glyphs(true); }
    this.prev = this.now.slice();
    for (let i = 0; i < this.now.length; i++) {
      const b = gp.buttons[i];
      this.now[i] = !!b && (b.pressed || (b.value ?? 0) > (i === STD.LT || i === STD.RT ? TRIGGER_ON : 0.5));
    }
    this.triggers = [gp.buttons[STD.LT]?.value ?? 0, gp.buttons[STD.RT]?.value ?? 0];
    const ax = gp.axes ?? [];
    this.axes = [ax[0] ?? 0, ax[1] ?? 0, ax[2] ?? 0, ax[3] ?? 0];
    const dead = Options.get('padDead');
    const anyPress = this.now.some((v, i) => v && !this.prev[i]);
    const anyStick = Math.hypot(this.axes[0], this.axes[1]) > Math.max(0.3, dead) || Math.hypot(this.axes[2], this.axes[3]) > Math.max(0.3, dead);
    if (anyPress || anyStick) this.#setActive(true);
    if (!this.active) return;

    if (this.capture) {
      const i = this.now.findIndex((v, k) => v && !this.prev[k]);
      if (i >= 0 && i <= 15) { const cb = this.capture; this.capture = null; cb(i); }
      return;
    }

    this.#voiceButton();
    const live = this.inMatch?.() && this.controls?.enabled;
    const panel = live ? this.#matchPanel() : null;
    if (live && !panel) {
      this.#ring(null);
      this.#play(dt);
    } else {
      this.#endPlay();
      this.#menu(panel ?? this.#menuScope(), !!panel);
    }
    this.#glyphs();
  }

  // ---- Play ----------------------------------------------------------------------------------------------------------

  #play(dt) {
    const pr = id => this.pressed(this.#act(id));
    if (pr('slide')) this.latch.slide = true;
    if (pr('swap')) this.latch.swap = true;
    if (pr('reload')) this.latch.reload = true;
    if (pr('sprint')) this.sprint = !this.sprint;
    for (const slot of ['tactical', 'lethal']) this.#throwButton(slot);
    const tiles = this.controls?.tiles ?? [];
    if (pr('streak')) {
      const i = tiles.findIndex(x => x.state === 'held');
      if (i >= 0) this.latch.streak = i;
    }
    for (let k = 0; k < 3; k++) if (pr(`streak${k + 1}`) && tiles[k]?.state === 'held') this.latch.streak = k;
    if (pr('interact')) {
      for (const sel of INTERACT) {
        const el = document.querySelector(sel);
        if (usable(el)) { activate(el); break; }
      }
    }
    if (pr('ping')) this.quickChat?.ctx && this.quickChat.send(0);
    if (pr('chat') && this.quickChat?.btn && !this.quickChat.btn.hidden) this.quickChat.btn.click();
    if (pr('pause') && this.hud) {
      if (!this.hud.boardOpen) this.hud.toggleBoard();
      this.paused = true;
      this.peek = false;
    }
    const board = this.#act('board');
    if (this.pressed(board) && this.hud && !this.hud.boardOpen) { this.hud.toggleBoard(); this.peek = true; }
    if (this.released_(board) && this.peek) { this.peek = false; if (this.hud?.boardOpen) this.hud.toggleBoard(); }

    // Right stick: absolute aim, eased toward the stick at a rate the Aim sensitivity sets.
    const dead = Options.get('padDead');
    const inv = Options.get('padInvertY') ? -1 : 1;
    const rx = this.axes[2], ry = this.axes[3] * inv;
    const rlen = Math.hypot(rx, ry);
    this.rightLive = rlen > dead;
    if (this.rightLive) {
      const target = Math.atan2(ry, rx);
      if (this.aim === null) this.aim = target;
      else {
        let d = target - this.aim;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const k = 1 - Math.exp(-dt * 22 * Options.get('padSens'));
        this.aim += d * k;
      }
    } else {
      this.aim = null;
    }
  }

  // LB/RB: a tap throws at the default range where you face; held, the arc shows and the right stick's push sets the
  // range. Stim and a satchel's detonator fire on the press.
  #throwButton(slot) {
    const b = this.#act(slot), c = this.controls;
    const kind = c?.equip?.[slot]?.kind;
    if (this.pressed(b)) {
      if (INSTANT.has(kind) || (slot === 'lethal' && c?.detonate)) { this.latch[slot] = true; this.released = null; return; }
      if (!this.throwHeld) this.throwHeld = { slot, at: performance.now() };
    }
    if (this.throwHeld?.slot === slot && !this.down(b)) {
      const aimed = this.#throwAim();
      this.throwHeld = null;
      this.latch[slot] = true;
      this.released = aimed ? { ...aimed } : null;
    }
  }

  #throwAim() {
    const th = this.throwHeld;
    if (!th || performance.now() - th.at < 160) return null;
    const c = this.controls, out = this.throwOut;
    const max = c?.throwMax ?? 13;
    const push = Math.min(1, Math.hypot(this.axes[2], this.axes[3]));
    out.slot = th.slot;
    out.aim = this.aim ?? c?.playerAim ?? 0;
    out.dist = this.rightLive ? THROW_MIN_M + push * (max - THROW_MIN_M) : Math.min(THROW_HELD_M, max);
    return out;
  }

  #endPlay() {
    this.throwHeld = null;
    this.sprint = false;
    this.aim = null;
    this.rightLive = false;
  }

  // Called from Controls.read() once a frame while a match takes input: the pad's Input over the thumbs'.
  merge(inp) {
    if (!this.active || !this.supported) return;
    const dead = Options.get('padDead');
    let mx = this.axes[0], mz = this.axes[1];
    const len = Math.hypot(mx, mz);
    if (len <= dead) { mx = 0; mz = 0; } else {
      const s = Math.min(1, (len - dead) / (1 - dead)) / len;
      mx *= s; mz *= s;
    }
    const moving = Math.hypot(mx, mz);
    const fire = this.down(this.#act('fire'));
    const ads = this.down(this.#act('aim'));
    if (moving < 0.3 || fire || ads) this.sprint = false;
    inp.mx = mx; inp.mz = mz;
    inp.sprint = this.sprint && moving > 0.5;
    inp.aiming = ads || !!this.rightLive;
    // With the trigger held and the right stick at rest, the gun keeps pointing where it points: aim assist still pulls.
    inp.aim = this.rightLive ? this.aim : (fire || ads) ? (this.controls?.playerAim ?? 0) : null;
    inp.fire = fire;
    inp.melee = this.down(this.#act('melee'));
    inp.slide = this.latch.slide;
    inp.swap = this.latch.swap;
    inp.reload = this.latch.reload;
    inp.tactical = this.latch.tactical;
    inp.lethal = this.latch.lethal;
    inp.streak = this.latch.streak;
    if (inp.tactical || inp.lethal) {
      inp.throwAim = this.released;
      inp.throwDist = this.released?.dist ?? null;
      this.released = null;
    } else {
      inp.throwAim = this.#throwAim();
      inp.throwDist = null;
    }
    this.latch.slide = this.latch.swap = this.latch.reload = this.latch.tactical = this.latch.lethal = false;
    this.latch.streak = -1;
  }

  // Push to talk works everywhere a room has voice: lobby, match, results.
  #voiceButton() {
    const b = this.#act('talk'), v = this.voice?.();
    if (!v || v.mode !== 'ptt') return;
    const want = this.down(b);
    if (want !== this.talking) { this.talking = want; v.talk(want); }
  }

  // ---- Menus ---------------------------------------------------------------------------------------------------------

  #matchPanel() {
    if (this.paused) {
      if (this.hud?.boardOpen) return this.hud.boardEl;
      this.paused = false;
    }
    for (const sel of MATCH_PANELS) {
      const el = document.querySelector(sel);
      if (el && shown(el)) return el;
    }
    return null;
  }

  #menuScope() {
    const m = this.menu;
    if (!m) return null;
    if (m.overlayEl?.classList.contains('show') && m.overlayEl.firstElementChild) return m.overlayEl;
    if (m.el?.classList.contains('on')) return m.el;
    return null;
  }

  #candidates(scope) {
    const out = [];
    for (const el of scope.querySelectorAll(TAPPABLE)) {
      if (el.closest('.controls') || el.tagName === 'TEXTAREA') continue;
      if (el.parentElement?.closest(TAPPABLE) && el.parentElement.closest(TAPPABLE) !== scope) continue;   // The outer one takes the press.
      if (usable(el)) out.push(el);
    }
    return out;
  }

  #menu(scope, inMatch) {
    if (!scope) { this.#ring(null); return; }
    const list = this.#candidates(scope);
    if (scope !== this.scopeEl) { this.scopeEl = scope; this.focusEl = null; }
    let f = this.focusEl;
    if (!f || !list.includes(f)) {
      f = (this.focusKey && list.find(el => keyOf(el) === this.focusKey)) || this.#defaultFocus(scope, list);
    }
    this.#ring(f);

    const dir = this.#navDir();
    const now = performance.now();
    if (dir && (dir !== this.navDir || now >= this.navAt)) {
      this.navAt = now + (dir !== this.navDir ? REPEAT_FIRST_MS : REPEAT_MS);
      this.navDir = dir;
      const next = f ? this.#nearest(f, list, dir) : list[0];
      if (next) { this.#ring(next); next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
    } else if (!dir) this.navDir = null;

    if (this.pressed(STD.A) && this.focusEl) activate(this.focusEl);
    else if (this.pressed(STD.B)) this.#back(scope, inMatch);
    else if (this.pressed(STD.LB) || this.pressed(STD.RB)) this.#tab(scope, this.pressed(STD.RB) ? 1 : -1);
    else if (inMatch && this.pressed(this.#act('pause')) && this.paused) this.#back(scope, true);
  }

  #defaultFocus(scope, list) {
    const pick = list.find(el => el.classList.contains('is-primary') || el.classList.contains('death-go'))
      ?? list.find(el => el.classList.contains('on') || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true')
      ?? list.find(el => !el.matches(BACKISH))
      ?? list[0];
    return pick ?? null;
  }

  #navDir() {
    const n = this.now;
    if (n[STD.UP]) return 'up';
    if (n[STD.DOWN]) return 'down';
    if (n[STD.LEFT]) return 'left';
    if (n[STD.RIGHT]) return 'right';
    const [x, y] = this.axes;
    if (Math.hypot(x, y) < AXIS_NAV) return null;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
  }

  // Spatial navigation: the closest element whose centre lies ahead in that direction, sideways distance counting
  // more than distance ahead, so a row is walked before the list jumps a row.
  #nearest(from, list, dir) {
    const a = from.getBoundingClientRect();
    const ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
    const vx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0, vy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === from) continue;
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      const dx = cx - ax, dy = cy - ay;
      const ahead = dx * vx + dy * vy;
      if (ahead <= 2) continue;
      // Overlap on the cross axis means "in this row/column": no sideways cost.
      const side = vx ? Math.max(0, Math.max(r.top, a.top) < Math.min(r.bottom, a.bottom) ? 0 : Math.abs(dy))
        : Math.max(0, Math.max(r.left, a.left) < Math.min(r.right, a.right) ? 0 : Math.abs(dx));
      const score = ahead + side * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  #back(scope, inMatch) {
    if (inMatch && this.paused) {
      this.paused = false;
      if (this.hud?.boardOpen) this.hud.toggleBoard();
      return;
    }
    if (inMatch && scope.classList.contains('qc-wheel')) { this.quickChat?.btn?.click(); return; }
    const el = [...scope.querySelectorAll(BACKISH)].find(usable);
    if (el) activate(el);
  }

  // Shoulder buttons: the next or previous tab of the first tab strip on the layer.
  #tab(scope, step) {
    const tabs = [...scope.querySelectorAll('[data-tab], [role="tab"]')].filter(el => el.matches(TAPPABLE) && shown(el));
    if (tabs.length < 2) return;
    const group = tabs.filter(el => el.parentElement === tabs[0].parentElement);
    let i = group.findIndex(el => el.classList.contains('on') || el.getAttribute('aria-selected') === 'true');
    if (i < 0) i = 0;
    for (let k = 1; k <= group.length; k++) {
      const next = group[(i + step * k + group.length * k) % group.length];
      if (usable(next)) { activate(next); this.focusKey = keyOf(next); this.focusEl = null; return; }
    }
  }

  #ring(el) {
    if (this.focusEl === el) return;
    this.focusEl?.classList.remove('pad-focus');
    this.focusEl = el;
    if (el) { el.classList.add('pad-focus'); this.focusKey = keyOf(el); }
  }

  // ---- Glyphs --------------------------------------------------------------------------------------------------------
  // Two CSS variables carry the prompts: the Interact button's name on loot, buy and exfil buttons, and the Streak
  // button's name under lit streak tiles. Rewritten only when the family or a binding changes.
  #glyphs(force = false) {
    const key = `${Pad.family}|${bindingOf('interact')}|${bindingOf('streak')}`;
    if (!force && key === this.glyphKey) return;
    this.glyphKey = key;
    const s = document.body.style;
    s.setProperty('--pad-interact', JSON.stringify(buttonName(bindingOf('interact')) || ''));
    s.setProperty('--pad-streak', JSON.stringify(buttonName(bindingOf('streak')) || ''));
  }

  // The remap screen: the next button pressed goes to cb (null cancels).
  listen(cb) { this.capture = cb; }

  // For prompts: "A", "R2", "D-pad ▲".
  glyph(id) { return buttonName(bindingOf(id)); }
}

// A press from the pad: pointer events first for the few handlers that look for one (the respawn picker's cards).
function activate(el) {
  try {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'mouse', clientX: (r.left + r.right) / 2, clientY: (r.top + r.bottom) / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
  } catch { /* no PointerEvent: click alone */ }
  el.click();
}
