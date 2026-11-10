// Touch debug overlay (V7). Turned on from Options or with ?touchdebug=1, and kept up through menus and matches, so the
// owner can screenshot the moment the move stick dies on a real iPhone. It shows:
//  - each finger in the newest touch list: id, who holds it (L, R, throw:<slot>, btn:<name>, spare, lost:<side>), x,y;
//    fingers the controls still hold but no list names are flagged GONE;
//  - the controls' state line (sticks, throw, enabled, focused element);
//  - the last 12 raw touch events (type, changedTouches ids, touches ids, target), with runs of touchmoves folded into
//    one row, and the controls' own decisions (let go, picked up, released) and page signals (hidden, blur, focus,
//    selection, gesture, error) between them.
// Cheap: listeners only record numbers into a ring; the panel repaints at most ten times a second, by textContent on
// rows built once. It never takes a touch (pointer-events: none) and sits on <body>, outside every screen's DOM.

const ROWS = 12;
const PAINT_MS = 100;

const CSS = `
.touchdebug { position: fixed; left: calc(env(safe-area-inset-left) + 6px); top: calc(env(safe-area-inset-top) + 46px);
  z-index: 90; pointer-events: none; width: 372px; padding: 4px 6px 5px; background: rgba(6,8,11,.82);
  box-shadow: inset 0 0 0 1px rgba(242,166,59,.55); font: 10px/12px ui-monospace, Menlo, monospace; letter-spacing: 0;
  color: #e7eae4; white-space: pre; overflow: hidden; contain: layout paint; -webkit-user-select: none; user-select: none; }
.touchdebug[hidden] { display: none; }
.touchdebug .td-h { color: #f2a63b; }
.touchdebug .td-f { color: #9fe3ff; }
.touchdebug .td-row.cancel, .touchdebug .td-f.gone { color: #ff6d5e; }
.touchdebug .td-row.note { color: #f2a63b; }
.touchdebug .td-row.sig { color: #c9b8ff; }
.touchdebug .td-row.err { color: #fff; background: #b3261e; }`;

const ids = list => {
  let s = '';
  for (let i = 0; i < list.length; i++) s += (i ? ' ' : '') + list[i].identifier;
  return s || '-';
};
const name = n => (n?.nodeType === 1 ? n.tagName.toLowerCase() + (n.classList[0] ? '.' + n.classList[0] : '') : n ? String(n.nodeName) : '?');
const pad = (s, n) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const SHORT = { touchstart: 'start', touchmove: 'move', touchend: 'end', touchcancel: 'CANCEL' };

export class TouchDebug {
  constructor(controls) {
    this.controls = controls;
    this.on = false;
    this.t0 = performance.now();
    this.log = [];                 // { kind, text, n, at, key }
    this.last = [];                // The newest touch list: [{ id, x, y }]
    this.dirty = false;
    this.timer = 0;
    this.idle = false;             // The pending timer is the slow once-a-second refresh, which news may cut short.
    this.watched = new WeakSet();
    this.recorded = new WeakSet();
    this.record = e => { this.recorded.add(e); this.#touch(e); };
    this.onDetached = e => { if (e.target?.isConnected === false && !this.recorded.has(e)) this.#touch(e, true); };
    this.signals = {
      visibilitychange: () => this.note(`page ${document.hidden ? 'hidden' : 'visible'}`, 'sig'),
      blur: () => this.note('window blur', 'sig'),
      focus: () => this.note('window focus', 'sig'),
      pagehide: () => this.note('pagehide', 'sig'),
      focusin: e => this.note(`focus ${name(e.target)}`, 'sig'),
      selectionchange: () => { const s = document.getSelection?.(); if (s && !s.isCollapsed) this.note('text selected', 'sig'); },
      gesturestart: () => this.note('gesturestart', 'sig'),
      contextmenu: () => this.note('contextmenu', 'sig'),
      pointercancel: e => this.note(`pointercancel ${e.pointerId}`, 'sig'),
      error: e => this.note(`ERR ${e.message ?? e.error ?? e}`, 'err'),
      unhandledrejection: e => this.note(`ERR ${e.reason?.message ?? e.reason}`, 'err'),
    };
  }

  setEnabled(on) {
    on = !!on;
    if (on === this.on) return;
    this.on = on;
    if (on) {
      this.#build();
      const opts = { capture: true, passive: true };
      for (const type of Object.keys(SHORT)) window.addEventListener(type, this.record, opts);
      for (const [type, fn] of Object.entries(this.signals)) (type === 'selectionchange' || type === 'visibilitychange' ? document : window).addEventListener(type, fn, true);
      this.controls.debug = text => this.note(text, 'note');
      this.el.hidden = false;
      this.dirty = true;
      this.#schedule();
    } else {
      for (const type of Object.keys(SHORT)) window.removeEventListener(type, this.record, true);
      for (const [type, fn] of Object.entries(this.signals)) (type === 'selectionchange' || type === 'visibilitychange' ? document : window).removeEventListener(type, fn, true);
      this.controls.debug = null;
      clearTimeout(this.timer);
      this.timer = 0;
      if (this.el) this.el.hidden = true;
    }
  }

  note(text, kind = 'note') {
    if (!this.on) return;
    this.#push({ kind, text, n: 1, at: performance.now(), key: '' });
  }

  #build() {
    if (this.el) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = this.el = document.createElement('div');
    el.className = 'touchdebug';
    el.setAttribute('aria-hidden', 'true');
    const line = cls => { const d = document.createElement('div'); d.className = cls; el.appendChild(d); return d; };
    this.head = line('td-h');
    this.state = line('td-h');
    this.fingerRows = Array.from({ length: 5 }, () => line('td-f'));
    this.rows = Array.from({ length: ROWS }, () => line('td-row'));
    document.body.appendChild(el);
  }

  #touch(e, detached = false) {
    // Events on a node that has left the page reach only that node; the controls pick them up the same way.
    if (e.type === 'touchstart') {
      for (const t of e.changedTouches) {
        const n = t.target;
        if (n && typeof n.addEventListener === 'function' && !this.watched.has(n)) {
          this.watched.add(n);
          for (const type of ['touchmove', 'touchend', 'touchcancel']) n.addEventListener(type, this.onDetached, { passive: true });
        }
      }
    }
    const list = this.last;
    list.length = 0;
    for (const t of e.touches) list.push({ id: t.identifier, x: Math.round(t.clientX), y: Math.round(t.clientY) });
    const kind = e.type === 'touchcancel' ? 'cancel' : 'touch';
    const changed = ids(e.changedTouches), all = ids(e.touches);
    const key = `${e.type}|${changed}|${all}|${detached}`;
    const top = this.log[this.log.length - 1];
    if (e.type === 'touchmove' && top?.key === key) {
      top.n++;
      top.at = performance.now();
      this.dirty = true;
      this.#schedule();
      return;
    }
    const text = `${pad(SHORT[e.type], 6)} ch[${changed}] all[${all}] ${detached ? 'DETACHED ' : ''}${name(e.target)}`;
    this.#push({ kind, text, n: 1, at: performance.now(), key });
  }

  #push(row) {
    this.log.push(row);
    if (this.log.length > ROWS) this.log.shift();
    this.dirty = true;
    this.#schedule();
  }

  #schedule() {
    if (!this.on || (this.timer && !this.idle)) return;
    clearTimeout(this.timer);
    this.idle = false;
    this.timer = setTimeout(() => { this.timer = 0; this.#paint(); }, PAINT_MS);
  }

  #paint() {
    if (!this.dirty || !this.el) return;
    this.dirty = false;
    const c = this.controls, now = performance.now();
    this.head.textContent = `TOUCH DEBUG  ${new Date().toTimeString().slice(0, 8)}  fingers ${this.last.length}`;
    const th = c.throw ? `${c.throw.slot}#${c.throw.id}` : '-';
    const lost = [...c.lost.keys()].join(' ') || '-', spare = [...c.spare.keys()].join(' ') || '-';
    const focus = document.activeElement && document.activeElement !== document.body ? name(document.activeElement) : 'body';
    this.state.textContent = `L ${c.left.id ?? '-'}  R ${c.right.id ?? '-'}  throw ${th}  spare ${spare}  lost ${lost}  ${c.enabled ? 'live' : 'OFF'}  focus ${focus}`;
    const shown = new Set();
    let i = 0;
    for (const f of this.last) {
      if (i >= this.fingerRows.length) break;
      shown.add(f.id);
      const row = this.fingerRows[i++];
      row.className = 'td-f';
      row.textContent = `#${pad(String(f.id), 6)} ${pad(c.ownerOf(f.id) || 'none', 14)} ${f.x},${f.y}`;
    }
    for (const id of c.heldIds()) {
      if (shown.has(id) || i >= this.fingerRows.length) continue;
      const row = this.fingerRows[i++];
      row.className = 'td-f gone';
      row.textContent = `#${pad(String(id), 6)} ${pad(c.ownerOf(id), 14)} GONE from list, still held`;
    }
    for (; i < this.fingerRows.length; i++) this.fingerRows[i].textContent = '';
    for (let r = 0; r < ROWS; r++) {
      const row = this.rows[r], entry = this.log[r];
      if (!entry) { row.textContent = ''; continue; }
      const ago = ((now - entry.at) / 1000).toFixed(2).padStart(6);
      row.className = `td-row ${entry.kind}`;
      row.textContent = `-${ago}s ${entry.text}${entry.n > 1 ? ` x${entry.n}` : ''}`;
    }
    // Ages keep counting while the panel is up, slowly: once a second when nothing happens.
    this.dirty = true;
    this.idle = true;
    this.timer = setTimeout(() => { this.timer = 0; this.#paint(); }, 1000);
  }
}
