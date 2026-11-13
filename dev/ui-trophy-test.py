#!/usr/bin/env python3
"""Browser test for the rewards pass (docs/UNLOCKS-AUDIT-2026-11-12.md): the Trophy Case and the unlock preview sheets.

Run from anywhere: python3 dev/ui-trophy-test.py [port] [--shots]. It serves the repo itself (python3 -m http.server
<port>) and, on a fresh save in phone-sized landscape pages from 640 to 956 px wide:
  1. Title player card -> service record -> Trophy case: five collections with bars and a total, six personal bests,
     Graveyard Shift's maps, an empty rarest row; nothing past the screen's edges.
  2. A seeded career (feats, a 12-kill streak, a 45 m kill, a battle royale win, a 6:40 extraction, round 31 on Night
     Market): the bests read back, the rarest row shows the feat emblems and gold cards, a tile opens its sheet marked
     Unlocked.
  3. Calling cards: a locked card opens its sheet over the picker (how, bar, numbers, Play now); Close keeps the picker;
     Play now on a mode card opens Multiplayer on that playlist. A locked feat emblem opens its sheet.
  4. Every other kind (camo, tracer, operator, skin, finisher, emote, attachment, gun, perk, tactical, lethal, streak)
     opens a sheet with a name, a how line and numbers, inside the screen; a locked title emote opens one too.
  5. The rewards gallery (dev/rewards-gallery.html) draws every new card and feat emblem with no page error.
Any console error or page error fails it. With --shots the screens go to /tmp/trophy/.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8476))
SHOTS = '--shots' in sys.argv
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
SIZES = [(640, 360), (667, 375), (852, 393), (956, 440)]
OUT = '/tmp/trophy'

TROPHY = """(() => { const q = s => document.querySelector(s), all = s => [...document.querySelectorAll(s)];
  const over = all('.tc-wrap *').filter(el => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1) && !el.closest('.tc-rare-row'); }).length;
  return { screen: window.__game.menu.el.dataset.screen, cats: all('.tc-cat').length, total: q('.tc-total b')?.textContent ?? '',
    recs: all('.tc-rec').map(r => [r.querySelector('small').textContent, r.querySelector('b').textContent]), zm: all('.tc-zm > div').map(d => d.textContent),
    rare: all('.tc-tile').map(t => t.dataset.kind + ':' + t.dataset.id), none: !!q('.tc-none'), over,
    hdr: q('.hdr-tag')?.textContent ?? '' }; })()"""

SHEET = """(() => { const q = s => document.querySelector(s); const l = q('.ul-layer'); if (!l) return null;
  const b = q('.ul-sheet').getBoundingClientRect();
  return { kind: l.dataset.kind, id: l.dataset.id, name: q('.ul-body h2')?.textContent ?? '', how: q('.ul-how')?.textContent ?? '',
    nums: q('.ul-prog small')?.textContent ?? null, bar: !!q('.ul-bar'), play: !!q('[data-act="ulPlay"]'), state: q('.ul-kick em')?.textContent ?? '',
    inside: b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1, cardsSheet: !!q('.cards-sheet') }; })()"""

SEED = """(async () => { const P = window.__game.Progress;
  P.applyMatch({ xp: 0, weapons: {}, pro: {}, mastery: {}, mapId: 'railyard', won: true, career: null,
    life: { ace: 1, streak10: 1, 'br:won': 1, 'br:top5': 1, finishers: 3, 'mapwon:railyard': 11, 'won:hq': 6 },
    records: { streak: 12, long: 45, brPlace: 1, exSecs: 400 }, zmFeat: { escaped: 26, boss: false } });
  P.applyMatch({ xp: 0, weapons: {}, pro: {}, mastery: {}, mapId: 'neon', won: false, career: null, life: {}, zmFeat: { escaped: 31, boss: true } });
  P.recordZm('neon', 31); return P.records(); })()"""


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails, errors = [], []

    def check(label, cond, info=''):
        print(f'  {"ok  " if cond else "FAIL"} {label}{": " + str(info) if info != "" else ""}')
        if not cond:
            fails.append(f'{label} {info}')

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=ARGS)
            for vw, vh in SIZES:
                tag = f'{vw}x{vh}'
                print(tag)
                ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
                pg = await ctx.new_page()
                pg.on('console', lambda m, tag=tag: errors.append(f'{tag}: {m.text}') if m.type == 'error' else None)
                pg.on('pageerror', lambda e, tag=tag: errors.append(f'{tag}: PAGEERR {e}'))
                await pg.goto(f'http://localhost:{PORT}/?debug=1')
                await pg.wait_for_function('window.__game?.Progress', timeout=30000)
                await pg.evaluate("localStorage.clear(); window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.name = 'Tester'")
                await pg.reload()
                await pg.wait_for_function("window.__game?.menu?.el?.dataset.screen === 'title'", timeout=30000)
                await pg.wait_for_timeout(600)

                async def tap(sel, wait=450):
                    await pg.locator(sel).first.tap()
                    await pg.wait_for_timeout(wait)

                async def shot(name):
                    if SHOTS:
                        await pg.screenshot(path=f'{OUT}/{tag}-{name}.png')

                # 1. Fresh save.
                await tap('[data-act="profile"]', 700)
                check('service record has the Trophy case button', await pg.locator('.pf-trophy').count() == 1)
                await shot('record')
                await tap('[data-act="pfTrophy"]', 700)
                t = await pg.evaluate(TROPHY)
                check('trophy screen opens', t['screen'] == 'trophy', t['screen'])
                check('five collections and a total', t['cats'] == 5 and t['total'].endswith('%'), t)
                check('six personal bests, all empty on a fresh save', len(t['recs']) == 6 and t['recs'][0][1] == '-', t['recs'])
                check('Graveyard Shift maps listed', len(t['zm']) == 4, t['zm'])
                check('rarest row empty', t['none'] and not t['rare'])
                check('nothing past the screen edges', t['over'] == 0, t['over'])
                await shot('trophy-fresh')

                # 2. Seeded career.
                rec = await pg.evaluate(SEED)
                check('records saved', rec['streak'] == 12 and rec['long'] == 45 and rec['brPlace'] == 1 and rec['exSecs'] == 400, rec)
                await tap('[data-act="tcBack"]', 500)
                await tap('[data-act="pfTrophy"]', 700)
                t = await pg.evaluate(TROPHY)
                recs = dict(t['recs'])
                check('bests read back', recs.get('Best kill streak') == '12' and recs.get('Longest kill') == '45 m' and recs.get('Best battle royale finish') == 'Winner'
                      and recs.get('Fastest extraction') == '6:40', recs)
                check('Night Market round 31 and escapes', any('31' in z and 'Night Market' in z for z in t['zm']), t['zm'])
                check('rarest shows feat emblems and earned cards', any(r.startswith('emblem:feat-ace') for r in t['rare']) and any(r.startswith('emblem:feat-zm30') for r in t['rare'])
                      and any(r.startswith('card:') for r in t['rare']), t['rare'])
                check('still nothing past the edges', t['over'] == 0, t['over'])
                await shot('trophy-seeded')
                await tap('.tc-tile[data-kind="emblem"]', 500)
                s = await pg.evaluate(SHEET)
                check('a rare tile opens its sheet, marked Unlocked', s and s['state'] == 'Unlocked' and s['inside'], s)
                await shot('sheet-rare')
                await tap('.ul-btns [data-act="ulClose"]', 400)
                check('Close dismisses the sheet', await pg.evaluate(SHEET) is None)
                await tap('[data-act="tcBack"]', 500)

                # 3. Calling cards and emblems.
                await tap('[data-act="pfCards"]', 700)
                await pg.evaluate("document.querySelector('[data-act=\"csGroup\"][data-g=\"Modes\"]')?.click()")
                await pg.wait_for_timeout(400)
                await pg.evaluate("document.querySelector('.cs-cell[data-id=\"modes-gf-1\"]').scrollIntoView({block:'center'})")
                await tap('.cs-cell[data-id="modes-gf-1"]', 500)
                s = await pg.evaluate(SHEET)
                check('a locked card opens its sheet over the picker', s and s['cardsSheet'] and s['bar'] and s['nums'] == '0 / 5' and s['play'] and s['inside'], s)
                await shot('sheet-card')
                await tap('.ul-btns [data-act="ulClose"]', 400)
                check('Close keeps the picker', await pg.evaluate("!!document.querySelector('.cards-sheet') && !document.querySelector('.ul-layer')"))
                await pg.evaluate("document.querySelector('[data-act=\"csView\"][data-v=\"emblems\"]').click()")
                await pg.wait_for_timeout(400)
                await pg.evaluate("document.querySelector('.es-cell[data-id=\"feat-flawless\"]').scrollIntoView({block:'center'})")
                await tap('.es-cell[data-id="feat-flawless"]', 500)
                s = await pg.evaluate(SHEET)
                check('a locked feat emblem opens its sheet', s and s['name'] == 'Flawless' and s['nums'] == '0 / 1' and s['play'], s)
                await shot('sheet-emblem')
                await tap('[data-act="ulPlay"]', 900)
                mp = await pg.evaluate("({ screen: window.__game.menu.el.dataset.screen, tab: window.__game.app?.mp?.tab, sel: window.__game.app?.mp?.sels?.[window.__game.app?.mp?.tab] })")
                check('Play now opens Multiplayer on Showdown', mp['screen'] == 'multiplayer' and (mp.get('tab') in (None, 'standard')) and (mp.get('sel') is None or mp['sel'].get('playlist') == 'showdown'), mp)
                await shot('playnow')

                # 4. Every other kind, through the module the game uses.
                kinds = [('camo', 'gold', {'weapon': 'ar'}), ('camo', 'blackbox', {'weapon': 'ar'}), ('tracer', None, {'weapon': 'ar'}), ('operator', 'nightjar', {}),
                         ('skin', 'skin:anvil-field', {}), ('finisher', None, {'operator': 'trooper'}), ('emote', None, {}), ('attachment', None, {'weapon': 'ar'}),
                         ('weapon', None, {}), ('perk', 'ghost', {}), ('tactical', 'stun', {}), ('lethal', 'thermite', {}), ('streak', 'gunship', {})]
                for kind, kid, opts in kinds:
                    s = await pg.evaluate("""async ([kind, id, opts]) => {
                      const U = await import('./js/ui/unlocksheet.js'), P = window.__game.Progress;
                      if (!id) {
                        if (kind === 'tracer') id = (await import('./js/shared/camos.js')).TRACERS.find(t => t.prestige)?.id;
                        if (kind === 'finisher') id = P.finishers(opts.operator).find(f => !f.unlocked)?.id;
                        if (kind === 'emote') id = P.emotes().find(f => !f.unlocked)?.id;
                        if (kind === 'weapon') id = Object.keys((await import('./js/shared/weapons.js')).WEAPONS).find(w => !P.isItemUnlocked('weapon', w) && w !== 'golden');
                        if (kind === 'attachment') id = P.attachments(opts.weapon).find(a => !a.unlocked)?.id;
                      }
                      U.unlockSheet(window.__game.menu, kind, id, opts); return id; }""", [kind, kid, opts])
                    await pg.wait_for_timeout(250)
                    sh = await pg.evaluate(SHEET)
                    check(f'{kind} {s}: sheet with a how line and numbers, inside', sh and sh['name'] and len(sh['how']) > 14 and (sh['nums'] or '').count('/') == 1 and sh['inside'], sh)
                    if kind in ('camo', 'operator', 'perk'):
                        await shot(f'sheet-{kind}')
                    await pg.evaluate("document.querySelector('.ul-btns [data-act=\"ulClose\"]')?.click()")
                    await pg.wait_for_timeout(150)
                await ctx.close()

            # 5. The gallery.
            ctx = await browser.new_context(viewport={'width': 1300, 'height': 900})
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(f'gallery: PAGEERR {e}'))
            await pg.goto(f'http://localhost:{PORT}/dev/rewards-gallery.html')
            await pg.wait_for_selector('body[data-ready]', timeout=20000)
            n = await pg.evaluate("[document.querySelectorAll('.ccard').length, document.querySelectorAll('.em svg').length]")
            check('gallery draws every new card and feat emblem', n[0] >= 105 and n[1] == 12, n)
            if SHOTS:
                await pg.screenshot(path=f'{OUT}/gallery.png', full_page=True)
            await browser.close()
    finally:
        srv.terminate()
    for e in errors:
        print('  ERROR', e)
    ok = not fails and not errors
    print('PASS' if ok else f'FAIL ({len(fails)} checks, {len(errors)} errors)')
    sys.exit(0 if ok else 1)


asyncio.run(main())
