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

const GLOW_MAX = 200, LOOT_MAX = 180, CHEST_MAX = 24, BEAM_MAX = 60, CHUTE_MAX = 32, RING_MAX = 16, BAR_MAX = 16, PING_MAX = 8;
const NEAR = 38;              // Metres around the camera target that loot is drawn.
const KIND_TINT = { [BR_KIND.ammo]: 0x9aa58a, [BR_KIND.plate]: 0x3fa0ff, [BR_KIND.med]: 0xf2f0e6, [BR_KIND.kit]: 0xffb21a, [BR_KIND.lethal]: 0xff6a3a, [BR_KIND.tactical]: 0x8cf0d0 };
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const _qs = new THREE.Quaternion(), _ax = new THREE.Vector3(1, 0, 0);

// A parafoil: a wide arched wing of cells (alternate cells a shade darker), a little thickness at the front, and four
// cords down to the harness at the origin. One non-indexed geometry with vertex colours, tinted per instance by team.
function canopyGeometry() {
  const pos = [], col = [];
  const tri = (a, b, c, k) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) col.push(k, k, k); };
  const quad = (a, b, c, d, k) => { tri(a, b, c, k); tri(a, c, d, k); };
  const CELLS = 9, SPAN = 4.2, CHORD = 1.5, H = 3.6;
  const at = (u, f) => {       // u -1..1 across the span, f 0 (front) .. 1 (back)
    const x = u * SPAN / 2, y = H - u * u * 0.9 + Math.sin(f * Math.PI) * 0.18, z = (f - 0.4) * CHORD;
    return [z, y, x];          // Span across the flight direction (local z), chord along it (local x).
  };
  for (let i = 0; i < CELLS; i++) {
    const u0 = -1 + 2 * i / CELLS, u1 = -1 + 2 * (i + 1) / CELLS, k = i % 2 ? 0.78 : 1;
    for (let j = 0; j < 3; j++) {
      const f0 = j / 3, f1 = (j + 1) / 3;
      quad(at(u0, f0), at(u1, f0), at(u1, f1), at(u0, f1), k);
    }
    // The open front of the cell, a band hanging under the leading edge.
    const a = at(u0, 0), b = at(u1, 0);
    quad(a, b, [b[0], b[1] - 0.22, b[2]], [a[0], a[1] - 0.22, a[2]], k * 0.6);
  }
  // Cords: thin strips from the wing's underside to the harness.
  for (const u of [-0.85, -0.35, 0.35, 0.85]) {
    const top = at(u, 0.35), w = 0.03;
    quad([top[0] - w, top[1], top[2]], [top[0] + w, top[1], top[2]], [w, 1.2, 0], [-w, 1.2, 0], 0.25);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

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
    const plane = new THREE.Group(), hull = new THREE.MeshBasicMaterial({ color: 0x6a727c }), dark = new THREE.MeshBasicMaterial({ color: 0x2c3138 });
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
    const inst = (geo, mat, n) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0; m.frustumCulled = false; m.renderOrder = 3;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Colour per instance from the start, so the program is built with it.
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    // A soft disc under every item, in its rarity or kind colour, so loot reads at gameplay zoom.
    this.glows = inst(new THREE.CircleGeometry(0.75, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending }), GLOW_MAX);
    this.loot = inst(new THREE.BoxGeometry(0.6, 0.34, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }), LOOT_MAX);
    this.chests = inst(new THREE.BoxGeometry(1.15, 0.72, 0.8), new THREE.MeshBasicMaterial({ color: 0xc8962e }), CHEST_MAX);
    this.beams = inst(new THREE.CylinderGeometry(0.09, 0.2, 4, 6, 1, true).translate(0, 2, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }), BEAM_MAX);
    this.chutes = inst(canopyGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }), CHUTE_MAX);
    // Revive progress over the downed player and whoever is picking them up: a dark bar and its fill.
    const bar = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.barBg = inst(bar, new THREE.MeshBasicMaterial({ color: 0x0a0d11, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, toneMapped: false }), BAR_MAX);
    this.barFill = inst(bar.clone(), new THREE.MeshBasicMaterial({ color: 0x7dff8f, transparent: true, opacity: 1, depthWrite: false, depthTest: false, toneMapped: false, fog: false }), BAR_MAX);
    this.barBg.renderOrder = 8; this.barFill.renderOrder = 9;
    // Landing pings: a teammate's chosen spot, a beam and a ring for a few seconds (js/ui/br-hud.js sends them).
    this.pingRings = inst(new THREE.RingGeometry(1.1, 1.5, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }), PING_MAX);
    this.pingList = [];
    this.rings = inst(new THREE.RingGeometry(0.7, 0.95, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.8, depthWrite: false }), RING_MAX);
    this.near = [];
    // A chest's lid flies when it opens: a short pop drawn as a beam burst.
    this.pops = [];
  }

  onChest(x, z) { this.pops.push({ x, z, t: 0 }); }

  // A squadmate's landing ping: shown for a while where it was put.
  ping(x, z, color = 0xffc24a) { this.pingList.push({ x, z, t: 0, color }); if (this.pingList.length > PING_MAX) this.pingList.shift(); }

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
    let nL = 0, nC = 0, nB = 0, nG = 0;
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
        const hex = it.kind === BR_KIND.gun ? BR.rarityHex[it.r] : KIND_TINT[it.kind] ?? 0xffffff;
        this.loot.setColorAt(nL++, C.setHex(hex));
        if (nG < GLOW_MAX) {
          V.set(it.x, 0.04, it.z); S.set(1, 1, 1);
          this.glows.setMatrixAt(nG, M4.compose(V, Q.identity(), S));
          this.glows.setColorAt(nG++, C.setHex(hex));
        }
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
    this.loot.count = nL; this.chests.count = nC; this.beams.count = nB; this.glows.count = nG;
    for (const m of [this.loot, this.chests, this.beams, this.glows]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // Canopies and downed rings.
    let nP = 0, nR = 0;
    for (const p of view.players) {
      if (!p.alive) continue;
      if (Math.abs(p.x - camX) > 50 || Math.abs(p.z - camZ) > 40) continue;
      if (p.air === 2 && nP < CHUTE_MAX) {
        // The wing faces the way the glide goes and swings a little under it.
        V.set(p.x, 0.4, p.z); Q.setFromAxisAngle(UP, -p.aim); S.set(1, 1, 1);
        Q.multiply(_qs.setFromAxisAngle(_ax, Math.sin(t * 1.7 + p.x) * 0.08));
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
    // Revive bars over both players.
    let nBar = 0;
    for (const d of view.players) {
      if (!d.alive || !d.downed || !(d.reviveK > 0.01) || nBar >= BAR_MAX - 1) continue;
      if (Math.abs(d.x - camX) > 50 || Math.abs(d.z - camZ) > 40) continue;
      let helper = null, bd = 2.6;
      for (const q of view.players) {
        if (q === d || q.team !== d.team || !q.alive || q.downed || q.air) continue;
        const k = Math.hypot(q.x - d.x, q.z - d.z);
        if (k < bd) { bd = k; helper = q; }
      }
      for (const at of helper ? [d, helper] : [d]) {
        const k = Math.max(0.02, Math.min(1, d.reviveK));
        V.set(at.x, 2.6, at.z - 0.75); Q.identity(); S.set(1.9, 1, 0.32);
        this.barBg.setMatrixAt(nBar, M4.compose(V, Q, S));
        V.set(at.x - 0.88 + 0.88 * k, 2.62, at.z - 0.75); S.set(1.76 * k, 1, 0.2);
        this.barFill.setMatrixAt(nBar++, M4.compose(V, Q, S));
      }
    }
    this.barBg.count = nBar; this.barFill.count = nBar;
    this.barBg.instanceMatrix.needsUpdate = true; this.barFill.instanceMatrix.needsUpdate = true;
    // Landing pings.
    let nPing = 0;
    for (let i = this.pingList.length - 1; i >= 0; i--) {
      const g = this.pingList[i];
      g.t += dt;
      if (g.t > 9) { this.pingList.splice(i, 1); continue; }
      const k = 1 + (g.t * 1.6 % 1) * 0.6;
      V.set(g.x, 0.08, g.z); Q.identity(); S.set(k, 1, k);
      this.pingRings.setMatrixAt(nPing, M4.compose(V, Q, S));
      this.pingRings.setColorAt(nPing++, C.setHex(g.color));
      if (nB < BEAM_MAX) {
        V.set(g.x, 0, g.z); S.set(2.2, 4, 2.2);
        this.beams.setMatrixAt(nB, M4.compose(V, Q, S));
        this.beams.setColorAt(nB++, C.setHex(g.color));
      }
    }
    this.pingRings.count = nPing;
    this.pingRings.instanceMatrix.needsUpdate = true;
    if (this.pingRings.instanceColor) this.pingRings.instanceColor.needsUpdate = true;
    if (nPing) { this.beams.count = nB; this.beams.instanceMatrix.needsUpdate = true; if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true; }
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
