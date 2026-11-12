// Graveyard Shift's economy on the host (ROADMAP item 36, docs/ZOMBIES.md "Economy"): what points buy once the perks
// are in. ZmRules (js/sim/zombies.js) owns one and calls in:
//   bench     the upgrade bench: the gun goes in (out of the buyer's hands) for ZE.bench.time s, comes out a tier up;
//             only its owner can take it, and nobody else can use the bench meanwhile. Tiers live on the player per gun
//             (p.zm.tiers), so a gun keeps its tier through swaps; a gun given up (replaced) loses it.
//   effects   tier 3 rounds by the gun's class (zmFxOf): fire (burning), shock (arcs to two more), blast (a burst round
//             the hit), frost (a slow)
//   supply    the terminal's items: sentry, air strike, hunter drone, lure, armour vest (one of each per player a round)
//   plates    the armour bench: plates soak claws before health (the bar of three in the HUD)
//   traps     armed for points, they hurt everything standing in them; kills pay ZE.trap.pay
//   exfil     from round ZE.exfil.from: a final wave for ZE.exfil.hold s, then whoever is on the pad gets out
//   quest     relics picked up across the map, set on the altar: the Gravewarden rises
// Events: {t:'zbench', state, by, gun, tier}, {t:'ztrap', i, state, by}, {t:'zsupply', item, by, x, z},
// {t:'zfx', k: 'arc'|'burn'|'frost', ox?, oz?, x, z}, {t:'turret_shot', ox, oz, x, z} (sentry and drone fire, drawn as
// the turret's), {t:'explosion', ...} (strike shells, lures, burst rounds), {t:'zexfil', state, by?, fail?},
// {t:'zescape', round, ids}, {t:'zrelic', i, by, n}, {t:'zwarden', state, by}, {t:'zbreath', id} (Last Breath),
// {t:'plates_break', id} as the Plate Drop streak's.
import { WEAPON_IDS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { hasLineOfSight } from '../shared/geometry.js';
import { ZM, ZE, ZM_KINDS, ZM_TRAP_KINDS, NO_GUN, START_GUN, bandOpen, zmFxOf, zmTierCamo, zmUpgradable, supplyCost, roundMix } from '../shared/zombies.js';
import { brArm } from './br.js';
import { zmTierDef } from './zm-phone.js';

export const GEAR_KINDS = ['sentry', 'drone', 'lure', 'strike'];
const r1 = v => Math.round(v * 10);
const PLATE_MAX = ZE.plate.hp * ZE.plate.max;

export class ZmEcon {
  constructor(R) {
    this.R = R;
    this.sim = R.sim;
    this.L = R.L;
    this.bench = { state: 0, owner: -1, slot: 0, gun: null, tier: 0, timer: 0 };
    this.traps = this.L.traps.map(() => ({ state: 0, timer: 0, by: -1, acc: 0 }));
    this.gear = [];
    this.gearId = 0;
    this.exfil = { state: 0, timer: 0, by: -1, spawnT: 0 };
    this.quest = { got: 0, state: 0, respawnT: 0, callT: 0 };
    this.wardenSeat = -1;
    this.escaped = null;      // Ids that got out, once the exfil lands.
    this._fxT = new Map();    // Per attacker: when a tier-3 effect last fired (a rate limit).
  }

  get exfilOn() { return this.exfil.state === 1; }

  // ---- One tick (host) ----

  step(dt) {
    const sim = this.sim, R = this.R;
    this._stepBench(dt);
    this._stepTraps(dt);
    if (this.gear.length) this._stepGear(dt);
    this._stepBurns(dt);
    if (this.exfilOn) this._stepExfil(dt);
    if (this.quest.state === 1) this._stepWarden(dt);
    // Bots wear their upgraded gun's look (a phone sets its own, js/game/match.js).
    if (sim.tick % 15 === 3) {
      for (const p of R.crew) {
        if (!p.isBot || !p.zm) continue;
        const t = p.zm.tiers[p.ps.weapon] ?? 0, c = (t && zmTierCamo(p.ps.weapon, t)) || 'none';
        if (p.camo !== c) { p.camo = p.ps.camo = c; sim._metaUntil = sim.tick + 2; }
      }
    }
  }

  // ---- Buying (ZmRules._use hands these kinds over). Returns the cost to charge, or null when refused. ----

  use(p, u, msg) {
    const sim = this.sim, R = this.R, z = p.zm;
    switch (u.kind) {
      case 'bench': {
        const b = this.bench, ps = p.ps, gun = ps.weapon;
        if (b.state || !zmUpgradable(gun)) return null;
        const tier = (z.tiers[gun] ?? 0) + 1;
        if (tier > 3) return null;
        Object.assign(b, { state: 1, owner: p.index, slot: ps.slot, gun, tier, timer: ZE.bench.time });
        // The gun goes in: out of the hands (the blade in its place) until it is taken back.
        this._arm(p, ps.slot, NO_GUN, 0);
        sim._emit({ t: 'zbench', state: 1, by: p.id, gun, tier });
        return ZE.bench.cost[tier - 1];
      }
      case 'benchtake': {
        if (this.bench.state !== 2 || this.bench.owner !== p.index) return null;
        this._handBack();
        return 0;
      }
      case 'terminal': {
        const item = msg?.item;
        if (!ZE.supply[item]) return null;
        if ((z.supply[item] ?? -1) === R.round) return null;     // One of each a round.
        const cost = supplyCost(item, R.round);
        if (z.pts < cost) return null;
        if (item !== 'vest' && this.gear.length >= ZE.gearMax) return null;
        if (!this._supply(p, item)) return null;
        z.supply[item] = R.round;
        sim._emit({ t: 'zsupply', item, by: p.id, x: Math.round(p.ps.x * 10) / 10, z: Math.round(p.ps.z * 10) / 10 });
        u.cost = cost; u.item = item;
        return cost;
      }
      case 'armour': {
        if (z.plates >= PLATE_MAX - 0.5) return null;
        z.plates = Math.min(PLATE_MAX, Math.floor(z.plates / ZE.plate.hp + 1e-6) * ZE.plate.hp + ZE.plate.hp);
        return ZE.plate.cost;
      }
      case 'trap': {
        const t = this.traps[u.i];
        if (!t || t.state) return null;
        Object.assign(t, { state: 1, timer: ZE.trap.on, by: p.index, acc: 0 });
        sim._emit({ t: 'ztrap', i: u.i, state: 1, by: p.id });
        return ZE.trap.cost;
      }
      case 'slot': {
        if (z.limit >= ZM.perkMax) return null;
        z.limit = ZM.perkMax;
        return ZM.slotCost;
      }
      case 'exfil': {
        if (this.exfil.state || R.round < ZE.exfil.from || R.state === 3) return null;
        Object.assign(this.exfil, { state: 1, timer: ZE.exfil.hold, by: p.index, spawnT: 1 });
        sim._emit({ t: 'zexfil', state: 1, by: p.id });
        return ZE.exfil.cost;
      }
      case 'relic': {
        const q = this.quest;
        if (q.state || q.got & (1 << u.i)) return null;
        q.got |= 1 << u.i;
        const n = this.L.relics.filter(r => q.got & (1 << r.i)).length;
        sim._emit({ t: 'zrelic', i: u.i, by: p.id, n, of: this.L.relics.length });
        return 0;
      }
      case 'altar': {
        const q = this.quest;
        if (q.state || this.L.relics.some(r => !(q.got & (1 << r.i)))) return null;
        q.state = 1; q.respawnT = 0.5; q.callT = 8;
        sim._emit({ t: 'zwarden', state: 1, by: p.id });
        return 0;
      }
      default: return null;
    }
  }

  // The gun on the bench back into its owner's hands, a tier up (its own slot if that still holds the blade).
  _handBack() {
    const b = this.bench, p = this.sim.players[b.owner];
    if (p?.zm && p.alive) {
      const ps = p.ps;
      const back = (b.slot === 0 ? ps.primary : ps.secondary) === NO_GUN ? b.slot : ps.secondary === NO_GUN ? 1 : ps.primary === NO_GUN ? 0 : ps.slot;
      const old = back === 0 ? ps.primary : ps.secondary;
      if (old !== b.gun) delete p.zm.tiers[old];
      p.zm.tiers[b.gun] = b.tier;
      this._arm(p, back, b.gun, b.tier);
      ps.slot = back; ps.weapon = b.gun;
      this.sim._emit({ t: 'zbench', state: 0, by: p.id, gun: b.gun, tier: b.tier });
    } else this.sim._emit({ t: 'zbench', state: 0 });
    Object.assign(b, { state: 0, owner: -1, gun: null, tier: 0, timer: 0 });
  }

  // A gun into a hand at a tier: the host's copy of the hands, and (for a human) the phone's through zarm.
  _arm(p, slot, gun, tier) {
    const ps = p.ps, w = WEAPONS[gun];
    brArm(ps, slot, gun);
    if (tier > 0) {
      const def = zmTierDef(gun, tier);
      ps.defs[slot] = def;
      ps.ammo[slot] = def.magazine;
      ps.reserve[slot] = def.unlimitedReserve ? 999 : def.reserve;
    } else if (w && !w.melee) ps.reserve[slot] = w.unlimitedReserve ? 999 : (w.reserve ?? w.magazine * 3);
    if (p.isBot) p.primary = ps.primary;
    else this.sim._emit({ t: 'zarm', id: p.id, slot, w: WEAPON_IDS.indexOf(gun), tier: tier || undefined });
  }

  _stepBench(dt) {
    const b = this.bench;
    if (!b.state) return;
    const p = this.sim.players[b.owner];
    if (!p?.zm || p.away) { this._handBack(); return; }
    b.timer -= dt;
    if (b.timer > 0) return;
    if (b.state === 1) {
      b.state = 2; b.timer = ZE.bench.hold;
      this.sim._emit({ t: 'zbench', state: 2, by: p.id, gun: b.gun, tier: b.tier });
    } else this._handBack();      // Left too long: it comes back by itself.
  }

  // ---- Damage hooks ----

  // A crew member's gunfire on a zombie: the tier's damage, and at tier 3 the round's effect.
  gunHit(target, attacker, dmg, weapon) {
    const t = attacker.zm.tiers[weapon] ?? 0;
    if (!t) return dmg;
    dmg *= ZE.tiers[t].dmg;
    if (t >= 3) this._effect(target, attacker, dmg, weapon);
    return dmg;
  }

  _effect(target, attacker, dmg, weapon) {
    const sim = this.sim, R = this.R, fx = zmFxOf(weapon), now = sim.time;
    const last = this._fxT.get(attacker.index) ?? -9;
    if (fx === 'frost') {
      if ((target.zSlowT ?? 0) < now + 0.5) sim._emit({ t: 'zfx', k: 'frost', x: r2(target.ps.x), z: r2(target.ps.z) });
      target.zSlowT = now + 3;
      return;
    }
    if (fx === 'fire') {
      if (!(target.zBurnT > now)) sim._emit({ t: 'zfx', k: 'burn', x: r2(target.ps.x), z: r2(target.ps.z) });
      target.zBurnT = now + 4; target.zBurnBy = attacker.index;
      target.zBurnDps = Math.max(target.zBurnDps && target.zBurnT > now ? target.zBurnDps * 0.7 : 0, dmg * 0.6);
      return;
    }
    if (now - last < (fx === 'blast' ? 0.2 : 0.08)) return;
    this._fxT.set(attacker.index, now);
    if (fx === 'shock') {
      const near = R.horde.filter(q => q !== target && q.alive && Math.hypot(q.ps.x - target.ps.x, q.ps.z - target.ps.z) < 4.5)
        .sort((a, b) => Math.hypot(a.ps.x - target.ps.x, a.ps.z - target.ps.z) - Math.hypot(b.ps.x - target.ps.x, b.ps.z - target.ps.z)).slice(0, 2);
      for (const q of near) {
        sim._emit({ t: 'zfx', k: 'arc', ox: r2(target.ps.x), oz: r2(target.ps.z), x: r2(q.ps.x), z: r2(q.ps.z) });
        sim._damage(q, attacker, dmg * 0.6, weapon, 0, 'zfx');
      }
    } else if (fx === 'blast') {
      const x = target.ps.x, z = target.ps.z;
      sim._emit({ t: 'explosion', x: r2(x), z: r2(z), radius: 2.2, by: attacker.id, weapon: 'thumper', zm: 1 });
      for (const q of R.horde) {
        if (q === target || !q.alive || Math.hypot(q.ps.x - x, q.ps.z - z) > 2.6) continue;
        sim._damage(q, attacker, dmg * 0.5, weapon, 0, 'zfx');
      }
    }
  }

  _stepBurns(dt) {
    const sim = this.sim, now = sim.time;
    if (sim.tick % 6) return;
    const step = dt * 6;
    for (const q of this.R.horde) {
      if (!q.alive || !(q.zBurnT > now)) continue;
      const by = sim.players[q.zBurnBy];
      if (by) sim._damage(q, by, q.zBurnDps * step, 'smg', 0, 'zfx');
    }
  }

  // Plates soak a claw (after Ironhide). Returns what is left for health.
  soak(target, dmg) {
    const z = target.zm;
    if (!(z.plates > 0)) return dmg;
    const took = Math.min(z.plates, dmg);
    z.plates -= took;
    if (z.plates < 0.5) { z.plates = 0; this.sim._emit({ t: 'plates_break', id: target.id, x: r2(target.ps.x), z: r2(target.ps.z) }); }
    return dmg - took;
  }

  // A zombie's death by the economy's own sources pays less than a gun kill. Returns the points, or null for a gun.
  killPay(info) {
    const s = info.streak;
    if (s === 'ztrap') return ZE.trap.pay;
    if (s === 'zsentry' || s === 'zdrone' || s === 'zstrike' || s === 'zlure') return Math.round(ZM.pts.kill / 2);
    return null;
  }

  // ---- The supply terminal ----

  _supply(p, item) {
    const R = this.R, ps = p.ps, S = ZE.supply[item];
    if (item === 'vest') {
      if (p.zm.plates >= PLATE_MAX - 0.5) return false;
      p.zm.plates = PLATE_MAX;
      return true;
    }
    const id = ++this.gearId;
    if (item === 'sentry') {
      const at = this._ahead(ps, 1.3);
      this.gear.push({ id, kind: 'sentry', x: at.x, z: at.z, aim: ps.aim, life: S.life, cool: 0.6, owner: p.index });
    } else if (item === 'drone') {
      this.gear.push({ id, kind: 'drone', x: ps.x, z: ps.z, aim: ps.aim, life: S.life, cool: 0.8, owner: p.index });
    } else if (item === 'lure') {
      const at = this._ahead(ps, 0.8);
      this.gear.push({ id, kind: 'lure', x: at.x, z: at.z, aim: 0, life: S.life, cool: 0, owner: p.index, index: 1000 + id, ps: { x: at.x, z: at.z } });
      R.fields.delete(1000 + id);
    } else if (item === 'strike') {
      const at = this._crowd(ps);
      this.gear.push({ id, kind: 'strike', x: at.x, z: at.z, aim: 0, life: S.delay + S.shells * S.every + 0.2, cool: S.delay, shells: S.shells, owner: p.index });
    } else return false;
    return true;
  }

  // Walkable floor `d` m in front of a player (or where they stand).
  _ahead(ps, d) {
    const nav = this.sim.nav, x = ps.x + Math.cos(ps.aim) * d, z = ps.z + Math.sin(ps.aim) * d;
    return nav && nav.isWalkable(x, z) && hasLineOfSight(this.sim.map, ps.x, ps.z, x, z) ? { x, z } : { x: ps.x, z: ps.z };
  }

  // The air strike's mark: the thickest crowd within 25 m (most undead within 4 m of one), else 9 m ahead.
  _crowd(ps) {
    let best = null, bn = 0;
    const live = this.R.horde.filter(q => q.alive && Math.hypot(q.ps.x - ps.x, q.ps.z - ps.z) < 25);
    for (const q of live) {
      let n = 0;
      for (const o of live) if (Math.hypot(o.ps.x - q.ps.x, o.ps.z - q.ps.z) < 4) n++;
      if (n > bn) { bn = n; best = q; }
    }
    return best ? { x: best.ps.x, z: best.ps.z } : { x: ps.x + Math.cos(ps.aim) * 9, z: ps.z + Math.sin(ps.aim) * 9 };
  }

  _stepGear(dt) {
    const sim = this.sim, R = this.R;
    for (let i = this.gear.length - 1; i >= 0; i--) {
      const g = this.gear[i], owner = sim.players[g.owner];
      g.life -= dt;
      if (g.kind === 'strike') {
        g.cool -= dt;
        if (g.cool <= 0 && g.shells > 0) {
          const S = ZE.supply.strike, a = R.rng() * Math.PI * 2, d = g.shells === S.shells ? 0 : 1 + R.rng() * S.r * 0.6;
          this._blast(owner, g.x + Math.cos(a) * d, g.z + Math.sin(a) * d, S.r, S.hit, S.boss, 'zstrike', 'launcher');
          g.shells--; g.cool = S.every;
        }
      } else if (g.kind === 'lure') {
        if (g.life <= 0) { const S = ZE.supply.lure; this._blast(owner, g.x, g.z, S.r, S.hit, 0.03, 'zlure', 'launcher'); }
      } else this._shooter(g, owner, dt);
      if (g.life <= 0) {
        this.gear.splice(i, 1);
        if (g.kind === 'lure') R.fields.delete(g.index);
      }
    }
  }

  // A sentry or a drone: the drone flies at its owner's shoulder, or toward the undead it hunts; both fire at the
  // nearest zombie in reach and in sight.
  _shooter(g, owner, dt) {
    const sim = this.sim, R = this.R, S = ZE.supply[g.kind];
    let tgt = null, td = S.range;
    for (const q of R.horde) {
      if (!q.alive) continue;
      const d = Math.hypot(q.ps.x - g.x, q.ps.z - g.z);
      if (d < td) { td = d; tgt = q; }
    }
    if (g.kind === 'drone') {
      let hx, hz;
      if (tgt && td > 5) { hx = tgt.ps.x; hz = tgt.ps.z; }
      else if (owner?.alive) { const a = sim.time * 0.8 + g.id; hx = owner.ps.x + Math.cos(a) * 2.4; hz = owner.ps.z + Math.sin(a) * 2.4; }
      if (hx !== undefined) {
        const dx = hx - g.x, dz = hz - g.z, l = Math.hypot(dx, dz), sp = Math.min(l, 7 * dt);
        if (l > 0.05) { g.x += dx / l * sp; g.z += dz / l * sp; }
        g.x = Math.max(1, Math.min(sim.map.width - 1, g.x)); g.z = Math.max(1, Math.min(sim.map.height - 1, g.z));
      }
    }
    g.cool -= dt;
    if (!tgt) return;
    const want = Math.atan2(tgt.ps.z - g.z, tgt.ps.x - g.x), da = Math.atan2(Math.sin(want - g.aim), Math.cos(want - g.aim));
    g.aim += Math.max(-9 * dt, Math.min(9 * dt, da));
    if (g.cool > 0 || Math.abs(da) > 0.5) return;
    g.cool = S.gap;
    if (!hasLineOfSight(sim.map, g.x, g.z, tgt.ps.x, tgt.ps.z)) return;
    sim._emit({ t: 'turret_shot', ox: r2(g.x), oz: r2(g.z), x: r2(tgt.ps.x), z: r2(tgt.ps.z), zm: g.kind });
    if (owner) sim._damage(tgt, owner, this._share(tgt, S.hit, 0.004), 'lmg', td, g.kind === 'drone' ? 'zdrone' : 'zsentry');
  }

  // Damage worth `k` of a round's health (a boss or the Gravewarden takes `boss` of its own).
  _share(q, k, boss) {
    return q.zk >= 3 ? Math.max(1, (q.zMax ?? 1) * boss) : Math.max(1, this.R.hp * k);
  }

  _blast(owner, x, z, r, k, boss, streak, weapon) {
    const sim = this.sim;
    sim._emit({ t: 'explosion', x: r2(x), z: r2(z), radius: r, by: owner?.id ?? null, weapon, zm: 1 });
    if (!owner) return;
    for (const q of this.R.horde) {
      if (!q.alive) continue;
      const d = Math.hypot(q.ps.x - x, q.ps.z - z);
      if (d > r || !hasLineOfSight(sim.map, x, z, q.ps.x, q.ps.z)) continue;
      sim._damage(q, owner, this._share(q, k, boss) * (1 - 0.4 * d / r), weapon, d, streak);
    }
  }

  // The lures as targets: each looks like a player to the flow fields (index, ps).
  get lures() { return this.gear.filter(g => g.kind === 'lure'); }

  // ---- Traps ----

  _stepTraps(dt) {
    const sim = this.sim, R = this.R;
    this.traps.forEach((t, i) => {
      if (!t.state) return;
      t.timer -= dt;
      if (t.timer <= 0) {
        if (t.state === 1) { t.state = 2; t.timer = ZE.trap.cool; sim._emit({ t: 'ztrap', i, state: 2 }); }
        else { t.state = 0; t.timer = 0; sim._emit({ t: 'ztrap', i, state: 0 }); }
        return;
      }
      if (t.state !== 1) return;
      t.acc += dt;
      if (t.acc < 0.25) return;
      const step = t.acc; t.acc = 0;
      const T = this.L.traps[i], by = sim.players[t.by] ?? R.crew[0];
      for (const q of R.horde) {
        if (!q.alive || Math.hypot(q.ps.x - T.x, q.ps.z - T.z) > T.r) continue;
        const dmg = q.zk >= 3 ? (q.zMax ?? 1) * ZE.trap.boss * step : R.hp * ZE.trap.dps * step;
        sim._damage(q, by, dmg, 'knife', 0, 'ztrap');
      }
      const claw = R.horde[0];
      for (const p of R.crew) {
        if (!p.alive || p.downed || Math.hypot(p.ps.x - T.x, p.ps.z - T.z) > T.r) continue;
        sim._damage(p, claw, ZE.trap.playerDps * step, 'knife', 0, 'ztrap');
      }
    });
  }

  // ---- Exfil ----

  _stepExfil(dt) {
    const sim = this.sim, R = this.R, X = this.exfil;
    X.timer -= dt;
    X.spawnT -= dt;
    if (X.spawnT <= 0) {
      X.spawnT = ZE.exfil.gap * (0.7 + 0.6 * R.rng());
      const spot = R._riser();
      if (spot) {
        const mix = roundMix(R.round), u = R.rng();
        this._extra(u < mix.brute ? 2 : u < 0.85 ? 1 : 0, spot);     // Brutes at the round's full share (half on 1111-32).
      }
    }
    if (X.timer > 0) return;
    const pad = this.L.exfil;
    const out = R.crew.filter(p => p.alive && !p.downed && !p.away && Math.hypot(p.ps.x - pad.x, p.ps.z - pad.z) < pad.r + 0.8);
    if (!out.length) {
      Object.assign(X, { state: 0, timer: 0, by: -1 });
      sim._emit({ t: 'zexfil', state: 0, fail: 1 });
      return;
    }
    this.escaped = out.map(p => p.id);
    X.state = 2;
    R.best = Math.max(R.best, R.round);
    sim._emit({ t: 'zescape', round: R.round, ids: this.escaped });
    R.state = 3;
    sim._end(0);
  }

  // A zombie off the round's count (the exfil wave, the Gravewarden and its callers). Null with no seat free.
  _extra(kind, spot) {
    const R = this.R, sim = this.sim;
    const seat = R.horde.find(p => !p.alive && (p.zFree ?? 0) <= sim.time);
    if (!seat) return null;
    R._raise(seat, kind, spot);
    seat.zExtra = true;
    return seat;
  }

  // ---- The quest's boss ----

  _stepWarden(dt) {
    const sim = this.sim, R = this.R, q = this.quest;
    const w = this.wardenSeat >= 0 ? sim.players[this.wardenSeat] : null;
    if (w?.alive && w.zk === 4) {
      // It calls two runners up beside it every so often.
      q.callT -= dt;
      if (q.callT <= 0) {
        q.callT = 10;
        for (let k = 0; k < 2; k++) {
          const a = R.rng() * Math.PI * 2, x = w.ps.x + Math.cos(a) * 3, z = w.ps.z + Math.sin(a) * 3;
          if (sim.nav?.isWalkable(x, z)) this._extra(1, { x, z });
        }
      }
      return;
    }
    q.respawnT -= dt;
    if (q.respawnT > 0) return;
    q.respawnT = 1;
    // A seat for it: a free one, else an ordinary zombie sinks (its place in the round comes back later).
    if (!R.horde.some(p => !p.alive && (p.zFree ?? 0) <= sim.time)) {
      const s = R.horde.find(p => p.alive && p.zk < 3);
      if (s) { R._sink(s); s.zFree = sim.time; }
    }
    const spot = R._bossSpot() ?? this._nearAltar() ?? R._riser();
    if (!spot) return;
    const seat = this._extra(4, spot);
    if (seat) { this.wardenSeat = seat.index; sim._emit({ t: 'zwarden', state: 3 }); }
  }

  _nearAltar() {
    const A = this.L.altar, nav = this.sim.nav;
    if (!A || !nav) return null;
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, x = A.x + Math.cos(a) * 8, z = A.z + Math.sin(a) * 8;
      if (nav.isWalkable(x, z) && bandOpen(this.L, this.R.open, this.L.band[this.L.cellAt(x, z)])) return { x, z };
    }
    return null;
  }

  // A zombie down: the Gravewarden's end pays everyone.
  onKill(target, killer) {
    if (target.index !== this.wardenSeat || target.zk !== 4) return;
    this.wardenSeat = -1;
    this.quest.state = 2;
    for (const p of this.R.crew) if (p.zm && !p.away) this.R._pay(p, ZE.quest.pts, false);
    this.sim._emit({ t: 'zwarden', state: 2, by: killer?.id ?? null });
  }

  // The warden sank (stuck): it rises again.
  onSink(p) {
    if (p.index === this.wardenSeat) { this.wardenSeat = -1; this.quest.respawnT = 2; }
  }

  // ---- Bots ----

  // What a bot would walk over to buy from the economy: a tier on its gun, plates, a trap with a crowd in it, a supply
  // item when there is money to spare. `consider(item, score)` as ZmRules._botWant's.
  botWants(p, consider) {
    const L = this.L, R = this.R, z = p.zm, ps = p.ps, open = R.open;
    const dist = (x, zz) => Math.hypot(x - ps.x, zz - ps.z);
    const reach = s => s && bandOpen(L, open, s.band);
    const fight = R.state === 1;
    // The upgrade bench, for a gun worth it (not the pistol), from round 6, with a cushion.
    if (reach(L.bench) && !this.bench.state && R.round >= 6) {
      for (const gun of [ps.primary, ps.secondary]) {
        if (!zmUpgradable(gun) || gun === START_GUN) continue;
        const t = z.tiers[gun] ?? 0;
        if (t >= 3 || z.pts < ZE.bench.cost[t] + (t ? 1000 : 1500)) continue;
        const d = dist(L.bench.x, L.bench.z);
        if (d < 60) consider({ kind: 'bench', i: 0, x: L.bench.x, z: L.bench.z, gun }, 32 + t * 4 - d * 0.4);
        break;
      }
    }
    // Plates when short of them.
    if (reach(L.armour) && z.plates <= PLATE_MAX - ZE.plate.hp && z.pts >= ZE.plate.cost + 800) {
      const d = dist(L.armour.x, L.armour.z);
      if (d < 45) consider({ kind: 'armour', i: 0, x: L.armour.x, z: L.armour.z }, 24 - d * 0.5 + (z.plates < ZE.plate.hp ? 6 : 0));
    }
    // A trap with three or more undead in or near it, mid-round.
    if (fight) {
      L.traps.forEach((T, i) => {
        if (this.traps[i].state || z.pts < ZE.trap.cost + 1500) return;
        const sb = L.band[L.cellAt(T.sx, T.sz)];
        if (!bandOpen(L, open, sb >= 0 ? sb : T.band)) return;
        const d = dist(T.sx, T.sz);
        if (d > 22) return;
        let n = 0;
        for (const q of R.horde) if (q.alive && Math.hypot(q.ps.x - T.x, q.ps.z - T.z) < T.r + 4) n++;
        if (n >= 3) consider({ kind: 'trap', i, x: T.sx, z: T.sz }, 26 + n - d);
      });
    }
    // The terminal, with money to spare: plates first (a vest), then a sentry, a drone, a strike on a crowd.
    if (reach(L.terminal) && R.round >= 4) {
      const d = dist(L.terminal.x, L.terminal.z);
      const can = it => (z.supply[it] ?? -1) !== R.round && z.pts >= supplyCost(it, R.round) + 2500 && (it === 'vest' || this.gear.length < ZE.gearMax);
      let item = null;
      if (z.plates < ZE.plate.hp && can('vest') && !reach(L.armour)) item = 'vest';
      else if (fight && can('sentry')) item = 'sentry';
      else if (fight && can('drone')) item = 'drone';
      else if (fight && R.round >= 8 && can('strike') && R.horde.filter(q => q.alive && dist(q.ps.x, q.ps.z) < 20).length >= 6) item = 'strike';
      if (item && d < 40) consider({ kind: 'terminal', i: 0, x: L.terminal.x, z: L.terminal.z, item }, 14 - d * 0.5);
    }
  }

  // ---- Wire ----

  // [bench [state, owner, gun idx, tier, timer ds], traps [state, timer ds]..., gear [kind, x dm, z dm, aim 64ths,
  //  life ds, owner]..., exfil [state, timer ds, by, escaped bits by crew seat], quest [got, state], warden seat]
  encode() {
    const b = this.bench;
    return [[b.state, b.owner, b.gun ? WEAPON_IDS.indexOf(b.gun) : -1, b.tier, r1(b.timer)],
      this.traps.flatMap(t => [t.state, r1(t.timer)]),
      this.gear.flatMap(g => [GEAR_KINDS.indexOf(g.kind), r1(g.x), r1(g.z), ((Math.round(g.aim / (Math.PI * 2) * 64) % 64) + 64) % 64, r1(Math.max(0, g.life)), g.owner]),
      [this.exfil.state, r1(this.exfil.timer), this.exfil.by, this.R.crew.reduce((m, p, k) => m | (this.escaped?.includes(p.id) ? 1 << k : 0), 0)],
      [this.quest.got, this.quest.state], this.wardenSeat];
  }

  decode(a) {
    if (!Array.isArray(a)) return;
    const [b, traps, gear, ex, q, ws] = a;
    if (b) Object.assign(this.bench, { state: b[0], owner: b[1], gun: WEAPON_IDS[b[2]] ?? null, tier: b[3], timer: b[4] / 10 });
    (traps ?? []).forEach((v, k) => { const t = this.traps[k >> 1]; if (!t) return; if (k & 1) t.timer = v / 10; else t.state = v; });
    this.gear = [];
    const G = gear ?? [];
    for (let i = 0; i + 5 < G.length; i += 6) {
      const kind = GEAR_KINDS[G[i]] ?? 'sentry', x = G[i + 1] / 10, z = G[i + 2] / 10;
      this.gear.push({ id: i / 6 + 1, kind, x, z, aim: G[i + 3] / 64 * Math.PI * 2, life: G[i + 4] / 10, owner: G[i + 5], cool: 0.5,
        shells: kind === 'strike' ? ZE.supply.strike.shells : 0, ...(kind === 'lure' ? { index: 1100 + i / 6, ps: { x, z } } : {}) });
    }
    if (ex) {
      Object.assign(this.exfil, { state: ex[0], timer: ex[1] / 10, by: ex[2] });
      this.escaped = ex[3] ? this.R.crew.filter((p, k) => ex[3] & (1 << k)).map(p => p.id) : null;
    }
    if (q) Object.assign(this.quest, { got: q[0], state: q[1] });
    this.wardenSeat = ws ?? -1;
  }

  // Host migration: what a guest decoded is the new host's state (the gear's ids renumbered).
  restore(old) {
    if (!old || old === this) return;
    Object.assign(this.bench, old.bench);
    old.traps.forEach((t, i) => { if (this.traps[i]) Object.assign(this.traps[i], { state: t.state, timer: t.timer, by: t.by ?? -1, acc: 0 }); });
    this.gear = old.gear.map(g => ({ ...g }));
    this.gearId = this.gear.reduce((m, g) => Math.max(m, g.id), 0) + 10;
    for (const g of this.gear) if (g.kind === 'lure') { g.index = 1000 + g.id; g.ps = { x: g.x, z: g.z }; }
    Object.assign(this.exfil, old.exfil, { spawnT: 1 });
    Object.assign(this.quest, { got: old.quest.got, state: old.quest.state, respawnT: 0.5, callT: 8 });
    this.wardenSeat = old.wardenSeat;
  }

  view() {
    const b = this.bench;
    return {
      bench: { state: b.state, owner: b.owner, gun: b.gun, tier: b.tier, timer: b.timer },
      traps: this.traps.map(t => ({ state: t.state, timer: t.timer })),
      gear: this.gear,
      exfil: { state: this.exfil.state, timer: this.exfil.timer, by: this.exfil.by },
      quest: { got: this.quest.got, state: this.quest.state },
      escaped: this.escaped,
    };
  }
}

const r2 = v => Math.round(v * 100) / 100;
export { ZM_KINDS, ZM_TRAP_KINDS };
