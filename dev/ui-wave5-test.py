#!/usr/bin/env python3
"""Arsenal wave 5 (ROADMAP item 68, docs/WEAPONS-OVERHAUL.md "Wave 5"): the new guns, perks, streaks and operators drawn.

  python3 dev/ui-wave5-test.py [port] [outdir]

Serves the repo and, with no console or page errors allowed:
  - dev/gun-gallery.html: the five new guns from the side and from above, stock and with a full kit;
  - dev/ops-lineup.html: the four new operators at the issue, Elite (active effect) and Mastery (suit) skins, close up
    and at match scale;
  - dev/ui-gallery.html: the loadout screen with Overkill equipped and a second primary in the sidearm slot.
Screenshots go to outdir (default /tmp/wave5).
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 10322
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/wave5'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
GUNS = 'hipsmg,panlmg,autosniper,flare,lockon'
OPS = 'juniper,fenwick,odessa,calder'
PAGES = [
    ('guns-stock', f'/dev/gun-gallery.html?ids={GUNS}&views=side,top&cols=4', (1200, 900)),
    ('guns-kit', f'/dev/gun-gallery.html?ids=hipsmg,panlmg,autosniper&views=side,top&cols=4&kit=optic:reflex,barrel:compensator,mag:extmag,grip:vertical', (1200, 600)),
    ('ops-base', f'/dev/ops-lineup.html?ops={OPS}&skin=base&view=front&zoom=2&w=1000&h=420', (1000, 420)),
    ('ops-elite', f'/dev/ops-lineup.html?ops={OPS}&skin=3&view=front&zoom=2&w=1000&h=420', (1000, 420)),
    ('ops-mastery-front', f'/dev/ops-lineup.html?ops={OPS}&skin=5&view=front&zoom=2&w=1000&h=420', (1000, 420)),
    ('ops-mastery-top', f'/dev/ops-lineup.html?ops={OPS}&skin=5&view=game&zoom=2&per=4&w=852&h=393', (852, 393)),
    ('ops-game', f'/dev/ops-lineup.html?ops={OPS}&skin=5&view=game&mixteams=1&w=852&h=393', (852, 393)),
    ('loadout-overkill', '/dev/ui-gallery.html?frame=loadouts-overkill&size=p15&save=veteran&wait=1500', (852, 393)),
]


# Bots stand still and nobody on our side can be hurt; a foe 9 m east of us, the rest out of the way.
SETUP = """(() => { const m = window.__game.app.match, sim = m.sim, me = sim.byId.get(m.localId);
  for (const p of sim.players) if (p.bot) p.bot.update = () => [];
  const dmg = sim._damage.bind(sim); sim._damage = (v, ...a) => (v.team === me.team ? undefined : dmg(v, ...a));
  sim.streakDenied = () => null;
  const foes = sim.players.filter(q => q.team !== me.team);
  foes.forEach((f, i) => { f.ps.x = me.ps.x + 9 + i * 0.01; f.ps.z = me.ps.z + (i ? 30 : 0); f.ps.aim = Math.PI; f.spawnProtect = 0; });
  window.__foe = foes[0].id;
  window.__call = (id, kind) => { const p = sim.byId.get(id); p.score.slots = [{ kind, cost: 1, held: true, blocked: false }]; return sim.useStreak(id, 0); };
})()"""
MATCH_SHOTS = [
    # An enemy VTOL hovering over us; our SAM shooting at it.
    ('match-vtol-sam', """(() => { const m = window.__game.app.match, sim = m.sim; window.__call(window.__foe, 'vtol');
      const g = sim.gunships.find(g => g.kind === 'vtol'); g.x = m.ps.x + 4; g.z = m.ps.z - 2; g.hx = g.x; g.hz = g.z; window.__call(m.localId, 'sam'); })()""", 2600),
    # Our Napalm on the foe.
    ('match-napalm', """(() => { const m = window.__game.app.match, sim = m.sim; sim.gunships.length = 0; sim.turrets.length = 0; window.__call(m.localId, 'napalm'); })()""", 3200),
    # A Fusee into the foe: they burn and show on our map.
    ('match-flare', """(() => { const m = window.__game.app.match, sim = m.sim, me = sim.byId.get(m.localId), f = sim.byId.get(window.__foe);
      sim.eq.projectiles.length = 0; f.hp = 100; f.alive = true;
      sim.applyShot(me.id, { weapon: 'flare', ox: me.ps.x, oz: me.ps.z, aim: Math.atan2(f.ps.z - me.ps.z, f.ps.x - me.ps.x), ads: true, angles: [Math.atan2(f.ps.z - me.ps.z, f.ps.x - me.ps.x)] }, 0); })()""", 900),
    # High Alert: someone off screen, in clear sight 22-30 m away, has us in their sights.
    ('match-highalert', """(async () => { const m = window.__game.app.match, sim = m.sim, me = sim.byId.get(m.localId);
      sim.eq.projectiles.length = 0;
      const { hasLineOfSight } = await import('/js/shared/geometry.js');
      const f = sim.players.find(q => q.team !== me.team && q.alive && q.id !== window.__foe) ?? sim.byId.get(window.__foe);
      me.ps.perks = ['marathon', 'scavenger', 'highalert'];
      let spot = null;
      for (let a = 0; a < 6.28 && !spot; a += 0.2) for (const d of [26, 22, 30]) { const x = me.ps.x + Math.cos(a) * d, z = me.ps.z + Math.sin(a) * d;
        if (x < 2 || z < 2 || x > sim.map.width - 2 || z > sim.map.height - 2) continue;
        if (hasLineOfSight(sim.map, x, z, me.ps.x, me.ps.z)) { spot = { x, z }; break; } }
      f.alive = true; f.ps.x = spot.x; f.ps.z = spot.z; f.ps.aim = Math.atan2(me.ps.z - f.ps.z, me.ps.x - f.ps.x); })()""", 1500),
]


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for name, path, (vw, vh) in PAGES:
                ctx = await browser.new_context(viewport={'width': vw, 'height': vh})
                pg = await ctx.new_page()
                errs = []
                pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
                pg.on('response', lambda r: errs.append(f'404 {r.url}') if r.status == 404 and 'favicon' not in r.url else None)
                pg.on('pageerror', lambda e: errs.append(f'PAGEERR {e}'))
                await pg.goto(f'http://localhost:{PORT}{path}')
                try:
                    await pg.wait_for_function('window.__ready === true', timeout=90000)
                except Exception:
                    await pg.wait_for_timeout(6000)
                await pg.wait_for_timeout(1500)
                if name.startswith('loadout'):
                    txt = await pg.evaluate("document.querySelector('.ld-side')?.textContent || ''")
                    errs += await pg.evaluate("window.__errors || []")
                    if 'Vigil' not in txt or 'Overkill' not in txt:
                        errs.append(f'the sidearm slot does not show the Vigil under Overkill: {txt!r}')
                await pg.screenshot(path=f'{OUT}/{name}.png')
                if errs:
                    fails.append(f'{name}: {errs[:4]}')
                print(f'{"FAIL" if errs else "ok  "} {name}')
                await ctx.close()
            # In a match: the wave 5 streaks, a Fusee's burn, the High Alert edge pulse and the Skyhook lock box.
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, device_scale_factor=2, has_touch=True, is_mobile=True)
            pg = await ctx.new_page()
            errs = []
            pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
            pg.on('pageerror', lambda e: errs.append(f'PAGEERR {e}'))
            await pg.goto(f'http://localhost:{PORT}/?debug=1&map=railyard&mode=tdm&bots=recruit')
            await pg.wait_for_timeout(800)
            await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
            await pg.reload()
            await pg.wait_for_timeout(1200)
            await pg.locator('[data-act="custom"]').first.click(no_wait_after=True)
            await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=120000)
            await pg.evaluate(SETUP)
            for name, js, wait in MATCH_SHOTS:
                await pg.evaluate(js)
                await pg.wait_for_timeout(wait)
                if name == 'match-highalert':
                    n = await pg.evaluate('window.__game.app.match.hud.alertList?.length ?? 0')
                    if not n:
                        fails.append('High Alert: nobody flagged for an enemy in clear sight aiming at us')
                await pg.screenshot(path=f'{OUT}/{name}.png')
                print(f'ok   {name}')
            if errs:
                fails.append(f'match: {errs[:4]}')
            await ctx.close()
            await browser.close()
    finally:
        srv.terminate()
    if fails:
        print('\n'.join(fails))
        sys.exit(1)
    print(f'all ok, screenshots in {OUT}')

asyncio.run(main())
