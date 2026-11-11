// Kill Order, the host side (mode 'ko', and 'gwko' on the Ground War maps). Each team has one VIP, marked for everyone
// on the minimap and above their head. Only killing the enemy VIP scores (one point); ordinary kills score nothing for
// the team. A VIP takes KO.armor of the damage dealt to them. When a VIP dies, a living teammate (picked in turn) is
// the next VIP at once; with nobody left alive, the next one to spawn is. A kill close to your own VIP guards them.
//
// Events: {t:'ko', kind:'vip', team, id} a new VIP; {t:'ko', kind:'kill', team (the VIP's), id, by}. Medals: vip_kill,
// bodyguard. sim.scores are VIP kills; first to scoreLimit wins, more at the time limit wins, level is a draw.
import { SCORE } from '../shared/catalog.js';
import { addScore } from './streaks.js';
import { chaseObjective, closestBot, decodeStats, encodeStats, restoreStats } from './mode-kit.js';

export const KO = { armor: 0.6, guard: 9, killScore: 300, guardScore: 75, guards: 2 };
const STATS = ['vipKills', 'guards', 'vipTurns'];

export class KoRules {
  constructor(sim) {
    this.sim = sim;
    this.allIn = true;
    this.vip = [null, null];
    this.turn = [0, 0];        // Rotates who is next, so the role goes round the team.
  }

  onLive() { for (let t = 0; t < 2; t++) if (!this.vip[t]) this._pick(t); }

  _pick(team, not = null) {
    const sim = this.sim, list = sim.players.filter(p => p.team === team && !p.dummy && !p.away);
    if (!list.length) { this.vip[team] = null; return; }
    for (let k = 0; k < list.length; k++) {
      const p = list[(this.turn[team] + k) % list.length];
      if (p.alive && p !== not) {
        this.turn[team] = (this.turn[team] + k + 1) % list.length;
        this._set(team, p);
        return;
      }
    }
    this.vip[team] = null;       // Nobody alive: the next to spawn takes it (onSpawn).
  }

  _set(team, p) {
    this.vip[team] = p;
    p.vipTurns = (p.vipTurns ?? 0) + 1;
    this.sim._emit({ t: 'ko', kind: 'vip', team, id: p.id });
  }

  onSpawn(p) { if (this.sim.phase === 'live' && p.team < 2 && !this.vip[p.team]) this._set(p.team, p); }

  step() {
    // A VIP whose human left hands the role on.
    for (let t = 0; t < 2; t++) {
      const v = this.vip[t];
      if (!v || v.away || (!v.alive && this.sim.phase === 'live')) this._pick(t, v);
    }
  }

  damage(target, attacker, dmg) { return this.vip[target.team] === target ? dmg * KO.armor : dmg; }

  onKill(target, killer, info) {
    const sim = this.sim, team = target.team;
    if (this.vip[team] === target) {
      if (killer && killer.team !== team && !info.away) {
        sim.scores[killer.team]++;
        killer.vipKills = (killer.vipKills ?? 0) + 1;
        addScore(killer.score, KO.killScore);
        sim._medal(killer, 'vip_kill');
      }
      sim._emit({ t: 'ko', kind: 'kill', team, id: target.id, by: killer && killer !== target ? killer.id : null });
      this._pick(team, target);
      if (killer && killer.team !== team && sim.scores[killer.team] >= sim.scoreLimit) { sim._end(killer.team); return; }
    }
    if (!killer || killer.team === team || info.away) return;
    const mine = this.vip[killer.team];
    if (mine && mine !== killer && mine.alive && Math.hypot(mine.ps.x - target.ps.x, mine.ps.z - target.ps.z) <= KO.guard) {
      killer.guards = (killer.guards ?? 0) + 1;
      addScore(killer.score, KO.guardScore);
      sim._medal(killer, 'bodyguard');
    }
  }

  // ---- Bots: the VIP sticks with the team; the nearest couple guard them; everyone else hunts the enemy VIP, whose
  // position is marked for all to see. ----
  plan(team, crew) {
    const mine = this.vip[team], theirs = this.vip[1 - team];
    const free = new Set(crew);
    if (mine?.bot && free.has(mine.bot)) {
      free.delete(mine.bot);
      // Hang back among teammates: the middle of the living team, or hold where they are.
      let x = 0, z = 0, n = 0;
      for (const p of this.sim.players) if (p.team === team && p.alive && p !== mine) { x += p.ps.x; z += p.ps.z; n++; }
      mine.bot.setObjective(n ? chaseObjective(this.sim, 'pack', x / n, z / n, 'defend') : null);
    }
    if (mine?.alive) {
      for (let g = 0; g < KO.guards; g++) {
        const b = closestBot(free, mine.ps.x, mine.ps.z);
        if (!b) break;
        free.delete(b);
        b.setObjective(chaseObjective(this.sim, `guard${mine.index}`, mine.ps.x, mine.ps.z, 'defend'));
      }
    }
    for (const b of free) {
      if (theirs?.alive) b.setObjective(chaseObjective(this.sim, `hunt${theirs.index}`, theirs.ps.x, theirs.ps.z, 'attack'));
      else b.setObjective(null);
    }
  }

  // ---- View and wire ----
  view() { return { kind: 'ko', vip: this.vip.map(p => p?.id ?? null), armor: KO.armor }; }
  playerView(p, v) { v.vipKills = p.vipKills ?? 0; v.guards = p.guards ?? 0; v.vipTurns = p.vipTurns ?? 0; }

  encode() { return encodeStats([this.vip[0]?.index ?? -1, this.vip[1]?.index ?? -1, this.turn[0], this.turn[1]], this.sim.players, STATS); }

  decode(a, out) {
    decodeStats(a, 4, out.players, STATS);
    if (!a) return this.view();
    this.vip = [a[0], a[1]].map(i => (i >= 0 ? this.sim.players[i] ?? null : null));
    this.turn = [a[2], a[3]];
    return this.view();
  }

  restore(view) {
    restoreStats(this.sim, view, STATS);
    const o = view.obj ?? view.points?.obj;
    if (!o) return;
    this.vip = o.vip.map(id => (id ? this.sim.byId.get(id) ?? null : null));
  }
}
