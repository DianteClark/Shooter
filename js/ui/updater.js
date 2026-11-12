// Update check. A Home Screen app keeps its own cached copy of the site and can run an old build for a long time, which
// broke joins between two phones on different builds. On launch and whenever the app comes back to the front (at most
// once a minute) this asks the site for js/build.js past every cache and compares its BUILD with the one running.
// A newer build shows an "Update ready" button outside matches; tapping it re-fetches every file this page loaded past
// the cache (GitHub Pages lets phones reuse files for ten minutes) and reloads.
import { BUILD } from '../build.js';

const MIN_GAP_MS = 60000;

async function remoteBuild() {
  const res = await fetch(new URL(`../build.js?t=${Date.now()}`, import.meta.url), { cache: 'no-store' });
  if (!res.ok) return null;
  return /BUILD\s*=\s*'([^']+)'/.exec(await res.text())?.[1] ?? null;
}

// Every same-origin file this page loaded, fetched again so the HTTP cache holds the new copies before the reload.
async function refreshCache() {
  const urls = new Set([location.href.split('#')[0]]);
  for (const e of performance.getEntriesByType('resource')) {
    try { const u = new URL(e.name); if (u.origin === location.origin) urls.add(u.href.split('#')[0]); } catch { /* skip */ }
  }
  await Promise.allSettled([...urls].map(u => fetch(u, { cache: 'reload' })));
}

export class Updater {
  // canShow(): false while the button would get in the way (in a match). Checked again on every app return.
  constructor({ canShow = () => true } = {}) {
    this.canShow = canShow;
    this.latest = null;
    this.lastCheck = -Infinity;
    this.btn = null;
    this.check();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.check(); });
  }

  async check() {
    const now = performance.now();
    if (now - this.lastCheck < MIN_GAP_MS) { this.paint(); return; }
    this.lastCheck = now;
    try {
      const b = await remoteBuild();
      if (b && b !== BUILD) this.latest = b;
    } catch { /* offline: try again on the next return */ }
    this.paint();
  }

  // Called by main.js when a match starts or ends, so the button never sits over the controls.
  paint() {
    const show = !!this.latest && this.canShow();
    if (show && !this.btn) this.btn = this.#build();
    if (this.btn) this.btn.hidden = !show;
    // Centred just above the Multiplayer button, where every phone size has room.
    const hero = show && document.querySelector('.tl-hero');
    if (hero) {
      const r = hero.getBoundingClientRect(), h = this.btn.offsetHeight || 32;
      this.btn.style.left = `${Math.round(r.left + r.width / 2)}px`;
      this.btn.style.top = `${Math.round(r.top - h - 8)}px`;
      this.btn.style.transform = 'translateX(-50%)';
    }
  }

  #build() {
    const b = document.createElement('button');
    b.className = 'btn is-primary update-ready';
    b.dataset.tap = '1';
    b.style.cssText = 'position:fixed;z-index:80;left:24px;top:90px;'
      + 'min-height:32px;padding:0 12px;font-size:13px;pointer-events:auto';
    b.innerHTML = '<b>Update ready</b>';
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.innerHTML = '<b>Updating…</b>';
      await refreshCache();
      location.reload();
    });
    document.body.appendChild(b);
    return b;
  }
}

export { BUILD };
