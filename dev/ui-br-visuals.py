#!/usr/bin/env python3
"""Battle royale visuals, staged: python3 dev/ui-br-visuals.py [port] [outdir]

On the small test map (brtest) at 852x393, 667x375 and 640x360 (BRV_SIZE=WxH for one): the transport with its riders,
a squadmate downed and crawling, the local player picking them up (kneel pose, revive bars over both, the reviving bar on
the HUD), a squadmate gliding under a canopy, the zoomed minimap with the circle, boxing gloves throwing punches, and a
Recall Beacon being held (beam, ring, the Recalling bar). Full screenshots plus 2x crops of the middle of the screen go to outdir.
Fails on any console error.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8314
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/br-visuals'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game.app'


async def run(browser, vw, vh, failures, errors):
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True, device_scale_factor=2)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'{vw}: PAGEERR {e}'))
    ev = lambda js: pg.evaluate(js)
    shot = lambda name: pg.screenshot(path=f'{OUT}/{name}-{vw}x{vh}.png')
    crop = lambda name: pg.screenshot(path=f'{OUT}/{name}-crop-{vw}x{vh}.png', clip={'x': vw * 0.3, 'y': vh * 0.18, 'width': vw * 0.4, 'height': vh * 0.6})
    await pg.goto(f'http://localhost:{PORT}/?debug=1&brtest')
    await pg.wait_for_timeout(900)
    await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_timeout(700)
    await pg.locator('[data-act="soloMap"][data-id="brtest"]').first.click()
    await pg.wait_for_timeout(300)
    await pg.locator('[data-act="soloMode"][data-id="br"]').first.click()
    await pg.locator('[data-act="soloStart"]').first.click()
    await pg.wait_for_function(f'{G}.match?.interp.newest?.br', timeout=30000)
    await pg.wait_for_function(f'{G}.match.interp.newest.phase === "live" && {G}.match.interp.newest.br.plane.f > 0.15', timeout=40000)
    # A squadmate jumps first: its canopy, seen from the transport.
    await ev(f"(() => {{ const b = {G}.match.hud.brHud; b.c.mapDismissed = true; b.toggleMap(false); }})()")
    await pg.wait_for_timeout(500)
    # Still aboard: the riders on the transport's roof, seen from aboard.
    await shot('29-transport')
    await crop('29-transport')
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId);
      for (const q of sim.players) if (q.team === me.team && q !== me && q.brAir === 1) {{ sim.br._jump(q); q.br.glideT = 30; }} }})()""")
    await ev(f"{G}.match.brCommand('jump')")
    await pg.wait_for_function(f'{G}.match.brAir === 0', timeout=20000)
    # A squadmate still under its canopy, gliding in next to us.
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId);
      const q = sim.players.find(p => p.team === me.team && p !== me && p.alive); q.brAir = 2; q.br.glideT = 4; q.br.follow = null;
      q.ps.x = m.ps.x - 6; q.ps.z = m.ps.z - 2; q.br.dropX = m.ps.x + 6; q.br.dropZ = m.ps.z - 2; }})()""")
    await pg.wait_for_timeout(700)
    await shot('30-canopies')
    await crop('30-canopies')
    await pg.wait_for_timeout(500)
    # Stage: everyone else far off and shielded, the squad around the local player in the open.
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId), nav = sim.nav;
      const k = nav.nearestFree(sim.map.width / 2, sim.map.height / 2); m.ps.x = k % nav.w + 0.5; m.ps.z = Math.floor(k / nav.w) + 0.5;
      for (const p of sim.players) {{
        p.spawnProtect = 999;
        if (p.team !== me.team) {{ p.ps.x = 4; p.ps.z = 4; if (p.brAir) {{ p.brAir = 0; }} }}
        else if (p !== me) {{ p.brAir = 0; p.br.glideT = 0; p.ps.x = m.ps.x + 3; p.ps.z = m.ps.z + 3; }}
      }}
      window.__mate = sim.players.find(p => p.team === me.team && p !== me && p.alive).id; }})()""")
    await pg.wait_for_timeout(900)
    # The rest of the squad is out, so the squadmate who goes down right next to us and we pick them up.
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId), q = sim.byId.get(window.__mate), foe = sim.players.find(p => p.team !== me.team);
      q.ps.x = m.ps.x + 1.6; q.ps.z = m.ps.z + 0.4;
      for (const p of sim.players) if (p.team === me.team && p !== me && p !== q) {{ p.spawnProtect = 0; p.br.armor = 0; sim._damage(p, foe, 999, 'ar', 10); sim._damage(p, foe, 999, 'ar', 10); }}
      q.spawnProtect = 0; q.br.armor = 0; sim._damage(q, foe, 999, 'ar', 10); }})()""")
    await pg.wait_for_timeout(1300)
    downed = await ev(f"{G}.match.interp.newest.players.find(p => p.id === window.__mate).downed")
    if not downed: failures.append(f'{vw}: the squadmate did not go down')
    await shot('31-crawl')
    await crop('31-crawl')
    # Stand next to them: the revive runs, bars over both, our kneel.
    try:
        await pg.wait_for_function(f"({G}.match.interp.newest.players.find(p => p.id === window.__mate).reviveK ?? 0) > 0.45", timeout=15000)
        if await pg.locator('.br-reviving').is_hidden(): failures.append(f'{vw}: no reviving bar on the HUD')
        await shot('32-revive')
        await crop('32-revive')
    except Exception:
        failures.append(f'{vw}: the revive never started')
    mm = await pg.locator('.minimap').bounding_box()
    await pg.screenshot(path=f'{OUT}/33-minimap-{vw}x{vh}.png', clip=mm)
    # Boxing gloves: fists out, a few punches thrown (the rig's swing, as a melee shot event drives it).
    await ev(f"{G}.match.brSlot(2)")
    await pg.wait_for_timeout(500)
    await ev(f"(() => {{ const r = {G}.renderer, id = {G}.match.localId; window.__punch = setInterval(() => r.chars.onShot(id, 0.3, 'knife'), 420); }})()")
    await pg.wait_for_timeout(300)
    await crop('34-gloves-guard')
    await pg.wait_for_timeout(330)
    await crop('34-gloves-punch')
    await ev('clearInterval(window.__punch)')
    if await ev(f"{G}.renderer.chars.glove.count") < 2: failures.append(f'{vw}: no gloves drawn with fists out')
    # A Recall Beacon held: the squadmate falls, we take the tag to the nearest beacon and hold it.
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId), foe = sim.players.find(p => p.team !== me.team);
      const q = sim.byId.get(window.__mate); if (q.alive) {{ q.spawnProtect = 0; q.br.armor = 0; q.downed = false; sim._damage(q, foe, 999, 'ar', 10); sim._damage(q, foe, 999, 'ar', 10); }}
      const tag = sim.br.items.find(it => it && it.kind === 8 && it.v === q.index); if (tag) {{ m.ps.x = tag.x; m.ps.z = tag.z; }} }})()""")
    await pg.wait_for_timeout(900)
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim; let bc = null, bd = 1e9;
      for (const b of sim.br.beacons) {{ const d = Math.hypot(b.x - m.ps.x, b.z - m.ps.z); if (!b.used && d < bd) {{ bd = d; bc = b; }} }}
      for (const p of sim.players) if (p.team !== sim.byId.get(m.localId).team && Math.hypot(p.ps.x - bc.x, p.ps.z - bc.z) < 60) {{ p.ps.x = 4; p.ps.z = 4; }}
      m.ps.x = bc.x + 1.2; m.ps.z = bc.z + 0.6; window.__bc = bc.id; }})()""")
    await pg.wait_for_timeout(800)
    await ev(f"{G}.match.brCommand('recall', {{ b: window.__bc }})")
    await pg.wait_for_timeout(2500)
    if await pg.locator('.br-recalling').is_hidden(): failures.append(f'{vw}: no Recalling bar at the beacon')
    await shot('35-beacon-held')
    await crop('35-beacon-held')
    await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            sizes = ((852, 393), (667, 375), (640, 360))
            if os.environ.get('BRV_SIZE'): sizes = [tuple(int(v) for v in os.environ['BRV_SIZE'].split('x'))]
            for vw, vh in sizes:
                await run(browser, vw, vh, failures, errors)
            await browser.close()
    finally:
        srv.terminate()
    errors = [e for e in errors if 'GL Driver' not in e and 'GPU stall' not in e]
    for e in errors[:20]: print('ERROR', e)
    for f in failures: print('FAIL', f)
    print('ok' if not failures and not errors else f'{len(failures)} failures, {len(errors)} console errors')
    sys.exit(1 if failures or errors else 0)

asyncio.run(main())
