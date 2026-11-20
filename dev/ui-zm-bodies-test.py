#!/usr/bin/env python3
"""Graveyard Shift's undead bodies (ROADMAP item 50, docs/ZOMBIES.md "Bodies"): python3 dev/ui-zm-bodies-test.py [port] [outdir]

In Chromium at 852x393 on Foundry: every kind raised in a ring round the player and frozen (the camera pulled in),
then walking, winding up an attack, rising out of the ground; deaths by a headshot, an explosive and a melee kill
(limbs off, gibs, the body toppling); a Bloater bursting and a Shieldbearer's door breaking; each boss rising with its
intro (the camera leans to it, the title card shows, a tap skips it); with reduced motion the card shows and the camera
stays. Checks what the bodies draw (zmBodies.stats(): one mesh a kind, rows, corpses, gibs) and that nothing logs an
error. Screenshots in outdir (default /tmp/zmart).
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8612
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/zmart'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game.app'

# Host kinds (p.zk on the host) and where they stand round the player, metres (dx, dz).
RING = [(0, -2.6, -1.6), (1, 0, -2.6), (2, 2.8, -1.6), (7, -3.0, 1.0), (5, 3.2, 1.0), (6, -1.4, 2.6), (8, 1.6, 2.6)]
NAMES = {0: 'shambler', 1: 'runner', 2: 'brute', 3: 'yardmaster', 4: 'gravewarden', 5: 'spitter', 6: 'bloater', 7: 'crawler', 8: 'shieldbearer', 10: 'listener', 11: 'barker'}

SETUP = f"""(() => {{ const m = {G}.match, sim = m.sim, R = sim.rules;
  window.__shield = setInterval(() => {{ for (const p of sim.players) if (p.team === 0) p.spawnProtect = 99; }}, 200);
  for (const p of R.crew) if (p.bot) {{ p.bot.update = () => []; }} R.plan = () => {{}}; R._crewPlan = null;
  R.spawnT = 1e9; R.round = 15; R.hp = 2000;
  for (const z of R.horde) if (z.alive) {{ z.alive = false; z.hp = 0; }}
  window.__sp = [];
  const drive = R._driveZombie.bind(R);
  R._driveZombie = (p, dt) => {{ if (window.__sp.includes(p) && window.__freeze) {{ p.ps.vx = p.ps.vz = 0; return; }} drive(p, dt); }};
  window.__freeze = true;
  // The bot teammates stand still, out of the way (off to a far corner of the map).
  const me = sim.byId.get(m.localId);
  for (const p of R.crew) if (p.id !== m.localId) {{ p.bot && (p.bot.update = () => []); const k = sim.nav.nearestFree(me.ps.x > sim.map.width / 2 ? 4 : sim.map.width - 4, 4); p.ps.x = k % sim.nav.w + 0.5; p.ps.z = Math.floor(k / sim.nav.w) + 0.5; }}
}})()"""

def raise_js(kinds):
    return f"""(() => {{ const m = {G}.match, sim = m.sim, R = sim.rules, me = sim.byId.get(m.localId), x = me.ps.x, z = me.ps.z;
  const free = (dx, dz) => {{ const k = sim.nav.nearestFree(x + dx, z + dz); return {{ x: k % sim.nav.w + 0.5, z: Math.floor(k / sim.nav.w) + 0.5 }}; }};
  for (const [k, dx, dz] of {json.dumps(kinds)}) {{ const seat = R.horde.find(q => !q.alive && !window.__sp.includes(q)) ?? R.horde.find(q => !q.alive);
    R._raise(seat, k, free(dx, dz)); seat.hp = seat.zMax = 99999; seat.ps.aim = Math.atan2(z - seat.ps.z, x - seat.ps.x); window.__sp.push(seat); }}
  window.__home = window.__home ?? [x, z]; return window.__sp.length; }})()"""

CLEAR = f"""(() => {{ const R = {G}.match.sim.rules; for (const z of R.horde) if (z.alive) {{ z.alive = false; z.hp = 0; }} window.__sp = []; }})()"""
STATS = f"{G}.renderer.zmBodies?.stats()"


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=ARGS)
            for reduce in (False, True):
                ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True, reduced_motion='reduce' if reduce else 'no-preference')
                pg = await ctx.new_page()
                pg.on('console', lambda m: errors.append(m.text[:300]) if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e} {getattr(e, "stack", "")}'[:600]))
                ev = pg.evaluate
                async def shot(name):
                    print(f'  {name}', flush=True)
                    await pg.screenshot(path=f'{OUT}/{name}.png')
                await pg.goto(f'http://localhost:{PORT}/?debug=1&map=foundry&mode=zm', timeout=120000)
                await pg.wait_for_timeout(900)
                await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
                await pg.reload()
                await pg.wait_for_timeout(1200)
                await pg.locator('[data-act="custom"]').first.click()
                await pg.wait_for_function(f'{G}.match?.interp.newest?.phase === "live"', timeout=90000)
                await pg.wait_for_function(f"{G}.match.sim.rules.round === 1", timeout=60000)
                await ev(SETUP)
                await pg.wait_for_timeout(400)
                if not reduce:
                    base = await ev(f"{G}.renderer.distance")
                    await ev(f"{G}.renderer.distance = {base} * 0.5")
                    # Every common kind, frozen in a ring, facing the player (they rise first: give it time).
                    await ev(raise_js(RING))
                    await pg.wait_for_timeout(450)
                    await shot('01-rising')
                    await pg.wait_for_timeout(1600)
                    st = await ev(STATS)
                    print('  stats', st, flush=True)
                    want = {'1', '2', '3', '6', '7', '8', '9'}
                    if not st or not want <= set(st['kinds'].keys()): failures.append(f'lineup: kinds drawn {st}')
                    await shot('02-lineup')
                    await ev(f"{G}.renderer.distance = {base}")
                    await pg.wait_for_timeout(400)
                    await shot('03-lineup-match-scale')
                    await ev(f"{G}.renderer.distance = {base} * 0.4")
                    # Each kind close up, the player stood just off it.
                    for i, (k, dx, dz) in enumerate(RING):
                        await ev(f"(() => {{ const m = {G}.match, z = window.__sp[{i}]; m.ps.x = z.ps.x + 2.6; m.ps.z = z.ps.z + 2.2; }})()")
                        await pg.wait_for_timeout(350)
                        await shot(f'11-{NAMES[k]}')
                    await ev(f"(() => {{ const m = {G}.match, me = m.sim.byId.get(m.localId); m.ps.x = window.__home[0]; m.ps.z = window.__home[1]; }})()")
                    # Walking toward the player (slowed so they stay in frame).
                    await ev(f"{G}.renderer.distance = {base} * 0.5")
                    await ev("(() => { for (const z of window.__sp) z.zPace = 0.6; window.__freeze = false; })()")
                    await pg.wait_for_timeout(900)
                    await shot('04-walking')
                    await ev("(() => { window.__freeze = true; })()")
                    # Windups: hold the swing flag (the claw lands on nobody: spawn protection).
                    await ev("(() => { for (const z of window.__sp) { z.zSwing = 5; if (z.zk === 5) z.zSpitT = 5; } })()")
                    await pg.wait_for_timeout(500)
                    await shot('05-windup')
                    await ev("(() => { for (const z of window.__sp) { z.zSwing = 0; z.zSpitT = 0; } })()")
                    await pg.wait_for_timeout(120)
                    await shot('06-strike')
                    await pg.wait_for_timeout(400)
                    # Deaths: a headshot, explosives, a melee kill; a Bloater bursting; the Shieldbearer's door breaking first.
                    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId), sp = window.__sp;
                      const sh = sp.find(z => z.zk === 8); if (sh) {{ sh.zShield = 1; sim.rules.kinds.damage ? 0 : 0; }}
                      const kill = (z, w, head) => {{ z.hp = 10; sim._damage(z, me, 9999, w, 5, null, head); }};
                      kill(sp[0], 'ar', true); kill(sp[1], 'launcher', false); kill(sp[2], 'launcher', false); kill(sp[3], 'knife', false);
                      kill(sp[5], 'ar', false); }})()""")
                    await pg.wait_for_timeout(160)
                    await shot('07-deaths-a')
                    await pg.wait_for_timeout(450)
                    st = await ev(STATS)
                    print('  stats', st, flush=True)
                    if not st or st['corpses'] < 3: failures.append(f'deaths: corpses {st}')
                    if not st or st['gibs'] < 2: failures.append(f'deaths: gibs {st}')
                    await shot('08-deaths-b')
                    # The door breaks off the Shieldbearer, then it and the Spitter go down.
                    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId), sp = window.__sp;
                      const sh = sp.find(z => z.zk === 8); if (sh) {{ sh.zShield = 0; sim._emit({{ t: 'zshield', id: sh.id, x: sh.ps.x, z: sh.ps.z, broke: 1 }}); }} }})()""")
                    await pg.wait_for_timeout(300)
                    await shot('09-door-breaks')
                    await pg.wait_for_timeout(1400)
                    await shot('10-lying')
                    # (Game time runs slow under SwiftShader: frames are clamped to 50 ms. Wait on the state, not the clock.)
                    try: await pg.wait_for_function(f"(() => {{ const s = {STATS}; return s && s.corpses === 0 && s.gibs === 0; }})()", timeout=60000)
                    except Exception: failures.append(f'bodies did not sink away: {await ev(STATS)}')
                    await ev(CLEAR)
                    await pg.wait_for_timeout(500)
                # The bosses, each with its intro.
                for k, name in [(3, 'yardmaster'), (4, 'gravewarden'), (10, 'listener'), (11, 'barker')]:
                    await ev(CLEAR)
                    await pg.wait_for_timeout(300)
                    cam0 = await ev(f"[{G}.renderer.camTarget.x, {G}.renderer.camTarget.z]")
                    await ev(raise_js([(k, 6, -3)]))
                    await pg.wait_for_timeout(700)
                    intro = await ev("import('/js/ui/zm-intro.js').then(m => ({ on: m.ZM_INTRO.on, zk: m.ZM_INTRO.zk, still: m.ZM_INTRO.still }))")
                    card = await ev("(() => { const c = document.querySelector('.zm-intro'); return c ? { shown: !c.hidden && c.classList.contains('on'), text: c.textContent } : null; })()")
                    camK = await ev(f"{G}.renderer.introK")
                    print(f'  {name}: intro {intro} card {card} camK {camK}', flush=True)
                    if not intro['on']: failures.append(f'{name}: no intro')
                    if not card or not card['shown']: failures.append(f'{name}: no title card {card}')
                    if reduce and camK > 0: failures.append(f'{name}: the camera moved with reduced motion ({camK})')
                    if not reduce and not camK > 0.3: failures.append(f'{name}: no camera beat ({camK})')
                    await shot(f'{"20" if not reduce else "30"}-{name}-intro')
                    if k == 4 and not reduce:
                        t0 = await ev("import('/js/ui/zm-intro.js').then(m => m.ZM_INTRO.t)")
                        await pg.locator('.zm-intro').click()
                        sk = await ev("import('/js/ui/zm-intro.js').then(m => [m.ZM_INTRO.skipped, m.ZM_INTRO.dur - m.ZM_INTRO.t])")
                        if not sk[0] or sk[1] > 0.55: failures.append(f'tapping the card did not skip the intro ({t0} -> {sk})')
                        try: await pg.wait_for_function("import('/js/ui/zm-intro.js').then(m => !m.ZM_INTRO.on)", timeout=30000)
                        except Exception: failures.append('the intro did not end after a skip')
                    else:
                        try: await pg.wait_for_function("import('/js/ui/zm-intro.js').then(m => !m.ZM_INTRO.on)", timeout=60000)
                        except Exception: failures.append(f'{name}: the intro never ended')
                        try: await pg.wait_for_function("(() => { const c = document.querySelector('.zm-intro'); return !c || c.hidden; })()", timeout=10000)
                        except Exception: failures.append(f'{name}: the card stayed up')
                    if not reduce:
                        base = await ev(f"{G}.renderer.distance")
                        await ev(f"(() => {{ const m = {G}.match, me = m.sim.byId.get(m.localId), b = window.__sp[0]; m.ps.x = b.ps.x + 3.5; m.ps.z = b.ps.z + 3.5; }})()")
                        await ev(f"{G}.renderer.distance = {base} * 0.55")
                        await pg.wait_for_timeout(500)
                        await shot(f'21-{name}-close')
                        await ev("(() => { window.__sp[0].zSwing = 5; })()")
                        await pg.wait_for_timeout(450)
                        await shot(f'22-{name}-windup')
                        await ev("(() => { window.__sp[0].zSwing = 0; })()")
                        await ev(f"{G}.renderer.distance = {base}")
                await ev('clearInterval(window.__shield)')
                await ctx.close()
            await browser.close()
    finally:
        srv.terminate()
    errors = [e for e in errors if 'favicon' not in e]
    for e in errors[:10]: print('ERROR', e)
    for f in failures: print('FAIL', f)
    print('OK' if not failures and not errors else f'{len(failures)} failures, {len(errors)} errors')
    sys.exit(1 if failures or errors else 0)

asyncio.run(main())
