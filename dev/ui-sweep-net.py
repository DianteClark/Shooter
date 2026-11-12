#!/usr/bin/env python3
"""Two-phone friend room with a host migration mid-match (ROADMAP item 37): python3 dev/ui-sweep-net.py [port] [outdir] [cases]

?net=local (BroadcastChannel tabs). The host opens a room, a guest joins and readies, the host starts; the vote's first
card is set to the case's map and mode (the host resolves the winning card). Both play a while (the guest moves and
fires), then the host's tab closes: the guest must take over as host with the match running (sim ticking, its own
player alive or respawning, the old host held), play on, and reach the results screen with XP paid and no console
errors. Cases: tdm (Railyard), zm (Graveyard Shift on Ashgrove, round state and points carried over), br (the small
test map). Screenshots go to outdir (default /tmp/sweep-net).
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8396
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/sweep-net'
ONLY = sys.argv[3:]
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
G = 'window.__game.app'
URL = f'http://localhost:{PORT}/?debug=1&net=local&vote=4'
FAKE_PAD = """(() => {
  const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true,
    mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__padOn = false;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__padOn ? pad : null, null, null, null] });
  window.__setBtn = (i, on) => { const b = pad.buttons[i]; b.pressed = on; b.touched = on; b.value = on ? 1 : 0; pad.timestamp = performance.now(); };
  window.__setAxes = (a) => { for (let i = 0; i < 4; i++) pad.axes[i] = a[i]; pad.timestamp = performance.now(); };
  window.__connect = on => { window.__padOn = on; const e = new Event(on ? 'gamepadconnected' : 'gamepaddisconnected'); e.gamepad = pad; window.dispatchEvent(e); };
})()"""
CASES = [('tdm', 'railyard', 'tdm'), ('zm', 'ashgrove', 'zm'), ('br', 'brtest', 'br')]


async def run_case(browser, name, mapId, mode, fails):
    errors = []
    check = lambda ok, msg: (print(('  ok   ' if ok else '  FAIL ') + f'{name}: {msg}', flush=True), None if ok else fails.append(f'{name}: {msg}'))
    ctx = await browser.new_context(viewport={'width': 932, 'height': 430}, has_touch=True, is_mobile=True)
    await ctx.add_init_script(FAKE_PAD)
    async def page(tag, pname):
        pg = await ctx.new_page()
        pg.on('console', lambda m: errors.append(f'{tag}: {m.text[:300]}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append(f'{tag}: PAGEERR {e}'))
        await pg.goto(URL)
        await pg.wait_for_function("!!window.__game?.Progress", timeout=30000)
        await pg.evaluate(f"window.__game.Progress.name='{pname}'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
        await pg.reload()
        await pg.wait_for_function("!!window.__game?.Progress", timeout=30000)
        await pg.wait_for_timeout(1000)
        return pg
    host = await page('host', 'Hosty')
    await host.locator('[data-act="host"]').first.click()
    await host.wait_for_function(f'{G}.code', timeout=30000)
    code = await host.evaluate(f'{G}.code')
    guest = await page('guest', 'Guesty')
    pages = [host, guest]
    async def juggle():
        while True:
            for pg in list(pages):
                try: await pg.bring_to_front()
                except Exception: pass
                await asyncio.sleep(0.15)
    juggler = asyncio.create_task(juggle())
    try:
        xp0 = await guest.evaluate("window.__game.Progress.totalXp")
        await guest.evaluate(f"window.__game.join('{code}')")
        await host.wait_for_function(f'{G}.lobby.humans.length === 2', timeout=60000)
        await guest.wait_for_selector('[data-act="toggleReady"]', timeout=20000)
        await guest.locator('[data-act="toggleReady"]').first.click()
        await host.wait_for_function(f'{G}.lobby.humans.every(h => h.ready || h.host)', timeout=20000)
        await host.wait_for_timeout(300)
        await host.locator('[data-act="start"]').first.click()
        await host.wait_for_function(f'{G}.vote?.options', timeout=20000)
        await host.evaluate(f"(() => {{ const o = {G}.vote.options; o[0] = {{ ...o[0], mapId: '{mapId}', mode: '{mode}' }}; }})()")
        for pg in pages:
            try: await pg.locator('.vote-card[data-i="0"]').click(timeout=4000)
            except Exception: pass
        await host.wait_for_function(f'{G}.inMatch && !!{G}.match?.sim', timeout=60000)
        await guest.wait_for_function(f'{G}.inMatch && !!{G}.match?.interp?.newest', timeout=60000)
        got = await host.evaluate(f"[{G}.match.mapId, {G}.match.mode]")
        check(got[1] == mode or (mode == 'br' and got[1].startswith('br')), f'match on {got}')
        for pg in pages: await pg.evaluate(f"{G}.renderer?.setQuality?.('potato')")
        await host.wait_for_function(f'{G}.match.sim.phase === "live"', timeout=60000)
        hid = await host.evaluate(f'{G}.match.localId')
        gid = await guest.evaluate(f'{G}.match.localId')
        if mode == 'br':
            await host.wait_for_function(f'{G}.match.sim.br.plane.f > 0.25', timeout=60000)
            await guest.evaluate(f"{G}.match.brCommand('jump')")
            await host.evaluate(f"{G}.match.brCommand('jump')")
            await host.wait_for_function(f"{G}.match.sim.byId.get('{gid}').brAir === 0", timeout=60000)
        if mode == 'zm':
            await host.wait_for_function(f"{G}.match.sim.rules.round >= 1", timeout=60000)
            await host.evaluate(f"(() => {{ const sim = {G}.match.sim; for (const p of sim.players) if (p.team === 0) p.spawnProtect = 99; sim.byId.get('{gid}').zm.pts = 4321; }})()")
        # The guest plays: wanders and fires through the Match's input (as the touch sticks would).
        await guest.evaluate("""(() => { window.__connect(true); let t = 0; window.__drive = setInterval(() => { t++; const a = t * 0.3;
          window.__setAxes([Math.cos(a) * 0.9, Math.sin(a) * 0.9, Math.cos(a + 1), Math.sin(a + 1)]); window.__setBtn(7, t % 3 !== 0); }, 300); })()""")
        await guest.wait_for_timeout(8000)
        before = await host.evaluate(f"""(() => {{ const sim = {G}.match.sim; return {{ tick: sim.tick, scores: sim.scores.slice(0, 2), round: sim.rules?.round ?? null,
          pts: sim.byId.get('{gid}').zm?.pts ?? null, circle: sim.br?.circle?.r ?? null }}; }})()""")
        await guest.screenshot(path=f'{OUT}/{name}-guest-before.png')
        pages.remove(host)
        await host.close()
        await guest.wait_for_function(f'{G}.isHost && {G}.match?.isHost', timeout=60000)
        after = await guest.evaluate(f"""(() => {{ const sim = {G}.match.sim; const h = sim.byId.get('{hid}');
          return {{ tick: sim.tick, scores: sim.scores.slice(0, 2), round: sim.rules?.round ?? null, pts: sim.byId.get('{gid}').zm?.pts ?? null,
            circle: sim.br?.circle?.r ?? null, away: !!h?.away, hostBot: !!h?.bot }}; }})()""")
        print(f'     before {before}\n     after  {after}', flush=True)
        check(after['away'] and not after['hostBot'], 'the old host is held, not bot-driven')
        if mode == 'zm':
            check(after['round'] == before['round'] and after['pts'] is not None and after['pts'] >= 4000, f"round and points carried over ({before['round']}/{before['pts']} -> {after['round']}/{after['pts']})")
        elif mode == 'br':
            check(after['circle'] is not None and abs(after['circle'] - before['circle']) < 10, 'circle carried over')
        else:
            check(sum(after['scores']) >= sum(before['scores']) - 1, f"scores carried over ({before['scores']} -> {after['scores']})")
        t0 = after['tick']
        await guest.wait_for_timeout(5000)
        t1 = await guest.evaluate(f'{G}.match.sim.tick')
        check(t1 > t0 + 30, f'the match runs on the new host ({t0} -> {t1})')
        await guest.screenshot(path=f'{OUT}/{name}-guest-migrated.png')
        await guest.evaluate("clearInterval(window.__drive); window.__setAxes([0,0,0,0]); window.__setBtn(7, false); window.__connect(false)")
        # End it on the new host.
        await guest.evaluate(f"""(() => {{ const m = {G}.match, sim = m.sim;
          if (m.mode === 'zm') {{ for (const p of sim.players) if (p.team === 0 && p.alive) {{ p.spawnProtect = 0; p.downed = false; sim._selfKill(p, 'bleed'); }} }}
          else sim._end(sim.byId.get(m.localId).team); }})()""")
        await guest.wait_for_function("window.__game.menu.el.dataset.screen === 'results'", timeout=90000)
        await guest.wait_for_timeout(3000)
        await guest.screenshot(path=f'{OUT}/{name}-guest-results.png')
        xp1 = await guest.evaluate("window.__game.Progress.totalXp")
        check(xp1 > xp0, f'the guest was paid ({xp0} -> {xp1})')
    except Exception as e:
        check(False, f'exception {str(e)[:300]}')
        for i, pg in enumerate(pages):
            try: await pg.screenshot(path=f'{OUT}/{name}-fail-{i}.png')
            except Exception: pass
    juggler.cancel()
    errs = [e for e in errors if 'favicon' not in e]
    check(not errs, f'no console errors {errs[:6]}')
    await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for name, mapId, mode in CASES:
                if ONLY and name not in ONLY: continue
                await run_case(browser, name, mapId, mode, fails)
            await browser.close()
    finally:
        srv.terminate()
    print('FAILED' if fails else 'all ok')
    sys.exit(1 if fails else 0)


asyncio.run(main())
