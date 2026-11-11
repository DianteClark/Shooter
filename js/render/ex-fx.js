// Extraction world visuals (docs/EXTRACT.md), kept out of the renderer proper like the battle royale's: the renderer
// makes one of these the first time a view carries the extraction block and calls update() once a frame.
//   exfil      each landing zone as a ring on the ground (closed: nothing; open: white with a smoke-flare beam; called:
//              pulsing amber; down: green, red while contested) and the helicopter flying in, sitting down, lifting off
//   contracts  the intel case, the supply cache (and the charge on it), the terminal, the escort asset, and a sodium
//              beam over the local squad's objective (and the intel drop point)
//   phones     a contract phone post at each place; ammo boxes and dropped ammo near the camera
//   downed     a pulsing red ring under downed players
// A handful of meshes and instanced lists: a few draw calls whatever the match holds.
import * as THREE from 'three';
import { EX, EX_AI_TEAM } from '../shared/modes.js';

const RING_MAX = 8, BOX_MAX = 60, DROP_MAX = 40, PHONE_MAX = 24, DOWN_MAX = 16, NEAR = 45;
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ZONE = { 1: 0xf2f0e6, 2: 0xffc24a, 3: 0x59d36b };

function flareTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, 'rgba(255,90,40,0.8)');
  grad.addColorStop(0.5, 'rgba(255,120,60,0.3)');
  grad.addColorStop(1, 'rgba(255,140,80,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A low-poly transport helicopter, nose along +x, rotor as its own child so it can spin.
function helicopter() {
  const g = new THREE.Group(), hull = new THREE.MeshBasicMaterial({ color: 0x4a5560 }), dark = new THREE.MeshBasicMaterial({ color: 0x1c2228 }), glass = new THREE.MeshBasicMaterial({ color: 0x8fc4d8 });
  const box = (w, h, d, x, y, z, m, parent = g) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); parent.add(b); return b; };
  box(6, 2, 2.4, 0, 1.4, 0, hull);              // Cabin.
  box(1.6, 1.4, 2, 3.6, 1.2, 0, glass);         // Cockpit glass.
  box(6.5, 0.6, 0.6, -5.5, 1.9, 0, hull);       // Tail boom.
  box(1.4, 1.8, 0.25, -8.4, 2.6, 0, hull);      // Fin.
  box(0.2, 1.6, 0.2, -8.6, 2.4, 0.4, dark);     // Tail rotor.
  for (const z of [-1.3, 1.3]) { box(5, 0.15, 0.15, 0.4, 0.15, z, dark); box(0.15, 0.6, 0.15, 1.6, 0.45, z, dark); box(0.15, 0.6, 0.15, -1, 0.45, z, dark); }
  box(1.2, 0.5, 1.2, 0, 2.65, 0, dark);         // Rotor hub.
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.95, 0);
  box(13, 0.08, 0.5, 0, 0, 0, dark, rotor);
  box(0.5, 0.08, 13, 0, 0, 0, dark, rotor);
  g.add(rotor);
  g.userData.rotor = rotor;
  noFog(g);
  return g;
}

// The scene's distance haze would wash these out at gameplay zoom; they read as markers, so they skip it.
function noFog(root) { root.traverse(o => { if (o.material) o.material.fog = false; }); return root; }

function crate(w, h, d, color, band = 0x1c2228) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
  b.position.y = h / 2; g.add(b);
  const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.04), new THREE.MeshBasicMaterial({ color: band }));
  s.position.y = h * 0.7; g.add(s);
  return g;
}

export class ExFx {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.group = new THREE.Group();
    this.group.name = 'ex-fx';
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
    // Landing zones: a wide ring and a soft disc, a flare column on open ones.
    this.zones = inst(new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }), RING_MAX);
    this.discs = inst(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }), RING_MAX);
    this.flares = inst(new THREE.CylinderGeometry(0.5, 1.4, 14, 10, 1, true).translate(0, 7, 0),
      new THREE.MeshBasicMaterial({ map: flareTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }), RING_MAX, 5);
    // Objective beams: the local squad's target, and its drop point.
    this.beams = inst(new THREE.CylinderGeometry(0.18, 0.45, 18, 8, 1, true).translate(0, 9, 0),
      new THREE.MeshBasicMaterial({ color: 0xffc24a, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }), 4, 5);
    this.boxes = inst(new THREE.BoxGeometry(0.7, 0.42, 0.45).translate(0, 0.21, 0), new THREE.MeshBasicMaterial({ color: 0x55603e }), BOX_MAX);
    this.drops = inst(new THREE.BoxGeometry(0.34, 0.22, 0.26).translate(0, 0.11, 0), new THREE.MeshBasicMaterial({ color: 0x9aa58a }), DROP_MAX);
    this.dropGlow = inst(new THREE.CircleGeometry(0.55, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9aa58a, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }), BOX_MAX + DROP_MAX);
    // Contract phones: a post and a yellow box with a lit face.
    this.posts = inst(new THREE.BoxGeometry(0.16, 1.3, 0.16).translate(0, 0.65, 0), new THREE.MeshBasicMaterial({ color: 0x2a2f35 }), PHONE_MAX);
    this.phoneBox = inst(new THREE.BoxGeometry(0.55, 0.7, 0.4).translate(0, 1.45, 0), new THREE.MeshBasicMaterial({ color: 0xe0a92a }), PHONE_MAX);
    this.downs = inst(new THREE.RingGeometry(0.7, 0.95, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.8, depthWrite: false }), DOWN_MAX);
    // One helicopter per zone that can be busy at once (every site, at most).
    this.helis = [];
    this.flareMat = this.flares.material;
    // Contract things, keyed by contract id.
    this.things = new Map();
    this.leaving = new Map();      // Site -> seconds since the helicopter lifted off.
    noFog(this.group);
  }

  // Events that start an animation of their own.
  onEvent(e) {
    if (e.t === 'exleave' || e.t === 'exfil') this.leaving.set(e.site, 0);
    if (e.t === 'exland' || e.t === 'excall') this.leaving.delete(e.site);
  }

  #heli(i) {
    let h = this.helis[i];
    if (!h) { h = this.helis[i] = helicopter(); h.visible = false; this.group.add(h); }
    return h;
  }

  #thing(c) {
    let t = this.things.get(c.id);
    if (t) return t;
    const g = new THREE.Group();
    if (c.type === 'intel') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.16), new THREE.MeshBasicMaterial({ color: 0x2a2620 }));
      b.position.y = 0.32; g.add(b);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.06), new THREE.MeshBasicMaterial({ color: 0xffc24a }));
      h.position.y = 0.57; g.add(h);
    } else if (c.type === 'cache') {
      g.add(crate(1.5, 0.95, 1, 0x4f5a3a));
      const charge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.3), new THREE.MeshBasicMaterial({ color: 0xff4a2a }));
      charge.position.y = 1.07; charge.visible = false; g.add(charge);
      g.userData.charge = charge;
    } else if (c.type === 'hack') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.5), new THREE.MeshBasicMaterial({ color: 0x2c333b }));
      base.position.y = 0.5; g.add(base);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.08), new THREE.MeshBasicMaterial({ color: 0x3affd8 }));
      screen.position.set(0, 1.18, 0.12); screen.rotation.x = -0.4; g.add(screen);
      g.userData.screen = screen;
    } else if (c.type === 'escort') {
      // A tracked cargo mule: body, two tracks, a lit sensor head.
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.9), new THREE.MeshBasicMaterial({ color: 0x8a7a52 }));
      body.position.y = 0.6; g.add(body);
      for (const z of [-0.52, 0.52]) { const tr = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 0.22), new THREE.MeshBasicMaterial({ color: 0x1c2228 })); tr.position.set(0, 0.2, z); g.add(tr); }
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.35), new THREE.MeshBasicMaterial({ color: 0xffc24a }));
      head.position.set(0.5, 1, 0); g.add(head);
      const cargo = crate(0.7, 0.4, 0.7, 0x55603e); cargo.position.set(-0.25, 0.88, 0); g.add(cargo);
    }
    noFog(g);
    this.group.add(g);
    t = { g, type: c.type, x: c.x, z: c.z, yaw: 0 };
    this.things.set(c.id, t);
    return t;
  }

  update(view, dt, camX, camZ, localTeam) {
    const ex = view.obj ?? view.points?.obj;
    if (!ex?.ex) { this.group.visible = false; return; }
    this.group.visible = true;
    this.clock += dt;
    const t = this.clock;
    // ---- Exfil zones and helicopters ----
    let zn = 0;
    for (const e of ex.exfils ?? []) {
      const h = this.#heli(e.i);
      const leave = this.leaving.get(e.i);
      if (leave !== undefined) this.leaving.set(e.i, leave + dt);
      if (e.state === 0 && leave === undefined) { h.visible = false; continue; }
      if (e.state >= 1 && e.state <= 3) {
        const col = e.state === 3 && e.contested ? 0xff4a3a : ZONE[e.state] ?? 0xf2f0e6;
        const pulse = e.state === 2 ? 0.75 + 0.25 * Math.sin(t * 6) : 1;
        M4.compose(V.set(e.x, 0.08, e.z), Q.identity(), S.set(e.r, 1, e.r));
        this.zones.setMatrixAt(zn, M4); this.zones.setColorAt(zn, C.setHex(col).multiplyScalar(pulse));
        this.discs.setMatrixAt(zn, M4); this.discs.setColorAt(zn, C.setHex(col));
        M4.compose(V.set(e.x, 0, e.z), Q.identity(), S.set(1, e.state === 1 ? 1 : 0.0001, 1));
        this.flares.setMatrixAt(zn, M4); this.flares.setColorAt(zn, C.setHex(0xffffff));
        zn++;
      }
      // The helicopter: in from the far side of the map over `inbound` s, down on the zone, then up and away.
      const a = Math.atan2(e.z - this.map.height / 2, e.x - this.map.width / 2);
      const fx = e.x + Math.cos(a) * 110, fz = e.z + Math.sin(a) * 110;
      // It sets down at the outer edge of the zone, so the squad boarding it stays in sight.
      const lx = e.x + Math.cos(a) * e.r * 0.55, lz = e.z + Math.sin(a) * e.r * 0.55;
      let x = lx, z = lz, y = 0.3, yaw = a + Math.PI, show = true;
      if (e.state === 2) {
        const k = Math.max(0, Math.min(1, 1 - e.timer / (e.final ? Math.max(1, EX.final.land - EX.final.open) : EX.inbound)));
        if (k < 0.02 && e.final) show = false;
        const s = 1 - (1 - k) * (1 - k);
        x = fx + (lx - fx) * s; z = fz + (lz - fz) * s; y = 18 - 15 * s;
      } else if (e.state === 3) {
        y = 0.3 + Math.sin(t * 2) * 0.05;
      } else if (leave !== undefined && leave < 8) {
        const k = leave / 8;
        x = lx + Math.cos(a) * 120 * k * k; z = lz + Math.sin(a) * 120 * k * k; y = 0.3 + 20 * k; yaw = a;
      } else show = false;
      h.visible = show;
      if (show) {
        h.position.set(x, y, z);
        h.rotation.y = -yaw;
        h.userData.rotor.rotation.y += dt * 24;
      }
    }
    this.zones.count = this.discs.count = this.flares.count = zn;
    for (const m of [this.zones, this.discs, this.flares]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.flareMat.opacity = 0.75 + 0.25 * Math.sin(t * 9);

    // ---- Contract things ----
    const live = new Set();
    let bn = 0;
    const me = view.players.find(p => p.id === view.localId);
    const myTeam = me?.team ?? localTeam;
    for (const s of ex.squads ?? []) {
      const c = s.contract;
      if (!c || c.type === 'hvt') {
        if (c && s.team === myTeam && bn < 4) { M4.compose(V.set(c.x, 0, c.z), Q.identity(), S.set(1, 1, 1)); this.beams.setMatrixAt(bn++, M4); }
        continue;
      }
      live.add(c.id);
      const th = this.#thing(c);
      const carried = c.type === 'intel' && c.carrier >= 0;
      th.g.visible = !carried;
      if (c.type === 'escort') {
        const dx = c.x - th.x, dz = c.z - th.z;
        if (Math.hypot(dx, dz) > 0.02) th.yaw = Math.atan2(dz, dx);
        th.x += dx * Math.min(1, dt * 8); th.z += dz * Math.min(1, dt * 8);
        th.g.position.set(th.x, 0, th.z);
        th.g.rotation.y = -th.yaw;
      } else th.g.position.set(c.x, 0, c.z);
      if (c.type === 'cache') { const ch = th.g.userData.charge; ch.visible = c.state === 1; if (ch.visible) ch.material.color.setHex(Math.sin(t * (8 + c.prog * 20)) > 0 ? 0xff4a2a : 0x55180e); }
      if (c.type === 'hack') th.g.userData.screen.material.color.setHex(c.contested ? 0xff6a3a : c.prog > 0 && Math.sin(t * 10) > 0 ? 0x7affe8 : 0x3affd8);
      if (s.team === myTeam && bn < 4) {
        const bx = carried ? c.dx : c.x, bz = carried ? c.dz : c.z;
        M4.compose(V.set(bx, 0, bz), Q.identity(), S.set(1, 1, 1)); this.beams.setMatrixAt(bn++, M4);
        if (c.type === 'intel' && !carried && bn < 4) { M4.compose(V.set(c.dx, 0, c.dz), Q.identity(), S.set(0.7, 0.6, 0.7)); this.beams.setMatrixAt(bn++, M4); }
      }
    }
    this.beams.count = bn; this.beams.instanceMatrix.needsUpdate = true;
    for (const [id, th] of this.things) if (!live.has(id)) { this.group.remove(th.g); this.things.delete(id); }

    // ---- Phones, ammo, downed rings (near the camera) ----
    let pn = 0;
    for (const ph of ex.phones ?? []) {
      if (pn >= PHONE_MAX || Math.abs(ph.x - camX) > NEAR + 20 || Math.abs(ph.z - camZ) > NEAR + 20) continue;
      M4.compose(V.set(ph.x, 0, ph.z), Q.identity(), S.set(1, 1, 1));
      this.posts.setMatrixAt(pn, M4); this.phoneBox.setMatrixAt(pn, M4);
      this.phoneBox.setColorAt(pn, C.setHex(Math.sin(t * 3 + ph.i) > 0.6 ? 0xffd659 : 0xe0a92a));
      pn++;
    }
    this.posts.count = this.phoneBox.count = pn;
    this.posts.instanceMatrix.needsUpdate = true; this.phoneBox.instanceMatrix.needsUpdate = true; this.phoneBox.instanceColor.needsUpdate = true;
    let an = 0, gn = 0, dn = 0;
    for (const b of ex.boxes ?? []) {
      if (!b.up || an >= BOX_MAX || Math.abs(b.x - camX) > NEAR || Math.abs(b.z - camZ) > NEAR) continue;
      M4.compose(V.set(b.x, 0, b.z), Q.setFromAxisAngle(UP, b.i * 1.3), S.set(1, 1, 1));
      this.boxes.setMatrixAt(an++, M4);
      M4.compose(V.set(b.x, 0.05, b.z), Q.identity(), S.set(1.3, 1, 1.3));
      this.dropGlow.setMatrixAt(gn++, M4);
    }
    for (const d of ex.drops ?? []) {
      if (dn >= DROP_MAX || Math.abs(d.x - camX) > NEAR || Math.abs(d.z - camZ) > NEAR) continue;
      M4.compose(V.set(d.x, 0, d.z), Q.setFromAxisAngle(UP, d.id * 0.7), S.set(1, 1, 1));
      this.drops.setMatrixAt(dn++, M4);
      M4.compose(V.set(d.x, 0.05, d.z), Q.identity(), S.set(1, 1, 1));
      if (gn < BOX_MAX + DROP_MAX) this.dropGlow.setMatrixAt(gn++, M4);
    }
    this.boxes.count = an; this.drops.count = dn; this.dropGlow.count = gn;
    this.boxes.instanceMatrix.needsUpdate = true; this.drops.instanceMatrix.needsUpdate = true; this.dropGlow.instanceMatrix.needsUpdate = true;
    let rn = 0;
    const pulse = 1 + Math.sin(t * 6) * 0.12;
    for (const p of view.players) {
      if (!p.alive || !p.downed || p.team === EX_AI_TEAM || rn >= DOWN_MAX) continue;
      M4.compose(V.set(p.x, 0.07, p.z), Q.identity(), S.set(pulse, 1, pulse));
      this.downs.setMatrixAt(rn++, M4);
    }
    this.downs.count = rn; this.downs.instanceMatrix.needsUpdate = true;
    // The renderer's scene does not update world matrices by itself (renderer.js): the moving pieces need it here.
    this.group.updateMatrixWorld(true);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
