#!/usr/bin/env python3
"""The 1118 wave's new screens at phone widths (bug sweep 2026-11-18): python3 dev/ui-sweep-shots.py [port] [outdir]

Serves the repo itself. One phone on a fake Saturday (2026-11-21, so the weekend tournament is live and the weekly
event runs): a fresh save plays one short Team Deathmatch on Railyard (three kills, one death) and saves its replay
clip, founds a clan. Then at 640x360, 852x393 and 932x430 it opens: the tournament bracket, Multiplayer's Spotlight
(tournament and weekly event cards), Challenges with the event panel, the Clan screen (yours and the editor), Boards >
Clans, History, a match's detail, History > Clips, the replay player on that clip, and the unlock sheets of the six new
operators, a signature emote, a Season 2 skin and an event card. On each it runs dev/ui-overflow-test.py's text check
(spill past its plate or the screen, glyphs cut without an ellipsis) and saves a screenshot to outdir. Fails on any
spill, cut or console error.
"""
import asyncio, subprocess, sys, time, os, json, ast
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8396
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/sweep-shots'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
SIZES = [(640, 360), (852, 393), (932, 430)]
CHECK = next(n.value.value for n in ast.parse(open(os.path.join(ROOT, 'dev', 'ui-overflow-test.py')).read()).body
             if isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') == 'CHECK')
FAKE = """(() => { const Real = Date, offset = new Real('2026-11-21T12:00:00').getTime() - Real.now();
  class FakeDate extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); } static now() { return Real.now() + offset; } }
  window.Date = FakeDate; })();"""
G = 'window.__game'
KILL = """(n) => { const s = window.__game.app.match.sim, me = s.byId.get(window.__game.app.match.localId);
  const foes = s.players.filter(p => p.team !== me.team && p.alive).slice(0, n);
  for (const f of foes) s._damage(f, me, 9999, me.ps.weapon, 14, null, true); return foes.length; }"""
DIE = """() => { const s = window.__game.app.match.sim, me = s.byId.get(window.__game.app.match.localId);
  const foe = s.players.find(p => p.team !== me.team && p.alive); if (foe && me.alive) s._damage(me, foe, 9999, foe.ps.weapon, 16); }"""
END = """() => { const s = window.__game.app.match.sim, me = s.byId.get(window.__game.app.match.localId); if (s.phase !== 'ended') s._end(me.team); }"""
SHEET = """([kind, id]) => import('/js/ui/unlocksheet.js').then(m => { m.unlockSheet(window.__game.menu, kind, id); })"""


async def settle_results(pg):
    """The results reel to its end (Skip), then the Unlocked summary it opens over the screen closed (Continue): that
    overlay carries its own Menu and Rematch and covers the results' buttons (bug sweep 2026-11-20)."""
    await pg.evaluate("document.querySelector('.res-skip:not([hidden])')?.click()")
    try: await pg.wait_for_function("!document.querySelector('.res-skip') || document.querySelector('.res-skip').hidden", timeout=60000)
    except Exception: pass
    await pg.wait_for_timeout(300)
    await pg.evaluate("document.querySelector('.overlay.show [data-act=\"uxDone\"]')?.click()")
    await pg.wait_for_timeout(300)


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails, errors, seen = [], [], 0
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            await ctx.add_init_script(FAKE)
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(f'{m.text} {m.location}') if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
            ev = pg.evaluate

            async def tap(sel, wait=500, timeout=45000):
                await pg.locator(sel).first.click(timeout=timeout)
                await pg.wait_for_timeout(wait)

            async def title():
                await pg.goto(f'http://localhost:{PORT}/?debug=1&bots=easy')
                await pg.wait_for_function(f'!!{G}?.Progress', timeout=30000)
                await pg.wait_for_timeout(1200)
                await ev("document.querySelector('.ev-banner')?.remove()")

            await pg.goto(f'http://localhost:{PORT}/?debug=1&bots=easy')
            await pg.wait_for_function(f'!!{G}?.Progress', timeout=30000)
            await ev(f"{G}.Progress.name='SHOTS_SWEEPER'; {G}.Progress.setFlag('tutorialOffered'); {G}.Progress.setFlag('aimHint')")
            await title()
            print('A short match for History and a clip', flush=True)
            await tap('[data-act="custom"]', 700)
            await tap('[data-act="soloMap"][data-id="railyard"]', 300)
            await tap('[data-act="soloMode"][data-id="tdm"]', 300)
            await tap('[data-act="soloStart"]', 600)
            await pg.wait_for_function(f'{G}.app.inMatch && {G}.app.match?.sim?.phase === "live"', timeout=90000)
            await ev(f"{G}.app.renderer?.setQuality?.('potato')")
            await pg.wait_for_timeout(5000)
            for _ in range(3):
                await ev(f'({KILL})(1)')
                await pg.wait_for_timeout(600)
            await ev(f'({DIE})()')
            await pg.wait_for_timeout(5000)
            await ev(END)
            await pg.wait_for_selector('.menu[data-screen="results"] .rs', timeout=120000)
            await pg.wait_for_timeout(3000)
            await settle_results(pg)
            await tap('[data-act="resReplay"]', 2500)
            await pg.locator('.rp-save').click()
            await pg.wait_for_function("document.querySelector('.rp-save')?.textContent === 'Saved'", timeout=15000)
            await pg.locator('.rp-close').click()
            await pg.wait_for_timeout(400)
            await settle_results(pg)
            await tap('[data-act="resMenu"]', 1000)
            # A clan with the longest name and tag the editor takes.
            await ev("import('/js/ui/progress.js').then(m => m.Clan.create({ tag: 'WWWW', name: 'WWWWWWWWWWWWWWWW', c: 4, mk: 6 }))")

            async def measure(name, w, h):
                nonlocal seen
                await pg.wait_for_timeout(700)
                await pg.screenshot(path=f'{OUT}/{name}-{w}x{h}.png')
                r = await ev(CHECK)
                seen += 1
                bad = [f"spill {s['where']} \"{s['text']}\" past {s['past']}" for s in r['spill']] + [f"cut {c['where']} \"{c['text']}\" by {c['by']}px" for c in r['cut']]
                print(f"  {'ok  ' if not bad else 'FAIL'} {name}@{w}x{h}" + (f" ({r['clipped']} graceful)" if r['clipped'] else '') + (f": {bad[:6]}" if bad else ''), flush=True)
                for b in bad: fails.append(f'{name}@{w}x{h}: {b}')

            for w, h in SIZES:
                print(f'{w}x{h}', flush=True)
                await pg.set_viewport_size({'width': w, 'height': h})
                await title()
                await tap('[data-act="multiplayer"]', 800)
                await measure('mp-spotlight', w, h)
                await tap('[data-act="mpTourney"]', 900)
                await measure('tourney-bracket', w, h)
                await title()
                await tap('[data-act="challenges"]', 800)
                await measure('challenges-event', w, h)
                await title()
                await tap('[data-act="profile"]', 800)
                await tap('[data-act="pfClan"]', 700)
                await measure('clan-mine', w, h)
                await tap('[data-act="clEdit"]', 600)
                await measure('clan-edit', w, h)
                await ev(f"import('/js/ui/boards.js').then(m => m.boardsScreen({G}.menu, {{ onBack: () => {{}}, myId: 'me', view: 'clans', cat: 'kills' }}))")
                await measure('boards-clans', w, h)
                await title()
                await tap('[data-act="history"]', 800)
                await measure('history-list', w, h)
                await tap('.hs-body .hs-row[data-i="0"]', 800)
                await measure('history-detail', w, h)
                await tap('[data-act="hmBack"]', 600)
                await tap('[data-act="hsTab"][data-tab="clips"]', 800)
                await measure('history-clips', w, h)
                await tap('[data-act="hcWatch"]', 2500)
                await measure('replay-player', w, h)
                await pg.locator('.rp-close').click()
                await pg.wait_for_timeout(600)
                await title()
                for kind, id in [('operator', o) for o in ['skylark', 'gambit', 'corvid', 'linnet', 'garrison', 'brigid']] + [('emote', 'podium'), ('card', 'ev-gloves')]:
                    try:
                        await ev(SHEET, [kind, id])
                    except Exception as e:
                        fails.append(f'unlock sheet {kind} {id}: {e}'); continue
                    await measure(f'unlock-{kind}-{id}', w, h)
                    await ev(f"{G}.menu.overlay('')")
            await browser.close()
    finally:
        srv.terminate()
    errs = [e for e in errors if 'favicon' not in e]
    for e in errs: print('ERROR', e)
    print(f'{seen} screens measured; ' + ('FAILED' if fails or errs else 'all ok'))
    sys.exit(1 if fails or errs else 0)


asyncio.run(main())
