// Finishing moves and emotes, heard (docs/FINISHERS.md). AudioEngine makes one and hands it every event batch (one
// hook line, like BrSfx). Synthesised once into buffers (synth-kit.js), played through the engine's mixer.
//   fin    a cloth grab and a rush of air at the start, then each blow (the finisher's `hits`) as a dull body
//          impact, scheduled on the audio clock; a finisher cut short ('finx') drops the blows still to come
//   done   the kill: a heavier thud and a bone-dry crack
//   emote  a soft cue at the player: a whistle for a wave, a clap pair for thumbs up, a chuckle for the laugh...
import { bake, click, noise, tone } from './synth-kit.js';
import { FINISHERS, EMOTES } from '../shared/finishers.js';

const PR_WORLD = 2, PR_OWN = 5;
const RANGE = 26;

const RECIPES = {
  grab: [0.4, (d, sr, r) => { noise(d, sr, r, { dur: 0.35, gain: 1, f0: 1800, f1: 600, decay: 4, hp: 300 }); click(d, sr, r, 0.02, 0.5); }, 0.55],
  whoosh: [0.45, (d, sr, r) => { noise(d, sr, r, { dur: 0.42, gain: 1, f0: 500, f1: 2600, decay: 2.5, attack: 0.12, hp: 200 }); }, 0.5],
  blow: [0.35, (d, sr, r) => { click(d, sr, r, 0, 1, 120); tone(d, sr, { dur: 0.3, gain: 1, f0: 140, f1: 55, decay: 7 }); noise(d, sr, r, { dur: 0.12, gain: 0.7, f0: 1200, decay: 9 }); }, 0.85],
  done: [0.6, (d, sr, r) => {
    tone(d, sr, { dur: 0.5, gain: 1, f0: 95, f1: 38, decay: 5 }); click(d, sr, r, 0, 1, 160);
    click(d, sr, r, 0.05, 0.9, 40); noise(d, sr, r, { at: 0.05, dur: 0.08, gain: 0.8, f0: 5000, f1: 2500, decay: 10, hp: 1500 });
    noise(d, sr, r, { at: 0.12, dur: 0.4, gain: 0.35, f0: 400, decay: 4 });
  }, 0.9],
  cut: [0.3, (d, sr, r) => { tone(d, sr, { dur: 0.25, gain: 1, f0: 260, f1: 180, decay: 6, square: 0.3 }); noise(d, sr, r, { dur: 0.2, gain: 0.5, f0: 900, decay: 7 }); }, 0.5],
  // Emotes.
  whistle: [0.7, (d, sr) => { tone(d, sr, { dur: 0.22, gain: 1, f0: 1500, f1: 2300, decay: 1, attack: 0.02 }); tone(d, sr, { at: 0.28, dur: 0.38, gain: 1, f0: 2300, f1: 1400, decay: 1.5, attack: 0.02 }); }, 0.3],
  clap: [0.45, (d, sr, r) => { for (const at of [0, 0.2]) { click(d, sr, r, at, 1, 60); noise(d, sr, r, { at, dur: 0.07, gain: 0.8, f0: 3200, decay: 9, hp: 700 }); } }, 0.45],
  heel: [0.35, (d, sr, r) => { click(d, sr, r, 0, 1, 90); tone(d, sr, { dur: 0.2, gain: 0.8, f0: 180, f1: 120, decay: 9 }); click(d, sr, r, 0.12, 0.6, 60); }, 0.45],
  chuckle: [0.9, (d, sr, r) => { for (let k = 0; k < 4; k++) { tone(d, sr, { at: k * 0.17, dur: 0.12, gain: 0.8, f0: 210 - k * 8, f1: 170 - k * 8, decay: 3, square: 0.5, attack: 0.01 }); noise(d, sr, r, { at: k * 0.17, dur: 0.1, gain: 0.3, f0: 1400, decay: 4 }); } }, 0.35],
  step: [0.25, (d, sr, r) => { click(d, sr, r, 0, 0.8, 70); tone(d, sr, { dur: 0.15, gain: 0.7, f0: 120, f1: 80, decay: 9 }); }, 0.35],
  beckon: [0.5, (d, sr, r) => { tone(d, sr, { dur: 0.3, gain: 1, f0: 420, f1: 300, decay: 3, square: 0.4, attack: 0.01 }); noise(d, sr, r, { dur: 0.25, gain: 0.3, f0: 1500, decay: 5 }); }, 0.3],
  spin: [0.8, (d, sr, r) => { noise(d, sr, r, { dur: 0.75, gain: 1, f0: 700, f1: 2000, decay: 1.5, attack: 0.1, hp: 300 }); }, 0.3],
};
const EMOTE_SOUND = { wave: 'whistle', salute: 'heel', point: 'beckon', thumbs: 'clap', laugh: 'chuckle', shuffle: 'step', taunt: 'beckon', turntable: 'spin' };

export class FinSfx {
  constructor(engine) {
    this.e = engine;
    this.b = bake(engine, RECIPES, 523, {});
    this.pending = new Map();      // attacker id -> the blows scheduled for the finisher under way
  }

  // A sound at a world position, now or `delay` seconds from now. Returns the voice (or null).
  #at(name, x, z, { gain = 1, delay = 0, rate = 1, own = false } = {}) {
    const e = this.e, buf = this.b[name];
    if (!buf || !Number.isFinite(x) || !e.ctx) return null;
    if (own) return e._play(buf, { bus: e.ui, gain: gain * 0.8, rate, priority: PR_OWN, cls: 'ui', when: delay ? e.ctx.currentTime + delay : 0 });
    if (e._spatial(x, z) > RANGE) return null;
    return e._play(buf, { gain: gain * e.sGain, pan: e.sPan, far: e.sFar, rate, priority: PR_WORLD, cls: 'world', when: delay ? e.ctx.currentTime + delay : 0 });
  }

  onEvents(events, view) {
    const me = view?.localId;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.t === 'fin') {
        const def = FINISHERS[ev.k];
        if (!def) continue;
        const own = ev.by === me || ev.target === me;
        this.#at('grab', ev.x, ev.z, { own, gain: 0.9 });
        this.#at('whoosh', ev.x, ev.z, { own, gain: 0.7, delay: Math.max(0, def.hits[0] * def.dur - 0.2) });
        const list = def.hits.map(h => this.#at('blow', ev.x, ev.z, { own, delay: h * def.dur, rate: 0.9 + Math.random() * 0.2 })).filter(Boolean);
        this.pending.set(ev.by, list);
      } else if (ev.t === 'finx') {
        const now = this.e.ctx?.currentTime ?? 0;
        for (const v of this.pending.get(ev.by) ?? []) if (v.start > now) this.e._cancel(v, now);
        this.pending.delete(ev.by);
        const p = view?.players?.find(q => q.id === ev.by);
        if (p) this.#at('cut', p.x, p.z, { own: ev.by === me || ev.target === me, gain: 0.7 });
      } else if (ev.t === 'kill' && ev.fin) {
        this.pending.delete(ev.by);
        this.#at('done', ev.x, ev.z, { own: ev.by === me || ev.target === me });
      } else if (ev.t === 'emote') {
        const em = EMOTES[ev.e], p = view?.players?.find(q => q.id === ev.id);
        if (!em || !p || p.air) continue;
        this.#at(EMOTE_SOUND[em.id] ?? 'clap', p.x, p.z, { own: ev.id === me, gain: 0.8 });
      }
    }
  }
}
