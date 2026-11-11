// Battle royale world visuals (docs/BR.md), kept out of the renderer proper: the renderer makes one of these the first
// time a view carries a battle royale (view.br) and calls update() once a frame (two hook lines in renderer.js).
//   circle      a translucent wall where the circle stands, fading up from the ground; the next circle as a thin ring
//   transport   a blocky cargo plane flying the line, high over the field
//   loot        small crates near the camera, coloured by rarity, bobbing; rare and better get a light beam; chests
//   gliders     a canopy over everyone in the glide
//   downed      a pulsing red ring under downed players
// Everything is instanced or a single mesh, so this adds a handful of draw calls whatever is on the map.
import * as THREE from 'three';
import { BR } from '../shared/modes.js';
import { TEAMS } from '../shared/constants.js';
import { BR_KIND } from '../sim/br.js';

const LOOT_MAX = 180, CHEST_MAX = 24, BEAM_MAX = 60, CHUTE_MAX = 32, RING_MAX = 16;
const NEAR = 38;              // Metres around the camera target that loot is drawn.
const KIND_TINT = { [BR_KIND.ammo]: 0x9aa58a, [BR_KIND.plate]: 0x3fa0ff, [BR_KIND.med]: 0xf2f0e6, [BR_KIND.kit]: 0xffb21a, [BR_KIND.lethal]: 0xff6a3a, [BR_KIND.tactical]: 0x8cf0d0 };
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function wallTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, 'rgba(255,70,110,0.75)');
  grad.addColorStop(0.35, 'rgba(255,60,100,0.32)');
  grad.addColorStop(1, 'rgba(255,60,100,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BrFx {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.group = new THREE.Group();
    this.group.name = 'br-fx';
    scene.add(this.group);
    this.clock = 0;
    // Circle wall: an open cylinder of radius 1, scaled.
    this.wallTex = wallTexture();
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 16, 128, 1, true).translate(0, 8, 0),
      new THREE.MeshBasicMaterial({ map: this.wallTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 5;
    this.group.add(this.wall);
    this.nextRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 160).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.nextRing.frustumCulled = false;
    this.nextRing.position.y = 0.06;
    this.group.add(this.nextRing);
    // Transport.
    const plane = new THREE.Group(), hull = new THREE.MeshLambertMaterial({ color: 0x59606a }), dark = new THREE.MeshLambertMaterial({ color: 0x2c3138 });
    const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); plane.add(b); };
    box(11, 2.2, 2.4, 0, 0, 0, hull);         // Fuselage, nose along +x.
    box(2.2, 1.6, 2, 6, -0.2, 0, dark);       // Nose.
    box(3, 0.35, 15, 0.5, 0.6, 0, hull);      // Wings.
    box(1.6, 0.3, 5.5, -5, 0.8, 0, hull);     // Tailplane.
    box(1.6, 2.4, 0.3, -5, 1.8, 0, hull);     // Fin.
    for (const z of [-4.2, 4.2]) box(1.8, 1, 1, 1.6, 0.1, z, dark);   // Engines.
    plane.visible = false;
    this.plane = plane;
    this.group.add(plane);
    // Loot, chests, beams, canopies, rings.
    const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; this.group.add(m); return m; };
    this.loot = inst(new THREE.BoxGeometry(0.46, 0.3, 0.46), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 }), LOOT_MAX);
    this.chests = inst(new THREE.BoxGeometry(1.15, 0.72, 0.8), new THREE.MeshLambertMaterial({ color: 0x8a6a2a, emissive: 0x3a2a08 }), CHEST_MAX);
    this.beams = inst(new THREE.CylinderGeometry(0.09, 0.2, 4, 6, 1, true).translate(0, 2, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }), BEAM_MAX);
    this.chutes = inst(new THREE.SphereGeometry(1.7, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2.2), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), CHUTE_MAX);
    this.rings = inst(new THREE.RingGeometry(0.7, 0.95, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.8, depthWrite: false }), RING_MAX);
    this.near = [];
    // A chest's lid flies when it opens: a short pop drawn as a beam burst.
    this.pops = [];
  }

  onChest(x, z) { this.pops.push({ x, z, t: 0 }); }

  update(view, dt, camX, camZ) {
    const br = view.br;
    if (!br) return;
    this.clock += dt;
    const t = this.clock;
    // Circle.
    const huge = br.circle.r > Math.hypot(this.map.width, this.map.height) / 2;
    this.wall.visible = !huge && br.circle.r > 0.5;
    if (this.wall.visible) { this.wall.position.set(br.circle.x, 0, br.circle.z); this.wall.scale.set(br.circle.r, 1, br.circle.r); }
    this.nextRing.visible = br.state !== 'final' && br.plane.f >= 1 && br.next.r > 0.5;
    if (this.nextRing.visible) { this.nextRing.position.set(br.next.x, 0.06, br.next.z); this.nextRing.scale.set(br.next.r, 1, br.next.r); }
    // Transport.
    this.plane.visible = br.plane.f < 1;
    if (this.plane.visible) {
      this.plane.position.set(br.plane.x, 14, br.plane.z);
      this.plane.rotation.set(0, -Math.atan2(br.plane.tz - br.plane.fz, br.plane.tx - br.plane.fx), Math.sin(t * 0.7) * 0.03);
    }
    // Loot near the camera.
    const rules = br.rules;
    let nL = 0, nC = 0, nB = 0;
    if (rules) {
      const list = rules.near(camX, camZ, NEAR, this.near);
      for (const it of list) {
        if (it.kind === BR_KIND.chest) {
          if (nC >= CHEST_MAX) continue;
          V.set(it.x, 0.36, it.z); Q.setFromAxisAngle(UP, (it.id % 7) * 0.45); S.set(1, 1, 1);
          this.chests.setMatrixAt(nC++, M4.compose(V, Q, S));
          if (nB < BEAM_MAX) { V.set(it.x, 0.7, it.z); S.set(1.4, 0.8 + Math.sin(t * 3 + it.id) * 0.1, 1.4); this.beams.setMatrixAt(nB, M4.compose(V, Q.identity(), S)); this.beams.setColorAt(nB++, C.setHex(0xffc24a)); }
          continue;
        }
        if (nL >= LOOT_MAX) continue;
        const bob = 0.22 + Math.sin(t * 2.4 + it.id * 1.3) * 0.06;
        V.set(it.x, bob, it.z); Q.setFromAxisAngle(UP, t * 0.8 + it.id); S.set(it.kind === BR_KIND.gun ? 1.6 : 1, 1, it.kind === BR_KIND.gun ? 0.7 : 1);
        this.loot.setMatrixAt(nL, M4.compose(V, Q, S));
        this.loot.setColorAt(nL++, C.setHex(it.kind === BR_KIND.gun ? BR.rarityHex[it.r] : KIND_TINT[it.kind] ?? 0xffffff));
        if (it.kind === BR_KIND.gun && it.r >= 2 && nB < BEAM_MAX) {
          V.set(it.x, 0, it.z); S.set(1, 0.6 + it.r * 0.25, 1);
          this.beams.setMatrixAt(nB, M4.compose(V, Q.identity(), S));
          this.beams.setColorAt(nB++, C.setHex(BR.rarityHex[it.r]));
        }
      }
    }
    // Chest pops.
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      if (p.t > 0.8) { this.pops.splice(i, 1); continue; }
      if (nB < BEAM_MAX) {
        V.set(p.x, 0, p.z); S.set(4 * (1 - p.t), 2 + p.t * 3, 4 * (1 - p.t));
        this.beams.setMatrixAt(nB, M4.compose(V, Q.identity(), S));
        this.beams.setColorAt(nB++, C.setHex(0xffe08a));
      }
    }
    this.loot.count = nL; this.chests.count = nC; this.beams.count = nB;
    for (const m of [this.loot, this.chests, this.beams]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // Canopies and downed rings.
    let nP = 0, nR = 0;
    for (const p of view.players) {
      if (!p.alive) continue;
      if (Math.abs(p.x - camX) > 50 || Math.abs(p.z - camZ) > 40) continue;
      if (p.air === 2 && nP < CHUTE_MAX) {
        V.set(p.x, 3.3, p.z); Q.setFromAxisAngle(UP, p.aim); S.set(1, 0.8, 1);
        this.chutes.setMatrixAt(nP, M4.compose(V, Q, S));
        this.chutes.setColorAt(nP++, C.setHex(TEAMS[p.team]?.color ?? 0xffffff));
      }
      if (p.downed && nR < RING_MAX) {
        const k = 1 + Math.sin(t * 7) * 0.12;
        V.set(p.x, 0.05, p.z); S.set(k, 1, k);
        this.rings.setMatrixAt(nR++, M4.compose(V, Q.identity(), S));
      }
    }
    this.chutes.count = nP; this.rings.count = nR;
    this.chutes.instanceMatrix.needsUpdate = true;
    if (this.chutes.instanceColor) this.chutes.instanceColor.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.wallTex.dispose();
  }
}
