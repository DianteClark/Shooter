// Saltmere Abbey on the host (docs/ZOMBIES.md "Saltmere Abbey"): the font quest and its boss, the Ferryman. ZmEcon
// (js/sim/zm-econ.js) owns the state (quest.woke, quest.souls, quest.thirst, quest.dive) and calls in:
//   fillFont     a dry font, with the power on (the pumps): filled, it wakes and starts to drink
//   feedFonts    a zombie killed within ZE.quest.fontR of a woken font is a soul in it; ZE.quest.souls fill it (the
//                relic's bit), and the tower bell (the altar slot) calls the Ferryman once all three are full
//   stepFonts    a woken font left thirsty (no kill for ZE.quest.thirst s) loses a soul every ZE.quest.drain s
//   stepFerryman the Ferryman's undertow (it sinks, crosses under the flood to one of the crew and comes up beneath
//                them, a whirlpool ring marking the spot the whole time) and its drowned at its call
// Events: {t:'zfont', i, state: 1 filled | 2 full | 3 a soul lost, n, of, by?}, {t:'zsoul', i, n, x, z, fx, fz} (a soul drunk:
// the wisp flies from the kill to the font), {t:'zdive', x, z, tx, tz, r, sink, warn} (the Ferryman going under, the
// spot it comes up at), {t:'zfx', k: 'surface', x, z, r} (it comes up).
import { ZM, ZE, ZK, ZM_FERRY, NO_GUN, clawDmg, isBossKind } from '../shared/zombies.js';
import { hasLineOfSight, hyp } from '../shared/geometry.js';

const r2 = v => Math.round(v * 100) / 100;

// A walkable spot about `d` m round (x, z), or null.
function near(E, x, z, d) {
  const sim = E.sim;
  for (let k = 0; k < 10; k++) {
    const a = E.R.rng() * Math.PI * 2, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (sim.nav?.isWalkable(px, pz) && hasLineOfSight(sim.map, x, z, px, pz)) return { x: px, z: pz };
  }
  return null;
}

// ---- The fonts ----

export function fillFont(E, p, i) {
  const q = E.quest, L = E.L;
  if (!E.R.power || q.state || !L.relics[i] || q.got & (1 << i) || q.woke & (1 << i)) return null;
  q.woke |= 1 << i;
  q.souls[i] = 0; q.thirst[i] = 0;
  E.sim._emit({ t: 'zfont', i, state: 1, n: 0, of: ZE.quest.souls, by: p.id });
  return 0;
}

// A zombie down at (x, z): the nearest woken font in reach drinks it.
export function feedFonts(E, target) {
  const q = E.quest, L = E.L;
  if (q.state || !q.woke) return;
  let best = null, bd = ZE.quest.fontR;
  for (const r of L.relics) {
    if (!(q.woke & (1 << r.i)) || q.got & (1 << r.i)) continue;
    const d = hyp(target.ps.x - r.x, target.ps.z - r.z);
    if (d < bd) { bd = d; best = r; }
  }
  if (!best) return;
  const i = best.i, n = Math.min(ZE.quest.souls, (q.souls[i] ?? 0) + 1);
  q.souls[i] = n; q.thirst[i] = 0;
  E.sim._emit({ t: 'zsoul', i, n, x: r2(target.ps.x), z: r2(target.ps.z), fx: best.x, fz: best.z });
  if (n < ZE.quest.souls) return;
  q.got |= 1 << i; q.woke &= ~(1 << i);
  const full = L.relics.filter(r => q.got & (1 << r.i)).length;
  E.sim._emit({ t: 'zfont', i, state: 2, n: full, of: L.relics.length });
  E.sim._emit({ t: 'zrelic', i, by: null, n: full, of: L.relics.length, font: 1 });
}

export function stepFonts(E, dt) {
  const q = E.quest, Q = ZE.quest;
  if (q.state) { q.woke = 0; return; }
  if (E.R.state !== 1) return;      // Between rounds there is nothing to drink: no thirst.
  for (let i = 0; i < E.L.relics.length; i++) {
    if (!(q.woke & (1 << i))) continue;
    q.thirst[i] = (q.thirst[i] ?? 0) + dt;
    if (q.thirst[i] < Q.thirst || !(q.souls[i] > 0)) continue;
    q.thirst[i] = Q.thirst - Q.drain;
    q.souls[i]--;
    E.sim._emit({ t: 'zfont', i, state: 3, n: q.souls[i], of: Q.souls });
  }
}

// ---- The Ferryman ----

export function stepFerryman(E, w, dt) {
  const sim = E.sim, R = E.R, q = E.quest, P = ZM_FERRY;
  q.callT -= dt;
  if (q.callT <= 0) {
    q.callT = P.call;
    let up = 0;
    for (const z of R.horde) if (z.alive && z.zExtra && !isBossKind(z.zk)) up++;
    for (let k = 0; k < Math.min(P.calls, P.crowd - up); k++) { const at = near(E, w.ps.x, w.ps.z, 3); if (at) E._extra(ZK.shambler, at); }
  }
  const d = q.dive;
  if (d) {
    w.zHoldT = sim.time + 0.25; w.zSwing = 0; w.ps.vx = 0; w.ps.vz = 0;
    d.t += dt;
    if (d.t < P.sink) return;
    if (d.t < P.warn) {
      // Under the flood, crossing to the spot (the guests' copy moves with it, drawn under the water).
      const k = Math.min(1, (d.t - P.sink) / Math.max(0.05, P.warn - P.sink - 0.1));
      w.ps.x = d.x + (d.tx - d.x) * k; w.ps.z = d.z + (d.tz - d.z) * k;
      return;
    }
    // Up beneath them: whoever is still inside the ring is caught.
    w.ps.x = d.tx; w.ps.z = d.tz;
    w.zUnderT = 0;
    q.dive = null; q.diveT = P.every;
    w.zHoldT = sim.time + P.hold;
    sim._emit({ t: 'zfx', k: 'surface', x: r2(d.tx), z: r2(d.tz), r: P.r });
    for (const p of R.crew) {
      if (!p.alive || p.downed || p.away || hyp(p.ps.x - d.tx, p.ps.z - d.tz) > P.r) continue;
      sim._damage(p, w, P.dmg * clawDmg(ZK.ferryman, R.round) / ZM.kinds.ferryman.dmg, NO_GUN, 0);
    }
    return;
  }
  if (w.zHoldT > sim.time) return;
  q.diveT -= dt;
  if (q.diveT > 0) return;
  // Its mark: the nearest of the crew who is up more than 3 m off (else the nearest at all), within range, where it can
  // come up (walkable floor).
  let tgt = null, td = Infinity;
  for (const p of R.crew) {
    if (!p.alive || p.downed || p.away) continue;
    const dd = hyp(p.ps.x - w.ps.x, p.ps.z - w.ps.z);
    const sc = dd > 3 ? dd : dd + P.range;
    if (dd < P.range && sc < td && sim.nav?.isWalkable(p.ps.x, p.ps.z)) { td = sc; tgt = p; }
  }
  if (!tgt) { q.diveT = 0.8; return; }
  const tx = tgt.ps.x, tz = tgt.ps.z;
  q.dive = { x: w.ps.x, z: w.ps.z, tx, tz, t: 0 };
  w.zUnderT = sim.time + P.warn + 0.5;
  w.zHoldT = sim.time + P.warn + 0.25; w.zSwing = 0;
  sim._emit({ t: 'zdive', x: r2(w.ps.x), z: r2(w.ps.z), tx: r2(tx), tz: r2(tz), r: P.r, sink: P.sink, warn: P.warn });
}

// Where a bot standing at ps should step to get off the Ferryman's ring: a unit vector or null.
export function diveDodge(E, ps) {
  const d = E.quest.dive;
  if (!d) return null;
  const dx = ps.x - d.tx, dz = ps.z - d.tz, l = hyp(dx, dz);
  if (l > ZM_FERRY.r + 0.8) return null;
  return l > 0.05 ? { x: dx / l, z: dz / l } : { x: 1, z: 0 };
}
