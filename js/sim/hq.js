// Headquarters, the host side (mode 'hq', and 'gwhq' on the Ground War maps). One HQ at a time, on the map's hardpoint
// zones (map.points.hard, or its Domination flags where it has none) in a seeded order. A neutral HQ is captured by standing in it alone (HQ.capture seconds for
// one player, faster with company, nothing while both sides stand in it). The team that holds it scores a point a
// second, but cannot respawn while it stands: its dead wait. The other team destroys it by standing in it uncontested
// for HQ.destroy seconds; a held HQ that nobody destroys relocates after HQ.life seconds. Either way the next HQ goes
// live after HQ.gap seconds and every waiting player comes back.
//
// Events: {t:'hq', kind:'live'|'capture'|'destroy'|'expire', id (zone), team?, by?}. Medals: hq_capture, hq_destroy.
import { SCORE } from '../shared/catalog.js';
import { addScore } from './streaks.js';
import { closestBot, decodeStats, encodeStats, makeZones, packZone, restoreStats, seededOrder, unpackZone, zoneObjective } from './mode-kit.js';

export const HQ = { capture: 8, destroy: 8, life: 75, gap: 5, crowd: 3, destroyScore: 150 };
const PHASES = ['capture', 'held', 'gap'];
const STATS = ['hqCaps', 'hqKills'];

export class HqRules {
  constructor(sim, seed) {
    this.sim = sim;
    this.look = 'hard';
    this.allIn = true;
    // The hardpoint zones; a map without them (the Ground War maps) uses its Domination flags as HQ sites.
    const pts = sim.map.points ?? {};
    this.zones = makeZones((pts.hard?.length ?? 0) >= 2 ? pts.hard : pts.dom);
    this.order = seededOrder(this.zones.length, seed, 0x4e51);
    this.idx = 0;
    this.phase = 'gap';
    this.t = HQ.gap;           // Seconds left in this phase: hold time while held, the wait while in the gap.
    this.progress = 0;         // 0..1 toward capturing (neutral) or destroying (held).
    this.by = -1;              // The team making the progress.
    sim.points = [];
  }

  get zone() { return this.zones[this.order[this.idx % this.zones.length]]; }
  get next() { return this.zones[this.order[(this.idx + 1) % this.zones.length]]; }
  get owner() { return this.phase === 'held' ? this.zone.owner : -1; }

  onLive() { if (this.phase === 'gap' && this.idx === 0 && this.sim.points.length === 0) this._open(); }

  _open() {
    const z = this.zone;
    z.owner = -1; z.cap = 0; z.contested = false;
    this.phase = 'capture'; this.progress = 0; this.by = -1; this.t = 0;
    this.sim.points = [z];
    this.sim._emit({ t: 'hq', kind: 'live', id: z.id });
  }

  step(dt) {
    const sim = this.sim;
    if (this.phase === 'gap') {
      this.t -= dt;
      if (this.t <= 0) { this.idx++; this._open(); }
      return;
    }
    const z = this.zone, n = sim._countIn(z);
    z.contested = n[0] > 0 && n[1] > 0;
    if (this.phase === 'capture') {
      if (!z.contested && (n[0] || n[1])) {
        const team = n[0] ? 0 : 1;
        if (this.by !== team) { this.by = team; this.progress = 0; }
        this.progress += dt * (1 + 0.5 * (Math.min(HQ.crowd, n[team]) - 1)) / HQ.capture;
        if (this.progress >= 1) this._capture(team);
      } else if (!n[0] && !n[1]) this.progress = Math.max(0, this.progress - dt * 0.1);
    } else {
      const own = z.owner, foe = 1 - own;
      this.t -= dt;
      sim.tickT -= dt;
      if (sim.tickT <= 0) { sim.tickT += 1; sim.scores[own]++; }
      if (n[foe] && !n[own]) {
        this.by = foe;
        this.progress += dt * (1 + 0.5 * (Math.min(HQ.crowd, n[foe]) - 1)) / HQ.destroy;
        if (this.progress >= 1) { this._destroy(foe); return; }
      } else if (!n[foe]) this.progress = Math.max(0, this.progress - dt / HQ.destroy);
      if (sim.scores[own] >= sim.scoreLimit) { sim.lastKill = null; sim._end(own); return; }
      if (this.t <= 0) this._close('expire', own);
    }
    z.cap = this.phase === 'held' ? (z.owner ? 1 : -1) * (1 - this.progress) : (this.by < 0 ? 0 : (this.by ? 1 : -1) * this.progress);
  }

  _capture(team) {
    const sim = this.sim, z = this.zone;
    z.owner = team; this.phase = 'held'; this.t = HQ.life; this.progress = 0; this.by = -1;
    sim.tickT = 1;
    for (const p of sim.players) {
      if (p.team !== team || !sim._onZone(p, z)) continue;
      p.hqCaps = (p.hqCaps ?? 0) + 1;
      addScore(p.score, SCORE.capture);
      sim._medal(p, 'hq_capture');
    }
    sim._emit({ t: 'hq', kind: 'capture', id: z.id, team });
  }

  _destroy(team) {
    const sim = this.sim, z = this.zone;
    for (const p of sim.players) {
      if (p.team !== team || !sim._onZone(p, z)) continue;
      p.hqKills = (p.hqKills ?? 0) + 1;
      addScore(p.score, HQ.destroyScore);
      sim._medal(p, 'hq_destroy');
    }
    this._close('destroy', z.owner, team);
  }

  // The HQ is gone (destroyed, or relocating): its team's dead come back as their timers allow, the next one opens soon.
  _close(kind, owner, by) {
    const z = this.zone;
    z.owner = -1; z.cap = 0; z.contested = false;
    this.phase = 'gap'; this.t = HQ.gap; this.progress = 0; this.by = -1;
    this.sim.points = [];
    const e = { t: 'hq', kind, id: z.id, team: owner };
    if (by !== undefined) e.by = by;
    this.sim._emit(e);
  }

  holdDead(p) { return this.phase === 'held' && p.team === this.zone.owner; }

  // Never spawn on the HQ; the side holding it would not get to anyway.
  spawnFlow(p, s) {
    if (this.phase === 'gap') return 0;
    const z = this.zone, d = Math.hypot(z.x - s.x, z.z - s.z);
    return d < 16 ? -(16 - d) * 2.5 : d < 40 ? (40 - d) * 0.15 : 0;
  }

  onKill() {}

  // ---- Bots: everyone on the HQ. The holders guard it (long guns from just outside); near the end, the thinkers head
  // for where the next one will be. ----
  plan(team, crew) {
    if (this.phase === 'gap') {
      for (const bot of crew) bot.setObjective(zoneObjective(this.next, 'attack', 'next'));
      return;
    }
    const z = this.zone, free = new Set(crew);
    if (this.phase === 'held' && z.owner === team) {
      const heavies = crew.filter(b => b.S.objDefend > 0).sort((a, b) => b.style.hold - a.style.hold).slice(0, 2);
      for (const b of heavies) { b.setObjective(zoneObjective(z, 'support')); free.delete(b); }
      for (const b of free) b.setObjective(zoneObjective(z, 'defend'));
      return;
    }
    if (this.phase === 'held' && this.t < 8) {
      const b = closestBot([...free].filter(x => x.S.objRotate), this.next.x, this.next.z);
      if (b) { b.setObjective(zoneObjective(this.next, 'attack', 'next')); free.delete(b); }
    }
    for (const b of free) b.setObjective(zoneObjective(z, 'attack'));
  }

  // ---- View and wire ----
  view() {
    const z = this.zone;
    return {
      kind: 'hq', phase: this.phase, id: z?.id ?? null, owner: this.owner, t: Math.max(0, this.t), progress: this.progress, by: this.by,
      next: this.next?.id ?? null, nx: this.next?.x ?? 0, nz: this.next?.z ?? 0, life: HQ.life, gap: HQ.gap,
    };
  }

  playerView(p, v) { v.hqCaps = p.hqCaps ?? 0; v.hqKills = p.hqKills ?? 0; }

  // [order position, phase, zone, progress %, by + 1, t ds, stats...]
  encode() {
    if (!this.zones.length) return 0;
    const out = [this.idx, PHASES.indexOf(this.phase), packZone(this.zone), Math.round(this.progress * 100), this.by + 1, Math.ceil(this.t * 10)];
    return encodeStats(out, this.sim.players, STATS);
  }

  // `host`: the sim decoding is the one that steps (the host's own view). Its state is the truth, so the block's
  // rounded clock and progress stay out of it (taking them back stalled the gap's 5 s at 5.0 and the next HQ never opened).
  decode(a, out, host = false) {
    decodeStats(a, 6, out.players, STATS);
    if (!a) return null;
    if (!host) {
      this.idx = a[0]; this.phase = PHASES[a[1]] ?? 'capture';
      unpackZone(this.zone, a[2]);
      this.progress = a[3] / 100; this.by = a[4] - 1; this.t = a[5] / 10;
    }
    if (this.phase !== 'gap') out.points.push(this.sim._pointView(this.zone, this.zone.owner, this.zone.cap, this.zone.contested));
    return this.view();
  }

  restore(view) {
    restoreStats(this.sim, view, STATS);
    const o = view.obj ?? view.points?.obj;
    if (!o) return;
    const i = this.zones.findIndex(z => z.id === o.id);
    const pos = Math.max(0, this.order.indexOf(i));
    this.idx = pos + Math.floor(this.idx / this.zones.length) * this.zones.length;
    this.phase = o.phase; this.t = o.t; this.progress = o.progress; this.by = o.by;
    const z = this.zone;
    z.owner = o.phase === 'held' ? o.owner : -1; z.contested = false;
    this.sim.points = o.phase === 'gap' ? [] : [z];
    this.sim.tickT = 1;
  }
}
