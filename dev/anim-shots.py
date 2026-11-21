#!/usr/bin/env python3
"""Screenshots of dev/anim-gallery.html, every scene (docs/ANIMATION.md). Dev only.
   python3 dev/anim-shots.py [--out=/tmp/anim-shots] [--port=9602] [--scenes=deaths,suits,reload,loco,moves] [--view=close] [--extra=only=back,head]"""
import functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
arg = lambda k, d: next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith(f'--{k}=')), d)
OUT, PORT = arg('out', '/tmp/anim-shots'), int(arg('port', '9602'))
SCENES, VIEW, EXTRA = arg('scenes', 'deaths,suits,reload,loco,moves').split(','), arg('view', 'close'), arg('extra', '')
os.makedirs(OUT, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    for sc in SCENES:
        pg = b.new_page(viewport={'width': 1400, 'height': 820})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.goto(f'http://127.0.0.1:{PORT}/dev/anim-gallery.html?scene={sc}&view={VIEW}{"&" + EXTRA if EXTRA else ""}')
        pg.wait_for_function('window.ready === true', timeout=600000)
        path = f'{OUT}/anim-{sc}-{VIEW}{"-" + EXTRA.replace("=", "-").replace("&", "-").replace(",", "-") if EXTRA else ""}.png'
        pg.screenshot(path=path)
        print(path, 'ERRORS ' + ' | '.join(errs) if errs else 'ok')
        pg.close()
    b.close()
srv.shutdown()
