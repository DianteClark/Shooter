#!/usr/bin/env python3
"""Juice test: hit feedback, screen punches, casings, celebration and the audio additions fire, Options > Accessibility
> Reduce shake and flashes turns the punches and flashes down, and the draw calls stay within budget.

  python3 dev/ui-juice-test.py [port] [screenshot dir]        (default 8463, /tmp/ui-juice)

A Team Deathmatch on Railyard against bots, stepped by hand at a fixed 30 Hz (the software renderer's frame rate does
not matter). Hits and kills are injected into the match's own event stream, so the renderer, HUD, audio and haptics
all see them exactly as they would see the sim's. Screenshots: hit, head, kill, damage numbers, calm kill, shards.
"""
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8463
SHOTS = sys.argv[2] if len(sys.argv) > 2 else '/tmp/ui-juice'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
CALL_BUDGET = 120        # docs/ARCHITECTURE.md
EXTRA_CALLS = 4          # What the juice may add on top of a quiet frame, at most.

SETUP = """(async () => {
  const st = window.setTimeout, ch = new MessageChannel(), q = [];
  ch.port1.onmessage = () => q.shift()();
  window.setTimeout = (f, d, ...a) => d ? st(f, d, ...a) : (q.push(f), ch.port2.postMessage(0), 0);
  const g = window.__game, m = g.app.match, a = m.audio, v = m.renderer.vfx;
  a.unlock();
  const T = window.__t = { fire: false, aim: 0, reload: false, n: {} };
  const read = m.controls.read.bind(m.controls);
  m.controls.read = () => { const r = read(); r.mx = 0; r.mz = 0; r.aim = T.aim; r.aiming = true; r.fire = T.fire; r.sprint = false; r.reload = !!T.reload; T.reload = false; return r; };
  m.running = false;
  T.step = (dt = 1 / 30) => { m.running = true; m.lastTime = performance.now() - dt * 1000; m.frame(); m.running = false; };
  const tryShell = v.shell.bind(v);
  T.shellTries = 0; v.shell = (...x) => { T.shellTries++; return tryShell(...x); };
  const play = a._play.bind(a);
  a._play = (buf, opt) => { for (const k in a.sfx) if (a.sfx[k] === buf) T.n['sfx:' + k] = (T.n['sfx:' + k] || 0) + 1; return play(buf, opt); };
  T.me = () => m.sim.byId.get(m.localId);
  // The nearest enemy, so what lands on it is on screen.
  T.foe = () => { const me = T.me(); let best = null, bd = 1e9; for (const p of m.sim.players) { if (p.team === me.team) continue; const d = Math.hypot(p.ps.x - me.ps.x, p.ps.z - me.ps.z); if (d < bd) { bd = d; best = p; } } return best; };
  // One event list into the match, as the sim would have emitted it this frame.
  T.inject = list => { for (const e of list) m.frameEvents.push(e); T.step(); };
  // Placed a few metres in front of the local player, so whatever it draws is on screen.
  T.hit = (o = {}) => { const f = T.foe(), me = T.me(); return { t: 'hit', by: m.localId, target: f.id, dmg: 34, x: me.ps.x + 5, z: me.ps.z - 1, killed: false, ...o }; };
  T.calls = () => m.renderer.getStats().calls;
})()"""


async def main():
    os.makedirs(SHOTS, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    def check(ok, what):
        print(('ok   ' if ok else 'FAIL ') + what, flush=True)
        if not ok: failures.append(what)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True, device_scale_factor=2)
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(m.text[:240]) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
            ev = pg.evaluate
            await pg.goto(f'http://localhost:{PORT}/?debug=1&map=railyard&mode=tdm')
            await pg.wait_for_function('!!window.__game?.Progress', timeout=30000)
            await ev("window.__game.Progress.name='Juice'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
            await pg.reload()
            await pg.wait_for_function('!!window.__game?.Progress', timeout=30000)
            await pg.wait_for_timeout(800)
            dmg_default = await ev("window.__game.app.options?.get?.('dmgNumbers') ?? JSON.parse(localStorage.getItem('switchyard-options') || '{}').dmgNumbers ?? false")
            check(dmg_default is False, f'damage numbers off by default ({dmg_default})')

            # Menu motion: the press shadow on a plate, and the screen slide on the way into Custom.
            await pg.locator('[data-act="custom"]').first.click()
            await pg.wait_for_function('window.__game.app.inMatch && window.__game.app.match?.interp?.newest?.phase === "live"', timeout=90000)
            await ev("window.__game.app.renderer.setQuality('high')")
            await ev(SETUP)
            await pg.wait_for_function('window.__game.app.match.audio.ready === true', timeout=180000)
            for _ in range(10): await ev('window.__t.step()')
            quiet = await ev("(() => { const T = window.__t, c = []; for (let i = 0; i < 6; i++) { T.step(); c.push(T.calls()); } return Math.max(...c); })()")
            print('quiet frame calls', quiet)

            # --- Hit feedback -------------------------------------------------------------------------------------
            r = await ev("""(() => { const T = window.__t, h = window.__game.app.match.hud; const j0 = { ...h.juice };
              T.inject([T.hit()]); const el = h.hitEl; return { hits: h.juice.hits - j0.hits, pop: h.juice.pop, op: +el.style.opacity, tf: el.style.transform, nums: h.juice.nums }; })()""")
            print('hit', r)
            check(r['hits'] == 1 and r['op'] > 0.5, 'hit marker shows on a hit')
            check(r['pop'] >= 0.35, f"hit marker pops ({r['pop']})")
            check(r['nums'] == 0, 'no damage numbers while the option is off')
            await pg.screenshot(path=f'{SHOTS}/hit.png', clip={'x': 326, 'y': 96, 'width': 200, 'height': 200})

            r = await ev("""(() => { const T = window.__t, h = window.__game.app.match.hud; T.n = {}; for (let i = 0; i < 8; i++) T.step(0.05);
              const h0 = h.juice.heads; T.inject([T.hit({ head: true, dmg: 52 })]);
              return { heads: h.juice.heads - h0, head: h.hitEl.classList.contains('head'), ring: h.hitRing.getAnimations().length, ting: T.n['sfx:headshot'] || 0 }; })()""")
            print('head', r)
            check(r['heads'] == 1 and r['head'] and r['ring'] > 0, 'headshot marker: gold with a ringing halo')
            await pg.wait_for_timeout(60)
            await pg.screenshot(path=f'{SHOTS}/head.png', clip={'x': 326, 'y': 96, 'width': 200, 'height': 200})
            check(r['ting'] >= 1, 'headshot ting plays')

            r = await ev("""(() => { const T = window.__t, m = window.__game.app.match, h = m.hud, R = m.renderer; for (let i = 0; i < 8; i++) T.step(0.05);
              const f = T.foe(), j0 = { ...h.juice }, rows = h.feedEl.children.length;
              const zp0 = R.zoomPunch;
              T.inject([T.hit({ killed: true, dmg: 60 }), { t: 'kill', by: m.localId, target: f.id, weapon: T.me().weapon, x: f.ps.x, z: f.ps.z, dist: 12 }]);
              const row = h.feedEl.firstElementChild;
              return { kills: h.juice.kills - j0.kills, kill: h.hitEl.classList.contains('kill'), flash: h.juice.flashPeak, flashAnim: h.hitFlash.getAnimations().length,
                floats: h.juice.floats - j0.floats, float: h.xpFloats.map(b => b.textContent).join(' '), rows: h.feedEl.children.length - rows, rowAnim: row ? row.getAnimations().length : 0,
                zoom: R.zoomPunch, kx: getComputedStyle(h.el.querySelector('.hit-kx')).display }; })()""")
            print('kill', r)
            check(r['kills'] == 1 and r['kill'] and r['kx'] == 'block', 'kill marker: the red X')
            check(r['flashAnim'] > 0 and r['flash'] > 0.8, f"kill marker flashes ({r['flash']})")
            check(r['floats'] == 1 and '+' in r['float'], f"kill confirm: the points float ({r['float']})")
            check(r['rows'] >= 1 and r['rowAnim'] > 0, 'killfeed row slides in')
            await pg.wait_for_timeout(70)
            await pg.screenshot(path=f'{SHOTS}/kill.png')
            await pg.screenshot(path=f'{SHOTS}/kill-crop.png', clip={'x': 286, 'y': 76, 'width': 280, 'height': 240})

            # Screen punches: a multi-kill and a kill streak.
            r = await ev("""(() => { const T = window.__t, m = window.__game.app.match, R = m.renderer; for (let i = 0; i < 20; i++) T.step(0.05);
              const n0 = R.punches || 0; T.inject([{ t: 'medal', id: m.localId, medal: 'double' }]); const a = R.lastPunch;
              for (let i = 0; i < 20; i++) T.step(0.05); T.inject([{ t: 'medal', id: m.localId, medal: 'streak5' }]);
              return { punches: (R.punches || 0) - n0, double: a, streak: R.lastPunch }; })()""")
            print('punch', r)
            check(r['punches'] == 2 and r['double'] > 0.02 and r['streak'] > r['double'], 'screen punches on a multi-kill and a streak')
            full = {'pop': None, 'flash': None, 'punch': r['double']}

            # Damage numbers, with the option on.
            r = await ev("""(async () => { const T = window.__t, m = window.__game.app.match, h = m.hud; const O = (await import('/js/ui/options.js')).Options;
              O.set('dmgNumbers', true); for (let i = 0; i < 6; i++) T.step(0.05); const n0 = h.juice.nums;
              T.inject([T.hit({ dmg: 27 })]); T.step(0.03); T.inject([T.hit({ dmg: 41, head: true })]);
              const live = h.dmgNums.filter(b => b.getAnimations().length), shown = live.map(b => b.textContent);
              const at = live.map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; });
              return { nums: h.juice.nums - n0, shown, at, view: [h.viewW, h.viewH] }; })()""")
            print('damage numbers', r)
            check(r['nums'] == 2 and '27' in r['shown'] and '41' in r['shown'], 'damage numbers rise off the target when on')
            print('  (nearest enemy on screen:', all(0 <= x <= r['view'][0] and 0 <= y <= r['view'][1] for x, y in r['at']), ')')
            await pg.wait_for_timeout(90)
            await pg.screenshot(path=f'{SHOTS}/dmg-numbers.png')
            await ev("(async () => (await import('/js/ui/options.js')).Options.set('dmgNumbers', false))()")

            # --- Casings: pooled and rationed ---------------------------------------------------------------------
            r = await ev("""(() => { const T = window.__t, m = window.__game.app.match, v = m.renderer.vfx; for (let i = 0; i < 10; i++) T.step(0.1);
              const out0 = v.shellsOut || 0, try0 = T.shellTries;
              for (let i = 0; i < 40; i++) v.shell(m.ps.x, 1.2, m.ps.z, 1, 0, 'rifle');     // A flood in one frame.
              const burst = (v.shellsOut || 0) - out0;
              const ps = m.ps; ps.slot = 0; ps.primary = 'smg'; ps.weapon = 'smg'; ps.ammo[0] = 999; ps.reserve[0] = 999; ps.cooldown = 0; ps.reloadT = 0;
              const o1 = v.shellsOut || 0, t1 = T.shellTries; let peak = 0; T.fire = true;
              for (let i = 0; i < 60; i++) { T.step(); peak = Math.max(peak, v.shellMesh.count); }       // Two seconds of sustained fire.
              T.fire = false;
              return { burst, tried: T.shellTries - t1, made: (v.shellsOut || 0) - o1, peak, pool: v.sh.n }; })()""")
            print('casings', r)
            check(r['burst'] <= 4, f"casings rationed: a flood of 40 in one frame makes {r['burst']}")
            check(r['made'] >= 6 and r['made'] <= 2 * 9 + 4, f"sustained fire ejects a few casings a second ({r['made']} in 2 s from {r['tried']} rounds)")
            check(r['peak'] <= r['pool'], f"casings stay inside the pool ({r['peak']} of {r['pool']})")
            busy = await ev("(() => { const T = window.__t; T.fire = true; const c = []; for (let i = 0; i < 12; i++) { T.step(); c.push(T.calls()); } T.fire = false; return Math.max(...c); })()")
            print('busy frame calls', busy)
            check(busy <= CALL_BUDGET and busy - quiet <= EXTRA_CALLS + 6, f'draw calls in a firefight {busy} (quiet {quiet}, budget {CALL_BUDGET})')
            await pg.screenshot(path=f'{SHOTS}/casings.png')

            # --- Audio: reload done, low ammo warning, the heartbeat muffle ----------------------------------------
            r = await ev("""(async () => { const T = window.__t, m = window.__game.app.match, a = m.audio; T.n = {};
              const ps = m.ps; ps.instantReload = false; ps.ammo[0] = 30; ps.reserve[0] = 120; for (let i = 0; i < 4; i++) T.step();
              const w0 = a.lowWarns || 0; ps.ammo[0] = 8; T.fire = true; for (let i = 0; i < 4; i++) { T.step(); await new Promise(r => setTimeout(r, 34)); } T.fire = false;
              const warns = (a.lowWarns || 0) - w0, d0 = a.reloadDones || 0;
              T.reload = true; for (let i = 0; i < 120 && !((a.reloadDones || 0) > d0); i++) T.step();
              const done = (a.reloadDones || 0) - d0;
              const me = T.me(); let cut = 1e9; for (let i = 0; i < 30; i++) { me.hp = 9; T.step(); cut = Math.min(cut, a.hurtCut); }
              const beat = T.n['sfx:heartbeat'] || 0; for (let i = 0; i < 20; i++) { me.hp = 100; T.step(); }
              return { warns, done, cut, open: a.hurtCut, beat, bufs: ['reloadDone', 'lowWarn', 'empty', 'headshot'].map(k => !!a.sfx[k]), lvl: +(a.uiBufs.levelUp?.duration || 0).toFixed(2) }; })()""")
            print('audio', r)
            check(all(r['bufs']), 'reload-done, low-ammo warning, empty and headshot sounds synthesised')
            check(r['warns'] >= 1, 'low-ammo warning ticks once on the way into the last rounds')
            check(r['done'] >= 1, 'reload completion click')
            check(r['cut'] < 3000 and r['open'] >= 15000 and r['beat'] >= 1, f"low health: heartbeat and the world muffled to {r['cut']} Hz, open again at {r['open']} Hz")
            check(r['lvl'] >= 1.5, f"bigger level-up stinger ({r['lvl']} s)")

            # --- Reduce shake and flashes ---------------------------------------------------------------------------
            r = await ev("""(async () => { const T = window.__t, m = window.__game.app.match, h = m.hud, R = m.renderer; const O = (await import('/js/ui/options.js')).Options;
              O.set('calm', true); for (let i = 0; i < 20; i++) T.step(0.05);
              const f = T.foe(); T.inject([T.hit({ killed: true, dmg: 60 }), { t: 'kill', by: m.localId, target: f.id, weapon: T.me().weapon, x: f.ps.x, z: f.ps.z, dist: 12 }]);
              const pop = h.juice.pop, flash = h.juice.flashPeak, zoom = R.zoomPunch;
              for (let i = 0; i < 20; i++) T.step(0.05); T.inject([{ t: 'medal', id: m.localId, medal: 'double' }]);
              return { pop, flash, zoom, punch: R.lastPunch }; })()""")
            print('calm', r)
            await pg.wait_for_timeout(40)
            await pg.screenshot(path=f'{SHOTS}/kill-calm-crop.png', clip={'x': 286, 'y': 76, 'width': 280, 'height': 240})
            check(r['flash'] <= 0.4, f"reduce flashes dims the kill flash ({r['flash']})")
            check(r['pop'] <= 0.25, f"reduce shake shrinks the marker pop ({r['pop']})")
            check(r['punch'] <= full['punch'] * 0.3, f"reduce shake takes screen punches to a quarter ({r['punch']:.4f} vs {full['punch']:.4f})")

            # --- Celebration ---------------------------------------------------------------------------------------
            r = await ev("""(async () => { const M = await import('/js/ui/motion.js'); const O = (await import('/js/ui/options.js')).Options;
              const host = document.createElement('div'); host.className = 'juice-host'; host.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;';
              document.body.appendChild(host);
              const b0 = M.celebrated.bursts; M.celebrate(host, { count: 30 }); const calmShards = host.querySelectorAll('.fx-shards i').length;
              O.set('calm', false); await new Promise(r => setTimeout(r, 50));
              M.celebrate(host, { count: 30 }); const shards = host.querySelectorAll('.fx-shards i').length;
              return { calmShards, shards, bursts: M.celebrated.bursts - b0, anims: host.getAnimations({ subtree: true }).length }; })()""")
            print('celebrate', r)
            check(r['calmShards'] == 0, 'no shards under reduce motion')
            check(r['shards'] == 30 and r['bursts'] == 1 and r['anims'] >= 30, 'level-up celebration throws low-poly shards')
            await pg.wait_for_timeout(420)
            await pg.screenshot(path=f'{SHOTS}/celebrate.png')
            await pg.wait_for_timeout(1700)
            left = await ev("document.querySelectorAll('.juice-host .fx-shards').length")
            check(left == 0, 'shards cleaned up after the burst')
            await browser.close()
    finally:
        srv.terminate()
    errs = [e for e in errors if 'favicon' not in e]
    if errs: failures.append(f'console errors: {errs[:6]}')
    print('\nFAIL\n' + '\n'.join(failures) if failures else '\nPASS')
    sys.exit(1 if failures else 0)

asyncio.run(main())
