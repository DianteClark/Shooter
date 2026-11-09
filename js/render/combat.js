// Everything 4.0 added to the battlefield that is drawn from view state each frame: grenades in flight,
// smoke clouds, turrets and gunships. Fixed instanced pools, nothing allocated after construction.
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

  // Everything visible this frame is rebuilt from the view; slots only keep the bits of history that smooth it.
  update(view, dt, localX, localZ, localTeam, uav, hasLocal) {
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
    for (const m of [this.nades, this.turretBase, this.turretHead, this.gunship, this.smokeMesh]) m.geometry.dispose();
    for (const m of [this.solidMat, this.shadowMat, this.smokeMat]) m.dispose();
  }
}

export { GUNSHIP_Y };
