// Wrenfield Fair on the host (docs/ZOMBIES.md "Wrenfield Fair"): the lantern quest, its boss the Barker, and the
// Whirligig (the third wonder weapon, in every map's crate). ZmEcon (js/sim/zm-econ.js) owns the state and calls in:
//   askOracle     the fortune machine at the Ticket Gate, with the power on: the order the lanterns go in (q.read)
//   lightLantern  the next in the order lights (the first starts ZE.quest.burn); any other puts every one out and
//                 the fair sends runners; all four lit stay lit, and the high striker's bell (the altar slot) calls
//                 the Barker
//   stepLanterns  the burn: the lanterns go out if the last is not lit in time
//   stepBarker    the Barker's charge (a lane marked on the ground for ZM_BARKER.wind s, then run down) and its crowd
//   laneDodge     where a bot steps to get out of a marked lane
//   whirlHit      a Whirligig hit: a whirl spins up where it lands (ZM_WONDERS.whirl)
//   stepWhirls    the whirls drag the undead in, grind them, then burst
// Events: {t:'zoracle', by, order}, {t:'zlantern', state: 0 wrong | 2 burnt out, i?, by?}, {t:'zcharge', x, z, a, len,
// w, wind, dash} (the lane, as the charge winds up), {t:'zwhirl', x, z, r, life}, {t:'zfx', k: 'whirlpop', x, z, r}.
import { ZM, ZE, ZK, ZM_BARKER, ZM_WONDERS, NO_GUN, clawDmg, isBossKind } from '../shared/zombies.js';
import { hasLineOfSight } from '../shared/geometry.js';

const r2 = v => Math.round(v * 100) / 100;
const bits = n => { let c = 0; for (; n; n &= n - 1) c++; return c; };

// A walkable spot about `d` m round (x, z), or null.
function near(E, x, z, d) {
  const sim = E.sim;
  for (let k = 0; k < 10; k++) {
    const a = E.R.rng() * Math.PI * 2, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (sim.nav?.isWalkable(px, pz) && hasLineOfSight(sim.map, x, z, px, pz)) return { x: px, z: pz };
  }
  return null;
}

// ---- The lanterns ----

export function askOracle(E, p) {
  const q = E.quest;
  if (!E.R.power || q.read || q.state) return null;
  q.read = 1;
  E.sim._emit({ t: 'zoracle', by: p.id, order: q.order.slice() });
  return 0;
}

export function lightLantern(E, p, i) {
  const sim = E.sim, q = E.quest, L = E.L;
  if (!q.read || q.state || q.got & (1 << i) || !L.relics[i]) return null;
  const n = bits(q.got);
  if (q.order[n] === i) {
    q.got |= 1 << i;
    const lit = n + 1, all = lit >= L.relics.length;
    q.burnT = all ? 0 : lit === 1 ? ZE.quest.burn : q.burnT;
    sim._emit({ t: 'zrelic', i, by: p.id, n: lit, of: L.relics.length, lantern: 1 });
    return 0;
  }
  // The wrong one: every lantern goes out, and the fair sends a crowd to the one who lit it.
  q.got = 0; q.burnT = 0;
  sim._emit({ t: 'zlantern', state: 0, i, by: p.id });
  for (let k = 0; k < ZE.quest.wrong; k++) {
    const at = near(E, L.relics[i].x, L.relics[i].z, 4 + k);
    if (at) E._extra(ZK.runner, at);
  }
  return 0;
}

export function stepLanterns(E, dt) {
  const q = E.quest;
  if (q.state) { q.burnT = 0; return; }
  q.burnT -= dt;
  if (q.burnT > 0) return;
  q.burnT = 0; q.got = 0;
  E.sim._emit({ t: 'zlantern', state: 2 });
}

// ---- The Barker ----

export function stepBarker(E, w, dt) {
  const sim = E.sim, R = E.R, q = E.quest, P = ZM_BARKER;
  q.callT -= dt;
  if (q.callT <= 0) {
    q.callT = P.call;
    for (let k = 0; k < P.calls; k++) { const at = near(E, w.ps.x, w.ps.z, 3); if (at) E._extra(ZK.runner, at); }
  }
  const c = q.charge;
  if (c) {
    w.zHoldT = sim.time + 0.25; w.zSwing = 0;
    if (c.t > 0) {
      // Winding up: it stands and faces down its lane.
      c.t -= dt; w.ps.aim = c.a; w.ps.vx = 0; w.ps.vz = 0;
      return;
    }
    c.run += dt;
    const k = Math.min(1, c.run / P.dash), cx = Math.cos(c.a), cz = Math.sin(c.a);
    const x = c.x + cx * c.len * k, z = c.z + cz * c.len * k;
    w.ps.x = x; w.ps.z = z; w.ps.aim = c.a; w.ps.vx = cx * c.len / P.dash; w.ps.vz = cz * c.len / P.dash;
    for (const p of R.crew) {
      if (c.hit.has(p.index) || !p.alive || p.downed || p.away) continue;
      // Within the lane's half width of the stretch it has run so far.
      const t = Math.max(0, Math.min(c.len * k, (p.ps.x - c.x) * cx + (p.ps.z - c.z) * cz));
      if (Math.hypot(p.ps.x - c.x - cx * t, p.ps.z - c.z - cz * t) > P.w / 2 + 0.25) continue;
      c.hit.add(p.index);
      sim._damage(p, w, P.dmg * clawDmg(ZK.barker, R.round) / ZM.kinds.barker.dmg, NO_GUN, 0);
    }
    if (k >= 1) { q.charge = null; q.chargeT = P.every; w.zHoldT = 0; w.ps.vx = 0; w.ps.vz = 0; }
    return;
  }
  q.chargeT -= dt;
  if (q.chargeT > 0) return;
  // Its mark: the nearest of the crew who is up, within range, in its sight.
  let tgt = null, td = P.range;
  for (const p of R.crew) {
    if (!p.alive || p.downed || p.away) continue;
    const d = Math.hypot(p.ps.x - w.ps.x, p.ps.z - w.ps.z);
    if (d < td && d > 2.5 && hasLineOfSight(sim.map, w.ps.x, w.ps.z, p.ps.x, p.ps.z)) { td = d; tgt = p; }
  }
  if (!tgt) { q.chargeT = 0.8; return; }
  const a = Math.atan2(tgt.ps.z - w.ps.z, tgt.ps.x - w.ps.x), cx = Math.cos(a), cz = Math.sin(a);
  // The lane runs on past its mark, up to a wall (it stops short of one).
  let len = 0;
  for (let s = 0.5; s <= P.len; s += 0.5) {
    if (!sim.nav?.isWalkable(w.ps.x + cx * s, w.ps.z + cz * s)) break;
    len = s;
  }
  if (len < 4) { q.chargeT = 0.8; return; }
  q.charge = { x: w.ps.x, z: w.ps.z, a, len, t: P.wind, run: 0, hit: new Set() };
  w.zHoldT = sim.time + P.wind + P.dash + 0.25; w.zSwing = 0;
  sim._emit({ t: 'zcharge', x: r2(w.ps.x), z: r2(w.ps.z), a: r2(a), len: r2(len), w: P.w, wind: P.wind, dash: P.dash });
}

// Where a bot standing at ps should step to get out of a marked lane (sideways, the near side): a unit vector or null.
export function laneDodge(E, ps) {
  const c = E.quest.charge;
  if (!c) return null;
  const cx = Math.cos(c.a), cz = Math.sin(c.a), t = (ps.x - c.x) * cx + (ps.z - c.z) * cz;
  if (t < -1 || t > c.len + 1) return null;
  const side = -(ps.x - c.x) * cz + (ps.z - c.z) * cx;
  if (Math.abs(side) > ZM_BARKER.w / 2 + 0.9) return null;
  const s = side >= 0 ? 1 : -1;
  return { x: -cz * s, z: cx * s };
}

// ---- The Whirligig ----

export function whirlHit(E, target, attacker) {
  const W = ZM_WONDERS.whirl, sim = E.sim, now = sim.time;
  // One whirl a shot (a hit), a few at once.
  if (!((E._whirlT.get(attacker.index) ?? -9) > now - 0.4) && E.whirls.length < W.max) {
    E._whirlT.set(attacker.index, now);
    const x = target.ps.x, z = target.ps.z;
    E.whirls.push({ x, z, t: W.life, by: attacker.index, acc: 0 });
    sim._emit({ t: 'zwhirl', x: r2(x), z: r2(z), r: W.r, life: W.life });
  }
  return isBossKind(target.zk) ? Math.max(1, (target.zMax ?? 1) * W.boss) : Math.max(1, E.R.hp * W.hit);
}

export function stepWhirls(E, dt) {
  const W = ZM_WONDERS.whirl, sim = E.sim, R = E.R, nav = sim.nav, now = sim.time;
  for (let i = E.whirls.length - 1; i >= 0; i--) {
    const v = E.whirls[i], owner = sim.players[v.by];
    v.t -= dt; v.acc += dt;
    const tick = v.acc >= 0.25 ? v.acc : 0;
    if (tick) v.acc = 0;
    for (const q of R.horde) {
      if (!q.alive) continue;
      const dx = v.x - q.ps.x, dz = v.z - q.ps.z, d = Math.hypot(dx, dz);
      if (d > W.r) continue;
      if (!isBossKind(q.zk) && d > 0.3 && hasLineOfSight(sim.map, q.ps.x, q.ps.z, v.x, v.z)) {
        // Dragged in, faster toward the edge: it can neither walk out nor claw while it spins.
        const step = Math.min(d - 0.25, W.pull * dt * (0.45 + 0.55 * d / W.r)), nx = q.ps.x + dx / d * step, nz = q.ps.z + dz / d * step;
        if (!nav || nav.isWalkable(nx, nz)) { q.ps.x = nx; q.ps.z = nz; }
        q.zSwing = 0; q.zCool = Math.max(q.zCool ?? 0, 0.3); q.zSlowT = Math.max(q.zSlowT ?? 0, now + 0.4);
      }
      if (tick && d < W.core && owner?.zm) sim._damage(q, owner, isBossKind(q.zk) ? Math.max(1, q.zMax * W.boss * tick) : R.hp * W.dps * tick, W.gun, 0, 'zfx');
    }
    if (v.t > 0) continue;
    E.whirls.splice(i, 1);
    sim._emit({ t: 'zfx', k: 'whirlpop', x: r2(v.x), z: r2(v.z), r: W.popR });
    if (!owner?.zm) continue;
    for (const q of R.horde) {
      if (!q.alive || Math.hypot(q.ps.x - v.x, q.ps.z - v.z) > W.popR || !hasLineOfSight(sim.map, v.x, v.z, q.ps.x, q.ps.z)) continue;
      sim._damage(q, owner, isBossKind(q.zk) ? Math.max(1, q.zMax * W.boss * 2) : R.hp * W.pop, W.gun, 0, 'zfx');
    }
  }
}
