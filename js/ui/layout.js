// Custom touch layout (Options > Accessibility > Touch layout, js/ui/layouteditor.js, docs/ACCESSIBILITY.md).
// Options.layout holds only what the player changed: id -> { x, y, s }. x and y are the control's centre as fractions of
// the safe area (x from the left edge in the right-handed layout; the left-handed one mirrors it), so one layout fits
// every phone. s is its size. An id that is missing, or has no x, stays where css/game.css puts it.
//
// placeControls() is the one placement pass, shared by the match (js/ui/controls.js #measure) and the editor's preview,
// so what the editor shows is what the match gets. It keeps every moved control inside the safe area, under the band
// the HUD keeps at the top (score, minimap and feed, corner chips and weapon panel), each stick on its own thumb's half,
// and off every other control: a moved control that lands on another is pushed clear of it.

export const LAYOUT_ITEMS = [
  { id: 'move', label: 'Move stick', sel: '.rest-l', kind: 'stick', side: 'move', min: 0.8, max: 1.3 },
  { id: 'aim', label: 'Aim stick', sel: '.rest-r', kind: 'stick', side: 'aim', min: 0.8, max: 1.3 },
  { id: 'slide', label: 'Slide', sel: '.tbtn-slide', kind: 'button', min: 0.75, max: 1.5 },
  { id: 'swap', label: 'Swap', sel: '.tbtn-swap', kind: 'button', min: 0.75, max: 1.5 },
  { id: 'tactical', label: 'Tactical', sel: '.tbtn-tactical', kind: 'button', min: 0.75, max: 1.5 },
  { id: 'lethal', label: 'Lethal', sel: '.tbtn-lethal', kind: 'button', min: 0.75, max: 1.5 },
  // The streak tiles never go under their touch size (44 px with slop), so they only grow.
  { id: 'streaks', label: 'Streaks', sel: '.streaks', measure: '.stk-row', kind: 'group', min: 1, max: 1.4 },
  // Mic, quick chat and emote stay in the HUD's top corner (the band the editor keeps clear); only their size changes.
  { id: 'chips', label: 'Mic, chat, emote', kind: 'chips', min: 0.8, max: 1.4 },
];
export const SCALE_STEP = 0.1;
const BY_ID = Object.fromEntries(LAYOUT_ITEMS.map(i => [i.id, i]));

// Fractions of the safe height kept for the HUD's top groups: deeper on the move thumb's side, where the kill feed's two
// rows sit under the minimap, than on the aim side, where the weapon panel shrinks to fit over the buttons.
export const TOP_BAND = { move: 0.42, aim: 0.34 };
const EDGE = 4;                  // Pixels kept from the safe area's edge.
const GAP = 4;                   // Pixels kept between two controls.
const STICK_HIT = 0.55;          // Of a stick's radius: the part another control may not cover (the ring's rim may).

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, n = 1000) => Math.round(v * n) / n;

export function sanitizeLayout(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    const it = BY_ID[id];
    if (!it || !v || typeof v !== 'object') continue;
    const o = {};
    if (it.kind !== 'chips' && Number.isFinite(v.x) && Number.isFinite(v.y)) { o.x = round(clamp(v.x, 0, 1)); o.y = round(clamp(v.y, 0, 1)); }
    if (Number.isFinite(v.s)) o.s = round(clamp(v.s, it.min, it.max), 100);
    if (o.s === 1) delete o.s;
    if (Object.keys(o).length) out[id] = o;
  }
  return out;
}

export const scaleOf = (layout, id) => layout?.[id]?.s ?? 1;
export const isPlaced = (layout, id) => Number.isFinite(layout?.[id]?.x);
export const layoutIsDefault = layout => !layout || Object.keys(layout).length === 0;

// The safe area as the editor and the match both see it: inset rectangle in CSS pixels.
export function safeRect(W, H, safe) {
  return { x0: safe.l, y0: safe.t, x1: W - safe.r, y1: H - safe.b, w: W - safe.l - safe.r, h: H - safe.t - safe.b };
}

// Where a control's centre may go: inside the safe area, under the top band for its side, a stick on its own half.
// `half` is the control's half size; for a stick, its ring radius. `lefty` mirrors the sides.
function limits(it, half, area, W, lefty) {
  const sideOf = cx => ((cx < W / 2) !== lefty ? 'move' : 'aim');
  let x0 = area.x0 + EDGE + half.w, x1 = area.x1 - EDGE - half.w;
  if (it.kind === 'stick') {
    const moveLeft = !lefty;   // The move stick's half is the left one unless left-handed.
    const onLeft = it.side === 'move' ? moveLeft : !moveLeft;
    if (onLeft) x1 = Math.min(x1, W / 2 - 12); else x0 = Math.max(x0, W / 2 + 12);
  }
  const y1 = area.y1 - EDGE - half.h;
  const yFor = cx => Math.min(y1, area.y0 + area.h * TOP_BAND[sideOf(cx)] + half.h);
  return { x0, x1, y1, yFor };
}

const overlap = (a, b) => a.x0 < b.x1 + GAP && b.x0 < a.x1 + GAP && a.y0 < b.y1 + GAP && b.y0 < a.y1 + GAP;

// Lays out the controls under `root` (a .controls element) for `layout`. env: { W, H, safe: {t, r, b, l}, lefty,
// radius: { move, aim } (ring radii in px, already scaled), active (the id being dragged: it gives way to every other) }.
// Returns { boxes: id -> {x0, y0, x1, y1, cx, cy}, conflicts: [id] } for the editor and the tests.
export function placeControls(root, layout, env) {
  const { W, H, safe, lefty = false, radius = { move: 64, aim: 70 }, active = null } = env;
  const area = safeRect(W, H, safe);
  const nodes = [];
  for (const it of LAYOUT_ITEMS) {
    if (!it.sel) continue;
    const el = root.querySelector(it.sel);
    if (!el) continue;
    const c = layout?.[it.id];
    const s = el.style;
    s.left = s.top = s.right = s.bottom = s.translate = s.scale = '';
    el.classList.remove('placed');
    if (it.kind === 'button' && c?.s && c.s !== 1) s.scale = String(c.s);
    const placed = Number.isFinite(c?.x);
    if (placed) {
      const fx = lefty ? 1 - c.x : c.x;
      s.left = `${Math.round(area.x0 + area.w * fx)}px`;
      s.top = `${Math.round(area.y0 + area.h * c.y)}px`;
      s.right = s.bottom = 'auto';
      if (it.kind !== 'stick') s.translate = '-50% -50%';
      el.classList.add('placed');
    }
    nodes.push({ it, el, placed });
  }
  // Measure once, then settle the moved ones numerically: fixed controls first, the one being dragged last.
  const boxes = {};
  const list = nodes.map(n => {
    const m = n.it.measure ? n.el.querySelector(n.it.measure) ?? n.el : n.el;
    const r = m.getBoundingClientRect();
    const shown = r.width > 0 || n.it.kind === 'stick';
    if (!shown || getComputedStyle(n.el).display === 'none') return null;
    let cx, cy, hw, hh, hit;
    if (n.it.kind === 'stick') {
      const rad = radius[n.it.id] ?? 64;
      cx = r.left; cy = r.top; hw = hh = rad; hit = rad * STICK_HIT;
    } else {
      cx = (r.left + r.right) / 2; cy = (r.top + r.bottom) / 2; hw = r.width / 2; hh = r.height / 2; hit = null;
    }
    return { ...n, cx, cy, hw, hh, hit, dx: n.placed ? cx - parseFloat(n.el.style.left) : 0, dy: n.placed ? cy - parseFloat(n.el.style.top) : 0 };
  }).filter(Boolean);
  // A box for overlap tests: a stick counts by the part a thumb starts on, not its whole ring.
  const hitBox = n => {
    const w = n.hit ?? n.hw, h = n.hit ?? n.hh;
    return { x0: n.cx - w, y0: n.cy - h, x1: n.cx + w, y1: n.cy + h };
  };
  const order = [...list.filter(n => !n.placed), ...list.filter(n => n.placed && n.it.id !== active), ...list.filter(n => n.placed && n.it.id === active)];
  const settled = [], conflicts = [];
  for (const n of order) {
    // Streak tiles left in the dock move with the layout pass (js/ui/hud.js), which keeps them off the buttons.
    if (!n.placed) { if (n.it.kind !== 'group') settled.push(n); continue; }
    const lim = limits(n.it, { w: n.hw, h: n.hh }, area, W, lefty);
    const fit = () => {
      n.cx = clamp(n.cx, lim.x0, Math.max(lim.x0, lim.x1));
      n.cy = clamp(n.cy, Math.min(lim.yFor(n.cx), lim.y1), lim.y1);
    };
    fit();
    let clash = null;
    for (let pass = 0; pass < 10; pass++) {
      clash = null;
      for (const o of settled) {
        const a = hitBox(n), b = hitBox(o);
        if (!overlap(a, b)) continue;
        clash = o;
        // Out along the shallower axis, away from the other control's centre.
        const px = Math.min(a.x1 - b.x0, b.x1 - a.x0) + GAP, py = Math.min(a.y1 - b.y0, b.y1 - a.y0) + GAP;
        const sx = n.cx < o.cx ? -1 : 1, sy = n.cy < o.cy ? -1 : 1;
        const before = { x: n.cx, y: n.cy };
        if (px <= py) n.cx += sx * px; else n.cy += sy * py;
        fit();
        // Pinned by an edge: try the other axis, then the other way.
        if (overlap(hitBox(n), b) && n.cx === before.x && n.cy === before.y) {
          if (px <= py) n.cy += sy * py; else n.cx += sx * px;
          fit();
          if (overlap(hitBox(n), b)) { if (px <= py) n.cx -= 2 * sx * px; else n.cy -= 2 * sy * py; fit(); }
        }
      }
      if (!clash) break;
    }
    if (clash) conflicts.push(n.it.id);
    n.el.style.left = `${Math.round(n.cx - n.dx)}px`;
    n.el.style.top = `${Math.round(n.cy - n.dy)}px`;
    settled.push(n);
  }
  for (const n of list) boxes[n.it.id] = { x0: n.cx - n.hw, y0: n.cy - n.hh, x1: n.cx + n.hw, y1: n.cy + n.hh, cx: n.cx, cy: n.cy };
  return { boxes, conflicts };
}

// The stored centre for a control at (cx, cy) on this screen: the inverse of placeControls' mapping.
export function toFractions(cx, cy, W, H, safe, lefty) {
  const area = safeRect(W, H, safe);
  const fx = (cx - area.x0) / area.w, fy = (cy - area.y0) / area.h;
  return { x: round(clamp(lefty ? 1 - fx : fx, 0, 1)), y: round(clamp(fy, 0, 1)) };
}
