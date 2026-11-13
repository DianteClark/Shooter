// Challenge shortcuts (QoL): the Multiplayer pick where a challenge counts best, from its stat. A Play button on a
// challenge row opens the Multiplayer screen on that tab with the pick made (main.js playShortcut); the player still
// taps Find match. Pure data and lookups.
//
//   playFor(stat)    { tab, sel: {playlist, modes}, name } or null when no pick suits it better than any other
import { MODES } from '../shared/modes.js';
import { playlistsFor, modesFor, MP_TAB_IDS } from './matchmaking.js';

// Objective stats and the mode that has them.
const OBJECTIVE = {
  captures: 'dom', confirms: 'kc', plants: 'snd', defuses: 'snd', bombs: 'snd', clutches: 'snd',
  flagCaps: 'ctf', flagReturns: 'ctf', carrierKills: 'ctf',
};
const QUICK = { tab: 'standard', sel: { playlist: 'qp', modes: [] } };

// A playlist made only of modes with these rules (Showdown, Quads, Solo with bots) beats ticking a single mode, which
// beats a mixed playlist that may not roll it. Standard first, then the other tabs.
function pickForRules(rules) {
  const tabs = ['standard', ...MP_TAB_IDS.filter(t => t !== 'standard')];
  for (const tab of tabs) {
    const pure = playlistsFor(tab).find(p => !p.ranked && !p.event && !p.featured && !p.friends && p.modes.length && p.modes.every(m => MODES[m]?.rules === rules));
    if (pure) return { tab, sel: { playlist: pure.id, modes: [] }, name: pure.name };
    const mode = modesFor(tab).find(m => MODES[m]?.rules === rules);
    if (mode) return { tab, sel: { playlist: null, modes: [mode] }, name: MODES[mode].name };
  }
  return null;
}

export function playFor(stat) {
  if (typeof stat !== 'string') return null;
  if (stat === 'ranked') return { tab: 'standard', sel: { playlist: 'ranked', modes: [] }, name: 'Ranked' };
  const m = /^(?:won|played|top3):(.+)$/.exec(stat);
  const rules = m ? m[1] : OBJECTIVE[stat] ? MODES[OBJECTIVE[stat]].rules : null;
  if (rules) return pickForRules(rules);
  // Kills, guns, streaks, style and wins count everywhere: Quick Play is the fastest way to stack them.
  return { ...QUICK, name: 'Quick Play' };
}
