// Global tuning constants shared by every module. Units are metres and seconds.
import { V10_GUNS } from './weapons-v10.js';
export const SIM_HZ = 30;              // Host simulation rate.
export const SNAPSHOT_EVERY = 2;       // Host sends a snapshot every N sim ticks (15 Hz).
export const STATE_SEND_HZ = 20;       // Guest sends its own player state at this rate.
export const INTERP_DELAY = 0.12;      // Seconds remote players are rendered behind newest snapshot.

export const PLAYER_RADIUS = 0.45;
export const MAX_HP = 100;
export const TEAM_SIZE = 6;
export const SCORE_LIMIT = 75;
export const TIME_LIMIT = 600;
export const RESPAWN_TIME = 2.5;
// Humans respawn when they tap Respawn (any time after RESPAWN_TIME), or on their own this long after dying, so an
// idle phone never leaves its slot dead for good. Bots ignore both and respawn at RESPAWN_TIME as always.
export const SPAWN_PROTECT = 1.5;

// Indices 0 and 1 are the two sides of every team mode. In a free-for-all each player is a side of one (team
// FFA_TEAM + roster index), so every `team !== myTeam` check already reads "hostile" and TEAMS[team] is that player's
// own colour in the world, the feed and the minimap. These avoid the two team colours, so no FFA player reads as a side.
export const TEAMS = [
  { id: 0, name: 'Vanguard', color: 0x38b6ff, css: '#38b6ff' },
  { id: 1, name: 'Reapers',  color: 0xff4d3d, css: '#ff4d3d' },
  ...[
    ['Amber', 0xffc21a], ['Lime', 0x8cf03c], ['Magenta', 0xff3fd2], ['Teal', 0x1fe0c4],
    ['Orange', 0xff8a1f], ['Violet', 0x9d6bff], ['Rose', 0xff8fb4], ['Mint', 0xb4ffd8],
    ['Chalk', 0xf2f0e6], ['Cobalt', 0x4d6dff], ['Olive', 0xc9d24a], ['Copper', 0xd9774a],
  ].map(([name, color], i) => ({ id: i + 2, name, color, css: '#' + color.toString(16).padStart(6, '0') })),
];
export const FFA_TEAM = 2;                         // First free-for-all colour slot in TEAMS.
export const FFA_MAX = TEAMS.length - FFA_TEAM;    // Players a free-for-all can colour apart: 12.

// Display order everywhere (loadout, gunsmith): grouped by category. Ids are stable, the wire sends list indices.
export const CATEGORIES = ['Assault', 'SMG', 'Shotgun', 'LMG', 'Marksman', 'Sniper', 'Pistol', 'Launcher', 'Melee'];
const GUNS_BY_CATEGORY = {
  Assault:  ['ar', 'burst', 'heavyar'],
  SMG:      ['smg', 'pdw', 'tacsmg'],
  Shotgun:  ['shotgun', 'autoshot', 'coach'],
  LMG:      ['lmg', 'saw', 'rotary'],
  Marksman: ['dmr', 'battle', 'lever'],
  Sniper:   ['sniper', 'antimat', 'semisnipe'],
  Pistol:   ['pistol', 'revolver', 'machpistol', 'deuce'],
  Launcher: ['launcher', 'thumper'],
  Melee:    [],
};
// V8 guns. Listed with their category above for display, attachments and bots, but appended to the id lists below
// after GOLDEN_ID, so every older id keeps its wire index.
const V8_GUNS = { Assault: ['carbine'], SMG: ['heavysmg'], Shotgun: ['slug'], LMG: ['lightlmg'], Marksman: ['crossbow'], Pistol: ['scatter'] };
const V8_IDS = cats => cats.flatMap(c => V8_GUNS[c] || []);
for (const c in V8_GUNS) GUNS_BY_CATEGORY[c].push(...V8_GUNS[c]);
// V10 guns (js/shared/weapons-v10.js), the same way: after the V8 ones in every list, so no older id moves.
const V10_IDS = cats => cats.flatMap(c => V10_GUNS[c] || []);
for (const c in V10_GUNS) GUNS_BY_CATEGORY[c].push(...V10_GUNS[c]);
const NEW_IDS = cats => [...V8_IDS(cats), ...V10_IDS(cats)];
// The Golden Gun: a pistol-category secondary kept out of GUNS_BY_CATEGORY on purpose, so no attachment allow-list,
// bot list or category default ever picks it up. It is the last pre-V8 weapon id, so every older id keeps its wire index.
export const GOLDEN_ID = 'golden';
export const WEAPON_CATEGORY = {
  ...Object.fromEntries(Object.entries(GUNS_BY_CATEGORY).flatMap(([c, ids]) => ids.map(id => [id, c]))),
  [GOLDEN_ID]: 'Pistol',
};
// Every gun id in the given categories. Used for attachment allow-lists.
export const idsIn = (...cats) => cats.flatMap(c => GUNS_BY_CATEGORY[c] || []);

const PRIMARY_CATS = ['Assault', 'SMG', 'Shotgun', 'LMG', 'Marksman', 'Sniper'], SECONDARY_CATS = ['Pistol', 'Launcher', 'Melee'];
const OLD_PRIMARY = idsIn(...PRIMARY_CATS).filter(id => !NEW_IDS(PRIMARY_CATS).includes(id));
const OLD_SECONDARY = idsIn(...SECONDARY_CATS).filter(id => !NEW_IDS(SECONDARY_CATS).includes(id));
export const PRIMARY_IDS = [...OLD_PRIMARY, ...NEW_IDS(PRIMARY_CATS)];
export const SECONDARY_IDS = [...OLD_SECONDARY, GOLDEN_ID, ...NEW_IDS(SECONDARY_CATS)];
// Wire order: the pre-V8 list unchanged (golden last of it), then the V8 guns, then the V10 guns.
export const WEAPON_IDS = [...OLD_PRIMARY, ...OLD_SECONDARY, GOLDEN_ID, ...V8_IDS(PRIMARY_CATS), ...V8_IDS(SECONDARY_CATS),
  ...V10_IDS(PRIMARY_CATS), ...V10_IDS(SECONDARY_CATS)];
export const SECONDARY_ID = 'pistol';
export const BOT_SKILLS = ['recruit', 'regular', 'veteran', 'elite'];
