// The one place that decides how big the game is. Everything fills the measured visible area.
//
// No single number from Safari can be trusted for that on iOS 26:
//  - window.innerHeight, documentElement.clientHeight and 100dvh can leave out a strip that is really on screen. In a
//    Home Screen app iOS 26 still subtracts room for a Safari toolbar that is not there, so landscape loses about 60 pt
//    at the bottom (WebKit 301994 and the 26.0/26.1 "bottom gap" reports); in Safari the floating Liquid Glass bars are
//    drawn over the page, not beside it.
//  - position:fixed boxes are clipped to that short viewport (Apple forums 800798), so a fixed, viewport-sized root
//    leaves a band nothing can paint into.
//  - 100% stays stale for a moment after a rotation, and visualViewport lags behind keyboard and toolbar changes.
// So every candidate is read (innerWidth/Height, visualViewport, documentElement.client*, the 100lvh/100svh/100dvh
// probes, and screen.width/height turned to the current orientation) and the largest one that is really visible wins:
//  - Home Screen app: there is no browser chrome at all, so the whole screen is the app.
//  - Safari: the large viewport (100lvh), which is the area with the toolbars retracted; whatever part of it the
//    browser reports as covered (lvh minus innerHeight) is still painted by the world, and only kept clear of UI through
//    --cover-b, which is added to the bottom safe-area inset every layer already respects.
// The result goes to --app-w/--app-h. html, body, #ui and the game canvas are sized from those and are never fixed
// (see css/game.css). A poll backs up the resize events iOS does not always send.
//
// ?vp=inner forces the old innerWidth/innerHeight sizing, so a phone can compare the two.
//
// --k is the menu scale. Every iPhone from 812 wide up comes out at about 845x390 design pixels: a menu is laid out once,
// then scaled, so a 956x440 Pro Max gets the same screen, larger, instead of the same screen with bands round it.
const DESIGN_W = 760;              // Narrowest width menus are laid out for; an 667-wide SE scales down to reach it.
const DESIGN_H = 390;
const K_MIN = 0.78;
const K_MAX = 1.5;
const SETTLE_MS = [0, 120, 350, 800];  // iOS reports stale numbers for a few hundred ms after a rotation.
const POLL_MS = 1000;
const SLACK = 2;                   // Pixels of disagreement that are only rounding.

const root = document.documentElement;
// Android reports its viewport honestly, and its screen size includes the status and navigation bars, while 100lvh in
// a tab is the height with the address bar scrolled away (it never is here). The iOS corrections below would make the
// app taller than what is really on screen there, so Android takes the visible size as it is.
const ANDROID = /Android/i.test(navigator.userAgent);
let current = { w: 0, h: 0, k: 1, cover: 0, source: '' };
let last = null;                   // Every candidate from the latest measure, for the touch debug overlay.
const listeners = new Set();
const forced = new URLSearchParams(location.search).get('vp');

function island() {
  // window.orientation is the one rotation value iOS has always had. 90: the top of the phone, with the Dynamic Island,
  // is on the left. -90: on the right. Only that side needs its whole inset; the other just clears the rounded corner.
  const o = window.orientation;
  return { left: o === -90 ? 0 : 1, right: o === 90 ? 0 : 1 };
}

// Home Screen web app (or any display mode without browser chrome).
export function standalone() {
  if (navigator.standalone === true) return true;
  try { return matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches; } catch { return false; }
}

// 100lvh, 100svh and 100dvh in pixels, read from probes that are absolutely positioned (a fixed one would be clipped).
let probes = null;
function unitHeights() {
  if (!document.body) return { lvh: 0, svh: 0, dvh: 0 };
  if (!probes) {
    probes = {};
    for (const u of ['lvh', 'svh', 'dvh']) {
      const el = document.createElement('i');
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = `position:absolute;left:0;top:0;width:0;height:100vh;height:100${u};visibility:hidden;pointer-events:none`;
      document.body.appendChild(el);
      probes[u] = el;
    }
  }
  const out = {};
  for (const u in probes) out[u] = Math.round(probes[u].getBoundingClientRect().height);
  return out;
}

// All the numbers, and the size chosen from them.
function candidates() {
  const iw = Math.round(window.innerWidth), ih = Math.round(window.innerHeight);
  const vv = window.visualViewport;
  // A pinch-zoomed visual viewport is smaller than the screen by the zoom; it says nothing about the layout then.
  const vvOk = !!vv && Math.abs((vv.scale || 1) - 1) < 0.01;
  const vw = vvOk ? Math.round(vv.width) : 0, vh = vvOk ? Math.round(vv.height) : 0;
  const cw = root.clientWidth, ch = root.clientHeight;
  const units = unitHeights();
  // screen.* is the portrait size on iOS whatever the rotation; turn it to match the window.
  const sLong = Math.max(screen.width || 0, screen.height || 0), sShort = Math.min(screen.width || 0, screen.height || 0);
  const landscape = iw >= ih;
  const sw = landscape ? sLong : sShort, sh = landscape ? sShort : sLong;
  const app = standalone();

  const visW = Math.max(iw, vw, cw), visH = Math.max(ih, vh, ch);
  let w = visW, h = visH, source = 'inner';
  if (forced !== 'inner' && !ANDROID) {
    if (app && sw && sh) {
      // No browser chrome: the screen is the app. Only ever grow, and only by an amount a phone could have lost.
      if (sh > h && sh - h < sh * 0.3) { h = sh; source = 'screen'; }
      if (sw > w && sw - w < sw * 0.3) w = sw;
    }
    if (units.lvh > h + SLACK && (!sh || units.lvh <= sh + SLACK)) { h = units.lvh; source = 'lvh'; }
  }
  // In Safari the part beyond what the browser calls visible may sit under a translucent toolbar: the world paints
  // there, the controls keep out of it. A Home Screen app has no toolbar to keep out of.
  const cover = app ? 0 : Math.max(0, h - visH);
  return { w, h, cover, source, app, inner: [iw, ih], vv: vv ? [Math.round(vv.width), Math.round(vv.height), +(vv.scale || 1).toFixed(2), Math.round(vv.offsetTop || 0)] : null, client: [cw, ch], units, screen: [sw, sh] };
}

function measure() {
  const c = candidates();
  last = c;
  const { w, h, cover } = c;
  if (!w || !h) return;
  const k = Math.max(K_MIN, Math.min(K_MAX, Math.min(w / DESIGN_W, h / DESIGN_H)));
  const side = island();
  root.style.setProperty('--isl', side.left);
  root.style.setProperty('--isr', side.right);
  // A rotation, or the browser scrolling the page to show a toolbar, can leave it scrolled; nothing here ever scrolls.
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  if (w === current.w && h === current.h && k === current.k && cover === current.cover) { current.source = c.source; return; }
  current = { w, h, k, cover, source: c.source };
  root.style.setProperty('--app-w', `${w}px`);
  root.style.setProperty('--app-h', `${h}px`);
  root.style.setProperty('--cover-b', `${cover}px`);
  root.style.setProperty('--k', k.toFixed(4));
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

// Everything measured, as text lines for the touch debug overlay: the owner screenshots this on the phone.
export function viewportReport() {
  measure();
  const c = last;
  if (!c) return ['viewport: not measured'];
  const ins = safeInsets();
  const pair = p => (p ? p.join('x') : '-');
  return [
    `VIEWPORT ${current.w}x${current.h} from ${current.source}${forced === 'inner' ? ' (?vp=inner)' : ''} k${current.k.toFixed(3)} cover-b ${current.cover}`,
    `${c.app ? 'home screen' : 'browser'}  inner ${pair(c.inner)}  client ${pair(c.client)}`,
    `screen ${pair(c.screen)}  vv ${c.vv ? `${c.vv[0]}x${c.vv[1]} s${c.vv[2]} top${c.vv[3]}` : '-'}`,
    `lvh ${c.units.lvh}  svh ${c.units.svh}  dvh ${c.units.dvh}  dpr ${window.devicePixelRatio}  o ${window.orientation ?? '-'}`,
    `safe t${ins.top} r${ins.right} b${ins.bottom} l${ins.left} (b includes cover)`,
  ];
}

export function installViewport() {
  measure();
  addEventListener('resize', settle, { passive: true });
  addEventListener('orientationchange', settle, { passive: true });
  addEventListener('pageshow', settle, { passive: true });
  // Nothing scrolls; a page scrolled by a toolbar or a focus is put back at once.
  addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); }, { passive: true });
  window.visualViewport?.addEventListener('resize', settle, { passive: true });
  setInterval(measure, POLL_MS);
}

// The real safe-area insets in CSS pixels, read through a probe because env() cannot be read from script.
let probe = null;
export function safeInsets() {
  if (!probe) {
    probe = document.createElement('i');
    probe.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:var(--env-t) var(--env-r) var(--env-b) var(--env-l);box-sizing:content-box';
    document.body.appendChild(probe);
  }
  const s = getComputedStyle(probe);
  return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
}
