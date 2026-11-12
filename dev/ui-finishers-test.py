#!/usr/bin/env python3
"""Finishing moves and emotes in a real browser (docs/FINISHERS.md): python3 dev/ui-finishers-test.py [port] [outdir]

Serve the repo first: python3 -m http.server <port>. A fresh save (name set, tutorial offered, reload), then:
  title      the Emote button opens the row; a default emote plays on the operator in the yard; a locked one says why
  operators  the operator file lists the six finishers, the default equipped, locked ones refuse with their requirement
  match      Custom > Match on Railyard (TDM): every bot is held still, one is put with its back to you at arm's length;
             the Finish button shows with its name, a tap locks both (view fin on both), the lock holds the stick, the
             target dies with the kill marked fin, the feed says FINISHED; then the attacker is shot mid-move by a
             second bot and the move is cancelled
  emote      the Emote chip opens the wheel; a tap plays it on your own character (rig emote), moving ends it
Screenshots go to outdir (default /tmp/finishers). Fails on any console error.
"""
import asyncio, sys, os
from playwright.async_api import async_playwright

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8391
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/finishers'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game.app'

fails = []
def check(name, ok, info=''):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'' if ok else f' :: {info}'}", flush=True)
    if not ok: fails.append(name)

# Holds every bot still, and puts one enemy (h2's role) with its back to the local player at `d` metres, facing away.
PLACE = """((d) => {
  const app = window.__game.app, sim = app.match.sim, me = app.match.ps;
  for (const p of sim.players) if (p.bot) { p.bot.update = () => []; p.finCool = 1e9; }
  const foe = sim.players.find(p => p.team !== 0 && p.alive);
  window.__foe = foe.id;
  const ax = Math.cos(me.aim), az = Math.sin(me.aim);
  const x = me.x + ax * d, z = me.z + az * d;
  clearInterval(window.__hold);
  window.__hold = setInterval(() => { if (foe.fin || !foe.alive) return; foe.ps.x = x; foe.ps.z = z; foe.ps.aim = me.aim; foe.spawnProtect = 0; }, 30);
  return foe.id;
})"""


async def main():
    os.makedirs(OUT, exist_ok=True)
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=ARGS)
        ctx = await browser.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
        ev = pg.evaluate
        async def tap(sel, wait=300):
            try:
                await pg.locator(sel).first.click(timeout=4000)
            except Exception:     # Something animating over it (a toast, the HUD's own fade): press it the way tap.js would.
                await pg.evaluate(f"document.querySelector({sel!r})?.click()")
            await pg.wait_for_timeout(wait)
        async def shot(name):
            await pg.screenshot(path=f'{OUT}/{name}.png')

        await pg.goto(f'http://localhost:{PORT}/?debug=1&vote=2&search=600')
        await pg.wait_for_timeout(900)
        await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
        await pg.reload()
        await pg.wait_for_timeout(1500)

        print('title')
        await pg.wait_for_function('window.__game.backdrop.renderer && window.__game.backdrop.state === "live"', timeout=20000)
        await pg.wait_for_timeout(600)
        await tap('.ttl-emote')
        check('the emote row opens', await ev("!document.querySelector('.ttl-emotes').hidden"))
        n = await ev("document.querySelectorAll('.ttl-em').length")
        locked = await ev("document.querySelectorAll('.ttl-em.locked').length")
        check('eight emotes, some locked on a fresh save', n == 8 and 0 < locked < 8, (n, locked))
        await tap('.ttl-em:not(.locked)', 250)
        rig = await ev("window.__game.backdrop.renderer.chars.rigs.get('bd-hero')?.emote")
        check('the operator in the yard plays it', rig == 'wave', rig)
        await pg.wait_for_timeout(400)
        await shot('01-title-emote')
        await tap('.ttl-emote')
        await tap('.ttl-em.locked', 200)
        toast = await ev("document.querySelector('.toast')?.textContent || document.body.innerText.match(/Reach level \\d+/)?.[0] || ''")
        check('a locked emote says what earns it', 'level' in toast.lower(), toast)

        print('operators')
        await tap('[data-act="operators"]', 900)
        chips = await ev("[...document.querySelectorAll('.op-finchip')].map(c => [c.dataset.id, c.classList.contains('on'), c.classList.contains('locked')])")
        check('six finishers in the operator file', len(chips) == 6, chips)
        check('the default is equipped, the rest locked on a fresh save', chips and chips[0][1] and all(c[2] for c in chips[1:]), chips)
        await shot('02-operators')
        await tap('.op-finchip.locked', 300)
        toast = await ev("document.body.innerText")
        check('a locked finisher says what earns it', 'Reach level 8' in toast or 'level 8' in toast, '')
        await tap('[data-act="opBack"]', 700)

        print('match')
        await tap('[data-act="custom"]', 600)
        await tap('[data-act="soloMap"][data-id="railyard"]')
        await tap('[data-act="soloMode"][data-id="tdm"]')
        await tap('[data-act="soloStart"]', 300)
        await pg.wait_for_function(f'{G}.inMatch && {G}.match?.interp.newest?.phase === "live" && {G}.match.localAlive', timeout=40000)
        await pg.wait_for_timeout(500)
        foe = await ev(f"{PLACE}(1.4)")
        await pg.wait_for_function("!document.querySelector('.fin-btn').hidden", timeout=8000)
        label = await ev("document.querySelector('.fin-btn').innerText")
        check('the Finish button shows with the target', 'FINISH' in label, label)
        await shot('03-finish-button')
        await ev("(() => { window.__kills = []; window.__fins = 0; const h = window.__game.hud; const orig = h.onEvents.bind(h); h.onEvents = (es) => { for (const e of es) { if (e.t === 'kill') window.__kills.push(e); if (e.t === 'fin') window.__fins++; } orig(es); }; return 0; })()")
        await tap('.fin-btn', 250)
        locked = await ev(f"(() => {{ const v = {G}.match.interp.newest.players; return [v.find(p => p.id === 'local').fin?.role, v.find(p => p.id === window.__foe).fin?.role]; }})()")
        check('a tap locks both players in the finisher', locked == ['a', 'v'], locked)
        x0 = await ev(f"{G}.match.ps.x")
        await pg.wait_for_timeout(450)
        await shot('04-finisher-mid')
        x1 = await ev(f"{G}.match.ps.x")
        check('the attacker holds still through it', abs(x1 - x0) < 0.01, (x0, x1))
        await pg.wait_for_function("window.__kills.some(k => k.fin)", timeout=6000)
        k = await ev("window.__kills.find(k => k.fin)")
        check('the target dies, the kill marked as a finisher', k and k['by'] == 'local' and k['target'] == foe, k)
        feed = await ev("[...document.querySelectorAll('.f-fin')].length")
        check('the feed says FINISHED', feed >= 1, feed)
        await pg.wait_for_timeout(300)
        await shot('05-finished')

        # Cancel: a second enemy shoots the attacker mid-move.
        await pg.wait_for_timeout(300)
        foe2 = await ev(f"{PLACE}(1.4)")
        await pg.wait_for_function("!document.querySelector('.fin-btn').hidden", timeout=8000)
        await tap('.fin-btn', 300)
        cancelled = await ev(f"""(() => {{
          const sim = {G}.match.sim, me = sim.byId.get('local');
          const shooter = sim.players.find(p => p.team !== 0 && p.alive && p.id !== window.__foe);
          if (!me.fin || !shooter) return 'no lock or no shooter';
          sim._damage(me, shooter, 10, shooter.ps.weapon, 8);
          return me.fin ? 'still locked' : 'free';
        }})()""")
        check('shooting the attacker cancels the finisher', cancelled == 'free', cancelled)
        await pg.wait_for_timeout(400)
        still = await ev(f"{G}.match.sim.byId.get(window.__foe).alive")
        check('and the target lives', still is True, still)
        await ev("clearInterval(window.__hold)")

        print('emote')
        await tap('.em-btn', 200)
        check('the emote wheel opens', await ev("!document.querySelector('.em-wheel').hidden"))
        await shot('06-emote-wheel')
        await tap('.em-item:not(.locked)', 150)
        rig = await ev(f"{G}.renderer.chars.rigs.get('local')?.emote")
        check('the emote plays on your own character', rig == 'wave', rig)
        check('and the wheel closes', await ev("document.querySelector('.em-wheel').hidden"))
        await pg.wait_for_timeout(500)
        await shot('07-emote')
        # Moving ends it.
        await ev(f"(() => {{ const ps = {G}.match.ps; ps.vx = 4; }})()")
        await pg.wait_for_timeout(50)
        await ev(f"{G}.match.ps.vx = 4")
        await pg.wait_for_timeout(250)

        await browser.close()
    real = [e for e in errors if 'favicon' not in e]
    check('no console errors', not real, real[:5])
    print(f"\n{'FAILED: ' + ', '.join(fails) if fails else 'all passed'}")
    sys.exit(1 if fails else 0)

asyncio.run(main())
