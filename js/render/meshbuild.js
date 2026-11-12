// Flat-shaded geometry generator: every triangle gets its own vertices and its face normal.
// Guns, characters and the world are all assembled from the same few primitives.
import * as THREE from 'three';
import { hexRGB } from './art.js';

export class MeshBuilder {
  // bake(nx,ny,nz,rgb,cx,cy,cz) -> [r,g,b] lets the world pre-light triangles on the CPU.
  constructor(bake = null) {
    this.pos = []; this.nor = []; this.col = []; this.par = [];
    this.bake = bake;
    this.color = [1, 1, 1];
    this.part = 0;              // Written to attribute aPart, meaning is up to the caller.
    this.matrix = null;         // Optional Matrix4 applied to everything emitted.
    this._v = new THREE.Vector3();
  }

  setColor(c) { this.color = typeof c === 'number' ? hexRGB(c) : c; return this; }
  setPart(p) { this.part = p; return this; }

  _xf(p) {
    if (!this.matrix) return p;
    this._v.set(p[0], p[1], p[2]).applyMatrix4(this.matrix);
    return [this._v.x, this._v.y, this._v.z];
  }

  // Counter-clockwise from outside. outFrom, when given, corrects winding so normals face away from it.
  tri(a, b, c, outFrom = null) {
    a = this._xf(a); b = this._xf(b); c = this._xf(c);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    if (outFrom) {
      const o = this._xf(outFrom);
      if (nx * (cx - o[0]) + ny * (cy - o[1]) + nz * (cz - o[2]) < 0) {
        const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz;
      }
    }
    const col = this.bake ? this.bake(nx, ny, nz, this.color, cx, cy, cz) : this.color;
    for (const v of [a, b, c]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(col[0], col[1], col[2]);
      this.par.push(this.part);
    }
  }

  quad(a, b, c, d, outFrom = null) { this.tri(a, b, c, outFrom); this.tri(a, c, d, outFrom); }

  // Connects rings of 3D points (same length, convex) and caps both ends.
  loft(rings) {
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (const r of rings) for (const p of r) { cx += p[0]; cy += p[1]; cz += p[2]; n++; }
    const c = [cx / n, cy / n, cz / n];
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i], b = rings[i + 1];
      for (let j = 0; j < a.length; j++) {
        const k = (j + 1) % a.length;
        this.quad(a[j], b[j], b[k], a[k], c);
      }
    }
    for (const r of [rings[0], rings[rings.length - 1]]) {
      for (let j = 1; j < r.length - 1; j++) this.tri(r[0], r[j], r[j + 1], c);
    }
    return this;
  }

  // Axis-aligned box. ch > 0 bevels the eight long edges and pinches both X ends.
  box(cx, cy, cz, sx, sy, sz, ch = 0) {
    const x = sx / 2, y = sy / 2, z = sz / 2;
    if (ch <= 0) {
      const r = (px) => [[cx + px, cy - y, cz - z], [cx + px, cy + y, cz - z], [cx + px, cy + y, cz + z], [cx + px, cy - y, cz + z]];
      return this.loft([r(-x), r(x)]);
    }
    const oct = (px, in_) => {
      const yy = y - in_, zz = z - in_, c = Math.min(ch, Math.min(yy, zz) * 0.8);
      return [
        [cx + px, cy - yy, cz - zz + c], [cx + px, cy - yy + c, cz - zz],
        [cx + px, cy + yy - c, cz - zz], [cx + px, cy + yy, cz - zz + c],
        [cx + px, cy + yy, cz + zz - c], [cx + px, cy + yy - c, cz + zz],
        [cx + px, cy - yy + c, cz + zz], [cx + px, cy - yy, cz + zz - c],
      ];
    };
    const inset = Math.min(ch, Math.min(y, z) * 0.45);
    return this.loft([oct(-x, inset), oct(-x + inset, 0), oct(x - inset, 0), oct(x, inset)]);
  }

  // N-sided prism along +X, centred at (cy,cz), radius r0 -> r1.
  prismX(x0, x1, cy, cz, r0, r1, sides = 6, rot = 0) {
    const ring = (x, r) => {
      const out = [];
      for (let i = 0; i < sides; i++) {
        const a = rot + (i / sides) * Math.PI * 2;
        out.push([x, cy + Math.sin(a) * r, cz + Math.cos(a) * r]);
      }
      return out;
    };
    return this.loft([ring(x0, r0), ring(x1, r1)]);
  }

  // N-sided prism along +Y, footprint centred on (cx,cz).
  prismY(y0, y1, cx, cz, r0, r1, sides = 6, rot = 0) {
    const ring = (y, r) => {
      const out = [];
      for (let i = 0; i < sides; i++) {
        const a = rot + (i / sides) * Math.PI * 2;
        out.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
      }
      return out;
    };
    return this.loft([ring(y0, r0), ring(y1, r1)]);
  }

  // N-sided prism along +Z, centred on (cx,cy). Used for drums and wheels on the side of a gun.
  prismZ(z0, z1, cx, cy, r0, r1, sides = 6, rot = 0) {
    const ring = (z, r) => {
      const out = [];
      for (let i = 0; i < sides; i++) {
        const a = rot + (i / sides) * Math.PI * 2;
        out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
      }
      return out;
    };
    return this.loft([ring(z0, r0), ring(z1, r1)]);
  }

  // Arbitrary XY profile extruded along Z (z0 < z1). Concave profiles are fine.
  extrude(points, z0, z1) {
    const verts = points.map(p => new THREE.Vector2(p[0], p[1]));
    if (THREE.ShapeUtils.isClockWise(verts)) { verts.reverse(); }
    const pts = verts.map(v => [v.x, v.y]);
    const faces = THREE.ShapeUtils.triangulateShape(verts, []);
    for (const f of faces) {
      const [a, b, c] = f.map(i => pts[i]);
      this.tri([a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1]);
      this.tri([c[0], c[1], z0], [b[0], b[1], z0], [a[0], a[1], z0]);
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      this.quad([p[0], p[1], z1], [p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1]);
    }
    return this;
  }

  // Flat quad on the XZ plane at height y, normal up.
  groundRect(x, z, w, d, y = 0.02) {
    this.tri([x, y, z], [x, y, z + d], [x + w, y, z + d]);
    this.tri([x, y, z], [x + w, y, z + d], [x + w, y, z]);
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.par, 1));
    return g;
  }
}

// Z-fighting guard for the merged world. Builders lay trims, caps, parapet tops, panels and paint flat on top of bigger
// faces at exactly the same height or plane, and two coplanar faces of different colours flicker against each other as
// the camera pans (worst on roof edges). This finds every triangle that overlaps a coplanar, same-facing triangle of
// another colour that lies under it (bigger, or the same size and emitted earlier) and lifts it off along its normal,
// LIFT metres per face under it (an odd step, so a lift rarely lands on a face a round centimetre up), which is far below a pixel at play distance and far above the depth buffer's step.
// One pass over all the builders given, so a roof in one mesh and a wall cap in another are kept apart too.
const LIFT = 0.007;
const PLANE_EPS = 0.004;
export function settleCoplanar(builders) {
  if (globalThis.__noSettle) return 0;          // dev/zfight-check.py: before/after comparisons.
  // A lifted face can land on one that sat a centimetre up, so settle again until nothing moves.
  let moved = 0, hot = null;
  for (let pass = 0; pass < 4; pass++) {
    hot = settleOnce(builders, hot);
    if (!hot) break;
    moved += hot.count;
  }
  return moved;
}

// One pass. hot (from the pass before) limits it to the planes a lifted face moved onto; returns the faces it lifted.
function settleOnce(builders, hot) {
  const list = builders.filter(b => b && b.pos.length);
  let n = 0;
  for (const b of list) n += b.pos.length / 9;
  if (n < 2) return null;
  const owner = new Int32Array(n), local = new Int32Array(n);
  const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n), dd = new Float64Array(n), area = new Float32Array(n);
  const buckets = new Map();
  let t = 0;
  list.forEach((b, bi) => {
    const P = b.pos;
    for (let i = 0; i < P.length; i += 9, t++) {
      owner[t] = bi; local[t] = i;
      const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2];
      const vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
      let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
      const l = Math.hypot(x, y, z);
      area[t] = l / 2;
      if (l < 1e-9 || y / l < -0.3) { area[t] = 0; continue; }      // Undersides never show to the top-down camera.
      x /= l; y /= l; z /= l;
      nx[t] = x; ny[t] = y; nz[t] = z;
      dd[t] = x * P[i] + y * P[i + 1] + z * P[i + 2];
      // Numeric key: the coarse normal, then the plane offset (any map fits in +-4 km).
      const k = (((Math.round(x * 10) + 10) * 21 + Math.round(y * 10) + 10) * 21 + Math.round(z * 10) + 10) * 2e6 + Math.round(dd[t] / PLANE_EPS) + 1e6;
      let a = buckets.get(k);
      if (!a) buckets.set(k, a = []);
      a.push(t);
    }
  });
  const lift = new Uint8Array(n), pairs = [];
  const pts = new Float64Array(6), qts = new Float64Array(6);
  const flat = (ti, out) => {
    const P = list[owner[ti]].pos, i = local[ti];
    const ax = Math.abs(nx[ti]), ay = Math.abs(ny[ti]), az = Math.abs(nz[ti]);
    const u = ay >= ax && ay >= az ? 0 : ax >= az ? 1 : 0, v = ay >= ax && ay >= az ? 2 : ax >= az ? 2 : 1;
    for (let j = 0; j < 3; j++) { out[j * 2] = P[i + j * 3 + u]; out[j * 2 + 1] = P[i + j * 3 + v]; }
  };
  // 2-D separating axes; touching along an edge (or overlapping by under 2 mm) is not an overlap.
  const overlaps = (A, B) => {
    for (let s = 0; s < 2; s++) {
      const T = s ? B : A;
      for (let e = 0; e < 3; e++) {
        const px = T[e * 2], py = T[e * 2 + 1], qx = T[((e + 1) % 3) * 2], qy = T[((e + 1) % 3) * 2 + 1];
        let ax = py - qy, ay = qx - px;
        const L = Math.hypot(ax, ay);
        if (L < 1e-9) continue;
        ax /= L; ay /= L;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (let j = 0; j < 3; j++) {
          const da = A[j * 2] * ax + A[j * 2 + 1] * ay, db = B[j * 2] * ax + B[j * 2 + 1] * ay;
          if (da < a0) a0 = da; if (da > a1) a1 = da; if (db < b0) b0 = db; if (db > b1) b1 = db;
        }
        if (a1 <= b0 + 0.002 || b1 <= a0 + 0.002) return false;
      }
    }
    return true;
  };
  const colDiff = (a, b) => {
    const A = list[owner[a]].col, B = list[owner[b]].col, i = local[a], j = local[b];
    return Math.abs(A[i] - B[j]) + Math.abs(A[i + 1] - B[j + 1]) + Math.abs(A[i + 2] - B[j + 2]);
  };
  const box = new Float64Array(4);
  const bounds = (T) => {
    box[0] = Math.min(T[0], T[2], T[4]); box[1] = Math.max(T[0], T[2], T[4]);
    box[2] = Math.min(T[1], T[3], T[5]); box[3] = Math.max(T[1], T[3], T[5]);
  };
  for (const [k, own] of buckets) {
    const next = buckets.get(k + 1);
    if (own.length + (next ? next.length : 0) < 2) continue;
    if (hot && !own.some(t => hot.has(t)) && !(next && next.some(t => hot.has(t)))) continue;
    const all = next ? own.concat(next) : own;
    // Sweep along the first flat axis: only triangles whose spans meet are compared.
    const lo = new Float64Array(all.length), hi = new Float64Array(all.length), lo2 = new Float64Array(all.length), hi2 = new Float64Array(all.length);
    for (let i = 0; i < all.length; i++) { flat(all[i], pts); bounds(pts); lo[i] = box[0]; hi[i] = box[1]; lo2[i] = box[2]; hi2[i] = box[3]; }
    const order = Array.from(all, (_, i) => i).sort((a, b) => lo[a] - lo[b]);
    for (let oi = 0; oi < order.length; oi++) {
      const i = order[oi];
      for (let oj = oi + 1; oj < order.length; oj++) {
        const j = order[oj];
        if (lo[j] >= hi[i] - 0.002) break;
        if (lo2[j] >= hi2[i] - 0.002 || lo2[i] >= hi2[j] - 0.002) continue;
        const a = all[i], b = all[j];
        if (i >= own.length && j >= own.length) continue;      // Both from the next bucket: that bucket's own pass.
        if (Math.abs(dd[a] - dd[b]) > PLANE_EPS) continue;
        if (nx[a] * nx[b] + ny[a] * ny[b] + nz[a] * nz[b] < 0.999) continue;
        if (colDiff(a, b) < 0.02) continue;
        flat(a, pts); flat(b, qts);
        if (!overlaps(pts, qts)) continue;
        // The smaller face is the detail laid on the bigger one; between equals, the later one.
        const top = area[a] < area[b] * 0.98 ? a : area[b] < area[a] * 0.98 ? b : Math.max(a, b);
        pairs.push(top, top === a ? b : a);
      }
    }
  }
  // Layers: each face sits one step above everything it lies on (a cap on a trim on a wall lifts twice).
  for (let pass = 0, changed = true; changed && pass < 8; pass++) {
    changed = false;
    for (let p = 0; p < pairs.length; p += 2) {
      const want = Math.min(8, lift[pairs[p + 1]] + 1);
      if (lift[pairs[p]] < want) { lift[pairs[p]] = want; changed = true; }
    }
  }
  const moved = new Set();
  for (let ti = 0; ti < n; ti++) {
    if (!lift[ti]) continue;
    moved.add(ti);
    const P = list[owner[ti]].pos, i = local[ti], s = lift[ti] * LIFT;
    for (let j = 0; j < 9; j += 3) { P[i + j] += nx[ti] * s; P[i + j + 1] += ny[ti] * s; P[i + j + 2] += nz[ti] * s; }
  }
  if (!moved.size) return null;
  moved.count = moved.size;
  return moved;
}
