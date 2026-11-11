#!/usr/bin/env python3
"""Weapon feel performance probe: a 16 v 16 Ground War bot match at 852x393 in headless Chromium, stepped by hand
at a fixed 30 Hz with a seeded Math.random, on Low and High. Prints draw calls and frame time (JS + gl.finish).

  python3 dev/wpn-feel-perf.py [port] [root dir] [frames]      (default 8206, this checkout, 900; a 4th argument picks the steps: low,high)

Point `root dir` at another checkout (git worktree add /tmp/before <commit>) for the before numbers. Software
rendering is slow and noisy (whole-frame time moves 30% between identical runs): read feelMs (time inside the effect,
audio and HUD event paths per frame), the pool counts (instances drawn) and the draw calls, which are steady.
"""
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8206
ROOT = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRAMES = int(sys.argv[3]) if len(sys.argv) > 3 else 900
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--autoplay-policy=no-user-gesture-required']
SEED = """(() => { let s = 0x2545f491; Math.random = () => { s |= 0; s = s + 0x6d2b79f5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })()"""

SETUP = """(async q => {
  const st = window.setTimeout, ch = new MessageChannel(), jobs = [];
  ch.port1.onmessage = () => jobs.shift()();
  window.setTimeout = (f, d, ...a) => d ? st(f, d, ...a) : (jobs.push(f), ch.port2.postMessage(0), 0);
  const m = window.__game.app.match;
  m.renderer.setQuality(q);
  m.audio.unlock();
  m.running = false;
  const T = window.__p = { shots: 0 };
  const onEv = m.audio.onEvents.bind(m.audio);
  m.audio.onEvents = (ev, view) => { for (const e of ev) if (e.t === 'shot') T.shots++; return onEv(ev, view); };
  const read = m.controls.read.bind(m.controls);
  m.controls.read = () => { const r = read(); r.fire = true; r.aiming = true; return r; };     // The local gun never stops.
  // Time spent inside the weapon-feel code paths alone: far steadier than whole-frame time under a software renderer.
  T.ms = {};
  const time = (o, name, key) => { if (!o || typeof o[name] !== 'function') return; const f = o[name].bind(o); T.ms[key] = 0;
    o[name] = (...a) => { const t = performance.now(); try { return f(...a); } finally { T.ms[key] += performance.now() - t; } }; };
  const R = m.renderer, v = R.vfx;
  time(v, 'step', 'vfxStep'); time(R, '_onShot', 'onShot'); time(m.audio, 'onEvents', 'audioEvents'); time(m.audio, 'update', 'audioUpdate'); time(m.hud, 'onEvents', 'hudEvents');
  T.pools = () => [v.flashMesh.count, v.tracerGeom.instanceCount, v.partGeom.instanceCount, v.shellMesh.count, v.markGeom.instanceCount];
  T.step = () => { m.running = true; m.lastTime = performance.now() - 1000 / 30; m.frame(); m.running = false; };
})"""

RUN = """async ([warm, n]) => {
  const T = window.__p, m = window.__game.app.match, R = m.renderer, gl = R.webgl.getContext();
  for (let i = 0; i < warm; i++) { T.step(); if (i % 30 === 0) await new Promise(r => requestAnimationFrame(r)); }
  T.shots = 0; for (const k in T.ms) T.ms[k] = 0;
  const pool = [0, 0, 0, 0, 0], peak = [0, 0, 0, 0, 0];
  const js = [], all = []; let calls = 0, maxCalls = 0, tris = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now(); T.step(); const t1 = performance.now(); gl.finish(); const t2 = performance.now();
    js.push(t1 - t0); all.push(t2 - t0);
    const pc = T.pools(); for (let k = 0; k < 5; k++) { pool[k] += pc[k]; if (pc[k] > peak[k]) peak[k] = pc[k]; }
    const c = R.frameStats.calls; calls += c; if (c > maxCalls) maxCalls = c; tris += R.frameStats.triangles;
    if (i % 30 === 0) await new Promise(r => requestAnimationFrame(r));
  }
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return +s[Math.floor(p * (s.length - 1))].toFixed(2); };
  const mean = a => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
  const feel = {}; let feelSum = 0; for (const k in T.ms) { feel[k] = +(T.ms[k] / n).toFixed(3); feelSum += T.ms[k] / n; }
  return { feelMs: +feelSum.toFixed(3), feel, pools: 'flash/tracer/part/shell/mark mean ' + pool.map(x => (x / n).toFixed(1)).join(' ') + ' peak ' + peak.join(' '), calls: +(calls / n).toFixed(1), maxCalls, tris: Math.round(tris / n), shots: T.shots, players: m.interp.newest.players.length,
    jsMean: mean(js), jsMed: q(js, 0.5), jsP95: q(js, 0.95), frameMean: mean(all), frameMed: q(all, 0.5), frameP95: q(all, 0.95) };
}"""

async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    errors = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for q in (sys.argv[4].split(',') if len(sys.argv) > 4 else ('low', 'high')):
                ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True, device_scale_factor=2)
                await ctx.add_init_script(SEED)
                pg = await ctx.new_page()
                pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
                url = f'http://localhost:{PORT}/?debug=1&map=downtown&mode=gwtdm&time=9999&limit=9999'
                await pg.goto(url)
                await pg.wait_for_timeout(800)
                await pg.evaluate("window.__game.Progress.name='Tester'")
                await pg.evaluate("window.__game.Progress.setFlag('tutorialOffered')")
                await pg.reload()
                await pg.wait_for_timeout(1200)
                await pg.locator('[data-act="custom"]').first.click()
                await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=90000)
                await pg.evaluate(SETUP + f"('{q}')")
                await pg.wait_for_function('window.__game.app.match.audio.ready === true', timeout=180000)
                r = await pg.evaluate(RUN, [300, FRAMES])
                print(q, json.dumps(r), flush=True)
                await ctx.close()
            await browser.close()
    finally:
        srv.terminate()
    if errors: print('console errors:', errors[:6])

asyncio.run(main())
