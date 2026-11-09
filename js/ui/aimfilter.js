// Turns the raw path of the aim thumb into a steady angle. Pure numbers, no DOM, so a node test can drive it.
//
// A thumb is not a mouse. Its reported position wanders a pixel or two while resting, and when it lifts the contact
// patch rolls off so the last samples slide toward the fingertip. An angle taken straight from atan2 near the stick's
// centre turns those pixels into tens of degrees. Three stages, in order:
//  1. A speed-adaptive low-pass on the offset vector (One Euro): strong when the thumb is nearly still, almost none
//     during a flick, so it steadies without adding lag where lag would be felt.
//  2. A centre deadzone with hysteresis. Inside it the last angle holds.
//  3. An angular backlash band sized from the pixel noise at the current radius: wobble that cannot be told from noise
//     moves nothing, real motion moves the aim by what exceeds the band. It is about 9 degrees just outside the deadzone
//     and under 1 at the fire ring.
const ENGAGE_PX = 8;           // Leaving the deadzone needs this radius...
const RELEASE_PX = 4.5;        // ...and re-entering it this one.
const NOISE_PX = 1.3;
const MIN_CUTOFF_HZ = 6;
const BETA = 0.022;            // Extra cutoff per px/s of thumb speed.
const SPEED_CUTOFF_HZ = 20;    // Smoothing on the speed estimate itself.
const GLITCH_SPEED = 7;        // px/ms. Beyond any thumb: a single sample this fast is a tracking glitch.
const GLITCH_MIN_PX = 60;
const GLITCH_CONFIRM_PX = 34;  // A second sample landing near the jump says it was real after all.
const SLEW_NEAR = 14;          // rad/s the output may turn just outside the deadzone...
const SLEW_FAR = 60;           // ...and at this radius or beyond.
const SLEW_FAR_PX = 50;
const HISTORY = 12;            // Samples kept to look back past the lift-off slide; 12 at 120 Hz is 100 ms.

const TAU = Math.PI * 2;
export const wrapAngle = a => {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
};

const alphaFor = (hz, dt) => 1 / (1 + 1 / (TAU * hz * dt));

export class AimFilter {
  constructor() {
    this.histT = new Float64Array(HISTORY);
    this.histA = new Float64Array(HISTORY);
    this.reset();
  }

  reset() {
    this.angle = null;         // Filtered aim in radians; null until the thumb first leaves the deadzone.
    this.engaged = false;
    this.has = false;
    this.lastT = 0;
    this.rx = this.ry = 0;     // Last accepted raw offset.
    this.fx = this.fy = 0;     // Filtered offset.
    this.speed = 0;
    this.susX = this.susY = 0; // A sample being held back as a possible glitch.
    this.suspect = false;
    this.count = 0;
  }

  // dx, dy: offset from the stick's centre in pixels. t: event time in milliseconds.
  push(dx, dy, t) {
    if (!this.has) {
      this.has = true;
      this.lastT = t;
      this.rx = this.fx = dx;
      this.ry = this.fy = dy;
      this.#update(hypot(dx, dy), 16);
      return this.angle;
    }
    const dt = Math.max(1, t - this.lastT);
    const jump = hypot(dx - this.rx, dy - this.ry);
    if (jump > GLITCH_MIN_PX && jump / dt > GLITCH_SPEED && !this.#confirms(dx, dy)) {
      this.suspect = true;
      this.susX = dx; this.susY = dy;
      this.lastT = t;
      return this.angle;
    }
    this.suspect = false;
    const dtS = dt / 1000;
    const inst = jump / dtS;
    this.speed += (inst - this.speed) * alphaFor(SPEED_CUTOFF_HZ, dtS);
    const a = alphaFor(MIN_CUTOFF_HZ + BETA * this.speed, dtS);
    this.fx += (dx - this.fx) * a;
    this.fy += (dy - this.fy) * a;
    this.rx = dx; this.ry = dy;
    this.lastT = t;
    this.#update(hypot(this.fx, this.fy), dt);
    return this.angle;
  }

  #confirms(dx, dy) {
    return this.suspect && hypot(dx - this.susX, dy - this.susY) < GLITCH_CONFIRM_PX;
  }

  #update(d, dt) {
    if (this.engaged ? d < RELEASE_PX : d < ENGAGE_PX) {
      this.engaged = false;
      return;
    }
    const first = this.angle === null;
    this.engaged = true;
    const target = Math.atan2(this.fy, this.fx);
    if (first) {
      this.angle = target;
    } else {
      const band = Math.atan(NOISE_PX / d);
      const delta = wrapAngle(target - this.angle);
      const excess = Math.abs(delta) - band;
      if (excess > 0) {
        const span = Math.min(1, (d - ENGAGE_PX) / (SLEW_FAR_PX - ENGAGE_PX));
        const limit = (SLEW_NEAR + (SLEW_FAR - SLEW_NEAR) * span) * (dt / 1000);
        this.angle = wrapAngle(this.angle + Math.sign(delta) * Math.min(excess, limit));
      }
    }
    this.histA[this.count % HISTORY] = this.angle;
    this.histT[this.count % HISTORY] = this.lastT;
    this.count++;
  }

  // The aim as it stood `backMs` before `t`, or the oldest sample kept. Lift-off is judged from just before the slide.
  settled(t, backMs = 45) {
    if (this.angle === null) return null;
    const n = Math.min(this.count, HISTORY);
    let best = this.angle;
    for (let i = 1; i <= n; i++) {
      const at = (this.count - i) % HISTORY;
      best = this.histA[at];
      if (this.histT[at] <= t - backMs) break;
    }
    return best;
  }
}

function hypot(x, y) { return Math.sqrt(x * x + y * y); }
