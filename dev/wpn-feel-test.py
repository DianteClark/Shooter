#!/usr/bin/env python3
"""Weapon feel test. Fires every gun in WEAPONS on the firing range and checks that each one produces its own
audio voice and its shot effects, with no console errors; then checks the staged reload, the low-ammo layer and
the dry-fire click on one gun, and saves screenshots of one gun per class mid-shot.

  python3 dev/wpn-feel-test.py [port] [screenshot dir]        (default 8205, /tmp/wpn-feel)

The match loop is stepped by hand at a fixed 30 Hz so the software renderer's frame rate does not matter.
"""
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8205
SHOTS = sys.argv[2] if len(sys.argv) > 2 else '/tmp/wpn-feel'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--autoplay-policy=no-user-gesture-required']
# Guns no table in the game has heard of, appended to weapons.js as it is served: the 14 new guns arrive the same
# way. One with only a category, one with no category at all (classed by its numbers), one that names a gun to take
# after and overrides a little, and a melee weapon.
UNKNOWN = """
;(() => { const mk = (from, id, over) => { WEAPONS[id] = { ...WEAPONS[from], id, name: id, ...over }; };
  mk('burst', 'zzrifle', { category: 'Assault', kickCam: 0.95, rpm: 520, auto: true, burst: undefined });
  mk('sniper', 'zznocat', { category: undefined });
  mk('smg', 'zzlike', { category: 'SMG', feel: { like: 'pdw', voice: { pitch: 1.2 }, fx: { shape: 'cross' }, recoil: { twist: 1.4 } } });
  mk('pistol', 'zzblade', { category: 'Melee', melee: true, suppressed: true, range: 2.7, rpm: 190, kickCam: 0.3 });
})();
"""
CLASS_PICK = {'Assault': 'ar', 'SMG': 'smg', 'Shotgun': 'shotgun', 'LMG': 'lmg', 'Marksman': 'dmr', 'Sniper': 'sniper', 'Pistol': 'revolver', 'Launcher': 'launcher', 'Melee': 'knife'}

SETUP = """(async () => {
  // Audio synthesis runs in zero-delay timers; a software-rendered page starves those, so run them back to back.
  const st = window.setTimeout, ch = new MessageChannel(), q = [];
  ch.port1.onmessage = () => q.shift()();
  window.setTimeout = (f, d, ...a) => d ? st(f, d, ...a) : (q.push(f), ch.port2.postMessage(0), 0);
  const m = window.__game.app.match, a = m.audio, v = m.renderer.vfx;
  a.unlock();
  const W = (await import('/js/shared/weapons.js')).WEAPONS;
  const T = window.__t = { W, n: {}, fire: false, aim: 0 };
  const count = k => { T.n[k] = (T.n[k] || 0) + 1; };
  const wrap = (o, name, key) => { const f = o[name].bind(o); o[name] = (...x) => { count(typeof key === 'function' ? key(...x) : key); return f(...x); }; };
  wrap(a, '_play', (buf, opt) => 'play:' + ((opt && opt.cls) || 'world'));
  const play = a._play;
  a._play = (buf, opt) => { for (const k in a.sfx) if (a.sfx[k] === buf) count('sfx:' + k); for (const id in a.foley) for (const s in a.foley[id]) if (a.foley[id][s] === buf) count('foley:' + s); return play(buf, opt); };
  wrap(v, '_flash', 'flash'); wrap(v, '_tracer', 'tracer'); wrap(v, 'shell', 'shell'); wrap(v, 'spawn', 'part'); wrap(v, 'rocket', 'rocket');
  wrap(v, 'wallHit', 'wallHit'); wrap(v, 'groundHit', 'groundHit'); wrap(v, 'mark', 'mark'); wrap(v, 'contrail', 'contrail');
  T.themeSets = 0; const setTheme = a.setTheme.bind(a); a.setTheme = t => { T.themeSets++; return setTheme(t); };
  const onEv = a.onEvents.bind(a);
  a.onEvents = (ev, view) => { for (const e of ev) if (e.t === 'shot' && e.by === m.localId) count('shot'); return onEv(ev, view); };
  const read = m.controls.read.bind(m.controls);
  m.controls.read = () => { const r = read(); r.mx = 0; r.mz = 0; r.aim = T.aim; r.aiming = true; r.fire = T.fire; r.sprint = false; r.reload = !!T.reload; T.reload = false; return r; };
  m.running = false;
  // One frame of the match at a fixed step.
  T.step = (dt = 1 / 30) => { m.running = true; m.lastTime = performance.now() - dt * 1000; m.frame(); m.running = false; };
  T.arm = id => { const ps = m.ps, w = W[id]; ps.slot = 0; ps.primary = id; ps.weapon = id; ps.ammo[0] = w.magazine; ps.reserve[0] = w.reserve; ps.cooldown = 0; ps.reloadT = 0; ps.reloadDur = 0;
    ps.shotIndex = 0; ps.burstLeft = 0; ps.heat = 0; ps.overheated = false; ps.bloom = 0; ps.adsT = 1; ps.sprinting = false; ps.sprintRecoverT = 0; ps.swapT = 0; ps.spin = 0; };
  T.pools = () => ({ flashes: v.flashMesh.count, tracers: v.tracerGeom.instanceCount, parts: v.partGeom.instanceCount, shells: v.shellMesh.count, marks: v.markGeom.instanceCount });
})()"""

FIRE = """async ([id, frames]) => {
  const T = window.__t, m = window.__game.app.match, a = m.audio, v = m.renderer.vfx;
  T.n = {}; T.arm(id); T.fire = true;
  const peak = { flashes: 0, tracers: 0, parts: 0, shells: 0, marks: 0 };
  for (let i = 0; i < frames; i++) { T.step(); const p = T.pools(); for (const k in p) peak[k] = Math.max(peak[k], p[k]); }
  T.fire = false;
  const g = a.guns[id], fx = v.gunFx(id), f = a.foley[id];
  return { cls: (await import('/js/render/feel.js')).classOf(id), n: T.n, peak, voice: !!g && g.near.length === 3 && !!g.tail, sup: g ? g.sup.length : 0, foley: !!f && !!f.out && !!f.in && !!f.rack && !!f.swap,
    fx: { shape: fx.shape, shell: fx.shell, tail: fx.tail, skip: fx.skip }, dur: g ? +g.near[0].duration.toFixed(3) : 0 };
}"""

# A signature of each gun's near buffer: two guns must not share a voice.
SIGS = """(() => { const a = window.__game.app.match.audio, out = {};
  for (const id in window.__t.W) { const d = a.guns[id].near[0].getChannelData(0); let e = 0, z = 0; for (let i = 1; i < d.length; i++) { e += d[i] * d[i]; if ((d[i] > 0) !== (d[i - 1] > 0)) z++; }
    out[id] = [d.length, Math.round(e * 10), z]; } return out; })()"""

async def main():
    os.makedirs(SHOTS, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True, device_scale_factor=2)
            pg = await ctx.new_page()
            async def with_unknown(route):
                resp = await route.fetch()
                await route.fulfill(response=resp, body=(await resp.text()) + UNKNOWN)
            await pg.route('**/js/shared/weapons.js', with_unknown)
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
            await pg.goto(f'http://localhost:{PORT}/?debug=1')
            await pg.wait_for_timeout(800)
            await pg.evaluate("window.__game.Progress.name='Tester'")
            await pg.evaluate("window.__game.Progress.setFlag('tutorialOffered')")
            await pg.reload()
            await pg.wait_for_timeout(1200)
            await pg.locator('[data-act="range"]').first.click()
            await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=60000)
            await pg.evaluate("window.__game.app.match.renderer.setQuality('high')")
            await pg.evaluate(SETUP)
            await pg.wait_for_function('window.__game.app.match.audio.ready === true', timeout=120000)
            ids = await pg.evaluate('Object.keys(window.__t.W)')
            cats = await pg.evaluate('Object.fromEntries(Object.entries(window.__t.W).map(([k, w]) => [k, w.category || "-"]))')
            expl = await pg.evaluate('Object.fromEntries(Object.entries(window.__t.W).map(([k, w]) => [k, !!w.explosive || k === "launcher"]))')
            for _ in range(3): await pg.evaluate('window.__t.step()')
            print(f'{len(ids)} guns')
            for gid in ids:
                r = await pg.evaluate(FIRE, [gid, 14])
                n = r['n']
                line = f"{gid:11s} {r['cls']:9s} shots {n.get('shot', 0):2d} own {n.get('play:own', 0):2d} tail {n.get('play:tail', 0)} flash {n.get('flash', 0):2d} tracer {n.get('tracer', 0):2d} rocket {n.get('rocket', 0)} shell {n.get('shell', 0):2d} parts {n.get('part', 0):3d} shape {r['fx']['shape']:5s} near {r['dur']}s sup {r['sup']} peak {r['peak']}"
                print(line)
                bad = []
                if n.get('shot', 0) < 1: bad.append('never fired')
                if n.get('play:own', 0) < 1: bad.append('no own voice')
                if not r['voice']: bad.append('no near/tail buffers')
                if not r['foley']: bad.append('no reload foley')
                if r['fx']['shape'] != 'none' and n.get('flash', 0) < 1: bad.append('no muzzle flash')
                if expl[gid]:
                    if n.get('rocket', 0) < 1: bad.append('no projectile')
                elif r['fx']['tail'] > 0 and n.get('tracer', 0) < 1: bad.append('no tracer')
                elif r['fx']['tail'] <= 0 and n.get('tracer', 0) > 0: bad.append('a tracer from a gun that throws no round')
                if r['cls'] != 'Melee' and n.get('part', 0) < 1: bad.append('no particles')
                want = {'zzrifle': ('Assault', 'star'), 'zznocat': ('Sniper', 'cross'), 'zzlike': ('SMG', 'cross'), 'zzblade': ('Melee', 'none')}.get(gid)
                if want and (r['cls'], r['fx']['shape']) != want: bad.append(f"unknown gun resolved to {r['cls']}/{r['fx']['shape']}, wanted {want}")
                if bad: failures.append(f'{gid}: {", ".join(bad)}')
                # Let the pools drain so the next gun starts clean.
                for _ in range(4): await pg.evaluate('window.__t.step(0.1)')
            sigs = await pg.evaluate(SIGS)
            seen = {}
            for gid, s in sigs.items():
                k = tuple(s)
                if k in seen: failures.append(f'{gid} and {seen[k]} share a voice')
                seen[k] = gid
            print(f'distinct voices: {len(seen)} of {len(sigs)}')
            # The room (convolver impulse, weather loops) is applied when the map changes, never per frame.
            sets = await pg.evaluate('window.__t.themeSets')
            print('room applied', sets, 'times')
            if sets > 2: failures.append(f'audio room re-applied {sets} times in one match')

            # Reload stages, low ammo and dry fire, with the range's instant reload off.
            r = await pg.evaluate("""(async () => { const T = window.__t, m = window.__game.app.match; m.ps.instantReload = false;
              T.n = {}; T.arm('ar'); m.ps.ammo[0] = 4; m.ps.reserve[0] = 60; T.fire = true;
              for (let i = 0; i < 12; i++) { T.step(); await new Promise(r => setTimeout(r, 34)); }   // Last rounds in real time (the layer is rate-limited on the audio clock), then the automatic reload starts.
              const low = { ...T.n };
              for (let i = 0; i < 80; i++) T.step();                 // Through the reload (trigger still held).
              const reload = { ...T.n, ammo: m.ps.ammo[0] }; T.n = {}; T.fire = false;
              for (let i = 0; i < 6; i++) T.step();
              T.arm('ar'); m.ps.ammo[0] = 0; m.ps.reserve[0] = 0; m.ps.ammo[1] = 0; m.ps.reserve[1] = 0; T.n = {};
              for (let k = 0; k < 2; k++) { T.fire = true; for (let i = 0; i < 4; i++) T.step(); T.fire = false; for (let i = 0; i < 3; i++) T.step(); }
              const dry = { ...T.n }; m.ps.instantReload = true; T.arm('ar');
              return { low, reload, dry }; })()""")
            print('low ammo:', {k: v for k, v in r['low'].items() if k.startswith(('sfx:', 'shot', 'foley'))})
            print('reload:', {k: v for k, v in r['reload'].items() if k.startswith(('foley', 'ammo', 'sfx:dry'))})
            print('dry fire:', {k: v for k, v in r['dry'].items() if k.startswith(('sfx:', 'shot'))})
            if r['low'].get('sfx:lowAmmo', 0) < 3: failures.append('no low-ammo layer in the last rounds')
            if r['low'].get('sfx:empty', 0) < 1: failures.append('no bolt lock on the last round')
            for stage in ('out', 'in', 'rack'):
                if r['reload'].get(f'foley:{stage}', 0) < 1: failures.append(f'reload stage "{stage}" never played')
            if r['dry'].get('sfx:dry', 0) < 2: failures.append('no dry-fire click on an empty gun')

            # One gun per class, mid-shot: the whole screen and a close crop round the shooter.
            for cls, gid in CLASS_PICK.items():
                if gid not in ids: continue
                await pg.evaluate("""async id => { const T = window.__t; for (let i = 0; i < 6; i++) T.step(0.1); T.n = {}; T.arm(id); T.fire = true;
                  for (let i = 0; i < 40 && !(T.n.shot >= (id === 'ar' || id === 'smg' || id === 'lmg' ? 3 : 1)); i++) T.step(1 / 60); T.fire = false; }""", gid)
                await pg.wait_for_timeout(350)
                await pg.screenshot(path=f'{SHOTS}/{cls.lower()}-{gid}.png')
                await pg.screenshot(path=f'{SHOTS}/{cls.lower()}-{gid}-crop.png', clip={'x': 60, 'y': 70, 'width': 360, 'height': 240})
            await browser.close()
    finally:
        srv.terminate()
    if errors: failures.append(f'console errors: {errors[:6]}')
    print('\nFAIL\n' + '\n'.join(failures) if failures else '\nPASS')
    sys.exit(1 if failures else 0)

asyncio.run(main())
