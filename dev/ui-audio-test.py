#!/usr/bin/env python3
"""The sound pass in the browser (docs/AUDIO.md). Run: python3 dev/ui-audio-test.py [port]  (serves the repo itself;
ports 9500-9599 on the shared box). Everything renders through the real engine graph (buses, compressor, limiter,
soft clip) in an OfflineAudioContext:
1. The match themes, one after another, each climbing its levels (and the stings where they belong). Checks every
   segment is audible, never reaches the limiter, gets louder as the level rises, and writes each to
   /tmp/audio/<name>.wav for listening.
2. A 32-player firefight: 31 others shooting (a mix of every gun class, near and across the map), grenades,
   streak guns, footsteps on gravel, with the match theme playing at its fight level. Checks the voice budget and its
   class caps hold, the output never clips, and reports the main-thread cost of the audio engine per frame.
"""
import asyncio, subprocess, sys, os, json, base64, struct
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 9533))
OUT = '/tmp/audio'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
errors = []; fails = []
def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond: fails.append(what)

# Each segment: [file name, [[seconds from its start, action], ...], length]. Actions: ['play', theme, level, transpose],
# ['sting', name], ['stop'].
SEGMENTS = [
    ['standard-6v6', [[0, ['play', 'tdm', 1]], [7.5, ['play', 'tdm', 2]], [15, ['play', 'tdm', 3]], [15, ['sting', 'matchPoint']], [26.5, ['stop']], [26.6, ['sting', 'victory']]], 32],
    ['ranked', [[0, ['play', 'ranked', 1]], [8, ['play', 'ranked', 3]]], 16],
    ['snd-control-showdown', [[0, ['play', 'tactical', 0]], [5.4, ['play', 'tactical', 2]], [10.7, ['play', 'tactical', 3]]], 16],
    ['ground-war', [[0, ['play', 'gw', 0]], [5.8, ['play', 'gw', 1]], [11.5, ['play', 'gw', 2]], [17.2, ['play', 'gw', 3]]], 26],
    ['battle-royale', [[0, ['play', 'brdrop', 3]], [8, ['play', 'br', 0]], [16, ['play', 'br', 2]], [24, ['play', 'brfinal', 2]], [32, ['play', 'brfinal', 3]]], 40],
    ['extraction', [[0, ['play', 'ex', 0]], [7.2, ['play', 'ex', 2]], [14.4, ['play', 'exfil', 2]], [22, ['play', 'exfil', 3]]], 28],
    ['graveyard-shift', [[0, ['play', 'zm', 0]], [6.7, ['play', 'zm', 1]], [13.4, ['play', 'zm', 2]], [20, ['play', 'zm', 3]], [26.7, ['sting', 'boss']], [26.7, ['play', 'zmboss', 2]]], 38],
    ['campaign', [[0, ['play', 'cpstealth', 1, -2]], [6, ['play', 'cpstealth', 2, -2]], [12, ['play', 'cpaction', 2]], [20.6, ['sting', 'boss']], [20.6, ['play', 'cpboss', 3]]], 32],
    ['infected', [[0, ['play', 'inf', 1]], [6.1, ['play', 'inf', 2]], [12.2, ['play', 'inf', 3]], [18.3, ['stop']], [18.4, ['sting', 'defeat']]], 24],
]

RENDER = """async (SEGS) => {
  const { AudioEngine } = await import('/js/audio/audio.js');
  const { music } = await import('/js/audio/music.js');
  const SR = 32000, GAP = 1.5;
  const starts = []; let total = 0;
  for (const s of SEGS) { starts.push(total); total += s[2] + GAP; }
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * total), SR);
  const eng = new AudioEngine();
  eng.setMusicVolume(0.6);
  await eng.useContext(ctx);
  await music.whenBuilt;
  music.setMode('all');
  music.seq.manual = true;
  music.cue('match');
  const at = (t, fn) => ctx.suspend(t).then(() => { fn(); ctx.resume(); });
  // Times on the render quantum, and one callback per quantum: actions and the scheduler's ticks share them.
  const Q = 128 / SR, slots = new Map();
  const add = (t, fn) => { const k = Math.round(t / Q); (slots.get(k) ?? slots.set(k, []).get(k)).push(fn); };
  for (let k = 1; k * 0.1 < total - 0.3; k++) add(k * 0.1, () => music.seq.tick(ctx.currentTime));
  SEGS.forEach((s, i) => {
    for (const [dt, a] of s[1]) add(starts[i] + dt + 0.02, () => {
      if (a[0] === 'play') { music.seq.play(a[1], a[2], a[3] ?? 0); music.seq.tick(ctx.currentTime); }
      else if (a[0] === 'stop') music.seq.stop(1.2);
      else if (a[0] === 'sting') music.sting(a[1], { gain: 0.85, duck: a[1] !== 'victory' && a[1] !== 'defeat', duckTo: a[1] === 'boss' ? 0.5 : 0.7 });
    });
    add(starts[i] + s[2] - 0.05, () => music.seq.stop(0.8));
  });
  for (const [k, fns] of slots) at(k * Q, () => { for (const f of fns) f(); });
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const renderMs = performance.now() - t0;
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const out = [];
  SEGS.forEach((s, i) => {
    const a = Math.floor(starts[i] * SR), n = Math.floor(s[2] * SR);
    let peak = 0;
    const pcm = new Int16Array(n * 2);
    for (let j = 0; j < n; j++) { const l = L[a + j], r = R[a + j]; peak = Math.max(peak, Math.abs(l), Math.abs(r)); pcm[2 * j] = Math.max(-32767, Math.min(32767, Math.round(l * 32767))); pcm[2 * j + 1] = Math.max(-32767, Math.min(32767, Math.round(r * 32767))); }
    // RMS of each action's stretch, to check the levels climb.
    // Each level's stretch runs from its play (plus the bar it waits for) to the next action of any kind.
    const acts = s[1].map(x => x[0]).concat([s[2]]);
    const plays = s[1].filter(x => x[1][0] === 'play').map(x => x[0]);
    const rms = [];
    for (const t of plays) {
      const end = acts.find(x => x > t + 0.01 && !s[1].some(y => y[0] === x && y[1][0] === 'sting')) ?? s[2];
      const p = a + Math.floor((t + 1.5) * SR), q = a + Math.floor(end * SR);
      let e = 0; for (let j = p; j < q; j++) e += L[j] * L[j] + R[j] * R[j];
      rms.push(+Math.sqrt(e / (2 * Math.max(1, q - p))).toFixed(4));
    }
    let bin = ''; const u8 = new Uint8Array(pcm.buffer);
    for (let j = 0; j < u8.length; j += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(j, j + 0x8000));
    out.push({ name: s[0], peak, rms, b64: btoa(bin) });
  });
  return { sr: SR, renderMs, secs: total, segs: out, seq: music.seq.stats() };
}"""

STRESS = """async () => {
  const { AudioEngine } = await import('/js/audio/audio.js');
  const { music } = await import('/js/audio/music.js');
  const { WEAPONS } = await import('/js/shared/weapons.js');
  const SR = 48000, SECS = 12, DT = 1 / 30;
  const ctx = new OfflineAudioContext(2, SR * SECS, SR);
  const eng = new AudioEngine();
  eng.setMusicVolume(0.6);
  await eng.useContext(ctx);
  await music.whenBuilt;
  music.setMode('all'); music.seq.manual = true;
  music.match({ mode: 'gwtdm', rules: 'tdm', large: true });
  const ids = Object.keys(WEAPONS).filter(id => !WEAPONS[id].melee && WEAPONS[id].rpm);
  // 32 players on a Ground War field: you at the middle, the rest in rings from 4 m to 90 m, half of them enemies.
  const players = [{ id: 'me', x: 0, z: 0, vx: 3, vz: 0, alive: true, team: 0, hp: 100, weapon: 'ar', ammo: 30, reloadT: 0 }];
  for (let i = 1; i < 32; i++) {
    const a = i * 2.4, d = 4 + (i % 8) * 12;
    players.push({ id: 'p' + i, x: Math.cos(a) * d, z: Math.sin(a) * d, vx: Math.cos(a + 1) * 6, vz: Math.sin(a + 1) * 6, alive: true, team: i % 2, hp: 100,
      weapon: ids[i % ids.length], ammo: 30, reloadT: 0, sprinting: i % 3 === 0 });
  }
  const view = { phase: 'live', mode: 'gwtdm', mapId: 'railyard', localId: 'me', players, scores: [10, 12], scoreLimit: 250, timeLeft: 500, br: null };
  eng.localId = 'me';
  const next = new Map();
  const times = []; let shots = 0;
  const at = (t, fn) => ctx.suspend(t).then(() => { fn(); ctx.resume(); });
  for (let k = 1; k * DT < SECS - 0.1; k++) at(k * DT, () => {
    const now = ctx.currentTime, ev = [];
    for (const p of players) {
      p.x += p.vx * DT; p.z += p.vz * DT;
      if (p.id === 'me') { if ((now % 3) < 1.2 && now >= (next.get('me') ?? 0)) { next.set('me', now + 0.09); ev.push({ t: 'shot', by: 'me', weapon: 'ar', ox: p.x, oz: p.z, rays: [{ x: p.x + 30, z: p.z, hit: 'wall' }] }); } continue; }
      const w = WEAPONS[p.weapon], gap = 60 / w.rpm;
      if (now >= (next.get(p.id) ?? Math.random())) {
        next.set(p.id, now + gap * (1 + Math.random() * 0.3));
        ev.push({ t: 'shot', by: p.id, weapon: p.weapon, ox: p.x, oz: p.z, rays: [{ x: -p.x * 0.1, z: -p.z * 0.1 + 0.6, hit: 'wall' }] });
      }
    }
    if (Math.random() < 0.04) { const p = players[1 + Math.floor(Math.random() * 31)]; ev.push({ t: 'explosion', x: p.x, z: p.z }); }
    if (Math.random() < 0.02) ev.push({ t: 'gunship_shot', kind: 'chopper', x: 20, z: 15 });
    shots += ev.length;
    const t0 = performance.now();
    eng.trigger = (now % 3) < 1.2;
    eng.onEvents(ev, view);
    eng.update(view, DT);
    music.seq.tick(now);
    times.push(performance.now() - t0);
  });
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const renderMs = performance.now() - t0;
  let peak = 0, e = 0;
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; e += d[i] * d[i]; } }
  const warm = times.slice(1).sort((x, y) => x - y), q = f => warm[Math.floor(warm.length * f)];
  return { renderMs, secs: SECS, frames: times.length, firstMs: times[0], p50: q(0.5), p95: q(0.95), avgMs: warm.reduce((x, y) => x + y, 0) / warm.length, maxMs: warm[warm.length - 1], shots, peak, rms: Math.sqrt(e / (2 * SR * SECS)), peakVoices: eng.peakVoices,
    classPeak: eng.classPeak, playing: music.nowPlaying() };
}"""

def wav(path, sr, b64):
    pcm = base64.b64decode(b64)
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 2, sr, sr * 4, 4, 16) + b'data' + struct.pack('<I', len(pcm)) + pcm)

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        await asyncio.sleep(0.8)
        async with async_playwright() as p:
            b = await p.chromium.launch(args=ARGS)
            ctx = await b.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, device_scale_factor=2)
            pg = await ctx.new_page()
            pg.set_default_timeout(600000)
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(str(e)))
            await pg.goto(f'http://localhost:{PORT}/?debug=1')
            await pg.wait_for_timeout(1500)

            # 1. The themes through the real graph.
            r = await pg.evaluate(RENDER, SEGMENTS)
            os.makedirs(OUT, exist_ok=True)
            print(f"     rendered {r['secs']:.0f} s of themes in {r['renderMs'] / 1000:.1f} s ({r['seq']['notes']} notes)")
            for s in r['segs']:
                wav(f"{OUT}/{s['name']}.wav", r['sr'], s['b64'])
                print(f"     {s['name']:22s} peak {s['peak']:.3f}  rms by level {s['rms']}")
                check(s['peak'] < 0.84, f"{s['name']}: never reaches the limiter")
                check(min(s['rms']) > 0.008, f"{s['name']}: every level audible")
            # Themes that start from their bed (level 0) must grow audibly; ones that start from the pulse must not
            # get quieter (their top levels add density more than level).
            for name, k in (('ground-war', 1.25), ('graveyard-shift', 1.25), ('snd-control-showdown', 1.25), ('extraction', 1.25), ('standard-6v6', 0.95), ('ranked', 0.95), ('infected', 0.95)):
                lv = next(x for x in r['segs'] if x['name'] == name)['rms']
                top = lv[3] if name == 'graveyard-shift' else lv[-1] if name != 'extraction' else lv[1]
                check(top >= lv[0] * k, f"{name}: the top level at least {k}x the bottom ({lv[0]} -> {top})")
            print(f"     WAVs in {OUT}/")

            # 2. 32 players.
            await pg.goto(f'http://localhost:{PORT}/?debug=1')
            await pg.wait_for_timeout(1500)
            s = await pg.evaluate(STRESS)
            print(f"     32 players, {s['secs']} s: {s['shots']} events, {s['frames']} frames; engine per frame: median {s['p50']:.2f} ms, p95 {s['p95']:.2f}, mean {s['avgMs']:.2f}, worst {s['maxMs']:.1f} (first frame {s['firstMs']:.0f} ms: JIT and first buffer use); headless Chrome on a loaded 2-core box")
            print(f"     peak voices {s['peakVoices']}, by class {json.dumps(s['classPeak'])}; output peak {s['peak']:.3f}, rms {s['rms']:.3f}; render {s['renderMs'] / 1000:.1f} s; music {s['playing']}")
            check(s['peakVoices'] <= 26, f"voice budget holds ({s['peakVoices']} <= 26)")
            caps = {'own': 3, 'threat': 4, 'gun': 3, 'tail': 3, 'reflect': 1, 'boom': 3, 'impact': 2, 'foley': 2, 'ammo': 2, 'step': 2, 'world': 3, 'ui': 3, 'medal': 1, 'loud': 2}
            over = {k: v for k, v in s['classPeak'].items() if v > caps.get(k, 3)}
            check(not over, f'class caps hold {over}')
            check(s['peak'] <= 1.0 and s['rms'] > 0.02, 'loud but never clipping')
            check(s['p95'] < 2.5, f"engine main-thread cost per frame under 2.5 ms at p95 ({s['p95']:.2f})")
            check(len(s['playing']) == 1 and s['playing'][0].startswith('theme:gw:'), f"the Ground War theme plays through it ({s['playing']})")
            await b.close()
    finally:
        srv.terminate()
    real = [e for e in errors if 'favicon' not in e]
    check(not real, f'no console errors {real[:3]}')
    print('\n' + ('FAILED: ' + '; '.join(fails) if fails else 'all passed'))
    sys.exit(1 if fails else 0)

asyncio.run(main())
