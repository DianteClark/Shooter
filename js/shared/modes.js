// Game modes. Each is a rule set the sim applies on top of ordinary team combat.
export const MODES = {
  tdm:  { id: 'tdm',  name: 'Team Deathmatch', short: 'TDM', scoreLimit: 75,  timeLimit: 600, desc: 'First team to the kill limit.' },
  kc:   { id: 'kc',   name: 'Kill Confirmed',  short: 'KC',  scoreLimit: 65,  timeLimit: 600, desc: 'Collect enemy tags to score. Grab your own to deny.' },
  dom:  { id: 'dom',  name: 'Domination',      short: 'DOM', scoreLimit: 200, timeLimit: 600, desc: 'Hold the three flags. More flags, faster points.' },
  hard: { id: 'hard', name: 'Hardpoint',       short: 'HP',  scoreLimit: 150, timeLimit: 600, desc: 'One zone at a time. Hold it to score; it moves.' },
};
export const MODE_IDS = Object.keys(MODES);
