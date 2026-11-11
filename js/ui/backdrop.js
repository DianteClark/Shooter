// The living title backdrop: the game's own renderer, on the game's own canvas, filming a real map in its theme
// lighting. A slow camera drifts round your operator, standing in your loadout, while two squadmates walk a beat behind
// and the map's ambient life (birds, steam, weather) carries on by itself.
//
// One GameRenderer at a time can own canvas#game, so the backdrop is built when the menus need it and disposed before a
// match builds its own. Screens that run a second WebGL context (gun and operator turntables) freeze it instead: the
// canvas keeps showing its last frame, so the yard is still there behind them for no cost at all.
import { GameRenderer } from '../render/renderer.js';
import { castRay } from '../render/fog.js';
import { setThemeLighting } from '../render/art.js';
import { MAPS, MAP_IDS } from '../shared/map.js';
import { OPERATOR_IDS } from './operators.js';
import { currentSkin } from './cards.js';

const ROTATION_KEY = 'switchyard-backdrop';
const FADE_MS = 900;                 // The yard fades up from black once its first frame is drawn.
const FOV = 30;
const ORBIT_R = 8.6;                 // Metres along the ground from the operator to the camera.
const ORBIT_H = 8.4;                 // High enough that low cover never stands between the lens and the squad.
const AIM_LEFT = 2.6;               // Metres the lens looks left of the operator.
const AIM_NEAR = 1.6;               // ...and toward itself, which lifts the operator up the frame.
const SWAY = 0.42;                   // Radians the orbit drifts either way of its base angle.
const SWAY_SECONDS = 38;             // One full drift, there and back.
const WALK_SPEED = 1.6;              // A patrol amble, well under a run.
const CLEAR_ARC = 2.2;               // The camera's side of the operator must be open across this arc (radians).

const smooth = t => t * t * (3 - 2 * t);

function player(id, team, x, z, aim, weapon, camo, attachments) {
  return {
    id, name: '', team, x, z, aim, vx: 0, vz: 0, hp: 100, alive: true, weapon, camo, attachments, adsT: 0, reloadT: 0,
    reloadDur: 0, sprinting: false, sliding: false, spawnProtect: false, heat: 0, overheated: false, ghost: false, respawnT: 0,
    kills: 0, deaths: 0, streak: 0,
  };
}

// The next map in the rotation, so each launch opens on a different yard.
// Small and medium maps only: a menu must never cost what a 16 v 16 map does, or the phone is warm before a match starts.
const MENU_MAPS = MAP_IDS.filter(id => { const s = MAPS[id].size ?? 'medium'; return s === 'small' || s === 'medium'; });
function nextMapId() {
  let i = 0;
  try { i = (Number(localStorage.getItem(ROTATION_KEY)) || 0) + 1; localStorage.setItem(ROTATION_KEY, String(i)); } catch { /* fixed map */ }
  return MENU_MAPS[i % MENU_MAPS.length];
}
// The backdrop is slow drift behind menus: 30 frames a second is plenty, and after IDLE_MS without a touch it holds a
// still frame until the next one. Both keep the phone cool for the match.
const FRAME_MS = 1000 / 30 - 3;
const IDLE_MS = 40000;

// Where the operator stands: open ground with room for the camera to swing round its south side, and a backdrop of
// structure behind (north) so the frame is never an empty field. Deterministic per map.
function findStage(map) {
  const walls = map.walls.filter(w => w.kind !== 'border');
  const all = map.walls;
  let best = null;
  for (let x = 8; x < map.width - 8; x += 2) {
    for (let z = 8; z < map.height - 6; z += 2) {
      if (walls.some(w => x > w.x - 2.4 && x < w.x + w.w + 2.4 && z > w.z - 2.4 && z < w.z + w.d + 2.4)) continue;
      let open = Infinity;
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI / 2 - CLEAR_ARC / 2 + (CLEAR_ARC * k) / 8;        // Fanned around due south (+z).
        open = Math.min(open, castRay(all, x, z, Math.cos(a), Math.sin(a), 30));
      }
      if (open < 6) continue;
      const behind = castRay(all, x, z, 0, -1, 40);                          // Something to look at, not too close.
      const side = Math.min(castRay(all, x, z, 1, 0, 30), castRay(all, x, z, -1, 0, 30));
      const score = Math.min(open, 22) - Math.abs(behind - 9) * 0.8 - Math.max(0, 3 - side) * 4 - Math.abs(x - map.width / 2) * 0.05;
      if (!best || score > best.score) best = { x, z, score };
    }
  }
  return best ?? { x: map.width / 2, z: map.height / 2 };
}

// A short beat for a squadmate: out along an open line from `from` and back.
function patrol(map, from, angle, length) {
  const walls = map.walls.filter(w => w.blocksBullet || w.blocksVision);
  for (let i = 0; i < 12; i++) {
    const a = angle + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.35;
    const dx = Math.cos(a), dz = Math.sin(a);
    const clear = castRay(walls, from.x, from.z, dx, dz, length + 2);
    if (clear >= length + 1.5) return { ax: from.x, az: from.z, bx: from.x + dx * length, bz: from.z + dz * length };
  }
  return { ax: from.x, az: from.z, bx: from.x, bz: from.z };
}

export class MenuBackdrop {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.mapId = null;
    this.raf = 0;
    this.state = 'off';          // 'live' draws every frame, 'still' keeps the last frame, 'off' has no renderer.
    this.clock = 0;
    this.last = 0;
    this.loadout = null;
    this.quality = 'auto';       // The player's quality option; main.js keeps it current.
    this.events = [];
    this.view = null;
    this.walkers = [];
    this.buildTimer = 0;
    this.onReady = null;         // Called with true once the yard is on screen, false when it is gone.
    this.onVisibility = () => { if (document.hidden) this.#halt(); else if (this.state === 'live') this.#run(); };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get map() { return MAPS[this.mapId]; }

  // loadout: { primary, camo, operator, attachments } as Progress.loadout() gives it.
  setLoadout(loadout) {
    this.loadout = loadout;
    const hero = this.view?.players[0];
    if (!hero || !loadout) return;
    hero.weapon = loadout.primary;
    hero.camo = loadout.camo;
    hero.attachments = loadout.attachments?.[loadout.primary];
    this.renderer?.chars.setRoster(this.#roster());
  }

  // Shows the yard moving. Builds it first if needed, a beat after the call so the screen that asked paints first.
  live() {
    this.state = 'live';
    if (this.renderer) { this.#run(); return; }
    if (this.buildTimer) return;
    this.buildTimer = setTimeout(() => {
      this.buildTimer = 0;
      if (this.state === 'off') return;
      this.#build();
      if (this.state === 'live') this.#run();
      else this.#drawOnce();
    }, 60);
  }

  // Keeps the last frame on the canvas and stops drawing.
  still() {
    if (this.state === 'off') return;
    this.state = 'still';
    this.#halt();
  }

  // Frees everything, before a match takes the canvas.
  stop() {
    this.state = 'off';
    clearTimeout(this.buildTimer);
    this.buildTimer = 0;
    this.#halt();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.canvas.style.transition = '';
    this.canvas.style.opacity = '';
    this.onReady?.(false);
  }

  #build() {
    this.mapId = nextMapId();
    const map = this.map;
    // A pinned step, with no governor: the yard is a backdrop under the menus, and the match should inherit nothing.
    const r = new GameRenderer(this.canvas, map, { dynamicRes: false });
    // Never above Medium behind the menus; a player who chose Low or Potato for the match gets that here too.
    const pick = ['low', 'potato'].includes(this.quality) ? this.quality : matchMedia('(max-width: 700px)').matches ? 'low' : 'medium';
    r.setQuality(pick);
    r.setResScale?.(0.85);
    // Theme lighting is a global shader chunk; this renderer has compiled every program it needs, so the menus' gun
    // turntables go back to the neutral rig.
    setThemeLighting('railyard');
    this.renderer = r;

    const stage = findStage(map);
    this.stage = stage;
    const l = this.loadout ?? { primary: 'ar', camo: 'none' };
    const faceCam = Math.PI / 2 + 0.35;                                      // Looking south-east, past the camera.
    const hero = player('bd-hero', 0, stage.x, stage.z, faceCam, l.primary, l.camo, l.attachments?.[l.primary]);
    const mates = [
      patrol(map, { x: stage.x - 3.2, z: stage.z - 3.4 }, Math.PI, 7),
      patrol(map, { x: stage.x + 3.6, z: stage.z - 5.5 }, 0, 6),
    ];
    this.walkers = mates.map((path, i) => ({ path, t: i * 0.45, speed: WALK_SPEED * (0.9 + i * 0.2) }));
    const players = [hero, ...mates.map((p, i) => player(`bd-mate${i}`, 0, p.ax, p.az, 0, i ? 'smg' : 'lmg', 'none'))];
    this.view = { t: 0, phase: 'live', timeLeft: 0, scores: [0, 0], winner: null, uav: [0, 0], players, localId: null, lastKill: null };
    r.chars.setRoster(this.#roster());
    r.setCinematic({ rate: 1, px: 0, py: 10, pz: 0, tx: 0, ty: 0, tz: 0, fov: FOV, roll: 0, bars: 0, desat: 0 });
    this.clock = 0;
    this.#place(0);

    this.canvas.style.transition = 'none';
    this.canvas.style.opacity = '0';
  }

  #roster() {
    const op = this.loadout?.operator ?? OPERATOR_IDS[0];
    const seed = (this.mapId?.length ?? 0) + 3;
    return [
      { id: 'bd-hero', operator: op, skin: this.loadout?.skin ?? currentSkin(op) },
      { id: 'bd-mate0', operator: OPERATOR_IDS[seed % OPERATOR_IDS.length] },
      { id: 'bd-mate1', operator: OPERATOR_IDS[(seed + 4) % OPERATOR_IDS.length] },
    ];
  }

  // Moves the camera and the squad to time `t` seconds.
  #place(dt) {
    const shot = this.renderer.cine, s = this.stage, t = this.clock;
    const sway = Math.sin((t / SWAY_SECONDS) * Math.PI * 2) * SWAY;
    const a = Math.PI / 2 + 0.28 + sway;                                    // South of the operator, a touch east.
    const breathe = Math.sin(t * 0.21) * 0.35;
    shot.px = s.x + Math.cos(a) * ORBIT_R;
    shot.pz = s.z + Math.sin(a) * ORBIT_R;
    shot.py = ORBIT_H + breathe;
    // Aim left of and in front of the operator, so they stand right of centre and high enough to clear the buttons
    // along the bottom. (sin a, -cos a) is the camera's right on the ground; (cos a, sin a) points back at the lens.
    shot.tx = s.x - Math.sin(a) * AIM_LEFT + Math.cos(a) * AIM_NEAR;
    shot.tz = s.z + Math.cos(a) * AIM_LEFT + Math.sin(a) * AIM_NEAR;
    shot.ty = 0.6;

    const hero = this.view.players[0];
    hero.aim = Math.PI / 2 + 0.25 + Math.sin(t * 0.17) * 0.5 + Math.sin(t * 0.53) * 0.08;   // Scanning, unhurried.
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i], p = this.view.players[i + 1], path = w.path;
      const len = Math.hypot(path.bx - path.ax, path.bz - path.az);
      if (len < 0.5) continue;
      w.t += (dt * w.speed) / len;
      // Out, pause, back, pause: a sentry's beat.
      const cycle = w.t % 2.6;
      const leg = cycle < 1 ? smooth(cycle) : cycle < 1.3 ? 1 : cycle < 2.3 ? 1 - smooth(cycle - 1.3) : 0;
      const nx = path.ax + (path.bx - path.ax) * leg, nz = path.az + (path.bz - path.az) * leg;
      p.vx = dt > 0 ? (nx - p.x) / dt : 0;
      p.vz = dt > 0 ? (nz - p.z) / dt : 0;
      const moving = Math.hypot(p.vx, p.vz) > 0.2;
      if (moving) p.aim = Math.atan2(p.vz, p.vx);
      p.x = nx; p.z = nz;
    }
  }

  #frame = now => {
    if (now - this.touched > IDLE_MS) { this.raf = 0; return; }          // Resting: #wake starts it again.
    this.raf = requestAnimationFrame(this.#frame);
    if (this.last && now - this.last < FRAME_MS) return;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.clock += dt;
    this.view.t = this.clock;
    this.#place(dt);
    this.renderer.update(this.view, this.events, dt);
    if (this.canvas.style.opacity === '0') this.#fadeIn();
  };

  #fadeIn() {
    this.onReady?.(true);
    requestAnimationFrame(() => {
      this.canvas.style.transition = `opacity ${FADE_MS}ms ease-out`;
      this.canvas.style.opacity = '1';
    });
  }

  #drawOnce() {
    this.#place(0);
    this.renderer.update(this.view, this.events, 1 / 60);
    this.#fadeIn();
  }

  #run() {
    if (this.raf || document.hidden || !this.renderer) return;
    this.touched = performance.now();
    if (!this.wakeBound) {
      this.wakeBound = true;
      const wake = () => { this.touched = performance.now(); if (this.state === 'live') this.#run(); };
      window.addEventListener('touchstart', wake, { passive: true, capture: true });
      window.addEventListener('mousedown', wake, { passive: true, capture: true });
    }
    this.last = 0;
    this.raf = requestAnimationFrame(this.#frame);
  }

  #halt() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resize() {
    if (!this.renderer) return;
    this.renderer.resize();
    if (this.state === 'still') this.#drawOnce();
  }
}
