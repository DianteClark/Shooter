// Bot brains. A bot only ever produces an Input and goes through stepPlayer like a human, so the
// weapon rules, sprint-to-fire and spread apply to it unchanged. It only knows what it could know:
// what it sees (cone + hasLineOfSight), what it hears, callouts from teammates, and UAV pings. The last three are
// never a position: each gives a rough area with an error radius, delayed and stale, that ages out.
// Enemy positions are read in exactly four places: _perceive (with the line-of-sight gate), onGunshot, onDamaged,
// and the radar sweep. Marks (Tracker, Sensor) are the same deal as the UAV: told to the team by a machine, with error,
// and only while they last. Nothing else may read ps.x of someone this bot cannot see.
//
// Thinking (perception, decisions) runs at 5-12 Hz, staggered across bots. Driving the stick, aim and
// trigger runs every tick, which is what keeps them looking fluid.

import { hasLineOfSight, raycastMap } from '../shared/geometry.js';
import { effectRadius, landingOf, maxThrowRange } from './equipment.js';
import { angleDiff, shotPassage, stepPlayer, weaponDef } from './player.js';
import { WEAPONS } from '../shared/weapons.js';
import { isAvailable } from '../shared/attachments.js';

const DEG = Math.PI / 180;

// aimError: sigma in radians at first sight. aimFloor: sigma once settled (never zero: no aimbots).
export const SKILLS = {
  recruit: {
    thinkHz: 5, reaction: [0.55, 0.95], aimError: 0.2, aimFloor: 0.085, settle: 1.15, turnRate: 5.5, lag: 0.26,
    fov: 110 * DEG, sight: 18, hearing: 7, hearErr: 1.4, notice: 0.5, memory: 1.2, close: 3,
    retreatHp: 0, strafe: 0.15, adsUse: 0.3, flank: 0.03, holdProb: 0.15, holdTime: [1, 2.5], slide: 0.02,
    arcTries: 0, sprint: 0.6, callouts: false, coverReload: 0.1, pistolSwap: false, fireTol: 0.15, burst: 0, streakDelay: 6,
    nade: 0.25, nadeCd: [14, 26], smoke: 0, flash: 0.1, stimHp: 22, heatStop: 1, heatResume: 0.2, heatSlip: 1, suppress: 3.5, turret: null,
    objPlay: 0.6, objDefend: 0, objSplit: 1, tagSight: 12, objPush: 0, objRotate: false,
  },
  regular: {
    thinkHz: 7, reaction: [0.36, 0.6], aimError: 0.13, aimFloor: 0.05, settle: 0.8, turnRate: 9, lag: 0.18,
    fov: 130 * DEG, sight: 22, hearing: 10, hearErr: 1.15, notice: 0.75, memory: 2, close: 4,
    retreatHp: 30, strafe: 0.5, adsUse: 0.65, flank: 0.12, holdProb: 0.33, holdTime: [1.5, 4], slide: 0.1,
    arcTries: 0, sprint: 0.9, callouts: false, coverReload: 0.5, pistolSwap: false, fireTol: 0.1, burst: 0.25, streakDelay: 3,
    nade: 0.5, nadeCd: [10, 18], smoke: 0.25, flash: 0.3, stimHp: 35, heatStop: 0.72, heatResume: 0.35, heatSlip: 0.22, suppress: 2.6, turret: 'cover',
    objPlay: 0.82, objDefend: 0.2, objSplit: 4, tagSight: 22, objPush: 0.3, objRotate: false,
  },
  veteran: {
    thinkHz: 9, reaction: [0.24, 0.38], aimError: 0.085, aimFloor: 0.03, settle: 0.55, turnRate: 13, lag: 0.13,
    fov: 160 * DEG, sight: 26, hearing: 13, hearErr: 1, notice: 0.92, memory: 3, close: 5,
    retreatHp: 42, strafe: 0.85, adsUse: 0.9, flank: 0.28, holdProb: 0.45, holdTime: [2, 5], slide: 0.3,
    arcTries: 2, sprint: 1, callouts: true, calloutDelay: 1.6, calloutErr: 4.5, coverReload: 0.9, pistolSwap: true, fireTol: 0.075, burst: 0.2, streakDelay: 1.5,
    nade: 0.75, nadeCd: [7, 13], smoke: 0.55, flash: 0.5, stimHp: 45, heatStop: 0.66, heatResume: 0.4, heatSlip: 0.1, suppress: 2, turret: 'shoot',
    objPlay: 0.95, objDefend: 0.3, objSplit: 7, tagSight: 32, objPush: 0.55, objRotate: true,
  },
  elite: {
    thinkHz: 12, reaction: [0.15, 0.25], aimError: 0.06, aimFloor: 0.018, settle: 0.4, turnRate: 18, lag: 0.09,
    fov: 190 * DEG, sight: 28, hearing: 16, hearErr: 0.85, notice: 0.98, memory: 4, close: 6,
    retreatHp: 55, strafe: 1, adsUse: 1, flank: 0.42, holdProb: 0.5, holdTime: [2, 5.5], slide: 0.5,
    arcTries: 4, sprint: 1, callouts: true, calloutDelay: 1, calloutErr: 3.2, coverReload: 1, pistolSwap: true, fireTol: 0.06, burst: 0.15, streakDelay: 0.6,
    nade: 0.9, nadeCd: [6, 11], smoke: 0.7, flash: 0.6, stimHp: 52, heatStop: 0.6, heatResume: 0.4, heatSlip: 0.05, suppress: 1.5, turret: 'shoot',
    objPlay: 1, objDefend: 0.4, objSplit: 10, tagSight: 46, objPush: 0.75, objRotate: true,
  },
};

// Preferred fighting distance per weapon, and how the weapon shifts the bot's playstyle, live in each gun's
// `botUse` (weapons.js): {pref, hold, flank, advance, rush?, scoped?, fireMax?, adsMin?}.
// `rush`: beyond this range the gun is not worth firing, so sprint the gap instead of plinking.
// STYLE holds overrides only, for a gun whose bot behaviour should differ from its data; empty today.
const STYLE = {};
const DEFAULT_STYLE = { pref: 15, hold: 1, flank: 1, advance: 3 };
function styleOf(id) { return STYLE[id] || (WEAPONS[id] && WEAPONS[id].botUse) || DEFAULT_STYLE; }
const ADS_RANGE = 12;           // botUse.adsMin applies past this distance, or always on a gun with an adsGate.
const PRECISE_BODY = 0.5;       // botUse.precise: metres either side of the target's centre the sights must be inside...
const PRECISE_SLOP = 0.25;      // ...plus this fraction of the tier's usual trigger tolerance (worse bots still jerk it).

// Fractions of the map width from the bot's own side, one per step of a lane advance.
const STAGES = [0.16, 0.36, 0.5, 0.64, 0.84];
const POS = { x: 0, z: 0 };
const TAU = Math.PI * 2;
const PATH_POINTS = 24;
const TURRET_THREAT = 21;
const STREAK_WAIT = 10;         // Seconds a bot will hold a streak looking for a good moment, before calling it anyway.
const SENSOR_RANGE = 15;        // Metres of throw a bot will spend finding someone it only half knows about.
const MINE_SPOT = 2.5;          // A mine goes this far in front of its owner.
const SUPPRESSED_HEARING = 0.4; // Fraction of the normal hearing range for a suppressed shot.
const HEAR_OCCLUDED = 0.6;      // Range left to hear a shot with a wall in the way.
const HEAR_GAP = 0.45;          // A bot takes in one gunshot at a time, so a long burst cannot average away the error.
const HEAR_ERR_BASE = 1;        // Metres of error for a sound right next to the bot, before distance adds to it.
const HEAR_ERR_PER_M = 0.35;
const HEAR_ERR_WALLED = 1.5;    // A sound through a wall is harder to place.
const SIGHT_KEEP = 0.9;         // A target drops out of the free tracking below this long after last being seen.
const AUDIBLE_SPEED = 2.2;      // Moving this fast is footsteps. Walking pace and up, matching the audio.
const ERR_PER_S = 1.3;          // Metres an estimate blurs per second of age.
const TOWARD_SEEN = 0.9;        // Fraction per second a stale noise estimate slides back to where the bot last saw someone.
const UAV_PING = 1;             // Seconds between UAV updates: it is a sweep, not a live feed.
const UAV_ERR = 1.6;
const NADE_MAX_ERR = 3.5;       // Won't spend a grenade on anything vaguer than this.
const CALLOUT_GAP = 1.5;        // Seconds before anyone calls out the same enemy again.
const CALLOUT_REACH = 28;       // Metres; nobody tells the whole map.
const DENY_REACH = 13;          // Metres a bot will go out of its way to deny its own team's tag.
const OBJ_CHASE = 9;            // How far a bot on an objective will leave it to run down a firm contact.
const HARD_LEAD = 8;            // Seconds before a rotation that bots who think ahead start for the next zone.
const OVERWATCH_MAX = 15;       // Furthest a supporting bot will stand from the edge of the zone it covers.

// Full kits per gun; a bot runs one of them, cut down for its tier. Slots listed in the order they are fitted,
// so a low tier keeps what matters most on that gun. Suppressors are listed third: veterans and elites only.
const BOT_KITS = {
  ar: [
    { barrel: 'compensator', optic: 'reflex', grip: 'vertical', mag: 'extmag' },
    { optic: 'longeye', barrel: 'longbarrel', mag: 'speedmag', grip: 'vertical' },
    { optic: 'holo', grip: 'angled', barrel: 'suppressor', mag: 'lightmag' },
  ],
  smg: [
    { optic: 'holo', grip: 'angled', mag: 'extmag', barrel: 'longbarrel' },
    { barrel: 'compensator', optic: 'reflex', mag: 'speedmag', grip: 'wrap' },
    { grip: 'angled', optic: 'holo', barrel: 'suppressor', mag: 'lightmag' },
  ],
  shotgun: [
    { barrel: 'choke', optic: 'holo', mag: 'extmag', grip: 'angled' },
    { barrel: 'sawnoff', grip: 'wrap', mag: 'speedmag', optic: 'reflex' },
  ],
  lmg: [
    { barrel: 'heatsink', optic: 'reflex', grip: 'brace', mag: 'speedmag' },
    { optic: 'longeye', barrel: 'compensator', grip: 'vertical', mag: 'extmag' },
    { barrel: 'longbarrel', optic: 'holo', grip: 'brace', mag: 'lightmag' },
  ],
  sniper: [
    { optic: 'snapsight', grip: 'angled', mag: 'speedmag', barrel: 'fluted' },
    { grip: 'wrap', mag: 'extmag', barrel: 'suppressor' },
  ],
  pistol: [
    { mag: 'extmag', barrel: 'compensator', optic: 'reflex', grip: 'wrap' },
  ],
  burst: [
    { barrel: 'compensator', optic: 'reflex', grip: 'vertical', mag: 'speedmag' },
    { optic: 'longeye', barrel: 'longbarrel', mag: 'extmag', grip: 'angled' },
  ],
  pdw: [
    { grip: 'vertical', barrel: 'compensator', mag: 'extmag', optic: 'holo' },
    { barrel: 'suppressor', grip: 'wrap', mag: 'lightmag', optic: 'reflex' },
  ],
  autoshot: [
    { barrel: 'choke', mag: 'extmag', optic: 'holo', grip: 'angled' },
    { grip: 'wrap', barrel: 'sawnoff', mag: 'speedmag', optic: 'reflex' },
  ],
  dmr: [
    { optic: 'reflex', grip: 'vertical', mag: 'extmag', barrel: 'longbarrel' },
    { optic: 'longeye', barrel: 'suppressor', mag: 'speedmag', grip: 'brace' },
  ],
};

// Sidearms bots carry, dealt in turn: each one equally often, so per-gun stats compare like with like.
const BOT_SECONDARIES = ['pistol', 'revolver', 'deuce', 'launcher', 'machpistol', 'thumper'];
export function botSecondary(i) { return BOT_SECONDARIES[i % BOT_SECONDARIES.length]; }
// A gun without its own kits borrows its category's base gun's, minus what it cannot take.
const KIT_FALLBACK = { Assault: 'ar', SMG: 'smg', Shotgun: 'shotgun', LMG: 'lmg', Marksman: 'dmr', Sniper: 'sniper', Pistol: 'pistol' };
const BOT_KIT_SLOTS = { recruit: 1, regular: 2, veteran: 3, elite: 4 };

// The kit a bot of this tier carries on this gun: recruits only sometimes have one attachment, elites a full kit.
export function botAttachments(weaponId, skill, i) {
  const kits = BOT_KITS[weaponId] || BOT_KITS[KIT_FALLBACK[WEAPONS[weaponId]?.category]];
  if (!kits || (skill === 'recruit' && i % 2 === 1)) return {};
  const kit = kits[i % kits.length];
  const keep = BOT_KIT_SLOTS[skill] ?? 2;
  const out = {};
  let n = 0;
  for (const slot in kit) {
    if (!isAvailable(weaponId, kit[slot])) continue;     // A borrowed kit keeps only what this gun can take.
    if (n++ >= keep) break;
    out[slot] = kit[slot];
  }
  return out;
}

// ---- Objective planning. Runs at 2 Hz for both teams; individual brains only act on what it hands them. ----

// Called by Sim while a non-TDM match is live.
export function planObjectives(sim) {
  for (let team = 0; team < 2; team++) {
    const crew = [];
    for (let i = 0; i < sim.players.length; i++) {
      const p = sim.players[i];
      if (!p.bot || p.team !== team || !p.alive) continue;
      // Some bots this life just want a fight; they stay on the lane logic.
      if (p.bot.objRoll < p.bot.S.objPlay) crew.push(p.bot);
      else p.bot.setObjective(null);
    }
    if (!crew.length) continue;
    if (sim.mode === 'kc') planTags(sim, team, crew);
    else if (sim.mode === 'dom') planDomination(sim, team, crew);
    else if (sim.mode === 'hard') planHardpoint(sim, team, crew);
  }
}

// One bot per tag, the closest that knows about it. Whoever is left over keeps fighting.
function planTags(sim, team, crew) {
  const pairs = [];
  for (let b = 0; b < crew.length; b++) {
    const bot = crew[b], ps = bot.ps;
    for (let t = 0; t < sim.tags.length; t++) {
      const tag = sim.tags[t], d = Math.hypot(tag.x - ps.x, tag.z - ps.z);
      const own = tag.team === team;
      // Confirming scores; denying only prevents, so nobody crosses the map for it.
      if (d > (own ? Math.min(bot.S.tagSight, DENY_REACH) : bot.S.tagSight)) continue;
      // A bot in a gunfight is the wrong one to send.
      pairs.push({ cost: d + (own ? 6 : 0) + (bot.targetVisible ? 8 : 0), bot, tag });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const busy = new Set(), taken = new Set();
  for (let i = 0; i < pairs.length; i++) {
    const { bot, tag } = pairs[i];
    if (busy.has(bot) || taken.has(tag)) continue;
    busy.add(bot); taken.add(tag);
    bot.setObjective({ key: `tag${tag.id}`, x: tag.x, z: tag.z, r: 0, role: 'collect' });
  }
  for (let i = 0; i < crew.length; i++) if (!busy.has(crew[i])) crew[i].setObjective(null);
}

function closestBot(free, x, z) {
  let best = null, bestD = Infinity;
  for (const bot of free) {
    const d = Math.hypot(bot.ps.x - x, bot.ps.z - z);
    if (d < bestD) { bestD = d; best = bot; }
  }
  return best;
}

function zoneObjective(z, role, tag = '') {
  return { key: `${z.id}${role}${tag}`, x: z.x, z: z.z, r: z.r, role };
}

// Defenders first (flags under attack, then a quota for calm ones), then everyone else attacks.
function planDomination(sim, team, crew) {
  const zones = sim.points;
  if (!zones.length) return;
  const free = new Set(crew);
  let quota = 0;
  for (let i = 0; i < crew.length; i++) quota += crew[i].S.objDefend;
  quota = Math.round(quota);

  const canDefend = new Set(crew.filter(b => b.S.objDefend > 0));
  const assignDefender = z => {
    const bot = closestBot(free.size < canDefend.size ? free : [...free].filter(b => canDefend.has(b)), z.x, z.z);
    if (!bot) return false;
    bot.setObjective(zoneObjective(z, 'defend'));
    free.delete(bot);
    return true;
  };

  const owned = zones.filter(z => z.owner === team);
  const targets = zones.filter(z => z.owner !== team);
  for (let i = 0; i < owned.length; i++) {
    const z = owned[i];
    if (!z.contested && Math.abs(z.cap) >= 0.97) continue;    // Under attack: two go, even past the quota.
    assignDefender(z); assignDefender(z);
    quota -= 2;
  }
  for (let i = 0; i < owned.length && quota > 0; i++) {
    const z = owned[i];
    if (z.contested || Math.abs(z.cap) < 0.97) continue;
    if (assignDefender(z)) quota--;
  }

  if (!targets.length) {
    // We hold everything: some keep the flags and the rest go hunting, which is what stops a spawn flip.
    let flip = 0;
    for (const bot of free) {
      if (flip++ % 2) bot.setObjective(null);
      else bot.setObjective(zoneObjective(owned[flip % owned.length], 'defend'));
    }
    return;
  }

  const load = new Map();
  for (const bot of free) {
    let best = targets[0], bestCost = Infinity;
    for (let i = 0; i < targets.length; i++) {
      const z = targets[i];
      const cost = Math.hypot(z.x - bot.ps.x, z.z - bot.ps.z) + (load.get(z) || 0) * bot.S.objSplit + (z.owner === 1 - team ? 5 : 0);
      if (cost < bestCost) { bestCost = cost; best = z; }
    }
    load.set(best, (load.get(best) || 0) + 1);
    bot.setObjective(zoneObjective(best, 'attack'));
  }
}

// Most bots go into the zone. Long guns cover it from outside, and bots who think ahead leave for the next one early.
function planHardpoint(sim, team, crew) {
  const z = sim.points[0];
  if (!z) return;
  const free = new Set(crew);
  if (sim.hardT <= HARD_LEAD && sim.zones.length > 1) {
    const next = sim.nextZone;
    let sent = 0;
    while (sent < 2) {
      const bot = closestBot([...free].filter(b => b.S.objRotate), next.x, next.z);
      if (!bot) break;
      bot.setObjective(zoneObjective(next, 'attack', 'next'));
      free.delete(bot);
      sent++;
    }
  }
  let support = 0;
  for (let i = 0; i < crew.length; i++) support += crew[i].S.objDefend;
  support = Math.min(2, Math.floor(support));
  const heavies = [...free].filter(b => b.S.objDefend > 0).sort((a, b) => b.style.hold - a.style.hold);
  for (let i = 0; i < heavies.length && support > 0; i++, support--) {
    heavies[i].setObjective(zoneObjective(z, 'support'));
    free.delete(heavies[i]);
  }
  for (const bot of free) bot.setObjective(zoneObjective(z, 'attack'));
}

function gaussian(rng) { return (rng() + rng() + rng() + rng() - 2) / 0.577; }
function between(rng, a, b) { return a + (b - a) * rng(); }

export class BotBrain {
  constructor(sim, player, staggerIndex) {
    this.sim = sim;
    this.p = player;
    this.ps = player.ps;
    this.S = SKILLS[player.skill] || SKILLS.regular;
    this.input = { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1 };
    this.interval = 1 / this.S.thinkHz;
    this.thinkT = this.interval * (staggerIndex % 11) / 11;
    this.path = new Float32Array(PATH_POINTS * 2);
    this.reset();
  }

  // Everything a fresh life forgets.
  reset() {
    const ps = this.ps;
    this.mode = 'none';
    this.laneIdx = -1;
    this.stage = 0;
    this.pathLen = 0; this.pathI = 0; this.pathDirty = false; this.arrived = false;
    this.goalX = ps.x; this.goalZ = ps.z;
    this.target = null; this.targetVisible = false; this.targetDist = 0;
    this.reactLeft = 0; this.trackT = 0; this.anchor = 0; this.anchorT = 0; this.wobble = this.sim.rng() * 6.28;
    this.useAds = false;
    this.knownX = 0; this.knownZ = 0; this.knownT = -99; this.hasKnown = false; this.knownSoft = false;
    this.knownErr = 0; this.knownBias = 0;
    this.heardT = -99; this.lastUavT = -99;
    this.calloutSeq = this.sim.calloutSeq ?? 0;       // Ignore anything called out before this life.
    this.holdT = 0; this.holdAim = 0; this.holdSpot = null; this.modeT = 0;
    this.strafeT = 0; this.strafeDir = 0;
    this.burstLeft = 0; this.burstPause = 0;
    this.wantSwap = false; this.wantSlide = false;
    this.stuckT = 0; this.stuckX = ps.x; this.stuckZ = ps.z; this.stuckN = 0; this.escapeT = 0; this.escapeX = 0; this.escapeZ = 0;
    this.sepX = 0; this.sepZ = 0;
    this.moveIntent = false;
    this.streakT = between(this.sim.rng, 0.2, this.S.streakDelay);
    this.streakWait = 0;
    this.nadeT = between(this.sim.rng, 2, 6);     // No grenades in the first seconds of a life: a spawn is not a fight.
    this.tacticalT = between(this.sim.rng, 1, 4);
    this.flashT = 0;
    this.heatCooling = false; this.heatStop = this.S.heatStop;
    this.sawT = -99; this.sawX = 0; this.sawZ = 0; this.suppressing = false;
    this.turretTarget = null;
    this.style = styleOf(ps.primary);
    this.peek = 0;
    this.objective = null; this.objKey = null; this.objAim = 0; this.objPushRoll = false;
    this.canHit = true;
    this.objRoll = this.sim.rng();                // Decided once a life, so a bot does not change its mind every plan.
    this._assignLane();
  }

  // Handed down by planObjectives; null means play the lanes. The same key keeps the bot on its current course.
  setObjective(o) {
    if (!o) {
      if (!this.objective) return;
      this.objective = null; this.objKey = null;
      if (this.mode === 'objective') this._setMode('none');
      return;
    }
    if (this.objective && this.objKey === o.key) return;
    this.objective = o; this.objKey = o.key;
    if (this.mode !== 'cover') this._setMode('none');
  }

  // After a host migration: the bot picks up the lane it is standing in instead of restarting from its spawn side.
  // It knows nothing about the enemy, which is honest: its old head was on the other phone.
  resumeFromMigration() {
    const { sim, p, ps } = this;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < sim.map.lanes.length; i++) {
      const d = Math.abs(sim.map.lanes[i].z - ps.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    this.laneIdx = best;
    const fromOwnSide = (p.team === 0 ? ps.x : sim.map.width - ps.x) / sim.map.width;
    this.stage = 0;
    while (this.stage < STAGES.length - 1 && STAGES[this.stage + 1] <= fromOwnSide) this.stage++;
    this._setMode('none');
    this.thinkT = this.interval * sim.rng();
    this.stuckX = ps.x; this.stuckZ = ps.z;
  }

  // ---- Knowledge ----

  // soft = shared information (callout, UAV): worth looking at, but only worth chasing if close.
  // err = radius in metres of where the enemy could actually be: 0 for a clean sighting.
  _note(x, z, soft = false, err = 0) {
    const { sim } = this;
    this.knownX = Math.max(0, Math.min(sim.map.width, x));
    this.knownZ = Math.max(0, Math.min(sim.map.height, z));
    this.knownT = sim.time; this.hasKnown = true; this.knownSoft = soft;
    this.knownErr = err;
    this.knownBias = (sim.rng() + sim.rng() - 1) * 0.7;    // Which side of the area this bot favours for this contact.
  }

  // A point chosen uniformly from a disc of radius r around (x, z).
  _rough(x, z, r, out) {
    const a = this.sim.rng() * TAU, k = Math.sqrt(this.sim.rng()) * r;
    out.x = x + Math.cos(a) * k;
    out.z = z + Math.sin(a) * k;
    return out;
  }

  // A shot within earshot gives a direction and a vague distance, never a position.
  onGunshot(shooter, suppressed = false) {
    const { S, ps, sim } = this, q = shooter.ps;
    if (this.targetVisible || sim.time - this.heardT < HEAR_GAP) return;
    const d = Math.hypot(q.x - ps.x, q.z - ps.z);
    let range = S.hearing * (suppressed ? SUPPRESSED_HEARING : 1);
    if (d > range) return;
    const walled = !hasLineOfSight(sim.map, ps.x, ps.z, q.x, q.z);
    if (walled && d > range * HEAR_OCCLUDED) return;
    this.heardT = sim.time;
    const err = (HEAR_ERR_BASE + d * HEAR_ERR_PER_M) * S.hearErr * (walled ? HEAR_ERR_WALLED : 1);
    this._rough(q.x, q.z, err, POS);
    this._note(POS.x, POS.z, false, err);
  }

  // A hit gives the direction it came from and a guess at the distance. Grenades and streaks say nothing about
  // who sent them: their "attacker" is whoever threw or called them, possibly the other side of the map.
  onDamaged(attacker, indirect = false) {
    const { sim, ps } = this, q = attacker.ps;
    this.recentlyHitT = sim.time;
    // Getting shot wakes you up: the next think is immediate, but reaction time still applies.
    this.thinkT = Math.min(this.thinkT, 0.05);
    if (indirect) return;
    const dx = q.x - ps.x, dz = q.z - ps.z, d = Math.max(0.5, Math.hypot(dx, dz));
    const bearing = Math.atan2(dz, dx) + (sim.rng() + sim.rng() - 1) * 0.28;
    const guess = d * (0.75 + 0.5 * sim.rng());
    this._note(ps.x + Math.cos(bearing) * guess, ps.z + Math.sin(bearing) * guess, false, 1 + d * 0.22);
  }

  // Forgets on schedule, and lets a stale noise drift back toward the last place it actually saw someone.
  // The estimate never moves toward where an enemy is now.
  _ageKnowledge() {
    const { sim, S } = this;
    if (!this.hasKnown) return;
    const age = sim.time - this.knownT;
    if (age > S.memory) { this.hasKnown = false; return; }
    if (this.knownErr > 0 && sim.time - this.sawT < S.memory) {
      const k = Math.min(1, TOWARD_SEEN * this.interval);
      this.knownX += (this.sawX - this.knownX) * k;
      this.knownZ += (this.sawZ - this.knownZ) * k;
    }
  }

  // Current radius of doubt about the contact, in metres. Grows until it is forgotten.
  get _knownBlur() {
    return this.knownErr + (this.sim.time - this.knownT) * ERR_PER_S;
  }

  onFlashed(dur) {
    this.flashT = Math.max(this.flashT, dur);
    this.target = null; this.targetVisible = false;
    this.turretTarget = null;
  }

  _perceive() {
    const { sim, p, ps, S } = this;
    if (this.flashT > 0) {
      // Blind: nothing new comes in, but what it already knew is still in its head.
      this.targetVisible = false;
      this._ageKnowledge();
      return;
    }
    let best = null, bestScore = Infinity, bestD = 0;
    const sameTarget = this.target;
    // Engagements stay on-screen distances; only a scoped rifle reaches further.
    const sightRange = styleOf(ps.weapon).pref >= 28 ? S.sight + 10 : S.sight;
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      if (q.team === p.team || !q.alive || q.spawnProtect > 0) continue;
      const dx = q.ps.x - ps.x, dz = q.ps.z - ps.z;
      const d = Math.hypot(dx, dz);
      if (d > sightRange) continue;
      // Keeping track of someone just seen needs no cone; it stops mattering the moment they have been gone a while.
      const tracking = q === sameTarget && sim.time - this.sawT < SIGHT_KEEP;
      // Someone within arm's reach is noticed without looking only if they make a noise doing it.
      const noisy = d <= S.close && ((Math.hypot(q.ps.vx, q.ps.vz) >= AUDIBLE_SPEED && !q.ps.perks.includes('deadsilence')) || q.ps.firingT > 0);
      const inCone = Math.abs(angleDiff(Math.atan2(dz, dx), ps.aim)) <= S.fov / 2;
      if (!tracking && !noisy && !inCone) continue;
      // Walls first, then the dice: nothing about a hidden enemy, not even whether a roll was made, reaches this bot.
      if (!hasLineOfSight(sim.map, ps.x, ps.z, q.ps.x, q.ps.z, sim.smokes)) continue;
      if (!tracking && !noisy && sim.rng() > S.notice) continue;      // Looking the right way is not the same as noticing.
      const score = d - (tracking ? 4 : 0) + q.hp * 0.03;
      if (score < bestScore) { bestScore = score; best = q; bestD = d; }
      if (S.callouts && sim.time - sim.calledAt[p.team][q.index] > CALLOUT_GAP) this._callOut(q);
    }

    if (best) {
      if (best !== this.target || !this.targetVisible) this._acquire(best, bestD);
      this.target = best; this.targetVisible = true; this.targetDist = bestD;
      this.sawT = sim.time; this.sawX = best.ps.x; this.sawZ = best.ps.z;
      this._note(best.ps.x, best.ps.z);
    } else {
      this.targetVisible = false;
      if (this.target && !this.target.alive) this.target = null;
    }

    // Shared info: never targets, only somewhere to look or go.
    if (!best) {
      if (sim.radarUp(p.team)) this._uavPing();
      else if (!this._markPing() && S.callouts) this._hearCallouts();
    }
    this._ageKnowledge();
    if (this.target && !this.targetVisible && sim.time - this.sawT > Math.max(S.memory, S.suppress)) this.target = null;
  }

  // The team's UAV. Sweeps once a second, so it shows where someone was a moment ago rather than where they are now.
  _uavPing() {
    const { sim, p, ps } = this;
    if (sim.time - this.lastUavT < UAV_PING) return;
    this.lastUavT = sim.time;
    let bestD = 30, near = null;
    const hidden = sim.overwatch[p.team] <= 0;     // Overwatch sees through Ghost.
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      if (q.team === p.team || !q.alive || q.dummy || (hidden && q.ps.perks.includes('ghost'))) continue;
      const d = Math.hypot(q.ps.x - ps.x, q.ps.z - ps.z);
      if (d < bestD) { bestD = d; near = q; }
    }
    if (near) this._note(near.ps.x, near.ps.z, true, UAV_ERR);
  }

  // Someone a teammate's Tracker or Sensor put on the map. Same treatment as a radar blip.
  _markPing() {
    const { sim, p, ps } = this;
    if (sim.time - this.lastUavT < UAV_PING) return false;
    let bestD = 24, near = null;
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      if (q.team === p.team || !q.alive || q.markT <= 0) continue;
      const d = Math.hypot(q.ps.x - ps.x, q.ps.z - ps.z);
      if (d < bestD) { bestD = d; near = q; }
    }
    if (!near) return false;
    this.lastUavT = sim.time;
    this._note(near.ps.x, near.ps.z, true, UAV_ERR);
    return true;
  }

  // Announced to the team: the spot and the moment, frozen. Teammates hear it later, and it never updates.
  _callOut(q) {
    const { sim, p } = this;
    sim.calledAt[p.team][q.index] = sim.time;
    sim.calloutSeq = (sim.calloutSeq ?? 0) + 1;
    sim.callouts.push({ seq: sim.calloutSeq, team: p.team, target: q.index, x: q.ps.x, z: q.ps.z, t: sim.time, by: p });
  }

  // Takes the nearest callout old enough to have reached this bot, and only ever from a teammate.
  _hearCallouts() {
    const { sim, p, ps, S } = this;
    let best = null, bestD = CALLOUT_REACH;
    for (let i = 0; i < sim.callouts.length; i++) {
      const c = sim.callouts[i];
      if (c.team !== p.team || c.by === p || c.seq <= this.calloutSeq || sim.time - c.t < S.calloutDelay) continue;
      const d = Math.hypot(c.x - ps.x, c.z - ps.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) return;
    this.calloutSeq = best.seq;
    this._rough(best.x, best.z, S.calloutErr, POS);
    this._note(POS.x, POS.z, true, S.calloutErr);
  }

  _acquire(q, d) {
    const { S, sim, ps } = this;
    this.reactLeft = between(sim.rng, S.reaction[0], S.reaction[1]);
    if (sim.time - (this.recentlyHitT ?? -9) < 0.5) this.reactLeft *= 0.7;  // Already alert.
    this.reactTotal = this.reactLeft;
    this.trackT = 0;
    this.anchor = gaussian(sim.rng);
    this.anchorT = 0.35;
    this.useAds = (sim.rng() < S.adsUse && d > 6) || !!styleOf(ps.weapon).scoped;
    this.objPushRoll = sim.rng() < S.objPush;
    this.slidIn = false;
    this.strafeT = 0;
    this.burstLeft = 0; this.burstPause = 0;
    // Good players slide into a fight they were sprinting toward.
    if (ps.sprinting && sim.rng() < S.slide * 1.5 && d > 5 && d < 20) this.wantSlide = true;
  }

  // ---- Decisions ----

  think() {
    const { sim, p, ps, S } = this;
    this._perceive();

    // Separation so teammates don't walk in single file or stack in a doorway.
    let sx = 0, sz = 0;
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      if (q === p || q.team !== p.team || !q.alive) continue;
      const dx = ps.x - q.ps.x, dz = ps.z - q.ps.z, dSq = dx * dx + dz * dz;
      if (dSq > 6.25 || dSq < 1e-4) continue;
      const k = (2.5 - Math.sqrt(dSq)) / 2.5 / Math.sqrt(dSq);
      sx += dx * k; sz += dz * k;
    }
    this.sepX = sx; this.sepZ = sz;

    const visible = this.targetVisible;
    const ammo = ps.ammo[ps.slot];
    // Being able to see someone over a crate is not the same as being able to shoot them through it.
    this.canHit = !visible || shotPassage(sim.map, ps.x, ps.z, this.target.ps.x, this.target.ps.z, weaponDef(ps)) > 0;

    // A belt-fed gun keeps hammering the spot where someone just ducked out of sight, which is what builds heat.
    this.suppressing = !visible && !!weaponDef(ps).heat && !ps.overheated && !!this.target && this.target.alive
      && sim.time - this.sawT < S.suppress && this.flashT <= 0
      && shotPassage(sim.map, ps.x, ps.z, this.sawX, this.sawZ, weaponDef(ps)) > 0;

    this._thinkStreaks(visible);
    this._thinkEquipment(visible);
    this._thinkTurrets(visible);

    // Burning ground is a problem you can see, whichever side lit it.
    if (this.mode !== 'cover') {
      const fire = sim.eq.inFire(ps.x, ps.z, p.team);
      if (fire) this._coverFrom(fire.x, fire.z);
    }

    // Retreat low, reload behind cover.
    if (this.mode === 'cover') {
      this.modeT -= this.interval;
      const healed = p.hp >= 82 && ps.reloadT <= 0;
      if (this.modeT <= 0 || healed || (this.arrived && visible && this.targetDist < 7)) this._setMode('none');
    } else if (S.retreatHp > 0 && p.hp < S.retreatHp && (visible || this.hasKnown) && p.hp < this.lastRetreatHp) {
      this._takeCover();
    } else if (visible && this.targetDist > 8 && (ammo === 0 || ps.reloadT > 0) && sim.rng() < S.coverReload) {
      this._takeCover();
    }
    this.lastRetreatHp = p.hp;

    // A shotgun has no business in the open at range: get behind something and let them come.
    if (visible && WEAPONS[ps.weapon].category === 'Shotgun' && this.targetDist > 10.5 && this.mode !== 'hold' && this.mode !== 'cover' && this.mode !== 'objective') {
      // Unless they are looking the other way, in which case this is exactly the moment to close.
      const t = this.target.ps;
      const facingUs = Math.abs(angleDiff(t.aim, Math.atan2(ps.z - t.z, ps.x - t.x))) < 0.9;
      if (facingUs || this.targetDist > 18) this._ambush();
    }

    // Pistol when the primary runs dry mid-fight; back to the main gun when it is over.
    if (S.pistolSwap && visible && ps.slot === 0 && (ammo === 0 || ps.overheated) && this.targetDist < 14) this.wantSwap = true;
    else if (!visible && ps.slot === 1 && ps.swapT <= 0 && !ps.overheated && (ps.ammo[0] > 0 || ps.reserve[0] > 0)) this.wantSwap = true;
    // A rocket opens a fight at range, once a life; the empty tube goes straight back on the shoulder.
    else if (S.pistolSwap && visible && ps.slot === 0 && WEAPONS[ps.secondary].explosive && ps.ammo[1] > 0 && this.targetDist > 8 && this.targetDist < Math.min(34, WEAPONS[ps.secondary].range - 2) && sim.rng() < 0.12) this.wantSwap = true;
    else if (visible && ps.slot === 1 && ps.ammo[1] === 0 && ps.swapT <= 0 && ps.ammo[0] > 0) this.wantSwap = true;

    if (visible) return;   // drive() fights; the strategic goal stays where it was.

    const o = this.objective;
    const knownD = this.hasKnown ? Math.hypot(this.knownX - ps.x, this.knownZ - ps.z) : Infinity;
    // A bot on an objective will not be pulled off it by a noise: only a firm contact nearby, and never once it is standing on the point.
    const worthChasing = this.hasKnown && (o
      ? !this.knownSoft && this.knownErr < 6 && knownD < OBJ_CHASE && !(this.mode === 'objective' && this.arrived)
      : !this.knownSoft || knownD < 14);
    if (worthChasing && this.mode !== 'cover' && this.mode !== 'hold' && this.mode !== 'hunt') {
      this._setMode('hunt');
      this.modeT = o ? 3 : 6;
      this._goTo(this.knownX, this.knownZ);
    }
    if (this.mode === 'hunt') {
      this.modeT -= this.interval;
      if (this.arrived || this.modeT <= 0 || !this.hasKnown) { this.hasKnown = false; this._setMode('none'); }
    }
    if (this.mode === 'hold') {
      if (this.arrived) this.holdT -= this.interval;
      if (this.holdT <= 0) this._setMode('none');
    }
    if (this.mode === 'advance' || this.mode === 'flank') {
      if (this.arrived) {
        if (this.mode === 'flank') this.stage = 2;   // Turn back in behind whoever is pushing.
        this._setMode('none');
      }
    }
    // Pushed off the point by a fight: walk back on.
    if (this.mode === 'objective' && this.arrived && o && !this._onObjective()) this._goObjective();
    if (this.mode === 'none') this._pickGoal();
  }

  _setMode(m) { this.mode = m; if (m === 'none') this.arrived = false; }

  // Uses a streak a moment after earning it. Recruits press whichever button lit up first; everyone else goes for the
  // dearest they hold, waits for a moment it is actually worth something, and a capped bot's spend resets its score.
  _thinkStreaks(visible) {
    const { sim, p, S } = this;
    const slots = p.score.slots;
    const smart = S.turret !== null;
    let found = false, spent = false;
    for (let n = 0; n < slots.length && !spent; n++) {
      const i = smart ? slots.length - 1 - n : n;
      const s = slots[i];
      if (!s.held) continue;
      found = true;
      this.streakT -= this.interval;
      if (this.streakT > 0) break;
      if (sim.streakDenied(p, s.kind)) continue;     // Blocked: keep it and try the next one down.
      if (smart && !this._streakMoment(s.kind, visible)) continue;
      spent = sim.useStreak(p.id, i) !== null;
    }
    if (!found) { this.streakWait = 0; return; }
    if (spent) { this.streakWait = 0; this.streakT = between(sim.rng, 0.3, S.streakDelay); }
    else if (this.streakT <= 0) this.streakWait += this.interval;
  }

  // Is now a good time for this streak? A bot that has been sitting on one long enough calls it anyway.
  _streakMoment(kind, visible) {
    const { sim, p, ps } = this;
    if (this.streakWait >= STREAK_WAIT) return true;
    const enemy = 1 - p.team;
    const busy = visible || this.hasKnown;
    switch (kind) {
      case 'uav':
      case 'overwatch': return !visible;
      case 'jammer': return sim.radarUp(enemy) || busy;
      case 'turret': return busy || this.mode === 'hold';
      case 'mortar':
      case 'strike': return busy;
      case 'resupply': return p.hp < 60 || ps.lethalLeft === 0 || ps.ammo[ps.slot] === 0;
      // Anything overhead is common knowledge; a sentry only counts once this bot has actually seen one.
      case 'emp': return sim.radarUp(enemy) || sim.gunships.some(g => g.team === enemy) || this.turretTarget !== null;
      default: return true;     // Chopper, gunship: they find their own work.
    }
  }

  // Where this throw would really end up, bounces and all, through the same code that flies it.
  // Returns null when there is no throw to make. The landing object is shared; copy what you keep.
  _landing(kind, aim, dist) {
    const { sim, ps } = this;
    return landingOf(sim.map, ps.x, ps.z, aim, Math.min(dist, maxThrowRange(ps.perks)), kind);
  }

  // Bots who have played this map before look for a line that gets there when the direct one comes up short:
  // banked off a wall, or lobbed past low cover. Tries a few angles around the target, nearest first.
  _bestThrow(kind, aim, tx, tz, radius) {
    const { ps, S } = this;
    const want = Math.hypot(tx - ps.x, tz - ps.z), reach = Math.min(want, maxThrowRange(ps.perks));
    const shots = S.arcTries ?? 0;
    let found = false, bestMiss = radius, bestAim = 0, bestX = 0, bestZ = 0;
    for (let i = 0; i <= shots; i++) {
      const a = aim + (i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.32);
      const land = this._landing(kind, a, want);
      if (!land) continue;
      const miss = Math.hypot(land.x - tx, land.z - tz);
      if (miss < bestMiss) { found = true; bestMiss = miss; bestAim = a; bestX = land.x; bestZ = land.z; }
    }
    return found ? { x: bestX, z: bestZ, aim: bestAim, miss: bestMiss, dist: reach } : null;
  }

  _throw(slot, aim, dist) {
    const { sim, p, ps } = this;
    sim.applyCommand(p.id, { cmd: 'throw', slot, ox: ps.x, oz: ps.z, aim, dist });
  }

  // Standing somewhere worth holding: on a point, or at a hold.
  get _dugIn() {
    return (this.mode === 'hold' || this.mode === 'objective') && this.arrived;
  }

  _thinkEquipment(visible) {
    const { sim, p, ps, S } = this;
    this.nadeT -= this.interval;
    this.tacticalT -= this.interval;
    if (this.flashT > 0 || ps.sliding) return;

    if (ps.tactical === 'stim' && ps.tacticalLeft > 0 && p.hp < S.stimHp && this.tacticalT <= 0) {
      this._throw('tactical', ps.aim, 0);
      this.tacticalT = 4;
      return;
    }

    // Things that are placed, not aimed: a Trophy and a Mine go down where the bot means to stay.
    if (this._dugIn) {
      if (ps.tactical === 'trophy' && ps.tacticalLeft > 0 && this.tacticalT <= 0) {
        if (sim.rng() < S.flash) this._throw('tactical', ps.aim, MINE_SPOT);
        this.tacticalT = between(sim.rng, 10, 18);
      }
      if (ps.lethal === 'mine' && ps.lethalLeft > 0 && this.nadeT <= 0) {
        if (sim.rng() < S.nade) this._throw('lethal', ps.aim, MINE_SPOT);
        this.nadeT = between(sim.rng, S.nadeCd[0], S.nadeCd[1]);
      }
    }

    // A vague contact is exactly when a Sensor earns its keep.
    if (ps.tactical === 'sensor' && ps.tacticalLeft > 0 && this.tacticalT <= 0 && !visible && this.hasKnown) {
      const dist = Math.hypot(this.knownX - ps.x, this.knownZ - ps.z);
      if (dist < SENSOR_RANGE && dist > 4) {
        if (sim.rng() < S.flash) this._throw('tactical', Math.atan2(this.knownZ - ps.z, this.knownX - ps.x), dist);
        this.tacticalT = between(sim.rng, 8, 14);
        return;
      }
    }

    // Everything else is thrown at someone. Only firm information counts: not a UAV blip, a callout or a vague noise.
    const fresh = this.hasKnown && !this.knownSoft && this.knownErr <= NADE_MAX_ERR && sim.time - this.knownT < 3;
    if (!visible && !fresh) return;
    const tx = visible ? this.target.ps.x : this.knownX, tz = visible ? this.target.ps.z : this.knownZ;
    const d = Math.hypot(tx - ps.x, tz - ps.z);
    const aim = Math.atan2(tz - ps.z, tx - ps.x) + gaussian(sim.rng) * S.aimFloor;

    // A Decoy does its job off to one side: the noise pulls attention away from where the bot is about to go.
    if (ps.tactical === 'decoy' && ps.tacticalLeft > 0 && this.tacticalT <= 0) {
      this.tacticalT = between(sim.rng, 9, 16);
      if (sim.rng() < S.flash) { this._throw('tactical', aim + (sim.rng() < 0.5 ? -1 : 1) * 1.1, 9); return; }
    }

    if (ps.lethal === 'hatchet') {
      // Thrown flat at someone it can see, inside the range it can actually hit from.
      if (this.nadeT <= 0 && ps.lethalLeft > 0 && visible && d < 11 && d > 2.5) {
        this.nadeT = between(sim.rng, S.nadeCd[0], S.nadeCd[1]);
        if (sim.rng() < S.nade) { this._throw('lethal', aim, d); return; }
      }
    } else if (ps.lethal !== 'mine' && this.nadeT <= 0 && ps.lethalLeft > 0 && d > 6) {
      const radius = effectRadius(ps.lethal);
      const land = this._bestThrow(ps.lethal, aim, tx, tz, radius * 0.7);
      if (land && Math.hypot(land.x - ps.x, land.z - ps.z) > 4 && !this._teammateNear(land.x, land.z, radius + 1)) {
        if (sim.rng() < S.nade) {
          this._throw('lethal', land.aim, land.dist);
          this.nadeT = between(sim.rng, S.nadeCd[0], S.nadeCd[1]);
          return;
        }
        this.nadeT = 2.5;   // Decided against it. Don't reconsider on the very next think.
      } else {
        this.nadeT = 0.5;   // No line right now. Looking again every think would just burn time.
      }
    }

    if (ps.tactical === 'flash' && visible && ps.tacticalLeft > 0 && this.tacticalT <= 0 && d > 7) {
      const land = this._bestThrow('flash', aim, tx, tz, 7);
      if (land && !this._teammateNear(land.x, land.z, 8)) {
        if (sim.rng() < S.flash) this._throw('tactical', land.aim, land.dist);
        this.tacticalT = between(sim.rng, 8, 15);
      }
    }
  }

  // Bots that know what a turret is either shoot it or get out of its line of fire.
  _thinkTurrets(visible) {
    const { sim, p, ps, S } = this;
    let tu = this.turretTarget;
    if (tu && (tu.hp <= 0 || !hasLineOfSight(sim.map, ps.x, ps.z, tu.x, tu.z, sim.smokes))) tu = this.turretTarget = null;
    if (!S.turret || this.flashT > 0) return;
    if (visible) { this.turretTarget = null; return; }

    let nearest = null, bestD = TURRET_THREAT;
    for (let i = 0; i < sim.turrets.length; i++) {
      const t = sim.turrets[i];
      if (t.team === p.team) continue;
      const d = Math.hypot(t.x - ps.x, t.z - ps.z);
      if (d < bestD && hasLineOfSight(sim.map, ps.x, ps.z, t.x, t.z, sim.smokes)) { bestD = d; nearest = t; }
    }
    if (!nearest) { this.turretTarget = null; return; }

    if (S.turret === 'shoot' && p.hp > 40 && ps.ammo[ps.slot] > 0) {
      if (this.turretTarget !== nearest) {
        this.reactLeft = between(sim.rng, S.reaction[0], S.reaction[1]);
        this.reactTotal = this.reactLeft;
        this.useAds = bestD > 6;
      }
      this.turretTarget = nearest;
    } else if (this.mode !== 'cover') {
      this.turretTarget = null;
      this._coverFrom(nearest.x, nearest.z);
    }
  }

  _takeCover() {
    const tx = this.target && this.targetVisible ? this.target.ps.x : this.knownX;
    const tz = this.target && this.targetVisible ? this.target.ps.z : this.knownZ;
    if (this._coverFrom(tx, tz)) this._maybeSmoke(tx, tz);
  }

  _coverFrom(tx, tz) {
    const { sim, ps } = this;
    const c = sim.nav.findCover(ps.x, ps.z, tx, tz, sim.rng);
    if (!c) return false;
    this.mode = 'cover';
    this.modeT = between(sim.rng, 4, 7);
    this._goTo(c.x, c.z);
    return true;
  }

  // Popping smoke on the way out covers a retreat. It lands short of the threat, between the two of them.
  _maybeSmoke(tx, tz) {
    const { sim, p, ps, S } = this;
    if (ps.tactical !== 'smoke' || ps.tacticalLeft <= 0 || this.tacticalT > 0 || !this.targetVisible || p.hp >= 60) return;
    if (Math.hypot(tx - ps.x, tz - ps.z) < 5) return;
    this.tacticalT = between(sim.rng, 8, 14);
    if (sim.rng() < S.smoke) this._throw('tactical', Math.atan2(tz - ps.z, tx - ps.x), Math.hypot(tx - ps.x, tz - ps.z) * 0.6);
  }

  _ambush() {
    const { sim, ps, S } = this;
    const t = this.target.ps;
    const c = sim.nav.findCover(ps.x, ps.z, t.x, t.z, sim.rng);
    if (!c) return;
    this.mode = 'hold';
    this.holdSpot = c;
    this.holdAim = Math.atan2(t.z - c.z, t.x - c.x);
    this.holdT = between(sim.rng, S.holdTime[0], S.holdTime[1]);
    this._goTo(c.x, c.z);
  }

  _assignLane() {
    const { sim, p } = this;
    const lanes = sim.map.lanes;
    const counts = [0, 0, 0];
    for (const q of sim.players) {
      if (q !== p && q.team === p.team && q.bot) counts[q.bot.laneIdx] = (counts[q.bot.laneIdx] || 0) + 1;
    }
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < lanes.length; i++) {
      const score = (counts[i] || 0) + sim.rng() * 1.4 + (i === this.laneIdx ? 0.6 : 0);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    this.laneIdx = best;
    this.stage = 0;
  }

  _laneGoal(stage) {
    const { sim, p } = this;
    const W = sim.map.width;
    const f = STAGES[Math.min(stage, STAGES.length - 1)];
    return {
      x: (p.team === 0 ? f : 1 - f) * W + (sim.rng() - 0.5) * 2,
      z: sim.map.lanes[this.laneIdx].z + (sim.rng() - 0.5) * 7,
    };
  }

  _onObjective() {
    const o = this.objective, ps = this.ps;
    if (!o) return false;
    if (o.role === 'collect') return true;      // Done when the tag goes; the next plan clears it.
    if (o.role === 'support') return Math.hypot(this.goalX - ps.x, this.goalZ - ps.z) < 2;
    return Math.hypot(o.x - ps.x, o.z - ps.z) <= o.r * 0.95;
  }

  _goObjective() {
    const { p, ps, sim } = this;
    const o = this.objective;
    this.mode = 'objective';
    this.peek = sim.rng() * TAU;
    if (o.role === 'collect') { this.objAim = ps.aim; this._goTo(o.x, o.z); return; }
    if (o.role === 'support' && this._overwatch(o)) return;
    // A spot inside the zone, spread out; anywhere on it counts and standing in a clump is how you lose it.
    let x = o.x, z = o.z, found = false;
    for (let i = 0; i < 12 && !found; i++) {
      const a = sim.rng() * TAU, r = o.r * (0.2 + 0.6 * sim.rng());
      x = o.x + Math.cos(a) * r; z = o.z + Math.sin(a) * r;
      found = sim.nav.isWalkable(x, z) && !this._teammateNear(x, z, 1.4);
    }
    // Look toward the enemy's half and sweep from there: holding a flag is mostly watching for who comes next.
    const enemyX = p.team === 0 ? sim.map.width : 0;
    this.objAim = Math.atan2(sim.map.height / 2 - z, enemyX - x);
    this._goTo(x, z);
  }

  // A long-sightline spot outside the zone that can see into it. False when there is none, and the bot just goes in.
  _overwatch(o) {
    const { sim, ps } = this;
    let best = null, bestScore = Infinity;
    for (const h of sim.nav.holds) {
      const toZone = Math.hypot(h.x - o.x, h.z - o.z);
      if (toZone < o.r + 1 || toZone > o.r + OVERWATCH_MAX) continue;
      if (this._teammateNear(h.x, h.z, 3) || !hasLineOfSight(sim.map, h.x, h.z, o.x, o.z)) continue;
      const score = Math.hypot(h.x - ps.x, h.z - ps.z) * 0.5 + toZone * 0.3 + sim.rng() * 4;
      if (score < bestScore) { bestScore = score; best = h; }
    }
    if (!best) return false;
    this.objAim = Math.atan2(o.z - best.z, o.x - best.x);
    this._goTo(best.x, best.z);
    return true;
  }

  _pickGoal() {
    const { sim, S, style } = this;
    if (this.objective) { this._goObjective(); return; }
    const r = sim.rng();
    if (r < S.flank * style.flank && this.stage >= 1) {
      // Rotate to a different lane and push past the fight.
      const prev = this.laneIdx;
      this.laneIdx = (prev + 1 + Math.floor(sim.rng() * 2)) % sim.map.lanes.length;
      const g = this._laneGoal(4);
      this.mode = 'flank';
      this._goTo(g.x, g.z);
      return;
    }
    if (r < S.flank * style.flank + S.holdProb * style.hold && this._goHold()) return;

    this.stage++;
    if (this.stage > style.advance + (S.flank > 0.2 ? 1 : 0)) this._assignLane(), this.stage = 1;
    const g = this._laneGoal(this.stage);
    this.mode = 'advance';
    this._goTo(g.x, g.z);
  }

  // Goes to a nearby spot with a good sightline and watches down it for a few seconds.
  _goHold() {
    const { sim, p, ps, S } = this;
    let best = null, bestScore = Infinity;
    const laneZ = sim.map.lanes[this.laneIdx].z;
    for (const h of sim.nav.holds) {
      const d = Math.hypot(h.x - ps.x, h.z - ps.z);
      if (d > 11 || h.sight[p.team] < 12) continue;
      if (Math.abs(h.z - laneZ) > 9) continue;    // Holding is part of playing this lane, not leaving it.
      if (this._teammateNear(h.x, h.z, 3)) continue;
      // Stay on our side of the action; a hold point deep in enemy ground is just a bad position.
      const depth = (p.team === 0 ? h.x : sim.map.width - h.x) / sim.map.width;
      const score = d * 0.5 - h.sight[p.team] * 0.25 + (depth > 0.72 ? 8 : 0) + sim.rng() * 6;
      if (score < bestScore) { bestScore = score; best = h; }
    }
    if (!best) return false;
    this.mode = 'hold';
    this.holdSpot = best;
    this.holdAim = best.aim[p.team];
    this.holdT = between(sim.rng, S.holdTime[0], S.holdTime[1]);
    this._goTo(best.x, best.z);
    return true;
  }

  _teammateNear(x, z, r) {
    const { sim, p } = this;
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      if (q === p || q.team !== p.team || !q.alive) continue;
      if (Math.hypot(q.ps.x - x, q.ps.z - z) < r) return true;
    }
    return false;
  }

  _goTo(x, z) {
    this.goalX = x; this.goalZ = z;
    this.arrived = false;
    this.pathDirty = true;
  }

  _solvePath() {
    const { sim, ps } = this;
    if (sim.pathBudget <= 0) return;
    sim.pathBudget--;
    this.pathDirty = false;
    // Recruits walk straight through a turret's field of fire; everyone else takes the long way round.
    this.pathLen = sim.nav.findPath(ps.x, ps.z, this.goalX, this.goalZ, this.path, PATH_POINTS, this.S.turret ? this.p.team : -1);
    this.pathI = 0;
    if (this.pathLen === 0) this.arrived = true;
  }

  // ---- Driving, every tick ----

  // Steers along the current path into (I.mx, I.mz). Returns true while still travelling.
  _followPath(sprintOk) {
    const { ps, path, input: I, S, sim } = this;
    if (this.arrived || this.pathLen === 0) return false;
    let wx = path[this.pathI * 2], wz = path[this.pathI * 2 + 1];
    let dx = wx - ps.x, dz = wz - ps.z, d = Math.hypot(dx, dz);
    if (d < 0.75) {
      this.pathI++;
      if (this.pathI >= this.pathLen) { this.arrived = true; return false; }
      wx = path[this.pathI * 2]; wz = path[this.pathI * 2 + 1];
      dx = wx - ps.x; dz = wz - ps.z; d = Math.hypot(dx, dz);
    }
    if (d < 1e-4) return true;
    I.mx = dx / d; I.mz = dz / d;
    // Only sprint when the road ahead is long enough to be worth it.
    let remaining = d;
    if (this.pathI + 1 < this.pathLen) remaining += 3;
    I.sprint = sprintOk && remaining > 3 && (S.sprint >= 1 || this.sprintRoll);
    // Occasional slides on a straight run read as a player having fun, and carry speed.
    if (I.sprint && remaining > 7 && sim.rng() < S.slide * sim.dt) this.wantSlide = true;
    return true;
  }

  _combatMove(q, d, dt) {
    const { ps, S, input: I, sim } = this;
    const style = styleOf(ps.weapon);
    const ux = (q.ps.x - ps.x) / d, uz = (q.ps.z - ps.z) / d;
    const o = this.objective;
    const holdingPoint = this.mode === 'objective' && this.arrived && o && (o.role === 'attack' || o.role === 'defend');
    const atHold = (this.mode === 'hold' && this.arrived) || holdingPoint;
    let fwd = 0;
    // A wall of crates between us that this gun cannot punch through: get an angle by closing in.
    if (!this.canHit && !holdingPoint) fwd = 1;
    else if (!atHold) {
      if (d > style.pref + 4) fwd = 1;
      else if (d < style.pref - 3 && style.pref >= 12) fwd = -0.85;
    }

    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = between(sim.rng, 0.3, 1.1);
      this.strafeDir = sim.rng() < S.strafe ? (sim.rng() < 0.5 ? -1 : 1) : 0;
    }

    let mx = ux * fwd - uz * this.strafeDir, mz = uz * fwd + ux * this.strafeDir;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    if (len > 0.01 && !sim.nav.isWalkable(ps.x + mx * 1.3, ps.z + mz * 1.3)) {
      this.strafeDir = -this.strafeDir;
      mx = ux * fwd - uz * this.strafeDir; mz = uz * fwd + ux * this.strafeDir;
      if (!sim.nav.isWalkable(ps.x + mx * 1.3, ps.z + mz * 1.3)) { mx = 0; mz = 0; }
    }
    // Strafe all it likes, but do not dance off the point it is holding.
    if (holdingPoint && Math.hypot(ps.x + mx * 1.3 - o.x, ps.z + mz * 1.3 - o.z) > o.r * 0.9) {
      this.strafeDir = -this.strafeDir;
      mx = 0; mz = 0;
    }
    I.mx = mx; I.mz = mz;
  }

  // (tx, tz) is where the round has to get to: the target, a turret, or a spot being suppressed.
  _trigger(q, d, perceived, dt, tx, tz) {
    const { ps, S, input: I, sim } = this;
    const w = weaponDef(ps), bu = styleOf(ps.weapon);
    const offAim = Math.abs(angleDiff(ps.aim, perceived));
    // Tolerance widens up close, where the target covers more of the view. A gun that kills in one or two rounds
    // (botUse.precise) waits for the sights to cross the body instead of firing whenever it is roughly on: the bot
    // aim error is the same for every gun, so without this a one-shot rifle wastes its bolt on near misses.
    const tol = bu.precise ? Math.atan2(PRECISE_BODY, Math.max(d, 1)) + S.fireTol * PRECISE_SLOP
      : S.fireTol + Math.atan2(0.5, Math.max(d, 1)) * 0.6;
    let fire = this.reactLeft <= 0 && offAim < tol && ps.swapT <= 0 && d <= w.range && ps.ammo[ps.slot] > 0;

    // Heat discipline: let go of the trigger before the bar fills. Sometimes a bot gets greedy and pays for it.
    if (w.heat) {
      if (ps.overheated) fire = false;
      else if (this.heatCooling) {
        if (ps.heat <= S.heatResume) this.heatCooling = false;
        else fire = false;
      } else if (fire && ps.heat >= this.heatStop) {
        fire = false;
        this.heatCooling = true;
        this.heatStop = sim.rng() < S.heatSlip ? 2 : S.heatStop + sim.rng() * 0.08;
      }
    }

    if (bu.adsMin && ps.adsT < bu.adsMin && (w.adsGate || d > ADS_RANGE)) fire = false;
    if (bu.fireMax && d > bu.fireMax) fire = false;

    // Burst control at range: real players stop to let the gun settle.
    if (fire && w.auto && !w.burst && S.burst > 0 && d > 18 && !w.heat) {
      if (this.burstPause > 0) { this.burstPause -= dt; fire = false; }
      else if (ps.shotIndex >= 5 + (this.burstLeft | 0)) {
        this.burstPause = between(sim.rng, 0.12, S.burst + 0.25);
        this.burstLeft = Math.floor(sim.rng() * 3);
        fire = false;
      }
    }

    // Last and only when everything else says go: can this gun's round actually get there? Seeing someone over a
    // crate is not the same as being able to shoot them through it (and cover right at the bot's own feet is fired
    // over, see traceShot). Semi-autos are simply held: every gun fires at its own cadence while the trigger is down.
    if (fire && shotPassage(sim.map, ps.x, ps.z, tx, tz, w) <= 0) fire = false;
    I.fire = fire;
  }

  drive(dt) {
    const { sim, p, ps, S, input: I } = this;
    I.mx = 0; I.mz = 0; I.sprint = false; I.aiming = false; I.fire = false;

    let desired = null;
    const q = this.target;
    const fighting = this.targetVisible && q && q.alive;

    const tu = this.turretTarget;
    if (!fighting && tu && tu.hp > 0) {
      const dx = tu.x - ps.x, dz = tu.z - ps.z;
      const d = Math.max(0.3, Math.hypot(dx, dz));
      const ang = Math.atan2(dz, dx);
      if (this.reactLeft > 0) this.reactLeft -= dt;
      desired = ang + S.aimFloor * Math.sin(this.wobble += dt * 3.1);
      this._trigger(null, d, ang, dt, tu.x, tu.z);
      I.aiming = this.useAds && this.reactLeft <= 0;
      this.moving = this._followPath(false);
    } else if (fighting) {
      sim.posAt(q, S.lag, POS);          // The bot aims at where it perceives the target, slightly old.
      const dx = POS.x - ps.x, dz = POS.z - ps.z;
      const d = Math.max(0.3, Math.hypot(dx, dz));
      const trueAng = Math.atan2(dz, dx);

      if (this.reactLeft > 0) this.reactLeft -= dt;
      this.trackT += dt;
      this.anchorT -= dt;
      if (this.anchorT <= 0) { this.anchorT = 0.35; this.anchor = gaussian(sim.rng); }
      this.wobble += dt * 3.1;

      const sigma = S.aimFloor + (S.aimError - S.aimFloor) * Math.exp(-this.trackT / S.settle);
      const err = sigma * (this.anchor * 0.85 + Math.sin(this.wobble) * 0.5);
      // Half way through the reaction window the head starts to come around.
      if (this.reactLeft < this.reactTotal * 0.55) desired = trueAng + err;

      const style = styleOf(ps.weapon);
      const rushing = style.rush && d > style.rush && this.mode !== 'cover' && this.mode !== 'hold';
      if (!rushing) this._trigger(q, d, trueAng, dt, q.ps.x, q.ps.z);
      const pushing = this.mode === 'objective' && !this.arrived && (d > style.pref || this.objPushRoll);
      if ((this.mode === 'cover' || this.mode === 'hold' || pushing) && !this.arrived) this._followPath(false);
      else this._combatMove(q, d, dt);
      if (rushing) {
        I.sprint = S.sprint >= 1 || this.sprintRoll;
      } else if (style.rush && !this.slidIn && ps.sprinting) {
        this.slidIn = true;       // Arrived in range at a sprint: slide in shooting.
        if (sim.rng() < S.slide * 2) this.wantSlide = true;
      }
      I.aiming = this.useAds && this.reactLeft <= 0 && !rushing;
      // Sprinters and rushers on a close weapon don't bother scoping in.
      if (style.rush && !style.scoped && d < style.pref + 1) I.aiming = false;
      else if (WEAPONS[ps.weapon].category === 'Shotgun' && this.reactLeft <= 0 && !rushing) I.aiming = true;
      // Don't sprint while fighting; left stick is already at walking pace.
    } else {
      this.moving = this._followPath(true);
      if (this.moving) I.sprint = I.sprint && !(this.mode === 'hunt' && S.sprint < 1);
      if (this.suppressing) {
        desired = Math.atan2(this.sawZ - ps.z, this.sawX - ps.x);
        this._trigger(null, Math.max(0.3, Math.hypot(this.sawX - ps.x, this.sawZ - ps.z)), desired, dt, this.sawX, this.sawZ);
        I.aiming = true; I.sprint = false;
      } else if (this.hasKnown) {
        // Checks the area the contact came from, sweeping across it. Never settles on a point it cannot have known.
        const dist = Math.max(1, Math.hypot(this.knownX - ps.x, this.knownZ - ps.z));
        const spread = Math.min(0.9, Math.atan2(Math.max(0.5, this._knownBlur), dist));
        this.peek += dt * 1.8;
        desired = Math.atan2(this.knownZ - ps.z, this.knownX - ps.x) + (Math.sin(this.peek) * 0.65 + this.knownBias) * spread;
        if (this.mode === 'hold' && this.arrived) I.aiming = true;
      } else if (this.mode === 'hold' && this.arrived) {
        this.peek += dt * 1.2;
        desired = this.holdAim + Math.sin(this.peek) * 0.28;
        I.aiming = !!styleOf(ps.weapon).scoped || S.adsUse > 0.8;
      } else if (this.mode === 'objective' && this.arrived) {
        this.peek += dt * 1.2;
        desired = this.objAim + Math.sin(this.peek) * 1.1;
        I.aiming = !!styleOf(ps.weapon).scoped || S.adsUse > 0.8;
      } else if (this.moving) {
        desired = Math.atan2(I.mz, I.mx);
      }
    }

    // Soft separation, only while walking the map.
    if (!fighting && this.moving && (this.sepX || this.sepZ)) {
      I.mx += this.sepX * 0.5; I.mz += this.sepZ * 0.5;
      const len = Math.hypot(I.mx, I.mz);
      if (len > 1) { I.mx /= len; I.mz /= len; }
    }

    if (this.escapeT > 0) {
      this.escapeT -= dt;
      I.mx = this.escapeX; I.mz = this.escapeZ; I.sprint = false;
    }

    // Turn rate cap plus easing: the aim travels, it never teleports.
    if (desired !== null) {
      const d = angleDiff(desired, ps.aim);
      const ease = d * Math.min(1, dt * 16);
      const lim = S.turnRate * dt;
      I.aim = ps.aim + Math.max(-lim, Math.min(lim, ease));
    } else {
      I.aim = ps.aim;
    }

    if (this.wantSwap) { I.swap = true; this.wantSwap = false; }
    if (this.wantSlide) { I.slide = true; this.wantSlide = false; }
  }

  _trackStuck(dt) {
    const { ps, sim } = this;
    this.stuckT += dt;
    if (this.stuckT < 0.8) return;
    const moved = Math.hypot(ps.x - this.stuckX, ps.z - this.stuckZ);
    const wanted = this.pathLen > 0 && !this.arrived && !this.targetVisible && this.mode !== 'none';
    this.stuckT = 0; this.stuckX = ps.x; this.stuckZ = ps.z;
    if (!wanted || moved > 0.5) { this.stuckN = 0; return; }
    this.stuckN++;
    this.pathDirty = true;
    if (this.stuckN >= 2) {
      // Repathing didn't help: wiggle free, then choose somewhere else entirely.
      const a = sim.rng() * Math.PI * 2;
      this.escapeX = Math.cos(a); this.escapeZ = Math.sin(a); this.escapeT = 0.4;
    }
    if (this.stuckN >= 4) { this.stuckN = 0; this._setMode('none'); this.hasKnown = false; }
  }

  update(dt) {
    const { sim, ps, input: I } = this;
    this.sprintRoll = true;
    if (this.flashT > 0) this.flashT -= dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT += this.interval;
      if (this.S.sprint < 1) this.sprintLucky = sim.rng() < this.S.sprint;
      this.think();
    }
    this.sprintRoll = this.sprintLucky !== false;
    if (this.pathDirty) this._solvePath();
    this.drive(dt);
    const shots = stepPlayer(ps, I, dt, sim.map, sim.rng);
    I.swap = false; I.slide = false;
    this._trackStuck(dt);
    return shots;
  }
}
