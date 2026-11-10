#!/usr/bin/env python3
"""Regression test: throwing must never drop the move thumb.

Run from anywhere: python3 dev/ui-touch-test.py [port]. It serves the repo itself, starts a solo match and checks the
move stick after every sequence.

Part 1 drives Chrome's real touch pipeline (CDP Input.dispatchTouchEvent): left thumb held and moving, right thumb
holding the aim stick, a third finger on Tactical or Lethal (hold-drag-release, quick tap), the right thumb itself
doing the throw, and a stray finger landing next to the move stick.

Part 2 replays the ways iOS Safari's own touch stream goes out of step, which Chrome never produces, as synthetic
TouchEvents: a touchstart that iOS swallows because another finger lifted in the same instant (WebKit drops it; the
finger then reports only moves), a touchstart whose `touches` list leaves out the move thumb, and a touchcancel for
fingers that then keep sending moves. The move stick must recover on the very next move each time.

Part 3 (V7) covers what else on iOS can take a thumb away: a system gesture that swallows every finger without a single
touchcancel or touchend (the thumb comes back as a new touch and must get the stick at once, and a stick nobody reports
any more must stop walking), a touch target removed from the page under a held finger (WebKit then sends that finger's
events to the detached node only), a thumb that landed on a HUD tap target that has since been hidden (the respawn
picker), a focused text field left over from a menu, and the touch debug overlay itself.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8461
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']

# Synthetic touch events, built the way WebKit fills them in.
SYNTH = """
window.__synth = (type, changed, touches, sel) => {
  const target = sel === 'tgt' ? window.__tgt : document.querySelector(sel || '.controls');
  const mk = ([id, x, y]) => new Touch({ identifier: id, target, clientX: x, clientY: y, pageX: x, pageY: y });
  const ev = new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, changedTouches: changed.map(mk), touches: touches.map(mk), targetTouches: touches.map(mk) });
  target.dispatchEvent(ev);
};
window.__stick = () => { const c = window.__game.controls; const r = c.read(); return { id: c.left.id, mx: +r.mx.toFixed(2), mz: +r.mz.toFixed(2), right: c.right.id }; };
"""


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for vw, vh in ((844, 390), (956, 440)):
                ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
                pg = await ctx.new_page()
                pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
                await pg.goto(f'http://localhost:{PORT}/?debug=1&map=topside&mode=tdm&bots=recruit&touchdebug=1')
                await pg.wait_for_timeout(800)
                await pg.evaluate("window.__game.Progress.name='Tester'")
                # The first-run training offer would cover the title; it is shown once, so a reload clears it.
                await pg.evaluate("window.__game.Progress.setFlag('tutorialOffered')")
                await pg.reload()
                await pg.wait_for_timeout(1200)
                await pg.locator('[data-act="solo"]').first.click()
                await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=30000)
                await pg.evaluate(SYNTH)
                # The test reads the stick itself; the match loop must not eat the edges or the state between checks.
                await pg.evaluate("window.__game.app.match.running = false")
                rects = await pg.evaluate('JSON.parse(JSON.stringify(window.__game.controls.rects))')
                ctr = lambda r: ((r['x0'] + r['x1']) / 2, (r['y0'] + r['y1']) / 2)
                tac, leth = ctr(rects['tactical']), ctr(rects['lethal'])
                LX, LY = vw * 0.18, vh * 0.65
                RX, RY = vw * 0.66, vh * 0.62
                cdp = await ctx.new_cdp_session(pg)

                async def cdp_touch(kind, pts):
                    await cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in pts.items()]})

                async def stick():
                    return await pg.evaluate('window.__stick()')

                def check(name, s, moving=True):
                    ok = (s['id'] is not None and abs(s['mx']) > 0.5) if moving else s['id'] is None
                    print(f'  {vw}x{vh} {name:<46} {"ok" if ok else "FAIL"} {s}')
                    if not ok: failures.append(f'{vw}x{vh} {name}: {s}')

                async def real(name, third, drag, hold_steps, aim_thumb_throws=False):
                    pts = {1: (LX, LY)}
                    await cdp_touch('touchStart', pts)
                    for k in range(4):
                        pts[1] = (LX + 14 * (k + 1), LY); await cdp_touch('touchMove', pts)
                    if not aim_thumb_throws:
                        pts[2] = (RX, RY); await cdp_touch('touchStart', pts)
                    pts[3] = third; await cdp_touch('touchStart', pts)
                    for k in range(hold_steps):
                        pts[1] = (LX + 56 + (k % 4) * 3, LY + (k % 3))
                        if 2 in pts: pts[2] = (RX + k % 5, RY)
                        if drag: pts[3] = (third[0] + drag[0] * (k + 1) / hold_steps, third[1] + drag[1] * (k + 1) / hold_steps)
                        await cdp_touch('touchMove', pts)
                        await pg.wait_for_timeout(12)
                    await cdp_touch('touchEnd', {3: pts.pop(3)})
                    s1 = await stick()
                    for k in range(4):
                        pts[1] = (LX + 60 + k * 2, LY); await cdp_touch('touchMove', pts)
                    s2 = await stick()
                    check(name + ' (at release)', s1)
                    check(name + ' (after)', s2)
                    await cdp_touch('touchEnd', {})
                    check(name + ' (all lifted)', await stick(), moving=False)

                print('Real touch sequences')
                await real('hold-drag-release Tactical', tac, (-110, -30), 14)
                await real('hold-drag-release Lethal', leth, (-80, 60), 20)
                await real('hold Tactical, no drag', tac, None, 16)
                await real('quick tap Lethal', leth, None, 1)
                await real('aim thumb does the throw', tac, (-90, 20), 10, aim_thumb_throws=True)
                await real('stray finger beside the move stick', (LX + 70, LY - 40), (10, 5), 6)

                print('iOS stream anomalies')
                S = lambda kind, ch, all_: pg.evaluate('([k,c,t]) => window.__synth(k,c,t)', [kind, ch, all_])
                L = [11, LX, LY]
                R = [12, RX, RY]
                T = [13, tac[0], tac[1]]

                # 1. The throw finger lands and iOS leaves the move thumb out of `touches`.
                await S('touchstart', [L], [L]); await S('touchmove', [[11, LX + 60, LY]], [[11, LX + 60, LY]])
                await S('touchstart', [R], [[11, LX + 60, LY], R])
                await S('touchstart', [T], [R, T])
                await S('touchmove', [[11, LX + 64, LY]], [[11, LX + 64, LY], R, T])
                check('touches list missing the move thumb', await stick())
                await S('touchend', [T], [[11, LX + 64, LY], R])
                check('  ... then the throw released', await stick())
                await S('touchend', [[11, LX + 64, LY], R], [])
                check('  ... all lifted', await stick(), moving=False)

                # 2. The thumb re-plants as the throw finger lifts; iOS swallows that touchstart and sends only moves.
                await S('touchstart', [L], [L]); await S('touchmove', [[11, LX + 60, LY]], [[11, LX + 60, LY]])
                await S('touchstart', [T], [[11, LX + 60, LY], T])
                await S('touchend', [[11, LX + 60, LY]], [T])                 # Thumb lifts for a moment...
                await S('touchend', [T], [])                                  # ...the throw goes...
                N = lambda x: [21, x, LY]                                      # ...and the new touchstart never arrives.
                for k in range(5): await S('touchmove', [N(LX + 8 + k * 14)], [N(LX + 8 + k * 14)])
                check('swallowed touchstart of the re-planted thumb', await stick())
                await S('touchend', [N(LX + 64)], [])
                check('  ... lifted', await stick(), moving=False)

                # 3. A touchcancel for the throw finger alone leaves the sticks alone.
                await S('touchstart', [L], [L]); await S('touchmove', [[11, LX + 60, LY]], [[11, LX + 60, LY]])
                await S('touchstart', [T], [[11, LX + 60, LY], T])
                await S('touchcancel', [T], [[11, LX + 60, LY]])
                check('touchcancel of the throw finger only', await stick())

                # 4. iOS cancels every finger, then the move thumb keeps reporting: it is still there.
                await S('touchstart', [T], [[11, LX + 60, LY], T])
                await S('touchcancel', [[11, LX + 60, LY], T], [])
                await S('touchmove', [[11, LX + 66, LY]], [[11, LX + 66, LY]])
                check('move thumb reporting after a touchcancel', await stick())
                await S('touchend', [[11, LX + 66, LY]], [])
                check('  ... lifted', await stick(), moving=False)

                # 6. Quick tap with a perfectly still move thumb: iOS sends the tap with a stale list missing the thumb,
                #    and a still thumb sends no moves that could win the stick back. The stick must just stay.
                for still_list_end in (False, True):
                    await S('touchstart', [L], [L]); await S('touchmove', [[11, LX + 60, LY]], [[11, LX + 60, LY]])
                    await S('touchstart', [T], [T])
                    await S('touchend', [T], [] if still_list_end else [[11, LX + 60, LY]])
                    check('quick tap, still thumb, stale list' + (' x2' if still_list_end else ''), await stick())
                    await S('touchend', [[11, LX + 60, LY]], [])
                    check('  ... lifted', await stick(), moving=False)

                # 5. A finger that starts on a button and whose start was swallowed never becomes a stick.
                await S('touchmove', [[31, tac[0], tac[1]]], [[31, tac[0], tac[1]]])
                s = await pg.evaluate('(() => { const c = window.__game.controls; return { left: c.left.id, right: c.right.id }; })()')
                ok = s['left'] is None and s['right'] is None
                print(f'  {vw}x{vh} {"orphan on a button stays a button":<46} {"ok" if ok else "FAIL"} {s}')
                if not ok: failures.append(f'{vw}x{vh} orphan on a button: {s}')
                await S('touchend', [[31, tac[0], tac[1]]], [])

                print('V7: swallowed fingers, removed targets, hidden HUD taps, focus, overlay')
                S4 = lambda kind, ch, all_, sel: pg.evaluate('([k,c,t,s]) => window.__synth(k,c,t,s)', [kind, ch, all_, sel])
                # 7. A system gesture swallows all three fingers: no touchcancel, no touchend, ever. The thumb lifts and lands
                #    again as a new touch; it must take the move stick at once, not be parked as a spare.
                await S('touchstart', [L], [L]); await S('touchmove', [[11, LX + 60, LY]], [[11, LX + 60, LY]])
                await S('touchstart', [R], [[11, LX + 60, LY], R])
                await S('touchstart', [T], [[11, LX + 60, LY], R, T])
                await pg.wait_for_timeout(200)
                await S('touchstart', [[41, LX, LY]], [[41, LX, LY]])
                await S('touchmove', [[41, LX + 62, LY]], [[41, LX + 62, LY]])
                s = await stick(); check('thumb back after a swallowed gesture', s)
                if s['id'] != 41: failures.append(f'{vw}x{vh} swallowed gesture: stick not on the new thumb {s}')
                await S('touchend', [[41, LX + 62, LY]], [])
                check('  ... lifted', await stick(), moving=False)

                # 8. A stick whose finger no list names any more stops walking, while the other thumb keeps reporting.
                await S('touchstart', [L], [L]); await S('touchmove', [[11, LX + 60, LY]], [[11, LX + 60, LY]])
                await S('touchstart', [R], [[11, LX + 60, LY], R])
                await pg.wait_for_timeout(300)
                for k in range(3): await S('touchmove', [[12, RX + k, RY]], [[12, RX + k, RY]])
                check('unreported move thumb is let go', await stick(), moving=False)
                await S('touchend', [[12, RX, RY]], [])

                # 9. The element under the move thumb is removed mid-press. WebKit keeps sending that finger's events to
                #    the detached node; they never reach window, so the controls listen on the node itself.
                await pg.evaluate("""(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;width:50%;height:100%';
                  document.querySelector('.controls').appendChild(d); window.__tgt = d; })()""")
                await S4('touchstart', [L], [L], 'tgt')
                await pg.evaluate('window.__tgt.remove()')
                for k in range(4): await S4('touchmove', [[11, LX + 20 + k * 14, LY]], [[11, LX + 20 + k * 14, LY]], 'tgt')
                check('target removed under the move thumb', await stick())
                await S4('touchend', [[11, LX + 62, LY]], [], 'tgt')
                check('  ... lifted on the detached node', await stick(), moving=False)

                # 10. iOS's way when it removes a target: touchcancel to every finger, which then keep moving.
                await S('touchstart', [L], [L]); await S('touchmove', [[11, LX + 60, LY]], [[11, LX + 60, LY]])
                await S('touchstart', [R], [[11, LX + 60, LY], R]); await S('touchstart', [T], [[11, LX + 60, LY], R, T])
                await S('touchcancel', [[11, LX + 60, LY], R, T], [])
                await S('touchmove', [[11, LX + 64, LY], [12, RX + 3, RY]], [[11, LX + 64, LY], [12, RX + 3, RY]])
                s = await stick(); check('touchcancel to all three, thumbs keep moving', s)
                if s['right'] != 12: failures.append(f'{vw}x{vh} aim stick not recovered after cancel-all: {s}')
                await S('touchend', [[11, LX + 64, LY], [12, RX + 3, RY]], [])
                check('  ... lifted', await stick(), moving=False)

                # 11. A thumb that landed on a HUD tap target (the respawn picker) which has since been hidden plays on.
                await pg.evaluate("""(() => { const b = document.createElement('button'); b.dataset.tap = '1';
                  b.style.cssText = 'position:fixed;left:0;bottom:0;width:40%;height:80px;z-index:50';
                  document.body.appendChild(b); window.__tgt = b; })()""")
                await S4('touchstart', [L], [L], 'tgt')
                s = await stick(); ok = s['id'] is None
                print(f'  {vw}x{vh} {"visible HUD tap target is left alone":<46} {"ok" if ok else "FAIL"} {s}')
                if not ok: failures.append(f'{vw}x{vh} HUD tap grabbed the stick: {s}')
                await pg.evaluate("window.__tgt.style.display = 'none'")
                for k in range(4): await S4('touchmove', [[11, LX + 20 + k * 14, LY]], [[11, LX + 20 + k * 14, LY]], 'tgt')
                check('thumb on a hidden HUD tap target plays on', await stick())
                await S4('touchend', [[11, LX + 62, LY]], [], 'tgt')
                await pg.evaluate('window.__tgt.remove()')

                # 12. A text field focused in a menu is let go of by the first touch of play.
                await pg.evaluate("""(() => { const t = document.createElement('textarea'); t.style.cssText = 'position:fixed;left:-50px;top:0;width:10px;height:10px';
                  document.body.appendChild(t); t.focus(); window.__tgt = t; })()""")
                await S('touchstart', [L], [L])
                focus = await pg.evaluate('document.activeElement === document.body || document.activeElement === null')
                print(f'  {vw}x{vh} {"focused field blurred by play":<46} {"ok" if focus else "FAIL"}')
                if not focus: failures.append(f'{vw}x{vh} focus kept')
                await S('touchend', [L], [])
                await pg.evaluate('window.__tgt.remove()')

                # 13. The overlay: up, never a touch target, naming fingers and owners and logging events.
                await S('touchstart', [L], [L]); await S('touchmove', [[11, LX + 60, LY]], [[11, LX + 60, LY]])
                await S('touchstart', [T], [[11, LX + 60, LY], T])
                await pg.wait_for_timeout(250)
                ov = await pg.evaluate("""(() => { const el = document.querySelector('.touchdebug'); if (!el) return null;
                  return { pe: getComputedStyle(el).pointerEvents, text: el.innerText, shown: !el.hidden }; })()""")
                ok = bool(ov) and ov['pe'] == 'none' and ov['shown'] and '#11' in ov['text'] and ' L ' in ov['text'] and 'throw:' in ov['text'] and 'start' in ov['text']
                print(f'  {vw}x{vh} {"touch debug overlay":<46} {"ok" if ok else "FAIL"}')
                if not ok: failures.append(f'{vw}x{vh} overlay: {ov}')
                await pg.screenshot(path=f'/tmp/touchdebug-{vw}x{vh}.png')
                await S('touchend', [T], [[11, LX + 60, LY]]); await S('touchend', [[11, LX + 60, LY]], [])
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
