#!/usr/bin/env python3
"""Regression test: the game and every screen fill the real visible area, and the results screen fits it.

Run from anywhere: python3 dev/ui-viewport-test.py [port]. It serves the repo itself.

Part 1 simulates the iOS 26 band on a 932x430 phone: window.innerHeight, documentElement.clientHeight and
visualViewport.height report 370 while the screen and 100lvh are 430 (what the owner's recording shows: the game stops
about 60 pt above the bottom edge). In Safari mode the app must be sized to 100lvh with the 60 px kept clear of controls
(--cover-b); as a Home Screen app (navigator.standalone) to the screen with nothing kept clear; with ?vp=inner to the
old 370. Checked in a live match: canvas and #ui heights, the drawing buffer's aspect, the bottom controls clear of the
covered strip, the touch debug overlay's viewport readout. Screenshots in /tmp/viewport-*.png.

Part 2 renders the results screen (dev/ui-gallery.html) at 667x375, 844x390, 852x393, 932x430 and 956x440, for a 6v6
win (one challenge row), loss and draw, and for the tallest case, Ground War with five XP lines, three weapons, challenges and Pro challenges.
Every block must sit inside the screen's padding and inside its own card, nothing may be wider than its card, and
Rematch and Menu must be on screen. Screenshots in /tmp/results-fit-*.png.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8463
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']

# What iOS 26 reports: a short layout viewport inside a taller visible one.
BAND = """(() => { const H = 370;
  Object.defineProperty(window, 'innerHeight', { get: () => H, configurable: true });
  const d = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
  Object.defineProperty(Element.prototype, 'clientHeight', { get() { return this === document.documentElement ? H : d.get.call(this); }, configurable: true });
  if (window.VisualViewport) Object.defineProperty(VisualViewport.prototype, 'height', { get: () => H, configurable: true });
  if (window.__standalone) Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
})()"""

LIVE = """(() => { const c = document.getElementById('game'), ui = document.getElementById('ui');
  const cs = getComputedStyle(document.documentElement);
  const slide = document.querySelector('.tbtn-slide').getBoundingClientRect(), tiles = document.querySelector('.streaks').getBoundingClientRect();
  const td = document.querySelector('.touchdebug');
  return { canvas: Math.round(c.getBoundingClientRect().height), ui: Math.round(ui.getBoundingClientRect().height), body: Math.round(document.body.getBoundingClientRect().height),
    aspect: +(c.width / c.height).toFixed(3), cover: cs.getPropertyValue('--cover-b').trim(), slideBottom: Math.round(slide.bottom), tilesBottom: Math.round(tiles.bottom),
    readout: td ? td.innerText.split('\\n').filter(l => /VIEWPORT|inner|lvh|screen|safe/.test(l)).join(' | ') : '' }; })()"""

FIT = """(() => {
  const menu = document.querySelector('.menu[data-screen="results"]');
  if (!menu) return { bad: ['no results screen'] };
  const mr = menu.getBoundingClientRect();
  const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')) || 1;
  const limit = mr.bottom - parseFloat(getComputedStyle(menu).paddingBottom) * k + 0.5;
  const bad = [];
  const sel = ['.rs-top', '.rb-pair', '.rs-card', '.res-choice', '.rs-ch', '.rs-pro', '.res-choice .rs-btn', '.rs-ch-row', '.rs-pro-row',
    '.xp-head', '.xp-row', '.xp-next', '.wp', '.wp-line b', '.wp-gain', '.wp small'];
  for (const s of sel) for (const el of menu.querySelectorAll(s)) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    // Inside a card that scrolls (the progress card, the XP lines): reachable by scrolling, so not cut.
    const scroller = el.closest('.scroll-y');
    if (scroller && scroller !== el && scroller.scrollHeight > scroller.clientHeight + 1) continue;
    if (r.bottom > limit) bad.push(`${s} ends ${Math.round(r.bottom - limit)}px below the screen`);
    const box = el.parentElement?.closest('.rs-card, .res-choice, .rs-ch, .rs-pro, .xp-lines, .wp-list');
    if (!box) continue;
    const b = box.getBoundingClientRect();
    if (r.bottom > b.bottom + 0.5) bad.push(`${s} cut ${Math.round(r.bottom - b.bottom)}px by ${box.classList[0]}`);
    if (r.right > b.right + 0.5) bad.push(`${s} ${Math.round(r.right - b.right)}px wider than ${box.classList[0]}`);
  }
  const btns = [...menu.querySelectorAll('.res-choice .rs-btn')].map(b => b.getBoundingClientRect());
  if (btns.length !== 2 || btns.some(b => b.height < 44 * k - 1)) bad.push('Rematch and Menu not both full size');
  // Dead plate: the empty height under the last thing in each card, as a share of the card.
  let dead = 0;
  for (const card of menu.querySelectorAll('.rs-card:not(.finalcard):not(.scroll-y)')) {
    const c = card.getBoundingClientRect();
    let last = c.top;
    for (const el of card.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.height && r.bottom <= c.bottom + 1) last = Math.max(last, r.bottom); }
    dead = Math.max(dead, (c.bottom - last) / c.height);
  }
  if (dead > 0.12) bad.push(`a card is ${Math.round(dead * 100)}% empty at the bottom`);
  return { bad, k: +k.toFixed(3), h: Math.round(mr.height) };
})()"""

SIZES = {'se': (667, 375), 'p13': (844, 390), 'p15': (852, 393), 'p16pl': (932, 430), 'pm': (956, 440)}


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []

    def check(name, ok, info):
        print(f'  {name:<58} {"ok" if ok else "FAIL"} {info}')
        if not ok: failures.append(f'{name}: {info}')

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            print('iOS 26 band: innerHeight 370 on a 932x430 screen')
            for mode, query, want_h, want_cover in (('safari', '', 430, '60px'), ('homescreen', '', 430, '0px'), ('forced-inner', '&vp=inner', 370, '0px'), ('no-band', '', 430, '0px')):
                ctx = await browser.new_context(viewport={'width': 932, 'height': 430}, screen={'width': 932, 'height': 430}, has_touch=True, is_mobile=True)
                if mode != 'no-band':
                    await ctx.add_init_script(f'window.__standalone = {"true" if mode == "homescreen" else "false"};' + BAND)
                pg = await ctx.new_page()
                pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
                await pg.goto(f'http://localhost:{PORT}/?debug=1&touchdebug=1&map=topside&mode=tdm&bots=recruit{query}')
                await pg.wait_for_timeout(800)
                await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
                await pg.reload()
                await pg.wait_for_timeout(1200)
                title = await pg.evaluate("Math.round(document.querySelector('.menu.on').getBoundingClientRect().bottom)")
                await pg.locator('[data-act="custom"]').first.click()
                await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=40000)
                await pg.wait_for_timeout(1200)
                s = await pg.evaluate(LIVE)
                cover = int(want_cover[:-2])
                ok = (s['canvas'] == want_h and s['ui'] == want_h and s['body'] == want_h and abs(s['aspect'] - 932 / want_h) < 0.02
                      and s['cover'] == want_cover and title == want_h and s['slideBottom'] <= want_h - cover and s['tilesBottom'] <= want_h - cover)
                check(f'{mode}: game, menus and canvas {want_h} high, cover {want_cover}', ok, s)
                check(f'{mode}: overlay shows the viewport readout', 'VIEWPORT 932x' in s['readout'] and 'lvh' in s['readout'], s['readout'][:160])
                await pg.screenshot(path=f'/tmp/viewport-{mode}.png')
                await ctx.close()

            print('Results screen fits every phone')
            for scene in ('results-gw', 'results-win', 'results-loss', 'results-draw'):
                for sid, (w, h) in SIZES.items():
                    ctx = await browser.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True)
                    pg = await ctx.new_page()
                    await pg.goto(f'http://localhost:{PORT}/dev/ui-gallery.html?frame={scene}&size={sid}&wait=6500')
                    await pg.wait_for_function('window.__ready === true', timeout=60000)
                    r = await pg.evaluate(FIT)
                    errs = await pg.evaluate('window.__errors')
                    errors.extend(errs)
                    check(f'{scene} {w}x{h}', not r['bad'], r)
                    await pg.screenshot(path=f'/tmp/results-fit-{scene}-{sid}.png')
                    await ctx.close()
            await browser.close()
    finally:
        srv.terminate()
    print('console errors:', errors[:5] or 'none')
    if failures or errors:
        print('FAILED:', *failures, sep='\n  ')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
