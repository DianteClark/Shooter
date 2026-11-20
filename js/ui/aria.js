// Screen-reader names for the menus (docs/ACCESSIBILITY.md, roadmap 63). Screens are written as HTML strings and many
// buttons carry only an icon, so one pass gives every control a name a screen reader can say, without each screen
// having to remember: its own aria-label wins, then its visible words, then a title (the element's or its icon's), then
// the action it fires (data-act="optSquadClear" -> "Squad clear"). Clickable non-buttons get role="button"; sheets
// get role="dialog". Watches the menu and overlay layers only (never the HUD), at most one pass a frame.
//
//   watchLabels(...roots)   start (main.js, once)
//   labelControls(root)     one pass now; returns how many elements it named
//   actName(act)            the words for an action id (pure, tested in dev/tutorial-test.mjs)
const CONTROLS = 'button, [role="button"], [data-act], [data-tap], a[href], input, select, textarea';
const NATIVE = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);

export function actName(act = '') {
  const parts = String(act).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean);
  // The first word is the screen's prefix (opt, help, a11y, br...) when more follow.
  const words = parts.length > 1 ? parts.slice(1) : parts;
  const out = words.join(' ').toLowerCase();
  return out ? out[0].toUpperCase() + out.slice(1) : '';
}

function nameOf(el) {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return null;           // Its own words already name it.
  return el.getAttribute('title') || el.querySelector('title')?.textContent?.trim() || el.querySelector('[aria-label]')?.getAttribute('aria-label')
    || actName(el.dataset.act || el.dataset.tap || '') || el.getAttribute('placeholder') || '';
}

export function labelControls(root) {
  if (!root) return 0;
  let n = 0;
  for (const el of root.querySelectorAll(CONTROLS)) {
    if (!NATIVE.has(el.tagName) && !el.hasAttribute('role')) el.setAttribute('role', 'button');
    if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || el.tagName === 'INPUT' && el.closest('label[aria-label]')) continue;
    const name = nameOf(el);
    if (name) { el.setAttribute('aria-label', name); n++; }
  }
  for (const el of root.querySelectorAll('.sheet:not([role])')) el.setAttribute('role', 'dialog');
  // Icons drawn beside words are decoration: a reader should not spell out the SVG.
  for (const svg of root.querySelectorAll('svg:not([aria-hidden]):not([role])')) svg.setAttribute('aria-hidden', 'true');
  return n;
}

export function watchLabels(...roots) {
  if (typeof MutationObserver === 'undefined') return;
  let queued = false;
  const pass = () => { queued = false; for (const r of roots) labelControls(r); };
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(pass); } });
  for (const r of roots) { if (r) { mo.observe(r, { childList: true, subtree: true }); labelControls(r); } }
  return mo;
}
