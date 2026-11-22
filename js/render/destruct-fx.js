// Destruction's picture (docs/DESTRUCTION.md "Picture"). No draw call per piece and none per break:
//   - every breakable piece is drawn into the ordinary world mesh (and its shadow into the decal mesh) while
//     BreakRanges remembers which vertices are its own; a rubble set for it is drawn beside it and collapsed;
//   - a stage change rewrites those vertex ranges in place: broken collapses the piece and its shadow to a point and
//     opens its rubble, damaged darkens its colours; only the changed ranges are uploaded;
//   - chunks fly from the shared VFX shard pool and dust from its particle batch (both one draw each, already there).
// The renderer feeds DestructFx the view's break string (`view.brk`) and the frame's `brk` events.
import * as THREE from 'three';
import { MATERIALS, decodeBreak } from '../shared/destruction.js';

const GONE_Y = -60;            // Where a collapsed range's vertices go: below everything, zero area.
const DAMAGED_K = 0.7;         // Colour scale of a damaged piece.
const MAT_RGB = { glass: [0.62, 0.74, 0.8], wood: [0.48, 0.34, 0.2], light: [0.58, 0.56, 0.52], heavy: [0.5, 0.49, 0.47] };

function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A box turned `yaw` about its own centre (the world builder only has axis-aligned boxes).
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4();
function turnedBox(b, cx, cy, cz, sx, sy, sz, yaw) {
  const keep = b.matrix;
  _m.makeTranslation(cx, cy, cz).multiply(_r.makeRotationY(yaw));
  b.matrix = keep ? keep.clone().multiply(_m) : _m;
  b.box(0, 0, 0, sx, sy, sz);
  b.matrix = keep;
}

// The rubble a piece leaves, inside its footprint (and a little past it), in its own colour.
function drawRubble(b, p, rgb) {
  const rnd = mulberry(p.id * 7919 + 13 + Math.round(p.x * 31 + p.z * 17));
  const base = MAT_RGB[p.mat];
  const tint = [0, 1, 2].map(c => Math.min(1.4, (rgb ? rgb[c] * 0.55 + base[c] * 0.45 : base[c])));
  const dark = tint.map(c => c * 0.72);
  const pad = 0.35, x0 = p.x - pad, z0 = p.z - pad, W = p.w + 2 * pad, D = p.d + 2 * pad;
  const area = p.w * p.d;
  if (p.pile) {
    // A mound in the pile's rect: a broad base and smaller blocks heaped on it, up to the pile's height.
    const q = p.pile;
    b.setColor(dark);
    b.box(q.x + q.w / 2, q.h * 0.28, q.z + q.d / 2, q.w, q.h * 0.56, q.d);
    for (let i = 0; i < 5; i++) {
      b.setColor(i % 2 ? tint : dark);
      const s = 0.35 + rnd() * 0.45;
      turnedBox(b, q.x + s / 2 + rnd() * Math.max(0.01, q.w - s), q.h * 0.56 + s * 0.3, q.z + s / 2 + rnd() * Math.max(0.01, q.d - s), s, s * 0.7, s * 0.8, rnd() * 3);
    }
  }
  const n = Math.max(3, Math.min(p.mat === 'glass' ? 10 : 9, Math.round(area * (p.mat === 'glass' ? 1.6 : 0.7))));   // 12 triangles each.
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * W, z = z0 + rnd() * D, yaw = rnd() * Math.PI;
    b.setColor(i % 3 ? tint : dark);
    if (p.mat === 'glass') turnedBox(b, x, 0.04, z, 0.18 + rnd() * 0.3, 0.04, 0.12 + rnd() * 0.2, yaw);
    else if (p.mat === 'wood') turnedBox(b, x, 0.07, z, 0.5 + rnd() * 0.8, 0.1, 0.16 + rnd() * 0.14, yaw);
    else { const s = 0.18 + rnd() * 0.34; turnedBox(b, x, s * 0.35, z, s, s * 0.7, s * 0.9, yaw); }
  }
}

// Which vertices of which geometry belong to which piece. One per world (a giant world adds and drops tiles).
export class BreakRanges {
  constructor(map) {
    this.map = map;
    this.list = map.breakables ?? [];
    this.stage = new Uint8Array(this.list.length);       // What the picture shows now.
    this.segs = Array.from({ length: this.list.length }, () => []);
    this.dirty = new Set();       // Attributes written since the last upload.
  }

  // Draw-time bookkeeping for one builder pass. `sink` holds throwaway sign and glow builders: a breakable piece's
  // signs and glows are dropped (they would hang in the air once it falls).
  recorder(sink) { return new Recorder(this, sink); }

  // Ranges a recorder took on builder triangles, now in finished geometries. `geos` are the geometries the layer
  // was cut into; geos.slot / geos.dest (from splitTiles) give each source triangle's geometry and index there,
  // and are absent for a layer that stayed one geometry. `key` groups segments for dropTiles (giant worlds).
  bind(rec, layer, geos, key = null) {
    const ranges = layer === 'decal' ? rec.decal : rec.body;
    for (const r of ranges) {
      // Group the range's triangles into runs that stay contiguous in one geometry.
      let runGeo = -1, runStart = 0, runLen = 0;
      const flush = () => { if (runLen) this._seg(r, geos[runGeo], runStart * 3, runLen * 3, key); runLen = 0; };
      for (let t = r.t0; t < r.t1; t++) {
        const g = geos.slot ? geos.slot[t] : 0, d = geos.dest ? geos.dest[t] : t;
        if (g === runGeo && d === runStart + runLen) { runLen++; continue; }
        flush(); runGeo = g; runStart = d; runLen = 1;
      }
      flush();
    }
  }

  _seg(r, geo, v0, n, key) {
    const pos = geo.attributes.position, col = geo.attributes.aCol ?? null;
    const seg = {
      kind: r.kind, pos, col, v0, n, key,
      orig: pos.array.slice(v0 * 3, (v0 + n) * 3),
      origCol: col ? col.array.slice(v0 * col.itemSize, (v0 + n) * col.itemSize) : null,
      cx: r.cx, cz: r.cz, shown: 0,
    };
    this.segs[r.id].push(seg);
    this._paint(seg, this.stage[r.id], true);
  }

  // Shows `stage` on every range of piece id.
  setStage(id, stage) {
    if (id < 0 || id >= this.stage.length || this.stage[id] === stage) return false;
    this.stage[id] = stage;
    for (const seg of this.segs[id]) this._paint(seg, stage, false);
    return true;
  }

  _paint(seg, stage, fresh) {
    const show = seg.kind === 'rubble' ? stage === 2 : stage !== 2;
    // Freshly built and showing as built (a whole piece, a hidden rubble set is not): nothing to write.
    if (fresh && show && seg.kind !== 'rubble' && stage !== 1) return;
    const P = seg.pos.array, o = seg.v0 * 3, n = seg.n;
    if (!show) {
      for (let v = 0; v < n; v++) { P[o + v * 3] = seg.cx; P[o + v * 3 + 1] = GONE_Y; P[o + v * 3 + 2] = seg.cz; }
    } else if (!fresh || seg.kind === 'rubble') P.set(seg.orig, o);
    this._mark(seg.pos, o, n * 3);
    if (seg.col && seg.kind === 'body' && show) {
      const C = seg.col.array, k = stage === 1 ? DAMAGED_K : 1, sz = seg.col.itemSize, co = seg.v0 * sz;
      if (k === 1) C.set(seg.origCol, co);
      else for (let i = 0; i < seg.origCol.length; i++) C[co + i] = (i % sz) === 3 ? seg.origCol[i] : Math.round(seg.origCol[i] * k);
      this._mark(seg.col, co, n * sz);
    }
  }

  _mark(attr, start, count) {
    attr.addUpdateRange(start, count);
    attr.needsUpdate = true;
  }

  // A giant world tile went away: its segments go with it.
  dropKey(key) {
    for (const list of this.segs) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].key === key) list.splice(i, 1);
    }
  }
}

class Recorder {
  constructor(ranges, sink) {
    this.ranges = ranges; this.sink = sink;
    this.body = []; this.decal = [];
  }

  // Draws piece p (wall w) with `draw` into builder b, then its rubble, keeping both triangle ranges.
  piece(ctx, b, p, w, draw) {
    // The piece is drawn as it stands whole, even when the map's wall is already down (a renderer built mid-match).
    const iw = w._brk === 2 ? { ...w, x: p.x, z: p.z, w: p.w, d: p.d, h: p.h, blocksMove: p.flags[0], blocksBullet: p.flags[1], blocksVision: p.flags[2] } : w;
    const sb = ctx.sb, glow = ctx.glow;
    if (this.sink) { ctx.sb = this.sink.sb; ctx.glow = this.sink.glow; }
    const t0 = b.pos.length / 9;
    try { draw(iw); } finally { ctx.sb = sb; ctx.glow = glow; }
    const t1 = b.pos.length / 9;
    // The piece's own average colour tints its rubble.
    let rgb = null;
    if (t1 > t0) {
      rgb = [0, 0, 0];
      for (let i = t0 * 9; i < t1 * 9; i += 3) { rgb[0] += b.col[i]; rgb[1] += b.col[i + 1]; rgb[2] += b.col[i + 2]; }
      const n = (t1 - t0) * 3;
      rgb = rgb.map(c => c / n);
    }
    const keep = b.color;
    drawRubble(b, p, rgb);
    b.color = keep;
    const t2 = b.pos.length / 9, cx = p.x + p.w / 2, cz = p.z + p.d / 2;
    this.body.push({ id: p.id, kind: 'body', t0, t1, cx, cz }, { id: p.id, kind: 'rubble', t0: t1, t1: t2, cx, cz });
    return rgb;
  }

  // buildDecals' bookkeeping: triangles [t0, t1) of the decal list are piece id's shadow.
  shadow(id, t0, t1, p) { this.decal.push({ id, kind: 'shadow', t0, t1, cx: p.x + p.w / 2, cz: p.z + p.d / 2 }); }
}

// Per renderer: follows view.brk, plays the breaks, and keeps the renderer's wall lists in step with the map.
export class DestructFx {
  constructor(renderer, world) {
    this.r = renderer;
    this.map = renderer.map;
    this.ranges = world.brk ?? null;
    this.n = this.map.breakables?.length ?? 0;
    this.text = null;
    this.want = new Uint8Array(this.n);
    this.ver = this.map.brkVer ?? 0;
    this.colour = MATERIALS.map(m => MAT_RGB[m]);
  }

  // exact: a replay or killcam (the picture is whatever the frame says, walls stand back up on a seek); live play
  // only ever moves a piece forward, so a snapshot older than a break event never stands it back up (a new round's
  // all-clear '' is the exception).
  update(view, exact) {
    if (this.map.brkVer !== this.ver) { this.ver = this.map.brkVer; this.r.refreshWalls?.(); }
    if (!this.ranges || !this.n) return;
    const text = view?.brk ?? '';
    if (text === this.text) return;
    this.text = text;
    const st = decodeBreak(text, this.n, this.want);
    if (!st) return;
    const R = this.ranges;
    for (let i = 0; i < this.n; i++) {
      if (exact || text === '' || st[i] > R.stage[i]) R.setStage(i, st[i]);
    }
  }

  onEvents(events) {
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      if (e.t !== 'brk') continue;
      this.ranges?.setStage(e.i, Math.max(this.ranges.stage[e.i] ?? 0, e.s));
      this._burst(e);
    }
  }

  // The break itself: chunks thrown the way the blast pushed, dust, and for a full break a rubble scorch.
  _burst(e) {
    const vfx = this.r.vfx, p = this.map.breakables?.[e.i];
    if (!vfx || !p) return;
    const mat = MATERIALS[e.m] ?? p.mat, rgb = MAT_RGB[mat] ?? MAT_RGB.light;
    const full = e.s >= 2, size = Math.sqrt(p.w * p.d);
    const nChunks = vfx._n(full ? Math.min(26, 8 + size * 4) : 4);
    const dx = e.dx || 0, dz = e.dz || 0;
    for (let i = 0; i < nChunks; i++) {
      const x = p.x + Math.random() * p.w, z = p.z + Math.random() * p.d, y = 0.3 + Math.random() * Math.min(2.2, p.h);
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 4;
      const push = full ? 4 + Math.random() * 6 : 1.5;
      const c = mat === 'glass' && i % 2 ? [0.85, 0.95, 1] : i % 3 ? rgb : rgb.map(v => v * 0.7);
      vfx.shard(x, y, z, Math.cos(a) * s + dx * push, 3 + Math.random() * 6, Math.sin(a) * s + dz * push, c, mat === 'glass' ? 0.5 + Math.random() * 0.5 : 0.9 + Math.random() * (full ? 1.6 : 0.6));
    }
    // Dust: a low cloud rolling off the footprint (glass: a glitter of fine bits instead).
    const nDust = vfx._n(full ? (mat === 'glass' ? 6 : Math.min(18, 6 + size * 3)) : 3);
    const dust = mat === 'glass' ? [0.8, 0.9, 0.95] : mat === 'wood' ? [0.55, 0.45, 0.34] : vfx.dustRGB ?? [0.6, 0.58, 0.54];
    for (let i = 0; i < nDust; i++) {
      const x = p.x + Math.random() * p.w, z = p.z + Math.random() * p.d, a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 2.4;
      vfx.spawn(x, 0.3 + Math.random() * Math.min(1.8, p.h * 0.6), z, Math.cos(a) * s + dx, 0.4 + Math.random() * 1.2, Math.sin(a) * s + dz,
        0.9 + Math.random() * 1.1, 0.4, 1.1 + size * 0.25, dust, mat === 'glass' ? 0.35 : 0.7, -0.2, 1.8);
    }
    if (full && mat !== 'glass') vfx.groundMark?.(e.x, e.z, Math.max(1, size * 0.65), [0.12, 0.11, 0.1], 0.35);
    if (full) this.r.shakeAt?.(e.x, e.z, mat === 'heavy' ? 0.5 : mat === 'light' ? 0.32 : 0.16);
  }
}
