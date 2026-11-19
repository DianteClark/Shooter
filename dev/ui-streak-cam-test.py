#!/usr/bin/env python3
"""Scorestreak camera and piloting check (roadmap 40).

Run: python3 dev/ui-streak-cam-test.py [port] [--radar]. Starts a solo match, then calls every scorestreak as the local player
and records how far the camera's target strays from the player over the next 2.5 s while the player walks. Only the
piloted streaks (Cruise Missile, Recon Drone, Carpet Line) may move the camera off the player; every other streak,
Wingman included, must leave it on the player. For the Recon Drone it also checks that a push of the aim stick moves the
drone on the first host ticks after the call, while sprinting, with no ADS in between.

Radar (also alone with --radar): in a Hardcore match the minimap is hidden until the local team calls a tracking streak
(UAV, Overwatch, Blackbird, Sonar Sweep, Recon Drone); then it shows with the enemies that streak reveals and hides again
when it runs out; an enemy Jammer still fills it with static. The same streaks in a normal match reveal enemies on the
always-shown minimap. Screenshots in /tmp/radar.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8643))
RADAR_ONLY = '--radar' in sys.argv
TRACKING = ['uav', 'overwatch', 'blackbird', 'sweep', 'recon']
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


# Enemy markers on the minimap: pixels in an enemy team's colour (squares are friendlies, so only enemies count).
ENEMY_PX = """() => { const g = window.__game, m = g.app.match, me = m.sim.byId.get(m.localId), c = document.querySelector('.minimap canvas');
  return import('/js/shared/constants.js').then(({ TEAMS }) => {
    const hex = TEAMS[1 - me.team].css, want = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - want[0]) + Math.abs(d[i + 1] - want[1]) + Math.abs(d[i + 2] - want[2]) < 60) n++;
    return n; }); }"""
MM_STATE = """() => { const mm = document.querySelector('.minimap'), cs = getComputedStyle(mm), r = mm.getBoundingClientRect();
  return { shown: cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0, radar: document.querySelector('.hud').classList.contains('hc-radar'), jammed: mm.classList.contains('jammed') }; }"""


async def radar_check(browser, hardcore, failures, errors):
    label = 'hardcore' if hardcore else 'normal'
    os.makedirs('/tmp/radar', exist_ok=True)
    ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
    def check(name, ok, info=''):
        print(f'  {label:<8} {name:<58} {"ok" if ok else "FAIL"} {info}')
        if not ok: failures.append(f'{label}: {name}: {info}')
    await pg.goto(f'http://localhost:{PORT}/?debug=1&map=topside&mode=tdm&bots=recruit')
    await pg.wait_for_timeout(800)
    await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.evaluate(f"import('/js/ui/modifiers.js').then(m => m.setSoloMods({json.dumps(['hardcore'] if hardcore else [])}))")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="custom"]').first.click(no_wait_after=True)
    await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=90000)
    mods = await pg.evaluate('window.__game.app.match.sim.mods')
    check('match modifiers', ('hardcore' in mods) == hardcore, mods)
    # Nobody moves or dies; enemies stand 20-30 m off (out of the open, so radar is what shows them).
    await pg.evaluate("""(() => { const m = window.__game.app.match, sim = m.sim, me = sim.byId.get(m.localId);
      for (const p of sim.players) if (p.bot) p.bot.update = () => [];
      const dmg = sim._damage.bind(sim); sim._damage = (v, ...a) => (v.team === me.team ? undefined : dmg(v, ...a));
      sim.streakDenied = () => null; })()""")
    await pg.wait_for_timeout(1200)
    st = await pg.evaluate(f'({MM_STATE})()')
    check('minimap before any streak', st['shown'] != hardcore, st)
    for kind in TRACKING:
        # Two enemies close (Sonar Sweep's 36 m, the drone's path), the rest where they stand.
        await pg.evaluate("""(() => { const m = window.__game.app.match, sim = m.sim, me = sim.byId.get(m.localId);
          sim.uav.fill(0); sim.overwatch.fill(0); sim.jam.fill(0); sim.gunships.length = 0; if (sim.v9) sim.v9.sweeps.length = 0;
          window.__game.hud.radarUntil = 0;
          const foes = sim.players.filter(q => q.team !== me.team && q.alive);
          foes.slice(0, 2).forEach((q, i) => { q.ps.x = me.ps.x + 6 + i * 3; q.ps.z = me.ps.z + 4; q.markT = 0; });
          for (const q of sim.players) q.ps.firingT = 0; })()""")
        await pg.wait_for_timeout(900)
        res = await pg.evaluate(f'({CALL})({json.dumps(kind)})')
        await pg.wait_for_timeout(1600 if kind in ('sweep', 'recon') else 900)
        st = await pg.evaluate(f'({MM_STATE})()')
        seen = await pg.evaluate("""(() => { const m = window.__game.app.match, v = m.interp.newest, me = v.players.find(p => p.id === m.localId);
          return { uav: v.uav[me.team], marked: v.players.filter(p => p.team !== me.team && p.alive && p.firingT > 0).length }; })()""")
        px = await pg.evaluate(f'({ENEMY_PX})()')
        await pg.screenshot(path=f'/tmp/radar/{label}-{kind}.png')
        revealed = (seen['uav'] > 0 if kind in ('uav', 'overwatch', 'blackbird') else seen['marked'] > 0) and px > 0
        check(f'{kind}: called, minimap shown, enemies on it', res not in ('refused', 'dead') and st['shown'] and (st['radar'] or not hardcore) and revealed, {**st, **seen, 'px': px, 'res': res})
        if kind == 'uav':
            # An enemy Jammer still blanks it: static on the minimap, which stays up while the UAV runs.
            await pg.evaluate("(() => { const m = window.__game.app.match, sim = m.sim, me = sim.byId.get(m.localId); sim.jam[me.team] = 6; })()")
            await pg.wait_for_timeout(900)
            st2 = await pg.evaluate(f'({MM_STATE})()')
            await pg.screenshot(path=f'/tmp/radar/{label}-uav-jammed.png')
            check('uav under an enemy Jammer: static', st2['shown'] and st2['jammed'], st2)
            await pg.evaluate("window.__game.app.match.sim.jam.fill(0)")
        # Run it out: the minimap goes again in Hardcore.
        await pg.evaluate("""(() => { const m = window.__game.app.match, sim = m.sim; sim.uav.fill(0); sim.overwatch.fill(0); sim.gunships.length = 0;
          if (sim.v9) sim.v9.sweeps.length = 0; for (const q of sim.players) q.markT = 0; window.__game.hud.radarUntil = 0; })()""")
        await pg.wait_for_timeout(900)
        st3 = await pg.evaluate(f'({MM_STATE})()')
        check(f'{kind}: run out', st3['shown'] != hardcore, st3)
    await ctx.close()


async def main():
    if RADAR_ONLY:
        srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.8)
        failures, errors = [], []
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(args=ARGS)
                for hc in (True, False): await radar_check(browser, hc, failures, errors)
                await browser.close()
        finally:
            srv.terminate()
        print('console errors:', errors[:5] or 'none')
        if failures or errors:
            print('FAILED:', *failures, sep='\n  ')
            sys.exit(1)
        print('PASS')
        return
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
            print('Radar in Hardcore and normal')
            for hc in (True, False): await radar_check(browser, hc, failures, errors)
            await browser.close()
    finally:
        srv.terminate()
    print('console errors:', errors[:5] or 'none')
    if failures or errors:
        print('FAILED:', *failures, sep='\n  ')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
