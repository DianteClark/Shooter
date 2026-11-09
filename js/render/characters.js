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

const MAX_PLAYERS = 16;

const CHAR_SCALE = 1.22;
const GUN_SCALE = 0.98;
const GUN_SCALES = { ar: 1, smg: 1, shotgun: 1, lmg: 1, sniper: 0.86, pistol: 1.05 };
const HIP = 0.78 * CHAR_SCALE;

const CHAR_VERT = /* glsl */`
attribute vec3 aCol;
attribute float aPart;
attribute vec3 aTeam;
attribute vec2 aFx;
varying vec3 vCol;
varying vec3 vLight;
varying vec2 vFx;
${GLSL_LIGHT}
void main() {
  mat4 world = modelMatrix * instanceMatrix;
  vec3 n = normalize(mat3(world) * normal);
  vec3 light = duskLight(n);
  vec3 lit = aCol * light;
  // Team-coloured armour is nearly self-lit: it has to stay the most saturated thing on screen.
  if (aPart > 0.5) lit = aTeam * (0.62 + 0.42 * max(0.0, n.y + 0.2)) * (0.72 + 0.28 * light);
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
  return g;
}

function torsoGeometry() {
  const b = new MeshBuilder();
  b.setPart(0).setColor(0x2b2d33);
  b.box(0, 0.04, 0, 0.3, 0.2, 0.42, 0.03);                 // Pelvis.
  b.setPart(1).box(0, 0.36, 0, 0.38, 0.5, 0.56, 0.06);         // Chest block, team colour.
  b.setPart(0).setColor(0x1f2127);
  b.box(0.21, 0.34, 0, 0.05, 0.36, 0.4, 0.01);                 // Front plate.
  b.setColor(0x34373f);
  b.box(-0.24, 0.32, 0, 0.16, 0.44, 0.42, 0.04);               // Pack.
  b.setPart(1);
  b.box(-0.24, 0.56, 0, 0.14, 0.06, 0.4);                      // Pack top strip stays readable from above.
  b.box(0, 0.6, 0.31, 0.3, 0.18, 0.22, 0.05);                  // Pauldrons.
  b.box(0, 0.6, -0.31, 0.3, 0.18, 0.22, 0.05);
  return b.build();
}

function headGeometry() {
  const b = new MeshBuilder();
  b.setPart(0).setColor(0x4a3a2e).box(0, 0.05, 0, 0.2, 0.14, 0.2);          // Neck.
  b.setPart(1).prismY(0.1, 0.26, 0, 0, 0.25, 0.27, 8, Math.PI / 8);          // Helmet skirt.
  b.prismY(0.26, 0.42, 0, 0, 0.27, 0.15, 8, Math.PI / 8);                    // Dome.
  b.setPart(0).setColor(0x101215);
  b.box(0.2, 0.2, 0, 0.1, 0.1, 0.34);                                        // Visor recess.
  b.setColor(0xd8fff9).box(0.255, 0.2, 0, 0.02, 0.05, 0.32);
  return b.build();
}

function armGeometry() {
  const b = new MeshBuilder();
  b.setPart(0).setColor(0x3a3f47);
  b.prismX(0, 0.8, 0, 0, 0.088, 0.078, 6);
  b.setColor(0x202226).prismX(0.8, 1.0, 0, 0, 0.1, 0.1, 6);                  // Glove.
  return b.build();
}

function legGeometry() {
  const b = new MeshBuilder();
  b.setPart(0).setColor(0x363a42);
  b.prismX(0, 0.7, 0, 0, 0.11, 0.095, 6);
  b.setColor(0x1a1c20);
  b.box(0.86, 0, 0.06, 0.28, 0.18, 0.2, 0.03);                               // Boot.
  return b.build();
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

function setStretch(m, ax, ay, az, bx, by, bz, gy, gz) {
  let dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 1e-5;
  dx /= len; dy /= len; dz /= len;
  // Z = X cross world-up; near-vertical limbs fall back to X as the reference.
  let rx = 0, ry = 1, rz = 0;
  if (Math.abs(dy) > 0.95) { rx = 1; ry = 0; }
  let zx = dy * rz - dz * ry, zy = dz * rx - dx * rz, zz = dx * ry - dy * rx;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  const yx = zy * dz - zz * dy, yy = zz * dx - zx * dz, yz = zx * dy - zy * dx;
  const e = m.elements;
  e[0] = dx * len; e[1] = dy * len; e[2] = dz * len; e[3] = 0;
  e[4] = yx * gy;  e[5] = yy * gy;  e[6] = yz * gy;  e[7] = 0;
  e[8] = zx * gz;  e[9] = zy * gz;  e[10] = zz * gz; e[11] = 0;
  e[12] = ax;      e[13] = ay;      e[14] = az;      e[15] = 1;
}

const damp = (k, dt) => 1 - Math.exp(-k * dt);

class Rig {
  constructor(id) {
    this.id = id;
    this.phase = 0;
    this.kick = 0;
    this.reload = 0;
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
    this.torso = add(torsoGeometry(), MAX_PLAYERS);
    this.head = add(headGeometry(), MAX_PLAYERS);
    this.arm = add(armGeometry(), MAX_PLAYERS * 2);
    this.leg = add(legGeometry(), MAX_PLAYERS * 2);

    // X-ray pass, drawn after the world and before characters, so only pixels hidden by walls survive.
    const xrayMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute vec3 aTeam; attribute vec2 aFx; varying vec3 vTeam; varying float vFade;
        void main(){ vTeam = aTeam; vFade = aFx.x; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vTeam; varying float vFade; void main(){ gl_FragColor = vec4(vTeam * 0.62 * vFade, 0.6 * vFade); }`,
      depthFunc: THREE.GreaterDepth, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const xrayOf = (src) => {
      const m = new THREE.InstancedMesh(src.geometry, xrayMat, src.instanceMatrix.count);
      m.instanceMatrix = src.instanceMatrix;
      m.frustumCulled = false;
      m.count = 0;
      m.renderOrder = 1;
      scene.add(m);
      return m;
    };
    this.xrayTorso = xrayOf(this.torso);
    this.xrayHead = xrayOf(this.head);
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

    this.bodyMeshes = [this.torso, this.head, this.arm, this.leg, this.ring, this.blob];
    this.camoMat = createCamoMaterial(time);
    this.guns = {};
    for (const id of WEAPON_IDS) {
      const proto = getGun(id);
      const geom = proto.geometry.clone();
      addCamoInstanceAttributes(geom, MAX_PLAYERS);
      const mesh = new THREE.InstancedMesh(geom, this.camoMat, MAX_PLAYERS);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 2;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      this.guns[id] = mesh;
    }
  }

  rig(id) {
    let r = this.rigs.get(id);
    if (!r) { r = new Rig(id); this.rigs.set(id, r); }
    return r;
  }

  // Weapon kick per shot. Strength is the weapon's cosmetic kickCam.
  onShot(id, strength) {
    const r = this.rigs.get(id);
    if (r) r.kick = Math.min(1.3, r.kick + 0.55 + strength * 0.5);
  }
  onHit(id) { const r = this.rigs.get(id); if (r) r.flash = 1; }
  onSwap(id) { const r = this.rigs.get(id); if (r) r.swap = 1; }

  _writeFx(mesh, i, fade, flash, team) {
    const a = mesh.geometry.attributes;
    a.aFx.setXY(i, fade, flash);
    a.aTeam.setXYZ(i, team[0], team[1], team[2]);
  }

  // Local visibility test for an enemy: centre and both shoulders, so a peeking shoulder still shows.
  _seenBy(localX, localZ, px, pz, smokes) {
    const dx = px - localX, dz = pz - localZ;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) return true;
    const ux = dx / len, uz = dz / len;
    for (let i = -1; i <= 1; i++) {
      const sx = px + (-uz * i * 0.35), sz = pz + (ux * i * 0.35);
      const ldx = sx - localX, ldz = sz - localZ;
      const l = Math.hypot(ldx, ldz);
      if (castRay(this.visionWalls, localX, localZ, ldx / l, ldz / l, l) >= l && !smokeBlocks(smokes, localX, localZ, sx, sz)) return true;
    }
    return false;
  }

  // Rebuilds all instance buffers from the view. Writes every rig's muzzle position, used by VFX.
  update(view, dt, opts) {
    const { localId, localTeam, uav, revealAll } = opts;
    const torso = this.torso, head = this.head, arm = this.arm, leg = this.leg;
    let nT = 0, nA = 0, nL = 0;
    let nRing = 0;
    for (let i = 0; i < WEAPON_IDS.length; i++) this.guns[WEAPON_IDS[i]].count = 0;
    let localPlayer = null;
    for (let i = 0; i < view.players.length; i++) if (view.players[i].id === localId) { localPlayer = view.players[i]; break; }
    const lx = localPlayer ? localPlayer.x : 0, lz = localPlayer ? localPlayer.z : 0;

    for (let pi = 0; pi < view.players.length; pi++) {
      const p = view.players[pi];
      const r = this.rig(p.id);
      r.team = p.team;
      r.x = p.x; r.z = p.z; r.aim = p.aim;
      if (r.weapon !== p.weapon) { r.weapon = p.weapon; r.swap = Math.max(r.swap, 0.6); }

      const speed = Math.hypot(p.vx || 0, p.vz || 0);
      const moving = speed > 0.3;
      r.phase += speed * dt * 2.1;
      r.moveX += ((moving ? p.vx / speed : 0) - r.moveX) * damp(14, dt);
      r.moveZ += ((moving ? p.vz / speed : 0) - r.moveZ) * damp(14, dt);
      r.kick *= Math.exp(-dt * 14);
      r.flash *= Math.exp(-dt * 18);
      r.swap *= Math.exp(-dt * 11);
      const reloadTarget = p.reloadT > 0 ? 1 : 0;
      r.reload += (reloadTarget - r.reload) * damp(12, dt);
      const slideTarget = p.sliding ? 1 : 0;
      r.slide += (slideTarget - r.slide) * damp(14, dt);
      const sprintTarget = p.sprinting && !p.sliding && !(p.adsT > 0.2) ? 1 : 0;
      r.sprint += (sprintTarget - r.sprint) * damp(10, dt);

      const friendly = p.team === localTeam;
      r.heat = p.heat ?? 0;
      r.overheated = !!p.overheated;
      const seen = p.alive && (friendly || (uav && !p.ghost) || revealAll || !localPlayer || this._seenBy(lx, lz, p.x, p.z, view.smokes));
      r.seen = seen;
      r.reveal += (seen ? 1 : -1) * dt / (seen ? 0.09 : 0.18);
      r.reveal = Math.min(1, Math.max(0, r.reveal));
      if (!p.alive) r.reveal = 0;
      r.visible = r.reveal > 0.005;

      const ads = p.adsT || 0;
      const sprint = r.sprint, slide = r.slide;
      const bob = Math.abs(Math.sin(r.phase)) * 0.07 * Math.min(1, speed / 4);
      const y = HIP + bob - slide * 0.42;

      // Upper-body frame: origin at hips.
      _e.set(-slide * 0.5 - r.kick * 0.03, -p.aim, -(sprint * 0.18) + slide * 0.38 + ads * 0.06 - r.kick * 0.05);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _p.set(p.x, y, p.z);
      _body.compose(_p, _q, _s);

      // Gun pose in upper-body space: lerp hip, ADS and sprint carry; recoil is added on top.
      const gunX = 0.34 + ads * 0.12 + sprint * -0.06 - r.kick * 0.13;
      const gunY = 0.32 + ads * 0.2 - r.reload * 0.18 - r.swap * 0.55 - slide * 0.1;
      const gunZ = 0.18 - ads * 0.1 + sprint * -0.04;
      _gunE.set(
        r.reload * 0.9 - r.swap * 0.6,
        sprint * 1.0 + r.reload * -0.12,
        -r.kick * 0.28 - r.reload * 0.35 - r.swap * 0.9,
      );
      _qGun.setFromEuler(_gunE);
      const gs = GUN_SCALE * (GUN_SCALES[p.weapon] || 1);
      _s.set(gs, gs, gs);
      _p.set(gunX, gunY, gunZ);
      _gun.compose(_p, _qGun, _s).premultiply(_body);

      // Muzzle and ejection port, needed even for hidden shooters so tracers start correctly.
      const proto = getGun(p.weapon);
      _v.set(proto.muzzle[0], proto.muzzle[1], proto.muzzle[2]).applyMatrix4(_gun);
      r.muzzle[0] = _v.x; r.muzzle[1] = _v.y; r.muzzle[2] = _v.z;
      _v.set(proto.eject[0], proto.eject[1], proto.eject[2]).applyMatrix4(_gun);
      r.eject[0] = _v.x; r.eject[1] = _v.y; r.eject[2] = _v.z;
      r.ejectDir[0] = -Math.sin(p.aim); r.ejectDir[1] = Math.cos(p.aim);

      if (!r.visible) continue;

      const team = this.teamRGB[p.team] || this.teamRGB[0];
      let fade = r.reveal;
      // Spawn protection: a quick shimmer rather than a flat fade.
      if (p.spawnProtect) fade *= 0.55 + 0.45 * Math.abs(Math.sin(view.t * 16));
      const flash = r.flash;

      _m.copy(_body);
      _m.toArray(torso.instanceMatrix.array, nT * 16);
      this._writeFx(torso, nT, fade, flash, team);

      _p.set(0, 0.68 * CHAR_SCALE * 0.95 + r.kick * -0.01, 0);
      _s.set(1, 1, 1);
      _e.set(0, 0, r.kick * 0.1 + slide * -0.3);
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s).premultiply(_body);
      _m.toArray(head.instanceMatrix.array, nT * 16);
      this._writeFx(head, nT, fade, flash, team);
      nT++;

      // Gun.
      const gunMesh = this.guns[p.weapon] || this.guns.ar;
      const gi = gunMesh.count++;
      _gun.toArray(gunMesh.instanceMatrix.array, gi * 16);
      const ga = gunMesh.geometry.attributes;
      ga.aCamo.setX(gi, camoIndex(p.camo));
      const tint = camoTint(p.camo);
      if (tint >= 0) { ga.aAccent.setXYZ(gi, (tint >> 16 & 255) / 255, (tint >> 8 & 255) / 255, (tint & 255) / 255); }
      else ga.aAccent.setXYZ(gi, team[0], team[1], team[2]);
      ga.aFx.setXY(gi, fade, flash);
      ga.aHeat.setX(gi, r.heat);

      // Arms: shoulder to hand. Right hand on the grip (gun origin), left on the fore point.
      const shoulderY = 0.42 * CHAR_SCALE;
      for (let side = -1; side <= 1; side += 2) {
        _a.set(0.02, shoulderY, side * 0.31).applyMatrix4(_body);
        if (side > 0) _b.set(0, 0, 0).applyMatrix4(_gun);
        else if (r.reload > 0.5) _b.set(0.12, -0.3, -0.05).applyMatrix4(_gun);   // Hand goes to the magazine.
        else _b.set(proto.fore[0], proto.fore[1], proto.fore[2]).applyMatrix4(_gun);
        setStretch(_m, _a.x, _a.y, _a.z, _b.x, _b.y, _b.z, 1.2, 1.2);
        _m.toArray(arm.instanceMatrix.array, nA * 16);
        this._writeFx(arm, nA, fade, flash, team);
        nA++;
      }

      // Legs follow travel direction, independent of aim.
      const stride = Math.min(1, speed / 3.5) * 0.42 * (1 - slide);
      for (let leg_i = 0; leg_i < 2; leg_i++) {
        const side = leg_i === 0 ? -1 : 1;
        const sw = Math.sin(r.phase + leg_i * Math.PI);
        const lift = Math.max(0, Math.cos(r.phase + leg_i * Math.PI)) * 0.14 * Math.min(1, speed / 3);
        const rx = -Math.sin(p.aim) * side * 0.17, rz = Math.cos(p.aim) * side * 0.17;
        const hipX = p.x + rx, hipZ = p.z + rz;
        const fwd = sw * stride;
        let footX = p.x + rx + r.moveX * fwd, footZ = p.z + rz + r.moveZ * fwd;
        if (slide > 0.01) {
          footX += r.moveX * slide * 0.75;
          footZ += r.moveZ * slide * 0.75;
        }
        setStretch(_m, hipX, y, hipZ, footX, 0.05 + lift, footZ, 1.45, 1.45);
        _m.toArray(leg.instanceMatrix.array, nL * 16);
        this._writeFx(leg, nL, fade, flash, team);
        nL++;
      }

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

    torso.count = nT; head.count = nT; arm.count = nA; leg.count = nL;
    this.xrayTorso.count = nT; this.xrayHead.count = nT;
    this.ring.count = nRing; this.blob.count = nRing;
    for (let i = 0; i < this.bodyMeshes.length; i++) {
      const m = this.bodyMeshes[i];
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.aFx.needsUpdate = true;
      m.geometry.attributes.aTeam.needsUpdate = true;
    }
    for (let i = 0; i < WEAPON_IDS.length; i++) {
      const m = this.guns[WEAPON_IDS[i]];
      if (m.count === 0) continue;
      m.instanceMatrix.needsUpdate = true;
      const a = m.geometry.attributes;
      a.aFx.needsUpdate = true; a.aCamo.needsUpdate = true; a.aAccent.needsUpdate = true; a.aHeat.needsUpdate = true;
    }
  }

  dispose() {
    for (const m of [this.torso, this.head, this.arm, this.leg, this.ring, this.blob]) {
      m.geometry.dispose();
      m.dispose();
    }
    for (const id of WEAPON_IDS) { this.guns[id].geometry.dispose(); this.guns[id].dispose(); }
    for (const mat of [this.charMat, this.xrayMat, this.ringMat, this.blobMat, this.camoMat]) mat.dispose();
  }
}
