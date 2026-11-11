// Calling cards beyond the V7 set: one per map, per mode (S&D and CTF get three each), per weapon category, a mastery
// card per gun and animated mastery tiers. Pure data, registered into the shared CARDS list when this module loads;
// js/ui/operators.js imports it, and progress.js imports operators.js, so the cards exist before the save is read.
//
// `need(c)` gets Progress's card career (cardCareer in progress.js) merged with extras(): what that career lacks,
// supplied by js/ui/cards.js through setCareerExtras():
//   cats {category: gun kills}  life {stat: lifetime count}  mastered  masteredSet  masteredIn {category: n}  catSize {category: n}
//   camoOn {camoId: weapons that own it}  granted(id) -> bool  (Progress.hasReward: 'card:..', 'skin:..')
// `life` is the lifetime sum of ChallengeTally counts (played:<rules>, won:<rules>, plants, defuses, clutches, flagCaps,
// flagReturns, carrierKills, confirms, multi, streaksCalled, equipKills, assists, top3, hipKills ...) plus map:<id> and
// mapwon:<id>; until Progress keeps it (Progress.lifetime()), those cards simply stay locked.
//
// art: {p: pattern, c: [ground, mid, light, accent], e: emblem, gold?, anim?: 'gold'|'prism'|'molten'}.
import { CARDS, CARD_IDS, CARD_GROUPS } from '../shared/progression.js';
import { WEAPON_IDS, CATEGORIES, GOLDEN_ID } from '../shared/constants.js';
import { MAPS, MAP_IDS } from '../shared/map.js';
import { WEAPONS } from '../shared/weapons.js';

const NONE = { cats: {}, life: {}, mastered: 0, masteredIn: {}, masteredSet: new Set(), catSize: {}, camoOn: {}, granted: () => false };
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
export const careerExtras = () => extras();

const n = v => (Number.isFinite(v) ? v : 0);
const life = key => n(extras().life[key]);
const fmt = v => v.toLocaleString('en-US');
const card = (id, name, group, req, need, art) => ({ id, name, group, req, need: () => { try { return !!need(); } catch { return false; } }, art });

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
};
const MAP_WINS = 10;

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

const EXTRA = [
  ...MAP_IDS.filter(id => MAP_ART[id]).map(id => {
    const [name, p, c] = MAP_ART[id];
    return card(`map-${id}`, name, 'Maps', `Win ${MAP_WINS} matches on ${MAPS[id].name}`, () => life(`mapwon:${id}`) >= MAP_WINS, { p, c, e: `map:${id}` });
  }),
  ...MODE_CARDS.map(([id, name, req, stat, goal, p, c, e]) => card(id, name, 'Modes', req, () => life(stat) >= goal, { p, c, e })),
  ...CATEGORIES.filter(cat => CAT_ART[cat]).map(cat => {
    const [name, goal, p, c] = CAT_ART[cat];
    return card(`arms-${cat.toLowerCase()}`, name, 'Arms', `${fmt(goal)} kills with ${CAT_PLURAL[cat]}`, () => n(extras().cats[cat]) >= goal, { p, c, e: `cat:${cat}` });
  }),
  // Animated tiers: gold sweeps, prism cycles, molten breathes. These are the cards people should notice.
  card('gilt-10', 'Gilt Arsenal', 'Mastery', 'Sovereign camo on 10 weapons', () => n(extras().camoOn.gold) >= 10, { p: 'facets', c: GOLD, e: 'camo:gold', gold: true, anim: 'gold' }),
  card('prism-5', 'Prismatic', 'Mastery', 'Prism camo on 5 weapons', () => n(extras().camoOn.prism) >= 5, { p: 'speed', c: PRISM, e: 'camo:prism', gold: true, anim: 'prism' }),
  card('molten-5', 'Foundry Heart', 'Mastery', 'Molten Core camo on 5 weapons', () => n(extras().camoOn.molten) >= 5, { p: 'pulse', c: MOLTEN, e: 'camo:molten', gold: true, anim: 'molten' }),
  ...['Assault', 'SMG', 'Sniper', 'Shotgun'].map(cat => card(`master-${cat.toLowerCase()}`, `${CAT_ART[cat][0]} Gold`, 'Mastery', `Master every ${CAT_PLURAL[cat].replace(/s$/, '')}`,
    () => { const x = extras(); return n(x.catSize[cat]) > 0 && n(x.masteredIn[cat]) >= n(x.catSize[cat]); },
    { p: 'facets', c: cat === 'Sniper' ? PRISM : GOLD, e: `cat:${cat}`, gold: true, anim: cat === 'Sniper' ? 'prism' : 'gold' })),
  // Career odds and ends that the V7 set does not cover.
  card('multi-100', 'Clean Sweep', 'Career', '100 multi-kills', () => life('multi') >= 100, { p: 'burst', c: ['#1e0e14', '#5a1e36', '#ffd0e4', '#ff3fd2'], e: 'medal:triple' }),
  card('streaks-100', 'Call It In', 'Career', 'Call in 100 scorestreaks', () => life('streaksCalled') >= 100, { p: 'arc', c: ['#10161e', '#2a3a4e', '#d8e6f4', '#ff9f1c'], e: 'strike' }),
  card('equip-150', 'Demolition', 'Career', '150 lethal equipment kills', () => life('equipKills') >= 150, { p: 'blast', c: ['#1a1408', '#4e3a14', '#ffe8b0', '#ffb02a'], e: 'frag' }),
  card('assists-500', 'Right Hand', 'Career', '500 assists', () => life('assists') >= 500, { p: 'link', c: ['#0e161e', '#22384a', '#cfe8ff', '#38b6ff'], e: 'ui:party' }),
  card('top3-50', 'Podium', 'Career', 'Finish top three 50 times', () => life('top3') >= 50, { p: 'podium', c: ['#16140e', '#3e3a24', '#f2ead0', '#ffd659'], e: 'ui:cup' }),
  card('hip-500', 'From the Hip', 'Career', '500 hip-fire kills', () => life('hipKills') >= 500, { p: 'speed', c: ['#1c120c', '#4e301c', '#ffd8b8', '#ff8a1f'], e: 'ui:aim' }),
  // One card per gun, for mastering it (every camo challenge and the ladder). Separate from the mastery-<item> cards
  // that the equipment, streak and operator tracks grant (docs/PROGRESSION.md), which cards.js restyles.
  ...WEAPON_IDS.filter(w => w !== GOLDEN_ID).map((w, i) => {
    const anim = i % 3 === 2 ? 'prism' : 'gold';
    return card(`gun-${w}`, `${WEAPONS[w]?.name ?? w} Master`, 'Mastery', `Master the ${WEAPONS[w]?.name ?? w}`, () => !!extras().masteredSet?.has(w),
      { p: anim === 'prism' ? 'speed' : 'rays', c: anim === 'prism' ? PRISM : GOLD, e: w, gold: true, anim });
  }),
];

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
