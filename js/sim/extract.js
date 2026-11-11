// Extraction (docs/EXTRACT.md), the host rules and the pieces every phone shares. A rules module like the modes
// overhaul's (js/sim/rules.js): the Sim calls in through `this.rules` (step, spawnAll, respawn, holdDead, tryDown,
// driveBot, damage, onKill, onShot, command, playerView, view, encode, decode, restore).
//
// Shape of a match (numbers in EX, js/shared/modes.js):
//   Squads (team FFA_TEAM + squad, 4 x 4 or 8 x 2) start at insertion points round the edge of Frontier with their
//   own loadouts (no scorestreaks). Each has a shared pool of lives: a death costs nothing until a respawn takes one;
//   with the pool empty the dead spectate their squad. Lethal damage downs you while a squadmate is up (battle
//   royale's crawl, bleed and revive).
//   Contracts: every squad starts with one; completing it pays into the squad's pending pot and reveals the next.
//   Contract phones (one per place) offer three others to swap to. Types: intel (carry a case to a drop), hvt (kill a
//   commander and guards), cache (plant a charge, defend the fuse), hack (hold the terminal's area), escort (walk an
//   asset to a point; it only moves with you beside it and nobody hostile near).
//   AI patrols (side EX_AI_TEAM, hostile to every squad): one or two groups per place, tougher toward the centre and at
//   the tier 1 places (HQ sites, which call reinforcements). A group exists only while a squad player is near
//   (EX.wake / EX.sleep), so far patrols cost nothing. Contracts and exfil calls bring waves.
//   Exfil: windows open sites at set times, and a final exfil lands late and stays to the end. A squad member in an
//   open zone calls the helicopter; once it lands, a squad that holds the zone alone for EX.hold s is lifted out with
//   everyone of it in the zone, and the whole squad banks its pot. Other squads (and AI) inside contest it.
//   Ammo for primary weapons only: boxes at the places (back after EX.boxBack s) and drops from the dead.
// The match ends at EX.length, or once no human is left in play (or every squad is done, with no humans).
//
// Events: {t:'down', ...} and {t:'revive', id, by} as in battle royale; {t:'exammo', id, mags} (the phone owns its
// gun); {t:'excontract', team, type, tier, done?, taken?}; {t:'excall', site, team}; {t:'exland', site};
// {t:'exfil', site, team, ids}; {t:'exleave', site}; {t:'exwindow', sites, final?}; {t:'excase', team, id?, drop?};
// {t:'explant', team, x, z, defused?}; {t:'exboom', x, z, team}; {t:'exwave', x, z}; {t:'exwipe', team}.

import { BR, EX, EX_AI_TEAM, CONTRACT_TYPES, CONTRACT_NAMES, MODES } from '../shared/modes.js';
import { FFA_TEAM, MAX_HP } from '../shared/constants.js';
import { normalizeLoadout } from '../shared/catalog.js';
import { WEAPONS } from '../shared/weapons.js';
import { wallsInBox } from '../shared/geometry.js';
import { botAttachments, skillOf } from './bots.js';
import { stepPlayer } from './player.js';
import { downedInput } from './br.js';

const AI_TEAM = EX_AI_TEAM;
const T = CONTRACT_TYPES;
const PLAN_EVERY = 15;            // Ticks between squad plans (0.5 s).
const GROUP_EVERY = 15;           // Ticks between AI group plans.
const SLOW_EVERY = 60;            // Ticks between full state blocks on the wire (2 s), and at once on a change.
const BACKUP_EVERY = 180;         // Ticks between host-migration backups (6 s).
const CHANGE_REPEAT = 0.25;       // A change rides the next few snapshots, then the 0.5 s refresh carries it.
const NOISE_KEEP = 6;
const ALERT_KEEP = 22;            // Seconds an AI group stays alert after its last sight or sound of trouble.
const WAVE_GAP = 120;             // An HQ calls reinforcements at most this often.
const GROUP_BACK = 240;           // A wiped post or patrol is back this long after (if nobody is near).
const SLOT_REST = 3;              // Seconds a dead AI seat rests before a group may take it again.
const COMMANDERS = 4;             // The first AI seats are the commanders' (their roster name).
const TOUGH = { 1: 0.78, 2: 0.45, 3: 0.2 };
const GUNS = [['smg', 'ar', 'tacsmg', 'shotgun', 'carbine'], ['ar', 'heavyar', 'lmg', 'dmr', 'heavysmg', 'burst'], ['battle', 'lmg', 'heavyar', 'saw', 'dmr', 'ar']];
const r1 = v => Math.round(v * 10);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Open ground: no wall that blocks movement within r of (x, z), and not under a roof. Pure geometry, so every phone
// finds the same spots without a nav grid.
const _wb = [];
function openAt(map, x, z, r) {
  if (x < r + 2 || z < r + 2 || x > map.width - r - 2 || z > map.height - r - 2) return false;
  const n = wallsInBox(map, x - r, z - r, x + r, z + r, _wb);
  for (let i = 0; i < n; i++) {
    const w = map.walls[_wb[i]];
    if (!w.blocksMove) continue;
    if (w.x < x + r && w.x + w.w > x - r && w.z < z + r && w.z + w.d > z - r) return false;
  }
  for (const f of map.roofs ?? []) if (x > f.x - 1 && x < f.x + f.w + 1 && z > f.z - 1 && z < f.z + f.d + 1) return false;
  return true;
}
function openNear(map, x, z, r, reach = 30) {
  if (openAt(map, x, z, r)) return { x, z };
  for (let d = 2; d <= reach; d += 2) {
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (openAt(map, px, pz, r)) return { x: Math.round(px * 10) / 10, z: Math.round(pz * 10) / 10 };
    }
  }
  return { x, z };
}

// Exclusive unlocks paid for by contracts banked on extraction (js/shared/progression.js reads the same keys from
// the save's lifetime counts). `key` is the life counter; one extraction adds the contracts of that type it banked.
export const EX_LIFE = { intel: 'ex:intel', hvt: 'ex:hvt', cache: 'ex:cache', hack: 'ex:hack', escort: 'ex:escort', out: 'ex:out', big: 'ex:big', any: 'ex:contracts' };

// A contract's reward line, from its tier.
export function contractReward(tier) {
  return { xp: EX.reward.xp[tier] ?? 0, weaponXp: EX.reward.weaponXp[tier] ?? 0, opSecs: EX.reward.opSecs[tier] ?? 0 };
}
export const packDone = (type, tier) => T.indexOf(type) * 4 + tier;
export const unpackDone = n => ({ type: T[n >> 2] ?? 'intel', tier: n & 3 });

// Ammo for the primary from a box or a drop, on whichever copy owns the gun (the host's for bots, the phone's own).
export function exAmmo(ps, mags) {
  const w = ps.defs?.[0] ?? WEAPONS[ps.primary];
  if (!w || w.unlimitedReserve) return 0;
  const cap = w.reserve ?? w.magazine * 3, before = ps.reserve[0];
  ps.reserve[0] = Math.min(cap, ps.reserve[0] + w.magazine * mags);
  return ps.reserve[0] - before;
}
function wantsAmmo(ps) {
  const w = ps.defs?.[0] ?? WEAPONS[ps.primary];
  return !!w && !w.unlimitedReserve && ps.reserve[0] < (w.reserve ?? w.magazine * 3);
}

export class ExtractRules {
  constructor(sim, seed) {
    this.sim = sim;
    this.seed = seed;
    this.metaEvery = 45;                // Loadout and camo blocks every 1.5 s: 64 seats make them long, and they rarely change.
    this.ownSpawns = true;              // spawnAll places everyone (the Sim's free-for-all opening does not).
    this.closed = true;                 // Nobody joins an extraction after the start; held slots wait for their human.
    this.authority = false;
    this.rng = mulberry32((seed ^ 0xe7f11a) >>> 0);
    this.V = { ex: true, rules: this };
    this.ready = false;
  }

  // The rest needs the players, which the Sim makes after its rules (spawnAll calls this first).
  _setup() {
    if (this.ready) return;
    this.ready = true;
    const sim = this.sim, seed = this.seed;
    const map = sim.map;
    this.pois = map.br?.pois ?? [];
    this.squadSize = MODES[sim.modeId]?.squad ?? 4;
    // Squads, in team order.
    const teams = [...new Set(sim.players.filter(p => !p.ai).map(p => p.team))].sort((a, b) => a - b);
    this.squads = new Map();
    teams.forEach((team, k) => this.squads.set(team, {
      team, k, lives: EX.lives[this.squadSize] ?? 8, pot: [], banked: [], extracted: 0, done: false, wiped: false,
      contract: null, taken: 0, nextAt: 0, insert: null,
      // A bot squad's temper: aggro (third parties, contesting exfils) and greed (0: out at the first window with a
      // few contracts, 1: through to the second, 2: the final exfil).
      plan: { kind: 'contract', since: 0, site: -1, aggro: 0.3 + 0.5 * this.rng(), greed: [0, 1, 1, 2, 2, 2][Math.floor(this.rng() * 6)] },
    }));
    this._buildSites(map);
    this.contracts = [];                // Every contract ever dealt (active ones are on their squad).
    this.cid = 0;
    this.groups = [];
    this.gid = 0;
    this.drops = [];                    // Ammo off the dead: {id, x, z, t}.
    this.dropId = 0;
    this.boxDown = new Map();           // Box index -> time it comes back.
    this.noise = [];
    this.t = 0;                         // Live seconds.
    this.window = -1;                   // Index of the exfil window open now (or last), the final as windows.length.
    this.ver = 0; this.verAt = -99;     // Slow block version and when it last changed (host).
    this.saved = null;                  // Guest: the latest backup, for a host migration.
    this.started = false;
  }

  // ---- Static places, the same on every phone ----

  _buildSites(map) {
    const W = map.width, H = map.height, cx = W / 2, cz = H / 2, rng = mulberry32((this.seed ^ 0x51735) >>> 0);
    const loot = map.br?.loot ?? [];
    // Spots inside each place: indoor floor spots for intel, terminals, caches and posts; outdoor ones for phones.
    this.inside = this.pois.map(p => loot.filter(l => l.indoor && Math.hypot(l.x - p.x, l.z - p.z) < p.r));
    this.outside = this.pois.map(p => loot.filter(l => !l.indoor && Math.hypot(l.x - p.x, l.z - p.z) < p.r + 6));
    // A contract phone at each place, on open ground near its middle.
    this.phones = this.pois.map((p, i) => {
      const o = this.outside[i].length ? this.outside[i].reduce((b, l) => (Math.hypot(l.x - p.x, l.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? l : b)) : p;
      const at = openNear(map, o.x, o.z, 1.2, 14);
      return { i, poi: i, x: at.x, z: at.z };
    });
    // Ammo boxes: three at each tier 1 place, two at the rest, on floor spots spread through the place.
    this.boxes = [];
    this.pois.forEach((p, i) => {
      const spots = [...this.inside[i], ...this.outside[i]];
      const n = Math.min(spots.length, p.tier === 1 ? 3 : 2);
      for (let k = 0; k < n; k++) { const s = spots[Math.floor((k + 0.5) / n * spots.length)]; this.boxes.push({ i: this.boxes.length, poi: i, x: s.x, z: s.z }); }
    });
    // Exfil landing zones: open ground between the places, round a ring, spread by angle. The final one is nearer
    // the middle.
    const cands = [];
    for (let z = 24; z < H - 24; z += 6) {
      for (let x = 24; x < W - 24; x += 6) {
        const dc = Math.hypot(x - cx, z - cz);
        if (dc < 60 || dc > 175) continue;
        if (this.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 10)) continue;
        if (!openAt(map, x, z, EX.zoneR + 2)) continue;
        cands.push({ x, z, a: Math.atan2(z - cz, x - cx), dc });
      }
    }
    const sites = [];
    const N = 6;
    for (let k = 0; k < N; k++) {
      const a0 = -Math.PI + k / N * Math.PI * 2, a1 = a0 + Math.PI * 2 / N;
      const pool = cands.filter(c => c.a >= a0 && c.a < a1 && c.dc > 95);
      if (!pool.length) continue;
      const c = pool[Math.floor(rng() * pool.length)];
      sites.push({ x: c.x, z: c.z });
    }
    const mids = cands.filter(c => c.dc < 95);
    const fin = mids.length ? mids[Math.floor(rng() * mids.length)] : (cands[0] ?? { x: cx, z: cz });
    this.exfils = [...sites, fin].map((s, i) => ({ i, x: s.x, z: s.z, r: EX.zoneR, final: i === sites.length, state: 0, timer: 0, hold: 0, holder: -1, caller: -1, contested: false, waved: false }));
    this.finalSite = this.exfils.length - 1;
    // Which sites each window opens: spread round the ring, never the same pair twice in a row.
    const order = sites.map((_, i) => i).sort(() => rng() - 0.5);
    this.windowSites = EX.windows.map((w, k) => order.slice((k * w.n) % order.length, (k * w.n) % order.length + w.n));
    // Squad insertion points round the edge.
    // Each squad's slice of the edge; the spot in it furthest from any place, so nobody lands in a patrol's lap.
    const n = this.squads.size, a0 = rng() * Math.PI * 2;
    for (const s of this.squads.values()) {
      let best = null, bestS = -Infinity;
      for (let j = 0; j < 9; j++) {
        const a = a0 + (s.k + (j - 4) / 10) / n * Math.PI * 2, R = Math.min(W, H) * 0.43;
        const at = openNear(map, cx + Math.cos(a) * R, cz + Math.sin(a) * R, 2.2, 30);
        const sc = Math.min(...this.pois.map(p => Math.hypot(p.x - at.x, p.z - at.z) - p.r)) - Math.abs(j - 4) * 2;
        if (sc > bestS) { bestS = sc; best = at; }
      }
      s.insert = best;
      s.insertAim = Math.atan2(cz - s.insert.z, cx - s.insert.x);
    }
    // AI groups, one or two per place: a post (guards on indoor spots) and/or a patrol round the place.
    this.groupDefs = [];
    this.pois.forEach((p, i) => {
      const tough = Math.min(1, Math.max(TOUGH[p.tier] ?? 0.2, 1 - Math.hypot(p.x - cx, p.z - cz) / 190));
      const route = [];
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * Math.PI * 2 + rng(), o = openNear(map, p.x + Math.cos(a) * p.r * 0.85, p.z + Math.sin(a) * p.r * 0.85, 1, 10);
        route.push(o);
      }
      const posts = this.inside[i].length ? Array.from({ length: 4 }, (_, k) => this.inside[i][Math.floor((k + rng()) / 4 * this.inside[i].length) % this.inside[i].length]) : route.slice(0, 4);
      if (p.tier === 1) {
        this.groupDefs.push({ kind: 'post', poi: i, size: 3, tough, hq: true, spots: posts, route });
        this.groupDefs.push({ kind: 'patrol', poi: i, size: 2, tough, hq: false, spots: posts, route });
      } else if (p.tier === 2) {
        this.groupDefs.push({ kind: i % 2 ? 'patrol' : 'post', poi: i, size: 3, tough, hq: false, spots: posts, route });
      } else this.groupDefs.push({ kind: 'post', poi: i, size: 2, tough, hq: false, spots: posts, route });
    });
  }

  squadOf(p) { return p ? this.squads.get(p.team) ?? null : null; }

  // ---- Start ----

  spawnAll() {
    this._setup();
    const sim = this.sim;
    for (const p of sim.players) {
      p.downed = false;
      if (p.ai) {
        p.alive = false; p.hp = 0; p.exGroup = null; p.exFreeAt = 0; p.exTake = 1; p.exDeal = 1;
        continue;
      }
      p.ex = { reviveT: 0, downedBy: null, knocks: 0, revives: 0, out: false, carry: false, free: false, contracts: 0 };
      const s = this.squadOf(p), k = sim.players.filter(q => q.team === p.team && !q.ai).indexOf(p);
      const a = s.insertAim + Math.PI / 2, off = (k - (this.squadSize - 1) / 2) * 2.2;
      const at = openNear(sim.map, s.insert.x + Math.cos(a) * off, s.insert.z + Math.sin(a) * off, 0.6, 8);
      sim._placeAt(p, at, s.insertAim);
    }
    for (const g of this.groupDefs) this._makeGroup({ ...g, state: 'asleep' });
    return true;
  }

  _makeGroup(def) {
    const g = { id: this.gid++, state: 'asleep', members: [], wp: 0, alertX: 0, alertZ: 0, alertT: -99, respawnAt: 0, waves: 0, waveAt: 0, farT: 0, lastT: 0, wiped: false, ...def };
    g.x = def.x ?? this.pois[def.poi]?.x ?? 0; g.z = def.z ?? this.pois[def.poi]?.z ?? 0;
    this.groups.push(g);
    return g;
  }

  // ---- Lives and respawns ----

  // A dead player stays off the field: AI (the rules place them), anyone lifted out, and a squad with no lives left.
  holdDead(p) {
    if (p.ai) return true;
    if (p.ex?.out) return true;
    const s = this.squadOf(p);
    return !s || (s.lives <= 0 && !p.ex?.free);
  }

  respawn(p) {
    if (p.ai) return true;
    const sim = this.sim, s = this.squadOf(p);
    if (!s || p.ex?.out) return true;
    if (p.ex?.free) p.ex.free = false;               // A human back from a dropped connection: no life spent.
    else if (s.lives > 0) { s.lives--; this._dirty(); } else return true;
    sim._placeAt(p, this._respawnSpot(p, s), 0);
    return true;
  }

  // Near a squadmate who is up and not in a fight, else back at the insertion point.
  _respawnSpot(p, s) {
    const sim = this.sim;
    let best = null, bestS = -Infinity;
    for (const q of sim.players) {
      if (q === p || q.team !== p.team || !q.alive || q.downed || q.ex?.out) continue;
      let enemy = 999;
      for (const e of sim.players) if (e.alive && e.team !== p.team) enemy = Math.min(enemy, Math.hypot(e.ps.x - q.ps.x, e.ps.z - q.ps.z));
      const sc = Math.min(enemy, 60) - (q.ps.firingT > 0 ? 15 : 0) + sim.rng() * 5;
      if (sc > bestS) { bestS = sc; best = q; best.exEnemy = enemy; }
    }
    if (best) {
      // Close by when it is quiet there; in a fight, further back, on the far side from the nearest enemy.
      let ex = 0, ez = 0, ed = Infinity;
      for (const e of sim.players) {
        if (!e.alive || e.team === p.team) continue;
        const d = Math.hypot(e.ps.x - best.ps.x, e.ps.z - best.ps.z);
        if (d < ed) { ed = d; ex = e.ps.x; ez = e.ps.z; }
      }
      const away = ed < 999 ? Math.atan2(best.ps.z - ez, best.ps.x - ex) : sim.rng() * Math.PI * 2;
      const back = ed < 40 ? 30 : 8;
      for (let k = 0; k < 14; k++) {
        const a = away + (sim.rng() - 0.5) * (ed < 40 ? 1.4 : 6.3), d = back + sim.rng() * 8;
        const x = best.ps.x + Math.cos(a) * d, z = best.ps.z + Math.sin(a) * d;
        if (!(sim.nav ? sim.nav.isWalkable(x, z) : openAt(sim.map, x, z, 0.6))) continue;
        let close = false;
        for (const e of sim.players) if (e.alive && e.team !== p.team && Math.hypot(e.ps.x - x, e.ps.z - z) < 25) { close = true; break; }
        if (!close) return { x, z };
      }
    }
    return { x: s.insert.x + (sim.rng() - 0.5) * 4, z: s.insert.z + (sim.rng() - 0.5) * 4 };
  }

  onSpawn(p) {
    if (p.ex) { p.ex.reviveT = 0; p.ex.downedBy = null; p.ex.carry = false; }
    if (p.ai) { p.ps.tacticalLeft = 0; p.ps.lethalLeft = p.exNades ?? 0; }     // Patrols carry a grenade at most.
    p.downed = false;
    if (p.bot) p.bot.calm = !!p.ai && p.exGroup?.state !== 'alert';
  }

  // ---- Downs (battle royale's, for squads) ----

  _up(p) { return p.alive && !p.downed && !p.ex?.out && !p.away; }
  _upInSquad(p, except = null) {
    for (const q of this.sim.players) if (q !== p && q !== except && q.team === p.team && !q.ai && this._up(q)) return true;
    return false;
  }

  tryDown(p, attacker, weapon) {
    if (p.ai || p.downed || !p.ex || !this._upInSquad(p)) return false;
    p.downed = true;
    p.hp = BR.downHp;
    p.ex.reviveT = 0;
    p.ex.downedBy = attacker && attacker !== p ? attacker.id : null;
    p.ex.downWeapon = weapon;
    p.ps.sprinting = false; p.ps.sliding = false;
    if (attacker?.ex && attacker !== p) attacker.ex.knocks++;
    this._dropCase(p);
    this.sim._emit({ t: 'down', by: attacker?.id ?? p.id, target: p.id, weapon, x: Math.round(p.ps.x * 100) / 100, z: Math.round(p.ps.z * 100) / 100 });
    return true;
  }

  _stepDowned(p, dt) {
    const sim = this.sim, b = p.ex;
    p.hp -= BR.downHp / EX.bleed * dt;
    if (p.hp <= 0) { this._die(p, b.downedBy ? sim.byId.get(b.downedBy) : null, b.downWeapon); return; }
    let helper = null;
    for (const q of sim.players) {
      if (q === p || q.team !== p.team || q.ai || !this._up(q)) continue;
      if (Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z) > BR.reviveReach) continue;
      if (q.ps.firingT > 1.2 || Math.hypot(q.ps.vx, q.ps.vz) > 2.6) continue;
      helper = q; break;
    }
    if (helper) {
      b.reviveT += dt;
      if (b.reviveT >= BR.reviveTime) {
        p.downed = false; p.hp = BR.reviveHp; p.regenT = 2; b.reviveT = 0; b.downedBy = null;
        helper.ex.revives++;
        sim._emit({ t: 'revive', id: p.id, by: helper.id });
      }
    } else b.reviveT = Math.max(0, b.reviveT - dt * 1.5);
  }

  _die(p, killer, weapon) {
    const sim = this.sim;
    if (!p.alive) return;
    p.downed = false;
    if (killer && killer !== p && killer.alive !== undefined) sim._kill(p, killer, weapon ?? killer.ps.weapon, Math.hypot(killer.ps.x - p.ps.x, killer.ps.z - p.ps.z), null, false, null);
    else sim._selfKill(p, 'bleed');
  }

  // ---- Damage and deaths ----

  damage(target, attacker, dmg) {
    if (target.ai) {
      dmg *= target.exTake ?? 1;
      const g = target.exGroup;
      if (g && attacker && !attacker.ai) this._alert(g, attacker.ps.x, attacker.ps.z);
    }
    if (attacker?.ai) dmg *= attacker.exDeal ?? 1;
    return dmg;
  }

  onShot(p) {
    const last = this.noise[this.noise.length - 1];
    if (!last || last.team !== p.team || this.sim.time - last.t > 0.5 || Math.hypot(last.x - p.ps.x, last.z - p.ps.z) > 20) {
      this.noise.push({ x: p.ps.x, z: p.ps.z, t: this.sim.time, team: p.team });
    }
  }

  onKill(target, killer, info = {}) {
    const sim = this.sim;
    target.downed = false;
    if (target.ai) {
      const g = target.exGroup;
      target.exFreeAt = this.t + SLOT_REST;
      target.exGroup = null;
      if (!info.away) this._drop(target.ps.x, target.ps.z);
      if (g) {
        g.members = g.members.filter(q => q !== target);
        if (killer && !killer.ai) this._alert(g, killer.ps.x, killer.ps.z);
        g.lost = (g.lost ?? 0) + 1;
        if (target.exCommander) this._hvtDown(g, killer);
        if (!g.members.length) this._groupWiped(g);
      }
      return;
    }
    if (!target.ex) return;
    if (info.away) { target.ex.free = true; target.ex.reviveT = 0; }
    else {
      target.respawnT = EX.respawn;
      this._drop(target.ps.x, target.ps.z);
    }
    this._dropCase(target);
    // Nobody in the squad up: whoever is still down goes too.
    if (!this._upInSquad(target)) {
      for (const q of sim.players) {
        if (q !== target && q.team === target.team && q.alive && q.downed) this._die(q, q.ex.downedBy ? sim.byId.get(q.ex.downedBy) : null, q.ex.downWeapon);
      }
    }
    this._checkSquad(target.team);
  }

  // A squad is done when nobody in it can play on: all lifted out, or dead with the pool empty.
  _checkSquad(team) {
    const s = this.squads.get(team);
    if (!s || s.done) return;
    let inPlay = 0;
    for (const q of this.sim.players) if (q.team === team && !q.ai && !q.ex?.out && (q.alive || s.lives > 0 || q.ex?.free)) inPlay++;
    if (inPlay) return;
    s.done = true;
    if (!s.extracted) { s.wiped = true; this.sim._emit({ t: 'exwipe', team }); }
    this._dirty();
  }

  // ---- One tick ----

  step(dt) {
    const sim = this.sim;
    this.authority = true;
    if (sim.phase !== 'live') return;
    if (!this.started) this._start();
    this.t += dt;
    sim.timeLeft = Math.max(0, EX.length - this.t);
    this._stepWindows();
    for (const e of this.exfils) this._stepExfil(e, dt);
    for (const p of sim.players) {
      if (!p.alive || p.ai || !p.ex) continue;
      if (p.downed) { this._stepDowned(p, dt); continue; }
      if ((sim.tick + p.index) % 3 === 0) this._pickups(p);
    }
    for (const s of this.squads.values()) {
      if (s.contract) this._stepContract(s.contract, dt);
      else if (!s.done && this.t >= s.nextAt) this._assign(s);
    }
    for (const [i, until] of this.boxDown) if (this.t >= until) { this.boxDown.delete(i); this._lootDirty(); }
    if (this.drops.length && this.drops[0].t + EX.dropLife < this.t) { this.drops.shift(); this._lootDirty(); }
    while (this.noise.length && sim.time - this.noise[0].t > NOISE_KEEP) this.noise.shift();
    if (sim.tick % GROUP_EVERY === 0) this._planGroups();
    if (sim.tick % PLAN_EVERY === 7) this._planSquads();
    this._checkEnd();
  }

  _start() {
    this.started = true;
    for (const s of this.squads.values()) this._assign(s);
  }

  _checkEnd() {
    const sim = this.sim;
    if (sim.phase !== 'live') return;
    if (this.t >= EX.length) { this._finish(); return; }
    const humans = sim.players.filter(p => !p.isBot && !p.ai && !p.dummy);
    if (humans.length) {
      // A human is still in it while they can play on, or while squadmates who have not got out yet could still bank
      // the pot for them (spectating).
      const playing = humans.some(p => {
        if (p.away || p.ex?.out) return false;
        const s = this.squadOf(p);
        if (p.alive || (s?.lives ?? 0) > 0) return true;
        return !!s && !s.extracted && !s.done && sim.players.some(q => q.team === p.team && q.alive && !q.ex?.out);
      });
      if (!playing) { this.endT = (this.endT ?? 0) + sim.dt; if (this.endT > 3) this._finish(); } else this.endT = 0;
    } else if ([...this.squads.values()].every(s => s.done)) this._finish();
  }

  _finish() {
    const sim = this.sim;
    for (const s of this.squads.values()) if (!s.done) { s.done = true; }
    // The side shown as the winner: the squad that banked the most (ties to the earliest out), or nobody.
    let best = null;
    for (const s of this.squads.values()) {
      if (!s.extracted) continue;
      if (!best || s.banked.length > best.banked.length || (s.banked.length === best.banked.length && (s.outAt ?? 1e9) < (best.outAt ?? 1e9))) best = s;
    }
    this._dirty();
    sim._end(best ? best.team : null);
  }

  // ---- Exfil ----

  _stepWindows() {
    const sim = this.sim;
    EX.windows.forEach((w, k) => {
      if (this.window < k && this.t >= w.open) {
        this.window = k;
        for (const i of this.windowSites[k]) { const e = this.exfils[i]; if (e.state === 0) { e.state = 1; e.timer = w.close - this.t; } }
        sim._emit({ t: 'exwindow', sites: this.windowSites[k] });
        this._dirty();
      }
      if (this.t >= w.close && this.t < w.close + 1) {
        for (const i of this.windowSites[k]) { const e = this.exfils[i]; if ((e.state === 1 || e.state === 4) && !this._windowOf(i)) { e.state = 0; this._dirty(); } }
      }
    });
    if (this.window < EX.windows.length && this.t >= EX.final.open) {
      this.window = EX.windows.length;
      const e = this.exfils[this.finalSite];
      e.state = 2; e.timer = EX.final.land - this.t; e.caller = -1;
      sim._emit({ t: 'exwindow', sites: [this.finalSite], final: true });
      this._dirty();
    }
  }

  _windowOf(i) {
    for (let k = 0; k < EX.windows.length; k++) if (this.windowSites[k].includes(i) && this.t >= EX.windows[k].open && this.t < EX.windows[k].close) return EX.windows[k];
    return null;
  }

  // A human taps Call exfil in an open zone (bots do the same through _callExfil).
  _callExfil(p) {
    const e = this.exfils.find(x => x.state === 1 && Math.hypot(p.ps.x - x.x, p.ps.z - x.z) <= x.r);
    if (!e || !this._up(p)) return false;
    e.state = 2; e.timer = EX.inbound; e.caller = p.team; e.hold = 0; e.holder = -1; e.waved = false;
    this.sim._emit({ t: 'excall', site: e.i, team: p.team, x: e.x, z: e.z });
    this._dirty();
    return true;
  }

  _stepExfil(e, dt) {
    const sim = this.sim;
    if (e.state === 0 || e.state === 1) { if (e.state === 1) e.timer = Math.max(0, e.timer - dt); return; }
    if (e.state === 4) {
      e.timer -= dt;
      if (e.timer <= 0) { e.state = this._windowOf(e.i) ? 1 : 0; e.timer = this._windowOf(e.i) ? this._windowOf(e.i).close - this.t : 0; this._dirty(); }
      return;
    }
    if (e.state === 2) {
      e.timer -= dt;
      // The call is heard: a wave comes for the zone a few seconds after it.
      if (!e.waved && e.timer < EX.inbound - 6 && !e.final) { e.waved = true; this._wave(e.x, e.z, 2, this._toughAt(e.x, e.z)); }
      if (e.final && !e.waved && e.timer < 20) { e.waved = true; this._wave(e.x, e.z, 3, 0.6); }
      if (e.timer <= 0) {
        e.state = 3; e.timer = e.final ? EX.length - this.t : EX.wait; e.hold = 0; e.holder = -1;
        sim._emit({ t: 'exland', site: e.i, x: e.x, z: e.z });
        this._dirty();
      }
      return;
    }
    // Landed: who holds the zone.
    e.timer -= dt;
    let team = -1, many = false, ai = false;
    for (const q of sim.players) {
      if (!q.alive || q.downed || q.ex?.out || q.away) continue;
      if (Math.hypot(q.ps.x - e.x, q.ps.z - e.z) > e.r) continue;
      if (q.ai) { ai = true; continue; }
      if (team === -1) team = q.team; else if (team !== q.team) many = true;
    }
    const contested = many || ai;
    if (contested !== e.contested) { e.contested = contested; this._dirty(); }
    if (!contested && team >= 0) {
      if (e.holder !== team) { e.holder = team; e.hold = 0; this._dirty(); }
      e.hold += dt;
      if (e.hold >= EX.hold) this._lift(e, team);
    }
    if (e.state === 3 && e.timer <= 0) {
      e.state = e.final ? 0 : 4; e.timer = EX.cooldown; e.hold = 0; e.holder = -1;
      sim._emit({ t: 'exleave', site: e.i, x: e.x, z: e.z });
      this._dirty();
    }
  }

  // The helicopter takes everyone of `team` standing in the zone; the squad banks its pot.
  _lift(e, team) {
    const sim = this.sim, s = this.squads.get(team), ids = [];
    for (const q of sim.players) {
      if (q.team !== team || q.ai || !q.alive || q.downed || q.away || q.ex?.out) continue;
      if (Math.hypot(q.ps.x - e.x, q.ps.z - e.z) > e.r) continue;
      ids.push(q.id);
      this._dropCase(q);
      q.ex.out = true;
      q.alive = false; q.hp = 0; q.ps.vx = 0; q.ps.vz = 0;
      if (q.bot) q.bot.setObjective(null);
    }
    if (!ids.length) return;
    s.extracted += ids.length;
    s.banked.push(...s.pot); s.pot = [];
    s.outAt ??= this.t;
    sim._emit({ t: 'exfil', site: e.i, team, ids, x: e.x, z: e.z });
    if (!e.final) { e.state = 4; e.timer = EX.cooldown; sim._emit({ t: 'exleave', site: e.i, x: e.x, z: e.z }); }
    e.hold = 0; e.holder = -1;
    // Downed squadmates left behind stay down; the squad's contract goes on for anyone still out there.
    this._checkSquad(team);
    this._dirty();
  }

  // ---- Contracts ----

  // Deals the squad its next contract: a type it has done least, at a place a fair walk away.
  _assign(s, pick = null) {
    const sim = this.sim;
    const members = sim.players.filter(p => p.team === s.team && !p.ai && p.alive && !p.ex?.out);
    let ax = s.insert.x, az = s.insert.z;
    if (members.length) { ax = members.reduce((n, p) => n + p.ps.x, 0) / members.length; az = members.reduce((n, p) => n + p.ps.z, 0) / members.length; }
    let type = pick?.type, poi = pick?.poi;
    if (type === undefined) {
      const counts = T.map(t => s.banked.concat(s.pot).filter(d => d.type === t).length + (s.lastType === t ? 2 : 0));
      const order = T.map((t, i) => ({ t, w: counts[i] + this.rng() * 1.5 })).sort((a, b) => a.w - b.w);
      type = order[0].t;
    }
    if (poi === undefined) {
      let bestS = -Infinity;
      this.pois.forEach((p, i) => {
        const d = Math.hypot(p.x - ax, p.z - az);
        if (d < 25 || (type !== 'escort' && !this.inside[i].length)) return;
        // Away from where the other squads are working, and from where they stand: contracts are for the AI, fights
        // between squads should come from choices (third parties, contested exfils), not from the dealer.
        let busy = 0;
        for (const o of this.squads.values()) {
          if (o === s || o.done) continue;
          const oc = o.contract && this.pois[o.contract.poi];
          if (oc && Math.hypot(oc.x - p.x, oc.z - p.z) < 70) busy += 40;
        }
        for (const q of sim.players) if (!q.ai && q.alive && q.team !== s.team && Math.hypot(q.ps.x - p.x, q.ps.z - p.z) < 60) { busy += 30; break; }
        const sc = -Math.abs(d - 115) * 0.6 + (4 - p.tier) * 8 - busy + this.rng() * 25;
        if (sc > bestS) { bestS = sc; poi = i; }
      });
    }
    if (poi === undefined) return;
    const c = this._contract(s.team, type, poi);
    if (!c) { s.nextAt = this.t + 3; return; }
    if (s.contract) this._abandon(s.contract);
    s.contract = c;
    s.lastType = type;
    sim._emit({ t: 'excontract', team: s.team, type, tier: c.tier, poi, taken: true });
    this._dirty();
  }

  _contract(team, type, poi) {
    const p = this.pois[poi], rng = this.rng, inside = this.inside[poi];
    const spot = inside.length ? inside[Math.floor(rng() * inside.length)] : this.phones[poi];
    const c = { id: this.cid++, team, type, poi, tier: p.tier, x: spot.x, z: spot.z, state: 0, prog: 0, ax: spot.x, az: spot.z, dx: 0, dz: 0, carrier: -1, back: 0, def: 0, path: null, pi: 0, wave: false };
    if (type === 'intel' || type === 'escort') {
      // Somewhere 70-140 m off, toward another place.
      let best = null, bestS = -Infinity;
      this.pois.forEach((q, i) => {
        if (i === poi) return;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        const sc = -Math.abs(d - (type === 'escort' ? 85 : 105)) + rng() * 20;
        if (d > 50 && d < 150 && sc > bestS) { bestS = sc; best = i; }
      });
      if (best === null) return null;
      const q = this.pois[best], to = openNear(this.sim.map, (q.x + p.x) / 2 + (q.x - p.x) * 0.25, (q.z + p.z) / 2 + (q.z - p.z) * 0.25, 1.5, 24);
      c.dx = to.x; c.dz = to.z;
      if (type === 'escort') {
        const from = openNear(this.sim.map, spot.x, spot.z, 1.2, 20);
        c.x = c.ax = from.x; c.z = c.az = from.z;
      }
    }
    if (type === 'hvt') {
      const g = this._makeGroup({ kind: 'hvt', poi, size: 3, tough: Math.min(1, (TOUGH[p.tier] ?? 0.3) + 0.1), hq: false, spots: [spot, ...inside.slice(0, 2)], route: [], x: spot.x, z: spot.z, contract: c.id });
      c.group = g.id;
    }
    this.contracts.push(c);
    return c;
  }

  _abandon(c) {
    if (c.type === 'intel' && c.carrier >= 0) { const q = this.sim.players[c.carrier]; if (q?.ex) q.ex.carry = false; }
    if (c.type === 'hvt') {
      const g = this.groups.find(x => x.id === c.group);
      if (g) { g.contract = null; if (g.state === 'asleep') g.wiped = true; }
    }
    c.state = -1;
  }

  _complete(c) {
    const s = this.squads.get(c.team);
    if (!s || s.contract !== c) return;
    s.pot.push({ type: c.type, tier: c.tier });
    s.contract = null;
    s.nextAt = this.t + 2.5;
    c.state = 9;
    for (const q of this.sim.players) if (q.team === c.team && q.ex) q.ex.carry = false;
    this.sim._emit({ t: 'excontract', team: c.team, type: c.type, tier: c.tier, done: true, x: c.x, z: c.z });
    this._dirty();
  }

  _members(team) { return this.sim.players.filter(q => q.team === team && !q.ai && this._up(q)); }

  _stepContract(c, dt) {
    const sim = this.sim;
    switch (c.type) {
      case 'intel': {
        if (c.carrier >= 0) {
          const q = sim.players[c.carrier];
          if (!q || !this._up(q)) {
            if (q?.ex?.carry) this._dropCase(q);
            else { c.carrier = -1; c.state = 2; c.back = 60; this._dirty(); }
            break;
          }
          c.x = q.ps.x; c.z = q.ps.z;
          if (Math.hypot(q.ps.x - c.dx, q.ps.z - c.dz) < 2.6) this._complete(c);
          break;
        }
        if (c.state === 2) { c.back -= dt; if (c.back <= 0) { c.state = 0; c.x = c.ax; c.z = c.az; this._dirty(); } }
        if (sim.tick % 3) break;
        for (const q of this._members(c.team)) {
          if (Math.hypot(q.ps.x - c.x, q.ps.z - c.z) < EX.intelReach) {
            c.carrier = q.index; c.state = 1; q.ex.carry = true;
            sim._emit({ t: 'excase', team: c.team, id: q.id });
            this._dirty();
            break;
          }
        }
        break;
      }
      case 'cache': {
        if (c.state === 0) {
          let planter = null;
          for (const q of this._members(c.team)) if (Math.hypot(q.ps.x - c.x, q.ps.z - c.z) < EX.cacheReach && Math.hypot(q.ps.vx, q.ps.vz) < 1.6 && q.ps.firingT < 0.6) { planter = q; break; }
          c.prog = planter ? c.prog + dt / EX.plantTime : Math.max(0, c.prog - dt);
          if (c.prog >= 1) {
            c.state = 1; c.prog = 0; c.fuse = EX.fuse; c.def = 0;
            sim._emit({ t: 'explant', team: c.team, x: c.x, z: c.z });
            if (!c.wave) { c.wave = true; this._contractWave(c); }
            this._dirty();
          }
        } else if (c.state === 1) {
          c.fuse -= dt;
          // Another squad can pull the charge.
          let defuser = null;
          for (const q of sim.players) {
            if (q.ai || q.team === c.team || !this._up(q)) continue;
            if (Math.hypot(q.ps.x - c.x, q.ps.z - c.z) < EX.cacheReach && Math.hypot(q.ps.vx, q.ps.vz) < 1.6) { defuser = q; break; }
          }
          c.def = defuser ? c.def + dt / EX.defuseTime : Math.max(0, c.def - dt);
          if (c.def >= 1) { c.state = 0; c.def = 0; c.prog = 0; sim._emit({ t: 'explant', team: c.team, x: c.x, z: c.z, defused: true }); this._dirty(); }
          else if (c.fuse <= 0) {
            sim._emit({ t: 'exboom', x: c.x, z: c.z, team: c.team });
            this._blast(c);
            this._complete(c);
          }
        }
        break;
      }
      case 'hack': {
        let ours = false, them = false;
        for (const q of sim.players) {
          if (!q.alive || q.downed || q.ex?.out || q.away) continue;
          if (Math.hypot(q.ps.x - c.x, q.ps.z - c.z) > EX.hackR) continue;
          if (q.team === c.team) ours = true; else them = true;
        }
        c.contested = ours && them;
        if (ours && !them) c.prog += dt / EX.hackTime;
        if (c.prog > 0.3 && !c.wave) { c.wave = true; this._contractWave(c); }
        if (c.prog >= 1) this._complete(c);
        break;
      }
      case 'escort': {
        let near = false, block = false;
        for (const q of sim.players) {
          if (!q.alive || q.downed || q.ex?.out || q.away) continue;
          const d = Math.hypot(q.ps.x - c.x, q.ps.z - c.z);
          if (q.team === c.team && d < EX.escortNear) near = true;
          else if (q.team !== c.team && d < EX.escortBlock) block = true;
        }
        c.moving = near && !block;
        if (!c.path && sim.nav) {
          const out = new Float32Array(96 * 2), n = sim.nav.findPath(c.x, c.z, c.dx, c.dz, out, 96);
          c.path = Array.from(out.slice(0, n * 2)); c.pi = 0;
          if (!n) c.path = [c.dx, c.dz];
        }
        if (c.moving && c.path) {
          let step = EX.escortSpeed * dt;
          while (step > 0 && c.pi < c.path.length) {
            const tx = c.path[c.pi], tz = c.path[c.pi + 1], d = Math.hypot(tx - c.x, tz - c.z);
            if (d <= step) { c.x = tx; c.z = tz; c.pi += 2; step -= d; } else { c.x += (tx - c.x) / d * step; c.z += (tz - c.z) / d * step; step = 0; }
          }
          const total = Math.hypot(c.dx - c.ax, c.dz - c.az) || 1;
          c.prog = Math.max(0, Math.min(1, 1 - Math.hypot(c.dx - c.x, c.dz - c.z) / total));
          if (c.pi >= c.path.length || Math.hypot(c.dx - c.x, c.dz - c.z) < 1.5) this._complete(c);
        }
        if (!c.wave && c.prog > 0.4) { c.wave = true; this._contractWave(c); }
        break;
      }
      case 'hvt': break;      // Done in onKill when the commander falls.
    }
  }

  // Noise at a contract brings company: at the better sites always, at the quiet ones now and then.
  _contractWave(c) {
    if (this.rng() < (c.tier === 1 ? 0.25 : c.tier === 2 ? 0.5 : 0.8)) return;
    this._wave(c.x, c.z, c.tier === 1 ? 3 : 2, this._toughAt(c.x, c.z));
  }

  _dropCase(p) {
    if (!p?.ex?.carry) return;
    p.ex.carry = false;
    const s = this.squadOf(p), c = s?.contract;
    if (!c || c.type !== 'intel' || c.carrier !== p.index) return;
    c.carrier = -1; c.state = 2; c.back = 60; c.x = p.ps.x; c.z = p.ps.z;
    if (this.sim.nav && !this.sim.nav.isWalkable(c.x, c.z)) { const k = this.sim.nav.nearestFree(c.x, c.z); c.x = k % this.sim.nav.w + 0.5; c.z = Math.floor(k / this.sim.nav.w) + 0.5; }
    this.sim._emit({ t: 'excase', team: c.team, drop: true, x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10 });
    this._dirty();
  }

  // The cache goes up: anyone standing on it is hurt.
  _blast(c) {
    const sim = this.sim;
    for (const q of sim.players) {
      if (!q.alive || q.ex?.out || q.spawnProtect > 0) continue;
      const d = Math.hypot(q.ps.x - c.x, q.ps.z - c.z);
      if (d < 5) { q.hp -= (5 - d) * 22; if (q.hp <= 0) { if (q.ex && this.tryDown(q, null, 'charge')) continue; sim._selfKill(q, 'charge'); } }
    }
  }

  _hvtDown(g, killer) {
    g.commanderDead = true;
    const c = this.contracts.find(x => x.id === g.contract);
    if (!c || c.state === -1 || c.state === 9) return;
    const s = this.squads.get(c.team);
    if (s?.contract === c) this._complete(c);
  }

  // ---- Ammo ----

  _drop(x, z) {
    if (this.drops.length > 40) this.drops.shift();
    this.drops.push({ id: this.dropId++, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, t: this.t });
    this._lootDirty();
  }

  _pickups(p) {
    const ps = p.ps;
    if (!wantsAmmo(ps)) return;
    for (const b of this.boxes) {
      if (this.boxDown.has(b.i) || Math.abs(b.x - ps.x) > EX.ammoReach || Math.abs(b.z - ps.z) > EX.ammoReach) continue;
      this._giveAmmo(p, EX.boxMags);
      this.boxDown.set(b.i, this.t + EX.boxBack);
      this._lootDirty();
      return;
    }
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (Math.abs(d.x - ps.x) > EX.ammoReach || Math.abs(d.z - ps.z) > EX.ammoReach) continue;
      this._giveAmmo(p, EX.dropMags);
      this.drops.splice(i, 1);
      this._lootDirty();
      return;
    }
  }

  _giveAmmo(p, mags) {
    exAmmo(p.ps, mags);
    if (!p.isBot) this.sim._emit({ t: 'exammo', id: p.id, mags });
  }

  // ---- Commands from phones ----

  command(p, msg) {
    if (!p || !p.ex || this.sim.phase !== 'live') return false;
    if (msg.act === 'call') return this._callExfil(p);
    if (msg.act === 'take') {
      const ph = this.phones[msg.phone | 0], s = this.squadOf(p);
      if (!ph || !s || s.done || !this._up(p) || Math.hypot(p.ps.x - ph.x, p.ps.z - ph.z) > EX.phoneReach + 1) return false;
      const o = this.offers(ph.i, s.team, s.taken)[msg.k | 0];
      if (!o) return false;
      s.taken++;
      this._assign(s, o);
      return true;
    }
    return false;
  }

  // Three contracts a phone offers a squad: seeded by the phone, the squad and how many it has taken, so every phone
  // works them out the same without the wire carrying them.
  offers(phone, team, taken) {
    const rng = mulberry32(((this.seed * 31 + phone * 977 + team * 131 + taken * 7919) ^ 0x0ffe5) >>> 0);
    const ph = this.phones[phone];
    const types = T.slice().sort(() => rng() - 0.5).slice(0, 3);
    const near = this.pois.map((p, i) => ({ i, d: Math.hypot(p.x - ph.x, p.z - ph.z) }))
      .filter(o => o.d > 20 && o.d < 170 && this.inside[o.i].length).sort((a, b) => a.d - b.d).slice(0, 6);
    return types.map((type, k) => {
      const o = near[Math.floor(rng() * near.length)] ?? { i: (phone + k + 1) % this.pois.length };
      return { type, poi: o.i, tier: this.pois[o.i].tier };
    });
  }

  // ---- AI patrols ----

  _toughAt(x, z) {
    const W = this.sim.map.width, H = this.sim.map.height;
    let t = Math.max(0.15, 1 - Math.hypot(x - W / 2, z - H / 2) / 190);
    for (const p of this.pois) if (Math.hypot(p.x - x, p.z - z) < p.r + 10) t = Math.max(t, TOUGH[p.tier] ?? 0.2);
    return Math.min(1, t);
  }

  _alert(g, x, z) {
    g.alertX = x; g.alertZ = z; g.alertT = this.t;
    if (g.state !== 'alert' && g.state !== 'asleep') {
      g.state = 'alert';
      for (const q of g.members) if (q.bot) { q.bot.calm = false; q.bot.thinkT = Math.min(q.bot.thinkT, 0.1); }
    }
  }

  _freeSlots(n, commander = false) {
    const out = [];
    for (const p of this.sim.players) {
      if (!p.ai || p.alive || p.exGroup || (p.exFreeAt ?? 0) > this.t) continue;
      if (commander !== (p.index - this._aiStart() < COMMANDERS)) continue;
      out.push(p);
      if (out.length >= n) break;
    }
    return out;
  }
  _aiStart() { return this._ai0 ??= this.sim.players.findIndex(p => p.ai); }

  // A group takes seats and appears on its spots.
  _wake(g) {
    const sim = this.sim;
    const want = g.size - (g.lostForGood ?? 0);
    const seats = [];
    if (g.kind === 'hvt' && !g.commanderDead) seats.push(...this._freeSlots(1, true));
    if (g.kind === 'hvt' && !seats.length && !g.commanderDead) seats.push(...this._freeSlots(1));
    seats.push(...this._freeSlots(Math.max(0, want - seats.length)));
    if (!seats.length) return false;
    g.members = [];
    g.state = 'calm';
    seats.forEach((p, k) => {
      const commander = g.kind === 'hvt' && k === 0 && !g.commanderDead;
      const tough = commander ? 1 : g.tough;
      this._dress(p, tough, commander, k);
      p.exGroup = g;
      p.exCommander = commander;
      const spot = g.kind === 'patrol' || g.kind === 'wave' ? g.route[(g.wp + k) % Math.max(1, g.route.length)] ?? g : g.spots[k % g.spots.length] ?? g;
      const at = g.kind === 'wave' ? this._walk(g.x + (k - 1) * 1.6, g.z) : spot;
      sim._placeAt(p, at, Math.atan2(at.z - (this.pois[g.poi]?.z ?? at.z), at.x - (this.pois[g.poi]?.x ?? at.x)) || 0);
      p.spawnProtect = 0;
      if (p.bot) { p.bot.S = skillOf(p); p.bot.interval = 1 / p.bot.S.thinkHz; p.bot.calm = g.kind !== 'wave'; }
      g.members.push(p);
    });
    if (g.kind === 'wave') this._alert(g, g.alertX, g.alertZ);
    return true;
  }

  _dress(p, tough, commander, k) {
    const tier = tough < 0.35 ? 0 : tough < 0.68 ? 1 : 2;
    const pool = GUNS[tier], primary = commander ? 'lmg' : pool[(p.index * 7 + k * 3 + Math.floor(this.t)) % pool.length];
    const skill = commander ? 'elite' : ['recruit', 'regular', 'veteran'][tier];
    p.rating = commander ? 0.55 : 0.02 + 0.36 * tough;
    p.skill = skill;
    p.exTake = commander ? 0.45 : 1 - 0.25 * tough;
    p.exDeal = commander ? 0.5 : 0.3 + 0.25 * tough;
    p.exNades = tier === 2 || commander ? 1 : 0;
    p.pendingLoadout = normalizeLoadout({
      primary, secondary: 'pistol', camo: 'none', attachments: { [primary]: botAttachments(primary, skill, p.index) },
      perks: tier === 2 ? ['flak', 'fasthands', 'tracker'] : ['marathon', 'fasthands', 'tracker'], tactical: tier ? 'flash' : 'smoke', lethal: 'frag',
      streaks: [], operator: commander ? 'marshal' : tier === 2 ? 'ram' : 'ghoul',
    });
    p.hp = MAX_HP;
  }

  // Back off the field quietly: nobody was near enough to see.
  _sleep(g) {
    for (const p of g.members) { p.alive = false; p.hp = 0; p.exGroup = null; p.exFreeAt = this.t; if (p.bot) p.bot.setObjective(null); }
    g.members = [];
    g.state = 'asleep';
  }

  _groupWiped(g) {
    g.state = 'asleep';
    if (g.kind === 'wave' || g.kind === 'hvt') { g.wiped = true; return; }
    g.respawnAt = this.t + GROUP_BACK;
    g.lost = 0;
  }

  // Reinforcements: a group that walks in from outside toward (x, z), hunting.
  _wave(x, z, n, tough) {
    const sim = this.sim;
    if (this._freeSlots(n).length < 2) return null;
    let at = null;
    const a0 = sim.rng() * Math.PI * 2;
    for (let k = 0; k < 10 && !at; k++) {
      const a = a0 + k * 0.63, px = x + Math.cos(a) * 42, pz = z + Math.sin(a) * 42;
      if (!(sim.nav ? sim.nav.isWalkable(px, pz) : openAt(sim.map, px, pz, 0.8))) continue;
      let seen = false;
      for (const q of sim.players) if (q.alive && !q.ai && Math.hypot(q.ps.x - px, q.ps.z - pz) < 22) { seen = true; break; }
      if (!seen) at = { x: px, z: pz };
    }
    if (!at) return null;
    const g = this._makeGroup({ kind: 'wave', poi: -1, size: n, tough, hq: false, spots: [], route: [at], x: at.x, z: at.z });
    g.alertX = x; g.alertZ = z; g.alertT = this.t;
    if (!this._wake(g)) { g.wiped = true; return null; }
    sim._emit({ t: 'exwave', x: Math.round(x), z: Math.round(z) });
    return g;
  }

  _nearestSquad(x, z) {
    let best = Infinity;
    for (const p of this.sim.players) {
      if (p.ai || !p.alive || p.ex?.out) continue;
      const d = Math.abs(p.ps.x - x) + Math.abs(p.ps.z - z);
      if (d < best) best = d;
    }
    return best * 0.75;     // Close enough to a straight-line distance for waking and sleeping.
  }

  _planGroups() {
    const sim = this.sim;
    for (let gi = 0; gi < this.groups.length; gi++) {
      const g = this.groups[gi];
      if (g.wiped) continue;
      const ax = g.members.length ? g.members[0].ps.x : g.x, az = g.members.length ? g.members[0].ps.z : g.z;
      if (g.state === 'asleep') {
        if ((sim.tick / GROUP_EVERY + gi) % 2 !== 0) continue;     // Sleepers look once a second.
        if (this.t < g.respawnAt) continue;
        if (this._nearestSquad(g.x, g.z) < EX.wake) this._wake(g);
        continue;
      }
      // Asleep again once nobody has been near for a while, unless something happened here.
      const near = this._nearestSquad(ax, az);
      if (near > EX.sleep && g.state === 'calm' && g.kind !== 'wave') { g.farT += GROUP_EVERY * sim.dt; if (g.farT > 15) { this._sleep(g); continue; } } else g.farT = 0;
      if (g.kind === 'wave' && near > EX.sleep + 40) { this._sleep(g); g.wiped = true; continue; }
      // What the group knows.
      for (const q of g.members) {
        const b = q.bot;
        if (!b) continue;
        if (b.targetVisible && b.target) this._alert(g, b.target.ps.x, b.target.ps.z);
        else if (b.hasKnown && !b.knownSoft && this.t - g.alertT > 2) this._alert(g, b.knownX, b.knownZ);
      }
      if (g.state !== 'alert') {
        for (let i = this.noise.length - 1; i >= 0; i--) {
          const s = this.noise[i];
          if (s.team === AI_TEAM) continue;
          if (Math.abs(s.x - ax) + Math.abs(s.z - az) < 55) { this._alert(g, s.x, s.z); break; }
        }
      }
      if (g.state === 'alert' && this.t - g.alertT > ALERT_KEEP) {
        g.state = 'calm';
        for (const q of g.members) if (q.bot) q.bot.calm = true;
        if (g.kind === 'wave') { g.kind = 'patrol'; g.route = [{ x: g.alertX, z: g.alertZ }]; }
      }
      // HQ sites call reinforcements when they are losing.
      if (g.hq && g.state === 'alert' && (g.lost ?? 0) >= 2 && g.waves < 2 && this.t >= g.waveAt) {
        g.waveAt = this.t + WAVE_GAP; g.waves++; g.lost = 0;
        this._wave(g.alertX, g.alertZ, 2 + (g.tough > 0.6 ? 1 : 0), g.tough);
      }
      // Orders.
      g.members.forEach((q, k) => {
        const b = q.bot;
        if (!b) return;
        b.sightK = g.state === 'alert' ? 0.9 : 0.6;      // On their rounds they are not looking hard.
        if (g.state === 'alert') {
          if (b.targetVisible) return;
          // Posts and patrols chase only so far from home; waves go where they were sent.
          let ex = g.alertX, ez = g.alertZ;
          const home = g.kind === 'wave' ? null : { x: g.x, z: g.z }, dh = home ? Math.hypot(ex - home.x, ez - home.z) : 0;
          if (home && dh > 40) { ex = home.x + (ex - home.x) / dh * 40; ez = home.z + (ez - home.z) / dh * 40; }
          const a = k * 2.1, x = ex + Math.cos(a) * 3, z = ez + Math.sin(a) * 3;
          const at = this._walk(x, z);
          b.setObjective({ key: `ga${g.id}:${Math.round(at.x / 4)}:${Math.round(at.z / 4)}`, role: 'collect', x: at.x, z: at.z, r: 2 });
          return;
        }
        if (g.kind === 'patrol' && g.route.length) {
          const lead = g.members[0];
          let wp = g.route[g.wp % g.route.length];
          if (q === lead && Math.hypot(wp.x - q.ps.x, wp.z - q.ps.z) < 3.5) { g.wp++; wp = g.route[g.wp % g.route.length]; }
          const tx = q === lead ? wp.x : lead.ps.x - Math.cos(lead.ps.aim) * 2.5 * k, tz = q === lead ? wp.z : lead.ps.z - Math.sin(lead.ps.aim) * 2.5 * k;
          const at = this._walk(tx, tz);
          b.setObjective({ key: `gp${g.id}:${q === lead ? g.wp : Math.round(at.x / 5) + ':' + Math.round(at.z / 5)}`, role: 'collect', x: at.x, z: at.z, r: 1.5 });
          return;
        }
        const s = g.spots[k % g.spots.length] ?? g;
        b.setObjective({ key: `gs${g.id}:${k}`, role: 'defend', x: s.x, z: s.z, r: 1.2 });
      });
    }
    // Groups gone for good are dropped from the list once nothing refers to them.
    if (this.groups.length > 80) this.groups = this.groups.filter(g => !g.wiped || g.members.length);
  }

  _walk(x, z) {
    const nav = this.sim.nav, W = this.sim.map.width, H = this.sim.map.height;
    x = Math.max(3, Math.min(W - 3, x)); z = Math.max(3, Math.min(H - 3, z));
    if (nav && !nav.isWalkable(x, z)) { const k = nav.nearestFree(x, z); x = k % nav.w + 0.5; z = Math.floor(k / nav.w) + 0.5; }
    return { x, z };
  }

  // Bots the rules drive this tick: downed squad bots crawl to a squadmate. True when BotBrain should not run.
  driveBot(p, dt) {
    if (!p.downed) return false;
    const sim = this.sim;
    let best = null, bestD = 40;
    for (const q of sim.players) {
      if (q === p || q.team !== p.team || q.ai || !this._up(q)) continue;
      const d = Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z);
      if (d < bestD) { bestD = d; best = q; }
    }
    const I = this._downIn || (this._downIn = { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1 });
    I.mx = 0; I.mz = 0; I.aim = p.ps.aim;
    if (best && bestD > 1.4) {
      const dx = best.ps.x - p.ps.x, dz = best.ps.z - p.ps.z;
      if (sim.nav.isWalkable(p.ps.x + dx / bestD, p.ps.z + dz / bestD)) { I.mx = dx / bestD; I.mz = dz / bestD; I.aim = Math.atan2(dz, dx); }
    }
    downedInput(I);
    stepPlayer(p.ps, I, dt, sim.map, sim.rng);
    return true;
  }

  // ---- Squad bots ----

  _planSquads() {
    for (const s of this.squads.values()) if (!s.done) this._planSquad(s);
  }

  // Which exfil a squad would go for now: open, on its way in, or down and waiting; nearest first.
  _exfilFor(s, x, z) {
    let best = null, bestD = Infinity;
    for (const e of this.exfils) {
      if (e.state === 0 || e.state === 4) continue;
      if (e.state === 3 && !e.final && e.timer < 12) continue;
      // Somebody else's ride is fair game too (taking it means a fight), but our own or an open one comes first.
      const theirs = (e.state === 2 || e.state === 3) && e.caller !== s.team && e.caller !== -1 && !e.final;
      const d = Math.hypot(e.x - x, e.z - z) + (theirs ? 60 : 0);
      if (e.state === 1 && e.timer < d / 5 + 8) continue;      // It would shut before we got there.
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  _planSquad(s) {
    const sim = this.sim;
    const members = sim.players.filter(p => p.team === s.team && !p.ai && p.alive && !p.ex?.out);
    const bots = members.filter(p => p.bot && !p.downed);
    if (!bots.length) return;
    const lead = members.find(p => !p.isBot && !p.downed && !p.away);
    const downed = members.filter(p => p.downed);
    const ax = (lead ?? bots[0]).ps.x, az = (lead ?? bots[0]).ps.z;
    const plan = s.plan, c = s.contract;
    // Exfil: with something in the pot (or late in the match), and a ride we can reach.
    const left = EX.length - this.t;
    const potN = s.pot.length;
    let want = false;
    if (!lead) {
      // Greedy early, careful late: a full pot, a second window with something to show, or a squad running out.
      if (this.t >= EX.final.open - 20) want = true;
      else if (s.extracted) want = true;
      else if (potN >= 9) want = true;
      else if (potN >= 3 + (plan.greed ? 0 : 1) && this.window >= plan.greed) want = true;
      else if (potN >= 1 && (s.lives <= 1 || (members.length <= Math.ceil(this.squadSize / 2) && s.lives <= 2))) want = true;
    }
    const site = want ? this._exfilFor(s, ax, az) : null;
    // Contesting someone else's call nearby, now and then.
    let contest = null;
    if (!lead && !site && plan.contest && plan.contest.until > this.t) contest = this.exfils[plan.contest.site];
    else if (!lead && !site) {
      for (const e of this.exfils) {
        if ((e.state !== 2 && e.state !== 3) || e.caller === s.team || e.final) continue;
        if (plan.weighed?.has(`${e.i}:${Math.round(e.timer)}`) || plan.weighed?.has(`${e.i}`)) continue;
        (plan.weighed ??= new Set()).add(`${e.i}`);
        if (Math.hypot(e.x - ax, e.z - az) < 140 && bots.length >= 2 && this.rng() < 0.2 + plan.aggro * 0.5) { plan.contest = { site: e.i, until: this.t + 70 }; contest = e; }
      }
    }
    if (contest && contest.state !== 2 && contest.state !== 3) { plan.contest = null; contest = null; }
    // A fight heard nearby, sometimes worth a third party.
    let fight = plan.fight && sim.time - plan.fight.t < NOISE_KEEP ? plan.fight : null;
    if (!lead && !fight && !site && bots.every(p => p.hp > 60)) {
      for (let i = this.noise.length - 1; i >= 0; i--) {
        const n = this.noise[i];
        if (n.team === s.team || n.team === AI_TEAM || n.weighed?.has(s.team)) continue;
        (n.weighed || (n.weighed = new Set())).add(s.team);
        const d = Math.hypot(n.x - ax, n.z - az);
        if (d > 18 && d < 70 && this.rng() < plan.aggro * 0.12) { fight = n; break; }
      }
    }
    plan.fight = fight;

    bots.forEach((p, i) => {
      const bot = p.bot;
      // A squadmate down nearby comes first, unless there is a fight in view.
      const mate = downed.length && !bot.targetVisible ? downed.reduce((m, q) => {
        const d = Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z);
        return d < 55 && (!m || d < m.d) ? { q, d } : m;
      }, null) : null;
      if (mate) {
        const r = mate.q.ex.reviver && sim.byId.get(mate.q.ex.reviver);
        if (!r || r === p || !r.alive || r.downed || r.team !== p.team) {
          mate.q.ex.reviver = p.id;
          bot.setObjective({ key: `rev:${mate.q.id}:${Math.round(mate.q.ps.x)}:${Math.round(mate.q.ps.z)}`, role: 'collect', x: mate.q.ps.x, z: mate.q.ps.z, r: 1, commit: true });
          return;
        }
      }
      // Low on ammo for the main gun and a box near: top up.
      const w = p.ps.defs?.[0];
      if (!bot.targetVisible && w && !w.unlimitedReserve && p.ps.reserve[0] < w.magazine) {
        const box = this._nearBox(p.ps.x, p.ps.z, 40);
        if (box) { bot.setObjective({ key: `ammo:${box.i}`, role: 'collect', x: box.x, z: box.z, r: 1 }); return; }
      }
      const spread = (k, r) => { const a = (k / Math.max(1, bots.length)) * Math.PI * 2 + 0.6; return { dx: Math.cos(a) * r, dz: Math.sin(a) * r }; };
      // A human leads: stay with them; on their exfil, their hack or their charge, hold round them.
      if (lead) {
        const o = spread(i, 4);
        const at = this._walk(lead.ps.x + o.dx, lead.ps.z + o.dz);
        const far = Math.hypot(at.x - p.ps.x, at.z - p.ps.z) > 7;
        bot.setObjective({ key: far ? `with:${Math.round(at.x / 6)}:${Math.round(at.z / 6)}` : bot.objKey ?? 'with', role: 'hold', x: at.x, z: at.z, r: 3 });
        // On a landed exfil the bots step into the zone with them.
        const e = this.exfils.find(x => x.state === 3 && Math.hypot(lead.ps.x - x.x, lead.ps.z - x.z) < x.r);
        if (e) bot.setObjective({ key: `xin:${e.i}:${i}`, role: 'defend', x: e.x + o.dx * 0.8, z: e.z + o.dz * 0.8, r: 1.5 });
        return;
      }
      if (site) {
        // Call it when there, then hold round it; once it is down, everyone in.
        if (site.state === 1 && Math.hypot(p.ps.x - site.x, p.ps.z - site.z) < site.r - 1) this._callExfil(p);
        const k = site.state === 3 ? 0.45 : 0.75, o = spread(i, site.r * k);
        bot.setObjective({ key: `xf:${site.i}:${site.state === 3 ? 'in' : 'out'}:${i}`, role: 'defend', x: site.x + o.dx, z: site.z + o.dz, r: 1.6, commit: site.state === 3 });
        return;
      }
      if (contest) {
        // Into the zone once it is down: to take the ride with our own pot, or just to stop theirs.
        const o = spread(i, contest.state === 3 ? contest.r * 0.45 : contest.r + 8);
        bot.setObjective({ key: `xc:${contest.i}:${contest.state}:${i}`, role: contest.state === 3 ? 'defend' : 'collect', x: contest.x + o.dx, z: contest.z + o.dz, r: 2 });
        return;
      }
      if (fight) {
        const d = Math.max(1, Math.hypot(fight.x - ax, fight.z - az)), o = spread(i, 3);
        const at = this._walk(fight.x + (ax - fight.x) / d * 14 + o.dx, fight.z + (az - fight.z) / d * 14 + o.dz);
        bot.setObjective({ key: `tp:${Math.round(at.x / 5)}:${Math.round(at.z / 5)}`, role: 'collect', x: at.x, z: at.z, r: 2 });
        return;
      }
      if (!c) { const at = this._walk(ax + spread(i, 4).dx, az + spread(i, 4).dz); bot.setObjective({ key: `wait:${Math.round(at.x / 6)}:${Math.round(at.z / 6)}`, role: 'hold', x: at.x, z: at.z, r: 3 }); return; }
      bot.setObjective(this._contractOrder(s, c, p, i, bots, spread));
    });
  }

  _nearBox(x, z, r) {
    let best = null, bd = r;
    for (const b of this.boxes) {
      if (this.boxDown.has(b.i)) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // What one bot does for its squad's contract.
  _contractOrder(s, c, p, i, bots, spread) {
    const sim = this.sim, o = spread(i, 5);
    switch (c.type) {
      case 'intel': {
        if (c.carrier === p.index) return { key: `drop:${c.id}`, role: 'collect', x: c.dx, z: c.dz, r: 1 };
        if (c.carrier >= 0) {
          const q = sim.players[c.carrier], at = this._walk(q.ps.x + o.dx, q.ps.z + o.dz);
          return { key: `esc:${c.id}:${Math.round(at.x / 5)}:${Math.round(at.z / 5)}`, role: 'collect', x: at.x, z: at.z, r: 2 };
        }
        const closest = bots.reduce((b, q) => (Math.hypot(q.ps.x - c.x, q.ps.z - c.z) < Math.hypot(b.ps.x - c.x, b.ps.z - c.z) ? q : b));
        if (closest === p) return { key: `case:${c.id}:${c.state}:${Math.round(c.x)}:${Math.round(c.z)}`, role: 'collect', x: c.x, z: c.z, r: 0.6, commit: Math.hypot(p.ps.x - c.x, p.ps.z - c.z) < 12 };
        const at = this._walk(c.x + o.dx, c.z + o.dz);
        return { key: `cg:${c.id}:${i}:${Math.round(c.x)}`, role: 'defend', x: at.x, z: at.z, r: 2 };
      }
      case 'hvt': {
        const g = this.groups.find(x => x.id === c.group);
        const boss = g?.members.find(q => q.exCommander);
        const tx = boss ? boss.ps.x : c.x, tz = boss ? boss.ps.z : c.z;
        const at = this._walk(tx + o.dx * 0.6, tz + o.dz * 0.6);
        return { key: `hvt:${c.id}:${Math.round(at.x / 5)}:${Math.round(at.z / 5)}`, role: 'attack', x: at.x, z: at.z, r: 3 };
      }
      case 'cache': {
        const closest = bots.reduce((b, q) => (Math.hypot(q.ps.x - c.x, q.ps.z - c.z) < Math.hypot(b.ps.x - c.x, b.ps.z - c.z) ? q : b));
        if (c.state === 0 && closest === p) return { key: `plant:${c.id}`, role: 'defend', x: c.x, z: c.z, r: 0.7, commit: Math.hypot(p.ps.x - c.x, p.ps.z - c.z) < 10 };
        const at = this._walk(c.x + o.dx * 1.4, c.z + o.dz * 1.4);
        return { key: `cd:${c.id}:${i}`, role: 'defend', x: at.x, z: at.z, r: 2 };
      }
      case 'hack': {
        const at = this._walk(c.x + o.dx * 0.6, c.z + o.dz * 0.6);
        return { key: `hk:${c.id}:${i}`, role: 'defend', x: at.x, z: at.z, r: 1.5 };
      }
      case 'escort': {
        const ahead = c.path && c.pi < c.path.length ? { x: c.path[c.pi], z: c.path[c.pi + 1] } : { x: c.dx, z: c.dz };
        const d = Math.max(1, Math.hypot(ahead.x - c.x, ahead.z - c.z));
        const lead = i === 0 ? 4 : i === 1 ? -3 : 0;
        const at = this._walk(c.x + (ahead.x - c.x) / d * lead + o.dx * 0.5, c.z + (ahead.z - c.z) / d * lead + o.dz * 0.5);
        return { key: `es:${c.id}:${Math.round(at.x / 3)}:${Math.round(at.z / 3)}`, role: 'collect', x: at.x, z: at.z, r: 1.5 };
      }
    }
    return null;
  }

  // ---- View and wire ----

  _dirty() { this.ver++; this.verAt = this.sim.time; }
  _lootDirty() { this.lootVer = (this.lootVer ?? 0) + 1; }

  playerView(p, v) {
    v.ai = !!p.ai;
    if (!p.ex) return;
    v.downed = !!p.downed;
    v.reviveK = p.downed ? p.ex.reviveT / BR.reviveTime : 0;
    v.out = !!p.ex.out;
    v.carry = !!p.ex.carry;
  }

  // The state as the HUD and renderer read it (the host builds it from the rules, a guest from the wire).
  view() {
    const V = this.V;
    V.t = this.t; V.length = EX.length; V.squadSize = this.squadSize;
    V.squads = [...this.squads.values()].map(s => this._squadView(s));
    V.exfils = this.exfils.map(e => ({ i: e.i, x: e.x, z: e.z, r: e.r, final: e.final, state: e.state, timer: e.timer, hold: e.hold, holder: e.holder, caller: e.caller, contested: e.contested }));
    V.phones = this.phones; V.boxes = this.boxes.map(b => ({ ...b, up: !this.boxDown.has(b.i) }));
    V.drops = this.drops; V.pois = this.pois; V.window = this.window;
    V.stats = this.sim.players.map(p => (p.ex ? [p.ex.revives, p.ex.knocks] : [0, 0]));
    return V;
  }

  _squadView(s) {
    const c = s.contract;
    return {
      team: s.team, lives: s.lives, pot: s.pot.slice(), banked: s.banked.slice(), extracted: s.extracted, done: s.done, wiped: s.wiped, taken: s.taken,
      contract: c ? { id: c.id, type: c.type, tier: c.tier, poi: c.poi, x: c.x, z: c.z, dx: c.dx, dz: c.dz, ax: c.ax, az: c.az, state: c.state, prog: c.type === 'cache' ? (c.state === 1 ? 1 - c.fuse / EX.fuse : c.prog) : c.prog,
        def: c.def ?? 0, carrier: c.carrier, moving: !!c.moving, contested: !!c.contested, name: CONTRACT_NAMES[c.type] } : null,
    };
  }

  // Fast: [t, per squad player packed, per site packed, per squad contract [state, prog, x, z]]; slow on change.
  encode() {
    const sim = this.sim;
    const players = [];
    for (const p of sim.players) {
      if (p.ai) break;
      const ex = p.ex;
      players.push(!ex ? 0 : (p.downed ? 1 : 0) | (Math.min(15, Math.round((p.downed ? ex.reviveT / BR.reviveTime : 0) * 15)) << 1) | (ex.out ? 32 : 0) | (ex.carry ? 64 : 0));
    }
    const sites = this.exfils.map(e => e.state | (Math.min(1023, Math.ceil(e.timer)) << 3) | (Math.min(127, Math.round(e.hold * 10)) << 13) | ((e.holder + 1) & 31) << 20 | (e.contested ? 1 << 25 : 0));
    const cons = [];
    for (const s of this.squads.values()) {
      const c = s.contract;
      if (!c) { cons.push(0); continue; }
      const v = this._squadView(s).contract;
      // [state + 16 x flag, progress]; a moving thing (the case, the asset) adds where it is, a planted charge its pull.
      const head = [c.state + (c.moving || c.contested ? 16 : 0), Math.round(v.prog * 1000)];
      if (c.type === 'intel' || c.type === 'escort') head.push(r1(c.x), r1(c.z));
      else if (c.type === 'cache' && c.def > 0) head.push(0, 0, Math.round(c.def * 100));
      cons.push(head);
    }
    // The full block: on a change (once, and again a few snapshots on), and every SLOW_EVERY ticks anyway.
    const due = this.ver !== this.sentVer && sim.tick - (this.sentTick ?? -99) >= 8;
    const again = this.repeatAt !== undefined && sim.tick >= this.repeatAt;
    let slow = 0;
    if (due || again || sim.tick % SLOW_EVERY === 0 || sim.phase === 'ended') {
      slow = this._slow();
      if (due) { this.repeatAt = sim.tick + 6; } else this.repeatAt = undefined;
      this.sentVer = this.ver; this.sentTick = sim.tick;
    }
    // One snapshot in BACKUP_EVERY / SNAPSHOT_EVERY carries the backup (counted per encode: snapshots go out on even ticks).
    // With per-guest snapshots (encodeFor) only phones with a human on them get it: any of them may become the host.
    this._enc = ((this._enc ?? 0) + 1) % (BACKUP_EVERY / 2);
    this._bk = this._enc === 0 ? this.backup() : 0;
    const backup = sim.interest ? 0 : this._bk;
    // Ammo on the ground: its own small block, on a change (at most every 6 ticks) and with the full block.
    let loot = 0;
    if ((this.lootVer !== this.sentLoot && sim.tick - (this.lootTick ?? -99) >= 6) || slow) {
      loot = [[...this.boxDown.keys()], this.drops.flatMap(d => [d.id, r1(d.x), r1(d.z)])];
      this.sentLoot = this.lootVer; this.lootTick = sim.tick;
    }
    this._block = [Math.round(this.t * 10), players.some(Boolean) ? players : 0, sites, cons, slow, backup, loot];
    return this._block;
  }

  // One guest's cut of the block: its own squad's contract in full, the others' only as far as the world shows them
  // (where a case or an asset is, whether a charge is set), and the migration backup for a human's phone.
  encodeFor(g) {
    const b = this._block ?? this.encode();
    const cons = b[3].map((f, k) => {
      if (!f) return 0;
      const s = this._squadList()[k];
      if (s.team === g.team) return f;
      const c = s.contract;
      return c.type === 'intel' || c.type === 'escort' ? [f[0], 0, f[2], f[3]] : c.type === 'cache' && c.state === 1 ? f.slice(0, 2) : [f[0]];
    });
    return [b[0], b[1], b[2], cons, b[4], !g.isBot && this._bk ? this._bk : b[5], b[6]];
  }
  _squadList() { return this._sl ??= [...this.squads.values()]; }

  _slow() {
    const sq = [...this.squads.values()].map(s => {
      const c = s.contract;
      return [s.team, s.lives, s.taken, s.extracted, (s.done ? 1 : 0) | (s.wiped ? 2 : 0), s.pot.map(d => packDone(d.type, d.tier)), s.banked.map(d => packDone(d.type, d.tier)),
        c ? [c.id, T.indexOf(c.type), c.tier, c.poi, r1(c.ax), r1(c.az), r1(c.dx), r1(c.dz), c.carrier] : 0];
    });
    return [this.ver, this.window, sq, this.sim.players.map(p => (p.ex ? [p.ex.revives, p.ex.knocks] : 0)), this.exfils.map(e => e.caller)];
  }

  decode(a, out) {
    const sim = this.sim;
    // The host decodes its own snapshots for its view (js/game/match.js): it reads its live state, never the wire's.
    if (this.authority) {
      for (let i = 0; i < out.players.length && i < sim.players.length; i++) this.playerView(sim.players[i], out.players[i]);
      return this.view();
    }
    if (a) {
      const [t, players, sites, cons, slow, backup, loot] = a;
      this.t = t / 10;
      if (backup) this.saved = backup;
      if (slow) this._readSlow(slow);
      if (loot) {
        this.boxDown = new Map((loot[0] || []).map(i => [i, 0]));
        const d = loot[1] || [];
        this.drops = [];
        for (let i = 0; i + 2 < d.length; i += 3) this.drops.push({ id: d[i], x: d[i + 1] / 10, z: d[i + 2] / 10, t: 0 });
      }
      this.exfils.forEach((e, i) => {
        const n = sites?.[i] ?? 0;
        e.state = n & 7; e.timer = (n >> 3) & 1023; e.hold = ((n >> 13) & 127) / 10; e.holder = ((n >> 20) & 31) - 1; e.contested = !!(n & (1 << 25));
      });
      let k = 0;
      for (const s of this.squads.values()) {
        const c = s.contract, f = cons?.[k++];
        if (!c || !f) continue;
        c.state = f[0] & 15; c.prog = (f[1] ?? 0) / 1000; c.moving = c.contested = f[0] >= 16;
        if (f.length >= 4 && (c.type === 'intel' || c.type === 'escort')) { c.x = f[2] / 10; c.z = f[3] / 10; }
        c.def = (f[4] ?? 0) / 100;
        if (c.type === 'cache' && c.state === 1) c.fuse = (1 - c.prog) * EX.fuse;
      }
      this._players = players || [];
    }
    const players = this._players ?? [];
    for (let i = 0; i < out.players.length; i++) {
      const v = out.players[i], n = players[i] ?? 0;
      v.ai = !!sim.players[i]?.ai;
      if (v.ai) continue;
      v.downed = !!(n & 1); v.reviveK = ((n >> 1) & 15) / 15; v.out = !!(n & 32); v.carry = !!(n & 64);
    }
    return this.view();
  }

  _readSlow(slow) {
    const [ver, win, sq, stats, callers] = slow;
    (callers || []).forEach((c, i) => { if (this.exfils[i]) this.exfils[i].caller = c; });
    if (ver === this.readVer && this.squads.size) { /* same as before */ }
    this.readVer = ver;
    this.window = win;
    let k = 0;
    for (const s of this.squads.values()) {
      const e = sq?.[k++];
      if (!e) continue;
      [, s.lives, s.taken, s.extracted] = e;
      s.done = !!(e[4] & 1); s.wiped = !!(e[4] & 2);
      s.pot = (e[5] || []).map(unpackDone); s.banked = (e[6] || []).map(unpackDone);
      const c = e[7];
      if (!c) { s.contract = null; continue; }
      const type = T[c[1]];
      if (!s.contract || s.contract.id !== c[0]) s.contract = { id: c[0], team: s.team, type, tier: c[2], poi: c[3], x: c[4] / 10, z: c[5] / 10, state: 0, prog: 0, def: 0 };
      Object.assign(s.contract, { type, tier: c[2], poi: c[3], ax: c[4] / 10, az: c[5] / 10, dx: c[6] / 10, dz: c[7] / 10, carrier: c[8] });
    }
    this._stats = stats;
    (stats || []).forEach((st, i) => { const p = this.sim.players[i]; if (p && st) { p.ex ??= { reviveT: 0, knocks: 0, revives: 0 }; p.ex.revives = st[0]; p.ex.knocks = st[1]; } });
  }

  // ---- Host migration ----

  // What only the host knows: AI groups (with their seats), contract internals, squad timers, per-player down state,
  // exfil callers, the drop counter.
  backup() {
    const sim = this.sim;
    const groups = this.groups.filter(g => !g.wiped || g.members.length).map(g => [g.id, ['post', 'patrol', 'hvt', 'wave'].indexOf(g.kind), g.poi, Math.round(g.tough * 100), g.hq ? 1 : 0, g.size,
      ['asleep', 'calm', 'alert'].indexOf(g.state), g.members.map(q => q.index), g.wp, r1(g.alertX), r1(g.alertZ), Math.round(g.alertT), Math.round(g.respawnAt), g.waves, Math.round(g.waveAt),
      g.contract ?? -1, r1(g.x), r1(g.z), g.commanderDead ? 1 : 0, g.wiped ? 1 : 0, g.lost ?? 0]);
    const cons = [...this.squads.values()].map(s => {
      const c = s.contract;
      return c ? [c.id, Math.round((c.fuse ?? 0) * 10), Math.round(c.back * 10), c.pi ?? 0, c.group ?? -1, c.wave ? 1 : 0, Math.round(c.prog * 1000)] : 0;
    });
    const squads = [...this.squads.values()].map(s => [Math.round(s.nextAt * 10), s.lastType ? T.indexOf(s.lastType) : -1, Math.round((s.outAt ?? -1) * 10)]);
    const per = sim.players.map(p => (p.ex ? [Math.round(p.ex.reviveT * 10), p.ex.downedBy ? sim.byId.get(p.ex.downedBy)?.index ?? -1 : -1, p.ex.free ? 1 : 0, p.ex.out ? 1 : 0]
      : p.ai ? [p.exCommander ? 1 : 0, Math.round((p.exTake ?? 1) * 100), Math.round((p.exDeal ?? 1) * 100), Math.round((p.rating ?? 0.3) * 100)] : 0));
    return [this.gid, this.cid, this.dropId, groups, cons, squads, per, this.exfils.map(e => [e.caller, e.waved ? 1 : 0])];
  }

  // The new host rebuilds from its mirror (decode kept it current) and the last backup, stashed on the view.
  restore(view) {
    const sim = this.sim, obj = view.obj ?? view.points?.obj, old = obj?.rules ?? null;
    this.authority = true;
    this.started = true;
    if (old && old !== this) {
      this.t = old.t; this.window = old.window;
      this.exfils.forEach((e, i) => Object.assign(e, old.exfils[i] ?? {}));
      for (const [team, s] of this.squads) {
        const o = old.squads.get(team);
        if (!o) continue;
        Object.assign(s, { lives: o.lives, taken: o.taken, extracted: o.extracted, done: o.done, wiped: o.wiped, pot: o.pot.slice(), banked: o.banked.slice() });
        s.contract = o.contract ? { ...o.contract } : null;
      }
      this.boxDown = new Map([...old.boxDown.keys()].map(i => [i, this.t + EX.boxBack / 2]));
      this.drops = old.drops.map(d => ({ ...d, t: this.t }));
    }
    const bk = old?.saved ?? null;
    // Per player.
    sim.players.forEach((p, i) => {
      const v = view.players[i];
      if (!p.ai) {
        p.ex ??= { reviveT: 0, downedBy: null, knocks: 0, revives: 0, out: false, carry: false, free: false };
        p.ex.out = !!v?.out; p.ex.carry = !!v?.carry;
        p.downed = !!v?.downed && p.alive;
        if (p.downed) p.hp = Math.max(1, v.hp ?? BR.downHp);
        p.ex.reviveT = p.downed ? (v.reviveK ?? 0) * BR.reviveTime : 0;
        if (p.ex.out) p.alive = false;
        const st = old?._stats?.[i];
        if (st) { p.ex.revives = st[0]; p.ex.knocks = st[1]; }
      } else { p.exGroup = null; p.exFreeAt = 0; p.exTake = 1; p.exDeal = 1; }
    });
    this.groups = [];
    if (bk) {
      const [gid, cid, dropId, groups, cons, squads, per, exf] = bk;
      this.gid = gid; this.cid = cid; this.dropId = dropId;
      per.forEach((e, i) => {
        const p = sim.players[i];
        if (!p || !e) return;
        if (p.ex) { p.ex.downedBy = e[1] >= 0 ? sim.players[e[1]]?.id ?? null : null; p.ex.free = !!e[2]; }
        else if (p.ai) { p.exCommander = !!e[0]; p.exTake = e[1] / 100; p.exDeal = e[2] / 100; p.rating = e[3] / 100; }
      });
      for (const e of groups) {
        const def = this.groupDefs.find(d => d.poi === e[2] && ['post', 'patrol', 'hvt', 'wave'][e[1]] === d.kind) ?? {};
        const g = { ...def, id: e[0], kind: ['post', 'patrol', 'hvt', 'wave'][e[1]], poi: e[2], tough: e[3] / 100, hq: !!e[4], size: e[5], state: ['asleep', 'calm', 'alert'][e[6]], members: [],
          wp: e[8], alertX: e[9] / 10, alertZ: e[10] / 10, alertT: e[11], respawnAt: e[12], waves: e[13], waveAt: e[14], contract: e[15] >= 0 ? e[15] : null, x: e[16] / 10, z: e[17] / 10,
          commanderDead: !!e[18], wiped: !!e[19], lost: e[20], farT: 0 };
        g.spots ??= [{ x: g.x, z: g.z }]; g.route ??= [{ x: g.x, z: g.z }];
        for (const idx of e[7]) { const q = sim.players[idx]; if (q?.ai && q.alive) { q.exGroup = g; g.members.push(q); } }
        this.groups.push(g);
      }
      [...this.squads.values()].forEach((s, k) => {
        const e = squads[k];
        if (e) { s.nextAt = e[0] / 10; s.lastType = T[e[1]]; s.outAt = e[2] >= 0 ? e[2] / 10 : undefined; }
        const c = s.contract, ce = cons[k];
        if (c && ce && ce[0] === c.id) { c.fuse = ce[1] / 10; c.back = ce[2] / 10; c.pi = 0; c.path = null; c.group = ce[4] >= 0 ? ce[4] : undefined; c.wave = !!ce[5]; c.prog = ce[6] / 1000; }
        if (c) { c.team = s.team; c.back ??= 0; c.def ??= 0; if (c.type === 'escort') c.path = null; this.contracts.push(c); }
      });
      exf.forEach((e, i) => { if (this.exfils[i]) this.exfils[i].waved = !!e[1]; });     // Callers ride the full block.
    } else {
      for (const d of this.groupDefs) this._makeGroup({ ...d, state: 'asleep' });
    }
    // Groups not in the backup (made before the first backup) start asleep at their places.
    for (const d of this.groupDefs) if (!this.groups.some(g => g.poi === d.poi && g.kind === d.kind)) this._makeGroup({ ...d, state: 'asleep' });
    // Living AI nobody claimed (a backup a moment old) go quietly.
    for (const p of sim.players) if (p.ai && p.alive && !p.exGroup) { p.alive = false; p.hp = 0; }
    // An escort's asset walks again from where it stands; an hvt contract finds its group.
    for (const s of this.squads.values()) {
      const c = s.contract;
      if (c?.type === 'escort') { c.path = null; c.ax ??= c.x; c.az ??= c.z; }
      if (c?.type === 'hvt' && !this.groups.some(g => g.id === c.group)) {
        const g = this._makeGroup({ kind: 'hvt', poi: c.poi, size: 3, tough: 0.8, hq: false, spots: [{ x: c.x, z: c.z }], route: [], x: c.x, z: c.z, contract: c.id });
        c.group = g.id;
      }
      if (c?.type === 'intel' && c.carrier >= 0 && !sim.players[c.carrier]?.ex?.carry) { c.carrier = -1; c.state = 2; c.back = 60; }
    }
    this._dirty();
  }
}

export { AI_TEAM };
