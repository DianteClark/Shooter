// Showdown, the host side (mode 'gf'; docs/MODES.md "Showdown"). 2 v 2 rounds on a small map. One life a round. Every
// player carries the same kit, dealt from the match seed and changed every GF.kitEvery rounds (kitFor: the same on every
// phone, so each phone deals its own player through Sim.dealFor). No health regeneration, no scorestreaks. A round is
// won by wiping the other pair; when the round clock (the mode's timeLimit) runs out a flag rises in the middle of the
// map (flagSpot) and overtime starts: a side that stands on it alone for GF.capture seconds wins; if nobody takes it
// before the overtime clock ends, the side with more health left wins, and level health is a drawn round (no point).
// sim.scores are rounds won; first to scoreLimit wins the match, and after GF.maxRounds rounds the leader does.
//
// Round flow as in Control: 'freeze' (sim phase 'warmup', everyone held at their end), 'live', 'post'. The pairs swap
// ends with each new kit. Events: {t:'gf', kind:'round'|'go'|'overtime'|'end', ...}. A phone applies the 'round' event
// (match.js calls rules.event) before the spawns that follow it, so it deals the new kit.
import { MAX_HP, PRIMARY_IDS, SECONDARY_IDS, WEAPON_CATEGORY, GOLDEN_ID } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { botAttachments } from './bots.js';
import { alive, chaseObjective, decodeStats, encodeStats, restoreStats, walkable, zoneObjective } from './mode-kit.js';

export const GF = { freeze: 5, post: 4, ot: 15, flagR: 3, capture: 3, kitEvery: 2, maxRounds: 15 };
const STATES = ['freeze', 'live', 'post'];
const REASONS = ['elim', 'flag', 'health', 'draw'];
const STATS = ['gfWins'];

// The kit pool: every primary but launchers and the golden gun (all six primary classes come up), pistols as the
// sidearm, and equipment that plays in a 2 v 2 (no camping devices).
const GUNS = PRIMARY_IDS.filter(id => WEAPONS[id] && ['Assault', 'SMG', 'Shotgun', 'LMG', 'Marksman', 'Sniper'].includes(WEAPON_CATEGORY[id]));
const GUN_W = GUNS.map(id => ({ Assault: 3, SMG: 3, Shotgun: 2, LMG: 1.5, Marksman: 1.5, Sniper: 1 })[WEAPON_CATEGORY[id]]);
const SIDES = SECONDARY_IDS.filter(id => id !== GOLDEN_ID && WEAPONS[id] && WEAPON_CATEGORY[id] === 'Pistol');
const LETHAL = ['frag', 'sticky', 'molotov', 'impact', 'shiv', 'hatchet', 'cluster', 'thermite'];
const TACTICAL = ['flash', 'stun', 'smoke', 'snapshot', 'stim', 'gas'];
const PERKS = ['marathon', 'fasthands', 'deadsilence'];

function rng32(a) {
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The kit for kit number `k` (rounds 1-2 are kit 0) of the match with this seed: {primary, secondary, attachments,
// lethal, tactical}. Pure.
export function kitFor(seed, k) {
  const r = rng32(((seed >>> 0) ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0);
  let w = r() * GUN_W.reduce((a, b) => a + b, 0), i = 0;
  while (i < GUNS.length - 1 && (w -= GUN_W[i]) > 0) i++;
  const primary = GUNS[i];
  const secondary = SIDES[Math.floor(r() * SIDES.length)];
  // Two or three attachments, the same for everyone (a bot's kit list for the gun, picked by the draw).
  const att = botAttachments(primary, r() < 0.5 ? 'regular' : 'veteran', Math.floor(r() * 6), { own: false });
  return { primary, secondary, attachments: { [primary]: att }, lethal: LETHAL[Math.floor(r() * LETHAL.length)], tactical: TACTICAL[Math.floor(r() * TACTICAL.length)] };
}

// Where the overtime flag stands: the middle of the line between the two ends' spawns, moved to the nearest spot with
// GF.flagR + 0.5 m clear of walls. Pure geometry (no nav grid), so every phone puts it in the same place.
export function flagSpot(map) {
  const mid = t => { const l = map.spawns[t]; return { x: l.reduce((a, s) => a + s.x, 0) / l.length, z: l.reduce((a, s) => a + s.z, 0) / l.length }; };
  const a = mid(0), b = mid(1), cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, need = GF.flagR * 0.6;
  const clear = (x, z) => {
    if (x < need + 1 || z < need + 1 || x > map.width - need - 1 || z > map.height - need - 1) return false;
    for (const w of map.walls) {
      if (w.kind === 'border') continue;
      const nx = Math.max(w.x, Math.min(x, w.x + w.w)), nz = Math.max(w.z, Math.min(z, w.z + w.d));
      if (Math.hypot(nx - x, nz - z) < need) return false;
    }
    return true;
  };
  for (let r = 0; r <= 14; r += 0.5) {
    const n = r === 0 ? 1 : Math.ceil(r * 4);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2, x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
      if (clear(x, z)) return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
    }
  }
  return { x: cx, z: cz };
}

export class GfRules {
  constructor(sim, seed) {
    this.sim = sim;
    this.seed = seed >>> 0;
    this.look = 'hard';
    this.ownClock = true;
    this.allIn = true;
    const at = flagSpot(sim.map);
    this.flag = { id: 'OT', x: at.x, z: at.z, r: GF.flagR, owner: -1, cap: 0, contested: false, taken: [false, false] };
    this.round = 0;
    this.kitRound = 1;               // The round whose kit a phone deals (the host's own round; a guest's from the event).
    this.state = 'freeze';
    this.postT = 0;
    this.overtime = false;
    this.history = [];
    sim.points = [];
  }

  get kitIndex() { return Math.floor((Math.max(1, this.kitRound) - 1) / GF.kitEvery); }
  // The end a side starts from this round: the pairs swap ends with each new kit.
  sideOf(team) { return (team + Math.floor((Math.max(1, this.round) - 1) / GF.kitEvery)) % 2; }

  // Everyone's fighting kit this round; identity and looks stay the player's (the camo they own for the dealt gun).
  kit(team, l) {
    const k = kitFor(this.seed, this.kitIndex);
    return { ...l, ...k, perks: PERKS.slice(), pro: [], streaks: [], camo: l.camos?.[k.primary] ?? 'none', tracer: l.tracers?.[k.primary] ?? null, killFx: l.killFxs?.[k.primary] ?? null };
  }

  // A phone takes in the round event before the spawns that follow it.
  event(e) { if (e.t === 'gf' && e.kind === 'round') this.kitRound = e.round; }

  spawnAll() { this.startRound(); return true; }

  startRound() {
    const sim = this.sim;
    this.round++;
    this.kitRound = this.round;
    this.state = 'freeze'; this.postT = 0; this.overtime = false;
    this.flag.owner = -1; this.flag.cap = 0; this.flag.contested = false;
    sim.points = [];
    sim.eq.reset();
    sim.strikes.length = 0; sim.mortars.length = 0; sim.gunships.length = 0;
    for (let i = sim.turrets.length - 1; i >= 0; i--) sim._removeTurret(sim.turrets[i]);
    sim.callouts.length = 0;
    sim.uav.fill(0); sim.jam.fill(0); sim.jamBy.fill(0); sim.overwatch.fill(0);
    sim.lastKill = null; sim.hot = null;
    sim._emit({ t: 'gf', kind: 'round', round: this.round, kit: this.kitIndex });
    const newKit = (this.round - 1) % GF.kitEvery === 0;
    for (let t = 0; t < 2; t++) {
      // Partners start side by side: a random spawn of their end, then the spawn nearest it.
      const list = sim.map.spawns[this.sideOf(t)];
      const first = list[Math.floor(sim.rng() * list.length)];
      const order = list.slice().sort((a, b) => Math.hypot(a.x - first.x, a.z - first.z) - Math.hypot(b.x - first.x, b.z - first.z));
      let k = 0;
      for (const p of sim.players) {
        if (p.team !== t || p.dummy) continue;
        if (newKit) p.loadout = sim._deal(p.team, p.loadout);
        p.primary = p.loadout.primary; p.camo = p.loadout.camo;
        p.kits[0] = p.loadout.attachments?.[p.loadout.primary] ?? {};
        p.kits[1] = {};
        if (p.away) continue;
        const s = order[k++ % order.length];
        sim._placeAt(p, s, Math.atan2(this.flag.z - s.z, this.flag.x - s.x));
      }
    }
    sim.timeLeft = sim.timeLimit;
    sim.phaseT = GF.freeze;
    if (sim.phase !== 'warmup') sim._setPhase('warmup');
  }

  onSpawn(p) { p.noRegen = true; p.gfPlan = null; }

  onLive() {
    this.state = 'live';
    this.sim.timeLeft = this.sim.timeLimit;
    this.sim._emit({ t: 'gf', kind: 'go', round: this.round });
  }

  step(dt) {
    const sim = this.sim;
    if (this.state === 'post') {
      this.postT -= dt;
      if (this.postT <= 0) this.startRound();
      return;
    }
    if (this.state !== 'live') return;
    const a0 = alive(sim, 0), a1 = alive(sim, 1);
    if (!a0 || !a1) { this._end(!a0 && !a1 ? null : a0 ? 0 : 1, !a0 && !a1 ? 'draw' : 'elim'); return; }
    sim.timeLeft = Math.max(0, sim.timeLeft - dt);
    if (!this.overtime) {
      if (sim.timeLeft <= 0) {
        this.overtime = true;
        sim.timeLeft = GF.ot;
        sim.points = [this.flag];
        sim._emit({ t: 'gf', kind: 'overtime', x: this.flag.x, z: this.flag.z });
      }
      return;
    }
    // Overtime: one side alone on the flag takes it; both on it holds it where it is.
    const f = this.flag, n = sim._countIn(f);
    f.contested = n[0] > 0 && n[1] > 0;
    if ((n[0] > 0) !== (n[1] > 0)) {
      const t = n[0] ? 0 : 1, sign = t ? 1 : -1;
      // Progress belongs to one side; the other side stepping on alone starts by wearing it back down.
      const k = f.cap * sign >= 0 ? Math.abs(f.cap) + dt * (1 + 0.5 * (Math.min(2, n[t]) - 1)) / GF.capture : -Math.abs(f.cap) + dt * 2 / GF.capture;
      f.cap = k >= 0 ? sign * Math.min(1, k) : -sign * Math.min(1, -k);
      if (k >= 1) {
        f.owner = t;
        for (const p of sim.players) if (p.team === t && sim._onZone(p, f)) sim._medal(p, 'capture');
        this._end(t, 'flag');
        return;
      }
    }
    if (sim.timeLeft <= 0) {
      const hp = [0, 1].map(t => sim.players.reduce((s, p) => s + (p.team === t && p.alive ? Math.max(0, p.hp) : 0), 0));
      this._end(hp[0] === hp[1] ? null : hp[0] > hp[1] ? 0 : 1, hp[0] === hp[1] ? 'draw' : 'health');
    }
  }

  _end(winner, reason) {
    const sim = this.sim;
    if (this.state !== 'live') return;
    if (winner !== null) {
      sim.scores[winner]++;
      for (const p of sim.players) if (p.team === winner) p.gfWins = (p.gfWins ?? 0) + 1;
      // The last one standing against two: a clutch.
      if (reason === 'elim') {
        const up = sim.players.filter(p => p.team === winner && p.alive);
        if (up.length === 1 && sim.players.filter(p => p.team === winner).length > 1) sim._medal(up[0], 'clutch');
      }
    }
    this.history.push({ winner: winner ?? -1, reason });
    this.state = 'post'; this.postT = GF.post; this.overtime = false;
    sim._emit({ t: 'gf', kind: 'end', round: this.round, winner: winner ?? -1, reason });
    if (winner !== null && sim.scores[winner] >= sim.scoreLimit) { sim._end(winner); return; }
    if (this.round >= GF.maxRounds) sim._end(sim.scores[0] === sim.scores[1] ? null : sim.scores[0] > sim.scores[1] ? 0 : 1);
  }

  damage(target, attacker, dmg) { return this.state === 'live' ? dmg : 0; }

  // One life a round: the next round's spawn brings everyone back.
  holdDead() { return true; }

  timeUp() { return null; }

  onLoadout(p) { if (this.state === 'freeze' && p.alive) this.sim._placeAt(p, { x: p.ps.x, z: p.ps.z }, p.ps.aim); }

  // ---- Bots: push the middle together, then hunt the nearest enemy (one straight on, one round the side); in
  // overtime, the flag. A lone survivor plays the clock when ahead on health, and the flag once it is up. ----
  plan(team, crew) {
    if (this.state !== 'live') return;
    const sim = this.sim, f = this.flag;
    if (this.overtime) { for (const b of crew) b.setObjective(zoneObjective(f, 'attack')); return; }
    const foes = sim.players.filter(p => p.team !== team && p.alive);
    const mates = sim.players.filter(p => p.team === team && p.alive);
    if (!foes.length) return;
    const elapsed = sim.timeLimit - sim.timeLeft;
    crew.forEach((b, i) => {
      const p = b.player ?? sim.players.find(q => q.bot === b);
      if (!p) return;
      // The opening: walk up toward the middle, partners a few metres apart.
      if (elapsed < 6 + (this.round % 3)) {
        const side = mates.indexOf(p) === 0 ? 1 : -1;
        const dx = f.x - p.ps.x, dz = f.z - p.ps.z, d = Math.hypot(dx, dz) || 1;
        const at = walkable(sim, p.ps.x + dx / d * Math.min(d * 0.6, 14) - dz / d * 4 * side, p.ps.z + dz / d * Math.min(d * 0.6, 14) + dx / d * 4 * side);
        b.setObjective({ key: `gfopen:${this.round}:${i}`, x: at.x, z: at.z, r: 2, role: 'attack' });
        return;
      }
      let foe = foes[0], best = Infinity;
      for (const q of foes) { const d = Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z); if (d < best) { best = d; foe = q; } }
      // The second of a pair swings wide of the line to the enemy.
      const flank = mates.length > 1 && mates.indexOf(p) === 1 && best > 10;
      let tx = foe.ps.x, tz = foe.ps.z;
      if (flank) { const dx = tx - p.ps.x, dz = tz - p.ps.z, d = best || 1; tx += -dz / d * 7; tz += dx / d * 7; }
      b.setObjective(chaseObjective(sim, `gfhunt:${i}`, tx, tz, 'attack'));
    });
  }

  // ---- View and wire ----
  view() {
    const sim = this.sim;
    return {
      kind: 'gf', state: this.state, round: this.round, kit: this.kitIndex, toWin: sim.scoreLimit, overtime: this.overtime,
      flag: { x: this.flag.x, z: this.flag.z, r: this.flag.r, cap: this.flag.cap, contested: this.flag.contested },
      clock: this.state === 'freeze' ? Math.max(0, sim.phaseT) : this.state === 'post' ? Math.max(0, this.postT) : 0,
      history: this.history.map(h => ({ ...h })),
    };
  }
  playerView(p, v) { v.gfWins = p.gfWins ?? 0; }

  // [state, round, clock ds, overtime, flag cap (hundredths), contested, n history, history..., stats...]
  encode() {
    const v = this.view();
    const out = [STATES.indexOf(this.state), this.round, Math.round(v.clock * 10), this.overtime ? 1 : 0, Math.round(this.flag.cap * 100), this.flag.contested ? 1 : 0];
    out.push(this.history.length);
    for (const h of this.history) out.push((h.winner + 1) * 4 + REASONS.indexOf(h.reason));
    return encodeStats(out, this.sim.players, STATS);
  }

  decode(a, out) {
    const sim = this.sim;
    if (!a) { decodeStats(null, 0, out.players, STATS); return this.view(); }
    this.state = STATES[a[0]] ?? 'live';
    if (a[1] > this.round) this.kitRound = a[1];
    this.round = a[1];
    const clock = a[2] / 10;
    this.overtime = !!a[3]; this.flag.cap = a[4] / 100; this.flag.contested = !!a[5];
    let i = 6;
    const n = a[i++];
    this.history = [];
    for (let k = 0; k < n; k++, i++) this.history.push({ winner: (a[i] >> 2) - 1, reason: REASONS[a[i] & 3] });
    decodeStats(a, i, out.players, STATS);
    if (this.overtime) out.points.push(sim._pointView(this.flag, -1, this.flag.cap, this.flag.contested));
    const v = this.view();
    v.clock = clock;
    return v;
  }

  restore(view) {
    const sim = this.sim, o = view.obj ?? view.points?.obj;
    restoreStats(sim, view, STATS);
    if (!o) return;
    this.round = o.round; this.kitRound = o.round; this.state = o.state; this.overtime = o.overtime;
    this.history = o.history.map(h => ({ ...h }));
    this.flag.cap = o.flag.cap; this.flag.contested = o.flag.contested;
    this.postT = o.state === 'post' ? o.clock : 0;
    if (o.state === 'freeze') sim.phaseT = Math.max(0.5, o.clock);
    sim.points = this.overtime ? [this.flag] : [];
  }
}

export { MAX_HP };
