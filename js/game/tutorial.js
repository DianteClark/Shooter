// The guided first match: Railyard's middle lane, three targets that stand still, then the same three turned into
// recruit bots for a short live fight. Each prompt advances only when the player has actually done the thing, read
// from the match's own event stream (MatchAwards.observe) and the local input. Solo and host-only; nothing it does is
// paid or recorded (awards and telemetry run with `practice`).
//
// main.js: roster from tutorialRoster(human), beginMatch on TUTORIAL_MAP with TUTORIAL_LIMITS, then
//   new Tutorial({ match, root, audio, onFinish(completed) }).start()  and  dispose()  when the match goes away.
//
// The sim has no tutorial hooks, so the few things it needs are done here from outside, all through the host's Sim:
// the opening spot (Sim._placeAt), a granted UAV (streaks.addScore on the player's streak state), and waking the
// targets (a BotBrain each, as Sim.humanLeft does for a dropped player).
import { normalizeLoadout, LETHALS, TACTICALS } from '../shared/catalog.js';
import { addScore } from '../sim/streaks.js';
import { BotBrain } from '../sim/bots.js';

export const TUTORIAL_MAP = 'railyard';
export const TUTORIAL_MODE = 'tdm';
export const TUTORIAL_LIMITS = { scoreLimit: 99, timeLimit: 600 };

// Railyard's middle lane, west end, looking east down it. Targets stand where the first look finds them: 8, 12 and
// 18 m out, all in plain sight (checked with hasLineOfSight in the tests).
const START = { x: 5, z: 24, aim: 0 };
const TARGETS = [{ x: 13, z: 20.5, aim: Math.PI }, { x: 17, z: 27.3, aim: Math.PI }, { x: 23, z: 24, aim: Math.PI }];
const KIT = { primary: 'ar', secondary: 'pistol', tactical: 'smoke', lethal: 'frag', streaks: ['uav', 'turret', 'strike'], perks: ['marathon', 'scavenger', 'tracker'], attachments: {} };

const MOVE_M = 4;                // Metres walked to pass the move step.
const AIM_S = 0.7;               // Seconds of aim held.
const FIRE_KILLS = 2;
const FIGHT_KILLS = 3;
const FIGHT_S = 90;              // The live fight ends here even without the kills: nobody gets stuck in training.
const OK_MS = 1100;              // How long a step's tick shows before the next prompt.
const DRAG_WINDOW = 1.2;         // Seconds between a dragged release and its throw event.

export function tutorialLoadout(base = {}) {
  return { ...normalizeLoadout({ ...KIT, camo: base.camo }), name: 'Training', camo: base.camo ?? 'none', operator: base.operator, card: base.card, pro: [] };
}

// The player plus three targets on the other side. The targets are range dummies until the fight wakes them.
export function tutorialRoster(human) {
  const loadout = tutorialLoadout(human.loadout);
  const me = { id: human.id, name: human.name, team: 0, isBot: false, skill: null, primary: 'ar', camo: loadout.camo, loadout, badge: human.badge };
  const targets = TARGETS.map((home, i) => ({
    id: `target${i}`, name: `Target ${'ABC'[i]}`, team: 1, isBot: true, skill: 'recruit', dummy: true, home,
    primary: 'ar', camo: 'none', loadout: normalizeLoadout({ primary: 'ar', secondary: 'pistol', lethal: 'frag', tactical: 'smoke' }),
    badge: { prestige: 0, level: 1 },
  }));
  return [me, ...targets];
}

// Steps in order. `zone` places the hint: a stick side or a control's selector.
const STEPS = [
  { id: 'move', title: 'Move', text: 'Drag anywhere on the left half of the screen to walk. Push all the way to sprint.', zone: 'left' },
  { id: 'aim', title: 'Aim', text: 'Touch and hold the right half to aim down sights. Turn toward the targets.', zone: 'right' },
  { id: 'fire', title: 'Fire', text: 'Push past the outer ring to fire. Drop two targets.', zone: 'ring', goal: FIRE_KILLS },
  { id: 'slide', title: 'Slide', text: 'While moving, tap Slide. A slide makes you a smaller target.', zone: '.tbtn-slide' },
  { id: 'throw', title: 'Throw', text: 'Hold Frag, drag away from it to aim the arc, then let go.', zone: '.tbtn-lethal' },
  { id: 'streak', title: 'Scorestreak', text: 'Kills fill your streaks. Your UAV is ready: tap its tile to reveal enemies.', zone: '.st-tile[data-slot="0"]' },
  { id: 'fight', title: 'Live fire', text: 'The targets fight back now. Win the fight: three kills.', zone: null, goal: FIGHT_KILLS },
];

export class Tutorial {
  constructor({ match, root, audio = null, onFinish }) {
    this.match = match;
    this.root = root;
    this.audio = audio;
    this.onFinish = onFinish;
    this.i = -1;
    this.state = 'warmup';      // warmup | step | ok | done
    this.count = 0;
    this.acc = 0;
    this.lastT = null;
    this.lastPos = null;
    this.armedAt = -99;
    this.fightT = 0;
    this.awake = false;
    this.disposed = false;
    this.timer = 0;
    this.onResize = () => this.#placeHint();
  }

  get sim() { return this.match.sim; }
  get me() { return this.sim.byId?.get(this.match.localId) ?? null; }

  start() {
    const m = this.match;
    m.awards.practice = true;
    m.telemetry.practice = true;
    // The sim's opening spawn is random; training always opens in the middle lane looking at the targets.
    const p = this.me;
    if (p && typeof this.sim._placeAt === 'function') this.sim._placeAt(p, START, START.aim);
    m.awards.observe((events, view) => this.#frame(events, view));
    this.#build();
    window.addEventListener('resize', this.onResize);
    this.#show({ title: 'Training', text: 'Targets ahead in the middle lane. Get ready.', step: null });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    window.removeEventListener('resize', this.onResize);
    this.el?.remove();
    this.root.classList.remove('tut-on');
  }

  // ---- Overlay -------------------------------------------------------------------------------------------------
  #build() {
    const el = this.el = document.createElement('div');
    el.className = 'tut';
    el.innerHTML = `
      <div class="tut-card" role="status" aria-live="polite">
        <span class="tut-head"><span class="tut-step"></span><b class="tut-title"></b><span class="tut-count" hidden></span></span>
        <p class="tut-text"></p>
        <span class="tut-dots">${STEPS.map(() => '<i></i>').join('')}</span>
      </div>
      <button class="tut-skip" data-tap="tutSkip" data-sound="back">Skip training</button>
      <div class="tut-hint" hidden><i class="tut-thumb"></i><i class="tut-ringfx"></i></div>
      <div class="tut-target" hidden></div>
      <div class="tut-done" hidden></div>`;
    this.root.appendChild(el);
    this.root.classList.add('tut-on');
    this.card = el.querySelector('.tut-card');
    this.hint = el.querySelector('.tut-hint');
    this.target = el.querySelector('.tut-target');
    el.querySelector('.tut-skip').addEventListener('click', () => this.#end(false));
  }

  #show({ title, text, step }) {
    const c = this.card;
    c.querySelector('.tut-step').textContent = step === null ? 'Training' : `Step ${step + 1} of ${STEPS.length}`;
    c.querySelector('.tut-title').textContent = title;
    c.querySelector('.tut-text').textContent = text;
    c.classList.remove('ok');
    c.querySelectorAll('.tut-dots i').forEach((d, k) => { d.className = step !== null && k < step ? 'on' : k === step ? 'now' : ''; });
    this.#count();
    c.animate?.([{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.16,.84,.3,1)' });
    this.#placeHint();
  }

  #count() {
    const s = STEPS[this.i], el = this.card.querySelector('.tut-count');
    el.hidden = !(this.state === 'step' && s?.goal);
    if (!el.hidden) el.textContent = `${Math.min(this.count, s.goal)} / ${s.goal}`;
  }

  // A ghost thumb on a stick side, or a pulsing ring around the control the step is about.
  #placeHint() {
    const s = this.state === 'step' ? STEPS[this.i] : null;
    const zone = s?.zone ?? null;
    this.hint.hidden = !(zone === 'left' || zone === 'right' || zone === 'ring');
    this.hint.dataset.zone = zone ?? '';
    this.target.hidden = true;
    if (!zone || !zone.startsWith('.')) return;
    const node = this.root.querySelector(`.controls ${zone}`);
    const r = node?.getBoundingClientRect();
    if (!r || !r.width) return;
    const pad = 8;
    Object.assign(this.target.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    this.target.hidden = false;
  }

  // The player tried and it did not count: say why, with a small shake.
  #nudge(text) {
    const el = this.card.querySelector('.tut-text');
    if (el.textContent === text) return;
    el.textContent = text;
    this.card.animate?.([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 260 });
  }

  // ---- Steps ---------------------------------------------------------------------------------------------------
  #next() {
    this.i++;
    this.count = 0; this.acc = 0; this.lastPos = null; this.armedAt = -99; this.dragging = false;
    if (this.i >= STEPS.length) return this.#complete();
    const s = STEPS[this.i];
    this.state = 'step';
    if (s.id === 'streak') this.#grantStreak();
    if (s.id === 'fight') this.#wake();
    this.#show({ title: s.title, text: s.text, step: this.i });
  }

  #pass() {
    if (this.state !== 'step') return;
    this.state = 'ok';
    this.card.classList.add('ok');
    this.card.querySelector('.tut-dots i:nth-child(' + (this.i + 1) + ')')?.classList.add('on');
    this.hint.hidden = true;
    this.target.hidden = true;
    this.audio?.uiSound?.('confirm');
    this.timer = setTimeout(() => { if (!this.disposed) this.#next(); }, OK_MS);
  }

  #complete() {
    this.state = 'done';
    this.audio?.uiSound?.('levelUp');
    const done = this.el.querySelector('.tut-done');
    done.innerHTML = `<b>Training complete</b><small>You are ready for the yard</small>`;
    done.hidden = false;
    this.card.hidden = true;
    done.animate?.([{ opacity: 0, transform: 'translate(-50%,-50%) scale(1.4)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(.97)', offset: .6 }, { opacity: 1, transform: 'translate(-50%,-50%)' }], { duration: 520, easing: 'cubic-bezier(.3,1.55,.45,1)' });
    this.timer = setTimeout(() => this.#end(true), 2200);
  }

  #end(completed) {
    if (this.disposed) return;
    const cb = this.onFinish;
    this.dispose();
    cb?.(completed);
  }

  // Score straight to the first streak's cost: the UAV is held and its tile lights, exactly as if earned.
  #grantStreak() {
    const st = this.me?.score;
    const slot = st?.slots?.[0];
    if (!slot || slot.held) return;
    try { addScore(st, Math.max(0, slot.cost - st.score)); } catch (err) { console.error('tutorial streak', err); }
  }

  // The targets become recruit bots where they stand; from their next death they respawn like anyone.
  #wake() {
    if (this.awake) return;
    this.awake = true;
    for (const p of this.sim.players ?? []) {
      if (!p.dummy) continue;
      p.dummy = false;
      p.home = null;
      p.skill = 'recruit';
      try { p.bot = new BotBrain(this.sim, p, p.index ?? 0); } catch (err) { console.error('tutorial bots', err); }
    }
  }

  // Keeps the frag coming while the throw step waits for a real drag, so a wasted tap never strands the player.
  #refill() {
    const ps = this.me?.ps;
    if (!ps) return;
    if (ps.lethalLeft < 1) ps.lethalLeft = LETHALS[ps.lethal]?.count ?? 1;
    if (ps.tacticalLeft < 1) ps.tacticalLeft = TACTICALS[ps.tactical]?.count ?? 1;
  }

  // Every frame, from inside Match.frame after the awards have seen the events.
  #frame(events, view) {
    if (this.disposed || !view) return;
    const t = view.t ?? 0;
    const dt = this.lastT === null ? 0 : Math.min(0.25, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (this.state === 'warmup') {
      if (view.phase === 'live') this.#next();
      return;
    }
    if (this.state !== 'step') return;
    const id = this.match.localId, s = STEPS[this.i];
    const me = view.players?.find(p => p.id === id);
    const input = this.match.resolvedInput ?? {};
    switch (s.id) {
      case 'move': {
        if (!me?.alive) break;
        if (this.lastPos) {
          const d = Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z);
          if (d < 2) this.acc += d;                      // A bigger jump is a respawn, not a walk.
        }
        this.lastPos = { x: me.x, z: me.z };
        if (this.acc >= MOVE_M) this.#pass();
        break;
      }
      case 'aim':
        if (me?.alive && input.aiming) this.acc += dt;
        if (this.acc >= AIM_S) this.#pass();
        break;
      case 'fire':
      case 'fight':
        for (const e of events) if (e.t === 'kill' && e.by === id && e.target !== id) { this.count++; this.#count(); }
        if (s.id === 'fight') this.fightT += dt;
        if (this.count >= s.goal || (s.id === 'fight' && this.fightT >= FIGHT_S)) this.#pass();
        break;
      case 'slide':
        if (events.some(e => e.t === 'slide' && e.id === id)) this.#pass();
        else if (input.slide && !me?.sliding) this.#nudge('A slide needs speed: run first, then tap Slide while still moving.');
        break;
      case 'throw': {
        this.#refill();
        // A drag leaves the button's arm radius while held (Controls.throw.left); a quick tap or a still hold never does.
        const held = this.match.controls?.throw;
        if (held?.left && !held.cancel) this.dragging = true;
        if ((input.lethal || input.tactical) && input.throwDist != null && this.dragging) this.armedAt = t;
        if (!held) this.dragging = false;
        for (const e of events) {
          if (e.t !== 'throw' || e.id !== id) continue;
          if (t - this.armedAt <= DRAG_WINDOW) { this.#pass(); break; }
          this.#nudge('That was a quick tap: it throws where you face. Now hold the button and drag to aim.');
        }
        break;
      }
      case 'streak':
        if (events.some(e => e.t === 'streak' && e.id === id)) this.#pass();
        else if (me && !this.me?.score?.slots?.some(sl => sl.held)) this.#grantStreak();   // Lost to a death or a refusal: hand it back.
        break;
    }
  }
}
