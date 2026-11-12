// Player movement, weapon handling and shot tracing. The same code drives humans (every render
// frame with a variable dt) and bots (30 Hz on the host). No DOM, no three, no per-frame garbage:
// the only allocations are the shot/ray objects that exist because a gun actually fired.
//
// RAY CONTRACT (traceShot, Wave 5). Each ray: {x, z, hit, nx, nz, ...}
//   Cover the shooter is hugging (origin within NEAR_COVER, 1.2 m) is fired over and ignored by the ray; only cover
//   further along counts. shotPassage applies the same rule, so bots and humans agree.
//   hit       'player' | 'wall' | 'none'. Waist-high cover that stops a round reports 'wall' with cover:true.
//   cover     true when the ray stopped on waist-high cover (crate, barrier, stall, sandbag, boulder).
//   pen       damage multiplier from cover the round passed through. Only present when below 1. Multiply it in:
//             damage = rayDamage(w, ray, dist, ads)   (weapons.js), which is falloff x head x (ray.pen ?? 1).
//   id/target the player hit; head: true when the ray is a head hit (any head hit is lethal, see weapons.js).
// A shot def carries `penetrate` the same way it carries `range`: only when an attachment changed it.
// Pellet guns: only one pellet per target can be the head hit, and only when the centre of the fan is on the head.
//
// For bots and any "can I shoot that" question use shotPassage(map, ax, az, bx, bz, weaponDef): 0 when the gun's
// round cannot get there, otherwise the damage multiplier left after cover. Sight (hasLineOfSight) is not enough:
// you can see over a crate that an SMG cannot shoot through.

import { PLAYER_RADIUS, SECONDARY_ID, SECONDARY_IDS, WEAPON_IDS } from '../shared/constants.js';
import { hasLineOfSight, rayCircle, resolveCircle, wallsOnRay, wallScratch } from '../shared/geometry.js';
import { HEAD_RADIUS, MAX_COVER_PIECES, WEAPONS, effectiveWeapon } from '../shared/weapons.js';
import { attachmentsFor, NO_ATTACHMENTS } from '../shared/attachments.js';
import { DEFAULT_LOADOUT, LETHALS, TACTICALS } from '../shared/catalog.js';
import { TUNING, onTune } from '../shared/tuning.js';

export { HEAD_RADIUS, headMultFor } from '../shared/weapons.js';

const MAX_DT = 0.05;
const MAX_STEP = 0.25;         // Metres of movement per collision pass; see stepMovement.

// Movement feel. Acceleration is deliberately very high: the stick should feel directly wired to the
// body, with only the sprint build-up and the slide giving a sense of weight.
// run, sprint, accel and the slide's boost, duration and cooldown are live tunables: their defaults live in
// js/shared/tuning.js and syncMove copies the current values in, so every reader of MOVE sees the tuned feel.
export const MOVE = {
  run: 0,
  sprint: 0,
  accel: 0,
  decel: 62,
  sprintAccel: 26,       // Only the part of the speed above a run builds slowly.
  turnRate: 16,          // rad/s, facing toward movement when the right stick is idle.
  slideMinSpeed: 3.6,
  slideBoost: 0,         // Entry speed, or 1.25x current speed if that is higher.
  slideDuration: 0,
  slideEndSpeed: 4.6,
  slideSteer: 2.2,       // rad/s of direction change the left stick can still apply mid-slide.
  slideCooldown: 0,      // Starts when the slide ends.
  slideRecoverMult: 0.4, // Sliding pays off most of the sprint-to-fire delay.
};
const DEFAULT_ACCEL = 75;  // decel follows accel in proportion, so a heavier feel brakes heavier too.
function syncMove() {
  MOVE.run = TUNING.run;
  MOVE.sprint = TUNING.sprint;
  MOVE.accel = TUNING.accel;
  MOVE.decel = 62 * TUNING.accel / DEFAULT_ACCEL;
  MOVE.slideBoost = TUNING.slideBoost;
  MOVE.slideDuration = TUNING.slideDuration;
  MOVE.slideCooldown = TUNING.slideCooldown;
}
syncMove();
onTune(syncMove);

const NO_SHOTS = Object.freeze([]);
const HIT_RADIUS = PLAYER_RADIUS + 0.1;
const SLIDE_HIT_RADIUS = HIT_RADIUS * 0.72;   // Slide dodge: a sliding player is a smaller target.
const SHOT_INDEX_RESET = 0.26;  // Seconds off the trigger before the recoil pattern restarts.
const BLOOM_RECOVER_DELAY = 0.09;
const ADS_OUT_RATE = 1.35;      // Leaving ADS is quicker than entering it.
const ADS_FULL = 0.85;          // Counts as fully aimed for adsGate weapons.
// Run-and-gun. The aim stick being down is all `aiming` says, and a thumb is on it for every shot and often rests there
// between fights. With ADS following it alone, any sustained fire (and a resting thumb) put the player in full ADS and
// at adsMoveMult pace, 0.42 to 0.82 of a run: a walk. So the move stick decides the stance as well: up to ADS_STICK_FULL
// of its travel the player can aim all the way in; from there to ADS_STICK_NONE the room for ADS fades to nothing, so
// a full-stick player shoots from the hip at a run, and easing the stick off is how to settle into ADS.
export const ADS_STICK_FULL = 0.7;
export const ADS_STICK_NONE = 0.9;
export function adsRoomFor(moveLen) {
  return Math.max(0, Math.min(1, (ADS_STICK_NONE - moveLen) / (ADS_STICK_NONE - ADS_STICK_FULL)));
}
const TOPOFF_DELAY = 1.2;       // Seconds without firing or aiming before a part-empty mag tops itself off.
const TOPOFF_BELOW = 0.7;       // Fraction of the magazine under which that happens.
const DRIFT_SHOTS = 12;         // pattern.drift stops adding up after this many rounds of a string.
// A dead human who neither taps Respawn nor has auto-respawn on comes back on their own this long after dying, so an
// idle phone never leaves its slot dead for good. Shared by the host (sim.js) and the death screen (hud.js).
export const RESPAWN_IDLE = 20;
export const FIRING_REVEAL = 1.5;   // firingT after a shot: seconds shown on the enemy minimap.

const FASTHANDS_MULT = 0.72;    // Reload and swap time.
const MARATHON_SPRINT = 1.08;
const MARATHON_SLIDE_COOL = 0.6;
export const MARATHON_PRO_RELOAD = 1.35;   // Run and Load: reload clock speed while sprinting.

// Assist range, reach (scales ASSIST_CONE and ASSIST_EDGE), slowdown (scales the friction) and strength (scales
// ASSIST_MAX_OFFSET) are tunables; these are their values at 1x.
const ASSIST_CONE = 8 * Math.PI / 180;
const ASSIST_EDGE = 1.5;        // Assist fades out between the body's edge and this multiple of it (V10: was 1.25).
const ASSIST_MAX_OFFSET = 7 * Math.PI / 180;      // V10: was 6 degrees.
const ASSIST_FRICTION = 0.38;   // Share of the stick's rotation cancelled over a target from the hip (V10: was 0.32); +0.3 in ADS.
const ASSIST_TRACK = 0.45;      // Share of the target's drift across the view that is followed from the hip; +0.15 in ADS.
const ASSIST_TRACK_RATE = 2.5;  // rad/s: drift faster than this is not followed past the cap.

const TAU = Math.PI * 2;

export function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

function reserveFor(w) { return w.reserve; }

// The effective def of a gun this player carries: attachments applied at loadout time, so it is a field read
// and allocates nothing. Anything the player does not carry resolves to the plain def.
export function weaponDef(ps, id = ps.weapon) {
  const d = ps.defs;
  return d[0].id === id ? d[0] : d[1].id === id ? d[1] : WEAPONS[id];
}

function refreshDefs(ps) {
  ps.defs[0] = effectiveWeapon(ps.primary, attachmentsFor(ps, ps.primary));
  ps.defs[1] = effectiveWeapon(ps.secondary, attachmentsFor(ps, ps.secondary));
}

function hasPerk(ps, perk) { return ps.perks.includes(perk); }

// A Pro ability works while its perk is equipped and its owner has earned Pro on it. `ps.pro` is the owner's whole list
// (from loadout.pro), so a loadout change on the death screen needs nothing else to keep Pro right.
export function hasPro(ps, perk) { return ps.perks.includes(perk) && ps.pro.includes(perk); }
function reloadMult(ps) { return hasPerk(ps, 'fasthands') ? FASTHANDS_MULT : 1; }
function slideCooldownOf(ps) { return MOVE.slideCooldown * (hasPerk(ps, 'marathon') ? MARATHON_SLIDE_COOL : 1); }

// Takes a full normalized loadout or the older partial {primary, camo}; absent fields are left alone.
function applyLoadout(ps, l) {
  if (l.primary && WEAPONS[l.primary]) ps.primary = l.primary;
  if (SECONDARY_IDS.includes(l.secondary)) ps.secondary = l.secondary;
  if (l.camo) ps.camo = l.camo;
  if (Array.isArray(l.perks)) ps.perks = l.perks.slice();
  if (Array.isArray(l.pro)) ps.pro = l.pro.slice();
  if (TACTICALS[l.tactical]) ps.tactical = l.tactical;
  if (LETHALS[l.lethal]) ps.lethal = l.lethal;
  if (l.attachments && typeof l.attachments === 'object') ps.attachments = l.attachments;
  if (l.ladder) ps.ladder = true;
  // One in the Chamber: the primary holds this many rounds and no reserve (null: the gun's own magazine).
  if (l.primary) ps.rounds = Number.isInteger(l.rounds) ? l.rounds : null;
  refreshDefs(ps);
}

function refillEquipment(ps) {
  ps.tacticalLeft = TACTICALS[ps.tactical].count;
  ps.lethalLeft = LETHALS[ps.lethal].count;
}

function clearHeat(ps) {
  ps.heat = 0; ps.heatIdle = 9; ps.overheated = false; ps.overheatT = 0; ps.overheatEdge = false;
}

// Spends one tactical or lethal. slot: 'tactical' | 'lethal'. Returns the kind, or null when none are left.
// The host calls this on its copy of the player: the count is host-authoritative and not on the wire.
export function takeEquipment(ps, slot) {
  const key = slot === 'tactical' ? 'tacticalLeft' : 'lethalLeft';
  if (ps[key] <= 0) return null;
  ps[key]--;
  return slot === 'tactical' ? ps.tactical : ps.lethal;
}

// instantReload is the firing range's rule: magazines refill the moment they run dry and reserve never drains.
export function createPlayerState({ id, primary = 'ar', camo = 'none', loadout, instantReload = false } = {}) {
  const ps = {
    id, x: 0, z: 0, aim: 0, vx: 0, vz: 0, instantReload, ladder: false,
    slot: 0, primary, secondary: SECONDARY_ID, weapon: primary, camo,
    attachments: NO_ATTACHMENTS, defs: [WEAPONS[primary], WEAPONS[SECONDARY_ID]],
    perks: [], pro: [], tactical: DEFAULT_LOADOUT.tactical, lethal: DEFAULT_LOADOUT.lethal,
    tacticalLeft: 0, lethalLeft: 0,
    heat: 0, overheated: false, overheatT: 0, overheatEdge: false, firingT: 0,
    ammo: [0, 0], reserve: [0, 0],
    reloadT: 0, reloadDur: 0, adsT: 0,
    sprinting: false, sprintRecoverT: 0,
    sliding: false, slideT: 0, slideCool: 0,
    cooldown: 0, bloom: 0, shotIndex: 0,
    // Capture the Flag: a flag carrier cannot slide (js/sim/ctf.js). The host sets it on bots; a human's phone sets it
    // on its own state from the view (see ctfCarrying).
    noSlide: false,
    // Internal, not part of the wire format.
    swapT: 0, shellT: 0, sinceShot: 9, burstLeft: 0,
    holsterT: 0, holsterSlot: 0, holsterDur: 0,   // Fast Hands Pro: a reload finishing on the holstered gun.
    heatIdle: 9, calmT: 0,
    slideDirX: 0, slideDirZ: 0, slideSpeed: 0,
    aaOffset: 0, aaRaw: null, aaId: null, aaBearing: 0,
    daze: 0, dazeT: 0,                              // Stun, Gas and Shock: see applyDaze.
  };
  if (loadout) applyLoadout(ps, loadout);
  ps.weapon = ps.primary;
  fillAmmo(ps);
  refillEquipment(ps);
  return ps;
}

function fillAmmo(ps) {
  const a = weaponDef(ps, ps.primary), b = weaponDef(ps, ps.secondary);
  ps.ammo[0] = a.magazine; ps.ammo[1] = b.magazine;
  ps.reserve[0] = reserveFor(a); ps.reserve[1] = reserveFor(b);
  if (ps.rounds != null) { ps.ammo[0] = ps.rounds; ps.reserve[0] = 0; }
}

// Places a player at a spawn point, full ammo and equipment, every timer cleared.
// Optional new loadout: a normalized loadout, {loadout}, or the older {primary, camo}.
// A Gun Game player (`ps.ladder`) keeps the gun the host gave them: a loadout picked on the death screen waits.
export function respawnPlayer(ps, x, z, aim, loadout) {
  if (loadout && !(ps.ladder && !(loadout.loadout || loadout).ladder)) applyLoadout(ps, loadout.loadout || loadout);
  ps.x = x; ps.z = z; ps.aim = aim; ps.vx = 0; ps.vz = 0;
  ps.slot = 0; ps.weapon = ps.primary;
  fillAmmo(ps);
  refillEquipment(ps);
  clearHeat(ps);
  ps.firingT = 0; ps.calmT = 0;
  ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0; ps.adsT = 0;
  ps.sprinting = false; ps.sprintRecoverT = 0;
  ps.sliding = false; ps.slideT = 0; ps.slideCool = 0;
  ps.cooldown = 0; ps.bloom = 0; ps.shotIndex = 0;
  ps.swapT = 0; ps.sinceShot = 9; ps.burstLeft = 0;
  ps.holsterT = 0; ps.holsterDur = 0;
  ps.aaOffset = 0; ps.aaRaw = null; ps.aaId = null;
  ps.daze = 0; ps.dazeT = 0;
  return ps;
}

// Stun, Gas and Shock (js/sim/equipment.js 'dazed' events). For `dur` seconds the player moves at up to DAZE_SLOW less
// speed and turns no faster than DAZE_TURN allows, scaled by `amount` 0..1. The stronger and the longer effect win.
// The host calls this for bots; a human's phone calls it for its own 'dazed' events, since it owns its movement.
const DAZE_SLOW = 0.55;
const DAZE_TURN = [14, 2.2];   // rad/s turn cap at a faint and at a full daze.
export function applyDaze(ps, amount, dur) {
  if (!(amount > 0) || !(dur > 0)) return ps;
  ps.daze = ps.dazeT > 0 ? Math.max(ps.daze, Math.min(1, amount)) : Math.min(1, amount);
  ps.dazeT = Math.max(ps.dazeT, dur);
  return ps;
}

// Gun Game: the host moved this player to another gun (a kill up, a thrown kill down). It goes straight into their
// hands, loaded, whatever they were doing; there is nothing to swap to. On a human's phone, call it for the `arm` event.
export function armPlayer(ps, weapon) {
  if (!WEAPONS[weapon]) return ps;
  ps.primary = weapon;
  refreshDefs(ps);
  const w = ps.defs[0];
  ps.slot = 0; ps.weapon = weapon;
  ps.ammo[0] = w.magazine; ps.reserve[0] = reserveFor(w);
  clearHeat(ps);
  ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0; ps.holsterT = 0; ps.holsterDur = 0;
  ps.shotIndex = 0; ps.bloom = 0; ps.burstLeft = 0; ps.adsT *= 0.4;
  ps.swapT = w.swapTime; ps.cooldown = Math.max(ps.cooldown, ps.swapT);
  return ps;
}

// Swaps the sidearm in place, full magazine. The host uses it to take the Golden Gun off a bot that inherits a human's
// slot (bots never carry it); a player holding the sidearm keeps holding the new one.
export function armSecondary(ps, weapon) {
  if (!SECONDARY_IDS.includes(weapon) || ps.secondary === weapon) return ps;
  ps.secondary = weapon;
  refreshDefs(ps);
  const w = ps.defs[1];
  ps.ammo[1] = w.magazine; ps.reserve[1] = reserveFor(w);
  if (ps.slot === 1) { ps.weapon = weapon; ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0; }
  return ps;
}

function setSlot(ps, slot) {
  // Sleight (Fast Hands Pro): a magazine reload in progress carries on in the holster instead of being lost, and
  // swapping back picks it up where it is. Shell-fed guns load by hand, so theirs still stops.
  const carry = ps.reloadT > 0 && !weaponDef(ps).shellReload && hasPro(ps, 'fasthands');
  const resume = ps.holsterT > 0 && ps.holsterSlot === slot;
  const resumeT = ps.holsterT, resumeDur = ps.holsterDur;
  if (carry) { ps.holsterT = ps.reloadT; ps.holsterDur = ps.reloadDur; ps.holsterSlot = ps.slot; }
  else if (resume) ps.holsterT = 0;
  ps.slot = slot;
  ps.weapon = slot === 0 ? ps.primary : ps.secondary;
  const w = weaponDef(ps);
  ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0;
  if (resume) { ps.reloadT = resumeT; ps.reloadDur = resumeDur; }
  ps.shotIndex = 0; ps.bloom = 0; ps.burstLeft = 0;
  ps.adsT *= 0.4;
  ps.swapT = w.swapTime * reloadMult(ps);
  ps.cooldown = Math.max(ps.cooldown, ps.swapT);
}

function startReload(ps, w) {
  const i = ps.slot;
  const missing = w.magazine - ps.ammo[i];
  if (ps.reloadT > 0 || missing <= 0) return;
  if (ps.instantReload) { ps.ammo[i] = w.magazine; ps.shotIndex = 0; ps.burstLeft = 0; return; }
  if (ps.reserve[i] <= 0 && !w.unlimitedReserve) return;
  if (w.shellReload) {
    // reloadT / reloadDur cover the whole loop so the HUD ring stays simple; shellT paces each round.
    const shell = w.reload * reloadMult(ps);
    const n = Math.min(missing, ps.reserve[i]);
    ps.reloadDur = n * shell;
    ps.shellT = shell;
  } else {
    ps.reloadDur = w.reload * reloadMult(ps);
  }
  ps.reloadT = ps.reloadDur;
  ps.shotIndex = 0;
  ps.burstLeft = 0;
}

// The holstered gun's reload under Sleight: no animation to wait on, only the clock, then the magazine.
function stepHolster(ps, dt) {
  if (ps.holsterT <= 0) return;
  ps.holsterT -= dt;
  if (ps.holsterT > 0) return;
  ps.holsterT = 0; ps.holsterDur = 0;
  const i = ps.holsterSlot, w = weaponDef(ps, i === 0 ? ps.primary : ps.secondary);
  const got = w.unlimitedReserve ? w.magazine - ps.ammo[i] : Math.min(w.magazine - ps.ammo[i], ps.reserve[i]);
  ps.ammo[i] += got;
  if (!w.unlimitedReserve) ps.reserve[i] -= got;
}

function stepReload(ps, w, dt) {
  if (ps.reloadT <= 0) return;
  // Run and Load (Marathon Pro): the reload clock runs fast while sprinting.
  if (ps.sprinting && hasPro(ps, 'marathon')) dt *= MARATHON_PRO_RELOAD;
  const i = ps.slot;
  ps.reloadT -= dt;
  if (w.shellReload) {
    ps.shellT -= dt;
    while (ps.shellT <= 0 && ps.ammo[i] < w.magazine && ps.reserve[i] > 0) {
      ps.ammo[i]++; ps.reserve[i]--;
      ps.shellT += w.reload * reloadMult(ps);
    }
    if (ps.ammo[i] >= w.magazine || ps.reserve[i] <= 0) { ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0; }
    else if (ps.reloadT <= 0) ps.reloadT = ps.shellT;   // Rounding: keep going until the tube is full.
    return;
  }
  if (ps.reloadT <= 0) {
    const need = w.magazine - ps.ammo[i];
    const got = w.unlimitedReserve ? need : Math.min(need, ps.reserve[i]);
    ps.ammo[i] += got;
    if (!w.unlimitedReserve) ps.reserve[i] -= got;
    ps.reloadT = 0; ps.reloadDur = 0;
  }
}

// Current spread half-angle in radians. Exported so the HUD or tests can read the true cone.
export function currentSpread(ps, w = weaponDef(ps)) {
  const ads = ps.adsT;
  let s = w.hipSpread + (w.adsSpread - w.hipSpread) * ads;
  s *= 1 + ps.bloom * (w.bloomScale || 1);
  const speed = Math.hypot(ps.vx, ps.vz);
  s *= 1 + 0.55 * (1 - ads) * Math.min(1, speed / MOVE.run);
  if (ps.sliding && !w.slideFire) s *= 1.7;
  if (w.settle) s *= w.settle.from + (1 - w.settle.from) * Math.min(1, ps.shotIndex / w.settle.shots);   // V10: tightens as it fires.
  return s * TUNING.spread;
}

function shotInterval(w, shotIndex) {
  let rpm = w.rpm;
  if (w.spinup) {
    const k = Math.min(1, shotIndex / w.spinup.shots);
    rpm *= w.spinup.from + (1 - w.spinup.from) * k;
  }
  return 60 / rpm;
}

// Recovery after the last round of a burst: whatever makes the gun's cadence come out at its rated rpm.
function burstRecovery(w) {
  const b = w.burst;
  return Math.max(b.gap, b.count * 60 / w.rpm - (b.count - 1) * b.gap);
}

function isLocked(ps, w) { return w.heat !== undefined && ps.overheated; }

// V10 charge guns (weapons-v10.js `charge`): true while the round is still being held back. The trigger has to stay
// down for charge.time with the gun otherwise ready; the charge bleeds off at the same pace when it is not. The bar
// the HUD draws for heat shows it, which is why a charge gun cannot also be a heat gun.
function chargeHolds(ps, w, trigger, dt) {
  if (!w.charge) return false;
  const ready = trigger && ps.reloadT <= 0 && ps.swapT <= 0 && ps.sprintRecoverT <= 0 && ps.cooldown <= 0 && ps.ammo[ps.slot] > 0;
  ps.chargeT = ready ? (ps.chargeT || 0) + dt : Math.max(0, (ps.chargeT || 0) - dt);
  const full = ps.chargeT >= w.charge.time;
  if (full) ps.chargeT = 0;
  if (ps.slot === 0) ps.heat = ps.chargeT / w.charge.time;
  return !full;
}

// Runs whichever gun is in hand, so a locked LMG keeps cooling behind the pistol.
function stepHeat(ps, dt) {
  const h = weaponDef(ps, ps.primary).heat;
  if (!h) return;
  ps.heatIdle += dt;
  if (ps.overheated) {
    // The bar drains across the lockout, so the gun comes back empty and the HUD shows the wait.
    ps.overheatT -= dt;
    ps.heat = Math.max(0, ps.overheatT / h.lockout);
    if (ps.overheatT <= 0) { ps.overheated = false; ps.overheatT = 0; ps.heat = 0; }
  } else if (ps.heat > 0 && ps.heatIdle >= h.coolDelay) {
    ps.heat = Math.max(0, ps.heat - dt / h.coolTime);
  }
}

function addHeat(ps, h) {
  ps.heat = Math.min(1, ps.heat + 1 / h.rounds);
  ps.heatIdle = 0;
  if (ps.heat >= 1 - 1e-6) {
    ps.heat = 1; ps.overheated = true; ps.overheatT = h.lockout; ps.overheatEdge = true;
  }
  // Heat guns have no ordinary bloom: all their looseness comes from here, in the top of the bar.
  ps.bloom = Math.max(0, (ps.heat - h.loosenFrom) / (1 - h.loosenFrom));
}

function fireOne(ps, w, rng) {
  const spread = currentSpread(ps, w);
  const n = w.pellets || 1;
  const angles = new Array(n);
  let kick = 0;
  if (w.pattern) {
    const p = w.pattern;
    kick = p.amp * Math.sin(ps.shotIndex * p.freq) * Math.min(1, ps.shotIndex / p.ramp) * (1 - 0.55 * ps.adsT);
    if (p.drift) kick += p.drift * Math.min(ps.shotIndex, DRIFT_SHOTS) * (1 - 0.55 * ps.adsT);
    kick *= TUNING.recoil;
  }
  if (n === 1) {
    angles[0] = ps.aim + kick + (rng() + rng() - 1) * spread;
  } else {
    // A fan with light jitter, not pure randomness: a shotgun that randomly whiffs feels broken.
    for (let i = 0; i < n; i++) {
      const lane = ((i + 0.5) / n) * 2 - 1;
      angles[i] = ps.aim + kick + (lane + (rng() - 0.5) * 0.28) * spread;
    }
  }
  const shot = {
    ox: ps.x, oz: ps.z, aim: ps.aim, weapon: ps.weapon, angles,
    ads: ps.adsT >= ADS_FULL,
  };
  // Lets the owner's own traceShot match the host, which works the range out from the loadout itself.
  if (w.range !== WEAPONS[ps.weapon].range) shot.range = w.range;
  if (w.penetrate !== WEAPONS[ps.weapon].penetrate) shot.penetrate = w.penetrate;
  if (w.melee) { if (w.lunge) { ps.vx = Math.cos(ps.aim) * w.lunge; ps.vz = Math.sin(ps.aim) * w.lunge; } }   // V10: a swing spends nothing and carries you forward.
  else ps.ammo[ps.slot]--;
  ps.shotIndex++;
  ps.sinceShot = 0;
  // A suppressed shot leaves any reveal from an earlier unsuppressed shot to run out on its own.
  if (w.suppressed) shot.sup = 1;
  else ps.firingT = FIRING_REVEAL;
  if (w.heat) addHeat(ps, w.heat);
  else ps.bloom = Math.min(1, ps.bloom + w.bloomPerShot * (1 - 0.4 * ps.adsT));
  if (w.boltKick !== undefined) ps.adsT = Math.min(ps.adsT, w.boltKick);
  return shot;
}

function stepMovement(ps, input, w, dt, map) {
  const mx = input.mx || 0, mz = input.mz || 0;
  const moveLen = Math.hypot(mx, mz);

  if (ps.slideCool > 0) ps.slideCool -= dt;

  // Sprint: broken by firing, or by aiming down sights, which then cost sprintToFire before the first shot. A thumb
  // resting on the aim stick is only aiming down sights when the move stick leaves room for it (see adsRoom): at full
  // move stick it just steers, so it must not drop a sprint to a run.
  const marathon = hasPerk(ps, 'marathon');
  const adsIntent = !!input.aiming && moveLen < ADS_STICK_NONE;
  const wantsSprint = !!input.sprint && moveLen > 0.5 && !adsIntent && !input.fire && !ps.sliding;
  ps.sprinting = wantsSprint;
  if (ps.sprinting) ps.sprintRecoverT = w.sprintToFire;
  else if (ps.sprintRecoverT > 0) ps.sprintRecoverT -= dt;

  const speedNow = Math.hypot(ps.vx, ps.vz);
  if (input.slide && !ps.noSlide && !ps.sliding && ps.slideCool <= 0 && speedNow >= MOVE.slideMinSpeed) {
    ps.sliding = true;
    ps.slideT = MOVE.slideDuration;
    ps.slideDirX = ps.vx / speedNow;
    ps.slideDirZ = ps.vz / speedNow;
    ps.slideSpeed = Math.max(speedNow * 1.25, MOVE.slideBoost * Math.min(1, w.moveMult));
    ps.sprinting = false;
    ps.sprintRecoverT = Math.min(ps.sprintRecoverT, w.sprintToFire * MOVE.slideRecoverMult);
  }

  if (ps.sliding) {
    ps.slideT -= dt;
    // Linear bleed to the exit speed so a slide always carries momentum out.
    const k = Math.max(0, ps.slideT / MOVE.slideDuration);
    const spd = MOVE.slideEndSpeed + (ps.slideSpeed - MOVE.slideEndSpeed) * k;
    if (moveLen > 0.2) {
      const cur = Math.atan2(ps.slideDirZ, ps.slideDirX);
      const d = angleDiff(Math.atan2(mz, mx), cur);
      const lim = MOVE.slideSteer * dt;
      const a = cur + Math.max(-lim, Math.min(lim, d));
      ps.slideDirX = Math.cos(a); ps.slideDirZ = Math.sin(a);
    }
    ps.vx = ps.slideDirX * spd;
    ps.vz = ps.slideDirZ * spd;
    if (ps.slideT <= 0) { ps.sliding = false; ps.slideCool = slideCooldownOf(ps); }
  } else {
    const base = (ps.sprinting ? MOVE.sprint * (marathon ? MARATHON_SPRINT : 1) : MOVE.run) * w.moveMult
      * (ps.dazeT > 0 ? 1 - DAZE_SLOW * ps.daze : 1);
    // ADS caps the speed rather than scaling the stick: a part-pushed stick that is already slower than the ADS pace
    // loses nothing, which is what lets a player ease the stick off into ADS without crawling.
    const cap = ps.sprinting ? base : base * (1 + (w.adsMoveMult - 1) * ps.adsT);
    let scale = (moveLen > 1 ? 1 / moveLen : 1) * base;
    if (Math.min(moveLen, 1) * base > cap) scale = cap / moveLen;
    const tx = mx * scale, tz = mz * scale;
    const dx = tx - ps.vx, dz = tz - ps.vz;
    const dLen = Math.hypot(dx, dz);
    if (dLen > 1e-6) {
      // Braking or reversing uses decel/accel in full; only pushing past a run builds slowly.
      const targetSpeed = Math.hypot(tx, tz);
      let a = targetSpeed < 0.01 ? MOVE.decel : MOVE.accel;
      if (targetSpeed > MOVE.run * w.moveMult && speedNow >= MOVE.run * w.moveMult * 0.97) a = MOVE.sprintAccel;
      const step = Math.min(dLen, a * dt);
      ps.vx += (dx / dLen) * step;
      ps.vz += (dz / dLen) * step;
    }
  }

  const ox = ps.x, oz = ps.z;
  const nextX = ox + ps.vx * dt, nextZ = oz + ps.vz * dt;
  // A slide at a low frame rate covers more than half a body per step. Taken in one go, the centre can land inside
  // a wall, and an L of two abutting walls (Sunken's water) then pushes it from one into the other. Substeps of
  // MAX_STEP keep the centre outside every wall, so resolveCircle always pushes back the way the player came.
  const steps = Math.ceil(Math.hypot(nextX - ox, nextZ - oz) / MAX_STEP) || 1;
  let pushed = false;
  for (let i = 1; i <= steps; i++) {
    const tx = ps.x + (nextX - ox) / steps, tz = ps.z + (nextZ - oz) / steps;
    ps.x = tx; ps.z = tz;
    resolveCircle(map, ps, PLAYER_RADIUS);
    if (ps.x !== tx || ps.z !== tz) pushed = true;
  }
  if (!pushed) { ps.x = nextX; ps.z = nextZ; }
  // Convert any push-out back into velocity so a wall scrubs speed instead of being pushed against.
  if (pushed) {
    ps.vx = (ps.x - ox) / dt;
    ps.vz = (ps.z - oz) / dt;
    if (ps.sliding) {
      ps.slideSpeed = Math.min(ps.slideSpeed, Math.hypot(ps.vx, ps.vz) + MOVE.slideEndSpeed);
      if (Math.hypot(ps.vx, ps.vz) < 1.2) { ps.sliding = false; ps.slideCool = slideCooldownOf(ps); }
    }
  }

  // Facing: right stick wins; with it idle, turn to face the direction of travel.
  if (typeof input.aim === 'number') {
    if (ps.dazeT > 0) {
      // Dazed: the aim drags behind the stick, whatever the gun.
      const cap = DAZE_TURN[0] + (DAZE_TURN[1] - DAZE_TURN[0]) * ps.daze;
      const d = angleDiff(input.aim, ps.aim), lim = Math.min(cap, w.turnCap && (input.aiming || input.fire) ? w.turnCap : cap) * dt;
      ps.aim += Math.max(-lim, Math.min(lim, d));
    } else if (w.turnCap && (input.aiming || input.fire)) {
      // Heavy guns swing slowly once shouldered: this is what lets a flanker beat a planted LMG.
      const d = angleDiff(input.aim, ps.aim), lim = w.turnCap * dt;
      ps.aim += Math.max(-lim, Math.min(lim, d));
    } else {
      ps.aim = input.aim;
    }
  } else if (moveLen > 0.2) {
    const d = angleDiff(Math.atan2(mz, mx), ps.aim);
    ps.aim += Math.sign(d) * Math.min(Math.abs(d), MOVE.turnRate * dt);
  }
}

// Advances one player by dt and returns the shots fired this frame.
export function stepPlayer(ps, input, dt, map, rng = Math.random) {
  if (!(dt > 0)) return NO_SHOTS;
  if (dt > MAX_DT) dt = MAX_DT;

  ps.overheatEdge = false;
  if (ps.dazeT > 0 && (ps.dazeT -= dt) <= 0) { ps.dazeT = 0; ps.daze = 0; }
  if (input.swap && !ps.ladder) setSlot(ps, ps.slot === 0 ? 1 : 0);
  if (ps.swapT > 0) ps.swapT -= dt;

  let w = weaponDef(ps);
  stepMovement(ps, input, w, dt, map);

  // ADS blocked by sprinting, swapping and magazine reloads; a shell-fed gun can stay up.
  // How far in it can go also depends on the move stick; see adsRoomFor.
  const wantAds = !!input.aiming && !ps.sprinting && ps.swapT <= 0 && (ps.reloadT <= 0 || !!w.shellReload);
  const rate = dt / (w.adsTime * TUNING.adsTime);
  const room = wantAds ? adsRoomFor(Math.hypot(input.mx || 0, input.mz || 0)) : 0;
  ps.adsT = ps.adsT < room ? Math.min(room, ps.adsT + rate) : Math.max(room, ps.adsT - rate * ADS_OUT_RATE);

  stepReload(ps, w, dt);
  stepHolster(ps, dt);
  stepHeat(ps, dt);

  ps.sinceShot += dt;
  ps.cooldown -= dt;
  if (ps.firingT > 0) ps.firingT = Math.max(0, ps.firingT - dt);

  const trigger = !!input.fire;
  ps.calmT = trigger || input.aiming ? 0 : ps.calmT + dt;

  // Firing with rounds left cancels any reload; progress on a magazine swap is lost.
  if (trigger && ps.reloadT > 0 && ps.ammo[ps.slot] > 0 && !isLocked(ps, w)) {
    ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0;
  }

  // Every gun fires for as long as the trigger is held, at its own rpm: no gun needs a release between shots.
  // Non-auto guns never fire twice in one frame. A burst, once started, finishes whether or not the finger stayed
  // down; sprinting abandons it.
  if (ps.sprinting) ps.burstLeft = 0;
  let shots = NO_SHOTS;
  const charging = chargeHolds(ps, w, trigger, dt);
  if ((trigger || ps.burstLeft > 0) && !charging && ps.reloadT <= 0 && ps.swapT <= 0 && ps.sprintRecoverT <= 0) {
    for (let guard = 0; guard < 4 && ps.cooldown <= 0 && ps.ammo[ps.slot] > 0 && !isLocked(ps, w); guard++) {
      let interval;
      if (w.burst) {
        if (ps.burstLeft <= 0) ps.burstLeft = w.burst.count;
        ps.burstLeft--;
        interval = ps.burstLeft > 0 ? w.burst.gap : burstRecovery(w);
      } else {
        interval = shotInterval(w, ps.shotIndex);
      }
      const shot = fireOne(ps, w, rng);
      if (shots === NO_SHOTS) shots = [];
      shots.push(shot);
      ps.cooldown += interval;
      // Each burst climbs the same way: the pattern is per burst, not per magazine.
      if (w.burst && ps.burstLeft === 0) ps.shotIndex = 0;
      if (!w.auto) break;
    }
    if (ps.ammo[ps.slot] <= 0) ps.burstLeft = 0;
  }

  // Only carry negative cooldown across a frame while actually firing, to hold the true rate.
  if (shots === NO_SHOTS && ps.cooldown < 0) ps.cooldown = 0;

  if (!trigger && ps.sinceShot > SHOT_INDEX_RESET) ps.shotIndex = 0;
  if (ps.sinceShot > BLOOM_RECOVER_DELAY && ps.bloom > 0) ps.bloom = Math.max(0, ps.bloom - w.bloomRecover * dt);

  // A controller's Reload button (js/ui/gamepad.js): a manual reload of a part-empty magazine, whenever one could start.
  if (input.reload && !trigger && ps.swapT <= 0 && ps.reloadT <= 0 && !w.melee) startReload(ps, w);

  // Auto-reload on empty; if the gun is completely dry, fall through to the other one.
  // Touch has no reload button, so a part-empty magazine also tops itself off in a quiet moment.
  if (ps.ammo[ps.slot] <= 0 && ps.reloadT <= 0 && ps.cooldown <= 0) {
    if (ps.reserve[ps.slot] > 0 || w.unlimitedReserve) startReload(ps, w);
    else if (ps.ammo[1 - ps.slot] > 0 || ps.reserve[1 - ps.slot] > 0) setSlot(ps, 1 - ps.slot);
  } else if (ps.calmT >= TOPOFF_DELAY && ps.swapT <= 0 && ps.ammo[ps.slot] < w.magazine * TOPOFF_BELOW) {
    startReload(ps, w);
  }
  return shots;
}

// What a ray's walk across the map found. One module-level record reused per ray: traceShot is synchronous.
const SEG = { hardT: Infinity, hardNx: 0, hardNz: 0, stopT: Infinity, stopNx: 0, stopNz: 0, count: 0, inT: [], outT: [], nx: [], nz: [], own: [], proof: [] };

// True for waist-high cover: blocks movement, not sight, and is not water.
export function isWaistCover(w) { return w.blocksMove && !w.blocksBullet && w.kind !== 'water'; }

// Cover at the shooter's own feet is fired over, not into: a player crouched behind a crate shoots across its top.
// A piece counts as the shooter's own when the shot origin (the body centre) is within NEAR_COVER of it, and only
// for the first NEAR_COVER_REACH metres of the ray, so a long barrier still stops a round that crosses it again
// further down its length. Only cover further along the ray can stop or slow the round. Solid walls never qualify.
export const NEAR_COVER = 1.2;
const NEAR_COVER_REACH = 3;
function ownCover(ox, oz, r, spanIn) {
  if (spanIn > NEAR_COVER_REACH) return false;
  const gx = Math.max(r.x - ox, 0, ox - (r.x + r.w)), gz = Math.max(r.z - oz, 0, oz - (r.z + r.d));
  return gx * gx + gz * gz <= NEAR_COVER * NEAR_COVER;
}

// Entry and exit of a ray into a rectangle, closed on the near side: an origin on or inside a rectangle counts as
// entering at t=0 (geometry.js raycastMap returns null there, which is what let a shot escape a wall it started in).
// Returns false for a miss, or for a ray that only ever leaves the rectangle.
let spanIn = 0, spanOut = 0, spanNx = 0, spanNz = 0;
function raySpan(ox, oz, dx, dz, r) {
  let tIn = -Infinity, tOut = Infinity, nx = 0, nz = 0;
  if (Math.abs(dx) < 1e-9) {
    if (ox < r.x || ox > r.x + r.w) return false;
  } else {
    let t0 = (r.x - ox) / dx, t1 = (r.x + r.w - ox) / dx, n = -1;
    if (t0 > t1) { const q = t0; t0 = t1; t1 = q; n = 1; }
    tIn = t0; tOut = t1; nx = n;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < r.z || oz > r.z + r.d) return false;
  } else {
    let t0 = (r.z - oz) / dz, t1 = (r.z + r.d - oz) / dz, n = -1;
    if (t0 > t1) { const q = t0; t0 = t1; t1 = q; n = 1; }
    if (t0 > tIn) { tIn = t0; nx = 0; nz = n; }
    if (t1 < tOut) tOut = t1;
  }
  if (tIn > tOut || tOut <= 1e-7) return false;
  spanIn = Math.max(0, tIn); spanOut = tOut;
  // Started inside: there is no face it came through, so the normal just points back up the ray.
  if (tIn <= 0) { spanNx = -dx; spanNz = -dz; } else { spanNx = nx; spanNz = nz; }
  return true;
}

// Walks one ray across every wall. Fills SEG: where a solid stops it (hardT) and, depending on the round, where
// waist-high cover stops it (stopT) and the pieces of cover it passes through before that.
let RAY_WALLS = null;
function walkRay(map, ox, oz, dx, dz, range, penetrate, overCover) {
  const S = SEG;
  S.hardT = Infinity; S.stopT = Infinity; S.count = 0;
  // Only the walls along the ray, in wall order (the wall grid in geometry.js): the same pieces the old loop over
  // every wall found, met in the same order.
  const walls = map.walls;
  RAY_WALLS = wallScratch(map, RAY_WALLS);
  const nw = wallsOnRay(map, ox, oz, dx, dz, range, RAY_WALLS);
  for (let q = 0; q < nw; q++) {
    const w = walls[RAY_WALLS[q]];
    if (w.blocksBullet) {
      if (raySpan(ox, oz, dx, dz, w) && spanIn < S.hardT && spanIn < range) { S.hardT = spanIn; S.hardNx = spanNx; S.hardNz = spanNz; }
    } else if (!overCover && isWaistCover(w)) {
      if (!raySpan(ox, oz, dx, dz, w) || spanIn >= range) continue;
      // Insertion sort by entry distance; a ray crosses a handful of props at most.
      let j = S.count++;
      while (j > 0 && S.inT[j - 1] > spanIn) {
        S.inT[j] = S.inT[j - 1]; S.outT[j] = S.outT[j - 1]; S.nx[j] = S.nx[j - 1]; S.nz[j] = S.nz[j - 1]; S.own[j] = S.own[j - 1]; S.proof[j] = S.proof[j - 1]; j--;
      }
      S.inT[j] = spanIn; S.outT[j] = spanOut; S.nx[j] = spanNx; S.nz[j] = spanNz; S.own[j] = ownCover(ox, oz, w, spanIn);
      S.proof[j] = !!w.proof;          // A Bulwark (js/sim/equipment.js): waist-high, but no round goes through it.
    }
  }
  if (S.count === 0) return;
  // Abutting props are one piece of cover, so a stall built from two boxes costs one penetration, and a stall the
  // shooter is hugging is fired over as a whole. Own pieces are then dropped: only cover further along counts.
  let n = 0, groupOwn = S.own[0], groupProof = S.proof[0];
  for (let i = 1; i <= S.count; i++) {
    if (i < S.count && S.inT[i] <= S.outT[n] + 0.05) {
      S.outT[n] = Math.max(S.outT[n], S.outT[i]);
      groupProof = groupProof || S.proof[i];
      continue;
    }
    if (!groupOwn) { S.proof[n] = groupProof; n++; }   // Keep the finished group unless it is the shooter's own.
    if (i < S.count) {
      S.inT[n] = S.inT[i]; S.outT[n] = S.outT[i]; S.nx[n] = S.nx[i]; S.nz[n] = S.nz[i]; groupOwn = S.own[i]; groupProof = S.proof[i];
    }
  }
  S.count = n;
  if (n === 0) return;
  // A light round stops on the first piece; a penetrating one gives out after MAX_COVER_PIECES, or at a proof piece.
  let stopAt = penetrate ? MAX_COVER_PIECES : 0;
  for (let i = 0; i < stopAt && i < n; i++) if (S.proof[i]) { stopAt = i; break; }
  if (n > stopAt) { S.stopT = S.inT[stopAt]; S.stopNx = S.nx[stopAt]; S.stopNz = S.nz[stopAt]; S.count = stopAt; }
}

// Damage multiplier left after the pieces of cover a round entered before distance t. 1 when none.
function penAt(t, penetrate) {
  let k = 1;
  for (let i = 0; i < SEG.count && SEG.inT[i] < t; i++) k *= penetrate;
  return k;
}

// Can this gun's round travel from a to b? 0 when a solid or cover stops it first, else the damage multiplier left.
export function shotPassage(map, ax, az, bx, bz, w) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-6) return 1;
  if (len > w.range) return 0;
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  walkRay(map, ax, az, dx, dz, w.range, w.penetrate, !!w.explosive);
  if (Math.min(SEG.hardT, SEG.stopT) < len) return 0;
  return penAt(len, w.penetrate);
}

// Resolves a shot against walls, cover and players. `def` is the shooter's effective def when the caller knows it
// (the host does); otherwise the range and penetrate the shot carries are used. Bullets stop at the first enemy;
// teammates are passed through when the entries carry a `team` (GameView players do), matching no-friendly-fire
// rules. See RAY CONTRACT at the top of this file. Entries may carry `sliding`, which shrinks the body not the head.
export function traceShot(shot, map, players, selfId, def) {
  const w = WEAPONS[shot.weapon];
  const range = def ? def.range : (shot.range || (w ? w.range : 60));
  const penetrate = def ? def.penetrate : (shot.penetrate ?? (w ? w.penetrate : undefined));
  const overCover = !!(def || w || {}).explosive;
  const ox = shot.ox, oz = shot.oz;
  let selfTeam;
  for (let i = 0; i < players.length; i++) {
    if (players[i].id === selfId) { selfTeam = players[i].team; break; }
  }
  const n = shot.angles.length;
  // A pellet gun's head zone is judged on the centre of its fan, or the fan's width would find the head every time.
  let fanX = 0, fanZ = 0, fanStop = 0;
  if (n > 1) {
    let sum = 0;
    for (let a = 0; a < n; a++) sum += shot.angles[a];
    fanX = Math.cos(sum / n); fanZ = Math.sin(sum / n);
    walkRay(map, ox, oz, fanX, fanZ, range, penetrate, overCover);
    fanStop = Math.min(SEG.hardT, SEG.stopT, range);
  }
  const rays = new Array(n);
  for (let a = 0; a < n; a++) {
    const dirX = Math.cos(shot.angles[a]), dirZ = Math.sin(shot.angles[a]);
    walkRay(map, ox, oz, dirX, dirZ, range, penetrate, overCover);
    // The first thing that can end this ray: range, a solid, or cover the round cannot pass.
    const coverStops = SEG.stopT < SEG.hardT;
    const stopT = Math.min(SEG.hardT, SEG.stopT, range);
    let bestT = stopT;
    let target = null;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.id === selfId || !p.alive) continue;
      if (selfTeam !== undefined && p.team === selfTeam) continue;
      const t = rayCircle(ox, oz, dirX, dirZ, p.x, p.z, p.sliding ? SLIDE_HIT_RADIUS : HIT_RADIUS);
      if (t >= 0 && t < bestT) { bestT = t; target = p; }
    }
    const x = ox + dirX * bestT, z = oz + dirZ * bestT;
    if (target) {
      const fx = target.x - ox, fz = target.z - oz;
      const lineX = n > 1 ? fanX : dirX, lineZ = n > 1 ? fanZ : dirZ;
      const miss = Math.abs(fx * lineZ - fz * lineX), along = fx * lineX + fz * lineZ;
      // The head is at the centre of the body: a round stopped before reaching that point only clipped an edge.
      let head = miss <= HEAD_RADIUS && along <= (n > 1 ? fanStop : stopT);
      if (head && n > 1) for (let j = 0; j < a; j++) if (rays[j].head && rays[j].id === target.id) { head = false; break; }
      const ray = { x, z, hit: 'player', nx: -dirX, nz: -dirZ, id: target.id, target: target.id, head };
      const k = penetrate ? penAt(bestT, penetrate) : 1;
      if (k < 1) ray.pen = k;
      rays[a] = ray;
    } else if (stopT < range) {
      const ray = coverStops ? { x, z, hit: 'wall', nx: SEG.stopNx, nz: SEG.stopNz, cover: true }
                             : { x, z, hit: 'wall', nx: SEG.hardNx, nz: SEG.hardNz };
      if (!coverStops && penetrate) { const k = penAt(bestT, penetrate); if (k < 1) ray.pen = k; }
      rays[a] = ray;
    } else {
      const ray = { x, z, hit: 'none', nx: 0, nz: 0 };
      if (penetrate) { const k = penAt(bestT, penetrate); if (k < 1) ray.pen = k; }
      rays[a] = ray;
    }
  }
  return rays;
}

// Stick aim -> assisted aim. Two things, both only while the aim is over (or just beside) a visible enemy's body:
//   friction   part of the stick's own rotation is cancelled, so a thumb's wander stays on the target;
//   tracking   part of the target's sideways drift across the view (its strafe, and the player's own) is followed, so
//              a strafing target does not slide out from under a thumb that is holding still. V10: a thumb is a
//              position, not a rate, and cannot lead a strafe the way a bot's turn does.
// Neither ever turns the aim toward a target: tracking follows a fraction of the bearing's change, never the gap to
// the centre, so landing on the body and finding the head stay the player's skill, and a target that outruns the
// offset cap simply walks out of it. All state is on ps, so taking the thumb off the stick or losing the target
// releases it. Bots never come through here.
export function applyAimAssist(aim, ps, players, map, dt) {
  if (typeof aim !== 'number') { ps.aaRaw = null; ps.aaId = null; return aim; }
  const reach = TUNING.assistReach, range = TUNING.assistRange;
  const cone = ASSIST_CONE * reach, zone = Math.max(1.05, ASSIST_EDGE * reach);
  const maxOffset = ASSIST_MAX_OFFSET * TUNING.assist;
  let bestAbs = cone, bestEdge = 0, found = null, bestBearing = 0;
  const selfTeam = selfTeamOf(ps, players);
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.id === ps.id || !p.alive) continue;
    if (selfTeam !== undefined && p.team === selfTeam) continue;
    const dx = p.x - ps.x, dz = p.z - ps.z;
    const dSq = dx * dx + dz * dz;
    if (dSq > range * range || dSq < 0.04) continue;
    const bearing = Math.atan2(dz, dx);
    const abs = Math.abs(angleDiff(bearing, aim + ps.aaOffset));
    const edge = Math.min(cone, Math.asin(Math.min(1, HIT_RADIUS / Math.sqrt(dSq))));
    if (abs >= bestAbs || abs >= edge * zone) continue;
    if (!hasLineOfSight(map, ps.x, ps.z, p.x, p.z)) continue;
    bestAbs = abs; bestEdge = edge; found = p; bestBearing = bearing;
  }
  const rawDelta = ps.aaRaw === null ? 0 : angleDiff(aim, ps.aaRaw);
  ps.aaRaw = aim;
  if (found) {
    const fade = bestAbs <= bestEdge ? 1 : 1 - (bestAbs - bestEdge) / (bestEdge * (zone - 1));
    // Capped below 1: a full cancel would glue the aim to the target and the stick could not pull it off.
    const friction = Math.min(0.9, (ASSIST_FRICTION + 0.3 * ps.adsT) * TUNING.assistSlow);
    ps.aaOffset -= rawDelta * friction * fade;
    // Tracking: only for the target the aim was already on last frame, and never more than a brisk strafe's worth
    // in one frame (a respawn or a snapshot jump is not a strafe).
    if (ps.aaId === found.id) {
      const drift = angleDiff(bestBearing, ps.aaBearing);
      const lim = ASSIST_TRACK_RATE * dt;
      ps.aaOffset += Math.max(-lim, Math.min(lim, drift)) * Math.min(0.9, (ASSIST_TRACK + 0.15 * ps.adsT) * TUNING.assistSlow) * fade;
    }
    ps.aaId = found.id; ps.aaBearing = bestBearing;
    ps.aaOffset = Math.max(-maxOffset, Math.min(maxOffset, ps.aaOffset));
  } else {
    // Release quickly so aim never feels sticky once nothing is there.
    ps.aaId = null;
    ps.aaOffset *= Math.max(0, 1 - 9 * dt);
    if (Math.abs(ps.aaOffset) < 1e-4) ps.aaOffset = 0;
  }
  return aim + ps.aaOffset;
}

function selfTeamOf(ps, players) {
  for (let i = 0; i < players.length; i++) if (players[i].id === ps.id) return players[i].team;
  return undefined;
}

// Wire format: one flat array. Bits in the flags value: 1 slot, 2 sprinting, 4 sliding, 8 overheated.
export function encodeHumanState(ps) {
  return [
    Math.round(ps.x * 100), Math.round(ps.z * 100), Math.round(ps.aim * 1000),
    Math.round(ps.vx * 10), Math.round(ps.vz * 10),
    (ps.slot & 1) | (ps.sprinting ? 2 : 0) | (ps.sliding ? 4 : 0) | (ps.overheated ? 8 : 0),
    WEAPON_IDS.indexOf(ps.primary), ps.ammo[0], ps.ammo[1], ps.reserve[0], ps.reserve[1],
    Math.round(ps.reloadT * 100), Math.round(ps.reloadDur * 100),
    Math.round(ps.adsT * 100), Math.round(ps.bloom * 100),
    ps.camo,
    Math.round(ps.heat * 100), Math.round(ps.firingT * 10),
    WEAPON_IDS.indexOf(ps.secondary),
  ];
}

export function decodeHumanState(d) {
  const flags = d[5];
  const slot = flags & 1;
  const primary = WEAPON_IDS[d[6]] || 'ar';
  const secondary = WEAPON_IDS[d[18]] || SECONDARY_ID;
  return {
    x: d[0] / 100, z: d[1] / 100, aim: d[2] / 1000,
    vx: d[3] / 10, vz: d[4] / 10,
    slot, primary, secondary, weapon: slot === 0 ? primary : secondary,
    sprinting: !!(flags & 2), sliding: !!(flags & 4),
    ammo: [d[7], d[8]], reserve: [d[9], d[10]],
    reloadT: d[11] / 100, reloadDur: d[12] / 100,
    adsT: d[13] / 100, bloom: d[14] / 100,
    camo: d[15],
    overheated: !!(flags & 8), heat: (d[16] || 0) / 100, firingT: (d[17] || 0) / 10,
  };
}

// ---- Pro senses: what Keen Ears and Footprints let a player perceive. Pure, run wherever the view is (the HUD). ----

export const HEAR_RANGE = 14;          // Keen Ears (Dead Silence Pro): metres a sprinting enemy is heard from.

// Enemies the local player hears: alive, sprinting, within HEAR_RANGE, and not running Dead Silence themselves (a view
// player's `quiet`). Fills and returns `out`.
export function heardEnemies(view, me, out = []) {
  out.length = 0;
  if (!me || !me.alive) return out;
  for (let i = 0; i < view.players.length; i++) {
    const p = view.players[i];
    if (p.team === me.team || !p.alive || !p.sprinting || p.quiet) continue;
    if (Math.hypot(p.x - me.x, p.z - me.z) <= HEAR_RANGE) out.push(p);
  }
  return out;
}

export const PRINT_LIFE = 4;           // Footprints (Tracker Pro): seconds a print stays on the ground.
export const PRINT_STRIDE = 1.15;      // Metres between prints.
export const PRINT_RANGE = 30;         // Metres from the player a print can be seen at.
const PRINT_MAX = 160;

// Enemy footprints. update() every frame with the view; prints are left where enemies walked, alternating feet, and
// fade over PRINT_LIFE. Only prints the player has line of sight to are returned by visible(), so they lead round
// corners without seeing through them. Fixed pool; no allocation once warm.
export class Footprints {
  constructor() {
    this.pool = Array.from({ length: PRINT_MAX }, () => ({ x: 0, z: 0, a: 0, t: -99, side: 1 }));
    this.next = 0;
    this.last = new Map();       // Enemy id -> {x, z, side} of their last print.
    this.out = [];
  }

  reset() {
    for (const p of this.pool) p.t = -99;
    this.last.clear();
  }

  update(view, me, now) {
    if (!me) return;
    for (let i = 0; i < view.players.length; i++) {
      const p = view.players[i];
      if (p.team === me.team) continue;
      let l = this.last.get(p.id);
      if (!l) this.last.set(p.id, l = { x: p.x, z: p.z, side: 1 });
      if (!p.alive) { l.x = p.x; l.z = p.z; continue; }
      const dx = p.x - l.x, dz = p.z - l.z, d = Math.hypot(dx, dz);
      if (d < PRINT_STRIDE) continue;
      // A jump this long is a respawn or a teleport, not a walk.
      if (d < PRINT_STRIDE * 6) {
        const f = this.pool[this.next];
        this.next = (this.next + 1) % PRINT_MAX;
        const a = Math.atan2(dz, dx);
        l.side = -l.side;
        f.x = p.x + Math.cos(a + Math.PI / 2) * 0.16 * l.side;
        f.z = p.z + Math.sin(a + Math.PI / 2) * 0.16 * l.side;
        f.a = a; f.t = now; f.side = l.side;
      }
      l.x = p.x; l.z = p.z;
    }
  }

  // Prints still fresh, within PRINT_RANGE and in sight of `me`. Each carries `k`, 1 when new and 0 at PRINT_LIFE.
  visible(map, me, now, smokes) {
    const out = this.out;
    out.length = 0;
    if (!me || !me.alive) return out;
    for (let i = 0; i < PRINT_MAX; i++) {
      const f = this.pool[i], age = now - f.t;
      if (age < 0 || age >= PRINT_LIFE) continue;
      if (Math.hypot(f.x - me.x, f.z - me.z) > PRINT_RANGE) continue;
      if (!hasLineOfSight(map, me.x, me.z, f.x, f.z, smokes)) continue;
      f.k = 1 - age / PRINT_LIFE;
      out.push(f);
    }
    return out;
  }
}
