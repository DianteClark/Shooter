#!/usr/bin/env python3
"""Rebound and Showdown in a real browser (ROADMAP 27 and 31): python3 dev/ui-modes2-test.py [port] [outdir]

Serves the repo (python3 -m http.server <port>), starts from a fresh save (the tutorial offer flagged, then a reload).
Rebound: Multiplayer, Battle Royale tab, Rebound Quads, Find match, the vote, the drop; jump, land, the redeploy note
under the circle clock; the local player is killed on the host while the squad is up: the out panel counts the redeploy
down, the player parachutes back in with a gun, lands; then every other squad is finished off and the results say
Victory. Showdown: Multiplayer, Standard tab, Showdown 2v2, Find match on a small map; the round plate, everyone on the
same kit, enemy health tags over their heads; a round lost (the local pair killed on the host) shows the watch plate;
the match is ended on the host and the results come up. Screenshots go to outdir (default /tmp/modes2). Fails on any
console error, and on HUD panels that spill off the screen. MODES2_SIZE=852x393 runs one size for both.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8377
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/modes2'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game.app'

OVERFLOW = """((sels) => {
  const W = innerWidth, H = innerHeight, bad = [];
  for (const s of sels) for (const n of document.querySelectorAll(s)) {
    if (n.hidden || n.closest('[hidden]') || getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden') continue;
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) bad.push(`${s} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.right)}x${Math.round(r.bottom)}`);
  }
  return bad;
})"""


async def check_fit(pg, sels, tag, failures):
    for b in await pg.evaluate(f"{OVERFLOW}({sels!r})"): failures.append(f'{tag}: off screen: {b}')


async def fresh(browser, vw, vh, errors):
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'{vw}: PAGEERR {e} {getattr(e, "stack", "")}'))
    await pg.goto(f'http://localhost:{PORT}/?debug=1&vote=2&search=600')
    await pg.wait_for_timeout(900)
    await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    return ctx, pg


async def pick(pg, tab, playlist):
    await pg.locator('[data-act="multiplayer"]').first.click()
    await pg.wait_for_timeout(600)
    await pg.locator(f'[data-act="mpTab"][data-tab="{tab}"]').first.click()
    await pg.wait_for_timeout(500)
    await pg.locator(f'[data-act="mpPlaylist"][data-id="{playlist}"]').first.click()
    await pg.wait_for_timeout(300)


async def rebound(browser, vw, vh, failures, errors):
    tag = f'rebound {vw}x{vh}'
    ctx, pg = await fresh(browser, vw, vh, errors)
    ev = lambda js: pg.evaluate(js)
    async def shot(name):
        print(f'  {tag} {name}', flush=True)
        await pg.screenshot(path=f'{OUT}/rb-{name}-{vw}x{vh}.png')
    await pick(pg, 'br', 'rbquads')
    await shot('01-multiplayer')
    await check_fit(pg, ['.mp-pl', '.mp-find', '.mp-tabs'], f'{tag} multiplayer', failures)
    names = await ev("[...document.querySelectorAll('[data-act=\"mpPlaylist\"]')].map(n => n.dataset.id).join()")
    if 'rbquads' not in names or 'rbduos' not in names: failures.append(f'{tag}: Rebound playlists missing ({names})')
    await pg.locator('[data-act="mpFind"]').first.click()
    await pg.wait_for_function(f'{G}.match?.interp.newest?.br', timeout=60000)
    mode = await ev(f'{G}.match.mode')
    if mode != 'rb': failures.append(f'{tag}: match mode {mode}')
    n = await ev(f'{G}.match.sim.players.length')
    if n != 24: failures.append(f'{tag}: {n} players')
    await pg.wait_for_function(f'{G}.match.interp.newest.phase === "live" && {G}.match.interp.newest.br.plane.f > 0.35', timeout=40000)
    await shot('02-flight')
    await pg.locator('.br-jump-map').click()
    await pg.wait_for_function(f'{G}.match.brAir === 0', timeout=40000)
    await pg.wait_for_timeout(800)
    await shot('03-landed')
    note = await ev("document.querySelector('.br-rd')?.hidden ? '' : document.querySelector('.br-rd')?.textContent")
    if 'circle 5' not in (note or ''): failures.append(f'{tag}: redeploy note says {note!r}')
    await check_fit(pg, ['.br-top', '.br-rd', '.br-squad', '.minimap'], f'{tag} hud', failures)
    # Killed while the squad is up (they are kept safe on the host while the test waits).
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId);
      window.__shield = setInterval(() => {{ for (const p of sim.players) if (p.team === me.team && p !== me && p.alive) {{ p.hp = 100; p.downed = false; }} }}, 100);
      sim.br._die(me, null, null, 'test'); }})()""")
    try:
        await pg.wait_for_function("document.querySelector('.br-out:not([hidden]) b')?.textContent.startsWith('Redeploying')", timeout=8000)
    except Exception: failures.append(f'{tag}: the out panel shows no redeploy countdown')
    await pg.wait_for_timeout(1500)
    await shot('04-redeploying')
    await check_fit(pg, ['.br-out', '.br-rd'], f'{tag} out', failures)
    try:
        await pg.wait_for_function(f'{G}.match.localAlive && {G}.match.brAir === 2', timeout=40000)
        await pg.wait_for_timeout(1200)
        await shot('05-redeploy-glide')
        gun = await ev(f'{G}.match.ps.primary')
        if gun in ('knife', None): failures.append(f'{tag}: redeployed without a gun ({gun})')
        await pg.wait_for_function(f'{G}.match.brAir === 0', timeout=20000)
    except Exception as e: failures.append(f'{tag}: no redeploy: {e}')
    await ev('clearInterval(window.__shield)')
    await pg.wait_for_timeout(600)
    await shot('06-back')
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId);
      for (let k = 0; k < 3; k++) for (const p of sim.players) if (p.team !== me.team && p.alive) {{ p.brAir = 0; p.br.redeployT = 0; sim._damage(p, me, 999, me.ps.weapon, 10); }} }})()""")
    await pg.wait_for_selector('.rs', timeout=30000)
    await pg.wait_for_timeout(2500)
    skip = pg.locator('[data-act="resSkip"]:not([hidden])')
    if await skip.count(): await skip.first.click()
    await pg.wait_for_timeout(2000)
    await shot('07-results')
    word = await ev("document.querySelector('.rs-word h2')?.textContent")
    if word != 'Victory': failures.append(f'{tag}: results say {word!r}')
    await ctx.close()


async def showdown(browser, vw, vh, failures, errors):
    tag = f'showdown {vw}x{vh}'
    ctx, pg = await fresh(browser, vw, vh, errors)
    ev = lambda js: pg.evaluate(js)
    async def shot(name):
        print(f'  {tag} {name}', flush=True)
        await pg.screenshot(path=f'{OUT}/gf-{name}-{vw}x{vh}.png')
    await pick(pg, 'standard', 'showdown')
    await shot('01-multiplayer')
    await pg.locator('[data-act="mpFind"]').first.click()
    await pg.wait_for_function(f'{G}.match?.interp.newest?.obj?.kind === "gf" || {G}.match?.interp.newest?.points?.obj?.kind === "gf"', timeout=60000)
    mode, mapId, n = await ev(f'[{G}.match.mode, {G}.match.mapId, {G}.match.sim.players.length]')
    if mode != 'gf': failures.append(f'{tag}: match mode {mode}')
    if mapId not in ('pier', 'turnstile', 'oasis', 'ruins'): failures.append(f'{tag}: on {mapId}, not a small map')
    if n != 4: failures.append(f'{tag}: {n} players')
    await pg.wait_for_timeout(1500)
    await shot('02-freeze')
    await pg.wait_for_function(f'{G}.match.interp.newest.phase === "live"', timeout=30000)
    await pg.wait_for_timeout(800)
    plate = await ev("document.querySelector('.mh-status:not([hidden]) b')?.textContent")
    if not plate or ' v ' not in plate.lower(): failures.append(f'{tag}: status plate says {plate!r}')
    # Everyone on the same kit, the phone's own player included.
    kits = await ev(f"(() => {{ const m = {G}.match; return [m.ps.primary, ...m.sim.players.filter(p => p.isBot).map(p => p.ps.primary)]; }})()")
    if len(set(kits)) != 1: failures.append(f'{tag}: kits differ: {kits}')
    # Keep the bots from finishing the round while the tags are checked: nobody shoots for a moment.
    await ev(f"(() => {{ const sim = {G}.match.sim; window.__hold = setInterval(() => {{ for (const p of sim.players) p.spawnProtect = 99; }}, 100); }})()")
    await ev(f"(() => {{ const sim = {G}.match.sim, me = sim.byId.get({G}.match.localId); let k = 0; for (const p of sim.players) if (p.team !== me.team) {{ p.hp = 55; p.ps.x = me.ps.x + 5; p.ps.z = me.ps.z + (k++ ? 2 : -2); }} }})()")
    try: await pg.wait_for_function("[...document.querySelectorAll('.mh-tag.enemy')].some(n => !n.hidden && n.querySelector('.mh-hp'))", timeout=8000)
    except Exception: failures.append(f'{tag}: no enemy health over their heads')
    await pg.wait_for_timeout(500)
    await shot('03-live')
    await check_fit(pg, ['.mh-status', '.minimap'], f'{tag} hud', failures)
    await ev('clearInterval(window.__hold)')
    # The local pair falls: a lost round, the watch plate, then the next round.
    await ev(f"""(() => {{ const sim = {G}.match.sim, me = sim.byId.get({G}.match.localId);
      for (const p of sim.players) p.spawnProtect = 0;
      const foe = sim.players.find(p => p.team !== me.team);
      sim._damage(me, foe, 999, foe.ps.weapon, 10); }})()""")
    await pg.wait_for_timeout(700)
    await shot('04-dead')
    wait = await ev("document.querySelector('.mh-wait:not([hidden]) b')?.textContent")
    if not wait: failures.append(f'{tag}: no wait plate on the death screen')
    await ev(f"""(() => {{ const sim = {G}.match.sim, me = sim.byId.get({G}.match.localId), foe = sim.players.find(p => p.team !== me.team);
      for (const p of sim.players) if (p.team === me.team && p.alive) sim._damage(p, foe, 999, foe.ps.weapon, 10); }})()""")
    try: await pg.wait_for_function(f'({G}.match.sim.rules.round >= 2)', timeout=20000)
    except Exception: failures.append(f'{tag}: no second round')
    await pg.wait_for_timeout(1200)
    await shot('05-round2')
    # The end, on the host: the other side reaches 6.
    await ev(f"""(() => {{ const sim = {G}.match.sim, me = sim.byId.get({G}.match.localId); sim.scores[1 - me.team] = 5;
      const foe = sim.players.find(p => p.team !== me.team); for (const p of sim.players) {{ p.spawnProtect = 0; if (p.team === me.team && p.alive) sim._damage(p, foe, 999, foe.ps.weapon, 10); }} }})()""")
    try:
        await pg.wait_for_function(f'{G}.match.sim.rules.state === "live" || {G}.match.sim.phase === "ended"', timeout=20000)
        await ev(f"""(() => {{ const sim = {G}.match.sim, me = sim.byId.get({G}.match.localId), foe = sim.players.find(p => p.team !== me.team);
          for (const p of sim.players) {{ p.spawnProtect = 0; if (p.team === me.team && p.alive) sim._damage(p, foe, 999, foe.ps.weapon, 10); }} }})()""")
    except Exception: pass
    await pg.wait_for_selector('.rs', timeout=40000)
    await pg.wait_for_timeout(2500)
    skip = pg.locator('[data-act="resSkip"]:not([hidden])')
    if await skip.count(): await skip.first.click()
    await pg.wait_for_timeout(2000)
    await shot('06-results')
    word = await ev("document.querySelector('.rs-word h2')?.textContent")
    if word != 'Defeat': failures.append(f'{tag}: results say {word!r}')
    await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    plan = [(rebound, 852, 393), (showdown, 667, 375)]
    if os.environ.get('MODES2_SIZE'):
        w, h = (int(v) for v in os.environ['MODES2_SIZE'].split('x'))
        plan = [(rebound, w, h), (showdown, w, h)]
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=ARGS)
            for fn, vw, vh in plan:
                try: await fn(browser, vw, vh, failures, errors)
                except Exception as e: failures.append(f'{fn.__name__} {vw}x{vh}: {type(e).__name__}: {e}')
            await browser.close()
    finally:
        server.terminate()
    for e in errors: print('console error:', e)
    for f in failures: print('FAIL', f)
    print(f'screenshots in {OUT}')
    print('ok' if not failures and not errors else f'{len(failures)} failures, {len(errors)} console errors')
    sys.exit(1 if failures or errors else 0)


asyncio.run(main())
