// Low-poly soldiers. Each body part is one InstancedMesh shared by all players, so twelve soldiers
// cost four draw calls. Limbs are stretched prisms re-aimed every frame between joints and targets;
// no skeleton, no skinning.
import * as THREE from 'three';
import { MeshBuilder } from './meshbuild.js';
import { getGun } from './guns.js';
import { createCamoMaterial, addCamoInstanceAttributes, camoIndex, camoTint } from './camo-shader.js';
import { GLSL_LIGHT, GLSL_DITHER, hexRGB } from './art.js';
import { WEAPON_IDS, TEAMS } from '../shared/constants.js';
import { castRay } from './fog.js';
import { smokeBlocks } from '../shared/geometry.js';
import { OPERATORS, DEFAULT_OPERATOR } from '../ui/operators.js';
import { T as TK, RELOADS, SHELL_CYCLE, sampleTrack, solveJoint } from './anim.js';
import { Corpses, MAX_CORPSES, PART as P } from './corpses.js';

// weapons.js belongs to Gameplay; only the shell-loop pacing is read from it, so it stays a soft dependency.
let WEAPONS = {};
import('../shared/weapons.js').then(m => { WEAPONS = m.WEAPONS || {}; }).catch(() => {});

const MAX_PLAYERS = 16;
const TAU = Math.PI * 2;

const CHAR_SCALE = 1.22;
const GUN_SCALE = 0.98;
const GUN_SCALES = { ar: 1, smg: 1, shotgun: 1, lmg: 1, sniper: 0.86, pistol: 1.05 };
const HIP = 0.78 * CHAR_SCALE;

// How each gun sits in the hands, relative to the default hip carry: a planted LMG rides low, a tube sits on the shoulder.
const HOLD = {
  lmg: [-0.04, -0.13, 0.05], sniper: [-0.02, 0.05, 0], shotgun: [-0.02, -0.03, 0.02], autoshot: [-0.03, -0.05, 0.03],
  pistol: [0.14, 0.06, -0.08], revolver: [0.14, 0.07, -0.08], launcher: [-0.3, 0.3, 0.1],
};
const HOLD_NONE = [0, 0, 0];
const GRENADE_RGB = { frag: [0.35, 0.42, 0.28], sticky: [0.75, 0.2, 0.6], smoke: [0.35, 0.6, 0.42], flash: [0.85, 0.8, 0.45], stim: [0.3, 0.7, 0.5] };

// Operators are told apart by vertex data merged into one mesh per body part: every vertex carries the
// variant it belongs to (aVar) and each instance says which variant to show (aOp). Vertices of other variants
// are thrown outside clip space, so nine operators cost the same draw calls as one.
const CHAR_VERT = /* glsl */`
attribute vec3 aCol;
attribute float aPart;
attribute float aVar;
attribute float aOp;
attribute vec3 aTeam;
attribute vec3 aTint;
attribute vec2 aFx;
varying vec3 vCol;
varying vec3 vLight;
varying vec2 vFx;
${GLSL_LIGHT}
void main() {
  if (abs(aVar - aOp) > 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vCol = vec3(0.0); vLight = vec3(0.0); vFx = vec2(0.0); return; }
  mat4 world = modelMatrix * instanceMatrix;
  vec3 n = normalize(mat3(world) * normal);
  vec3 light = duskLight(n);
  vec3 lit = aCol * light;
  if (aPart > 1.5) lit = aTint * light;
  // Team-coloured armour is nearly self-lit: it has to stay the most saturated thing on screen.
  else if (aPart > 0.5) lit = aTeam * (0.62 + 0.42 * max(0.0, n.y + 0.2)) * (0.72 + 0.28 * light);
  vCol = lit;
  vLight = light;
  vFx = aFx;
  gl_Position = projectionMatrix * viewMatrix * world * vec4(position, 1.0);
}`;

const CHAR_FRAG = /* glsl */`
varying vec3 vCol;
varying vec3 vLight;
varying vec2 vFx;
${GLSL_DITHER}
void main() {
  if (vFx.x < 0.999 && vFx.x < screenDither(gl_FragCoord.xy)) discard;
  gl_FragColor = vec4(vCol + vFx.y * vec3(1.1), 1.0);
}`;

function addCharInstanceAttrs(g, capacity) {
  g.setAttribute('aTeam', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aFx', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aOp', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
  return g;
}

// Torso and head shapes per operator, seen mostly from above: what counts is the outline of the shoulders,
// the pack and the hat, and that a good part of every body stays team coloured. Forward is +X, up is +Y.
const pelvis = (b, wide = 0.42, colour = 0x2b2d33) => b.setPart(0).setColor(colour).box(0, 0.04, 0, 0.3, 0.2, wide);
const chest = (b, sx = 0.38, sy = 0.5, sz = 0.56, ch = 0.06) => b.setPart(1).box(0, 0.36, 0, sx, sy, sz, ch);
const pauldrons = (b, sx, sy, sz, zPos = 0.31, y = 0.6) => {
  b.setPart(1).box(0, y, zPos, sx, sy, sz, 0.04);
  b.box(0, y, -zPos, sx, sy, sz, 0.04);
};
const neck = (b, colour = 0x4a3a2e) => b.setPart(0).setColor(colour).box(0, 0.05, 0, 0.2, 0.14, 0.2);

const TORSOS = {
  trooper(b) {
    pelvis(b);
    chest(b);
    b.setPart(0).setColor(0x1f2127).box(0.21, 0.34, 0, 0.05, 0.36, 0.4);          // Front plate.
    b.setColor(0x34373f).box(-0.24, 0.32, 0, 0.16, 0.44, 0.42, 0.04);             // Pack.
    b.setPart(1).box(-0.24, 0.56, 0, 0.14, 0.06, 0.4);                            // Pack top strip reads from above.
    pauldrons(b, 0.3, 0.18, 0.22);
  },
  wisp(b) {
    pelvis(b, 0.36, 0x3a3730);
    chest(b, 0.32, 0.46, 0.46, 0.05);
    b.setPart(0).setColor(0x2a2820).box(0.17, 0.36, 0.1, 0.03, 0.46, 0.07);       // Bandolier.
    b.setColor(0x6b6147).box(-0.02, 0.14, 0.27, 0.22, 0.22, 0.14);                // Hip satchel instead of a pack.
    pauldrons(b, 0.2, 0.1, 0.16, 0.26, 0.58);
  },
  anvil(b) {
    pelvis(b, 0.5, 0x24272c);
    chest(b, 0.46, 0.54, 0.66, 0.08);
    b.setPart(0).setColor(0x2a2d33).box(0.26, 0.36, 0, 0.07, 0.42, 0.52);         // Front plate.
    b.setColor(0x3a3f47).prismZ(-0.26, 0.26, -0.36, 0.36, 0.26, 0.26, 8);         // Ammo drum across the back.
    b.setPart(1).prismZ(-0.08, 0.08, -0.36, 0.36, 0.272, 0.272, 8);               // Team band around it.
    pauldrons(b, 0.42, 0.26, 0.36, 0.41, 0.62);
  },
  relay(b) {
    pelvis(b, 0.42, 0x2d3329);
    chest(b, 0.36, 0.48, 0.52, 0.06);
    b.setPart(0).setColor(0x3f4a3a).box(-0.29, 0.36, 0, 0.22, 0.58, 0.38, 0.03);  // Radio set.
    b.setColor(0x181a1c).box(-0.29, 0.67, 0, 0.16, 0.05, 0.26);
    b.prismY(0.68, 1.95, -0.34, 0.12, 0.03, 0.014, 4);                            // Mast: the unmistakable bit.
    b.prismY(0.68, 1.3, -0.34, -0.12, 0.024, 0.012, 4);
    b.setPart(1).box(-0.34, 1.9, 0.12, 0.12, 0.12, 0.12);
    pauldrons(b, 0.24, 0.12, 0.18, 0.29, 0.58);
  },
  yarddog(b) {
    pelvis(b, 0.44, 0x2a3442);
    chest(b, 0.4, 0.5, 0.58, 0.05);
    b.setPart(0).setColor(0xd9d23c);                                              // Hi-vis bands front and top.
    b.box(0.205, 0.44, 0, 0.022, 0.07, 0.52); b.box(0.205, 0.24, 0, 0.022, 0.07, 0.52);
    b.box(0, 0.62, 0.15, 0.34, 0.015, 0.08); b.box(0, 0.62, -0.15, 0.34, 0.015, 0.08);
    b.setColor(0x2f3a4a).box(-0.26, 0.26, 0, 0.18, 0.34, 0.46, 0.03);             // Tool pack.
    b.setColor(0xd9d23c).box(-0.26, 0.44, 0, 0.14, 0.03, 0.4);
    pauldrons(b, 0.26, 0.14, 0.2, 0.32, 0.58);
  },
  ronin(b) {
    pelvis(b, 0.38, 0x24232b);
    chest(b, 0.32, 0.44, 0.48, 0.05);
    b.setPart(0).setColor(0x1f1e25);
    b.box(-0.21, 0.14, 0, 0.1, 0.74, 0.66);                                       // Cloak falling behind.
    b.box(-0.06, 0.62, 0, 0.42, 0.1, 0.72, 0.03);                                 // Shoulder drape, wider than the body.
    b.setPart(1).box(-0.06, 0.68, 0, 0.1, 0.02, 0.74);
  },
  ghoul(b) {
    pelvis(b, 0.38, 0x25282a);
    chest(b, 0.34, 0.5, 0.5, 0.05);
    b.setPart(0).setColor(0x25282a).box(-0.2, 0.12, 0, 0.09, 0.7, 0.52);          // Long coat.
    b.setColor(0x4a5048);
    b.prismY(0.1, 0.62, -0.32, 0.12, 0.11, 0.11, 6); b.prismY(0.1, 0.62, -0.32, -0.12, 0.11, 0.11, 6);    // Filter canisters.
    b.setColor(0x1a1c1e).box(-0.32, 0.64, 0, 0.1, 0.05, 0.32);
    pauldrons(b, 0.2, 0.08, 0.14, 0.28, 0.6);
  },
  ram(b) {
    pelvis(b, 0.48, 0x2d343c);
    chest(b, 0.44, 0.52, 0.62, 0.06);
    b.setPart(0).setColor(0x4a5560).box(0.27, 0.33, 0, 0.1, 0.54, 0.66, 0.03);    // Breaching plate, wider than the chest.
    b.setColor(0x20252b).box(-0.25, 0.24, 0, 0.16, 0.32, 0.5);
    pauldrons(b, 0.34, 0.2, 0.28, 0.36, 0.6);
  },
  monarch(b) {
    pelvis(b, 0.42, 0x322d3d);
    chest(b, 0.4, 0.52, 0.58, 0.06);
    b.setPart(1).box(-0.25, 0.08, 0, 0.05, 0.82, 0.68);                           // Cape in the team colour.
    b.setPart(0).setColor(0xd9b44a).box(-0.285, 0.47, 0, 0.02, 0.06, 0.7);        // Gold trim.
    b.box(0.2, 0.42, 0, 0.02, 0.06, 0.44);
    b.box(0, 0.68, 0.32, 0.3, 0.05, 0.22); b.box(0, 0.68, -0.32, 0.3, 0.05, 0.22);
    pauldrons(b, 0.3, 0.14, 0.24, 0.32, 0.62);
  },
};

const HEADS = {
  trooper(b) {
    neck(b);
    b.setPart(1).prismY(0.1, 0.26, 0, 0, 0.25, 0.27, 8, Math.PI / 8);             // Helmet skirt.
    b.prismY(0.26, 0.42, 0, 0, 0.27, 0.15, 8, Math.PI / 8);                       // Dome.
    b.setPart(0).setColor(0x101215).box(0.2, 0.2, 0, 0.1, 0.1, 0.34);             // Visor recess.
    b.setColor(0xd8fff9).box(0.255, 0.2, 0, 0.02, 0.05, 0.32);
  },
  wisp(b) {
    neck(b, 0x55412f);
    b.setColor(0x7a5c43).prismY(0.1, 0.28, 0, 0, 0.17, 0.16, 7);                  // Bare face under the brim.
    b.setColor(0x6b6147).prismY(0.26, 0.3, 0, 0, 0.42, 0.41, 8, Math.PI / 8);     // Boonie brim, the widest part.
    b.prismY(0.3, 0.42, 0, 0, 0.21, 0.17, 8, Math.PI / 8);
    b.setPart(1).prismY(0.3, 0.335, 0, 0, 0.215, 0.215, 8, Math.PI / 8);
  },
  anvil(b) {
    neck(b, 0x2a2d33);
    b.setPart(1).box(0, 0.22, 0, 0.5, 0.32, 0.5, 0.03);                           // Square helm.
    b.setPart(0).setColor(0x2a2d33).box(0, 0.4, 0, 0.32, 0.07, 0.36);
    b.setColor(0x101215).box(0.25, 0.22, 0, 0.02, 0.1, 0.42);
    b.setColor(0xffc96b).box(0.262, 0.22, 0, 0.012, 0.035, 0.4);
  },
  relay(b) {
    neck(b);
    b.setColor(0x7a5c43).prismY(0.1, 0.3, 0, 0, 0.18, 0.17, 7);
    b.setPart(1).box(0.02, 0.36, 0.02, 0.36, 0.12, 0.34, 0.03);                   // Side cap, worn off-centre.
    b.setPart(0).setColor(0x1a1c20);
    b.box(0, 0.2, 0.2, 0.12, 0.2, 0.05);                                          // Headset cup and boom.
    b.box(0.13, 0.15, 0.2, 0.22, 0.025, 0.025);
  },
  yarddog(b) {
    neck(b);
    b.setPart(0).setColor(0xd8dad2).prismY(0.2, 0.4, 0, 0, 0.28, 0.2, 8, Math.PI / 8);     // White hard hat.
    b.setPart(1).prismY(0.2, 0.235, 0.05, 0, 0.36, 0.35, 8, Math.PI / 8);                  // Brim.
    b.box(0, 0.42, 0, 0.4, 0.045, 0.07);                                                   // Ridge.
    b.setPart(0).setColor(0xffe39a).box(0.29, 0.31, 0, 0.07, 0.09, 0.12);                  // Lamp.
    b.setColor(0x7a5c43).prismY(0.1, 0.22, 0, 0, 0.17, 0.17, 7);
  },
  ronin(b) {
    neck(b, 0x2a2930);
    b.setColor(0x322f33).prismY(0.08, 0.22, 0, 0, 0.17, 0.17, 7);
    b.setColor(0xa89060).prismY(0.22, 0.25, 0, 0, 0.58, 0.56, 10);                         // Conical hat: a disc from above.
    b.prismY(0.25, 0.48, 0, 0, 0.56, 0.06, 10);
    b.setPart(1).prismY(0.245, 0.27, 0, 0, 0.59, 0.58, 10);
  },
  ghoul(b) {
    neck(b, 0x1f2224);
    b.setPart(0).setColor(0x1f2224).prismY(0.06, 0.44, -0.03, 0, 0.3, 0.1, 7);             // Hood, peaked to the rear.
    b.setPart(1).box(-0.02, 0.33, 0, 0.3, 0.035, 0.34);
    b.setPart(0).setColor(0x2d3230).box(0.2, 0.16, 0, 0.12, 0.15, 0.3);                    // Mask.
    b.setColor(0x4a5048);
    b.prismX(0.25, 0.44, 0.13, 0.16, 0.08, 0.09, 6); b.prismX(0.25, 0.44, 0.13, -0.16, 0.08, 0.09, 6);     // Filters.
    b.setColor(0xb7ffb0).box(0.272, 0.235, 0.08, 0.02, 0.06, 0.1); b.box(0.272, 0.235, -0.08, 0.02, 0.06, 0.1);
  },
  ram(b) {
    neck(b, 0x2d343c);
    b.setPart(1).prismY(0.1, 0.38, 0, 0, 0.27, 0.17, 8, Math.PI / 8);
    b.setPart(0).setColor(0x9fb2c0).box(0.27, 0.2, 0, 0.06, 0.44, 0.5);                    // Full face shield.
    b.setColor(0x20252b).box(0.1, 0.41, 0, 0.36, 0.03, 0.14);
  },
  monarch(b) {
    neck(b, 0x322d3d);
    b.setPart(0).setColor(0x8b91a0).prismY(0.1, 0.32, 0, 0, 0.26, 0.24, 8, Math.PI / 8);
    b.prismY(0.32, 0.42, 0, 0, 0.24, 0.12, 8, Math.PI / 8);
    b.setColor(0xd9b44a).prismY(0.25, 0.28, 0, 0, 0.27, 0.27, 8, Math.PI / 8);
    b.setPart(1).box(-0.05, 0.52, 0, 0.62, 0.3, 0.06);                                     // Crest, running front to back.
    b.setPart(0).setColor(0x101215).box(0.22, 0.2, 0, 0.06, 0.08, 0.32);
    b.setColor(0xfff0c8).box(0.255, 0.2, 0, 0.012, 0.03, 0.3);
  },
};

function variantGeometry(table) {
  const pos = [], nor = [], col = [], par = [], vars = [];
  OPERATORS.forEach((op, variant) => {
    const b = new MeshBuilder();
    (table[op.id] ?? table.trooper)(b);
    for (const v of b.pos) pos.push(v);
    for (const v of b.nor) nor.push(v);
    for (const v of b.col) col.push(v);
    for (const v of b.par) par.push(v);
    for (let i = b.pos.length / 3; i > 0; i--) vars.push(variant);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(par, 1));
  g.setAttribute('aVar', new THREE.Float32BufferAttribute(vars, 1));
  return g;
}

const torsoGeometry = () => variantGeometry(TORSOS);
const headGeometry = () => variantGeometry(HEADS);

// Limbs are the same mesh for everyone; part 2 takes the instance's tint and thickness comes from the rig.
function limbAttrs(g) {
  g.setAttribute('aVar', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  return g;
}

// One bare segment for upper arms and thighs alike; the rig sets its thickness per instance.
function upperLimbGeometry() {
  const b = new MeshBuilder();
  b.setPart(2).prismX(0, 1, 0, 0, 0.1, 0.086, 6);
  return limbAttrs(b.build());
}

function armGeometry() {
  const b = new MeshBuilder();
  b.setPart(2).prismX(0, 0.8, 0, 0, 0.086, 0.076, 6);
  b.setPart(0).setColor(0x202226).prismX(0.8, 1.0, 0, 0, 0.1, 0.1, 6);       // Glove.
  return limbAttrs(b.build());
}

function legGeometry() {
  const b = new MeshBuilder();
  b.setPart(2).prismX(0, 1, 0, 0, 0.1, 0.086, 6);
  return limbAttrs(b.build());
}

// Origin at the ankle, toe along +X.
function bootGeometry() {
  const b = new MeshBuilder();
  b.setPart(0).setColor(0x1a1c20).box(0.09, -0.04, 0, 0.36, 0.18, 0.21, 0.03);
  return limbAttrs(b.build());
}

// Unit box in the instance's tint, scaled to whatever the off hand is holding: magazine, drum, shell, rocket, grenade.
function heldBoxGeometry() {
  const b = new MeshBuilder();
  b.setPart(2).box(0, 0, 0, 1, 1, 1, 0.08);
  return limbAttrs(b.build());
}

// Team ring around the feet: bright rim, faint fill, faceted to match everything else.
function ringGeometry() {
  const sides = 12;
  const pos = [], rim = [];
  const add = (a, r0, r1) => {
    pos.push(Math.cos(a) * r0, 0.06, Math.sin(a) * r0);
    rim.push(r1);
  };
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    // Fill.
    add(a0, 0, 0); add(a1, 0.6, 0); add(a0, 0.6, 0);
    // Rim band.
    const o = 0.72, n = 0.6;
    add(a0, n, 1); add(a1, n, 1); add(a1, o, 1);
    add(a0, n, 1); add(a1, o, 1); add(a0, o, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRim', new THREE.Float32BufferAttribute(rim, 1));
  return g;
}

function blobGeometry() {
  const sides = 8;
  const pos = [], a_ = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    pos.push(0, 0.16, 0, Math.cos(a1), 0.16, Math.sin(a1), Math.cos(a0), 0.16, Math.sin(a0));
    a_.push(1, 0, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(a_, 1));
  return g;
}

const _m = new THREE.Matrix4(), _body = new THREE.Matrix4(), _gun = new THREE.Matrix4();
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YZX');
const _gunE = new THREE.Euler(0, 0, 0, 'YZX');
const _qGun = new THREE.Quaternion();
const _joint = new Float32Array(3);
const _tr = new Float32Array(12);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function setStretch(m, ax, ay, az, bx, by, bz, gy, gz) {
  let dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
  dx /= len; dy /= len; dz /= len;
  // Z = X cross world-up; near-vertical limbs fall back to X as the reference.
  let rx = 0, ry = 1, rz = 0;
  if (Math.abs(dy) > 0.95) { rx = 1; ry = 0; }
  let zx = dy * rz - dz * ry, zy = dz * rx - dx * rz, zz = dx * ry - dy * rx;
  const zl = Math.sqrt(zx * zx + zy * zy + zz * zz) + 1e-6;
  zx /= zl; zy /= zl; zz /= zl;
  const yx = zy * dz - zz * dy, yy = zz * dx - zx * dz, yz = zx * dy - zy * dx;
  const e = m.elements;
  e[0] = dx * len; e[1] = dy * len; e[2] = dz * len; e[3] = 0;
  e[4] = yx * gy;  e[5] = yy * gy;  e[6] = yz * gy;  e[7] = 0;
  e[8] = zx * gz;  e[9] = zy * gz;  e[10] = zz * gz; e[11] = 0;
  e[12] = ax;      e[13] = ay;      e[14] = az;      e[15] = 1;
}

const damp = (k, dt) => 1 - Math.exp(-k * dt);

// Spring slots on a rig: body lean and recoil rock, all under-damped so stops and shots carry weight.
const LEAN_F = 0, LEAN_S = 1, ROCK = 2, FLINCH_F = 3, FLINCH_S = 4, SPRINGS = 5;

function spring(r, i, target, k, c, dt) {
  const x = r.sx[i];
  r.sv[i] += (-k * (x - target) - c * r.sv[i]) * dt;
  r.sx[i] = x + r.sv[i] * dt;
}

class Rig {
  constructor(id) {
    this.id = id;
    this.phase = 0;
    this.kick = 0;
    this.reload = 0;
    this.reloadU = 0;
    this.slide = 0;
    this.sprint = 0;
    this.swap = 0;
    this.flash = 0;
    this.reveal = 0;
    this.seen = false;
    this.x = 0; this.z = 0; this.aim = 0;
    this.weapon = 'ar';
    this.muzzle = new Float32Array(3);
    this.eject = new Float32Array(3);
    this.ejectDir = new Float32Array(2);
    this.team = 0;
    this.moveX = 0; this.moveZ = 0;
    this.visible = false;
    this.heat = 0;
    this.overheated = false;
    this.op = 0;              // Index into OPERATORS.
    this.speed = 0;
    this.lastAim = 0;
    this.aimVel = 0;
    this.sx = new Float32Array(SPRINGS);
    this.sv = new Float32Array(SPRINGS);
    this.seed = Math.random() * 100;
    this.throwT = 0;          // Counts down from 1 through an overhand throw.
    this.throwKind = 'frag';
    this.throwHold = 0;       // 0..1 weight of the wound-up pose while the local player is aiming a throw.
    this.down = false;        // Killed and already dismantled, while the view has yet to report it.
    this.downT = 0;
    this.sawDead = false;
    this.posed = -1;          // Clock of the last frame that wrote `pose`.
    this.pose = new Float32Array(P.COUNT * 16);    // Last drawn world matrix of every body part.
    this.gunMesh = null;
    this.camoI = 0;
    this.accent = new Float32Array(3);
    this.legRGB = null; this.armRGB = null;
  }
}

export class Characters {
  constructor(scene, map, time) {
    this.scene = scene;
    this.map = map;
    this.time = time;
    this.rigs = new Map();
    this.visionWalls = map.walls.filter(w => w.blocksVision);
    this.teamRGB = TEAMS.map(t => hexRGB(t.color));
    // Per-operator numbers the frame loop reads, so it never touches colour conversion or string lookups.
    this.looks = OPERATORS.map(o => ({ ...o.look, sleeveRGB: hexRGB(o.look.sleeve), trouserRGB: hexRGB(o.look.trouser) }));
    this.opById = new Map();

    const charMat = new THREE.ShaderMaterial({ vertexShader: CHAR_VERT, fragmentShader: CHAR_FRAG });
    this.charMat = charMat;
    const add = (geom, cap) => {
      addCharInstanceAttrs(geom, cap);
      const mesh = new THREE.InstancedMesh(geom, charMat, cap);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 2;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      return mesh;
    };
    // Every dismantled body is drawn with these same meshes, hence the room for MAX_CORPSES on top of the living.
    const cap = MAX_PLAYERS + MAX_CORPSES;
    this.torso = add(torsoGeometry(), cap);
    this.head = add(headGeometry(), cap);
    this.upper = add(upperLimbGeometry(), cap * 4);      // Upper arms and thighs.
    this.arm = add(armGeometry(), cap * 2);
    this.leg = add(legGeometry(), cap * 2);
    this.boot = add(bootGeometry(), cap * 2);
    this.held = add(heldBoxGeometry(), MAX_PLAYERS);

    // X-ray pass, drawn after the world and before characters, so only pixels hidden by walls survive.
    const xrayMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute vec3 aTeam; attribute vec2 aFx; varying vec3 vTeam; varying float vFade;
        void main(){
          vTeam = aTeam; vFade = aFx.x; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vTeam; varying float vFade; void main(){ gl_FragColor = vec4(vTeam * 0.62 * vFade, 0.6 * vFade); }`,
      depthFunc: THREE.GreaterDepth, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    // The silhouette through a wall is a flat tint, so one trooper shape serves every operator at a fraction of the triangles.
    const xrayOf = (src, table) => {
      const b = new MeshBuilder();
      table.trooper(b);
      const g = b.build();
      g.setAttribute('aTeam', src.geometry.attributes.aTeam);
      g.setAttribute('aFx', src.geometry.attributes.aFx);
      const m = new THREE.InstancedMesh(g, xrayMat, src.instanceMatrix.count);
      m.instanceMatrix = src.instanceMatrix;
      m.frustumCulled = false;
      m.count = 0;
      m.renderOrder = 1;
      scene.add(m);
      return m;
    };
    this.xrayTorso = xrayOf(this.torso, TORSOS);
    this.xrayHead = xrayOf(this.head, HEADS);
    this.xrayMat = xrayMat;

    // Rings: depthTest off so a teammate behind a building still shows where they stand.
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute vec3 aTeam; attribute vec2 aFx; attribute float aRim;
        varying vec3 vC; varying float vA;
        void main(){
          float fade = aFx.x;
          vec3 c = aTeam;
          float a = aRim > 0.5 ? 0.95 : 0.18;
          vC = (c + aFx.y * 0.35) * a * fade; vA = a * fade;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.0);
        }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ gl_FragColor = vec4(vC, vA); }`,
      depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.ringMat = ringMat;
    const ringG = ringGeometry();
    addCharInstanceAttrs(ringG, MAX_PLAYERS);
    this.ring = new THREE.InstancedMesh(ringG, ringMat, MAX_PLAYERS);
    this.ring.frustumCulled = false;
    this.ring.count = 0;
    this.ring.renderOrder = 1;
    scene.add(this.ring);

    const blobMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aA; attribute vec2 aFx; varying float vA;
        void main(){ vA = aA * aFx.x; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.03, 0.03, 0.09, vA * 0.72); }`,
      transparent: true, depthWrite: false,
    });
    this.blobMat = blobMat;
    const blobG = blobGeometry();
    addCharInstanceAttrs(blobG, MAX_PLAYERS);
    this.blob = new THREE.InstancedMesh(blobG, blobMat, MAX_PLAYERS);
    this.blob.frustumCulled = false;
    this.blob.count = 0;
    this.blob.renderOrder = 0;
    scene.add(this.blob);

    this.bodyMeshes = [this.torso, this.head, this.upper, this.arm, this.leg, this.boot, this.held, this.ring, this.blob];
    this.camoMat = createCamoMaterial(time);
    this.guns = {};
    this.scene = scene;
    this.gunList = [];
    for (const id of WEAPON_IDS) this._gunMesh(getGun(id));

    this.counts = { nT: 0, nU: 0, nA: 0, nL: 0, nB: 0 };
    this.corpses = new Corpses(this);
    this.vfx = null;           // Set by GameRenderer; the operator preview runs without effects.
    this.surf = null;
    this.focusX = 0; this.focusZ = 0;    // Camera focus: footfalls and small dust only happen near it.
  }

  // One instanced mesh per distinct gun model (weapon plus visible attachments), built the first time it is held.
  _gunMesh(proto) {
    let mesh = this.guns[proto.key];
    if (mesh) return mesh;
    const geom = proto.geometry.clone();
    addCamoInstanceAttributes(geom, MAX_PLAYERS + MAX_CORPSES);
    mesh = new THREE.InstancedMesh(geom, this.camoMat, MAX_PLAYERS + MAX_CORPSES);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 2;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    this.guns[proto.key] = mesh;
    this.gunList.push(mesh);
    return mesh;
  }

  // roster entries: { id, operator }. Called once per match, before the first update.
  setRoster(roster) {
    this.opById.clear();
    for (const r of roster) {
      const i = OPERATORS.findIndex(o => o.id === r.operator);
      this.opById.set(r.id, i < 0 ? 0 : i);
    }
  }

  rig(id) {
    let r = this.rigs.get(id);
    if (!r) { r = new Rig(id); this.rigs.set(id, r); }
    return r;
  }

  // Weapon kick per shot. Strength is the weapon's cosmetic kickCam; recoil travels gun, shoulders, then hips.
  onShot(id, strength) {
    const r = this.rigs.get(id);
    if (!r) return;
    r.kick = Math.min(1.3, r.kick + 0.55 + strength * 0.5);
    r.sv[ROCK] += 1.5 + strength * 3.2;
  }

  // dirX/dirZ is the direction the hit pushes; strength roughly 0..1.
  onHit(id, dirX = 0, dirZ = 0, strength = 0.6) {
    const r = this.rigs.get(id);
    if (!r) return;
    r.flash = 1;
    const c = Math.cos(r.aim), s = Math.sin(r.aim);
    r.sv[FLINCH_F] += -(dirX * c + dirZ * s) * 7 * strength;
    r.sv[FLINCH_S] += (-dirX * s + dirZ * c) * 7 * strength;
  }

  onSwap(id) { const r = this.rigs.get(id); if (r) r.swap = 1; }
  onThrow(id, kind) { const r = this.rigs.get(id); if (r) { r.throwT = 1; r.throwKind = kind || 'frag'; } }

  // Replaces a rig with flying parts. Returns false when the rig has not been drawn recently (never seen).
  onKill(id, info) {
    const r = this.rigs.get(id);
    if (!r) return false;
    r.down = true; r.downT = 1.2; r.sawDead = false;
    return this.corpses.spawn(r, info);
  }

  // Replays cut in and out of time, so everything that carried over from the old timeline has to go.
  resetTransient() {
    for (const r of this.rigs.values()) {
      r.down = false; r.sawDead = false; r.reveal = 0; r.kick = 0; r.flash = 0; r.throwT = 0; r.swap = 0;
      r.sx.fill(0); r.sv.fill(0); r.aimVel = 0;
    }
    this.corpses.clear();
  }

  _writeFx(mesh, i, fade, flash, team, op, tint) {
    const a = mesh.geometry.attributes;
    a.aFx.setXY(i, fade, flash);
    a.aTeam.setXYZ(i, team[0], team[1], team[2]);
    a.aOp.setX(i, op);
    if (tint) a.aTint.setXYZ(i, tint[0], tint[1], tint[2]);
  }

  // Local visibility test for an enemy: centre and both shoulders, so a peeking shoulder still shows.
  _seenBy(localX, localZ, px, pz, smokes) {
    const dx = px - localX, dz = pz - localZ;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.5) return true;
    const ux = dx / len, uz = dz / len;
    for (let i = -1; i <= 1; i++) {
      const sx = px + (-uz * i * 0.35), sz = pz + (ux * i * 0.35);
      const ldx = sx - localX, ldz = sz - localZ;
      const l = Math.sqrt(ldx * ldx + ldz * ldz);
      if (castRay(this.visionWalls, localX, localZ, ldx / l, ldz / l, l) >= l && !smokeBlocks(smokes, localX, localZ, sx, sz)) return true;
    }
    return false;
  }

  // Rebuilds all instance buffers from the view. Writes every rig's muzzle position, used by VFX.
  update(view, dt, opts) {
    const { localId, localTeam, uav, revealAll } = opts;
    const torso = this.torso, head = this.head, upper = this.upper, arm = this.arm, leg = this.leg, boot = this.boot, held = this.held;
    const vfx = this.vfx, clock = this.time.value;
    let nT = 0, nU = 0, nA = 0, nL = 0, nB = 0, nH = 0;
    let nRing = 0;
    for (let i = 0; i < this.gunList.length; i++) this.gunList[i].count = 0;
    let localPlayer = null;
    for (let i = 0; i < view.players.length; i++) if (view.players[i].id === localId) { localPlayer = view.players[i]; break; }
    const lx = localPlayer ? localPlayer.x : 0, lz = localPlayer ? localPlayer.z : 0;

    for (let pi = 0; pi < view.players.length; pi++) {
      const p = view.players[pi];
      const r = this.rig(p.id);
      r.team = p.team;
      r.op = this.opById.get(p.id) ?? 0;
      const look = this.looks[r.op];
      r.x = p.x; r.z = p.z; r.aim = p.aim;
      if (r.weapon !== p.weapon) { r.weapon = p.weapon; r.swap = Math.max(r.swap, 0.75); }
      if (r.down) {
        // The kill event outruns the interpolated view: stay hidden until the view agrees, then until the next life.
        r.downT -= dt;
        if (!p.alive) r.sawDead = true;
        if ((r.sawDead && p.alive) || r.downT <= 0) { r.down = false; r.sawDead = false; }
      }

      const vx = p.vx || 0, vz = p.vz || 0;
      const rawSpeed = Math.sqrt(vx * vx + vz * vz);
      const moving = rawSpeed > 0.3;
      r.speed += (rawSpeed - r.speed) * damp(12, dt);
      const speed = r.speed;
      const runK = Math.min(1, speed / 4.2);

      r.moveX += ((moving ? vx / rawSpeed : 0) - r.moveX) * damp(14, dt);
      r.moveZ += ((moving ? vz / rawSpeed : 0) - r.moveZ) * damp(14, dt);
      r.kick *= Math.exp(-dt * 13);
      r.flash *= Math.exp(-dt * 16);
      r.swap *= Math.exp(-dt * 9);
      const reloadTarget = p.reloadT > 0 ? 1 : 0;
      r.reload += (reloadTarget - r.reload) * damp(reloadTarget ? 14 : 18, dt);
      const slideTarget = p.sliding ? 1 : 0;
      r.slide += (slideTarget - r.slide) * damp(14, dt);
      const sprintTarget = p.sprinting && !p.sliding && !(p.adsT > 0.2) ? 1 : 0;
      r.sprint += (sprintTarget - r.sprint) * damp(9, dt);
      if (r.throwT > 0) r.throwT = Math.max(0, r.throwT - dt / 0.5);
      const throwAiming = view.throwPreview && p.id === localId ? 1 : 0;
      r.throwHold += (throwAiming - r.throwHold) * damp(14, dt);

      // Gait: phase is distance-locked, so a planted foot stays planted instead of skating.
      const prevPhase = r.phase;
      r.phase = (r.phase + speed * dt * (TAU / (2.6 + r.sprint * 0.9))) % (TAU * 512);
      let plantLeg = -1;
      if (speed > 3.4 && Math.floor(r.phase / Math.PI) !== Math.floor(prevPhase / Math.PI)) plantLeg = Math.floor(r.phase / Math.PI) & 1;

      let da = (p.aim - r.lastAim) % TAU;
      if (da > Math.PI) da -= TAU; else if (da < -Math.PI) da += TAU;
      r.lastAim = p.aim;
      const av = dt > 1e-4 ? clamp(da / dt, -14, 14) : r.aimVel;
      r.aimVel += (av - r.aimVel) * damp(16, dt);

      const aimX = Math.cos(p.aim), aimZ = Math.sin(p.aim);
      const fwdV = (vx * aimX + vz * aimZ) / 7, sideV = (-vx * aimZ + vz * aimX) / 7;
      spring(r, LEAN_F, fwdV * 0.2, 70, 10, dt);
      spring(r, LEAN_S, sideV * 0.17, 70, 10, dt);
      spring(r, ROCK, 0, 130, 15, dt);
      spring(r, FLINCH_F, 0, 150, 15, dt);
      spring(r, FLINCH_S, 0, 150, 15, dt);

      const friendly = p.team === localTeam;
      r.heat = p.heat ?? 0;
      r.overheated = !!p.overheated;
      const seen = p.alive && !r.down && (friendly || (uav && !p.ghost) || revealAll || !localPlayer || this._seenBy(lx, lz, p.x, p.z, view.smokes));
      r.seen = seen;
      r.reveal += (seen ? 1 : -1) * dt / (seen ? 0.09 : 0.18);
      r.reveal = Math.min(1, Math.max(0, r.reveal));
      if (!p.alive || r.down) r.reveal = 0;
      r.visible = r.reveal > 0.005;

      const ads = p.adsT || 0;
      const sprint = r.sprint, slide = r.slide;
      const sinPhase = Math.sin(r.phase);
      const bob = Math.abs(sinPhase) * 0.09 * runK * (1 + sprint * 0.35);
      const breath = Math.sin(clock * 2.1 + r.seed) * 0.012 * (1 - runK);
      const rock = r.sx[ROCK];
      const y = HIP * look.h + bob + breath - slide * 0.48 - runK * 0.05 - ads * 0.05 - rock * 0.02;
      const rightX = -aimZ, rightZ = aimX;
      const sway = sinPhase * 0.035 * runK;
      const bodyX = p.x + rightX * sway, bodyZ = p.z + rightZ * sway;

      // A turning torso trails the aim while the gun stays on it: that gap is what reads as mass.
      const throwActive = r.throwT > 0 ? Math.sin((1 - r.throwT) * Math.PI) : 0;
      const lag = clamp(r.aimVel * 0.03, -0.32, 0.32) * (1 - ads * 0.7);
      const twist = sinPhase * 0.1 * runK * (1 - ads) + throwActive * 0.5 + r.throwHold * -0.32;
      const pitch = -sprint * 0.26 - r.sx[LEAN_F] + slide * 0.5 + ads * 0.05 + rock * 0.2 + r.sx[FLINCH_F];
      const roll = -slide * 0.5 + r.sx[LEAN_S] + r.sx[FLINCH_S] + sinPhase * 0.04 * runK;
      _e.set(roll, -(p.aim - lag - twist), pitch);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _p.set(bodyX, y, bodyZ);
      _body.compose(_p, _q, _s);

      // Gun pose in upper-body space: hip, ADS and sprint carry, then reload, swap and recoil layered on top.
      const hold = HOLD[p.weapon] || HOLD_NONE;
      const carry = 1 - sprint * 0.5;
      const swap = r.swap, swapBack = Math.sin(swap * Math.PI);
      let gunX = 0.34 + ads * 0.12 + hold[0] * carry - sprint * 0.06 - r.kick * 0.15;
      let gunY = 0.32 + ads * 0.2 + hold[1] * carry - swap * 0.55 - slide * 0.1 + Math.sin(r.phase * 2) * 0.018 * runK + breath * 0.8;
      let gunZ = 0.18 - ads * 0.1 + hold[2] * carry - sprint * 0.04 + sinPhase * 0.05 * sprint - lag * 0.06;
      let gunRoll = -swap * 0.6 + sinPhase * 0.09 * sprint;
      let gunYaw = sprint * 1.0 + swapBack * 0.35 - lag + lag * 0.15 - twist * 0.85;
      let gunPitch = r.kick * 0.2 - swap * 0.9 + rock * 0.08;
      gunX -= throwActive * 0.08 + r.throwHold * 0.12;
      gunY -= throwActive * 0.2 + r.throwHold * 0.24;
      gunRoll += throwActive * 0.5 + r.throwHold * 0.5;

      let handW = 0, magOn = 0, hx = 0, hy = 0, hz = 0;
      const R = r.reload;
      const rel = RELOADS[p.weapon] || RELOADS.ar;
      const lastU = r.reloadU;
      if (p.reloadT > 0 && p.reloadDur > 0) {
        const u = clamp(1 - p.reloadT / p.reloadDur, 0, 1);
        if (u < r.reloadU - 0.25) r.reloadU = u;
        r.reloadU += (u - r.reloadU) * damp(18, dt);
      } else {
        r.reloadU = 0;
      }
      if (R > 0.01) {
        if (rel.track) sampleTrack(rel.track, r.reloadU, _tr);
        else {
          const shell = (WEAPONS[p.weapon] && WEAPONS[p.weapon].reload) || 0.45;
          const inner = ((r.reloadU * p.reloadDur) / shell) % 1;
          sampleTrack(SHELL_CYCLE, inner, _tr);
        }
        gunX += _tr[TK.DX] * R; gunY += _tr[TK.DY] * R; gunZ += _tr[TK.DZ] * R;
        gunRoll += _tr[TK.ROLL] * R; gunYaw += _tr[TK.YAW] * R; gunPitch += _tr[TK.PITCH] * R;
        handW = _tr[TK.W] * R; hx = _tr[TK.HX]; hy = _tr[TK.HY]; hz = _tr[TK.HZ];
        magOn = R > 0.6 ? _tr[TK.MAG] : 0;
      }

      _gunE.set(gunRoll, gunYaw, gunPitch);
      _qGun.setFromEuler(_gunE);
      const gs = GUN_SCALE * (GUN_SCALES[p.weapon] || 1);
      _s.set(gs, gs, gs);
      _p.set(gunX, gunY, gunZ);
      _gun.compose(_p, _qGun, _s).premultiply(_body);

      // Muzzle and ejection port, needed even for hidden shooters so tracers start correctly.
      const proto = getGun(p.weapon, p.attachments);
      _v.set(proto.muzzle[0], proto.muzzle[1], proto.muzzle[2]).applyMatrix4(_gun);
      r.muzzle[0] = _v.x; r.muzzle[1] = _v.y; r.muzzle[2] = _v.z;
      _v.set(proto.eject[0], proto.eject[1], proto.eject[2]).applyMatrix4(_gun);
      r.eject[0] = _v.x; r.eject[1] = _v.y; r.eject[2] = _v.z;
      // Brass flies out of the shooter's right, up and a little to the rear.
      r.ejectDir[0] = -aimZ - aimX * 0.35; r.ejectDir[1] = aimX - aimZ * 0.35;

      if (!r.visible) continue;

      const team = this.teamRGB[p.team] || this.teamRGB[0];
      let fade = r.reveal;
      // Spawn protection: a quick shimmer rather than a flat fade.
      if (p.spawnProtect) fade *= 0.55 + 0.45 * Math.abs(Math.sin(view.t * 16));
      const flash = r.flash;

      _s.set(look.w, look.h, look.w);
      _m.copy(_body).scale(_s);
      _m.toArray(torso.instanceMatrix.array, nT * 16);
      _m.toArray(r.pose, P.TORSO * 16);
      this._writeFx(torso, nT, fade, flash, team, r.op);

      _p.set(0, 0.68 * CHAR_SCALE * 0.95 * look.h - r.kick * 0.01 - bob * 0.3, 0);
      _s.set(1, 1, 1);
      _e.set(-roll * 0.5 + r.sx[FLINCH_S] * 0.6, lag * 0.85 + twist * 0.5, r.kick * 0.08 + slide * -0.3 - pitch * 0.4 + r.sx[FLINCH_F] * 0.8);
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s).premultiply(_body);
      _m.toArray(head.instanceMatrix.array, nT * 16);
      _m.toArray(r.pose, P.HEAD * 16);
      this._writeFx(head, nT, fade, flash, team, r.op);
      nT++;

      // Gun.
      const gunMesh = this._gunMesh(proto);
      const gi = gunMesh.count++;
      _gun.toArray(gunMesh.instanceMatrix.array, gi * 16);
      _gun.toArray(r.pose, P.GUN * 16);
      const ga = gunMesh.geometry.attributes;
      const camoI = camoIndex(p.camo);
      ga.aCamo.setX(gi, camoI);
      const tint = camoTint(p.camo);
      let ar = team[0], ag = team[1], ab = team[2];
      if (tint >= 0) { ar = (tint >> 16 & 255) / 255; ag = (tint >> 8 & 255) / 255; ab = (tint & 255) / 255; }
      ga.aAccent.setXYZ(gi, ar, ag, ab);
      ga.aFx.setXY(gi, fade, flash);
      ga.aHeat.setX(gi, r.heat);
      r.gunMesh = gunMesh; r.camoI = camoI; r.accent[0] = ar; r.accent[1] = ag; r.accent[2] = ab;
      r.armRGB = look.sleeveRGB; r.legRGB = look.trouserRGB;
      r.posed = clock;

      // Old magazines fall away from where the hand strips them; a revolver dumps its whole cylinder.
      if (vfx && R > 0.5) {
        const d = rel.mag.drop;
        if (d >= 0 && lastU < d && r.reloadU >= d) {
          _v.set(0.12, -0.42, 0).applyMatrix4(_gun);
          vfx.dropMag(_v.x, _v.y, _v.z, rel.mag.rgb, rel.mag.size);
        }
        if (rel.mag.dump !== undefined && lastU < rel.mag.dump && r.reloadU >= rel.mag.dump) {
          for (let k = 0; k < 6; k++) vfx.shell(r.eject[0], r.eject[1], r.eject[2], (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, 'pistol');
        }
      }

      // Arms: shoulder to hand through a solved elbow. Right hand on the grip, left on the fore point.
      const shoulderY = 0.42 * CHAR_SCALE * look.h;
      const armT = 1.15 * look.l;
      const fwd = _body.elements;       // Column 0 is the body's forward axis, column 2 its right.
      for (let side = -1; side <= 1; side += 2) {
        _a.set(0.02, shoulderY, side * 0.31 * look.w).applyMatrix4(_body);
        if (side > 0) {
          _b.set(0, 0, 0).applyMatrix4(_gun);
        } else {
          _b.set(proto.fore[0], proto.fore[1], proto.fore[2]).applyMatrix4(_gun);
          if (handW > 0) { _v.set(hx, hy, hz).applyMatrix4(_gun); _b.lerp(_v, handW); }
          const slideHand = slide * (1 - R);
          if (slideHand > 0.01) {
            // Off hand trails on the ground through a slide.
            const hx2 = p.x - rightX * 0.62 - r.moveX * 0.3, hz2 = p.z - rightZ * 0.62 - r.moveZ * 0.3;
            _v.set(hx2, 0.14, hz2); _b.lerp(_v, slideHand);
          }
          const throwW = Math.max(r.throwHold, r.throwT > 0 ? 1 : 0);
          if (throwW > 0.01) {
            // Wind-up behind the head, release high and forward, then follow through low.
            const u = r.throwT > 0 ? 1 - r.throwT : 0;
            const k1 = Math.min(1, u / 0.42), k2 = Math.max(0, (u - 0.42) / 0.58);
            const bx = -0.38 + 1.0 * k1 - 0.3 * k2, by = 0.92 - 0.1 * k1 - 0.7 * k2, bz = -0.28 + 0.16 * k1 - 0.05 * k2;
            _v.set(bx, by, bz).applyMatrix4(_body);
            _b.lerp(_v, throwW);
            if (u < 0.42 && nH < MAX_PLAYERS) {
              const nade = GRENADE_RGB[r.throwKind] || GRENADE_RGB.frag;
              _s.set(0.26, 0.3, 0.26);
              _m.copy(_gun).scale(_s).setPosition(_b);
              _m.toArray(held.instanceMatrix.array, nH * 16);
              this._writeFx(held, nH, fade, flash, team, 0, nade);
              nH++;
            }
          }
          if (magOn > 0.5 && throwW < 0.5 && nH < MAX_PLAYERS) {
            const size = rel.mag.size;
            _s.set(size[0] * 0.9, size[1] * 0.9, size[2] * 0.9);
            _m.copy(_gun).scale(_s).setPosition(_b);
            _m.toArray(held.instanceMatrix.array, nH * 16);
            this._writeFx(held, nH, fade, flash, team, 0, rel.mag.rgb);
            nH++;
          }
        }
        // Elbows hang out and down; the pole leans back so the hands read as gripping forward.
        solveJoint(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, 0.4 * look.l, 0.44 * look.l,
          fwd[8] * side * 0.75 - fwd[0] * 0.3, -0.8, fwd[10] * side * 0.75 - fwd[2] * 0.3, _joint);
        setStretch(_m, _a.x, _a.y, _a.z, _joint[0], _joint[1], _joint[2], armT, armT);
        _m.toArray(upper.instanceMatrix.array, nU * 16);
        _m.toArray(r.pose, (side > 0 ? P.UPPER_R : P.UPPER_L) * 16);
        this._writeFx(upper, nU, fade, flash, team, 0, look.sleeveRGB);
        nU++;
        setStretch(_m, _joint[0], _joint[1], _joint[2], _b.x, _b.y, _b.z, armT, armT);
        _m.toArray(arm.instanceMatrix.array, nA * 16);
        _m.toArray(r.pose, (side > 0 ? P.FORE_R : P.FORE_L) * 16);
        this._writeFx(arm, nA, fade, flash, team, 0, look.sleeveRGB);
        nA++;
      }

      // Legs follow travel direction, independent of aim, through a stance and a swing phase.
      const legLen = 0.54 * look.h;
      const legT = 1.42 * look.l;
      const standK = 1 - Math.min(1, speed / 1.6);
      const faceX = moving ? r.moveX : aimX, faceZ = moving ? r.moveZ : aimZ;
      const bootYaw = Math.atan2(faceZ, faceX);
      const strideAmp = (0.36 + 0.26 * r.sprint) * Math.min(1, speed / 3.2) * (1 - slide);
      const duty = 0.58 - r.sprint * 0.16;
      for (let li = 0; li < 2; li++) {
        const side = li === 0 ? -1 : 1;
        let u = r.phase / TAU + li * 0.5;
        u -= Math.floor(u);
        let off, lift = 0;
        if (u < duty) off = strideAmp * (1 - 2 * (u / duty));
        else {
          const s = (u - duty) / (1 - duty), ss = s * s * (3 - 2 * s);
          off = strideAmp * (2 * ss - 1);
          lift = Math.sin(Math.PI * s) * (0.15 + 0.2 * r.sprint) * Math.min(1, speed / 3);
        }
        const wide = 0.17 * look.w;
        const hipX = bodyX + rightX * side * wide, hipZ = bodyZ + rightZ * side * wide;
        // A shooter's stance when standing: left foot leads, right foot braces.
        const stance = (side < 0 ? 0.16 : -0.14) * standK;
        let footX = p.x + rightX * side * (wide + 0.05 * standK) + aimX * stance + r.moveX * off;
        let footZ = p.z + rightZ * side * (wide + 0.05 * standK) + aimZ * stance + r.moveZ * off;
        let footY = 0.13 + lift;
        let poleX = r.moveX * 0.8 + aimX * 0.4 + rightX * side * 0.3, poleY = 0.15, poleZ = r.moveZ * 0.8 + aimZ * 0.4 + rightZ * side * 0.3;
        if (slide > 0.01) {
          // Lead leg kicks straight out, trail leg folds under the body with its knee to the side.
          const dirX = r.moveX, dirZ = r.moveZ;
          const tx = side < 0 ? hipX + dirX * 0.95 : hipX - dirX * 0.06 + rightX * 0.2;
          const tz = side < 0 ? hipZ + dirZ * 0.95 : hipZ - dirZ * 0.06 + rightZ * 0.2;
          footX += (tx - footX) * slide; footZ += (tz - footZ) * slide;
          footY += (0.13 - footY) * slide;
          if (side > 0) { poleX += (rightX * 1.0 - poleX) * slide; poleY += (0.6 - poleY) * slide; poleZ += (rightZ * 1.0 - poleZ) * slide; }
        }
        solveJoint(hipX, y, hipZ, footX, footY, footZ, legLen, legLen, poleX, poleY, poleZ, _joint);
        setStretch(_m, hipX, y, hipZ, _joint[0], _joint[1], _joint[2], legT, legT);
        _m.toArray(upper.instanceMatrix.array, nU * 16);
        _m.toArray(r.pose, (side < 0 ? P.THIGH_L : P.THIGH_R) * 16);
        this._writeFx(upper, nU, fade, flash, team, 0, look.trouserRGB);
        nU++;
        setStretch(_m, _joint[0], _joint[1], _joint[2], footX, footY, footZ, legT * 0.82, legT * 0.82);
        _m.toArray(leg.instanceMatrix.array, nL * 16);
        _m.toArray(r.pose, (side < 0 ? P.SHIN_L : P.SHIN_R) * 16);
        this._writeFx(leg, nL, fade, flash, team, 0, look.trouserRGB);
        nL++;

        _e.set(0, -bootYaw, lift * -2.2 + slide * (side < 0 ? 0.7 : -0.2));
        _q.setFromEuler(_e);
        _p.set(footX, footY, footZ);
        _s.set(1.15, 1.15, 1.15);
        _m.compose(_p, _q, _s);
        _m.toArray(boot.instanceMatrix.array, nB * 16);
        _m.toArray(r.pose, (side < 0 ? P.BOOT_L : P.BOOT_R) * 16);
        this._writeFx(boot, nB, fade, flash, team, 0, null);
        nB++;

        if (li === plantLeg && vfx && Math.abs(footX - this.focusX) < 22 && Math.abs(footZ - this.focusZ) < 16) {
          vfx.footfall(footX, footZ, r.sprint);
        }
      }
      if (vfx && slide > 0.5 && speed > 2 && Math.random() < dt * 45) vfx.slideTrail(p.x - r.moveX * 0.5, p.z - r.moveZ * 0.5);

      _p.set(p.x, 0, p.z); _q.identity();
      const local = p.id === localId;
      const ringScale = local ? 0.92 : 1.0;
      _s.set(ringScale, 1, ringScale);
      _m.compose(_p, _q, _s);
      _m.toArray(this.ring.instanceMatrix.array, nRing * 16);
      this.ring.geometry.attributes.aFx.setXY(nRing, r.reveal, local ? 1 : 0);
      this.ring.geometry.attributes.aTeam.setXYZ(nRing, team[0], team[1], team[2]);
      _s.set(0.9, 1, 0.9);
      _m.compose(_p, _q, _s);
      _m.toArray(this.blob.instanceMatrix.array, nRing * 16);
      this.blob.geometry.attributes.aFx.setXY(nRing, r.reveal, 0);
      this.blob.geometry.attributes.aTeam.setXYZ(nRing, 0, 0, 0);
      nRing++;
    }

    // No silhouettes through walls in a replay: the camera there is low, and they read as ghosts.
    this.xrayTorso.count = revealAll ? 0 : nT; this.xrayHead.count = revealAll ? 0 : nT;
    this.ring.count = nRing; this.blob.count = nRing;
    this.counts.nT = nT; this.counts.nU = nU; this.counts.nA = nA; this.counts.nL = nL; this.counts.nB = nB;
    this.corpses.step(dt, this.counts);
    torso.count = this.counts.nT; head.count = this.counts.nT;
    upper.count = this.counts.nU; arm.count = this.counts.nA; leg.count = this.counts.nL; boot.count = this.counts.nB;
    held.count = nH;
    for (let i = 0; i < this.bodyMeshes.length; i++) {
      const m = this.bodyMeshes[i];
      m.instanceMatrix.needsUpdate = true;
      const a = m.geometry.attributes;
      a.aFx.needsUpdate = true;
      a.aTeam.needsUpdate = true;
      a.aOp.needsUpdate = true;
      a.aTint.needsUpdate = true;
    }
    for (let i = 0; i < this.gunList.length; i++) {
      const m = this.gunList[i];
      if (m.count === 0) continue;
      m.instanceMatrix.needsUpdate = true;
      const a = m.geometry.attributes;
      a.aFx.needsUpdate = true; a.aCamo.needsUpdate = true; a.aAccent.needsUpdate = true; a.aHeat.needsUpdate = true;
    }
  }

  dispose() {
    for (const m of this.bodyMeshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.xrayTorso.geometry.dispose(); this.xrayHead.geometry.dispose();
    for (const m of this.gunList) { m.geometry.dispose(); m.dispose(); }
    for (const mat of [this.charMat, this.xrayMat, this.ringMat, this.blobMat, this.camoMat]) mat.dispose();
  }
}

// One operator on a slow turntable, for the Operators screen. It draws through the WebGL context the menus already
// own (GunPreview's), since a phone should not carry a second one just for this.
export class OperatorPreview {
  constructor(webgl, canvas) {
    this.webgl = webgl;
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 40);
    this.time = { value: 0 };
    this.chars = new Characters(this.scene, { walls: [] }, this.time);
    this.player = {
      id: 'preview', team: 0, x: 0, z: 0, aim: 0.6, vx: 0, vz: 0, hp: 100, alive: true,
      weapon: 'ar', camo: 'none', attachments: undefined, adsT: 0, reloadT: 0, reloadDur: 0, sprinting: false, sliding: false,
      spawnProtect: false, heat: 0, overheated: false,
    };
    this.view = { t: 0, players: [this.player], smokes: null, localId: 'preview' };
    this.opts = { localId: 'preview', localTeam: 0, uav: false, revealAll: true };
    this.spin = 0.7;
    this.w = 0; this.h = 0;
    this.show(DEFAULT_OPERATOR, 'ar', 'none', 0);
  }

  // Everything but the operator id is optional dressing; the gun shows what this loadout actually carries.
  show(operator, weapon = 'ar', camo = 'none', team = 0, attachments) {
    Object.assign(this.player, { team, weapon, camo, attachments });
    this.opts.localTeam = team;
    this.chars.setRoster([{ id: 'preview', operator }]);
  }

  tick(dt) {
    this.time.value = (this.time.value + dt) % 3600;
    this.view.t = this.time.value;
    this.spin += dt * 0.7;
    this.player.aim = this.spin;
    this.chars.update(this.view, dt, this.opts);
    const c = this.canvas, w = Math.max(1, c.clientWidth || 1), h = Math.max(1, c.clientHeight || 1);
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h;
      this.webgl.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(0, 4.3, 8.4);
    this.camera.lookAt(0, 1.0, 0);
    this.webgl.render(this.scene, this.camera);
  }

  dispose() { this.chars.dispose(); }
}
