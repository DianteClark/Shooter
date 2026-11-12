// Game modes. Each is a rule set the sim applies on top of ordinary combat.
//   rules     which rule set the sim runs: 'tdm' | 'kc' | 'dom' | 'hard' | 'ffa' | 'gun' | 'snd' | 'ctf'. Ground War modes reuse the 6v6
//             rules on a bigger field, so everything keyed to a rule set (HUD flags, bot plans, scoring) works unchanged.
//   teamSize  players per team in a full match; bots fill up to it.
//   large     needs a Ground War map: small maps never offer it.
//   ffa       every player for themselves (see TEAMS in constants.js). Seats follow the map's size tier: `smallPlayers` on a
//             small map, `players` on a medium one, `largePlayers` on a large or Ground War map. `everyMap` modes are offered on every map, Ground War ones included.
//   rounds    Search and Destroy: scoreLimit is rounds to win, timeLimit the length of one round (see SND below).
import { normalizeLoadout } from './catalog.js';
import { V10_LADDER } from './weapons-v10.js';

// Gun Game: one rung per kill, about one gun per category on the way, sidearms last. The final kill has to be made with
// the Verdict. Order runs from forgiving to demanding, so the climb gets harder as you near the top.
export const GUN_LADDER = [
  'smg', 'ar', 'autoshot', 'saw', 'burst', 'pdw', 'battle', 'coach', 'semisnipe', 'thumper', 'deuce', 'revolver',
];
GUN_LADDER.splice(6, 0, ...V10_LADDER);   // V10 guns join mid-ladder, ahead of the specialists and sidearms.
// Everyone carries the same kit on a rung: the rung's gun and nothing to swap to, a Hatchet (a hit with it, or any
// thrown kill, also knocks the victim back a rung) and a Stim. No scorestreaks.
// The map tiers the new 6v6 modes play on: everything short of Ground War.
const STANDARD_SIZES = ['small', 'medium', 'large'];
const GUN_KIT = { secondary: 'pistol', attachments: {}, perks: ['marathon', 'fasthands', 'deadsilence'], tactical: 'stim', lethal: 'hatchet' };

export const MODES = {
  tdm:   { id: 'tdm',   rules: 'tdm',  teamSize: 6,  name: 'Team Deathmatch', short: 'TDM', scoreLimit: 75,  timeLimit: 600, desc: 'First team to the kill limit.' },
  kc:    { id: 'kc',    rules: 'kc',   teamSize: 6,  name: 'Kill Confirmed',  short: 'KC',  scoreLimit: 65,  timeLimit: 600, desc: 'Collect enemy tags to score. Grab your own to deny.' },
  dom:   { id: 'dom',   rules: 'dom',  teamSize: 6,  name: 'Domination',      short: 'DOM', scoreLimit: 200, timeLimit: 600, desc: 'Hold the three flags. More flags, faster points.' },
  hard:  { id: 'hard',  rules: 'hard', teamSize: 6,  name: 'Hardpoint',       short: 'HP',  scoreLimit: 150, timeLimit: 600, desc: 'One zone at a time. Hold it to score; it moves.' },
  gwtdm: { id: 'gwtdm', rules: 'tdm',  teamSize: 16, large: true, name: 'Ground War TDM', short: 'GW TDM', scoreLimit: 250, timeLimit: 900, desc: '16 v 16 on a big map. First team to the kill limit.' },
  gwdom: { id: 'gwdom', rules: 'dom',  teamSize: 16, large: true, name: 'Ground War Domination', short: 'GW DOM', scoreLimit: 400, timeLimit: 900, desc: '16 v 16, five flags. More flags, faster points.' },
  ffa:   { id: 'ffa',   rules: 'ffa',  teamSize: 1, ffa: true, smallPlayers: 6, players: 8, largePlayers: 12, everyMap: true, name: 'Free-for-All', short: 'FFA', scoreLimit: 30, timeLimit: 600, desc: 'Every player for themselves. Most kills takes it.' },
  snd:   { id: 'snd',   rules: 'snd',  teamSize: 6,  rounds: true, name: 'Search and Destroy', short: 'S&D', scoreLimit: 4, timeLimit: 120, desc: 'One life a round. Plant the bomb or stop it. First to 4 rounds.' },
  ctf:   { id: 'ctf',   rules: 'ctf',  teamSize: 6,  name: 'Capture the Flag', short: 'CTF', scoreLimit: 3, timeLimit: 600, desc: 'Take their flag home to yours. Yours has to be home to score. First to 3.' },
  // Battle royale (docs/BR.md): 32 players on a giant map, the room fills with bots, last squad standing. One rule set,
  // three squad sizes. `squad` is players per squad; `br` marks the family for menus and the HUD. No score or clock
  // limit: the circle ends it (BR.phases below), and timeLimit is only a safety net.
  br:     { id: 'br',     rules: 'br', teamSize: 4, squad: 4, br: true, large: true, players: 32, name: 'Battle Royale', short: 'BR', scoreLimit: 1, timeLimit: 1500, desc: 'Squads of four. Drop in, loot, outlast the circle. Last squad standing.' },
  brduo:  { id: 'brduo',  rules: 'br', teamSize: 2, squad: 2, br: true, large: true, players: 32, name: 'BR Duos', short: 'BR 2', scoreLimit: 1, timeLimit: 1500, desc: 'Battle royale in pairs. Drop, loot, outlast the circle.' },
  brsolo: { id: 'brsolo', rules: 'br', teamSize: 1, squad: 1, br: true, large: true, players: 32, name: 'BR Solos', short: 'BR 1', scoreLimit: 1, timeLimit: 1500, desc: 'Battle royale alone: no downs, no revives. Last one standing.' },
  gun:   { id: 'gun',   rules: 'gun',  teamSize: 1, ffa: true, smallPlayers: 6, players: 8, largePlayers: 12, everyMap: true, name: 'Gun Game', short: 'GUN', scoreLimit: GUN_LADDER.length, timeLimit: 600, desc: `A new gun every kill, ${GUN_LADDER.length} to the Verdict. A Hatchet knocks you back one.` },
  // Modes overhaul (docs/MODES.md). Each runs its own rules module (js/sim/<rules>.js, registered in js/sim/rules.js).
  // `sizes` lists the map tiers a mode is offered on; `needs` the map points it plays on (a list: any one of them will do) (checked by modeFitsMap and
  // dev/map-validate.mjs); `look` the rule set the renderer and HUD draw its zones as.
  hq:    { id: 'hq',    rules: 'hq',   teamSize: 6,  sizes: STANDARD_SIZES, needs: [{ hard: 2 }, { dom: 3 }], look: 'hard', name: 'Headquarters', short: 'HQ', scoreLimit: 200, timeLimit: 600, desc: 'Take the HQ and hold it. While it stands, its team cannot respawn.' },
  ko:    { id: 'ko',    rules: 'ko',   teamSize: 6,  sizes: STANDARD_SIZES, name: 'Kill Order', short: 'KO', scoreLimit: 20, timeLimit: 600, desc: 'Each team has a marked VIP. Only killing theirs scores. Guard yours.' },
  inf:   { id: 'inf',   rules: 'inf',  teamSize: 6,  sizes: STANDARD_SIZES, name: 'Infected', short: 'INF', scoreLimit: 12, timeLimit: 240, desc: 'Killed by the infected, you join them. Survive the clock to win.' },
  oic:   { id: 'oic',   rules: 'oic',  teamSize: 1, ffa: true, smallPlayers: 5, players: 6, largePlayers: 8, sizes: STANDARD_SIZES, name: 'One in the Chamber', short: 'OIC', scoreLimit: 20, timeLimit: 300, desc: 'One bullet, one-shot kills, five lives. A kill gives the bullet back.' },
  ctl:   { id: 'ctl',   rules: 'ctl',  teamSize: 6,  sizes: STANDARD_SIZES, needs: { snd: 2 }, look: 'dom', rounds: true, name: 'Control', short: 'CTL', scoreLimit: 3, timeLimit: 150, desc: 'Attack two zones or defend them, sides swap each round. Each team has limited lives.' },
  grind: { id: 'grind', rules: 'grind', teamSize: 6, sizes: STANDARD_SIZES, needs: { dom: 2 }, look: 'dom', name: 'Grind', short: 'GRD', scoreLimit: 40, timeLimit: 600, desc: 'Grab tags from kills and carry them to a bank. Die and you drop them all.' },
  gwhq:  { id: 'gwhq',  rules: 'hq',   teamSize: 16, large: true, everyHuge: true, needs: [{ hard: 2 }, { dom: 3 }], look: 'hard', name: 'Ground War HQ', short: 'GW HQ', scoreLimit: 300, timeLimit: 900, desc: '16 v 16. Take the HQ and hold it. While it stands, its team cannot respawn.' },
  // Extraction (docs/EXTRACT.md): squads on the giant map against AI patrols and each other; contracts fill a pending
  // pot that only an extraction banks. `ex` marks the family for menus and the HUD; `squad` is players per squad.
  exq:   { id: 'exq',   rules: 'ex', teamSize: 4, squad: 4, ex: true, large: true, players: 16, name: 'Extraction', short: 'EXF', scoreLimit: 1, timeLimit: 900, desc: 'Four squads of four. Take contracts, fight the patrols, and get out on the helicopter to keep what you earned.' },
  exd:   { id: 'exd',   rules: 'ex', teamSize: 2, squad: 2, ex: true, large: true, players: 16, name: 'Extraction Duos', short: 'EXF 2', scoreLimit: 1, timeLimit: 900, desc: 'Eight pairs. Take contracts, fight the patrols, and get out on the helicopter to keep what you earned.' },
  gwko:  { id: 'gwko',  rules: 'ko',   teamSize: 16, large: true, everyHuge: true, name: 'Ground War Kill Order', short: 'GW KO', scoreLimit: 12, timeLimit: 900, desc: '16 v 16. Each team has a marked VIP. Only killing theirs scores.' },
  // Infected on a huge map: 32 players, two start infected (`inf` overrides INF in js/sim/inf.js; tuned in dev/sim-modes-v10.mjs).
  // Graveyard Shift (docs/ZOMBIES.md): co-op wave survival for up to four (bots fill the seats) against a horde on its
  // own side. Played only on the maps js/shared/zombies.js lays out (`maps`); `zm` marks the family for menus and the HUD.
  zm:    { id: 'zm',    rules: 'zm',  teamSize: 4, zm: true, maps: ['neon', 'ruins', 'foundry'], name: 'Graveyard Shift', short: 'GRAVE', scoreLimit: 999, timeLimit: 7200, desc: 'Up to four hold off the undead, round after round. Buy guns off the walls, open the gates, drink the perks. How long can you last?' },
  gwinf: { id: 'gwinf', rules: 'inf',  teamSize: 16, large: true, everyHuge: true, inf: { firsts: 2, holds: 2, spawnNear: 120, respawn: 5 }, name: 'Ground War Infected', short: 'GW INF', scoreLimit: 32, timeLimit: 300, desc: '32 players, two start infected. Killed by them, you join them. Survive the clock.' },
};
export const MODE_IDS = Object.keys(MODES);

// Search and Destroy round rules. Times in seconds, distances in metres. The sim runs them (js/sim/sim.js), the HUD
// and audio read the same numbers for their countdowns.
export const SND = {
  freeze: 6,           // Pre-round hold at the spawns: the moment to change loadout. The first round's covers the intro.
  post: 5,             // After a round is decided, before the next one's freeze.
  halftime: 3,         // Sides swap after this many rounds.
  plant: 4,            // Seconds standing still on a site with the bomb.
  defuse: 6,           // Seconds standing still at the planted bomb. Interrupted means starting again.
  fuse: 40,            // Planted bomb timer.
  blast: 9,            // Detonation kills everyone this close.
  pickup: 1.3,         // An attacker this close to a dropped bomb picks it up.
  defuseReach: 1.7,    // A defender this close to a planted bomb can defuse it.
  still: 0.9,          // Faster than this (m/s) counts as moving, which stops a plant or defuse.
};
// Capture the Flag rules. Times in seconds, distances in metres, score in personal (scorestreak) points. The sim runs
// them (js/sim/ctf.js); the HUD, renderer and audio read the same numbers.
export const CTF = {
  reach: 1.8,          // A player this close to a flag touches it: takes an enemy flag, returns their own dropped one,
                       // and a carrier this close to their own flag at home scores.
  returnTime: 15,      // A dropped flag nobody touches goes home on its own after this long.
  defend: 9,           // A kill this close to your own flag (at home or dropped) is a flag defense.
  score: { take: 150, capture: 300, ret: 100, carrierKill: 150, defend: 50 },
};
export const CTF_STATES = ['home', 'carried', 'dropped'];

// Why a round ended, in the order the snapshot carries them.
export const SND_REASONS = ['elim', 'bomb', 'defuse', 'time'];

// Battle royale numbers, shared by the sim (js/sim/br.js), the HUD and the bots. Times in seconds, distances in metres.
export const BR = {
  warmup: 7,             // On the transport before it moves: the drop map is up.
  planeSpeed: 30,        // Transport speed along the flight line.
  planeOver: 30,         // The flight line starts and ends this far outside the map.
  glide: 7.5,            // Seconds from the jump to the ground. Steerable at glideSpeed.
  glideSpeed: 16,
  forceJump: 0.94,       // Everyone still aboard is thrown out at this share of the line.
  // The circle: phase i waits `wait`, then shrinks over `shrink` to radius `r` (a share of the map's width). Damage per
  // second outside it is `dps` while phase i is the one shrinking or held. Plates do not stop it.
  phases: [
    { wait: 130, shrink: 60, r: 0.4, dps: 1 },
    { wait: 110, shrink: 65, r: 0.28, dps: 4 },
    { wait: 90, shrink: 55, r: 0.18, dps: 8 },
    { wait: 60, shrink: 45, r: 0.11, dps: 12 },
    { wait: 45, shrink: 35, r: 0.06, dps: 16 },
    { wait: 35, shrink: 30, r: 0.03, dps: 20 },
    { wait: 25, shrink: 40, r: 0, dps: 25 },
  ],
  downHp: 100,           // A downed player's bleed bar; lethal damage while downed finishes them.
  bleed: 30,             // Seconds to bleed out untouched.
  crawl: 0.32,           // Stick scale while downed.
  reviveTime: 4,         // Seconds a teammate stands next to a downed player to bring them up.
  reviveReach: 1.9,
  reviveHp: 35,
  selfRevive: 5,         // Seconds a self-revive kit takes.
  plateHp: 50, plateSlots: 3, plateTime: 1.1, plateCarry: 5,
  medTime: 2.6, medCarry: 3, kitCarry: 1,
  pickup: 1.5,           // Auto pickup reach.
  take: 2.4,             // A ground gun this close can be tapped to swap.
  chestReach: 1.7,
  // Match XP on top of the usual lines: placement (scaled from last to first), each revive, each minute alive.
  xp: { place: 1000, revive: 150, minute: 40 },
  rarity: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
  rarityName: ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'],
  rarityCss: ['#c9cbc4', '#59d36b', '#3fa0ff', '#b05cff', '#ffb21a'],
  rarityHex: [0xc9cbc4, 0x59d36b, 0x3fa0ff, 0xb05cff, 0xffb21a],
};
// Extraction numbers, shared by the sim (js/sim/extract.js), bots, HUD, results and awards. Seconds and metres.
export const EX = {
  warmup: 8,             // Squads stand at their insertion points before the match goes live.
  length: 900,           // Match clock: 15 minutes, then whoever is still out there gets nothing from contracts.
  lives: { 4: 10, 2: 5 }, // The squad's shared pool of respawns, by squad size.
  respawn: 12,           // Respawn timer while the pool lasts.
  bleed: 30,             // Downs and revives as in battle royale (BR.reviveTime, reviveReach, reviveHp, crawl).
  // Exfil: windows open set sites at set times; a squad member in an open zone calls the helicopter, which flies in for
  // `inbound` s and waits up to `wait` s. A squad that holds the zone alone (no other squad and no AI inside, nobody
  // of it down) for `hold` s is lifted out. The final exfil opens late, lands at `final.land` and stays to the end,
  // lifting one squad after another.
  windows: [{ open: 210, close: 420, n: 2 }, { open: 450, close: 660, n: 2 }],
  final: { open: 720, land: 780 },
  inbound: 25, wait: 50, hold: 10, cooldown: 30, zoneR: 9,
  // Contracts: rewards by site tier (1 best). XP, weapon XP for the gun in hand when it was paid, and operator mastery
  // seconds. All of it goes into the squad's pending pot; an extraction banks the pot for the whole squad.
  reward: { xp: [0, 1500, 1050, 700], weaponXp: [0, 900, 650, 450], opSecs: [0, 240, 180, 120] },
  extractXp: 1000,       // Banked on top of the pot by an extraction (even with no contracts done).
  stayXp: 300,           // Participation for a squad that never got out.
  intelReach: 1.6, plantTime: 3, fuse: 30, defuseTime: 5, cacheReach: 1.8, hackTime: 55, hackR: 6,
  escortSpeed: 1.4, escortNear: 8, escortBlock: 11, phoneReach: 3,
  ammoReach: 1.5, boxMags: 2, dropMags: 1, boxBack: 60, dropLife: 45,
  aiSlots: 48,           // AI patrol seats in the roster; groups take them as players come near and give them back.
  wake: 80, sleep: 110,  // A patrol group appears when a player is this near its place, and goes when none is near.
};
// The AI faction's side: FFA_TEAM (2) + 8, past the most squads a match has (eight duos).
export const EX_AI_TEAM = 10;
export const CONTRACT_TYPES = ['intel', 'hvt', 'cache', 'hack', 'escort'];
export const CONTRACT_NAMES = { intel: 'Secure Intel', hvt: 'Eliminate HVT', cache: 'Destroy Cache', hack: 'Hack Terminal', escort: 'Escort Asset' };
export const isEx = id => MODES[id]?.rules === 'ex';
export const isZm = id => MODES[id]?.rules === 'zm';
export const isBr = id => MODES[id]?.rules === 'br' || id === 'br';
export const squadSizeFor = id => MODES[id]?.squad ?? 4;

// The rule set behind a mode id; unknown ids (and 'range') pass through.
export const modeRules = id => MODES[id]?.rules ?? id;
// Players per team for a mode, for buildRoster and lobby caps. A free-for-all is a side of one.
export const teamSizeFor = id => MODES[id]?.teamSize ?? MODES.tdm.teamSize;
// Whether a mode (or rule set) is every player for themselves.
export const isFfa = id => !!(MODES[id]?.ffa || id === 'ffa' || id === 'gun');
// Everyone in a full match: both teams, or a free-for-all's field, which is bigger on a Ground War map.
export function playersFor(id, map = null) {
  const m = MODES[id] ?? MODES.tdm;
  if (m.br || m.ex) return m.players;
  if (m.zm) return m.teamSize;            // Graveyard Shift: the players' side only (the horde is not players).
  if (!m.ffa) return m.teamSize * 2;
  // A map without a size tier counts as medium (see SIZES in js/shared/map.js).
  const size = map?.large ? 'huge' : map?.size;
  return size === 'small' ? m.smallPlayers : size === 'large' || size === 'huge' ? m.largePlayers : m.players;
}

// Modes a map can host: its own `modes` list (see js/shared/map.js, which fills it in for every map), plus the modes
// every map hosts.
export function mapModes(map) {
  const own = map?.modes ?? MODE_IDS.filter(id => !MODES[id].large);
  // A battle royale map lists 'br'; it hosts every squad size. Huge maps host the `everyHuge` Ground War modes.
  const extra = MODE_IDS.filter(id => (MODES[id].maps?.includes(map?.id) || (MODES[id].everyMap && map?.size !== 'giant') || (MODES[id].everyHuge && tierOf(map) === 'huge' && !own.includes('br')) || ((MODES[id].br || MODES[id].ex) && own.includes('br'))) && !own.includes(id));
  return extra.length ? [...own, ...extra] : own;
}

// Whether a map hosts a mode: the map lists it, and any points its rules need are defined.
export function modeFitsMap(map, mode) {
  if (!map || !MODES[mode] || !mapModes(map).includes(mode)) return false;
  const rules = MODES[mode].rules;
  const def = MODES[mode];
  if (def.sizes && !def.sizes.includes(tierOf(map))) return false;
  if (def.needs) return [def.needs].flat().some(need => Object.entries(need).every(([kind, n]) => (map.points?.[kind]?.length ?? 0) >= n));
  if (rules === 'dom') return !!map.points?.dom?.length;
  if (rules === 'hard') return !!map.points?.hard?.length;
  if (rules === 'snd') return map.points?.snd?.length === 2;
  if (rules === 'ctf') return map.points?.ctf?.length === 2;
  if (rules === 'br') return !!map.br?.loot?.length;
  if (rules === 'ex') return (map.br?.pois?.length ?? 0) >= 8;
  if (rules === 'zm') return !!def.maps?.includes(map.id);
  return true;
}

// A map's size tier, as js/shared/map.js sizeOf reads it (that module imports this one, so it is repeated here): a
// Ground War map is huge, a map without a tier medium.
const tierOf = map => (map?.size === 'giant' ? 'giant' : map?.large ? 'huge' : ['small', 'medium', 'large', 'huge', 'giant'].includes(map?.size) ? map.size : 'medium');

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
