// Scorestreaks overhaul sounds (V9, 2026-11). Kept out of audio.js (the weapon-feel engineer's); AudioEngine makes one
// of these once it is ready and hands it every event batch (two hook lines), like EquipmentSfx. Synthesised: a few
// noise and tone layers baked once into AudioBuffers, played through the engine's own _world/_play so they share its
// mixer, voice cap, distance roll-off and mic ducking.
//
// Warnings come first: the side a streak is aimed at hears it.
//   Enemy aircraft    a two-tone lock-on chirp when an enemy Scout or Wingman goes up (chopper and gunship already
//                     announce themselves in audio.js).
//   Carpet Line       a falling siren for the side under it, the bomber's drone for everyone.
//   Sonar Sweep       a sonar ping at each pulse, heard by both sides: you know you were swept.
//   EMP streak lock   a power-down sweep for the side that lost its streaks.
// Then feedback: a crunch and a falling whine for anything shot down, the crate's thud and latch, plates clanking on,
// the Dome's rising hum, a Rover's servo whine, a drone's buzz.

const PR = { boom: 4, ui: 3, world: 2, gun: 1 };     // Same scale as audio.js PR.
const HEAR = 58;                                      // audio.js HEAR_RANGE.

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
function tone(d, sr, { at = 0, dur, gain, f0, f1 = f0, decay = 5, attack = 0.002, square = 0, vib = 0, vibF = 6 }) {
  const n0 = Math.floor(at * sr), n = Math.min(d.length - n0, Math.floor(dur * sr));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n, t = i / sr;
    ph += (f0 + (f1 - f0) * u) * (1 + vib * Math.sin(t * vibF * 6.283)) / sr * 6.283;
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
  sonar: [1.6, (d, sr) => { for (let k = 0; k < 3; k++) tone(d, sr, { at: k * 0.32, dur: 0.9, gain: 1 / (1 + k * 1.6), f0: 1180, f1: 1150, decay: 4, attack: 0.004 }); }, 0.6],
  lockOn: [0.55, (d, sr) => { for (let i = 0; i < 4; i++) tone(d, sr, { at: i * 0.12, dur: 0.08, gain: 1, f0: i % 2 ? 1700 : 2300, decay: 1, square: 0.5 }); }, 0.55],
  siren: [1.8, (d, sr) => { tone(d, sr, { dur: 1.8, gain: 1, f0: 1300, f1: 420, decay: 1.2, attack: 0.05, vib: 0.06, vibF: 7 }); tone(d, sr, { dur: 1.8, gain: 0.4, f0: 2600, f1: 840, decay: 1.4, attack: 0.05 }); }, 0.6],
  bomberDrone: [2.6, (d, sr, r) => { tone(d, sr, { dur: 2.6, gain: 0.8, f0: 62, f1: 55, decay: 0.8, attack: 0.6, square: 0.3 }); tone(d, sr, { dur: 2.6, gain: 0.4, f0: 124, f1: 110, decay: 0.8, attack: 0.6 }); noise(d, sr, r, { dur: 2.6, gain: 0.5, f0: 500, f1: 300, decay: 0.8 }); }, 0.7],
  airDown: [1.4, (d, sr, r) => { click(d, sr, r, 0, 1); noise(d, sr, r, { dur: 0.9, gain: 1, f0: 3500, f1: 400, decay: 3.5 }); tone(d, sr, { at: 0.05, dur: 1.3, gain: 0.45, f0: 900, f1: 160, decay: 1.6, attack: 0.02 }); for (let i = 0; i < 8; i++) tone(d, sr, { at: 0.1 + r() * 0.6, dur: 0.25, gain: 0.25, f0: 600 + r() * 2200, decay: 8 }); }, 0.95],
  thud: [0.5, (d, sr, r) => { click(d, sr, r, 0, 1); tone(d, sr, { dur: 0.45, gain: 1, f0: 95, f1: 45, decay: 5 }); noise(d, sr, r, { dur: 0.3, gain: 0.5, f0: 1200, decay: 6 }); }, 0.9],
  latch: [0.7, (d, sr, r) => { click(d, sr, r, 0, 1); click(d, sr, r, 0.08, 0.8); tone(d, sr, { at: 0.12, dur: 0.3, gain: 0.7, f0: 880, decay: 4, attack: 0.01 }); tone(d, sr, { at: 0.24, dur: 0.4, gain: 0.7, f0: 1320, decay: 4, attack: 0.01 }); }, 0.6],
  clank: [0.4, (d, sr, r) => { click(d, sr, r, 0, 1); tone(d, sr, { dur: 0.35, gain: 0.8, f0: 520, decay: 7 }); tone(d, sr, { dur: 0.3, gain: 0.6, f0: 1460, decay: 9 }); noise(d, sr, r, { dur: 0.08, gain: 0.4, f0: 5000, decay: 9 }); }, 0.6],
  domeHum: [1.3, (d, sr, r) => { tone(d, sr, { dur: 1.3, gain: 1, f0: 140, f1: 420, decay: 1.5, attack: 0.1, vib: 0.03, vibF: 11 }); tone(d, sr, { dur: 1.3, gain: 0.5, f0: 280, f1: 840, decay: 1.8, attack: 0.15 }); noise(d, sr, r, { at: 0.5, dur: 0.8, gain: 0.25, f0: 9000, decay: 2, hp: 3000 }); }, 0.6],
  servo: [0.9, (d, sr) => { tone(d, sr, { dur: 0.45, gain: 0.8, f0: 300, f1: 900, decay: 1.5, attack: 0.03, square: 0.4 }); tone(d, sr, { at: 0.45, dur: 0.4, gain: 0.7, f0: 900, f1: 500, decay: 2, square: 0.4 }); }, 0.45],
  buzz: [0.9, (d, sr, r) => { tone(d, sr, { dur: 0.9, gain: 0.7, f0: 190, f1: 240, decay: 1.2, attack: 0.08, square: 0.8, vib: 0.05, vibF: 23 }); noise(d, sr, r, { dur: 0.9, gain: 0.4, f0: 2500, decay: 1.5 }); }, 0.45],
  powerDown: [1.2, (d, sr, r) => { tone(d, sr, { dur: 1.1, gain: 1, f0: 900, f1: 60, decay: 1.4, square: 0.6 }); noise(d, sr, r, { at: 0.2, dur: 0.6, gain: 0.4, f0: 7000, decay: 3, hp: 2000 }); }, 0.6],
  tick: [0.06, (d, sr, r) => { click(d, sr, r, 0, 0.6); tone(d, sr, { dur: 0.05, gain: 0.6, f0: 2800, decay: 6 }); }, 0.4],
};

const ENEMY_AIR = new Set(['recon', 'hound']);

export class StreaksSfx {
  constructor(engine) {
    this.e = engine;
    this.b = {};
    this.lockAt = -9; this.sirenAt = -9;
    const ctx = engine.ctx, sr = ctx.sampleRate || 44100, names = Object.keys(RECIPES);
    let i = 0;
    const next = () => {
      if (i >= names.length || !engine.ctx) return;
      const name = names[i], [dur, fill, peak] = RECIPES[name], d = new Float32Array(Math.floor(dur * sr));
      fill(d, sr, rng(71 + i++));
      this.b[name] = engine._toBuffer(normalize(d, peak));
      setTimeout(next, 0);
    };
    if (engine.offline) while (i < names.length) next(); else setTimeout(next, 0);
  }

  #world(name, x, z, range, gain = 1, priority = PR.world, rate = 1) {
    if (!Number.isFinite(x) || !this.b[name]) return;
    this.e._world(this.b[name], x, z, range, { gain, priority, rate, cls: priority >= PR.boom ? 'boom' : 'world' });
  }
  #ui(name, gain = 0.8, rate = 1, priority = PR.ui) { if (this.b[name]) this.e._play(this.b[name], { bus: this.e.ui, priority, cls: 'ui', gain, rate }); }

  onEvents(events, view) {
    const me = view?.localId, team = this.e.localTeam, now = this.e.ctx?.currentTime ?? 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.t) {
        case 'streak': {
          const ours = e.team === team;
          if (ENEMY_AIR.has(e.kind)) {
            if (!ours && now - this.lockAt > 1) { this.lockAt = now; this.#ui('lockOn', 0.75); }
            this.#world('buzz', e.x, e.z, 30, 0.8);
          } else if (e.kind === 'bombrun') {
            this.#ui('bomberDrone', ours ? 0.4 : 0.7);
            if (!ours && now - this.sirenAt > 1.5) { this.sirenAt = now; this.#ui('siren', 0.7, 1, PR.boom); }
          } else if (e.kind === 'airdrop') this.#ui('bomberDrone', ours ? 0.45 : 0.3, 1.25);
          else if (e.kind === 'dome') this.#world('domeHum', e.x, e.z, 36, 1);
          else if (e.kind === 'rover') this.#world('servo', e.x, e.z, 30, 0.9);
          else if (e.kind === 'plates') this.#world('clank', e.x, e.z, 24, 0.9);
          break;
        }
        case 'streak_aim': if (e.id === me) this.#ui('tick', 0.6); break;
        case 'sweep': {
          const ours = e.team === team;
          this.#ui('sonar', ours ? 0.45 : 0.7, ours ? 1 : 0.9);
          break;
        }
        case 'air_down': this.#world('airDown', e.x, e.z, HEAR + 10, e.kind === 'gunship' || e.kind === 'chopper' ? 1.5 : 0.9, PR.boom); break;
        case 'crate': this.#world('thud', e.x, e.z, 34, 1.1, PR.world); break;
        case 'crate_open': this.#world('latch', e.x, e.z, 22, e.id === me ? 1 : 0.7); break;
        case 'plates': if (e.id === me) this.#ui('clank', 0.6, 1.15); break;
        case 'plates_break': if (e.id === me) this.#ui('clank', 0.8, 0.7); break;
        case 'emp': if (e.team === team) this.#ui('powerDown', 0.7); break;
        case 'turret_down': if (e.kind === 'dome') this.#world('powerDown', e.x, e.z, 26, 0.6, PR.world, 1.4); break;
        default: break;
      }
    }
  }
}
