// Quality ladder, starting-step guess for this phone, frame clock, and the Auto governor.
// A step only changes sizes, counts, visibility and uniforms. Every program is compiled when the match starts
// (GameRenderer precompiles the whole scene, hidden objects included), so moving between steps never compiles a shader.

// dpr: drawing-buffer ceiling, further capped by the screen's own devicePixelRatio.
// fogTexels: vision mask texels per metre. fogPasses: soft-edge passes (1..6). fogEvery: mask refresh every N frames.
// fx: particle emission multiplier. weather: fraction of rain/snow/dust instances. ambient: birds and dust devils.
// blobs: soldier contact shadows. shadows: the baked sun-shadow decal layer. props: fraction of breakable props kept.
// corpses: dismantled bodies kept at once.
export const QUALITY_STEPS = [
  { id: 'ultra',  label: 'Ultra',  dpr: 3,    fogTexels: 8, fogPasses: 6, fogEvery: 1, fx: 1,    weather: 1,    ambient: true,  blobs: true,  shadows: true,  props: 1,    corpses: 12 },
  { id: 'high',   label: 'High',   dpr: 2,    fogTexels: 8, fogPasses: 6, fogEvery: 1, fx: 1,    weather: 1,    ambient: true,  blobs: true,  shadows: true,  props: 1,    corpses: 12 },
  { id: 'medium', label: 'Medium', dpr: 1.6,  fogTexels: 6, fogPasses: 4, fogEvery: 1, fx: 0.75, weather: 0.7,  ambient: true,  blobs: true,  shadows: true,  props: 0.75, corpses: 8 },
  { id: 'low',    label: 'Low',    dpr: 1.3,  fogTexels: 5, fogPasses: 2, fogEvery: 2, fx: 0.5,  weather: 0.45, ambient: false, blobs: true,  shadows: true,  props: 0.5,  corpses: 5 },
  { id: 'potato', label: 'Potato', dpr: 1,    fogTexels: 4, fogPasses: 2, fogEvery: 2, fx: 0.3,  weather: 0.2,  ambient: false, blobs: false, shadows: false, props: 0,    corpses: 3 },
];
export const stepIndex = id => QUALITY_STEPS.findIndex(s => s.id === id);
// Auto never climbs above High on its own: Ultra is native resolution, which costs heat for little gain at arm's length.
export const AUTO_CEILING = stepIndex('high');

const SAVE_KEY = 'switchyard-quality';
const SAVE_DAYS = 14;

// ---- Starting step for this device ---------------------------------------------------------------------------
// What iOS Safari actually exposes (checked against WebKit, 2026):
//  - WEBGL_debug_renderer_info: the unmasked renderer is the generic "Apple GPU" on every iPhone, so it carries no
//    chip tier. A string naming the chip ("Apple A12 GPU") is used when some other browser shell exposes one.
//  - navigator.hardwareConcurrency: WebKit reports 4 for any device with fewer than 8 cores, which is every iPhone.
//  - navigator.deviceMemory: not implemented in Safari.
//  - screen size and devicePixelRatio are real, and narrow the model to a family of a few years.
//  - the iOS version in the user agent is a floor on the chip: iOS 16 and later need an A11, 17 and later an A12.
//    Safari has frozen that version at times, but a frozen version is still a valid floor.
// So the guess is: screen family, refined by OS floor; chip name when present. Auto corrects it within seconds.
export function deviceProfile(gl) {
  const dpr = window.devicePixelRatio || 1;
  const sw = window.screen?.width || 0, sh = window.screen?.height || 0;
  const long = Math.max(sw, sh), short = Math.min(sw, sh);
  const cores = navigator.hardwareConcurrency || 0;
  const memory = navigator.deviceMemory || 0;
  const ua = navigator.userAgent || '';
  const iPhone = /iPhone|iPod/.test(ua);
  const osMatch = ua.match(/OS (\d+)_\d+/);
  const ios = iPhone && osMatch ? Number(osMatch[1]) : 0;
  let gpu = '';
  try {
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || (gl && gl.getParameter(gl.RENDERER)) || '';
  } catch { gpu = ''; }

  let step = 'high', why = '';
  const chip = gpu.match(/Apple A(\d+)/);
  if (/SwiftShader|llvmpipe|Software/i.test(gpu)) { step = 'potato'; why = 'software renderer'; }
  else if (chip) {
    const a = Number(chip[1]);
    step = a <= 9 ? 'potato' : a <= 11 ? 'low' : a <= 13 ? 'medium' : 'high';
    why = `A${a} GPU`;
  } else if (iPhone) {
    why = `${short}x${long} @${dpr}x, iOS ${ios || '?'}`;
    if (long <= 568) step = 'potato';                                   // SE (1st gen), 5s: A9 and older.
    else if (long <= 736) step = ios && ios < 16 ? 'potato' : ios >= 17 ? 'medium' : 'low';   // 6s..8 Plus, SE 2/3.
    else if (long <= 812) step = ios >= 17 ? 'medium' : 'low';         // X / XS / 11 Pro, 12 and 13 mini.
    else if (long <= 896) step = 'medium';                              // XR, 11, XS Max, 11 Pro Max: A12/A13.
    else step = 'high';                                                 // 12 and later.
  } else {
    why = 'not an iPhone';
    if (memory && memory <= 2) step = 'low';
  }
  return { step, why, gpu: gpu || 'unknown', dpr, screen: `${short}x${long}`, cores, memory, ios };
}

// The step Auto settled on last match, if recent: a phone that needed Low last time starts there.
export function savedAutoStep() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s && stepIndex(s.step) >= 0 && Date.now() - s.at < SAVE_DAYS * 864e5) return s.step;
  } catch { /* unreadable: no saved step */ }
  return null;
}
export function saveAutoStep(id) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ step: id, at: Date.now() })); } catch { /* private mode */ }
}

// ---- Frame clock ----------------------------------------------------------------------------------------------
// Wraps requestAnimationFrame once, so every frame's script time is known: all rAF callbacks of one frame share a
// timestamp, and their run times are summed. A frame is committed when the next one starts.
const RING = 512;
export const frameClock = {
  installed: false,
  interval: new Float32Array(RING),   // ms between frames
  work: new Float32Array(RING),       // ms of script inside rAF callbacks that frame
  head: 0,                            // Next write slot.
  count: 0,
  lastInterval: 0,
  lastWork: 0,
};

export function installFrameClock() {
  if (frameClock.installed || typeof window === 'undefined') return;
  frameClock.installed = true;
  const native = window.requestAnimationFrame.bind(window);
  let ts = -1, prevTs = -1, work = 0;
  const commit = () => {
    if (prevTs >= 0) {
      const C = frameClock, i = C.head;
      C.interval[i] = ts - prevTs; C.work[i] = work;
      C.lastInterval = ts - prevTs; C.lastWork = work;
      C.head = (i + 1) % RING;
      if (C.count < RING) C.count++;
    }
  };
  window.requestAnimationFrame = cb => native(t => {
    if (t !== ts) { commit(); prevTs = ts; ts = t; work = 0; }
    const t0 = performance.now();
    try { cb(t); } finally { work += performance.now() - t0; }
  });
}

// ---- Auto governor --------------------------------------------------------------------------------------------
const WINDOW = 0.5;          // Seconds per decision window.
const GRACE = 2.5;           // Seconds ignored at the start.
const RES_FLOOR = 0.8;       // Dynamic resolution works inside [floor, 1] of the step's ceiling before changing step.
const PERIOD = 20;           // Seconds per thermal period.
const THERMAL_RATIO = 1.35;  // Script time this far above the cool reference, sustained, means the chip is throttled.
const THERMAL_PERIODS = 4;   // ... for this many periods in a row (80 s).
const THERMAL_HOLD = 180;    // Seconds without a step-up after throttling is seen.

// Decides resolution scale and step from frame intervals and script time. host: { setStep(i), setResScale(s),
// resScale, step }. Nothing here allocates per frame.
export class Governor {
  constructor(host, startStep, ceiling = AUTO_CEILING) {
    this.host = host;
    this.ceiling = ceiling;
    this.clock = 0;
    this.target = 1000 / 60;   // Expected frame interval in ms; 33.3 while the browser caps rAF at 30 Hz.
    this.cap30 = false;
    // Window accumulators.
    this.wT = 0; this.wN = 0; this.wSum = 0; this.wWork = 0; this.wMiss = 0; this.wCapped = 0;
    this.slowStreak = 0;
    this.goodStreak = 0;
    this.raiseWait = 3;        // Good windows before a resolution raise; doubles when a raise does not hold.
    this.raisedAt = -999;
    this.stepUpWait = 40;      // Good windows (at full resolution) before trying the next step up: 20 s at first.
    this.lastStepAt = 0;
    this.trial = null;         // { from, until, slow } while a step-up is on probation.
    this.probe = null;         // { res, until } while testing for a 30 Hz cap.
    this.probeAfter = 0;
    // Thermal.
    this.pT = 0; this.pWork = 0; this.pN = 0; this.pMiss = 0;
    this.ref = new Float32Array(QUALITY_STEPS.length).fill(0);
    this.refN = new Uint8Array(QUALITY_STEPS.length);
    this.hotPeriods = 0; this.coolPeriods = 0;
    this.thermal = false;
    this.thermalUntil = 0;
    this.lastRatio = 0;
    this.reason = '';
    host.setStep(startStep);
  }

  // intervalMs: time since the previous frame. workMs: script time of the last whole frame (0 if unknown).
  frame(intervalMs, workMs) {
    // A tab switch, an alert or a GC pause says nothing about sustained load.
    if (!(intervalMs > 0) || intervalMs > 120) return;
    const dt = intervalMs / 1000;
    this.clock += dt;
    // The first seconds of a match carry loading, first uploads and GC: they say nothing about the steady state.
    if (this.clock < GRACE) return;
    this.wT += dt; this.wN++; this.wSum += intervalMs; this.wWork += workMs;
    if (intervalMs > this.target * 1.5) this.wMiss++;
    if (intervalMs > 30.5 && intervalMs < 36.5) this.wCapped++;
    if (this.wT >= WINDOW) this._window();
  }

  _window() {
    const n = this.wN, avg = this.wSum / n, work = this.wWork / n, miss = this.wMiss / n, capped = this.wCapped / n;
    this.wT = 0; this.wN = 0; this.wSum = 0; this.wWork = 0; this.wMiss = 0; this.wCapped = 0;
    const host = this.host;
    // iOS Low Power Mode (and some accessibility settings) cap rAF at 30 Hz. That looks just like a GPU that needs
    // a little over 16.7 ms: frames land on 33 ms with idle script time. So it is tested once: drop to about a
    // quarter of the pixels for two seconds. A GPU-bound phone speeds up; a capped one stays at 30, and then the
    // target moves to 33 ms instead of the quality falling for nothing.
    if (this.probe) {
      if (this.clock < this.probe.until) return;
      const stillCapped = capped > 0.85;
      host.setResScale(this.probe.res);
      this.probe = null;
      this.cap30 = stillCapped;
      // A phone that sped up is simply slow at this step: the normal path handles it, and asking again soon
      // would only flicker the resolution.
      if (!stillCapped) this.probeAfter = this.clock + 90;
      this.target = this.cap30 ? 1000 / 30 : 1000 / 60;
      this.slowStreak = 0; this.goodStreak = 0;
      return;
    }
    if (this.cap30 && avg < 24) { this.cap30 = false; this.target = 1000 / 60; }
    if (!this.cap30 && capped > 0.85 && work < 12 && this.clock >= this.probeAfter) {
      this.probe = { res: host.resScale, until: this.clock + 2 };
      host.setResScale(Math.min(host.resScale, 1 / host.maxDpr));
      return;
    }

    const slow = avg > this.target * 1.15 || miss > 0.12;
    const good = avg < this.target * 1.05 && miss < 0.03;
    this._thermal(WINDOW, work, miss);

    if (this.trial) {
      if (slow) this.trial.slow++;
      if (this.trial.slow >= 2) {
        // The step up did not hold: back down, and wait twice as long before the next try (at most ten minutes).
        const from = this.trial.from;
        this.trial = null;
        this.stepUpWait = Math.min(1200, this.stepUpWait * 2);
        this._setStep(from, 'step-up did not hold');
        return;
      }
      if (this.clock >= this.trial.until) this.trial = null;
    }

    if (slow) {
      this.goodStreak = 0;
      // Script busy for most of a late frame: fewer pixels will not help, so go straight to the step's other savings.
      const cpuBound = work > avg * 0.75;
      if (host.resScale > RES_FLOOR + 1e-3 && !cpuBound) {
        if (this.clock - this.raisedAt < 6) this.raiseWait = Math.min(40, this.raiseWait * 2);
        host.setResScale(Math.max(RES_FLOOR, host.resScale * 0.9));
        this.slowStreak = 0;
      } else if (++this.slowStreak >= 3 && host.step < QUALITY_STEPS.length - 1 && this.clock - this.lastStepAt > 2.5) {
        this._setStep(host.step + 1, 'slow frames');
      }
      return;
    }
    this.slowStreak = 0;
    if (!good) { this.goodStreak = 0; return; }
    this.goodStreak++;
    if (host.resScale < 1) {
      if (this.goodStreak >= this.raiseWait) {
        this.goodStreak = 0;
        this.raisedAt = this.clock;
        host.setResScale(Math.min(1, host.resScale * 1.05));
      }
      return;
    }
    // Step up only with clear headroom in script time too, never while hot, never past the ceiling.
    if (host.step > this.ceiling && this.goodStreak >= this.stepUpWait && work < this.target * 0.6 && !this.trial && this.clock >= this.thermalUntil) {
      this.goodStreak = 0;
      const from = host.step;
      this._setStep(from - 1, 'headroom');
      this.trial = { from, until: this.clock + 6, slow: 0 };
    }
  }

  _setStep(i, reason) {
    const host = this.host;
    const effective = host.effectiveDpr;
    host.setStep(i);
    // Keep the picture continuous: the new ceiling picks up at about the resolution the old one had reached.
    host.setResScale(Math.max(RES_FLOOR, Math.min(1, effective / host.maxDpr)));
    this.lastStepAt = this.clock;
    this.slowStreak = 0; this.goodStreak = 0; this.hotPeriods = 0;
    this.reason = reason;
    this._resetPeriod();
  }

  // Thermal throttling shows as the same work getting slower over minutes. Script time per frame is the one cost
  // vsync cannot hide, so each step keeps the lowest 20 s average it has seen as its cool reference, and a run of
  // periods well above it is read as heat: Auto stops climbing, and once frames also start to miss it steps down
  // before the drops pile up. (A period never spans a step change: _setStep restarts it.)
  _thermal(dt, work, miss) {
    this.pT += dt; this.pWork += work; this.pMiss += miss; this.pN++;
    if (this.pT < PERIOD) return;
    const step = this.host.step;
    const avgWork = this.pWork / this.pN, avgMiss = this.pMiss / this.pN;
    const clean = !this.trial;
    this._resetPeriod();
    if (!clean || avgWork <= 0) return;
    if (this.refN[step] < 255) this.refN[step]++;
    if (this.ref[step] === 0 || avgWork < this.ref[step]) this.ref[step] = avgWork;
    if (this.refN[step] < 2) return;
    const ratio = avgWork / this.ref[step];
    this.lastRatio = ratio;
    if (ratio > THERMAL_RATIO) { this.hotPeriods++; this.coolPeriods = 0; }
    else if (ratio < 1.12) { this.coolPeriods++; this.hotPeriods = 0; }
    else { this.hotPeriods = 0; this.coolPeriods = 0; }
    if (this.hotPeriods >= THERMAL_PERIODS) {
      if (!this.thermal) this.stepUpWait = Math.max(this.stepUpWait, 120);
      this.thermal = true;
      this.thermalUntil = this.clock + THERMAL_HOLD;
      // Already missing frames while hot: step down now rather than wait for the slow-frame path to see it.
      if (avgMiss > 0.02 && step < QUALITY_STEPS.length - 1 && this.clock - this.lastStepAt > 10) this._setStep(step + 1, 'thermal');
    } else if (this.thermal && this.coolPeriods >= 3) {
      this.thermal = false;
    }
  }

  _resetPeriod() {
    this.pT = 0; this.pWork = 0; this.pN = 0; this.pMiss = 0;
  }
}
