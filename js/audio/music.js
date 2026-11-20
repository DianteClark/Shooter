// The music director (docs/AUDIO.md). Menus play stems pre-rendered by music-synth.js (the title theme and its calm
// variant, the lobby loop) and one-shot stings; matches play a theme per mode, sequenced live by music-seq.js from
// music-themes.js, its intensity following the match. Crossfades between all of them.
//
// One instance, `music`, shared by everything: the audio engine attaches it to its context and its music bus, main.js
// tells it which screen is up and what match is starting (match()), the engine's update feeds it the match view each
// frame and its events, and anyone can cue it:
//   music.cue('exfil')            the extraction "exfil called" theme; music.cue('exfil', false) back
//   music.cue('finalCircle' | 'lastMinute' | 'drop', on)   force a moment (normally read from the match view)
//   music.cue('menu' | 'lobby' | 'match' | 'none')        a scene
//   music.cue('victory' | 'defeat' | 'intro' | 'boss' | 'matchPoint' | 'levelUp' | 'unlock' | 'prestige')   a sting
//
// Graph: stems and the sequencer -> loopBus -> stingDuck -> duck (fights, mic, voices, radio) -> filter (calm, dead,
//        muffle) -> out;  stings -> stingBus -> out;  out -> engine.music (volume, mic mode) -> master -> limiter.
// Nothing here allocates per frame: frame() compares a few numbers and touches the graph only when one changes.
import { TRACKS, BUILD_ORDER, MUSIC_RATE, renderTrack, releaseScratch } from './music-synth.js';
import { Sequencer, renderKit } from './music-seq.js';
import { pickTheme, pickEvent, newPickState } from './music-themes.js';

const FADE = 1.2;              // Seconds: a scene crossfade.
const IDLE_MS = 75000;         // Title screen untouched this long: the calm variant.
const SLICE_MS = 4;            // Build work per turn.
const SLICE_GAP = 10;          // Ms between turns in menus (the rest of the frame stays free).
const SLICE_GAP_MATCH = 40;    // And in a match, should a build still be running.
const GROUP = {};
const LOOPS = new Set(Object.keys(TRACKS).filter(k => TRACKS[k].loop));
const UI_STING = { levelUp: ['levelUp', 1], rankUp: ['levelUp', 1.122], unlock: ['unlock', 1], prestige: ['prestige', 1] };
export const MUSIC_MODES = ['all', 'menus', 'off'];   // Options: music everywhere, menus and stings only, none.
const MATCH_DUCK = 0.45;       // How far a full firefight pushes the match music down.
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
    this.mode = 'all';               // MUSIC_MODES
    this.seq = new Sequencer();
    this.pick = newPickState();
    this.info = { mode: 'tdm', rules: 'tdm', ranked: false, large: false, mission: 0 };
    this.talking = false; this.radioUntil = 0;
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
    this.seq.attach(ctx, this.loopBus);
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
    this.seq.detach();
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
          if (ti > BUILD_ORDER.length) {
            this.built = true; this.buildWallMs = performance.now() - t0; releaseScratch(); this._builtDone();
            return;
          }
          it = ti < BUILD_ORDER.length ? renderTrack(TRACKS[BUILD_ORDER[ti]]) : renderKit();
        }
        const t = performance.now();
        const r = it.next();
        const ms = performance.now() - t;
        this.buildMs += ms; if (ms > this.maxJobMs) this.maxJobMs = ms;
        if (r.done) { if (ti < BUILD_ORDER.length) this._store(BUILD_ORDER[ti], r.value); else this._storeKit(r.value); it = null; ti++; }
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

  _storeKit(samples) {
    const bufs = {};
    let bytes = 0;
    for (const [name, data] of Object.entries(samples)) {
      const buf = this.ctx.createBuffer(1, data.length, MUSIC_RATE);
      buf.getChannelData(0).set(data);
      bufs[name] = buf; bytes += data.length * 4;
    }
    this.bytes += bytes;
    this.seq.setKit(bufs, bytes);
  }

  // ---- Options and inputs. ----
  // 'all': music everywhere; 'menus': menus and stings, nothing under play; 'off': none at all.
  setMode(mode) {
    if (!MUSIC_MODES.includes(mode)) mode = 'all';
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode !== 'all') this.seq.stop(1);
    this._apply(1);
  }
  get matchMusic() { return this.mode === 'all'; }
  setMatchMusic(on) { this.setMode(on ? 'all' : 'menus'); }     // The old two-way switch.

  // The engine's own tension loop gives way while a theme plays: the theme's peak level does that job in time.
  get ownsTension() { return this.scene === 'match' && this.mode === 'all' && !!this.seq.themeId; }

  // From main.js, as a match starts: what it is, for the choice of theme.
  //   { mode, rules, ranked, large, mission }   mission: the campaign mission's number (1-8)
  match(info) {
    this.info = { mode: info.mode ?? 'tdm', rules: info.rules ?? info.mode ?? 'tdm', ranked: !!info.ranked, large: !!info.large, mission: info.mission | 0 };
    this.pick = newPickState();
  }

  // Match events (from AudioEngine.onEvents): the few the theme choice needs.
  onEvents(events, localTeam) {
    if (this.scene !== 'match') return;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.t === 'excall' || e.t === 'exfil' || e.t === 'exwipe' || e.t === 'exleave' || e.t === 'exwindow' || e.t === 'cpphase') pickEvent(this.pick, e, localTeam);
    }
  }

  // Someone on voice chat is talking (js/ui/voice-ui.js): the music steps back while they do.
  talk(on) {
    if (this.talking === !!on) return;
    this.talking = !!on;
    this._duck(on ? 0.12 : 0.6);
  }

  // A spoken callout (campaign radio): the music dips for `secs`.
  callout(secs = 2.5) {
    if (!this.ctx) return;
    const until = this.ctx.currentTime + secs;
    const was = this.ctx.currentTime < this.radioUntil;
    this.radioUntil = Math.max(this.radioUntil, until);
    if (!was) this._duck(0.08);
    clearTimeout(this._radioT);
    this._radioT = setTimeout(() => this._duck(0.6), secs * 1000 + 30);
  }

  _duckTarget() {
    const eng = this.engine;
    let k = 1;
    if (this.scene === 'match') k *= 1 - MATCH_DUCK * Math.min(1, eng?.fight || 0);
    if (eng?.micActive) k *= 0.5;
    if (this.talking) k *= 0.55;
    if (this.ctx && this.ctx.currentTime < this.radioUntil) k *= 0.5;
    return k;
  }

  _duck(tc) {
    if (!this.duck) return;
    const target = this._duckTarget();
    this.duckLevel = target;
    this.duck.gain.setTargetAtTime(target, this.ctx.currentTime, tc);
  }

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
      case 'exfil': this.forced.exfil = !!on; break;
      case 'lastMinute': this.forced.last = !!on; break;
      case 'finalCircle': this.forced.circle = !!on; break;
      case 'drop': this.forced.air = !!on; break;
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
    if (!buf || !this.ctx || this.hidden || this.mode === 'off' || this.ctx.state === 'closed') return 0;
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
      f.ended = false; f.alive = true;
      if (view.mode !== 'range' && !view.br) this.sting('intro', { gain: 0.9 });
    }
    let me = null;
    const ps = view.players, id = eng.localId;
    for (let i = 0; i < ps.length; i++) if (ps[i].id === id) { me = ps[i]; break; }
    const alive = me ? me.alive !== false : true;
    const ended = view.phase === 'ended';
    if (ended !== f.ended) { f.ended = ended; if (ended) this.seq.stop(0.8); }
    if (alive !== f.alive) { f.alive = alive; this._filter(alive ? 1 : 0.4); }

    // The theme and its level, from the mode and the moment.
    const P = this.pick, x = this.forced;
    if (x.exfil) P.exfil = true;
    const sting = pickTheme(P, this.info, view, me, eng.fight || 0, !!eng.tension, this.ctx.currentTime);
    let theme = P.theme, level = P.level;
    if (theme && x.air) { theme = 'brdrop'; level = 3; }
    else if (theme && x.circle) { theme = 'brfinal'; level = Math.max(2, level); }
    if (theme && x.last) level = 3;
    if (sting && this.mode !== 'off') this.sting(sting, { gain: 0.85, duckTo: 0.4 });
    if (theme && this.mode === 'all' && !this.hidden && !ended && (this.engine?.musicVolume ?? 1) > 0) this.seq.play(theme, level, P.transpose);
    else if (this.seq.themeId) this.seq.stop(ended ? 0.8 : 1.2);

    // Firefights, the open mic, voices and radio push the music down; stings are left alone.
    const target = this._duckTarget();
    if (Math.abs(target - this.duckLevel) > 0.04) {
      const fall = target < this.duckLevel;
      this.duckLevel = target;
      this.duck.gain.setTargetAtTime(target, this.ctx.currentTime, fall ? 0.05 : 0.7);
    }
  }

  // The local mic opened or closed (the engine calls this).
  voice() {
    if (!this.ctx) return;
    this._duck(0.15);
  }

  // ---- Scenes. ----
  _scene(name, fade = FADE) {
    if (name === this.scene) return;
    if (name !== 'menu') this.calm = false;
    if (name === 'menu') this.lastInput = Date.now();
    if (this.scene === 'match' && name !== 'match') {
      this.f.alive = true;
      this.seq.stop(Math.max(0.3, fade));
      for (const k in this.forced) this.forced[k] = false;
    }
    this.scene = name;
    this._duck(0.3);
    this._apply(fade);
  }

  // What should be playing now, and how loud: 'track.stem' -> level.
  _targets() {
    const t = {};
    if (this.hidden) return t;
    if (this.mode === 'off') return t;
    switch (this.scene) {
      case 'menu': t['menu.bed'] = 0.9; if (!this.calm) t['menu.drive'] = 0.9; break;
      case 'lobby': t['lobby.main'] = 0.75; break;
      case 'post': t['lobby.main'] = 0.45; break;
      default: break;
    }
    return t;
  }

  _apply(fade = FADE) {
    if (!this.ctx || this.ctx.state === 'closed') return;
    if (this.hidden && this.seq.themeId) this.seq.stop(0);       // frame() brings the theme back when visible.
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
  // nowPlaying: the stems playing, and the sequenced theme as 'theme:<id>:<level>'.
  nowPlaying() {
    const out = [...this.live.keys()].sort();
    if (this.seq.themeId) out.push(`theme:${this.seq.themeId}:${this.seq.level}`);
    return out;
  }
  stats() {
    return { bytes: this.bytes, buildMs: Math.round(this.buildMs), maxJobMs: +this.maxJobMs.toFixed(1), wallMs: Math.round(this.buildWallMs), built: this.built, tracks: Object.keys(this.bufs).length, kit: this.seq.ready, seq: this.seq.stats() };
  }
}

export const music = new Music();
