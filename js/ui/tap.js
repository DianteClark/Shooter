// One touch path for every button in the app.
//
// Native `click` synthesis on iOS is fragile for a game: it is dropped when a touchmove inside the tap is
// default-prevented, and thumbs always produce one; it is dropped when the element is replaced by a repaint
// (lobby and vote repaint under the finger); and it is dropped when the thumb rolls more than a few pixels.
// So a touch-started tap does not depend on it at all: the press is resolved on touchstart, the action fires on
// touchend, and the touchend is default-prevented so that the browser cannot synthesise a second one.
// Mouse clicks and textareas keep their ordinary browser behaviour.

export const TAPPABLE = 'button,[data-act],[data-tap]';
const SLOP = 26;               // A release this far outside the pressed element still counts; thumbs roll.
const MIN_PRESSED_MS = 110;    // A pressed look shorter than this is never seen.
const GHOST_MS = 700;          // A browser click this soon after a handled touch is a duplicate of that touch.
const GHOST_PX = 44;

const presses = new Map();     // touch id -> press
let lastFire = { at: -1e9, x: 0, y: 0 };
let installed = false;
let soundFn = null;            // (kind, el) => void; set by the app with setTapSound. See below.

// Every tap gets a sound. The kind comes from the element: data-sound="back|confirm|deny|tab|tick|none", else
// 'back' for back/close actions, else 'tap'. A tap on a disabled or aria-disabled control plays 'deny'.
export function setTapSound(fn) { soundFn = fn; }
function soundKind(el) {
  const k = el.getAttribute('data-sound');
  if (k) return k;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return 'deny';
  const act = (el.getAttribute('data-act') ?? '') + ' ' + (el.getAttribute('data-tap') ?? '');
  return /\b(back|close|cancel|leave)\b/.test(act) ? 'back' : 'tap';
}
function sound(el, kind = soundKind(el)) {
  if (!soundFn || kind === 'none') return;
  try { soundFn(kind, el); } catch { /* sound must never break a tap */ }
}

// True while a finger is on any button; the preview loop yields the main thread for these moments.
export const fingerDown = () => presses.size > 0;

const usable = el => !!el && el.isConnected && !el.disabled && el.getAttribute('aria-disabled') !== 'true';

// Identifies a button across repaints: same action and same payload means the same button.
function keyOf(el) {
  let key = el.tagName + '|' + (el.getAttribute('data-act') ?? '') + '|' + (el.getAttribute('data-tap') ?? '');
  for (const name of el.getAttributeNames()) if (name.startsWith('data-') && name !== 'data-act' && name !== 'data-tap') key += `|${name}=${el.getAttribute(name)}`;
  return key;
}

function inside(rect, x, y) {
  return x >= rect.left - SLOP && x <= rect.right + SLOP && y >= rect.top - SLOP && y <= rect.bottom + SLOP;
}

function setPressed(p, on) {
  if (on) {
    p.el.classList.add('pressed');
    return;
  }
  const el = p.el, left = MIN_PRESSED_MS - (performance.now() - p.at);
  if (left <= 0) el.classList.remove('pressed');
  else setTimeout(() => el.classList.remove('pressed'), left);
}

// A lobby or vote repaint may have swapped the element while the finger was down.
function current(p) {
  if (p.el.isConnected) return p.el;
  const hit = document.elementFromPoint(p.x, p.y)?.closest(TAPPABLE);
  if (hit && keyOf(hit) === p.key) {
    p.el = hit;
    hit.classList.add('pressed');
    return hit;
  }
  return null;
}

// A press whose finger is in no touch list any more lost its touchend (iOS drops them when a system gesture takes the
// finger). Left in place it would keep fingerDown() true for good, and the menu turntables would never draw again.
function prune(touches) {
  for (const [id, p] of presses) {
    let alive = false;
    for (let i = 0; i < touches.length; i++) if (touches[i].identifier === id) { alive = true; break; }
    if (!alive) { presses.delete(id); setPressed(p, false); }
  }
}

// Shown on screen: a control hidden while the finger was down (the respawn picker as the player comes back) must not
// fire when that finger lifts.
const shown = el => el.getClientRects().length > 0;

function start(e) {
  if (presses.size) prune(e.touches);
  for (const t of e.changedTouches) {
    const target = t.target?.nodeType === 1 ? t.target : t.target?.parentElement;
    const el = target?.closest?.(TAPPABLE);
    if (el?.isConnected && !usable(el)) { sound(el, 'deny'); continue; }
    if (!usable(el) || el.tagName === 'TEXTAREA') continue;
    const r = el.getBoundingClientRect();
    const p = { el, key: keyOf(el), x: t.clientX, y: t.clientY, rect: r, at: performance.now(), over: true };
    presses.set(t.identifier, p);
    setPressed(p, true);
  }
}

function move(e) {
  for (const t of e.changedTouches) {
    const p = presses.get(t.identifier);
    if (!p) continue;
    p.x = t.clientX; p.y = t.clientY;
    const over = inside(p.rect, p.x, p.y);
    if (over === p.over) continue;
    p.over = over;
    p.el.classList.toggle('pressed', over);
  }
}

function end(e) {
  for (const t of e.changedTouches) {
    const p = presses.get(t.identifier);
    if (!p) continue;
    presses.delete(t.identifier);
    p.x = t.clientX; p.y = t.clientY;
    const el = current(p);
    if (!el) continue;
    const over = inside(p.rect, p.x, p.y) || inside(el.getBoundingClientRect(), p.x, p.y);
    setPressed(p, false);
    if (!over || !usable(el) || !shown(el)) continue;
    if (e.cancelable) e.preventDefault();
    lastFire = { at: performance.now(), x: p.x, y: p.y };
    el.click();
  }
}

function cancel(e) {
  for (const t of e.changedTouches) {
    const p = presses.get(t.identifier);
    if (!p) continue;
    presses.delete(t.identifier);
    setPressed(p, false);
  }
}

function dropGhost(e) {
  if (e.isTrusted) {
    const near = Math.abs(e.clientX - lastFire.x) < GHOST_PX && Math.abs(e.clientY - lastFire.y) < GHOST_PX;
    if (near && performance.now() - lastFire.at < GHOST_MS) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
  }
  // Both the touch path (el.click()) and a real mouse click arrive here exactly once per tap.
  const t = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
  const el = t?.closest?.(TAPPABLE);
  if (el && el.tagName !== 'TEXTAREA') sound(el);
}

export function installTaps(target = window) {
  if (installed) return;
  installed = true;
  target.addEventListener('touchstart', start, { passive: true, capture: true });
  target.addEventListener('touchmove', move, { passive: true, capture: true });
  target.addEventListener('touchend', end, { passive: false, capture: true });
  target.addEventListener('touchcancel', cancel, { passive: true, capture: true });
  target.addEventListener('click', dropGhost, { capture: true });
}
