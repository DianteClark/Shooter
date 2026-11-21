// Mode and objective sounds for the events nothing else voiced (the sound design pass, docs/AUDIO.md): Extraction's
// exfil, helicopter, reinforcements and caches; Infected; Headquarters; Kill Order's VIP; One in the Chamber; the
// round modes' bells, whistles and overtime; Grind's bank; being marked by a recon sweep; a streak hijacked; ammo
// scavenged; the airstrike's jets; Graveyard Shift's traps, exfil, warden and elemental hits. Like zm-sfx.js:
// synthesised once with synth-kit.js, played through the engine's _play/_world so it shares the mixer, priorities,
// voice caps, distance roll-off and pan.
import { bake, click, noise, tone } from './synth-kit.js';

const PR = { boom: 4, ui: 3, world: 2, gun: 1 };     // audio.js PR.
const HEAR = 58;                                      // audio.js HEAR_RANGE.

// Helicopter rotor: a train of low noise thumps (blade slap) over a turbine whine, fading in and out.
function rotor(d, sr, r, { dur, rate = 5.6, rise = 0.6, fall = 0.8, whine = 1 }) {
  const n = Math.floor(dur / (1 / rate));
  for (let k = 0; k < n; k++) {
    const at = k / rate, env = Math.min(1, at / rise, (dur - at) / fall);
    noise(d, sr, r, { at, dur: 0.12, gain: 0.9 * Math.max(0, env), f0: 420, f1: 140, decay: 7, attack: 0.004 });
    tone(d, sr, { at, dur: 0.1, gain: 0.5 * Math.max(0, env), f0: 70, f1: 52, decay: 8 });
  }
  if (whine) tone(d, sr, { dur, gain: 0.12 * whine, f0: 1850, f1: 1900, decay: 0.3, attack: rise, vib: [rate, 0.01] });
}
const bellTone = (d, sr, at, f, gain = 1, len = 2) => {
  tone(d, sr, { at, dur: len, gain, f0: f, decay: 2.4, attack: 0.004 });
  tone(d, sr, { at, dur: len * 0.7, gain: gain * 0.4, f0: f * 2.76, decay: 4, attack: 0.004 });
};

const RECIPES = {
  // A radio squelch and a two-tone chirp: the net speaking (exfil open, HQ online, the round about to go).
  radio: [0.5, (d, sr, r) => {
    noise(d, sr, r, { dur: 0.08, gain: 0.6, f0: 3000, decay: 3, hp: 900 });
    tone(d, sr, { at: 0.06, dur: 0.12, gain: 0.7, f0: 1320, decay: 3, square: 0.4 });
    tone(d, sr, { at: 0.2, dur: 0.16, gain: 0.7, f0: 1760, decay: 3, square: 0.4 });
    noise(d, sr, r, { at: 0.38, dur: 0.1, gain: 0.4, f0: 2800, decay: 6, hp: 900 });
  }, 0.5],
  // A smoke flare popped to call the helicopter: a pop and a long hiss.
  flare: [1.6, (d, sr, r) => {
    click(d, sr, r, 0, 1, 120);
    tone(d, sr, { dur: 0.1, gain: 0.7, f0: 260, f1: 90, decay: 6 });
    noise(d, sr, r, { at: 0.05, dur: 1.5, gain: 0.55, f0: 5200, f1: 3800, decay: 1.6, attack: 0.08, hp: 1800 });
  }, 0.6],
  // The helicopter coming in to land, and leaving.
  heliIn: [4.5, (d, sr, r) => rotor(d, sr, r, { dur: 4.5, rise: 2.5, fall: 0.8 }), 0.75],
  heliOut: [4, (d, sr, r) => rotor(d, sr, r, { dur: 4, rate: 6.2, rise: 0.3, fall: 3.2 }), 0.75],
  // A heavy bell, once: a squad lost, out of lives.
  toll: [3, (d, sr) => { bellTone(d, sr, 0, 98, 1, 3); tone(d, sr, { dur: 2.5, gain: 0.3, f0: 49, decay: 1.6, attack: 0.02 }); }, 0.6],
  // Enemy reinforcements: a distant two-note horn.
  horn: [1.6, (d, sr, r) => {
    tone(d, sr, { dur: 0.6, gain: 0.8, f0: 220, decay: 1.5, attack: 0.06, square: 0.6 });
    tone(d, sr, { at: 0.55, dur: 1, gain: 0.85, f0: 165, decay: 1.4, attack: 0.06, square: 0.6 });
    noise(d, sr, r, { dur: 1.5, gain: 0.12, f0: 500, decay: 1.2, attack: 0.2 });
  }, 0.55],
  // A charge set on a cache: three rising beeps and the latch; pulled: the same falling.
  armed: [0.7, (d, sr, r) => { [1046, 1318, 1568].forEach((f, k) => tone(d, sr, { at: k * 0.12, dur: 0.08, gain: 0.8, f0: f, decay: 4, square: 0.8 })); click(d, sr, r, 0.42, 0.9, 160); }, 0.5],
  disarmed: [0.6, (d, sr, r) => { click(d, sr, r, 0, 0.8, 140); [1568, 1318, 1046].forEach((f, k) => tone(d, sr, { at: 0.06 + k * 0.12, dur: 0.08, gain: 0.8, f0: f, decay: 4, square: 0.8 })); }, 0.45],
  // Infected: turning is a distorted growl swelling into a hit; someone else turning, a wet hiss and a thud.
  infect: [1.4, (d, sr, r) => {
    tone(d, sr, { dur: 1.2, gain: 1, f0: 70, f1: 110, decay: 1.4, attack: 0.25, square: 0.9, vib: [9, 0.08] });
    noise(d, sr, r, { dur: 1.2, gain: 0.55, f0: 900, f1: 2400, decay: 1.6, attack: 0.3, hp: 300 });
    tone(d, sr, { at: 0.95, dur: 0.4, gain: 0.9, f0: 120, f1: 40, decay: 5 });
    click(d, sr, r, 0.95, 0.9, 200);
  }, 0.7],
  turned: [0.7, (d, sr, r) => { noise(d, sr, r, { dur: 0.55, gain: 0.8, f0: 1600, f1: 600, decay: 3, attack: 0.02, hp: 400 }); tone(d, sr, { at: 0.04, dur: 0.3, gain: 0.7, f0: 110, f1: 55, decay: 5, square: 0.5 }); }, 0.45],
  // Kill Order: the crown (you are the VIP, or theirs fell: a bright chime); ours fell (it drops).
  crown: [1.1, (d, sr) => { [784, 988, 1175, 1568].forEach((f, k) => bellTone(d, sr, k * 0.07, f, 0.6, 0.9)); }, 0.45],
  crownDrop: [1, (d, sr) => { [1175, 988, 784, 587].forEach((f, k) => tone(d, sr, { at: k * 0.11, dur: 0.4, gain: 0.7, f0: f, f1: f * 0.97, decay: 3, square: 0.3 })); }, 0.45],
  // A referee's whistle: the round goes.
  whistle: [0.6, (d, sr, r) => { tone(d, sr, { dur: 0.5, gain: 0.8, f0: 2700, decay: 1.4, attack: 0.01, vib: [38, 0.03] }); noise(d, sr, r, { dur: 0.5, gain: 0.25, f0: 5000, decay: 2, hp: 2500 }); }, 0.5],
  // Overtime: a short rising siren, twice.
  overtime: [1.2, (d, sr) => { for (let k = 0; k < 2; k++) tone(d, sr, { at: k * 0.55, dur: 0.5, gain: 0.8, f0: 600, f1: 1100, decay: 1, attack: 0.02, square: 0.6 }); }, 0.5],
  // Grind's bank, and buying in Graveyard Shift: a register.
  register: [0.8, (d, sr, r) => { click(d, sr, r, 0, 1, 90); noise(d, sr, r, { at: 0.03, dur: 0.12, gain: 0.5, f0: 3000, decay: 5, hp: 1500 }); bellTone(d, sr, 0.12, 2093, 0.7, 0.6); bellTone(d, sr, 0.2, 2637, 0.6, 0.6); }, 0.45],
  // Marked by a recon sweep or a sensor: a short sonar-like ping with a warble, so it reads as "you are seen".
  marked: [0.7, (d, sr) => { tone(d, sr, { dur: 0.6, gain: 0.8, f0: 1480, f1: 1400, decay: 3.5, attack: 0.004, vib: [14, 0.02] }); tone(d, sr, { at: 0.12, dur: 0.5, gain: 0.4, f0: 2960, decay: 5 }); }, 0.4],
  // A streak hijacked: data chatter.
  hijack: [0.7, (d, sr, r) => { for (let k = 0; k < 9; k++) tone(d, sr, { at: k * 0.065, dur: 0.05, gain: 0.6, f0: 900 + ((k * 7) % 5) * 260, decay: 3, square: 1 }); noise(d, sr, r, { dur: 0.65, gain: 0.25, f0: 4000, decay: 2, hp: 2000 }); }, 0.4],
  // Ammo scavenged from a body: a magazine's clink.
  clink: [0.3, (d, sr, r) => { click(d, sr, r, 0, 0.8, 60); tone(d, sr, { dur: 0.2, gain: 0.6, f0: 2400, decay: 8 }); tone(d, sr, { at: 0.07, dur: 0.18, gain: 0.5, f0: 3100, decay: 9 }); }, 0.35],
  // The airstrike's jets going over: broadband roar with a falling Doppler whine.
  jet: [3.2, (d, sr, r) => {
    noise(d, sr, r, { dur: 3.1, gain: 1, f0: 900, f1: 500, decay: 0.2, attack: 1.2 });
    noise(d, sr, r, { dur: 3.1, gain: 0.5, f0: 4200, f1: 1600, decay: 0.3, attack: 1.4, hp: 1200 });
    tone(d, sr, { at: 0.2, dur: 2.8, gain: 0.25, f0: 2200, f1: 1100, decay: 0.8, attack: 1 });
    // The fade out: the decay above leaves the tail loud, so pull it down by hand.
    const n = d.length, f = Math.floor(0.9 * sr);
    for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f;
  }, 0.75],
  // Graveyard Shift: an electric trap humming, a frost hit's crackle, a burn's whoosh.
  zap: [1.6, (d, sr, r) => { tone(d, sr, { dur: 1.5, gain: 0.7, f0: 120, decay: 0.6, attack: 0.05, square: 1, vib: [60, 0.02] }); noise(d, sr, r, { dur: 1.5, gain: 0.4, f0: 6000, decay: 0.8, attack: 0.05, hp: 3000 }); for (let k = 0; k < 6; k++) click(d, sr, r, 0.1 + k * 0.23, 0.7, 50); }, 0.5],
  frost: [0.5, (d, sr, r) => { for (let k = 0; k < 8; k++) click(d, sr, r, k * 0.04, 0.6, 30); noise(d, sr, r, { dur: 0.45, gain: 0.5, f0: 7000, f1: 4000, decay: 4, hp: 3000 }); }, 0.35],
  burn: [0.6, (d, sr, r) => { noise(d, sr, r, { dur: 0.55, gain: 0.9, f0: 800, f1: 2400, decay: 3, attack: 0.04, hp: 200 }); }, 0.4],
};

const MARK_GAP = 2.5;        // Seconds between "you are marked" pings.

export class ModeSfx {
  constructor(engine) {
    this.e = engine;
    this.b = bake(engine, RECIPES, 1307, {});
    this.markAt = -9; this.clinkAt = -9;
  }

  #ui(name, gain = 0.8, rate = 1, priority = PR.ui) { const b = this.b[name]; if (b) this.e._play(b, { bus: this.e.ui, priority, cls: 'ui', gain, rate }); }
  #world(name, x, z, range = 40, gain = 1, priority = PR.world, rate = 1) {
    const b = this.b[name];
    if (b && Number.isFinite(x) && Number.isFinite(z)) this.e._world(b, x, z, range, { gain, priority, cls: 'world', rate });
  }
  #me(view) { return view?.players?.find(p => p.id === view.localId) ?? null; }

  onEvents(events, view) {
    const me = view?.localId, mine = this.#me(view), team = this.e.localTeam;
    const now = this.e.ctx?.currentTime ?? 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.t) {
        // ---- Extraction (docs/EXTRACT.md). ----
        case 'exwindow': this.#ui('radio', 0.6, e.final ? 0.85 : 1); break;
        case 'excall':
          if (e.team === team) { this.#ui('radio', 0.6); this.#world('flare', e.x, e.z, 60, 1); }
          else this.#world('flare', e.x, e.z, 90, 0.7);
          break;
        case 'exland': this.#world('heliIn', e.x, e.z, 150, 1.4, PR.boom); break;
        case 'exleave': this.#world('heliOut', e.x, e.z, 150, 1.3, PR.boom); break;
        case 'exwipe': if (e.team === team) this.#ui('toll', 0.7); break;
        case 'exwave': this.#world('horn', e.x, e.z, 120, 1.2); break;
        case 'explant':
          if (e.team === team) this.#ui(e.defused ? 'disarmed' : 'armed', 0.6);
          else this.#world(e.defused ? 'disarmed' : 'armed', e.x, e.z, 30, 0.8);
          break;
        case 'exboom': this.e._world(this.e.sfx.explosion, e.x, e.z, HEAR + 40, { gain: 1.9, priority: PR.boom, cls: 'boom', room: 0.35, rate: 0.85 }); break;
        case 'excase':
          if (e.team === team) this.e._play(e.drop ? this.e.sfx.drop : this.e.sfx.pickup, { bus: this.e.ui, priority: PR.ui, cls: 'ui', gain: 0.6 });
          break;
        // ---- Infected. ----
        case 'inf':
          if (e.kind === 'first') this.#ui('infect', e.id === me ? 0.9 : 0.55);
          else if (e.kind === 'infected') {
            if (e.id === me) this.#ui('infect', 0.85);
            else { const p = view?.players?.find(q => q.id === e.id); if (p) this.#world('turned', p.x, p.z, 40, 0.9); }
          }
          break;
        // ---- Headquarters (the flag set from audio.js: ours a horn, theirs an alarm). ----
        case 'hq': {
          const S = this.e.sfx, ui = { bus: this.e.ui, priority: PR.ui, cls: 'ui' };
          if (e.kind === 'live') this.#ui('radio', 0.6);
          else if (e.kind === 'capture') this.e._play(e.team === team ? S.flagHorn : S.flagAlarm, { ...ui, gain: 0.65 });
          else if (e.kind === 'destroy') this.e._play(S.flagCapture, { ...ui, gain: 0.6, rate: e.by === team ? 1 : 0.8 });
          break;
        }
        // ---- Kill Order. ----
        case 'ko':
          if (e.kind === 'vip' && e.id === me) this.#ui('crown', 0.7);
          else if (e.kind === 'kill') this.#ui(e.team === team ? 'crownDrop' : 'crown', 0.6);
          break;
        // ---- One in the Chamber. ----
        case 'oic':
          if (e.kind === 'out' && e.id === me) this.#ui('toll', 0.6, 1.3);
          else if (e.kind === 'last') this.#ui('radio', 0.5, 0.8);
          break;
        // ---- Round modes: Showdown (gf), Control (ctl). ----
        case 'gf': case 'ctl':
          if (e.kind === 'round') this.e._play(this.e.sfx.flagBell, { bus: this.e.ui, priority: PR.ui, cls: 'ui', gain: 0.55, rate: 0.84 });
          else if (e.kind === 'go') this.#ui('whistle', 0.6);
          else if (e.kind === 'overtime') this.#ui('overtime', 0.6);
          break;
        // ---- Grind. ----
        case 'grind':
          if (e.kind === 'bank') { if (e.id === me) this.#ui('register', 0.7); else if (mine) { const p = view.players.find(q => q.id === e.id); if (p) this.#world('register', p.x, p.z, 30, 0.6); } }
          break;
        // ---- Anyone. ----
        case 'marked':
          if (e.id === me && now - this.markAt > MARK_GAP) { this.markAt = now; this.#ui('marked', 0.55); }
          break;
        case 'hijack': if (e.team === team || e.by === me) this.#ui('hijack', 0.6); else this.#world('hijack', e.x, e.z, 30, 0.8); break;
        case 'scavenge': if (e.id === me && now - this.clinkAt > 0.4) { this.clinkAt = now; this.#ui('clink', 0.6); } break;
        case 'streak': if (e.kind === 'strike' && Number.isFinite(e.x)) this.#world('jet', e.x, e.z, HEAR + 60, 1.2, PR.boom, 0.95 + Math.random() * 0.1); break;
        // ---- Graveyard Shift (the rest of its sounds are in zm-sfx.js). ----
        case 'ztrap': if (e.state === 1) { const p = view?.players?.find(q => q.id === e.by); if (p) this.#world('zap', p.x, p.z, 40, 0.9); } break;
        case 'zexfil': if (e.state === 1) this.#ui('flare', 0.6); else if (e.fail) this.#ui('toll', 0.6); break;
        case 'zescape': this.#ui('heliOut', 0.7); break;
        case 'zwarden': if (e.state === 1) this.#ui('toll', 0.8, 0.7); break;
        case 'zfx': if (e.k === 'frost') this.#world('frost', e.x, e.z, 22, 0.7); else if (e.k === 'burn') this.#world('burn', e.x, e.z, 22, 0.7); break;
        case 'zsupply': if (e.by === me) this.#ui('register', 0.55); break;
        case 'zammo': if (e.id === me && now - this.clinkAt > 0.4) { this.clinkAt = now; this.#ui('clink', 0.6); } break;
        default: break;
      }
    }
  }
}
