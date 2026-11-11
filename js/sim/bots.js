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

import { streakMoment, thinkAir, thinkStrikes } from './bot-streaks.js';
import { hasLineOfSight, raycastMap } from '../shared/geometry.js';
import { effectRadius, landingOf, maxThrowRange, EQUIPMENT, SHOOTABLE, tripBeam } from './equipment.js';
import { ADS_STICK_FULL, angleDiff, shotPassage, stepPlayer, weaponDef } from './player.js';
import { WEAPONS } from '../shared/weapons.js';
import { V10_BOT_SECONDARIES } from '../shared/weapons-v10.js';
import { isAvailable, availableFor } from '../shared/attachments.js';
import { SND } from '../shared/modes.js';

const DEG = Math.PI / 180;

// aimError: sigma in radians at first sight. aimFloor: sigma once settled (never zero: no aimbots).
// V10 fairness pass (dev/balance-sim.mjs --human, js/sim/humanlike.js): a thumb on the aim stick, with aim assist, wins
// about 85% of same-gun duels against a Recruit, 60% against a Regular and a third against a Veteran. Recruit and
// Regular are left as they were; Veteran reacts and settles a touch slower than before (it was 0.24-0.38 s, floor
// 0.03), because the default Mixed lobby is two Veterans and an Elite in every six and that is where a phone loses.
export const SKILLS = {
  recruit: {
    thinkHz: 5, reaction: [0.55, 0.95], aimError: 0.2, aimFloor: 0.085, settle: 1.15, turnRate: 5.5, lag: 0.26,
    fov: 110 * DEG, sight: 18, hearing: 7, hearErr: 1.4, notice: 0.5, memory: 1.2, close: 3,
    retreatHp: 0, strafe: 0.15, adsUse: 0.3, flank: 0.03, holdProb: 0.15, holdTime: [1, 2.5], slide: 0.02,
    arcTries: 0, sprint: 0.6, callouts: false, coverReload: 0.1, pistolSwap: false, fireTol: 0.15, burst: 0, streakDelay: 6,
    nade: 0.25, nadeCd: [14, 26], smoke: 0, flash: 0.1, stimHp: 22, heatStop: 1, heatResume: 0.2, heatSlip: 1, suppress: 3.5, turret: null,
    objPlay: 0.6, objDefend: 0, objSplit: 1, tagSight: 12, objPush: 0, objRotate: false, dodge: 0.3,
  },
  regular: {
    thinkHz: 7, reaction: [0.36, 0.6], aimError: 0.13, aimFloor: 0.05, settle: 0.8, turnRate: 9, lag: 0.18,
    fov: 130 * DEG, sight: 22, hearing: 10, hearErr: 1.15, notice: 0.75, memory: 2, close: 4,
    retreatHp: 30, strafe: 0.5, adsUse: 0.65, flank: 0.12, holdProb: 0.33, holdTime: [1.5, 4], slide: 0.1,
    arcTries: 0, sprint: 0.9, callouts: false, coverReload: 0.5, pistolSwap: false, fireTol: 0.1, burst: 0.25, streakDelay: 3,
    nade: 0.5, nadeCd: [10, 18], smoke: 0.25, flash: 0.3, stimHp: 35, heatStop: 0.72, heatResume: 0.35, heatSlip: 0.22, suppress: 2.6, turret: 'cover',
    objPlay: 0.82, objDefend: 0.2, objSplit: 4, tagSight: 22, objPush: 0.3, objRotate: false, dodge: 0.6,
  },
  veteran: {
    thinkHz: 9, reaction: [0.26, 0.42], aimError: 0.09, aimFloor: 0.036, settle: 0.6, turnRate: 13, lag: 0.14,
    fov: 160 * DEG, sight: 26, hearing: 13, hearErr: 1, notice: 0.92, memory: 3, close: 5,
    retreatHp: 42, strafe: 0.85, adsUse: 0.9, flank: 0.28, holdProb: 0.45, holdTime: [2, 5], slide: 0.3,
    arcTries: 2, sprint: 1, callouts: true, calloutDelay: 1.6, calloutErr: 4.5, coverReload: 0.9, pistolSwap: true, fireTol: 0.075, burst: 0.2, streakDelay: 1.5,
    nade: 0.75, nadeCd: [7, 13], smoke: 0.55, flash: 0.5, stimHp: 45, heatStop: 0.66, heatResume: 0.4, heatSlip: 0.1, suppress: 2, turret: 'shoot',
    objPlay: 0.95, objDefend: 0.3, objSplit: 7, tagSight: 32, objPush: 0.55, objRotate: true, dodge: 0.85,
  },
  elite: {
    thinkHz: 12, reaction: [0.15, 0.25], aimError: 0.06, aimFloor: 0.018, settle: 0.4, turnRate: 18, lag: 0.09,
    fov: 190 * DEG, sight: 28, hearing: 16, hearErr: 0.85, notice: 0.98, memory: 4, close: 6,
    retreatHp: 55, strafe: 1, adsUse: 1, flank: 0.42, holdProb: 0.5, holdTime: [2, 5.5], slide: 0.5,
    arcTries: 4, sprint: 1, callouts: true, calloutDelay: 1, calloutErr: 3.2, coverReload: 1, pistolSwap: true, fireTol: 0.06, burst: 0.15, streakDelay: 0.6,
    nade: 0.9, nadeCd: [6, 11], smoke: 0.7, flash: 0.6, stimHp: 52, heatStop: 0.6, heatResume: 0.4, heatSlip: 0.05, suppress: 1.5, turret: 'shoot',
    objPlay: 1, objDefend: 0.4, objSplit: 10, tagSight: 46, objPush: 0.75, objRotate: true, dodge: 0.95,
  },
};

// Preferred fighting distance per weapon, and how the weapon shifts the bot's playstyle, live in each gun's
// `botUse` (weapons.js): {pref, hold, flank, advance, rush?, scoped?, fireMax?, adsMin?}.
// `rush`: beyond this range the gun is not worth firing, so sprint the gap instead of plinking.
// V10, engagement distance by gun. Every bot fights at the distance its gun wants (pref), and what it does about
// being at the wrong one depends on the gun:
//   close guns (`rush` set: shotguns, SMGs, the pocket guns) do not cross open ground at someone who is looking at
//     them. Out of reach of a facing enemy they bound to cover that is nearer the target and out of its sight
//     (_closeIn), wait at the corner for it to come, and only charge the last few metres or a turned back. With no
//     cover to use they fall back to an ambush; an SMG that is being shot with nowhere to go shoots back (`plink`).
//     Between fights they keep to ground with short sight lines (_laneGoal, _goCorner) instead of holding a lane.
//   long guns (pref 18 and up) back away from anyone inside their distance, hold the long-sight spots (`hold`), push
//     fewer stages (`advance`), and see further down a scope (`sight`, metres added to the tier's sight range).
// STYLE holds overrides only, for a gun whose bot behaviour should differ from its data; empty today.
const STYLE = {};
const DEFAULT_STYLE = { pref: 15, hold: 1, flank: 1, advance: 3 };
// V11: with `ps`, the gun as fitted: a conversion kit can change how a bot should fight with it (a slug barrel on a pump).
function styleOf(id, ps) {
  const d = ps ? weaponDef(ps, id) : WEAPONS[id];
  return STYLE[id] || (d && d.botUse) || DEFAULT_STYLE;
}
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
const SHOCK_TARGETS = new Set(['mine', 'claymore', 'trophy', 'sensor', 'decoy', 'charge', 'tripwire', 'medpack']);   // Devices worth a Shock or Blackout.
// Gear wave. What a bot plants where it means to stay, and what it does about the other side's kit.
const PLACED_LETHALS = new Set(['mine', 'claymore', 'charge', 'tripwire']);
const PLACE_SPOT = { mine: MINE_SPOT, claymore: MINE_SPOT, charge: 6, tripwire: 3.5 };
const CHARGE_REACH = 4.2;       // An enemy this close to a bot's own armed Satchel is worth setting it off.
const RUN_FROM = new Set(['frag', 'sticky', 'cluster', 'bomblet', 'impact', 'drill', 'charge', 'crawler', 'molotov', 'thermite']);
const DODGE_SECS = 1.7;         // A fused grenade with more than this left is not yet worth running from.
const DEVICE_SEE = 14;          // Metres at which a bot notices an enemy device it has a line to.
const DANGER_DEVICES = new Set(['claymore', 'mine', 'tripwire', 'charge', 'crawler']);
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
const CLOSE_REACH = 15;         // Metres a close gun will run to the next piece of cover on its way in.
const CLOSE_GAIN = 1.5;         // ...which has to be at least this much nearer the target than where it stands.
const CLOSE_DASH = 2;           // Metres past `rush` that are simply charged, whoever is looking.
const CORNER_SIGHT = 15;        // A corner worth holding with a close gun sees no further than this on average.
const EXPOSE_RAYS = 12, EXPOSE_MAX = 30;
// Thinking budget on big maps (NavGrid.big): a bot with nothing near it thinks QUIET_SLOWDOWN times less often.
const QUIET_ENEMY = 75, QUIET_HUMAN = 100, QUIET_SLOWDOWN = 3;

// How open a spot is: the mean clear sight line from it, metres, capped at EXPOSE_MAX. A yard reads high, a doorway low.
function exposureAt(map, x, z) {
  let sum = 0;
  for (let i = 0; i < EXPOSE_RAYS; i++) {
    const a = (i / EXPOSE_RAYS) * TAU;
    const hit = raycastMap(map, x, z, Math.cos(a), Math.sin(a), EXPOSE_MAX, 'blocksVision');
    sum += hit ? hit.t : EXPOSE_MAX;
  }
  return sum / EXPOSE_RAYS;
}

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
const BOT_SECONDARIES = ['pistol', 'revolver', 'deuce', 'launcher', 'machpistol', 'thumper', 'scatter'];
BOT_SECONDARIES.push(...V10_BOT_SECONDARIES);
export function botSecondary(i) { return BOT_SECONDARIES[i % BOT_SECONDARIES.length]; }
// A gun without its own kits borrows its category's base gun's, minus what it cannot take.
const KIT_FALLBACK = { Assault: 'ar', SMG: 'smg', Shotgun: 'shotgun', LMG: 'lmg', Marksman: 'dmr', Sniper: 'sniper', Pistol: 'pistol' };
const BOT_KIT_SLOTS = { recruit: 1, regular: 2, veteran: 3, elite: 4 };

// The kit a bot of this tier carries on this gun: recruits only sometimes have one attachment, elites a full kit.
// V11: a bot that knows the gun uses what was made for it. Regulars fit the gun's first signature attachment on every
// other life of the deal (i), veterans always, elites every signature; a veteran or elite on one deal in three runs
// the gun's conversion kit instead (its `set.botUse` changes how the bot fights with it). The class kit fills the
// slots that are left, up to the tier's count, so a tier never carries more parts than before.
// opts.own false: class parts only, no signatures or kits (battle royale floor loot rolls those itself, by rarity).
export function botAttachments(weaponId, skill, i, { own: withOwn = true } = {}) {
  const own = withOwn ? availableFor(weaponId).filter(a => a.kind) : [];
  const sigs = own.filter(a => a.kind === 'sig'), conv = own.find(a => a.kind === 'kit');
  const kits = BOT_KITS[weaponId] || BOT_KITS[KIT_FALLBACK[WEAPONS[weaponId]?.category]];
  if (skill === 'recruit' && i % 2 === 1) return {};
  const keep = BOT_KIT_SLOTS[skill] ?? 2;
  const out = {};
  let n = 0;
  const fit = (slot, id) => { if (n < keep && !out[slot] && isAvailable(weaponId, id)) { out[slot] = id; n++; } };
  if (conv && (skill === 'veteran' || skill === 'elite') && i % 3 === 2) fit(conv.slot, conv.id);
  const nSig = skill === 'elite' ? sigs.length : skill === 'veteran' ? 1 : skill === 'regular' && i % 2 === 0 ? 1 : 0;
  for (const a of sigs.slice(0, nSig)) fit(a.slot, a.id);
  if (kits) {
    const kit = kits[i % kits.length];
    for (const slot in kit) fit(slot, kit[slot]);     // A borrowed kit keeps only what this gun can take.
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
      // Some bots this life just want a fight; they stay on the lane logic. A round of Search and Destroy needs everyone.
      // A flag carrier always plays the flag, whatever this life's roll said.
      if (p.bot.objRoll < p.bot.S.objPlay || sim.snd || sim.ctf?.isCarrier(p)) crew.push(p.bot);
      else p.bot.setObjective(null);
    }
    if (!crew.length) continue;
    if (sim.snd) { planSnd(sim, team, crew); continue; }
    if (sim.ctf) { planCtf(sim, team, crew); continue; }
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

// ---- Search and Destroy. The planner knows what each side would know: attackers always know where their bomb is;
// defenders only once it is dropped or planted, and where the attack is from what their own bots have seen or been
// told (sightings, callouts, being shot at). Each team keeps a little memory between plans in sim.snd.plan[team].

const SITE_HEAT = 18;            // Metres from a site within which a contact says "they are going there".
const INTEL_KEEP = 9;            // Seconds a defending team keeps acting on the last word about a site.
const ESCORT_LEAD = 5;           // Escorts walk this far ahead of the carrier, toward the site.
const FLEE_FUSE = 7;             // Seconds left on the fuse when anyone not defusing gets clear of the blast.

function sndPlan(sim, team) {
  const plans = sim.snd.plan ??= [{}, {}];
  const plan = plans[team];
  if (plan.round !== sim.snd.round) { plan.round = sim.snd.round; plan.site = Math.floor(sim.rng() * sim.snd.sites.length); plan.hot = -1; plan.hotT = -99; }
  return plan;
}

function nearestSite(sites, x, z, maxD = Infinity) {
  let best = -1, bestD = maxD;
  for (let i = 0; i < sites.length; i++) {
    const d = Math.hypot(sites[i].x - x, sites[i].z - z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// A walkable spot near (x, z), for objectives placed by arithmetic.
function walkable(sim, x, z) {
  if (sim.nav.isWalkable(x, z)) return { x, z };
  const k = sim.nav.nearestFree(x, z);
  return { x: k % sim.nav.w + 0.5, z: Math.floor(k / sim.nav.w) + 0.5 };
}

function planSnd(sim, team, crew) {
  const snd = sim.snd;
  if (snd.state !== 'live') return;
  const plan = sndPlan(sim, team), sites = snd.sites, bomb = snd.bomb;
  const attacking = team === snd.attackers;
  const order = crew.slice().sort((a, b) => a.p.index - b.p.index);

  // A live bomb close to going off: everyone clear of it, apart from a defuser who will finish in time.
  if (bomb.state === 'planted' && bomb.fuse < FLEE_FUSE) {
    for (const bot of order) {
      const df = snd.defuse;
      if (!attacking && df.p === bot.p && SND.defuse - df.t < bomb.fuse - 0.2) { bot.setObjective({ key: 'defuse', x: bomb.x, z: bomb.z, r: SND.defuseReach * 0.6, role: 'defuse' }); continue; }
      const dx = bot.ps.x - bomb.x, dz = bot.ps.z - bomb.z, d = Math.max(0.5, Math.hypot(dx, dz));
      const away = walkable(sim, bomb.x + dx / d * (SND.blast + 6), bomb.z + dz / d * (SND.blast + 6));
      bot.setObjective({ key: 'flee', x: away.x, z: away.z, r: 2.5, role: 'attack' });
    }
    return;
  }

  if (attacking) {
    if (bomb.state === 'planted') {
      // Hold the bomb: overwatch spots that see it, or a ring around it.
      order.forEach((bot, i) => bot.setObjective({ key: `guard${i % 2}`, x: bomb.x, z: bomb.z, r: i % 2 ? 3 : 6, role: i % 2 ? 'defend' : 'support' }));
      return;
    }
    const carrier = bomb.state === 'carried' ? bomb.carrier : null;
    // A human with the bomb decides the site; the escort follows wherever they head.
    if (carrier && !carrier.bot) plan.site = nearestSite(sites, carrier.ps.x, carrier.ps.z);
    const site = sites[plan.site];
    let fetcher = null;
    if (bomb.state === 'dropped') {
      let bestD = Infinity;
      for (const bot of order) {
        const d = Math.hypot(bot.ps.x - bomb.x, bot.ps.z - bomb.z);
        if (d < bestD) { bestD = d; fetcher = bot; }
      }
      fetcher?.setObjective({ key: `bomb${Math.round(bomb.x)}_${Math.round(bomb.z)}`, x: bomb.x, z: bomb.z, r: 0, role: 'collect' });
    }
    const near = carrier && Math.hypot(carrier.ps.x - site.x, carrier.ps.z - site.z) < 14;
    let entry = 0;
    for (const bot of order) {
      if (bot === fetcher) continue;
      if (bot.p === carrier) { bot.setObjective({ key: `plant${site.id}`, x: site.x, z: site.z, r: site.r * 0.75, role: 'plant' }); continue; }
      // Better players clear the site ahead of the bomb; the rest walk it in.
      if (!carrier || near || (bot.S.objPush >= 0.5 && entry++ < 2)) {
        bot.setObjective({ key: `site${site.id}`, x: site.x, z: site.z, r: site.r + 4, role: 'attack' });
        continue;
      }
      const dx = site.x - carrier.ps.x, dz = site.z - carrier.ps.z, d = Math.max(0.5, Math.hypot(dx, dz));
      const at = walkable(sim, carrier.ps.x + dx / d * ESCORT_LEAD, carrier.ps.z + dz / d * ESCORT_LEAD);
      bot.setObjective({ key: `esc${Math.round(at.x / 6)}_${Math.round(at.z / 6)}`, x: at.x, z: at.z, r: 3.5, role: 'attack' });
    }
    return;
  }

  // Defending.
  if (bomb.state === 'planted') {
    // Retake: everyone converges on the bomb; whoever is closest defuses once nobody is shooting at them, or when it
    // cannot wait any longer.
    let defuser = null, bestD = Infinity;
    for (const bot of order) {
      const d = Math.hypot(bot.ps.x - bomb.x, bot.ps.z - bomb.z);
      if (d < bestD) { bestD = d; defuser = bot; }
    }
    for (const bot of order) {
      if (bot === defuser) {
        const quiet = !bot.targetVisible && sim.time - bot.sawT > 1.2 && sim.time - (bot.recentlyHitT ?? -9) > 1.5;
        const late = bomb.fuse < SND.defuse + 3;
        if (quiet || late || snd.defuse.p === bot.p) { bot.setObjective({ key: 'defuse', x: bomb.x, z: bomb.z, r: SND.defuseReach * 0.6, role: 'defuse' }); continue; }
      }
      bot.setObjective({ key: 'retake', x: bomb.x, z: bomb.z, r: 6, role: 'attack' });
    }
    return;
  }
  // Word about where the attack is going: what this team's bots see, have heard, or were told.
  const heat = [0, 0];
  for (const bot of order) {
    let x = null, z = null;
    if (bot.targetVisible && bot.target) { x = bot.target.ps.x; z = bot.target.ps.z; }
    else if (bot.hasKnown && !bot.knownSoft && sim.time - bot.knownT < 3) { x = bot.knownX; z = bot.knownZ; }
    if (x === null) continue;
    const s = nearestSite(sites, x, z, SITE_HEAT);
    if (s >= 0) heat[s]++;
  }
  for (const c of sim.callouts) {
    if (c.team !== team || sim.time - c.t > 4) continue;
    const s = nearestSite(sites, c.x, c.z, SITE_HEAT);
    if (s >= 0) heat[s] += 0.5;
  }
  if (bomb.state === 'dropped') { const s = nearestSite(sites, bomb.x, bomb.z, SITE_HEAT * 1.5); if (s >= 0) heat[s] += 2; }
  const hot = heat[0] > heat[1] ? 0 : heat[1] > heat[0] ? 1 : -1;
  if (hot >= 0) { plan.hot = hot; plan.hotT = sim.time; }
  else if (sim.time - plan.hotT > INTEL_KEEP) plan.hot = -1;
  // A split, one anchor per site; on word about a site the rest rotate to it, if they are the kind that rotates.
  order.forEach((bot, i) => {
    let s = i % sites.length;
    if (i >= sites.length && plan.hot >= 0 && bot.S.objRotate) s = plan.hot;
    const site = sites[s];
    bot.setObjective({ key: `def${site.id}`, x: site.x, z: site.z, r: site.r + 4, role: 'defend' });
  });
}

// ---- Capture the Flag. Both flags are public knowledge: where they stand, who carries one (the carrier shows on the
// enemy minimap) and where a dropped one lies. The planner deals out roles each plan, by tier:
//   runner    our carrier heads home, better tiers by the lane where the team has seen the fewest enemies lately;
//             with our own flag gone, they wait at home for it to come back
//   returner  the nearest one or two to our dropped flag touch it home
//   chaser    our flag is out: hunt the carrier. Veterans and elites all go and cut them off ahead; lower tiers send
//             the nearest one or two, straight at them
//   escort    veterans and elites walk ahead of our runner
//   defender  a quota from objDefend holds our flag (recruits never stay home)
//   attacker  everyone else goes for their flag: the nearest touches it, the rest crowd its base

const CTF_ESCORT_LEAD = 5;       // Metres ahead of the runner, toward home, that escorts walk.
const CTF_CUT = 7;               // Metres ahead of the enemy runner, toward their base, that a good chaser aims for.
const CTF_ROUTE_DONE = 7;        // A runner this close to its route's waypoint heads straight home.
const CTF_DANGER = 9;
const CTF_RUN_FIGHT = 9;         // A runner turns to fight only someone closer than this.            // Seconds a sighting keeps a lane marked as dangerous for a runner.

// Where a moving target is, rounded, so an objective key only changes when the target has moved a few metres.
const cell = (x, z, k = 5) => `${Math.round(x / k)}_${Math.round(z / k)}`;

function ctfPlan(sim, team) {
  const plans = sim.ctf.plan ??= [{ route: null, seen: [] }, { route: null, seen: [] }];
  return plans[team];
}

// Sightings this team's bots have made or been told about lately: the runner's map of where not to go.
function ctfDanger(sim, team, crew, plan) {
  const seen = plan.seen;
  for (let i = seen.length - 1; i >= 0; i--) if (sim.time - seen[i].t > CTF_DANGER) seen.splice(i, 1);
  for (const bot of crew) {
    if (bot.targetVisible && bot.target) seen.push({ x: bot.target.ps.x, z: bot.target.ps.z, t: sim.time });
    else if (bot.hasKnown && !bot.knownSoft && sim.time - bot.knownT < 2) seen.push({ x: bot.knownX, z: bot.knownZ, t: sim.time });
  }
  for (const c of sim.callouts) if (c.team === team && sim.time - c.t < 3) seen.push({ x: c.x, z: c.z, t: c.t });
  if (seen.length > 40) seen.splice(0, seen.length - 40);
  return seen;
}

// The runner's road home: a waypoint in the middle of the safest lane, then the flag. Recruits and regulars just take
// the shortest way; veterans and elites pick the lane with the fewest recent sightings between them and home.
function ctfRunObjective(sim, team, bot, plan, crew) {
  const ctf = sim.ctf, home = ctf.bases[team], ps = bot.ps;
  const direct = { key: 'run-home', x: home.x, z: home.z, r: 1.2, role: 'run', commit: true };
  const lanes = sim.map.lanes ?? [];
  if (!bot.S.objRotate || lanes.length < 2) return direct;
  let route = plan.route;
  if (!route || route.id !== bot.p.id) {
    const seen = ctfDanger(sim, team, crew, plan);
    const midX = (ps.x + home.x) / 2;
    let best = null, bestCost = Infinity;
    for (const lane of lanes) {
      let danger = 0;
      for (const s of seen) {
        // Only what lies between the runner and home counts.
        if ((s.x - home.x) * (ps.x - home.x) < 0 || Math.abs(s.x - home.x) > Math.abs(ps.x - home.x) + 4) continue;
        if (Math.abs(s.z - lane.z) < 7) danger++;
      }
      const at = walkable(sim, midX, lane.z);
      const cost = danger * 14 + Math.hypot(at.x - ps.x, at.z - ps.z) + Math.hypot(home.x - at.x, home.z - at.z) + sim.rng() * 4;
      if (cost < bestCost) { bestCost = cost; best = { id: bot.p.id, lane: lane.id ?? lane.z, x: at.x, z: at.z, done: false }; }
    }
    route = plan.route = best;
  }
  if (!route || route.done) return direct;
  // Past the waypoint (or closer to home than it already): straight home.
  if (Math.hypot(route.x - ps.x, route.z - ps.z) < CTF_ROUTE_DONE || Math.hypot(home.x - ps.x, home.z - ps.z) < Math.hypot(home.x - route.x, home.z - route.z)) {
    route.done = true;
    return direct;
  }
  return { key: `run-${route.lane}`, x: route.x, z: route.z, r: 2.5, role: 'run', commit: true };
}

function planCtf(sim, team, crew) {
  const ctf = sim.ctf, own = ctf.flags[team], foe = ctf.flags[1 - team];
  const home = ctf.bases[team], away = ctf.bases[1 - team];
  const plan = ctfPlan(sim, team);
  const free = new Set(crew.slice().sort((a, b) => a.p.index - b.p.index));
  const take = (bot, o) => { bot.setObjective(o); free.delete(bot); };
  const nearest = (x, z, pick = () => true) => closestBot([...free].filter(pick), x, z);

  // Our runner.
  const runner = foe.state === 'carried' ? foe.carrier : null;
  if (!runner || plan.route?.id !== runner.id) plan.route = null;
  if (runner?.bot && free.has(runner.bot)) {
    if (own.state === 'home') take(runner.bot, ctfRunObjective(sim, team, runner.bot, plan, crew));
    else take(runner.bot, { key: 'run-wait', x: home.x, z: home.z, r: 4, role: 'defend' });
  }

  // Our flag on the ground: the nearest go and touch it home; a good team sends a second.
  if (own.state === 'dropped') {
    const key = `ret${cell(own.x, own.z, 2)}`;
    const a = nearest(own.x, own.z);
    if (a) take(a, { key, x: own.x, z: own.z, r: 0, role: 'collect', commit: true });
    const b = nearest(own.x, own.z, q => q.S.objRotate);
    if (b) take(b, { key: `${key}b`, x: own.x, z: own.z, r: 0, role: 'collect' });
  }
  // Their flag on the ground: the nearest picks it up.
  if (foe.state === 'dropped') {
    const a = nearest(foe.x, foe.z);
    if (a) take(a, { key: `grab${cell(foe.x, foe.z, 2)}`, x: foe.x, z: foe.z, r: 0, role: 'collect', commit: true });
  }

  // Our flag in their hands: run the carrier down.
  if (own.state === 'carried' && own.carrier) {
    const c = own.carrier.ps;
    const dx = away.x - c.x, dz = away.z - c.z, d = Math.max(0.5, Math.hypot(dx, dz));
    const lead = Math.min(CTF_CUT, d);
    const cut = walkable(sim, c.x + dx / d * lead, c.z + dz / d * lead);
    let plain = 0;
    for (const bot of [...free].sort((a, b) => Math.hypot(a.ps.x - c.x, a.ps.z - c.z) - Math.hypot(b.ps.x - c.x, b.ps.z - c.z))) {
      if (bot.S.objRotate) {
        // Whoever is already behind the runner closes on them; whoever is ahead cuts the road home.
        const ahead = (bot.ps.x - c.x) * dx + (bot.ps.z - c.z) * dz > 0;
        const at = ahead ? cut : walkable(sim, c.x, c.z);
        take(bot, { key: `chase${ahead ? 'c' : 'r'}${cell(at.x, at.z)}`, x: at.x, z: at.z, r: 2, role: 'attack' });
      } else if (plain++ < 2) {
        take(bot, { key: `chase${cell(c.x, c.z)}`, x: c.x, z: c.z, r: 2.5, role: 'attack' });
      }
    }
  }

  // Escorts for our runner, from the tiers that think about it.
  if (runner && own.state === 'home') {
    const r = runner.ps, dx = home.x - r.x, dz = home.z - r.z, d = Math.max(0.5, Math.hypot(dx, dz));
    const at = walkable(sim, r.x + dx / d * Math.min(CTF_ESCORT_LEAD, d), r.z + dz / d * Math.min(CTF_ESCORT_LEAD, d));
    let n = 0;
    for (const bot of [...free]) {
      if (bot.S.objPush < 0.5 || n >= 2) continue;
      take(bot, { key: `esc${cell(at.x, at.z, 6)}`, x: at.x, z: at.z, r: 3.5, role: 'attack' });
      n++;
    }
  }

  // Home guard. Recruits never stay back; better tiers keep one or two on the flag while it is home.
  if (own.state === 'home') {
    let quota = 0;
    for (const bot of crew) quota += bot.S.objDefend;
    quota = Math.min(2, Math.round(quota));
    while (quota-- > 0) {
      const bot = nearest(home.x, home.z, q => q.S.objDefend > 0);
      if (!bot) break;
      take(bot, { key: 'guard', x: home.x, z: home.z, r: 5, role: 'defend' });
    }
  }

  // Everyone else goes for their flag. With it already on its way home, they push the middle instead.
  const forFlag = foe.state === 'home';
  for (const bot of [...free]) {
    if (!forFlag) { take(bot, null); continue; }
    take(bot, ctfFlank(sim, bot, away) ?? { key: 'take', x: away.x, z: away.z, r: 0, role: 'collect', commit: true });
  }
}

// Some attackers flank: once a life, by tier (the flank trait, doubled), a bot picks one of the outer lanes and walks
// it to a waypoint past the middle before turning in on the flag, so a team does not all queue down the shortest road
// into the same fight. Null once there (or for a bot going straight in).
const CTF_FLANK_STAGE = 0.58;    // Fraction of the way from home to the enemy flag where the flank waypoint sits.
function ctfFlank(sim, bot, away) {
  const lanes = sim.map.lanes ?? [], ps = bot.ps;
  if (lanes.length < 3) return null;
  if (bot.ctfLife !== bot.lifeT) {
    bot.ctfLife = bot.lifeT;
    bot.ctfLane = sim.rng() < bot.S.flank * 2 ? (sim.rng() < 0.5 ? 0 : lanes.length - 1) : -1;
  }
  if (bot.ctfLane < 0) return null;
  const home = sim.ctf.bases[bot.p.team], span = away.x - home.x;
  const at = walkable(sim, home.x + span * CTF_FLANK_STAGE, lanes[bot.ctfLane].z);
  // Past the waypoint, or close to it: straight in from here.
  if ((ps.x - home.x) / span >= CTF_FLANK_STAGE - 0.05 || Math.hypot(at.x - ps.x, at.z - ps.z) < 6) { bot.ctfLane = -1; return null; }
  return { key: `flank${bot.ctfLane}`, x: at.x, z: at.z, r: 3, role: 'attack', commit: true };
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
    this.pathLen = 0; this.pathI = 0; this.pathDirty = false; this.arrived = false; this.pathPartial = false;
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
    this.style = styleOf(ps.primary, ps);
    this.plink = false; this.closeN = 0;
    this.peek = 0;
    this.objective = null; this.objKey = null; this.objAim = 0; this.objPushRoll = false;
    this.canHit = true;
    this.objRoll = this.sim.rng();                // Decided once a life, so a bot does not change its mind every plan.
    this.lifeT = this.sim.time;                   // When this life began: plans made once a life key on it.
    this._assignLane();
  }

  // Which end of the map this bot fights from: 0 is the west. In Search and Destroy the attackers always set out from
  // the west, whichever team they are this half.
  get side() {
    const snd = this.sim.snd;
    return snd ? snd.sideOf(this.p.team) : this.p.team;
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
    const fromOwnSide = (this.side === 0 ? ps.x : sim.map.width - ps.x) / sim.map.width;
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
    // Engagements stay on-screen distances; a scoped rifle reaches further by what its botUse.sight says.
    const sightRange = S.sight + (styleOf(ps.weapon, ps).sight || 0);
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      // Battle royale: nobody in the air is a target (js/sim/br.js).
      if (q.team === p.team || !q.alive || q.spawnProtect > 0 || q.brAir) continue;
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
      // A downed enemy is finished off, but only once nobody standing is a threat.
      const score = d - (tracking ? 4 : 0) + q.hp * 0.03 + (q.downed ? 14 : 0);
      if (score < bestScore) { bestScore = score; best = q; bestD = d; }
      if (S.callouts && !sim.ffa && sim.time - sim.calledAt[p.team][q.index] > CALLOUT_GAP) this._callOut(q);
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
    this.useAds = (sim.rng() < S.adsUse && d > 6) || !!styleOf(ps.weapon, ps).scoped;
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
    this._thinkThreats(visible);
    thinkAir(this, visible);       // V9: shoot down aircraft, kill Rovers, Domes and crates (js/sim/bot-streaks.js).
    thinkStrikes(this, visible);   // V9: out from under an announced strike; open Airdrops.

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
    } else if (S.retreatHp > 0 && p.hp < S.retreatHp && (visible || this.hasKnown) && p.hp < this.lastRetreatHp && !this.objective?.commit) {
      this._takeCover();
    } else if (visible && this.targetDist > 8 && (ammo === 0 || ps.reloadT > 0) && sim.rng() < S.coverReload && !this.objective?.commit) {
      this._takeCover();
    }
    this.lastRetreatHp = p.hp;

    // A close gun has no business crossing the open at someone who is looking at it: work in through cover, and
    // failing that get behind something and let them come.
    const bu = styleOf(ps.weapon, ps);
    this.plink = false;
    if (visible && bu.rush && this.targetDist > bu.rush + CLOSE_DASH && this.mode !== 'hold' && this.mode !== 'cover' && this.mode !== 'close'
      && !(this.mode === 'objective' && (this.arrived || this.objective?.commit))) {
      // Unless they are looking the other way, in which case this is exactly the moment to close.
      const t = this.target.ps;
      const facingUs = Math.abs(angleDiff(t.aim, Math.atan2(ps.z - t.z, ps.x - t.x))) < 0.9;
      if (facingUs || this.targetDist > bu.rush * 2.2) {
        // Nowhere to go: a gun that still reaches fights from where it stands rather than run mute into the fire.
        if (!this._closeIn(t.x, t.z) && !this._ambush()) this.plink = !bu.fireMax || this.targetDist <= bu.fireMax;
      }
    }
    if (this.mode === 'close') {
      if (visible && this.targetDist <= bu.rush) this._setMode('none');          // Close enough: fight.
      else if (this.arrived) {
        // At the corner. Give them a moment to walk into it, then take the next bound toward where they were.
        this.holdT -= this.interval;
        if (this.holdT <= 0) {
          const far = this.hasKnown && Math.hypot(this.knownX - ps.x, this.knownZ - ps.z) > bu.rush;
          if (!(far && this.closeN < 3 && this._closeIn(this.knownX, this.knownZ))) this._setMode('none');
        }
      }
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
    const worthChasing = this.hasKnown && !o?.commit && (o
      ? !this.knownSoft && this.knownErr < 6 && knownD < OBJ_CHASE && !(this.mode === 'objective' && this.arrived)
      : !this.knownSoft || knownD < 14);
    if (worthChasing && this.mode !== 'cover' && this.mode !== 'hold' && this.mode !== 'hunt' && this.mode !== 'close') {
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
    const busy = visible || this.hasKnown;
    switch (kind) {
      case 'uav':
      case 'overwatch': return !visible;
      case 'jammer': return this._enemyRadar() || busy;
      case 'turret': return busy || this.mode === 'hold';
      case 'mortar':
      case 'strike': return busy;
      case 'resupply': return p.hp < 60 || ps.lethalLeft === 0 || ps.ammo[ps.slot] === 0;
      // Anything overhead is common knowledge; a sentry only counts once this bot has actually seen one.
      case 'emp': return this._enemyRadar() || sim.gunships.some(g => g.team !== p.team) || this.turretTarget !== null;
      // Missile and swarm only ever go after what the team can see, so only call them when that is someone.
      case 'missile':
      case 'swarm': return sim._teamVisible(p.team).length > 0;
      case 'juggernaut': return !visible || p.hp < 50;      // Suit up between fights, or to save a losing one.
      default: return streakMoment(this, kind, visible);     // V9 kinds, chopper, gunship (js/sim/bot-streaks.js).
    }
  }

  // Anyone hostile has a radar up: the other team, or in a free-for-all any other player.
  _enemyRadar() {
    const { sim, p } = this;
    for (let t = 0; t < sim.teamCount; t++) if (t !== p.team && sim.radarUp(t)) return true;
    return false;
  }

  // Gun Game moved this bot to a new gun: fight the way the new gun wants, from the next think.
  onArmed() {
    this.style = styleOf(this.ps.primary, this.ps);
    this.useAds = !!this.style.scoped;
    this.wantSwap = false;
  }

  // Where this throw would really end up, bounces and all, through the same code that flies it.
  // Returns null when there is no throw to make. The landing object is shared; copy what you keep.
  _landing(kind, aim, dist) {
    const { sim, ps } = this;
    return landingOf(sim.map, ps.x, ps.z, aim, Math.min(dist, maxThrowRange(ps.perks)), kind, ps.perks);
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

    // A Satchel on the map is a trigger to watch: set it off the moment someone walks onto it.
    if (ps.lethal === 'charge' && this._chargeReady()) { this._throw('lethal', ps.aim, 0); return; }

    // Things that are placed, not aimed: they go down where the bot means to stay (a point, a flag, a site, a hold).
    if (this._dugIn) {
      const tac = ps.tactical;
      if ((tac === 'trophy' || tac === 'sensor' || tac === 'bulwark' || (tac === 'medpack' && (p.hp < 80 || this._teammateNear(ps.x, ps.z, 5))))
        && ps.tacticalLeft > 0 && this.tacticalT <= 0) {
        // A Sensor goes out ahead to watch the approach; a Bulwark goes a step forward, facing the same way.
        const at = tac === 'sensor' ? 7 : tac === 'bulwark' ? 1.8 : tac === 'medpack' ? 1.2 : MINE_SPOT;
        if (sim.rng() < S.flash + 0.2) this._throw('tactical', ps.aim, at);
        this.tacticalT = between(sim.rng, 10, 18);
      }
      // A Claymore faces the way it is thrown: out along the bot's own watch line. A Tripwire on open ground strings
      // its beam across that line; a Satchel goes further out, where the approach is.
      if (PLACED_LETHALS.has(ps.lethal) && ps.lethalLeft > 0 && this.nadeT <= 0) {
        if (sim.rng() < S.nade + 0.15) this._throw('lethal', ps.aim + gaussian(sim.rng) * 0.15, PLACE_SPOT[ps.lethal]);
        this.nadeT = between(sim.rng, S.nadeCd[0], S.nadeCd[1]);
      }
    }

    // Hurt and out of the fight: a Medpack at the bot's feet.
    if (ps.tactical === 'medpack' && ps.tacticalLeft > 0 && this.tacticalT <= 0 && !visible && p.hp < 55) {
      this._throw('tactical', ps.aim, 1.2);
      this.tacticalT = between(sim.rng, 6, 10);
      return;
    }

    // Recon before a push: on the way to an objective with nobody in sight, a Snapshot or Sensor goes onto it.
    const o = this.objective;
    if ((ps.tactical === 'snapshot' || ps.tactical === 'sensor') && ps.tacticalLeft > 0 && this.tacticalT <= 0 && !visible
      && o && this.mode === 'objective' && !this.arrived) {
      const d = Math.hypot(o.x - ps.x, o.z - ps.z);
      if (d > 7 && d < maxThrowRange(ps.perks) + 3) {
        this.tacticalT = between(sim.rng, 8, 14);
        if (sim.rng() < S.flash + 0.2) { this._throw('tactical', Math.atan2(o.z - ps.z, o.x - ps.x), d - 2); return; }
      }
    }

    // A vague contact is exactly when a Snapshot (or a Sensor) earns its keep.
    if ((ps.tactical === 'sensor' || ps.tactical === 'snapshot') && ps.tacticalLeft > 0 && this.tacticalT <= 0 && !visible && this.hasKnown) {
      const dist = Math.hypot(this.knownX - ps.x, this.knownZ - ps.z);
      if (dist < SENSOR_RANGE && dist > 4) {
        if (sim.rng() < S.flash) this._throw('tactical', Math.atan2(this.knownZ - ps.z, this.knownX - ps.x), dist);
        this.tacticalT = between(sim.rng, 8, 14);
        return;
      }
    }

    // A Shock or a Blackout goes at enemy devices the bot can actually see: it fries them.
    if ((ps.tactical === 'shock' || ps.tactical === 'blackout') && ps.tacticalLeft > 0 && this.tacticalT <= 0) {
      const dev = this._seenDevice();
      if (dev) {
        this.tacticalT = between(sim.rng, 8, 14);
        if (sim.rng() < S.flash) { this._throw('tactical', Math.atan2(dev.z - ps.z, dev.x - ps.x) + gaussian(sim.rng) * S.aimFloor, Math.hypot(dev.x - ps.x, dev.z - ps.z)); return; }
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

    // Pre-push: someone firm but out of sight a few metres round a corner gets a Flash or Stun first.
    if ((ps.tactical === 'flash' || ps.tactical === 'stun') && !visible && fresh && ps.tacticalLeft > 0 && this.tacticalT <= 0 && d > 5 && d < 14
      && this.mode !== 'cover') {
      const land = this._bestThrow(ps.tactical, aim, tx, tz, 4);
      if (land && !this._teammateNear(land.x, land.z, 7)) {
        this.tacticalT = between(sim.rng, 8, 15);
        if (sim.rng() < S.flash) { this._throw('tactical', land.aim, land.dist); return; }
      }
    }

    // A Tagger is a dart: thrown flat at someone in view, close enough to land it.
    if (ps.tactical === 'tagger' && visible && ps.tacticalLeft > 0 && this.tacticalT <= 0 && d > 4 && d < 14) {
      this.tacticalT = between(sim.rng, 8, 14);
      if (sim.rng() < S.flash + 0.2) { this._throw('tactical', aim, d + 1); return; }
    }
    // A Blackout goes where the enemy is, to strip their kit before the push.
    if (ps.tactical === 'blackout' && ps.tacticalLeft > 0 && this.tacticalT <= 0 && d > 6 && d < 15) {
      const land = this._bestThrow('blackout', aim, tx, tz, 5);
      if (land && Math.hypot(land.x - ps.x, land.z - ps.z) > 7.5) {
        this.tacticalT = between(sim.rng, 9, 15);
        if (sim.rng() < S.flash) { this._throw('tactical', land.aim, land.dist); return; }
      }
    }
    // A Bulwark in an open gunfight: instant cover between the bot and the shooter.
    if (ps.tactical === 'bulwark' && visible && ps.tacticalLeft > 0 && this.tacticalT <= 0 && d > 9 && this.mode !== 'cover' && p.hp < 90) {
      this.tacticalT = between(sim.rng, 10, 16);
      if (sim.rng() < S.flash + 0.2) { this._throw('tactical', aim, 1.8); return; }
    }

    if (ps.lethal === 'hatchet' || ps.lethal === 'shiv') {
      // Thrown flat at someone it can see, inside the range it can actually hit from. A Shiv wants a turned back.
      const reach = ps.lethal === 'shiv' ? 12 : 11;
      const back = ps.lethal !== 'shiv' || Math.abs(angleDiff(this.target?.ps.aim ?? 0, Math.atan2(tz - ps.z, tx - ps.x))) < 1.1 || p.hp < 50;
      if (this.nadeT <= 0 && ps.lethalLeft > 0 && visible && d < reach && d > 2.5 && back) {
        this.nadeT = between(sim.rng, S.nadeCd[0], S.nadeCd[1]) * (ps.lethal === 'shiv' ? 0.5 : 1);
        if (sim.rng() < S.nade) { this._throw('lethal', aim, d); return; }
      }
    } else if (!PLACED_LETHALS.has(ps.lethal) || (ps.lethal === 'charge' && visible && !sim.eq.remoteOf(p.id))) {
      if (this.nadeT > 0 || ps.lethalLeft <= 0 || d <= 6) return this._thinkTacOpeners(visible, d, aim, tx, tz);
      // A Drill's landing is where it goes off, past the wall it bores through, so this also finds wall shots.
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
    this._thinkTacOpeners(visible, d, aim, tx, tz);
  }

  _thinkTacOpeners(visible, d, aim, tx, tz) {
    const { sim, ps, S } = this;
    // Stun and Shock open a fight with someone in view; Gas flushes someone dug in where the bot last saw them.
    const opener = ps.tactical === 'stun' ? 6 : ps.tactical === 'shock' ? 3.5 : ps.tactical === 'gas' ? 4 : 0;
    if (opener && ps.tacticalLeft > 0 && this.tacticalT <= 0 && (visible || ps.tactical === 'gas') && d > 5 && d < 15) {
      const land = this._bestThrow(ps.tactical, aim, tx, tz, opener);
      if (land && !this._teammateNear(land.x, land.z, opener + 1) && Math.hypot(land.x - ps.x, land.z - ps.z) > opener) {
        if (sim.rng() < S.flash) this._throw('tactical', land.aim, land.dist);
        this.tacticalT = between(sim.rng, 8, 15);
        return;
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

  // An armed Satchel of this bot's with an enemy on it (seen, or right on top of it) and no teammate in the blast.
  _chargeReady() {
    const { sim, p, ps } = this, list = sim.eq.projectiles;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.kind !== 'charge' || c.owner !== p.id || !c.stuck || c.land < 0 || c.age - c.land < 0.4) continue;
      if (this._teammateNear(c.x, c.z, 4.5) || Math.hypot(c.x - ps.x, c.z - ps.z) < 4) continue;
      for (let k = 0; k < sim.players.length; k++) {
        const q = sim.players[k];
        if (!q.alive || q.team === p.team || q.spawnProtect > 0) continue;
        const d = Math.hypot(q.ps.x - c.x, q.ps.z - c.z);
        if (d < 2 || (d < CHARGE_REACH && hasLineOfSight(sim.map, ps.x, ps.z, q.ps.x, q.ps.z, sim.smokes))) return true;
      }
    }
    return false;
  }

  // The team's recon (Sensor, Snapshot, Tagger) put an enemy on the map: a firm fix, if it is anywhere near.
  onMarked(q) {
    const { ps } = this;
    if (!q || !q.alive || Math.hypot(q.ps.x - ps.x, q.ps.z - ps.z) > 32) return;
    if (this.targetVisible && this.target === q) return;
    this._note(q.ps.x, q.ps.z, false, 1.2);
  }

  // Gear wave. Reacting to the other side's equipment: run from a grenade about to go off, get out of a claymore's
  // cone or off a tripwire's beam, and shoot devices the bot can see (the tiers that shoot sentries do this too).
  _thinkThreats(visible) {
    const { sim, p, ps, S } = this, list = sim.eq.projectiles;
    // A committed objective (a flag run, a grab, a plant) does not stop for kit, the same way it does not retreat.
    if (this.objective?.commit || !list.length) return;
    let threat = null, worst = 0;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (q.dead || q.owner === p.id || q.team === p.team) continue;
      const spec = EQUIPMENT[q.kind];
      const d = Math.hypot(q.x - ps.x, q.z - ps.z);
      let danger = 0;
      if (RUN_FROM.has(q.kind) && q.attached === null) {
        const r = (spec.blast ? spec.blast.radius : spec.burn ? spec.burn.radius + 0.6 : 3.2) + 0.6;
        const left = spec.remote || spec.crawl ? 0 : spec.fuse - q.age;
        if (d < r && left < DODGE_SECS && (q.grounded || q.stuck)) danger = (r - d) / r + (spec.remote ? 0.2 : 0.5);
      } else if (q.kind === 'claymore' && q.stuck && d < 5) {
        const a = Math.atan2(ps.z - q.z, ps.x - q.x) - Math.atan2(q.vz, q.vx);
        if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.75) danger = 0.6;
      } else if (q.kind === 'tripwire' && q.stuck && d < 8) {
        const b = tripBeam(sim.map, q.x, q.z, q.vx, q.vz);
        const dx = b.x1 - b.x0, dz = b.z1 - b.z0, l2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((ps.x - b.x0) * dx + (ps.z - b.z0) * dz) / l2));
        if (Math.hypot(ps.x - b.x0 - dx * u, ps.z - b.z0 - dz * u) < 1.6) danger = 0.5;
      }
      if (danger <= worst) continue;
      // Only what the bot could know about: in view, or right next to it.
      if (d > 3 && !hasLineOfSight(sim.map, ps.x, ps.z, q.x, q.z, sim.smokes)) continue;
      worst = danger; threat = q;
    }
    if (threat) {
      if (this.dodgeId !== threat.id) { this.dodgeId = threat.id; this.dodgeRoll = sim.rng() < S.dodge; }
      if (this.dodgeRoll && !(this.mode === 'cover' && this.dodgeFrom === threat.id)) {
        this.dodgeFrom = threat.id;
        if (!this._coverFrom(threat.x, threat.z)) {
          const a = Math.atan2(ps.z - threat.z, ps.x - threat.x);
          this.mode = 'cover'; this.modeT = 2;
          this._goTo(ps.x + Math.cos(a) * 7, ps.z + Math.sin(a) * 7);
        }
      }
    }
    this._thinkDevices(visible);
  }

  // A visible enemy device worth killing: the shooting tiers put rounds into it between fights (see drive: it rides
  // the sentry target), and a bot that will not shoot it steps back out of its reach instead.
  _thinkDevices(visible) {
    const { sim, p, ps, S } = this, list = sim.eq.projectiles;
    if (visible || this.flashT > 0 || (this.turretTarget && this.turretTarget !== this.devTarget)) return;
    const dev = this.devTarget ??= { x: 0, z: 0, p: null, get hp() { return this.p && !this.p.dead ? 1 : 0; } };
    if (this.turretTarget === dev && dev.hp > 0) return;
    let best = null, bestD = DEVICE_SEE;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (q.dead || !SHOOTABLE.has(q.kind) || q.attached !== null || !(q.stuck || q.grounded) || q.owner === p.id || q.team === p.team) continue;
      const d = Math.hypot(q.x - ps.x, q.z - ps.z);
      if (d >= bestD || d < 1.5 || !hasLineOfSight(sim.map, ps.x, ps.z, q.x, q.z, sim.smokes)) continue;
      best = q; bestD = d;
    }
    if (!best) { if (this.turretTarget === dev) this.turretTarget = null; return; }
    if (S.turret === 'shoot' || (S.turret === 'cover' && sim.rng() < 0.5)) {
      dev.p = best; dev.x = best.x; dev.z = best.z;
      if (this.turretTarget !== dev) {
        this.reactLeft = between(sim.rng, S.reaction[0], S.reaction[1]);
        this.reactTotal = this.reactLeft;
        this.useAds = bestD > 7;
      }
      this.turretTarget = dev;
    } else if (DANGER_DEVICES.has(best.kind) && bestD < 5 && this.mode !== 'cover') {
      this._coverFrom(best.x, best.z);
    }
  }

  // The nearest enemy device sitting on the map within a Shock's throw that this bot has a clear view of, or null.
  _seenDevice() {
    const { sim, p, ps } = this, list = sim.eq.projectiles;
    let best = null, bestD = 13;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (!q.stuck || !SHOCK_TARGETS.has(q.kind) || q.team === p.team) continue;
      const d = Math.hypot(q.x - ps.x, q.z - ps.z);
      if (d < 3 || d >= bestD || !hasLineOfSight(sim.map, ps.x, ps.z, q.x, q.z, sim.smokes)) continue;
      best = q; bestD = d;
    }
    return best;
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
    if (!c) return false;
    this.mode = 'hold';
    this.holdSpot = c;
    this.holdAim = Math.atan2(t.z - c.z, t.x - c.x);
    this.holdT = between(sim.rng, S.holdTime[0], S.holdTime[1]) * 1.4;
    this._goTo(c.x, c.z);
    return true;
  }

  // One bound of a covered approach: the nearest cover that is out of the threat's sight and nearer to it than here.
  // False when there is none, or the bot has bounded enough for one contact.
  _closeIn(tx, tz) {
    const { sim, ps } = this;
    const here = Math.hypot(tx - ps.x, tz - ps.z);
    let best = null, bestScore = Infinity;
    const ix = sim.nav.coverIndex, n = ix.near(ps.x, ps.z, CLOSE_REACH);
    for (let q = 0; q < n; q++) {
      const c = sim.nav.cover[ix.out[q]];
      const d = Math.hypot(c.x - ps.x, c.z - ps.z);
      if (d > CLOSE_REACH || d < 1.5) continue;
      const left = Math.hypot(tx - c.x, tz - c.z);
      if (left > here - CLOSE_GAIN || left < 2) continue;
      if (hasLineOfSight(sim.map, c.x, c.z, tx, tz)) continue;
      const score = d + left * 0.7 + sim.rng() * 2;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (!best) return false;
    this.closeN = this.mode === 'close' ? this.closeN + 1 : 0;
    this.mode = 'close';
    this.holdSpot = best;
    this.holdAim = Math.atan2(tz - best.z, tx - best.x);
    this.holdT = between(sim.rng, 0.7, 1.6);
    this._goTo(best.x, best.z);
    return true;
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
    const x = (this.side === 0 ? f : 1 - f) * W, z = sim.map.lanes[this.laneIdx].z;
    // A close gun does not walk the middle of the lane: of a handful of spots around the stage it takes the least
    // open one, so its route runs along the lane's edges and through whatever stands in it.
    if (this.style.rush) {
      let best = null, bestE = Infinity;
      for (let i = 0; i < 6; i++) {
        const cx = x + (sim.rng() - 0.5) * 8, cz = z + (sim.rng() - 0.5) * 16;
        if (!sim.nav.isWalkable(cx, cz)) continue;
        const e = exposureAt(sim.map, cx, cz) + sim.rng() * 2;
        if (e < bestE) { bestE = e; best = { x: cx, z: cz }; }
      }
      if (best) return best;
    }
    return { x: x + (sim.rng() - 0.5) * 2, z: z + (sim.rng() - 0.5) * 7 };
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
    const enemyX = this.side === 0 ? sim.map.width : 0;
    this.objAim = Math.atan2(sim.map.height / 2 - z, enemyX - x);
    this._goTo(x, z);
  }

  // A long-sightline spot outside the zone that can see into it. False when there is none, and the bot just goes in.
  _overwatch(o) {
    const { sim, ps } = this;
    let best = null, bestScore = Infinity;
    const ix = sim.nav.holdIndex, n = ix.near(o.x, o.z, o.r + OVERWATCH_MAX);
    for (let q = 0; q < n; q++) {
      const h = sim.nav.holds[ix.out[q]];
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
    if (sim.ffa) { this._roam(); return; }
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

  // Free-for-all: no sides and no front line, so no lanes to push. A bot wanders the map looking for a fight: toward
  // the last kill it could have heard about some of the time, to a held angle some of the time, otherwise anywhere
  // open that is a fair walk from here, so the field keeps mixing instead of settling into corners.
  _roam() {
    const { sim, ps, S, style } = this;
    const r = sim.rng();
    if (r < S.holdProb * style.hold * 0.8 && this._goHold()) return;
    const hot = sim.hot;
    if (hot && sim.time - hot.t < 8 && r < 0.55 && Math.hypot(hot.x - ps.x, hot.z - ps.z) < 45) {
      this.mode = 'advance';
      this._goTo(hot.x + (sim.rng() - 0.5) * 10, hot.z + (sim.rng() - 0.5) * 10);
      return;
    }
    const W = sim.map.width, H = sim.map.height;
    let x = ps.x, z = ps.z;
    for (let i = 0; i < 10; i++) {
      x = W * (0.08 + 0.84 * sim.rng());
      z = H * (0.08 + 0.84 * sim.rng());
      const d = Math.hypot(x - ps.x, z - ps.z);
      if (d > 14 && d < 50 && sim.nav.isWalkable(x, z)) break;
    }
    this.mode = 'advance';
    this._goTo(x, z);
  }

  // Which way a hold looks. Team modes look toward the enemy's side; a free-for-all takes the better of the two.
  _holdSide(h) {
    const { sim, p } = this;
    return !sim.ffa ? this.side : h.sight[0] >= h.sight[1] ? 0 : 1;
  }

  // A close gun's hold: a corner with short sight lines near its lane, watching the way the enemy comes. Anyone who
  // rounds it is already inside the gun's distance.
  _goCorner() {
    const { sim, ps, S } = this;
    const laneZ = sim.map.lanes[this.laneIdx].z, W = sim.map.width;
    let best = null, bestScore = Infinity;
    const ix = sim.nav.coverIndex, n = ix.near(ps.x, ps.z, 12);
    for (let q = 0; q < n; q++) {
      const c = sim.nav.cover[ix.out[q]];
      const d = Math.hypot(c.x - ps.x, c.z - ps.z);
      if (d > 12 || d < 2) continue;
      if (!sim.ffa && Math.abs(c.z - laneZ) > 11) continue;
      const depth = sim.ffa ? 0 : (this.side === 0 ? c.x : W - c.x) / W;
      if (depth > 0.72 || this._teammateNear(c.x, c.z, 3)) continue;
      const e = exposureAt(sim.map, c.x, c.z);
      if (e > CORNER_SIGHT) continue;
      // Forward of here rather than back toward the spawn: a corner nobody walks past is no ambush.
      const ahead = sim.ffa ? 0 : (this.side === 0 ? c.x - ps.x : ps.x - c.x);
      const score = d * 0.4 + e * 0.5 - Math.min(6, ahead) * 0.5 + sim.rng() * 5;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (!best) return false;
    this.mode = 'hold';
    this.holdSpot = best;
    const enemyX = sim.ffa ? W / 2 : this.side === 0 ? best.x + 9 : best.x - 9;
    this.holdAim = Math.atan2(laneZ - best.z, enemyX - best.x);
    this.holdT = between(sim.rng, S.holdTime[0], S.holdTime[1]) * 1.5;
    this._goTo(best.x, best.z);
    return true;
  }

  // Goes to a nearby spot with a good sightline and watches down it for a few seconds.
  _goHold() {
    const { sim, p, ps, S } = this;
    if (this.style.rush && this.style.corner !== false) return this._goCorner();
    let best = null, bestScore = Infinity;
    const laneZ = sim.map.lanes[this.laneIdx].z;
    const ix = sim.nav.holdIndex, n = ix.near(ps.x, ps.z, 11);
    for (let q = 0; q < n; q++) {
      const h = sim.nav.holds[ix.out[q]];
      const d = Math.hypot(h.x - ps.x, h.z - ps.z), side = this._holdSide(h);
      if (d > 11 || h.sight[side] < 12) continue;
      if (!sim.ffa && Math.abs(h.z - laneZ) > 9) continue;    // Holding is part of playing this lane, not leaving it.
      if (this._teammateNear(h.x, h.z, 3)) continue;
      // Stay on our side of the action; a hold point deep in enemy ground is just a bad position.
      const depth = sim.ffa ? 0 : (this.side === 0 ? h.x : sim.map.width - h.x) / sim.map.width;
      const score = d * 0.5 - h.sight[side] * 0.25 + (depth > 0.72 ? 8 : 0) + sim.rng() * 6;
      if (score < bestScore) { bestScore = score; best = h; }
    }
    if (!best) return false;
    this.mode = 'hold';
    this.holdSpot = best;
    this.holdAim = best.aim[this._holdSide(best)];
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
    this.pathPartial = sim.nav.partial;      // Only a big map's capped search leaves it set: see _followPath.
    this.pathI = 0;
    // A fresh path means somewhere to go. The solve can lag _goTo by a tick or two (path budget), and the old path's
    // end reached in between must not leave the bot standing on 'arrived' with a whole new route ahead of it.
    this.arrived = this.pathLen === 0;
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
      if (this.pathI >= this.pathLen) {
        // The end of the first leg of a long route is not the goal: plan the next leg from here.
        if (this.pathPartial) { this.pathPartial = false; this.pathLen = 0; this.pathDirty = true; return true; }
        this.arrived = true; return false;
      }
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
    const style = styleOf(ps.weapon, ps);
    const ux = (q.ps.x - ps.x) / d, uz = (q.ps.z - ps.z) / d;
    const o = this.objective;
    const holdingPoint = this.mode === 'objective' && this.arrived && o && (o.role === 'attack' || o.role === 'defend' || o.role === 'plant' || o.role === 'defuse');
    const atHold = ((this.mode === 'hold' || this.mode === 'close') && this.arrived) || holdingPoint;
    let fwd = 0;
    // A wall of crates between us that this gun cannot punch through: get an angle by closing in.
    if (!this.canHit && !holdingPoint) fwd = 1;
    else if (!atHold) {
      // A close gun wants to be at its distance, not near it; a long gun gives ground to anyone inside its own.
      if (d > style.pref + (style.rush ? 1 : 4)) fwd = 1;
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
    const w = weaponDef(ps), bu = styleOf(ps.weapon, ps);
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

      const style = styleOf(ps.weapon, ps);
      // A flag runner with distance in hand does not stop to shoot back: it sprints for home, only turning to fight
      // someone close enough to catch it.
      const running = this.mode === 'objective' && !this.arrived && this.objective?.role === 'run' && d > CTF_RUN_FIGHT;
      // Bounding to cover (mode 'close') is a run too: the gun stays down until the bot is where it is going.
      const bounding = this.mode === 'close' && !this.arrived && d > style.rush;
      const rushing = running || bounding || (style.rush && d > style.rush && !this.plink && this.mode !== 'cover' && this.mode !== 'hold' && this.mode !== 'close');
      if (!rushing) this._trigger(q, d, trueAng, dt, q.ps.x, q.ps.z);
      // A committed objective (a flag run, a flag grab) never stops to trade shots: it fights on the move.
      const pushing = this.mode === 'objective' && !this.arrived && (d > style.pref || this.objPushRoll || !!this.objective?.commit);
      if ((this.mode === 'cover' || this.mode === 'hold' || this.mode === 'close' || pushing) && !this.arrived) this._followPath(false);
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
        if ((this.mode === 'hold' || this.mode === 'close') && this.arrived) I.aiming = true;
      } else if ((this.mode === 'hold' || this.mode === 'close') && this.arrived) {
        this.peek += dt * 1.2;
        desired = this.holdAim + Math.sin(this.peek) * 0.28;
        I.aiming = !!styleOf(ps.weapon, ps).scoped || S.adsUse > 0.8;
      } else if (this.mode === 'objective' && this.arrived) {
        this.peek += dt * 1.2;
        desired = this.objAim + Math.sin(this.peek) * 1.1;
        I.aiming = !!styleOf(ps.weapon, ps).scoped || S.adsUse > 0.8;
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

  // Big maps only: no living enemy within QUIET_ENEMY metres and no human within QUIET_HUMAN, and not shot at lately.
  // Nothing it could see, hear or be seen by is near, so thinking less often changes nothing anyone can notice.
  _quiet() {
    const { sim, p, ps } = this;
    if (sim.time - this.heardT < 3 || this.hasKnown) return false;
    for (let i = 0; i < sim.players.length; i++) {
      const q = sim.players[i];
      if (q === p || !q.alive) continue;
      const dx = q.ps.x - ps.x, dz = q.ps.z - ps.z, dSq = dx * dx + dz * dz;
      if (q.team !== p.team && dSq < QUIET_ENEMY * QUIET_ENEMY) return false;
      if (!q.isBot && dSq < QUIET_HUMAN * QUIET_HUMAN) return false;
    }
    return true;
  }

  update(dt) {
    const { sim, ps, input: I } = this;
    this.sprintRoll = true;
    if (this.flashT > 0) this.flashT -= dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      // On a big map a bot nowhere near anyone (see _quiet) thinks at a third of its rate; it still walks every tick.
      this.thinkT += sim.nav.big && this._quiet() ? this.interval * QUIET_SLOWDOWN : this.interval;
      if (this.S.sprint < 1) this.sprintLucky = sim.rng() < this.S.sprint;
      this.think();
    }
    this.sprintRoll = this.sprintLucky !== false;
    if (this.pathDirty) this._solvePath();
    this.drive(dt);
    // A bot that wants ADS eases its move stick into the ADS stance (see adsRoomFor) instead of strafing at full stick
    // from the hip. The stick is put back afterwards so the scaling can never compound across ticks.
    const mx = I.mx, mz = I.mz, len = Math.hypot(mx, mz);
    if (I.aiming && !I.sprint && len > ADS_STICK_FULL) { I.mx = mx * ADS_STICK_FULL / len; I.mz = mz * ADS_STICK_FULL / len; }
    const shots = stepPlayer(ps, I, dt, sim.map, sim.rng);
    I.mx = mx; I.mz = mz;
    I.swap = false; I.slide = false;
    this._trackStuck(dt);
    return shots;
  }
}
