// Host-authoritative match simulation: HP, kills, score, respawns, streaks, bots, match phase.
// Humans own their own movement and shots (see docs/ARCHITECTURE.md), and report them here.

import { LETHALS, normalizeLoadout, PERK_IDS, PERKS, SCORE, STREAK_DENY_REASONS, STREAK_IDS, STREAKS, TACTICALS } from '../shared/catalog.js';
import { FFA_MAX, FFA_TEAM, GOLDEN_ID, MAX_HP, PLAYER_RADIUS, RESPAWN_TIME, SECONDARY_IDS, SIM_HZ, SNAPSHOT_EVERY, SPAWN_PROTECT, TEAM_SIZE, WEAPON_IDS } from '../shared/constants.js';
import { hasLineOfSight, raycastMap, rayCircle, wallsInBox, wallScratch } from '../shared/geometry.js';
import { MAPS, DEFAULT_MAP } from '../shared/map.js';
import { GUN_LADDER, gunLoadout, MODES, playersFor, teamSizeFor } from '../shared/modes.js';
import { attachmentsFor, NO_ATTACHMENTS, packKit, unpackKit } from '../shared/attachments.js';
import { rayDamage, WEAPONS } from '../shared/weapons.js';
import { V10_BOT_PRIMARIES } from '../shared/weapons-v10.js';
import { botAttachments, BotBrain, botSecondary, planObjectives } from './bots.js';
import { blastDamage, EQUIPMENT, EquipmentSystem, flakMult, maxThrowRange, COLD_MARK, syncCover } from './equipment.js';
import { NavGrid } from './nav.js';
import { angleDiff, applyDaze, armPlayer, armSecondary, createPlayerState, hasPro, RESPAWN_IDLE, respawnPlayer, takeEquipment, shotPassage, traceShot, weaponDef } from './player.js';
import { RANGE_MODE, RangeDirector, rangeDummies } from './range.js';
import { addScore, createStreakState, setStreakKinds, spendStreak } from './streaks.js';
import * as V9 from './streaks-v9.js';   // Scorestreaks overhaul (2026-11): new streaks, shoot-downs, EMP rework.
import { decodeSnd, restoreSnd, SndRules } from './snd.js';
import { CtfRules, decodeCtf, restoreCtf } from './ctf.js';
import { MODE_RULES } from './rules.js';     // Modes overhaul: one rules module per mode (js/sim/rules.js).
import { cleanMods, dealLoadout, HARDCORE_DAMAGE } from '../shared/playlist.js';

const STEP = 1 / SIM_HZ;
const MAX_CATCHUP_STEPS = 6;     // After a stall, drop time rather than spiral.
const WARMUP = 3;
const HISTORY = 12;              // Ring of past positions: ~400 ms at 30 Hz.
const MAX_REWIND = 0.3;

const REGEN_DELAY = 3.8;
const REGEN_RATE = 34;
const MEND_DELAY = 2.1, MEND_RATE = 55;     // Quick Mend.
const ADRENALINE_HEAL = 40;
const MARK_TIME = 4;                        // Seconds a Tracker hit keeps someone on the enemy team's minimap.
const COLD_REACH = 6;                       // Cold Blooded: automated streaks notice you only this close to the machine.
const ENGINEER_TURRET = 1.5, ENGINEER_AIR = 1.25;   // Life (and turret health) multipliers.
const ASSIST_WINDOW = 8;
const ASSIST_MIN_DAMAGE = 25;
const CHAIN_WINDOW = 3.5;        // Seconds between kills for double/triple/fury.
const LONGSHOT = 26;

const UAV_TIME = 20, JAM_TIME = 15, OVERWATCH_TIME = 30, EMP_JAM_TIME = 8;
const AIR_TEAM_MAX = 3, AIR_TOTAL_MAX = 5;   // Airspace: at most this many air streaks up per team, and on the map in total.
const SUPPLY_RADIUS = 14, SUPPLY_MAGS = 3;
const MORTAR_SHELLS = 5, MORTAR_GAP = 0.7, MORTAR_FLIGHT = 1.4, MORTAR_RADIUS = 4.2, MORTAR_DAMAGE = 125, MORTAR_SCATTER = 1.7;
const VIS_EVERY = 8;                         // Ticks a team's list of visible enemies is reused for.
const STRIKE_DELAY = 1.3, STRIKE_STEP = 0.2, STRIKE_COUNT = 5, STRIKE_SPACING = 4.6;
const STRIKE_RADIUS = 5.2, STRIKE_DAMAGE = 135;

// Low and on target: it closes on someone the team can see, but buildings between it and them stop its rounds.
const CHOPPER_LIFE = 24, CHOPPER_SPEED = 8, CHOPPER_HOVER = 11, CHOPPER_RANGE = 23, CHOPPER_RETARGET = 0.5;
const CHOPPER_BURST = 6, CHOPPER_GAP = 0.18, CHOPPER_PAUSE = 1, CHOPPER_DAMAGE = 19, CHOPPER_SPREAD = 0.05, CHOPPER_LAG = 0.3;

// A zone denial tool: it wins a corner against someone who ignores it, and loses to anyone who shoots back.
const SHOCK_TURRET = 45;        // Damage each Shock arc does to an enemy Sentry in reach: three arcs nearly kill one.
const TURRET_LIFE = 30, TURRET_HP = 180, TURRET_RADIUS = 0.75, TURRET_RANGE = 20;
// What a sentry round does against cover, in shotPassage terms: a rifle-class round.
const TURRET_GUN = { range: TURRET_RANGE + 4, penetrate: 0.7 };
const TURRET_TURN = 2.8, TURRET_THINK = 0.2, TURRET_INTERVAL = 0.26, TURRET_TOL = 0.14;
const TURRET_DAMAGE = 12, TURRET_SPREAD = 0.05;
const TURRET_HIT_RADIUS = PLAYER_RADIUS + 0.1, TURRET_SLIDE_RADIUS = TURRET_HIT_RADIUS * 0.72;

// Rounds are aimed at where the target was a moment ago, so anyone moving is hard to hit.
const GUNSHIP_LIFE = 22, GUNSHIP_ORBIT = 13, GUNSHIP_BURST = 4, GUNSHIP_GAP = 0.16, GUNSHIP_PAUSE = 2;
const GUNSHIP_DAMAGE = 30, GUNSHIP_SCATTER = 1.2, GUNSHIP_BLAST = 1.1, GUNSHIP_LAG = 0.3, GUNSHIP_EYES = 32;

// Cruise Missile (V8): flies low and fast where its owner points the aim stick; buildings stop it, low cover does not.
// A human steers with their own aim, which the host already has; a bot steers at what its team can see.
const MISSILE_LIFE = 4.5, MISSILE_SPEED = 17, MISSILE_TURN = 2.6, MISSILE_ARM = 0.3;
const MISSILE_FUSE = 2.2, MISSILE_COLD_FUSE = 0.9;   // Proximity fuse; Cold Blooded has to be flown right into.
const MISSILE_RADIUS = 5, MISSILE_DAMAGE = 150;
// Drone Swarm (V8): three small drones that hunt what the team can see and dive on it. Slower than a slide, so breaking
// sight and moving still saves you; each one is a single small blast.
const SWARM_COUNT = 3, SWARM_LIFE = 18, SWARM_SPEED = 7.6, SWARM_RETARGET = 0.4, SWARM_LOITER = 4.5;
const SWARM_DIVE = 1.2, SWARM_RADIUS = 3.2, SWARM_DAMAGE = 115;
// Juggernaut (V8): armour that soaks damage before health. Blasts chew through it faster than bullets.
const JUGG_ARMOR = STREAKS.juggernaut.armor, JUGG_BLAST = 1.5;

// A human who drops mid-match keeps their slot, off the field, for this long; then anyone may take it (see humanLeft).
export const HOLD_OPEN_SECONDS = 180;
const THROW_ORIGIN_SLACK = 4;    // How far a reported throw may start from where the host has that player.
const SCAVENGE_MAGS = 1;         // Magazines of reserve per kill with Scavenger.

// Pro abilities (js/shared/catalog.js PRO). A `{t:'pro', id, perk}` event goes out to humans when one visibly fires.
const MEDIC_REACH = 7;           // Field Medic: teammates this close regenerate at the Quick Mend rate.
const WIND_TIME = 2.5, WIND_TAKEN = 0.75;    // Second Wind: seconds, and the share of damage still taken.
const RESTOCK_TIME = 30;         // Quartermaster: seconds per piece of equipment coming back.
const HIJACK_REACH = 1.8, HIJACK_TIME = 1.5; // Hijacker: metres from an enemy Sentry, seconds held there.
const BLAST_STREAKS = new Set(['strike', 'mortar', 'gunship', 'missile', 'swarm', 'bombrun']);
// Bots at these tiers carry Pro on every perk they hold, and a calling card: veterans are meant to look it.
const PRO_SKILLS = new Set(['veteran', 'elite']);

// Modes. capture on a point runs -1 (team 0) to +1 (team 1); a flag changes hands at the extreme and goes
// neutral when the bar crosses zero, so taking an enemy flag costs twice what taking a neutral one does.
const TAG_RADIUS = 1.35, TAG_LIFE = 25, TAG_MAX = 16;
const DOM_CAPTURE = 4.5;         // Seconds for one player to take a neutral flag.
const DOM_TICK = 3;              // One point per held flag, every this many seconds.
const DOM_DECAY = 0.12;          // Bar per second a flag recovers when nobody is on it.
const CROWD_MAX = 3;             // Standing on a flag stops helping past this many players.
const HARD_ROTATE = 40, HARD_TICK = 1;
const HOLD_TICK = 3;             // Seconds between personal SCORE.holdTick payouts for standing on a held point.
const DEFEND_REACH = 3;          // Metres past a point's edge that a kill still counts as defending it.
const PLAN_EVERY = 15;           // Ticks between bot objective plans.
const OBJECTIVE_RULES = new Set(['kc', 'dom', 'hard', 'snd', 'ctf']);

// Free-for-all spawning: anywhere open on the map, as far from everyone as it can get.
const FFA_GRID = 5;              // Metres between candidate spawn points sampled over open ground.
const FFA_FAR = 40;              // Past this, more distance from the nearest player is worth nothing more.
const FFA_SEEN = 28;             // Penalty for a point any living player can see from within FFA_SIGHT.
const FFA_SIGHT = 34;

const PHASES = ['warmup', 'live', 'ended'];
const PROJECTILE_KINDS = ['frag', 'sticky', 'smoke', 'flash', 'molotov', 'fire', 'mine', 'cluster', 'bomblet', 'hatchet', 'decoy', 'sensor', 'trophy',
  'stun', 'gas', 'gascloud', 'shock', 'impact', 'claymore', 'drill',   // V8 equipment: appended, old indices keep their numbers.
  'snapshot', 'blackout', 'bulwark', 'tagger', 'medpack', 'charge', 'thermite', 'tripwire', 'crawler', 'shiv'];   // Gear wave.
const TACTICAL_IDS = Object.keys(TACTICALS);
const LETHAL_IDS = Object.keys(LETHALS);
const PERKS_BY_TIER = [0, 1, 2].map(t => PERK_IDS.filter(id => PERKS[id].tier === t));
// Kinds on the wire's aircraft list. 'juggernaut' rows are not aircraft: they carry a wearer's armour (see _encodeEntities).
const GUNSHIP_KINDS = ['gunship', 'chopper', 'missile', 'swarm', 'juggernaut', 'recon', 'hound', 'reticle', 'plates'];   // V9 appended.
const AIR_KINDS = STREAK_IDS.filter(id => STREAKS[id].air);
const POS = { x: 0, z: 0, sliding: false };
const TURRET_RAY = { head: false, pen: 1 };   // Scratch ray for rayDamage on a turret hit.
const PLAYER_STRIDE = 24;
// Snapshot interest (see _packPlayers). Fields of a player record that change rarely: reserve, reloadDur, kills, deaths,
// assists, streak, score, streak/equipment bits, headshots. They go out when they change and in a slow rotation.
const SNAP_HEAD = 16;
const SLOW_FIELDS = [10, 12, 15, 16, 17, 18, 19, 20, 23];
const IS_SLOW = Array.from({ length: PLAYER_STRIDE }, (_, k) => SLOW_FIELDS.includes(k));
const SLOW_REPEAT = 6;           // Ticks a changed slow block keeps going out, so one dropped snapshot cannot lose it.
const SLOW_ROTATE = 15;          // Every player's slow block is refreshed once per this many snapshots anyway.
const FAR_SEND = 40;             // Metres from every human past which a quiet player goes out at half rate.
// Per-guest interest (encodeSnapshotFor): a player more than INTEREST_FAR metres from the guest (on either axis) gets
// a position-only record every INTEREST_EVERY-th snapshot only (5 Hz); far shot events (eventsFor) are not sent. Maps
// up to INTEREST_AREA square metres (every map in the rotation) leave it off: a guest there can see most of the map.
const INTEREST_AREA = 40000;
const POS_FIELDS = [0, 1, 2, 5, 6];      // A far player's keyframe (code 2): position, aim, hp, flags.
const INTEREST_FAR = 60;
const INTEREST_EVERY = 3;
const EVENT_FAR = 150;
const BOT_NAMES = ['Ridge', 'Talon', 'Gully', 'Dagger', 'Quill', 'Kestle', 'Ember', 'Tarn', 'Pike', 'Onyx', 'Fable', 'Rivet', 'Brine', 'Cinder', 'Wick', 'Hex',
  'Sorrel', 'Moth', 'Raze', 'Cobalt', 'Grit', 'Lark', 'Husk', 'Vane', 'Cobb', 'Basalt', 'Briar', 'Slate', 'Knell', 'Jinx', 'Thatch', 'Thane'];   // 32: a full Ground War match never repeats one.
// Every primary exactly once. A match fields twelve consecutive entries (team 1 starts six in) from an offset picked
// by seed, or by map and mode, so over a session every gun is carried by bots equally often: the per-gun stats
// (js/game/telemetry.js) compare guns by kills per carrier-minute, and a gun listed twice would just look strong.
// The first twelve are the offset-0 set (tests and callers that pass no map): the everyday guns.
const BOT_PRIMARIES = [
  'ar', 'burst', 'smg', 'heavyar', 'pdw', 'lmg', 'dmr', 'tacsmg', 'sniper', 'shotgun', 'battle', 'autoshot',
  // V8 guns dealt between the specialists, so no one match draws all of them at once.
  'saw', 'carbine', 'coach', 'heavysmg', 'lever', 'slug', 'semisnipe', 'lightlmg', 'rotary', 'crossbow', 'antimat',
];
BOT_PRIMARIES.push(...V10_BOT_PRIMARIES);   // V10 guns join the rotation after the older ones.
const MIXED_SKILLS = ['regular', 'veteran', 'veteran', 'regular', 'elite', 'recruit'];
// Every tactical and lethal. A match deals them from an offset (see botLoadout), so over a session each is carried.
const BOT_TACTICALS = Object.keys(TACTICALS);
const BOT_LETHALS = Object.keys(LETHALS);
const BOT_PERKS = [
  ['marathon', 'scavenger', 'tracker'], ['flak', 'fasthands', 'ghost'], ['tacmask', 'strongarm', 'coldblood'],
  ['quickmend', 'hardline', 'deadsilence'], ['adrenaline', 'bandolier', 'engineer'], ['marathon', 'hardline', 'ghost'],
];
const BOT_STREAKS = [
  ['uav', 'turret', 'strike'], ['missile', 'mortar', 'chopper'], ['uav', 'overwatch', 'gunship'],
  ['resupply', 'swarm', 'emp'], ['jammer', 'turret', 'juggernaut'], ['missile', 'swarm', 'gunship'],
  // V9 streaks, appended so the six above deal as before.
  ['sweep', 'hound', 'bombrun'], ['recon', 'plates', 'rover'], ['airdrop', 'dome', 'chopper'], ['sweep', 'hound', 'gunship'],
];
// Recruits hold the cheap end of the list and never field anything that fights for them.
const RECRUIT_STREAKS = ['uav', 'jammer', 'resupply'];

function round2(v) { return Math.round(v * 100) / 100; }

function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

// Roughly bell-shaped in -1..1.
function bell(rng) { return (rng() + rng() + rng()) / 1.5 - 1; }

// Scavenger's reward, applied to whichever copy of the player owns its ammo. Exported so the phone that
// owns a human's ammo can apply the same rule when it receives the `scavenge` event.
export function scavengeRefill(ps) {
  for (let i = 0; i < 2; i++) {
    const w = weaponDef(ps, i === 0 ? ps.primary : ps.secondary);
    if (w && !w.unlimitedReserve) ps.reserve[i] = Math.min(w.reserve, ps.reserve[i] + w.magazine * SCAVENGE_MAGS);
  }
}

// One int per point: contested bit, owner + 1 in two bits, capture in hundredths offset to be positive.
function packZone(z) {
  return (Math.round(z.cap * 100) + 100) << 3 | (z.owner + 1) << 1 | (z.contested ? 1 : 0);
}

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A small stable hash, so the same map and mode (or the same seed) always deal the same guns. With a seed the deal
// rotates match to match even on one map; without one it is fixed per map and mode.
function gunOffset(mapId, mode, seed) {
  if (!mapId && seed == null) return 0;
  let h = 7;
  for (const c of `${mapId || ''}:${mode || ''}:${seed ?? ''}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// Fills both teams up to teamSize with named bots of varied loadouts. Each team's bots take consecutive primaries and
// one of each sidearm in turn, so a full team of six carries every secondary once. teamSize defaults to the mode's own
// (16 for Ground War, see shared/modes.js), or TEAM_SIZE when no mode is given.
export function buildRoster(humans, { botSkill = 'mixed', teamSize = null, mapId = null, mode = null, seed = null } = {}) {
  if (MODES[mode]?.ffa) return buildFfaRoster(humans, { botSkill, mapId, mode, seed, players: teamSize });
  teamSize ??= mode ? teamSizeFor(mode) : TEAM_SIZE;
  const roster = humans.map(h => {
    const loadout = normalizeLoadout({ ...h.loadout, primary: h.loadout?.primary || h.primary, camo: h.loadout?.camo || h.camo });
    return { id: h.id, name: h.name, team: h.team, isBot: false, skill: null, primary: loadout.primary, camo: loadout.camo, loadout };
  });
  let nameI = 0, weaponI = 0, n = 0;
  const offset = gunOffset(mapId, mode, seed);
  for (let team = 0; team < 2; team++) {
    let count = roster.filter(r => r.team === team).length;
    // Offset the loadout cycle per team so the two sides are not mirror images.
    weaponI = offset % BOT_PRIMARIES.length + team * 6;
    let sideI = (offset >>> 5) + team * 3;
    for (; count < teamSize; count++, n++) {
      const i = n + team;
      const skill = botSkill === 'mixed' ? MIXED_SKILLS[n % MIXED_SKILLS.length] : botSkill;
      const loadout = botLoadout(BOT_PRIMARIES[weaponI++ % BOT_PRIMARIES.length], sideI++, skill, i, offset >>> 9);
      roster.push({
        id: `bot${n}`, name: BOT_NAMES[nameI++ % BOT_NAMES.length], team, isBot: true,
        skill,
        primary: loadout.primary, camo: loadout.camo, loadout,
      });
    }
  }
  return roster;
}

// One bot loadout, dealt the same way for teams and free-for-all. `i` staggers equipment, perks and streaks.
function botLoadout(primary, side, skill, i, deal = 0) {
  const loadout = normalizeLoadout({
    primary, secondary: botSecondary(side), camo: 'none', attachments: { [primary]: botAttachments(primary, skill, i) },
    tactical: BOT_TACTICALS[(i + deal) % BOT_TACTICALS.length], lethal: BOT_LETHALS[(i + deal * 3) % BOT_LETHALS.length],
    perks: BOT_PERKS[i % BOT_PERKS.length],
    streaks: skill === 'recruit' ? RECRUIT_STREAKS : BOT_STREAKS[i % BOT_STREAKS.length],
  });
  if (PRO_SKILLS.has(skill)) {
    loadout.pro = loadout.perks.slice();
    loadout.card = `pro-${loadout.perks[skill === 'elite' ? 2 : i % 3]}`;
  }
  return loadout;
}

// Free-for-all: every player is a side of one, team FFA_TEAM + roster index (see TEAMS in constants.js), and bots fill
// up to the mode's field for the map (more on a Ground War map). In Gun Game everyone starts on the ladder's first rung.
function buildFfaRoster(humans, { botSkill, mapId, mode, seed, players }) {
  const total = Math.min(FFA_MAX, Math.max(humans.length, players || playersFor(mode, MAPS[mapId])));
  const gun = MODES[mode].rules === 'gun';
  const roster = humans.slice(0, FFA_MAX).map(h => {
    let loadout = normalizeLoadout({ ...h.loadout, primary: h.loadout?.primary || h.primary, camo: h.loadout?.camo || h.camo });
    if (gun) loadout = gunLoadout(0, loadout);
    return { id: h.id, name: h.name, team: 0, isBot: false, skill: null, primary: loadout.primary, camo: loadout.camo, loadout };
  });
  const offset = gunOffset(mapId, mode, seed);
  let weaponI = offset % BOT_PRIMARIES.length, sideI = offset >>> 5;
  for (let n = 0; roster.length < total; n++) {
    const skill = botSkill === 'mixed' ? MIXED_SKILLS[n % MIXED_SKILLS.length] : botSkill;
    let loadout = botLoadout(BOT_PRIMARIES[weaponI++ % BOT_PRIMARIES.length], sideI++, skill, n, offset >>> 9);
    if (gun) loadout = gunLoadout(0, loadout);
    roster.push({ id: `bot${n}`, name: BOT_NAMES[n % BOT_NAMES.length], team: 0, isBot: true, skill, primary: loadout.primary, camo: loadout.camo, loadout });
  }
  roster.forEach((r, i) => { r.team = FFA_TEAM + i; });
  return roster;
}

export class Sim {
  // scoreLimit and timeLimit default to the mode's own, from shared/modes.js.
  constructor({ roster, map, seed = 1, scoreLimit, timeLimit, mode = 'tdm', mods = [] }) {
    this.map = typeof map === 'string' ? MAPS[map] : (map || MAPS[DEFAULT_MAP]);
    this.rng = mulberry32(seed >>> 0);
    const def = mode === 'range' ? RANGE_MODE : (MODES[mode] || MODES.tdm);
    // `mode` is the rule set everything keys on ('dom' for Ground War Domination too); modeId is the mode as picked.
    this.mode = def.rules ?? def.id;
    this.modeId = def.id;
    // Modifiers (js/shared/playlist.js): the ones this mode can take, in a fixed order.
    this.mods = cleanMods(mods, def.id);
    this.hardcore = this.mods.includes('hardcore');
    this.ffa = !!def.ffa;
    this.ladder = this.mode === 'gun';      // Gun Game: scores are rungs climbed, and the rung is the loadout.
    this.objective = OBJECTIVE_RULES.has(this.mode) || !!MODE_RULES[this.mode];
    if (this.mode === 'range') roster = [...roster, ...rangeDummies(this.map)];
    // Each free-for-all player is a side of one. buildRoster already deals these; a roster from elsewhere gets them here.
    if (this.ffa) roster = roster.slice(0, FFA_MAX).map((r, i) => (r.team === FFA_TEAM + i ? r : { ...r, team: FFA_TEAM + i }));
    // Everything kept per team (scores, radar, jamming, sight lists) is sized for every side there is.
    const T = this.teamCount = this.ffa ? FFA_TEAM + roster.length : 2;
    this.scoreLimit = scoreLimit ?? def.scoreLimit;
    if (this.ladder) this.scoreLimit = Math.min(this.scoreLimit, GUN_LADDER.length);
    this.timeLimit = timeLimit ?? def.timeLimit;
    this.dt = STEP;
    this.time = 0;
    this.tick = 0;
    this.accum = 0;
    this.phase = this.mode === 'range' ? 'live' : 'warmup';     // The range opens the moment you walk in.
    this.phaseT = WARMUP;
    this.timeLeft = this.timeLimit;
    this.scores = new Array(T).fill(0);
    this.winner = null;
    this.uav = new Array(T).fill(0);
    this.jam = new Array(T).fill(0);        // Seconds that team's radar is jammed.
    this.jamBy = new Array(T).fill(0);      // Seconds left on a Jammer this team called (free-for-all airspace counts it).
    this.overwatch = new Array(T).fill(0);  // Seconds of advanced UAV for that team (uav is held up alongside it).
    this.lastKill = null;
    this.firstBlood = false;
    this.events = [];
    this.strikes = [];
    this.mortars = [];
    this.turrets = [];
    this.gunships = [];
    this.nextTurretId = 1;
    this.v9 = V9.createV9State();    // Sonar sweeps, falling Airdrops, the EMP lock (js/sim/streaks-v9.js).
    this.callouts = [];       // Sightings on their way to teammates, oldest first. See BotBrain._callOut.
    this.calloutSeq = 0;
    this.calledAt = null;     // Per team, per enemy index: when that enemy was last called out.
    this.eq = new EquipmentSystem(this.map);
    this.eqPlayers = [];
    this._initMode(seed);
    this._onEqEvent = this._onEqEvent.bind(this);
    this._onEqDamage = this._onEqDamage.bind(this);
    this.pathBudget = 0;
    this.nav = null;     // Built on first step; guests only decode snapshots and never need it.
    // Per-guest snapshots (encodeSnapshotFor, eventsFor): on for maps past INTEREST_AREA only; see setInterest.
    this.interest = this.map.width * this.map.height > INTEREST_AREA;
    this._encodes = 0;
    this._metaUntil = 2;      // Tick up to which every snapshot carries the camo and loadout block.
    this._scratch = [];
    this._airCount = new Array(T).fill(0);  // Air streaks up per team, recounted when a tick asks.
    this._striking = new Array(T).fill(false);
    this._airTick = -1;
    this._visible = Array.from({ length: T }, () => []); // Enemies each team can currently see or has on radar.
    this._visibleTick = new Array(T).fill(-99);
    this._ffaPts = null;      // Free-for-all spawn candidates, see _ffaPoints.
    this.hot = null;          // The last kill's place and time.

    const n = roster.length;
    this.players = roster.map((r, index) => {
      let loadout = this._cleanLoadout({ ...r.loadout, primary: r.loadout?.primary || r.primary, camo: r.loadout?.camo || r.camo });
      if (this.ladder) loadout = gunLoadout(0, loadout);
      loadout = this._deal(r.team, loadout);
      return {
        id: r.id, name: r.name, team: r.team, isBot: !!r.isBot, skill: r.skill ?? null,
        dummy: !!r.dummy, home: r.home ?? null, humanId: null,
        // Held slot: the human dropped. Off the field, stats kept; `open` once nobody came back in HOLD_OPEN_SECONDS.
        away: false, awayT: 0, open: false,
        primary: loadout.primary, camo: loadout.camo, loadout, pendingLoadout: null, index, card: loadout.card,
        windT: 0, restockT: 0, armor: 0,
        ps: createPlayerState({ id: r.id, primary: loadout.primary, camo: loadout.camo, loadout }),
        hp: MAX_HP, alive: true, respawnT: 0, spawnProtect: 0,
        // Tap to respawn (humans only): seconds dead, and whether a respawn request is waiting.
        deadT: 0, wantRespawn: false,
        kills: 0, deaths: 0, assists: 0, head: 0, streak: 0, chain: 0, lastKillT: -99,
        lastKilledBy: null, score: createStreakState(loadout.streaks, STREAKS, loadout.perks), markT: 0, jamT: 0,
        regenT: 0, dmgBy: new Float32Array(n), dmgT: new Float32Array(n).fill(-99),
        kits: [attachmentsFor(loadout, loadout.primary), attachmentsFor(loadout, loadout.secondary)],
        kitBits: -1, kitWeapon: null,
        hx: new Float32Array(HISTORY), hz: new Float32Array(HISTORY), hs: new Uint8Array(HISTORY),
        prevReload: false, prevWeapon: loadout.primary, prevSliding: false, prevOverheated: false,
        ackX: 0, ackZ: 0, ackT: 0,
        bot: null,
      };
    });
    this.byId = new Map(this.players.map(p => [p.id, p]));
    for (const p of this.players) if (p.isBot) this._noGoldForBots(p);
    this.calledAt = Array.from({ length: T }, () => new Float32Array(n).fill(-99));
    this.spawnUsedAt = new Map();
    this.range = this.mode === 'range' ? new RangeDirector(this) : null;
    this._emit({ t: 'phase', phase: this.phase });
    this._spawnAll();
  }

  _emit(e) { this.events.push(e); }

  // Points are the map's, with match state added. `points` is what the view shows: every flag in Domination,
  // only the live zone in Hardpoint.
  _initMode(seed) {
    this.tags = [];
    this.nextTagId = 1;
    const defs = (this.mode === 'dom' || this.mode === 'hard' || this.mode === 'snd') ? this.map.points?.[this.mode] ?? [] : [];
    this.zones = defs.map(d => ({ id: d.id, x: d.x, z: d.z, r: d.r, owner: -1, cap: 0, contested: false, taken: [false, false] }));
    // The rotation order is the seed's: the map's list has zones on each team's side, and whichever comes first
    // hands that team a lead the other never gets back. hardIdx is a position in this order.
    this.hardOrder = this.zones.map((_, i) => i);
    const shuffle = mulberry32((seed ^ 0x51ed270b) >>> 0);
    for (let i = this.hardOrder.length - 1; i > 0; i--) {
      const k = Math.floor(shuffle() * (i + 1)), q = this.hardOrder[i];
      this.hardOrder[i] = this.hardOrder[k]; this.hardOrder[k] = q;
    }
    // Search and Destroy shows its two bomb sites as points; nobody ever owns one.
    this.points = this.mode === 'hard' && this.zones.length ? [this.zones[this.hardOrder[0]]] : this.mode === 'dom' || this.mode === 'snd' ? this.zones : [];
    this.snd = this.mode === 'snd' ? new SndRules(this) : null;
    // Capture the Flag keeps its two flags to itself (js/sim/ctf.js); the view shows them as view.ctf, not as points.
    this.ctf = this.mode === 'ctf' ? new CtfRules(this) : null;
    // The modes overhaul's rule sets: each its own module, hooked in through `this.rules` (see js/sim/rules.js).
    const Rules = MODE_RULES[this.mode];
    this.rules = Rules ? new Rules(this, seed) : null;
    this.hardIdx = 0;
    this.hardT = HARD_ROTATE;
    this.tickT = this.mode === 'hard' ? HARD_TICK : DOM_TICK;
    this.holdT = HOLD_TICK;
    this._present = [0, 0];
  }

  // The zone that goes live after the current one; bots that think ahead start walking early.
  get nextZone() { return this.zones[this.hardOrder[(this.hardIdx + 1) % this.zones.length]]; }

  // Line-of-sight blockers right now, for bots and streak targeting.
  get smokes() { return this.eq.smokes; }

  // Normalizes a loadout and makes sure its guns exist, which the catalog alone cannot check.
  _cleanLoadout(raw, fallback = null) {
    const l = normalizeLoadout(raw);
    if (!WEAPONS[l.primary]) l.primary = fallback ? fallback.primary : 'ar';
    if (!SECONDARY_IDS.includes(l.secondary)) l.secondary = fallback ? fallback.secondary : 'pistol';
    // Search and Destroy has no scorestreaks: one life a round leaves no room to earn them fairly.
    if (this.mode === 'snd') l.streaks = [];
    return l;
  }

  // A loadout as this match deals it to a side: the mode's own kit (One in the Chamber, Infected), then the modifiers.
  _deal(team, l) {
    if (this.rules?.kit) l = this.rules.kit(team, l);
    return dealLoadout(l, this.mods);
  }

  // The same for a phone's own player, which owns its gun and so deals its own loadout at each spawn (js/game/match.js).
  // On a guest this sim is the snapshot codec, and the side is the one the newest snapshot gave.
  dealFor(id, base) {
    const p = this.byId.get(id);
    if (!p || !base || this.ladder) return base;
    if (!this.rules?.kit && !this.mods.length) return base;
    return this._deal(p.team, normalizeLoadout(base));
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---- Spawning ----

  _spawnAll() {
    if (this.ffa) { this._ffaSpawnAll(); return; }
    if (this.snd) { this.snd.startRound(); return; }
    if (this.rules?.spawnAll?.()) return;
    const used = new Set();
    for (const p of this.players) {
      if (p.dummy) { this._placeAt(p, p.home, p.home.aim); continue; }
      const list = this.map.spawns[p.team];
      let s;
      for (let tries = 0; tries < 24; tries++) {
        s = list[Math.floor(this.rng() * list.length)];
        if (!used.has(s)) break;
      }
      used.add(s);
      this._placeAt(p, s, s.aim);
    }
  }

  _placeAt(p, s, aim) {
    if (p.away) return;              // A held slot stays off the field until its human (or a newcomer) takes it.
    if (p.pendingLoadout) {
      p.loadout = p.pendingLoadout; p.pendingLoadout = null;
      p.primary = p.loadout.primary; p.camo = p.loadout.camo; p.card = p.loadout.card;
      p.kits[0] = attachmentsFor(p.loadout, p.loadout.primary);
      p.kits[1] = attachmentsFor(p.loadout, p.loadout.secondary);
      setStreakKinds(p.score, p.loadout.streaks, STREAKS, p.loadout.perks);
      this._metaUntil = this.tick + 2;
    }
    respawnPlayer(p.ps, s.x, s.z, aim, p.loadout);
    if (p.ps.perks.includes('bandolier')) { p.ps.tacticalLeft++; p.ps.lethalLeft++; }
    p.markT = 0; p.jamT = 0;
    p.hp = MAX_HP; p.alive = true; p.respawnT = 0; p.spawnProtect = p.dummy ? 0 : SPAWN_PROTECT;
    p.regenT = 0; p.dmgBy.fill(0);
    p.prevReload = false; p.prevWeapon = p.ps.weapon; p.prevSliding = false; p.prevOverheated = false;
    for (let i = 0; i < HISTORY; i++) { p.hx[i] = s.x; p.hz[i] = s.z; p.hs[i] = 0; }
    // Ignore a human's stale in-flight states until their phone has processed this spawn.
    if (!p.isBot) { p.ackX = s.x; p.ackZ = s.z; p.ackT = 1.5; }
    if (p.bot) p.bot.reset();
    this.rules?.onSpawn?.(p);
    this._emit({ t: 'spawn', id: p.id, x: s.x, z: s.z, aim: round2(aim) });
  }

  // Free-for-all opening: everyone on a different team spawn point, spread over both ends, as far apart as they go.
  _ffaSpawnAll() {
    const pool = this.map.spawns.flat(), taken = [];
    const order = this.players.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const k = Math.floor(this.rng() * (i + 1)), q = order[i]; order[i] = order[k]; order[k] = q; }
    for (const i of order) {
      let best = pool[0], bestD = -1;
      for (const s of pool) {
        let d = Infinity;
        for (const t of taken) d = Math.min(d, Math.hypot(t.x - s.x, t.z - s.z));
        d += this.rng() * 2;
        if (d > bestD) { bestD = d; best = s; }
      }
      taken.push(best);
      this._placeAt(this.players[i], best, this._faceMiddle(best));
    }
  }

  // Where a free-for-all player may spawn: every team spawn point, plus open ground sampled across the whole map once the
  // nav grid exists (host only), kept to cells a player can walk to from the spawns and clear of walls by a cell.
  _ffaPoints() {
    if (this._ffaPts && (this._ffaPts.full || !this.nav)) return this._ffaPts;
    const pts = this.map.spawns.flat().map(s => ({ x: s.x, z: s.z }));
    pts.full = false;
    const nav = this.nav;
    if (nav) {
      const { w, h, blocked } = nav, reach = new Uint8Array(w * h);
      const stack = [nav.nearestFree(pts[0].x, pts[0].z)];
      reach[stack[0]] = 1;
      while (stack.length) {
        const k = stack.pop(), i = k % w, j = (k - i) / w;
        if (i > 0 && !blocked[k - 1] && !reach[k - 1]) { reach[k - 1] = 1; stack.push(k - 1); }
        if (i < w - 1 && !blocked[k + 1] && !reach[k + 1]) { reach[k + 1] = 1; stack.push(k + 1); }
        if (j > 0 && !blocked[k - w] && !reach[k - w]) { reach[k - w] = 1; stack.push(k - w); }
        if (j < h - 1 && !blocked[k + w] && !reach[k + w]) { reach[k + w] = 1; stack.push(k + w); }
      }
      const open = (i, j) => i > 0 && j > 0 && i < w - 1 && j < h - 1 && reach[j * w + i] && reach[j * w + i - 1] && reach[j * w + i + 1] && reach[(j - 1) * w + i] && reach[(j + 1) * w + i];
      for (let z = FFA_GRID / 2; z < this.map.height; z += FFA_GRID) {
        for (let x = FFA_GRID / 2; x < this.map.width; x += FFA_GRID) {
          const i = Math.floor(x), j = Math.floor(z);
          if (!open(i, j)) continue;
          const px = i + 0.5, pz = j + 0.5;
          if (pts.some(q => Math.abs(q.x - px) < 3 && Math.abs(q.z - pz) < 3)) continue;
          pts.push({ x: px, z: pz });
        }
      }
      pts.full = true;
    }
    return (this._ffaPts = pts);
  }

  // Facing the middle of the map from wherever this is.
  _faceMiddle(s) { return Math.atan2(this.map.height / 2 - s.z, this.map.width / 2 - s.x); }

  // Free-for-all respawn: the open point farthest from every living player, avoiding any one of them can see and any
  // used a moment ago. Distance stops counting past FFA_FAR, so it is not always the same far corner.
  _ffaRespawn(p) {
    let best = null, bestScore = -Infinity;
    for (const s of this._ffaPoints()) {
      let nearest = FFA_FAR, seen = false;
      for (const q of this.players) {
        if (q === p || !q.alive) continue;
        const d = Math.hypot(q.ps.x - s.x, q.ps.z - s.z);
        if (d < nearest) nearest = d;
        if (!seen && d < FFA_SIGHT && hasLineOfSight(this.map, s.x, s.z, q.ps.x, q.ps.z)) seen = true;
      }
      const usedAgo = this.time - (this.spawnUsedAt.get(s) ?? -99);
      const score = nearest - (seen ? FFA_SEEN : 0) - (usedAgo < 3 ? 12 : 0) + this.rng() * 4;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    this.spawnUsedAt.set(best, this.time);
    this._placeAt(p, best, this._faceMiddle(best));
  }

  // Own side preferred; any point an enemy can see, or that was just used, is heavily penalised.
  _respawn(p) {
    if (p.dummy) { this._placeAt(p, p.home, p.home.aim); return; }
    if (this.ffa) { this._ffaRespawn(p); return; }
    let best = null, bestScore = -Infinity;
    const enemyTeam = 1 - p.team;
    for (let t = 0; t < 2; t++) {
      for (const s of this.map.spawns[t]) {
        let nearest = 200, seen = false;
        for (const q of this.players) {
          if (q.team !== enemyTeam || !q.alive) continue;
          const d = Math.hypot(q.ps.x - s.x, q.ps.z - s.z);
          if (d < nearest) nearest = d;
          if (!seen && d < 36 && hasLineOfSight(this.map, s.x, s.z, q.ps.x, q.ps.z)) seen = true;
        }
        const usedAgo = this.time - (this.spawnUsedAt.get(s) ?? -99);
        const score = nearest + (t === p.team ? 14 : 0) - (seen ? 22 : 0) - (usedAgo < 2.5 ? 12 : 0) + this.rng() * 3
          + this._spawnFlow(p, s);
        if (score > bestScore) { bestScore = score; best = s; }
      }
    }
    this.spawnUsedAt.set(best, this.time);
    // Face the middle of the map, whichever side this spawn is on.
    const aim = Math.atan2(this.map.height / 2 - best.z, this.map.width / 2 - best.x);
    const facing = Math.abs(Math.cos(aim)) > 0.5 ? (best.x < this.map.width / 2 ? 0 : Math.PI) : aim;
    this._placeAt(p, best, facing);
  }

  // Objective pull on a spawn point: near what your team holds, away from what it does not, and never on top of
  // the live hardpoint, so nobody spawns straight into a capture.
  _spawnFlow(p, s) {
    if (this.ctf) return this.ctf.spawnFlow(p, s);
    if (this.rules?.spawnFlow) return this.rules.spawnFlow(p, s);
    if (this.mode === 'dom') {
      let score = 0;
      for (let i = 0; i < this.zones.length; i++) {
        const z = this.zones[i], d = Math.hypot(z.x - s.x, z.z - s.z);
        if (z.owner === p.team && d < 26) score += (26 - d) * 0.5;
        else if (z.owner === 1 - p.team && d < 20) score -= (20 - d) * 1.2;
      }
      return score;
    }
    if (this.mode === 'hard' && this.points.length) {
      const z = this.points[0], d = Math.hypot(z.x - s.x, z.z - s.z);
      return d < 15 ? -(15 - d) * 2 : d < 38 ? (38 - d) * 0.18 : 0;
    }
    return 0;
  }

  // ---- Stepping ----

  // Accumulates dt into fixed SIM_HZ ticks. Passing exactly 1/SIM_HZ runs exactly one tick.
  step(dt) {
    if (!this.nav) this._initBots();
    this.accum += dt;
    let steps = 0;
    while (this.accum >= STEP - 1e-9) {
      this.accum -= STEP;
      if (steps++ >= MAX_CATCHUP_STEPS) { this.accum = 0; break; }
      this._tick();
    }
  }

  _initBots() {
    this.nav = new NavGrid(this.map);
    let stagger = 0;
    for (const p of this.players) if (p.isBot && !p.dummy) p.bot = new BotBrain(this, p, stagger++);
  }

  _tick() {
    this.tick++;
    this.time += STEP;
    this.pathBudget = 2;

    if (this.phase === 'warmup') {
      this.phaseT -= STEP;
      if (this.phaseT <= 0) this._setPhase('live');
    } else if (this.phase === 'live' && !this.range && !this.snd && !this.rules?.ownClock) {
      this.timeLeft -= STEP;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this._end(this.rules?.timeUp ? this.rules.timeUp() : this.ffa ? this._ffaLeader(true) : this.scores[0] === this.scores[1] ? null : (this.scores[0] > this.scores[1] ? 0 : 1));
      }
    }

    if (this.phase === 'live') {
      for (let t = 0; t < this.teamCount; t++) {
        if (this.uav[t] > 0) this.uav[t] = Math.max(0, this.uav[t] - STEP);
        if (this.jam[t] > 0) this.jam[t] = Math.max(0, this.jam[t] - STEP);
        if (this.jamBy[t] > 0) this.jamBy[t] = Math.max(0, this.jamBy[t] - STEP);
        if (this.overwatch[t] > 0) this.overwatch[t] = Math.max(0, this.overwatch[t] - STEP);
      }
      this._stepMortars();
      V9.stepV9(this);
      this._stepStrikes();
      this._stepEquipment();
      this._stepTurrets();
      this._stepGunships();
      if (this.range) this.range.step();
      else if (this.objective) this._stepObjectives();
      const players = this.players;
      for (let i = 0; i < players.length; i++) this._stepTimers(players[i]);
      if (!this.range && this.objective && this.tick % PLAN_EVERY === 0) planObjectives(this);
      this._expireCallouts();
      // Alternate who acts first: a bot's shot lands immediately, so a fixed order hands one team every tied duel.
      const flip = this.tick & 1, last = players.length - 1;
      for (let i = 0; i <= last; i++) {
        const p = players[flip ? last - i : i];
        if (!p.bot || !p.alive) continue;
        const shots = p.bot.update(STEP);
        for (let s = 0; s < shots.length; s++) this.applyShot(p.id, shots[s], 0);
        this._diffFx(p);
      }
    }

    const h = this.tick % HISTORY;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      p.hx[h] = p.ps.x; p.hz[h] = p.ps.z; p.hs[h] = p.ps.sliding ? 1 : 0;
    }
  }

  _stepTimers(p) {
    if (p.away) {
      p.awayT += STEP;
      if (!p.open && p.awayT >= HOLD_OPEN_SECONDS) {
        p.open = true;
        this._emit({ t: 'slotOpen', id: p.id });
      }
      return;
    }
    if (p.ackT > 0) p.ackT -= STEP;
    if (!p.alive) {
      if (this.snd) return;          // One life a round: the next round brings everyone back.
      if (this.rules?.holdDead?.(p)) return;     // Out of lives, or a Headquarters standing for their team.
      p.respawnT -= STEP;
      p.deadT += STEP;
      if (p.respawnT <= 0 && this._readyToRespawn(p)) this._respawn(p);
      return;
    }
    if (p.spawnProtect > 0) p.spawnProtect = Math.max(0, p.spawnProtect - STEP);
    if (p.markT > 0) p.markT -= STEP;
    if (p.jamT > 0) p.jamT -= STEP;        // Blackout.
    if (p.regenT > 0) p.regenT -= STEP;
    else if (p.hp < MAX_HP) p.hp = Math.min(MAX_HP, p.hp + (p.ps.perks.includes('quickmend') || this._nearMedic(p) ? MEND_RATE : REGEN_RATE) * STEP);
    if (hasPro(p.ps, 'bandolier')) this._restock(p);
  }

  // Bots and range targets come back the moment RESPAWN_TIME is up. A human comes back once they have asked (a
  // Respawn tap, or the request their phone sends at the moment of death when auto-respawn is on) and RESPAWN_TIME is
  // up, or on their own RESPAWN_IDLE seconds after dying, so an idle phone never keeps its slot dead.
  _readyToRespawn(p) {
    if (p.isBot || p.dummy) return true;
    return p.wantRespawn || p.deadT >= RESPAWN_IDLE;
  }

  // The 'respawn' command: the request counts as soon as RESPAWN_TIME is up (one sent earlier waits for it). Safe to
  // repeat: phones resend it. An older phone's {hold:true} is accepted and changes nothing: holding is the default now.
  requestRespawn(id, { hold = false } = {}) {
    const p = this.byId.get(id);
    if (!p || p.isBot || p.dummy || p.alive || this.snd) return false;
    if (!hold) p.wantRespawn = true;
    return true;
  }

  // Field Medic (Quick Mend Pro): a living teammate with it within MEDIC_REACH.
  _nearMedic(p) {
    for (let i = 0; i < this.players.length; i++) {
      const q = this.players[i];
      if (q === p || q.team !== p.team || !q.alive || !hasPro(q.ps, 'quickmend')) continue;
      if (Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z) <= MEDIC_REACH) return true;
    }
    return false;
  }

  // Quartermaster (Bandolier Pro): while anything is spent, one piece comes back every RESTOCK_TIME, lethal first.
  _restock(p) {
    const ps = p.ps, maxT = TACTICALS[ps.tactical].count + 1, maxL = LETHALS[ps.lethal].count + 1;
    if (ps.tacticalLeft >= maxT && ps.lethalLeft >= maxL) { p.restockT = 0; return; }
    p.restockT += STEP;
    if (p.restockT < RESTOCK_TIME) return;
    p.restockT = 0;
    if (ps.lethalLeft < maxL) ps.lethalLeft++; else ps.tacticalLeft++;
    this._proEvent(p, 'bandolier');
  }

  _proEvent(p, perk) { if (!p.isBot) this._emit({ t: 'pro', id: p.id, perk }); }

  // Blank Slate (Cold Blooded Pro) cannot be marked by anything: Sensors, Tracker hits or a Spotter's flash.
  _markable(q) { return !hasPro(q.ps, 'coldblood'); }

  _setPhase(phase) {
    this.phase = phase;
    this._emit({ t: 'phase', phase });
    if (phase === 'live' && this.snd) this.snd.onLive();
    if (phase === 'live') this.rules?.onLive?.();
    if (phase === 'live' && this.mode === 'hard' && this.points.length) this._emit({ t: 'hard_move', id: this.points[0].id });
  }

  // ---- Objectives ----

  _stepObjectives() {
    if (this.rules) { this.rules.step(STEP); return; }     // Each ends the match itself.
    if (this.snd) { this.snd.step(STEP); return; }
    if (this.ctf) { this.ctf.step(STEP); return; }      // Captures end the match themselves.
    if (this.mode === 'kc') this._stepTags();
    else if (this.mode === 'dom') this._stepDomination();
    else if (this.mode === 'hard') this._stepHardpoint();
    // Domination ticks both teams at once, so a tie at the limit plays on until someone is ahead.
    if (this.phase === 'live' && Math.max(this.scores[0], this.scores[1]) >= this.scoreLimit && this.scores[0] !== this.scores[1]) {
      this._end(this.scores[0] > this.scores[1] ? 0 : 1);
    }
  }

  _dropTag(victim) {
    if (this.mode !== 'kc') return;
    if (this.tags.length >= TAG_MAX) this.tags.shift();    // Oldest first: the snapshot stays bounded.
    this.tags.push({ id: this.nextTagId++, x: victim.ps.x, z: victim.ps.z, team: victim.team, life: TAG_LIFE });
  }

  _stepTags() {
    const tags = this.tags;
    for (let i = tags.length - 1; i >= 0; i--) {
      const tag = tags[i];
      tag.life -= STEP;
      if (tag.life <= 0) { tags.splice(i, 1); continue; }
      for (let k = 0; k < this.players.length; k++) {
        const p = this.players[k];
        if (!p.alive) continue;
        const dx = p.ps.x - tag.x, dz = p.ps.z - tag.z;
        if (dx * dx + dz * dz > TAG_RADIUS * TAG_RADIUS) continue;
        this._collectTag(tag, p);
        tags.splice(i, 1);
        break;
      }
    }
  }

  _collectTag(tag, p) {
    const confirm = p.team !== tag.team;
    if (confirm) this.scores[p.team]++;
    addScore(p.score, confirm ? SCORE.confirm : SCORE.deny);
    this._medal(p, confirm ? 'confirm' : 'deny');
    // id is the tag, by the player who took it, matching the ids in view.tags.
    this._emit({ t: 'tag', kind: confirm ? 'confirm' : 'deny', id: tag.id, x: round2(tag.x), z: round2(tag.z), by: p.id, team: p.team });
  }

  // Alive players of each team inside a zone, written into this._present.
  _countIn(z) {
    const n = this._present;
    n[0] = 0; n[1] = 0;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive) continue;
      const dx = p.ps.x - z.x, dz = p.ps.z - z.z;
      if (dx * dx + dz * dz <= z.r * z.r) n[p.team]++;
    }
    return n;
  }

  _onZone(p, z) {
    const dx = p.ps.x - z.x, dz = p.ps.z - z.z;
    return p.alive && dx * dx + dz * dz <= z.r * z.r;
  }

  // Everyone standing in the zone for this team gets the capture. Hardpoint pays each team once per zone.
  _capture(z, team) {
    z.owner = team;
    // Hardpoint flips hands all the time; only a team's first time on this zone is an event.
    if (this.mode === 'hard') {
      if (z.taken[team]) return;
      z.taken[team] = true;
    }
    this._emit({ t: 'capture', point: z.id, team });
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.team !== team || !this._onZone(p, z)) continue;
      addScore(p.score, SCORE.capture);
      this._medal(p, 'capture');
    }
  }

  _stepDomination() {
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i], n = this._countIn(z);
      z.contested = n[0] > 0 && n[1] > 0;
      if (z.contested) continue;
      if (n[0] > 0 || n[1] > 0) {
        const team = n[0] > 0 ? 0 : 1, sign = team === 0 ? -1 : 1;
        const crowd = Math.min(CROWD_MAX, n[team]);
        z.cap += sign * STEP * (1 + 0.5 * (crowd - 1)) / DOM_CAPTURE;
        // Crossing zero takes the flag away from whoever had it, before anyone has it again.
        if (z.owner === 1 - team && Math.sign(z.cap) === sign) z.owner = -1;
        if (Math.abs(z.cap) >= 1) {
          z.cap = sign;
          if (z.owner !== team) this._capture(z, team);
        }
      } else if (z.owner !== -1 || z.cap !== 0) {
        // Nobody here: a half-taken bar drifts back to its owner, or to neutral.
        const rest = z.owner === -1 ? 0 : (z.owner === 0 ? -1 : 1);
        const step = DOM_DECAY * STEP;
        z.cap = z.cap < rest ? Math.min(rest, z.cap + step) : Math.max(rest, z.cap - step);
      }
    }
    this.tickT -= STEP;
    const paying = this.tickT <= 0;
    if (paying) {
      this.tickT += DOM_TICK;
      for (let i = 0; i < this.zones.length; i++) if (this.zones[i].owner !== -1) this.scores[this.zones[i].owner]++;
      this._payHolders(this.zones);
    }
  }

  // Personal score for standing on a point your team holds.
  _payHolders(zones) {
    for (let k = 0; k < zones.length; k++) {
      const z = zones[k];
      if (z.owner === -1 || z.contested) continue;
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (p.team === z.owner && this._onZone(p, z)) addScore(p.score, SCORE.holdTick);
      }
    }
  }

  _stepHardpoint() {
    if (!this.points.length) return;
    this.hardT -= STEP;
    if (this.hardT <= 0) {
      this.hardT += HARD_ROTATE;
      this.hardIdx = (this.hardIdx + 1) % this.zones.length;
      const next = this.zones[this.hardOrder[this.hardIdx]];
      next.owner = -1; next.cap = 0; next.contested = false; next.taken[0] = false; next.taken[1] = false;
      this.points[0] = next;
      this._emit({ t: 'hard_move', id: next.id });
    }
    const z = this.points[0], n = this._countIn(z);
    z.contested = n[0] > 0 && n[1] > 0;
    if (!z.contested) {
      if (n[0] > 0 || n[1] > 0) {
        const team = n[0] > 0 ? 0 : 1;
        if (z.owner !== team) this._capture(z, team);
      } else {
        z.owner = -1;
      }
    }
    z.cap = z.owner === -1 ? 0 : (z.owner === 0 ? -1 : 1);
    this.tickT -= STEP;
    if (this.tickT <= 0) {
      this.tickT += HARD_TICK;
      if (z.owner !== -1 && !z.contested) this.scores[z.owner]++;
    }
    this.holdT -= STEP;
    if (this.holdT <= 0) { this.holdT += HOLD_TICK; this._payHolders(this.points); }
  }

  // Killing someone on or next to a point your team holds, or from on top of it, is the defend medal.
  _checkDefend(killer, victim) {
    for (let i = 0; i < this.points.length; i++) {
      const z = this.points[i];
      if (z.owner !== killer.team) continue;
      const reach = z.r + DEFEND_REACH;
      const near = Math.hypot(victim.ps.x - z.x, victim.ps.z - z.z) <= reach
        || Math.hypot(killer.ps.x - z.x, killer.ps.z - z.z) <= z.r;
      if (!near) continue;
      addScore(killer.score, SCORE.defend);
      this._medal(killer, 'defend');
      return;
    }
  }

  _end(winner) {
    this.winner = winner;
    this._setPhase('ended');
  }

  // Free-for-all standings: score, then fewer deaths, then more kills. Returns the leader's team; with `strict`, null
  // when the top two cannot be told apart (the time ran out on a dead heat).
  _ffaLeader(strict = false) {
    const ranked = this.players.filter(p => !p.dummy).sort((a, b) => this._ffaOrder(a, b));
    if (!ranked.length) return null;
    if (strict && ranked.length > 1 && this._ffaOrder(ranked[0], ranked[1]) === 0) return null;
    return ranked[0].team;
  }

  _ffaOrder(a, b) {
    return (this.scores[b.team] - this.scores[a.team]) || (a.deaths - b.deaths) || (b.kills - a.kills);
  }

  // ---- Gun Game ----

  // Puts a player's loadout on a rung. The gun in hand changes too (see armPlayer); `announce` tells everyone, and the
  // player's own phone, which owns a human's gun, arms itself from that event.
  _setRung(p, level, announce = true, by = null) {
    const gun = GUN_LADDER[Math.max(0, Math.min(GUN_LADDER.length - 1, level))];
    p.loadout = gunLoadout(level, p.loadout);
    p.pendingLoadout = null;
    p.primary = gun;
    p.kits[0] = attachmentsFor(p.loadout, gun);
    armPlayer(p.ps, gun);
    p.camo = p.ps.camo = p.loadout.camo;      // The rung's own camo (see gunLoadout).
    this._metaUntil = this.tick + 2;
    p.prevWeapon = gun;
    if (p.bot) p.bot.onArmed();
    if (announce) {
      const e = { t: 'arm', id: p.id, weapon: gun, level };
      if (by) e.by = by;          // Set back by this player's thrown kill.
      this._emit(e);
    }
  }

  // One rung up for every kill; the kill made on the last rung wins (see the limit check in _kill). Killed by anything
  // thrown, the victim drops a rung.
  _climb(killer, victim, equip) {
    const up = this.scores[killer.team] + 1;
    this.scores[killer.team] = up;
    if (up < this.scoreLimit) this._setRung(killer, up);
    if (equip && victim !== killer && this.scores[victim.team] > 0) {
      const down = --this.scores[victim.team];
      this._setRung(victim, down, true, killer.id);
    }
  }

  // Past position of a player. Writes into out and returns it, to avoid garbage.
  posAt(p, age, out) {
    const back = Math.min(age, MAX_REWIND) * SIM_HZ;
    const k = Math.floor(back), f = back - k;
    const i0 = (((this.tick - k) % HISTORY) + HISTORY) % HISTORY;
    const i1 = (i0 + HISTORY - 1) % HISTORY;
    out.x = p.hx[i0] + (p.hx[i1] - p.hx[i0]) * f;
    out.z = p.hz[i0] + (p.hz[i1] - p.hz[i0]) * f;
    out.sliding = p.hs[f < 0.5 ? i0 : i1] === 1;
    return out;
  }

  // ---- Human input from the network ----

  applyHumanState(id, d) {
    const p = this.byId.get(id);
    if (!p || p.isBot || !p.alive) return;
    if (p.ackT > 0) {
      if (Math.hypot(d.x - p.ackX, d.z - p.ackZ) > 5) return;
      p.ackT = 0;
    }
    const ps = p.ps;
    ps.x = d.x; ps.z = d.z; ps.aim = d.aim; ps.vx = d.vx; ps.vz = d.vz;
    ps.slot = d.slot; ps.primary = d.primary; ps.weapon = d.weapon;
    if (d.secondary && SECONDARY_IDS.includes(d.secondary)) ps.secondary = d.secondary;
    ps.sprinting = d.sprinting; ps.sliding = d.sliding;
    ps.ammo[0] = d.ammo[0]; ps.ammo[1] = d.ammo[1];
    ps.reserve[0] = d.reserve[0]; ps.reserve[1] = d.reserve[1];
    ps.reloadT = d.reloadT; ps.reloadDur = d.reloadDur;
    ps.adsT = d.adsT; ps.bloom = d.bloom;
    ps.heat = d.heat ?? 0; ps.overheated = !!d.overheated; ps.firingT = d.firingT ?? 0;
    p.primary = d.primary;
    // Gun Game: the host hands out the gun. A phone a moment behind a promotion must not hand the old one back.
    if (this.ladder) { ps.primary = p.loadout.primary; ps.slot = 0; ps.weapon = ps.primary; p.primary = ps.primary; }
    if (d.camo && d.camo !== p.camo) { p.camo = d.camo; ps.camo = d.camo; this._metaUntil = this.tick + 2; }
    this._diffFx(p);
  }

  // Takes effect at the next spawn. Score and held streaks carry over; see setStreakKinds.
  setLoadout(id, loadout) {
    const p = this.byId.get(id);
    if (!p || !loadout || typeof loadout !== 'object' || this.ladder) return false;     // Gun Game deals the loadouts.
    p.pendingLoadout = this._deal(p.team, this._cleanLoadout(loadout, p.loadout));
    this.snd?.onLoadout(p);
    return true;
  }

  // Everything a player's phone asks the host to do, apart from moving and shooting.
  // Returns whether the command was accepted.
  applyCommand(id, msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (this.byId.get(id)?.away) return false;   // In flight from a phone that has since dropped.
    if (msg.cmd === 'streak') return this.useStreak(id, msg.slot) !== null;
    if (msg.cmd === 'aimdone') return V9.releaseAim(this, id);     // Carpet Line: the aim stick was let go.
    if (msg.cmd === 'throw') return this._throw(id, msg);
    if (msg.cmd === 'loadout') return this.setLoadout(id, msg.loadout);
    if (msg.cmd === 'respawn') return this.requestRespawn(id, msg);
    if (msg.cmd === 'rangeReset') { this.range?.resetStats(); return !!this.range; }
    return false;
  }

  // `dist` (optional) is where the thrower wants it to end up; the host holds it to what their arm can reach.
  _throw(id, { slot, ox, oz, aim, dist }) {
    const p = this.byId.get(id);
    if (!p || !p.alive || this.phase !== 'live' || !Number.isFinite(aim)) return false;
    if (slot !== 'tactical' && slot !== 'lethal') return false;
    if (p.jamT > 0) return false;                 // Blackout: no equipment until it wears off.
    // Satchel: with one armed on the map, the Lethal tap is the detonator, not another throw.
    if (slot === 'lethal' && p.ps.lethal === 'charge' && this.eq.detonate(id) > 0) { p.spawnProtect = 0; return true; }
    const ps = p.ps, heal = slot === 'tactical' && ps.tactical === 'stim';
    if (heal && p.hp >= MAX_HP) return false;   // A stim at full health is only a misclick: keep it.
    const kind = takeEquipment(ps, slot);
    if (!kind) return false;
    if (this.range) { ps.tacticalLeft = TACTICALS[ps.tactical].count; ps.lethalLeft = LETHALS[ps.lethal].count; }
    if (!heal) p.spawnProtect = 0;
    // Trust the phone's own hand position, unless it is implausibly far from what the host knows.
    const near = Number.isFinite(ox) && Number.isFinite(oz) && Math.hypot(ox - ps.x, oz - ps.z) <= THROW_ORIGIN_SLACK;
    const reach = maxThrowRange(ps.perks);
    const want = Number.isFinite(dist) ? Math.min(dist, reach) : undefined;
    this.eq.throw(p, kind, near ? ox : ps.x, near ? oz : ps.z, aim, want);
    return true;
  }

  // Turns state changes into the reload/swap/slide events, the same way for bots and humans.
  _diffFx(p) {
    const ps = p.ps;
    const reloading = ps.reloadT > 0;
    if (reloading !== p.prevReload) {
      this._emit({ t: 'reload', id: p.id, stage: reloading ? 'start' : 'end' });
      p.prevReload = reloading;
    }
    if (ps.weapon !== p.prevWeapon) {
      this._emit({ t: 'swap', id: p.id });
      p.prevWeapon = ps.weapon;
    }
    if (ps.sliding !== p.prevSliding) {
      if (ps.sliding) this._emit({ t: 'slide', id: p.id });
      p.prevSliding = ps.sliding;
    }
    if (ps.overheated !== p.prevOverheated) {
      if (ps.overheated) this._emit({ t: 'overheat', id: p.id });
      p.prevOverheated = ps.overheated;
    }
  }

  // Applies a shot fired `ageSeconds` ago. Pass ping/2 plus the shooter's interpolation delay, so
  // targets are rewound to where the shooter actually saw them.
  applyShot(id, shot, ageSeconds = 0) {
    const shooter = this.byId.get(id);
    if (!shooter || !shooter.alive || this.phase === 'ended') return;
    // Every gun stat below comes from the shooter's loadout as the host knows it, never from the shot itself.
    const w = weaponDef(shooter.ps, shot.weapon);
    if (!w) return;

    const age = Math.min(Math.max(0, ageSeconds), MAX_REWIND);
    const scratch = this._scratch;
    scratch.length = this.players.length;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const e = scratch[i] || (scratch[i] = { id: null, team: 0, alive: false, x: 0, z: 0, sliding: false });
      e.id = p.id; e.team = p.team; e.alive = p.alive;
      if (age > 0) this.posAt(p, age, e);
      else { e.x = p.ps.x; e.z = p.ps.z; e.sliding = p.ps.sliding; }
    }
    const rays = traceShot(shot, this.map, scratch, id, w);
    const turretHits = this.turrets.length > 0 ? this._raysVsTurrets(shot, rays, shooter) : null;

    const lean = new Array(rays.length);
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i];
      // To everyone drawing it, a bullet stopped by a turret is a bullet that hit something hard.
      lean[i] = { x: round2(r.x), z: round2(r.z), hit: r.hit === 'turret' ? 'wall' : r.hit, nx: round2(r.nx), nz: round2(r.nz) };
    }
    const fired = { t: 'shot', by: id, weapon: shot.weapon, camo: shooter.camo,
      ox: round2(shot.ox), oz: round2(shot.oz), aim: round2(shot.aim), rays: lean };
    if (w.suppressed) fired.sup = 1;
    this._emit(fired);
    this._alertBots(shooter, !!w.suppressed);
    if (this.range) this.range.onShot(shooter, shot, rays);

    if (this.phase !== 'live') return;
    shooter.spawnProtect = 0;      // Shooting gives up your protection.

    const ads = shot.ads ?? (shooter.ps.adsT >= 0.85);
    if (this.gunships.length) V9.shootAir(this, shooter, shot, rays, w);   // Aircraft can be shot down.
    if (w.explosive) { this._detonate(shooter, shot, rays[0], w, scratch); return; }
    if (turretHits) this._damageTurretsFromShot(turretHits, rays, shot, w, ads, shooter);
    if (this.eq.projectiles.length) this._shootGear(shooter, shot, rays, w);
    for (let i = 0; i < rays.length; i++) {
      if (rays[i].hit !== 'player') continue;
      // Sum all pellets on one target into a single hit.
      const targetId = rays[i].id;
      let dmg = 0, dist = 0, head = false;
      for (let j = i; j < rays.length; j++) {
        if (rays[j].hit !== 'player' || rays[j].id !== targetId) continue;
        dist = Math.hypot(rays[j].x - shot.ox, rays[j].z - shot.oz);
        // Falloff, the lethal head multiplier and what cover took off the round: see the ray contract in player.js.
        dmg += rayDamage(w, rays[j], dist, ads);
        if (rays[j].head) head = true;
        if (j !== i) rays[j].hit = 'counted';
      }
      this._damage(this.byId.get(targetId), shooter, dmg, shot.weapon, dist, null, head);
    }
  }

  // A rocket bursts where its ray ended, a hand's width short of whatever it hit so walls do not shadow the blast.
  // `targets` are the same rewound positions the ray was traced against.
  _detonate(shooter, shot, ray, w, targets) {
    const b = w.explosive, blast = { radius: b.radius, inner: b.inner ?? 0, max: b.damage, min: b.min ?? 0 };
    const dist = Math.hypot(ray.x - shot.ox, ray.z - shot.oz), back = Math.min(0.2, dist);
    const x = ray.x - (ray.x - shot.ox) / Math.max(dist, 1e-6) * back;
    const z = ray.z - (ray.z - shot.oz) / Math.max(dist, 1e-6) * back;
    this._emit({ t: 'explosion', x: round2(x), z: round2(z), radius: b.radius, by: shooter.id, weapon: shot.weapon });
    this.eq.setOffMines(x, z, b.radius);
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i];
      if (!e.alive || e.team === shooter.team) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d >= b.radius || !hasLineOfSight(this.map, x, z, e.x, e.z)) continue;
      if (V9.domeCovers(this, e.x, e.z, e.team) && !V9.domeCovers(this, x, z, e.team)) continue;   // Aegis Dome.
      const q = this.players[i];
      this._damage(q, shooter, blastDamage(blast, d, q.ps.perks), shot.weapon, Math.hypot(e.x - shot.ox, e.z - shot.oz));
    }
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i];
      if (t.team === shooter.team) continue;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < b.radius && hasLineOfSight(this.map, x, z, t.x, t.z)) this._hurtTurret(t, blastDamage(blast, d), shooter);
    }
  }

  // Gunfire against equipment: each ray can destroy one enemy device it passes over and chips any enemy Bulwark it meets.
  _shootGear(shooter, shot, rays, w) {
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i], a = shot.angles[i], dx = Math.cos(a), dz = Math.sin(a);
      const len = Math.hypot(r.x - shot.ox, r.z - shot.oz);
      this.eq.shootDevices(shot.ox, shot.oz, dx, dz, len, shooter.team, shooter.id, this._onEqEvent);
      this.eq.shootCover(shot.ox, shot.oz, dx, dz, len, shooter.team, shooter.id, w.damage, this._onEqEvent);
    }
  }

  // Stops rays at enemy turrets, which the shooter's own traceShot knows nothing about.
  // Returns an array of the turret hit by each ray (null where none), or null when nothing was hit.
  _raysVsTurrets(shot, rays, shooter) {
    let hits = null;
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i], dirX = Math.cos(shot.angles[i]), dirZ = Math.sin(shot.angles[i]);
      let bestT = Math.hypot(r.x - shot.ox, r.z - shot.oz), best = null;
      for (let k = 0; k < this.turrets.length; k++) {
        const t = this.turrets[k];
        if (t.team === shooter.team) continue;
        const along = rayCircle(shot.ox, shot.oz, dirX, dirZ, t.x, t.z, TURRET_RADIUS);
        if (along >= 0 && along < bestT) { bestT = along; best = t; }
      }
      if (!best) continue;
      (hits || (hits = new Array(rays.length).fill(null)))[i] = best;
      r.x = shot.ox + dirX * bestT; r.z = shot.oz + dirZ * bestT;
      r.hit = 'turret'; r.nx = -dirX; r.nz = -dirZ;
    }
    return hits;
  }

  _damageTurretsFromShot(hits, rays, shot, w, ads, shooter = null) {
    for (let i = 0; i < rays.length; i++) {
      const t = hits[i];
      if (!t) continue;
      // Same rule as a player hit, minus the head (a sentry has none): falloff, and what cover took off the round on
      // the way to the turret. The ray's own pen was worked out to its old end point, beyond the turret, so redo it.
      const pen = shotPassage(this.map, shot.ox, shot.oz, rays[i].x, rays[i].z, w) || 1;
      TURRET_RAY.pen = pen;
      this._hurtTurret(t, rayDamage(w, TURRET_RAY, Math.hypot(rays[i].x - shot.ox, rays[i].z - shot.oz), ads), shooter);
    }
  }

  // Sightings older than anyone will still act on.
  _expireCallouts() {
    const c = this.callouts;
    while (c.length && this.time - c[0].t > 6) c.shift();
  }

  _alertBots(shooter, suppressed) {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.bot && p.alive && p.team !== shooter.team) p.bot.onGunshot(shooter, suppressed);
    }
  }

  // ---- Damage, kills, medals ----

  // `streak` is a scorestreak kind when one did this damage; `equip` is a thrown item's kind.
  _damage(target, attacker, dmg, weapon, dist, streak = null, head = false, equip = null) {
    if (!target || !target.alive || target.spawnProtect > 0 || target.team === attacker.team) return;
    if (this.snd && !this.snd.combat) return;       // Between rounds nothing hurts.
    if (this.rules?.damage) { dmg = this.rules.damage(target, attacker, dmg, weapon, streak, equip); if (!(dmg > 0)) return; }
    if (this.hardcore) dmg *= HARDCORE_DAMAGE;         // Hardcore: everyone on a third of the health.
    // A lethal headshot carries a multiplier worth several hundred points. Only what the target had left counts as
    // damage dealt: in hit events, assists and the firing range readout.
    if (target.windT > this.time && hasPro(target.ps, 'adrenaline')) dmg *= WIND_TAKEN;     // Second Wind.
    if (target.armor > 0) dmg = this._soak(target, dmg, weapon, streak, equip);         // Juggernaut.
    if (target.plates > 0) dmg = V9.soakPlates(this, target, dmg, weapon, streak, equip);   // Plate Drop.
    dmg = Math.min(dmg, Math.max(0, target.hp));
    if (this.range) this.range.onDamage(target, attacker, dmg, dist, head, !!(streak || equip));
    target.hp -= dmg;
    // Shock Absorber (Flak Pro): blasts do not reset the regen delay.
    const blast = (equip && EQUIPMENT[equip]?.blast) || BLAST_STREAKS.has(streak) || (!streak && !equip && WEAPONS[weapon]?.explosive);
    if (!(blast && hasPro(target.ps, 'flak'))) target.regenT = target.ps.perks.includes('quickmend') ? MEND_DELAY : REGEN_DELAY;
    if (!streak && !equip && attacker.ps.perks.includes('tracker') && this._markable(target)) target.markT = MARK_TIME;
    // Streak damage earns no assist either, or it would feed the owner's score after all.
    if (!streak) {
      target.dmgBy[attacker.index] += dmg;
      target.dmgT[attacker.index] = this.time;
    }
    const killed = target.hp <= 0;
    const hit = { t: 'hit', by: attacker.id, target: target.id, dmg: Math.round(dmg),
      x: round2(target.ps.x), z: round2(target.ps.z), killed };
    if (head) hit.head = true;
    if (this._soaked) { hit.armor = true; this._soaked = false; }     // Some or all of it went into Juggernaut armour.
    // Gunfire carries its gun and range, for the per-gun stats (js/game/telemetry.js). Streaks and thrown kit do not.
    if (!streak && !equip) { hit.w = weapon; hit.dist = round2(dist); }
    else if (equip) hit.eq = equip;     // What a non-gun hit was, for Pro challenges (js/shared/progression.js).
    else hit.st = streak;
    this._emit(hit);
    if (target.bot) target.bot.onDamaged(attacker, !!(streak || equip));
    this.snd?.onDamaged(target);
    if (killed) this._kill(target, attacker, weapon, dist, streak, head, equip);
  }

  _kill(target, killer, weapon, dist, streak, head, equip) {
    target.hp = 0; target.alive = false; target.respawnT = RESPAWN_TIME;
    target.deadT = 0; target.wantRespawn = false;
    if (this.range) this.range.onKill(target);
    // Scorestreak score is not touched: it persists through death (docs/V4.md rules, restored in Wave 6).
    target.deaths++; target.streak = 0; target.chain = 0; target.spawnProtect = 0; target.markT = 0;
    target.armor = 0; target.plates = 0;
    target.lastKilledBy = killer.id;
    killer.kills++;
    if (this.mode === 'tdm' || this.mode === 'ffa') this.scores[killer.team]++;
    else if (this.ladder) this._climb(killer, target, equip);
    else this._dropTag(target);

    let assist = null, bestDmg = ASSIST_MIN_DAMAGE;
    for (let i = 0; i < this.players.length; i++) {
      const q = this.players[i];
      if (q === killer || q.team === target.team) continue;
      const done = target.dmgBy[i];
      if (done >= bestDmg && this.time - target.dmgT[i] < ASSIST_WINDOW) { bestDmg = done; assist = q; }
    }
    // Team Player (Hardline Pro): an assist is worth a kill toward scorestreaks.
    if (assist) { assist.assists++; addScore(assist.score, hasPro(assist.ps, 'hardline') ? SCORE.kill : SCORE.assist); }
    target.dmgBy.fill(0);

    // weapon stays a real gun id even for streaks and grenades, so consumers need no special case.
    const kill = { t: 'kill', by: killer.id, target: target.id, weapon, camo: killer.camo,
      x: round2(target.ps.x), z: round2(target.ps.z), assist: assist ? assist.id : null, dist: round2(dist) };
    if (streak) kill.streak = streak;
    if (equip) kill.equip = equip;
    if (head) kill.head = true;
    kill.vw = target.ps.weapon;     // What the victim was holding: per-gun deaths in the stats.
    this._emit(kill);
    this.lastKill = { by: killer.id, target: target.id, weapon, camo: killer.camo, x: kill.x, z: kill.z };
    // Where the fighting just was, for free-for-all bots looking for some (BotBrain._roam).
    const hot = this.hot ??= { x: 0, z: 0, t: 0 };
    hot.x = target.ps.x; hot.z = target.ps.z; hot.t = this.time;

    if (!this.firstBlood) { this.firstBlood = true; this._medal(killer, 'first_blood'); }
    if (killer.lastKilledBy === target.id) { killer.lastKilledBy = null; this._medal(killer, 'revenge'); }
    if (!streak && !equip && dist >= (WEAPONS[weapon]?.longshot ?? LONGSHOT)) this._medal(killer, 'longshot');
    if (head) { killer.head++; this._medal(killer, 'headshot'); }
    if (weapon === GOLDEN_ID && !streak && !equip) this._medal(killer, 'golden');

    killer.chain = this.time - killer.lastKillT <= CHAIN_WINDOW ? killer.chain + 1 : 1;
    killer.lastKillT = this.time;
    if (killer.chain === 2) this._medal(killer, 'double');
    else if (killer.chain === 3) this._medal(killer, 'triple');
    else if (killer.chain >= 4) this._medal(killer, 'fury');

    // A scorestreak's kills count for the team, but never feed the score that earned it.
    if (!streak) {
      this._checkDefend(killer, target);
      addScore(killer.score, SCORE.kill + (head ? SCORE.headshot : 0));
      killer.streak++;
      if (killer.streak === 3) this._medal(killer, 'streak3');
      else if (killer.streak === 5) this._medal(killer, 'streak5');
      else if (killer.streak === 10) this._medal(killer, 'streak10');
      if (killer.ps.perks.includes('adrenaline') && !equip) {
        killer.hp = Math.min(MAX_HP, killer.hp + ADRENALINE_HEAL);
        this._emit({ t: 'heal', id: killer.id });
      }
      if (killer.ps.perks.includes('scavenger')) {
        scavengeRefill(killer.ps);
        if (!killer.isBot) this._emit({ t: 'scavenge', id: killer.id });
        if (hasPro(killer.ps, 'scavenger') && this._packRat(killer.ps)) this._proEvent(killer, 'scavenger');
      }
      if (!equip && hasPro(killer.ps, 'adrenaline')) { killer.windT = this.time + WIND_TIME; this._proEvent(killer, 'adrenaline'); }
    }

    this.snd?.onKill(target);
    this.ctf?.onKill(target, killer);
    if (this.rules) { this.rules.onKill?.(target, killer, { weapon, streak, equip, head }); return; }
    if (!this.snd && !this.ctf && this.scores[killer.team] >= this.scoreLimit) this._end(killer.team);
  }

  // A death with nobody to credit: a Search and Destroy attacker caught in their own bomb. Counts as a death only.
  _selfKill(target, equip) {
    if (!target.alive) return;
    target.hp = 0; target.alive = false; target.respawnT = RESPAWN_TIME; target.deadT = 0; target.wantRespawn = false;
    target.deaths++; target.streak = 0; target.chain = 0; target.spawnProtect = 0; target.markT = 0;
    target.armor = 0; target.plates = 0;
    target.dmgBy.fill(0);
    const x = round2(target.ps.x), z = round2(target.ps.z);
    this._emit({ t: 'hit', by: target.id, target: target.id, dmg: MAX_HP, x, z, killed: true, eq: equip });
    this._emit({ t: 'kill', by: target.id, target: target.id, weapon: target.ps.weapon, camo: target.camo, x, z, assist: null, dist: 0, equip, vw: target.ps.weapon });
    this.snd?.onKill(target);
    this.ctf?.onKill(target, null);
    this.rules?.onKill?.(target, null, {});
  }

  _medal(p, medal) { this._emit({ t: 'medal', id: p.id, medal }); }

  // Pack Rat (Scavenger Pro): one lethal back, or a tactical if lethals are full. False when both are full.
  _packRat(ps) {
    const extra = ps.perks.includes('bandolier') ? 1 : 0;
    if (ps.lethalLeft < LETHALS[ps.lethal].count + extra) { ps.lethalLeft++; return true; }
    if (ps.tacticalLeft < TACTICALS[ps.tactical].count + extra) { ps.tacticalLeft++; return true; }
    return false;
  }

  // ---- Equipment ----

  _stepEquipment() {
    const list = this.eqPlayers, players = this.players;
    list.length = players.length;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const e = list[i] || (list[i] = { id: p.id, team: p.team, x: 0, z: 0, alive: false, perks: null, pro: null, spawnProtect: false, aim: 0, room: false });
      e.id = p.id; e.x = p.ps.x; e.z = p.ps.z; e.alive = p.alive; e.perks = p.ps.perks; e.pro = p.ps.pro; e.spawnProtect = p.spawnProtect > 0;
      e.aim = p.ps.aim; e.room = p.ps.lethalLeft < LETHALS[p.ps.lethal].count + (p.ps.perks.includes('bandolier') ? 1 : 0);
    }
    this.eq.step(STEP, list, this._onEqEvent, this._onEqDamage);
  }

  _onEqEvent(e) {
    if (e.t === 'heal') {
      const p = this.byId.get(e.id);
      if (!p || !p.alive) return;
      if (e.kind) {                        // Medpack: only a tick that does something is worth an event.
        if (p.hp >= MAX_HP) return;
        p.hp = Math.min(MAX_HP, p.hp + e.amount);
        this._emit({ t: 'heal', id: e.id, kind: e.kind, by: e.by });
        return;
      }
      p.hp = Math.min(MAX_HP, p.hp + e.amount);
      this._emit({ t: 'heal', id: e.id });
      return;
    }
    if (e.t === 'jammed') {
      // Blackout. Engineer shrugs it off. The phone learns it from the player flags (see encodeSnapshot).
      const p = this.byId.get(e.id);
      if (!p || !p.alive || p.ps.perks.includes('engineer')) return;
      p.jamT = Math.max(p.jamT, e.dur);
      this._emit({ t: 'jammed', id: e.id, by: e.by, dur: e.dur, kind: e.kind });   // kind 'emp': the EMP scorestreak.
      return;
    }
    if (e.t === 'pickup') {
      const p = this.byId.get(e.id);
      if (p && p.ps.lethal === e.kind) p.ps.lethalLeft++;
      this._emit(e);
      return;
    }
    if (e.t === 'stuck') { this._emit(e); return; }
    if (e.t === 'popped') {
      e.x = round2(e.x); e.z = round2(e.z);
      this._emit(e);
      return;
    }
    if (e.t === 'flashed') {
      const p = this.byId.get(e.id), by = this.byId.get(e.by);
      if (p && p.bot) p.bot.onFlashed(e.dur);
      // Spotter (Tac Mask Pro): whoever you blind is on your team's minimap until they can see again.
      if (p && by && p.team !== by.team && hasPro(by.ps, 'tacmask') && this._markable(p)) p.markT = Math.max(p.markT, e.dur);
      this._emit({ t: 'flashed', id: e.id, amount: round2(e.amount), dur: round2(e.dur), by: e.by });
      return;
    }
    if (e.t === 'marked') {
      // Recon marks (Sensor, Snapshot, Tagger): Cold Blooded halves them, Blank Slate is never marked at all.
      const q = this.byId.get(e.id);
      if (!q || !q.alive || !this._markable(q)) return;
      const dur = e.dur * (q.ps.perks.includes('coldblood') ? COLD_MARK : 1);
      q.markT = Math.max(q.markT, dur);
      this._emit({ t: 'marked', id: e.id, by: e.by, dur: round2(dur), kind: e.kind });
      const by = this.byId.get(e.by);     // The thrower's team bots get a firm fix from it.
      if (by) for (let i = 0; i < this.players.length; i++) { const b = this.players[i]; if (b.bot && b.alive && b.team === by.team) b.bot.onMarked(q); }
      return;
    }
    if (e.t === 'bang') {
      e.x = round2(e.x); e.z = round2(e.z);
      if (e.ox !== undefined) { e.ox = round2(e.ox); e.oz = round2(e.oz); }     // Drill: where it bored in.
      if (e.aim !== undefined) e.aim = round2(e.aim);                           // Claymore: which way it fired.
      if (EQUIPMENT[e.kind].blast) this._blastTurrets(e);
    } else if (e.t === 'throw') {
      e.ox = round2(e.ox); e.oz = round2(e.oz); e.aim = round2(e.aim);
    } else if (e.t === 'decoy') {
      this._alertBots({ ps: { x: e.x, z: e.z }, team: e.team }, false);
      e.x = round2(e.x); e.z = round2(e.z);
    } else if (e.t === 'dazed') {
      // Stun, Gas, Shock. Bots are slowed here; a human's phone applies its own (it owns its movement).
      const p = this.byId.get(e.id);
      if (!p || !p.alive) return;
      if (p.bot) applyDaze(p.ps, e.amount, e.dur);
      e.amount = round2(e.amount); e.dur = round2(e.dur);
    } else if (e.t === 'gear' || e.t === 'fried') {
      if (e.t === 'gear' && (e.kind === 'shock' || e.kind === 'blackout')) this._blastTurrets({ kind: 'shock', by: e.by, x: e.x, z: e.z, r: e.r });  // Arcs and EMP short out Sentries.
      e.x = round2(e.x); e.z = round2(e.z);
      if (e.ox !== undefined) { e.ox = round2(e.ox); e.oz = round2(e.oz); }
    } else if (e.t === 'pulse' || e.t === 'zap') {
      e.x = round2(e.x); e.z = round2(e.z);
    }
    this._emit(e);
  }

  _onEqDamage(targetId, dmg, ownerId, kind) {
    const target = this.byId.get(targetId), owner = this.byId.get(ownerId);
    if (!target || !owner) return;
    // Aegis Dome: an enemy blast does not reach its team inside (burns and gas still do).
    if (EQUIPMENT[kind]?.blast && V9.domeCovers(this, target.ps.x, target.ps.z, target.team)) return;
    const dist = Math.hypot(owner.ps.x - target.ps.x, owner.ps.z - target.ps.z);
    this._damage(target, owner, dmg, owner.ps.weapon, dist, null, false, kind);
  }

  // A grenade hurts enemy turrets the same way it hurts enemy players.
  _blastTurrets(bang) {
    const thrower = this.byId.get(bang.by);
    if (!thrower) return;
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i];
      if (t.team === thrower.team) continue;
      const d = Math.hypot(t.x - bang.x, t.z - bang.z);
      if (d >= bang.r || !hasLineOfSight(this.map, bang.x, bang.z, t.x, t.z)) continue;
      this._hurtTurret(t, EQUIPMENT[bang.kind].shock ? SHOCK_TURRET : blastDamage(EQUIPMENT[bang.kind].blast, d));
    }
  }

  // ---- Streaks ----

  // Fires the streak in `slot`, or the most expensive one held when no slot is given. Returns its kind, or null.
  // Refusing keeps the streak; a human hears why through a streak_denied event, a bot would only be spamming it.
  useStreak(id, slot) {
    const p = this.byId.get(id);
    if (!p || this.phase !== 'live' || !p.alive || this.snd) return null;
    const slots = p.score.slots;
    if (slot === undefined) {
      for (let i = slots.length - 1; i >= 0 && slot === undefined; i--) if (slots[i].held) slot = i;
    }
    const s = slots[slot];
    if (!s || !s.held) return null;
    const kind = s.kind;
    let denied = this.streakDenied(p, kind);
    let spot = null;
    if (!denied && (kind === 'strike' || (kind === 'bombrun' && p.isBot))) {
      spot = this._strikeTarget(p);
      if (!spot) denied = 'no_target';
    }
    if (denied) {
      if (!p.isBot) this._emit({ t: 'streak_denied', id, kind, reason: denied });
      return null;
    }
    spendStreak(p.score, slot);
    this._callStreak(p, kind, spot);
    return kind;
  }

  // Puts a streak into play for `p`, already paid for and allowed (useStreak, or an Airdrop that was opened).
  _callStreak(p, kind, spot) {
    const id = p.id;
    this._airTick = -1;            // A second call in this same tick has to see what this one launched.
    switch (kind) {
      case 'uav':
        this.uav[p.team] = UAV_TIME;
        this._emit({ t: 'streak', id, kind, team: p.team });
        break;
      case 'jammer':
        for (let t = 0; t < this.teamCount; t++) if (this._hostile(t, p.team)) this.jam[t] = JAM_TIME;
        this.jamBy[p.team] = JAM_TIME;
        this._emit({ t: 'streak', id, kind, team: p.team });
        break;
      case 'overwatch':
        this.overwatch[p.team] = OVERWATCH_TIME;
        this.uav[p.team] = Math.max(this.uav[p.team], OVERWATCH_TIME);
        this._emit({ t: 'streak', id, kind, team: p.team });
        break;
      case 'resupply': this._resupply(p); break;
      case 'turret': this._placeTurret(p); break;
      case 'mortar': this._launchMortar(p); break;
      case 'strike': this._launchStrike(p, spot); break;
      case 'chopper': this._launchChopper(p); break;
      case 'gunship': this._launchGunship(p); break;
      case 'emp': this._emp(p); break;
      case 'missile': this._launchMissile(p); break;
      case 'swarm': this._launchSwarm(p); break;
      case 'juggernaut': this._suitUp(p); break;
      default: V9.launch(this, p, kind, spot); break;
    }
  }

  // ---- Airspace and availability ----

  // Air streaks currently up for a team: anything flying, plus an airstrike on its way in.
  _countAir() {
    if (this._airTick === this.tick) return;
    this._airTick = this.tick;
    const n = this._airCount, T = this.teamCount;
    for (let t = 0; t < T; t++) {
      // A team's own Jammer: in team modes it is the jam on the other side, in a free-for-all its own clock.
      const jamming = this.ffa ? this.jamBy[t] > 0 : this.jam[1 - t] > 0;
      n[t] = (this.uav[t] > 0 && this.overwatch[t] <= 0 ? 1 : 0) + (this.overwatch[t] > 0 ? 1 : 0) + (jamming ? 1 : 0);
    }
    for (let i = 0; i < this.gunships.length; i++) if (this.gunships[i].lead !== false) n[this.gunships[i].team]++;   // A swarm is one aircraft.
    const striking = this._striking.fill(false);
    for (let i = 0; i < this.strikes.length; i++) if (this.strikes[i].kind === 'strike' || this.strikes[i].kind === 'bombrun') striking[this.strikes[i].team] = true;
    for (let t = 0; t < T; t++) if (striking[t]) n[t]++;
  }

  // Air streaks up across the whole map.
  _airTotal() {
    let sum = 0;
    for (let t = 0; t < this.teamCount; t++) sum += this._airCount[t];
    return sum;
  }

  // Whether two sides are enemies. Every side but your own is, in team modes and free-for-all alike.
  _hostile(a, b) { return a !== b; }

  // How many of one streak a team has running right now.
  _activeCount(team, kind) {
    const v9 = V9.activeCount(this, team, kind);
    if (v9 !== undefined) return v9;
    switch (kind) {
      case 'uav': return this.uav[team] > 0 ? 1 : 0;
      case 'jammer': return (this.ffa ? this.jamBy[team] > 0 : this.jam[1 - team] > 0) ? 1 : 0;
      case 'overwatch': return this.overwatch[team] > 0 ? 1 : 0;
      case 'mortar': return this.mortars.reduce((n, m) => n + (m.team === team ? 1 : 0), 0);
      case 'strike': return this.strikes.some(s => s.kind === 'strike' && s.team === team) ? 1 : 0;
      case 'turret': return this.turrets.reduce((n, t) => n + (t.team === team ? 1 : 0), 0);
      case 'gunship':
      case 'chopper':
      case 'missile':
      case 'swarm': return this.gunships.reduce((n, g) => n + (g.team === team && g.kind === kind && g.lead !== false ? 1 : 0), 0);
      default: return 0;
    }
  }

  // null when `kind` can be called right now, otherwise the reason it cannot: 'limit' (the team has as many of it up
  // as it may), 'airspace' (too much already in the air) or 'no_target'.
  streakDenied(p, kind) {
    const def = STREAKS[kind], team = p.team;
    if (!def) return 'limit';
    if (V9.empLocked(this, team)) return 'emp';
    if (def.limit > 0 && this._activeCount(team, kind) >= V9.limitFor(this, kind)) return 'limit';
    if (def.air) {
      this._countAir();
      const air = V9.airMax(this);
      if (this._airCount[team] >= air.team || this._airTotal() >= air.total) return 'airspace';
    }
    if (kind === 'mortar' && this._teamVisible(team).length === 0) return 'no_target';
    if (kind === 'juggernaut' && p.armor > 0) return 'limit';     // One suit at a time.
    return null;
  }

  // The radar works if it is flying and not jammed.
  radarUp(team) { return this.uav[team] > 0 && (this.jam[team] <= 0 || this.overwatch[team] > 0); }   // Overwatch shrugs off a Jammer.

  // Enemies a team can see or has on radar, refreshed every few ticks: every streak that shoots at "what the team can
  // see" shares this. Same rules as humans: line of sight from a teammate, or an unjammed radar.
  _teamVisible(team) {
    if (this.tick - this._visibleTick[team] >= VIS_EVERY) {
      this._visibleTick[team] = this.tick;
      const out = this._visible[team];
      out.length = 0;
      for (let i = 0; i < this.players.length; i++) {
        const q = this.players[i];
        if (q.team !== team && q.alive && q.spawnProtect <= 0 && !q.dummy && this._teamSees(team, q)) out.push(q);
      }
    }
    return this._visible[team];
  }

  // Cold Blooded: automated streaks do not pick you out unless you are close to the machine doing the picking.
  _coldHidden(q, x, z) {
    return q.ps.perks.includes('coldblood') && Math.hypot(q.ps.x - x, q.ps.z - z) > COLD_REACH;
  }

  _engineerMult(p, mult) { return p.ps.perks.includes('engineer') ? mult : 1; }

  _launchStrike(p, spot) {
    this._emit({ t: 'streak', id: p.id, kind: 'strike', team: p.team, x: round2(spot.x), z: round2(spot.z) });
    for (let i = 0; i < STRIKE_COUNT; i++) {
      const k = i - (STRIKE_COUNT - 1) / 2;
      this.strikes.push({
        kind: 'strike', team: p.team, radius: STRIKE_RADIUS, damage: STRIKE_DAMAGE,
        at: this.time + STRIKE_DELAY + i * STRIKE_STEP, by: p,
        x: Math.max(1, Math.min(this.map.width - 1, spot.x + spot.dx * k * STRIKE_SPACING)),
        z: Math.max(1, Math.min(this.map.height - 1, spot.z + spot.dz * k * STRIKE_SPACING)),
      });
    }
  }

  _launchMortar(p) {
    this.mortars.push({ by: p, team: p.team, left: MORTAR_SHELLS, t: 0 });
    this._emit({ t: 'streak', id: p.id, kind: 'mortar', team: p.team });
  }

  // One shell per gap at whoever the team can see right then, so a mortar follows a fight instead of a stale spot.
  _stepMortars() {
    for (let i = this.mortars.length - 1; i >= 0; i--) {
      const m = this.mortars[i];
      m.t -= STEP;
      if (m.t > 0) continue;
      m.t += MORTAR_GAP;
      if (--m.left <= 0) this.mortars.splice(i, 1);
      const seen = this._teamVisible(m.team).filter(q => !this._coldHidden(q, m.by.ps.x, m.by.ps.z));
      if (seen.length === 0) continue;
      const q = seen[Math.floor(this.rng() * seen.length)];
      const x = Math.max(1, Math.min(this.map.width - 1, q.ps.x + bell(this.rng) * MORTAR_SCATTER));
      const z = Math.max(1, Math.min(this.map.height - 1, q.ps.z + bell(this.rng) * MORTAR_SCATTER));
      this.strikes.push({ kind: 'mortar', team: m.team, by: m.by, x, z, at: this.time + MORTAR_FLIGHT, radius: MORTAR_RADIUS, damage: MORTAR_DAMAGE });
      this._emit({ t: 'incoming', kind: 'mortar', x: round2(x), z: round2(z), delay: MORTAR_FLIGHT, team: m.team });
    }
  }

  // Everyone on the team nearby gets health, ammo and equipment. A human's ammo lives on their own phone, hence the event.
  _resupply(p) {
    this._emit({ t: 'streak', id: p.id, kind: 'resupply', team: p.team, x: round2(p.ps.x), z: round2(p.ps.z) });
    for (let i = 0; i < this.players.length; i++) {
      const q = this.players[i];
      if (q.team !== p.team || !q.alive || Math.hypot(q.ps.x - p.ps.x, q.ps.z - p.ps.z) > SUPPLY_RADIUS) continue;
      q.hp = MAX_HP;
      this._emit({ t: 'heal', id: q.id });
      const extra = q.ps.perks.includes('bandolier') ? 1 : 0;
      q.ps.tacticalLeft = TACTICALS[q.ps.tactical].count + extra;
      q.ps.lethalLeft = LETHALS[q.ps.lethal].count + extra;
      for (let n = 0; n < SUPPLY_MAGS; n++) {
        scavengeRefill(q.ps);
        if (!q.isBot) this._emit({ t: 'scavenge', id: q.id });
      }
    }
  }

  // Everything electronic the enemy has dies, and their radar stays down a moment after.
  // In a free-for-all that is every other player.
  _emp(p) {
    const own = p.team, teamOf = id => this.byId.get(id)?.team;
    V9.empBlast(this, p);        // Air, machines, queued strikes, the streak lock and the kit jam (js/sim/streaks-v9.js).
    this._emit({ t: 'streak', id: p.id, kind: 'emp', team: own });
    for (let enemy = 0; enemy < this.teamCount; enemy++) {
      if (enemy === own) continue;
      this.uav[enemy] = 0; this.overwatch[enemy] = 0; this.jamBy[enemy] = 0;
      this.jam[enemy] = Math.max(this.jam[enemy], EMP_JAM_TIME);
      this.eq.clearDeployed(enemy, teamOf);
      if (!this.ffa || this.players.some(q => q.team === enemy)) this._emit({ t: 'emp', team: enemy });
    }
    this._airTick = -1;
  }

  _placeTurret(p) {
    const k = this._engineerMult(p, ENGINEER_TURRET);
    const t = {
      id: this.nextTurretId++, kind: 'sentry', team: p.team, owner: p, x: p.ps.x, z: p.ps.z, aim: wrapAngle(p.ps.aim),
      hp: TURRET_HP * k, maxHp: TURRET_HP * k, life: TURRET_LIFE * k, thinkT: 0, cooldown: 0.4, target: null,
    };
    this.turrets.push(t);
    this.nav?.paintDanger(this.turrets.filter(V9.isShooter));
    this._emit({ t: 'streak', id: p.id, kind: 'turret', team: p.team, x: round2(t.x), z: round2(t.z) });
    this._emit({ t: 'turret', id: t.id, team: t.team, x: round2(t.x), z: round2(t.z) });
  }

  _stepTurrets() {
    const list = this.turrets;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      t.life -= STEP;
      if (t.life <= 0) { this._removeTurret(t); continue; }
      if (V9.stepMachine(this, t)) continue;            // Rovers drive; Domes and Airdrop crates do not shoot.
      if (this._stepHijack(t)) continue;
      t.cooldown -= STEP;
      t.thinkT -= STEP;
      if (t.thinkT <= 0) { t.thinkT = TURRET_THINK; t.target = this._turretTarget(t); }
      const q = t.target;
      if (!q || !q.alive) continue;
      const off = angleDiff(Math.atan2(q.ps.z - t.z, q.ps.x - t.x), t.aim);
      const lim = TURRET_TURN * STEP;
      t.aim = wrapAngle(t.aim + Math.max(-lim, Math.min(lim, off)));
      if (t.cooldown <= 0 && Math.abs(off) < TURRET_TOL) {
        t.cooldown = TURRET_INTERVAL;
        this._turretFire(t);
      }
    }
  }

  // Hijacker (Engineer Pro): an enemy standing at the sentry for HIJACK_TIME takes it over, with the life it has left.
  // It keeps shooting at them while they work. Returns true on the tick it changes hands.
  _stepHijack(t) {
    let who = null;
    for (let i = 0; i < this.players.length; i++) {
      const q = this.players[i];
      if (q.team === t.team || !q.alive || !hasPro(q.ps, 'engineer')) continue;
      if (Math.hypot(q.ps.x - t.x, q.ps.z - t.z) <= HIJACK_REACH) { who = q; break; }
    }
    if (!who) { t.hackT = 0; t.hackBy = null; return false; }
    t.hackT = t.hackBy === who ? (t.hackT ?? 0) + STEP : STEP;
    t.hackBy = who;
    if (t.hackT < HIJACK_TIME) return false;
    t.team = who.team; t.owner = who; t.target = null; t.hackT = 0; t.hackBy = null;
    this.nav?.paintDanger(this.turrets.filter(V9.isShooter));
    this._emit({ t: 'hijack', id: t.id, by: who.id, team: who.team, x: round2(t.x), z: round2(t.z) });
    this._proEvent(who, 'engineer');
    return true;
  }

  _turretTarget(t) {
    let best = null, bestD = TURRET_RANGE;
    for (let i = 0; i < this.players.length; i++) {
      const q = this.players[i];
      if (q.team === t.team || !q.alive || q.spawnProtect > 0 || this._coldHidden(q, t.x, t.z)) continue;
      const d = Math.hypot(q.ps.x - t.x, q.ps.z - t.z);
      if (d < bestD && hasLineOfSight(this.map, t.x, t.z, q.ps.x, q.ps.z, this.eq.smokes)) { bestD = d; best = q; }
    }
    return best;
  }

  _turretFire(t) {
    const angle = t.aim + bell(this.rng) * TURRET_SPREAD * 2;
    const dirX = Math.cos(angle), dirZ = Math.sin(angle);
    const wall = raycastMap(this.map, t.x, t.z, dirX, dirZ, TURRET_RANGE + 4, 'blocksBullet');
    let bestT = wall ? wall.t : TURRET_RANGE + 4, victim = null;
    for (let i = 0; i < this.players.length; i++) {
      const q = this.players[i];
      if (q.team === t.team || !q.alive) continue;
      const hit = rayCircle(t.x, t.z, dirX, dirZ, q.ps.x, q.ps.z, q.ps.sliding ? TURRET_SLIDE_RADIUS : TURRET_HIT_RADIUS);
      if (hit >= 0 && hit < bestT) { bestT = hit; victim = q; }
    }
    // The sentry fires a rifle-class round: waist-high cover takes its share like it would off anyone else's.
    let pen = 1;
    if (victim) {
      pen = shotPassage(this.map, t.x, t.z, t.x + dirX * bestT, t.z + dirZ * bestT, TURRET_GUN);
      if (pen <= 0) { victim = null; bestT = Math.min(bestT, this._coverStop(t.x, t.z, dirX, dirZ, bestT)); }
    }
    const rover = t.kind === 'rover';      // V9: a Rover is a sentry gun on wheels; its kills are its own.
    this._emit({ t: 'turret_shot', ox: round2(t.x), oz: round2(t.z), x: round2(t.x + dirX * bestT), z: round2(t.z + dirZ * bestT), kind: rover ? 'rover' : undefined });
    if (victim) this._damage(victim, t.owner, TURRET_DAMAGE * pen, t.owner.ps.weapon, bestT, rover ? 'rover' : 'turret');
  }

  // Where cover stops a sentry round short of `maxT` (for drawing it), found by stepping back along the ray.
  _coverStop(x, z, dirX, dirZ, maxT) {
    let lo = 0, hi = maxT;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (shotPassage(this.map, x, z, x + dirX * mid, z + dirZ * mid, TURRET_GUN) > 0) lo = mid; else hi = mid;
    }
    return lo;
  }

  _hurtTurret(t, dmg, by = null) {
    t.hp -= dmg;
    if (t.hp <= 0) { this._removeTurret(t); V9.machineDestroyed(this, t, by); }
  }

  _removeTurret(t) {
    const i = this.turrets.indexOf(t);
    if (i < 0) return;
    this.turrets.splice(i, 1);
    t.hp = 0;   // Bots holding a reference see it die.
    this.nav?.paintDanger(this.turrets.filter(V9.isShooter));
    this._emit({ t: 'turret_down', id: t.id, x: round2(t.x), z: round2(t.z), kind: V9.kindOf(t) });
  }

  _launchGunship(p) {
    const dir = p.team === 0 ? 1 : -1;
    // V9: the orbit is centred over the fight, not the map, so it works on a 136 m map (and bigger) as on a small one.
    const g = { kind: 'gunship', team: p.team, owner: p, x: 0, z: 0, aim: 0, life: GUNSHIP_LIFE * this._engineerMult(p, ENGINEER_AIR), angle: this.rng() * Math.PI * 2, dir,
      pause: 1.2, burstLeft: 0, cooldown: 0, target: null, aimX: 0, aimZ: 0, cx: p.ps.x, cz: p.ps.z };
    this._moveGunship(g);
    this.gunships.push(g);
    this._emit({ t: 'streak', id: p.id, kind: 'gunship', team: p.team });
    this._emit({ t: 'gunship', team: p.team, owner: p.id });
  }

  // Comes in from the map edge behind its owner.
  _launchChopper(p) {
    const west = this.ffa ? p.ps.x < this.map.width / 2 : p.team === 0;     // A free-for-all chopper uses the nearer edge.
    // V9: from at most CHOPPER_ENTRY behind its owner, so on a huge map it does not spend its life flying in.
    const g = { kind: 'chopper', team: p.team, owner: p, x: Math.max(2, Math.min(this.map.width - 2, p.ps.x + (west ? -26 : 26))), z: p.ps.z, aim: west ? 0 : Math.PI,
      life: CHOPPER_LIFE * this._engineerMult(p, ENGINEER_AIR), angle: 0, dir: 1, pause: 1, burstLeft: 0, cooldown: 0, target: null, aimX: 0, aimZ: 0, retarget: 0 };
    this.gunships.push(g);
    this._emit({ t: 'streak', id: p.id, kind: 'chopper', team: p.team });
    this._emit({ t: 'gunship', team: p.team, owner: p.id, kind: 'chopper' });
  }

  // Orbits a centre that drifts toward the enemies its team can see (or its owner), radius scaled to the map.
  _moveGunship(g) {
    const W = this.map.width, H = this.map.height, R = Math.max(14, Math.min(22, Math.min(W, H) * 0.38));
    if (g.cx === undefined) { g.cx = W / 2; g.cz = H / 2; }
    const seen = this._teamVisible(g.team);
    let tx = g.owner.alive ? g.owner.ps.x : g.cx, tz = g.owner.alive ? g.owner.ps.z : g.cz;
    if (seen.length) { tx = 0; tz = 0; for (const q of seen) { tx += q.ps.x; tz += q.ps.z; } tx /= seen.length; tz /= seen.length; }
    const dx = tx - g.cx, dz = tz - g.cz, d = Math.hypot(dx, dz), m = Math.min(d, 3 * STEP);
    if (d > 1e-3) { g.cx += dx / d * m; g.cz += dz / d * m; }
    g.x = Math.max(1, Math.min(W - 1, g.cx + Math.cos(g.angle) * R));
    g.z = Math.max(1, Math.min(H - 1, g.cz + Math.sin(g.angle) * R));
    g.aim = wrapAngle(g.angle + g.dir * Math.PI / 2);
  }

  _stepGunships() {
    const list = this.gunships;
    for (let i = list.length - 1; i >= 0; i--) {
      const g = list[i];
      g.life -= STEP;
      if (g.life <= 0) {
        if (g.kind === 'missile') this._missileBlast(g, g.x, g.z);     // Out of fuel: it dives where it is.
        else if (g.kind === 'swarm') this._emit({ t: 'drone_down', x: round2(g.x), z: round2(g.z), team: g.team });
        else if (g.kind === 'reticle' && g.owner.alive) V9.finishReticle(this, g);    // Time up: the line drops.
        this._dropAir(i);
        continue;
      }
      if (V9.V9_AIR.has(g.kind)) { if (V9.stepAir(this, g)) this._dropAir(i); continue; }
      if (g.kind === 'chopper') { this._stepChopper(g); continue; }
      if (g.kind === 'missile') { if (this._stepMissile(g)) this._dropAir(i); continue; }
      if (g.kind === 'swarm') { if (this._stepDrone(g)) this._dropAir(i); continue; }
      g.angle += g.dir * STEP * Math.PI * 2 / GUNSHIP_ORBIT;
      this._moveGunship(g);
      if (g.burstLeft > 0) {
        g.cooldown -= STEP;
        if (g.cooldown <= 0) { g.cooldown = GUNSHIP_GAP; g.burstLeft--; this._gunshipRound(g); }
        continue;
      }
      g.pause -= STEP;
      if (g.pause > 0) continue;
      g.target = this._gunshipTarget(g);
      if (g.target) { g.burstLeft = GUNSHIP_BURST; g.cooldown = 0; g.pause = GUNSHIP_PAUSE; }
      else g.pause = 0.3;
    }
  }

  // Only what the owner's team can see or has on UAV, so hiding and smoke work against it too.
  _gunshipTarget(g) {
    let best = null, bestScore = Infinity;
    const seen = this._teamVisible(g.team);
    for (let i = 0; i < seen.length; i++) {
      const q = seen[i];
      if (!q.alive || this._coldHidden(q, g.x, g.z)) continue;
      const score = Math.hypot(q.ps.x - g.x, q.ps.z - g.z) + this.rng() * 12;
      if (score < bestScore) { bestScore = score; best = q; }
    }
    return best;
  }

  _teamSees(team, q) {
    if (this.radarUp(team) && (!q.ps.perks.includes('ghost') || this.overwatch[team] > 0)) return true;
    for (let i = 0; i < this.players.length; i++) {
      const a = this.players[i];
      if (a.team !== team || !a.alive) continue;
      if (Math.hypot(a.ps.x - q.ps.x, a.ps.z - q.ps.z) > GUNSHIP_EYES) continue;
      if (hasLineOfSight(this.map, a.ps.x, a.ps.z, q.ps.x, q.ps.z, this.eq.smokes)) return true;
    }
    return false;
  }

  _gunshipRound(g) {
    const q = g.target;
    if (q && q.alive) { this.posAt(q, GUNSHIP_LAG, POS); g.aimX = POS.x; g.aimZ = POS.z; }
    const x = Math.max(0, Math.min(this.map.width, g.aimX + bell(this.rng) * GUNSHIP_SCATTER));
    const z = Math.max(0, Math.min(this.map.height, g.aimZ + bell(this.rng) * GUNSHIP_SCATTER));
    this._emit({ t: 'gunship_shot', ox: round2(g.x), oz: round2(g.z), x: round2(x), z: round2(z) });
    if (this._onRoof(x, z)) return;     // The round is spent on whatever is overhead.
    let victim = null, bestD = GUNSHIP_BLAST;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.team === g.team || !p.alive) continue;
      const d = Math.hypot(p.ps.x - x, p.ps.z - z);
      if (d < bestD) { bestD = d; victim = p; }
    }
    if (victim) this._damage(victim, g.owner, GUNSHIP_DAMAGE, g.owner.ps.weapon, bestD, 'gunship');
  }

  // Moves toward its target and hangs at range; rounds fly level, so walls in the way stop them.
  _stepChopper(g) {
    g.retarget -= STEP;
    if (g.retarget <= 0) {
      g.retarget = CHOPPER_RETARGET;
      if (!g.target || !g.target.alive || !this._teamVisible(g.team).includes(g.target)) g.target = this._gunshipTarget(g);
    }
    const q = g.target && g.target.alive ? g.target : null;
    const gx = q ? q.ps.x : this.map.width / 2, gz = q ? q.ps.z : this.map.height / 2;
    const dx = gx - g.x, dz = gz - g.z, d = Math.max(1e-3, Math.hypot(dx, dz));
    g.aim = Math.atan2(dz, dx);
    const want = d - CHOPPER_HOVER;
    if (Math.abs(want) > 0.5) {
      const move = Math.min(CHOPPER_SPEED * STEP, Math.abs(want)) * Math.sign(want);
      g.x = Math.max(1, Math.min(this.map.width - 1, g.x + dx / d * move));
      g.z = Math.max(1, Math.min(this.map.height - 1, g.z + dz / d * move));
    }
    if (g.burstLeft > 0) {
      g.cooldown -= STEP;
      if (g.cooldown <= 0) { g.cooldown = CHOPPER_GAP; g.burstLeft--; this._chopperRound(g, q); }
      return;
    }
    g.pause -= STEP;
    if (g.pause <= 0 && q && d <= CHOPPER_RANGE) { g.burstLeft = CHOPPER_BURST; g.cooldown = 0; g.pause = CHOPPER_PAUSE; }
  }

  _chopperRound(g, q) {
    if (!q) { g.burstLeft = 0; return; }
    this.posAt(q, CHOPPER_LAG, POS);
    const angle = Math.atan2(POS.z - g.z, POS.x - g.x) + bell(this.rng) * CHOPPER_SPREAD;
    const dirX = Math.cos(angle), dirZ = Math.sin(angle), reach = CHOPPER_RANGE + 4;
    const wall = raycastMap(this.map, g.x, g.z, dirX, dirZ, reach, 'blocksBullet');
    let bestT = wall ? wall.t : reach, victim = null;
    for (let i = 0; i < this.players.length; i++) {
      const v = this.players[i];
      if (v.team === g.team || !v.alive) continue;
      const hit = rayCircle(g.x, g.z, dirX, dirZ, v.ps.x, v.ps.z, v.ps.sliding ? TURRET_SLIDE_RADIUS : TURRET_HIT_RADIUS);
      if (hit >= 0 && hit < bestT) { bestT = hit; victim = v; }
    }
    this._emit({ t: 'gunship_shot', kind: 'chopper', ox: round2(g.x), oz: round2(g.z), x: round2(g.x + dirX * bestT), z: round2(g.z + dirZ * bestT) });
    if (victim) this._damage(victim, g.owner, CHOPPER_DAMAGE, g.owner.ps.weapon, bestT, 'chopper');
  }

  // ---- V8 streaks: Cruise Missile, Drone Swarm, Juggernaut ----

  // Takes an aircraft out of the list. A swarm counts once against the airspace: when its lead drone goes, the next
  // drone of the same swarm takes over the count.
  _dropAir(i) {
    const g = this.gunships[i];
    this.gunships.splice(i, 1);
    if (g.kind === 'swarm' && g.lead) {
      const next = this.gunships.find(o => o.kind === 'swarm' && o.owner === g.owner && o.lead === false);
      if (next) next.lead = true;
    }
    this._airTick = -1;
  }

  // The nearest enemy a team can see that an automated seeker would pick out from (x, z) (Cold Blooded hides).
  _seekerMark(team, x, z, prefer = null, avoid = null) {
    const seen = this._teamVisible(team);
    let best = null, bestScore = Infinity;
    for (let i = 0; i < seen.length; i++) {
      const q = seen[i];
      if (!q.alive || this._coldHidden(q, x, z)) continue;
      let score = Math.hypot(q.ps.x - x, q.ps.z - z);
      if (q === prefer) score -= 4;                      // Stick with a chase rather than flick between two targets.
      if (avoid && avoid(q)) score += 10;                // Spread a swarm over several targets when there are several.
      if (score < bestScore) { bestScore = score; best = q; }
    }
    return best;
  }

  _launchMissile(p) {
    let aim = p.ps.aim;
    if (p.isBot) {
      const q = this._seekerMark(p.team, p.ps.x, p.ps.z);
      if (q) aim = Math.atan2(q.ps.z - p.ps.z, q.ps.x - p.ps.x);
    }
    const g = { kind: 'missile', team: p.team, owner: p, x: p.ps.x, z: p.ps.z, aim: wrapAngle(aim),
      life: MISSILE_LIFE * this._engineerMult(p, ENGINEER_AIR), age: 0, target: null, retarget: 0 };
    this.gunships.push(g);
    this._emit({ t: 'streak', id: p.id, kind: 'missile', team: p.team, x: round2(g.x), z: round2(g.z) });
  }

  // Turns toward where its pilot points, then flies. Returns true when it went off. A human pilot steers with the aim
  // they already send the host; a dead pilot's missile flies on straight. A bot steers at what its team can see.
  _stepMissile(g) {
    g.age += STEP;
    const o = g.owner;
    let want = g.aim;
    if (o.isBot) {
      g.retarget -= STEP;
      if (g.retarget <= 0) { g.retarget = 0.3; g.target = this._seekerMark(g.team, g.x, g.z, g.target); }
      if (g.target && g.target.alive) want = Math.atan2(g.target.ps.z - g.z, g.target.ps.x - g.x);
    } else if (o.alive) want = o.ps.aim;
    const lim = MISSILE_TURN * STEP;
    g.aim = wrapAngle(g.aim + Math.max(-lim, Math.min(lim, angleDiff(want, g.aim))));
    const dx = Math.cos(g.aim), dz = Math.sin(g.aim), step = MISSILE_SPEED * STEP;
    const wall = raycastMap(this.map, g.x, g.z, dx, dz, step, 'blocksVision');
    if (wall) {
      const t = Math.max(0, wall.t - 0.4);
      this._missileBlast(g, g.x + dx * t, g.z + dz * t);
      return true;
    }
    g.x += dx * step; g.z += dz * step;
    const W = this.map.width, H = this.map.height;
    if (g.x < 0.5 || g.z < 0.5 || g.x > W - 0.5 || g.z > H - 0.5) {
      this._missileBlast(g, Math.max(0.5, Math.min(W - 0.5, g.x)), Math.max(0.5, Math.min(H - 0.5, g.z)));
      return true;
    }
    if (g.age < MISSILE_ARM) return false;
    for (let i = 0; i < this.players.length; i++) {
      const q = this.players[i];
      if (q.team === g.team || !q.alive || q.spawnProtect > 0) continue;
      const fuse = q.ps.perks.includes('coldblood') ? MISSILE_COLD_FUSE : MISSILE_FUSE;
      if (Math.hypot(q.ps.x - g.x, q.ps.z - g.z) <= fuse) { this._missileBlast(g, g.x, g.z); return true; }
    }
    return false;
  }

  // Goes off on the next strike step, through the same blast code as the Airstrike: cover, Flak, mines, sentries.
  _missileBlast(g, x, z) {
    this.strikes.push({ kind: g.kind, team: g.team, by: g.owner, x, z, at: this.time,
      radius: g.kind === 'swarm' ? SWARM_RADIUS : MISSILE_RADIUS, damage: g.kind === 'swarm' ? SWARM_DAMAGE : MISSILE_DAMAGE });
  }

  _launchSwarm(p) {
    const life = SWARM_LIFE * this._engineerMult(p, ENGINEER_AIR);
    for (let i = 0; i < SWARM_COUNT; i++) {
      const a = p.ps.aim + (i - 1) * 2.1;
      this.gunships.push({ kind: 'swarm', team: p.team, owner: p, x: p.ps.x + Math.cos(a) * 0.9, z: p.ps.z + Math.sin(a) * 0.9, aim: a,
        life, age: 0, target: null, retarget: i * 0.12, lead: i === 0, slot: i });
    }
    this._emit({ t: 'streak', id: p.id, kind: 'swarm', team: p.team, x: round2(p.ps.x), z: round2(p.ps.z) });
  }

  // Chases what the team can see, over rooftops; with nothing to chase it circles its owner. Returns true on the dive.
  _stepDrone(g) {
    g.age += STEP;
    g.retarget -= STEP;
    if (g.retarget <= 0) {
      g.retarget = SWARM_RETARGET;
      g.target = this._seekerMark(g.team, g.x, g.z, g.target,
        q => this.gunships.some(o => o !== g && o.kind === 'swarm' && o.owner === g.owner && o.target === q));
    }
    const q = g.target && g.target.alive ? g.target : null;
    let tx, tz;
    if (q) { tx = q.ps.x; tz = q.ps.z; }
    else {
      const o = g.owner, a = this.time * 1.3 + g.slot * 2.1;
      tx = (o.alive ? o.ps.x : g.x) + Math.cos(a) * SWARM_LOITER;
      tz = (o.alive ? o.ps.z : g.z) + Math.sin(a) * SWARM_LOITER;
    }
    const dx = tx - g.x, dz = tz - g.z, d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const m = Math.min(SWARM_SPEED * STEP, d);
      g.aim = Math.atan2(dz, dx);
      g.x = Math.max(0.5, Math.min(this.map.width - 0.5, g.x + dx / d * m));
      g.z = Math.max(0.5, Math.min(this.map.height - 0.5, g.z + dz / d * m));
    }
    if (q && g.age > 0.6 && d <= SWARM_DIVE) { this._missileBlast(g, g.x, g.z); return true; }
    return false;
  }

  // Juggernaut: armour on top of a full health bar, for the rest of this life.
  _suitUp(p) {
    p.armor = JUGG_ARMOR;
    p.hp = MAX_HP;
    this._emit({ t: 'streak', id: p.id, kind: 'juggernaut', team: p.team, x: round2(p.ps.x), z: round2(p.ps.z) });
  }

  // Armour takes damage before health; blasts wear it down faster. Returns what is left over for health.
  _soak(target, dmg, weapon, streak, equip) {
    const blast = (equip && EQUIPMENT[equip]?.blast) || BLAST_STREAKS.has(streak) || (!streak && !equip && WEAPONS[weapon]?.explosive);
    const k = blast ? JUGG_BLAST : 1;
    const taken = Math.min(target.armor, dmg * k);
    target.armor -= taken;
    this._soaked = taken > 0;
    if (target.armor < 0.5) {
      target.armor = 0;
      this._emit({ t: 'armor_break', id: target.id, x: round2(target.ps.x), z: round2(target.ps.z) });
    }
    return dmg - taken / k;
  }

  // A guest's decoded aircraft list also carries Juggernaut armour rows: those become each player's `armor`.
  _splitSuits(view) {
    const list = view.gunships, players = view.players;
    for (let i = 0; i < players.length; i++) players[i].armor = 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (g.kind !== 'juggernaut') { list[n++] = g; continue; }
      const v = players.find(q => q.id === g.owner);
      if (v) v.armor = Math.round(g.life);
    }
    list.length = n;
  }

  _onRoof(x, z) {
    const walls = this.map.walls, near = this._roofScratch = wallScratch(this.map, this._roofScratch);
    const n = wallsInBox(this.map, x, z, x, z, near);
    for (let k = 0; k < n; k++) {
      const w = walls[near[k]];
      if (w.blocksVision && x >= w.x && x <= w.x + w.w && z >= w.z && z <= w.z + w.d) return true;
    }
    return false;
  }

  // Centre of the densest enemy cluster, and a line direction along its long axis. Aimed at what the team can see; a
  // human with nothing in view still gets the old blind call on everyone (their tap, their score), a bot does not.
  _strikeTarget(p) {
    let pool = this._teamVisible(p.team);
    if (pool.length === 0 && !p.isBot) pool = this.players.filter(q => q.team !== p.team && q.alive);
    if (pool.length === 0) return null;
    let best = null, bestCount = 0;
    for (const a of pool) {
      let count = 0, sumX = 0, sumZ = 0;
      for (const b of pool) {
        if (Math.hypot(a.ps.x - b.ps.x, a.ps.z - b.ps.z) < 9) { count++; sumX += b.ps.x; sumZ += b.ps.z; }
      }
      if (count > bestCount) { bestCount = count; best = { x: sumX / count, z: sumZ / count }; }
    }
    if (!best) return null;
    let spreadX = 0, spreadZ = 0;
    for (const b of pool) {
      if (Math.hypot(b.ps.x - best.x, b.ps.z - best.z) > 9) continue;
      spreadX = Math.max(spreadX, Math.abs(b.ps.x - best.x));
      spreadZ = Math.max(spreadZ, Math.abs(b.ps.z - best.z));
    }
    best.dx = spreadX >= spreadZ ? 1 : 0;
    best.dz = spreadX >= spreadZ ? 0 : 1;
    return best;
  }

  _stepStrikes() {
    if (this.strikes.length === 0) return;
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      if (s.at > this.time) continue;
      this.strikes.splice(i, 1);
      this._emit({ t: 'explosion', x: round2(s.x), z: round2(s.z), radius: s.radius, by: s.by.id });
      if (s.kind === 'mortar' && this._onRoof(s.x, s.z)) continue;    // Spent on the roof.
      this.eq.setOffMines(s.x, s.z, s.radius);
      for (const q of this.players) {
        if (q.team === s.team || !q.alive) continue;
        const d = Math.hypot(q.ps.x - s.x, q.ps.z - s.z);
        if (d > s.radius) continue;
        // Hard cover protects: a building between you and the blast saves your life. So does an Aegis Dome.
        if (!hasLineOfSight(this.map, s.x, s.z, q.ps.x, q.ps.z)) continue;
        if (V9.domeCovers(this, q.ps.x, q.ps.z, q.team)) continue;
        const dmg = s.damage * (1 - 0.65 * (d / s.radius)) * flakMult(q.ps.perks);
        this._damage(q, s.by, dmg, s.by.ps.weapon, d, s.kind);
      }
      for (let k = this.turrets.length - 1; k >= 0; k--) {
        const t = this.turrets[k];
        if (t.team === s.team) continue;
        const d = Math.hypot(t.x - s.x, t.z - s.z);
        if (d <= s.radius && hasLineOfSight(this.map, s.x, s.z, t.x, t.z) && !V9.domeCovers(this, t.x, t.z, t.team)) this._hurtTurret(t, s.damage);
      }
    }
  }

  // A human disconnected. The slot is held for them, not given to a bot: the player leaves the field (not drawn, not
  // targetable, no respawn), keeps every stat, and the board shows them as reconnecting. humanRejoin gives it back;
  // after HOLD_OPEN_SECONDS it is `open` and claimOpenSlot hands it to a newcomer. Whatever they carried drops here.
  humanLeft(id) {
    const p = this.byId.get(id);
    if (!p || p.isBot || p.dummy || p.away) return;
    const wasAlive = p.alive;
    p.away = true;
    p.awayT = 0;
    p.open = false;
    p.alive = false;
    p.hp = 0;
    p.respawnT = 0;
    p.deadT = 0;
    p.wantRespawn = false;
    p.spawnProtect = 0;
    p.ackT = 0;
    p.ps.sprinting = false; p.ps.sliding = false; p.ps.vx = 0; p.ps.vz = 0;
    if (wasAlive) {
      // Not a death: no kill, no score. The modes only need to let go of a flag or the bomb, and notice the side's count.
      this.snd?.onKill(p);
      this.ctf?.onKill(p, null);
      this.rules?.onKill?.(p, null, { away: true });
    }
    this._emit({ t: 'away', id: p.id });
  }

  // Bots never carry the Golden Gun, not even one inheriting the slot of a human who had it: it becomes the Flicker.
  // The human gets it back with their own loadout when humanRejoin is handed it.
  _noGoldForBots(p) {
    const swap = l => (l && l.secondary === GOLDEN_ID ? { ...l, secondary: 'pistol' } : l);
    if (p.loadout.secondary === GOLDEN_ID) {
      p.loadout = swap(p.loadout);
      p.kits[1] = attachmentsFor(p.loadout, 'pistol');
      this._metaUntil = this.tick + 2;
    }
    p.pendingLoadout = swap(p.pendingLoadout);
    if (p.ps.secondary === GOLDEN_ID) armSecondary(p.ps, 'pistol');
  }

  // Slots held for someone who dropped (and, from older matches, slots a bot is holding). For matching a returning
  // player by name or id, and for the lobby list: `open` slots may go to anyone.
  rejoinSlots() {
    const out = [];
    for (const p of this.players) {
      if (p.away) out.push({ id: p.id, humanId: p.id, name: p.name, team: p.team, index: p.index, open: p.open, awayT: p.awayT });
      else if (p.isBot && !p.dummy && p.humanId !== null) out.push({ id: p.id, humanId: p.humanId, name: p.name, team: p.team, index: p.index, open: false, awayT: 0 });
    }
    return out;
  }

  // A newcomer takes an open slot: same seat (team, free-for-all colour), fresh stats under their own id and name.
  // The side with fewer players on the field gets them first. Returns what humanRejoin returns, or null when none is open.
  claimOpenSlot(id, name, loadout = null, info = null) {
    if (this.byId.has(id)) return null;
    const onField = t => this.players.reduce((n, q) => n + (q.team === t && !q.away && !q.dummy ? 1 : 0), 0);
    let best = null;
    for (const p of this.players) if (p.away && p.open && (!best || onField(p.team) < onField(best.team))) best = p;
    return best ? this.humanRejoin(best.index, { id, name, loadout, fresh: true, info }) : null;
  }

  // Wipes a slot's own record for a newcomer. Team scores keep what the slot earned before.
  _freshStats(p) {
    p.kills = 0; p.deaths = 0; p.assists = 0; p.head = 0; p.streak = 0; p.chain = 0; p.lastKillT = -99; p.lastKilledBy = null;
    p.plants = 0; p.defuses = 0; p.captures = 0; p.returns = 0; p.carrierKills = 0;
    p.score = createStreakState(p.loadout.streaks, STREAKS, p.loadout.perks);
    p.dmgBy.fill(0); p.dmgT.fill(-99);
    for (const q of this.players) { q.dmgBy[p.index] = 0; q.dmgT[p.index] = -99; if (q.lastKilledBy === p.id) q.lastKilledBy = null; }
  }

  // Gives a slot back from its bot to the human who dropped, with kills, score and streaks intact.
  // `slot` is the old player id, the slot's index, or a name. Trystero gives a rejoining peer a new id, so pass it
  // as `id`; the slot, and everything credited to it, moves to the new id.
  // Returns {index, id, oldId, x, z, aim, alive, hp}, or null when no such slot is waiting. Host only: the 'rejoin'
  // event it emits carries the change to guests, whose snapshot codec applies it with rebindPlayer().
  // A held slot (see humanLeft) comes back with its stats, or with none when `fresh` (a newcomer in an open slot). It
  // spawns at once, except in Search and Destroy, where it waits for the next round like anyone out of this one.
  // `info` rides along on the 'rejoin' event for the phones' rosters (badge, operator); the sim does not read it.
  humanRejoin(slot, { id = null, name = null, loadout = null, fresh = false, info = null } = {}) {
    const p = typeof slot === 'number' ? this.players[slot]
      : this.byId.get(slot) ?? this.players.find(q => (q.away || (q.isBot && q.humanId !== null)) && !q.dummy && (q.humanId === slot || q.name === slot));
    if (p?.away) return this._returnHeld(p, { id, name, loadout, fresh, info });
    if (!p || !p.isBot || p.dummy || p.humanId === null) return null;
    const oldId = p.id;
    this.rebindPlayer(oldId, id || p.id, name || p.name);
    p.isBot = false;
    p.bot = null;
    p.skill = null;
    p.humanId = null;
    if (loadout) this.setLoadout(p.id, loadout);
    p.ps.reloadT = 0; p.ps.reloadDur = 0; p.prevReload = false;
    this._metaUntil = this.tick + 2;
    const ps = p.ps;
    if (p.alive) {
      // The phone starts from this spot. A moment of protection, because the person holding it just got here.
      p.spawnProtect = Math.max(p.spawnProtect, SPAWN_PROTECT);
      p.ackX = ps.x; p.ackZ = ps.z; p.ackT = 1.5;
      this._emit({ t: 'spawn', id: p.id, x: round2(ps.x), z: round2(ps.z), aim: round2(ps.aim) });
    }
    this._emit({ t: 'rejoin', oldId, id: p.id, name: p.name });
    return { index: p.index, id: p.id, oldId, x: ps.x, z: ps.z, aim: ps.aim, alive: p.alive, hp: Math.max(0, Math.ceil(p.hp)) };
  }

  _returnHeld(p, { id, name, loadout, fresh, info }) {
    const oldId = p.id;
    if (id && id !== oldId && this.byId.has(id)) return null;
    this.rebindPlayer(oldId, id || oldId, name || p.name);
    p.away = false; p.open = false; p.awayT = 0;
    p.wantRespawn = false; p.deadT = 0; p.respawnT = 0;
    if (loadout) this.setLoadout(p.id, loadout);
    if (fresh) this._freshStats(p);
    this._metaUntil = this.tick + 2;
    this._emit({ t: 'rejoin', oldId, id: p.id, name: p.name, fresh: !!fresh, info: info ?? undefined });
    if (!this.snd && this.phase !== 'ended' && !this.rules?.holdDead?.(p)) this._respawn(p);
    const ps = p.ps;
    return { index: p.index, id: p.id, oldId, x: ps.x, z: ps.z, aim: ps.aim, alive: p.alive, hp: Math.max(0, Math.ceil(p.hp)) };
  }

  // Moves a slot to a new id and name. Host: called by humanRejoin. Guests: called when the 'rejoin' event arrives,
  // because their copy of this class is what turns snapshot rows into player ids.
  rebindPlayer(oldId, id, name) {
    const p = this.byId.get(oldId);
    if (!p) return false;
    if (name) p.name = name;
    if (id === oldId) return true;
    this.byId.delete(oldId);
    p.id = id;
    p.ps.id = id;
    this.byId.set(id, p);
    for (const q of this.players) if (q.lastKilledBy === oldId) q.lastKilledBy = id;
    if (this.lastKill) {
      if (this.lastKill.by === oldId) this.lastKill.by = id;
      if (this.lastKill.target === oldId) this.lastKill.target = id;
    }
    this.eq.rebindOwner(oldId, id);
    return true;
  }

  // ---- Host migration ----

  // Rebuilds a live host from a decoded snapshot, so the match continues where it left off: `view` is the newest
  // GameView from decodeSnapshot, `roster` the original roster in the same order, opts {map, seed, timeLimit,
  // scoreLimit, gone:[ids of humans now absent, e.g. the old host]}. Pass the match's own seed: hardpoint rotation
  // order comes from it. The returned sim has no pending events. Own stats are kept for every slot; what snapshots
  // do not hold (the holstered gun's ammo, assist credit, a strike already called) resets to defaults.
  static fromSnapshot(view, roster, opts = {}) {
    const seed = opts.seed ?? 1;
    const sim = new Sim({
      roster, map: opts.map ?? view.mapId, seed, mode: view.modeId ?? view.mode, mods: opts.mods ?? view.mods,
      scoreLimit: opts.scoreLimit ?? view.scoreLimit, timeLimit: opts.timeLimit,
    });
    sim.rng = mulberry32((seed ^ Math.round(view.t * 1000)) >>> 0);
    sim.events = [];
    sim.time = view.t;
    sim.tick = Math.round(view.t * SIM_HZ);
    sim._metaUntil = sim.tick + 2;
    sim.phase = view.phase;
    sim.phaseT = view.phase === 'warmup' ? Math.max(0.5, WARMUP - view.t) : 0;     // S&D restores its own freeze clock.
    sim.timeLeft = view.timeLeft;
    const copy = (from, to) => { for (let t = 0; t < to.length; t++) to[t] = from?.[t] ?? 0; };
    copy(view.scores, sim.scores);
    sim.winner = view.winner;
    copy(view.uav, sim.uav);
    copy(view.jam, sim.jam);
    copy(view.overwatchT, sim.overwatch);
    sim.lastKill = view.lastKill ? { ...view.lastKill } : null;
    sim.firstBlood = view.players.some(p => p.kills > 0);
    for (let i = 0; i < view.players.length && i < sim.players.length; i++) sim._restorePlayer(sim.players[i], view.players[i]);
    sim._restoreMode(view);
    sim._restoreStreaks(view);
    // Gun Game: everyone back on the rung their score says, with the ammo the snapshot had.
    if (sim.ladder) {
      for (const p of sim.players) {
        const ammo = p.ps.ammo[0];
        sim._setRung(p, sim.scores[p.team], false);
        if (p.alive) p.ps.ammo[0] = Math.min(ammo, p.ps.defs[0].magazine);
      }
    }
    sim.eq.restore(view.projectiles, view.smokes, id => sim.byId.get(id)?.team);
    sim._initBots();
    for (const id of opts.gone ?? []) sim.humanLeft(id);
    for (const p of sim.players) if (p.bot) p.bot.resumeFromMigration();
    return sim;
  }

  _restorePlayer(p, v) {
    if (p.id !== v.id) this.rebindPlayer(p.id, v.id, v.name);
    p.name = v.name;
    if (v.isBot && !p.isBot) { p.humanId = p.id; }      // Dropped earlier, and the bot had the slot already.
    p.isBot = !!v.isBot;
    // A held slot stays held on the new host, with as much of its clock as the snapshot carries.
    p.away = !!v.away; p.open = !!v.open; p.awayT = v.away ? (v.awayT ?? 0) : 0;
    p.skill = p.isBot ? (p.skill || v.skill || 'regular') : null;
    p.camo = v.camo;
    const ps = p.ps;
    ps.x = v.x; ps.z = v.z; ps.aim = v.aim; ps.vx = v.vx; ps.vz = v.vz;
    ps.camo = v.camo;
    ps.slot = v.weapon === ps.secondary ? 1 : 0;
    if (ps.slot === 0 && v.weapon !== ps.primary && WEAPONS[v.weapon]) ps.primary = v.weapon;
    ps.weapon = ps.slot === 0 ? ps.primary : ps.secondary;
    ps.ammo[ps.slot] = v.ammo; ps.reserve[ps.slot] = v.reserve;
    ps.reloadT = v.reloadT; ps.reloadDur = v.reloadDur;
    if (weaponDef(ps).shellReload && ps.reloadT > 0) ps.shellT = weaponDef(ps).reload;
    ps.adsT = v.adsT; ps.bloom = v.bloom;
    ps.sprinting = v.sprinting; ps.sliding = false; ps.firingT = v.firingT;
    ps.heat = v.heat; ps.overheated = v.overheated;
    if (v.overheated) ps.overheatT = v.heat * (weaponDef(ps, ps.primary).heat?.lockout ?? 2);
    ps.tacticalLeft = v.tacticalLeft; ps.lethalLeft = v.lethalLeft;
    if (v.tactical) ps.tactical = v.tactical;
    if (v.lethal) ps.lethal = v.lethal;
    p.hp = v.hp; p.alive = v.alive && !p.away; p.respawnT = v.respawnT;
    // Time dead is not in the snapshot: count from the death, as far as respawnT tells. A respawn request that was in
    // flight to the old host is sent again by the phone's death screen.
    p.deadT = p.alive ? 0 : Math.max(0, RESPAWN_TIME - v.respawnT); p.wantRespawn = false;
    if (p.isBot) this._noGoldForBots(p);
    p.spawnProtect = v.spawnProtect ? SPAWN_PROTECT * 0.5 : 0;
    p.kills = v.kills; p.deaths = v.deaths; p.assists = v.assists; p.head = v.head; p.streak = v.streak;
    const st = p.score;
    if (v.slots.some((s, k) => st.slots[k]?.kind !== s.kind)) setStreakKinds(st, v.slots.map(s => s.kind));
    st.score = v.score; st.capped = v.capped;
    v.slots.forEach((s, k) => { st.slots[k].held = s.held; st.slots[k].blocked = s.blocked; });
    for (let i = 0; i < HISTORY; i++) { p.hx[i] = ps.x; p.hz[i] = ps.z; p.hs[i] = 0; }
    p.prevReload = ps.reloadT > 0; p.prevWeapon = ps.weapon; p.prevSliding = false; p.prevOverheated = ps.overheated;
  }

  _restoreMode(view) {
    if (this.rules) { this.rules.restore(view); return; }
    if (this.ctf) { restoreCtf(this.ctf, view); return; }
    if (this.snd) {
      restoreSnd(this.snd, view);
      // Nobody with the bomb, or anybody back from the dead: the snapshot's own alive flags are the truth.
      this.lastKill = null;
      return;
    }
    const zoneOf = id => this.zones.find(z => z.id === id);
    if (this.mode === 'dom') {
      for (const v of view.points ?? []) {
        const z = zoneOf(v.id);
        if (z) { z.owner = v.owner; z.cap = v.capture; z.contested = v.contested; z.taken = [v.owner === 0, v.owner === 1]; }
      }
    } else if (this.mode === 'hard' && view.points?.length) {
      const v = view.points[0], z = zoneOf(v.id);
      if (z) {
        z.owner = v.owner; z.cap = v.capture; z.contested = v.contested;
        z.taken = [v.owner === 0, v.owner === 1];
        this.hardIdx = Math.max(0, this.hardOrder.indexOf(this.zones.indexOf(z)));
        this.points[0] = z;
        this.hardT = view.hardT || this.hardT;
      }
    } else if (this.mode === 'kc') {
      this.tags = (view.tags ?? []).map(t => ({ id: t.id, x: t.x, z: t.z, team: t.team, life: t.life ?? TAG_LIFE }));
      this.nextTagId = this.tags.reduce((m, t) => Math.max(m, t.id + 1), 1);
    }
  }

  _restoreStreaks(view) {
    this.turrets = (view.turrets ?? []).flatMap(t => {
      const owner = this.byId.get(t.owner);
      if (!owner) return [];
      return [{ id: t.id, kind: 'sentry', team: t.team, owner, x: t.x, z: t.z, aim: t.aim, hp: t.hp, maxHp: TURRET_HP, life: t.life ?? TURRET_LIFE, thinkT: 0, cooldown: 0.4, target: null }];
    });
    this.nextTurretId = this.turrets.reduce((m, t) => Math.max(m, t.id + 1), 1);
    this.gunships = (view.gunships ?? []).flatMap(g => {
      const owner = this.byId.get(g.owner);
      if (!owner) return [];
      const W = this.map.width, H = this.map.height;
      const angle = Math.atan2((g.z - H / 2) / (H * 0.38), (g.x - W / 2) / (W * 0.42));
      return [{ kind: g.kind ?? 'gunship', team: g.team, owner, x: g.x, z: g.z, aim: g.aim, life: g.life ?? GUNSHIP_LIFE, angle, dir: g.team === 0 ? 1 : -1,
        pause: 1, burstLeft: 0, cooldown: 0, target: null, aimX: 0, aimZ: 0, retarget: 0, age: 1, lead: g.kind === 'swarm' ? false : undefined, hpf: g.hpf }];
    });
    V9.restore(this, view);
    // One drone per swarm leads it for the airspace count (see _dropAir).
    for (const g of this.gunships) if (g.kind === 'swarm' && !this.gunships.some(o => o.kind === 'swarm' && o.owner === g.owner && o.lead)) g.lead = true;
    for (const v of view.players ?? []) { const p = this.byId.get(v.id); if (p) p.armor = v.armor ?? 0; }
  }

  // ---- Views and snapshots ----

  _playerView(p) {
    const ps = p.ps, st = p.score;
    return {
      id: p.id, name: p.name, team: p.team, isBot: p.isBot, skill: p.skill, dummy: p.dummy,
      x: ps.x, z: ps.z, aim: ps.aim, vx: ps.vx, vz: ps.vz,
      hp: Math.max(0, Math.ceil(p.hp)), alive: p.alive, respawnT: Math.max(0, p.respawnT), armor: Math.ceil(p.armor),
      weapon: ps.weapon, camo: p.camo, ammo: ps.ammo[ps.slot], reserve: ps.reserve[ps.slot],
      reloadT: ps.reloadT, reloadDur: ps.reloadDur, adsT: ps.adsT,
      sprinting: ps.sprinting, sliding: ps.sliding, spawnProtect: p.spawnProtect > 0,
      kills: p.kills, deaths: p.deaths, assists: p.assists, head: p.head, streak: p.streak,
      bloom: ps.bloom, score: st.score, capped: st.capped,
      slots: st.slots.map(s => ({ kind: s.kind, cost: s.cost, held: s.held, blocked: s.blocked, denied: this.streakDenied(p, s.kind) })),
      heat: ps.heat, overheated: ps.overheated, firingT: Math.max(this._firingReveal(ps), p.markT),
      tacticalLeft: ps.tacticalLeft, lethalLeft: ps.lethalLeft, tactical: ps.tactical, lethal: ps.lethal,
      ghost: ps.perks.includes('ghost'), quiet: ps.perks.includes('deadsilence'), jammedSelf: p.jamT > 0,
      pro: ps.perks.filter(id => ps.pro.includes(id)), card: p.card ?? null,
      attachments: this._heldKit(p, ps.weapon),
      plants: p.plants ?? 0, defuses: p.defuses ?? 0,
      captures: p.captures ?? 0, returns: p.returns ?? 0, carrierKills: p.carrierKills ?? 0,
      away: p.away, open: p.open, awayT: p.awayT,
    };
  }

  // Phantom (Ghost Pro): gunfire never shows on the enemy minimap. Marks from Tracker and the rest still do.
  _firingReveal(ps) { return hasPro(ps, 'ghost') ? 0 : ps.firingT; }

  // The kit on the gun a player is holding, for the gun model. Stable object per kit.
  _heldKit(p, weapon) {
    return weapon === p.loadout.primary ? p.kits[0] : weapon === p.loadout.secondary ? p.kits[1] : NO_ATTACHMENTS;
  }

  // Same, on a guest: the snapshot says which gun, and the meta block (once seen) says what is on it.
  _decodedKit(p, weapon) {
    if (weapon === p.loadout.secondary) return p.kits[1];
    if (p.kitBits >= 0 && p.kitWeapon !== weapon) { p.kits[0] = unpackKit(weapon, p.kitBits); p.kitWeapon = weapon; }
    return p.kits[0];
  }

  getView(localId) {
    const snd = this.snd ? this.snd.view() : null;
    const ctf = this.ctf ? this.ctf.view() : null;
    const points = this.points.map(z => this._pointView(z, z.owner, z.cap, z.contested));
    if (snd) points.snd = snd;
    if (ctf) points.ctf = ctf;
    // A rules module's state rides the point list too (see objOf in js/sim/rules.js), so interpolated views keep it.
    const obj = this.rules ? this.rules.view() : null;
    if (obj) points.obj = obj;
    const view = {
      t: this.time, phase: this.phase, snd, ctf, obj, mods: this.mods, timeLeft: this.timeLeft, mode: this.rules?.look ?? this.mode, modeId: this.modeId, scoreLimit: this.scoreLimit,
      mapId: this.map.id, theme: this.map.theme, range: this.range ? this.range.view() : null,
      tags: this.tags.map(t => ({ id: t.id, x: t.x, z: t.z, team: t.team, life: t.life })),
      points,
      hardT: this.mode === 'hard' ? this.hardT : 0,
      scores: this.scores.slice(), winner: this.winner, ffa: this.ffa,
      uav: this.uav.slice(),
      players: this.players.map(p => this._playerView(p)),
      projectiles: this.eq.projectiles.map(p => ({ id: p.id, kind: p.kind, x: p.x, z: p.z, y: p.y, owner: p.owner, vx: p.vx, vz: p.vz, age: p.age, grounded: p.grounded, stuck: p.stuck, attached: p.attached !== null })),
      smokes: this.eq.smokes.map(s => ({ id: s.id, x: s.x, z: s.z, r: s.r, age: s.t })),
      turrets: null, gunships: null, deploys: null, drones: null,      // Filled by V9.viewLists below.
      localId, lastKill: this.lastKill,
      jam: this.jam.slice(), overwatchT: this.overwatch.slice(),
    };
    V9.viewLists(this, view);
    return this._applyIntel(view);
  }

  // What the local player's radar actually shows. Done per viewer, so the HUD and renderer get the Jammer and Overwatch
  // for free: jammed means no UAV and no firing pings, Overwatch means Ghost does not hide anyone.
  _applyIntel(view) {
    const me = view.players.find(p => p.id === view.localId);
    view.jammed = false; view.overwatched = false;
    if (!me) return view;
    const team = me.team;
    if ((view.jam[team] > 0 && !(view.overwatchT[team] > 0)) || me.jammedSelf) {
      view.jammed = true;
      view.uav = view.uav.slice();
      view.uav[team] = 0;
      for (let i = 0; i < view.players.length; i++) if (view.players[i].team !== team) view.players[i].firingT = 0;
    }
    if (view.overwatchT[team] > 0) {
      view.overwatched = true;
      for (let i = 0; i < view.players.length; i++) if (view.players[i].team !== team) view.players[i].ghost = false;
    }
    return view;
  }

  // capture: -1 (team 0) to +1 (team 1). Hardpoint has no bar to fill, so it reads -1, 0 or +1 for whoever holds it.
  _pointView(z, owner, cap, contested) {
    return { id: z.id, x: z.x, z: z.z, r: z.r, owner, capture: cap, contested };
  }

  // Header: [time cs, phase, timeLeft ds, score0, score1, winner(-1), uav0 ds, uav1 ds, lastKill|0, meta|0,
  // projectiles|0, smokes|0, turrets|0, gunships|0, objective|0, jam|0], then PLAYER_STRIDE numbers per player in roster
  // order. A free-for-all has a side per player: score0 is then the list of every player's score in roster order
  // (score1 0), uav0 the list of their UAV ds or 0 when none is up (uav1 0), and jam is [jam ds..., overwatch ds...]. meta is [camos, loadout ints, mode, scoreLimit]; it goes out on change and once a second. The entity
  // lists are flat. Objective block: kc [id*2+team, x, z, life ...] (ds of metres and seconds), dom [packed zone x3], hard [zone index,
  // packed zone, hardT ds]. Positions and radii of zones come from the map, which guests already have.
  encodeSnapshot() {
    const out = this.ffa ? this._ffaHead() : [
      Math.round(this.time * 100), PHASES.indexOf(this.phase), Math.round(this.timeLeft * 10),
      this.scores[0], this.scores[1], this.winner === null ? -1 : this.winner,
      Math.round(this.uav[0] * 10), Math.round(this.uav[1] * 10),
      0, 0, 0, 0, 0, 0, this._encodeObjective(),
      (this.jam[0] > 0 || this.jam[1] > 0 || this.overwatch[0] > 0 || this.overwatch[1] > 0 || V9.empLocked(this, 0) || V9.empLocked(this, 1))
        ? [Math.round(this.jam[0] * 10), Math.round(this.jam[1] * 10), Math.round(this.overwatch[0] * 10), Math.round(this.overwatch[1] * 10),
          ...this._lockDs()] : 0,
    ];
    const lk = this.lastKill;
    if (lk) {
      out[8] = [this.byId.get(lk.by).index, this.byId.get(lk.target).index, WEAPON_IDS.indexOf(lk.weapon),
        Math.round(lk.x * 10), Math.round(lk.z * 10)];
    }
    // Keyed to the tick, not to encode calls: the host encodes twice on some ticks, and the extra
    // local one must not swallow what guests need to receive.
    if (this.tick <= this._metaUntil || this.tick % 15 === 0) out[9] = this._encodeMeta();
    this._encodeEntities(out);
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i], ps = p.ps, st = p.score;
      let held = 0, blocked = 0, denied = 0;
      for (let k = 0; k < st.slots.length; k++) {
        if (st.slots[k].held) held |= 1 << k;
        if (st.slots[k].blocked) blocked |= 1 << k;
        denied |= (STREAK_DENY_REASONS.indexOf(this.streakDenied(p, st.slots[k].kind)) + 1) << (k * 3);   // V9: 3 bits a slot.
      }
      const flags = (p.alive ? 1 : 0) | (ps.sprinting ? 2 : 0) | (ps.sliding ? 4 : 0) | (p.spawnProtect > 0 ? 8 : 0)
        | (ps.perks.includes('ghost') ? 16 : 0) | (ps.overheated ? 32 : 0) | (st.capped ? 64 : 0) | (p.isBot ? 128 : 0)
        | (ps.perks.includes('deadsilence') ? 256 : 0) | (p.away ? 512 : 0) | (p.open ? 1024 : 0) | (p.jamT > 0 ? 2048 : 0);
      out.push(
        Math.round(ps.x * 50), Math.round(ps.z * 50), Math.round(ps.aim * 100),
        Math.round(ps.vx * 5), Math.round(ps.vz * 5),
        // A held slot has no respawn clock; the field carries how long it has been held, so a new host keeps counting.
        Math.max(0, Math.ceil(p.hp)), flags, Math.round(Math.max(0, p.away ? p.awayT : p.respawnT) * 10),
        WEAPON_IDS.indexOf(ps.weapon), ps.ammo[ps.slot], ps.reserve[ps.slot],
        Math.round(ps.reloadT * 10), Math.round(ps.reloadDur * 10),
        Math.round(ps.adsT * 20), Math.round(ps.bloom * 20),
        p.kills, p.deaths, p.assists, p.streak,
        st.score, held | (blocked << 3) | (ps.tacticalLeft << 6) | (ps.lethalLeft << 9) | (denied << 12),
        Math.round(ps.heat * 20), Math.round(Math.max(this._firingReveal(ps), p.markT) * 10), p.head,
      );
    }
    return (this._lastBroadcast = this._packPlayers(out));
  }

  // V9: the EMP streak lock, ds per side, on the end of the jam block (the jam block goes out when any is running).
  _lockDs() {
    const lock = this.v9.empLock;
    if (this.ffa) { const n = this.players.length; return lock ? lock.slice(FFA_TEAM, FFA_TEAM + n).map(v => Math.round(v * 10)) : new Array(n).fill(0); }
    return [Math.round((lock?.[0] ?? 0) * 10), Math.round((lock?.[1] ?? 0) * 10)];
  }

  // The free-for-all header: same slots, with per-player lists where team modes have a pair (see encodeSnapshot).
  _ffaHead() {
    const ds = v => Math.round(v * 10), n = this.players.length, side = a => a.slice(FFA_TEAM, FFA_TEAM + n);
    const radar = this.uav.some(v => v > 0) ? side(this.uav).map(ds) : 0;
    const locked = !!this.v9.empLock?.some(v => v > 0);
    const jams = this.jam.some(v => v > 0) || this.overwatch.some(v => v > 0) || locked ? [...side(this.jam), ...side(this.overwatch)].map(ds).concat(this._lockDs()) : 0;
    return [
      Math.round(this.time * 100), PHASES.indexOf(this.phase), Math.round(this.timeLeft * 10),
      side(this.scores), 0, this.winner === null ? -1 : this.winner,
      radar, 0, 0, 0, 0, 0, 0, 0, 0, jams,
    ];
  }

  // Per-team arrays back out of a header, team modes and free-for-all alike.
  _decodeHead(d, view) {
    const T = this.teamCount;
    if (!this.ffa) {
      view.scores = [d[3], d[4]];
      view.uav = [d[6] / 10, d[7] / 10];
      view.jam = d[15] ? [d[15][0] / 10, d[15][1] / 10] : [0, 0];
      view.overwatchT = d[15] ? [d[15][2] / 10, d[15][3] / 10] : [0, 0];
      view.empLock = d[15] && d[15].length > 4 ? [d[15][4] / 10, d[15][5] / 10] : [0, 0];
      return;
    }
    const n = this.players.length, side = (list, k = 1, at = 0) => {
      const out = new Array(T).fill(0);
      if (list) for (let i = 0; i < n; i++) out[FFA_TEAM + i] = (list[at + i] ?? 0) / k;
      return out;
    };
    view.scores = side(d[3]);
    view.uav = side(d[6] || null, 10);
    view.jam = side(d[15] || null, 10);
    view.overwatchT = side(d[15] || null, 10, n);
    view.empLock = side(d[15] && d[15].length > 2 * n ? d[15] : null, 10, 2 * n);
  }

  _encodeObjective() {
    if (this.rules) return this.rules.encode();
    if (this.snd) return this.snd.encode();
    if (this.ctf) return this.ctf.encode();
    if (this.mode === 'kc') {
      return this.tags.length ? this.tags.flatMap(t => [t.id * 2 + t.team, Math.round(t.x * 10), Math.round(t.z * 10), Math.round(t.life * 10)]) : 0;
    }
    if (this.mode === 'dom') return this.zones.length ? this.zones.map(packZone) : 0;
    if (this.mode === 'hard') return this.points.length ? [this.hardOrder[this.hardIdx], packZone(this.points[0]), Math.ceil(this.hardT * 10)] : 0;
    return 0;
  }

  _decodeObjective(a, out) {
    out.tags = []; out.points = []; out.hardT = 0;
    if (this.rules) { out.obj = out.points.obj = this.rules.decode(a || null, out); return; }
    if (this.mode === 'snd') {
      // The sites never change; the round state rides on the list as well as on the view (see sndOf in snd.js).
      out.points = this.zones.map(z => this._pointView(z, -1, 0, false));
      out.snd = out.points.snd = decodeSnd(this, a, out.players);
      return;
    }
    if (this.mode === 'ctf') {
      // The flags ride on the (empty) point list as well as on the view (see ctfOf in ctf.js).
      out.ctf = out.points.ctf = decodeCtf(this, a || null, out.players);
      return;
    }
    if (!a) return;
    if (this.mode === 'kc') {
      for (let i = 0; i < a.length; i += 4) out.tags.push({ id: a[i] >> 1, team: a[i] & 1, x: a[i + 1] / 10, z: a[i + 2] / 10, life: a[i + 3] / 10 });
    } else if (this.mode === 'dom') {
      for (let i = 0; i < a.length && i < this.zones.length; i++) out.points.push(this._unpackZone(this.zones[i], a[i]));
    } else if (this.mode === 'hard') {
      out.points.push(this._unpackZone(this.zones[a[0]], a[1]));
      out.hardT = a[2] / 10;
    }
  }

  _unpackZone(z, n) {
    return this._pointView(z, ((n >> 1) & 3) - 1, ((n >> 3) - 100) / 100, !!(n & 1));
  }

  _encodeMeta() {
    return [
      this.players.map(p => p.camo),
      // tactical 3 bits, lethal 3, three streaks at 4 each, three perks at 3 each (index within its tier), then one
      // Pro bit per perk tier.
      this.players.map(p => {
        let n = (TACTICAL_IDS.indexOf(p.ps.tactical) & 7) | ((LETHAL_IDS.indexOf(p.ps.lethal) & 7) << 3);   // High bits: last meta entry.
        p.score.slots.forEach((s, k) => { n |= (STREAK_IDS.indexOf(s.kind) & 15) << (6 + k * 4); });   // Fifth bit: last meta entry.
        for (let t = 0; t < 3; t++) n |= Math.max(0, PERKS_BY_TIER[t].indexOf(p.ps.perks[t])) << (18 + t * 3);
        for (let t = 0; t < 3; t++) if (hasPro(p.ps, p.ps.perks[t])) n |= 1 << (27 + t);
        return n;
      }),
      this.mode,
      this.scoreLimit,
      this.players.map(p => packKit(p.kits[0])),
      // V8: the fourth bit of the tactical (bit 0) and lethal (bit 1) index, which outgrew three bits.
      this.players.map(p => (TACTICAL_IDS.indexOf(p.ps.tactical) >> 3 & 1) | (LETHAL_IDS.indexOf(p.ps.lethal) >> 3 & 1) << 1),
      // V9: the fifth bit of each streak slot's index (one bit per slot), which outgrew four bits.
      this.players.map(p => p.score.slots.reduce((n, s, k) => n | ((STREAK_IDS.indexOf(s.kind) >> 4 & 1) << k), 0)),
    ];
  }

  _encodeEntities(out) {
    const P = this.eq.projectiles, S = this.eq.smokes, T = this.turrets, G = this.gunships;
    // Everything past the first few fields is only for host migration: enough to carry the object on.
    if (P.length) out[10] = P.flatMap(p => [p.id, PROJECTILE_KINDS.indexOf(p.kind), Math.round(p.x * 10), Math.round(p.z * 10), Math.round(p.y * 10),
      this.byId.get(p.owner)?.index ?? -1, Math.round(p.vx * 10), Math.round(p.vz * 10), Math.round(p.age * 30), (p.grounded ? 1 : 0) | (p.stuck ? 2 : 0) | (p.attached !== null ? 4 : 0)]);
    if (S.length) out[11] = S.flatMap(s => [s.id, Math.round(s.x * 10), Math.round(s.z * 10), Math.round(s.r * 10), Math.round(s.t * 10)]);
    // V9: turret rows carry their kind (sentry, rover, dome, crate), aircraft rows their health left in percent.
    if (T.length) out[12] = T.flatMap(V9.turretRow);
    if (G.length) out[13] = G.flatMap(g => V9.airRow(g, GUNSHIP_KINDS));
    // Juggernaut armour rides the same list as a 'juggernaut' row (life = armour), so the player record keeps its stride.
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!(p.armor > 0) || !p.alive) continue;
      if (!out[13]) out[13] = [];
      out[13].push(p.index, Math.round(p.ps.x * 10), Math.round(p.ps.z * 10), Math.round(p.ps.aim * 20), Math.ceil(p.armor) * 10, GUNSHIP_KINDS.indexOf('juggernaut'), 100);
    }
    // Plate Drop armour, the same way.
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!(p.plates > 0) || !p.alive) continue;
      if (!out[13]) out[13] = [];
      out[13].push(p.index, Math.round(p.ps.x * 10), Math.round(p.ps.z * 10), 0, Math.ceil(p.plates) * 10, GUNSHIP_KINDS.indexOf('plates'), 100);
    }
  }

  _decodeMeta(meta) {
    const [camos, ints, mode, scoreLimit, kits, eqHi, streakHi] = meta;
    this.mode = mode;
    if (scoreLimit) this.scoreLimit = scoreLimit;
    for (let i = 0; i < this.players.length && i < camos.length; i++) {
      const p = this.players[i], n = ints[i];
      p.camo = camos[i];
      const hi = eqHi?.[i] ?? 0;
      p.ps.tactical = TACTICAL_IDS[(n & 7) | (hi & 1) << 3] ?? p.ps.tactical;
      p.ps.lethal = LETHAL_IDS[((n >> 3) & 7) | (hi >> 1 & 1) << 3] ?? p.ps.lethal;
      const perks = [0, 1, 2].map(t => PERKS_BY_TIER[t][(n >> (18 + t * 3)) & 7] ?? p.ps.perks[t]);
      const repriced = perks.includes('hardline') !== p.ps.perks.includes('hardline');
      p.ps.perks = perks;
      p.ps.pro = perks.filter((id, t) => (n >> (27 + t)) & 1);
      const sHi = streakHi?.[i] ?? 0;
      const kinds = p.score.slots.map((s, k) => STREAK_IDS[((n >> (6 + k * 4)) & 15) | ((sHi >> k) & 1) << 4] ?? s.kind);
      if (repriced || kinds.some((kind, k) => kind !== p.score.slots[k].kind)) setStreakKinds(p.score, kinds, STREAKS, perks);
      // A guest's roster goes stale if someone changes loadout mid-match, and only the gun model cares.
      const bits = kits[i];
      if (bits !== p.kitBits) { p.kitBits = bits; p.kitWeapon = null; }
    }
  }

  decodeSnapshot(d, localId) {
    const HEAD = 16;
    d = this._unpackPlayers(d);
    if (d[9]) this._decodeMeta(d[9]);
    const players = new Array(this.players.length);
    for (let i = 0; i < this.players.length; i++) {
      const o = HEAD + i * PLAYER_STRIDE, r = this.players[i], flags = d[o + 6], bits = d[o + 20];
      const slots = r.score.slots.map((s, k) => ({
        kind: s.kind, cost: s.cost, held: !!(bits & (1 << k)), blocked: !!(bits & (8 << k)),
        denied: STREAK_DENY_REASONS[((bits >> (12 + k * 3)) & 7) - 1] ?? null,
      }));
      players[i] = {
        id: r.id, name: r.name, team: r.team, isBot: !!(flags & 128), skill: r.skill, dummy: r.dummy,
        x: d[o] / 50, z: d[o + 1] / 50, aim: d[o + 2] / 100,
        vx: d[o + 3] / 5, vz: d[o + 4] / 5,
        hp: d[o + 5], alive: !!(flags & 1), respawnT: flags & 512 ? 0 : d[o + 7] / 10,
        away: !!(flags & 512), open: !!(flags & 1024), awayT: flags & 512 ? d[o + 7] / 10 : 0,
        weapon: WEAPON_IDS[d[o + 8]], camo: r.camo, ammo: d[o + 9], reserve: d[o + 10],
        reloadT: d[o + 11] / 10, reloadDur: d[o + 12] / 10,
        adsT: d[o + 13] / 20, bloom: d[o + 14] / 20,
        sprinting: !!(flags & 2), sliding: !!(flags & 4), spawnProtect: !!(flags & 8),
        kills: d[o + 15], deaths: d[o + 16], assists: d[o + 17], streak: d[o + 18],
        score: d[o + 19], capped: !!(flags & 64), slots,
        tacticalLeft: (bits >> 6) & 7, lethalLeft: (bits >> 9) & 7,
        tactical: r.ps.tactical, lethal: r.ps.lethal,
        heat: d[o + 21] / 20, overheated: !!(flags & 32), firingT: d[o + 22] / 10, head: d[o + 23],
        ghost: !!(flags & 16), quiet: !!(flags & 256), jammedSelf: !!(flags & 2048),
        pro: r.ps.pro, card: r.card ?? null,
        attachments: this._decodedKit(r, WEAPON_IDS[d[o + 8]]),
      };
    }
    let lastKill = null;
    if (d[8]) {
      const [by, target, weapon, x, z] = d[8];
      lastKill = { by: this.players[by].id, target: this.players[target].id,
        weapon: WEAPON_IDS[weapon], camo: this.players[by].camo, x: x / 10, z: z / 10 };
    }
    const view = {
      t: d[0] / 100, phase: PHASES[d[1]], timeLeft: d[2] / 10, mode: this.rules?.look ?? this.mode, modeId: this.modeId, scoreLimit: this.scoreLimit, mods: this.mods,
      scores: null, winner: d[5] === -1 ? null : d[5], ffa: this.ffa,
      uav: null, players, localId, lastKill,
      mapId: this.map.id, theme: this.map.theme, range: this.range ? this.range.view() : null,
      projectiles: this._decodeList(d[10], 10, (a, i) => ({ id: a[i], kind: PROJECTILE_KINDS[a[i + 1]], x: a[i + 2] / 10, z: a[i + 3] / 10, y: a[i + 4] / 10,
        owner: this.players[a[i + 5]]?.id ?? null, vx: a[i + 6] / 10, vz: a[i + 7] / 10, age: a[i + 8] / 30, grounded: !!(a[i + 9] & 1), stuck: !!(a[i + 9] & 2), attached: !!(a[i + 9] & 4) })),
      smokes: this._decodeList(d[11], 5, (a, i) => ({ id: a[i], x: a[i + 1] / 10, z: a[i + 2] / 10, r: a[i + 3] / 10, age: a[i + 4] / 10 })),
      turrets: this._decodeList(d[12], V9.TURRET_STRIDE, (a, i) => ({ id: a[i], team: this.players[a[i + 1]].team, owner: this.players[a[i + 1]].id, x: a[i + 2] / 10, z: a[i + 3] / 10, aim: a[i + 4] / 20, hp: a[i + 5], life: a[i + 6] / 10, kind: V9.TURRET_KINDS[a[i + 7]] })),
      gunships: this._decodeList(d[13], V9.AIR_STRIDE, (a, i) => ({ kind: GUNSHIP_KINDS[a[i + 5]], team: this.players[a[i]].team, owner: this.players[a[i]].id, x: a[i + 1] / 10, z: a[i + 2] / 10, aim: a[i + 3] / 20, life: a[i + 4] / 10, hpf: a[i + 6] / 100 })),
      jam: null, overwatchT: null,
    };
    this._splitSuits(view);
    V9.splitView(view);
    this._decodeHead(d, view);
    this._decodeObjective(d[14], view);
    syncCover(this.map, view.projectiles);      // Bulwarks stand on a guest's map too: movement and shots collide with them.
    return this._applyIntel(view);
  }

  _decodeList(a, stride, read) {
    if (!a) return [];
    const out = new Array(a.length / stride);
    for (let i = 0; i < out.length; i++) out[i] = read(a, i * stride);
    return out;
  }

  // Snapshot interest management. Rewrites the flat PLAYER_STRIDE records after the header as, per player, a code
  // then fields: 0 = nothing (the guest keeps what it had), 1 = the fast fields, 3 = fast and slow fields, 2 = position
  // only (encodeSnapshotFor, big maps). A player far from every human, not firing and not just spawned or killed goes
  // out at half rate (7.5 Hz); the slow fields go out only when they change (for SLOW_REPEAT ticks) and in a rotation.
  // With 32 players this about halves a snapshot.
  _packPlayers(full) {
    const n = this.players.length, out = full.slice(0, SNAP_HEAD);
    const tick = this.tick, everything = tick <= this._metaUntil, halfRate = (tick % (SNAPSHOT_EVERY * 2)) >= SNAPSHOT_EVERY;
    const humans = this._humanScratch || (this._humanScratch = []);
    humans.length = 0;
    for (let i = 0; i < n; i++) { const q = this.players[i]; if (!q.isBot && !q.dummy && !q.away) humans.push(q); }
    // What each player got, kept with the records for encodeSnapshotFor.
    const codes = this._snapCodes && this._snapCodes.length === n ? this._snapCodes : (this._snapCodes = new Uint8Array(n));
    this._snapFull = full; this._snapTick = tick;
    for (let i = 0; i < n; i++) {
      const p = this.players[i], o = SNAP_HEAD + i * PLAYER_STRIDE;
      const sent = p.snapSlow || (p.snapSlow = new Float64Array(PLAYER_STRIDE).fill(NaN));
      let changed = false;
      for (let k = 0; k < SLOW_FIELDS.length; k++) {
        const f = SLOW_FIELDS[k];
        if (sent[f] !== full[o + f]) { sent[f] = full[o + f]; changed = true; }
      }
      if (changed) p.snapSlowUntil = tick + SLOW_REPEAT;
      const slow = everything || tick <= p.snapSlowUntil || ((tick >> 1) + i) % SLOW_ROTATE === 0;
      let skip = !everything && !slow && halfRate && humans.length > 0 && p.snapAlive === p.alive && !(full[o + 22] > 0);
      if (skip) {
        for (let h = 0; h < humans.length; h++) {
          const q = humans[h].ps;
          if (Math.abs(q.x - p.ps.x) < FAR_SEND && Math.abs(q.z - p.ps.z) < FAR_SEND) { skip = false; break; }
        }
      }
      if (skip) { out.push(0); codes[i] = 0; continue; }
      p.snapAlive = p.alive;
      out.push(slow ? 3 : 1);
      codes[i] = slow ? 3 : 1;
      for (let k = 0; k < PLAYER_STRIDE; k++) if (slow || !IS_SLOW[k]) out.push(full[o + k]);
    }
    return out;
  }

  // Interest management for big maps: this tick's snapshot as one guest needs it. Same format as encodeSnapshot, so
  // guests decode it as ever. Teammates, anyone near the guest, anyone firing or marked, and every enemy while the
  // guest's team runs a UAV go out as in the broadcast snapshot. Anyone else more than INTEREST_FAR metres away gets a
  // position-only record (code 2: position, aim, hp, flags) every INTEREST_EVERY-th snapshot and nothing in between.
  // Slow blocks always go out (their repeat and rotation assume every snapshot carries them). With interest off, or for
  // an id that is not a player, it is the broadcast snapshot.
  encodeSnapshotFor(guestId) {
    if (this._snapTick !== this.tick || !this._snapFull) this.encodeSnapshot();
    const g = this.byId.get(guestId);
    if (!this.interest || !g) return this._lastBroadcast;
    const full = this._snapFull, codes = this._snapCodes, n = this.players.length;
    const out = full.slice(0, SNAP_HEAD);
    const gx = g.ps.x, gz = g.ps.z, uav = this.uav[g.team] > 0, phase = this.tick >> 1;
    for (let i = 0; i < n; i++) {
      const p = this.players[i], o = SNAP_HEAD + i * PLAYER_STRIDE;
      let code = codes[i];
      if (code === 1 && p !== g && !(uav && p.team !== g.team) && !(full[o + 22] > 0)
        && (Math.abs(p.ps.x - gx) > INTEREST_FAR || Math.abs(p.ps.z - gz) > INTEREST_FAR)) code = (phase + i) % INTEREST_EVERY ? 0 : 2;
      out.push(code);
      if (code === 2) for (let k = 0; k < POS_FIELDS.length; k++) out.push(full[o + POS_FIELDS[k]]);
      else if (code) for (let k = 0; k < PLAYER_STRIDE; k++) if (code === 3 || !IS_SLOW[k]) out.push(full[o + k]);
    }
    return out;
  }

  // Interest management for big maps: the events one guest needs. Shots fired more than EVENT_FAR metres from the guest
  // by anyone not on their team are left out (nothing of them is on that guest's screen); every other event goes.
  eventsFor(guestId, events) {
    const g = this.byId.get(guestId);
    if (!this.interest || !g) return events;
    const out = [];
    for (const e of events) {
      if (e.t === 'shot' && Math.hypot(e.ox - g.ps.x, e.oz - g.ps.z) > EVENT_FAR && this.byId.get(e.by)?.team !== g.team) continue;
      out.push(e);
    }
    return out;
  }

  // Interest management on or off, whatever the map's size says.
  setInterest(on) { this.interest = !!on; }

  // The inverse, into a per-sim cache of each player's last known record. A player not yet heard from reads as dead,
  // so a guest that joins mid-match never draws someone at the map origin.
  _unpackPlayers(d) {
    const n = this.players.length;
    const cache = this._snapCache || (this._snapCache = this.players.map(() => new Float64Array(PLAYER_STRIDE)));
    const known = this._snapKnown || (this._snapKnown = new Uint8Array(n));
    const full = d.slice(0, SNAP_HEAD);
    let o = SNAP_HEAD;
    for (let i = 0; i < n; i++) {
      const code = d[o++], c = cache[i];
      if (code === 2) {
        for (let k = 0; k < POS_FIELDS.length; k++) c[POS_FIELDS[k]] = d[o++];
        c[3] = 0; c[4] = 0;               // No velocity sent: interpolation alone moves a far player.
        known[i] = 1;
      } else if (code) {
        for (let k = 0; k < PLAYER_STRIDE; k++) if (code === 3 || !IS_SLOW[k]) c[k] = d[o++];
        known[i] = 1;
      }
      for (let k = 0; k < PLAYER_STRIDE; k++) full.push(known[i] ? c[k] : (k === 6 ? 0 : c[k]));
    }
    return full;
  }
}
