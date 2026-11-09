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
