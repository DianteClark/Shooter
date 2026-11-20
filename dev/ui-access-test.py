#!/usr/bin/env python3
"""Accessibility depth and the tutorial (roadmap 63, docs/ACCESSIBILITY.md, docs/TUTORIAL.md):
python3 dev/ui-access-test.py [port] [--shots DIR]

Serves the repo on the port (default 9742), then checks:
  screen    Options > Accessibility has the new rows (high-contrast HUD, gunfire marks, sound captions, left hand,
            controller aim and sprint), each a named switch or radio; they set Options and the root attributes
  names     every visible control on the title, Options, Accessibility, Help (every tab) and the Multiplayer screen has
            a name a screen reader can say; tabs are a tablist; icons are hidden from readers
  calm      with Reduce shake and flashes on, a transform-only pop does not play and a fade still does
  match     high contrast on the root and heavier hit marks; an enemy shot near the player draws a gunfire mark on its side
            and the caption "Gunfire, right"; an explosion is captioned; captions follow Menu text size; with both off,
            nothing (the cue layer stays hidden)
  pad       controller Aim set to Toggle: a press of LT aims in and stays in after release, the next press aims out;
            Sprint set to Hold: sprint only while L3 is held
  tips      (&tips=1) the first Domination match shows its tip once, Got it hides it, a second match shows none;
            Options > First-time tips: Show again brings it back
  tutorial  the guided match speaks touch, and with a controller in use names its buttons (Step 1's words)
Screenshots go to DIR (default /tmp/access). Fails (exit 1) on any finding or console error.
"""
import asyncio, subprocess, sys, os, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
PORT = int(args[0]) if args and args[0].isdigit() else 9742
SHOTS = args[args.index('--shots') + 1] if '--shots' in args else '/tmp/access'
GL = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game'
fails, errors = [], []
LT, L3 = 6, 10

FAKE_PAD = """(() => {
  const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true,
    mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad; window.__padOn = false;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__padOn ? pad : null, null, null, null] });
  window.__setBtn = (i, on) => { const b = pad.buttons[i]; b.pressed = on; b.touched = on; b.value = on ? 1 : 0; pad.timestamp = performance.now(); };
  window.__setAxes = a => { for (let i = 0; i < 4; i++) pad.axes[i] = a[i] ?? 0; pad.timestamp = performance.now(); };
  window.__connect = on => { window.__padOn = on; const e = new Event(on ? 'gamepadconnected' : 'gamepaddisconnected'); e.gamepad = pad; window.dispatchEvent(e); };
})()"""

UNNAMED = """(() => {
  const vis = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
  const out = [];
  for (const el of document.querySelectorAll('#ui > .menu button, #ui > .menu [data-act], #ui > .overlay button, #ui > .overlay [data-act]')) {
    if (!vis(el)) continue;
    const name = el.getAttribute('aria-label') || (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!name) out.push(el.outerHTML.slice(0, 90));
  }
  return out; })()"""


def check(cond, msg):
    if not cond: fails.append(msg)
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)


async def fresh(ctx, query=''):
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
    await pg.goto(f'http://localhost:{PORT}/?debug=1{query}')
    await pg.wait_for_function(f'!!({G} && {G}.Progress)', timeout=60000)
    await pg.evaluate(f"{G}.Progress.name='Tester'; {G}.Progress.setFlag('tutorialOffered'); {G}.Options.set('fps', false)")
    await pg.reload()
    await pg.wait_for_function(f'!!({G} && {G}.Progress)', timeout=60000)
    await pg.wait_for_timeout(1200)
    return pg


async def live(pg):
    await pg.wait_for_function(f'{G}.app.match?.interp.newest?.phase === "live"', timeout=120000)


async def unnamed(pg, where):
    await pg.wait_for_timeout(400)     # One labelling pass (a frame) after the screen paints.
    bad = await pg.evaluate(UNNAMED)
    check(not bad, f'{where}: every visible control is named {bad[:3]}')


async def main():
    os.makedirs(SHOTS, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=GL)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            await ctx.add_init_script(FAKE_PAD)
            pg = await fresh(ctx)

            print('names')
            await unnamed(pg, 'title')
            await pg.evaluate(f"{G}.openHelp('controls')")
            await pg.wait_for_timeout(500)
            check(await pg.evaluate("document.querySelector('.help-tabs').getAttribute('role') === 'tablist' && document.querySelector('.help-tabs .seg.on').getAttribute('aria-selected') === 'true'"), 'Help tabs are a tablist with the open one selected')
            for tab in await pg.evaluate("[...document.querySelectorAll('.help-tabs .seg')].map(b => b.dataset.tab)"):
                await pg.locator(f'.help-tabs [data-tab="{tab}"]').click()
                await unnamed(pg, f'Help {tab}')
            hidden_svg = await pg.evaluate("[...document.querySelectorAll('#ui > .menu svg')].every(s => s.getAttribute('aria-hidden') === 'true' || s.getAttribute('role'))")
            check(hidden_svg, 'menu icons are hidden from screen readers')
            await pg.locator('[data-act="helpBack"]').click()
            await pg.wait_for_timeout(500)
            await pg.locator('[data-act="options"]').first.click()
            await pg.wait_for_timeout(600)
            await unnamed(pg, 'Options')

            print('screen')
            await pg.locator('[data-act="optA11y"]').click()
            await pg.wait_for_timeout(600)
            await unnamed(pg, 'Accessibility')
            await pg.screenshot(path=f'{SHOTS}/a11y-screen.png')
            for act, key, attr in (('a11yHc', 'hudContrast', 'data-hc'), ('a11yShots', 'shotCues', None), ('a11yCaps', 'captions', None)):
                b = pg.locator(f'[data-act="{act}"]')
                check(await b.get_attribute('role') == 'switch' and await b.get_attribute('aria-checked') == 'false', f'{act}: a named switch, off')
                await b.click()
                on = await pg.evaluate(f"{G}.Options.get('{key}')")
                checked = await b.get_attribute('aria-checked')
                root = await pg.evaluate(f"document.documentElement.hasAttribute('{attr}')") if attr else True
                check(on is True and checked == 'true' and root, f'{act}: on sets {key} (root {attr}: {root})')
            await pg.locator('[data-act="a11yPadAim"][data-id="toggle"]').click()
            await pg.locator('[data-act="a11yPadSprint"][data-id="hold"]').click()
            v = await pg.evaluate(f"[{G}.Options.get('padAim'), {G}.Options.get('padSprint')]")
            check(v == ['toggle', 'hold'], f'controller aim and sprint set {v}')
            check(await pg.evaluate("document.querySelector('[data-act=\"a11yPadAim\"][data-id=\"toggle\"]').getAttribute('aria-checked')") == 'true', 'radio state for screen readers')

            print('calm')
            await pg.evaluate(f"{G}.Options.set('calm', true)")
            r = await pg.evaluate("""import('/js/ui/motion.js').then(m => { const el = document.createElement('div'); document.body.appendChild(el);
              const a = m.anim(el, [{ transform: 'scale(1.4)' }, { transform: 'none' }], { duration: 300 });
              const b = m.anim(el, [{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'none' }], { duration: 300 });
              const kf = b ? b.effect.getKeyframes().map(k => k.transform ?? null) : null; el.remove(); return { a: a === null, b: !!b, kf }; })""")
            check(r['a'] and r['b'] and all(k is None for k in r['kf']), f'calm: no pop, a fade without movement {r}')
            await pg.evaluate(f"{G}.Options.set('calm', false)")

            print('match')
            await pg.evaluate(f"{G}.Options.set('textSize', 'larger')")
            await pg.goto(f'http://localhost:{PORT}/?debug=1&map=railyard&mode=tdm&bots=recruit')
            await pg.wait_for_function(f'!!({G} && {G}.Progress)', timeout=60000)
            await pg.wait_for_timeout(800)
            await pg.locator('[data-act="custom"]').first.click()
            await live(pg)
            check(await pg.evaluate("document.documentElement.hasAttribute('data-hc')"), 'high-contrast HUD on the root in a match')
            sw = await pg.evaluate("(() => { const p = document.querySelector('.hit-x path'); return p ? getComputedStyle(p).strokeWidth : null; })()")
            check(sw in ('5px', '5'), f'heavier hit marks ({sw})')
            # A fake enemy shot 12 m to the right of the player, and a blast below it.
            fired = await pg.evaluate(f"""(() => {{ const g = {G}, m = g.app.match, v = m.interp.newest, me = v.players.find(p => p.id === m.localId);
              const foe = v.players.find(p => p.team !== me.team);
              g.hud.onEvents([{{ t: 'shot', by: foe.id, ox: me.x + 12, oz: me.z, aim: 0, rays: [] }}, {{ t: 'explosion', x: me.x, z: me.z + 9, radius: 4, by: foe.id }}]);
              return true; }})()""")
            await pg.wait_for_timeout(150)
            st = await pg.evaluate("""(() => { const s = [...document.querySelectorAll('.cue-shot')].find(n => +n.style.opacity > 0);
              return { shot: s ? s.style.transform : null, caps: [...document.querySelectorAll('.cue-cap')].map(c => c.textContent),
                fs: (() => { const c = document.querySelector('.cue-cap'); return c ? getComputedStyle(c).fontSize : null; })(),
                hidden: document.querySelector('.cues').hidden }; })()""")
            check(fired and st['shot'] is not None and 'rotate(90' in st['shot'], f'gunfire mark on the right ({st["shot"]})')
            check('Gunfire, right' in st['caps'] and 'Explosion, below' in st['caps'], f'captions {st["caps"]}')
            check(st['fs'] == '16px', f'captions follow Menu text size ({st["fs"]})')
            await pg.screenshot(path=f'{SHOTS}/match-captions.png')
            await pg.evaluate(f"{G}.Options.set('shotCues', false); {G}.Options.set('captions', false); {G}.Options.set('cues', 'off')")
            await pg.wait_for_timeout(200)
            st = await pg.evaluate("({ hidden: document.querySelector('.cues').hidden, caps: document.querySelectorAll('.cue-cap').length })")
            check(st['hidden'] and st['caps'] == 0, f'all off: the cue layer is hidden and empty {st}')
            await pg.evaluate(f"{G}.Options.set('cues', 'nades')")

            print('pad')
            await pg.evaluate('window.__connect(true)')
            await pg.evaluate(f'window.__setBtn({LT}, true)')
            await pg.wait_for_timeout(250)
            await pg.evaluate(f'window.__setBtn({LT}, false)')
            await pg.wait_for_timeout(350)
            a1 = await pg.evaluate(f'{G}.app.match.resolvedInput.aiming')
            await pg.evaluate(f'window.__setBtn({LT}, true)')
            await pg.wait_for_timeout(250)
            await pg.evaluate(f'window.__setBtn({LT}, false)')
            await pg.wait_for_timeout(350)
            a2 = await pg.evaluate(f'{G}.app.match.resolvedInput.aiming')
            check(a1 is True and a2 is False, f'Aim toggle: in after one press, out after the next ({a1}, {a2})')
            await pg.evaluate('window.__setAxes([1, 0, 0, 0])')
            await pg.evaluate(f'window.__setBtn({L3}, true)')
            await pg.wait_for_timeout(400)
            s1 = await pg.evaluate(f'{G}.app.match.resolvedInput.sprint')
            await pg.evaluate(f'window.__setBtn({L3}, false)')
            await pg.wait_for_timeout(400)
            s2 = await pg.evaluate(f'{G}.app.match.resolvedInput.sprint')
            check(s1 is True and s2 is False, f'Sprint hold: only while held ({s1}, {s2})')
            await pg.evaluate('window.__setAxes([0, 0, 0, 0]); window.__connect(false)')
            await pg.evaluate(f"{G}.Options.set('padAim', 'hold'); {G}.Options.set('padSprint', 'toggle'); {G}.Options.set('hudContrast', false); {G}.Options.set('textSize', 'normal')")

            print('tips')
            pg2 = await fresh(ctx, '&tips=1&map=railyard&mode=dom&bots=recruit')
            await pg2.evaluate(f"{G}.Options.set('tipsSeen', {{}})")
            await pg2.locator('[data-act="custom"]').first.click()
            await pg2.wait_for_function("!!document.querySelector('.mtip:not([hidden])')", timeout=120000)
            t = await pg2.evaluate(f"({{ title: document.querySelector('.mtip h3').textContent, seen: {G}.Options.get('tipsSeen') }})")
            check(t['title'].startswith('Domination') and t['seen'].get('dom') == 1, f'first Domination match: its tip, marked seen {t}')
            await pg2.screenshot(path=f'{SHOTS}/mode-tip.png')
            await pg2.locator('.mtip button').click()
            check(await pg2.evaluate("document.querySelector('.mtip').hidden"), 'Got it hides the tip')
            await pg2.evaluate(f"{G}.modeTips.show('dom')")
            check(await pg2.evaluate("document.querySelector('.mtip').hidden"), 'a second Domination match shows none')
            await pg2.evaluate(f"{G}.Options.set('tipsSeen', {{}})")
            check(await pg2.evaluate(f"!!{G}.modeTips.show('gwdom')"), 'after Show again, the tip comes back (Ground War Domination shares it)')
            await pg2.close()
            pg3 = await fresh(ctx)
            await pg3.evaluate(f"{G}.Options.set('tipsSeen', {{ dom: 1, kc: 1 }})")
            await pg3.locator('[data-act="options"]').first.click()
            await pg3.wait_for_timeout(500)
            await pg3.locator('[data-act="optTips"]').click()
            r = await pg3.evaluate(f"({{ seen: {G}.Options.get('tipsSeen'), b: document.querySelector('.opt-tips b').textContent }})")
            check(r['seen'] == {} and r['b'] == 'Tips reset', f'Options > First-time tips: Show again {r}')

            print('tutorial')
            await pg3.evaluate(f'{G}.tutorial()')
            await pg3.wait_for_function("(document.querySelector('.tut-card .tut-title')?.textContent || '') === 'Move'", timeout=120000)
            touch = await pg3.evaluate("document.querySelector('.tut-text').textContent")
            check('left half' in touch, f'touch words ({touch})')
            await pg3.evaluate("document.body.classList.add('pad-on')")
            await pg3.wait_for_timeout(500)
            pad = await pg3.evaluate("({ t: document.querySelector('.tut-text').textContent, hint: document.querySelector('.tut-hint').hidden })")
            check('left stick' in pad['t'] and 'LS' in pad['t'] and pad['hint'], f'controller words, no thumb hint {pad}')
            await pg3.screenshot(path=f'{SHOTS}/tutorial-pad.png')
            dots = await pg3.evaluate("document.querySelectorAll('.tut-dots i').length")
            check(dots == 8, f'eight steps with Swap ({dots})')
            await browser.close()
    finally:
        srv.terminate()
    real = [e for e in errors if 'favicon' not in e]
    check(not real, f'no console errors {real[:4]}')
    print(f"\n{'FAILED: ' + str(len(fails)) if fails else 'all ok'}  (screenshots in {SHOTS})")
    sys.exit(1 if fails else 0)

asyncio.run(main())
