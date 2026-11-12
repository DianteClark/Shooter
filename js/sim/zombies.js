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
// on a map with a switch: layout.power).
import { MAX_HP, WEAPON_IDS } from '../shared/constants.js';
import { normalizeLoadout } from '../shared/catalog.js';
import { WEAPONS } from '../shared/weapons.js';
import { hasLineOfSight } from '../shared/geometry.js';
import {
  ZM, ZM_TEAM, ZM_KINDS, ZM_PERK_IDS, ZM_PERKS, ZM_POWERUPS, BOX_GUNS, START_GUN, NO_GUN,
  roundCount, roundHp, roundMix, spawnGap, paceBonus, isBossRound, zmLayout, placeZmWalls, syncZmDoors, reblockNav, zmUsable, bandOpen, zmDoorStand,
} from '../shared/zombies.js';
import { stepPlayer } from './player.js';
import { brArm, downedInput } from './br.js';

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

// One zombie on the wire: seat, x and z in decimetres, aim in 64ths of a turn, kind, and two flags (winding up, a
// boss): one number, about a dozen characters. Positions up to 204.7 m.
export function packZombie(seat, x, z, aim, kind, swing) {
  const xi = Math.max(0, Math.min(2047, Math.round(x * 10))), zi = Math.max(0, Math.min(2047, Math.round(z * 10)));
  const a = ((Math.round(aim / (Math.PI * 2) * 64) % 64) + 64) % 64;
  return ((((seat * 2048 + xi) * 2048 + zi) * 64 + a) * 8 + kind) * 2 + (swing ? 1 : 0);
}
export function unpackZombie(n) {
  const swing = n % 2; n = Math.floor(n / 2);
  const kind = n % 8; n = Math.floor(n / 8);
  const a = n % 64; n = Math.floor(n / 64);
  const zi = n % 2048; n = Math.floor(n / 2048);
  const xi = n % 2048; n = Math.floor(n / 2048);
  return { seat: n, x: xi / 10, z: zi / 10, aim: a / 64 * Math.PI * 2, kind, swing: !!swing };
}

export class ZmRules {
  constructor(sim, seed) {
    this.sim = sim;
    this.seed = seed;
    this.ownSpawns = true;
    this.ownClock = true;
    this.allIn = true;
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
  }

  // ---- Seats ----

  isZ(p) { return p.ai && p.team === ZM_TEAM; }
  get crew() { return this._crew ??= this.sim.players.filter(p => p.team !== ZM_TEAM); }
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
      p.zm = { pts: ZM.startPts, perks: [], kills: 0, downs: 0, revives: 0, reviveT: 0, downedBy: null, spent: 0, bought: 0, head: 0 };
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
    if (p.zm) { p.zm.reviveT = 0; p.zm.downedBy = null; p.zm.perks = []; }
    if (p.bot) p.bot.kite = 4.5;
  }

  // ---- One tick ----

  step(dt) {
    const sim = this.sim;
    this.authority = true;
    if (sim.phase !== 'live') return;
    if (this.state === 3) return;
    if (this.doubleT > 0) this.doubleT = Math.max(0, this.doubleT - dt);
    if (this.state === 0 || this.state === 2) {
      this.timer -= dt;
      sim.timeLeft = Math.max(0, this.timer);
      if (this.timer <= 0) this._startRound(this.round + 1);
    } else {
      sim.timeLeft = 0;
      this._stepSpawns(dt);
      if (this.killed >= this.count) this._endRound();
    }
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
    this.count = roundCount(r);
    this.spawned = 0; this.killed = 0;
    this.spawnT = 1.2;
    this.dropsThisRound = 0;
    this.hp = roundHp(r);
    this.bossDue = isBossRound(r);
    sim.scores[0] = r;
    // Everyone who bled out is back, with the pistol, at a teammate's side.
    for (const p of this.crew) {
      if (p.away) continue;
      if (!p.alive) sim._placeAt(p, this._spotNear(p), 0);
      if (p.isBot && p.alive) this._topUp(p);
    }
    sim._emit({ t: 'zround', round: r, boss: this.bossDue ? 1 : 0 });
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
    const up = this.crew.some(p => p.alive && !p.downed && !p.away);
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
      kind = u < mix.brute && brutes < 3 ? 2 : u < mix.brute + mix.runner ? 1 : 0;
    }
    this._raise(seat, kind, spot);
    this.spawned++;
  }

  _raise(p, kind, spot) {
    const sim = this.sim, K = ZM.kinds[ZM_KINDS[kind]];
    p.zk = kind;
    sim._placeAt(p, spot, Math.atan2(sim.map.height / 2 - spot.z, sim.map.width / 2 - spot.x));
    p.hp = p.zMax = Math.round(this.hp * K.hp * (kind === 3 ? 1 + 0.1 * this.crew.length : 1));
    p.zSwing = 0; p.zCool = 0.4 + this.rng() * 0.4; p.zT = null; p.zStuck = 0; p.zLastX = spot.x; p.zLastZ = spot.z; p.zStuckT = 0;
    p.zPace = Math.min(1, K.speed + (kind === 0 ? paceBonus(this.round) : 0)) * (0.92 + this.rng() * 0.16);
    p.ps.tacticalLeft = 0; p.ps.lethalLeft = 0;
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
    let best = null, bestS = -Infinity;
    for (let k = 0; k < 14; k++) {
      const s = cands[Math.floor(this.rng() * cands.length)];
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
        const hit = this._clawTarget(p, K.reach + 0.45);
        if (hit) sim._damage(hit, p, K.dmg, NO_GUN, Math.hypot(hit.ps.x - ps.x, hit.ps.z - ps.z));
      }
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
    const pace = p.zSwing > 0 ? 0.15 : p.zPace;
    if (ml > 1e-4) { I.mx = mx / ml * pace; I.mz = mz / ml * pace; }
    I.aim = d < 3 ? Math.atan2(dz, dx) : ml > 1e-4 ? Math.atan2(mz, mx) : ps.aim;
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
    if (this.bossSeat === p.index) { this.bossDue = true; this.bossSeat = -1; }
    this.spawned = Math.max(this.killed, this.spawned - 1);
  }

  // ---- Damage and deaths ----

  damage(target, attacker, dmg) {
    if (this.isZ(target)) {
      if (!attacker?.zm) return dmg;
      if (attacker.zm.perks.includes('hammer')) dmg *= 1.5;
      this._pay(attacker, ZM.pts.hit);
      return dmg;
    }
    if (target.downed) return 0;
    if (this.isZ(attacker) && target.zm?.perks.includes('iron')) dmg *= 0.5;
    return dmg;
  }

  medal() { return false; }             // Medals are a soldier's game: a horde would spam them.

  tryDown(p, attacker, weapon) {
    if (this.isZ(p) || p.downed || !p.zm) return false;
    if (!this.crew.some(q => q !== p && q.alive && !q.downed && !q.away)) return false;
    p.downed = true;
    p.hp = 100;
    p.zm.reviveT = 0; p.zm.downs++;
    p.zm.downedBy = attacker && attacker !== p ? attacker.id : null;
    p.ps.sprinting = false; p.ps.sliding = false;
    this._losePerks(p);
    this.sim._emit({ t: 'down', by: attacker?.id ?? p.id, target: p.id, weapon, x: Math.round(p.ps.x * 100) / 100, z: Math.round(p.ps.z * 100) / 100 });
    return true;
  }

  _losePerks(p) {
    if (!p.zm.perks.length) return;
    p.zm.perks = [];
    p.ps.perks = p.ps.perks.filter(k => k !== 'fasthands');
    if (!p.isBot) this.sim._emit({ t: 'zperk', id: p.id, lost: 1 });
  }

  _stepDowned(p, dt) {
    const sim = this.sim, b = p.zm;
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
      this.killed++;
      const boss = target.zk === 3;
      if (boss) this.bossSeat = -1;
      if (killer?.zm) {
        killer.zm.kills++;
        if (info.head) killer.zm.head++;
        const melee = !info.equip && !info.streak && WEAPONS[info.weapon]?.melee;
        this._pay(killer, boss ? ZM.pts.boss : melee ? ZM.pts.melee : info.head ? ZM.pts.head : ZM.pts.kill);
      }
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
    p.zm.pts += n * (double && this.doubleT > 0 ? 2 : 1);
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
      for (const q of this.crew) if (q.alive) this._refill(q, -1);
    } else if (kind === 'double') {
      this.doubleT = ZM.drop.double;
    } else if (kind === 'nuke') {
      for (const z of this.horde) if (z.alive && z.zk !== 3) sim._selfKill(z, 'nuke');
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
    if (!p || !p.zm || msg?.act !== 'use' || !p.alive || p.downed || this.state === 3) return false;
    return this._use(p, this._usableFor(p));
  }

  _usableFor(p) {
    return zmUsable(this.L, p.ps.x, p.ps.z, this._stateFor(p));
  }
  _stateFor(p) {
    return { open: this.open, box: { spot: this.box.spot, state: this.box.state, gun: this.box.gun, owner: this.box.owner }, pts: p.zm.pts, perks: p.zm.perks, guns: [p.ps.primary, p.ps.secondary], me: p.index, power: this.power };
  }

  _use(p, u) {
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
        p.zm.perks.push(u.perk);
        if (u.perk === 'quick' && !p.ps.perks.includes('fasthands')) p.ps.perks = [...p.ps.perks, 'fasthands'];
        if (!p.isBot) sim._emit({ t: 'zperk', id: p.id, perk: u.perk });
        break;
      }
      default: return false;
    }
    p.zm.pts -= u.cost; p.zm.spent += u.cost; p.zm.bought++;
    sim._emit({ t: 'zbuy', id: p.id, kind: u.kind, cost: u.cost, gun: u.gun ?? null, perk: u.perk ?? null });
    return true;
  }

  _rollGun(p) {
    const own = [p.ps.primary, p.ps.secondary];
    for (let k = 0; k < 8; k++) {
      const i = Math.floor(this.rng() * BOX_GUNS.length);
      if (!own.includes(BOX_GUNS[i]) && WEAPONS[BOX_GUNS[i]]) return i;
    }
    return BOX_GUNS.findIndex(g => !own.includes(g));
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
    brArm(ps, slot, gun);
    ps.slot = slot; ps.weapon = gun;
    if (WEAPONS[gun].unlimitedReserve) ps.reserve[slot] = 999; else ps.reserve[slot] = WEAPONS[gun].reserve ?? WEAPONS[gun].magazine * 3;
    if (p.isBot) p.primary = ps.primary;
    else sim._emit({ t: 'zarm', id: p.id, slot, w: WEAPON_IDS.indexOf(gun) });
  }

  // ---- Bot teammates ----

  // Revive first, then spend (a better gun, a perk, and when rich and on their own, a gate), else stay with the lead.
  plan(team, crew) {
    if (team === ZM_TEAM) { for (const b of crew) b.setObjective(null); return; }
    this._crewPlan = crew;
  }

  _planCrew() {
    const sim = this.sim, crew = this._crewPlan;
    if (!crew || this.state === 3) return;
    const lead = this.crew.find(p => !p.isBot && p.alive && !p.downed && !p.away) ?? this.crew.find(p => p.alive && !p.downed);
    const humans = this.crew.some(p => !p.isBot && !p.away);
    crew.forEach((bot, k) => {
      const p = bot.p;
      if (!p.alive || p.downed || !p.zm) return;
      bot.kite = 4.5;
      // A downed mate within reach of the path.
      const down = this.crew.filter(q => q.alive && q.downed).sort((a, b) => Math.hypot(a.ps.x - p.ps.x, a.ps.z - p.ps.z) - Math.hypot(b.ps.x - p.ps.x, b.ps.z - p.ps.z))[0];
      if (down && Math.hypot(down.ps.x - p.ps.x, down.ps.z - p.ps.z) < 45 && !this._near(p, 2.2)) {
        bot.setObjective({ key: `zrev${down.index}`, role: 'collect', x: down.ps.x, z: down.ps.z, r: 0.8 });
        return;
      }
      // Its roll at the crate: wait for it, take it.
      const bx = this.box;
      if ((bx.state === 1 || bx.state === 2) && bx.owner === p.index && !bx.moving) {
        const bs = this.L.boxSpots[bx.spot];
        if (bx.state === 2 && Math.hypot(bs.x - p.ps.x, bs.z - p.ps.z) < ZM.useReach * 0.9) { this._use(p, zmUsable(this.L, p.ps.x, p.ps.z, this._stateFor(p))); bot.setObjective(null); return; }
        bot.setObjective({ key: `zbox${bx.spot}`, role: 'collect', x: bs.x, z: bs.z, r: 0.8 });
        return;
      }
      // The power, on a map with a switch: solo with bots, one bot goes and throws it after round 2 if nobody has.
      const run = this._powerRun(p, crew);
      if (run) {
        if (Math.hypot(run.x - p.ps.x, run.z - p.ps.z) < ZM.useReach * 0.8) { this._use(p, run.use); bot.setObjective(null); return; }
        bot.setObjective({ key: `zpow${run.use.kind}${run.use.i}`, role: 'collect', x: run.x, z: run.z, r: 0.8 });
        return;
      }
      // Something to buy near.
      const want = this._botWant(p, humans);
      if (want) {
        const d = Math.hypot(want.x - p.ps.x, want.z - p.ps.z);
        if (d < ZM.useReach * 0.8) { this._use(p, zmUsable(this.L, p.ps.x, p.ps.z, this._stateFor(p))); bot.setObjective(null); return; }
        bot.setObjective({ key: `zbuy${want.kind}${want.i}`, role: 'collect', x: want.x, z: want.z, r: 0.8 });
        return;
      }
      // With the lead: a loose ring round them, never far.
      if (lead && lead !== p) {
        const a = (k + 1) * 2.1 + (lead.index % 3), x = lead.ps.x + Math.cos(a) * 3, z = lead.ps.z + Math.sin(a) * 3;
        const at = this._walk(x, z);
        const far = Math.hypot(lead.ps.x - p.ps.x, lead.ps.z - p.ps.z);
        if (far > 6 || !bot.objective) bot.setObjective({ key: `zf${Math.round(at.x / 3)}:${Math.round(at.z / 3)}`, role: 'defend', x: at.x, z: at.z, r: 2.5 });
      } else bot.setObjective({ key: 'zhold', role: 'defend', x: this.L.bands[this.L.start].cx, z: this.L.bands[this.L.start].cz, r: 5 });
    });
  }

  // What a bot would walk over to buy now: a better wall gun than the pistol, a perk it can afford with a cushion, and
  // (only with no humans, or when rich) the cheapest closed gate. Never in the middle of a fight it is losing.
  _botWant(p, humans) {
    const L = this.L, z = p.zm, ps = p.ps;
    if (this.state === 1 && this._near(p, 6)) return null;
    let best = null, bestS = -Infinity;
    const consider = (item, score) => { if (score > bestS) { bestS = score; best = item; } };
    const dist = (x, zz) => Math.hypot(x - ps.x, zz - ps.z);
    const hasGun = ps.primary !== START_GUN || (ps.secondary !== NO_GUN && ps.secondary !== START_GUN);
    // What the gun in the hands is worth, by its wall price (a crate gun counts as a good one).
    const worth = g => (g === START_GUN || g === NO_GUN ? 0 : L.wallBuys.find(w => w.gun === g)?.cost ?? 1600);
    const held = Math.max(worth(ps.primary), worth(ps.secondary));
    for (const w of L.wallBuys) {
      if (!bandOpen(L, this.open, w.band)) continue;
      const own = ps.primary === w.gun || ps.secondary === w.gun;
      const d = dist(w.x, w.z);
      if (d > 40) continue;
      if (own) {
        const slot = ps.primary === w.gun ? 0 : 1;
        if (ps.reserve[slot] < (WEAPONS[w.gun].magazine ?? 30) && z.pts >= w.ammo + 200) consider({ kind: 'ammo', i: w.i, x: w.x, z: w.z }, 50 - d);
      } else if (!hasGun && z.pts >= w.cost) consider({ kind: 'wall', i: w.i, x: w.x, z: w.z }, 40 + w.cost / 100 - d);
      else if (hasGun && z.pts >= w.cost + 400 && w.cost > held + 150) consider({ kind: 'wall', i: w.i, x: w.x, z: w.z }, 35 + (w.cost - held) / 50 - d);
    }
    for (const m of L.machines) {
      if (!bandOpen(L, this.open, m.band) || z.perks.includes(m.perk) || !this.power) continue;
      const cost = ZM_PERKS[m.perk].cost, d = dist(m.x, m.z);
      if (z.pts >= cost + (hasGun ? 300 : 1200) && d < 45) consider({ kind: 'perk', i: m.i, x: m.x, z: m.z }, 30 - d + (m.perk === 'iron' ? 10 : 0));
    }
    // The crate now and then, once the basics are bought.
    const bs = this.box.state === 0 && this.box.spot >= 0 ? L.boxSpots[this.box.spot] : null;
    if (bs && bandOpen(L, this.open, bs.band) && hasGun && z.perks.length >= 2 && z.pts >= ZM.box.cost + 1500 && held < 1700) {
      const d = dist(bs.x, bs.z);
      if (d < 40) consider({ kind: 'box', i: bs.i, x: bs.x, z: bs.z }, 15 - d);
    }
    if (!humans || z.pts > 4000) {
      for (const d of L.doors) {
        if (this.open & (1 << d.i) || z.pts < d.cost + (humans ? 2000 : 600)) continue;
        const at = zmDoorStand(L, this.open, d);
        if (!at) continue;
        const dd = dist(d.cx, d.cz);
        if (dd < 50) consider({ kind: 'door', i: d.i, x: at.x, z: at.z }, 5 - dd);
      }
    }
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
    // Gates from the power area outward: how many each area is from it.
    if (!this._pDist) {
      const dist = L.bands.map(() => Infinity);
      dist[L.power.band] = 0;
      for (let grew = true; grew;) {
        grew = false;
        for (const d of L.doors) for (const [u, v] of [[d.a ?? d.from, d.b ?? d.opens], [d.b ?? d.opens, d.a ?? d.from]]) if (dist[u] + 1 < dist[v]) { dist[v] = dist[u] + 1; grew = true; }
      }
      this._pDist = dist;
    }
    let best = null, bd = Infinity;
    for (const d of L.doors) {
      if (this.open & (1 << d.i) || p.zm.pts < d.cost) continue;
      const at = zmDoorStand(L, this.open, d);
      if (!at) continue;
      const far = bandOpen(L, this.open, d.a ?? d.from) ? (d.b ?? d.opens) : (d.a ?? d.from);
      const sc = this._pDist[far] * 100 + Math.hypot(at.x - p.ps.x, at.z - p.ps.z);
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
    if (this.isZ(p)) { v.zk = p.alive ? p.zk + 1 : 0; v.zswing = p.zSwing > 0; return; }
    if (!p.zm) return;
    v.downed = !!p.downed;
    v.reviveK = p.downed ? p.zm.reviveT / ZM.reviveTime : 0;
    v.zpts = p.zm.pts;
    v.zperks = p.zm.perks;
  }

  view() {
    const V = this.V, b = this.box;
    V.round = this.round; V.state = STATES[this.state]; V.timer = this.timer; V.left = Math.max(0, this.count - this.killed);
    V.count = this.count; V.open = this.open; V.doubleT = this.doubleT; V.best = this.best; V.power = this.power;
    V.box = { spot: b.spot, state: b.state, gun: b.gun >= 0 ? BOX_GUNS[b.gun] : null, owner: b.owner, timer: b.timer };
    V.drops = this.drops;
    V.layout = this.L;
    V.crew = this.crew.map(p => ({ index: p.index, id: p.id, pts: p.zm?.pts ?? 0, perks: p.zm?.perks ?? [], kills: p.zm?.kills ?? 0, downs: p.zm?.downs ?? 0, revives: p.zm?.revives ?? 0, head: p.zm?.head ?? 0 }));
    const boss = this.bossSeat >= 0 ? this.sim.players[this.bossSeat] : null;
    V.boss = boss?.alive && boss.zk === 3 ? { hp: boss.hp / Math.max(1, boss.zMax) } : null;
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
      if (p.downed) bits |= 16;
      bits |= Math.min(15, Math.round((p.downed ? z.reviveT / ZM.reviveTime : 0) * 15)) << 5;
      return [z.pts, bits, z.kills, z.revives];
    });
    const zs = [];
    for (const p of this.horde) if (p.alive) zs.push(packZombie(p.index - this.horde[0].index, p.ps.x, p.ps.z, p.ps.aim, p.zk, p.zSwing > 0));
    const boss = this.bossSeat >= 0 ? sim.players[this.bossSeat] : null;
    return [this.round, this.state, Math.round(this.timer * 10), Math.max(0, this.count - this.killed), this.open,
      [b.spot, b.state, b.gun, b.owner, Math.round(b.timer * 10)], Math.round(this.doubleT * 10), crew, zs,
      this.drops.flatMap(d => [d.id, ZM_POWERUPS.indexOf(d.kind), r1(d.x), r1(d.z)]),
      boss?.alive && boss.zk === 3 ? Math.round(boss.hp / Math.max(1, boss.zMax) * 100) : -1, this.count, this.best, this.power];
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
      const [round, state, timer, left, open, box, dbl, crew, zs, drops, boss, count, best, power] = a;
      this.power = power ?? 1;
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
      p.zm ??= { pts: 0, perks: [], kills: 0, revives: 0, downs: 0, reviveT: 0 };
      p.zm.pts = c[0]; p.zm.perks = ZM_PERK_IDS.filter((_, i) => c[1] & (1 << i)); p.zm.kills = c[2] ?? 0; p.zm.revives = c[3] ?? 0;
      v.zpts = c[0]; v.zperks = p.zm.perks;
      v.downed = !!(c[1] & 16); v.reviveK = ((c[1] >> 5) & 15) / 15;
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
      Object.assign(v, { alive: true, x: z.x, z: z.z, aim: z.aim, vx, vz, zk: z.kind + 1, zswing: z.swing, weapon: NO_GUN, hp: 100, spawnProtect: false, sprinting: false, sliding: false, reloadT: 0, adsT: 0 });
      const sp = sim.players[h0 + z.seat];
      if (sp) { sp.zk = z.kind; }
    }
    return this.view();
  }

  // ---- Host migration ----

  restore(view) {
    const sim = this.sim, obj = view.obj ?? view.points?.obj, old = obj?.rules ?? null;
    this.authority = true;
    if (old && old !== this) {
      this.round = old.round; this.state = old.state; this.timer = old.timer; this.count = old.count || roundCount(Math.max(1, old.round));
      this.killed = old.killed; this.open = old.open; this.best = old.best;
      Object.assign(this.box, old.box, { moveAt: this._moveAt(), uses: 0 });
      this.drops = old.drops.map(d => ({ ...d, t: sim.time }));
      this.doubleT = old.doubleT;
      this.power = old.power ?? 1;
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
          p.hp = p.zMax = Math.round(this.hp * K.hp);
          p.zSwing = 0; p.zCool = 0.5; p.zStuck = 0; p.zStuckT = 0; p.zLastX = p.ps.x; p.zLastZ = p.ps.z;
          p.zPace = Math.min(1, K.speed + (p.zk === 0 ? paceBonus(this.round) : 0));
          if (p.zk === 3) this.bossSeat = p.index;
        }
        return;
      }
      p.zm ??= { pts: 0, perks: [], kills: 0, downs: 0, revives: 0, reviveT: 0, downedBy: null, spent: 0, bought: 0, head: 0 };
      Object.assign(p.zm, { spent: p.zm.spent ?? 0, bought: p.zm.bought ?? 0, head: p.zm.head ?? 0, downedBy: null });
      p.downed = !!v?.downed && p.alive;
      p.zm.reviveT = p.downed ? (v.reviveK ?? 0) * ZM.reviveTime : 0;
      if (p.downed) p.hp = Math.max(1, v.hp ?? 50);
    });
    this.spawned = Math.min(this.count, this.killed + live);
    if (sim.nav) for (const d of this.L.doors) if (this.open & (1 << d.i)) reblockNav(sim.nav, sim.map, d);
    this.fields.clear();
  }
}

export { STATES as ZM_STATES };
// For the HUD and tests: the gun on a wire index.
export const zmGun = i => WEAPON_IDS[i] ?? null;
export { MAX_HP };
