// Game modes. Each is a rule set the sim applies on top of ordinary combat.
//   rules     which rule set the sim runs: 'tdm' | 'kc' | 'dom' | 'hard' | 'ffa' | 'gun'. Ground War modes reuse the 6v6
//             rules on a bigger field, so everything keyed to a rule set (HUD flags, bot plans, scoring) works unchanged.
//   teamSize  players per team in a full match; bots fill up to it.
//   large     needs a Ground War map: small maps never offer it.
//   ffa       every player for themselves (see TEAMS in constants.js): `players` in a full match on an ordinary map,
//             `largePlayers` on a Ground War map. `everyMap` modes are offered on every map, Ground War ones included.
import { normalizeLoadout } from './catalog.js';

// Gun Game: one rung per kill, about one gun per category on the way, sidearms last. The final kill has to be made with
// the Verdict. Order runs from forgiving to demanding, so the climb gets harder as you near the top.
export const GUN_LADDER = [
  'smg', 'ar', 'autoshot', 'saw', 'burst', 'pdw', 'battle', 'coach', 'semisnipe', 'thumper', 'deuce', 'revolver',
];
// Everyone carries the same kit on a rung: the rung's gun and nothing to swap to, a Hatchet (a hit with it, or any
// thrown kill, also knocks the victim back a rung) and a Stim. No scorestreaks.
const GUN_KIT = { secondary: 'pistol', attachments: {}, perks: ['marathon', 'fasthands', 'deadsilence'], tactical: 'stim', lethal: 'hatchet' };

export const MODES = {
  tdm:   { id: 'tdm',   rules: 'tdm',  teamSize: 6,  name: 'Team Deathmatch', short: 'TDM', scoreLimit: 75,  timeLimit: 600, desc: 'First team to the kill limit.' },
  kc:    { id: 'kc',    rules: 'kc',   teamSize: 6,  name: 'Kill Confirmed',  short: 'KC',  scoreLimit: 65,  timeLimit: 600, desc: 'Collect enemy tags to score. Grab your own to deny.' },
  dom:   { id: 'dom',   rules: 'dom',  teamSize: 6,  name: 'Domination',      short: 'DOM', scoreLimit: 200, timeLimit: 600, desc: 'Hold the three flags. More flags, faster points.' },
  hard:  { id: 'hard',  rules: 'hard', teamSize: 6,  name: 'Hardpoint',       short: 'HP',  scoreLimit: 150, timeLimit: 600, desc: 'One zone at a time. Hold it to score; it moves.' },
  gwtdm: { id: 'gwtdm', rules: 'tdm',  teamSize: 16, large: true, name: 'Ground War TDM', short: 'GW TDM', scoreLimit: 250, timeLimit: 900, desc: '16 v 16 on a big map. First team to the kill limit.' },
  gwdom: { id: 'gwdom', rules: 'dom',  teamSize: 16, large: true, name: 'Ground War Domination', short: 'GW DOM', scoreLimit: 400, timeLimit: 900, desc: '16 v 16, five flags. More flags, faster points.' },
  ffa:   { id: 'ffa',   rules: 'ffa',  teamSize: 1, ffa: true, players: 8, largePlayers: 12, everyMap: true, name: 'Free-for-All', short: 'FFA', scoreLimit: 30, timeLimit: 600, desc: 'Every player for themselves. Most kills takes it.' },
  gun:   { id: 'gun',   rules: 'gun',  teamSize: 1, ffa: true, players: 8, largePlayers: 12, everyMap: true, name: 'Gun Game', short: 'GUN', scoreLimit: GUN_LADDER.length, timeLimit: 600, desc: `A new gun every kill, ${GUN_LADDER.length} to the Verdict. A Hatchet knocks you back one.` },
};
export const MODE_IDS = Object.keys(MODES);

// The rule set behind a mode id; unknown ids (and 'range') pass through.
export const modeRules = id => MODES[id]?.rules ?? id;
// Players per team for a mode, for buildRoster and lobby caps. A free-for-all is a side of one.
export const teamSizeFor = id => MODES[id]?.teamSize ?? MODES.tdm.teamSize;
// Whether a mode (or rule set) is every player for themselves.
export const isFfa = id => !!(MODES[id]?.ffa || id === 'ffa' || id === 'gun');
// Everyone in a full match: both teams, or a free-for-all's field, which is bigger on a Ground War map.
export function playersFor(id, map = null) {
  const m = MODES[id] ?? MODES.tdm;
  return m.ffa ? (map?.large ? m.largePlayers : m.players) : m.teamSize * 2;
}

// Modes a map can host: its own `modes` list (see js/shared/map.js, which fills it in for every map), plus the modes
// every map hosts.
export function mapModes(map) {
  const own = map?.modes ?? MODE_IDS.filter(id => !MODES[id].large);
  const extra = MODE_IDS.filter(id => MODES[id].everyMap && !own.includes(id));
  return extra.length ? [...own, ...extra] : own;
}

// Whether a map hosts a mode: the map lists it, and any points its rules need are defined.
export function modeFitsMap(map, mode) {
  if (!map || !MODES[mode] || !mapModes(map).includes(mode)) return false;
  const rules = MODES[mode].rules;
  if (rules === 'dom') return !!map.points?.dom?.length;
  if (rules === 'hard') return !!map.points?.hard?.length;
  return true;
}

// The first mode a map hosts, for falling back when a pick does not fit.
export const firstModeFor = map => mapModes(map).find(id => modeFitsMap(map, id)) ?? 'tdm';

// The Gun Game loadout for a rung. `base` keeps the player's identity (camo, operator, card, cosmetics); everything
// that fights is the rung's. `ladder` marks it: player.js keeps such a player on the one gun, and a loadout picked on
// the death screen does not replace it.
export function gunLoadout(level, base = {}) {
  const l = normalizeLoadout({ ...base, ...GUN_KIT, primary: GUN_LADDER[Math.max(0, Math.min(GUN_LADDER.length - 1, level))] });
  // Each rung wears that gun's own cosmetics, never the camo of the gun the player picked before the match.
  l.camo = l.camos?.[l.primary] ?? 'none';
  l.tracer = l.tracers?.[l.primary] ?? null;
  l.killFx = l.killFxs?.[l.primary] ?? null;
  l.streaks = [];
  l.pro = [];
  l.ladder = true;
  return l;
}
