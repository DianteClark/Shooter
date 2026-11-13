#!/usr/bin/env python3
"""Scorestreak camera and piloting check (roadmap 40).

Run: python3 dev/ui-streak-cam-test.py [port]. Starts a solo match, then calls every scorestreak as the local player
and records how far the camera's target strays from the player over the next 2.5 s while the player walks. Only the
piloted streaks (Cruise Missile, Recon Drone, Carpet Line) may move the camera off the player; every other streak,
Wingman included, must leave it on the player. For the Recon Drone it also checks that a push of the aim stick moves the
drone on the first host ticks after the call, while sprinting, with no ADS in between.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8476
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
PILOTED = {'missile', 'recon', 'bombrun'}

CALL = """(kind) => { const g = window.__game, m = g.app.match, sim = m.sim, p = sim.byId.get(m.localId);
  if (!p?.alive) return 'dead';
  sim.gunships.length = 0; sim.turrets.length = 0;
  sim.streakDenied = () => null;      // Limits and airspace are not under test: the last streak may still be up.
  p.score.slots = [{ kind, cost: 1, held: true, blocked: false }]; p.score.capped = false;
  const r = sim.useStreak(m.localId, 0); return r ?? 'refused'; }"""

# The camera target against where it would be on the player (clamped to the map's dressed area, as the renderer does).
SAMPLE = """() => { const m = window.__game.app.match, r = m.renderer, ps = m.ps, W = m.map.width, H = m.map.height;
  const px = Math.max(10, Math.min(W - 10, ps.x)), pz = Math.max(2, Math.min(H - 2, ps.z));
  return { dx: +(r.camTarget.x - px).toFixed(2), dz: +(r.camTarget.z - pz).toFixed(2), x: ps.x, z: ps.z }; }"""


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors, table = [], [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 932, 'height': 430}, has_touch=True, is_mobile=True)
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
            await pg.goto(f'http://localhost:{PORT}/?debug=1&map=topside&mode=tdm&bots=recruit')
            await pg.wait_for_timeout(800)
            await pg.evaluate("window.__game.Progress.name='Tester'")
            await pg.evaluate("window.__game.Progress.setFlag('tutorialOffered')")
            await pg.reload()
            await pg.wait_for_timeout(1200)
            await pg.locator('[data-act="custom"]').first.click(no_wait_after=True)
            await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=90000)
            # Bots hold still and the local player cannot die, so every streak gets a clean run.
            await pg.evaluate("""(() => { const m = window.__game.app.match, sim = m.sim;
              const me = sim.byId.get(m.localId); const dmg = sim._damage.bind(sim);
              sim._damage = (v, ...a) => v === me ? undefined : dmg(v, ...a); })()""")
            kinds = await pg.evaluate("import('/js/shared/catalog.js').then(c => Object.keys(c.STREAKS))")
            for kind in kinds:
                # Walk in a slow circle with the move stick so "following the player" means something.
                await pg.evaluate("""(() => { const c = window.__game.controls;
                  const read = c.__read ??= c.read.bind(c);
                  c.read = () => { const i = read(); const t = performance.now() / 900; i.mx = Math.cos(t) * 0.6; i.mz = Math.sin(t) * 0.6; return i; }; })()""")
                res = await pg.evaluate(f'({CALL})({json.dumps(kind)})')
                worst = 0.0
                for _ in range(10):
                    await pg.wait_for_timeout(250)
                    s = await pg.evaluate(f'({SAMPLE})()')
                    worst = max(worst, (s['dx'] ** 2 + s['dz'] ** 2) ** 0.5)
                follows = worst < 3.5
                steered = kind in PILOTED
                ok = res not in ('refused', 'dead') and (steered or follows)
                table.append((kind, res, round(worst, 1), 'moves to the streak' if not follows else 'stays on player'))
                print(f'  {kind:<11} called={res!s:<10} max cam offset {worst:5.1f} m  {"steered" if steered else "not steered"}  {"ok" if ok else "FAIL"}')
                if not ok: failures.append(f'{kind}: {res} offset {worst:.1f}')
                await pg.evaluate("(() => { const m = window.__game.app.match; m.sim.gunships.length = 0; m.sim.turrets.length = 0; m.sim.strikes.length = 0; })()")
                await pg.wait_for_timeout(700)

            # Recon Drone: the aim stick flies it at once, sprinting, no ADS.
            await pg.evaluate("""(() => { const c = window.__game.controls;
              c.read = () => { const i = c.__read(); i.mx = 1; i.mz = 0; i.sprint = true; i.aiming = true; i.aim = Math.PI / 2; return i; }; })()""")
            await pg.wait_for_timeout(300)
            await pg.evaluate(f'({CALL})("recon")')
            start = await pg.evaluate("(() => { const g = window.__game.app.match.sim.gunships.find(g => g.kind === 'recon'); return g && { x: g.x, z: g.z, t: window.__game.app.match.sim.time }; })()")
            await pg.wait_for_timeout(250)
            after = await pg.evaluate("(() => { const m = window.__game.app.match, g = m.sim.gunships.find(g => g.kind === 'recon'); return g && { x: g.x, z: g.z, t: m.sim.time, ads: m.ps.adsT, sprint: m.ps.sprinting }; })()")
            # Judged on the host's own clock: full speed (10 m/s) straight away, give or take the first tick.
            dt = after and start and after['t'] - start['t']
            moved = bool(dt) and (after['z'] - start['z']) >= 8 * dt - 0.2
            print(f'  recon flies on the first push (sprinting, ads {after and after["ads"]:.2f}): moved {after and round(after["z"] - start["z"], 2)} m in {dt and round(dt, 2)} s  {"ok" if moved else "FAIL"}')
            if not moved: failures.append(f'recon slow to respond: {start} -> {after}')
            await pg.evaluate("(() => { const c = window.__game.controls; c.read = c.__read; })()")
            await browser.close()
    finally:
        srv.terminate()
    print('console errors:', errors[:5] or 'none')
    if failures or errors:
        print('FAILED:', *failures, sep='\n  ')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
