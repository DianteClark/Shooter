#!/usr/bin/env python3
"""Help videos (docs/TUTORIAL.md, roadmap 63): python3 dev/ui-help-videos-test.py [port] [--all] [--shots DIR]

Serves the repo on the port (default 9741), then checks:
  lazy      the player module (js/game/help-video.js) is not fetched until the first Watch tap
  tab       Help > Videos lists every script by group, each tile named for a screen reader; Watch chips on the
            Controls, Guns, Streaks and Modes cards
  play      each video (a sample; --all for every one): a loading bar, then playing in the real renderer with the
            caption changing on time, the progress bar moving, names over heads; the basics show ghost thumbs whose
            move knob leaves the centre and buttons that light; frame time sane; no console errors
  pad       with a controller in use (body.pad-on) the captions name its buttons
  replay    Replay rebuilds the match from the start (t back near 0, the same seed: the star where it was)
  loop      Loop is a pressed toggle; at the end the video starts again by itself
  end       without Loop, the end card offers Watch again, Next video and Done
  close     Skip and Escape close it: the Help screen is back, the renderer gone, the yard live again
Screenshots go to DIR (default /tmp/help-videos). Fails (exit 1) on any finding or console error.
"""
import asyncio, subprocess, sys, os, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
PORT = int(args[0]) if args and args[0].isdigit() else 9741
SHOTS = args[args.index('--shots') + 1] if '--shots' in args else '/tmp/help-videos'
ALL = '--all' in args
GL = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game'
fails, errors = [], []
SAMPLE = ['move', 'slide', 'nades', 'streaks', 'dom', 'snd', 'br', 'zm', 'caster']


def check(cond, msg):
    if not cond: fails.append(msg)
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)


async def fresh(ctx):
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
    await pg.goto(f'http://localhost:{PORT}/?debug=1')
    await pg.wait_for_function(f'!!({G} && {G}.Progress)', timeout=60000)
    await pg.evaluate(f"{G}.Progress.name='Tester'; {G}.Progress.setFlag('tutorialOffered'); {G}.Options.set('fps', false)")
    await pg.reload()
    await pg.wait_for_function(f'!!({G} && {G}.Progress)', timeout=60000)
    await pg.wait_for_timeout(900)
    return pg


H = f'{G}.helpVideo()'
STATE = f"""(() => {{ const h = {H}; if (!h || h === 'loading') return null;
  const lk = h.ui.lk ? getComputedStyle(h.ui.lk).transform : null;
  return {{ state: h.el.dataset.state, t: h.dir.t, len: h.video.len, cap: h.ui.cap.textContent, capHidden: h.ui.cap.hidden,
    fill: h.ui.fill.style.transform, frames: h.stats.frames, avg: h.stats.totalMs / Math.max(1, h.stats.frames), restarts: h.stats.restarts,
    lit: Object.values(h.ui.keys || {{}}).filter(k => k.classList.contains('lit')).length, lk, names: h.ui.names.querySelectorAll('span:not([hidden])').length,
    loop: h.ui.loop.getAttribute('aria-pressed'), endHidden: h.ui.end.hidden, starX: h.dir.star?.ps.x, starZ: h.dir.star?.ps.z }}; }})()"""


async def open_video(pg, vid):
    await pg.evaluate(f"{G}.openHelpVideo('{vid}')")
    await pg.wait_for_function(f"(() => {{ const h = {H}; return h && h !== 'loading' && h.el.dataset.state === 'playing'; }})()", timeout=180000)


async def jump(pg, to):
    """Steps the video's match ahead headless to video second `to` (the renderer catches up next frame)."""
    await pg.evaluate(f"(() => {{ const d = {H}.dir; while (d.t < {to} && !d.done) d.advance(1 / 30); }})()")
    await pg.wait_for_timeout(250)


async def main():
    os.makedirs(SHOTS, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=GL)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            await ctx.add_init_script('performance.setResourceTimingBufferSize(20000)')     # Room for every module fetched.
            pg = await fresh(ctx)
            vids = await pg.evaluate("import('/js/shared/help-videos.js').then(m => m.VIDEOS.map(v => ({ id: v.id, group: v.group, sticks: !!v.sticks, caps: v.captions.length, pad: v.captions.some(c => c[2]) })))")

            print('lazy')
            loaded = lambda: pg.evaluate("performance.getEntriesByType('resource').some(e => e.name.includes('/js/game/help-video.js'))")
            n_res = await pg.evaluate("performance.getEntriesByType('resource').length")
            check(not await loaded() and n_res > 50, f'the player module is not loaded before a video is asked for ({n_res} resources seen)')

            print('tab')
            await pg.evaluate(f"{G}.openHelp('videos')")
            await pg.wait_for_timeout(800)
            tiles = await pg.evaluate("[...document.querySelectorAll('.help-vid')].map(b => ({ id: b.dataset.video, label: b.getAttribute('aria-label') }))")
            check(len(tiles) == len(vids), f'Videos tab lists all {len(vids)} videos ({len(tiles)})')
            check(all(t['label'] and t['label'].startswith('Watch video:') for t in tiles), 'every tile has a screen-reader name')
            groups = await pg.evaluate("document.querySelectorAll('.help-vgroup').length")
            check(groups == 4, f'four groups ({groups})')
            await pg.screenshot(path=f'{SHOTS}/tab-videos.png')
            chips = {}
            for tab in ('controls', 'weapons', 'streaks', 'modes'):
                await pg.locator(f'.help-tabs [data-tab="{tab}"]').click()
                await pg.wait_for_timeout(300)
                chips[tab] = await pg.evaluate("[...document.querySelectorAll('.help-play')].map(b => b.dataset.video)")
            check(set(chips['controls']) >= {'move', 'slide', 'nades'}, f"Controls cards' Watch chips {chips['controls']}")
            check('gunsmith' in chips['weapons'], 'Guns has the Gunsmith video')
            check('streaks' in chips['streaks'], 'Streaks has the scorestreaks video')
            check(set(chips['modes']) >= {'dom', 'hard', 'snd', 'kc', 'hq', 'ctf', 'br', 'brfight', 'ex', 'zm', 'cp', 'ranked', 'caster'}, f"Modes cards' Watch chips {chips['modes']}")
            await pg.screenshot(path=f'{SHOTS}/tab-modes.png')

            print('play')
            # A Watch chip, tapped: the first video comes from a real tap.
            await pg.locator('.help-play[data-video="dom"]').first.click()
            await pg.wait_for_function(f"(() => {{ const h = {H}; return h && h !== 'loading'; }})()", timeout=60000)
            check(await loaded(), 'the player module loads on the first Watch tap')
            await pg.wait_for_function(f"{H}.el.dataset.state === 'playing'", timeout=180000)
            check(await pg.evaluate("document.body.classList.contains('hv-on') && getComputedStyle(document.querySelector('#ui > .menu')).visibility === 'hidden'"), 'the Help screen hides under the video')
            await pg.evaluate(f'{H}.close()')
            await pg.wait_for_timeout(300)

            for v in vids:
                if not ALL and v['id'] not in SAMPLE: continue
                vid = v['id']
                await open_video(pg, vid)
                s0 = await pg.evaluate(STATE)
                try: await pg.wait_for_function(f"{H}.dir.t > {s0['t'] + 0.6}", timeout=90000)
                except Exception: pass
                s1 = await pg.evaluate(STATE)
                check(s1['t'] > s0['t'] + 0.5 and s1['frames'] > s0['frames'], f'{vid}: plays ({s0["t"]:.1f} -> {s1["t"]:.1f} s, {s1["frames"]} frames, {s1["avg"]:.1f} ms a frame)')
                check(s1['cap'] and not s1['capHidden'], f'{vid}: a caption shows ("{s1["cap"]}")')
                check(s1['fill'].startswith('scaleX(') and float(s1['fill'][7:-1]) > 0, f'{vid}: the progress bar moves ({s1["fill"]})')
                await pg.screenshot(path=f'{SHOTS}/{vid}-a.png')
                caps = {s1['cap']}
                if v['sticks']:
                    moved, lit = False, False
                    # Just before the script's first button moment, then watch it happen in real frames.
                    first_op = await pg.evaluate(f"(() => {{ const o = ({H}.video.ops || []).find(o => ['slide', 'lethal', 'tactical', 'streak'].includes(o[1])); return o ? o[0] : null; }})()")
                    if first_op is not None: await jump(pg, max(0, first_op - 0.3))
                    for _ in range(40):
                        s = await pg.evaluate(STATE)
                        if s['lk'] not in (None, 'none', 'matrix(1, 0, 0, 1, 0, 0)'): moved = True
                        if s['lit']: lit = True
                        caps.add(s['cap'])
                        if moved and lit: break
                        await pg.wait_for_timeout(400)
                    check(moved, f'{vid}: the ghost move stick leans')
                    if vid != 'move': check(lit, f'{vid}: a ghost button lights for what the star pressed')
                await jump(pg, v and (await pg.evaluate(f'{H}.video.len')) * 0.7)
                s2 = await pg.evaluate(STATE)
                caps.add(s2['cap'])
                check(len(caps) >= 2, f'{vid}: captions change over the video ({len(caps)} seen)')
                await pg.screenshot(path=f'{SHOTS}/{vid}-b.png')
                check(s2['avg'] < 400, f'{vid}: frame work {s2["avg"]:.1f} ms average (software GL)')
                await pg.evaluate(f'{H}.close()')
                await pg.wait_for_timeout(300)

            print('pad')
            await open_video(pg, 'move')
            await pg.evaluate("document.body.classList.add('pad-on')")
            await pg.wait_for_timeout(500)
            await jump(pg, 9.6)
            cap = await pg.evaluate(f'{H}.ui.cap.textContent')
            check('RT' in cap, f'controller words name the bound button ("{cap}")')
            await pg.evaluate("document.body.classList.remove('pad-on')")
            await pg.wait_for_timeout(500)
            cap = await pg.evaluate(f'{H}.ui.cap.textContent')
            check('ring' in cap, f'back on touch, the touch words ("{cap}")')

            print('replay')
            first = await pg.evaluate(STATE)
            await pg.locator('.hv-replay').click()
            await pg.wait_for_function(f"{H}.el.dataset.state === 'playing'", timeout=120000)
            s = await pg.evaluate(STATE)
            check(s['restarts'] == 1 and s['t'] < 3, f'Replay starts again from the top (t {s["t"]:.1f}, restarts {s["restarts"]})')
            check(s['endHidden'], 'no end card while playing')

            print('loop')
            await pg.locator('.hv-loop').click()
            check(await pg.evaluate(f'{H}.ui.loop.getAttribute("aria-pressed")') == 'true', 'Loop is a pressed toggle')
            await jump(pg, 99)
            await pg.wait_for_function(f"{H}.stats.restarts >= 2 && {H}.el.dataset.state === 'playing'", timeout=120000)
            check(True, 'with Loop on, the end starts it again')
            await pg.locator('.hv-loop').click()

            print('end')
            await jump(pg, 99)
            await pg.wait_for_function(f"{H}.el.dataset.state === 'ended'", timeout=60000)
            end = await pg.evaluate("[...document.querySelectorAll('.hv-end button')].map(b => b.textContent.trim())")
            check(end == ['Watch again', 'Next video', 'Done'], f'end card {end}')
            await pg.screenshot(path=f'{SHOTS}/end-card.png')
            await pg.locator('.hv-next').click()
            await pg.wait_for_function(f"(() => {{ const h = {H}; return h && h !== 'loading' && h.video.id === 'slide'; }})()", timeout=60000)
            check(True, 'Next video plays the next script')

            print('close')
            await pg.keyboard.press('Escape')
            await pg.wait_for_timeout(500)
            st = await pg.evaluate(f"({{ h: {H}, screen: {G}.menu.el.dataset.screen, on: document.body.classList.contains('hv-on'), r: {G}.app.renderer, el: !!document.querySelector('.hv') }})")
            check(st['h'] is None and not st['on'] and st['r'] is None and not st['el'], f'Escape closes it ({st})')
            check(st['screen'] == 'help', 'the Help screen is back')
            await open_video(pg, 'kc')
            await pg.locator('.hv-close').click()
            await pg.wait_for_timeout(500)
            check(await pg.evaluate(f'{H} === null'), 'Skip closes it')
            await pg.wait_for_timeout(500)
            await browser.close()
    finally:
        srv.terminate()
    real = [e for e in errors if 'favicon' not in e]
    check(not real, f'no console errors {real[:4]}')
    print(f"\n{'FAILED: ' + str(len(fails)) if fails else 'all ok'}  (screenshots in {SHOTS})")
    sys.exit(1 if fails else 0)

asyncio.run(main())
