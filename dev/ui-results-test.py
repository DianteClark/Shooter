#!/usr/bin/env python3
"""Regression test: every solo match ends on its results screen, and Rematch replays the same map and mode.

Run from anywhere: python3 dev/ui-results-test.py [port]. It serves the repo itself and plays short matches
(?limit=1&time=20) back to back in one page, the way a player does:
  1. Quick play (Random map and mode) -> results
  2. Rematch -> must be the map and mode match 1 rolled, not a new roll -> results
  3. Menu -> Play vs bots -> Random map -> Start -> results
  4. Rematch, with the end banner and the final-kill turntable made to throw -> results must still come up
  5. Menu -> Play vs bots -> Harvest (Ground War) -> Start -> results, 16 a side
After each: the results screen is on and its tables are in, the match is gone, and no Killcam Skip button is left
behind. Also checks that Random only ever rolls pairs a map hosts, and that the vote's Rematch card is the last match.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8462
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
INJECTED = 'injected for the test'

STATE = """(() => { const g = window.__game, m = g.menu.el;
  return { screen: m.dataset.screen, on: m.classList.contains('on'), tables: !!document.querySelector('.rs.in'),
    inMatch: g.app.inMatch, skips: document.querySelectorAll('.killcam-skip').length, last: g.app.lastPlayed,
    title: document.querySelector('.rs-word small')?.textContent ?? '' }; })()"""

PICKS = """(async () => {
  const v = await import('./js/ui/vote.js'), { MAPS, MAP_IDS } = await import('./js/shared/map.js');
  const { modeFitsMap } = await import('./js/shared/modes.js');
  const bad = [];
  for (let i = 0; i < 400; i++) {
    for (const pick of [{ mapId: 'random', mode: 'random' }, ...MAP_IDS.map(id => ({ mapId: id, mode: 'random' })), { mapId: 'random', mode: 'tdm' }, { mapId: 'random', mode: 'gwdom' }]) {
      const r = v.resolvePick(pick);
      if (!modeFitsMap(MAPS[r.mapId], r.mode)) bad.push([pick, r]);
    }
    const opts = v.voteOptions(Math.random, { mapId: 'harvest', mode: 'gwtdm' });
    if (!opts[0].again || opts[0].mapId !== 'harvest' || opts[0].mode !== 'gwtdm') bad.push(['again', opts[0]]);
    for (const o of opts.slice(0, 3)) if (!modeFitsMap(MAPS[o.mapId], o.mode)) bad.push(['vote', o]);
  }
  return bad.slice(0, 5);
})()"""


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True)
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and INJECTED not in m.text else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
            await pg.goto(f'http://localhost:{PORT}/?debug=1&bots=elite&limit=1&time=20')
            await pg.wait_for_timeout(900)
            await pg.evaluate("window.__game.Progress.name='Tester'")

            bad = await pg.evaluate(PICKS)
            print('random picks and vote cards valid:', 'ok' if not bad else f'FAIL {bad}')
            if bad: failures.append(f'invalid picks {bad}')

            async def play(name, start, expect=None, inject=False):
                await start()
                await pg.wait_for_function('window.__game.app.inMatch', timeout=20000)
                info = await pg.evaluate('({ mapId: window.__game.app.matchInfo.mapId, mode: window.__game.app.matchInfo.mode, n: window.__game.app.matchInfo.roster.length })')
                if inject:
                    await pg.evaluate(f"""(() => {{ const g = window.__game;
                      g.hud.showEnd = () => {{ throw new Error('{INJECTED}'); }};
                      g.menu.previewMount = () => {{ throw new Error('{INJECTED}'); }}; }})()""")
                await pg.wait_for_function('!window.__game.app.inMatch', timeout=120000)
                await pg.wait_for_timeout(3600)
                st = await pg.evaluate(STATE)
                ok = st['screen'] == 'results' and st['on'] and st['tables'] and st['skips'] <= 1
                if expect and (info['mapId'], info['mode']) != (expect['mapId'], expect['mode']): ok = False
                print(f'  {name:<44} {"ok" if ok else "FAIL"} {info} {st}')
                if not ok: failures.append(f'{name}: {info} {st} expected {expect}')
                await pg.screenshot(path=f'/tmp/results-{name.split()[0]}.png')
                return st

            tap = lambda sel: (lambda: pg.locator(sel).first.tap())

            async def via_picker(map_id):
                await pg.locator('[data-act="resMenu"]').first.tap()
                await pg.wait_for_timeout(700)
                await pg.locator('[data-act="solo"]').first.tap()
                await pg.wait_for_timeout(700)
                await pg.locator(f'[data-act="soloMap"][data-id="{map_id}"]').first.tap()
                await pg.wait_for_timeout(300)
                shown = await pg.evaluate("[...document.querySelectorAll('.solo-mode')].filter(b => !b.hidden).map(b => b.dataset.id)")
                await pg.locator('[data-act="soloStart"]').first.tap()
                return shown

            print('Consecutive solo matches')
            st1 = await play('1 quick play (random)', tap('[data-act="quickPlay"]'))
            st2 = await play('2 rematch replays the roll', tap('[data-act="resRematch"]'), expect=st1['last'])
            shown = []
            async def start3():
                shown.extend(await via_picker('random'))
            st3 = await play('3 picker, random map', start3)
            await play('4 rematch, end banner + preview throw', tap('[data-act="resRematch"]'), expect=st3['last'], inject=True)
            await pg.evaluate("location.reload()")       # Undo the injected faults.
            await pg.wait_for_timeout(1200)
            await pg.locator('[data-act="solo"]').first.tap()   # Title -> picker, then back out through results flow below.
            await pg.wait_for_timeout(700)
            await pg.locator('[data-act="soloMap"][data-id="harvest"]').first.tap()
            await pg.wait_for_timeout(300)
            gw_modes = await pg.evaluate("[...document.querySelectorAll('.solo-mode')].filter(b => !b.hidden).map(b => b.dataset.id)")
            ok = set(gw_modes) <= {'gwtdm', 'gwdom', 'random'} and 'gwtdm' in gw_modes
            print(f'  {"harvest offers only Ground War modes":<44} {"ok" if ok else "FAIL"} {gw_modes}')
            if not ok: failures.append(f'harvest modes {gw_modes}')
            st5 = await play('5 harvest ground war', tap('[data-act="soloStart"]'))
            if st5['last'] and st5['last']['mapId'] != 'harvest': failures.append(f'harvest not played: {st5}')
            n = await pg.evaluate("window.__game.app.badges?.size ?? 0")
            print(f'  {"ground war roster 32":<44} {"ok" if n == 32 else "FAIL"} {n}')
            if n != 32: failures.append(f'ground war roster {n}')
            await browser.close()
    finally:
        srv.terminate()
    print('console errors:', errors[:5] or 'none')
    if failures or errors:
        print('FAILED:', *failures, sep='\n  ')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
