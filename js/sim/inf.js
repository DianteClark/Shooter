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
const TAU = Math.PI * 2;
// Survivor bots (ROADMAP 25; numbers from a 32-match sweep, docs/MODES.md "Infected bots"):
const GROUP_SIZES = [4, 4, 1, 3];         // Groups in the order they form; a 1 roams on its own.
const HAVEN_MAX = 24, HAVEN_GAP = 9;      // Spots survivors hold: the mode's zones plus hold points at least 9 m apart.
const PRESSED_R = 12;                     // More infected than the group this close to its spot: overrun, fall back.
const QUIET_R = 22;                       // A group moves on (its time up) only with no infected this close.
const LOST_HOLD = 8;                      // Lost someone: move on this many seconds later (once it is quiet).
const CLOSE_RANKS = 4, ROAM_MIN = 7;      // One group per 4 survivors as they thin out; a loner roams while 7 are left.
const CROWD_R = 16, SUPPORT_R = 22;       // A new spot keeps 16 m from other groups' and within 22 m of one of them.
const FLANK_FROM = 18, FLANK_OFF = 9;     // Infected further than this from their prey come in from the side.
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
    this.groups = null; this.havenList = null;   // Survivor bots' groups and the spots they hold (plan).
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

  // ---- Bots (ROADMAP 25: survivors used to stack one camp and wait) ----
  // Survivors split into small groups (fours and threes, and a loner who roams), each holding its own spot: the mode's
  // zones and the map's hold points, spread out (havens), near enough another group's to trade fire across. Members
  // commit to the spot and each watches its own side of it. A group moves on when its time there is up and no infected
  // is close, falls back on a neighbouring group when overrun, and groups close ranks as the survivors thin out (spread
  // too thin, small groups fell one by one: a 32-match sweep had survivors win 2 in 32 against 11 for the old one camp).
  // The infected spread over the prey and the ones further out come in from the side.
  _havens() {
    if (this.havenList) return this.havenList;
    const sim = this.sim, out = this.spots.map(z => ({ x: z.x, z: z.z, r: Math.max(3, z.r * 0.6) }));
    const holds = sim.nav?.holds ?? [];
    // Farthest-point picks from the hold points, at least HAVEN_GAP apart, up to HAVEN_MAX in all.
    const far = h => out.reduce((m, o) => Math.min(m, Math.hypot(o.x - h.x, o.z - h.z)), Infinity);
    while (out.length < HAVEN_MAX && holds.length) {
      let best = null, bd = HAVEN_GAP;
      for (const h of holds) { const d = far(h); if (d > bd) { bd = d; best = h; } }
      if (!best) break;
      out.push({ x: best.x, z: best.z, r: 3 });
    }
    return (this.havenList = out);
  }

  // fallback: overrun, the group falls back on a neighbouring group's spot (strength in numbers) rather than off on its own.
  _pickHaven(g, groups, infected, x, z, fallback = false) {
    const sim = this.sim, hv = this._havens();
    let best = g.spot, bs = -Infinity;
    hv.forEach((h, i) => {
      if (i === g.spot) return;
      let threat = 0, crowd = 0, friend = Infinity;
      for (const q of infected) { const d = Math.hypot(q.ps.x - h.x, q.ps.z - h.z); if (d < 30) threat += 30 - d; }
      for (const o of groups) if (o !== g && o.spot >= 0) {
        const d = Math.hypot(hv[o.spot].x - h.x, hv[o.spot].z - h.z);
        friend = Math.min(friend, d);
        if (d < CROWD_R) crowd += CROWD_R - d;
      }
      // Near enough a neighbouring group to help each other, not on top of it (falling back, on top of it is fine).
      const support = friend < Infinity ? -Math.max(0, friend - SUPPORT_R) * (fallback ? 0.5 : 1) : 0;
      const s = -Math.hypot(h.x - x, h.z - z) * (fallback ? 0.6 : 0.35) - threat * 1.5 - (fallback ? 0 : crowd * 2) + support + sim.rng() * 10;
      if (s > bs) { bs = s; best = i; }
    });
    g.spot = best; g.since = sim.time; g.hold = g.roam ? 12 + sim.rng() * 8 : 60 + sim.rng() * 40;
  }

  plan(team, crew) {
    const sim = this.sim;
    if (!this.started) return;
    if (team === 1) {
      const prey = sim.players.filter(p => p.team === 0 && p.alive);
      const on = new Map();
      for (const b of crew) {
        let best = null, bs = Infinity;
        for (const q of prey) {
          const d = Math.hypot(q.ps.x - b.ps.x, q.ps.z - b.ps.z);
          const s = d + (on.get(q) ?? 0) * 12;          // Spread over the prey: a target three are already on costs more.
          if (s < bs) { bs = s; best = q; }
        }
        if (!best) { b.setObjective(null); continue; }
        on.set(best, (on.get(best) ?? 0) + 1);
        const d = Math.hypot(best.ps.x - b.ps.x, best.ps.z - b.ps.z);
        let tx = best.ps.x, tz = best.ps.z;
        // Flank: from further out, half the pack swings in from one side and the other half from the other.
        if (d > FLANK_FROM) {
          const a = Math.atan2(best.ps.z - b.ps.z, best.ps.x - b.ps.x) + (b.p.index % 2 ? 1 : -1) * Math.PI / 2;
          const k = Math.min(FLANK_OFF, (d - FLANK_FROM) * 0.5);
          tx += Math.cos(a) * k; tz += Math.sin(a) * k;
        }
        b.setObjective(chaseObjective(sim, `prey${best.index}`, tx, tz, 'attack', true));
      }
      return;
    }
    const hv = this._havens();
    if (!hv.length) { for (const b of crew) b.setObjective(null); return; }
    // Ground War Infected keeps its `holds` big groups (thirty survivors in twos would never hold anything there).
    const size = this.k.holds ? Math.max(2, Math.ceil(crew.length / this.k.holds)) : null;
    const surv = sim.players.filter(p => p.team === 0 && p.alive).sort((a, b) => a.index - b.index);
    const infected = sim.players.filter(p => p.team === 1 && p.alive);
    const groups = this.groups ?? (this.groups = []);
    // Membership: kept from plan to plan; a survivor without a group joins the smallest one under its size, or starts one.
    const byId = new Map();
    for (const g of groups) { const n0 = g.ids.length; g.ids = g.ids.filter(id => surv.some(p => p.id === id)); g.lost = n0 - g.ids.length; for (const id of g.ids) byId.set(id, g); }
    for (let i = groups.length - 1; i >= 0; i--) if (!groups[i].ids.length) groups.splice(i, 1);
    for (const p of surv) {
      if (byId.has(p.id)) continue;
      const cap = size ?? GROUP_SIZES[groups.length % GROUP_SIZES.length];
      let g = groups.find(o => o.ids.length < o.cap);
      if (!g) { g = { ids: [], cap, spot: -1, since: 0, hold: 0, roam: cap === 1, lost: 0 }; groups.push(g); }
      g.ids.push(p.id); byId.set(p.id, g);
    }
    // Thinned out, groups close ranks: one group per CLOSE_RANKS survivors, the smallest folding into its nearest
    // neighbour (a loner keeps roaming while ROAM_MIN are left). Three on their own hold die one by one; together they last.
    const roams = g => g.roam && surv.length >= ROAM_MIN;
    while (groups.filter(g => !roams(g)).length > Math.max(1, Math.ceil(surv.length / CLOSE_RANKS))) {
      const pool = groups.filter(g => !roams(g)).sort((a, b) => a.ids.length - b.ids.length);
      const g = pool[0], at = g.spot >= 0 ? hv[g.spot] : null;
      let o = null, od = Infinity;
      for (const q of pool) if (q !== g) { const d = at && q.spot >= 0 ? Math.hypot(hv[q.spot].x - at.x, hv[q.spot].z - at.z) : 0; if (d < od) { od = d; o = q; } }
      o.ids.push(...g.ids); o.cap = Math.max(o.cap, o.ids.length); o.roam = false;
      for (const id of g.ids) byId.set(id, o);
      groups.splice(groups.indexOf(g), 1);
    }
    for (const g of groups) {
      const ms = surv.filter(p => g.ids.includes(p.id));
      let x = 0, z = 0;
      for (const p of ms) { x += p.ps.x / ms.length; z += p.ps.z / ms.length; }
      const h = g.spot >= 0 ? hv[g.spot] : null;
      // Overrun (more infected on the spot than the group can hold): fall back on friends at once. Otherwise a group
      // moves on once its time there is up, sooner when it has just lost someone, and only while no infected is close
      // (running across open ground with the pack on you is how a group dies).
      let near = 0, close = 0;
      for (const q of infected) {
        if (h && Math.hypot(q.ps.x - h.x, q.ps.z - h.z) < PRESSED_R) near++;
        if (Math.hypot(q.ps.x - x, q.ps.z - z) < QUIET_R) close++;
      }
      if (g.lost > 0) g.hold = Math.min(g.hold, sim.time - g.since + LOST_HOLD);
      if (!h) this._pickHaven(g, groups, infected, x, z);
      else if (near > ms.length) this._pickHaven(g, groups, infected, x, z, true);
      else if (sim.time - g.since > g.hold && (!close || g.roam)) this._pickHaven(g, groups, infected, x, z);
      g.lost = 0;
    }
    // Each member watches its own side of the hold, the group turned toward the nearest infected (a camp of eleven
    // covers every way in by numbers; three have to share it out).
    for (const b of crew) {
      const g = byId.get(b.p.id);
      if (!g || g.spot < 0) { b.setObjective(null); continue; }
      const h = hv[g.spot];
      let near = null, nd = Infinity;
      for (const q of infected) { const d = Math.hypot(q.ps.x - h.x, q.ps.z - h.z); if (d < nd) { nd = d; near = q; } }
      const n = g.ids.length, k = g.ids.indexOf(b.p.id);
      const base = near ? Math.atan2(near.ps.z - h.z, near.ps.x - h.x) : (g.spot * 2.4);
      const aim = n > 1 ? base + (k - (n - 1) / 2) * (TAU / n) : base;
      b.setObjective({ key: `haven${g.spot}`, x: h.x, z: h.z, r: h.r, role: 'defend', aim, commit: true });
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
