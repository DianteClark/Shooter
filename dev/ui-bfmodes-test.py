#!/usr/bin/env python3
"""Conquest and Breakthrough in a real browser (ROADMAP 65): python3 dev/ui-bfmodes-test.py [port] [outdir]

Serves the repo (python3 -m http.server <port>) and starts from a fresh save each time.
Conquest: Multiplayer, Ground War tab, the Conquest and Breakthrough playlists, Find match, the vote cards (all
Conquest), the match: the flag strip with one chip a flag, the ticket bars on the status plate, the minimap; the local
player killed on the host: the deploy row (Auto, HQ, the flags, enemy flags disabled); a held flag picked and Respawn
tapped: the player comes back on that flag; the enemy's pool emptied: the results say Victory, their tickets ran out.
Breakthrough on Frontier (Custom, ?map=frontier&mode=bt): the sector plate, the island part framed on the minimap,
front lines in the world; the local player walked past the line ahead (as an attacker) or behind (as a defender): the
out-of-bounds plate counts down; the sector falls on the host: the banner, sector two's objectives; the attackers run out
of tickets and die, or every sector falls: the results header says how. Help: the Conquest and Breakthrough cards and
their videos. Screenshots go to outdir (default /tmp/bfmodes). Fails on any console error and on HUD panels that spill
off the screen.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 10137
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/bfmodes'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game.app'
SIZES = [(844, 390), (667, 375)]

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
HUD = ['.mh-status', '.obj-strip', '.bf-oob', '.bf-deploy', '.minimap', '.scorebar']


async def check_fit(pg, sels, tag, failures):
    for b in await pg.evaluate(f"{OVERFLOW}({sels!r})"): failures.append(f'{tag}: off screen: {b}')


async def fresh(browser, vw, vh, errors, query=''):
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'{vw}: PAGEERR {e} {getattr(e, "stack", "")}'))
    await pg.goto(f'http://localhost:{PORT}/?debug=1&vote=2&search=600{query}')
    await pg.wait_for_timeout(900)
    await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1300)
    return ctx, pg


async def conquest(browser, vw, vh, failures, errors):
    tag = f'conquest {vw}x{vh}'
    ctx, pg = await fresh(browser, vw, vh, errors)
    ev = lambda js: pg.evaluate(js)
    async def shot(name):
        print(f'  {tag} {name}', flush=True)
        await pg.screenshot(path=f'{OUT}/cq-{name}-{vw}x{vh}.png')
    await pg.locator('[data-act="multiplayer"]').first.click()
    await pg.wait_for_timeout(600)
    await pg.locator('[data-act="mpTab"][data-tab="groundwar"]').first.click()
    await pg.wait_for_timeout(500)
    names = await ev("[...document.querySelectorAll('[data-act=\"mpPlaylist\"]')].map(n => n.dataset.id).join()")
    for want in ('conquest', 'breakthrough'):
        if want not in names: failures.append(f'{tag}: {want} playlist missing ({names})')
    await pg.locator('[data-act="mpPlaylist"][data-id="conquest"]').first.click()
    await pg.wait_for_timeout(300)
    await shot('01-groundwar-tab')
    await check_fit(pg, ['.mp-pl', '.mp-find', '.mp-tabs'], f'{tag} multiplayer', failures)
    await pg.locator('[data-act="mpFind"]').first.click()
    await pg.wait_for_selector('.vote-card', timeout=30000)
    await pg.wait_for_timeout(500)
    cards = await ev("[...document.querySelectorAll('.vote-card .vc-mode-name')].map(n => n.textContent)")
    if not cards or any(c != 'Conquest' for c in cards): failures.append(f'{tag}: vote cards {cards}')
    await shot('02-vote')
    await pg.wait_for_function(f'{G}.match?.interp.newest?.phase === "live"', timeout=120000)
    mode = await ev(f'{G}.match.mode')
    if mode != 'cq': failures.append(f'{tag}: match mode {mode}')
    await pg.wait_for_timeout(2500)
    info = await ev(f"""(() => {{ const m = {G}.match, o = m.sim.rules.view(), chips = [...document.querySelectorAll('.obj-chips .o-chip')].filter(n => getComputedStyle(n).display !== 'none');
      return {{ flags: o.layout.flags.length, chips: chips.length, strip: getComputedStyle(document.querySelector('.obj-strip')).display, bars: document.querySelectorAll('.mh-status .bf-tk').length, players: m.sim.players.length, map: m.map?.id ?? m.mapId }}; }})()""")
    if info['chips'] != info['flags']: failures.append(f'{tag}: {info["chips"]} chips for {info["flags"]} flags')
    if info['strip'] == 'none': failures.append(f'{tag}: flag strip hidden')
    if info['bars'] != 2: failures.append(f'{tag}: {info["bars"]} ticket bars')
    if info['players'] != 32: failures.append(f'{tag}: {info["players"]} players')
    await shot('03-live')
    await check_fit(pg, HUD, f'{tag} live', failures)
    # Give our side the second flag outright and clear enemies off it, then die: the deploy row offers it.
    me_team = await ev(f"{G}.match.sim.byId.get({G}.match.localId).team")
    await ev(f"""(() => {{ const m = {G}.match, s = m.sim, z = s.rules.zones[1], t = {me_team};
      for (const q of s.rules.zones) if (q !== z && q.owner === t) {{ q.owner = 1 - t; q.cap = t ? -1 : 1; }}
      z.owner = t; z.cap = t ? 1 : -1;
      for (const p of s.players) if (p.team !== t && Math.hypot(p.ps.x - z.x, p.ps.z - z.z) < 30) {{ p.alive = false; p.respawnT = 60; }}
      s._selfKill(s.byId.get(m.localId), 'zone'); }})()""")
    try:
        await pg.wait_for_function("(() => { const d = document.querySelector('.bf-deploy'); return d && !d.hidden && d.getBoundingClientRect().height > 0; })()", timeout=10000)
    except Exception:
        failures.append(f'{tag}: no deploy row on the death screen')
        await shot('04-deploy-missing')
        await ctx.close()
        return
    await pg.wait_for_timeout(700)
    dep = await ev("""[...document.querySelectorAll('.bf-dep')].map(b => [b.dataset.at, b.disabled])""")
    ok = {a: not d for a, d in dep}
    if not ok.get('auto') or not ok.get('hq'): failures.append(f'{tag}: Auto/HQ not offered {dep}')
    flag_b = await ev(f"{G}.match.sim.rules.zones[1].id")
    if not ok.get(flag_b): failures.append(f'{tag}: held flag {flag_b} not offered {dep}')
    if all(ok.get(a) for a, _ in dep): failures.append(f'{tag}: every flag offered, enemy ones too {dep}')
    await shot('04-deploy')
    await check_fit(pg, HUD + ['.death-col'], f'{tag} deploy', failures)
    await pg.locator(f'.bf-dep[data-at="{flag_b}"]').click()
    await pg.wait_for_timeout(300)
    await pg.locator('.death-go').click()
    await pg.wait_for_function(f'{G}.match.sim.byId.get({G}.match.localId).alive', timeout=15000)
    d = await ev(f"(() => {{ const m = {G}.match, p = m.sim.byId.get(m.localId), z = m.sim.rules.zones[1]; return Math.hypot(p.ps.x - z.x, p.ps.z - z.z); }})()")
    if d > 15: failures.append(f'{tag}: deployed {d:.1f} m from flag {flag_b}')
    await pg.wait_for_timeout(1500)
    await shot('05-deployed')
    # Their pool runs dry: Victory, their tickets ran out.
    await ev(f"{G}.match.sim.rules.tickets[1 - {me_team}] = 0")
    await pg.wait_for_selector('.results, [data-screen="results"]', timeout=40000)
    await pg.wait_for_timeout(1500)
    head = await ev("document.body.textContent")
    if 'Victory' not in head or 'tickets' not in head.lower(): failures.append(f'{tag}: results header {head[:200]!r}')
    await shot('06-results')
    await ctx.close()


async def breakthrough(browser, vw, vh, failures, errors):
    tag = f'breakthrough {vw}x{vh}'
    ctx, pg = await fresh(browser, vw, vh, errors, '&map=frontier&mode=bt')
    ev = lambda js: pg.evaluate(js)
    async def shot(name):
        print(f'  {tag} {name}', flush=True)
        await pg.screenshot(path=f'{OUT}/bt-{name}-{vw}x{vh}.png')
    # Building the island's world blocks the page for a while under SwiftShader: click from a timer, then wait.
    await ev("setTimeout(() => document.querySelector('[data-act=\"custom\"]').click(), 0)")
    await pg.wait_for_function(f'{G}.match?.interp.newest?.phase === "live"', timeout=240000, polling=1000)
    await pg.wait_for_timeout(3000)
    st = await ev(f"(() => {{ const m = {G}.match, o = m.sim.rules.view(); return {{ att: o.att, team: m.sim.byId.get(m.localId).team, sub: o.layout.sub, plate: document.querySelector('.mh-status b')?.textContent ?? '', mini: !!m.hud?.modeHud }}; }})()")
    if not st['sub']: failures.append(f'{tag}: Frontier layout is not an island part')
    if ('Attack' if st['att'] == st['team'] else 'Defend') not in st['plate']: failures.append(f'{tag}: plate {st["plate"]!r}')
    await shot('01-live')
    await check_fit(pg, HUD, f'{tag} live', failures)
    # Walk the local player past its line: the out-of-bounds plate counts down.
    await ev(f"""(() => {{ const m = {G}.match, l = m.sim.rules.layout, o = m.sim.rules, b = l.lines[0], ax = l.axis;
      const s = o.att === m.sim.byId.get(m.localId).team ? b + 30 : -40; m.ps.x = ax.ox + ax.dx * s; m.ps.z = ax.oz + ax.dz * s; }})()""")
    try:
        await pg.wait_for_selector('.bf-oob:not([hidden])', timeout=8000)
    except Exception:
        failures.append(f'{tag}: no out-of-bounds plate')
    await pg.wait_for_timeout(1200)
    await shot('02-out-of-bounds')
    await check_fit(pg, HUD, f'{tag} oob', failures)
    # Back in, a few metres short of the line ahead: the plate goes at once, the line glows on the ground.
    await ev(f"""(() => {{ const m = {G}.match, l = m.sim.rules.layout, s = l.lines[0] - 4, ax = l.axis;
      m.ps.x = ax.ox + ax.dx * s; m.ps.z = ax.oz + ax.dz * s; }})()""")
    try:
        await pg.wait_for_selector('.bf-oob', state='hidden', timeout=4000)
    except Exception:
        failures.append(f'{tag}: out-of-bounds plate stays up back inside')
    await pg.wait_for_timeout(1200)
    await shot('02b-front-line')
    # The first sector falls on the host.
    await ev(f"(() => {{ const r = {G}.match.sim.rules; for (const z of r.zones) {{ z.owner = r.att; z.cap = r.att ? 1 : -1; }} }})()")
    await pg.wait_for_function(f'{G}.match.interp.newest?.obj?.sector === 1 || {G}.match.interp.newest?.points?.obj?.sector === 1', timeout=10000)
    await pg.wait_for_timeout(900)
    await shot('03-sector-falls')
    await pg.wait_for_timeout(2500)
    await shot('04-sector-two')
    # Every sector falls: the attackers break through.
    for _ in range(2):
        await ev(f"(() => {{ const r = {G}.match.sim.rules; for (const z of r.zones) {{ z.owner = r.att; z.cap = r.att ? 1 : -1; }} }})()")
        await pg.wait_for_timeout(700)
    await pg.wait_for_selector('.results, [data-screen="results"]', timeout=40000)
    await pg.wait_for_timeout(1500)
    head = await ev("document.body.textContent")
    want = 'Broke through' if st['att'] == st['team'] else 'sectors fell'
    if want not in head: failures.append(f'{tag}: results header {head[:200]!r} (wanted {want!r})')
    await shot('05-results')
    await ctx.close()


async def help_cards(browser, failures, errors):
    tag = 'help'
    ctx, pg = await fresh(browser, 844, 390, errors)
    await pg.evaluate("window.__game.openHelp && window.__game.openHelp('modes')")
    await pg.wait_for_timeout(900)
    text = await pg.evaluate("document.body.innerText")
    for want in ('Conquest', 'Breakthrough'):
        if want not in text: failures.append(f'{tag}: no {want} card')
    card = pg.locator('.help-card', has_text='Conquest').first
    await card.scroll_into_view_if_needed()
    await pg.screenshot(path=f'{OUT}/help-cards-844x390.png')
    await pg.evaluate("window.__game.openHelpVideo && window.__game.openHelpVideo('cq')")
    await pg.wait_for_timeout(9000)
    await pg.screenshot(path=f'{OUT}/help-video-cq-844x390.png')
    await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=ARGS)
            for vw, vh in SIZES:
                await conquest(browser, vw, vh, failures, errors)
            await breakthrough(browser, 844, 390, failures, errors)
            await help_cards(browser, failures, errors)
            await browser.close()
    finally:
        server.terminate()
    errors = [e for e in errors if 'favicon' not in e]
    for f in failures + [f'console: {e}' for e in errors]: print('FAIL', f)
    print('PASS' if not failures and not errors else f'{len(failures) + len(errors)} problem(s)', f'screenshots in {OUT}')
    sys.exit(1 if failures or errors else 0)

asyncio.run(main())
