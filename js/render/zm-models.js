// Graveyard Shift's undead, one low-poly model per kind (ROADMAP item 50, docs/ZOMBIES.md "Bodies"). Every kind is
// twelve rigid bones built from the MeshBuilder's boxes and prisms; js/render/zm-bodies.js poses the bones on the CPU
// and the GPU reads them from one float texture, so a kind costs one draw call however many of it are up.
//
// Bone space: forward +X, up +Y, right +Z (the operators' convention). The pelvis sits at the hip joint, the chest
// rises from the waist, the head from the neck; arms and legs hang down -Y from their joint, so a pitch (a turn about
// Z) swings them forward. aPart packs the bone (0..11), a glow mode x16 (1 eyes, 2 a slow pulse, 3 a flicker) and x64
// a "fine" flag: details only the nearest few undead keep (the distance LOD collapses them in the vertex shader).
import * as THREE from 'three';
import { MeshBuilder } from './meshbuild.js';

export const PEL = 0, CH = 1, HD = 2, UAL = 3, FAL = 4, UAR = 5, FAR = 6, THL = 7, SHL = 8, THR = 9, SHR = 10, EX = 11;
export const NB = 12;

const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

class Kit {
  constructor() { this.b = new MeshBuilder(); this.fine = false; }
  at(bone, col, glow = 0) { this.b.setPart(bone + glow * 16 + (this.fine ? 64 : 0)).setColor(col); return this; }
  // Everything drawn inside fn is a detail the distance LOD drops.
  detail(fn) { const f = this.fine; this.fine = true; fn(); this.fine = f; return this; }
  box(cx, cy, cz, sx, sy, sz, ch = 0) { this.b.box(cx, cy, cz, sx, sy, sz, ch); return this; }
  // A limb hanging down -Y from (x, y0, z): length, radius at the joint, radius at the far end.
  limb(len, r0, r1, sides = 5, y0 = 0, x = 0, z = 0) { this.b.prismY(y0 - len, y0, x, z, r1, r0, sides); return this; }
  prismY(...a) { this.b.prismY(...a); return this; }
  prismX(...a) { this.b.prismX(...a); return this; }
  prismZ(...a) { this.b.prismZ(...a); return this; }
  // A round bulb along Y: rings of [y, radius] (radius 0 is allowed at the ends).
  bulb(cx, cz, rings, sides = 7, sx = 1, sz = 1) {
    this.b.loft(rings.map(([y, r]) => {
      const out = [];
      for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; out.push([cx + Math.cos(a) * Math.max(r, 0.004) * sx, y, cz + Math.sin(a) * Math.max(r, 0.004) * sz]); }
      return out;
    }));
    return this;
  }
  // Draw fn turned by (rx, ry, rz) about the point (px, py, pz).
  turn(px, py, pz, rx, ry, rz, fn) {
    const old = this.b.matrix;
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _v.set(px, py, pz);
    const m = new THREE.Matrix4().compose(_v, _q, _s).multiply(new THREE.Matrix4().makeTranslation(-px, -py, -pz));
    this.b.matrix = old ? old.clone().multiply(m) : m;
    fn();
    this.b.matrix = old;
    return this;
  }
  build() { return this.b.build(); }
}

const shade = (hex, k) => {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k)), g = Math.min(255, Math.round(((hex >> 8) & 255) * k)), b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
};

const BONE = 0xd2cbb0, ICHOR = 0x1d2418, MOUTH = 0x260e0c, TEETH = 0xc9c09a, RUST = 0x6e3c22, IRON = 0x3c3e42;

// A skull on the neck joint: cranium, brow, sunken sockets with the eyes glowing in them, a slack jaw.
function skull(k, o) {
  const { skin, eye, w = 0.2, h = 0.23, d = 0.22, x = 0.02, jaw = 0.5, y = 0.02 } = o;
  const dark = shade(skin, 0.68);
  k.at(HD, skin).box(x, y + h * 0.55, 0, d, h * 0.78, w, 0.035);                              // Cranium.
  k.at(HD, dark).box(x + d * 0.42, y + h * 0.66, 0, 0.06, 0.045, w * 0.94);                    // Brow ridge.
  k.at(HD, 0x101208).box(x + d * 0.47, y + h * 0.5, -w * 0.24, 0.03, 0.06, w * 0.3);        // Sockets.
  k.at(HD, 0x101208).box(x + d * 0.47, y + h * 0.5, w * 0.24, 0.03, 0.06, w * 0.3);
  k.at(HD, eye, 1).box(x + d * 0.5, y + h * 0.5, -w * 0.24, 0.03, 0.035, w * 0.2);           // The eyes.
  k.at(HD, eye, 1).box(x + d * 0.5, y + h * 0.5, w * 0.24, 0.03, 0.035, w * 0.2);
  k.at(HD, dark).box(x + d * 0.22, y + h * 0.12 - jaw * 0.03, 0, d * 0.62, 0.065, w * 0.78); // Jaw, hanging.
  k.at(HD, MOUTH).box(x + d * 0.45, y + h * 0.24 - jaw * 0.02, 0, 0.04, 0.03 + jaw * 0.05, w * 0.56);
  k.detail(() => k.at(HD, TEETH).box(x + d * 0.47, y + h * 0.31, 0, 0.03, 0.018, w * 0.5));
}
// A clawed hand at the end of a forearm of length len: palm and three hooked fingers.
function claw(k, bone, len, skin, size = 1, nail = BONE) {
  k.at(bone, skin).box(0.01, -len - 0.04 * size, 0, 0.07 * size, 0.08 * size, 0.08 * size);
  k.detail(() => {
    for (const z of [-0.025, 0, 0.025]) {
      k.turn(0.03 * size, -len - 0.08 * size, z * size, 0, 0, 0.5, () => k.at(bone, nail).box(0.03 * size, -len - 0.12 * size, z * size, 0.022 * size, 0.08 * size, 0.018 * size));
    }
  });
}
// A torn flap of cloth hanging from (x, y, z), turned a little.
function flap(k, bone, col, x, y, z, len, wide, turn = 0) {
  k.turn(x, y, z, turn * 0.6, 0, turn, () => k.at(bone, col).box(x, y - len / 2, z, 0.02, len, wide));
}
function foot(k, bone, sh, col, len = 0.22) { k.at(bone, col).box(0.05, -sh - 0.015, 0, len, 0.06, 0.1); }

// ---------------------------------------------------------------------------------------------------------------
// Kinds. dims: hip (pelvis height), waist (pelvis to chest), chest (chest height to the shoulders), neck, shW
// (shoulder half-width), hipW, ua / fa (upper / fore arm), th / sh (thigh / shin), s (overall scale), headX (the head
// set forward of the chest), ex (the extra bone: its parent and offset). gait: stride (m a full cycle), the pose's
// character (see zm-bodies.js pose()).

const SHAMBLER = {
  dims: { hip: 0.85, waist: 0.1, chest: 0.5, neck: 0.05, shW: 0.2, hipW: 0.1, ua: 0.29, fa: 0.3, th: 0.41, sh: 0.41, s: 1.08, headX: 0.04 },
  gait: { stride: 1.15, swing: 0.45, knee: 0.75, hunch: 0.62, lurch: 0.16, limp: 0.55, bob: 0.05, reach: 1, headTilt: 0.32, twitch: 1 },
  eye: 0xd8ff6a,
  build(k) {
    const skin = 0x7d9468, shirt = 0x5c5446, shirtD = 0x433d33, pants = 0x37342c;
    k.at(PEL, pants).box(0, 0, 0, 0.22, 0.2, 0.3);
    k.detail(() => k.at(PEL, 0x2a2118).box(0.0, 0.08, 0, 0.23, 0.04, 0.31));
    // Torso: a dirty shirt torn open down the left side, ribs showing; a hump between the shoulders.
    k.at(CH, shirt).box(0, 0.14, 0.03, 0.2, 0.3, 0.26).box(0, 0.37, 0, 0.24, 0.24, 0.4, 0.03);
    k.at(CH, skin).box(0.01, 0.17, -0.12, 0.17, 0.3, 0.1);
    k.at(CH, shirtD).box(-0.09, 0.42, 0, 0.14, 0.14, 0.3);
    k.detail(() => {
      for (let i = 0; i < 4; i++) k.at(CH, BONE).box(0.09, 0.1 + i * 0.065, -0.12, 0.025, 0.022, 0.1);
      flap(k, CH, shirt, 0.09, 0.0, 0.08, 0.16, 0.1, 0.2); flap(k, CH, shirtD, 0.07, 0.0, -0.02, 0.1, 0.07, -0.25);
      flap(k, CH, shirt, -0.1, 0.0, 0.06, 0.2, 0.12, -0.15); flap(k, CH, shirtD, -0.1, 0.02, -0.08, 0.13, 0.08, 0.3);
    });
    k.at(CH, skin).prismY(0.46, 0.56, 0.04, 0, 0.06, 0.05, 5);
    skull(k, { skin, eye: this.eye, jaw: 0.7 });
    k.detail(() => { k.at(HD, 0x2b2a22).box(-0.05, 0.25, 0.04, 0.12, 0.04, 0.1).box(-0.07, 0.17, -0.09, 0.08, 0.1, 0.04); });
    // Left arm in its sleeve; the right sleeve torn away, the arm bare and thin.
    k.at(UAL, shirt).limb(0.29, 0.065, 0.055);
    k.at(FAL, skin).limb(0.3, 0.048, 0.04); claw(k, FAL, 0.3, skin);
    k.at(UAR, skin).limb(0.29, 0.05, 0.042);
    k.detail(() => k.at(UAR, shirtD).limb(0.07, 0.07, 0.065, 5));
    k.at(FAR, skin).limb(0.3, 0.045, 0.038); claw(k, FAR, 0.3, skin);
    k.at(THL, pants).limb(0.41, 0.09, 0.07);
    k.at(SHL, pants).limb(0.25, 0.068, 0.06); k.at(SHL, skin).limb(0.16, 0.045, 0.04, 5, -0.25); foot(k, SHL, 0.41, shade(skin, 0.8));
    k.at(THR, pants).limb(0.41, 0.09, 0.07);
    k.at(SHR, pants).limb(0.41, 0.068, 0.058); foot(k, SHR, 0.41, 0x2a2622, 0.24);
    k.detail(() => flap(k, SHL, pants, 0.03, -0.25, 0.03, 0.08, 0.06, 0.3));
  },
};

const RUNNER = {
  dims: { hip: 0.9, waist: 0.1, chest: 0.46, neck: 0.06, shW: 0.17, hipW: 0.085, ua: 0.3, fa: 0.31, th: 0.44, sh: 0.43, s: 1.05, headX: 0.06 },
  gait: { stride: 2.5, swing: 0.85, knee: 1.35, hunch: 0.38, lurch: 0.05, limp: 0, bob: 0.08, pump: 1, headTilt: 0.08, twitch: 0.4 },
  eye: 0xff5a2a,
  build(k) {
    const skin = 0x9aa886, top = 0x6a2c2a, jeans = 0x2c3240;
    k.at(PEL, jeans).box(0, 0, 0, 0.18, 0.18, 0.26);
    // Lean: a ragged vest over bare ribs, the spine showing at the back.
    k.at(CH, skin).box(0, 0.16, 0, 0.15, 0.32, 0.22).box(0, 0.37, 0, 0.18, 0.18, 0.32, 0.03);
    k.at(CH, top).box(0.005, 0.3, 0, 0.19, 0.22, 0.33).box(-0.005, 0.12, 0.06, 0.16, 0.16, 0.12);
    k.detail(() => {
      for (let i = 0; i < 3; i++) k.at(CH, BONE).box(0.075, 0.06 + i * 0.05, -0.05, 0.02, 0.018, 0.1);
      for (let i = 0; i < 4; i++) k.at(CH, BONE).box(-0.085, 0.08 + i * 0.08, 0, 0.03, 0.04, 0.04);
      flap(k, CH, top, -0.06, 0.2, 0.12, 0.12, 0.06, -0.3);
    });
    k.at(CH, skin).prismY(0.44, 0.54, 0.05, 0, 0.05, 0.045, 5);
    skull(k, { skin, eye: this.eye, w: 0.18, jaw: 1 });
    k.detail(() => { for (const z of [-0.05, 0.02, 0.07]) k.turn(-0.06, 0.22, z, 0, 0, 0.9, () => k.at(HD, 0x1a1814).box(-0.14, 0.22, z, 0.2, 0.03, 0.035)); });
    for (const [u, f] of [[UAL, FAL], [UAR, FAR]]) {
      k.at(u, skin).limb(0.3, 0.045, 0.038);
      k.at(f, skin).limb(0.31, 0.04, 0.032); claw(k, f, 0.31, skin, 1.1);
    }
    k.at(THL, jeans).limb(0.44, 0.075, 0.058); k.at(THR, jeans).limb(0.44, 0.075, 0.058);
    k.at(SHL, jeans).limb(0.2, 0.056, 0.05); k.at(SHL, skin).limb(0.23, 0.04, 0.035, 5, -0.2); foot(k, SHL, 0.43, 0x8a8a84, 0.23);
    k.at(SHR, jeans).limb(0.43, 0.056, 0.048); foot(k, SHR, 0.43, 0x8a8a84, 0.23);
  },
};

const BRUTE = {
  dims: { hip: 0.8, waist: 0.12, chest: 0.6, neck: 0, shW: 0.33, hipW: 0.14, ua: 0.37, fa: 0.44, th: 0.38, sh: 0.38, s: 1.3, headX: 0.12, headY: -0.08 },
  gait: { stride: 1.7, swing: 0.4, knee: 0.6, hunch: 0.62, lurch: 0.12, limp: 0, bob: 0.07, heavy: 1, headTilt: 0, twitch: 0.2 },
  eye: 0xff8a2a,
  build(k) {
    const skin = 0x5f7a52, dark = shade(skin, 0.7), alls = 0x3c3a32;
    k.at(PEL, alls).box(0, 0, 0, 0.3, 0.24, 0.42, 0.03);
    // A barrel chest under torn overalls, a hump of a back with the spine ridged along it.
    k.at(CH, skin).box(0.02, 0.33, 0, 0.44, 0.48, 0.62, 0.08).box(0, 0.08, 0, 0.32, 0.2, 0.42);
    k.at(CH, dark).box(-0.13, 0.5, 0, 0.24, 0.22, 0.46, 0.05);
    k.at(CH, alls).box(0.01, 0.12, 0, 0.36, 0.22, 0.46).box(0.18, 0.3, -0.13, 0.12, 0.3, 0.08).box(0.18, 0.3, 0.13, 0.12, 0.3, 0.08);
    k.detail(() => {
      for (let i = 0; i < 4; i++) k.at(CH, BONE).box(-0.25, 0.3 + i * 0.08, 0, 0.05, 0.04, 0.06);
      k.at(CH, 0x1c1a16).box(0.23, 0.26, 0, 0.02, 0.06, 0.4);
      k.at(CH, dark).box(0.24, 0.42, 0.1, 0.02, 0.12, 0.1);
    });
    skull(k, { skin, eye: this.eye, w: 0.19, h: 0.2, d: 0.2, jaw: 0.6 });
    for (const [u, f, z] of [[UAL, FAL, -1], [UAR, FAR, 1]]) {
      k.at(u, skin).limb(0.37, 0.13, 0.1, 6);
      k.at(u, dark).box(0, -0.02, z * 0.03, 0.22, 0.12, 0.2, 0.03);
      k.at(f, skin).limb(0.44, 0.11, 0.14, 6);
      k.at(f, dark).box(0.02, -0.5, 0, 0.18, 0.15, 0.17, 0.03);                        // Fists like rocks.
      k.detail(() => { k.at(f, IRON).prismY(-0.2, -0.13, 0, 0, 0.145, 0.145, 6); k.at(f, IRON).box(0.0, -0.26, z * 0.13, 0.03, 0.12, 0.03); });
    }
    k.at(THL, alls).limb(0.38, 0.14, 0.12, 6); k.at(THR, alls).limb(0.38, 0.14, 0.12, 6);
    k.at(SHL, alls).limb(0.38, 0.12, 0.1, 6); foot(k, SHL, 0.38, 0x23201c, 0.28);
    k.at(SHR, alls).limb(0.38, 0.12, 0.1, 6); foot(k, SHR, 0.38, 0x23201c, 0.28);
  },
};

const CRAWLER = {
  dims: { hip: 0.42, waist: 0.04, chest: 0.42, neck: 0.04, shW: 0.17, hipW: 0.09, ua: 0.3, fa: 0.33, th: 0.15, sh: 0.1, s: 1.0, headX: 0.04, ex: { parent: PEL, at: [0, -0.02, 0] } },
  gait: { stride: 1.3, crawl: 1, headTilt: 0.1, twitch: 0.6 },
  eye: 0xcfe8ff,
  build(k) {
    const skin = 0x4f5a44, rag = 0x2a2724;
    // No legs: a torso torn off at the waist, dragging what is left of its spine and its rags.
    k.at(PEL, rag).box(0, 0.02, 0, 0.16, 0.12, 0.26);
    k.at(CH, skin).box(0, 0.2, 0, 0.17, 0.42, 0.28, 0.03);
    k.at(CH, rag).box(0.005, 0.12, 0, 0.18, 0.2, 0.29);
    k.detail(() => { for (let i = 0; i < 4; i++) k.at(CH, BONE).box(-0.09, 0.08 + i * 0.08, 0, 0.03, 0.04, 0.05); flap(k, CH, rag, 0.0, 0.0, 0.1, 0.1, 0.08, 0.4); });
    k.at(CH, skin).prismY(0.4, 0.5, 0.04, 0, 0.05, 0.045, 5);
    skull(k, { skin, eye: this.eye, w: 0.18, h: 0.21, jaw: 1 });
    k.detail(() => k.at(HD, 0x14130f).box(-0.06, 0.2, 0, 0.14, 0.05, 0.2).box(-0.12, 0.08, 0, 0.04, 0.16, 0.16));
    for (const [u, f] of [[UAL, FAL], [UAR, FAR]]) {
      k.at(u, skin).limb(0.3, 0.05, 0.042);
      k.at(f, skin).limb(0.33, 0.042, 0.036); claw(k, f, 0.33, skin, 1.25);
    }
    // Leg stumps; the shins carry nothing.
    k.at(THL, rag).limb(0.15, 0.07, 0.06); k.at(THR, rag).limb(0.12, 0.07, 0.06);
    k.at(THL, ICHOR).limb(0.02, 0.06, 0.055, 5, -0.15); k.at(THR, ICHOR).limb(0.02, 0.06, 0.055, 5, -0.12);
    // The trailing spine and gut: dark ichor and bone, hanging from the waist (the pose lays it out behind).
    k.at(EX, BONE).prismY(-0.42, 0.0, 0, 0, 0.025, 0.035, 5);
    k.at(EX, ICHOR).box(0.03, -0.18, 0.05, 0.05, 0.22, 0.08).box(0.03, -0.32, -0.04, 0.04, 0.18, 0.07);
  },
};

const SPITTER = {
  dims: { hip: 0.95, waist: 0.1, chest: 0.48, neck: 0.15, shW: 0.16, hipW: 0.085, ua: 0.27, fa: 0.28, th: 0.46, sh: 0.46, s: 1.06, headX: 0.08, ex: { parent: HD, at: [0.07, 0.02, 0] } },
  gait: { stride: 1.2, swing: 0.4, knee: 0.7, hunch: 0.55, lurch: 0.1, limp: 0.2, bob: 0.04, reach: 0, headTilt: 0.12, twitch: 0.7, spit: 1 },
  eye: 0xb8ff3a,
  build(k) {
    const skin = 0x9ea862, gown = 0x8aa49a, gownD = 0x5f786c, acid = 0x9cff3a;
    k.at(PEL, gownD).box(0, 0, 0, 0.17, 0.18, 0.24);
    k.at(PEL, gown).bulb(0, 0, [[-0.42, 0.15], [-0.1, 0.13], [0.08, 0.11]], 6, 1.05, 1.25);
    k.detail(() => { for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; k.at(PEL, gownD).box(Math.cos(a) * 0.14, -0.47, Math.sin(a) * 0.17, 0.05, 0.1, 0.07); } });
    // Tall and thin in a hospital gown hanging open at the back; a long neck.
    k.at(CH, gown).box(0, 0.24, 0, 0.17, 0.48, 0.28, 0.03);
    k.at(CH, skin).box(-0.07, 0.3, 0, 0.06, 0.36, 0.18);
    k.detail(() => { flap(k, CH, gown, 0.06, 0.0, 0.07, 0.24, 0.12, 0.15); flap(k, CH, gownD, -0.06, 0.0, -0.06, 0.28, 0.12, -0.2); flap(k, CH, gown, 0.05, 0.0, -0.08, 0.18, 0.1, 0.25); });
    k.at(CH, skin).prismY(0.44, 0.65, 0.05, 0, 0.05, 0.042, 5);
    skull(k, { skin, eye: this.eye, w: 0.17, h: 0.22, d: 0.21, jaw: 1 });
    k.detail(() => k.at(HD, acid, 2).box(0.13, 0.03, 0, 0.02, 0.07, 0.03));
    // The throat sac (its own bone, so it swells): a bulb under the jaw, veined in glowing acid.
    k.at(EX, 0x8a9a3a).bulb(0.02, 0, [[-0.24, 0.0], [-0.2, 0.1], [-0.12, 0.16], [-0.03, 0.15], [0.03, 0.08], [0.05, 0.0]], 8, 1.1, 1.05);
    k.at(EX, acid, 2).box(0.1, -0.09, 0, 0.04, 0.12, 0.03).box(0.08, -0.1, 0.07, 0.04, 0.09, 0.025).box(0.08, -0.1, -0.07, 0.04, 0.09, 0.025);
    k.detail(() => k.at(EX, acid, 2).box(0.0, -0.18, 0.0, 0.08, 0.03, 0.08));
    for (const [u, f] of [[UAL, FAL], [UAR, FAR]]) {
      k.at(u, skin).limb(0.27, 0.042, 0.036);
      k.at(f, skin).limb(0.28, 0.036, 0.03); claw(k, f, 0.28, skin, 0.9);
    }
    k.at(THL, skin).limb(0.46, 0.065, 0.05); k.at(THR, skin).limb(0.46, 0.065, 0.05);
    k.at(SHL, skin).limb(0.46, 0.05, 0.04); foot(k, SHL, 0.46, shade(skin, 0.7), 0.2);
    k.at(SHR, skin).limb(0.46, 0.05, 0.04); foot(k, SHR, 0.46, shade(skin, 0.7), 0.2);
  },
};

const BLOATER = {
  dims: { hip: 0.62, waist: 0.08, chest: 0.5, neck: 0.02, shW: 0.3, hipW: 0.16, ua: 0.22, fa: 0.22, th: 0.3, sh: 0.29, s: 1.18, headX: 0.04, ex: { parent: CH, at: [0.1, 0.18, 0] } },
  gait: { stride: 0.9, swing: 0.32, knee: 0.4, hunch: -0.05, lurch: 0.22, limp: 0, bob: 0.04, waddle: 1, headTilt: 0.15, twitch: 0.3 },
  eye: 0xffc04a,
  build(k) {
    const skin = 0xa18aa6, dark = shade(skin, 0.72), strap = 0x3a2a30, pus = 0xffb040;
    k.at(PEL, 0x4a3644).box(0, 0, 0, 0.28, 0.24, 0.44, 0.03);
    k.at(CH, dark).box(-0.06, 0.28, 0, 0.36, 0.5, 0.6, 0.06);
    skull(k, { skin, eye: this.eye, w: 0.16, h: 0.19, d: 0.18, jaw: 0.3 });
    // The belly, swollen past the clothes (its own bone: it breathes, and swells before it bursts), strapped with
    // the belts it split and studded with glowing pustules.
    k.at(EX, skin).bulb(0, 0, [[-0.36, 0.0], [-0.3, 0.26], [-0.14, 0.42], [0.06, 0.45], [0.24, 0.36], [0.36, 0.18], [0.4, 0.0]], 9, 1.05, 1.1);
    k.at(EX, strap).turn(0, 0, 0, 0.3, 0, 0, () => k.prismY(-0.04, 0.02, 0, 0, 0.475, 0.47, 9));
    k.detail(() => k.at(EX, strap).turn(0, 0, 0, -0.35, 0, 0.2, () => k.prismY(-0.18, -0.13, 0, 0, 0.44, 0.43, 9)));
    const spots = [[0.43, 0.1, 0.1], [0.38, -0.12, -0.2], [0.3, 0.22, -0.26], [0.2, -0.05, 0.4], [0.42, -0.02, -0.02], [0.05, 0.25, -0.4], [0.28, 0.15, 0.3], [-0.1, -0.2, 0.42]];
    for (const [x, y, z] of spots) {
      k.at(EX, pus, 2).box(x, y, z, 0.07, 0.08, 0.08, 0.02);
    }
    k.detail(() => { for (const [x, y, z] of spots.slice(0, 5)) k.at(EX, shade(skin, 1.15)).box(x - 0.025, y, z, 0.06, 0.11, 0.11); });
    for (const [u, f] of [[UAL, FAL], [UAR, FAR]]) {
      k.at(u, skin).limb(0.22, 0.08, 0.065);
      k.at(f, skin).limb(0.22, 0.06, 0.05); claw(k, f, 0.22, skin, 1.1);
    }
    k.at(THL, 0x4a3644).limb(0.3, 0.12, 0.1, 6); k.at(THR, 0x4a3644).limb(0.3, 0.12, 0.1, 6);
    k.at(SHL, skin).limb(0.29, 0.09, 0.075); foot(k, SHL, 0.29, dark, 0.22);
    k.at(SHR, skin).limb(0.29, 0.09, 0.075); foot(k, SHR, 0.29, dark, 0.22);
  },
};

const SHIELD = {
  dims: { hip: 0.88, waist: 0.1, chest: 0.55, neck: 0.04, shW: 0.24, hipW: 0.11, ua: 0.31, fa: 0.31, th: 0.43, sh: 0.42, s: 1.12, headX: 0.04, ex: { parent: CH, at: [0.42, 0.2, -0.04] } },
  gait: { stride: 1.35, swing: 0.4, knee: 0.7, hunch: 0.32, lurch: 0.1, limp: 0.25, bob: 0.05, shield: 1, headTilt: 0.05, twitch: 0.3 },
  eye: 0xff3a30,
  build(k) {
    const skin = 0x667a5a, coat = 0x3a4250, coatD = 0x2a303a, helm = 0x23262c;
    k.at(PEL, 0x2e3034).box(0, 0, 0, 0.24, 0.22, 0.36);
    k.at(CH, coat).box(0, 0.16, 0, 0.24, 0.32, 0.36).box(0, 0.4, 0, 0.28, 0.26, 0.48, 0.04);
    k.at(CH, coatD).box(0, 0.5, -0.24, 0.24, 0.1, 0.14).box(0, 0.5, 0.24, 0.24, 0.1, 0.14);          // Shoulder pads.
    k.detail(() => { k.at(CH, 0x8a8a40).box(0.145, 0.35, 0.13, 0.01, 0.06, 0.08); flap(k, CH, coat, 0.1, 0.0, 0.1, 0.16, 0.12, 0.2); k.at(CH, skin).box(0.12, 0.2, -0.1, 0.03, 0.12, 0.1); });
    k.at(CH, skin).prismY(0.5, 0.6, 0.03, 0, 0.065, 0.06, 5);
    skull(k, { skin, eye: this.eye, w: 0.19, jaw: 0.4 });
    // A riot helmet: a dome with its visor cracked up, the eyes glowing red under it.
    k.at(HD, helm).prismY(0.15, 0.3, 0.0, 0, 0.15, 0.12, 8).box(0.0, 0.08, 0, 0.18, 0.14, 0.27);
    k.at(HD, 0x4a5868).turn(0.11, 0.26, 0, 0, 0, 0.6, () => k.box(0.15, 0.24, 0, 0.03, 0.1, 0.28));
    // The shield: a battered door off its hinges, held up in front, iron straps and a little window.
    const wood = 0x6b4a2e, woodD = 0x553a24;
    k.at(EX, wood).box(0, -0.1, -0.24, 0.06, 1.25, 0.25).box(0, -0.12, 0.24, 0.06, 1.22, 0.25);
    k.at(EX, woodD).box(0, -0.08, 0, 0.065, 1.28, 0.24);
    k.at(EX, IRON).box(0.035, 0.32, 0, 0.02, 0.07, 0.76).box(0.035, -0.5, 0, 0.02, 0.07, 0.76);
    k.detail(() => {
      k.at(EX, 0x0e1216).box(0.035, 0.12, 0.12, 0.012, 0.16, 0.2);
      k.at(EX, 0x9aa0a6).box(0.04, -0.12, -0.28, 0.02, 0.05, 0.05);
      for (const [y, z] of [[0.32, -0.32], [0.32, 0.32], [-0.5, -0.32], [-0.5, 0.32]]) k.at(EX, 0x7a7e84).box(0.05, y, z, 0.015, 0.03, 0.03);
    });
    k.at(UAL, coat).limb(0.31, 0.075, 0.065); k.at(FAL, coat).limb(0.2, 0.06, 0.055); k.at(FAL, skin).limb(0.11, 0.045, 0.04, 5, -0.2); claw(k, FAL, 0.31, skin);
    k.at(UAR, coat).limb(0.31, 0.075, 0.065); k.at(FAR, skin).limb(0.31, 0.048, 0.04); claw(k, FAR, 0.31, skin);
    k.at(THL, 0x2e3034).limb(0.43, 0.095, 0.075); k.at(THR, 0x2e3034).limb(0.43, 0.095, 0.075);
    k.at(SHL, 0x2e3034).limb(0.42, 0.072, 0.06); k.at(SHL, 0x1a1c20).box(0.07, -0.06, 0, 0.06, 0.12, 0.1); foot(k, SHL, 0.42, 0x18181a, 0.25);
    k.at(SHR, 0x2e3034).limb(0.42, 0.072, 0.06); k.at(SHR, 0x1a1c20).box(0.07, -0.06, 0, 0.06, 0.12, 0.1); foot(k, SHR, 0.42, 0x18181a, 0.25);
  },
};

// The round boss: the Yardmaster. A railway foreman grown huge: rusted plates bolted to its shoulders, a signal
// lantern burning on its back, a coupling spike for a right hand.
const YARDMASTER = {
  dims: { hip: 0.82, waist: 0.12, chest: 0.62, neck: 0, shW: 0.36, hipW: 0.15, ua: 0.38, fa: 0.42, th: 0.39, sh: 0.39, s: 1.65, headX: 0.13, headY: -0.06 },
  gait: { stride: 1.9, swing: 0.36, knee: 0.55, hunch: 0.42, lurch: 0.12, limp: 0.3, bob: 0.06, heavy: 1, headTilt: 0, twitch: 0.1, boss: 1 },
  eye: 0xff7a1a,
  build(k) {
    const skin = 0x4d6a44, dark = shade(skin, 0.7), alls = 0x2e2a26;
    k.at(PEL, alls).box(0, 0, 0, 0.32, 0.26, 0.46, 0.03);
    k.at(CH, skin).box(0.02, 0.34, 0, 0.46, 0.5, 0.66, 0.08).box(0, 0.08, 0, 0.34, 0.22, 0.46);
    k.at(CH, alls).box(0.01, 0.14, 0, 0.38, 0.26, 0.5).box(0.2, 0.32, -0.15, 0.12, 0.34, 0.09).box(0.2, 0.32, 0.15, 0.12, 0.34, 0.09);
    // Shoulder plates, rust and rivets.
    for (const z of [-1, 1]) {
      k.turn(0, 0.6, z * 0.33, -z * 0.35, 0, 0, () => k.at(CH, RUST).box(0, 0.62, z * 0.33, 0.42, 0.08, 0.32, 0.03));
      k.detail(() => { for (const x of [-0.12, 0.12]) k.at(CH, IRON).box(x, 0.68, z * 0.36, 0.04, 0.03, 0.04); });
    }
    // The signal lantern on its back, burning.
    k.at(CH, IRON).box(-0.33, 0.52, 0, 0.18, 0.3, 0.2).prismY(0.67, 0.73, -0.33, 0, 0.1, 0.06, 6);
    k.at(CH, 0xffa040, 3).box(-0.33, 0.52, 0, 0.2, 0.18, 0.14);
    k.detail(() => { k.at(CH, 0x1a1816).box(0.24, 0.25, 0, 0.02, 0.05, 0.5); for (let i = 0; i < 5; i++) k.at(CH, IRON).turn(0, 0.3, 0, 0.5, 0, 0, () => k.box(0.24 - i * 0.11, 0.26, 0.34, 0.06, 0.05, 0.04)); });
    skull(k, { skin, eye: this.eye, w: 0.21, h: 0.22, d: 0.22, jaw: 0.8 });
    k.at(HD, 0x1c1c22).box(0.0, 0.25, 0, 0.24, 0.07, 0.24).box(0.12, 0.215, 0, 0.12, 0.02, 0.22);     // A foreman's cap.
    k.at(UAL, skin).limb(0.38, 0.14, 0.11, 6); k.at(FAL, skin).limb(0.42, 0.12, 0.14, 6); k.at(FAL, dark).box(0.02, -0.48, 0, 0.19, 0.16, 0.18, 0.03);
    k.at(UAR, skin).limb(0.38, 0.14, 0.11, 6); k.at(FAR, skin).limb(0.3, 0.12, 0.13, 6);
    // The coupling spike: an iron cuff and a long hooked spike where the hand was.
    k.at(FAR, IRON).prismY(-0.42, -0.26, 0, 0, 0.12, 0.15, 6);
    k.at(FAR, RUST).prismY(-0.86, -0.42, 0.04, 0, 0.02, 0.07, 5);
    k.at(FAR, RUST).turn(0.04, -0.86, 0, 0, 0, 1.2, () => k.prismY(-1.0, -0.84, 0.04, 0, 0.015, 0.035, 5));
    k.at(THL, alls).limb(0.39, 0.15, 0.13, 6); k.at(THR, alls).limb(0.39, 0.15, 0.13, 6);
    k.at(SHL, alls).limb(0.39, 0.13, 0.11, 6); foot(k, SHL, 0.39, 0x1c1a17, 0.3);
    k.at(SHR, alls).limb(0.39, 0.13, 0.11, 6); foot(k, SHR, 0.39, 0x1c1a17, 0.3);
  },
};

// The Gravewarden: a sexton in black, tall and gaunt, long white hair, a gravedigger's spade in one hand and a
// lantern burning violet in the other.
const WARDEN = {
  dims: { hip: 0.95, waist: 0.1, chest: 0.56, neck: 0.08, shW: 0.21, hipW: 0.1, ua: 0.34, fa: 0.36, th: 0.46, sh: 0.46, s: 1.7, headX: 0.06, ex: { parent: FAL, at: [0.04, -0.4, 0] } },
  gait: { stride: 1.6, swing: 0.25, knee: 0.4, hunch: 0.32, lurch: 0.05, limp: 0, bob: 0.03, glide: 1, headTilt: 0.18, twitch: 0.15, boss: 1, lantern: 1 },
  eye: 0xc080ff,
  build(k) {
    const skin = 0x6e6a86, robe = 0x1a1620, robeL = 0x2a2232, hair = 0xd8d4e0;
    // The robe hangs from the pelvis to the ankles (the legs barely show), ragged at the hem.
    k.at(PEL, robe).bulb(0, 0, [[-0.84, 0.3], [-0.4, 0.24], [0.0, 0.17], [0.08, 0.15]], 8, 1, 1.15);
    k.detail(() => { for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; k.at(PEL, robeL).box(Math.cos(a) * 0.27, -0.88, Math.sin(a) * 0.3, 0.07, 0.1, 0.12); } });
    k.at(CH, robe).box(0, 0.28, 0, 0.22, 0.56, 0.34, 0.04);
    k.at(CH, robeL).box(0.0, 0.5, 0, 0.28, 0.1, 0.46, 0.03);
    k.at(CH, 0x8a8494).box(0.115, 0.36, 0, 0.01, 0.3, 0.05);                                // A tarnished stole.
    k.at(CH, skin).prismY(0.52, 0.66, 0.04, 0, 0.05, 0.045, 5);
    skull(k, { skin, eye: this.eye, w: 0.18, h: 0.25, d: 0.2, jaw: 0.4 });
    k.at(HD, hair).box(-0.06, 0.24, 0, 0.16, 0.05, 0.21).box(-0.1, 0.06, 0, 0.05, 0.34, 0.2);
    k.detail(() => { k.at(HD, hair).box(0.0, 0.03, -0.1, 0.12, 0.28, 0.03).box(0.0, 0.03, 0.1, 0.12, 0.28, 0.03); });
    k.at(UAL, robe).limb(0.34, 0.07, 0.06); k.at(FAL, robe).limb(0.24, 0.07, 0.08); k.at(FAL, skin).limb(0.12, 0.04, 0.035, 5, -0.24); claw(k, FAL, 0.36, skin);
    k.at(UAR, robe).limb(0.34, 0.07, 0.06); k.at(FAR, robe).limb(0.24, 0.07, 0.08); k.at(FAR, skin).limb(0.12, 0.04, 0.035, 5, -0.24);
    // The spade, held in the right fist along the forearm's line.
    k.at(FAR, 0x4a3828).prismX(-0.5, 0.75, -0.38, 0, 0.022, 0.022, 5);
    k.at(FAR, 0x7a7e86).box(0.86, -0.38, 0, 0.24, 0.02, 0.18).box(0.74, -0.38, 0, 0.05, 0.05, 0.05);
    k.at(FAR, skin).box(0.0, -0.38, 0, 0.08, 0.08, 0.08);
    // The lantern on its chain.
    k.at(EX, IRON).prismY(0.0, 0.12, 0, 0, 0.008, 0.008, 4).box(0, -0.12, 0, 0.14, 0.02, 0.14).box(0, 0.0, 0, 0.12, 0.02, 0.12);
    k.at(EX, 0xc080ff, 3).box(0, -0.06, 0, 0.1, 0.1, 0.1);
    k.at(THL, robe).limb(0.46, 0.06, 0.05); k.at(THR, robe).limb(0.46, 0.06, 0.05);
    k.at(SHL, skin).limb(0.46, 0.04, 0.035); foot(k, SHL, 0.46, 0x15121a, 0.2);
    k.at(SHR, skin).limb(0.46, 0.04, 0.035); foot(k, SHR, 0.46, 0x15121a, 0.2);
  },
};

// The Listener (Polestar Relay): the tallest, thinnest thing on the ice, frost-white, in a parka with the hood up and
// no face, only a cyan slit; the station's radio on its back, its long whip aerial bending as it walks.
const LISTENER = {
  dims: { hip: 1.0, waist: 0.1, chest: 0.52, neck: 0.1, shW: 0.17, hipW: 0.09, ua: 0.42, fa: 0.46, th: 0.5, sh: 0.48, s: 1.8, headX: 0.05, ex: { parent: CH, at: [-0.2, 0.62, 0.08] } },
  gait: { stride: 2.1, swing: 0.32, knee: 0.9, hunch: 0.3, lurch: 0.04, limp: 0, bob: 0.04, stilt: 1, headTilt: 0.42, twitch: 0.5, boss: 1 },
  eye: 0x5af0ff,
  build(k) {
    const skin = 0xc8dce6, parka = 0x2e4a5a, parkaD = 0x1c2c38, fur = 0xe8f4ff, cyan = 0x5af0ff;
    k.at(PEL, parkaD).box(0, 0, 0, 0.18, 0.2, 0.26);
    k.at(CH, parka).box(0, 0.24, 0, 0.2, 0.5, 0.3, 0.04);
    k.detail(() => { k.at(CH, parkaD).box(0.105, 0.26, 0, 0.01, 0.44, 0.03); flap(k, CH, parka, 0.08, 0.0, 0.08, 0.16, 0.12, 0.15); flap(k, CH, parkaD, -0.06, 0.0, -0.07, 0.2, 0.14, -0.2); });
    // The radio pack: lights blinking cyan.
    k.at(CH, 0x283038).box(-0.17, 0.3, 0, 0.14, 0.34, 0.24, 0.02);
    k.at(CH, cyan, 2).box(-0.24, 0.38, -0.06, 0.02, 0.04, 0.04).box(-0.24, 0.3, 0.06, 0.02, 0.04, 0.04);
    k.detail(() => k.at(CH, cyan, 2).box(-0.24, 0.22, -0.02, 0.02, 0.03, 0.1));
    k.at(CH, skin).prismY(0.48, 0.64, 0.04, 0, 0.045, 0.04, 5);
    // The hood: deep, fur-rimmed; no face inside it but the slit.
    k.at(HD, parka).box(-0.01, 0.13, 0, 0.26, 0.3, 0.26, 0.05);
    k.at(HD, fur).box(0.12, 0.13, 0, 0.04, 0.3, 0.27, 0.02);
    k.at(HD, 0x05080a).box(0.135, 0.12, 0, 0.02, 0.22, 0.17);
    k.at(HD, cyan, 1).box(0.145, 0.15, 0, 0.02, 0.12, 0.03);
    // The aerial (its own bone: it whips as the Listener walks), a blinking tip.
    k.at(EX, 0x8a9aa4).prismY(0.0, 0.85, 0, 0, 0.012, 0.006, 4);
    k.at(EX, cyan, 3).box(0, 0.88, 0, 0.05, 0.05, 0.05);
    for (const [u, f] of [[UAL, FAL], [UAR, FAR]]) {
      k.at(u, parka).limb(0.42, 0.06, 0.05);
      k.at(f, parka).limb(0.26, 0.05, 0.055); k.at(f, fur).limb(0.04, 0.06, 0.06, 5, -0.24); k.at(f, skin).limb(0.2, 0.03, 0.026, 5, -0.26);
      claw(k, f, 0.46, skin, 1.5, 0xe8f4ff);
    }
    k.at(THL, parkaD).limb(0.5, 0.07, 0.055); k.at(THR, parkaD).limb(0.5, 0.07, 0.055);
    k.at(SHL, parkaD).limb(0.48, 0.055, 0.045); foot(k, SHL, 0.48, 0x101820, 0.24);
    k.at(SHR, parkaD).limb(0.48, 0.055, 0.045); foot(k, SHR, 0.48, 0x101820, 0.24);
  },
};

// The Barker (Wrenfield Fair's bell calls it): a showman gone wrong, tall and broad in a red tailcoat whose tails flap
// behind it, gold epaulettes, a peaked showman's cap, chalk face paint over grey skin, a shock of red hair, a brass
// speaking-trumpet in one fist; its trim burns fairground gold.
const BARKER = {
  dims: { hip: 0.96, waist: 0.1, chest: 0.58, neck: 0.06, shW: 0.25, hipW: 0.11, ua: 0.33, fa: 0.34, th: 0.47, sh: 0.46, s: 1.62, headX: 0.05, ex: { parent: PEL, at: [-0.12, 0.08, 0] } },
  gait: { stride: 1.8, swing: 0.5, knee: 0.75, hunch: 0.18, lurch: 0.08, limp: 0, bob: 0.06, strut: 1, headTilt: 0.12, twitch: 0.35, boss: 1 },
  eye: 0xffc040,
  build(k) {
    const coat = 0x8a1c22, coatD = 0x5e1216, gold = 0xffc040, skin = 0x8e8a84, paint = 0xe6e0d6, hair = 0xd83a2a, pants = 0x1a1418;
    k.at(PEL, pants).box(0, 0, 0, 0.24, 0.22, 0.34);
    k.at(CH, coat).box(0, 0.28, 0, 0.26, 0.56, 0.42, 0.04);
    k.at(CH, 0xe8e2d0).box(0.13, 0.36, 0, 0.02, 0.36, 0.14);                                 // Shirt front.
    k.at(CH, 0x14100e).box(0.14, 0.5, 0, 0.03, 0.05, 0.1);                                   // Bow tie.
    k.at(CH, gold, 2).box(0.135, 0.2, 0, 0.01, 0.04, 0.05).box(0.135, 0.3, 0, 0.01, 0.04, 0.05);
    k.detail(() => { for (const y of [0.12, 0.26, 0.4]) for (const z of [-0.09, 0.09]) k.at(CH, gold).box(0.14, y, z, 0.015, 0.03, 0.03); });
    for (const z of [-1, 1]) {                                                                 // Epaulettes and their fringe.
      k.at(CH, gold, 2).box(0, 0.58, z * 0.25, 0.22, 0.05, 0.16, 0.02);
      k.detail(() => { for (const x of [-0.08, 0, 0.08]) k.at(CH, gold).box(x, 0.52, z * 0.32, 0.02, 0.09, 0.02); });
    }
    k.at(CH, skin).prismY(0.56, 0.66, 0.04, 0, 0.06, 0.055, 5);
    skull(k, { skin: paint, eye: this.eye, w: 0.2, h: 0.24, d: 0.22, jaw: 0.9 });
    k.at(HD, 0x8a1c22).box(0.12, 0.08, 0, 0.02, 0.03, 0.12);                                  // A painted grin.
    k.at(HD, hair).box(-0.04, 0.2, 0, 0.2, 0.08, 0.26).box(-0.08, 0.12, 0, 0.1, 0.12, 0.28);
    // The cap: a tall crown, a gold band, a peak.
    k.at(HD, coatD).prismY(0.24, 0.42, 0.0, 0, 0.13, 0.15, 8);
    k.at(HD, gold, 2).prismY(0.26, 0.3, 0.0, 0, 0.135, 0.135, 8);
    k.at(HD, 0x14100e).box(0.14, 0.255, 0, 0.14, 0.02, 0.22);
    // The tails of the coat (its own bone, so they flap).
    k.at(EX, coat).box(-0.04, -0.3, -0.08, 0.04, 0.6, 0.14).box(-0.04, -0.3, 0.08, 0.04, 0.6, 0.14);
    k.at(EX, gold).box(-0.06, -0.6, 0, 0.02, 0.03, 0.3);
    k.at(UAL, coat).limb(0.33, 0.07, 0.06); k.at(FAL, coat).limb(0.26, 0.06, 0.065); k.at(FAL, gold).limb(0.03, 0.068, 0.068, 6, -0.24);
    k.at(FAL, 0xe8e2d0).box(0.0, -0.34, 0, 0.08, 0.08, 0.08);
    k.at(UAR, coat).limb(0.33, 0.07, 0.06); k.at(FAR, coat).limb(0.26, 0.06, 0.065); k.at(FAR, gold).limb(0.03, 0.068, 0.068, 6, -0.24);
    k.at(FAR, 0xe8e2d0).box(0.0, -0.34, 0, 0.08, 0.08, 0.08);
    // The speaking-trumpet in the right fist, flared forward.
    k.at(FAR, 0xc8962a).prismX(0.02, 0.42, -0.36, 0, 0.03, 0.11, 7);
    k.at(FAR, 0x2a1a10).prismX(0.415, 0.425, -0.36, 0, 0.1, 0.1, 7);
    k.at(THL, pants).limb(0.47, 0.08, 0.065); k.at(THR, pants).limb(0.47, 0.08, 0.065);
    k.detail(() => { k.at(THL, gold).box(0, -0.24, -0.075, 0.03, 0.44, 0.012); k.at(THR, gold).box(0, -0.24, 0.075, 0.03, 0.44, 0.012); });
    k.at(SHL, pants).limb(0.46, 0.06, 0.05); foot(k, SHL, 0.46, 0x0c0a0a, 0.26);
    k.at(SHR, pants).limb(0.46, 0.06, 0.05); foot(k, SHR, 0.46, 0x0c0a0a, 0.26);
  },
};

// The Ferryman (Saltmere Abbey's tower bell calls it up the nave): a drowned boatman, the tallest thing in the abbey
// but the Listener, in a long oilskin gone black-green with the sea, kelp hanging off it, barnacles on its shoulders, a
// faded sou'wester over a bloated grey face, a punt pole in its right fist and a ship's hand-bell on a chain in its
// left, burning sea-green.
const FERRYMAN = {
  dims: { hip: 0.98, waist: 0.1, chest: 0.58, neck: 0.06, shW: 0.22, hipW: 0.1, ua: 0.36, fa: 0.38, th: 0.48, sh: 0.46, s: 1.75, headX: 0.07, ex: { parent: FAL, at: [0.04, -0.42, 0] } },
  gait: { stride: 1.7, swing: 0.22, knee: 0.35, hunch: 0.38, lurch: 0.06, limp: 0, bob: 0.03, glide: 1, ferry: 1, headTilt: 0.1, twitch: 0.12, boss: 1 },
  eye: 0x5affd0,
  build(k) {
    const skin = 0x7a8c88, coat = 0x1c2a26, coatL = 0x2c4038, kelp = 0x3a4a1e, hat = 0x8a7a2a, barn = 0xbab4a0, green = 0x5affd0;
    // The oilskin hangs from the pelvis to the shins, split and ragged at the hem, kelp tangled in it.
    k.at(PEL, coat).bulb(0, 0, [[-0.72, 0.29], [-0.36, 0.24], [0.0, 0.17], [0.08, 0.15]], 8, 1, 1.12);
    k.detail(() => {
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.at(PEL, i % 2 ? coatL : kelp).box(Math.cos(a) * 0.27, -0.8 - (i % 3) * 0.05, Math.sin(a) * 0.3, 0.05, 0.16 + (i % 3) * 0.06, 0.09); }
    });
    k.at(CH, coat).box(0, 0.28, 0, 0.24, 0.56, 0.38, 0.04);
    k.at(CH, coatL).box(0.0, 0.5, 0, 0.3, 0.1, 0.5, 0.03).box(0.125, 0.3, 0, 0.01, 0.46, 0.06);
    // An iron chain across the chest, barnacles on the shoulders, weed hanging off them.
    k.at(CH, IRON).turn(0.13, 0.32, 0, 0.7, 0, 0, () => k.box(0.13, 0.32, 0, 0.02, 0.04, 0.42));
    k.detail(() => {
      for (const z of [-1, 1]) { for (const x of [-0.06, 0.04]) k.at(CH, barn).box(x, 0.56, z * (0.16 + (x > 0 ? 0.04 : 0)), 0.05, 0.04, 0.05); }
      flap(k, CH, kelp, -0.1, 0.5, 0.18, 0.4, 0.06, 0.2); flap(k, CH, kelp, -0.08, 0.5, -0.2, 0.3, 0.05, -0.25); flap(k, CH, kelp, 0.1, 0.48, 0.2, 0.26, 0.04, 0.1);
    });
    k.at(CH, skin).prismY(0.52, 0.64, 0.04, 0, 0.055, 0.05, 5);
    skull(k, { skin, eye: this.eye, w: 0.21, h: 0.24, d: 0.22, jaw: 0.6 });
    k.at(HD, shade(skin, 0.8)).box(0.06, 0.08, 0, 0.14, 0.1, 0.23);                            // A bloated jowl.
    // The sou'wester: a deep crown and a broad brim drooping behind.
    k.at(HD, hat).prismY(0.22, 0.36, 0.0, 0, 0.13, 0.15, 8);
    k.at(HD, shade(hat, 0.8)).prismY(0.21, 0.24, 0.0, 0, 0.27, 0.27, 10);
    k.at(HD, shade(hat, 0.7)).box(-0.24, 0.17, 0, 0.12, 0.03, 0.4);
    k.detail(() => { k.at(HD, kelp).box(-0.12, 0.1, 0.12, 0.03, 0.2, 0.03).box(-0.1, 0.06, -0.1, 0.03, 0.26, 0.03); });
    k.at(UAL, coat).limb(0.36, 0.075, 0.065); k.at(FAL, coat).limb(0.24, 0.07, 0.08); k.at(FAL, skin).limb(0.14, 0.045, 0.04, 5, -0.24); claw(k, FAL, 0.38, skin);
    k.at(UAR, coat).limb(0.36, 0.075, 0.065); k.at(FAR, coat).limb(0.24, 0.07, 0.08); k.at(FAR, skin).limb(0.14, 0.045, 0.04, 5, -0.24);
    k.at(FAR, skin).box(0.0, -0.4, 0, 0.09, 0.09, 0.09);
    // The punt pole, held upright in the right fist: a long shaft, an iron shoe at its foot.
    k.at(FAR, 0x4a3a26).prismY(-1.75, 0.95, 0.02, 0, 0.022, 0.026, 5);
    k.at(FAR, IRON).prismY(-1.9, -1.72, 0.02, 0, 0.012, 0.03, 5);
    // The hand-bell on its chain, burning sea-green.
    k.at(EX, IRON).prismY(0.0, 0.12, 0, 0, 0.008, 0.008, 4);
    k.at(EX, 0x7a5a2a).prismY(-0.16, 0.0, 0, 0, 0.09, 0.035, 8);
    k.at(EX, green, 3).box(0, -0.15, 0, 0.1, 0.04, 0.1);
    k.at(THL, coat).limb(0.48, 0.07, 0.06); k.at(THR, coat).limb(0.48, 0.07, 0.06);
    k.at(SHL, coatL).limb(0.46, 0.06, 0.05); foot(k, SHL, 0.46, 0x101614, 0.26);
    k.at(SHR, coatL).limb(0.46, 0.06, 0.05); foot(k, SHR, 0.46, 0x101614, 0.26);
  },
};

// By the view's zk (1 shambler ... 11 the Listener, 12 the Barker, 13 the Ferryman; 10, the wire's broken-shield
// code, is never drawn as such).
export const ZM_MODELS = { 1: SHAMBLER, 2: RUNNER, 3: BRUTE, 4: YARDMASTER, 5: WARDEN, 6: SPITTER, 7: BLOATER, 8: CRAWLER, 9: SHIELD, 11: LISTENER, 12: BARKER, 13: FERRYMAN };
export const ZM_MODEL_KEYS = Object.keys(ZM_MODELS).map(Number);
// What a hit on each kind looks like (zm-bodies.js onHit): the ichor's colour and what else flies.
export const ZM_MATTER = {
  1: { ichor: [0.07, 0.09, 0.05] }, 2: { ichor: [0.09, 0.06, 0.05] }, 3: { ichor: [0.06, 0.08, 0.05], heavy: 1 },
  4: { ichor: [0.08, 0.06, 0.04], spark: [1, 0.55, 0.2] }, 5: { ichor: [0.08, 0.05, 0.1], glow: [0.75, 0.5, 1] },
  6: { ichor: [0.1, 0.14, 0.03], glow: [0.6, 1, 0.23] }, 7: { ichor: [0.16, 0.09, 0.16], glow: [1, 0.7, 0.25] },
  8: { ichor: [0.05, 0.06, 0.04] }, 9: { ichor: [0.07, 0.08, 0.06] }, 11: { ichor: [0.5, 0.62, 0.7], frost: [0.6, 0.95, 1] }, 12: { ichor: [0.1, 0.05, 0.05], glow: [1, 0.75, 0.25] }, 13: { ichor: [0.05, 0.12, 0.1], glow: [0.35, 1, 0.82] },
};

export function buildModel(zk) {
  const def = ZM_MODELS[zk], k = new Kit();
  def.build(k);
  return k.build();
}
