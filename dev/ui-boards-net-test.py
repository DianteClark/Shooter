#!/usr/bin/env python3
"""Friends' career cards over ?net=local (two tabs, BroadcastChannel): python3 dev/ui-boards-net-test.py [port] [outdir]

The host opens a room, a second tab joins, both play a short match. Checks: each tab stores the other's career card
(js/shared/boards.js) under the other's player id, dated today, with the match counted (as of that match); neither
stores itself; the Boards screen's Friends view lists the friend with the friend mark. Screenshots of both tabs' boards.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8352
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/boards'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
G = 'window.__game.app'
URL = f'http://localhost:{PORT}/?debug=1&net=local&vote=5'
FRIENDS = "import('/js/ui/progress.js').then(m => JSON.stringify(m.Friends.list(window.__game.app.net?.localId)))"


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails, errors = [], []
    check = lambda ok, msg: (print(('ok   ' if ok else 'FAIL ') + msg), None if ok else fails.append(msg))
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            async def page(tag, name):
                pg = await ctx.new_page()
                pg.on('console', lambda m: errors.append(f'{tag}: {m.text}') if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f'{tag}: PAGEERR {e}'))
                await pg.goto(URL)
                await pg.wait_for_function("!!window.__game?.Progress", timeout=30000)
                await pg.evaluate(f"window.__game.Progress.name='{name}'; window.__game.Progress.setFlag('tutorialOffered')")
                await pg.reload()
                await pg.wait_for_timeout(1000)
                return pg
            host = await page('host', 'Hosty')
            await host.locator('[data-act="host"]').first.click()
            await host.wait_for_function(f'{G}.code')
            code = await host.evaluate(f'{G}.code')
            guest = await page('guest', 'Guesty')
            pages = [host, guest]
            async def juggle():
                while True:
                    for pg in pages:
                        try: await pg.bring_to_front()
                        except Exception: pass
                        await asyncio.sleep(0.12)
            juggler = asyncio.create_task(juggle())
            await guest.evaluate(f"window.__game.join('{code}')")
            await host.wait_for_function(f'{G}.lobby.humans.length === 2', timeout=60000)
            hid = await host.evaluate(f'{G}.net.localId')
            gid = await guest.evaluate(f'{G}.net.localId')
            # Sharing a lobby already swaps cards.
            await host.wait_for_function(f"{FRIENDS}.then(s => JSON.parse(s).length === 1)", timeout=10000)
            await guest.wait_for_function(f"{FRIENDS}.then(s => JSON.parse(s).length === 1)", timeout=10000)
            hf = json.loads(await host.evaluate(FRIENDS)); gf = json.loads(await guest.evaluate(FRIENDS))
            check(hf[0]['id'] == gid and hf[0]['card']['name'] == 'Guesty' and gf[0]['id'] == hid and gf[0]['card']['name'] == 'Hosty', 'in the lobby each phone stores the other under its player id')
            before = hf[0]['card']['m'], gf[0]['card']['m']
            await guest.wait_for_selector('[data-act="toggleReady"]', timeout=10000)
            await guest.locator('[data-act="toggleReady"]').first.click()
            await host.wait_for_function(f'{G}.lobby.humans.every(h => h.ready || h.host)', timeout=10000)
            await host.wait_for_timeout(300)
            await host.locator('[data-act="start"]').first.click()
            await host.wait_for_function(f'{G}.vote?.options', timeout=10000)
            for pg in pages:      # A vote nobody casts resolves by itself after a few seconds (?vote=5).
                # Every friend vote carries a Battle Royale card; a clock-ended match needs a timed mode.
                try: await pg.locator('.vote-card').filter(has_not_text='Battle Royale').first.click(timeout=3000)
                except Exception: pass
            await host.wait_for_function(f'{G}.inMatch && !!{G}.match?.sim', timeout=30000)
            await guest.wait_for_function(f'{G}.inMatch', timeout=30000)
            for pg in pages: await pg.evaluate(f"{G}.renderer?.setQuality?.('potato')")
            await host.wait_for_timeout(2500)
            # Any mode the vote landed on (rounds, battle royale): end it outright.
            await host.evaluate(f"(() => {{ const s = {G}.match.sim; if (s.phase !== 'ended') s._end(0); }})()")
            for pg in pages:
                await pg.wait_for_function("window.__game.menu.el.dataset.screen === 'results'", timeout=40000)
            await host.wait_for_timeout(9000)      # The results reel plays out before the test leaves the screen.
            hf = json.loads(await host.evaluate(FRIENDS)); gf = json.loads(await guest.evaluate(FRIENDS))
            today = time.time() * 1000
            check(len(hf) == 1 and len(gf) == 1, f"one friend each, never yourself: host {[f['id'] for f in hf]} guest {[f['id'] for f in gf]} (ids {hid}, {gid}; now {await guest.evaluate(f'{G}.net?.localId')})")
            check(hf[0]['card']['m'] == before[0] + 1 and gf[0]['card']['m'] == before[1] + 1, f"after the match each card counts it (as of that match): {before} -> {hf[0]['card']['m']}, {gf[0]['card']['m']}")
            check(abs(hf[0]['at'] - today) < 120000 and abs(gf[0]['at'] - today) < 120000, 'dated when last seen')
            check(set(hf[0]['card'].keys()) == set(gf[0]['card'].keys()) and 'loadouts' not in hf[0]['card'] and 'weapons' not in hf[0]['card'], 'only the career summary travels')
            juggler.cancel()
            for tag, pg in (('host', host), ('guest', guest)):
                await pg.bring_to_front()
                await pg.evaluate(f"import('/js/ui/boards.js').then(m => m.boardsScreen(window.__game.menu, {{ onBack: () => {{}}, myId: {G}.net?.localId ?? 'me', view: 'friends', cat: 'kills' }}))")
                await pg.wait_for_timeout(700)
                rows = await pg.evaluate("[...document.querySelectorAll('.bd-body .bd-row')].map(r => [r.classList.contains('friend'), r.classList.contains('me'), r.querySelector('.bd-name b').textContent])")
                other = 'Guesty' if tag == 'host' else 'Hosty'
                check(len(rows) == 2 and any(f and n == other for f, m, n in rows) and any(m for f, m, n in rows), f'{tag}: the Friends board lists {other} (friend mark) and you: {rows}')
                await pg.locator('.bd-row.friend').first.click()
                await pg.wait_for_timeout(400)
                sub = await pg.evaluate("document.querySelector('.bdd .ccard small')?.textContent ?? ''")
                check('as of' in sub, f'{tag}: tapping the friend shows "as of": {sub}')
                await pg.screenshot(path=os.path.join(OUT, f'net-{tag}-friends-852x393.png'))
            await browser.close()
    finally:
        srv.terminate()
    errors = [e for e in errors if 'favicon' not in e]
    for e in errors: print('ERROR', e)
    print('FAILED' if fails or errors else 'all ok')
    sys.exit(1 if fails or errors else 0)


asyncio.run(main())
