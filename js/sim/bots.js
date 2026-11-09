// Bot brains. A bot only ever produces an Input and goes through stepPlayer like a human, so the
// weapon rules, sprint-to-fire and spread apply to it unchanged. It only knows what it could know:
// what it sees (cone + hasLineOfSight), what it hears, callouts from teammates, and UAV pings.
//
// Thinking (perception, decisions) runs at 5-12 Hz, staggered across bots. Driving the stick, aim and
// trigger runs every tick, which is what keeps them looking fluid.

import { hasLineOfSight } from '../shared/geometry.js';
import { WEAPONS } from '../shared/weapons.js';
import { angleDiff, stepPlayer } from './player.js';

const DEG = Math.PI / 180;

// aimError: sigma in radians at first sight. aimFloor: sigma once settled (never zero: no aimbots).
export const SKILLS = {
  recruit: {
    thinkHz: 5, reaction: [0.55, 0.95], aimError: 0.2, aimFloor: 0.085, settle: 1.15, turnRate: 5.5, lag: 0.26,
    fov: 110 * DEG, sight: 18, hearing: 10, notice: 0.5, memory: 1.5, close: 3,
    retreatHp: 0, strafe: 0.15, adsUse: 0.3, flank: 0.03, holdProb: 0.15, holdTime: [1, 2.5], slide: 0.02,
    sprint: 0.6, callouts: false, coverReload: 0.1, reloadAt: 0.15, pistolSwap: false, fireTol: 0.15, burst: 0, streakDelay: 6,
  },
  regular: {
    thinkHz: 7, reaction: [0.36, 0.6], aimError: 0.13, aimFloor: 0.05, settle: 0.8, turnRate: 9, lag: 0.18,
    fov: 130 * DEG, sight: 22, hearing: 18, notice: 0.75, memory: 3, close: 4,
    retreatHp: 30, strafe: 0.5, adsUse: 0.65, flank: 0.12, holdProb: 0.33, holdTime: [1.5, 4], slide: 0.1,
    sprint: 0.9, callouts: false, coverReload: 0.5, reloadAt: 0.4, pistolSwap: false, fireTol: 0.1, burst: 0.25, streakDelay: 3,
  },
  veteran: {
    thinkHz: 9, reaction: [0.24, 0.38], aimError: 0.085, aimFloor: 0.03, settle: 0.55, turnRate: 13, lag: 0.13,
    fov: 160 * DEG, sight: 26, hearing: 26, notice: 0.92, memory: 5, close: 5,
    retreatHp: 42, strafe: 0.85, adsUse: 0.9, flank: 0.28, holdProb: 0.45, holdTime: [2, 5], slide: 0.3,
    sprint: 1, callouts: true, coverReload: 0.9, reloadAt: 0.6, pistolSwap: true, fireTol: 0.075, burst: 0.2, streakDelay: 1.5,
  },
  elite: {
    thinkHz: 12, reaction: [0.15, 0.25], aimError: 0.06, aimFloor: 0.018, settle: 0.4, turnRate: 18, lag: 0.09,
    fov: 190 * DEG, sight: 28, hearing: 34, notice: 0.98, memory: 7, close: 6,
    retreatHp: 55, strafe: 1, adsUse: 1, flank: 0.42, holdProb: 0.5, holdTime: [2, 5.5], slide: 0.5,
    sprint: 1, callouts: true, coverReload: 1, reloadAt: 0.7, pistolSwap: true, fireTol: 0.06, burst: 0.15, streakDelay: 0.6,
  },
};

// Preferred fighting distance per weapon, and how the weapon shifts the bot's playstyle.
// `rush`: beyond this range the gun is not worth firing, so sprint the gap instead of plinking.
const STYLE = {
  ar:      { pref: 15, hold: 1,    flank: 1,    advance: 3 },
  smg:     { pref: 7,  hold: 0.55, flank: 1.3,  advance: 3, rush: 15 },
  shotgun: { pref: 4,  hold: 0.5,  flank: 1.5,  advance: 3, rush: 9 },
  lmg:     { pref: 20, hold: 1.6,  flank: 0.5,  advance: 2 },
  sniper:  { pref: 30, hold: 2.2,  flank: 0.3,  advance: 2 },
  pistol:  { pref: 9,  hold: 0.8,  flank: 1,    advance: 3 },
};

// Fractions of the map width from the bot's own side, one per step of a lane advance.
const STAGES = [0.16, 0.36, 0.5, 0.64, 0.84];
const POS = { x: 0, z: 0 };
const PATH_POINTS = 24;

function gaussian(rng) { return (rng() + rng() + rng() + rng() - 2) / 0.577; }
function between(rng, a, b) { return a + (b - a) * rng(); }

export class BotBrain {
  constructor(sim, player, staggerIndex) {
    this.sim = sim;
    this.p = player;
    this.ps = player.ps;
    this.S = SKILLS[player.skill] || SKILLS.regular;
    this.input = { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, reload: false, swap: false, streak: false };
    this.interval = 1 / this.S.thinkHz;
    this.thinkT = this.interval * (staggerIndex % 11) / 11;
    this.path = new Float32Array(PATH_POINTS * 2);
    this.reset();
  }

  // Everything a fresh life forgets.
  reset() {
    const ps = this.ps;
    this.mode = 'none';
    this.laneIdx = -1;
    this.stage = 0;
    this.pathLen = 0; this.pathI = 0; this.pathDirty = false; this.arrived = false;
    this.goalX = ps.x; this.goalZ = ps.z;
    this.target = null; this.targetVisible = false; this.targetDist = 0;
    this.reactLeft = 0; this.trackT = 0; this.anchor = 0; this.anchorT = 0; this.wobble = this.sim.rng() * 6.28;
    this.useAds = false;
    this.knownX = 0; this.knownZ = 0; this.knownT = -99; this.hasKnown = false;
    this.holdT = 0; this.holdAim = 0; this.holdSpot = null; this.modeT = 0;
    this.strafeT = 0; this.strafeDir = 0;
    this.burstLeft = 0; this.burstPause = 0;
    this.wantReload = false; this.wantSwap = false; this.wantSlide = false;
    this.lastFireFlag = false;
    this.stuckT = 0; this.stuckX = ps.x; this.stuckZ = ps.z; this.stuckN = 0; this.escapeT = 0; this.escapeX = 0; this.escapeZ = 0;
    this.sepX = 0; this.sepZ = 0;
    this.moveIntent = false;
    this.streakT = between(this.sim.rng, 0.2, this.S.streakDelay);
    this.style = STYLE[ps.primary] || STYLE.ar;
    this.peek = 0;
    this._assignLane();
  }

  // ---- Knowledge ----

  // soft = shared information (callout, UAV): worth looking at, but only worth chasing if close.
  _note(x, z, soft = false) {
    this.knownX = x; this.knownZ = z; this.knownT = this.sim.time; this.hasKnown = true; this.knownSoft = soft;
  }

  onGunshot(shooter) {
    const S = this.S, ps = this.ps, q = shooter.ps;
    if (this.targetVisible) return;
    const d = Math.hypot(q.x - ps.x, q.z - ps.z);
    if (d > S.hearing) return;
    // Sound gives a position, not a perfect one.
    const blur = 1 + d * 0.12;
    this._note(q.x + (this.sim.rng() - 0.5) * blur, q.z + (this.sim.rng() - 0.5) * blur);
  }

  onDamaged(attacker) {
    const q = attacker.ps;
    this._note(q.x, q.z);
    this.recentlyHitT = this.sim.time;
    // Getting shot wakes you up: the next think is immediate, but reaction time still applies.
    this.thinkT = Math.min(this.thinkT, 0.05);
  }

  _perceive() {
    const { sim, p, ps, S } = this;
    let best = null, bestScore = Infinity, bestD = 0;
    const sameTarget = this.target;
    // Engagements stay on-screen distances; only a scoped rifle reaches further.
    const sightRange = ps.weapon === 'sniper' ? S.sight + 10 : S.sight;
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      if (q.team === p.team || !q.alive || q.spawnProtect > 0) continue;
      const dx = q.ps.x - ps.x, dz = q.ps.z - ps.z;
      const d = Math.hypot(dx, dz);
      if (d > sightRange) continue;
      const tracking = q === sameTarget;
      if (!tracking && d > S.close) {
        if (Math.abs(angleDiff(Math.atan2(dz, dx), ps.aim)) > S.fov / 2) continue;
        if (sim.rng() > S.notice) continue;     // Looking the right way is not the same as noticing.
      }
      if (!hasLineOfSight(sim.map, ps.x, ps.z, q.ps.x, q.ps.z)) continue;
      const score = d - (tracking ? 4 : 0) + q.hp * 0.03;
      if (score < bestScore) { bestScore = score; best = q; bestD = d; }
      if (S.callouts) sim.spotted[p.team][q.index] = sim.time;
    }

    if (best) {
      if (best !== this.target || !this.targetVisible) this._acquire(best, bestD);
      this.target = best; this.targetVisible = true; this.targetDist = bestD;
      this._note(best.ps.x, best.ps.z);
    } else {
      this.targetVisible = false;
      if (this.target && !this.target.alive) this.target = null;
    }

    // Shared info: never targets, only somewhere to look or go.
    if (!best) {
      if (sim.uav[p.team] > 0) this._noteNearest(1e9);
      else if (S.callouts) this._noteNearest(sim.time - 1);
    }
    if (this.hasKnown && sim.time - this.knownT > S.memory) this.hasKnown = false;
  }

  _noteNearest(spottedSince) {
    const { sim, p, ps } = this;
    let bestD = 30, q2 = null;
    const useUav = spottedSince === 1e9;
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      if (q.team === p.team || !q.alive) continue;
      if (!useUav && sim.spotted[p.team][q.index] < spottedSince) continue;
      const d = Math.hypot(q.ps.x - ps.x, q.ps.z - ps.z);
      if (d < bestD) { bestD = d; q2 = q; }
    }
    if (q2) this._note(q2.ps.x, q2.ps.z, true);
  }

  _acquire(q, d) {
    const { S, sim, ps } = this;
    this.reactLeft = between(sim.rng, S.reaction[0], S.reaction[1]);
    if (sim.time - (this.recentlyHitT ?? -9) < 0.5) this.reactLeft *= 0.7;  // Already alert.
    this.reactTotal = this.reactLeft;
    this.trackT = 0;
    this.anchor = gaussian(sim.rng);
    this.anchorT = 0.35;
    this.useAds = (sim.rng() < S.adsUse && d > 6) || ps.weapon === 'sniper' || ps.weapon === 'lmg';
    this.slidIn = false;
    this.strafeT = 0;
    this.burstLeft = 0; this.burstPause = 0;
    // Good players slide into a fight they were sprinting toward.
    if (ps.sprinting && sim.rng() < S.slide * 1.5 && d > 5 && d < 20) this.wantSlide = true;
  }

  // ---- Decisions ----

  think() {
    const { sim, p, ps, S } = this;
    this._perceive();

    // Separation so teammates don't walk in single file or stack in a doorway.
    let sx = 0, sz = 0;
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      if (q === p || q.team !== p.team || !q.alive) continue;
      const dx = ps.x - q.ps.x, dz = ps.z - q.ps.z, dSq = dx * dx + dz * dz;
      if (dSq > 6.25 || dSq < 1e-4) continue;
      const k = (2.5 - Math.sqrt(dSq)) / 2.5 / Math.sqrt(dSq);
      sx += dx * k; sz += dz * k;
    }
    this.sepX = sx; this.sepZ = sz;

    const visible = this.targetVisible;
    const ammo = ps.ammo[ps.slot], mag = WEAPONS[ps.weapon].magazine;

    if (p.streakReady) {
      this.streakT -= this.interval;
      if (this.streakT <= 0) { sim.useStreak(p.id); this.streakT = between(sim.rng, 0.3, S.streakDelay); }
    }

    // Retreat low, reload behind cover.
    if (this.mode === 'cover') {
      this.modeT -= this.interval;
      const healed = p.hp >= 82 && ps.reloadT <= 0;
      if (this.modeT <= 0 || healed || (this.arrived && visible && this.targetDist < 7)) this._setMode('none');
    } else if (S.retreatHp > 0 && p.hp < S.retreatHp && (visible || this.hasKnown) && p.hp < this.lastRetreatHp) {
      this._takeCover();
    } else if (visible && this.targetDist > 8 && (ammo === 0 || ps.reloadT > 0) && sim.rng() < S.coverReload) {
      this._takeCover();
    }
    this.lastRetreatHp = p.hp;

    // A shotgun has no business in the open at range: get behind something and let them come.
    if (visible && ps.weapon === 'shotgun' && this.targetDist > 10.5 && this.mode !== 'hold' && this.mode !== 'cover') {
      // Unless they are looking the other way, in which case this is exactly the moment to close.
      const t = this.target.ps;
      const facingUs = Math.abs(angleDiff(t.aim, Math.atan2(ps.z - t.z, ps.x - t.x))) < 0.9;
      if (facingUs || this.targetDist > 18) this._ambush();
    }

    // Pistol when the primary runs dry mid-fight; back to the main gun when it is over.
    if (S.pistolSwap && visible && ps.slot === 0 && ammo === 0 && this.targetDist < 14) this.wantSwap = true;
    else if (!visible && ps.slot === 1 && ps.swapT <= 0 && (ps.ammo[0] > 0 || ps.reserve[0] > 0)) this.wantSwap = true;

    // Reload when nothing is happening. Recruits only remember when nearly empty.
    if (!visible && ammo / mag <= S.reloadAt && ps.reloadT <= 0) this.wantReload = true;

    if (visible) return;   // drive() fights; the strategic goal stays where it was.

    const worthChasing = this.hasKnown && (!this.knownSoft || Math.hypot(this.knownX - ps.x, this.knownZ - ps.z) < 14);
    if (worthChasing && this.mode !== 'cover' && this.mode !== 'hold' && this.mode !== 'hunt') {
      this._setMode('hunt');
      this.modeT = 6;
      this._goTo(this.knownX, this.knownZ);
    }
    if (this.mode === 'hunt') {
      this.modeT -= this.interval;
      if (this.arrived || this.modeT <= 0 || !this.hasKnown) { this.hasKnown = false; this._setMode('none'); }
    }
    if (this.mode === 'hold') {
      if (this.arrived) this.holdT -= this.interval;
      if (this.holdT <= 0) this._setMode('none');
    }
    if (this.mode === 'advance' || this.mode === 'flank') {
      if (this.arrived) {
        if (this.mode === 'flank') this.stage = 2;   // Turn back in behind whoever is pushing.
        this._setMode('none');
      }
    }
    if (this.mode === 'none') this._pickGoal();
  }

  _setMode(m) { this.mode = m; if (m === 'none') this.arrived = false; }

  _takeCover() {
    const { sim, ps } = this;
    const tx = this.target && this.targetVisible ? this.target.ps.x : this.knownX;
    const tz = this.target && this.targetVisible ? this.target.ps.z : this.knownZ;
    const c = sim.nav.findCover(ps.x, ps.z, tx, tz, sim.rng);
    if (!c) return;
    this.mode = 'cover';
    this.modeT = between(sim.rng, 4, 7);
    this._goTo(c.x, c.z);
    if (ps.ammo[ps.slot] < WEAPONS[ps.weapon].magazine * 0.7) this.wantReload = true;
  }

  _ambush() {
    const { sim, ps, S } = this;
    const t = this.target.ps;
    const c = sim.nav.findCover(ps.x, ps.z, t.x, t.z, sim.rng);
    if (!c) return;
    this.mode = 'hold';
    this.holdSpot = c;
    this.holdAim = Math.atan2(t.z - c.z, t.x - c.x);
    this.holdT = between(sim.rng, S.holdTime[0], S.holdTime[1]);
    this._goTo(c.x, c.z);
  }

  _assignLane() {
    const { sim, p } = this;
    const lanes = sim.map.lanes;
    const counts = [0, 0, 0];
    for (const q of sim.players) {
      if (q !== p && q.team === p.team && q.bot) counts[q.bot.laneIdx] = (counts[q.bot.laneIdx] || 0) + 1;
    }
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < lanes.length; i++) {
      const score = (counts[i] || 0) + sim.rng() * 1.4 + (i === this.laneIdx ? 0.6 : 0);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    this.laneIdx = best;
    this.stage = 0;
  }

  _laneGoal(stage) {
    const { sim, p } = this;
    const W = sim.map.width;
    const f = STAGES[Math.min(stage, STAGES.length - 1)];
    return {
      x: (p.team === 0 ? f : 1 - f) * W + (sim.rng() - 0.5) * 2,
      z: sim.map.lanes[this.laneIdx].z + (sim.rng() - 0.5) * 7,
    };
  }

  _pickGoal() {
    const { sim, S, style } = this;
    const r = sim.rng();
    if (r < S.flank * style.flank && this.stage >= 1) {
      // Rotate to a different lane and push past the fight.
      const prev = this.laneIdx;
      this.laneIdx = (prev + 1 + Math.floor(sim.rng() * 2)) % sim.map.lanes.length;
      const g = this._laneGoal(4);
      this.mode = 'flank';
      this._goTo(g.x, g.z);
      return;
    }
    if (r < S.flank * style.flank + S.holdProb * style.hold && this._goHold()) return;

    this.stage++;
    if (this.stage > style.advance + (S.flank > 0.2 ? 1 : 0)) this._assignLane(), this.stage = 1;
    const g = this._laneGoal(this.stage);
    this.mode = 'advance';
    this._goTo(g.x, g.z);
  }

  // Goes to a nearby spot with a good sightline and watches down it for a few seconds.
  _goHold() {
    const { sim, p, ps, S } = this;
    let best = null, bestScore = Infinity;
    const laneZ = sim.map.lanes[this.laneIdx].z;
    for (const h of sim.nav.holds) {
      const d = Math.hypot(h.x - ps.x, h.z - ps.z);
      if (d > 11 || h.sight[p.team] < 12) continue;
      if (Math.abs(h.z - laneZ) > 9) continue;    // Holding is part of playing this lane, not leaving it.
      if (this._teammateNear(h.x, h.z, 3)) continue;
      // Stay on our side of the action; a hold point deep in enemy ground is just a bad position.
      const depth = (p.team === 0 ? h.x : sim.map.width - h.x) / sim.map.width;
      const score = d * 0.5 - h.sight[p.team] * 0.25 + (depth > 0.72 ? 8 : 0) + sim.rng() * 6;
      if (score < bestScore) { bestScore = score; best = h; }
    }
    if (!best) return false;
    this.mode = 'hold';
    this.holdSpot = best;
    this.holdAim = best.aim[p.team];
    this.holdT = between(sim.rng, S.holdTime[0], S.holdTime[1]);
    this._goTo(best.x, best.z);
    return true;
  }

  _teammateNear(x, z, r) {
    const { sim, p } = this;
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      if (q === p || q.team !== p.team || !q.alive) continue;
      if (Math.hypot(q.ps.x - x, q.ps.z - z) < r) return true;
    }
    return false;
  }

  _goTo(x, z) {
    this.goalX = x; this.goalZ = z;
    this.arrived = false;
    this.pathDirty = true;
  }

  _solvePath() {
    const { sim, ps } = this;
    if (sim.pathBudget <= 0) return;
    sim.pathBudget--;
    this.pathDirty = false;
    this.pathLen = sim.nav.findPath(ps.x, ps.z, this.goalX, this.goalZ, this.path, PATH_POINTS);
    this.pathI = 0;
    if (this.pathLen === 0) this.arrived = true;
  }

  // ---- Driving, every tick ----

  // Steers along the current path into (I.mx, I.mz). Returns true while still travelling.
  _followPath(sprintOk) {
    const { ps, path, input: I, S, sim } = this;
    if (this.arrived || this.pathLen === 0) return false;
    let wx = path[this.pathI * 2], wz = path[this.pathI * 2 + 1];
    let dx = wx - ps.x, dz = wz - ps.z, d = Math.hypot(dx, dz);
    if (d < 0.75) {
      this.pathI++;
      if (this.pathI >= this.pathLen) { this.arrived = true; return false; }
      wx = path[this.pathI * 2]; wz = path[this.pathI * 2 + 1];
      dx = wx - ps.x; dz = wz - ps.z; d = Math.hypot(dx, dz);
    }
    if (d < 1e-4) return true;
    I.mx = dx / d; I.mz = dz / d;
    // Only sprint when the road ahead is long enough to be worth it.
    let remaining = d;
    if (this.pathI + 1 < this.pathLen) remaining += 3;
    I.sprint = sprintOk && remaining > 3 && (S.sprint >= 1 || this.sprintRoll);
    // Occasional slides on a straight run read as a player having fun, and carry speed.
    if (I.sprint && remaining > 7 && sim.rng() < S.slide * sim.dt) this.wantSlide = true;
    return true;
  }

  _combatMove(q, d, dt) {
    const { ps, S, input: I, sim } = this;
    const style = STYLE[ps.weapon] || STYLE.ar;
    const ux = (q.ps.x - ps.x) / d, uz = (q.ps.z - ps.z) / d;
    const atHold = this.mode === 'hold' && this.arrived;
    let fwd = 0;
    if (!atHold) {
      if (d > style.pref + 4) fwd = 1;
      else if (d < style.pref - 3 && style.pref >= 12) fwd = -0.85;
    }

    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = between(sim.rng, 0.3, 1.1);
      this.strafeDir = sim.rng() < S.strafe ? (sim.rng() < 0.5 ? -1 : 1) : 0;
    }

    let mx = ux * fwd - uz * this.strafeDir, mz = uz * fwd + ux * this.strafeDir;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    if (len > 0.01 && !sim.nav.isWalkable(ps.x + mx * 1.3, ps.z + mz * 1.3)) {
      this.strafeDir = -this.strafeDir;
      mx = ux * fwd - uz * this.strafeDir; mz = uz * fwd + ux * this.strafeDir;
      if (!sim.nav.isWalkable(ps.x + mx * 1.3, ps.z + mz * 1.3)) { mx = 0; mz = 0; }
    }
    I.mx = mx; I.mz = mz;
  }

  _trigger(q, d, perceived, dt) {
    const { ps, S, input: I, sim } = this;
    const w = WEAPONS[ps.weapon];
    const offAim = Math.abs(angleDiff(ps.aim, perceived));
    // Tolerance widens up close, where the target covers more of the view.
    const tol = S.fireTol + Math.atan2(0.5, Math.max(d, 1)) * 0.6;
    let fire = this.reactLeft <= 0 && offAim < tol && ps.swapT <= 0 && d <= w.range && ps.ammo[ps.slot] > 0;

    if (ps.weapon === 'sniper' && ps.adsT < 0.85) fire = false;
    if (ps.weapon === 'shotgun' && d > 12) fire = false;

    // Burst control at range: real players stop to let the gun settle.
    if (fire && w.auto && S.burst > 0 && d > 18 && ps.weapon !== 'lmg') {
      if (this.burstPause > 0) { this.burstPause -= dt; fire = false; }
      else if (ps.shotIndex >= 5 + (this.burstLeft | 0)) {
        this.burstPause = between(sim.rng, 0.12, S.burst + 0.25);
        this.burstLeft = Math.floor(sim.rng() * 3);
        fire = false;
      }
    }

    // Semi-auto guns need the trigger released between shots.
    if (fire && !w.auto && this.lastFireFlag) fire = false;
    this.lastFireFlag = fire;
    I.fire = fire;
  }

  drive(dt) {
    const { sim, p, ps, S, input: I } = this;
    I.mx = 0; I.mz = 0; I.sprint = false; I.aiming = false; I.fire = false;

    let desired = null;
    const q = this.target;
    const fighting = this.targetVisible && q && q.alive;

    if (fighting) {
      sim.posAt(q, S.lag, POS);          // The bot aims at where it perceives the target, slightly old.
      const dx = POS.x - ps.x, dz = POS.z - ps.z;
      const d = Math.max(0.3, Math.hypot(dx, dz));
      const trueAng = Math.atan2(dz, dx);

      if (this.reactLeft > 0) this.reactLeft -= dt;
      this.trackT += dt;
      this.anchorT -= dt;
      if (this.anchorT <= 0) { this.anchorT = 0.35; this.anchor = gaussian(sim.rng); }
      this.wobble += dt * 3.1;

      const sigma = S.aimFloor + (S.aimError - S.aimFloor) * Math.exp(-this.trackT / S.settle);
      const err = sigma * (this.anchor * 0.85 + Math.sin(this.wobble) * 0.5);
      // Half way through the reaction window the head starts to come around.
      if (this.reactLeft < this.reactTotal * 0.55) desired = trueAng + err;

      const style = STYLE[ps.weapon];
      const rushing = style.rush && d > style.rush && this.mode !== 'cover' && this.mode !== 'hold';
      if (!rushing) this._trigger(q, d, trueAng, dt);
      if ((this.mode === 'cover' || this.mode === 'hold') && !this.arrived) this._followPath(false);
      else this._combatMove(q, d, dt);
      if (rushing) {
        I.sprint = S.sprint >= 1 || this.sprintRoll;
      } else if (style.rush && !this.slidIn && ps.sprinting) {
        this.slidIn = true;       // Arrived in range at a sprint: slide in shooting.
        if (sim.rng() < S.slide * 2) this.wantSlide = true;
      }
      I.aiming = this.useAds && this.reactLeft <= 0 && !rushing;
      // Sprinters and rushers on a close weapon don't bother scoping in.
      if ((ps.weapon === 'smg' && d < 8) || (ps.weapon === 'shotgun' && d < 4.5)) I.aiming = false;
      else if (ps.weapon === 'shotgun' && this.reactLeft <= 0 && !rushing) I.aiming = true;
      // Don't sprint while fighting; left stick is already at walking pace.
    } else {
      this.moving = this._followPath(true);
      if (this.moving) I.sprint = I.sprint && !(this.mode === 'hunt' && S.sprint < 1);
      if (this.hasKnown) {
        // Pre-aim where the noise or last sighting was.
        desired = Math.atan2(this.knownZ - ps.z, this.knownX - ps.x);
        if (this.mode === 'hold' && this.arrived) I.aiming = true;
      } else if (this.mode === 'hold' && this.arrived) {
        this.peek += dt * 1.2;
        desired = this.holdAim + Math.sin(this.peek) * 0.28;
        I.aiming = ps.weapon === 'sniper' || ps.weapon === 'lmg' || S.adsUse > 0.8;
      } else if (this.moving) {
        desired = Math.atan2(I.mz, I.mx);
      }
    }

    // Soft separation, only while walking the map.
    if (!fighting && this.moving && (this.sepX || this.sepZ)) {
      I.mx += this.sepX * 0.5; I.mz += this.sepZ * 0.5;
      const len = Math.hypot(I.mx, I.mz);
      if (len > 1) { I.mx /= len; I.mz /= len; }
    }

    if (this.escapeT > 0) {
      this.escapeT -= dt;
      I.mx = this.escapeX; I.mz = this.escapeZ; I.sprint = false;
    }

    // Turn rate cap plus easing: the aim travels, it never teleports.
    if (desired !== null) {
      const d = angleDiff(desired, ps.aim);
      const ease = d * Math.min(1, dt * 16);
      const lim = S.turnRate * dt;
      I.aim = ps.aim + Math.max(-lim, Math.min(lim, ease));
    } else {
      I.aim = ps.aim;
    }

    if (this.wantReload) { I.reload = true; this.wantReload = false; }
    if (this.wantSwap) { I.swap = true; this.wantSwap = false; }
    if (this.wantSlide) { I.slide = true; this.wantSlide = false; }
  }

  _trackStuck(dt) {
    const { ps, sim } = this;
    this.stuckT += dt;
    if (this.stuckT < 0.8) return;
    const moved = Math.hypot(ps.x - this.stuckX, ps.z - this.stuckZ);
    const wanted = this.pathLen > 0 && !this.arrived && !this.targetVisible && this.mode !== 'none';
    this.stuckT = 0; this.stuckX = ps.x; this.stuckZ = ps.z;
    if (!wanted || moved > 0.5) { this.stuckN = 0; return; }
    this.stuckN++;
    this.pathDirty = true;
    if (this.stuckN >= 2) {
      // Repathing didn't help: wiggle free, then choose somewhere else entirely.
      const a = sim.rng() * Math.PI * 2;
      this.escapeX = Math.cos(a); this.escapeZ = Math.sin(a); this.escapeT = 0.4;
    }
    if (this.stuckN >= 4) { this.stuckN = 0; this._setMode('none'); this.hasKnown = false; }
  }

  update(dt) {
    const { sim, ps, input: I } = this;
    this.sprintRoll = true;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT += this.interval;
      if (this.S.sprint < 1) this.sprintLucky = sim.rng() < this.S.sprint;
      this.think();
    }
    this.sprintRoll = this.sprintLucky !== false;
    if (this.pathDirty) this._solvePath();
    this.drive(dt);
    const shots = stepPlayer(ps, I, dt, sim.map, sim.rng);
    I.reload = false; I.swap = false; I.slide = false;
    this._trackStuck(dt);
    return shots;
  }
}
