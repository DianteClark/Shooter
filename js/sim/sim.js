// Host-authoritative match simulation: HP, kills, score, respawns, streaks, bots, match phase.
// Humans own their own movement and shots (see docs/ARCHITECTURE.md), and report them here.

import { MAX_HP, PLAYER_RADIUS, RESPAWN_TIME, SCORE_LIMIT, SIM_HZ, SPAWN_PROTECT, TEAM_SIZE, TIME_LIMIT, WEAPON_IDS } from '../shared/constants.js';
import { hasLineOfSight } from '../shared/geometry.js';
import { MAPS, DEFAULT_MAP } from '../shared/map.js';
import { damageAt, WEAPONS } from '../shared/weapons.js';
import { BotBrain } from './bots.js';
import { NavGrid } from './nav.js';
import { createPlayerState, respawnPlayer, traceShot } from './player.js';

const STEP = 1 / SIM_HZ;
const MAX_CATCHUP_STEPS = 6;     // After a stall, drop time rather than spiral.
const WARMUP = 3;
const HISTORY = 12;              // Ring of past positions: ~400 ms at 30 Hz.
const MAX_REWIND = 0.3;

const REGEN_DELAY = 3.8;
const REGEN_RATE = 34;
const ASSIST_WINDOW = 8;
const ASSIST_MIN_DAMAGE = 25;
const CHAIN_WINDOW = 3.5;        // Seconds between kills for double/triple/fury.
const LONGSHOT = 26;

const UAV_KILLS = 3, STRIKE_KILLS = 5, UAV_TIME = 20;
const STRIKE_DELAY = 1.3, STRIKE_STEP = 0.2, STRIKE_COUNT = 5, STRIKE_SPACING = 4.6;
const STRIKE_RADIUS = 5.2, STRIKE_DAMAGE = 135;

const PHASES = ['warmup', 'live', 'ended'];
const BOT_NAMES = ['Rook', 'Mako', 'Vesper', 'Dagger', 'Quill', 'Sable', 'Ember', 'Tarn', 'Pike', 'Onyx', 'Fable', 'Ghoul', 'Brine', 'Cinder', 'Wick', 'Hex'];
const BOT_PRIMARIES = ['ar', 'smg', 'lmg', 'shotgun', 'ar', 'sniper', 'smg', 'ar'];
const MIXED_SKILLS = ['regular', 'veteran', 'veteran', 'regular', 'elite', 'recruit'];

function round2(v) { return Math.round(v * 100) / 100; }

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fills both teams up to teamSize with named bots of varied loadouts.
export function buildRoster(humans, { botSkill = 'mixed', teamSize = TEAM_SIZE } = {}) {
  const roster = humans.map(h => ({
    id: h.id, name: h.name, team: h.team, isBot: false, skill: null,
    primary: h.primary || 'ar', camo: h.camo || 'none',
  }));
  let nameI = 0, weaponI = 0, n = 0;
  for (let team = 0; team < 2; team++) {
    let count = roster.filter(r => r.team === team).length;
    // Offset the loadout cycle per team so the two sides are not mirror images.
    weaponI = team * 3;
    for (; count < teamSize; count++, n++) {
      roster.push({
        id: `bot${n}`, name: BOT_NAMES[nameI++ % BOT_NAMES.length], team, isBot: true,
        skill: botSkill === 'mixed' ? MIXED_SKILLS[n % MIXED_SKILLS.length] : botSkill,
        primary: BOT_PRIMARIES[weaponI++ % BOT_PRIMARIES.length], camo: 'none',
      });
    }
  }
  return roster;
}

export class Sim {
  constructor({ roster, map, seed = 1, scoreLimit = SCORE_LIMIT, timeLimit = TIME_LIMIT }) {
    this.map = typeof map === 'string' ? MAPS[map] : (map || MAPS[DEFAULT_MAP]);
    this.rng = mulberry32(seed >>> 0);
    this.scoreLimit = scoreLimit;
    this.timeLimit = timeLimit;
    this.dt = STEP;
    this.time = 0;
    this.tick = 0;
    this.accum = 0;
    this.phase = 'warmup';
    this.phaseT = WARMUP;
    this.timeLeft = timeLimit;
    this.scores = [0, 0];
    this.winner = null;
    this.uav = [0, 0];
    this.lastKill = null;
    this.firstBlood = false;
    this.events = [];
    this.strikes = [];
    this.pathBudget = 0;
    this.nav = null;     // Built on first step; guests only decode snapshots and never need it.
    this._encodes = 0;
    this._camoDirty = true;
    this._scratch = [];

    const n = roster.length;
    this.players = roster.map((r, index) => ({
      id: r.id, name: r.name, team: r.team, isBot: !!r.isBot, skill: r.skill ?? null,
      primary: r.primary, camo: r.camo, index,
      ps: createPlayerState({ id: r.id, primary: r.primary, camo: r.camo }),
      hp: MAX_HP, alive: true, respawnT: 0, spawnProtect: 0,
      kills: 0, deaths: 0, assists: 0, streak: 0, chain: 0, lastKillT: -99,
      lastKilledBy: null, streakUav: false, streakStrike: false,
      regenT: 0, dmgBy: new Float32Array(n), dmgT: new Float32Array(n).fill(-99),
      hx: new Float32Array(HISTORY), hz: new Float32Array(HISTORY),
      prevReload: false, prevWeapon: r.primary, prevSliding: false,
      ackX: 0, ackZ: 0, ackT: 0,
      bot: null,
    }));
    for (const p of this.players) p.streakReady = null;
    this.byId = new Map(this.players.map(p => [p.id, p]));
    this.spotted = [new Float32Array(n).fill(-99), new Float32Array(n).fill(-99)];
    this.spawnUsedAt = new Map();
    this._emit({ t: 'phase', phase: 'warmup' });
    this._spawnAll();
  }

  _emit(e) { this.events.push(e); }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---- Spawning ----

  _spawnAll() {
    const used = new Set();
    for (const p of this.players) {
      const list = this.map.spawns[p.team];
      let s;
      for (let tries = 0; tries < 24; tries++) {
        s = list[Math.floor(this.rng() * list.length)];
        if (!used.has(s)) break;
      }
      used.add(s);
      this._placeAt(p, s, s.aim);
    }
  }

  _placeAt(p, s, aim) {
    respawnPlayer(p.ps, s.x, s.z, aim, { primary: p.primary, camo: p.camo });
    p.hp = MAX_HP; p.alive = true; p.respawnT = 0; p.spawnProtect = SPAWN_PROTECT;
    p.regenT = 0; p.dmgBy.fill(0);
    p.prevReload = false; p.prevWeapon = p.ps.weapon; p.prevSliding = false;
    for (let i = 0; i < HISTORY; i++) { p.hx[i] = s.x; p.hz[i] = s.z; }
    // Ignore a human's stale in-flight states until their phone has processed this spawn.
    if (!p.isBot) { p.ackX = s.x; p.ackZ = s.z; p.ackT = 1.5; }
    if (p.bot) p.bot.reset();
    this._emit({ t: 'spawn', id: p.id, x: s.x, z: s.z, aim: round2(aim) });
  }

  // Own side preferred; any point an enemy can see, or that was just used, is heavily penalised.
  _respawn(p) {
    let best = null, bestScore = -Infinity;
    const enemyTeam = 1 - p.team;
    for (let t = 0; t < 2; t++) {
      for (const s of this.map.spawns[t]) {
        let nearest = 200, seen = false;
        for (const q of this.players) {
          if (q.team !== enemyTeam || !q.alive) continue;
          const d = Math.hypot(q.ps.x - s.x, q.ps.z - s.z);
          if (d < nearest) nearest = d;
          if (!seen && d < 36 && hasLineOfSight(this.map, s.x, s.z, q.ps.x, q.ps.z)) seen = true;
        }
        const usedAgo = this.time - (this.spawnUsedAt.get(s) ?? -99);
        const score = nearest + (t === p.team ? 14 : 0) - (seen ? 22 : 0) - (usedAgo < 2.5 ? 12 : 0) + this.rng() * 3;
        if (score > bestScore) { bestScore = score; best = s; }
      }
    }
    this.spawnUsedAt.set(best, this.time);
    // Face the middle of the map, whichever side this spawn is on.
    const aim = Math.atan2(this.map.height / 2 - best.z, this.map.width / 2 - best.x);
    const facing = Math.abs(Math.cos(aim)) > 0.5 ? (best.x < this.map.width / 2 ? 0 : Math.PI) : aim;
    this._placeAt(p, best, facing);
  }

  // ---- Stepping ----

  // Accumulates dt into fixed SIM_HZ ticks. Passing exactly 1/SIM_HZ runs exactly one tick.
  step(dt) {
    if (!this.nav) this._initBots();
    this.accum += dt;
    let steps = 0;
    while (this.accum >= STEP - 1e-9) {
      this.accum -= STEP;
      if (steps++ >= MAX_CATCHUP_STEPS) { this.accum = 0; break; }
      this._tick();
    }
  }

  _initBots() {
    this.nav = new NavGrid(this.map);
    let stagger = 0;
    for (const p of this.players) if (p.isBot) p.bot = new BotBrain(this, p, stagger++);
  }

  _tick() {
    this.tick++;
    this.time += STEP;
    this.pathBudget = 2;

    if (this.phase === 'warmup') {
      this.phaseT -= STEP;
      if (this.phaseT <= 0) this._setPhase('live');
    } else if (this.phase === 'live') {
      this.timeLeft -= STEP;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this._end(this.scores[0] === this.scores[1] ? null : (this.scores[0] > this.scores[1] ? 0 : 1));
      }
    }

    if (this.phase === 'live') {
      for (let t = 0; t < 2; t++) if (this.uav[t] > 0) this.uav[t] = Math.max(0, this.uav[t] - STEP);
      this._stepStrikes();
      const players = this.players;
      for (let i = 0; i < players.length; i++) this._stepTimers(players[i]);
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (!p.bot || !p.alive) continue;
        const shots = p.bot.update(STEP);
        for (let s = 0; s < shots.length; s++) this.applyShot(p.id, shots[s], 0);
        this._diffFx(p);
      }
    }

    const h = this.tick % HISTORY;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      p.hx[h] = p.ps.x; p.hz[h] = p.ps.z;
    }
  }

  _stepTimers(p) {
    if (p.ackT > 0) p.ackT -= STEP;
    if (!p.alive) {
      p.respawnT -= STEP;
      if (p.respawnT <= 0) this._respawn(p);
      return;
    }
    if (p.spawnProtect > 0) p.spawnProtect = Math.max(0, p.spawnProtect - STEP);
    if (p.regenT > 0) p.regenT -= STEP;
    else if (p.hp < MAX_HP) p.hp = Math.min(MAX_HP, p.hp + REGEN_RATE * STEP);
  }

  _setPhase(phase) {
    this.phase = phase;
    this._emit({ t: 'phase', phase });
  }

  _end(winner) {
    this.winner = winner;
    this._setPhase('ended');
  }

  // Past position of a player. Writes into out and returns it, to avoid garbage.
  posAt(p, age, out) {
    const back = Math.min(age, MAX_REWIND) * SIM_HZ;
    const k = Math.floor(back), f = back - k;
    const i0 = (((this.tick - k) % HISTORY) + HISTORY) % HISTORY;
    const i1 = (i0 + HISTORY - 1) % HISTORY;
    out.x = p.hx[i0] + (p.hx[i1] - p.hx[i0]) * f;
    out.z = p.hz[i0] + (p.hz[i1] - p.hz[i0]) * f;
    return out;
  }

  // ---- Human input from the network ----

  applyHumanState(id, d) {
    const p = this.byId.get(id);
    if (!p || p.isBot || !p.alive) return;
    if (p.ackT > 0) {
      if (Math.hypot(d.x - p.ackX, d.z - p.ackZ) > 5) return;
      p.ackT = 0;
    }
    const ps = p.ps;
    ps.x = d.x; ps.z = d.z; ps.aim = d.aim; ps.vx = d.vx; ps.vz = d.vz;
    ps.slot = d.slot; ps.primary = d.primary; ps.weapon = d.weapon;
    ps.sprinting = d.sprinting; ps.sliding = d.sliding;
    ps.ammo[0] = d.ammo[0]; ps.ammo[1] = d.ammo[1];
    ps.reserve[0] = d.reserve[0]; ps.reserve[1] = d.reserve[1];
    ps.reloadT = d.reloadT; ps.reloadDur = d.reloadDur;
    ps.adsT = d.adsT; ps.bloom = d.bloom;
    p.primary = d.primary;
    if (d.camo && d.camo !== p.camo) { p.camo = d.camo; ps.camo = d.camo; this._camoDirty = true; }
    this._diffFx(p);
  }

  // Sets the loadout used at the next spawn.
  setLoadout(id, { primary, camo } = {}) {
    const p = this.byId.get(id);
    if (!p) return;
    if (primary && WEAPONS[primary]) p.primary = primary;
    if (camo && camo !== p.camo) { p.camo = camo; this._camoDirty = true; }
  }

  // Turns state changes into the reload/swap/slide events, the same way for bots and humans.
  _diffFx(p) {
    const ps = p.ps;
    const reloading = ps.reloadT > 0;
    if (reloading !== p.prevReload) {
      this._emit({ t: 'reload', id: p.id, stage: reloading ? 'start' : 'end' });
      p.prevReload = reloading;
    }
    if (ps.weapon !== p.prevWeapon) {
      this._emit({ t: 'swap', id: p.id });
      p.prevWeapon = ps.weapon;
    }
    if (ps.sliding !== p.prevSliding) {
      if (ps.sliding) this._emit({ t: 'slide', id: p.id });
      p.prevSliding = ps.sliding;
    }
  }

  // Applies a shot fired `ageSeconds` ago. Pass ping/2 plus the shooter's interpolation delay, so
  // targets are rewound to where the shooter actually saw them.
  applyShot(id, shot, ageSeconds = 0) {
    const shooter = this.byId.get(id);
    if (!shooter || !shooter.alive || this.phase === 'ended') return;
    const w = WEAPONS[shot.weapon];
    if (!w) return;

    const age = Math.min(Math.max(0, ageSeconds), MAX_REWIND);
    const scratch = this._scratch;
    scratch.length = this.players.length;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const e = scratch[i] || (scratch[i] = { id: null, team: 0, alive: false, x: 0, z: 0 });
      e.id = p.id; e.team = p.team; e.alive = p.alive;
      if (age > 0) this.posAt(p, age, e);
      else { e.x = p.ps.x; e.z = p.ps.z; }
    }
    const rays = traceShot(shot, this.map, scratch, id);

    const lean = new Array(rays.length);
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i];
      lean[i] = { x: round2(r.x), z: round2(r.z), hit: r.hit, nx: round2(r.nx), nz: round2(r.nz) };
    }
    this._emit({ t: 'shot', by: id, weapon: shot.weapon, camo: shooter.camo,
      ox: round2(shot.ox), oz: round2(shot.oz), aim: round2(shot.aim), rays: lean });
    this._alertBots(shooter);

    if (this.phase !== 'live') return;
    shooter.spawnProtect = 0;      // Shooting gives up your protection.

    const ads = shot.ads ?? (shooter.ps.adsT >= 0.85);
    for (let i = 0; i < rays.length; i++) {
      if (rays[i].hit !== 'player') continue;
      // Sum all pellets on one target into a single hit.
      const targetId = rays[i].id;
      let dmg = 0, count = 0, dist = 0;
      for (let j = i; j < rays.length; j++) {
        if (rays[j].hit !== 'player' || rays[j].id !== targetId) continue;
        dist = Math.hypot(rays[j].x - shot.ox, rays[j].z - shot.oz);
        dmg += damageAt(w, dist, ads);
        count++;
        if (j !== i) rays[j].hit = 'counted';
      }
      this._damage(this.byId.get(targetId), shooter, dmg, shot.weapon, dist, false);
    }
  }

  _alertBots(shooter) {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.bot && p.alive && p.team !== shooter.team) p.bot.onGunshot(shooter);
    }
  }

  // ---- Damage, kills, medals ----

  _damage(target, attacker, dmg, weapon, dist, isStrike) {
    if (!target || !target.alive || target.spawnProtect > 0 || target.team === attacker.team) return;
    target.hp -= dmg;
    target.regenT = REGEN_DELAY;
    target.dmgBy[attacker.index] += dmg;
    target.dmgT[attacker.index] = this.time;
    const killed = target.hp <= 0;
    this._emit({ t: 'hit', by: attacker.id, target: target.id, dmg: Math.round(dmg),
      x: round2(target.ps.x), z: round2(target.ps.z), killed });
    if (target.bot) target.bot.onDamaged(attacker);
    if (killed) this._kill(target, attacker, weapon, dist, isStrike);
  }

  _kill(target, killer, weapon, dist, isStrike) {
    target.hp = 0; target.alive = false; target.respawnT = RESPAWN_TIME;
    target.deaths++; target.streak = 0; target.chain = 0; target.spawnProtect = 0;
    target.lastKilledBy = killer.id;
    killer.kills++;
    this.scores[killer.team]++;

    let assist = null, bestDmg = ASSIST_MIN_DAMAGE;
    for (let i = 0; i < this.players.length; i++) {
      const q = this.players[i];
      if (q === killer || q.team === target.team) continue;
      const done = target.dmgBy[i];
      if (done >= bestDmg && this.time - target.dmgT[i] < ASSIST_WINDOW) { bestDmg = done; assist = q; }
    }
    if (assist) assist.assists++;
    target.dmgBy.fill(0);

    const kill = { t: 'kill', by: killer.id, target: target.id, weapon, camo: killer.camo,
      x: round2(target.ps.x), z: round2(target.ps.z), assist: assist ? assist.id : null, dist: round2(dist) };
    if (isStrike) kill.streak = 'strike';   // weapon stays a real gun id, so consumers need no special case.
    this._emit(kill);
    this.lastKill = { by: killer.id, target: target.id, weapon, camo: killer.camo, x: kill.x, z: kill.z };

    if (!this.firstBlood) { this.firstBlood = true; this._medal(killer, 'first_blood'); }
    if (killer.lastKilledBy === target.id) { killer.lastKilledBy = null; this._medal(killer, 'revenge'); }
    if (!isStrike && dist >= LONGSHOT) this._medal(killer, 'longshot');

    killer.chain = this.time - killer.lastKillT <= CHAIN_WINDOW ? killer.chain + 1 : 1;
    killer.lastKillT = this.time;
    if (killer.chain === 2) this._medal(killer, 'double');
    else if (killer.chain === 3) this._medal(killer, 'triple');
    else if (killer.chain >= 4) this._medal(killer, 'fury');

    // Strike kills score but do not feed the streak that earned them.
    if (!isStrike) {
      killer.streak++;
      if (killer.streak === 3) this._medal(killer, 'streak3');
      else if (killer.streak === 5) this._medal(killer, 'streak5');
      else if (killer.streak === 10) this._medal(killer, 'streak10');
      if (killer.streak === UAV_KILLS) killer.streakUav = true;
      if (killer.streak === STRIKE_KILLS) killer.streakStrike = true;
      this._updateStreakReady(killer);
    }

    if (this.scores[killer.team] >= this.scoreLimit) this._end(killer.team);
  }

  _medal(p, medal) { this._emit({ t: 'medal', id: p.id, medal }); }

  _updateStreakReady(p) {
    p.streakReady = p.streakStrike ? 'strike' : (p.streakUav ? 'uav' : null);
  }

  // ---- Streaks ----

  // Consumes the ready streak (Strike first if both are held). Returns its kind, or null.
  useStreak(id) {
    const p = this.byId.get(id);
    if (!p || this.phase !== 'live' || !p.alive) return null;
    if (p.streakStrike) {
      const spot = this._strikeTarget(p);
      if (!spot) return null;   // No live enemies: keep it rather than waste it.
      p.streakStrike = false;
      this._updateStreakReady(p);
      this._emit({ t: 'streak', id, kind: 'strike', team: p.team, x: round2(spot.x), z: round2(spot.z) });
      for (let i = 0; i < STRIKE_COUNT; i++) {
        const k = i - (STRIKE_COUNT - 1) / 2;
        this.strikes.push({
          at: this.time + STRIKE_DELAY + i * STRIKE_STEP, by: p,
          x: Math.max(1, Math.min(this.map.width - 1, spot.x + spot.dx * k * STRIKE_SPACING)),
          z: Math.max(1, Math.min(this.map.height - 1, spot.z + spot.dz * k * STRIKE_SPACING)),
        });
      }
      return 'strike';
    }
    if (p.streakUav) {
      p.streakUav = false;
      this._updateStreakReady(p);
      this.uav[p.team] = UAV_TIME;
      this._emit({ t: 'streak', id, kind: 'uav', team: p.team });
      return 'uav';
    }
    return null;
  }

  // Centre of the densest enemy cluster, and a line direction along its long axis.
  _strikeTarget(p) {
    let best = null, bestCount = 0;
    for (const a of this.players) {
      if (a.team === p.team || !a.alive) continue;
      let count = 0, sumX = 0, sumZ = 0;
      for (const b of this.players) {
        if (b.team === p.team || !b.alive) continue;
        if (Math.hypot(a.ps.x - b.ps.x, a.ps.z - b.ps.z) < 9) { count++; sumX += b.ps.x; sumZ += b.ps.z; }
      }
      if (count > bestCount) { bestCount = count; best = { x: sumX / count, z: sumZ / count }; }
    }
    if (!best) return null;
    let spreadX = 0, spreadZ = 0;
    for (const b of this.players) {
      if (b.team === p.team || !b.alive || Math.hypot(b.ps.x - best.x, b.ps.z - best.z) > 9) continue;
      spreadX = Math.max(spreadX, Math.abs(b.ps.x - best.x));
      spreadZ = Math.max(spreadZ, Math.abs(b.ps.z - best.z));
    }
    best.dx = spreadX >= spreadZ ? 1 : 0;
    best.dz = spreadX >= spreadZ ? 0 : 1;
    return best;
  }

  _stepStrikes() {
    if (this.strikes.length === 0) return;
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      if (s.at > this.time) continue;
      this.strikes.splice(i, 1);
      this._emit({ t: 'explosion', x: round2(s.x), z: round2(s.z), radius: STRIKE_RADIUS, by: s.by.id });
      for (const q of this.players) {
        if (q.team === s.by.team || !q.alive) continue;
        const d = Math.hypot(q.ps.x - s.x, q.ps.z - s.z);
        if (d > STRIKE_RADIUS) continue;
        // Hard cover protects: a building between you and the blast saves your life.
        if (!hasLineOfSight(this.map, s.x, s.z, q.ps.x, q.ps.z)) continue;
        const dmg = STRIKE_DAMAGE * (1 - 0.65 * (d / STRIKE_RADIUS));
        this._damage(q, s.by, dmg, s.by.ps.weapon, d, true);
      }
    }
  }

  // A human disconnected: a regular-skill bot takes over the same player.
  humanLeft(id) {
    const p = this.byId.get(id);
    if (!p || p.isBot) return;
    p.isBot = true;
    p.skill = p.skill || 'regular';
    p.ackT = 0;
    if (this.nav) p.bot = new BotBrain(this, p, p.index);
  }

  // ---- Views and snapshots ----

  _playerView(p) {
    const ps = p.ps;
    return {
      id: p.id, name: p.name, team: p.team, isBot: p.isBot, skill: p.skill,
      x: ps.x, z: ps.z, aim: ps.aim, vx: ps.vx, vz: ps.vz,
      hp: Math.max(0, Math.ceil(p.hp)), alive: p.alive, respawnT: Math.max(0, p.respawnT),
      weapon: ps.weapon, camo: p.camo, ammo: ps.ammo[ps.slot], reserve: ps.reserve[ps.slot],
      reloadT: ps.reloadT, reloadDur: ps.reloadDur, adsT: ps.adsT,
      sprinting: ps.sprinting, sliding: ps.sliding, spawnProtect: p.spawnProtect > 0,
      kills: p.kills, deaths: p.deaths, assists: p.assists, streak: p.streak, streakReady: p.streakReady,
      bloom: ps.bloom,
    };
  }

  getView(localId) {
    return {
      t: this.time, phase: this.phase, timeLeft: this.timeLeft,
      scores: [this.scores[0], this.scores[1]], winner: this.winner,
      uav: [this.uav[0], this.uav[1]],
      players: this.players.map(p => this._playerView(p)),
      localId, lastKill: this.lastKill,
    };
  }

  // Header: [time cs, phase, timeLeft ds, score0, score1, winner(-1), uav0 ds, uav1 ds, lastKill|0, camos|0]
  // then 19 numbers per player in roster order. Camos go out on change and once a second.
  encodeSnapshot() {
    const out = [
      Math.round(this.time * 100), PHASES.indexOf(this.phase), Math.round(this.timeLeft * 10),
      this.scores[0], this.scores[1], this.winner === null ? -1 : this.winner,
      Math.round(this.uav[0] * 10), Math.round(this.uav[1] * 10),
      0, 0,
    ];
    const lk = this.lastKill;
    if (lk) {
      out[8] = [this.byId.get(lk.by).index, this.byId.get(lk.target).index, WEAPON_IDS.indexOf(lk.weapon),
        Math.round(lk.x * 10), Math.round(lk.z * 10)];
    }
    if (this._camoDirty || this._encodes % 15 === 0) {
      out[9] = this.players.map(p => p.camo);
      this._camoDirty = false;
    }
    this._encodes++;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i], ps = p.ps;
      const ready = p.streakReady === 'uav' ? 1 : p.streakReady === 'strike' ? 2 : 0;
      const flags = (p.alive ? 1 : 0) | (ps.sprinting ? 2 : 0) | (ps.sliding ? 4 : 0)
        | (p.spawnProtect > 0 ? 8 : 0) | (ready << 4);
      out.push(
        Math.round(ps.x * 50), Math.round(ps.z * 50), Math.round(ps.aim * 100),
        Math.round(ps.vx * 5), Math.round(ps.vz * 5),
        Math.max(0, Math.ceil(p.hp)), flags, Math.round(Math.max(0, p.respawnT) * 10),
        WEAPON_IDS.indexOf(ps.weapon), ps.ammo[ps.slot], ps.reserve[ps.slot],
        Math.round(ps.reloadT * 10), Math.round(ps.reloadDur * 10),
        Math.round(ps.adsT * 20), Math.round(ps.bloom * 20),
        p.kills, p.deaths, p.assists, p.streak,
      );
    }
    return out;
  }

  decodeSnapshot(d, localId) {
    const STRIDE = 19, HEAD = 10;
    if (d[9]) for (let i = 0; i < d[9].length && i < this.players.length; i++) this.players[i].camo = d[9][i];
    const players = new Array(this.players.length);
    for (let i = 0; i < this.players.length; i++) {
      const o = HEAD + i * STRIDE, r = this.players[i], flags = d[o + 6], ready = (flags >> 4) & 3;
      players[i] = {
        id: r.id, name: r.name, team: r.team, isBot: r.isBot, skill: r.skill,
        x: d[o] / 50, z: d[o + 1] / 50, aim: d[o + 2] / 100,
        vx: d[o + 3] / 5, vz: d[o + 4] / 5,
        hp: d[o + 5], alive: !!(flags & 1), respawnT: d[o + 7] / 10,
        weapon: WEAPON_IDS[d[o + 8]], camo: r.camo, ammo: d[o + 9], reserve: d[o + 10],
        reloadT: d[o + 11] / 10, reloadDur: d[o + 12] / 10,
        adsT: d[o + 13] / 20, bloom: d[o + 14] / 20,
        sprinting: !!(flags & 2), sliding: !!(flags & 4), spawnProtect: !!(flags & 8),
        kills: d[o + 15], deaths: d[o + 16], assists: d[o + 17], streak: d[o + 18],
        streakReady: ready === 1 ? 'uav' : ready === 2 ? 'strike' : null,
      };
    }
    let lastKill = null;
    if (d[8]) {
      const [by, target, weapon, x, z] = d[8];
      lastKill = { by: this.players[by].id, target: this.players[target].id,
        weapon: WEAPON_IDS[weapon], camo: this.players[by].camo, x: x / 10, z: z / 10 };
    }
    return {
      t: d[0] / 100, phase: PHASES[d[1]], timeLeft: d[2] / 10,
      scores: [d[3], d[4]], winner: d[5] === -1 ? null : d[5],
      uav: [d[6] / 10, d[7] / 10], players, localId, lastKill,
    };
  }
}
