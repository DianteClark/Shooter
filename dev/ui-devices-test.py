#!/usr/bin/env python3
"""Every phone (ROADMAP item 34, docs/DEVICES.md): Android Chrome and Samsung Internet sizes and small iPhones.

Run from anywhere: python3 dev/ui-devices-test.py [port] [--shots] [--only iphone-se,pixel7-tab]. It serves the repo itself (python3 -m http.server).
For each device (user agent, screen, pixel ratio, and the visible area: a browser tab loses the address bar, an
installed app gets the whole screen) it checks, with fresh saves (setFlag('tutorialOffered') and a reload):
  Viewport     the app is sized to what is really visible (Android: never to screen.height, which includes the bars)
  Title        nothing past the screen edges, the main buttons fully on screen
  Multiplayer  the screen fits, Find match on screen
  Match        a solo match: HUD buttons and streak tiles on screen and at least 40 px, both sticks reachable (real
               two-finger touches through CDP move the player and aim), no element of the HUD past the edges
  Gunsmith     the gallery's gunsmith scene fits
  Install      the guide picks this phone's platform, the once-only sheet fits with its buttons on screen
  Android      the back gesture (history.back) goes back a screen instead of leaving; device tier read from the GPU
Plus a table check of the GPU tier mapping (js/render/quality.js gpuTier). Fails on any problem or console error.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8472))
SHOTS = '--shots' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None   # --only iphone-se,pixel7-tab
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']

CHROME = 'Mozilla/5.0 (Linux; Android 14; {m}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; {m}) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36'
IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS {v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{s} Mobile/15E148 Safari/604.1'

# name, user agent, screen (landscape, CSS px), visible area, pixel ratio, expected platform key of the guide.
DEVICES = [
    ('pixel7-tab', CHROME.format(m='Pixel 7'), (915, 412), (915, 356), 2.625, 'android-chrome'),
    ('pixel7-app', CHROME.format(m='Pixel 7'), (915, 412), (915, 412), 2.625, 'android-chrome'),
    ('galaxy-s23-samsung', SAMSUNG.format(m='SM-S911B'), (780, 360), (780, 304), 3, 'android-samsung'),
    ('galaxy-s24u-chrome', CHROME.format(m='SM-S928B'), (832, 384), (832, 328), 3.75, 'android-chrome'),
    ('small-360x800', CHROME.format(m='SM-A145F'), (800, 360), (800, 360), 2, 'android-chrome'),
    ('iphone-se', IPHONE.format(v='17_5', s='17.5'), (667, 375), (667, 375), 2, 'ios-safari'),
    ('iphone-12mini', IPHONE.format(v='18_1', s='18.1'), (812, 375), (812, 375), 3, 'ios-safari'),
]

failures, errors = [], []


def check(name, ok, info=''):
    print(f'  {name:<62} {"ok" if ok else "FAIL"} {info if not ok or info == "" else str(info)[:140]}')
    if not ok: failures.append(f'{name}: {info}')


# Visible elements of the menu or HUD that reach past the screen. Scrolled content inside a scroller is skipped.
OUTSIDE = """(sel) => {
  const W = innerWidth, H = innerHeight, bad = [];
  const root = document.querySelector(sel) || document.body;
  for (const el of root.querySelectorAll('button, .btn, .seg, .tbtn, .stick, .streaks, h2, h4, p, li, .bar')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('[hidden]')) continue;
    if (el.closest('.scroll-y, .scroll-x, .toast, .rotate, [aria-hidden="true"]')) continue;
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)
      bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
  }
  const se = document.scrollingElement;
  if (se.scrollWidth > W + 1 || se.scrollHeight > H + 1) bad.push(`page scrolls ${se.scrollWidth}x${se.scrollHeight}`);
  return bad.slice(0, 6);
}"""

HUD = """(() => {
  const W = innerWidth, H = innerHeight, c = window.__game.controls, out = { small: [], off: [] };
  for (const el of document.querySelectorAll('.controls .tbtn')) {
    const r = el.getBoundingClientRect();
    if (!r.width || el.closest('[hidden]') || getComputedStyle(el).display === 'none') continue;
    if (Math.min(r.width, r.height) < 40) out.small.push(`${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (r.left < 0 || r.top < 0 || r.right > W || r.bottom > H) out.off.push(el.className);
  }
  out.rects = JSON.parse(JSON.stringify(c.rects));
  return out;
})()"""

STICKS = """(() => { const c = window.__game.controls, m = window.__game.app.match;
  return { left: c.left.id, right: c.right.id, mx: +m.resolvedInput.mx.toFixed(2), mz: +m.resolvedInput.mz.toFixed(2), aiming: !!m.resolvedInput.aiming }; })()"""


async def fresh(ctx, url):
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
    await pg.goto(url)
    await pg.wait_for_timeout(800)
    await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
    await pg.reload()
    await pg.wait_for_timeout(1300)
    return pg


async def device(browser, name, ua, screen, vis, dpr, plat):
    print(f'{name}: {vis[0]}x{vis[1]} visible of {screen[0]}x{screen[1]} @{dpr}x')
    android = 'Android' in ua
    ctx = await browser.new_context(viewport={'width': vis[0], 'height': vis[1]}, screen={'width': screen[0], 'height': screen[1]},
                                    device_scale_factor=dpr, user_agent=ua, has_touch=True, is_mobile=True)
    base = f'http://localhost:{PORT}/'
    pg = await fresh(ctx, f'{base}?debug=1&map=topside&mode=tdm&bots=recruit')

    # Viewport: the app fills what is visible, never more.
    app = await pg.evaluate("(() => { const s = getComputedStyle(document.documentElement); return [parseInt(s.getPropertyValue('--app-w')), parseInt(s.getPropertyValue('--app-h'))]; })()")
    check(f'{name}: app sized to the visible area', app == list(vis), app)

    # Title, with the once-only install sheet a fresh phone in a browser tab gets.
    sheet = await pg.evaluate("!!document.querySelector('.overlay.show .ig-sheet')")
    check(f'{name}: install sheet offered once in a browser tab', sheet, sheet)
    if sheet:
        bad = await pg.evaluate(OUTSIDE, '.overlay')
        check(f'{name}: install sheet fits', not bad, bad)
        if SHOTS: await pg.screenshot(path=f'/tmp/devices-{name}-sheet.png')
        await pg.locator('.ig-sheet [data-act="igDone"]').first.tap()
        await pg.wait_for_timeout(300)
    bad = await pg.evaluate(OUTSIDE, '.menu')
    check(f'{name}: title fits', not bad, bad)
    if SHOTS: await pg.screenshot(path=f'/tmp/devices-{name}-title.png')

    # Multiplayer.
    await pg.locator('[data-act="multiplayer"]').first.tap()
    await pg.wait_for_timeout(700)
    scr = await pg.evaluate('window.__game.menu.el.dataset.screen')
    bad = await pg.evaluate(OUTSIDE, '.menu')
    check(f'{name}: multiplayer screen fits', scr == 'multiplayer' and not bad, [scr, bad])
    if SHOTS: await pg.screenshot(path=f'/tmp/devices-{name}-mp.png')

    # Android back gesture: back a screen, not out of the app.
    if android:
        await pg.evaluate('history.back()')
        await pg.wait_for_timeout(600)
        scr = await pg.evaluate('window.__game.menu.el.dataset.screen')
        check(f'{name}: back gesture returns to the title', scr == 'title', scr)
        await pg.locator('[data-act="help"]').first.tap()
        await pg.wait_for_timeout(500)
        await pg.evaluate('history.back()')
        await pg.wait_for_timeout(600)
        scr = await pg.evaluate('window.__game.menu.el.dataset.screen')
        check(f'{name}: back from How to play returns to the title', scr == 'title', scr)
    else:
        await pg.locator('[data-act="mpBack"]').first.tap()
        await pg.wait_for_timeout(500)

    # Install guide, in How to play.
    await pg.locator('[data-act="help"]').first.tap()
    await pg.wait_for_timeout(500)
    await pg.locator('[data-act="helpTab"][data-tab="install"]').first.tap()
    await pg.wait_for_timeout(500)
    on = await pg.evaluate("document.querySelector('.ig-plats .seg.on')?.dataset.plat")
    bad = await pg.evaluate(OUTSIDE, '.menu')
    check(f'{name}: install guide picks {plat}', on == plat, on)
    check(f'{name}: install guide fits', not bad, bad)
    if SHOTS: await pg.screenshot(path=f'/tmp/devices-{name}-install.png')
    await pg.locator('[data-act="helpBack"]').first.tap()
    await pg.wait_for_timeout(500)

    # A solo match: HUD and sticks.
    await pg.locator('[data-act="custom"]').first.tap()
    await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=60000)
    await pg.wait_for_timeout(1200)
    h = await pg.evaluate(HUD)
    check(f'{name}: match buttons on screen', not h['off'], h['off'])
    check(f'{name}: match buttons at least 40 px', not h['small'], h['small'])
    bad = await pg.evaluate(OUTSIDE, '.controls')
    check(f'{name}: controls inside the screen', not bad, bad)
    profile = await pg.evaluate('window.__game.app.renderer?.profile && { step: window.__game.app.renderer.profile.step, why: window.__game.app.renderer.profile.why, cap: window.__game.app.renderer.profile.dprCap }')
    check(f'{name}: device profile read', bool(profile), profile)
    cdp = await ctx.new_cdp_session(pg)
    W, H = vis
    # The aim stick's resting place (the buttons around it differ by size), and the left thumb low on the left.
    R0 = tuple(await pg.evaluate("(() => { const r = document.querySelector('.stick[data-stick=\"right\"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()"))
    L0 = (W * 0.16, H * 0.66)
    check(f'{name}: aim stick within thumb reach', R0[0] < W - 40 and R0[1] > H * 0.4, R0)

    async def touch(kind, pts):
        await cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in pts.items()]})
    pts = {1: L0, 2: R0}
    await touch('touchStart', pts)
    for k in range(5):
        pts = {1: (L0[0] + 10 * (k + 1), L0[1] - 4 * (k + 1)), 2: (R0[0] - 6 * (k + 1), R0[1] + 3 * (k + 1))}
        await touch('touchMove', pts)
        await pg.wait_for_timeout(30)
    await pg.wait_for_timeout(150)
    s = await pg.evaluate(STICKS)
    check(f'{name}: both sticks held by two thumbs', s['left'] is not None and s['right'] is not None and abs(s['mx']) + abs(s['mz']) > 0.2, s)
    await touch('touchEnd', {})
    await pg.wait_for_timeout(200)
    s = await pg.evaluate(STICKS)
    check(f'{name}: sticks let go', s['left'] is None and s['right'] is None, s)
    if SHOTS: await pg.screenshot(path=f'/tmp/devices-{name}-match.png')
    await pg.evaluate('window.__game.hud.leaveCb()')
    await pg.wait_for_timeout(500)
    await pg.close()

    # Gunsmith, from the gallery (real modules, a veteran save).
    pg = await ctx.new_page()
    await pg.goto(f'{base}dev/ui-gallery.html?frame=gunsmith&size=p13&save=veteran')
    await pg.wait_for_function('window.__ready === true', timeout=60000)
    errors.extend(await pg.evaluate('window.__errors'))
    bad = await pg.evaluate(OUTSIDE, '.menu')
    check(f'{name}: gunsmith fits', not bad, bad)
    if SHOTS: await pg.screenshot(path=f'/tmp/devices-{name}-gunsmith.png')
    await ctx.close()


async def tiers(browser):
    print('GPU tiers')
    ctx = await browser.new_context()
    pg = await ctx.new_page()
    await pg.goto(f'http://localhost:{PORT}/dev/ui-gallery.html?frame=title&size=p13')
    want = {'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)': 'high', 'Adreno (TM) 610': 'low', 'Adreno (TM) 619': 'medium',
            'Mali-G78 MP20': 'high', 'Mali-G57 MC2': 'low', 'Mali-G52 MC2': 'low', 'Mali-G615 MC6': 'medium', 'Samsung Xclipse 940': 'high',
            'PowerVR Rogue GE8320': 'potato', 'Mali-G31 MP2': 'potato', 'Apple GPU': '', 'Apple A12 GPU': 'medium'}
    got = await pg.evaluate("async (want) => { const q = await import('./js/render/quality.js'); return Object.fromEntries(Object.keys(want).map(g => [g, q.gpuTier(g)])); }", want)
    for g, t in want.items(): check(f'gpuTier {g}', got[g] == t, got[g])
    await ctx.close()


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            await tiers(browser)
            for d in DEVICES:
                if not ONLY or d[0] in ONLY: await device(browser, *d)
            await browser.close()
    finally:
        srv.terminate()
    real = [e for e in errors if e]
    print('console errors:', real[:5] or 'none')
    if failures or real:
        print('FAILED:', *failures, sep='\n  ')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
