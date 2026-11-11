// Scorestreaks overhaul (V9, 2026-11), drawn: the new machines and drones, Aegis Dome bubbles, Airdrop crates on
// their way down, Carpet Lines (the reticle while it is drawn, the red line and the bomber once it drops), sonar
// sweeps, plates, and every streak being shot down. Kept out of combat.js and vfx.js (the weapon-feel engineer's);
// CombatFX owns one of these and calls update() and onEvents(), like EquipmentFX.
//
// Budget: one instanced draw for every model here (combat.modelMat, the same shader as the other vehicles) and one
// for every dome bubble; nothing allocated per frame. Everything else rides vfx.js batches (addDot, addRing, ring,
// spawn, sparks, pop), which thin out on the Low profile through vfx._n.
//
// Read from the top-down camera, on a phone, at a glance:
//   Rover        a six-wheeled chassis with the sentry's gun head on it, team-striped, and a red scan beam.
//   Wingman      a gun quadcopter at shoulder height with a team light; Scout a quadcopter with a camera ball and a
//                pale view ring under it showing what it is marking.
//   Aegis Dome   a team-tinted glass bubble with a bright rim on the ground: you can see what it covers.
//   Airdrop      a crate under a striped canopy, then a beacon on the ground with an opening ring that fills in the
//                colour of whoever is opening it (team colour: yours; red: stolen).
//   Carpet Line  while drawing: a red reticle and its dotted trail (your team only). Dropped: a red dashed line along
//                the ground for everyone and a bomber flying it, so the counter (get off the line) is plain.
//   Shot down    a burst, falling debris and a smoke trail to a scorch, wherever it was.
import * as THREE from 'three';
import * as VFX from './vfx.js';
import { castRay } from './fog.js';
import { hexRGB } from './art.js';
import { smokeBlocks } from '../shared/geometry.js';
import { BOMB_DELAY, BOMB_RADIUS, BOMB_STEP, DOME_R, DROP_DELAY, SWEEP_R, SCOUT_EYE } from '../sim/streaks-v9.js';

const M = { recon: 0, hound: 1, rover: 2, emitter: 3, crate: 4, bomber: 5 };
const MAX = 24, MAX_DOMES = 6, MAX_DROPS = 6, MAX_LINES = 4, TRAIL = 48, MAX_TRAILS = 4;
const SCOUT_Y = 4, HOUND_Y = 2.6, BOMBER_Y = 9, DROP_FROM = 9;
const MAX_MARKS = 96;          // Overlay rings: the Carpet Line reticle, its trail and the dropped line's markers.
const RED = hexRGB(0xff3a2a), WHITE = [1, 1, 1], HOT = [1, 0.86, 0.5], SMOKE = [0.16, 0.16, 0.18], DEBRIS = [0.32, 0.34, 0.37];
const STEEL = hexRGB(0x9fb8d0), SONAR = hexRGB(0x6fe0ff), LIME = hexRGB(0x7dff9a);
const rand = (a, b) => a + Math.random() * (b - a);

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _axisY = new THREE.Vector3(0, 1, 0);
const _rgb = [0, 0, 0];

// Origin at the centre on the ground (drones: at their body), +X forward.
function buildModels(ModelSet) {
  const S = new ModelSet();
  const rotors = (b, S, arm, y, size) => {
    for (const [x, z] of [[arm, arm], [-arm, arm], [arm, -arm], [-arm, -arm]]) {
      S.rig(x, y, z, 1, bb => { bb.setPart(0).setColor(0x15171b).box(x, y, z, size, 0.015, 0.07); bb.box(x, y, z, 0.07, 0.015, size); });
    }
  };
  S.model(M.recon, b => {               // Recon quad: flat X frame, camera ball underneath, team nose stripe.
    b.setPart(0).setColor(0x2e343b).box(0, 0, 0, 0.5, 0.12, 0.34, 0.04);
    b.setColor(0x454c55);
    b.matrix = new THREE.Matrix4().makeRotationY(Math.PI / 4); b.box(0, 0, 0, 1.4, 0.05, 0.07); b.box(0, 0, 0, 0.07, 0.05, 1.4); b.matrix = null;
    b.setColor(0x15171b).prismY(-0.24, -0.06, 0.1, 0, 0.11, 0.12, 8);
    b.setPart(2).box(0.2, -0.16, 0, 0.06, 0.08, 0.08);
    b.setPart(1).box(0.18, 0.07, 0, 0.14, 0.03, 0.3);
    rotors(b, S, 0.5, 0.06, 0.55);
  });
  S.model(M.hound, b => {               // Gun quad: chunkier, a long barrel under the nose and a team-lit back.
    b.setPart(0).setColor(0x2a2f35).box(0, 0, 0, 0.62, 0.2, 0.44, 0.05);
    b.setColor(0x3d434b); b.box(0, 0, 0, 1.5, 0.06, 0.08); b.box(0, 0, 0, 0.08, 0.06, 1.5);
    b.setColor(0x16181c).prismX(0.1, 0.95, -0.17, 0, 0.05, 0.045, 6);
    b.box(-0.05, -0.15, 0, 0.3, 0.12, 0.2, 0.02);
    b.setPart(1).box(-0.12, 0.11, 0, 0.3, 0.03, 0.34);
    b.setPart(2).box(0.33, 0.04, 0, 0.05, 0.06, 0.16);
    rotors(b, S, 0.72, 0.08, 0.62);
  });
  S.model(M.rover, b => {               // Six wheels, a low armoured body, the gun head on a turning rig.
    b.setPart(0).setColor(0x30353b).box(0, 0.42, 0, 1.5, 0.34, 0.86, 0.06);
    b.setColor(0x3e454d).box(0.55, 0.5, 0, 0.32, 0.22, 0.8, 0.04);
    b.setColor(0x15171b);
    for (const x of [-0.55, 0, 0.55]) for (const z of [-0.5, 0.5]) b.prismZ(z - 0.1, z + 0.1, x, 0.24, 0.24, 0.24, 8);
    b.setPart(1).box(-0.15, 0.6, 0, 1.0, 0.03, 0.9);
    S.rig(0, 0, 0, 1, bb => {
      const y = 0.72;
      bb.setPart(0).setColor(0x3a3f47).box(0.05, y + 0.12, 0, 0.6, 0.26, 0.4, 0.04);
      bb.setColor(0x1c1f24).prismX(0.35, 1.15, y + 0.14, 0, 0.065, 0.06, 6);
      bb.setColor(0x4c5a67).box(-0.18, y + 0.1, 0.24, 0.24, 0.18, 0.12, 0.03);
      bb.setPart(2).box(0.36, y + 0.28, 0, 0.06, 0.06, 0.18);
    });
  });
  S.model(M.emitter, b => {             // Dome emitter: a squat drum, a coil mast and a lit cap.
    b.setPart(0).setColor(0x2b3036).prismY(0, 0.28, 0, 0, 0.42, 0.38, 8);
    b.setColor(0x4a5058).prismY(0.28, 0.9, 0, 0, 0.12, 0.08, 6);
    for (const y of [0.42, 0.58, 0.74]) b.setColor(0x6b7480).prismY(y, y + 0.05, 0, 0, 0.2, 0.2, 8);
    b.setPart(1).prismY(0.2, 0.28, 0, 0, 0.43, 0.43, 8);
    b.setPart(2).prismY(0.9, 1.05, 0, 0, 0.13, 0.05, 8);
  });
  S.model(M.crate, b => {               // Airdrop crate with a striped canopy that folds into the hub on landing.
    b.setPart(0).setColor(0x3a3328).box(0, 0.07, 0, 1.25, 0.14, 0.95);
    b.setColor(0x34404a).box(0, 0.6, 0, 1.15, 0.92, 0.85, 0.04);
    b.setPart(1).box(0, 0.62, 0, 1.17, 0.16, 0.87);
    b.setPart(0).setColor(0xe8e4d8).box(0, 1.08, 0, 0.6, 0.02, 0.16); b.box(0, 1.08, 0, 0.16, 0.02, 0.6);
    b.setPart(2).box(0, 1.16, 0, 0.18, 0.12, 0.18);
    S.rig(0, 1.1, 0, 2, bb => {
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
        bb.setPart(0).setColor(i % 2 ? 0x2f6fae : 0xe2dccc);
        bb.loft([
          [[0, 4.3, 0], [Math.cos(a0) * 0.2, 4.3, Math.sin(a0) * 0.2], [Math.cos(a1) * 0.2, 4.3, Math.sin(a1) * 0.2]],
          [[0, 3.6, 0], [Math.cos(a0) * 1.7, 3.6, Math.sin(a0) * 1.7], [Math.cos(a1) * 1.7, 3.6, Math.sin(a1) * 1.7]],
        ]);
      }
      bb.setColor(0x9a9488);
      for (const [x, z] of [[0.5, 0.36], [-0.5, 0.36], [0.5, -0.36], [-0.5, -0.36]]) bb.prismY(1.1, 3.6, x, z, 0.012, 0.012, 3);
    });
  });
  S.model(M.bomber, b => {              // The Carpet Line bomber: long swept wing, four engines, seen from straight above.
    b.setPart(0).setColor(0x22262c).prismX(-3, 3.2, 0, 0, 0.5, 0.36, 8, Math.PI / 8);
    b.setColor(0x2c3138);
    b.matrix = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    b.extrude([[0.9, -0.2], [0.4, -4.6], [-0.5, -4.6], [-0.9, -0.3], [-0.9, 0.3], [-0.5, 4.6], [0.4, 4.6], [0.9, 0.2]], -0.06, 0.06);
    b.extrude([[-2.4, -0.15], [-2.9, -1.8], [-3.3, -1.8], [-3.2, 0], [-3.3, 1.8], [-2.9, 1.8], [-2.4, 0.15]], -0.05, 0.05);
    b.matrix = null;
    b.setColor(0x3a4048);
    for (const z of [-1.5, -2.9, 1.5, 2.9]) b.prismX(-0.3, 0.7, -0.15, z, 0.16, 0.14, 6);
    b.setPart(1).box(0.1, 0.08, -4.2, 0.5, 0.02, 0.6); b.box(0.1, 0.08, 4.2, 0.5, 0.02, 0.6);
    b.setPart(2).box(-3.25, 0.1, -1.7, 0.12, 0.08, 0.12); b.box(-3.25, 0.1, 1.7, 0.12, 0.08, 0.12);
  });
  return S.build();
}

// Glass bubble: a hemisphere, brightest at its rim (where you look through the most of it), tinted per instance.
const DOME_VERT = /* glsl */`
attribute vec3 aTeam;
varying vec3 vC; varying float vRim;
void main(){
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vec3 v = normalize(cameraPosition - w.xyz);
  vRim = 1.0 - abs(dot(n, v));
  vC = aTeam;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const DOME_FRAG = /* glsl */`
uniform float uTime;
varying vec3 vC; varying float vRim;
void main(){
  float a = 0.07 + 0.5 * pow(vRim, 2.2);
  gl_FragColor = vec4(vC * (0.6 + 0.6 * vRim), a);
}`;

export class StreaksFX {
  // combat: the CombatFX that owns this (scene, vfx, time, modelMat, teamRGB, teamOf, posOf, map).
  constructor(combat, { ModelSet }) {
    this.c = combat;
    this.vfx = combat.vfx;
    this.visionWalls = combat.map.walls.filter(w => w.blocksVision);
    const geom = buildModels(ModelSet);
    const add = (g, name, n, cap) => g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage));
    add(geom, 'aShow', 1, MAX); add(geom, 'aAcc', 3, MAX); add(geom, 'aLight', 4, MAX); add(geom, 'aFx', 4, MAX);
    this.mesh = this.#mesh(new THREE.InstancedMesh(geom, combat.modelMat, MAX), 3);

    const dg = new THREE.SphereGeometry(1, 22, 9, 0, Math.PI * 2, 0, Math.PI / 2);
    add(dg, 'aTeam', 3, MAX_DOMES);
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, uniforms: { uTime: combat.time },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.domes = this.#mesh(new THREE.InstancedMesh(dg, this.domeMat, MAX_DOMES), 7);
    // Carpet Line marks draw over rooftops (no depth test): a line drawn across a building must still read as a line.
    this.markMat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const mg = new THREE.RingGeometry(0.82, 1, 28).rotateX(-Math.PI / 2);
    this.marks = this.#mesh(new THREE.InstancedMesh(mg, this.markMat, MAX_MARKS), 9);
    this.marks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MARKS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.nm = 0;

    this.rovers = new Map();              // id -> {x, z, yaw, age}: smoothed body heading from the way it moves.
    this.drops = Array.from({ length: MAX_DROPS }, () => ({ t: -1, x: 0, z: 0, team: 0, delay: DROP_DELAY }));
    this.lines = Array.from({ length: MAX_LINES }, () => ({ t: -1, pts: [], team: 0, dur: 0, len: 0 }));
    this.trails = Array.from({ length: MAX_TRAILS }, () => ({ owner: null, pts: new Float32Array(TRAIL * 2), n: 0, seen: false }));
    this.smokeT = 0;
    VFX.prewarm?.([this.mesh, this.domes, this.marks]);
  }

  #mesh(m, order) {
    m.frustumCulled = false; m.count = 0; m.renderOrder = order;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceMatrix.array.fill(0);
    this.c.scene.add(m);
    return m;
  }

  #clear(x0, z0, x1, z1, smokes) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 0.5) return true;
    return castRay(this.visionWalls, x0, z0, dx / len, dz / len, len) >= len && !smokeBlocks(smokes, x0, z0, x1, z1);
  }

  #put(n, model, yaw, x, y, z, k, acc, light, li, fold, turn) {
    const g = this.mesh.geometry;
    _q.setFromAxisAngle(_axisY, -yaw);
    _p.set(x, y, z); _s.set(k, k, k);
    _m.compose(_p, _q, _s).toArray(this.mesh.instanceMatrix.array, n * 16);
    g.attributes.aShow.setX(n, model);
    g.attributes.aAcc.setXYZ(n, acc[0], acc[1], acc[2]);
    g.attributes.aLight.setXYZW(n, light[0], light[1], light[2], li);
    g.attributes.aFx.setXYZW(n, 0, fold, turn, 0);
    return n + 1;
  }

  // One overlay ring this frame: radius r, colour rgb scaled by a (additive, so a is its strength).
  #mark(x, z, r, rgb, a) {
    if (this.nm >= MAX_MARKS) return;
    _p.set(x, 0.25, z); _q.identity(); _s.set(r, 1, r);
    _m.compose(_p, _q, _s).toArray(this.marks.instanceMatrix.array, this.nm * 16);
    this.marks.instanceColor.setXYZ(this.nm++, rgb[0] * a, rgb[1] * a, rgb[2] * a);
  }

  update(view, dt, lx, lz, localTeam, uav, hasLocal) {
    const c = this.c, vfx = this.vfx, t = c.time.value;
    let n = 0, nd = 0;
    this.nm = 0;
    this.smokeT += dt;
    const puff = this.smokeT > 0.08;
    if (puff) this.smokeT = 0;
    const team = id => c.teamRGB[id] ?? c.teamRGB[0];

    // Machines on the ground.
    const de = view.deploys;
    if (de) {
      for (let i = 0; i < de.length && n < MAX - 4; i++) {
        const d = de[i], rgb = team(d.team), friendly = d.team === localTeam;
        if (d.kind === 'dome') {
          if (nd < MAX_DOMES) {
            const fade = Math.min(1, (d.life ?? 9) / 1.5);
            _p.set(d.x, 0.05, d.z); _q.identity(); _s.set(DOME_R, DOME_R * 0.72, DOME_R);
            _m.compose(_p, _q, _s).toArray(this.domes.instanceMatrix.array, nd * 16);
            this.domes.geometry.attributes.aTeam.setXYZ(nd, rgb[0] * fade, rgb[1] * fade, rgb[2] * fade);
            nd++;
          }
          vfx.addRing(d.x, d.z, DOME_R - 0.16, DOME_R + 0.04, rgb, 0.75);
          vfx.addRing(d.x, d.z, DOME_R - 0.6, DOME_R - 0.16, rgb, 0.12 + 0.06 * Math.sin(t * 3));
          n = this.#put(n, M.emitter, 0, d.x, 0, d.z, 1, rgb, rgb, 0.6 + 0.4 * Math.sin(t * 6), 1, 0);
          continue;
        }
        if (d.kind === 'crate') {
          // A beacon everyone can see, and an opening ring in the colour of whoever is opening it.
          n = this.#put(n, M.crate, 0.3, d.x, 0, d.z, 1, rgb, (t * 2) % 1 < 0.5 ? rgb : WHITE, 0.9, 0, 0);
          vfx.addDot(d.x, 2.2 + 0.15 * Math.sin(t * 4), d.z, 0.5, rgb);
          vfx.addRing(d.x, d.z, 1.45, 1.6, rgb, 0.5);
          const k = Math.abs(d.aim ?? 0);
          if (k > 0.01) {
            const own = (d.aim ?? 0) > 0, col = own ? rgb : RED;
            vfx.addRing(d.x, d.z, 0, 1.45 * k, col, 0.35);
            vfx.addRing(d.x, d.z, 1.45 * k - 0.12, 1.45 * k, col, 0.95);
          }
          continue;
        }
        if (d.kind === 'rover') {
          if (!friendly && !uav && hasLocal && !this.#clear(lx, lz, d.x, d.z, view.smokes)) continue;
          let s = this.rovers.get(d.id);
          if (!s) { s = { x: d.x, z: d.z, yaw: d.aim ?? 0, age: 0 }; this.rovers.set(d.id, s); }
          const mx = d.x - s.x, mz = d.z - s.z;
          if (mx * mx + mz * mz > 0.0025) s.yaw = lerpAngle(s.yaw, Math.atan2(mz, mx), Math.min(1, dt * 8));
          s.x = d.x; s.z = d.z; s.age = t;
          const dying = (d.life ?? 9) < 3 && Math.sin(t * 22) < 0;
          n = this.#put(n, M.rover, s.yaw, d.x, 0, d.z, 1.15, rgb, RED, dying ? 0.05 : 0.8, 1, (d.aim ?? 0) - s.yaw);
          const ca = Math.cos(d.aim ?? 0), sa = Math.sin(d.aim ?? 0);
          _rgb[0] = RED[0] * 0.35; _rgb[1] = RED[1] * 0.35; _rgb[2] = RED[2] * 0.35;
          vfx.addBeam(d.x + ca * 1.3, 1.0, d.z + sa * 1.3, d.x + ca * 7, 0.8, d.z + sa * 7, _rgb, 0.025);
          if (puff && Math.random() < 0.35) vfx.spawn(d.x - Math.cos(s.yaw) * 0.8, 0.2, d.z - Math.sin(s.yaw) * 0.8, 0, 0.4, 0, 0.6, 0.18, 0.5, DEBRIS, 0.25, -0.2, 0.6);
          if (d.hp > 0 && d.maxHp && d.hp / d.maxHp < 0.4 && puff) vfx.spawn(d.x, 1, d.z, rand(-0.3, 0.3), rand(1.2, 2), rand(-0.3, 0.3), 1, 0.25, 0.8, SMOKE, 0.6, -0.4, 0.5);
        }
      }
      if (this.rovers.size > 8) for (const [id, s] of this.rovers) if (s.age < t - 2) this.rovers.delete(id);
    }

    // Drones and the Carpet Line reticle.
    for (let i = 0; i < this.trails.length; i++) this.trails[i].seen = false;
    const dr = view.drones;
    if (dr) {
      for (let i = 0; i < dr.length && n < MAX - 2; i++) {
        const d = dr[i], rgb = team(d.team), friendly = d.team === localTeam;
        if (d.kind === 'reticle') {
          if (!friendly) continue;
          this.#reticle(d, t, d.owner === view.localId);
          continue;
        }
        const y = d.kind === 'recon' ? SCOUT_Y : HOUND_Y;
        const bob = Math.sin(t * 3.3 + i) * 0.12, spin = t * 40;
        n = this.#put(n, d.kind === 'recon' ? M.recon : M.hound, d.aim ?? 0, d.x, y + bob, d.z, d.kind === 'recon' ? 1.25 : 1.2, rgb, rgb, 0.5 + 0.5 * Math.abs(Math.sin(t * 5)), 1, spin);
        if (d.kind === 'recon') {
          vfx.addRing(d.x, d.z, SCOUT_EYE - 0.12, SCOUT_EYE, friendly ? SONAR : RED, friendly ? 0.4 : 0.22);
          if (friendly) vfx.addRing(d.x, d.z, 0, SCOUT_EYE, SONAR, 0.05);
        } else vfx.addRing(d.x, d.z, 0.5, 0.75, rgb, 0.35);           // Its shadow-ring, so you can see where it is.
        this.#damaged(d, y, puff);
      }
    }
    for (let i = 0; i < this.trails.length; i++) if (!this.trails[i].seen) this.trails[i].owner = null;
    // Older aircraft get the damage smoke too.
    const gl = view.gunships;
    if (gl && puff) for (let i = 0; i < gl.length; i++) {
      const g = gl[i];
      this.#damaged(g, g.kind === 'gunship' ? 7.5 : g.kind === 'chopper' ? 5.6 : g.kind === 'swarm' ? 2.9 : 1.7, true);
    }

    // Airdrops on their way down: a crate under its canopy, and the landing spot ringed.
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (d.t < 0) continue;
      d.t += dt;
      const u = d.t / d.delay;
      if (u >= 1 || n >= MAX) { d.t = -1; continue; }
      const rgb = team(d.team), y = DROP_FROM * (1 - u) * (1 - u * 0.3);
      n = this.#put(n, M.crate, 0.3 + u, d.x + Math.sin(t * 2) * 0.2 * (1 - u), y, d.z, 1, rgb, rgb, 0.8, 1, 0);
      vfx.addRing(d.x, d.z, 1.2 - 0.6 * u, 1.45, rgb, 0.3 + 0.4 * u);
    }

    // Carpet Lines: the red line on the ground until the last bomb, the bomber flying it.
    for (let i = 0; i < this.lines.length; i++) {
      const L = this.lines[i];
      if (L.t < 0) continue;
      L.t += dt;
      if (L.t > L.dur + 0.4) { L.t = -1; continue; }
      const pts = L.pts, blink = 0.55 + 0.45 * Math.sin(t * 14);
      for (let k = 0; k < pts.length; k += 2) {
        const at = BOMB_DELAY + (k / 2) * BOMB_STEP;
        if (L.t > at) continue;
        this.#mark(pts[k], pts[k + 1], BOMB_RADIUS, RED, 0.28 * blink);
        this.#mark(pts[k], pts[k + 1], 0.35, RED, 0.9);
        if (k + 3 < pts.length) {
          for (let s = 1; s < 4; s++) { const f = s / 4; this.#mark(pts[k] + (pts[k + 2] - pts[k]) * f, pts[k + 1] + (pts[k + 3] - pts[k + 1]) * f, 0.18, RED, 0.8); }
        }
      }
      // The bomber crosses the line in the time the bombs take to fall, starting a little before the first.
      const f = Math.min(1, Math.max(0, (L.t - (BOMB_DELAY - 0.9)) / Math.max(0.3, L.dur - BOMB_DELAY + 0.9)));
      if (f > 0 && f < 1 && n < MAX && pts.length >= 4) {
        const ax = pts[0], az = pts[1], bx = pts[pts.length - 2], bz = pts[pts.length - 1];
        const yaw = Math.atan2(bz - az, bx - ax), over = 12;
        const ex = ax - Math.cos(yaw) * over + (bx - ax + Math.cos(yaw) * over * 2) * f;
        const ez = az - Math.sin(yaw) * over + (bz - az + Math.sin(yaw) * over * 2) * f;
        n = this.#put(n, M.bomber, yaw, ex, BOMBER_Y, ez, 1.1, team(L.team), RED, 0.7, 1, 0);
      }
    }

    // Plates: a thin steel ring at the feet of everyone wearing them that you can see (teammates always).
    const ps = view.players;
    if (ps) for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!(p.plates > 0) || !p.alive) continue;
      if (p.team !== localTeam && hasLocal && !uav && !this.#clear(lx, lz, p.x, p.z, view.smokes)) continue;
      vfx.addRing(p.x, p.z, 0.62, 0.72, STEEL, 0.45 + 0.4 * Math.min(1, p.plates / 100));
    }

    const mesh = this.mesh, g = mesh.geometry;
    mesh.count = n;
    if (n) { mesh.instanceMatrix.needsUpdate = true; g.attributes.aShow.needsUpdate = true; g.attributes.aAcc.needsUpdate = true; g.attributes.aLight.needsUpdate = true; g.attributes.aFx.needsUpdate = true; }
    this.domes.count = nd;
    this.marks.count = this.nm;
    if (this.nm) { this.marks.instanceMatrix.needsUpdate = true; this.marks.instanceColor.needsUpdate = true; }
    if (nd) { this.domes.instanceMatrix.needsUpdate = true; this.domes.geometry.attributes.aTeam.needsUpdate = true; }
  }

  // A damaged aircraft trails smoke; under a third, it trails fire too.
  #damaged(g, y, puff) {
    const f = g.hpf ?? 1;
    if (!puff || f >= 0.5) return;
    const vfx = this.vfx;
    vfx.spawn(g.x + rand(-0.3, 0.3), y, g.z + rand(-0.3, 0.3), rand(-0.3, 0.3), rand(0.4, 1), rand(-0.3, 0.3), rand(0.9, 1.5), 0.3, 1.1, SMOKE, 0.65, -0.3, 0.4);
    if (f < 0.34) vfx.spawn(g.x, y, g.z, rand(-0.6, 0.6), rand(0.5, 1.5), rand(-0.6, 0.6), rand(0.2, 0.35), 0.35, 0.1, HOT, 0, -1, 1);
  }

  // The reticle: a red crosshair ring on the ground and the trail it has drawn (its own team sees it).
  #reticle(d, t, mine) {
    const vfx = this.vfx;
    let tr = this.trails.find(s => s.owner === d.owner);
    if (!tr) { tr = this.trails.find(s => s.owner === null); if (!tr) return; tr.owner = d.owner; tr.n = 0; }
    tr.seen = true;
    const P = tr.pts;
    if (tr.n === 0 || Math.hypot(d.x - P[(tr.n - 1) * 2], d.z - P[(tr.n - 1) * 2 + 1]) > 0.7) {
      if (tr.n < TRAIL) tr.n++;
      P[(tr.n - 1) * 2] = d.x; P[(tr.n - 1) * 2 + 1] = d.z;
    }
    for (let k = 0; k < tr.n; k++) this.#mark(P[k * 2], P[k * 2 + 1], 0.22, RED, 0.9);
    const pulse = 0.6 + 0.4 * Math.sin(t * 10);
    this.#mark(d.x, d.z, BOMB_RADIUS, RED, 0.55 * pulse);
    this.#mark(d.x, d.z, 0.6, RED, 1);
    if (mine) {
      const a = d.aim ?? 0;
      vfx.addBeam(d.x - Math.cos(a) * 1.4, 0.3, d.z - Math.sin(a) * 1.4, d.x + Math.cos(a) * 1.4, 0.3, d.z + Math.sin(a) * 1.4, RED, 0.06);
      vfx.addBeam(d.x + Math.sin(a) * 1.4, 0.3, d.z - Math.cos(a) * 1.4, d.x - Math.sin(a) * 1.4, 0.3, d.z + Math.cos(a) * 1.4, RED, 0.06);
    }
  }

  onEvents(events, localId, localTeam) {
    const vfx = this.vfx, c = this.c;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.t) {
        case 'streak':
          if (ev.kind === 'airdrop' && Number.isFinite(ev.x)) {
            const d = this.drops.find(s => s.t < 0);
            if (d) { d.t = 0; d.x = ev.x; d.z = ev.z; d.team = ev.team ?? 0; d.delay = ev.delay ?? DROP_DELAY; }
          } else if (ev.kind === 'bombrun' && Array.isArray(ev.path)) {
            const L = this.lines.find(s => s.t < 0);
            if (L) { L.t = 0; L.pts = ev.path; L.team = ev.team ?? 0; L.dur = BOMB_DELAY + (ev.path.length / 2) * BOMB_STEP; }
          } else if (ev.kind === 'dome' && Number.isFinite(ev.x)) {
            const rgb = c.teamRGB[ev.team ?? 0] ?? c.teamRGB[0];
            vfx.ring(ev.x, ev.z, 0.4, DOME_R, 0.5, rgb, 0.95);
            vfx.pop(ev.x, 1.5, ev.z, DOME_R, rgb, 0.25);
          } else if (ev.kind === 'plates' && Number.isFinite(ev.x)) {
            vfx.ring(ev.x, ev.z, 0.5, 14, 0.6, STEEL, 0.5);
          } else if ((ev.kind === 'hound' || ev.kind === 'recon' || ev.kind === 'rover') && Number.isFinite(ev.x)) {
            vfx.ring(ev.x, ev.z, 0.3, 2.2, 0.35, c.teamRGB[ev.team ?? 0] ?? WHITE, 0.8);
          }
          break;
        case 'sweep': {
          const own = ev.team === localTeam, rgb = own ? SONAR : RED;
          vfx.ring(ev.x, ev.z, 0.5, ev.r || SWEEP_R, 1.1, rgb, own ? 0.75 : 0.45);
          vfx.ring(ev.x, ev.z, 0.3, (ev.r || SWEEP_R) * 0.6, 0.8, rgb, own ? 0.4 : 0.25);
          break;
        }
        case 'plates': {
          const p = c.posOf.get(ev.id);
          if (p) { vfx.ring(p.x, p.z, 0.2, 1.3, 0.3, STEEL, 0.9); vfx.sparks(p.x, 1.2, p.z, 0, 0, WHITE, vfx._n(5), 4); }
          break;
        }
        case 'plates_break':
          for (let k = vfx._n(6); k > 0; k--) vfx.shard(ev.x, 1.2, ev.z, rand(-4, 4), rand(2, 5), rand(-4, 4), STEEL, rand(0.5, 0.9));
          break;
        case 'crate':
          vfx.ring(ev.x, ev.z, 0.3, 3, 0.4, DEBRIS, 0.7);
          for (let k = vfx._n(10); k > 0; k--) { const a = rand(0, 6.283); vfx.spawn(ev.x, 0.2, ev.z, Math.cos(a) * 3, 0.5, Math.sin(a) * 3, 0.6, 0.3, 0.9, DEBRIS, 0.4, 0, 2); }
          break;
        case 'crate_open': {
          const rgb = ev.stolen ? RED : (c.teamRGB[ev.team ?? 0] ?? WHITE);
          vfx.pop(ev.x, 1.2, ev.z, 4, rgb, 0.3);
          vfx.ring(ev.x, ev.z, 0.2, 3.2, 0.45, rgb, 0.95);
          vfx.sparks(ev.x, 1, ev.z, 0, 0, HOT, vfx._n(12), 7);
          for (let k = vfx._n(6); k > 0; k--) vfx.shard(ev.x, 0.8, ev.z, rand(-4, 4), rand(3, 6), rand(-4, 4), DEBRIS, rand(0.6, 1.1));
          break;
        }
        case 'air_down': this.#airDown(ev); break;
        case 'turret_shot':
          if (ev.kind === 'hound') vfx.muzzleFlash(ev.ox, HOUND_Y - 0.2, ev.oz, Math.atan2(ev.z - ev.oz, ev.x - ev.ox), HOT, 0.45);
          break;
        case 'marked':
          if (ev.kind === 'sweep' || ev.kind === 'recon') {
            const p = c.posOf.get(ev.id);
            if (p && c.teamOf.get(ev.id) !== localTeam) vfx.ring(p.x, p.z, 0.2, 1.6, 0.4, ev.kind === 'recon' ? SONAR : LIME, 0.8);
          }
          break;
        default: break;
      }
    }
  }

  // Shot down (or knocked out by an EMP): a burst where it was, debris raining, a smoke column and a scorch below.
  #airDown(ev) {
    const vfx = this.vfx, k = ev.kind;
    const big = k === 'gunship' || k === 'chopper';
    const y = k === 'gunship' ? 7.5 : k === 'chopper' ? 5.6 : k === 'recon' ? SCOUT_Y : k === 'hound' ? HOUND_Y : 2.2;
    vfx.pop(ev.x, y, ev.z, big ? 9 : 4, HOT, big ? 0.4 : 0.25);
    vfx.fireball?.(ev.x, y, ev.z, big ? 3 : 1.4, big ? 0.6 : 0.4);
    vfx.sparks(ev.x, y, ev.z, 0, 0, HOT, vfx._n(big ? 18 : 9), big ? 12 : 8);
    for (let j = vfx._n(big ? 14 : 6); j > 0; j--) vfx.shard(ev.x, y, ev.z, rand(-5, 5), rand(-1, 4), rand(-5, 5), DEBRIS, rand(0.6, big ? 1.6 : 1));
    for (let j = vfx._n(big ? 8 : 3); j > 0; j--) vfx.spawn(ev.x + rand(-1, 1), y * rand(0.2, 1), ev.z + rand(-1, 1), rand(-0.4, 0.4), rand(0.5, 1.5), rand(-0.4, 0.4), rand(1.4, 2.4), 0.6, big ? 2.4 : 1.4, SMOKE, 0.6, -0.2, 0.4);
    vfx.scorch(ev.x, ev.z, big ? 3 : 1.4);
    if (ev.emp) vfx.ring(ev.x, ev.z, 0.2, big ? 4 : 2, 0.4, hexRGB(0x6aa8ff), 0.9);
  }

  reset() {
    this.mesh.count = 0; this.domes.count = 0; this.marks.count = 0;
    for (const d of this.drops) d.t = -1;
    for (const L of this.lines) L.t = -1;
    for (const tr of this.trails) tr.owner = null;
    this.rovers.clear();
  }

  dispose() {
    for (const m of [this.mesh, this.domes, this.marks]) { m.parent?.remove(m); m.geometry.dispose(); }
    this.domeMat.dispose(); this.markMat.dispose();
  }
}

function lerpAngle(a, b, k) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

