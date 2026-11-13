// Graveyard Shift sounds (docs/ZOMBIES.md), out of audio.js like br-sfx.js: AudioEngine makes one the first time an event
// batch carries a Graveyard Shift view and hands it every batch. Everything is synthesised (synth-kit.js).
//   groans    the undead near you moan now and then, more often the more of them there are; runners rasp, brutes bellow
//   claws     a swipe on every claw ('zswing'), a wet hit when one lands on the crew
//   crate     the mystery crate: a creaking lid and a music-box tune while it rolls, a chime on the offer, a toll and a
//             mocking laugh when it moves on
//   perks     a bottle cap, a glug and a jingle; wall-buys and ammo a register's ka-ching; gates a heavy grind
//   rounds    a bell and a low swell when a round starts (deeper, with more tolls, on a boss round), a rising chord when
//             it is cleared, a slow descent when the crew falls; power-ups sparkle, a drop shimmers where it lands
import { bake, click, noise, tone } from './synth-kit.js';
import { objOf } from '../sim/rules.js';

const PR = { ui: 3, world: 2 };
const GROAN_RANGE = 22;

const bell = (d, sr, at, f, gain = 1, len = 2.2) => {
  tone(d, sr, { at, dur: len, gain, f0: f, decay: 2.2, attack: 0.004 });
  tone(d, sr, { at, dur: len * 0.8, gain: gain * 0.5, f0: f * 2.76, decay: 3.5, attack: 0.004 });
  tone(d, sr, { at, dur: len * 0.6, gain: gain * 0.35, f0: f * 5.4, decay: 5, attack: 0.004 });
};

const RECIPES = {
  groan: [1.3, (d, sr, r) => {
    tone(d, sr, { dur: 1.25, gain: 1, f0: 110, f1: 72, decay: 1.4, attack: 0.15, square: 0.6, vib: [5.5, 0.05] });
    tone(d, sr, { dur: 1.2, gain: 0.4, f0: 330, f1: 210, decay: 2, attack: 0.15, vib: [5.5, 0.05] });
    noise(d, sr, r, { dur: 1.2, gain: 0.45, f0: 700, f1: 380, decay: 1.6, attack: 0.15, hp: 180 });
  }, 0.55],
  moan: [1.6, (d, sr, r) => {
    tone(d, sr, { dur: 1.55, gain: 1, f0: 80, f1: 96, decay: 1.2, attack: 0.25, square: 0.5, vib: [3, 0.08] });
    noise(d, sr, r, { dur: 1.5, gain: 0.35, f0: 500, decay: 1.4, attack: 0.25, hp: 150 });
  }, 0.5],
  rasp: [0.6, (d, sr, r) => {
    noise(d, sr, r, { dur: 0.55, gain: 1, f0: 1800, f1: 900, decay: 2.5, attack: 0.03, hp: 600 });
    tone(d, sr, { dur: 0.5, gain: 0.5, f0: 170, f1: 120, decay: 3, square: 0.8, vib: [22, 0.12] });
  }, 0.5],
  bellow: [1.1, (d, sr, r) => {
    tone(d, sr, { dur: 1.05, gain: 1, f0: 62, f1: 44, decay: 1.6, attack: 0.08, square: 0.8, vib: [7, 0.06] });
    noise(d, sr, r, { dur: 1, gain: 0.6, f0: 420, decay: 2, attack: 0.08, hp: 90 });
  }, 0.7],
  claw: [0.32, (d, sr, r) => { noise(d, sr, r, { dur: 0.28, gain: 1, f0: 900, f1: 3800, decay: 3, attack: 0.04, hp: 400 }); }, 0.45],
  clawHit: [0.3, (d, sr, r) => { click(d, sr, r, 0, 1, 110); noise(d, sr, r, { dur: 0.22, gain: 0.8, f0: 2600, f1: 700, decay: 6, hp: 300 }); tone(d, sr, { dur: 0.2, gain: 0.6, f0: 120, f1: 70, decay: 8 }); }, 0.6],
  lid: [0.7, (d, sr, r) => { tone(d, sr, { dur: 0.6, gain: 0.7, f0: 340, f1: 520, decay: 1.5, square: 0.7, vib: [18, 0.1] }); click(d, sr, r, 0.62, 1, 120); }, 0.45],
  musicbox: [2.6, (d, sr) => {
    const notes = [1047, 1319, 1568, 1319, 1175, 988, 1175, 1319, 1047, 784, 880, 988];
    notes.forEach((f, k) => { tone(d, sr, { at: k * 0.2, dur: 0.5, gain: 0.8, f0: f, decay: 6, attack: 0.002 }); tone(d, sr, { at: k * 0.2, dur: 0.3, gain: 0.25, f0: f * 3, decay: 9, attack: 0.002 }); });
  }, 0.35],
  offer: [1.0, (d, sr) => { [784, 988, 1175, 1568].forEach((f, k) => tone(d, sr, { at: k * 0.07, dur: 0.8, gain: 0.7, f0: f, decay: 3, attack: 0.005 })); }, 0.45],
  laugh: [1.4, (d, sr, r) => {
    for (let k = 0; k < 5; k++) tone(d, sr, { at: k * 0.2, dur: 0.16, gain: 1, f0: 150 - k * 10, f1: 110 - k * 10, decay: 2, square: 0.7, attack: 0.01, vib: [12, 0.06] });
    bell(d, sr, 0.05, 98, 0.8, 1.3); noise(d, sr, r, { dur: 1.2, gain: 0.2, f0: 300, decay: 2 });
  }, 0.55],
  perk: [1.3, (d, sr, r) => {
    click(d, sr, r, 0, 1, 60); tone(d, sr, { dur: 0.05, gain: 0.6, f0: 3200, decay: 8 });
    for (let k = 0; k < 4; k++) tone(d, sr, { at: 0.12 + k * 0.11, dur: 0.1, gain: 0.5, f0: 300 + k * 30, f1: 180, decay: 5 });
    [659, 784, 988, 1319].forEach((f, k) => tone(d, sr, { at: 0.6 + k * 0.1, dur: 0.5, gain: 0.6, f0: f, decay: 4, attack: 0.005, square: 0.2 }));
  }, 0.5],
  buy: [0.7, (d, sr, r) => {
    click(d, sr, r, 0, 1, 70); click(d, sr, r, 0.05, 0.8, 70);
    tone(d, sr, { at: 0.08, dur: 0.55, gain: 0.9, f0: 2093, decay: 3.5 }); tone(d, sr, { at: 0.08, dur: 0.55, gain: 0.7, f0: 2637, decay: 3.5 });
  }, 0.45],
  ammo: [0.5, (d, sr, r) => { click(d, sr, r, 0, 1, 70); tone(d, sr, { at: 0.05, dur: 0.4, gain: 0.7, f0: 1568, decay: 4 }); noise(d, sr, r, { at: 0.1, dur: 0.3, gain: 0.4, f0: 3000, decay: 6, hp: 1200 }); }, 0.4],
  gate: [1.2, (d, sr, r) => {
    noise(d, sr, r, { dur: 1.1, gain: 1, f0: 260, f1: 160, decay: 1.2, attack: 0.08 });
    tone(d, sr, { dur: 1.0, gain: 0.6, f0: 180, f1: 140, decay: 1.5, square: 0.6, vib: [24, 0.04] });
    click(d, sr, r, 1.05, 1, 180);
  }, 0.6],
  roundStart: [3.2, (d, sr, r) => {
    bell(d, sr, 0, 131, 1); bell(d, sr, 0.9, 123, 0.9);
    tone(d, sr, { dur: 3, gain: 0.35, f0: 65, decay: 1.2, attack: 0.6, square: 0.3 }); tone(d, sr, { dur: 3, gain: 0.25, f0: 92.5, decay: 1.2, attack: 0.6 });
    noise(d, sr, r, { dur: 3, gain: 0.15, f0: 300, decay: 1.5, attack: 0.8 });
  }, 0.7],
  bossStart: [4.2, (d, sr, r) => {
    for (let k = 0; k < 4; k++) bell(d, sr, k * 0.75, 98 - k * 3, 1);
    tone(d, sr, { dur: 4, gain: 0.45, f0: 49, decay: 0.9, attack: 0.8, square: 0.5 }); tone(d, sr, { dur: 4, gain: 0.3, f0: 69.3, decay: 0.9, attack: 0.8 });
    noise(d, sr, r, { dur: 4, gain: 0.25, f0: 220, decay: 1, attack: 1 });
  }, 0.8],
  roundEnd: [2.0, (d, sr) => { [262, 330, 392, 523].forEach((f, k) => tone(d, sr, { at: k * 0.12, dur: 1.6, gain: 0.5, f0: f, decay: 2, attack: 0.04, square: 0.15 })); }, 0.45],
  over: [3.5, (d, sr) => { [392, 349, 311, 262, 196].forEach((f, k) => bell(d, sr, k * 0.55, f / 2, 0.7, 1.8)); }, 0.6],
  power: [1.0, (d, sr) => { for (let k = 0; k < 8; k++) tone(d, sr, { at: k * 0.06, dur: 0.35, gain: 0.5, f0: 1200 + k * 180, decay: 5, attack: 0.003 }); }, 0.4],
  drop: [1.2, (d, sr, r) => { noise(d, sr, r, { dur: 1.1, gain: 0.6, f0: 3000, f1: 6000, decay: 2.5, attack: 0.2, hp: 2000 }); tone(d, sr, { dur: 1, gain: 0.4, f0: 880, f1: 1320, decay: 2, attack: 0.2 }); }, 0.35],
  // The specials (js/sim/zm-kinds.js): a Spitter's wet hawk and the glob's splash, its gurgling voice; a Bloater's
  // burst (a wet thud under the frag's bang) and its bubbling; a Crawler's dry skitter; a shield's iron clang and its
  // break; a special round's horn.
  spit: [0.5, (d, sr, r) => { noise(d, sr, r, { dur: 0.35, gain: 1, f0: 1400, f1: 500, decay: 4, attack: 0.02, hp: 300 }); tone(d, sr, { dur: 0.3, gain: 0.5, f0: 260, f1: 520, decay: 5, square: 0.4 }); }, 0.5],
  splash: [0.7, (d, sr, r) => { noise(d, sr, r, { dur: 0.6, gain: 1, f0: 900, f1: 300, decay: 4.5, attack: 0.005, hp: 150 }); tone(d, sr, { dur: 0.25, gain: 0.4, f0: 140, f1: 60, decay: 9 }); }, 0.5],
  gurgle: [0.9, (d, sr, r) => { tone(d, sr, { dur: 0.85, gain: 1, f0: 210, f1: 150, decay: 2, attack: 0.08, square: 0.5, vib: [16, 0.2] }); noise(d, sr, r, { dur: 0.8, gain: 0.4, f0: 1100, decay: 2.2, attack: 0.08, hp: 400 }); }, 0.5],
  burst: [1.2, (d, sr, r) => { tone(d, sr, { dur: 0.5, gain: 1, f0: 90, f1: 35, decay: 5 }); noise(d, sr, r, { dur: 1.1, gain: 0.9, f0: 700, f1: 160, decay: 3, attack: 0.004, hp: 60 }); noise(d, sr, r, { at: 0.08, dur: 0.6, gain: 0.5, f0: 2400, f1: 900, decay: 6, hp: 800 }); }, 0.75],
  bubble: [1.0, (d, sr) => { for (let k = 0; k < 6; k++) tone(d, sr, { at: k * 0.14, dur: 0.12, gain: 0.7, f0: 120 + (k % 3) * 40, f1: 220 + (k % 2) * 60, decay: 9, square: 0.3 }); }, 0.45],
  skitter: [0.5, (d, sr, r) => { for (let k = 0; k < 7; k++) click(d, sr, r, k * 0.06, 0.7, 300 + (k % 3) * 120); noise(d, sr, r, { dur: 0.45, gain: 0.3, f0: 3000, decay: 4, hp: 1500 }); }, 0.4],
  clang: [0.6, (d, sr, r) => { click(d, sr, r, 0, 1, 90); tone(d, sr, { dur: 0.55, gain: 0.7, f0: 820, decay: 7 }); tone(d, sr, { dur: 0.5, gain: 0.45, f0: 1310, decay: 8 }); }, 0.45],
  shatter: [0.9, (d, sr, r) => { click(d, sr, r, 0, 1, 80); noise(d, sr, r, { dur: 0.8, gain: 0.9, f0: 3200, f1: 900, decay: 4, hp: 700 }); tone(d, sr, { dur: 0.4, gain: 0.6, f0: 300, f1: 120, decay: 6, square: 0.5 }); }, 0.6],
  horn: [2.2, (d, sr, r) => { tone(d, sr, { dur: 2, gain: 1, f0: 82, f1: 78, decay: 0.8, attack: 0.3, square: 0.7 }); tone(d, sr, { dur: 2, gain: 0.5, f0: 123, f1: 117, decay: 0.8, attack: 0.3, square: 0.5 }); noise(d, sr, r, { dur: 2, gain: 0.15, f0: 400, decay: 1, attack: 0.4 }); }, 0.7],
  down: [0.9, (d, sr) => { tone(d, sr, { dur: 0.35, gain: 1, f0: 700, f1: 600, decay: 1.5, square: 0.4 }); tone(d, sr, { at: 0.38, dur: 0.5, gain: 1, f0: 500, f1: 350, decay: 2, square: 0.4 }); }, 0.5],
};
const GROANS = ['groan', 'moan', 'groan', 'moan'];
// Undead kinds as the view has them (p.zk, js/sim/zombies.js playerView): 1 shambler, 2 runner, 3 brute, 4 the boss.
const VOICE = { 1: GROANS, 2: ['rasp', 'groan'], 3: ['bellow', 'moan'], 4: ['bellow'], 6: ['gurgle'], 7: ['bubble', 'moan'], 8: ['skitter', 'rasp'], 9: ['bellow', 'groan'] };

export class ZmSfx {
  constructor(engine) {
    this.e = engine;
    this.b = bake(engine, RECIPES, 911, {});
    this.nextGroan = 0;
    this.near = [];
    this.splashes = [];     // [x, z, when] for globs in flight.
  }

  #world(name, x, z, range = 30, { gain = 1, rate = 1 } = {}) {
    if (!Number.isFinite(x) || !this.b[name]) return;
    this.e._world(this.b[name], x, z, range, { gain, priority: PR.world, cls: 'world', rate });
  }
  #ui(name, gain = 0.8, rate = 1) { if (this.b[name]) this.e._play(this.b[name], { bus: this.e.ui, priority: PR.ui, cls: 'ui', gain, rate }); }

  // Where something happened: a player's position, or the local player's when that is all there is.
  #pos(view, id) {
    const p = view?.players?.find(q => q.id === id) ?? view?.players?.find(q => q.id === view?.localId);
    return p ?? null;
  }

  onEvents(events, view) {
    const me = view?.localId;
    const z = objOf(view);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.t) {
        case 'zswing': { const p = this.#pos(view, e.id); if (p) this.#world('claw', p.x, p.z, 18, { gain: 0.7, rate: 0.9 + Math.random() * 0.25 }); break; }
        case 'hit': {
          const by = view?.players?.find(q => q.id === e.by);
          if (by?.zk) { if (e.target === me) this.#ui('clawHit', 0.8); else this.#world('clawHit', e.x, e.z, 18, { gain: 0.6 }); }
          break;
        }
        case 'zround': this.#ui(e.boss ? 'bossStart' : 'roundStart', 0.9); if (e.special) this.#ui('horn', 0.8); break;
        case 'zspit': this.#world('spit', e.ox, e.oz, 26, { gain: 0.9 }); this.splashes.push([e.x, e.z, (this.e.ctx?.currentTime ?? 0) + e.dur]); break;
        case 'zblast': this.#world('burst', e.x, e.z, 40, { gain: 1 }); break;
        case 'zshield': this.#world(e.broke ? 'shatter' : 'clang', e.x, e.z, 26, { gain: e.broke ? 1 : 0.6, rate: 0.9 + Math.random() * 0.2 }); break;
        case 'zbreak': this.#ui('roundEnd', 0.7); break;
        case 'zover': this.#ui('over', 0.9); break;
        case 'zdoor': { const p = this.#pos(view, e.by); if (p) this.#world('gate', p.x, p.z, 40, { gain: 1 }); break; }
        case 'zbuy': {
          const p = this.#pos(view, e.id);
          if (!p || e.kind === 'door' || e.kind === 'box' || e.kind === 'perk' || e.kind === 'power') break;     // Those have their own.
          if (e.id === me) this.#ui(e.kind === 'ammo' ? 'ammo' : 'buy', 0.8); else this.#world(e.kind === 'ammo' ? 'ammo' : 'buy', p.x, p.z, 20, { gain: 0.6 });
          break;
        }
        case 'zperk': if (!e.lost) { const p = this.#pos(view, e.id); if (e.id === me) this.#ui('perk', 0.85); else if (p) this.#world('perk', p.x, p.z, 20, { gain: 0.6 }); } break;
        case 'zbox': {
          const spot = z?.layout?.boxSpots?.[e.spot];
          const at = spot && Number.isFinite(spot.x) ? spot : this.#pos(view, e.by ?? me);
          if (!at) break;
          if (e.state === 1) { this.#world('lid', at.x, at.z, 30, { gain: 0.9 }); this.#world('musicbox', at.x, at.z, 30, { gain: 0.8 }); }
          else if (e.state === 2) this.#world('offer', at.x, at.z, 30, { gain: 0.9 });
          else if (e.state === 3) this.#world('laugh', at.x, at.z, 60, { gain: 1 });
          break;
        }
        case 'zpower': this.#ui('power', 0.8); break;
        case 'zlights': { const p = this.#pos(view, e.by); if (p) this.#world('gate', p.x, p.z, 80, { gain: 1 }); this.#ui('roundEnd', 0.8); break; }     // The power is on.
        case 'zdrop': this.#world('drop', e.x, e.z, 35, { gain: 0.8 }); break;
        case 'down': { const t = view?.players?.find(q => q.id === e.target), m = view?.players?.find(q => q.id === me); if (t && m && t.team === m.team && !t.zk) this.#ui('down', e.target === me ? 0.9 : 0.6); break; }
        default: break;
      }
    }
    // A glob lands where its event said, when it said.
    if (this.splashes.length) {
      const now = this.e.ctx?.currentTime ?? 0;
      for (let i = this.splashes.length - 1; i >= 0; i--) if (this.splashes[i][2] <= now) { const [x, z] = this.splashes[i]; this.splashes.splice(i, 1); this.#world('splash', x, z, 24, { gain: 0.8 }); }
    }
    this.#groans(view);
  }

  // The horde's voices: one of the undead within earshot now and then, sooner when there are many.
  #groans(view) {
    const now = this.e.ctx?.currentTime ?? 0;
    if (now < this.nextGroan || !view?.players) return;
    const mine = view.players.find(q => q.id === view.localId);
    if (!mine) return;
    const near = this.near;
    near.length = 0;
    for (const p of view.players) if (p.zk && p.alive && Math.abs(p.x - mine.x) < GROAN_RANGE && Math.abs(p.z - mine.z) < GROAN_RANGE) near.push(p);
    if (!near.length) { this.nextGroan = now + 0.8; return; }
    const p = near[Math.floor(Math.random() * near.length)], list = VOICE[p.zk] ?? GROANS;
    this.#world(list[Math.floor(Math.random() * list.length)], p.x, p.z, GROAN_RANGE, { gain: 0.75, rate: 0.82 + Math.random() * 0.36 });
    this.nextGroan = now + 2.6 / Math.sqrt(near.length) + Math.random() * 1.2;
  }
}
