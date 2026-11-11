// Multiplayer matchmaking (docs/ROADMAP.md item 14): the tabs, the playlists in each, what a pick means, the 2-3 map
// options of the pre-match vote, and who fills the seats. Pure data and functions; js/ui/playscreens.js draws them and
// js/main.js runs the search, the vote and the match.
//
//   MP_TABS                          Standard, Ground War, Battle Royale, and a disabled Extraction (coming later)
//   playlistsFor(tab)                [{id, name, sub, modes, mods, featured?, icon}] the tab's playlists
//   modesFor(tab)                    the single modes a player can tick on that tab (none on Battle Royale)
//   resolveSelection(tab, sel)       {modes, mods, name} for a pick: one playlist, or one or more ticked modes
//   mpVoteOptions(tab, modes, rng)   2-3 {mapId, mode} on different maps of the tab's size tier (fewer only if the tier has fewer)
//   pickBotsForMatch({...})          THE seam for the bot overhaul: the roster of a Multiplayer match
import { MAPS, MAP_IDS, SIZES } from '../shared/map.js';
import { MODES } from '../shared/modes.js';
import { featured } from '../shared/playlist.js';
import { buildRoster } from '../sim/sim.js';
import { modeFits, weightedMap, tierOf, BR_PICK } from './vote.js';

export const MP_TABS = [
  { id: 'standard', name: 'Standard', note: '6 v 6', icon: 'mode:tdm' },
  { id: 'groundwar', name: 'Ground War', note: '16 v 16', icon: 'party' },
  { id: 'br', name: 'Battle Royale', note: '32 players', icon: 'mode:br' },
  { id: 'extraction', name: 'Extraction', note: 'Coming soon', icon: 'lock', soon: true },
];
export const MP_TAB_IDS = MP_TABS.filter(t => !t.soon).map(t => t.id);

const STANDARD_MODES = ['tdm', 'dom', 'kc', 'hard', 'hq', 'snd', 'ctf', 'ffa', 'ko', 'ctl', 'grind', 'gun', 'inf', 'oic'];
const GROUND_WAR_MODES = ['gwtdm', 'gwdom', 'gwhq', 'gwko'];
const short = ids => ids.map(id => MODES[id].short).join(', ');

const PLAYLISTS = {
  standard: [
    { id: 'qp', name: 'Quick Play: Standard', icon: 'quick', modes: ['tdm', 'dom', 'kc', 'hard', 'hq', 'ffa'] },
    { id: 'obj', name: 'Objective', icon: 'mode:dom', modes: ['dom', 'hard', 'hq', 'snd', 'ctf', 'ctl', 'grind'] },
    { id: 'party', name: 'Party modes', icon: 'party', modes: ['gun', 'inf', 'oic', 'ko'] },
  ],
  groundwar: [
    { id: 'gwqp', name: 'Quick Play: Ground War', icon: 'quick', modes: GROUND_WAR_MODES },
  ],
  br: [
    { id: 'quads', name: 'Quads', icon: 'mode:br', modes: ['br'], sub: '8 squads of four' },
    { id: 'duos', name: 'Duos', icon: 'mode:br', modes: ['brduo'], sub: '16 pairs' },
    { id: 'solos', name: 'Solos', icon: 'mode:br', modes: ['brsolo'], sub: '32 alone' },
  ],
};

// The tab's playlists, today's featured one last on Standard (every featured pairing is a 6v6 mode).
export function playlistsFor(tab, date = new Date()) {
  const list = (PLAYLISTS[tab] ?? []).map(p => ({ ...p, mods: [], sub: p.sub ?? short(p.modes) }));
  if (tab === 'standard') {
    const f = featured(date);
    list.push({ id: 'featured', name: f.name, icon: 'star', modes: [f.mode], mods: f.mods, sub: 'Featured today', featured: true });
  }
  return list;
}

export const modesFor = tab => (tab === 'standard' ? STANDARD_MODES : tab === 'groundwar' ? GROUND_WAR_MODES : []);

// A fresh pick for a tab: its first playlist.
export const defaultSelection = tab => ({ playlist: PLAYLISTS[tab]?.[0]?.id ?? null, modes: [] });

// What a pick plays: a playlist's modes and modifiers, or the ticked modes (in the tab's order) with none.
export function resolveSelection(tab, sel) {
  const p = sel?.playlist && playlistsFor(tab).find(x => x.id === sel.playlist);
  if (p) return { modes: p.modes.slice(), mods: p.mods.slice(), name: p.name };
  const modes = modesFor(tab).filter(id => sel?.modes?.includes(id));
  if (!modes.length) return { modes: [], mods: [], name: '' };
  return { modes, mods: [], name: modes.length === 1 ? MODES[modes[0]].name : `${modes.length} modes: ${short(modes)}` };
}

// The maps a tab plays on: Standard everything short of Ground War (weighted by size tier), Ground War the huge maps,
// Battle Royale the giant ones.
function tabMaps(tab) {
  if (tab === 'groundwar') return MAP_IDS.filter(id => tierOf(id) === 'huge');
  if (tab === 'br') return BR_PICK.filter(id => !MAPS[id].devMap);
  return MAP_IDS.filter(id => tierOf(id) !== 'huge');
}
const tabWeight = tab => (tab === 'standard' ? t => SIZES[t]?.weight ?? 0 : () => 1);

// The pre-match vote: up to three different maps of the tab's tier that host at least one of `modes`, each with one of
// those modes (spread across the modes before repeating one). A tier with fewer maps gives fewer cards.
export function mpVoteOptions(tab, modes, random = Math.random) {
  const open = tabMaps(tab).filter(id => modes.some(m => modeFits(MAPS[id], m)));
  const out = [], used = new Set();
  while (out.length < 3 && open.length) {
    const mapId = weightedMap(open, random, tabWeight(tab));
    open.splice(open.indexOf(mapId), 1);
    const fits = modes.filter(m => modeFits(MAPS[mapId], m));
    const fresh = fits.filter(m => !used.has(m));
    const pool = fresh.length ? fresh : fits;
    const mode = pool[Math.floor(random() * pool.length)];
    used.add(mode);
    out.push({ mapId, mode });
  }
  return out;
}

// How many players a match in this tab seats, for the lobby line and the vote's ballots.
export function lobbySize(tab, modes) {
  if (tab === 'br') return MODES[modes[0]]?.players ?? 32;
  if (tab === 'groundwar') return 32;
  return modes.some(m => !MODES[m]?.ffa) ? 12 : 8;
}

// THE bot seam (docs/ROADMAP.md item 15): who fills a Multiplayer match's seats around `humans`.
// The mode's own seat count, filled from the bot player pool (js/shared/botpool.js, docs/BOTS.md) by matchmaking:
// `pool` is where the humans sit ({ target, level }, main.js poolFor; true for an average player). Mixed (MP_BOT_SKILL)
// lets every bot play at its own per-match form; a tier (the ?bots= test hook) holds them all there. Every Multiplayer
// match and friend-lobby map-vote match goes through here.
export const MP_BOT_SKILL = 'mixed';
export function pickBotsForMatch({ humans, mode, mapId, seed, botSkill = MP_BOT_SKILL, pool = true }) {
  return buildRoster(humans, { botSkill, mode, mapId, seed, pool });
}
