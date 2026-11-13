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
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8643
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
            await pg.wait_for_function("(() => { const m = window.__game.app.match; return m.sim.time > %s + 0.5; })()" % start['t'], timeout=20000)
            after = await pg.evaluate("(() => { const m = window.__game.app.match, g = m.sim.gunships.find(g => g.kind === 'recon'); return g && { x: g.x, z: g.z, t: m.sim.time, ads: m.ps.adsT, sprint: m.ps.sprinting }; })()")
            # Judged on the host's own clock: at most a quarter second to turn round (14 rad/s), then full speed (10 m/s).
            dt = after and start and after['t'] - start['t']
            moved = bool(dt) and (after['z'] - start['z']) >= 8 * (dt - 0.25)
            print(f'  recon flies on the first push (sprinting, ads {after and after["ads"]:.2f}): moved {after and round(after["z"] - start["z"], 2)} m in {dt and round(dt, 2)} s  {"ok" if moved else "FAIL"}')
            if not moved: failures.append(f'recon slow to respond: {start} -> {after}')
            await pg.evaluate("(() => { const c = window.__game.controls; c.read = c.__read; })()")

            print('Shooting streaks down')
            def check(name, ok, info=''):
                print(f'  {name:<60} {"ok" if ok else "FAIL"} {info}')
                if not ok: failures.append(f'{name}: {info}')
            await pg.evaluate("""(() => { const m = window.__game.app.match, sim = m.sim; sim.gunships.length = 0;
              window.__game.Progress.flag('shootHint_hound') && delete window.__game.Progress.data?.flags?.shootHint_hound;
              const me = sim.byId.get(m.localId), foe = sim.players.find(q => q.team !== me.team && q.alive);
              foe.ps.x = me.ps.x + 4; foe.ps.z = me.ps.z; window.__foe = foe.id;
              foe.score.slots = [{ kind: 'hound', cost: 1, held: true, blocked: false }]; sim.streakDenied = () => null; sim.useStreak(foe.id, 0);
              const g = sim.gunships.find(g => g.kind === 'hound'); g.x = me.ps.x + 3; g.z = me.ps.z; window.__hound = g; })()""")
            await pg.wait_for_timeout(1500)
            tag = await pg.evaluate("""(() => { const t = document.querySelector('.stag.on'); return t && { name: t.querySelector('.sg-name b').textContent, hits: t.querySelector('.sg-name small').textContent,
              bar: t.querySelector('.sg-bar i').style.transform, tf: t.style.transform }; })()""")
            await pg.screenshot(path='/tmp/streak-tag.png')
            check('enemy Wingman close by is tagged (ring, bar, name, hits)', bool(tag) and tag.get('tf', '').startswith('translate3d') and tag['name'] == 'Wingman' and 'hit' in tag['hits'], tag)
            call = await pg.evaluate("document.querySelector('.callout')?.textContent ?? ''")
            check('first sight: "shoot it down" callout', 'shoot it down' in call.lower(), call)
            await pg.evaluate("""import('/js/sim/streaks-v9.js').then(V9 => { const m = window.__game.app.match, sim = m.sim; V9.hurtAir(sim, window.__hound, 120, sim.byId.get(m.localId)); })""")
            await pg.wait_for_timeout(400)
            s2 = await pg.evaluate("""(() => { const t = document.querySelector('.stag.on'), h = window.__game.hud;
              return { bar: t?.querySelector('.sg-bar i').style.transform, marker: h.hitT > 0 || h.juice?.hits > 0, hits: h.juice?.hits }; })()""")
            check('a hit lands a hit marker and drops the bar', s2['marker'] and s2['bar'] and s2['bar'] != (tag or {}).get('bar'), s2)
            medals0 = await pg.evaluate("window.__game.app.match.awards.medals.shootdown ?? 0")
            await pg.evaluate("""import('/js/sim/streaks-v9.js').then(V9 => { const m = window.__game.app.match, sim = m.sim; V9.hurtAir(sim, window.__hound, 999, sim.byId.get(m.localId)); })""")
            await pg.wait_for_timeout(500)
            s3 = await pg.evaluate("""(() => { const h = window.__game.hud, m = window.__game.app.match;
              return { kills: h.juice?.kills, feed: document.querySelector('.feed')?.textContent ?? '', medal: m.awards.medals.shootdown ?? 0 }; })()""")
            check('bringing it down: feed line and Shot Down medal', 'shot down' in s3['feed'] and s3['medal'] > medals0, s3)
            await pg.evaluate("window.__game.app.match.running = false")
            await pg.evaluate("window.__game.app.leaveNow?.() ?? window.__game.app.match.stop()")
            # How to play, Streaks tab, drawn on a scratch menu element.
            text = await pg.evaluate("""import('/js/ui/help.js').then(h => { const el = document.createElement('div'); document.body.appendChild(el);
              h.helpScreen({ el, on() {}, show() {} }, { onBack() {}, tab: 'streaks' }); const t = el.querySelector('.help-down')?.textContent ?? ''; el.remove(); return t; })""")
            check('How to play lists what can be shot down', 'Shooting streaks down' in text and 'Wingman' in text and 'launcher' in text, text[:90])
            await browser.close()
    finally:
        srv.terminate()
    print('console errors:', errors[:5] or 'none')
    if failures or errors:
        print('FAILED:', *failures, sep='\n  ')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
