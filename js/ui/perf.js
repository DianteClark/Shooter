// Performance overlay: frame rate, frame time, 1% low, where the time goes, draw calls and the quality step.
// Turned on in Options or with ?fps=1. It must not cost what it measures: four refreshes a second, a fixed-size box
// with `contain: strict`, and only Text node data changes, so an update repaints a few glyphs and lays out nothing.
import { frameClock } from '../render/quality.js';

const REFRESH_MS = 250;
const RECENT_MS = 500;        // Frames averaged for the headline numbers.

let styled = false;
function ensureStyle() {
  if (styled) return;
  styled = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../css/perf.css', import.meta.url).href;
  document.head.appendChild(link);
}

export class PerfOverlay {
  // source(): the match renderer's getStats() result, or null outside a match.
  constructor(root, source) {
    ensureStyle();
    this.source = source;
    this.el = document.createElement('div');
    this.el.className = 'perf';
    this.el.setAttribute('aria-hidden', 'true');
    this.lines = [];
    for (let i = 0; i < 5; i++) {
      const row = document.createElement('div');
      const text = document.createTextNode('');
      row.appendChild(text);
      this.el.appendChild(row);
      this.lines.push(text);
    }
    this.lines.at(-1).parentNode.className = 'perf-dim';
    root.appendChild(this.el);
    this.sorted = new Float32Array(frameClock.interval.length);
    this.timer = 0;
    this.visible = false;
    this.el.hidden = true;
  }

  setVisible(on) {
    on = !!on;
    if (on === this.visible) return;
    this.visible = on;
    this.el.hidden = !on;
    clearInterval(this.timer);
    if (on) { this.timer = setInterval(() => this.refresh(), REFRESH_MS); this.refresh(); }
  }

  // Text nodes are only written when their content changes.
  _set(i, s) { if (this.lines[i].data !== s) this.lines[i].data = s; }

  refresh() {
    const C = frameClock, n = C.count, ring = C.interval.length;
    const st = this.source();
    // Menus draw no frames of their own worth measuring; the box only shows during a match.
    const idle = !st || !n;
    if (idle !== this.el.classList.contains('idle')) this.el.classList.toggle('idle', idle);
    if (idle) return;
    // Headline: the most recent half second.
    let sumI = 0, sumW = 0, k = 0;
    for (let j = 1; j <= n && sumI < RECENT_MS; j++) {
      const i = (C.head - j + ring) % ring;
      sumI += C.interval[i]; sumW += C.work[i]; k++;
    }
    const avgI = sumI / k, avgW = sumW / k;
    // 1% low over the whole ring (up to ~8 s at 60 Hz): the frame time 1% of frames are slower than.
    const s = this.sorted;
    for (let j = 0; j < n; j++) s[j] = C.interval[j];
    const view = n === s.length ? s : s.subarray(0, n);
    view.sort();
    const p99 = view[Math.min(n - 1, Math.floor(n * 0.99))];
    this._set(0, `${Math.round(1000 / avgI)} fps  ${avgI.toFixed(1)} ms  1% low ${Math.round(1000 / p99)}`);

    const target = st && st.cap30 ? 1000 / 30 : 1000 / 60;
    let hint;
    if (st && st.cap30) hint = 'held at 30 Hz (Low Power Mode?)';
    else if (avgI <= target * 1.1) hint = `on time (${Math.round(avgW / target * 100)}% budget)`;
    // Late frames with the script busy for most of the interval: the CPU is the limit. Late frames with the script
    // mostly idle: the wait is the GPU (or the compositor), since iOS exposes no GPU timer to measure it directly.
    else if (avgW >= avgI * 0.75) hint = 'CPU-bound';
    else hint = 'GPU-bound';
    this._set(1, `script ${avgW.toFixed(1)} ms  ${hint}`);
    const tris = st.triangles >= 1000 ? `${(st.triangles / 1000).toFixed(1)}k` : String(st.triangles);
    this._set(2, `calls ${st.calls}  tris ${tris}  draw ${st.renderMs.toFixed(1)} ms`);
    const heat = st.thermal ? '  HOT' : st.heat > 1.15 ? `  warm x${st.heat.toFixed(2)}` : '';
    this._set(3, `${st.stepLabel}${st.auto ? ' (auto)' : ''}  dpr ${st.dpr.toFixed(2)}  fog ${st.fogTexels}/m${heat}`);
    const p = st.profile;
    this._set(4, p ? `${st.auto && st.reason ? st.reason + ' · ' : ''}phone: ${p.step} (${p.why})` : '');
  }

  dispose() {
    clearInterval(this.timer);
    this.el.remove();
  }
}
