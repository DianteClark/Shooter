#!/usr/bin/env python3
"""Z-fighting check: python3 dev/zfight-check.py [port] [--maps a,b] [-v]

Builds each map's world with the real renderer (dev/zfight-check.html) and lists coplanar, same-facing, overlapping
triangles of different colours in its opaque meshes: the faces that flicker against each other as the camera pans.
Fails (exit 1) when any map has one. Default port 8431; default maps: every map (giant ones are checked a patch at a
time). Known leftovers on the giant maps: faces that face away from the play camera or sit under the terrain, and a few
roof trims where a building crosses a 32 m tile edge (each tile is settled on its own).
The page also has window.flicker(x, z, steps) (renders the play camera across a slow pan and counts jumping pixels;
?near=0.05 coarsens depth like a weaker GPU) and globalThis.__noSettle (set before load) to see the world without the
lift, for before/after comparisons.
"""
import asyncio, subprocess, sys, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
PORT = int(args[0]) if args and args[0].isdigit() else 8431
MAPS = args[args.index('--maps') + 1].split(',') if '--maps' in args else None
VERBOSE = '-v' in args
GL = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    bad = 0
    try:
        await asyncio.sleep(0.8)
        async with async_playwright() as p:
            br = await p.chromium.launch(args=GL)
            page = await br.new_page(viewport={'width': 932, 'height': 430})
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            maps = MAPS
            if not maps:
                await page.goto(f'http://localhost:{PORT}/dev/zfight-check.html?map=railyard')
                await page.wait_for_function('window.ready', timeout=60000)
                maps = await page.evaluate("import('../js/shared/map.js').then(m => Object.keys(m.MAPS))")
            for m in maps:
                await page.goto(f'http://localhost:{PORT}/dev/zfight-check.html?map={m}' + ('&tris' if VERBOSE else ''))
                await page.wait_for_function('window.ready || window.__err', timeout=120000)
                res = await page.evaluate('check(%d)' % (40 if VERBOSE else 6))
                flag = 'FAIL' if res['count'] else 'ok'
                print(f"{flag:4} {m:12} tris={res['tris']} build={res.get('ms')}ms overlaps={res['count']} (tops {res['horiz']}, walls {res['vert']})")
                if res['count']:
                    bad += 1
                    for s in res['sample']: print('      ', json.dumps(s))
            for e in errs: print('page error:', e); bad += 1
            await br.close()
    finally:
        srv.terminate()
    sys.exit(1 if bad else 0)

asyncio.run(main())
