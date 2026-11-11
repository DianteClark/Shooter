// Synthesised music: a handful of instruments made from oscillators, noise, filters and envelopes, the arrangements
// that play them, and the renderer that turns an arrangement into mono Float32Array stems.
//
// Everything is original and generated here: no samples, no borrowed melodies. One key family (D minor, with a D
// major turn for wins) and one recurring motif tie the tracks together.
//
// Loops render circularly: a note, an echo or a reverb tail that runs past the end of the loop lands at its start,
// and the filters run twice round the loop so their state at the seam is the steady state. The last sample of a
// loop therefore flows into the first with no click, and a looped AudioBuffer needs no crossfade.
//
// renderTrack is a generator that yields every few milliseconds of work, so music.js can spread a build over idle
// time (and a node test can just run it to the end). No WebAudio here: this file runs in node too.

export const MUSIC_RATE = 22050;     // Plenty for music on a phone speaker, and half the memory of 44.1k.
const TAU = Math.PI * 2;
export const hz = n => 440 * Math.pow(2, (n - 69) / 12);

function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

// PolyBLEP: takes the worst aliasing off a naive saw for the price of two compares.
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// Zero-delay state-variable filter (lowpass out; band and high on the side).
class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.a1 = 1; this.a2 = 0; this.a3 = 0; this.k = 1; this.bp = 0; this.hp = 0; }
  set(fc, q, sr) {
    const g = Math.tan(Math.PI * Math.min(Math.max(fc, 20), sr * 0.45) / sr);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  lp(x) {
    const v3 = x - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.bp = v1; this.hp = x - this.k * v1 - v2;
    return v2;
  }
}

// ---- The canvas an arrangement is drawn on: dry signal plus a reverb send. ----
class Canvas {
  constructor(n, loop, sr, seed) {
    this.n = n; this.loop = loop; this.sr = sr;
    this.d = new Float32Array(n); this.w = new Float32Array(n);
    this.send = 0; this.r = rngFrom(seed);
  }
}
// Adds one sample. Past the end, a loop wraps and a one-shot drops it.
function put(c, j, v) {
  if (j >= c.n) { if (!c.loop) return; j -= c.n; }
  c.d[j] += v;
  if (c.send) c.w[j] += v * c.send;
}

// ---- Instruments. Each takes the canvas and an event { t (s), dur (s), n (midi) or ns, vel, ...options }. ----

// Pulse bass with a sub sine and a snappy filter envelope; a little drive for grit on small speakers.
function bass(c, e) {
  const sr = c.sr, f = hz(e.n), dt = f / sr, s0 = Math.round(e.t * sr), gate = Math.round(e.dur * sr);
  const rel = Math.round(0.05 * sr), len = gate + rel, att = Math.round(0.004 * sr);
  const cut = e.cut ?? 420, amt = e.env ?? 1500, q = e.q ?? 1.3, w = e.width ?? 0.38, sub = e.sub ?? 0.55;
  const fk = Math.exp(-1 / (sr * (e.fdec ?? 0.09))), vel = e.vel ?? 1;
  const flt = new SVF();
  let ph = 0, ph2 = w, fe = 1;
  for (let i = 0; i < len; i++) {
    if ((i & 15) === 0) flt.set(cut + amt * fe, q, sr);
    fe *= fk;
    const x = (2 * ph - 1 - blep(ph, dt) - (2 * ph2 - 1 - blep(ph2, dt))) * 0.5 + Math.sin(TAU * ph) * sub;
    ph += dt; if (ph >= 1) ph -= 1;
    ph2 += dt; if (ph2 >= 1) ph2 -= 1;
    const a = i < att ? i / att : i < gate ? 1 : 1 - (i - gate) / rel;
    put(c, s0 + i, Math.tanh(flt.lp(x) * 1.6) * a * vel * 0.6);
  }
}

// Analog-style pad: three detuned saws a note, a slow filter drift, long attack and release.
function* pad(c, e) {
  const sr = c.sr, ns = e.ns, nv = ns.length * 3, s0 = Math.round(e.t * sr), gate = Math.round(e.dur * sr);
  const att = Math.max(1, Math.round((e.att ?? 0.45) * sr)), rel = Math.round((e.rel ?? 1.1) * sr), len = gate + rel;
  const cut = e.cut ?? 1300, vel = (e.vel ?? 1) / Math.sqrt(nv), trem = e.trem ?? 0;
  const dts = new Float64Array(nv), ph = new Float64Array(nv);
  for (let k = 0; k < nv; k++) {
    const det = [-0.11, 0.0, 0.12][k % 3];
    dts[k] = hz(ns[Math.floor(k / 3)] + det) / sr;
    ph[k] = c.r();
  }
  const flt = new SVF(), lfoDt = 0.13 / sr, tremDt = trem / sr;
  let lfo = c.r(), tp = 0, endA = 1;
  for (let i = 0; i < len; i++) {
    if ((i & 31) === 0) flt.set(cut * (1 + 0.3 * Math.sin(TAU * lfo)), 0.8, sr);
    lfo += lfoDt;
    let x = 0;
    for (let k = 0; k < nv; k++) {
      const p = ph[k], dt = dts[k];
      x += 2 * p - 1 - blep(p, dt);
      const q = p + dt; ph[k] = q >= 1 ? q - 1 : q;
    }
    let a;
    if (i < gate) { a = i < att ? i / att : 1; endA = a; } else a = endA * (1 - (i - gate) / rel);
    if (trem) { tp += tremDt; if (tp >= 1) tp -= 1; a *= 0.55 + 0.45 * Math.cos(TAU * tp); }
    put(c, s0 + i, flt.lp(x) * a * a * vel);
    if ((i & 4095) === 4095) yield;
  }
}

// Pluck: saw plus a narrow pulse through a fast-closing filter. Bright option for bell-ish motif lines.
function pluck(c, e) {
  const sr = c.sr, f = hz(e.n), dt = f / sr, s0 = Math.round(e.t * sr), dec = e.dec ?? 0.28;
  const len = Math.round(Math.min(dec * 5, 3) * sr), att = Math.round(0.002 * sr), vel = e.vel ?? 1;
  const cut = e.cut ?? 900, amt = e.env ?? 3200, fk = Math.exp(-1 / (sr * dec * 0.35)), ak = Math.exp(-1 / (sr * dec));
  const flt = new SVF();
  let ph = 0, ph2 = 0.2, fe = 1, a = 1;
  for (let i = 0; i < len; i++) {
    if ((i & 15) === 0) flt.set(cut + amt * fe, 1.1, sr);
    fe *= fk; a *= ak;
    const x = (2 * ph - 1 - blep(ph, dt)) * 0.6 + (2 * ph2 - 1 - blep(ph2, dt) - (2 * ph - 1 - blep(ph, dt))) * 0.25;
    ph += dt; if (ph >= 1) ph -= 1;
    ph2 += dt; if (ph2 >= 1) ph2 -= 1;
    const env = i < att ? i / att : a;
    put(c, s0 + i, flt.lp(x) * env * vel * 0.7);
  }
}

// Gritty lead: two detuned saws and a sub square, driven, with a short glide in and a vibrato that grows.
function lead(c, e) {
  const sr = c.sr, s0 = Math.round(e.t * sr), gate = Math.round(e.dur * sr), rel = Math.round(0.09 * sr);
  const len = gate + rel, att = Math.round(0.012 * sr), vel = e.vel ?? 1, cut = e.cut ?? 2200, drive = e.drive ?? 2.6;
  const from = e.from ?? e.n, glide = Math.round(0.045 * sr), vibAt = 0.16 * sr;
  const flt = new SVF(); flt.set(cut, 1.6, sr);
  let p1 = 0, p2 = 0.37, p3 = 0, vib = 0;
  for (let i = 0; i < len; i++) {
    const n = i < glide ? from + (e.n - from) * (i / glide) : e.n;
    const vd = i > vibAt ? Math.min(1, (i - vibAt) / (0.3 * sr)) * 0.22 : 0;
    vib += 5.4 / sr; if (vib >= 1) vib -= 1;
    const f = hz(n + vd * Math.sin(TAU * vib)), d1 = f * 1.0047 / sr, d2 = f * 0.9953 / sr, d3 = f * 0.5 / sr;
    let x = (2 * p1 - 1 - blep(p1, d1)) + (2 * p2 - 1 - blep(p2, d2)) + (p3 < 0.5 ? 0.35 : -0.35);
    p1 += d1; if (p1 >= 1) p1 -= 1;
    p2 += d2; if (p2 >= 1) p2 -= 1;
    p3 += d3; if (p3 >= 1) p3 -= 1;
    x = Math.tanh(x * drive * 0.5);
    const a = i < att ? i / att : i < gate ? 1 : 1 - (i - gate) / rel;
    put(c, s0 + i, flt.lp(x) * a * vel * 0.45);
  }
}

// FM bell: a carrier and a 3.5x modulator whose index falls away; clean and glassy against the grit.
function bell(c, e) {
  const sr = c.sr, f = hz(e.n), s0 = Math.round(e.t * sr), dec = e.dec ?? 0.9, len = Math.round(dec * 4 * sr);
  const vel = e.vel ?? 1, ak = Math.exp(-1 / (sr * dec)), ik = Math.exp(-1 / (sr * dec * 0.3));
  let a = 1, idx = 2.2, pc = 0, pm = 0;
  for (let i = 0; i < len; i++) {
    a *= ak; idx *= ik;
    const x = Math.sin(TAU * pc + idx * Math.sin(TAU * pm));
    pc += f / sr; if (pc >= 1) pc -= 1;
    pm += f * 3.5 / sr; if (pm >= 1) pm -= 1;
    put(c, s0 + i, x * a * (i < 40 ? i / 40 : 1) * vel * 0.4);
  }
}

// Drum machine.
function kick(c, e) {
  const sr = c.sr, s0 = Math.round(e.t * sr), dec = e.dec ?? 0.32, len = Math.round(dec * 4 * sr), vel = e.vel ?? 1;
  const top = e.top ?? 150, low = e.low ?? 46;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr, f = low + (top - low) * Math.exp(-t * 28);
    ph += f / sr; if (ph >= 1) ph -= 1;
    let x = Math.sin(TAU * ph) * Math.exp(-t / dec);
    if (i < 70) x += (c.r() * 2 - 1) * 0.5 * (1 - i / 70) * (i < 8 ? i / 8 : 1);
    put(c, s0 + i, Math.tanh(x * 1.8) * vel * 0.75);
  }
}

function snare(c, e) {
  const sr = c.sr, s0 = Math.round(e.t * sr), len = Math.round(0.28 * sr), vel = e.vel ?? 1;
  const flt = new SVF(); flt.set(e.tone ?? 2600, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    flt.lp(c.r() * 2 - 1);
    const nz = (flt.bp + flt.hp * 0.4) * Math.exp(-t * 16) * (i < 8 ? i / 8 : 1);
    ph += (175 + 60 * Math.exp(-t * 40)) / sr; if (ph >= 1) ph -= 1;
    put(c, s0 + i, (nz * 0.9 + Math.sin(TAU * ph) * 0.6 * Math.exp(-t * 28)) * vel * 0.6);
  }
}

function hat(c, e) {
  const sr = c.sr, s0 = Math.round(e.t * sr), dec = e.open ? 0.16 : 0.035, len = Math.round(dec * 5 * sr);
  const vel = e.vel ?? 1, flt = new SVF(); flt.set(e.tone ?? 6500, 0.9, sr);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const x = c.r() * 2 - 1;
    flt.lp(x - prev); prev = x;
    put(c, s0 + i, flt.hp * Math.exp(-i / (sr * dec)) * (i < 6 ? i / 6 : 1) * vel * 0.32);
  }
}

// A rail joint struck by a wheel: a few inharmonic partials that ring and fall, and a click on top.
function clank(c, e) {
  const sr = c.sr, s0 = Math.round(e.t * sr), f = e.f ?? 420, vel = e.vel ?? 1, len = Math.round(0.9 * sr);
  const parts = [[1, 0.5, 9], [2.76, 0.32, 13], [5.4, 0.22, 19], [8.93, 0.14, 26]];
  const ph = [0, 0, 0, 0];
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let x = 0;
    for (let k = 0; k < 4; k++) {
      const p = parts[k];
      ph[k] += f * p[0] / sr; if (ph[k] >= 1) ph[k] -= 1;
      x += Math.sin(TAU * ph[k]) * p[1] * Math.exp(-t * p[2]);
    }
    if (i < 90) x += (c.r() * 2 - 1) * 0.6 * (1 - i / 90) * (i < 8 ? i / 8 : 1);
    put(c, s0 + i, x * vel * 0.55);
  }
}

function tom(c, e) {
  const sr = c.sr, s0 = Math.round(e.t * sr), f = hz(e.n ?? 45), len = Math.round(0.6 * sr), vel = e.vel ?? 1;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    ph += f * (1 + 0.6 * Math.exp(-t * 18)) / sr; if (ph >= 1) ph -= 1;
    let x = Math.sin(TAU * ph) * Math.exp(-t * 6);
    if (i < 60) x += (c.r() * 2 - 1) * 0.3 * (1 - i / 60) * (i < 8 ? i / 8 : 1);
    put(c, s0 + i, Math.tanh(x * 1.4) * vel * 0.6);
  }
}

// A cymbal wash for downbeats.
function crash(c, e) {
  const sr = c.sr, s0 = Math.round(e.t * sr), dec = e.dec ?? 1.1, len = Math.round(dec * 4 * sr), vel = e.vel ?? 1;
  const flt = new SVF(); flt.set(5200, 0.6, sr);
  for (let i = 0; i < len; i++) {
    flt.lp(c.r() * 2 - 1);
    const a = Math.exp(-i / (sr * dec)) * (i < 30 ? i / 30 : 1);
    put(c, s0 + i, (flt.hp * 0.7 + flt.bp * 0.5) * a * vel * 0.3);
  }
}

// Noise swept up a band-pass with a rising tone under it, into the next downbeat.
function* riser(c, e) {
  const sr = c.sr, s0 = Math.round(e.t * sr), len = Math.round(e.dur * sr), vel = e.vel ?? 1;
  const flt = new SVF(), f0 = e.f0 ?? 300, f1 = e.f1 ?? 6000, fade = Math.round(0.02 * sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    if ((i & 15) === 0) flt.set(f0 * Math.pow(f1 / f0, u), 2.2, sr);
    flt.lp(c.r() * 2 - 1);
    ph += hz(50 + 12 * u) / sr; if (ph >= 1) ph -= 1;
    const a = u * u * (i > len - fade ? (len - i) / fade : 1);
    put(c, s0 + i, (flt.bp * 0.9 + (2 * ph - 1) * 0.12) * a * vel);
    if ((i & 32767) === 32767) yield;
  }
}

// Wind through the open door of a transport: low noise breathing up and down.
function* wind(c, e) {
  const sr = c.sr, s0 = Math.round(e.t * sr), len = Math.round(e.dur * sr), vel = e.vel ?? 1;
  const flt = new SVF(), edge = Math.round(len * 0.3);
  for (let i = 0; i < len; i++) {
    if ((i & 31) === 0) flt.set(500 + 700 * (0.5 + 0.5 * Math.sin(TAU * i / sr * 0.37)), 1.4, sr);
    flt.lp(c.r() * 2 - 1);
    const a = i < edge ? i / edge : i > len - edge ? (len - i) / edge : 1;
    put(c, s0 + i, flt.bp * a * vel * 0.8);
    if ((i & 32767) === 32767) yield;
  }
}

// The downbeat of a sting: a long kick, a burst of noise and a low boom.
function hit(c, e) {
  kick(c, { t: e.t, vel: e.vel ?? 1, dec: 0.7, top: 120, low: 38 });
  crash(c, { t: e.t, vel: (e.vel ?? 1) * 1.2, dec: 1.4 });
  const sr = c.sr, s0 = Math.round(e.t * sr), len = Math.round(0.5 * sr), flt = new SVF(); flt.set(900, 0.7, sr);
  for (let i = 0; i < len; i++) put(c, s0 + i, flt.lp(c.r() * 2 - 1) * Math.exp(-i / (sr * 0.12)) * (e.vel ?? 1) * 0.8);
}

const INSTR = { bass, pad, pluck, lead, bell, kick, snare, hat, clank, tom, crash, riser, wind, hit };
// Default reverb send per instrument.
const SEND = { bass: 0, pad: 0.55, pluck: 0.4, lead: 0.3, bell: 0.6, kick: 0.04, snare: 0.22, hat: 0.08, clank: 0.5, tom: 0.25, crash: 0.3, riser: 0.35, wind: 0.3, hit: 0.3 };

// ---- Writing arrangements. Bars and beats in 4/4; `len` in beats. ----
class Score {
  constructor(bpm) { this.spb = 60 / bpm; this.ev = []; }
  t(bar, beat = 0) { return (bar * 4 + beat) * this.spb; }
  add(k, bar, beat, o = {}) {
    const e = { ...o, k, t: this.t(bar, beat) };
    if (o.len !== undefined) e.dur = o.len * this.spb;
    this.ev.push(e);
    return this;
  }
  // 16 steps a bar: x full, o soft, - ghost, . rest. `fn(step)` may give per-step options.
  pat(k, bar, steps, o = {}, fn = null) {
    for (let i = 0; i < steps.length; i++) {
      const ch = steps[i];
      if (ch === '.' || ch === ' ') continue;
      const vel = (o.vel ?? 1) * (ch === 'x' ? 1 : ch === 'o' ? 0.6 : 0.3);
      this.add(k, bar, i / 4, { ...o, ...(fn ? fn(i) : null), vel });
    }
    return this;
  }
}

// Chords, voiced close around D3-D4 so they move by step.
const CH = {
  Dm: [57, 62, 65], Bb: [58, 62, 65], Gm: [58, 62, 67], A: [57, 61, 64], F: [57, 60, 65], C: [55, 60, 64],
  D: [57, 62, 66], G: [59, 62, 67], Eb: [58, 63, 67],
};
const ROOT = { Dm: 38, Bb: 34, Gm: 31, A: 33, F: 41, C: 36, D: 38, G: 31, Eb: 39 };

// The motif: four bars over Dm, Bb, Gm, A. [bar, beat, note, beats]
const MOTIF = [
  [0, 0, 74, 0.75], [0, 1, 69, 0.5], [0, 1.5, 72, 0.5], [0, 2, 74, 1], [0, 3, 77, 0.5], [0, 3.5, 76, 0.5],
  [1, 0, 74, 1], [1, 1, 70, 0.5], [1, 1.5, 72, 0.5], [1, 2, 74, 1.75],
  [2, 0, 70, 1], [2, 1, 74, 0.5], [2, 1.5, 72, 0.5], [2, 2, 70, 1], [2, 3, 69, 1],
  [3, 0, 69, 0.5], [3, 0.5, 73, 0.5], [3, 1, 76, 1.5], [3, 3, 69, 0.5], [3, 3.5, 73, 0.5],
];
const PROG = ['Dm', 'Bb', 'Gm', 'A'];

function motif(s, k, bar0, { shift = 0, vel = 1, bars = [0, 1, 2, 3], o = {} } = {}) {
  let prev = null;
  for (const [b, beat, n, len] of MOTIF) {
    if (!bars.includes(b)) continue;
    s.add(k, bar0 + bars.indexOf(b), beat, { n: n + shift, len, vel, from: prev ?? n + shift, ...o });
    prev = n + shift;
  }
}

// Rail joints: the double knock of a wheel set crossing a joint, on the last beat of a bar.
function joints(s, bar, vel = 0.5, f = 420) {
  s.add('clank', bar, 3.5, { vel: vel * 0.7, f });
  s.add('clank', bar, 3.75, { vel, f: f * 0.94 });
}

// ---- The tracks. ----
// bpm, bars; loop or not (a one-shot gets `tail` seconds after its last bar); stems: name -> compose(score);
// peak per stem after normalising; verb: reverb wet level per stem.
export const TRACKS = {
  // Title theme. A (0-3) the motif on a soft pluck over the bed; B (4-7) the pulse comes in, a riser into C (8-11),
  // the motif on the gritty lead with full drums; D (12-15) a breakdown with the answer phrase that settles back
  // into A. Two stems: the bed alone is the calm idle variant.
  menu: {
    bpm: 96, bars: 16, loop: true, seed: 11, peak: { bed: 0.5, drive: 0.5 }, verb: { bed: 0.32, drive: 0.2 },
    stems: {
      bed: s => {
        for (let bar = 0; bar < 16; bar++) {
          const ch = PROG[bar % 4], sec = bar >> 2, r = ROOT[ch];
          s.add('pad', bar, 0, { ns: CH[ch], len: 4, vel: [0.7, 0.8, 0.9, 0.7][sec], cut: [900, 1200, 1700, 1000][sec] });
          if (sec === 0 || sec === 3) {
            s.add('bass', bar, 0, { n: r, len: 1.8, vel: 0.65, cut: 260, env: 500 });
            s.add('bass', bar, 2, { n: r, len: 1.6, vel: 0.5, cut: 260, env: 500 });
          } else {
            const line = [0, 0, 12, 0, 0, 12, 0, 7];
            line.forEach((iv, i) => s.add('bass', bar, i / 2, { n: r + iv, len: 0.42, vel: i % 2 ? 0.6 : 0.85, cut: sec === 2 ? 520 : 380 }));
          }
          joints(s, bar, sec === 2 ? 0.55 : 0.45, bar % 2 ? 400 : 430);
          if (bar % 2 === 0) s.add('clank', bar, 1.25, { vel: 0.18, f: 300 });
        }
      },
      drive: s => {
        motif(s, 'pluck', 0, { vel: 0.6, o: { dec: 0.35, cut: 1400 } });
        for (let bar = 4; bar < 8; bar++) {
          s.pat('kick', bar, 'x.....x...x.....');
          s.pat('snare', bar, '........x.......', { vel: 0.8 });
          s.pat('hat', bar, 'o.o.o.o.o.o.o.o.', { vel: 0.7 });
        }
        motif(s, 'pluck', 4, { vel: 0.55, o: { dec: 0.3, cut: 1800 } });
        s.add('riser', 7, 0, { len: 4, vel: 0.5 });
        s.add('crash', 8, 0, { vel: 0.8 });
        for (let bar = 8; bar < 12; bar++) {
          s.pat('kick', bar, 'x.....x.x.x.....');
          s.pat('snare', bar, '........x.....-.', { vel: 0.85 });
          s.pat('hat', bar, 'xoxoxoxoxoxoxoxo', { vel: 0.6 });
          const ns = CH[PROG[bar % 4]];
          for (let i = 0; i < 16; i += 2) s.add('pluck', bar, i / 4, { n: ns[[0, 1, 2, 1][(i / 2) % 4]] + 12, vel: 0.22, dec: 0.18, cut: 1200 });
        }
        motif(s, 'lead', 8, { shift: -12, vel: 0.75, o: { cut: 2300 } });
        s.pat('kick', 12, 'x...............', { vel: 0.8 });
        s.pat('kick', 13, 'x...............', { vel: 0.7 });
        motif(s, 'lead', 12, { shift: -12, vel: 0.45, bars: [2, 3], o: { cut: 1500, drive: 1.6 } });
        motif(s, 'pluck', 14, { vel: 0.4, bars: [2, 3], o: { dec: 0.4, cut: 1100 } });
        s.pat('tom', 15, '........x.x.x.x.', { vel: 0.55 }, i => ({ n: 50 - i / 2 }));
      },
    },
  },

  // Lobby and vote: brighter and bouncier, the motif's opening on a bell at the end of each phrase.
  lobby: {
    bpm: 112, bars: 8, loop: true, seed: 23, peak: { main: 0.55 }, verb: { main: 0.22 },
    stems: {
      main: s => {
        const prog = ['Dm', 'Bb', 'F', 'C'];
        for (let bar = 0; bar < 8; bar++) {
          const ch = prog[bar % 4], r = ROOT[ch] + (ROOT[ch] < 36 ? 12 : 0);
          s.add('pad', bar, 0, { ns: CH[ch], len: 4, vel: 0.5, cut: 1100, att: 0.2 });
          s.add('bass', bar, 0, { n: r, len: 0.3, vel: 0.7, cut: 300 });
          for (let b = 0; b < 4; b++) s.add('bass', bar, b + 0.5, { n: r + 12, len: 0.3, vel: 0.75, cut: 600 });
          s.pat('kick', bar, bar % 4 === 3 ? 'x.......x.....x.' : 'x.......x.......', { vel: 0.85 });
          s.pat('snare', bar, '....o.......o...', { vel: 0.6, tone: 3200 });
          s.pat('hat', bar, '-.x.-.x.-.x.-.x-', { vel: 0.7 });
          const arp = [0, 1, 2, 1, 2, 1, 0, 1];
          for (let i = 0; i < 16; i++) s.add('pluck', bar, i / 4, { n: CH[ch][arp[i % 8]] + 12, vel: i % 4 === 0 ? 0.3 : 0.18, dec: 0.15, cut: 1300 });
          if (bar % 4 === 3) joints(s, bar, 0.35, 470);
        }
        for (const b of [3, 7]) {
          [[0, 74], [1, 69], [1.5, 72], [2, b === 3 ? 74 : 77]].forEach(([beat, n]) => s.add('bell', b, beat, { n, vel: 0.5, dec: 0.7 }));
        }
      },
    },
  },

  // Match underscore: sparse, dark and low-passed, so it sits under gunfire instead of on top of it.
  match: {
    bpm: 88, bars: 8, loop: true, seed: 37, peak: { main: 0.4 }, verb: { main: 0.35 },
    stems: {
      main: s => {
        const prog = ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A'];
        for (let bar = 0; bar < 8; bar++) {
          const ch = prog[bar];
          s.add('pad', bar, 0, { ns: CH[ch], len: 4, vel: 0.55, cut: 650, att: 1.2, rel: 1.6 });
          s.add('bass', bar, 0, { n: ROOT[ch], len: 3, vel: 0.5, cut: 200, env: 300 });
          s.pat('hat', bar, '-...-...-...-...', { vel: 0.5, tone: 7500 });
          if (bar % 2 === 0) joints(s, bar, 0.3, 380);
        }
        [[1, 2.5, 81], [3, 1, 86], [5, 3, 84], [7, 0.5, 85]].forEach(([bar, beat, n]) => s.add('pluck', bar, beat, { n, vel: 0.35, dec: 0.5, cut: 1100, send: 0.8 }));
      },
    },
  },

  // Layers over the underscore: four bars each at its tempo, so they lock to its clock.
  // Last minute: a sixteenth pulse with a semitone rub, four on the floor, a tom fill.
  last: {
    bpm: 88, bars: 4, loop: true, seed: 41, peak: { main: 0.45 }, verb: { main: 0.15 },
    stems: {
      main: s => {
        const line = [38, 38, 50, 38, 38, 38, 50, 38, 38, 38, 50, 38, 39, 38, 51, 38];
        for (let bar = 0; bar < 4; bar++) {
          line.forEach((n, i) => s.add('bass', bar, i / 4, { n, len: 0.2, vel: i % 4 === 0 ? 0.9 : 0.6, cut: 380, env: 1400, fdec: 0.05 }));
          s.pat('kick', bar, 'x...x...x...x...', { vel: 0.85 });
          s.pat('snare', bar, bar === 3 ? '....x.......x.xx' : '....x.......x...', { vel: 0.7 });
          s.pat('hat', bar, 'xoxoxoxoxoxoxoxo', { vel: 0.5 });
          if (bar % 2 === 0) s.add('pluck', bar, 0, { n: 62, vel: 0.3, dec: 0.5, cut: 900 }).add('pluck', bar, 0, { n: 63, vel: 0.25, dec: 0.5, cut: 900 });
        }
        s.pat('tom', 3, '........x.x.x.x.', { vel: 0.5 }, i => ({ n: 52 - i / 2 }));
      },
    },
  },

  // Final circle (battle royale): tremolo strings on the theme's chords, toms, a boom on the one.
  circle: {
    bpm: 88, bars: 4, loop: true, seed: 43, peak: { main: 0.55 }, verb: { main: 0.3 },
    stems: {
      main: s => {
        for (let bar = 0; bar < 4; bar++) {
          s.add('pad', bar, 0, { ns: CH[PROG[bar]].map(n => n + 12), len: 4, vel: 0.7, cut: 2200, att: 0.15, rel: 0.5, trem: 88 / 60 * 4 });
          s.pat('tom', bar, 'x..x..x...x.x...', { vel: 0.6 }, i => ({ n: i < 8 ? 43 : 45 }));
          s.add('bass', bar, 0, { n: ROOT[PROG[bar]], len: 3.5, vel: 0.55, cut: 240, env: 400 });
        }
        s.add('hit', 0, 0, { vel: 0.5 });
      },
    },
  },

  // Exfil called (extraction): a ticking clock, a gated low pulse and slow semitone swells, rising into the loop.
  exfil: {
    bpm: 88, bars: 4, loop: true, seed: 47, peak: { main: 0.45 }, verb: { main: 0.25 },
    stems: {
      main: s => {
        const roots = [38, 38, 41, 40], swell = [74, 75, 74, 73];
        for (let bar = 0; bar < 4; bar++) {
          s.pat('hat', bar, 'x.o.x.o.x.o.x.o.', { vel: 0.55, tone: 8000 });
          for (let i = 0; i < 8; i++) s.add('bass', bar, i / 2, { n: roots[bar], len: 0.32, vel: i % 2 ? 0.55 : 0.8, cut: 300, env: 900 });
          s.add('lead', bar, 0, { n: swell[bar] - 12, len: 3.8, vel: 0.35, cut: 1300, drive: 1.4 });
          s.pat('kick', bar, 'x.......x.......', { vel: 0.7 });
        }
        s.add('riser', 3, 0, { len: 4, vel: 0.4, f1: 4000 });
      },
    },
  },

  // Battle royale flight and drop: four on the floor, octave bass, wind, and the theme on the lead.
  brdrop: {
    bpm: 124, bars: 8, loop: true, seed: 53, peak: { main: 0.5 }, verb: { main: 0.25 },
    stems: {
      main: s => {
        for (let bar = 0; bar < 8; bar++) {
          const ch = PROG[bar % 4], r = ROOT[ch] + 12;
          s.add('pad', bar, 0, { ns: CH[ch], len: 4, vel: 0.65, cut: 2000, att: 0.3 });
          s.pat('kick', bar, 'x...x...x...x...', { vel: 0.9 });
          s.pat('snare', bar, '....x.......x...', { vel: 0.65, tone: 3000 });
          s.pat('hat', bar, '-.x.-.x.-.x.-.x.', { vel: 0.6 }, i => ({ open: i % 4 === 2 }));
          for (let i = 0; i < 8; i++) s.add('bass', bar, i / 2, { n: r - 12 + (i % 2 ? 12 : 0), len: 0.4, vel: 0.75, cut: 500 });
        }
        s.add('wind', 0, 0, { len: 16, vel: 0.5 });
        s.add('wind', 4, 0, { len: 16, vel: 0.5 });
        motif(s, 'pluck', 0, { vel: 0.5, o: { dec: 0.3, cut: 1600 } });
        motif(s, 'lead', 4, { shift: -12, vel: 0.65, o: { cut: 2600 } });
        s.add('crash', 0, 0, { vel: 0.5 });
      },
    },
  },

  // ---- One-shots. ----
  // Match intro: a riser into a hit and the motif's head, stated big.
  intro: {
    bpm: 110, bars: 2, loop: false, tail: 2, seed: 61, peak: { main: 0.7 }, verb: { main: 0.3 },
    stems: {
      main: s => {
        s.add('riser', 0, 0, { len: 4, vel: 0.7 });
        s.add('hit', 1, 0, { vel: 0.9 });
        s.add('pad', 1, 0, { ns: [50, 57, 62, 65], len: 3, vel: 0.9, att: 0.02, rel: 1.6, cut: 1800 });
        s.add('bass', 1, 0, { n: 26, len: 3, vel: 0.9, cut: 300 });
        [[0, 74, 0.5], [0.5, 69, 0.5], [1, 72, 0.5], [1.5, 74, 2.5]].forEach(([b, n, len]) => s.add('lead', 1, b, { n: n - 12, len, vel: 0.8, cut: 2800 }));
      },
    },
  },

  // Victory: a snare roll into the motif turned major, landing on a held D major chord with a bell.
  victory: {
    bpm: 104, bars: 3, loop: false, tail: 2.5, seed: 67, peak: { main: 0.72 }, verb: { main: 0.3 },
    stems: {
      main: s => {
        for (let i = 0; i < 16; i++) s.add('snare', 0, i / 4, { vel: 0.25 + 0.6 * i / 16 });
        s.add('riser', 0, 0, { len: 4, vel: 0.4 });
        s.add('hit', 1, 0, { vel: 0.85 });
        s.add('pad', 1, 0, { ns: CH.D, len: 4, vel: 0.85, att: 0.05, cut: 2200 });
        s.add('pad', 2, 0, { ns: CH.G, len: 2, vel: 0.85, att: 0.05, cut: 2200 });
        s.add('pad', 2, 2, { ns: [57, 62, 66, 69], len: 6, vel: 0.9, att: 0.05, rel: 2, cut: 2400 });
        s.add('bass', 1, 0, { n: 38, len: 3.8, vel: 0.8 }).add('bass', 2, 0, { n: 31, len: 1.9, vel: 0.8 }).add('bass', 2, 2, { n: 38, len: 5, vel: 0.85 });
        const line = [[1, 0, 74, 0.5], [1, 0.5, 69, 0.5], [1, 1, 73, 0.5], [1, 1.5, 74, 0.5], [1, 2, 78, 1], [1, 3, 76, 1],
          [2, 0, 74, 1], [2, 1, 78, 0.5], [2, 1.5, 79, 0.5], [2, 2, 81, 4]];
        let prev = 74;
        for (const [bar, beat, n, len] of line) { s.add('lead', bar, beat, { n: n - 12, len, vel: 0.8, cut: 3000, from: prev - 12 }); prev = n; }
        s.pat('kick', 1, 'x.......x.......');
        s.add('kick', 2, 0).add('crash', 2, 2, { vel: 0.8 }).add('kick', 2, 2);
        s.add('bell', 2, 2, { n: 86, vel: 0.6, dec: 1.4 });
      },
    },
  },

  // Defeat: the motif slowed and sinking, the filter closing, a low toll at the end.
  defeat: {
    bpm: 76, bars: 3, loop: false, tail: 2.5, seed: 71, peak: { main: 0.65 }, verb: { main: 0.4 },
    stems: {
      main: s => {
        s.add('pad', 0, 0, { ns: CH.Dm, len: 4, vel: 0.75, att: 0.1, cut: 1200 });
        s.add('pad', 1, 0, { ns: CH.Bb, len: 4, vel: 0.7, cut: 900 });
        s.add('pad', 2, 0, { ns: [50, 57, 62], len: 6, vel: 0.75, rel: 2, cut: 600 });
        s.add('bass', 0, 0, { n: 38, len: 3.8, vel: 0.6, cut: 250 }).add('bass', 1, 0, { n: 34, len: 3.8, vel: 0.6, cut: 230 }).add('bass', 2, 0, { n: 26, len: 6, vel: 0.75, cut: 180 });
        [[0, 0, 74, 1], [0, 1, 69, 1], [0, 2, 72, 0.5], [0, 2.5, 70, 1.5], [1, 0, 69, 1], [1, 1, 65, 1], [1, 2, 62, 2]]
          .forEach(([bar, beat, n, len]) => s.add('pluck', bar, beat, { n, vel: 0.6, dec: 0.6, cut: 1000 - bar * 300 }));
        s.add('hit', 2, 0, { vel: 0.45 });
        s.add('clank', 2, 2, { vel: 0.3, f: 300 });
      },
    },
  },

  // Interface stingers, in the same key as the interface sounds they sit with.
  levelUp: {
    bpm: 140, bars: 1, loop: false, tail: 1.2, seed: 73, peak: { main: 0.55 }, verb: { main: 0.3 },
    stems: {
      main: s => {
        [62, 66, 69, 74, 78, 81].forEach((n, i) => s.add('pluck', 0, i / 4, { n, vel: 0.5 + i * 0.06, dec: 0.25, cut: 1800 }));
        s.add('bell', 0, 1.5, { n: 86, vel: 0.7, dec: 0.9 });
        s.add('pad', 0, 0, { ns: CH.D.map(n => n + 12), len: 2, vel: 0.5, att: 0.1, rel: 0.9, cut: 2600 });
      },
    },
  },
  unlock: {
    bpm: 130, bars: 1, loop: false, tail: 0.6, seed: 79, peak: { main: 0.5 }, verb: { main: 0.35 },
    stems: {
      main: s => {
        s.add('bell', 0, 0, { n: 81, vel: 0.6, dec: 0.5 }).add('bell', 0, 0.5, { n: 86, vel: 0.75, dec: 0.8 });
        s.add('pluck', 0, 0.5, { n: 74, vel: 0.35, dec: 0.4, cut: 1600 });
      },
    },
  },
  prestige: {
    bpm: 100, bars: 2, loop: false, tail: 2.5, seed: 83, peak: { main: 0.7 }, verb: { main: 0.35 },
    stems: {
      main: s => {
        s.add('riser', 0, 0, { len: 4, vel: 0.6 });
        s.add('hit', 1, 0, { vel: 0.8 });
        s.add('pad', 1, 0, { ns: [57, 62, 66, 69], len: 4, vel: 0.9, att: 0.05, rel: 2, cut: 2400 });
        s.add('bass', 1, 0, { n: 38, len: 4, vel: 0.8 });
        [[0, 74], [0.5, 81], [1, 86], [1.5, 90]].forEach(([b, n]) => s.add('bell', 1, b, { n, vel: 0.65, dec: 1.2 }));
        s.add('lead', 1, 2, { n: 62, len: 2, vel: 0.55, cut: 2600, from: 57 });
      },
    },
  },
};

// Order to build in: the title first (the player is there when audio unlocks), stingers next, match family last.
export const BUILD_ORDER = ['menu', 'lobby', 'levelUp', 'unlock', 'prestige', 'victory', 'defeat', 'intro', 'brdrop', 'match', 'last', 'circle', 'exfil'];

// Loop length in samples (one-shots: plus tail).
export function trackLength(def, sr = MUSIC_RATE) {
  const n = Math.round(def.bars * 4 * (60 / def.bpm) * sr);
  return def.loop ? n : n + Math.round((def.tail ?? 2) * sr);
}

const SLICE = 6000;       // Samples of effect processing between yields.

// Reverb on the send: six damped combs (two passes round a loop, so the tail wraps), and a dotted-eighth echo.
function* reverb(c, wet, spb) {
  const { n, loop, sr, w, d } = c;
  const out = new Float32Array(n), y = new Float32Array(n);
  const passes = loop ? 2 : 1;
  for (const ms of [31.1, 36.7, 41.3, 44.9, 50.3, 56.9]) {
    const D = Math.round(ms * sr / 1000), fb = 0.83, damp = 0.35;
    let lp = 0;
    y.fill(0);
    yield;
    for (let i = 0; i < n * passes; i += SLICE) {
      const end = Math.min(i + SLICE, n * passes);
      for (let k = i; k < end; k++) {
        const j = k % n;
        let jd = j - D;
        if (jd < 0) { if (!loop) { y[j] = w[j]; continue; } jd += n; }
        lp = y[jd] * (1 - damp) + lp * damp;
        y[j] = w[j] + fb * lp;
      }
      yield;
    }
    for (let j = 0; j < n; j++) out[j] += y[j];
    yield;
  }
  const echo = Math.round(spb * 0.75 * sr);
  for (let j = 0; j < n; j++) {
    let e = 0, a = j - echo, b = j - 2 * echo;
    if (a < 0) a = loop ? a + n : -1;
    if (b < 0) b = loop ? ((b % n) + n) % n : -1;
    if (a >= 0) e += w[a] * 0.32;
    if (b >= 0) e += w[b] * 0.14;
    d[j] += out[j] * wet * 0.12 + e * wet;
    if (j % SLICE === 0) yield;
  }
  yield;
}

// DC and rumble out (a one-pole high-pass, twice round a loop), then normalise to the stem's peak.
function* finish(c, peak) {
  const { n, loop, sr, d } = c;
  const a = Math.exp(-TAU * 28 / sr);
  let px = 0, py = 0;
  const passes = loop ? 2 : 1;
  const tmp = loop ? new Float32Array(d) : d;
  for (let k = 0; k < n * passes; k++) {
    const j = k % n, x = tmp[j];
    py = a * (py + x - px); px = x;
    d[j] = py;
    if (k % (SLICE * 4) === 0) yield;
  }
  yield;
  if (!loop) {
    const fade = Math.min(n, Math.round(0.4 * sr));
    for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
  }
  let m = 0;
  for (let i = 0; i < n; i++) { const v = Math.abs(d[i]); if (v > m) m = v; }
  yield;
  if (m > 0) { const g = peak / m; for (let i = 0; i < n; i++) d[i] *= g; }
}

// Renders one track: { stemName: Float32Array }. A generator: each yield is a safe place to pause.
export function* renderTrack(def, sr = MUSIC_RATE) {
  const n = trackLength(def, sr), out = {};
  let seed = def.seed ?? 1;
  for (const [stem, compose] of Object.entries(def.stems)) {
    const s = new Score(def.bpm);
    compose(s);
    s.ev.sort((a, b) => a.t - b.t);
    const c = new Canvas(n, def.loop, sr, seed++);
    yield;
    for (const e of s.ev) {
      c.send = e.send ?? SEND[e.k];
      const r = INSTR[e.k](c, e);
      if (r && r.next) yield* r;
      yield;
    }
    yield* reverb(c, def.verb?.[stem] ?? 0.25, s.spb);
    yield* finish(c, def.peak?.[stem] ?? 0.5);
    out[stem] = c.d;
  }
  return out;
}

// Runs a render to the end in one go (tests and the WAV export).
export function renderNow(def, sr = MUSIC_RATE) {
  const it = renderTrack(def, sr);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
