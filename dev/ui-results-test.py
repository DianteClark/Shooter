#!/usr/bin/env python3
"""Regression test: every solo match ends on its results screen; Next match after Quick play searches the same playlist.

Run from anywhere: python3 dev/ui-results-test.py [port]. It serves the repo itself and plays short matches
(?limit=1&time=20) back to back in one page, the way a player does:
  1. Quick play (Multiplayer, Standard quick play: search, pre-match vote, match) -> results
  2. Next match -> searches Quick play again (the pick is kept) -> results
  3. Menu -> Custom -> Random map -> Start -> results
  4. Rematch, with the end banner and the final-kill turntable made to throw -> results must still come up
  5. Menu -> Custom -> Harvest (Ground War) -> Start -> results, 16 a side
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
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e} {getattr(e, "stack", "")[:600]}'))
            await pg.goto(f'http://localhost:{PORT}/?debug=1&bots=elite&limit=1&time=20&vote=3&search=600')
            await pg.wait_for_timeout(900)
            await pg.evaluate("window.__game.Progress.name='Tester'")
            # The first-run training offer would cover the title; it is shown once, so a reload clears it.
            await pg.evaluate("window.__game.Progress.setFlag('tutorialOffered')")
            await pg.reload()
            await pg.wait_for_timeout(1200)

            bad = await pg.evaluate(PICKS)
            print('random picks and vote cards valid:', 'ok' if not bad else f'FAIL {bad}')
            if bad: failures.append(f'invalid picks {bad}')

            async def play(name, start, expect=None, inject=False):
                await start()
                await pg.wait_for_function('window.__game.app.inMatch', timeout=40000)
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
                await pg.locator('[data-act="custom"]').first.tap()
                await pg.wait_for_timeout(700)
                await pg.locator(f'[data-act="soloMap"][data-id="{map_id}"]').first.tap()
                await pg.wait_for_timeout(300)
                shown = await pg.evaluate("[...document.querySelectorAll('.solo-mode')].filter(b => !b.hidden).map(b => b.dataset.id)")
                await pg.locator('[data-act="soloStart"]').first.tap()
                return shown

            print('Consecutive solo matches')
            st1 = await play('1 quick play (random)', tap('[data-act="quickPlay"]'))
            label = await pg.evaluate("document.querySelector('[data-act=\"resRematch\"]')?.textContent.trim()")
            st2 = await play('2 next match searches quick play again', tap('[data-act="resRematch"]'))
            pick = await pg.evaluate('window.__game.app.lastPick')
            ok = pick and pick.get('mp', {}).get('tab') == 'standard' and pick['mp']['sel']['playlist'] == 'qp' and label == 'Next match'
            print(f'  {"next match kept the quick play pick":<44} {"ok" if ok else "FAIL"} {pick} {label}')
            if not ok: failures.append(f'next match lost the quick play pick: {pick} {label}')
            shown = []
            async def start3():
                shown.extend(await via_picker('random'))
            st3 = await play('3 picker, random map', start3)
            await play('4 rematch, end banner + preview throw', tap('[data-act="resRematch"]'), inject=True)
            await pg.evaluate("location.reload()")       # Undo the injected faults.
            await pg.wait_for_timeout(1200)
            await pg.locator('[data-act="custom"]').first.tap()   # Title -> Custom match, then back out through results flow below.
            await pg.wait_for_timeout(700)
            await pg.locator('[data-act="soloMap"][data-id="harvest"]').first.tap()
            await pg.wait_for_timeout(300)
            gw_modes = await pg.evaluate("[...document.querySelectorAll('.solo-mode')].filter(b => !b.hidden).map(b => b.dataset.id)")
            ok = set(gw_modes) <= {'gwtdm', 'gwdom', 'gwhq', 'gwko', 'gwinf', 'ffa', 'gun', 'random'} and 'gwtdm' in gw_modes and 'tdm' not in gw_modes
            print(f'  {"harvest offers no 6v6 team modes":<44} {"ok" if ok else "FAIL"} {gw_modes}')
            if not ok: failures.append(f'harvest modes {gw_modes}')
            st5 = await play('5 harvest ground war', tap('[data-act="soloStart"]'))
            if st5['last'] and st5['last']['mapId'] != 'harvest': failures.append(f'harvest not played: {st5}')
            n = await pg.evaluate("window.__game.app.badges?.size ?? 0")
            print(f'  {"ground war roster 32":<44} {"ok" if n == 32 else "FAIL"} {n}')
            if n != 32: failures.append(f'ground war roster {n}')
            # Seasons: Custom (just played) moved no rating; the title's Season chip -> Ranked -> Play Ranked plays one
            # of the ranked modes on a medium map, no modifiers, and the results carry the ranked row.
            rk0 = await pg.evaluate('window.__game.Progress.ranked()')
            ok = rk0['pm'] == 0 and rk0['w'] + rk0['l'] + rk0['d'] == 0
            print(f'  {"custom matches never count for ranked":<44} {"ok" if ok else "FAIL"} {rk0["pm"]}')
            if not ok: failures.append(f'custom moved ranked {rk0}')
            await pg.locator('[data-act="resMenu"]').first.tap()
            await pg.wait_for_timeout(700)
            async def ranked_start():
                await pg.locator('[data-act="season"]').first.tap()
                await pg.wait_for_timeout(500)
                await pg.locator('[data-act="szTab"][data-tab="ranked"]').first.tap()
                await pg.wait_for_timeout(300)
                await pg.locator('[data-act="szPlayRanked"]').first.tap()
            st6 = await play('6 ranked from the season screen', ranked_start)
            mi = st6['last'] or {}
            rk1 = await pg.evaluate('window.__game.Progress.ranked()')
            row = await pg.evaluate("!!document.querySelector('.rs-rk')")
            ok = mi.get('mode') in ('hard', 'snd', 'ctl') and mi.get('mapId') in ('railyard', 'harbor', 'neon', 'dust', 'frost', 'topside', 'sunken', 'canopy') and rk1['pm'] == 1 and row
            print(f'  {"ranked: ruleset, a placement, the results row":<44} {"ok" if ok else "FAIL"} {mi.get("mode")} {mi.get("mapId")} pm={rk1["pm"]} row={row}')
            if not ok: failures.append(f'ranked {mi} {rk1} {row}')
            await browser.close()
    finally:
        srv.terminate()
    print('console errors:', errors[:5] or 'none')
    if failures or errors:
        print('FAILED:', *failures, sep='\n  ')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
