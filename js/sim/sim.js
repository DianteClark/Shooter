// Host-authoritative match simulation: HP, kills, score, respawns, streaks, bots, match phase.
// Humans own their own movement and shots (see docs/ARCHITECTURE.md), and report them here.

import { LETHALS, normalizeLoadout, SCORE, STREAK_IDS, TACTICALS } from '../shared/catalog.js';
import { MAX_HP, PLAYER_RADIUS, RESPAWN_TIME, SCORE_LIMIT, SIM_HZ, SPAWN_PROTECT, TEAM_SIZE, TIME_LIMIT, WEAPON_IDS } from '../shared/constants.js';
import { hasLineOfSight, raycastMap, rayCircle } from '../shared/geometry.js';
import { MAPS, DEFAULT_MAP } from '../shared/map.js';
import { attachmentsFor, NO_ATTACHMENTS, packKit, unpackKit } from '../shared/attachments.js';
import { damageAt, headMultFor, WEAPONS } from '../shared/weapons.js';
import { botAttachments, BotBrain } from './bots.js';
import { blastDamage, EQUIPMENT, EquipmentSystem, flakMult } from './equipment.js';
import { NavGrid } from './nav.js';
import { angleDiff, createPlayerState, respawnPlayer, takeEquipment, traceShot, weaponDef } from './player.js';
import { addScore, createStreakState, setStreakKinds, spendStreak } from './streaks.js';

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

const UAV_TIME = 20;
const STRIKE_DELAY = 1.3, STRIKE_STEP = 0.2, STRIKE_COUNT = 5, STRIKE_SPACING = 4.6;
const STRIKE_RADIUS = 5.2, STRIKE_DAMAGE = 135;

// A zone denial tool: it wins a corner against someone who ignores it, and loses to anyone who shoots back.
const TURRET_LIFE = 25, TURRET_HP = 180, TURRET_RADIUS = 0.75, TURRET_RANGE = 20;
const TURRET_TURN = 2.8, TURRET_THINK = 0.2, TURRET_INTERVAL = 0.26, TURRET_TOL = 0.14;
const TURRET_DAMAGE = 11, TURRET_SPREAD = 0.05;
const TURRET_HIT_RADIUS = PLAYER_RADIUS + 0.1, TURRET_SLIDE_RADIUS = TURRET_HIT_RADIUS * 0.72;

// Rounds are aimed at where the target was a moment ago, so anyone moving is hard to hit.
const GUNSHIP_LIFE = 18, GUNSHIP_ORBIT = 13, GUNSHIP_BURST = 4, GUNSHIP_GAP = 0.16, GUNSHIP_PAUSE = 2;
const GUNSHIP_DAMAGE = 30, GUNSHIP_SCATTER = 1.5, GUNSHIP_BLAST = 0.85, GUNSHIP_LAG = 0.3, GUNSHIP_EYES = 32;

const THROW_ORIGIN_SLACK = 4;    // How far a reported throw may start from where the host has that player.
const SCAVENGE_MAGS = 1;         // Magazines of reserve per kill with Scavenger.

const PHASES = ['warmup', 'live', 'ended'];
const PROJECTILE_KINDS = ['frag', 'sticky', 'smoke', 'flash'];
const TACTICAL_IDS = Object.keys(TACTICALS);
const LETHAL_IDS = Object.keys(LETHALS);
const POS = { x: 0, z: 0, sliding: false };
const PLAYER_STRIDE = 24;
const META_KIT_SHIFT = 13;       // Meta int: 13 bits of equipment and streaks, then the primary's packed kit.
const BOT_NAMES = ['Rook', 'Mako', 'Vesper', 'Dagger', 'Quill', 'Sable', 'Ember', 'Tarn', 'Pike', 'Onyx', 'Fable', 'Ghoul', 'Brine', 'Cinder', 'Wick', 'Hex'];
const BOT_PRIMARIES = ['ar', 'smg', 'lmg', 'shotgun', 'ar', 'sniper', 'smg', 'ar'];
const MIXED_SKILLS = ['regular', 'veteran', 'veteran', 'regular', 'elite', 'recruit'];
const BOT_TACTICALS = ['smoke', 'flash', 'stim', 'smoke', 'flash'];
const BOT_LETHALS = ['frag', 'sticky', 'frag'];
const BOT_PERKS = [['scavenger', 'marathon'], ['ghost', 'fasthands'], ['flak', 'marathon'], ['scavenger', 'fasthands'], ['ghost', 'flak'], ['marathon', 'fasthands']];
const BOT_STREAKS = [['uav', 'turret', 'gunship'], ['uav', 'strike', 'gunship'], ['uav', 'turret', 'strike'], ['turret', 'strike', 'gunship']];

function round2(v) { return Math.round(v * 100) / 100; }

function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

// Roughly bell-shaped in -1..1.
function bell(rng) { return (rng() + rng() + rng()) / 1.5 - 1; }

// Scavenger's reward, applied to whichever copy of the player owns its ammo. Exported so the phone that
// owns a human's ammo can apply the same rule when it receives the `scavenge` event.
export function scavengeRefill(ps) {
  for (let i = 0; i < 2; i++) {
    const w = weaponDef(ps, i === 0 ? ps.primary : ps.secondary);
    if (w && !w.unlimitedReserve) ps.reserve[i] = Math.min(w.reserve, ps.reserve[i] + w.magazine * SCAVENGE_MAGS);
  }
}

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
  const roster = humans.map(h => {
    const loadout = normalizeLoadout({ ...h.loadout, primary: h.loadout?.primary || h.primary, camo: h.loadout?.camo || h.camo });
    return { id: h.id, name: h.name, team: h.team, isBot: false, skill: null, primary: loadout.primary, camo: loadout.camo, loadout };
  });
  let nameI = 0, weaponI = 0, n = 0;
  for (let team = 0; team < 2; team++) {
    let count = roster.filter(r => r.team === team).length;
    // Offset the loadout cycle per team so the two sides are not mirror images.
    weaponI = team * 3;
    for (; count < teamSize; count++, n++) {
      const i = n + team;
      const skill = botSkill === 'mixed' ? MIXED_SKILLS[n % MIXED_SKILLS.length] : botSkill;
      const primary = BOT_PRIMARIES[weaponI++ % BOT_PRIMARIES.length];
      const loadout = normalizeLoadout({
        primary, camo: 'none', attachments: { [primary]: botAttachments(primary, skill, i) },
        tactical: BOT_TACTICALS[i % BOT_TACTICALS.length], lethal: BOT_LETHALS[i % BOT_LETHALS.length],
        perks: BOT_PERKS[i % BOT_PERKS.length], streaks: BOT_STREAKS[i % BOT_STREAKS.length],
      });
      roster.push({
        id: `bot${n}`, name: BOT_NAMES[nameI++ % BOT_NAMES.length], team, isBot: true,
        skill,
        primary: loadout.primary, camo: loadout.camo, loadout,
      });
    }
  }
  return roster;
}

export class Sim {
  constructor({ roster, map, seed = 1, scoreLimit = SCORE_LIMIT, timeLimit = TIME_LIMIT, mode = 'tdm' }) {
    this.map = typeof map === 'string' ? MAPS[map] : (map || MAPS[DEFAULT_MAP]);
    this.rng = mulberry32(seed >>> 0);
    this.scoreLimit = scoreLimit;
    this.timeLimit = timeLimit;
    this.mode = mode;
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
    this.turrets = [];
    this.gunships = [];
    this.nextTurretId = 1;
    this.eq = new EquipmentSystem(this.map);
    this.eqPlayers = [];
    this._onEqEvent = this._onEqEvent.bind(this);
    this._onEqDamage = this._onEqDamage.bind(this);
    this.pathBudget = 0;
    this.nav = null;     // Built on first step; guests only decode snapshots and never need it.
    this._encodes = 0;
    this._metaUntil = 2;      // Tick up to which every snapshot carries the camo and loadout block.
    this._scratch = [];

    const n = roster.length;
    this.players = roster.map((r, index) => {
      const loadout = this._cleanLoadout({ ...r.loadout, primary: r.loadout?.primary || r.primary, camo: r.loadout?.camo || r.camo });
      return {
        id: r.id, name: r.name, team: r.team, isBot: !!r.isBot, skill: r.skill ?? null,
        primary: loadout.primary, camo: loadout.camo, loadout, pendingLoadout: null, index,
        ps: createPlayerState({ id: r.id, primary: loadout.primary, camo: loadout.camo, loadout }),
        hp: MAX_HP, alive: true, respawnT: 0, spawnProtect: 0,
        kills: 0, deaths: 0, assists: 0, head: 0, streak: 0, chain: 0, lastKillT: -99,
        lastKilledBy: null, score: createStreakState(loadout.streaks),
        regenT: 0, dmgBy: new Float32Array(n), dmgT: new Float32Array(n).fill(-99),
        kits: [attachmentsFor(loadout, loadout.primary), attachmentsFor(loadout, loadout.secondary)],
        kitBits: -1, kitWeapon: null,
        hx: new Float32Array(HISTORY), hz: new Float32Array(HISTORY), hs: new Uint8Array(HISTORY),
        prevReload: false, prevWeapon: loadout.primary, prevSliding: false, prevOverheated: false,
        ackX: 0, ackZ: 0, ackT: 0,
        bot: null,
      };
    });
    this.byId = new Map(this.players.map(p => [p.id, p]));
    this.spotted = [new Float32Array(n).fill(-99), new Float32Array(n).fill(-99)];
    this.spawnUsedAt = new Map();
    this._emit({ t: 'phase', phase: 'warmup' });
    this._spawnAll();
  }

  _emit(e) { this.events.push(e); }

  // Line-of-sight blockers right now, for bots and streak targeting.
  get smokes() { return this.eq.smokes; }

  // Normalizes a loadout and makes sure its guns exist, which the catalog alone cannot check.
  _cleanLoadout(raw, fallback = null) {
    const l = normalizeLoadout(raw);
    if (!WEAPONS[l.primary]) l.primary = fallback ? fallback.primary : 'ar';
    if (!WEAPONS[l.secondary]) l.secondary = fallback ? fallback.secondary : 'pistol';
    return l;
  }

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
    if (p.pendingLoadout) {
      p.loadout = p.pendingLoadout; p.pendingLoadout = null;
      p.primary = p.loadout.primary; p.camo = p.loadout.camo;
      p.kits[0] = attachmentsFor(p.loadout, p.loadout.primary);
      p.kits[1] = attachmentsFor(p.loadout, p.loadout.secondary);
      setStreakKinds(p.score, p.loadout.streaks);
      this._metaUntil = this.tick + 2;
    }
    respawnPlayer(p.ps, s.x, s.z, aim, p.loadout);
    p.hp = MAX_HP; p.alive = true; p.respawnT = 0; p.spawnProtect = SPAWN_PROTECT;
    p.regenT = 0; p.dmgBy.fill(0);
    p.prevReload = false; p.prevWeapon = p.ps.weapon; p.prevSliding = false; p.prevOverheated = false;
    for (let i = 0; i < HISTORY; i++) { p.hx[i] = s.x; p.hz[i] = s.z; p.hs[i] = 0; }
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
      this._stepEquipment();
      this._stepTurrets();
      this._stepGunships();
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
      p.hx[h] = p.ps.x; p.hz[h] = p.ps.z; p.hs[h] = p.ps.sliding ? 1 : 0;
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
    out.sliding = p.hs[f < 0.5 ? i0 : i1] === 1;
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
    ps.heat = d.heat ?? 0; ps.overheated = !!d.overheated; ps.firingT = d.firingT ?? 0;
    p.primary = d.primary;
    if (d.camo && d.camo !== p.camo) { p.camo = d.camo; ps.camo = d.camo; this._metaUntil = this.tick + 2; }
    this._diffFx(p);
  }

  // Takes effect at the next spawn. Score and held streaks carry over; see setStreakKinds.
  setLoadout(id, loadout) {
    const p = this.byId.get(id);
    if (!p || !loadout || typeof loadout !== 'object') return false;
    p.pendingLoadout = this._cleanLoadout(loadout, p.loadout);
    return true;
  }

  // Everything a player's phone asks the host to do, apart from moving and shooting.
  // Returns whether the command was accepted.
  applyCommand(id, msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.cmd === 'streak') return this.useStreak(id, msg.slot) !== null;
    if (msg.cmd === 'throw') return this._throw(id, msg);
    if (msg.cmd === 'loadout') return this.setLoadout(id, msg.loadout);
    return false;
  }

  _throw(id, { slot, ox, oz, aim }) {
    const p = this.byId.get(id);
    if (!p || !p.alive || this.phase !== 'live' || !Number.isFinite(aim)) return false;
    if (slot !== 'tactical' && slot !== 'lethal') return false;
    const ps = p.ps, heal = slot === 'tactical' && ps.tactical === 'stim';
    if (heal && p.hp >= MAX_HP) return false;   // A stim at full health is only a misclick: keep it.
    const kind = takeEquipment(ps, slot);
    if (!kind) return false;
    if (!heal) p.spawnProtect = 0;
    // Trust the phone's own hand position, unless it is implausibly far from what the host knows.
    const near = Number.isFinite(ox) && Number.isFinite(oz) && Math.hypot(ox - ps.x, oz - ps.z) <= THROW_ORIGIN_SLACK;
    this.eq.throw(p, kind, near ? ox : ps.x, near ? oz : ps.z, aim);
    return true;
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
    if (ps.overheated !== p.prevOverheated) {
      if (ps.overheated) this._emit({ t: 'overheat', id: p.id });
      p.prevOverheated = ps.overheated;
    }
  }

  // Applies a shot fired `ageSeconds` ago. Pass ping/2 plus the shooter's interpolation delay, so
  // targets are rewound to where the shooter actually saw them.
  applyShot(id, shot, ageSeconds = 0) {
    const shooter = this.byId.get(id);
    if (!shooter || !shooter.alive || this.phase === 'ended') return;
    // Every gun stat below comes from the shooter's loadout as the host knows it, never from the shot itself.
    const w = weaponDef(shooter.ps, shot.weapon);
    if (!w) return;

    const age = Math.min(Math.max(0, ageSeconds), MAX_REWIND);
    const scratch = this._scratch;
    scratch.length = this.players.length;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const e = scratch[i] || (scratch[i] = { id: null, team: 0, alive: false, x: 0, z: 0, sliding: false });
      e.id = p.id; e.team = p.team; e.alive = p.alive;
      if (age > 0) this.posAt(p, age, e);
      else { e.x = p.ps.x; e.z = p.ps.z; e.sliding = p.ps.sliding; }
    }
    const rays = traceShot(shot, this.map, scratch, id, w);
    const turretHits = this.turrets.length > 0 ? this._raysVsTurrets(shot, rays, shooter) : null;

    const lean = new Array(rays.length);
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i];
      // To everyone drawing it, a bullet stopped by a turret is a bullet that hit something hard.
      lean[i] = { x: round2(r.x), z: round2(r.z), hit: r.hit === 'turret' ? 'wall' : r.hit, nx: round2(r.nx), nz: round2(r.nz) };
    }
    const fired = { t: 'shot', by: id, weapon: shot.weapon, camo: shooter.camo,
      ox: round2(shot.ox), oz: round2(shot.oz), aim: round2(shot.aim), rays: lean };
    if (w.suppressed) fired.sup = 1;
    this._emit(fired);
    this._alertBots(shooter, !!w.suppressed);

    if (this.phase !== 'live') return;
    shooter.spawnProtect = 0;      // Shooting gives up your protection.

    const ads = shot.ads ?? (shooter.ps.adsT >= 0.85);
    if (turretHits) this._damageTurretsFromShot(turretHits, rays, shot, w, ads);
    const headMult = headMultFor(shot.weapon);
    for (let i = 0; i < rays.length; i++) {
      if (rays[i].hit !== 'player') continue;
      // Sum all pellets on one target into a single hit.
      const targetId = rays[i].id;
      let dmg = 0, dist = 0, head = false;
      for (let j = i; j < rays.length; j++) {
        if (rays[j].hit !== 'player' || rays[j].id !== targetId) continue;
        dist = Math.hypot(rays[j].x - shot.ox, rays[j].z - shot.oz);
        dmg += damageAt(w, dist, ads) * (rays[j].head ? headMult : 1);
        if (rays[j].head) head = true;
        if (j !== i) rays[j].hit = 'counted';
      }
      this._damage(this.byId.get(targetId), shooter, dmg, shot.weapon, dist, null, head);
    }
  }

  // Stops rays at enemy turrets, which the shooter's own traceShot knows nothing about.
  // Returns an array of the turret hit by each ray (null where none), or null when nothing was hit.
  _raysVsTurrets(shot, rays, shooter) {
    let hits = null;
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i], dirX = Math.cos(shot.angles[i]), dirZ = Math.sin(shot.angles[i]);
      let bestT = Math.hypot(r.x - shot.ox, r.z - shot.oz), best = null;
      for (let k = 0; k < this.turrets.length; k++) {
        const t = this.turrets[k];
        if (t.team === shooter.team) continue;
        const along = rayCircle(shot.ox, shot.oz, dirX, dirZ, t.x, t.z, TURRET_RADIUS);
        if (along >= 0 && along < bestT) { bestT = along; best = t; }
      }
      if (!best) continue;
      (hits || (hits = new Array(rays.length).fill(null)))[i] = best;
      r.x = shot.ox + dirX * bestT; r.z = shot.oz + dirZ * bestT;
      r.hit = 'turret'; r.nx = -dirX; r.nz = -dirZ;
    }
    return hits;
  }

  _damageTurretsFromShot(hits, rays, shot, w, ads) {
    for (let i = 0; i < rays.length; i++) {
      const t = hits[i];
      if (t) this._hurtTurret(t, damageAt(w, Math.hypot(rays[i].x - shot.ox, rays[i].z - shot.oz), ads));
    }
  }

  _alertBots(shooter, suppressed) {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.bot && p.alive && p.team !== shooter.team) p.bot.onGunshot(shooter, suppressed);
    }
  }

  // ---- Damage, kills, medals ----

  // `streak` is a scorestreak kind when one did this damage; `equip` is a thrown item's kind.
  _damage(target, attacker, dmg, weapon, dist, streak = null, head = false, equip = null) {
    if (!target || !target.alive || target.spawnProtect > 0 || target.team === attacker.team) return;
    target.hp -= dmg;
    target.regenT = REGEN_DELAY;
    // Streak damage earns no assist either, or it would feed the owner's score after all.
    if (!streak) {
      target.dmgBy[attacker.index] += dmg;
      target.dmgT[attacker.index] = this.time;
    }
    const killed = target.hp <= 0;
    const hit = { t: 'hit', by: attacker.id, target: target.id, dmg: Math.round(dmg),
      x: round2(target.ps.x), z: round2(target.ps.z), killed };
    if (head) hit.head = true;
    this._emit(hit);
    if (target.bot) target.bot.onDamaged(attacker);
    if (killed) this._kill(target, attacker, weapon, dist, streak, head, equip);
  }

  _kill(target, killer, weapon, dist, streak, head, equip) {
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
    if (assist) { assist.assists++; addScore(assist.score, SCORE.assist); }
    target.dmgBy.fill(0);

    // weapon stays a real gun id even for streaks and grenades, so consumers need no special case.
    const kill = { t: 'kill', by: killer.id, target: target.id, weapon, camo: killer.camo,
      x: round2(target.ps.x), z: round2(target.ps.z), assist: assist ? assist.id : null, dist: round2(dist) };
    if (streak) kill.streak = streak;
    if (equip) kill.equip = equip;
    if (head) kill.head = true;
    this._emit(kill);
    this.lastKill = { by: killer.id, target: target.id, weapon, camo: killer.camo, x: kill.x, z: kill.z };

    if (!this.firstBlood) { this.firstBlood = true; this._medal(killer, 'first_blood'); }
    if (killer.lastKilledBy === target.id) { killer.lastKilledBy = null; this._medal(killer, 'revenge'); }
    if (!streak && !equip && dist >= LONGSHOT) this._medal(killer, 'longshot');
    if (head) { killer.head++; this._medal(killer, 'headshot'); }

    killer.chain = this.time - killer.lastKillT <= CHAIN_WINDOW ? killer.chain + 1 : 1;
    killer.lastKillT = this.time;
    if (killer.chain === 2) this._medal(killer, 'double');
    else if (killer.chain === 3) this._medal(killer, 'triple');
    else if (killer.chain >= 4) this._medal(killer, 'fury');

    // A scorestreak's kills count for the team, but never feed the score that earned it.
    if (!streak) {
      addScore(killer.score, SCORE.kill + (head ? SCORE.headshot : 0));
      killer.streak++;
      if (killer.streak === 3) this._medal(killer, 'streak3');
      else if (killer.streak === 5) this._medal(killer, 'streak5');
      else if (killer.streak === 10) this._medal(killer, 'streak10');
      if (killer.ps.perks.includes('scavenger')) {
        scavengeRefill(killer.ps);
        if (!killer.isBot) this._emit({ t: 'scavenge', id: killer.id });
      }
    }

    if (this.scores[killer.team] >= this.scoreLimit) this._end(killer.team);
  }

  _medal(p, medal) { this._emit({ t: 'medal', id: p.id, medal }); }

  // ---- Equipment ----

  _stepEquipment() {
    const list = this.eqPlayers, players = this.players;
    list.length = players.length;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const e = list[i] || (list[i] = { id: p.id, team: p.team, x: 0, z: 0, alive: false, perks: null, spawnProtect: false });
      e.x = p.ps.x; e.z = p.ps.z; e.alive = p.alive; e.perks = p.ps.perks; e.spawnProtect = p.spawnProtect > 0;
    }
    this.eq.step(STEP, list, this._onEqEvent, this._onEqDamage);
  }

  _onEqEvent(e) {
    if (e.t === 'heal') {
      const p = this.byId.get(e.id);
      if (!p || !p.alive) return;
      p.hp = Math.min(MAX_HP, p.hp + e.amount);
      this._emit({ t: 'heal', id: e.id });
      return;
    }
    if (e.t === 'flashed') {
      const p = this.byId.get(e.id);
      if (p && p.bot) p.bot.onFlashed(e.dur);
      this._emit({ t: 'flashed', id: e.id, amount: round2(e.amount), dur: round2(e.dur) });
      return;
    }
    if (e.t === 'bang') {
      e.x = round2(e.x); e.z = round2(e.z);
      if (EQUIPMENT[e.kind].blast) this._blastTurrets(e);
    } else if (e.t === 'throw') {
      e.ox = round2(e.ox); e.oz = round2(e.oz); e.aim = round2(e.aim);
    }
    this._emit(e);
  }

  _onEqDamage(targetId, dmg, ownerId, kind) {
    const target = this.byId.get(targetId), owner = this.byId.get(ownerId);
    if (!target || !owner) return;
    const dist = Math.hypot(owner.ps.x - target.ps.x, owner.ps.z - target.ps.z);
    this._damage(target, owner, dmg, owner.ps.weapon, dist, null, false, kind);
  }

  // A grenade hurts enemy turrets the same way it hurts enemy players.
  _blastTurrets(bang) {
    const thrower = this.byId.get(bang.by);
    if (!thrower) return;
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i];
      if (t.team === thrower.team) continue;
      const d = Math.hypot(t.x - bang.x, t.z - bang.z);
      if (d >= bang.r || !hasLineOfSight(this.map, bang.x, bang.z, t.x, t.z)) continue;
      this._hurtTurret(t, blastDamage(EQUIPMENT[bang.kind].blast, d));
    }
  }

  // ---- Streaks ----

  // Fires the streak in `slot`, or the most expensive one held when no slot is given. Returns its kind, or null.
  useStreak(id, slot) {
    const p = this.byId.get(id);
    if (!p || this.phase !== 'live' || !p.alive) return null;
    const slots = p.score.slots;
    if (slot === undefined) {
      for (let i = slots.length - 1; i >= 0 && slot === undefined; i--) if (slots[i].held) slot = i;
    }
    const s = slots[slot];
    if (!s || !s.held) return null;
    const kind = s.kind;
    if (kind === 'strike') {
      const spot = this._strikeTarget(p);
      if (!spot) return null;   // No live enemies: keep it rather than waste it.
      spendStreak(p.score, slot);
      this._launchStrike(p, spot);
      return kind;
    }
    spendStreak(p.score, slot);
    if (kind === 'uav') {
      this.uav[p.team] = UAV_TIME;
      this._emit({ t: 'streak', id, kind, team: p.team });
    } else if (kind === 'turret') {
      this._placeTurret(p);
    } else if (kind === 'gunship') {
      this._launchGunship(p);
    }
    return kind;
  }

  _launchStrike(p, spot) {
    this._emit({ t: 'streak', id: p.id, kind: 'strike', team: p.team, x: round2(spot.x), z: round2(spot.z) });
    for (let i = 0; i < STRIKE_COUNT; i++) {
      const k = i - (STRIKE_COUNT - 1) / 2;
      this.strikes.push({
        at: this.time + STRIKE_DELAY + i * STRIKE_STEP, by: p,
        x: Math.max(1, Math.min(this.map.width - 1, spot.x + spot.dx * k * STRIKE_SPACING)),
        z: Math.max(1, Math.min(this.map.height - 1, spot.z + spot.dz * k * STRIKE_SPACING)),
      });
    }
  }

  _placeTurret(p) {
    const t = {
      id: this.nextTurretId++, team: p.team, owner: p, x: p.ps.x, z: p.ps.z, aim: wrapAngle(p.ps.aim),
      hp: TURRET_HP, life: TURRET_LIFE, thinkT: 0, cooldown: 0.4, target: null,
    };
    this.turrets.push(t);
    this.nav?.paintDanger(this.turrets);
    this._emit({ t: 'streak', id: p.id, kind: 'turret', team: p.team, x: round2(t.x), z: round2(t.z) });
    this._emit({ t: 'turret', id: t.id, team: t.team, x: round2(t.x), z: round2(t.z) });
  }

  _stepTurrets() {
    const list = this.turrets;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      t.life -= STEP;
      if (t.life <= 0) { this._removeTurret(t); continue; }
      t.cooldown -= STEP;
      t.thinkT -= STEP;
      if (t.thinkT <= 0) { t.thinkT = TURRET_THINK; t.target = this._turretTarget(t); }
      const q = t.target;
      if (!q || !q.alive) continue;
      const off = angleDiff(Math.atan2(q.ps.z - t.z, q.ps.x - t.x), t.aim);
      const lim = TURRET_TURN * STEP;
      t.aim = wrapAngle(t.aim + Math.max(-lim, Math.min(lim, off)));
      if (t.cooldown <= 0 && Math.abs(off) < TURRET_TOL) {
        t.cooldown = TURRET_INTERVAL;
        this._turretFire(t);
      }
    }
  }

  _turretTarget(t) {
    let best = null, bestD = TURRET_RANGE;
    for (let i = 0; i < this.players.length; i++) {
      const q = this.players[i];
      if (q.team === t.team || !q.alive || q.spawnProtect > 0) continue;
      const d = Math.hypot(q.ps.x - t.x, q.ps.z - t.z);
      if (d < bestD && hasLineOfSight(this.map, t.x, t.z, q.ps.x, q.ps.z, this.eq.smokes)) { bestD = d; best = q; }
    }
    return best;
  }

  _turretFire(t) {
    const angle = t.aim + bell(this.rng) * TURRET_SPREAD * 2;
    const dirX = Math.cos(angle), dirZ = Math.sin(angle);
    const wall = raycastMap(this.map, t.x, t.z, dirX, dirZ, TURRET_RANGE + 4, 'blocksBullet');
    let bestT = wall ? wall.t : TURRET_RANGE + 4, victim = null;
    for (let i = 0; i < this.players.length; i++) {
      const q = this.players[i];
      if (q.team === t.team || !q.alive) continue;
      const hit = rayCircle(t.x, t.z, dirX, dirZ, q.ps.x, q.ps.z, q.ps.sliding ? TURRET_SLIDE_RADIUS : TURRET_HIT_RADIUS);
      if (hit >= 0 && hit < bestT) { bestT = hit; victim = q; }
    }
    this._emit({ t: 'turret_shot', ox: round2(t.x), oz: round2(t.z), x: round2(t.x + dirX * bestT), z: round2(t.z + dirZ * bestT) });
    if (victim) this._damage(victim, t.owner, TURRET_DAMAGE, t.owner.ps.weapon, bestT, 'turret');
  }

  _hurtTurret(t, dmg) {
    t.hp -= dmg;
    if (t.hp <= 0) this._removeTurret(t);
  }

  _removeTurret(t) {
    const i = this.turrets.indexOf(t);
    if (i < 0) return;
    this.turrets.splice(i, 1);
    t.hp = 0;   // Bots holding a reference see it die.
    this.nav?.paintDanger(this.turrets);
    this._emit({ t: 'turret_down', id: t.id, x: round2(t.x), z: round2(t.z) });
  }

  _launchGunship(p) {
    const dir = p.team === 0 ? 1 : -1;
    const g = { team: p.team, owner: p, x: 0, z: 0, aim: 0, life: GUNSHIP_LIFE, angle: this.rng() * Math.PI * 2, dir,
      pause: 1.2, burstLeft: 0, cooldown: 0, target: null, aimX: 0, aimZ: 0 };
    this._moveGunship(g);
    this.gunships.push(g);
    this._emit({ t: 'streak', id: p.id, kind: 'gunship', team: p.team });
    this._emit({ t: 'gunship', team: p.team, owner: p.id });
  }

  _moveGunship(g) {
    const W = this.map.width, H = this.map.height;
    g.x = W / 2 + Math.cos(g.angle) * W * 0.42;
    g.z = H / 2 + Math.sin(g.angle) * H * 0.38;
    g.aim = wrapAngle(g.angle + g.dir * Math.PI / 2);
  }

  _stepGunships() {
    const list = this.gunships;
    for (let i = list.length - 1; i >= 0; i--) {
      const g = list[i];
      g.life -= STEP;
      if (g.life <= 0) { list.splice(i, 1); continue; }
      g.angle += g.dir * STEP * Math.PI * 2 / GUNSHIP_ORBIT;
      this._moveGunship(g);
      if (g.burstLeft > 0) {
        g.cooldown -= STEP;
        if (g.cooldown <= 0) { g.cooldown = GUNSHIP_GAP; g.burstLeft--; this._gunshipRound(g); }
        continue;
      }
      g.pause -= STEP;
      if (g.pause > 0) continue;
      g.target = this._gunshipTarget(g);
      if (g.target) { g.burstLeft = GUNSHIP_BURST; g.cooldown = 0; g.pause = GUNSHIP_PAUSE; }
      else g.pause = 0.3;
    }
  }

  // Only what the owner's team can see or has on UAV, so hiding and smoke work against it too.
  _gunshipTarget(g) {
    let best = null, bestScore = Infinity;
    for (let i = 0; i < this.players.length; i++) {
      const q = this.players[i];
      if (q.team === g.team || !q.alive || q.spawnProtect > 0 || !this._teamSees(g.team, q)) continue;
      const score = Math.hypot(q.ps.x - g.x, q.ps.z - g.z) + this.rng() * 12;
      if (score < bestScore) { bestScore = score; best = q; }
    }
    return best;
  }

  _teamSees(team, q) {
    if (this.uav[team] > 0 && !q.ps.perks.includes('ghost')) return true;
    for (let i = 0; i < this.players.length; i++) {
      const a = this.players[i];
      if (a.team !== team || !a.alive) continue;
      if (Math.hypot(a.ps.x - q.ps.x, a.ps.z - q.ps.z) > GUNSHIP_EYES) continue;
      if (hasLineOfSight(this.map, a.ps.x, a.ps.z, q.ps.x, q.ps.z, this.eq.smokes)) return true;
    }
    return false;
  }

  _gunshipRound(g) {
    const q = g.target;
    if (q && q.alive) { this.posAt(q, GUNSHIP_LAG, POS); g.aimX = POS.x; g.aimZ = POS.z; }
    const x = Math.max(0, Math.min(this.map.width, g.aimX + bell(this.rng) * GUNSHIP_SCATTER));
    const z = Math.max(0, Math.min(this.map.height, g.aimZ + bell(this.rng) * GUNSHIP_SCATTER));
    this._emit({ t: 'gunship_shot', ox: round2(g.x), oz: round2(g.z), x: round2(x), z: round2(z) });
    if (this._onRoof(x, z)) return;     // The round is spent on whatever is overhead.
    let victim = null, bestD = GUNSHIP_BLAST;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.team === g.team || !p.alive) continue;
      const d = Math.hypot(p.ps.x - x, p.ps.z - z);
      if (d < bestD) { bestD = d; victim = p; }
    }
    if (victim) this._damage(victim, g.owner, GUNSHIP_DAMAGE, g.owner.ps.weapon, bestD, 'gunship');
  }

  _onRoof(x, z) {
    for (const w of this.map.walls) {
      if (w.blocksVision && x >= w.x && x <= w.x + w.w && z >= w.z && z <= w.z + w.d) return true;
    }
    return false;
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
        const dmg = STRIKE_DAMAGE * (1 - 0.65 * (d / STRIKE_RADIUS)) * flakMult(q.ps.perks);
        this._damage(q, s.by, dmg, s.by.ps.weapon, d, 'strike');
      }
      for (let k = this.turrets.length - 1; k >= 0; k--) {
        const t = this.turrets[k];
        if (t.team === s.by.team) continue;
        const d = Math.hypot(t.x - s.x, t.z - s.z);
        if (d <= STRIKE_RADIUS && hasLineOfSight(this.map, s.x, s.z, t.x, t.z)) this._hurtTurret(t, STRIKE_DAMAGE);
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
    const ps = p.ps, st = p.score;
    return {
      id: p.id, name: p.name, team: p.team, isBot: p.isBot, skill: p.skill,
      x: ps.x, z: ps.z, aim: ps.aim, vx: ps.vx, vz: ps.vz,
      hp: Math.max(0, Math.ceil(p.hp)), alive: p.alive, respawnT: Math.max(0, p.respawnT),
      weapon: ps.weapon, camo: p.camo, ammo: ps.ammo[ps.slot], reserve: ps.reserve[ps.slot],
      reloadT: ps.reloadT, reloadDur: ps.reloadDur, adsT: ps.adsT,
      sprinting: ps.sprinting, sliding: ps.sliding, spawnProtect: p.spawnProtect > 0,
      kills: p.kills, deaths: p.deaths, assists: p.assists, head: p.head, streak: p.streak,
      bloom: ps.bloom, score: st.score, capped: st.capped,
      slots: st.slots.map(s => ({ kind: s.kind, cost: s.cost, held: s.held, blocked: s.blocked })),
      heat: ps.heat, overheated: ps.overheated, firingT: ps.firingT,
      tacticalLeft: ps.tacticalLeft, lethalLeft: ps.lethalLeft, tactical: ps.tactical, lethal: ps.lethal,
      ghost: ps.perks.includes('ghost'),
      attachments: this._heldKit(p, ps.weapon),
    };
  }

  // The kit on the gun a player is holding, for the gun model. Stable object per kit.
  _heldKit(p, weapon) {
    return weapon === p.loadout.primary ? p.kits[0] : weapon === p.loadout.secondary ? p.kits[1] : NO_ATTACHMENTS;
  }

  // Same, on a guest: the snapshot says which gun, and the meta block (once seen) says what is on it.
  _decodedKit(p, weapon) {
    if (weapon === p.loadout.secondary) return p.kits[1];
    if (p.kitBits >= 0 && p.kitWeapon !== weapon) { p.kits[0] = unpackKit(weapon, p.kitBits); p.kitWeapon = weapon; }
    return p.kits[0];
  }

  getView(localId) {
    return {
      t: this.time, phase: this.phase, timeLeft: this.timeLeft, mode: this.mode,
      scores: [this.scores[0], this.scores[1]], winner: this.winner,
      uav: [this.uav[0], this.uav[1]],
      players: this.players.map(p => this._playerView(p)),
      projectiles: this.eq.projectiles.map(p => ({ id: p.id, kind: p.kind, x: p.x, z: p.z, y: p.y })),
      smokes: this.eq.smokes.map(s => ({ id: s.id, x: s.x, z: s.z, r: s.r })),
      turrets: this.turrets.map(t => ({ id: t.id, team: t.team, owner: t.owner.id, x: t.x, z: t.z, aim: t.aim, hp: Math.ceil(t.hp) })),
      gunships: this.gunships.map(g => ({ team: g.team, owner: g.owner.id, x: g.x, z: g.z, aim: g.aim })),
      localId, lastKill: this.lastKill,
    };
  }

  // Header: [time cs, phase, timeLeft ds, score0, score1, winner(-1), uav0 ds, uav1 ds, lastKill|0, meta|0,
  // projectiles|0, smokes|0, turrets|0, gunships|0], then PLAYER_STRIDE numbers per player in roster order.
  // meta is [camos, loadout ints, mode]; it goes out on change and once a second. The four entity lists are flat.
  encodeSnapshot() {
    const out = [
      Math.round(this.time * 100), PHASES.indexOf(this.phase), Math.round(this.timeLeft * 10),
      this.scores[0], this.scores[1], this.winner === null ? -1 : this.winner,
      Math.round(this.uav[0] * 10), Math.round(this.uav[1] * 10),
      0, 0, 0, 0, 0, 0,
    ];
    const lk = this.lastKill;
    if (lk) {
      out[8] = [this.byId.get(lk.by).index, this.byId.get(lk.target).index, WEAPON_IDS.indexOf(lk.weapon),
        Math.round(lk.x * 10), Math.round(lk.z * 10)];
    }
    // Keyed to the tick, not to encode calls: the host encodes twice on some ticks, and the extra
    // local one must not swallow what guests need to receive.
    if (this.tick <= this._metaUntil || this.tick % 15 === 0) out[9] = this._encodeMeta();
    this._encodeEntities(out);
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i], ps = p.ps, st = p.score;
      let held = 0, blocked = 0;
      for (let k = 0; k < st.slots.length; k++) {
        if (st.slots[k].held) held |= 1 << k;
        if (st.slots[k].blocked) blocked |= 1 << k;
      }
      const flags = (p.alive ? 1 : 0) | (ps.sprinting ? 2 : 0) | (ps.sliding ? 4 : 0) | (p.spawnProtect > 0 ? 8 : 0)
        | (ps.perks.includes('ghost') ? 16 : 0) | (ps.overheated ? 32 : 0) | (st.capped ? 64 : 0);
      out.push(
        Math.round(ps.x * 50), Math.round(ps.z * 50), Math.round(ps.aim * 100),
        Math.round(ps.vx * 5), Math.round(ps.vz * 5),
        Math.max(0, Math.ceil(p.hp)), flags, Math.round(Math.max(0, p.respawnT) * 10),
        WEAPON_IDS.indexOf(ps.weapon), ps.ammo[ps.slot], ps.reserve[ps.slot],
        Math.round(ps.reloadT * 10), Math.round(ps.reloadDur * 10),
        Math.round(ps.adsT * 20), Math.round(ps.bloom * 20),
        p.kills, p.deaths, p.assists, p.streak,
        st.score, held | (blocked << 3) | (ps.tacticalLeft << 6) | (ps.lethalLeft << 9),
        Math.round(ps.heat * 20), Math.round(ps.firingT * 10), p.head,
      );
    }
    return out;
  }

  _encodeMeta() {
    return [
      this.players.map(p => p.camo),
      this.players.map(p => {
        let n = TACTICAL_IDS.indexOf(p.ps.tactical) | (LETHAL_IDS.indexOf(p.ps.lethal) << 2);
        p.score.slots.forEach((s, k) => { n |= STREAK_IDS.indexOf(s.kind) << (4 + k * 3); });
        return n | (packKit(p.kits[0]) << META_KIT_SHIFT);
      }),
      this.mode,
    ];
  }

  _encodeEntities(out) {
    const P = this.eq.projectiles, S = this.eq.smokes, T = this.turrets, G = this.gunships;
    if (P.length) out[10] = P.flatMap(p => [p.id, PROJECTILE_KINDS.indexOf(p.kind), Math.round(p.x * 10), Math.round(p.z * 10), Math.round(p.y * 10)]);
    if (S.length) out[11] = S.flatMap(s => [s.id, Math.round(s.x * 10), Math.round(s.z * 10), Math.round(s.r * 10)]);
    if (T.length) out[12] = T.flatMap(t => [t.id, t.owner.index, Math.round(t.x * 10), Math.round(t.z * 10), Math.round(t.aim * 20), Math.ceil(t.hp)]);
    if (G.length) out[13] = G.flatMap(g => [g.owner.index, Math.round(g.x * 10), Math.round(g.z * 10), Math.round(g.aim * 20)]);
  }

  _decodeMeta(meta) {
    const [camos, ints, mode] = meta;
    this.mode = mode;
    for (let i = 0; i < this.players.length && i < camos.length; i++) {
      const p = this.players[i], n = ints[i];
      p.camo = camos[i];
      p.ps.tactical = TACTICAL_IDS[n & 3] ?? p.ps.tactical;
      p.ps.lethal = LETHAL_IDS[(n >> 2) & 3] ?? p.ps.lethal;
      const kinds = p.score.slots.map((s, k) => STREAK_IDS[(n >> (4 + k * 3)) & 7] ?? s.kind);
      if (kinds.some((kind, k) => kind !== p.score.slots[k].kind)) setStreakKinds(p.score, kinds);
      // A guest's roster goes stale if someone changes loadout mid-match, and only the gun model cares.
      const bits = n >>> META_KIT_SHIFT;
      if (bits !== p.kitBits) { p.kitBits = bits; p.kitWeapon = null; }
    }
  }

  decodeSnapshot(d, localId) {
    const HEAD = 14;
    if (d[9]) this._decodeMeta(d[9]);
    const players = new Array(this.players.length);
    for (let i = 0; i < this.players.length; i++) {
      const o = HEAD + i * PLAYER_STRIDE, r = this.players[i], flags = d[o + 6], bits = d[o + 20];
      const slots = r.score.slots.map((s, k) => ({
        kind: s.kind, cost: s.cost, held: !!(bits & (1 << k)), blocked: !!(bits & (8 << k)),
      }));
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
        score: d[o + 19], capped: !!(flags & 64), slots,
        tacticalLeft: (bits >> 6) & 7, lethalLeft: (bits >> 9) & 7,
        tactical: r.ps.tactical, lethal: r.ps.lethal,
        heat: d[o + 21] / 20, overheated: !!(flags & 32), firingT: d[o + 22] / 10, head: d[o + 23],
        ghost: !!(flags & 16),
        attachments: this._decodedKit(r, WEAPON_IDS[d[o + 8]]),
      };
    }
    let lastKill = null;
    if (d[8]) {
      const [by, target, weapon, x, z] = d[8];
      lastKill = { by: this.players[by].id, target: this.players[target].id,
        weapon: WEAPON_IDS[weapon], camo: this.players[by].camo, x: x / 10, z: z / 10 };
    }
    return {
      t: d[0] / 100, phase: PHASES[d[1]], timeLeft: d[2] / 10, mode: this.mode,
      scores: [d[3], d[4]], winner: d[5] === -1 ? null : d[5],
      uav: [d[6] / 10, d[7] / 10], players, localId, lastKill,
      projectiles: this._decodeList(d[10], 5, (a, i) => ({ id: a[i], kind: PROJECTILE_KINDS[a[i + 1]], x: a[i + 2] / 10, z: a[i + 3] / 10, y: a[i + 4] / 10 })),
      smokes: this._decodeList(d[11], 4, (a, i) => ({ id: a[i], x: a[i + 1] / 10, z: a[i + 2] / 10, r: a[i + 3] / 10 })),
      turrets: this._decodeList(d[12], 6, (a, i) => ({ id: a[i], team: this.players[a[i + 1]].team, owner: this.players[a[i + 1]].id, x: a[i + 2] / 10, z: a[i + 3] / 10, aim: a[i + 4] / 20, hp: a[i + 5] })),
      gunships: this._decodeList(d[13], 4, (a, i) => ({ team: this.players[a[i]].team, owner: this.players[a[i]].id, x: a[i + 1] / 10, z: a[i + 2] / 10, aim: a[i + 3] / 20 })),
    };
  }

  _decodeList(a, stride, read) {
    if (!a) return [];
    const out = new Array(a.length / stride);
    for (let i = 0; i < out.length; i++) out[i] = read(a, i * stride);
    return out;
  }
}
