// Line-of-sight fog. A world-space visibility polygon around the local player is rasterized into a
// low-res mask, with temporal smoothing, and world materials sample the mask by world position.
// Uses its own allocation-free slab raycast; same rules as raycastMap(..,'blocksVision').
import * as THREE from 'three';
import { uploadUsed } from './dynbuf.js';

// Distance to the nearest flagged wall along a normalised ray, or maxDist. hitWall (out) gets its index.
export function castRay(walls, ox, oz, dx, dz, maxDist, hitOut = null) {
  let best = maxDist;
  let bestI = -1;
  for (let i = 0; i < walls.length; i++) {
    const r = walls[i];
    let t0 = 0, t1 = best;
    if (Math.abs(dx) < 1e-9) {
      if (ox < r.x || ox > r.x + r.w) continue;
    } else {
      let a = (r.x - ox) / dx, b = (r.x + r.w - ox) / dx;
      if (a > b) { const q = a; a = b; b = q; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < r.z || oz > r.z + r.d) continue;
    } else {
      let a = (r.z - oz) / dz, b = (r.z + r.d - oz) / dz;
      if (a > b) { const q = a; a = b; b = q; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) continue;
    }
    if (t0 > 0 && t0 < best) { best = t0; bestI = i; }
  }
  if (hitOut) hitOut[0] = bestI;
  return best;
}

const MASK_VERT = /* glsl */`
uniform vec4 uXf;
uniform vec2 uJit;
void main() { gl_Position = vec4((position.xz * uXf.xy + uXf.zw + uJit) * 2.0 - 1.0, 0.0, 1.0); }`;

// Drawing the polygon several times with sub-pixel offsets gives a soft penumbra at the cost of a
// few tiny draws, and keeps the fragment work in world materials at a single texture read.
const MAX_SMOKES = 6;       // CombatFX pools the same number of clouds.
const SMOKE_RAYS = 18;      // Rays across one cloud; enough that its edge reads as round in the mask.

// The first n offsets are used when the quality step asks for n passes, so every prefix stays balanced around the
// true edge (opposite pairs first).
const JITTER_TEXELS = [[2.0, 0.7], [-2.0, -0.7], [-0.7, 2.0], [0.7, -2.0], [1.3, -1.3], [-1.3, 1.3]];
const SETTLE_FRAMES = 45;   // Frames without a change after which the temporal blend has converged (to ~1/1000).
const MARGIN = 2;           // Metres of mask beyond the map edge.
// Big maps get a mask that covers a window around the viewer instead of the whole map: the camera shows about
// 36 x 18 m plus aim lookahead, so a 72 x 56 m window that recentres once the viewer is 9 m off its centre always
// covers the screen. Only walls touching the window take part in the sweep, which keeps it as cheap as a small map.
const WINDOW_W = 72, WINDOW_H = 56, WINDOW_SLACK = 9;
const WINDOW_ABOVE = 100 * 70;   // Masks up to this many square metres just cover the whole map.

export class FogMask {
  constructor(map, webgl, { texelsPerMetre = 8, passes = JITTER_TEXELS.length } = {}) {
    this.map = map;
    this.webgl = webgl;
    this.walls = map.walls.filter(w => w.blocksVision);
    const W = map.width, H = map.height;
    const nw = this.walls.length;
    this.full = { x: -MARGIN, z: -MARGIN, w: W + 2 * MARGIN, h: H + 2 * MARGIN };
    this.windowed = this.full.w * this.full.h > WINDOW_ABOVE;
    this.bounds = this.windowed ? { x: this.full.x, z: this.full.z, w: WINDOW_W, h: WINDOW_H } : { ...this.full };
    const xf = new THREE.Vector4();
    this.rt = null;
    this.uniforms = { tex: { value: null }, xf: { value: xf }, on: { value: 1 } };
    this._setXf();

    // Walls as flat arrays for the sweep's inner loop: every vision wall, and the ones in play for the current window
    // (n of them, first in the same arrays' active copies).
    this.wx0 = new Float32Array(nw); this.wz0 = new Float32Array(nw);
    this.wx1 = new Float32Array(nw); this.wz1 = new Float32Array(nw);
    this.walls.forEach((w, i) => { this.wx0[i] = w.x; this.wz0[i] = w.z; this.wx1[i] = w.x + w.w; this.wz1[i] = w.z + w.d; });
    this.x0 = new Float32Array(nw); this.z0 = new Float32Array(nw);
    this.x1 = new Float32Array(nw); this.z1 = new Float32Array(nw);
    this.n = 0;
    this.winX = Infinity; this.winZ = Infinity;      // Window centre; Infinity until the first update places it.
    this._activate();
    // At most three rays per corner (see _sweep), a ring of fixed rays, and the smoke fans.
    const maxRays = nw * 4 * 3 + 8 + MAX_SMOKES * SMOKE_RAYS;
    this.angles = new Float32Array(maxRays);
    this.maxRays = maxRays;
    this.hadSmoke = false;
    this.ax = new Float32Array(maxRays);
    this.az = new Float32Array(maxRays);
    this.touched = new Uint8Array(nw);
    this.hit = -1;
    this.lastX = 1e9; this.lastZ = 1e9;
    this.still = 0;             // Frames since the polygon last changed.
    this.snap = true;           // Next draw replaces the mask instead of easing into it.
    this.raysCast = 0;          // Rays in the last sweep, for profiling.

    // One fan triangle per ray, then two triangles per touched wall.
    const maxVerts = maxRays * 3 + nw * 6;
    this.positions = new Float32Array(maxVerts * 3);
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    this.posAttr = attr;
    this.geo = geo;

    // Temporal smoothing with no clear: black quad at alpha k, then polygon additive at k. This moves
    // every texel toward its target at the same rate, so vision edges ease instead of popping.
    this.kBlack = { value: 0.2 };
    this.kPoly = { value: 0.2 };
    const uXf = { value: xf };
    this.polys = JITTER_TEXELS.map(() => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: MASK_VERT,
        fragmentShader: `uniform float uK; void main(){ gl_FragColor = vec4(uK, uK, uK, 1.0); }`,
        uniforms: { uXf, uK: this.kPoly, uJit: { value: new THREE.Vector2() } },
        depthTest: false, depthWrite: false, transparent: true,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      return mesh;
    });

    const quadMat = new THREE.ShaderMaterial({
      vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform float uK; void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, uK); }`,
      uniforms: { uK: this.kBlack },
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
    this.quad.frustumCulled = false;

    this.quad.renderOrder = 0;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad, ...this.polys);
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.updateMatrixWorld(true);
    this.camera = new THREE.Camera();

    this.passes = 0;
    this.setPasses(passes);
    this.setDensity(texelsPerMetre);
  }

  // Mask resolution in texels per metre. Reallocates the target (a texture, never a shader) and repaints it whole
  // on the next update, so a quality change costs one allocation and no visible fade.
  setDensity(texelsPerMetre) {
    if (texelsPerMetre === this.density) return;
    this.density = texelsPerMetre;
    const rw = Math.ceil(this.bounds.w * texelsPerMetre), rh = Math.ceil(this.bounds.h * texelsPerMetre);
    // Linear filtering at a few texels per metre keeps polygon edges smooth without MSAA; MSAA would invalidate
    // the previous frame that the temporal blend relies on.
    const rt = new THREE.WebGLRenderTarget(rw, rh, {
      depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    // Hidden until the first update paints it, rather than showing an uninitialised texture.
    const r = this.webgl, saved = r.getRenderTarget();
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    r.setRenderTarget(saved);
    if (this.rt) this.rt.dispose();
    this.rt = rt;
    this.uniforms.tex.value = rt.texture;
    for (let i = 0; i < this.polys.length; i++) this.polys[i].material.uniforms.uJit.value.set(JITTER_TEXELS[i][0] / rw, JITTER_TEXELS[i][1] / rh);
    this.reset();
  }

  // Soft-edge passes (1..6). Fewer passes is a harder penumbra and less fill.
  setPasses(n) {
    n = Math.max(1, Math.min(JITTER_TEXELS.length, n | 0));
    if (n === this.passes) return;
    this.passes = n;
    for (let i = 0; i < this.polys.length; i++) this.polys[i].visible = i < n;
    this.still = 0;
  }

  _setXf() {
    const b = this.bounds;
    this.uniforms.xf.value.set(1 / b.w, 1 / b.h, -b.x / b.w, -b.z / b.h);
  }

  // Copies the walls that touch the mask's current bounds into the active arrays.
  _activate() {
    const b = this.bounds, x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.h;
    let n = 0;
    for (let i = 0; i < this.wx0.length; i++) {
      if (this.wx1[i] < x0 || this.wx0[i] > x1 || this.wz1[i] < z0 || this.wz0[i] > z1) continue;
      this.x0[n] = this.wx0[i]; this.z0[n] = this.wz0[i]; this.x1[n] = this.wx1[i]; this.z1[n] = this.wz1[i];
      n++;
    }
    this.n = n;
  }

  // Windowed masks follow the viewer. Moving the window repaints the mask whole (the polygon is unchanged, so this
  // never shows) and swaps the active walls.
  _follow(px, pz) {
    if (!this.windowed || (Math.abs(px - this.winX) < WINDOW_SLACK && Math.abs(pz - this.winZ) < WINDOW_SLACK)) return;
    const f = this.full, b = this.bounds;
    this.winX = px; this.winZ = pz;
    b.x = Math.max(f.x, Math.min(f.x + f.w - b.w, px - b.w / 2));
    b.z = Math.max(f.z, Math.min(f.z + f.h - b.h, pz - b.h / 2));
    this._setXf();
    this._activate();
    this.reset();
    this.winX = px; this.winZ = pz;
  }

  // Distance to the nearest vision wall along a normalised ray, or maxDist; this.hit gets its index or -1.
  // Same slab test as castRay, over flat arrays with the divisions hoisted out of the loop.
  _cast(ox, oz, dx, dz, maxDist) {
    const { x0, z0, x1, z1, n } = this;
    const flatX = Math.abs(dx) < 1e-9, flatZ = Math.abs(dz) < 1e-9;
    const ix = flatX ? 0 : 1 / dx, iz = flatZ ? 0 : 1 / dz;
    let best = maxDist, bestI = -1;
    for (let i = 0; i < n; i++) {
      let t0 = 0, t1 = best;
      if (flatX) {
        if (ox < x0[i] || ox > x1[i]) continue;
      } else {
        let a = (x0[i] - ox) * ix, b = (x1[i] - ox) * ix;
        if (a > b) { const q = a; a = b; b = q; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) continue;
      }
      if (flatZ) {
        if (oz < z0[i] || oz > z1[i]) continue;
      } else {
        let a = (z0[i] - oz) * iz, b = (z1[i] - oz) * iz;
        if (a > b) { const q = a; a = b; b = q; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) continue;
      }
      if (t0 > 0 && t0 < best) { best = t0; bestI = i; }
    }
    this.hit = bestI;
    return best;
  }

  _sweep(px, pz, smokes) {
    const { x0, z0, x1, z1, angles, ax, az, touched } = this;
    const smokeN = smokes ? Math.min(smokes.length, MAX_SMOKES) : 0;
    const walls = this.n;
    // Rays never need to reach past the mask's far corner.
    const b = this.bounds, reach = Math.hypot(Math.max(px - b.x, b.x + b.w - px), Math.max(pz - b.z, b.z + b.h - pz)) + 1;
    let n = 0;
    // Only corners that can shape the polygon get rays. Seen from outside a box, the corner diagonally away from the
    // viewer is always hidden behind the box, and the corner facing the viewer is hit head on, so it needs one ray;
    // the two silhouette corners get a ray a hair to either side as well, so shadows stay exactly on wall edges.
    // This is a little over half the rays of three per corner, with the same polygon.
    for (let i = 0; i < walls; i++) {
      const rx = px < x0[i] ? -1 : px > x1[i] ? 1 : 0;
      const rz = pz < z0[i] ? -1 : pz > z1[i] ? 1 : 0;
      for (let c = 0; c < 4; c++) {
        const sx = c === 0 || c === 3 ? -1 : 1, sz = c < 2 ? -1 : 1;
        let rays = 3;
        if (rx !== 0 || rz !== 0) {
          if (rx === 0 ? sz === -rz : rz === 0 ? sx === -rx : sx === -rx && sz === -rz) continue;
          if (sx === rx && sz === rz) rays = 1;
        }
        const a = Math.atan2((sz < 0 ? z0[i] : z1[i]) - pz, (sx < 0 ? x0[i] : x1[i]) - px);
        if (rays === 1) angles[n++] = a;
        else { angles[n++] = a - 0.0015; angles[n++] = a; angles[n++] = a + 0.0015; }
      }
    }
    // A few fixed rays guarantee full coverage even if corners end up degenerate.
    for (let i = 0; i < 8; i++) angles[n++] = -Math.PI + (i / 8) * Math.PI * 2;
    // Smoke: a fan of rays across each cloud, so the far side of the circle becomes a shadow edge.
    for (let s = 0; s < smokeN; s++) {
      const c = smokes[s], cx = c.x - px, cz = c.z - pz, d = Math.hypot(cx, cz);
      if (d <= c.r + 1e-3) continue;          // A viewer inside a cloud can see out, so it casts nothing for them.
      const base = Math.atan2(cz, cx), half = Math.asin(c.r / d) * 1.02;
      for (let i = 0; i < SMOKE_RAYS; i++) {
        let a = base - half + (i / (SMOKE_RAYS - 1)) * half * 2;
        if (a > Math.PI) a -= Math.PI * 2; else if (a < -Math.PI) a += Math.PI * 2;
        angles[n++] = a;
      }
    }
    // Spare slots sort to the end, so one fixed-size in-place sort serves any ray count.
    angles.fill(Infinity, n);
    angles.sort();
    touched.fill(0);
    for (let i = 0; i < n; i++) {
      const dx = Math.cos(angles[i]), dz = Math.sin(angles[i]);
      let t = this._cast(px, pz, dx, dz, reach);
      const hit = this.hit;
      let blockedBySmoke = false;
      for (let s = 0; s < smokeN; s++) {
        const c = smokes[s], fx = c.x - px, fz = c.z - pz;
        const along = fx * dx + fz * dz, off2 = fx * fx + fz * fz - along * along;
        if (along <= 0 || off2 >= c.r * c.r || fx * fx + fz * fz <= c.r * c.r) continue;
        // The cloud's near surface, nudged inward so the polygon edge is hidden behind the cloud's own mesh.
        const enter = along - Math.sqrt(c.r * c.r - off2) + c.r * 0.35;
        if (enter < t) { t = enter; blockedBySmoke = true; }
      }
      if (hit >= 0 && !blockedBySmoke) touched[hit] = 1;
      // Extend just past the hit so the base of the wall is inside the polygon.
      const e = t + 0.35;
      ax[i] = px + dx * e;
      az[i] = pz + dz * e;
    }
    this.raysCast = n;
    return n;
  }

  // Sweeps, fills the mesh, and blends it into the mask. Call once per frame (or every other frame on low steps,
  // with dt covering both).
  update(px, pz, dt, smokes) {
    this._follow(px, pz);
    const hasSmoke = !!smokes && smokes.length > 0;
    // Clouds grow and drift, so their shadow must be recomputed even for a standing player.
    if (hasSmoke || this.hadSmoke || px !== this.lastX || pz !== this.lastZ || !this._n) {
      this.hadSmoke = hasSmoke;
      this.lastX = px; this.lastZ = pz;
      const n = this._sweep(px, pz, smokes);
      this._n = n;
      const P = this.positions;
      let v = 0;
      for (let i = 0; i < n; i++) {
        const j = i + 1 < n ? i + 1 : 0;
        P[v++] = px;       P[v++] = 0; P[v++] = pz;
        P[v++] = this.ax[j]; P[v++] = 0; P[v++] = this.az[j];
        P[v++] = this.ax[i]; P[v++] = 0; P[v++] = this.az[i];
      }
      // Any wall a ray touched is revealed whole, so roofs of visible walls are not fogged.
      for (let i = 0; i < this.n; i++) {
        if (!this.touched[i]) continue;
        const x0 = this.x0[i], x1 = this.x1[i], z0 = this.z0[i], z1 = this.z1[i];
        P[v++] = x0; P[v++] = 0; P[v++] = z0;
        P[v++] = x1; P[v++] = 0; P[v++] = z0;
        P[v++] = x1; P[v++] = 0; P[v++] = z1;
        P[v++] = x0; P[v++] = 0; P[v++] = z0;
        P[v++] = x1; P[v++] = 0; P[v++] = z1;
        P[v++] = x0; P[v++] = 0; P[v++] = z1;
      }
      uploadUsed(this.posAttr, v / 3);
      this.geo.setDrawRange(0, v / 3);
      this.still = 0;
    } else if (++this.still > SETTLE_FRAMES && !this.snap) {
      // Nothing moved and the blend has converged: the mask is already what another draw would make it.
      return;
    }
    const k = this.snap ? 1 : 1 - Math.exp(-Math.min(dt, 0.05) * 16);
    this.snap = false;
    this.kBlack.value = k;
    this.kPoly.value = k / this.passes;
    const r = this.webgl;
    const savedRT = r.getRenderTarget();
    const savedAuto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(savedRT);
    r.autoClear = savedAuto;
  }

  // Compiles the mask programs now rather than on the first frame.
  compile() {
    const r = this.webgl, saved = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.compile(this.scene, this.camera);
    r.setRenderTarget(saved);
  }

  // Instant snap, for spawn. Paints fully rather than easing from the previous position.
  reset() { this.lastX = 1e9; this._n = 0; this.snap = true; this.still = 0; }

  dispose() {
    this.rt.dispose();
    this.geo.dispose();
    for (const m of this.polys) m.material.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
