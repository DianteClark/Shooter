// The co-op campaign's world visuals (docs/CAMPAIGN.md), kept out of the renderer proper like extraction's: the
// renderer makes one the first time a view carries the campaign block and calls update() once a frame.
//   objective  a pale blue beam over where the step wants you, and a ring for a zone to hold (amber while contested)
//   terminal   the signal box terminal on a hack step; charges and taps on their sites (a blinking light once set)
//   hazards    the boss's barrage rings (a red ring with a disc filling as it lands) and his charge line
//   torches    each stealth watchman's torch as a soft fan on the ground ahead of him, hotter as his meter fills
//   boss       Marshal Kordell's crown: a gold crest turning over his head, a crimson beam on him and a crimson ring
//              breathing on the ground round him (with the gilded suit and his bigger build in combat.js and characters.js);
//              a mission's own boss (Operation Starfall's Vane) wears its crest in its own colour
//   flare      a night mission (Operation Starfall's Dark Sky): a flare's light hanging over the field while it burns
//              (the dark round the player is the HUD's, js/ui/cp-hud.js)
// A handful of meshes and instanced lists: a few draw calls whatever the mission holds.
import * as THREE from 'three';
import { CP } from '../shared/campaign.js';

const BEAM_MAX = 6, SITE_MAX = 6, HAZ_MAX = 8, CONE_MAX = 10;
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const BOSS_ROLE = 5;     // js/sim/campaign.js ROLES.indexOf('boss')
const BLUE = 0x7cc8ff, AMBER = 0xffb21a, RED = 0xff4a2a, GREEN = 0x59d36b;

// Non-indexed copies of each geometry, joined into one (the crest's points and band).
function mergeAll(geos) {
  const pos = [];
  for (const g of geos) { const p = (g.index ? g.toNonIndexed() : g).attributes.position.array; for (let i = 0; i < p.length; i++) pos.push(p[i]); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return out;
}

function noFog(root) { root.traverse(o => { if (o.material) o.material.fog = false; }); return root; }

export class CpFx {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.group = new THREE.Group();
    this.group.name = 'cp-fx';
    scene.add(this.group);
    this.clock = 0;
    const inst = (geo, mat, n, order = 3) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0; m.frustumCulled = false; m.renderOrder = order;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    this.beams = inst(new THREE.CylinderGeometry(0.16, 0.42, 16, 8, 1, true).translate(0, 8, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.4, ...add, side: THREE.DoubleSide }), BEAM_MAX, 5);
    this.rings = inst(new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }), BEAM_MAX + HAZ_MAX);
    this.discs = inst(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }), BEAM_MAX + HAZ_MAX);
    // A charge or tap: a dark box with a lamp on it.
    this.boxes = inst(new THREE.BoxGeometry(0.5, 0.32, 0.36).translate(0, 0.16, 0), new THREE.MeshBasicMaterial({ color: 0x2a2f35 }), SITE_MAX);
    this.lamps = inst(new THREE.BoxGeometry(0.14, 0.1, 0.14).translate(0, 0.37, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), SITE_MAX);
    // Charge lines: flat strips along the ground.
    this.lines = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }), HAZ_MAX);
    // Torches: a fan on the ground, its tip at the watchman.
    const cone = new THREE.CircleGeometry(CP.detect.range, 20, -CP.detect.cone, CP.detect.cone * 2).rotateX(-Math.PI / 2);
    this.cones = inst(cone, new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.16, ...add }), CONE_MAX, 2);
    // The terminal on a hack step.
    const term = this.term = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.5), new THREE.MeshBasicMaterial({ color: 0x2c333b }));
    base.position.y = 0.5; term.add(base);
    const screen = this.termScreen = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.08), new THREE.MeshBasicMaterial({ color: 0x3affd8 }));
    screen.position.set(0, 1.18, 0.12); screen.rotation.x = -0.4; term.add(screen);
    term.visible = false;
    this.group.add(term);
    // The boss's crest: a gold crown of five points over his head (one mesh, drawn only while he stands).
    const crown = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      crown.push(new THREE.ConeGeometry(0.11, 0.34, 4).translate(Math.cos(a) * 0.26, 0.17, Math.sin(a) * 0.26));
    }
    crown.push(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 10, 1, true));
    this.crest = new THREE.Mesh(mergeAll(crown), new THREE.MeshBasicMaterial({ color: 0xffc23a, side: THREE.DoubleSide }));
    this.crest.visible = false; this.crest.renderOrder = 4;
    this.group.add(this.crest);
    // A flare's light, hanging over the field on a night mission.
    this.flare = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2d8 }));
    this.flare.visible = false; this.flare.renderOrder = 4;
    this.group.add(this.flare);
    noFog(this.group);
  }

  #put(mesh, i, x, y, z, sx, sy, sz, color, rot = 0) {
    Q.setFromAxisAngle(UP, rot);
    M4.compose(V.set(x, y, z), Q, S.set(sx, sy, sz));
    mesh.setMatrixAt(i, M4);
    mesh.setColorAt(i, C.set(color));
  }

  update(view, dt) {
    const cp = view.obj ?? view.points?.obj;
    if (!cp?.cp) return;
    this.clock += dt;
    const t = this.clock, s = cp.step, live = cp.state === 'live';
    let nb = 0, nr = 0, nd = 0, ns = 0, nl = 0, nc = 0;
    const beam = (x, z, col) => { if (nb < BEAM_MAX) this.#put(this.beams, nb++, x, 0, z, 1, 1, 1, col); };
    const ring = (x, z, r, col, disc = 0.22) => {
      if (nr < BEAM_MAX + HAZ_MAX) this.#put(this.rings, nr++, x, 0.06, z, r, 1, r, col);
      if (disc > 0 && nd < BEAM_MAX + HAZ_MAX) this.#put(this.discs, nd++, x, 0.05, z, r, 1, r, C.set(col).multiplyScalar(disc / 0.22).getHex());
    };
    this.term.visible = false;
    if (live && s) {
      if (s.type === 'plant') {
        for (const x of cp.sites ?? []) {
          if (ns >= SITE_MAX) break;
          const set = x.state === 1, pulled = set && x.def > 0.05;
          this.#put(this.boxes, ns, x.x, 0, x.z, 1, 1, 1, 0x2a2f35);
          const blink = set ? (Math.sin(t * (cp.fuse > 0 ? 10 + (1 - cp.fuse / 40) * 18 : 6)) > 0 ? RED : 0x401010) : 0x404850;
          this.#put(this.lamps, ns++, x.x, 0, x.z, 1, 1, 1, pulled ? AMBER : blink);
          if (!set) { beam(x.x, x.z, BLUE); ring(x.x, x.z, CP.plantReach, BLUE, 0.1); }
          else if (pulled) ring(x.x, x.z, CP.plantReach, AMBER, 0.15);
        }
      } else if (s.type === 'escort' || s.type === 'chase') {
        const g = cp.route?.[cp.gate];
        if (g) { beam(g.x, g.z, BLUE); ring(g.x, g.z, s.type === 'chase' ? (s.r ?? 10) : 2.6, cp.timer > 0 && cp.timer < 15 ? AMBER : BLUE, 0.08); }
      } else if (s.type === 'kill') {
        if (cp.ping) beam(cp.ping.x, cp.ping.z, AMBER);
      } else if (s.type !== 'boss' && cp.at) {
        const zone = s.type === 'hack' || s.type === 'defend' || s.type === 'extract';
        const col = cp.contested || (s.type === 'defend' && cp.lost > 0.3) ? AMBER : s.type === 'extract' && cp.prog > 0 ? GREEN : BLUE;
        beam(cp.at.x, cp.at.z, col);
        ring(cp.at.x, cp.at.z, zone ? (s.r ?? 5) : (s.r ?? 4), col, zone ? 0.12 : 0.06);
        if (s.type === 'hack') {
          this.term.visible = true;
          this.term.position.set(cp.at.x, 0, cp.at.z);
          this.termScreen.material.color.set(cp.contested ? AMBER : Math.sin(t * 4) > 0 ? 0x3affd8 : 0x1a9a80);
        }
      }
    }
    // The boss's telegraphs.
    for (const h of cp.hazards ?? []) {
      const k = Math.max(0, Math.min(1, 1 - h.t / Math.max(0.1, h.w)));
      if (h.k === 0) {
        ring(h.x, h.z, h.r, RED, 0);
        if (nd < BEAM_MAX + HAZ_MAX) this.#put(this.discs, nd++, h.x, 0.05, h.z, h.r * k, 1, h.r * k, C.set(RED).multiplyScalar(0.6 + 0.4 * Math.sin(t * 20)).getHex());
      } else if (nl < HAZ_MAX) {
        const dx = h.x2 - h.x, dz = h.z2 - h.z, L = Math.hypot(dx, dz) || 1;
        this.#put(this.lines, nl++, (h.x + h.x2) / 2, 0.07, (h.z + h.z2) / 2, L, 1, h.r * 2, C.set(RED).multiplyScalar(0.5 + 0.5 * k).getHex(), -Math.atan2(dz, dx));
      }
    }
    // The night's flare (the dark itself is the HUD's: js/ui/cp-hud.js, a pool of light round the player).
    const lit = cp.flareT > 0;
    this.flare.visible = lit && !!cp.at;
    if (this.flare.visible) { this.flare.position.set(cp.at.x + Math.sin(t * 0.7) * 2, 9 + (cp.flareT / CP.flare) * 4, cp.at.z - 3); this.flare.scale.setScalar(0.8 + 0.3 * Math.sin(t * 23)); }
    // The boss: crimson ring at his feet, the crest over his head (in the mission's own colour when it has one).
    this.crest.visible = false;
    const crest = cp.mission?.boss?.crest;
    if (this.crest.material.color.getHex() !== (crest ?? 0xffc23a)) this.crest.material.color.setHex(crest ?? 0xffc23a);
    if (cp.boss) {
      for (const p of view.players) {
        if (p.cpRole !== BOSS_ROLE || !p.alive) continue;
        const beat = 0.5 + 0.5 * Math.sin(t * 3);
        ring(p.x, p.z, 1.35 + 0.12 * beat, RED, 0.12 + 0.08 * beat);
        beam(p.x, p.z, RED);     // The objective beam, on him: the boss step has no other.
        this.crest.visible = true;
        this.crest.position.set(p.x, 3.3 + 0.08 * Math.sin(t * 2), p.z);
        this.crest.scale.setScalar(1.45);
        this.crest.rotation.y = t * 1.2;
        break;
      }
    }
    // Torches: the stealth watchmen (cpSee >= 0 while their torch is on).
    if (cp.stealth) {
      for (const p of view.players) {
        if (nc >= CONE_MAX) break;
        if (!p.alive || !(p.cpSee >= 0)) continue;
        const heat = Math.min(1, p.cpSee);
        C.setRGB(1, 0.85 - heat * 0.6, 0.45 - heat * 0.4);
        this.#put(this.cones, nc++, p.x, 0.04, p.z, 1, 1, 1, C.getHex(), -p.aim);
      }
    }
    for (const [m, n] of [[this.beams, nb], [this.rings, nr], [this.discs, nd], [this.boxes, ns], [this.lamps, ns], [this.lines, nl], [this.cones, nc]]) {
      m.count = n;
      if (n) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
    // The beams breathe.
    this.beams.material.opacity = 0.32 + 0.12 * Math.sin(t * 2.4);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
