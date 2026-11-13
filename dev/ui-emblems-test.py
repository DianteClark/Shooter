#!/usr/bin/env python3
"""Emblems and rank badges draw on first paint: python3 dev/ui-emblems-test.py [port] [--shots DIR]

A fresh page load (a veteran save: prestige 3, an emblem picked), then the title, Operators, Boards, the service record
and the emblem picker, each opened by its button and checked before anything else is touched. Every emblem chip (.emb)
and rank badge on screen must have its SVG drawn (shapes inside, a real size, not hidden) and no CSS filter on it or
on any box round it: WebKit can leave a filtered inline SVG unpainted until the next repaint, which is how emblems
came to show only after a tap. Fails (exit 1) on a finding or a console error. Default port 8441.
"""
import asyncio, subprocess, sys, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
PORT = int(args[0]) if args and args[0].isdigit() else 8441
SHOTS = args[args.index('--shots') + 1] if '--shots' in args else ''
GL = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']

CHECK = r"""() => {
  const out = [], seen = [];
  const marks = [...document.querySelectorAll('.emb svg, .bdg svg, .pc-badge svg, .pf-badge svg, .pr-big svg, .rk-badge, .rx-emblem svg, .bd-em svg')];
  for (const svg of marks) {
    if (!svg.isConnected || !svg.getClientRects().length) continue;
    const r = svg.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;     // Scrolled away.
    const tag = (svg.closest('[class]')?.className?.baseVal ?? svg.closest('[class]')?.className ?? '') + '';
    seen.push(tag);
    if (r.width < 4 || r.height < 4) out.push(`tiny: ${tag} ${r.width}x${r.height}`);
    if (!svg.querySelector('polygon, path, rect, circle, ellipse, text')) out.push(`empty: ${tag}`);
    for (let e = svg; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.filter && cs.filter !== 'none') { out.push(`filter on ${e.tagName.toLowerCase()}.${(e.className?.baseVal ?? e.className) || ''} (${cs.filter}) round ${tag}`); break; }
      if (cs.visibility === 'hidden' || cs.display === 'none') { out.push(`hidden: ${tag}`); break; }
    }
  }
  return { count: seen.length, out };
}"""

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    bad = []
    try:
        await asyncio.sleep(0.8)
        async with async_playwright() as p:
            br = await p.chromium.launch(args=GL)
            pg = await br.new_page(viewport={'width': 932, 'height': 430})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            base = f'http://localhost:{PORT}/index.html?debug=1'
            await pg.goto(base)
            await pg.wait_for_function('window.__game?.menu', timeout=30000)
            # A veteran save with an emblem picked, then a fresh load of it.
            await pg.evaluate("""() => { const s = JSON.parse(localStorage.getItem('switchyard.save'));
              s.prestige = 3; s.emblem = 'chevron'; s.name = 'Tester'; s.flags = { ...(s.flags || {}), tutorialOffered: true, tutOffer: true };
              localStorage.setItem('switchyard.save', JSON.stringify(s)); }""")
            await pg.goto(base)
            await pg.wait_for_function('window.__game?.menu', timeout=30000)
            await pg.wait_for_timeout(1500)
            await pg.evaluate("window.__game.menu.overlay('')")      # The first-run offers.

            async def screen(name, act=None):
                if act:
                    await pg.evaluate("window.__game.menu.overlay('')")
                    await act()
                    await pg.wait_for_timeout(900)
                r = await pg.evaluate(CHECK)
                print(f"  {name:<16} {r['count']:>3} marks  {'ok' if not r['out'] else 'FAIL'}")
                for o in r['out'][:8]: print('      ', o)
                if r['out']: bad.append(name)
                if name != 'title' and r['count'] == 0: print('       (no marks on screen)')
                if SHOTS:
                    os.makedirs(SHOTS, exist_ok=True)
                    await pg.screenshot(path=os.path.join(SHOTS, f'emb-{name}.png'))

            async def go(sel):
                async def f():
                    await pg.evaluate("() => window.__game.menu.title()")
                    await pg.wait_for_timeout(300)
                    await pg.evaluate(f"document.querySelector('{sel}')?.click()")
                return f

            await screen('title')
            await screen('operators', await go('[data-act=operators]'))
            await screen('boards', await go('[data-act=boards]'))
            await screen('profile', await go('[data-act=profile]'))
            async def picker():
                await pg.evaluate("() => window.__game.menu.title()")
                await pg.wait_for_timeout(300)
                await pg.evaluate("document.querySelector('[data-act=profile]')?.click()")
                await pg.wait_for_timeout(700)
                await pg.evaluate("import('/js/ui/cards.js').then(m => m.cardsSheet(window.__game.menu, { onClose() {}, onChange() {} }))")
                await pg.wait_for_timeout(500)
                await pg.click('.cs-tab[data-v=emblems]')
            await screen('emblem picker', picker)
            for e in errs: print('page error:', e)
            if errs: bad.append('console')
            await br.close()
    finally:
        srv.terminate()
    print('FAIL' if bad else 'ok', ', '.join(bad))
    sys.exit(1 if bad else 0)

asyncio.run(main())
