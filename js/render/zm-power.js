// Graveyard Shift's power switch (docs/ZOMBIES.md, a layout with `power`: Ashgrove Halt). ZmFx makes one when the layout
// has a switch and calls update() every frame:
//   the switch   a breaker panel on the wall with a big lever (up and a red lamp while off, thrown down and green once on)
//                and a slow pulse of light over it while the power is off, so the crew can find it
//   machines     the perk machines dark (their colour dimmed, the crowns out) until the power is on, then lit
// Four small meshes (the panel, its lamp, the lever, the beacon): four draw calls; nothing when the layout has no switch.
import * as THREE from 'three';

export class ZmPowerFx {
  constructor(group, L, fx) {
    this.L = L; this.fx = fx;
    const P = L.power, yaw = P.face, nx = Math.cos(yaw), nz = Math.sin(yaw);
    this.root = new THREE.Group();
    this.root.position.set(P.wx + nx * 0.08, 0, P.wz + nz * 0.08);
    this.root.rotation.y = -yaw;          // Local +x points out of the wall.
    group.add(this.root);
    // The panel: cabinet, face and brass plate in one vertex-coloured mesh.
    this.root.add(merged([[0.14, 1.3, 0.9, 0x3a3e44, 0.07, 1.35, 0], [0.04, 1.1, 0.7, 0x23262a, 0.16, 1.35, 0], [0.05, 0.12, 0.6, 0xb08a2a, 0.17, 1.95, 0]]));
    this.lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xff3a2a }));
    this.lamp.position.set(0.2, 1.95, 0.36);
    this.root.add(this.lamp);
    // The lever (arm and knob) pivots on the cabinet face.
    this.lever = merged([[0.06, 0.6, 0.06, 0x9aa0a8, 0.08, 0.3, 0], [0.14, 0.14, 0.14, 0xd23a2a, 0.08, 0.62, 0]]);
    this.lever.position.set(0.2, 1.3, -0.1);
    this.root.add(this.lever);
    // The beacon over it while the power is off: an additive column of light.
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 5, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x9fe8c0, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.beacon.position.set(0.8, 2.6, 0);
    this.root.add(this.beacon);
    this.on = null; this.t = 0; this.throwT = 1;
  }

  update(obj, dt) {
    this.t += dt;
    const on = !!obj.power;
    if (on !== this.on) {
      if (this.on === false && on) this.throwT = 0;       // Thrown just now: animate it.
      this.on = on;
      const fx = this.fx;
      if (fx.machines?.material) fx.machines.material.color.setScalar(on ? 1 : 0.32);
      if (fx.crowns) fx.crowns.visible = on;
      this.lamp.material.color.setHex(on ? 0x4fe36a : 0xff3a2a);
      this.beacon.visible = !on;
    }
    if (this.throwT < 1) this.throwT = Math.min(1, this.throwT + dt * 3);
    this.lever.rotation.z = on ? -2.4 * (1 - (1 - this.throwT) ** 2) : 0;
    if (!on) this.beacon.material.opacity = 0.12 + 0.1 * Math.abs(Math.sin(this.t * 1.8));
  }
}

// Boxes [w, h, d, colour, x, y, z] as one mesh with vertex colours, each face shaded a little so it reads unlit.
function merged(list) {
  const pos = [], col = [], c = new THREE.Color();
  for (const [w, h, d, rgb, x, y, z] of list) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    const p = g.attributes.position, n = g.attributes.normal;
    c.setHex(rgb);
    for (let i = 0; i < p.count; i++) {
      const k = 0.7 + 0.3 * Math.max(n.getY(i), n.getX(i), 0);
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      col.push(c.r * k, c.g * k, c.b * k);
    }
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
}
