// Native scrolling for the app's lists.
//
// The app blocks every page gesture (main.js blockIosGestures), so for years each list moved itself on touchmove, which
// tracks a frame or two behind the thumb and has no momentum. Lists now scroll natively instead: an element with the
// class `scroll-y` (or `scroll-x`) gets `touch-action: pan-y` and `overscroll-behavior: contain` (css/tokens.css), and
// the page-level touchmove guard lets a touch that started inside one through, as long as the list can actually move.
// The compositor then tracks the thumb 1:1, flings and rubber-bands at the list's own edges, all off the main thread,
// while the page itself still never bounces.
//
// Taps must never fire from a scroll: tap.js asks `scrollerOf` whether a pressed button sits in a list, drops the press
// once the thumb travels past SCROLL_SLOP, drops it on any scroll of that list, and ignores the touch that stops a fling
// (as iOS does natively).

export const SCROLLER = '.scroll-y, .scroll-x';
export const SCROLL_SLOP = 8;        // Pixels of travel in a list before a press becomes a scroll.
const FLING_CATCH_MS = 120;          // A list that scrolled this recently is still moving: a touch on it only stops it.

const lastScroll = new WeakMap();    // scroller -> performance.now() of its latest scroll event
const listeners = new Set();         // scroll observers (tap.js)
let installed = false;
let anyScrollAt = -1e9;

// A list moved within the last moment (a drag or a fling is running): heavy main-thread work can wait a frame.
export const scrolling = () => performance.now() - anyScrollAt < FLING_CATCH_MS;

export function scrollerOf(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  return el?.closest?.(SCROLLER) ?? null;
}

// True when a touch on this scroller would move it natively; otherwise the page guard should eat the move, or a list
// shorter than its box would hand the drag to the page and rubber-band Safari's viewport.
export function canScroll(sc) {
  if (!sc) return false;
  return sc.classList.contains('scroll-x') ? sc.scrollWidth > sc.clientWidth + 1 : sc.scrollHeight > sc.clientHeight + 1;
}

// Still coasting from a fling: the touch that lands now is a catch, not a tap.
export function coasting(sc) {
  const at = sc && lastScroll.get(sc);
  return !!at && performance.now() - at < FLING_CATCH_MS;
}

export function onListScroll(cb) { listeners.add(cb); }

export function installScrolling() {
  if (installed) return;
  installed = true;
  // Scroll events do not bubble, so one capture listener sees every list.
  document.addEventListener('scroll', e => {
    const sc = e.target?.nodeType === 1 ? e.target : null;
    if (!sc?.matches?.(SCROLLER)) return;
    lastScroll.set(sc, anyScrollAt = performance.now());
    for (const cb of listeners) cb(sc);
  }, { passive: true, capture: true });
}
