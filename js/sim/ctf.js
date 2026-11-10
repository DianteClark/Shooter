// Capture the Flag, the host side: two flags, taking, carrying, dropping, returning and capturing. The Sim owns one of
// these when the mode is 'ctf' and calls in at the few places the mode changes ordinary play (see the `this.ctf` checks
// in sim.js). Ordinary respawns, streaks and the match clock all work as in Team Deathmatch.
//
// Each team's flag stands at its base (map.points.ctf, one per team, at the back of its own end). Touching the enemy
// flag (within CTF.reach) takes it, from its stand or from wherever it was dropped. Carrying it to your own flag scores a
// capture, but only while your own flag is home. A carrier who dies drops the flag where they fell; touching your own
// dropped flag sends it home at once, and a dropped flag nobody touches goes home by itself after CTF.returnTime. A
// carrier cannot slide (player.js `noSlide`), so the run home is at running and sprinting pace only.
//
// sim.scores are captures. First to scoreLimit wins; at the time limit the team with more captures does, and a tie is
// a draw (the sim's ordinary clock handles both).
//
// Events: {t:'ctf', kind:'take'|'drop'|'return'|'capture', team, id?, x?, z?, from?, auto?}. `team` is always the team
// whose flag it is; `id` the player who did it (none for a return on the clock). Medals: flag_take, flag_capture,
// flag_return, carrier_kill, flag_defend.

import { CTF, CTF_STATES } from '../shared/modes.js';
import { addScore } from './streaks.js';

const r2 = v => Math.round(v * 100) / 100;

export class CtfRules {
  constructor(sim) {
    this.sim = sim;
    const defs = sim.map.points?.ctf ?? [];
    // One base per team, in team order, whatever order the map lists them in.
    this.bases = [0, 1].map(t => {
      const d = defs.find(b => b.team === t) ?? defs[t] ?? { x: t ? sim.map.width - 6 : 6, z: sim.map.height / 2 };
      return { team: t, x: d.x, z: d.z };
    });
    this.flags = this.bases.map(b => ({ team: b.team, state: 'home', carrier: null, x: b.x, z: b.z, returnT: 0 }));
  }

  // The flag a player is carrying, or null.
  carried(p) {
    for (const f of this.flags) if (f.state === 'carried' && f.carrier === p) return f;
    return null;
  }
  isCarrier(p) { return !!this.carried(p); }

  // ---- The rules, one fixed tick at a time while the match is live ----

  step(dt) {
    const sim = this.sim;
    for (const f of this.flags) {
      if (sim.phase !== 'live') return;           // A capture can end the match part way through.
      if (f.state === 'carried') {
        const c = f.carrier;
        if (!c || !c.alive) { this._drop(f, f.x, f.z); continue; }
        f.x = c.ps.x; f.z = c.ps.z;
        // Home with it: scores only while the carrier's own flag stands at its base.
        const own = this.flags[c.team], base = this.bases[c.team];
        if (own.state === 'home' && Math.hypot(c.ps.x - base.x, c.ps.z - base.z) <= CTF.reach) this._capture(f, c);
        continue;
      }
      if (f.state === 'dropped') {
        f.returnT -= dt;
        if (f.returnT <= 0) { this._return(f, null); continue; }
      }
      // Home or dropped: the nearest living player touching it acts on it. Their own team returns a dropped flag (a
      // flag at home needs nothing from them); the enemy takes it.
      const toucher = this._nearest(f.x, f.z, f.state === 'home' ? 1 - f.team : -1);
      if (!toucher) continue;
      if (toucher.team === f.team) this._return(f, toucher);
      else this._take(f, toucher);
    }
  }

  // The nearest living player within reach of (x, z); `team` >= 0 limits it to that team.
  _nearest(x, z, team) {
    let best = null, bestD = CTF.reach;
    for (const p of this.sim.players) {
      if (!p.alive || p.dummy || (team >= 0 && p.team !== team)) continue;
      const d = Math.hypot(p.ps.x - x, p.ps.z - z);
      if (d <= bestD) { bestD = d; best = p; }
    }
    return best;
  }

  _take(f, p) {
    const from = f.state === 'home' ? 'base' : 'field';
    f.state = 'carried'; f.carrier = p; f.returnT = 0;
    f.x = p.ps.x; f.z = p.ps.z;
    p.ps.noSlide = true;
    p.ps.sliding = false;
    p.spawnProtect = 0;                  // Spawn protection is for spawning, not for running a flag out of a spawn.
    p.flagTakes = (p.flagTakes ?? 0) + 1;
    addScore(p.score, CTF.score.take);
    this.sim._medal(p, 'flag_take');
    this.sim._emit({ t: 'ctf', kind: 'take', team: f.team, id: p.id, from, x: r2(f.x), z: r2(f.z) });
  }

  _drop(f, x, z) {
    const c = f.carrier, nav = this.sim.nav;
    if (c) c.ps.noSlide = false;
    // Where it lands has to be somewhere a player can stand.
    if (nav && !nav.isWalkable(x, z)) {
      const k = nav.nearestFree(x, z);
      x = k % nav.w + 0.5; z = Math.floor(k / nav.w) + 0.5;
    }
    f.state = 'dropped'; f.carrier = null; f.x = x; f.z = z; f.returnT = CTF.returnTime;
    this.sim._emit({ t: 'ctf', kind: 'drop', team: f.team, id: c?.id ?? null, x: r2(x), z: r2(z) });
  }

  // Home again: by a defender's touch (`p`), or on its own once the return clock runs out (p null).
  _return(f, p) {
    const b = this.bases[f.team];
    if (f.carrier) f.carrier.ps.noSlide = false;
    f.state = 'home'; f.carrier = null; f.x = b.x; f.z = b.z; f.returnT = 0;
    const ev = { t: 'ctf', kind: 'return', team: f.team };
    if (p) {
      p.returns = (p.returns ?? 0) + 1;
      addScore(p.score, CTF.score.ret);
      this.sim._medal(p, 'flag_return');
      ev.id = p.id;
    } else ev.auto = true;
    this.sim._emit(ev);
  }

  _capture(f, p) {
    const sim = this.sim, b = this.bases[f.team];
    p.ps.noSlide = false;
    f.state = 'home'; f.carrier = null; f.x = b.x; f.z = b.z; f.returnT = 0;
    p.captures = (p.captures ?? 0) + 1;
    sim.scores[p.team]++;
    addScore(p.score, CTF.score.capture);
    sim._medal(p, 'flag_capture');
    sim._emit({ t: 'ctf', kind: 'capture', team: f.team, id: p.id, x: r2(p.ps.x), z: r2(p.ps.z), score: sim.scores.slice(0, 2) });
    if (sim.scores[p.team] >= sim.scoreLimit) {
      // The capture decided it, not a kill: the final replay would show some earlier, unrelated fight.
      sim.lastKill = null;
      sim._end(p.team);
    }
  }

  // ---- Hooks from the sim ----

  // A carrier who dies drops the flag where they fell; killing them is a carrier kill for whoever did it. Any other kill
  // close to the killer's own flag (at home or lying dropped) defends it.
  onKill(target, killer) {
    const f = this.carried(target);
    const enemy = killer && killer !== target && killer.team !== target.team;
    if (f) {
      this._drop(f, target.ps.x, target.ps.z);
      if (enemy) {
        killer.carrierKills = (killer.carrierKills ?? 0) + 1;
        addScore(killer.score, CTF.score.carrierKill);
        this.sim._medal(killer, 'carrier_kill');
      }
      return;
    }
    if (!enemy) return;
    const own = this.flags[killer.team];
    if (own.state === 'carried') return;
    const near = Math.hypot(target.ps.x - own.x, target.ps.z - own.z) <= CTF.defend
      || Math.hypot(killer.ps.x - own.x, killer.ps.z - own.z) <= CTF.defend;
    if (!near) return;
    killer.flagDefends = (killer.flagDefends ?? 0) + 1;
    addScore(killer.score, CTF.score.defend);
    this.sim._medal(killer, 'flag_defend');
  }

  // Respawning on the enemy's half would hand them a spawn right next to their own flag (or put a defender on top of
  // the enemy's): every point closer to the enemy base than to your own is ruled out in all but name.
  spawnFlow(p, s) {
    const own = this.bases[p.team], foe = this.bases[1 - p.team];
    const dOwn = Math.hypot(s.x - own.x, s.z - own.z), dFoe = Math.hypot(s.x - foe.x, s.z - foe.z);
    return dFoe < dOwn ? -80 : 0;
  }

  // ---- View and wire ----

  view() {
    return {
      toWin: this.sim.scoreLimit,
      flags: this.flags.map(f => ({
        team: f.team, state: f.state, carrier: f.state === 'carried' ? f.carrier.id : null,
        x: f.x, z: f.z, returnT: f.state === 'dropped' ? Math.max(0, f.returnT) : 0,
        baseX: this.bases[f.team].x, baseZ: this.bases[f.team].z,
      })),
    };
  }

  // Objective block of the snapshot: per flag [state, carrier index, x ds, z ds, return ds], then the per-player tallies
  // as [index, captures, returns, carrier kills] for anyone with any.
  encode() {
    const out = [];
    for (const f of this.flags) {
      out.push(CTF_STATES.indexOf(f.state), f.state === 'carried' ? f.carrier.index : -1,
        Math.round(f.x * 10), Math.round(f.z * 10), Math.ceil(Math.max(0, f.returnT) * 10));
    }
    for (const p of this.sim.players) {
      if (p.captures || p.returns || p.carrierKills) out.push(p.index, p.captures ?? 0, p.returns ?? 0, p.carrierKills ?? 0);
    }
    return out;
  }
}

// The inverse of CtfRules.encode, on any sim (guests only decode). Writes the tallies onto view.players and returns
// the view's `ctf` object.
export function decodeCtf(sim, a, players) {
  const defs = sim.map.points?.ctf ?? [];
  const base = t => defs.find(b => b.team === t) ?? defs[t] ?? { x: 0, z: 0 };
  const flags = [];
  for (let t = 0; t < 2; t++) {
    const k = t * 5, state = (a && CTF_STATES[a[k]]) || 'home', b = base(t);
    const carrier = a && a[k + 1] >= 0 ? sim.players[a[k + 1]]?.id ?? null : null;
    flags.push({
      team: t, state: state === 'carried' && !carrier ? 'dropped' : state, carrier: state === 'carried' ? carrier : null,
      x: a ? a[k + 2] / 10 : b.x, z: a ? a[k + 3] / 10 : b.z, returnT: a ? a[k + 4] / 10 : 0, baseX: b.x, baseZ: b.z,
    });
  }
  for (const p of players) { p.captures = 0; p.returns = 0; p.carrierKills = 0; }
  if (a) {
    for (let i = 10; i + 3 < a.length; i += 4) {
      const p = players[a[i]];
      if (p) { p.captures = a[i + 1]; p.returns = a[i + 2]; p.carrierKills = a[i + 3]; }
    }
  }
  return { toWin: sim.scoreLimit, flags };
}

// Host migration: picks both flags up from a decoded view. A carrier the new host no longer has alive drops the flag
// where it was last seen.
export function restoreCtf(rules, view) {
  const c = view.ctf ?? view.points?.ctf;
  const sim = rules.sim;
  for (let i = 0; i < view.players.length && i < sim.players.length; i++) {
    const v = view.players[i], p = sim.players[i];
    p.captures = v.captures ?? 0; p.returns = v.returns ?? 0; p.carrierKills = v.carrierKills ?? 0;
    p.ps.noSlide = false;
  }
  if (!c) return;
  for (const v of c.flags) {
    const f = rules.flags[v.team];
    if (!f) continue;
    f.state = v.state; f.x = v.x; f.z = v.z; f.returnT = v.returnT ?? 0;
    f.carrier = v.carrier ? sim.byId.get(v.carrier) ?? null : null;
    if (f.state === 'carried' && !(f.carrier && f.carrier.alive)) { f.state = 'dropped'; f.carrier = null; f.returnT = f.returnT || CTF.returnTime; }
    if (f.state === 'carried') f.carrier.ps.noSlide = true;
    if (f.state === 'home') { f.x = rules.bases[f.team].x; f.z = rules.bases[f.team].z; }
  }
}

// The CTF state on any view: the sim's and decoded views carry it as `view.ctf`; an interpolated view (js/game/interp.js
// copies a fixed list of fields) still has it on the point list it does copy, `view.points.ctf`.
export function ctfOf(view) {
  return view?.ctf ?? view?.points?.ctf ?? null;
}

// Whether `id` carries a flag in this view. The phone of a human carrier applies the no-slide rule to its own player
// state with this (js/game/match.js), since a human's movement runs on their phone, not on the host.
export function ctfCarrying(view, id) {
  const c = ctfOf(view);
  if (!c || id == null) return false;
  for (const f of c.flags) if (f.state === 'carried' && f.carrier === id) return true;
  return false;
}
