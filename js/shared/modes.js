// Game modes. Each is a rule set the sim applies on top of ordinary team combat.
//   rules     which rule set the sim runs: 'tdm' | 'kc' | 'dom' | 'hard'. Ground War modes reuse the 6v6 rules on a
//             bigger field, so everything keyed to a rule set (HUD flags, bot plans, scoring) works unchanged.
//   teamSize  players per team in a full match; bots fill up to it.
//   large     needs a Ground War map: small maps never offer it, and Ground War maps offer nothing else.
export const MODES = {
  tdm:   { id: 'tdm',   rules: 'tdm',  teamSize: 6,  name: 'Team Deathmatch', short: 'TDM', scoreLimit: 75,  timeLimit: 600, desc: 'First team to the kill limit.' },
  kc:    { id: 'kc',    rules: 'kc',   teamSize: 6,  name: 'Kill Confirmed',  short: 'KC',  scoreLimit: 65,  timeLimit: 600, desc: 'Collect enemy tags to score. Grab your own to deny.' },
  dom:   { id: 'dom',   rules: 'dom',  teamSize: 6,  name: 'Domination',      short: 'DOM', scoreLimit: 200, timeLimit: 600, desc: 'Hold the three flags. More flags, faster points.' },
  hard:  { id: 'hard',  rules: 'hard', teamSize: 6,  name: 'Hardpoint',       short: 'HP',  scoreLimit: 150, timeLimit: 600, desc: 'One zone at a time. Hold it to score; it moves.' },
  gwtdm: { id: 'gwtdm', rules: 'tdm',  teamSize: 16, large: true, name: 'Ground War TDM', short: 'GW TDM', scoreLimit: 250, timeLimit: 900, desc: '16 v 16 on a big map. First team to the kill limit.' },
  gwdom: { id: 'gwdom', rules: 'dom',  teamSize: 16, large: true, name: 'Ground War Domination', short: 'GW DOM', scoreLimit: 400, timeLimit: 900, desc: '16 v 16, five flags. More flags, faster points.' },
};
export const MODE_IDS = Object.keys(MODES);

// The rule set behind a mode id; unknown ids (and 'range') pass through.
export const modeRules = id => MODES[id]?.rules ?? id;
// Players per team for a mode, for buildRoster and lobby caps.
export const teamSizeFor = id => MODES[id]?.teamSize ?? MODES.tdm.teamSize;

// Modes a map can host: its own `modes` list (see js/shared/map.js, which fills it in for every map).
export const mapModes = map => map?.modes ?? MODE_IDS.filter(id => !MODES[id].large);

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
