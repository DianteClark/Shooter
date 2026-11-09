// The one place that decides how big the game is. Everything fills the measured visible area:
//
// Safari's 100%/vh/dvh disagree with what is really on screen. dvh and fixed elements leave a band under the iOS 26
// toolbars, 100% stays stale for a moment after a rotation, and nothing tells the canvas when any of it changes. So the
// visible size is read from window.innerWidth/innerHeight and written to --app-w and --app-h; #ui and the game canvas are
// sized from those, and a poll backs up the events iOS does not always send.
//
// --k is the menu scale. Every iPhone from 812 wide up comes out at about 845x390 design pixels: a menu is laid out once,
// then scaled, so a 956x440 Pro Max gets the same screen, larger, instead of the same screen with bands round it.
const DESIGN_W = 760;              // Narrowest width menus are laid out for; an 667-wide SE scales down to reach it.
const DESIGN_H = 390;
const K_MIN = 0.78;
const K_MAX = 1.5;
const SETTLE_MS = [0, 120, 350, 800];  // iOS reports stale numbers for a few hundred ms after a rotation.
const POLL_MS = 1000;

const root = document.documentElement;
let current = { w: 0, h: 0, k: 1 };
const listeners = new Set();

function island() {
  // window.orientation is the one rotation value iOS has always had. 90: the top of the phone, with the Dynamic Island,
  // is on the left. -90: on the right. Only that side needs its whole inset; the other just clears the rounded corner.
  const o = window.orientation;
  return { left: o === -90 ? 0 : 1, right: o === 90 ? 0 : 1 };
}

function measure() {
  const w = Math.round(window.innerWidth), h = Math.round(window.innerHeight);
  if (!w || !h) return;
  const k = Math.max(K_MIN, Math.min(K_MAX, Math.min(w / DESIGN_W, h / DESIGN_H)));
  const side = island();
  root.style.setProperty('--isl', side.left);
  root.style.setProperty('--isr', side.right);
  if (w === current.w && h === current.h && k === current.k) return;
  current = { w, h, k };
  root.style.setProperty('--app-w', `${w}px`);
  root.style.setProperty('--app-h', `${h}px`);
  root.style.setProperty('--k', k.toFixed(4));
  // A rotation can leave the page scrolled by the toolbar's height.
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  for (const fn of listeners) fn(current);
}

function settle() {
  for (const ms of SETTLE_MS) setTimeout(measure, ms);
}

// cb({w,h,k}) on every real change of the visible area.
export function onViewport(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const viewport = () => current;

export function installViewport() {
  measure();
  addEventListener('resize', settle, { passive: true });
  addEventListener('orientationchange', settle, { passive: true });
  addEventListener('pageshow', settle, { passive: true });
  window.visualViewport?.addEventListener('resize', settle, { passive: true });
  setInterval(measure, POLL_MS);
}

// The real safe-area insets in CSS pixels, read through a probe because env() cannot be read from script.
let probe = null;
export function safeInsets() {
  if (!probe) {
    probe = document.createElement('i');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:var(--st) var(--sr) var(--sb) var(--sl);box-sizing:content-box';
    document.body.appendChild(probe);
  }
  const s = getComputedStyle(probe);
  return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
}
