// Gear wave sounds (2026-11): everything the ten new tacticals and lethals, and the reworked old ones, say. Kept out of
// audio.js, which the weapon-feel engineer owns; AudioEngine makes one of these once it is ready and hands it every
// event batch (two hook lines). Synthesised like the rest: a few noise and tone layers baked once into AudioBuffers,
// played through the engine's own _world/_play so they share its mixer, voice cap, distance roll-off and mic ducking.
//
// What each says, and why it reads:
//   Satchel   a two-tone arming chirp when it lands, and a detonator click in the owner's ear before the boom.
//   Thermite  a hard ignition fizz, then a long sizzle: a lit doorway you can hear round a corner.
//   Tripwire  a rising arming whine. Crawler: a servo chitter as it goes. Shiv: a whoosh out, a thunk in, a clink back.
//   Snapshot  a camera shutter and a flash whine. Blackout: a falling electric zap; jammed, a burst of static.
//   Bulwark   a heavy deploy clunk; a metal crash when it breaks. Shot devices: a short crunch and spark.
//   Tagger    a dart thunk and, for its victim, a tracking beep. Medpack: a soft two-note chime on your own heals.
//   Sticky    stuck to you: a fast alarm, so a player knows before the blast what the magenta ring means.

const PR = { boom: 4, ui: 3, world: 2, gun: 1 };     // Same scale as audio.js PR.
const HEAR = 58;                                      // audio.js HEAR_RANGE: explosions.

// ---- Tiny deterministic synth (the same idea as audio.js's helpers, kept local) ----
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function noise(d, sr, r, { at = 0, dur, gain, f0 = 4000, f1 = f0, decay = 5, hp = 0 }) {
  const n0 = Math.floor(at * sr), n = Math.min(d.length - n0, Math.floor(dur * sr));
  let lp = 0, prev = 0, hpo = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n, f = f0 + (f1 - f0) * u, a = Math.min(1, f / sr * 6.28);
    lp += (r() * 2 - 1 - lp) * a;
    let v = lp;
    if (hp) { const k = Math.min(1, hp / sr * 6.28); hpo = (hpo + v - prev) * (1 - k); prev = v; v = hpo; }
    d[n0 + i] += v * gain * Math.exp(-decay * u);
  }
}
function tone(d, sr, { at = 0, dur, gain, f0, f1 = f0, decay = 5, attack = 0.002, square = 0 }) {
  const n0 = Math.floor(at * sr), n = Math.min(d.length - n0, Math.floor(dur * sr));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n, t = i / sr;
    ph += (f0 + (f1 - f0) * u) / sr * 6.283;
    let v = Math.sin(ph);
    if (square) v = Math.max(-1, Math.min(1, v * (1 + square * 4)));
    d[n0 + i] += v * gain * Math.min(1, t / attack) * Math.exp(-decay * u);
  }
}
function click(d, sr, r, at, gain) {
  const n0 = Math.floor(at * sr);
  for (let i = 0; i < Math.min(60, d.length - n0); i++) d[n0 + i] += (r() * 2 - 1) * gain * Math.exp(-i / 9);
}
function normalize(d, peak) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

const RECIPES = {
  arm: [0.32, (d, sr) => { tone(d, sr, { dur: 0.09, gain: 1, f0: 1500, decay: 2, square: 0.5 }); tone(d, sr, { at: 0.13, dur: 0.12, gain: 1, f0: 2100, decay: 2, square: 0.5 }); }, 0.5],
  detonator: [0.12, (d, sr, r) => { click(d, sr, r, 0, 1); tone(d, sr, { dur: 0.08, gain: 0.7, f0: 2600, f1: 1800, decay: 6, square: 0.6 }); }, 0.7],
  igniteFizz: [0.6, (d, sr, r) => { click(d, sr, r, 0, 0.8); noise(d, sr, r, { dur: 0.55, gain: 1, f0: 9000, f1: 3500, decay: 3, hp: 1500 }); }, 0.85],
  sizzle: [3.2, (d, sr, r) => { noise(d, sr, r, { dur: 3.2, gain: 0.7, f0: 7000, f1: 5000, decay: 1.4, hp: 2200 }); for (let i = 0; i < 26; i++) click(d, sr, r, 0.05 + r() * 3, 0.35 * r()); }, 0.55],
  armWhine: [1.2, (d, sr) => { tone(d, sr, { dur: 1.15, gain: 0.8, f0: 600, f1: 2400, decay: 0.6, attack: 0.05 }); tone(d, sr, { at: 1.08, dur: 0.1, gain: 1, f0: 2600, decay: 3, square: 0.5 }); }, 0.45],
  chitter: [1.4, (d, sr, r) => { for (let i = 0; i < 22; i++) { const at = i * 0.06; tone(d, sr, { at, dur: 0.04, gain: 0.6, f0: 900 + r() * 500, f1: 600, decay: 6, square: 0.4 }); click(d, sr, r, at, 0.4); } }, 0.5],
  whoosh: [0.28, (d, sr, r) => { noise(d, sr, r, { dur: 0.26, gain: 1, f0: 1500, f1: 5000, decay: 2.5, hp: 800 }); }, 0.6],
  thunk: [0.18, (d, sr, r) => { click(d, sr, r, 0, 1); tone(d, sr, { dur: 0.15, gain: 1, f0: 240, f1: 120, decay: 6 }); noise(d, sr, r, { dur: 0.06, gain: 0.5, f0: 3000, decay: 8 }); }, 0.75],
  clink: [0.3, (d, sr) => { tone(d, sr, { dur: 0.28, gain: 0.8, f0: 3100, decay: 7 }); tone(d, sr, { dur: 0.22, gain: 0.5, f0: 4700, decay: 9 }); }, 0.5],
  shutter: [0.7, (d, sr, r) => { click(d, sr, r, 0, 1); click(d, sr, r, 0.05, 0.8); noise(d, sr, r, { at: 0.06, dur: 0.12, gain: 0.6, f0: 6000, decay: 6, hp: 2000 }); tone(d, sr, { at: 0.08, dur: 0.6, gain: 0.45, f0: 2200, f1: 7000, decay: 2.5, attack: 0.02 }); }, 0.7],
  empZap: [0.9, (d, sr, r) => { click(d, sr, r, 0, 1); tone(d, sr, { dur: 0.8, gain: 1, f0: 1800, f1: 70, decay: 2.2, square: 0.7 }); noise(d, sr, r, { dur: 0.5, gain: 0.7, f0: 8000, f1: 1500, decay: 3, hp: 1200 }); }, 0.9],
  static: [0.7, (d, sr, r) => { noise(d, sr, r, { dur: 0.7, gain: 1, f0: 9000, decay: 2, hp: 2500 }); for (let i = 0; i < 12; i++) click(d, sr, r, r() * 0.6, 0.6); }, 0.5],
  clunk: [0.45, (d, sr, r) => { click(d, sr, r, 0, 1); tone(d, sr, { dur: 0.35, gain: 1, f0: 150, f1: 70, decay: 5 }); tone(d, sr, { at: 0.02, dur: 0.3, gain: 0.5, f0: 880, decay: 9 }); tone(d, sr, { at: 0.12, dur: 0.25, gain: 0.35, f0: 1320, decay: 10 }); }, 0.85],
  crash: [0.8, (d, sr, r) => { click(d, sr, r, 0, 1); noise(d, sr, r, { dur: 0.7, gain: 1, f0: 4000, f1: 900, decay: 3 }); for (let i = 0; i < 6; i++) tone(d, sr, { at: r() * 0.4, dur: 0.3, gain: 0.4, f0: 700 + r() * 2000, decay: 8 }); }, 0.85],
  crunch: [0.25, (d, sr, r) => { click(d, sr, r, 0, 1); noise(d, sr, r, { dur: 0.22, gain: 0.9, f0: 6000, f1: 1500, decay: 5, hp: 600 }); tone(d, sr, { dur: 0.12, gain: 0.4, f0: 1900, decay: 8 }); }, 0.7],
  track: [0.5, (d, sr) => { for (let i = 0; i < 3; i++) tone(d, sr, { at: i * 0.15, dur: 0.07, gain: 1, f0: 3000, decay: 3, square: 0.3 }); }, 0.45],
  chime: [0.5, (d, sr) => { tone(d, sr, { dur: 0.3, gain: 0.8, f0: 880, decay: 4, attack: 0.01 }); tone(d, sr, { at: 0.12, dur: 0.35, gain: 0.7, f0: 1320, decay: 4, attack: 0.01 }); }, 0.35],
  alarm: [0.9, (d, sr) => { for (let i = 0; i < 6; i++) tone(d, sr, { at: i * 0.14, dur: 0.08, gain: 1, f0: i % 2 ? 2400 : 3200, decay: 1.5, square: 0.6 }); }, 0.6],
};

export class EquipmentSfx {
  constructor(engine) {
    this.e = engine;
    this.b = {};
    this.chimeAt = -9; this.alarmAt = -9;
    // Baked one buffer per macrotask, so starting a match never stalls a frame; a sound not baked yet is skipped.
    const ctx = engine.ctx, sr = ctx.sampleRate || 44100, names = Object.keys(RECIPES);
    let i = 0;
    const next = () => {
      if (i >= names.length || !engine.ctx) return;
      const name = names[i], [dur, fill, peak] = RECIPES[name], d = new Float32Array(Math.floor(dur * sr));
      fill(d, sr, rng(11 + i++));
      this.b[name] = engine._toBuffer(normalize(d, peak));
      setTimeout(next, 0);
    };
    if (engine.offline) while (i < names.length) next(); else setTimeout(next, 0);
  }

  #world(name, x, z, range, gain = 1, priority = PR.world, rate = 1) {
    if (!Number.isFinite(x) || !this.b[name]) return;
    this.e._world(this.b[name], x, z, range, { gain, priority, rate, cls: priority >= PR.boom ? 'boom' : 'world' });
  }
  #ui(name, gain = 0.8) { if (this.b[name]) this.e._play(this.b[name], { bus: this.e.ui, priority: PR.ui, cls: 'ui', gain }); }

  onEvents(events, view) {
    const me = view?.localId, now = this.e.ctx?.currentTime ?? 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.t) {
        case 'throw':
          if (e.kind === 'charge') this.#world('arm', e.ox, e.oz, 16, 0.6);
          else if (e.kind === 'tripwire') this.#world('armWhine', e.ox, e.oz, 16, 0.7);
          else if (e.kind === 'crawler') this.#world('chitter', e.ox, e.oz, 22, 0.8);
          else if (e.kind === 'shiv' || e.kind === 'tagger') this.#world('whoosh', e.ox, e.oz, 16, 0.8);
          else if (e.kind === 'bulwark') this.#world('clunk', e.ox, e.oz, 26, 0.9);
          else if (e.kind === 'medpack') this.#world('clink', e.ox, e.oz, 14, 0.6);
          break;
        case 'bang':
          if (e.kind === 'charge' && e.by === me) this.#ui('detonator', 0.7);
          break;
        case 'gear':
          if (e.kind === 'thermite') { this.#world('igniteFizz', e.x, e.z, 34, 1.2, PR.boom); this.#world('sizzle', e.x, e.z, 26, 0.9); }
          else if (e.kind === 'blackout') this.#world('empZap', e.x, e.z, HEAR, 1.4, PR.boom);
          break;
        case 'pulse': if (e.kind === 'snapshot') this.#world('shutter', e.x, e.z, 34, 1.1, PR.boom); break;
        case 'jammed': if (e.id === me) this.#ui('static', 0.8); break;
        case 'stuck':
          if (e.id === me) {
            if (now - this.alarmAt > 0.6) { this.alarmAt = now; this.#ui(e.kind === 'tagger' ? 'track' : 'alarm', 0.9); }
          } else { const p = this.e._posOf?.(view, e.id); if (p) this.#world('thunk', p.x, p.z, 18, 0.8); }
          break;
        case 'hit': if (e.eq === 'shiv' && Number.isFinite(e.x)) this.#world('thunk', e.x, e.z, 18, 1); break;
        case 'pickup': if (e.id === me) this.#ui('clink', 0.6); break;
        case 'popped': this.#world(e.kind === 'bulwark' ? 'crash' : 'crunch', e.x, e.z, 26, 1, PR.world); break;
        case 'heal':
          if (e.kind === 'medpack' && e.id === me && now - this.chimeAt > 1.6) { this.chimeAt = now; this.#ui('chime', 0.45); }
          break;
        default: break;
      }
    }
  }
}
