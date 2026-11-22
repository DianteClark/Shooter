#!/usr/bin/env python3
"""Arsenal wave 5 (ROADMAP item 68, docs/WEAPONS-OVERHAUL.md "Wave 5"): the new guns, perks, streaks and operators drawn.

  python3 dev/ui-wave5-test.py [port] [outdir]

Serves the repo and, with no console or page errors allowed:
  - dev/gun-gallery.html: the five new guns from the side and from above, stock and with a full kit;
  - dev/ops-lineup.html: the four new operators at the issue, Elite (active effect) and Mastery (suit) skins, close up
    and at match scale;
  - dev/ui-gallery.html: the loadout screen with Overkill equipped and a second primary in the sidearm slot.
Screenshots go to outdir (default /tmp/wave5).
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 10322
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/wave5'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
GUNS = 'hipsmg,panlmg,autosniper,flare,lockon'
OPS = 'juniper,fenwick,odessa,calder'
PAGES = [
    ('guns-stock', f'/dev/gun-gallery.html?ids={GUNS}&views=side,top&cols=4', (1200, 900)),
    ('guns-kit', f'/dev/gun-gallery.html?ids=hipsmg,panlmg,autosniper&views=side,top&cols=4&kit=optic:reflex,barrel:compensator,mag:extmag,grip:vertical', (1200, 600)),
    ('ops-base', f'/dev/ops-lineup.html?ops={OPS}&skin=base&view=front&zoom=2&w=1000&h=420', (1000, 420)),
    ('ops-elite', f'/dev/ops-lineup.html?ops={OPS}&skin=3&view=front&zoom=2&w=1000&h=420', (1000, 420)),
    ('ops-mastery-front', f'/dev/ops-lineup.html?ops={OPS}&skin=5&view=front&zoom=2&w=1000&h=420', (1000, 420)),
    ('ops-mastery-top', f'/dev/ops-lineup.html?ops={OPS}&skin=5&view=game&zoom=2&per=4&w=852&h=393', (852, 393)),
    ('ops-game', f'/dev/ops-lineup.html?ops={OPS}&skin=5&view=game&mixteams=1&w=852&h=393', (852, 393)),
]


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for name, path, (vw, vh) in PAGES:
                ctx = await browser.new_context(viewport={'width': vw, 'height': vh})
                pg = await ctx.new_page()
                errs = []
                pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
                pg.on('response', lambda r: errs.append(f'404 {r.url}') if r.status == 404 and 'favicon' not in r.url else None)
                pg.on('pageerror', lambda e: errs.append(f'PAGEERR {e}'))
                await pg.goto(f'http://localhost:{PORT}{path}')
                try:
                    await pg.wait_for_function('window.__ready === true', timeout=90000)
                except Exception:
                    await pg.wait_for_timeout(6000)
                await pg.wait_for_timeout(1500)
                await pg.screenshot(path=f'{OUT}/{name}.png')
                if errs:
                    fails.append(f'{name}: {errs[:4]}')
                print(f'{"FAIL" if errs else "ok  "} {name}')
                await ctx.close()
            await browser.close()
    finally:
        srv.terminate()
    if fails:
        print('\n'.join(fails))
        sys.exit(1)
    print(f'all ok, screenshots in {OUT}')

asyncio.run(main())
