// Graveyard Shift's economy in the world (ROADMAP item 36, docs/ZOMBIES.md "Economy"): ZmFx makes one and calls
// update() each frame with the zombies block.
//   stations   the upgrade bench (iron bench, vise, forge slot and three tier lamps), the supply terminal (a kiosk
//              with a green screen and an aerial), the armour bench (a rack of plates) and the altar (a plinth with
//              three sockets): one merged mesh, their lamps and screens in a second (additive, pulsing), and that glow
//              again through walls (an x-ray pass, like the wall-buys)
//   bench      the gun at work over the bench: spinning fast while it is worked on, turning slowly in gold once ready
//   traps      a floor per kind (Live Rail: steel rails; Firedamp Vents: grilles; Threshers: a blade pit) and its
//              switch post; armed, the rails crackle blue, the vents throw flame, the blades spin; the switch lamp says
//              ready (green), running (red) or cooling (amber)
//   exfil      the pad's ring of lamps; from the round it can be called, a dim beacon; called, a bright one and a ring
//              that closes as the clock runs down
//   quest      the relics (small violet lanterns, floating where they lie, gone once found) and the altar's sockets
//              lighting as they are found
//   gear       sentries (turning to their aim), hunter drones (hovering, bobbing), lures (a pulsing red post) and the
//              air strike's mark on the ground: instanced, one draw call each
//   x-ray      the stations' outlines, their lamps and the trap rings through walls and roofs (the camera looks north:
//              a piece on a north face hides behind its building otherwise)
// About eighteen draw calls whatever the round.
import * as THREE from 'three';
import { getGun } from './guns.js';
import { ZE, ZM_FX, zmFxOf } from '../shared/zombies.js';
import { getCamo } from '../shared/camos.js';

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
const GEAR_MAX = 8;
const xrayMaterial = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthFunc: THREE.GreaterDepth,
  blending: THREE.AdditiveBlending, fog: false });
const additive = (opts = {}) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...opts });

// Coloured boxes merged into one geometry (as zm-fx.js's), with a local frame: `at(x, z, yaw)` sets where box() puts
// (out, y, side): `out` metres from the frame's origin along yaw, `side` across it.
class Kit {
  constructor() { this.pos = []; this.col = []; this.ox = 0; this.oz = 0; this.yaw = 0; }
  at(x, z, yaw) { this.ox = x; this.oz = z; this.yaw = yaw; return this; }
  box(out, y, side, w, h, d, rgb, spin = 0, shade = true) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const cx = this.ox + out * c - side * s, cz = this.oz + out * s + side * c;
    const yaw = this.yaw + spin, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const P = (x, yy, z) => [cx + x * cy - z * sy, y + yy, cz + x * sy + z * cy];
    const faces = [
      [[-hw, hh, -hd], [hw, hh, -hd], [hw, hh, hd], [-hw, hh, hd], 1.0],
      [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd], 0.78],
      [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd], 0.62],
      [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd], 0.86],
      [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd], 0.7],
    ];
    const r = (rgb >> 16 & 255) / 255, g = (rgb >> 8 & 255) / 255, b = (rgb & 255) / 255;
    for (const [a, b2, c2, d2, k0] of faces) {
      const k = shade ? k0 : 1;
      for (const v of [a, b2, c2, a, c2, d2]) { this.pos.push(...P(...v)); this.col.push(r * k, g * k, b * k); }
    }
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
  mesh(opts = {}) {
    const m = new THREE.Mesh(this.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, ...opts }));
    m.renderOrder = 1;
    return m;
  }
}

export class ZmEconFx {
  constructor(group, L) {
    this.L = L;
    this.root = new THREE.Group();
    group.add(this.root);
    const st = new Kit(), glow = new Kit(), ghost = new Kit();     // ghost: the stations' outlines for the x-ray pass.
    // The upgrade bench.
    const B = L.bench;
    if (B) {
      st.at(B.wx, B.wz, B.face);
      st.box(0.48, 0.45, 0, 0.86, 0.9, 2.0, 0x3a3430).box(0.48, 0.93, 0, 0.98, 0.07, 2.16, 0x5c626a);
      st.box(0.06, 1.55, 0, 0.1, 1.3, 2.1, 0x2a2420).box(0.62, 1.07, -0.62, 0.3, 0.2, 0.34, 0x6e747c).box(0.62, 1.2, -0.62, 0.1, 0.1, 0.5, 0x8a9098);
      st.box(0.5, 1.0, 0.55, 0.36, 0.12, 0.36, 0x23201c);
      glow.at(B.wx, B.wz, B.face);
      glow.box(0.12, 1.25, 0, 0.04, 0.12, 1.5, 0xff7a1a, 0, false);
      for (let k = 0; k < 3; k++) glow.box(0.12, 1.85, -0.5 + k * 0.5, 0.05, 0.16, 0.16, 0xb070ff, 0, false);
      ghost.at(B.wx, B.wz, B.face).box(0.48, 0.5, 0, 0.9, 1.0, 2.1, 0xff9a3a, 0, false).box(0.08, 1.55, 0, 0.1, 1.3, 2.1, 0xb070ff, 0, false);
    }
    // The supply terminal.
    const T = L.terminal;
    if (T) {
      st.at(T.wx, T.wz, T.face);
      st.box(0.4, 1.0, 0, 0.72, 2.0, 1.1, 0x2b3a33).box(0.78, 1.45, 0, 0.06, 0.7, 0.96, 0x101814).box(0.8, 0.8, 0, 0.16, 0.1, 0.86, 0x6d7a72);
      st.box(0.2, 2.4, 0.4, 0.06, 0.9, 0.06, 0x9aa4a0);
      glow.at(T.wx, T.wz, T.face);
      glow.box(0.82, 1.45, 0, 0.02, 0.58, 0.84, 0x4dffa0, 0, false).box(0.2, 2.9, 0.4, 0.16, 0.16, 0.16, 0x4dffa0, 0, false).box(0.82, 1.95, 0, 0.02, 0.1, 0.9, 0x2fd07a, 0, false)
        .box(0.4, 2.04, 0, 0.6, 0.06, 1.0, 0x2fd07a, 0, false);
      ghost.at(T.wx, T.wz, T.face).box(0.4, 1.0, 0, 0.72, 2.0, 1.1, 0x4dffa0, 0, false);
    }
    // The armour bench: a rack of plates.
    const A = L.armour;
    if (A) {
      st.at(A.wx, A.wz, A.face);
      st.box(0.3, 0.95, 0, 0.5, 1.9, 1.5, 0x3a3e44).box(0.58, 0.5, 0, 0.12, 0.08, 1.4, 0x5a6068);
      for (let k = 0; k < 3; k++) st.box(0.6, 1.1, -0.45 + k * 0.45, 0.07, 0.62, 0.38, 0x6b7a4a).box(0.64, 1.1, -0.45 + k * 0.45, 0.02, 0.2, 0.2, 0x8c9a62);
      glow.at(A.wx, A.wz, A.face);
      glow.box(0.57, 1.96, 0, 0.03, 0.06, 1.5, 0x9fd8ff, 0, false);
      ghost.at(A.wx, A.wz, A.face).box(0.3, 0.95, 0, 0.5, 1.9, 1.5, 0x9fd8ff, 0, false);
    }
    // The altar: a plinth with three sockets (lit by the quest, below).
    const Al = L.altar;
    if (Al) {
      st.at(Al.wx, Al.wz, Al.face);
      st.box(0.6, 0.42, 0, 1.0, 0.84, 1.5, 0x5d5a55).box(0.6, 0.88, 0, 1.12, 0.09, 1.64, 0x726e68).box(0.14, 1.3, 0, 0.18, 0.9, 0.5, 0x4a4743);
    }
    // Trap areas: a ring on the floor (dim hazard yellow idle, red armed, amber cooling), seen through walls too.
    const ringGeo = new THREE.RingGeometry(0.93, 1, 40).rotateX(-Math.PI / 2);
    this.trapRings = new THREE.InstancedMesh(ringGeo, additive({ color: 0xffffff, opacity: 0.8, side: THREE.DoubleSide }), Math.max(1, L.traps.length));
    this.trapRingsX = new THREE.InstancedMesh(ringGeo, xrayMaterial(0xffffff, 0.55), Math.max(1, L.traps.length));
    L.traps.forEach((t, i) => { M4.compose(V.set(t.x, 0.11, t.z), Q.identity(), S.set(t.r, 1, t.r)); for (const m of [this.trapRings, this.trapRingsX]) { m.setMatrixAt(i, M4); m.setColorAt(i, C.setHex(0x806020)); } });
    this.trapRings.count = this.trapRingsX.count = L.traps.length;
    this.trapRingsX.renderOrder = 3;
    this.root.add(this.trapRings, this.trapRingsX);
    // The exfil pad: a ring of lamps and the pad's painted edge.
    const X = L.exfil;
    if (X) {
      st.at(X.x, X.z, 0);
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2;
        st.box(Math.cos(a) * X.r, 0.04, Math.sin(a) * X.r, 0.5, 0.06, 0.18, 0xd8c070, a + Math.PI / 2);
      }
      glow.at(X.x, X.z, 0);
      for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * Math.PI * 2; glow.box(Math.cos(a) * (X.r + 0.25), 0.12, Math.sin(a) * (X.r + 0.25), 0.18, 0.18, 0.18, 0x7dff9a, 0, false); }
    }
    // Trap floors and switch posts.
    const lampPos = [];
    for (const t of L.traps) {
      st.at(t.x, t.z, 0);
      if (t.kind === 'shock') for (let k = -2; k <= 2; k++) st.box(0, 0.05, k * t.r * 0.36, t.r * 1.8 * Math.sqrt(1 - (k * 0.36) ** 2 * 0.9), 0.08, 0.16, 0x7a8088);
      else if (t.kind === 'vent') for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; st.box(Math.cos(a) * t.r * 0.55, 0.03, Math.sin(a) * t.r * 0.55, 0.6, 0.06, 0.6, 0x2a2622, a).box(Math.cos(a) * t.r * 0.55, 0.07, Math.sin(a) * t.r * 0.55, 0.5, 0.02, 0.08, 0x8a5a2a, a); }
      else { for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; st.box(Math.cos(a) * t.r * 0.95, 0.06, Math.sin(a) * t.r * 0.95, 0.18, 0.12, t.r * 0.52, 0x3a3d42, a); } st.box(0, 0.14, 0, 0.36, 0.28, 0.36, 0x5a6068); }
      st.at(t.sx, t.sz, Math.atan2(t.z - t.sz, t.x - t.sx));
      st.box(0, 0.6, 0, 0.16, 1.2, 0.16, 0x3a3e44).box(0.05, 1.05, 0, 0.12, 0.3, 0.3, 0x5a5048);
      lampPos.push([t.sx, 1.32, t.sz]);
    }
    this.stations = st.mesh();
    this.glow = glow.mesh({ transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glow.renderOrder = 2;
    this.xray = new THREE.Mesh(this.glow.geometry, xrayMaterial(0xffffff, 0.45));
    this.xray.renderOrder = 3;
    // The stations' outlines through walls and roofs (the camera looks north: a bench on a north face hides behind its
    // building otherwise), and their lamps.
    this.ghost = new THREE.Mesh(ghost.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false, depthFunc: THREE.GreaterDepth, blending: THREE.AdditiveBlending, fog: false }));
    this.ghost.renderOrder = 3;
    this.root.add(this.stations, this.glow, this.xray, this.ghost);
    // Trap switch lamps: one instanced mesh.
    this.lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, lampPos.length));
    lampPos.forEach(([x, y, z], i) => { M4.makeTranslation(x, y, z); this.lamps.setMatrixAt(i, M4); this.lamps.setColorAt(i, C.setHex(0x59d36b)); });
    this.lamps.count = lampPos.length;
    this.root.add(this.lamps);
    // Trap effects, one mesh each.
    this.trapFx = L.traps.map(t => {
      let m;
      if (t.kind === 'shock') {
        const k = new Kit().at(0, 0, 0);
        for (let i = 0; i < 9; i++) { const a = i * 2.4, d = (i % 3) * t.r * 0.3; k.box(Math.cos(a) * d, 0.35, Math.sin(a) * d, 0.05, 0.7, t.r * 0.8, 0x9fe4ff, a, false); }
        k.box(0, 0.06, 0, t.r * 1.9, 0.02, t.r * 1.9, 0x3a7aff, 0, false);
        m = k.mesh({ transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
      } else if (t.kind === 'vent') {
        const g = new THREE.ConeGeometry(0.32, 1.6, 7, 1, true).translate(0, 0.8, 0);
        const parts = [];
        for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; parts.push(g.clone().translate(Math.cos(a) * t.r * 0.55, 0, Math.sin(a) * t.r * 0.55)); }
        m = new THREE.Mesh(mergeGeoms(parts), additive({ color: 0xff7a2a, opacity: 0.75, side: THREE.DoubleSide }));
      } else {
        const k = new Kit().at(0, 0, 0);
        for (let i = 0; i < 3; i++) k.box(0, 0.3, 0, t.r * 1.8, 0.05, 0.22, 0xc8ced6, i * Math.PI / 3);
        m = k.mesh();
      }
      m.position.set(t.x, 0, t.z);
      m.visible = false;
      this.root.add(m);
      return { m, kind: t.kind };
    });
    // The exfil beacon and its countdown ring.
    if (X) {
      this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(X.r * 0.7, X.r, 16, 16, 1, true), additive({ color: 0x7dff9a, opacity: 0.2, side: THREE.DoubleSide }));
      this.beacon.position.set(X.x, 8, X.z);
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), additive({ color: 0x7dff9a, opacity: 0.85, side: THREE.DoubleSide }));
      this.ring.position.set(X.x, 0.1, X.z);
      this.root.add(this.beacon, this.ring);
    }
    // Relics, and the altar's sockets.
    const nRel = L.relics.length;
    this.relics = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, nRel * 2));
    this.relics.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.relics.frustumCulled = false;
    this.root.add(this.relics);
    // The gun at work on the bench.
    this.benchGun = null; this.benchKey = '';
    // Gear: sentry, drone, lure, strike mark.
    const sentry = new Kit().at(0, 0, 0);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; sentry.box(Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3, 0.06, 0.62, 0.06, 0x3a3e44, a); }
    sentry.box(0, 0.68, 0, 0.5, 0.3, 0.34, 0x56604a).box(0.42, 0.7, 0, 0.5, 0.07, 0.07, 0x23262a).box(-0.05, 0.86, 0, 0.18, 0.06, 0.2, 0x4dffa0, 0, false);
    const drone = new Kit().at(0, 0, 0);
    drone.box(0, 2.4, 0, 0.42, 0.14, 0.42, 0x3a3e44).box(0.22, 2.36, 0, 0.12, 0.08, 0.1, 0x4dffa0, 0, false);
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; drone.box(Math.cos(a) * 0.32, 2.42, Math.sin(a) * 0.32, 0.36, 0.04, 0.05, 0x23262a, a).box(Math.cos(a) * 0.48, 2.48, Math.sin(a) * 0.48, 0.3, 0.015, 0.3, 0x9aa4a0, 0, false); }
    const lure = new Kit().at(0, 0, 0);
    lure.box(0, 0.45, 0, 0.12, 0.9, 0.12, 0x5a5048).box(0, 1.0, 0, 0.3, 0.3, 0.3, 0xff3a2a, 0.5, false).box(0, 0.2, 0, 0.5, 0.06, 0.5, 0x3a3e44);
    const gearMesh = (geom, mat) => { const m = new THREE.InstancedMesh(geom, mat, GEAR_MAX); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; this.root.add(m); return m; };
    this.gear = {
      sentry: gearMesh(sentry.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true })),
      drone: gearMesh(drone.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true })),
      lure: gearMesh(lure.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true })),
      strike: gearMesh(new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2), additive({ color: 0xff3a2a, opacity: 0.85, side: THREE.DoubleSide })),
    };
    this.t = 0;
  }

  update(obj, dt) {
    this.t += dt;
    const t = this.t, L = this.L;
    this.glow.material.opacity = 0.75 + 0.2 * Math.sin(t * 2.4);
    this.xray.material.opacity = 0.32 + 0.1 * Math.sin(t * 2.4);
    // Traps.
    (obj.traps ?? []).forEach((s, i) => {
      const fx = this.trapFx[i];
      if (!fx) return;
      const on = s.state === 1;
      fx.m.visible = on;
      this.lamps.setColorAt(i, C.setHex(s.state === 1 ? 0xff3a2a : s.state === 2 ? 0xffb21a : 0x59d36b));
      const rc = s.state === 1 ? C.setHex(0xff3a2a).multiplyScalar(0.7 + 0.3 * Math.sin(t * 8)) : C.setHex(s.state === 2 ? 0x805010 : 0x806020);
      this.trapRings.setColorAt(i, rc); this.trapRingsX.setColorAt(i, rc);
      if (!on) return;
      if (fx.kind === 'shock') { fx.m.material.opacity = 0.35 + 0.6 * Math.abs(Math.sin(t * 37 + i)) * (Math.sin(t * 13) > -0.3 ? 1 : 0.2); fx.m.rotation.y = Math.floor(t * 12) * 1.7; }
      else if (fx.kind === 'vent') { fx.m.scale.set(1, 0.75 + 0.35 * Math.abs(Math.sin(t * 9 + i)), 1); fx.m.material.opacity = 0.55 + 0.3 * Math.abs(Math.sin(t * 15)); }
      else fx.m.rotation.y = t * 14;
    });
    for (const m of [this.lamps, this.trapRings, this.trapRingsX]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.ghost.material.opacity = 0.3 + 0.1 * Math.sin(t * 2.4);
    // Exfil: hidden before its round, dim once it can be called, bright and counting down when called.
    if (this.beacon) {
      const X = obj.exfil ?? { state: 0 }, can = (obj.round ?? 0) >= ZE.exfil.from;
      this.beacon.visible = can || X.state === 1;
      this.beacon.material.opacity = X.state === 1 ? 0.35 + 0.15 * Math.sin(t * 5) : 0.08 + 0.04 * Math.sin(t * 2);
      this.ring.visible = X.state === 1;
      if (X.state === 1) this.ring.scale.setScalar(Math.max(0.05, L.exfil.r * (X.timer ?? 0) / ZE.exfil.hold));
    }
    // Relics and the altar's sockets.
    const q = obj.quest ?? { got: 0, state: 0 };
    let n = 0;
    for (const r of L.relics) {
      if (q.got & (1 << r.i)) continue;
      Q.setFromEuler(E.set(0, t * 1.6 + r.i, 0));
      M4.compose(V.set(r.x, 0.9 + Math.sin(t * 2 + r.i) * 0.08, r.z), Q, S.set(1, 1.5, 1));
      this.relics.setMatrixAt(n, M4); this.relics.setColorAt(n, C.setHex(0xb070ff)); n++;
    }
    const Al = L.altar;
    if (Al) {
      for (const r of L.relics) {
        const lit = q.got & (1 << r.i), c = Math.cos(Al.face), s = Math.sin(Al.face), side = (r.i - 1) * 0.42;
        M4.compose(V.set(Al.wx + c * 0.6 - s * side, 1.0, Al.wz + s * 0.6 + c * side), Q.identity(), S.setScalar(lit ? 0.8 + 0.15 * Math.sin(t * 3 + r.i) : 0.5));
        this.relics.setMatrixAt(n, M4); this.relics.setColorAt(n, C.setHex(q.state === 2 ? 0x59d36b : lit ? (q.state ? 0xff4dff : 0xb070ff) : 0x202024)); n++;
      }
    }
    this.relics.count = n;
    this.relics.instanceMatrix.needsUpdate = true;
    if (this.relics.instanceColor) this.relics.instanceColor.needsUpdate = true;
    // The gun on the bench.
    const b = obj.bench, B = L.bench;
    const key = b?.state && B ? `${b.gun}:${b.tier}` : '';
    if (key !== this.benchKey) {
      this.benchKey = key;
      if (this.benchGun) { this.root.remove(this.benchGun); this.benchGun.material.dispose(); this.benchGun = null; }
      const proto = key ? getGun(b.gun) : null;
      if (proto?.geometry) {
        const camo = b.tier >= 3 ? ZM_FX[zmFxOf(b.gun)].camo : b.tier === 2 ? 'gold' : 'pp-laurel';
        // Drawn over everything (a bench can stand behind its building from this camera): the gun at work reads anyway.
        this.benchGun = new THREE.Mesh(proto.geometry, new THREE.MeshBasicMaterial({ color: getCamo(camo).tint ?? 0xffd77a, depthTest: false, transparent: true, opacity: 0.95 }));
        this.benchGun.renderOrder = 6;
        this.benchGun.scale.setScalar(1.3);
        this.root.add(this.benchGun);
      }
    }
    if (this.benchGun && B) {
      const ready = b.state === 2;
      this.benchGun.position.set(B.wx + Math.cos(B.face) * 0.5, 1.6 + Math.sin(t * (ready ? 2 : 9)) * 0.06, B.wz + Math.sin(B.face) * 0.5);
      this.benchGun.rotation.y = t * (ready ? 1.1 : 7);
      this.benchGun.material.opacity = ready ? 0.95 : 0.55 + 0.4 * Math.abs(Math.sin(t * 11));
    }
    // Gear.
    const counts = { sentry: 0, drone: 0, lure: 0, strike: 0 };
    for (const g of obj.gear ?? []) {
      const m = this.gear[g.kind];
      if (!m || counts[g.kind] >= GEAR_MAX) continue;
      const k = counts[g.kind]++;
      if (g.kind === 'strike') { Q.identity(); M4.compose(V.set(g.x, 0.12, g.z), Q, S.setScalar(ZE.supply.strike.r * (0.9 + 0.1 * Math.sin(t * 10)))); }
      else if (g.kind === 'lure') { Q.setFromEuler(E.set(0, t * 3, 0)); M4.compose(V.set(g.x, 0, g.z), Q, S.setScalar(1 + 0.12 * Math.abs(Math.sin(t * 8)))); }
      else { Q.setFromEuler(E.set(0, -g.aim, 0)); M4.compose(V.set(g.x, g.kind === 'drone' ? Math.sin(t * 3 + k) * 0.12 : 0, g.z), Q, S.setScalar(1)); }
      m.setMatrixAt(k, M4);
    }
    for (const [kind, m] of Object.entries(this.gear)) { m.count = counts[kind]; m.instanceMatrix.needsUpdate = true; }
  }

  dispose() {
    this.root.traverse(o => { if (o.isMesh && o !== this.xray && o !== this.benchGun && o !== this.trapRingsX) { o.geometry?.dispose(); o.material?.dispose(); } });
    this.trapRingsX.material.dispose();
    this.benchGun?.material.dispose();
  }
}

function mergeGeoms(list) {
  const pos = [];
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0, p = g.attributes.position; for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  return g;
}
