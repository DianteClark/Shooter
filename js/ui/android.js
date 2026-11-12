// Android only: full screen and landscape lock in a browser tab, the back gesture, and the service worker that makes
// Chrome and Samsung Internet offer Install. Nothing in here runs on an iPhone (see docs/DEVICES.md for why each is
// left out there).
//
// Full screen: a browser tab keeps its address bar and the system bars, which take a fifth of a landscape screen.
// The Fullscreen API removes them, and only from inside a tap, so each tap outside full screen asks again (when the
// player has the Full screen option on). Once in full screen, screen.orientation.lock('landscape') holds the game
// sideways; an installed app gets that from the manifest instead. The back gesture leaves full screen first, by design.
//
// Back: the Android back gesture (or button) walks history, and with none left it leaves the app. One extra history
// entry is kept while anything sits above the title, and a back is turned into the screen's own Back button (or the
// open sheet's close). On the title with nothing open the entry is not kept, so the next back closes the app as
// players expect. In a match back is swallowed: a stray edge swipe must not quit a match.
import { ANDROID, installed } from './platform.js';
import { Options } from './options.js';

const BACKISH = '.back, .pk-close, .close, [data-sound="back"], [data-act$="Back"], [data-act$="back"], [data-act$="Close"], [data-act$="close"], [data-act*="Cancel"], [data-act*="Skip"], [data-act*="Dismiss"], [data-act*="dismiss"]';
const shown = el => !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest('[hidden]') && !el.disabled;

export const fullscreenSupported = () => ANDROID && !!document.fullscreenEnabled && !!document.documentElement.requestFullscreen;
export const inFullscreen = () => !!document.fullscreenElement;

// Inside a tap: full screen, then landscape. Errors are expected (no gesture, a browser that refuses) and ignored.
export async function enterFullscreen() {
  if (!fullscreenSupported() || inFullscreen() || installed() && matchMedia('(display-mode: fullscreen)').matches) return;
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { return; }
  try { await screen.orientation?.lock?.('landscape'); } catch { /* not allowed here: the rotate hint still shows */ }
}

// menu: the Menu (js/ui/menu.js). inMatch(): true while a match is on screen. onMatchBack(): a back during a match.
export function installAndroid({ menu, inMatch = () => false, onMatchBack = () => {}, onTitleBack = () => {} }) {
  if (!ANDROID) return;
  registerWorker();

  // Full screen from any tap while the option is on. A tap is also when the entry for Back is re-armed.
  const onTap = () => {
    if (Options.get('fullscreen') && !installed()) enterFullscreen();
    setTimeout(arm, 0);           // After the tap's own action has changed the screen.
  };
  document.addEventListener('click', onTap, { passive: true });
  document.addEventListener('touchend', () => { if (Options.get('fullscreen') && !installed()) enterFullscreen(); }, { passive: true });
  // An installed app already runs landscape from the manifest; a tab in full screen locks again after a rotation.
  document.addEventListener('fullscreenchange', () => { if (inFullscreen()) screen.orientation?.lock?.('landscape').catch(() => {}); });

  // ---- Back ----
  let armed = false;
  const aboveTitle = () => inMatch() || menu.overlayEl?.classList.contains('show') || (menu.el.dataset.screen && menu.el.dataset.screen !== 'title');
  function arm() {
    if (armed || !aboveTitle()) return;
    try { history.pushState({ syBack: 1 }, ''); armed = true; } catch { /* sandboxed: no history */ }
  }
  // Exposed for main.js: a screen changed by code (a match ending, a lobby closing) rather than by a tap.
  installAndroid.arm = arm;
  window.addEventListener('popstate', () => {
    armed = false;
    if (inMatch()) { onMatchBack(); arm(); return; }
    const over = menu.overlayEl?.classList.contains('show') ? menu.overlayEl : null;
    const scope = over ?? menu.el;
    const btn = [...scope.querySelectorAll(BACKISH)].find(shown);
    if (btn) { btn.click(); setTimeout(arm, 0); return; }
    if (over) { arm(); return; }          // A sheet with no way out but its own choice: stay on it.
    if (menu.el.dataset.screen && menu.el.dataset.screen !== 'title') { arm(); return; }
    onTitleBack();                        // The next back leaves the app.
  });
  // The first entry needs a gesture (Chrome skips entries pushed without one); taps arm it from then on.
  arm();
}

// A pass-through service worker: Chrome and Samsung Internet only offer Install (beforeinstallprompt) for a site with
// one that handles fetch. It caches nothing, so js/ui/updater.js keeps working exactly as it does on iPhone.
function registerWorker() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  const go = () => navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url), { scope: new URL('../../', import.meta.url).pathname }).catch(() => {});
  if (document.readyState === 'complete') go();
  else addEventListener('load', go, { once: true });
}
