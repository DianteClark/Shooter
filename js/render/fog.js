// Line-of-sight fog. A world-space visibility polygon around the local player is rasterized into a
// low-res mask, with temporal smoothing, and world materials sample the mask by world position.
// Uses its own allocation-free slab raycast; same rules as raycastMap(..,'blocksVision').
import * as THREE from 'three';

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

const JITTER_TEXELS = [[2.0, 0.7], [-0.7, 2.0], [-2.0, -0.7], [0.7, -2.0], [1.3, -1.3], [-1.3, 1.3]];

export class FogMask {
  constructor(map, webgl) {
    this.map = map;
    this.webgl = webgl;
    this.walls = map.walls.filter(w => w.blocksVision);
    const W = map.width, H = map.height;

    // Mask covers the map plus a small margin. Eight texels per metre keeps polygon edges smooth
    // without MSAA; MSAA would invalidate the previous frame that the temporal blend relies on.
    const m = 2;
    this.bounds = { x: -m, z: -m, w: W + 2 * m, h: H + 2 * m };
    const rw = Math.ceil(this.bounds.w * 8), rh = Math.ceil(this.bounds.h * 8);
    this.rt = new THREE.WebGLRenderTarget(rw, rh, {
      depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    const xf = new THREE.Vector4(1 / this.bounds.w, 1 / this.bounds.h, -this.bounds.x / this.bounds.w, -this.bounds.z / this.bounds.h);
    this.uniforms = { tex: { value: this.rt.texture }, xf: { value: xf }, on: { value: 1 } };

    // Rays go at each corner, and a hair to either side of it, so shadows stay exactly on wall edges.
    this.cornerX = new Float32Array(this.walls.length * 4);
    this.cornerZ = new Float32Array(this.walls.length * 4);
    this.walls.forEach((w, i) => {
      this.cornerX[i * 4] = w.x; this.cornerZ[i * 4] = w.z;
      this.cornerX[i * 4 + 1] = w.x + w.w; this.cornerZ[i * 4 + 1] = w.z;
      this.cornerX[i * 4 + 2] = w.x + w.w; this.cornerZ[i * 4 + 2] = w.z + w.d;
      this.cornerX[i * 4 + 3] = w.x; this.cornerZ[i * 4 + 3] = w.z + w.d;
    });
    const maxRays = this.walls.length * 4 * 3 + 8 + MAX_SMOKES * SMOKE_RAYS;
    this.angles = new Float32Array(maxRays);
    this.maxRays = maxRays;
    this.hadSmoke = false;
    this.ax = new Float32Array(maxRays);
    this.az = new Float32Array(maxRays);
    this.touched = new Uint8Array(this.walls.length);
    this.hit = [-1];
    this.lastX = 1e9; this.lastZ = 1e9;

    // One fan triangle per ray, then two triangles per touched wall.
    const maxVerts = maxRays * 3 + this.walls.length * 6;
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
    this.polys = JITTER_TEXELS.map(([jx, jy]) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: MASK_VERT,
        fragmentShader: `uniform float uK; void main(){ gl_FragColor = vec4(uK, uK, uK, 1.0); }`,
        uniforms: { uXf, uK: this.kPoly, uJit: { value: new THREE.Vector2(jx / rw, jy / rh) } },
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

    webgl.setRenderTarget(this.rt);
    webgl.setClearColor(0x000000, 1);
    webgl.clear(true, false, false);
    webgl.setRenderTarget(null);
  }

  _sweep(px, pz, smokes) {
    const { cornerX, cornerZ, angles, ax, az, walls, touched, hit } = this;
    const smokeN = smokes ? Math.min(smokes.length, MAX_SMOKES) : 0;
    let n = 0;
    for (let i = 0; i < cornerX.length; i++) {
      const a = Math.atan2(cornerZ[i] - pz, cornerX[i] - px);
      angles[n++] = a - 0.0015; angles[n++] = a; angles[n++] = a + 0.0015;
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
    const list = angles;
    touched.fill(0);
    for (let i = 0; i < n; i++) {
      const dx = Math.cos(list[i]), dz = Math.sin(list[i]);
      let t = castRay(walls, px, pz, dx, dz, 300, hit);
      let blockedBySmoke = false;
      for (let s = 0; s < smokeN; s++) {
        const c = smokes[s], fx = c.x - px, fz = c.z - pz;
        const along = fx * dx + fz * dz, off2 = fx * fx + fz * fz - along * along;
        if (along <= 0 || off2 >= c.r * c.r || fx * fx + fz * fz <= c.r * c.r) continue;
        // The cloud's near surface, nudged inward so the polygon edge is hidden behind the cloud's own mesh.
        const enter = along - Math.sqrt(c.r * c.r - off2) + c.r * 0.35;
        if (enter < t) { t = enter; blockedBySmoke = true; }
      }
      if (hit[0] >= 0 && !blockedBySmoke) touched[hit[0]] = 1;
      // Extend just past the hit so the base of the wall is inside the polygon.
      const e = t + 0.35;
      ax[i] = px + dx * e;
      az[i] = pz + dz * e;
    }
    return n;
  }

  // Sweeps, fills the mesh, and blends it into the mask. Call once per frame.
  update(px, pz, dt, smokes) {
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
        const j = (i + 1) % n;
        P[v++] = px;       P[v++] = 0; P[v++] = pz;
        P[v++] = this.ax[j]; P[v++] = 0; P[v++] = this.az[j];
        P[v++] = this.ax[i]; P[v++] = 0; P[v++] = this.az[i];
      }
      // Any wall a ray touched is revealed whole, so roofs of visible walls are not fogged.
      for (let i = 0; i < this.walls.length; i++) {
        if (!this.touched[i]) continue;
        const w = this.walls[i];
        const x0 = w.x, x1 = w.x + w.w, z0 = w.z, z1 = w.z + w.d;
        P[v++] = x0; P[v++] = 0; P[v++] = z0;
        P[v++] = x1; P[v++] = 0; P[v++] = z0;
        P[v++] = x1; P[v++] = 0; P[v++] = z1;
        P[v++] = x0; P[v++] = 0; P[v++] = z0;
        P[v++] = x1; P[v++] = 0; P[v++] = z1;
        P[v++] = x0; P[v++] = 0; P[v++] = z1;
      }
      this.posAttr.needsUpdate = true;
      this.geo.setDrawRange(0, v / 3);
    }
    const k = 1 - Math.exp(-Math.min(dt, 0.05) * 16);
    this.kBlack.value = k;
    this.kPoly.value = k / JITTER_TEXELS.length;
    const r = this.webgl;
    const savedRT = r.getRenderTarget();
    const savedAuto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(savedRT);
    r.autoClear = savedAuto;
  }

  // Instant snap, for spawn. Paints fully rather than easing from the previous position.
  reset() { this.lastX = 1e9; this._n = 0; }

  dispose() {
    this.rt.dispose();
    this.geo.dispose();
    for (const m of this.polys) m.material.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
