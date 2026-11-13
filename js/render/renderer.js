// Art engineer's public module: GameRenderer (the match view) and GunPreview (gunsmith, end card).
// GameRenderer.update is the only per-frame entry point; it allocates nothing once running.
import * as THREE from 'three';
import { TEAMS } from '../shared/constants.js';
import { TEAM_RGB } from '../shared/palette.js';   // [r, g, b] per side, rewritten in place by the colour modes.
import { BrFx } from './br-fx.js';     // Battle royale: circle wall, transport, loot, canopies (docs/BR.md).
import { ExFx } from './ex-fx.js';     // Extraction: landing zones and helicopters, contract things, phones (docs/EXTRACT.md).
import { ZmFx } from './zm-fx.js';     // Graveyard Shift: fences, gates, wall-buys, perk machines, the crate (docs/ZOMBIES.md).
import { clearZmWalls } from '../shared/zombies.js';
import { getCamo } from '../shared/camos.js';
import { buildWorld } from './world.js';
import { Weather } from './weather.js';
import { FogMask, castRay } from './fog.js';
import { Characters, GLIDE_ALT } from './characters.js';
import { VFX, GUN_FX } from './vfx.js';
import { CombatFX, GUNSHIP_Y, CHOPPER_Y } from './combat.js';
import { Surfaces } from './surfaces.js';
import { Props } from './props.js';
import { Ambient } from './ambient.js';
import { getGun } from './guns.js';
import { hexRGB, setThemeLighting, getTheme } from './art.js';
import { createCamoMaterial, addCamoInstanceAttributes, camoIndex } from './camo-shader.js';
import { QUALITY_STEPS, AUTO_CEILING, stepIndex, deviceProfile, savedAutoStep, saveAutoStep, frameClock, Governor } from './quality.js';
import { TUNING } from '../shared/tuning.js';
import { spectate } from '../sim/snd.js';
import { PILOTED } from '../sim/streaks-v9.js';
const STEERED_KILLS = new Set([...PILOTED, 'bombrun']);   // Streak kills that still punch the camera: ones you aimed.   // Live feel tuning: camera kick, shake, ADS lookahead, zoom.
import { feelMotion } from './feel.js';   // Reduced motion scales the camera kick a gun adds.

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
  // V8. The crossbow has no flash and no case: a slow pale streak of a bolt.
  carbine:    { tail: 9,  linger: 0.06,  speed: 225, flash: [1.3, 0.95, 1.05], shell: 'rifle' },
  heavysmg:   { tail: 8,  linger: 0.06,  speed: 210, flash: [1.5, 0.95, 1.3],  shell: 'pistol' },
  slug:       { tail: 12, linger: 0.1,   speed: 250, flash: [2.1, 0.9, 1.7],   shell: 'hull' },
  lightlmg:   { tail: 12, linger: 0.08,  speed: 225, flash: [1.6, 1.0, 1.1],   shell: 'rifle', every: 2 },
  crossbow:   { tail: 6,  linger: 0.2,   speed: 120, flash: [0.2, 0.2, 0.2],   shell: null },
  scatter:    { tail: 3.2, linger: 0.05, speed: 170, flash: [2.0, 0.75, 1.8],  shell: null, extra: 'blast' },
};
for (const id in GUN_FX_FALLBACK) if (!GUN_FX[id]) GUN_FX[id] = GUN_FX_FALLBACK[id];

// Kills from these hold the hit-stop a beat longer.
const BIG_KILL = new Set(['Sniper', 'Marksman', 'Launcher']);

const DEFAULT_KICK = { ar: 0.5, smg: 0.36, shotgun: 1.1, lmg: 0.7, sniper: 1.4, pistol: 0.45 };
const TRACER_BASE = 0.13;       // Metres of half-width for a weapon whose tracerWidth is 1.

const PUNCH = { double: 0.03, triple: 0.045, fury: 0.06, streak3: 0.03, streak5: 0.045, streak10: 0.06 };

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
const PLAY_CLEAR = 22;          // Metres: taller than anything built on a map, for the play camera's near plane.
const CINE_NEAR = 0.8;        // Replays and the menu backdrop: the lens never comes closer than this to anything.
const VIEW_WIDTH = 30;        // Metres of ground across the screen at the camera target.
const ADS_LOOK = 7.5;         // Metres of lookahead toward aim at full ADS.
const MAX_DPR = 2;            // Gun previews in the menus.
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
const ZM_ARC = [0.45, 0.85, 1.0], ZM_FROST = [0.75, 0.95, 1.0], ZM_DRONE = [0.4, 1.0, 0.65];   // Graveyard Shift's economy.

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
  // opts.dynamicRes (default true) can be disabled for repeatable screenshots: quality then stays on the pinned step
  // ('high' unless setQuality says otherwise) and never adapts.
  constructor(canvas, map, opts = {}) {
    this.canvas = canvas;
    this.map = map;
    clearZmWalls(map);            // The world is built from the map's own walls: Graveyard Shift draws its fences itself.
    this.localId = null;
    this.watching = null;         // The teammate being spectated (Search and Destroy), or null.
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
    this.cssW = 1; this.cssH = 1;

    this.fog = new FogMask(map, webgl);
    this.time = { value: 0 };

    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.camera = new THREE.PerspectiveCamera(VFOV, 2, 3, 120);
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
    this.fogFrame = 0;
    this.fogEvery = 1;
    this.stepI = -1;              // Index into QUALITY_STEPS.
    this.qualityMode = 'high';    // 'auto' or the pinned step id.
    this.governor = null;         // Auto only.
    this.profile = null;
    this.lastNow = 0;
    this.selfMs = 0;              // This renderer's own update time last frame, the fallback when no frame clock runs.
    this._killInfo = { dirX: 0, dirZ: 0, weapon: 'ar', head: false, explosive: false };
    this.desat = 0;
    this.hurt = 0;
    this.finalKill = null;
    this.frameStats = {
      calls: 0, triangles: 0, dpr: 0, geometries: 0, programs: 0, lowPower: false,
      step: 'high', stepLabel: 'High', auto: false, resScale: 1, fogTexels: 8, thermal: false, heat: 0, cap30: false,
      renderMs: 0, reason: '', profile: null,
    };

    this._laserRGB = [0, 0, 0];
    this._cullV = new THREE.Vector3();
    this._charOpts = { localId: null, localTeam: 0, uav: false, revealAll: false };   // Reused every frame.
    this._hotRGB = [0, 0, 0];
    this.steamClock = 0;

    this.resize();
    this._applyStep(stepIndex('high'));
    if (this.dynamicRes) this.setQuality('auto');
    // Every program now, hidden objects included, so no quality step or first sighting ever compiles mid-match.
    this.fog.compile();
    webgl.compile(this.scene, this.camera);
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

  // q: 'auto', or a step id from QUALITY_STEPS ('ultra' .. 'potato'). Auto starts from the step it settled on last
  // match, else from this phone's profile, and then adapts; a named step stays put at full resolution.
  setQuality(q) {
    const pinned = stepIndex(q);
    this.profile = this.profile || deviceProfile(this.webgl.getContext());
    this.frameStats.profile = this.profile;
    if (q === 'auto' && this.dynamicRes) {
      const saved = savedAutoStep();
      const ceiling = this.profile.ceiling ?? AUTO_CEILING;
      const start = Math.max(ceiling, stepIndex(saved || this.profile.step));
      this.qualityMode = 'auto';
      this.resScale = 1;
      this.stepI = -1;             // Re-applied below, so the tier's pixel-ratio cap takes effect on this step too.
      this.governor = new Governor(this, start, ceiling);
    } else {
      this.qualityMode = pinned >= 0 ? q : 'high';
      this.governor = null;
      this.resScale = 1;
      this.stepI = -1;
      this._applyStep(pinned >= 0 ? pinned : stepIndex('high'));
      this._applyRes();
    }
  }

  // Governor host interface.
  get step() { return this.stepI; }
  get maxDpr() { return this.basePixelRatio; }
  get effectiveDpr() { return this.basePixelRatio * this.resScale; }
  setStep(i) { this._applyStep(i); }
  setResScale(s) {
    if (Math.abs(s - this.resScale) < 1e-4) return;
    this.resScale = s;
    this._applyRes();
  }

  // Sizes, counts and visibility only: see quality.js.
  _applyStep(i) {
    i = Math.max(0, Math.min(QUALITY_STEPS.length - 1, i));
    if (i === this.stepI) return;
    this.stepI = i;
    const q = QUALITY_STEPS[i];
    // Auto also keeps under the device tier's cap (quality.js deviceProfile); a step the player picked is honoured as is.
    const cap = this.qualityMode === 'auto' ? (this.profile?.dprCap ?? Infinity) : Infinity;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, q.dpr, cap);
    this._applyRes();
    this.fog.setDensity(q.fogTexels);
    this.fog.setPasses(q.fogPasses);
    this.fogEvery = q.fogEvery;
    this.vfx.fxScale = q.fx;
    this.weather.setDensity(q.weather);
    this.ambient.setLowPower(!q.ambient);
    this.chars.blob.visible = q.blobs;
    if (this.world.decals) this.world.decals.visible = q.shadows;
    this.props.setDensity(q.props);
    this.worldCut = q.cut;
    const corpses = this.chars.corpses;
    corpses.limit = q.corpses;
    if (corpses.head >= q.corpses) corpses.head = 0;
    const st = this.frameStats;
    st.step = q.id; st.stepLabel = q.label; st.fogTexels = q.fogTexels;
    st.lowPower = i >= stepIndex('low');
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
            vfx.killEffect(ev.by, ev.x, ev.z, ev.weapon);
          }
          // A kill your Wingman, Sentry, Chopper or other unsteered streak makes is not a shot you took: the picture stays
          // on you, unfrozen (roadmap 40). Your own gun, grenades and the streaks you fly still punch.
          if (ev.by === localId && ev.target !== localId && !this.cine && (!ev.streak || STEERED_KILLS.has(ev.streak))) {
            // The kill freezes the picture for a few frames; bigger guns and headshots hold it longer.
            const big = BIG_KILL.has(WEAPONS[ev.weapon] && WEAPONS[ev.weapon].category) || ev.weapon === 'revolver';
            this.hitStop = 0.05 + (ev.head ? 0.03 : 0) + (big ? 0.04 : 0);
            this.hitEase = 0.17;
            const motion = feelMotion();
            this.zoomPunch = Math.max(this.zoomPunch, (0.05 + (ev.head ? 0.02 : 0)) * motion);
            this.trauma = Math.min(1, this.trauma + 0.25);
          }
          break;
        }
        // Screen punches: a multi-kill, a kill streak and calling in your own scorestreak land a small camera kick.
        case 'medal': if (ev.id === localId && PUNCH[ev.medal]) this.punch(PUNCH[ev.medal]); break;
        case 'streak': if (ev.id === localId) this.punch(0.05); break;
        case 'brchest': this.brFx?.onChest(ev.x, ev.z); break;
        case 'brping': if (ev.team === localTeam) this.brFx?.ping(ev.x, ev.z); break;     // A squadmate's landing spot.
        case 'exleave': case 'exfil': case 'exland': case 'excall': this.exFx?.onEvent(ev); break;
        case 'zswing': chars.onShot(ev.id, 0.3, 'knife'); break;     // Graveyard Shift: a zombie's claw.
        case 'zspit': case 'zblast': case 'zshield': this.zmFx?.onEvent(ev); break;     // Specials (js/render/zm-kinds-fx.js).
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
        case 'emote': chars.onEmote(ev.id, ev.e); break;     // docs/FINISHERS.md
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
        case 'zfx': {     // Graveyard Shift tier-3 rounds (js/sim/zm-econ.js): arcs, burning, frost.
          if (ev.k === 'arc') { vfx.tracer(ev.ox, 1.1, ev.oz, ev.x, 1.1, ev.z, ZM_ARC, 0.14, 4, 0.12, 120); vfx.sparks(ev.x, 1, ev.z, 0, 0, ZM_ARC, 4, 7); vfx.pop(ev.x, 1.2, ev.z, 2.5, ZM_ARC, 0.12); }
          else if (ev.k === 'burn') { for (let k = 0; k < 6; k++) vfx.ember(ev.x + (Math.random() - 0.5) * 0.6, 0.6 + Math.random(), ev.z + (Math.random() - 0.5) * 0.6, FIRE_SPARK); vfx.pop(ev.x, 1, ev.z, 2, FIRE_SPARK, 0.2); }
          else if (ev.k === 'frost') { vfx.sparks(ev.x, 1, ev.z, 0, 0, ZM_FROST, 6, 4); vfx.ring(ev.x, ev.z, 0.2, 1.1, 0.35, ZM_FROST, 0.6); }
          break;
        }
        case 'turret_shot': {
          if (ev.zm === 'drone') { vfx.tracer(ev.ox, 2.3, ev.oz, ev.x, 1.05, ev.z, ZM_DRONE, 0.08); vfx.sparks(ev.x, 0.6, ev.z, 0, 0, ZM_DRONE, 2, 6); break; }
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
    const G = vfx.gunFx(ev.weapon);       // Hand-made or derived from the gun's class: see feel.js.
    const local = ev.by === localId;
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
          vfx.gunTracer(G, ev.by, i, local, mx, my, mz, ray.x, 1.05, ray.z, rgb, width);
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
      if (G.light > 0) vfx.pop(mx, 1.4, mz, (5 + kick * 2.2) * (ev.sup ? 0.5 : G.light), rgb, 0.09);
    }

    chars.onShot(ev.by, kick, ev.weapon);

    if (local) {
      // The system's reduce-motion setting scales the whole kick down, under the player's own Camera kick slider.
      const motion = feelMotion();
      const k = 5.2 * kick * TUNING.camKick * motion;
      this.kickVX -= Math.cos(ev.aim) * k;
      this.kickVZ -= Math.sin(ev.aim) * k;
      this.rollV += (ev.aim > 0 ? 1 : -1) * kick * 0.08 * (0.6 + Math.random()) * motion;
      this.trauma = Math.min(1, this.trauma + 0.1 * kick * motion);
      this.zoomPunch = Math.max(this.zoomPunch, 0.014 * kick * TUNING.camKick * motion);
    }
  }

  _updateCamera(dt, local, view) {
    const map = this.map;
    const cam = this.camera;
    const t = this.time.value;
    this.trauma = Math.max(0, this.trauma - dt * 2.4);
    const shake = this.trauma * this.trauma * feelMotion();   // Reduce shake (Options) or the system setting: a quarter.

    // Replays hand the camera to the killcam's description of the shot.
    if (this.cine) {
      const c = this.cine;
      if (cam.fov !== c.fov || cam.near !== CINE_NEAR) { cam.fov = c.fov; cam.near = CINE_NEAR; cam.far = 170; cam.updateProjectionMatrix(); }
      const sx = wobble(t, 1.3) * shake * 0.4, sy = wobble(t, 2.9) * shake * 0.3, sz = wobble(t, 4.1) * shake * 0.4;
      cam.position.set(c.px + sx, c.py + sy, c.pz + sz);
      cam.lookAt(c.tx, c.ty, c.tz);
      if (c.roll) cam.rotateZ(c.roll);
      cam.updateMatrixWorld();
      return;
    }

    let tx = this.camTarget.x, tz = this.camTarget.z;
    if (this.finalKill) {
      const f = this.finalKill;
      f.t += dt;
      const r = this.chars.rigs.get(f.by);
      if (r) { f.x = r.x; f.z = r.z; }
      const k = 1 - Math.exp(-f.t * 2.2);
      tx += (f.x - tx) * Math.min(1, dt * 5);
      tz += (f.z - tz) * Math.min(1, dt * 5);
      this.zoomPunch = 0.42 * k * (feelMotion() < 1 ? 0.5 : 1);
    } else if (local) {
      const aimX = Math.cos(local.aim), aimZ = Math.sin(local.aim);
      const ads = local.adsT || 0;
      const leadX = aimX * TUNING.camLook * ads, leadZ = aimZ * TUNING.camLook * ads * 0.85;
      this.lookX += (leadX - this.lookX) * Math.min(1, dt * 9);
      this.lookZ += (leadZ - this.lookZ) * Math.min(1, dt * 9);
      tx = local.x + this.lookX;
      tz = local.z + this.lookZ;
      // Flying your own Cruise Missile: the camera rides with it so a long flight never leaves the screen.
      // Only a streak you steer (PILOTED: Cruise Missile, Recon Drone, Carpet Line's reticle) moves the camera; Wingman,
      // Sentry, Rover, the aircraft and the rest leave it on you (roadmap 40, dev/ui-streak-cam-test.py).
      const missile = view?.gunships?.find(g => PILOTED.has(g.kind) && g.owner === view.localId)
        ?? view?.drones?.find(g => PILOTED.has(g.kind) && g.owner === view.localId);
      const mc = this.missileCam ?? 0;
      this.missileCam = mc + ((missile ? 1 : 0) - mc) * Math.min(1, dt * 5);
      if (missile) { this.missileX = missile.x; this.missileZ = missile.z; }
      if (this.missileCam > 0.01) {
        tx += ((this.missileX ?? tx) - tx) * this.missileCam;
        tz += ((this.missileZ ?? tz) - tz) * this.missileCam;
      }
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
    // Battle royale: the camera rides a glider down (aboard, it waits up at the jump height), so the ground comes up to meet
    // you; it is level with the ground again the moment you land.
    const lr = local && view?.br ? this.chars.rigs.get(local.id) : null;
    const altGoal = !lr || !local.alive ? 0 : local.air === 1 ? GLIDE_ALT : lr.alt;
    const alt = altGoal;
    const dist = this.distance * TUNING.camZoom * (1 - this.zoomPunch + this.camEase) * (1 + alt * 0.012);
    const cx = tx + sx + this.kickX, cz = tz + sz + this.kickZ;
    cam.position.set(cx, alt + dist * Math.sin(TILT), cz + dist * Math.cos(TILT));
    // Depth range fitted to the shot, for depth precision: the near plane sits as far out as it can without cutting the
    // tallest landmark (a ~20 m chimney) when the camera passes over it, so it moves out with the glider in battle
    // royale; the far plane just past the ground at the top edge of the screen.
    const camY = cam.position.y;
    const near = Math.min(12, Math.max(3, Math.round((camY - PLAY_CLEAR) * 0.8)));
    const far = Math.min(240, Math.max(90, Math.ceil((camY * 1.8 + 40) / 10) * 10));
    if (cam.fov !== VFOV || cam.near !== near || cam.far !== far) { cam.fov = VFOV; cam.near = near; cam.far = far; cam.updateProjectionMatrix(); }
    cam.lookAt(cx, alt, cz);
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

  // The ground rectangle under the four screen corners, for culling soldiers next frame. A camera that sees the horizon
  // (a low replay shot) turns culling off.
  _updateCull() {
    const cam = this.camera, c = this.chars.cull, v = this._cullV, o = cam.position;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < 4; i++) {
      v.set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, 0.5).unproject(cam).sub(o);
      if (v.y > -0.05 * v.length()) { c.on = false; return; }
      const t = -o.y / v.y, x = o.x + v.x * t, z = o.z + v.z * t;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    c.on = true; c.x0 = x0; c.x1 = x1; c.z0 = z0; c.z1 = z1;
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
    const startMs = performance.now();
    if (this.governor) {
      // The interval is measured here rather than taken from dt, which the match clamps.
      if (this.lastNow) this.governor.frame(startMs - this.lastNow, frameClock.count ? frameClock.lastWork : this.selfMs);
    }
    this.lastNow = startMs;
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
    let localId = cine ? null : (this.localId !== null ? this.localId : view.localId);
    // Search and Destroy: out for the round, you see through a living teammate's eyes (js/sim/snd.js spectate): the
    // camera follows them and the fog of war is theirs.
    if (localId !== null) {
      const watch = spectate.target(view, localId);
      if (watch !== this.watching) { this.watching = watch; this.fog.reset(); this.lookX = 0; this.lookZ = 0; }
      if (watch) localId = watch;
    }
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
    if (view.br) (this.brFx ??= new BrFx(this.scene, this.map)).update(view, fxDt, this.camTarget.x, this.camTarget.z, this.chars);
    if ((view.obj ?? view.points?.obj)?.ex) (this.exFx ??= new ExFx(this.scene, this.map)).update(view, fxDt, this.camTarget.x, this.camTarget.z, localTeam);
    const zmObj = (view.obj ?? view.points?.obj)?.zm ? (view.obj ?? view.points.obj) : null;
    if (zmObj?.layout) (this.zmFx ??= new ZmFx(this.scene, this.map, zmObj.layout)).update(view, fxDt);
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
      // Low steps refresh the vision mask every other frame; the temporal blend hides the difference.
      this.fogFrame = (this.fogFrame + 1) % this.fogEvery;
      if (this.fogFrame === 0) this.fog.update(local.x, local.z, realDt * this.fogEvery, view.smokes);
    } else if (!cine) this.fog.uniforms.on.value = 0;

    this._updateCamera(realDt, local, view);
    this._updateCull();
    this.world.setCutters?.(view.players, local);
    // A replay's camera can look anywhere, so it gets every tile; frustum culling still applies.
    this.world.setView(this.camera, this.camTarget.x, this.camTarget.z, cine || this.finalKill ? Infinity : this.worldCut);
    this.world.update(fxDt);
    this.weather.update(fxDt, this.camTarget.x, this.camTarget.z, this.world.material);
    webgl.render(this.scene, this.camera);

    const st = this.frameStats;
    st.calls = webgl.info.render.calls;
    st.triangles = webgl.info.render.triangles;
    st.dpr = this.basePixelRatio * this.resScale;
    st.resScale = this.resScale;
    st.geometries = webgl.info.memory.geometries;
    st.programs = webgl.info.programs ? webgl.info.programs.length : 0;
    const g = this.governor;
    st.auto = !!g;
    st.thermal = g ? g.thermal : false;
    st.heat = g ? g.lastRatio : 0;
    st.cap30 = g ? g.cap30 : false;
    st.reason = g ? g.reason : '';
    this.selfMs = performance.now() - startMs;
    st.renderMs = this.selfMs;
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

  // A screen punch: a quick push in plus a jolt. amount ~0.03 (a double kill) .. 0.08 (the final kill). Reduce shake and
  // flashes (Options, or the system setting) takes it to a quarter; the Camera kick slider scales it too.
  punch(amount) {
    if (this.cine) return;
    const k = amount * feelMotion() * TUNING.camKick;
    this.zoomPunch = Math.max(this.zoomPunch, k);
    this.trauma = Math.min(1, this.trauma + amount * 3);
    this.punches = (this.punches || 0) + 1;
    this.lastPunch = k;
  }

  // Render budget readout for the demo and profiling.
  getStats() { return this.frameStats; }

  // End-of-match: push in on the killer and ease time down. lastKill is view.lastKill.
  playFinalKill(lastKill) {
    if (!lastKill) return;
    const r = this.chars.rigs.get(lastKill.by);
    this.punch(0.08);
    this.finalKill = {
      by: lastKill.by,
      x: r ? r.x : lastKill.x,
      z: r ? r.z : lastKill.z,
      t: 0,
    };
  }

  dispose() {
    // A match long enough to judge leaves its settled step for the next one, unless the phone was hot.
    const g = this.governor;
    if (g && g.clock > 45 && !g.thermal) saveAutoStep(QUALITY_STEPS[this.stepI].id);
    this.chars.dispose();
    this.brFx?.dispose();
    this.exFx?.dispose(); this.exFx = null;
    this.zmFx?.dispose(); this.zmFx = null;
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
