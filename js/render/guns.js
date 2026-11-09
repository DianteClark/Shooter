// Six invented, deliberately oversized guns built from code. Model space, in metres: +X muzzle,
// +Y up, +Z to the shooter's right, origin at the firing hand. The game camera sees guns mostly from
// above, so each silhouette is designed to be unmistakable from the top as well as the side.
import { MeshBuilder } from './meshbuild.js';
import { PART } from './camo-shader.js';

const C = {
  body:  0x424852,
  bodyL: 0x565d68,
  grip:  0x24262c,
  metal: 0x6d7682,
  dark:  0x2f333a,
  white: 0xffffff,
};

function kit() {
  const b = new MeshBuilder();
  return {
    b,
    body()   { b.setPart(PART.BODY).setColor(C.body);    return b; },
    body2()  { b.setPart(PART.BODY).setColor(C.bodyL);   return b; },
    grip()   { b.setPart(PART.GRIP).setColor(C.grip);    return b; },
    metal()  { b.setPart(PART.METAL).setColor(C.metal);  return b; },
    dark()   { b.setPart(PART.METAL).setColor(C.dark);   return b; },
    accent() { b.setPart(PART.ACCENT).setColor(C.white); return b; },
  };
}

// Heavy forward-canted pistol grip, shared so every gun holds the same in hand.
function pistolGrip(k, x = -0.02, drop = 0.34, w = 0.13) {
  k.grip().extrude([[x - 0.07, 0.02], [x + 0.11, 0.02], [x + 0.04, -drop], [x - 0.15, -drop], [x - 0.13, -0.08]], -w / 2, w / 2);
}

// Assault rifle: long flat-top receiver, flared wedge handguard, tall sight fin, square brake.
function ar() {
  const k = kit(), b = k.b;
  k.body().extrude([[-0.32, -0.02], [0.42, -0.02], [0.52, 0.04], [0.52, 0.2], [0.34, 0.28], [-0.22, 0.28], [-0.32, 0.18]], -0.15, 0.15);
  // Handguard flares wider toward the receiver, reading as a wedge from above.
  b.loft([
    [[0.5, -0.02, -0.2], [0.5, 0.24, -0.2], [0.5, 0.24, 0.2], [0.5, -0.02, 0.2]],
    [[1.04, 0.02, -0.1], [1.04, 0.19, -0.1], [1.04, 0.19, 0.1], [1.04, 0.02, 0.1]],
  ]);
  k.accent(); for (let i = 0; i < 3; i++) b.box(0.62 + i * 0.13, 0.235, 0, 0.07, 0.03, 0.24);
  k.metal().prismX(1.02, 1.2, 0.11, 0, 0.06, 0.055, 6);
  b.box(1.28, 0.11, 0, 0.2, 0.2, 0.28, 0.03);
  k.dark().box(1.28, 0.11, 0, 0.07, 0.22, 0.32);
  k.body().extrude([[-0.32, 0.22], [-0.32, -0.02], [-0.58, -0.13], [-0.94, -0.13], [-0.94, 0.17], [-0.58, 0.24]], -0.11, 0.11);
  k.grip().box(-0.97, 0.02, 0, 0.08, 0.34, 0.25, 0.02);
  k.body2().extrude([[0.14, 0.28], [0.32, 0.28], [0.28, 0.5], [0.2, 0.5]], -0.05, 0.05);   // Sight fin.
  k.accent().box(0.24, 0.5, 0, 0.11, 0.03, 0.13);
  k.dark().extrude([[0.03, 0], [0.26, 0], [0.33, -0.44], [0.1, -0.5]], -0.095, 0.095);     // Forward-swept mag.
  k.metal().box(-0.16, 0.21, -0.17, 0.18, 0.06, 0.07);                                      // Charging handle, sticks out left.
  pistolGrip(k, -0.03, 0.34);
  return { geometry: b.build(), muzzle: [1.36, 0.1, 0], fore: [0.74, 0.02, 0], eject: [0.12, 0.22, 0.12], length: 2.3 };
}

// SMG: stubby brick with a long magazine jutting out the left side, a T shape from above.
function smg() {
  const k = kit(), b = k.b;
  k.body().box(0.14, 0.12, 0, 0.72, 0.28, 0.24, 0.05);
  k.body2().loft([
    [[0.48, 0.0, -0.11], [0.48, 0.25, -0.11], [0.48, 0.25, 0.11], [0.48, 0.0, 0.11]],
    [[0.72, 0.05, -0.07], [0.72, 0.21, -0.07], [0.72, 0.21, 0.07], [0.72, 0.05, 0.07]],
  ]);
  k.metal().prismX(0.7, 0.92, 0.13, 0, 0.06, 0.06, 8);
  b.prismX(0.92, 1.02, 0.13, 0, 0.09, 0.075, 8);
  k.dark().box(0.12, 0.13, -0.38, 0.17, 0.11, 0.56, 0.02);                // Side magazine.
  k.accent().box(0.12, 0.2, -0.5, 0.18, 0.025, 0.14);
  k.accent().box(0.38, 0.27, 0, 0.26, 0.03, 0.06);                        // Top strip.
  k.grip().box(0.56, -0.16, 0, 0.12, 0.34, 0.11, 0.03);                   // Vertical foregrip.
  k.body().extrude([[-0.2, 0.24], [-0.2, 0.0], [-0.46, -0.08], [-0.62, -0.08], [-0.62, 0.12], [-0.46, 0.24]], -0.11, 0.11);
  k.grip().box(-0.65, 0.04, 0, 0.06, 0.28, 0.24, 0.015);
  k.dark().box(0.0, 0.3, 0, 0.3, 0.05, 0.13, 0.015);
  pistolGrip(k, -0.04, 0.3);
  return { geometry: b.build(), muzzle: [1.04, 0.13, 0], fore: [0.56, -0.16, 0], eject: [0.05, 0.28, 0.14], length: 1.65 };
}

// Shotgun: two huge barrels side by side, a fat ribbed pump and a shell rack glowing on the stock.
function shotgun() {
  const k = kit(), b = k.b;
  k.body().box(0.08, 0.1, 0, 0.56, 0.32, 0.46, 0.05);
  k.body().box(0.62, 0.21, 0, 0.74, 0.1, 0.2, 0.02);                       // Rib between the barrels carries camo.
  k.metal().prismX(0.34, 1.26, 0.13, -0.12, 0.11, 0.1, 8, Math.PI / 8);
  k.metal().prismX(0.34, 1.26, 0.13, 0.12, 0.11, 0.1, 8, Math.PI / 8);
  k.dark().box(1.3, 0.13, 0, 0.12, 0.26, 0.54, 0.03);                       // Heavy muzzle collar.
  k.body2().box(0.72, 0.0, 0, 0.46, 0.22, 0.52, 0.04);                     // Pump.
  k.dark(); for (let i = 0; i < 4; i++) b.box(0.57 + i * 0.1, -0.115, 0, 0.05, 0.03, 0.56);
  k.body().extrude([[-0.2, 0.22], [-0.2, -0.02], [-0.5, -0.18], [-0.96, -0.22], [-0.96, 0.1], [-0.5, 0.2]], -0.14, 0.14);
  k.grip().box(-0.99, -0.06, 0, 0.08, 0.36, 0.3, 0.02);
  k.accent(); for (let i = 0; i < 4; i++) b.prismZ(0.1, 0.15, -0.44 - i * 0.1, 0.09, 0.04, 0.04, 6);   // Spare shells.
  k.accent().box(0.14, 0.26, 0, 0.12, 0.04, 0.1);
  pistolGrip(k, -0.03, 0.32);
  return { geometry: b.build(), muzzle: [1.36, 0.13, 0], fore: [0.72, -0.05, 0], eject: [0.12, 0.26, 0.17], length: 2.35 };
}

// LMG: fat perforated shroud, huge drum on the left, bipod folded under the muzzle.
function lmg() {
  const k = kit(), b = k.b;
  k.body().extrude([[-0.34, 0], [0.5, 0], [0.56, 0.06], [0.56, 0.24], [0.4, 0.3], [-0.24, 0.3], [-0.34, 0.2]], -0.13, 0.13);
  k.body2().prismX(0.54, 1.26, 0.13, 0, 0.14, 0.12, 6, Math.PI / 6);      // Hex shroud.
  k.dark(); for (let i = 0; i < 5; i++) b.box(0.66 + i * 0.13, 0.25, 0, 0.055, 0.03, 0.1);  // Cooling slots.
  k.metal().prismX(1.26, 1.48, 0.13, 0, 0.055, 0.05, 6);
  b.prismX(1.48, 1.62, 0.13, 0, 0.1, 0.085, 6, Math.PI / 6);
  // Drum: reads as a big disc from above and carries the gun's silhouette.
  k.dark().prismY(-0.14, 0.15, 0.14, -0.3, 0.3, 0.3, 8, Math.PI / 8);
  k.accent().prismY(0.15, 0.175, 0.14, -0.3, 0.14, 0.14, 8, Math.PI / 8);
  k.metal().box(0.14, 0.17, -0.3, 0.42, 0.03, 0.06);
  k.metal().box(0.14, 0.17, -0.3, 0.06, 0.03, 0.42);
  k.body().extrude([[-0.34, 0.24], [-0.34, 0.0], [-0.62, -0.1], [-0.98, -0.12], [-0.98, 0.16], [-0.62, 0.24]], -0.13, 0.13);
  k.grip().box(-1.01, 0.03, 0, 0.08, 0.34, 0.3, 0.02);
  k.dark().extrude([[0.04, 0.3], [0.5, 0.3], [0.48, 0.38], [0.12, 0.42]], -0.05, 0.05);    // Carry handle.
  k.accent().box(0.28, 0.41, 0, 0.14, 0.03, 0.07);
  k.metal(); b.box(1.18, -0.07, -0.08, 0.05, 0.26, 0.04); b.box(1.18, -0.07, 0.08, 0.05, 0.26, 0.04);   // Bipod.
  b.box(1.18, -0.21, 0, 0.09, 0.03, 0.26);
  pistolGrip(k, -0.05, 0.34, 0.15);
  return { geometry: b.build(), muzzle: [1.64, 0.13, 0], fore: [0.82, -0.01, 0], eject: [0.2, 0.28, 0.14], length: 2.6 };
}

// Sniper: extremely long and thin, massive top scope, T-shaped muzzle brake, skeleton stock.
function sniper() {
  const k = kit(), b = k.b;
  k.body().extrude([[-0.28, 0.02], [0.52, 0.02], [0.62, 0.08], [0.62, 0.17], [0.46, 0.23], [-0.2, 0.23], [-0.28, 0.15]], -0.12, 0.12);
  k.body2().prismX(0.62, 1.14, 0.12, 0, 0.13, 0.08, 6, Math.PI / 6);
  k.metal().prismX(1.14, 1.96, 0.12, 0, 0.05, 0.045, 6);
  k.dark().box(2.05, 0.12, 0, 0.16, 0.09, 0.42, 0.02);                     // T brake.
  k.metal().box(2.05, 0.12, -0.21, 0.08, 0.13, 0.05);
  k.metal().box(2.05, 0.12, 0.21, 0.08, 0.13, 0.05);
  // Skeleton stock: an open rear frame rather than a solid wedge.
  k.body().extrude([
    [-0.28, 0.19], [-0.28, 0.04], [-0.56, -0.08], [-1.0, -0.12], [-1.0, 0.16], [-0.56, 0.19],
    [-0.56, 0.11], [-0.9, 0.08], [-0.9, -0.03], [-0.56, 0.0],
  ], -0.085, 0.085);
  k.grip().box(-1.03, 0.02, 0, 0.07, 0.32, 0.2, 0.02);
  // Scope: longer and fatter than feels reasonable, front lens glows.
  k.dark().prismX(-0.12, 0.72, 0.36, 0, 0.1, 0.1, 8, Math.PI / 8);
  k.dark().prismX(0.5, 0.74, 0.36, 0, 0.1, 0.16, 8, Math.PI / 8);
  k.dark().prismX(-0.26, -0.1, 0.36, 0, 0.14, 0.1, 8, Math.PI / 8);
  k.accent().prismX(0.74, 0.755, 0.36, 0, 0.13, 0.13, 8, Math.PI / 8);
  k.metal().box(0.14, 0.26, 0, 0.1, 0.1, 0.1);
  k.metal().box(0.42, 0.26, 0, 0.1, 0.1, 0.1);
  k.accent().box(0.3, 0.05, 0.095, 0.25, 0.04, 0.02);
  k.metal().box(0.08, 0.17, 0.12, 0.1, 0.04, 0.1);                          // Bolt handle.
  k.dark().extrude([[0.08, 0.02], [0.3, 0.02], [0.3, -0.3], [0.14, -0.3]], -0.06, 0.06);
  pistolGrip(k, -0.02, 0.3, 0.11);
  return { geometry: b.build(), muzzle: [2.14, 0.12, 0], fore: [0.8, 0.03, 0], eject: [0.06, 0.24, 0.1], length: 3.25 };
}

// Pistol: a hand cannon. Comically thick slide, stepped compensator, oversized grip.
function pistol() {
  const k = kit(), b = k.b;
  k.body().extrude([[-0.2, 0.06], [0.52, 0.06], [0.56, 0.1], [0.56, 0.24], [0.4, 0.28], [-0.16, 0.28], [-0.2, 0.22]], -0.1, 0.1);
  k.dark().box(0.17, 0.02, 0, 0.74, 0.1, 0.16, 0.02);                      // Frame.
  k.metal().prismX(0.56, 0.66, 0.16, 0, 0.1, 0.1, 6);
  k.metal().box(0.72, 0.16, 0, 0.14, 0.24, 0.24, 0.03);
  k.dark().box(0.72, 0.16, 0, 0.05, 0.26, 0.28);
  k.accent().box(0.12, 0.29, 0, 0.32, 0.025, 0.08);
  k.dark(); for (let i = 0; i < 3; i++) b.box(-0.12 + i * 0.07, 0.2, 0, 0.03, 0.09, 0.22);  // Serrations.
  pistolGrip(k, -0.02, 0.4, 0.16);
  k.dark().box(-0.04, -0.42, 0, 0.26, 0.05, 0.19);
  return { geometry: b.build(), muzzle: [0.82, 0.16, 0], fore: [-0.1, -0.2, -0.05], eject: [0.1, 0.3, 0.1], length: 1.1 };
}

const FACTORIES = { ar, smg, shotgun, lmg, sniper, pistol };

// Built once; the geometry is shared by every instance in every renderer.
const cache = new Map();

// { geometry, muzzle:[x,y,z], fore:[x,y,z], eject:[x,y,z], length }
export function getGun(id) {
  let g = cache.get(id);
  if (!g) {
    const make = FACTORIES[id] || FACTORIES.ar;
    g = make();
    g.geometry.computeBoundingBox();
    g.geometry.computeBoundingSphere();
    cache.set(id, g);
  }
  return g;
}
