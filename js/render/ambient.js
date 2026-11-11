// The map being alive when nobody is shooting: birds, vents, a failing lamp or two, dust devils, and Harbor's lightning.
// Birds are one instanced draw animated in the vertex shader; the rest rides the existing particle and tracer batches.
import * as THREE from 'three';
import { placeSpots } from './props.js';

// Circling flock, and birds on the ground that flush when a shot lands near them.
const LIFE = {
  railyard: { flock: 9, ground: 10, col: [0.1, 0.1, 0.14], size: 0.42, flockY: 8.5, vents: 4 },
  harbor:   { flock: 13, ground: 10, col: [0.82, 0.86, 0.9], size: 0.46, flockY: 9.5, vents: 3 },
  neon:     { flock: 0, ground: 0, col: [0.1, 0.1, 0.14], size: 0.4, flockY: 8, vents: 6 },
  dust:     { flock: 5, ground: 5, col: [0.22, 0.17, 0.13], size: 0.62, flockY: 11, vents: 0, devils: 3 },
  frost:    { flock: 6, ground: 6, col: [0.07, 0.07, 0.09], size: 0.44, flockY: 9.5, vents: 3 },
  topside:  { flock: 11, ground: 9, col: [0.42, 0.44, 0.5], size: 0.4, flockY: 7, vents: 0 },
  sunken:   { flock: 8, ground: 0, col: [0.9, 0.93, 0.88], size: 0.66, flockY: 10, vents: 0 },
  metro:    { flock: 0, ground: 4, col: [0.12, 0.12, 0.15], size: 0.4, flockY: 8, vents: 6 },
  subway:   { flock: 0, ground: 0, col: [0, 0, 0], size: 0.4, flockY: 8, vents: 3 },
  desert:   { flock: 5, ground: 5, col: [0.22, 0.17, 0.13], size: 0.62, flockY: 11, vents: 0, devils: 3 },
};
const NONE = { flock: 0, ground: 0, col: [0, 0, 0], size: 0.5, flockY: 8, vents: 0 };

const VERT = /* glsl */`
attribute float aWing;
attribute vec4 aSeed;     // x, z (centre or perch), phase, radius
attribute vec2 aMode;     // 0 flock / 1 perched, then the clock time it was flushed (0 = still on the ground)
uniform float uTime, uSize, uFlockY;
uniform vec4 uFogXf;
varying float vShade; varying vec2 vFogUv;
void main() {
  float heading, flapRate = 12.0, folded = 0.0;
  vec3 c;
  float gone = 1.0;
  if (aMode.x < 0.5) {
    float a = uTime * (0.34 + 0.08 * fract(aSeed.z * 7.0)) * (mod(aSeed.w, 2.0) > 1.0 ? 1.0 : -1.0) + aSeed.z;
    c = vec3(aSeed.x + cos(a) * (6.0 + aSeed.w), uFlockY + sin(uTime * 0.7 + aSeed.z) * 1.1, aSeed.y + sin(a) * (5.0 + aSeed.w * 0.7));
    heading = a + (mod(aSeed.w, 2.0) > 1.0 ? 1.5708 : -1.5708);
    flapRate = 7.0 + 3.0 * sin(uTime * 0.4 + aSeed.z);
  } else if (aMode.y <= 0.0) {
    // Pecking about: small hops, wings folded.
    float hop = max(0.0, sin(uTime * 2.7 + aSeed.z * 9.0) - 0.75) * 0.6;
    c = vec3(aSeed.x, 0.08 + hop, aSeed.y);
    heading = aSeed.z + sin(uTime * 0.5 + aSeed.z) * 0.8;
    folded = 1.0;
  } else {
    float t = uTime - aMode.y;
    float ang = aSeed.z;
    c = vec3(aSeed.x + cos(ang) * (t * 7.0 + t * t * 2.0), 0.1 + t * 5.5 + t * t * 1.5, aSeed.y + sin(ang) * (t * 7.0 + t * t * 2.0));
    heading = ang;
    flapRate = 20.0;
    gone = 1.0 - smoothstep(2.0, 3.0, t);
  }
  float s = uSize * gone * (0.9 + 0.2 * fract(aSeed.z * 13.0));
  float wing = abs(aWing);
  float flap = sin(uTime * flapRate + aSeed.z * 5.0);
  vec3 p = position * s;
  p.y += wing * mix(flap * 0.34 * s, -0.08 * s, folded);
  p.z *= mix(1.0, 0.25, folded);
  float ca = cos(heading), sa = sin(heading);
  vec3 w = c + vec3(p.x * ca - p.z * sa, p.y, p.x * sa + p.z * ca);
  vShade = 1.0 - 0.45 * wing;
  vFogUv = w.xz * uFogXf.xy + uFogXf.zw;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FRAG = /* glsl */`
uniform vec3 uCol; uniform sampler2D uFogTex; uniform float uFogOn;
varying float vShade; varying vec2 vFogUv;
void main() {
  // Airborne birds stay; only a fogged-out ground bird dims, like everything else down there.
  float v = mix(1.0, texture2D(uFogTex, vFogUv).r, uFogOn);
  gl_FragColor = vec4(uCol * vShade * (0.45 + 0.55 * smoothstep(0.1, 0.9, v)), 1.0);
}`;

function birdGeometry() {
  // Lying flat, nose along +X: a body sliver and two raked wings.
  const verts = [
    [0.5, 0, 0], [-0.3, 0, 0.09], [-0.3, 0, -0.09],
    [-0.45, 0, 0.05], [-0.3, 0, 0.09], [-0.3, 0, -0.09],
    [0.16, 0, 0], [-0.12, 0, 0], [-0.3, 0, 0.72],
    [0.16, 0, 0], [-0.3, 0, -0.72], [-0.12, 0, 0],
  ];
  const wings = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, -1, 0];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts.flat(), 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wings, 1));
  return g;
}

const rand = (a, b) => a + Math.random() * (b - a);
const STEAM = [0.74, 0.76, 0.8];
const SPARK = [1, 0.78, 0.36];
const LAMP = [1.0, 0.82, 0.55];
const BOLT = [0.82, 0.9, 1.0];
const BOLT_POINTS = 14;

export class Ambient {
  constructor(scene, map, theme, world, fogUniforms, vfx, weather, surf) {
    this.scene = scene;
    this.map = map;
    this.theme = theme;
    this.vfx = vfx;
    this.weather = weather;
    this.surf = surf;
    this.lowPower = false;
    this.clock = 0;
    this.time = { value: 0 };
    const cfg = this.cfg = LIFE[theme.id] || NONE;
    const n = cfg.flock + cfg.ground;
    this.nBirds = n;
    this.mesh = null;
    if (n > 0) {
      const g = birdGeometry();
      const seeds = new Float32Array(n * 4), mode = new Float32Array(n * 2);
      const open = openSpots(map, cfg.ground, surf);
      for (let i = 0; i < n; i++) {
        const j = i - cfg.flock;
        if (j < 0) {
          seeds[i * 4] = map.width * (0.25 + Math.random() * 0.5);
          seeds[i * 4 + 1] = map.height * (0.25 + Math.random() * 0.5);
          seeds[i * 4 + 2] = Math.random() * 6.28;
          seeds[i * 4 + 3] = Math.random() * 10;
        } else {
          const s = open[j] || open[0] || { x: map.width / 2, z: map.height / 2 };
          seeds[i * 4] = s.x + Math.random() * 1.2; seeds[i * 4 + 1] = s.z + Math.random() * 1.2;
          seeds[i * 4 + 2] = Math.random() * 6.28; seeds[i * 4 + 3] = 0;
          mode[i * 2] = 1;
        }
      }
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
      this.aMode = new THREE.InstancedBufferAttribute(mode, 2).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aMode', this.aMode);
      g.instanceCount = n;
      this.material = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
        uniforms: {
          uTime: this.time, uSize: { value: cfg.size }, uFlockY: { value: cfg.flockY },
          uCol: { value: new THREE.Vector3(...cfg.col) },
          uFogTex: fogUniforms.tex, uFogXf: fogUniforms.xf, uFogOn: fogUniforms.on,
        },
      });
      this.mesh = new THREE.Mesh(g, this.material);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 8;
      scene.add(this.mesh);
    }

    this.vents = cfg.vents ? placeSpots(map, cfg.vents, 0.7).map(v => ({ x: v.x, z: v.z, t: Math.random() * 2 })) : [];
    this.devils = Array.from({ length: cfg.devils || 0 }, () => ({
      x: Math.random() * map.width, z: Math.random() * map.height, dx: rand(0.8, 1.5), dz: rand(-0.5, 0.5), phase: Math.random() * 6.28, t: 0,
    }));
    // A few lamps on the map are on their way out.
    const lamps = (world.lamps || []).slice();
    lamps.sort((a, b) => Math.abs(a.x - map.width / 2) + Math.abs(a.z - map.height / 2) - Math.abs(b.x - map.width / 2) - Math.abs(b.z - map.height / 2));
    this.badLamps = lamps.filter((_, i) => i % 3 === 0).slice(0, 7).map((l, i) => ({ x: l.x, z: l.z, phase: i * 3.7, spark: 2 + Math.random() * 4 }));

    this.bolt = new Float32Array(BOLT_POINTS * 3);
    this.fork = new Float32Array(6 * 3);
    this.boltX = 0; this.boltZ = 0;
    this.lastPulse = -1;
    this.strikeNow = false;       // True for the one frame a bolt lands; the renderer shakes the camera.
  }

  setLowPower(on) {
    this.lowPower = on;
    if (this.mesh) this.mesh.visible = !on;
  }

  // Flush any ground bird near a loud noise.
  startle(x, z, radius) {
    if (!this.mesh) return;
    const n = this.cfg.flock, a = this.aMode, seeds = this.mesh.geometry.attributes.aSeed;
    let touched = false;
    for (let i = n; i < this.nBirds; i++) {
      if (a.getY(i) > 0) continue;
      const dx = seeds.getX(i) - x, dz = seeds.getY(i) - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      a.setY(i, this.time.value);
      touched = true;
    }
    if (touched) a.needsUpdate = true;
  }

  update(dt, focusX, focusZ) {
    this.clock += dt;
    this.time.value = (this.time.value + dt) % 3600;
    this.strikeNow = false;
    if (this.mesh && !this.lowPower && this.cfg.ground > 0) this.#regroup();
    this.#vents(dt, focusX, focusZ);
    this.#lamps(dt, focusX, focusZ);
    this.#devils(dt, focusX, focusZ);
    if (this.theme.lightning) this.#lightning(dt, focusX, focusZ);
  }

  // Birds that fled come back to their spot a while later.
  #regroup() {
    const n = this.cfg.flock, a = this.aMode, t = this.time.value;
    let dirty = false;
    for (let i = n; i < this.nBirds; i++) {
      const at = a.getY(i);
      if (at > 0 && (t - at > 26 || t < at)) { a.setY(i, 0); dirty = true; }
    }
    if (dirty) a.needsUpdate = true;
  }

  #vents(dt, fx, fz) {
    const vfx = this.vfx, rate = this.lowPower ? 0.4 : 0.14;
    for (let i = 0; i < this.vents.length; i++) {
      const v = this.vents[i];
      if (Math.abs(v.x - fx) > 19 || Math.abs(v.z - fz) > 13) continue;
      v.t -= dt;
      if (v.t > 0) continue;
      v.t = rate * rand(0.7, 1.4);
      // Vents breathe: most of the time a thread, sometimes a proper gasp.
      const big = Math.sin(this.clock * 0.9 + i * 2.1) > 0.75;
      vfx.spawn(v.x + rand(-0.12, 0.12), 0.15, v.z + rand(-0.12, 0.12), rand(-0.3, 0.3), rand(1.3, big ? 3.6 : 2.2), rand(-0.3, 0.3),
        rand(0.7, 1.3), 0.12, big ? 1.0 : 0.6, STEAM, big ? 0.42 : 0.3, -0.6, 1.1);
    }
  }

  #lamps(dt, fx, fz) {
    const vfx = this.vfx;
    for (let i = 0; i < this.badLamps.length; i++) {
      const l = this.badLamps[i];
      if (Math.abs(l.x - fx) > 19 || Math.abs(l.z - fz) > 13) continue;
      const t = this.clock * 5 + l.phase;
      const n = Math.sin(t) * Math.sin(t * 2.33 + 1.1) + Math.sin(t * 7.7);
      const on = n > -0.9 ? (n > 1.1 ? 0.25 : 1) : 0.05;
      vfx.addDot(l.x, 3.4, l.z, 0.85 + 0.45 * on * (0.5 + 0.5 * Math.sin(t * 3)), scaled(LAMP, on * 0.34));
      l.spark -= dt;
      if (l.spark <= 0) {
        l.spark = 2.5 + Math.random() * 5;
        for (let k = vfx._n(7); k > 0; k--) vfx.spawn(l.x, 3.4, l.z, rand(-2, 2), rand(-0.5, 2), rand(-2, 2), rand(0.4, 0.8), 0.05, 0.01, SPARK, 0, 10, 0.4, 0.03);
      }
    }
  }

  #devils(dt, fx, fz) {
    if (this.lowPower) return;
    const vfx = this.vfx, map = this.map;
    for (let i = 0; i < this.devils.length; i++) {
      const d = this.devils[i];
      d.x += d.dx * dt; d.z += d.dz * dt;
      d.phase += dt * 11;
      if (d.x > map.width + 2) { d.x = -2; d.z = Math.random() * map.height; }
      if (Math.abs(d.x - fx) > 19 || Math.abs(d.z - fz) > 13) continue;
      d.t -= dt;
      if (d.t > 0) continue;
      d.t = 0.03;
      for (let k = 0; k < 2; k++) {
        const y = 0.2 + Math.random() * 2.6, r = 0.2 + y * 0.32, a = d.phase + k * Math.PI;
        const sp = 8 * r;
        vfx.spawn(d.x + Math.cos(a) * r, y, d.z + Math.sin(a) * r, -Math.sin(a) * sp, rand(0.6, 1.6), Math.cos(a) * sp, rand(0.4, 0.7), 0.06, 0.4, vfx.dustRGB, 0.5, -0.5, 1);
      }
    }
  }

  #lightning(dt, fx, fz) {
    const w = this.weather, flash = w.flash.value;
    const pulse = w.strikeLen > 0 ? w.pulses : -1;
    if (pulse !== this.lastPulse) {
      this.lastPulse = pulse;
      if (pulse >= 0) this.#newBolt(pulse === 0, fx, fz);
    }
    if (flash < 0.18 || pulse < 0) return;
    const vfx = this.vfx, b = this.bolt, a = Math.min(1, flash * 1.25);
    const rgb = scaled(BOLT, a);
    for (let i = 0; i < BOLT_POINTS - 1; i++) {
      const j = i * 3;
      vfx.addBeam(b[j], b[j + 1], b[j + 2], b[j + 3], b[j + 4], b[j + 5], rgb, 0.11 + flash * 0.09);
    }
    const f = this.fork;
    for (let i = 0; i < 5; i++) {
      const j = i * 3;
      vfx.addBeam(f[j], f[j + 1], f[j + 2], f[j + 3], f[j + 4], f[j + 5], rgb, 0.05 + flash * 0.05);
    }
  }

  // Lands on water when it can: the basins are what the storm is hitting.
  #newBolt(landing, fx, fz) {
    let x = 0, z = 0;
    for (let i = 0; i < 18; i++) {
      x = fx + rand(-14, 14); z = fz + rand(-7, 8);
      if (x > 0 && z > 0 && x < this.map.width && z < this.map.height && (i > 9 || this.surf.isWater(x, z))) break;
    }
    if (landing) { this.boltX = x; this.boltZ = z; } else { x = this.boltX + rand(-2.5, 2.5); z = this.boltZ + rand(-1.5, 1.5); }
    const b = this.bolt, topY = 30, topZ = z - 22;
    for (let i = 0; i < BOLT_POINTS; i++) {
      const k = i / (BOLT_POINTS - 1);
      const jit = i === BOLT_POINTS - 1 ? 0 : Math.sin(k * Math.PI) * 1.8 + 0.4;
      b[i * 3] = x + rand(-1, 1) * jit;
      b[i * 3 + 1] = topY * (1 - k);
      b[i * 3 + 2] = topZ + (z - topZ) * k + rand(-1, 1) * jit * 0.6;
    }
    // One branch off the middle of the bolt.
    const f = this.fork, s = 5 + Math.floor(Math.random() * 4);
    let px = b[s * 3], py = b[s * 3 + 1], pz = b[s * 3 + 2];
    for (let i = 0; i < 6; i++) {
      f[i * 3] = px; f[i * 3 + 1] = py; f[i * 3 + 2] = pz;
      px += rand(-0.6, 2.2); py -= rand(1.2, 2.8); pz += rand(-0.6, 1.5);
    }
    if (landing) {
      this.strikeNow = true;
      const vfx = this.vfx;
      if (this.surf.isWater(x, z)) vfx.waterSplash(x, z, 2);
      else {
        vfx.scorch(x, z, 0.9);
        vfx.sparks(x, 0.3, z, 0, 0, SPARK, vfx._n(14), 12);
      }
      vfx.ring(x, z, 0.3, 4, 0.3, BOLT, 0.9, this.surf.isWater(x, z) ? -0.55 : 0.17);
      vfx.pop(x, 2, z, 16, BOLT, 0.3);
    }
  }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.material.dispose();
    }
  }
}

const _scaled = [0, 0, 0];
function scaled(c, k) { _scaled[0] = c[0] * k; _scaled[1] = c[1] * k; _scaled[2] = c[2] * k; return _scaled; }

function openSpots(map, n, surf) {
  const out = [];
  for (let tries = 0; tries < n * 60 && out.length < n; tries++) {
    const x = 3 + Math.random() * (map.width - 6), z = 3 + Math.random() * (map.height - 6);
    if (surf.wallAt(x, z) || surf.wallAt(x + 1.5, z) || surf.wallAt(x - 1.5, z) || surf.wallAt(x, z + 1.5) || surf.wallAt(x, z - 1.5)) continue;
    out.push({ x, z });
  }
  return out;
}
