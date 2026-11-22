// Conquest, the host side (mode 'cq', ROADMAP 65, docs/MODES.md "Conquest and Breakthrough"). 16 v 16 over the
// layout's 5-7 flags (js/shared/bf.js). Each side has a pool of tickets: a death spends one, and while a side holds more
// flags than the other, the other's pool bleeds (faster the bigger the lead). A pool at zero loses; at the clock, more
// tickets wins. Flags start neutral; whoever has more players on one moves it their way (stepFlag in bf-kit.js), a
// held flag going neutral before it changes hands. sim.scores are tickets left (rounded up).
//
// Spawns: your HQ or any flag your side holds fully and nobody is fighting over. A phone picks one on the death screen
// ({cmd:'bf', act:'deploy', at: flag id | 'hq' | null for the front}); bots pick the held flag nearest where they were
// sent. On a part of a battle royale island the layout's area is the field: outside it is out of bounds (BF.oob s).
//
// Events: {t:'cq', kind:'capture'|'neutral'|'low'|'all', id?, team}. Medals: cq_capture, cq_neutral (and the sim's
// own defend for kills on or near a held flag).
import { addScore } from './streaks.js';
import { BF, bfLayout, inArea } from '../shared/bf.js';
import { wallsInBox, wallScratch } from '../shared/geometry.js';
import { closestBot, decodeStats, encodeStats, makeZones, packZone, restoreStats, unpackZone, zoneObjective } from './mode-kit.js';
import { bestSpot, faceTo, intoArea, sendBack, spawnSpots, stepBounds, stepFlag } from './bf-kit.js';

const STATS = ['cqCaps', 'oobDs'];
let _scratch = null;

// Up to 16 spots round an HQ that no wall covers, in a fixed order (no nav needed: the opening places everyone before
// the nav grid exists, on guests too).
export function hqSpots(map, hq) {
  if (hq.spawns?.length) return hq.spawns;
  const out = [];
  for (let ring = 0; ring < 4 && out.length < 16; ring++) {
    const r = ring * Math.max(1.6, hq.r / 4), n = ring ? 6 + ring * 2 : 1;
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2 + ring * 0.5, x = hq.x + Math.cos(a) * r, z = hq.z + Math.sin(a) * r;
      if (x < 1 || z < 1 || x > map.width - 1 || z > map.height - 1) continue;
      _scratch = wallScratch(map, _scratch);
      const c = wallsInBox(map, x - 0.7, z - 0.7, x + 0.7, z + 0.7, _scratch);
      let free = true;
      for (let i = 0; i < c && free; i++) {
        const w = map.walls[_scratch[i]];
        if (w.blocksMove && x > w.x - 0.6 && x < w.x + w.w + 0.6 && z > w.z - 0.6 && z < w.z + w.d + 0.6) free = false;
      }
      if (free) out.push({ x, z });
    }
  }
  return out.length ? out : [{ x: hq.x, z: hq.z }];
}

export class ConquestRules {
  constructor(sim, seed) {
    this.sim = sim;
    this.look = 'dom';
    this.allIn = true;
    this.ownSpawns = true;
    const l = this.layout = bfLayout(sim.map, 'conquest', seed);
    this.zones = makeZones(l?.flags ?? []).map(z => ({ ...z, by: -1 }));
    sim.points = this.zones;
    // A custom score limit scales the pool (the mode's own limit is the nominal 300). sim.scoreLimit stays nominal: a
    // new host is built with the snapshot's, and scaling twice would double the pool.
    this.max = Math.max(20, Math.round((l?.tickets ?? 300) * (sim.scoreLimit ?? 300) / 300));
    this.tickets = [this.max, this.max];
    this.warned = [false, false];
    this.allBy = -1;            // The side holding every flag, once announced.
    this.hq = (l?.hq ?? []).map(h => hqSpots(sim.map, h));
    this.spots = null;          // Host: flag spawn rings, built with the nav grid.
    this._sync();
  }

  _sync() { for (let t = 0; t < 2; t++) this.sim.scores[t] = Math.max(0, Math.ceil(this.tickets[t] - 1e-6)); }

  get owned() {
    const c = [0, 0];
    for (const z of this.zones) if (z.owner === 0 || z.owner === 1) c[z.owner]++;
    return c;
  }

  // ---- Spawning ----
  spawnAll() {
    const sim = this.sim;
    for (let t = 0; t < 2; t++) {
      const list = this.hq[t] ?? [], used = new Set();
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
    for (const z of this.zones) { const d = Math.hypot(z.x - s.x, z.z - s.z); if (d < bd && z.owner === -1 || d < bd * 0.5) { bd = d; best = z; } }
    return faceTo(s, best ?? { x: this.sim.map.width / 2, z: this.sim.map.height / 2 });
  }

  _flagSpots() {
    if (this.spots || !this.sim.nav) return this.spots;
    const l = this.layout, [r0, r1] = BF.cq.flagSpawn;
    const all = spawnSpots(this.sim, l.area, [...l.hq, ...l.flags]);
    this.spots = this.zones.map(z => all.filter(s => { const d = Math.hypot(s.x - z.x, s.z - z.z); return d >= Math.max(r0, z.r + 1) && d <= r1; }));
    return this.spots;
  }

  // A flag a side may spawn on: held outright, nobody of the other side on it.
  canDeploy(z, team) {
    if (z.owner !== team || z.contested || z.cap * (team ? 1 : -1) < 0.99) return false;
    const r2 = BF.cq.safe * BF.cq.safe;
    for (const q of this.sim.players) if (q.team !== team && q.alive && (q.ps.x - z.x) ** 2 + (q.ps.z - z.z) ** 2 < r2) return false;
    return true;
  }

  // The flag p would spawn at with no pick of its own: the held one nearest `target` (where a bot was sent), or for a
  // human the front (the held flag nearest a flag the side does not hold). null: the HQ is nearer.
  _auto(p) {
    const team = p.team, hq = this.layout.hq[team];
    let target = p.bot?.objective ?? null;
    if (!target) {
      let bd = Infinity;
      for (const z of this.zones) if (z.owner !== team) { const d = Math.hypot(z.x - hq.x, z.z - hq.z); if (d < bd) { bd = d; target = z; } }
    }
    if (!target) return null;
    let best = null, bd = Math.hypot(hq.x - target.x, hq.z - target.z);
    for (const z of this.zones) {
      if (!this.canDeploy(z, team)) continue;
      const d = Math.hypot(z.x - target.x, z.z - target.z);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }

  respawn(p) {
    const sim = this.sim;
    let z = null;
    if (!p.isBot && p.deploy && p.deploy !== 'hq') z = this.zones.find(q => q.id === p.deploy && this.canDeploy(q, p.team)) ?? this._auto(p);
    else if (p.isBot || !p.deploy) z = this._auto(p);
    const i = z ? this.zones.indexOf(z) : -1, spots = i >= 0 ? this._flagSpots()?.[i] : null;
    const s = spots?.length ? bestSpot(sim, p, spots) : bestSpot(sim, p, this.hq[p.team]);
    sim._placeAt(p, s, this._face(s));
    if (z) sim._emit({ t: 'cq', kind: 'deploy', id: z.id, who: p.id });
    return true;
  }

  command(p, msg) {
    if (!p || msg.act !== 'deploy') return false;
    const at = typeof msg.at === 'string' ? msg.at : null;
    p.deploy = at === 'hq' || this.zones.some(z => z.id === at) ? at : null;
    return true;
  }

  // ---- Rules ----
  step(dt) {
    const sim = this.sim;
    for (const z of this.zones) {
      const what = stepFlag(z, sim._countIn(z), dt);
      if (what) this._flagEvent(z, what);
    }
    const c = this.owned, lead = c[0] - c[1];
    if (lead !== 0) {
      const loser = lead > 0 ? 1 : 0, edge = Math.abs(lead);
      let rate = BF.cq.bleed[Math.min(edge, BF.cq.bleed.length - 1)];
      if (c[loser] === 0 && c[1 - loser] === this.zones.length) rate += BF.cq.allBleed;
      this.tickets[loser] = Math.max(0, this.tickets[loser] - rate * dt);
    }
    const all = c[0] === this.zones.length ? 0 : c[1] === this.zones.length ? 1 : -1;
    if (all !== this.allBy) { this.allBy = all; if (all >= 0) sim._emit({ t: 'cq', kind: 'all', team: all }); }
    if (this.layout?.sub) stepBounds(sim, dt, p => inArea(this.layout.area, p.ps.x, p.ps.z), () => BF.oob);
    this._sync();
    for (let t = 0; t < 2; t++) {
      if (!this.warned[t] && this.tickets[t] <= BF.cq.low) { this.warned[t] = true; sim._emit({ t: 'cq', kind: 'low', team: t }); }
    }
    for (let t = 0; t < 2; t++) if (this.tickets[t] <= 0) { sim.lastKill = null; sim._end(1 - t); return; }
  }

  _flagEvent(z, what) {
    const sim = this.sim, team = z.by;
    for (const p of sim.players) {
      if (p.team !== team || !sim._onZone(p, z)) continue;
      if (what === 'capture') { p.cqCaps = (p.cqCaps ?? 0) + 1; addScore(p.score, BF.cq.capScore); sim._medal(p, 'cq_capture'); }
      else { addScore(p.score, BF.cq.neutralScore); sim._medal(p, 'cq_neutral'); }
    }
    sim._emit({ t: 'cq', kind: what, id: z.id, team });
  }

  onKill(target, killer, info) {
    if (info?.away || this.sim.phase !== 'live') return;
    this.tickets[target.team] = Math.max(0, this.tickets[target.team] - BF.cq.death);
    this._sync();
  }

  timeUp() {
    const [a, b] = this.tickets;
    return Math.abs(a - b) < 0.5 ? null : a > b ? 0 : 1;
  }

  // ---- Bots ----
  // Under-attack flags first (two or three go back), a small quota keeps the calm ones, and the rest spread over the
  // flags the side does not hold: nearest first, but each flag's load costs, so a 16-strong side takes three or four
  // at once instead of rolling one blob around the map. Holding everything, half hunt and half sit on the flags.
  plan(team, crew) {
    const sim = this.sim, l = this.layout, free = new Set(crew), sign = team ? 1 : -1;
    // Out of bounds (or nearly): back in before anything else.
    if (l.sub) {
      for (const b of crew) {
        if (inArea(l.area, b.ps.x, b.ps.z, -3)) continue;
        const at = intoArea(l.area, b.ps.x, b.ps.z, 10);
        sendBack(b, at.x, at.z); free.delete(b);
      }
    }
    const zones = this.zones;
    const owned = zones.filter(z => z.owner === team);
    const threatened = owned.filter(z => z.contested || z.cap * sign < 0.97);
    const load = new Map();
    const assign = (b, z, role) => { b.setObjective(zoneObjective(z, role)); free.delete(b); load.set(z, (load.get(z) ?? 0) + 1); };
    for (const z of threatened) {
      for (let k = 0; k < 3; k++) {
        const b = closestBot([...free].filter(q => Math.hypot(q.ps.x - z.x, q.ps.z - z.z) < 70), z.x, z.z);
        if (b) assign(b, z, 'defend');
      }
    }
    let quota = Math.round(crew.reduce((s, b) => s + b.S.objDefend, 0) * 0.6);
    for (const z of owned) {
      if (quota <= 0) break;
      if (load.get(z)) continue;
      const b = closestBot([...free].filter(q => q.S.objDefend > 0), z.x, z.z);
      if (b) { assign(b, z, 'defend'); quota--; }
    }
    const targets = zones.filter(z => z.owner !== team);
    if (!targets.length) {
      let k = 0;
      for (const b of free) {
        if (k++ % 2) b.setObjective(null);
        else b.setObjective(zoneObjective(owned[k % owned.length], 'defend'));
      }
      return;
    }
    const per = Math.ceil(free.size / Math.min(targets.length, 3)) + 1;
    for (const b of [...free]) {
      let best = null, bc = Infinity;
      for (const z of targets) {
        const n = load.get(z) ?? 0;
        if (n >= per) continue;
        // Neutral flags are quicker to take; a flag the other side is taking from us is urgent.
        const cost = Math.hypot(z.x - b.ps.x, z.z - b.ps.z) + n * (4 + b.S.objSplit * 1.5) + (z.owner === 1 - team ? 8 : 0);
        if (cost < bc) { bc = cost; best = z; }
      }
      if (best) assign(b, best, 'attack');
      else b.setObjective(zoneObjective(targets[0], 'attack'));
    }
  }

  // ---- View and wire ----
  view() {
    const c = this.owned;
    return {
      kind: 'cq', bf: true, layout: this.layout, tickets: this.tickets.map(t => Math.max(0, Math.ceil(t - 1e-6))), max: this.max, owned: c,
      bleed: c[0] === c[1] ? -1 : c[0] > c[1] ? 1 : 0,
    };
  }

  playerView(p, v) { v.cqCaps = p.cqCaps ?? 0; v.oob = p.oob ?? null; }

  // [tickets0 ds, tickets1 ds, packed zone..., stats...]
  encode() {
    for (const p of this.sim.players) p.oobDs = p.oob != null ? Math.max(1, Math.ceil(p.oob * 10)) : 0;
    const out = [Math.round(this.tickets[0] * 10), Math.round(this.tickets[1] * 10), ...this.zones.map(packZone)];
    return encodeStats(out, this.sim.players, STATS);
  }

  decode(a, out, host = false) {
    decodeStats(a, 2 + this.zones.length, out.players, STATS);
    for (const v of out.players) v.oob = v.oobDs ? v.oobDs / 10 : null;
    // The host's own state is the truth: the block's rounded tickets and capture stay out of it (see HqRules.decode).
    if (!host && a) {
      this.tickets = [a[0] / 10, a[1] / 10];
      this.zones.forEach((z, i) => unpackZone(z, a[2 + i]));
      this._sync();
    }
    for (const z of this.zones) out.points.push(this.sim._pointView(z, z.owner, z.cap, z.contested));
    return this.view();
  }

  restore(view) {
    restoreStats(this.sim, view, ['cqCaps']);
    const o = view.obj ?? view.points?.obj;
    if (!o) return;
    this.tickets = o.tickets.slice();
    this.max = o.max ?? this.max;
    for (const pt of view.points ?? []) {
      const z = this.zones.find(q => q.id === pt.id);
      if (z) { z.owner = pt.owner; z.cap = pt.capture; z.contested = !!pt.contested; }
    }
    this.allBy = -1;
    this.warned = this.tickets.map(t => t <= BF.cq.low);
    this._sync();
  }
}
