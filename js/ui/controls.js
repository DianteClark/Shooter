import { STREAKS, TACTICALS, LETHALS } from '../shared/catalog.js';
import { icon } from './icons.js';

// Twin-stick touch input. Touch handlers only store numbers; read() turns them into the Input object and
// repaints with transforms, once per frame, so a burst of touchmoves costs nothing extra.
const LEFT_RADIUS = 64;
const LEFT_DEAD = 0.07;
const SPRINT_ON = 0.92;
const SPRINT_OFF = 0.86;
const LEFT_DRAG = 1.3;          // Beyond this many radii the base follows the thumb, so sprint survives drift.

const AIM_ZONE = 42;
const FIRE_RING = 70;
const FIRE_RELEASE = FIRE_RING * 0.88;
const AIM_DEAD = 4;             // Thumb wobble under this many pixels does not rotate the player.
const KNOB_LIMIT = FIRE_RING + 16;

const BUTTONS = ['slide', 'swap', 'tactical', 'lethal'];
const TILE_COUNT = 3;
const TILE_IDS = Array.from({ length: TILE_COUNT }, (_, i) => `tile${i}`);
const TOUCH_TARGETS = [...BUTTONS, ...TILE_IDS];
const BUTTON_SLOP = 8;          // Fat-finger margin around every button.
const TILE_SLOP = 3;            // Tiles sit in a tight row; slop here would steal their neighbours' taps.

const LABELS = { slide: 'Slide', swap: 'Swap', tactical: 'Tactical', lethal: 'Lethal' };
const EMPTY_ICON = { tactical: 'smoke', lethal: 'frag' };

function freshInput() {
  return { mx: 0, mz: 0, aim: null, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1 };
}

export class Controls {
  constructor(root) {
    this.root = root;
    this.enabled = false;
    this.input = freshInput();     // Reused every read; callers must not keep a reference across frames.
    this.left = { id: null, ox: 0, oz: 0, x: 0, y: 0 };
    this.right = { id: null, ox: 0, oz: 0, x: 0, y: 0, aim: null, firing: false };
    this.fireLatch = false;        // A flick can cross the ring and let go between two frames.
    this.aimLatch = null;
    this.sprintOn = false;
    this.edge = { slide: false, swap: false, tactical: false, lethal: false, streak: -1 };
    this.buttonTouch = new Map();  // touch id -> button or tile name
    this.tiles = [];               // Cached display state per streak tile, so writes happen only on change.
    this.equip = { tactical: { kind: '', left: NaN }, lethal: { kind: '', left: NaN } };
    this.scoreCache = { score: NaN, capped: null };
    this.rects = {};
    this.width = window.innerWidth;
    this.paintDirty = true;
    this.last = { lx: NaN, ly: NaN, rx: NaN, ry: NaN, kx: NaN, ky: NaN, lkx: NaN, lky: NaN, la: false, ra: false, hot: false, sprint: false };

    this.#build();
    this.onTouchStart = e => this.#start(e);
    this.onTouchMove = e => this.#move(e);
    this.onTouchEnd = e => this.#end(e);
    const opts = { passive: false, capture: true };
    window.addEventListener('touchstart', this.onTouchStart, opts);
    window.addEventListener('touchmove', this.onTouchMove, opts);
    window.addEventListener('touchend', this.onTouchEnd, opts);
    window.addEventListener('touchcancel', this.onTouchEnd, opts);
    window.addEventListener('resize', () => this.#measure());
    window.addEventListener('orientationchange', () => this.#measure());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.#release(); });
  }

  #build() {
    const el = this.el = document.createElement('div');
    el.className = 'controls';
    el.innerHTML = `
      <div class="stick stick-move" data-stick="left">
        <div class="stick-rim"></div>
        <div class="stick-knob"></div>
      </div>
      <div class="stick stick-aim" data-stick="right">
        <svg class="aim-ring" viewBox="-96 -96 192 192" aria-hidden="true">
          <circle class="ring-fire" r="${FIRE_RING}" />
          <circle class="ring-zone" r="${AIM_ZONE}" />
          <path class="ring-ticks" d="M0 -${FIRE_RING + 4}V-${FIRE_RING + 15}M0 ${FIRE_RING + 4}V${FIRE_RING + 15}M-${FIRE_RING + 4} 0H-${FIRE_RING + 15}M${FIRE_RING + 4} 0H${FIRE_RING + 15}" />
        </svg>
        <div class="stick-knob aim-knob"></div>
      </div>
      <div class="aim-hint" hidden></div>
      <i class="rest rest-l"></i><i class="rest rest-r"></i>
      ${BUTTONS.map(b => `
      <button class="tbtn tbtn-${b}" data-btn="${b}" aria-label="${LABELS[b]}">
        ${icon(EMPTY_ICON[b] ?? b)}
        <span class="tbtn-label">${LABELS[b]}</span>
        ${b in EMPTY_ICON ? '<b class="tbtn-count">0</b>' : ''}
      </button>`).join('')}
      <div class="streaks">
        <div class="st-score"><span>Score</span><b>0</b></div>
        <div class="st-row">
        ${TILE_IDS.map((t, i) => `
          <button class="st-tile" data-btn="${t}" data-slot="${i}" aria-label="Streak ${i + 1}">
            <i class="st-fill"></i>
            <i class="st-ring"></i>
            <span class="st-icon"></span>
            <span class="st-lock">${icon('lock')}</span>
            <b class="st-cost">0</b>
          </button>`).join('')}
        </div>
      </div>`;
    this.root.appendChild(el);
    this.moveEl = el.querySelector('.stick-move');
    this.aimEl = el.querySelector('.stick-aim');
    this.moveKnob = this.moveEl.querySelector('.stick-knob');
    this.aimKnob = this.aimEl.querySelector('.stick-knob');
    this.hintEl = el.querySelector('.aim-hint');
    this.buttons = {};
    for (const b of BUTTONS) this.buttons[b] = el.querySelector(`[data-btn="${b}"]`);
    this.scoreEl = el.querySelector('.st-score b');
    this.scoreBox = el.querySelector('.st-score');
    this.tiles = TILE_IDS.map(id => {
      const node = el.querySelector(`[data-btn="${id}"]`);
      return {
        node, fill: node.querySelector('.st-fill'), iconEl: node.querySelector('.st-icon'), costEl: node.querySelector('.st-cost'),
        kind: '', cost: NaN, frac: NaN, state: '', pulse: 0,
      };
    });
    this.tileById = id => this.tiles[TILE_IDS.indexOf(id)];
    // The lit pop plays once per grant; removing the class on animationend lets the next grant replay it.
    for (const t of this.tiles) t.node.addEventListener('animationend', e => { if (e.animationName === 'tile-pop') t.node.classList.remove('pop'); });
  }

  // Layout is only ever measured here, never during play.
  #measure() {
    this.width = window.innerWidth;
    const box = (node, slop) => {
      const r = node.getBoundingClientRect();
      return { x0: r.left - slop, y0: r.top - slop, x1: r.right + slop, y1: r.bottom + slop };
    };
    for (const b of BUTTONS) this.rects[b] = box(this.buttons[b], BUTTON_SLOP);
    this.tiles.forEach((t, i) => { this.rects[TILE_IDS[i]] = box(t.node, TILE_SLOP); });
    const l = this.el.querySelector('.rest-l').getBoundingClientRect();
    const r = this.el.querySelector('.rest-r').getBoundingClientRect();
    this.restLeft = { x: l.left, y: l.top };
    this.restRight = { x: r.left, y: r.top };
    this.paintDirty = true;
  }

  setEnabled(on) {
    this.enabled = on;
    this.el.classList.toggle('live', on);
    if (on) this.#measure();
    else this.#release();
  }

  // slot: { kind, cost, held, blocked }. score is the player's current score. Returns true when this call
  // is the moment the slot became held, so the HUD can announce it.
  setTile(i, slot, score) {
    const t = this.tiles[i];
    if (!t || !slot) return false;
    if (t.kind !== slot.kind) {
      t.kind = slot.kind;
      t.iconEl.innerHTML = icon(slot.kind);
      t.node.setAttribute('aria-label', STREAKS[slot.kind]?.name ?? slot.kind);
    }
    if (t.cost !== slot.cost) {
      t.cost = slot.cost;
      t.costEl.textContent = slot.cost;
    }
    const frac = slot.held ? 1 : Math.min(1, Math.round(score / slot.cost * 50) / 50);
    if (frac !== t.frac) {
      t.frac = frac;
      t.fill.style.transform = `scaleY(${frac})`;
    }
    const state = slot.held ? 'held' : slot.blocked ? 'blocked' : 'earning';
    if (state === t.state) return false;
    const prev = t.state;
    t.state = state;
    t.node.classList.toggle('held', state === 'held');
    t.node.classList.toggle('blocked', state === 'blocked');
    const justLit = state === 'held' && prev !== '';
    if (justLit) t.node.classList.add('pop');
    return justLit;
  }

  setScore(score, capped) {
    const c = this.scoreCache;
    if (c.score !== score) { c.score = score; this.scoreEl.textContent = score; }
    if (c.capped !== capped) { c.capped = capped; this.scoreBox.classList.toggle('capped', capped); }
  }

  // kind is a TACTICALS or LETHALS id; left is the remaining count.
  setEquip(which, kind, left) {
    const e = this.equip[which], b = this.buttons[which];
    if (kind && e.kind !== kind) {
      e.kind = kind;
      b.querySelector('svg').outerHTML = icon(kind);
      b.querySelector('.tbtn-label').textContent = (which === 'tactical' ? TACTICALS : LETHALS)[kind]?.name ?? kind;
    }
    if (e.left !== left) {
      e.left = left;
      b.querySelector('.tbtn-count').textContent = left ?? 0;
      b.classList.toggle('empty', !left);
    }
  }

  // Lights Swap when the current gun has nothing left to fire.
  setSwapHint(on) {
    this.buttons.swap.classList.toggle('urgent', on);
  }

  // While dead the thumb area belongs to the respawn screen. Hidden with visibility so measured rects stay valid.
  setDown(on) {
    this.el.classList.toggle('down-state', on);
  }

  // showAimHint(true) walks a new player through the fire ring; false or a timeout removes it.
  showAimHint(on = true, text = 'Hold to aim. Push past the ring to fire.') {
    clearTimeout(this.hintTimer);
    this.hintEl.hidden = !on;
    this.hintEl.textContent = text;
    if (on) this.hintTimer = setTimeout(() => { this.hintEl.hidden = true; }, 7000);
  }

  #buttonAt(x, y) {
    for (const b of TOUCH_TARGETS) {
      const r = this.rects[b];
      if (r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return b;
    }
    return null;
  }

  #start(e) {
    if (!this.enabled) return;
    const target = e.target;
    // HUD elements with their own taps (mic, weapon picker) must keep their click.
    if (target?.closest?.('[data-tap]')) return;
    e.preventDefault();
    this.#reconcile(e.touches);
    for (const t of e.changedTouches) {
      const x = t.clientX, y = t.clientY;
      const btn = this.#buttonAt(x, y);
      if (btn) {
        this.#press(btn);
        this.buttonTouch.set(t.identifier, btn);
        this.hintEl.hidden = true;
        continue;
      }
      if (x < this.width / 2) {
        if (this.left.id === null) this.#grabLeft(t.identifier, x, y);
      } else if (this.right.id === null) {
        this.#grabRight(t.identifier, x, y);
      }
    }
  }

  #press(btn) {
    const tile = this.tileById(btn);
    if (tile) {
      // Only a lit tile fires; the sim would refuse anything else anyway.
      if (tile.state === 'held') this.edge.streak = Number(tile.node.dataset.slot);
      tile.node.classList.add('down');
    } else {
      this.edge[btn] = true;
      this.buttons[btn].classList.add('down');
    }
  }

  #grabLeft(id, x, y) {
    const l = this.left;
    l.id = id; l.ox = x; l.oz = y; l.x = x; l.y = y;
    this.paintDirty = true;
  }

  #grabRight(id, x, y) {
    const r = this.right;
    r.id = id; r.ox = x; r.oz = y; r.x = x; r.y = y;
    r.aim = null; r.firing = false;
    this.paintDirty = true;
  }

  #move(e) {
    if (!this.enabled) return;
    if (e.target?.closest?.('[data-tap]')) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const id = t.identifier;
      if (id === this.left.id) {
        this.left.x = t.clientX;
        this.left.y = t.clientY;
        this.paintDirty = true;
      } else if (id === this.right.id) {
        this.#aimMove(t.clientX, t.clientY);
      }
    }
  }

  #aimMove(x, y) {
    const r = this.right;
    r.x = x; r.y = y;
    const dx = x - r.ox, dy = y - r.oz;
    const d = Math.hypot(dx, dy);
    if (d >= AIM_DEAD) r.aim = Math.atan2(dy, dx);
    if (r.firing ? d < FIRE_RELEASE : d >= FIRE_RING) {
      r.firing = !r.firing;
      if (r.firing) {
        this.fireLatch = true;
        this.aimLatch = r.aim;
      }
    }
    this.paintDirty = true;
  }

  #end(e) {
    if (!this.enabled) return;
    if (e.cancelable && !e.target?.closest?.('[data-tap]')) e.preventDefault();
    for (const t of e.changedTouches) this.#drop(t.identifier);
  }

  #drop(id) {
    if (id === this.left.id) {
      this.left.id = null;
      this.paintDirty = true;
    } else if (id === this.right.id) {
      this.right.id = null;
      this.right.firing = false;
      this.paintDirty = true;
    } else {
      const btn = this.buttonTouch.get(id);
      if (btn) {
        (this.buttons[btn] ?? this.tileById(btn).node).classList.remove('down');
        this.buttonTouch.delete(id);
      }
    }
  }

  // iOS occasionally loses a touchend when a system gesture steals the finger.
  #reconcile(touches) {
    const alive = id => {
      for (let i = 0; i < touches.length; i++) if (touches[i].identifier === id) return true;
      return false;
    };
    if (this.left.id !== null && !alive(this.left.id)) this.#drop(this.left.id);
    if (this.right.id !== null && !alive(this.right.id)) this.#drop(this.right.id);
    for (const id of [...this.buttonTouch.keys()]) if (!alive(id)) this.#drop(id);
  }

  #release() {
    this.left.id = null;
    this.right.id = null;
    this.right.firing = false;
    this.fireLatch = false;
    this.aimLatch = null;
    for (const b of BUTTONS) {
      this.edge[b] = false;
      this.buttons[b].classList.remove('down');
    }
    this.edge.streak = -1;
    for (const t of this.tiles) t.node.classList.remove('down');
    this.buttonTouch.clear();
    this.paintDirty = true;
    this.#paint();
  }

  read() {
    const inp = this.input;
    if (!this.enabled) {
      inp.mx = inp.mz = 0;
      inp.aim = null;
      inp.aiming = inp.fire = inp.sprint = false;
      inp.slide = inp.swap = inp.tactical = inp.lethal = false;
      inp.streak = -1;
      return inp;
    }

    const l = this.left;
    let mx = 0, mz = 0;
    if (l.id !== null) {
      let dx = l.x - l.ox, dy = l.y - l.oz;
      let d = Math.hypot(dx, dy);
      const reach = LEFT_RADIUS * LEFT_DRAG;
      if (d > reach) {
        const pull = (d - reach) / d;
        l.ox += dx * pull; l.oz += dy * pull;
        dx = l.x - l.ox; dy = l.y - l.oz;
        d = reach;
      }
      const len = Math.min(d / LEFT_RADIUS, 1);
      if (len > LEFT_DEAD && d > 0) {
        mx = (dx / d) * len;
        mz = (dy / d) * len;
      }
      this.sprintOn = this.sprintOn ? len >= SPRINT_OFF : len >= SPRINT_ON;
    } else {
      this.sprintOn = false;
    }
    inp.mx = mx;
    inp.mz = mz;
    inp.sprint = this.sprintOn;

    const r = this.right;
    const held = r.id !== null;
    inp.aiming = held;
    inp.aim = held ? r.aim : this.fireLatch ? this.aimLatch : null;
    inp.fire = r.firing || this.fireLatch;
    this.fireLatch = false;

    inp.slide = this.edge.slide;
    inp.swap = this.edge.swap;
    inp.tactical = this.edge.tactical;
    inp.lethal = this.edge.lethal;
    inp.streak = this.edge.streak;
    this.edge.slide = this.edge.swap = this.edge.tactical = this.edge.lethal = false;
    this.edge.streak = -1;

    if (this.paintDirty) this.#paint();
    return inp;
  }

  // Writes only values that changed; everything is transform or a class flip.
  #paint() {
    this.paintDirty = false;
    const last = this.last;
    const restL = this.restLeft ?? { x: 120, y: 272 };
    const restR = this.restRight ?? { x: 644, y: 272 };

    const l = this.left, leftActive = l.id !== null;
    const lx = leftActive ? l.ox : restL.x, ly = leftActive ? l.oz : restL.y;
    if (lx !== last.lx || ly !== last.ly) {
      this.moveEl.style.transform = `translate3d(${lx}px,${ly}px,0)`;
      last.lx = lx; last.ly = ly;
    }
    let kx = 0, ky = 0;
    if (leftActive) {
      kx = l.x - l.ox; ky = l.y - l.oz;
      const d = Math.hypot(kx, ky);
      if (d > LEFT_RADIUS) { kx *= LEFT_RADIUS / d; ky *= LEFT_RADIUS / d; }
    }
    if (kx !== last.lkx || ky !== last.lky) {
      this.moveKnob.style.transform = `translate3d(${kx}px,${ky}px,0)`;
      last.lkx = kx; last.lky = ky;
    }
    if (leftActive !== last.la) {
      this.moveEl.classList.toggle('active', leftActive);
      last.la = leftActive;
    }
    if (this.sprintOn !== last.sprint) {
      this.moveEl.classList.toggle('sprint', this.sprintOn);
      last.sprint = this.sprintOn;
    }

    const r = this.right, rightActive = r.id !== null;
    const rx = rightActive ? r.ox : restR.x, ry = rightActive ? r.oz : restR.y;
    if (rx !== last.rx || ry !== last.ry) {
      this.aimEl.style.transform = `translate3d(${rx}px,${ry}px,0)`;
      last.rx = rx; last.ry = ry;
    }
    let ax = 0, ay = 0;
    if (rightActive) {
      ax = r.x - r.ox; ay = r.y - r.oz;
      const d = Math.hypot(ax, ay);
      if (d > KNOB_LIMIT) { ax *= KNOB_LIMIT / d; ay *= KNOB_LIMIT / d; }
    }
    if (ax !== last.kx || ay !== last.ky) {
      this.aimKnob.style.transform = `translate3d(${ax}px,${ay}px,0)`;
      last.kx = ax; last.ky = ay;
    }
    if (rightActive !== last.ra) {
      this.aimEl.classList.toggle('active', rightActive);
      last.ra = rightActive;
    }
    if (r.firing !== last.hot) {
      this.aimEl.classList.toggle('hot', r.firing);
      last.hot = r.firing;
    }
  }
}
