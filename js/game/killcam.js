// Replays of a kill from buffered views. The match keeps running; only what the renderer is fed changes.
//
// How Match drives it (one object, three calls):
//   this.killcam = new Killcam({ renderer, localId, root });
//   frame():   this.killcam.render(view, events, dt);        // replaces renderer.update(view, events, dt)
//   #finish(): const secs = this.killcam.playFinal(view.lastKill);   // 0 means nothing recorded: use END_HOLD
// Death replays start by themselves from the 'kill' event, and stop the instant the player respawns.
// While one plays, `killcam.active` is true and HUD and audio keep receiving the live events.

const HZ = 30;                         // Recording rate; replays interpolate between these frames.
const SECONDS = 8;                     // Long enough to hold a whole death replay while newer frames keep arriving.
const FRAMES = HZ * SECONDS;
const EVENT_SLOTS = 1500;              // A loud 6v6 fires about 100 rounds a second.
const MAX_PLAYERS = 16;

const DEATH_DELAY = 0.4;               // The player sees their own death first.
const DEATH_PRE = 1.7, DEATH_POST = 0.45;
const FINAL_PRE = 1.7, FINAL_POST = 1.0;

// Only the things the renderer reacts to; everything else stays out of the buffer.
const KEEP = new Set(['shot', 'hit', 'kill', 'explosion', 'bang', 'swap', 'slide', 'throw', 'heal', 'overheat',
  'turret', 'turret_down', 'turret_shot', 'gunship_shot']);

const smooth = t => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const damp = (k, dt) => 1 - Math.exp(-k * dt);

function blankPlayer() {
  return { id: null, name: '', team: 0, x: 0, z: 0, aim: 0, vx: 0, vz: 0, hp: 0, alive: false, weapon: 'ar', camo: 'none',
    attachments: undefined, adsT: 0, reloadT: 0, reloadDur: 0, sprinting: false, sliding: false, spawnProtect: false, heat: 0, overheated: false, ghost: false, respawnT: 0 };
}

function copyPlayer(to, from) {
  to.id = from.id; to.name = from.name; to.team = from.team; to.x = from.x; to.z = from.z; to.aim = from.aim;
  to.vx = from.vx || 0; to.vz = from.vz || 0; to.hp = from.hp; to.alive = from.alive; to.weapon = from.weapon; to.camo = from.camo;
  to.attachments = from.attachments; to.adsT = from.adsT || 0; to.reloadT = from.reloadT || 0; to.reloadDur = from.reloadDur || 0;
  to.sprinting = !!from.sprinting; to.sliding = !!from.sliding; to.spawnProtect = !!from.spawnProtect; to.heat = from.heat || 0;
  to.overheated = !!from.overheated; to.ghost = !!from.ghost; to.respawnT = from.respawnT || 0;
}

export class Killcam {
  constructor({ renderer, localId, root = null }) {
    this.renderer = renderer;
    this.localId = localId;
    this.clock = 0;
    this.nextFrameAt = 0;
    this.frames = Array.from({ length: FRAMES }, () => ({ at: -1, t: 0, n: 0, players: [], smokes: null, projectiles: null, turrets: null, gunships: null, tags: null, points: null, mode: null, uav: null }));
    this.head = 0;
    this.count = 0;
    this.evAt = new Float64Array(EVENT_SLOTS);
    this.ev = new Array(EVENT_SLOTS).fill(null);
    this.evHead = 0;
    this.evCount = 0;

    this.recording = true;
    this.pending = null;          // A death waiting out DEATH_DELAY.
    this.replay = null;
    this.skipped = false;         // Set when the player skipped; Match may use it to end a final replay early.
    this.finalTotal = 0;
    this.out = {
      t: 0, phase: 'live', timeLeft: 0, scores: [0, 0], winner: null, uav: [0, 0], players: [], localId,
      lastKill: null, projectiles: null, smokes: null, turrets: null, gunships: null, tags: null, points: null, mode: null,
    };
    this.outPlayers = Array.from({ length: MAX_PLAYERS }, blankPlayer);
    this.replayEvents = [];       // What the replay is showing this frame; Match may pass them to audio.
    this.evCursor = 0;

    this.shot = { rate: 1, px: 0, py: 10, pz: 0, tx: 0, ty: 0, tz: 0, fov: 26, roll: 0, bars: 0.12, desat: 0 };
    this.camGoal = new Float32Array(7);
    this.camInit = false;
    this.lastAct = -1;
    this.root = root;
    this.ui = null;
  }

  get active() { return !!this.replay; }
  get kind() { return this.replay ? this.replay.kind : null; }

  /* ---------- Frame entry point ---------- */

  render(view, events, dt) {
    this.clock += dt;
    if (this.recording) this.#record(view, events);
    this.#watch(view, events);
    if (!this.replay) {
      this.renderer.update(view, events, dt);
      return;
    }
    this.#advance(dt);
    if (this.replay) this.renderer.update(this.out, this.replayEvents, dt);
    else this.renderer.update(view, events, dt);
  }

  // Skip button, or any call from the HUD. A skipped final replay also sets `skipped` for Match.
  skip() {
    if (!this.replay) { this.pending = null; return; }
    this.skipped = true;
    this.#stop();
  }

  // Slow replay of the match's last kill from the killer's side. Returns its length in seconds, or 0
  // if that kill is not in the buffer (a very long hold, or a kill never received): the caller holds as before.
  playFinal(lastKill) {
    this.skipped = false;   // A skipped death replay must not end the final hold.
    this.pending = null;
    if (this.replay) this.#stop();
    this.recording = false;       // Nothing newer than the final moments is wanted, and the buffer must stop rolling.
    const k = lastKill && this.#findKill(lastKill.by, lastKill.target);
    if (!k) { if (lastKill) this.renderer.playFinalKill(lastKill); return 0; }
    this.skipped = false;
    const from = k.at - FINAL_PRE, to = k.at + FINAL_POST;
    this.#begin('final', k.ev, k.at, from, to, 1);
    this.finalTotal = this.#integrate(this.replay);
    return this.finalTotal;
  }

  dispose() {
    if (this.replay) this.#stop();
    if (this.ui) { this.ui.el.remove(); this.ui = null; }
  }

  /* ---------- Recording ---------- */

  #record(view, events) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!KEEP.has(e.t)) continue;
      this.evAt[this.evHead] = this.clock;
      this.ev[this.evHead] = e;
      this.evHead = (this.evHead + 1) % EVENT_SLOTS;
      if (this.evCount < EVENT_SLOTS) this.evCount++;
    }
    if (this.clock < this.nextFrameAt) return;
    this.nextFrameAt = this.clock + 1 / HZ - 0.004;
    const f = this.frames[this.head];
    this.head = (this.head + 1) % FRAMES;
    if (this.count < FRAMES) this.count++;
    f.at = this.clock;
    f.t = view.t;
    const n = Math.min(view.players.length, MAX_PLAYERS);
    while (f.players.length < n) f.players.push(blankPlayer());
    for (let i = 0; i < n; i++) copyPlayer(f.players[i], view.players[i]);
    f.n = n;
    // These arrays belong to one decoded snapshot and are never mutated afterwards, so a reference is a snapshot.
    f.projectiles = view.projectiles; f.smokes = view.smokes; f.turrets = view.turrets; f.gunships = view.gunships;
    f.tags = view.tags; f.points = view.points; f.mode = view.mode; f.uav = view.uav;
  }

  #frame(i) { return this.frames[(this.head - this.count + i + FRAMES * 2) % FRAMES]; }

  #findKill(by, target) {
    for (let n = 0; n < this.evCount; n++) {
      const i = (this.evHead - 1 - n + EVENT_SLOTS * 2) % EVENT_SLOTS;
      const e = this.ev[i];
      if (e.t === 'kill' && e.by === by && e.target === target) return { ev: e, at: this.evAt[i] };
    }
    return null;
  }

  // Index of the first buffered event at or after time t.
  #eventIndexAt(t) {
    let n = 0;
    while (n < this.evCount) {
      const i = (this.evHead - this.evCount + n + EVENT_SLOTS * 2) % EVENT_SLOTS;
      if (this.evAt[i] >= t) break;
      n++;
    }
    return n;
  }

  /* ---------- Starting and stopping ---------- */

  #watch(view, events) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.t === 'kill' && e.target === this.localId && e.by !== this.localId && !this.replay) {
        this.pending = { at: this.clock, ev: e };
      }
      if (e.t === 'spawn' && e.id === this.localId) {
        this.pending = null;
        if (this.replay && this.replay.kind === 'death') this.#stop();
      }
    }
    // A respawn must never wait for a replay, even if the spawn event went astray.
    if (this.replay && this.replay.kind === 'death') {
      if (view.phase === 'ended') { this.#stop(); return; }
      for (let i = 0; i < view.players.length; i++) {
        const p = view.players[i];
        if (p.id === this.localId && p.alive && this.replay.t > 0.3) { this.#stop(); break; }
      }
    }
    if (this.pending && !this.replay && this.clock - this.pending.at >= DEATH_DELAY) {
      const pe = this.pending;
      this.pending = null;
      if (view.phase !== 'live') return;
      let left = 2;
      for (let i = 0; i < view.players.length; i++) {
        const p = view.players[i];
        if (p.id === this.localId) { if (p.alive) return; left = p.respawnT || 0; }
      }
      const spare = left - 0.2;
      if (spare < 0.9) return;     // Too little time left for it to read; just show the respawn screen.
      this.#begin('death', pe.ev, pe.at, pe.at - DEATH_PRE, pe.at + DEATH_POST, 1);
      // Time-compress the window so the whole thing fits before the respawn.
      const base = this.#integrate(this.replay);
      this.replay.speed = base > spare ? base / spare : 1;
    }
  }

  #begin(kind, ev, at, from, to, speed) {
    // Clamp to what is actually buffered; a kill right after the match started has less history.
    const oldest = this.count ? this.#frame(0).at : at;
    const c0 = Math.max(from, oldest);
    this.replay = {
      kind, ev, at, from: c0, to, c: c0, t: 0, speed,
      side: 1, shake: false,
      by: ev.by, target: ev.target,
      vx: ev.x, vz: ev.z,
    };
    this.evCursor = this.#eventIndexAt(c0);
    this.camInit = false;
    this.lastAct = -1;
    this.renderer.setCinematic(this.shot);
    this.#showBanner(kind, ev);
  }

  #stop() {
    this.replay = null;
    this.replayEvents.length = 0;
    this.renderer.setCinematic(null);
    this.#hideBanner();
  }

  /* ---------- Playback ---------- */

  // Content seconds advanced per real second, relative to the moment of the kill.
  #rate(rep, tau) {
    if (rep.kind === 'final') {
      if (tau < -0.55) return 0.8;
      if (tau < -0.05) return 0.8 + (0.17 - 0.8) * smooth((tau + 0.55) / 0.5);
      if (tau < 0.3) return 0.17;
      return 0.17 + (0.55 - 0.17) * smooth((tau - 0.3) / 0.7);
    }
    if (tau < -0.5) return 1.1;
    if (tau < 0.1) return 1.1 + (0.45 - 1.1) * smooth((tau + 0.5) / 0.6);
    return 0.45 + (0.9 - 0.45) * smooth((tau - 0.1) / 0.3);
  }

  // Real seconds the replay takes at speed 1; a small fixed-step sum, run once per replay.
  #integrate(rep) {
    let c = rep.from, t = 0;
    while (c < rep.to && t < 30) { c += this.#rate(rep, c - rep.at) * (1 / 120); t += 1 / 120; }
    return t;
  }

  #advance(dt) {
    const rep = this.replay;
    const tau = rep.c - rep.at;
    rep.c += this.#rate(rep, tau) * dt * rep.speed;
    rep.t += dt;
    if (rep.c >= rep.to) { this.#stop(); return; }
    this.#sample(rep.c);
    this.#collectEvents(rep.c);
    this.#direct(rep, dt);
  }

  #collectEvents(c) {
    const out = this.replayEvents;
    out.length = 0;
    while (this.evCursor < this.evCount) {
      const i = (this.evHead - this.evCount + this.evCursor + EVENT_SLOTS * 2) % EVENT_SLOTS;
      if (this.evAt[i] > c) break;
      out.push(this.ev[i]);
      this.evCursor++;
    }
  }

  // Blends the two frames around content time c into the reused output view.
  #sample(c) {
    let lo = 0, hi = this.count - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.#frame(mid).at <= c) lo = mid; else hi = mid;
    }
    const a = this.#frame(lo), b = this.#frame(Math.min(hi, this.count - 1));
    const span = b.at - a.at;
    const k = span > 1e-4 ? Math.max(0, Math.min(1, (c - a.at) / span)) : 0;
    // Past the end of the buffer (the match ended on this kill) the picture holds, with everyone stopped.
    const held = c > b.at + 0.05;
    const n = a.n;
    const out = this.out;
    out.players.length = n;
    for (let i = 0; i < n; i++) {
      const to = this.outPlayers[i], A = a.players[i];
      const B = b.players[i] && b.players[i].id === A.id ? b.players[i] : A;
      copyPlayer(to, k < 0.5 ? A : B);
      if (held) { to.vx = 0; to.vz = 0; }
      if (A.alive === B.alive) {
        const dx = B.x - A.x, dz = B.z - A.z;
        if (dx * dx + dz * dz < 36) {
          to.x = A.x + dx * k; to.z = A.z + dz * k;
          let da = (B.aim - A.aim) % (Math.PI * 2);
          if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
          to.aim = A.aim + da * k;
          to.reloadT = A.reloadT + (B.reloadT - A.reloadT) * k;
          to.adsT = A.adsT + (B.adsT - A.adsT) * k;
        }
      }
      out.players[i] = to;
    }
    const src = k < 0.5 ? a : b;
    out.t = src.t; out.projectiles = src.projectiles; out.smokes = src.smokes; out.turrets = src.turrets;
    out.gunships = src.gunships; out.tags = src.tags; out.points = src.points; out.mode = src.mode;
    if (src.uav) out.uav = src.uav;
  }

  /* ---------- Direction: where the camera is for each moment ---------- */

  #player(id) {
    const list = this.out.players;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Picks the side of the gun with a clear view for this replay, once, so shots do not flip about.
  #pickSide(rep, killer) {
    const surf = this.renderer.surf;
    const aimX = Math.cos(killer.aim), aimZ = Math.sin(killer.aim);
    const test = (s) => {
      for (let d = 1; d <= 5; d++) if (surf.wallAt(killer.x - aimZ * s * d, killer.z + aimX * s * d)) return false;
      return true;
    };
    rep.side = test(1) ? 1 : test(-1) ? -1 : 1;
  }

  // Height the camera needs for its sight line to the subject to pass over everything in between.
  #clearY(px, py, pz, tx, ty, tz) {
    const surf = this.renderer.surf;
    let y = py;
    for (let i = 0; i <= 7; i++) {
      const k = (i / 8) * 0.9, w = surf.wallAt(px + (tx - px) * k, pz + (tz - pz) * k);
      if (!w || w.kind === 'water' || w.h === undefined) continue;
      const need = (w.h + 0.35 - ty * k) / (1 - k);
      if (need > y) y = need;
    }
    return Math.min(y, 16);
  }

  // How much a camera at (x, y, z) would have to rise to see its subject. Zero means a clear shot.
  #blocked(x, y, z, tx, ty, tz) { return this.#clearY(x, y, z, tx, ty, tz) - y; }

  // Of a ring of camera positions around a point, the first (from `pref`) with an open view.
  #openAngle(cx, cz, radius, y, ty, pref) {
    let best = pref, bestRise = Infinity;
    for (let i = 0; i < 16; i++) {
      const a = pref + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
      const rise = this.#blocked(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius, cx, ty, cz);
      if (rise < bestRise - 0.1) { best = a; bestRise = rise; }
      if (rise <= 0) break;
    }
    return best;
  }

  #direct(rep, dt) {
    const shot = this.shot, chars = this.renderer.chars;
    const killer = this.#player(rep.by);
    const tau = rep.c - rep.at;
    const act = rep.kind === 'final' ? (tau < -0.5 ? 0 : tau < 0.06 ? 1 : 2) : (tau < 0.05 ? 3 : 2);
    shot.rate = this.#rate(rep, tau) * rep.speed;
    shot.bars = rep.kind === 'final' ? 0.13 : 0.09;
    shot.desat = rep.kind === 'final' ? 0 : 0.22;

    if (killer && !rep.sidePicked) { this.#pickSide(rep, killer); rep.sidePicked = true; }
    if (tau >= 0 && !rep.shake) { rep.shake = true; this.renderer.addShake(rep.kind === 'final' ? 0.38 : 0.22); }

    // No killer in view (it left, or the kill came from a streak): watch the victim's spot instead.
    const G = this.camGoal;
    const rig = killer ? chars.rigs.get(killer.id) : null;
    const aimX = killer ? Math.cos(killer.aim) : 1, aimZ = killer ? Math.sin(killer.aim) : 0;
    const kx = killer ? killer.x : rep.vx, kz = killer ? killer.z : rep.vz;
    const mx = rig ? rig.muzzle[0] : kx, my = rig ? rig.muzzle[1] : 1.2, mz = rig ? rig.muzzle[2] : kz;
    const S = rep.side;
    let ease = 7;
    if (act === 0) {
      // Over the shoulder, gun in frame, looking down the line of fire.
      G[0] = kx - aimX * 7 - aimZ * S * 3; G[1] = 5; G[2] = kz - aimZ * 7 + aimX * S * 3;
      G[3] = kx + aimX * 1.6; G[4] = 1.15; G[5] = kz + aimZ * 1.6; G[6] = 24;
    } else if (act === 1) {
      // Hard in on the weapon, side-on, for the last rounds. In a tight alley the angle moves to the side that has room,
      // or above the shooter's shoulder when neither does.
      if (rep.gunAngle === undefined) {
        const base = Math.atan2(aimZ, aimX) + (Math.PI / 2) * S;
        rep.gunAngle = this.#openAngle(mx, mz, 4.5, my + 1.5, my, base);
      }
      G[0] = mx + Math.cos(rep.gunAngle) * 4.5; G[1] = my + 1.5; G[2] = mz + Math.sin(rep.gunAngle) * 4.5;
      G[3] = mx - aimX * 0.2; G[4] = my; G[5] = mz - aimZ * 0.2; G[6] = 19;
      ease = 11;
    } else if (act === 2) {
      // The body coming apart. Orbits slowly so the tumbling parts cross the frame.
      const vx = rep.vx, vz = rep.vz;
      const dx = vx - kx, dz = vz - kz, dl = Math.hypot(dx, dz) || 1;
      if (rep.orbit === undefined) rep.orbit = this.#openAngle(vx, vz, 7.6, 4.8, 0.95, Math.atan2(dz / dl, dx / dl) + 0.6 * S);
      const orbit = rep.orbit + tau * 0.32 * S;
      G[0] = vx + Math.cos(orbit) * 7.6; G[1] = 4.8; G[2] = vz + Math.sin(orbit) * 7.6;
      G[3] = vx; G[4] = 0.95; G[5] = vz; G[6] = 22;
      ease = 8;
    } else {
      // Death replay: a higher angle from the killer's side, with both of you in the shot.
      const vx = rep.vx, vz = rep.vz;
      const midX = kx + (vx - kx) * 0.45, midZ = kz + (vz - kz) * 0.45;
      const span = Math.hypot(vx - kx, vz - kz);
      const back = 9 + span * 0.55;
      G[0] = kx - aimX * back - aimZ * S * 3.2; G[1] = 8.4 + span * 0.36; G[2] = kz - aimZ * back + aimX * S * 3.2;
      G[3] = midX; G[4] = 0.9; G[5] = midZ; G[6] = 26;
      ease = 6;
    }
    G[1] = this.#clearY(G[0], G[1], G[2], G[3], G[4], G[5]);

    // New acts cut; within one the camera glides.
    if (!this.camInit || act !== this.lastAct) {
      shot.px = G[0]; shot.py = G[1]; shot.pz = G[2]; shot.tx = G[3]; shot.ty = G[4]; shot.tz = G[5]; shot.fov = G[6];
      this.camInit = true; this.lastAct = act;
    } else {
      const k = damp(ease, dt);
      shot.px += (G[0] - shot.px) * k; shot.py += (G[1] - shot.py) * k; shot.pz += (G[2] - shot.pz) * k;
      shot.tx += (G[3] - shot.tx) * k; shot.ty += (G[4] - shot.ty) * k; shot.tz += (G[5] - shot.tz) * k;
      shot.fov += (G[6] - shot.fov) * k;
    }
    shot.roll = rep.kind === 'final' ? 0.04 * S : 0;
  }

  /* ---------- Banner ---------- */

  #ensureUi() {
    if (this.ui || typeof document === 'undefined') return;
    const el = document.createElement('div');
    // Sits under the score bar on one line. CSS hides the objective strip it would otherwise share that row with.
    el.className = 'killcam-banner';
    el.style.cssText = 'position:fixed;left:0;right:0;top:calc(var(--st,0px) + 44px);display:flex;flex-direction:row;justify-content:center;align-items:baseline;gap:10px;pointer-events:none;z-index:30;font-family:var(--plate-face, system-ui, sans-serif);color:#fff;text-shadow:0 1px 3px #000c;transition:opacity .15s;opacity:0';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:15px;letter-spacing:.32em;text-transform:uppercase;color:#ffcf6b;padding-left:.32em';
    const who = document.createElement('div');
    who.style.cssText = 'font-size:12px;letter-spacing:.12em;opacity:.9';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.textContent = 'SKIP';
    skip.style.cssText = 'position:fixed;right:calc(env(safe-area-inset-right,0px) + 14px);bottom:calc(env(safe-area-inset-bottom,0px) + 14px);pointer-events:auto;min-width:72px;height:44px;padding:0 14px;font:inherit;font-size:13px;letter-spacing:.2em;color:#fff;background:#0009;border:1px solid #fff5;border-radius:8px;touch-action:manipulation;-webkit-tap-highlight-color:transparent';
    skip.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); this.skip(); });
    el.append(title, who, skip);
    (this.root || document.body).appendChild(el);
    this.ui = { el, title, who, skip };
  }

  #showBanner(kind, ev) {
    this.#ensureUi();
    if (!this.ui) return;
    const killer = this.#findName(ev.by);
    this.ui.title.textContent = kind === 'final' ? 'Final Kill' : 'Killcam';
    this.ui.who.textContent = killer ? `Eliminated by ${killer}` : '';
    if (kind === 'final') this.ui.who.textContent = killer ? killer : '';
    this.ui.el.style.opacity = '1';
    document.body.classList.add('killcam-on');
    this.ui.skip.style.display = '';
  }

  #hideBanner() {
    document.body.classList.remove('killcam-on');
    if (this.ui) { this.ui.el.style.opacity = '0'; this.ui.skip.style.display = 'none'; }
  }

  #findName(id) {
    for (let n = 0; n < this.count; n++) {
      const f = this.#frame(this.count - 1 - n);
      for (let i = 0; i < f.n; i++) if (f.players[i].id === id) return f.players[i].name;
    }
    return '';
  }
}
