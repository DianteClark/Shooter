// Everything 4.0 added to the battlefield that is drawn from view state each frame: grenades in flight,
// smoke clouds, turrets, gunships, and the mode objectives (dog tags, domination flags, the hardpoint zone).
// Fixed instanced pools, nothing allocated after construction.
// (Burst effects triggered by events live in vfx.js with the other particles.)
import * as THREE from 'three';
import { MeshBuilder } from './meshbuild.js';
import { castRay } from './fog.js';
import { GLSL_LIGHT, hexRGB } from './art.js';
import { TEAMS } from '../shared/constants.js';
import { smokeBlocks } from '../shared/geometry.js';

const MAX_NADES = 16;
const MAX_SMOKES = 6;            // Matches FogMask's budget of smoke clouds.
const BLOBS = 16;                // Puffs per cloud.
const MAX_TURRETS = 8;
const MAX_GUNSHIPS = 2;
const GUNSHIP_Y = 7.5;            // Low enough to read as a craft under the fixed camera, high enough to clear walls.
const TURRET_Y = 0.84;           // Head pivot height.
const MAX_TAGS = 24;
const MAX_POINTS = 6;
const FLAG_H = 3.4;              // Pole height; tall enough to read over cover from the tilted camera.
const NEUTRAL_RGB = [0.82, 0.85, 0.88];
const CONTEST_RGB = [1.0, 0.84, 0.32];

const damp = (k, dt) => 1 - Math.exp(-k * dt);
function slotOf(slots, id) { for (let i = 0; i < slots.length; i++) if (slots[i].id === id) return slots[i]; return null; }
const NADE_RGB = { frag: hexRGB(0xff6a1a), sticky: hexRGB(0xff2bd6), smoke: hexRGB(0x7dff96), flash: hexRGB(0xfff27a), stim: hexRGB(0x4bd18a) };
const FALLBACK = NADE_RGB.frag;

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler(0, 0, 0, 'YZX');

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

function grenadeGeometry() {
  const b = new MeshBuilder();
  b.setPart(0).setColor(0x2f353c).prismY(-0.15, 0.15, 0, 0, 0.26, 0.26, 6);
  b.setPart(1).prismY(-0.04, 0.05, 0, 0, 0.28, 0.28, 6);
  b.setPart(0).setColor(0x20242a).prismY(0.15, 0.27, 0, 0, 0.1, 0.08, 6);
  return b.build();
}

// Pivot at y=0: three splayed legs and a column, all below the rotating head.
function turretBaseGeometry() {
  const b = new MeshBuilder();
  b.setPart(0).setColor(0x2a2d33).prismY(0, 0.1, 0, 0, 0.42, 0.36, 8);
  b.setColor(0x3a3f47).prismY(0.1, TURRET_Y - 0.1, 0, 0, 0.13, 0.11, 6);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + 0.5;
    b.box(Math.cos(a) * 0.52, 0.09, Math.sin(a) * 0.52, 0.5, 0.1, 0.14);
  }
  return b.build();
}

// Model forward is +X, origin on the pivot.
function turretHeadGeometry() {
  const b = new MeshBuilder();
  b.setPart(0).setColor(0x3a3f47).box(0.05, 0.04, 0, 0.72, 0.32, 0.44, 0.05);
  b.setPart(1).box(-0.02, 0.22, 0, 0.56, 0.05, 0.34);                // Team plate on top, seen from the camera.
  b.setPart(0).setColor(0x20242a);
  b.prismX(0.4, 1.34, 0.05, 0, 0.07, 0.065, 6);
  b.box(1.4, 0.05, 0, 0.16, 0.14, 0.17, 0.03);                       // Muzzle block.
  b.setColor(0x4c5a67).box(-0.14, 0.02, 0.28, 0.32, 0.2, 0.16, 0.03);    // Ammo box.
  return b.build();
}

// Seen almost straight down, so the shape is all about the top silhouette: stubby body, broad wing, twin tail.
function gunshipGeometry() {
  const b = new MeshBuilder();
  b.setPart(0).setColor(0x1f2329);
  b.prismX(-1.5, 2.1, 0, 0, 0.42, 0.28, 8, Math.PI / 8);
  b.prismX(2.1, 2.5, 0, 0, 0.28, 0.05, 8, Math.PI / 8);
  b.setColor(0x2a2e36);
  // Wing outline is drawn as (x, z); the matrix lays that plane flat.
  b.matrix = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  b.extrude([[0.7, -2.1], [0.3, -2.3], [-0.45, -0.2], [-0.45, 0.2], [0.3, 2.3], [0.7, 2.1], [0.3, 0.3], [0.3, -0.3]], -0.05, 0.05);
  b.matrix = null;
  b.box(-1.1, 0.02, 1.0, 0.8, 0.1, 0.3); b.box(-1.1, 0.02, -1.0, 0.8, 0.1, 0.3);
  b.setPart(1).box(0.3, 0.1, -1.7, 0.5, 0.02, 0.45); b.box(0.3, 0.1, 1.7, 0.5, 0.02, 0.45);   // Wingtip team colour.
  b.box(-1.5, 0.3, 0, 0.5, 0.02, 0.5);
  return b.build();
}

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
    this.visionWalls = map.walls.filter(w => w.blocksVision);
    this.teamRGB = TEAMS.map(t => hexRGB(t.color));
    this.trailClock = 0;

    this.solidMat = new THREE.ShaderMaterial({
      vertexShader: SOLID_VERT,
      fragmentShader: `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`,
    });
    this.nades = this.#instanced(grenadeGeometry(), MAX_NADES, this.solidMat, 3);
    this.turretBase = this.#instanced(turretBaseGeometry(), MAX_TURRETS, this.solidMat, 2);
    this.turretHead = this.#instanced(turretHeadGeometry(), MAX_TURRETS, this.solidMat, 2);
    this.gunship = this.#instanced(gunshipGeometry(), MAX_GUNSHIPS, this.solidMat, 8);

    // Shadow reuses the aircraft's geometry, squashed onto the ground.
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: `void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); w.y = 0.21; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `void main(){ gl_FragColor = vec4(0.02, 0.015, 0.05, 0.62); }`,
      transparent: true, depthWrite: false,
    });
    this.shadow = this.#instanced(this.gunship.geometry, MAX_GUNSHIPS, this.shadowMat, 1);

    this.#buildSmoke();
    this.#buildObjectives();

    this.turretSlots = Array.from({ length: MAX_TURRETS }, () => ({ id: null, aim: 0, age: 0 }));
    this.shipSlots = Array.from({ length: MAX_GUNSHIPS }, () => ({ active: false, x: 0, z: 0, aim: 0, bank: 0 }));
  }

  #instanced(geom, cap, mat, order) {
    if (!geom.getAttribute('aTeam')) {
      geom.setAttribute('aTeam', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
    }
    const m = new THREE.InstancedMesh(geom, mat, cap);
    m.frustumCulled = false;
    m.count = 0;
    m.renderOrder = order;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(m);
    return m;
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
    this.#updateTags(view, dt, localX, localZ, localTeam, hasLocal);
    this.#updatePoints(view, dt);
    this.#updateNades(view, dt, localX, localZ, hasLocal);
    this.#updateSmoke(view, dt);
    this.#updateTurrets(view, dt, localX, localZ, localTeam, uav, hasLocal);
    this.#updateGunships(view, dt);
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
    aTeam.needsUpdate = true;
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Domination shows flag, ring and capture arc; hardpoint swaps the flag for a tall animated boundary wall.
  #updatePoints(view) {
    const list = view.points;
    const zones = this.zones, walls = this.zoneWalls, stand = this.flagStand, cloth = this.flagCloth;
    let nZone = 0, nFlag = 0, nWall = 0;
    if (list && list.length) {
      const za = zones.geometry.attributes, wa = walls.geometry.attributes;
      const sa = stand.geometry.attributes.aTeam, ca = cloth.geometry.attributes.aTeam;
      const hard = view.mode === 'hard';
      for (let i = 0; i < list.length && nZone < MAX_POINTS; i++) {
        const pt = list[i], r = pt.r ?? 4;
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
      za.aOwner.needsUpdate = true; za.aCapture.needsUpdate = true; za.aZone.needsUpdate = true;
      wa.aOwner.needsUpdate = true; wa.aZone.needsUpdate = true;
      sa.needsUpdate = true; ca.needsUpdate = true;
    }
    zones.count = nZone; walls.count = nWall; stand.count = nFlag; cloth.count = nFlag;
    zones.instanceMatrix.needsUpdate = true; walls.instanceMatrix.needsUpdate = true;
    stand.instanceMatrix.needsUpdate = true; cloth.instanceMatrix.needsUpdate = true;
  }

  #updateNades(view, dt, lx, lz, hasLocal) {
    const list = view.projectiles, mesh = this.nades;
    let n = 0;
    this.trailClock += dt;
    const trail = this.trailClock > 0.05;
    if (trail) this.trailClock = 0;
    if (list) {
      const aTeam = mesh.geometry.attributes.aTeam;
      const spin = this.time.value * 14;
      for (let i = 0; i < list.length && n < MAX_NADES; i++) {
        const g = list[i];
        if (hasLocal && !this.#clear(lx, lz, g.x, g.z, view.smokes)) continue;
        const y = Math.max(0.3, g.y ?? 1);
        _e.set(spin, spin * 0.7 + i * 2, 0.4);
        _q.setFromEuler(_e);
        _p.set(g.x, y, g.z);
        _s.set(1, 1, 1);
        _m.compose(_p, _q, _s).toArray(mesh.instanceMatrix.array, n * 16);
        const rgb = NADE_RGB[g.kind] ?? FALLBACK;
        aTeam.setXYZ(n, rgb[0], rgb[1], rgb[2]);
        // The blink tightens as a cue that something is about to go off.
        const blink = 0.5 + 0.5 * Math.sin(this.time.value * 34 + i);
        this.vfx.addDot(g.x, y + 0.3, g.z, 0.2 + blink * 0.16, rgb);
        if (trail) this.vfx.spawn(g.x, y, g.z, 0, 0.2, 0, 0.22, 0.09, 0.03, rgb, 0, 0, 0);
        n++;
      }
      aTeam.needsUpdate = true;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  #updateSmoke(view, dt) {
    const list = view.smokes, slots = this.smokeSlots;
    for (const s of slots) s.live = false;
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
        alpha.setX(n, s.a);
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    alpha.needsUpdate = true;
  }

  #updateTurrets(view, dt, lx, lz, localTeam, uav, hasLocal) {
    const list = view.turrets, slots = this.turretSlots;
    const base = this.turretBase, head = this.turretHead;
    let n = 0;
    if (list) {
      for (const s of slots) s.touched = false;
      for (let i = 0; i < list.length && n < MAX_TURRETS; i++) {
        const t = list[i];
        let slot = slotOf(slots, t.id);
        if (!slot) {
          slot = slotOf(slots, null);
          if (!slot) continue;
          slot.id = t.id; slot.aim = t.aim ?? 0; slot.age = 0;
        }
        slot.touched = true;
        slot.age += dt;
        // Shortest way round; the head tracks smoothly even at the 15 Hz snapshot rate.
        let d = ((t.aim ?? 0) - slot.aim) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        slot.aim += d * damp(10, dt);

        const friendly = t.team === localTeam;
        if (!friendly && !uav && hasLocal && !this.#clear(lx, lz, t.x, t.z, view.smokes)) continue;

        const rgb = this.teamRGB[t.team] ?? this.teamRGB[0];
        const pop = Math.min(1, slot.age / 0.32);
        const eased = 1 - (1 - pop) * (1 - pop);
        _p.set(t.x, 0, t.z); _q.identity(); _s.set(1, eased, 1);
        _m.compose(_p, _q, _s).toArray(base.instanceMatrix.array, n * 16);
        _p.y = TURRET_Y * eased;
        _e.set(0, -slot.aim, 0); _q.setFromEuler(_e); _s.set(1.1, 1.1, 1.1);
        _m.compose(_p, _q, _s).toArray(head.instanceMatrix.array, n * 16);
        base.geometry.attributes.aTeam.setXYZ(n, rgb[0], rgb[1], rgb[2]);
        head.geometry.attributes.aTeam.setXYZ(n, rgb[0], rgb[1], rgb[2]);
        n++;
      }
      for (const s of slots) if (!s.touched) s.id = null;
      base.geometry.attributes.aTeam.needsUpdate = true;
      head.geometry.attributes.aTeam.needsUpdate = true;
    }
    base.count = n; head.count = n;
    base.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
  }

  #updateGunships(view, dt) {
    const list = view.gunships, slots = this.shipSlots;
    const mesh = this.gunship, shadow = this.shadow;
    let n = 0;
    if (list) {
      const aTeam = mesh.geometry.attributes.aTeam;
      for (let i = 0; i < list.length && n < MAX_GUNSHIPS; i++) {
        const g = list[i], s = slots[n];
        if (!s.active) { s.active = true; s.x = g.x; s.z = g.z; s.aim = g.aim; s.bank = 0; }
        s.x += (g.x - s.x) * damp(8, dt);
        s.z += (g.z - s.z) * damp(8, dt);
        let d = (g.aim - s.aim) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        const step = d * damp(8, dt);
        s.aim += step;
        s.bank += (Math.max(-0.5, Math.min(0.5, (step / Math.max(dt, 1e-3)) * 0.9)) - s.bank) * damp(4, dt);

        _p.set(s.x, GUNSHIP_Y, s.z);
        _e.set(s.bank, -s.aim, 0);
        _q.setFromEuler(_e);
        _s.set(1, 1, 1);
        _m.compose(_p, _q, _s).toArray(mesh.instanceMatrix.array, n * 16);
        // Ground shadow sits directly below, slightly enlarged because the craft is near the camera.
        _p.y = 0.2;
        _s.set(1.25, 1, 1.25);
        _m.compose(_p, _q, _s).toArray(shadow.instanceMatrix.array, n * 16);

        const rgb = this.teamRGB[g.team] ?? this.teamRGB[0];
        aTeam.setXYZ(n, rgb[0], rgb[1], rgb[2]);
        const sa = Math.sin(s.aim), ca = Math.cos(s.aim);
        for (let side = -1; side <= 1; side += 2) {
          const blink = 0.18 + 0.18 * Math.abs(Math.sin(this.time.value * 5 + side));
          this.vfx.addDot(s.x + ca * 0.3 - sa * side * 2.1, GUNSHIP_Y + 0.05, s.z + sa * 0.3 + ca * side * 2.1, blink, rgb);
        }
        n++;
      }
      aTeam.needsUpdate = true;
    }
    for (let i = n; i < slots.length; i++) slots[i].active = false;
    mesh.count = n; shadow.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    shadow.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const m of [this.nades, this.turretBase, this.turretHead, this.gunship, this.smokeMesh, this.tagMesh, this.flagStand, this.flagCloth, this.zones, this.zoneWalls]) m.geometry.dispose();
    for (const m of [this.solidMat, this.shadowMat, this.smokeMat, this.flagMat, this.zoneMat, this.wallMat]) m.dispose();
  }
}

export { GUNSHIP_Y };
