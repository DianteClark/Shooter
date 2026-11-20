// Weapons wave 4's melee weapons, heard when they connect (js/shared/weapons-w4.js). AudioEngine._meleeHit hands each
// hit by one of them here (one hook line); synthesised once into buffers (synth-kit.js), played through the engine's
// mixer like the Slugger's crack: louder for the two players involved, spatial for everyone else.
//   slice  Kagero, Bushwhack: a bright steel ring over a short wet cut
//   chop   Kindling: a heavy thunk with a split, like an axe into a log
//   clang  Spade: the flat of a shovel, a dull bell of sheet steel
//   hook   Gleaner: a thin zing and a quick tug
//   knock  Nightstick: a hard hollow knock of a polymer baton
import { bake, click, noise, tone } from './synth-kit.js';

const RECIPES = {
  slice: [0.36, (d, sr, r) => {
    click(d, sr, r, 0, 0.7, 40);
    noise(d, sr, r, { dur: 0.09, gain: 0.9, f0: 6200, f1: 2600, decay: 12, hp: 1800 });
    tone(d, sr, { at: 0.004, dur: 0.3, gain: 0.45, f0: 3900, f1: 3820, decay: 9 });
    tone(d, sr, { at: 0.004, dur: 0.24, gain: 0.3, f0: 5600, f1: 5500, decay: 12 });
    tone(d, sr, { at: 0.01, dur: 0.12, gain: 0.7, f0: 150, f1: 70, decay: 8 });
  }, 0.85],
  chop: [0.42, (d, sr, r) => {
    click(d, sr, r, 0, 1, 140);
    tone(d, sr, { dur: 0.22, gain: 1.1, f0: 120, f1: 48, decay: 6 });
    noise(d, sr, r, { dur: 0.05, gain: 0.8, f0: 2600, f1: 900, decay: 11 });
    noise(d, sr, r, { at: 0.03, dur: 0.18, gain: 0.35, f0: 700, f1: 300, decay: 6 });
    tone(d, sr, { at: 0.002, dur: 0.14, gain: 0.3, f0: 1900, f1: 1800, decay: 16 });
  }, 0.9],
  clang: [0.6, (d, sr, r) => {
    click(d, sr, r, 0, 0.9, 60);
    tone(d, sr, { dur: 0.55, gain: 0.7, f0: 610, f1: 590, decay: 6 });
    tone(d, sr, { dur: 0.45, gain: 0.45, f0: 1430, f1: 1400, decay: 8 });
    tone(d, sr, { dur: 0.3, gain: 0.3, f0: 2270, f1: 2240, decay: 11 });
    tone(d, sr, { at: 0.004, dur: 0.14, gain: 0.8, f0: 140, f1: 60, decay: 7 });
  }, 0.85],
  hook: [0.3, (d, sr, r) => {
    noise(d, sr, r, { dur: 0.06, gain: 0.8, f0: 7000, f1: 3500, decay: 14, hp: 2400 });
    tone(d, sr, { dur: 0.16, gain: 0.4, f0: 4600, f1: 5200, decay: 12 });
    click(d, sr, r, 0.05, 0.6, 50);
    tone(d, sr, { at: 0.05, dur: 0.1, gain: 0.7, f0: 170, f1: 80, decay: 9 });
  }, 0.8],
  knock: [0.24, (d, sr, r) => {
    click(d, sr, r, 0, 1, 50);
    tone(d, sr, { dur: 0.1, gain: 0.9, f0: 760, f1: 520, decay: 22 });
    tone(d, sr, { dur: 0.08, gain: 0.5, f0: 1240, f1: 1100, decay: 28 });
    tone(d, sr, { at: 0.003, dur: 0.12, gain: 0.8, f0: 160, f1: 70, decay: 9 });
  }, 0.85],
};
const SOUND_OF = { katana: 'slice', machete: 'slice', fireaxe: 'chop', shovel: 'clang', kama: 'hook', tonfa: 'knock' };
export const hasMeleeSound = w => !!SOUND_OF[w];

export class MeleeSfx {
  constructor(engine) {
    this.e = engine;
    this.b = bake(engine, RECIPES, 731, {});
  }

  // A hit event { w, by, target, x, z }. True if it played (or would have, once baked).
  hit(ev, range, pr) {
    const e = this.e, buf = this.b[SOUND_OF[ev.w]];
    if (!buf) return false;
    const rate = 0.95 + Math.random() * 0.1;
    if (ev.by === e.localId || ev.target === e.localId) e._play(buf, { bus: e.ui, priority: pr.hit, cls: 'foley', gain: 1, rate });
    else e._world(buf, ev.x, ev.z, range, { gain: 0.8, priority: pr.gun, cls: 'foley', rate });
    return true;
  }
}
