#!/usr/bin/env python3
"""Graveyard Shift end to end in a real browser (docs/ZOMBIES.md): python3 dev/ui-zombies-test.py [port] [outdir]

Serves the repo, opens Multiplayer, the Zombies tab, Solo with bots, Find match, rides the search and the vote into a
match on one of the mode's maps, plays round 1 (the horde is put down on the host so software rendering does not
take minutes, after the first zombies have risen and walked), checks the round counter moves on, then walks (teleports)
the local player to a wall-buy and taps the use button with the points for it, checks the phone's own gun changed,
buys a perk and opens a gate the same way, and finally lets the crew fall and checks the Overrun results screen.
Then Ashgrove Halt at 932x430 (the debug hook ?map=ashgrove&mode=zm and the Custom button): the round starts with the
power out, a perk machine shows dark and will not sell, the gates to the Pump Yard open, the switch is thrown through
the use button (free), and the same machine sells its perk.
Screenshots at 852x393, 667x375 and 932x430 go to outdir (default /tmp/zombies). Fails on any console error, and on HUD
panels that spill off the screen. Then the economy (ROADMAP item 36) on Ashgrove at 852x393 and 667x375: a gun upgraded
at the bench through the use button (the gun goes in, comes out at tier 1 with its pips and look), the supply terminal's
sheet and a sentry bought from it, a trap armed at its switch, plates at the armour bench, the exfil called at round 15,
the relics set on the altar and the Gravewarden's bar. ZM_SIZE=WxH runs one size of the first part; ZM_ONLY=ashgrove or
ZM_ONLY=econ runs only that part.
Last, every Graveyard Shift message (hints, feed notes, banners, the use button's lines) is fired through the real layer
at 640x360 to 956x440 and must read whole: nothing cut, clamped or off screen (ZM_ONLY=messages runs only that).
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8371
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/zombies'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game.app'

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

# The use button must sit between the sticks: clear of the left third and the right third of the screen.
CLEAR_OF_STICKS = """(() => {
  const n = document.querySelector('.zm-use'); if (!n || n.hidden) return 'hidden';
  const r = n.getBoundingClientRect(), W = innerWidth;
  return r.left > W * 0.25 && r.right < W * 0.75 ? '' : `${Math.round(r.left)}..${Math.round(r.right)} of ${W}`;
})()"""


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
    await pg.locator('[data-act="mpTab"][data-tab="zombies"]').first.click()
    await pg.wait_for_timeout(500)
    await pg.locator('[data-act="mpPlaylist"][data-id="zmsolo"]').first.click()
    await pg.wait_for_timeout(300)
    await shot('01-multiplayer')
    await check_fit(pg, ['.mp-pl', '.mp-find', '.mp-tabs'], f'{tag} multiplayer', failures)
    await pg.locator('[data-act="mpFind"]').first.click()
    await pg.wait_for_timeout(1300)
    await shot('02-vote')
    await pg.wait_for_function(f'{G}.match?.interp.newest?.obj?.zm || {G}.match?.interp.newest?.points?.obj?.zm', timeout=40000)
    mode = await ev(f'{G}.match.mode')
    if mode != 'zm': failures.append(f'{tag}: match mode {mode}')
    mapId = await ev(f'{G}.match.mapId')
    if mapId not in ('neon', 'ruins', 'foundry', 'ashgrove'): failures.append(f'{tag}: zombies on {mapId}')
    await pg.wait_for_function(f'{G}.match.interp.newest.phase === "live"', timeout=30000)
    # Nobody on the crew dies by accident while the test drives (spawn protection holds the claws off).
    await ev(f"""(() => {{ const sim = {G}.match.sim; window.__shield = setInterval(() => {{ for (const p of sim.players) if (p.team === 0) p.spawnProtect = 99; }}, 200); }})()""")
    gun0 = await ev(f'{G}.match.ps.primary + "/" + {G}.match.ps.secondary')
    if gun0 != 'pistol/knife': failures.append(f'{tag}: started with {gun0}, not the pistol and the blade')
    # Round 1: wait for it to start and the first zombies to rise and walk.
    await pg.wait_for_function(f"{G}.match.sim.rules.round === 1 && {G}.match.sim.rules.horde.some(p => p.alive)", timeout=60000)
    await pg.wait_for_timeout(2500)
    await shot('03-round1')
    await check_fit(pg, ['.zm-top', '.zm-crew', '.minimap'], f'{tag} hud', failures)
    rnd = await ev("document.querySelector('.zm-round b').textContent")
    if rnd.strip() != '1': failures.append(f'{tag}: round plate says {rnd!r}')
    # The bots thin them out fast: any moment with one up in the view will do.
    try: await pg.wait_for_function(f"{G}.match.interp.newest.players.some(p => p.zk > 0 && p.alive)", timeout=30000, polling=50)
    except Exception: failures.append(f'{tag}: no zombies in the view')
    # The rest of round 1, put down on the host (their kills pay whoever is closest).
    await ev(f"""(() => {{ const sim = {G}.match.sim, R = sim.rules, me = sim.byId.get({G}.match.localId);
      window.__cull = setInterval(() => {{ for (const z of R.horde) if (z.alive) sim._damage(z, me, 99999, 'pistol', 5); }}, 300); }})()""")
    await pg.wait_for_function(f"{G}.match.sim.rules.round >= 2 || {G}.match.sim.rules.state === 2", timeout=90000)
    await ev('clearInterval(window.__cull)')
    await pg.wait_for_timeout(800)
    await shot('04-round-survived')
    st = await ev(f"{G}.match.sim.rules.state")
    if st not in (1, 2): failures.append(f'{tag}: state after round 1 is {st}')
    # A wall-buy in the start band: points, walk there, tap Buy.
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, me = m.sim.byId.get(m.localId);
      me.zm.pts = 20000;
      const w = R.L.wallBuys.find(x => x.band === R.L.start); window.__wb = w.gun;
      m.ps.x = w.x; m.ps.z = w.z; m.ps.vx = 0; m.ps.vz = 0; }})()""")
    await pg.wait_for_selector('.zm-use:not([hidden]):not(.poor)', timeout=10000)
    await pg.wait_for_timeout(400)
    await shot('05-wallbuy')
    where = await ev(CLEAR_OF_STICKS)
    if where: failures.append(f'{tag}: use button not clear of the sticks: {where}')
    await check_fit(pg, ['.zm-use', '.zm-top'], f'{tag} prompt', failures)
    label = await ev("document.querySelector('.zm-use .t').textContent")
    if not label.startswith('BUY'): failures.append(f'{tag}: prompt at a wall-buy says {label!r}')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"[{G}.match.ps.primary, {G}.match.ps.secondary].includes(window.__wb)", timeout=6000)
    except Exception: failures.append(f'{tag}: buying at the wall did not arm the gun')
    await pg.wait_for_timeout(500)
    await shot('06-bought')
    # The mystery crate (owner notes): looks like a crate, the lid opens, guns cycle up, the pick floats, the lid shuts,
    # and a move lifts it away and drops it in elsewhere. Crops of the middle of the screen go to outdir.
    crop = lambda name: pg.screenshot(path=f'{OUT}/{name}-crop-{vw}x{vh}.png', clip={'x': vw * 0.28, 'y': vh * 0.12, 'width': vw * 0.44, 'height': vh * 0.66})
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules; R.open = (1 << 8) - 1; R.box.state = 0; R.box.uses = 0; R.box.moveAt = 99;
      const bs = R.L.boxSpots[R.box.spot]; m.ps.x = bs.x; m.ps.z = bs.z; }})()""")
    await pg.wait_for_function(f"document.querySelector('.zm-use:not([hidden]) .t')?.textContent?.toUpperCase().includes('CRATE')", timeout=10000)
    await pg.wait_for_timeout(500)
    await crop('05b-crate')
    await pg.locator('.zm-use').first.click()
    await pg.wait_for_timeout(1300)
    await crop('05c-crate-rolling')
    lid = await ev(f"{G}.renderer?.zmFx?.lid?.rotation.x ?? window.__game.app.match?.renderer?.zmFx?.lid?.rotation.x ?? null")
    try: await pg.wait_for_function(f"{G}.match.sim.rules.box.state === 2", timeout=8000)
    except Exception: failures.append(f'{tag}: the crate never offered a gun')
    await pg.wait_for_timeout(700)
    await crop('05d-crate-offer')
    await pg.locator('.zm-use').first.click()
    await pg.wait_for_timeout(900)
    await crop('05e-crate-taken')
    await ev(f"(() => {{ const R = {G}.match.sim.rules; R.box.state = 3; R.box.timer = 2.5; R.box.gun = -1; }})()")
    await pg.wait_for_timeout(600)
    await crop('05f-crate-leaving')
    await pg.wait_for_function(f"{G}.match.sim.rules.box.state === 0", timeout=8000)
    await ev(f"(() => {{ const m = {G}.match, R = m.sim.rules, bs = R.L.boxSpots[R.box.spot]; m.ps.x = bs.x; m.ps.z = bs.z; }})()")
    await pg.wait_for_timeout(250)
    await crop('05g-crate-arrived')
    print(f'  {tag} crate lid at roll {lid}', flush=True)
    # A wall-buy behind a wall: its glow shows through (stand on the far side of the wall it hangs on).
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, w = R.L.wallBuys[0];
      m.ps.x = w.wx - Math.cos(w.face) * 3.5; m.ps.z = w.wz - Math.sin(w.face) * 3.5;
      const k = m.sim.nav.nearestFree(m.ps.x, m.ps.z); m.ps.x = k % m.sim.nav.w + 0.5; m.ps.z = Math.floor(k / m.sim.nav.w) + 0.5; }})()""")
    await pg.wait_for_timeout(600)
    await shot('05h-wallbuy-glow')
    await crop('05h-wallbuy-glow')
    # A perk machine and a gate.
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules; const mc = R.L.machines.find(x => x.band === R.L.start) ?? R.L.machines[0];
      if (R.L.machines[0] && mc.band !== R.L.start) for (const d of R.L.doors) R.open |= 1 << d.i;
      R.power = 1;     // A map with a power switch (Ashgrove): the second part throws it through the button.
      window.__perk = mc.perk; m.ps.x = mc.x; m.ps.z = mc.z; }})()""")
    await pg.wait_for_selector('.zm-use:not([hidden]):not(.poor)', timeout=10000)
    await pg.wait_for_timeout(300)
    await shot('07-perk')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"{G}.match.sim.rules.crew.find(p => p.id === {G}.match.localId).zm.perks.includes(window.__perk)", timeout=6000)
    except Exception: failures.append(f'{tag}: the perk machine did nothing')
    await pg.wait_for_timeout(400)
    await shot('08-perked')
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules; R.open = 0; const d = R.L.doors[0];
      const s = d.stand?.[d.from] ?? {{ x: d.cx + (d.from < d.opens ? -1.2 : 1.2), z: d.cz }}; m.ps.x = s.x; m.ps.z = s.z; }})()""")
    await pg.wait_for_function(f"document.querySelector('.zm-use:not([hidden]) .t')?.textContent === 'OPEN GATE'", timeout=10000)
    await shot('09-gate')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"({G}.match.sim.rules.open & 1) === 1", timeout=6000)
    except Exception: failures.append(f'{tag}: the gate did not open')
    await pg.wait_for_timeout(1500)
    await shot('10-gate-open')
    # The end: the shield comes off and everyone falls.
    await ev(f"""(() => {{ clearInterval(window.__shield); const sim = {G}.match.sim; for (const p of sim.players) if (p.team === 0 && p.alive) {{ p.spawnProtect = 0; p.downed = false; sim._selfKill(p, 'bleed'); }} }})()""")
    await pg.wait_for_selector('.menu[data-screen="results"] .rs', timeout=90000)
    await pg.wait_for_timeout(2500)
    for _ in range(10):
        if not await pg.evaluate(f"{OVERFLOW}(['.rs-top'])"): break
        await pg.wait_for_timeout(700)
    await shot('11-results')
    word = await ev("document.querySelector('.rs-word h2')?.textContent")
    if word != 'Overrun': failures.append(f'{tag}: results say {word!r}')
    xp = await ev("[...document.querySelectorAll('.xp-row span')].map(n => n.textContent)")
    if not any('survived' in (x or '') for x in xp): failures.append(f'{tag}: no Rounds survived XP line: {xp}')
    best = await ev(f"window.__game.Progress.zmBest({mapId!r})")
    if not best: failures.append(f'{tag}: no high-round record saved for {mapId}')
    await check_fit(pg, ['.rs-top', '.rb-pair', '.rs-cards'], f'{tag} results', failures)
    await ctx.close()


async def run_ashgrove(browser, vw, vh, failures, errors):
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'ash {vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'ash {vw}: PAGEERR {e} {getattr(e, "stack", "")}'))
    tag = f'ashgrove {vw}x{vh}'
    async def shot(name):
        print(f'  {tag} {name}', flush=True)
        await pg.screenshot(path=f'{OUT}/ash-{name}-{vw}x{vh}.png')
    ev = lambda js: pg.evaluate(js)
    await pg.goto(f'http://localhost:{PORT}/?debug=1&map=ashgrove&mode=zm', timeout=120000)
    await pg.wait_for_timeout(900)
    await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_function(f'{G}.match?.interp.newest?.phase === "live"', timeout=90000)
    mapId, mode = await ev(f'[{G}.match.mapId, {G}.match.mode]')
    if (mapId, mode) != ('ashgrove', 'zm'): failures.append(f'{tag}: match on {mapId} / {mode}')
    await ev(f"""(() => {{ const sim = {G}.match.sim; window.__shield = setInterval(() => {{ for (const p of sim.players) if (p.team === 0) p.spawnProtect = 99; }}, 200);
      for (const p of sim.rules.crew) if (p.bot) {{ p.bot.update = () => []; }} sim.rules.plan = () => {{}}; sim.rules._crewPlan = null; }})()""")
    await pg.wait_for_function(f"{G}.match.sim.rules.round === 1 && {G}.match.sim.rules.horde.some(p => p.alive)", timeout=60000)
    await pg.wait_for_timeout(2500)
    await shot('01-round1')
    await check_fit(pg, ['.zm-top', '.zm-crew', '.minimap'], f'{tag} hud', failures)
    if await ev(f'{G}.match.sim.rules.power') != 0: failures.append(f'{tag}: the power is not off at the start')
    # The machine in the Halt: dark, and it sells nothing.
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, me = m.sim.byId.get(m.localId); me.zm.pts = 20000;
      const mc = R.L.machines.find(x => x.band === R.L.start); window.__perk = mc.perk; window.__mc = mc; m.ps.x = mc.x - 2.5; m.ps.z = mc.z + 3; m.ps.vx = 0; m.ps.vz = 0; }})()""")
    await pg.wait_for_timeout(1500)
    await shot('02a-machine-dark-view')
    await ev(f"(() => {{ const m = {G}.match; m.ps.x = window.__mc.x; m.ps.z = window.__mc.z; }})()")
    await pg.wait_for_selector('.zm-use:not([hidden])', timeout=10000)
    await pg.wait_for_timeout(400)
    await shot('02-perk-dark')
    sub = await ev("document.querySelector('.zm-use')?.textContent")
    poor = await ev("document.querySelector('.zm-use').classList.contains('poor')")
    if 'power' not in (sub or '').lower() or not poor: failures.append(f'{tag}: a dark machine prompt says {sub!r} (greyed {poor})')
    await pg.locator('.zm-use').first.click()
    await pg.wait_for_timeout(800)
    if await ev(f"{G}.match.sim.rules.crew.find(p => p.id === {G}.match.localId).zm.perks.length"): failures.append(f'{tag}: a dark machine sold a perk')
    # Open the Halt -> Lane -> Pump Yard gates on the host, walk to the switch, throw it with the use button.
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, L = R.L, id = n => L.bands.findIndex(b => b.id === n);
      for (const d of L.doors) if ((d.a === id('halt') && d.b === id('lane')) || (d.a === id('lane') && d.b === id('pump'))) R._use(m.sim.byId.get(m.localId), {{ kind: 'door', i: d.i, cost: 0, ok: true }});
      m.ps.x = L.power.x - 3; m.ps.z = L.power.z + 2.5; m.ps.vx = 0; m.ps.vz = 0; }})()""")
    await pg.wait_for_timeout(1800)
    await shot('03a-switch-view')
    await ev(f"(() => {{ const m = {G}.match, L = m.sim.rules.L; m.ps.x = L.power.x; m.ps.z = L.power.z; }})()")
    try: await pg.wait_for_function("document.querySelector('.zm-use:not([hidden]) .t')?.textContent === 'TURN ON THE POWER'", timeout=10000)
    except Exception: failures.append(f'{tag}: no TURN ON THE POWER prompt at the switch: ' + str(await ev("document.querySelector('.zm-use')?.textContent")))
    await pg.wait_for_timeout(1500)
    await shot('03-switch')
    where = await ev(CLEAR_OF_STICKS)
    if where: failures.append(f'{tag}: use button not clear of the sticks: {where}')
    pts = await ev(f"{G}.match.sim.rules.crew.find(p => p.id === {G}.match.localId).zm.pts")
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"{G}.match.sim.rules.power === 1", timeout=6000)
    except Exception: failures.append(f'{tag}: the switch did not turn the power on')
    if await ev(f"{G}.match.sim.rules.crew.find(p => p.id === {G}.match.localId).zm.pts") != pts: failures.append(f'{tag}: the switch cost points')
    # Everyone is told who did it, and the switch now says so instead of going quiet.
    try: await pg.wait_for_function("[...document.querySelectorAll('.banner, .hud-banner, [class*=banner]')].some(b => /turned on the power/i.test(b.textContent))", timeout=3000)
    except Exception: failures.append(f'{tag}: no "<name> turned on the power" banner')
    try: await pg.wait_for_function("document.querySelector('.zm-use:not([hidden]) .t')?.textContent === 'POWER IS ON' && document.querySelector('.zm-use').classList.contains('poor')", timeout=4000)
    except Exception: failures.append(f'{tag}: the switch does not say POWER IS ON once thrown: ' + str(await ev("document.querySelector('.zm-use')?.textContent")))
    lamp = await ev(f"(() => {{ const p = {G}.renderer?.zmFx?.power ?? {G}.match?.renderer?.zmFx?.power; return p ? [p.lamp.material.color.getHex(), p.lever.rotation.z] : null; }})()")
    if lamp is not None and (lamp[0] != 0x4fe36a): failures.append(f'{tag}: the switch lamp is not green once on ({lamp})')
    await pg.wait_for_timeout(1200)
    await shot('04-power-on')
    await ev(f"(() => {{ const m = {G}.match, L = m.sim.rules.L; m.ps.x = L.power.x - 3; m.ps.z = L.power.z + 2.5; }})()")
    await pg.wait_for_timeout(1200)
    await shot('04a-switch-on-view')
    # Back to the machine: now it sells.
    await ev(f"(() => {{ const m = {G}.match; m.ps.x = window.__mc.x; m.ps.z = window.__mc.z; m.ps.vx = 0; m.ps.vz = 0; }})()")
    await pg.wait_for_selector('.zm-use:not([hidden]):not(.poor)', timeout=10000)
    await pg.wait_for_timeout(300)
    await shot('05-perk-live')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"{G}.match.sim.rules.crew.find(p => p.id === {G}.match.localId).zm.perks.includes(window.__perk)", timeout=6000)
    except Exception: failures.append(f'{tag}: the perk machine did not sell once the power was on')
    await pg.wait_for_timeout(500)
    await shot('06-perked')
    await ev('clearInterval(window.__shield)')
    await ctx.close()


async def run_econ(browser, vw, vh, failures, errors):
    """The economy (ROADMAP item 36) on Ashgrove Halt: upgrade a gun at the bench, buy from the supply terminal's sheet,
    arm a trap, buy a plate, the exfil called and the quest's altar; screenshots and crops of each piece."""
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'econ {vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'econ {vw}: PAGEERR {e} {getattr(e, "stack", "")}'))
    tag = f'econ {vw}x{vh}'
    async def shot(name):
        print(f'  {tag} {name}', flush=True)
        await pg.screenshot(path=f'{OUT}/econ-{name}-{vw}x{vh}.png')
    crop = lambda name: pg.screenshot(path=f'{OUT}/econ-{name}-crop-{vw}x{vh}.png', clip={'x': vw * 0.25, 'y': vh * 0.08, 'width': vw * 0.5, 'height': vh * 0.72})
    ev = lambda js: pg.evaluate(js)
    await pg.goto(f'http://localhost:{PORT}/?debug=1&map=ashgrove&mode=zm', timeout=120000)
    await pg.wait_for_timeout(900)
    await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_function(f'{G}.match?.interp.newest?.phase === "live"', timeout=90000)
    # Shielded, the bots stand still, every gate open and the power on; the horde held back.
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, R = sim.rules; window.__shield = setInterval(() => {{ for (const p of sim.players) if (p.team === 0) p.spawnProtect = 99; }}, 200);
      for (const p of R.crew) if (p.bot) {{ p.bot.update = () => []; }} R.plan = () => {{}}; R._crewPlan = null;
      const me = sim.byId.get(m.localId); for (const d of R.L.doors) if (!(R.open & (1 << d.i))) R._use(me, {{ kind: 'door', i: d.i, cost: 0, ok: true }});
      R.power = 1; me.zm.pts = 200000; }})()""")
    await pg.wait_for_function(f"{G}.match.sim.rules.round === 1", timeout=60000)
    await ev(f"(() => {{ const R = {G}.match.sim.rules; R.spawnT = 1e9; for (const z of R.horde) if (z.alive) {{ z.alive = false; z.hp = 0; }} }})()")
    goto = lambda what: ev(f"(() => {{ const m = {G}.match, L = m.sim.rules.L, p = {what}; m.ps.x = p.x; m.ps.z = p.z; m.ps.vx = 0; m.ps.vz = 0; }})()")
    prompt = lambda: ev("document.querySelector('.zm-use:not([hidden]) .t')?.textContent ?? ''")
    # ---- The upgrade bench: a wall gun first, then tier 1 through the use button. ----
    await ev(f"(() => {{ const m = {G}.match, R = m.sim.rules; R._give(m.sim.byId.get(m.localId), 'ar'); }})()")
    await pg.wait_for_function(f"{G}.match.ps.weapon === 'ar'", timeout=6000)
    await goto('L.bench')
    try: await pg.wait_for_function("(document.querySelector('.zm-use:not([hidden]) .t')?.textContent ?? '').startsWith('UPGRADE')", timeout=8000)
    except Exception: failures.append(f'{tag}: no UPGRADE prompt at the bench: {await prompt()!r}')
    await pg.wait_for_timeout(500)
    await shot('01-bench')
    await crop('01-bench')
    where = await ev(CLEAR_OF_STICKS)
    if where: failures.append(f'{tag}: use button not clear of the sticks: {where}')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"{G}.match.sim.rules.econ.bench.state === 1 && {G}.match.ps.weapon === 'knife'", timeout=6000)
    except Exception: failures.append(f'{tag}: the bench did not take the gun')
    await pg.wait_for_timeout(1200)
    await crop('02-bench-working')
    await pg.wait_for_function(f"{G}.match.sim.rules.econ.bench.state === 2", timeout=10000)
    await pg.wait_for_function("(document.querySelector('.zm-use:not([hidden]) .t')?.textContent ?? '').startsWith('TAKE')", timeout=6000)
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"{G}.match.ps.weapon === 'ar' && {G}.match.ps.defs[{G}.match.ps.slot].zt === 1", timeout=6000)
    except Exception: failures.append(f'{tag}: the upgraded gun did not come back at tier 1')
    await pg.wait_for_timeout(600)
    pips = await ev("document.querySelectorAll('.zm-tier:not([hidden]) i.on').length")
    if pips != 1: failures.append(f'{tag}: weapon panel shows {pips} tier pips, not 1')
    camo = await ev(f"{G}.match.ps.camo")
    if camo != 'pp-laurel': failures.append(f'{tag}: a tier 1 gun wears {camo!r}')
    # Tier 3 straight off on the host, for the look (and its arc rounds' tracers).
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, me = m.sim.byId.get(m.localId); R.econ._handBack?.call; me.zm.tiers.ar = 2;
      R.econ.use(me, {{ kind: 'bench' }}); R.econ.bench.timer = 0.05; }})()""")
    await pg.wait_for_function(f"{G}.match.sim.rules.econ.bench.state === 2", timeout=6000)
    await pg.locator('.zm-use').first.click()
    await pg.wait_for_function(f"{G}.match.ps.defs[{G}.match.ps.slot].zt === 3", timeout=6000)
    await pg.wait_for_timeout(800)
    await shot('03-tier3')
    await crop('03-tier3')
    pips = await ev("document.querySelectorAll('.zm-tier:not([hidden]) i.on').length")
    if pips != 3: failures.append(f'{tag}: weapon panel shows {pips} tier pips at tier 3')
    await check_fit(pg, ['.arms', '.vitals', '.zm-use'], f'{tag} tier', failures)
    # ---- The supply terminal: its sheet, a sentry. ----
    await goto('L.terminal')
    try: await pg.wait_for_function("document.querySelector('.zm-use:not([hidden]) .t')?.textContent === 'SUPPLY TERMINAL'", timeout=8000)
    except Exception: failures.append(f'{tag}: no SUPPLY TERMINAL prompt: {await prompt()!r}')
    await pg.wait_for_timeout(400)
    await crop('04-terminal')
    await pg.locator('.zm-use').first.click()
    await pg.wait_for_selector('.zm-shop:not([hidden]) .zm-item', timeout=5000)
    await pg.wait_for_timeout(300)
    await shot('05-terminal-sheet')
    await check_fit(pg, ['.zm-shop-row', '.zm-shop h3', '.zm-shop .close'], f'{tag} sheet', failures)
    n = await ev("document.querySelectorAll('.zm-shop .zm-item').length")
    if n < 4 or n > 5: failures.append(f'{tag}: the terminal offers {n} items')
    await pg.locator('.zm-item[data-item="sentry"]').first.click()
    try: await pg.wait_for_function(f"{G}.match.sim.rules.econ.gear.some(g => g.kind === 'sentry')", timeout=6000)
    except Exception: failures.append(f'{tag}: buying a sentry from the sheet did nothing')
    if not await ev("document.querySelector('.zm-shop').hidden"): failures.append(f'{tag}: the sheet stayed open after a buy')
    # Zombies in front of it: it fires.
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, g = R.econ.gear.find(x => x.kind === 'sentry');
      for (let k = 0; k < 3; k++) {{ const z = R.horde[k]; R._raise(z, 0, {{ x: g.x + 3 + k * 0.6, z: g.z + 1.5 }}); z.zPace = 0; }} m.ps.x -= 1.5; }})()""")
    await pg.wait_for_timeout(700)
    await shot('06-sentry')
    await crop('06-sentry')
    await ev(f"(() => {{ const R = {G}.match.sim.rules; for (const z of R.horde) if (z.alive) {{ z.alive = false; z.hp = 0; }} }})()")
    # ---- A trap: arm it at its switch, see it run. ----
    await goto('({ x: L.traps[1].sx, z: L.traps[1].sz })')
    try: await pg.wait_for_function("(document.querySelector('.zm-use:not([hidden]) .t')?.textContent ?? '') === 'FIREDAMP VENTS'", timeout=8000)
    except Exception: failures.append(f'{tag}: no trap prompt at its switch: {await prompt()!r}')
    await crop('07-trap-idle')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"{G}.match.sim.rules.econ.traps[1].state === 1", timeout=6000)
    except Exception: failures.append(f'{tag}: the trap did not arm')
    await ev(f"""(() => {{ const R = {G}.match.sim.rules, T = R.L.traps[1]; const z = R.horde[4]; R._raise(z, 1, {{ x: T.x, z: T.z }}); z.zPace = 0; }})()""")
    await pg.wait_for_timeout(500)
    await shot('08-trap-armed')
    await crop('08-trap-armed')
    for i in (0, 2):
        await ev(f"(() => {{ const E = {G}.match.sim.rules.econ; E.traps[{i}].state = 1; E.traps[{i}].timer = 30; }})()")
    await goto('({ x: L.traps[0].x + 2, z: L.traps[0].z + 3 })')
    await pg.wait_for_timeout(700)
    await crop('08b-trap-shock')
    await goto('({ x: L.traps[2].x - 2, z: L.traps[2].z - 3 })')
    await pg.wait_for_timeout(700)
    await crop('08c-trap-blades')
    # ---- Plates at the armour bench. ----
    await goto('L.armour')
    try: await pg.wait_for_function("document.querySelector('.zm-use:not([hidden]) .t')?.textContent === 'ARMOUR PLATE'", timeout=8000)
    except Exception: failures.append(f'{tag}: no ARMOUR PLATE prompt: {await prompt()!r}')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"{G}.match.sim.rules.crew.find(p => p.id === {G}.match.localId).zm.plates === 50", timeout=6000)
    except Exception: failures.append(f'{tag}: the armour bench sold no plate')
    await pg.locator('.zm-use').first.click()
    await pg.wait_for_timeout(700)
    shown = await ev("[...document.querySelectorAll('.zm-plates:not([hidden]) i')].map(n => n.style.getPropertyValue('--k')).join()")
    if shown != '1.00,1.00,0.00': failures.append(f'{tag}: plate bar reads {shown!r} after two plates')
    await shot('09-plates')
    await crop('09-armour')
    await check_fit(pg, ['.vitals', '.zm-use'], f'{tag} plates', failures)
    # ---- The exfil, called (round 15), and the altar with every relic found. ----
    await ev(f"(() => {{ const R = {G}.match.sim.rules; R.round = 15; }})()")
    await goto('L.exfil')
    try: await pg.wait_for_function("document.querySelector('.zm-use:not([hidden]) .t')?.textContent === 'CALL EXFIL'", timeout=8000)
    except Exception: failures.append(f'{tag}: no CALL EXFIL prompt: {await prompt()!r}')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"{G}.match.sim.rules.econ.exfil.state === 1", timeout=6000)
    except Exception: failures.append(f'{tag}: the exfil was not called')
    await pg.wait_for_timeout(1500)
    await shot('10-exfil')
    await crop('10-exfil')
    await check_fit(pg, ['.zm-top'], f'{tag} exfil', failures)
    if await ev("document.querySelector('.zm-exfil').hidden"): failures.append(f'{tag}: no exfil clock on the plate')
    await ev(f"(() => {{ const R = {G}.match.sim.rules; R.econ.exfil.state = 0; for (const z of R.horde) if (z.alive) {{ z.alive = false; z.hp = 0; }} R.econ.quest.got = 3; }})()")
    await goto('L.relics[2]')
    await pg.wait_for_timeout(600)
    await crop('11-relic')
    await pg.locator('.zm-use').first.click()
    await pg.wait_for_function(f"{G}.match.sim.rules.econ.quest.got === 7", timeout=6000)
    await goto('L.altar')
    try: await pg.wait_for_function("document.querySelector('.zm-use:not([hidden]) .t')?.textContent === 'SET THE RELICS'", timeout=8000)
    except Exception: failures.append(f'{tag}: no SET THE RELICS prompt: {await prompt()!r}')
    await crop('12-altar')
    await pg.locator('.zm-use').first.click()
    try: await pg.wait_for_function(f"{G}.match.sim.rules.econ.wardenSeat >= 0", timeout=8000)
    except Exception: failures.append(f'{tag}: the Gravewarden did not rise')
    await pg.wait_for_timeout(1500)
    await shot('13-warden')
    bossName = await ev("document.querySelector('.zm-boss:not([hidden]) b')?.textContent")
    if bossName != 'Gravewarden': failures.append(f'{tag}: boss bar says {bossName!r}')
    await ev('clearInterval(window.__shield)')
    await ctx.close()


async def run_specials(browser, vw, vh, failures, errors):
    """The special zombies (js/sim/zm-kinds.js) on Foundry: one of each raised in front of the player (looks, the
    Shieldbearer's shield, a Crawler on all fours), a Spitter's glob with its landing mark and puddle, a Bloater's burst,
    then a fog round's banner and darkness. Screenshots of each; no console errors."""
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'specials {vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'specials {vw}: PAGEERR {e} {getattr(e, "stack", "")}'))
    tag = f'specials {vw}x{vh}'
    async def shot(name):
        print(f'  {tag} {name}', flush=True)
        await pg.screenshot(path=f'{OUT}/specials-{name}-{vw}x{vh}.png')
    ev = lambda js: pg.evaluate(js)
    await pg.goto(f'http://localhost:{PORT}/?debug=1&map=foundry&mode=zm', timeout=120000)
    await pg.wait_for_timeout(900)
    await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_function(f'{G}.match?.interp.newest?.phase === "live"', timeout=90000)
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, R = sim.rules; window.__shield = setInterval(() => {{ for (const p of sim.players) if (p.team === 0) p.spawnProtect = 99; }}, 200);
      for (const p of R.crew) if (p.bot) {{ p.bot.update = () => []; }} R.plan = () => {{}}; R._crewPlan = null; }})()""")
    await pg.wait_for_function(f"{G}.match.sim.rules.round === 1", timeout=60000)
    # Hold the round, clear the horde, raise one of each special a few metres off, frozen in place (their drive skipped).
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, R = sim.rules; R.spawnT = 1e9; R.round = 15; R.hp = 2000;
      for (const z of R.horde) if (z.alive) {{ z.alive = false; z.hp = 0; }}
      const me = sim.byId.get(m.localId), x = me.ps.x, z = me.ps.z;
      const free = (dx, dz) => {{ const k = sim.nav.nearestFree(x + dx, z + dz); return {{ x: k % sim.nav.w + 0.5, z: Math.floor(k / sim.nav.w) + 0.5 }}; }};
      window.__sp = [[5, -4, -2.5], [6, 4, -2.5], [7, -4, 1.2], [8, 4, 1.2]].map(([k, dx, dz]) => {{ const seat = R.horde.find(q => !q.alive); R._raise(seat, k, free(dx, dz)); seat.ps.aim = Math.atan2(z - seat.ps.z, x - seat.ps.x); return seat; }});
      const drive = R._driveZombie.bind(R); R._driveZombie = (p, dt) => {{ if (window.__sp.includes(p) && window.__freeze) return; drive(p, dt); }}; window.__freeze = true; }})()""")
    await pg.wait_for_timeout(1500)
    await shot('01-lineup')
    got = await ev(f"(() => {{ const v = {G}.match.interp.newest; return v.players.filter(p => p.alive && p.zk >= 6).map(p => [p.zk, !!p.zshield]); }})()")
    kinds = sorted(k for k, _ in got)
    if kinds != [6, 7, 8, 9]: failures.append(f'{tag}: the view has kinds {got}')
    if not any(k == 9 and sh for k, sh in got): failures.append(f'{tag}: the Shieldbearer has no shield in the view')
    sh = await ev(f"{G}.renderer?.zmFx?.kinds?.shieldMesh.count ?? {G}.match?.renderer?.zmFx?.kinds?.shieldMesh.count ?? -1")
    if sh is not None and sh == 0: failures.append(f'{tag}: no shield drawn')
    # The Spitter spits: the glob in flight with its landing mark, then the puddle.
    await ev(f"(() => {{ const m = {G}.match, R = m.sim.rules, sp = window.__sp[0]; R.kinds._spit(sp, m.sim.byId.get(m.localId)); }})()")
    await pg.wait_for_timeout(350)
    await shot('02-glob')
    marks = await ev(f"{G}.renderer?.zmFx?.kinds?.markMesh.count ?? -1")
    if marks == 0: failures.append(f'{tag}: no landing mark under the glob')
    await pg.wait_for_timeout(1200)
    await shot('03-puddle')
    # The Bloater bursts.
    await ev(f"(() => {{ const m = {G}.match, sim = m.sim, R = sim.rules, b = window.__sp[1]; sim._damage(b, sim.byId.get(m.localId), b.hp + 1, 'ar', 5); }})()")
    await pg.wait_for_timeout(250)
    await shot('04-burst')
    # A fog round: its banner, and the dark past a few metres.
    await ev(f"""(() => {{ const R = {G}.match.sim.rules;
      R.special = null; R.state = 2; R.timer = 0.05; R.round = 11;
      const orig = R._startRound.bind(R); R._startRound = (r) => {{ orig(r); R.special = 'fog'; R.kinds.startRound(); R.sim._emit({{ t: 'zround', round: r, special: 'fog' }}); }}; }})()""")
    try: await pg.wait_for_function("/Fog round/.test(document.querySelector('.obj-banner')?.textContent ?? '')", timeout=6000)
    except Exception: failures.append(f'{tag}: no fog round banner: ' + str(await ev("document.querySelector('.obj-banner')?.textContent")))
    await pg.wait_for_timeout(2500)
    fog = await ev(f"(() => {{ const k = {G}.renderer?.zmFx?.kinds; return k ? [k.fog.visible, k.fogK] : null; }})()")
    if fog is not None and not fog[0]: failures.append(f'{tag}: the fog is not drawn on a fog round ({fog})')
    await shot('05-fog')
    await ev('clearInterval(window.__shield)')
    await ctx.close()


# Every Graveyard Shift message (feed notes and hints, banners, the use button's two lines) at each width from 640 to
# 956: fired through the real layer (js/ui/zm-hud.js onEvent) on Ashgrove and measured: nothing cut, clamped or off screen.
MSG_SIZES = [(640, 360), (667, 375), (852, 393), (932, 430), (956, 440)]
FIRE = r"""(async () => {
  const g = window.__game, hud = g.hud, zh = hud.zmHud, view = hud.view;
  const { ZM_PERK_IDS, ZM_PERKS, ZE, ZM_FX, zmFxOf } = await import('/js/shared/zombies.js');
  const { QUEST_HINT } = await import('/js/ui/zm-hud.js');
  const { WEAPONS } = await import('/js/shared/weapons.js');
  const me = view.players.find(p => p.id === view.localId), mate = view.players.find(p => p.team === me.team && p.id !== me.id && !p.ai) ?? me;
  const long = 'Maximilian-Longname';
  me.name = long; if (mate !== me) mate.name = long;
  const W = innerWidth, H = innerHeight, bad = [];
  const box = (el, what) => {
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) bad.push(`${what}: off screen ${Math.round(r.left)}..${Math.round(r.right)}`);
  };
  const cut = (el, what) => {
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) bad.push(`${what}: cut (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}) "${el.textContent}"`);
  };
  const feed = () => { for (const f of hud.feed.splice(0)) f.row.remove(); };
  const notes = what => { for (const a of document.querySelectorAll('.hud .f-row')) for (const an of a.getAnimations()) an.finish(); for (const n of document.querySelectorAll('.hud .f-row .f-note')) { cut(n, what); box(n.closest('.f-row'), what); } feed(); };
  const banner = what => { const b = document.querySelector('.obj-banner'); for (const a of b.getAnimations()) a.finish?.(); box(b, what); cut(b.querySelector('small'), what + ' (sub)'); cut(b.querySelector('b'), what + ' (title)'); };
  const fire = (e, what) => { feed(); zh.onEvent(e, view); notes(what); banner(what); };
  hud.notify(QUEST_HINT); notes('relic hint');
  const guns = Object.keys(WEAPONS), longGun = guns.reduce((a, b) => ((WEAPONS[b].name ?? b).length > (WEAPONS[a].name ?? a).length ? b : a));
  fire({ t: 'zround', round: 1 }, 'round 1 / power out');
  fire({ t: 'zround', round: 10, boss: true }, 'boss round');
  fire({ t: 'zbreak', round: 9 }, 'round survived');
  for (const kind of ['ammo', 'double', 'nuke']) fire({ t: 'zpower', kind }, 'power-up ' + kind);
  fire({ t: 'zdoor', by: mate.id }, 'gate');
  fire({ t: 'zlights', by: mate.id }, 'power on');
  fire({ t: 'zbox', state: 2, by: me.id, gun: longGun }, 'crate offer'); fire({ t: 'zbox', state: 3 }, 'crate moves');
  for (const perk of ZM_PERK_IDS) fire({ t: 'zperk', id: me.id, perk }, 'perk ' + perk);
  fire({ t: 'down', target: mate.id }, 'mate down'); fire({ t: 'revive', id: me.id, by: mate.id }, 'revived'); fire({ t: 'zbreath', id: me.id }, 'last breath');
  for (const st of [1, 2]) fire({ t: 'zbench', state: st, by: me.id, gun: longGun, tier: 3 }, 'bench ' + st);
  for (const gun of guns) if (ZM_FX[zmFxOf(gun)]) fire({ t: 'zbench', state: 0, by: me.id, gun, tier: 3 }, 'bench fx ' + gun);
  for (const item of Object.keys(ZE.supply)) fire({ t: 'zsupply', by: mate.id, item }, 'supply ' + item);
  const L = g.app.match.sim.rules.L ?? {};
  (L.traps ?? []).forEach((tr, i) => fire({ t: 'ztrap', state: 1, i, by: mate.id }, 'trap ' + i));
  fire({ t: 'zexfil', state: 1 }, 'exfil called'); fire({ t: 'zexfil', state: 0, fail: true }, 'exfil missed');
  fire({ t: 'zescape', ids: [me.id], round: 20 }, 'escaped'); fire({ t: 'zescape', ids: [], round: 20 }, 'they got out');
  fire({ t: 'zrelic', n: 1, of: 3, by: mate.id }, 'relic found'); fire({ t: 'zrelic', n: 3, of: 3, by: me.id }, 'relics all');
  fire({ t: 'zwarden', state: 1 }, 'warden wakes'); fire({ t: 'zwarden', state: 2 }, 'warden falls');
  // The use button's longest lines.
  const use = zh.useEl, lines = [['UPGRADE ' + (WEAPONS[longGun].name ?? longGun).toUpperCase(), '12,000 · tier 3 · ' + Object.values(ZM_FX).map(f => f.name).reduce((a, b) => (b.length > a.length ? b : a))],
    ['SUPPLY TERMINAL', 'Sentries, strikes, drones, lures, vests'], ['UPGRADE BENCH', 'Hold a gun to upgrade it'], ['THE ALTAR', 'Find all the relics first'],
    ['CALL EXFIL', '20,000 · hold the pad ' + ZE.exfil.hold + ' s'], ['ARMOUR PLATE', '2,500 · up to ' + ZE.plate.max + ' plates'],
    ...ZM_PERK_IDS.map(k => [ZM_PERKS[k].name.toUpperCase(), `${ZM_PERKS[k].cost.toLocaleString('en-US')} · ${ZM_PERKS[k].desc}`]),
    ...ZM_PERK_IDS.map(k => [ZM_PERKS[k].name.toUpperCase(), `${ZM_PERKS[k].cost.toLocaleString('en-US')} · No power: find the switch`])];
  const was = use.hidden;
  for (const [t, sub] of lines) {
    use.hidden = false; zh.useT.textContent = t; zh.useS.textContent = sub;
    cut(zh.useT, 'use ' + t); cut(zh.useS, 'use ' + t + ' (sub)'); box(use, 'use ' + t);
  }
  use.hidden = was;
  return bad;
})()"""

async def run_messages(browser, failures, errors):
    ctx = await browser.new_context(viewport={'width': 932, 'height': 430}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'msg: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'msg: PAGEERR {e}'))
    ev = lambda js: pg.evaluate(js)
    await pg.goto(f'http://localhost:{PORT}/?debug=1&map=ashgrove&mode=zm', timeout=120000)
    await pg.wait_for_timeout(900)
    await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_function(f'{G}.match?.interp.newest?.phase === "live"', timeout=90000)
    await ev(f"(() => {{ const sim = {G}.match.sim; setInterval(() => {{ for (const p of sim.players) if (p.team === 0) p.spawnProtect = 99; }}, 200); }})()")
    for vw, vh in MSG_SIZES:
        await pg.set_viewport_size({'width': vw, 'height': vh})
        await pg.wait_for_timeout(700)
        bad = await ev(FIRE)
        print(f'  messages {vw}x{vh}: {len(bad)} cut', flush=True)
        for b in bad: failures.append(f'messages {vw}x{vh}: {b}')
        if vw in (640, 932):
            await ev("import('/js/ui/zm-hud.js').then(m => window.__game.hud.notify(m.QUEST_HINT))")
            await pg.wait_for_timeout(300)
            await pg.screenshot(path=f'{OUT}/msg-hint-{vw}x{vh}.png')
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
            if os.environ.get('ZM_SIZE'): sizes = [tuple(int(v) for v in os.environ['ZM_SIZE'].split('x'))]
            if os.environ.get('ZM_ONLY') in (None, ''):
                for vw, vh in sizes:
                    try: await run(browser, vw, vh, failures, errors)
                    except Exception as e: failures.append(f'{vw}x{vh}: {type(e).__name__}: {e}')
            if os.environ.get('ZM_ONLY') in (None, '', 'ashgrove'):
                try: await run_ashgrove(browser, 932, 430, failures, errors)
                except Exception as e: failures.append(f'ashgrove: {type(e).__name__}: {e}')
            if os.environ.get('ZM_ONLY') in (None, '', 'messages'):
                try: await run_messages(browser, failures, errors)
                except Exception as e: failures.append(f'messages: {type(e).__name__}: {e}')
            for vw, vh in [(852, 393), (667, 375)] if os.environ.get('ZM_ONLY') in (None, '', 'econ') else []:
                try: await run_econ(browser, vw, vh, failures, errors)
                except Exception as e: failures.append(f'econ {vw}x{vh}: {type(e).__name__}: {e}')
            for vw, vh in [(852, 393)] if os.environ.get('ZM_ONLY') in (None, '', 'specials') else []:
                try: await run_specials(browser, vw, vh, failures, errors)
                except Exception as e: failures.append(f'specials {vw}x{vh}: {type(e).__name__}: {e}')
            await browser.close()
    finally:
        server.terminate()
    for e in errors: print('console error:', e)
    for f in failures: print('FAIL', f)
    print(f'screenshots in {OUT}')
    print('ok' if not failures and not errors else f'{len(failures)} failures, {len(errors)} console errors')
    sys.exit(1 if failures or errors else 0)


asyncio.run(main())
