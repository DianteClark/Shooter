#!/usr/bin/env python3
"""Perf overlay numbers in real matches (ROADMAP item 37): python3 dev/ui-sweep-perf.py [port] [outdir] [--root=DIR] [--q=low|high] [cases]

At 932x430 in headless Chromium (SwiftShader, so frame and script ms only compare runs on this machine; draw calls and
triangles are exact), with the perf overlay on (?fps=1). Cases: br (Quads on Frontier, after the jump, on the ground), brjade (the same on Jadefall), gwtide and gwcoral (Ground War on Jadefall's coast),
gw (Ground War TDM on Harvest), zm20 (Graveyard Shift round 20 on Ashgrove with every gate open, the horde full, traps
on and sentries out, as dev/sim-zombies.mjs's perf section), tdm (Railyard, for scale). Prints the median and worst of
calls, triangles and script ms over 12 s, and a screenshot of each with the overlay. --root serves another checkout
(an older build) for a before/after. --suits dresses everyone in the match in a Mastery suit, twelve different operators
round the roster (docs/OPERATORS-ART.md: the suit banks' cost; for twelve suits on screen at once use
dev/ops-lineup.html?view=game&skin=5&bench=40).
"""
import asyncio, subprocess, sys, time, os, json, re, statistics
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
argv = [a for a in sys.argv[1:] if not a.startswith('--')]
for a in sys.argv[1:]:
    if a.startswith('--root='): ROOT = a[7:]
PORT = int(argv[0]) if argv and argv[0].isdigit() else 8395
OUT = argv[1] if len(argv) > 1 else '/tmp/sweep-perf'
ONLY = argv[2:]
Q = next((a[4:] for a in sys.argv[1:] if a.startswith('--q=')), 'low')
SUITS = '--suits' in sys.argv[1:]
SUIT_OPS = ['trooper', 'ronin', 'monarch', 'coyote', 'ox', 'harrow', 'flint', 'nyx', 'tinker', 'mako', 'skylark', 'brigid']
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
G = 'window.__game.app'
CASES = [('br', 'frontier', 'br'), ('brjade', 'jadefall', 'br'), ('gw', 'harvest', 'gwtdm'), ('gwtide', 'tidebreak', 'gwtdm'), ('gwcoral', 'coral', 'gwtdm'), ('zm20', 'ashgrove', 'zm'), ('zm20neon', 'neon', 'zm'), ('tdm', 'railyard', 'tdm'),
         # 1118 wave: Millbrook, Graveyard Shift round 20 on Polestar Relay, and a replay's playback (a TDM on Railyard,
         # ended after 20 s, Watch replay from the results: the replay player's own renderer and frame cost).
         ('tdmmill', 'millbrook', 'tdm'), ('zm20polestar', 'polestar', 'zm'), ('zm20wrenfield', 'wrenfield', 'zm'), ('replay', 'railyard', 'tdm')]

ZM20 = f"""(async () => {{
  const m = {G}.match, sim = m.sim, R = sim.rules;
  const Z = await import('/js/shared/zombies.js');
  for (const d of R.L.doors) R.open |= 1 << d.i;
  Z.syncZmDoors(sim.map, R.open);
  for (const d of R.L.doors) Z.reblockNav(sim.nav, sim.map, d);
  if ('power' in R) R.power = 1;
  for (const p of R.crew) p.spawnProtect = 1e9;
  R._startRound(20); R.spawnT = 0;
  for (let k = 0; k < 200 && R.horde.some(p => !p.alive); k++) {{ R.spawnT = 0; R._stepSpawns(1 / 30); }}
  try {{ R.econ.traps.forEach(t => {{ t.state = 1; t.timer = 999; }}); R.crew.slice(0, 2).forEach(p => {{ R.econ._supply(p, 'sentry'); R.econ._supply(p, 'drone'); }}); }} catch (e) {{ console.warn('econ', e); }}
  window.__keep = setInterval(() => {{ for (const z of R.horde) if (!z.alive) {{ R.spawnT = 0; R._stepSpawns(1 / 30); }} for (const p of R.crew) p.spawnProtect = 1e9; }}, 500);
  // The local player in the thick of it: the middle of the map.
  const me = sim.byId.get(m.localId); const k = sim.nav.nearestFree(sim.map.width / 2, sim.map.height / 2);
  m.ps.x = k % sim.nav.w + 0.5; m.ps.z = Math.floor(k / sim.nav.w) + 0.5;
  return R.horde.filter(p => p.alive).length;
}})()"""


async def run(browser, name, mapId, mode, rows):
    ctx = await browser.new_context(viewport={'width': 932, 'height': 430}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    errors = []
    pg.on('console', lambda m: errors.append(m.text[:200]) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
    ev = pg.evaluate
    await pg.goto(f'http://localhost:{PORT}/?debug=1&fps=1&map={mapId}&mode={mode}')
    await pg.wait_for_function('!!window.__game?.Progress', timeout=30000)
    await ev("window.__game.Progress.name='Perf'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
    await pg.reload()
    await pg.wait_for_function('!!window.__game?.Progress', timeout=30000)
    await pg.wait_for_timeout(1000)
    await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_function(f'{G}.inMatch && {G}.match?.interp?.newest?.phase === "live"', timeout=90000)
    await ev(f"{G}.renderer?.setQuality?.('{Q}')")     # Pinned, as docs/BR-PERF.md measures (SwiftShader would drop auto to Potato).
    extra = ''
    if SUITS:
        extra = 'suits ' + str(await ev(f"""(() => {{ const c = {G}.renderer.chars, ops = {json.dumps(SUIT_OPS)};
          const ids = [...c.opById.keys()];
          c.setRoster(ids.map((id, i) => ({{ id, operator: ops[i % ops.length], skin: `skin:${{ops[i % ops.length]}}-5` }})));
          return ids.length; }})()"""))
    if name in ('br', 'brjade'):
        await pg.wait_for_function(f'{G}.match.interp.newest.br?.plane?.f > 0.25', timeout=60000)
        await pg.locator('.br-jump-map').first.click()
        await pg.wait_for_function(f'(() => {{ const p = {G}.match.interp.newest.players.find(q => q.id === {G}.match.localId); return p && !p.air; }})()', timeout=60000)
        await pg.wait_for_timeout(2000)
    if name.startswith('zm20'):
        extra = f'horde {await ev(ZM20)}'
        # Round 20 is a boss round: let the boss's intro (camera beat, title card) start, then end it, so the numbers
        # are the horde's steady state (builds before item 50 have no intro).
        await pg.wait_for_timeout(1500)
        await ev("import('/js/ui/zm-intro.js').then(m => m.ZM_INTRO.reset()).catch(() => 0)")
    stats_js = f"(() => {{ const s = {G}.renderer?.getStats(); return s ? {{ calls: s.calls, tris: s.triangles }} : null; }})()"
    if name == 'replay':
        await pg.wait_for_timeout(20000)
        await ev(f"(() => {{ const m = {G}.match, s = m.sim, me = s.byId.get(m.localId); if (s.phase !== 'ended') s._end(me.team); }})()")
        await pg.wait_for_selector('.menu[data-screen="results"] .rs', timeout=120000)
        await pg.wait_for_timeout(2000)
        await pg.locator('[data-act="resReplay"]').first.click()
        await pg.wait_for_timeout(2000)
        stats_js = "(() => { const v = window.__game.replay(), s = v?.renderer?.renderer?.info?.render ?? null; const g = v?.renderer?.getStats?.(); return g ? { calls: g.calls, tris: g.triangles } : s ? { calls: s.calls, tris: s.triangles } : null; })()"
        extra = 'playback'
    await pg.wait_for_timeout(3000)
    calls, tris, script, frame, lines = [], [], [], [], None
    for i in range(24):
        await pg.wait_for_timeout(500)
        st = await ev(stats_js)
        txt = await ev("[...document.querySelectorAll('.perf > div')].map(n => n.textContent)")
        if st: calls.append(st['calls']); tris.append(st['tris'])
        m = re.search(r'script ([\d.]+) ms', txt[1] if len(txt) > 1 else '')
        if m: script.append(float(m.group(1)))
        m = re.search(r'([\d.]+) ms', txt[0] if txt else '')
        if m: frame.append(float(m.group(1)))
        lines = txt
        if i == 12: await pg.screenshot(path=f'{OUT}/{name}-932x430.png')
    med = lambda a: round(statistics.median(a), 1) if a else None
    row = {'case': name, 'map': mapId, 'mode': mode, 'calls': med(calls), 'calls_max': max(calls) if calls else None,
           'tris_k': round(med(tris) / 1000, 1) if tris else None, 'tris_max_k': round(max(tris) / 1000, 1) if tris else None,
           'script_ms': med(script), 'script_max': max(script) if script else None, 'frame_ms': med(frame), 'overlay': lines, 'extra': extra,
           'errors': errors[:5]}
    if name == 'replay':
        rs = await ev("(() => { const s = window.__game.replay()?.stats; return s ? { frames: s.frames, mean_ms: +(s.totalMs / Math.max(1, s.frames)).toFixed(1), render_ms: +(s.renderMs / Math.max(1, s.frames)).toFixed(1), max_ms: +s.maxMs.toFixed(1) } : null; })()")
        row['extra'] = f'playback {rs}'
    print(json.dumps(row), flush=True)
    rows.append(row)
    await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    rows = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for name, mapId, mode in CASES:
                if ONLY and name not in ONLY: continue
                try: await run(browser, name, mapId, mode, rows)
                except Exception as e: print(f'FAIL {name}: {str(e)[:300]}', flush=True)
            await browser.close()
    finally:
        srv.terminate()
    with open(f'{OUT}/perf.json', 'w') as f: json.dump(rows, f, indent=1)


asyncio.run(main())
