#!/usr/bin/env python3
"""Controller support (docs/CONTROLLER.md, roadmap item 29), driven by a fake navigator.getGamepads.

Run from anywhere: python3 dev/ui-gamepad-test.py [port]. It serves the repo itself (python3 -m http.server) and checks:
  Connect     the connect toast; the first press puts the page in controller mode (body.pad-on) with a focus ring
  Remap       Options > Controller: tap an action, press a pad button, the binding swaps; Default buttons resets it
  Menus       d-pad focus walks the title to Custom, A opens it, the ring walks to Start, A starts a solo match
  Match       on-screen sticks hidden; left stick moves the player; right stick aims; RT fires; X reloads a part-empty
              magazine; Start opens the pause board with the ring on it, B closes it; Select peeks the board while held;
              d-pad up pings; d-pad down opens quick chat, the ring picks a callout, A sends it
  Touch       a touch on the glass leaves controller mode and the sticks come back; disconnect toast in the match feed
"""
import asyncio, subprocess, sys, time, os, math
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8336))
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
failures, errors = [], []


def check(name, ok, info=''):
    print(f'  {name:<58} {"ok" if ok else "FAIL"} {info}')
    if not ok: failures.append(f'{name}: {info}')


# A standard-mapping Xbox pad whose state the test writes into window.__pad.
FAKE_PAD = """(() => {
  const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true,
    mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad;
  window.__padOn = false;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__padOn ? pad : null, null, null, null] });
  window.__setBtn = (i, on, v) => { const b = pad.buttons[i]; b.pressed = on; b.touched = on; b.value = v ?? (on ? 1 : 0); pad.timestamp = performance.now(); };
  window.__setAxes = (a) => { for (let i = 0; i < 4; i++) if (a[i] !== undefined && a[i] !== null) pad.axes[i] = a[i]; pad.timestamp = performance.now(); };
  window.__connect = on => { window.__padOn = on; const e = new Event(on ? 'gamepadconnected' : 'gamepaddisconnected'); e.gamepad = pad; window.dispatchEvent(e); };
})()"""

A, B, X, Y, LB, RB, LT, RT, SELECT, START, L3, R3, UP, DOWN, LEFT, RIGHT = range(16)
STATE = """(() => { const g = window.__game, m = g.app.match, ps = m?.ps;
  const f = document.querySelector('.pad-focus');
  return { screen: g.menu.el.dataset.screen, inMatch: !!g.app.inMatch, padOn: document.body.classList.contains('pad-on'),
    focus: f ? (f.dataset.act || f.className) : null, x: ps?.x, z: ps?.z, aim: ps?.aim, ammo: ps ? ps.ammo[ps.slot] : null,
    reloadT: ps?.reloadT, board: !!g.hud.boardOpen, phase: m?.interp.newest?.phase,
    stickOpacity: getComputedStyle(document.querySelector('.controls .tbtn-swap')).opacity }; })()"""


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            await ctx.add_init_script(FAKE_PAD)
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
            await pg.goto(f'http://localhost:{PORT}/?debug=1&net=local')
            await pg.wait_for_timeout(900)
            await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
            await pg.reload()
            await pg.wait_for_timeout(1300)
            state = lambda: pg.evaluate(STATE)

            async def press(i, hold=90, after=140):
                await pg.evaluate(f'window.__setBtn({i}, true)')
                await pg.wait_for_timeout(hold)
                await pg.evaluate(f'window.__setBtn({i}, false)')
                await pg.wait_for_timeout(after)

            async def axes(a, ms=0):
                await pg.evaluate(f'window.__setAxes({a})')
                if ms: await pg.wait_for_timeout(ms)

            # Walks the focus ring to the element matching sel with the d-pad, steering by the rects.
            async def walk_to(sel, tries=16):
                for _ in range(tries):
                    d = await pg.evaluate(f"""(() => {{ const f = document.querySelector('.pad-focus'), t = document.querySelector('{sel}');
                      if (!f || !t) return null; if (f === t) return 'here';
                      const a = f.getBoundingClientRect(), b = t.getBoundingClientRect();
                      const dx = (b.left + b.right - a.left - a.right) / 2, dy = (b.top + b.bottom - a.top - a.bottom) / 2;
                      return Math.abs(dy) > Math.max(12, Math.abs(dx) * 0.5) ? (dy > 0 ? 'down' : 'up') : (dx > 0 ? 'right' : 'left'); }})()""")
                    if d in (None, 'here'): return d == 'here'
                    await press({'up': UP, 'down': DOWN, 'left': LEFT, 'right': RIGHT}[d], 70, 120)
                return await pg.evaluate(f"document.querySelector('.pad-focus') === document.querySelector('{sel}')")

            print('Connect')
            await pg.evaluate('window.__connect(true)')
            await pg.wait_for_timeout(200)
            toast = await pg.evaluate("document.querySelector('.toast').textContent")
            check('connect toast names the controller', 'Xbox controller connected' in toast, toast)
            s = await state()
            check('not in controller mode before a press', not s['padOn'], s)
            await press(DOWN, 70, 200)
            s = await state()
            check('a press enters controller mode with a focus ring', s['padOn'] and s['focus'] is not None, s)

            print('Remap')
            await pg.locator('[data-act="options"]').first.tap()
            await pg.wait_for_timeout(500)
            await pg.locator('[data-act="optPad"]').first.tap()
            await pg.wait_for_timeout(500)
            check('Options > Controller opens', (await state())['screen'] == 'controller')
            await pg.locator('.pad-bind[data-id="reload"]').tap()
            await pg.wait_for_timeout(150)
            listening = await pg.evaluate("document.querySelector('.pad-bind[data-id=\"reload\"] .pad-key').textContent")
            check('a tapped action waits for a button', listening == 'Press a button', listening)
            await press(Y, 80, 250)
            maps = await pg.evaluate("(() => { const o = window.__game.Options.get('padMap'); return { o, reload: document.querySelector('.pad-bind[data-id=\"reload\"] .pad-key').textContent, swap: document.querySelector('.pad-bind[data-id=\"swap\"] .pad-key').textContent }; })()")
            check('Y now reloads and swap takes X (saved)', maps['o'].get('reload') == Y and maps['o'].get('swap') == X and maps['reload'] == 'Y' and maps['swap'] == 'X', maps)
            await pg.locator('[data-act="padReset"]').tap()
            await pg.wait_for_timeout(200)
            check('Default buttons clears the map', await pg.evaluate("Object.keys(window.__game.Options.get('padMap')).length === 0"))
            # B backs out of Controller, then Options, to the title.
            await press(B, 80, 450)
            check('B goes back to Options', (await state())['screen'] == 'options', (await state())['screen'])
            await press(B, 80, 600)
            check('B goes back to the title', (await state())['screen'] == 'title', (await state())['screen'])

            print('Menus')
            await pg.evaluate("window.__game.Options.set('aimAssist', 0)")
            ok = await walk_to('[data-act="custom"]')
            check('d-pad walks the ring to Custom', ok, (await state())['focus'])
            await press(A, 80, 700)
            s = await state()
            check('A opens Custom', s['screen'] in ('solo', 'custom'), s['screen'])
            ok = await walk_to('[data-act="soloStart"]')
            check('d-pad walks the ring to Start', ok, (await state())['focus'])
            await press(A, 80, 300)
            await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=45000)
            await pg.wait_for_timeout(400)
            s = await state()
            check('A starts a solo match', s['inMatch'] and s['phase'] == 'live', s)
            check('on-screen sticks hidden while the pad is in use', s['stickOpacity'] == '0', s['stickOpacity'])

            print('Match')
            x0, z0 = s['x'], s['z']
            await axes([1, 0], 500)
            mx = await pg.evaluate('window.__game.app.match.resolvedInput.mx')
            await axes([0, 0], 150)
            s = await state()
            moved = math.hypot(s['x'] - x0, s['z'] - z0)
            check('left stick moves the player', mx > 0.95 and moved > 0.3 and s['x'] > x0, f'mx {mx:.2f}, {moved:.2f} m')
            # The facing turns at the gun's turn rate while aiming, so give it a moment on a slow software renderer.
            near = lambda want: f"(() => {{ const a = window.__game.app.match.ps.aim - ({want}); return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.2; }})()"
            await axes([0, 0, 0, -1])
            try: await pg.wait_for_function(near(-math.pi / 2), timeout=2500)
            except Exception: pass
            s = await state()
            check('right stick up aims up the screen', abs(math.atan2(math.sin(s['aim'] + math.pi / 2), math.cos(s['aim'] + math.pi / 2))) < 0.25, f"{s['aim']:.2f}")
            await axes([0, 0, -1, 0])
            try: await pg.wait_for_function(near(math.pi), timeout=2500)
            except Exception: pass
            s = await state()
            check('right stick left aims left', abs(math.atan2(math.sin(s['aim'] - math.pi), math.cos(s['aim'] - math.pi))) < 0.25, f"{s['aim']:.2f}")
            ammo0 = s['ammo']
            await pg.evaluate(f'window.__setBtn({RT}, true, 1)')
            await pg.wait_for_timeout(450)
            await pg.evaluate(f'window.__setBtn({RT}, false)')
            await axes([0, 0, 0, 0], 120)
            s = await state()
            check('RT fires', s['ammo'] < ammo0, f"{ammo0} -> {s['ammo']}")
            check('no reload yet after a short burst', s['reloadT'] <= 0 or s['ammo'] == 0, s['reloadT'])
            await press(X, 80, 120)
            s = await state()
            check('X reloads a part-empty magazine', s['reloadT'] > 0, s['reloadT'])

            await press(START, 80, 250)
            s = await state()
            focus_in_board = await pg.evaluate("!!document.querySelector('.hud .board .pad-focus')")
            check('Start opens the pause board with the ring on it', s['board'] and focus_in_board, s)
            x1 = s['x']
            await axes([1, 0], 300)
            await axes([0, 0], 100)
            s = await state()
            check('the stick moves the ring, not the player, while paused', abs(s['x'] - x1) < 0.05, f"{s['x'] - x1:.3f}")
            await press(B, 80, 200)
            check('B closes the pause board', not (await state())['board'])
            await pg.evaluate(f'window.__setBtn({SELECT}, true)')
            await pg.wait_for_timeout(200)
            peek = (await state())['board']
            await pg.evaluate(f'window.__setBtn({SELECT}, false)')
            await pg.wait_for_timeout(200)
            check('Select shows the board only while held', peek and not (await state())['board'])

            feedText = "document.querySelector('.hud .feed')?.textContent ?? ''"
            await press(UP, 80, 300)
            check('D-pad up pings (Enemy spotted)', 'Enemy spotted' in await pg.evaluate(feedText))
            await pg.wait_for_timeout(1200)
            await press(DOWN, 80, 250)
            wheel = await pg.evaluate("(() => { const w = document.querySelector('.qc-wheel'); return { open: !w.hidden, ring: !!w.querySelector('.pad-focus') }; })()")
            check('D-pad down opens quick chat with the ring on it', wheel['open'] and wheel['ring'], wheel)
            await press(RIGHT, 70, 150)
            said = await pg.evaluate("document.querySelector('.qc-wheel .pad-focus b')?.textContent")
            await press(A, 80, 300)
            closed = await pg.evaluate("document.querySelector('.qc-wheel').hidden")
            check('A sends the focused callout and closes the wheel', closed and said and said in await pg.evaluate(feedText), said)

            print('Touch')
            await pg.touchscreen.tap(420, 200)
            await pg.wait_for_timeout(400)
            s = await state()
            for _ in range(10):      # The buttons fade back in (a short opacity transition; frames are slow here).
                if s['stickOpacity'] != '0': break
                await pg.wait_for_timeout(150)
                s = await state()
            check('a touch leaves controller mode, sticks come back', not s['padOn'] and s['stickOpacity'] != '0', s)
            await pg.evaluate('window.__connect(false)')
            await pg.wait_for_timeout(300)
            feed = await pg.evaluate("document.querySelector('.hud .feed')?.textContent ?? ''")
            check('disconnect toast in the match feed', 'disconnected' in feed, feed[-80:])
            await browser.close()
    finally:
        srv.kill()
    bad = [e for e in errors if 'favicon' not in e]
    check('no console errors', not bad, bad[:3])
    print(f'\n{len(failures)} failure(s)')
    sys.exit(1 if failures else 0)


asyncio.run(main())
