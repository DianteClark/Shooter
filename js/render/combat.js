// Everything the 4.0 and 5.0 systems put on the battlefield that is drawn from view state and events: thrown
// equipment, burning ground, smoke, sentries, aircraft and drones, supply drops, mortar markers, sensor and
// trophy effects, jammer static, and the mode objectives (dog tags, domination flags, the hardpoint zone).
// Fixed instanced pools, nothing allocated after construction. Every kind of equipment is one model in a single
// instanced draw, and every vehicle (sentry, gunship, chopper, drones, supply crate) is one model in another.
// One-off bursts ride vfx.js batches, so they cost no draw calls of their own.
import * as THREE from 'three';
import { MeshBuilder } from './meshbuild.js';
import { castRay } from './fog.js';
import { GLSL_LIGHT, hexRGB } from './art.js';
import { prewarm } from './vfx.js';
import { TEAMS } from '../shared/constants.js';
import { smokeBlocks } from '../shared/geometry.js';
import { uploadUsed } from './dynbuf.js';
import { SND, CTF } from '../shared/modes.js';
import { sndOf } from '../sim/snd.js';
import { ctfOf } from '../sim/ctf.js';
import { EquipmentFX } from './equipment-fx.js';   // Gear wave equipment (2026-11): models, beams, burns, rings.
import { StreaksFX } from './streaks-fx.js';       // Scorestreaks overhaul (2026-11): new machines, domes, shoot-downs.

const MAX_NADES = 18;
const MAX_FIRES = 6;
const MAX_SMOKES = 6;            // Matches FogMask's budget of smoke clouds.
const BLOBS = 16;                // Puffs per cloud.
const MAX_TURRETS = 8;
const MAX_AIR = 4;               // Gunships and choppers in the air at once.
const MAX_DRONES = 4;            // UAV and Overwatch drones, one of each per team.
const MAX_DROPS = 4;
const MAX_SEEKERS = 8;           // V8: cruise missiles and swarm drones (two teams' worth).
const MAX_SUITS = 8;             // V8: Juggernaut armour drawn over a soldier.
const MAX_VEHICLES = MAX_TURRETS + MAX_AIR + MAX_DRONES + MAX_DROPS + MAX_SEEKERS + MAX_SUITS;
const MAX_SHADOWS = MAX_AIR + MAX_DRONES + MAX_SEEKERS;
const MAX_MORTARS = 12;
const MAX_MARKED = 12;
const GUNSHIP_Y = 7.5;           // Low enough to read as a craft under the fixed camera, high enough to clear walls.
const CHOPPER_Y = 5.6;           // The attack chopper flies lower than the gunship.
const DRONE_Y = 12;
const TURRET_Y = 0.84;           // Head pivot height.
const MISSILE_Y = 1.7;           // A cruise missile skims just over waist-high cover.
const SWARM_Y = 2.9;
const MISSILE_SPEED = 17, MISSILE_R = 5;   // Cosmetic copies of js/sim/sim.js MISSILE_SPEED and MISSILE_RADIUS.
const MAX_TAGS = 24;
const MAX_POINTS = 6;
const FLAG_H = 3.4;              // Pole height; tall enough to read over cover from the tilted camera.
const NEUTRAL_RGB = [0.82, 0.85, 0.88];
const CONTEST_RGB = [1.0, 0.84, 0.32];
const NADE_SCALE = 1.35;         // Equipment is drawn oversized, like the guns, so it reads at phone scale.

// Cosmetic copies of sim numbers (js/sim/sim.js, equipment.js): only how things look depends on them.
const FIRE_R = 3.2, FIRE_LIFE = 5.5;
const MORTAR_R = 4.2;
const SUPPLY_R = 14;
const FUSE = { frag: 1.8, sticky: 1.2, flash: 0.95, smoke: 2.2, cluster: 1.6, bomblet: 0.3, molotov: 3, stun: 1.1, gas: 1.5, drill: 2.1 };
// V8 equipment (js/sim/equipment.js): gas cloud radius and life, Shock reach, Claymore trigger reach and half-cone.
const GAS_R = 4.4, GAS_LIFE = 8, SHOCK_R = 4, CLAY_REACH = 3.6, CLAY_CONE = 0.6;
const GAS_RGB = [0.5, 0.62, 0.22], STUN_DUST = [0.72, 0.7, 0.64];

const damp = (k, dt) => 1 - Math.exp(-k * dt);
function slotOf(slots, id) { for (let i = 0; i < slots.length; i++) if (slots[i].id === id) return slots[i]; return null; }
const rand = (a, b) => a + Math.random() * (b - a);

// Every kind's signature colour: the band on its body, its trail, its throw preview and its burst accents.
const NADE_RGB = {
  frag: hexRGB(0xff6a1a), sticky: hexRGB(0xff2bd6), molotov: hexRGB(0xffa020), mine: hexRGB(0xff3a2a),
  cluster: hexRGB(0xffd02a), bomblet: hexRGB(0xffd02a), hatchet: hexRGB(0xc8402e), fire: hexRGB(0xff7a20),
  smoke: hexRGB(0x7dff96), flash: hexRGB(0xfff27a), stim: hexRGB(0x4bd18a), decoy: hexRGB(0x55c8ff),
  sensor: hexRGB(0x3ce6ff), trophy: hexRGB(0x9cf0ff), bomb: hexRGB(0xff3a2a),
  stun: hexRGB(0xfff0c8), gas: hexRGB(0xa6e22e), gascloud: hexRGB(0xa6e22e), shock: hexRGB(0x5ad2ff),
  impact: hexRGB(0xff4a3a), claymore: hexRGB(0xff5a2a), drill: hexRGB(0xffb020),
};
const FALLBACK = NADE_RGB.frag;
// Throw-preview danger ring for each kind, roughly its effect radius.
const BLAST_R = { frag: 6.2, sticky: 4.6, flash: 7, smoke: 4.5, molotov: FIRE_R, mine: 4.4, cluster: 6, hatchet: 0.8, decoy: 2, sensor: 13, trophy: 6.5, stim: 1.5,
  stun: 8, gas: GAS_R, shock: SHOCK_R, impact: 4.2, claymore: CLAY_REACH, drill: 3.9 };
// Deployables carry a light in the owner's team colour, so friend and foe read at a glance.
const TEAM_LIGHT = new Set(['mine', 'sensor', 'trophy', 'decoy', 'claymore', 'shock']);
const WHITE_RGB = [1, 1, 1];
// Search and Destroy: sites are sodium rings, the one with the bomb on it turns red; the bomb itself is drawn big.
const SITE_RGB = hexRGB(0xf2a63b), PLANTED_RGB = hexRGB(0xff3a2a), DEFUSE_RGB = hexRGB(0x38b6ff);
const BOMB_SCALE = 2.3;
// Capture the Flag: the stand keeps its place and its team collar; the flag itself is drawn wherever it is. On a
// carrier's back it is a short pole over the shoulder; on the ground it leans where it fell, inside its return ring.
const CARRY_SCALE = 0.6, CARRY_BACK = 0.38, CARRY_Y = 0.5;
const DROP_SCALE = 0.62, DROP_LEAN = 0.32;
const DIM_RGB = [0.16, 0.18, 0.21];
const FIRE_RGB = [1.0, 0.5, 0.15], FIRE_HOT = [1.0, 0.78, 0.32], SMOKE_RGB = [0.1, 0.09, 0.1];
const GLASS_RGB = [0.62, 0.8, 0.6], DIRT_RGB = [0.22, 0.19, 0.16];
const SENSOR_RGB = NADE_RGB.sensor, ZAP_RGB = [0.62, 0.92, 1.0], EMP_RGB = [0.55, 0.78, 1.0], HEAL_RGB = [0.3, 1.0, 0.56];
const DANGER_RGB = [1.0, 0.22, 0.14], MARK_RGB = [1.0, 0.36, 0.12];

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler(0, 0, 0, 'YZX');
const _axisZ = new THREE.Vector3(0, 0, 1), _axisY = new THREE.Vector3(0, 1, 0);
const _rgb = [0, 0, 0], _lrgb = [0, 0, 0];
function _rgbOf(r, g, b) { _lrgb[0] = r; _lrgb[1] = g; _lrgb[2] = b; return _lrgb; }

const SOLID_VERT = /* glsl */`
attribute vec3 aCol; attribute float aPart; attribute vec3 aTeam;
varying vec3 vC;
${GLSL_LIGHT}
void main(){
  mat4 w = modelMatrix * instanceMatrix;
  vec3 n = normalize(mat3(w) * normal);
  vec3 l = duskLight(n);
  // Team strips are self-lit, in the same way as character armour and gun accents.
  vC = aPart > 0.5 ? aTeam * (0.86 + 0.34 * max(0.0, n.y)) : aCol * l;
  gl_Position = projectionMatrix * viewMatrix * w * vec4(position, 1.0);
}`;

// Model sets: several models in one geometry, one instanced draw. Each vertex carries its model id; an instance
// shows one model and collapses the rest to a point. aHub.w = 1 turns a vertex about the hub by aFx.z (rotors,
// a sentry's head); aHub.w = 2 folds it into the hub by aFx.y (a parachute). aPart picks the colour: 0 baked,
// 1 the instance accent, 2 the instance light (rgb, brightness in a).
const MODEL_VERT = /* glsl */`
attribute vec3 aCol; attribute float aPart; attribute float aModel; attribute vec4 aHub;
attribute float aShow; attribute vec3 aAcc; attribute vec4 aLight; attribute vec4 aFx;
varying vec3 vC;
${GLSL_LIGHT}
void main(){
  vec3 p = position, nn = normal;
  if (aHub.w > 1.5) p = aHub.xyz + (p - aHub.xyz) * aFx.y;
  else if (aHub.w > 0.5) {
    float c = cos(aFx.z), s = sin(aFx.z);
    vec3 q = p - aHub.xyz;
    p = aHub.xyz + vec3(q.x * c - q.z * s, q.y, q.x * s + q.z * c);
    nn = vec3(nn.x * c - nn.z * s, nn.y, nn.x * s + nn.z * c);
  }
  p *= 1.0 - step(0.5, abs(aModel - aShow));
  mat4 w = modelMatrix * instanceMatrix;
  vec3 n = normalize(mat3(w) * nn);
  vC = aPart > 1.5 ? aLight.rgb * (0.3 + 1.5 * aLight.a)
     : aPart > 0.5 ? aAcc * (0.82 + 0.38 * max(0.0, n.y))
     : aCol * duskLight(n);
  gl_Position = projectionMatrix * viewMatrix * w * vec4(p, 1.0);
}`;

// Aircraft shadows: the same model set squashed flat onto the ground.
const MODEL_SHADOW_VERT = /* glsl */`
attribute float aModel; attribute float aShow;
void main(){
  vec3 p = position * (1.0 - step(0.5, abs(aModel - aShow)));
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  w.y = 0.21;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

class ModelSet {
  constructor() {
    this.b = new MeshBuilder();
    this.ranges = [];   // [start, end, model]
    this.rigs = [];     // [start, end, hx, hy, hz, flag]
  }
  model(id, fn) {
    const s = this.b.pos.length / 3;
    fn(this.b, this);
    this.ranges.push([s, this.b.pos.length / 3, id]);
  }
  // Everything fn emits turns about (flag 1) or folds into (flag 2) the hub.
  rig(hx, hy, hz, flag, fn) {
    const s = this.b.pos.length / 3;
    fn(this.b);
    this.rigs.push([s, this.b.pos.length / 3, hx, hy, hz, flag]);
  }
  build() {
    const g = this.b.build();
    const n = g.getAttribute('position').count;
    const model = new Float32Array(n), hub = new Float32Array(n * 4);
    for (const [s, e, id] of this.ranges) for (let i = s; i < e; i++) model[i] = id;
    for (const [s, e, x, y, z, f] of this.rigs) for (let i = s; i < e; i++) { hub[i * 4] = x; hub[i * 4 + 1] = y; hub[i * 4 + 2] = z; hub[i * 4 + 3] = f; }
    g.setAttribute('aModel', new THREE.Float32BufferAttribute(model, 1));
    g.setAttribute('aHub', new THREE.Float32BufferAttribute(hub, 4));
    return g;
  }
}

// ---- Equipment models. Origin at the centre, +X is the throw direction, about 0.25 m across before scaling. ----
const NADE_KINDS = ['frag', 'sticky', 'molotov', 'mine', 'cluster', 'bomblet', 'hatchet', 'smoke', 'flash', 'stim', 'decoy', 'sensor', 'trophy', 'bomb',
  'stun', 'gas', 'shock', 'impact', 'claymore', 'drill'];
const NADE_MODEL = Object.fromEntries(NADE_KINDS.map((k, i) => [k, i]));
// Height of the model's base below its origin, so a grounded one sits on the ground.
const NADE_BASE = { frag: 0.16, sticky: 0.2, molotov: 0.22, mine: 0.05, cluster: 0.2, bomblet: 0.08, hatchet: 0.06, smoke: 0.2, flash: 0.18, stim: 0.07, decoy: 0.09, sensor: 0.05, trophy: 0.2, bomb: 0.06,
  stun: 0.19, gas: 0.2, shock: 0.06, impact: 0.17, claymore: 0.2, drill: 0.09 };

function nadeModels() {
  const S = new ModelSet();
  S.model(NADE_MODEL.frag, b => {       // Ribbed olive body, orange band, fuze and spoon.
    b.setPart(0).setColor(0x4a5236).prismY(-0.16, 0.12, 0, 0, 0.19, 0.22, 6);
    b.prismY(0.12, 0.2, 0, 0, 0.22, 0.13, 6);
    b.setPart(1).prismY(-0.04, 0.03, 0, 0, 0.232, 0.232, 6);
    b.setPart(0).setColor(0x2b2e33).prismY(0.2, 0.3, 0, 0, 0.07, 0.07, 6);
    b.box(0.12, 0.2, 0, 0.24, 0.04, 0.07);
    b.setColor(0xc8c8c8).prismZ(-0.02, 0.02, -0.07, 0.3, 0.06, 0.06, 6);
  });
  S.model(NADE_MODEL.sticky, b => {     // Glowing magenta charge on a black adhesive pad.
    b.setPart(0).setColor(0x1c1c22).prismY(-0.2, -0.13, 0, 0, 0.24, 0.21, 6);
    b.setPart(1).prismY(-0.13, 0.12, 0, 0, 0.2, 0.18, 6);
    b.setPart(0).setColor(0x2a2a30).prismY(0.12, 0.2, 0, 0, 0.13, 0.1, 6);
    b.setPart(2).prismY(0.2, 0.27, 0, 0, 0.06, 0.03, 6);
  });
  S.model(NADE_MODEL.molotov, b => {    // Green bottle, rag stuffed in the neck, burning.
    b.setPart(0).setColor(0x3e5a32).prismY(-0.22, 0.05, 0, 0, 0.13, 0.14, 6);
    b.prismY(0.05, 0.13, 0, 0, 0.14, 0.055, 6);
    b.prismY(0.13, 0.27, 0, 0, 0.05, 0.05, 6);
    b.setColor(0xc8b28a).box(0, 0.3, 0, 0.11, 0.09, 0.11);
    b.setPart(2).prismY(0.33, 0.52, 0, 0, 0.08, 0.0, 5);
    b.setPart(1).box(0, -0.06, 0, 0.29, 0.07, 0.29);
  });
  S.model(NADE_MODEL.mine, b => {       // Flat disc with three prongs and a light.
    b.setPart(0).setColor(0x3c4232).prismY(-0.05, 0.04, 0, 0, 0.34, 0.31, 8);
    b.setColor(0x4e5640).prismY(0.04, 0.08, 0, 0, 0.29, 0.24, 8);
    b.setPart(1).prismY(-0.02, 0.02, 0, 0, 0.345, 0.345, 8);
    b.setPart(0).setColor(0x2a2d33);
    for (let i = 0; i < 3; i++) { const a = i * 2.094; b.box(Math.cos(a) * 0.14, 0.11, Math.sin(a) * 0.14, 0.04, 0.08, 0.04); }
    b.setPart(2).prismY(0.08, 0.13, 0, 0, 0.065, 0.05, 6);
  });
  S.model(NADE_MODEL.cluster, b => {    // Fat canister with bomblets clipped round it.
    b.setPart(0).setColor(0x3a3d42).prismY(-0.2, 0.18, 0, 0, 0.18, 0.18, 6);
    b.setPart(1).prismY(-0.14, -0.08, 0, 0, 0.185, 0.185, 6);
    b.prismY(0.08, 0.14, 0, 0, 0.185, 0.185, 6);
    for (let i = 0; i < 4; i++) { const a = i * 1.5708 + 0.785; b.prismY(-0.06, 0.06, Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.07, 0.07, 6); }
    b.setPart(0).setColor(0x22252a).prismY(0.18, 0.26, 0, 0, 0.09, 0.07, 6);
  });
  S.model(NADE_MODEL.bomblet, b => {
    b.setPart(1).prismY(-0.08, 0.06, 0, 0, 0.09, 0.09, 6);
    b.setPart(0).setColor(0x22252a).prismY(0.06, 0.12, 0, 0, 0.05, 0.02, 6);
  });
  S.model(NADE_MODEL.hatchet, b => {    // Wooden haft along X, wrapped grip, steel head with a bright edge.
    b.setPart(0).setColor(0x6a4a2e).box(-0.02, 0, 0, 0.56, 0.06, 0.07);
    b.setPart(1).box(-0.2, 0, 0, 0.18, 0.075, 0.085);
    b.setPart(0).setColor(0x5a6068).box(0.22, 0.05, 0, 0.1, 0.13, 0.06);
    b.setColor(0xb4bcc4).extrude([[0.17, 0.08], [0.3, 0.06], [0.37, 0.24], [0.2, 0.22]], -0.022, 0.022);
    b.setColor(0xeef2f4).box(0.335, 0.15, 0, 0.04, 0.17, 0.046);
  });
  S.model(NADE_MODEL.smoke, b => {      // Grey can, green band, cap.
    b.setPart(0).setColor(0x5a6066).prismY(-0.2, 0.17, 0, 0, 0.15, 0.15, 8);
    b.setPart(1).prismY(-0.02, 0.09, 0, 0, 0.156, 0.156, 8);
    b.setPart(0).setColor(0x2e3238).prismY(0.17, 0.24, 0, 0, 0.1, 0.08, 6);
    b.box(0.09, 0.15, 0, 0.18, 0.035, 0.06);
  });
  S.model(NADE_MODEL.flash, b => {      // Dark perforated can with yellow bands and a bright cap.
    b.setPart(0).setColor(0x2a2d33).prismY(-0.18, 0.16, 0, 0, 0.14, 0.14, 6);
    b.setPart(1).prismY(-0.12, -0.07, 0, 0, 0.146, 0.146, 6);
    b.prismY(0.04, 0.09, 0, 0, 0.146, 0.146, 6);
    b.setPart(2).prismY(0.16, 0.22, 0, 0, 0.09, 0.07, 6);
  });
  S.model(NADE_MODEL.stim, b => {       // Auto-injector.
    b.setPart(1).prismX(-0.16, 0.1, 0, 0, 0.06, 0.06, 6);
    b.setPart(0).setColor(0xd8dde2).prismX(0.1, 0.24, 0, 0, 0.012, 0.012, 4);
    b.setColor(0x2a2d33).prismX(-0.22, -0.16, 0, 0, 0.045, 0.045, 6);
  });
  S.model(NADE_MODEL.decoy, b => {      // Little box with a speaker grille and a whip antenna.
    b.setPart(0).setColor(0x3a3f46).box(0, 0, 0, 0.3, 0.18, 0.22, 0.02);
    b.setPart(1).box(-0.02, 0.0, 0.112, 0.2, 0.1, 0.01);
    b.box(-0.02, 0.0, -0.112, 0.2, 0.1, 0.01);
    b.setPart(0).setColor(0x22252a).prismY(0.09, 0.42, 0.1, 0.05, 0.012, 0.008, 4);
    b.setPart(2).prismY(0.4, 0.45, 0.1, 0.05, 0.03, 0.03, 5);
  });
  S.model(NADE_MODEL.sensor, b => {     // Spike, sensor dome and dish.
    b.setPart(0).setColor(0x30353b).prismY(-0.22, 0.0, 0, 0, 0.005, 0.06, 5);
    b.prismY(0.0, 0.22, 0, 0, 0.07, 0.07, 6);
    b.setPart(1).prismY(0.22, 0.28, 0, 0, 0.08, 0.2, 6);
    b.setPart(2).prismY(0.28, 0.34, 0, 0, 0.06, 0.04, 6);
  });
  S.model(NADE_MODEL.bomb, b => {       // The S&D charge: wrapped blocks, taped bands, a lit readout and its lamp.
    b.setPart(0).setColor(0x5a4a34).box(0, 0, 0, 0.34, 0.12, 0.22, 0.015);
    b.setColor(0x2b2e33).box(0.02, 0.075, 0, 0.17, 0.04, 0.13, 0.01);
    b.setPart(1).box(-0.11, 0.0, 0, 0.035, 0.126, 0.226); b.box(0.13, 0.0, 0, 0.03, 0.126, 0.226);
    b.setPart(2).box(0.02, 0.097, 0, 0.12, 0.008, 0.08);
    b.prismY(0.06, 0.125, -0.09, 0.07, 0.024, 0.018, 5);
  });
  // V8 equipment.
  S.model(NADE_MODEL.stun, b => {       // Squat white-banded can with a fat ring cap: reads as "not a frag".
    b.setPart(0).setColor(0x3a4048).prismY(-0.19, 0.12, 0, 0, 0.16, 0.16, 8);
    b.setPart(1).prismY(-0.13, -0.06, 0, 0, 0.166, 0.166, 8);
    b.prismY(0.0, 0.07, 0, 0, 0.166, 0.166, 8);
    b.setPart(0).setColor(0x22252a).prismY(0.12, 0.18, 0, 0, 0.12, 0.1, 8);
    b.setPart(2).prismY(0.18, 0.23, 0, 0, 0.07, 0.05, 6);
    b.setPart(0).setColor(0xc8c8c8).prismZ(-0.02, 0.02, 0.1, 0.24, 0.05, 0.05, 6);
  });
  S.model(NADE_MODEL.gas, b => {        // Olive canister, lime band, a valve stub on top.
    b.setPart(0).setColor(0x4c5a36).prismY(-0.2, 0.14, 0, 0, 0.15, 0.15, 8);
    b.setPart(1).prismY(-0.04, 0.05, 0, 0, 0.156, 0.156, 8);
    b.setPart(0).setColor(0x2e3238).prismY(0.14, 0.2, 0, 0, 0.11, 0.08, 6);
    b.box(0.06, 0.24, 0, 0.12, 0.05, 0.05);
    b.setPart(2).prismY(0.2, 0.26, -0.03, 0, 0.035, 0.03, 5);
  });
  S.model(NADE_MODEL.shock, b => {      // Flat puck with three prongs and a glowing coil.
    b.setPart(0).setColor(0x2a2e34).prismY(-0.06, 0.04, 0, 0, 0.26, 0.24, 8);
    b.setPart(1).prismY(-0.01, 0.02, 0, 0, 0.265, 0.265, 8);
    b.setPart(0).setColor(0x5a6068);
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.3; b.prismY(0.04, 0.17, Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0.022, 0.012, 4); }
    b.setPart(2).prismY(0.04, 0.1, 0, 0, 0.1, 0.08, 6);
  });
  S.model(NADE_MODEL.impact, b => {     // Round red-banded body with a plunger nose on +X.
    b.setPart(0).setColor(0x40464e).prismX(-0.17, 0.1, 0, 0, 0.15, 0.15, 8);
    b.setPart(1).prismX(-0.08, -0.02, 0, 0, 0.156, 0.156, 8);
    b.setPart(0).setColor(0x2a2d33).prismX(0.1, 0.19, 0, 0, 0.13, 0.06, 8);
    b.setPart(2).prismX(0.19, 0.24, 0, 0, 0.045, 0.045, 6);
  });
  S.model(NADE_MODEL.claymore, b => {   // A bowed charge on scissor legs, its face (+X) lit.
    b.setPart(0).setColor(0x4a5236).box(0, 0.02, 0, 0.09, 0.26, 0.2, 0.015);
    b.box(-0.03, 0.02, 0.17, 0.08, 0.26, 0.16, 0.015);
    b.box(-0.03, 0.02, -0.17, 0.08, 0.26, 0.16, 0.015);
    b.setPart(1).box(0.05, 0.03, 0, 0.012, 0.16, 0.16);
    b.setPart(0).setColor(0x2a2d33);
    b.prismY(-0.2, -0.1, 0.02, 0.18, 0.012, 0.02, 4); b.prismY(-0.2, -0.1, 0.02, -0.18, 0.012, 0.02, 4);
    b.prismY(-0.2, -0.1, -0.05, 0.12, 0.012, 0.02, 4); b.prismY(-0.2, -0.1, -0.05, -0.12, 0.012, 0.02, 4);
    b.setPart(2).box(-0.02, 0.17, 0, 0.05, 0.04, 0.05);
  });
  S.model(NADE_MODEL.drill, b => {      // Motor housing, a band, and a fluted bit pointing +X.
    b.setPart(0).setColor(0x3a3f46).prismX(-0.24, 0.02, 0, 0, 0.09, 0.09, 6);
    b.setPart(1).prismX(-0.12, -0.06, 0, 0, 0.095, 0.095, 6);
    b.setPart(0).setColor(0xb4bcc4).prismX(0.02, 0.26, 0, 0, 0.05, 0.005, 5);
    b.setColor(0x8a9098).prismX(0.02, 0.06, 0, 0, 0.065, 0.065, 6);
    b.setPart(2).prismX(-0.28, -0.24, 0, 0, 0.05, 0.05, 6);
  });
  S.model(NADE_MODEL.trophy, b => {     // Tripod, base and an interceptor dome.
    b.setPart(0).setColor(0x30353b);
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; b.prismY(-0.2, 0.02, Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.022, 0.022, 4); }
    b.setColor(0x3e444c).prismY(0.0, 0.08, 0, 0, 0.17, 0.15, 6);
    b.setPart(1).prismY(0.08, 0.22, 0, 0, 0.14, 0.06, 6);
    b.setPart(2).prismY(0.22, 0.28, 0, 0, 0.045, 0.045, 6);
  });
  return S.build();
}

// ---- Vehicle models. Origin on the ground (sentry, crate) or the airframe's centre; +X is the nose. ----
const VEH = { gunship: 0, chopper: 1, uav: 2, overwatch: 3, crate: 4, sentry: 5, missile: 6, drone: 7, suit: 8 };

function vehicleModels() {
  const S = new ModelSet();
  S.model(VEH.gunship, b => {
    // Seen almost straight down, so the shape is all about the top silhouette: stubby body, broad wing, twin tail.
    b.setPart(0).setColor(0x1f2329);
    b.prismX(-1.5, 2.1, 0, 0, 0.42, 0.28, 8, Math.PI / 8);
    b.prismX(2.1, 2.5, 0, 0, 0.28, 0.05, 8, Math.PI / 8);
    b.setColor(0x2a2e36);
    b.matrix = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    b.extrude([[0.7, -2.1], [0.3, -2.3], [-0.45, -0.2], [-0.45, 0.2], [0.3, 2.3], [0.7, 2.1], [0.3, 0.3], [0.3, -0.3]], -0.05, 0.05);
    b.matrix = null;
    b.box(-1.1, 0.02, 1.0, 0.8, 0.1, 0.3); b.box(-1.1, 0.02, -1.0, 0.8, 0.1, 0.3);
    b.setColor(0x343a44);
    for (const z of [-1.1, 1.1]) b.prismX(0.2, 1.0, -0.06, z, 0.13, 0.11, 6);
    b.setColor(0x15171b).prismZ(0.3, 0.75, 0.4, -0.12, 0.05, 0.05, 6);
    b.setPart(1).box(0.3, 0.1, -1.7, 0.5, 0.02, 0.45); b.box(0.3, 0.1, 1.7, 0.5, 0.02, 0.45);   // Wingtip team colour.
    b.box(-1.5, 0.3, 0, 0.5, 0.02, 0.5);
    b.setPart(2).box(0.55, 0.06, -2.15, 0.12, 0.08, 0.12); b.box(0.55, 0.06, 2.15, 0.12, 0.08, 0.12);
  });
  S.model(VEH.chopper, b => {
    // Narrow tandem-cockpit attack helicopter: stub wings with rocket pods, chin gun, a long tail and a four-blade rotor.
    b.setPart(0).setColor(0x2c3238);
    b.prismX(-0.8, 1.3, 0, 0, 0.42, 0.46, 8, Math.PI / 8);
    b.prismX(1.3, 2.1, -0.05, 0, 0.42, 0.16, 8, Math.PI / 8);
    b.setColor(0x4c6a80).box(0.95, 0.36, 0, 1.1, 0.2, 0.42);
    b.setColor(0x24292e).prismX(-3.4, -0.8, 0.14, 0, 0.1, 0.26, 6);
    b.box(-3.3, 0.48, 0, 0.5, 0.8, 0.06);
    b.box(-2.9, 0.16, 0, 0.32, 0.05, 1.1);
    b.setColor(0x30363c).box(0.15, -0.08, 0, 0.62, 0.07, 2.3);
    for (const z of [-0.95, 0.95]) {
      b.setColor(0x262a30).prismX(-0.25, 0.65, -0.24, z, 0.13, 0.13, 6);
      b.setPart(1).prismX(0.65, 0.72, -0.24, z, 0.13, 0.08, 6);
      b.setPart(0);
    }
    b.setColor(0x15171b).prismX(1.7, 2.45, -0.4, 0, 0.045, 0.045, 5);
    b.setColor(0x22252a);
    for (const z of [-0.5, 0.5]) { b.box(0.4, -0.62, z, 2.0, 0.05, 0.06); b.box(0.9, -0.48, z, 0.06, 0.26, 0.06); b.box(-0.1, -0.48, z, 0.06, 0.26, 0.06); }
    b.setPart(1).box(-1.4, 0.3, 0, 0.6, 0.08, 0.44);
    b.setPart(0).setColor(0x22252a).prismY(0.42, 0.72, 0.25, 0, 0.09, 0.07, 6);
    S.rig(0.25, 0.74, 0, 1, bb => {
      bb.setPart(0).setColor(0x1a1c20);
      bb.box(0.25, 0.75, 0, 6.6, 0.035, 0.24);
      bb.box(0.25, 0.75, 0, 0.24, 0.035, 6.6);
      bb.setColor(0x2a2e34).prismY(0.72, 0.82, 0.25, 0, 0.16, 0.12, 6);
    });
    b.setColor(0x1a1c20).box(-3.28, 0.5, 0.1, 0.06, 1.0, 0.03);
    b.setPart(2).box(-3.5, 0.92, 0, 0.1, 0.1, 0.1);
    b.box(0.2, -0.04, -1.18, 0.1, 0.08, 0.1); b.box(0.2, -0.04, 1.18, 0.1, 0.08, 0.1);
  });
  S.model(VEH.uav, b => {
    // Small reconnaissance drone: slim body, straight wing, V-tail.
    b.setPart(0).setColor(0x3a4048).prismX(-0.7, 0.8, 0, 0, 0.12, 0.07, 6);
    b.setColor(0x4a525c).box(0.05, 0.02, 0, 0.32, 0.03, 2.6);
    b.box(-0.6, 0.1, 0, 0.2, 0.18, 0.7);
    b.setPart(1).box(0.05, 0.04, 1.2, 0.3, 0.02, 0.2); b.box(0.05, 0.04, -1.2, 0.3, 0.02, 0.2);
    b.setPart(2).prismY(-0.14, -0.08, 0.25, 0, 0.05, 0.05, 6);
  });
  S.model(VEH.overwatch, b => {
    // Long-endurance drone: bulbous sensor nose, long wing, twin booms and a glowing sensor dome underneath.
    b.setPart(0).setColor(0x30363e).prismX(-1.1, 1.0, 0, 0, 0.22, 0.14, 8);
    b.prismX(1.0, 1.5, 0.02, 0, 0.24, 0.08, 8);
    b.setColor(0x3c434c).box(0.1, 0.06, 0, 0.42, 0.04, 4.6);
    for (const z of [-0.7, 0.7]) b.box(-1.2, 0.04, z, 1.8, 0.06, 0.08);
    b.box(-2.1, 0.12, 0, 0.3, 0.05, 1.5);
    b.setPart(1).box(0.1, 0.09, 2.15, 0.42, 0.02, 0.3); b.box(0.1, 0.09, -2.15, 0.42, 0.02, 0.3);
    b.setPart(2).prismY(-0.3, -0.15, 0.5, 0, 0.12, 0.16, 8);
  });
  S.model(VEH.crate, b => {
    // Supply crate on a pallet, team stripe round it, and a parachute that folds away once it lands.
    b.setPart(0).setColor(0x4a3c2a).box(0, 0.07, 0, 1.25, 0.14, 0.95);
    b.setColor(0x4e5a3c).box(0, 0.6, 0, 1.15, 0.92, 0.85, 0.04);
    b.setColor(0x3c4630).box(0, 1.07, 0, 1.18, 0.05, 0.88);
    b.setPart(1).box(0, 0.62, 0, 1.17, 0.14, 0.87);
    b.setPart(0).setColor(0xe8e4d8).box(0, 1.1, 0, 0.5, 0.02, 0.14); b.box(0, 1.1, 0, 0.14, 0.02, 0.5);
    b.setPart(2).box(0.45, 1.14, 0.3, 0.12, 0.08, 0.12);
    S.rig(0, 1.1, 0, 2, bb => {
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
        bb.setPart(0).setColor(i % 2 ? 0xe2dccc : 0xd8743a);
        bb.loft([
          [[0, 4.3, 0], [Math.cos(a0) * 0.2, 4.3, Math.sin(a0) * 0.2], [Math.cos(a1) * 0.2, 4.3, Math.sin(a1) * 0.2]],
          [[0, 3.6, 0], [Math.cos(a0) * 1.7, 3.6, Math.sin(a0) * 1.7], [Math.cos(a1) * 1.7, 3.6, Math.sin(a1) * 1.7]],
        ]);
      }
      bb.setColor(0x9a9488);
      for (const [x, z] of [[0.5, 0.36], [-0.5, 0.36], [0.5, -0.36], [-0.5, -0.36]]) bb.prismY(1.1, 3.6, x, z, 0.012, 0.012, 3);
    });
  });
  S.model(VEH.sentry, b => {
    // Tripod and column, then a head that turns as one rig: armoured box, shield plate, barrel and ammo can.
    b.setPart(0).setColor(0x2a2d33).prismY(0, 0.1, 0, 0, 0.42, 0.36, 8);
    b.setColor(0x3a3f47).prismY(0.1, TURRET_Y - 0.1, 0, 0, 0.12, 0.1, 6);
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3 + 0.5;
      b.box(Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5, 0.52, 0.09, 0.13);
    }
    S.rig(0, 0, 0, 1, bb => {
      const y = TURRET_Y;
      bb.setPart(0).setColor(0x3a3f47).box(0.05, y + 0.05, 0, 0.76, 0.34, 0.46, 0.05);
      bb.setColor(0x4a5058).box(0.48, y + 0.1, 0, 0.06, 0.5, 0.62, 0.02);
      bb.setPart(1).box(-0.02, y + 0.24, 0, 0.58, 0.05, 0.36);
      bb.setPart(0).setColor(0x1c1f24).prismX(0.5, 1.45, y + 0.06, 0, 0.075, 0.068, 6);
      bb.box(1.48, y + 0.06, 0, 0.16, 0.15, 0.18, 0.03);
      bb.setColor(0x4c5a67).box(-0.14, y + 0.02, 0.3, 0.32, 0.22, 0.16, 0.03);
      bb.setPart(2).box(0.5, y + 0.3, 0.16, 0.08, 0.06, 0.06);
    });
  });
  S.model(VEH.missile, b => {
    // Long dark body, a bright team band and nose, four fins and a hot nozzle: reads as an arrow from straight above.
    b.setPart(0).setColor(0x2a2e34).prismX(-1.1, 0.9, 0, 0, 0.17, 0.17, 8, Math.PI / 8);
    b.setColor(0xd8d4c8).prismX(0.9, 1.45, 0, 0, 0.17, 0.02, 8, Math.PI / 8);
    b.setPart(1).prismX(0.35, 0.6, 0, 0, 0.18, 0.18, 8, Math.PI / 8);
    b.setPart(0).setColor(0x3a3f47);
    b.box(-0.85, 0, 0, 0.4, 0.04, 0.9); b.box(-0.85, 0, 0, 0.4, 0.9, 0.04);
    b.box(0.2, 0, 0, 0.5, 0.03, 0.62);
    b.setPart(2).prismX(-1.3, -1.1, 0, 0, 0.1, 0.14, 8);
  });
  S.model(VEH.drone, b => {
    // Small quadcopter: a body pod, four arms, a spinning rotor on each and a warhead slung underneath.
    b.setPart(0).setColor(0x2c3036).box(0, 0, 0, 0.42, 0.14, 0.3, 0.03);
    b.setColor(0x3a3f47);
    b.box(0, 0, 0, 1.15, 0.05, 0.07); b.box(0, 0, 0, 0.07, 0.05, 1.15);
    b.setColor(0x1c1f24).prismY(-0.26, -0.07, 0, 0, 0.1, 0.12, 6);
    b.setPart(1).box(0, 0.08, 0, 0.24, 0.03, 0.18);
    for (const [x, z] of [[0.55, 0], [-0.55, 0], [0, 0.55], [0, -0.55]]) {
      S.rig(x, 0.06, z, 1, bb => {
        bb.setPart(0).setColor(0x15171b).box(x, 0.06, z, 0.5, 0.015, 0.07);
        bb.box(x, 0.06, z, 0.07, 0.015, 0.5);
      });
    }
    b.setPart(2).box(0.24, 0.02, 0, 0.06, 0.06, 0.1);
  });
  S.model(VEH.suit, b => {
    // Juggernaut plates, worn over the soldier at hip height and above: slab pauldrons, chest and back plates, a gorget
    // and a visor bar. Wider than any operator, so the outline from above says "armoured" at a glance.
    const y = 0.95;
    b.setPart(0).setColor(0x353a40);
    for (const z of [-0.46, 0.46]) b.box(0, y + 0.74, z, 0.5, 0.24, 0.34, 0.05);
    b.setColor(0x2a2e33).box(0.27, y + 0.42, 0, 0.12, 0.56, 0.66, 0.04);
    b.box(-0.3, y + 0.42, 0, 0.14, 0.6, 0.7, 0.04);
    b.setColor(0x40464e).prismY(y + 0.72, y + 0.86, 0, 0, 0.3, 0.26, 8, Math.PI / 8);
    b.setPart(1);
    for (const z of [-0.46, 0.46]) b.box(0, y + 0.87, z, 0.42, 0.03, 0.22);
    b.box(-0.3, y + 0.74, 0, 0.1, 0.04, 0.5);
    b.setPart(2).box(0.31, y + 0.62, 0, 0.05, 0.06, 0.42);
  });
  return S.build();
}

// A unit disc as a fan, with (angle 0..1, radius 0..1) per vertex.
function discGeometry(sides) {
  const pos = [], ring = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    pos.push(0, 0, 0, Math.cos(a1), 0, Math.sin(a1), Math.cos(a0), 0, Math.sin(a0));
    ring.push((i + 0.5) / sides, 0, (i + 1) / sides, 1, i / sides, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 2));
  return g;
}

// Burning ground: two octaves of drifting value noise in world space, so neighbouring patches never repeat.
const FIRE_VERT = /* glsl */`
attribute vec2 aRing; attribute vec4 aF;
varying vec2 vR; varying vec4 vF; varying vec2 vW;
void main(){
  vR = aRing; vF = aF;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FIRE_FRAG = /* glsl */`
uniform float uTime;
varying vec2 vR; varying vec4 vF; varying vec2 vW;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  float r = vR.y, t = uTime * 1.7 + vF.x * 17.0;
  float f = n(vW * 1.5 + vec2(t * 0.6, -t)) * 0.62 + n(vW * 3.9 - vec2(t * 1.2, t * 0.5)) * 0.38;
  float edge = 1.0 - smoothstep(0.55, 1.0, r + (f - 0.5) * 0.45);
  float heat = clamp(f * 1.6 - r * 0.55, 0.0, 1.0);
  vec3 c = mix(vec3(0.5, 0.05, 0.02), vec3(1.0, 0.46, 0.08), heat);
  c = mix(c, vec3(1.0, 0.88, 0.45), smoothstep(0.72, 1.0, heat));
  float a = edge * (0.3 + 0.7 * heat) * vF.y;
  gl_FragColor = vec4(c * a * 1.2, 0.0);
}`;

// Jammer and EMP interference: a full-screen triangle of animated static, strongest at the edges.
const STATIC_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const STATIC_FRAG = /* glsl */`
uniform float uAmt, uTime;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 px = floor(vUv * vec2(240.0, 135.0));
  float s = h(px + floor(uTime * 24.0) * 7.31);
  float scan = 0.55 + 0.45 * sin(vUv.y * 420.0 + uTime * 30.0);
  float roll = 1.0 - smoothstep(0.0, 0.05, abs(fract(vUv.y * 1.3 - uTime * 0.45) - 0.5));
  float edge = smoothstep(0.18, 0.72, length((vUv - 0.5) * vec2(1.0, 1.25)));
  float a = uAmt * ((0.08 + 0.2 * edge) * s * scan + roll * 0.16);
  vec3 c = mix(vec3(0.55, 0.65, 0.8), vec3(1.0), s);
  gl_FragColor = vec4(c * a, a);
}`;

// A dog tag on a loop of chain: flat enough to flash as it spins, big enough to spot at phone scale.
function tagGeometry() {
  const b = new MeshBuilder();
  b.setPart(1).box(0, 0, 0, 0.42, 0.28, 0.05, 0.02);
  b.setPart(0).setColor(0xeef2f4).box(0.02, 0, 0.032, 0.26, 0.05, 0.012);     // Stamped line: the glint on the face.
  b.box(0.02, -0.08, 0.032, 0.17, 0.035, 0.012);
  b.setColor(0xa9b2bb).prismZ(-0.018, 0.018, -0.25, 0.1, 0.075, 0.075, 6);    // Chain ring.
  return b.build();
}

// Pole and foot of a domination flag; the pivot is on the ground.
function flagStandGeometry() {
  const b = new MeshBuilder();
  b.setPart(0).setColor(0x2a2d33).prismY(0, 0.16, 0, 0, 0.42, 0.34, 8);
  b.setPart(1).prismY(0.16, 0.24, 0, 0, 0.33, 0.28, 8);                       // Team collar so the base shows the owner too.
  b.setPart(0).setColor(0x8b95a0).prismY(0.2, FLAG_H, 0, 0, 0.05, 0.04, 6);
  b.setColor(0xd8dee4).prismY(FLAG_H, FLAG_H + 0.12, 0, 0, 0.09, 0.03, 6);
  return b.build();
}

// A strip of cloth along +X, attached to the pole at x = 0. Six sections, so the wave reads as folds.
function flagClothGeometry() {
  const b = new MeshBuilder();
  const SEG = 6, W = 1.5, TOP = FLAG_H - 0.05, BOT = TOP - 0.92;
  for (let i = 0; i < SEG; i++) {
    const x0 = (i / SEG) * W, x1 = ((i + 1) / SEG) * W;
    b.setPart(1).quad([x0, BOT, 0], [x1, BOT, 0], [x1, TOP, 0], [x0, TOP, 0]);
    b.quad([x0, TOP, 0], [x1, TOP, 0], [x1, BOT, 0], [x0, BOT, 0]);
  }
  return b.build();
}

// A unit disc built as a fan. aRing carries (angle 0..1, radius 0..1) so the fragment shader can draw the rim,
// the capture arc and the marching dashes without any textures.
function zoneDiscGeometry() {
  const SIDES = 72, pos = [], ring = [];
  for (let i = 0; i < SIDES; i++) {
    const a0 = (i / SIDES) * Math.PI * 2, a1 = ((i + 1) / SIDES) * Math.PI * 2;
    pos.push(0, 0, 0, Math.cos(a1), 0, Math.sin(a1), Math.cos(a0), 0, Math.sin(a0));
    ring.push((i + 0.5) / SIDES, 0, (i + 1) / SIDES, 1, i / SIDES, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 2));
  return g;
}

// An open cylinder of height 1: the shimmering wall around a hardpoint.
function zoneWallGeometry() {
  const SIDES = 48, pos = [], ring = [];
  for (let i = 0; i < SIDES; i++) {
    const a0 = (i / SIDES) * Math.PI * 2, a1 = ((i + 1) / SIDES) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    pos.push(c0, 0, s0, c1, 0, s1, c1, 1, s1, c0, 0, s0, c1, 1, s1, c0, 1, s0);
    const u0 = i / SIDES, u1 = (i + 1) / SIDES;
    ring.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 2));
  return g;
}

function zoneInstanceAttrs(g, cap) {
  const add = (name, n) => g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage));
  add('aOwner', 3);
  add('aCapture', 3);
  add('aZone', 4);      // arc 0..1 (capture progress), contested, rim width as a fraction of radius, hardpoint flag.
  return g;
}

// A blob's place inside its cloud; golden-angle spacing so the blobs fill the circle evenly.
function blobTable() {
  const t = [];
  for (let i = 0; i < BLOBS; i++) {
    const k = (i + 0.5) / BLOBS, a = i * 2.39996;
    t.push({ dx: Math.cos(a) * Math.sqrt(k) * 0.7, dz: Math.sin(a) * Math.sqrt(k) * 0.7, y: 0.5 + (i % 4) * 0.5, size: 0.3 + (i % 4) * 0.055, phase: a });
  }
  return t;
}

export class CombatFX {
  constructor(scene, vfx, map, time) {
    this.scene = scene;
    this.vfx = vfx;
    this.time = time;
    this.map = map;
    this.visionWalls = map.walls.filter(w => w.blocksVision);
    this.teamRGB = TEAMS.map(t => hexRGB(t.color));
    this.trailClock = 0;
    this.smokeAlpha = 1;             // A replay camera sits low and close, where a cloud would block the whole shot.
    this.teamOf = new Map();         // Player id -> team, refreshed from the view each frame.
    this.posOf = new Map();          // Player id -> view entry, for anything positioned on a player.
    this.localTeam = 0;

    this.solidMat = new THREE.ShaderMaterial({
      vertexShader: SOLID_VERT,
      fragmentShader: `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`,
    });
    this.modelMat = new THREE.ShaderMaterial({
      vertexShader: MODEL_VERT,
      fragmentShader: `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`,
    });
    this.nades = this.#modelMesh(nadeModels(), MAX_NADES, 3);
    this.gear = new EquipmentFX(this, { ModelSet, NADE_RGB, BLAST_R });
    this.streakFx = new StreaksFX(this, { ModelSet });
    this.vehicles = this.#modelMesh(vehicleModels(), MAX_VEHICLES, 2);

    // Aircraft shadows reuse the vehicle geometry's vertices with their own instance list.
    const sg = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'aModel']) sg.setAttribute(k, this.vehicles.geometry.getAttribute(k));
    sg.setAttribute('aShow', new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHADOWS), 1).setUsage(THREE.DynamicDrawUsage));
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: MODEL_SHADOW_VERT,
      fragmentShader: `void main(){ gl_FragColor = vec4(0.02, 0.015, 0.05, 0.55); }`,
      transparent: true, depthWrite: false,
    });
    this.shadow = this.#mesh(new THREE.InstancedMesh(sg, this.shadowMat, MAX_SHADOWS), 1);

    this.#buildFire();
    this.#buildStatic();
    this.#buildSmoke();
    this.#buildObjectives();
    for (const m of [this.zones, this.zoneWalls, this.smokeMesh]) m.instanceMatrix.array.fill(0);

    this.nadeSlots = Array.from({ length: MAX_NADES }, () => ({ id: null, roll: 0, yaw: 0, spin: 0, touched: false }));
    this.fireSlots = Array.from({ length: MAX_FIRES }, () => ({ id: null, x: 0, z: 0, age: 0, a: 0, live: false, acc: 0, smoke: 0, pop: 0, seed: 0 }));
    this.turretSlots = Array.from({ length: MAX_TURRETS }, () => ({ id: null, aim: 0, age: 0, touched: false }));
    this.airSlots = Array.from({ length: MAX_AIR }, () => ({ active: false, kind: '', team: 0, x: 0, z: 0, aim: 0, bank: 0, pitch: 0, rotor: 0, vx: 0, vz: 0, dust: 0, y: 0 }));
    this.seekSlots = Array.from({ length: MAX_SEEKERS }, () => ({ active: false, kind: '', team: 0, owner: null, x: 0, z: 0, aim: 0, bank: 0, rotor: 0, trail: 0, age: 0 }));
    this.dropSlots = Array.from({ length: MAX_DROPS }, () => ({ t: -1, x: 0, z: 0, team: 0, flare: 0 }));
    this.mortars = Array.from({ length: MAX_MORTARS }, () => ({ t: -1, delay: 1, x: 0, z: 0, team: 0 }));
    this.marked = Array.from({ length: MAX_MARKED }, () => ({ id: null, until: 0 }));
    this.empT = -9;                  // Clock of the last EMP, so aircraft that vanish right after it go down in flames.
    this.staticAmt = 0;
    this.staticBurst = 0;

    // Draw every pool once, invisibly, in the first frames: see prewarm in vfx.js.
    prewarm([this.nades, this.vehicles, this.shadow, this.fireMesh, this.smokeMesh, this.tagMesh, this.flagStand, this.flagCloth, this.zones, this.zoneWalls]);
  }

  #mesh(m, order) {
    m.frustumCulled = false;
    m.count = 0;
    m.renderOrder = order;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceMatrix.array.fill(0);        // A zero matrix in every slot: an unused slot can never show up.
    this.scene.add(m);
    return m;
  }

  #instanced(geom, cap, mat, order) {
    if (!geom.getAttribute('aTeam')) {
      geom.setAttribute('aTeam', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
    }
    return this.#mesh(new THREE.InstancedMesh(geom, mat, cap), order);
  }

  #modelMesh(geom, cap, order) {
    const add = (name, n) => geom.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage));
    add('aShow', 1); add('aAcc', 3); add('aLight', 4); add('aFx', 4);
    return this.#mesh(new THREE.InstancedMesh(geom, this.modelMat, cap), order);
  }

  #buildFire() {
    const g = discGeometry(24);
    g.setAttribute('aF', new THREE.InstancedBufferAttribute(new Float32Array(MAX_FIRES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    this.fireMat = new THREE.ShaderMaterial({
      vertexShader: FIRE_VERT, fragmentShader: FIRE_FRAG, uniforms: { uTime: this.time },
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.fireMesh = this.#mesh(new THREE.InstancedMesh(g, this.fireMat, MAX_FIRES), 4);
  }

  #buildStatic() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.staticU = { uAmt: { value: 0 }, uTime: this.time };
    this.staticMat = new THREE.ShaderMaterial({
      vertexShader: STATIC_VERT, fragmentShader: STATIC_FRAG, uniforms: this.staticU,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.staticMesh = new THREE.Mesh(g, this.staticMat);
    this.staticMesh.frustumCulled = false;
    this.staticMesh.renderOrder = 990;
    this.staticMesh.visible = true;          // Shown for the prewarm frames, then only while it has something to show.
    this.staticWarm = 3;
    this.scene.add(this.staticMesh);
  }

  #buildSmoke() {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.computeVertexNormals();
    const cap = MAX_SMOKES * BLOBS;
    g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    this.smokeMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aAlpha; varying float vA; varying vec3 vL; varying float vN;
        ${GLSL_LIGHT}
        void main(){
          mat4 w = modelMatrix * instanceMatrix;
          vec3 n = normalize(mat3(w) * normal);
          vec4 wp = w * vec4(position, 1.0);
          vL = duskLight(n);
          vN = max(dot(n, normalize(cameraPosition - wp.xyz)), 0.0);
          vA = aAlpha;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vL; varying float vN;
        void main(){
          // Light steel-blue cloud, thin only at the outermost facets, so it reads as a wall and not a haze.
          float a = vA * (0.82 + 0.18 * smoothstep(0.1, 0.6, vN));
          vec3 c = vec3(0.3, 0.33, 0.39) * vL;
          gl_FragColor = vec4(c * a, a);
        }`,
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.smokeMesh = new THREE.InstancedMesh(g, this.smokeMat, cap);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.count = 0;
    this.smokeMesh.renderOrder = 7;
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.smokeMesh);
    this.blobs = blobTable();
    this.smokeSlots = Array.from({ length: MAX_SMOKES }, () => ({ id: null, live: false, x: 0, z: 0, r: 1, a: 0 }));
    this.vfx.smokeClouds = this.smokeSlots;      // Rounds fired through a cloud stir it (VFX.gunTracer).
  }

  #buildObjectives() {
    const uTime = this.time;
    // Tags: the solid material already does self-lit team colour, which is exactly the glow they need.
    this.tagMesh = this.#instanced(tagGeometry(), MAX_TAGS, this.solidMat, 3);
    this.tagSlots = Array.from({ length: MAX_TAGS }, () => ({ id: null, x: 0, z: 0, team: 0, age: 0, seen: false, phase: 0, touched: false }));

    this.flagStand = this.#instanced(flagStandGeometry(), MAX_POINTS, this.solidMat, 2);
    this.flagMat = new THREE.ShaderMaterial({
      uniforms: { uTime },
      vertexShader: `
        attribute vec3 aCol; attribute float aPart; attribute vec3 aTeam;
        uniform float uTime;
        varying vec3 vC;
        void main(){
          vec3 p = position;
          float k = p.x / 1.5;
          float wave = sin(uTime * 7.0 - p.x * 4.2) * 0.13 * k + sin(uTime * 3.1 - p.x * 2.3) * 0.08 * k;
          p.z += wave;
          p.y -= k * k * 0.1;
          vC = aTeam * (0.82 + 0.45 * cos(uTime * 7.0 - p.x * 4.2) * k);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: 'varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }',
      side: THREE.DoubleSide,
    });
    this.flagCloth = this.#instanced(flagClothGeometry(), MAX_POINTS, this.flagMat, 2);

    this.zoneMat = new THREE.ShaderMaterial({
      uniforms: { uTime },
      vertexShader: `
        attribute vec2 aRing; attribute vec3 aOwner; attribute vec3 aCapture; attribute vec4 aZone;
        varying vec2 vRing; varying vec3 vOwner; varying vec3 vCapture; varying vec4 vZone;
        void main(){
          vRing = aRing; vOwner = aOwner; vCapture = aCapture; vZone = aZone;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vRing; varying vec3 vOwner; varying vec3 vCapture; varying vec4 vZone;
        void main(){
          float ang = vRing.x, rad = vRing.y, width = vZone.z, contested = vZone.y;
          float rim = smoothstep(1.0 - width - 0.012, 1.0 - width, rad) * (1.0 - smoothstep(0.986, 1.0, rad));
          // Marching dashes so the boundary visibly moves even on a still screen.
          float speed = contested > 0.5 ? 2.4 : 0.8;
          float dash = step(0.42, fract(ang * 36.0 - uTime * speed));
          vec3 col = ang < vZone.x ? vCapture : vOwner;
          float pulse = contested > 0.5 ? 0.55 + 0.45 * sin(uTime * 15.0) : 1.0;
          if (contested > 0.5 && dash < 0.5) col = vec3(1.0, 0.84, 0.32);
          float a = rim * mix(0.5, 1.0, dash) * pulse;
          // A faint floor wash marks the inside, and the hardpoint wash breathes so the zone is obvious from afar.
          float wash = (1.0 - rim) * (vZone.w > 0.5 ? 0.17 + 0.06 * sin(uTime * 3.4) : 0.1);
          vec3 washCol = vOwner * 0.9;
          gl_FragColor = a > wash ? vec4(col * a, a) : vec4(washCol * wash, wash);
        }`,
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const zoneGeom = zoneInstanceAttrs(zoneDiscGeometry(), MAX_POINTS);
    this.zones = new THREE.InstancedMesh(zoneGeom, this.zoneMat, MAX_POINTS);
    this.zones.frustumCulled = false;
    this.zones.count = 0;
    this.zones.renderOrder = 1;
    this.zones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.zones);

    this.wallMat = new THREE.ShaderMaterial({
      uniforms: { uTime },
      vertexShader: `
        attribute vec2 aRing; attribute vec3 aOwner; attribute vec4 aZone;
        varying vec2 vRing; varying vec3 vOwner; varying float vContested;
        void main(){
          vRing = aRing; vOwner = aOwner; vContested = aZone.y;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vRing; varying vec3 vOwner; varying float vContested;
        void main(){
          float h = vRing.y;
          float fade = pow(1.0 - h, 1.6);
          float stripe = 0.6 + 0.4 * step(0.5, fract(vRing.x * 48.0 + uTime * 0.9));
          float flick = vContested > 0.5 ? 0.6 + 0.4 * sin(uTime * 18.0) : 0.9;
          float a = fade * stripe * flick * 0.82;
          vec3 c = (vContested > 0.5 ? vec3(1.0, 0.8, 0.3) : vOwner);
          gl_FragColor = vec4(c * a, a * 0.5);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const wallGeom = zoneInstanceAttrs(zoneWallGeometry(), MAX_POINTS);
    this.zoneWalls = new THREE.InstancedMesh(wallGeom, this.wallMat, MAX_POINTS);
    this.zoneWalls.frustumCulled = false;
    this.zoneWalls.count = 0;
    this.zoneWalls.renderOrder = 6;
    this.zoneWalls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.zoneWalls);
  }

  // Everything visible this frame is rebuilt from the view; slots only keep the bits of history that smooth it.
  update(view, dt, localX, localZ, localTeam, uav, hasLocal) {
    this.localTeam = localTeam;
    const ps = view.players;
    if (ps) for (let i = 0; i < ps.length; i++) { this.teamOf.set(ps[i].id, ps[i].team); this.posOf.set(ps[i].id, ps[i]); }
    this.#updateTags(view, dt, localX, localZ, localTeam, hasLocal);
    this.lastCtf = view.mode === 'ctf' ? ctfOf(view) : null;
    this.#updatePoints(view, dt);
    this.#updateNades(view, dt, localX, localZ, localTeam, hasLocal);
    this.gear.update(view, dt, localX, localZ, localTeam, hasLocal);
    this.streakFx.update(view, dt, localX, localZ, localTeam, uav, hasLocal);
    this.#updateFires(view, dt, localX, localZ, hasLocal);
    this.#updateSmoke(view, dt);
    this.#updateVehicles(view, dt, localX, localZ, localTeam, uav, hasLocal);
    this.#updateMortars(dt, localTeam);
    this.#updateMarked(view, localTeam);
    this.#updateStatic(view, dt);
    this.#updateThrowArc(view);
  }

  // Events for everything the systems added. Drawn only where the local player could see them, except warnings.
  onEvents(events, localId, localTeam) {
    if (!events) return;
    this.gear.onEvents(events, localId, localTeam);
    this.streakFx.onEvents(events, localId, localTeam);
    const vfx = this.vfx;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.t) {
        // Hit feedback in the world for the local player's own rounds: armour throws sparks back, a kill is
        // confirmed with a ring where it happened.
        case 'hit': {
          if (ev.by !== localId || !ev.armor) break;
          const me = this.posOf.get(localId);
          let dx = me ? ev.x - me.x : 0, dz = me ? ev.z - me.z : 0;
          const l = Math.hypot(dx, dz) || 1;
          vfx.armorHit(ev.x, ev.z, dx / l, dz / l);
          break;
        }
        case 'kill': if (ev.by === localId && ev.target !== localId) vfx.killConfirm(ev.x, ev.z, !!ev.head); break;
        case 'bang': this.#bangExtras(ev); break;
        case 'ctf': this.#flagBurst(ev); break;
        case 'pulse': {
          const mine = this.teamOf.get(ev.by) === localTeam;
          vfx.ring(ev.x, ev.z, 0.3, ev.r || 13, 0.9, SENSOR_RGB, mine ? 0.95 : 0.5);
          vfx.ring(ev.x, ev.z, 0.2, (ev.r || 13) * 0.55, 0.6, WHITE_RGB, mine ? 0.5 : 0.25);
          vfx.tracer(ev.x, 0.2, ev.z, ev.x, 7, ev.z, SENSOR_RGB, 0.12, 7, 0.25, 40);
          vfx.pop(ev.x, 1.5, ev.z, 8, SENSOR_RGB, 0.35);
          break;
        }
        case 'marked': {
          if (this.teamOf.get(ev.by) !== localTeam) break;
          let s = slotOf(this.marked, ev.id) || slotOf(this.marked, null);
          if (!s) s = this.marked[0];
          s.id = ev.id; s.until = this.time.value + (ev.dur || 4);
          break;
        }
        case 'decoy': {
          const p = this.posOf.get(localId);
          if (p && !this.#clear(p.x, p.z, ev.x, ev.z, null)) break;
          const aim = Math.random() * Math.PI * 2, rgb = this.teamRGB[ev.team ?? 0] || this.teamRGB[0];
          vfx.muzzleFlash(ev.x, 0.45, ev.z, aim, FIRE_HOT, 0.5);
          vfx.tracer(ev.x, 0.45, ev.z, ev.x + Math.cos(aim) * 12, 0.9, ev.z + Math.sin(aim) * 12, rgb, 0.08);
          break;
        }
        case 'zap': this.#zap(ev); break;
        case 'gear': this.#gear(ev); break;
        case 'fried': this.#zap({ ox: ev.ox, oz: ev.oz, x: ev.x, z: ev.z }); vfx.pop(ev.x, 0.6, ev.z, 3, NADE_RGB.shock, 0.3); break;
        case 'drone_down':
          vfx.sparks(ev.x, SWARM_Y, ev.z, 0, 0, WHITE_RGB, 8, 6);
          vfx.pop(ev.x, SWARM_Y, ev.z, 2, FIRE_HOT, 0.2);
          break;
        case 'hit':
          // Rounds into Juggernaut armour spark off the plates instead of drawing blood.
          if (ev.armor) vfx.sparks(ev.x, 1.5, ev.z, 0, 0, FIRE_HOT, 5, 6);
          break;
        case 'armor_break':
          for (let k = 0; k < 8; k++) vfx.shard(ev.x, 1.6, ev.z, rand(-5, 5), rand(2, 6), rand(-5, 5), DIM_RGB, rand(0.8, 1.4));
          vfx.ring(ev.x, ev.z, 0.2, 2.6, 0.35, FIRE_HOT, 0.9);
          vfx.sparks(ev.x, 1.6, ev.z, 0, 0, FIRE_HOT, 12, 9);
          break;
        case 'incoming': {
          let s = null;
          for (let k = 0; k < this.mortars.length; k++) if (this.mortars[k].t < 0) { s = this.mortars[k]; break; }
          if (!s) break;
          s.t = 0; s.delay = ev.delay || 1.4; s.x = ev.x; s.z = ev.z; s.team = ev.team ?? 0;
          break;
        }
        case 'streak': {
          if (ev.kind === 'resupply' && Number.isFinite(ev.x)) {
            for (let k = 0; k < this.dropSlots.length; k++) {
              const d = this.dropSlots[k];
              if (d.t >= 0) continue;
              d.t = 0; d.x = ev.x; d.z = ev.z; d.team = ev.team ?? 0; d.flare = 0;
              break;
            }
          } else if (ev.kind === 'emp') this.#emp(ev, localTeam);
          else if (ev.kind === 'juggernaut' && Number.isFinite(ev.x)) {
            const rgb = this.teamRGB[ev.team ?? 0] || this.teamRGB[0];
            vfx.ring(ev.x, ev.z, 0.3, 3.2, 0.45, rgb, 0.9);
            vfx.ring(ev.x, ev.z, 0.2, 1.6, 0.3, WHITE_RGB, 0.8);
            vfx.sparks(ev.x, 1.6, ev.z, 0, 0, FIRE_HOT, 10, 6);
          }
          else if (ev.kind === 'jammer' && ev.team !== localTeam) this.staticBurst = 1;
          break;
        }
        case 'gunship_shot': {
          if (ev.kind !== 'chopper') break;
          const a = Math.atan2(ev.z - ev.oz, ev.x - ev.ox);
          vfx.muzzleFlash(ev.ox + Math.cos(a) * 2.3, CHOPPER_Y - 0.4, ev.oz + Math.sin(a) * 2.3, a, FIRE_HOT, 0.7);
          if (Math.random() < 0.5) vfx.shell(ev.ox, CHOPPER_Y - 0.5, ev.oz, -Math.sin(a), Math.cos(a), 'rifle');
          break;
        }
        default: break;
      }
    }
  }

  // Kind-specific extras on top of the shared grenade burst the renderer plays for every bang.
  #bangExtras(ev) {
    const vfx = this.vfx, x = ev.x, z = ev.z;
    switch (ev.kind) {
      case 'molotov':
        for (let i = vfx._n(14); i > 0; i--) {
          const a = rand(0, Math.PI * 2), s = rand(3, 9);
          vfx.shard(x, 0.6, z, Math.cos(a) * s, rand(2, 6), Math.sin(a) * s, GLASS_RGB, rand(0.3, 0.6));
        }
        for (let i = vfx._n(18); i > 0; i--) {
          const a = rand(0, Math.PI * 2), s = rand(1.5, 5);
          vfx.spawn(x, 0.3, z, Math.cos(a) * s, rand(1, 4), Math.sin(a) * s, rand(0.35, 0.7), 0.5, 0.1, i % 2 ? FIRE_RGB : FIRE_HOT, 0, -1.5, 1.6, 0.03);
        }
        vfx.fireball(x, 0.6, z, FIRE_R * 0.8, 0.5);
        vfx.scorch(x, z, FIRE_R * 0.9);
        break;
      case 'sticky':
        for (let i = vfx._n(12); i > 0; i--) {
          const a = rand(0, Math.PI * 2), s = rand(8, 18);
          vfx.spawn(x, 0.6, z, Math.cos(a) * s, rand(2, 8), Math.sin(a) * s, rand(0.2, 0.4), 0.14, 0.02, NADE_RGB.sticky, 0, 14, 1.4, 0.04);
        }
        vfx.ring(x, z, 0.2, (ev.r || 4.6) * 1.1, 0.3, NADE_RGB.sticky, 0.8);
        break;
      case 'mine':
        // The charge throws earth up in a column rather than out in a ball.
        for (let i = vfx._n(16); i > 0; i--) {
          const a = rand(0, Math.PI * 2), s = rand(0.5, 2.5);
          vfx.spawn(x + Math.cos(a) * 0.3, 0.3, z + Math.sin(a) * 0.3, Math.cos(a) * s, rand(6, 13), Math.sin(a) * s, rand(0.6, 1.1), 0.3, 0.6, DIRT_RGB, 0.85, 16, 0.6);
        }
        vfx.ring(x, z, 0.2, (ev.r || 4.4) * 1.2, 0.35, NADE_RGB.mine, 0.8);
        break;
      case 'cluster':
        vfx.ring(x, z, 0.4, 3.4, 0.35, NADE_RGB.cluster, 0.9);
        break;
      case 'bomblet':
        vfx.spawn(x, 0.6, z, 0, 0, 0, 0.08, 1.6, 0.6, NADE_RGB.cluster, 0, 0, 0);
        break;
      case 'impact':
        vfx.ring(x, z, 0.2, (ev.r || 4.2) * 1.05, 0.28, NADE_RGB.impact, 0.9);
        vfx.sparks(x, 0.5, z, 1, 0, FIRE_HOT, vfx._n(10), 14);
        vfx.sparks(x, 0.5, z, -1, 0, FIRE_HOT, vfx._n(10), 14);
        break;
      case 'claymore': {
        // Most of it goes out of the face: a fan of fast pellets and dirt along its cone.
        const aim = ev.aim ?? 0;
        for (let i = vfx._n(26); i > 0; i--) {
          const a = aim + rand(-0.85, 0.85), sp = rand(14, 30);
          vfx.spawn(x, 0.4, z, Math.cos(a) * sp, rand(0.5, 3), Math.sin(a) * sp, rand(0.12, 0.26), 0.09, 0.02, FIRE_HOT, 0, 8, 1.2, 0.05);
        }
        for (let i = vfx._n(10); i > 0; i--) {
          const a = aim + rand(-0.7, 0.7), sp = rand(3, 8);
          vfx.spawn(x, 0.3, z, Math.cos(a) * sp, rand(2, 5), Math.sin(a) * sp, rand(0.5, 0.9), 0.3, 0.6, DIRT_RGB, 0.85, 14, 0.8);
        }
        break;
      }
      case 'drill':
        // Bored through: debris blows back out of the hole on the near side too.
        if (Number.isFinite(ev.ox)) {
          const dx = ev.ox - x, dz = ev.oz - z, l = Math.hypot(dx, dz) || 1;
          vfx.sparks(ev.ox, 0.6, ev.oz, dx / l, dz / l, NADE_RGB.drill, vfx._n(12), 9);
          vfx.pop(ev.ox, 0.6, ev.oz, 1.4, NADE_RGB.drill, 0.2);
        }
        vfx.ring(x, z, 0.2, (ev.r || 3.9) * 1.05, 0.3, NADE_RGB.drill, 0.85);
        break;
      case 'flash':
      case 'smoke':
      default: break;
    }
  }

  // V8 pops that are not explosions: Stun's concussion rings, Gas venting, each Shock arc, a Drill biting into a wall.
  #gear(ev) {
    const vfx = this.vfx, x = ev.x, z = ev.z, rgb = NADE_RGB[ev.kind] ?? FALLBACK;
    switch (ev.kind) {
      case 'stun':
        vfx.ring(x, z, 0.3, ev.r || 8, 0.45, rgb, 0.9);
        vfx.ring(x, z, 0.2, (ev.r || 8) * 0.6, 0.32, WHITE_RGB, 0.7);
        vfx.pop(x, 0.8, z, 3.4, WHITE_RGB, 0.16);
        vfx.spawn(x, 0.7, z, 0, 0, 0, 0.14, 2.6, 0.8, WHITE_RGB, 0, 0, 0);
        for (let i = vfx._n(10); i > 0; i--) {
          const a = rand(0, Math.PI * 2), sp = rand(4, 9);
          vfx.spawn(x, 0.4, z, Math.cos(a) * sp, rand(0.2, 1), Math.sin(a) * sp, rand(0.3, 0.5), 0.25, 0.7, STUN_DUST, 0.6, 0, 3);
        }
        break;
      case 'gas':
        vfx.ring(x, z, 0.3, ev.r || GAS_R, 0.6, rgb, 0.6);
        for (let i = vfx._n(12); i > 0; i--) {
          const a = rand(0, Math.PI * 2), sp = rand(2, 5);
          vfx.spawn(x, 0.3, z, Math.cos(a) * sp, rand(0.3, 1.2), Math.sin(a) * sp, rand(0.6, 1), 0.4, 1.4, GAS_RGB, 0.7, -0.3, 2);
        }
        break;
      case 'shock': {
        // A ring of jagged arcs out to the reach, brightest on the first.
        const r = ev.r || SHOCK_R, arcs = ev.n ? 4 : 7;
        for (let k = 0; k < arcs; k++) {
          const a = rand(0, Math.PI * 2);
          let px = x, pz = z, py = 0.3;
          for (let j = 1; j <= 3; j++) {
            const f = j / 3, nx = x + Math.cos(a) * r * f + rand(-0.4, 0.4), nz = z + Math.sin(a) * r * f + rand(-0.4, 0.4), ny = 0.3 + rand(0, 0.5);
            vfx.tracer(px, py, pz, nx, ny, nz, ZAP_RGB, 0.06, 3, 0.14, 400);
            px = nx; py = ny; pz = nz;
          }
        }
        vfx.ring(x, z, 0.2, r, 0.25, rgb, ev.n ? 0.6 : 0.95);
        vfx.pop(x, 0.6, z, ev.n ? 2.5 : 4, ZAP_RGB, 0.18);
        break;
      }
      case 'drill':
        vfx.sparks(x, 0.5, z, ev.nx || 0, ev.nz || 0, rgb, vfx._n(10), 8);
        break;
      default: break;
    }
  }

  // Gas cloud: low, slow, rolling puffs out to the cloud's current reach, and a faint rim so its edge reads.
  #gasPuffs(p) {
    const vfx = this.vfx, age = p.age || 0;
    if (age < 0 || age > GAS_LIFE) return;
    const fade = Math.min(1, (GAS_LIFE - age) / 1.5), r = GAS_R * Math.min(1, 0.35 + age / 0.9);
    for (let i = 0; i < 2; i++) {
      const a = rand(0, Math.PI * 2), d = Math.sqrt(Math.random()) * r * 0.9;
      vfx.spawn(p.x + Math.cos(a) * d, rand(0.2, 0.9), p.z + Math.sin(a) * d, rand(-0.4, 0.4), rand(0.05, 0.3), rand(-0.4, 0.4),
        rand(1.1, 1.8), 0.6, 1.6, GAS_RGB, 0.45 * fade, -0.05, 0.6);
    }
    vfx.addRing(p.x, p.z, r - 0.18, r, NADE_RGB.gas, 0.22 * fade);
  }

  // Trophy: a jagged arc from the dome to whatever it shot down, a spark burst there, and a snap of light.
  #zap(ev) {
    const vfx = this.vfx;
    const ax = ev.ox, az = ev.oz, ay = 0.7, bx = ev.x, bz = ev.z, by = 0.9;
    let px = ax, py = ay, pz = az;
    const segs = 4;
    for (let k = 1; k <= segs; k++) {
      const t = k / segs, j = k < segs ? 0.45 : 0;
      const nx = ax + (bx - ax) * t + rand(-j, j), ny = ay + (by - ay) * t + rand(0, j), nz = az + (bz - az) * t + rand(-j, j);
      vfx.tracer(px, py, pz, nx, ny, nz, ZAP_RGB, 0.07, 3, 0.16, 400);
      px = nx; py = ny; pz = nz;
    }
    vfx.sparks(bx, by, bz, 0, 0, ZAP_RGB, 8, 7);
    vfx.spawn(bx, by, bz, 0, 0, 0, 0.12, 0.9, 0.3, WHITE_RGB, 0, 0, 0);
    vfx.ring(ax, az, 0.2, 1.4, 0.3, ZAP_RGB, 0.9);
    vfx.pop(bx, 1.2, bz, 4, ZAP_RGB, 0.18);
  }

  // EMP: a ring that crosses the whole map from the caller, a blue-white flash, and the enemy's screens fill with static.
  #emp(ev, localTeam) {
    const vfx = this.vfx, p = this.posOf.get(ev.id);
    const x = p ? p.x : this.map.width / 2, z = p ? p.z : this.map.height / 2;
    const reach = Math.hypot(this.map.width, this.map.height);
    vfx.ring(x, z, 0.5, reach, 1.5, EMP_RGB, 1);
    vfx.ring(x, z, 0.5, reach * 0.7, 1.1, WHITE_RGB, 0.6);
    vfx.ring(x, z, 0.3, 6, 0.4, WHITE_RGB, 1);
    for (let i = 0; i < 10; i++) {
      const a = rand(0, Math.PI * 2), r = rand(1.5, 4);
      vfx.tracer(x, 0.8, z, x + Math.cos(a) * r, rand(0.3, 2.5), z + Math.sin(a) * r, EMP_RGB, 0.06, 2, 0.2, 300);
    }
    vfx.pop(x, 3, z, 40, EMP_RGB, 0.5);
    this.empT = this.time.value;
    if (ev.team !== localTeam) this.staticBurst = 1.4;
  }

  // A cut to or from a replay: forget anything that would otherwise pop or play a pickup burst.
  reset() {
    for (let i = 0; i < this.tagSlots.length; i++) this.tagSlots[i].id = null;
    for (let i = 0; i < this.smokeSlots.length; i++) { this.smokeSlots[i].id = null; this.smokeSlots[i].a = 0; }
    for (let i = 0; i < this.turretSlots.length; i++) this.turretSlots[i].id = null;
    for (let i = 0; i < this.airSlots.length; i++) this.airSlots[i].active = false;
    for (let i = 0; i < this.seekSlots.length; i++) this.seekSlots[i].active = false;
    for (let i = 0; i < this.nadeSlots.length; i++) this.nadeSlots[i].id = null;
    for (let i = 0; i < this.fireSlots.length; i++) this.fireSlots[i].id = null;
    for (let i = 0; i < this.dropSlots.length; i++) this.dropSlots[i].t = -1;
    for (let i = 0; i < this.mortars.length; i++) this.mortars[i].t = -1;
    for (let i = 0; i < this.marked.length; i++) this.marked[i].id = null;
    this.staticBurst = 0; this.staticAmt = 0;
    this.gear.reset();
    this.streakFx.reset();
  }

  // The throw-aim preview from view.throwPreview: { points:[{x,y,z}], bounces:[{x,z}], landing:{x,z,kind} }.
  // Beads flowing along the arc show direction; every piece rides existing batches, so it costs no draw call.
  #updateThrowArc(view) {
    const tp = view.throwPreview;
    if (!tp || !tp.points || tp.points.length < 2) return;
    const vfx = this.vfx, pts = tp.points, n = pts.length, t = this.time.value;
    const kind = (tp.landing && tp.landing.kind) || 'frag';
    const rgb = NADE_RGB[kind] ?? FALLBACK;
    const SPACING = 0.42;
    let carry = -(t * 2.2 % 1) * SPACING;     // Negative offset walks the beads forward along the path.
    let drawn = 0;
    for (let i = 1; i < n && drawn < 72; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = (b.y ?? 0) - (a.y ?? 0), dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-4) continue;
      let along = -carry;
      if (along < 0) along = 0;
      while (along <= len && drawn < 72) {
        const k = along / len;
        const y = Math.max(0.24, (a.y ?? 0) + dy * k + 0.08);
        const size = 0.12 + (drawn % 2 ? 0.0 : 0.05);
        vfx.addDot(a.x + dx * k, y, a.z + dz * k, size, rgb);
        drawn++;
        along += SPACING;
      }
      carry = along - len - SPACING;
      if (carry < -SPACING) carry = -SPACING;
    }
    const bounces = tp.bounces;
    if (bounces) {
      for (let i = 0; i < bounces.length; i++) {
        const b = bounces[i];
        vfx.addRing(b.x, b.z, 0.2, 0.42, rgb, 0.85);
        vfx.addDot(b.x, 0.3, b.z, 0.26, WHITE_RGB);
      }
    }
    const end = tp.landing || pts[n - 1];
    const radius = BLAST_R[kind] ?? 3;
    const pulse = 0.5 + 0.5 * Math.sin(t * 7);
    vfx.addRing(end.x, end.z, radius - 0.14, radius, rgb, 0.65 + pulse * 0.3);
    vfx.addRing(end.x, end.z, 0.35 + pulse * 0.1, 0.6 + pulse * 0.14, rgb, 1);
    vfx.addDot(end.x, 0.34, end.z, 0.36 + pulse * 0.14, rgb);
    // Tick marks at the compass points turn the ring into a clear danger zone on a phone screen.
    for (let i = 0; i < 4; i++) {
      const a = t * 0.8 + i * Math.PI / 2;
      vfx.addDot(end.x + Math.cos(a) * radius, 0.26, end.z + Math.sin(a) * radius, 0.15, rgb);
    }
  }

  #clear(x0, z0, x1, z1, smokes) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 0.5) return true;
    return castRay(this.visionWalls, x0, z0, dx / len, dz / len, len) >= len && !smokeBlocks(smokes, x0, z0, x1, z1);
  }

  #updateTags(view, dt, lx, lz, localTeam, hasLocal) {
    const list = view.tags, slots = this.tagSlots, mesh = this.tagMesh;
    for (let i = 0; i < slots.length; i++) slots[i].touched = false;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        let slot = slotOf(slots, t.id);
        if (!slot) {
          slot = slotOf(slots, null);
          if (!slot) continue;
          slot.id = t.id; slot.age = 0; slot.phase = (i * 2.399) % 6.28;
        }
        slot.touched = true;
        slot.x = t.x; slot.z = t.z; slot.team = t.team;
      }
    }
    const aTeam = mesh.geometry.attributes.aTeam;
    const t = this.time.value;
    let n = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.id === null) continue;
      const rgb = this.teamRGB[s.team] ?? this.teamRGB[0];
      if (!s.touched) {
        // Picked up or expired: a small upward burst, seen only if the spot itself is visible.
        if (!hasLocal || this.#clear(lx, lz, s.x, s.z, view.smokes)) {
          for (let k = 0; k < 5; k++) {
            const a = s.phase + k * 1.256;
            this.vfx.spawn(s.x, 0.9, s.z, Math.cos(a) * 2.2, 3.2, Math.sin(a) * 2.2, 0.32, 0.12, 0.02, rgb, 0, 4, 0);
          }
        }
        s.id = null;
        continue;
      }
      s.age += dt;
      if (hasLocal && !this.#clear(lx, lz, s.x, s.z, view.smokes)) continue;
      const pop = Math.min(1, s.age / 0.22), scale = 1.35 * (1.25 - 0.25 * pop) * pop;
      const y = 0.72 + Math.sin(t * 3.1 + s.phase) * 0.12;
      _e.set(0.5, t * 2.7 + s.phase, 0.22);
      _q.setFromEuler(_e);
      _p.set(s.x, y, s.z);
      _s.set(scale, scale, scale);
      _m.compose(_p, _q, _s).toArray(mesh.instanceMatrix.array, n * 16);
      aTeam.setXYZ(n, rgb[0], rgb[1], rgb[2]);
      this.vfx.addDot(s.x, y, s.z, 0.46 + 0.1 * Math.sin(t * 5 + s.phase), rgb);
      n++;
    }
    mesh.count = n;
    uploadUsed(aTeam, n);
    uploadUsed(mesh.instanceMatrix, n);
  }

  // Domination shows flag, ring and capture arc; hardpoint swaps the flag for a tall animated boundary wall.
  #updatePoints(view) {
    if (view.mode === 'ctf') { this.#updateFlags(view); return; }
    const list = view.points;
    const zones = this.zones, walls = this.zoneWalls, stand = this.flagStand, cloth = this.flagCloth;
    let nZone = 0, nFlag = 0, nWall = 0;
    if (list && list.length) {
      const za = zones.geometry.attributes, wa = walls.geometry.attributes;
      const sa = stand.geometry.attributes.aTeam, ca = cloth.geometry.attributes.aTeam;
      const hard = view.mode === 'hard';
      const snd = view.mode === 'snd' ? sndOf(view) : null;
      for (let i = 0; i < list.length && nZone < MAX_POINTS; i++) {
        const pt = list[i], r = pt.r ?? 4;
        if (view.mode === 'snd') {
          // A bomb site: a sodium ring, red with the bomb on it; the arc is a plant or defuse in progress there.
          const planted = snd?.bomb?.state === 'planted' && snd.bomb.site === pt.id;
          const col = planted ? PLANTED_RGB : SITE_RGB;
          const arc = snd?.plant?.site === pt.id ? snd.plant.t : planted && snd.defuse ? snd.defuse.t : 0;
          _p.set(pt.x, 0.1, pt.z); _q.identity(); _s.set(r, 1, r);
          _m.compose(_p, _q, _s).toArray(zones.instanceMatrix.array, nZone * 16);
          za.aOwner.setXYZ(nZone, col[0], col[1], col[2]);
          const fill = planted ? DEFUSE_RGB : WHITE_RGB;
          za.aCapture.setXYZ(nZone, fill[0], fill[1], fill[2]);
          za.aZone.setXYZW(nZone, arc, planted ? 1 : 0, 0.11, 0);
          nZone++;
          continue;
        }
        // An unowned point shows chalk white. `capture` is signed by side: positive means team 1 is taking it.
        const owner = pt.owner === 0 || pt.owner === 1 ? this.teamRGB[pt.owner] : NEUTRAL_RGB;
        const cap = pt.capture ?? 0;
        const capturing = this.teamRGB[cap > 0 ? 1 : 0];
        const arc = Math.min(1, Math.abs(cap));
        const contested = pt.contested ? 1 : 0;

        _p.set(pt.x, 0.1, pt.z);
        _q.identity();
        _s.set(r, 1, r);
        _m.compose(_p, _q, _s).toArray(zones.instanceMatrix.array, nZone * 16);
        za.aOwner.setXYZ(nZone, owner[0], owner[1], owner[2]);
        za.aCapture.setXYZ(nZone, capturing[0], capturing[1], capturing[2]);
        const width = hard ? 0.16 : 0.09;
        za.aZone.setXYZW(nZone, arc, contested, width, hard ? 1 : 0);
        nZone++;

        if (hard) {
          _p.y = 0.04;
          _s.set(r, 3.2, r);
          _m.compose(_p, _q, _s).toArray(walls.instanceMatrix.array, nWall * 16);
          wa.aOwner.setXYZ(nWall, owner[0], owner[1], owner[2]);
          wa.aZone.setXYZW(nWall, 0, contested, 0, 1);
          nWall++;
        } else {
          _p.y = 0;
          _s.set(1, 1, 1);
          _m.compose(_p, _q, _s).toArray(stand.instanceMatrix.array, nFlag * 16);
          _m.toArray(cloth.instanceMatrix.array, nFlag * 16);
          // Contested flags pick up the warning colour on the cloth; the stand always shows the owner.
          const clothCol = contested ? CONTEST_RGB : owner;
          sa.setXYZ(nFlag, owner[0], owner[1], owner[2]);
          ca.setXYZ(nFlag, clothCol[0], clothCol[1], clothCol[2]);
          nFlag++;
        }
      }
      uploadUsed(za.aOwner, nZone); uploadUsed(za.aCapture, nZone); uploadUsed(za.aZone, nZone);
      uploadUsed(wa.aOwner, nWall); uploadUsed(wa.aZone, nWall);
      uploadUsed(sa, nFlag); uploadUsed(ca, nFlag);
    }
    zones.count = nZone; walls.count = nWall; stand.count = nFlag; cloth.count = nFlag;
    uploadUsed(zones.instanceMatrix, nZone); uploadUsed(walls.instanceMatrix, nWall);
    uploadUsed(stand.instanceMatrix, nFlag); uploadUsed(cloth.instanceMatrix, nFlag);
  }

  // Both flag stands with their capture rings, and both flags: on the stand, on a carrier's back, or dropped with a ring
  // whose lit arc is the time left before it goes home. Flags are public knowledge in this mode, so fog never hides
  // one, and a carrier is ringed in their own colour so the eye finds them in a crowd.
  #updateFlags(view) {
    const ctf = ctfOf(view);
    const zones = this.zones, stand = this.flagStand, cloth = this.flagCloth, walls = this.zoneWalls;
    let nZone = 0, nStand = 0, nCloth = 0;
    if (ctf) {
      const za = zones.geometry.attributes, sa = stand.geometry.attributes.aTeam, ca = cloth.geometry.attributes.aTeam;
      const t = this.time.value;
      const putStand = (x, z, rgb, scale, lean, yaw, y = 0) => {
        _e.set(0, yaw, lean); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(scale, scale, scale);
        _m.compose(_p, _q, _s).toArray(stand.instanceMatrix.array, nStand * 16);
        sa.setXYZ(nStand, rgb[0], rgb[1], rgb[2]);
        nStand++;
      };
      const putCloth = rgb => {
        _m.toArray(cloth.instanceMatrix.array, nCloth * 16);
        ca.setXYZ(nCloth, rgb[0], rgb[1], rgb[2]);
        nCloth++;
      };
      const putRing = (x, z, r, rim, arcRgb, arc, width) => {
        _p.set(x, 0.1, z); _q.identity(); _s.set(r, 1, r);
        _m.compose(_p, _q, _s).toArray(zones.instanceMatrix.array, nZone * 16);
        za.aOwner.setXYZ(nZone, rim[0], rim[1], rim[2]);
        za.aCapture.setXYZ(nZone, arcRgb[0], arcRgb[1], arcRgb[2]);
        za.aZone.setXYZW(nZone, arc, 0, width, 0);
        nZone++;
      };
      for (const f of ctf.flags) {
        const rgb = this.teamRGB[f.team] ?? this.teamRGB[0];
        const bx = f.baseX ?? f.x, bz = f.baseZ ?? f.z;
        // The stand and its ring stay put whatever happens to the flag; an empty stand is dimmed.
        const home = f.state === 'home';
        putRing(bx, bz, CTF.reach, home ? rgb : DIM_RGB, rgb, home ? 1 : 0, 0.12);
        putStand(bx, bz, home ? rgb : DIM_RGB, 1, 0, 0);
        if (home) {
          putCloth(rgb);
          this.vfx.addDot(bx, FLAG_H + 0.1, bz, 0.22 + 0.06 * Math.sin(t * 4 + f.team * 2), rgb);
          continue;
        }
        if (f.state === 'carried') {
          const p = this.posOf.get(f.carrier);
          if (!p || p.alive === false) continue;
          // Over the back: behind the carrier, leaning back from where they face.
          const a = p.aim ?? 0, x = p.x - Math.cos(a) * CARRY_BACK, z = p.z - Math.sin(a) * CARRY_BACK;
          putStand(x, z, rgb, CARRY_SCALE, -0.22, Math.PI - a, CARRY_Y);
          putCloth(rgb);
          this.vfx.addRing(p.x, p.z, 0.75, 0.95, rgb, 0.55 + 0.3 * Math.sin(t * 7));
          this.vfx.addDot(x, CARRY_Y + FLAG_H * CARRY_SCALE + 0.1, z, 0.3 + 0.08 * Math.sin(t * 9), rgb);
          continue;
        }
        // Dropped: leaning where it fell, the ring's lit arc running down with the return clock.
        const left = Math.max(0, Math.min(1, (f.returnT ?? 0) / CTF.returnTime));
        putRing(f.x, f.z, CTF.reach, DIM_RGB, rgb, left, 0.16);
        putStand(f.x, f.z, rgb, DROP_SCALE, DROP_LEAN, 0.7 + f.team * Math.PI);
        putCloth(rgb);
        if ((t * 2) % 1 < 0.5) this.vfx.addDot(f.x, 0.4, f.z, 0.34, rgb);
      }
      uploadUsed(za.aOwner, nZone); uploadUsed(za.aCapture, nZone); uploadUsed(za.aZone, nZone);
      uploadUsed(sa, nStand); uploadUsed(ca, nCloth);
    }
    zones.count = nZone; stand.count = nStand; cloth.count = nCloth; walls.count = 0;
    uploadUsed(zones.instanceMatrix, nZone);
    uploadUsed(stand.instanceMatrix, nStand); uploadUsed(cloth.instanceMatrix, nCloth);
  }

  // A flag event's burst at the stand: a capture is the big one, in the scoring team's colour.
  #flagBurst(ev) {
    const ctf = this.lastCtf, f = ctf?.flags?.[ev.team];
    const vfx = this.vfx;
    if (ev.kind === 'capture') {
      const scorer = 1 - ev.team, rgb = this.teamRGB[scorer] ?? WHITE_RGB;
      const b = ctf?.flags?.[scorer], x = b?.baseX ?? ev.x, z = b?.baseZ ?? ev.z;
      vfx.ring(x, z, 0.4, 7.5, 0.7, rgb, 1);
      vfx.ring(x, z, 0.2, 4.2, 0.5, WHITE_RGB, 0.9);
      vfx.pop(x, 1.6, z, 3.4, rgb, 0.45);
      for (let k = 0; k < 22; k++) {
        const a = k * 0.2856, sp = rand(3, 7.5);
        vfx.spawn(x, 1.2, z, Math.cos(a) * sp, rand(4, 9), Math.sin(a) * sp, rand(0.6, 1.1), 0.22, 0.04, k % 3 ? rgb : WHITE_RGB, 0, 9, 0.5);
      }
      return;
    }
    const rgb = this.teamRGB[ev.team] ?? WHITE_RGB;
    if (ev.kind === 'return') {
      const x = f?.baseX ?? ev.x, z = f?.baseZ ?? ev.z;
      if (x === undefined) return;
      vfx.ring(x, z, 0.3, 3.4, 0.5, rgb, 0.9);
      vfx.pop(x, 1.8, z, 1.6, rgb, 0.3);
    } else if (ev.kind === 'take' && ev.x !== undefined) {
      vfx.ring(ev.x, ev.z, 0.2, 2.6, 0.4, rgb, 0.8);
    } else if (ev.kind === 'drop' && ev.x !== undefined) {
      vfx.ring(ev.x, ev.z, 0.2, 2, 0.35, rgb, 0.7);
    }
  }

  #updateNades(view, dt, lx, lz, localTeam, hasLocal) {
    const list = view.projectiles, mesh = this.nades, g = mesh.geometry, slots = this.nadeSlots;
    const aShow = g.attributes.aShow, aAcc = g.attributes.aAcc, aLight = g.attributes.aLight;
    const vfx = this.vfx, t = this.time.value;
    this.trailClock += dt;
    const trail = this.trailClock > 0.05;
    if (trail) this.trailClock = 0;
    for (let i = 0; i < slots.length; i++) slots[i].touched = false;
    let n = 0;
    if (list) {
      for (let i = 0; i < list.length && n < MAX_NADES; i++) {
        const p = list[i];
        if (p.kind === 'gascloud') { if (trail) this.#gasPuffs(p); continue; }
        const model = NADE_MODEL[p.kind];
        if (model === undefined) continue;          // Burning ground has no model: see #updateFires.
        const team = this.teamOf.get(p.owner), friendly = team === localTeam;
        if (hasLocal && !friendly && !this.#clear(lx, lz, p.x, p.z, view.smokes)) continue;
        let s = slotOf(slots, p.id);
        if (!s) {
          s = slotOf(slots, null);
          if (!s) continue;
          s.id = p.id; s.roll = 0; s.spin = Math.random() * 6; s.yaw = Math.atan2(p.vz || 0, p.vx || 0);
        }
        s.touched = true;
        const vx = p.vx || 0, vz = p.vz || 0, speed = Math.hypot(vx, vz);
        if (speed > 0.3) s.yaw = Math.atan2(vz, vx);
        const base = (NADE_BASE[p.kind] ?? 0.15) * NADE_SCALE;
        const age = p.age || 0;
        let y;
        _q.setFromAxisAngle(_axisY, -s.yaw);
        if (p.stuck) {
          y = base;
          if (p.kind === 'hatchet') { _q2.setFromAxisAngle(_axisZ, -1.1); _q.multiply(_q2); y = 0.24; }
        } else if (p.grounded) {
          s.roll -= speed * dt / Math.max(0.12, base);
          _q2.setFromAxisAngle(_axisZ, s.roll); _q.multiply(_q2);
          y = base;
        } else {
          // Tumbling end over end in flight; the hatchet spins hardest.
          s.spin += dt * (p.kind === 'hatchet' ? 17 : 9);
          _q2.setFromAxisAngle(_axisZ, -s.spin); _q.multiply(_q2);
          y = Math.max(base + 0.1, (p.y ?? 1) + 0.15);
        }
        _p.set(p.x, y, p.z);
        _s.set(NADE_SCALE, NADE_SCALE, NADE_SCALE);
        _m.compose(_p, _q, _s).toArray(mesh.instanceMatrix.array, n * 16);
        const acc = NADE_RGB[p.kind] ?? FALLBACK;
        aShow.setX(n, model);
        aAcc.setXYZ(n, acc[0], acc[1], acc[2]);
        // The light: team colour on deployables, a quickening blink on anything with a fuse, flame on a bottle.
        let lr = acc[0], lg = acc[1], lb = acc[2], li = 0.6;
        if (TEAM_LIGHT.has(p.kind)) {
          const tc = this.teamRGB[team ?? 0] ?? this.teamRGB[0];
          lr = tc[0]; lg = tc[1]; lb = tc[2];
          li = p.kind === 'mine' ? (age > 1.1 ? 0.5 + 0.5 * Math.sin(t * 7 + i) : 0.15)
            : p.kind === 'decoy' ? (Math.sin(t * 19 + i) > 0 ? 1 : 0.1)
            : 0.55 + 0.45 * Math.sin(t * 5 + i);
        } else if (p.kind === 'molotov') {
          lr = 1; lg = 0.62; lb = 0.22; li = 0.75 + 0.25 * Math.sin(t * 37 + i * 3);
        } else if (FUSE[p.kind]) {
          const k = Math.min(1, age / FUSE[p.kind]);
          li = 0.5 + 0.5 * Math.sin(age * (9 + 46 * k));
        }
        aLight.setXYZW(n, lr, lg, lb, li);
        if (!p.stuck && !p.grounded) {
          if (p.kind === 'molotov') {
            if (trail) vfx.spawn(p.x, y + 0.45, p.z, rand(-0.3, 0.3), rand(0.4, 1.2), rand(-0.3, 0.3), rand(0.2, 0.35), 0.24, 0.04, FIRE_HOT, 0, -1, 1, 0.03);
          } else if (trail) vfx.spawn(p.x, y, p.z, 0, 0.2, 0, 0.22, 0.09, 0.03, acc, 0, 0, 0);
        }
        // A glow over anything about to go off; deployables keep a small one so they read from the camera.
        if (FUSE[p.kind] && p.kind !== 'molotov') vfx.addDot(p.x, y + 0.36, p.z, 0.16 + li * 0.18, acc);
        else if (TEAM_LIGHT.has(p.kind) && li > 0.3) vfx.addDot(p.x, y + 0.42, p.z, 0.12 + 0.1 * li, _rgbOf(lr, lg, lb));
        if (p.kind === 'trophy' && p.stuck && friendly) vfx.addRing(p.x, p.z, 6.3, 6.5, acc, 0.25 + 0.12 * Math.sin(t * 3));
        // V8. Claymore: two laser lines mark its cone, for both sides: seeing them is the counterplay.
        if (p.kind === 'claymore' && p.stuck && age > 0.9) {
          const tc = this.teamRGB[team ?? 0] ?? this.teamRGB[0];
          for (let e = -1; e <= 1; e += 2) {
            const a = s.yaw + e * CLAY_CONE, ca = Math.cos(a), sa = Math.sin(a);
            for (let k = 1; k <= 7; k++) { const r = k * CLAY_REACH / 7; vfx.addDot(p.x + ca * r, 0.22, p.z + sa * r, 0.08 + (k === 7 ? 0.06 : 0), tc); }
          }
        }
        if (p.kind === 'shock' && p.stuck) {
          if (friendly) vfx.addRing(p.x, p.z, SHOCK_R - 0.15, SHOCK_R, acc, 0.3 + 0.2 * Math.sin(t * 23));
          if (trail && Math.random() < 0.5) vfx.sparks(p.x, 0.25, p.z, rand(-1, 1), rand(-1, 1), acc, 2, 5);
        }
        if (p.kind === 'drill' && p.stuck && trail) vfx.sparks(p.x, 0.35, p.z, -Math.cos(s.yaw), -Math.sin(s.yaw), NADE_RGB.drill, 2, 6);
        n++;
      }
    }
    for (let i = 0; i < slots.length; i++) if (!slots[i].touched) slots[i].id = null;
    if (n < MAX_NADES) n = this.#sndBomb(view, n, t);
    mesh.count = n;
    uploadUsed(mesh.instanceMatrix, n);
    uploadUsed(aShow, n); uploadUsed(aAcc, n); uploadUsed(aLight, n);
  }

  // The Search and Destroy bomb, when it is on the ground: dropped (a slow blink) or planted (a blink that quickens as the
  // fuse runs down, with the blast radius marked round it). Carried, it is on someone's back and the HUD says whose.
  // Both sides know where a dropped or planted bomb is, so fog never hides it. Returns the next free instance.
  #sndBomb(view, n, t) {
    const snd = sndOf(view), b = snd?.bomb;
    if (!b || (b.state !== 'dropped' && b.state !== 'planted' && b.state !== 'defused')) return n;
    const mesh = this.nades, g = mesh.geometry, planted = b.state === 'planted';
    _q.setFromAxisAngle(_axisY, 0.4);
    _p.set(b.x, NADE_BASE.bomb * BOMB_SCALE, b.z);
    _s.set(BOMB_SCALE, BOMB_SCALE, BOMB_SCALE);
    _m.compose(_p, _q, _s).toArray(mesh.instanceMatrix.array, n * 16);
    g.attributes.aShow.setX(n, NADE_MODEL.bomb);
    const acc = NADE_RGB.bomb;
    g.attributes.aAcc.setXYZ(n, acc[0], acc[1], acc[2]);
    // Beeps per second climb from 1 to about 8 as the fuse runs out; the lamp flashes with each one.
    const rate = planted ? 1 + 7 * Math.pow(1 - Math.min(1, snd.fuse / SND.fuse), 2) : 0.5;
    const on = b.state === 'defused' ? 0 : (t * rate) % 1 < 0.35 ? 1 : 0.08;
    const lamp = b.state === 'defused' ? DEFUSE_RGB : planted ? PLANTED_RGB : SITE_RGB;
    g.attributes.aLight.setXYZW(n, lamp[0], lamp[1], lamp[2], on);
    if (on > 0.5) this.vfx.addDot(b.x, 0.5, b.z, planted ? 0.45 : 0.3, lamp);
    if (planted) this.vfx.addRing(b.x, b.z, SND.blast - 0.25, SND.blast, PLANTED_RGB, 0.18 + 0.22 * on * Math.min(1, 12 / Math.max(1, snd.fuse)));
    else if (b.state === 'dropped') this.vfx.addRing(b.x, b.z, 1.0, 1.2, SITE_RGB, 0.35 + 0.25 * Math.sin(t * 4));
    return n + 1;
  }

  // Molotov fire: a noisy burning disc on the ground, flame tongues, smoke and a flickering light.
  #updateFires(view, dt) {
    const list = view.projectiles, slots = this.fireSlots, vfx = this.vfx;
    for (let i = 0; i < slots.length; i++) slots[i].live = false;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.kind !== 'fire') continue;
        let s = slotOf(slots, p.id);
        if (!s) {
          s = slotOf(slots, null);
          if (!s) continue;
          s.id = p.id; s.a = 0; s.acc = 0; s.smoke = 0; s.pop = 0; s.seed = Math.random();
          s.x = p.x; s.z = p.z;
          vfx.scorch(p.x, p.z, FIRE_R * 1.05);
        }
        s.live = true;
        s.age = p.age ?? s.age + dt;
      }
    }
    const mesh = this.fireMesh, aF = mesh.geometry.attributes.aF;
    let n = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.id === null) continue;
      s.a += ((s.live ? 1 : 0) - s.a) * damp(s.live ? 7 : 3, dt);
      if (!s.live && s.a < 0.02) { s.id = null; continue; }
      const k = s.a * Math.max(0, Math.min(1, (FIRE_LIFE - s.age) / 0.8 + 0.15));
      _p.set(s.x, 0.13, s.z); _q.identity(); _s.set(FIRE_R, 1, FIRE_R);
      _m.compose(_p, _q, _s).toArray(mesh.instanceMatrix.array, n * 16);
      aF.setXYZW(n, s.seed, k, 0, 0);
      n++;
      s.acc += dt * 30 * k * vfx.fxScale;
      while (s.acc > 1) {
        s.acc -= 1;
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * FIRE_R * 0.85;
        vfx.spawn(s.x + Math.cos(a) * r, 0.15, s.z + Math.sin(a) * r, rand(-0.3, 0.3), rand(2, 4.2), rand(-0.3, 0.3), rand(0.3, 0.55), rand(0.26, 0.44), 0.04, Math.random() < 0.6 ? FIRE_RGB : FIRE_HOT, 0, -2.5, 1.2, 0.05);
      }
      s.smoke -= dt;
      if (s.smoke <= 0 && k > 0.2) {
        s.smoke = 0.2;
        const a = Math.random() * Math.PI * 2, r = Math.random() * FIRE_R * 0.6;
        vfx.spawn(s.x + Math.cos(a) * r, 1.0, s.z + Math.sin(a) * r, rand(-0.4, 0.4), rand(1.2, 2.2), rand(-0.4, 0.4), rand(1.2, 2), 0.4, 1.6, SMOKE_RGB, 0.55 * k, -0.6, 1.2);
      }
      s.pop -= dt;
      if (s.pop <= 0 && k > 0.2) { s.pop = 0.5; vfx.pop(s.x, 1.2, s.z, FIRE_R * 2.6 * k, FIRE_RGB, 0.55); }
    }
    mesh.count = n;
    uploadUsed(mesh.instanceMatrix, n);
    uploadUsed(aF, n);
  }

  // Writes one vehicle instance. light is [r,g,b] with brightness li; fold/turn feed the parachute and rotor rigs.
  #putVehicle(n, model, quat, x, y, z, sx, sy, sz, acc, light, li, fold, turn) {
    const mesh = this.vehicles, g = mesh.geometry;
    _p.set(x, y, z); _s.set(sx, sy, sz);
    _m.compose(_p, quat, _s).toArray(mesh.instanceMatrix.array, n * 16);
    g.attributes.aShow.setX(n, model);
    g.attributes.aAcc.setXYZ(n, acc[0], acc[1], acc[2]);
    g.attributes.aLight.setXYZW(n, light[0], light[1], light[2], li);
    g.attributes.aFx.setXYZW(n, 0, fold, turn, 0);
  }

  #putShadow(n, model, quat, x, z, k) {
    _p.set(x, 0.2, z); _s.set(k, 1, k);
    _m.compose(_p, quat, _s).toArray(this.shadow.instanceMatrix.array, n * 16);
    this.shadow.geometry.attributes.aShow.setX(n, model);
  }

  #updateVehicles(view, dt, lx, lz, localTeam, uav, hasLocal) {
    const vfx = this.vfx, t = this.time.value;
    let n = 0, sn = 0;

    // Sentries.
    const tl = view.turrets, tslots = this.turretSlots;
    for (let i = 0; i < tslots.length; i++) tslots[i].touched = false;
    if (tl) {
      for (let i = 0; i < tl.length && n < MAX_TURRETS; i++) {
        const tu = tl[i];
        let s = slotOf(tslots, tu.id);
        if (!s) {
          s = slotOf(tslots, null);
          if (!s) continue;
          s.id = tu.id; s.aim = tu.aim ?? 0; s.age = 0;
        }
        s.touched = true;
        s.age += dt;
        // Shortest way round; the head tracks smoothly even at the 15 Hz snapshot rate.
        let d = ((tu.aim ?? 0) - s.aim) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        s.aim += d * damp(10, dt);
        const friendly = tu.team === localTeam;
        if (!friendly && !uav && hasLocal && !this.#clear(lx, lz, tu.x, tu.z, view.smokes)) continue;
        const rgb = this.teamRGB[tu.team] ?? this.teamRGB[0];
        const pop = Math.min(1, s.age / 0.32), eased = 1 - (1 - pop) * (1 - pop);
        const dying = tu.life !== undefined && tu.life < 3;
        const li = dying ? (Math.sin(t * 22) > 0 ? 1 : 0.1) : 0.7;
        _q.identity();
        this.#putVehicle(n++, VEH.sentry, _q, tu.x, 0, tu.z, 1.1, 1.1 * eased, 1.1, rgb, rgb, li, 1, s.aim);
        // A faint scanning laser shows where it is looking.
        const ca = Math.cos(s.aim), sa = Math.sin(s.aim), my = TURRET_Y * 1.1 * eased + 0.07;
        _rgb[0] = rgb[0] * 0.3; _rgb[1] = rgb[1] * 0.3; _rgb[2] = rgb[2] * 0.3;
        vfx.addBeam(tu.x + ca * 1.7, my, tu.z + sa * 1.7, tu.x + ca * 7, my - 0.25, tu.z + sa * 7, _rgb, 0.025);
      }
    }
    for (let i = 0; i < tslots.length; i++) if (!tslots[i].touched) tslots[i].id = null;

    // Gunships and attack choppers.
    const gl = view.gunships, aslots = this.airSlots;
    let na = 0;
    if (gl) {
      for (let i = 0; i < gl.length && na < MAX_AIR; i++) {
        if (gl[i].kind === 'missile' || gl[i].kind === 'swarm') continue;     // Drawn by #updateSeekers.
        const g = gl[i], s = aslots[na++];
        const chopper = g.kind === 'chopper';
        if (!s.active || s.kind !== (g.kind || 'gunship')) {
          s.active = true; s.kind = g.kind || 'gunship'; s.x = g.x; s.z = g.z; s.aim = g.aim; s.bank = 0; s.pitch = 0; s.vx = 0; s.vz = 0;
        }
        s.team = g.team;
        const px = s.x, pz = s.z;
        s.x += (g.x - s.x) * damp(8, dt);
        s.z += (g.z - s.z) * damp(8, dt);
        let d = (g.aim - s.aim) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        const step = d * damp(chopper ? 6 : 8, dt);
        s.aim += step;
        const idt = 1 / Math.max(dt, 1e-3);
        s.vx += ((s.x - px) * idt - s.vx) * damp(4, dt);
        s.vz += ((s.z - pz) * idt - s.vz) * damp(4, dt);
        const rgb = this.teamRGB[g.team] ?? this.teamRGB[0];
        if (chopper) {
          // Nose dips into its direction of travel; it banks into turns and bobs on the rotor.
          const fwd = s.vx * Math.cos(s.aim) + s.vz * Math.sin(s.aim), side = -s.vx * Math.sin(s.aim) + s.vz * Math.cos(s.aim);
          s.pitch += (Math.max(-0.25, Math.min(0.3, fwd * 0.04)) - s.pitch) * damp(4, dt);
          s.bank += (Math.max(-0.35, Math.min(0.35, side * 0.05 + step * idt * 0.3)) - s.bank) * damp(4, dt);
          s.rotor += dt * 24;
          s.y = CHOPPER_Y + Math.sin(t * 1.9 + i) * 0.14;
          _e.set(s.bank, -s.aim, -s.pitch);
          _q.setFromEuler(_e);
          const blink = Math.sin(t * 6 + i) > 0.4 ? 1 : 0.2;
          this.#putVehicle(n++, VEH.chopper, _q, s.x, s.y, s.z, 1, 1, 1, rgb, rgb, blink, 1, s.rotor);
          this.#putShadow(sn++, VEH.chopper, _q, s.x, s.z, 1.12);
          s.dust -= dt;
          if (s.dust <= 0) {
            s.dust = 0.07;
            const a = Math.random() * Math.PI * 2;
            vfx.spawn(s.x + Math.cos(a) * 1.2, 0.2, s.z + Math.sin(a) * 1.2, Math.cos(a) * 5, rand(0.2, 0.6), Math.sin(a) * 5, rand(0.4, 0.7), 0.3, 1.1, vfx.dustRGB, 0.4, 0, 2.2);
          }
        } else {
          s.bank += (Math.max(-0.5, Math.min(0.5, step * idt * 0.9)) - s.bank) * damp(4, dt);
          s.y = GUNSHIP_Y;
          _e.set(s.bank, -s.aim, 0);
          _q.setFromEuler(_e);
          this.#putVehicle(n++, VEH.gunship, _q, s.x, s.y, s.z, 1, 1, 1, rgb, rgb, 0.4 + 0.6 * Math.abs(Math.sin(t * 5)), 1, 0);
          this.#putShadow(sn++, VEH.gunship, _q, s.x, s.z, 1.25);
          const sa = Math.sin(s.aim), ca = Math.cos(s.aim);
          for (let side = -1; side <= 1; side += 2) {
            const b = 0.18 + 0.18 * Math.abs(Math.sin(t * 5 + side));
            vfx.addDot(s.x + ca * 0.3 - sa * side * 2.1, GUNSHIP_Y + 0.05, s.z + sa * 0.3 + ca * side * 2.1, b, rgb);
          }
        }
      }
    }
    // An aircraft that vanishes right after an EMP goes down: a burst of fire and wreckage where it was.
    for (let i = na; i < aslots.length; i++) {
      const s = aslots[i];
      if (s.active && t - this.empT < 0.8) {
        vfx.fireball(s.x, s.y, s.z, 2.6, 0.5);
        vfx.sparks(s.x, s.y, s.z, 0, 0, EMP_RGB, 12, 9);
        for (let k = 0; k < 8; k++) vfx.shard(s.x, s.y, s.z, rand(-5, 5), rand(-2, 4), rand(-5, 5), DIRT_RGB, rand(0.8, 1.6));
        vfx.spawn(s.x, s.y, s.z, 0, -2, 0, 1.4, 1.2, 3, SMOKE_RGB, 0.7, 2, 0.8);
      }
      s.active = false;
    }

    // UAV and Overwatch drones circling the map, one per team for each that is up.
    const cx = this.map.width / 2, cz = this.map.height / 2, R = Math.min(this.map.width, this.map.height) * 0.42;
    const teams = Math.max(2, view.uav?.length ?? 0, view.overwatchT?.length ?? 0);   // FFA: one per player.
    for (let team = 0; team < teams; team++) {
      const rgb = this.teamRGB[team] ?? this.teamRGB[0];
      const up = [view.uav && view.uav[team] > 0, view.overwatchT && view.overwatchT[team] > 0];
      for (let k = 0; k < 2; k++) {
        if (!up[k] || n >= MAX_VEHICLES) continue;
        const over = k === 1, dir = over ? -1 : 1;
        const a = t * (over ? 0.16 : 0.24) * dir + team * (teams > 2 ? 2.39996 : Math.PI) + (over ? 1.3 : 0);
        const r = R * (over ? 1.15 : 0.9);
        const x = cx + Math.cos(a) * r * 1.3, z = cz + Math.sin(a) * r, y = DRONE_Y + (over ? 2 : 0);
        _e.set(0.28 * dir, -(a + dir * Math.PI / 2), 0);
        _q.setFromEuler(_e);
        this.#putVehicle(n++, over ? VEH.overwatch : VEH.uav, _q, x, y, z, 1, 1, 1, rgb, over ? [0.45, 0.85, 1] : rgb, 0.6 + 0.4 * Math.sin(t * 4 + team), 1, 0);
        if (sn < MAX_SHADOWS) this.#putShadow(sn++, over ? VEH.overwatch : VEH.uav, _q, x, z, 1.05);
        if (over && team === localTeam) {
          // Overwatch sweeps the map for its own side: a slow radar arm from the centre.
          const sw = t * 1.3;
          _rgb[0] = rgb[0] * 0.22; _rgb[1] = rgb[1] * 0.22; _rgb[2] = rgb[2] * 0.22;
          vfx.addBeam(cx, 0.3, cz, cx + Math.cos(sw) * R * 1.6, 0.3, cz + Math.sin(sw) * R * 1.2, _rgb, 0.22);
        }
      }
    }

    ({ n, sn } = this.#updateSeekers(view, dt, n, sn, localTeam));
    n = this.#updateSuits(view, n, lx, lz, localTeam, uav, hasLocal);

    // Supply drops: fall under a canopy, land in a burst of dust and green, then sit until they sink away.
    const FALL = 1.25, STAY = 8;
    for (let i = 0; i < this.dropSlots.length && n < MAX_VEHICLES; i++) {
      const d = this.dropSlots[i];
      if (d.t < 0) continue;
      const before = d.t;
      d.t += dt;
      if (d.t > FALL + STAY) { d.t = -1; continue; }
      const rgb = this.teamRGB[d.team] ?? this.teamRGB[0];
      let y = 0, fold = 1, sy = 1;
      if (d.t < FALL) {
        const k = d.t / FALL;
        y = 16 * (1 - k) * (1 - k * 0.35);
        _e.set(Math.sin(d.t * 3.2) * 0.12, 0.4, Math.cos(d.t * 2.6) * 0.1);
        _q.setFromEuler(_e);
      } else {
        if (before < FALL) this.#dropLanded(d.x, d.z, rgb);
        fold = Math.max(0, 1 - (d.t - FALL) / 0.35);
        const sink = d.t - FALL - STAY + 0.7;
        if (sink > 0) { sy = Math.max(0.02, 1 - sink / 0.7); y = -0.4 * (1 - sy); }
        _e.set(0, 0.4, 0);
        _q.setFromEuler(_e);
        d.flare -= dt;
        if (d.flare <= 0 && d.t < FALL + 4) {
          d.flare = 0.09;
          vfx.spawn(d.x + 0.45, 1.25, d.z + 0.3, rand(-0.2, 0.2) + 0.5, rand(1.4, 2.4), rand(-0.2, 0.2), rand(1.2, 2), 0.2, 1.0, HEAL_RGB, 0.35, -0.4, 0.8);
        }
      }
      this.#putVehicle(n++, VEH.crate, _q, d.x, y, d.z, 1.1, 1.1 * sy, 1.1, rgb, HEAL_RGB, Math.sin(t * 9) > 0 ? 1 : 0.2, fold, 0);
    }

    const mesh = this.vehicles, g = mesh.geometry;
    mesh.count = n;
    uploadUsed(mesh.instanceMatrix, n);
    uploadUsed(g.attributes.aShow, n); uploadUsed(g.attributes.aAcc, n);
    uploadUsed(g.attributes.aLight, n); uploadUsed(g.attributes.aFx, n);
    this.shadow.count = sn;
    uploadUsed(this.shadow.instanceMatrix, sn);
    uploadUsed(this.shadow.geometry.attributes.aShow, sn);
  }

  // V8: cruise missiles and swarm drones. Both are always drawn, like the other aircraft. A missile is smoothed by
  // flying it on at its known speed between snapshots and easing toward each new one, so it never stutters at 15 Hz.
  #updateSeekers(view, dt, n, sn, localTeam) {
    const vfx = this.vfx, t = this.time.value, gl = view.gunships, slots = this.seekSlots;
    let k = 0;
    if (gl) {
      for (let i = 0; i < gl.length && k < slots.length && n < MAX_VEHICLES; i++) {
        const g = gl[i];
        if (g.kind !== 'missile' && g.kind !== 'swarm') continue;
        const s = slots[k++];
        if (!s.active || s.kind !== g.kind || s.owner !== g.owner) {
          s.active = true; s.kind = g.kind; s.owner = g.owner; s.x = g.x; s.z = g.z; s.aim = g.aim; s.bank = 0; s.age = 0; s.trail = 0;
          if (g.kind === 'missile') this.#missileLaunch(g.x, g.z, g.aim);
        }
        s.team = g.team; s.age += dt;
        let d = (g.aim - s.aim) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        const step = d * damp(12, dt);
        s.aim += step;
        const rgb = this.teamRGB[g.team] ?? this.teamRGB[0], mine = g.team === localTeam;
        if (g.kind === 'missile') {
          s.x += Math.cos(s.aim) * MISSILE_SPEED * dt; s.z += Math.sin(s.aim) * MISSILE_SPEED * dt;
          s.x += (g.x - s.x) * damp(7, dt); s.z += (g.z - s.z) * damp(7, dt);
          s.bank += (Math.max(-0.7, Math.min(0.7, step / Math.max(dt, 1e-3) * 0.25)) - s.bank) * damp(6, dt);
          const climb = Math.min(1, s.age / 0.25);
          const y = 0.9 + (MISSILE_Y - 0.9) * climb;
          _e.set(s.bank + s.age * 9, -s.aim, 0);
          _q.setFromEuler(_e);
          this.#putVehicle(n++, VEH.missile, _q, s.x, y, s.z, 1.1, 1.1, 1.1, rgb, FIRE_HOT, 0.7 + 0.3 * Math.sin(t * 40), 1, 0);
          if (sn < MAX_SHADOWS) this.#putShadow(sn++, VEH.missile, _q, s.x, s.z, 1.1);
          const ca = Math.cos(s.aim), sa = Math.sin(s.aim), tx = s.x - ca * 1.5, tz = s.z - sa * 1.5;
          vfx.addDot(tx, y, tz, 0.42 + 0.12 * Math.sin(t * 50), FIRE_HOT);
          vfx.addBeam(tx, y, tz, tx - ca * 1.6, y, tz - sa * 1.6, FIRE_RGB, 0.12);
          s.trail -= dt;
          if (s.trail <= 0) {
            s.trail = 0.025;
            vfx.spawn(tx, y, tz, -ca * 2 + rand(-0.4, 0.4), rand(0.2, 0.8), -sa * 2 + rand(-0.4, 0.4), rand(0.6, 1.0), 0.25, 0.9, SMOKE_RGB, 0.55, -0.3, 1.4);
          }
          // Where it would go off: the blast ring rides under it, team colour for its side and danger red for the other.
          const ring = mine ? rgb : DANGER_RGB, pulse = 0.5 + 0.5 * Math.sin(t * 14);
          vfx.addRing(s.x, s.z, MISSILE_R - 0.18, MISSILE_R, ring, 0.35 + 0.25 * pulse);
          vfx.addRing(s.x, s.z, 0.5, 0.75, ring, 0.8);
        } else {
          s.x += (g.x - s.x) * damp(10, dt); s.z += (g.z - s.z) * damp(10, dt);
          s.bank += (Math.max(-0.4, Math.min(0.4, step / Math.max(dt, 1e-3) * 0.15)) - s.bank) * damp(5, dt);
          s.rotor += dt * 40;
          const y = SWARM_Y + Math.sin(t * 3.1 + k * 1.7) * 0.18;
          _e.set(s.bank, -s.aim, -0.18);
          _q.setFromEuler(_e);
          const blink = Math.sin(t * 9 + k * 2) > 0.2 ? 1 : 0.15;
          this.#putVehicle(n++, VEH.drone, _q, s.x, y, s.z, 1.15, 1.15, 1.15, rgb, mine ? rgb : DANGER_RGB, blink, 1, s.rotor);
          if (sn < MAX_SHADOWS) this.#putShadow(sn++, VEH.drone, _q, s.x, s.z, 1.15);
          // A seeker eye that looks where it is heading: a thin beam to the ground ahead.
          _rgb[0] = rgb[0] * 0.4; _rgb[1] = rgb[1] * 0.4; _rgb[2] = rgb[2] * 0.4;
          vfx.addBeam(s.x, y - 0.2, s.z, s.x + Math.cos(s.aim) * 2.2, 0.15, s.z + Math.sin(s.aim) * 2.2, _rgb, 0.035);
          vfx.addDot(s.x, y - 0.25, s.z, 0.16 + 0.1 * blink, mine ? rgb : DANGER_RGB);
        }
      }
    }
    // A seeker that vanished went off (the sim sends the explosion) or was knocked out by an EMP: flame and parts.
    for (let i = k; i < slots.length; i++) {
      const s = slots[i];
      if (s.active && t - this.empT < 0.8) {
        vfx.fireball(s.x, 2, s.z, 1.4, 0.4);
        vfx.sparks(s.x, 2, s.z, 0, 0, EMP_RGB, 8, 7);
      }
      s.active = false;
    }
    return { n, sn };
  }

  #missileLaunch(x, z, aim) {
    const vfx = this.vfx, ca = Math.cos(aim), sa = Math.sin(aim);
    for (let i = vfx._n(12); i > 0; i--) {
      const a = aim + Math.PI + rand(-0.9, 0.9), v = rand(2, 6);
      vfx.spawn(x, 0.6, z, Math.cos(a) * v, rand(0.5, 2), Math.sin(a) * v, rand(0.6, 1.1), 0.4, 1.4, SMOKE_RGB, 0.6, -0.4, 1.8);
    }
    vfx.muzzleFlash(x + ca * 0.6, 1, z + sa * 0.6, aim, FIRE_HOT, 0.9);
    vfx.ring(x, z, 0.3, 2.2, 0.35, FIRE_HOT, 0.7);
  }

  // Juggernaut armour over every suited soldier this player can see (teammates always, enemies in sight or on UAV).
  #updateSuits(view, n, lx, lz, localTeam, uav, hasLocal) {
    const ps = view.players, t = this.time.value;
    if (!ps) return n;
    let k = 0;
    for (let i = 0; i < ps.length && k < MAX_SUITS && n < MAX_VEHICLES; i++) {
      const p = ps[i];
      if (!(p.armor > 0) || !p.alive) continue;
      if (p.team !== localTeam && !uav && hasLocal && !this.#clear(lx, lz, p.x, p.z, view.smokes)) continue;
      k++;
      const rgb = this.teamRGB[p.team] ?? this.teamRGB[0];
      _e.set(0, -p.aim, 0);
      _q.setFromEuler(_e);
      const low = p.armor < 100 ? (Math.sin(t * 16) > 0 ? 1 : 0.2) : 0.75;
      this.#putVehicle(n++, VEH.suit, _q, p.x, p.sliding ? -0.5 : 0, p.z, 1.05, 1.05, 1.05, rgb, low < 1 && p.armor < 100 ? DANGER_RGB : rgb, low, 1, 0);
    }
    return n;
  }

  #dropLanded(x, z, rgb) {
    const vfx = this.vfx;
    for (let i = vfx._n(14); i > 0; i--) {
      const a = (i / 14) * Math.PI * 2, s = rand(4, 8);
      vfx.spawn(x + Math.cos(a) * 0.7, 0.2, z + Math.sin(a) * 0.7, Math.cos(a) * s, rand(0.3, 1), Math.sin(a) * s, rand(0.4, 0.7), 0.3, 1.2, vfx.dustRGB, 0.6, 0, 3);
    }
    vfx.ring(x, z, 0.5, SUPPLY_R, 0.9, HEAL_RGB, 0.6);
    vfx.ring(x, z, 0.3, 2.4, 0.4, rgb, 0.9);
    vfx.healBurst(x, z);
  }

  // Mortar shells inbound: a danger circle with a closing lock ring, then the shell itself for the last half second.
  #updateMortars(dt, localTeam) {
    const vfx = this.vfx, t = this.time.value;
    for (let i = 0; i < this.mortars.length; i++) {
      const m = this.mortars[i];
      if (m.t < 0) continue;
      m.t += dt;
      const k = m.t / m.delay;
      if (k >= 1) {
        // Earth thrown up in a column on top of the blast the sim reports at the same moment.
        for (let j = vfx._n(14); j > 0; j--) {
          const a = rand(0, Math.PI * 2), s = rand(0.8, 3);
          vfx.spawn(m.x + Math.cos(a) * 0.4, 0.3, m.z + Math.sin(a) * 0.4, Math.cos(a) * s, rand(7, 14), Math.sin(a) * s, rand(0.7, 1.2), 0.35, 0.7, DIRT_RGB, 0.85, 16, 0.5);
        }
        vfx.scorch(m.x, m.z, MORTAR_R * 0.8);
        m.t = -1;
        continue;
      }
      const rgb = m.team === localTeam ? (this.teamRGB[localTeam] ?? this.teamRGB[0]) : DANGER_RGB;
      const pulse = 0.5 + 0.5 * Math.sin(t * (8 + 26 * k));
      vfx.addRing(m.x, m.z, MORTAR_R - 0.2, MORTAR_R, rgb, 0.45 + 0.45 * pulse);
      const lock = MORTAR_R * (1.9 - 1.7 * k);
      vfx.addRing(m.x, m.z, Math.max(0, lock - 0.14), lock, rgb, 0.85);
      vfx.addDot(m.x, 0.3, m.z, 0.25 + 0.2 * pulse, rgb);
      for (let q = 0; q < 4; q++) {
        const a = q * Math.PI / 2 + k * 1.5;
        vfx.addDot(m.x + Math.cos(a) * MORTAR_R * 0.55, 0.25, m.z + Math.sin(a) * MORTAR_R * 0.55, 0.14, rgb);
      }
      const f = (m.t - (m.delay - 0.5)) / 0.5;
      if (f > 0) {
        const h = 26 * (1 - f), sx = m.x - 3.5 * (1 - f), sz = m.z - 2.5 * (1 - f);
        vfx.addBeam(sx - 1.1, h + 2.4, sz - 0.8, sx, h, sz, FIRE_HOT, 0.07);
        vfx.addDot(sx, h, sz, 0.32, FIRE_HOT);
      }
    }
  }

  // Enemies a friendly Sensor picked up: a beacon over them until the mark runs out, through walls.
  #updateMarked(view, localTeam) {
    const vfx = this.vfx, t = this.time.value;
    for (let i = 0; i < this.marked.length; i++) {
      const s = this.marked[i];
      if (s.id === null) continue;
      if (t > s.until) { s.id = null; continue; }
      const p = this.posOf.get(s.id);
      if (!p || !p.alive || p.team === localTeam) continue;
      const k = 0.5 + 0.5 * Math.sin(t * 8 + i);
      vfx.addDot(p.x, 2.6, p.z, 0.3 + 0.1 * k, MARK_RGB);
      vfx.addRing(p.x, p.z, 0.6, 0.8, MARK_RGB, 0.6 + 0.3 * k);
      _rgb[0] = MARK_RGB[0] * 0.5; _rgb[1] = MARK_RGB[1] * 0.5; _rgb[2] = MARK_RGB[2] * 0.5;
      vfx.addBeam(p.x, 2.3, p.z, p.x, 3.3, p.z, _rgb, 0.05);
    }
  }

  // Interference on a jammed (or EMP'd) screen. Drawn only while there is some.
  #updateStatic(view, dt) {
    this.staticBurst = Math.max(0, this.staticBurst - dt * 0.9);
    const goal = Math.max(view.jammed ? 0.45 : 0, Math.min(1, this.staticBurst));
    this.staticAmt += (goal - this.staticAmt) * damp(goal > this.staticAmt ? 14 : 4, dt);
    if (this.staticAmt < 0.003) this.staticAmt = 0;
    this.staticU.uAmt.value = this.staticAmt;
    if (this.staticWarm > 0) this.staticWarm--;
    this.staticMesh.visible = this.staticAmt > 0 || this.staticWarm > 0;
  }

  #updateSmoke(view, dt) {
    const list = view.smokes, slots = this.smokeSlots;
    for (let i = 0; i < slots.length; i++) slots[i].live = false;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        let slot = slotOf(slots, g.id);
        if (!slot) {
          slot = slotOf(slots, null);
          if (!slot) continue;
          slot.id = g.id;
          slot.a = 0;
          slot.x = g.x; slot.z = g.z;
          this.vfx.smokePop(g.x, g.z, g.r);
        }
        slot.live = true;
        slot.x = g.x; slot.z = g.z; slot.r = g.r;
      }
    }
    const mesh = this.smokeMesh, alpha = mesh.geometry.attributes.aAlpha;
    let n = 0;
    const t = this.time.value;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.id === null) continue;
      s.a += ((s.live ? 1 : 0) - s.a) * damp(s.live ? 5 : 2.2, dt);
      if (!s.live && s.a < 0.02) { s.id = null; s.a = 0; continue; }
      const grow = s.a * (2 - s.a), r = s.r * (0.25 + 0.75 * grow);
      for (let b = 0; b < BLOBS; b++) {
        const B = this.blobs[b], wob = Math.sin(t * 0.8 + B.phase) * 0.06;
        const sc = r * (B.size + wob);
        _p.set(s.x + r * (B.dx + wob), B.y * grow + 0.15, s.z + r * (B.dz - wob * 0.6));
        _e.set(B.phase, t * 0.18 + B.phase, 0);
        _q.setFromEuler(_e);
        _s.set(sc, sc * 0.82, sc);
        _m.compose(_p, _q, _s).toArray(mesh.instanceMatrix.array, n * 16);
        alpha.setX(n, s.a * this.smokeAlpha);
        n++;
      }
    }
    mesh.count = n;
    uploadUsed(mesh.instanceMatrix, n);
    uploadUsed(alpha, n);
  }

  dispose() {
    const meshes = [this.nades, this.vehicles, this.shadow, this.fireMesh, this.smokeMesh, this.tagMesh, this.flagStand, this.flagCloth, this.zones, this.zoneWalls];
    // Each InstancedMesh holds its own instance-matrix buffer; dispose() is what releases it.
    for (const m of meshes) { this.scene.remove(m); m.geometry.dispose(); m.dispose(); }
    this.gear.dispose();
    this.streakFx.dispose();
    this.scene.remove(this.staticMesh);
    this.staticMesh.geometry.dispose();
    for (const m of [this.solidMat, this.modelMat, this.shadowMat, this.fireMat, this.staticMat, this.smokeMat, this.flagMat, this.zoneMat, this.wallMat]) m.dispose();
  }
}

export { GUNSHIP_Y, CHOPPER_Y, NADE_RGB };
