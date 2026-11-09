// All game audio, synthesized: no files. Every sound is rendered once, in plain JS, into an AudioBuffer
// when audio unlocks; playing one costs a source, a gain and a panner. Firing 12 guns is then just
// buffer playback, which is what keeps a firefight from stuttering on a phone.
//
// Graph: voices -> dry bus + far bus (lowpass) + room send -> compressor -> master -> limiter -> soft clip -> out.
// Feedback sounds (hitmarkers, medals) join after the compressor so gunfire never ducks them.

const MAX_VOICES = 26;
const MAX_GUN_VOICES = 13;
const GUN_WINDOW = 0.03;         // Seconds; the gunshot rate cap below applies per window.
const GUN_WINDOW_CAP = 4;
const SHOOTER_MIN_GAP = 0.05;    // Fast guns from other players don't need every shot rendered.
const HEAR_RANGE = 58;
const STEP_RANGE = 24;

const SYNTH_RATE_FALLBACK = 44100;

// ---- Small DSP helpers. Everything renders into Float32Arrays. ----

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return (s / 4294967295) * 2 - 1;
  };
}

function softClip(x) {
  const t = Math.max(-1.5, Math.min(1.5, x));
  return t - (t * t * t) / 6.75;   // Soft knee saturation; adds density to the transient.
}

function normalize(data, peak) {
  let max = 1e-9;
  for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > max) max = a; }
  const k = peak / max;
  for (let i = 0; i < data.length; i++) data[i] *= k;
  return data;
}

// Adds a filtered-noise layer: a one-pole lowpass whose cutoff sweeps from f0 to f1, with an exponential decay.
function addNoise(data, sr, rng, { at = 0, dur, gain, f0, f1, hp = 0, decay = 5 }) {
  const start = Math.floor(at * sr), n = Math.floor(dur * sr);
  let low = 0, hi = 0, prev = 0, a = 0;
  const b = hp > 0 ? Math.exp(-2 * Math.PI * hp / sr) : 0;
  const stepDecay = Math.exp(-decay / n);
  let env = 1;
  for (let i = 0; i < n && start + i < data.length; i++) {
    // The cutoff only needs to move every few samples: exp() per sample is what made this slow.
    if ((i & 15) === 0) {
      const t = i / n;
      a = 1 - Math.exp(-2 * Math.PI * (f0 + (f1 - f0) * Math.min(1, t * 1.4)) / sr);
    }
    low += a * (rng() - low);
    let out = low;
    if (hp > 0) { hi = b * (hi + low - prev); prev = low; out = hi; }
    data[start + i] += out * gain * env;
    env *= stepDecay;
  }
}

// Adds a sine that glides from f0 to f1: the thump in a gun, the tick in a hitmarker.
function addTone(data, sr, { at = 0, dur, gain, f0, f1 = f0, decay = 5, attack = 0.001, shape = 0 }) {
  const start = Math.floor(at * sr), n = Math.floor(dur * sr);
  let phase = 0, inc = 0;
  const atk = Math.max(1, attack * sr);
  const stepDecay = Math.exp(-decay / n);
  let env = 1;
  const norm = shape ? Math.tanh(1 + shape) : 1;
  for (let i = 0; i < n && start + i < data.length; i++) {
    if ((i & 7) === 0) inc = 2 * Math.PI * f0 * Math.pow(f1 / f0, i / n) / sr;
    phase += inc;
    let v = Math.sin(phase);
    if (shape) v = Math.tanh(v * (1 + shape)) / norm;
    data[start + i] += v * gain * env * (i < atk ? i / atk : 1);
    env *= stepDecay;
  }
}

function addClick(data, sr, rng, { at = 0, dur = 0.004, gain = 1, hp = 2500 }) {
  addNoise(data, sr, rng, { at, dur, gain, f0: 12000, f1: 8000, hp, decay: 3 });
}

// ---- Gun recipes. `crack` is the transient, `body` the bang, `thump` the low end, `tail` the room. ----

const GUNS = {
  ar: {
    dur: 0.62, crack: { dur: 0.005, gain: 1.1, hp: 2200 },
    body: { dur: 0.12, gain: 1.15, f0: 5200, f1: 700, decay: 6 },
    thump: { dur: 0.09, gain: 0.9, f0: 150, f1: 55, decay: 5 },
    tail: { dur: 0.5, gain: 0.26, f0: 1500, f1: 350, decay: 5.5 },
  },
  smg: {
    dur: 0.36, crack: { dur: 0.003, gain: 1.15, hp: 3800 },
    body: { dur: 0.06, gain: 1.05, f0: 7600, f1: 1700, decay: 6 },
    thump: { dur: 0.04, gain: 0.55, f0: 240, f1: 120, decay: 5 },
    tail: { dur: 0.3, gain: 0.2, f0: 2600, f1: 700, decay: 7 },
  },
  shotgun: {
    dur: 1.05, crack: { dur: 0.008, gain: 1, hp: 1500 },
    body: { dur: 0.24, gain: 1.5, f0: 3000, f1: 260, decay: 5 },
    thump: { dur: 0.18, gain: 1.4, f0: 105, f1: 38, decay: 4 },
    tail: { dur: 0.75, gain: 0.32, f0: 900, f1: 180, decay: 5 },
    // Pump: back, then forward, after the bang has passed.
    mech: [{ at: 0.42, gain: 0.5, hp: 1200, dur: 0.02 }, { at: 0.56, gain: 0.6, hp: 900, dur: 0.025 }],
  },
  lmg: {
    dur: 0.82, crack: { dur: 0.006, gain: 1.15, hp: 1800 },
    body: { dur: 0.16, gain: 1.35, f0: 3400, f1: 420, decay: 5.5 },
    thump: { dur: 0.13, gain: 1.25, f0: 120, f1: 44, decay: 4.5, shape: 1.2 },
    tail: { dur: 0.65, gain: 0.3, f0: 1100, f1: 260, decay: 5 },
  },
  sniper: {
    dur: 1.9, crack: { dur: 0.004, gain: 1.4, hp: 4200 },
    body: { dur: 0.3, gain: 1.6, f0: 4200, f1: 200, decay: 5 },
    thump: { dur: 0.3, gain: 1.5, f0: 90, f1: 28, decay: 3.5, shape: 0.8 },
    tail: { dur: 1.5, gain: 0.34, f0: 800, f1: 140, decay: 4.2 },
    // A slapback off the far wall, then the bolt being worked.
    echo: { at: 0.14, dur: 0.22, gain: 0.3, f0: 1600, f1: 300, decay: 5 },
    mech: [{ at: 0.72, gain: 0.5, hp: 1500, dur: 0.018 }, { at: 0.9, gain: 0.45, hp: 1100, dur: 0.02 }],
  },
  pistol: {
    dur: 0.42, crack: { dur: 0.004, gain: 1.15, hp: 2800 },
    body: { dur: 0.075, gain: 1, f0: 6000, f1: 1200, decay: 6 },
    thump: { dur: 0.06, gain: 0.7, f0: 200, f1: 85, decay: 5 },
    tail: { dur: 0.32, gain: 0.2, f0: 2100, f1: 500, decay: 6.5 },
  },
};

function renderGun(spec, sr, seed) {
  const data = new Float32Array(Math.floor(spec.dur * sr));
  const rng = rngFrom(seed);
  addClick(data, sr, rng, spec.crack);
  addNoise(data, sr, rng, spec.body);
  addTone(data, sr, spec.thump);
  addNoise(data, sr, rng, spec.tail);
  if (spec.echo) addNoise(data, sr, rng, spec.echo);
  if (spec.mech) for (const m of spec.mech) addClick(data, sr, rng, m);
  for (let i = 0; i < data.length; i++) data[i] = softClip(data[i] * 0.85);
  return normalize(data, 0.92);
}

// Medals: note lists as [semitones above A4, start time]. Bigger achievements climb higher and last longer.
const MEDALS = {
  first_blood: { notes: [[0, 0], [7, 0.09], [12, 0.18]], dur: 0.5, gain: 0.7 },
  double:      { notes: [[4, 0], [7, 0.08]], dur: 0.32, gain: 0.6 },
  triple:      { notes: [[4, 0], [7, 0.07], [11, 0.14]], dur: 0.4, gain: 0.65 },
  fury:        { notes: [[4, 0], [7, 0.06], [11, 0.12], [16, 0.18], [19, 0.24]], dur: 0.6, gain: 0.72 },
  revenge:     { notes: [[-5, 0], [-2, 0.1], [3, 0.2]], dur: 0.48, gain: 0.65, shape: 1.5 },
  longshot:    { notes: [[12, 0], [19, 0.14]], dur: 0.55, gain: 0.55 },
  streak3:     { notes: [[0, 0], [4, 0.08], [7, 0.16]], dur: 0.42, gain: 0.65 },
  streak5:     { notes: [[0, 0], [5, 0.08], [9, 0.16], [12, 0.24]], dur: 0.55, gain: 0.7 },
  streak10:    { notes: [[0, 0], [7, 0.07], [12, 0.14], [16, 0.21], [19, 0.28], [24, 0.36]], dur: 0.9, gain: 0.78 },
};

function renderMedal(spec, sr) {
  const data = new Float32Array(Math.floor(spec.dur * sr));
  for (const [semi, at] of spec.notes) {
    const f = 440 * Math.pow(2, semi / 12);
    addTone(data, sr, { at, dur: spec.dur - at, gain: spec.gain, f0: f, decay: 5, attack: 0.004, shape: spec.shape || 0.4 });
    addTone(data, sr, { at, dur: (spec.dur - at) * 0.6, gain: spec.gain * 0.3, f0: f * 2.01, decay: 7, attack: 0.002 });
  }
  return normalize(data, 0.85);
}

function renderSfx(sr) {
  const seed = 9137;
  // Each entry is a thunk, so synthesis can be spread over several small jobs.
  const mk = (dur, fill, peak = 0.9) => () => {
    const d = new Float32Array(Math.floor(dur * sr));
    fill(d, rngFrom(seed + Math.floor(dur * 977)));
    return normalize(d, peak);
  };
  const steps = () => {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const d = new Float32Array(Math.floor(0.16 * sr));
      const r = rngFrom(seed + i * 41 + 5);
      addNoise(d, sr, r, { dur: 0.1, gain: 1, f0: 1300 + i * 170, f1: 240, decay: 7 });
      addTone(d, sr, { dur: 0.07, gain: 0.8, f0: 118 - i * 8, f1: 58, decay: 6 });
      out.push(normalize(d, 0.85));
    }
    return out;
  };
  return {
    // The tick has to cut through gunfire, so it sits above the guns' energy.
    hit: mk(0.075, (d, r) => { addTone(d, sr, { dur: 0.05, gain: 1, f0: 2500, f1: 1900, decay: 8 }); addClick(d, sr, r, { dur: 0.003, gain: 0.8, hp: 5000 }); }),
    hitHeavy: mk(0.13, (d, r) => { addTone(d, sr, { dur: 0.085, gain: 1, f0: 1700, f1: 1100, decay: 6 }); addClick(d, sr, r, { dur: 0.005, gain: 1, hp: 3500 }); }),
    kill: mk(0.44, (d, r) => {
      addTone(d, sr, { dur: 0.14, gain: 0.9, f0: 1560, f1: 1300, decay: 5, shape: 0.5 });
      addTone(d, sr, { at: 0.09, dur: 0.3, gain: 1, f0: 2080, f1: 1740, decay: 5, shape: 0.5 });
      addNoise(d, sr, r, { dur: 0.08, gain: 0.5, f0: 4000, f1: 900, decay: 5 });
    }),
    assist: mk(0.16, (d) => { addTone(d, sr, { dur: 0.14, gain: 1, f0: 1320, f1: 1180, decay: 5 }); }, 0.7),
    hurt: mk(0.22, (d, r) => { addTone(d, sr, { dur: 0.2, gain: 1, f0: 150, f1: 62, decay: 5 }); addNoise(d, sr, r, { dur: 0.1, gain: 0.6, f0: 1400, f1: 300, decay: 6 }); }),
    reloadOut: mk(0.18, (d, r) => { addClick(d, sr, r, { dur: 0.006, gain: 1, hp: 1400 }); addTone(d, sr, { at: 0.012, dur: 0.05, gain: 0.5, f0: 900, f1: 500, decay: 6 }); addNoise(d, sr, r, { at: 0.03, dur: 0.1, gain: 0.3, f0: 2200, f1: 800, hp: 400, decay: 5 }); }),
    reloadIn: mk(0.28, (d, r) => {
      addClick(d, sr, r, { dur: 0.008, gain: 1, hp: 1000 });
      addTone(d, sr, { at: 0.004, dur: 0.05, gain: 0.5, f0: 420, f1: 260, decay: 5 });
      addClick(d, sr, r, { at: 0.16, dur: 0.01, gain: 1.1, hp: 700 });       // Charging handle.
      addTone(d, sr, { at: 0.165, dur: 0.06, gain: 0.5, f0: 320, f1: 170, decay: 5 });
    }),
    swap: mk(0.14, (d, r) => { addNoise(d, sr, r, { dur: 0.1, gain: 0.8, f0: 3200, f1: 900, hp: 500, decay: 5 }); addClick(d, sr, r, { at: 0.07, dur: 0.008, gain: 0.9, hp: 1600 }); }),
    slide: mk(0.62, (d, r) => { addNoise(d, sr, r, { dur: 0.6, gain: 1, f0: 1300, f1: 450, hp: 180, decay: 2.2 }); }),
    explosion: mk(2.1, (d, r) => {
      addClick(d, sr, r, { dur: 0.012, gain: 1.3, hp: 900 });
      addNoise(d, sr, r, { dur: 0.7, gain: 1.8, f0: 2800, f1: 120, decay: 4 });
      addTone(d, sr, { dur: 0.75, gain: 1.8, f0: 76, f1: 24, decay: 3.2, shape: 1.5 });
      addNoise(d, sr, r, { at: 0.08, dur: 1.9, gain: 0.55, f0: 420, f1: 70, decay: 3 });
      for (let i = 0; i < d.length; i++) d[i] = softClip(d[i] * 0.75);
    }, 0.95),
    heartbeat: mk(0.42, (d) => {
      addTone(d, sr, { dur: 0.13, gain: 1, f0: 62, f1: 42, decay: 5, shape: 0.8 });
      addTone(d, sr, { at: 0.18, dur: 0.16, gain: 0.72, f0: 54, f1: 36, decay: 5, shape: 0.8 });
    }),
    uav: mk(1.15, (d) => {
      for (let n = 0; n < 3; n++) addTone(d, sr, { at: n * 0.3, dur: 0.26, gain: 0.8, f0: 880, f1: 1320, decay: 6, attack: 0.01 });
    }, 0.7),
    strike: mk(1.3, (d) => { addTone(d, sr, { dur: 1.28, gain: 0.9, f0: 1500, f1: 340, decay: 0.8, attack: 0.05, shape: 0.3 }); }, 0.7),
    horn: mk(0.9, (d) => {
      addTone(d, sr, { dur: 0.86, gain: 0.8, f0: 196, decay: 1.6, attack: 0.02, shape: 2 });
      addTone(d, sr, { dur: 0.86, gain: 0.5, f0: 294, decay: 1.6, attack: 0.02, shape: 2 });
    }, 0.75),
    end: mk(1.4, (d) => {
      addTone(d, sr, { dur: 1.3, gain: 0.7, f0: 294, decay: 2, attack: 0.02, shape: 1.5 });
      addTone(d, sr, { at: 0.2, dur: 1.15, gain: 0.7, f0: 220, decay: 2, attack: 0.02, shape: 1.5 });
    }, 0.75),
    spawn: mk(0.3, (d, r) => { addNoise(d, sr, r, { dur: 0.28, gain: 1, f0: 800, f1: 3800, hp: 500, decay: 3 }); }, 0.45),
    steps,
  };
}

// A compressor can overshoot on a fast transient, and an overshoot on iOS is an audible crack.
// Linear to about -3 dB, then a smooth knee that can never exceed full scale.
function softClipCurve() {
  const n = 1025, curve = new Float32Array(n), knee = 0.7, range = 1 - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= knee ? a : knee + range * Math.tanh((a - knee) / range));
  }
  return curve;
}

function roomImpulse(ctx) {
  const len = Math.floor(0.75 * ctx.sampleRate);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch), rng = rngFrom(4242 + ch * 77);
    let low = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      low += 0.35 * (rng() - low);
      d[i] = low * Math.pow(1 - t, 3) * (i < 180 ? i / 180 : 1);
    }
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.micActive = false;
    this.volume = 1;
    this.voices = [];
    this.gunCount = 0;
    this.lastShot = new Map();     // Shooter id -> time of last rendered shot.
    this.windowT = 0; this.windowN = 0;
    this.nextMedalAt = 0;
    this.stepState = new Map();
    this.heartT = 0;
    this.lx = 0; this.lz = 0; this.localId = null; this.localAlive = false; this.localTeam = -1;

    // Unlock on the first gesture, and again whenever iOS suspends audio (calls, Siri, backgrounding).
    this._onGesture = () => this.unlock();
    if (typeof document !== 'undefined') {
      for (const type of ['touchend', 'pointerup', 'click', 'keydown']) {
        document.addEventListener(type, this._onGesture, { passive: true, capture: true });
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.ctx) this.ctx.resume().catch(() => {});
      });
    }
  }

  // Must run inside a user gesture the first time. Safe to call repeatedly.
  unlock() {
    if (typeof window === 'undefined') return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    if (!this.ctx) {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this._build();
    }
    if (this.ctx.state !== 'running') {
      // iOS only starts the clock after something plays inside the gesture.
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      src.connect(this.ctx.destination);
      src.start(0);
      const r = this.ctx.resume();
      if (r && r.catch) r.catch(() => {});
    }
  }

  _build() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate || SYNTH_RATE_FALLBACK;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5; this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.08;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 10;
    this.comp.ratio.value = 6; this.comp.attack.value = 0.003; this.comp.release.value = 0.14;

    this.dry = ctx.createGain(); this.dry.gain.value = 0.8;
    this.farFilter = ctx.createBiquadFilter();
    this.farFilter.type = 'lowpass'; this.farFilter.frequency.value = 1500; this.farFilter.Q.value = 0.4;
    this.far = ctx.createGain(); this.far.gain.value = 0.9;
    this.ui = ctx.createGain(); this.ui.gain.value = 0.85;      // Hitmarkers, medals: never distance-filtered.
    this.roomSend = ctx.createGain(); this.roomSend.gain.value = 1;
    this.room = ctx.createConvolver();
    this.room.buffer = roomImpulse(ctx);
    this.roomOut = ctx.createGain(); this.roomOut.gain.value = 0.34;

    this.dry.connect(this.comp);
    this.far.connect(this.farFilter); this.farFilter.connect(this.comp);
    this.roomSend.connect(this.room); this.room.connect(this.roomOut); this.roomOut.connect(this.comp);
    this.comp.connect(this.master);
    this.ui.connect(this.master);
    // The boost for mic mode happens at master, so the limiter and clipper still have the last word.
    this.master.connect(this.limiter);
    this.output = ctx.createWaveShaper();
    this.output.curve = softClipCurve();
    this.limiter.connect(this.output);
    this.output.connect(ctx.destination);

    // Synthesis happens in small jobs after the gesture, so unlocking never hitches a frame.
    this.guns = {}; this.medals = {}; this.sfx = {};
    const jobs = [];
    const sfx = renderSfx(sr);
    for (const k of Object.keys(sfx)) {
      jobs.push(() => {
        const r = sfx[k]();
        this.sfx[k] = Array.isArray(r) ? r.map(d => this._toBuffer(d)) : this._toBuffer(r);
      });
    }
    for (const id of Object.keys(MEDALS)) jobs.push(() => { this.medals[id] = this._toBuffer(renderMedal(MEDALS[id], sr)); });
    let seed = 1234;
    for (const id of Object.keys(GUNS)) {
      this.guns[id] = [];
      for (let v = 0; v < 3; v++) {
        const s = (seed += 73);
        jobs.push(() => { this.guns[id].push(this._toBuffer(renderGun(GUNS[id], sr, s))); });
      }
    }
    let i = 0;
    this.buildMs = 0; this.buildMaxJobMs = 0;
    const runNext = () => {
      if (!this.ctx) return;
      const t = performance.now();
      jobs[i++]();
      const ms = performance.now() - t;
      this.buildMs += ms; this.buildMaxJobMs = Math.max(this.buildMaxJobMs, ms);
      if (i < jobs.length) setTimeout(runNext, 0);
      else { this.ready = true; this.setMicActive(this.micActive); }
    };
    setTimeout(runNext, 0);
  }

  _toBuffer(data) {
    const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    buf.getChannelData(0).set(data);
    return buf;
  }

  // The iOS voice-chat audio session ducks everything playing while the mic is open; push the mix up to meet it.
  // The limiter and clipper after master hold the increase safe.
  setMicActive(active) {
    this.micActive = !!active;
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const boost = this.micActive ? 2.3 : 1;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.volume * boost, now, 0.08);
    this.comp.threshold.setTargetAtTime(this.micActive ? -24 : -16, now, 0.08);
    this.comp.ratio.setTargetAtTime(this.micActive ? 9 : 6, now, 0.08);
  }

  setVolume(v) {
    this.volume = v;
    this.setMicActive(this.micActive);
  }

  // Removes finished voices. Called before any decision that needs the live count.
  _reap(now) {
    let w = 0;
    let guns = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.end <= now) continue;
      this.voices[w++] = v;
      if (v.gun) guns++;
    }
    this.voices.length = w;
    this.gunCount = guns;
  }

  // Voice stealing: the weakest (lowest priority, then oldest) gives way to something more important.
  _stealFor(priority, gunsOnly, now) {
    let victim = -1, vp = priority + 1, vt = Infinity;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (gunsOnly && !v.gun) continue;
      if (v.priority < vp || (v.priority === vp && v.start < vt)) { victim = i; vp = v.priority; vt = v.start; }
    }
    if (victim < 0) return false;
    const v = this.voices[victim];
    // A very short fade, because cutting a waveform dead makes a click.
    v.gain.gain.setTargetAtTime(0, now, 0.008);
    try { v.src.stop(now + 0.04); } catch { /* already stopped */ }
    v.end = now + 0.04;
    this.voices.splice(victim, 1);
    if (v.gun) this.gunCount--;
    return true;
  }

  // The single place sound starts. Returns false when the voice budget refuses it.
  _play(buffer, { gain = 1, pan = 0, far = 0, rate = 1, bus = null, priority = 1, gun = false, when = 0, room = 0 } = {}) {
    if (!this.ready || !buffer || this.ctx.state !== 'running') return false;
    const ctx = this.ctx, now = ctx.currentTime;
    this._reap(now);
    if (gun && this.gunCount >= MAX_GUN_VOICES && !this._stealFor(priority, true, now)) return false;
    if (this.voices.length >= MAX_VOICES && !this._stealFor(priority, false, now)) return false;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    let tail = g;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      tail = p;
    }
    if (bus) {
      tail.connect(bus);
    } else {
      // Crossfade between the bright dry path and the dull far path by distance.
      if (far < 0.95) tail.connect(this.dry);
      if (far > 0.05) tail.connect(this.far);
      if (room > 0) {
        const send = ctx.createGain();
        send.gain.value = room;
        g.connect(send);
        send.connect(this.roomSend);
      }
    }
    src.start(when || 0);
    const start = when || now;
    this.voices.push({ src, gain: g, priority, gun, start, end: start + buffer.duration / rate + 0.05 });
    if (gun) this.gunCount++;
    return true;
  }

  // Distance model: returns [gain, pan, far] for a world position, into shared fields.
  _spatial(x, z) {
    const dx = x - this.lx, dz = z - this.lz;
    const d = Math.hypot(dx, dz);
    this.sD = d;
    this.sGain = 1 / (1 + Math.pow(d / 11, 1.7));
    this.sPan = Math.max(-0.85, Math.min(0.85, dx / 18));
    this.sFar = Math.min(1, Math.max(0, (d - 9) / 28));
    return d;
  }

  _trackLocal(view) {
    if (!view) return;
    this.localId = view.localId;
    const players = view.players;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.id === view.localId) {
        this.lx = p.x; this.lz = p.z; this.localAlive = p.alive; this.localHp = p.hp; this.localTeam = p.team;
        return;
      }
    }
  }

  _posOf(view, id) {
    const players = view && view.players;
    if (!players) return null;
    for (let i = 0; i < players.length; i++) if (players[i].id === id) return players[i];
    return null;
  }

  _shot(e) {
    const self = e.by === this.localId;
    const now = this.ctx.currentTime;
    const buffers = this.guns[e.weapon];
    if (!buffers) return;
    if (self) {
      this._play(buffers[Math.floor(Math.random() * 3)], {
        gain: 1, rate: 0.97 + Math.random() * 0.06, priority: 4, gun: true, room: 0.22,
      });
      return;
    }
    const d = this._spatial(e.ox, e.oz);
    if (d > HEAR_RANGE) return;
    const last = this.lastShot.get(e.by) || 0;
    if (now - last < SHOOTER_MIN_GAP) return;
    // At most a few new gunshots per window: stacked identical transients are what makes a mix crackle.
    if (now - this.windowT > GUN_WINDOW) { this.windowT = now; this.windowN = 0; }
    if (this.windowN >= GUN_WINDOW_CAP && d > 14) return;
    this.windowN++;
    this.lastShot.set(e.by, now);
    const close = d < 16;
    this._play(buffers[Math.floor(Math.random() * 3)], {
      gain: 0.92 * this.sGain, pan: this.sPan, far: this.sFar,
      rate: 0.95 + Math.random() * 0.1,
      priority: close ? 2 : 1, gun: true, room: 0.14 + 0.28 * this.sFar,
    });
  }

  _world(buffer, x, z, range, opts) {
    if (this._spatial(x, z) > range) return;
    this._play(buffer, { gain: (opts.gain ?? 1) * this.sGain, pan: this.sPan, far: this.sFar, priority: opts.priority ?? 1, room: opts.room ?? 0, rate: opts.rate ?? 1 });
  }

  _medal(id) {
    const buf = this.medals[id];
    if (!buf) return;
    // Stack multiple medals one after another, never on top of each other.
    const now = this.ctx.currentTime;
    const when = Math.max(now, this.nextMedalAt);
    this._play(buf, { bus: this.ui, priority: 3, when });
    this.nextMedalAt = when + buf.duration * 0.65;
  }

  onEvents(events, view) {
    if (!this.ready || this.ctx.state !== 'running') return;
    this._trackLocal(view);
    const me = this.localId;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.t) {
        case 'shot': this._shot(e); break;
        case 'hit':
          if (e.by === me) this._play(e.killed ? this.sfx.hitHeavy : this.sfx.hit, { bus: this.ui, priority: 5, gain: 0.8, rate: 0.98 + Math.random() * 0.04 });
          else if (e.target === me) this._play(this.sfx.hurt, { bus: this.ui, priority: 5, gain: 0.85 });
          break;
        case 'kill':
          if (e.by === me) this._play(this.sfx.kill, { bus: this.ui, priority: 5, gain: 1 });
          else if (e.assist === me) this._play(this.sfx.assist, { bus: this.ui, priority: 4, gain: 0.8 });
          break;
        case 'medal':
          if (e.id === me) this._medal(e.medal);
          break;
        case 'reload': {
          const p = this._posOf(view, e.id);
          const buf = e.stage === 'start' ? this.sfx.reloadOut : this.sfx.reloadIn;
          if (e.id === me) this._play(buf, { bus: this.ui, priority: 3, gain: 0.7 });
          else if (p) this._world(buf, p.x, p.z, 18, { gain: 0.5, priority: 1 });
          break;
        }
        case 'swap': {
          const p = this._posOf(view, e.id);
          if (e.id === me) this._play(this.sfx.swap, { bus: this.ui, priority: 3, gain: 0.6 });
          else if (p) this._world(this.sfx.swap, p.x, p.z, 14, { gain: 0.4, priority: 1 });
          break;
        }
        case 'slide': {
          const p = this._posOf(view, e.id);
          if (e.id === me) this._play(this.sfx.slide, { bus: this.ui, priority: 2, gain: 0.6 });
          else if (p) this._world(this.sfx.slide, p.x, p.z, 22, { gain: 0.8, priority: 1 });
          break;
        }
        case 'spawn':
          if (e.id === me) this._play(this.sfx.spawn, { bus: this.ui, priority: 2 });
          break;
        case 'streak':
          if (e.kind === 'uav') this._play(this.sfx.uav, { bus: this.ui, priority: 3, gain: e.team === this.localTeam ? 0.7 : 0.45 });
          else this._play(this.sfx.strike, { bus: this.ui, priority: 3, gain: e.team === this.localTeam ? 0.55 : 0.8 });
          break;
        case 'explosion':
          this._world(this.sfx.explosion, e.x, e.z, HEAR_RANGE + 20, { gain: 2.3, priority: 4, room: 0.45 });
          break;
        case 'phase':
          if (e.phase === 'live') this._play(this.sfx.horn, { bus: this.ui, priority: 4, gain: 0.8 });
          else if (e.phase === 'ended') this._play(this.sfx.end, { bus: this.ui, priority: 4, gain: 0.9 });
          break;
        default: break;
      }
    }
  }

  // Continuous sounds that come from state instead of events: footsteps and the low-health heartbeat.
  update(view, dt) {
    if (!this.ready || !view || this.ctx.state !== 'running') return;
    this._trackLocal(view);
    const players = view.players;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const speed = Math.hypot(p.vx, p.vz);
      let t = this.stepState.get(p.id);
      if (t === undefined) t = 0;
      if (!p.alive || p.sliding || speed < 2.2) { this.stepState.set(p.id, 0.05); continue; }
      t -= dt;
      if (t <= 0) {
        t += speed > 6.8 ? 0.27 : 0.37;
        this._step(p);
      }
      this.stepState.set(p.id, t);
    }

    if (this.localAlive && this.localHp <= 35) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.62 + this.localHp / 35 * 0.42;
        this._play(this.sfx.heartbeat, { bus: this.ui, priority: 4, gain: 0.9 });
      }
    } else {
      this.heartT = 0;
    }
  }

  _step(p) {
    const buf = this.sfx.steps[Math.floor(Math.random() * this.sfx.steps.length)];
    if (p.id === this.localId) {
      this._play(buf, { priority: 1, gain: 0.14, rate: 0.95 + Math.random() * 0.1 });
      return;
    }
    if (p.team === this.localTeam) return;    // Enemies only: footsteps are information.
    if (this._spatial(p.x, p.z) > STEP_RANGE) return;
    // Steps stay audible further than the gun model would, otherwise they carry no information.
    this._play(buf, {
      gain: (p.sprinting ? 0.85 : 0.5) * Math.max(0.12, 1 - this.sD / STEP_RANGE),
      pan: this.sPan, far: this.sFar, priority: this.sD < 10 ? 2 : 1,
      rate: 0.92 + Math.random() * 0.16,
    });
  }

  dispose() {
    if (typeof document !== 'undefined') {
      for (const type of ['touchend', 'pointerup', 'click', 'keydown']) {
        document.removeEventListener(type, this._onGesture, { capture: true });
      }
    }
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.ready = false;
  }
}
