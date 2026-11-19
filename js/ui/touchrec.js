// Touch recorder (Options > Controls > Record touches). While on, every touch event the controls see is kept in a
// rolling ring of about the last 20 seconds, exactly as the browser delivered it (type, event time, changedTouches and
// touches with identifier, x, y and target), together with what js/ui/controls.js decided: which finger holds the move
// stick (L) and the aim stick (R), the throw in progress, the fingers it keeps through a cancel or a stale touchend, and
// its own notes (let go, picked up, kept). "Stick died?" on the scoreboard, or a three-finger tap, freezes the ring
// into a report code (deflated JSON in base64) that the owner pastes to us; dev/touch-replay.html feeds it back through
// controls.js event for event, on the same clock, and shows where the stick let go of a thumb that was still down.
//
// Cost: one small array per event and a state string; per frame only a counter. A full-state checkpoint every two
// seconds is where the ring may be cut, so a report always starts from a state the replay can restore.

const WINDOW_MS = 20000;
const CHECK_MS = 2000;
const MAX_ENTRIES = 9000;          // Hard bound, whatever the event rate.
const TYPE = { touchstart: 's', touchmove: 'm', touchend: 'e', touchcancel: 'c' };
const PREFIX_DEFLATE = 'SWT1d.';
const PREFIX_PLAIN = 'SWT1j.';
const TAP3_SPREAD_MS = 250;        // Three fingers landing this close together...
const TAP3_MAX_MS = 600;           // ...and all lifted this soon after the first, without wandering, is the shortcut.
const TAP3_SLOP_PX = 28;

const r2 = v => Math.round(v * 100) / 100;
const fin = v => (Number.isFinite(v) ? v : null);
const nodeName = n => (n?.nodeType === 1 ? n.tagName.toLowerCase() + (n.classList[0] ? '.' + n.classList[0] : '') : String(n?.nodeName ?? n));

// The controls' decision in one line: who holds L, R and the throw, and the fingers kept on suspicion.
export function stickSig(c) {
  const th = c.throw;
  let s = `L${c.left.id ?? '-'} R${c.right.id ?? '-'} T${th ? th.slot[0] + th.id : '-'}`;
  if (c.hold) s += ' hold';
  if (c.suspect.size) s += ' sus' + [...c.suspect.keys()].join(',');
  if (c.lost.size) s += ' lost' + [...c.lost.keys()].join(',');
  return s;
}

export function geometryOf(c) {
  return {
    w: c.width, lefty: c.lefty, rects: JSON.parse(JSON.stringify(c.rects)), lr: c.leftRadius, fr: c.fireRing,
    frel: c.fireRelease, kl: c.knobLimit, as: c.autoSprint !== false, tm: c.throwMax,
  };
}

// Everything controls.js decides from: enough for the replay to carry on from here as the phone did.
export function snapshotOf(c) {
  const copy = o => (o ? { ...o } : null);
  return {
    en: c.enabled,
    l: copy(c.left), r: { id: c.right.id, ox: c.right.ox, oz: c.right.oz, x: c.right.x, y: c.right.y, aim: c.right.aim, firing: c.right.firing },
    th: copy(c.throw), seen: copy(c.seen), miss: { left: copy(c.miss.left), right: copy(c.miss.right) }, hold: copy(c.hold),
    suspect: [...c.suspect], lost: [...c.lost].map(([k, v]) => [k, { ...v }]), spare: [...c.spare],
    bt: [...c.buttonTouch], bs: [...c.buttonSeen], bm: [...c.buttonMiss],
    te: fin(c.throwEndAt), lr: fin(c.lastRelease), sp: c.sprintOn,
    eq: JSON.parse(JSON.stringify(c.equip)), det: !!c.detonate, g: geometryOf(c),
  };
}

export function applyGeometry(c, g) {
  c.width = g.w; c.lefty = g.lefty; c.rects = JSON.parse(JSON.stringify(g.rects));
  c.leftRadius = g.lr; c.fireRing = g.fr; c.fireRelease = g.frel; c.knobLimit = g.kl; c.autoSprint = g.as; c.throwMax = g.tm;
}

export function restoreSnapshot(c, s) {
  c.enabled = s.en;
  Object.assign(c.left, s.l);
  Object.assign(c.right, s.r);
  c.throw = s.th ? { ...s.th } : null;
  Object.assign(c.seen, s.seen);
  c.miss.left = s.miss.left ? { ...s.miss.left } : null;
  c.miss.right = s.miss.right ? { ...s.miss.right } : null;
  c.hold = s.hold ? { ...s.hold } : null;
  c.suspect = new Map(s.suspect);
  c.lost = new Map(s.lost.map(([k, v]) => [k, { ...v }]));
  c.spare = new Map(s.spare);
  c.buttonTouch = new Map(s.bt); c.buttonSeen = new Map(s.bs); c.buttonMiss = new Map(s.bm);
  c.throwEndAt = s.te ?? -Infinity; c.lastRelease = s.lr ?? -Infinity; c.sprintOn = s.sp;
  for (const k of Object.keys(s.eq)) Object.assign(c.equip[k], s.eq[k]);
  c.detonate = s.det;
  applyGeometry(c, s.g);
}

// --- Report codes -----------------------------------------------------------------------------------------------------
const b64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = text => Uint8Array.from(atob(text), ch => ch.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeReport(report) {
  const bytes = new TextEncoder().encode(JSON.stringify(report));
  if (typeof CompressionStream === 'function') {
    try { return PREFIX_DEFLATE + b64(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch { /* fall through */ }
  }
  return PREFIX_PLAIN + b64(bytes);
}

export async function decodeReport(code) {
  const text = String(code).replace(/\s+/g, '');
  if (text.startsWith(PREFIX_DEFLATE)) {
    const raw = await pipe(unb64(text.slice(PREFIX_DEFLATE.length)), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(raw));
  }
  if (text.startsWith(PREFIX_PLAIN)) return JSON.parse(new TextDecoder().decode(unb64(text.slice(PREFIX_PLAIN.length))));
  throw new Error('Not a touch report code (it starts with SWT1)');
}

// --- Recorder ---------------------------------------------------------------------------------------------------------
export class TouchRecorder {
  constructor(controls, { build = '' } = {}) {
    this.controls = controls;
    this.build = build;
    this.on = false;
    this.ring = [];
    this.base = 0;                 // Absolute index of ring[0].
    this.ks = [];                  // Absolute indices of the checkpoints still in the ring.
    this.lastK = -Infinity;
    this.lastSig = '';
    this.nodes = new WeakMap();    // Touch target -> { i, tap, tuner }
    this.names = [];
    this.tap3 = null;
    this.starts = new Map();       // Recent touchstarts for the three-finger tap: id -> { at, x, y }
    this.onReport = null;          // () => void: the three-finger tap asked for a report.
  }

  setEnabled(on) {
    on = !!on;
    if (on === this.on) return;
    this.on = on;
    this.ring = []; this.base = 0; this.ks = []; this.lastK = -Infinity; this.lastSig = '';
    this.controls.rec = on ? this : null;
    if (on) this.#checkpoint(performance.now());
  }

  // Per target node, measured once: its index, the HUD tap element above it (if any) and whether it is the tuner.
  #node(n) {
    if (!n || typeof n !== 'object') return { i: -1, tap: null, tuner: false };
    let info = this.nodes.get(n);
    if (!info) {
      info = { i: this.names.length, tap: n.closest?.('[data-tap]') ?? null, tuner: !!n.closest?.('.tuner') };
      this.names.push(nodeName(n));
      this.nodes.set(n, info);
    }
    return info;
  }

  #list(list) {
    const out = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const t = list[i], info = this.#node(t.target);
      // Flags: 1 a visible HUD tap target, 2 the tuning panel. Visibility is checked only for HUD tap targets.
      const flags = (info.tap && info.tap.getClientRects().length > 0 ? 1 : 0) | (info.tuner ? 2 : 0);
      out[i] = [t.identifier, r2(t.clientX), r2(t.clientY), info.i * 4 + flags];
    }
    return out;
  }

  #sig() {
    const s = stickSig(this.controls);
    if (s === this.lastSig) return 0;
    this.lastSig = s;
    return s;
  }

  #push(entry) {
    this.ring.push(entry);
    if (this.ring.length > MAX_ENTRIES && this.ks.length > 1) this.#cut();
  }

  #cut() {
    const n = this.ks[1] - this.base;
    this.ring.splice(0, n);
    this.base += n;
    this.ks.shift();
  }

  #checkpoint(now) {
    this.lastK = now;
    this.lastSig = stickSig(this.controls);
    this.ks.push(this.base + this.ring.length);
    this.ring.push(['K', r2(now), snapshotOf(this.controls), this.lastSig]);
    // The ring starts at the newest checkpoint that is at least WINDOW_MS old.
    while (this.ks.length > 1 && this.ring[this.ks[1] - this.base][1] <= now - WINDOW_MS) this.#cut();
  }

  // From the controls' window (or detached-node) listeners, after the event was handled.
  event(e, detached = false) {
    const type = TYPE[e.type];
    if (!type) return;
    const now = performance.now();
    const d = now - e.timeStamp;
    const tg = this.#node(e.target).i;
    this.#push([type, r2(e.timeStamp), Math.abs(d) >= 0.5 ? r2(d) : 0, tg, (detached ? 1 : 0) | (e.target?.isConnected === false ? 2 : 0),
      this.#list(e.changedTouches), this.#list(e.touches), this.#sig()]);
    this.#tap3Check(e, e.timeStamp);
    if (now - this.lastK >= CHECK_MS) this.#checkpoint(now);
  }

  // From Controls.read(), once per frame while enabled, after its own timed drops. Runs of frames fold into one entry.
  frame(now) {
    const sig = this.#sig();
    const top = this.ring[this.ring.length - 1];
    if (!sig && top?.[0] === 'F') { top[2] = r2(now); top[3]++; }
    else this.#push(['F', r2(now), r2(now), 1, sig]);
    if (now - this.lastK >= CHECK_MS) this.#checkpoint(now);
  }

  note(text) { this.#push(['N', r2(performance.now()), text]); }

  // E enabled, Q equipment count, D detonator, G geometry: what else changes a touch's meaning.
  mark(kind, ...args) {
    if (kind === 'G') args = [geometryOf(this.controls)];
    this.#push([kind, r2(performance.now()), ...args]);
  }

  // A three-finger tap: three fingers down within TAP3_SPREAD_MS, all up within TAP3_MAX_MS, none wandering.
  #tap3Check(e, now) {
    if (e.type === 'touchstart') {
      for (const t of e.changedTouches) {
        if (this.starts.size >= 8) this.starts.delete(this.starts.keys().next().value);
        this.starts.set(t.identifier, { at: now, x: t.clientX, y: t.clientY });
      }
      if (e.touches.length === 3) {
        const got = [...e.touches].map(t => this.starts.get(t.identifier));
        if (got.every(s => s && now - s.at <= TAP3_SPREAD_MS)) this.tap3 = { at: Math.min(...got.map(s => s.at)), ids: new Set([...e.touches].map(t => t.identifier)), up: 0 };
        else this.tap3 = null;
      } else if (e.touches.length > 3) this.tap3 = null;
      return;
    }
    const tap = this.tap3;
    if (!tap) return;
    if (now - tap.at > TAP3_MAX_MS) { this.tap3 = null; return; }
    for (const t of e.changedTouches) {
      if (!tap.ids.has(t.identifier)) continue;
      const s = this.starts.get(t.identifier);
      if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > TAP3_SLOP_PX) { this.tap3 = null; return; }
      if (e.type !== 'touchmove') tap.up++;
    }
    if (tap.up >= 3) {
      this.tap3 = null;
      this.onReport?.();
    }
  }

  // The ring as it stands, from its oldest checkpoint, as a report object.
  freeze() {
    const ring = this.ring.slice();
    const vv = typeof window !== 'undefined' ? window : {};
    return {
      v: 1, build: this.build, made: new Date().toISOString(), ua: vv.navigator?.userAgent ?? '',
      screen: [vv.innerWidth ?? 0, vv.innerHeight ?? 0, vv.devicePixelRatio ?? 1], names: this.names.slice(), ring,
    };
  }

  async exportCode() {
    return encodeReport(this.freeze());
  }
}

// --- The report sheet -------------------------------------------------------------------------------------------------
const SHEET_CSS = `
.trec-sheet { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center;
  background: rgba(4,6,8,.72); font: 13px/1.35 system-ui, sans-serif; color: #e7eae4; pointer-events: auto; }
.trec-sheet[hidden] { display: none; }
.trec-box { width: min(520px, 92vw); max-height: 88vh; display: flex; flex-direction: column; gap: 8px; padding: 14px 16px;
  background: #151a20; box-shadow: inset 0 0 0 1px rgba(242,166,59,.6); }
.trec-box h3 { margin: 0; font-size: 16px; color: #f2a63b; }
.trec-box p { margin: 0; color: #c9cec6; }
.trec-code { width: 100%; height: 96px; resize: none; font: 10px/1.25 ui-monospace, Menlo, monospace; color: #b8f0c0;
  background: #0b0e12; border: 1px solid #2a323b; word-break: break-all; }
.trec-row { display: flex; gap: 8px; justify-content: flex-end; }
.trec-row button { height: 34px; padding: 0 16px; font: 600 13px/1 system-ui, sans-serif; color: #fff; background: #2a323b; border: 0; }
.trec-row .trec-copy { background: #b5711b; }
.board-stickrep { flex: none; height: 32px; padding: 0 12px; font: 400 12px/1 var(--f-stencil, system-ui); letter-spacing: var(--tr-stencil, 0);
  color: var(--c-chalk, #eee); background: var(--face-steel-hi, #333); box-shadow: var(--bevel-hi, none); pointer-events: auto; }
.board-stickrep[hidden] { display: none; }`;

function copyText(text, fallbackEl) {
  const viaSelect = () => {
    try {
      fallbackEl.select();
      fallbackEl.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      fallbackEl.blur();
      document.getSelection()?.removeAllRanges();
      return ok;
    } catch { return false; }
  };
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => viaSelect());
  return Promise.resolve(viaSelect());
}

// The sheet and the scoreboard button. Every tappable part carries data-tap so the controls leave its touches alone.
export class ReportSheet {
  constructor(recorder) {
    this.rec = recorder;
    this.busy = false;
    const st = document.createElement('style');
    st.textContent = SHEET_CSS;
    document.head.appendChild(st);
    const el = this.el = document.createElement('div');
    el.className = 'trec-sheet';
    el.hidden = true;
    el.setAttribute('data-tap', '1');
    el.innerHTML = `<div class="trec-box">
      <h3>Touch report</h3>
      <p class="trec-msg">Making the report…</p>
      <textarea class="trec-code" readonly spellcheck="false" data-tap="1"></textarea>
      <div class="trec-row"><button class="trec-close" data-tap="1">Close</button><button class="trec-copy" data-tap="1">Copy</button></div>
    </div>`;
    document.body.appendChild(el);
    this.msg = el.querySelector('.trec-msg');
    this.codeEl = el.querySelector('.trec-code');
    el.querySelector('.trec-close').addEventListener('click', () => { el.hidden = true; });
    el.querySelector('.trec-copy').addEventListener('click', () => this.#copy());
    recorder.onReport = () => this.open();
  }

  // The scoreboard's footer gets a "Stick died?" button, shown only while recording.
  attachBoard(foot) {
    if (!foot || this.boardBtn) return;
    const b = this.boardBtn = document.createElement('button');
    b.className = 'board-stickrep';
    b.setAttribute('data-tap', '1');
    b.textContent = 'Stick died?';
    b.hidden = !this.rec.on;
    b.addEventListener('click', () => this.open());
    foot.insertBefore(b, foot.querySelector('.board-leave'));
  }

  sync() {
    if (this.boardBtn) this.boardBtn.hidden = !this.rec.on;
  }

  async open() {
    if (!this.rec.on || this.busy) return;
    this.busy = true;
    const report = this.rec.freeze();   // Frozen now: what happens while the sheet is up is not in this report.
    this.el.hidden = false;
    this.msg.textContent = 'Making the report…';
    this.codeEl.value = '';
    try {
      const code = this.code = await encodeReport(report);
      this.codeEl.value = code;
      const copied = await copyText(code, this.codeEl).catch(() => false);
      this.msg.textContent = copied
        ? 'Copied. Paste it to us with a few words about what happened. It holds only the last 20 seconds of touches.'
        : 'Tap Copy, then paste it to us with a few words about what happened. It holds only the last 20 seconds of touches.';
    } catch (err) {
      this.msg.textContent = `Could not make the report: ${err?.message ?? err}`;
    } finally {
      this.busy = false;
    }
  }

  async #copy() {
    if (!this.code) return;
    const ok = await copyText(this.code, this.codeEl).catch(() => false);
    this.msg.textContent = ok ? 'Copied. Paste it to us with a few words about what happened.' : 'Select the code and copy it by hand.';
  }
}
