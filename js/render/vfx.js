// Pooled, event-driven effects. Every system is a single instanced draw over a fixed typed-array
// pool: new effects overwrite the oldest slot, nothing is allocated after construction.
import * as THREE from 'three';
import { GLSL_LIGHT } from './art.js';
import { MAX_POPS } from './world.js';

const TRACERS = 128;
const PARTS = 520;
const SHELLS = 48;
const SHARDS = 120;
const FLASHES = 20;
const BALLS = 10;
const RINGS = 36;

const rand = (a, b) => a + Math.random() * (b - a);

// Premultiplied blending lets one draw mix additive glow (alpha 0) with solid smoke (alpha 1).
const PREMULT = {
  transparent: true, depthWrite: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
};

function dyn(size, n) {
  return new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
}

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.dt = 0;
    this._buildTracers();
    this._buildParticles();
    this._buildShells();
    this._buildShards();
    this._buildFlashes();
    this._buildBalls();
    this._buildRings();
    this._buildPops();
  }

  /* ---------- Tracers ---------- */
  _buildTracers() {
    const g = new THREE.InstancedBufferGeometry();
    // A quad along [0,1] with a mid spine so the glow profile is geometry, not a texture.
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute([-1, 1, -1, -1, 1, 1], 1));
    g.setAttribute('aEnd', new THREE.Float32BufferAttribute([0, 0, 1, 1, 0, 1], 1));
    g.instanceCount = 0;
    g.setAttribute('aA', this.tA = dyn(3, TRACERS));
    g.setAttribute('aB', this.tB = dyn(3, TRACERS));
    g.setAttribute('aC', this.tC = dyn(4, TRACERS));
    this.tracerGeom = g;
    this.tracerMat = new THREE.ShaderMaterial({
      ...PREMULT,
      vertexShader: `
        attribute float aSide; attribute float aEnd; attribute vec3 aA; attribute vec3 aB; attribute vec4 aC;
        varying vec3 vC; varying float vS; varying float vE;
        void main(){
          vec3 p = mix(aA, aB, aEnd);
          vec3 dir = normalize(aB - aA);
          vec3 view = normalize(cameraPosition - p);
          vec3 side = normalize(cross(dir, view));
          p += side * aSide * aC.a;
          vC = aC.rgb; vS = aSide; vE = aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vS; varying float vE;
        void main(){
          float e = 1.0 - abs(vS);
          float glow = e * e;
          float core = smoothstep(0.55, 1.0, e);
          vec3 c = vC * glow * (0.5 + 0.9 * vE) + vec3(1.0) * core * (0.25 + 0.75 * vE);
          gl_FragColor = vec4(c, 0.0);
        }`,
    });
    this.tracerMesh = new THREE.Mesh(g, this.tracerMat);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.renderOrder = 6;
    this.scene.add(this.tracerMesh);

    this.tr = {
      n: 0, ax: new Float32Array(TRACERS), ay: new Float32Array(TRACERS), az: new Float32Array(TRACERS),
      bx: new Float32Array(TRACERS), by: new Float32Array(TRACERS), bz: new Float32Array(TRACERS),
      r: new Float32Array(TRACERS), g: new Float32Array(TRACERS), b: new Float32Array(TRACERS),
      w: new Float32Array(TRACERS), t: new Float32Array(TRACERS), dur: new Float32Array(TRACERS),
      len: new Float32Array(TRACERS), head: 0,
    };
  }

  tracer(ax, ay, az, bx, by, bz, rgb, width) {
    const T = this.tr;
    const i = T.head;
    T.head = (i + 1) % TRACERS;
    T.ax[i] = ax; T.ay[i] = ay; T.az[i] = az;
    T.bx[i] = bx; T.by[i] = by; T.bz[i] = bz;
    T.r[i] = rgb[0]; T.g[i] = rgb[1]; T.b[i] = rgb[2];
    T.w[i] = width;
    const dist = Math.hypot(bx - ax, bz - az);
    T.len[i] = dist;
    // Fast-moving bright head with a tail that lingers a beat so hits read.
    T.dur[i] = dist / 230 + 0.075;
    T.t[i] = T.dur[i];
  }

  /* ---------- Billboard particles (sparks, puffs, smoke) ---------- */
  _buildParticles() {
    const sides = 6, pos = [], rim = [];
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      pos.push(0, 0, 0, Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0);
      rim.push(1, 0, 0);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aRim', new THREE.Float32BufferAttribute(rim, 1));
    g.instanceCount = 0;
    g.setAttribute('aP', this.pP = dyn(4, PARTS));     // xyz, size
    g.setAttribute('aC', this.pC = dyn(4, PARTS));     // premultiplied rgba
    g.setAttribute('aAxis', this.pA = dyn(3, PARTS));  // Stretch axis in world space, 0 = plain billboard.
    this.partGeom = g;
    this.partMat = new THREE.ShaderMaterial({
      ...PREMULT,
      vertexShader: `
        attribute float aRim; attribute vec4 aP; attribute vec4 aC; attribute vec3 aAxis;
        varying vec4 vC; varying float vRim;
        void main(){
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 p;
          if (dot(aAxis, aAxis) > 1e-5) {
            vec3 toCam = normalize(cameraPosition - aP.xyz);
            vec3 side = normalize(cross(aAxis, toCam));
            p = aP.xyz + aAxis * position.x + side * position.y * aP.w;
          } else {
            p = aP.xyz + (right * position.x + up * position.y) * aP.w;
          }
          vC = aC; vRim = aRim;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec4 vC; varying float vRim;
        void main(){ float f = smoothstep(0.0, 0.5, vRim); gl_FragColor = vC * f; }`,
    });
    this.partMesh = new THREE.Mesh(g, this.partMat);
    this.partMesh.frustumCulled = false;
    this.partMesh.renderOrder = 5;
    this.scene.add(this.partMesh);

    const P = this.pp = { head: 0 };
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 't', 'life', 's0', 's1', 'r', 'g', 'b', 'a', 'grav', 'drag', 'stretch']) {
      P[k] = new Float32Array(PARTS);
    }
  }

  // a is 0 for glow (additive), 1 for solid smoke, or anything between.
  spawn(x, y, z, vx, vy, vz, life, s0, s1, rgb, a, grav, drag, stretch = 0) {
    const P = this.pp, i = P.head;
    P.head = (i + 1) % PARTS;
    P.x[i] = x; P.y[i] = y; P.z[i] = z;
    P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    P.t[i] = life; P.life[i] = life;
    P.s0[i] = s0; P.s1[i] = s1;
    P.r[i] = rgb[0]; P.g[i] = rgb[1]; P.b[i] = rgb[2]; P.a[i] = a;
    P.grav[i] = grav; P.drag[i] = drag; P.stretch[i] = stretch;
  }

  // Short bright sparks fanned out from an impact normal.
  sparks(x, y, z, nx, nz, rgb, n, speed = 11) {
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(nz, nx) + rand(-1.1, 1.1);
      const s = rand(speed * 0.4, speed);
      this.spawn(x, y, z, Math.cos(a) * s, rand(0.5, 5), Math.sin(a) * s, rand(0.12, 0.28), 0.1, 0.02, rgb, 0, 16, 2.2, 0.035);
    }
  }

  // Impact on a surface: sparks plus a small dust cloud leaving the wall.
  wallHit(x, z, nx, nz) {
    const y = rand(0.5, 1.5);
    this.sparks(x, y, z, nx, nz, WARM_SPARK, 6);
    for (let i = 0; i < 2; i++) {
      this.spawn(x + nx * 0.08, y, z + nz * 0.08, nx * rand(1, 3) + rand(-0.7, 0.7), rand(0.3, 1.3), nz * rand(1, 3) + rand(-0.7, 0.7),
        rand(0.25, 0.45), 0.14, 0.42, DUST, 0.5, -0.8, 3.0);
    }
  }

  // Body hit: bright burst in the victim's team colour, stylized rather than gory.
  bodyHit(x, z, rgb) {
    const y = rand(0.9, 1.4);
    for (let i = 0; i < 7; i++) {
      const a = rand(0, Math.PI * 2), s = rand(2, 7);
      this.spawn(x, y, z, Math.cos(a) * s, rand(1, 5), Math.sin(a) * s, rand(0.16, 0.32), 0.14, 0.03, rgb, 0.1, 16, 2.6, 0.04);
    }
    this.spawn(x, y, z, 0, 0, 0, 0.12, 0.3, 0.75, rgb, 0, 0, 0);
    this.spawn(x, y, z, 0, 0, 0, 0.09, 0.2, 0.4, WHITE, 0, 0, 0);
  }

  deathBurst(x, z, rgb) {
    const y = 1.1;
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2), s = rand(2, 8);
      this.shard(x, y + rand(-0.3, 0.5), z, Math.cos(a) * s, rand(3, 9), Math.sin(a) * s, rgb);
    }
    for (let i = 0; i < 16; i++) {
      const a = rand(0, Math.PI * 2), s = rand(3, 12);
      this.spawn(x, y, z, Math.cos(a) * s, rand(1, 7), Math.sin(a) * s, rand(0.2, 0.42), 0.16, 0.03, rgb, 0, 14, 2.2, 0.04);
    }
    this.spawn(x, y, z, 0, 0, 0, 0.16, 0.5, 1.9, rgb, 0, 0, 0);
    this.spawn(x, y, z, 0, 0, 0, 0.12, 0.4, 1.2, WHITE, 0, 0, 0);
    for (let i = 0; i < 5; i++) {
      this.spawn(x + rand(-0.3, 0.3), y - 0.4, z + rand(-0.3, 0.3), rand(-0.8, 0.8), rand(0.6, 1.5), rand(-0.8, 0.8),
        rand(0.45, 0.8), 0.32, 0.95, SMOKE, 0.75, -0.4, 1.4);
    }
    this.ring(x, z, 0.35, 1.8, 0.28, rgb, 0.9);
  }

  explosion(x, z, radius) {
    for (let i = 0; i < 24; i++) {
      const a = rand(0, Math.PI * 2), s = rand(5, 20);
      this.spawn(x, 0.6, z, Math.cos(a) * s, rand(4, 15), Math.sin(a) * s, rand(0.28, 0.65), 0.2, 0.04, FIRE, 0, 18, 1.5, 0.035);
    }
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2), s = rand(1, 5);
      this.spawn(x + Math.cos(a), 0.5, z + Math.sin(a), Math.cos(a) * s, rand(1, 4), Math.sin(a) * s,
        rand(0.8, 1.6), radius * 0.28, radius * 0.95, SMOKE, 0.82, -1.6, 1.6);
    }
    this.fireball(x, 0.9, z, radius);
    this.ring(x, z, radius * 0.2, radius * 1.6, 0.45, FIRE, 0.8);
    this.scorch(x, z, radius * 0.72);
    this.pop(x, 1.8, z, radius * 3.4, FIRE_POP, 0.26);
  }

  // Grenade: tighter and more violent than an airstrike explosion, with shrapnel.
  fragBurst(x, z, radius) {
    for (let i = 0; i < 18; i++) {
      const a = rand(0, Math.PI * 2), s = rand(8, 26);
      this.spawn(x, 0.5, z, Math.cos(a) * s, rand(3, 12), Math.sin(a) * s, rand(0.22, 0.42), 0.16, 0.03, FIRE, 0, 18, 1.5, 0.04);
    }
    for (let i = 0; i < 16; i++) {
      const a = rand(0, Math.PI * 2), s = rand(5, 15);
      this.shard(x, 0.6, z, Math.cos(a) * s, rand(4, 13), Math.sin(a) * s, GRENADE_SHARD);
    }
    for (let i = 0; i < 8; i++) {
      const a = rand(0, Math.PI * 2), s = rand(1, 4);
      this.spawn(x + Math.cos(a) * 0.5, 0.5, z + Math.sin(a) * 0.5, Math.cos(a) * s, rand(1, 3), Math.sin(a) * s, rand(0.5, 1), radius * 0.2, radius * 0.7, SMOKE, 0.7, -1.2, 1.8);
    }
    this.fireball(x, 0.8, z, radius * 0.85);
    this.ring(x, z, radius * 0.2, radius * 1.3, 0.3, FIRE, 1);
    this.scorch(x, z, radius * 0.55);
    this.pop(x, 1.6, z, radius * 3, FIRE_POP, 0.22);
  }

  // Flashbang: white-hot and instant, with no smoke, so it reads as different from a frag at a glance.
  flashBurst(x, z, radius) {
    this.spawn(x, 1.2, z, 0, 0, 0, 0.16, 1.2, radius * 1.3, WHITE, 0, 0, 0);
    this.spawn(x, 1.2, z, 0, 0, 0, 0.3, 0.8, radius * 0.7, FLASH_TINT, 0, 0, 0);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const s = rand(14, 26);
      this.spawn(x, 1.1, z, Math.cos(a) * s, rand(1, 6), Math.sin(a) * s, rand(0.14, 0.3), 0.14, 0.02, WHITE, 0, 0, 2.4, 0.05);
    }
    this.ring(x, z, 0.4, radius, 0.26, FLASH_TINT, 1);
    this.ring(x, z, 0.2, radius * 0.6, 0.2, WHITE, 1);
    this.pop(x, 2.2, z, radius * 3, FLASH_POP, 0.3);
  }

  // Headshot: a sharp gold star above the shoulders.
  headBurst(x, z) {
    const y = 1.7;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rand(-0.2, 0.2), s = rand(5, 10);
      this.spawn(x, y, z, Math.cos(a) * s, rand(2, 7), Math.sin(a) * s, rand(0.16, 0.28), 0.13, 0.02, HEAD_GOLD, 0, 14, 2.4, 0.05);
    }
    this.spawn(x, y, z, 0, 0, 0, 0.13, 0.5, 1.5, HEAD_GOLD, 0, 0, 0);
    this.spawn(x, y, z, 0, 0, 0, 0.09, 0.3, 0.8, WHITE, 0, 0, 0);
  }

  // Stim: rising green motes and a soft ring at the feet.
  healBurst(x, z) {
    for (let i = 0; i < 16; i++) {
      const a = rand(0, Math.PI * 2), r = rand(0.15, 0.7);
      this.spawn(x + Math.cos(a) * r, rand(0.2, 1), z + Math.sin(a) * r, 0, rand(2.2, 4.5), 0, rand(0.4, 0.75), 0.13, 0.03, HEAL, 0, 0, 0.6, 0.05);
    }
    this.ring(x, z, 0.3, 1.5, 0.42, HEAL, 0.9);
    this.pop(x, 1.2, z, 5, HEAL, 0.16);
  }

  // Overheat vent: pale steam jetting up off the barrel.
  steam(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      this.spawn(x, y, z, rand(-0.9, 0.9), rand(1.5, 3.6), rand(-0.9, 0.9), rand(0.45, 0.85), 0.1, 0.5, STEAM, 0.55, -1.2, 1.8);
    }
  }

  // Burst of matching low-poly-coloured puffs the moment a smoke cloud starts.
  smokePop(x, z, r) {
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2), s = rand(2, 5);
      this.spawn(x, 0.4, z, Math.cos(a) * s, rand(0.5, 2), Math.sin(a) * s, rand(0.4, 0.8), r * 0.15, r * 0.5, STEAM, 0.8, -0.5, 2.2);
    }
  }

  // Deployed turret landing.
  turretDrop(x, z, rgb) {
    for (let i = 0; i < 6; i++) this.spawn(x + rand(-0.5, 0.5), 0.2, z + rand(-0.5, 0.5), rand(-2, 2), rand(0.6, 2), rand(-2, 2), rand(0.25, 0.5), 0.14, 0.4, DUST, 0.5, -0.5, 2.5);
    this.ring(x, z, 0.3, 2.1, 0.36, rgb, 0.9);
  }

  spawnFx(x, z, rgb) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.spawn(x + Math.cos(a) * 0.3, rand(0.2, 1.4), z + Math.sin(a) * 0.3, Math.cos(a) * 1.2, rand(3, 7), Math.sin(a) * 1.2, rand(0.25, 0.5), 0.1, 0.02, rgb, 0, 0, 1, 0.06);
    }
    this.ring(x, z, 0.3, 1.4, 0.32, rgb, 0.85);
  }

  slideDust(x, z) {
    for (let i = 0; i < 6; i++) {
      this.spawn(x + rand(-0.3, 0.3), 0.15, z + rand(-0.3, 0.3), rand(-1.4, 1.4), rand(0.2, 1), rand(-1.4, 1.4), rand(0.3, 0.55), 0.18, 0.6, DUST, 0.5, -0.6, 2.2);
    }
  }

  muzzleSmoke(x, y, z) {
    this.spawn(x, y, z, rand(-0.4, 0.4), rand(0.6, 1.2), rand(-0.4, 0.4), rand(0.22, 0.4), 0.09, 0.32, DUST, 0.32, -0.8, 2.8);
  }

  /* ---------- Shells (brass) and shards (death chunks) ---------- */
  _makeSolid(geom, count, order) {
    if (!this.solidMat) {
      this.solidMat = new THREE.ShaderMaterial({
        vertexShader: `
          attribute vec4 aC; varying vec3 vC;
          ${GLSL_LIGHT}
          void main(){
            mat4 w = modelMatrix * instanceMatrix;
            vC = aC.rgb * (0.55 + 0.55 * duskLight(normalize(mat3(w) * normal)));
            gl_Position = projectionMatrix * viewMatrix * w * vec4(position, 1.0);
          }`,
        fragmentShader: `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`,
      });
    }
    const m = new THREE.InstancedMesh(geom, this.solidMat, count);
    m.frustumCulled = false;
    m.count = 0;
    m.renderOrder = 3;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('aC', dyn(4, count));
    this.scene.add(m);
    return m;
  }

  _buildShells() {
    const geom = new THREE.BoxGeometry(0.22, 0.075, 0.075).toNonIndexed();
    geom.computeVertexNormals();
    this.shellMesh = this._makeSolid(geom, SHELLS, 3);
    this.sh = this._physPool(SHELLS);
  }

  _buildShards() {
    const geom = new THREE.TetrahedronGeometry(0.22, 0);
    geom.computeVertexNormals();
    this.shardMesh = this._makeSolid(geom, SHARDS, 3);
    this.sd = this._physPool(SHARDS);
  }

  _physPool(n) {
    const P = { head: 0, n };
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 't', 'life', 'qx', 'qy', 'qz', 'qw', 'rx', 'ry', 'rz', 'spin', 'r', 'g', 'b', 'scale']) {
      P[k] = new Float32Array(n);
    }
    return P;
  }

  _emitPhys(P, x, y, z, vx, vy, vz, life, rgb, scale) {
    const i = P.head;
    P.head = (i + 1) % P.n;
    P.x[i] = x; P.y[i] = y; P.z[i] = z;
    P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    P.t[i] = life; P.life[i] = life;
    const q = Math.sqrt(1 / 3);
    P.qx[i] = q; P.qy[i] = 0; P.qz[i] = q; P.qw[i] = q;
    const a = rand(0, Math.PI * 2), b = rand(0, Math.PI);
    P.rx[i] = Math.sin(b) * Math.cos(a); P.ry[i] = Math.cos(b); P.rz[i] = Math.sin(b) * Math.sin(a);
    P.spin[i] = rand(8, 22);
    P.r[i] = rgb[0]; P.g[i] = rgb[1]; P.b[i] = rgb[2];
    P.scale[i] = scale;
  }

  shell(x, y, z, dirX, dirZ) {
    this._emitPhys(this.sh, x, y, z, dirX * rand(2.2, 4.2), rand(2.5, 4.5), dirZ * rand(2.2, 4.2), 0.9, BRASS, rand(1, 1.3));
  }

  shard(x, y, z, vx, vy, vz, rgb) {
    this._emitPhys(this.sd, x, y, z, vx, vy, vz, rand(0.7, 1.2), rgb, rand(0.7, 1.5));
  }

  /* ---------- Muzzle flash ---------- */
  _buildFlashes() {
    // Flat spiked star drawn lying along the barrel axis; +X is forward.
    const pos = [], rim = [];
    const spikes = 7;
    for (let i = 0; i < spikes; i++) {
      const a0 = -Math.PI * 0.5 + (i / spikes) * Math.PI;
      const a1 = -Math.PI * 0.5 + ((i + 1) / spikes) * Math.PI;
      const mid = (a0 + a1) / 2;
      const long = i === 3 ? 1.5 : (i % 2 ? 0.95 : 0.7);
      pos.push(0, 0, 0, Math.cos(a0) * 0.28, 0, Math.sin(a0) * 0.28, Math.cos(mid) * long, 0, Math.sin(mid) * long);
      pos.push(0, 0, 0, Math.cos(mid) * long, 0, Math.sin(mid) * long, Math.cos(a1) * 0.28, 0, Math.sin(a1) * 0.28);
      rim.push(1, 0.25, 0, 1, 0, 0.25);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aRim', new THREE.Float32BufferAttribute(rim, 1));
    g.setAttribute('aC', dyn(4, FLASHES));
    this.flashMat = new THREE.ShaderMaterial({
      ...PREMULT, side: THREE.DoubleSide,
      vertexShader: `
        attribute vec4 aC; attribute float aRim; varying vec4 vC; varying float vRim;
        void main(){ vC = aC; vRim = aRim; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec4 vC; varying float vRim;
        void main(){ vec3 c = mix(vC.rgb, vec3(1.0), vRim * vRim); gl_FragColor = vec4(c * vC.a * (0.4 + vRim * 1.2), 0.0); }`,
    });
    this.flashMesh = new THREE.InstancedMesh(g, this.flashMat, FLASHES);
    this.flashMesh.frustumCulled = false;
    this.flashMesh.count = 0;
    this.flashMesh.renderOrder = 7;
    this.flashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.flashMesh);
    this.fl = this._physPool(FLASHES);
  }

  muzzleFlash(x, y, z, aim, rgb, size) {
    const P = this.fl, i = P.head;
    P.head = (i + 1) % FLASHES;
    P.x[i] = x; P.y[i] = y; P.z[i] = z;
    P.t[i] = 0.05; P.life[i] = 0.05;
    P.r[i] = rgb[0]; P.g[i] = rgb[1]; P.b[i] = rgb[2];
    P.scale[i] = size;
    P.qx[i] = aim;                 // Stored as yaw; flashes need no full orientation.
    P.spin[i] = rand(-0.6, 0.6);
    this.spawn(x, y, z, 0, 0, 0, 0.06, size * 0.9, size * 0.5, rgb, 0, 0, 0);
  }

  /* ---------- Fireballs ---------- */
  _buildBalls() {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.computeVertexNormals();
    g.setAttribute('aC', dyn(4, BALLS));
    this.ballMat = new THREE.ShaderMaterial({
      ...PREMULT,
      vertexShader: `
        attribute vec4 aC; varying vec4 vC; varying float vN;
        void main(){
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vC = aC; vN = max(dot(n, normalize(cameraPosition - w.xyz)), 0.0);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        varying vec4 vC; varying float vN;
        void main(){
          // Hot core, red rim; flat normals make each facet a distinct step of the gradient.
          vec3 c = mix(vec3(0.7, 0.14, 0.04), mix(vC.rgb, vec3(1.0, 0.95, 0.75), vN * vN), smoothstep(0.1, 0.7, vN));
          gl_FragColor = vec4(c * vC.a, 0.0);
        }`,
    });
    this.ballMesh = new THREE.InstancedMesh(g, this.ballMat, BALLS);
    this.ballMesh.frustumCulled = false;
    this.ballMesh.count = 0;
    this.ballMesh.renderOrder = 6;
    this.ballMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.ballMesh);
    this.bl = this._physPool(BALLS);
  }

  fireball(x, y, z, radius) {
    const P = this.bl, i = P.head;
    P.head = (i + 1) % BALLS;
    P.x[i] = x; P.y[i] = y; P.z[i] = z;
    P.t[i] = 0.38; P.life[i] = 0.38;
    P.scale[i] = radius;
    P.r[i] = 1; P.g[i] = 0.72; P.b[i] = 0.28;
  }

  /* ---------- Ground rings and scorch marks ---------- */
  _buildRings() {
    const sides = 14, pos = [], rad = [], off = [];
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const q = (ang, r, cross) => { pos.push(Math.cos(ang), 0, Math.sin(ang)); rad.push(r); off.push(cross); };
      q(a0, 0, 0); q(a1, 1, 1); q(a0, 1, 1);
      q(a0, 0, 0); q(a1, 0, 0); q(a1, 1, 1);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aR', new THREE.Float32BufferAttribute(rad, 1));
    g.instanceCount = 0;
    g.setAttribute('aP', this.rP = dyn(4, RINGS));     // x, z, rInner, rOuter
    g.setAttribute('aC', this.rC = dyn(4, RINGS));     // premultiplied rgba
    this.ringGeom = g;
    this.ringMat = new THREE.ShaderMaterial({
      ...PREMULT,
      vertexShader: `
        attribute float aR; attribute vec4 aP; attribute vec4 aC;
        varying vec4 vC; varying float vR;
        void main(){
          float r = mix(aP.z, aP.w, aR);
          vec3 p = vec3(aP.x + position.x * r, 0.17, aP.y + position.z * r);
          vC = aC; vR = aR;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec4 vC; varying float vR;
        void main(){ gl_FragColor = vC * smoothstep(0.0, 0.25, vR) * smoothstep(1.0, 0.75, vR); }`,
    });
    this.ringMesh = new THREE.Mesh(g, this.ringMat);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = 4;
    this.scene.add(this.ringMesh);
    const R = this.rg = { head: 0 };
    for (const k of ['x', 'z', 'r0', 'r1', 't', 'life', 'cr', 'cg', 'cb', 'a', 'solid']) R[k] = new Float32Array(RINGS);
  }

  ring(x, z, r0, r1, life, rgb, a) {
    const R = this.rg, i = R.head;
    R.head = (i + 1) % RINGS;
    R.x[i] = x; R.z[i] = z; R.r0[i] = r0; R.r1[i] = r1;
    R.t[i] = life; R.life[i] = life;
    R.cr[i] = rgb[0]; R.cg[i] = rgb[1]; R.cb[i] = rgb[2]; R.a[i] = a; R.solid[i] = 0;
  }

  scorch(x, z, r) {
    const R = this.rg, i = R.head;
    R.head = (i + 1) % RINGS;
    R.x[i] = x; R.z[i] = z; R.r0[i] = 0; R.r1[i] = r;
    R.t[i] = 9; R.life[i] = 9;
    R.cr[i] = 0.05; R.cg[i] = 0.04; R.cb[i] = 0.05; R.a[i] = 0.65; R.solid[i] = 1;
  }

  /* ---------- Light pops, evaluated in the world shader ---------- */
  _buildPops() {
    this.pops = [];
    for (let i = 0; i < MAX_POPS; i++) this.pops.push({ x: 0, y: -100, z: 0, r: 1, t: 0, life: 1, c: [0, 0, 0] });
    this.popHead = 0;
  }

  pop(x, y, z, radius, rgb, life) {
    const p = this.pops[this.popHead];
    this.popHead = (this.popHead + 1) % MAX_POPS;
    p.x = x; p.y = y; p.z = z; p.r = radius; p.t = life; p.life = life;
    p.c = rgb;
  }

  applyPops(material) {
    const posU = material.uniforms.uPopPos.value, colU = material.uniforms.uPopCol.value;
    for (let i = 0; i < MAX_POPS; i++) {
      const p = this.pops[i];
      const k = p.t > 0 ? p.t / p.life : 0;
      posU[i].set(p.x, p.y, p.z, p.r);
      colU[i].set(p.c[0] * k, p.c[1] * k, p.c[2] * k);
    }
  }

  /* ---------- Per-frame simulation and buffer upload ---------- */
  step(dt) {
    this._stepTracers(dt);
    this._stepParticles(dt);
    this._stepPhys(this.sh, this.shellMesh, dt, true);
    this._stepPhys(this.sd, this.shardMesh, dt, false);
    this._stepFlashes(dt);
    this._stepBalls(dt);
    this._stepRings(dt);
    for (let i = 0; i < MAX_POPS; i++) { const p = this.pops[i]; if (p.t > 0) p.t -= dt; }
  }

  _stepTracers(dt) {
    const T = this.tr;
    let n = 0;
    for (let i = 0; i < TRACERS; i++) {
      if (T.t[i] <= 0) continue;
      T.t[i] -= dt;
      const dur = T.dur[i], age = dur - T.t[i];
      const travel = dur - 0.075;
      const headT = Math.min(1, age / travel);
      const tailLen = 11 / Math.max(T.len[i], 0.01);
      const tailT = Math.max(0, headT - tailLen * Math.min(1, age * 18));
      const fade = headT < 1 ? 1 : Math.max(0, T.t[i] / 0.075);
      this.tA.setXYZ(n, T.ax[i] + (T.bx[i] - T.ax[i]) * tailT, T.ay[i] + (T.by[i] - T.ay[i]) * tailT, T.az[i] + (T.bz[i] - T.az[i]) * tailT);
      this.tB.setXYZ(n, T.ax[i] + (T.bx[i] - T.ax[i]) * headT, T.ay[i] + (T.by[i] - T.ay[i]) * headT, T.az[i] + (T.bz[i] - T.az[i]) * headT);
      this.tC.setXYZW(n, T.r[i] * fade, T.g[i] * fade, T.b[i] * fade, T.w[i]);
      n++;
    }
    this.tracerN = n;
  }

  // The ADS laser rides in the tracer batch so it costs no extra draw call.
  addBeam(ax, ay, az, bx, by, bz, rgb, width) {
    const n = this.tracerN;
    if (n >= TRACERS) return;
    this.tA.setXYZ(n, ax, ay, az);
    this.tB.setXYZ(n, bx, by, bz);
    this.tC.setXYZW(n, rgb[0], rgb[1], rgb[2], width);
    this.tracerN = n + 1;
  }

  flushTracers() {
    this.tracerGeom.instanceCount = this.tracerN;
    this.tA.needsUpdate = true; this.tB.needsUpdate = true; this.tC.needsUpdate = true;
  }

  // Appends a one-frame glow directly to the buffer, after step() has packed the live particles.
  addDot(x, y, z, size, rgb) {
    const n = this.partGeom.instanceCount;
    if (n >= PARTS) return;
    this.pP.setXYZW(n, x, y, z, size);
    this.pC.setXYZW(n, rgb[0], rgb[1], rgb[2], 0);
    this.pA.setXYZ(n, 0, 0, 0);
    this.partGeom.instanceCount = n + 1;
  }

  _stepParticles(dt) {
    const P = this.pp;
    let n = 0;
    for (let i = 0; i < PARTS; i++) {
      if (P.t[i] <= 0) continue;
      P.t[i] -= dt;
      const k = 1 / (1 + P.drag[i] * dt);
      P.vx[i] *= k; P.vy[i] = (P.vy[i] - P.grav[i] * dt) * k; P.vz[i] *= k;
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
      if (P.y[i] < 0.05) { P.y[i] = 0.05; P.vy[i] *= -0.3; }
      const lifeK = Math.max(0, P.t[i] / P.life[i]);
      const size = P.s1[i] + (P.s0[i] - P.s1[i]) * lifeK;
      const fade = lifeK * (2 - lifeK);    // Hold, then fall away.
      this.pP.setXYZW(n, P.x[i], P.y[i], P.z[i], size);
      this.pC.setXYZW(n, P.r[i] * fade, P.g[i] * fade, P.b[i] * fade, P.a[i] * fade);
      if (P.stretch[i] > 0) {
        this.pA.setXYZ(n, P.vx[i] * P.stretch[i], P.vy[i] * P.stretch[i], P.vz[i] * P.stretch[i]);
      } else {
        this.pA.setXYZ(n, 0, 0, 0);
      }
      n++;
    }
    this.partGeom.instanceCount = n;
    this.pP.needsUpdate = true; this.pC.needsUpdate = true; this.pA.needsUpdate = true;
  }

  _stepPhys(P, mesh, dt, isShell) {
    let n = 0;
    const e = mesh.instanceMatrix.array;
    const aC = mesh.geometry.attributes.aC;
    for (let i = 0; i < P.n; i++) {
      if (P.t[i] <= 0) continue;
      P.t[i] -= dt;
      P.vy[i] -= 22 * dt;
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
      if (P.y[i] < 0.06) {
        P.y[i] = 0.06; P.vy[i] *= -0.35;
        P.vx[i] *= 0.55; P.vz[i] *= 0.55;
        P.spin[i] *= 0.5;
      }
      // Integrate rotation around a fixed axis; cheap and looks identical to full angular velocity here.
      const ang = P.spin[i] * dt * 0.5;
      const s = Math.sin(ang), c = Math.cos(ang);
      const ax = P.rx[i] * s, ay = P.ry[i] * s, az = P.rz[i] * s, aw = c;
      const qx = P.qx[i], qy = P.qy[i], qz = P.qz[i], qw = P.qw[i];
      const nx = aw * qx + ax * qw + ay * qz - az * qy;
      const ny = aw * qy - ax * qz + ay * qw + az * qx;
      const nz = aw * qz + ax * qy - ay * qx + az * qw;
      const nw = aw * qw - ax * qx - ay * qy - az * qz;
      const l = 1 / Math.hypot(nx, ny, nz, nw);
      P.qx[i] = nx * l; P.qy[i] = ny * l; P.qz[i] = nz * l; P.qw[i] = nw * l;
      const k = P.t[i] / P.life[i];
      const sc = P.scale[i] * (isShell ? 1 : Math.min(1, k * 3));
      // Column-major rotation+scale from the quaternion, written straight to the buffer.
      const x = P.qx[i], y = P.qy[i], z = P.qz[i], w = P.qw[i];
      const j = n * 16;
      e[j] = (1 - 2 * (y * y + z * z)) * sc;
      e[j + 1] = 2 * (x * y + z * w) * sc;
      e[j + 2] = 2 * (x * z - y * w) * sc;
      e[j + 3] = 0;
      e[j + 4] = 2 * (x * y - z * w) * sc;
      e[j + 5] = (1 - 2 * (x * x + z * z)) * sc;
      e[j + 6] = 2 * (y * z + x * w) * sc;
      e[j + 7] = 0;
      e[j + 8] = 2 * (x * z + y * w) * sc;
      e[j + 9] = 2 * (y * z - x * w) * sc;
      e[j + 10] = (1 - 2 * (x * x + y * y)) * sc;
      e[j + 11] = 0;
      e[j + 12] = P.x[i]; e[j + 13] = P.y[i]; e[j + 14] = P.z[i]; e[j + 15] = 1;
      aC.setXYZW(n, P.r[i], P.g[i], P.b[i], 1);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aC.needsUpdate = true;
  }

  _stepFlashes(dt) {
    const P = this.fl;
    const mesh = this.flashMesh, e = mesh.instanceMatrix.array;
    const aC = mesh.geometry.attributes.aC;
    let n = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.t[i] <= 0) continue;
      P.t[i] -= dt;
      const k = Math.max(0, P.t[i] / P.life[i]);
      const sc = P.scale[i] * (0.85 + 0.15 * k);
      const a = P.qx[i], ca = Math.cos(a), sa = Math.sin(a);
      // Yaw only: flash lies on a horizontal plane along the barrel, which is the view the camera has.
      const j = n * 16;
      e[j] = ca * sc;  e[j + 1] = 0; e[j + 2] = sa * sc;  e[j + 3] = 0;
      e[j + 4] = 0;    e[j + 5] = sc; e[j + 6] = 0;       e[j + 7] = 0;
      e[j + 8] = -sa * sc; e[j + 9] = 0; e[j + 10] = ca * sc; e[j + 11] = 0;
      e[j + 12] = P.x[i]; e[j + 13] = P.y[i]; e[j + 14] = P.z[i]; e[j + 15] = 1;
      aC.setXYZW(n, P.r[i], P.g[i], P.b[i], 0.6 + k * 0.8);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aC.needsUpdate = true;
  }

  _stepBalls(dt) {
    const P = this.bl;
    const mesh = this.ballMesh, e = mesh.instanceMatrix.array;
    const aC = mesh.geometry.attributes.aC;
    let n = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.t[i] <= 0) continue;
      P.t[i] -= dt;
      const age = 1 - Math.max(0, P.t[i] / P.life[i]);
      const sc = P.scale[i] * (0.32 + 0.5 * (1 - Math.pow(1 - age, 2.5)));
      const j = n * 16;
      e[j] = sc; e[j + 1] = 0; e[j + 2] = 0; e[j + 3] = 0;
      e[j + 4] = 0; e[j + 5] = sc; e[j + 6] = 0; e[j + 7] = 0;
      e[j + 8] = 0; e[j + 9] = 0; e[j + 10] = sc; e[j + 11] = 0;
      e[j + 12] = P.x[i]; e[j + 13] = P.y[i]; e[j + 14] = P.z[i]; e[j + 15] = 1;
      const a = Math.max(0, 1 - age * 1.05);
      aC.setXYZW(n, 1.0, 0.65 - age * 0.35, 0.22 - age * 0.18, a);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aC.needsUpdate = true;
  }

  _stepRings(dt) {
    const R = this.rg;
    let n = 0;
    for (let i = 0; i < RINGS; i++) {
      if (R.t[i] <= 0) continue;
      R.t[i] -= dt;
      const k = Math.max(0, R.t[i] / R.life[i]);
      if (R.solid[i]) {
        this.rP.setXYZW(n, R.x[i], R.z[i], R.r0[i], R.r1[i]);
        this.rC.setXYZW(n, R.cr[i] * k, R.cg[i] * k, R.cb[i] * k, R.a[i] * Math.min(1, k * 3));
      } else {
        const age = 1 - k;
        const eased = 1 - (1 - age) * (1 - age);
        const r1 = R.r0[i] + (R.r1[i] - R.r0[i]) * eased;
        const inner = r1 * (0.55 + 0.35 * eased);
        this.rP.setXYZW(n, R.x[i], R.z[i], inner, r1);
        const a = R.a[i] * k;
        this.rC.setXYZW(n, R.cr[i] * a, R.cg[i] * a, R.cb[i] * a, 0);
      }
      n++;
    }
    this.ringGeom.instanceCount = n;
    this.rP.needsUpdate = true; this.rC.needsUpdate = true;
  }

  dispose() {
    for (const g of [this.tracerGeom, this.partGeom, this.ringGeom, this.shellMesh.geometry, this.shardMesh.geometry, this.flashMesh.geometry, this.ballMesh.geometry]) g.dispose();
    for (const m of [this.tracerMat, this.partMat, this.solidMat, this.flashMat, this.ballMat, this.ringMat]) m.dispose();
  }
}

const WARM_SPARK = [1.0, 0.72, 0.3];
const GRENADE_SHARD = [0.82, 0.68, 0.5];
const FLASH_TINT = [0.82, 0.92, 1.0];
const FLASH_POP = [0.9, 0.96, 1.05];
const HEAD_GOLD = [1.0, 0.82, 0.22];
const HEAL = [0.3, 1.0, 0.56];
const STEAM = [0.72, 0.74, 0.78];
const WHITE = [1, 1, 1];
const DUST = [0.42, 0.38, 0.36];
const SMOKE = [0.12, 0.11, 0.14];
const FIRE = [1.0, 0.5, 0.15];
const FIRE_POP = [0.95, 0.5, 0.22];
const BRASS = [0.92, 0.7, 0.28];

