// Wrenfield Fair's moving pieces in the world (docs/ZOMBIES.md "Wrenfield Fair"), from their events alone (nothing on
// the snapshot): the renderer makes one the first time it sees one of them and calls update() each frame.
//   lanes   the Barker's charge: the lane it is about to run, marked on the ground the whole windup (an edge and a fill
//           creeping along it toward the far end as the moment comes), then flashing as it runs ('zcharge')
//   whirls  the Whirligig's whirls: a pinwheel spinning on the ground over its reach and a funnel of light at its eye,
//           tightening as it closes ('zwhirl'); the burst itself is the renderer's (zfx 'whirlpop')
// Two to four draw calls while something is showing, none otherwise.
import * as THREE from 'three';

const LANES = 2, WHIRLS = 3;
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), C = new THREE.Color();
const additive = opts => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, ...opts });

// A flat pinwheel of `n` curved blades, radius 1, on the ground plane.
function pinwheel(n = 6) {
  const pos = [];
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2;
    for (let s = 0; s < 4; s++) {
      const r0 = 0.15 + s * 0.21, r1 = r0 + 0.21, b0 = a + r0 * 1.4, b1 = a + r1 * 1.4, w0 = 0.32 * (1 - s / 5), w1 = 0.32 * (1 - (s + 1) / 5);
      const P = (r, b) => [Math.cos(b) * r, 0, Math.sin(b) * r];
      const p0 = P(r0, b0), p1 = P(r0, b0 + w0), p2 = P(r1, b1 + w1), p3 = P(r1, b1);
      pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export class ZmFairFx {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);     // From its origin along +x.
    this.edge = new THREE.InstancedMesh(plane, additive({ color: 0xffffff, opacity: 0.55 }), LANES);
    this.fill = new THREE.InstancedMesh(plane, additive({ color: 0xffffff, opacity: 0.4 }), LANES);
    this.wheel = new THREE.InstancedMesh(pinwheel(), additive({ color: 0xffffff, opacity: 0.6 }), WHIRLS);
    this.funnel = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 0.15, 2.6, 10, 1, true).translate(0, 1.3, 0), additive({ color: 0xffffff, opacity: 0.32 }), WHIRLS);
    for (const m of [this.edge, this.fill, this.wheel, this.funnel]) { m.count = 0; m.frustumCulled = false; m.renderOrder = 2; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.root.add(m); }
    this.lanes = []; this.whirls = []; this.t = 0;
  }

  onEvent(ev) {
    if (ev.t === 'zcharge') {
      if (this.lanes.length >= LANES) this.lanes.shift();
      this.lanes.push({ x: ev.x, z: ev.z, a: ev.a, len: ev.len, w: ev.w, wind: ev.wind, dash: ev.dash ?? 0.45, t: 0 });
    } else if (ev.t === 'zwhirl') {
      if (this.whirls.length >= WHIRLS) this.whirls.shift();
      this.whirls.push({ x: ev.x, z: ev.z, r: ev.r, life: ev.life, t: 0 });
    }
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    let n = 0;
    for (let i = this.lanes.length - 1; i >= 0; i--) {
      const L = this.lanes[i];
      L.t += dt;
      if (L.t > L.wind + L.dash + 0.25) { this.lanes.splice(i, 1); continue; }
    }
    for (const L of this.lanes) {
      const k = Math.min(1, L.t / L.wind), running = L.t >= L.wind;
      Q.setFromAxisAngle(Y, -L.a);
      M4.compose(V.set(L.x, 0.13, L.z), Q, S.set(L.len, 1, L.w));
      this.edge.setMatrixAt(n, M4);
      this.edge.setColorAt(n, C.setHex(running ? 0xffe0a0 : 0xff3a2a).multiplyScalar(running ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(t * 9))));
      M4.compose(V.set(L.x, 0.15, L.z), Q, S.set(Math.max(0.01, L.len * k), 1, L.w * 0.55));
      this.fill.setMatrixAt(n, M4);
      this.fill.setColorAt(n, C.setHex(running ? 0xffffff : 0xffa040));
      n++;
    }
    this.edge.count = this.fill.count = n;
    n = 0;
    for (let i = this.whirls.length - 1; i >= 0; i--) { const W = this.whirls[i]; W.t += dt; if (W.t > W.life) this.whirls.splice(i, 1); }
    for (const W of this.whirls) {
      const k = W.t / W.life, r = W.r * (1 - 0.35 * k);
      Q.setFromAxisAngle(Y, -t * (7 + k * 9));
      M4.compose(V.set(W.x, 0.16, W.z), Q, S.set(r, 1, r));
      this.wheel.setMatrixAt(n, M4);
      this.wheel.setColorAt(n, C.setHex(n % 2 ? 0x7af0e0 : 0xff7ad8).multiplyScalar(0.7 + 0.3 * Math.sin(t * 12)));
      Q.setFromAxisAngle(Y, t * 11);
      M4.compose(V.set(W.x, 0, W.z), Q, S.set(1 + k * 0.5, 0.8 + 0.4 * Math.sin(t * 7), 1 + k * 0.5));
      this.funnel.setMatrixAt(n, M4);
      this.funnel.setColorAt(n, C.setHex(0xffb0f0));
      n++;
    }
    this.wheel.count = this.funnel.count = n;
    for (const m of [this.edge, this.fill, this.wheel, this.funnel]) {
      m.visible = m.count > 0;
      if (!m.visible) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.root.traverse(o => { if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose(); } });
  }
}
