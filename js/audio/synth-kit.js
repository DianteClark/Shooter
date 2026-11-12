// Small offline synthesis kit for the event-sound modules (fin-sfx.js, zm-sfx.js): fill a Float32Array with noise
// bands, tones and clicks, normalise it, and bake a table of recipes into AudioBuffers a few at a time (or all at once
// for an offline engine), the way br-sfx.js does with its own copy.
export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Low-passed noise sweeping f0 -> f1 Hz. `hp` subtracts a slower copy, leaving a band.
export function noise(d, sr, r, { at = 0, dur, gain, f0 = 4000, f1 = f0, decay = 5, attack = 0.002, hp = 0 }) {
  const n0 = Math.floor(at * sr), n = Math.min(d.length - n0, Math.floor(dur * sr));
  let lp = 0, lp2 = 0;
  const ha = hp ? Math.min(1, hp / sr * 6.28) : 0;
  for (let i = 0; i < n; i++) {
    const u = i / n, f = f0 + (f1 - f0) * u, a = Math.min(1, f / sr * 6.28);
    lp += (r() * 2 - 1 - lp) * a;
    lp2 += (lp - lp2) * ha;
    d[n0 + i] += (hp ? lp - lp2 : lp) * gain * Math.min(1, i / sr / attack) * Math.exp(-decay * u);
  }
}

// A tone gliding f0 -> f1 Hz; `square` drives it toward a square, `vib` [rate Hz, depth 0..1] wobbles the pitch.
export function tone(d, sr, { at = 0, dur, gain, f0, f1 = f0, decay = 5, attack = 0.003, square = 0, vib = null }) {
  const n0 = Math.floor(at * sr), n = Math.min(d.length - n0, Math.floor(dur * sr));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n, t = i / sr;
    const w = vib ? 1 + Math.sin(t * vib[0] * 6.283) * vib[1] : 1;
    ph += (f0 + (f1 - f0) * u) * w / sr * 6.283;
    let v = Math.sin(ph);
    if (square) v = Math.max(-1, Math.min(1, v * (1 + square * 4)));
    d[n0 + i] += v * gain * Math.min(1, t / attack) * Math.exp(-decay * u);
  }
}

export function click(d, sr, r, at, gain, len = 80) {
  const n0 = Math.floor(at * sr);
  for (let i = 0; i < Math.min(len, d.length - n0); i++) d[n0 + i] += (r() * 2 - 1) * gain * Math.exp(-i / (len / 8));
}

export function normalize(d, peak) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

// recipes: { name: [seconds, fill(d, sr, r), peak] }. Fills `into` with buffers as they are baked.
export function bake(engine, recipes, seed, into) {
  const ctx = engine.ctx, sr = ctx?.sampleRate || 44100, names = Object.keys(recipes);
  let i = 0;
  const next = () => {
    if (i >= names.length || !engine.ctx) return;
    const name = names[i], [dur, fill, peak] = recipes[name], d = new Float32Array(Math.floor(dur * sr));
    fill(d, sr, rng(seed + i++));
    into[name] = engine._toBuffer(normalize(d, peak));
    if (!engine.offline) setTimeout(next, 0);
  };
  if (engine.offline) while (i < names.length) next(); else setTimeout(next, 0);
  return into;
}
