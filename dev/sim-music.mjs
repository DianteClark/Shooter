// Node tests for the synthesised music (js/audio/music-synth.js, js/audio/music.js). Run: node dev/sim-music.mjs [wav]
// Renders every track, checks length, loop seams, peaks (each stem and the stems that play together), build cost
// and memory, then drives the director against a stand-in AudioContext to check that cues switch tracks.
// `wav` also writes previews to /tmp/music/ (menu theme, calm variant, lobby, match with layers, BR drop, stings).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TRACKS, BUILD_ORDER, MUSIC_RATE, renderTrack, trackLength } from '../js/audio/music-synth.js';

const WAV = process.argv.includes('wav');
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}

// ---- Render everything once, timing each slice the way the director runs them. ----
const stems = {};
let totalMs = 0, maxSlice = 0, bytes = 0;
const slices = [];
for (const id of BUILD_ORDER) {
  const it = renderTrack(TRACKS[id]);
  let r;
  do {
    const t = performance.now();
    r = it.next();
    const ms = performance.now() - t;
    totalMs += ms; if (ms > maxSlice) maxSlice = ms;
    slices.push(ms);
  } while (!r.done);
  stems[id] = r.value;
  for (const d of Object.values(r.value)) bytes += d.byteLength;
}

const peakOf = d => { let m = 0; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; } return m; };
// Sum of stems that play at once; shorter loops repeat under the longer one (they share its clock).
function mix(parts) {
  const n = Math.max(...parts.map(([d]) => d.length)), out = new Float32Array(n);
  for (const [d, g] of parts) for (let i = 0; i < n; i++) out[i] += d[i % d.length] * g;
  return out;
}

await test('every track renders to its length with no NaN', () => {
  assert.deepEqual([...BUILD_ORDER].sort(), Object.keys(TRACKS).sort());
  for (const [id, def] of Object.entries(TRACKS)) {
    for (const [stem, d] of Object.entries(stems[id])) {
      assert.equal(d.length, trackLength(def), `${id}.${stem} length`);
      for (let i = 0; i < d.length; i++) assert.ok(Number.isFinite(d[i]), `${id}.${stem} sample ${i}`);
      const secs = d.length / MUSIC_RATE;
      assert.ok(secs > 1 && secs < 45, `${id} ${secs}s`);
      assert.ok(peakOf(d) > 0.1, `${id}.${stem} is not silent`);
    }
  }
});

await test('loops are seamless: the jump at the loop point is no bigger than the music\'s own', () => {
  for (const [id, def] of Object.entries(TRACKS)) {
    if (!def.loop) continue;
    for (const [stem, d] of Object.entries(stems[id])) {
      const n = d.length, deltas = new Float32Array(n - 1);
      for (let i = 1; i < n; i++) deltas[i - 1] = Math.abs(d[i] - d[i - 1]);
      deltas.sort();
      const p999 = deltas[Math.floor(deltas.length * 0.999)];
      const seam = Math.abs(d[0] - d[n - 1]);
      // And the slope carries on: the second difference across the seam is like any other.
      const curve = Math.abs(d[1] - 2 * d[0] + d[n - 1]);
      console.log(`     ${id}.${stem}: ${(n / MUSIC_RATE).toFixed(2)}s seam ${seam.toFixed(4)} (p99.9 step ${p999.toFixed(4)}) curve ${curve.toFixed(4)}`);
      assert.ok(seam <= p999 * 0.5, `${id}.${stem} seam ${seam} vs ${p999}`);
    }
  }
});

await test('one-shots start and end in silence', () => {
  for (const [id, def] of Object.entries(TRACKS)) {
    if (def.loop) continue;
    const d = stems[id].main;
    assert.ok(Math.abs(d[0]) < 0.02 && Math.abs(d[d.length - 1]) < 1e-3, `${id} edges ${d[0]} ${d[d.length - 1]}`);
  }
});

await test('peaks stay under the limit, alone and together', () => {
  for (const [id, def] of Object.entries(TRACKS)) for (const [stem, d] of Object.entries(stems[id])) {
    const p = peakOf(d);
    assert.ok(Math.abs(p - def.peak[stem]) < 0.01 && p <= 0.75, `${id}.${stem} peak ${p}`);
  }
  // The director's levels (music.js _targets), times the engine's music bus (0.7), plus a sting on top.
  const BUS = 0.7, L = 0.98;
  const combos = {
    'menu full': [[stems.menu.bed, 0.9], [stems.menu.drive, 0.9]],
    'match all layers': [[stems.match.main, 0.6], [stems.last.main, 0.7], [stems.circle.main, 0.7], [stems.exfil.main, 0.75]],
    'lobby + level-up': [[stems.lobby.main, 0.75], [stems.levelUp.main, 0.8]],
    'menu + prestige (ducked)': [[stems.menu.bed, 0.9 * 0.45], [stems.menu.drive, 0.9 * 0.45], [stems.prestige.main, 0.8]],
    'post + victory': [[stems.lobby.main, 0.45], [stems.victory.main, 1]],
  };
  for (const [name, parts] of Object.entries(combos)) {
    const p = peakOf(mix(parts)) * BUS;
    console.log(`     ${name}: peak ${p.toFixed(3)} (${(20 * Math.log10(p)).toFixed(1)} dBFS at the master)`);
    assert.ok(p < L, `${name} ${p}`);
  }
});

await test('building is cheap: small slices, bounded memory', () => {
  const mb = bytes / 1048576;
  slices.sort((a, b) => a - b);
  const p99 = slices[Math.floor(slices.length * 0.99)];
  console.log(`     ${Math.round(totalMs)} ms of synthesis in all over ${slices.length} slices: p99 ${p99.toFixed(2)} ms, largest ${maxSlice.toFixed(1)} ms (GC or a busy machine); ${mb.toFixed(1)} MB of buffers`);
  assert.ok(mb < 20, `memory ${mb} MB`);
  assert.ok(totalMs < 6000, `build ${totalMs} ms`);
  assert.ok(p99 < 6, `p99 slice ${p99} ms`);
  // The largest single slice is not asserted: on a shared machine it measures the neighbours (a bare loop sees 250 ms).
});

// ---- The director, on a stand-in AudioContext that just records what it is asked to do. ----
class Param {
  constructor(v = 1) { this.value = v; }
  setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} setValueAtTime(v) { this.value = v; }
}
class Node { connect() {} disconnect() {} }
class FakeCtx {
  constructor() { this.currentTime = 0; this.state = 'running'; this.sources = []; }
  createGain() { const n = new Node(); n.gain = new Param(1); return n; }
  createBiquadFilter() { const n = new Node(); n.frequency = new Param(350); n.Q = new Param(1); return n; }
  createBuffer(ch, len, sr) {
    const data = new Float32Array(len);
    return { duration: len / sr, length: len, getChannelData: () => data };
  }
  createBufferSource() {
    const s = new Node(); s.playbackRate = new Param(1);
    s.start = (when, offset = 0) => { s.startedAt = when; s.offset = offset; this.sources.push(s); };
    s.stop = () => { s.stopped = true; };
    return s;
  }
}

await test('cues switch tracks, layers lock to the underscore, stings play', async () => {
  globalThis.document = undefined;
  const { Music } = await import('../js/audio/music.js');
  const m = new Music();
  const ctx = new FakeCtx();
  const engine = { ctx, music: new Node(), whenReady: Promise.resolve(), fight: 0, micActive: false, localId: 'me', tension: false };
  m.screen('title');
  m.attach(engine);
  await m.whenBuilt;
  assert.ok(m.built && m.stats().tracks === Object.keys(TRACKS).length);
  assert.deepEqual(m.nowPlaying(), ['menu.bed', 'menu.drive']);
  m.calm = true; m._apply();
  assert.deepEqual(m.nowPlaying(), ['menu.bed'], 'calm variant drops the drive stem');
  assert.ok(m.filter.frequency.value < 2000, 'and closes the filter');
  m.screen('vote');
  assert.deepEqual(m.nowPlaying(), ['lobby.main']);

  // A match: the intro sting, and with match music off nothing under live play.
  const view = { phase: 'warmup', mode: 'tdm', players: [{ id: 'me', alive: true }], timeLeft: 600, br: null };
  const before = ctx.sources.length;
  m.frame(view);
  assert.equal(m.scene, 'match');
  assert.ok(ctx.sources.slice(before).some(s => s.buffer === m.bufs.intro.main), 'intro sting');
  view.phase = 'live';
  m.frame(view);
  assert.deepEqual(m.nowPlaying(), [], 'match music off: silent under play');
  m.setMatchMusic(true);
  assert.deepEqual(m.nowPlaying(), ['match.main']);
  ctx.currentTime = 30;
  view.timeLeft = 50; m.frame(view);
  assert.deepEqual(m.nowPlaying(), ['last.main', 'match.main'], 'last minute layer');
  const layer = m.live.get('last.main').src, base = m.live.get('match.main').src;
  const expect = ((30 - base.startedAt) % layer.buffer.duration);
  assert.ok(Math.abs(layer.offset - expect) < 1e-6, 'layer joins on the underscore clock');
  assert.ok(m.ownsTension, 'the engine tension loop gives way');
  m.cue('exfil');
  assert.ok(m.nowPlaying().includes('exfil.main'), 'cue exfil');
  m.cue('exfil', false);
  assert.ok(!m.nowPlaying().includes('exfil.main'));
  // Fights duck the loops.
  engine.fight = 1; m.frame(view);
  assert.ok(m.duck.gain.value < 0.5, 'firefight duck');
  engine.fight = 0; m.frame(view);
  view.phase = 'ended'; m.frame(view);
  assert.deepEqual(m.nowPlaying(), [], 'quiet at the end');

  // Results: victory sting, then the lobby loop under the rest of the reel.
  const n0 = ctx.sources.length;
  m.results('win');
  assert.ok(ctx.sources.slice(n0).some(s => s.buffer === m.bufs.victory.main), 'victory sting');
  m.frame(view);       // A stray last frame does not drag the scene back.
  assert.equal(m.scene, 'results');
  m._scene('post');
  assert.deepEqual(m.nowPlaying(), ['lobby.main']);

  // Battle royale: flight music aboard, final circle layer (quiet with match music off).
  m.setMatchMusic(false);
  const br = { phase: 'live', mode: 'br', players: [{ id: 'me', alive: true, air: 1 }], timeLeft: 0, br: { state: 'wait' } };
  m._scene('menu');
  m.frame(br);
  assert.deepEqual(m.nowPlaying(), ['brdrop.main'], 'flight music');
  br.players[0].air = 0; m.frame(br);
  assert.deepEqual(m.nowPlaying(), []);
  br.br.state = 'final'; m.frame(br);
  assert.deepEqual(m.nowPlaying(), ['circle.main'], 'final circle');
  assert.equal(m.live.get('circle.main').level, 0.35);

  // UI stings, rate-limited.
  const n1 = ctx.sources.length;
  m.uiSting('levelUp'); m.uiSting('levelUp'); m.uiSting('unlock'); m.uiSting('tap');
  assert.equal(ctx.sources.length - n1, 2);
  // Hidden: everything stops at once; back: the scene returns.
  m.hidden = true; m._apply(0);
  assert.deepEqual(m.nowPlaying(), []);
  m.hidden = false; m._apply(1);
  assert.deepEqual(m.nowPlaying(), ['circle.main']);
  m.detach();
});

// ---- Previews. ----
function writeWav(path, data, sr = MUSIC_RATE) {
  const n = data.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(path, buf);
}
// Loops twice round (so the seam is heard), level as in the game's mix (bus 0.7), normalised up a little for listening.
function preview(name, parts, loops = 1) {
  let d = mix(parts);
  if (loops > 1) { const o = new Float32Array(d.length * loops); for (let k = 0; k < loops; k++) o.set(d, k * d.length); d = o; }
  const g = 0.89 / peakOf(d);
  for (let i = 0; i < d.length; i++) d[i] *= g;
  writeWav(`/tmp/music/${name}.wav`, d);
  return (d.length / MUSIC_RATE).toFixed(1);
}
if (WAV) {
  fs.mkdirSync('/tmp/music', { recursive: true });
  const out = {
    'menu-theme': preview('menu-theme', [[stems.menu.bed, 0.9], [stems.menu.drive, 0.9]], 1),
    'menu-calm': preview('menu-calm', [[stems.menu.bed, 0.9]], 1),
    'lobby': preview('lobby', [[stems.lobby.main, 1]], 2),
    'match-underscore': preview('match-underscore', [[stems.match.main, 1]], 1),
    'match-last-minute': preview('match-last-minute', [[stems.match.main, 0.6], [stems.last.main, 0.7]], 1),
    'br-drop': preview('br-drop', [[stems.brdrop.main, 1]], 2),
    'br-final-circle': preview('br-final-circle', [[stems.circle.main, 1]], 2),
    'exfil': preview('exfil', [[stems.match.main, 0.6], [stems.exfil.main, 0.75]], 1),
    'victory': preview('victory', [[stems.victory.main, 1]]),
    'defeat': preview('defeat', [[stems.defeat.main, 1]]),
    'intro': preview('intro', [[stems.intro.main, 1]]),
    'level-up': preview('level-up', [[stems.levelUp.main, 1]]),
    'unlock': preview('unlock', [[stems.unlock.main, 1]]),
    'prestige': preview('prestige', [[stems.prestige.main, 1]]),
  };
  console.log('     previews in /tmp/music:', Object.entries(out).map(([k, s]) => `${k}.wav ${s}s`).join(', '));
}

console.log(`\n${passed} passed`);
