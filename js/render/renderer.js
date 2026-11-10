// Art engineer's public module: GameRenderer (the match view) and GunPreview (gunsmith, end card).
// GameRenderer.update is the only per-frame entry point; it allocates nothing once running.
import * as THREE from 'three';
import { TEAMS } from '../shared/constants.js';
import { getCamo } from '../shared/camos.js';
import { buildWorld } from './world.js';
import { Weather } from './weather.js';
import { FogMask, castRay } from './fog.js';
import { Characters } from './characters.js';
import { VFX, GUN_FX } from './vfx.js';
import { CombatFX, GUNSHIP_Y, CHOPPER_Y } from './combat.js';
import { Surfaces } from './surfaces.js';
import { Props } from './props.js';
import { Ambient } from './ambient.js';
import { getGun } from './guns.js';
import { hexRGB, setThemeLighting, getTheme } from './art.js';
import { createCamoMaterial, addCamoInstanceAttributes, camoIndex } from './camo-shader.js';
import { TUNING } from '../shared/tuning.js';   // Live feel tuning: camera kick, shake, ADS lookahead, zoom.

// weapons.js is owned by Gameplay and may be absent at first load, so never import it statically.
let WEAPONS = {};
import('../shared/weapons.js').then(m => { WEAPONS = m.WEAPONS || {}; }).catch(() => {});

// Shot effects for guns vfx.js has no entry for yet. Only fills gaps: an entry the VFX table already has always wins.
const GUN_FX_FALLBACK = {
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
  // Flies as a projectile like the rocket (see _onShot); this only shapes the muzzle flash.
  thumper:    { tail: 0,  linger: 0,     speed: 92,  flash: [1.8, 0.5, 1.6],   shell: null },
};
for (const id in GUN_FX_FALLBACK) if (!GUN_FX[id]) GUN_FX[id] = GUN_FX_FALLBACK[id];

// Kills from these hold the hit-stop a beat longer.
const BIG_KILL = new Set(['Sniper', 'Marksman', 'Launcher']);

const DEFAULT_KICK = { ar: 0.5, smg: 0.36, shotgun: 1.1, lmg: 0.7, sniper: 1.4, pistol: 0.45 };
const TRACER_BASE = 0.13;       // Metres of half-width for a weapon whose tracerWidth is 1.

function kickOf(id) {
  const k = WEAPONS[id] && WEAPONS[id].kickCam;
  return Number.isFinite(k) ? k : (DEFAULT_KICK[id] ?? 0.5);
}
function tracerWidthOf(id) {
  const k = WEAPONS[id] && WEAPONS[id].tracerWidth;
  return TRACER_BASE * (Number.isFinite(k) && k > 0 ? k : 1);
}

const TILT = THREE.MathUtils.degToRad(55);
const VFOV = 26;
const VIEW_WIDTH = 30;        // Metres of ground across the screen at the camera target.
const ADS_LOOK = 7.5;         // Metres of lookahead toward aim at full ADS.
const MAX_DPR = 2;
const MAX_DPR_LOW = 1.25;     // Low Power: a lower ceiling before dynamic resolution even starts.
const MIN_RES = 0.6;
const KICK_K = 240;           // Camera recoil spring: stiff with a little give, so heavy guns bounce once.
const KICK_C = 25;

const OVERLAY_VERT = `varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const OVERLAY_FRAG = /* glsl */`
uniform float uAlpha;
uniform float uFlash;
uniform float uTime;
uniform float uBars;
varying vec2 vP;
void main() {
  float d = length(vP * vec2(0.86, 1.0));
  float vignette = smoothstep(0.55, 1.15, d);
  float pulse = 0.78 + 0.22 * sin(uTime * 7.0);
  float a = vignette * uAlpha * pulse + uFlash * (0.35 + 0.65 * vignette);
  // Letterbox for replays; the wide edge blends the dark in so the bars feel like lens, not UI.
  if (uBars > 0.0 && abs(vP.y) > 1.0 - uBars) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float edge = uBars > 0.0 ? smoothstep(1.0 - uBars - 0.42, 1.0 - uBars, abs(vP.y)) * 0.42 : 0.0;
  a = max(a, edge);
  gl_FragColor = vec4(vec3(0.62, 0.02, 0.04) * (a - edge) , a * 0.92);
}`;

// Frequently needed colours as arrays, kept stable so the event path allocates nothing.
const TEAM_RGB = TEAMS.map(t => hexRGB(t.color));
const TINTS = new Map();
function tracerColor(camoId, team) {
  let t = TINTS.get(camoId);
  if (t === undefined) {
    const c = getCamo(camoId);
    t = c.tint !== undefined ? hexRGB(c.tint) : null;
    TINTS.set(camoId, t);
  }
  return t || TEAM_RGB[team] || TEAM_RGB[0];
}

const GUNSHIP_TRACER = [1.0, 0.42, 0.12];
const FIRE_SPARK = [1.0, 0.6, 0.2];
const TURRET_TRACER = [1.0, 0.72, 0.3];

// Cheap pseudo-noise for screen shake.
function wobble(t, seed) {
  return Math.sin(t * 91.7 + seed) * 0.6 + Math.sin(t * 57.3 + seed * 1.7) * 0.4;
}

// Matches reuse one canvas. A WebGLRenderer can never fully release itself (its state keeps a few empty textures per
// instance), so one instance lives with the canvas and each match only frees what it created.
const WEBGL_BY_CANVAS = new WeakMap();
function sharedWebGL(canvas) {
  let w = WEBGL_BY_CANVAS.get(canvas);
  if (!w) {
    w = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, depth: true, powerPreference: 'high-performance' });
    WEBGL_BY_CANVAS.set(canvas, w);
  }
  return w;
}

export class GameRenderer {
  // opts.dynamicRes (default true) can be disabled for repeatable screenshots.
  constructor(canvas, map, opts = {}) {
    this.canvas = canvas;
    this.map = map;
    this.localId = null;
    this.dynamicRes = opts.dynamicRes !== false;

    const webgl = sharedWebGL(canvas);
    this.webgl = webgl;
    webgl.autoClear = true;
    const theme = getTheme(map.theme);
    setThemeLighting(theme.id);         // Programs compile lazily, so this lights all of this match.
    webgl.setClearColor(theme.clear, 1);
    webgl.info.autoReset = false;       // One frame spans the fog pass and the main pass.
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.resScale = 1;
    webgl.setPixelRatio(this.basePixelRatio);

    this.fog = new FogMask(map, webgl);
    this.time = { value: 0 };

    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.camera = new THREE.PerspectiveCamera(VFOV, 2, 3, 140);
    this.camera.matrixAutoUpdate = true;

    const world = buildWorld(map, TEAMS, this.fog.uniforms);
    this.world = world;
    this.scene.add(world.group);
    this.weather = new Weather(this.scene, theme);
    this.chars = new Characters(this.scene, map, this.time);
    this.vfx = new VFX(this.scene);
    this.combat = new CombatFX(this.scene, this.vfx, map, this.time);
    this.surf = new Surfaces(map);
    this.vfx.surf = this.surf;
    this.vfx.setTheme(theme);
    this.vfx.onBoom = (x, z, r) => this._boom(x, z, r);
    this.chars.vfx = this.vfx;
    this.chars.surf = this.surf;
    this.props = new Props(this.scene, map, theme, this.fog.uniforms, this.vfx);
    this.ambient = new Ambient(this.scene, map, theme, world, this.fog.uniforms, this.vfx, this.weather, this.surf);
    for (const child of this.scene.children) child.updateMatrixWorld(true);

    this.visionWalls = map.walls.filter(w => w.blocksVision);
    this.bulletWalls = map.walls.filter(w => w.blocksBullet);

    // Overlay for low HP and damage. A clip-space triangle, so it needs no camera.
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.overlayU = { uAlpha: { value: 0 }, uFlash: { value: 0 }, uTime: this.time, uBars: { value: 0 } };
    this.overlay = new THREE.Mesh(og, new THREE.ShaderMaterial({
      vertexShader: OVERLAY_VERT, fragmentShader: OVERLAY_FRAG, uniforms: this.overlayU,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.overlay.frustumCulled = false;
    this.overlay.renderOrder = 1000;
    this.overlay.visible = false;
    this.scene.add(this.overlay);

    // Camera state.
    this.camTarget = new THREE.Vector3(map.width / 2, 0, map.height / 2);
    this.lookX = 0; this.lookZ = 0;
    this.trauma = 0;
    this.kickX = 0; this.kickZ = 0;
    this.kickVX = 0; this.kickVZ = 0;
    this.roll = 0; this.rollV = 0;
    this.zoomPunch = 0;
    this.camEase = 0;             // Sprint pulls the camera back a touch, ADS pushes it in.
    this.distance = 30;

    // Cosmetic effects timers.
    this.hitStop = 0;             // Seconds of near-freeze left. Visual only: the sim never hears about it.
    this.hitEase = 0;
    this.timeScale = 1;
    this.cine = null;             // Killcam shot description, or null during normal play.
    this.bars = 0;
    this.lowPower = false;
    this.fogFrame = 0;
    this.autoLowWindows = 0;
    this.raisedAt = -999;         // Clock of the last resolution raise, to detect one that did not hold.
    this.raiseWait = 3;           // Good windows required before raising again; backs off after a failed raise.
    this._killInfo = { dirX: 0, dirZ: 0, weapon: 'ar', head: false, explosive: false };
    this.desat = 0;
    this.hurt = 0;
    this.finalKill = null;
    this.frameStats = { calls: 0, triangles: 0, dpr: 0, geometries: 0, programs: 0, lowPower: false };

    this._laserRGB = [0, 0, 0];
    this._charOpts = { localId: null, localTeam: 0, uav: false, revealAll: false };   // Reused every frame.
    this._hotRGB = [0, 0, 0];
    this.steamClock = 0;
    this.frameAcc = 0;
    this.frameCount = 0;
    this.upStreak = 0;

    this.resize();
  }

  setLocal(id) {
    this.localId = id;
    this.fog.reset();
  }

  resize() {
    const c = this.canvas;
    const w = Math.max(1, c.clientWidth || window.innerWidth);
    const h = Math.max(1, c.clientHeight || window.innerHeight);
    this.cssW = w; this.cssH = h;
    this._applyRes();
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // Distance that shows VIEW_WIDTH metres across the screen, whatever the aspect ratio.
    const halfW = Math.tan(THREE.MathUtils.degToRad(VFOV / 2)) * aspect;
    this.distance = (VIEW_WIDTH / 2) / halfW;
  }

  _applyRes() {
    this.webgl.setPixelRatio(this.basePixelRatio * this.resScale);
    this.webgl.setSize(this.cssW, this.cssH, false);
  }

  // Low Power: fewer pixels and thinner effects, for phones that cannot hold 60 even at minimum resolution.
  // 'auto' lets dynamic resolution decide; 'high' and 'low' pin the level.
  setQuality(q) {
    this.qualityPin = q;
    if (q === 'low') this.setLowPower(true);
    else if (q === 'high') { this.setLowPower(false); this.dynamicRes = false; }
    else { this.setLowPower(false); this.dynamicRes = true; }
  }

  setLowPower(on) {
    on = !!on;
    if (on === this.lowPower) return;
    this.lowPower = on;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, on ? MAX_DPR_LOW : MAX_DPR);
    this.vfx.fxScale = on ? 0.5 : 1;
    this.weather.setDensity(on ? 0.45 : 1);
    this.ambient.setLowPower(on);
    this._applyRes();
  }

  // Lowers the internal resolution when frames run long, restores it slowly when there is headroom.
  // Changing the drawing buffer is itself a hitch, so a raise that does not hold makes the next one wait longer.
  _adjustResolution(dt) {
    if (!this.dynamicRes) return;
    // A tab switch or GC pause says nothing about sustained GPU load.
    if (dt > 0.12) return;
    this.frameAcc += dt;
    this.frameCount++;
    if (this.frameAcc < 0.6) return;
    const avg = this.frameAcc / this.frameCount;
    this.frameAcc = 0;
    this.frameCount = 0;
    if (avg > 1 / 50) {
      this.upStreak = 0;
      if (this.resScale > MIN_RES) {
        if (this.time.value - this.raisedAt < 6) this.raiseWait = Math.min(40, this.raiseWait * 2);
        this.resScale = Math.max(MIN_RES, this.resScale * 0.9);
        this._applyRes();
      } else if (avg > 1 / 45 && ++this.autoLowWindows >= 4) {
        this.autoLowWindows = 0;
        this.setLowPower(true);
      }
    } else if (avg < 1 / 58) {
      this.autoLowWindows = 0;
      if (this.resScale < 1 && ++this.upStreak >= this.raiseWait) {
        this.upStreak = 0;
        this.raisedAt = this.time.value;
        this.resScale = Math.min(1, this.resScale * 1.05);
        this._applyRes();
      }
    } else {
      this.upStreak = 0;
    }
  }

  _handleEvents(events, localId, localTeam) {
    const { vfx, chars } = this;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.t) {
        case 'shot': this._onShot(ev, localId, localTeam); break;
        case 'hit': {
          const r = chars.rigs.get(ev.target);
          if (r && (r.visible || r.team === localTeam)) {
            vfx.bodyHit(ev.x, ev.z, TEAM_RGB[r.team] || TEAM_RGB[0]);
            if (ev.head) vfx.headBurst(ev.x, ev.z);
            this._pushDir(ev.by, r.x, r.z);
            chars.onHit(ev.target, this._dx, this._dz, Math.min(1, (ev.dmg || 25) / 40));
          }
          if (ev.target === localId) { this.trauma = Math.min(1, this.trauma + 0.4); this.hurt = 1; }
          break;
        }
        case 'kill': {
          const r = chars.rigs.get(ev.target);
          // A view can report the death in the very frame the event lands, so "drawn a moment ago" counts as seen.
          const seen = r && (r.visible || r.team === localTeam || Math.abs(this.time.value - r.posed) < 0.2);
          if (seen) {
            const K = this._killInfo;
            this._pushDir(ev.by, r.x, r.z);
            K.dirX = this._dx; K.dirZ = this._dz; K.weapon = ev.weapon; K.head = !!ev.head;
            K.explosive = !!(WEAPONS[ev.weapon] && WEAPONS[ev.weapon].explosive) || ev.weapon === 'launcher' || !!ev.streak || (!!ev.equip && ev.equip !== 'flash');
            chars.onKill(ev.target, K);
            vfx.deathBurst(ev.x, ev.z, TEAM_RGB[r.team] || TEAM_RGB[0]);
            if (ev.head) vfx.headBurst(ev.x, ev.z);
            vfx.killEffect(ev.by, ev.x, ev.z);
          }
          if (ev.by === localId && ev.target !== localId && !this.cine) {
            // The kill freezes the picture for a few frames; bigger guns and headshots hold it longer.
            const big = BIG_KILL.has(WEAPONS[ev.weapon] && WEAPONS[ev.weapon].category) || ev.weapon === 'revolver';
            this.hitStop = 0.05 + (ev.head ? 0.03 : 0) + (big ? 0.04 : 0);
            this.hitEase = 0.17;
            this.zoomPunch = Math.max(this.zoomPunch, 0.05 + (ev.head ? 0.02 : 0));
            this.trauma = Math.min(1, this.trauma + 0.25);
          }
          break;
        }
        case 'explosion': {
          // A launcher's blast waits for its rocket to get there.
          if (!vfx.rocketInbound(ev.x, ev.z, ev.radius || 4)) this._boom(ev.x, ev.z, ev.radius || 4);
          break;
        }
        case 'spawn': {
          const r = chars.rigs.get(ev.id);
          vfx.spawnFx(ev.x, ev.z, (r && TEAM_RGB[r.team]) || TEAM_RGB[0]);
          if (ev.id === localId) this.fog.reset();
          break;
        }
        case 'slide': {
          const r = chars.rigs.get(ev.id);
          if (r && r.visible) vfx.slideDust(r.x, r.z);
          break;
        }
        case 'swap': chars.onSwap(ev.id); break;
        case 'throw': chars.onThrow(ev.id, ev.kind); break;
        case 'bang': {
          if (ev.kind === 'flash') vfx.flashBurst(ev.x, ev.z, ev.r || 7);
          else if (ev.kind !== 'smoke') { vfx.fragBurst(ev.x, ev.z, ev.r || 4.5); if (!this.cine) this.props.blast(ev.x, ev.z, (ev.r || 4.5) * 0.8); }
          this.ambient.startle(ev.x, ev.z, 16);
          const me = chars.rigs.get(localId);
          if (me) {
            const d = Math.hypot(me.x - ev.x, me.z - ev.z);
            this.trauma = Math.min(1, this.trauma + Math.max(0, 1 - d / 16) * (ev.kind === 'flash' ? 0.35 : 0.8));
          }
          break;
        }
        case 'heal': {
          const r = chars.rigs.get(ev.id);
          if (r && (r.visible || r.team === localTeam)) vfx.healBurst(r.x, r.z);
          break;
        }
        case 'overheat': {
          const r = chars.rigs.get(ev.id);
          if (r && r.visible) vfx.steam(r.muzzle[0], r.muzzle[1], r.muzzle[2], 14);
          break;
        }
        case 'turret': vfx.turretDrop(ev.x, ev.z, TEAM_RGB[ev.team] || TEAM_RGB[0]); break;
        case 'turret_down': vfx.fragBurst(ev.x, ev.z, 2.2); break;
        case 'phase': if (ev.phase === 'ended') this.hitStop = 0; break;
        case 'turret_shot': {
          vfx.tracer(ev.ox, 1.0, ev.oz, ev.x, 1.05, ev.z, TURRET_TRACER, 0.1);
          vfx.sparks(ev.x, 0.6, ev.z, 0, 0, FIRE_SPARK, 2, 6);
          break;
        }
        case 'gunship_shot': {
          vfx.tracer(ev.ox, ev.kind === 'chopper' ? CHOPPER_Y - 0.4 : GUNSHIP_Y, ev.oz, ev.x, 1.05, ev.z, GUNSHIP_TRACER, 0.16);
          vfx.sparks(ev.x, 0.5, ev.z, 0, 0, FIRE_SPARK, 4, 8);
          vfx.pop(ev.x, 1.2, ev.z, 3, GUNSHIP_TRACER, 0.1);
          break;
        }
        default: break;
      }
    }
  }

  // Unit direction from a shooter's rig to a point, in _dx/_dz; falls back to no push if the shooter is unknown.
  _pushDir(byId, x, z) {
    const r = this.chars.rigs.get(byId);
    let dx = r ? x - r.x : 0, dz = r ? z - r.z : 0;
    const l = Math.hypot(dx, dz);
    if (l > 0.01) { dx /= l; dz /= l; } else { dx = 0; dz = 0; }
    this._dx = dx; this._dz = dz;
  }

  _boom(x, z, radius) {
    this.vfx.explosion(x, z, radius);
    if (!this.cine) this.props.blast(x, z, radius);
    this.ambient.startle(x, z, 24);
    const me = this.chars.rigs.get(this.localId);
    if (me && !this.cine) {
      const d = Math.hypot(me.x - x, me.z - z);
      this.trauma = Math.min(1, this.trauma + Math.max(0, 1 - d / 18) * 0.85);
      if (d < 12) this.zoomPunch = Math.max(this.zoomPunch, 0.04);
    }
  }

  _onShot(ev, localId, localTeam) {
    const { vfx, chars } = this;
    const r = chars.rigs.get(ev.by);
    const team = r ? r.team : 0;
    let rgb = vfx.tracerRGB(ev.by, tracerColor(ev.camo, team));
    const visible = !r || r.visible || team === localTeam;
    const kick = kickOf(ev.weapon);
    const G = GUN_FX[ev.weapon] || GUN_FX.ar;
    // A hot barrel throws hotter tracers: the colour pushes to white-gold and the streak fattens.
    const heat = r && r.heat > 0.05 ? r.heat : 0;

    let mx, my, mz;
    if (r) { mx = r.muzzle[0]; my = r.muzzle[1]; mz = r.muzzle[2]; }
    else { mx = ev.ox; my = 1.2; mz = ev.oz; }
    // Hugging a wall, the barrel reaches through it. The round left from the body (that is what the sim traced),
    // so tracer and flash start there instead of on the far side of the wall.
    if (r && this._wallBetween(ev.ox, ev.oz, mx, mz)) { mx = ev.ox; mz = ev.oz; }

    let width = tracerWidthOf(ev.weapon) * (1 + heat * 0.75);
    if (G.every && r) {
      // Belt-fed: every few rounds is a fat tracer among thinner ball.
      r.tracerClock = (r.tracerClock || 0) + 1;
      if (r.tracerClock % G.every === 0) width *= 1.6; else width *= 0.7;
    }
    if (heat > 0) {
      const hot = this._hotRGB, k = heat * heat;
      hot[0] = rgb[0] + (1 - rgb[0]) * k;
      hot[1] = rgb[1] + (0.82 - rgb[1]) * k;
      hot[2] = rgb[2] + (0.42 - rgb[2]) * k;
      rgb = hot;
    }
    const fx = this.camTarget.x, fz = this.camTarget.z;
    const rays = ev.rays;
    const explosive = ev.weapon === 'launcher' || !!(WEAPONS[ev.weapon] && WEAPONS[ev.weapon].explosive);
    if (rays) {
      const fine = rays.length > 3;
      for (let i = 0; i < rays.length; i++) {
        const ray = rays[i];
        // Explosive rounds fly as a projectile; the blast waits for it to arrive (see 'explosion').
        if (explosive) vfx.rocket(mx, my, mz, ray.x, 1.05, ray.z);
        else {
          vfx.tracer(mx, my, mz, ray.x, 1.05, ray.z, rgb, width, G.tail, G.linger, G.speed);
          if (G.contrail) vfx.contrail(mx, my, mz, ray.x, 1.05, ray.z);
          if (!this.cine) this.props.hitRay(ev.ox, ev.oz, ray.x, ray.z);
          if (Math.abs(ray.x - fx) < 26 && Math.abs(ray.z - fz) < 18) {
            if (ray.hit === 'wall') vfx.wallHit(ray.x, ray.z, ray.nx || 0, ray.nz || 0, fine);
            else if (ray.hit === 'none' && !fine) vfx.groundHit(ray.x, ray.z);
          }
        }
      }
    }
    this.ambient.startle(ev.ox, ev.oz, 7);

    if (visible) {
      vfx.shotFx(ev.weapon, mx, my, mz, ev.aim, rgb, !!ev.sup, r);
      vfx.pop(mx, 1.4, mz, 5 + kick * 2.2, rgb, 0.09);
    }

    chars.onShot(ev.by, kick);

    if (ev.by === localId) {
      const k = 5.2 * kick * TUNING.camKick;
      this.kickVX -= Math.cos(ev.aim) * k;
      this.kickVZ -= Math.sin(ev.aim) * k;
      this.rollV += (ev.aim > 0 ? 1 : -1) * kick * 0.08 * (0.6 + Math.random());
      this.trauma = Math.min(1, this.trauma + 0.1 * kick);
      this.zoomPunch = Math.max(this.zoomPunch, 0.014 * kick * TUNING.camKick);
    }
  }

  _updateCamera(dt, local) {
    const map = this.map;
    const cam = this.camera;
    const t = this.time.value;
    this.trauma = Math.max(0, this.trauma - dt * 2.4);
    const shake = this.trauma * this.trauma;

    // Replays hand the camera to the killcam's description of the shot.
    if (this.cine) {
      const c = this.cine;
      if (cam.fov !== c.fov || cam.near !== 0.5) { cam.fov = c.fov; cam.near = 0.5; cam.far = 170; cam.updateProjectionMatrix(); }
      const sx = wobble(t, 1.3) * shake * 0.4, sy = wobble(t, 2.9) * shake * 0.3, sz = wobble(t, 4.1) * shake * 0.4;
      cam.position.set(c.px + sx, c.py + sy, c.pz + sz);
      cam.lookAt(c.tx, c.ty, c.tz);
      if (c.roll) cam.rotateZ(c.roll);
      cam.updateMatrixWorld();
      return;
    }
    if (cam.fov !== VFOV || cam.near !== 3) { cam.fov = VFOV; cam.near = 3; cam.far = 140; cam.updateProjectionMatrix(); }

    let tx = this.camTarget.x, tz = this.camTarget.z;
    if (this.finalKill) {
      const f = this.finalKill;
      f.t += dt;
      const r = this.chars.rigs.get(f.by);
      if (r) { f.x = r.x; f.z = r.z; }
      const k = 1 - Math.exp(-f.t * 2.2);
      tx += (f.x - tx) * Math.min(1, dt * 5);
      tz += (f.z - tz) * Math.min(1, dt * 5);
      this.zoomPunch = 0.42 * k;
    } else if (local) {
      const aimX = Math.cos(local.aim), aimZ = Math.sin(local.aim);
      const ads = local.adsT || 0;
      const leadX = aimX * TUNING.camLook * ads, leadZ = aimZ * TUNING.camLook * ads * 0.85;
      this.lookX += (leadX - this.lookX) * Math.min(1, dt * 9);
      this.lookZ += (leadZ - this.lookZ) * Math.min(1, dt * 9);
      tx = local.x + this.lookX;
      tz = local.z + this.lookZ;
    }

    // Keep the view inside the dressed area of the map.
    tx = Math.max(10, Math.min(map.width - 10, tx));
    tz = Math.max(2, Math.min(map.height - 2, tz));
    this.camTarget.x = tx; this.camTarget.z = tz;
    this.chars.focusX = tx; this.chars.focusZ = tz;

    const sx = wobble(t, 1.3) * shake * 0.55 * TUNING.camShake;
    const sz = wobble(t, 4.1) * shake * 0.55 * TUNING.camShake;

    // Recoil on a spring, so a heavy gun overshoots once and settles instead of decaying flat.
    this.kickVX += (-KICK_K * this.kickX - KICK_C * this.kickVX) * dt;
    this.kickVZ += (-KICK_K * this.kickZ - KICK_C * this.kickVZ) * dt;
    this.kickX += this.kickVX * dt;
    this.kickZ += this.kickVZ * dt;
    this.rollV += (-160 * this.roll - 18 * this.rollV) * dt;
    this.roll += this.rollV * dt;
    if (!this.finalKill) this.zoomPunch *= Math.exp(-dt * 9);

    const easeGoal = local ? (local.sprinting ? 0.035 : 0) - (local.adsT || 0) * 0.025 : 0;
    this.camEase += (easeGoal - this.camEase) * Math.min(1, dt * 5);
    const dist = this.distance * TUNING.camZoom * (1 - this.zoomPunch + this.camEase);
    const cx = tx + sx + this.kickX, cz = tz + sz + this.kickZ;
    cam.position.set(cx, dist * Math.sin(TILT), cz + dist * Math.cos(TILT));
    cam.lookAt(cx, 0, cz);
    if (this.roll) cam.rotateZ(this.roll);
    cam.updateMatrixWorld();
  }

  // Barrel glow at the muzzle, and steam for as long as a gun is locked up.
  _heatFx(view, dt, localTeam) {
    this.steamClock += dt;
    const puff = this.steamClock >= 0.06;
    if (puff) this.steamClock = 0;
    const { vfx, chars } = this;
    for (let i = 0; i < view.players.length; i++) {
      const p = view.players[i];
      if (!p.alive || (p.heat ?? 0) < 0.15) continue;
      const r = chars.rigs.get(p.id);
      if (!r || !(r.visible || r.team === localTeam)) continue;
      const k = p.heat;
      const rgb = this._hotRGB;
      rgb[0] = 1; rgb[1] = 0.28 + 0.62 * k * k; rgb[2] = 0.04 + 0.5 * k * k;
      vfx.addDot(r.muzzle[0], r.muzzle[1], r.muzzle[2], 0.1 + k * 0.32, rgb);
      if (p.overheated && puff) vfx.steam(r.muzzle[0], r.muzzle[1], r.muzzle[2], 2);
    }
  }

  // True when a bullet-blocking wall lies between a shooter's body (ox, oz) and its muzzle.
  _wallBetween(ox, oz, mx, mz) {
    const dx = mx - ox, dz = mz - oz, l = Math.hypot(dx, dz);
    if (l < 1e-4) return false;
    return castRay(this.bulletWalls, ox, oz, dx / l, dz / l, l) < l - 1e-4;
  }

  // Beam from the local muzzle, ending at the first bullet-blocking wall.
  _drawLaser(local) {
    const ads = local && local.alive ? local.adsT : 0;
    if (!ads || ads < 0.02) return;
    const rig = this.chars.rigs.get(local.id);
    if (!rig) return;
    const aimX = Math.cos(local.aim), aimZ = Math.sin(local.aim);
    let mx = rig.muzzle[0], mz = rig.muzzle[2];
    const my = rig.muzzle[1];
    if (this._wallBetween(local.x, local.z, mx, mz)) { mx = local.x; mz = local.z; }
    const t = castRay(this.bulletWalls, mx, mz, aimX, aimZ, 45);
    const ex = mx + aimX * t, ez = mz + aimZ * t;
    const rgb = this._laserRGB;
    rgb[0] = 1.0 * ads; rgb[1] = 0.12 * ads; rgb[2] = 0.14 * ads;
    this.vfx.addBeam(mx, my, mz, ex, 1.05, ez, rgb, 0.03 + 0.035 * ads);
    this.vfx.addDot(ex, 1.05, ez, 0.16 + ads * 0.14, rgb);
  }

  update(view, events, dt) {
    const webgl = this.webgl;
    webgl.info.reset();
    const realDt = Math.min(dt, 0.05);
    this.time.value = (this.time.value + realDt) % 3600;
    const cine = this.cine;

    // Hit-stop and final-kill slowdown: never touches gameplay state, only how effects and animation advance.
    let scale = 1;
    if (this.hitStop > 0) { this.hitStop -= realDt; scale = 0.04; }
    else if (this.hitEase > 0) { this.hitEase -= realDt; scale = 0.04 + 0.96 * (1 - Math.max(0, this.hitEase) / 0.17); }
    if (this.finalKill) {
      const k = Math.min(1, this.finalKill.t / 1.1);
      scale = Math.min(scale, 1 - 0.76 * k);
    }
    if (cine) scale = cine.rate;
    this.timeScale = scale;
    const fxDt = realDt * scale;

    // During a replay the view belongs to the past, so nothing in it is treated as "you".
    const localId = cine ? null : (this.localId !== null ? this.localId : view.localId);
    let local = null;
    if (localId !== null) for (let i = 0; i < view.players.length; i++) if (view.players[i].id === localId) { local = view.players[i]; break; }
    const localTeam = local ? local.team : 0;
    const uav = !!(view.uav && view.uav[localTeam] > 0);

    const opts = this._charOpts;
    opts.localId = localId; opts.localTeam = localTeam; opts.uav = uav; opts.revealAll = !!this.finalKill || !!cine;
    this.chars.update(view, fxDt, opts);
    this._handleEvents(events, localId, localTeam);
    this.combat.onEvents(events, localId, localTeam);
    this.vfx.step(fxDt);
    this.combat.smokeAlpha = cine ? 0.16 : 1;
    this.combat.update(view, fxDt, local ? local.x : 0, local ? local.z : 0, localTeam, uav, !!local);
    this._heatFx(view, fxDt, localTeam);
    if (!this.finalKill && !cine) this._drawLaser(local);
    this.ambient.update(fxDt, this.camTarget.x, this.camTarget.z);
    if (this.ambient.strikeNow && !cine) this.trauma = Math.min(1, this.trauma + 0.3);
    this.props.update(fxDt, view.players, this.camTarget.x, this.camTarget.z, !cine);
    this.vfx.flushTracers();
    this.vfx.applyPops(this.world.material);

    // Low-HP tint below 45%, damage flash, and desaturation while dead.
    const hp = local ? local.hp : 100;
    const alive = !local || local.alive;
    const low = alive ? Math.max(0, 1 - hp / 45) : 0;
    this.hurt = Math.max(0, this.hurt - realDt * 3.4);
    this.overlayU.uAlpha.value = low * 0.72;
    this.overlayU.uFlash.value = this.hurt * 0.3;
    this.bars += ((cine ? cine.bars : 0) - this.bars) * Math.min(1, realDt * 9);
    if (this.bars < 0.001) this.bars = 0;
    this.overlayU.uBars.value = this.bars;
    this.overlay.visible = low > 0.001 || this.hurt > 0.001 || this.bars > 0;
    const desatGoal = cine ? cine.desat : (!alive && !this.finalKill ? 0.8 : 0);
    this.desat += (desatGoal - this.desat) * Math.min(1, realDt * 6);
    this.world.material.uniforms.uDesat.value = this.desat;

    const fogOn = this.finalKill || cine ? 0 : 1;
    this.fog.uniforms.on.value += (fogOn - this.fog.uniforms.on.value) * Math.min(1, realDt * 6);

    if (local) {
      // Low Power refreshes the vision mask every other frame; the temporal blend hides the difference.
      this.fogFrame = (this.fogFrame + 1) & 1;
      if (!this.lowPower || this.fogFrame === 0) this.fog.update(local.x, local.z, this.lowPower ? realDt * 2 : realDt, view.smokes);
    } else if (!cine) this.fog.uniforms.on.value = 0;

    this._updateCamera(realDt, local);
    this.world.update(fxDt);
    this.weather.update(fxDt, this.camTarget.x, this.camTarget.z, this.world.material);
    webgl.render(this.scene, this.camera);

    this._adjustResolution(dt);
    this.frameStats.calls = webgl.info.render.calls;
    this.frameStats.triangles = webgl.info.render.triangles;
    this.frameStats.dpr = this.basePixelRatio * this.resScale;
    this.frameStats.geometries = webgl.info.memory.geometries;
    this.frameStats.programs = webgl.info.programs ? webgl.info.programs.length : 0;
    this.frameStats.lowPower = this.lowPower;
  }

  // Killcam entry point. `shot` describes the camera and timing, or null to return to live play.
  // A cut in either direction drops whatever effects were in the air from the other timeline.
  setCinematic(shot) {
    const was = this.cine;
    this.cine = shot;
    if (!!was !== !!shot) {
      this.vfx.clear();
      this.chars.resetTransient();
      this.combat.reset();
      if (!shot) this.fog.reset();
      this.trauma = 0; this.kickX = 0; this.kickZ = 0; this.kickVX = 0; this.kickVZ = 0;
      this.roll = 0; this.rollV = 0; this.zoomPunch = 0; this.hitStop = 0; this.hitEase = 0;
    }
  }

  // Lets a replay add a jolt on the kill.
  addShake(a) { this.trauma = Math.min(1, this.trauma + a); }

  // Render budget readout for the demo and profiling.
  getStats() { return this.frameStats; }

  // End-of-match: push in on the killer and ease time down. lastKill is view.lastKill.
  playFinalKill(lastKill) {
    if (!lastKill) return;
    const r = this.chars.rigs.get(lastKill.by);
    this.finalKill = {
      by: lastKill.by,
      x: r ? r.x : lastKill.x,
      z: r ? r.z : lastKill.z,
      t: 0,
    };
  }

  dispose() {
    this.chars.dispose();
    this.vfx.dispose();
    this.combat.dispose();
    this.props.dispose();
    this.ambient.dispose();
    this.fog.dispose();
    this.world.group.traverse(o => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    this.overlay.geometry.dispose();
    this.overlay.material.dispose();
    this.weather.dispose();
    setThemeLighting('railyard');       // Menus and gun previews compiled afterwards use the default rig.
    this.webgl.renderLists.dispose();   // Lets go of this match's objects; the renderer itself stays for the next.
  }
}

// Turntable for one gun, for the gunsmith and end card. One instance is enough for the whole menu layer:
// the canvas can be re-parented between screens, and each show() only rebuilds what changed.
const KICK_DECAY = 7;
const FRAME_EASE = 9;

export class GunPreview {
  constructor(canvas) {
    this.canvas = canvas;
    const webgl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: false });
    this.webgl = webgl;
    webgl.setClearColor(0x000000, 0);
    webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    this.time = { value: 0 };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(22, 2, 0.1, 40);
    this.material = createCamoMaterial(this.time);
    this.mesh = null;
    this.spin = 0;
    this.kick = 0;              // Fitting a part gives the gun a short shove so the change is felt.
    this.modelKey = '';
    this.gunKey = '';
    this.w = 0; this.h = 0;
    this.centre = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.gunW = 1; this.gunH = 1;
    this.fitDist = 2.2;
    this.dist = 0;
    this.show('ar', 'none');
  }

  // attachments: a kit { optic?, barrel?, mag?, grip? }, optional. Changing only the camo re-uses the model.
  show(weaponId, camoId, attachments) {
    const gun = getGun(weaponId, attachments);
    const key = gun.key ?? weaponId;
    if (key !== this.modelKey) {
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.dispose();
      }
      const geom = gun.geometry.clone();
      addCamoInstanceAttributes(geom, 1);
      this.mesh = new THREE.InstancedMesh(geom, this.material, 1);
      this.mesh.setMatrixAt(0, new THREE.Matrix4());
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
      geom.computeBoundingBox();
      const box = geom.boundingBox;
      this.goal.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
      this.gunW = box.max.x - box.min.x;
      this.gunH = box.max.y - box.min.y;
      // Same gun, new part: ease the framing and shove the model. A different gun cuts straight to its frame.
      if (weaponId === this.gunId && this.modelKey) this.kick = 1;
      else { this.centre.copy(this.goal); this.dist = 0; }
      this.gunId = weaponId;
      this.modelKey = key;
    }
    const geom = this.mesh.geometry;
    geom.getAttribute('aCamo').setX(0, camoIndex(camoId));
    geom.getAttribute('aCamo').needsUpdate = true;
    const accent = getCamo(camoId).tint;
    const rgb = accent !== undefined ? hexRGB(accent) : [1.0, 0.68, 0.22];
    geom.getAttribute('aAccent').setXYZ(0, rgb[0], rgb[1], rgb[2]);
    geom.getAttribute('aAccent').needsUpdate = true;
    this._size();
    this._render();
  }

  _size() {
    const c = this.canvas;
    const w = Math.max(1, c.clientWidth || c.width || 300);
    const h = Math.max(1, c.clientHeight || c.height || 150);
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h;
      this.webgl.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    // Refit on every call: cards can be laid out after the gun is chosen, and narrow cards need more distance.
    const halfV = Math.tan(THREE.MathUtils.degToRad(11));
    this.fitDist = Math.max((this.gunW * 0.56) / (halfV * this.camera.aspect), (this.gunH * 0.62) / halfV, 2.2);
    if (!this.dist) this.dist = this.fitDist;
  }

  _render() {
    this._size();
    const yaw = Math.sin(this.spin * 0.55) * 0.5;
    const d = this.dist;
    const k = this.kick * this.kick;
    this.mesh.position.set(-this.centre.x + k * 0.05, -this.centre.y, -this.centre.z);
    const s = 1 + k * 0.035;
    this.mesh.scale.set(s, s, s);
    this.scene.rotation.y = yaw;
    this.camera.position.set(0, d * Math.sin(0.27), d * Math.cos(0.27));
    this.camera.lookAt(0, 0, 0);
    this.scene.updateMatrixWorld();
    this.webgl.render(this.scene, this.camera);
  }

  tick(dt) {
    this.time.value = (this.time.value + dt) % 3600;
    this.spin += dt;
    this.kick = Math.max(0, this.kick - dt * KICK_DECAY);
    const ease = 1 - Math.exp(-FRAME_EASE * dt);
    this.centre.lerp(this.goal, ease);
    this._size();
    this.dist += (this.fitDist - this.dist) * ease;
    this._render();
  }

  dispose() {
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.dispose(); }
    this.material.dispose();
    this.webgl.dispose();
    this.webgl.forceContextLoss();
  }
}
