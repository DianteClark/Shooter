// Control, the host side (mode 'ctl'). Rounds of attack and defence over two zones: the map's two bomb sites
// (map.points.snd), both on the east half. Attackers always set out from the west spawns and defenders from the east;
// the teams swap roles (and ends) every round. Each side has a pool of respawns a round (CTL.livesAttack or CTL.livesDefend a
// player): a death spends one, and with none left that side's dead stay down.
//
// Attackers take a zone by standing in it with no defender inside (CTL.capture seconds for one, faster with company);
// progress stays when they step off, and a taken zone stays taken. The round is the attackers' when both zones are
// taken or the defenders are all down with no lives left; the defenders' when the round clock runs out or the attackers
// are all down with no lives left. While attackers stand on a zone they have started taking, the clock waits at zero
// (overtime). sim.scores are rounds won; first to scoreLimit wins the match.
//
// Round flow as in Search and Destroy: 'freeze' (sim phase 'warmup', everyone held at their end), 'live', 'post'.
// Events: {t:'ctl', kind:'round'|'go'|'capture'|'end'|'lives'|'overtime', ...}. Medals: ctl_capture, ctl_hold.
import { SCORE } from '../shared/catalog.js';
import { addScore } from './streaks.js';
import { alive, closestBot, decodeStats, encodeStats, makeZones, packZone, restoreStats, unpackZone, zoneObjective } from './mode-kit.js';

export const CTL = { radius: 5, freeze: 6, post: 5, capture: 9, crowd: 3, livesAttack: 7, livesDefend: 5, low: 5, holdScore: 150 };
const STATES = ['freeze', 'live', 'post'];
const REASONS = ['capture', 'elim', 'time'];
const STATS = ['ctlCaps'];

export class CtlRules {
  constructor(sim) {
    this.sim = sim;
    this.look = 'dom';
    this.ownClock = true;
    this.allIn = true;
    // A bomb site is drawn for one planter; a zone a squad fights over needs more room.
    this.zones = makeZones(sim.map.points?.snd).map(z => ({ ...z, r: Math.max(z.r, CTL.radius) }));
    this.round = 0;
    this.attackers = 0;
    this.state = 'freeze';
    this.postT = 0;
    this.overtime = false;
    this.history = [];
    this.lives = [0, 0];
    this.livesMax = 0;
    this.warned = [false, false];
    sim.points = this.zones;
  }

  get defenders() { return 1 - this.attackers; }
  sideOf(team) { return team === this.attackers ? 0 : 1; }

  spawnAll() { this.startRound(); return true; }

  startRound() {
    const sim = this.sim;
    this.round++;
    this.attackers = (this.round - 1) % 2;
    this.state = 'freeze'; this.postT = 0; this.overtime = false;
    const size = Math.max(1, ...[0, 1].map(t => sim.players.filter(p => p.team === t && !p.dummy).length));
    // Attackers walk into prepared defences, so they get more lives to do it with.
    this.livesMax = size * CTL.livesAttack;
    this.lives = [0, 1].map(t => size * (t === this.attackers ? CTL.livesAttack : CTL.livesDefend));
    this.warned = [false, false];
    for (const z of this.zones) { z.owner = this.defenders; z.cap = 0; z.contested = false; z.taken = [false, false]; }
    // A clean field, as in Search and Destroy: last round's kit and streaks are gone.
    sim.eq.reset();
    sim.strikes.length = 0; sim.mortars.length = 0; sim.gunships.length = 0;
    for (let i = sim.turrets.length - 1; i >= 0; i--) sim._removeTurret(sim.turrets[i]);
    sim.callouts.length = 0;
    sim.uav.fill(0); sim.jam.fill(0); sim.jamBy.fill(0); sim.overwatch.fill(0);
    sim.lastKill = null; sim.hot = null;
    for (let t = 0; t < 2; t++) {
      const list = sim.map.spawns[this.sideOf(t)], used = new Set();
      for (const p of sim.players) {
        if (p.team !== t || p.dummy || p.away) continue;
        let s = list[0];
        for (let k = 0; k < 24; k++) { s = list[Math.floor(sim.rng() * list.length)]; if (!used.has(s)) break; }
        used.add(s);
        sim._placeAt(p, s, this.sideOf(t) === 0 ? 0 : Math.PI);
      }
    }
    sim.timeLeft = sim.timeLimit;
    sim.phaseT = CTL.freeze;
    if (sim.phase !== 'warmup') sim._setPhase('warmup');
    sim._emit({ t: 'ctl', kind: 'round', round: this.round, attackers: this.attackers, lives: this.livesMax });
  }

  onLive() {
    this.state = 'live';
    this.sim.timeLeft = this.sim.timeLimit;
    this.sim._emit({ t: 'ctl', kind: 'go', round: this.round });
  }

  step(dt) {
    const sim = this.sim;
    if (this.state === 'post') {
      this.postT -= dt;
      if (this.postT <= 0) this.startRound();
      return;
    }
    if (this.state !== 'live') return;
    const A = this.attackers, D = this.defenders;
    let pushing = false;
    for (const z of this.zones) {
      const n = sim._countIn(z);
      z.contested = n[A] > 0 && n[D] > 0;
      if (z.owner === A) continue;
      if (n[A] && !n[D]) {
        const prog = Math.abs(z.cap) + dt * (1 + 0.5 * (Math.min(CTL.crowd, n[A]) - 1)) / CTL.capture;
        z.cap = (A ? 1 : -1) * Math.min(1, prog);
        if (prog >= 1) this._capture(z);
      }
      if (n[A] && z.owner !== A && z.cap !== 0) pushing = true;
    }
    if (this.zones.length && this.zones.every(z => z.owner === A)) { this._end(A, 'capture'); return; }
    // Out of lives with nobody standing.
    for (const t of [A, D]) if (this.lives[t] <= 0 && alive(sim, t) === 0) { this._end(1 - t, 'elim'); return; }
    if (sim.timeLeft > 0) sim.timeLeft = Math.max(0, sim.timeLeft - dt);
    if (sim.timeLeft <= 0) {
      if (pushing) {
        if (!this.overtime) { this.overtime = true; sim._emit({ t: 'ctl', kind: 'overtime' }); }
      } else this._end(D, 'time');
    }
  }

  _capture(z) {
    const sim = this.sim, A = this.attackers;
    z.owner = A; z.cap = A ? 1 : -1; z.taken[A] = true;
    for (const p of sim.players) {
      if (p.team !== A || !sim._onZone(p, z)) continue;
      p.ctlCaps = (p.ctlCaps ?? 0) + 1;
      addScore(p.score, SCORE.capture);
      sim._medal(p, 'ctl_capture');
    }
    sim._emit({ t: 'ctl', kind: 'capture', id: z.id, team: A });
  }

  _end(winner, reason) {
    const sim = this.sim;
    if (this.state !== 'live') return;
    sim.scores[winner]++;
    this.history.push({ winner, reason });
    this.state = 'post'; this.postT = CTL.post; this.overtime = false;
    if (reason === 'time' || reason === 'elim') {
      for (const p of sim.players) if (p.team === winner && p.alive && winner === this.defenders) { addScore(p.score, CTL.holdScore); sim._medal(p, 'ctl_hold'); }
    }
    sim._emit({ t: 'ctl', kind: 'end', round: this.round, winner, reason });
    if (sim.scores[winner] >= sim.scoreLimit) sim._end(winner);
  }

  damage(target, attacker, dmg) { return this.state === 'live' ? dmg : 0; }

  onKill(target, killer, info) {
    if (this.state !== 'live' || info.away) return;
    const t = target.team;
    this.lives[t] = Math.max(0, this.lives[t] - 1);
    if (!this.warned[t] && this.lives[t] <= CTL.low) { this.warned[t] = true; this.sim._emit({ t: 'ctl', kind: 'lives', team: t, left: this.lives[t] }); }
  }

  // No lives left: stay down. Between rounds the next round's spawn brings everyone back anyway.
  holdDead(p) { return this.state !== 'live' || this.lives[p.team] <= 0; }

  // Your own end of the map only.
  spawnFlow(p, s) {
    const west = s.x < this.sim.map.width / 2;
    return west === (this.sideOf(p.team) === 0) ? 30 : -120;
  }

  timeUp() { return null; }

  onLoadout(p) { if (this.state === 'freeze' && p.alive) this.sim._placeAt(p, { x: p.ps.x, z: p.ps.z }, p.ps.aim); }

  // ---- Bots. Attackers stack the zone they have the most on (some split to the other, by skill); defenders guard both,
  // more of them on the one under attack. ----
  plan(team, crew) {
    if (this.state !== 'live') return;
    const sim = this.sim, A = this.attackers;
    const open = this.zones.filter(z => z.owner !== A);
    if (!open.length) return;
    const free = new Set(crew);
    if (team === A) {
      const main = open.slice().sort((a, b) => Math.abs(b.cap) - Math.abs(a.cap) || a.id.localeCompare(b.id))[0];
      const other = open.find(z => z !== main);
      let split = other ? Math.floor(crew.length / 3) : 0;
      for (const b of free) {
        const z = split > 0 && b.S.objRotate ? (split--, other) : main;
        b.setObjective(zoneObjective(z, 'attack'));
      }
      return;
    }
    // Defenders: the threatened zone gets the extra bodies.
    const heat = z => (z.contested ? 3 : 0) + Math.abs(z.cap) * 4 + sim._countIn(z)[A] * 2;
    const order = open.slice().sort((a, b) => heat(b) - heat(a));
    const share = order.length === 1 ? [crew.length] : [Math.ceil(crew.length * 0.6), crew.length];
    let i = 0;
    order.forEach((z, k) => {
      for (; i < share[k]; i++) {
        const b = closestBot(free, z.x, z.z);
        if (!b) return;
        free.delete(b);
        b.setObjective(zoneObjective(z, b.S.objDefend > 0.25 && i % 3 === 2 ? 'support' : 'defend'));
      }
    });
    for (const b of free) b.setObjective(zoneObjective(order[0], 'defend'));
  }

  // ---- View and wire ----
  view() {
    const sim = this.sim;
    return {
      kind: 'ctl', state: this.state, round: this.round, attackers: this.attackers, lives: this.lives.slice(), livesMax: this.livesMax,
      toWin: sim.scoreLimit, overtime: this.overtime, clock: this.state === 'freeze' ? Math.max(0, sim.phaseT) : this.state === 'post' ? Math.max(0, this.postT) : 0,
      history: this.history.map(h => ({ ...h })),
    };
  }
  playerView(p, v) { v.ctlCaps = p.ctlCaps ?? 0; }

  // [state, round, attackers, lives0, lives1, livesMax, clock ds, overtime, zones..., n history, history..., stats...]
  encode() {
    const v = this.view();
    const out = [STATES.indexOf(this.state), this.round, this.attackers, this.lives[0], this.lives[1], this.livesMax, Math.round(v.clock * 10), this.overtime ? 1 : 0];
    for (const z of this.zones) out.push(packZone(z));
    out.push(this.history.length);
    for (const h of this.history) out.push(h.winner * 4 + REASONS.indexOf(h.reason));
    return encodeStats(out, this.sim.players, STATS);
  }

  decode(a, out) {
    const sim = this.sim;
    if (!a) { decodeStats(null, 0, out.players, STATS); out.points.push(...this.zones.map(z => sim._pointView(z, z.owner, z.cap, z.contested))); return this.view(); }
    this.state = STATES[a[0]] ?? 'live'; this.round = a[1]; this.attackers = a[2]; this.lives = [a[3], a[4]]; this.livesMax = a[5];
    const clock = a[6] / 10; this.overtime = !!a[7];
    let i = 8;
    for (const z of this.zones) unpackZone(z, a[i++]);
    const n = a[i++];
    this.history = [];
    for (let k = 0; k < n; k++, i++) this.history.push({ winner: a[i] >> 2, reason: REASONS[a[i] & 3] });
    decodeStats(a, i, out.players, STATS);
    for (const z of this.zones) out.points.push(sim._pointView(z, z.owner, z.cap, z.contested));
    const v = this.view();
    v.clock = clock;
    return v;
  }

  restore(view) {
    const sim = this.sim, o = view.obj ?? view.points?.obj;
    restoreStats(sim, view, STATS);
    if (!o) return;
    this.round = o.round; this.attackers = o.attackers; this.state = o.state; this.lives = o.lives.slice(); this.livesMax = o.livesMax;
    this.history = o.history.map(h => ({ ...h })); this.overtime = o.overtime;
    this.postT = o.state === 'post' ? o.clock : 0;
    if (o.state === 'freeze') sim.phaseT = Math.max(0.5, o.clock);
    for (const v of view.points ?? []) {
      const z = this.zones.find(q => q.id === v.id);
      if (z) { z.owner = v.owner; z.cap = v.capture; z.contested = v.contested; }
    }
    sim.points = this.zones;
  }
}
