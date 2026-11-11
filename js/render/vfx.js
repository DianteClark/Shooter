// Pooled, event-driven effects. Every system is a single instanced draw over a fixed typed-array
// pool: new effects overwrite the oldest slot, nothing is allocated after construction.
import * as THREE from 'three';
import { GLSL_LIGHT, hexRGB } from './art.js';
import { MeshBuilder } from './meshbuild.js';
import { MAX_POPS } from './world.js';
import { getTracer, getKillEffect } from '../shared/camos.js';
import { uploadUsed } from './dynbuf.js';
import { completeFx, impactBus } from './feel.js';

const TRACERS = 180;
const PARTS = 1100;
const SHELLS = 72;
const SHARDS = 240;
const FLASHES = 64;                // A shaped flash is up to three stars, and 32 guns can be firing.
const BALLS = 24;
const RINGS = 80;
const DELAYED = 12;
const MARKS = 110;
const ROCKETS = 6;
const BARREL_COOL = 0.3;           // Barrel heat lost per second between rounds (1 = smoking).
const SMOKERS = 8;                // Barrels trailing smoke at once.
const SMOKE_SWIRLS = 6;           // Rounds per frame that may stir a smoke cloud.
const ROCKET_SPEED = 92;       // Metres per second: fast, but you still see it leave.

// Per-gun firing signature. tail/linger/speed shape the tracer, flash shapes the muzzle star,
// shell picks the casing, extra adds a family trait: T-brake jets, cylinder-gap flare, backblast.
// A gun with no entry here gets one derived from its class and stats, and every entry gets its class traits
// (flash silhouette, tracer tint and frequency, barrel smoke): see completeFx in feel.js.
export const GUN_FX = {
  ar:       { tail: 11, linger: 0.075, speed: 230, flash: [1.5, 1.1, 1.0],  shell: 'rifle' },
  burst:    { tail: 10, linger: 0.06,  speed: 240, flash: [1.4, 1.2, 0.85], shell: 'rifle' },
  smg:      { tail: 6,  linger: 0.04,  speed: 200, flash: [1.15, 0.8, 1.2], shell: 'pistol', jitter: 1 },
  pdw:      { tail: 5,  linger: 0.035, speed: 200, flash: [1.05, 0.75, 1.3], shell: 'pistol', jitter: 1 },
  shotgun:  { tail: 3.4, linger: 0.05, speed: 170, flash: [2.3, 0.75, 1.9], shell: 'hull', extra: 'blast' },
  autoshot: { tail: 3,  linger: 0.04,  speed: 170, flash: [2.0, 0.8, 1.6],  shell: 'hull', extra: 'blast' },
  lmg:      { tail: 13, linger: 0.09,  speed: 220, flash: [1.8, 1.0, 1.2],  shell: 'link', every: 3 },
  dmr:      { tail: 18, linger: 0.16,  speed: 300, flash: [1.8, 1.25, 0.8], shell: 'rifle' },
  sniper:   { tail: 70, linger: 0.46,  speed: 520, flash: [2.3, 1.5, 0.7],  shell: 'magnum', extra: 'brake', contrail: 1 },
  pistol:   { tail: 7,  linger: 0.05,  speed: 210, flash: [1.2, 0.9, 1.0],  shell: 'pistol' },
  revolver: { tail: 9,  linger: 0.13,  speed: 240, flash: [1.9, 0.85, 1.7], shell: null, extra: 'gap' },
  launcher: { tail: 0,  linger: 0,     speed: 92,  flash: [2.4, 0.5, 2.2],  shell: null, extra: 'backblast' },
  // The Golden Gun. Its tail length doubles as its tracer's signature: the renderer hands tracer() only numbers, so
  // GOLD_TAIL is how a golden round is told apart there and drawn gold whatever the shooter's camo or tracer.
  golden:   { tail: 26.5, linger: 0.34, speed: 360, flash: [2.3, 1.3, 1.5], shell: 'magnum', extra: 'gold' },
  // Wave 5.
  heavyar:    { tail: 12, linger: 0.085, speed: 230, flash: [1.7, 1.2, 1.1],   shell: 'rifle' },
  tacsmg:     { tail: 7,  linger: 0.045, speed: 215, flash: [1.05, 0.75, 1.0], shell: 'pistol' },
  coach:      { tail: 3.6, linger: 0.06, speed: 170, flash: [2.6, 0.8, 2.1],   shell: null, extra: 'blast' },
  saw:        { tail: 12, linger: 0.08,  speed: 220, flash: [1.6, 1.0, 1.15],  shell: 'link', every: 4 },
  rotary:     { tail: 9,  linger: 0.06,  speed: 230, flash: [1.4, 0.9, 1.4],   shell: 'link', every: 5, jitter: 1 },
  battle:     { tail: 15, linger: 0.12,  speed: 280, flash: [1.8, 1.2, 0.9],   shell: 'rifle' },
  lever:      { tail: 14, linger: 0.12,  speed: 260, flash: [1.9, 1.0, 1.4],   shell: 'rifle' },
  antimat:    { tail: 90, linger: 0.6,   speed: 560, flash: [2.8, 1.7, 0.6],   shell: 'magnum', extra: 'brake', contrail: 1 },
  semisnipe:  { tail: 40, linger: 0.3,   speed: 450, flash: [2.0, 1.3, 0.75],  shell: 'magnum', contrail: 1 },
  machpistol: { tail: 5,  linger: 0.035, speed: 200, flash: [1.0, 0.7, 1.2],   shell: 'pistol', jitter: 1 },
  deuce:      { tail: 7,  linger: 0.05,  speed: 215, flash: [1.3, 0.9, 1.0],   shell: 'pistol' },
  // Flies as a projectile like the rocket (see the renderer's _onShot); this only shapes the muzzle flash.
  thumper:    { tail: 0,  linger: 0,     speed: 92,  flash: [1.8, 0.5, 1.6],   shell: null },
  // V8. The crossbow has no flash and no case: a slow pale streak of a bolt.
  carbine:    { tail: 9,  linger: 0.06,  speed: 225, flash: [1.3, 0.95, 1.05], shell: 'rifle' },
  heavysmg:   { tail: 8,  linger: 0.06,  speed: 210, flash: [1.5, 0.95, 1.3],  shell: 'pistol' },
  slug:       { tail: 12, linger: 0.1,   speed: 250, flash: [2.1, 0.9, 1.7],   shell: 'hull' },
  lightlmg:   { tail: 12, linger: 0.08,  speed: 225, flash: [1.6, 1.0, 1.1],   shell: 'rifle', every: 2 },
  crossbow:   { tail: 6,  linger: 0.2,   speed: 120, flash: [0.2, 0.2, 0.2],   shell: null, smoke: 1e9, tint: [1, 1, 1, 0] },
  scatter:    { tail: 3.2, linger: 0.05, speed: 170, flash: [2.0, 0.75, 1.8],  shell: null, extra: 'blast' },
};
completeFx(GUN_FX);
const GOLD_TAIL = GUN_FX.golden.tail;
const GOLD_KILL_WINDOW = 1.2;   // Seconds a golden round's end point is remembered for its kill effect.
const GUN_FX_DEFAULT = GUN_FX.ar;
const SHELL_LOOK = {
  rifle:  { rgb: [0.92, 0.7, 0.28],  s: 1.0 },
  pistol: { rgb: [0.95, 0.76, 0.34], s: 0.72 },
  hull:   { rgb: [0.78, 0.14, 0.1],  s: 1.5 },
  magnum: { rgb: [0.96, 0.78, 0.36], s: 1.75 },
  link:   { rgb: [0.34, 0.33, 0.33], s: 0.9 },
};

// Impact by material: spark and chip colours, chip count, dust colour and density, and the mark left behind.
const IMPACT = {
  metal:    { spark: [1.0, 0.84, 0.48], sparks: 10, speed: 14, chip: null, chips: 0, dust: [0.3, 0.3, 0.32], puffs: 1, alpha: 0.28, mark: [0.05, 0.05, 0.06], glow: 0.9 },
  wood:     { spark: [0.95, 0.66, 0.32], sparks: 1, speed: 6, chip: [0.72, 0.56, 0.32], chips: 5, dust: [0.34, 0.27, 0.18], puffs: 2, alpha: 0.5, mark: [0.1, 0.07, 0.04], glow: 0 },
  concrete: { spark: [1.0, 0.72, 0.3], sparks: 4, speed: 10, chip: [0.56, 0.55, 0.53], chips: 3, dust: [0.33, 0.32, 0.31], puffs: 3, alpha: 0.55, mark: [0.08, 0.08, 0.09], glow: 0 },
  neon:     { spark: [0.7, 0.45, 1.0], sparks: 6, speed: 12, chip: [0.45, 0.45, 0.6], chips: 2, dust: [0.24, 0.22, 0.32], puffs: 2, alpha: 0.42, mark: [0.05, 0.04, 0.08], glow: 0.5 },
  rock:     { spark: [1.0, 0.76, 0.42], sparks: 2, speed: 8, chip: [0.56, 0.46, 0.36], chips: 4, dust: [0.38, 0.32, 0.24], puffs: 3, alpha: 0.55, mark: [0.14, 0.1, 0.08], glow: 0 },
  adobe:    { spark: [1.0, 0.76, 0.42], sparks: 1, speed: 6, chip: [0.72, 0.62, 0.48], chips: 4, dust: [0.46, 0.4, 0.3], puffs: 4, alpha: 0.62, mark: [0.2, 0.15, 0.11], glow: 0 },
  sand:     { spark: [1.0, 0.76, 0.42], sparks: 0, speed: 6, chip: [0.74, 0.65, 0.46], chips: 2, dust: [0.52, 0.45, 0.32], puffs: 5, alpha: 0.7, mark: [0.3, 0.25, 0.17], glow: 0 },
  snow:     { spark: [0.9, 0.95, 1.0], sparks: 0, speed: 6, chip: [0.86, 0.9, 0.96], chips: 3, dust: [0.62, 0.66, 0.72], puffs: 4, alpha: 0.6, mark: [0.36, 0.4, 0.46], glow: 0 },
  ice:      { spark: [0.8, 0.93, 1.0], sparks: 3, speed: 9, chip: [0.72, 0.86, 0.96], chips: 5, dust: [0.5, 0.58, 0.66], puffs: 1, alpha: 0.35, mark: [0.3, 0.38, 0.46], glow: 0.2 },
  cloth:    { spark: [1.0, 0.76, 0.42], sparks: 0, speed: 6, chip: [0.8, 0.75, 0.62], chips: 2, dust: [0.34, 0.32, 0.27], puffs: 2, alpha: 0.4, mark: [0.2, 0.18, 0.14], glow: 0 },
};

// What a round kicks up from the floor, by the map's ground: dust colour scale, puffs, alpha, and the scar it leaves.
const GROUND = {
  dirt:  { puffs: 2, alpha: 0.5,  rise: 1.1, mark: [0.07, 0.06, 0.05], a: 0.4 },
  sand:  { puffs: 4, alpha: 0.62, rise: 1.5, mark: [0.2, 0.16, 0.1],   a: 0.3 },
  snow:  { puffs: 4, alpha: 0.6,  rise: 1.3, mark: [0.3, 0.33, 0.4],   a: 0.35 },
  water: { puffs: 1, alpha: 0.35, rise: 0.9, mark: null,               a: 0 },      // Wet ground: a puddle splash.
};
const SNOW_RGB = [0.66, 0.7, 0.76];

const rand = (a, b) => a + Math.random() * (b - a);

// A pool with no instances issues no draw call, so the GPU only builds its pipeline (and on iOS, finishes compiling
// its shaders) the first time something is in it: the first throw, the first blast. That is a visible hitch. During
// the first frames of a match every pool listed here draws one invisible instance instead: slot 0 of an instanced
// mesh is a zero matrix, and a fresh attribute pool is all zeros (zero size, zero alpha), so nothing shows.
const NOOP = () => {};
export function prewarm(objects, frames = 3) {
  for (const o of objects) {
    let left = frames;
    o.onBeforeRender = function () {
      if (this.isInstancedMesh) { if (this.count === 0) { this.count = 1; this._warming = true; } }
      else if (this.geometry.isInstancedBufferGeometry && this.geometry.instanceCount === 0) { this.geometry.instanceCount = 1; this._warming = true; }
    };
    o.onAfterRender = function () {
      if (this._warming) {
        if (this.isInstancedMesh) this.count = 0; else this.geometry.instanceCount = 0;
        this._warming = false;
      }
      if (--left <= 0) { this.onBeforeRender = NOOP; this.onAfterRender = NOOP; }
    };
  }
}

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
    this.clock = 0;
    this.cosmetics = new Map();    // Player id -> {tracer, killFx, rgb, cycle}, from their loadout.
    this.cycleRGB = [1, 1, 1];
    this.delayed = Array.from({ length: DELAYED }, () => ({ t: 0, x: 0, z: 0, r: 0, kind: 0 }));
    this.delayedHead = 0;
    this.fxScale = 1;              // Emission multiplier: the Low Power step halves every burst.
    this.surf = null;              // Surfaces lookup, set by GameRenderer.
    this.dustRGB = [0.42, 0.38, 0.36];
    this.wet = false;
    this.onBoom = null;            // (x, z, radius) when a rocket reaches the blast it was carrying.
    this.groundKind = 'dirt';
    this.smokeClouds = null;       // CombatFX's live smoke slots ({id, x, z, r, a}); rounds through them stir the smoke.
    this.swirls = 0;               // Smoke swirls spent this frame.
    this.smokers = Array.from({ length: SMOKERS }, () => ({ rig: null, t: 0, next: 0, k: 0 }));
    this.tracerSeq = 0;
    this._tint = [0, 0, 0];
    this._buildTracers();
    this._buildParticles();
    this._buildShells();
    this._buildShards();
    this._buildFlashes();
    this._buildBalls();
    this._buildRings();
    this._buildPops();
    this._buildMarks();
    this._buildRockets();
    for (const m of [this.shellMesh, this.shardMesh, this.flashMesh, this.ballMesh, this.rocketMesh]) m.instanceMatrix.array.fill(0);
    prewarm([this.tracerMesh, this.partMesh, this.shellMesh, this.shardMesh, this.flashMesh, this.ballMesh, this.ringMesh, this.markMesh, this.rocketMesh]);
  }

  // Emission count for a burst, respecting the quality step and never below one.
  _n(count) { return Math.max(1, Math.round(count * this.fxScale)); }

  setTheme(theme) {
    // Premultiplied: darker than the ground colour itself so overlapping puffs build to dust, not to white.
    this.dustRGB = theme.ink && theme.ink.dirt ? theme.ink.dirt.map(c => Math.min(1, c * 0.62)) : this.dustRGB;
    this.wet = !!theme.wet;
    this.voidWater = !!theme.void;      // Topside's 'water' is a hole in the slab: things drop, nothing splashes.
    const ink = theme.ink || {};
    this.groundKind = ink.snow ? 'snow' : theme.wet > 0.6 ? 'water' : (ink.sand || theme.id === 'dust' || theme.id === 'desert') ? 'sand' : 'dirt';
  }

  // Cuts to or from a replay: nothing from the old timeline should still be in the air.
  clear() {
    this.tr.t.fill(0); this.pp.t.fill(0); this.sh.t.fill(0); this.sd.t.fill(0); this.fl.t.fill(0); this.bl.t.fill(0);
    this.rg.t.fill(0); this.mk.t.fill(0); this.rk.t.fill(0);
    for (let i = 0; i < DELAYED; i++) this.delayed[i].t = 0;
    for (let i = 0; i < MAX_POPS; i++) this.pops[i].t = 0;
    for (let i = 0; i < SMOKERS; i++) { this.smokers[i].rig = null; this.smokers[i].t = 0; }
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
      len: new Float32Array(TRACERS), linger: new Float32Array(TRACERS), tail: new Float32Array(TRACERS), head: 0,
    };
  }

  tracer(ax, ay, az, bx, by, bz, rgb, width, tail = 11, linger = 0.075, speed = 230) {
    if (tail === GOLD_TAIL) {
      // A golden round: a wide amber halo under a gold streak, whatever colour the renderer asked for.
      this._goldRound(ax, ay, az, bx, by, bz);
      this._tracer(ax, ay, az, bx, by, bz, GOLD_HALO, width * 3.2, tail, linger * 1.4, speed);
      rgb = GOLD; width *= 1.5;
    }
    this._tracer(ax, ay, az, bx, by, bz, rgb, width, tail, linger, speed);
  }

  _tracer(ax, ay, az, bx, by, bz, rgb, width, tail, linger, speed) {
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
    T.linger[i] = linger;
    T.tail[i] = tail;
    T.dur[i] = dist / speed + linger;
    T.t[i] = T.dur[i];
  }

  /* ---------- The Golden Gun ---------- */
  // A golden round leaves glitter hanging along its line, and its end point is kept for the kill effect: the kill
  // event names the gun, but older renderers call killEffect without it, so a kill landing where a golden round just
  // ended counts too.
  _goldRound(ax, ay, az, bx, by, bz) {
    const n = this._n(12);
    for (let i = 1; i <= n; i++) {
      const k = i / (n + 1);
      this.spawn(ax + (bx - ax) * k + rand(-0.08, 0.08), ay + (by - ay) * k, az + (bz - az) * k + rand(-0.08, 0.08),
        rand(-0.2, 0.2), rand(0.2, 0.7), rand(-0.2, 0.2), rand(0.35, 0.7), 0.07, 0.01, i % 3 ? GOLD : GOLD_PALE, 0, -0.3, 1.5);
    }
    const g = this.goldHit ??= { x: 0, z: 0, t: -99 };
    g.x = bx; g.z = bz; g.t = this.clock;
  }

  _isGoldKill(x, z, weapon) {
    if (weapon !== undefined) return weapon === 'golden';
    const g = this.goldHit;
    return !!g && this.clock - g.t < GOLD_KILL_WINDOW && Math.hypot(g.x - x, g.z - z) < 2.5;
  }

  // The Golden Gun's kill: a burst of gold coins, a gold shock ring, a column of light and a lingering glitter.
  _fxGolden(x, z) {
    this.spawn(x, 1.2, z, 0, 0, 0, 0.16, 0.5, 3.2, WHITE, 0, 0, 0);
    this.spawn(x, 1.2, z, 0, 0, 0, 0.32, 0.6, 2.4, GOLD, 0, 0, 0);
    this.ring(x, z, 0.3, 5.2, 0.4, GOLD, 1);
    this.ring(x, z, 0.2, 3, 0.28, GOLD_PALE, 0.9);
    for (let i = 0; i < 22; i++) {
      const a = rand(0, Math.PI * 2), s = rand(2.5, 7);
      this.shard(x, rand(0.8, 1.6), z, Math.cos(a) * s, rand(5, 11), Math.sin(a) * s, i % 3 ? GOLD : GOLD_PALE);
    }
    for (let i = 0; i < 16; i++) {
      this.spawn(x + rand(-0.25, 0.25), rand(0.2, 0.6), z + rand(-0.25, 0.25), rand(-0.3, 0.3), rand(4, 8), rand(-0.3, 0.3),
        rand(0.4, 0.8), 0.14, 0.03, i % 2 ? GOLD_PALE : WHITE, 0, -1, 0.8, 0.08);
    }
    for (let i = 0; i < 24; i++) {
      const a = rand(0, Math.PI * 2), r = rand(0.3, 2.2);
      this.spawn(x + Math.cos(a) * r, rand(0.4, 2.2), z + Math.sin(a) * r, 0, rand(0.1, 0.6), 0, rand(0.8, 1.5), 0.06, 0.01, GOLD, 0, -0.2, 0.6);
    }
    this.pop(x, 1.4, z, 9, GOLD, 0.34);
  }

  /* ---------- Loadout cosmetics: tracer colours and kill effects ---------- */
  // Renderer feeds these from the roster. Stores by value, safe to call again on a loadout change.
  setLoadout(id, loadout) {
    if (!loadout) return;
    let c = this.cosmetics.get(id);
    if (!c) this.cosmetics.set(id, c = { tracer: 'none', killFx: 'none', rgb: null, cycle: false });
    const def = getTracer(loadout.tracer);
    c.tracer = def.id;
    c.killFx = getKillEffect(loadout.killFx).id;
    c.rgb = def.color === undefined ? null : hexRGB(def.color);
    c.cycle = !!def.cycle;
  }

  setLoadouts(players) {
    for (let i = 0; i < players.length; i++) this.setLoadout(players[i].id, players[i].loadout);
  }

  // The colour this player's shots should use; fallback is their camo tint or team colour.
  tracerRGB(id, fallback) {
    const c = this.cosmetics.get(id);
    if (!c || !c.rgb) return fallback;
    if (!c.cycle) return c.rgb;
    // Bright hue wheel, three phase-shifted sines. One shared array: consumers copy it out at once.
    const out = this.cycleRGB, h = this.clock * 2.4;
    out[0] = 0.55 + 0.45 * Math.sin(h);
    out[1] = 0.55 + 0.45 * Math.sin(h + 2.094);
    out[2] = 0.55 + 0.45 * Math.sin(h + 4.188);
    return out;
  }

  // Plays the killer's kill effect at the victim. Returns false for the standard (no extra) effect. A Golden Gun kill
  // always plays the golden effect instead of the killer's own (pass the kill event's weapon when there is one).
  killEffect(byId, x, z, weapon) {
    if (this._isGoldKill(x, z, weapon)) { this._fxGolden(x, z); return true; }
    switch (this.cosmetics.get(byId)?.killFx) {
      case 'embers': this._fxEmbers(x, z); return true;
      case 'shockring': this._fxShockRing(x, z); return true;
      case 'shatter': this._fxShatter(x, z); return true;
      case 'overload': this._fxOverload(x, z); return true;
      case 'implode': this._fxImplode(x, z); return true;
      case 'phoenix': this._fxPhoenix(x, z); return true;
      default: return false;
    }
  }

  _fxEmbers(x, z) {
    for (let i = 0; i < 30; i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.8, 4.5);
      this.spawn(x, rand(0.4, 1.6), z, Math.cos(a) * s, rand(3, 9), Math.sin(a) * s, rand(0.5, 1.15), 0.12, 0.02, i % 3 ? FX_EMBER : FX_EMBER_HOT, 0, 6, 1.1, 0.03);
    }
    this.pop(x, 1.4, z, 6, FX_EMBER, 0.32);
  }

  _fxShockRing(x, z) {
    this.ring(x, z, 0.3, 4.2, 0.34, FX_SHOCK, 1);
    this.ring(x, z, 0.2, 2.6, 0.24, WHITE, 0.9);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2, s = rand(14, 22);
      this.spawn(x, 0.5, z, Math.cos(a) * s, 0.2, Math.sin(a) * s, 0.2, 0.12, 0.02, FX_SHOCK, 0, 0, 3, 0.05);
    }
    this.pop(x, 1.4, z, 7, FX_SHOCK, 0.24);
  }

  _fxShatter(x, z) {
    for (let i = 0; i < 18; i++) {
      const a = rand(0, Math.PI * 2), s = rand(3, 10);
      this.shard(x, rand(0.6, 1.7), z, Math.cos(a) * s, rand(4, 11), Math.sin(a) * s, i % 2 ? FX_ICE : FX_ICE_PALE);
    }
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2), s = rand(1, 3);
      this.spawn(x, rand(0.5, 1.8), z, Math.cos(a) * s, rand(0.5, 2.5), Math.sin(a) * s, rand(0.5, 0.95), 0.09, 0.01, FX_ICE_PALE, 0, 2, 1, 0);
    }
    this.spawn(x, 1.2, z, 0, 0, 0, 0.14, 0.5, 2.1, FX_ICE_PALE, 0, 0, 0);
    this.pop(x, 1.4, z, 6.5, FX_ICE, 0.26);
  }

  // Lightning from short tracer segments: each arc jitters outward in three hops.
  _fxOverload(x, z) {
    for (let i = 0; i < 7; i++) {
      let px = x, py = 1.1, pz = z;
      const a = rand(0, Math.PI * 2);
      for (let hop = 1; hop <= 3; hop++) {
        const r = hop * 1.05, j = a + rand(-0.5, 0.5);
        const nx = x + Math.cos(j) * r, nz = z + Math.sin(j) * r, ny = rand(0.5, 1.9);
        this.tracer(px, py, pz, nx, ny, nz, FX_VOLT, 0.09);
        px = nx; py = ny; pz = nz;
      }
    }
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2), s = rand(5, 12);
      this.spawn(x, 1.1, z, Math.cos(a) * s, rand(-1, 4), Math.sin(a) * s, rand(0.15, 0.3), 0.1, 0.02, FX_VOLT, 0, 8, 2, 0.05);
    }
    this.spawn(x, 1.1, z, 0, 0, 0, 0.18, 0.6, 1.6, FX_VOLT, 0, 0, 0);
    this.pop(x, 1.4, z, 7, FX_VOLT, 0.3);
  }

  // Everything is drawn in to a point, then _stepDelayed lets it go a beat later.
  _fxImplode(x, z) {
    const life = 0.26;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2, r = rand(2.6, 3.8);
      this.spawn(x + Math.cos(a) * r, rand(0.5, 1.8), z + Math.sin(a) * r, -Math.cos(a) * (r / life), 0, -Math.sin(a) * (r / life), life, 0.1, 0.16, FX_VOID, 0, 0, 0, 0.03);
    }
    this.spawn(x, 1.1, z, 0, 0, 0, life, 1.5, 0.15, FX_VOID, 0, 0, 0);
    const d = this.delayed[this.delayedHead];
    this.delayedHead = (this.delayedHead + 1) % DELAYED;
    d.t = life; d.x = x; d.z = z; d.kind = 0;
  }

  _secondaryBlast(x, z, r) {
    this.fireball(x + rand(-1, 1), rand(1.2, 2.2), z + rand(-1, 1), r * 0.55, 0.3);
    for (let i = this._n(10); i > 0; i--) {
      const a = rand(0, Math.PI * 2), s = rand(3, 10);
      this.spawn(x, 1.5, z, Math.cos(a) * s, rand(3, 8), Math.sin(a) * s, rand(0.4, 0.8), 0.1, 0.02, FIRE_HOT, 0, 10, 1.2, 0.02);
    }
  }

  _implodeRelease(x, z) {
    this.spawn(x, 1.1, z, 0, 0, 0, 0.2, 0.4, 3.0, WHITE, 0, 0, 0);
    this.spawn(x, 1.1, z, 0, 0, 0, 0.3, 0.4, 2.2, FX_VOID, 0, 0, 0);
    this.ring(x, z, 0.3, 5.5, 0.42, FX_VOID, 1);
    this.ring(x, z, 0.2, 3.2, 0.3, WHITE, 0.9);
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), s = rand(9, 24);
      this.spawn(x, 1.1, z, Math.cos(a) * s, rand(-1, 8), Math.sin(a) * s, rand(0.22, 0.42), 0.13, 0.02, i % 2 ? FX_VOID : WHITE, 0, 8, 2, 0.05);
    }
    this.pop(x, 1.6, z, 10, FX_VOID, 0.4);
  }

  // Two fire wings that sweep up and out of the body, then a rising core.
  _fxPhoenix(x, z) {
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 16; i++) {
        const k = i / 15;
        const out = side * (0.3 + k * 2.6), y = 0.8 + Math.sin(k * Math.PI * 0.8) * 1.5 + k * 0.8;
        this.spawn(x + out, y, z, side * (1.5 + k * 3), rand(4, 8), rand(-0.6, 0.6), rand(0.5, 0.95), 0.2 - k * 0.1, 0.02, k > 0.6 ? FX_PHOENIX_TIP : FX_PHOENIX, 0, -3, 1.4, 0.05);
      }
    }
    for (let i = 0; i < 12; i++) {
      this.spawn(x + rand(-0.25, 0.25), rand(0.5, 1.4), z + rand(-0.25, 0.25), rand(-0.6, 0.6), rand(7, 12), rand(-0.6, 0.6), rand(0.4, 0.75), 0.17, 0.02, FX_PHOENIX_TIP, 0, 0, 1.2, 0.05);
    }
    this.ring(x, z, 0.3, 3.4, 0.4, FX_PHOENIX, 1);
    this.pop(x, 2.0, z, 9, FX_PHOENIX, 0.42);
  }

  _stepDelayed(dt) {
    for (let i = 0; i < DELAYED; i++) {
      const d = this.delayed[i];
      if (d.t <= 0) continue;
      d.t -= dt;
      if (d.t > 0) continue;
      if (d.kind === 1) this._secondaryBlast(d.x, d.z, d.r);
      else this._implodeRelease(d.x, d.z);
    }
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
      side: THREE.DoubleSide,      // Stretched sparks wind away from the camera; culling them hid every spark.
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

  // Impact on a surface, with the character of whatever was hit. `fine` thins it for shotgun pellets.
  wallHit(x, z, nx, nz, fine = false) {
    let mat = this.surf ? this.surf.materialAt(x, z, nx, nz) : 'concrete';
    if (mat === 'sand' && this.groundKind === 'snow') mat = 'snow';     // Arctic maps bank snow where others stack bags.
    const I = IMPACT[mat] || IMPACT.concrete;
    if (!fine || Math.random() < 0.3) impactBus.push(mat, x, z);
    const y = rand(0.5, 1.5);
    const k = fine ? 0.4 : 1;
    if (I.sparks) this.sparks(x, y, z, nx, nz, I.spark, Math.ceil(this._n(I.sparks) * k), I.speed);
    if (I.chips) {
      for (let i = this._n(I.chips * k); i > 0; i--) {
        const a = Math.atan2(nz, nx) + rand(-0.9, 0.9), s = rand(2.2, 7);
        this.shard(x, y, z, Math.cos(a) * s, rand(1.5, 5.5), Math.sin(a) * s, I.chip, rand(0.3, 0.55));
      }
    }
    for (let i = Math.ceil(I.puffs * k); i > 0; i--) {
      this.spawn(x + nx * 0.08, y, z + nz * 0.08, nx * rand(1, 3) + rand(-0.7, 0.7), rand(0.3, 1.3), nz * rand(1, 3) + rand(-0.7, 0.7),
        rand(0.3, 0.55), 0.14, 0.5, I.dust, I.alpha, -0.8, 3.0);
    }
    if (mat === 'sand' || mat === 'snow') {
      // A punctured sandbag bleeds a thin stream of sand for a moment; a snowbank sheds powder the same way.
      for (let i = 0; i < 4; i++) this.spawn(x + nx * 0.06, y - i * 0.1, z + nz * 0.06, nx * 0.15, -rand(0.4, 1.2), nz * 0.15, rand(0.4, 0.7), 0.05, 0.02, I.dust, 0.9, 7, 0.5);
    }
    if (I.glow > 0) this.spawn(x + nx * 0.1, y, z + nz * 0.1, 0, 0, 0, 0.08, 0.25, 0.55 * I.glow, I.spark, 0, 0, 0);
    if (!fine || Math.random() < 0.35) this.mark(x + nx * 0.015, y, z + nz * 0.015, nx, nz, rand(0.09, 0.16), I.mark, I.glow);
  }

  // A round that ran out of range kicks up the ground; over a basin it splashes.
  groundHit(x, z) {
    if (this.surf && this.surf.isWater(x, z)) { impactBus.push('water', x, z); this.waterSplash(x, z, 0.5); return; }
    const kind = this.groundKind, G = GROUND[kind];
    impactBus.push(kind, x, z);
    const rgb = kind === 'snow' ? SNOW_RGB : this.dustRGB;
    // The Low steps never throw more than the two puffs they always did.
    for (let i = this.fxScale <= 0.5 ? Math.min(2, G.puffs) : Math.max(1, Math.round(G.puffs * Math.min(1, this.fxScale + 0.25))); i > 0; i--) {
      this.spawn(x, 0.12, z, rand(-0.8, 0.8), rand(0.6, 1.6) * G.rise, rand(-0.8, 0.8), rand(0.25, 0.45), 0.1, 0.34, rgb, G.alpha, -0.8, 3);
    }
    if (kind === 'water') {
      this.ring(x, z, 0.05, 0.5, 0.3, WATER, 0.4);
      this.spawn(x, 0.1, z, rand(-0.6, 0.6), rand(1.6, 2.8), rand(-0.6, 0.6), rand(0.16, 0.28), 0.05, 0.02, WATER, 0.65, 12, 0.5);
    } else if (this.fxScale >= 0.75) {
      this.groundMark(x, z, rand(0.1, 0.17), G.mark, G.a);      // The scar the round leaves in the floor.
    }
  }

  // A small flat scar on the ground: a solid disc in the ring batch that fades over a few seconds.
  groundMark(x, z, r, rgb, a) {
    const R = this.rg, i = R.head;
    R.head = (i + 1) % RINGS;
    R.x[i] = x; R.z[i] = z; R.r0[i] = 0; R.r1[i] = r;
    R.t[i] = 5; R.life[i] = 5;
    R.cr[i] = rgb[0]; R.cg[i] = rgb[1]; R.cb[i] = rgb[2]; R.a[i] = a; R.solid[i] = 1; R.y[i] = 0.165;
  }

  waterSplash(x, z, k = 1) {
    if (this.voidWater) {
      for (let i = this._n(4 * k); i > 0; i--) this.spawn(x + rand(-0.3, 0.3), -0.2, z + rand(-0.3, 0.3), rand(-0.5, 0.5), rand(-1.5, -0.4), rand(-0.5, 0.5), rand(0.4, 0.7), 0.12, 0.4, this.dustRGB, 0.5, 4, 1.5);
      return;
    }
    for (let i = this._n(9 * k); i > 0; i--) {
      const a = rand(0, Math.PI * 2), s = rand(0.3, 1.8);
      this.spawn(x, -0.55, z, Math.cos(a) * s, rand(2.5, 6) * (0.6 + k * 0.5), Math.sin(a) * s, rand(0.3, 0.55), 0.09, 0.03, WATER, 0.65, 15, 0.4, 0.03);
    }
    this.ring(x, z, 0.1, 0.9 + k * 1.5, 0.5, WATER, 0.5, -0.55);
  }

  groundThud(x, z) {
    for (let i = 0; i < 3; i++) this.spawn(x + rand(-0.2, 0.2), 0.1, z + rand(-0.2, 0.2), rand(-0.8, 0.8), rand(0.2, 0.7), rand(-0.8, 0.8), rand(0.25, 0.4), 0.12, 0.42, this.dustRGB, 0.45, -0.4, 2.6);
  }

  // Foot plant: a scuff of whatever the map's ground is. Sprinting kicks up more.
  footfall(x, z, sprint) {
    if (this.wet) {
      this.ring(x, z, 0.05, 0.3 + sprint * 0.2, 0.28, WATER, 0.38);
      if (sprint > 0.4) for (let i = 0; i < 2; i++) this.spawn(x, 0.1, z, rand(-1, 1), rand(1.4, 2.6), rand(-1, 1), rand(0.16, 0.28), 0.05, 0.02, WATER, 0.65, 12, 0.5);
      return;
    }
    const n = sprint > 0.4 ? 2 : 1;
    for (let i = 0; i < n; i++) this.spawn(x + rand(-0.1, 0.1), 0.08, z + rand(-0.1, 0.1), rand(-0.5, 0.5), rand(0.2, 0.6), rand(-0.5, 0.5), rand(0.26, 0.42), 0.09, 0.36, this.dustRGB, 0.34, -0.3, 2.4);
  }

  // Skids and body parts both scatter small, fast things that cost almost nothing.
  slideTrail(x, z) {
    if (this.wet) this.spawn(x + rand(-0.2, 0.2), 0.12, z + rand(-0.2, 0.2), rand(-0.8, 0.8), rand(1.2, 2.4), rand(-0.8, 0.8), rand(0.2, 0.3), 0.06, 0.03, WATER, 0.65, 11, 0.6);
    else this.spawn(x + rand(-0.2, 0.2), 0.12, z + rand(-0.2, 0.2), rand(-0.7, 0.7), rand(0.3, 0.8), rand(-0.7, 0.7), rand(0.3, 0.5), 0.12, 0.5, this.dustRGB, 0.45, -0.4, 2.2);
  }

  ember(x, y, z, rgb) {
    this.spawn(x, y, z, rand(-0.5, 0.5), rand(0.2, 1.2), rand(-0.5, 0.5), rand(0.18, 0.34), 0.07, 0.015, rgb, 0, 3, 0.8);
  }

  // The full firing signature of a gun at the muzzle: flash shape, jets, smoke and the casing.
  shotFx(weapon, x, y, z, aim, rgb, sup, r) {
    const G = GUN_FX[weapon] || GUN_FX_DEFAULT;
    if (G.extra === 'gold') rgb = GOLD;
    const ca = Math.cos(aim), sa = Math.sin(aim);
    const k = sup ? 0.35 : 1;
    const f = G.flash;
    const wob = G.jitter ? rand(0.75, 1.2) : 1;
    const size = f[0] * k * wob;
    // The silhouette of the flash is the gun's class, readable from above: see `shape` in feel.js. The extra
    // stars are the first thing the Low steps drop, and a suppressor leaves only a flicker.
    const shape = G.shape, rich = !sup && this.fxScale > 0.5;
    if (shape !== 'none') {
      this.muzzleFlash(x, y, z, aim, rgb, size, shape === 'jet' ? f[1] * 1.25 : f[1], shape === 'jet' ? f[2] * 0.8 : f[2]);
      if (rich) {
        if (shape === 'fan') {
          this._flash(x, y, z, aim + 0.55, rgb, size * 0.62, f[1] * 1.1, f[2] * 0.6);
          this._flash(x, y, z, aim - 0.55, rgb, size * 0.62, f[1] * 1.1, f[2] * 0.6);
        } else if (shape === 'cross') {
          this._flash(x, y, z, aim + 1.5708, rgb, size * 0.55, 0.9, 0.45);
          this._flash(x, y, z, aim - 1.5708, rgb, size * 0.55, 0.9, 0.45);
        } else if (shape === 'jet') {
          this._flash(x, y, z, aim, MUZZLE_HOT, size * 0.5, 0.55, 1.5);       // A short bright collar at the crown.
        }
      }
    }
    if (shape !== 'none') this.muzzleSmoke(x, y, z);
    // A swung weapon: one thin pale slash across the aim, where a flash would be.
    if (G.extra === 'swing') this._flash(x, y, z, aim + 1.5708, WHITE, 1.0, 1.7, 0.22);
    if (r) this._barrelHeat(r, G);
    if (!sup) {
      if (G.extra === 'blast') {
        // A cone of burning powder.
        for (let i = this._n(9); i > 0; i--) {
          const a = aim + rand(-0.32, 0.32), s = rand(10, 22);
          this.spawn(x, y, z, Math.cos(a) * s, rand(-0.4, 1.2), Math.sin(a) * s, rand(0.07, 0.14), 0.09, 0.02, MUZZLE_HOT, 0, 0, 7, 0.016);
        }
      } else if (G.extra === 'brake') {
        // T-shaped brake: two jets out the sides and a heavy puff of grey.
        for (let side = -1; side <= 1; side += 2) {
          for (let i = this._n(5); i > 0; i--) {
            const s = rand(7, 15);
            this.spawn(x, y, z, -sa * side * s + ca * 2, rand(-0.3, 0.9), ca * side * s + sa * 2, rand(0.1, 0.2), 0.14, 0.03, MUZZLE_HOT, 0, 0, 5, 0.012);
          }
          this.spawn(x, y, z, -sa * side * 2.5, 0.4, ca * side * 2.5, rand(0.4, 0.7), 0.2, 0.8, DUST, 0.55, -0.6, 2.6);
        }
      } else if (G.extra === 'gold') {
        // A crown of gold sparks around the muzzle and a bright ring of gas.
        for (let i = this._n(14); i > 0; i--) {
          const a = aim + rand(-1.1, 1.1), s = rand(6, 16);
          this.spawn(x, y, z, Math.cos(a) * s, rand(0.5, 3), Math.sin(a) * s, rand(0.18, 0.36), 0.08, 0.015, i % 2 ? GOLD : GOLD_PALE, 0, 4, 3, 0.03);
        }
        this.spawn(x, y, z, 0, 0, 0, 0.12, 0.3, 1.4, GOLD_PALE, 0, 0, 0);
      } else if (G.extra === 'gap') {
        // Revolvers spit fire out of the cylinder gap, either side of the frame.
        for (let side = -1; side <= 1; side += 2) {
          this.spawn(x - ca * 0.55, y, z - sa * 0.55, -sa * side * 3, 0.6, ca * side * 3, 0.1, 0.22, 0.08, MUZZLE_HOT, 0, 0, 2);
        }
      } else if (G.extra === 'backblast') {
        // Rear of the tube: a wide gout of flame, then a wall of smoke.
        for (let i = this._n(12); i > 0; i--) {
          const a = aim + Math.PI + rand(-0.4, 0.4), s = rand(8, 18);
          this.spawn(x - ca * 1.8, y, z - sa * 1.8, Math.cos(a) * s, rand(0.2, 2), Math.sin(a) * s, rand(0.16, 0.34), 0.2, 0.05, FIRE, 0, 0, 5);
        }
        for (let i = this._n(8); i > 0; i--) {
          const a = aim + Math.PI + rand(-0.6, 0.6), s = rand(2, 7);
          this.spawn(x - ca * 2, y, z - sa * 2, Math.cos(a) * s, rand(0.4, 1.4), Math.sin(a) * s, rand(0.6, 1.1), 0.3, 1.1, SMOKE_PALE, 0.6, -0.6, 3);
        }
      }
    }
    // Brass: every case on the higher steps, a share of them on the Low ones (the pool is capped either way).
    if (G.shell && r && (this.fxScale >= 0.75 || Math.random() < this.fxScale)) this.shell(r.eject[0], r.eject[1], r.eject[2], r.ejectDir[0], r.ejectDir[1], G.shell);
  }

  /* ---------- Per-gun tracers, barrel heat and smoke ---------- */
  // The shot-effect entry for a weapon id. Every weapon in WEAPONS has one (hand-made, or derived by feel.js).
  gunFx(weapon) { return GUN_FX[weapon] || GUN_FX_DEFAULT; }

  // One round's tracer, drawn the way its gun draws them. `i` is the ray's index in the shot and `local` whether
  // the local player fired it. Applies the gun's tint, thins other players' tracers on the Low steps (`skip`),
  // lays the sniper contrail and stirs any smoke cloud the round crosses.
  gunTracer(G, by, i, local, ax, ay, az, bx, by2, bz, rgb, width) {
    if (!(G.tail > 0)) return;          // A blade, or anything else that throws no round.
    this._stirSmoke(ax, az, bx, bz);
    if (!local && this.fxScale <= 0.5 && G.skip > 1 && G.tail !== GOLD_TAIL && (this.tracerSeq++ % G.skip) !== 0) return;
    const t = G.tint, c = this.cosmetics.get(by);
    if (t && t[3] > 0 && !(c && c.rgb)) {
      // The shooter's colour still leads (it says whose round this is); the gun only warms or whitens it.
      const m = this._tint, a = t[3];
      m[0] = rgb[0] + (t[0] - rgb[0]) * a; m[1] = rgb[1] + (t[1] - rgb[1]) * a; m[2] = rgb[2] + (t[2] - rgb[2]) * a;
      rgb = m;
    }
    this.tracer(ax, ay, az, bx, by2, bz, rgb, width, G.tail, G.linger, G.speed);
    if (G.contrail && (local || this.fxScale > 0.5)) this.contrail(ax, ay, az, bx, by2, bz);
  }

  // A round through a smoke cloud drags a curl of it along its line: the only trace of a shot you cannot see.
  _stirSmoke(ax, az, bx, bz) {
    const clouds = this.smokeClouds;
    if (!clouds || this.fxScale <= 0.5 || this.swirls >= SMOKE_SWIRLS) return;
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    if (len2 < 1) return;
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      if (c.id === null || c.a < 0.3) continue;
      const u = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / len2));
      const px = ax + dx * u, pz = az + dz * u;
      const off2 = (px - c.x) * (px - c.x) + (pz - c.z) * (pz - c.z);
      if (off2 > c.r * c.r) continue;
      const inv = 1 / Math.sqrt(len2), ux = dx * inv, uz = dz * inv;
      const half = Math.sqrt(c.r * c.r - off2);
      this.swirls++;
      // Where it leaves the cloud, pulled out along the shot, plus a bright thread through the middle.
      const ex = px + ux * Math.min(half, Math.sqrt(len2) * (1 - u)), ez = pz + uz * Math.min(half, Math.sqrt(len2) * (1 - u));
      for (let k = this._n(3); k > 0; k--) {
        this.spawn(ex + rand(-0.15, 0.15), rand(0.9, 1.3), ez + rand(-0.15, 0.15), ux * rand(3, 7) - uz * rand(-1, 1), rand(0.1, 0.6), uz * rand(3, 7) + ux * rand(-1, 1),
          rand(0.45, 0.8), 0.22, 0.75, SMOKE_STIR, 0.42, -0.2, 3.2);
      }
      this.spawn(px, 1.1, pz, ux * 2, 0.1, uz * 2, 0.22, 0.12, 0.5, SMOKE_STIR, 0.3, 0, 2);
      return;
    }
  }

  // Sustained fire heats the barrel. Each round adds the gun's share (1 / `smoke` rounds); it cools between shots.
  // Past full, the barrel is registered to trail smoke once the firing stops, and glows (see barrelGlow).
  _barrelHeat(r, G) {
    const idle = this.clock - (r.fxShotAt ?? -99);
    const hot = Math.max(0, (r.fxHot || 0) - idle * BARREL_COOL) + G.heatPerShot;
    r.fxHot = Math.min(2.2, hot);
    r.fxShotAt = this.clock;
    if (hot < 1 || this.fxScale <= 0.5) return;        // No barrel smoke on the Low steps: the glow alone says it.
    const S = this.smokers;
    let slot = null;
    for (let i = 0; i < SMOKERS; i++) { if (S[i].rig === r) { slot = S[i]; break; } if (!slot && S[i].t <= 0) slot = S[i]; }
    if (!slot) return;
    slot.rig = r; slot.t = 0.9 + Math.min(1, hot - 1) * 1.1; slot.k = Math.min(1, hot - 0.6);
  }

  // 0..0.7: how far a barrel glows from sustained fire alone. Guns with a real heat stat add their own on top.
  barrelGlow(r) {
    const hot = r.fxHot;
    if (!hot) return 0;
    const now = hot - (this.clock - r.fxShotAt) * BARREL_COOL;
    return now <= 1 ? 0 : Math.min(0.7, (now - 1) * 0.7);
  }

  _stepSmokers(dt) {
    const S = this.smokers;
    for (let i = 0; i < SMOKERS; i++) {
      const s = S[i];
      if (s.t <= 0) continue;
      const r = s.rig;
      if (this.clock - r.fxShotAt < 0.14) continue;          // Still firing: the smoke comes when the gun goes quiet.
      s.t -= dt;
      if (s.t <= 0 || !r.visible) { s.t = 0; s.rig = null; continue; }
      s.next -= dt;
      if (s.next > 0) continue;
      s.next = 0.075;
      const m = r.muzzle;
      this.spawn(m[0], m[1], m[2], rand(-0.25, 0.25), rand(0.9, 1.7), rand(-0.25, 0.25), rand(0.55, 0.95), 0.07, 0.34 + 0.2 * s.k, BARREL_SMOKE, 0.22 + 0.16 * s.k, -0.5, 1.6);
    }
  }

  /* ---------- Hit feedback in the world ---------- */
  // The local player's kill, confirmed where it happened: a thin ring snapping outward and a few rising ticks.
  // Gold for a headshot. Sits under the killer's own kill effect, so it never replaces a cosmetic.
  killConfirm(x, z, head) {
    const rgb = head ? HEAD_GOLD : WHITE;
    this.ring(x, z, 0.35, 1.9, 0.26, rgb, 0.85, 0.2);
    if (this.fxScale <= 0.5) return;
    this.ring(x, z, 0.2, 1.1, 0.18, rgb, 0.5, 0.2);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.5708 + 0.7854;
      this.spawn(x + Math.cos(a) * 0.5, 1.2, z + Math.sin(a) * 0.5, Math.cos(a) * 2.2, 2.6, Math.sin(a) * 2.2, 0.26, 0.11, 0.02, rgb, 0, 3, 2.4, 0.05);
    }
  }

  // A round that went into armour: hard white-blue sparks thrown back at the shooter and a flat ping of light.
  armorHit(x, z, dirX, dirZ) {
    this.sparks(x, 1.2, z, -dirX, -dirZ, ARMOR_SPARK, this._n(7), 13);
    this.spawn(x, 1.2, z, 0, 0, 0, 0.09, 0.2, 0.7, ARMOR_SPARK, 0, 0, 0);
  }

  // Sniper round: a pale corkscrew of air left hanging along the shot.
  contrail(ax, ay, az, bx, by, bz) {
    const n = this._n(14);
    for (let i = 1; i <= n; i++) {
      const k = i / n, a = k * 40;
      this.spawn(ax + (bx - ax) * k + Math.cos(a) * 0.06, ay + (by - ay) * k + Math.sin(a) * 0.05, az + (bz - az) * k - Math.sin(a) * 0.06,
        rand(-0.1, 0.1), rand(0.1, 0.3), rand(-0.1, 0.1), rand(0.45, 0.8), 0.05, 0.2, CONTRAIL, 0.4, -0.2, 1.2);
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
    // Hard cross of light at the moment the body comes apart.
    for (let i = 0; i < 2; i++) {
      const sx = i ? 44 : 0, sz = i ? 0 : 44;
      this.spawn(x, y, z, sx, 0, sz, 0.09, 0.13, 0.02, WHITE, 0, 0, 0, 0.07);
      this.spawn(x, y, z, -sx, 0, -sz, 0.09, 0.13, 0.02, WHITE, 0, 0, 0, 0.07);
    }
    for (let i = 0; i < 5; i++) {
      this.spawn(x + rand(-0.3, 0.3), y - 0.4, z + rand(-0.3, 0.3), rand(-0.8, 0.8), rand(0.6, 1.5), rand(-0.8, 0.8),
        rand(0.45, 0.8), 0.32, 0.95, SMOKE, 0.75, -0.4, 1.4);
    }
    this.ring(x, z, 0.35, 1.8, 0.28, rgb, 0.9);
  }

  // A big blast has an order to it: a white instant, the fireball, flying junk, a ground shock, then the smoke stack.
  explosion(x, z, radius) {
    const n = v => this._n(v);
    this.spawn(x, 1.2, z, 0, 0, 0, 0.09, radius * 1.4, radius * 0.5, WHITE, 0, 0, 0);
    for (let i = n(4); i > 0; i--) {
      const a = rand(0, Math.PI * 2), o = rand(0.1, radius * 0.32);
      this.fireball(x + Math.cos(a) * o, rand(0.7, 1.5), z + Math.sin(a) * o, radius * rand(0.55, 0.95), rand(0.34, 0.5));
    }
    for (let i = n(30); i > 0; i--) {
      const a = rand(0, Math.PI * 2), s = rand(6, 24);
      this.spawn(x, 0.6, z, Math.cos(a) * s, rand(4, 16), Math.sin(a) * s, rand(0.28, 0.7), 0.2, 0.04, i % 3 ? FIRE : FIRE_HOT, 0, 18, 1.5, 0.035);
    }
    for (let i = n(22); i > 0; i--) {
      const a = rand(0, Math.PI * 2), s = rand(5, 18);
      this.shard(x, 0.7, z, Math.cos(a) * s, rand(5, 15), Math.sin(a) * s, i % 3 ? DEBRIS : FIRE_HOT, rand(0.8, 1.9));
    }
    // Ground shock: dust racing outward low across the floor.
    for (let i = n(18); i > 0; i--) {
      const a = (i / 18) * Math.PI * 2 + rand(-0.15, 0.15), s = rand(9, 15);
      this.spawn(x + Math.cos(a) * 0.8, 0.25, z + Math.sin(a) * 0.8, Math.cos(a) * s, rand(0.4, 1.2), Math.sin(a) * s,
        rand(0.5, 0.85), 0.5, radius * 0.5, this.dustRGB, 0.72, 0, 3.4);
    }
    // The smoke stack, darkest at the bottom, growing as it climbs.
    for (let i = n(16); i > 0; i--) {
      const a = rand(0, Math.PI * 2), s = rand(0.5, 3.2), up = rand(1.5, 5.5);
      this.spawn(x + Math.cos(a) * rand(0, 1.3), rand(0.5, 2.2), z + Math.sin(a) * rand(0, 1.3), Math.cos(a) * s, up, Math.sin(a) * s,
        rand(1.1, 2.3), radius * 0.28, radius * 1.05, i % 2 ? SMOKE : SMOKE_PALE, 0.86, -1.1, 1.6);
    }
    for (let i = n(14); i > 0; i--) {
      const a = rand(0, Math.PI * 2), s = rand(0.5, 4);
      this.spawn(x + rand(-1, 1), rand(0.6, 2.4), z + rand(-1, 1), Math.cos(a) * s, rand(3, 9), Math.sin(a) * s, rand(0.7, 1.5), 0.09, 0.015, FIRE_HOT, 0, 4, 1.4);
    }
    this.ring(x, z, radius * 0.2, radius * 1.7, 0.4, FIRE, 0.9);
    this.ring(x, z, radius * 0.1, radius * 2.2, 0.26, WHITE, 0.65);
    this.scorch(x, z, radius * 0.78);
    this.pop(x, 1.8, z, radius * 3.6, FIRE_POP, 0.3);
    this._after(0.11, x, z, radius, 1);
  }

  _after(t, x, z, r, kind) {
    const d = this.delayed[this.delayedHead];
    this.delayedHead = (this.delayedHead + 1) % DELAYED;
    d.t = t; d.x = x; d.z = z; d.r = r; d.kind = kind;
  }

  // Grenade: tighter and more violent than an airstrike explosion, with shrapnel.
  fragBurst(x, z, radius) {
    const n = v => this._n(v);
    this.spawn(x, 0.8, z, 0, 0, 0, 0.06, radius * 1.1, radius * 0.4, WHITE, 0, 0, 0);
    for (let i = n(22); i > 0; i--) {
      const a = rand(0, Math.PI * 2), s = rand(8, 28);
      this.spawn(x, 0.5, z, Math.cos(a) * s, rand(3, 12), Math.sin(a) * s, rand(0.22, 0.46), 0.16, 0.03, FIRE, 0, 18, 1.5, 0.04);
    }
    for (let i = n(20); i > 0; i--) {
      const a = rand(0, Math.PI * 2), s = rand(6, 18);
      this.shard(x, 0.6, z, Math.cos(a) * s, rand(4, 14), Math.sin(a) * s, GRENADE_SHARD, rand(0.5, 1.2));
    }
    for (let i = n(12); i > 0; i--) {
      const a = (i / 12) * Math.PI * 2, s = rand(7, 11);
      this.spawn(x + Math.cos(a) * 0.5, 0.22, z + Math.sin(a) * 0.5, Math.cos(a) * s, rand(0.3, 1), Math.sin(a) * s, rand(0.4, 0.65), 0.34, radius * 0.42, this.dustRGB, 0.62, 0, 3.4);
    }
    for (let i = n(8); i > 0; i--) {
      const a = rand(0, Math.PI * 2), s = rand(1, 4);
      this.spawn(x + Math.cos(a) * 0.5, 0.5, z + Math.sin(a) * 0.5, Math.cos(a) * s, rand(1, 3), Math.sin(a) * s, rand(0.6, 1.2), radius * 0.2, radius * 0.75, SMOKE, 0.75, -1.2, 1.8);
    }
    this.fireball(x, 0.8, z, radius * 0.85, 0.34);
    this.ring(x, z, radius * 0.2, radius * 1.3, 0.3, FIRE, 1);
    this.ring(x, z, radius * 0.1, radius * 1.8, 0.2, WHITE, 0.5);
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

  // Casing style from SHELL_LOOK; brass stays on the floor a little before it goes.
  shell(x, y, z, dirX, dirZ, kind = 'rifle') {
    const L = SHELL_LOOK[kind] || SHELL_LOOK.rifle;
    this._emitPhys(this.sh, x, y, z, dirX * rand(2.2, 4.2), rand(2.5, 4.5), dirZ * rand(2.2, 4.2), rand(1.3, 2.2), L.rgb, L.s * rand(1, 1.3));
  }

  // Spent magazine leaving the gun: heavier, flatter fall, no spin up.
  dropMag(x, y, z, rgb, size) {
    const s = Math.max(size[0], size[1], size[2]) / 0.22;
    this._emitPhys(this.sh, x, y, z, rand(-0.5, 0.5), rand(-0.4, 0.5), rand(-0.5, 0.5), 2.0, rgb, s);
  }

  shard(x, y, z, vx, vy, vz, rgb, scale = 0) {
    this._emitPhys(this.sd, x, y, z, vx, vy, vz, rand(0.7, 1.2), rgb, scale || rand(0.7, 1.5));
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

  // lenK stretches the star along the barrel, widK across it.
  muzzleFlash(x, y, z, aim, rgb, size, lenK = 1, widK = 1) {
    this._flash(x, y, z, aim, rgb, size, lenK, widK);
    this.spawn(x, y, z, 0, 0, 0, 0.06, size * 0.9, size * 0.5, rgb, 0, 0, 0);
  }

  // One star in the flash batch, with no glow of its own: the extra lobes of a shaped flash.
  _flash(x, y, z, aim, rgb, size, lenK, widK) {
    const P = this.fl, i = P.head;
    P.head = (i + 1) % FLASHES;
    P.x[i] = x; P.y[i] = y; P.z[i] = z;
    P.t[i] = 0.05; P.life[i] = 0.05;
    P.r[i] = rgb[0]; P.g[i] = rgb[1]; P.b[i] = rgb[2];
    P.scale[i] = size;
    P.qx[i] = aim;                 // Stored as yaw; flashes need no full orientation.
    P.spin[i] = rand(-0.6, 0.6);
    P.qy[i] = lenK; P.qz[i] = widK;
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

  fireball(x, y, z, radius, life = 0.38) {
    const P = this.bl, i = P.head;
    P.head = (i + 1) % BALLS;
    P.x[i] = x; P.y[i] = y; P.z[i] = z;
    P.t[i] = life; P.life[i] = life;
    P.scale[i] = radius;
    P.r[i] = 1; P.g[i] = 0.72; P.b[i] = 0.28;
  }

  /* ---------- Ground rings and scorch marks ---------- */
  _buildRings() {
    const sides = 28, pos = [], rad = [], off = [];
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
    g.setAttribute('aY', this.rY = dyn(1, RINGS));     // Height of the ring: ground, or water level in a basin.
    this.ringGeom = g;
    this.ringMat = new THREE.ShaderMaterial({
      ...PREMULT,
      vertexShader: `
        attribute float aR; attribute vec4 aP; attribute vec4 aC; attribute float aY;
        varying vec4 vC; varying float vR;
        void main(){
          float r = mix(aP.z, aP.w, aR);
          vec3 p = vec3(aP.x + position.x * r, aY, aP.y + position.z * r);
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
    for (const k of ['x', 'z', 'r0', 'r1', 't', 'life', 'cr', 'cg', 'cb', 'a', 'solid', 'y']) R[k] = new Float32Array(RINGS);
  }

  ring(x, z, r0, r1, life, rgb, a, y = 0.17) {
    const R = this.rg, i = R.head;
    R.head = (i + 1) % RINGS;
    R.x[i] = x; R.z[i] = z; R.r0[i] = r0; R.r1[i] = r1;
    R.t[i] = life; R.life[i] = life;
    R.cr[i] = rgb[0]; R.cg[i] = rgb[1]; R.cb[i] = rgb[2]; R.a[i] = a; R.solid[i] = 0; R.y[i] = y;
  }

  scorch(x, z, r) {
    const R = this.rg, i = R.head;
    R.head = (i + 1) % RINGS;
    R.x[i] = x; R.z[i] = z; R.r0[i] = 0; R.r1[i] = r;
    R.t[i] = 9; R.life[i] = 9;
    R.cr[i] = 0.05; R.cg[i] = 0.04; R.cb[i] = 0.05; R.a[i] = 0.65; R.solid[i] = 1; R.y[i] = 0.17;
  }

  // A one-frame ground ring appended after step(); used by the throw preview, costs nothing when idle.
  addRing(x, z, inner, outer, rgb, a) {
    const n = this.ringGeom.instanceCount;
    if (n >= RINGS) return;
    this.rP.setXYZW(n, x, z, inner, outer);
    this.rC.setXYZW(n, rgb[0] * a, rgb[1] * a, rgb[2] * a, 0);
    this.rY.setX(n, 0.19);
    this.ringGeom.instanceCount = n + 1;
  }

  /* ---------- Bullet marks on walls ---------- */
  _buildMarks() {
    const g = new THREE.InstancedBufferGeometry();
    // A small hexagon facing +Z, re-oriented in the shader to the wall normal.
    const pos = [];
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
      pos.push(0, 0, 0, Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.instanceCount = 0;
    g.setAttribute('aP', this.mP = dyn(4, MARKS));     // xyz, size
    g.setAttribute('aN', this.mN = dyn(4, MARKS));     // nx, nz, opacity, glow
    g.setAttribute('aC', this.mC = dyn(3, MARKS));
    this.markGeom = g;
    this.markMat = new THREE.ShaderMaterial({
      ...PREMULT,
      vertexShader: `
        attribute vec4 aP; attribute vec4 aN; attribute vec3 aC;
        varying vec3 vC; varying float vA; varying float vG;
        void main(){
          vec3 n = vec3(aN.x, 0.0, aN.y);
          vec3 u = normalize(cross(vec3(0.0, 1.0, 0.0), n));
          vec3 v = vec3(0.0, 1.0, 0.0);
          vec3 p = aP.xyz + (u * position.x + v * position.y) * aP.w;
          vC = aC; vA = aN.z; vG = aN.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vA; varying float vG;
        void main(){ gl_FragColor = vec4(vC * vA + vec3(1.0, 0.45, 0.12) * vG, vA); }`,
      side: THREE.DoubleSide,
    });
    this.markMesh = new THREE.Mesh(g, this.markMat);
    this.markMesh.frustumCulled = false;
    this.markMesh.renderOrder = 3;
    this.scene.add(this.markMesh);
    const M = this.mk = { head: 0 };
    for (const k of ['x', 'y', 'z', 'nx', 'nz', 's', 't', 'r', 'g', 'b', 'hot']) M[k] = new Float32Array(MARKS);
  }

  mark(x, y, z, nx, nz, size, rgb, hot) {
    const M = this.mk, i = M.head;
    M.head = (i + 1) % MARKS;
    M.x[i] = x; M.y[i] = y; M.z[i] = z; M.nx[i] = nx; M.nz[i] = nz; M.s[i] = size;
    M.t[i] = 9; M.r[i] = rgb[0]; M.g[i] = rgb[1]; M.b[i] = rgb[2]; M.hot[i] = hot;
  }

  _stepMarks(dt) {
    const M = this.mk;
    let n = 0;
    for (let i = 0; i < MARKS; i++) {
      if (M.t[i] <= 0) continue;
      M.t[i] -= dt;
      M.hot[i] = Math.max(0, M.hot[i] - dt * 2.2);
      const a = Math.min(1, M.t[i] / 1.5) * 0.85;
      this.mP.setXYZW(n, M.x[i], M.y[i], M.z[i], M.s[i]);
      this.mN.setXYZW(n, M.nx[i], M.nz[i], a, M.hot[i] * 0.9);
      this.mC.setXYZ(n, M.r[i], M.g[i], M.b[i]);
      n++;
    }
    this.markGeom.instanceCount = n;
    uploadUsed(this.mP, n); uploadUsed(this.mN, n); uploadUsed(this.mC, n);
  }

  /* ---------- Rockets: the launcher is hitscan in the sim, so the missile is a cosmetic racing its own blast ---------- */
  _buildRockets() {
    const b = new MeshBuilder();
    b.setColor(0xffffff).prismX(-0.42, 0.34, 0, 0, 0.09, 0.09, 6);
    b.prismX(0.34, 0.6, 0, 0, 0.09, 0.02, 6);
    b.prismX(-0.42, -0.3, 0, 0, 0.17, 0.08, 4);
    this.rocketMesh = this._makeSolid(b.build(), ROCKETS, 3);
    const K = this.rk = { head: 0 };
    for (const k of ['x', 'y', 'z', 'tx', 'ty', 'tz', 'dx', 'dy', 'dz', 't', 'boom', 'clock', 'phase']) K[k] = new Float32Array(ROCKETS);
  }

  rocket(x, y, z, tx, ty, tz) {
    const K = this.rk, i = K.head;
    K.head = (i + 1) % ROCKETS;
    const dist = Math.hypot(tx - x, ty - y, tz - z) || 1;
    K.x[i] = x; K.y[i] = y; K.z[i] = z; K.tx[i] = tx; K.ty[i] = ty; K.tz[i] = tz;
    K.dx[i] = (tx - x) / dist; K.dy[i] = (ty - y) / dist; K.dz[i] = (tz - z) / dist;
    K.t[i] = dist / ROCKET_SPEED; K.boom[i] = 0; K.clock[i] = 0; K.phase[i] = rand(0, 6.28);
  }

  // Claims a pending explosion for the rocket flying to it. False means the rocket already landed or never existed.
  rocketInbound(x, z, radius) {
    const K = this.rk;
    for (let i = 0; i < ROCKETS; i++) {
      if (K.t[i] <= 0 || K.boom[i] > 0) continue;
      if (Math.abs(K.tx[i] - x) < 3 && Math.abs(K.tz[i] - z) < 3) { K.boom[i] = radius; return true; }
    }
    return false;
  }

  _stepRockets(dt) {
    const K = this.rk, mesh = this.rocketMesh, e = mesh.instanceMatrix.array, aC = mesh.geometry.attributes.aC;
    let n = 0;
    for (let i = 0; i < ROCKETS; i++) {
      if (K.t[i] <= 0) continue;
      K.t[i] -= dt;
      K.clock[i] += dt;
      const dx = K.dx[i], dy = K.dy[i], dz = K.dz[i];
      if (K.t[i] <= 0) {
        if (K.boom[i] > 0 && this.onBoom) this.onBoom(K.tx[i], K.tz[i], K.boom[i]);
        continue;
      }
      const step = ROCKET_SPEED * dt;
      // A puff at least every half metre however slow the frame, so the trail never breaks up into beads.
      const puffs = Math.min(this.fxScale < 1 ? 5 : 12, Math.ceil(step / 0.3));
      for (let p = 0; p < puffs; p++) {
        const k = p / puffs, cl = K.clock[i] * 60 + K.phase[i] + p * 1.3;
        const cork = 0.05 + Math.min(1, K.clock[i] * 5) * 0.09;
        const px = K.x[i] + dx * step * k + Math.cos(cl) * cork, py = K.y[i] + dy * step * k + Math.sin(cl) * cork, pz = K.z[i] + dz * step * k - Math.sin(cl) * cork;
        this.spawn(px, py, pz, rand(-0.25, 0.25), rand(0.15, 0.7), rand(-0.25, 0.25), rand(0.4, 1.05), rand(0.2, 0.3), rand(0.42, 0.78), p % 2 ? SMOKE_PALE : STEAM, 0.72, -0.3, 1.6);
        if (p % 3 === 0) this.spawn(px, py, pz, rand(-1, 1), rand(-0.5, 1), rand(-1, 1), rand(0.09, 0.2), 0.28, 0.05, FIRE, 0, 0, 2.4);
      }
      K.x[i] += dx * step; K.y[i] += dy * step; K.z[i] += dz * step;
      const j = n * 16;
      // Rocket model forward is +X; build its basis from the flight direction.
      const lz = Math.hypot(dx, dz) || 1;
      const zx = -dz / lz, zy = 0, zz = dx / lz;
      const yx = zy * dz - zz * dy, yy = zz * dx - zx * dz, yz = zx * dy - zy * dx;
      e[j] = dx * 1.5; e[j + 1] = dy * 1.5; e[j + 2] = dz * 1.5; e[j + 3] = 0;
      e[j + 4] = yx * 1.5; e[j + 5] = yy * 1.5; e[j + 6] = yz * 1.5; e[j + 7] = 0;
      e[j + 8] = zx * 1.5; e[j + 9] = zy * 1.5; e[j + 10] = zz * 1.5; e[j + 11] = 0;
      e[j + 12] = K.x[i]; e[j + 13] = K.y[i]; e[j + 14] = K.z[i]; e[j + 15] = 1;
      aC.setXYZW(n, 0.62, 0.68, 0.48, 1);
      n++;
    }
    mesh.count = n;
    uploadUsed(mesh.instanceMatrix, n);
    uploadUsed(aC, n);
  }

  // Drawn after step() has packed everything: the engine glow rides the particle batch.
  _rocketGlow() {
    const K = this.rk;
    for (let i = 0; i < ROCKETS; i++) {
      if (K.t[i] <= 0) continue;
      this.addDot(K.x[i] - K.dx[i] * 0.7, K.y[i] - K.dy[i] * 0.7, K.z[i] - K.dz[i] * 0.7, 0.65 + Math.random() * 0.3, FIRE);
      this.addDot(K.x[i] - K.dx[i] * 0.9, K.y[i] - K.dy[i] * 0.9, K.z[i] - K.dz[i] * 0.9, 0.3, WHITE);
    }
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
    this.clock += dt;
    this.swirls = 0;
    this._stepSmokers(dt);
    this._stepDelayed(dt);
    this._stepTracers(dt);
    this._stepParticles(dt);
    this._stepPhys(this.sh, this.shellMesh, dt, true);
    this._stepPhys(this.sd, this.shardMesh, dt, false);
    this._stepFlashes(dt);
    this._stepBalls(dt);
    this._stepRings(dt);
    this._stepMarks(dt);
    this._stepRockets(dt);
    this._rocketGlow();
    for (let i = 0; i < MAX_POPS; i++) { const p = this.pops[i]; if (p.t > 0) p.t -= dt; }
  }

  _stepTracers(dt) {
    const T = this.tr;
    let n = 0;
    for (let i = 0; i < TRACERS; i++) {
      if (T.t[i] <= 0) continue;
      T.t[i] -= dt;
      const dur = T.dur[i], age = dur - T.t[i];
      const linger = T.linger[i], travel = Math.max(dur - linger, 1e-4);
      const headT = Math.min(1, age / travel);
      const tailLen = T.tail[i] / Math.max(T.len[i], 0.01);
      const tailT = Math.max(0, headT - tailLen * Math.min(1, age * 18));
      const fade = headT < 1 ? 1 : Math.max(0, T.t[i] / linger);
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

  // Last call before the frame is drawn: tracers, beams and one-frame dots have all been appended by now,
  // so this is where the batches learn how much of their buffers to send.
  flushTracers() {
    const n = this.tracerN;
    this.tracerGeom.instanceCount = n;
    uploadUsed(this.tA, n); uploadUsed(this.tB, n); uploadUsed(this.tC, n);
    const p = this.partGeom.instanceCount;
    uploadUsed(this.pP, p); uploadUsed(this.pC, p); uploadUsed(this.pA, p);
    const r = this.ringGeom.instanceCount;
    uploadUsed(this.rP, r); uploadUsed(this.rC, r); uploadUsed(this.rY, r);
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
    this.partGeom.instanceCount = n;      // Uploaded in flushTracers, after the frame's dots are appended.
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
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
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
    uploadUsed(mesh.instanceMatrix, n);
    uploadUsed(aC, n);
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
      const sl = sc * P.qy[i], sw = sc * P.qz[i];
      e[j] = ca * sl;  e[j + 1] = 0; e[j + 2] = sa * sl;  e[j + 3] = 0;
      e[j + 4] = 0;    e[j + 5] = sc; e[j + 6] = 0;       e[j + 7] = 0;
      e[j + 8] = -sa * sw; e[j + 9] = 0; e[j + 10] = ca * sw; e[j + 11] = 0;
      e[j + 12] = P.x[i]; e[j + 13] = P.y[i]; e[j + 14] = P.z[i]; e[j + 15] = 1;
      aC.setXYZW(n, P.r[i], P.g[i], P.b[i], 0.6 + k * 0.8);
      n++;
    }
    mesh.count = n;
    uploadUsed(mesh.instanceMatrix, n);
    uploadUsed(aC, n);
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
      aC.setXYZW(n, 1.0, 0.6 - age * 0.35, 0.2 - age * 0.16, a * 0.72);
      n++;
    }
    mesh.count = n;
    uploadUsed(mesh.instanceMatrix, n);
    uploadUsed(aC, n);
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
      this.rY.setX(n, R.y[i]);
      n++;
    }
    this.ringGeom.instanceCount = n;      // Uploaded in flushTracers: addRing can still append this frame.
  }

  dispose() {
    // An InstancedMesh owns its instance-matrix buffer: without mesh.dispose() it stays on the GPU for the whole session.
    for (const m of [this.shellMesh, this.shardMesh, this.flashMesh, this.ballMesh, this.rocketMesh]) { m.geometry.dispose(); m.dispose(); }
    for (const g of [this.tracerGeom, this.partGeom, this.ringGeom, this.markGeom]) g.dispose();
    for (const m of [this.tracerMat, this.partMat, this.solidMat, this.flashMat, this.ballMat, this.ringMat, this.markMat]) m.dispose();
    for (const m of [this.tracerMesh, this.partMesh, this.ringMesh, this.markMesh, this.shellMesh, this.shardMesh, this.flashMesh, this.ballMesh, this.rocketMesh]) this.scene.remove(m);
  }
}

const WATER = [0.72, 0.84, 0.98];
const MUZZLE_HOT = [1.0, 0.74, 0.32];
const SMOKE_PALE = [0.3, 0.29, 0.33];
const CONTRAIL = [0.8, 0.84, 0.92];
const DEBRIS = [0.2, 0.19, 0.2];
const FIRE_HOT = [1.0, 0.76, 0.3];
const GRENADE_SHARD = [0.82, 0.68, 0.5];
const FLASH_TINT = [0.82, 0.92, 1.0];
const FLASH_POP = [0.9, 0.96, 1.05];
const HEAD_GOLD = [1.0, 0.82, 0.22];
const GOLD = [1.0, 0.78, 0.22];
const GOLD_PALE = [1.0, 0.94, 0.62];
const GOLD_HALO = [0.9, 0.5, 0.04];
const HEAL = [0.3, 1.0, 0.56];
const STEAM = [0.72, 0.74, 0.78];
const WHITE = [1, 1, 1];
const SMOKE_STIR = [0.5, 0.5, 0.54];
const BARREL_SMOKE = [0.4, 0.4, 0.43];
const ARMOR_SPARK = [0.78, 0.9, 1.0];
const DUST = [0.42, 0.38, 0.36];
const SMOKE = [0.12, 0.11, 0.14];
const FIRE = [1.0, 0.5, 0.15];
const FIRE_POP = [0.95, 0.5, 0.22];
const FX_EMBER = [1.0, 0.42, 0.08];
const FX_EMBER_HOT = [1.0, 0.82, 0.3];
const FX_SHOCK = [0.35, 0.82, 1.0];
const FX_ICE = [0.5, 0.88, 1.0];
const FX_ICE_PALE = [0.85, 0.97, 1.0];
const FX_VOLT = [0.72, 0.42, 1.0];
const FX_VOID = [0.42, 0.2, 1.0];
const FX_PHOENIX = [1.0, 0.36, 0.06];
const FX_PHOENIX_TIP = [1.0, 0.8, 0.26];

