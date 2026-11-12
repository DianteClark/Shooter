// The music director: builds the stems from music-synth.js into AudioBuffers in the background, and plays them as
// scenes (menu, lobby, match and its layers, battle royale flight) with crossfades, plus one-shot stings.
//
// One instance, `music`, shared by everything: the audio engine attaches it to its context and its music bus, main.js
// tells it which screen is up, the engine's update feeds it the match view each frame, and anyone can cue it:
//   music.cue('exfil')            the extraction "exfil called" tension layer on; music.cue('exfil', false) off
//   music.cue('finalCircle' | 'lastMinute' | 'drop', on)   force a layer (normally derived from the match view)
//   music.cue('menu' | 'lobby' | 'match' | 'none')        a scene
//   music.cue('victory' | 'defeat' | 'intro' | 'levelUp' | 'unlock' | 'prestige')   a sting
//
// Graph: per-stem source -> gain -> loopBus -> stingDuck -> duck (fights, voice) -> filter (calm, dead, muffle) -> out
//        stings -> stingBus -> out;   out -> engine.music (the engine's music bus: volume, mic mode) -> master -> limiter.
// Loops of one group share a clock, so a layer joins in time with the underscore it sits on.
// Nothing here allocates per frame: frame() compares a few flags and touches the graph only when one changes.
import { TRACKS, BUILD_ORDER, MUSIC_RATE, renderTrack, releaseScratch } from './music-synth.js';

const FADE = 1.2;              // Seconds: a scene crossfade.
const IDLE_MS = 75000;         // Title screen untouched this long: the calm variant.
const SLICE_MS = 4;            // Build work per turn.
const SLICE_GAP = 10;          // Ms between turns in menus (the rest of the frame stays free).
const SLICE_GAP_MATCH = 40;    // And in a match, should a build still be running.
const GROUP = { match: 'match', last: 'match', circle: 'match', exfil: 'match' };
const LOOPS = new Set(Object.keys(TRACKS).filter(k => TRACKS[k].loop));
const UI_STING = { levelUp: ['levelUp', 1], rankUp: ['levelUp', 1.122], unlock: ['unlock', 1], prestige: ['prestige', 1] };
const OPEN = 10000;            // Filter wide open (the stems stop at 11 kHz anyway).

// Menu screens that count as the lobby: you are waiting on other players.
const LOBBY_SCREENS = new Set(['lobby', 'vote', 'searching', 'mpsearch']);

export class Music {
  constructor() {
    this.engine = null; this.ctx = null;
    this.bufs = {};                  // track -> { stem: AudioBuffer }
    this.live = new Map();           // 'track.stem' -> { src, g, level, group }
    this.clock = {};                 // group -> context time its loop started
    this.scene = 'none';
    this.f = { air: false, last: false, circle: false, ended: false, alive: true };
    this.forced = { exfil: false, last: false, circle: false, air: false };
    this.matchMusic = false;
    this.calm = false; this.hidden = false; this.muffled = false;
    this.lastInput = Date.now();
    this.duckLevel = 1; this.stingUntil = 0; this.stingAt = {};
    this.bytes = 0; this.buildMs = 0; this.maxJobMs = 0; this.buildWallMs = 0; this.built = false; this.building = false;
    this.whenBuilt = new Promise(done => { this._builtDone = done; });
    this._listening = false;
    this._postTimer = 0;
  }

  // Called by the engine when its graph is built. `engine.music` is the engine's music bus.
  attach(engine) {
    this.engine = engine; this.ctx = engine.ctx;
    const ctx = this.ctx;
    this.out = ctx.createGain(); this.out.connect(engine.music);
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = OPEN; this.filter.Q.value = 0.5;
    this.filter.connect(this.out);
    this.duck = ctx.createGain(); this.duck.connect(this.filter);
    this.stingDuck = ctx.createGain(); this.stingDuck.connect(this.duck);
    this.loopBus = ctx.createGain(); this.loopBus.connect(this.stingDuck);
    this.stingBus = ctx.createGain(); this.stingBus.connect(this.out);
    this.bufs = {}; this.live.clear(); this.clock = {}; this.bytes = 0;
    if (!this._listening && typeof document !== 'undefined') {
      this._listening = true;
      const touch = () => {
        this.lastInput = Date.now();
        if (this.calm) { this.calm = false; this._apply(2); }
      };
      document.addEventListener('pointerdown', touch, { passive: true, capture: true });
      document.addEventListener('keydown', touch, { passive: true, capture: true });
      // Hidden: everything stops at once (iOS may freeze the clock, and nothing should play into the lock screen).
      // Visible again: the scene comes back with a fade.
      document.addEventListener('visibilitychange', () => {
        this.hidden = document.visibilityState === 'hidden';
        this._apply(this.hidden ? 0 : 1.5);
      });
      setInterval(() => {
        if (this.scene === 'menu' && !this.calm && Date.now() - this.lastInput > IDLE_MS) { this.calm = true; this._apply(4); }
      }, 5000);
    }
    engine.whenReady?.then(() => this._build());
  }

  detach() {
    this._stopAll(true);
    this.ctx = null; this.engine = null;
  }

  // ---- Building: one track at a time, a few milliseconds per turn, menu first. ----
  _build() {
    if (this.building || !this.ctx) return;
    this.building = true;
    const ctx = this.ctx, t0 = performance.now();
    let ti = 0, it = null;
    const run = () => {
      if (this.ctx !== ctx) return;
      const start = performance.now();
      do {
        if (!it) {
          if (ti >= BUILD_ORDER.length) {
            this.built = true; this.buildWallMs = performance.now() - t0; releaseScratch(); this._builtDone();
            return;
          }
          it = renderTrack(TRACKS[BUILD_ORDER[ti]]);
        }
        const t = performance.now();
        const r = it.next();
        const ms = performance.now() - t;
        this.buildMs += ms; if (ms > this.maxJobMs) this.maxJobMs = ms;
        if (r.done) { this._store(BUILD_ORDER[ti], r.value); it = null; ti++; }
      } while (performance.now() - start < SLICE_MS);
      setTimeout(run, this.scene === 'match' ? SLICE_GAP_MATCH : SLICE_GAP);
    };
    setTimeout(run, 0);
  }

  _store(track, stems) {
    const set = {};
    for (const [stem, data] of Object.entries(stems)) {
      const buf = this.ctx.createBuffer(1, data.length, MUSIC_RATE);
      buf.getChannelData(0).set(data);
      set[stem] = buf;
      this.bytes += data.length * 4;
    }
    this.bufs[track] = set;
    if (LOOPS.has(track)) this._apply();
  }

  // ---- Options and inputs. ----
  setMatchMusic(on) {
    if (this.matchMusic === !!on) return;
    this.matchMusic = !!on;
    if (this.scene === 'match') this._apply();
  }

  // The engine's tension loop gives way when match music is on: the last-minute layer does that job in time.
  get ownsTension() { return this.scene === 'match' && this.matchMusic && !!this.bufs.last; }

  // From main.js: the menu screen now showing. In a match the screen hook stays out of it.
  screen(name, inMatch = false) {
    if (inMatch || name === 'results') return;
    this._scene(LOBBY_SCREENS.has(name) ? 'lobby' : 'menu');
  }

  // From the results screen: the outcome sting, then the lobby loop under the rest of the reel.
  results(outcome) {
    this._scene('results', 0.6);
    const name = outcome === 'win' ? 'victory' : outcome === 'loss' ? 'defeat' : null;
    const dur = name ? this.sting(name, { duck: false }) : 0;
    clearTimeout(this._postTimer);
    this._postTimer = setTimeout(() => { if (this.scene === 'results') this._scene('post', 3); }, (dur + 0.3) * 1000);
  }

  cue(name, on = true) {
    switch (name) {
      case 'menu': case 'lobby': case 'match': case 'none': this._scene(name); break;
      case 'exfil': this.forced.exfil = !!on; this._apply(); break;
      case 'lastMinute': this.forced.last = !!on; this._apply(); break;
      case 'finalCircle': this.forced.circle = !!on; this._apply(); break;
      case 'drop': this.forced.air = !!on; this._apply(); break;
      case 'victory': this.results('win'); break;
      case 'defeat': this.results('loss'); break;
      case 'muffle': this.muffled = !!on; this._filter(0.3); break;
      default: if (TRACKS[name] && !TRACKS[name].loop) this.sting(name); break;
    }
  }

  // Interface sounds that also get a musical sting (from AudioEngine.uiSound).
  uiSting(kind) {
    const s = UI_STING[kind];
    if (!s || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - (this.stingAt[s[0]] ?? -9) < 0.6) return;
    this.stingAt[s[0]] = now;
    this.sting(s[0], { rate: s[1], gain: 0.8, duckTo: 0.45 });
  }

  // Plays a one-shot; returns its length in seconds (0 if it could not play).
  sting(name, { gain = 1, rate = 1, duck = true, duckTo = 0.3 } = {}) {
    const buf = this.bufs[name]?.main;
    if (!buf || !this.ctx || this.hidden || this.ctx.state === 'closed') return 0;
    const ctx = this.ctx, now = ctx.currentTime, dur = buf.duration / rate;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate; g.gain.value = gain;
    src.connect(g); g.connect(this.stingBus);
    src.onended = () => g.disconnect();
    src.start(now);
    if (duck) {
      const p = this.stingDuck.gain;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(duckTo, now, 0.04);
      p.setTargetAtTime(1, now + Math.max(0.2, dur - 0.8), 0.5);
    }
    return dur;
  }

  // ---- The match, each frame, from AudioEngine.update. Scalars only. ----
  frame(view) {
    if (!this.ctx || !view) return;
    const f = this.f, eng = this.engine;
    if (this.scene !== 'match') {
      if (view.phase === 'ended') return;     // A last frame after the results took over.
      this._scene('match', 0.8);
      f.air = f.last = f.circle = f.ended = false; f.alive = true;
      if (view.mode !== 'range' && !view.br) this.sting('intro', { gain: 0.9 });
    }
    let air = false, alive = true;
    const ps = view.players, me = eng.localId;
    for (let i = 0; i < ps.length; i++) if (ps[i].id === me) { air = !!ps[i].air; alive = ps[i].alive !== false; break; }
    const ended = view.phase === 'ended';
    const live = view.phase === 'live' && !ended && view.mode !== 'range';
    const last = live && !view.br && (!!eng.tension || (view.timeLeft > 0 && view.timeLeft <= 60));
    const circle = live && view.br?.state === 'final';
    if (air !== f.air || last !== f.last || circle !== f.circle || ended !== f.ended) {
      const fade = ended ? 0.5 : air !== f.air ? 2 : FADE;
      f.air = air; f.last = last; f.circle = circle; f.ended = ended;
      this._apply(fade);
    }
    if (alive !== f.alive) { f.alive = alive; this._filter(alive ? 1 : 0.4); }
    // Firefights and the open mic push the loops down; stings are left alone.
    const target = (1 - 0.55 * Math.min(1, eng.fight || 0)) * (eng.micActive ? 0.5 : 1);
    if (Math.abs(target - this.duckLevel) > 0.04) {
      const fall = target < this.duckLevel;
      this.duckLevel = target;
      this.duck.gain.setTargetAtTime(target, this.ctx.currentTime, fall ? 0.05 : 0.7);
    }
  }

  // Voice chat outside a match (lobbies): the engine calls this when the mic opens or closes.
  voice(active) {
    if (!this.ctx || this.scene === 'match') return;
    this.duckLevel = active ? 0.5 : 1;
    this.duck.gain.setTargetAtTime(this.duckLevel, this.ctx.currentTime, 0.15);
  }

  // ---- Scenes. ----
  _scene(name, fade = FADE) {
    if (name === this.scene) return;
    if (name !== 'menu') this.calm = false;
    if (name === 'menu') this.lastInput = Date.now();
    if (this.scene === 'match' && name !== 'match') {
      this.f.alive = true;
      this.duckLevel = 1;
      this.duck?.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
    }
    this.scene = name;
    this._apply(fade);
  }

  // What should be playing now, and how loud: 'track.stem' -> level.
  _targets() {
    const t = {};
    if (this.hidden) return t;
    const m = this.matchMusic, f = this.f, x = this.forced;
    switch (this.scene) {
      case 'menu': t['menu.bed'] = 0.9; if (!this.calm) t['menu.drive'] = 0.9; break;
      case 'lobby': t['lobby.main'] = 0.75; break;
      case 'post': t['lobby.main'] = 0.45; break;
      case 'match': {
        if (f.ended) break;
        if (f.air || x.air) { t['brdrop.main'] = 0.8; break; }
        if (m) t['match.main'] = 0.6;
        if (m && (f.last || x.last)) t['last.main'] = 0.7;
        if (f.circle || x.circle) t['circle.main'] = m ? 0.7 : 0.35;
        if (x.exfil) t['exfil.main'] = m ? 0.75 : 0.4;
        break;
      }
      default: break;
    }
    return t;
  }

  _apply(fade = FADE) {
    if (!this.ctx || this.ctx.state === 'closed') return;
    const want = this._targets(), now = this.ctx.currentTime, tc = Math.max(0.01, fade / 3);
    for (const [key, v] of this.live) {
      const lvl = want[key] || 0;
      if (lvl <= 0) {
        v.g.gain.cancelScheduledValues(now);
        if (fade <= 0) { try { v.src.stop(); } catch { /* stopped */ } v.g.disconnect(); }
        else { v.g.gain.setTargetAtTime(0, now, tc); try { v.src.stop(now + fade * 2); } catch { /* stopped */ } }
        this.live.delete(key);
      } else if (v.level !== lvl) {
        v.g.gain.cancelScheduledValues(now);
        v.g.gain.setTargetAtTime(lvl, now, tc);
        v.level = lvl;
      }
    }
    for (const key in want) if (want[key] > 0 && !this.live.has(key)) this._start(key, want[key], now, tc);
    this._filter(fade);
  }

  _filter(fade) {
    if (!this.filter) return;
    const f = this.muffled ? 700 : this.scene === 'match' && !this.f.alive ? 900 : this.calm ? 1500 : OPEN;
    const p = this.filter.frequency, now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(f, now, Math.max(0.01, fade / 3));
  }

  _start(key, level, now, tc) {
    const dot = key.indexOf('.'), track = key.slice(0, dot), stem = key.slice(dot + 1);
    const buf = this.bufs[track]?.[stem];
    if (!buf) return;                      // Not built yet: _store calls _apply again when it is.
    const group = GROUP[track] || track;
    let offset = 0;
    let groupLive = false;
    for (const v of this.live.values()) if (v.group === group) { groupLive = true; break; }
    if (groupLive) offset = (((now - this.clock[group]) % buf.duration) + buf.duration) % buf.duration;
    else this.clock[group] = now;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf; src.loop = true;
    g.gain.value = 0;
    g.gain.setTargetAtTime(level, now, tc);
    src.connect(g); g.connect(this.loopBus);
    src.onended = () => g.disconnect();
    src.start(now, offset);
    this.live.set(key, { src, g, level, group });
  }

  _stopAll(hard) {
    for (const v of this.live.values()) { try { v.src.stop(); } catch { /* stopped */ } if (hard) v.g.disconnect(); }
    this.live.clear();
  }

  // For tests and the lead: what is playing, and what the music costs.
  nowPlaying() { return [...this.live.keys()].sort(); }
  stats() {
    return { bytes: this.bytes, buildMs: Math.round(this.buildMs), maxJobMs: +this.maxJobMs.toFixed(1), wallMs: Math.round(this.buildWallMs), built: this.built, tracks: Object.keys(this.bufs).length };
  }
}

export const music = new Music();
