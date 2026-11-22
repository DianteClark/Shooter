// The co-op campaign's sounds (docs/CAMPAIGN.md), out of audio.js like zm-sfx.js: AudioEngine makes one the first time an
// event batch carries a campaign view and hands it every batch; the HUD asks for a radio blip as a line comes up.
// Everything is synthesised (synth-kit.js), no voices:
//   radio      a squelch and two beeps as a line comes in (pitched by who is talking: Lantern high, the Line low)
//   alarm      a two-tone siren when the watchmen raise the alarm
//   objective  a rising pair when a step is done, a soft chime on a checkpoint, a falling tone and static on a fail,
//              a chord when the mission is complete
//   boss       a whistle as his barrage is called in, a growl when he lines up a charge, a horn on a new phase
//   charges    a beep as one is set, a click and a warble when one is pulled
import { bake, click, noise, tone } from './synth-kit.js';
import { objOf } from '../sim/rules.js';

const PR = { ui: 3, world: 2 };
const PITCH = { lantern: 1, kestrel: 1.18, line: 0.72, magpie: 0.9, kordell: 0.62 };

const RECIPES = {
  squelch: [0.42, (d, sr, r) => {
    noise(d, sr, r, { dur: 0.12, gain: 0.8, f0: 2600, f1: 1800, decay: 9, attack: 0.002, hp: 900 });
    tone(d, sr, { at: 0.13, dur: 0.07, gain: 0.7, f0: 1320, decay: 6, square: 0.6 });
    tone(d, sr, { at: 0.23, dur: 0.07, gain: 0.7, f0: 1760, decay: 6, square: 0.6 });
    noise(d, sr, r, { at: 0.3, dur: 0.1, gain: 0.25, f0: 3200, decay: 12, hp: 1500 });
  }, 0.45],
  siren: [1.6, (d, sr) => { for (let k = 0; k < 4; k++) tone(d, sr, { at: k * 0.4, dur: 0.38, gain: 0.8, f0: k % 2 ? 620 : 880, decay: 1, attack: 0.01, square: 0.7 }); }, 0.5],
  done: [0.7, (d, sr) => { tone(d, sr, { dur: 0.3, gain: 0.7, f0: 660, decay: 3, square: 0.2 }); tone(d, sr, { at: 0.14, dur: 0.45, gain: 0.8, f0: 990, decay: 2.5, square: 0.2 }); }, 0.4],
  check: [0.9, (d, sr) => { tone(d, sr, { dur: 0.8, gain: 0.6, f0: 1175, decay: 3, attack: 0.004 }); tone(d, sr, { dur: 0.6, gain: 0.3, f0: 2350, decay: 5 }); }, 0.3],
  fail: [1.6, (d, sr, r) => { tone(d, sr, { dur: 1.2, gain: 0.8, f0: 330, f1: 140, decay: 1.2, square: 0.6 }); noise(d, sr, r, { at: 0.4, dur: 1.1, gain: 0.35, f0: 2000, decay: 1.5, hp: 600 }); }, 0.5],
  win: [2.2, (d, sr) => { [392, 494, 587, 784].forEach((f, k) => tone(d, sr, { at: k * 0.1, dur: 1.9, gain: 0.5, f0: f, decay: 1.4, attack: 0.03, square: 0.15 })); }, 0.45],
  whistle: [1.5, (d, sr, r) => { tone(d, sr, { dur: 1.45, gain: 0.7, f0: 2400, f1: 900, decay: 0.6, attack: 0.05 }); noise(d, sr, r, { dur: 1.4, gain: 0.15, f0: 3000, decay: 1, hp: 1500 }); }, 0.4],
  growl: [1.1, (d, sr, r) => { tone(d, sr, { dur: 1, gain: 1, f0: 70, f1: 110, decay: 1.4, attack: 0.1, square: 0.8, vib: [12, 0.1] }); noise(d, sr, r, { dur: 1, gain: 0.4, f0: 300, decay: 1.5, attack: 0.1 }); }, 0.6],
  horn: [2.0, (d, sr, r) => { tone(d, sr, { dur: 1.9, gain: 1, f0: 73, f1: 69, decay: 0.8, attack: 0.25, square: 0.7 }); tone(d, sr, { dur: 1.9, gain: 0.5, f0: 110, f1: 104, decay: 0.8, attack: 0.25, square: 0.5 }); noise(d, sr, r, { dur: 1.8, gain: 0.15, f0: 400, decay: 1, attack: 0.3 }); }, 0.65],
  set: [0.5, (d, sr) => { for (let k = 0; k < 3; k++) tone(d, sr, { at: k * 0.11, dur: 0.08, gain: 0.7, f0: 1500, decay: 8, square: 0.5 }); }, 0.35],
  // Operation Starfall: a flare fired over the summit (a thump, a hiss climbing and burning), a salvo's walking rounds.
  flare: [2.6, (d, sr, r) => { click(d, sr, r, 0, 1, 70); noise(d, sr, r, { at: 0.05, dur: 2.4, gain: 0.5, f0: 1800, f1: 3200, decay: 0.9, attack: 0.3, hp: 900 }); tone(d, sr, { at: 0.05, dur: 0.6, gain: 0.4, f0: 300, f1: 900, decay: 3 }); }, 0.45],
  salvo: [1.6, (d, sr, r) => { for (let k = 0; k < 5; k++) { click(d, sr, r, k * 0.22, 0.8, 110); tone(d, sr, { at: k * 0.22, dur: 0.2, gain: 0.5, f0: 180, f1: 90, decay: 9 }); } }, 0.5],
  pull: [0.7, (d, sr, r) => { click(d, sr, r, 0, 1, 90); tone(d, sr, { at: 0.05, dur: 0.6, gain: 0.6, f0: 900, f1: 500, decay: 2, square: 0.4, vib: [18, 0.08] }); }, 0.45],
};

export class CpSfx {
  constructor(engine) {
    this.e = engine;
    this.b = bake(engine, RECIPES, 5917, {});
  }

  #ui(name, gain = 0.8, rate = 1) { if (this.b[name]) this.e._play(this.b[name], { bus: this.e.ui, priority: PR.ui, cls: 'ui', gain, rate }); }
  #world(name, x, z, range = 40, { gain = 1, rate = 1 } = {}) {
    if (!Number.isFinite(x) || !this.b[name]) return;
    this.e._world(this.b[name], x, z, range, { gain, priority: PR.world, cls: 'world', rate });
  }

  radio(who) { this.#ui('squelch', 0.55, PITCH[who] ?? 1); }

  onEvents(events, view) {
    const cp = objOf(view);
    if (!cp?.cp) return;
    for (const e of events) {
      switch (e.t) {
        case 'cpalarm': this.#ui('siren', 0.7); break;
        case 'cpdone': this.#ui('done', 0.7); break;
        case 'cpcheck': this.#ui('check', 0.5); break;
        case 'cpfail': this.#ui('fail', 0.8); break;
        case 'cpwin': this.#ui('win', 0.8); break;
        case 'cpwarn': if (e.k === 0) this.#ui('whistle', 0.5); else if (e.k === 2) this.#world('salvo', e.x, e.z, 60, { gain: 1 }); else this.#world('growl', e.x, e.z, 50, { gain: 1 }); break;
        case 'cpflare': this.#ui('flare', 0.6); break;
        case 'cpphase': this.#ui('horn', 0.8); break;
        case 'cpplant': this.#ui(e.pulled ? 'pull' : 'set', 0.7); break;
      }
    }
  }
}
