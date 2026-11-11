// The bot player pool (docs/ROADMAP.md item 15). Two hundred named players with persistent profiles, built from a fixed
// seed so every phone holds the same pool without sending it: a host only has to name a bot (its profile id) and its
// rating for the match, and every client can look the rest up.
//
//   BOT_POOL                 the profiles, in a fixed order (index = id number)
//   profileById(id)          'p012' -> profile, or null
//   formRating(profile, seed)  this match's skill, 0 (a weak player) .. 1 (the best): a locked profile always plays at its
//                            tier; everyone else rolls a form around their own level, so a good player can have a bad
//                            night and a weak one a hot streak
//   tierOf(rating)           the SKILLS tier nearest a rating ('recruit' | 'regular' | 'veteran' | 'elite')
//   pickPoolBots(opts)       matchmaking: draws a match's bots near the humans' rating and level, never one twice
//   humanRating(info)        a human's place on the same 0..1 scale, from their level and recent K/D
//   careerAt(profile, date)  career totals as of a date (see the leaderboard notes at careerAt)
//
// A profile:
//   id, name, index           'p017', 'Brakie', 17
//   style                     'rusher' | 'anchor' | 'flanker' | 'objective' | 'sniper' | 'support'
//   classes, guns             favourite weapon classes (two) and guns (three, favourite first); kit[gun] = which of
//                             the bot kits (js/sim/bots.js botAttachments `i`) they run on it
//   secondary, perks, tactical, lethal, streaks
//   operator, skin, card, emblem, camo   looks; skin is a skin id (js/ui/operators.js), emblem may be null
//   skill: { locked: null | tier, mu, form }   mu: their usual rating; form: sigma of the per-match roll
//   activity                  average matches a day; brShare the share of them that are battle royale
//   joined                    days after POOL_EPOCH the player started (negative: before it); base, the career then
import { WEAPONS } from './weapons.js';
import { PRIMARY_IDS } from './constants.js';
import { PERKS, TACTICALS, LETHALS, STREAKS } from './catalog.js';
import { CARDS, PLAYER_CURVE, MAX_LEVEL, MAX_PRESTIGE } from './progression.js';
import { OPERATORS } from '../ui/operators.js';
import { EMBLEMS } from '../ui/emblems.js';

export const POOL_SEED = 0x5717c4a2;
// Day zero of careers. Fixed: changing it would change every bot's career at every date.
export const POOL_EPOCH = Date.UTC(2026, 10, 1);
const DAY = 86400000;
// The day extraction mode (ROADMAP item 17) went live; null until it ships, so extractions stay 0. Set it once, never move it.
export const EXTRACTION_LAUNCH = null;

export const TIERS = ['recruit', 'regular', 'veteran', 'elite'];
// Where each tier sits on the rating scale; bots.js interpolates SKILLS between them (skillAt).
export const TIER_RATING = { recruit: 0, regular: 1 / 3, veteran: 2 / 3, elite: 1 };
export const tierOf = r => TIERS[Math.max(0, Math.min(3, Math.round(r * 3)))];

// Gamer tags, checked by dev/sim-botpool.mjs against every item, map and mode name in the game. At most 12 characters
// (the length a human's name is cut to). Append only: a tag's place is its profile id.
const TAGS = `Boxcar77 flatcar_kid Gondolier Hostler GandyDancer Hogger Bakehead CarKnocker Highball RedballRun Cabooser Drawbar
Tankcar_9 BogieMan FrogPoint Catenary Pantograph SleeperCar Dogcatcher Brakie Bullgang Highrailer Piggyback railfan99 WyeTrack
Turntable Roundhouse Stoker FiremanSix Railhead BufferStop Interchange Manifest UnitTrain PusherCrew Milepost42 ditchlight
deadhead Sandhouse Flagstop Whistlepost hotbox DutchDrop FlyingSwitch KickerCar Hogshead Cinderbelly RustBucket NightFreight
LowBattery overtime_ GraveShift DieselHeart HeadEndPwr NoBrakes Derailer SlackAction BentKnuckle Gladhands Notch8 Run8
ThrottleUp YardGoat Switchback PassingLoop Spur_Line LevelXing Signalbox Semaphore TokenBlock noscope_ned QuickHands
TryHardTerry LagSpike PingPong ThumbWar TwinSticks StickDrift DeadZone FireRing SlideCancel BunnyHop Dropshot Jumpshot Prefire
Wallbang Spawntrap Headglitch Peekaboo OneTap TacSprint HipfireHero Sweatband GGnoRE respawn_rdy KDA_Kid Minimap RedDotRuth
Killfeed Scoreboard LastAlive ThirdParty Rotate_Now LootGoblin FloorLoot HotDrop PlateUp Rezzer SquadWipe SelfRevive RingRunner
Afterglow Gloaming SodiumLight Floodlight Halogen TailLight Moonshine StreetLamp Twilight_ Sootface Rebar WeldBead Sparky
Gearhead Spanner TorqueSpec Socket_Set PalletJack Forklift Hardhat SteelToe Lunchpail TimeCard PunchClock ShiftHorn Teamster
Longshore Stevedore Bollard Hawser Mooring BilgeRat Tugboat Drydock Portside Starboard Breakwater Foghorn Drizzle Hailstone
Thunderhead Crosswind Tailwind Updraft Fuzzbox Wavelength Dialtone BusySignal Payphone Walkie OverAndOut Copy_That TenFour
Alleycat Yardcat Pigeon Starling Crowbar Badger Mongoose Jackal Stoat Weasel Ferret Raccoon Bullfrog Snapper Gecko Lynx Bobcat
Mantis Hornet Cicada Firefly Ridge Talon Gully Quill Tarn Onyx Brine Wick Sorrel Lark Husk Briar Knell Jinx Thatch
GravelPit TrackWalker NightOwl SteamHead CoalChute TiePlate FishPlate Clinker Firebox Tender9 Waybill Consist FlickShot
StrafeKing PeekQueen CrouchSpam AimDuke lowping_lou HighPing Rubberband Desync TickRate FrameDrop VsyncVic PacketLoss Netcode
Hitreg OneClip ReloadRita SoloQueue DuoQueue Lobbyist AfkAndy brb_snack GG_Gus Osprey Heron Plover Shrike Magpie Jackdaw Vole
Marten Otter Pika Dingo Caracal Ocelot Adder Krait Sleet Gale Monsoon Flux Grommet Sprocket Piston Camshaft Gasket Bushing
Lugnut Ratchet Hacksaw Spirit_Lvl Sawhorse Toolbox Overalls NightBus LastTrain RedEye_Flt SignalLost Neon_Nora Asphalt
Underpass Overgrowth Slipstream Backdraft Kickback Rebound Tumbleweed Halfmoon Sundown Daybreak Lowtide Sandbar Shoal Jetsam
Flotsam Barnacle Pike_Line Minnow Axolotl Pangolin Wombat Quokka Tapir Yak_Attack Bison Moose_Juice Whippet`.split(/\s+/);

// ---- Clans and regular duos (ROADMAP item 19) ----
// Players from p200 on joined with the clans (the first 200 are untouched: their profiles and careers are exactly as they
// were). A clan: a tag (2-4 capitals, shown as "[TAG] Name"), a name, a skill profile and its members by profile index.
// `skill` shapes the members who joined with the clan (p200 on): 'stacked' plays like elites (a third locked there),
// 'weak' like recruits, 'average' as anyone. Older members were picked for clans that suit them. Members queue together:
// pickPoolBots pulls clanmates (and a duo's partner) into the same lobby, and buildRoster seats a party on one side.
// Append only, like TAGS: never move a member or change a tag (leaderboards show them).
export const CLAN_ERA = 200;
const CLAN_DATA = [
  { tag: 'VXN', name: 'Vexen', skill: 'stacked', members: [6, 73, 86, 262, 269, 298] },
  { tag: 'ZPHR', name: 'Zephyr Rail', skill: 'stacked', members: [60, 84, 203, 204, 210] },
  { tag: 'KJX', name: 'Kojax', skill: 'stacked', members: [31, 58, 245, 274] },
  { tag: 'QZR', name: 'Quazar', skill: 'stacked', members: [11, 136, 157, 207, 236, 237, 276] },
  { tag: 'OXB', name: 'Oxbow Yard', skill: 'average', members: [83, 125, 179, 228, 255, 256, 261, 265] },
  { tag: 'BRQ', name: 'Barquentine', skill: 'average', members: [37, 164, 186, 264, 295] },
  { tag: 'TWZ', name: 'Twelve Zero', skill: 'average', members: [97, 200, 205, 270] },
  { tag: 'LNTN', name: 'Lantana', skill: 'average', members: [100, 214, 241, 251, 281, 285] },
  { tag: 'GRVL', name: 'Gravel Crew', skill: 'average', members: [40, 216, 222, 268, 288] },
  { tag: 'HXL', name: 'Hexle', skill: 'average', members: [61, 240, 275] },
  { tag: 'DSKR', name: 'Daskara', skill: 'average', members: [45, 140, 226, 259] },
  { tag: 'PYLN', name: 'Pylon Set', skill: 'average', members: [19, 158, 235, 260, 280, 296] },
  { tag: 'RKTY', name: 'Rickety', skill: 'weak', members: [89, 147, 206, 215, 254] },
  { tag: 'NPPR', name: 'Nappers', skill: 'average', members: [21, 119, 201] },
  { tag: 'YDG', name: 'Yodel Gang', skill: 'average', members: [7, 213, 246, 284, 290, 293, 294] },
  { tag: 'CNDR', name: 'Cinder Club', skill: 'average', members: [49, 231, 244, 258] },
  { tag: 'SPKS', name: 'Sparks', skill: 'average', members: [70, 141, 217, 249, 271] },
  { tag: 'FRST', name: 'First Shift', skill: 'average', members: [53, 165, 233] },
  { tag: 'MOTH', name: 'Moth Hour', skill: 'average', members: [20, 224, 225, 279] },
  { tag: 'TRSL', name: 'Trestle', skill: 'average', members: [25, 229, 234, 243, 272, 286] },
  { tag: 'GLMR', name: 'Gloamers', skill: 'average', members: [135, 202, 252, 287, 292] },
  { tag: 'ZZZ', name: 'Snooze', skill: 'weak', members: [15, 90, 219, 299] },
  { tag: 'HWL', name: 'Howl', skill: 'average', members: [134, 149, 248] },
];
// Two players who nearly always queue together (no tag).
const DUO_DATA = [[55, 78], [17, 42], [66, 122], [69, 129], [34, 39], [143, 155], [238, 250], [239, 253], [221, 263], [223, 257], [278, 282], [247, 291]];
const pid = i => `p${String(i).padStart(3, '0')}`;
export const CLANS = Object.freeze(CLAN_DATA.map(c => Object.freeze({ tag: c.tag, name: c.name, skill: c.skill, members: Object.freeze(c.members.map(pid)) })));
export const DUOS = Object.freeze(DUO_DATA.map(d => Object.freeze(d.map(pid))));
const CLAN_BY_INDEX = new Map(), DUO_BY_ID = new Map();
CLAN_DATA.forEach((c, k) => c.members.forEach(i => CLAN_BY_INDEX.set(i, CLANS[k])));
for (const d of DUOS) { DUO_BY_ID.set(d[0], d[1]); DUO_BY_ID.set(d[1], d[0]); }

// ---- Deterministic randomness ----
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash32(...parts) {
  let h = 2166136261;
  for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}
const unit = (...parts) => hash32(...parts) / 4294967296;
function gauss(rng) { return (rng() + rng() + rng() + rng() + rng() + rng() - 3) / 0.7071; }
const clamp01 = v => Math.max(0, Math.min(1, v));
function pickW(rng, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let x = rng() * total;
  for (const [v, w] of entries) if ((x -= w) < 0) return v;
  return entries[entries.length - 1][0];
}

// ---- Play styles: what a style likes to carry, and how it nudges the brain (js/sim/bots.js reads `lean`) ----
// lean: multipliers on SKILLS fields for this player (flank, holdProb, objPlay, objPush, sprint ...). They change how a
// bot plays, not how well it shoots: that is the rating's job.
export const STYLES = {
  rusher: {
    weight: 22, classes: [['SMG', 5], ['Shotgun', 3], ['Assault', 2]],
    perks: [['marathon', 'adrenaline', 'quickmend'], ['fasthands', 'scavenger'], ['deadsilence', 'ghost']],
    tactical: [['stim', 3], ['flash', 3], ['stun', 2], ['smoke', 1]], lethal: [['frag', 2], ['sticky', 2], ['hatchet', 2], ['shiv', 2], ['impact', 1]],
    streaks: ['sweep', 'uav', 'missile', 'hound', 'resupply', 'recon', 'airdrop'],
    lean: { flank: 1.25, holdProb: 0.55, sprint: 1, objPush: 1.3, slide: 1.5 },
  },
  anchor: {
    weight: 14, classes: [['LMG', 5], ['Assault', 4], ['Marksman', 1]],
    perks: [['flak', 'tacmask', 'quickmend'], ['bandolier', 'hardline', 'strongarm'], ['tracker', 'engineer', 'coldblood']],
    tactical: [['trophy', 3], ['sensor', 2], ['bulwark', 2], ['smoke', 1]], lethal: [['claymore', 3], ['mine', 2], ['tripwire', 2], ['molotov', 1]],
    streaks: ['turret', 'uav', 'mortar', 'dome', 'juggernaut', 'plates', 'rover'],
    lean: { flank: 0.45, holdProb: 1.6, objDefend: 1.6, objPush: 0.7, holdTime: 1.3 },
  },
  flanker: {
    weight: 18, classes: [['SMG', 4], ['Assault', 4], ['Shotgun', 1]],
    perks: [['marathon', 'adrenaline'], ['fasthands', 'scavenger', 'hardline'], ['ghost', 'deadsilence', 'coldblood']],
    tactical: [['decoy', 2], ['snapshot', 2], ['stun', 2], ['flash', 2]], lethal: [['sticky', 2], ['frag', 2], ['hatchet', 1], ['drill', 2], ['shiv', 1]],
    streaks: ['uav', 'missile', 'strike', 'hound', 'chopper', 'bombrun', 'recon'],
    lean: { flank: 2.1, holdProb: 0.7, objPlay: 0.85 },
  },
  objective: {
    weight: 18, classes: [['Assault', 5], ['SMG', 3], ['LMG', 1]],
    perks: [['flak', 'quickmend', 'tacmask'], ['hardline', 'scavenger', 'bandolier'], ['tracker', 'engineer', 'ghost']],
    tactical: [['smoke', 3], ['trophy', 2], ['medpack', 2], ['stim', 1]], lethal: [['frag', 3], ['molotov', 2], ['cluster', 2], ['thermite', 1]],
    streaks: ['uav', 'resupply', 'plates', 'dome', 'airdrop', 'overwatch', 'emp'],
    lean: { objPlay: 1.3, objPush: 1.25, objDefend: 1.2, flank: 0.7 },
  },
  sniper: {
    weight: 13, classes: [['Sniper', 5], ['Marksman', 4]],
    perks: [['marathon', 'tacmask', 'flak'], ['fasthands', 'strongarm', 'bandolier'], ['coldblood', 'ghost', 'tracker']],
    tactical: [['sensor', 3], ['snapshot', 2], ['decoy', 1], ['smoke', 1]], lethal: [['claymore', 3], ['tripwire', 2], ['mine', 2], ['crawler', 1]],
    streaks: ['uav', 'sweep', 'overwatch', 'jammer', 'recon', 'missile', 'emp'],
    lean: { flank: 0.6, holdProb: 1.7, objPlay: 0.75, holdTime: 1.4 },
  },
  support: {
    weight: 15, classes: [['Assault', 4], ['LMG', 3], ['Marksman', 2], ['SMG', 1]],
    perks: [['quickmend', 'flak', 'tacmask'], ['scavenger', 'bandolier', 'hardline'], ['engineer', 'tracker', 'coldblood']],
    tactical: [['medpack', 3], ['smoke', 2], ['sensor', 2], ['shock', 1], ['blackout', 1]], lethal: [['frag', 2], ['cluster', 2], ['molotov', 1], ['charge', 1]],
    streaks: ['uav', 'resupply', 'plates', 'jammer', 'dome', 'overwatch', 'emp', 'swarm'],
    lean: { objDefend: 1.3, flank: 0.8, callouts: 1 },
  },
};
export const STYLE_IDS = Object.keys(STYLES);

// Bots' sidearms, by style (js/sim/bots.js BOT_SECONDARIES covers the rest).
const SIDEARMS = {
  rusher: ['machpistol', 'pistol', 'scatter', 'akimbo'], anchor: ['launcher', 'pistol', 'revolver'], flanker: ['machpistol', 'deuce', 'pistol', 'knife'],
  objective: ['pistol', 'launcher', 'thumper', 'revolver'], sniper: ['revolver', 'machpistol', 'pistol', 'deuce'], support: ['launcher', 'pistol', 'thumper', 'nailer'],
};

const GUNS_BY_CLASS = {};
for (const id of PRIMARY_IDS) {
  const w = WEAPONS[id];
  if (w && !w.golden) (GUNS_BY_CLASS[w.category] ??= []).push(id);
}
const CARD_IDS = new Set(CARDS.map(c => c.id));
const SKIN_STEPS = ['base', 'field', 2, 3, 4, 5];
const CAMO_STEPS = [['ash', 'stalker', 'rust', 'comb', 'bare'], ['cobalt', 'crimson', 'glacier', 'toxin', 'iron'], ['gold', 'molten', 'carbon', 'wire']];

// Locked profiles: about one in five. Most of them sit at the ends (the player you always dread, the one you always
// farm), a few in the middle.
const LOCK_SHARE = 0.2;
const LOCK_TIERS = [['elite', 0.36], ['recruit', 0.34], ['veteran', 0.15], ['regular', 0.15]];
const LOCK_RATING = { recruit: 0.03, regular: 0.333, veteran: 0.667, elite: 0.97 };

function buildProfile(index) {
  const rng = mulberry32(hash32(POOL_SEED, index));
  const id = `p${String(index).padStart(3, '0')}`;
  const style = pickW(rng, STYLE_IDS.map(s => [s, STYLES[s].weight]));
  const S = STYLES[style];
  const classes = [];
  while (classes.length < Math.min(2, S.classes.length)) classes.push(pickW(rng, S.classes.filter(([k]) => !classes.includes(k))));
  // Three guns: two of the main class, one of the second; favourite first.
  const guns = [];
  const fromClass = (c, n) => {
    const list = (GUNS_BY_CLASS[c] ?? []).filter(g => !guns.includes(g));
    for (let k = 0; k < n && list.length; k++) guns.push(list.splice(Math.floor(rng() * list.length), 1)[0]);
  };
  fromClass(classes[0], 2);
  fromClass(classes[1] ?? classes[0], 1);
  const kit = Object.fromEntries(guns.map(g => [g, Math.floor(rng() * 6)]));
  const secondary = SIDEARMS[style][Math.floor(rng() * SIDEARMS[style].length)];
  const perks = S.perks.map(list => (rng() < 0.8 ? list[Math.floor(rng() * list.length)]
    : Object.keys(PERKS).filter(p => PERKS[p].tier === S.perks.indexOf(list))[Math.floor(rng() * 5)]));
  const tactical = rng() < 0.85 ? pickW(rng, S.tactical) : Object.keys(TACTICALS)[Math.floor(rng() * Object.keys(TACTICALS).length)];
  const lethal = rng() < 0.85 ? pickW(rng, S.lethal) : Object.keys(LETHALS)[Math.floor(rng() * Object.keys(LETHALS).length)];
  const pool = S.streaks.slice();
  const streaks = [];
  while (streaks.length < 3) streaks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  streaks.sort((a, b) => STREAKS[a].cost - STREAKS[b].cost);

  // Skill. mu is where they usually play; form how far a night can swing them. A clan's own recruits (CLAN_ERA on)
  // follow its skill profile.
  let locked = null, mu, form;
  const clanSkill = index >= CLAN_ERA ? CLAN_BY_INDEX.get(index)?.skill ?? 'average' : 'average';
  if (clanSkill === 'stacked') {
    if (rng() < 0.34) { locked = 'elite'; mu = LOCK_RATING.elite; form = 0; }
    else { mu = 0.74 + rng() * 0.2; form = 0.05 + rng() * 0.06; }
  } else if (clanSkill === 'weak') {
    if (rng() < 0.3) { locked = 'recruit'; mu = LOCK_RATING.recruit; form = 0; }
    else { mu = 0.06 + rng() * 0.22; form = 0.06 + rng() * 0.08; }
  } else if (rng() < LOCK_SHARE) {
    locked = pickW(rng, LOCK_TIERS);
    mu = LOCK_RATING[locked]; form = 0;
  } else {
    mu = clamp01(0.5 + gauss(rng) * 0.2);
    form = 0.06 + rng() * 0.1;
  }

  // History: how long they have played, how much, and what that came to by the epoch.
  const activity = Math.round((0.15 + rng() ** 1.8 * 3.6) * 100) / 100;    // Matches a day: most play a little, a few a lot.
  const brShare = Math.round(clamp01((style === 'sniper' || style === 'flanker' ? 0.3 : 0.18) + gauss(rng) * 0.12) * 100) / 100;
  const joined = -Math.round(rng() ** 0.8 * 240);                           // Up to eight months before the epoch.
  const base = careerBase(mu, activity, -joined, brShare, rng);

  // Looks: better-established players wear more of what they have earned.
  const seniority = clamp01(base.xp / (PLAYER_CURVE.cap * 5));
  const op = OPERATORS[Math.floor(rng() * OPERATORS.length)].id;
  const step = Math.min(5, Math.floor(rng() * 3 + seniority * 4 + (locked === 'elite' ? 1 : 0)));
  const skin = `skin:${op}-${SKIN_STEPS[step]}`;
  const card = pickCard(rng, base, perks, locked, mu);
  const emblem = rng() < 0.7 ? EMBLEMS[Math.floor(rng() * EMBLEMS.length)].id : null;
  // Camo on the favourite gun: plenty run none; the rest wear what their time in the game has earned.
  const cr = rng() + seniority * 0.5;
  const camo = cr < 0.55 ? 'none' : cr < 1.05 ? CAMO_STEPS[0][Math.floor(rng() * CAMO_STEPS[0].length)]
    : cr < 1.3 ? CAMO_STEPS[1][Math.floor(rng() * CAMO_STEPS[1].length)] : CAMO_STEPS[2][Math.floor(rng() * CAMO_STEPS[2].length)];

  return Object.freeze({
    id, index, name: TAGS[index], style, classes: Object.freeze(classes), guns: Object.freeze(guns), kit: Object.freeze(kit), secondary,
    perks: Object.freeze(perks), tactical, lethal, streaks: Object.freeze(streaks),
    operator: op, skin, card, emblem, camo,
    skill: Object.freeze({ locked, mu: Math.round(mu * 1000) / 1000, form: Math.round(form * 1000) / 1000 }),
    activity, brShare, joined, base: Object.freeze(base),
  });
}

function pickCard(rng, base, perks, locked, mu) {
  const { prestige } = levelFromXp(base.xp);
  const r = rng();
  if (prestige > 0 && r < 0.3) return `prestige-${1 + Math.floor(rng() * prestige)}`;
  if (r < 0.55) return `pro-${perks[Math.floor(rng() * 3)]}`;
  if (r < 0.75) {
    const career = ['kills-100', 'head-250', 'long-100', 'slide-100', 'clean-250', 'level-30', 'veteran'];
    if (base.kills >= 1000) career.push('kills-1000', 'kills-1000');
    return career[Math.floor(rng() * career.length)];
  }
  if (r < 0.88 && (mu > 0.55 || locked === 'elite')) {
    const gold = CARDS.filter(c => c.group === 'Mastery');
    return gold[Math.floor(rng() * gold.length)].id;
  }
  return 'yard';
}

// ---- Careers ----

// Per-match rates for a player of usual rating mu. Shared by the base career and careerAt, so they agree.
function rates(mu) {
  return {
    kpm: 7 + 13 * mu,                       // Kills a match.
    kd: 0.55 + 1.55 * mu ** 1.25,           // Their long-run K/D.
    win: 0.4 + 0.22 * mu,                   // Team matches won.
    brWin: 0.01 + 0.13 * mu ** 1.5,         // Battle royale wins...
    brTop5: 0.12 + 0.4 * mu,                // ...and top fives.
    xp: 1700 + 1900 * mu,                   // XP a match.
    exfil: 0.25 + 0.5 * mu,                 // Extractions a match, once that mode exists.
  };
}

function careerBase(mu, activity, days, brShare, rng) {
  const R = rates(mu);
  const matches = Math.floor(activity * days * (0.6 + rng() * 0.6));
  return accrue(R, matches, brShare, 1);
}

// Totals from `matches` played at rates R, `k` a form factor for the stretch (1 = their usual).
function accrue(R, matches, brShare, k) {
  const br = matches * brShare, team = matches - br;
  const kills = matches * R.kpm * k;
  return {
    matches, kills, deaths: kills / (R.kd * k), wins: team * Math.min(0.9, R.win * k ** 0.5),
    brMatches: br, brWins: br * R.brWin * k, brTop5: br * Math.min(1, R.brTop5 * k), xp: matches * R.xp * k ** 0.3,
  };
}

// XP to prestige and level: each prestige is one climb of the player curve to MAX_LEVEL.
export function levelFromXp(xp) {
  const per = PLAYER_CURVE.cap;
  const prestige = Math.min(MAX_PRESTIGE, Math.floor(xp / per));
  const level = prestige >= MAX_PRESTIGE ? Math.min(MAX_LEVEL, PLAYER_CURVE.levelOf(xp - MAX_PRESTIGE * per)) : PLAYER_CURVE.levelOf(xp - prestige * per);
  return { prestige, level };
}

const WEEK = 7;
// careerAt(profile, date): a bot's career totals as of `date` (a Date or ms), for leaderboards (ROADMAP item 16).
//   { matches, kills, deaths, kd, wins, brMatches, brWins, brTop5, extractions, xp, level, prestige, days }
// Deterministic: the same profile and date give the same numbers on every phone, and every total is non-decreasing in
// the date (dev/sim-botpool.mjs checks it). Growth: each week since POOL_EPOCH (or since the player joined, if later)
// they play activity x 7 x a weekly factor (0..2, from a hash of id and week: some weeks off, some binges) matches, at
// their rates (from skill.mu) times a weekly form factor (0.8..1.2), so boards move week to week and nobody's K/D is a
// straight line. The current week counts its days so far. Dates before the epoch return the base career. Integers
// throughout (floored), apart from kd. Cheap: one loop step per week since the epoch.
export function careerAt(profile, date = Date.now()) {
  const t = typeof date === 'number' ? date : date.getTime();
  const days = Math.max(0, Math.floor((t - POOL_EPOCH) / DAY));
  const p = profile, R = rates(p.skill.mu), b = p.base;
  const sum = { matches: b.matches, kills: b.kills, deaths: b.deaths, wins: b.wins, brMatches: b.brMatches, brWins: b.brWins, brTop5: b.brTop5, xp: b.xp, extractions: 0 };
  const start = Math.max(0, p.joined);
  const extraFrom = EXTRACTION_LAUNCH === null ? Infinity : Math.max(0, Math.floor((EXTRACTION_LAUNCH - POOL_EPOCH) / DAY));
  for (let d0 = start; d0 < days; d0 += WEEK) {
    const span = Math.min(WEEK, days - d0), wk = Math.floor(d0 / WEEK);
    const busy = 2 * unit(p.id, 'week', wk);
    const k = 0.8 + 0.4 * unit(p.id, 'form', wk);
    const add = accrue(R, p.activity * span * busy, p.brShare, k);
    for (const key in add) sum[key] += add[key];
    // Extraction matches come out of the team share once the mode exists.
    const exDays = Math.max(0, Math.min(d0 + span, days) - Math.max(d0, extraFrom));
    if (exDays > 0) sum.extractions += p.activity * exDays * busy * 0.15 * R.exfil * k;
  }
  const out = {};
  for (const key in sum) out[key] = Math.floor(sum[key]);
  out.kd = out.deaths ? Math.round(out.kills / out.deaths * 100) / 100 : out.kills;
  Object.assign(out, levelFromXp(out.xp));
  out.days = days;
  return out;
}

export const BOT_POOL = Object.freeze(TAGS.map((_, i) => buildProfile(i)));
const BY_ID = new Map(BOT_POOL.map(p => [p.id, p]));
export const profileById = id => BY_ID.get(id) ?? null;

// The clan a profile (or profile id) belongs to, { tag, name, skill, members: [ids] }, or null for a loner.
export function clanInfo(profile) {
  const p = typeof profile === 'string' ? BY_ID.get(profile) : profile;
  return p ? CLAN_BY_INDEX.get(p.index) ?? null : null;
}
// Its clan tag ('VXN'), or null: what leaderboards show before the name (js/shared/boards.js).
export const clanOf = profile => clanInfo(profile)?.tag ?? null;
// A regular duo's other half (profile id), or null.
export const duoOf = profile => DUO_BY_ID.get(typeof profile === 'string' ? profile : profile?.id) ?? null;
// How a profile shows in lobbies, scoreboards, the killfeed and results: "[VXN] Name", or just the name.
export function displayName(profile) {
  const tag = clanOf(profile);
  return tag ? `[${tag}] ${profile.name}` : profile.name;
}
// Who a profile queues with: its clanmates or its duo partner (ids, itself left out), or null.
function partyOf(p) {
  const c = CLAN_BY_INDEX.get(p.index);
  if (c) return c.members.filter(id => id !== p.id);
  const d = DUO_BY_ID.get(p.id);
  return d ? [d] : null;
}
// How often a clan member or duo drawn into a lobby brings friends along, and how many (up to the party cap).
const CLAN_PULL = 0.72, DUO_PULL = 0.85;

// ---- Form and matchmaking ----

// This match's rating for a profile. Locked: their tier, always. Otherwise mu plus a roll of their form, with the odd
// off night or hot streak: about one match in ten swings a lot further than their usual spread.
export function formRating(profile, seed) {
  const s = profile.skill;
  if (s.locked) return LOCK_RATING[s.locked];
  const rng = mulberry32(hash32('form', profile.id, seed));
  let z = gauss(rng);
  const swing = rng();
  if (swing < 0.06) z -= 1.8;              // Tired, tilted, or on a bad connection.
  else if (swing < 0.11) z += 1.4;          // Everything is landing tonight.
  return Math.round(clamp01(s.mu + z * s.form) * 1000) / 1000;
}

// The rating an average human plays at against this pool's bots, so that a typical player's K/D is about 1 (calibrated
// with dev/balance-sim.mjs --realistic and the human-like thumb). humanRating moves a player away from it with their
// record.
export const HUMAN_BASE = 0.27;
// info: { level, prestige, kd (recent K/D, or null), matches (how many that K/D is over) }
export function humanRating({ level = 1, prestige = 0, kd = null, matches = 0 } = {}) {
  let r = HUMAN_BASE + Math.min(0.08, (prestige * MAX_LEVEL + level) / 5000);
  if (kd !== null && matches > 0) {
    const trust = Math.min(1, matches / 10);
    r += trust * Math.max(-0.25, Math.min(0.3, Math.log2(Math.max(0.1, kd)) * 0.18));
  } else if (prestige === 0 && level < 5) r -= 0.08;     // Brand new: a gentler first few matches.
  return Math.round(clamp01(r) * 1000) / 1000;
}

// Level and prestige as one number, for "near my level".
const rank = (prestige, level) => prestige * MAX_LEVEL + level;

// The last few lobbies drawn on this phone, so the next draw seldom repeats one. Module memory: one session.
const RECENT = [];
const RECENT_KEEP = 2;

// Draws `count` distinct bots for a match. target: the humans' mean rating (humanRating); level: their mean rank as
// {level, prestige}; spread: how far from the target a draw may wander (sigma, on the 0..1 scale); exclude: profile
// ids already seated; recent: the previous lobbies' ids (defaults to this phone's memory). Returns
// [{ profile, rating, tier, badge: {level, prestige}, party }] in draw order. Deterministic for a seed and inputs.
// locked: only profiles locked at that tier (tests and the balance rig). party: the largest group that queues together
// in this mode (1: nobody brings friends); a drawn clan member or duo often pulls clanmates in with them, and every
// player of one group carries the same `party` number (null alone), so buildRoster can seat them together.
export function pickPoolBots({ count, seed = 0, target = HUMAN_BASE, level = null, spread = 0.17, exclude = [], recent = null, date = Date.now(), remember = true, locked = null, party = 1 } = {}) {
  const rng = mulberry32(hash32('lobby', seed));
  const lastIds = new Set((recent ?? RECENT).flat());
  const taken = new Set(exclude);
  const want = level ? rank(level.prestige ?? 0, level.level ?? 1) : null;
  const cand = [];
  for (const p of BOT_POOL) {
    if (taken.has(p.id) || (locked && p.skill.locked !== locked)) continue;
    // Skill: a bell around the target (locked players by their tier, others by their usual level, mu).
    const dr = p.skill.mu - target;
    let w = Math.exp(-dr * dr / (2 * spread * spread)) + 0.02;
    // Level: loosely, as real matchmaking weighs it. Uses the career now, so it moves with the bots.
    if (want !== null) {
      const c = careerAt(p, date);
      const dl = (rank(c.prestige, c.level) - want) / 150;
      w *= 0.35 + 0.65 * Math.exp(-dl * dl / 2);
    }
    // Played them a moment ago: possible (the same person can be online again), just not likely.
    if (lastIds.has(p.id)) w *= 0.3;
    // How often they are online at all.
    w *= 0.5 + Math.min(1.5, p.activity / 4);
    cand.push({ p, w });
  }
  const out = [];
  const take = (p, group, apart = null) => {
    const rating = formRating(p, seed);
    const c = careerAt(p, date);
    out.push({ profile: p, rating, tier: tierOf(rating), badge: { prestige: c.prestige, level: c.level }, party: group, apart });
  };
  const pickFrom = list => {
    let total = 0;
    for (const c of list) total += c.w;
    let x = rng() * total, k = list.length - 1;
    for (let i = 0; i < list.length; i++) if ((x -= list[i].w) < 0) { k = i; break; }
    return k;
  };
  // One party per clan (or duo) in a lobby: a clanmate drawn later joins it while it has room; past the cap they queued
  // on their own (`apart`: the party they are not with, so they are seated against it).
  let groups = 0;
  const partyBy = new Map();       // clan tag or duo key -> { id, size }
  while (out.length < count && cand.length) {
    const { p } = cand.splice(pickFrom(cand), 1)[0];
    // Friends online with them: clanmates (a few, never more than the party cap or the seats left) or the duo partner.
    const friends = party > 1 && !locked ? partyOf(p) : null;
    const key = friends ? CLAN_BY_INDEX.get(p.index)?.tag ?? [p.id, ...friends].sort().join() : null;
    const has = key ? partyBy.get(key) : null;
    if (has && has.size >= party) { take(p, null, has.id); continue; }
    const room = Math.min(party - 1 - (has?.size ?? 0), count - out.length - 1);
    const roll = friends && room > 0 ? rng() : 1;
    let mates = [];
    if (roll < (friends?.length === 1 && !CLAN_BY_INDEX.has(p.index) ? DUO_PULL : CLAN_PULL)) {
      const near = cand.filter(c => friends.includes(c.p.id));
      const want = Math.min(near.length, 1 + Math.floor(rng() * room));
      for (let k = 0; k < want; k++) mates.push(near.splice(pickFrom(near), 1)[0]);
      mates = mates.filter(Boolean);
    }
    let group = has ? has.id : null;
    if (mates.length && group === null) { group = groups++; partyBy.set(key, { id: group, size: 0 }); }
    if (group !== null) partyBy.get(key).size += 1 + mates.length;
    take(p, group);
    for (const m of mates) { cand.splice(cand.indexOf(m), 1); take(m.p, group); }
  }
  if (remember && (recent === null)) {
    RECENT.unshift(out.map(o => o.profile.id));
    RECENT.length = Math.min(RECENT.length, RECENT_KEEP);
  }
  return out;
}

// Forget this phone's recent lobbies (tests).
export function forgetRecentLobbies() { RECENT.length = 0; }
