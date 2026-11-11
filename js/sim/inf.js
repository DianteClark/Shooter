// Infected, the host side (mode 'inf'). When the match goes live one player in twelve is infected (team 1) and everyone else is
// a survivor (team 0), whatever side they started on. A survivor who dies for any reason joins the infected and
// respawns as one. The infected carry the Gaff with Shivs to throw, and come back quickly; survivors
// keep their own guns without scorestreaks. Survivors win if any of them are left when the clock runs out; the
// infected win the moment the last one falls. sim.scores are [survivors, infected], counted live.
//
// Teams change mid-match here, and only here. Every change is a {t:'team', id, team} event, emitted before the spawn
// that follows it, so a phone deals its own player the right kit (Sim.dealFor) and a guest's snapshot codec keeps up;
// the snapshot block carries the whole list as well.
//
// Events: {t:'inf', kind:'first'|'infected'|'last', id, by?}. Medals: infect, first_infected, last_stand, survivor.
import { addScore } from './streaks.js';
import { MODES } from '../shared/modes.js';
import { alive, chaseObjective, decodeStats, encodeStats, restoreStats, zoneObjective, makeZones } from './mode-kit.js';

export const INF = { perFirst: 12, alpha: 0.5, respawn: 2.5, tick: 10, tickScore: 25, infectScore: 100, surviveScore: 500, regroup: 35 };
const STATS = ['infections', 'survived'];
const KIT = { primary: 'knife', secondary: 'knife', lethal: 'shiv', tactical: 'smoke', attachments: {}, perks: ['marathon', 'fasthands', 'deadsilence'], pro: [], streaks: [] };

export class InfRules {
  constructor(sim, seed) {
    this.sim = sim;
    // A mode's own numbers on top of INF (Ground War Infected: `firsts` infected at the start, see MODES.gwinf.inf).
    this.k = { ...INF, ...(MODES[sim.modeId]?.inf ?? {}) };
    this.allIn = true;
    this.started = false;
    this.first = null;
    this.last = null;
    this.tickT = this.k.tick;
    this.camp = 0; this.campT = 0;         // Survivor bots' hold: an index into the map's hardpoint zones.
    this.spots = makeZones(sim.map.points?.hard?.length ? sim.map.points.hard : sim.map.points?.dom);
  }

  // Survivors keep their guns but carry no streaks; the infected get blades.
  kit(team, l) {
    if (team === 1) return { ...l, ...KIT, camo: l.camos?.knife ?? 'none' };
    return { ...l, streaks: [] };
  }

  onLive() {
    if (this.started) return;
    const sim = this.sim, pool = sim.players.filter(p => !p.dummy && !p.away);
    this.started = true;
    for (const p of pool) if (p.team !== 0) this._setTeam(p, 0);
    // One infected for every this.k.perFirst players; at least one.
    const n = Math.max(1, Math.min(pool.length - 1, this.k.firsts ?? Math.round(pool.length / this.k.perFirst)));
    for (let k = 0; k < n; k++) {
      const left = pool.filter(p => p.team === 0);
      const first = left[Math.floor(sim.rng() * left.length)];
      if (!first) break;
      this._infect(first, null);
      this.first ??= first;
      sim._emit({ t: 'inf', kind: 'first', id: first.id });
      sim._medal(first, 'first_infected');
      sim._respawn(first);
    }
    this._count();
  }

  _setTeam(p, team) {
    const sim = this.sim;
    p.team = team;
    p.loadout = sim._deal(team, p.loadout);
    p.pendingLoadout = null;
    p.primary = p.loadout.primary; p.camo = p.loadout.camo;
    sim._metaUntil = sim.tick + 2;
    sim._emit({ t: 'team', id: p.id, team });
  }

  _infect(p, by) {
    this._setTeam(p, 1);
    if (by) this.sim._emit({ t: 'inf', kind: 'infected', id: p.id, by: by.id });
  }

  _count() {
    const sim = this.sim;
    let s = 0, i = 0;
    for (const p of sim.players) { if (p.dummy || p.away) continue; if (p.team === 0) s++; else i++; }
    sim.scores[0] = s; sim.scores[1] = i;
    return s;
  }

  step(dt) {
    const sim = this.sim;
    if (!this.started) return;
    // The infected all left: someone has to carry it on.
    if (!sim.players.some(p => p.team === 1 && !p.away && !p.dummy)) {
      const pool = sim.players.filter(p => p.team === 0 && !p.away && !p.dummy);
      if (pool.length > 1) { const p = pool[Math.floor(sim.rng() * pool.length)]; this._infect(p, null); sim._emit({ t: 'inf', kind: 'first', id: p.id }); sim._respawn(p); }
    }
    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT += this.k.tick;
      for (const p of sim.players) if (p.team === 0 && p.alive) addScore(p.score, this.k.tickScore);
    }
    const left = this._count();
    if (left === 0 && sim.phase === 'live') { sim.lastKill ??= null; sim._end(1); }
  }

  // Ground War Infected: the infected come back at a spawn about `spawnNear` metres from the nearest survivor, not across
  // a huge map from them (the sim's own score already favours distance: this caps it).
  spawnFlow(p, s) {
    const near = this.k.spawnNear;
    if (!near || p.team !== 1 || !this.started) return 0;
    let d = Infinity;
    for (const q of this.sim.players) if (q.team === 0 && q.alive) d = Math.min(d, Math.hypot(q.ps.x - s.x, q.ps.z - s.z));
    return d === Infinity ? 0 : -2 * Math.max(0, Math.min(d, 200) - near);
  }

  // While the infection is down to its first players (one, or the mode's `firsts` or `alphaUntil`), they (the alphas) takes this.k.alpha of the damage: a lone blade against
  // eleven guns would rarely get going.
  damage(target, attacker, dmg) {
    return target.team === 1 && this.started && this.sim.scores[1] <= (this.k.alphaUntil ?? this.k.firsts ?? 1) ? dmg * this.k.alpha : dmg;
  }

  onKill(target, killer, info) {
    const sim = this.sim;
    if (target.team === 1) { target.respawnT = Math.min(target.respawnT, this.k.respawn); return; }
    if (info.away || !this.started) { this._count(); return; }
    // A survivor down: infected, by whoever did it (a fall or their own grenade still counts).
    const by = killer && killer.team === 1 ? killer : null;
    if (by) { by.infections = (by.infections ?? 0) + 1; addScore(by.score, this.k.infectScore); sim._medal(by, 'infect'); }
    this._infect(target, by ?? target);
    target.respawnT = this.k.respawn + 1;
    const left = this._count();
    if (left === 1 && !this.last) {
      this.last = sim.players.find(p => p.team === 0 && !p.away && !p.dummy) ?? null;
      if (this.last) sim._emit({ t: 'inf', kind: 'last', id: this.last.id });
    }
    if (left === 0) sim._end(1);
  }

  // The clock ran out with survivors standing: they win, and each one alive is paid.
  timeUp() {
    const sim = this.sim, left = this._count();
    if (!left) return 1;
    for (const p of sim.players) {
      if (p.team !== 0 || p.away || p.dummy) continue;
      p.survived = 1;
      addScore(p.score, this.k.surviveScore);
      sim._medal(p, p === this.last ? 'last_stand' : 'survivor');
    }
    return 0;
  }

  // ---- Bots: survivors pick a hold and stack it, moving on every so often; the infected run down the nearest. ----
  plan(team, crew) {
    const sim = this.sim;
    if (!this.started) return;
    if (team === 1) {
      const prey = sim.players.filter(p => p.team === 0 && p.alive);
      for (const b of crew) {
        let best = null, bd = Infinity;
        for (const q of prey) { const d = Math.hypot(q.ps.x - b.ps.x, q.ps.z - b.ps.z); if (d < bd) { bd = d; best = q; } }
        b.setObjective(best ? chaseObjective(sim, `prey${best.index}`, best.ps.x, best.ps.z, 'attack', true) : null);
      }
      return;
    }
    if (!this.spots.length) { for (const b of crew) b.setObjective(null); return; }
    // `holds` groups (Ground War: thirty survivors stacked on one spot would never fall), split by player index.
    const g = Math.max(1, Math.min(this.k.holds ?? 1, this.spots.length));
    if (sim.time - this.campT > this.k.regroup) {
      // Each group: the hold nearest its middle that is not the one it just left nor another group's.
      const camps = this.camps ?? [this.camp], taken = new Set();
      for (let k = 0; k < g; k++) {
        let x = 0, z = 0, n = 0;
        for (const p of sim.players) if (p.team === 0 && p.alive && (g === 1 || p.index % g === k)) { x += p.ps.x; z += p.ps.z; n++; }
        let best = camps[k] ?? this.camp;
        if (n) {
          let bd = Infinity;
          this.spots.forEach((s, i) => {
            if (taken.has(i)) return;
            const d = Math.hypot(s.x - x / n, s.z - z / n) + (i === camps[k] && this.campT > 0 ? 30 : 0);
            if (d < bd) { bd = d; best = i; }
          });
        }
        taken.add(best); camps[k] = best;
      }
      this.camps = camps; this.camp = camps[0];
      this.campT = sim.time;
    }
    for (const b of crew) {
      const k = g === 1 ? 0 : b.p.index % g, spot = this.spots[this.camps?.[k] ?? this.camp];
      b.setObjective(zoneObjective(spot, 'defend', `camp${k}`));
    }
  }

  // ---- View and wire ----
  view() {
    return { kind: 'inf', started: this.started, first: this.first?.id ?? null, last: this.last?.id ?? null, survivors: this.sim.scores[0], infected: this.sim.scores[1] };
  }
  playerView(p, v) { v.infections = p.infections ?? 0; v.survived = p.survived ?? 0; }

  // [started, first index, last index, n infected, infected indices..., stats...]
  encode() {
    const sim = this.sim, inf = [];
    for (const p of sim.players) if (p.team === 1) inf.push(p.index);
    return encodeStats([this.started ? 1 : 0, this.first?.index ?? -1, this.last?.index ?? -1, inf.length, ...inf], sim.players, STATS);
  }

  // A guest takes the sides from the block, onto its own players (the codec's) and the view's.
  decode(a, out) {
    if (!a) { decodeStats(null, 0, out.players, STATS); return this.view(); }
    const sim = this.sim, n = a[3];
    decodeStats(a, 4 + n, out.players, STATS);
    this.started = !!a[0];
    this.first = sim.players[a[1]] ?? null;
    this.last = sim.players[a[2]] ?? null;
    if (this.started) {
      const inf = new Set(a.slice(4, 4 + n));
      sim.players.forEach((p, i) => {
        const t = inf.has(i) ? 1 : 0;
        p.team = t;
        if (out.players[i]) out.players[i].team = t;
      });
    }
    sim.scores[0] = out.players.filter(p => p.team === 0 && !p.away).length;
    sim.scores[1] = out.players.length - sim.scores[0];
    return this.view();
  }

  restore(view) {
    const sim = this.sim, o = view.obj ?? view.points?.obj;
    restoreStats(sim, view, STATS);
    if (!o) return;
    this.started = o.started;
    this.first = o.first ? sim.byId.get(o.first) ?? null : null;
    this.last = o.last ? sim.byId.get(o.last) ?? null : null;
    for (let i = 0; i < view.players.length && i < sim.players.length; i++) {
      const p = sim.players[i];
      p.team = view.players[i].team;
      p.loadout = sim._deal(p.team, p.loadout);
      p.primary = p.loadout.primary;
    }
    this._count();
  }
}
