// Breakthrough, the host side (mode 'bt', ROADMAP 65, docs/MODES.md "Conquest and Breakthrough"). 16 v 16: one side
// attacks through the layout's 3-4 sectors (js/shared/bf.js), the other defends. Only the current sector's 1-2
// objectives are live. They start the defenders'; attackers take one as in Conquest (neutral first), defenders can take
// it back, and the sector falls when the attackers hold all of its objectives at once. Then the next sector opens, the
// attackers' pool gets `refill` tickets and the clock starts again, and the defenders fall back: the fallen ground is out
// of bounds for them (BF.bt.fallBack s to get out), as the ground beyond the next line is for attackers all along.
//
// Attackers have a ticket pool (a death spends one); at zero they stop respawning and lose once the last is down.
// Defenders respawn freely. The sector clock (the mode's timeLimit, restarted for each sector) running out with no attacker on a live objective ends it
// for the defenders; with one on it, overtime runs until they are off or it falls. The last sector falling ends it for
// the attackers. sim.scores: the attackers' sectors taken, the defenders' sectors still standing.
//
// Events: {t:'bt', kind:'capture'|'neutral'|'retake'|'sector'|'overtime'|'low'|'end', id?, team?, sector?, reason?}.
// Medals: bt_capture, bt_sector (and the sim's own defend for kills on a held objective).
import { addScore } from './streaks.js';
import { BF, along, bfLayout, btAttackers, inArea, sectorBand } from '../shared/bf.js';
import { alive, closestBot, decodeStats, encodeStats, makeZones, packZone, restoreStats, unpackZone, zoneObjective } from './mode-kit.js';
import { bestSpot, faceTo, intoArea, sendBack, spawnSpots, stepBounds, stepFlag } from './bf-kit.js';
import { hqSpots } from './conquest.js';

const STATS = ['btCaps', 'oobDs'];
const REASONS = ['sectors', 'tickets', 'time'];

export class BreakthroughRules {
  constructor(sim, seed) {
    this.sim = sim;
    this.look = 'dom';
    this.allIn = true;
    this.ownSpawns = true;
    this.ownClock = true;
    const l = this.layout = bfLayout(sim.map, 'breakthrough', seed);
    this.att = btAttackers(seed);
    this.def = 1 - this.att;
    this.sector = 0;
    this.sectors = (l?.sectors ?? []).map(s => makeZones(s.objs).map(z => ({ ...z, by: -1, owner: this.def, cap: this.def ? 1 : -1 })));
    // The score limit is a percentage of the layout's pools (100 by default; Custom scales it).
    const k = (sim.scoreLimit ?? 100) / 100;
    this.refill = Math.max(10, Math.round((l?.refill ?? BF.bt.refill) * k));
    this.tickets = Math.max(10, Math.round((l?.tickets ?? BF.bt.tickets) * k));
    this.max = this.tickets;
    this.overtime = false;
    this.done = false;
    this.fellAt = -99;
    this.warned = false;
    this.reason = null;
    sim.points = this.sectors[0] ?? [];
    sim.timeLeft = sim.timeLimit;
    this.hq = (l?.hq ?? []).map(h => hqSpots(sim.map, h));
    this.area = null;           // Host: every spawn spot in the layout's area, built with the nav grid.
    this._sync();
  }

  get zones() { return this.sectors[this.sector] ?? []; }
  // Seconds before the sector's objectives open (after one falls). A guest reads it from the block.
  get lockLeft() { return this.authority === false ? this.lockWire : Math.max(0, BF.bt.lock - (this.sim.time - this.fellAt)); }
  get band() { return sectorBand(this.layout, Math.min(this.sector, this.sectors.length - 1)); }

  _sync() {
    const s = this.sim.scores, n = this.sectors.length;
    s[this.att] = this.sector; s[this.def] = n - this.sector;
  }

  // Where each side may stand: inside the area, attackers no further than the line ahead (plus a margin), defenders no
  // further back than the line behind.
  inside(p) {
    const l = this.layout, x = p.ps.x, z = p.ps.z;
    if (!inArea(l.area, x, z)) return false;
    const s = along(l, x, z), b = this.band;
    return p.team === this.att ? s <= b.hi + BF.bt.margin : s >= b.lo - BF.bt.margin;
  }

  // ---- Spawning ----
  spawnAll() {
    const sim = this.sim, l = this.layout, { dx, dz } = l.axis;
    // Defenders open behind sector one's objectives (no nav yet: spots by geometry, as an HQ's).
    const defSpots = this.sectors[0].flatMap(z => hqSpots(sim.map, { x: z.x + dx * 9, z: z.z + dz * 9, r: 7 }));
    for (const t of [this.att, this.def]) {
      const list = t === this.att ? this.hq[0] : defSpots, used = new Set();
      for (const p of sim.players) {
        if (p.team !== t || p.dummy || p.away) continue;
        let s = list[0];
        for (let k = 0; k < 24; k++) { s = list[Math.floor(sim.rng() * list.length)]; if (!used.has(s)) break; }
        used.add(s);
        sim._placeAt(p, s, this._face(s));
      }
    }
    return true;
  }

  _face(s) {
    let best = null, bd = Infinity;
    for (const z of this.zones) { const d = Math.hypot(z.x - s.x, z.z - s.z); if (d < bd) { bd = d; best = z; } }
    return best ? faceTo(s, best) : 0;
  }

  _spots() {
    if (!this.area && this.sim.nav) {
      const l = this.layout;
      this.area = spawnSpots(this.sim, l.area, [...l.hq, ...l.sectors.flatMap(s => s.objs)]);
      for (const s of this.area) s.a = along(l, s.x, s.z);
    }
    return this.area;
  }

  respawn(p) {
    const sim = this.sim, l = this.layout, b = this.band, sec = l.sectors[Math.min(this.sector, l.sectors.length - 1)];
    const all = this._spots() ?? [];
    let spots;
    if (p.team === this.att) {
      // Short of the sector's nearest objective (and never past the line behind it): the attack starts close enough
      // to matter on a big island part, and from the HQ as well in sector one.
      const [n0, n1] = BF.bt.attackBand;
      spots = all.filter(s => s.a >= sec.min - n1 && s.a <= Math.min(sec.min - n0, b.lo));
      if (this.sector === 0) spots = spots.concat(this.hq[0]);
      if (!spots.length) spots = this.hq[0];
    } else {
      // Behind the objectives and clear of them, so a defence has to be walked back into, not spawned onto.
      const last = this.sector >= l.sectors.length - 1, [d0, d1] = BF.bt.defendBand;
      spots = all.filter(s => s.a >= sec.max + d0 && s.a <= (last ? Infinity : Math.max(b.hi, sec.max + d0) + d1)
        && this.zones.every(z => (s.x - z.x) ** 2 + (s.z - z.z) ** 2 > BF.bt.clear * BF.bt.clear));
      if (last) spots = spots.concat(this.hq[1]);
      if (!spots.length) spots = this.hq[1];
    }
    const near = this.zones[Math.floor(sim.rng() * this.zones.length)];
    const s = bestSpot(sim, p, spots, near);
    sim._placeAt(p, s, this._face(s));
    return true;
  }

  holdDead(p) { return p.team === this.att && this.tickets <= 0; }

  // ---- Rules ----
  step(dt) {
    const sim = this.sim;
    if (this.done) return;
    let pushing = false;
    const locked = sim.time - this.fellAt < BF.bt.lock;
    for (const z of this.zones) {
      const n = sim._countIn(z);
      const what = locked ? null : stepFlag(z, n, dt, BF.bt.capture);
      if (locked) z.contested = n[0] > 0 && n[1] > 0;
      if (what) this._flagEvent(z, what);
      if (n[this.att] > 0 && z.owner !== this.att) pushing = true;
    }
    if (this.zones.length && this.zones.every(z => z.owner === this.att)) { this._fall(); if (this.done) return; }
    stepBounds(sim, dt, p => this.inside(p), p => (p.team === this.def && sim.time - this.fellAt < BF.bt.fallBack + 2 ? BF.bt.fallBack : BF.oob));
    // The sector clock; overtime while attackers stand on a live objective.
    if (sim.timeLeft > 0) sim.timeLeft = Math.max(0, sim.timeLeft - dt);
    if (sim.timeLeft <= 0) {
      if (pushing && this.tickets + alive(sim, this.att) > 0) {
        if (!this.overtime) { this.overtime = true; sim._emit({ t: 'bt', kind: 'overtime' }); }
      } else { this._end(this.def, 'time'); return; }
    } else this.overtime = false;
    if (this.tickets <= 0 && alive(sim, this.att) === 0) this._end(this.def, 'tickets');
  }

  _flagEvent(z, what) {
    const sim = this.sim, team = z.by, att = team === this.att;
    if (what === 'capture' && att) {
      for (const p of sim.players) {
        if (p.team !== team || !sim._onZone(p, z)) continue;
        p.btCaps = (p.btCaps ?? 0) + 1; addScore(p.score, BF.bt.capScore); sim._medal(p, 'bt_capture');
      }
    } else if (what === 'capture') for (const p of sim.players) if (p.team === team && sim._onZone(p, z)) addScore(p.score, BF.bt.capScore / 2);
    sim._emit({ t: 'bt', kind: what === 'capture' && !att ? 'retake' : what, id: z.id, team });
  }

  _fall() {
    const sim = this.sim, done = this.zones;
    for (const p of sim.players) {
      if (p.team !== this.att || !p.alive) continue;
      if (done.some(z => Math.hypot(p.ps.x - z.x, p.ps.z - z.z) <= z.r + 12)) { addScore(p.score, BF.bt.sectorScore); sim._medal(p, 'bt_sector'); }
    }
    this.sector++;
    this.fellAt = sim.time;
    this.overtime = false;
    this._sync();
    if (this.sector >= this.sectors.length) { this._end(this.att, 'sectors'); return; }
    this.tickets += this.refill;
    this.max = Math.max(this.max, this.tickets);
    this.warned = false;
    sim.points = this.zones;
    sim.timeLeft = sim.timeLimit;
    sim._emit({ t: 'bt', kind: 'sector', sector: this.sector, tickets: this.tickets, team: this.att });
  }

  _end(winner, reason) {
    if (this.done) return;
    this.done = true;
    this.reason = reason;
    const sim = this.sim;
    sim._emit({ t: 'bt', kind: 'end', team: winner, reason, sector: this.sector });
    sim.lastKill = null;
    sim._end(winner);
  }

  onKill(target, killer, info) {
    if (info?.away || this.sim.phase !== 'live' || this.done) return;
    if (target.team === this.def) { target.respawnT += BF.bt.defendDelay; return; }
    this.tickets = Math.max(0, this.tickets - 1);
    if (!this.warned && this.tickets <= BF.bt.low) { this.warned = true; this.sim._emit({ t: 'bt', kind: 'low', team: this.att, n: this.tickets }); }
  }

  // ---- Bots ----
  // Attackers: everyone on the sector, spread over the objectives still to take, a few holding one already taken.
  // Defenders: split over the objectives, more where attackers are taking one, long guns covering from behind; an
  // objective lost sends most of them back to retake it. Either side out of bounds walks back first.
  plan(team, crew) {
    const sim = this.sim, l = this.layout, free = new Set(crew), att = team === this.att, b = this.band;
    for (const bot of crew) {
      const s = along(l, bot.ps.x, bot.ps.z);
      const out = (l.sub && !inArea(l.area, bot.ps.x, bot.ps.z, -3)) || (att ? s > b.hi + BF.bt.margin - 4 : s < b.lo - BF.bt.margin + 4);
      if (!out) continue;
      const to = att ? Math.min(s, b.hi - 4) : Math.max(s, b.lo + 6);
      const at = intoArea(l.area, bot.ps.x + l.axis.dx * (to - s), bot.ps.z + l.axis.dz * (to - s), 8);
      sendBack(bot, at.x, at.z); free.delete(bot);
    }
    const zones = this.zones;
    if (!zones.length) return;
    const load = new Map();
    // Facing the other side's end; an attacker close to the objective (or a defender retaking one) pushes on to it
    // shooting on the move instead of stopping for every trade (commit), which is how a sector is ever taken.
    const l2 = this.layout.axis, face = att ? Math.atan2(l2.dz, l2.dx) : Math.atan2(-l2.dz, -l2.dx);
    const assign = (bot, z, role, tag = '') => {
      const o = zoneObjective(z, role, tag);
      o.aim = face;
      if ((role === 'attack') && Math.hypot(z.x - bot.ps.x, z.z - bot.ps.z) < BF.bt.push) { o.commit = true; o.key += 'c'; }
      bot.setObjective(o); free.delete(bot); load.set(z, (load.get(z) ?? 0) + 1);
    };
    if (att) {
      const held = zones.filter(z => z.owner === this.att), open = zones.filter(z => z.owner !== this.att);
      for (const z of held) for (let k = 0; k < (open.length ? 2 : 4); k++) { const bot = closestBot(free, z.x, z.z); if (bot) assign(bot, z, 'defend'); }
      const targets = open.length ? open : zones;
      for (const bot of [...free]) {
        let best = targets[0], bc = Infinity;
        for (const z of targets) {
          const c = Math.hypot(z.x - bot.ps.x, z.z - bot.ps.z) + (load.get(z) ?? 0) * (3 + bot.S.objSplit);
          if (c < bc) { bc = c; best = z; }
        }
        assign(bot, best, 'attack');
      }
      return;
    }
    const lost = zones.filter(z => z.owner !== this.def);
    const hot = zones.filter(z => z.owner === this.def && (z.contested || Math.abs(z.cap) < 0.97));
    // Lost objectives: most of the side goes to take it back.
    for (const z of lost) for (let k = 0; k < Math.ceil(crew.length * 0.6 / lost.length); k++) { const bot = closestBot(free, z.x, z.z); if (bot) assign(bot, z, 'attack', 'retake'); }
    for (const z of hot) for (let k = 0; k < 4; k++) { const bot = closestBot(free, z.x, z.z); if (bot) assign(bot, z, 'defend'); }
    // Long guns cover from behind the objectives.
    const heavies = [...free].filter(q => q.S.objDefend > 0).sort((x, y) => y.style.hold - x.style.hold).slice(0, Math.min(4, Math.floor(free.size / 4)));
    heavies.forEach((bot, i) => assign(bot, zones[i % zones.length], 'support'));
    for (const bot of [...free]) {
      let best = zones[0], bc = Infinity;
      for (const z of zones) {
        const c = (load.get(z) ?? 0) * 6 + Math.hypot(z.x - bot.ps.x, z.z - bot.ps.z) * 0.3;
        if (c < bc) { bc = c; best = z; }
      }
      assign(bot, best, 'defend');
    }
  }

  // ---- View and wire ----
  view() {
    return {
      kind: 'bt', bf: true, layout: this.layout, att: this.att, sector: this.sector, sectors: this.sectors.length,
      tickets: this.tickets, max: this.max, overtime: this.overtime, done: this.done, reason: this.reason,
      lock: this.lockLeft,
      ids: this.zones.map(z => z.id),
    };
  }

  playerView(p, v) { v.btCaps = p.btCaps ?? 0; v.oob = p.oob ?? null; }

  // [sector, tickets, max, flags (overtime 1, done 2), reason, lock ds, packed zone..., stats...]
  encode() {
    for (const p of this.sim.players) p.oobDs = p.oob != null ? Math.max(1, Math.ceil(p.oob * 10)) : 0;
    const out = [this.sector, this.tickets, this.max, (this.overtime ? 1 : 0) | (this.done ? 2 : 0), REASONS.indexOf(this.reason) + 1, Math.ceil(this.lockLeft * 10), ...this.zones.map(packZone)];
    return encodeStats(out, this.sim.players, STATS);
  }

  decode(a, out, host = false) {
    if (!host && a) this._setSector(Math.min(a[0], this.sectors.length));
    decodeStats(a, 6 + this.zones.length, out.players, STATS);
    for (const v of out.players) v.oob = v.oobDs ? v.oobDs / 10 : null;
    if (!host && a) {
      this.authority = false;
      this.tickets = a[1]; this.max = a[2]; this.overtime = !!(a[3] & 1); this.done = !!(a[3] & 2); this.reason = REASONS[a[4] - 1] ?? null;
      this.lockWire = a[5] / 10;
      this.zones.forEach((z, i) => unpackZone(z, a[6 + i]));
    }
    for (const z of this.zones) out.points.push(this.sim._pointView(z, z.owner, z.cap, z.contested));
    return this.view();
  }

  // Jumps the sector (a guest catching up, a new host): every sector before it is the attackers'.
  _setSector(i) {
    if (i === this.sector) return;
    if (i > this.sector) this.fellAt = this.sim.time;
    this.sector = i;
    this.sectors.forEach((list, k) => {
      if (k < i) for (const z of list) { z.owner = this.att; z.cap = this.att ? 1 : -1; z.contested = false; }
    });
    this.sim.points = this.zones;
    this._sync();
  }

  restore(view) {
    restoreStats(this.sim, view, ['btCaps']);
    const o = view.obj ?? view.points?.obj;
    if (!o) return;
    this._setSector(o.sector);
    this.tickets = o.tickets; this.max = o.max; this.overtime = o.overtime; this.done = o.done; this.reason = o.reason;
    this.fellAt = this.sim.time - (BF.bt.lock - (o.lock ?? 0));
    for (const pt of view.points ?? []) {
      const z = this.zones.find(q => q.id === pt.id);
      if (z) { z.owner = pt.owner; z.cap = pt.capture; z.contested = !!pt.contested; }
    }
    this.warned = this.tickets <= BF.bt.low;
    this._sync();
  }
}
