// Graveyard Shift's specials in the world (docs/ZOMBIES.md "Special zombies"; js/sim/zm-kinds.js), made by ZmFx:
//   globs     a Spitter's acid in flight, on its arc (from the 'zspit' event: no snapshot cost)
//   marks     where each glob will land, a pulsing ring on the ground for the whole flight: step out of it
//   puddles   acid on the ground for ZM_SPIT.life s, fading; a Bloater's burst leaves a violet splash the same way
//   shields   a Shieldbearer's shield, held in front of it while it lasts (from the view: zk 9 with zshield)
//   fog       on a fog round, a dark wash over everything past ZM_FOG metres of the local player
// Five instanced meshes (one draw call each, nothing drawn when empty) and the fog disc on a fog round only.
import * as THREE from 'three';
import { ZM_SPIT, ZM_BLAST, ZM_FOG } from '../shared/zombies.js';

const MAX = 12;
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
const ACID = 0x9cff3a, BURST = 0xc070d0;

function inst(geo, mat, n = MAX) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0; m.frustumCulled = false;
  return m;
}

// Rings of radius 0, r-4, r+1.5 and 90 m: alpha 0 inside, 0.97 past r+1.5. 32 segments, about 200 triangles.
function fogDisc(r) {
  const radii = [0.01, r - 4, r - 1.5, r + 1.5, 90], alpha = [0, 0, 0.55, 0.97, 0.97], seg = 32, pos = [], col = [], idx = [];
  for (let i = 0; i < radii.length; i++) for (let k = 0; k < seg; k++) {
    const a = k / seg * Math.PI * 2;
    pos.push(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]);
    col.push(0.09, 0.11, 0.1, alpha[i]);
  }
  for (let i = 0; i + 1 < radii.length; i++) for (let k = 0; k < seg; k++) {
    const a = i * seg + k, b = i * seg + (k + 1) % seg, c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

export class ZmKindsFx {
  constructor(group) {
    this.t = 0;
    this.globs = [];       // {ox, oz, x, z, t0, dur}
    this.pools = [];       // {x, z, r, t0, life, rgb}
    this.globMesh = inst(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: ACID }));
    const flat = (geo) => { geo.rotateX(-Math.PI / 2); return geo; };
    this.markMesh = inst(flat(new THREE.RingGeometry(0.82, 1, 20)), new THREE.MeshBasicMaterial({ color: ACID, transparent: true, opacity: 0.75, depthWrite: false }));
    this.poolMesh = inst(flat(new THREE.CircleGeometry(1, 14)), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.poolMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    // The shield: a riveted iron door, held upright a little off the chest.
    const sg = new THREE.BoxGeometry(0.24, 1.2, 1.0);
    sg.translate(0.55, 0.85, 0);
    this.shieldMesh = inst(sg, new THREE.MeshBasicMaterial({ color: 0xb4b9c0 }), 8);
    // Fog: a flat disc over the view, clear round the player and dark past ZM_FOG (vertex alpha; its opacity fades
    // the whole thing in and out).
    this.fog = new THREE.Mesh(fogDisc(ZM_FOG), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.fog.position.y = 2.7;
    this.fog.renderOrder = 999;
    this.fog.frustumCulled = false;
    this.fog.visible = false;
    this.fogK = 0;
    for (const m of [this.poolMesh, this.markMesh, this.globMesh, this.shieldMesh, this.fog]) group.add(m);
  }

  onEvent(ev) {
    if (ev.t === 'zspit') {
      this.globs.push({ ox: ev.ox, oz: ev.oz, x: ev.x, z: ev.z, t0: this.t, dur: Math.max(0.2, ev.dur) });
      if (this.globs.length > MAX) this.globs.shift();
    } else if (ev.t === 'zblast') this._pool(ev.x, ev.z, (ev.r ?? ZM_BLAST.r) * 0.75, 1.4, BURST);
  }
  _pool(x, z, r, life, rgb) {
    this.pools.push({ x, z, r, t0: this.t, life, rgb });
    if (this.pools.length > MAX) this.pools.shift();
  }

  update(view, obj, dt) {
    this.t += dt;
    const t = this.t;
    // Globs and their landing marks.
    let n = 0;
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const g = this.globs[i], u = (t - g.t0) / g.dur;
      if (u >= 1) { this.globs.splice(i, 1); this._pool(g.x, g.z, ZM_SPIT.r, ZM_SPIT.life, ACID); continue; }
      const h = 1.5 * (1 - u) + 0.1 + Math.sin(Math.PI * u) * (1.2 + 0.08 * Math.hypot(g.x - g.ox, g.z - g.oz));
      M4.makeTranslation(g.ox + (g.x - g.ox) * u, h, g.oz + (g.z - g.oz) * u);
      this.globMesh.setMatrixAt(n, M4);
      const k = ZM_SPIT.hitR + 0.25 + 0.12 * Math.sin(t * 14);
      M4.compose(V.set(g.x, 0.06, g.z), Q.identity(), S.set(k, 1, k));
      this.markMesh.setMatrixAt(n, M4);
      n++;
    }
    this.globMesh.count = this.markMesh.count = n;
    if (n) { this.globMesh.instanceMatrix.needsUpdate = true; this.markMesh.instanceMatrix.needsUpdate = true; }
    // Puddles and splashes, fading out (the colour fades toward black: the mesh is one material).
    n = 0;
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i], u = (t - p.t0) / p.life;
      if (u >= 1) { this.pools.splice(i, 1); continue; }
      const grow = Math.min(1, (t - p.t0) * 6), r = p.r * (0.6 + 0.4 * grow);
      M4.compose(V.set(p.x, 0.04 + n * 0.002, p.z), Q.identity(), S.set(r, 1, r));
      this.poolMesh.setMatrixAt(n, M4);
      C.setHex(p.rgb).multiplyScalar(1 - u * u);
      this.poolMesh.setColorAt(n, C);
      n++;
    }
    this.poolMesh.count = n;
    if (n) { this.poolMesh.instanceMatrix.needsUpdate = true; this.poolMesh.instanceColor.needsUpdate = true; }
    // Shields, on the Shieldbearers that still have one.
    n = 0;
    for (const p of view.players) {
      if (p.zk !== 9 || !p.alive || !p.zshield || n >= 8) continue;
      E.set(0, -p.aim, 0); Q.setFromEuler(E);
      M4.compose(V.set(p.x, 0, p.z), Q, S.set(1, 1, 1));
      this.shieldMesh.setMatrixAt(n++, M4);
    }
    this.shieldMesh.count = n;
    if (n) this.shieldMesh.instanceMatrix.needsUpdate = true;
    // The fog round.
    const me = view.players.find(p => p.id === view.localId);
    this.fogK += ((obj.special === 'fog' && me ? 1 : 0) - this.fogK) * Math.min(1, dt * 1.5);
    this.fog.visible = this.fogK > 0.01;
    if (this.fog.visible && me) {
      this.fog.position.x = me.x; this.fog.position.z = me.z;
      this.fog.material.opacity = this.fogK;
    }
  }
}
