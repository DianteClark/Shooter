// Player movement, weapon handling and shot tracing. The same code drives humans (every render
// frame with a variable dt) and bots (30 Hz on the host). No DOM, no three, no per-frame garbage:
// the only allocations are the shot/ray objects that exist because a gun actually fired.

import { PLAYER_RADIUS, SECONDARY_ID, SECONDARY_IDS, WEAPON_IDS } from '../shared/constants.js';
import { hasLineOfSight, raycastMap, rayCircle, resolveCircle } from '../shared/geometry.js';
import { HEAD_RADIUS, WEAPONS, effectiveWeapon } from '../shared/weapons.js';
import { attachmentsFor, NO_ATTACHMENTS } from '../shared/attachments.js';
import { DEFAULT_LOADOUT, LETHALS, TACTICALS } from '../shared/catalog.js';

export { HEAD_RADIUS, headMultFor } from '../shared/weapons.js';

const MAX_DT = 0.05;

// Movement feel. Acceleration is deliberately very high: the stick should feel directly wired to the
// body, with only the sprint build-up and the slide giving a sense of weight.
export const MOVE = {
  run: 5.6,
  sprint: 7.9,
  accel: 75,
  decel: 62,
  sprintAccel: 26,       // Only the part of the speed above a run builds slowly.
  turnRate: 16,          // rad/s, facing toward movement when the right stick is idle.
  slideMinSpeed: 3.6,
  slideBoost: 11.6,      // Entry speed, or 1.25x current speed if that is higher.
  slideDuration: 0.58,
  slideEndSpeed: 4.6,
  slideSteer: 2.2,       // rad/s of direction change the left stick can still apply mid-slide.
  slideCooldown: 1.15,   // Starts when the slide ends.
  slideRecoverMult: 0.4, // Sliding pays off most of the sprint-to-fire delay.
};

const NO_SHOTS = Object.freeze([]);
const HIT_RADIUS = PLAYER_RADIUS + 0.1;
const SLIDE_HIT_RADIUS = HIT_RADIUS * 0.72;   // Slide dodge: a sliding player is a smaller target.
const SHOT_INDEX_RESET = 0.26;  // Seconds off the trigger before the recoil pattern restarts.
const BLOOM_RECOVER_DELAY = 0.09;
const ADS_OUT_RATE = 1.35;      // Leaving ADS is quicker than entering it.
const ADS_FULL = 0.85;          // Counts as fully aimed for adsGate weapons.
const TOPOFF_DELAY = 1.2;       // Seconds without firing or aiming before a part-empty mag tops itself off.
const TOPOFF_BELOW = 0.7;       // Fraction of the magazine under which that happens.
const DRIFT_SHOTS = 12;         // pattern.drift stops adding up after this many rounds of a string.
export const FIRING_REVEAL = 1.5;   // firingT after a shot: seconds shown on the enemy minimap.

const FASTHANDS_MULT = 0.72;    // Reload and swap time.
const MARATHON_SPRINT = 1.08;
const MARATHON_SLIDE_COOL = 0.6;

const ASSIST_RANGE = 30;
const ASSIST_CONE = 8 * Math.PI / 180;
const ASSIST_EDGE = 1.25;       // Friction fades out between the body's edge and this multiple of it.
const ASSIST_MAX_OFFSET = 6 * Math.PI / 180;

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
function reloadMult(ps) { return hasPerk(ps, 'fasthands') ? FASTHANDS_MULT : 1; }
function slideCooldownOf(ps) { return MOVE.slideCooldown * (hasPerk(ps, 'marathon') ? MARATHON_SLIDE_COOL : 1); }

// Takes a full normalized loadout or the older partial {primary, camo}; absent fields are left alone.
function applyLoadout(ps, l) {
  if (l.primary && WEAPONS[l.primary]) ps.primary = l.primary;
  if (SECONDARY_IDS.includes(l.secondary)) ps.secondary = l.secondary;
  if (l.camo) ps.camo = l.camo;
  if (Array.isArray(l.perks)) ps.perks = l.perks.slice();
  if (TACTICALS[l.tactical]) ps.tactical = l.tactical;
  if (LETHALS[l.lethal]) ps.lethal = l.lethal;
  if (l.attachments && typeof l.attachments === 'object') ps.attachments = l.attachments;
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

export function createPlayerState({ id, primary = 'ar', camo = 'none', loadout } = {}) {
  const ps = {
    id, x: 0, z: 0, aim: 0, vx: 0, vz: 0,
    slot: 0, primary, secondary: SECONDARY_ID, weapon: primary, camo,
    attachments: NO_ATTACHMENTS, defs: [WEAPONS[primary], WEAPONS[SECONDARY_ID]],
    perks: [], tactical: DEFAULT_LOADOUT.tactical, lethal: DEFAULT_LOADOUT.lethal,
    tacticalLeft: 0, lethalLeft: 0,
    heat: 0, overheated: false, overheatT: 0, overheatEdge: false, firingT: 0,
    ammo: [0, 0], reserve: [0, 0],
    reloadT: 0, reloadDur: 0, adsT: 0,
    sprinting: false, sprintRecoverT: 0,
    sliding: false, slideT: 0, slideCool: 0,
    cooldown: 0, bloom: 0, shotIndex: 0,
    // Internal, not part of the wire format.
    swapT: 0, shellT: 0, sinceShot: 9, triggerDown: false, armed: false, burstLeft: 0,
    heatIdle: 9, calmT: 0,
    slideDirX: 0, slideDirZ: 0, slideSpeed: 0,
    aaOffset: 0, aaRaw: null,
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
}

// Places a player at a spawn point, full ammo and equipment, every timer cleared.
// Optional new loadout: a normalized loadout, {loadout}, or the older {primary, camo}.
export function respawnPlayer(ps, x, z, aim, loadout) {
  if (loadout) applyLoadout(ps, loadout.loadout || loadout);
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
  ps.swapT = 0; ps.sinceShot = 9; ps.triggerDown = false; ps.armed = false; ps.burstLeft = 0;
  ps.aaOffset = 0; ps.aaRaw = null;
  return ps;
}

function setSlot(ps, slot) {
  ps.slot = slot;
  ps.weapon = slot === 0 ? ps.primary : ps.secondary;
  const w = weaponDef(ps);
  ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0;
  ps.shotIndex = 0; ps.bloom = 0; ps.burstLeft = 0;
  ps.adsT *= 0.4;
  ps.swapT = w.swapTime * reloadMult(ps);
  ps.cooldown = Math.max(ps.cooldown, ps.swapT);
}

function startReload(ps, w) {
  const i = ps.slot;
  const missing = w.magazine - ps.ammo[i];
  if (ps.reloadT > 0 || missing <= 0) return;
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

function stepReload(ps, w, dt) {
  if (ps.reloadT <= 0) return;
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
  return s;
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
  ps.ammo[ps.slot]--;
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

  // Sprint: broken by aiming or firing, which then costs sprintToFire before the first shot.
  const marathon = hasPerk(ps, 'marathon');
  const wantsSprint = !!input.sprint && moveLen > 0.5 && !input.aiming && !input.fire && !ps.sliding;
  ps.sprinting = wantsSprint;
  if (ps.sprinting) ps.sprintRecoverT = w.sprintToFire;
  else if (ps.sprintRecoverT > 0) ps.sprintRecoverT -= dt;

  const speedNow = Math.hypot(ps.vx, ps.vz);
  if (input.slide && !ps.sliding && ps.slideCool <= 0 && speedNow >= MOVE.slideMinSpeed) {
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
    const base = (ps.sprinting ? MOVE.sprint * (marathon ? MARATHON_SPRINT : 1) : MOVE.run) * w.moveMult;
    const speed = ps.sprinting ? base : base * (1 + (w.adsMoveMult - 1) * ps.adsT);
    const scale = moveLen > 1 ? 1 / moveLen : 1;
    const tx = mx * scale * speed, tz = mz * scale * speed;
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
  ps.x = nextX; ps.z = nextZ;
  resolveCircle(map, ps, PLAYER_RADIUS);
  // Convert any push-out back into velocity so a wall scrubs speed instead of being pushed against.
  if (ps.x !== nextX || ps.z !== nextZ) {
    ps.vx = (ps.x - ox) / dt;
    ps.vz = (ps.z - oz) / dt;
    if (ps.sliding) {
      ps.slideSpeed = Math.min(ps.slideSpeed, Math.hypot(ps.vx, ps.vz) + MOVE.slideEndSpeed);
      if (Math.hypot(ps.vx, ps.vz) < 1.2) { ps.sliding = false; ps.slideCool = slideCooldownOf(ps); }
    }
  }

  // Facing: right stick wins; with it idle, turn to face the direction of travel.
  if (typeof input.aim === 'number') {
    if (w.turnCap && (input.aiming || input.fire)) {
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
  if (input.swap) setSlot(ps, ps.slot === 0 ? 1 : 0);
  if (ps.swapT > 0) ps.swapT -= dt;

  let w = weaponDef(ps);
  stepMovement(ps, input, w, dt, map);

  // ADS blocked by sprinting, swapping and magazine reloads; a shell-fed gun can stay up.
  const wantAds = !!input.aiming && !ps.sprinting && ps.swapT <= 0 && (ps.reloadT <= 0 || !!w.shellReload);
  const rate = dt / w.adsTime;
  ps.adsT = wantAds ? Math.min(1, ps.adsT + rate) : Math.max(0, ps.adsT - rate * ADS_OUT_RATE);

  stepReload(ps, w, dt);
  stepHeat(ps, dt);

  ps.sinceShot += dt;
  ps.cooldown -= dt;
  if (ps.firingT > 0) ps.firingT = Math.max(0, ps.firingT - dt);

  const trigger = !!input.fire;
  ps.calmT = trigger || input.aiming ? 0 : ps.calmT + dt;
  // A press stays armed until it fires or is released, so a semi-auto pressed during sprint-out,
  // a swap or the last moments of its cycle goes off the instant the gun is ready.
  if (!trigger) ps.armed = false;
  else if (!ps.triggerDown) ps.armed = true;
  ps.triggerDown = trigger;

  // Firing with rounds left cancels any reload; progress on a magazine swap is lost.
  if (trigger && ps.reloadT > 0 && ps.ammo[ps.slot] > 0 && !isLocked(ps, w)) {
    ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0;
  }

  // A burst, once started, finishes whether or not the finger stayed down; sprinting abandons it.
  if (ps.sprinting) ps.burstLeft = 0;
  let shots = NO_SHOTS;
  if ((trigger || ps.burstLeft > 0) && ps.reloadT <= 0 && ps.swapT <= 0 && ps.sprintRecoverT <= 0) {
    for (let guard = 0; guard < 4 && ps.cooldown <= 0 && ps.ammo[ps.slot] > 0 && !isLocked(ps, w); guard++) {
      if (!w.auto && !ps.armed && (!w.holdRpm || ps.sinceShot < 60 / w.holdRpm)) break;
      let interval;
      if (w.burst) {
        if (ps.burstLeft <= 0) ps.burstLeft = w.burst.count;
        ps.burstLeft--;
        interval = ps.burstLeft > 0 ? w.burst.gap : burstRecovery(w);
      } else {
        interval = shotInterval(w, ps.shotIndex);
      }
      const shot = fireOne(ps, w, rng);
      ps.armed = false;
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

  // Auto-reload on empty; if the gun is completely dry, fall through to the other one.
  // There is no reload button, so a part-empty magazine also tops itself off in a quiet moment.
  if (ps.ammo[ps.slot] <= 0 && ps.reloadT <= 0 && ps.cooldown <= 0) {
    if (ps.reserve[ps.slot] > 0 || w.unlimitedReserve) startReload(ps, w);
    else if (ps.ammo[1 - ps.slot] > 0 || ps.reserve[1 - ps.slot] > 0) setSlot(ps, 1 - ps.slot);
  } else if (ps.calmT >= TOPOFF_DELAY && ps.swapT <= 0 && ps.ammo[ps.slot] < w.magazine * TOPOFF_BELOW) {
    startReload(ps, w);
  }
  return shots;
}

// Resolves a shot against walls and players. `def` is the shooter's effective def when the caller knows it (the
// host does); otherwise the range the shot carries is used. Bullets stop at the first enemy; teammates are passed
// through when the entries carry a `team` (GameView players do), matching no-friendly-fire rules.
// A ray that hits a player carries `target` (and `id`, the same value) and `head`: whether it passed
// within HEAD_RADIUS of the centre. Entries may carry `sliding`, which shrinks the body but not the head.
export function traceShot(shot, map, players, selfId, def) {
  const w = WEAPONS[shot.weapon];
  const range = def ? def.range : (shot.range || (w ? w.range : 60));
  const ox = shot.ox, oz = shot.oz;
  let selfTeam;
  for (let i = 0; i < players.length; i++) {
    if (players[i].id === selfId) { selfTeam = players[i].team; break; }
  }
  const n = shot.angles.length;
  const rays = new Array(n);
  for (let a = 0; a < n; a++) {
    const dirX = Math.cos(shot.angles[a]), dirZ = Math.sin(shot.angles[a]);
    const wall = raycastMap(map, ox, oz, dirX, dirZ, range, 'blocksBullet');
    let bestT = wall ? wall.t : range;
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
      const miss = Math.abs((target.x - ox) * dirZ - (target.z - oz) * dirX);
      rays[a] = { x, z, hit: 'player', nx: -dirX, nz: -dirZ, id: target.id, target: target.id, head: miss <= HEAD_RADIUS };
    }
    else if (wall) rays[a] = { x, z, hit: 'wall', nx: wall.nx, nz: wall.nz };
    else rays[a] = { x, z, hit: 'none', nx: 0, nz: 0 };
  }
  return rays;
}

// Stick aim -> assisted aim. Friction only: while the aim is over a visible enemy's body, part of the
// stick's rotation is cancelled so it is easier to stay on target. Nothing ever moves the aim on its
// own, so landing on the head stays the player's skill. All state is the offset on ps, so taking the
// thumb off the stick or losing the target releases it.
export function applyAimAssist(aim, ps, players, map, dt) {
  if (typeof aim !== 'number') { ps.aaRaw = null; return aim; }
  let bestAbs = ASSIST_CONE, bestEdge = 0, found = false;
  const selfTeam = selfTeamOf(ps, players);
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.id === ps.id || !p.alive) continue;
    if (selfTeam !== undefined && p.team === selfTeam) continue;
    const dx = p.x - ps.x, dz = p.z - ps.z;
    const dSq = dx * dx + dz * dz;
    if (dSq > ASSIST_RANGE * ASSIST_RANGE || dSq < 0.04) continue;
    const abs = Math.abs(angleDiff(Math.atan2(dz, dx), aim + ps.aaOffset));
    const edge = Math.min(ASSIST_CONE, Math.asin(Math.min(1, HIT_RADIUS / Math.sqrt(dSq))));
    if (abs >= bestAbs || abs >= edge * ASSIST_EDGE) continue;
    if (!hasLineOfSight(map, ps.x, ps.z, p.x, p.z)) continue;
    bestAbs = abs; bestEdge = edge; found = true;
  }
  const rawDelta = ps.aaRaw === null ? 0 : angleDiff(aim, ps.aaRaw);
  ps.aaRaw = aim;
  if (found) {
    const fade = bestAbs <= bestEdge ? 1 : 1 - (bestAbs - bestEdge) / (bestEdge * (ASSIST_EDGE - 1));
    ps.aaOffset -= rawDelta * (0.32 + 0.3 * ps.adsT) * fade;
    ps.aaOffset = Math.max(-ASSIST_MAX_OFFSET, Math.min(ASSIST_MAX_OFFSET, ps.aaOffset));
  } else {
    // Release quickly so aim never feels sticky once nothing is there.
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
