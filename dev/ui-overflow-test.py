#!/usr/bin/env python3
"""Overflow checker: no text may spill out of its box or be cut mid-glyph, on any menu screen.

Run from anywhere: python3 dev/ui-overflow-test.py [port] [--sizes 667x375,852x393] [--only menus|gunsmith] [--shots DIR]
[--verbose] (lists every graceful truncation too)
It serves the repo itself and loads every menu scene of dev/ui-gallery.html (real modules, fake in-memory saves, fresh
and veteran) at each size, then walks the gunsmith: the classes and guns of every class, and the bench of a spread of
guns on every tab and attachment slot. On each state it measures every visible text run in the page:

  spill    the text's glyph box reaches past the nearest box that clips it (overflow other than visible), or past the
           button, card or plate it sits on, or off the screen; a native scroller (.scroll-y/.scroll-x) only counts on
           its cross axis, since the rest is a scroll away
  cut      an element that clips (overflow hidden/clip) holds more text than it shows, without an ellipsis or a line
           clamp, so a glyph is sliced in half

Truncation with an ellipsis or a line clamp is allowed (names may truncate gracefully) and is listed as a count only.
Fails (exit 1) on any spill, cut or console error. Ports 8321-8329 are the project's; the default is 8328.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
PORT = int(args[0]) if args and args[0].isdigit() else 8328
def opt(name, default):
    return args[args.index(name) + 1] if name in args else default
SIZES = [tuple(map(int, s.split('x'))) for s in opt('--sizes', '667x375,852x393').split(',')]
ONLY = opt('--only', '')
SHOTS = opt('--shots', '')
VERBOSE = '--verbose' in args
SIZE_ID = {(667, 375): 'se', (812, 375): 'mini', (844, 390): 'p13', (852, 393): 'p15', (874, 402): 'p16p', (926, 428): 'plus', (932, 430): 'p16pl', (956, 440): 'pm'}
GL = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']

# Menu scenes of the gallery, and the saves each is checked with.
SCENES = ['title', 'custom', 'custom-lobby', 'training', 'multiplayer', 'mp-modes', 'mp-groundwar', 'mp-br', 'mp-search', 'vote-mp', 'lobby-host', 'lobby-full', 'vote', 'keypad-name', 'not-found', 'loadouts', 'operators', 'profile',
          'save-code', 'options', 'controller', 'a11y', 'lobby-voice', 'help', 'help-install', 'help-updates', 'help-modes', 'install', 'stats', 'challenges', 'history', 'boards', 'boards-friends', 'boards-around', 'boards-kd', 'cards', 'emblems', 'results-draw', 'results-gw', 'results-zm',
          # Seasons and ranked (docs/SEASONS.md): on a day in Season 1 (dev/ui-gallery.html sets the date).
          'title-season', 'season-track', 'season-weekly', 'season-ranked', 'season-pre', 'mp-ranked', 'boards-season', 'boards-ranked', 'results-season', 'lobby-ranked', 'lobby-unranked',
          # Prestige and Master Prestige (docs/PRESTIGE.md).
          'prestige', 'prestige-master', 'prestige-reveal', 'title-master', 'profile-master', 'results-master']
# A spread of guns: long names, no attachments, signature parts and kits, melee, launchers, the akimbo pair.
GUNS = ['ar', 'lmg', 'dmr', 'rampar', 'semisnipe', 'lever', 'scatter', 'thumper', 'golden', 'akimbo', 'knife', 'beltlmg']

CHECK = r"""
(() => {
  const TOL = 1.5, out = { spill: [], cut: [], clipped: 0, trunc: [] };
  const vw = innerWidth, vh = innerHeight;
  const isScroller = el => el.matches('.scroll-y, .scroll-x') || ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) || ['auto', 'scroll'].includes(getComputedStyle(el).overflowX);
  const name = el => {
    const c = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + c;
  };
  const path = el => { const p = []; for (let e = el; e && e !== document.body && p.length < 4; e = e.parentElement) p.unshift(name(e)); return p.join(' > '); };
  const hidden = el => {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || e.hidden) return true;
    }
    return false;
  };
  const plateSel = 'button, .btn, .plate, .tile, .chip, [class*="card"], .op-tag, .hdr-tag, .kind, .tag, .p-tag, .pro-chip';
  const seen = new Set();
  const walker = document.createTreeWalker(document.querySelector('#ui') ?? document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('svg, script, style, .toast, .gs-gl, [aria-hidden="true"]')) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
    if (!rects.length || hidden(el)) continue;
    let r = rects.reduce((a, b) => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }));
    const text = n.data.trim().slice(0, 40);
    // Own clipping: more text than the box shows, without an ellipsis or a clamp.
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'inline' || cs.display === 'contents') continue;
      const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
      if (!clips) continue;
      if (isScroller(e)) break;
      const graceful = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '' && cs.webkitLineClamp !== undefined;
      const overX = e.scrollWidth > e.clientWidth + 1, overY = e.scrollHeight > e.clientHeight + 1;
      // Truncated with an ellipsis or a clamp: what shows is the clipping box, so that box is what must fit.
      if (graceful && (overX || overY)) { out.clipped++; out.trunc.push(path(el) + ' "' + text + '"'); r = e.getBoundingClientRect(); break; }
      // Only the text's own glyphs count: is this run cut by this box?
      const b = e.getBoundingClientRect();
      if (r.right > b.right + TOL || r.left < b.left - TOL || r.bottom > b.bottom + TOL + 2 || r.top < b.top - TOL - 2) {
        const key = 'cut|' + path(el) + '|' + text;
        if (!seen.has(key)) { seen.add(key); out.cut.push({ where: path(el), text, box: name(e), by: Math.round(Math.max(r.right - b.right, b.left - r.left, r.bottom - b.bottom, b.top - r.top)) }); }
      }
      break;
    }
    // Spill: past the plate it sits on, or the screen (a scroller's own axis excepted).
    const plate = el.closest(plateSel);
    const sc = el.closest('.scroll-y, .scroll-x');
    const scX = sc && sc.matches('.scroll-x'), scY = sc && sc.matches('.scroll-y');
    if (plate && (!sc || plate !== sc && sc.contains(plate))) {
      const b = plate.getBoundingClientRect();
      if (r.right > b.right + TOL || r.left < b.left - TOL || r.bottom > b.bottom + TOL + 2 || r.top < b.top - TOL - 2) {
        const key = 'spill|' + path(el) + '|' + text;
        if (!seen.has(key)) { seen.add(key); out.spill.push({ where: path(el), text, past: name(plate) }); }
      }
    }
    const offX = !scX && (r.right > vw + TOL || r.left < -TOL), offY = !scY && (r.bottom > vh + TOL || r.top < -TOL);
    if ((offX || offY) && !(sc && !scX && !scY)) {
      // Something inside a scroller that is merely scrolled out of view is not a spill.
      const inScroll = sc && (() => { const b = sc.getBoundingClientRect(); return r.bottom < b.top || r.top > b.bottom || r.right < b.left || r.left > b.right; })();
      if (!inScroll) {
        const key = 'screen|' + path(el) + '|' + text;
        if (!seen.has(key)) { seen.add(key); out.spill.push({ where: path(el), text, past: 'screen' }); }
      }
    }
  }
  return out;
})()
"""


async def drag(cdp, x, y, dx, dy, steps=8):
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 1}]})
    for i in range(1, steps + 1):
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + dx * i / steps, 'y': y + dy * i / steps, 'id': 1}]})
        await asyncio.sleep(0.016)
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


async def tap(cdp, x, y):
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 2}]})
    await asyncio.sleep(0.06)
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


async def scroll_checks(pg, ctx, vw, vh, fails):
    cdp = await ctx.new_cdp_session(pg)
    where = f'{vw}x{vh} gunsmith scroll'
    centre = "(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })"
    # Attachments: the Halyard's optics are a long list.
    await pg.evaluate("__menu.screen.selectWeapon('ar'); __menu.screen.selectTab('attach'); __menu.screen.slot = 'optic'; __menu.screen.tryAtt = null; __menu.screen.renderPanel(); __menu.screen.update()")
    await pg.wait_for_timeout(400)
    x, y = await pg.evaluate(centre + "('.att-opts')")
    before = await pg.evaluate("document.querySelector('.att-opts').scrollTop")
    await drag(cdp, x, y + 40, 0, -110)
    await pg.wait_for_timeout(700)
    st = await pg.evaluate("({ top: document.querySelector('.att-opts').scrollTop, tried: __menu.screen.tryAtt })")
    if st['top'] <= before + 20:
        fails.append(f'{where}: the attachments list did not follow the thumb (scrollTop {before} -> {st["top"]})')
    if st['tried'] is not None:
        fails.append(f'{where}: dragging the attachments list tried a part ({st["tried"]})')
    # A plain tap on a part still tries it.
    x, y = await pg.evaluate(centre + "('.att-opt:nth-child(3)')")
    await tap(cdp, x, y)
    await pg.wait_for_timeout(300)
    if await pg.evaluate('__menu.screen.tryAtt') is None:
        fails.append(f'{where}: a tap on a part did not try it')
    # The guns: back to the classes and cards, drag the cards, nothing opens.
    await pg.evaluate("__menu.screen.showPick(); __menu.screen.selectCategory('SMG')")
    await pg.wait_for_timeout(500)
    x, y = await pg.evaluate(centre + "('.gs-guns')")
    await drag(cdp, x, y + 50, 0, -120)
    await pg.wait_for_timeout(700)
    st = await pg.evaluate("({ top: document.querySelector('.gs-guns')?.scrollTop ?? -1, view: __menu.screen.view, h: document.querySelector('.gs-guns')?.scrollHeight - document.querySelector('.gs-guns')?.clientHeight })")
    if st['view'] != 'pick':
        fails.append(f'{where}: dragging the gun cards opened a gun')
    elif st['h'] > 20 and st['top'] < 20:
        fails.append(f'{where}: the gun cards did not scroll (scrollTop {st["top"]})')
    # The class strip scrolls sideways under the thumb without switching class.
    x, y = await pg.evaluate(centre + "('.gs-classes')")
    cat = await pg.evaluate('__menu.screen.cat')
    await drag(cdp, x + 120, y, -200, 0)
    await pg.wait_for_timeout(700)
    st = await pg.evaluate("({ left: document.querySelector('.gs-classes').scrollLeft, cat: __menu.screen.cat })")
    if st['cat'] != cat:
        fails.append(f'{where}: dragging the class strip switched class to {st["cat"]}')
    if st['left'] < 20:
        fails.append(f'{where}: the class strip did not scroll sideways (scrollLeft {st["left"]})')
    await pg.evaluate("__menu.screen.selectWeapon('ar')")
    await cdp.detach()


async def touch_scroll(pg, ctx, where, fails):
    """A real thumb drag on the screen's one scroller moves it (native scrolling, momentum on iOS), and taps nothing."""
    sel = '.help-body.scroll-y' if 'help' in where else '.mp-body'
    box = await pg.evaluate("(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, room: e.scrollHeight - e.clientHeight, top: e.scrollTop }; })", sel)
    if box is None:
        fails.append(f'{where}: no scroller {sel}')
        return
    if box['room'] < 20:
        return                                      # Everything fits: nothing to scroll.
    cdp = await ctx.new_cdp_session(pg)
    await drag(cdp, box['x'], box['y'] + 40, 0, -100)
    await pg.wait_for_timeout(700)
    top = await pg.evaluate("(sel => document.querySelector(sel).scrollTop)", sel)
    if top <= box['top'] + 20:
        fails.append(f'{where}: {sel} did not follow the thumb (scrollTop {box["top"]} -> {top})')
    await pg.evaluate("(sel => { document.querySelector(sel).scrollTop = 0; })", sel)
    await cdp.detach()


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails, errors, states, clipped = [], [], 0, 0
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=GL)
            for vw, vh in SIZES:
                ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
                pg = await ctx.new_page()
                tag = {'v': ''}
                pg.on('console', lambda m: errors.append(f"{tag['v']}: {m.text}") if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f"{tag['v']}: PAGEERR {e}"))

                async def load(scene, extra='', wait=None):
                    tag['v'] = f'{vw}x{vh} {scene}{extra}'
                    url = f'http://localhost:{PORT}/dev/ui-gallery.html?frame={scene}&size={SIZE_ID.get((vw, vh), 'p13')}{extra}' + (f'&wait={wait}' if wait else '')
                    await pg.goto(url)
                    await pg.wait_for_function('window.__ready === true', timeout=40000)
                    errs = await pg.evaluate('window.__errors')
                    errors.extend(f"{tag['v']}: {e}" for e in errs)

                async def check(label):
                    nonlocal states, clipped
                    await pg.wait_for_timeout(450)          # Entrances settle.
                    r = await pg.evaluate(CHECK)
                    states += 1
                    clipped += r['clipped']
                    if VERBOSE:
                        for t in r['trunc']:
                            print(f'  trunc {vw}x{vh} {label}: {t}')
                    for kind in ('spill', 'cut'):
                        for x in r[kind]:
                            fails.append(f'{vw}x{vh} {label}: {kind} "{x["text"]}" in {x["where"]} (past {x.get("past") or x.get("box")}{", by " + str(x["by"]) + "px" if "by" in x else ""})')
                    if SHOTS:
                        os.makedirs(SHOTS, exist_ok=True)
                        await pg.screenshot(path=os.path.join(SHOTS, f'{vw}x{vh}-{label.replace(" ", "_").replace("/", "-")}.png'))

                if not ONLY or ONLY == 'menus':
                    for save in ('fresh', 'veteran'):
                        for scene in SCENES:
                            await load(scene, f'&save={save}', 4500 if scene.startswith('results') else None)
                            await check(f'{scene} ({save})')
                            if scene == 'results-gw':       # Every challenge row, scrolled into view.
                                await pg.evaluate("document.querySelector('.prog-card') && (document.querySelector('.prog-card').scrollTop = 1e4)")
                                await check(f'{scene} scrolled ({save})')
                            if scene in ('help-updates', 'help-modes', 'multiplayer', 'mp-br'):
                                await touch_scroll(pg, ctx, f'{vw}x{vh} {scene} ({save})', fails)
                            if scene.startswith('help'):
                                await pg.evaluate("document.querySelectorAll('.scroll-y').forEach(e => e.scrollTop = 1e4)")
                                await check(f'{scene} scrolled ({save})')

                if not ONLY or ONLY == 'gunsmith':
                    for save in ('fresh', 'veteran'):
                        await load('gunsmith-pick', f'&save={save}')
                        for cat in await pg.evaluate("[...document.querySelectorAll('.gs-class')].map(b => b.dataset.cat)"):
                            await pg.evaluate(f"__menu.screen.selectCategory({json.dumps(cat)})")
                            await check(f'gunsmith pick {cat} ({save})')
                    await load('gunsmith', '&save=veteran')
                    for gun in GUNS:
                        await pg.evaluate(f"__menu.screen.selectWeapon({json.dumps(gun)})")
                        for slot in await pg.evaluate("[...document.querySelectorAll('.att-slot:not(:disabled)')].map(b => b.dataset.slot)") or [None]:
                            if slot:
                                await pg.evaluate(f"__menu.screen.slot = {json.dumps(slot)}; __menu.screen.tryAtt = null; __menu.screen.renderPanel(); __menu.screen.update()")
                                # Try the last part of the slot (the list scrolls to it): its deltas and foot show too.
                                await pg.evaluate("(() => { const o = [...document.querySelectorAll('.att-opt')].pop(); o && __menu.screen.tapAttachment(o.dataset.id); })()")
                            await check(f'gunsmith {gun} attach {slot}')
                        for tab in ('camo', 'fx', 'mastery', 'prestige'):
                            await pg.evaluate(f"__menu.screen.selectTab({json.dumps(tab)})")
                            await check(f'gunsmith {gun} {tab}')
                            await pg.evaluate("(() => { const b = document.querySelector('.gs-body'); if (b) b.scrollTop = 1e4; })()")
                            await check(f'gunsmith {gun} {tab} scrolled')
                        await pg.evaluate("__menu.screen.selectTab('attach')")
                    # Native scrolling: a real touch drag moves the attachments list and the gun cards, and the
                    # finger that drags never picks a part or a gun; a plain tap still does.
                    await scroll_checks(pg, ctx, vw, vh, fails)
                    await load('gunsmith', '&save=fresh')
                    for gun in ('ar', 'pistol'):
                        await pg.evaluate(f"__menu.screen.selectWeapon({json.dumps(gun)})")
                        for tab in ('attach', 'camo', 'mastery', 'prestige'):
                            await pg.evaluate(f"__menu.screen.selectTab({json.dumps(tab)})")
                            await check(f'gunsmith fresh {gun} {tab}')
                await ctx.close()
            await browser.close()
    finally:
        srv.terminate()
    errors = [e for e in errors if 'favicon' not in e]
    for f in fails:
        print('FAIL', f)
    for e in errors:
        print('ERROR', e)
    print(f'{states} states checked, {clipped} graceful truncations, {len(fails)} overflow failures, {len(errors)} errors')
    sys.exit(1 if fails or errors else 0)


asyncio.run(main())
