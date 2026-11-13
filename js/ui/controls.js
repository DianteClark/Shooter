import { STREAKS, STREAK_DENY_TEXT, TACTICALS, LETHALS } from '../shared/catalog.js';
import { icon } from './icons.js';
import { AimFilter, wrapAngle } from './aimfilter.js';
import { TUNING, onTune } from '../shared/tuning.js';
import { mountTuner } from './tuner.js';
import { viewport, safeInsets } from './viewport.js';
import { placeControls, scaleOf } from './layout.js';

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
const THROW_HOLD_MS = 160;      // A press shorter than this, without leaving the button, is a quick throw.
const MISSING_DROP_MS = 250;    // How long a held finger must go unseen in every touch list before it is let go.
const THROW_GRACE_MS = 400;     // After a throw lets go, the move thumb keeps a held throw's patience this long.
const MISS_LISTS = 3;           // Touch lists in a row that must leave a quiet stick finger out before it is let go.
const TAKEOVER_MS = 120;        // A new thumb on a stick whose finger has gone unseen this long takes the stick at once.
// The move stick through a touchcancel that follows another finger's release (see #end). The owner's recording shows it
// frame by frame: Frag lets go in one frame, the move stick goes idle in the next, before the grenade even leaves the
// hand, and the thumb that is still on the glass gets nothing back until it is lifted and put down again. That second
// event is iOS cancelling the remaining thumb, and iOS sends nothing more for a touch it has cancelled, so letting go of
// the stick there can never be undone. Inside this window the stick is kept instead.
const COLLATERAL_MS = 150;
const HOLD_MAX_MS = 1500;       // A kept stick that nothing confirms is let go of after this long (it walks on by itself
                                // until then if the thumb was really lifted, so this is kept short).
// A touchend for a stick finger whose own touch list still names it. Older code trusted the list and kept the stick, but
// iOS can keep sending that stale list on every later event from the other thumb, so the stick never let go: the player
// walked on by itself and a re-planted thumb only became a spare. Now the list alone proves nothing for such a finger;
// only a move of its own does, and without one inside this window the stick is let go of (and picked up again by the
// finger's next move, from the same base).
const SUSPECT_MS = 180;
const THROW_ARM_PX = 30;        // Radius around the button's centre: leaving it starts the aim, returning cancels.
const THROW_FULL_PX = 118;      // Drag distance from the button centre that means full range.
const THROW_MIN_M = 2.5;        // Shortest aimed toss; a drag that barely clears the button is a lob at your feet.
const THROW_BASE_M = 13;
const THROW_STRONG_M = 19;
const THROW_HELD_M = 9;         // Range when the button is held but never dragged.

const MOVE_ZONE_PAD = 6;        // The move rim's edge and shadow, past its radius.
const AIM_ZONE_PAD = 18;        // The aim ring's ticks reach 15 px past the ring.

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

const nodeName = n => (n?.nodeType === 1 ? n.tagName.toLowerCase() + (n.classList[0] ? '.' + n.classList[0] : '') : String(n?.nodeName ?? n));

// A HUD element with its own tap, still on screen. Hidden ones (the respawn picker once the player is back) do not
// count: a thumb that landed on one keeps playing.
function hudTap(target) {
  const el = target?.closest?.('[data-tap]');
  return !!el && el.getClientRects().length > 0;
}
const onTuner = target => !!target?.closest?.('.tuner');

function inList(list, id) {
  for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return true;
  return false;
}

function freshInput() {
  return { mx: 0, mz: 0, aim: null, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1, throwAim: null, throwDist: null, reload: false, melee: false };
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
    this.seen = { left: 0, right: 0 };      // When each stick's finger last appeared in any touch list.
    this.miss = { left: null, right: null };  // Per stick: the run of touch lists that left its finger out ({ at, n }).
    this.throwEndAt = -Infinity;   // Event time the last throw finger let go (see #reconcile).
    this.lastRelease = -Infinity;  // Event time of the last finger lifted normally (touchend), whoever held it.
    this.hold = null;              // { at, id } while the move stick is kept through a cancel right after a release.
    this.suspect = new Map();      // stick touch id -> event time of a touchend its own touch list contradicted.
    this.buttonSeen = new Map();   // touch id -> when that button finger last appeared in a touch list.
    this.buttonMiss = new Map();   // touch id -> touch lists in a row that left that button finger out.
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
    this.layout = {};              // Options.layout: the touch layout editor's places and sizes (js/ui/layout.js).
    this.placement = null;         // placeControls' last result: boxes and conflicts, for the tests.
    this.buttonTouch = new Map();  // touch id -> button or tile name
    // iOS's touch stream is not always whole (see #adopt). These two let a finger it lost track of be picked up again.
    this.lost = new Map();         // touch id -> { side, ox, oz }: a stick let go of without that finger's touchend
    this.spare = new Map();        // touch id -> 'stick' | 'button': fingers that hold nothing. A 'stick' spare (a second
                                   // finger beside a held stick) takes that stick when it frees up; a 'button' one never does.
    this.watched = new WeakSet();  // Touch targets with listeners of their own; see #watch.
    this.debug = null;             // (text) => void while the touch debug overlay is on (js/ui/touchdebug.js).
    this.pad = null;               // js/ui/gamepad.js: merges a controller into read()'s Input.
    this.tiles = [];               // Cached display state per streak tile, so writes happen only on change.
    this.equip = { tactical: { kind: '', left: NaN }, lethal: { kind: '', left: NaN } };
    this.scoreCache = { score: NaN, capped: null };
    this.rects = {};
    this.width = viewport().w || window.innerWidth;
    this.paintDirty = true;
    this.last = { lx: NaN, ly: NaN, rx: NaN, ry: NaN, kx: NaN, ky: NaN, lkx: NaN, lky: NaN, la: false, ra: false, hot: false, sprint: false };

    this.#build();
    this.#applyTuning();
    onTune(key => { if (key === null || key === 'fireRing' || key === 'leftSize') this.#applyTuning(); });
    this.tuner = mountTuner(this.root);
    this.handled = new WeakSet();  // Events the window listeners took, so a node listener never runs one twice.
    this.onTouchStart = e => { this.handled.add(e); this.#start(e); };
    this.onTouchMove = e => { this.handled.add(e); this.#move(e); };
    this.onTouchEnd = e => { this.handled.add(e); this.#end(e); };
    // An event whose target has left the document travels to that node alone: it never reaches window. These run only
    // for such events; while the target is attached the window listeners above have them.
    this.onDetached = e => {
      // A target removed while its own event was on the way reaches here after window already had it.
      if (e.target?.isConnected !== false || this.handled.has(e)) return;
      this.debug?.(`detached ${e.type} on ${nodeName(e.target)}`);
      if (e.type === 'touchmove') this.#move(e);
      else this.#end(e);
    };
    const opts = { passive: false, capture: true };
    window.addEventListener('touchstart', this.onTouchStart, opts);
    window.addEventListener('touchmove', this.onTouchMove, opts);
    window.addEventListener('touchend', this.onTouchEnd, opts);
    window.addEventListener('touchcancel', this.onTouchEnd, opts);
    window.addEventListener('resize', () => this.remeasure());
    window.addEventListener('orientationchange', () => this.remeasure());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      this.debug?.('release: page hidden');
      this.#release();
    });
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
        <span class="tbtn-icon" style="display:contents">${icon(EMPTY_ICON[b] ?? b)}</span>
        <span class="tbtn-label">${LABELS[b]}</span>
        ${b in EMPTY_ICON ? '<b class="tbtn-count">0</b>' : ''}
      </button>`).join('')}
      <div class="streaks">
        <div class="stk-row">
        <div class="st-score"><span>Score</span><b>0</b></div>
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
    const ring = TUNING.fireRing / this.sensitivity * scaleOf(this.layout, 'aim');
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

    const lr = this.leftRadius = TUNING.leftSize * scaleOf(this.layout, 'move');
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

  // Options > Accessibility > Touch layout: where each control sits and how big it is. Sticks grow their ring with
  // their size (the move stick's travel to full speed, the aim ring's travel to fire), buttons and tiles only their face.
  applyLayout(layout) {
    this.layout = layout && typeof layout === 'object' ? layout : {};
    this.#applyTuning();
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
    this.width = viewport().w || window.innerWidth;
    // Custom places first (or the CSS defaults back), so the rects below are where the controls really are.
    const ins = safeInsets();
    this.placement = placeControls(this.el, this.layout, {
      W: this.width, H: viewport().h || window.innerHeight, lefty: this.lefty,
      safe: { t: ins.top, r: ins.right, b: ins.bottom, l: ins.left },
      radius: { move: this.leftRadius + MOVE_ZONE_PAD, aim: this.fireRing + 15 },
    });
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
    this.#measureZones();
    this.paintDirty = true;
  }

  // Where each stick rests, as a circle the HUD keeps clear of: the move rim, and the aim ring with its ticks. The
  // sizes follow the tuning (leftSize, fireRing) and the sensitivity option. Measured with the rects, never per frame.
  #measureZones() {
    const l = this.restLeft, r = this.restRight;
    if (!l || !r) return;
    this.zones = {
      move: { x: l.x, y: l.y, r: this.leftRadius + MOVE_ZONE_PAD },
      aim: { x: r.x, y: r.y, r: this.fireRing + AIM_ZONE_PAD },
    };
  }

  // Stick zones and touch rects for a layout pass (js/ui/hud.js layout): measured now, whether or not a match is on.
  geometry() {
    this.#measure();
    return { zones: this.zones, rects: this.rects };
  }

  setEnabled(on) {
    if (this.enabled !== on) this.debug?.(on ? 'controls on' : 'controls off (release)');
    this.enabled = on;
    this.el.classList.toggle('live', on);
    this.tuner.setLive(on);
    if (on) {
      this.#calm();
      this.#measure();
    } else {
      this.#release();
    }
  }

  // A focused field or a live text selection arms iOS's editing gestures (three-finger undo and the edit menu), which
  // take every finger on the glass with a touchcancel. Nothing in a match is editable, so neither may outlive a menu.
  #calm() {
    const a = document.activeElement;
    if (a && a !== document.body && typeof a.blur === 'function') a.blur();
    try { document.getSelection()?.removeAllRanges(); } catch { /* nothing selected */ }
  }

  // Who holds a finger, for the touch debug overlay: L, R, throw:<slot>, btn:<name>, spare, lost:<side> or ''.
  ownerOf(id) {
    if (id === this.left.id) return 'L';
    if (id === this.right.id) return 'R';
    if (this.throw?.id === id) return `throw:${this.throw.slot}`;
    const b = this.buttonTouch.get(id);
    if (b) return `btn:${b}`;
    const lost = this.lost.get(id);
    if (lost) return `lost:${lost.side === 'left' ? 'L' : 'R'}`;
    const spare = this.spare.get(id);
    if (spare) return spare === 'stick' ? 'spare' : 'spare:btn';
    return '';
  }

  // Ids this layer believes are down, for the overlay to flag the ones no touch list mentions any more.
  heldIds() {
    const out = [];
    if (this.left.id !== null) out.push(this.left.id);
    if (this.right.id !== null) out.push(this.right.id);
    for (const id of this.buttonTouch.keys()) out.push(id);
    return out;
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
      // Into a stable wrapper: nothing under a finger is ever replaced, only its contents.
      b.querySelector('.tbtn-icon').innerHTML = icon(kind);
      b.querySelector('.tbtn-label').textContent = which === 'lethal' && this.detonate ? 'Detonate' : (which === 'tactical' ? TACTICALS : LETHALS)[kind]?.name ?? kind;
    }
    if (e.left !== left) {
      e.left = left;
      b.querySelector('.tbtn-count').textContent = left ?? 0;
      b.classList.toggle('empty', !left);
    }
  }

  // Satchel: with one armed on the map, Lethal is the detonator: an instant press, relabelled, lit red.
  setDetonate(on) {
    on = !!on;
    if (this.detonate === on) return;
    this.detonate = on;
    const b = this.buttons.lethal, e = this.equip.lethal;
    b.classList.toggle('detonate', on);
    b.querySelector('.tbtn-label').textContent = on ? 'Detonate' : (LETHALS[e.kind]?.name ?? e.kind);
  }

  // Blackout: both equipment buttons go dim while the player's kit is jammed (the host refuses throws anyway).
  setJammed(on) {
    on = !!on;
    if (this.jammed === on) return;
    this.jammed = on;
    this.buttons.tactical.classList.toggle('dim', on);
    this.buttons.lethal.classList.toggle('dim', on);
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

  // Per finger, never per event: one event may carry a HUD tap and a stick finger at once.
  #start(e) {
    if (!this.enabled) return;
    const at = e.timeStamp;
    this.#seeList(e.touches, at);
    this.#reconcile(e.touches, at);
    this.#revive(e.touches, at);
    let ours = false, tuner = false;
    for (const t of e.changedTouches) {
      if (onTuner(t.target)) { tuner = true; continue; }   // The tuning panel's own touches; it never covers the screen.
      if (hudTap(t.target)) continue;                       // HUD elements with their own taps (mic, weapon picker).
      ours = true;
      this.#watch(t.target);
      // iOS reuses identifiers: a "new" finger with an id still in use means the old one ended without telling us.
      this.#forgetStale(t.identifier);
      this.lost.delete(t.identifier);
      this.spare.delete(t.identifier);
      const x = t.clientX, y = t.clientY;
      const btn = this.#buttonAt(x, y);
      if (btn) {
        this.#press(btn, t.identifier, at);
        this.buttonTouch.set(t.identifier, btn);
        this.buttonSeen.set(t.identifier, at);
        this.hintEl.hidden = true;
        continue;
      }
      if ((x < this.width / 2) !== this.lefty) {
        if (this.left.id !== null && this.#gone('left', e.touches, at)) this.#takeOver('left', at);
        if (this.left.id === null) this.#grabLeft(t.identifier, x, y, at);
        else this.#keep(this.spare, t.identifier, 'stick');
      } else {
        if (this.right.id !== null && this.#gone('right', e.touches, at)) this.#takeOver('right', at);
        if (this.right.id === null) this.#grabRight(t.identifier, x, y, at);
        else this.#keep(this.spare, t.identifier, 'stick');
      }
    }
    this.#follow(e, at);
    if (ours && !tuner) {
      e.preventDefault();
      // A focused field arms iOS's three-finger editing gestures; a match never has one.
      if (document.activeElement && document.activeElement !== document.body) this.#calm();
    }
  }

  // A stick whose finger is missing from this list and has not been seen for a moment: the thumb was lifted without
  // its touchend reaching us (a system gesture took it), and the thumb landing now is the same thumb, re-planted.
  #gone(side, touches, at) {
    const id = this[side].id;
    // A stick kept through a cancel has no finger iOS will report: the next thumb on that side takes it at once.
    // Likewise one whose touchend arrived (see SUSPECT_MS) or that was kept through a cancel: its list entries are stale.
    if (this.suspect.has(id) || (side === 'left' && this.hold)) return true;
    return !inList(touches, id) && at - this.seen[side] >= TAKEOVER_MS;
  }

  #takeOver(side, at) {
    this.debug?.(`${side === 'left' ? 'L' : 'R'} #${this[side].id} unseen ${Math.round(at - this.seen[side])}ms: new thumb takes it`);
    this.#drop(this[side].id, at, true);
  }

  // A touch target that leaves the document takes the rest of its finger's events with it (see onDetached), so each
  // one gets listeners of its own, once.
  #watch(target) {
    if (!target || typeof target.addEventListener !== 'function' || this.watched.has(target)) return;
    this.watched.add(target);
    const opts = { passive: false };
    target.addEventListener('touchmove', this.onDetached, opts);
    target.addEventListener('touchend', this.onDetached, opts);
    target.addEventListener('touchcancel', this.onDetached, opts);
  }

  // Bounded: a finger whose touchend iOS never sent must not leave an entry behind for the rest of the session.
  #keep(map, id, value) {
    if (map.size >= 16) map.delete(map.keys().next().value);
    map.set(id, value);
  }

  // A finger reporting a move that holds nothing. iOS sends these in three ways, and each used to leave the stick dead
  // under a thumb that was still on the glass, typically right as a throw is released:
  //  - its touchstart was never delivered (WebKit drops a touchstart that lands in the same instant another finger
  //    lifts, such as the thumb re-planting as the grenade finger lets go);
  //  - the stick was let go of by inference (a finger unseen in touch lists, an identifier that looked reused, a
  //    touchcancel) and the finger then kept moving, which proves it was there all along;
  //  - it landed beside a held stick (a spare), and that stick has since been let go of.
  // A lost stick resumes with its own base; any other finger takes a free stick from where it is now, never a button.
  #adopt(t, at) {
    const id = t.identifier, x = t.clientX, y = t.clientY;
    if (this.buttonTouch.has(id) || this.spare.get(id) === 'button') return;
    if (onTuner(t.target) || hudTap(t.target)) return;
    const was = this.lost.get(id);
    this.lost.delete(id);
    if (was) {
      if (was.side === 'left' && this.left.id === null) {
        this.#grabLeft(id, was.ox, was.oz, at);
        this.left.x = x; this.left.y = y;
        this.debug?.(`L picked up again by #${id}`);
      } else if (was.side === 'right' && this.right.id === null) {
        this.#grabRight(id, was.ox, was.oz, at);
        this.#aimMove(x, y, at);
        this.debug?.(`R picked up again by #${id}`);
      } else {
        this.#keep(this.spare, id, 'stick');
      }
      return;
    }
    const spare = this.spare.has(id);
    if (!spare && this.#buttonAt(x, y)) return this.#keep(this.spare, id, 'button');
    const leftSide = (x < this.width / 2) !== this.lefty;
    if (leftSide && this.left.id === null) {
      this.spare.delete(id);
      this.#grabLeft(id, x, y, at);
      this.debug?.(`L taken by ${spare ? 'spare' : 'unseen'} #${id}`);
    } else if (!leftSide && this.right.id === null) {
      this.spare.delete(id);
      this.#grabRight(id, x, y, at);
      this.debug?.(`R taken by ${spare ? 'spare' : 'unseen'} #${id}`);
    } else if (!spare) {
      this.#keep(this.spare, id, 'stick');
    }
  }

  #forgetStale(id) {
    if (id === this.left.id || id === this.right.id || this.buttonTouch.has(id)) {
      this.debug?.(`#${id} reused while held: old finger dropped`);
      this.#drop(id, performance.now(), true);
    }
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
    if (INSTANT.has(e.kind) || (slot === 'lethal' && this.detonate)) return false;
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
    this.throwEndAt = at;
    this.paintDirty = true;
    if (th.cancel) return;
    const aimed = this.#throwAim(th, at);
    this.edge[th.slot] = true;
    this.throwReleased = aimed ? { ...aimed } : null;   // null means a quick tap: current aim at default range.
  }

  #grabLeft(id, x, y, at = performance.now()) {
    const l = this.left;
    this.seen.left = at;
    this.hold = null;
    this.suspect.delete(id);
    l.id = id; l.ox = x; l.oz = y; l.x = x; l.y = y;
    this.miss.left = null;
    this.paintDirty = true;
  }

  #grabRight(id, x, y, t) {
    const r = this.right;
    this.seen.right = t;
    this.suspect.delete(id);
    r.id = id; r.ox = x; r.oz = y; r.x = x; r.y = y;
    this.miss.right = null;
    r.aim = null; r.firing = false;
    this.aimFilter.reset();
    this.aimFilter.push(0, 0, t);
    this.glide.on = false;
    this.paintDirty = true;
  }

  #move(e) {
    if (!this.enabled) return;
    const at = e.timeStamp;
    this.#seeList(e.touches, at);
    this.#reconcile(e.touches, at);
    this.#revive(e.touches, at);
    this.#unswap(e.changedTouches);
    let tuner = false;
    for (const t of e.changedTouches) {
      const id = t.identifier;
      if (id === this.left.id) {
        this.#confirm('left', id, at);
        this.left.x = t.clientX;
        this.left.y = t.clientY;
        this.paintDirty = true;
      } else if (id === this.right.id) {
        this.#confirm('right', id, at);
        this.#aimMove(t.clientX, t.clientY, at);
      } else if (this.throw?.id === id) {
        this.#throwMove(t.clientX, t.clientY);
      } else if (onTuner(t.target)) {
        tuner = true;
      } else {
        this.#adopt(t, at);
      }
    }
    this.#follow(e, at);
    if (!tuner && e.cancelable) e.preventDefault();
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
    if (e.cancelable && !hudTap(e.target) && !onTuner(e.target)) e.preventDefault();
    const at = e.timeStamp, cancelled = e.type === 'touchcancel';
    if (cancelled) this.debug?.(`touchcancel ${[...e.changedTouches].map(t => `#${t.identifier}`).join(' ')}`);
    for (const t of e.changedTouches) {
      const id = t.identifier;
      // An event that ends a stick finger while its own list still names it contradicts itself: the finger is down.
      if ((id === this.left.id || id === this.right.id) && inList(e.touches, id) && !this.suspect.has(id)) {
        this.suspect.set(id, performance.now());
        this.debug?.(`${e.type} for #${id}, still listed: kept until it moves`);
        continue;
      }
      // iOS cancelling the move thumb just after another finger lifted (a grenade released, a button let go). The thumb
      // is still down, and no event will ever say so again: keep the stick as it is. See COLLATERAL_MS.
      if (cancelled && id === this.left.id && at - this.lastRelease <= COLLATERAL_MS && !document.hidden) {
        this.hold = { at: performance.now(), id };   // Page clock: read() times it out against performance.now().
        this.debug?.(`L #${id} kept through a touchcancel ${Math.round(at - this.lastRelease)}ms after a release`);
        continue;
      }
      this.#drop(id, at, cancelled);
    }
    if (!cancelled) this.lastRelease = at;
    this.#seeList(e.touches, at);
    this.#revive(e.touches, at);
    this.#follow(e, at);
  }

  // cancelled: the system took the finger, or it was found to be gone. Nothing it was doing should fire.
  // A stick dropped that way is remembered, so that a later move from the same finger picks it up again (#adopt).
  #drop(id, at = performance.now(), cancelled = false) {
    if (!cancelled) { this.lost.delete(id); this.spare.delete(id); }
    // A finger whose list entries were found stale may only come back by moving, never by being listed (#revive).
    const moveOnly = this.suspect.delete(id) || (id === this.left.id && !!this.hold);
    if (id === this.left.id) {
      if (cancelled) this.#keep(this.lost, id, { side: 'left', ox: this.left.ox, oz: this.left.oz, moveOnly });
      this.left.id = null;
      this.hold = null;
      this.sprintOn = false;
      this.paintDirty = true;
    } else if (id === this.right.id) {
      if (cancelled) this.#keep(this.lost, id, { side: 'right', ox: this.right.ox, oz: this.right.oz, moveOnly });
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
        this.buttonSeen.delete(id);
        this.buttonMiss.delete(id);
        if (cancelled) this.#keep(this.spare, id, 'button');   // A button finger that turns out to be alive stays a button press.
      }
    }
  }

  // A stick finger that moved: alive beyond doubt, whatever was believed about it.
  #confirm(side, id, at) {
    this.seen[side] = at;
    if (this.suspect.delete(id)) this.debug?.(`${side === 'left' ? 'L' : 'R'} #${id} moved after its touchend: kept`);
    if (side === 'left' && this.hold) { this.hold = null; this.debug?.(`L #${id} moved after a cancel: kept`); }
  }

  // Every touch event carries where every finger is, not only the ones it is about. A stick finger that iOS leaves out
  // of changedTouches (coalesced moves, or moves folded into another finger's event while a grenade is aimed) still
  // shows its new place in the list, so the stick follows the thumb from any event. A list entry that has moved is also
  // proof of life for a stick kept through a cancel or a contradicted touchend: stale lists repeat old places exactly.
  #follow(e, at) {
    const touches = e.touches, changed = e.changedTouches;
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i], id = t.identifier;
      const side = id === this.left.id ? 'left' : id === this.right.id ? 'right' : null;
      if (!side || inList(changed, id)) continue;
      const s = this[side];
      if (Math.abs(t.clientX - s.x) < 0.5 && Math.abs(t.clientY - s.y) < 0.5) continue;
      this.#confirm(side, id, at);
      if (side === 'left') { s.x = t.clientX; s.y = t.clientY; this.paintDirty = true; }
      else this.#aimMove(t.clientX, t.clientY, at);
    }
  }

  // Every finger named in a touch list is alive right now.
  #seeList(touches, at) {
    const l = this.left.id, r = this.right.id;
    for (let i = 0; i < touches.length; i++) {
      const id = touches[i].identifier;
      // Listed: alive, unless this finger's list entries are already known to be stale (a contradicted touchend, or a
      // stick kept through a cancel). Those count only by moving (#confirm).
      if (this.suspect.has(id) || (id === l && this.hold)) continue;
      if (id === l) this.seen.left = at;
      else if (id === r) this.seen.right = at;
      else if (this.buttonSeen.has(id)) this.buttonSeen.set(id, at);
    }
  }

  // iOS can lose a touchend when a system gesture steals a finger, and then sends nothing more for it: a stick left held
  // by such a finger walks the player on by itself and refuses the thumb that comes back. So a held finger that goes
  // unseen in every touch list for MISSING_DROP_MS is let go of (as cancelled, so a later move can still reclaim it).
  // Any event's list counts: with two thumbs down, moves arrive constantly. One odd list changes nothing.
  #reconcile(touches, at) {
    const check = side => {
      const id = this[side].id;
      if (id === null) return;
      const ended = this.suspect.get(id);
      if (ended !== undefined) {
        if (performance.now() - ended < SUSPECT_MS) return;
        this.debug?.(`${side === 'left' ? 'L' : 'R'} #${id} ended and never moved again: let go`);
        this.#drop(id, at, true);
        return;
      }
      if (inList(touches, id)) { this.miss[side] = null; return; }
      // A stick kept through a cancel is missing from every list by definition; only a new thumb, its own end or
      // HOLD_MAX_MS let go of it.
      if (side === 'left' && this.hold) return;
      // One list that leaves the finger out proves nothing. A perfectly still thumb (held at full sprint) sends no events
      // of its own, so "unseen for a while" is always true of it; iOS then leaving it out of the touchstart of a grenade
      // press used to drop the stick on that one list, and the player stopped dead mid-throw. Now the finger must be
      // left out of MISS_LISTS lists in a row, or of every list for MISSING_DROP_MS. While a throw is held, and for
      // THROW_GRACE_MS after it lets go, the move thumb is only let go of after HOLD_MAX_MS of lists without it: that is
      // when iOS sends its odd lists, and a new thumb on the left still takes the stick at once (#gone).
      const miss = this.miss[side] ??= { at, n: 0 };
      miss.n++;
      if (at - this.seen[side] < MISSING_DROP_MS) return;
      if (side === 'left' && (this.throw || at - this.throwEndAt < THROW_GRACE_MS)) {
        if (at - miss.at < HOLD_MAX_MS) return;
      } else if (miss.n < MISS_LISTS && at - miss.at < MISSING_DROP_MS) return;
      this.debug?.(`${side === 'left' ? 'L' : 'R'} #${id} unseen ${Math.round(at - this.seen[side])}ms: let go`);
      this.#drop(id, at, true);
    };
    check('left');
    check('right');
    // A held button (a grenade being aimed) is judged the same way: one odd list must not cancel a throw.
    for (const [id, seenAt] of this.buttonSeen) {
      if (inList(touches, id)) { this.buttonMiss.delete(id); continue; }
      const n = (this.buttonMiss.get(id) ?? 0) + 1;
      this.buttonMiss.set(id, n);
      if (n >= MISS_LISTS && at - seenAt >= MISSING_DROP_MS) {
        this.debug?.(`btn #${id} unseen: let go`);
        this.#drop(id, at, true);
      }
    }
  }

  // A finger in the live list that a stick was let go of by inference takes its stick back at once, moving or not.
  #revive(touches, at) {
    if (!this.lost.size) return;
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const lost = this.lost.get(t.identifier);
      if (lost && !lost.moveOnly) this.#adopt(t, at);
    }
  }

  #release() {
    this.left.id = null;
    this.hold = null;
    this.right.id = null;
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
    this.buttonSeen.clear();
    this.buttonMiss.clear();
    this.miss.left = this.miss.right = null;
    this.lost.clear();              // Nothing is picked up again across a pause or a match boundary.
    this.suspect.clear();
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
      inp.reload = inp.melee = false;
      return inp;
    }

    const l = this.left;
    if (this.hold && performance.now() - this.hold.at > HOLD_MAX_MS) {
      this.debug?.(`L #${l.id} kept ${HOLD_MAX_MS}ms with no sign of the thumb: let go`);
      this.#drop(l.id, performance.now(), true);
    }
    // A stick whose touchend arrived and that has not moved since: let go even if no other finger sends an event.
    if (this.suspect.size) {
      const now = performance.now();
      for (const side of ['left', 'right']) {
        const id = this[side].id, ended = id === null ? undefined : this.suspect.get(id);
        if (ended !== undefined && now - ended >= SUSPECT_MS) {
          this.debug?.(`${side === 'left' ? 'L' : 'R'} #${id} ended and never moved again: let go`);
          this.#drop(id, now, true);
        }
      }
    }
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
    inp.reload = inp.melee = false;
    // A game controller (js/ui/gamepad.js) writes into the same Input, on top of whatever the thumbs are doing.
    this.pad?.merge(inp);
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
