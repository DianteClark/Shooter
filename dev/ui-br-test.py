#!/usr/bin/env python3
"""Battle royale end to end in a real browser (docs/BR.md): python3 dev/ui-br-test.py [port] [outdir]

Serves the repo, picks Battle Royale on the BR map from the Custom match picker, rides the transport, jumps from the drop
map, glides, lands, picks loot up by walking over it, swaps a ground gun with the Take button, plates up, fights the
nearest enemy (the aim and trigger are driven through Controls.read), goes down and waits for a squadmate's revive, then
ends the match (every other squad is finished off on the host) and checks the BR results screen. Screenshots at
852x393 and 667x375 go to outdir (default /tmp/br-mode). Fails on any console error.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8273
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/br-mode'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game.app'

# Drives the trigger and aim at the nearest enemy the local player can see, through Controls.read.
FIGHT = """
(() => {
  const c = window.__game.controls, app = window.__game.app;
  if (!c.__realRead) c.__realRead = c.read.bind(c);
  c.read = () => {
    const r = c.__realRead(), m = app.match, v = m?.interp.newest;
    if (!v || !window.__fight) return r;
    const me = v.players.find(p => p.id === m.localId);
    let best = null, bd = 30;
    for (const p of v.players) if (p.team !== me.team && p.alive && !p.air) { const d = Math.hypot(p.x - m.ps.x, p.z - m.ps.z); if (d < bd) { bd = d; best = p; } }
    if (best) { r.aim = Math.atan2(best.z - m.ps.z, best.x - m.ps.x); r.aiming = true; r.fire = true; }
    return r;
  };
})()
"""


async def run(browser, vw, vh, failures, errors):
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'{vw}: PAGEERR {e}'))
    shot = lambda name: pg.screenshot(path=f'{OUT}/{name}-{vw}x{vh}.png')
    ev = lambda js: pg.evaluate(js)
    await pg.goto(f'http://localhost:{PORT}/?debug=1')
    await pg.wait_for_timeout(900)
    await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_timeout(700)
    await pg.locator('[data-act="soloMap"][data-id="frontier"]').first.click()
    await pg.wait_for_timeout(300)
    await pg.locator('[data-act="soloMode"][data-id="br"]').first.click()
    await pg.wait_for_timeout(400)
    await shot('01-picker')
    await pg.locator('[data-act="soloStart"]').first.click()
    await pg.wait_for_function(f'{G}.match?.interp.newest?.br', timeout=30000)
    await pg.wait_for_timeout(2500)
    await shot('02-dropmap')
    await pg.wait_for_function(f'{G}.match.interp.newest.phase === "live" && {G}.match.interp.newest.br.plane.f > 0.3', timeout=40000)
    await shot('03-flight')
    await pg.locator('.br-jump-map').click()
    await pg.wait_for_timeout(2200)
    await shot('04-glide')
    await pg.wait_for_function(f'{G}.match.brAir === 0', timeout=40000)
    await pg.wait_for_timeout(600)
    # Shielded until the down test, so a stray fight cannot end the run early (bots also ignore a shielded player).
    await ev(f"(() => {{ const sim = {G}.match.sim, me = sim.byId.get({G}.match.localId); for (const p of sim.players) if (p.team === me.team) p.spawnProtect = 999; }})()")
    # Loot: walk (teleport) over the nearest few items, then stand by a ground gun.
    took = await ev(f"""(async () => {{
      const m = {G}.match, rules = m.sim.br, out = [];
      const near = rules.items.filter(it => it && it.kind !== 7).sort((a, b) => Math.hypot(a.x - m.ps.x, a.z - m.ps.z) - Math.hypot(b.x - m.ps.x, b.z - m.ps.z)).slice(0, 14);
      for (const it of near) {{ m.ps.x = it.x; m.ps.z = it.z; await new Promise(r => setTimeout(r, 260)); out.push(rules.items[it.id] ? 0 : 1); }}
      return out.reduce((a, b) => a + b, 0);
    }})()""")
    if took < 4: failures.append(f'{vw}: only {took} items picked up')
    inv = await ev(f"JSON.stringify({G}.match.interp.newest.br.inv)")
    await shot('05-looted')
    # A gun in reach with both hands full: the Take button.
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId);
      for (let s = 0; s < 2; s++) if (!me.br.guns[s]) sim.br._takeGun(me, sim.br._addItem({{ kind: 0, v: 0, r: 1, n: 1, x: m.ps.x, z: m.ps.z }}), s);
      me.br.plates = Math.max(me.br.plates, 3);
      for (const it of sim.br.near(m.ps.x, m.ps.z, 4)) if (it.kind === 0) sim.br._removeItem(it);
      sim.br._addItem({{ kind: 0, v: 2, r: 4, n: 1, x: m.ps.x + 0.3, z: m.ps.z }});
      for (const p of sim.players) if (p.team !== me.team && Math.hypot(p.ps.x - m.ps.x, p.ps.z - m.ps.z) < 70) {{ p.ps.x = 3; p.ps.z = 3; }} }})()""")
    await pg.wait_for_timeout(700)
    if await pg.locator('.br-take').is_hidden(): failures.append(f'{vw}: Take button not shown by a ground gun')
    await shot('06-take')
    await pg.locator('.br-take').click()
    await pg.wait_for_timeout(500)
    rar = await ev(f"{G}.match.sim.byId.get({G}.match.localId).br.guns.some(g => g && g.r === 4)")
    if not rar: failures.append(f'{vw}: Take did not swap in the legendary gun')
    # Fists: the third slot puts the gun away, and its own slot brings it back.
    await pg.locator('.br-slot[data-k="2"]').click()
    await pg.wait_for_timeout(400)
    fist = await ev(f"[{G}.match.ps.weapon, {G}.match.sim.byId.get({G}.match.localId).br.stash?.slot ?? -1]")
    await shot('06b-fists')
    if fist[0] != 'knife' or fist[1] < 0: failures.append(f'{vw}: fists slot did not put the gun away ({fist})')
    await pg.locator(f'.br-slot[data-k="{fist[1]}"]').click()
    await pg.wait_for_timeout(400)
    back = await ev(f"[{G}.match.ps.weapon, {G}.match.sim.byId.get({G}.match.localId).br.stash]")
    if back[0] == 'knife' or back[1] is not None: failures.append(f'{vw}: the gun did not come back from fists ({back})')
    await pg.locator('.br-plate').click()
    await pg.wait_for_timeout(1500)
    await shot('07-plating')
    armor = await ev(f"{G}.match.sim.byId.get({G}.match.localId).br.armor")
    if armor < 50: failures.append(f'{vw}: plating gave {armor} armor')
    # A fight: next to the nearest enemy, trigger held on them.
    await ev(FIGHT)
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId);
      let best = null, bd = 1e9; for (const p of sim.players) if (p.team !== me.team && p.alive && !p.brAir) {{ const d = Math.hypot(p.ps.x - m.ps.x, p.ps.z - m.ps.z); if (d < bd) {{ bd = d; best = p; }} }}
      const a = Math.random() * 6.28; m.ps.x = best.ps.x + Math.cos(a) * 9; m.ps.z = best.ps.z + Math.sin(a) * 9;
      const k = sim.nav.nearestFree(m.ps.x, m.ps.z); m.ps.x = k % sim.nav.w + 0.5; m.ps.z = Math.floor(k / sim.nav.w) + 0.5;
      window.__fight = true; }})()""")
    await pg.wait_for_timeout(1800)
    await shot('08-fight')
    await ev('window.__fight = false')
    await ev(f"(() => {{ const sim = {G}.match.sim, me = sim.byId.get({G}.match.localId); for (const p of sim.players) if (p.team === me.team) p.spawnProtect = 0; }})()")
    # Down, then a squadmate's revive (the squad bots come for you).
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId), foe = sim.players.find(p => p.team !== me.team);
      for (const p of sim.players) if (p.team !== me.team && Math.hypot(p.ps.x - me.ps.x, p.ps.z - me.ps.z) < 70) {{ p.ps.x = 3; p.ps.z = 3; }}
      for (const p of sim.players) if (p.team === me.team && p !== me && p.alive) {{ p.ps.x = me.ps.x + 6; p.ps.z = me.ps.z; p.brAir = 0; if (p.downed) {{ p.downed = false; p.hp = 100; }} }}
      window.__mates = sim.players.filter(p => p.team === me.team && p !== me).map(p => [p.alive, p.downed, p.hp | 0]);
      // The fight just before may already have downed us: a second lethal hit then finishes, which is the rule, not a bug.
      if (me.downed) {{ me.downed = false; me.hp = 100; }}
      me.br.armor = 0; sim._damage(me, foe, 999, 'ar', 10);
      // Down, and kept safe from everyone else while the squad comes: the test is the revive, not a third party.
      me.spawnProtect = 999; for (const p of sim.players) if (p.team !== me.team && Math.hypot(p.ps.x - me.ps.x, p.ps.z - me.ps.z) < 120) {{ p.ps.x = 3; p.ps.z = 3; }} }})()""")
    await pg.wait_for_timeout(900)
    downed = await ev(f"{G}.match.interp.newest.players.find(p => p.id === {G}.match.localId).downed")
    if not downed: failures.append(f'{vw}: not downed (squadmates {await ev("JSON.stringify(window.__mates)")}, me alive {await ev(f"{G}.match.sim.byId.get({G}.match.localId).alive")})')
    await pg.wait_for_timeout(600)
    await shot('09-downed')
    # Crawl a little (the pose reads moving), then the squadmate's revive: bars over both, captured part way.
    try:
        await pg.wait_for_function(f'({G}.match.interp.newest.players.find(p => p.id === {G}.match.localId).reviveK ?? 0) > 0.35', timeout=20000)
        await shot('09b-reviving')
    except Exception:
        failures.append(f'{vw}: no revive in progress seen')
    try:
        await pg.wait_for_function(f'!{G}.match.interp.newest.players.find(p => p.id === {G}.match.localId).downed', timeout=20000)
        await pg.wait_for_timeout(400)
        await shot('10-revived')
    except Exception:
        failures.append(f'{vw}: no squadmate revived the human')
    # The zoomed minimap, then the full map from it, and a landing ping put on it.
    await pg.locator('.minimap').screenshot(path=f'{OUT}/10b-minimap-{vw}x{vh}.png')
    await ev("document.querySelector('.minimap').click()")
    await pg.wait_for_timeout(500)
    box = await pg.locator('.br-map canvas').bounding_box()
    await pg.mouse.click(box['x'] + box['width'] * 0.55, box['y'] + box['height'] * 0.45)
    await pg.wait_for_timeout(600)
    pings = await ev(f"{G}.match.hud.brHud.pings.length")
    if pings < 1: failures.append(f'{vw}: a tap on the map put no ping')
    await shot('11-fullmap')
    await pg.locator('.br-map-close').click()
    # The end: every other squad finished off on the host.
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId);
      for (let k = 0; k < 3; k++) for (const p of sim.players) if (p.team !== me.team && p.alive) {{ p.brAir = 0; sim._damage(p, me, 999, me.ps.weapon, 10); }} }})()""")
    await pg.wait_for_selector('.rs', timeout=30000)
    await pg.wait_for_timeout(2500)
    await shot('12-results')
    skip = pg.locator('[data-act="resSkip"]')
    if await skip.count(): await skip.first.click()
    await pg.wait_for_timeout(2500)
    await shot('13-results-done')
    word = await ev("document.querySelector('.rs-word h2')?.textContent")
    if word != 'Victory': failures.append(f'{vw}: results say {word!r}')
    print(f'{vw}x{vh}: took {took} items, inventory {inv}, armor {armor}, downed {downed}, results {word!r}')
    await ctx.close()


async def lobby_shots(browser, vw, vh, failures, errors):
    # A friend room: the squad size option on the lobby (once the room plays BR) and under the vote cards.
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'lobby {vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'lobby {vw}: PAGEERR {e}'))
    ev = lambda js: pg.evaluate(js)
    await pg.goto(f'http://localhost:{PORT}/?debug=1&net=local&vote=30')
    await pg.wait_for_timeout(900)
    await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="host"]').first.click()
    await pg.wait_for_function(f'{G}.code')
    await ev(f"{G}.lastPlayed = {{ mode: 'br', mapId: 'frontier' }}")
    await pg.locator('[data-act="moveTeam"]').first.click()      # Any lobby repaint picks up the BR room.
    await pg.wait_for_timeout(500)
    if await pg.locator('.br-size').count() == 0: failures.append(f'lobby {vw}: no squad size option after a BR match')
    await pg.locator('.br-size [data-n="2"]').click()
    await pg.wait_for_timeout(400)
    await pg.screenshot(path=f'{OUT}/20-lobby-squads-{vw}x{vh}.png')
    if await ev(f'{G}.lobby.brSquad') != 2: failures.append(f'lobby {vw}: Duos not picked')
    await pg.locator('[data-act="start"]').first.click()
    await pg.wait_for_function(f'{G}.vote?.options', timeout=10000)
    await pg.wait_for_timeout(1200)
    await pg.screenshot(path=f'{OUT}/21-vote-squads-{vw}x{vh}.png')
    names = await ev("[...document.querySelectorAll('.vote-card .vc-mode-name')].map(n => n.textContent)")
    if 'BR Duos' not in names: failures.append(f'lobby {vw}: the BR vote card does not say BR Duos ({names})')
    await pg.locator('.br-size [data-n="1"]').click()
    await pg.wait_for_timeout(400)
    names = await ev("[...document.querySelectorAll('.vote-card .vc-mode-name')].map(n => n.textContent)")
    if 'BR Solos' not in names: failures.append(f'lobby {vw}: Solos on the vote did not change the card ({names})')
    print(f'lobby {vw}x{vh}: vote cards {names}')
    await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for vw, vh in ((852, 393), (667, 375), (640, 360)):
                await lobby_shots(browser, vw, vh, failures, errors)
            for vw, vh in ((852, 393), (667, 375), (640, 360)):
                await run(browser, vw, vh, failures, errors)
            await browser.close()
    finally:
        srv.terminate()
    errors = [e for e in errors if 'GL Driver' not in e and 'GPU stall' not in e]
    for e in errors[:20]: print('ERROR', e)
    for f in failures: print('FAIL', f)
    print('ok' if not failures and not errors else f'{len(failures)} failures, {len(errors)} console errors')
    sys.exit(1 if failures or errors else 0)

asyncio.run(main())
