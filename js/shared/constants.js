// Global tuning constants shared by every module. Units are metres and seconds.
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
export const SPAWN_PROTECT = 1.5;

export const TEAMS = [
  { id: 0, name: 'Vanguard', color: 0x38b6ff, css: '#38b6ff' },
  { id: 1, name: 'Reapers',  color: 0xff4d3d, css: '#ff4d3d' },
];

// Display order everywhere (loadout, gunsmith): grouped by category. Ids are stable, the wire sends list indices.
export const CATEGORIES = ['Assault', 'SMG', 'Shotgun', 'LMG', 'Marksman', 'Sniper', 'Pistol', 'Launcher'];
const GUNS_BY_CATEGORY = {
  Assault:  ['ar', 'burst', 'heavyar'],
  SMG:      ['smg', 'pdw', 'tacsmg'],
  Shotgun:  ['shotgun', 'autoshot', 'coach'],
  LMG:      ['lmg', 'saw', 'rotary'],
  Marksman: ['dmr', 'battle', 'lever'],
  Sniper:   ['sniper', 'antimat', 'semisnipe'],
  Pistol:   ['pistol', 'revolver', 'machpistol', 'deuce'],
  Launcher: ['launcher', 'thumper'],
};
export const WEAPON_CATEGORY = Object.fromEntries(Object.entries(GUNS_BY_CATEGORY).flatMap(([c, ids]) => ids.map(id => [id, c])));
// Every gun id in the given categories. Used for attachment allow-lists.
export const idsIn = (...cats) => cats.flatMap(c => GUNS_BY_CATEGORY[c] || []);

export const PRIMARY_IDS = idsIn('Assault', 'SMG', 'Shotgun', 'LMG', 'Marksman', 'Sniper');
export const SECONDARY_IDS = idsIn('Pistol', 'Launcher');
export const WEAPON_IDS = [...PRIMARY_IDS, ...SECONDARY_IDS];
export const SECONDARY_ID = 'pistol';
export const BOT_SKILLS = ['recruit', 'regular', 'veteran', 'elite'];
