// Grind, the host side (mode 'grind'). Kills drop tags as in Kill Confirmed, but a tag scores nothing until it is
// banked: picking up an enemy tag puts it in your pocket, and standing in a bank (the map's two outer Domination flags,
// open to both teams) pays in one tag every GRIND.bankEvery seconds, one point each, while no enemy stands in that bank.
// Die and everything in your pocket falls with you, in one pile beside your own tag: your teammates can pick the pile
// up again, the enemy can deny it. Picking up your own side's tag denies it. sim.scores are tags banked.
//
// Tags live in sim.tags (view.tags draws them like Kill Confirmed's), each with a count `n`.
// Events: {t:'grind', kind:'pick'|'deny'|'bank', id (player), n, x?, z?}. Medals: confirm, deny, grind_bank.
import { SCORE } from '../shared/catalog.js';
import { addScore } from './streaks.js';
import { chaseObjective, closestBot, decodeStats, encodeStats, makeZones, r2, restoreStats, zoneObjective } from './mode-kit.js';

export const GRIND = { reach: 1.4, life: 30, max: 24, bankEvery: 0.4, bankScore: 50, go: 3, near: 18, radius: 4 };
const STATS = ['carry', 'banked', 'confirms'];

export class GrindRules {
  constructor(sim) {
    this.sim = sim;
    this.look = 'dom';
    const dom = sim.map.points?.dom ?? [];
    // The outer pair: two flags on opposite halves of a 180-degree map, so each team has one bank nearer home.
    this.banks = makeZones(dom.length >= 2 ? [dom[0], dom[dom.length - 1]] : dom).map((z, i) => ({ ...z, id: i ? 'B' : 'A', r: Math.max(z.r, GRIND.radius), bankT: 0 }));
    sim.points = this.banks;
  }

  step(dt) {
    const sim = this.sim, tags = sim.tags;
    for (let i = tags.length - 1; i >= 0; i--) {
      const tag = tags[i];
      tag.life -= dt;
      if (tag.life <= 0) { tags.splice(i, 1); continue; }
      for (const p of sim.players) {
        if (!p.alive) continue;
        const dx = p.ps.x - tag.x, dz = p.ps.z - tag.z;
        if (dx * dx + dz * dz > GRIND.reach * GRIND.reach) continue;
        this._take(tag, p);
        tags.splice(i, 1);
        break;
      }
    }
    for (const b of this.banks) {
      const n = sim._countIn(b);
      b.contested = n[0] > 0 && n[1] > 0;
      b.bankT -= dt;
      if (b.bankT > 0) continue;
      b.bankT = GRIND.bankEvery;
      for (const p of sim.players) {
        if (!(p.carry > 0) || !sim._onZone(p, b) || n[1 - p.team] > 0) continue;
        p.carry--; p.banked = (p.banked ?? 0) + 1; p.session = (p.session ?? 0) + 1;
        sim.scores[p.team]++;
        addScore(p.score, GRIND.bankScore);
        if (p.carry === 0) this._banked(p);
        if (sim.scores[p.team] >= sim.scoreLimit) { sim.lastKill = null; sim._end(p.team); return; }
      }
    }
    // Stepping out of the bank part way closes that run of deposits.
    for (const p of sim.players) if (p.session && !this.banks.some(b => sim._onZone(p, b))) this._banked(p);
  }

  _banked(p) {
    if (!p.session) return;
    this.sim._medal(p, 'grind_bank');
    this.sim._emit({ t: 'grind', kind: 'bank', id: p.id, n: p.session });
    p.session = 0;
  }

  _take(tag, p) {
    const sim = this.sim, enemy = tag.team !== p.team;
    if (enemy) {
      p.carry = (p.carry ?? 0) + tag.n;
      p.confirms = (p.confirms ?? 0) + tag.n;
      addScore(p.score, SCORE.confirm);
      sim._medal(p, 'confirm');
    } else {
      addScore(p.score, SCORE.deny);
      sim._medal(p, 'deny');
    }
    sim._emit({ t: 'grind', kind: enemy ? 'pick' : 'deny', id: p.id, n: tag.n, x: r2(tag.x), z: r2(tag.z) });
    // Kill Confirmed's tag event too, so the HUD and audio give the same pickup cue.
    sim._emit({ t: 'tag', kind: enemy ? 'confirm' : 'deny', id: tag.id, x: r2(tag.x), z: r2(tag.z), by: p.id, team: p.team });
  }

  _drop(x, z, team, n) {
    const sim = this.sim;
    if (sim.tags.length >= GRIND.max) sim.tags.shift();
    sim.tags.push({ id: sim.nextTagId++, x, z, team, n, life: GRIND.life });
  }

  onKill(target, killer, info) {
    const x = target.ps.x, z = target.ps.z;
    if (!info.away) this._drop(x, z, target.team, 1);
    if (target.carry > 0) this._drop(x + 0.9, z, 1 - target.team, target.carry);
    target.carry = 0; target.session = 0;
  }

  // ---- Bots: pick up what is near, bank when the pocket is worth it (or a bank is close), and keep a guard on the
  // bank nearest home to catch carriers. ----
  plan(team, crew) {
    const sim = this.sim, free = new Set(crew);
    const nearest = (x, z) => this.banks.reduce((a, b) => (Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a), this.banks[0]);
    for (const b of crew) {
      const c = b.p.carry ?? 0;
      if (!c || !this.banks.length) continue;
      const bank = nearest(b.ps.x, b.ps.z);
      if (c >= GRIND.go || Math.hypot(bank.x - b.ps.x, bank.z - b.ps.z) < GRIND.near) {
        b.setObjective({ ...zoneObjective(bank, 'attack', 'bank'), commit: c >= GRIND.go });
        free.delete(b);
      }
    }
    // One guard on the bank nearer our end, if anybody can be spared.
    const home = this.banks.length ? nearest(team === 0 ? 0 : sim.map.width, sim.map.height / 2) : null;
    if (home && free.size > 3) {
      const g = closestBot([...free].filter(b => b.S.objDefend > 0), home.x, home.z);
      if (g) { g.setObjective(zoneObjective(home, 'defend', 'guard')); free.delete(g); }
    }
    // Tags: the closest bot that knows of it, enemy tags first.
    const pairs = [];
    for (const b of free) {
      for (const tag of sim.tags) {
        const d = Math.hypot(tag.x - b.ps.x, tag.z - b.ps.z), own = tag.team === team;
        if (d > (own ? 12 : b.S.tagSight)) continue;
        pairs.push({ cost: d - tag.n * 3 + (own ? 6 : 0) + (b.targetVisible ? 8 : 0), b, tag });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost);
    const busy = new Set(), taken = new Set();
    for (const { b, tag } of pairs) {
      if (busy.has(b) || taken.has(tag)) continue;
      busy.add(b); taken.add(tag);
      b.setObjective({ key: `gt${tag.id}`, x: tag.x, z: tag.z, r: 0, role: 'collect' });
    }
    for (const b of free) if (!busy.has(b)) b.setObjective(null);
  }

  // ---- View and wire ----
  view() { return { kind: 'grind', banks: this.banks.map(b => b.id), counts: this.sim.tags.map(t => t.n) }; }
  playerView(p, v) { v.carry = p.carry ?? 0; v.banked = p.banked ?? 0; v.confirms = p.confirms ?? 0; }

  // [banks contested bits, n tags, tags as (id*2+team, x ds, z ds, n, life ds)..., stats...]
  encode() {
    const sim = this.sim, out = [this.banks.reduce((m, b, i) => m | (b.contested ? 1 << i : 0), 0), sim.tags.length];
    for (const t of sim.tags) out.push(t.id * 2 + t.team, Math.round(t.x * 10), Math.round(t.z * 10), t.n, Math.round(t.life * 10));
    return encodeStats(out, sim.players, STATS);
  }

  decode(a, out) {
    const sim = this.sim;
    out.tags = [];
    let i = 2;
    if (a) {
      for (let k = 0; k < a[1]; k++, i += 5) out.tags.push({ id: a[i] >> 1, team: a[i] & 1, x: a[i + 1] / 10, z: a[i + 2] / 10, n: a[i + 3], life: a[i + 4] / 10 });
      this.banks.forEach((b, k) => { b.contested = !!(a[0] & (1 << k)); });
    }
    decodeStats(a, i, out.players, STATS);
    for (const b of this.banks) out.points.push(sim._pointView(b, -1, 0, b.contested));
    return { kind: 'grind', banks: this.banks.map(b => b.id), counts: out.tags.map(t => t.n) };
  }

  restore(view) {
    const sim = this.sim;
    restoreStats(sim, view, STATS);
    sim.tags = (view.tags ?? []).map((t, k) => ({ id: t.id, x: t.x, z: t.z, team: t.team, n: t.n ?? view.obj?.counts?.[k] ?? 1, life: t.life ?? GRIND.life }));
    sim.nextTagId = sim.tags.reduce((m, t) => Math.max(m, t.id + 1), 1);
  }
}
