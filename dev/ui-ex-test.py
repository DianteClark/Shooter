#!/usr/bin/env python3
"""Extraction end to end in a real browser (docs/EXTRACT.md): python3 dev/ui-ex-test.py [port] [outdir]

Serves the repo, opens Multiplayer, the Extraction tab, Quads, Find match, rides the search and the vote into a match
on Frontier, opens the full map, takes a contract at a phone, does it (the local player is moved to the objective; a
commander is shot on the host), waits for the first exfil window (the match clock is wound forward on the host), calls
the helicopter, holds the zone, gets lifted out and checks the extraction results screen. Screenshots at 852x393 and
667x375 go to outdir (default /tmp/exfil). Fails on any console error, and on HUD panels that spill off the screen.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8361
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/exfil'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game.app'

# Elements that must sit inside the viewport when shown.
OVERFLOW = """((sels) => {
  const W = innerWidth, H = innerHeight, bad = [];
  for (const s of sels) for (const n of document.querySelectorAll(s)) {
    if (n.hidden || n.closest('[hidden]') || getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden') continue;
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) bad.push(`${s} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.right)}x${Math.round(r.bottom)}`);
  }
  return bad;
})"""


async def check_fit(pg, sels, tag, failures):
    bad = await pg.evaluate(f"{OVERFLOW}({sels!r})")
    for b in bad: failures.append(f'{tag}: off screen: {b}')


async def run(browser, vw, vh, failures, errors):
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'{vw}: PAGEERR {e} {getattr(e, "stack", "")}'))
    async def shot(name):
        print(f'  {vw}x{vh} {name}', flush=True)
        await pg.screenshot(path=f'{OUT}/{name}-{vw}x{vh}.png')
    ev = lambda js: pg.evaluate(js)
    tag = f'{vw}x{vh}'
    await pg.goto(f'http://localhost:{PORT}/?debug=1&vote=2&search=600')
    await pg.wait_for_timeout(900)
    await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="multiplayer"]').first.click()
    await pg.wait_for_timeout(600)
    await pg.locator('[data-act="mpTab"][data-tab="extraction"]').first.click()
    await pg.wait_for_timeout(500)
    await pg.locator('[data-act="mpPlaylist"][data-id="exquads"]').first.click()
    await pg.wait_for_timeout(300)
    await shot('01-multiplayer')
    await check_fit(pg, ['.mp-pl', '.mp-find', '.mp-tabs'], f'{tag} multiplayer', failures)
    await pg.locator('[data-act="mpFind"]').first.click()
    await pg.wait_for_timeout(1300)
    await shot('02-vote')
    await pg.wait_for_function(f'{G}.match?.interp.newest?.obj?.ex || {G}.match?.interp.newest?.points?.obj?.ex', timeout=40000)
    mode = await ev(f'{G}.match.mode')
    if mode != 'exq': failures.append(f'{tag}: match mode {mode}')
    await pg.wait_for_function(f'{G}.match.interp.newest.phase === "live"', timeout=30000)
    await pg.wait_for_timeout(1500)
    # Shield the local squad so a stray fight cannot end the run; the AI and other squads leave a shielded player be.
    await ev(f"""(() => {{ const sim = {G}.match.sim, me = sim.byId.get({G}.match.localId);
      window.__shield = setInterval(() => {{ for (const p of sim.players) if (p.team === me.team) p.spawnProtect = 99; }}, 200); }})()""")
    await shot('03-insertion')
    await check_fit(pg, ['.ex-top', '.ex-con', '.ex-squad', '.minimap'], f'{tag} hud', failures)
    con = await ev(f"!document.querySelector('.ex-con').hidden && document.querySelector('.ex-con b').textContent")
    if not con: failures.append(f'{tag}: no contract card at the start')
    # The full map from the minimap.
    await pg.locator('.minimap').first.click()
    await pg.wait_for_timeout(500)
    await shot('04-map')
    await check_fit(pg, ['.ex-map-frame', '.ex-map-side'], f'{tag} map', failures)
    await pg.locator('.ex-map-close').first.click()
    await pg.wait_for_timeout(300)
    # A phone: walk (teleport) to one, open the offers, take the second.
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, me = m.sim.byId.get(m.localId);
      const ph = R.phones.slice().sort((a, b) => Math.hypot(a.x - me.ps.x, a.z - me.ps.z) - Math.hypot(b.x - me.ps.x, b.z - me.ps.z))[0];
      m.ps.x = ph.x; m.ps.z = ph.z + 1; }})()""")
    await pg.wait_for_selector('.ex-phone:not([hidden])', timeout=8000)
    await pg.wait_for_timeout(300)
    await shot('05-phone')
    await pg.locator('.ex-phone').first.click()
    await pg.wait_for_timeout(400)
    await shot('06-offers')
    await check_fit(pg, ['.ex-offer', '.ex-offers h3', '.ex-offers .close'], f'{tag} offers', failures)
    before = await ev(f"{G}.match.sim.rules.squads.get({G}.match.sim.byId.get({G}.match.localId).team).taken")
    await pg.locator('.ex-offer[data-k="1"]').first.click()
    await pg.wait_for_timeout(500)
    after = await ev(f"{G}.match.sim.rules.squads.get({G}.match.sim.byId.get({G}.match.localId).team).taken")
    if after != before + 1: failures.append(f'{tag}: taking a contract at the phone did nothing ({before} -> {after})')
    # Do it: stand where it wants us (the case, then the drop; beside the mule; on the cache or terminal), commander shot.
    ctype = await ev(f"{G}.match.sim.rules.squads.get({G}.match.sim.byId.get({G}.match.localId).team).contract.type")
    done = await ev(f"""(async () => {{
      const m = {G}.match, R = m.sim.rules, me = m.sim.byId.get(m.localId), s = R.squads.get(me.team), c = s.contract, n0 = s.pot.length;
      for (let i = 0; i < 900 && s.pot.length === n0; i++) {{
        for (const q of m.sim.players) if (q.ai && q.alive && Math.hypot(q.ps.x - me.ps.x, q.ps.z - me.ps.z) < 40 && !q.exCommander) {{ q.alive = false; q.hp = 0; q.exGroup = null; }}
        let tx = c.x, tz = c.z;
        if (c.type === 'intel' && c.carrier >= 0) {{ tx = c.dx; tz = c.dz; }}
        if (c.type === 'escort') tx += 2;
        if (c.type === 'hvt') {{
          const g = R.groups.find(x => x.id === c.group); tx = c.x + 25;
          if (g.state === 'asleep') R._wake(g);
          const boss = g.members.find(q => q.exCommander);
          if (boss?.alive) m.sim._damage(boss, me, 60, me.ps.weapon, 10);
        }}
        m.ps.x = tx; m.ps.z = tz; m.ps.vx = 0; m.ps.vz = 0;
        if (i === 30) window.__mid = true;
        await new Promise(r => setTimeout(r, 120));
      }}
      return s.pot.length > n0;
    }})()""")
    if not done: failures.append(f'{tag}: the {ctype} contract did not complete')
    await pg.wait_for_timeout(500)
    await shot('07-contract-done')
    pot = await ev(f"document.querySelector('.ex-pot b').textContent")
    if pot.strip() in ('', '0'): failures.append(f'{tag}: the pot chip shows {pot!r} after a contract')
    # Wind the clock to the first exfil window, go to an open site and call it.
    await ev(f"""(() => {{ const R = {G}.match.sim.rules; R.t = Math.max(R.t, 211); R._stepWindows(); }})()""")
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, e = R.exfils.find(x => x.state === 1); m.ps.x = e.x; m.ps.z = e.z; window.__site = e.i;
      for (const q of m.sim.players) if (!q.ai && q.team !== m.sim.byId.get(m.localId).team) {{ q.ps.x = 5 + q.index; q.ps.z = 5; }} }})()""")
    await pg.wait_for_selector('.ex-call:not([hidden])', timeout=8000)
    await pg.wait_for_timeout(300)
    await shot('08-exfil-zone')
    await check_fit(pg, ['.ex-call', '.ex-top', '.ex-tag:not([hidden])'], f'{tag} exfil', failures)
    await pg.locator('.ex-call').first.click()
    await pg.wait_for_timeout(600)
    state = await ev(f"{G}.match.sim.rules.exfils[window.__site].state")
    if state != 2: failures.append(f'{tag}: calling the exfil left the site in state {state}')
    await shot('09-inbound')
    # Bring it in (the flight is the wait), keep the zone clear, hold it, get lifted.
    await ev(f"""(() => {{ const R = {G}.match.sim.rules; R.exfils[window.__site].timer = 0.3; }})()""")
    await ev(f"""(() => {{ const m = {G}.match; window.__clear = setInterval(() => {{ for (const q of m.sim.players) if (q.ai && q.alive) {{ q.alive = false; q.hp = 0; q.exGroup = null; }} }}, 150); }})()""")
    # Software rendering runs the sim slower than real time: the hold is wound on too.
    try: await pg.wait_for_function(f"{G}.match.sim.rules.exfils[window.__site].state === 3", timeout=30000)
    except Exception:
        print('  debug', await ev(f"JSON.stringify({{site: window.__site, e: {G}.match.sim.rules.exfils[window.__site], t: {G}.match.sim.rules.t, phase: {G}.match.sim.phase, time: {G}.match.sim.time}})"))
        raise
    await pg.wait_for_timeout(2500)
    await shot('10-holding')
    await ev(f"(() => {{ const e = {G}.match.sim.rules.exfils[window.__site]; if (e.holder >= 0) e.hold = Math.max(e.hold, 8.5); }})()")
    await check_fit(pg, ['.ex-hold', '.ex-top'], f'{tag} hold', failures)
    await pg.wait_for_function(f"{G}.match?.sim.rules.squads.get({G}.match.sim.byId.get({G}.match.localId).team).extracted > 0 || document.querySelector('#ui .menu[data-screen=\"results\"]')", timeout=60000)
    await pg.wait_for_timeout(600)
    await shot('11-lifted')
    await pg.wait_for_selector('.menu[data-screen="results"] .rs', timeout=90000)
    await pg.wait_for_timeout(2500)
    await shot('12-results')
    word = await ev("document.querySelector('.rs-word h2')?.textContent")
    if word != 'Extracted': failures.append(f'{tag}: results say {word!r}')
    rows = await ev("[...document.querySelectorAll('.rb.theirs .rb-row b')].map(n => n.textContent)")
    if not any(r for r in rows if r and 'No contracts' not in r): failures.append(f'{tag}: no contract rows on results: {rows}')
    xp = await ev("[...document.querySelectorAll('.xp-row span')].map(n => n.textContent)")
    if 'Extracted' not in xp: failures.append(f'{tag}: no Extracted XP line: {xp}')
    await check_fit(pg, ['.rs-top', '.rb-pair', '.rs-cards'], f'{tag} results', failures)
    await ev('clearInterval(window.__shield); clearInterval(window.__clear)')
    await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=ARGS)
            sizes = [(852, 393), (667, 375)]
            if os.environ.get('EX_SIZE'): sizes = [tuple(int(v) for v in os.environ['EX_SIZE'].split('x'))]
            for vw, vh in sizes:
                try: await run(browser, vw, vh, failures, errors)
                except Exception as e: failures.append(f'{vw}x{vh}: {type(e).__name__}: {e}')
            await browser.close()
    finally:
        server.terminate()
    for e in errors: print('console error:', e)
    for f in failures: print('FAIL', f)
    print(f'screenshots in {OUT}')
    print('ok' if not failures and not errors else f'{len(failures)} failures, {len(errors)} console errors')
    sys.exit(1 if failures or errors else 0)


asyncio.run(main())
