// The live music sequencer: in-match music played note by note from a small kit of synthesised samples, so every mode
// can have its own theme, and each theme several intensity levels, for about 4 MB of buffers in all (a pre-rendered
// stem per theme and level would be tens of megabytes).
//
//   Kit       ~20 single-note samples rendered once by music-synth.js (drums, bass, sub, three pads, pluck, bell, lead,
//             riser, impact, wind). Pitched notes are the one sample played at another playbackRate; sustained ones
//             (pads, sub, lead) loop a seamless stretch so a note can be held for any length.
//   Themes    music-themes.js: per theme a tempo and a bar(bar, level, emit) function that emits that bar's notes.
//   Decks     two: the one playing and the one fading in. A theme change starts the new deck on the old one's next
//             bar line and crossfades; a level change waits for the next bar line of the same deck, so the music
//             changes in time with itself.
//   Scheduler a timer every TICK ms schedules whole bars AHEAD seconds before they are due, on the audio clock: the
//             main thread can stall for a frame or three and nothing is late. A stall longer than that skips to the
//             next bar line instead of bunching notes up.
//
// Node reuse: every channel owns a ring of GainNodes, made once; a note takes the next one (a source node is the only
// thing made per note, as the Web Audio API requires). The ring is longer than the channel ever needs at once, so a
// reused gain's previous note has ended or, for drums, is meant to be choked (an open hat closed by the next hat).
// Nothing here allocates per frame: the director calls set() each frame and it compares two numbers.
import { renderSample, MUSIC_RATE } from './music-synth.js';
import { THEMES } from './music-themes.js';

export const TICK_MS = 60;         // Scheduler period.
export const AHEAD = 0.32;         // Seconds: a bar is scheduled once its start is this close.
const FADE = 2.4;                  // Seconds: a theme crossfade.

// The kit. base: the MIDI note the sample sounds at. loop: [start, end] seconds of a held note. ring: gains per channel.
// pan, send (echo), level: the channel's place in the mix.
export const KIT = {
  kick:  { k: 'kick', secs: 1.2, peak: 0.9, ring: 3, level: 0.85 },
  boom:  { k: 'kick', dec: 0.7, top: 120, low: 38, secs: 2.6, peak: 0.95, ring: 2, level: 0.8, send: 0.15 },
  snare: { k: 'snare', secs: 0.3, peak: 0.7, ring: 3, level: 0.6, send: 0.2, pan: 0.05 },
  rim:   { k: 'snare', tone: 4600, secs: 0.25, peak: 0.45, ring: 3, level: 0.5, send: 0.15, pan: -0.25 },
  hat:   { k: 'hat', secs: 0.18, peak: 0.32, ring: 2, level: 0.55, pan: 0.3 },
  ohat:  { k: 'hat', open: true, secs: 0.7, peak: 0.3, ring: 2, level: 0.45, pan: 0.3, send: 0.1 },
  crash: { k: 'crash', dec: 1.1, secs: 3.6, peak: 0.45, ring: 2, level: 0.5, send: 0.25, pan: -0.15 },
  tom:   { k: 'tom', n: 45, base: 45, secs: 0.6, peak: 0.7, ring: 4, level: 0.6, send: 0.2, pan: -0.1 },
  clank: { k: 'clank', f: 420, secs: 0.9, peak: 0.5, ring: 3, level: 0.4, send: 0.35, pan: 0.2 },
  bass:  { k: 'bass', n: 38, base: 38, cut: 420, env: 1300, secs: 1.4, peak: 0.75, ring: 4, level: 0.62 },
  sub:   { k: 'bass', n: 38, base: 38, cut: 170, env: 160, sub: 0.95, width: 0.5, secs: 3.2, loop: [0.5, 3.1], peak: 0.75, ring: 3, level: 0.6 },
  pad:   { k: 'pad', ns: [60], base: 60, att: 0.3, cut: 1500, secs: 4.4, loop: [1.0, 4.3], peak: 0.5, ring: 10, level: 0.42, send: 0.45, sus: true },
  dark:  { k: 'pad', ns: [60], base: 60, att: 0.6, cut: 620, secs: 4.4, loop: [1.0, 4.3], peak: 0.55, ring: 10, level: 0.48, send: 0.5, sus: true },
  trem:  { k: 'pad', ns: [60], base: 60, att: 0.05, cut: 2300, trem: 7, secs: 4.4, loop: [1.0, 4.3], peak: 0.45, ring: 8, level: 0.34, send: 0.35, sus: true, pan: 0.15 },
  pluck: { k: 'pluck', n: 60, base: 60, dec: 0.32, cut: 1300, secs: 1.5, peak: 0.55, ring: 6, level: 0.4, send: 0.4, pan: -0.3 },
  bell:  { k: 'bell', n: 72, base: 72, dec: 0.9, secs: 3.4, peak: 0.5, ring: 4, level: 0.36, send: 0.55, pan: 0.25 },
  lead:  { k: 'lead', n: 60, base: 60, cut: 2400, secs: 2.6, loop: [0.9, 2.5], peak: 0.5, ring: 3, level: 0.36, send: 0.3, sus: true },
  riser: { k: 'riser', secs: 2.2, peak: 0.45, ring: 2, level: 0.45, send: 0.2 },
  hit:   { k: 'hit', secs: 2.8, peak: 0.9, ring: 2, level: 0.62, send: 0.3 },
  wind:  { k: 'wind', secs: 4.5, peak: 0.4, ring: 2, level: 0.4, send: 0.2, pan: -0.2 },
};
export const CHANNELS = Object.keys(KIT);
const CH_INDEX = Object.fromEntries(CHANNELS.map((c, i) => [c, i]));

// Renders the kit a slice at a time (a generator, like music-synth's renderTrack): name -> Float32Array.
export function* renderKit(sr = MUSIC_RATE) {
  const out = {};
  let seed = 501;
  for (const name of CHANNELS) {
    const spec = KIT[name];
    const ev = { ...spec };
    if (spec.k === 'riser' || spec.k === 'wind') ev.dur = spec.secs;
    out[name] = yield* renderSample(ev, sr, seed++);
    yield;
  }
  return out;
}

const rateOf = (n, base) => Math.pow(2, (n - base) / 12);

class Deck {
  constructor(seq, idx) {
    const ctx = seq.ctx;
    this.seq = seq; this.idx = idx;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.out.connect(seq.bus);
    this.send = ctx.createGain(); this.send.gain.value = 1;
    this.send.connect(seq.echoIn);
    this.ch = CHANNELS.map(name => {
      const k = KIT[name], g = ctx.createGain();
      g.gain.value = k.level ?? 0.5;
      let tail = g;
      if (k.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = k.pan; g.connect(p); tail = p; }
      tail.connect(this.out);
      if (k.send) { const s = ctx.createGain(); s.gain.value = k.send; g.connect(s); s.connect(this.send); }
      const ring = [];
      for (let i = 0; i < (k.ring ?? 3); i++) { const v = ctx.createGain(); v.gain.value = 0; v.connect(g); ring.push({ g: v, src: null, end: 0 }); }
      return { name, k, g, ring, ri: 0 };
    });
    this.theme = null; this.themeId = null;
    this.level = 0; this.want = 0; this.transpose = 0;
    this.t0 = 0; this.bar = 0; this.spb = 0.5; this.barDur = 2; this.swing = 0;
    this.live = false; this.until = Infinity;   // Scheduling stops after `until` (a deck fading out).
    this.notes = 0;
  }

  start(themeId, level, at, transpose = 0) {
    const th = THEMES[themeId];
    this.theme = th; this.themeId = themeId;
    this.level = this.want = level; this.transpose = transpose;
    this.spb = 60 / th.bpm; this.barDur = this.spb * 4; this.swing = th.swing ?? 0;
    this.t0 = at; this.bar = 0; this.live = true; this.until = Infinity;
  }

  nextBarAt() { return this.t0 + this.bar * this.barDur; }

  // Every note of one bar, on the audio clock.
  scheduleBar(now) {
    const at = this.nextBarAt();
    this.level = this.want;
    this.barAt = at;
    this.nowAt = now;
    this.theme.bar(this.bar, this.level, this.emitFn ??= (ch, beat, n, len, vel) => this.emit(ch, beat, n, len, vel), this.theme.state);
    this.bar++;
  }

  // ch: channel name; beat: 0..4 within the bar (may run past 4 for a pickup into the next); n: MIDI note (pitched
  // channels; 0 for drums); len: beats held (sustained channels); vel: 0..1.
  emit(ch, beat, n, len, vel) {
    const c = this.ch[CH_INDEX[ch]];
    if (!c) return;
    const buf = this.seq.bufs[ch];
    if (!buf) return;
    // Swing: the off sixteenths come late by this share of a sixteenth.
    if (this.swing) { const q = beat * 4, i = Math.round(q); if (Math.abs(q - i) < 1e-6 && (i & 1)) beat += this.swing * 0.25; }
    const t = this.barAt + beat * this.spb;
    if (t < this.nowAt) return;               // Late (a stalled timer): drop it rather than play it out of time.
    const ctx = this.seq.ctx, k = c.k;
    const slot = c.ring[c.ri]; c.ri = (c.ri + 1) % c.ring.length;
    const gp = slot.g.gain;
    if (slot.src && slot.end > t) {
      // The ring came round to a note still sounding (a hat choking the last one): a 4 ms fade, then the new note.
      const from = Math.max(this.nowAt, t - 0.006);
      gp.cancelScheduledValues(from); gp.setTargetAtTime(0, from, 0.0015);
      try { slot.src.stop(t); } catch { /* stopped */ }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (k.base !== undefined && n) src.playbackRate.value = rateOf(n + this.transpose, k.base);
    const rate = src.playbackRate.value;
    let end;
    if (k.sus && k.loop) {
      src.loop = true; src.loopStart = k.loop[0]; src.loopEnd = k.loop[1];
      const off = t + Math.max(0.05, len * this.spb), rel = ch === 'lead' ? 0.12 : ch === 'sub' ? 0.15 : 0.9;
      gp.setValueAtTime(vel, t);
      gp.setTargetAtTime(0, off, rel / 4);
      end = off + rel * 1.4;
    } else if (k.loop && len) {      // A sub note: held, then let go.
      src.loop = true; src.loopStart = k.loop[0]; src.loopEnd = k.loop[1];
      const off = t + len * this.spb;
      gp.setValueAtTime(vel, t);
      gp.setTargetAtTime(0, off, 0.04);
      end = off + 0.25;
    } else {
      gp.setValueAtTime(vel, t);
      end = t + buf.duration / rate;
      if (len && k.base !== undefined) { const off = t + len * this.spb; if (off < end) { gp.setTargetAtTime(0, off, 0.03); end = off + 0.2; } }
    }
    src.connect(slot.g);
    src.start(t);
    src.stop(end);
    slot.src = src; slot.end = end;
    this.notes++;
    this.seq.notes++;
  }

  // Silences everything already scheduled (a hidden page, music switched off).
  hush(now) {
    for (const c of this.ch) for (const s of c.ring) {
      if (!s.src) continue;
      s.g.gain.cancelScheduledValues(now); s.g.gain.setValueAtTime(0, now);
      try { s.src.stop(now); } catch { /* stopped */ }
      s.src = null; s.end = 0;
    }
    this.live = false;
  }
}

export class Sequencer {
  constructor() {
    this.ctx = null; this.bufs = {}; this.decks = []; this.cur = -1;
    this.timer = 0; this.running = false;
    this.notes = 0; this.ticks = 0; this.tickMs = 0; this.maxTickMs = 0;
    this.bytes = 0;
    this.pending = null;        // { id, level, transpose }: what to play once the kit is ready.
    this.manual = false;        // Tests and offline renders call tick() themselves.
  }

  // out: where the music goes (the director's loop bus).
  attach(ctx, out) {
    this.ctx = ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = 1; this.bus.connect(out);
    // The space: a dotted-eighth echo with a damped feedback loop and a short second tap for width. Two delay lines,
    // far cheaper than a second convolver.
    this.echoIn = ctx.createGain(); this.echoIn.gain.value = 0.32;
    this.delay = ctx.createDelay(1.5); this.delay.delayTime.value = 0.43;
    this.fb = ctx.createGain(); this.fb.gain.value = 0.36;
    this.damp = ctx.createBiquadFilter(); this.damp.type = 'lowpass'; this.damp.frequency.value = 2400; this.damp.Q.value = 0.4;
    this.echoIn.connect(this.delay); this.delay.connect(this.damp); this.damp.connect(this.fb); this.fb.connect(this.delay);
    this.diff = ctx.createDelay(0.2); this.diff.delayTime.value = 0.047;
    this.echoIn.connect(this.diff);
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    this.damp.connect(wet); this.diff.connect(wet); wet.connect(this.bus);
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = -0.35; this.diff.disconnect(); this.diff.connect(p); p.connect(wet); }
    this.decks = [new Deck(this, 0), new Deck(this, 1)];
    this.cur = -1;
  }

  detach() { this.stop(0); this.ctx = null; this.decks = []; this.bufs = {}; }

  setKit(bufs, bytes = 0) {
    this.bufs = bufs; this.bytes = bytes;
    if (this.pending) { const p = this.pending; this.pending = null; this.play(p.id, p.level, p.transpose); }
  }
  get ready() { return !!this.bufs.kick; }

  get themeId() { const d = this.decks[this.cur]; return d && d.live ? d.themeId : null; }
  get level() { const d = this.decks[this.cur]; return d && d.live ? d.want : -1; }

  // What to play. Same theme: only the level moves (at the next bar line). Another theme: crossfade at the old one's
  // next bar line. Called every frame by the director; cheap when nothing changes.
  play(id, level = 0, transpose = 0) {
    if (!this.ctx || !THEMES[id]) return;
    if (!this.ready) { this.pending = { id, level, transpose }; return; }
    const cur = this.decks[this.cur];
    if (cur && cur.live && cur.themeId === id && cur.until === Infinity) {
      if (cur.want !== level) cur.want = level;
      cur.transpose = transpose;
      return;
    }
    const now = this.ctx.currentTime;
    const next = this.cur < 0 ? 0 : 1 - this.cur, d = this.decks[next];
    d.hush(now);         // Whatever this deck last played (a fade-out, or a third change inside one crossfade) goes.
    let at = now + 0.06;
    if (cur && cur.live && cur.until === Infinity) {
      const nb = cur.nextBarAt();
      at = nb - now < 0.06 ? nb + cur.barDur : nb;
      if (at - now > 2.5) at = now + 0.06;          // A slow bar: do not keep the player waiting.
      cur.until = at;
      const g = cur.out.gain;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
      g.setTargetAtTime(0, at, FADE / 4);
      cur.stopAt = at + FADE * 1.5;
    }
    d.start(id, level, at, transpose);
    const g = d.out.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(0, now);
    const lift = THEMES[id].gain ?? 1;
    // A theme coming in from silence fades in quickly; one replacing another takes the crossfade.
    g.setTargetAtTime(lift, at, (cur && cur.live ? FADE : 0.8) / 4);
    this.cur = next;
    this.delay.delayTime.setTargetAtTime(Math.min(1.4, d.spb * 0.75), now, 0.3);
    this.#run();
  }

  // Fades the music out and stops scheduling.
  stop(fade = 1.5) {
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    this.running = false;
    this.pending = null;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const d of this.decks) {
      if (!d.live) continue;
      if (fade <= 0) { d.hush(now); d.out.gain.cancelScheduledValues(now); d.out.gain.setValueAtTime(0, now); continue; }
      d.out.gain.cancelScheduledValues(now); d.out.gain.setValueAtTime(d.out.gain.value, now);
      d.out.gain.setTargetAtTime(0, now, fade / 4);
      d.live = false;          // What is scheduled plays out under the fade; nothing more is added.
    }
    this.cur = -1;
  }

  #run() {
    if (this.timer || this.manual || typeof setInterval === 'undefined') return;
    this.running = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  // Schedules every bar that starts within AHEAD seconds. Also callable by hand (tests, an offline render).
  tick(now = this.ctx?.currentTime) {
    if (!this.ctx) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let any = false;
    for (const d of this.decks) {
      if (!d.live) continue;
      if (d.until !== Infinity && now >= d.stopAt) { d.live = false; continue; }
      any = true;
      // A stall longer than a bar: skip to the next bar line rather than bunch up what was missed.
      if (d.nextBarAt() < now - 0.05) d.bar = Math.ceil((now - d.t0) / d.barDur);
      while (d.nextBarAt() < now + AHEAD && d.nextBarAt() < d.until) d.scheduleBar(now);
    }
    if (!any && this.timer) { clearInterval(this.timer); this.timer = 0; this.running = false; }
    if (t0) { const ms = performance.now() - t0; this.ticks++; this.tickMs += ms; if (ms > this.maxTickMs) this.maxTickMs = ms; }
  }

  stats() {
    return { notes: this.notes, ticks: this.ticks, avgTickMs: this.ticks ? +(this.tickMs / this.ticks).toFixed(3) : 0, maxTickMs: +this.maxTickMs.toFixed(2), bytes: this.bytes, theme: this.themeId, level: this.level };
  }
}
