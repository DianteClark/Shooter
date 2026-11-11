// A scripted "human on a phone" for balance work (dev/balance-sim.mjs). Never used in a real match.
//
// It is a BotBrain for everything that is not the right thumb: where to walk, whom to fight, when to back off. What it
// replaces is how the gun is pointed and fired, to match what js/ui/controls.js actually gives a player:
//   - The aim is the angle of the aim stick, so pointing is a thumb position, not a turn rate. The thumb follows what
//     the eye saw a moment ago (THUMB.lag), closes on it at a finite rate, lands a flick off target and settles, and
//     never stops wandering by a few pixels (THUMB.jitter: 3 px on the 60 px throw past the fire ring is 0.05 rad).
//   - Fire is the stick pushed past the fire ring. A thumb that is out there tracking stays out there: the trigger is
//     held for the whole fight, on target or not, and for a moment after the target drops (THUMB.overhold). There is
//     no trigger discipline, which is the difference a bot's `fireTol` makes.
//   - ADS needs the move stick eased off (adsRoomFor in player.js). A thumb fighting at full stick is hip-firing with
//     the moving-spread penalty; only THUMB.settle of fights are fought eased in.
//   - The result goes through applyAimAssist exactly as js/game/match.js does it, so assist tuning is measured, not
//     assumed.
// It sees like a screen, not a cone: everything inside THUMB.sight in any direction, at once.

import { BotBrain, SKILLS } from './bots.js';
import { angleDiff, applyAimAssist, weaponDef } from './player.js';

export const THUMB = {
  reaction: [0.3, 0.5],   // Seconds from an enemy coming on screen to the thumb starting to answer.
  lag: 0.2,               // Seconds old the position the thumb is chasing is.
  follow: 9,              // 1/s: how quickly the thumb closes the gap to where it wants to point.
  jitter: 0.05,           // rad sigma of the thumb's wander while holding an angle.
  jitterTau: 0.22,        // Seconds over which that wander changes.
  flick: 0.2,             // rad sigma of the error the first flick onto a target lands with...
  flickSettle: 0.45,      // ...and the time constant it is corrected over.
  fireCone: 0.5,          // The thumb is past the ring once it is pointing this close to the target.
  overhold: 1.0,          // Seconds the trigger stays down after the target is gone.
  prefire: 1.5,           // Seconds it sprays toward a fresh contact it cannot see (a noise, a callout, a corner).
  settle: 0.25,           // Share of fights fought with the move stick eased into ADS.
  strafe: 0.9,            // Share of the time it is strafing in a fight.
  sight: 20,              // Metres: what fits on the screen around the player.
  assist: 1,              // The Options aim-assist slider (controls.aimAssist), 0..1.
};

const POS = { x: 0, z: 0 };
function gaussian(rng) { return (rng() + rng() + rng() + rng() - 2) / 0.577; }

export class HumanLikeBrain extends BotBrain {
  constructor(sim, player, staggerIndex, thumb = THUMB) {
    super(sim, player, staggerIndex);
    this.H = thumb;
    const base = SKILLS[thumb.base || 'regular'];
    this.S = { ...base, reaction: thumb.reaction, fov: Math.PI * 2, sight: thumb.sight, notice: 1, adsUse: thumb.settle,
      strafe: thumb.strafe, turnRate: 40, pistolSwap: true };
    this.human = true;
    this.view = [];            // {id, team, alive, x, z} per player: what applyAimAssist reads from a GameView.
    this.stick = player.ps.aim;
    this.jit = 0; this.flickErr = 0; this.fireHold = 0; this.cooling = false;
  }

  _acquire(q, d) {
    super._acquire(q, d);
    const rng = this.sim.rng;
    this.useAds = rng() < this.H.settle || !!weaponDef(this.ps).adsGate;
    this.flickErr = gaussian(rng) * this.H.flick;
  }

  drive(dt) {
    super.drive(dt);
    const { sim, ps, input: I, H } = this;
    const rng = sim.rng;
    const q = this.target;
    const fighting = this.targetVisible && q && q.alive;
    const w = weaponDef(ps);

    const k = Math.exp(-dt / H.jitterTau);
    this.jit = this.jit * k + gaussian(rng) * H.jitter * Math.sqrt(1 - k * k);

    let fire = false, stickDown = false;
    if (fighting) {
      sim.posAt(q, H.lag, POS);
      const want = Math.atan2(POS.z - ps.z, POS.x - ps.x);
      const d = Math.max(0.3, Math.hypot(q.ps.x - ps.x, q.ps.z - ps.z));
      // Half way through the reaction the thumb starts across, as a bot's head does.
      if (this.reactLeft < this.reactTotal * 0.55) {
        stickDown = true;
        const goal = want + this.jit + this.flickErr * Math.exp(-this.trackT / H.flickSettle);
        this.stick += angleDiff(goal, this.stick) * Math.min(1, dt * H.follow);
      }
      const off = Math.abs(angleDiff(this.stick, want));
      if (this.reactLeft <= 0 && d <= w.range * 1.1) {
        // A gun that kills in a round or two is tapped when the sights cross the body; everything else is held.
        const tap = !w.auto && (w.damage * (w.pellets || 1) >= 50 || w.adsGate);
        fire = tap ? Math.abs(angleDiff(ps.aim, want)) < Math.atan2(0.55, d) + 0.02 && (!w.adsGate || ps.adsT >= 0.85)
          : off < H.fireCone;
      }
      if (fire && !(!w.auto && w.adsGate)) this.fireHold = H.overhold;
    } else {
      // Nothing on screen: the thumb is off the stick, or resting where the last target was with the ring still held.
      this.stick = I.aim;
      if (this.fireHold > 0) { this.fireHold -= dt; fire = true; stickDown = true; }
      else if (w.auto && this.hasKnown && !this.knownSoft && sim.time - this.knownT < H.prefire) { fire = true; stickDown = true; }
      if (stickDown) this.stick += this.jit;
    }

    // A belt gun's heat bar is on the HUD: a player lets go near the top and comes back when it has drained.
    if (w.heat) {
      if (ps.overheated || (this.cooling && ps.heat > 0.3)) fire = false;
      else if (ps.heat >= 0.85) { this.cooling = true; fire = false; }
      else this.cooling = false;
    }

    if (stickDown) {
      const view = this.view, players = sim.players;
      view.length = players.length;
      for (let i = 0; i < players.length; i++) {
        const p = players[i], v = view[i] || (view[i] = { id: null, team: 0, alive: false, x: 0, z: 0 });
        v.id = p.id; v.team = p.team; v.alive = p.alive && p.spawnProtect <= 0; v.x = p.ps.x; v.z = p.ps.z;
      }
      const assisted = applyAimAssist(this.stick, ps, view, sim.map, dt);
      I.aim = this.stick + angleDiff(assisted, this.stick) * H.assist;
    } else {
      applyAimAssist(null, ps, null, sim.map, dt);     // Thumb off the stick: assist lets go.
    }
    I.fire = fire && ps.swapT <= 0;
    // The aim stick being down is `aiming`; whether that becomes ADS is the move stick's business. A fight at full
    // stick is the hip: saying so here keeps update() from easing the stick the way it does for a bot that wants ADS.
    const moving = Math.hypot(I.mx, I.mz) > 0.7;
    I.aiming = stickDown && fighting && this.reactLeft <= 0 && (this.useAds || !moving);
    if (I.fire) I.sprint = false;
  }
}

// Swaps a bot's brain for the human-like one. Call after the sim's first step (bots are created lazily).
export function makeHumanLike(sim, id, thumb = THUMB) {
  const p = sim.byId.get(id);
  if (!p || !p.bot) return null;
  p.bot = new HumanLikeBrain(sim, p, p.index, thumb);
  p.humanLike = true;
  return p.bot;
}
