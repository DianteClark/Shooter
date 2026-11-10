// The live tuning panel (Wave 6). Hidden debug UI over a running match: long-press the match timer, or load with
// ?tune=1, to open it. It never pauses and never covers the screen, so both thumbs keep playing beside it; the
// sticks ignore touches that start on it (see Controls #start). Values live in js/shared/tuning.js.
//
// Mounted once by Controls, which tells it when a match is live; nothing else needs to wire it.
// Touch is handled here directly rather than through native scrolling and range inputs: the app default-prevents
// drags everywhere (no rubber-banding), so the panel scrolls itself and its sliders track their own finger.
import {
  GROUPS, TUNABLES, TUNABLE, TUNING, setTune, resetTune, onTune, isTuned, tunedCount, exportTuning, importTuning,
} from '../shared/tuning.js';

const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP = 14;
const SCROLL_SLOP = 8;         // A drag on the panel body further than this scrolls it and no longer taps.
const DOCKS = ['center', 'right', 'left'];
const UI_STORE = 'switchyard.tuner.ui.v1';

const decimals = step => (String(step).split('.')[1] || '').length;
const fmt = (d, v) => v.toFixed(decimals(d.step)) + (d.unit === '×' ? '×' : d.unit ? ' ' + d.unit : '');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let mounted = null;

export function mountTuner(root) {
  if (!mounted) mounted = new Tuner(root);
  return mounted;
}

class Tuner {
  constructor(root) {
    this.root = root;
    this.live = false;
    this.isOpen = false;
    this.autoOpen = new URLSearchParams(location.search).get('tune') === '1';
    this.ui = loadUi();
    this.drag = null;            // { id, key, track rect } of the finger on a slider
    this.scroll = null;          // { id, y, top, moved } of the finger scrolling the body
    this.suppressClickUntil = 0;
    this.press = null;           // Long-press on the timer in progress.
    this.#link();
    this.#build();
    this.#listen();
    onTune(key => this.#sync(key));
    this.#sync(null);
  }

  #link() {
    if (document.querySelector('link[data-tuner]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('../../css/tuner.css', import.meta.url).href;
    l.dataset.tuner = '1';
    document.head.appendChild(l);
  }

  #build() {
    const el = this.el = document.createElement('div');
    el.className = 'tuner';
    el.hidden = true;
    el.dataset.dock = this.ui.dock;
    el.classList.toggle('min', !!this.ui.min);
    el.innerHTML = `
      <header class="tn-head">
        <b class="tn-title">Tuning</b>
        <span class="tn-count"></span>
        <button class="tn-hbtn" data-tn="dock" aria-label="Move panel">Move</button>
        <button class="tn-hbtn" data-tn="min" aria-label="Collapse panel"><i class="tn-chev"></i></button>
        <button class="tn-hbtn tn-x" data-tn="close" aria-label="Close">×</button>
      </header>
      <div class="tn-body">
        ${GROUPS.map(g => `
        <section class="tn-group${this.ui.closed?.includes(g.id) ? ' shut' : ''}" data-group="${g.id}">
          <button class="tn-ghead" data-tn="group" data-g="${g.id}"><i class="tn-chev"></i><b>${esc(g.label)}</b><span class="tn-gcount"></span></button>
          <div class="tn-rows">
          ${TUNABLES.filter(d => d.group === g.id).map(d => `
            <div class="tn-row" data-key="${d.key}">
              <div class="tn-top">
                <span class="tn-label">${esc(d.label)}</span>
                <b class="tn-val"></b>
                <button class="tn-reset" data-tn="reset" data-key="${d.key}" aria-label="Reset ${esc(d.label)}">Reset</button>
              </div>
              <div class="tn-ctl">
                <button class="tn-step" data-tn="dec" data-key="${d.key}" aria-label="Less">−</button>
                <div class="tn-track" data-key="${d.key}">
                  <i class="tn-rail"><i class="tn-fill"></i><i class="tn-def" style="left:${pct(d, d.def)}%"></i><i class="tn-thumb"></i></i>
                </div>
                <button class="tn-step" data-tn="inc" data-key="${d.key}" aria-label="More">+</button>
              </div>
              <small class="tn-help">${esc(d.help)}<span class="tn-was"></span></small>
            </div>`).join('')}
          </div>
        </section>`).join('')}
        <section class="tn-tools">
          <div class="tn-trow">
            <button class="tn-btn" data-tn="export">Export code</button>
            <button class="tn-btn" data-tn="import">Import code</button>
            <button class="tn-btn tn-danger" data-tn="resetAll">Reset all</button>
          </div>
          <textarea class="tn-code" rows="2" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="Export shows a code here. Paste one and press Import."></textarea>
          <small class="tn-msg"></small>
        </section>
      </div>`;
    this.root.appendChild(el);
    this.body = el.querySelector('.tn-body');
    this.countEl = el.querySelector('.tn-count');
    this.codeEl = el.querySelector('.tn-code');
    this.msgEl = el.querySelector('.tn-msg');
    this.rows = {};
    for (const d of TUNABLES) {
      const row = el.querySelector(`.tn-row[data-key="${d.key}"]`);
      this.rows[d.key] = {
        row, val: row.querySelector('.tn-val'), fill: row.querySelector('.tn-fill'), thumb: row.querySelector('.tn-thumb'),
        was: row.querySelector('.tn-was'), track: row.querySelector('.tn-track'), shown: NaN, tuned: null,
      };
    }
    this.groupCounts = {};
    for (const g of GROUPS) this.groupCounts[g.id] = el.querySelector(`[data-group="${g.id}"] .tn-gcount`);
  }

  #listen() {
    const el = this.el;
    el.addEventListener('click', e => this.#click(e));
    // Touch: sliders and body scrolling. Each finger is tracked by identifier so a thumb on the game is untouched.
    el.addEventListener('touchstart', e => this.#touchStart(e), { passive: false });
    el.addEventListener('touchmove', e => this.#touchMove(e), { passive: false });
    el.addEventListener('touchend', e => this.#touchEnd(e), { passive: false });
    el.addEventListener('touchcancel', e => this.#touchEnd(e), { passive: false });
    // Mouse, for desktop testing.
    el.addEventListener('mousedown', e => {
      const track = e.target.closest('.tn-track');
      if (!track) return;
      e.preventDefault();
      this.#grab('mouse', track, e.clientX);
      const move = m => this.#slide('mouse', m.clientX);
      const up = () => { this.drag = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });

    // Long-press on the match timer, in capture so it sees the touch before the scoreboard's own tap handling.
    const begin = (id, x, y, target) => {
      if (!this.live || !target?.closest?.('.sb-time')) return;
      clearTimeout(this.press?.timer);
      this.press = { id, x, y, fired: false, timer: setTimeout(() => this.#longPress(), LONG_PRESS_MS) };
    };
    const moveP = (id, x, y) => {
      const p = this.press;
      if (p && p.id === id && !p.fired && Math.hypot(x - p.x, y - p.y) > LONG_PRESS_SLOP) { clearTimeout(p.timer); this.press = null; }
    };
    const end = id => {
      const p = this.press;
      if (!p || p.id !== id) return;
      clearTimeout(p.timer);
      // The release of a long press must not also toggle the scoreboard.
      if (p.fired) this.suppressClickUntil = performance.now() + 600;
      this.press = null;
    };
    const opts = { passive: true, capture: true };
    window.addEventListener('touchstart', e => { for (const t of e.changedTouches) begin(t.identifier, t.clientX, t.clientY, t.target); }, opts);
    window.addEventListener('touchmove', e => { for (const t of e.changedTouches) moveP(t.identifier, t.clientX, t.clientY); }, opts);
    window.addEventListener('touchend', e => { for (const t of e.changedTouches) end(t.identifier); }, opts);
    window.addEventListener('touchcancel', e => { for (const t of e.changedTouches) end(t.identifier); }, opts);
    window.addEventListener('mousedown', e => begin('mouse', e.clientX, e.clientY, e.target), opts);
    window.addEventListener('mousemove', e => moveP('mouse', e.clientX, e.clientY), opts);
    window.addEventListener('mouseup', () => end('mouse'), opts);
    window.addEventListener('click', e => {
      if (performance.now() < this.suppressClickUntil && e.target?.closest?.('.scorebar')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.suppressClickUntil = 0;
      }
    }, { capture: true });
  }

  #longPress() {
    const p = this.press;
    if (!p) return;
    p.fired = true;
    // While the finger is still down the press is held open; the click that follows its release is dropped.
    this.suppressClickUntil = Infinity;
    this.isOpen ? this.close() : this.open();
  }

  // Controls calls this as matches start and end. The panel only shows over a live match; an open panel reappears
  // at the next one.
  setLive(on) {
    this.live = on;
    if (on && this.autoOpen) { this.autoOpen = false; this.isOpen = true; }
    this.el.hidden = !(on && this.isOpen);
    if (!on) { this.drag = null; this.scroll = null; }
  }

  open() {
    this.isOpen = true;
    this.el.hidden = !this.live;
    this.#sync(null);
  }

  close() {
    this.isOpen = false;
    this.el.hidden = true;
    this.drag = null;
    this.scroll = null;
    this.codeEl.blur();
  }

  #click(e) {
    const b = e.target.closest('[data-tn]');
    if (!b || this.scrollTapBlock) return;
    const key = b.dataset.key, d = key && TUNABLE[key];
    switch (b.dataset.tn) {
      case 'close': this.close(); break;
      case 'min': this.ui.min = !this.ui.min; this.el.classList.toggle('min', this.ui.min); saveUi(this.ui); break;
      case 'dock': {
        this.ui.dock = DOCKS[(DOCKS.indexOf(this.ui.dock) + 1) % DOCKS.length];
        this.el.dataset.dock = this.ui.dock;
        saveUi(this.ui);
        break;
      }
      case 'group': {
        const sec = b.closest('.tn-group');
        sec.classList.toggle('shut');
        this.ui.closed = [...this.el.querySelectorAll('.tn-group.shut')].map(s => s.dataset.group);
        saveUi(this.ui);
        break;
      }
      case 'reset': resetTune(key); break;
      case 'dec': setTune(key, TUNING[key] - d.step); break;
      case 'inc': setTune(key, TUNING[key] + d.step); break;
      case 'resetAll': resetTune(); this.#say('Every value is back to default.'); break;
      case 'export': {
        const code = exportTuning();
        this.codeEl.value = code;
        const n = tunedCount();
        navigator.clipboard?.writeText(code).then(() => this.#say(`Copied: ${n} changed value${n === 1 ? '' : 's'}.`), () => this.#say('Select the code and copy it.'));
        this.#say(n ? `${n} changed value${n === 1 ? '' : 's'}.` : 'All values are default.');
        break;
      }
      case 'import': {
        try {
          const n = importTuning(this.codeEl.value);
          this.#say(`Imported ${n} value${n === 1 ? '' : 's'}; the rest reset to default.`);
        } catch {
          this.#say('That is not a tuning code.', true);
        }
        break;
      }
    }
  }

  #say(text, bad = false) {
    this.msgEl.textContent = text;
    this.msgEl.classList.toggle('bad', bad);
  }

  #touchStart(e) {
    for (const t of e.changedTouches) {
      const target = t.target?.nodeType === 1 ? t.target : t.target?.parentElement;
      if (target?.tagName === 'TEXTAREA') continue;
      const track = target?.closest?.('.tn-track');
      if (track && !this.drag) {
        this.#grab(t.identifier, track, t.clientX);
      } else if (!track && !this.scroll && target?.closest?.('.tn-body')) {
        this.scroll = { id: t.identifier, y: t.clientY, top: this.body.scrollTop, moved: false };
      }
    }
    if (e.cancelable && !(e.target?.tagName === 'TEXTAREA')) e.preventDefault();
  }

  #touchMove(e) {
    for (const t of e.changedTouches) {
      if (this.drag?.id === t.identifier) this.#slide(t.identifier, t.clientX);
      else if (this.scroll?.id === t.identifier) {
        const s = this.scroll, dy = t.clientY - s.y;
        // tap.js clicks a button on release within its slop, before this panel hears the touchend; a scroll that
        // started on a button is therefore marked here, as soon as it is one.
        if (!s.moved && Math.abs(dy) > SCROLL_SLOP) { s.moved = true; this.scrollTapBlock = true; }
        if (s.moved) this.body.scrollTop = s.top - dy;
      }
    }
    if (e.cancelable) e.preventDefault();
  }

  #touchEnd(e) {
    for (const t of e.changedTouches) {
      if (this.drag?.id === t.identifier) this.drag = null;
      else if (this.scroll?.id === t.identifier) {
        if (this.scroll.moved) setTimeout(() => { this.scrollTapBlock = false; }, 0);
        this.scroll = null;
      }
    }
  }

  // Track geometry is measured once per grab: the panel does not move under a finger.
  #grab(id, track, x) {
    const r = track.getBoundingClientRect();
    this.drag = { id, key: track.dataset.key, x0: r.left + 14, w: Math.max(1, r.width - 28) };
    this.#slide(id, x);
  }

  #slide(id, x) {
    const g = this.drag;
    if (!g || g.id !== id) return;
    const d = TUNABLE[g.key];
    const f = Math.max(0, Math.min(1, (x - g.x0) / g.w));
    setTune(g.key, d.min + f * (d.max - d.min));
  }

  // Writes only what changed. key null: everything (open, reset all, import).
  #sync(key) {
    const keys = key ? [key] : TUNABLES.map(d => d.key);
    for (const k of keys) {
      const d = TUNABLE[k], r = this.rows[k], v = TUNING[k];
      if (v !== r.shown) {
        r.shown = v;
        r.val.textContent = fmt(d, v);
        const p = pct(d, v);
        r.fill.style.transform = `scaleX(${(p / 100).toFixed(4)})`;
        r.thumb.style.left = `${p}%`;
      }
      const tuned = isTuned(k);
      if (tuned !== r.tuned) {
        r.tuned = tuned;
        r.row.classList.toggle('tuned', tuned);
        r.was.textContent = tuned ? ` Default ${fmt(d, d.def)}.` : '';
      }
    }
    const n = tunedCount();
    this.countEl.textContent = n ? `${n} changed` : 'Defaults';
    this.countEl.classList.toggle('on', n > 0);
    for (const g of GROUPS) {
      const c = TUNABLES.reduce((s, d) => s + (d.group === g.id && isTuned(d.key) ? 1 : 0), 0);
      const node = this.groupCounts[g.id];
      node.textContent = c ? c : '';
      node.classList.toggle('on', c > 0);
    }
  }
}

function pct(d, v) { return ((v - d.min) / (d.max - d.min)) * 100; }

function loadUi() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(UI_STORE) || '{}') || {}; } catch { /* defaults */ }
  return { dock: DOCKS.includes(o.dock) ? o.dock : 'center', min: !!o.min, closed: Array.isArray(o.closed) ? o.closed : [] };
}

function saveUi(ui) {
  try { localStorage.setItem(UI_STORE, JSON.stringify(ui)); } catch { /* private mode */ }
}
