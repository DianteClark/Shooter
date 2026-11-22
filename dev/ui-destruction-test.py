#!/usr/bin/env python3
"""Destruction in a real browser (docs/DESTRUCTION.md): python3 dev/ui-destruction-test.py <port> [outdir] [map]

Serves the repo itself on <port> (10000-10099 on the shared box). A fresh save, Custom > Match (TDM) on Riverbend (or
[map]), every bot held still. The local player is put beside a breakable wall and, separately, a shed; a strike-class
explosion goes off at each:
  - before / after screenshots (outdir/NN-*.png) of each piece going down;
  - the piece's wall stops blocking (or becomes its rubble pile), the guest-visible break string (view.brk) has it;
  - the renderer's draw calls do not grow with breaks (no per-piece meshes), the world's triangle count is unchanged
    (ranges are rewritten in place) and the fog's vision-wall list shrank;
  - the minimap redrew its wall layer (mmVer follows map.brkVer);
  - a frag next to a crate breaks it through the normal grenade path (throw -> bang -> brk event);
  - frame time over 3 s with debris in the air, against 3 s before (SwiftShader: compared, not absolute).
Fails on any console error.
"""
import asyncio, subprocess, sys, os, time, json
from playwright.async_api import async_playwright

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 10042
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/destruction'
MAP = sys.argv[3] if len(sys.argv) > 3 else 'riverbend'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
G = 'window.__game.app'

fails = []
def check(name, ok, info=''):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'' if ok else f' :: {info}'}", flush=True)
    if not ok: fails.append(name)

HOLD = """(() => { const sim = window.__game.app.match.sim;
  for (const p of sim.players) if (p.bot) { p.bot.update = () => []; p.spawnProtect = 0; }
  // Bots parked in a far corner so nothing walks into the shots.
  sim.players.forEach((p, i) => { if (p.bot) { p.ps.x = 2 + (i % 3); p.ps.z = 2 + Math.floor(i / 3) % 3; } });
})()"""

# Picks a piece: the first of `mats` with (pile=true) or without a rubble pile, away from spawns, returns its info.
PICK = """(([mats, pile]) => { const map = window.__game.app.match.sim.map;
  const ok = map.breakables.filter(p => mats.includes(p.mat) && !!p.pile === pile && p.wall._brk !== 2 && p.wall.blocksVision);
  ok.sort((a, b) => b.w * b.d - a.w * a.d);
  const p = ok[0]; if (!p) return null;
  return { id: p.id, x: p.x, z: p.z, w: p.w, d: p.d, mat: p.mat, pile: !!p.pile, kind: p.wall.kind };
})"""

# Stands the local player south of the piece (or north if south is blocked), looking at it.
PLACE = """((p) => { const app = window.__game.app, ps = app.match.ps, sim = app.match.sim;
  const cx = p.x + p.w / 2, cz = p.z + p.d / 2;
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const x = cx + dx * (p.w / 2 + 3.5), z = cz + dz * (p.d / 2 + 3.5);
    if (sim.nav && !sim.nav.isWalkable(x, z)) continue;
    ps.x = x; ps.z = z; ps.aim = Math.atan2(cz - z, cx - x); return [x, z];
  }
  ps.x = cx; ps.z = cz + p.d / 2 + 5; return [ps.x, ps.z];
})"""

BOOM = """((p) => { const sim = window.__game.app.match.sim, cx = p.x + p.w / 2, cz = p.z + p.d / 2;
  sim._emit({ t: 'explosion', x: cx, z: cz, radius: 5.2, by: 'local', k: 'strike' });
  return sim.brk.stage[p.id]; })"""

STATS = """(() => { const app = window.__game.app, r = app.renderer, m = app.match.sim.map;
  return { calls: r.frameStats.calls, tris: r.world.tris, fog: r.fog.walls.length, ver: m.brkVer,
    mm: window.__game.hud?.mmVer ?? null, brk: app.match.interp.newest?.brk ?? null }; })()"""


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    errors = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True)
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
            ev = pg.evaluate

            async def tap(sel, wait=300):
                try: await pg.locator(sel).first.click(timeout=6000)
                except Exception: await ev(f"document.querySelector({sel!r})?.click()")
                await pg.wait_for_timeout(wait)

            async def frames(seconds):
                return await ev("""(s) => new Promise(res => { const t = []; let last = performance.now(); const end = last + s * 1000;
                  const f = () => { const n = performance.now(); t.push(n - last); last = n; if (n < end) requestAnimationFrame(f); else { t.sort((a, b) => a - b); res({ n: t.length, med: t[t.length >> 1], p95: t[Math.floor(t.length * 0.95)] }); } };
                  requestAnimationFrame(f); })""", seconds)

            await pg.goto(f'http://localhost:{PORT}/?debug=1&bots=easy')
            await pg.wait_for_function('!!window.__game?.Progress', timeout=40000)
            await ev("window.__game.Progress.name='Breaker'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
            await pg.reload()
            await pg.wait_for_function('!!window.__game?.Progress', timeout=40000)
            await pg.wait_for_timeout(1500)
            print(f'match on {MAP}', flush=True)
            await tap('[data-act="custom"]', 700)
            await tap(f'[data-act="soloMap"][data-id="{MAP}"]')
            await tap('[data-act="soloMode"][data-id="tdm"]')
            await tap('[data-act="soloStart"]', 300)
            await pg.wait_for_function(f'{G}.inMatch && {G}.match?.interp.newest?.phase === "live" && {G}.match.localAlive', timeout=60000)
            await ev(HOLD)
            await pg.wait_for_timeout(800)
            n = await ev(f"{G}.match.sim.map.breakables.length")
            check('the map has breakable pieces', n > 0, n)
            quiet = await frames(3)
            # A blast in the open first, away from every piece: its fireball, smoke and shard pool are the explosion's
            # own draws, so the per-break comparison below starts from a frame that already has them.
            await ev("""(() => { const sim = window.__game.app.match.sim, ps = window.__game.app.match.ps;
              sim.events.push({ t: 'explosion', x: ps.x + 3, z: ps.z, radius: 5.2, by: 'local' }); })()""")
            await pg.wait_for_timeout(300)
            base = await ev(STATS)
            print('  stats before', base, 'frames', quiet, flush=True)

            shot_i = 1
            for label, mats, pile in [('wall', ['light', 'heavy'], False), ('shed', ['light', 'heavy'], True)]:
                piece = await ev(PICK, [mats, pile])
                if not piece:
                    print(f'  (no {label} on {MAP})'); continue
                print(f'{label}: piece {piece}', flush=True)
                await ev(PLACE, piece)
                await pg.wait_for_timeout(1400)
                await pg.screenshot(path=f'{OUT}/{shot_i:02d}-{label}-before.png'); shot_i += 1
                st = await ev(BOOM, piece)
                await pg.wait_for_timeout(260)
                await pg.screenshot(path=f'{OUT}/{shot_i:02d}-{label}-breaking.png'); shot_i += 1
                busy = await frames(3)
                await pg.screenshot(path=f'{OUT}/{shot_i:02d}-{label}-after.png'); shot_i += 1
                check(f'the {label} broke', st == 2, st)
                w = await ev(f"(() => {{ const p = {G}.match.sim.map.breakables[{piece['id']}], w = p.wall; return [w.blocksMove, w.blocksVision, w.w * w.d, p.w * p.d]; }})()")
                if pile: check(f'the {label} left a waist-high rubble pile', w[0] and not w[1] and w[2] < w[3], w)
                else: check(f'the {label} stopped blocking', not w[0] and not w[1], w)
                s = await ev(STATS)
                print('  stats after', s, 'frames', busy, flush=True)
                check(f'{label}: no draw call per break', s['calls'] <= base['calls'] + 2, (base['calls'], s['calls']))
                check(f'{label}: world triangles unchanged (ranges rewritten in place)', s['tris'] == base['tris'], (base['tris'], s['tris']))
                check(f'{label}: the fog lost the vision wall', s['fog'] < base['fog'], (base['fog'], s['fog']))
                check(f'{label}: the minimap redrew', s['mm'] == s['ver'], (s['mm'], s['ver']))
                check(f'{label}: the view carries the break string', bool(s['brk']), s['brk'])
                check(f'{label}: frame time with debris within 2x of quiet', busy['med'] <= max(quiet['med'] * 2, quiet['med'] + 12), (quiet, busy))
                base = s

            # A frag through the real grenade path: thrown at a crate from beside it.
            crate = await ev(PICK, [['wood'], False]) or await ev("""(() => { const map = window.__game.app.match.sim.map;
              const p = map.breakables.find(q => q.mat === 'wood' && q.wall._brk !== 2); return p && { id: p.id, x: p.x, z: p.z, w: p.w, d: p.d }; })()""")
            if crate:
                await ev(PLACE, crate)
                await pg.wait_for_timeout(500)
                got = await ev("""((p) => new Promise(res => { const app = window.__game.app, sim = app.match.sim, me = sim.byId.get('local');
                  me.ps.lethal = 'frag'; me.ps.lethalLeft = 2;
                  const cx = p.x + p.w / 2, cz = p.z + p.d / 2;
                  sim.applyCommand('local', { cmd: 'throw', slot: 'lethal', ox: me.ps.x, oz: me.ps.z, aim: Math.atan2(cz - me.ps.z, cx - me.ps.x), dist: Math.hypot(cx - me.ps.x, cz - me.ps.z) });
                  const t0 = performance.now(); const poll = () => { if (sim.brk.stage[p.id] > 0 || performance.now() - t0 > 6000) res(sim.brk.stage[p.id]); else setTimeout(poll, 100); }; poll(); }))""", crate)
                await pg.wait_for_timeout(400)
                await pg.screenshot(path=f'{OUT}/{shot_i:02d}-frag-crate.png'); shot_i += 1
                check('a thrown frag broke the crate', got >= 1, got)

            # The minimap after the breaks.
            await pg.locator('.minimap').first.screenshot(path=f'{OUT}/{shot_i:02d}-minimap.png')
            await browser.close()
    finally:
        srv.terminate()
    real = [e for e in errors if 'favicon' not in e]
    check('no console errors', not real, real[:5])
    print('FAILED: ' + ', '.join(fails) if fails else 'all passed')
    sys.exit(1 if fails else 0)

asyncio.run(main())
