// Calling cards beyond the V7 set: one per map, per mode (S&D and CTF get three each), per weapon category, a mastery
// card per gun and animated mastery tiers. Pure data, registered into the shared CARDS list when this module loads;
// js/ui/operators.js imports it, and progress.js imports operators.js, so the cards exist before the save is read.
//
// `need(c)` gets Progress's card career (cardCareer in progress.js) merged with extras(): what that career lacks,
// supplied by js/ui/cards.js through setCareerExtras():
//   cats {category: gun kills}  life {stat: lifetime count}  mastered  masteredSet  masteredIn {category: n}  catSize {category: n}
//   camoOn {camoId: weapons that own it}  granted(id) -> bool  (Progress.hasReward: 'card:..', 'skin:..')
//   zmBest {mapId: best round}  zmFeats {mapId: [escape round, Gravewarden]}  (Graveyard Shift's cards)
// `life` is the lifetime sum of ChallengeTally counts (played:<rules>, won:<rules>, plants, defuses, clutches, flagCaps,
// flagReturns, carrierKills, confirms, multi, streaksCalled, equipKills, assists, top3, hipKills ...) plus map:<id> and
// mapwon:<id>; until Progress keeps it (Progress.lifetime()), those cards simply stay locked.
//
// art: {p: pattern, c: [ground, mid, light, accent], e: emblem, gold?, anim?: 'gold'|'prism'|'molten'}.
import { CARDS, CARD_IDS, CARD_GROUPS } from '../shared/progression.js';
import { WEAPON_IDS, CATEGORIES, GOLDEN_ID } from '../shared/constants.js';
import { MAPS, MAP_IDS } from '../shared/map.js';
import { MODES } from '../shared/modes.js';
import { WEAPONS } from '../shared/weapons.js';
import { SEASON_DEFS, seasonCards, rankedCards, trackRewards } from '../shared/season-items.js';

const NONE = { cats: {}, life: {}, mastered: 0, masteredIn: {}, masteredSet: new Set(), catSize: {}, camoOn: {}, granted: () => false, zmBest: {}, zmFeats: {} };
let source = () => NONE;
let memo = null;
// One read per synchronous pass: Progress.cards() judges every card against the same numbers.
function extras() {
  if (!memo) {
    try { memo = { ...NONE, ...source() }; } catch { memo = NONE; }
    queueMicrotask(() => { memo = null; });
  }
  return memo;
}
export function setCareerExtras(fn) { source = fn; memo = null; }
// The save changed (js/ui/progress.js save()): the next card check reads it again, even in the same pass. Without this,
// applyMatch's before and after card lists shared one memo and no map, mode, arms or career card was ever stamped.
export function dropCareerMemo() { memo = null; }
export const careerExtras = () => extras();

const n = v => (Number.isFinite(v) ? v : 0);
const life = key => n(extras().life[key]);
const fmt = v => v.toLocaleString('en-US');
// `prog()` -> [value, goal]: how far a locked card is, for its progress bar (Progress.cards()).
const card = (id, name, group, req, need, art, prog, play) => ({ id, name, group, req, need: () => { try { return !!need(); } catch { return false; } }, art, ...(prog ? { prog } : {}), ...(play ? { play } : {}) });

// Per map: the map's own pattern and palette, earned by winning there.
const MAP_ART = {
  railyard: ['Hump Yard', 'signals', ['#1d1a16', '#4a3e30', '#ffd9a0', '#ff9f1c']],
  harbor:   ['Dockside', 'cranes', ['#0f1a22', '#24465a', '#bfe2f2', '#ffb03a']],
  neon:     ['Neon Lights', 'neon', ['#120a1c', '#3a1a4e', '#ffd2f4', '#ff2bd6']],
  dust:     ['Dust Devil', 'dunes', ['#2a1e12', '#7a5630', '#ffe4b0', '#ff8a2a']],
  frost:    ['Whiteout', 'shards', ['#14202a', '#3c5c72', '#eaf6ff', '#7cd8ff']],
  topside:  ['Rooftop', 'skyline', ['#161a26', '#323a54', '#d6dcf2', '#ffcf4a']],
  sunken:   ['Deep Water', 'reeds', ['#0c1c1e', '#1e4a48', '#bff2e4', '#2ae0b0']],
  harvest:  ['Last Harvest', 'wheat', ['#22180c', '#6a4a1a', '#ffe8a8', '#ffb02a']],
  // The rewards pass (docs/UNLOCKS-AUDIT-2026-11-12.md): every map has a card, drawn in js/ui/cardart.js.
  pier:       ['Boardwalk', 'boardwalk', ['#0e1820', '#2a4656', '#cfe6f0', '#ffb84a']],
  foundry:    ['Pour Line', 'furnace', ['#1a0e08', '#4e2a14', '#ffd8a8', '#ff6a10']],
  turnstile:  ['End of the Line', 'tunnel', ['#101218', '#2c3240', '#d8dee8', '#ffd23f']],
  overpass:   ['Rush Hour', 'overpass', ['#12141c', '#2e3446', '#d6dcef', '#ff5a3a']],
  downtown:   ['High Rise', 'towers', ['#0e1220', '#26304e', '#dbe4ff', '#7cc8ff']],
  oasis:      ['Mirage', 'palms', ['#2a1c0e', '#7a5a2a', '#ffeac0', '#2ad0c0']],
  canyon:     ['Red Rock', 'mesas', ['#24120c', '#6e321c', '#ffd2b0', '#ff7a3a']],
  ruins:      ['Lost Temple', 'temple', ['#0e1a12', '#2e4a2a', '#d8f0c8', '#e0c040']],
  canopy:     ['Treetops', 'crowns', ['#0c1a10', '#1e4a26', '#c8f0c8', '#9cff4a']],
  riverbend:  ['Meander', 'river', ['#0e1a16', '#26483a', '#cfeee0', '#3ab0ff']],
  expedition: ['Base Camp', 'peaks', ['#121820', '#34465a', '#e8f0f8', '#ff6a3a']],
  icebreaker: ['Pack Ice', 'icebow', ['#0e1a26', '#2a4a66', '#eaf6ff', '#ff4a3a']],
  ashgrove:   ['Lamplight', 'grove', ['#120e16', '#3a3040', '#e0d8e8', '#ffb84a']],
  frontier:   ['Drop Zone', 'zone', ['#101a14', '#2a4630', '#d8f0d0', '#ff9f1c']],
};
const MAP_WINS = 10;
// Map cards come in three tiers (bronze, silver, gold; the gold one animated): wins on the map, or for the maps that
// host no team win (Frontier's battle royale and extraction, Ashgrove's Graveyard Shift) matches played there.
// Tier 1 keeps the original `map-<id>` card and its 10 wins, so nothing earned is lost.
const MAP_TIERS = [MAP_WINS, 30, 75];
const MAP_PLAYS = [10, 40, 100];
const PLAYS_ONLY = new Set(['frontier', 'ashgrove']);
// Where a card's goal counts, for the unlock sheet's Play now: a Multiplayer tab and a playlist or ticked modes.
const STANDARD = { tab: 'standard', playlist: 'qp' };
const playFor = mode => ({ br: { tab: 'br', playlist: 'quads' }, rb: { tab: 'br', playlist: 'rbquads' }, ex: { tab: 'extraction', playlist: 'exquads' },
  zm: { tab: 'zombies', playlist: 'zmsolo' }, gf: { tab: 'standard', playlist: 'showdown' } }[mode] ?? { tab: 'standard', modes: [mode] });
const mapPlay = id => (id === 'frontier' ? playFor('br') : id === 'ashgrove' ? playFor('zm') : MAPS[id]?.size === 'huge' ? { tab: 'groundwar', playlist: 'gwqp' } : STANDARD);

// Per mode: [id, name, req, lifetime stat, goal, pattern, palette, emblem].
const MODE_CARDS = [
  ['mode-tdm', 'Body Count', 'Win 25 Team Deathmatch matches', 'won:tdm', 25, 'tally', ['#1e1416', '#5a2a2e', '#ffd0c8', '#ff4a3a'], 'mode:tdm'],
  ['mode-kc', 'Tag Collector', 'Confirm 200 kills', 'confirms', 200, 'tags', ['#16181c', '#3e444e', '#e6ecf2', '#ffc21a'], 'mode:kc'],
  ['mode-dom', 'Flag Holder', 'Win 20 Domination matches', 'won:dom', 20, 'radar', ['#0e1a16', '#1e4a3a', '#c8ffe4', '#2aff9a'], 'mode:dom'],
  ['mode-hard', 'Hill Keeper', 'Win 20 Hardpoint matches', 'won:hard', 20, 'zones', ['#1a160e', '#4a3e1e', '#fff0c0', '#ffcf2a'], 'mode:hard'],
  ['mode-ffa', 'Lone Wolf', 'Win 10 Free-for-All matches', 'won:ffa', 10, 'grid', ['#141418', '#34343e', '#e8e8f2', '#b04aff'], 'mode:ffa'],
  ['mode-gun', 'Full Ladder', 'Win 5 Gun Game matches', 'won:gun', 5, 'ladder', ['#1a1210', '#4e2e20', '#ffd8c0', '#ff6a2a'], 'mode:gun'],
  ['snd-plant', 'Short Fuse', 'Plant the bomb 25 times', 'plants', 25, 'fuse', ['#1c100c', '#5a2414', '#ffd0b0', '#ff3a10'], 'medal:plant'],
  ['snd-defuse', 'Wire Cutter', 'Defuse the bomb 25 times', 'defuses', 25, 'wires', ['#0c141c', '#1e3a52', '#c8e6ff', '#38b6ff'], 'medal:defuse'],
  ['snd-clutch', 'Last One Standing', 'Win 10 rounds as the last alive', 'clutches', 10, 'spot', ['#0e0e12', '#2a2a34', '#fff4d8', '#ffd659'], 'medal:clutch'],
  ['ctf-cap', 'Flag Runner', 'Capture 15 flags', 'flagCaps', 15, 'pennants', ['#0e1622', '#22385a', '#d8e8ff', '#38b6ff'], 'medal:flag_capture'],
  ['ctf-return', 'Home Guard', 'Return 30 flags', 'flagReturns', 30, 'pennants', ['#1e0e10', '#5a1e24', '#ffd8d8', '#ff4d3d'], 'medal:flag_return'],
  ['ctf-carrier', 'Carrier Down', 'Kill 50 flag carriers', 'carrierKills', 50, 'chevrons', ['#16101e', '#3e2a5a', '#e8d8ff', '#9d6bff'], 'medal:carrier_kill'],
];

// Per weapon category: [name, kills, pattern, palette].
const CAT_ART = {
  Assault:  ['Rifleman', 500, 'brass', ['#1c1a14', '#4e4632', '#f2e6c0', '#ffb02a']],
  SMG:      ['Close Quarters', 500, 'speed', ['#101a1e', '#24424e', '#c8f0ff', '#1fe0c4']],
  Shotgun:  ['Buckshot', 300, 'shells', ['#1e100e', '#5a2420', '#ffd4c8', '#ff4a3a']],
  LMG:      ['Suppressor', 400, 'belts', ['#16180e', '#3e4424', '#e8f0c0', '#c9d24a']],
  Marksman: ['Designated', 300, 'scope', ['#12161c', '#2e3a4a', '#d8e6f4', '#ff9f1c']],
  Sniper:   ['One Shot', 250, 'rings', ['#0e1218', '#22303e', '#cfe4ff', '#ff3a3a']],
  Pistol:   ['Sidearm', 150, 'plates', ['#1a1a1e', '#3e3e48', '#ececf2', '#d9774a']],
  Launcher: ['Ordnance', 50, 'blast', ['#1e1408', '#5a3a12', '#ffe0a0', '#ff6a10']],
};
const CAT_PLURAL = { Assault: 'assault rifles', SMG: 'SMGs', Shotgun: 'shotguns', LMG: 'LMGs', Marksman: 'marksman rifles', Sniper: 'sniper rifles', Pistol: 'pistols', Launcher: 'launchers' };

const GOLD = ['#2e2206', '#9a7214', '#fff4bf', '#ffd659'];
const PRISM = ['#140a22', '#4a2a8e', '#c8f8ff', '#ff2bd6'];
const MOLTEN = ['#1a0a06', '#8a200a', '#ffd23f', '#ff4a0a'];

const ORIGINAL_MAPS = new Set(['railyard', 'harbor', 'neon', 'dust', 'frost', 'topside', 'sunken', 'harvest']);
const mapTier = (id, t) => {
  const [base, p, c] = MAP_ART[id], mapName = MAPS[id].name, plays = PLAYS_ONLY.has(id);
  const stat = plays ? `map:${id}` : `mapwon:${id}`, goal = (plays ? MAP_PLAYS : MAP_TIERS)[t - 1];
  const name = t === 1 ? base : t === 2 ? `${mapName} Elite` : `${mapName} Master`;
  const req = plays ? `Play ${fmt(goal)} matches on ${mapName}` : `Win ${fmt(goal)} matches on ${mapName}`;
  return card(t === 1 ? `map-${id}` : `map-${id}-${t}`, name, 'Maps', req, () => life(stat) >= goal,
    { p, c, e: `map:${id}`, tier: t, ...(t === 3 ? { gold: true, anim: 'gold' } : {}) }, () => [life(stat), goal], mapPlay(id));
};

// Modes added after the first six (and battle royale, Rebound, Extraction, Graveyard Shift): three tiers each, the gold
// one animated. [mode, tier 1 name, pattern, palette, [[stat, goal, label] x3]]. Graveyard Shift's goal is the best
// round on any map (`zmround`).
const won = (rules, name) => [5, 20, 50].map(g => [`won:${rules}`, g, `Win ${g} ${name} matches`]);
const MODE_TIERS = [
  ['hq', 'Command Post', 'beacon', ['#141a10', '#36422a', '#e6f0d0', '#ffcf2a'], won('hq', 'Headquarters')],
  ['ko', 'Marked Man', 'vip', ['#1c0e14', '#4e2234', '#ffd6e2', '#ffd659'], won('ko', 'Kill Order')],
  ['ctl', 'Hold the Line', 'lanes', ['#0e1620', '#24405a', '#d6e8ff', '#38d0ff'], won('ctl', 'Control')],
  ['grind', 'Tag Bank', 'bank', ['#16140e', '#3e3a26', '#f2ead0', '#ffb02a'], won('grind', 'Grind')],
  ['inf', 'Patient Zero', 'spread', ['#0e1a0e', '#24422a', '#d8f6d0', '#8cff3a'], won('inf', 'Infected')],
  ['oic', 'Last Round', 'chamber', ['#1a1410', '#4a3a2a', '#ffe6c8', '#ff8a2a'], [3, 10, 25].map(g => ['won:oic', g, `Win ${g} One in the Chamber matches`])],
  ['gf', 'Two by Two', 'duel', ['#14101e', '#342a50', '#e2dcff', '#ff4a6a'], won('gf', 'Showdown')],
  ['br', 'Drop In', 'chutes', ['#0e1622', '#26405e', '#d8e8ff', '#ff9f1c'], [['br:top5', 5, 'Finish top 5 in Battle Royale 5 times'], ['br:won', 3, 'Win 3 Battle Royale matches'], ['br:won', 10, 'Win 10 Battle Royale matches']]],
  ['rb', 'Back In', 'redeploy', ['#10181e', '#2a4452', '#d0f0ff', '#2ae0b0'], [['rb:top5', 5, 'Finish top 5 in Rebound 5 times'], ['rb:won', 3, 'Win 3 Rebound matches'], ['rb:won', 10, 'Win 10 Rebound matches']]],
  ['ex', 'Dust Off', 'exfil', ['#16140c', '#3e3a22', '#f0ecd0', '#ff5a2a'], [5, 20, 50].map(g => ['ex:out', g, `Extract ${g} times`])],
  ['zm', 'Night Shift', 'graves', ['#100c18', '#2e2840', '#d8d0f0', '#7aff9a'], [10, 20, 30].map(g => ['zmround', g, `Survive to round ${g} in Graveyard Shift`])],
];
const MODE_NAMES = { ex: 'Extraction', rb: 'Rebound', br: 'Battle Royale', oic: 'Chamber', zm: 'Graveyard' };
const zmRound = () => Math.max(0, ...Object.values(extras().zmBest ?? {}).map(n));
const statOf = st => (st === 'zmround' ? zmRound() : life(st));
const modeTier = ([mode, base, p, c, goals], t) => {
  const [st, goal, req] = goals[t - 1], modeName = MODE_NAMES[mode] ?? MODES[mode]?.name ?? mode, zm = mode === 'zm';
  const name = t === 1 ? base : t === 2 ? `${modeName} Elite` : `${modeName} Master`;
  return card(`modes-${mode}-${t}`, name, zm ? 'Zombies' : 'Modes', req, () => statOf(st) >= goal,
    { p, c, e: `mode:${mode}`, tier: t, ...(t === 3 ? { gold: true, anim: zm ? 'ghost' : 'prism' } : {}) }, () => [Math.min(goal, statOf(st)), goal], playFor(mode));
};

// Graveyard Shift's own: the first escape, an escape from round 25 on, and a card per map for reaching round 15 there.
const ZM_PALETTE = ['#0e0c16', '#3e3858', '#d8d0f0', '#7aff9a'];
const zmFeats = () => Object.values(extras().zmFeats ?? {}).filter(Array.isArray);
const zmEscaped = () => Math.max(0, ...zmFeats().map(v => n(v[0])));
const ZM_MAP_ROUND = 15;
const ZM_MAP_NAMES = { neon: 'Neon Dead', ruins: 'Overgrown', foundry: 'Slag Heap', ashgrove: 'Ash and Bone' };
const ZM_CARDS = [
  card('zm-escape', 'First Light', 'Zombies', 'Escape Graveyard Shift on the helicopter', () => zmEscaped() > 0, { p: 'rescue', c: ['#0c0e18', '#2a3048', '#d8e0ff', '#ffd659'], e: 'mode:zm', gold: true }, null, playFor('zm')),
  card('zm-escape25', 'Dawn Patrol', 'Zombies', 'Escape Graveyard Shift on round 25 or later', () => zmEscaped() >= 25, { p: 'dawn', c: ['#160c10', '#4a2430', '#ffe0c8', '#ff8a3a'], e: 'mode:zm', gold: true, anim: 'gold' },
    () => [Math.min(25, zmEscaped()), 25], playFor('zm')),
  ...(MODES.zm?.maps ?? []).filter(id => MAPS[id] && MAP_ART[id]).map(id => card(`zm-map-${id}`, ZM_MAP_NAMES[id] ?? `${MAPS[id].name} Shift`, 'Zombies',
    `Survive to round ${ZM_MAP_ROUND} on ${MAPS[id].name} in Graveyard Shift`, () => n(extras().zmBest?.[id]) >= ZM_MAP_ROUND,
    { p: MAP_ART[id][1], c: ZM_PALETTE, e: `map:${id}` }, () => [Math.min(ZM_MAP_ROUND, n(extras().zmBest?.[id])), ZM_MAP_ROUND], playFor('zm'))),
];

const EXTRA = [
  ...MAP_IDS.filter(id => MAP_ART[id] && ORIGINAL_MAPS.has(id)).map(id => mapTier(id, 1)),
  ...MODE_CARDS.map(([id, name, req, stat, goal, p, c, e]) => card(id, name, 'Modes', req, () => life(stat) >= goal, { p, c, e }, () => [life(stat), goal])),
  ...CATEGORIES.filter(cat => CAT_ART[cat]).map(cat => {
    const [name, goal, p, c] = CAT_ART[cat];
    return card(`arms-${cat.toLowerCase()}`, name, 'Arms', `${fmt(goal)} kills with ${CAT_PLURAL[cat]}`, () => n(extras().cats[cat]) >= goal, { p, c, e: `cat:${cat}` }, () => [n(extras().cats[cat]), goal]);
  }),
  // Animated tiers: gold sweeps, prism cycles, molten breathes. These are the cards people should notice.
  card('gilt-10', 'Gilt Arsenal', 'Mastery', 'Sovereign camo on 10 weapons', () => n(extras().camoOn.gold) >= 10, { p: 'facets', c: GOLD, e: 'camo:gold', gold: true, anim: 'gold' }, () => [n(extras().camoOn.gold), 10]),
  card('prism-5', 'Prismatic', 'Mastery', 'Prism camo on 5 weapons', () => n(extras().camoOn.prism) >= 5, { p: 'speed', c: PRISM, e: 'camo:prism', gold: true, anim: 'prism' }, () => [n(extras().camoOn.prism), 5]),
  card('molten-5', 'Foundry Heart', 'Mastery', 'Molten Core camo on 5 weapons', () => n(extras().camoOn.molten) >= 5, { p: 'pulse', c: MOLTEN, e: 'camo:molten', gold: true, anim: 'molten' }, () => [n(extras().camoOn.molten), 5]),
  ...['Assault', 'SMG', 'Sniper', 'Shotgun'].map(cat => card(`master-${cat.toLowerCase()}`, `${CAT_ART[cat][0]} Gold`, 'Mastery', `Master every ${CAT_PLURAL[cat].replace(/s$/, '')}`,
    () => { const x = extras(); return n(x.catSize[cat]) > 0 && n(x.masteredIn[cat]) >= n(x.catSize[cat]); },
    { p: 'facets', c: cat === 'Sniper' ? PRISM : GOLD, e: `cat:${cat}`, gold: true, anim: cat === 'Sniper' ? 'prism' : 'gold' },
    () => [n(extras().masteredIn[cat]), n(extras().catSize[cat])])),
  // Career odds and ends that the V7 set does not cover.
  card('multi-100', 'Clean Sweep', 'Career', '100 multi-kills', () => life('multi') >= 100, { p: 'burst', c: ['#1e0e14', '#5a1e36', '#ffd0e4', '#ff3fd2'], e: 'medal:triple' }, () => [life('multi'), 100]),
  card('streaks-100', 'Call It In', 'Career', 'Call in 100 scorestreaks', () => life('streaksCalled') >= 100, { p: 'arc', c: ['#10161e', '#2a3a4e', '#d8e6f4', '#ff9f1c'], e: 'strike' }, () => [life('streaksCalled'), 100]),
  card('equip-150', 'Demolition', 'Career', '150 lethal equipment kills', () => life('equipKills') >= 150, { p: 'blast', c: ['#1a1408', '#4e3a14', '#ffe8b0', '#ffb02a'], e: 'frag' }, () => [life('equipKills'), 150]),
  card('assists-500', 'Right Hand', 'Career', '500 assists', () => life('assists') >= 500, { p: 'link', c: ['#0e161e', '#22384a', '#cfe8ff', '#38b6ff'], e: 'ui:party' }, () => [life('assists'), 500]),
  card('top3-50', 'Podium', 'Career', 'Finish top three 50 times', () => life('top3') >= 50, { p: 'podium', c: ['#16140e', '#3e3a24', '#f2ead0', '#ffd659'], e: 'ui:cup' }, () => [life('top3'), 50]),
  card('hip-500', 'From the Hip', 'Career', '500 hip-fire kills', () => life('hipKills') >= 500, { p: 'speed', c: ['#1c120c', '#4e301c', '#ffd8b8', '#ff8a1f'], e: 'ui:aim' }, () => [life('hipKills'), 500]),
  // One card per gun, for mastering it (every camo challenge and the ladder). Separate from the mastery-<item> cards
  // that the equipment, streak and operator tracks grant (docs/PROGRESSION.md), which cards.js restyles.
  ...WEAPON_IDS.filter(w => w !== GOLDEN_ID).map((w, i) => {
    const anim = i % 3 === 2 ? 'prism' : 'gold';
    // Every camo challenge on it, or its mastery ladder finished (the ladder's last tier grants `card:gun-<id>`).
    return card(`gun-${w}`, `${WEAPONS[w]?.name ?? w} Master`, 'Mastery', `Master the ${WEAPONS[w]?.name ?? w}`, () => !!extras().masteredSet?.has(w) || extras().granted(`card:gun-${w}`),
      { p: anim === 'prism' ? 'speed' : 'rays', c: anim === 'prism' ? PRISM : GOLD, e: w, gold: true, anim }, () => extras().chal?.(w) ?? [0, 1]);
  }),
  // The rewards pass (appended): every map's tiers, the later modes' tiers and Graveyard Shift's own cards.
  ...[...MAP_IDS, ...Object.keys(MAPS).filter(id => !MAP_IDS.includes(id))].filter(id => MAP_ART[id])
    .flatMap(id => (ORIGINAL_MAPS.has(id) ? [2, 3] : [1, 2, 3]).map(t => mapTier(id, t))),
  ...MODE_TIERS.flatMap(m => [1, 2, 3].map(t => modeTier(m, t))),
  ...ZM_CARDS,
];
// Play now targets for the original mode cards, by their stat.
const OLD_PLAY = { 'mode-tdm': 'tdm', 'mode-kc': 'kc', 'mode-dom': 'dom', 'mode-hard': 'hard', 'mode-ffa': 'ffa', 'mode-gun': 'gun', 'snd-plant': 'snd', 'snd-defuse': 'snd', 'snd-clutch': 'snd', 'ctf-cap': 'ctf', 'ctf-return': 'ctf', 'ctf-carrier': 'ctf' };
for (const c of EXTRA) if (OLD_PLAY[c.id]) c.play = playFor(OLD_PLAY[c.id]);

// Ids registered by another source (a later mastery list) win; nothing is added twice.
export function registerCards(list) {
  for (const c of list) {
    if (CARD_IDS.includes(c.id)) continue;
    CARDS.push(c);
    CARD_IDS.push(c.id);
    if (!CARD_GROUPS.includes(c.group)) CARD_GROUPS.push(c.group);
  }
}
registerCards(EXTRA);
export const EXTRA_CARD_IDS = EXTRA.map(c => c.id);

// Seasons (docs/SEASONS.md): each season's 40 track cards (group Season) and 7 ranked division cards (group Ranked),
// granted through the save's season block (Progress.hasReward). `season` lets the picker hide other seasons' locked ones.
const tierOf = (def, id) => trackRewards(def).find(r => r.own === `card:${id}`)?.tier ?? 0;
registerCards(SEASON_DEFS.flatMap(def => [
  // `c.rewards` is Progress's card career's set of every granted reward (mastery and seasons).
  ...seasonCards(def).map(c => ({ id: c.id, name: c.name, group: 'Season', req: `Season ${def.n} reward track, tier ${tierOf(def, c.id)}`, need: k => !!k?.rewards?.has(`card:${c.id}`), art: c.art, season: def.id })),
  ...rankedCards(def).map(c => ({ id: c.id, name: c.name, group: 'Ranked', req: `Reach ${c.name.slice(def.name.length + 1)} in Season ${def.n} Ranked`, need: k => !!k?.rewards?.has(`card:${c.id}`), art: c.art, season: def.id })),
]));
