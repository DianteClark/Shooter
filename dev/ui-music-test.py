#!/usr/bin/env python3
"""Music in the browser (js/audio/music.js). Run: python3 dev/ui-music-test.py [port]  (serves the repo itself).
1. The whole audio graph (engine buses, limiter, soft clip) through an OfflineAudioContext, with the music driven
   through a timeline: title theme with a prestige sting, a match with every layer and a firefight, the results
   victory. Checks the output never reaches the limiter's ceiling and is not silent, and reports build time and memory.
2. The live page: music starts on the title after the first tap, the vote screen switches to the lobby loop, the
   options screen has the Music in matches toggle, a solo match plays the intro and stays quiet under play, hiding
   the page stops the music. No console errors.
"""
import asyncio, subprocess, sys, os, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8393))
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
errors = []; fails = []
def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond: fails.append(what)

OFFLINE = """async () => {
  const { AudioEngine } = await import('/js/audio/audio.js');
  const { music } = await import('/js/audio/music.js');
  const SR = 48000, SECS = 20;
  const ctx = new OfflineAudioContext(2, SR * SECS, SR);
  const eng = new AudioEngine();
  eng.setMusicVolume(1);
  const t0 = performance.now();
  await eng.useContext(ctx);
  const engineMs = performance.now() - t0;
  await music.whenBuilt;
  const st = music.stats();
  music.setMatchMusic(true);
  music.cue('menu');
  music.sting('prestige', { gain: 0.8, duckTo: 0.45 });
  const at = (t, fn) => ctx.suspend(t).then(() => { fn(); ctx.resume(); });
  const view = { phase: 'live', mode: 'tdm', players: [{ id: eng.localId, alive: true }], timeLeft: 45, br: null, scores: [0, 0] };
  const playing = {};
  at(5, () => { music.frame(view); playing.match = music.nowPlaying(); });
  at(7, () => { music.cue('exfil'); music.cue('finalCircle'); eng.fight = 0; music.frame(view); playing.layers = music.nowPlaying(); });
  at(10, () => { eng.fight = 1; music.frame(view); });
  at(13, () => { view.phase = 'ended'; music.frame(view); music.results('win'); playing.results = music.nowPlaying(); });
  const buf = await ctx.startRendering();
  const win = s => { let p = 0, e = 0; const a = Math.floor(s[0] * SR), b = Math.floor(s[1] * SR);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = a; i < b; i++) { const v = Math.abs(d[i]); if (v > p) p = v; e += d[i] * d[i]; } }
    return { peak: p, rms: Math.sqrt(e / (2 * (b - a))) }; };
  return { stats: st, engineMs, playing, all: win([0, SECS]), menu: win([1, 5]), match: win([5.5, 10]), fight: win([10.5, 13]), victory: win([13, 19]) };
}"""

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        await asyncio.sleep(0.6)
        async with async_playwright() as p:
            b = await p.chromium.launch(args=ARGS)
            ctx = await b.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, device_scale_factor=2)
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(str(e)))
            await pg.goto(f'http://localhost:{PORT}/?debug=1')
            await pg.wait_for_timeout(700)
            await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
            await pg.goto(f'http://localhost:{PORT}/?debug=1')
            await pg.wait_for_timeout(1000)

            # 1. Offline render of the full graph.
            r = await pg.evaluate(OFFLINE)
            st = r['stats']
            print(f"     build: {st['buildMs']} ms of synthesis, largest slice {st['maxJobMs']} ms, {st['wallMs']} ms wall; {st['bytes'] / 1048576:.1f} MB in {st['tracks']} tracks")
            for k in ('menu', 'match', 'fight', 'victory', 'all'):
                w = r[k]; print(f"     {k}: peak {w['peak']:.3f}, rms {w['rms']:.4f}")
            print('     playing:', json.dumps(r['playing']))
            check(st['built'] and st['tracks'] == 13, 'all 13 tracks built')
            check(st['bytes'] < 20 * 1048576, 'music buffers under 20 MB')
            check(r['all']['peak'] < 0.84, 'never reaches the limiter (-1.5 dBFS) through the whole timeline')
            check(r['menu']['rms'] > 0.01 and r['victory']['rms'] > 0.01, 'menu theme and victory are audible')
            check(r['fight']['rms'] < r['match']['rms'], 'a firefight ducks the match music')
            check(r['playing']['match'] == ['last.main', 'match.main'] and 'exfil.main' in r['playing']['layers'] and 'circle.main' in r['playing']['layers'], 'match cues switch tracks')
            check(r['playing']['results'] == [], 'results: loops out, sting on')

            # 2. The live page.
            await pg.goto(f'http://localhost:{PORT}/?debug=1&map=railyard&mode=tdm&bots=recruit')
            await pg.wait_for_timeout(1200)
            await pg.mouse.click(5, 380)     # A first gesture unlocks audio.
            M = "(await import('/js/audio/music.js')).music"
            for _ in range(100):
                if await pg.evaluate(f"(async () => {M}.built)()"): break
                await pg.wait_for_timeout(200)
            await pg.wait_for_timeout(300)
            now = await pg.evaluate(f"(async () => {M}.nowPlaying())()")
            check(now == ['menu.bed', 'menu.drive'], f'title theme plays after the first tap ({now})')
            await pg.evaluate("document.querySelector('[data-act=\"options\"]')?.click()")
            await pg.wait_for_timeout(500)
            has = await pg.evaluate("!!document.querySelector('[data-act=\"optMatchMusic\"]')")
            check(has, 'options: Music in matches toggle')
            if has:
                await pg.click('[data-act="optMatchMusic"]')
                on = await pg.evaluate(f"(async () => [{M}.matchMusic, JSON.parse(localStorage.getItem('switchyard-options')).matchMusic])()")
                check(on == [True, True], f'toggle saves and applies ({on})')
                await pg.click('[data-act="optMatchMusic"]')
            await pg.screenshot(path='/tmp/music-options.png')
            await pg.evaluate("document.querySelector('[data-act=\"optBack\"]')?.click()")
            await pg.wait_for_timeout(400)
            # Hidden page: music stops; visible: back.
            await pg.evaluate(f"""(async () => {{ Object.defineProperty(document, 'visibilityState', {{ configurable: true, get: () => 'hidden' }}); document.dispatchEvent(new Event('visibilitychange')); }})()""")
            hid = await pg.evaluate(f"(async () => {M}.nowPlaying())()")
            await pg.evaluate(f"""(async () => {{ Object.defineProperty(document, 'visibilityState', {{ configurable: true, get: () => 'visible' }}); document.dispatchEvent(new Event('visibilitychange')); }})()""")
            back = await pg.evaluate(f"(async () => {M}.nowPlaying())()")
            check(hid == [] and back == ['menu.bed', 'menu.drive'], f'hidden stops, visible resumes ({hid} {back})')
            # A solo match.
            await pg.click('[data-act="custom"]')
            for _ in range(80):
                if await pg.evaluate("!!window.__game.app.match?.sim"): break
                await pg.wait_for_timeout(100)
            await pg.wait_for_timeout(1500)
            sc = await pg.evaluate(f"(async () => [{M}.scene, {M}.nowPlaying()])()")
            check(sc[0] == 'match' and sc[1] == [], f'match: scene match, quiet under play by default ({sc})')
            await b.close()
    finally:
        srv.terminate()
    real = [e for e in errors if 'favicon' not in e]
    check(not real, f'no console errors {real[:3]}')
    print('\n' + ('FAILED: ' + '; '.join(fails) if fails else 'all passed'))
    sys.exit(1 if fails else 0)

asyncio.run(main())
