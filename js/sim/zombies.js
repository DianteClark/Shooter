// Graveyard Shift (docs/ZOMBIES.md, ROADMAP item 26): co-op wave survival, the host rules and the guest codec. A rules
// module like the modes overhaul's (js/sim/rules.js): the Sim calls in through `this.rules`.
//
// Shape of a match (numbers in ZM, js/shared/zombies.js):
//   Up to four players on team 0 (humans, bot teammates in every empty seat) start in the middle band of a map cut by
//   fences into bands (zmLayout). The horde is team 1: ZM.seats roster seats, each one zombie at a time, placed by these
//   rules at risers in open bands and driven here (driveBot): flow fields over the nav grid toward the nearest player
//   who is up, a short windup, a claw. Rounds escalate in count, health and the share of runners and brutes; every
//   tenth round brings a boss. A round ends when its count is dead.
//   Points: hits and kills pay, spent at wall-buys (and their ammo), the mystery crate, gates between bands, and four
//   perk machines. Everyone starts with the pistol and the blade (kit), whatever their class. Lethal damage downs a
//   player while anyone else is up; teammates revive (Mercy Run is faster); bleeding out means waiting for the next
//   round. Nobody up: the match is over. Kills drop power-ups now and then (Full Crate, Double Pay, Clean Sweep).
//
// Events: {t:'zround', round, boss}, {t:'zbreak', round}, {t:'zdoor', i, by}, {t:'zarm', id, slot, w} (the phone arms
// its own gun), {t:'zammo', id, slot?} (a refill; slot omitted: both), {t:'zperk', id, perk, lost?}, {t:'zbox', state,
// spot, gun?, by?}, {t:'zdrop', kind, x, z}, {t:'zpower', kind, by}, {t:'zbuy', id, kind, cost}, {t:'zswing', id},
// {t:'down', ...} and {t:'revive', id, by} as in battle royale, {t:'zover', round}, {t:'zlights', by} (the power is on,
// on a map with a switch: layout.power). The economy's own (bench, terminal, traps, exfil, quest): js/sim/zm-econ.js.
import { MAX_HP, WEAPON_IDS } from '../shared/constants.js';
import { normalizeLoadout } from '../shared/catalog.js';
import { WEAPONS } from '../shared/weapons.js';
import { hasLineOfSight } from '../shared/geometry.js';
import {
  ZM, ZE, ZM_TEAM, ZM_KINDS, ZM_PERK_IDS, ZM_PERKS, ZM_POWERUPS, BOX_GUNS, START_GUN, NO_GUN,
  roundCount, roundHp, roundMix, spawnGap, paceBonus, isBossRound, zmMaxHp, clawDmg, zmPace, bruteCap, zmLayout, placeZmWalls, syncZmDoors, reblockNav, zmUsable, bandOpen, zmDoorStand,
  specialRound, ZM_ROUNDS, ZK, isQuestBoss, isBossKind, zmWonderOf, ZM_WONDERS, ZM_WONDER_IDS, ZM_WONDER_ROLL, BOX_ROLL, zmUpgradable,
} from '../shared/zombies.js';
import { stepPlayer } from './player.js';
import { brArm, downedInput } from './br.js';
import { ZmEcon, kitRoom, kitRefill } from './zm-econ.js';
import { personaOf } from './zm-allies.js';      // Ally bots' personas: how each shops, fights and talks.
import { ZmKinds } from './zm-kinds.js';     // Spitters, Bloaters, Crawlers, Shieldbearers and the special rounds.     // ROADMAP item 36: the upgrade bench, the terminal, plates, traps, exfil, quest.
import { zmTierDef } from './zm-phone.js';

const PLAN_EVERY = 15;
const FIELD_EVERY = 12;           // Ticks between flow field rebuilds per target.
const STATES = ['pre', 'round', 'break', 'over'];
const SQRT2 = Math.SQRT2;
const BIG = 1e9;
const r1 = v => Math.round(v * 10);

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One zombie on the wire: seat, x and z in decimetres, aim in 64ths of a turn, kind (0..15: ZK, and 9 for a
// Shieldbearer whose shield is broken) and the winding-up flag: one number, about a dozen characters. Positions up to
// 204.7 m.
export function packZombie(seat, x, z, aim, kind, swing) {
  const xi = Math.max(0, Math.min(2047, Math.round(x * 10))), zi = Math.max(0, Math.min(2047, Math.round(z * 10)));
  const a = ((Math.round(aim / (Math.PI * 2) * 64) % 64) + 64) % 64;
  return ((((seat * 2048 + xi) * 2048 + zi) * 64 + a) * 16 + kind) * 2 + (swing ? 1 : 0);
}
export function unpackZombie(n) {
  const swing = n % 2; n = Math.floor(n / 2);
  const kind = n % 16; n = Math.floor(n / 16);
  const a = n % 64; n = Math.floor(n / 64);
  const zi = n % 2048; n = Math.floor(n / 2048);
  const xi = n % 2048; n = Math.floor(n / 2048);
  return { seat: n, x: xi / 10, z: zi / 10, aim: a / 64 * Math.PI * 2, kind, swing: !!swing };
}

export const ALLY_PAY = 1.75;

export class ZmRules {
  constructor(sim, seed) {
    this.sim = sim;
    this.seed = seed;
    this.ownSpawns = true;
    this.ownClock = true;
    this.allIn = true;
    this.noStreaks = true;      // Loadout scorestreaks neither charge nor fire here (Sim._deal, Sim.useStreak).
    this.rng = mulberry32((seed ^ 0x2b0d1e) >>> 0);
    this.L = zmLayout(sim.map);
    placeZmWalls(sim.map, 0);
    this.V = { zm: true, rules: this };
    this.authority = false;
    this.round = 0; this.state = 0; this.timer = ZM.warmup;
    this.count = 0; this.spawned = 0; this.killed = 0; this.spawnT = 0;
    this.open = 0;
    this.power = this.L.power ? 0 : 1;   // A map with a switch starts dark (the machines do not sell until it is on).
    this.box = { spot: 0, state: 0, gun: -1, owner: -1, timer: 0, uses: 0, moveAt: 6 };
    this.drops = []; this.dropId = 0; this.dropsThisRound = 0; this.doubleT = 0;
    this.fields = new Map();
    this.best = 0;
    this.bossSeat = -1;
    this._zs = [];            // Guest: decoded zombies.
    this._prev = new Map();   // Guest: last positions per seat, for velocities.
    this.econ = new ZmEcon(this);
    this.special = null;      // This round's special ('sprint' | 'fog' | 'bloat'), from specialRound.
    this.night = !!this.sim.mods?.includes('night');      // Night Graveyard (a weekly event).
    this.kinds = new ZmKinds(this);
  }

  // A crew member's mode state: points, perks (and the cap on them), the economy's plates and gun tiers.
  static crewState() {
    return { pts: ZM.startPts, perks: [], kills: 0, downs: 0, revives: 0, reviveT: 0, downedBy: null, spent: 0, bought: 0, head: 0,
      earned: 0, limit: ZM.perkLimit, plates: 0, tiers: {}, supply: {}, stk: null, breathAt: 0, selfT: 0, spentBy: {} };
  }

  // ---- Seats ----

  isZ(p) { return p.ai && p.team === ZM_TEAM; }
  get crew() { return this._crew ??= this.sim.players.filter(p => p.team !== ZM_TEAM); }
  // People in the crew (bots fill the rest): the horde's count and health scale with them past the first.
  get humans() { return Math.max(1, this.crew.filter(p => !p.isBot).length); }
  get horde() { return this._horde ??= this.sim.players.filter(p => this.isZ(p)); }

  // What a side carries: players the pistol and the blade, a frag and a stim, nothing of their class; zombies claws.
  kit(team, l) {
    const base = { ...l, attachments: {}, perks: [], streaks: [], pro: [], ladder: false };
    if (team === ZM_TEAM) return normalizeLoadout({ ...base, primary: NO_GUN, secondary: NO_GUN, tactical: 'stim', lethal: 'frag', camo: 'none' });
    return normalizeLoadout({ ...base, primary: START_GUN, secondary: NO_GUN, tactical: 'stim', lethal: 'frag' });
  }

  // ---- Start ----

  spawnAll() {
    const sim = this.sim;
    sim.interest = true;                  // Per-guest snapshots: zombies ride the objective block, not player records.
    const starts = this.L.starts;
    this.crew.forEach((p, k) => {
      p.zm = ZmRules.crewState();
      p.downed = false;
      const s = starts[k % starts.length] ?? { x: sim.map.width / 2, z: sim.map.height / 2 };
      sim._placeAt(p, s, 0);
    });
    for (const p of this.horde) { p.alive = false; p.hp = 0; p.noRegen = true; p.zk = 0; p.zFree = 0; }
    this.box.spot = this.L.boxSpots.length ? Math.floor(this.rng() * Math.min(2, this.L.boxSpots.length)) : -1;
    this.box.moveAt = this._moveAt();
    return true;
  }
  _moveAt() { const [a, b] = ZM.box.moveAfter; return a + Math.floor(this.rng() * (b - a + 1)); }

  holdDead() { return true; }             // Nobody comes back on the sim's clock: rounds bring players back, risers zombies.
  respawn() { return true; }

  onSpawn(p) {
    p.downed = false;
    if (this.isZ(p)) { p.spawnProtect = 0; p.noRegen = true; p.ps.tacticalLeft = 0; p.ps.lethalLeft = 0; return; }
    if (p.zm) { p.zm.reviveT = 0; p.zm.downedBy = null; p.zm.perks = []; p.zm.tiers = {}; p.zm.selfT = 0; }
    if (p.bot) p.bot.kite = 4.5;
  }

  // ---- One tick ----

  step(dt) {
    const sim = this.sim;
    this.authority = true;
    if (sim.phase !== 'live') return;
    if (this.state === 3) return;
    if (this.doubleT > 0) this.doubleT = Math.max(0, this.doubleT - dt);
    if (this.econ.exfilOn) sim.timeLeft = Math.max(0, this.econ.exfil.timer);     // The exfil's wave holds the round.
    else if (this.state === 0 || this.state === 2) {
      this.timer -= dt;
      sim.timeLeft = Math.max(0, this.timer);
      if (this.timer <= 0) this._startRound(this.round + 1);
    } else {
      sim.timeLeft = 0;
      this._stepSpawns(dt);
      if (this.killed >= this.count) this._endRound();
    }
    this.econ.step(dt);
    this.kinds.step(dt);
    if (this.state === 3) return;
    for (const p of this.crew) {
      if (!p.alive || p.away) continue;
      if (p.downed) this._stepDowned(p, dt);
      else if ((sim.tick + p.index) % 3 === 0) this._pickups(p);
    }
    this._stepBox(dt);
    if (this.drops.length && this.drops[0].t + ZM.drop.life < sim.time) this.drops.shift();
    if (sim.tick % PLAN_EVERY === 5) this._planCrew();
    this._checkOver();
  }

  _startRound(r) {
    const sim = this.sim;
    this.round = r;
    this.state = 1;
    this.count = roundCount(r, this.humans);
    this.spawned = 0; this.killed = 0;
    this.spawnT = 1.2;
    this.dropsThisRound = 0;
    this.hp = roundHp(r);
    this.bossDue = isBossRound(r);
    this.special = specialRound(r, this.seed);
    // Night Graveyard (a weekly event, the 'night' modifier): the fog in every round but the boss rounds.
    if (this.night && !this.bossDue) this.special = 'fog';
    if (this.special === 'bloat') this.count = Math.max(6, Math.round(this.count * 0.7));
    this.kinds.startRound();
    sim.scores[0] = r;
    // Everyone who bled out is back, with the pistol, at a teammate's side.
    for (const p of this.crew) {
      if (p.away) continue;
      if (!p.alive) sim._placeAt(p, this._spotNear(p), 0);
      if (p.isBot && p.alive) this._topUp(p);
    }
    sim._emit({ t: 'zround', round: r, boss: this.bossDue ? 1 : 0, special: this.special ?? undefined });
  }

  _endRound() {
    this.state = 2;
    this.timer = ZM.between;
    this.best = Math.max(this.best, this.round);
    this.sim._emit({ t: 'zbreak', round: this.round });
  }

  _checkOver() {
    const sim = this.sim;
    if (this.state === 3 || sim.phase !== 'live') return;
    const humans = this.crew.filter(p => !p.isBot);
    const up = this.crew.some(p => p.alive && (!p.downed || p.zm?.selfT > 0) && !p.away);     // Last Breath: getting up.
    // Humans all gone (dropped) with a human match: over too.
    const left = humans.length > 0 && humans.every(p => p.away);
    if (up && !left) return;
    this.state = 3;
    this.best = Math.max(this.best, this.round - 1);
    for (const p of this.crew) if (p.alive && p.downed) { p.downed = false; sim._selfKill(p, 'bleed'); }
    sim._emit({ t: 'zover', round: this.round });
    sim._end(ZM_TEAM);
  }

  // A spot for a returning player: beside a teammate who is up, else a start.
  _spotNear(p) {
    const sim = this.sim;
    const mate = this.crew.find(q => q !== p && q.alive && !q.downed);
    if (mate) {
      for (let k = 0; k < 12; k++) {
        const a = sim.rng() * Math.PI * 2, d = 1.5 + sim.rng() * 2.5;
        const x = mate.ps.x + Math.cos(a) * d, z = mate.ps.z + Math.sin(a) * d;
        if (sim.nav?.isWalkable(x, z)) return { x, z };
      }
      return { x: mate.ps.x, z: mate.ps.z };
    }
    return this.L.starts[p.index % this.L.starts.length];
  }

  // ---- The horde ----

  _stepSpawns(dt) {
    const sim = this.sim;
    if (this.spawned >= this.count) return;
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = spawnGap(this.round) * (0.7 + 0.6 * this.rng());
    const seat = this.horde.find(p => !p.alive && (p.zFree ?? 0) <= sim.time);
    if (!seat) return;
    let spot = this._riser();
    if (!spot) return;
    // The boss comes with the first of a boss round; otherwise roll the mix.
    let kind = 0;
    if (this.bossDue) { kind = 3; this.bossDue = false; spot = this._bossSpot() ?? spot; }
    else {
      const mix = roundMix(this.round), u = this.rng();
      const brutes = this.horde.filter(q => q.alive && q.zk === 2).length;
      kind = u < mix.brute && brutes < bruteCap(this.round) ? 2 : u < mix.brute + mix.runner ? 1 : 0;
      kind = this.kinds.pick(kind);
    }
    this._raise(seat, kind, spot);
    this.spawned++;
  }

  _raise(p, kind, spot) {
    const sim = this.sim, K = ZM.kinds[ZM_KINDS[kind]];
    p.zk = kind; p.zExtra = false; p.zSlowT = 0; p.zBurnT = 0; p.zFrozenT = 0; p.zChill = 0; p.zHoldT = 0; p.zUnderT = 0;
    sim._placeAt(p, spot, Math.atan2(sim.map.height / 2 - spot.z, sim.map.width / 2 - spot.x));
    p.hp = p.zMax = zmMaxHp(kind, this.hp, this.crew.length, this.humans);
    p.zSwing = 0; p.zCool = 0.4 + this.rng() * 0.4; p.zT = null; p.zStuck = 0; p.zLastX = spot.x; p.zLastZ = spot.z; p.zStuckT = 0;
    p.zPace = zmPace(kind, this.round) * (0.92 + this.rng() * 0.16);
    p.ps.tacticalLeft = 0; p.ps.lethalLeft = 0;
    p.zWindup = K.windup;
    this.kinds.raise(p);
    if (kind === 3) this.bossSeat = p.index;
  }

  // An open riser 12 to 40 m (by path) from the nearest player who is up, not right under anyone's nose.
  _riser() {
    const sim = this.sim, L = this.L;
    const fields = this._targets().map(q => this._field(q));
    const cands = [];
    L.risers.forEach((list, b) => {
      if (!bandOpen(L, this.open, b)) return;
      for (const s of list) cands.push(s);
    });
    if (!cands.length) return null;
    // A font drinking (Saltmere Abbey): it calls the drowned, a share of them climbing out near it.
    let pool = cands;
    const call = this.econ.fontCall?.();
    if (call && this.rng() < ZE.quest.call) { const near = cands.filter(s => Math.hypot(s.x - call.x, s.z - call.z) < 20); if (near.length) pool = near; }
    let best = null, bestS = -Infinity;
    for (let k = 0; k < 14; k++) {
      const s = pool[Math.floor(this.rng() * pool.length)];
      let d = BIG;
      const cell = Math.floor(s.z) * sim.nav.w + Math.floor(s.x);
      for (const f of fields) if (f) d = Math.min(d, f.dist[cell]);
      if (d >= BIG) { if (!fields.length) d = 30; else continue; }
      const sc = d < 12 ? d - 30 : d > 42 ? 42 - d * 0.5 : 20 + this.rng() * 10;
      if (sc > bestS) { bestS = sc; best = s; }
    }
    return best;
  }

  // The boss arena (layout.boss): the boss rises there when the arena is open, at the spot furthest from the crew.
  _bossSpot() {
    const B = this.L.boss;
    if (!B || !bandOpen(this.L, this.open, B.band) || !B.spots.length) return null;
    const crew = this._targets();
    let best = null, bd = -1;
    for (const s of B.spots) {
      const d = crew.reduce((m, q) => Math.min(m, Math.hypot(q.ps.x - s.x, q.ps.z - s.z)), Infinity);
      const sc = (d === Infinity ? 0 : Math.min(d, 30)) + this.rng();
      if (sc > bd) { bd = sc; best = s; }
    }
    return best;
  }

  _targets() {
    return this.crew.filter(q => q.alive && !q.downed && !q.away);
  }

  // Path distance field from a player, over the nav grid (Dijkstra, 8 neighbours, no corner cutting).
  _field(q) {
    const sim = this.sim, nav = sim.nav;
    if (!nav) return null;
    let f = this.fields.get(q.index);
    const cell = nav.idx(q.ps.x, q.ps.z);
    if (f && (sim.tick - f.at < FIELD_EVERY || f.cell === cell) && sim.tick - f.at < FIELD_EVERY * 4) return f;
    const n = nav.w * nav.h;
    // A new field's age is offset by the player's seat, so the crew's four rebuilds fall on different ticks.
    const fresh = !f;
    if (!f) { f = { dist: new Float32Array(n), at: 0, cell: -1 }; this.fields.set(q.index, f); }
    f.at = sim.tick - (fresh ? (q.index % 4) * 3 : 0); f.cell = cell;
    const dist = f.dist; dist.fill(BIG);
    const heap = this._heap ??= new Int32Array(n * 8), key = this._key ??= new Float32Array(n * 8);
    let hn = 0;
    const push = (k, v) => { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (key[p] <= v) break; heap[i] = heap[p]; key[i] = key[p]; i = p; } heap[i] = k; key[i] = v; };
    const pop = () => {
      const top = heap[0], last = heap[--hn], lv = key[hn];
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && key[c + 1] < key[c]) c++; if (key[c] >= lv) break; heap[i] = heap[c]; key[i] = key[c]; i = c; }
      heap[i] = last; key[i] = lv;
      return top;
    };
    const start = nav.blocked[cell] ? nav.nearestFree(q.ps.x, q.ps.z) : cell;
    dist[start] = 0; push(start, 0);
    const W = nav.w, H = nav.h, bl = nav.blocked;
    while (hn > 0) {
      const v = key[0], c = pop();
      if (v > dist[c]) continue;
      const ci = c % W, cj = (c - ci) / W;
      for (let dj = -1; dj <= 1; dj++) {
        const nj = cj + dj;
        if (nj < 0 || nj >= H) continue;
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          if (ni < 0 || ni >= W) continue;
          const k = nj * W + ni;
          if (bl[k]) continue;
          if (di && dj && (bl[cj * W + ni] || bl[nj * W + ci])) continue;
          const nd = v + (di && dj ? SQRT2 : 1);
          if (nd < dist[k]) { dist[k] = nd; if (hn < heap.length) push(k, nd); }
        }
      }
    }
    return f;
  }

  // The rules drive the horde (and downed teammates): true when BotBrain should not run.
  driveBot(p, dt) {
    if (this.isZ(p)) { this._driveZombie(p, dt); return true; }
    if (!p.downed) return false;
    const sim = this.sim;
    const I = this._downIn ??= { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1 };
    I.mx = 0; I.mz = 0; I.aim = p.ps.aim;
    let best = null, bestD = 30;
    for (const q of this.crew) {
      if (q === p || !q.alive || q.downed) continue;
      const d = Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (best && bestD > 1.4) {
      const dx = best.ps.x - p.ps.x, dz = best.ps.z - p.ps.z;
      if (sim.nav.isWalkable(p.ps.x + dx / bestD, p.ps.z + dz / bestD)) { I.mx = dx / bestD; I.mz = dz / bestD; I.aim = Math.atan2(dz, dx); }
    }
    downedInput(I);
    stepPlayer(p.ps, I, dt, sim.map, sim.rng);
    return true;
  }

  _driveZombie(p, dt) {
    const sim = this.sim, nav = sim.nav, ps = p.ps;
    const K = ZM.kinds[ZM_KINDS[p.zk]];
    const I = this._zIn ??= { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1 };
    I.mx = 0; I.mz = 0; I.aim = ps.aim; I.sprint = false;
    if (this.state === 3) { stepPlayer(ps, I, dt, sim.map, sim.rng); return; }
    // Frozen solid (the Rimecaster): it neither walks nor claws until it thaws.
    // Held (the Barker winding up and running its charge: js/sim/zm-fair.js moves it): the same.
    if (p.zFrozenT > sim.time || p.zHoldT > sim.time) { p.zSwing = 0; p.zStuckT = 0; stepPlayer(ps, I, dt, sim.map, sim.rng); return; }
    // Target: the nearest player who is up, by path. A zombie shouldering a wall stands in a cell the grid calls blocked:
    // it reads the field from the nearest free one.
    let cell = nav.idx(ps.x, ps.z);
    if (nav.blocked[cell]) cell = nav.nearestFree(ps.x, ps.z);
    let tgt = null, td = BIG, field = null;
    for (const q of this._targets()) {
      const f = this._field(q);
      const d = f ? f.dist[cell] : BIG;
      if (d < td) { td = d; tgt = q; field = f; }
    }
    // A lure (the supply terminal's) pulls whatever is within its reach by path, ahead of the crew.
    if (this.econ.gear.length) {
      for (const g of this.econ.lures) {
        const f = this._field(g), d = f ? f.dist[cell] : BIG;
        if (d < ZE.supply.lure.pull && d - 15 < td) { td = d - 15; tgt = g; field = f; }
      }
    }
    if (!tgt) {
      // Somewhere unreachable (or nobody up): stand, and after a while sink back for a fresh riser.
      p.zStuckT += dt;
      if (p.zStuckT > 5) this._sink(p);
      stepPlayer(ps, I, dt, sim.map, sim.rng);
      return;
    }
    const dx = tgt.ps.x - ps.x, dz = tgt.ps.z - ps.z, d = Math.hypot(dx, dz);
    // The claw: wind up in reach, strike if still in reach.
    if (p.zCool > 0) p.zCool -= dt;
    if (p.zSwing > 0) {
      p.zSwing -= dt;
      I.aim = Math.atan2(dz, dx);
      if (p.zSwing <= 0) {
        p.zCool = K.cool;
        if (this.kinds.swungOut(p)) return;      // A Bloater bursts instead.
        const hit = this._clawTarget(p, K.reach + 0.45);
        if (hit) sim._damage(hit, p, clawDmg(p.zk, this.round), NO_GUN, Math.hypot(hit.ps.x - ps.x, hit.ps.z - ps.z));
      }
    } else if (this.kinds.claw(p, p.zCool <= 0 && !!this._clawTarget(p, K.reach))) {
      // A special's own claw (a Bloater swells).
    } else if (p.zCool <= 0 && this._clawTarget(p, K.reach)) {
      p.zSwing = K.windup;
      sim._emit({ t: 'zswing', id: p.id });
    }
    // Moving: straight in when close and in sight, else downhill on the field a few cells ahead.
    let mx = 0, mz = 0;
    if (d < 7 && (d < 1.2 || nav.segmentClear(ps.x, ps.z, tgt.ps.x, tgt.ps.z))) { mx = dx / Math.max(d, 0.01); mz = dz / Math.max(d, 0.01); }
    else if (field) {
      const W = nav.w, bl = nav.blocked, dist = field.dist;
      let c = cell;
      for (let s = 0; s < 3; s++) {
        const ci = c % W, cj = (c - ci) / W;
        let bc = c, bv = dist[c];
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= nav.h) continue;
          const k = nj * W + ni;
          if (bl[k] || (di && dj && (bl[cj * W + ni] || bl[nj * W + ci]))) continue;
          if (dist[k] < bv) { bv = dist[k]; bc = k; }
        }
        if (bc === c) break;
        c = bc;
      }
      const tx = (c % W) + 0.5 - ps.x, tz = Math.floor(c / W) + 0.5 - ps.z, tl = Math.hypot(tx, tz);
      if (tl > 0.05) { mx = tx / tl; mz = tz / tl; }
      else { mx = dx / Math.max(d, 0.01); mz = dz / Math.max(d, 0.01); }
    }
    // Shoulder room: zombies push off each other a little so a crowd spreads instead of stacking.
    let sx = 0, sz = 0;
    for (const q of this.horde) {
      if (q === p || !q.alive) continue;
      const ex = ps.x - q.ps.x, ez = ps.z - q.ps.z, e2 = ex * ex + ez * ez;
      if (e2 > 0.81 || e2 < 1e-6) continue;
      const e = Math.sqrt(e2);
      sx += ex / e * (0.9 - e); sz += ez / e * (0.9 - e);
    }
    mx += sx * 1.4; mz += sz * 1.4;
    const ml = Math.hypot(mx, mz);
    const pace = p.zSwing > 0 ? 0.15 : p.zPace * (p.zSlowT > sim.time ? 0.45 : 1);     // Rime rounds slow.
    if (ml > 1e-4) { I.mx = mx / ml * pace; I.mz = mz / ml * pace; }
    I.aim = d < 3 ? Math.atan2(dz, dx) : ml > 1e-4 ? Math.atan2(mz, mx) : ps.aim;
    if (p.zSwing <= 0 && this.kinds.steer(p, tgt, d, dt, I)) { if (p.zSlowT > sim.time) { I.mx *= 0.45; I.mz *= 0.45; } }
    // Turn at a zombie's pace, not a soldier's.
    const da = Math.atan2(Math.sin(I.aim - ps.aim), Math.cos(I.aim - ps.aim));
    I.aim = ps.aim + Math.max(-7 * dt, Math.min(7 * dt, da));
    stepPlayer(ps, I, dt, sim.map, sim.rng);
    // Stuck on something: sink and rise again elsewhere.
    p.zStuckT += dt;
    if (p.zStuckT > 3) {
      const moved = Math.hypot(ps.x - p.zLastX, ps.z - p.zLastZ);
      if (moved < 0.6 && d > 3) { p.zStuck++; if (p.zStuck >= 2) { this._sink(p); return; } } else p.zStuck = 0;
      p.zStuckT = 0; p.zLastX = ps.x; p.zLastZ = ps.z;
    }
  }

  // The player this zombie can claw: up, within reach and in sight.
  _clawTarget(p, reach) {
    let best = null, bd = reach;
    for (const q of this.crew) {
      if (!q.alive || q.downed || q.away) continue;
      const d = Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z);
      if (d < bd && hasLineOfSight(this.sim.map, p.ps.x, p.ps.z, q.ps.x, q.ps.z)) { bd = d; best = q; }
    }
    return best;
  }

  // A zombie leaves quietly (stuck, or nowhere to go) and its place in the round's count rises again later.
  _sink(p) {
    p.alive = false; p.hp = 0; p.zFree = this.sim.time + 1;
    if (p.zExtra) { this.econ.onSink(p); p.zExtra = false; return; }     // Off the round's count: nothing to give back.
    if (this.bossSeat === p.index) { this.bossDue = true; this.bossSeat = -1; }
    this.spawned = Math.max(this.killed, this.spawned - 1);
  }

  // ---- Damage and deaths ----

  // `streak`: the economy's own sources ('ztrap', 'zsentry', 'zdrone', 'zstrike', 'zlure', 'zfx' for a tier-3 round's
  // effect) pay no hit points and take no perk or tier on top: their damage is already what it should be.
  damage(target, attacker, dmg, weapon, streak, equip) {
    if (this.isZ(target)) {
      // Under the flood (the Ferryman's undertow, js/sim/zm-abbey.js): nothing reaches it.
      if (target.zUnderT > this.sim.time) return 0;
      if (!attacker?.zm) return dmg;
      if (streak && streak[0] === 'z') return dmg;
      dmg = this.kinds.shield(target, attacker, dmg, weapon, streak, equip);
      if (!(dmg > 0)) return 0;
      if (attacker.zm.perks.includes('hammer')) dmg *= 1.5;
      dmg = this.econ.gunHit(target, attacker, dmg, weapon);
      this._pay(attacker, ZM.pts.hit);
      return dmg;
    }
    if (target.downed) return 0;
    if (this.isZ(attacker) && target.zm?.perks.includes('iron')) dmg *= 0.5;
    if (this.isZ(attacker) && target.zm) dmg = this.econ.soak(target, dmg);     // Armour plates.
    return dmg;
  }

  medal() { return false; }             // Medals are a soldier's game: a horde would spam them.

  tryDown(p, attacker, weapon) {
    if (this.isZ(p) || p.downed || !p.zm) return false;
    // Last Breath, charged: down, and up again by yourself in a moment, perks kept (even with nobody else up).
    const breath = p.zm.perks.includes('breath') && (p.zm.breathAt ?? 0) <= this.round;
    if (!breath && !this.crew.some(q => q !== p && q.alive && !q.downed && !q.away)) return false;
    p.downed = true;
    p.hp = 100;
    p.zm.reviveT = 0; p.zm.downs++;
    p.zm.downedBy = attacker && attacker !== p ? attacker.id : null;
    p.ps.sprinting = false; p.ps.sliding = false;
    if (breath) { p.zm.selfT = 3; p.zm.breathAt = this.round + 3; this.sim._emit({ t: 'zbreath', id: p.id }); }
    else this._losePerks(p);
    this.sim._emit({ t: 'down', by: attacker?.id ?? p.id, target: p.id, weapon, x: Math.round(p.ps.x * 100) / 100, z: Math.round(p.ps.z * 100) / 100 });
    return true;
  }

  _losePerks(p) {
    if (!p.zm.perks.length) return;
    p.zm.perks = [];
    p.ps.perks = p.ps.perks.filter(k => k !== 'fasthands' && k !== 'marathon');
    if (!p.isBot) this.sim._emit({ t: 'zperk', id: p.id, lost: 1 });
  }

  _stepDowned(p, dt) {
    const sim = this.sim, b = p.zm;
    if (b.selfT > 0) {
      b.selfT -= dt;
      if (b.selfT <= 0) { p.downed = false; p.hp = ZM.reviveHp; p.regenT = 2; b.reviveT = 0; b.downedBy = null; sim._emit({ t: 'revive', id: p.id, by: p.id }); }
      return;
    }
    p.hp -= 100 / ZM.bleed * dt;
    if (p.hp <= 0) { p.downed = false; sim._selfKill(p, 'bleed'); return; }
    let helper = null;
    for (const q of this.crew) {
      if (q === p || !q.alive || q.downed || q.away) continue;
      if (Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z) > ZM.reviveReach) continue;
      if (Math.hypot(q.ps.vx, q.ps.vz) > 2.6) continue;     // Standing by is enough: shooting over them still counts.
      helper = q; break;
    }
    if (helper) {
      b.reviveT += dt;
      const need = helper.zm.perks.includes('mercy') ? ZM.reviveFast : ZM.reviveTime;
      b.reviveT = Math.min(b.reviveT, ZM.reviveTime);
      if (b.reviveT >= need) {
        p.downed = false; p.hp = ZM.reviveHp; p.regenT = 2; b.reviveT = 0; b.downedBy = null;
        helper.zm.revives++;
        this._pay(helper, ZM.pts.revive, false);
        sim._emit({ t: 'revive', id: p.id, by: helper.id });
      }
      helper.zReviving = sim.time;
    } else b.reviveT = Math.max(0, b.reviveT - dt * 1.5);
  }

  onKill(target, killer, info = {}) {
    const sim = this.sim;
    if (this.isZ(target)) {
      target.zFree = sim.time + 0.6;
      if (info.away) { this._sink(target); return; }
      if (!target.zExtra) this.killed++;
      this.kinds.onDeath(target, killer, info);
      const boss = target.zk === 3;
      if (boss) this.bossSeat = -1;
      this.econ.onKill(target, killer);
      if (killer?.zm) {
        killer.zm.kills++;
        if (info.head) killer.zm.head++;
        const melee = !info.equip && !info.streak && WEAPONS[info.weapon]?.melee;
        const econ = this.econ.killPay(info);
        this._pay(killer, econ ?? (boss ? ZM.pts.boss : melee ? ZM.pts.melee : info.head ? ZM.pts.head : ZM.pts.kill));
      }
      target.zExtra = false;
      if (boss) this._dropAt(target.ps.x, target.ps.z, 'ammo');
      else if (this.dropsThisRound < ZM.drop.perRound && this.rng() < ZM.drop.chance) this._dropAt(target.ps.x, target.ps.z);
      return;
    }
    if (!target.zm) return;
    target.downed = false;
    target.zm.reviveT = 0;
    this._losePerks(target);
    // Nobody left up: whoever is still down goes too (and _checkOver ends it).
  }

  _pay(p, n, double = true) {
    if (!p?.zm) return;
    // Ally bots earn ALLY_PAY times as much, so a bot crew can afford a bench tier before the round-10 boss
    // (docs/ZOMBIES.md "Ally bots"); humans' points are unchanged.
    const v = Math.round(n * (double && this.doubleT > 0 ? 2 : 1) * (this.night ? 2 : 1) * (p.isBot && this.crew.some(q => !q.isBot) ? ALLY_PAY : 1));     // Night Graveyard pays double.
    p.zm.pts += v; p.zm.earned += v;
  }

  // ---- Power-ups ----

  _dropAt(x, z, kind = null) {
    kind ??= ZM_POWERUPS[Math.floor(this.rng() * ZM_POWERUPS.length)];
    const sim = this.sim;
    const at = sim.nav && !sim.nav.isWalkable(x, z) ? (() => { const k = sim.nav.nearestFree(x, z); return { x: k % sim.nav.w + 0.5, z: Math.floor(k / sim.nav.w) + 0.5 }; })() : { x, z };
    const d = { id: ++this.dropId, kind, x: Math.round(at.x * 10) / 10, z: Math.round(at.z * 10) / 10, t: sim.time };
    this.drops.push(d);
    this.dropsThisRound++;
    sim._emit({ t: 'zdrop', kind, x: d.x, z: d.z });
  }

  _pickups(p) {
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (Math.hypot(d.x - p.ps.x, d.z - p.ps.z) > ZM.drop.reach) continue;
      this.drops.splice(i, 1);
      this._power(d.kind, p);
      return;
    }
  }

  _power(kind, by) {
    const sim = this.sim;
    sim._emit({ t: 'zpower', kind, by: by.id });
    if (kind === 'ammo') {
      for (const q of this.crew) if (q.alive) { this._refill(q, -1); kitRefill(q.ps); }     // Grenades and tacticals too.
    } else if (kind === 'double') {
      this.doubleT = ZM.drop.double;
    } else if (kind === 'nuke') {
      for (const z of this.horde) if (z.alive && !isBossKind(z.zk)) sim._selfKill(z, 'nuke');     // Not the bosses (the Yardmaster, the quest's).
      for (const q of this.crew) this._pay(q, ZM.pts.nuke, false);
    }
  }

  // Ammo: slot -1 for both guns. The phone owns a human's guns, so it is told.
  _refill(p, slot) {
    const ps = p.ps;
    for (let s = 0; s < 2; s++) {
      if (slot >= 0 && s !== slot) continue;
      const w = ps.defs[s] ?? WEAPONS[s ? ps.secondary : ps.primary];
      if (!w || w.melee) continue;
      ps.ammo[s] = w.magazine;
      if (!w.unlimitedReserve) ps.reserve[s] = w.reserve ?? w.magazine * 3;
    }
    if (!p.isBot) this.sim._emit(slot >= 0 ? { t: 'zammo', id: p.id, slot } : { t: 'zammo', id: p.id });
  }
  _topUp(p) { this._refill(p, -1); }

  // ---- Buying ----

  // The phone's 'use' tap: whatever zmUsable says is in reach, if the points are there.
  command(p, msg) {
    if (!p || !p.zm || !p.alive || p.downed || this.state === 3) return false;
    if (msg?.act === 'deploy') return this.econ.deploy(p);     // The held supply streak, when its owner calls it.
    if (msg?.act !== 'use') return false;
    return this._use(p, this._usableFor(p), msg);
  }

  _usableFor(p) {
    return zmUsable(this.L, p.ps.x, p.ps.z, this._stateFor(p));
  }
  _stateFor(p) {
    const E = this.econ;
    return { open: this.open, box: { spot: this.box.spot, state: this.box.state, gun: this.box.gun, owner: this.box.owner }, pts: p.zm.pts, perks: p.zm.perks, guns: [p.ps.primary, p.ps.secondary], me: p.index, power: this.power,
      limit: p.zm.limit, held: p.ps.weapon, tier: p.zm.tiers[p.ps.weapon] ?? 0, bench: E.bench, traps: E.traps.map(t => t.state), plates: p.zm.plates, kitRoom: kitRoom(p.ps),
      exfil: E.exfil.state, round: this.round, quest: E.quest };
  }

  _use(p, u, msg = null) {
    if (!u || !u.ok) return false;
    const sim = this.sim, L = this.L;
    switch (u.kind) {
      case 'door': {
        const d = L.doors[u.i];
        this.open |= 1 << d.i;
        syncZmDoors(sim.map, this.open);
        reblockNav(sim.nav, sim.map, d);
        this.fields.clear();
        sim._emit({ t: 'zdoor', i: d.i, by: p.id });
        break;
      }
      case 'wall': this._give(p, u.gun); break;
      case 'ammo': this._refill(p, p.ps.primary === u.gun ? 0 : 1); break;
      case 'box': {
        const b = this.box;
        b.uses++;
        const moving = b.uses >= b.moveAt && L.boxSpots.length > 1;
        b.state = 1; b.timer = ZM.box.roll; b.owner = p.index; b.moving = moving;
        b.gun = moving ? -1 : this._rollGun(p);
        sim._emit({ t: 'zbox', state: 1, spot: b.spot, by: p.id });
        break;
      }
      case 'take': {
        const b = this.box;
        if (b.gun < 0) return false;
        this._give(p, BOX_GUNS[b.gun]);
        b.state = 0; b.gun = -1; b.owner = -1;
        sim._emit({ t: 'zbox', state: 0, spot: b.spot });
        break;
      }
      case 'power': {
        if (this.power) return false;
        this.power = 1;
        sim._emit({ t: 'zlights', by: p.id });
        break;
      }
      case 'perk': {
        if (p.zm.perks.length >= p.zm.limit) return false;
        p.zm.perks.push(u.perk);
        if (u.perk === 'quick' && !p.ps.perks.includes('fasthands')) p.ps.perks = [...p.ps.perks, 'fasthands'];
        if (u.perk === 'stride' && !p.ps.perks.includes('marathon')) p.ps.perks = [...p.ps.perks, 'marathon'];
        if (!p.isBot) sim._emit({ t: 'zperk', id: p.id, perk: u.perk });
        break;
      }
      default: {
        // The economy's (js/sim/zm-econ.js): it says what it costs, or refuses.
        const cost = this.econ.use(p, u, msg);
        if (cost === null || cost > p.zm.pts) return false;
        u.cost = cost;
      }
    }
    p.zm.pts -= u.cost; p.zm.spent += u.cost; p.zm.bought++;
    const cat = u.kind === 'ammo' || u.kind === 'wall' || u.kind === 'box' ? 'guns' : u.kind === 'perk' || u.kind === 'slot' ? 'perks' : u.kind === 'door' ? 'gates' : u.kind;
    if (u.cost) p.zm.spentBy[cat] = (p.zm.spentBy[cat] ?? 0) + u.cost;
    sim._emit({ t: 'zbuy', id: p.id, kind: u.kind, cost: u.cost, gun: u.gun ?? null, perk: u.perk ?? null, ...(u.item ? { item: u.item } : {}) });
    return true;
  }

  _rollGun(p) {
    const own = [p.ps.primary, p.ps.secondary];
    // Now and then a wonder weapon (ZM_WONDERS), one the roller does not hold already.
    if (this.rng() < ZM_WONDER_ROLL) {
      const w = ZM_WONDERS[ZM_WONDER_IDS[Math.floor(this.rng() * ZM_WONDER_IDS.length)]];
      if (!own.includes(w.gun)) return BOX_GUNS.indexOf(w.gun);
    }
    for (let k = 0; k < 8; k++) {
      const i = Math.floor(this.rng() * BOX_ROLL);
      if (!own.includes(BOX_GUNS[i]) && WEAPONS[BOX_GUNS[i]]) return i;
    }
    return BOX_GUNS.slice(0, BOX_ROLL).findIndex(g => !own.includes(g));
  }

  _stepBox(dt) {
    const b = this.box, sim = this.sim;
    if (b.state === 0) return;
    b.timer -= dt;
    if (b.timer > 0) return;
    if (b.state === 1) {
      if (b.moving) {
        // Empty: the money back, and the crate is off to another spot.
        const p = sim.players[b.owner];
        if (p?.zm) { p.zm.pts += ZM.box.cost; p.zm.spent -= ZM.box.cost; }
        b.state = 3; b.timer = ZM.box.away; b.gun = -1;
        sim._emit({ t: 'zbox', state: 3, spot: b.spot });
        return;
      }
      b.state = 2; b.timer = ZM.box.offer;
      sim._emit({ t: 'zbox', state: 2, spot: b.spot, gun: BOX_GUNS[b.gun], by: sim.players[b.owner]?.id });
      return;
    }
    if (b.state === 2) { b.state = 0; b.gun = -1; b.owner = -1; sim._emit({ t: 'zbox', state: 0, spot: b.spot }); return; }
    if (b.state === 3) {
      const spots = this.L.boxSpots.map((s, i) => i).filter(i => i !== b.spot);
      b.spot = spots[Math.floor(this.rng() * spots.length)] ?? b.spot;
      b.state = 0; b.uses = 0; b.moveAt = this._moveAt(); b.owner = -1; b.moving = false;
      sim._emit({ t: 'zbox', state: 0, spot: b.spot, moved: 1 });
    }
  }

  // A gun into the hands: into the blade's slot while there is one, else in place of the gun in hand.
  _give(p, gun) {
    const ps = p.ps, sim = this.sim;
    if (!WEAPONS[gun]) return;
    let slot = ps.secondary === NO_GUN ? 1 : ps.primary === NO_GUN ? 0 : ps.slot;
    if (ps.primary === gun) slot = 0; else if (ps.secondary === gun) slot = 1;
    const old = slot === 0 ? ps.primary : ps.secondary;
    if (p.zm && old !== gun) delete p.zm.tiers[old];        // A gun given up loses its bench tier.
    // A wonder weapon goes in at its own tier: its def (zmTierDef) and the host's effect come from that.
    const W = zmWonderOf(gun);
    if (W && p.zm) { p.zm.tiers[gun] = W.tier; this.econ._arm(p, slot, gun, W.tier); ps.slot = slot; ps.weapon = gun; return; }
    brArm(ps, slot, gun);
    ps.slot = slot; ps.weapon = gun;
    if (WEAPONS[gun].unlimitedReserve) ps.reserve[slot] = 999; else ps.reserve[slot] = WEAPONS[gun].reserve ?? WEAPONS[gun].magazine * 3;
    if (p.isBot) p.primary = ps.primary;
    else sim._emit({ t: 'zarm', id: p.id, slot, w: WEAPON_IDS.indexOf(gun) });
  }

  // ---- Bot teammates (docs/ZOMBIES.md "Ally bots"; who each one is: js/sim/zm-allies.js) ----

  // Revive first (a person before a bot), then hold together: fall back when hurt, call the held streak in when it is
  // needed, the power and the quest when it is safe, shop by plan, else a spot of its own near the lead (a gate near
  // them when there is one).
  plan(team, crew) {
    if (team === ZM_TEAM) { for (const b of crew) b.setObjective(null); return; }
    this._crewPlan = crew;
  }

  _planCrew() {
    const sim = this.sim, crew = this._crewPlan;
    if (!crew || this.state === 3) return;
    const people = this.crew.filter(p => !p.isBot && !p.away);
    const human = people.find(p => p.alive && !p.downed);
    const lead = human ?? people.find(p => p.alive) ?? this.crew.find(p => p.alive && !p.downed);
    const humans = people.length > 0;
    const up = crew.filter(b => b.p.alive && !b.p.downed && b.p.zm);
    const dist = (a, b) => Math.hypot(a.ps.x - b.ps.x, a.ps.z - b.ps.z);
    // Who goes to whom: the downed, a person first, then whoever has bled longest; two go to a person, one to a bot,
    // the nearest free ones within their reach of the path. A reviver with three undead on it shoots first.
    const goTo = new Map();
    const downs = this.crew.filter(q => q.alive && q.downed && !q.away && !(q.zm?.selfT > 0)).sort((a, b) => (a.isBot - b.isBot) || a.hp - b.hp);
    for (const d of downs) {
      const free = up.filter(b => !goTo.has(b) && dist(b.p, d) < personaOf(b.p, this.crew).revive && this._count(b.p, 2.5) < 3).sort((a, b) => dist(a.p, d) - dist(b.p, d));
      for (const b of free.slice(0, d.isBot ? 1 : 2)) goTo.set(b, d);
    }
    let spot = 0;
    for (const bot of crew) {
      const p = bot.p;
      if (!p.alive || p.downed || !p.zm) continue;
      const P = personaOf(p, this.crew);
      bot.kite = P.kite;
      bot.zStill = null;
      // The held streak: called in where it stands when the crowd is big, a mate is down or the boss is up.
      if (p.zm.stk) this._botStreak(p, P);
      const down = goTo.get(bot);
      if (down) {
        if (dist(p, down) < ZM.reviveReach) bot.zStill = down.ps;      // In reach: stand still over them (bots.js).
        // Clear round them: straight in, nothing on the way stops it. Undead over them: fight in (kiting as usual).
        const hot = this._count(down, 3.5) >= 2;
        bot.setObjective({ key: `zrev${down.index}:${Math.round(down.ps.x)}:${Math.round(down.ps.z)}${hot ? 'h' : ''}`, role: 'collect', x: down.ps.x, z: down.ps.z, r: 0.8, commit: !hot });
        continue;
      }
      // The exfil is on: everyone to the pad.
      const X = this.econ.exfil, pad = this.L.exfil;
      if (X.state === 1 && pad) {
        const a = (spot++ + 1) * 1.7, x = pad.x + Math.cos(a) * pad.r * 0.5, z = pad.z + Math.sin(a) * pad.r * 0.5;
        const at = this._walk(x, z);
        bot.setObjective({ key: 'zexfil', role: 'defend', x: at.x, z: at.z, r: pad.r * 0.6 });
        continue;
      }
      // Its gun on the upgrade bench: wait by it, take it.
      const bn = this.econ.bench, bb = this.L.bench;
      if (bn.state && bn.owner === p.index && bb) {
        if (bn.state === 2 && Math.hypot(bb.x - p.ps.x, bb.z - p.ps.z) < ZM.useReach * 0.9) { this._use(p, zmUsable(this.L, p.ps.x, p.ps.z, this._stateFor(p))); bot.setObjective(null); continue; }
        bot.setObjective({ key: 'zbench', role: 'collect', x: bb.x, z: bb.z, r: 0.8 });
        continue;
      }
      // Its roll at the crate: wait for it, take it.
      const bx = this.box;
      if ((bx.state === 1 || bx.state === 2) && bx.owner === p.index && !bx.moving) {
        const bs = this.L.boxSpots[bx.spot];
        if (bx.state === 2 && Math.hypot(bs.x - p.ps.x, bs.z - p.ps.z) < ZM.useReach * 0.9) { this._use(p, zmUsable(this.L, p.ps.x, p.ps.z, this._stateFor(p))); bot.setObjective(null); continue; }
        bot.setObjective({ key: `zbox${bx.spot}`, role: 'collect', x: bs.x, z: bs.z, r: 0.8 });
        continue;
      }
      // Hurt, no plates, undead on it: fall back past the lead, away from the crowd, and fight from there.
      if (this.state === 1 && p.hp < P.low && p.zm.plates < 1 && this._count(p, 7) >= 2) {
        const back = this._fallBack(p, lead);
        if (back) { bot.setObjective({ key: `zback${Math.round(back.x / 3)}:${Math.round(back.z / 3)}`, role: 'collect', x: back.x, z: back.z, r: 1.5, commit: true }); continue; }
      }
      // The power, on a map with a switch: solo with bots, one bot goes and throws it after round 2 if nobody has.
      const run = this._powerRun(p, crew) ?? this._questRun(p, crew, humans);
      if (run?.hold) {
        // Holding a font while it drinks (Saltmere Abbey): a spot beside it, fighting what comes.
        const a = p.index * 1.3, at = this._walk(run.x + Math.cos(a) * 2, run.z + Math.sin(a) * 2);
        bot.setObjective({ key: `zqfont${run.use.i}`, role: 'defend', x: at.x, z: at.z, r: 2.4 });
        continue;
      }
      if (run) {
        if (Math.hypot(run.x - p.ps.x, run.z - p.ps.z) < ZM.useReach * 0.8) {
          // A radio locking on (its tuner has to stay by it): stand with it.
          if (this.econ.quest.tuneI >= 0 && this.econ.quest.tuneBy === p.index) { bot.zStill = run; continue; }
          this._use(p, run.use);
          if (this.econ.quest.tuneBy === p.index) bot.zStill = run;
          else bot.setObjective(null);
          continue;
        }
        bot.setObjective({ key: `zq${run.use.kind}${run.use.i}`, role: 'collect', x: run.x, z: run.z, r: 0.8, commit: run.use.kind === 'relic' });
        continue;
      }
      // Something to buy near.
      const want = this._botWant(p, humans, lead);
      if (want) {
        const d = Math.hypot(want.x - p.ps.x, want.z - p.ps.z);
        if (d < ZM.useReach * 0.8) {
          // The bench upgrades the gun in hand: a bot takes the one it came for out first.
          if (want.kind === 'bench' && want.gun && p.ps.weapon !== want.gun) { const sl = p.ps.primary === want.gun ? 0 : 1; p.ps.slot = sl; p.ps.weapon = want.gun; }
          const u = zmUsable(this.L, p.ps.x, p.ps.z, this._stateFor(p));
          if (want.kind === 'box' && u?.kind === 'box') p.zm.boxRound = this.round;
          this._use(p, u, want);
          bot.setObjective(null);
          continue;
        }
        bot.setObjective({ key: `zbuy${want.kind}${want.i}`, role: 'collect', x: want.x, z: want.z, r: 0.8 });
        continue;
      }
      // With the lead: a spot of its own, a gate near them first, else round them, never far.
      if (lead && lead !== p) {
        const at = this._holdSpot(p, lead, spot++, up.length, P);
        const far = dist(lead, p);
        if (far > P.ring + 5 || !bot.objective || bot.objKey?.startsWith('zs')) bot.setObjective({ key: `zs${Math.round(at.x / 3)}:${Math.round(at.z / 3)}`, role: 'defend', x: at.x, z: at.z, r: 2.2 });
      } else bot.setObjective({ key: 'zhold', role: 'defend', x: this.L.bands[this.L.start].cx, z: this.L.bands[this.L.start].cz, r: 5 });
    }
  }

  // Undead (alive) within r of p.
  _count(p, r) {
    let n = 0;
    for (const q of this.horde) if (q.alive && Math.abs(q.ps.x - p.ps.x) < r && Math.abs(q.ps.z - p.ps.z) < r && Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z) < r) n++;
    return n;
  }

  // Where a hurt bot falls back to: 7 m from the crowd near it, toward the lead's side when that is the way out.
  _fallBack(p, lead) {
    let cx = 0, cz = 0, n = 0;
    for (const q of this.horde) if (q.alive && Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z) < 9) { cx += q.ps.x; cz += q.ps.z; n++; }
    if (!n) return null;
    cx /= n; cz /= n;
    let ux = p.ps.x - cx, uz = p.ps.z - cz, l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l;
    if (lead && lead !== p) {
      const lx = lead.ps.x - p.ps.x, lz = lead.ps.z - p.ps.z, ll = Math.hypot(lx, lz);
      if (ll > 2 && (lx * ux + lz * uz) / ll > -0.2) { ux = ux * 0.4 + lx / ll * 0.6; uz = uz * 0.4 + lz / ll * 0.6; l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l; }
    }
    const nav = this.sim.nav;
    for (const s of [7, 5, 3]) {
      const x = p.ps.x + ux * s, z = p.ps.z + uz * s;
      if (nav.isWalkable(x, z) && !this._inTrap(x, z)) return { x, z };
    }
    return null;
  }

  _inTrap(x, z, pad = 1.2) {
    return this.L.traps.some((T, i) => this.econ.traps[i]?.state === 1 && Math.hypot(T.x - x, T.z - z) < T.r + pad);
  }

  // A bot's own spot near the lead: the open gates within 14 m of them, one bot to each (3.5 m back on the lead's
  // side), the rest spread round the lead at the persona's ring. Never on a running trap.
  _holdSpot(p, lead, k, n, P) {
    const L = this.L, lx = lead.ps.x, lz = lead.ps.z;
    const gates = (this._gateCache?.open === this.open && this._gateCache.t > this.sim.time - 1 && this._gateCache.lead === lead) ? this._gateCache.list
      : (this._gateCache = { open: this.open, t: this.sim.time, lead, list: L.doors.filter(d => this.open & (1 << d.i) && Math.hypot(d.cx - lx, d.cz - lz) < 14).sort((a, b) => Math.hypot(a.cx - lx, a.cz - lz) - Math.hypot(b.cx - lx, b.cz - lz)) }).list;
    if (k < gates.length) {
      const d = gates[k], l = Math.hypot(lx - d.cx, lz - d.cz) || 1, s = Math.min(3.5, l);
      const at = this._walk(d.cx + (lx - d.cx) / l * s, d.cz + (lz - d.cz) / l * s);
      if (!this._inTrap(at.x, at.z)) return at;
    }
    const a = lead.index * 0.7 + (k / Math.max(1, n)) * Math.PI * 2;
    for (let t = 0; t < 4; t++) {
      const at = this._walk(lx + Math.cos(a + t * 0.8) * P.ring, lz + Math.sin(a + t * 0.8) * P.ring);
      if (!this._inTrap(at.x, at.z)) return at;
    }
    return this._walk(lx, lz);
  }

  // The held supply streak (bought at the terminal into the one slot): a strike on a crowd, a sentry or drone when the
  // crowd is building, a mate is down near or the boss is up.
  _botStreak(p, P) {
    if (this.state !== 1 || this.econ.gear.length >= ZE.gearMax) return;
    const n = this._count(p, 14), item = p.zm.stk;
    const mate = this.crew.some(q => q !== p && q.alive && q.downed && Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z) < 20);
    const boss = this.bossSeat >= 0 && this.sim.players[this.bossSeat]?.alive && Math.hypot(this.sim.players[this.bossSeat].ps.x - p.ps.x, this.sim.players[this.bossSeat].ps.z - p.ps.z) < 25;
    const go = item === 'strike' ? n >= P.streak || (boss && n >= 2) : n >= P.streak - 2 || (mate && n >= 2) || boss;
    if (go) this.econ.deploy(p);
  }

  // The quest, when it is safe (between rounds, or nobody within 12 m): one bot (the last one up) picks up the relics
  // or tunes the radios once the power is on. The last step (the altar, the console) is a person's moment: a bot only
  // takes it with no person in the crew.
  _questRun(p, crew, humans) {
    const L = this.L, E = this.econ, q = E.quest;
    if (!L.relics?.length || q.state || this.round < 3 || this.state === 3) return null;
    const mine = q.tuneI >= 0 && q.tuneBy === p.index;
    if (!mine && [...crew].reverse().find(b => b.p.alive && !b.p.downed && b.p.zm && b.p.isBot)?.p !== p) return null;
    // Lanterns burning (Wrenfield Fair): no waiting for a quiet moment, the clock is running.
    const burning = L.questKind === 'lantern' && q.burnT > 0;
    // A font drinking (Saltmere Abbey): the bot holds by it and fights there, whatever is about, so the kills feed it.
    if (L.questKind === 'font' && q.woke && !L.relics.every(r => q.got & (1 << r.i))) {
      const f = L.relics.find(r => q.woke & (1 << r.i) && !(q.got & (1 << r.i)) && bandOpen(L, this.open, r.band));
      if (f) return { x: f.x, z: f.z, hold: true, use: { kind: 'font', i: f.i, cost: 0, ok: false } };
    }
    if (!mine && !burning && this.state === 1 && (this._count(p, 12) > 0 || this.killed < this.count * 0.15)) return null;
    if (mine) { const r = L.relics[q.tuneI]; return { x: r.x, z: r.z, use: { kind: 'relic', i: r.i, cost: 0, ok: true } }; }
    const left = L.relics.filter(r => !(q.got & (1 << r.i)) && bandOpen(L, this.open, r.band));
    const all = L.relics.every(r => q.got & (1 << r.i));
    if (all) {
      if (humans || !L.altar || !bandOpen(L, this.open, L.altar.band ?? L.band[L.cellAt(L.altar.x, L.altar.z)])) return null;
      if (this.round < 8) return null;
      return { x: L.altar.x, z: L.altar.z, use: { kind: 'altar', i: 0, cost: 0, ok: true } };
    }
    if (L.questKind === 'radio' && (!this.power || q.tuneI >= 0)) return null;
    if (L.questKind === 'lantern') {
      // The Oracle first (it needs the power), then the next lantern in its order, whichever that is.
      if (!this.power) return null;
      if (!q.read) return L.oracle ? { x: L.oracle.x, z: L.oracle.z, use: { kind: 'oracle', i: 0, cost: 0, ok: true } } : null;
      const next = L.relics[q.order[L.relics.filter(r => q.got & (1 << r.i)).length]];
      if (!next) return null;
      if (bandOpen(L, this.open, next.band)) return { x: next.x, z: next.z, use: { kind: 'relic', i: next.i, cost: 0, ok: true } };
      // Shut away: the gates on the way, while it keeps something back for itself.
      return this._gateToward(p, next.band, 1500);
    }
    if (L.questKind === 'font') {
      // The fonts need the pumps (the power); one filled at a time, the nearest dry one open, else the gates to one.
      if (!this.power || q.woke) return null;
      const dry = L.relics.filter(r => !(q.got & (1 << r.i)));
      const open = dry.filter(r => bandOpen(L, this.open, r.band)).sort((a, b) => Math.hypot(a.x - p.ps.x, a.z - p.ps.z) - Math.hypot(b.x - p.ps.x, b.z - p.ps.z))[0];
      if (open) return { x: open.x, z: open.z, use: { kind: 'relic', i: open.i, cost: 0, ok: true } };
      return dry.length ? this._gateToward(p, dry[0].band, 1500) : null;
    }
    let best = null, bd = 50;
    for (const r of left) { const d = Math.hypot(r.x - p.ps.x, r.z - p.ps.z); if (d < bd) { bd = d; best = r; } }
    return best ? { x: best.x, z: best.z, use: { kind: 'relic', i: best.i, cost: 0, ok: true } } : null;
  }

  // What a bot would walk over to buy now, by its plan: a better wall gun as the rounds go up, perks in its persona's
  // order (health and revives first), plates and kit, the bench's tiers, the crate when rich, a held streak, a trap a
  // crowd funnels into (js/sim/zm-econ.js), gates when they lead somewhere worth it (never with the next perk's points).
  // Never in the middle of a fight it is losing.
  _botWant(p, humans, lead = null) {
    const L = this.L, z = p.zm, ps = p.ps, P = personaOf(p, this.crew);
    // Undead close: only what is within a step or two (a plate, the terminal, a trap's switch), never a walk.
    const close = this.state === 1 && this._near(p, 6);
    let best = null, bestS = -Infinity;
    const consider = (item, score) => { if (score > bestS) { bestS = score; best = item; } };
    const dist = (x, zz) => Math.hypot(x - ps.x, zz - ps.z);
    const hasGun = ps.primary !== START_GUN || (ps.secondary !== NO_GUN && ps.secondary !== START_GUN);
    // What a gun is worth, by its wall price (a crate gun counts as a good one), a bench tier on top.
    const worth = g => (g === START_GUN || g === NO_GUN ? 0 : (L.wallBuys.find(w => w.gun === g)?.cost ?? 1600) + (z.tiers[g] ?? 0) * 1500);
    const held = Math.max(worth(ps.primary), worth(ps.secondary));
    const c = P.cushion;
    // The next perk on its list (health and revives first): its points are kept back from the rest, and a gate to its
    // machine is worth opening.
    const perkM = this.power && z.perks.length < z.limit ? P.perks.map(k => L.machines.find(m => m.perk === k && !z.perks.includes(k))).find(Boolean) : null;
    const perkNeed = perkM ? ZM_PERKS[perkM.perk].cost : 0;
    // The bench's next tier, banked toward (a share by persona) once it has a gun worth it: everything but the gun, its
    // first perk, Ironhide, ammo, a first plate and the way to the bench waits on it. A hoarder banks for tier 2 too.
    const tierNow = Math.max(0, ...[ps.primary, ps.secondary].filter(g => g !== START_GUN && zmUpgradable(g)).map(g => z.tiers[g] ?? 0));
    const bank = L.bench && this.round >= P.bench - 2 && held >= 1000 && tierNow < (P.benchBias >= 10 ? 2 : 1) ? Math.round(ZE.bench.cost[tierNow] * P.save) : 0;
    const keep = perkNeed + bank;
    for (const w of L.wallBuys) {
      if (!bandOpen(L, this.open, w.band)) continue;
      const own = ps.primary === w.gun || ps.secondary === w.gun;
      const d = dist(w.x, w.z);
      if (d > 55) continue;
      if (own) {
        const slot = ps.primary === w.gun ? 0 : 1;
        if (ps.reserve[slot] < (WEAPONS[w.gun].magazine ?? 30) * 1.5 && z.pts >= w.ammo + 200) consider({ kind: 'ammo', i: w.i, x: w.x, z: w.z }, 50 - d * 0.5);
      } else if (!hasGun && z.pts >= w.cost) consider({ kind: 'wall', i: w.i, x: w.x, z: w.z }, 44 + w.cost / 100 - d * 0.5);
      else if (hasGun && z.pts >= w.cost + 400 * c + (held >= 1000 ? bank : 0) && w.cost > held + 150) consider({ kind: 'wall', i: w.i, x: w.x, z: w.z }, 36 + (w.cost - held) / 40 - d * 0.5);
    }
    const full = z.perks.length >= z.limit;
    for (const m of L.machines) {
      if (!bandOpen(L, this.open, m.band) || z.perks.includes(m.perk) || !this.power) continue;
      const d = dist(m.x, m.z);
      if (d > 50) continue;
      // At the cap: a perk slot when there is plenty over (the next machine visit buys the perk itself).
      if (full) {
        if (z.limit < ZM.perkMax && z.pts >= ZM.slotCost + 2500 * c) consider({ kind: 'slot', i: m.i, x: m.x, z: m.z }, 34 - d * 0.5);
        continue;
      }
      const cost = ZM_PERKS[m.perk].cost, rank = P.perks.indexOf(m.perk);
      const next = m === perkM || m.perk === 'iron';
      if (z.pts >= cost + (hasGun ? 200 : 1200) * c + (next ? 0 : bank + perkNeed)) consider({ kind: 'perk', i: m.i, x: m.x, z: m.z }, 38 - rank * 3 - d * 0.5);
    }
    // The crate, once the basics are bought and there are points to burn (once a round), while the gun in hand has no
    // tier worth keeping.
    const bs = this.box.state === 0 && this.box.spot >= 0 ? L.boxSpots[this.box.spot] : null;
    const tiered = [ps.primary, ps.secondary].some(g => (z.tiers[g] ?? 0) > 0);
    if (bs && bandOpen(L, this.open, bs.band) && hasGun && z.perks.length >= 2 && !tiered && z.boxRound !== this.round && z.pts >= ZM.box.cost + keep + P.box) {
      const d = dist(bs.x, bs.z);
      if (d < 45) consider({ kind: 'box', i: bs.i, x: bs.x, z: bs.z }, 18 + (held < 1300 ? 8 : 0) - d * 0.5);
    }
    this.econ.botWants(p, consider, P, keep);
    // Gates: with nobody else to open them, the next one out; with a person, one beside them (a hand through) or toward
    // a better gun, the bench or a perk it lacks; never with the points its next perk wants.
    {
      for (const d of L.doors) {
        if (this.open & (1 << d.i)) continue;
        const at = zmDoorStand(L, this.open, d);
        if (!at) continue;
        const far = bandOpen(L, this.open, d.a ?? d.from) ? (d.b ?? d.opens) : (d.a ?? d.from);
        const toPerk = perkM?.band === far, toBench = L.bench?.band === far;
        if (z.pts < d.cost + (toPerk ? 0 : perkNeed) + (toBench || toPerk ? 0 : bank) + (humans ? 1500 : 400) * c) continue;
        const worthIt = toPerk || toBench || L.wallBuys.some(w => w.band === far && w.cost > held + 150) || L.machines.some(m => m.band === far && !z.perks.includes(m.perk));
        const byLead = lead && lead !== p && !lead.isBot && Math.hypot(lead.ps.x - d.cx, lead.ps.z - d.cz) < 8;
        if (humans && !worthIt && !byLead && z.pts < 6000) continue;
        const dd = dist(d.cx, d.cz);
        if (dd < 50) consider({ kind: 'door', i: d.i, x: at.x, z: at.z }, (worthIt ? 16 : 5) + (toPerk ? 14 : 0) + (byLead ? 8 : 0) - dd * 0.4);
      }
    }
    if (close && best && Math.hypot(best.x - ps.x, best.z - ps.z) > 7) return null;
    return best;
  }

  // The bot that goes for the power switch (layout.power, still off, round 3 on, at most one human in the crew): the
  // first bot up in the crew. Its next step: the switch when the Pump Yard is open, else the gate one step nearer to it
  // that it can pay for. Null when there is nothing for it to do (it plays as usual).
  _powerRun(p, crew) {
    const L = this.L;
    if (!L.power || this.power || this.round < 3 || this.state === 3) return null;
    if (this.crew.filter(q => !q.isBot && !q.away).length > 1) return null;
    if (crew.find(b => b.p.alive && !b.p.downed && b.p.zm)?.p !== p) return null;
    if (this.state === 1 && this._near(p, 5)) return null;
    if (bandOpen(L, this.open, L.power.band)) return { x: L.power.x, z: L.power.z, use: { kind: 'power', i: 0, cost: 0, ok: true } };
    return this._gateToward(p, L.power.band);
  }

  // The next gate a bot can pay for on the way to area `band` (the one whose far side is fewest gates from it): a run
  // { x, z, use } or null.
  _gateToward(p, band, spare = 0) {
    const L = this.L;
    const dists = this._bandDist ??= new Map();
    let dist = dists.get(band);
    if (!dist) {
      dist = L.bands.map(() => Infinity);
      dist[band] = 0;
      for (let grew = true; grew;) {
        grew = false;
        for (const d of L.doors) for (const [u, v] of [[d.a ?? d.from, d.b ?? d.opens], [d.b ?? d.opens, d.a ?? d.from]]) if (dist[u] + 1 < dist[v]) { dist[v] = dist[u] + 1; grew = true; }
      }
      dists.set(band, dist);
    }
    let best = null, bd = Infinity;
    for (const d of L.doors) {
      if (this.open & (1 << d.i) || p.zm.pts < d.cost + spare) continue;
      const at = zmDoorStand(L, this.open, d);
      if (!at) continue;
      const far = bandOpen(L, this.open, d.a ?? d.from) ? (d.b ?? d.opens) : (d.a ?? d.from);
      const sc = dist[far] * 100 + Math.hypot(at.x - p.ps.x, at.z - p.ps.z);
      if (sc < bd) { bd = sc; best = { x: at.x, z: at.z, use: { kind: 'door', i: d.i, cost: d.cost, ok: true } }; }
    }
    return best;
  }

  _near(p, r) {
    for (const q of this.horde) if (q.alive && Math.abs(q.ps.x - p.ps.x) < r && Math.abs(q.ps.z - p.ps.z) < r) return true;
    return false;
  }

  _walk(x, z) {
    const nav = this.sim.nav, W = this.sim.map.width, H = this.sim.map.height;
    x = Math.max(2, Math.min(W - 2, x)); z = Math.max(2, Math.min(H - 2, z));
    if (nav && !nav.isWalkable(x, z)) { const k = nav.nearestFree(x, z); x = k % nav.w + 0.5; z = Math.floor(k / nav.w) + 0.5; }
    return { x, z };
  }

  // ---- View and wire ----

  playerView(p, v) {
    v.ai = !!p.ai;
    if (this.isZ(p)) { v.zk = p.alive ? p.zk + 1 : 0; v.zswing = p.zSwing > 0 || p.zSpitT > 0; v.zshield = p.zShield > 0; return; }
    if (!p.zm) return;
    v.downed = !!p.downed;
    v.reviveK = p.downed ? p.zm.reviveT / ZM.reviveTime : 0;
    v.zpts = p.zm.pts;
    v.zperks = p.zm.perks;
    v.zplates = p.zm.plates;
    v.zstk = p.zm.stk;
    v.zlimit = p.zm.limit;
    v.zbreath = p.zm.perks.includes('breath') ? ((p.zm.breathAt ?? 0) <= this.round ? 1 : 0) : -1;
  }

  view() {
    const V = this.V, b = this.box;
    V.round = this.round; V.state = STATES[this.state]; V.timer = this.timer; V.left = Math.max(0, this.count - this.killed);
    V.count = this.count; V.open = this.open; V.doubleT = this.doubleT; V.best = this.best; V.power = this.power; V.special = this.special;
    V.box = { spot: b.spot, state: b.state, gun: b.gun >= 0 ? BOX_GUNS[b.gun] : null, owner: b.owner, timer: b.timer };
    V.drops = this.drops;
    V.layout = this.L;
    V.crew = this.crew.map(p => ({ index: p.index, id: p.id, pts: p.zm?.pts ?? 0, perks: p.zm?.perks ?? [], kills: p.zm?.kills ?? 0, downs: p.zm?.downs ?? 0, revives: p.zm?.revives ?? 0, head: p.zm?.head ?? 0,
      plates: p.zm?.plates ?? 0, limit: p.zm?.limit ?? ZM.perkLimit, earned: p.zm?.earned ?? 0, spent: p.zm?.spent ?? 0 }));
    const boss = this.bossSeat >= 0 ? this.sim.players[this.bossSeat] : null;
    const ward = this.econ.wardenSeat >= 0 ? this.sim.players[this.econ.wardenSeat] : null;
    V.boss = ward?.alive && isQuestBoss(ward.zk) ? { hp: ward.hp / Math.max(1, ward.zMax), warden: true, k: ward.zk } : boss?.alive && boss.zk === 3 ? { hp: boss.hp / Math.max(1, boss.zMax) } : null;
    // A guest has the bars from the block (its own seats carry no health).
    if (!this.authority) V.boss = this._wardHp >= 0 ? { hp: this._wardHp / 100, warden: true, k: this.econ.bossKind } : this._bossHp >= 0 ? { hp: this._bossHp / 100 } : null;
    Object.assign(V, this.econ.view());
    return V;
  }

  // [round, state, timer ds, left, open, box [spot, state, gun, owner, timer ds], double ds, crew [pts, perk bits |
  // down | revive], zombies (packed), drops [id, kind, x, z]..., boss hp %, count, best, power].
  encode() {
    const sim = this.sim, b = this.box;
    const crew = this.crew.map(p => {
      const z = p.zm;
      if (!z) return [0, 0];
      let bits = 0;
      ZM_PERK_IDS.forEach((k, i) => { if (z.perks.includes(k)) bits |= 1 << i; });
      if (p.downed) bits |= 64;
      bits |= Math.min(15, Math.round((p.downed ? z.reviveT / ZM.reviveTime : 0) * 15)) << 7;
      if (z.limit > ZM.perkLimit) bits |= 1 << 11;
      // Gun tiers (the guns in hand only: a host migration keeps them), as [weapon index, tier] pairs.
      const tiers = [];
      for (const g of [p.ps.primary, p.ps.secondary]) if (z.tiers[g]) tiers.push(WEAPON_IDS.indexOf(g), z.tiers[g]);
      return [z.pts, bits, z.kills, z.revives, Math.round(z.plates), z.breathAt ?? 0, tiers, z.earned ?? 0, z.spent ?? 0, z.stk ? ZE.supplyOrder.indexOf(z.stk) + 1 : 0];
    });
    const zs = [];
    for (const p of this.horde) if (p.alive) zs.push(packZombie(p.index - this.horde[0].index, p.ps.x, p.ps.z, p.ps.aim, p.zk === ZK.shield && !(p.zShield > 0) ? 9 : p.zk, p.zSwing > 0 || p.zSpitT > 0));
    const boss = this.bossSeat >= 0 ? sim.players[this.bossSeat] : null;
    return [this.round, this.state, Math.round(this.timer * 10), Math.max(0, this.count - this.killed), this.open,
      [b.spot, b.state, b.gun, b.owner, Math.round(b.timer * 10)], Math.round(this.doubleT * 10), crew, zs,
      this.drops.flatMap(d => [d.id, ZM_POWERUPS.indexOf(d.kind), r1(d.x), r1(d.z)]),
      boss?.alive && boss.zk === 3 ? Math.round(boss.hp / Math.max(1, boss.zMax) * 100) : -1, this.count, this.best, this.power, this.econ.encode(),
      (() => { const w = this.econ.wardenSeat >= 0 ? sim.players[this.econ.wardenSeat] : null; return w?.alive && isQuestBoss(w.zk) ? Math.round(w.hp / Math.max(1, w.zMax) * 100) : -1; })(),
      this.special ? ZM_ROUNDS.indexOf(this.special) : -1];
  }

  // Zombie seats never go out as player records to a guest: the block above carries them.
  seatCode(p, code) { return this.isZ(p) ? 0 : code; }

  decode(a, out) {
    const sim = this.sim;
    if (this.authority) {
      for (let i = 0; i < out.players.length && i < sim.players.length; i++) {
        const p = sim.players[i], v = out.players[i];
        this.playerView(p, v);
        if (this.isZ(p)) { v.weapon = NO_GUN; v.alive = p.alive; v.x = p.ps.x; v.z = p.ps.z; v.aim = p.ps.aim; v.vx = p.ps.vx; v.vz = p.ps.vz; v.hp = Math.ceil(p.hp); }
      }
      return this.view();
    }
    if (a) {
      const [round, state, timer, left, open, box, dbl, crew, zs, drops, boss, count, best, power, econ, ward, special] = a;
      this.power = power ?? 1;
      this.special = ZM_ROUNDS[special] ?? null;
      this.econ.decode(econ);
      this._wardHp = ward ?? -1;
      this.round = round; this.state = state; this.timer = timer / 10; this.count = count ?? 0; this.killed = Math.max(0, this.count - left);
      this.best = best ?? 0;
      if (open !== this.open) { this.open = open; syncZmDoors(sim.map, open); }
      if (box) Object.assign(this.box, { spot: box[0], state: box[1], gun: box[2], owner: box[3], timer: box[4] / 10 });
      this.doubleT = dbl / 10;
      this._crewWire = crew || [];
      this._zs = zs || [];
      this._bossHp = boss;
      this.drops = [];
      const d = drops || [];
      for (let i = 0; i + 3 < d.length; i += 4) this.drops.push({ id: d[i], kind: ZM_POWERUPS[d[i + 1]] ?? 'ammo', x: d[i + 2] / 10, z: d[i + 3] / 10, t: 0 });
      this._decodeT = out.t;
    }
    // Team 0 from the crew block.
    const crewList = this.crew;
    crewList.forEach((p, k) => {
      const c = this._crewWire?.[k], v = out.players[p.index];
      if (!c || !v) return;
      p.zm ??= ZmRules.crewState();
      p.zm.pts = c[0]; p.zm.perks = ZM_PERK_IDS.filter((_, i) => c[1] & (1 << i)); p.zm.kills = c[2] ?? 0; p.zm.revives = c[3] ?? 0;
      p.zm.plates = c[4] ?? 0; p.zm.breathAt = c[5] ?? 0; p.zm.limit = c[1] & (1 << 11) ? ZM.perkMax : ZM.perkLimit;
      p.zm.earned = c[7] ?? 0; p.zm.spent = c[8] ?? 0; p.zm.stk = ZE.supplyOrder[(c[9] ?? 0) - 1] ?? null;
      p.zm.tiers = {};
      const T = c[6] ?? [];
      for (let i = 0; i + 1 < T.length; i += 2) if (WEAPON_IDS[T[i]]) p.zm.tiers[WEAPON_IDS[T[i]]] = T[i + 1];
      v.zpts = c[0]; v.zperks = p.zm.perks; v.zplates = p.zm.plates; v.zstk = p.zm.stk; v.zlimit = p.zm.limit;
      v.zbreath = p.zm.perks.includes('breath') ? (p.zm.breathAt <= this.round ? 1 : 0) : -1;
      v.downed = !!(c[1] & 64); v.reviveK = ((c[1] >> 7) & 15) / 15;
      v.ai = false;
    });
    // The horde: every seat dead unless the block has it.
    const h0 = this.horde[0]?.index ?? 0, now = out.t ?? 0;
    for (const p of this.horde) { const v = out.players[p.index]; if (v) { v.alive = false; v.zk = 0; v.ai = true; } }
    for (const n of this._zs) {
      const z = unpackZombie(n), v = out.players[h0 + z.seat];
      if (!v) continue;
      const prev = this._prev.get(z.seat);
      let vx = 0, vz = 0;
      if (prev && now > prev.t && now - prev.t < 0.5 && Math.hypot(z.x - prev.x, z.z - prev.z) < 3) {
        vx = (z.x - prev.x) / (now - prev.t); vz = (z.z - prev.z) / (now - prev.t);
        vx = prev.vx + (vx - prev.vx) * 0.5; vz = prev.vz + (vz - prev.vz) * 0.5;
      }
      if (!prev || now !== prev.t) this._prev.set(z.seat, { x: z.x, z: z.z, t: now, vx, vz });
      const kind = z.kind === 9 ? ZK.shield : z.kind;
      Object.assign(v, { alive: true, x: z.x, z: z.z, aim: z.aim, vx, vz, zk: kind + 1, zshield: kind === ZK.shield && z.kind !== 9, zswing: z.swing, weapon: NO_GUN, hp: 100, spawnProtect: false, sprinting: false, sliding: false, reloadT: 0, adsT: 0 });
      const sp = sim.players[h0 + z.seat];
      if (sp) { sp.zk = kind; sp.zLow = kind === ZK.crawler; sp.zShield = v.zshield ? 1 : 0; }
    }
    return this.view();
  }

  // ---- Host migration ----

  restore(view) {
    const sim = this.sim, obj = view.obj ?? view.points?.obj, old = obj?.rules ?? null;
    this.authority = true;
    if (old && old !== this) {
      this.round = old.round; this.state = old.state; this.timer = old.timer; this.count = old.count || roundCount(Math.max(1, old.round), this.humans);
      this.killed = old.killed; this.open = old.open; this.best = old.best;
      Object.assign(this.box, old.box, { moveAt: this._moveAt(), uses: 0 });
      this.drops = old.drops.map(d => ({ ...d, t: sim.time }));
      this.doubleT = old.doubleT;
      this.power = old.power ?? 1;
      this.special = old.special ?? null;
      this.econ.restore(old.econ);
      this._bossHp = old._bossHp; this._wardHp = old._wardHp;
    }
    syncZmDoors(sim.map, this.open);
    this.hp = roundHp(Math.max(1, this.round));
    let live = 0;
    sim.players.forEach((p, i) => {
      const v = view.players[i];
      if (this.isZ(p)) {
        p.noRegen = true;
        p.zk = Math.max(0, (v?.zk ?? 1) - 1);
        if (p.alive) {
          live++;
          const K = ZM.kinds[ZM_KINDS[p.zk]];
          p.hp = p.zMax = zmMaxHp(p.zk, this.hp, this.crew.length, this.humans);
          p.zSwing = 0; p.zCool = 0.5; p.zStuck = 0; p.zStuckT = 0; p.zLastX = p.ps.x; p.zLastZ = p.ps.z;
          p.zPace = zmPace(p.zk, this.round);
          p.zExtra = false; p.zSlowT = 0; p.zBurnT = 0;
          const hadShield = !!v?.zshield;
          p.zWindup = K.windup;
          this.kinds.raise(p);
          if (p.zk === ZK.shield && !hadShield) p.zShield = 0;
          // The bosses keep what the bar showed.
          if (p.zk === 3) { this.bossSeat = p.index; if (this._bossHp > 0) p.hp = Math.max(1, Math.round(p.zMax * this._bossHp / 100)); }
          if (isQuestBoss(p.zk)) { this.econ.wardenSeat = p.index; p.zExtra = true; live--; if (this._wardHp > 0) p.hp = Math.max(1, Math.round(p.zMax * this._wardHp / 100)); }
        }
        return;
      }
      // A real migration builds a new Sim (js/game/match.js promoteToHost): its players start with a blank crew state,
      // so points, perks, plates and tiers come from the guest's mirror (the old rules), by player id.
      const prev = old && old !== this ? old.crew?.find(q => q.id === p.id)?.zm : null;
      if (prev) p.zm = { ...prev, perks: [...(prev.perks ?? [])], tiers: { ...(prev.tiers ?? {}) }, spentBy: { ...(prev.spentBy ?? {}) } };
      p.zm ??= ZmRules.crewState();
      Object.assign(p.zm, { ...ZmRules.crewState(), ...p.zm, downedBy: null });
      p.downed = !!v?.downed && p.alive;
      p.zm.reviveT = p.downed ? (v.reviveK ?? 0) * ZM.reviveTime : 0;
      if (p.downed) p.hp = Math.max(1, v.hp ?? 50);
    });
    this.spawned = Math.min(this.count, this.killed + live);
    this.kinds.startRound();
    if (sim.nav) for (const d of this.L.doors) if (this.open & (1 << d.i)) reblockNav(sim.nav, sim.map, d);
    this.fields.clear();
  }
}

export { STATES as ZM_STATES };
// For the HUD and tests: the gun on a wire index.
export const zmGun = i => WEAPON_IDS[i] ?? null;
export { MAX_HP };
