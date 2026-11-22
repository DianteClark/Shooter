// Conquest and Breakthrough in the world (ROADMAP 65, docs/MODES.md "Conquest and Breakthrough"), kept out of the
// renderer proper like the campaign's: the renderer makes one the first time a view carries a `bf` block and calls
// update() once a frame. Flags and objectives are the ordinary Domination flags (combat.js); this draws the lines:
//   front lines  Breakthrough's line ahead of the attackers (the defenders' colour) and the one behind them (the
//                attackers'): a glowing strip on the ground under a low curtain of light
//   area edge    on a part of a battle royale island, the edge of the field in warning red
// Two instanced meshes, so two draw calls whatever the layout.
import * as THREE from 'three';
import { TEAM_RGB } from '../shared/palette.js';
import { lineSegment } from '../shared/bf.js';

const MAX = 8, CURTAIN = 2.2, STRIP = 0.55;
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const EDGE = [1, 0.32, 0.24];

// A curtain: a vertical plane along +x from 0 to 1, 0 to 1 high, bright at the foot and gone at the top (additive).
function curtainGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 1, 1).translate(0.5, 0.5, 0);
  const col = new Float32Array(4 * 3);
  const pos = g.attributes.position;
  for (let i = 0; i < 4; i++) { const k = pos.getY(i) > 0.5 ? 0 : 1; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class BfFx {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.group = new THREE.Group();
    this.group.name = 'bf-fx';
    scene.add(this.group);
    const inst = (geo, mat, order) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX);
      m.count = 0; m.frustumCulled = false; m.renderOrder = order;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false };
    // The strip blends normally (additive washes out to white on bright ground); the curtain adds light above it.
    this.strips = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.7, transparent: true, depthWrite: false, fog: false }), 3);
    this.curtains = inst(curtainGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, opacity: 0.5, side: THREE.DoubleSide, ...add }), 4);
    this.key = '';
    this.t = 0;
  }

  update(view, dt) {
    const o = view.obj ?? view.points?.obj;
    const l = o?.layout;
    this.t += dt;
    if (!l) { this.strips.count = this.curtains.count = 0; return; }
    // Rebuilt only when what is drawn changes (the sector); the pulse rides the material.
    const key = `${l.id}|${o.kind}|${o.sector ?? 0}|${o.att ?? 0}`;
    const pulse = 0.42 + 0.14 * Math.sin(this.t * 2.4);
    this.strips.material.opacity = pulse + 0.25;
    this.curtains.material.opacity = pulse;
    if (key === this.key) return;
    this.key = key;
    const segs = [];
    if (l.sub) {
      const a = l.area;
      segs.push([a.x, a.z, a.x + a.w, a.z, EDGE], [a.x + a.w, a.z, a.x + a.w, a.z + a.h, EDGE], [a.x + a.w, a.z + a.h, a.x, a.z + a.h, EDGE], [a.x, a.z + a.h, a.x, a.z, EDGE]);
    }
    if (o.kind === 'bt' && l.lines) {
      const i = Math.min(o.sector, l.sectors.length - 1);
      const att = TEAM_RGB[o.att] ?? EDGE, def = TEAM_RGB[1 - o.att] ?? EDGE;
      for (const [s, rgb] of [[i > 0 ? l.lines[i - 1] : null, att], [i < l.lines.length ? l.lines[i] : null, def]]) {
        if (s == null) continue;
        const seg = lineSegment(l, s);
        if (seg) segs.push([...seg, rgb]);
      }
    }
    let n = 0;
    for (const [x0, z0, x1, z1, rgb] of segs) {
      if (n >= MAX) break;
      const len = Math.hypot(x1 - x0, z1 - z0), ang = -Math.atan2(z1 - z0, x1 - x0);
      Q.setFromAxisAngle(UP, ang);
      C.setRGB(rgb[0], rgb[1], rgb[2]);
      M4.compose(V.set(x0, 0.06, z0), Q, S.set(len, 1, STRIP));
      this.strips.setMatrixAt(n, M4); this.strips.setColorAt(n, C);
      M4.compose(V.set(x0, 0, z0), Q, S.set(len, CURTAIN, 1));
      this.curtains.setMatrixAt(n, M4); this.curtains.setColorAt(n, C);
      n++;
    }
    this.strips.count = this.curtains.count = n;
    for (const m of [this.strips, this.curtains]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}
