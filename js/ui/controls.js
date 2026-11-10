import { STREAKS, STREAK_DENY_TEXT, TACTICALS, LETHALS } from '../shared/catalog.js';
import { icon } from './icons.js';
import { AimFilter, wrapAngle } from './aimfilter.js';
import { TUNING, onTune } from '../shared/tuning.js';
import { mountTuner } from './tuner.js';

// Twin-stick touch input. Touch handlers only store numbers; read() turns them into the Input object and
// repaints with transforms, once per frame, so a burst of touchmoves costs nothing extra.
// Live tunables (js/shared/tuning.js): move stick radius (leftSize), sprint threshold (sprintAt), fire ring radius
// (fireRing). Changing one re-measures and repaints the sticks; see #applyTuning.
const LEFT_DEAD = 0.07;
const SPRINT_HYST = 0.06;       // Sprint drops this far below the threshold that started it.
const LEFT_DRAG = 1.3;          // Beyond this many radii the base follows the thumb, so sprint survives drift.

const AIM_ZONE = 30;            // Drawn only: the dashed inner ring, a hint of where aiming starts.
const FIRE_RELEASE_FRAC = 0.88;
const KNOB_OVER = 16;           // The aim knob may travel this far past the fire ring.
const RELEASE_TURN = 11;        // rad/s the facing eases back to the direction of travel after the aim thumb lifts.
const RELEASE_DONE = 0.09;      // Radians from the direction of travel at which that glide hands over to the game.
const SWAP_MIN_PX = 150;        // Both thumbs would have to jump this far together for a swap of identities to be real.

// Controlled throws: the thumb that pressed Tactical or Lethal keeps going and sets direction and distance.
const THROW_HOLD_MS = 160;
const MISSING_DROP_MS = 250;    // How long a stick's finger must be absent from touch lists before it is let go.      // A press shorter than this, without leaving the button, is a quick throw.
const THROW_ARM_PX = 30;        // Radius around the button's centre: leaving it starts the aim, returning cancels.
const THROW_FULL_PX = 118;      // Drag distance from the button centre that means full range.
const THROW_MIN_M = 2.5;        // Shortest aimed toss; a drag that barely clears the button is a lob at your feet.
const THROW_BASE_M = 13;
const THROW_STRONG_M = 19;
const THROW_HELD_M = 9;         // Range when the button is held but never dragged.

const BUTTONS = ['slide', 'swap', 'tactical', 'lethal'];
const TILE_COUNT = 3;
const TILE_IDS = Array.from({ length: TILE_COUNT }, (_, i) => `tile${i}`);
const TOUCH_TARGETS = [...BUTTONS, ...TILE_IDS];
const BUTTON_SLOP = 8;          // Fat-finger margin around every button.
const TILE_SLOP = 3;            // Tiles sit in a tight row; slop here would steal their neighbours' taps.

const LABELS = { slide: 'Slide', swap: 'Swap', tactical: 'Tactical', lethal: 'Lethal' };
const EMPTY_ICON = { tactical: 'smoke', lethal: 'frag' };
const THROW_SLOTS = ['tactical', 'lethal'];
// Equipment that applies instantly has nothing to aim, so its button keeps firing on the press.
const INSTANT = new Set(['stim']);

function freshInput() {
  return { mx: 0, mz: 0, aim: null, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1, throwAim: null, throwDist: null };
}

export class Controls {
  constructor(root) {
    this.root = root;
    this.enabled = false;
    this.input = freshInput();     // Reused every read; callers must not keep a reference across frames.
    this.left = { id: null, ox: 0, oz: 0, x: 0, y: 0 };
    this.right = { id: null, ox: 0, oz: 0, x: 0, y: 0, aim: null, firing: false };
    this.aimFilter = new AimFilter();
    this.glide = { on: false, aim: 0, last: 0 };    // Facing eased back after the aim thumb lifts; see read().
    this.fireLatch = false;        // A flick can cross the ring and let go between two frames.
    this.aimLatch = null;
    this.sprintOn = false;
    this.edge = { slide: false, swap: false, tactical: false, lethal: false, streak: -1 };
    this.missing = { left: 0, right: 0 };   // When each stick's finger was first absent from a touch list.
    this.throw = null;             // The press in aim mode: { slot, id, cx, cy, x, y, at, left, cancel }.
    this.throwHeld = { slot: '', aim: 0, dist: 0 };    // Reused while a throw is held; returned from read().
    this.throwReleased = null;     // The aim of a throw released since the last read, or null for a quick one.
    this.throwMax = THROW_BASE_M;
    this.playerAim = 0;            // Last aim the HUD saw: where a held, undragged throw goes.
    this.sensitivity = 1;
    this.fireRing = TUNING.fireRing;
    this.fireRelease = this.fireRing * FIRE_RELEASE_FRAC;
    this.knobLimit = this.fireRing + KNOB_OVER;
    this.leftRadius = TUNING.leftSize;
    this.lefty = false;
    this.buttonTouch = new Map();  // touch id -> button or tile name
    // iOS's touch stream is not always whole (see #adopt). These two let a finger it lost track of be picked up again.
    this.lost = new Map();         // touch id -> { side, ox, oz }: a stick let go of without that finger's touchend
    this.spare = new Set();        // Fingers that started but hold nothing: a third finger beside a held stick.
    this.tiles = [];               // Cached display state per streak tile, so writes happen only on change.
    this.equip = { tactical: { kind: '', left: NaN }, lethal: { kind: '', left: NaN } };
    this.scoreCache = { score: NaN, capped: null };
    this.rects = {};
    this.width = window.innerWidth;
    this.paintDirty = true;
    this.last = { lx: NaN, ly: NaN, rx: NaN, ry: NaN, kx: NaN, ky: NaN, lkx: NaN, lky: NaN, la: false, ra: false, hot: false, sprint: false };

    this.#build();
    this.#applyTuning();
    onTune(key => { if (key === null || key === 'fireRing' || key === 'leftSize') this.#applyTuning(); });
    this.tuner = mountTuner(this.root);
    this.onTouchStart = e => this.#start(e);
    this.onTouchMove = e => this.#move(e);
    this.onTouchEnd = e => this.#end(e);
    const opts = { passive: false, capture: true };
    window.addEventListener('touchstart', this.onTouchStart, opts);
    window.addEventListener('touchmove', this.onTouchMove, opts);
    window.addEventListener('touchend', this.onTouchEnd, opts);
    window.addEventListener('touchcancel', this.onTouchEnd, opts);
    window.addEventListener('resize', () => this.remeasure());
    window.addEventListener('orientationchange', () => this.remeasure());
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
        <svg class="aim-ring" aria-hidden="true">
          <circle class="ring-fire" />
          <circle class="ring-zone" />
          <path class="ring-ticks" />
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
        <div class="stk-row">
        ${TILE_IDS.map((t, i) => `
          <button class="st-tile" data-btn="${t}" data-slot="${i}" aria-label="Streak ${i + 1}">
            <i class="st-fill"></i>
            <i class="st-ring"></i>
            <span class="st-icon"></span>
            <small class="st-why"></small>
            <span class="st-lock">${icon('lock')}</span>
            <b class="st-cost">0</b>
          </button>`).join('')}
        </div>
      </div>
      <div class="throw-rig">
        <i class="tr-range"></i>
        <i class="tr-line"></i>
        <i class="tr-dot"></i>
        <span class="tr-label"><b></b><small></small></span>
      </div>`;
    this.root.appendChild(el);
    this.moveEl = el.querySelector('.stick-move');
    this.aimEl = el.querySelector('.stick-aim');
    this.moveKnob = this.moveEl.querySelector('.stick-knob');
    this.aimKnob = this.aimEl.querySelector('.stick-knob');
    this.moveRim = this.moveEl.querySelector('.stick-rim');
    this.ringSvg = this.aimEl.querySelector('.aim-ring');
    this.hintEl = el.querySelector('.aim-hint');
    this.rig = {
      el: el.querySelector('.throw-rig'), range: el.querySelector('.tr-range'), line: el.querySelector('.tr-line'), dot: el.querySelector('.tr-dot'),
      label: el.querySelector('.tr-label'), dist: el.querySelector('.tr-label b'), tip: el.querySelector('.tr-label small'),
      shownDist: NaN, shownMode: '', shownSlot: '', cancelled: null, active: null, btn: null,
    };
    this.rig.range.style.width = this.rig.range.style.height = `${THROW_FULL_PX * 2}px`;
    this.rig.range.style.margin = `-${THROW_FULL_PX}px 0 0 -${THROW_FULL_PX}px`;
    this.buttons = {};
    for (const b of BUTTONS) this.buttons[b] = el.querySelector(`[data-btn="${b}"]`);
    this.scoreEl = el.querySelector('.st-score b');
    this.scoreBox = el.querySelector('.st-score');
    this.tiles = TILE_IDS.map(id => {
      const node = el.querySelector(`[data-btn="${id}"]`);
      return {
        node, fill: node.querySelector('.st-fill'), iconEl: node.querySelector('.st-icon'), costEl: node.querySelector('.st-cost'), whyEl: node.querySelector('.st-why'),
        kind: '', cost: NaN, frac: NaN, state: '', why: '', pulse: 0,
      };
    });
    this.tileById = id => this.tiles[TILE_IDS.indexOf(id)];
    // The lit pop plays once per grant; removing the class on animationend lets the next grant replay it.
    for (const t of this.tiles) t.node.addEventListener('animationend', e => { if (e.animationName === 'tile-pop') t.node.classList.remove('pop'); });
  }

  // Stick feel, the swapped layout and the throw reach are settings; they can change between matches.
  // sensitivity 0.6..1.6 scales how far the aim thumb travels before it fires.
  applyOptions({ sensitivity = 1, lefty = false } = {}) {
    this.sensitivity = Math.max(0.6, Math.min(1.6, sensitivity));
    this.lefty = !!lefty;
    this.el.classList.toggle('lefty', this.lefty);
    this.#applyTuning();
  }

  // Stick geometry from the tuning registry and the sensitivity option. The ring is redrawn at its true pixel size
  // (no CSS scale, so the stroke stays crisp), the move rim resized, and the knobs repainted against the new limits.
  #applyTuning() {
    const ring = TUNING.fireRing / this.sensitivity;
    this.fireRing = ring;
    this.fireRelease = ring * FIRE_RELEASE_FRAC;
    this.knobLimit = ring + KNOB_OVER;
    const zone = Math.min(AIM_ZONE, ring * 0.6);
    const half = Math.ceil(ring + 20);
    const svg = this.ringSvg;
    svg.setAttribute('viewBox', `${-half} ${-half} ${half * 2} ${half * 2}`);
    svg.style.left = svg.style.top = `${-half}px`;
    svg.style.width = svg.style.height = `${half * 2}px`;
    svg.querySelector('.ring-fire').setAttribute('r', ring.toFixed(1));
    svg.querySelector('.ring-zone').setAttribute('r', zone.toFixed(1));
    const a = (ring + 4).toFixed(1), b = (ring + 15).toFixed(1);
    svg.querySelector('.ring-ticks').setAttribute('d', `M0 -${a}V-${b}M0 ${a}V${b}M-${a} 0H-${b}M${a} 0H${b}`);

    const lr = this.leftRadius = TUNING.leftSize;
    const rim = this.moveRim.style;
    rim.left = rim.top = `${-lr}px`;
    rim.width = rim.height = `${lr * 2}px`;

    // A held aim thumb is judged against the new ring at once rather than on its next move.
    const r = this.right;
    if (r.id !== null) {
      const d = Math.hypot(r.x - r.ox, r.y - r.oz);
      if (r.firing ? d < this.fireRelease : d >= this.fireRing) r.firing = !r.firing;
    }
    this.last.kx = this.last.lkx = NaN;   // Force the knobs to repaint against the new limits.
    this.paintDirty = true;
    if (this.enabled) this.#measure();
    this.#paint();
  }

  setThrowReach(strongArm) {
    this.throwMax = strongArm ? THROW_STRONG_M : THROW_BASE_M;
  }

  // Where the player is facing, from the HUD; a held but undragged throw goes this way.
  notePlayerAim(aim) {
    if (typeof aim === 'number') this.playerAim = aim;
  }

  // Rotations and toolbar changes settle after the event that announces them, so main.js also calls this.
  remeasure() {
    if (this.enabled) this.#measure();
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
    this.tuner.setLive(on);
    if (on) this.#measure();
    else this.#release();
  }

  // slot: { kind, cost, held, blocked, denied }. score is the player's current score. Returns true when this call
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
    // Held but not callable right now (airspace full, already up): the streak is kept and the tile says why.
    const why = slot.held && slot.denied ? (STREAK_DENY_TEXT?.[slot.denied] ?? '') : '';
    if (why !== t.why) {
      t.why = why;
      t.whyEl.textContent = why;
      t.node.classList.toggle('denied', !!why);
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
    if (target?.closest?.('[data-tap]') || target?.closest?.('.tuner')) return;
    e.preventDefault();
    this.#reconcile(e.touches, e.timeStamp);
    this.#revive(e.touches, e.timeStamp);
    for (const t of e.changedTouches) {
      // The tuning panel's own touches; the panel never covers the screen, so a thumb beside it still plays.
      if (t.target?.closest?.('.tuner')) continue;
      // iOS reuses identifiers: a "new" finger with an id still in use means the old one ended without telling us.
      this.#forgetStale(t.identifier);
      this.lost.delete(t.identifier);
      this.spare.delete(t.identifier);
      const x = t.clientX, y = t.clientY;
      const btn = this.#buttonAt(x, y);
      if (btn) {
        this.#press(btn, t.identifier, e.timeStamp);
        this.buttonTouch.set(t.identifier, btn);
        this.hintEl.hidden = true;
        continue;
      }
      if ((x < this.width / 2) !== this.lefty) {
        if (this.left.id === null) this.#grabLeft(t.identifier, x, y);
        else this.#keep(this.spare, t.identifier);
      } else if (this.right.id === null) {
        this.#grabRight(t.identifier, x, y, e.timeStamp);
      } else {
        this.#keep(this.spare, t.identifier);
      }
    }
  }

  // Bounded: a finger whose touchend iOS never sent must not leave an entry behind for the rest of the session.
  #keep(set, id, value) {
    if (set.size >= 16) set.delete(set.keys().next().value);
    if (value === undefined) set.add(id);
    else set.set(id, value);
  }

  // A finger reporting a move that holds nothing. iOS sends these in two ways, and both used to leave the stick dead
  // under a thumb that was still on the glass, typically right as a throw is released:
  //  - its touchstart was never delivered (WebKit drops a touchstart that lands in the same instant another finger
  //    lifts, such as the thumb re-planting as the grenade finger lets go);
  //  - the stick was let go of by inference (a `touches` list that left the thumb out, an identifier that looked
  //    reused, a touchcancel) and the finger then kept moving, which proves it was there all along.
  // A lost stick resumes with its own base; a never-seen finger takes a free stick from where it is now, never a button.
  #adopt(t, at) {
    const id = t.identifier, x = t.clientX, y = t.clientY;
    if (this.buttonTouch.has(id) || this.spare.has(id)) return;
    if (t.target?.closest?.('[data-tap]') || t.target?.closest?.('.tuner')) return;
    const was = this.lost.get(id);
    this.lost.delete(id);
    if (was) {
      if (was.side === 'left' && this.left.id === null) {
        this.#grabLeft(id, was.ox, was.oz);
        this.left.x = x; this.left.y = y;
      } else if (was.side === 'right' && this.right.id === null) {
        this.#grabRight(id, was.ox, was.oz, at);
        this.#aimMove(x, y, at);
      } else {
        this.#keep(this.spare, id);
      }
      return;
    }
    if (this.#buttonAt(x, y)) return this.#keep(this.spare, id);
    if ((x < this.width / 2) !== this.lefty) {
      if (this.left.id === null) this.#grabLeft(id, x, y);
      else this.#keep(this.spare, id);
    } else if (this.right.id === null) {
      this.#grabRight(id, x, y, at);
    } else {
      this.#keep(this.spare, id);
    }
  }

  #forgetStale(id) {
    if (id === this.left.id || id === this.right.id || this.buttonTouch.has(id)) this.#drop(id, performance.now(), true);
  }

  #press(btn, touchId, at) {
    if (THROW_SLOTS.includes(btn) && this.#startThrow(btn, touchId, at)) return;
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

  // Returns true when the press was taken as a throw (or spent on an empty button).
  #startThrow(slot, touchId, at) {
    const e = this.equip[slot], b = this.buttons[slot];
    if (INSTANT.has(e.kind)) return false;
    b.classList.add('down');
    if (!e.left) {
      b.classList.remove('deny');
      void b.offsetWidth;
      b.classList.add('deny');
      return true;
    }
    if (this.throw) return true;      // One grenade at a time; the second thumb is just pressing a button.
    const r = this.rects[slot];
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    this.throw = { slot, id: touchId, cx, cy, x: cx, y: cy, at, left: false, cancel: false };
    this.paintDirty = true;
    return true;
  }

  #throwMove(x, y) {
    const th = this.throw;
    th.x = x; th.y = y;
    const d = Math.hypot(x - th.cx, y - th.cy);
    if (d >= THROW_ARM_PX) {
      th.left = true;
      th.cancel = false;
    } else if (th.left) {
      th.cancel = true;
    }
    this.paintDirty = true;
  }

  // The throw as of right now, or null while it is still only a press or has been cancelled.
  #throwAim(th = this.throw, now = performance.now()) {
    if (!th || th.cancel) return null;
    const out = this.throwHeld;
    if (th.left) {
      const dx = th.x - th.cx, dy = th.y - th.cy, d = Math.hypot(dx, dy);
      out.slot = th.slot;
      out.aim = Math.atan2(dy, dx);
      out.dist = THROW_MIN_M + Math.min(1, (d - THROW_ARM_PX) / (THROW_FULL_PX - THROW_ARM_PX)) * (this.throwMax - THROW_MIN_M);
      return out;
    }
    if (now - th.at < THROW_HOLD_MS) return null;
    out.slot = th.slot;
    out.aim = this.playerAim;
    out.dist = Math.min(THROW_HELD_M, this.throwMax);
    return out;
  }

  // at is the release's event time, so a tap stays a tap even if the frame around it ran long.
  #endThrow(at) {
    const th = this.throw;
    this.throw = null;
    this.paintDirty = true;
    if (th.cancel) return;
    const aimed = this.#throwAim(th, at);
    this.edge[th.slot] = true;
    this.throwReleased = aimed ? { ...aimed } : null;   // null means a quick tap: current aim at default range.
  }

  #grabLeft(id, x, y) {
    const l = this.left;
    this.missing.left = 0;
    l.id = id; l.ox = x; l.oz = y; l.x = x; l.y = y;
    this.paintDirty = true;
  }

  #grabRight(id, x, y, t) {
    const r = this.right;
    this.missing.right = 0;
    r.id = id; r.ox = x; r.oz = y; r.x = x; r.y = y;
    r.aim = null; r.firing = false;
    this.aimFilter.reset();
    this.aimFilter.push(0, 0, t);
    this.glide.on = false;
    this.paintDirty = true;
  }

  #move(e) {
    if (!this.enabled) return;
    if (e.target?.closest?.('[data-tap]') || e.target?.closest?.('.tuner')) return;
    e.preventDefault();
    this.#revive(e.touches, e.timeStamp);
    this.#unswap(e.changedTouches);
    for (const t of e.changedTouches) {
      const id = t.identifier;
      if (id === this.left.id) {
        this.left.x = t.clientX;
        this.left.y = t.clientY;
        this.paintDirty = true;
      } else if (id === this.right.id) {
        this.#aimMove(t.clientX, t.clientY, e.timeStamp);
      } else if (this.throw?.id === id) {
        this.#throwMove(t.clientX, t.clientY);
      } else {
        this.#adopt(t, e.timeStamp);
      }
    }
  }

  // Two thumbs that come close can have their identifiers cross on iOS: each id then reports where the other thumb is.
  // Both jumping onto each other's last position in the same event is the signature; the ids are put back.
  #unswap(changed) {
    const l = this.left, r = this.right;
    if (l.id === null || r.id === null || changed.length < 2) return;
    let lt = null, rt = null;
    for (let i = 0; i < changed.length; i++) {
      if (changed[i].identifier === l.id) lt = changed[i];
      else if (changed[i].identifier === r.id) rt = changed[i];
    }
    if (!lt || !rt) return;
    const stay = Math.hypot(lt.clientX - l.x, lt.clientY - l.y) + Math.hypot(rt.clientX - r.x, rt.clientY - r.y);
    const cross = Math.hypot(lt.clientX - r.x, lt.clientY - r.y) + Math.hypot(rt.clientX - l.x, rt.clientY - l.y);
    if (stay > SWAP_MIN_PX * 2 && cross < stay * 0.25) { const id = l.id; l.id = r.id; r.id = id; }
  }

  #aimMove(x, y, t) {
    const r = this.right;
    r.x = x; r.y = y;
    const dx = x - r.ox, dy = y - r.oz;
    const d = Math.hypot(dx, dy);
    r.aim = this.aimFilter.push(dx, dy, t);
    if (r.firing ? d < this.fireRelease : d >= this.fireRing) {
      r.firing = !r.firing;
      if (r.firing) {
        this.fireLatch = true;
        // A flick can reach the ring before the filter has caught up; at this radius the raw angle is clean.
        this.aimLatch = Math.atan2(dy, dx);
      }
    }
    this.paintDirty = true;
  }

  #end(e) {
    if (!this.enabled) return;
    if (e.cancelable && !e.target?.closest?.('[data-tap]')) e.preventDefault();
    for (const t of e.changedTouches) this.#drop(t.identifier, e.timeStamp, e.type === 'touchcancel');
    this.#revive(e.touches, e.timeStamp);
  }

  // cancelled: the system took the finger, or it was found to be gone. Nothing it was doing should fire.
  // A stick dropped that way is remembered, so that a later move from the same finger picks it up again (#adopt).
  #drop(id, at = performance.now(), cancelled = false) {
    if (!cancelled) { this.lost.delete(id); this.spare.delete(id); }
    if (id === this.left.id) {
      if (cancelled) this.#keep(this.lost, id, { side: 'left', ox: this.left.ox, oz: this.left.oz });
      this.left.id = null;
      this.paintDirty = true;
    } else if (id === this.right.id) {
      if (cancelled) this.#keep(this.lost, id, { side: 'right', ox: this.right.ox, oz: this.right.oz });
      const settled = this.aimFilter.settled(at);
      this.right.id = null;
      this.right.firing = false;
      this.paintDirty = true;
      if (settled !== null && !cancelled) {
        this.glide.on = true;
        this.glide.aim = settled;
        this.glide.last = performance.now();
      }
    } else {
      const btn = this.buttonTouch.get(id);
      if (btn) {
        if (this.throw?.id === id) {
          if (cancelled) { this.throw = null; this.paintDirty = true; }
          else this.#endThrow(at);
        }
        (this.buttons[btn] ?? this.tileById(btn).node).classList.remove('down');
        this.buttonTouch.delete(id);
        if (cancelled) this.#keep(this.spare, id);   // A button finger that turns out to be alive stays a button press.
      }
    }
  }

  // iOS occasionally loses a touchend when a system gesture steals the finger, so a stick whose finger is missing
  // from the live touch list is let go. But iOS also sends a quick tap's touchstart with a stale list that omits a
  // thumb resting perfectly still on a stick, and a still thumb sends no moves to win it back. So a stick is only
  // given up once its finger has been missing from lists for a while; a single odd list changes nothing.
  #reconcile(touches, at = performance.now()) {
    const alive = id => {
      for (let i = 0; i < touches.length; i++) if (touches[i].identifier === id) return true;
      return false;
    };
    const check = (side, id) => {
      if (id === null) return;
      if (alive(id)) { this.missing[side] = 0; return; }
      if (!this.missing[side]) { this.missing[side] = at; return; }
      if (at - this.missing[side] >= MISSING_DROP_MS) { this.missing[side] = 0; this.#drop(id, at, true); }
    };
    check('left', this.left.id);
    check('right', this.right.id);
    for (const id of [...this.buttonTouch.keys()]) if (!alive(id)) this.#drop(id, at, true);
  }

  // A finger in the live list that a stick was let go of by inference takes its stick back at once, moving or not.
  #revive(touches, at) {
    if (!this.lost.size) return;
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      if (this.lost.has(t.identifier)) this.#adopt(t, at);
    }
  }

  #release() {
    this.left.id = null;
    this.right.id = null;
    this.missing.left = this.missing.right = 0;
    this.right.firing = false;
    this.fireLatch = false;
    this.aimLatch = null;
    this.glide.on = false;
    for (const b of BUTTONS) {
      this.edge[b] = false;
      this.buttons[b].classList.remove('down');
    }
    this.edge.streak = -1;
    for (const t of this.tiles) t.node.classList.remove('down');
    this.buttonTouch.clear();
    this.lost.clear();              // Nothing is picked up again across a pause or a match boundary.
    this.spare.clear();
    this.throw = null;              // A press the game took away is not a throw.
    this.throwReleased = null;
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
      inp.throwAim = null;
      inp.throwDist = null;
      return inp;
    }

    const l = this.left;
    let mx = 0, mz = 0;
    if (l.id !== null) {
      let dx = l.x - l.ox, dy = l.y - l.oz;
      let d = Math.hypot(dx, dy);
      const radius = this.leftRadius;
      const reach = radius * LEFT_DRAG;
      if (d > reach) {
        const pull = (d - reach) / d;
        l.ox += dx * pull; l.oz += dy * pull;
        dx = l.x - l.ox; dy = l.y - l.oz;
        d = reach;
      }
      const len = Math.min(d / radius, 1);
      if (len > LEFT_DEAD && d > 0) {
        mx = (dx / d) * len;
        mz = (dy / d) * len;
      }
      // A threshold of 1 still needs to be reachable: len tops out at exactly 1.
      const on = Math.min(TUNING.sprintAt, 0.999);
      this.sprintOn = this.sprintOn ? len >= on - SPRINT_HYST : len >= on;
    } else {
      this.sprintOn = false;
    }
    inp.mx = mx;
    inp.mz = mz;
    inp.sprint = this.sprintOn;

    const r = this.right;
    const held = r.id !== null;
    inp.aiming = held;
    // Match turns the player to face the direction of travel whenever aim is null. A held stick must never read as
    // null: a thumb resting inside the deadzone while the other thumb walks would snap the player round.
    inp.aim = held ? (r.aim ?? this.playerAim) : this.fireLatch ? this.aimLatch : this.#glideAim(mx, mz);
    inp.fire = r.firing || this.fireLatch;
    this.fireLatch = false;

    inp.slide = this.edge.slide;
    inp.swap = this.edge.swap;
    inp.tactical = this.edge.tactical;
    inp.lethal = this.edge.lethal;
    inp.streak = this.edge.streak;
    this.edge.slide = this.edge.swap = this.edge.tactical = this.edge.lethal = false;
    this.edge.streak = -1;

    // A release beats a press in progress for this frame: the edge and the aim that launched it travel together.
    const released = inp.tactical || inp.lethal;
    if (released) {
      inp.throwAim = this.throwReleased;
      inp.throwDist = this.throwReleased?.dist ?? null;
      this.throwReleased = null;
    } else {
      inp.throwAim = this.#throwAim();
      inp.throwDist = null;
    }

    if (this.throw) this.paintDirty = true;   // The rig keeps animating the hold timer.
    if (this.paintDirty) this.#paint();
    return inp;
  }

  // After the aim thumb lifts the player keeps facing where it pointed, judged from just before the lift, and if moving
  // turns smoothly back to the direction of travel rather than snapping there in one frame.
  #glideAim(mx, mz) {
    const g = this.glide;
    if (!g.on) return null;
    const now = performance.now(), dt = Math.min(0.1, (now - g.last) / 1000);
    g.last = now;
    if (mx * mx + mz * mz <= 0.02) {
      g.on = false;
      return g.aim;
    }
    const delta = wrapAngle(Math.atan2(mz, mx) - g.aim);
    if (Math.abs(delta) < RELEASE_DONE) {
      g.on = false;
      return null;
    }
    g.aim = wrapAngle(g.aim + Math.sign(delta) * Math.min(Math.abs(delta), RELEASE_TURN * dt));
    return g.aim;
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
      const lr = this.leftRadius;
      if (d > lr) { kx *= lr / d; ky *= lr / d; }
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
      if (d > this.knobLimit) { ax *= this.knobLimit / d; ay *= this.knobLimit / d; }
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
    this.#paintThrow();
  }

  // The on-screen half of a controlled throw: a line from the button to the thumb, the range circle and a label.
  // The arc in the world is the renderer's, from view.throwPreview.
  #paintThrow() {
    const g = this.rig, th = this.throw;
    const aim = th ? this.#throwAim() : null;
    const showing = !!th && (th.left || !!aim);
    if (showing !== g.active) {
      g.active = showing;
      // The rig stays laid out and rasterised the whole match; this is an opacity flip, so the first throw of a match
      // costs the same as the hundredth. The other buttons dim one by one, not through a class on their common parent.
      g.el.classList.toggle('on', showing);
      for (const b of BUTTONS) this.buttons[b].classList.toggle('dim', showing && b !== th?.slot);
      if (g.btn) g.btn.classList.remove('aiming', 'throw-cancel');
      g.btn = showing ? this.buttons[th.slot] : null;
      if (g.btn) g.btn.classList.add('aiming');
      g.cancelled = null;
    }
    if (!th || !showing) return;
    const b = g.btn;
    if (th.cancel !== g.cancelled) {
      g.cancelled = th.cancel;
      g.el.classList.toggle('cancel', th.cancel);
      b.classList.toggle('throw-cancel', th.cancel);
    }
    if (g.shownSlot !== th.slot) {
      g.shownSlot = th.slot;
      g.el.style.transform = `translate3d(${th.cx}px,${th.cy}px,0)`;
    }
    const dx = th.left ? th.x - th.cx : 0, dy = th.left ? th.y - th.cy : 0;
    const d = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
    g.line.style.transform = `rotate(${angle.toFixed(3)}rad) scaleX(${Math.max(0, d).toFixed(1)})`;
    g.dot.style.transform = `translate3d(${dx}px,${dy}px,0)`;
    const mode = th.cancel ? 'cancel' : th.left ? 'aim' : 'hold';
    if (mode !== g.shownMode) {
      g.shownMode = mode;
      g.tip.textContent = mode === 'cancel' ? 'Release to cancel' : mode === 'hold' ? 'Drag to aim' : 'Back to cancel';
    }
    const dist = aim ? Math.round(aim.dist * 2) / 2 : NaN;
    if (dist !== g.shownDist) {
      g.shownDist = dist;
      g.dist.textContent = Number.isNaN(dist) ? 'Cancel' : `${dist.toFixed(1)} m`;
    }
    const lx = Math.max(-th.cx + 60, Math.min(dx, this.width - th.cx - 60));
    g.label.style.transform = `translate3d(${lx}px,${dy - 46}px,0) translateX(-50%)`;
  }
}
