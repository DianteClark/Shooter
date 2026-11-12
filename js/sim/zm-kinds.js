// Graveyard Shift's special zombies and special rounds (docs/ZOMBIES.md "Special zombies"), out of js/sim/zombies.js:
// ZmRules makes one (`this.kinds`) and calls in from its tick, the horde's driving, damage and kills.
//   Spitter       keeps its distance (ZM_SPIT.keep) with a clear line to its target, winds up, lobs a glob: an arc
//                 the phones draw from the 'zspit' event with the landing spot marked, so a sidestep clears it. Landing
//                 hurts anyone on the spot and leaves a puddle that burns for a few seconds.
//   Bloater       slow; in reach it swells and bursts, and killed it bursts where it falls (ZM_BLAST): the crew in
//                 range are hurt, and so is the horde round it (credited to whoever killed it).
//   Crawler       low and quick, and a small target: shots trace it with the sliding radius (Sim._shoot sets that from
//                 `zLow`).
//   Shieldbearer  bullets and blades from the front hit its shield (ZM_SHIELD) until the shield breaks; explosives,
//                 traps, the terminal's gear and a Bloater's burst go round it.
// Special rounds (specialRound): 'sprint' (every zombie a runner, quicker), 'fog' (crew bots see ZM_FOG metres; the
// phones darken past it), 'bloat' (fewer, most of them Bloaters).
// Events: {t:'zspit', id, ox, oz, x, z, dur} (the glob leaves; it lands dur s later), {t:'zblast', x, z, r},
// {t:'zshield', id, x, z, broke?}. Nothing new rides the snapshot but the round's special (ZmRules.encode) and the
// broken shield (the packed kind 9).
import { ZK, ZM_SPIT, ZM_BLAST, ZM_SHIELD, ZM_FOG, clawDmg, specialMix, isBossKind, NO_GUN } from '../shared/zombies.js';
import { WEAPONS } from '../shared/weapons.js';
import { hasLineOfSight } from '../shared/geometry.js';
import { HUMAN_VIEW } from './bots.js';

const r2 = v => Math.round(v * 100) / 100;

export class ZmKinds {
  constructor(R) {
    this.R = R;
    this.globs = [];       // In flight: {by, x, z, at}
    this.puddles = [];     // {x, z, until, by}
    this.blasts = [];      // Bursts due next tick: {x, z, by (the bloater), killer}
    this.puddleT = 0;
  }

  // ---- Raising: the mix past round 8, and the special rounds ----

  // The kind for a fresh riser given the ordinary roll `kind` (0 shambler, 1 runner, 2 brute).
  pick(kind) {
    const R = this.R, sp = R.special;
    if (sp === 'sprint') return kind === 2 ? 2 : 1;
    if (sp === 'bloat') {
      if (kind !== 2 && R.rng() < 0.6 && this._alive(ZK.bloater) < 10) return ZK.bloater;
      return kind;
    }
    if (kind === 2 || R.round < 8) return kind;
    const u = R.rng();
    let acc = 0;
    for (const m of specialMix(R.round)) {
      acc += m.share;
      if (u < acc) return this._alive(m.kind) < m.cap ? m.kind : kind;
    }
    return kind;
  }
  _alive(kind) { let n = 0; for (const q of this.R.horde) if (q.alive && q.zk === kind) n++; return n; }

  // A zombie just raised: its kind's own state.
  raise(p) {
    p.zLow = p.zk === ZK.crawler;
    p.zShield = p.zk === ZK.shield ? Math.round(p.zMax * ZM_SHIELD.hp) : 0;
    p.zSpitT = 0; p.zSpitCd = p.zk === ZK.spitter ? 1.5 + this.R.rng() * 1.5 : 0; p.zBlockT = 0;
    if (this.R.special === 'sprint') p.zPace = Math.min(1, p.zPace + 0.06);
  }

  // The round's special, at its start (ZmRules._startRound): crew bots' sight in the fog.
  startRound() {
    const fog = this.R.special === 'fog';
    for (const p of this.R.crew) if (p.bot) p.bot.sightK = fog ? ZM_FOG / HUMAN_VIEW : 1;
  }

  // ---- One tick ----

  step(dt) {
    const R = this.R, sim = R.sim, now = sim.time;
    // Globs land.
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const g = this.globs[i];
      if (g.at > now) continue;
      this.globs.splice(i, 1);
      const dmg = ZM_SPIT.hit * this._scale();
      for (const q of R.crew) {
        if (!q.alive || q.downed || q.away) continue;
        if (Math.hypot(q.ps.x - g.x, q.ps.z - g.z) < ZM_SPIT.hitR) sim._damage(q, g.by, dmg, NO_GUN, 0);
      }
      this.puddles.push({ x: g.x, z: g.z, until: now + ZM_SPIT.life, by: g.by });
      if (this.puddles.length > ZM_SPIT.max) this.puddles.shift();
    }
    // Puddles burn whoever stands in them, four times a second.
    if (this.puddles.length) {
      while (this.puddles.length && this.puddles[0].until <= now) this.puddles.shift();
      this.puddleT -= dt;
      if (this.puddleT <= 0) {
        this.puddleT = 0.25;
        const dmg = ZM_SPIT.dps * 0.25 * this._scale();
        for (const pd of this.puddles) for (const q of R.crew) {
          if (!q.alive || q.downed || q.away) continue;
          if (Math.hypot(q.ps.x - pd.x, q.ps.z - pd.z) < ZM_SPIT.r) sim._damage(q, pd.by, dmg, NO_GUN, 0);
        }
      }
    }
    // Bursts queued by deaths last tick (a chain of Bloaters goes off a tick apart).
    if (this.blasts.length) {
      const list = this.blasts; this.blasts = [];
      for (const b of list) this._burst(b);
    }
  }
  // Acid grows with the round like a claw (a shambler's claw is 40 at its base).
  _scale() { return clawDmg(0, this.R.round) / 40; }

  // ---- Driving ----

  // A special's own steering, after ZmRules._driveZombie has its target: returns true when it set I.mx/I.mz itself.
  // Spitters stand off and spit; the rest walk in like anyone else.
  steer(p, tgt, d, dt, I) {
    if (p.zk !== ZK.spitter) return false;
    const R = this.R, sim = R.sim, ps = p.ps;
    if (p.zSpitCd > 0) p.zSpitCd -= dt;
    const see = d < ZM_SPIT.range && hasLineOfSight(sim.map, ps.x, ps.z, tgt.ps.x, tgt.ps.z);
    if (p.zSpitT > 0) {
      // Winding up: stand still, head on the target.
      p.zSpitT -= dt;
      I.mx = 0; I.mz = 0; I.aim = Math.atan2(tgt.ps.z - ps.z, tgt.ps.x - ps.x);
      if (p.zSpitT <= 0) this._spit(p, tgt, d);
      return true;
    }
    if (!see) return false;
    const ux = (tgt.ps.x - ps.x) / Math.max(d, 0.01), uz = (tgt.ps.z - ps.z) / Math.max(d, 0.01);
    if (p.zSpitCd <= 0 && d > ZM_SPIT.near * 0.6) {
      p.zSpitT = ZM_SPIT.windup;
      p.zSpitCd = ZM_SPIT.cool[0] + R.rng() * (ZM_SPIT.cool[1] - ZM_SPIT.cool[0]);
      I.mx = 0; I.mz = 0;
      return true;
    }
    // Hold the distance: back off inside `near`, sidle round at `keep`, close in past it.
    const pace = p.zPace;
    let fwd = d < ZM_SPIT.near ? -1 : d > ZM_SPIT.keep + 2 ? 1 : 0;
    const side = (p.index & 1 ? 1 : -1) * 0.6;
    let mx = ux * fwd - uz * side, mz = uz * fwd + ux * side;
    if (!sim.nav.isWalkable(ps.x + mx * 1.2, ps.z + mz * 1.2)) { mx = ux * Math.max(0, fwd) + uz * side; mz = uz * Math.max(0, fwd) - ux * side; }
    const l = Math.hypot(mx, mz);
    if (l > 1e-3) { I.mx = mx / l * pace; I.mz = mz / l * pace; } else { I.mx = 0; I.mz = 0; }
    I.aim = Math.atan2(uz, ux);
    return true;
  }

  _spit(p, tgt) {
    const sim = this.R.sim, ps = p.ps;
    let x = tgt.ps.x + tgt.ps.vx * ZM_SPIT.lead, z = tgt.ps.z + tgt.ps.vz * ZM_SPIT.lead;
    // Never through a wall: short of it if the lead would put the glob behind one.
    if (!hasLineOfSight(sim.map, ps.x, ps.z, x, z)) { x = tgt.ps.x; z = tgt.ps.z; }
    const dist = Math.hypot(x - ps.x, z - ps.z), dur = ZM_SPIT.flight + ZM_SPIT.perM * dist;
    this.globs.push({ by: p, x, z, at: sim.time + dur });
    sim._emit({ t: 'zspit', id: p.id, ox: r2(ps.x), oz: r2(ps.z), x: r2(x), z: r2(z), dur: r2(dur) });
  }

  // The claw's place for a Bloater: in reach it swells (the windup), then bursts instead of striking.
  // True when it took the claw step over.
  claw(p, inReach) {
    if (p.zk !== ZK.bloater) return false;
    if (p.zSwing <= 0 && inReach && p.zCool <= 0) { p.zSwing = p.zWindup ?? 0.55; this.R.sim._emit({ t: 'zswing', id: p.id }); }
    return true;
  }
  swungOut(p) {
    if (p.zk !== ZK.bloater) return false;
    this.R.sim._selfKill(p, 'zbloat');     // onKill queues the burst.
    return true;
  }

  // ---- Damage and deaths ----

  // A hit on a zombie (ZmRules.damage, before points): the shield's share. Returns the damage that gets through.
  shield(target, attacker, dmg, weapon, streak, equip) {
    if (target.zk !== ZK.shield || !(target.zShield > 0) || !attacker || streak || equip) return dmg;
    const W = WEAPONS[weapon];
    if (!W || W.explosive) return dmg;
    const ps = target.ps, a = Math.atan2(attacker.ps.z - ps.z, attacker.ps.x - ps.x);
    const off = Math.abs(Math.atan2(Math.sin(a - ps.aim), Math.cos(a - ps.aim)));
    if (off > ZM_SHIELD.arc) return dmg;
    target.zShield -= dmg;
    const sim = this.R.sim;
    if (target.zShield <= 0) { target.zShield = 0; sim._emit({ t: 'zshield', id: target.id, x: r2(ps.x), z: r2(ps.z), broke: 1 }); }
    else if (sim.time - (target.zBlockT ?? 0) > 0.3) { target.zBlockT = sim.time; sim._emit({ t: 'zshield', id: target.id, x: r2(ps.x), z: r2(ps.z) }); }
    return 0;
  }

  onDeath(target, killer, info) {
    if (target.zk !== ZK.bloater || info.away) return;
    this.blasts.push({ x: target.ps.x, z: target.ps.z, by: target, killer: killer?.zm ? killer : null });
  }

  _burst(b) {
    const R = this.R, sim = R.sim, B = ZM_BLAST;
    sim._emit({ t: 'zblast', x: r2(b.x), z: r2(b.z), r: B.r });
    sim._emit({ t: 'explosion', x: r2(b.x), z: r2(b.z), radius: B.r, by: b.by.id });
    const sc = this._scale();
    for (const q of R.crew) {
      if (!q.alive || q.downed || q.away) continue;
      const d = Math.hypot(q.ps.x - b.x, q.ps.z - b.z);
      if (d >= B.r || !hasLineOfSight(sim.map, b.x, b.z, q.ps.x, q.ps.z)) continue;
      sim._damage(q, b.by, (B.dmg - (B.dmg - B.min) * d / B.r) * sc, NO_GUN, d);
    }
    if (!b.killer) return;
    const hurt = R.hp * B.horde;
    for (const q of R.horde) {
      if (!q.alive || q === b.by) continue;
      const d = Math.hypot(q.ps.x - b.x, q.ps.z - b.z);
      if (d >= B.r || !hasLineOfSight(sim.map, b.x, b.z, q.ps.x, q.ps.z)) continue;
      sim._damage(q, b.killer, isBossKind(q.zk) ? Math.min(hurt, q.zMax * 0.04) : hurt * (1 - 0.5 * d / B.r), 'launcher', d, 'zblast');
    }
  }

  // ---- Crew bots (js/sim/bots.js asks through ZmRules) ----

  // Added to a bot's target score (lower is first): a Bloater still far enough off to pop safely goes first; a shield
  // facing the bot is left for later (or flanked); crawlers and spitters are worth taking out early.
  score(q, ps, d) {
    switch (q.zk) {
      case ZK.bloater: return d > ZM_BLAST.r + 1 ? -9 : -4;
      case ZK.shield: return this.facing(q, ps) ? 9 : -2;
      case ZK.spitter: return -4;
      case ZK.crawler: return -2;
      default: return 0;
    }
  }
  facing(q, ps) {
    if (q.zk !== ZK.shield || !(q.zShield > 0)) return false;
    const a = Math.atan2(ps.z - q.ps.z, ps.x - q.ps.x);
    return Math.abs(Math.atan2(Math.sin(a - q.ps.aim), Math.cos(a - q.ps.aim))) < ZM_SHIELD.arc;
  }
  // Where a bot standing at ps should step to get off acid (a puddle, or a glob's landing spot): a unit vector or null.
  dodge(ps) {
    let best = null, bd = Infinity;
    const now = this.R.sim.time;
    const check = (x, z, r) => { const d = Math.hypot(ps.x - x, ps.z - z); if (d < r + 0.7 && d < bd) { bd = d; best = { x, z, d }; } };
    for (const g of this.globs) if (g.at - now < 1.2) check(g.x, g.z, ZM_SPIT.hitR + 0.6);
    for (const pd of this.puddles) check(pd.x, pd.z, ZM_SPIT.r);
    if (!best) return null;
    const dx = ps.x - best.x, dz = ps.z - best.z, l = Math.hypot(dx, dz);
    return l > 0.05 ? { x: dx / l, z: dz / l } : { x: 1, z: 0 };
  }
}
