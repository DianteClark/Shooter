// One in the Chamber, the host side (mode 'oic', a free-for-all). Everyone carries the Sidearm with one round and no
// reserve, and the Gaff. A hit from the Sidearm kills outright; a kill with anything gives one round back (up to
// OIC.maxRounds). Everyone has OIC.lives lives: out of them, you are out of the match and watch. The last player
// standing wins; at the time limit, whoever has lives left and the most kills does. sim.scores are kills.
//
// The round count lives on the phone that owns the gun, like all ammunition: the loadout's `rounds` (player.js) starts
// each life on one, and a refund is an {t:'ammo', id, slot:0, add:1, max} event the phone applies (js/game/match.js).
//
// Events: {t:'oic', kind:'out', id, by?}, {t:'oic', kind:'last', id, n} (the field is down to n). Medals: oic_last.
import { MAX_HP } from '../shared/constants.js';
import { decodeStats, encodeStats, restoreStats } from './mode-kit.js';

export const OIC = { lives: 5, maxRounds: 3, gun: 'pistol' };
const KIT = { primary: OIC.gun, secondary: 'knife', attachments: {}, perks: ['marathon', 'fasthands', 'deadsilence'], pro: [], streaks: [], rounds: 1 };
const STATS = ['oicLives'];

export class OicRules {
  constructor(sim) {
    this.sim = sim;
    this.out = [];             // Ids in the order they went out, for the results.
  }

  kit(team, l) { return { ...l, ...KIT, camo: l.camos?.[OIC.gun] ?? 'none' }; }

  // No grenades in this one: the round in the chamber is the only thing that kills at range.
  onSpawn(p) { p.ps.tacticalLeft = 0; p.ps.lethalLeft = 0; p.oicLives ??= OIC.lives; }

  damage(target, attacker, dmg, weapon, streak, equip) {
    if (streak || equip) return 0;
    return weapon === OIC.gun ? MAX_HP * 3 : dmg;
  }

  holdDead(p) { return (p.oicLives ?? OIC.lives) <= 0; }

  _field() { return this.sim.players.filter(p => !p.dummy && !p.away && (p.oicLives ?? OIC.lives) > 0); }

  step() {
    const sim = this.sim;
    // Bots out of rounds draw the blade, and go back to the Sidearm when a kill hands one back.
    for (const p of sim.players) {
      if (!p.bot || !p.alive) continue;
      const ps = p.ps;
      if (ps.slot === 0 && ps.ammo[0] === 0 && ps.swapT <= 0) p.bot.wantSwap = true;
      else if (ps.slot === 1 && ps.ammo[0] > 0 && ps.swapT <= 0 && !(p.bot.targetVisible && p.bot.targetDist < 3)) p.bot.wantSwap = true;
    }
    const field = this._field();
    if (field.length <= 1 && sim.players.filter(p => !p.dummy && !p.away).length > 1) sim._end(field[0]?.team ?? null);
  }

  onKill(target, killer, info) {
    const sim = this.sim;
    if (!info.away) target.oicLives = Math.max(0, (target.oicLives ?? OIC.lives) - 1);
    if (killer && killer !== target) {
      sim.scores[killer.team]++;
      if (killer.alive) {
        if (killer.isBot) killer.ps.ammo[0] = Math.min(OIC.maxRounds, killer.ps.ammo[0] + 1);
        else sim._emit({ t: 'ammo', id: killer.id, slot: 0, add: 1, max: OIC.maxRounds });
      }
    }
    if (!info.away && target.oicLives === 0) {
      this.out.push(target.id);
      sim._emit({ t: 'oic', kind: 'out', id: target.id, by: killer && killer !== target ? killer.id : null });
      const left = this._field();
      if (left.length > 1 && left.length <= 3) sim._emit({ t: 'oic', kind: 'last', n: left.length });
      if (left.length === 1) sim._medal(left[0], 'oic_last');
    }
    if (killer && killer !== target && sim.scores[killer.team] >= sim.scoreLimit) sim._end(killer.team);
  }

  // Lives left first (anyone still in beats anyone out), then kills, then fewer deaths.
  timeUp() {
    const sim = this.sim;
    const ranked = sim.players.filter(p => !p.dummy).sort((a, b) => (Math.sign(b.oicLives) - Math.sign(a.oicLives))
      || (sim.scores[b.team] - sim.scores[a.team]) || (b.oicLives - a.oicLives) || (a.deaths - b.deaths));
    if (!ranked.length) return null;
    const [a, b] = ranked;
    if (b && Math.sign(a.oicLives) === Math.sign(b.oicLives) && sim.scores[a.team] === sim.scores[b.team] && a.oicLives === b.oicLives) return null;
    return a.team;
  }

  plan() {}

  view() { return { kind: 'oic', lives: OIC.lives, maxRounds: OIC.maxRounds, field: this._field().length }; }
  playerView(p, v) { v.oicLives = p.oicLives ?? OIC.lives; }

  // Lives per player, in roster order.
  encode() { return this.sim.players.map(p => p.oicLives ?? OIC.lives); }
  decode(a, out) {
    out.players.forEach((p, i) => { p.oicLives = a ? a[i] ?? 0 : OIC.lives; });
    return { kind: 'oic', lives: OIC.lives, maxRounds: OIC.maxRounds, field: out.players.filter(p => p.oicLives > 0 && !p.away).length };
  }
  restore(view) { restoreStats(this.sim, view, STATS); }
}
