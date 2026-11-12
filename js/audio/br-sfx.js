// Battle royale sounds (docs/BR.md), kept out of audio.js: AudioEngine makes one of these the first time an event batch
// carries a battle royale view and hands it every batch (one hook line), like StreaksSfx. Synthesised and baked once
// into AudioBuffers, played through the engine's own _world/_play so they share its mixer, voice cap and ducking.
//   transport   a low prop drone while you are aboard, repeated as a loop of short buffers
//   jump        a rush of wind; landing a soft thud
//   chest       a latch and a rising chime
//   plate       a zip and a hard clack per plate; the last plate breaking a crunch
//   down        a falling two-tone alarm for your squad, a thump for the enemy you downed
//   revive      a rising three-note chime
//   recall      a Recall Beacon in use: a rising two-tone siren repeated from the beacon, heard far (it gives the user away);
//               a tag picked up a short chirp; a recall done a bright rising sweep
//   circle      a warning sweep when it starts to close; a low hum while you are outside it
const PR = { boom: 4, ui: 3, world: 2, gun: 1 };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function noise(d, sr, r, { at = 0, dur, gain, f0 = 4000, f1 = f0, decay = 5 }) {
  const n0 = Math.floor(at * sr), n = Math.min(d.length - n0, Math.floor(dur * sr));
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n, f = f0 + (f1 - f0) * u, a = Math.min(1, f / sr * 6.28);
    lp += (r() * 2 - 1 - lp) * a;
    d[n0 + i] += lp * gain * Math.exp(-decay * u);
  }
}
function tone(d, sr, { at = 0, dur, gain, f0, f1 = f0, decay = 5, attack = 0.003, square = 0 }) {
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
  for (let i = 0; i < Math.min(80, d.length - n0); i++) d[n0 + i] += (r() * 2 - 1) * gain * Math.exp(-i / 10);
}
function normalize(d, peak) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

const RECIPES = {
  drone: [1.2, (d, sr, r) => { tone(d, sr, { dur: 1.2, gain: 0.8, f0: 74, decay: 0, attack: 0.05, square: 0.35 }); tone(d, sr, { dur: 1.2, gain: 0.35, f0: 148, decay: 0, attack: 0.05 }); noise(d, sr, r, { dur: 1.2, gain: 0.5, f0: 420, decay: 0 }); }, 0.5],
  jump: [1.1, (d, sr, r) => { noise(d, sr, r, { dur: 1.1, gain: 1, f0: 600, f1: 2600, decay: 2.2 }); tone(d, sr, { dur: 0.6, gain: 0.3, f0: 300, f1: 120, decay: 3 }); }, 0.7],
  land: [0.5, (d, sr, r) => { click(d, sr, r, 0, 0.8); tone(d, sr, { dur: 0.45, gain: 1, f0: 85, f1: 40, decay: 5 }); noise(d, sr, r, { dur: 0.3, gain: 0.6, f0: 900, decay: 6 }); }, 0.75],
  chest: [0.9, (d, sr, r) => { click(d, sr, r, 0, 1); click(d, sr, r, 0.07, 0.7); tone(d, sr, { at: 0.1, dur: 0.35, gain: 0.6, f0: 660, decay: 4, attack: 0.01 }); tone(d, sr, { at: 0.22, dur: 0.4, gain: 0.6, f0: 990, decay: 4, attack: 0.01 }); tone(d, sr, { at: 0.34, dur: 0.5, gain: 0.6, f0: 1320, decay: 3.5, attack: 0.01 }); }, 0.65],
  plate: [0.55, (d, sr, r) => { noise(d, sr, r, { dur: 0.28, gain: 0.7, f0: 2500, f1: 6000, decay: 2 }); click(d, sr, r, 0.32, 1); tone(d, sr, { at: 0.32, dur: 0.2, gain: 0.8, f0: 380, decay: 8 }); tone(d, sr, { at: 0.32, dur: 0.18, gain: 0.5, f0: 1150, decay: 9 }); }, 0.6],
  crunch: [0.45, (d, sr, r) => { click(d, sr, r, 0, 1); noise(d, sr, r, { dur: 0.4, gain: 1, f0: 5000, f1: 900, decay: 5 }); for (let i = 0; i < 5; i++) tone(d, sr, { at: 0.02 + r() * 0.2, dur: 0.12, gain: 0.3, f0: 900 + r() * 2000, decay: 9 }); }, 0.7],
  down: [0.9, (d, sr) => { tone(d, sr, { dur: 0.35, gain: 1, f0: 880, f1: 760, decay: 1.5, square: 0.4 }); tone(d, sr, { at: 0.38, dur: 0.5, gain: 1, f0: 620, f1: 440, decay: 2, square: 0.4 }); }, 0.55],
  knock: [0.4, (d, sr, r) => { click(d, sr, r, 0, 1); tone(d, sr, { dur: 0.35, gain: 1, f0: 220, f1: 110, decay: 5 }); }, 0.6],
  revive: [0.8, (d, sr) => { [523, 659, 784].forEach((f, i) => tone(d, sr, { at: i * 0.12, dur: 0.45, gain: 0.8, f0: f, decay: 3.5, attack: 0.01 })); }, 0.55],
  closing: [1.4, (d, sr) => { tone(d, sr, { dur: 1.4, gain: 1, f0: 300, f1: 900, decay: 1.2, attack: 0.08, square: 0.2 }); tone(d, sr, { dur: 1.4, gain: 0.5, f0: 600, f1: 1800, decay: 1.4, attack: 0.08 }); }, 0.5],
  siren: [0.9, (d, sr) => { tone(d, sr, { dur: 0.42, gain: 1, f0: 620, f1: 980, decay: 0.6, attack: 0.02, square: 0.5 }); tone(d, sr, { at: 0.45, dur: 0.42, gain: 1, f0: 980, f1: 620, decay: 0.6, attack: 0.02, square: 0.5 }); }, 0.6],
  tag: [0.3, (d, sr, r) => { click(d, sr, r, 0, 0.6); tone(d, sr, { dur: 0.12, gain: 0.8, f0: 1760, decay: 5, attack: 0.002 }); tone(d, sr, { at: 0.09, dur: 0.18, gain: 0.8, f0: 2350, decay: 5, attack: 0.002 }); }, 0.55],
  recalled: [1.2, (d, sr, r) => { tone(d, sr, { dur: 1.1, gain: 0.8, f0: 300, f1: 1400, decay: 1.6, attack: 0.04 }); noise(d, sr, r, { dur: 1.1, gain: 0.4, f0: 900, f1: 5000, decay: 2.5 }); [784, 1047].forEach((f, i) => tone(d, sr, { at: 0.5 + i * 0.14, dur: 0.5, gain: 0.6, f0: f, decay: 3, attack: 0.01 })); }, 0.6],
  hum: [0.8, (d, sr, r) => { tone(d, sr, { dur: 0.8, gain: 0.9, f0: 58, decay: 0.3, attack: 0.1, square: 0.5 }); noise(d, sr, r, { dur: 0.8, gain: 0.4, f0: 1800, decay: 0.5 }); }, 0.45],
};

export class BrSfx {
  constructor(engine) {
    this.e = engine;
    this.b = {};
    this.droneAt = -9; this.humAt = -9;
    const ctx = engine.ctx, sr = ctx?.sampleRate || 44100, names = Object.keys(RECIPES);
    let i = 0;
    const next = () => {
      if (i >= names.length || !engine.ctx) return;
      const name = names[i], [dur, fill, peak] = RECIPES[name], d = new Float32Array(Math.floor(dur * sr));
      fill(d, sr, rng(171 + i++));
      this.b[name] = engine._toBuffer(normalize(d, peak));
      setTimeout(next, 0);
    };
    if (engine.offline) while (i < names.length) next(); else setTimeout(next, 0);
  }

  #world(name, x, z, range, gain = 1, priority = PR.world) {
    if (!Number.isFinite(x) || !this.b[name]) return;
    this.e._world(this.b[name], x, z, range, { gain, priority, cls: 'world' });
  }
  #ui(name, gain = 0.8, rate = 1) { if (this.b[name]) this.e._play(this.b[name], { bus: this.e.ui, priority: PR.ui, cls: 'ui', gain, rate }); }

  onEvents(events, view) {
    const me = view?.localId;
    const mine = view?.players?.find(p => p.id === me);
    const team = mine?.team;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.t) {
        case 'brjump': if (e.id === me) this.#ui('jump', 0.8); break;
        case 'brland': if (e.id === me) this.#ui('land', 0.8); else this.#world('land', e.x, e.z, 24, 0.6); break;
        case 'brchest': this.#world('chest', e.x, e.z, 26, 0.9); break;
        case 'brplate': if (e.id === me) this.#ui('plate', 0.7); break;
        case 'hit': if (e.plate === 2) { if (e.target === me) this.#ui('crunch', 0.9); else if (e.by === me) this.#ui('crunch', 0.6, 1.3); } break;
        case 'down': {
          const tgt = view?.players?.find(p => p.id === e.target);
          if (tgt && tgt.team === team) this.#ui('down', e.target === me ? 0.9 : 0.6);
          else if (e.by === me) this.#ui('knock', 0.8);
          break;
        }
        case 'revive': { const p = view?.players?.find(q => q.id === e.id); if (p && p.team === team) this.#ui('revive', e.id === me ? 0.8 : 0.5); break; }
        case 'brphase': if (e.state === 'shrink') this.#ui('closing', 0.6); break;
        case 'brtag': if (e.id === me) this.#ui('tag', 0.7); break;
        case 'brrecall':
          if (e.kind === 'start') { const bc = view?.br?.beacons?.[e.b]; this.recall = bc ? { x: bc.x, z: bc.z, b: e.b } : null; this.sirenAt = -9; }
          else if (this.recall?.b === e.b) this.recall = null;
          if (e.kind === 'done') this.#world('recalled', e.x, e.z, 90, 1, PR.ui);
          break;
        default: break;
      }
    }
    // Loops: the transport while aboard, the circle's hum while outside it, a beacon's siren while one is held.
    const now = this.e.ctx?.currentTime ?? 0, br = view?.br;
    if (this.recall && br && br.beacons?.[this.recall.b] && !br.beacons[this.recall.b].user && now - (this.sirenAt ?? -9) > 1.5) this.recall = null;
    if (this.recall && now - (this.sirenAt ?? -9) > 0.95) { this.sirenAt = now; this.#world('siren', this.recall.x, this.recall.z, 110, 0.9, PR.ui); }
    if (!br || !mine?.alive) return;
    if (mine.air === 1 && now - this.droneAt > 1.1) { this.droneAt = now; this.#ui('drone', 0.35); }
    const out = !mine.air && Math.hypot(mine.x - br.circle.x, mine.z - br.circle.z) > br.circle.r;
    if (out && now - this.humAt > 0.75) { this.humAt = now; this.#ui('hum', 0.4); }
  }
}
