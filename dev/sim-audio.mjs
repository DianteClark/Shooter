// Node tests for the live match music (docs/AUDIO.md): the kit (js/audio/music-seq.js KIT), every theme at every
// level (js/audio/music-themes.js), the lookahead scheduler on a stand-in AudioContext with a clock we move by hand,
// the theme state machine (pickTheme) across every mode family, and the director (js/audio/music.js) driving it all.
// Run: node dev/sim-audio.mjs [wav]     `wav` also renders short previews of every theme to /tmp/audio/node/ (a node
// mixdown of exactly what the scheduler asks the AudioContext to play: same notes, rates, gains and loop points).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KIT, CHANNELS, renderKit, Sequencer, AHEAD, TICK_MS } from '../js/audio/music-seq.js';
import { THEMES, THEME_IDS, pickTheme, pickEvent, newPickState, baseTheme, MISSION_MOOD } from '../js/audio/music-themes.js';
import { MUSIC_RATE } from '../js/audio/music-synth.js';

const WAV = process.argv.includes('wav');
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

// ---- A stand-in AudioContext that records what it is asked to do, with automation timelines we can evaluate. ----
class Param {
  constructor(v = 1) { this.ev = []; this.value = v; }
  // A value assigned directly before any automation is where the timeline starts.
  set value(v) { this._v = v; if (!this.ev.length) this.base = v; }
  get value() { return this._v; }
  setValueAtTime(v, t) { this.ev.push(['set', t, v]); this.value = v; }
  setTargetAtTime(v, t, tc) { this.ev.push(['target', t, v, tc]); }
  linearRampToValueAtTime(v, t) { this.ev.push(['ramp', t, v]); }
  cancelScheduledValues(t) { this.ev = this.ev.filter(e => e[1] < t); }
  // The value at time t (set / target only: what the code uses).
  at(t) {
    let v = this.base ?? 1, from = -Infinity, target = null;
    const ev = [...this.ev].sort((a, b) => a[1] - b[1]);
    for (const e of ev) {
      if (e[1] > t) break;
      if (target) v = target[2] + (v - target[2]) * Math.exp(-(e[1] - from) / target[3]);
      if (e[0] === 'set') { v = e[2]; target = null; } else if (e[0] === 'target') { target = e; }
      from = e[1];
    }
    if (target) v = target[2] + (v - target[2]) * Math.exp(-(t - from) / target[3]);
    return v;
  }
}
let nodes = 0;
class Node { constructor() { nodes++; this.outs = []; } connect(n) { this.outs.push(n); return n; } disconnect() { this.outs = []; } }
class FakeCtx {
  constructor() { this.currentTime = 0; this.state = 'running'; this.sources = []; this.gains = 0; this.sampleRate = 48000; }
  createGain() { const n = new Node(); n.gain = new Param(1); this.gains++; return n; }
  createBiquadFilter() { const n = new Node(); n.frequency = new Param(350); n.Q = new Param(1); return n; }
  createDelay() { const n = new Node(); n.delayTime = new Param(0); return n; }
  createStereoPanner() { const n = new Node(); n.pan = new Param(0); return n; }
  createBuffer(ch, len, sr) { const data = new Float32Array(len); return { duration: len / sr, length: len, sampleRate: sr, getChannelData: () => data }; }
  createBufferSource() {
    const s = new Node(); s.playbackRate = new Param(1); s.loop = false; s.loopStart = 0; s.loopEnd = 0;
    s.start = (when = 0, offset = 0) => { s.startedAt = when; s.offset = offset; this.sources.push(s); };
    s.stop = (when = 0) => { s.stopAt = when; };
    return s;
  }
}

// ---- The kit, rendered once. ----
const c0 = cpu();
const kitIt = renderKit();
let kr, maxSlice = 0;
do { const t = cpu(); kr = kitIt.next(); maxSlice = Math.max(maxSlice, cpu() - t); } while (!kr.done);
const kit = kr.value, kitMs = cpu() - c0;
let kitBytes = 0;
for (const d of Object.values(kit)) kitBytes += d.byteLength;

await test('the kit: every sample renders, finite, at its peak, and the held ones loop without a click', () => {
  assert.deepEqual(Object.keys(kit), CHANNELS);
  for (const [name, d] of Object.entries(kit)) {
    const spec = KIT[name];
    assert.equal(d.length, Math.round(spec.secs * MUSIC_RATE), `${name} length`);
    let m = 0;
    for (let i = 0; i < d.length; i++) { assert.ok(Number.isFinite(d[i]), `${name} sample ${i}`); m = Math.max(m, Math.abs(d[i])); }
    assert.ok(Math.abs(m - spec.peak) < 0.01, `${name} peak ${m}`);
    if (spec.loop) {
      const a = Math.round(spec.loop[0] * MUSIC_RATE), b = Math.round(spec.loop[1] * MUSIC_RATE);
      const steps = [];
      for (let i = a + 1; i < b; i++) steps.push(Math.abs(d[i] - d[i - 1]));
      steps.sort((x, y) => x - y);
      const p999 = steps[Math.floor(steps.length * 0.999)], seam = Math.abs(d[a] - d[b - 1]);
      assert.ok(seam <= p999, `${name} loop seam ${seam.toFixed(4)} vs p99.9 step ${p999.toFixed(4)}`);
    } else {
      assert.ok(Math.abs(d[d.length - 1]) < 1e-3, `${name} ends in silence`);
    }
  }
  console.log(`     ${Object.keys(kit).length} samples, ${(kitBytes / 1048576).toFixed(2)} MB, ${Math.round(kitMs)} ms CPU to render, largest slice ${maxSlice.toFixed(1)} ms`);
  assert.ok(kitBytes < 4.5 * 1048576, 'kit under 4.5 MB');
});

await test('every theme at every level: valid notes, in each channel\'s range, denser as the level rises', () => {
  for (const id of THEME_IDS) {
    const th = THEMES[id];
    assert.ok(th.bpm >= 60 && th.bpm <= 150, `${id} bpm`);
    const counts = [];
    for (let L = 0; L < 4; L++) {
      let n = 0;
      for (let b = 0; b < 16; b++) {
        th.bar(b, L, (ch, beat, note, len, vel) => {
          n++;
          const k = KIT[ch];
          assert.ok(k, `${id}: unknown channel ${ch}`);
          assert.ok(beat >= 0 && beat < 4.01, `${id} ${ch} beat ${beat}`);
          assert.ok(vel > 0 && vel <= 1.0001, `${id} ${ch} vel ${vel}`);
          if (k.base !== undefined && note) {
            const rate = 2 ** ((note - k.base) / 12);
            assert.ok(rate > 0.4 && rate < 3.5, `${id} ${ch} note ${note} rate ${rate}`);
          }
          if (k.sus) assert.ok(len > 0, `${id} ${ch} held note needs a length`);
        });
      }
      counts.push(n);
    }
    assert.ok(counts[3] >= counts[0], `${id} level 3 (${counts[3]}) at least as busy as level 0 (${counts[0]})`);
    console.log(`     ${id.padEnd(9)} ${th.bpm} bpm, notes per 16 bars by level: ${counts.join(' / ')}`);
  }
});

// ---- The scheduler. ----
function makeSeq() {
  const ctx = new FakeCtx(), seq = new Sequencer();
  seq.manual = true;
  seq.attach(ctx, new Node());
  const bufs = {};
  for (const [k, d] of Object.entries(kit)) { const b = ctx.createBuffer(1, d.length, MUSIC_RATE); b.getChannelData(0).set(d); bufs[k] = b; }
  seq.setKit(bufs, kitBytes);
  return { ctx, seq };
}
// Runs the clock forward like the timer would, `dt` seconds a tick.
function run(ctx, seq, secs, dt = TICK_MS / 1000) {
  const end = ctx.currentTime + secs;
  while (ctx.currentTime < end - 1e-9) { ctx.currentTime = +(ctx.currentTime + dt).toFixed(6); seq.tick(ctx.currentTime); }
}

await test('scheduler: bars back to back on the audio clock, nothing in the past, no node made per note but the source', () => {
  const { ctx, seq } = makeSeq();
  const gains0 = ctx.gains;
  seq.play('tdm', 2);
  seq.tick(0);
  assert.equal(seq.themeId, 'tdm');
  run(ctx, seq, 30);
  const d = seq.decks[seq.cur], bar = 60 / THEMES.tdm.bpm * 4;
  assert.ok(Math.abs(d.t0 - 0.06) < 1e-9, 'starts just after now');
  assert.equal(d.bar, Math.floor((30 + AHEAD - d.t0) / bar) + 1, 'every bar due within the lookahead is scheduled, and no more');
  for (const s of ctx.sources) assert.ok(s.startedAt >= 0 && s.stopAt > s.startedAt, 'start and stop in order');
  assert.equal(ctx.gains, gains0, 'no GainNode made while playing (rings are reused)');
  // Each note was scheduled ahead of its time: the latest any source was asked to start is AHEAD + a bar past the clock.
  const latest = Math.max(...ctx.sources.map(s => s.startedAt));
  assert.ok(latest < 30 + AHEAD + bar, `latest start ${latest}`);
  console.log(`     30 s of Team Deathmatch at level 2: ${ctx.sources.length} notes (${(ctx.sources.length / 30).toFixed(1)} a second), ${ctx.gains} gains built once`);
});

await test('scheduler: a level change waits for the next bar line', () => {
  const { ctx, seq } = makeSeq();
  seq.play('tdm', 0); seq.tick(0);
  run(ctx, seq, 3.1);
  const d = seq.decks[seq.cur], nb = d.nextBarAt();
  const n0 = ctx.sources.length;
  seq.play('tdm', 3);
  assert.equal(d.level, 0, 'the bar already scheduled keeps its level');
  run(ctx, seq, 6);
  const leads = ctx.sources.slice(n0).filter(s => s.buffer === seq.bufs.crash || s.buffer === seq.bufs.snare);
  assert.ok(leads.length > 0 && leads.every(s => s.startedAt >= nb - 1e-9), 'level 3 notes only from the next bar on');
  assert.equal(d.level, 3);
});

await test('scheduler: a theme change crossfades on the old theme\'s next bar line', () => {
  const { ctx, seq } = makeSeq();
  seq.play('tdm', 1); seq.tick(0);
  run(ctx, seq, 5);
  const old = seq.decks[seq.cur], nb = old.nextBarAt();
  seq.play('brfinal', 2);
  const neu = seq.decks[seq.cur];
  assert.notEqual(old, neu);
  assert.ok(Math.abs(neu.t0 - nb) < 1e-9, 'new theme starts on the old one\'s bar line');
  assert.equal(old.until, nb, 'the old theme stops scheduling there');
  run(ctx, seq, 8);
  assert.ok(old.out.gain.at(nb + 3) < 0.15 && neu.out.gain.at(nb + 3) > 0.7, `crossfaded (${old.out.gain.at(nb + 3).toFixed(2)} / ${neu.out.gain.at(nb + 3).toFixed(2)})`);
  assert.ok(!old.live, 'old deck retired');
  const lateOld = ctx.sources.filter(s => s.startedAt >= nb && old.ch.some(c => c.ring.some(r => r.src === s)));
  assert.equal(lateOld.length, 0, 'nothing from the old theme after the switch');
  // Three changes in quick succession: never more than two decks sound.
  seq.play('tdm', 1); seq.play('gw', 1); seq.play('zm', 0);
  assert.equal(seq.decks.filter(d => d.live).length <= 2, true);
  assert.equal(seq.themeId, 'zm');
});

await test('scheduler: a stalled timer skips to the next bar line instead of bunching notes', () => {
  const { ctx, seq } = makeSeq();
  seq.play('cpchase', 3); seq.tick(0);
  run(ctx, seq, 4);
  const n0 = ctx.sources.length;
  ctx.currentTime += 6.3;            // The page was busy for six seconds.
  seq.tick(ctx.currentTime);
  const added = ctx.sources.slice(n0);
  assert.ok(added.every(s => s.startedAt >= ctx.currentTime - 1e-9), 'nothing scheduled in the past');
  assert.ok(added.length < 120, `no burst (${added.length} notes in one tick)`);
});

await test('scheduler: stop(0) silences every scheduled note; stop with a fade lets them ring under it', () => {
  const { ctx, seq } = makeSeq();
  seq.play('gw', 3); seq.tick(0);
  run(ctx, seq, 3);
  seq.stop(0);
  const now = ctx.currentTime;
  for (const d of seq.decks) for (const c of d.ch) for (const r of c.ring) assert.equal(r.src, null);
  // Anything still scheduled past now (a note the ring had already handed on) sits behind a gain held at zero.
  assert.ok(ctx.sources.every(s => s.stopAt <= now + 1e-9 || s.outs[0].gain.at(now + 0.01) < 1e-3), 'nothing audible after stop(0)');
  assert.equal(seq.themeId, null);
  seq.play('gw', 1); seq.tick(ctx.currentTime);
  run(ctx, seq, 1);
  seq.stop(1.5);
  assert.equal(seq.themeId, null);
  assert.ok(seq.decks.every(d => d.out.gain.at(ctx.currentTime + 3) < 0.01), 'faded');
});

await test('scheduler: cheap: tick cost and notes a second across every theme at its peak', () => {
  const { ctx, seq } = makeSeq();
  let notes = 0, ms = 0, ticks = 0;
  for (const id of THEME_IDS) {
    const n0 = ctx.sources.length;
    seq.play(id, 3); seq.tick(ctx.currentTime);
    const t = cpu(), k0 = seq.ticks;
    run(ctx, seq, 20);
    ms += cpu() - t; ticks += seq.ticks - k0;
    notes = Math.max(notes, (ctx.sources.length - n0) / 20);
    seq.stop(0);
  }
  console.log(`     busiest theme: ${notes.toFixed(1)} notes a second; ${(ms / ticks).toFixed(3)} ms CPU a tick (one every ${TICK_MS} ms, node on a shared machine)`);
  assert.ok(notes < 40, 'under 40 notes a second');
  assert.ok(ms / ticks < 1, 'under a millisecond a tick');
});

// ---- The state machine. ----
const P = (o = {}) => ({ id: 'me', alive: true, team: 0, ...o });
function pick(info, view, opts = {}) {
  const st = opts.st ?? newPickState();
  const s = pickTheme(st, info, view, opts.me ?? view.players?.[0] ?? null, opts.fight ?? 0, opts.closing ?? false, opts.now ?? 0);
  return { theme: st.theme, level: st.level, transpose: st.transpose, sting: s, st };
}
const V = (o = {}) => ({ phase: 'live', mode: 'tdm', players: [P()], timeLeft: 400, scores: [0, 0], br: null, ...o });

await test('state machine: standard modes, ranked, Ground War, round modes; fights and the last minute', () => {
  const tdm = { mode: 'tdm', rules: 'tdm' };
  assert.deepEqual([pick(tdm, V({ phase: 'warmup' })).theme, pick(tdm, V({ phase: 'warmup' })).level], ['tdm', 0]);
  assert.equal(pick(tdm, V()).level, 1);
  const st = newPickState();
  assert.equal(pick(tdm, V(), { st, fight: 0.9, now: 10 }).level, 2, 'a firefight lifts it');
  assert.equal(pick(tdm, V(), { st, fight: 0, now: 15 }).level, 2, 'and holds it a while');
  assert.equal(pick(tdm, V(), { st, fight: 0, now: 19 }).level, 1, 'then lets go');
  const r = pick(tdm, V({ timeLeft: 45 }), { st, now: 30 });
  assert.equal(r.level, 3); assert.equal(r.sting, 'matchPoint');
  assert.equal(pick(tdm, V({ timeLeft: 44 }), { st, now: 31 }).sting, null, 'the sting plays once');
  assert.equal(pick(tdm, V(), { closing: true }).level, 3, 'the last kills');
  assert.equal(pick({ mode: 'tdm', rules: 'tdm', ranked: true }, V()).theme, 'ranked');
  assert.equal(pick({ mode: 'gwdom', rules: 'dom', large: true }, V()).theme, 'gw');
  for (const m of ['snd', 'ctl', 'gf', 'oic']) assert.equal(pick({ mode: m, rules: m }, V()).theme, 'tactical', m);
  for (const m of ['kc', 'dom', 'hard', 'ffa', 'gun', 'ctf', 'hq', 'ko', 'grind']) assert.equal(pick({ mode: m, rules: m }, V()).theme, 'tdm', m);
  assert.equal(pick({ mode: 'range', rules: 'range' }, V()).theme, null, 'no music on the range');
  assert.equal(pick(tdm, V({ phase: 'ended' })).theme, null, 'none after the end');
});

await test('state machine: battle royale: the drop, calm early, tension as the circle closes, the final circle', () => {
  const br = { mode: 'br', rules: 'br', large: true };
  const v = o => V({ mode: 'br', br: { state: 'wait', phase: 0, squadsLeft: 8, alive: 32, ...o } });
  assert.deepEqual([pick(br, v(), { me: P({ air: 1 }) }).theme, pick(br, v(), { me: P({ air: 1 }) }).level], ['brdrop', 3]);
  assert.deepEqual([pick(br, v()).theme, pick(br, v()).level], ['br', 0], 'calm on landing');
  assert.equal(pick(br, v({ phase: 2 })).level, 1);
  assert.equal(pick(br, v({ phase: 2, state: 'shrink' })).level, 2, 'the circle closing');
  assert.equal(pick(br, v({ phase: 4, state: 'shrink' })).level, 3);
  assert.deepEqual([pick(br, v({ state: 'final', phase: 6 })).theme, pick(br, v({ state: 'final', phase: 6 })).level], ['brfinal', 2]);
  assert.equal(pick(br, v({ state: 'final', phase: 6, squadsLeft: 2 })).level, 3, 'the last two squads');
});

await test('state machine: Extraction, exfil called by your squad (not another), and the final exfil', () => {
  const ex = { mode: 'exq', rules: 'ex', large: true };
  const st = newPickState();
  const v = V({ mode: 'exq', obj: { length: 900, t: 100 } });
  assert.deepEqual([pick(ex, v, { st }).theme, pick(ex, v, { st }).level], ['ex', 0]);
  pickEvent(st, { t: 'excall', team: 1, site: 2 }, 0);
  assert.equal(pick(ex, v, { st }).theme, 'ex', 'another squad\'s call is not ours');
  pickEvent(st, { t: 'excall', team: 0, site: 3 }, 0);
  assert.deepEqual([pick(ex, v, { st }).theme, pick(ex, v, { st }).level], ['exfil', 2]);
  pickEvent(st, { t: 'exleave', site: 2 }, 0);
  assert.equal(pick(ex, v, { st }).theme, 'exfil', 'another site\'s helicopter leaving changes nothing');
  pickEvent(st, { t: 'exwindow', final: true }, 0);
  assert.equal(pick(ex, v, { st }).level, 3);
  pickEvent(st, { t: 'exleave', site: 3 }, 0);
  assert.equal(pick(ex, v, { st }).theme, 'ex', 'ours left');
  assert.equal(pick(ex, V({ mode: 'exq', obj: { length: 900, t: 820 } })).level, 2, 'the last two minutes');
});

await test('state machine: Graveyard Shift intensifies by round, eases in the break, the boss gets his theme and a sting', () => {
  const zm = { mode: 'zm', rules: 'zm' };
  const v = (round, state = 'round', boss = null) => V({ mode: 'zm', obj: { zm: true, round, state, boss } });
  assert.deepEqual([1, 4, 7, 12].map(r => pick(zm, v(r)).level), [0, 1, 2, 3]);
  assert.equal(pick(zm, v(7, 'break')).level, 0, 'the break between rounds');
  const st = newPickState();
  const b = pick(zm, v(10), { st });
  assert.deepEqual([b.theme, b.sting], ['zmboss', 'boss']);
  assert.equal(pick(zm, v(10, 'round', { hp: 0.8 }), { st }).sting, null, 'one sting a boss');
  assert.equal(pick(zm, v(10, 'round', { hp: 0.2 }), { st }).level, 3, 'his last third');
  assert.equal(pick(zm, v(11), { st }).theme, 'zm');
  assert.equal(pick(zm, v(13, 'round', { hp: 1, warden: true }), { st }).sting, 'boss', 'the quest boss rising');
});

await test('state machine: the campaign: a mood per mission, the alarm, the boss', () => {
  for (const [n, [theme, tr]] of Object.entries(MISSION_MOOD)) {
    const r = pick({ mode: 'cp', rules: 'cp', mission: +n }, V({ mode: 'cp', obj: { cp: true } }));
    assert.deepEqual([r.theme, r.transpose], [theme, tr], `mission ${n}`);
  }
  const m2 = { mode: 'cp', rules: 'cp', mission: 2 };
  assert.equal(pick(m2, V({ mode: 'cp', obj: { cp: true } })).level, 1);
  assert.equal(pick(m2, V({ mode: 'cp', obj: { cp: true, alarm: true } })).level, 2, 'the alarm');
  const st = newPickState(), m8 = { mode: 'cp', rules: 'cp', mission: 8 };
  const b = pick(m8, V({ mode: 'cp', obj: { cp: true, boss: { frac: 1 } } }), { st });
  assert.deepEqual([b.theme, b.level, b.sting], ['cpboss', 2, 'boss']);
  pickEvent(st, { t: 'cpphase', n: 2 }, 0);
  assert.equal(pick(m8, V({ mode: 'cp', obj: { cp: true, boss: { frac: 0.5 } } }), { st }).level, 3, 'his last phase');
  assert.equal(pick(m8, V({ mode: 'cp', obj: { cp: true, timer: 20 } })).level, 3, 'a timer running out');
});

await test('state machine: Infected follows the survivors', () => {
  const inf = { mode: 'inf', rules: 'inf' };
  const ps = n => Array.from({ length: 12 }, (_, i) => P({ id: 'p' + i, team: i < n ? 0 : 1 }));
  assert.equal(pick(inf, V({ mode: 'inf', players: ps(12), obj: { started: false } })).level, 0);
  assert.equal(pick(inf, V({ mode: 'inf', players: ps(10), obj: { started: true } })).level, 1);
  assert.equal(pick(inf, V({ mode: 'inf', players: ps(5), obj: { started: true } })).level, 2);
  assert.equal(pick(inf, V({ mode: 'inf', players: ps(1), obj: { started: true } })).level, 3);
  assert.equal(baseTheme({ mode: 'gwinf', rules: 'inf', large: true })[0], 'inf', 'Ground War Infected is Infected');
});

// ---- The director with the sequencer. ----
await test('director: match themes play, follow the mode setting, the hidden page, voices and radio', async () => {
  globalThis.document = undefined;
  const { Music } = await import('../js/audio/music.js');
  const m = new Music();
  const ctx = new FakeCtx();
  const engine = { ctx, music: new Node(), whenReady: Promise.resolve(), fight: 0, micActive: false, localId: 'me', tension: false, musicVolume: 0.6 };
  m.seq.manual = true;
  m.attach(engine);
  await m.whenBuilt;
  assert.ok(m.stats().kit, 'kit built with the stems');
  m.match({ mode: 'gwtdm', rules: 'tdm', large: true });
  const view = V({ mode: 'gwtdm', phase: 'warmup' });
  m.frame(view);
  assert.deepEqual(m.nowPlaying(), ['theme:gw:0']);
  view.phase = 'live'; m.frame(view);
  assert.deepEqual(m.nowPlaying(), ['theme:gw:1']);
  assert.ok(m.ownsTension, 'the engine\'s tension loop gives way');
  engine.fight = 1; ctx.currentTime = 2; m.frame(view);
  assert.deepEqual(m.nowPlaying(), ['theme:gw:2'], 'a firefight lifts the level');
  assert.ok(m.duckLevel < 0.6, 'and pushes the volume down');
  engine.fight = 0; ctx.currentTime = 20;     // The firefight's hold runs out.
  m.talk(true); m.frame(view);
  assert.ok(m.duckLevel < 0.6, 'a teammate talking ducks it');
  m.talk(false); m.frame(view);
  m.callout(2); m.frame(view);
  assert.ok(m.duckLevel <= 0.5, 'radio ducks it');
  m.radioUntil = 0; m.frame(view);
  // Settings.
  m.setMode('menus'); m.frame(view);
  assert.deepEqual(m.nowPlaying(), [], 'menus only: nothing under play');
  m.setMode('all'); m.frame(view);
  assert.deepEqual(m.nowPlaying(), ['theme:gw:1']);
  engine.musicVolume = 0; m.frame(view);
  assert.deepEqual(m.nowPlaying(), [], 'volume at zero: the scheduler stops (no CPU)');
  engine.musicVolume = 0.6; m.frame(view);
  m.hidden = true; m._apply(0); m.frame(view);
  assert.deepEqual(m.nowPlaying(), [], 'hidden page: silent');
  m.hidden = false; m._apply(1); m.frame(view);
  assert.deepEqual(m.nowPlaying(), ['theme:gw:1'], 'back');
  // The last minute: the match point sting and the peak.
  const n0 = ctx.sources.length;
  view.timeLeft = 50; m.frame(view);
  assert.deepEqual(m.nowPlaying(), ['theme:gw:3']);
  assert.ok(ctx.sources.slice(n0).some(s => s.buffer === m.bufs.matchPoint.main), 'match point sting');
  // Cues still work.
  m.cue('finalCircle'); m.frame(view);
  assert.deepEqual(m.nowPlaying(), ['theme:brfinal:3']);
  m.cue('finalCircle', false);
  // The end: the theme goes, the results take over.
  view.phase = 'ended'; m.frame(view);
  assert.deepEqual(m.nowPlaying(), []);
  m.results('loss');
  assert.equal(m.scene, 'results');
  // Extraction through events.
  m._scene('menu');
  m.match({ mode: 'exq', rules: 'ex', large: true });
  const ev = V({ mode: 'exq', obj: { length: 900, t: 10 } });
  m.frame(ev);
  assert.deepEqual(m.nowPlaying(), ['theme:ex:0']);
  m.onEvents([{ t: 'excall', team: 0, site: 1 }], 0); m.frame(ev);
  assert.deepEqual(m.nowPlaying(), ['theme:exfil:2']);
  m.detach();
});

// ---- Previews: a node mixdown of what the scheduler plays. ----
function mixdown(seqId, levels, secsPer, transpose = 0) {
  const SR = MUSIC_RATE, { ctx, seq } = makeSeq();
  seq.play(seqId, levels[0], transpose); seq.tick(0);
  const total = secsPer * levels.length, out = new Float32Array(Math.ceil((total + 3) * SR) * 2);
  for (let i = 1; i < levels.length; i++) {
    run(ctx, seq, secsPer - (i === 1 ? 0 : 0));
    seq.play(seqId, levels[i], transpose);
  }
  run(ctx, seq, secsPer);
  seq.stop(0.01);
  // Each source: through its ring gain (automation evaluated every 64 samples), channel level, pan, deck fade; plus
  // a simple echo for the send.
  const chanOf = new Map();
  for (const d of seq.decks) for (const c of d.ch) for (const r of c.ring) chanOf.set(r.g, [c, d]);
  const echo = new Float32Array(out.length);
  for (const s of ctx.sources) {
    const slotG = s.outs[0], [c, deck] = chanOf.get(slotG) ?? [];
    if (!c) continue;
    const data = s.buffer.getChannelData(0), rate = s.playbackRate.value, lvl = c.k.level ?? 0.5, pan = c.k.pan ?? 0;
    const L = Math.cos((pan + 1) * Math.PI / 4), Rr = Math.sin((pan + 1) * Math.PI / 4), send = c.k.send ?? 0;
    const i0 = Math.round(s.startedAt * SR), i1 = Math.min(out.length / 2, Math.round((s.stopAt ?? total) * SR));
    let pos = 0, g = 0, dg = 0;
    const ls = s.loopStart * s.buffer.sampleRate, le = s.loopEnd * s.buffer.sampleRate;
    for (let i = i0; i < i1; i++) {
      if (((i - i0) & 63) === 0) { const t = i / SR; g = slotG.gain.at(t) * deck.out.gain.at(t); dg = 0; }
      let p = pos | 0;
      if (s.loop && le > ls && pos >= le) { pos = ls + ((pos - ls) % (le - ls)); p = pos | 0; }
      if (p >= data.length - 1) break;
      const v = (data[p] + (data[p + 1] - data[p]) * (pos - p)) * g * lvl;
      out[i * 2] += v * L; out[i * 2 + 1] += v * Rr; echo[i] += v * send;
      pos += rate * s.buffer.sampleRate / SR;
    }
  }
  const D = Math.round(seq.decks[0].spb * 0.75 * SR) || Math.round(0.4 * SR);
  for (let i = D; i < out.length / 2; i++) echo[i] += echo[i - D] * 0.36;
  for (let i = 0; i < out.length / 2; i++) { out[i * 2] += echo[i] * 0.32 * 0.55; out[i * 2 + 1] += echo[i] * 0.32 * 0.55 * 0.8; }
  return out;
}
function writeWav(path, data, sr = MUSIC_RATE, ch = 2) {
  let m = 0; for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]));
  const g = m > 0 ? 0.89 / m : 1, n = data.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2 * ch, 28); buf.writeUInt16LE(2 * ch, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i] * g)) * 32767), 44 + i * 2);
  fs.writeFileSync(path, buf);
}
if (WAV) {
  fs.mkdirSync('/tmp/audio/node', { recursive: true });
  // Each theme climbing through its levels, a few bars each.
  const list = [
    ['tdm', 'standard-6v6', [0, 1, 2, 3], 9], ['ranked', 'ranked', [0, 1, 2, 3], 8], ['tactical', 'snd-control-showdown', [0, 2, 3], 8],
    ['gw', 'ground-war', [0, 1, 2, 3], 11.5], ['brdrop', 'br-drop', [3], 15.5], ['br', 'br-ground-calm-to-tense', [0, 1, 2, 3], 10],
    ['brfinal', 'br-final-circle', [2, 3], 8.6], ['ex', 'extraction', [0, 1, 2, 3], 9.6], ['exfil', 'extraction-exfil-called', [2, 3], 7.5],
    ['zm', 'graveyard-by-round', [0, 1, 2, 3], 13.4], ['zmboss', 'graveyard-boss', [2, 3], 12.7], ['cpstealth', 'campaign-stealth', [0, 1, 2], 12],
    ['cpaction', 'campaign-action', [1, 2, 3], 8.6], ['cpchase', 'campaign-chase', [1, 3], 6.9], ['cpboss', 'campaign-boss', [2, 3], 10],
    ['inf', 'infected', [0, 1, 2, 3], 8.2],
  ];
  const t = cpu();
  for (const [id, name, levels, secs] of list) writeWav(`/tmp/audio/node/theme-${name}.wav`, mixdown(id, levels, secs));
  console.log(`     ${list.length} theme previews in /tmp/audio/node (${Math.round(cpu() - t)} ms)`);
}

console.log(`\n${passed} passed`);
