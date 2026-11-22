#!/usr/bin/env python3
"""Perf overlay numbers in real matches (ROADMAP item 37): python3 dev/ui-sweep-perf.py [port] [outdir] [--root=DIR] [--q=low|high] [cases]

At 932x430 in headless Chromium (SwiftShader, so frame and script ms only compare runs on this machine; draw calls and
triangles are exact), with the perf overlay on (?fps=1). Cases: br (Quads on Frontier, after the jump, on the ground), brjade (the same on Jadefall), brcity (the same on Meridian City), brbay (the same on Kittiwake Bay), brsirocco (the same on Sirocco Basin), gwtide and gwcoral (Ground War on Jadefall's coast),
gw (Ground War TDM on Harvest), tdmlaunch, tdmobs, tdmpagoda (the 1120 6v6 maps), cpboss (campaign mission 8 at the
boss, from the Campaign tab), zm20 (Graveyard Shift round 20 on Ashgrove with every gate open, the horde full, traps
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
CASES = [('br', 'frontier', 'br'), ('brjade', 'jadefall', 'br'), ('brcity', 'meridian', 'br'), ('brsirocco', 'sirocco', 'br'), ('brbay', 'kittiwake', 'br'), ('gw', 'harvest', 'gwtdm'), ('gwtide', 'tidebreak', 'gwtdm'), ('gwcoral', 'coral', 'gwtdm'), ('zm20', 'ashgrove', 'zm'), ('zm20neon', 'neon', 'zm'), ('tdm', 'railyard', 'tdm'),
         # 1118 wave: Millbrook, Graveyard Shift round 20 on Polestar Relay, and a replay's playback (a TDM on Railyard,
         # ended after 20 s, Watch replay from the results: the replay player's own renderer and frame cost).
         ('tdmmill', 'millbrook', 'tdm'), ('zm20polestar', 'polestar', 'zm'), ('zm20wrenfield', 'wrenfield', 'zm'), ('replay', 'railyard', 'tdm'),
         # 1120 wave (bug sweep 2026-11-20): the three new 6v6 maps, and the campaign's mission 8 at the boss (Marshal
         # Kordell with his crest, beam and ring, his guard, the barrage rings), started from the Campaign tab.
         ('tdmlaunch', 'launchpad', 'tdm'), ('tdmobs', 'observatory', 'tdm'), ('tdmpagoda', 'pagoda', 'tdm'), ('cpboss', 'canyon', 'cp')]

OPEN_ALL = """(() => { const s = JSON.parse(localStorage.getItem('switchyard.save'));
  s.cp = { m1: [2, 1, 400], m2: [2, 0, 500], m3: [2, 0, 500], m4: [2, 0, 500], m5: [2, 0, 500], m6: [2, 0, 500], m7: [2, 0, 500] };
  localStorage.setItem('switchyard.save', JSON.stringify(s)); })()"""

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


async def settle_results(pg):
    """The results reel to its end (Skip), then the Unlocked summary it opens over the screen closed (Continue): that
    overlay carries its own Menu and Rematch and covers the results' buttons (bug sweep 2026-11-20)."""
    await pg.evaluate("document.querySelector('.res-skip:not([hidden])')?.click()")
    try: await pg.wait_for_function("!document.querySelector('.res-skip') || document.querySelector('.res-skip').hidden", timeout=60000)
    except Exception: pass
    await pg.wait_for_timeout(300)
    await pg.evaluate("document.querySelector('.overlay.show [data-act=\"uxDone\"]')?.click()")
    await pg.wait_for_timeout(300)


async def run(browser, name, mapId, mode, rows):
    ctx = await browser.new_context(viewport={'width': 932, 'height': 430}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    errors = []
    pg.on('console', lambda m: errors.append(m.text[:200]) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
    ev = pg.evaluate
    pg.set_default_timeout(90000)
    q = '' if mode == 'cp' else f'&map={mapId}&mode={mode}'
    await pg.goto(f'http://localhost:{PORT}/?debug=1&fps=1{q}', timeout=120000)
    await pg.wait_for_function('!!window.__game?.Progress', timeout=90000)
    await ev("window.__game.Progress.name='Perf'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
    if mode == 'cp': await ev(OPEN_ALL)
    await pg.reload()
    await pg.wait_for_function('!!window.__game?.Progress', timeout=90000)
    await pg.wait_for_timeout(1000)
    if mode == 'cp':
        for sel in ['[data-act="multiplayer"]', '[data-act="mpTab"][data-tab="campaign"]', '[data-act="cpPick"][data-k="7"]', '[data-act="cpBrief"]', '[data-act="cpSolo"]']:
            await pg.locator(sel).first.click()
            await pg.wait_for_timeout(700)
    else:
        await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_function(f'{G}.inMatch && {G}.match?.interp?.newest?.phase === "live"', timeout=90000)
    await ev(f"{G}.renderer?.setQuality?.('{Q}')")     # Pinned, as docs/BR-PERF.md measures (SwiftShader would drop auto to Potato).
    extra = ''
    if SUITS:
        extra = 'suits ' + str(await ev(f"""(() => {{ const c = {G}.renderer.chars, ops = {json.dumps(SUIT_OPS)};
          const ids = [...c.opById.keys()];
          c.setRoster(ids.map((id, i) => ({{ id, operator: ops[i % ops.length], skin: `skin:${{ops[i % ops.length]}}-5` }})));
          return ids.length; }})()"""))
    if name in ('br', 'brjade', 'brcity', 'brsirocco', 'brbay'):
        await pg.wait_for_function(f'{G}.match.interp.newest.br?.plane?.f > 0.25', timeout=180000)
        await pg.locator('.br-jump-map').first.click()
        await pg.wait_for_function(f'(() => {{ const p = {G}.match.interp.newest.players.find(q => q.id === {G}.match.localId); return p && !p.air; }})()', timeout=180000)
        await pg.wait_for_timeout(2000)
    if name == 'brcity':
        # The densest view in the city: Midtown's boulevard by Monument Plaza, towers and streets on every side.
        await ev(f"(() => {{ const m = {G}.match, me = m.sim.byId.get(m.localId); m.sim._placeAt(me, {{ x: 190, z: 200 }}, 0); }})()")
        await pg.wait_for_timeout(4000)
    if name == 'brbay':
        # The busiest view in the bay: the Shipyard's west yard, the dock, the gantries and the opened sheds round it.
        await ev(f"(() => {{ const m = {G}.match, me = m.sim.byId.get(m.localId); m.sim._placeAt(me, {{ x: 168, z: 176 }}, 0); }})()")
    if name == 'brsirocco':
        # The densest view in the basin: the Caravanserai's courtyard, the souk, the Souk Quarter and Lower Town round it.
        await ev(f"(() => {{ const m = {G}.match, me = m.sim.byId.get(m.localId); m.sim._placeAt(me, {{ x: 194, z: 196 }}, 0); }})()")
        await pg.wait_for_timeout(4000)
    if name == 'cpboss':
        R = f'{G}.match.sim.rules'
        await pg.wait_for_function(f'{R}?.state === 1', timeout=90000)
        for _ in range(8):
            if await ev(f'{R}.cur?.type') == 'boss': break
            await ev(f'{R}._complete()')
            await pg.wait_for_timeout(400)
        await pg.wait_for_function(f'!!{R}.boss', timeout=30000)
        # In the yard with him, unhurt; he keeps his barrage going.
        await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, b = R.boss.p, me = m.sim.byId.get(m.localId);
          m.sim._placeAt(me, {{ x: b.ps.x - 8, z: b.ps.z }}, 0); window.__keep = setInterval(() => {{ me.hp = 100; me.spawnProtect = 1e9; for (const p of m.sim.players) if (p.team === me.team) {{ p.hp = 100; p.downed = false; }} }}, 300); }})()""")
        extra = f"guard {await ev(f'{R}.boss.g.members.length + {R}.groups.reduce((n, g) => n + g.members.filter(p => p.alive).length, 0)')}"
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
        await settle_results(pg)
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
