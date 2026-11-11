// The operator generator: operators after the first nine are not modelled one by one but assembled from a kit of parts,
// one pick per slot (js/ui/operators.js `kit`). Torso slots: core (pelvis, chest, plates, pauldrons), back (pack,
// radio, drone case...), extra (bandolier, collar, wings...). Head slots: gear (helmet, cap, hood...), hair, face (the
// skull with its features). Body proportions are not geometry: the character shader narrows the shoulders or the hips of
// every torso vertex from per-operator numbers, and skin and hair colours come from the same table, so one hair mesh
// serves every hair colour and one face every skin tone.
//
// Every piece of every slot is merged into the shared torso and head meshes (see characters.js variantGeometry); a
// vertex carries its slot and pick, an instance its operator, and the shader shows a vertex only when that operator's
// pick in that slot is the vertex's. So the whole roster costs the same draw calls as one soldier, and the vertex cost
// grows with the number of parts, not with the number of operators.
//
// Frames: forward is +X, up +Y, the operator's left is +Z. Torso origin at the hips (chest top ~0.61, pauldrons ~0.6);
// head origin at the top of the chest (skull 0.1..0.36, face front at x ~0.17).
import * as THREE from 'three';

// Vertex tags. ACC pieces take the skin's accent and glow; KEEP pieces are never recoloured by a skin; ELITE / MASTERY
// pieces exist only with that gear slot, NO_ELITE / NO_MASTERY ones are dropped with it; TONE and LOCKS pieces take the
// operator's skin tone and hair colour (they are KEEP too).
export const ACC = 1, KEEP = 2, ELITE = 4, MASTERY = 8, NO_ELITE = 16, NO_MASTERY = 32, TONE = 64 | KEEP, LOCKS = 128 | KEEP;
export function tag(b, t, draw) {
  const from = b.pos.length / 3;
  draw();
  (b.tags ??= []).push([from, b.pos.length / 3, t]);
}

const TAU = Math.PI * 2;
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _up = new THREE.Vector3();

// A prism from point a to point b (radius r0 at a, r1 at b), for straps, braids, wings and anything not axis aligned.
function seg(b, a, c, r0, r1 = r0, sides = 6) {
  _x.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const len = _x.length();
  _x.divideScalar(len);
  _up.set(0, 1, 0);
  if (Math.abs(_x.y) > 0.9) _up.set(1, 0, 0);
  _z.crossVectors(_x, _up).normalize();
  _y.crossVectors(_z, _x);
  _m.makeBasis(_x, _y, _z).setPosition(a[0], a[1], a[2]);
  const keep = b.matrix;
  b.matrix = _m;
  b.prismX(0, len, 0, 0, r0, r1, sides);
  b.matrix = keep;
  return b;
}
// A flat plate from a to c, `w` wide across and `t` thick; `roll` turns it about its own length.
function plate(b, a, c, w, t, roll = 0) {
  _x.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const len = _x.length();
  _x.divideScalar(len);
  _up.set(0, 1, 0);
  if (Math.abs(_x.y) > 0.9) _up.set(1, 0, 0);
  _z.crossVectors(_x, _up).normalize();
  _y.crossVectors(_z, _x);
  _m.makeBasis(_x, _y, _z).setPosition(a[0], a[1], a[2]);
  if (roll) _m.multiply(new THREE.Matrix4().makeRotationX(roll));
  const keep = b.matrix;
  b.matrix = _m;
  b.box(len / 2, 0, 0, len, t, w);
  b.matrix = keep;
  return b;
}
// A ring of small blocks round the Y axis (a fur ruff, a collar): reads as a circle from the top-down camera.
function ringY(b, y, r, n, sx, sy, sz, cx = 0) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const keep = b.matrix;
    _m.makeRotationY(-a).setPosition(cx + Math.cos(a) * r, y, Math.sin(a) * r);
    b.matrix = _m;
    b.box(0, 0, 0, sx, sy, sz);
    b.matrix = keep;
  }
}

// The mastery set every tier-5 skin wears: a lit core on the chest, a light down the back and two shoulder bars.
export function masteryTorso(b, front, back, shoulderZ, top) {
  tag(b, ACC | MASTERY, () => {
    b.setPart(0).setColor(0xffe08a);
    b.prismX(front, front + 0.035, 0.4, 0, 0.11, 0.11, 4);
    b.box(back, 0.34, 0, 0.03, 0.42, 0.07);
    b.box(0, top, shoulderZ, 0.24, 0.03, 0.06); b.box(0, top, -shoulderZ, 0.24, 0.03, 0.06);
  });
}
// And a ring of lights over the head, which is what reads from the top-down camera.
export function halo(b, y, r) {
  tag(b, ACC | MASTERY, () => {
    b.setPart(0).setColor(0xffe08a);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; b.box(Math.cos(a) * r, y, Math.sin(a) * r, 0.06, 0.03, 0.06); }
  });
}

const pelvis = (b, wide = 0.42, colour = 0x2b2d33) => b.setPart(0).setColor(colour).box(0, 0.04, 0, 0.3, 0.2, wide);
const chest = (b, sx = 0.38, sy = 0.5, sz = 0.56, ch = 0.06) => b.setPart(1).box(0, 0.36, 0, sx, sy, sz, ch);
const pauldrons = (b, sx, sy, sz, zPos = 0.31, y = 0.6) => { b.setPart(1).box(0, y, zPos, sx, sy, sz, 0.04); b.box(0, y, -zPos, sx, sy, sz, 0.04); };
// Elite chest lights shared by every kit core: two strobes on the shoulder straps.
const eliteStrobes = (b, x, z, y = 0.56) => tag(b, ACC | ELITE, () => b.setPart(0).setColor(0x5dff7a).box(x, y, z, 0.04, 0.05, 0.05).box(x, y, -z, 0.04, 0.05, 0.05));

/* ---------- Torso slots ---------- */
export const CORE = {
  // Plate carrier with medium pauldrons: the standard frame.
  plate(b) {
    pelvis(b, 0.42);
    chest(b, 0.38, 0.5, 0.54);
    b.setPart(0).setColor(0x23252b).box(0.205, 0.34, 0, 0.05, 0.38, 0.4, 0.02);
    b.setColor(0x34373f).box(0.24, 0.24, 0.12, 0.05, 0.12, 0.1).box(0.24, 0.24, -0.12, 0.05, 0.12, 0.1).box(0.24, 0.24, 0, 0.05, 0.12, 0.1);
    pauldrons(b, 0.28, 0.16, 0.2, 0.3, 0.6);
    tag(b, ELITE, () => b.setPart(0).setColor(0x23252b).box(0.06, 0.66, 0, 0.26, 0.06, 0.3));     // Raised collar plate.
    eliteStrobes(b, 0.2, 0.17);
    masteryTorso(b, 0.232, -0.2, 0.3, 0.69);
  },
  // A light chest rig over a slimmer carrier: scouts, medics, signallers.
  light(b) {
    pelvis(b, 0.38, 0x2e3036);
    chest(b, 0.34, 0.48, 0.5, 0.05);
    b.setPart(0).setColor(0x2a2c30).box(0.182, 0.3, 0, 0.03, 0.26, 0.4);
    b.setColor(0x3a3d44).box(0.2, 0.3, 0.1, 0.04, 0.12, 0.08).box(0.2, 0.3, -0.1, 0.04, 0.12, 0.08);
    b.setColor(0x24262a).box(0.0, 0.62, 0.15, 0.36, 0.02, 0.05).box(0.0, 0.62, -0.15, 0.36, 0.02, 0.05);     // Straps over the shoulders.
    pauldrons(b, 0.2, 0.1, 0.15, 0.27, 0.59);
    tag(b, ELITE, () => b.setPart(0).setColor(0x3a3d44).box(0.2, 0.46, 0, 0.04, 0.1, 0.3));
    eliteStrobes(b, 0.18, 0.15, 0.6);
    masteryTorso(b, 0.2, -0.18, 0.27, 0.66);
  },
  // Big plates and wide pauldrons: gunners, breachers.
  heavy(b) {
    pelvis(b, 0.48, 0x26292e);
    chest(b, 0.44, 0.54, 0.62, 0.07);
    b.setPart(0).setColor(0x2a2d33).box(0.245, 0.35, 0, 0.07, 0.44, 0.5, 0.03);
    b.setColor(0x3a3f47).box(0.0, 0.1, 0.27, 0.3, 0.16, 0.08).box(0.0, 0.1, -0.27, 0.3, 0.16, 0.08);            // Hip plates.
    pauldrons(b, 0.38, 0.22, 0.3, 0.37, 0.62);
    tag(b, ELITE, () => b.setPart(0).setColor(0x2a2d33).box(0.28, 0.18, 0, 0.05, 0.2, 0.54));
    eliteStrobes(b, 0.26, 0.2, 0.62);
    masteryTorso(b, 0.28, -0.23, 0.37, 0.75);
  },
  // A long coat with the skirt to the knee: officers.
  coat(b) {
    pelvis(b, 0.44, 0x2a2730);
    chest(b, 0.38, 0.5, 0.54, 0.05);
    b.setPart(0).setColor(0x2f2c36);
    b.box(-0.02, -0.12, 0, 0.36, 0.36, 0.5, 0.03);                                // Skirt.
    b.box(0.2, 0.36, 0, 0.03, 0.44, 0.16);                                        // Lapels.
    b.setColor(0x1c1a20).box(0, 0.12, 0, 0.4, 0.05, 0.56);                        // Belt.
    tag(b, ACC, () => b.setPart(0).setColor(0xd9b44a).box(0.205, 0.44, 0.03, 0.012, 0.03, 0.03).box(0.205, 0.32, 0.03, 0.012, 0.03, 0.03).box(0.205, 0.12, 0, 0.03, 0.06, 0.06));
    pauldrons(b, 0.24, 0.1, 0.18, 0.29, 0.6);
    tag(b, ELITE, () => b.setPart(1).box(-0.2, 0.2, 0, 0.04, 0.6, 0.54));         // Short cape in the team colour.
    masteryTorso(b, 0.212, -0.24, 0.29, 0.67);
  },
  // A padded parka, puffy and rounded, its skirt over the hips.
  parka(b) {
    pelvis(b, 0.46, 0x3a3f46);
    b.setPart(1).prismY(0.1, 0.62, 0, 0, 0.3, 0.27, 8, Math.PI / 8);              // Rounded body in the team colour.
    b.setPart(0).setColor(0xc8ccd0).prismY(-0.12, 0.12, 0, 0, 0.29, 0.31, 8, Math.PI / 8);   // Skirt.
    b.setColor(0x8a9098).box(0.27, 0.34, 0, 0.04, 0.46, 0.05);                    // Zip flap.
    pauldrons(b, 0.2, 0.08, 0.14, 0.27, 0.6);
    tag(b, ACC | ELITE, () => b.setPart(0).setColor(0x4dc8ff).box(0.28, 0.5, 0.12, 0.02, 0.04, 0.08).box(0.28, 0.5, -0.12, 0.02, 0.04, 0.08));
    masteryTorso(b, 0.29, -0.3, 0.27, 0.66);
  },
  // A wetsuit with a chest rebreather: divers.
  wetsuit(b) {
    pelvis(b, 0.38, 0x1a1c20);
    chest(b, 0.34, 0.48, 0.5, 0.05);
    b.setPart(0).setColor(0x1c1e22).box(0.2, 0.36, 0, 0.08, 0.26, 0.3, 0.03);    // Rebreather on the chest.
    b.setColor(0x30343a).prismZ(-0.12, 0.12, 0.25, 0.5, 0.04, 0.04, 6);
    tag(b, ACC, () => b.setPart(0).setColor(0x3affd8).box(0.242, 0.4, 0.07, 0.012, 0.05, 0.05));
    pauldrons(b, 0.18, 0.08, 0.14, 0.27, 0.59);
    eliteStrobes(b, 0.18, 0.15, 0.6);
    masteryTorso(b, 0.24, -0.18, 0.27, 0.66);
  },
};

export const BACK = {
  smallpack(b) {
    b.setPart(0).setColor(0x34373f).box(-0.24, 0.34, 0, 0.12, 0.34, 0.34, 0.03);
    b.setPart(1).box(-0.24, 0.52, 0, 0.1, 0.04, 0.3);
  },
  medpack(b) {
    b.setPart(0).setColor(0x3a4038).box(-0.27, 0.32, 0, 0.18, 0.42, 0.38, 0.03);
    tag(b, ACC, () => b.setPart(0).setColor(0xf2f2ea).box(-0.362, 0.4, 0, 0.012, 0.07, 0.3).box(-0.27, 0.535, 0, 0.14, 0.012, 0.3));   // White bands, front and top.
    b.setColor(0x2a2e28).box(-0.27, 0.12, 0.2, 0.12, 0.12, 0.08);
  },
  // A long rifle bag slung across the back, corner to corner: a diagonal bar from above.
  dragbag(b) {
    b.setPart(0).setColor(0x4f5040);
    seg(b, [-0.25, 0.06, 0.3], [-0.25, 0.9, -0.24], 0.075, 0.07, 6);
    b.setColor(0x2a2a24).box(-0.25, 0.42, 0.02, 0.05, 0.06, 0.2);
    b.setPart(1).box(-0.22, 0.3, 0, 0.06, 0.2, 0.26);
  },
  // A drone in a cradle on the pack, four rotors spread wide: a cross of discs from above.
  dronecase(b) {
    b.setPart(0).setColor(0x2e3238).box(-0.27, 0.36, 0, 0.14, 0.44, 0.44, 0.03);
    b.setColor(0x1e2024).box(-0.27, 0.62, 0, 0.18, 0.06, 0.18);
    for (const [dx, dz] of [[0.14, 0.2], [0.14, -0.2], [-0.14, 0.2], [-0.14, -0.2]]) {
      b.setColor(0x1e2024).box(-0.27 + dx / 2, 0.64, dz / 2, Math.abs(dx) + 0.02, 0.025, 0.03);
      b.setPart(1).prismY(0.64, 0.665, -0.27 + dx, dz, 0.11, 0.11, 8);
      b.setPart(0);
    }
    tag(b, ACC, () => b.setPart(0).setColor(0x4dc8ff).box(-0.2, 0.62, 0, 0.03, 0.03, 0.08));
  },
  radio(b) {
    b.setPart(0).setColor(0x3f4a3a).box(-0.26, 0.34, 0, 0.16, 0.42, 0.32, 0.03);
    b.setColor(0x181a1c).prismY(0.55, 1.15, -0.28, 0.1, 0.018, 0.01, 4);
    tag(b, ACC, () => b.setPart(0).setColor(0xffcc33).box(-0.345, 0.42, -0.06, 0.012, 0.05, 0.1));
  },
  // Two charges on the back and a third on the hip.
  satchels(b) {
    b.setPart(0).setColor(0x5a4a32).box(-0.25, 0.4, 0.13, 0.14, 0.26, 0.2, 0.03).box(-0.25, 0.4, -0.13, 0.14, 0.26, 0.2, 0.03);
    b.box(-0.04, 0.1, 0.26, 0.2, 0.16, 0.1);
    b.setPart(1).box(-0.25, 0.55, 0, 0.12, 0.04, 0.48);
    tag(b, ACC, () => b.setPart(0).setColor(0xff4a2a).box(-0.325, 0.46, 0.13, 0.012, 0.03, 0.03).box(-0.325, 0.46, -0.13, 0.012, 0.03, 0.03));
  },
  // An ammo can on the back and a belt running round to the gun side.
  ammobox(b) {
    b.setPart(0).setColor(0x4a4f3a).box(-0.29, 0.32, 0, 0.22, 0.38, 0.42, 0.03);
    b.setColor(0x2e3226).box(-0.29, 0.53, 0, 0.12, 0.04, 0.2);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xd9b44a);
      seg(b, [-0.24, 0.48, -0.2], [-0.05, 0.5, -0.33], 0.035, 0.035, 4);
      seg(b, [-0.05, 0.5, -0.33], [0.16, 0.42, -0.26], 0.035, 0.035, 4);
    });
  },
  // A dish antenna on a short mast: a big disc over the shoulders from above.
  dish(b) {
    b.setPart(0).setColor(0x2f3338).box(-0.26, 0.32, 0, 0.14, 0.38, 0.34, 0.03);
    b.setColor(0x1c1e22).prismY(0.5, 0.76, -0.28, 0, 0.025, 0.02, 5);
    b.setPart(1).prismY(0.76, 0.8, -0.3, 0, 0.27, 0.27, 10);
    b.setPart(0).setColor(0x8a9098).prismY(0.8, 0.83, -0.3, 0, 0.24, 0.12, 10);
    tag(b, ACC, () => b.setPart(0).setColor(0x7cf8ff).prismY(0.83, 0.9, -0.3, 0, 0.035, 0.02, 6));
  },
  // A climbing pack with a rope coil and an ice axe.
  rope(b) {
    b.setPart(0).setColor(0x5a4030).box(-0.26, 0.34, 0, 0.16, 0.44, 0.36, 0.03);
    b.setColor(0xc8a050);
    ringY(b, 0.6, 0.15, 10, 0.06, 0.06, 0.08, -0.27);
    b.setPart(1).box(-0.27, 0.6, 0, 0.06, 0.03, 0.1);
    b.setPart(0).setColor(0x2a2c30);
    seg(b, [-0.36, 0.1, -0.12], [-0.36, 0.78, -0.18], 0.02, 0.02, 4);
    b.setColor(0x8a9098).box(-0.36, 0.78, -0.18, 0.04, 0.03, 0.18);
  },
  // A pack with a bedroll strapped across the top: a bar wider than the shoulders.
  bedroll(b) {
    b.setPart(0).setColor(0x6b5a40).box(-0.25, 0.32, 0, 0.14, 0.36, 0.34, 0.03);
    b.setColor(0x8a7a5a).prismZ(-0.3, 0.3, -0.25, 0.6, 0.085, 0.085, 7);
    b.setPart(1).prismZ(-0.31, -0.27, -0.25, 0.6, 0.092, 0.092, 7).prismZ(0.27, 0.31, -0.25, 0.6, 0.092, 0.092, 7);
  },
  // A light pack and a canteen on the hip.
  canteen(b) {
    b.setPart(0).setColor(0x6b5f48).box(-0.23, 0.36, 0, 0.1, 0.3, 0.3, 0.03);
    b.setColor(0x4a5a48).prismY(0.0, 0.2, -0.06, -0.27, 0.07, 0.065, 7);
    b.setPart(1).box(-0.23, 0.52, 0, 0.08, 0.04, 0.26);
  },
  // A frame of tools: a wrench and a hammer sticking up past the shoulders.
  toolrack(b) {
    b.setPart(0).setColor(0x3a3530).box(-0.25, 0.32, 0, 0.12, 0.4, 0.4, 0.02);
    b.setColor(0x8a9098);
    seg(b, [-0.29, 0.3, 0.12], [-0.31, 0.86, 0.16], 0.03, 0.03, 4);
    b.box(-0.31, 0.88, 0.16, 0.05, 0.06, 0.12);
    b.setColor(0x6a4a2a);
    seg(b, [-0.29, 0.3, -0.12], [-0.31, 0.8, -0.16], 0.025, 0.025, 4);
    b.setColor(0x4a4e55).box(-0.31, 0.82, -0.16, 0.06, 0.07, 0.16);
    b.setPart(1).box(-0.25, 0.53, 0, 0.1, 0.04, 0.36);
  },
  // A tall expedition pack, taller than the head, with reflective strips.
  snowpack(b) {
    b.setPart(0).setColor(0x3a4250).box(-0.28, 0.48, 0, 0.18, 0.7, 0.36, 0.04);
    b.setPart(1).box(-0.28, 0.85, 0, 0.16, 0.06, 0.34);
    b.setPart(0).setColor(0x8a9098).prismZ(-0.22, 0.22, -0.28, 0.14, 0.07, 0.07, 6);
    tag(b, ACC, () => b.setPart(0).setColor(0x4dc8ff).box(-0.372, 0.5, 0.11, 0.012, 0.3, 0.03).box(-0.372, 0.5, -0.11, 0.012, 0.3, 0.03));
  },
  // Twin dive tanks.
  tanks(b) {
    b.setPart(0).setColor(0x8a9098).prismY(0.04, 0.6, -0.28, 0.1, 0.085, 0.085, 8).prismY(0.04, 0.6, -0.28, -0.1, 0.085, 0.085, 8);
    b.setPart(1).prismY(0.3, 0.38, -0.28, 0.1, 0.09, 0.09, 8).prismY(0.3, 0.38, -0.28, -0.1, 0.09, 0.09, 8);
    b.setPart(0).setColor(0x1c1e22).box(-0.28, 0.64, 0, 0.06, 0.06, 0.26);
    tag(b, ACC, () => b.setPart(0).setColor(0x3affd8).box(-0.28, 0.68, 0, 0.04, 0.03, 0.06));
  },
  // A lantern on a frame over the pack: a lit point above the head line.
  lantern(b) {
    b.setPart(0).setColor(0x2a2c30).box(-0.27, 0.34, 0, 0.16, 0.42, 0.38, 0.03);
    b.setColor(0x1c1e22).prismY(0.55, 0.92, -0.32, -0.12, 0.02, 0.02, 4);
    b.box(-0.32, 0.92, -0.06, 0.03, 0.03, 0.14);
    b.prismY(0.98, 1.02, -0.32, 0.0, 0.07, 0.05, 6);
    tag(b, ACC, () => b.setPart(0).setColor(0xffc96b).prismY(0.78, 0.98, -0.32, 0.0, 0.06, 0.06, 6));
  },
};

export const EXTRA = {
  armband(b) {
    tag(b, ACC, () => b.setPart(0).setColor(0xf2f2ea).box(0, 0.54, 0.29, 0.2, 0.06, 0.05).box(0, 0.54, -0.29, 0.2, 0.06, 0.05));
    b.setPart(0).setColor(0x3a4038).box(0.03, 0.12, 0.24, 0.16, 0.14, 0.08);     // Hip med pouch.
  },
  // A scrim scarf over the shoulders, its tails down the back.
  scrim(b) {
    b.setPart(0).setColor(0x5a6040).prismY(0.58, 0.66, 0, 0, 0.25, 0.2, 7);
    b.box(-0.2, 0.42, 0.08, 0.04, 0.3, 0.1).box(-0.22, 0.38, -0.06, 0.04, 0.34, 0.08);
  },
  // Binoculars on the chest and a map case on the hip.
  binos(b) {
    b.setPart(0).setColor(0x1e2024).prismX(0.17, 0.32, 0.42, 0.06, 0.045, 0.05, 6).prismX(0.17, 0.32, 0.42, -0.06, 0.045, 0.05, 6);
    b.setColor(0x4a4636).box(0.0, 0.08, 0.26, 0.22, 0.18, 0.05);
    tag(b, ACC, () => b.setPart(0).setColor(0x9fe8ff).box(0.322, 0.42, 0.06, 0.006, 0.05, 0.05).box(0.322, 0.42, -0.06, 0.006, 0.05, 0.05));
  },
  // A shemagh wound round the neck, its tail over one shoulder.
  shemagh(b) {
    b.setPart(0).setColor(0xb8a07a).prismY(0.56, 0.68, 0, 0, 0.24, 0.19, 8);
    b.box(-0.16, 0.48, 0.16, 0.08, 0.24, 0.1);
  },
  // A bandolier from the right shoulder to the left hip.
  bandolier(b) {
    b.setPart(0).setColor(0x3a3226);
    plate(b, [0.2, 0.62, -0.2], [0.2, 0.1, 0.22], 0.08, 0.04);
    plate(b, [-0.2, 0.62, -0.2], [-0.2, 0.1, 0.22], 0.08, 0.04);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xd9b44a);
      for (let i = 0; i < 4; i++) { const t = 0.2 + i * 0.18; b.box(0.225, 0.62 - 0.52 * t, -0.2 + 0.42 * t, 0.02, 0.06, 0.03); }
    });
  },
  // A row of round pouches across the chest.
  grenades(b) {
    b.setPart(0).setColor(0x30343a);
    for (const z of [-0.14, 0, 0.14]) b.prismX(0.18, 0.27, 0.22, z, 0.055, 0.05, 6);
    tag(b, ACC, () => b.setPart(0).setColor(0x8aff6a).box(0.272, 0.22, 0.14, 0.006, 0.02, 0.02));
  },
  // Two ammo belts crossed over the chest: an X from the front and a bright V from above.
  belts(b) {
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xc8a040);
      plate(b, [0.24, 0.64, -0.22], [0.24, 0.1, 0.22], 0.07, 0.04);
      plate(b, [0.25, 0.64, 0.22], [0.25, 0.1, -0.22], 0.07, 0.04);
    });
    b.setPart(0).setColor(0x3a3226).box(0, 0.64, 0.22, 0.4, 0.03, 0.08).box(0, 0.64, -0.22, 0.4, 0.03, 0.08);
  },
  // A thick fur collar: a pale ring round the neck from above.
  furcollar(b) {
    b.setPart(0).setColor(0xd8d0c0);
    ringY(b, 0.64, 0.2, 12, 0.1, 0.1, 0.12);
  },
  // Swept wing plates on the shoulders, in the team colour with lit edges.
  wings(b) {
    for (const s of [1, -1]) {
      b.setPart(1);
      plate(b, [0.02, 0.62, 0.3 * s], [-0.26, 0.92, 0.46 * s], 0.18, 0.03, 0.5 * s);
      tag(b, ACC, () => { b.setPart(0).setColor(0xffd659); plate(b, [0.06, 0.64, 0.34 * s], [-0.24, 0.96, 0.5 * s], 0.04, 0.035, 0.5 * s); });
    }
  },
  // Fringed epaulettes and a sash.
  epaulettes(b) {
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xd9b44a).box(0, 0.65, 0.3, 0.22, 0.04, 0.16).box(0, 0.65, -0.3, 0.22, 0.04, 0.16);
      b.box(0, 0.6, 0.37, 0.2, 0.08, 0.02).box(0, 0.6, -0.37, 0.2, 0.08, 0.02);
    });
    b.setPart(1);
    plate(b, [0.205, 0.6, 0.18], [0.205, 0.12, -0.2], 0.08, 0.02);
  },
  // A tool belt round the hips: pouches and a hammer.
  toolbelt(b) {
    b.setPart(0).setColor(0x5a4030).box(0, 0.12, 0, 0.34, 0.07, 0.48);
    b.setColor(0x6a5038).box(0.05, 0.04, 0.26, 0.16, 0.16, 0.08).box(0.05, 0.04, -0.26, 0.16, 0.16, 0.08);
    b.setColor(0x8a9098).box(-0.1, 0.0, 0.28, 0.06, 0.06, 0.04);
  },
};

/* ---------- Head slots ---------- */
// Everything sits over the bare skull of the face slot (radius ~0.17), so a hat a touch bigger than that covers it.
const skullTop = (b, y0 = 0.27, y1 = 0.36, r = 0.172) => b.prismY(y0, y1, -0.005, 0, r, r * 0.55, 8, Math.PI / 8);

export const GEAR = {
  // Low-cut helmet: rounder and closer than the trooper's, with side rails.
  helmet(b) {
    b.setPart(1).prismY(0.15, 0.28, 0, 0, 0.225, 0.24, 8, Math.PI / 8);
    b.prismY(0.28, 0.4, -0.005, 0, 0.24, 0.13, 8, Math.PI / 8);
    b.setPart(0).setColor(0x23262b).box(-0.01, 0.22, 0.235, 0.22, 0.04, 0.02).box(-0.01, 0.22, -0.235, 0.22, 0.04, 0.02);
    tag(b, ELITE, () => b.setPart(0).setColor(0x23262b).box(0.2, 0.34, 0, 0.08, 0.06, 0.12));
    tag(b, ACC | ELITE, () => b.setPart(0).setColor(0x5dff7a).box(-0.18, 0.37, 0, 0.06, 0.05, 0.06));
  },
  // Patrol cap: flat crown and a short brim.
  cap(b) {
    b.setPart(1).prismY(0.26, 0.39, 0, 0, 0.19, 0.18, 8, Math.PI / 8);
    b.setPart(0).setColor(0x2a2c30).box(0.19, 0.27, 0, 0.14, 0.022, 0.26);
    tag(b, ACC | ELITE, () => b.setPart(0).setColor(0xffd08a).box(0.18, 0.33, 0, 0.012, 0.04, 0.05));
  },
  // A rounded flight helmet with its visor raised and a boom mic.
  flight(b) {
    b.setPart(1).prismY(0.1, 0.32, -0.01, 0, 0.215, 0.23, 10);
    b.prismY(0.32, 0.43, -0.01, 0, 0.23, 0.12, 10);
    b.setPart(0).setColor(0x1a1c20).box(0.07, 0.15, 0.2, 0.12, 0.12, 0.05).box(0.18, 0.12, 0.17, 0.14, 0.022, 0.022);
    tag(b, ACC | NO_ELITE, () => b.setPart(0).setColor(0x9fe8ff).box(0.06, 0.41, 0, 0.22, 0.04, 0.3));      // Visor up.
    tag(b, ACC | ELITE, () => b.setPart(0).setColor(0x9fe8ff).box(0.205, 0.24, 0, 0.04, 0.12, 0.34));       // Visor down.
  },
  // A beret pulled to one side, cap badge over the eye.
  beret(b) {
    b.setPart(1).prismY(0.31, 0.41, -0.01, 0.035, 0.215, 0.15, 10);
    b.setPart(0).setColor(0x1c1e22).prismY(0.28, 0.32, -0.005, 0, 0.19, 0.19, 10);
    tag(b, ACC, () => b.setPart(0).setColor(0xd9b44a).box(0.17, 0.32, -0.07, 0.03, 0.05, 0.04));
  },
  // A shemagh wrapped over the head, a team-coloured band round it, its tail down the back.
  wrap(b) {
    b.setPart(0).setColor(0xb8a07a).prismY(0.13, 0.36, -0.01, 0, 0.19, 0.16, 8, Math.PI / 8);
    skullTop(b, 0.36, 0.42, 0.16);
    b.box(-0.18, 0.12, 0.06, 0.06, 0.26, 0.14);
    b.setPart(1).prismY(0.3, 0.335, -0.01, 0, 0.17, 0.17, 8, Math.PI / 8);
  },
  // A knitted cap, folded at the brim.
  beanie(b) {
    b.setPart(1).prismY(0.24, 0.42, -0.01, 0, 0.18, 0.11, 8, Math.PI / 8);
    b.setPart(0).setColor(0x2a2c30).prismY(0.22, 0.28, -0.01, 0, 0.185, 0.185, 8, Math.PI / 8);
    tag(b, ACC | ELITE, () => b.setPart(0).setColor(0xffb14a).box(0.14, 0.32, 0, 0.06, 0.05, 0.16));
  },
  // A helmet with a four-eyed night vision set flipped down: four lit lenses from the front.
  nvg(b) {
    b.setPart(1).prismY(0.15, 0.28, 0, 0, 0.225, 0.24, 8, Math.PI / 8);
    b.prismY(0.28, 0.4, -0.005, 0, 0.24, 0.13, 8, Math.PI / 8);
    b.setPart(0).setColor(0x1a1c20).box(0.2, 0.3, 0, 0.08, 0.06, 0.12);
    b.box(0.25, 0.24, 0, 0.08, 0.08, 0.24);
    b.setColor(0x23262b).box(-0.21, 0.28, 0, 0.08, 0.1, 0.14);                    // Battery on the back.
    tag(b, ACC, () => {
      b.setPart(0).setColor(0x5dff7a);
      for (const z of [-0.1, -0.035, 0.035, 0.1]) b.prismX(0.29, 0.31, 0.24, z, 0.026, 0.026, 6);
    });
  },
  // A parka hood with a fur ruff round the face: a big pale ring from above.
  hood(b) {
    b.setPart(1).prismY(0.04, 0.36, -0.04, 0, 0.25, 0.22, 8, Math.PI / 8);
    b.prismY(0.36, 0.44, -0.04, 0, 0.22, 0.12, 8, Math.PI / 8);
    b.setPart(0).setColor(0xd8d0c0);
    const keep = b.matrix;
    for (let i = 0; i < 12; i++) {                                                // Ruff: a ring in the face plane.
      const a = (i / 12) * TAU;
      _m.makeRotationX(a).setPosition(0.19, 0.22 + Math.cos(a) * 0.16, Math.sin(a) * 0.16);
      b.matrix = _m;
      b.box(0, 0, 0, 0.08, 0.1, 0.1);
    }
    b.matrix = keep;
  },
  // A crested helm with swept wings at the temples.
  wingcrest(b) {
    b.setPart(1).prismY(0.1, 0.3, 0, 0, 0.21, 0.23, 8, Math.PI / 8);
    b.prismY(0.3, 0.42, -0.005, 0, 0.23, 0.12, 8, Math.PI / 8);
    b.setPart(0).setColor(0xc8ccd4);
    for (const s of [1, -1]) plate(b, [0.04, 0.3, 0.2 * s], [-0.3, 0.56, 0.3 * s], 0.12, 0.025, 0.6 * s);
    tag(b, ACC, () => b.setPart(0).setColor(0xffd659).box(-0.04, 0.45, 0, 0.36, 0.05, 0.035));
    tag(b, ELITE, () => b.setPart(1).box(-0.06, 0.52, 0, 0.3, 0.12, 0.03));
  },
  // A desert cap with a cloth flap down the neck.
  desertcap(b) {
    b.setPart(1).prismY(0.26, 0.38, 0, 0, 0.19, 0.17, 8, Math.PI / 8);
    b.setPart(0).setColor(0xa48a5e).box(0.2, 0.27, 0, 0.16, 0.022, 0.28);
    b.box(-0.15, 0.17, 0, 0.08, 0.2, 0.36);
    b.box(-0.03, 0.2, 0.18, 0.2, 0.16, 0.04).box(-0.03, 0.2, -0.18, 0.2, 0.16, 0.04);
  },
  // A ball cap turned backwards, headphones over it.
  backcap(b) {
    b.setPart(1).prismY(0.26, 0.38, 0, 0, 0.185, 0.17, 8, Math.PI / 8);
    b.setPart(0).setColor(0x2a2c30).box(-0.2, 0.27, 0, 0.14, 0.022, 0.24);
    b.setColor(0x1a1c20).box(0, 0.22, 0.185, 0.1, 0.12, 0.04).box(0, 0.22, -0.185, 0.1, 0.12, 0.04).box(0, 0.39, 0, 0.04, 0.03, 0.36);
    tag(b, ACC, () => b.setPart(0).setColor(0x7cf8ff).box(0, 0.22, 0.208, 0.04, 0.04, 0.008).box(0, 0.22, -0.208, 0.04, 0.04, 0.008));
  },
  // A fur hat with ear flaps, goggles on its front.
  furhat(b) {
    b.setPart(0).setColor(0x6a5038).prismY(0.24, 0.44, -0.01, 0, 0.215, 0.2, 8, Math.PI / 8);
    b.box(-0.02, 0.18, 0.19, 0.16, 0.18, 0.05).box(-0.02, 0.18, -0.19, 0.16, 0.18, 0.05);
    b.setPart(1).prismY(0.44, 0.47, -0.01, 0, 0.17, 0.12, 8, Math.PI / 8);
    b.setPart(0).setColor(0x1a1c20).box(0.19, 0.35, 0, 0.05, 0.06, 0.3);
    tag(b, ACC, () => b.setPart(0).setColor(0xffb14a).box(0.215, 0.35, 0.07, 0.01, 0.045, 0.08).box(0.215, 0.35, -0.07, 0.01, 0.045, 0.08));
  },
  // Ear defenders on a headband over bare hair.
  earpro(b) {
    b.setPart(1).prismZ(0.17, 0.23, 0.0, 0.22, 0.075, 0.07, 8).prismZ(-0.23, -0.17, 0.0, 0.22, 0.07, 0.075, 8);
    b.setPart(0).setColor(0x1a1c20).box(0, 0.4, 0.0, 0.05, 0.03, 0.42);
    b.box(0, 0.33, 0.2, 0.05, 0.14, 0.03).box(0, 0.33, -0.2, 0.05, 0.14, 0.03);
  },
  // A peaked officer's cap, flared crown in the team colour.
  officer(b) {
    b.setPart(0).setColor(0x1c1a20).prismY(0.25, 0.31, 0, 0, 0.185, 0.19, 10);
    b.setPart(1).prismY(0.31, 0.41, 0.01, 0, 0.19, 0.24, 10);
    b.setPart(0).setColor(0x101215).box(0.2, 0.27, 0, 0.14, 0.02, 0.28);
    tag(b, ACC, () => b.setPart(0).setColor(0xd9b44a).box(0.2, 0.34, 0, 0.03, 0.06, 0.07).box(0.2, 0.29, 0, 0.012, 0.015, 0.3));
  },
  // A tight dive hood with a team stripe.
  divehood(b) {
    b.setPart(0).setColor(0x1a1c20).prismY(0.06, 0.32, -0.015, 0, 0.19, 0.19, 8, Math.PI / 8);
    skullTop(b, 0.32, 0.4, 0.19);
    b.setPart(1).box(-0.02, 0.36, 0, 0.34, 0.06, 0.07);
  },
  // A tall tower helm with a slit visor and a lamp on its crown.
  tower(b) {
    b.setPart(1).prismY(0.08, 0.5, 0, 0, 0.24, 0.2, 8, Math.PI / 8);
    b.setPart(0).setColor(0x3a3f47).prismY(0.5, 0.56, 0, 0, 0.21, 0.15, 8, Math.PI / 8);
    b.setColor(0x101215).box(0.21, 0.26, 0, 0.06, 0.06, 0.3);
    tag(b, ACC, () => b.setPart(0).setColor(0xffc96b).box(0.24, 0.26, 0, 0.012, 0.025, 0.28).prismY(0.56, 0.64, 0, 0, 0.05, 0.04, 6));
    tag(b, ELITE, () => b.setPart(1).box(-0.02, 0.62, 0, 0.42, 0.08, 0.05));
  },
  // A headband with welding goggles pushed up on it.
  weldband(b) {
    b.setPart(1).prismY(0.27, 0.31, -0.005, 0, 0.178, 0.178, 8, Math.PI / 8);
    b.setPart(0).setColor(0x2a2c30).prismX(0.12, 0.2, 0.34, 0.07, 0.055, 0.055, 7).prismX(0.12, 0.2, 0.34, -0.07, 0.055, 0.055, 7);
    tag(b, ACC, () => b.setPart(0).setColor(0x5dff7a).prismX(0.2, 0.215, 0.34, 0.07, 0.045, 0.045, 7).prismX(0.2, 0.215, 0.34, -0.07, 0.045, 0.045, 7));
  },
};

// Hair: tied back under the same kit everyone wears, so it reads past a helmet's rim from above.
export const HAIR = {
  crop(b) { tag(b, LOCKS, () => skullTop(b, 0.24, 0.37, 0.176)); },
  // A low bun at the nape, showing behind a helmet.
  bun(b) {
    tag(b, LOCKS, () => {
      skullTop(b, 0.22, 0.37, 0.176);
      b.prismY(0.13, 0.3, -0.25, 0, 0.085, 0.07, 7);
    });
  },
  // A high bun on the crown.
  highbun(b) {
    tag(b, LOCKS, () => {
      skullTop(b, 0.22, 0.37, 0.176);
      b.prismY(0.32, 0.46, -0.12, 0, 0.08, 0.06, 7);
    });
  },
  // A ponytail from the back of the head, swinging out past the shoulders.
  pony(b) {
    tag(b, LOCKS, () => {
      skullTop(b, 0.22, 0.37, 0.176);
      seg(b, [-0.18, 0.32, 0], [-0.33, 0.14, 0.02], 0.05, 0.065, 6);
      seg(b, [-0.33, 0.14, 0.02], [-0.37, -0.12, 0.03], 0.065, 0.03, 6);
    });
  },
  // A long single braid down the back.
  braid(b) {
    tag(b, LOCKS, () => {
      skullTop(b, 0.22, 0.37, 0.176);
      const pts = [[-0.17, 0.28, 0], [-0.28, 0.12, 0], [-0.31, -0.06, 0], [-0.31, -0.24, 0], [-0.3, -0.38, 0]];
      for (let i = 0; i < pts.length - 1; i++) seg(b, pts[i], pts[i + 1], 0.055 - i * 0.006, 0.05 - i * 0.006, 5);
    });
  },
  // A chin-length bob framing the face.
  bob(b) {
    tag(b, LOCKS, () => {
      skullTop(b, 0.22, 0.38, 0.182);
      b.box(-0.02, 0.18, 0.17, 0.26, 0.2, 0.05).box(-0.02, 0.18, -0.17, 0.26, 0.2, 0.05);
      b.box(-0.155, 0.18, 0, 0.07, 0.22, 0.3);
    });
  },
  // A mohawk over shaved sides.
  mohawk(b) { tag(b, LOCKS, () => b.box(-0.03, 0.38, 0, 0.34, 0.1, 0.06)); },
  // Long hair falling down the back from under a head wrap.
  long(b) {
    tag(b, LOCKS, () => {
      skullTop(b, 0.22, 0.37, 0.176);
      b.box(-0.17, 0.08, 0, 0.07, 0.36, 0.26);
      b.box(-0.21, -0.12, 0, 0.05, 0.12, 0.2);
    });
  },
};

// Faces: the skull in the operator's skin tone, eyes, and whatever covers or decorates it.
function skull(b) {
  tag(b, TONE, () => {
    b.setPart(0).setColor(0x7a5c43);
    b.box(0, 0.06, 0, 0.17, 0.14, 0.17);
    b.prismY(0.1, 0.29, 0, 0, 0.165, 0.155, 8, Math.PI / 8);
    skullTop(b, 0.29, 0.35, 0.155);
    b.box(0.165, 0.2, 0, 0.04, 0.05, 0.035);                                     // Nose.
  });
  tag(b, KEEP, () => b.setPart(0).setColor(0x15110e).box(0.152, 0.24, 0.06, 0.02, 0.025, 0.04).box(0.152, 0.24, -0.06, 0.02, 0.025, 0.04));
}
const FEATURES = {
  beard: b => tag(b, LOCKS, () => { b.box(0.11, 0.12, 0, 0.12, 0.1, 0.28); b.box(0.16, 0.08, 0, 0.06, 0.08, 0.16); }),
  moustache: b => tag(b, LOCKS, () => b.box(0.175, 0.165, 0, 0.03, 0.025, 0.12)),
  balaclava: b => tag(b, KEEP, () => {
    b.setPart(0).setColor(0x18191c).prismY(0.04, 0.22, 0, 0, 0.175, 0.17, 8, Math.PI / 8);
    b.box(0.16, 0.18, 0, 0.04, 0.1, 0.18);
  }),
  shades: b => tag(b, ACC, () => b.setPart(0).setColor(0x2a3a4a).box(0.17, 0.24, 0, 0.03, 0.045, 0.24)),
  goggles: b => {
    b.setPart(0).setColor(0x1a1c20).box(0.15, 0.24, 0, 0.06, 0.08, 0.34);
    tag(b, ACC, () => b.setPart(0).setColor(0xffb14a).box(0.182, 0.24, 0.06, 0.01, 0.055, 0.09).box(0.182, 0.24, -0.06, 0.01, 0.055, 0.09));
  },
  glasses: b => tag(b, ACC, () => b.setPart(0).setColor(0xbfe0ff).box(0.172, 0.24, 0.06, 0.012, 0.035, 0.05).box(0.172, 0.24, -0.06, 0.012, 0.035, 0.05)),
  scarf: b => b.setPart(0).setColor(0x8a9098).prismY(0.04, 0.2, 0.0, 0, 0.18, 0.175, 8, Math.PI / 8),
  visor: b => tag(b, ACC, () => b.setPart(0).setColor(0xffd659).box(0.165, 0.24, 0, 0.04, 0.05, 0.3)),
  mask: b => {
    b.setPart(0).setColor(0x1a1c20).box(0.15, 0.22, 0, 0.08, 0.12, 0.28);
    tag(b, ACC, () => b.setPart(0).setColor(0x3affd8).box(0.192, 0.23, 0, 0.012, 0.08, 0.22));
    b.setColor(0x30343a);
    seg(b, [0.19, 0.12, 0.06], [0.08, 0.0, 0.2], 0.022, 0.022, 4);          // Mouthpiece hose.
  },
};
// What every kit head shares, drawn once for all of them: the skull, the elite earpiece light, the mastery eye bar and
// halo. Faces are only the features on top of it, joined by '+' ('beard+shades'); 'plain' is the bare skull.
export function headBase(b) {
  skull(b);
  tag(b, ACC | ELITE, () => b.setPart(0).setColor(0x5dff7a).box(0.04, 0.2, 0.175, 0.05, 0.05, 0.03));
  tag(b, ACC | MASTERY, () => b.setPart(0).setColor(0xffe08a).box(0.168, 0.24, 0, 0.03, 0.05, 0.3));
  halo(b, 0.72, 0.24);
}
export const face = name => b => { for (const f of name.split('+')) FEATURES[f]?.(b); };

// The slots in the order the shader numbers them (torso 1..3, head 5..7; 0 and 4 are the hand-made operators).
export const TORSO_SLOTS = [['core', CORE], ['back', BACK], ['extra', EXTRA]];
export const HEAD_SLOTS = [['gear', GEAR], ['hair', HAIR], ['face', null]];
