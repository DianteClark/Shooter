#!/usr/bin/env python3
"""Mastery screen badge case (roadmap 40): every badge reachable, at 640 to 956 px wide.

Run: python3 dev/ui-mastery-badges-test.py [port]. Opens Mastery with 60 badges earned (Progress.badges stubbed) and
checks, at each width, that the case under the tabs holds all of them in a strip that scrolls sideways (touch: a real CDP drag
with the finger lifted mid-fling; controller: the focus ring walked onto the last badge scrolls it in), that every badge
is a button that opens its track, and that nothing spills out of the side column.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8645
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
SIZES = [(640, 360), (667, 375), (740, 360), (844, 390), (932, 430), (956, 440)]

OPEN = """async () => {
  const g = window.__game, P = g.Progress, { STREAKS, TACTICALS, LETHALS } = await import('/js/shared/catalog.js');
  const ids = [...Object.keys(TACTICALS), ...Object.keys(LETHALS), ...Object.keys(STREAKS)];
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `badge:${ids[i % ids.length]}-${1 + i % 2}`, item: ids[i % ids.length], grade: 1 + i % 2, name: ids[i % ids.length], kind: 'lethal' }));
  P.badges = () => many;
  const m = await import('/js/ui/mastery.js');
  m.masteryScreen(g.menu, { onBack() {} });
}"""

STATE = """() => { const grid = document.querySelector('.m-case-grid'), side = document.querySelector('.m-side');
  const r = grid.getBoundingClientRect(), s = side.getBoundingClientRect(), items = [...grid.querySelectorAll('.m-badge')];
  const last = items.at(-1)?.getBoundingClientRect();
  return { n: items.length, buttons: items.every(b => b.tagName === 'BUTTON' && b.dataset.act === 'mOpen'), sh: grid.scrollHeight, ch: grid.clientHeight, top: grid.scrollTop,
    gridBottom: r.bottom, gridTop: r.top, sideBottom: s.bottom, sideRight: s.right, vh: innerHeight,
    lastIn: !!last && last.left >= r.left - 1 && last.right <= r.right + 1 && last.bottom <= r.bottom + 1,
    left: grid.scrollLeft, sw: grid.scrollWidth, cw: grid.clientWidth,
    spill: [...side.querySelectorAll('*')].filter(el => { if (el.closest('.m-case-grid')) return false; const b = el.getBoundingClientRect(); return b.width && (b.right > s.right + 1 || b.bottom > innerHeight + 1); }).length,
    ox: getComputedStyle(grid).overflowX, rows: Math.round(grid.clientHeight / 32) }; }"""


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    def check(name, ok, info=''):
        print(f'  {name:<64} {"ok" if ok else "FAIL"} {info}')
        if not ok: failures.append(f'{name}: {info}')
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for w, h in SIZES:
                ctx = await browser.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True)
                pg = await ctx.new_page()
                pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
                await pg.goto(f'http://localhost:{PORT}/?debug=1')
                await pg.wait_for_timeout(700)
                await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
                await pg.reload()
                await pg.wait_for_timeout(1000)
                await pg.evaluate(f'({OPEN})()')
                await pg.wait_for_timeout(600)
                s = await pg.evaluate(f'({STATE})()')
                check(f'{w}x{h} all 60 badges, as buttons', s['n'] == 60 and s['buttons'], s['n'])
                check(f'{w}x{h} the strip scrolls inside the side column', s['ox'] == 'auto' and s['sw'] > s['cw'] and s['gridBottom'] <= s['vh'] + 1 and s['spill'] == 0, s)
                # Touch: a drag up the case, lifted while still moving (a fling).
                grid = await pg.evaluate("(() => { const r = document.querySelector('.m-case-grid').getBoundingClientRect(); return [r.right - 10, r.left + 10, r.top + 14]; })()")
                cdp = await ctx.new_cdp_session(pg)
                x0, x1, y = grid
                await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y, 'id': 1}]})
                for k in range(1, 9):
                    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + (x1 - x0) * k / 8, 'y': y, 'id': 1}]})
                    await pg.wait_for_timeout(12)
                await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': [{'x': x1, 'y': y, 'id': 1}]})
                await pg.wait_for_timeout(700)
                s2 = await pg.evaluate(f'({STATE})()')
                check(f'{w}x{h} a finger drag scrolls the badges ({s2["rows"]} row(s))', s2['left'] > 20 and s2['rows'] >= 1, s2['left'])
                # Controller: the focus ring's own step (scrollIntoView on the element it lands on) brings the last one in.
                await pg.evaluate("document.querySelector('.m-case-grid').scrollLeft = 0")
                await pg.evaluate("document.querySelector('.m-badge:last-child').scrollIntoView({ block: 'nearest', inline: 'nearest' })")
                await pg.wait_for_timeout(200)
                s3 = await pg.evaluate(f'({STATE})()')
                check(f'{w}x{h} the last badge scrolls into view for the focus ring', s3['lastIn'], s3['left'])
                await pg.screenshot(path=f'/tmp/mastery-badges-{w}.png')
                # A tap on a badge opens its track.
                await pg.locator('.m-badge').last.tap()
                await pg.wait_for_timeout(500)
                sheet = await pg.evaluate("!!document.querySelector('.m-sheet')")
                check(f'{w}x{h} a badge opens its mastery track', sheet)
                await ctx.close()
            await browser.close()
    finally:
        srv.terminate()
    print('console errors:', errors[:5] or 'none')
    if failures or errors:
        print('FAILED:', *failures, sep='\n  ')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
