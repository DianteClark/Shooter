// Which phone and browser this is, how the game was opened, and the install and storage hooks that differ by platform.
// docs/DEVICES.md has the full picture. Nothing here changes behaviour on an iPhone except the install guide's wording.
//
//  - iOS: every browser is WebKit. Safari adds to the Home Screen from Share; since iOS 16.4 Chrome, Edge and Firefox
//    can too (their own Share menu). A Home Screen app keeps storage of its own, apart from the Safari tab.
//  - Android: Chrome and Samsung Internet fire beforeinstallprompt when the site is installable (manifest plus a
//    service worker with a fetch handler, see sw.js); the event is kept so the install guide can offer a real
//    Install button. Firefox and others install from their menu.
const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';

const iPadOS = /Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
export const IOS = /iP(hone|od|ad)/.test(ua) || iPadOS;
export const ANDROID = /Android/i.test(ua);
const iosVer = (() => { const m = ua.match(/OS (\d+)_(\d+)/); return m ? Number(m[1]) + Number(m[2]) / 100 : 0; })();

// The browser by name, as the guide speaks of it.
export function browserName() {
  if (IOS) {
    if (/CriOS/.test(ua)) return 'chrome';
    if (/FxiOS/.test(ua)) return 'firefox';
    if (/EdgiOS/.test(ua)) return 'edge';
    if (/OPiOS|OPT\//.test(ua)) return 'opera';
    if (/GSA\//.test(ua)) return 'google';
    if (/FBAN|FBAV|Instagram|Line\/|Snapchat|Twitter|Discord/i.test(ua)) return 'inapp';
    return /Safari/.test(ua) ? 'safari' : 'inapp';
  }
  if (ANDROID) {
    if (/SamsungBrowser/.test(ua)) return 'samsung';
    if (/Firefox/.test(ua)) return 'firefox';
    if (/EdgA/.test(ua)) return 'edge';
    if (/OPR\//.test(ua)) return 'opera';
    if (/; wv\)|FBAN|FBAV|Instagram|Snapchat|Discord/i.test(ua)) return 'inapp';
    if (/Chrome\//.test(ua)) return 'chrome';
    return 'other';
  }
  return 'desktop';
}

// Running as an installed app (Home Screen on iPhone, installed web app on Android), not in a browser tab.
export function installed() {
  if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  try { return matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches; } catch { return false; }
}

// 'ios-safari' | 'ios-other' | 'ios-inapp' | 'android-chrome' | 'android-samsung' | 'android-other' | 'desktop'.
export function platformKey() {
  const b = browserName();
  if (IOS) return b === 'safari' ? 'ios-safari' : b === 'inapp' ? 'ios-inapp' : 'ios-other';
  if (ANDROID) return b === 'chrome' || b === 'edge' ? 'android-chrome' : b === 'samsung' ? 'android-samsung' : 'android-other';
  return 'desktop';
}

export const iosVersion = () => iosVer;
// iOS 16.4 let browsers other than Safari add to the Home Screen from their Share menu.
export const iosOtherCanAdd = () => IOS && iosVer >= 16.4;

// ---- Install prompt (Android Chrome, Samsung Internet, Edge) ----------------------------------------------------
let deferred = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();                       // Ours to show from the install guide, not the browser's mini-bar.
    deferred = e;
    for (const fn of listeners) fn();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    requestPersist();
    for (const fn of listeners) fn();
  });
}

export const canPromptInstall = () => !!deferred;
export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Shows the browser's own install dialog. Must run inside a tap. Resolves 'accepted', 'dismissed' or 'unavailable'.
export async function promptInstall() {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null;                            // One use per event.
  try {
    await e.prompt();
    const choice = await e.userChoice;
    for (const fn of listeners) fn();
    if (choice?.outcome === 'accepted') requestPersist();
    return choice?.outcome || 'dismissed';
  } catch { return 'unavailable'; }
}

// ---- Storage ------------------------------------------------------------------------------------------------------
// Asks the browser not to clear this site's storage under pressure. Chrome grants it quietly to installed apps and
// to sites used often; Safari decides by its own heuristics. Harmless to ask more than once; the answer is cached.
let persistAsked = null;
export function requestPersist() {
  if (persistAsked) return persistAsked;
  const s = typeof navigator !== 'undefined' ? navigator.storage : null;
  if (!s?.persist) return (persistAsked = Promise.resolve(false));
  persistAsked = (async () => {
    try { return (await s.persisted?.()) || (await s.persist()); } catch { return false; }
  })();
  return persistAsked;
}

export async function storageState() {
  const s = typeof navigator !== 'undefined' ? navigator.storage : null;
  let persisted = null;
  try { persisted = s?.persisted ? await s.persisted() : null; } catch { persisted = null; }
  return { persisted, supported: !!s?.persist };
}
