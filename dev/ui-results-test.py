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
behind. Last, a match that unlocks a great many items at once (at 640 px): Skip lands on one "Unlocked" summary with a
single celebration, its tiles match the unlocks the save reported, a tile opens its unlock sheet, and it can be reopened. Also checks that Random only ever rolls pairs a map hosts, and that the vote's Rematch card is the last match.
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

            # The "Unlocked" summary can cover the results after a match that earned something: Continue clears it.
            async def skip_reel():          # The reel may still be playing (a ceremony carries its own Skip): to its end.
                for sel in ('.overlay [data-act="resSkip"]', '.res-skip:not([hidden])'):
                    if await pg.locator(sel).count():
                        await pg.locator(sel).first.tap()
                        await pg.wait_for_timeout(900)
                        return
            async def tap_res(sel):
                await skip_reel()
                if await pg.locator('.overlay [data-act="uxDone"]').count():
                    await pg.locator('.overlay [data-act="uxDone"]').first.tap()
                    await pg.wait_for_timeout(250)
                await pg.locator(sel).first.tap()
            tap = lambda sel: (lambda: tap_res(sel))

            async def via_picker(map_id):
                await tap_res('[data-act="resMenu"]')
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
            label = await pg.evaluate("(document.querySelector('[data-act=\"resRematch\"] b') ?? document.querySelector('[data-act=\"resRematch\"]'))?.textContent.trim()")
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
            await tap_res('[data-act="resMenu"]')
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
            # Bundled unlocks: one match's worth of XP that climbs dozens of levels.
            await tap_res('[data-act="resMenu"]')
            await pg.wait_for_timeout(600)
            await pg.set_viewport_size({'width': 640, 'height': 360})
            n_unl = await pg.evaluate("""(async () => { const g = window.__game, P = g.Progress;
              const mo = await import('./js/ui/motion.js'); window.__b0 = mo.celebrated.bursts;
              const r = P.applyMatch({ xp: 600000, weapons: {} }); window.__r = r;
              g.menu.results({ outcome: 'win', mode: 'tdm', modeId: 'tdm', mods: [], scores: [10, 4], myTeam: 0, localId: 'me',
                roster: [{ id: 'me', name: 'Tester', team: 0, kills: 9, deaths: 2 }], badges: new Map(), mvp: null,
                xp: { total: 600000, lines: [['Match', 600000]] }, level: r.level, weapons: [], unlocks: r.unlocks,
                challenges: [], proProgress: [], finalKill: null, rematchLabel: 'Rematch', mastery: [] },
                { rematch: () => {}, menu: () => {} });
              return r.unlocks.length; })()""")
            await pg.wait_for_timeout(2400)
            await skip_reel()
            await pg.wait_for_function("!!document.querySelector('.overlay .ux')", timeout=8000)
            ux = await pg.evaluate("""(async () => { const mo = await import('./js/ui/motion.js'), P = window.__game.Progress, r = window.__r;
              const box = document.querySelector('.overlay .ux');
              const gear = r.unlocks.filter(u => ['weapon', 'perk', 'tactical', 'lethal', 'streak'].includes(u.kind));
              return { box: !!box, tiles: document.querySelectorAll('.ux .ux-tile').length, n: document.querySelector('.ux-n')?.textContent,
                stamps: document.querySelectorAll('.rx-cer').length, bursts: mo.celebrated.bursts - window.__b0,
                saved: gear.every(u => P.isItemUnlocked(u.kind, u.id)), gear: gear.length,
                fits: box ? box.scrollWidth <= box.clientWidth + 1 : false, groups: [...document.querySelectorAll('.ux-grp')].map(g => g.dataset.g) }; })()""")
            ok = ux['box'] and n_unl >= 8 and ux['tiles'] == n_unl and ux['n'] == str(n_unl) and ux['stamps'] == 0 and ux['bursts'] <= 1 and ux['saved'] and ux['fits']
            print(f'  {"many unlocks: skip -> one summary, counts":<44} {"ok" if ok else "FAIL"} unlocks={n_unl} {ux}')
            if not ok: failures.append(f'unlocked summary {n_unl} {ux}')
            await pg.screenshot(path='/tmp/results-unlocked.png')
            await pg.locator('.ux [data-act="uxItem"]').first.tap()
            await pg.wait_for_timeout(500)
            sheet = await pg.evaluate("!!document.querySelector('.overlay .ul-layer')")
            await pg.locator('.ul-layer button[data-act="ulClose"]').first.tap()
            await pg.wait_for_timeout(300)
            await pg.locator('[data-act="uxDone"]').first.tap()
            await pg.wait_for_timeout(300)
            gone = await pg.evaluate("!document.querySelector('.overlay .ux')")
            await pg.locator('[data-act="resUnlocked"]').first.tap()
            await pg.wait_for_timeout(400)
            back = await pg.evaluate("document.querySelectorAll('.overlay .ux .ux-tile').length")
            ok = sheet and gone and back == n_unl
            print(f'  {"tile opens its sheet; Continue, then reopen":<44} {"ok" if ok else "FAIL"} sheet={sheet} gone={gone} back={back}')
            if not ok: failures.append(f'summary interactions sheet={sheet} gone={gone} back={back}')
            await browser.close()
    finally:
        srv.terminate()
    print('console errors:', errors[:5] or 'none')
    if failures or errors:
        print('FAILED:', *failures, sep='\n  ')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
