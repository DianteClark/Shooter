#!/usr/bin/env python3
"""Graveyard Shift end to end in a real browser (docs/ZOMBIES.md): python3 dev/ui-zombies-test.py [port] [outdir]

Serves the repo, opens Multiplayer, the Zombies tab, Solo with bots, Find match, rides the search and the vote into a
match on one of the mode's maps, plays round 1 (the horde is put down on the host so software rendering does not
take minutes, after the first zombies have risen and walked), checks the round counter moves on, then walks (teleports)
the local player to a wall-buy and taps the use button with the points for it, checks the phone's own gun changed,
buys a perk and opens a gate the same way, and finally lets the crew fall and checks the Overrun results screen.
Screenshots at 852x393 and 667x375 go to outdir (default /tmp/zombies). Fails on any console error, and on HUD panels
that spill off the screen.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8371
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/zombies'
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

# The use button must sit between the sticks: clear of the left third and the right third of the screen.
CLEAR_OF_STICKS = """(() => {
  const n = document.querySelector('.zm-use'); if (!n || n.hidden) return 'hidden';
  const r = n.getBoundingClientRect(), W = innerWidth;
  return r.left > W * 0.25 && r.right < W * 0.75 ? '' : `${Math.round(r.left)}..${Math.round(r.right)} of ${W}`;
})()"""


async def check_fit(pg, sels, tag, failures):
    bad = await pg.evaluate(f"{OVERFLOW}({sels!r})")
    for b in bad: failures.append(f'{tag}: off screen: {b}')


async def run(browser, vw, vh, failures, errors):
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'{vw}: PAGEERR {e} {getattr(e, "stack", "")}'))
    async def shot(name):
        print(f'  {vw}x{vh} {name}', flush=True)
        await pg.screenshot(path=f'{OUT}/{name}-{vw}x{vh}.png')
    ev = lambda js: pg.evaluate(js)
    tag = f'{vw}x{vh}'
    await pg.goto(f'http://localhost:{PORT}/?debug=1&vote=2&search=600')
    await pg.wait_for_timeout(900)
    await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="multiplayer"]').first.click()
    await pg.wait_for_timeout(600)
    await pg.locator('[data-act="mpTab"][data-tab="zombies"]').first.click()
    await pg.wait_for_timeout(500)
    await pg.locator('[data-act="mpPlaylist"][data-id="zmsolo"]').first.click()
    await pg.wait_for_timeout(300)
    await shot('01-multiplayer')
    await check_fit(pg, ['.mp-pl', '.mp-find', '.mp-tabs'], f'{tag} multiplayer', failures)
    await pg.locator('[data-act="mpFind"]').first.click()
    await pg.wait_for_timeout(1300)
    await shot('02-vote')
    await pg.wait_for_function(f'{G}.match?.interp.newest?.obj?.zm || {G}.match?.interp.newest?.points?.obj?.zm', timeout=40000)
    mode = await ev(f'{G}.match.mode')
    if mode != 'zm': failures.append(f'{tag}: match mode {mode}')
    mapId = await ev(f'{G}.match.mapId')
    if mapId not in ('neon', 'ruins', 'foundry'): failures.append(f'{tag}: zombies on {mapId}')
    await pg.wait_for_function(f'{G}.match.interp.newest.phase === "live"', timeout=30000)
    # Nobody on the crew dies by accident while the test drives (spawn protection holds the claws off).
    await ev(f"""(() => {{ const sim = {G}.match.sim; window.__shield = setInterval(() => {{ for (const p of sim.players) if (p.team === 0) p.spawnProtect = 99; }}, 200); }})()""")
    gun0 = await ev(f'{G}.match.ps.primary + "/" + {G}.match.ps.secondary')
    if gun0 != 'pistol/knife': failures.append(f'{tag}: started with {gun0}, not the pistol and the blade')
    # Round 1: wait for it to start and the first zombies to rise and walk.
    await pg.wait_for_function(f"{G}.match.sim.rules.round === 1 && {G}.match.sim.rules.horde.some(p => p.alive)", timeout=60000)
    await pg.wait_for_timeout(2500)
    await shot('03-round1')
    await check_fit(pg, ['.zm-top', '.zm-crew', '.minimap'], f'{tag} hud', failures)
    rnd = await ev("document.querySelector('.zm-round b').textContent")
    if rnd.strip() != '1': failures.append(f'{tag}: round plate says {rnd!r}')
    # The bots thin them out fast: any moment with one up in the view will do.
    try: await pg.wait_for_function(f"{G}.match.interp.newest.players.some(p => p.zk > 0 && p.alive)", timeout=30000, polling=50)
    except Exception: failures.append(f'{tag}: no zombies in the view')
    # The rest of round 1, put down on the host (their kills pay whoever is closest).
    await ev(f"""(() => {{ const sim = {G}.match.sim, R = sim.rules, me = sim.byId.get({G}.match.localId);
      window.__cull = setInterval(() => {{ for (const z of R.horde) if (z.alive) sim._damage(z, me, 99999, 'pistol', 5); }}, 300); }})()""")
    await pg.wait_for_function(f"{G}.match.sim.rules.round >= 2 || {G}.match.sim.rules.state === 2", timeout=90000)
    await ev('clearInterval(window.__cull)')
    await pg.wait_for_timeout(800)
    await shot('04-round-survived')
    st = await ev(f"{G}.match.sim.rules.state")
    if st not in (1, 2): failures.append(f'{tag}: state after round 1 is {st}')
    # A wall-buy in the start band: points, walk there, tap Buy.
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, me = m.sim.byId.get(m.localId);
      me.zm.pts = 20000;
      const w = R.L.wallBuys.find(x => x.band === R.L.start); window.__wb = w.gun;
      m.ps.x = w.x; m.ps.z = w.z; m.ps.vx = 0; m.ps.vz = 0; }})()""")
    await pg.wait_for_selector('.zm-use:not([hidden]):not(.poor)', timeout=10000)
    await pg.wait_for_timeout(400)
    await shot('05-wallbuy')
    where = await ev(CLEAR_OF_STICKS)
    if where: failures.append(f'{tag}: use button not clear of the sticks: {where}')
    await check_fit(pg, ['.zm-use', '.zm-top'], f'{tag} prompt', failures)
    label = await ev("document.querySelector('.zm-use .t').textContent")
    if not label.startswith('BUY'): failures.append(f'{tag}: prompt at a wall-buy says {label!r}')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"[{G}.match.ps.primary, {G}.match.ps.secondary].includes(window.__wb)", timeout=6000)
    except Exception: failures.append(f'{tag}: buying at the wall did not arm the gun')
    await pg.wait_for_timeout(500)
    await shot('06-bought')
    # A perk machine and a gate.
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules; const mc = R.L.machines.find(x => x.band === R.L.start) ?? R.L.machines[0];
      if (R.L.machines[0] && mc.band !== R.L.start) for (const d of R.L.doors) R.open |= 1 << d.i;
      window.__perk = mc.perk; m.ps.x = mc.x; m.ps.z = mc.z; }})()""")
    await pg.wait_for_selector('.zm-use:not([hidden]):not(.poor)', timeout=10000)
    await pg.wait_for_timeout(300)
    await shot('07-perk')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"{G}.match.sim.rules.crew.find(p => p.id === {G}.match.localId).zm.perks.includes(window.__perk)", timeout=6000)
    except Exception: failures.append(f'{tag}: the perk machine did nothing')
    await pg.wait_for_timeout(400)
    await shot('08-perked')
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules; R.open = 0; const d = R.L.doors[0];
      m.ps.x = d.cx + (d.from < d.opens ? -1.2 : 1.2); m.ps.z = d.cz; }})()""")
    await pg.wait_for_function(f"document.querySelector('.zm-use:not([hidden]) .t')?.textContent === 'OPEN GATE'", timeout=10000)
    await shot('09-gate')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"({G}.match.sim.rules.open & 1) === 1", timeout=6000)
    except Exception: failures.append(f'{tag}: the gate did not open')
    await pg.wait_for_timeout(1500)
    await shot('10-gate-open')
    # The end: the shield comes off and everyone falls.
    await ev(f"""(() => {{ clearInterval(window.__shield); const sim = {G}.match.sim; for (const p of sim.players) if (p.team === 0 && p.alive) {{ p.spawnProtect = 0; p.downed = false; sim._selfKill(p, 'bleed'); }} }})()""")
    await pg.wait_for_selector('.menu[data-screen="results"] .rs', timeout=90000)
    await pg.wait_for_timeout(2500)
    for _ in range(10):
        if not await pg.evaluate(f"{OVERFLOW}(['.rs-top'])"): break
        await pg.wait_for_timeout(700)
    await shot('11-results')
    word = await ev("document.querySelector('.rs-word h2')?.textContent")
    if word != 'Overrun': failures.append(f'{tag}: results say {word!r}')
    xp = await ev("[...document.querySelectorAll('.xp-row span')].map(n => n.textContent)")
    if not any('survived' in (x or '') for x in xp): failures.append(f'{tag}: no Rounds survived XP line: {xp}')
    best = await ev(f"window.__game.Progress.zmBest({mapId!r})")
    if not best: failures.append(f'{tag}: no high-round record saved for {mapId}')
    await check_fit(pg, ['.rs-top', '.rb-pair', '.rs-cards'], f'{tag} results', failures)
    await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=ARGS)
            sizes = [(852, 393), (667, 375)]
            if os.environ.get('ZM_SIZE'): sizes = [tuple(int(v) for v in os.environ['ZM_SIZE'].split('x'))]
            for vw, vh in sizes:
                try: await run(browser, vw, vh, failures, errors)
                except Exception as e: failures.append(f'{vw}x{vh}: {type(e).__name__}: {e}')
            await browser.close()
    finally:
        server.terminate()
    for e in errors: print('console error:', e)
    for f in failures: print('FAIL', f)
    print(f'screenshots in {OUT}')
    print('ok' if not failures and not errors else f'{len(failures)} failures, {len(errors)} console errors')
    sys.exit(1 if failures or errors else 0)


asyncio.run(main())
