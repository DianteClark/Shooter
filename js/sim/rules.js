// The modes overhaul's rule sets (docs/MODES.md), one module each, keyed by rule set id. The Sim makes one when its
// mode's rules are listed here and calls into it through `this.rules` at a handful of places. Every hook is optional
// apart from step, view, encode, decode and restore:
//
//   look                    rule set whose zones the renderer and HUD draw ('hard', 'dom'), as view.mode
//   ownClock                the rules run the match clock themselves (rounds)
//   allIn                   every bot plays the objective, whatever its roll for this life
//   step(dt)                one live tick; the rules end the match themselves (sim._end)
//   onLive()                the sim went live (every time, for round modes that re-freeze)
//   onSpawn(p)              p was just placed on the field
//   onKill(target, killer, info)   after a death (killer null: no credit; info.away: a human left)
//   damage(target, attacker, dmg, weapon, streak, equip)  returns the damage to apply (0 stops it)
//   holdDead(p)             true keeps a dead player off the field (no lives left, a Headquarters standing)
//   spawnFlow(p, s)         score added to a respawn point
//   timeUp()                the winning side when the clock runs out (null: a draw)
//   kit(team, loadout)      the loadout this mode deals a side (also on phones: Sim.dealFor)
//   plan(team, crew)        bot objectives for one side (js/sim/bots.js planObjectives)
//   playerView(p, v)        per-player mode stats onto a player view
//   view()                  the mode's state for the view: view.obj, and view.points.obj (see objOf)
//   encode() / decode(a, out) / restore(view)   snapshot block, the guest's reading of it, host migration
//   seatCode(p, code)       the per-guest record code for an AI seat (0: none; Graveyard Shift sends its horde itself)
//   medal(p, medal)         false keeps a medal from being awarded
import { HqRules } from './hq.js';
import { KoRules } from './ko.js';
import { InfRules } from './inf.js';
import { OicRules } from './oic.js';
import { CtlRules } from './ctl.js';
import { GrindRules } from './grind.js';
import { ExtractRules } from './extract.js';     // Extraction (docs/EXTRACT.md).
import { ZmRules } from './zombies.js';         // Graveyard Shift (docs/ZOMBIES.md).

export const MODE_RULES = { hq: HqRules, ko: KoRules, inf: InfRules, oic: OicRules, ctl: CtlRules, grind: GrindRules, ex: ExtractRules, zm: ZmRules };

// The mode state on any view: the sim's and decoded views carry it as `view.obj`; an interpolated view (js/game/interp.js
// copies a fixed list of fields) still has it on the point list it does copy.
export function objOf(view) {
  return view?.obj ?? view?.points?.obj ?? null;
}
