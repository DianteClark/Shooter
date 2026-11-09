// Player movement, weapon handling and shot tracing. The same code drives humans (every render
// frame with a variable dt) and bots (30 Hz on the host). No DOM, no three, no per-frame garbage:
// the only allocations are the shot/ray objects that exist because a gun actually fired.

import { PLAYER_RADIUS, SECONDARY_ID, WEAPON_IDS } from '../shared/constants.js';
import { hasLineOfSight, raycastMap, rayCircle, resolveCircle } from '../shared/geometry.js';
import { WEAPONS } from '../shared/weapons.js';

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
const SHOT_INDEX_RESET = 0.26;  // Seconds off the trigger before the recoil pattern restarts.
const BLOOM_RECOVER_DELAY = 0.09;
const ADS_OUT_RATE = 1.35;      // Leaving ADS is quicker than entering it.
const ADS_FULL = 0.85;          // Counts as fully aimed for adsGate weapons.

const ASSIST_RANGE = 30;
const ASSIST_CONE = 8 * Math.PI / 180;
const ASSIST_MAX_OFFSET = 6 * Math.PI / 180;

const TAU = Math.PI * 2;

export function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

function reserveFor(w) { return w.reserve; }

export function createPlayerState({ id, primary = 'ar', camo = 'none' } = {}) {
  const ps = {
    id, x: 0, z: 0, aim: 0, vx: 0, vz: 0,
    slot: 0, primary, secondary: SECONDARY_ID, weapon: primary, camo,
    ammo: [0, 0], reserve: [0, 0],
    reloadT: 0, reloadDur: 0, adsT: 0,
    sprinting: false, sprintRecoverT: 0,
    sliding: false, slideT: 0, slideCool: 0,
    cooldown: 0, bloom: 0, shotIndex: 0,
    // Internal, not part of the wire format.
    swapT: 0, shellT: 0, sinceShot: 9, triggerDown: false, armed: false,
    slideDirX: 0, slideDirZ: 0, slideSpeed: 0,
    aaOffset: 0, aaRaw: null,
  };
  fillAmmo(ps);
  return ps;
}

function fillAmmo(ps) {
  const a = WEAPONS[ps.primary], b = WEAPONS[ps.secondary];
  ps.ammo[0] = a.magazine; ps.ammo[1] = b.magazine;
  ps.reserve[0] = reserveFor(a); ps.reserve[1] = reserveFor(b);
}

// Places a player at a spawn point, full ammo, every timer cleared. Optional new loadout.
export function respawnPlayer(ps, x, z, aim, loadout) {
  if (loadout) {
    if (loadout.primary && WEAPONS[loadout.primary]) ps.primary = loadout.primary;
    if (loadout.camo) ps.camo = loadout.camo;
  }
  ps.x = x; ps.z = z; ps.aim = aim; ps.vx = 0; ps.vz = 0;
  ps.slot = 0; ps.weapon = ps.primary;
  fillAmmo(ps);
  ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0; ps.adsT = 0;
  ps.sprinting = false; ps.sprintRecoverT = 0;
  ps.sliding = false; ps.slideT = 0; ps.slideCool = 0;
  ps.cooldown = 0; ps.bloom = 0; ps.shotIndex = 0;
  ps.swapT = 0; ps.sinceShot = 9; ps.triggerDown = false; ps.armed = false;
  ps.aaOffset = 0; ps.aaRaw = null;
  return ps;
}

function setSlot(ps, slot) {
  ps.slot = slot;
  ps.weapon = slot === 0 ? ps.primary : ps.secondary;
  const w = WEAPONS[ps.weapon];
  ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0;
  ps.shotIndex = 0; ps.bloom = 0;
  ps.adsT *= 0.4;
  ps.swapT = w.swapTime;
  ps.cooldown = Math.max(ps.cooldown, w.swapTime);
}

function startReload(ps, w) {
  const i = ps.slot;
  const missing = w.magazine - ps.ammo[i];
  if (ps.reloadT > 0 || missing <= 0) return;
  if (ps.reserve[i] <= 0 && !w.unlimitedReserve) return;
  if (w.shellReload) {
    // reloadT / reloadDur cover the whole loop so the HUD ring stays simple; shellT paces each round.
    const n = Math.min(missing, ps.reserve[i]);
    ps.reloadDur = n * w.reload;
    ps.shellT = w.reload;
  } else {
    ps.reloadDur = w.reload;
  }
  ps.reloadT = ps.reloadDur;
  ps.shotIndex = 0;
}

function stepReload(ps, w, dt) {
  if (ps.reloadT <= 0) return;
  const i = ps.slot;
  ps.reloadT -= dt;
  if (w.shellReload) {
    ps.shellT -= dt;
    while (ps.shellT <= 0 && ps.ammo[i] < w.magazine && ps.reserve[i] > 0) {
      ps.ammo[i]++; ps.reserve[i]--;
      ps.shellT += w.reload;
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
export function currentSpread(ps, w = WEAPONS[ps.weapon]) {
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

function fireOne(ps, w, rng) {
  const spread = currentSpread(ps, w);
  const n = w.pellets || 1;
  const angles = new Array(n);
  let kick = 0;
  if (w.pattern) {
    const p = w.pattern;
    kick = p.amp * Math.sin(ps.shotIndex * p.freq) * Math.min(1, ps.shotIndex / p.ramp) * (1 - 0.55 * ps.adsT);
  }
  if (n === 1) {
    angles[0] = ps.aim + kick + (rng() + rng() - 1) * spread;
  } else {
    // A fan with light jitter, not pure randomness: a shotgun that randomly whiffs feels broken.
    for (let i = 0; i < n; i++) {
      const lane = ((i + 0.5) / n) * 2 - 1;
      angles[i] = ps.aim + (lane + (rng() - 0.5) * 0.28) * spread;
    }
  }
  const shot = {
    ox: ps.x, oz: ps.z, aim: ps.aim, weapon: ps.weapon, angles,
    ads: ps.adsT >= ADS_FULL,
  };
  ps.ammo[ps.slot]--;
  ps.shotIndex++;
  ps.sinceShot = 0;
  if (w.settle && ps.shotIndex > w.settle.after) ps.bloom = Math.max(0, ps.bloom - w.settle.recover);
  else ps.bloom = Math.min(1, ps.bloom + w.bloomPerShot * (1 - 0.4 * ps.adsT));
  if (w.boltKick !== undefined) ps.adsT = Math.min(ps.adsT, w.boltKick);
  return shot;
}

function stepMovement(ps, input, w, dt, map) {
  const mx = input.mx || 0, mz = input.mz || 0;
  const moveLen = Math.hypot(mx, mz);

  if (ps.slideCool > 0) ps.slideCool -= dt;

  // Sprint: broken by aiming or firing, which then costs sprintToFire before the first shot.
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
    if (ps.slideT <= 0) { ps.sliding = false; ps.slideCool = MOVE.slideCooldown; }
  } else {
    const base = (ps.sprinting ? MOVE.sprint : MOVE.run) * w.moveMult;
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
      if (Math.hypot(ps.vx, ps.vz) < 1.2) { ps.sliding = false; ps.slideCool = MOVE.slideCooldown; }
    }
  }

  // Facing: right stick wins; with it idle, turn to face the direction of travel.
  if (typeof input.aim === 'number') {
    ps.aim = input.aim;
  } else if (moveLen > 0.2) {
    const d = angleDiff(Math.atan2(mz, mx), ps.aim);
    ps.aim += Math.sign(d) * Math.min(Math.abs(d), MOVE.turnRate * dt);
  }
}

// Advances one player by dt and returns the shots fired this frame.
export function stepPlayer(ps, input, dt, map, rng = Math.random) {
  if (!(dt > 0)) return NO_SHOTS;
  if (dt > MAX_DT) dt = MAX_DT;

  if (input.swap) setSlot(ps, ps.slot === 0 ? 1 : 0);
  if (ps.swapT > 0) ps.swapT -= dt;

  let w = WEAPONS[ps.weapon];
  stepMovement(ps, input, w, dt, map);

  // ADS blocked by sprinting, swapping and magazine reloads; a shell-fed gun can stay up.
  const wantAds = !!input.aiming && !ps.sprinting && ps.swapT <= 0 && (ps.reloadT <= 0 || !!w.shellReload);
  const rate = dt / w.adsTime;
  ps.adsT = wantAds ? Math.min(1, ps.adsT + rate) : Math.max(0, ps.adsT - rate * ADS_OUT_RATE);

  if (input.reload) startReload(ps, w);
  stepReload(ps, w, dt);

  ps.sinceShot += dt;
  ps.cooldown -= dt;

  const trigger = !!input.fire;
  // A press stays armed until it fires or is released, so a semi-auto pressed during sprint-out,
  // a swap or the last moments of its cycle goes off the instant the gun is ready.
  if (!trigger) ps.armed = false;
  else if (!ps.triggerDown) ps.armed = true;
  ps.triggerDown = trigger;

  // Firing interrupts a shell-by-shell reload as long as something is loaded.
  if (trigger && w.shellReload && ps.reloadT > 0 && ps.ammo[ps.slot] > 0) {
    ps.reloadT = 0; ps.reloadDur = 0; ps.shellT = 0;
  }

  let shots = NO_SHOTS;
  if (trigger && ps.reloadT <= 0 && ps.swapT <= 0 && ps.sprintRecoverT <= 0) {
    for (let guard = 0; guard < 4 && ps.cooldown <= 0 && ps.ammo[ps.slot] > 0; guard++) {
      if (!w.auto && !ps.armed && (!w.holdRpm || ps.sinceShot < 60 / w.holdRpm)) break;
      const interval = shotInterval(w, ps.shotIndex);
      const shot = fireOne(ps, w, rng);
      ps.armed = false;
      if (shots === NO_SHOTS) shots = [];
      shots.push(shot);
      ps.cooldown += interval;
      if (!w.auto) break;
    }
  }

  // Only carry negative cooldown across a frame while actually firing, to hold the true rate.
  if (shots === NO_SHOTS && ps.cooldown < 0) ps.cooldown = 0;

  if (!trigger && ps.sinceShot > SHOT_INDEX_RESET) ps.shotIndex = 0;
  if (ps.sinceShot > BLOOM_RECOVER_DELAY && ps.bloom > 0) ps.bloom = Math.max(0, ps.bloom - w.bloomRecover * dt);

  // Auto-reload on empty; if the gun is completely dry, fall through to the other one.
  if (ps.ammo[ps.slot] <= 0 && ps.reloadT <= 0 && ps.cooldown <= 0) {
    if (ps.reserve[ps.slot] > 0 || w.unlimitedReserve) startReload(ps, w);
    else if (ps.ammo[1 - ps.slot] > 0 || ps.reserve[1 - ps.slot] > 0) setSlot(ps, 1 - ps.slot);
  }
  return shots;
}

// Resolves a shot against walls and players. Bullets stop at the first enemy; teammates are passed
// through when the entries carry a `team` (GameView players do), matching no-friendly-fire rules.
export function traceShot(shot, map, players, selfId) {
  const w = WEAPONS[shot.weapon];
  const range = w ? w.range : 60;
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
      const t = rayCircle(ox, oz, dirX, dirZ, p.x, p.z, HIT_RADIUS);
      if (t >= 0 && t < bestT) { bestT = t; target = p; }
    }
    const x = ox + dirX * bestT, z = oz + dirZ * bestT;
    if (target) rays[a] = { x, z, hit: 'player', nx: -dirX, nz: -dirZ, id: target.id };
    else if (wall) rays[a] = { x, z, hit: 'wall', nx: wall.nx, nz: wall.nz };
    else rays[a] = { x, z, hit: 'none', nx: 0, nz: 0 };
  }
  return rays;
}

// Stick aim -> assisted aim. Two effects near a visible enemy: friction cancels part of the
// stick's rotation across the target, and magnetism eases the offset toward its centre.
// All state is the offset on ps, so taking the thumb off the stick or losing the target releases it.
export function applyAimAssist(aim, ps, players, map, dt) {
  if (typeof aim !== 'number') { ps.aaRaw = null; return aim; }
  let bestDelta = 0, bestAbs = ASSIST_CONE, bestRange = 0, found = false;
  const selfTeam = selfTeamOf(ps, players);
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.id === ps.id || !p.alive) continue;
    if (selfTeam !== undefined && p.team === selfTeam) continue;
    const dx = p.x - ps.x, dz = p.z - ps.z;
    const dSq = dx * dx + dz * dz;
    if (dSq > ASSIST_RANGE * ASSIST_RANGE || dSq < 0.04) continue;
    const delta = angleDiff(Math.atan2(dz, dx), aim + ps.aaOffset);
    const abs = Math.abs(delta);
    if (abs >= bestAbs) continue;
    if (!hasLineOfSight(map, ps.x, ps.z, p.x, p.z)) continue;
    bestAbs = abs; bestDelta = delta; bestRange = Math.sqrt(dSq); found = true;
  }
  const rawDelta = ps.aaRaw === null ? 0 : angleDiff(aim, ps.aaRaw);
  ps.aaRaw = aim;
  if (found) {
    const closeness = 1 - bestAbs / ASSIST_CONE;
    const ads = ps.adsT;
    const friction = (0.22 + 0.26 * ads) * closeness;
    // Far targets get slightly less pull, so long-range shots stay a skill.
    const rangeK = bestRange > 18 ? Math.max(0.55, 1 - (bestRange - 18) / 24) : 1;
    const pull = (2.4 + 3.2 * ads) * closeness * rangeK;
    ps.aaOffset -= rawDelta * friction;
    ps.aaOffset += bestDelta * Math.min(1, pull * dt);
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

// Wire format: one flat array. Bits in the flags value: 1 slot, 2 sprinting, 4 sliding.
export function encodeHumanState(ps) {
  return [
    Math.round(ps.x * 100), Math.round(ps.z * 100), Math.round(ps.aim * 1000),
    Math.round(ps.vx * 10), Math.round(ps.vz * 10),
    (ps.slot & 1) | (ps.sprinting ? 2 : 0) | (ps.sliding ? 4 : 0),
    WEAPON_IDS.indexOf(ps.primary), ps.ammo[0], ps.ammo[1], ps.reserve[0], ps.reserve[1],
    Math.round(ps.reloadT * 100), Math.round(ps.reloadDur * 100),
    Math.round(ps.adsT * 100), Math.round(ps.bloom * 100),
    ps.camo,
  ];
}

export function decodeHumanState(d) {
  const flags = d[5];
  const slot = flags & 1;
  const primary = WEAPON_IDS[d[6]] || 'ar';
  return {
    x: d[0] / 100, z: d[1] / 100, aim: d[2] / 1000,
    vx: d[3] / 10, vz: d[4] / 10,
    slot, primary, secondary: SECONDARY_ID, weapon: slot === 0 ? primary : SECONDARY_ID,
    sprinting: !!(flags & 2), sliding: !!(flags & 4),
    ammo: [d[7], d[8]], reserve: [d[9], d[10]],
    reloadT: d[11] / 100, reloadDur: d[12] / 100,
    adsT: d[13] / 100, bloom: d[14] / 100,
    camo: d[15],
  };
}
