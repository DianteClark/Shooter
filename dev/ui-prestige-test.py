#!/usr/bin/env python3
"""Browser test for the prestige rework (ROADMAP item 39, docs/PRESTIGE.md): the Prestige view and the prestige reveal.

Run from anywhere: python3 dev/ui-prestige-test.py [port]. It serves the repo itself (python3 -m http.server <port>) and,
on a fresh save in a phone-sized landscape page:
  1. Title player card -> service record -> rank ladder opens the Prestige view: ten ranks, each with its icon, camo and
     calling card, the Master section (tiers and milestones), Next = Prestige I, and Enter prestige locked below 50.
  2. At level 50 the view's Enter prestige asks first, then plays the reveal: the new badge, its camo and calling card
     as tiles inside the screen, the line naming the next rank; a tap returns to the view with rank I earned and its
     camo on every gun.
  3. Prestige X and past it: the save reads Master levels everywhere a level shows (title card, service record, the
     Prestige view's head and its Master section), the Master Line camo opens on every gun at Master 100, and the save
     code round-trips the Master level.
Each step at 667x375 and 852x393; any page error fails it.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8475
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
SIZES = [(667, 375), (852, 393)]

VIEW = """(() => { const m = document.querySelector('#ui .menu') ?? window.__game.menu.el, q = s => document.querySelector(s);
  const r = el => el ? el.getBoundingClientRect() : null;
  return { screen: window.__game.menu.el.dataset.screen, ranks: document.querySelectorAll('.pr-list .pr-row:not(.pr-mrow)').length,
    earned: document.querySelectorAll('.pr-list .pr-row.earned:not(.pr-mrow)').length, mrows: document.querySelectorAll('.pr-mrow').length,
    tiers: document.querySelectorAll('.pr-tier').length, camos: document.querySelectorAll('.pr-list .pr-row:not(.pr-mrow) .pr-cm .pr-sw').length,
    cards: document.querySelectorAll('.pr-list .pr-row:not(.pr-mrow) .pr-cdw .ccard').length, next: q('.pr-next h4 small')?.textContent ?? '',
    enter: q('[data-act="prEnter"]') ? !q('[data-act="prEnter"]').disabled : null, head: q('.pr-id')?.textContent ?? '',
    nowIn: (() => { const b = r(q('.pr-now')); return !!b && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1; })() }; })()"""

REVEAL = """(() => { const q = s => document.querySelector(s), r = el => el.getBoundingClientRect();
  const cer = q('.overlay .cer'); if (!cer) return null;
  const tiles = [...document.querySelectorAll('.pr-rewards .pr-tile')], text = q('.cer-text');
  const inside = tiles.every(t => { const b = r(t); return b.left >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1; });
  const clear = tiles.every(t => r(t).top >= r(text).bottom - 2) && tiles.every(t => r(t).top >= r(q('.cer-emblem')).bottom - 40);
  return { kick: q('.cer-kick')?.textContent ?? '', title: q('.cer h2')?.textContent ?? '', next: q('.pr-cer-next')?.textContent ?? '',
    tiles: tiles.map(t => t.className.split(' ').find(c => c.startsWith('pr-') && c !== 'pr-tile')), inside, clear }; })()"""


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails, errors = [], []

    def check(label, cond, info=''):
        print(f'  {"ok  " if cond else "FAIL"} {label}{": " + str(info) if info != "" else ""}')
        if not cond:
            fails.append(f'{label} {info}')

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for vw, vh in SIZES:
                print(f'{vw}x{vh}')
                ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
                pg = await ctx.new_page()
                pg.on('console', lambda m: errors.append(f'{vw}x{vh}: {m.text}') if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f'{vw}x{vh}: PAGEERR {e}'))
                await pg.goto(f'http://localhost:{PORT}/?debug=1')
                await pg.wait_for_function('window.__game?.Progress', timeout=30000)
                # A fresh save: the first-run training offer would cover the title, so mark it seen and reload.
                await pg.evaluate("localStorage.clear(); window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.name = 'Tester'")
                await pg.reload()
                await pg.wait_for_function("window.__game?.menu?.el?.dataset.screen === 'title'", timeout=30000)
                await pg.wait_for_timeout(600)

                async def tap(sel, wait=500):
                    await pg.locator(sel).first.tap()
                    await pg.wait_for_timeout(wait)

                async def open_view(from_title=True):
                    if from_title:
                        await tap('[data-act="profile"]')
                    await tap('[data-act="pfPrestigeView"]', 700)
                    return await pg.evaluate(VIEW)

                # 1. The view on a fresh save.
                v = await open_view()
                check('player card -> service record -> Prestige view', v['screen'] == 'prestige', v['screen'])
                check('ten ranks, each with a camo and a calling card', v['ranks'] == 10 and v['camos'] == 10 and v['cards'] == 10, v)
                check('Master section: 11 icon tiers and 6 milestones', v['tiers'] == 11 and v['mrows'] == 6, f"{v['tiers']} tiers, {v['mrows']} rows")
                check('next is Prestige I, locked below level 50', 'Prestige I' in v['next'] and v['enter'] is False and v['earned'] == 0, v['next'])
                check('the rank panel fits the screen', v['nowIn'])
                await pg.screenshot(path=f'/tmp/prestige-view-{vw}.png')

                # 2. Level 50, prestige, the reveal.
                await pg.evaluate("window.__game.Progress.addXp(1e6)")
                await tap('[data-act="prBack"]')        # Back to the service record, and in again.
                v = await open_view(from_title=False)
                check('at level 50 Enter prestige is open', v['enter'] is True)
                await tap('[data-act="prEnter"]')
                check('it asks first', await pg.locator('.overlay [data-act="cfYes"]').count() == 1)
                await tap('.overlay [data-act="cfYes"]', 900)
                rv = await pg.evaluate(REVEAL)
                check('the reveal plays', rv is not None)
                if rv:
                    check('reveal names the rank', 'Prestige I ' in rv['kick'] + ' ' and rv['title'].lower() == 'brakeman', f"{rv['kick']} / {rv['title']}")
                    check('reveal shows its camo and calling card', rv['tiles'] == ['pr-camo', 'pr-card'], rv['tiles'])
                    check('reward tiles inside the screen, clear of the title', rv['inside'] and rv['clear'], rv)
                    check('reveal says what is next', 'Prestige II' in rv['next'], rv['next'])
                    await pg.screenshot(path=f'/tmp/prestige-reveal-{vw}.png')
                await tap('.overlay .cer', 700)
                v = await pg.evaluate(VIEW)
                check('tap returns to the view, rank I earned', v['screen'] == 'prestige' and v['earned'] == 1 and 'Prestige II' in v['next'], v)
                camo = await pg.evaluate("['ar', 'sniper', 'pistol'].every(w => window.__game.Progress.isUnlocked(w, 'pp-brake'))")
                check('the rank camo is on every gun', camo)

                # 3. On to Prestige X and Master levels.
                await pg.evaluate("""(() => { const P = window.__game.Progress;
                  while (P.prestige < 10) { P.addXp(81536 - P.xp); P.doPrestige(); }
                  P.addXp(81536 + 2500 * 104 + 10); })()""")
                master = await pg.evaluate('window.__game.Progress.master')
                check('Prestige X level 50 and past: a Master level from total XP', 100 <= master < 750, master)
                await pg.reload()
                await pg.wait_for_function("window.__game?.menu?.el?.dataset.screen === 'title'", timeout=30000)
                await pg.wait_for_timeout(600)
                card = await pg.evaluate("({ lv: document.querySelector('.pcard .pc-lv b')?.textContent ?? '', pr: document.querySelector('.pcard .pc-pr')?.textContent ?? '' })")
                check('title card reads the Master level', card['lv'].startswith('Master') and str(master) in card['lv'] and card['pr'] == 'M', card)
                await tap('[data-act="profile"]')
                pf = await pg.evaluate("document.querySelector('.pf-lvbig')?.textContent ?? ''")
                check('service record reads the Master level', 'Master' in pf, pf.strip())
                await tap('[data-act="pfPrestigeView"]', 700)
                v = await pg.evaluate(VIEW)
                check('the view: Master head, all ten ranks earned, two milestones', 'Master' in v['head'] and v['earned'] == 10 and v['enter'] is None, v)
                await pg.evaluate("document.querySelector('.pr-list').scrollTop = 1e4")
                await pg.wait_for_timeout(300)
                await pg.screenshot(path=f'/tmp/prestige-master-{vw}.png')
                ok = await pg.evaluate("""(() => { const P = window.__game.Progress, m = P.master, code = P.exportCode();
                  return P.isUnlocked('lmg', 'ml-platinum') && !P.isUnlocked('lmg', 'ml-lamps') && P.importCode(code).ok && P.master === m && P.badge().master === m; })()""")
                check('Master Line on every gun at 100, badge and save code keep the Master level', ok)
                await ctx.close()
            await browser.close()
    finally:
        srv.terminate()
    errors = [e for e in errors if 'favicon' not in e]
    for e in errors:
        print('ERROR', e)
    print(f'{len(fails)} failures, {len(errors)} errors')
    sys.exit(1 if fails or errors else 0)


asyncio.run(main())
