// Graveyard Shift world visuals (docs/ZOMBIES.md), kept out of the renderer proper like extraction's: the renderer
// makes one of these the first time a view carries the zombies block and calls update() once a frame.
//   fences     the board-and-post fences on every cut line (one merged mesh, built once)
//   gates      a boarded gate per door with its price lamp; an opened gate drops away
//   wall-buys  a chalk frame and the gun in gold on the wall, a soft glow round it, and the same silhouette seen through
//              walls and roofs (an x-ray pass: drawn only where something stands in front of it), so a buy is easy to find
//   machines   the four perk machines, each in its colour with a lit crown (one merged mesh, crowns pulse)
//   crate      the mystery crate: a plank crate with iron corners and a hinged lid, a light beam, its outline through
//              walls; rolling, the lid opens and guns cycle up out of it (slowing as it settles), the gun on offer floats
//              and turns, the lid shuts once it is taken; moving, it lifts away up the beam and drops in at its new spot
//   drops      power-ups spinning on the ground (instanced)
//   economy    the upgrade bench, the supply terminal, the armour bench, traps, the exfil pad, the quest and the
//              terminal's gear: js/render/zm-econ-fx.js (about sixteen more)
//   specials   acid globs, landing marks and puddles, Shieldbearers' shields, bursts, the fog round: zm-kinds-fx.js
//              (five more, instanced; the fog only on a fog round)
// About eleven draw calls whatever the round, a few hundred triangles each (docs/BR-PERF.md: no per-zombie cost).
import * as THREE from 'three';
import { getGun } from './guns.js';
import { ZM, ZM_PERKS, ZM_POWERUPS, BOX_GUNS } from '../shared/zombies.js';
import { ZmPowerFx } from './zm-power.js';     // A layout with a power switch (Ashgrove Halt): the switch, dark machines.
import { ZmEconFx } from './zm-econ-fx.js';     // ROADMAP item 36: bench, terminal, armour, traps, exfil, quest, gear.
import { ZmKindsFx } from './zm-kinds-fx.js';   // Specials: acid globs and puddles, shields, bursts, the fog round.

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
const DROP_MAX = 8;
const DROP_RGB = { ammo: 0x59d36b, double: 0xffc24a, nuke: 0xff5a3a };
const WALL_GUN = 0xffd77a, WALL_GLOW = 0xffa83a, CRATE_GLOW = 0x7fd0ff;
// Drawn only where something nearer hides it: walls, roofs, a crowd. Additive, so it reads as light coming through.
const xrayMaterial = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthFunc: THREE.GreaterDepth,
  blending: THREE.AdditiveBlending, fog: false });

// A growing list of coloured boxes merged into one geometry: positions and vertex colours, shaded by face so the boxes
// read without lights.
class Boxes {
  constructor() { this.pos = []; this.col = []; }
  box(cx, cy, cz, w, h, d, rgb, yaw = 0) {
    const hw = w / 2, hh = h / 2, hd = d / 2, c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x, y, z) => [cx + x * c - z * s, cy + y, cz + x * s + z * c];
    const faces = [
      [[-hw, hh, -hd], [hw, hh, -hd], [hw, hh, hd], [-hw, hh, hd], 1.0],          // top
      [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd], 0.78],         // +z
      [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd], 0.62],     // -z
      [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd], 0.86],         // +x
      [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd], 0.7],      // -x
    ];
    const r = (rgb >> 16 & 255) / 255, g = (rgb >> 8 & 255) / 255, b = (rgb & 255) / 255;
    for (const [a, b2, c2, d2, k] of faces) {
      for (const v of [a, b2, c2, a, c2, d2]) { this.pos.push(...P(...v)); this.col.push(r * k, g * k, b * k); }
    }
  }
  // Another geometry (a gun model), transformed, in one colour.
  geom(g, m, rgb) {
    const src = g.index ? g.toNonIndexed() : g, p = src.attributes.position;
    const r = (rgb >> 16 & 255) / 255, gg = (rgb >> 8 & 255) / 255, b = (rgb & 255) / 255;
    for (let i = 0; i < p.count; i++) {
      V.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
      this.pos.push(V.x, V.y, V.z); this.col.push(r, gg, b);
    }
  }
  mesh(opts = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, ...opts }));
    m.renderOrder = 1;
    return m;
  }
}

export class ZmFx {
  constructor(scene, map, layout) {
    this.scene = scene;
    this.map = map;
    this.L = layout;
    this.group = new THREE.Group();
    scene.add(this.group);
    const L = layout;
    // Fences: posts every 2 m and three rails of weathered boards.
    const f = new Boxes();
    for (const w of L.fences) {
      const along = w.d > w.w, len = along ? w.d : w.w, n = Math.max(1, Math.round(len / 2));
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = along ? w.x + w.w / 2 : w.x + t * w.w, z = along ? w.z + t * w.d : w.z + w.d / 2;
        f.box(x, 1.25, z, 0.22, 2.5, 0.22, 0x3a2e22);
      }
      for (const [y, rgb] of [[0.5, 0x6b5640], [1.25, 0x5e4a36], [2.0, 0x6f5a42]]) f.box(w.x + w.w / 2, y, w.z + w.d / 2, along ? 0.12 : len, 0.55, along ? len : 0.12, rgb);
    }
    this.fences = f.mesh();
    this.group.add(this.fences);
    // Gates: each its own mesh, so an opened one can fall away.
    this.gates = L.doors.map(d => {
      const b = new Boxes(), along = d.d > d.w, len = along ? d.d : d.w;
      for (const y of [0.45, 1.05, 1.65, 2.25]) b.box(0, y, 0, along ? 0.16 : len + 0.2, 0.42, along ? len + 0.2 : 0.16, 0x7a5e3e);
      // Two cross braces and a lamp for the price.
      for (const s of [-1, 1]) b.box(0, 1.3, 0, along ? 0.1 : 0.2, 2.4, along ? 0.2 : 0.1, 0x4a3826, s * 0.6);
      b.box(0, 2.75, 0, 0.3, 0.3, 0.3, 0xffd36a);
      const m = b.mesh();
      m.position.set(d.x + d.w / 2, 0, d.z + d.d / 2);
      this.group.add(m);
      return { m, open: false, t: 0 };
    });
    // Wall-buys: a chalk frame on the wall face and the gun in it, in gold; a glow and an x-ray copy of the gun.
    const w = new Boxes(), glow = new Boxes();
    for (const wb of L.wallBuys) {
      const yaw = wb.face, nx = Math.cos(yaw), nz = Math.sin(yaw);
      const fx = wb.wx + nx * 0.04, fz = wb.wz + nz * 0.04, side = yaw + Math.PI / 2;
      for (const [ox, oy, ww, hh] of [[0, 1.85, 1.5, 0.06], [0, 0.95, 1.5, 0.06], [-0.75, 1.4, 0.06, 0.96], [0.75, 1.4, 0.06, 0.96]]) {
        w.box(fx + Math.cos(side) * ox, oy, fz + Math.sin(side) * ox, 0.04, hh, ww, 0xe8dcae, yaw);
      }
      const proto = getGun(wb.gun);
      if (proto?.geometry) {
        Q.setFromEuler(E.set(0, -side, 0));
        M4.compose(V.set(fx + nx * 0.03 - Math.cos(side) * 0.1, 1.4, fz + nz * 0.03 - Math.sin(side) * 0.1), Q, S.set(0.78, 0.78, 0.78));
        w.geom(proto.geometry, M4, WALL_GUN);
        // The glow: the same gun a little bigger and a hair off the wall.
        M4.compose(V.set(fx + nx * 0.06 - Math.cos(side) * 0.1, 1.4, fz + nz * 0.06 - Math.sin(side) * 0.1), Q, S.set(0.98, 1.25, 1.25));
        glow.geom(proto.geometry, M4, 0xffffff);
      }
    }
    this.walls = w.mesh();
    this.group.add(this.walls);
    this.wallGlow = glow.mesh({ color: WALL_GLOW, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
    this.wallGlow.renderOrder = 2;
    this.wallXray = new THREE.Mesh(this.wallGlow.geometry, xrayMaterial(WALL_GLOW, 0.55));
    this.wallXray.renderOrder = 3;
    this.group.add(this.wallGlow, this.wallXray);
    // Perk machines: a cabinet, a darker door, a lit crown.
    const mb = new Boxes(), crowns = new Boxes();
    for (const mc of L.machines) {
      const P = ZM_PERKS[mc.perk], yaw = mc.face;
      const x = mc.wx + Math.cos(yaw) * 0.35, z = mc.wz + Math.sin(yaw) * 0.35;
      C.setHex(P.color);
      const dark = C.clone().multiplyScalar(0.45).getHex();
      mb.box(x, 0.95, z, 0.6, 1.9, 0.95, P.color, yaw);
      mb.box(x + Math.cos(yaw) * 0.31, 0.9, z + Math.sin(yaw) * 0.31, 0.04, 1.2, 0.7, dark, yaw);
      crowns.box(x, 2.0, z, 0.66, 0.22, 1.0, 0xffffff, yaw);
      crowns.box(x + Math.cos(yaw) * 0.34, 1.62, z + Math.sin(yaw) * 0.34, 0.04, 0.32, 0.62, P.color, yaw);
    }
    this.machines = mb.mesh();
    this.crowns = crowns.mesh({ transparent: true, opacity: 0.9 });
    this.group.add(this.machines, this.crowns);
    // The crate: planks on a dark frame, iron corners and bands, a gold mark front and back, and a lid hinged at the
    // back (local -z, against the wall; +z faces the room). Origin at the floor, in the middle.
    const IRON = 0x3a3d42, cb = new Boxes();
    cb.box(0, 0.4, 0, 1.44, 0.76, 0.78, 0x4a2f1a);
    [0x8a5a32, 0x7a4e2b, 0x8f6036].forEach((rgb, k) => {
      const y = 0.15 + k * 0.25;
      cb.box(0, y, 0.4, 1.4, 0.21, 0.04, rgb); cb.box(0, y, -0.4, 1.4, 0.21, 0.04, rgb);
      cb.box(0.73, y, 0, 0.04, 0.21, 0.74, rgb); cb.box(-0.73, y, 0, 0.04, 0.21, 0.74, rgb);
    });
    for (const x of [-0.72, 0.72]) for (const z of [-0.4, 0.4]) cb.box(x, 0.4, z, 0.1, 0.82, 0.1, IRON);
    cb.box(0, 0.04, 0, 1.5, 0.08, 0.84, IRON);
    cb.box(0, 0.78, 0, 1.5, 0.05, 0.84, IRON);
    for (const z of [0.43, -0.43]) cb.box(0, 0.42, z, 0.3, 0.3, 0.03, 0xffd36a);
    this.crate = cb.mesh();
    this.crateRoot = new THREE.Group();
    this.crateRoot.add(this.crate);
    const lb = new Boxes();
    lb.box(0, 0.06, 0.42, 1.5, 0.12, 0.84, 0x7a4e2b);
    for (const z of [0.15, 0.42, 0.69]) lb.box(0, 0.125, z, 1.42, 0.012, 0.2, 0x93643a);
    lb.box(0, 0.07, 0.02, 1.54, 0.15, 0.05, IRON); lb.box(0, 0.07, 0.82, 1.54, 0.15, 0.05, IRON);
    lb.box(0, 0.16, 0.84, 0.28, 0.08, 0.06, 0xc9a24a);
    this.lid = lb.mesh();
    this.lid.position.set(0, 0.8, -0.42);
    this.crate.add(this.lid);
    // The beam rises out of the crate (narrow at its mouth, so the crate itself is not washed out under it).
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.32, 13, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.beam.position.y = 0.95 + 6.5;
    this.crateRoot.add(this.beam);
    // Its outline through walls, like the wall-buys.
    this.crateXray = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.84, 0.86).translate(0, 0.42, 0), xrayMaterial(CRATE_GLOW, 0.5));
    this.crateXray.renderOrder = 3;
    this.crate.add(this.crateXray);
    this.group.add(this.crateRoot);
    this.offer = null; this.offerGun = null;
    this.crateAnim = null;          // {kind: 'leave' | 'arrive', t}
    this.crateWas = null;           // The state and spot last frame.
    // Power-ups.
    this.drops = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), DROP_MAX);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.group.add(this.drops);
    this.t = 0;
    this.power = L.power ? new ZmPowerFx(this.group, L, this) : null;
    this.econ = new ZmEconFx(this.group, L);
    this.kinds = new ZmKindsFx(this.group);
  }

  onEvent(ev) { this.kinds.onEvent(ev); }

  update(view, dt) {
    const obj = view.obj ?? view.points?.obj;
    if (!obj?.zm) return;
    this.t += dt;
    this.power?.update(obj, dt);
    this.econ.update(obj, dt);
    this.kinds.update(view, obj, dt);
    const L = this.L;
    // Gates.
    L.doors.forEach((d, i) => {
      const g = this.gates[i], open = !!(obj.open & (1 << d.i));
      if (open && !g.open) { g.open = true; g.t = 0; }
      if (!open && g.open) { g.open = false; g.m.visible = true; g.m.position.y = 0; g.m.rotation.set(0, 0, 0); }
      if (g.open && g.m.visible) {
        g.t += dt;
        g.m.position.y = -g.t * g.t * 3;
        g.m.rotation.z = g.t * 0.8;
        if (g.t > 1) g.m.visible = false;
      }
    });
    // Crowns pulse.
    this.crowns.material.opacity = 0.65 + 0.3 * Math.abs(Math.sin(this.t * 2.2));
    // The crate.
    this.wallGlow.material.opacity = 0.3 + 0.14 * Math.sin(this.t * 2.6);
    this.wallXray.material.opacity = 0.42 + 0.12 * Math.sin(this.t * 2.6);
    const b = obj.box, spot = b && b.spot >= 0 ? L.boxSpots[b.spot] : null;
    const was = this.crateWas;
    if (b && was) {
      if (b.state === 3 && was.state !== 3) this.crateAnim = { kind: 'leave', t: 0 };
      else if (b.state !== 3 && (was.state === 3 || was.spot !== b.spot)) this.crateAnim = { kind: 'arrive', t: 0 };
    }
    this.crateWas = b ? { state: b.state, spot: b.spot } : null;
    const A = this.crateAnim;
    if (A) { A.t += dt; if (A.t > (A.kind === 'leave' ? 1.4 : 0.8)) this.crateAnim = null; }
    // Hidden while away, once it has lifted off.
    this.crateRoot.visible = !!spot && (b.state !== 3 || A?.kind === 'leave');
    if (spot && this.crateRoot.visible) {
      const yaw = spot.face;
      this.crateRoot.position.set(spot.wx + Math.cos(yaw) * 0.55, 0, spot.wz + Math.sin(yaw) * 0.55);
      this.crateRoot.rotation.y = -yaw + Math.PI / 2;
      // Moving: up the beam, turning, and gone; arriving: down from above with a bounce.
      let lift = 0, spin = 0, k = 1;
      if (A?.kind === 'leave') { const u = Math.min(1, A.t / 1.4); lift = u * u * 7; spin = u * u * 9; k = 1 - Math.max(0, u - 0.7) / 0.3 * 0.9; }
      else if (A?.kind === 'arrive') { const u = Math.min(1, A.t / 0.8); lift = u < 0.7 ? (1 - u / 0.7) ** 2 * 6 : Math.sin((u - 0.7) / 0.3 * Math.PI) * 0.25; spin = (1 - u) * 3; }
      this.crate.position.y = lift;
      this.crate.rotation.y = spin;
      this.crate.scale.setScalar(k);
      const opening = (b.state === 1 || b.state === 2) && !A;
      this.lid.rotation.x += ((opening ? -1.95 : 0) - this.lid.rotation.x) * Math.min(1, dt * (opening ? 7 : 5));
      this.beam.material.opacity = A ? 0.45 : b.state === 0 ? 0.16 + 0.05 * Math.sin(this.t * 3) : 0.3;
      // The gun over the open crate: cycling while it rolls (slowing as it settles), the offer once it lands.
      let gun = null;
      if (b.state === 1) {
        const left = Math.max(0, b.timer ?? 0), roll = ZM.box.roll;
        this.cycle = (this.cycle ?? 0) + dt * (2.5 + 11 * Math.min(1, left / roll));
        gun = BOX_GUNS[Math.floor(this.cycle) % BOX_GUNS.length];
      } else if (b.state === 2) gun = b.gun;
      if (gun !== this.offerGun) {
        if (this.offer) { this.crate.remove(this.offer); this.offer = null; }
        this.offerGun = gun;
        const proto = gun ? getGun(gun) : null;
        if (proto?.geometry) {
          this.offer = new THREE.Mesh(proto.geometry, new THREE.MeshBasicMaterial({ color: b.state === 2 ? 0xfff0b0 : 0x9fd8ff }));
          this.offer.scale.setScalar(1.25);
          this.crate.add(this.offer);
        }
      }
      if (this.offer) {
        const rise = b.state === 1 ? 0.95 + Math.min(1, (ZM.box.roll - (b.timer ?? 0)) / ZM.box.roll) * 0.65 : 1.65;
        this.offer.position.set(0, rise + Math.sin(this.t * (b.state === 2 ? 2.2 : 6)) * 0.07, 0);
        this.offer.rotation.y = b.state === 2 ? this.t * 1.1 : Math.sin(this.t * 5) * 0.25;
      }
    }
    // Power-ups.
    const drops = obj.drops ?? [];
    let n = 0;
    for (const d of drops) {
      if (n >= DROP_MAX) break;
      Q.setFromEuler(E.set(0, this.t * 2 + d.id, 0));
      M4.compose(V.set(d.x, 0.75 + Math.sin(this.t * 3 + d.id) * 0.12, d.z), Q, S.set(1, 1.3, 1));
      this.drops.setMatrixAt(n, M4);
      this.drops.setColorAt(n, C.setHex(DROP_RGB[d.kind] ?? 0xffffff));
      n++;
    }
    this.drops.count = n;
    this.drops.instanceMatrix.needsUpdate = true;
    if (this.drops.instanceColor) this.drops.instanceColor.needsUpdate = true;
    // The renderer's scene does not update world matrices by itself (renderer.js): without this the crate stayed where
    // it was first built (the map's corner) and an opened gate never moved.
    this.group.updateMatrixWorld(true);
  }

  dispose() {
    this.econ.dispose();
    this.group.remove(this.econ.root);
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.isMesh && o !== this.offer) { if (o !== this.wallXray) o.geometry?.dispose(); o.material?.dispose(); } });
  }
}

export { ZM, ZM_POWERUPS };
