// Destructible dressing: small crates, barrels, signs, cones and jars placed against the map's cover.
// Purely cosmetic and local to each phone. They break under gunfire, blasts and anyone running through them,
// and grow back out of sight later. One instanced draw per prop type the map uses.
import * as THREE from 'three';
import { MeshBuilder } from './meshbuild.js';
import { GLSL_LIGHT } from './art.js';

const MAX_PROPS = 40;
const CRATE = 0, BARREL = 1, SIGN = 2, CONE = 3, JAR = 4;
const HP = [2, 3, 1, 1, 1];
const RADIUS = [0.55, 0.45, 0.35, 0.32, 0.36];
const REGROW = 35;               // Seconds a broken prop stays gone, at least.

// Which props suit which map, and how often (repeat an entry to weight it).
const SETS = {
  railyard: [CRATE, CRATE, BARREL, BARREL, CONE],
  harbor: [CRATE, BARREL, BARREL, CONE],
  neon: [SIGN, SIGN, CRATE, BARREL, SIGN],
  dust: [JAR, JAR, BARREL, CRATE, SIGN],
  range: [CRATE, BARREL, CONE],
};
const COVER_KINDS = new Set(['container', 'crate', 'barrier', 'wall', 'building', 'shop', 'stall', 'adobe', 'rock', 'sandbag', 'tent', 'hull']);

const VERT = /* glsl */`
attribute vec3 aCol; attribute float aPart; attribute vec2 aFx; attribute vec3 aGlow;
uniform vec4 uFogXf;
varying vec3 vC; varying vec2 vFogUv;
${GLSL_LIGHT}
void main() {
  mat4 w = modelMatrix * instanceMatrix;
  vec3 n = normalize(mat3(w) * normal);
  vec3 c = aPart > 0.5 ? aGlow * (0.75 + aFx.x * 0.8) : aCol * duskLight(n) * (1.0 + aFx.y * 1.4);
  vC = c + aFx.y * 0.5;
  vec4 wp = w * vec4(position, 1.0);
  vFogUv = (wp.xz + n.xz * 0.45) * uFogXf.xy + uFogXf.zw;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
uniform sampler2D uFogTex; uniform float uFogOn;
varying vec3 vC; varying vec2 vFogUv;
void main() {
  float v = mix(1.0, texture2D(uFogTex, vFogUv).r, uFogOn);
  float vis = smoothstep(0.1, 0.9, v);
  gl_FragColor = vec4(vC * (0.34 + 0.66 * vis), 1.0);
}`;

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

const BUILD = {
  [CRATE](b, ink) {
    b.setPart(0).setColor(ink.crate || 0x9a7a4c).box(0, 0.36, 0, 0.72, 0.72, 0.72, 0.03);
    b.setColor(ink.crateD || 0x5c4a30);
    b.box(0, 0.36, 0.365, 0.76, 0.12, 0.02); b.box(0, 0.36, -0.365, 0.76, 0.12, 0.02);
    b.box(0.365, 0.36, 0, 0.02, 0.12, 0.76); b.box(-0.365, 0.36, 0, 0.02, 0.12, 0.76);
    b.box(0, 0.73, 0, 0.12, 0.02, 0.76); b.box(0, 0.73, 0, 0.76, 0.02, 0.12);
  },
  [BARREL](b, ink) {
    b.setPart(0).setColor(0x7a3d2a).prismY(0, 0.92, 0, 0, 0.3, 0.3, 8, Math.PI / 8);
    b.setColor(ink.hazardY || 0x9c7a2c).prismY(0.56, 0.72, 0, 0, 0.314, 0.314, 8, Math.PI / 8);
    b.setColor(0x34302c).prismY(0.92, 0.95, 0, 0, 0.3, 0.26, 8, Math.PI / 8);
    b.setColor(0x4a4540).prismY(0.94, 0.97, 0.12, 0.05, 0.06, 0.06, 6);
  },
  [SIGN](b) {
    b.setPart(0).setColor(0x24262c).box(-0.3, 0.4, 0, 0.06, 0.8, 0.06); b.box(0.3, 0.4, 0, 0.06, 0.8, 0.06);
    b.box(0, 0.86, 0, 0.84, 0.46, 0.06, 0.01);
    b.setPart(1).box(0, 0.86, 0.035, 0.74, 0.36, 0.01);
    b.box(0, 0.86, -0.035, 0.74, 0.36, 0.01);
    b.setPart(0).setColor(0x34302c).box(0, 1.1, 0, 0.5, 0.05, 0.05);
  },
  [CONE](b) {
    b.setPart(0).setColor(0x202226).prismY(0, 0.05, 0, 0, 0.34, 0.32, 8, Math.PI / 8);
    b.setColor(0xd96a22).prismY(0.05, 0.72, 0, 0, 0.24, 0.05, 8, Math.PI / 8);
    b.setColor(0xe8e2d0).prismY(0.3, 0.46, 0, 0, 0.17, 0.12, 8, Math.PI / 8);
  },
  [JAR](b) {
    b.setPart(0).setColor(0xa5653f).prismY(0, 0.28, 0, 0, 0.2, 0.34, 8, Math.PI / 8);
    b.prismY(0.28, 0.56, 0, 0, 0.34, 0.16, 8, Math.PI / 8);
    b.setColor(0x7f4b2f).prismY(0.56, 0.68, 0, 0, 0.14, 0.18, 8, Math.PI / 8);
  },
};

function propGeometry(kind, ink) {
  const b = new MeshBuilder();
  BUILD[kind](b, ink);
  return b.build();
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const WOOD = [0.72, 0.56, 0.32], WOOD_D = [0.42, 0.32, 0.18];
const STEEL = [0.45, 0.25, 0.18], ORANGE = [0.85, 0.42, 0.14], CLAY = [0.65, 0.4, 0.25], SPARK = [1, 0.8, 0.4], FIRE = [1, 0.55, 0.16];
const SMOKE = [0.14, 0.13, 0.15], WHITE = [1, 1, 1];
const rand = (a, b) => a + Math.random() * (b - a);

export class Props {
  constructor(scene, map, theme, fogUniforms, vfx) {
    this.scene = scene;
    this.vfx = vfx;
    this.neon = theme.signs || null;
    const list = SETS[theme.id] || SETS.railyard;
    const spots = placeSpots(map, MAX_PROPS);
    const rnd = mulberry(hashStr(map.id || theme.id) ^ 0x51a5);
    this.count = spots.length;
    const n = this.count;
    this.x = new Float32Array(n); this.z = new Float32Array(n); this.rot = new Float32Array(n); this.scale = new Float32Array(n);
    this.kind = new Uint8Array(n); this.hp = new Int8Array(n);
    this.shake = new Float32Array(n);   // 1 right after a non-fatal hit, decays to 0.
    this.dead = new Float32Array(n);    // Seconds until a broken prop may return; 0 = standing.
    this.pop = new Float32Array(n).fill(1);    // Scale-in when regrown.
    this.signRGB = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.x[i] = spots[i].x; this.z[i] = spots[i].z;
      this.kind[i] = list[Math.floor(rnd() * list.length)];
      this.rot[i] = this.kind[i] === SIGN ? spots[i].face : rnd() * Math.PI * 2;
      this.scale[i] = 0.9 + rnd() * 0.3;
      this.hp[i] = HP[this.kind[i]];
      const c = this.neon ? this.neon[Math.floor(rnd() * this.neon.length)] : [1.0, 0.72, 0.28];
      this.signRGB[i * 3] = c[0]; this.signRGB[i * 3 + 1] = c[1]; this.signRGB[i * 3 + 2] = c[2];
    }

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uFogTex: fogUniforms.tex, uFogXf: fogUniforms.xf, uFogOn: fogUniforms.on },
    });
    // One mesh per kind in use: merging variants would cost every instance the triangles of all five.
    this.meshes = [];
    for (let k = 0; k < 5; k++) {
      if (!this.kind.includes(k)) continue;
      const geom = propGeometry(k, theme.ink);
      const cap = this.kind.reduce((c, v) => c + (v === k ? 1 : 0), 0);
      geom.setAttribute('aFx', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage));
      geom.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const mesh = new THREE.InstancedMesh(geom, this.material, cap);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.kind = k;
      scene.add(mesh);
      this.meshes[k] = mesh;
    }
    this.dirty = true;
    this.clock = 0;
  }

  // Bullet path as a ground segment. Each ray breaks at most one prop, the first along it.
  hitRay(ax, az, bx, bz) {
    if (!this.count) return;
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    if (len2 < 1e-4) return;
    let best = -1, bestT = 2;
    for (let i = 0; i < this.count; i++) {
      if (this.dead[i] > 0) continue;
      const t = Math.max(0, Math.min(1, ((this.x[i] - ax) * dx + (this.z[i] - az) * dz) / len2));
      const ex = ax + dx * t - this.x[i], ez = az + dz * t - this.z[i];
      const r = RADIUS[this.kind[i]];
      if (ex * ex + ez * ez < r * r && t < bestT) { best = i; bestT = t; }
    }
    if (best >= 0) this.damage(best, ax + dx * bestT, az + dz * bestT);
  }

  damage(i, hx, hz) {
    if (this.dead[i] > 0) return;
    this.hp[i]--;
    if (this.hp[i] <= 0) { this.break(i); return; }
    this.shake[i] = 1;
    this.dirty = true;
    const vfx = this.vfx;
    if (this.kind[i] === CRATE) for (let k = vfx._n(4); k > 0; k--) vfx.shard(hx, rand(0.3, 0.8), hz, rand(-3, 3), rand(1.5, 4), rand(-3, 3), WOOD, 0.5);
    else if (this.kind[i] === BARREL) vfx.sparks(hx, rand(0.3, 0.8), hz, hx - this.x[i], hz - this.z[i], SPARK, vfx._n(6), 10);
  }

  // Anything inside the radius is destroyed outright.
  blast(x, z, radius) {
    for (let i = 0; i < this.count; i++) {
      if (this.dead[i] > 0) continue;
      const dx = this.x[i] - x, dz = this.z[i] - z;
      if (dx * dx + dz * dz < radius * radius) this.break(i);
    }
  }

  break(i, quiet = false) {
    this.dead[i] = REGROW + rand(0, 20);
    this.shake[i] = 0;
    this.dirty = true;
    const vfx = this.vfx, x = this.x[i], z = this.z[i], k = this.kind[i];
    const n = v => vfx._n(v);
    if (k === CRATE) {
      for (let c = n(16); c > 0; c--) {
        const a = rand(0, Math.PI * 2), s = rand(2, 8);
        vfx.shard(x + rand(-0.3, 0.3), rand(0.2, 0.8), z + rand(-0.3, 0.3), Math.cos(a) * s, rand(2.5, 7), Math.sin(a) * s, c % 3 ? WOOD : WOOD_D, rand(0.6, 1.3));
      }
      for (let c = n(5); c > 0; c--) vfx.spawn(x + rand(-0.3, 0.3), 0.4, z + rand(-0.3, 0.3), rand(-1.2, 1.2), rand(0.4, 1.4), rand(-1.2, 1.2), rand(0.4, 0.7), 0.26, 0.8, vfx.dustRGB, 0.6, -0.5, 2.4);
    } else if (k === BARREL) {
      for (let c = n(12); c > 0; c--) {
        const a = rand(0, Math.PI * 2), s = rand(2, 9);
        vfx.shard(x, rand(0.2, 0.9), z, Math.cos(a) * s, rand(3, 9), Math.sin(a) * s, STEEL, rand(0.6, 1.2));
      }
      if (!quiet) {
        vfx.fireball(x, 0.7, z, 1.15, 0.3);
        for (let c = n(14); c > 0; c--) {
          const a = rand(0, Math.PI * 2), s = rand(3, 11);
          vfx.spawn(x, 0.6, z, Math.cos(a) * s, rand(2, 9), Math.sin(a) * s, rand(0.3, 0.6), 0.14, 0.03, FIRE, 0, 14, 1.4, 0.03);
        }
        for (let c = n(6); c > 0; c--) vfx.spawn(x + rand(-0.2, 0.2), 0.9, z + rand(-0.2, 0.2), rand(-0.6, 0.6), rand(1.2, 3), rand(-0.6, 0.6), rand(0.8, 1.5), 0.25, 1.0, SMOKE, 0.8, -0.8, 1.2);
        vfx.ring(x, z, 0.2, 2.2, 0.3, FIRE, 0.8);
        vfx.scorch(x, z, 0.8);
        vfx.pop(x, 1.2, z, 6, FIRE, 0.22);
      }
    } else if (k === SIGN) {
      const i3 = i * 3;
      const c = [this.signRGB[i3], this.signRGB[i3 + 1], this.signRGB[i3 + 2]];
      for (let t = n(18); t > 0; t--) {
        const a = rand(0, Math.PI * 2), s = rand(2, 9);
        vfx.spawn(x, rand(0.7, 1.05), z, Math.cos(a) * s, rand(1, 7), Math.sin(a) * s, rand(0.25, 0.6), 0.08, 0.015, t % 3 ? SPARK : c, 0, 16, 1.2, 0.03);
      }
      for (let t = n(6); t > 0; t--) vfx.shard(x, 0.85, z, rand(-4, 4), rand(2, 5), rand(-4, 4), c, 0.55);
      vfx.spawn(x, 0.9, z, 0, 0, 0, 0.12, 0.4, 1.4, WHITE, 0, 0, 0);
      vfx.pop(x, 1, z, 3.5, c, 0.14);
    } else if (k === CONE) {
      for (let c = n(5); c > 0; c--) vfx.shard(x, 0.3, z, rand(-5, 5), rand(4, 8), rand(-5, 5), ORANGE, rand(0.9, 1.5));
      vfx.groundThud(x, z);
    } else {
      for (let c = n(12); c > 0; c--) {
        const a = rand(0, Math.PI * 2), s = rand(2, 6);
        vfx.shard(x, rand(0.2, 0.6), z, Math.cos(a) * s, rand(2, 6), Math.sin(a) * s, CLAY, rand(0.5, 1));
      }
      for (let c = n(4); c > 0; c--) vfx.spawn(x, 0.3, z, rand(-1, 1), rand(0.4, 1.1), rand(-1, 1), rand(0.4, 0.6), 0.2, 0.7, vfx.dustRGB, 0.6, -0.3, 2.4);
    }
  }

  // Bumps from living players, regrowth, shakes, and the instance buffer when something changed.
  update(dt, players, focusX, focusZ, contact) {
    this.clock += dt;
    if (contact) {
      for (let p = 0; p < players.length; p++) {
        const q = players[p];
        if (!q.alive) continue;
        for (let i = 0; i < this.count; i++) {
          if (this.dead[i] > 0) continue;
          const dx = this.x[i] - q.x, dz = this.z[i] - q.z, r = RADIUS[this.kind[i]] + 0.34;
          if (dx * dx + dz * dz < r * r) this.break(i, true);
        }
      }
    }
    let animated = false;
    for (let i = 0; i < this.count; i++) {
      if (this.dead[i] > 0) {
        this.dead[i] -= dt;
        if (this.dead[i] <= 0) {
          // Only come back off-camera; a crate appearing in view would look broken.
          if (Math.abs(this.x[i] - focusX) > 20 || Math.abs(this.z[i] - focusZ) > 14) {
            this.dead[i] = 0; this.hp[i] = HP[this.kind[i]]; this.pop[i] = 0; this.dirty = true;
          } else this.dead[i] = 2;
        }
      } else {
        if (this.shake[i] > 0) { this.shake[i] = Math.max(0, this.shake[i] - dt * 5); animated = true; }
        if (this.pop[i] < 1) { this.pop[i] = Math.min(1, this.pop[i] + dt * 3); animated = true; }
      }
    }
    // Neon signs hum and stutter, so the buffer needs refreshing for as long as a sign is on the map.
    if (this.neon) animated = true;
    if (!this.dirty && !animated) return;
    this.dirty = animated;
    this.#write();
  }

  #write() {
    for (let m = 0; m < 5; m++) if (this.meshes[m]) this.meshes[m].count = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.dead[i] > 0) continue;
      const k = this.kind[i], sh = this.shake[i], mesh = this.meshes[k];
      const n = mesh.count++;
      const wob = sh > 0 ? Math.sin(this.clock * 40) * sh * 0.16 : 0;
      _e.set(wob, this.rot[i], wob * 0.7);
      _q.setFromEuler(_e);
      const sc = this.scale[i] * this.pop[i];
      _p.set(this.x[i], 0, this.z[i]);
      _s.set(sc, sc, sc);
      _m.compose(_p, _q, _s).toArray(mesh.instanceMatrix.array, n * 16);
      let flick = 1;
      if (k === SIGN) {
        const t = this.clock * 3 + i * 7;
        flick = 0.5 + 0.5 * Math.sin(t * 7) * Math.sin(t * 1.3);
        if (Math.sin(t * 0.7 + i) > 0.92) flick *= 0.15;
      }
      const a = mesh.geometry.attributes;
      a.aFx.setXY(n, flick, sh * 0.6);
      a.aGlow.setXYZ(n, this.signRGB[i * 3], this.signRGB[i * 3 + 1], this.signRGB[i * 3 + 2]);
    }
    for (let m = 0; m < 5; m++) {
      const mesh = this.meshes[m];
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.attributes.aFx.needsUpdate = true;
      mesh.geometry.attributes.aGlow.needsUpdate = true;
    }
  }

  dispose() {
    for (let m = 0; m < 5; m++) {
      const mesh = this.meshes[m];
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
  }
}

// Deterministic per map: spots just off a piece of cover, clear of walls, spawns and objectives.
export function placeSpots(map, limit, margin = 0.85, kinds = COVER_KINDS) {
  const rnd = mulberry(hashStr(map.id || 'map') ^ 0x7e3f);
  const cover = map.walls.filter(w => kinds.has(w.kind));
  const blocked = (x, z, m) => map.walls.some(w => x > w.x - m && x < w.x + w.w + m && z > w.z - m && z < w.z + w.d + m);
  const spawns = map.spawns ? [...(map.spawns.a || map.spawns[0] || []), ...(map.spawns.b || map.spawns[1] || [])] : [];
  const pts = map.points ? [...(map.points.dom || []), ...(map.points.hard || [])] : [];
  const out = [];
  for (let tries = 0; tries < limit * 40 && out.length < limit && cover.length; tries++) {
    const w = cover[Math.floor(rnd() * cover.length)];
    const side = Math.floor(rnd() * 4);
    let x, z, face;
    if (side === 0) { x = w.x + rnd() * w.w; z = w.z - margin; face = 0; }
    else if (side === 1) { x = w.x + rnd() * w.w; z = w.z + w.d + margin; face = 0; }
    else if (side === 2) { x = w.x - margin; z = w.z + rnd() * w.d; face = Math.PI / 2; }
    else { x = w.x + w.w + margin; z = w.z + rnd() * w.d; face = Math.PI / 2; }
    if (x < 2 || z < 2 || x > map.width - 2 || z > map.height - 2) continue;
    if (blocked(x, z, 0.3)) continue;
    if (spawns.some(s => Math.hypot(s.x - x, s.z - z) < 4.5)) continue;
    if (pts.some(p => Math.hypot(p.x - x, p.z - z) < (p.r ?? 4) + 0.8)) continue;
    if (out.some(o => Math.hypot(o.x - x, o.z - z) < 2.6)) continue;
    out.push({ x, z, face });
  }
  return out;
}
