// All game audio, synthesized: no files. Every sound is rendered once, in plain JS, into an AudioBuffer
// when audio unlocks; playing one costs a source, a gain and a panner. Firing 12 guns is then just
// buffer playback, which is what keeps a firefight from stuttering on a phone.
//
// Graph: world voices -> dry bus + far bus (lowpass) + room send -> world duck -> compressor -> master -> limiter -> soft clip.
// The local player's gun skips the duck, so it sits on top of everything else. Feedback sounds (hitmarkers, medals, music)
// join after the compressor so gunfire never ducks them. Weather and thunder duck under a firefight (see _updateDucks).
//
// The mix is a strict priority list with hard caps. Every voice has a priority (PR) and a class (CLASS_CAP): your own
// gun and threats near you take the top, a class over its cap replaces its own weakest voice or is refused. Gunfire past
// FAR_CULL never gets a voice at all: it just raises one looped far-firefight layer, so twelve players across the map
// cost one voice and read as one sound, not a pile of quiet repeats.
//
// A gunshot is four layers. near: crack, body, low thump and the gun's own action, all one buffer. tail: the long
// distant roar, which is what you hear from across the map. reflection: the slap off whatever the map is built
// from, chosen by the map's theme. Near has suppressed variants, used for shots flagged `sup`.
// Tail and reflection play at the lowest priority and are thinned out at high fire rates, so they never steal a
// near voice and a held trigger stays one clean shot per shot.

import { WEAPONS } from '../shared/weapons.js';

const MAX_VOICES = 26;
// Priority. A new voice can only replace something strictly lower, so the top of this list always plays.
const PR = { own: 7, threat: 6, hit: 5, boom: 4, gunNear: 3, ui: 3, world: 2, gun: 1, step: 1, tail: 0 };
// Hard caps: never more than this many voices of a class at once. The far layer is not a voice: it is one loop.
const CLASS_CAP = { own: 3, threat: 4, gun: 3, tail: 3, reflect: 1, boom: 3, impact: 2, foley: 2, step: 2, world: 3, ui: 3, medal: 1, loud: 2 };

const THREAT_RANGE = 14;         // An enemy gun this close is a threat, not background.
const FAR_CULL = 30;             // Other players' guns past this distance get no voice of their own.
const GUN_WINDOW = 0.05;         // Seconds; the gunshot rate cap below applies per window.
const GUN_WINDOW_CAP = 3;
const SHOOTER_GAP_NEAR = 0.05;   // Per shooter: fast guns don't need every shot rendered, and less so with distance.
const SHOOTER_GAP_MID = 0.1;
const SHOOTER_GAP_FAR = 0.16;
const TAIL_GAP = 0.11;           // Seconds. A held trigger renders one tail per this, not one per round.
const TAIL_GLOBAL_GAP = 0.05;    // And no more than one new tail per this across the whole map.
const REFLECT_GAP = 0.13;
const HEAR_RANGE = 58;
const STEP_RANGE = 24;
const WHIZ_RADIUS = 1.5;         // A round passing this close to you is heard going by.
const IMPACT_RANGE = 16;
const FOLEY_RANGE = 12;
const HIT_GAP = 0.05;            // Hitmarkers: one per this, however fast the gun.
const MEDAL_STALE = 1.4;         // A medal that could not play within this many seconds is dropped, not queued.
const FIGHT_DECAY = 0.45;        // Per second. How fast the "firefight" level (which ducks the beds) falls back to calm.
const WORLD_DUCK = 0.6;          // World buses while your own gun is firing.
const TENSION_KILLS = 5;         // Team deathmatch and Kill Confirmed: this many short of the limit is "last kills".
const TENSION_POINTS = 0.1;      // Objective modes: this fraction of the limit left.

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

// ---- Small synthesis building blocks for the new layers. ----

function addMetal(data, sr, { at = 0, dur, gain, f, spread = 1, decay = 7 }) {
  // Inharmonic partials: the ratios of a struck bar, which is what makes a click read as metal.
  addTone(data, sr, { at, dur, gain, f0: f, f1: f * 0.985, decay, attack: 0.0004 });
  addTone(data, sr, { at, dur: dur * 0.7, gain: gain * 0.55, f0: f * 2.76 * spread, f1: f * 2.7 * spread, decay: decay * 1.2, attack: 0.0004 });
  addTone(data, sr, { at, dur: dur * 0.5, gain: gain * 0.3, f0: f * 5.4 * spread, f1: f * 5.2 * spread, decay: decay * 1.4, attack: 0.0004 });
}

// A mechanical action: a hard click with a little metal behind it, or a knock when thump is set.
function addAction(data, sr, rng, { at, gain, hp = 1800, dur = 0.012, metal = 0, thump = 0 }) {
  addClick(data, sr, rng, { at, dur, gain, hp });
  if (metal) addMetal(data, sr, { at, dur: 0.05, gain: gain * 0.5, f: metal, decay: 8 });
  if (thump) addTone(data, sr, { at, dur: 0.04, gain: gain * 0.6, f0: thump, f1: thump * 0.6, decay: 5 });
}

// ---- Gun recipes. `crack` is the transient, `body` the bang, `thump` the low end, `action` the gun cycling,
// `tail` the far-field roar, `size` the reflection weight (0 light, 1 medium, 2 heavy). ----

const GUNS = {
  ar: { size: 1,
    crack: { dur: 0.005, gain: 1.1, hp: 2200 },
    body: { dur: 0.12, gain: 1.15, f0: 5200, f1: 700, decay: 6 },
    thump: { dur: 0.09, gain: 0.9, f0: 150, f1: 55, decay: 5 },
    action: [{ at: 0.045, gain: 0.55, hp: 2600, dur: 0.008, metal: 1450 }, { at: 0.082, gain: 0.5, hp: 1800, dur: 0.01, thump: 310 }],
    tail: { dur: 0.95, gain: 1, f0: 1500, f1: 300, decay: 4.2 },
  },
  smg: { size: 0,
    crack: { dur: 0.003, gain: 1.15, hp: 3800 },
    body: { dur: 0.06, gain: 1.05, f0: 7600, f1: 1700, decay: 6 },
    thump: { dur: 0.04, gain: 0.55, f0: 240, f1: 120, decay: 5 },
    action: [{ at: 0.03, gain: 0.5, hp: 3200, dur: 0.006, metal: 2100 }],
    tail: { dur: 0.7, gain: 0.85, f0: 2400, f1: 620, decay: 5 },
  },
  shotgun: { size: 2,
    crack: { dur: 0.008, gain: 1, hp: 1500 },
    body: { dur: 0.24, gain: 1.5, f0: 3000, f1: 260, decay: 5 },
    thump: { dur: 0.18, gain: 1.4, f0: 105, f1: 38, decay: 4 },
    // Pump: back, then forward, after the bang has passed.
    action: [{ at: 0.42, gain: 0.55, hp: 1200, dur: 0.02, thump: 180 }, { at: 0.56, gain: 0.65, hp: 900, dur: 0.025, metal: 900, thump: 240 }],
    tail: { dur: 1.35, gain: 1, f0: 900, f1: 170, decay: 3.8 },
  },
  lmg: { size: 2,
    crack: { dur: 0.006, gain: 1.15, hp: 1800 },
    body: { dur: 0.16, gain: 1.35, f0: 3400, f1: 420, decay: 5.5 },
    thump: { dur: 0.13, gain: 1.25, f0: 120, f1: 44, decay: 4.5, shape: 1.2 },
    // Belt links rattling through the feed tray.
    action: [{ at: 0.038, gain: 0.45, hp: 2000, dur: 0.012, metal: 1200 }, { at: 0.075, gain: 0.35, hp: 3000, dur: 0.006, metal: 2600 }],
    tail: { dur: 1.2, gain: 1, f0: 1100, f1: 230, decay: 4 },
  },
  sniper: { size: 2,
    crack: { dur: 0.004, gain: 1.4, hp: 4200 },
    body: { dur: 0.3, gain: 1.6, f0: 4200, f1: 200, decay: 5 },
    thump: { dur: 0.3, gain: 1.5, f0: 90, f1: 28, decay: 3.5, shape: 0.8 },
    // The bolt being worked, and the spent brass.
    action: [{ at: 0.72, gain: 0.55, hp: 1500, dur: 0.018, metal: 1100 }, { at: 0.9, gain: 0.5, hp: 1100, dur: 0.02, thump: 260 }, { at: 1.05, gain: 0.2, hp: 5000, dur: 0.004, metal: 3400 }],
    tail: { dur: 2.2, gain: 1, f0: 800, f1: 120, decay: 3.2 },
  },
  pistol: { size: 0,
    crack: { dur: 0.004, gain: 1.15, hp: 2800 },
    body: { dur: 0.075, gain: 1, f0: 6000, f1: 1200, decay: 6 },
    thump: { dur: 0.06, gain: 0.7, f0: 200, f1: 85, decay: 5 },
    action: [{ at: 0.03, gain: 0.5, hp: 2600, dur: 0.008, metal: 1700 }],
    tail: { dur: 0.8, gain: 0.85, f0: 2000, f1: 450, decay: 4.8 },
  },
  // Sharp, compressed snaps: three of these in 140 ms have to read as one clipped phrase.
  burst: { size: 1,
    crack: { dur: 0.004, gain: 1.25, hp: 2600 },
    body: { dur: 0.085, gain: 1.2, f0: 6400, f1: 900, decay: 7 },
    thump: { dur: 0.07, gain: 0.95, f0: 170, f1: 72, decay: 6, shape: 0.7 },
    ring: { dur: 0.05, gain: 0.25, f0: 2400, f1: 1900, decay: 8 },
    action: [{ at: 0.04, gain: 0.45, hp: 3000, dur: 0.006, metal: 1900 }],
    tail: { dur: 0.85, gain: 0.9, f0: 1800, f1: 400, decay: 4.6 },
  },
  // A very short, buzzy rip: almost no body and no thump, so at 1200 rpm it reads as a saw, not as a rifle.
  pdw: { size: 0,
    crack: { dur: 0.002, gain: 1.05, hp: 5200 },
    body: { dur: 0.038, gain: 0.95, f0: 9000, f1: 2600, decay: 6 },
    thump: { dur: 0.025, gain: 0.32, f0: 300, f1: 170, decay: 4, shape: 1.4 },
    action: [{ at: 0.02, gain: 0.3, hp: 4200, dur: 0.004, metal: 2800 }],
    tail: { dur: 0.55, gain: 0.7, f0: 3000, f1: 900, decay: 5.5 },
  },
  // A short, boomy cough with a drum rattle after it: lighter than the pump gun and built to repeat.
  autoshot: { size: 2,
    crack: { dur: 0.007, gain: 1, hp: 1300 },
    body: { dur: 0.15, gain: 1.45, f0: 2600, f1: 320, decay: 5.2 },
    thump: { dur: 0.12, gain: 1.35, f0: 112, f1: 46, decay: 4.2, shape: 1.1 },
    action: [{ at: 0.18, gain: 0.45, hp: 2200, dur: 0.012, thump: 200 }, { at: 0.22, gain: 0.3, hp: 3000, dur: 0.008, metal: 1500 }],
    tail: { dur: 1, gain: 0.95, f0: 1000, f1: 210, decay: 4.2 },
  },
  // A tight, high crack and a clean falling ring: the sound of one deliberate round.
  dmr: { size: 1,
    crack: { dur: 0.003, gain: 1.45, hp: 4800 },
    body: { dur: 0.14, gain: 1.4, f0: 5200, f1: 480, decay: 6 },
    thump: { dur: 0.14, gain: 1.15, f0: 125, f1: 46, decay: 4.2, shape: 0.6 },
    ring: { dur: 0.22, gain: 0.3, f0: 3100, f1: 2400, decay: 7 },
    action: [{ at: 0.06, gain: 0.45, hp: 3400, dur: 0.008, metal: 2200 }],
    tail: { dur: 1.5, gain: 1, f0: 1200, f1: 200, decay: 3.6 },
  },
  // A huge flat boom with a metal bark on the front and a long ring: slow gun, so every shot gets to sing.
  revolver: { size: 2,
    crack: { dur: 0.005, gain: 1.35, hp: 2400 },
    body: { dur: 0.17, gain: 1.6, f0: 3800, f1: 300, decay: 4.6 },
    thump: { dur: 0.2, gain: 1.55, f0: 98, f1: 36, decay: 3.6, shape: 1.3 },
    ring: { dur: 0.34, gain: 0.42, f0: 2050, f1: 1720, decay: 5.5 },
    action: [{ at: 0.34, gain: 0.34, hp: 2600, dur: 0.008, metal: 1500 }],
    tail: { dur: 1.6, gain: 1, f0: 900, f1: 150, decay: 3.4 },
  },
  // Ignition: a click, a pressure thump and a long tearing hiss as the rocket leaves. The bang is the explosion event.
  launcher: { size: 2,
    crack: { dur: 0.012, gain: 1.05, hp: 900 },
    body: { dur: 0.32, gain: 1.15, f0: 1700, f1: 300, decay: 3.8 },
    thump: { dur: 0.22, gain: 1.5, f0: 80, f1: 32, decay: 3.4, shape: 1.6 },
    hiss: { at: 0.05, dur: 0.75, gain: 0.5, f0: 6000, f1: 1500, hp: 1100, decay: 3.6 },
    action: [{ at: 0.86, gain: 0.3, hp: 1300, dur: 0.02, thump: 170 }],
    tail: { dur: 1.7, gain: 1, f0: 700, f1: 120, decay: 3.2 },
    noSup: true,
  },
  // ---- Wave 5 guns. Each shares its category's skeleton and differs where the gun does. ----
  // A chesty, lower bark than the Halyard, with a heavier bolt slam: three of these kill, and it should sound it.
  heavyar: { size: 2,
    crack: { dur: 0.006, gain: 1.15, hp: 1900 },
    body: { dur: 0.15, gain: 1.3, f0: 4200, f1: 520, decay: 5.4 },
    thump: { dur: 0.12, gain: 1.1, f0: 132, f1: 48, decay: 4.6, shape: 0.9 },
    action: [{ at: 0.05, gain: 0.5, hp: 2200, dur: 0.01, metal: 1150 }, { at: 0.095, gain: 0.55, hp: 1500, dur: 0.012, thump: 260 }],
    tail: { dur: 1.1, gain: 1, f0: 1300, f1: 240, decay: 4 },
  },
  // Clean and clipped, with a faint bright ring: the SMG that sounds like it is being aimed.
  tacsmg: { size: 0,
    crack: { dur: 0.003, gain: 1.15, hp: 4200 },
    body: { dur: 0.055, gain: 1, f0: 8200, f1: 2100, decay: 7 },
    thump: { dur: 0.035, gain: 0.45, f0: 260, f1: 140, decay: 5 },
    ring: { dur: 0.04, gain: 0.18, f0: 3600, f1: 3300, decay: 9 },
    action: [{ at: 0.028, gain: 0.42, hp: 3600, dur: 0.005, metal: 2400 }],
    tail: { dur: 0.6, gain: 0.8, f0: 2600, f1: 700, decay: 5.2 },
  },
  // Both barrels: the biggest, roundest boom of the shotguns, a low barrel ring and no pump after it.
  coach: { size: 2,
    crack: { dur: 0.009, gain: 1, hp: 1300 },
    body: { dur: 0.28, gain: 1.6, f0: 2600, f1: 220, decay: 4.6 },
    thump: { dur: 0.22, gain: 1.6, f0: 95, f1: 34, decay: 3.8, shape: 1.2 },
    ring: { dur: 0.25, gain: 0.2, f0: 620, f1: 560, decay: 6 },
    action: [{ at: 0.03, gain: 0.25, hp: 1500, dur: 0.01, metal: 700 }],
    tail: { dur: 1.5, gain: 1, f0: 800, f1: 150, decay: 3.6 },
  },
  // Lighter than the Bulwark and quicker: a rattling chug with the belt chattering twice per round.
  saw: { size: 1,
    crack: { dur: 0.005, gain: 1.1, hp: 2000 },
    body: { dur: 0.11, gain: 1.2, f0: 4200, f1: 600, decay: 6 },
    thump: { dur: 0.09, gain: 1, f0: 140, f1: 55, decay: 5, shape: 1 },
    action: [{ at: 0.03, gain: 0.4, hp: 2400, dur: 0.008, metal: 1600 }, { at: 0.055, gain: 0.3, hp: 3600, dur: 0.005, metal: 3000 }],
    tail: { dur: 1, gain: 0.95, f0: 1300, f1: 280, decay: 4.2 },
  },
  // Each round is a tiny low pop over a rising motor whine; at 1300 rpm they fuse into the rotary's tearing buzz.
  rotary: { size: 2,
    crack: { dur: 0.002, gain: 0.9, hp: 3000 },
    body: { dur: 0.03, gain: 0.9, f0: 5600, f1: 1400, decay: 5 },
    thump: { dur: 0.04, gain: 0.85, f0: 160, f1: 90, decay: 3, shape: 1.6 },
    ring: { dur: 0.06, gain: 0.2, f0: 900, f1: 1100, decay: 1 },
    action: [{ at: 0.012, gain: 0.35, hp: 5000, dur: 0.003, metal: 3200 }],
    tail: { dur: 0.9, gain: 0.95, f0: 1000, f1: 260, decay: 4.2 },
  },
  // A big rifle round on a semi: a hard crack, a heavy body, and a sharp metal ping off the action.
  battle: { size: 2,
    crack: { dur: 0.004, gain: 1.35, hp: 3600 },
    body: { dur: 0.13, gain: 1.4, f0: 4800, f1: 420, decay: 5.6 },
    thump: { dur: 0.13, gain: 1.25, f0: 118, f1: 44, decay: 4.4, shape: 0.9 },
    action: [{ at: 0.05, gain: 0.5, hp: 2800, dur: 0.01, metal: 1700 }],
    tail: { dur: 1.3, gain: 1, f0: 1100, f1: 200, decay: 3.8 },
  },
  // Boomy frontier bang, then the lever: down and up, both clearly heard before the next shot.
  lever: { size: 1,
    crack: { dur: 0.004, gain: 1.3, hp: 3000 },
    body: { dur: 0.15, gain: 1.45, f0: 4000, f1: 360, decay: 5 },
    thump: { dur: 0.15, gain: 1.3, f0: 110, f1: 40, decay: 4, shape: 0.7 },
    action: [{ at: 0.3, gain: 0.5, hp: 1800, dur: 0.014, metal: 1300 }, { at: 0.4, gain: 0.6, hp: 1300, dur: 0.016, metal: 950, thump: 280 }],
    tail: { dur: 1.4, gain: 1, f0: 1000, f1: 180, decay: 3.6 },
  },
  // The loudest thing in the game that is not an explosion: a muzzle-brake blast on the front, a huge low body and a
  // long rolling tail, then the heavy bolt and a big case on the ground.
  antimat: { size: 2,
    crack: { dur: 0.006, gain: 1.5, hp: 3000 },
    body: { dur: 0.42, gain: 1.8, f0: 3200, f1: 160, decay: 4.2 },
    thump: { dur: 0.4, gain: 1.8, f0: 70, f1: 24, decay: 3, shape: 1.6 },
    hiss: { at: 0.004, dur: 0.18, gain: 0.45, f0: 7000, f1: 2500, hp: 1800, decay: 5 },
    action: [{ at: 1.2, gain: 0.55, hp: 1300, dur: 0.02, metal: 800 }, { at: 1.4, gain: 0.55, hp: 1000, dur: 0.022, thump: 210 }, { at: 1.62, gain: 0.25, hp: 4000, dur: 0.005, metal: 2600 }],
    tail: { dur: 2.8, gain: 1, f0: 650, f1: 90, decay: 2.9 },
  },
  // A lighter sniper crack with a bright ring, and a bolt that comes back fast.
  semisnipe: { size: 2,
    crack: { dur: 0.003, gain: 1.4, hp: 5000 },
    body: { dur: 0.22, gain: 1.45, f0: 5000, f1: 300, decay: 5.4 },
    thump: { dur: 0.2, gain: 1.3, f0: 105, f1: 36, decay: 3.8, shape: 0.6 },
    ring: { dur: 0.16, gain: 0.22, f0: 2800, f1: 2300, decay: 7 },
    action: [{ at: 0.45, gain: 0.5, hp: 1700, dur: 0.014, metal: 1350 }, { at: 0.58, gain: 0.45, hp: 1300, dur: 0.016, thump: 290 }],
    tail: { dur: 1.8, gain: 1, f0: 1000, f1: 150, decay: 3.4 },
  },
  // Thin, high and tinny: a pocket buzzsaw that spits, with a little slide ringing over almost nothing underneath.
  machpistol: { size: 0,
    crack: { dur: 0.002, gain: 1.1, hp: 5600 },
    body: { dur: 0.032, gain: 0.85, f0: 11000, f1: 4200, decay: 6.5 },
    thump: { dur: 0.02, gain: 0.22, f0: 360, f1: 220, decay: 4, shape: 1 },
    ring: { dur: 0.03, gain: 0.32, f0: 4400, f1: 3800, decay: 8 },
    action: [{ at: 0.014, gain: 0.45, hp: 5200, dur: 0.003, metal: 3800 }],
    tail: { dur: 0.5, gain: 0.7, f0: 3200, f1: 1000, decay: 5.6 },
  },
  // A punchier pistol with a bright slide clack: two of these 75 ms apart read as one double knock.
  deuce: { size: 0,
    crack: { dur: 0.004, gain: 1.2, hp: 3000 },
    body: { dur: 0.085, gain: 1.15, f0: 5400, f1: 1000, decay: 6 },
    thump: { dur: 0.07, gain: 0.9, f0: 175, f1: 70, decay: 4.6, shape: 0.8 },
    ring: { dur: 0.05, gain: 0.25, f0: 2300, f1: 2000, decay: 8 },
    action: [{ at: 0.035, gain: 0.5, hp: 2900, dur: 0.007, metal: 2000 }],
    tail: { dur: 0.75, gain: 0.85, f0: 2100, f1: 500, decay: 4.8 },
  },
  // A hollow tube pop, no crack and no rocket hiss, then the cylinder indexing round. The bang is the explosion event.
  thumper: { size: 1,
    crack: { dur: 0.01, gain: 0.6, hp: 700 },
    body: { dur: 0.12, gain: 0.9, f0: 1400, f1: 300, decay: 5 },
    thump: { dur: 0.16, gain: 1.6, f0: 140, f1: 70, decay: 4, shape: 0.4 },
    ring: { dur: 0.12, gain: 0.45, f0: 320, f1: 260, decay: 6 },
    action: [{ at: 0.3, gain: 0.35, hp: 1600, dur: 0.01, metal: 1100 }],
    tail: { dur: 1, gain: 0.9, f0: 700, f1: 150, decay: 4 },
    noSup: true,
  },
  // Scorestreak guns: a dry mechanical chatter, and a slow autocannon heard from above.
  turret: { size: 1,
    crack: { dur: 0.004, gain: 1.2, hp: 3200 },
    body: { dur: 0.07, gain: 1, f0: 4800, f1: 1500, decay: 7 },
    thump: { dur: 0.05, gain: 0.7, f0: 300, f1: 140, decay: 5, shape: 1 },
    action: [{ at: 0.05, gain: 0.5, hp: 2400, dur: 0.006, metal: 1800 }],
    tail: { dur: 0.6, gain: 0.8, f0: 1800, f1: 500, decay: 5 },
    noSup: true,
  },
  gunship: { size: 2,
    crack: { dur: 0.007, gain: 1.1, hp: 1200 },
    body: { dur: 0.22, gain: 1.45, f0: 2200, f1: 240, decay: 5 },
    thump: { dur: 0.22, gain: 1.6, f0: 88, f1: 32, decay: 3.8, shape: 1.4 },
    action: [{ at: 0.16, gain: 0.3, hp: 1600, dur: 0.012, thump: 200 }],
    tail: { dur: 1.3, gain: 1, f0: 620, f1: 110, decay: 3.4 },
    noSup: true,
  },
};

function actionLength(spec) {
  let last = 0;
  for (const a of spec.action) if (a.at > last) last = a.at;
  return last;
}

// Crack, body, thump and action, without the far-field tail: that plays separately so a shot from across the map
// can be mostly tail, and a held trigger is not a stack of long tails.
function renderNear(spec, sr, seed) {
  const dur = Math.max(spec.body.dur, spec.thump.dur) + 0.05 + actionLength(spec);
  const data = new Float32Array(Math.floor(dur * sr));
  const rng = rngFrom(seed);
  addClick(data, sr, rng, spec.crack);
  addNoise(data, sr, rng, spec.body);
  addTone(data, sr, spec.thump);
  if (spec.ring) addTone(data, sr, spec.ring);
  if (spec.hiss) addNoise(data, sr, rng, spec.hiss);
  // A breath of room, so the near layer does not stop dead while the tail is still coming up.
  addNoise(data, sr, rng, { dur: 0.1, gain: 0.3, f0: spec.body.f0 * 0.4, f1: spec.body.f1 * 0.6, decay: 4 });
  for (const a of spec.action) addAction(data, sr, rng, a);
  for (let i = 0; i < data.length; i++) data[i] = softClip(data[i] * 0.85);
  return normalize(data, 0.92);
}

// A can over the muzzle: the crack and most of the bang go, a low cough of gas remains, and the gun's action,
// no longer drowned out, becomes the loudest thing about it.
function renderSuppressed(spec, sr, seed) {
  const dur = Math.max(0.09, Math.min(0.4, spec.body.dur)) + 0.06 + actionLength(spec) * 0.6;
  const data = new Float32Array(Math.floor(dur * sr));
  const rng = rngFrom(seed);
  addNoise(data, sr, rng, { dur: Math.max(0.05, spec.body.dur * 0.55), gain: 1.1, f0: Math.min(2600, spec.body.f0 * 0.42), f1: spec.body.f1 * 0.45, decay: 6 });
  addNoise(data, sr, rng, { dur: 0.05, gain: 0.45, f0: 2800, f1: 900, hp: 700, decay: 7 });
  addTone(data, sr, { dur: spec.thump.dur * 0.6, gain: spec.thump.gain * 0.38, f0: spec.thump.f0 * 1.15, f1: spec.thump.f1, decay: 6 });
  for (const a of spec.action) addAction(data, sr, rng, { ...a, gain: a.gain * 1.35 });
  return normalize(data, 0.8);
}

// The part that carries: no transient, all low roar and scattered far-off returns.
function renderTail(spec, sr, seed) {
  const t = spec.tail, data = new Float32Array(Math.floor(t.dur * sr));
  const rng = rngFrom(seed);
  addNoise(data, sr, rng, { dur: t.dur, gain: 1, f0: t.f0, f1: t.f1, decay: t.decay });
  addTone(data, sr, { dur: Math.min(0.45, t.dur), gain: 0.5, f0: Math.max(60, spec.thump.f1 * 1.6), f1: spec.thump.f1 * 0.7, decay: 4, shape: 0.5 });
  for (let i = 0; i < 7; i++) {
    const at = 0.06 + (rng() + 1) * 0.5 * t.dur * 0.55;
    addNoise(data, sr, rng, { at, dur: 0.1 + (rng() + 1) * 0.08, gain: 0.32 + (rng() + 1) * 0.12, f0: t.f0 * 0.8, f1: t.f1, decay: 6 });
  }
  return normalize(data, 0.8);
}

// ---- Reflections per map: what the surfaces are made of, in delay, tone and how many walls answer. ----

const THEME_AUDIO = {
  // Steel freight boxes: bright, quick, and it rings a little.
  railyard: { ir: { len: 0.85, damp: 0.35, gain: 0.34 }, slaps: [[0.075, 1], [0.18, 0.55]], f0: 2400, f1: 620, metal: 1650, wash: 0.05 },
  // Open water and a steel hull far off: a soft late return and a long wet decay.
  harbor:   { ir: { len: 1.3,  damp: 0.18, gain: 0.3 },  slaps: [[0.16, 0.7], [0.38, 0.5]], f0: 1100, f1: 240, metal: 0, wash: 0.16 },
  // Tight alleys of concrete: a stutter of short, bright slaps.
  neon:     { ir: { len: 0.5,  damp: 0.55, gain: 0.38 }, slaps: [[0.028, 1], [0.058, 0.75], [0.095, 0.5], [0.15, 0.3]], f0: 3500, f1: 950, metal: 0, wash: 0.03 },
  // Sun-baked rock and adobe: dry, one clean echo off the far wall.
  dust:     { ir: { len: 0.55, damp: 0.14, gain: 0.22 }, slaps: [[0.2, 0.8], [0.34, 0.3]], f0: 1800, f1: 500, metal: 0, wash: 0.02 },
};
const SIZE_TUNE = [{ dur: 0.14, f: 1.2, gain: 0.8 }, { dur: 0.2, f: 1, gain: 1 }, { dur: 0.3, f: 0.78, gain: 1.15 }];

function renderReflection(theme, size, sr, seed) {
  const th = THEME_AUDIO[theme], tune = SIZE_TUNE[size];
  const last = th.slaps[th.slaps.length - 1][0];
  const data = new Float32Array(Math.floor((last + tune.dur + th.wash * 2 + 0.05) * sr));
  const rng = rngFrom(seed);
  for (const [at, gain] of th.slaps) {
    addNoise(data, sr, rng, { at, dur: tune.dur, gain: gain * tune.gain, f0: th.f0 * tune.f, f1: th.f1 * tune.f, decay: 6 });
    if (th.metal) addMetal(data, sr, { at, dur: 0.12, gain: gain * 0.28, f: th.metal * tune.f, decay: 7 });
  }
  if (th.wash) addNoise(data, sr, rng, { at: 0.02, dur: last + tune.dur + th.wash * 2, gain: th.wash * 3, f0: th.f0 * 0.5, f1: th.f1 * 0.6, decay: 2.6 });
  return normalize(data, 0.7);
}

// ---- Per-weapon reload and swap foley. ----

function renderFoley(id, sr, seed) {
  const r = rngFrom(seed);
  const def = FOLEY[id];
  const mk = (dur, fill, peak = 0.85) => { const d = new Float32Array(Math.floor(dur * sr)); fill(d, r); return normalize(d, peak); };
  const p = def.pitch, m = def.mass;
  const click = (d, rr, at, gain, hp = 2000) => addClick(d, sr, rr, { at, dur: 0.008, gain, hp });
  const slide = (d, rr, at, dur, gain, f = 2600) => addNoise(d, sr, rr, { at, dur, gain, f0: f * p, f1: f * 0.5 * p, hp: 400, decay: 4 });
  const cp = p / 1.15;   // Cylinder sounds were tuned on the revolver (pitch 1.15); this scales them for others.
  const knock = (d, at, gain, f = 260) => addTone(d, sr, { at, dur: 0.06, gain, f0: f * p, f1: f * 0.55 * p, decay: 5, shape: 0.6 });

  const out = mk(def.out || 0.28, (d, rr) => {
    switch (def.kind) {
      case 'belt': click(d, rr, 0, 1.1, 1400); slide(d, rr, 0.02, 0.2, 0.7, 1900); for (let i = 0; i < 5; i++) addMetal(d, sr, { at: 0.05 + i * 0.035, dur: 0.02, gain: 0.3, f: 2600 + i * 90, decay: 9 }); break;
      case 'cylinder': click(d, rr, 0, 0.9, 2800 * cp); addMetal(d, sr, { at: 0.03, dur: 0.15, gain: 0.5, f: 1800 * cp, decay: 6 }); for (let i = 0; i < 4; i++) addClick(d, sr, rr, { at: 0.08 + i * 0.025, dur: 0.004, gain: 0.5, hp: 4500 * cp }); break;
      case 'tube': case 'lever': slide(d, rr, 0, 0.12, 0.5, 3000); break;
      // Break-open: the latch, the hinge dropping, two empty cases kicked out.
      case 'break': click(d, rr, 0, 1, 1500); addMetal(d, sr, { at: 0.02, dur: 0.12, gain: 0.45, f: 780 * p, decay: 6 }); knock(d, 0.05, 0.6, 210); for (let i = 0; i < 2; i++) { addTone(d, sr, { at: 0.16 + i * 0.05, dur: 0.05, gain: 0.35, f0: 2300 - i * 200, f1: 1600, decay: 7 }); addClick(d, sr, rr, { at: 0.16 + i * 0.05, dur: 0.004, gain: 0.5, hp: 3800 }); } break;
      case 'rocket': click(d, rr, 0, 1, 900); knock(d, 0.02, 0.9, 170); slide(d, rr, 0.03, 0.22, 0.6, 1400); break;
      default: click(d, rr, 0, 1, 1400 * p); knock(d, 0.012, 0.5 * m, 900); slide(d, rr, 0.03, 0.13, 0.32, 2200);
    }
  });
  const inn = mk(def.in || 0.3, (d, rr) => {
    switch (def.kind) {
      case 'belt': slide(d, rr, 0, 0.15, 0.6, 1600); knock(d, 0.14, 1, 240); click(d, rr, 0.145, 1, 1100); for (let i = 0; i < 3; i++) addMetal(d, sr, { at: 0.18 + i * 0.03, dur: 0.02, gain: 0.25, f: 2200, decay: 9 }); break;
      case 'tube': case 'lever': addNoise(d, sr, rr, { dur: 0.05, gain: 0.5, f0: 2200 * p, f1: 700 * p, hp: 300, decay: 4 }); knock(d, 0.04, 0.9, 330); click(d, rr, 0.045, 0.8, 1500 * p); break;
      // Two shells pushed into the chambers, one after the other.
      case 'break': for (let i = 0; i < 2; i++) { slide(d, rr, i * 0.14, 0.07, 0.4, 1800); knock(d, 0.06 + i * 0.14, 0.75, 300); click(d, rr, 0.065 + i * 0.14, 0.6, 1300); } break;
      case 'drum': slide(d, rr, 0, 0.12, 0.4, 1700); knock(d, 0.12, 1, 190); click(d, rr, 0.125, 1, 1000); for (let i = 0; i < 4; i++) addClick(d, sr, rr, { at: 0.17 + i * 0.02, dur: 0.005, gain: 0.5, hp: 3500 }); break;
      case 'cylinder': for (let i = 0; i < 6; i++) addClick(d, sr, rr, { at: i * 0.025, dur: 0.005, gain: 0.5, hp: 3800 * cp }); click(d, rr, 0.18, 1, 1600 * cp); knock(d, 0.185, 0.6 * m / 0.5, 700); break;
      case 'rocket': slide(d, rr, 0, 0.18, 0.5, 900); knock(d, 0.17, 1, 130); click(d, rr, 0.175, 1, 800); break;
      default: slide(d, rr, 0, 0.09, 0.3, 2000); click(d, rr, 0.08, 1, 1200 * p); knock(d, 0.085, 0.8 * m, 420); click(d, rr, 0.12, 0.6, 2200);
    }
  });
  const rack = mk(def.rack || 0.3, (d, rr) => {
    switch (def.kind) {
      case 'bolt': click(d, rr, 0, 0.9, 1400); addNoise(d, sr, rr, { at: 0.012, dur: 0.1, gain: 0.45, f0: 2400, f1: 900, hp: 400, decay: 4 }); addMetal(d, sr, { at: 0.13, dur: 0.1, gain: 0.5, f: 900, decay: 6 }); click(d, rr, 0.135, 1.1, 1000); knock(d, 0.14, 0.7, 240); break;
      case 'slide': click(d, rr, 0, 0.8, 2600); addNoise(d, sr, rr, { at: 0.01, dur: 0.05, gain: 0.3, f0: 3000, f1: 1200, hp: 600, decay: 4 }); click(d, rr, 0.07, 1.1, 1700); knock(d, 0.075, 0.6, 620); addMetal(d, sr, { at: 0.075, dur: 0.06, gain: 0.3, f: 1900, decay: 8 }); break;
      case 'tube': knock(d, 0, 0.4, 200); slide(d, rr, 0, 0.03, 0.3, 1500); break;
      // The lever thrown down and back: two clean metal clacks.
      case 'lever': click(d, rr, 0, 1, 1600); addMetal(d, sr, { at: 0.004, dur: 0.06, gain: 0.4, f: 1300, decay: 7 }); click(d, rr, 0.11, 1.1, 1200); knock(d, 0.115, 0.6, 280); break;
      // The gun snapped shut.
      case 'break': click(d, rr, 0, 1.2, 1100); knock(d, 0.004, 1, 190); addMetal(d, sr, { at: 0.006, dur: 0.08, gain: 0.35, f: 900, decay: 7 }); break;
      case 'cylinder': click(d, rr, 0, 1, 1400 * cp); addMetal(d, sr, { at: 0.004, dur: 0.1, gain: 0.5, f: 1400 * cp, decay: 6 }); break;
      case 'rocket': click(d, rr, 0, 1, 1100); knock(d, 0.005, 0.8, 160); slide(d, rr, 0.02, 0.1, 0.3, 700); break;
      case 'belt': click(d, rr, 0, 1, 1200); knock(d, 0.006, 0.9, 200); addMetal(d, sr, { at: 0.02, dur: 0.12, gain: 0.4, f: 1100, decay: 6 }); click(d, rr, 0.09, 0.8, 1700); break;
      default: click(d, rr, 0, 0.9, 1400 * p); addNoise(d, sr, rr, { at: 0.012, dur: 0.1, gain: 0.3, f0: 2600, f1: 900, hp: 500, decay: 4 }); addMetal(d, sr, { at: 0.14, dur: 0.08, gain: 0.45, f: 1200 * p, decay: 7 }); click(d, rr, 0.145, 1.1, 1000 * p); knock(d, 0.15, 0.6 * m, 300);
    }
  });
  const swap = mk(def.swap || 0.24, (d, rr) => {
    addNoise(d, sr, rr, { dur: 0.12, gain: 0.55 * m, f0: 2800, f1: 900, hp: 500, decay: 4 });    // Cloth and sling.
    addClick(d, sr, rr, { at: 0.09, dur: 0.008, gain: 0.9, hp: 1800 * p });
    knock(d, 0.1, 0.45 * m, 310);
    addMetal(d, sr, { at: 0.1, dur: 0.05, gain: 0.25, f: 1350 * p, decay: 8 });
    if (m > 0.7) knock(d, 0.14, 0.55, 150);
  });
  return { out, in: inn, rack, swap };
}

const FOLEY = {
  // kind picks the sequence; pitch and mass make two rifles sound like two different objects.
  ar:       { kind: 'mag',  pitch: 1,    mass: 0.7 },
  smg:      { kind: 'mag',  pitch: 1.25, mass: 0.5 },
  pdw:      { kind: 'mag',  pitch: 1.4,  mass: 0.4 },
  burst:    { kind: 'mag',  pitch: 1.08, mass: 0.65 },
  dmr:      { kind: 'bolt', pitch: 0.95, mass: 0.75, out: 0.3 },
  shotgun:  { kind: 'tube', pitch: 0.9,  mass: 0.8, rack: 0.2 },
  autoshot: { kind: 'drum', pitch: 0.85, mass: 0.95, in: 0.34 },
  lmg:      { kind: 'belt', pitch: 0.75, mass: 1, out: 0.36, in: 0.36 },
  sniper:   { kind: 'bolt', pitch: 0.8,  mass: 0.9 },
  pistol:   { kind: 'slide', pitch: 1.3, mass: 0.35, rack: 0.2 },
  revolver: { kind: 'cylinder', pitch: 1.15, mass: 0.5, out: 0.24, in: 0.28, rack: 0.14 },
  launcher: { kind: 'rocket', pitch: 0.7, mass: 1, out: 0.32, in: 0.3, rack: 0.2 },
  heavyar:  { kind: 'mag',  pitch: 0.88, mass: 0.85 },
  tacsmg:   { kind: 'mag',  pitch: 1.18, mass: 0.5 },
  battle:   { kind: 'mag',  pitch: 0.82, mass: 0.85, out: 0.3 },
  coach:    { kind: 'break', pitch: 0.9, mass: 0.8, out: 0.28, in: 0.32, rack: 0.14 },
  saw:      { kind: 'belt', pitch: 0.88, mass: 0.85, out: 0.32, in: 0.32 },
  rotary:   { kind: 'belt', pitch: 0.62, mass: 1.15, out: 0.4, in: 0.4 },
  lever:    { kind: 'lever', pitch: 1.05, mass: 0.6, rack: 0.2 },
  antimat:  { kind: 'bolt', pitch: 0.62, mass: 1.15, out: 0.34 },
  semisnipe:{ kind: 'bolt', pitch: 1.0,  mass: 0.7 },
  machpistol:{ kind: 'slide', pitch: 1.45, mass: 0.3, rack: 0.2 },
  deuce:    { kind: 'slide', pitch: 1.18, mass: 0.42, rack: 0.2 },
  thumper:  { kind: 'cylinder', pitch: 0.7, mass: 0.9, out: 0.3, in: 0.34, rack: 0.18 },
};

// Medals: note lists as [semitones above A4, start time]. Bigger achievements climb higher and last longer.
// Rarer outranks commoner when medals collide.
const MEDAL_RANK = { streak10: 12, fury: 11, streak5: 10, first_blood: 9, triple: 8, revenge: 7, longshot: 6, streak3: 5, double: 4, capture: 3, defend: 2, confirm: 1, deny: 0 };

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
  capture:     { notes: [[0, 0], [7, 0.1], [12, 0.2]], dur: 0.55, gain: 0.7, shape: 1 },
  defend:      { notes: [[7, 0], [4, 0.09], [7, 0.18]], dur: 0.42, gain: 0.6, shape: 0.8 },
  confirm:     { notes: [[9, 0], [16, 0.07]], dur: 0.3, gain: 0.6 },
  deny:        { notes: [[4, 0], [0, 0.08]], dur: 0.3, gain: 0.5 },
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
    // The kill confirm: a body-blow thump, a hard metal strike, then a bright two-note sting that lifts off it.
    kill: mk(0.5, (d, r) => {
      addTone(d, sr, { dur: 0.09, gain: 1.3, f0: 140, f1: 48, decay: 4.5, shape: 1.4 });
      addClick(d, sr, r, { dur: 0.006, gain: 1.3, hp: 2400 });
      addNoise(d, sr, r, { dur: 0.07, gain: 0.7, f0: 6200, f1: 1200, decay: 5 });
      addMetal(d, sr, { at: 0.004, dur: 0.1, gain: 0.7, f: 1380, decay: 7 });
      addTone(d, sr, { at: 0.03, dur: 0.14, gain: 0.85, f0: 1568, f1: 1500, decay: 5, shape: 0.5 });
      addTone(d, sr, { at: 0.13, dur: 0.34, gain: 1, f0: 2349, f1: 2260, decay: 5, shape: 0.5 });
      for (let i = 0; i < d.length; i++) d[i] = softClip(d[i] * 0.85);
    }, 0.95),
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
    // A bright ping over a dull knock: instantly distinct from the ordinary tick, and it has to feel earned.
    headshot: mk(0.3, (d, r) => {
      addClick(d, sr, r, { dur: 0.004, gain: 1.2, hp: 4200 });
      addTone(d, sr, { dur: 0.05, gain: 0.8, f0: 720, f1: 240, decay: 6, shape: 0.8 });
      addTone(d, sr, { at: 0.006, dur: 0.26, gain: 0.95, f0: 3320, f1: 3180, decay: 6.5, attack: 0.0005 });
      addTone(d, sr, { at: 0.006, dur: 0.16, gain: 0.5, f0: 5130, f1: 4950, decay: 7, attack: 0.0005 });
    }),
    heatTick: mk(0.05, (d, r) => { addTone(d, sr, { dur: 0.04, gain: 1, f0: 1500, decay: 6, shape: 1 }); addClick(d, sr, r, { dur: 0.002, gain: 0.5, hp: 4000 }); }, 0.7),
    vent: mk(1.7, (d, r) => {
      addClick(d, sr, r, { dur: 0.012, gain: 1.1, hp: 700 });              // The breech unlatching.
      addTone(d, sr, { dur: 0.09, gain: 0.8, f0: 210, f1: 90, decay: 5, shape: 1 });
      addNoise(d, sr, r, { at: 0.03, dur: 1.65, gain: 1.4, f0: 9000, f1: 3000, hp: 1700, decay: 2.6 });
    }),
    pin: mk(0.46, (d, r) => {
      addClick(d, sr, r, { dur: 0.006, gain: 1, hp: 2600 });
      addTone(d, sr, { at: 0.003, dur: 0.1, gain: 0.5, f0: 2650, f1: 2500, decay: 7 });
      addNoise(d, sr, r, { at: 0.15, dur: 0.28, gain: 1, f0: 700, f1: 2600, hp: 300, decay: 3.2 });   // The arm coming over.
    }, 0.8),
    frag: mk(1.5, (d, r) => {
      addClick(d, sr, r, { dur: 0.01, gain: 1.4, hp: 1100 });
      addNoise(d, sr, r, { dur: 0.42, gain: 1.9, f0: 4200, f1: 180, decay: 4.5 });
      addTone(d, sr, { dur: 0.42, gain: 1.8, f0: 100, f1: 30, decay: 3.6, shape: 1.6 });
      addNoise(d, sr, r, { at: 0.05, dur: 1.3, gain: 0.45, f0: 900, f1: 90, decay: 3.4 });
      for (let i = 0; i < d.length; i++) d[i] = softClip(d[i] * 0.78);
    }, 0.95),
    flashBang: mk(1.0, (d, r) => {
      addClick(d, sr, r, { dur: 0.008, gain: 1.6, hp: 2000 });
      addNoise(d, sr, r, { dur: 0.14, gain: 1.5, f0: 9000, f1: 1500, decay: 6 });
      addTone(d, sr, { dur: 0.1, gain: 0.8, f0: 170, f1: 70, decay: 5 });
      addTone(d, sr, { at: 0.02, dur: 0.95, gain: 0.3, f0: 4300, f1: 3900, decay: 4 });
    }, 0.92),
    flashRing: mk(3.2, (d) => {
      addTone(d, sr, { dur: 3.15, gain: 1, f0: 3480, f1: 3380, decay: 2.8, attack: 0.03 });
      addTone(d, sr, { dur: 3.15, gain: 0.5, f0: 3530, f1: 3430, decay: 2.8, attack: 0.03 });   // The beat is the ear ringing.
    }, 0.55),
    smoke: mk(3, (d, r) => {
      addClick(d, sr, r, { dur: 0.008, gain: 0.8, hp: 1000 });
      addNoise(d, sr, r, { at: 0.02, dur: 2.95, gain: 1, f0: 5200, f1: 1800, hp: 900, decay: 1.7 });
    }, 0.75),
    stim: mk(0.62, (d, r) => {
      addClick(d, sr, r, { dur: 0.005, gain: 1, hp: 1800 });
      addNoise(d, sr, r, { dur: 0.2, gain: 0.7, f0: 7000, f1: 3000, hp: 1400, decay: 3.5 });
      addTone(d, sr, { at: 0.1, dur: 0.48, gain: 0.8, f0: 520, f1: 1240, decay: 3, attack: 0.02, shape: 0.4 });
      addTone(d, sr, { at: 0.2, dur: 0.38, gain: 0.5, f0: 780, f1: 1860, decay: 3.4, attack: 0.02 });
    }, 0.75),
    // Wave 5 equipment and streaks.
    molotov: mk(0.9, (d, r) => {
      addClick(d, sr, r, { dur: 0.01, gain: 0.7, hp: 1600 });
      addNoise(d, sr, r, { dur: 0.25, gain: 1, f0: 1700, f1: 260, decay: 3 });
      addNoise(d, sr, r, { at: 0.05, dur: 0.82, gain: 0.5, f0: 4600, f1: 1200, hp: 700, decay: 2.5 });
    }, 0.82),
    pulse: mk(0.5, (d) => {
      addTone(d, sr, { dur: 0.16, gain: 1, f0: 1200, f1: 1650, decay: 5, attack: 0.004 });
      addTone(d, sr, { at: 0.16, dur: 0.3, gain: 0.7, f0: 1650, f1: 900, decay: 5, attack: 0.004 });
    }, 0.6),
    zap: mk(0.18, (d, r) => {
      addClick(d, sr, r, { dur: 0.004, gain: 1, hp: 4800 });
      addNoise(d, sr, r, { at: 0.002, dur: 0.14, gain: 0.8, f0: 8000, f1: 2600, hp: 2000, decay: 6 });
    }, 0.8),
    denied: mk(0.22, (d) => {
      addTone(d, sr, { dur: 0.09, gain: 1, f0: 240, decay: 3, attack: 0.002, shape: 1.6 });
      addTone(d, sr, { at: 0.11, dur: 0.09, gain: 1, f0: 200, decay: 3, attack: 0.002, shape: 1.6 });
    }, 0.6),
    whistle: mk(1.2, (d) => { addTone(d, sr, { dur: 1.15, gain: 0.8, f0: 1400, f1: 500, decay: 0.6, attack: 0.05, shape: 0.3 }); }, 0.55),
    jam: mk(1, (d, r) => {
      addNoise(d, sr, r, { dur: 0.98, gain: 1, f0: 5200, f1: 2200, hp: 900, decay: 1.2 });
      for (let i = 0; i < 8; i++) addClick(d, sr, r, { at: 0.06 + i * 0.11, dur: 0.01, gain: 0.9, hp: 1400 });
    }, 0.62),
    empBlast: mk(1.3, (d, r) => {
      addTone(d, sr, { dur: 0.5, gain: 1.2, f0: 220, f1: 34, decay: 2.8, shape: 1.5 });
      addNoise(d, sr, r, { dur: 1.25, gain: 0.9, f0: 7000, f1: 900, hp: 1100, decay: 2.4 });
      for (let i = 0; i < 10; i++) addClick(d, sr, r, { at: 0.12 + i * 0.09, dur: 0.004, gain: 0.6, hp: 3800 });
    }, 0.85),
    supply: mk(0.7, (d) => {
      for (const [at, f] of [[0, 523], [0.12, 659], [0.24, 784]]) addTone(d, sr, { at, dur: 0.42, gain: 0.7, f0: f, decay: 5, attack: 0.004, shape: 0.4 });
    }, 0.6),
    turretDeploy: mk(0.55, (d, r) => {
      addClick(d, sr, r, { dur: 0.012, gain: 1.1, hp: 500 });
      addTone(d, sr, { dur: 0.16, gain: 0.8, f0: 190, f1: 80, decay: 5, shape: 1 });
      addTone(d, sr, { at: 0.16, dur: 0.3, gain: 0.5, f0: 320, f1: 720, decay: 3, attack: 0.02, shape: 1.2 });   // Servo spin-up.
      addClick(d, sr, r, { at: 0.46, dur: 0.008, gain: 1, hp: 1600 });
    }, 0.85),
    // Whole cycles of every partial in exactly 2 s, so this loops without a seam.
    rumble: mk(2, (d) => {
      addTone(d, sr, { dur: 2, gain: 1, f0: 38, decay: 0, shape: 1.4 });
      addTone(d, sr, { dur: 2, gain: 0.6, f0: 57, decay: 0, shape: 0.8 });
      addTone(d, sr, { dur: 2, gain: 0.3, f0: 114, decay: 0 });
      for (let i = 0; i < d.length; i++) d[i] *= 0.72 + 0.28 * Math.sin(2 * Math.PI * 13 * i / d.length * 2);
    }, 0.8),
    spawn: mk(0.3, (d, r) => { addNoise(d, sr, r, { dur: 0.28, gain: 1, f0: 800, f1: 3800, hp: 500, decay: 3 }); }, 0.45),
    // A dog tag on a chain: one bright, short metal clink.
    tag: mk(0.2, (d, r) => {
      addClick(d, sr, r, { dur: 0.003, gain: 1, hp: 3800 });
      addTone(d, sr, { dur: 0.16, gain: 0.9, f0: 3300, f1: 3050, decay: 7, attack: 0.0005 });
      addTone(d, sr, { at: 0.04, dur: 0.12, gain: 0.5, f0: 4700, f1: 4400, decay: 7, attack: 0.0005 });
    }, 0.8),
    flagTaken: mk(0.75, (d) => {
      addTone(d, sr, { dur: 0.3, gain: 0.8, f0: 330, decay: 3, attack: 0.008, shape: 1.6 });
      addTone(d, sr, { at: 0.16, dur: 0.55, gain: 0.8, f0: 494, decay: 3.2, attack: 0.008, shape: 1.6 });
    }, 0.72),
    flagLost: mk(0.75, (d) => {
      addTone(d, sr, { dur: 0.3, gain: 0.8, f0: 330, decay: 3, attack: 0.008, shape: 1.6 });
      addTone(d, sr, { at: 0.16, dur: 0.55, gain: 0.8, f0: 247, decay: 3.2, attack: 0.008, shape: 1.6 });
    }, 0.72),
    zoneMove: mk(0.6, (d) => {
      for (let n = 0; n < 2; n++) addTone(d, sr, { at: n * 0.16, dur: 0.14, gain: 0.8, f0: 660, f1: 880, decay: 4, attack: 0.006, shape: 0.8 });
      addTone(d, sr, { at: 0.34, dur: 0.24, gain: 0.8, f0: 990, decay: 4, attack: 0.006, shape: 0.8 });
    }, 0.72),
    // A round passing close: the snap of the shockwave, then air tearing behind it.
    whiz: mk(0.22, (d, r) => {
      addClick(d, sr, r, { dur: 0.004, gain: 1, hp: 3400 });
      addNoise(d, sr, r, { at: 0.002, dur: 0.2, gain: 0.8, f0: 9000, f1: 2600, hp: 1500, decay: 5 });
      addTone(d, sr, { at: 0.02, dur: 0.14, gain: 0.25, f0: 2400, f1: 900, decay: 4 });
    }, 0.75),
    impactMetal: mk(0.24, (d, r) => {
      addClick(d, sr, r, { dur: 0.004, gain: 1, hp: 4000 });
      addMetal(d, sr, { at: 0.002, dur: 0.2, gain: 0.8, f: 2300, decay: 7 });
    }, 0.7),
    impactConcrete: mk(0.16, (d, r) => {
      addClick(d, sr, r, { dur: 0.005, gain: 1.1, hp: 2600 });
      addNoise(d, sr, r, { at: 0.003, dur: 0.14, gain: 0.8, f0: 3600, f1: 700, hp: 200, decay: 6 });
      for (let i = 0; i < 4; i++) addClick(d, sr, r, { at: 0.03 + i * 0.022, dur: 0.003, gain: 0.3, hp: 4200 });    // Grit.
    }, 0.7),
    impactDirt: mk(0.14, (d, r) => {
      addNoise(d, sr, r, { dur: 0.12, gain: 1, f0: 1400, f1: 300, decay: 7 });
      addTone(d, sr, { dur: 0.05, gain: 0.5, f0: 190, f1: 70, decay: 6 });
    }, 0.65),
    steps,
  };
}

// ---- Weather and stingers. Seamless loops, and music in small buffers so nothing streams. ----

// A loop that is seamless because its head is faded into the end of its own tail.
function loopFromFill(sr, seconds, fill, peak) {
  const fadeLen = Math.floor(0.6 * sr);
  const n = Math.floor(seconds * sr);
  const raw = new Float32Array(n + fadeLen);
  fill(raw);
  for (let i = 0; i < fadeLen; i++) {
    const k = i / fadeLen;
    raw[i] = raw[i] * k + raw[n + i] * (1 - k);
  }
  return normalize(raw.subarray(0, n), peak);
}

// The sound of a firefight somewhere else: sparse low cracks and thuds with no detail to pick out, made to loop forever.
function renderDistantFire(sr, seed) {
  const r = rngFrom(seed);
  return loopFromFill(sr, 6, (d) => {
    const n = d.length, sec = n / sr;
    for (let i = 0; i < 90; i++) {
      const at = (r() + 1) * 0.5 * sec * 0.95;
      const low = r() > 0.2;
      addNoise(d, sr, r, { at, dur: low ? 0.16 : 0.08, gain: (low ? 0.8 : 0.45) + (r() + 1) * 0.3, f0: low ? 750 : 2100, f1: low ? 130 : 500, decay: 6 });
    }
    addNoise(d, sr, r, { dur: sec, gain: 0.08, f0: 320, f1: 120, decay: 0 });
  }, 0.7);
}

function renderRain(sr, seed) {
  const r = rngFrom(seed);
  return loopFromFill(sr, 7, (d) => {
    let low = 0, hi = 0, prev = 0;
    for (let i = 0; i < d.length; i++) {
      low += 0.72 * (r() - low);              // The hiss of it on everything.
      hi = 0.92 * (hi + low - prev); prev = low;
      d[i] += hi * 0.5;
    }
    // Individual heavy drops landing on the nearest surface.
    for (let n = 0; n < 90; n++) {
      const at = (r() + 1) * 0.5 * (d.length - 2200);
      const f = 1800 + (r() + 1) * 1400, g = 0.4 + (r() + 1) * 0.3;
      addClick(d, sr, r, { at: at / sr, dur: 0.004, gain: g * 0.5, hp: 3000 });
      addTone(d, sr, { at: at / sr, dur: 0.018, gain: g * 0.3, f0: f, f1: f * 0.6, decay: 6 });
    }
  }, 0.75);
}

function renderWind(sr, seed) {
  const r = rngFrom(seed), TAU2 = Math.PI * 2;
  return loopFromFill(sr, 9, (d) => {
    let low = 0, band = 0, cut = 0.02;
    const n = d.length;
    for (let i = 0; i < n; i++) {
      // Gusts: slow overlapping swells, chosen as whole cycles of the loop so they cannot jump at the seam.
      const u = i / n;
      const gust = 0.5 + 0.28 * Math.sin(TAU2 * 2 * u) + 0.2 * Math.sin(TAU2 * 5 * u + 1.3) + 0.12 * Math.sin(TAU2 * 9 * u + 4);
      if ((i & 63) === 0) cut = 0.012 + 0.05 * gust * gust;
      low += cut * (r() - low);
      band += 0.3 * (low - band);
      d[i] += band * gust * 4;
    }
  }, 0.75);
}

function renderThunder(sr, seed) {
  const d = new Float32Array(Math.floor(5.5 * sr));
  const r = rngFrom(seed);
  // Lightning first: a crackle high up that gives way to the long roll.
  for (let i = 0; i < 5; i++) addClick(d, sr, r, { at: i * 0.03, dur: 0.01, gain: 0.5, hp: 1500 });
  addNoise(d, sr, r, { at: 0.03, dur: 1.6, gain: 2, f0: 900, f1: 120, decay: 2.8 });
  addNoise(d, sr, r, { at: 0.5, dur: 4.6, gain: 1.8, f0: 260, f1: 55, decay: 2.2 });
  addTone(d, sr, { at: 0.1, dur: 2.4, gain: 1, f0: 60, f1: 30, decay: 2 });
  addTone(d, sr, { at: 1.2, dur: 3.2, gain: 0.7, f0: 44, f1: 26, decay: 2 });
  for (let i = 0; i < d.length; i++) d[i] = softClip(d[i] * 0.7);
  return normalize(d, 0.92);
}

const semi = n => 110 * Math.pow(2, n / 12);

// One note of a brassy synth stack: the fundamental and a couple of upper partials.
function addStab(d, sr, r, { at = 0, dur, gain, f, decay = 2.2, attack = 0.012 }) {
  // Plain sines: a stinger is many notes long, and tanh per sample per note is where the synthesis time would go.
  addTone(d, sr, { at, dur, gain, f0: f, decay, attack });
  addTone(d, sr, { at, dur: dur * 0.85, gain: gain * 0.5, f0: f * 2.002, decay: decay * 1.2, attack: attack * 0.6 });
  addTone(d, sr, { at, dur: dur * 0.6, gain: gain * 0.28, f0: f * 3.01, decay: decay * 1.5, attack: attack * 0.5 });
}

function renderStingers(sr) {
  const mk = (dur, peak, fill) => () => {
    const d = new Float32Array(Math.floor(dur * sr));
    fill(d, rngFrom(5310 + Math.floor(dur * 701)));
    for (let i = 0; i < d.length; i++) d[i] = softClip(d[i] * 0.9);
    return normalize(d, peak);
  };
  return {
    // A rising filter sweep into a single hard power chord, then a drop.
    matchStart: mk(1.8, 0.85, (d, r) => {
      addNoise(d, sr, r, { dur: 0.5, gain: 0.5, f0: 400, f1: 4000, hp: 300, decay: 0.5 });
      addTone(d, sr, { dur: 0.5, gain: 0.4, f0: 62, f1: 110, decay: 1, attack: 0.05 });
      const hit = 0.52;
      addTone(d, sr, { at: hit, dur: 0.5, gain: 1.4, f0: 80, f1: 36, decay: 3.5, shape: 1.6 });
      addClick(d, sr, r, { at: hit, dur: 0.008, gain: 1.2, hp: 1000 });
      for (const n of [0, 7, 12, 19]) addStab(d, sr, r, { at: hit, dur: 1.2, gain: 0.5, f: semi(n), decay: 3 });
    }),
    // Clock-tight and uneasy: a low pedal under a tense interval, pulsing faster, ending on a question.
    tension: mk(2.1, 0.8, (d, r) => {
      addTone(d, sr, { dur: 2.05, gain: 0.5, f0: semi(-12), decay: 1.2, attack: 0.08, shape: 1.5 });
      for (const n of [0, 1, 6]) addStab(d, sr, r, { dur: 2, gain: 0.3, f: semi(n), decay: 1, attack: 0.12 });
      let t = 0, step = 0.4, i = 0;
      while (t < 1.9) { addClick(d, sr, r, { at: t, dur: 0.006, gain: 0.7 + 0.2 * (i % 2), hp: 3200 }); t += step; step = Math.max(0.1, step * 0.8); i++; }
    }),
    // Under the last kills: one soft low pulse to the bar, sixteen beats that fall silent at the end so it can loop.
    tensionLoop: mk(4, 0.7, (d, r) => {
      const beat = 0.25;
      for (let i = 0; i < 16; i++) {
        const down = i % 4 === 0;
        addTone(d, sr, { at: i * beat, dur: 0.2, gain: down ? 1 : 0.55, f0: semi(down ? -12 : -5), f1: semi(down ? -12 : -5) * 0.85, decay: 4, shape: 1.2 });
        if (i % 2 === 1) addClick(d, sr, r, { at: i * beat, dur: 0.004, gain: 0.4, hp: 3800 });
      }
    }),
    victory: mk(3.2, 0.85, (d, r) => {
      // A major arpeggio climbing into a held, bright chord.
      const notes = [0, 4, 7, 12, 16, 19];
      notes.forEach((n, i) => addStab(d, sr, r, { at: i * 0.11, dur: 1.8 - i * 0.05, gain: 0.45, f: semi(n), decay: 2, attack: 0.006 }));
      addTone(d, sr, { at: 0.6, dur: 2, gain: 0.7, f0: semi(-12), decay: 1.8 });
      for (let i = 0; i < 3; i++) addStab(d, sr, r, { at: 0.8 + i * 0.09, dur: 0.9, gain: 0.16, f: semi(24 + notes[i % 3]), decay: 3, attack: 0.003 });
      addNoise(d, sr, r, { at: 0.55, dur: 1.2, gain: 0.25, f0: 8000, f1: 2500, hp: 1800, decay: 2.5 });
    }),
    defeat: mk(3.2, 0.8, (d, r) => {
      // Falling minor line, a low toll, and everything sinking at the end.
      const notes = [12, 10, 7, 3, 0];
      notes.forEach((n, i) => addStab(d, sr, r, { at: i * 0.3, dur: 1.6, gain: 0.45, f: semi(n), decay: 1.5, attack: 0.02 }));
      for (const n of [-12, -9, -5]) addStab(d, sr, r, { at: 1.5, dur: 1.4, gain: 0.32, f: semi(n), decay: 1.3, attack: 0.05 });
      addTone(d, sr, { dur: 3.1, gain: 0.6, f0: semi(-12) * 1.02, f1: semi(-17), decay: 1.1, attack: 0.1 });
      addTone(d, sr, { at: 1.5, dur: 0.7, gain: 0.9, f0: 70, f1: 40, decay: 3, shape: 1.2 });
    }),
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

// A room per map: length and darkness of the decay come from its surfaces.
function roomImpulse(ctx, theme) {
  const { len: seconds, damp } = THEME_AUDIO[theme].ir;
  const len = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch), rng = rngFrom(4242 + ch * 77);
    let low = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      low += damp * (rng() - low);
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
    this.lastShot = new Map();     // Shooter id -> time of last rendered shot.
    this.windowT = 0; this.windowN = 0;
    this.stepState = new Map();
    this.heartT = 0;
    this.heatTickT = 0; this.prevHeat = 0; this.lastVentAt = -9;
    this.rumbleGain = null;
    this.lx = 0; this.lz = 0; this.localId = null; this.localAlive = false; this.localTeam = -1;
    this.offline = false;
    this.theme = null;
    this.tailAt = new Map();       // Per shooter: when their last far tail or reflection played.
    this.reflectAt = 0;
    this.whizAt = 0; this.impactAt = 0;
    this.foleyPending = new Map();   // Per player: scheduled reload sounds, cancelled if the reload stops short.
    this.reloadAmmo = new Map();     // Per player: ammo when the reload began, to tell a finished reload from a cancelled one.
    this.killChain = 0; this.lastKillAt = -9;
    this.thunderT = 8; this.nextAmbRefresh = 0;
    this.tension = false; this.stingerDone = false;
    this.windSrc = null; this.rainSrc = null; this.tensionSrc = null;
    this.classCount = Object.create(null);
    this.classPeak = Object.create(null);      // Highest ever per class, for tests.
    this.peakVoices = 0;
    this.tailGlobalAt = -9; this.hitAt = -9; this.lastKillSfxAt = -9;
    this.farLevel = 0; this.farPanValue = 0;
    this.fight = 0; this.duckUntil = 0;
    this.medalPending = null; this.medalBusyUntil = 0;

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

  // Test hook: drives the whole graph with an OfflineAudioContext so it can be rendered and measured.
  useContext(ctx) {
    this.ctx = ctx;
    this.offline = true;
    this._build();
    return this.whenReady;
  }

  _running() { return this.ready && (this.offline || this.ctx.state === 'running'); }

  _build() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate || SYNTH_RATE_FALLBACK;
    this.whenReady = new Promise(done => { this._readyDone = done; });

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5; this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.08;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 10;
    this.comp.ratio.value = 4; this.comp.attack.value = 0.003; this.comp.release.value = 0.14;

    this.dry = ctx.createGain(); this.dry.gain.value = 0.75;
    this.farFilter = ctx.createBiquadFilter();
    this.farFilter.type = 'lowpass'; this.farFilter.frequency.value = 1500; this.farFilter.Q.value = 0.4;
    this.far = ctx.createGain(); this.far.gain.value = 0.9;
    this.ui = ctx.createGain(); this.ui.gain.value = 0.78;      // Hitmarkers, medals: never distance-filtered.
    this.roomSend = ctx.createGain(); this.roomSend.gain.value = 1;
    this.room = ctx.createConvolver();
    this.rooms = {};
    this.applyRoom('railyard');
    this.roomOut = ctx.createGain(); this.roomOut.gain.value = THEME_AUDIO.railyard.ir.gain;

    // Everything from the world goes through one duck; your own gun comes in behind it.
    this.worldDuck = ctx.createGain(); this.worldDuck.gain.value = 1;
    this.own = ctx.createGain(); this.own.gain.value = 1;
    this.dry.connect(this.worldDuck);
    this.far.connect(this.farFilter); this.farFilter.connect(this.worldDuck);
    this.roomSend.connect(this.room); this.room.connect(this.roomOut); this.roomOut.connect(this.worldDuck);
    this.worldDuck.connect(this.comp);
    this.own.connect(this.comp);
    // The compressor's built-in makeup gain pushes a dense mix right back up; this takes it back down to where a
    // firefight does not sit at full scale for its whole length.
    this.postComp = ctx.createGain(); this.postComp.gain.value = 0.7;
    this.comp.connect(this.postComp);
    this.postComp.connect(this.master);
    this.ui.connect(this.master);
    // Music sits with the feedback: it is not world sound and must not be ducked by a firefight.
    this.music = ctx.createGain(); this.music.gain.value = 0.7;
    this.music.connect(this.master);
    // Weather goes through the compressor, so a firefight naturally pushes it down.
    this.amb = ctx.createGain(); this.amb.gain.value = 0;
    this.amb.connect(this.comp);
    this.thunderBus = ctx.createGain(); this.thunderBus.gain.value = 0.55;
    this.thunderBus.connect(this.comp);
    // The boost for mic mode happens at master, so the limiter and clipper still have the last word.
    this.master.connect(this.limiter);
    this.output = ctx.createWaveShaper();
    this.output.curve = softClipCurve();
    this.limiter.connect(this.output);
    this.output.connect(ctx.destination);

    // Synthesis happens in small jobs after the gesture, so unlocking never hitches a frame.
    this.guns = {}; this.medals = {}; this.sfx = {}; this.reflect = {}; this.foley = {}; this.stingers = {};
    this.thunder = [];
    this.loops = {};
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
      const spec = GUNS[id], g = this.guns[id] = { near: [], sup: [], tail: null, size: spec.size };
      for (let v = 0; v < 3; v++) {
        const s = (seed += 73);
        jobs.push(() => { g.near.push(this._toBuffer(renderNear(spec, sr, s))); });
      }
      if (!spec.noSup) {
        for (let v = 0; v < 2; v++) {
          const s = (seed += 73);
          jobs.push(() => { g.sup.push(this._toBuffer(renderSuppressed(spec, sr, s))); });
        }
      }
      const s = (seed += 73);
      jobs.push(() => { g.tail = this._toBuffer(renderTail(spec, sr, s)); });
    }
    for (const theme of Object.keys(THEME_AUDIO)) {
      this.reflect[theme] = [];
      for (let size = 0; size < 3; size++) {
        const s = (seed += 19);
        jobs.push(() => { this.reflect[theme][size] = this._toBuffer(renderReflection(theme, size, sr, s)); });
      }
    }
    for (const id of Object.keys(FOLEY)) {
      const s = (seed += 19);
      jobs.push(() => {
        const r = renderFoley(id, sr, s);
        this.foley[id] = { out: this._toBuffer(r.out), in: this._toBuffer(r.in), rack: this._toBuffer(r.rack), swap: this._toBuffer(r.swap) };
      });
    }
    const stingers = renderStingers(sr);
    for (const k of Object.keys(stingers)) jobs.push(() => { this.stingers[k] = this._toBuffer(stingers[k]()); });
    jobs.push(() => { this.loops.rain = this._toBuffer(renderRain(sr, 77)); });
    jobs.push(() => { this.loops.wind = this._toBuffer(renderWind(sr, 91)); });
    jobs.push(() => { this.loops.farFire = this._toBuffer(renderDistantFire(sr, 133)); });
    for (let v = 0; v < 3; v++) jobs.push(() => { this.thunder[v] = this._toBuffer(renderThunder(sr, 4100 + v * 13)); });
    let i = 0;
    this.buildMs = 0; this.buildMaxJobMs = 0;
    const runNext = () => {
      if (!this.ctx) return;
      const t = performance.now();
      jobs[i++]();
      const ms = performance.now() - t;
      this.buildMs += ms; this.buildMaxJobMs = Math.max(this.buildMaxJobMs, ms);
      if (i < jobs.length) setTimeout(runNext, 0);
      else { this._startFarLayer(); this._warmThrowBuffers(); this.ready = true; this.setMicActive(this.micActive); this._readyDone(); }
    };
    setTimeout(runNext, 0);
  }

  // iOS does real work the first time a given AudioBuffer is handed to a source node. Do that here, silently, for
  // everything a throw can trigger, so the first grenade of a match costs the same as the tenth.
  _warmThrowBuffers() {
    const ctx = this.ctx, mute = ctx.createGain();
    mute.gain.value = 0;
    mute.connect(ctx.destination);
    const list = [this.sfx.pin, this.sfx.frag, this.sfx.explosion, this.sfx.flashBang, this.sfx.flashRing, this.sfx.smoke, this.sfx.stim, this.sfx.molotov, this.sfx.pulse, this.sfx.zap];
    const t = ctx.currentTime;
    for (let i = 0; i < list.length; i++) {
      const src = ctx.createBufferSource();
      src.buffer = list[i];
      src.connect(mute);
      src.start(t);
      src.stop(t + 0.001);
    }
  }

  // The far-firefight layer: one looped voice that runs silently from the start.
  _startFarLayer() {
    const ctx = this.ctx;
    this.farGain = ctx.createGain();
    this.farGain.gain.value = 0;
    this.farPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const src = ctx.createBufferSource();
    src.buffer = this.loops.farFire;
    src.loop = true;
    src.connect(this.farGain);
    if (this.farPan) { this.farGain.connect(this.farPan); this.farPan.connect(this.far); }
    else this.farGain.connect(this.far);
    src.start();
    this.farSrc = src;
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
    this.comp.threshold.setTargetAtTime(this.micActive ? -22 : -14, now, 0.08);
    this.comp.ratio.setTargetAtTime(this.micActive ? 7 : 4, now, 0.08);
    // Mic mode: the master boost is meant for gunfire and callouts, so music and weather give some of it back.
    this.music.gain.setTargetAtTime((this.micActive ? 0.34 : 0.7) * (this.musicVolume ?? 1), now, 0.08);
    this.thunderBus.gain.setTargetAtTime(this.micActive ? 0.25 : 0.55, now, 0.08);
  }

  setVolume(v) {
    this.volume = v;
    this.setMicActive(this.micActive);
  }

  // A visible bolt: the next thunderclap follows it after the delay of sound crossing the yard.
  lightning() {
    this.thunderT = 0.2 + Math.random() * 0.7;
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.music) this.setMicActive(this.micActive);
  }

  // Removes finished voices and recounts the classes. Called before any decision that needs the live count.
  _reap(now) {
    let w = 0;
    const counts = this.classCount;
    for (const k in counts) counts[k] = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.end <= now) continue;
      this.voices[w++] = v;
      counts[v.cls] = (counts[v.cls] || 0) + 1;
    }
    this.voices.length = w;
  }

  // Stealing: the weakest (lowest priority, then oldest) gives way to something strictly more important.
  // `cls` limits the choice to one class, for when that class is at its cap.
  _stealFor(priority, cls, now) {
    let victim = -1, vp = priority, vt = Infinity;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (cls && v.cls !== cls) continue;
      // Within a class at its cap, equal priority yields to the newer sound (the oldest of a class is the least useful).
      if (v.priority < vp || (v.priority === vp && (cls !== null) && v.start < vt)) { victim = i; vp = v.priority; vt = v.start; }
    }
    if (victim < 0) return false;
    const v = this.voices[victim];
    // A very short fade, because cutting a waveform dead makes a click.
    v.gain.gain.setTargetAtTime(0, now, 0.008);
    try { v.src.stop(now + 0.04); } catch { /* already stopped */ }
    v.end = now + 0.04;
    this.voices.splice(victim, 1);
    this.classCount[v.cls]--;
    return true;
  }

  // The single place sound starts. Returns the voice, or null when the budget refuses it.
  _play(buffer, { gain = 1, pan = 0, far = 0, rate = 1, bus = null, priority = 1, cls = 'world', when = 0, room = 0 } = {}) {
    if (!buffer || !this._running()) return null;
    const ctx = this.ctx, now = ctx.currentTime;
    this._reap(now);
    const cap = CLASS_CAP[cls] ?? 3;
    if ((this.classCount[cls] || 0) >= cap && !this._stealFor(priority, cls, now)) return null;
    if (this.voices.length >= MAX_VOICES && !this._stealFor(priority, null, now)) return null;

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
    }
    if (room > 0) {
      const send = ctx.createGain();
      send.gain.value = room;
      g.connect(send);
      send.connect(this.roomSend);
    }
    src.start(when || 0);
    const start = when || now;
    const voice = { src, gain: g, priority, cls, start, end: start + buffer.duration / rate + 0.05 };
    this.voices.push(voice);
    this.classCount[cls] = (this.classCount[cls] || 0) + 1;
    if (this.classCount[cls] > (this.classPeak[cls] || 0)) this.classPeak[cls] = this.classCount[cls];
    if (this.voices.length > this.peakVoices) this.peakVoices = this.voices.length;
    return voice;
  }

  // Stops a voice that has not started yet, or fades one that has.
  _cancel(voice, now) {
    voice.gain.gain.setTargetAtTime(0, now, 0.008);
    try { voice.src.stop(now + 0.04); } catch { /* already stopped */ }
    voice.end = now + 0.04;
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
    if (view.theme !== this.theme) this.setTheme(view.theme);
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
    const g = this.guns[e.weapon];
    if (!g) return;
    const sup = !!e.sup && g.sup.length > 0;
    const near = sup ? g.sup : g.near;
    const pick = near[Math.floor(Math.random() * near.length)];
    if (self) {
      this.fight = Math.min(1, this.fight + 0.1);
      this.duckUntil = now + 0.16;
      this._play(pick, { gain: sup ? 0.7 : 0.95, rate: 0.97 + Math.random() * 0.06, priority: PR.own, cls: 'own', bus: this.own, room: sup ? 0.04 : 0.12 });
      this._gunLayers(e, g, sup, true, now);
      return;
    }
    const d = this._spatial(e.ox, e.oz);
    this._whiz(e, now);
    this._impact(e, now);
    if (d > FAR_CULL) { if (!sup) this._raiseFarLayer(d); return; }
    if (sup && d > 22) return;

    this.fight = Math.min(1, this.fight + (d < 16 ? 0.08 : 0.04));
    const threat = d <= THREAT_RANGE && !this._isAlly(e.by);
    // Near a threat you hear every shot; further out, a burst is one bang now and then with its tail filling in.
    const gap = d <= THREAT_RANGE ? SHOOTER_GAP_NEAR : d <= 22 ? SHOOTER_GAP_MID : SHOOTER_GAP_FAR;
    if (now - (this.lastShot.get(e.by) || -9) >= gap) {
      // At most a few new gunshots per window: stacked identical transients are what makes a mix crackle.
      if (now - this.windowT > GUN_WINDOW) { this.windowT = now; this.windowN = 0; }
      if (this.windowN < GUN_WINDOW_CAP || threat) {
        this.windowN++;
        this.lastShot.set(e.by, now);
        this._play(pick, {
          gain: (sup ? 0.65 : threat ? 0.85 : 0.55) * this.sGain, pan: this.sPan, far: this.sFar,
          rate: 0.95 + Math.random() * 0.1, cls: threat ? 'threat' : 'gun',
          priority: threat ? PR.threat : (d < 22 ? PR.gunNear : PR.gun), room: sup ? 0.04 : 0.06 + 0.14 * this.sFar,
        });
        this._gunLayers(e, g, sup, false, now);
      }
    }
  }

  // A gun out past the discrete range just pushes the one far layer up a little.
  _raiseFarLayer(d) {
    const k = 1 - Math.min(1, (d - FAR_CULL) / (HEAR_RANGE + 30 - FAR_CULL));
    this.farLevel = Math.min(1, this.farLevel + 0.06 * k);
    this.farPanValue += (this.sPan - this.farPanValue) * 0.12;
    this.fight = Math.min(1, this.fight + 0.01);
  }

  // Tail and map reflection for a shot. Everything here is optional, so it runs at the bottom of the priority list.
  _gunLayers(e, g, sup, self, now) {
    const d = self ? 0 : this.sD, shooter = e.by;
    if (!sup && g.tail && now - (this.tailAt.get(shooter) ?? -9) >= TAIL_GAP && now - this.tailGlobalAt >= TAIL_GLOBAL_GAP) {
      this.tailAt.set(shooter, now);
      this.tailGlobalAt = now;
      if (self) this._play(g.tail, { gain: 0.3, rate: 0.98 + Math.random() * 0.04, priority: PR.tail, cls: 'tail' });
      else {
        const k = d / 34;
        // The tail falls off far more slowly than the bang, and its share of the sound grows with distance.
        const gain = (0.32 + 0.26 * this.sFar) / (1 + k * k * Math.sqrt(k));
        this._play(g.tail, { gain, pan: this.sPan, far: Math.max(0.55, this.sFar), rate: 0.94 + Math.random() * 0.1, priority: PR.tail, cls: 'tail' });
      }
    }
    if (sup || now - this.reflectAt < REFLECT_GAP) return;
    const bank = this.reflect[this.theme] || this.reflect.railyard;
    const buf = bank && bank[g.size];
    if (!buf) return;
    this.reflectAt = now;
    if (self) this._play(buf, { gain: 0.26, priority: PR.tail, cls: 'reflect' });
    else this._play(buf, { gain: 0.26 * this.sGain, pan: this.sPan * 0.5, far: Math.max(0.3, this.sFar), priority: PR.tail, cls: 'reflect' });
  }

  // A round from someone else that passes close enough to hear.
  _whiz(e, now) {
    if (now - this.whizAt < 0.08 || !e.rays || !this.localAlive) return;
    if (this._isAlly(e.by)) return;
    const ox = e.ox, oz = e.oz;
    for (let i = 0; i < e.rays.length; i++) {
      const r = e.rays[i], dx = r.x - ox, dz = r.z - oz, lenSq = dx * dx + dz * dz;
      if (lenSq < 16) continue;
      const u = Math.max(0, Math.min(1, ((this.lx - ox) * dx + (this.lz - oz) * dz) / lenSq));
      const px = ox + dx * u - this.lx, pz = oz + dz * u - this.lz;
      if (px * px + pz * pz > WHIZ_RADIUS * WHIZ_RADIUS) continue;
      this.whizAt = now;
      this.fight = Math.min(1, this.fight + 0.15);
      this._play(this.sfx.whiz, { bus: this.ui, gain: 0.5, rate: 0.9 + Math.random() * 0.25, priority: PR.threat, cls: 'ui', pan: Math.max(-0.7, Math.min(0.7, (this.lx - (ox + dx)) / 10)) });
      return;
    }
  }

  // The material the map is built from answers when a round lands near you.
  _impact(e, now) {
    if (now - this.impactAt < 0.05 || !e.rays || !e.rays.length) return;
    const r = e.rays[0];
    if (r.hit !== 'wall') return;
    this.impactAt = now;
    const buf = this.theme === 'railyard' ? this.sfx.impactMetal : this.theme === 'dust' ? this.sfx.impactDirt : this.sfx.impactConcrete;
    this._world(buf, r.x, r.z, IMPACT_RANGE, { gain: 0.34, priority: PR.tail, cls: 'impact', rate: 0.9 + Math.random() * 0.2 });
  }

  _isAlly(id) {
    const v = this.lastView, p = v && this._posOf(v, id);
    return !!p && p.team === this.localTeam;
  }

  _world(buffer, x, z, range, opts) {
    if (this._spatial(x, z) > range) return;
    this._play(buffer, { gain: (opts.gain ?? 1) * this.sGain, pan: this.sPan, far: this.sFar, priority: opts.priority ?? PR.world, cls: opts.cls ?? 'world', room: opts.room ?? 0, rate: opts.rate ?? 1 });
  }

  // Medal priority: when several land together (they do, on a multi-kill), the rarest one is the one you hear.
  _medalRank(id) { return MEDAL_RANK[id] ?? 0; }

  // Only ever one medal playing and one waiting. Anything that cannot wait its turn is dropped.
  _medal(id) {
    if (!this.medals[id]) return;
    const now = this.ctx.currentTime;
    if (now >= this.medalBusyUntil) { this._playMedal(id, now); return; }
    if (!this.medalPending || this._medalRank(id) >= this._medalRank(this.medalPending)) { this.medalPending = id; this.medalAt = now; }
  }

  _playMedal(id, now) {
    const buf = this.medals[id];
    this.medalBusyUntil = now + buf.duration * 0.8;
    this._play(buf, { bus: this.ui, priority: PR.ui, cls: 'medal' });
  }

  _updateMedals(now) {
    if (!this.medalPending || now < this.medalBusyUntil) return;
    const id = this.medalPending;
    this.medalPending = null;
    if (now - this.medalAt <= MEDAL_STALE) this._playMedal(id, now);
  }

  // Hitmarkers: rate-limited, and the kill sound replaces the heavy tick instead of stacking on it.
  _hitSound(e) {
    const now = this.ctx.currentTime;
    if (e.head) { this.hitAt = now; this._play(this.sfx.headshot, { bus: this.ui, priority: PR.hit, cls: 'ui', gain: 1, rate: 0.98 + Math.random() * 0.04 }); return; }
    if (e.killed) return;                         // The kill event has its own sound.
    if (now - this.hitAt < HIT_GAP) return;
    this.hitAt = now;
    this._play(this.sfx.hit, { bus: this.ui, priority: PR.hit, cls: 'ui', gain: 0.8, rate: 0.98 + Math.random() * 0.04 });
  }

  onEvents(events, view) {
    if (!this._running()) return;
    this._trackLocal(view);
    this.lastView = view;
    const me = this.localId;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.t) {
        case 'shot': this._shot(e); break;
        case 'hit':
          if (e.by === me) this._hitSound(e);
          else if (e.target === me) { this.fight = 1; this._play(this.sfx.hurt, { bus: this.ui, priority: PR.threat, cls: 'ui', gain: 0.85 }); }
          break;
        case 'kill':
          if (e.by === me) this._killConfirm(e);
          else if (e.assist === me) this._play(this.sfx.assist, { bus: this.ui, priority: PR.ui, cls: 'ui', gain: 0.8 });
          break;
        case 'medal':
          if (e.id === me) this._medal(e.medal);
          break;
        case 'reload': this._reloadFoley(e, view); break;
        case 'swap': {
          const p = this._posOf(view, e.id);
          const f = p && this.foley[p.weapon];
          if (!f) break;
          if (e.id === me) this._play(f.swap, { bus: this.ui, priority: PR.ui, cls: 'foley', gain: 0.55 });
          else this._world(f.swap, p.x, p.z, FOLEY_RANGE, { gain: 0.4, priority: PR.gun, cls: 'foley' });
          break;
        }
        case 'slide': {
          const p = this._posOf(view, e.id);
          if (e.id === me) this._play(this.sfx.slide, { bus: this.ui, priority: PR.ui, cls: 'foley', gain: 0.6 });
          else if (p) this._world(this.sfx.slide, p.x, p.z, 16, { gain: 0.7, priority: PR.gun, cls: 'foley' });
          break;
        }
        case 'spawn':
          if (e.id === me) this._play(this.sfx.spawn, { bus: this.ui, priority: PR.ui, cls: 'ui' });
          break;
        case 'streak': this._streakCall(e); break;
        case 'streak_denied':
          if (e.id === me) this._play(this.sfx.denied, { bus: this.ui, priority: PR.ui, cls: 'ui', gain: 0.7 });
          break;
        case 'emp':
          this._play(this.sfx.empBlast, { bus: this.ui, priority: PR.boom, cls: 'loud', gain: e.team === this.localTeam ? 0.85 : 0.6 });
          break;
        case 'incoming':
          this._world(this.sfx.whistle, e.x, e.z, HEAR_RANGE, { gain: e.team === this.localTeam ? 0.35 : 0.8, priority: PR.boom, cls: 'world' });
          break;
        case 'explosion':
          this.fight = 1;
          // A rocket is one warhead, not a line of them from the sky: the frag's punch, pitched down.
          if (e.weapon) this._world(this.sfx.frag, e.x, e.z, HEAR_RANGE + 10, { gain: 1.75, priority: PR.boom, cls: 'boom', room: 0.3, rate: 0.82 });
          else this._world(this.sfx.explosion, e.x, e.z, HEAR_RANGE + 20, { gain: 1.8, priority: PR.boom, cls: 'boom', room: 0.32 });
          break;
        case 'tag':
          if (e.by === me) this._play(this.sfx.tag, { bus: this.ui, priority: PR.ui, cls: 'ui', gain: 0.85, rate: e.kind === 'confirm' ? 1 : 0.8 });
          else this._world(this.sfx.tag, e.x, e.z, 16, { gain: 0.5, priority: PR.gun, rate: e.kind === 'confirm' ? 1 : 0.8 });
          break;
        case 'capture':
          this._play(e.team === this.localTeam ? this.sfx.flagTaken : this.sfx.flagLost, { bus: this.ui, priority: PR.ui, cls: 'ui', gain: 0.7 });
          break;
        case 'hard_move':
          this._play(this.sfx.zoneMove, { bus: this.ui, priority: PR.ui, cls: 'ui', gain: 0.7 });
          break;
        case 'throw':
          if (e.id === me) this._play(this.sfx.pin, { bus: this.ui, priority: PR.ui, cls: 'foley', gain: 0.75 });
          else this._world(this.sfx.pin, e.ox, e.oz, 18, { gain: 0.6, priority: PR.gun, cls: 'foley' });
          break;
        case 'bang': this._bang(e); break;
        case 'pulse': this._world(this.sfx.pulse, e.x, e.z, 28, { gain: 0.9, priority: PR.world }); break;
        case 'zap': this._world(this.sfx.zap, e.x, e.z, 24, { gain: 1, priority: PR.world }); break;
        case 'decoy': this._shot({ by: 'decoy', weapon: e.weapon, ox: e.x, oz: e.z, rays: null }); break;
        case 'flashed':
          if (e.id === me) this._play(this.sfx.flashRing, { bus: this.ui, priority: PR.boom, cls: 'loud', gain: 0.3 + 0.6 * e.amount });
          break;
        case 'heal': {
          const p = this._posOf(view, e.id);
          if (e.id === me) this._play(this.sfx.stim, { bus: this.ui, priority: PR.ui, cls: 'ui', gain: 0.8 });
          else if (p) this._world(this.sfx.stim, p.x, p.z, 12, { gain: 0.5, priority: PR.gun });
          break;
        }
        case 'overheat': this._overheat(e, view); break;
        case 'turret':
          this._world(this.sfx.turretDeploy, e.x, e.z, HEAR_RANGE, { gain: 1.3, priority: PR.ui, room: 0.2 });
          break;
        case 'turret_down':
          this._world(this.sfx.frag, e.x, e.z, HEAR_RANGE, { gain: 1.2, priority: PR.ui, cls: 'boom', room: 0.3, rate: 1.25 });
          break;
        case 'turret_shot':
          this._streakGun('turret', e.ox, e.oz, 0.85);
          break;
        case 'gunship':
          this._play(this.sfx.strike, { bus: this.ui, priority: PR.ui, cls: 'ui', gain: e.team === this.localTeam ? 0.45 : 0.8, rate: 0.7 });
          break;
        case 'gunship_shot':
          this._streakGun(e.kind === 'chopper' ? 'turret' : 'gunship', e.x, e.z, e.kind === 'chopper' ? 0.9 : 1.5);
          break;
        case 'phase':
          this._phaseMusic(e, view);
          break;
        default: break;
      }
    }
  }

  // A streak being called: each has its own short sting, and the far team hears it at a lower level.
  _streakCall(e) {
    const mine = e.team === this.localTeam;
    let buf = this.sfx.strike, rate = 1, gain = mine ? 0.55 : 0.8;
    if (e.kind === 'uav' || e.kind === 'overwatch') { buf = this.sfx.uav; gain = mine ? 0.7 : 0.45; if (e.kind === 'overwatch') rate = 0.8; }
    else if (e.kind === 'jammer') { buf = this.sfx.jam; gain = mine ? 0.5 : 0.75; }
    else if (e.kind === 'resupply') { buf = this.sfx.supply; gain = mine ? 0.7 : 0.35; }
    else if (e.kind === 'emp' || e.kind === 'mortar') { buf = e.kind === 'emp' ? this.sfx.jam : this.sfx.strike; if (e.kind === 'emp') rate = 0.8; }
    this._play(buf, { bus: this.ui, priority: PR.ui, cls: 'ui', gain, rate });
  }

  // A kill chain climbs in pitch, so the third in a row feels different from the first.
  _killConfirm(e) {
    const now = this.ctx.currentTime;
    this.killChain = now - this.lastKillAt < 3.5 ? Math.min(this.killChain + 1, 6) : 0;
    this.lastKillAt = now;
    this._play(this.sfx.kill, { bus: this.ui, priority: PR.hit, cls: 'ui', gain: 1, rate: 1 + this.killChain * 0.05 });
  }

  _reloadFoley(e, view) {
    const me = this.localId, p = this._posOf(view, e.id);
    const f = p && this.foley[p.weapon];
    if (!f) return;
    const now = this.ctx.currentTime, wdef = WEAPONS[p.weapon];
    const place = (buf, when, gain) => e.id === me
      ? this._play(buf, { bus: this.ui, priority: PR.ui, cls: 'foley', gain: gain * 0.7, when })
      : (this._spatial(p.x, p.z) <= FOLEY_RANGE ? this._play(buf, { gain: gain * 0.5 * this.sGain, pan: this.sPan, far: this.sFar, priority: PR.gun, cls: 'foley', when }) : null);
    if (e.stage !== 'start') {
      // Whatever was still queued was for a reload that just stopped: fired through it, or it finished.
      this._cancelFoley(e.id, now);
      if (p.ammo > (this.reloadAmmo.get(e.id) ?? 0)) place(f.rack, 0, 0.9);
      return;
    }
    this._cancelFoley(e.id, now);
    this.reloadAmmo.set(e.id, p.ammo);
    place(f.out, 0, 0.8);
    const dur = p.reloadDur || (wdef ? wdef.reload : 1.5);
    const pending = [];
    if (wdef && wdef.shellReload) {
      // One shell at a time, however long Fast Hands has made each one.
      const n = Math.round(dur / wdef.reload), k = Math.abs(n - dur / wdef.reload) < 0.08 ? 1 : 0.72;
      for (let i = 1; i <= 8; i++) {
        const t = i * wdef.reload * k;
        if (t >= dur) break;
        const v = place(f.in, now + t, 0.8);
        if (v) pending.push(v);
      }
    } else {
      const v = place(f.in, now + dur * 0.55, 0.85);
      if (v) pending.push(v);
    }
    if (pending.length) this.foleyPending.set(e.id, pending);
  }

  _cancelFoley(id, now) {
    const list = this.foleyPending.get(id);
    if (!list) return;
    for (const v of list) if (v.start > now) this._cancel(v, now);
    this.foleyPending.delete(id);
  }

  _phaseMusic(e, view) {
    if (view && view.mode === 'range') return;
    if (e.phase === 'live') {
      this.stingerDone = false;
      this._play(this.stingers.matchStart, { bus: this.music, priority: PR.boom, cls: 'loud', gain: 1 });
    } else if (e.phase === 'ended' && !this.stingerDone) {
      this.stingerDone = true;
      this._stopTension();
      const won = view && view.winner !== null && view.winner === this.localTeam;
      const lost = view && view.winner !== null && view.winner !== this.localTeam;
      const buf = won ? this.stingers.victory : lost ? this.stingers.defeat : this.sfx.end;
      this._play(buf, { bus: won || lost ? this.music : this.ui, priority: PR.own, cls: 'loud', gain: 1 });
    }
  }

  // The last kills of a match: one stinger on the way in, then a pulse under the rest of it. The time running out
  // counts too. Stops at the end of the match.
  _updateTension(view) {
    if (view.mode === 'range' || view.phase === 'ended') return;
    const lim = view.scoreLimit || 75;
    const margin = (view.mode === 'dom' || view.mode === 'hard') ? Math.ceil(lim * TENSION_POINTS) : TENSION_KILLS;
    const top = Math.max(view.scores[0], view.scores[1]);
    const closing = view.phase === 'live' && (lim - top <= margin || (view.timeLeft > 0 && view.timeLeft <= 30));
    if (closing && !this.tension) {
      this.tension = true;
      this._play(this.stingers.tension, { bus: this.music, priority: PR.boom, cls: 'loud', gain: 1 });
      if (!this.tensionSrc && this.stingers.tensionLoop) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.stingers.tensionLoop;
        src.loop = true;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        src.connect(g);
        g.connect(this.music);
        src.start();
        this.tensionSrc = src;
        this.tensionGain = g;
      }
    }
    if (this.tensionGain) this._holdGain(this.tensionGain.gain, closing ? (this.micActive ? 0.1 : 0.2) * (1 - 0.5 * this.fight) : 0);
  }

  _stopTension() {
    this.tension = false;
    if (this.tensionGain) this.tensionGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  // Continuous beds. Rolling down unless refreshed: if the match stops calling update, the sound fades by itself
  // instead of carrying on into the menu.
  _holdGain(param, target) {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(target, now, 0.3);
    param.setTargetAtTime(0, now + 1.5, 0.6);
  }

  _ensureLoop(srcKey, buffer, gain) {
    if (this[srcKey] || !buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.amb);
    src.start();
    this[srcKey] = src;
  }

  _stopLoops() {
    for (const k of ['windSrc', 'rainSrc']) {
      if (this[k]) { try { this[k].stop(); } catch { /* already stopped */ } }
      this[k] = null;
    }
  }

  setTheme(theme) {
    const known = THEME_AUDIO[theme] ? theme : 'railyard';
    this.theme = known;
    if (!this.room) return;
    this.applyRoom(known);
    this.roomOut.gain.value = THEME_AUDIO[known].ir.gain;
    this._stopLoops();
    // Which sky each map has. Matching what art.js draws: rain over the night maps, wind over the desert.
    if (!this.ready) return;
    if (known === 'dust') this._ensureLoop('windSrc', this.loops.wind, 1);
    if (known === 'neon' || known === 'harbor') this._ensureLoop('rainSrc', this.loops.rain, 1);
    if (known === 'harbor') this._ensureLoop('windSrc', this.loops.wind, 0.55);
  }

  applyRoom(theme) {
    if (!this.rooms[theme]) this.rooms[theme] = roomImpulse(this.ctx, theme);
    this.room.buffer = this.rooms[theme];
  }

  _updateWeather(view, dt) {
    const now = this.ctx.currentTime;
    if (now >= this.nextAmbRefresh) {
      this.nextAmbRefresh = now + 0.25;
      const base = this.theme === 'harbor' || this.theme === 'neon' ? 0.1 : this.theme === 'dust' ? 0.12 : 0;
      // A firefight pushes the weather right down; this is the music-free part of the ducking.
      this._holdGain(this.amb.gain, base * (this.micActive ? 0.45 : 1) * (1 - 0.75 * this.fight));
    }
    if (this.theme === 'harbor') {
      this.thunderT -= dt;
      if (this.thunderT <= 0 && view.phase !== 'ended') {
        this.thunderT = 14 + Math.random() * 26;
        // Thunder over a firefight is just more noise: it waits for a lull.
        if (this.fight < 0.4) this._play(this.thunder[Math.floor(Math.random() * this.thunder.length)], {
          bus: this.thunderBus, gain: 0.45 + Math.random() * 0.4, rate: 0.9 + Math.random() * 0.2, priority: PR.world, cls: 'loud', pan: (Math.random() - 0.5) * 0.6,
        });
      }
    }
  }

  _bang(e) {
    if (e.kind === 'smoke') this._world(this.sfx.smoke, e.x, e.z, 34, { gain: 1, priority: PR.world, room: 0.1 });
    else if (e.kind === 'flash') this._world(this.sfx.flashBang, e.x, e.z, HEAR_RANGE, { gain: 1.6, priority: PR.boom, cls: 'boom', room: 0.3 });
    else if (e.kind === 'molotov') this._world(this.sfx.molotov, e.x, e.z, HEAR_RANGE, { gain: 1.4, priority: PR.boom, cls: 'boom', room: 0.25 });
    else {
      this.fight = Math.min(1, this.fight + 0.5);
      // A cluster's bomblets are small and quick: higher pitched, lower, and they share the boom cap with everything else.
      const g = e.kind === 'bomblet' ? 0.95 : e.kind === 'sticky' ? 1.45 : 1.7;
      this._world(this.sfx.frag, e.x, e.z, HEAR_RANGE, { gain: g, priority: PR.boom, cls: 'boom', room: 0.4, rate: e.kind === 'bomblet' ? 1.45 : 1 });
    }
  }

  // The local player's event can reach us twice (own frame, host echo), so one vent per lockout.
  _overheat(e, view) {
    if (e.id === this.localId) {
      const now = this.ctx.currentTime;
      if (now - this.lastVentAt < 1) return;
      this.lastVentAt = now;
      this._play(this.sfx.vent, { bus: this.ui, priority: PR.ui, cls: 'ui', gain: 0.8 });
      return;
    }
    const p = this._posOf(view, e.id);
    if (p) this._world(this.sfx.vent, p.x, p.z, 22, { gain: 1, priority: PR.gun, cls: 'foley' });
  }

  _streakGun(id, x, z, gain) {
    const g = this.guns[id];
    if (!g || !g.near.length || x === undefined) return;
    // Streak guns follow the same culling as any other gun: past the discrete range they only feed the far layer.
    if (this._spatial(x, z) > FAR_CULL) { this._raiseFarLayer(this.sD); return; }
    this.fight = Math.min(1, this.fight + 0.04);
    this._play(g.near[Math.floor(Math.random() * g.near.length)], { gain: gain * 0.75 * this.sGain, pan: this.sPan, far: this.sFar, priority: this.sD < THREAT_RANGE ? PR.threat : PR.gun, cls: this.sD < THREAT_RANGE ? 'threat' : 'gun', room: 0.2, rate: 0.96 + Math.random() * 0.08 });
  }

  // The firefight level and what follows it: the world dips under your own gun, and the far layer eases back down
  // when nobody is shooting out there any more.
  _updateDucks(dt) {
    const now = this.ctx.currentTime;
    this.fight = Math.max(0, this.fight - FIGHT_DECAY * dt);
    this.farLevel = Math.max(0, this.farLevel - dt * 0.55);
    this.worldDuck.gain.setTargetAtTime(now < this.duckUntil ? WORLD_DUCK : 1, now, now < this.duckUntil ? 0.012 : 0.09);
    if (this.farGain) {
      this.farGain.gain.setTargetAtTime(this.farLevel * 0.22, now, 0.08);
      if (this.farPan) this.farPan.pan.setTargetAtTime(this.farPanValue * 0.6, now, 0.3);
    }
  }

  // Ticks only while the bar is climbing, so a cooling gun is quiet. Faster and higher as it nears lockout.
  _updateHeat(view, dt) {
    const p = this._posOf(view, this.localId);
    const heat = p && p.alive && p.heat ? p.heat : 0;
    if (heat > 0.55 && heat > this.prevHeat && !p.overheated) {
      this.heatTickT -= dt;
      if (this.heatTickT <= 0) {
        const k = (heat - 0.55) / 0.45;
        this.heatTickT = 0.2 - 0.13 * k;
        this._play(this.sfx.heatTick, { bus: this.ui, priority: PR.gun, cls: 'foley', gain: 0.3 + 0.5 * k, rate: 1 + 0.9 * k });
      }
    } else if (heat <= this.prevHeat) {
      this.heatTickT = 0;
    }
    this.prevHeat = heat;
  }

  // One looping source, started the first time a gunship appears and faded in and out after that.
  _updateRumble(view) {
    const ships = view.gunships;
    const on = !!(ships && ships.length);
    if (on && !this.rumbleGain) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.sfx.rumble;
      src.loop = true;
      this.rumbleGain = this.ctx.createGain();
      this.rumbleGain.gain.value = 0;
      src.connect(this.rumbleGain);
      this.rumbleGain.connect(this.dry);
      src.start();
    }
    if (this.rumbleGain) this.rumbleGain.gain.setTargetAtTime(on ? 0.5 * (1 - 0.5 * this.fight) : 0, this.ctx.currentTime, 0.5);
  }

  // Continuous sounds that come from state instead of events: footsteps, the low-health heartbeat,
  // the LMG's heat warning and the gunship overhead.
  update(view, dt) {
    if (!this._running() || !view) return;
    this._trackLocal(view);
    this.lastView = view;
    if (this.theme === null) this.setTheme(view.theme);
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
        this._play(this.sfx.heartbeat, { bus: this.ui, priority: PR.ui, cls: 'ui', gain: 0.75 });
      }
    } else {
      this.heartT = 0;
    }

    this._updateDucks(dt);
    this._updateMedals(this.ctx.currentTime);
    this._updateHeat(view, dt);
    this._updateRumble(view);
    this._updateTension(view);
    this._updateWeather(view, dt);
  }

  _step(p) {
    const buf = this.sfx.steps[Math.floor(Math.random() * this.sfx.steps.length)];
    if (p.id === this.localId) {
      this._play(buf, { priority: PR.step, cls: 'step', gain: 0.14, rate: 0.95 + Math.random() * 0.1 });
      return;
    }
    if (p.team === this.localTeam || p.quiet) return;    // Enemies only, and Dead Silence means what it says.
    if (this._spatial(p.x, p.z) > STEP_RANGE) return;
    // Steps stay audible further than the gun model would, otherwise they carry no information.
    this._play(buf, {
      gain: (p.sprinting ? 0.85 : 0.5) * Math.max(0.12, 1 - this.sD / STEP_RANGE),
      pan: this.sPan, far: this.sFar, priority: this.sD < 10 ? PR.gunNear : PR.step, cls: 'step',
      rate: 0.92 + Math.random() * 0.16,
    });
  }

  dispose() {
    if (typeof document !== 'undefined') {
      for (const type of ['touchend', 'pointerup', 'click', 'keydown']) {
        document.removeEventListener(type, this._onGesture, { capture: true });
      }
    }
    if (this.ctx) {
      this._stopLoops();
      if (this.farSrc) { try { this.farSrc.stop(); } catch { /* already stopped */ } }
    }
    if (this.ctx && !this.offline) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.ready = false;
  }
}
