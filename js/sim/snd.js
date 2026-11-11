// Search and Destroy, the host side: rounds, the bomb, planting and defusing. The Sim owns one of these when the mode is
// 'snd' and calls in at the few places a round changes ordinary play (see the `this.snd` checks in sim.js).
//
// A match is rounds of one life each. The attackers set out from the west spawns with one bomb, carried by one of
// them; the defenders start at the east spawns, next to the two sites (map.points.snd). Sides swap after SND.halftime
// rounds, and the first team to scoreLimit rounds wins: sim.scores are rounds won. A round ends when one side is wiped
// out (unless the bomb is down and the attackers are the ones gone: then it still has to be defused), the bomb goes
// off, the bomb is defused, or the round clock runs out with no bomb planted.
//
// Round flow: 'freeze' (sim phase 'warmup': everyone held at the spawns, loadouts can still change), 'live', then
// 'post' (phase stays 'live' so players can move, but nothing hurts anyone) and the next freeze. The deciding round
// ends the match at once, so the final replay is the kill that decided it.
//
// Planting and defusing need no button: standing still (under SND.still m/s) on a site with the bomb plants it in
// SND.plant seconds, standing still by the planted bomb defuses it in SND.defuse. Moving or taking damage starts
// either over from nothing.

import { SND, SND_REASONS } from '../shared/modes.js';
import { MAX_HP } from '../shared/constants.js';

const STATES = ['freeze', 'live', 'post'];
const BOMB_STATES = ['none', 'carried', 'dropped', 'planted', 'defused', 'exploded'];
const r2 = v => Math.round(v * 100) / 100;

export class SndRules {
  constructor(sim) {
    this.sim = sim;
    this.sites = sim.zones;            // The two sites, as sim zones (id 'A' and 'B', x, z, r).
    this.round = 0;
    this.attackers = 0;
    this.state = 'freeze';
    this.postT = 0;
    this.history = [];                 // [{winner, reason}] per finished round.
    this.bomb = { state: 'none', carrier: null, x: 0, z: 0, site: -1, fuse: 0, planter: null };
    this.plant = { p: null, t: 0 };
    this.defuse = { p: null, t: 0 };
    this.last = [null, null];          // Per team: who became its last one standing this round, and the enemies left then.
  }

  get live() { return this.state === 'live' && this.sim.phase === 'live'; }
  // Whether gunfire, grenades and blasts hurt anyone right now. Not in the gap between rounds.
  get combat() { return this.state === 'live'; }
  get defenders() { return 1 - this.attackers; }

  // Which end of the map a team starts from this round: 0 is the west spawns. Attackers always come from the west.
  sideOf(team) { return team === this.attackers ? 0 : 1; }

  // ---- Rounds ----

  // Everyone back at their end with full health and a fresh loadout (the spawn event rearms each phone), the map wiped
  // of last round's grenades, smoke and fire, the bomb handed to one attacker, and the freeze clock running.
  startRound() {
    const sim = this.sim;
    this.round++;
    // Halftime: the teams trade roles, and with them ends of the map.
    this.attackers = this.round > SND.halftime ? 1 : 0;
    this.state = 'freeze';
    this.postT = 0;
    this.bomb.state = 'none'; this.bomb.carrier = null; this.bomb.site = -1; this.bomb.fuse = 0; this.bomb.planter = null;
    this.plant.p = null; this.plant.t = 0;
    this.defuse.p = null; this.defuse.t = 0;
    this.last[0] = this.last[1] = null;
    sim.eq.reset();
    sim.strikes.length = 0; sim.mortars.length = 0; sim.gunships.length = 0;
    for (let i = sim.turrets.length - 1; i >= 0; i--) sim._removeTurret(sim.turrets[i]);
    sim.callouts.length = 0;
    sim.uav.fill(0); sim.jam.fill(0); sim.jamBy.fill(0); sim.overwatch.fill(0);
    sim.lastKill = null;                // The final replay only ever shows a kill from the round that decided it.
    sim.hot = null;
    for (let t = 0; t < 2; t++) {
      const list = sim.map.spawns[this.sideOf(t)], used = new Set();
      for (const p of sim.players) {
        if (p.team !== t || p.dummy) continue;
        let s = list[0];
        for (let tries = 0; tries < 24; tries++) {
          s = list[Math.floor(sim.rng() * list.length)];
          if (!used.has(s)) break;
        }
        used.add(s);
        sim._placeAt(p, s, this.sideOf(t) === 0 ? 0 : Math.PI);
      }
    }
    const crew = sim.players.filter(p => p.team === this.attackers && p.alive);
    if (crew.length) this._give(crew[Math.floor(sim.rng() * crew.length)], false);
    sim.timeLeft = sim.timeLimit;
    sim.phaseT = SND.freeze;
    if (sim.phase !== 'warmup') sim._setPhase('warmup');
    const ev = { t: 'snd', kind: 'round', round: this.round, attackers: this.attackers };
    if (this.round === SND.halftime + 1) ev.halftime = true;
    // Match point: either side one round from the win.
    const need = sim.scoreLimit - 1;
    if (sim.scores[0] === need || sim.scores[1] === need) ev.matchPoint = sim.scores[0] === need && sim.scores[1] === need ? 2 : sim.scores[0] === need ? 0 : 1;
    sim._emit(ev);
  }

  // The freeze is over (sim._setPhase('live')).
  onLive() {
    this.state = 'live';
    this.sim.timeLeft = this.sim.timeLimit;
    this.sim._emit({ t: 'snd', kind: 'go', round: this.round });
  }

  // One fixed tick while the sim phase is 'live'.
  step(dt) {
    const sim = this.sim;
    if (this.state === 'post') {
      this.postT -= dt;
      if (this.postT <= 0) this.startRound();
      return;
    }
    if (this.state !== 'live') return;
    const b = this.bomb;
    if (b.state === 'planted') {
      b.fuse -= dt;
      if (b.fuse <= 0) { this._detonate(); return; }
      this._stepDefuse(dt);
      if (b.state !== 'planted') return;
    } else {
      sim.timeLeft = Math.max(0, sim.timeLeft - dt);
      if (b.state === 'dropped') this._stepPickup();
      if (b.state === 'carried') this._stepPlant(dt);
      if (b.state === 'planted') return;
      if (sim.timeLeft <= 0) { this._roundEnd(this.defenders, 'time'); return; }
    }
    this._checkElimination();
  }

  _alive(team) {
    let n = 0;
    for (const p of this.sim.players) if (p.team === team && p.alive && !p.dummy) n++;
    return n;
  }

  // A side with nobody left loses, except that a planted bomb outlives the attackers who planted it.
  _checkElimination() {
    const att = this._alive(this.attackers), def = this._alive(this.defenders);
    const planted = this.bomb.state === 'planted';
    if (def === 0 && (att > 0 || planted)) this._roundEnd(this.attackers, 'elim');
    else if (att === 0 && !planted) this._roundEnd(this.defenders, 'elim');
  }

  _roundEnd(winner, reason) {
    const sim = this.sim;
    if (this.state !== 'live') return;
    this.plant.p = null; this.plant.t = 0;
    this.defuse.p = null; this.defuse.t = 0;
    sim.scores[winner]++;
    this.history.push({ winner, reason });
    this.state = 'post';
    this.postT = SND.post;
    const ev = { t: 'snd', kind: 'end', round: this.round, winner, reason };
    // Clutch: the winning side's last one standing, who was outnumbered when they became it.
    const lone = this.last[winner];
    if (lone && lone.p.alive && lone.foes >= 2) { ev.clutch = lone.p.id; sim._medal(lone.p, 'clutch'); }
    sim._emit(ev);
    if (sim.scores[winner] >= sim.scoreLimit) sim._end(winner);
  }

  // ---- The bomb ----

  _give(p, announce = true) {
    const b = this.bomb;
    b.state = 'carried'; b.carrier = p; b.x = p.ps.x; b.z = p.ps.z;
    this.plant.p = null; this.plant.t = 0;
    if (announce) this.sim._emit({ t: 'snd', kind: 'pickup', id: p.id });
  }

  _drop(x, z) {
    const b = this.bomb, nav = this.sim.nav;
    // Where it lands has to be somewhere an attacker can stand.
    if (nav && !nav.isWalkable(x, z)) {
      const k = nav.nearestFree(x, z);
      x = (k % nav.w + 0.5); z = (Math.floor(k / nav.w) + 0.5);
    }
    b.state = 'dropped'; b.carrier = null; b.x = x; b.z = z;
    this.plant.p = null; this.plant.t = 0;
    this.sim._emit({ t: 'snd', kind: 'drop', x: r2(x), z: r2(z) });
  }

  _stepPickup() {
    const b = this.bomb;
    let best = null, bestD = SND.pickup;
    for (const p of this.sim.players) {
      if (p.team !== this.attackers || !p.alive) continue;
      const d = Math.hypot(p.ps.x - b.x, p.ps.z - b.z);
      if (d <= bestD) { bestD = d; best = p; }
    }
    if (best) this._give(best);
  }

  _still(p) { return Math.hypot(p.ps.vx, p.ps.vz) < SND.still && !p.ps.sliding; }

  _siteAt(x, z) {
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i];
      if (Math.hypot(x - s.x, z - s.z) <= s.r) return i;
    }
    return -1;
  }

  _stepPlant(dt) {
    const b = this.bomb, c = b.carrier, pl = this.plant;
    b.x = c.ps.x; b.z = c.ps.z;
    const site = c.alive ? this._siteAt(c.ps.x, c.ps.z) : -1;
    if (site < 0 || !this._still(c)) { this._stopPlant(); return; }
    if (pl.p !== c) {
      pl.p = c; pl.t = 0; pl.site = site;
      this.sim._emit({ t: 'snd', kind: 'planting', id: c.id, site: this.sites[site].id });
    }
    pl.t += dt;
    if (pl.t >= SND.plant) this._planted(c, site);
  }

  _stopPlant() {
    const pl = this.plant;
    if (!pl.p) return;
    this.sim._emit({ t: 'snd', kind: 'stop', id: pl.p.id, what: 'plant' });
    pl.p = null; pl.t = 0;
  }

  _planted(p, site) {
    const sim = this.sim, b = this.bomb;
    b.state = 'planted'; b.carrier = null; b.site = site; b.fuse = SND.fuse; b.planter = p;
    b.x = p.ps.x; b.z = p.ps.z;
    this.plant.p = null; this.plant.t = 0;
    p.plants = (p.plants ?? 0) + 1;
    sim._medal(p, 'plant');
    sim._emit({ t: 'snd', kind: 'planted', id: p.id, site: this.sites[site].id, x: r2(b.x), z: r2(b.z) });
  }

  // The defuser keeps it while they qualify; otherwise the nearest defender standing still at the bomb takes over.
  _stepDefuse(dt) {
    const b = this.bomb, df = this.defuse;
    const ok = p => p && p.alive && p.team === this.defenders && this._still(p) && Math.hypot(p.ps.x - b.x, p.ps.z - b.z) <= SND.defuseReach;
    if (!ok(df.p)) {
      let best = null, bestD = Infinity;
      for (const p of this.sim.players) {
        if (!ok(p)) continue;
        const d = Math.hypot(p.ps.x - b.x, p.ps.z - b.z);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (df.p && df.p !== best) this.sim._emit({ t: 'snd', kind: 'stop', id: df.p.id, what: 'defuse' });
      df.p = best; df.t = 0;
      if (!best) return;
      this.sim._emit({ t: 'snd', kind: 'defusing', id: best.id });
    }
    df.t += dt;
    if (df.t < SND.defuse) return;
    const p = df.p;
    p.defuses = (p.defuses ?? 0) + 1;
    b.state = 'defused';
    df.p = null; df.t = 0;
    this.sim._medal(p, 'defuse');
    this.sim._emit({ t: 'snd', kind: 'defused', id: p.id, x: r2(b.x), z: r2(b.z) });
    this.sim.lastKill = null;
    this._roundEnd(this.defenders, 'defuse');
  }

  // Everyone inside the blast dies, whichever side: walls do not save you from this one. The planter is credited with
  // the defenders it takes; an attacker caught in it is put down as their own.
  _detonate() {
    const sim = this.sim, b = this.bomb, planter = b.planter;
    b.state = 'exploded'; b.fuse = 0;
    this.defuse.p = null; this.defuse.t = 0;
    sim._emit({ t: 'explosion', x: r2(b.x), z: r2(b.z), radius: SND.blast, by: planter?.id ?? null });
    sim._emit({ t: 'snd', kind: 'exploded', x: r2(b.x), z: r2(b.z) });
    sim.eq.setOffMines(b.x, b.z, SND.blast);
    for (const q of sim.players) {
      if (!q.alive || q.dummy) continue;
      const d = Math.hypot(q.ps.x - b.x, q.ps.z - b.z);
      if (d > SND.blast) continue;
      q.spawnProtect = 0;
      if (planter && q.team !== planter.team) sim._damage(q, planter, MAX_HP * 3, planter.ps.weapon, d, null, false, 'bomb');
      else sim._selfKill(q, 'bomb');
    }
    sim.lastKill = null;
    this._roundEnd(this.attackers, 'bomb');
  }

  // ---- Hooks from the sim ----

  onDamaged(target) {
    if (this.plant.p === target) this._stopPlant();
    if (this.defuse.p === target) {
      this.sim._emit({ t: 'snd', kind: 'stop', id: target.id, what: 'defuse' });
      this.defuse.p = null; this.defuse.t = 0;
    }
  }

  onKill(target) {
    if (this.bomb.state === 'carried' && this.bomb.carrier === target) this._drop(target.ps.x, target.ps.z);
    this.onDamaged(target);
    // Who is now the last of their side, and how many they face.
    const t = target.team;
    if (this.state === 'live' && this._alive(t) === 1 && !this.last[t]) {
      const p = this.sim.players.find(q => q.team === t && q.alive && !q.dummy);
      this.last[t] = { p, foes: this._alive(1 - t) };
    }
  }

  // A loadout picked during the freeze is put on at once: same spot, fresh kit (the spawn event rearms the phone).
  // Otherwise it waits for the next round, like any loadout change.
  onLoadout(p) {
    if (this.state !== 'freeze' || !p.alive) return;
    this.sim._placeAt(p, { x: p.ps.x, z: p.ps.z }, p.ps.aim);
  }

  // ---- View and wire ----

  view() {
    const b = this.bomb, pl = this.plant, df = this.defuse, sim = this.sim;
    return {
      state: this.state, round: this.round, attackers: this.attackers, toWin: sim.scoreLimit,
      carrier: b.state === 'carried' ? b.carrier.id : null,
      bomb: { state: b.state, x: b.x, z: b.z, site: b.site >= 0 ? this.sites[b.site].id : null },
      fuse: b.state === 'planted' ? Math.max(0, b.fuse) : 0,
      plant: pl.p ? { id: pl.p.id, t: Math.min(1, pl.t / SND.plant), site: this.sites[pl.site]?.id ?? null } : null,
      defuse: df.p ? { id: df.p.id, t: Math.min(1, df.t / SND.defuse) } : null,
      clock: this.state === 'freeze' ? Math.max(0, sim.phaseT) : this.state === 'post' ? Math.max(0, this.postT) : 0,
      planter: b.planter ? b.planter.id : null,
      history: this.history.map(h => ({ winner: h.winner, reason: h.reason })),
    };
  }

  // Objective block of the snapshot: [state, round, attackers, carrier index, bomb state, x ds, z ds, site, fuse ds,
  // planter index, plant cs, defuser index, defuse cs, clock ds, bomb planter index, n history, history..., stats...].
  // The first "planter" is whoever is planting now; the bomb's planter is who planted it (credited with its kills).
  // History entries are
  // winner * 4 + reason index; stats are index * 65536 + plants * 256 + defuses for anyone with either.
  encode() {
    const b = this.bomb, sim = this.sim;
    const out = [
      STATES.indexOf(this.state), this.round, this.attackers, b.state === 'carried' ? b.carrier.index : -1,
      BOMB_STATES.indexOf(b.state), Math.round(b.x * 10), Math.round(b.z * 10), b.site, Math.round(Math.max(0, b.fuse) * 10),
      this.plant.p ? this.plant.p.index : -1, Math.round(this.plant.t * 100), this.defuse.p ? this.defuse.p.index : -1,
      Math.round(this.defuse.t * 100), Math.round(this.view().clock * 10), b.planter ? b.planter.index : -1, this.history.length,
    ];
    for (const h of this.history) out.push(h.winner * 4 + SND_REASONS.indexOf(h.reason));
    for (const p of sim.players) if (p.plants || p.defuses) out.push(p.index * 65536 + (p.plants ?? 0) * 256 + (p.defuses ?? 0));
    return out;
  }
}

// The inverse of SndRules.encode, on any sim (guests only decode). Writes plants and defuses onto view.players and
// returns the view's `snd` object.
export function decodeSnd(sim, a, players) {
  if (!a) return null;
  const idOf = i => (i >= 0 ? sim.players[i]?.id ?? null : null);
  const sites = sim.zones;
  const nHist = a[15], history = [];
  for (let i = 0; i < nHist; i++) { const c = a[16 + i]; history.push({ winner: c >> 2, reason: SND_REASONS[c & 3] }); }
  for (const p of players) { p.plants = 0; p.defuses = 0; }
  for (let i = 16 + nHist; i < a.length; i++) {
    const p = players[a[i] >> 16];
    if (p) { p.plants = (a[i] >> 8) & 255; p.defuses = a[i] & 255; }
  }
  const bombState = BOMB_STATES[a[4]] ?? 'none';
  // The site a plant is happening on: the one the planter stands in.
  const planter = a[9] >= 0 ? players[a[9]] : null;
  const plantSite = planter ? sites.find(z => Math.hypot(planter.x - z.x, planter.z - z.z) <= z.r)?.id ?? null : null;
  return {
    state: STATES[a[0]] ?? 'live', round: a[1], attackers: a[2], toWin: sim.scoreLimit,
    carrier: bombState === 'carried' ? idOf(a[3]) : null,
    bomb: { state: bombState, x: a[5] / 10, z: a[6] / 10, site: a[7] >= 0 ? sites[a[7]]?.id ?? null : null },
    fuse: a[8] / 10,
    plant: a[9] >= 0 ? { id: idOf(a[9]), t: Math.min(1, a[10] / 100 / SND.plant), site: plantSite } : null,
    defuse: a[11] >= 0 ? { id: idOf(a[11]), t: Math.min(1, a[12] / 100 / SND.defuse) } : null,
    clock: a[13] / 10,
    planter: idOf(a[14]),
    history,
  };
}

// Host migration: picks the round up from a decoded view. Plant and defuse progress in flight start over.
export function restoreSnd(rules, view) {
  const s = view.snd ?? view.points?.snd;
  if (!s) return;
  const sim = rules.sim;
  rules.round = s.round; rules.attackers = s.attackers; rules.state = s.state;
  rules.history = s.history.map(h => ({ ...h }));
  rules.postT = s.state === 'post' ? s.clock : 0;
  if (s.state === 'freeze') sim.phaseT = Math.max(0.5, s.clock);
  const b = rules.bomb;
  b.state = s.bomb.state; b.x = s.bomb.x; b.z = s.bomb.z; b.fuse = s.fuse;
  b.site = s.bomb.site ? rules.sites.findIndex(z => z.id === s.bomb.site) : -1;
  b.carrier = s.carrier ? sim.byId.get(s.carrier) ?? null : null;
  if (b.state === 'carried' && !b.carrier) b.state = 'dropped';
  b.planter = s.planter ? sim.byId.get(s.planter) ?? null : null;
  rules.plant.p = null; rules.plant.t = 0;
  rules.defuse.p = null; rules.defuse.t = 0;
  for (let i = 0; i < view.players.length && i < sim.players.length; i++) {
    sim.players[i].plants = view.players[i].plants ?? 0;
    sim.players[i].defuses = view.players[i].defuses ?? 0;
  }
}

// The S&D state on any view: the sim's and decoded views carry it as `view.snd`; an interpolated view (js/game/interp.js
// copies a fixed list of fields) still has it on the site list it does copy, `view.points.snd`.
export function sndOf(view) {
  return view?.snd ?? view?.points?.snd ?? null;
}

// Spectating, on this device: a Search and Destroy player who is out for the round watches a living teammate. The HUD
// cycles who (a tap on its Spectating plate) and the renderer follows them, camera and fog of war both, so the view is
// exactly what that teammate can see. Nothing here touches the sim; it is per-phone state over the views it is given.
export const spectate = {
  pick: null,          // The teammate chosen by tapping, or null for the first one alive.
  any: false,          // Battle royale, squad out and Spectate chosen: anyone still alive can be watched (squad by squad).
  // The id to watch, or null when there is nothing to spectate (alive, between rounds' freeze, not S&D, team wiped).
  target(view, localId) {
    const snd = sndOf(view);
    // Extraction: only with the squad's lives spent, or once lifted out (js/sim/extract.js).
    const ex = view?.obj?.ex ? view.obj : view?.points?.obj?.ex ? view.points.obj : null;
    // Search and Destroy between rounds, or a battle royale squad member who is out (js/sim/br.js).
    if ((!snd && !view?.br && !ex) || snd?.state === 'freeze' || view.phase === 'ended') return null;
    const players = view.players;
    let me = null;
    for (let i = 0; i < players.length; i++) if (players[i].id === localId) { me = players[i]; break; }
    if (!me || me.alive) return null;
    if (ex && !me.out && (ex.squads?.find(s => s.team === me.team)?.lives ?? 0) > 0) return null;
    let first = null;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.team !== me.team || !p.alive || p.id === localId) continue;
      if (p.id === this.pick) return p.id;
      first ??= p.id;
    }
    if (first === null && this.any && view.br) {
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (!p.alive || p.id === localId || p.air === 1) continue;
        if (p.id === this.pick) return p.id;
        first ??= p.id;
      }
    }
    return first;
  },
  // The next (or previous) living teammate after whoever is watched now.
  // `squad`: on to the first player of the next squad instead (battle royale, watching anyone).
  cycle(view, localId, step = 1, squad = false) {
    const now = this.target(view, localId);
    const me = view.players.find(p => p.id === localId);
    let list = view.players.filter(p => me && p.team === me.team && p.alive && p.id !== localId);
    if (!list.length && this.any && view.br) list = view.players.filter(p => p.alive && p.id !== localId && p.air !== 1).sort((a, b) => a.team - b.team);
    if (!list.length) return null;
    const i = Math.max(0, list.findIndex(p => p.id === now));
    let j = (i + step + list.length) % list.length;
    if (squad) { const t = list[i].team; for (let k = 1; k < list.length && list[j].team === t; k++) j = (i + step * (k + 1) + list.length) % list.length; }
    this.pick = list[j].id;
    return this.pick;
  },
  reset() { this.pick = null; this.any = false; },
};
