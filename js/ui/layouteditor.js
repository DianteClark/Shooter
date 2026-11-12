// Options > Accessibility > Touch layout: drag the match's touch controls where the thumbs want them and resize them.
// A full-screen editor over the menu, drawn with the match's own control classes (css/game.css) and placed by the same
// pass the match uses (js/ui/layout.js placeControls), so the preview is exactly what a match gets. Tap a control to
// pick it, drag it to move it, and size it with the minus and plus buttons. A control dropped on another is pushed clear
// of it; nothing goes into the band the HUD keeps along the top, or past the safe area. Save writes Options.layout.
import { Options } from './options.js';
import { TUNING } from '../shared/tuning.js';
import { icon } from './icons.js';
import { ico } from './yard.js';
import { esc } from './widgets.js';
import { safeInsets } from './viewport.js';
import { LAYOUT_ITEMS, SCALE_STEP, TOP_BAND, placeControls, sanitizeLayout, scaleOf, toFractions } from './layout.js';

const CSS = `
.lay-ed { position: absolute; inset: 0; z-index: var(--z-sheet); background: radial-gradient(120% 100% at 50% 100%, #252d36, #10141a) #10141a; opacity: 1; touch-action: none; user-select: none; -webkit-user-select: none; overflow: hidden; }
.lay-ed .lay-band { position: absolute; top: 0; pointer-events: none; background: repeating-linear-gradient(-45deg, rgba(231,234,228,.07) 0 8px, transparent 8px 16px); box-shadow: inset 0 -1px 0 rgba(231,234,228,.22); }
.lay-ed .lay-band span { position: absolute; bottom: 4px; font: 9px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-rail); text-transform: uppercase; }
.lay-ed .lay-band.move span { left: calc(var(--sl) + 10px); }
.lay-ed .lay-band.aim span { right: calc(var(--sr) + 10px); }
.lay-ed .controls.lay-mock { pointer-events: none; z-index: 1; }
.lay-ed .lay-mock .tbtn, .lay-ed .lay-mock .st-tile { pointer-events: none; }
.lay-ed .lay-mock .tbtn-count { display: none; }
.lay-ed .lay-ring { position: absolute; left: 0; top: 0; border-radius: 50%; pointer-events: none; box-shadow: inset 0 0 0 2px rgba(231,234,228,.7); background: radial-gradient(circle, rgba(231,234,228,.16) 0 22%, rgba(16,20,26,.2) 23%); }
.lay-ed .lay-ring b { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font: 10px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); white-space: nowrap; text-transform: uppercase; }
.lay-ed .lay-chips { position: absolute; top: calc(var(--st) + 7px); right: calc(var(--sr) + 8px); display: flex; gap: 6px; transform-origin: right top; z-index: 1; }
.lay-ed.lefty .lay-chips { right: auto; left: calc(var(--sl) + 8px); transform-origin: left top; flex-direction: row-reverse; }
.lay-ed .lay-chips i { width: 36px; height: 36px; display: grid; place-items: center; background: rgba(16,20,26,.8); box-shadow: inset 0 0 0 1px rgba(231,234,228,.3); color: var(--c-chalk); }
.lay-ed .sel { outline: 2px dashed var(--c-sodium); outline-offset: 4px; }
.lay-ed .lay-ring.sel { outline-offset: 2px; }
.lay-ed .clash { outline: 2px solid var(--c-red); outline-offset: 4px; }
.lay-ed .lay-bar { position: absolute; left: 50%; top: calc(var(--st) + 6px); transform: translateX(-50%); z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 4px; width: min(410px, calc(100% - 290px)); }
.lay-ed .lay-row { display: flex; gap: 4px; align-items: center; justify-content: center; flex-wrap: wrap; }
.lay-ed .lay-bar button { height: 32px; min-width: 32px; padding: 0 9px; display: flex; align-items: center; justify-content: center; gap: 5px; border: 0; color: var(--c-chalk); background: var(--face-steel); box-shadow: var(--bevel), var(--edge); font: 400 12px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); white-space: nowrap;
  --cut: var(--cut-xs); clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)); }
.lay-ed .lay-bar button:disabled { opacity: .35; }
.lay-ed .lay-bar button.go { background: var(--face-sodium); color: var(--c-sodium-ink); box-shadow: var(--bevel-sodium); }
.lay-ed .lay-bar button.on { box-shadow: var(--bevel), inset 0 0 0 2px var(--c-sodium); }
.lay-ed .lay-bar .ico { height: 14px; }
.lay-ed .lay-pick { min-width: 118px; padding: 0 8px; height: 32px; display: flex; flex-direction: column; justify-content: center; align-items: center; background: rgba(16,20,26,.8); box-shadow: var(--edge); }
.lay-ed .lay-pick b { font: 400 12px/1.1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-sodium); white-space: nowrap; }
.lay-ed .lay-pick small { font: 9px/1.1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); white-space: nowrap; }
`;

let styled = false;
const BUTTON_ICON = { slide: 'slide', swap: 'swap', tactical: 'smoke', lethal: 'frag' };
const BUTTON_IDS = ['slide', 'swap', 'tactical', 'lethal'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const byId = Object.fromEntries(LAYOUT_ITEMS.map(i => [i.id, i]));

// Opens the editor. onClose() runs after it closes (saved or not).
export function layoutEditor({ onClose } = {}) {
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    styled = true;
  }
  const host = document.getElementById('ui') ?? document.body;
  host.querySelector('.lay-ed')?.remove();
  let layout = JSON.parse(JSON.stringify(Options.get('layout') ?? {}));
  let lefty = !!Options.get('lefty');
  let selected = 'slide';
  let placement = null;
  let drag = null;

  const el = document.createElement('div');
  el.className = 'lay-ed';
  el.dataset.tap = 'layout';
  el.innerHTML = `
    <div class="lay-band move"><span>Minimap and feed</span></div><div class="lay-band aim"><span>Weapon panel</span></div>
    <div class="controls live lay-mock">
      <i class="rest rest-l"></i><i class="rest rest-r"></i>
      ${BUTTON_IDS.map(b => `<button class="tbtn tbtn-${b}" tabindex="-1">${icon(BUTTON_ICON[b])}<span class="tbtn-label">${esc(byId[b].label)}</span></button>`).join('')}
      <div class="streaks"><div class="stk-row"><div class="st-score"><span>Score</span><b>0</b></div>${[0, 1, 2].map(() => `<div class="st-tile"><span class="st-icon">${icon('uav', { size: 18 })}</span></div>`).join('')}</div></div>
    </div>
    <div class="lay-ring" data-id="move"><b>Move</b></div><div class="lay-ring" data-id="aim"><b>Aim and fire</b></div>
    <div class="lay-chips" data-id="chips"><i>${icon('ui:chat', { size: 18 })}</i><i>${icon('ui:user', { size: 18 })}</i><i>${icon('ui:mic', { size: 18 })}</i></div>
    <div class="lay-bar">
      <div class="lay-row">
        <button data-k="cancel">${ico('close')}Cancel</button>
        <span class="lay-pick"><b></b><small></small></span>
        <button data-k="smaller" aria-label="Smaller">${ico('minus')}</button>
        <button data-k="bigger" aria-label="Bigger">${ico('plus')}</button>
      </div>
      <div class="lay-row">
        <button data-k="reset">${ico('ui:refresh')}Reset</button>
        <button data-k="resetAll">Reset all</button>
        <button data-k="hand">Left hand</button>
        <button data-k="save" class="go">${ico('ui:check')}Save</button>
      </div>
    </div>`;
  host.appendChild(el);
  const mock = el.querySelector('.lay-mock');
  const rings = { move: el.querySelector('.lay-ring[data-id="move"]'), aim: el.querySelector('.lay-ring[data-id="aim"]') };
  const chips = el.querySelector('.lay-chips');
  const bar = el.querySelector('.lay-bar');
  const nodeOf = id => id === 'move' || id === 'aim' ? rings[id] : id === 'chips' ? chips : mock.querySelector(byId[id].sel);

  const env = () => {
    const ins = safeInsets();
    return { W: el.clientWidth, H: el.clientHeight, safe: { t: ins.top, r: ins.right, b: ins.bottom, l: ins.left } };
  };
  const radius = () => ({
    move: TUNING.leftSize * scaleOf(layout, 'move') + 6,
    aim: TUNING.fireRing / (Options.get('sensitivity') || 1) * scaleOf(layout, 'aim') + 15,
  });

  const paint = (active = null) => {
    const { W, H, safe } = env();
    el.classList.toggle('lefty', lefty);
    mock.classList.toggle('lefty', lefty);
    mock.style.setProperty('--tile-k', scaleOf(layout, 'streaks'));
    mock.style.setProperty('--rp-x', `${Math.round(W / 2 + (lefty ? -190 : 20))}px`);
    const rad = radius();
    placement = placeControls(mock, layout, { W, H, safe, lefty, radius: rad, active });
    for (const id of ['move', 'aim']) {
      const b = placement.boxes[id], r = rad[id], s = rings[id].style;
      s.width = s.height = `${Math.round(r * 2)}px`;
      s.transform = `translate(${Math.round(b.cx - r)}px, ${Math.round(b.cy - r)}px)`;
    }
    chips.style.scale = String(scaleOf(layout, 'chips'));
    // The bands the HUD keeps: the move side's is deeper (the feed's rows under the minimap).
    const h = H - safe.t - safe.b;
    const bands = el.querySelectorAll('.lay-band');
    const moveLeft = !lefty;
    for (const band of bands) {
      const side = band.classList.contains('move') ? 'move' : 'aim', left = (side === 'move') === moveLeft;
      band.style.left = left ? '0' : '50%';
      band.style.width = '50%';
      band.style.height = `${Math.round(safe.t + h * TOP_BAND[side])}px`;
    }
    for (const it of LAYOUT_ITEMS) {
      const n = nodeOf(it.id);
      n?.classList.toggle('sel', it.id === selected);
      n?.classList.toggle('clash', placement.conflicts.includes(it.id));
    }
    const it = byId[selected], s = scaleOf(layout, selected);
    bar.querySelector('.lay-pick b').textContent = it.label;
    bar.querySelector('.lay-pick small').textContent = `Size ${Math.round(s * 100)}%${it.kind === 'chips' ? ' . stays in the corner' : layout[selected]?.x !== undefined ? ' . moved' : ''}`;
    bar.querySelector('[data-k="smaller"]').disabled = s <= it.min + 1e-6;
    bar.querySelector('[data-k="bigger"]').disabled = s >= it.max - 1e-6;
    bar.querySelector('[data-k="reset"]').disabled = !layout[selected];
    bar.querySelector('[data-k="resetAll"]').disabled = !Object.keys(layout).length;
    bar.querySelector('[data-k="hand"]').classList.toggle('on', lefty);
  };

  // The control under a point: sticks by their ring, the rest by their box; the smallest box wins.
  const hit = (x, y) => {
    const cr = chips.getBoundingClientRect();
    if (x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom) return 'chips';
    let best = null, area = Infinity;
    for (const [id, b] of Object.entries(placement?.boxes ?? {})) {
      const it = byId[id];
      let inside;
      if (it.kind === 'stick') inside = Math.hypot(x - b.cx, y - b.cy) <= (b.x1 - b.x0) / 2;
      else inside = x >= b.x0 - 6 && x <= b.x1 + 6 && y >= b.y0 - 6 && y <= b.y1 + 6;
      const a = (b.x1 - b.x0) * (b.y1 - b.y0);
      if (inside && a < area) { best = id; area = a; }
    }
    return best;
  };

  const setScale = d => {
    const it = byId[selected];
    const s = clamp(Math.round((scaleOf(layout, selected) + d * SCALE_STEP) * 100) / 100, it.min, it.max);
    layout[selected] = { ...(layout[selected] ?? {}), s };
    if (s === 1) delete layout[selected].s;
    if (!Object.keys(layout[selected]).length) delete layout[selected];
    paint();
    settle(selected);
  };

  // After a move or a resize, store where the pass really put the control (it may have pushed it clear of another).
  const settle = id => {
    if (!layout[id] || !Number.isFinite(layout[id].x)) return;
    const b = placement.boxes[id];
    if (!b) return;
    const { W, H, safe } = env();
    Object.assign(layout[id], toFractions(b.cx, b.cy, W, H, safe, lefty));
    paint();
  };

  const close = save => {
    if (save) Options.set('layout', sanitizeLayout(layout));
    window.removeEventListener('resize', onResize);
    el.remove();
    onClose?.();
  };

  bar.addEventListener('click', e => {
    const k = e.target.closest('button')?.dataset.k;
    if (!k) return;
    if (k === 'cancel') close(false);
    else if (k === 'save') close(true);
    else if (k === 'smaller') setScale(-1);
    else if (k === 'bigger') setScale(1);
    else if (k === 'reset') { delete layout[selected]; paint(); }
    else if (k === 'resetAll') { layout = {}; paint(); }
    else if (k === 'hand') { lefty = !lefty; paint(); }
  });

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.lay-bar')) return;
    const id = hit(e.clientX, e.clientY);
    if (!id) return;
    e.preventDefault();
    selected = id;
    if (id === 'chips') { paint(); return; }
    const b = placement.boxes[id];
    drag = { id, pointer: e.pointerId, dx: e.clientX - b.cx, dy: e.clientY - b.cy, moved: false, x0: e.clientX, y0: e.clientY };
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    paint();
  });
  el.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    drag.moved = true;
    const { W, H, safe } = env();
    layout[drag.id] = { ...(layout[drag.id] ?? {}), ...toFractions(e.clientX - drag.dx, e.clientY - drag.dy, W, H, safe, lefty) };
    paint(drag.id);
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const id = drag.id;
    drag = null;
    paint();
    settle(id);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  const onResize = () => paint();
  window.addEventListener('resize', onResize);
  paint();
  return { el, close, get layout() { return layout; } };
}
