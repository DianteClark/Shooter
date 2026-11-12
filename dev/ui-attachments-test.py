#!/usr/bin/env python3
"""V11 attachments wave and wave 2: the gunsmith with signature attachments, conversion kits and the wave 2 general
parts (js/shared/attachments-w2.js), at 667x375 and 852x393.

  python3 dev/ui-attachments-test.py [port] [outdir]

Serves the repo, opens dev/ui-gallery.html's gunsmith-try scene (veteran save: every gun at level 30, mastery ladders
not started, so ladder-tier parts show as locked) for several guns with a signature attachment or kit being tried,
and checks: no console or page errors, the delta list shows at least one better and one worse line for the tried part,
the tried part's kind tag shows, locked parts show their requirement, nothing in the attachment panel overflows its
box, and the option list scrolls rather than squashing. Screenshots go to outdir (default /tmp/atts).
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8291
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/atts'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
SIZES = {'se': (667, 375), 'p15': (852, 393)}
# gun, slot, tried id, fitted parts
CASES = [
    ('dmr', 'grip', 'k_runaway', 'optic:s_cheekpiece'),
    ('shotgun', 'barrel', 'k_slugbarrel', ''),
    ('beltlmg', 'mag', 's_longbelt', 'grip:bipod'),
    ('rampar', 'grip', 's_lightwheel', 'barrel:compensator'),
    ('battle', 'grip', 's_hairtrigger', ''),
    ('flechette', 'barrel', 's_needlechoke', ''),
    ('ar', 'grip', 'k_triburst', 'optic:reflex,mag:s_matchmag'),
    ('maul', 'barrel', 's_ironhead', ''),
    ('rampar', 'grip', 's_heavywheel', ''),     # Mastery I: locked on a veteran save.
    # Wave 2: general parts, several fitted at once so the bench shows them together.
    ('sniper', 'optic', 'irons', 'barrel:muzzlebrake,grip:thumbrest'),
    ('pistol', 'grip', 'beavertail', 'optic:laserbox,mag:subsonic,barrel:flashhider'),
    ('launcher', 'barrel', 'guiderail', 'optic:rangefinder,mag:lightrocket,grip:thumbrest'),
    ('shotgun', 'mag', 'magnum', 'barrel:ventrib,grip:rubber,optic:irons'),
    ('lightlmg', 'optic', 'prism', 'barrel:flashhider'),
    ('akimbo', 'grip', 'rubber', 'mag:tapedmag'),
    ('thumper', 'barrel', 'venturi', 'mag:lightrocket,optic:laserbox'),
    ('dmr', 'grip', 'vertical', 'optic:prism,barrel:flashhider'),   # The longest grip list there is (nine parts).
]

CHECK = """() => {
  const q = s => document.querySelector(s);
  const panel = q('.gs-panel'), body = q('.gs-body');
  const r = el => el.getBoundingClientRect();
  const out = { errors: window.__errors || [] };
  const opts = q('.att-opts');
  out.optsScroll = opts ? opts.scrollHeight > opts.clientHeight + 1 : false;
  out.optHeights = [...document.querySelectorAll('.att-opt')].map(b => Math.round(r(b).height));
  out.tags = [...document.querySelectorAll('.att-opt .kind')].map(e => e.textContent);
  out.trying = q('.att-opt.trying b')?.textContent ?? null;
  out.deltas = [...document.querySelectorAll('.att-dl li')].map(li => [li.className, li.textContent]);
  out.why = q('.gs-foot .foot-text small')?.textContent ?? null;
  const t = q('.att-opt.trying'), lst = q('.att-opts');
  out.tryVisible = !!t && r(t).top >= r(lst).top - 1 && r(t).bottom <= r(lst).bottom + 1;
  out.dlClipped = (q('.att-dl')?.scrollHeight ?? 0) > (q('.att-dl')?.clientHeight ?? 0) + 1;
  out.lockText = [...document.querySelectorAll('.att-opt.locked .tag')].map(e => e.textContent.trim());
  // Anything in the panel poking outside it, or text cut off sideways.
  const pb = r(panel);
  out.overflow = [...panel.querySelectorAll('*')].filter(e => {
    const b = r(e);
    if (!b.width || !b.height) return false;
    if (e.closest('.att-opts')) return false;      // The list scrolls inside its own box.
    return b.right > pb.right + 1 || b.bottom > pb.bottom + 1 || b.left < pb.left - 1;
  }).map(e => e.className || e.tagName).slice(0, 5);
  out.foot = q('.gs-foot')?.textContent.replace(/\\s+/g, ' ').trim();
  return out;
}"""


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for size, (vw, vh) in SIZES.items():
                ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, device_scale_factor=2, has_touch=True, is_mobile=True)
                for gun, slot, tried, fit in CASES:
                    pg = await ctx.new_page()
                    errs = []
                    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
                    pg.on('pageerror', lambda e: errs.append(f'PAGEERR {e}'))
                    url = f'http://localhost:{PORT}/dev/ui-gallery.html?frame=gunsmith-try&size={size}&save=veteran&gun={gun}&slot={slot}&try={tried}&fit={fit}&wait=1500'
                    await pg.goto(url)
                    await pg.wait_for_function('window.__ready === true', timeout=60000)
                    res = await pg.evaluate(CHECK)
                    name = f'{OUT}/gunsmith-{size}-{gun}-{tried}.png'
                    await pg.screenshot(path=name)
                    tag = f'{size} {gun} {tried}'
                    if errs or res['errors']:
                        fails.append(f'{tag}: errors {errs + res["errors"]}')
                    if res['overflow']:
                        fails.append(f'{tag}: overflow {res["overflow"]}')
                    if res['trying'] is None:
                        fails.append(f'{tag}: nothing marked as being tried')
                    ups = [d for d in res['deltas'] if 'up' in d[0]]
                    downs = [d for d in res['deltas'] if 'down' in d[0]]
                    if not ups or not downs:
                        fails.append(f'{tag}: deltas need a gain and a cost: {res["deltas"]}')
                    if not res['tryVisible']:
                        fails.append(f'{tag}: the tried part is scrolled out of view')
                    if res['dlClipped']:
                        fails.append(f'{tag}: the delta list is cut off: {res["deltas"]}')
                    if not res['why']:
                        fails.append(f'{tag}: no "what it is for" line')
                    if tried[:2] in ('s_', 'k_') and not any(t in ('Signature', 'Kit') for t in res['tags']):
                        fails.append(f'{tag}: no Signature/Kit tag in the list')
                    if any(h < 26 for h in res['optHeights']):
                        fails.append(f'{tag}: options squashed {res["optHeights"]}')
                    if len(set(res['optHeights'])) > 1:
                        fails.append(f'{tag}: options of uneven height {res["optHeights"]}')
                    if len(res['optHeights']) >= 8 and not res['optsScroll']:
                        fails.append(f'{tag}: a long list ({len(res["optHeights"])}) does not scroll')
                    if tried == 's_heavywheel' and not any('Mastery' in t for t in res['lockText']):
                        fails.append(f'{tag}: ladder lock not shown: {res["lockText"]}')
                    print(f'{tag}: deltas {len(res["deltas"])}, tags {res["tags"]}, scroll {res["optsScroll"]}, foot "{res["foot"]}"')
                    await pg.close()
                await ctx.close()
            await browser.close()
    finally:
        srv.terminate()
    if fails:
        print('\nFAIL\n' + '\n'.join(fails))
        sys.exit(1)
    print(f'\nok: {len(CASES) * len(SIZES)} gunsmith views, screenshots in {OUT}')


asyncio.run(main())
