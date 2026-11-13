// Motion for every screen and the HUD. Web Animations on transform and opacity only, so the compositor does the work
// and a 60 fps menu stays at 60 fps. Durations and easings mirror css/tokens.css.
//
// Every helper respects prefers-reduced-motion: movement collapses to a short fade or to the final frame, and the
// returned promise still resolves, so callers never need two code paths.

export const DUR = { instant: 70, fast: 140, base: 220, slow: 360, epic: 700, stagger: 35 };
export const EASE = {
  out: 'cubic-bezier(.16,.84,.3,1)',
  in: 'cubic-bezier(.55,0,.85,.35)',
  inout: 'cubic-bezier(.6,0,.3,1)',
  snap: 'cubic-bezier(.3,1.55,.45,1)',
  heavy: 'cubic-bezier(.7,0,.2,1)',
};

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let forced = null;
// True when the player asked for less motion. `setReducedMotion(bool|null)` lets an options toggle override the OS.
export const reducedMotion = () => forced ?? !!mq?.matches;
export const setReducedMotion = v => { forced = v; };

const list = els => {
  if (!els) return [];
  if (typeof els === 'string') return [...document.querySelectorAll(els)];
  if (els instanceof Element) return [els];
  return [...els].filter(Boolean);
};
const done = anim => anim.finished.catch(() => {});

// Plays keyframes, or under reduced motion jumps to the last frame (a fade still fades, briefly).
export function play(el, frames, opts = {}) {
  if (!el?.animate) return Promise.resolve();
  if (reducedMotion()) {
    const last = frames[frames.length - 1] ?? {};
    const fadeOnly = frames.map(f => ('opacity' in f ? { opacity: f.opacity } : {}));
    const fades = fadeOnly.some(f => 'opacity' in f);
    if (!fades) return Promise.resolve();
    return done(el.animate(fadeOnly, { duration: Math.min(opts.duration ?? DUR.base, DUR.fast), fill: opts.fill ?? 'none', easing: 'linear' }))
      .then(() => last);
  }
  return done(el.animate(frames, { duration: DUR.base, easing: EASE.out, fill: 'both', ...opts }));
}

// Entrance poses. Each is [from, to]. `rail` is the house move: a plate sliding in on a track and hitting its stop.
const POSES = {
  up:    [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
  down:  [{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'none' }],
  left:  [{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }],
  right: [{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }],
  rail:  [{ opacity: 0, transform: 'translateX(-40px)' }, { opacity: 1, transform: 'translateX(3px)', offset: .8 }, { opacity: 1, transform: 'none' }],
  scale: [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }],
  stamp: [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(.97)', offset: .6 }, { opacity: 1, transform: 'none' }],
  fade:  [{ opacity: 0 }, { opacity: 1 }],
};

// One element in. kind: up | down | left | right | rail | scale | stamp | fade.
export function enter(el, kind = 'up', { delay = 0, duration = DUR.base, easing } = {}) {
  const frames = POSES[kind] ?? POSES.up;
  return play(el, frames, { delay, duration, easing: easing ?? (kind === 'stamp' ? EASE.snap : EASE.out), fill: 'backwards' });
}

// One element out; resolves when it is gone (the element keeps its final frame until the caller removes it).
export function exit(el, kind = 'fade', { delay = 0, duration = DUR.fast } = {}) {
  const frames = [...(POSES[kind] ?? POSES.fade)].reverse();
  return play(el, frames, { delay, duration, easing: EASE.in, fill: 'forwards' });
}

// The screen's one orchestrated entrance: siblings arrive in order, `step` ms apart, capped so a long list never
// makes the player wait (items past `max` all arrive with the last).
export function stagger(els, kind = 'up', { step = DUR.stagger, delay = 0, duration = DUR.base, max = 10 } = {}) {
  const items = list(els);
  if (reducedMotion()) return Promise.all(items.map(el => enter(el, 'fade', { duration: DUR.fast })));
  return Promise.all(items.map((el, i) => enter(el, kind, { delay: delay + Math.min(i, max) * step, duration })));
}

// Rolls a number from `from` to `to`. Format receives the current value; under reduced motion it lands at once.
// Rolls are tracked per element, so a new roll cancels the old one instead of fighting it.
const rolls = new WeakMap();
export function rollNumber(el, to, { from, duration = DUR.epic, delay = 0, format = n => Math.round(n).toLocaleString('en-US'), onTick } = {}) {
  if (!el) return Promise.resolve();
  const start = from ?? (parseFloat(String(el.textContent).replace(/[^\d.-]/g, '')) || 0);
  const token = {};
  rolls.set(el, token);
  if (reducedMotion() || duration <= 0 || start === to) {
    el.textContent = format(to);
    onTick?.(to, 1);
    return Promise.resolve();
  }
  el.textContent = format(start);
  return new Promise(resolve => {
    const t0 = performance.now() + delay;
    let last = '';
    const frame = now => {
      if (rolls.get(el) !== token || !el.isConnected) return resolve();
      const f = Math.max(0, Math.min(1, (now - t0) / duration)), eased = 1 - (1 - f) ** 4;
      const v = start + (to - start) * eased, text = format(v);
      if (text !== last) { el.textContent = text; last = text; onTick?.(v, f); }   // Only touch the DOM on change.
      if (f < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

// Pressed feedback for something tapped programmatically or a HUD button that tap.js does not handle:
// an instant dip and an eased return. (Buttons handled by tap.js get the .pressed class instead.)
export function press(el, { depth = .93 } = {}) {
  if (!el?.animate || reducedMotion()) return Promise.resolve();
  return done(el.animate([{ transform: 'scale(1)' }, { transform: `scale(${depth})`, offset: .25 }, { transform: 'scale(1)' }],
    { duration: DUR.fast + DUR.instant, easing: EASE.out }));
}

// A quick overshoot: a counter that changed, a tile that became ready.
export function pop(el, { scale = 1.18, duration = DUR.base } = {}) {
  if (!el?.animate || reducedMotion()) return Promise.resolve();
  return done(el.animate([{ transform: `scale(${scale})` }, { transform: 'none' }], { duration, easing: EASE.snap }));
}

// Lamp light crossing a plate: focus, a newly unlocked item, a primary button at rest every few seconds.
// The host needs position:relative and a clip (clip-path or overflow:hidden). Reuses one .fx-sweep child.
export function sweep(el, { delay = 0, duration = DUR.epic } = {}) {
  if (!el || reducedMotion()) return Promise.resolve();
  let s = el.querySelector(':scope > .fx-sweep');
  if (!s) { s = document.createElement('i'); s.className = 'fx-sweep'; s.setAttribute('aria-hidden', 'true'); el.appendChild(s); }
  return done(s.animate([{ transform: 'translateX(-120%) skewX(-12deg)' }, { transform: `translateX(${Math.max(240, el.clientWidth * 2.6)}px) skewX(-12deg)` }],
    { duration, delay, easing: EASE.inout }));
}

// Shake: impacts, a denied tap. Strength in px; decays over the duration. Under reduced motion: nothing.
export function shake(el, { strength = 6, duration = 320, axis = 'x' } = {}) {
  if (!el?.animate || reducedMotion()) return Promise.resolve();
  const n = 7, frames = [];
  for (let i = 0; i <= n; i++) {
    const a = i === n ? 0 : strength * (1 - i / n) * (i % 2 ? -1 : 1);
    frames.push({ transform: axis === 'x' ? `translateX(${a}px)` : axis === 'y' ? `translateY(${a}px)` : `translate(${a}px,${-a * .6}px)` });
  }
  return done(el.animate(frames, { duration, easing: 'linear' }));
}

// Impact flash: a coloured plate over the element that blinks out. The host needs position:relative.
export function flash(el, { color = 'var(--c-white)', peak = .55, duration = DUR.slow } = {}) {
  if (!el) return Promise.resolve();
  let f = el.querySelector(':scope > .fx-flash');
  if (!f) { f = document.createElement('i'); f.className = 'fx-flash'; f.setAttribute('aria-hidden', 'true'); el.appendChild(f); }
  f.style.setProperty('--fx-color', color);
  const p = reducedMotion() ? peak * .5 : peak;
  return done(f.animate([{ opacity: p }, { opacity: 0 }], { duration: reducedMotion() ? DUR.fast : duration, easing: EASE.out }));
}

// Parallax: moves layers against a 0..1 progress (scroll position, carousel index). Depth is px of travel at 1.
// Call from a scroll or rAF handler; it only writes transforms.
export function parallax(layers, progress) {
  if (reducedMotion()) return;
  for (const [el, depth] of layers) if (el) el.style.transform = `translate3d(${(-progress * depth).toFixed(1)}px,0,0)`;
}

// Screen transitions. `screenIn` and `screenOut` move a whole screen; dir 'forward' slides from the right like a
// plate pushed down the line, 'back' from the left. `swapScreens` runs both and resolves when the new one is settled.
export function screenIn(el, { dir = 'forward', delay = 0 } = {}) {
  const x = dir === 'back' ? -36 : 36;
  return play(el, [{ opacity: 0, transform: `translateX(${x}px)` }, { opacity: 1, transform: 'none' }],
    { duration: DUR.slow, delay, easing: EASE.heavy, fill: 'backwards' });
}
export function screenOut(el, { dir = 'forward' } = {}) {
  const x = dir === 'back' ? 28 : -28;
  return play(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${x}px)` }],
    { duration: DUR.fast + 40, easing: EASE.in, fill: 'forwards' });
}
export async function swapScreens(outEl, inEl, opts = {}) {
  if (outEl) await screenOut(outEl, opts);
  if (inEl) await screenIn(inEl, opts);
}

// Full-screen hazard wipe for big context changes (menu to match, match to results). `midway` runs while the screen
// is covered; swap the DOM there. Reduced motion: a plain dark fade.
export async function wipe(midway, { dir = 'forward' } = {}) {
  const w = document.createElement('div');
  w.className = 'fx-wipe';
  w.setAttribute('aria-hidden', 'true');
  document.body.appendChild(w);
  const from = dir === 'back' ? '110%' : '-110%', to = dir === 'back' ? '-110%' : '110%';
  try {
    if (reducedMotion()) {
      w.style.transform = 'none';
      await done(w.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR.fast, fill: 'forwards' }));
      await midway?.();
      await done(w.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR.fast, fill: 'forwards' }));
    } else {
      await done(w.animate([{ transform: `translateX(${from})` }, { transform: 'translateX(0)' }], { duration: DUR.slow, easing: EASE.heavy, fill: 'forwards' }));
      await midway?.();
      await done(w.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${to})` }], { duration: DUR.slow, easing: EASE.heavy, fill: 'forwards' }));
    }
  } finally {
    w.remove();
  }
}

// Cancels every animation this module started on an element (and its fx children), e.g. before a repaint.
export function settle(el) {
  if (!el?.getAnimations) return;
  for (const a of el.getAnimations({ subtree: true })) a.finish?.();
}

// Celebration: a burst of low-poly shards (level up, an unlock). Each shard is one absolutely placed <i> with a
// triangle clip, thrown out from `origin` (fractions of the host's box) on an arc and falling away: transform and
// opacity only, a fixed count, all removed when the longest lands. Reduced motion: no shards (the stamp still plays).
const SHARD_COLORS = ['var(--c-sodium, #f2a63b)', 'var(--c-sodium-hi, #ffd27a)', 'var(--c-chalk, #e9e4d8)', 'var(--c-gold, #ffcf40)', '#7fd0ff'];
const SHARD_CLIPS = ['polygon(50% 0, 100% 100%, 0 80%)', 'polygon(0 0, 100% 30%, 40% 100%)', 'polygon(20% 0, 100% 50%, 0 100%)', 'polygon(0 20%, 100% 0, 70% 100%)'];
export const celebrated = { bursts: 0, shards: 0 };
export function celebrate(host, { count = 24, origin = [0.5, 0.42], spread = 1 } = {}) {
  if (!host || reducedMotion()) return Promise.resolve();
  const box = document.createElement('div');
  box.className = 'fx-shards';
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3;contain:strict;';
  const W = host.clientWidth || 800, H = host.clientHeight || 400;
  const ox = origin[0] * W, oy = origin[1] * H;
  const n = Math.min(40, count), runs = [];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    const size = 7 + Math.random() * 12;
    s.style.cssText = `position:absolute;left:${ox.toFixed(0)}px;top:${oy.toFixed(0)}px;width:${size.toFixed(0)}px;height:${(size * (0.7 + Math.random() * 0.6)).toFixed(0)}px;` +
      `background:${SHARD_COLORS[i % SHARD_COLORS.length]};clip-path:${SHARD_CLIPS[i % SHARD_CLIPS.length]};will-change:transform,opacity;opacity:0;`;
    box.appendChild(s);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5, v = (0.55 + Math.random() * 0.6) * spread;
    const dx = Math.cos(a) * W * 0.32 * v, up = Math.sin(a) * H * 0.3 * v - H * 0.12, fall = H * (0.35 + Math.random() * 0.25);
    const r0 = Math.random() * 360, r1 = r0 + (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 400);
    const dur = 1000 + Math.random() * 600;
    runs.push(done(s.animate([
      { opacity: 1, transform: `translate3d(0,0,0) rotate(${r0}deg) scale(.3)` },
      { opacity: 1, transform: `translate3d(${dx.toFixed(0)}px,${up.toFixed(0)}px,0) rotate(${((r0 + r1) / 2).toFixed(0)}deg) scale(1)`, offset: 0.35 },
      { opacity: 0, transform: `translate3d(${(dx * 1.25).toFixed(0)}px,${(up + fall).toFixed(0)}px,0) rotate(${r1.toFixed(0)}deg) scale(.8)` },
    ], { duration: dur, delay: Math.random() * 90, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'both' })));
  }
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(box);
  celebrated.bursts++; celebrated.shards += n;
  return Promise.all(runs).then(() => box.remove());
}
