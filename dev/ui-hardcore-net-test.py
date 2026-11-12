#!/usr/bin/env python3
"""The Hardcore switch reaches a friend room (ROADMAP 25): python3 dev/ui-hardcore-net-test.py [port]

Two tabs over ?net=local. The host turns Hardcore on at the bottom of the Multiplayer screen (saved on the device), then
opens a room: the room starts with Hardcore on, the guest's lobby has it (and shows the HC chip), and the match both
phones start plays it. An old save without the setting reads as off.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8276
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
G = 'window.__game.app'
URL = f'http://localhost:{PORT}/?debug=1&net=local&vote=6'


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails, errors = [], []
    check = lambda ok, msg: (print(('ok   ' if ok else 'FAIL ') + msg), None if ok else fails.append(msg))
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            async def page(tag):
                pg = await ctx.new_page()
                pg.on('console', lambda m: errors.append(f'{tag}: {m.text}') if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f'{tag}: PAGEERR {e}'))
                await pg.goto(URL)
                await pg.wait_for_timeout(900)
                return pg
            host = await page('host')
            # An old save: options without the key read as Hardcore off.
            await host.evaluate("localStorage.setItem('switchyard-options', JSON.stringify({ sound: 0.5 })); window.__game.Progress.name='Hosty'; window.__game.Progress.setFlag('tutorialOffered')")
            await host.reload()
            await host.wait_for_timeout(1000)
            await host.locator('[data-act="multiplayer"]').first.click()
            await host.wait_for_timeout(500)
            check(await host.evaluate("!document.querySelector('.mp-hc').classList.contains('on')"), 'an old save reads Hardcore off')
            await host.locator('[data-act="mpHardcore"]').click()
            await host.reload()
            await host.wait_for_timeout(1000)
            await host.locator('[data-act="multiplayer"]').first.click()
            await host.wait_for_timeout(500)
            check(await host.evaluate("document.querySelector('.mp-hc').classList.contains('on')"), 'Hardcore stays on after a reload')
            await host.locator('[data-act="mpBack"]').first.click()
            await host.wait_for_timeout(400)
            await host.locator('[data-act="host"]').first.click()
            await host.wait_for_function(f'{G}.code')
            check(await host.evaluate(f"{G}.lobby.mods.includes('hardcore')"), 'a hosted room starts with Hardcore on')
            code = await host.evaluate(f'{G}.code')
            guest = await page('guest')
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
            await guest.wait_for_function(f"({G}.lobby.mods || []).includes('hardcore')", timeout=10000)
            check(True, "the guest's lobby has Hardcore")
            chip = await guest.evaluate("document.querySelector('.menu')?.textContent.includes('HC') || document.querySelector('.menu')?.textContent.includes('Hardcore')")
            check(chip, 'the guest sees Hardcore on the lobby')
            await guest.locator('[data-act="toggleReady"]').first.click()
            await host.wait_for_function(f'{G}.lobby.humans.every(h => h.ready || h.host)', timeout=10000)
            await host.locator('[data-act="start"]').first.click()
            await host.wait_for_function(f'{G}.vote?.options', timeout=10000)
            # A card Hardcore fits (not battle royale).
            i = await host.evaluate(f"{G}.vote.options.findIndex(o => !['br', 'brduo', 'brsolo', 'exq', 'exd'].includes(o.mode) && o.mode !== 'random')")
            for pg in pages:
                try: await pg.locator(f'.vote-card[data-i="{i}"]:not([disabled])').click(timeout=6000)
                except Exception: pass      # A ballot that misses the window only leaves the pick to the other.
            await guest.wait_for_function(f'{G}.inMatch && {G}.matchInfo', timeout=60000)
            mods = await guest.evaluate(f'{G}.matchInfo.mods')
            check('hardcore' in (mods or []), f"the guest's match plays Hardcore ({mods})")
            juggler.cancel()
            await browser.close()
    finally:
        srv.terminate()
    errors = [e for e in errors if 'GL Driver' not in e and 'GPU stall' not in e]
    for e in errors[:10]: print('ERROR', e)
    print('ok' if not fails and not errors else f'{len(fails)} failures, {len(errors)} console errors')
    sys.exit(1 if fails or errors else 0)

asyncio.run(main())
