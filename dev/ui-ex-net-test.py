#!/usr/bin/env python3
"""Extraction with two humans in one squad over ?net=local (two tabs, BroadcastChannel):
python3 dev/ui-ex-net-test.py [port] [outdir]

The host opens a room, a second tab joins, the room's vote card is set to Extraction Quads, and both land in one squad.
Checks: same squad, both phones show the squad's contract; primary ammo the host hands the guest reaches the guest's own
gun (exammo); the guest goes down and the host revives it; the guest calls the helicopter from its own phone; both hold
the zone and are lifted out; both see the extraction results. The small BR test map keeps two software-rendered tabs
near real time.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8364
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/exfil'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
G = 'window.__game.app'
URL = f'http://localhost:{PORT}/?debug=1&net=local&vote=15&brtest'


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails, errors = [], []
    check = lambda ok, msg: (print(('ok   ' if ok else 'FAIL ') + msg, flush=True), None if ok else fails.append(msg))
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=ARGS)
            ctx = await browser.new_context(viewport={'width': 667, 'height': 375}, has_touch=True, is_mobile=True)
            async def page(tag):
                pg = await ctx.new_page()
                pg.on('console', lambda m: errors.append(f'{tag}: {m.text}') if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f'{tag}: PAGEERR {e} {getattr(e, "stack", "")[:600]}'))
                await pg.goto(URL)
                await pg.wait_for_timeout(900)
                return pg
            host = await page('host')
            await host.evaluate("window.__game.Progress.name='Hosty'; window.__game.Progress.setFlag('tutorialOffered')")
            await host.reload()
            await host.wait_for_timeout(1000)
            await host.locator('[data-act="host"]').first.click()
            await host.wait_for_function(f'{G}.code')
            code = await host.evaluate(f'{G}.code')
            guest = await page('guest')
            await guest.evaluate("window.__game.Progress.name='Guesty'; window.__game.Progress.setFlag('tutorialOffered')")
            pages = {'list': [host, guest]}
            async def juggle():
                while True:
                    for pg in list(pages['list']):
                        try: await pg.bring_to_front()
                        except Exception: pass
                        await asyncio.sleep(0.12)
            juggler = asyncio.create_task(juggle())
            await guest.evaluate(f"window.__game.join('{code}')")
            await host.wait_for_function(f'{G}.lobby.humans.length === 2', timeout=60000)
            await guest.wait_for_selector('[data-act="toggleReady"]', timeout=10000)
            await guest.locator('[data-act="toggleReady"]').first.click()
            await host.wait_for_function(f'{G}.lobby.humans.every(h => h.ready || h.host)', timeout=10000)
            await host.wait_for_timeout(300)
            await host.locator('[data-act="start"]').first.click()
            await host.wait_for_function(f'{G}.vote?.options', timeout=10000)
            # The host resolves the winning card: make the first one Extraction Quads on the small test map.
            await host.evaluate(f"{G}.vote.options[0] = {{ ...{G}.vote.options[0], mapId: 'brtest', mode: 'exq' }}")
            for pg in (host, guest):
                await pg.wait_for_selector('.vote-card[data-i="0"]', timeout=10000)
                await pg.evaluate("document.querySelector('.vote-card[data-i=\"0\"]').click()")
            for tag, pg in (('host', host), ('guest', guest)):
                for _ in range(40):
                    st = await pg.evaluate(f"JSON.stringify([{G}.inMatch, {G}.vote && {G}.vote.winner, {G}.vote && {G}.vote.left, {G}.matchInfo && {G}.matchInfo.mapId, {G}.matchInfo && {G}.matchInfo.mode, !!({G}.match && {G}.match.interp.newest), !!({G}.match?.interp.newest?.points?.obj?.ex)])")
                    if st.endswith('true]'): break
                    print('    ', tag, st, flush=True)
                    await pg.wait_for_timeout(3000)
                try: await pg.wait_for_function(f'{G}.match?.interp.newest?.points?.obj?.ex', timeout=40000)
                except Exception:
                    if tag != 'guest': raise
                    # The two-tab channel sometimes leaves a guest without snapshots; the same phone rejoins its held slot.
                    print('     guest has no snapshots: rejoining', flush=True)
                    await guest.reload()
                    await guest.wait_for_timeout(1500)
                    await guest.evaluate(f"window.__game.join('{code}')")
                    await guest.wait_for_function(f'{G}.match?.interp.newest?.points?.obj?.ex', timeout=90000)
            for pg in (host, guest): await pg.evaluate(f"{G}.renderer?.setQuality?.('potato')")
            hid = await host.evaluate(f'{G}.match.localId')
            gid = await guest.evaluate(f'{G}.match.localId')
            info = await host.evaluate(f"[{G}.match.sim.byId.get('{hid}').team, {G}.match.sim.byId.get('{gid}').team, {G}.match.mode]")
            check(info[0] == info[1] and info[2] == 'exq', f'both humans in one squad of an Extraction match ({info})')
            await host.wait_for_function(f'{G}.match.sim.phase === "live" && {G}.match.sim.rules.squads.get({info[0]}).contract', timeout=90000)
            # Shield the squad and keep the AI off it; the guest reads its contract from the wire.
            await host.evaluate(f"""(() => {{ const sim = {G}.match.sim;
              window.__keep = setInterval(() => {{ for (const p of sim.players) {{ if (p.team === {info[0]}) p.spawnProtect = window.__noShield ? 0 : 99; if (p.ai && p.alive) {{ p.alive = false; p.hp = 0; p.exGroup = null; }} }} }}, 150); }})()""")
            for _ in range(12):
                await guest.wait_for_timeout(1000)
                ok = await guest.evaluate(f"(() => {{ const v = {G}.match.interp.newest, o = v.obj ?? v.points.obj; return !!o.squads.find(q => q.team === {info[0]})?.contract; }})()")
                if ok: break
            hc = await host.evaluate(f"(() => {{ const c = {G}.match.sim.rules.squads.get({info[0]}).contract; return c && c.type + '@' + c.poi; }})()")
            gc = await guest.evaluate(f"(() => {{ const v = {G}.match.interp.newest, o = v.obj ?? v.points.obj, s = o.squads.find(q => q.team === {info[0]}); return s?.contract && s.contract.type + '@' + s.contract.poi; }})()")
            gcard = await guest.evaluate("!document.querySelector('.ex-con').hidden && document.querySelector('.ex-con b').textContent")
            check(hc and hc == gc and gcard, f'the guest phone shows the squad contract ({gc} / host {hc}, card {gcard!r})')
            await guest.screenshot(path=f'{OUT}/net-guest-start.png')
            # Primary ammo handed to the guest's own gun.
            await guest.evaluate(f"{G}.match.ps.reserve[0] = 0")
            await host.evaluate(f"{G}.match.sim.rules._giveAmmo({G}.match.sim.byId.get('{gid}'), 2)")
            await guest.wait_for_timeout(1500)
            res = await guest.evaluate(f"{G}.match.ps.reserve[0]")
            check(res > 0, f'ammo from the host reached the guest phone (reserve {res})')
            # The guest goes down; the host stands by it and brings it back.
            await host.evaluate(f"""(() => {{ window.__noShield = true; const sim = {G}.match.sim, g = sim.byId.get('{gid}'), foe = sim.players.find(p => p.team !== g.team && !p.ai);
              for (const p of sim.players) if (p.team === g.team) p.spawnProtect = 0; sim._damage(g, foe, 500, 'ar', 10); }})()""")
            await guest.wait_for_function("!document.querySelector('.ex-down').hidden", timeout=20000)
            await guest.screenshot(path=f'{OUT}/net-guest-down.png')
            check(True, 'the guest went down and its phone shows the down panel')
            gx = await host.evaluate(f"(() => {{ const g = {G}.match.sim.byId.get('{gid}'); return [g.ps.x, g.ps.z]; }})()")
            await host.evaluate(f"(() => {{ const m = {G}.match; m.ps.x = {gx[0]} + 1; m.ps.z = {gx[1]}; m.ps.vx = 0; m.ps.vz = 0; }})()")
            await host.wait_for_function(f"!{G}.match.sim.byId.get('{gid}').downed", timeout=60000)
            await host.evaluate("window.__noShield = false")
            check(True, 'the host revived the guest')
            # Exfil: open the first window, the guest walks into a zone and calls it from its phone.
            site = await host.evaluate(f"""(() => {{ const R = {G}.match.sim.rules; R.t = Math.max(R.t, 211); R._stepWindows(); const e = R.exfils.find(x => x.state === 1); return [e.i, e.x, e.z]; }})()""")
            await guest.evaluate(f"(() => {{ const m = {G}.match; m.ps.x = {site[1]}; m.ps.z = {site[2]}; }})()")
            await host.evaluate(f"(() => {{ const m = {G}.match; m.ps.x = {site[1]} + 2; m.ps.z = {site[2]} + 1; }})()")
            await guest.wait_for_selector('.ex-call:not([hidden])', timeout=20000)
            await guest.locator('.ex-call').first.click()
            await host.wait_for_function(f"{G}.match.sim.rules.exfils[{site[0]}].state === 2", timeout=20000)
            caller = await host.evaluate(f"{G}.match.sim.rules.exfils[{site[0]}].caller")
            check(caller == info[0], f'the guest called the helicopter for the squad (caller {caller})')
            await host.evaluate(f"""(() => {{ const R = {G}.match.sim.rules; R.exfils[{site[0]}].timer = 0.5;
              for (const q of {G}.match.sim.players) if (!q.ai && q.team !== {info[0]}) {{ q.ps.x = 5 + q.index; q.ps.z = 5; }} }})()""")
            await host.wait_for_function(f"{G}.match.sim.rules.exfils[{site[0]}].state === 3", timeout=30000)
            await guest.wait_for_timeout(1500)
            await guest.screenshot(path=f'{OUT}/net-guest-hold.png')
            await host.evaluate(f"(() => {{ const e = {G}.match.sim.rules.exfils[{site[0]}]; e.hold = Math.max(e.hold, 8); }})()")
            await host.wait_for_function(f"{G}.match.sim.byId.get('{gid}').ex.out && {G}.match.sim.byId.get('{hid}').ex.out", timeout=60000)
            check(True, 'both humans were lifted out together')
            for tag, pg in (('host', host), ('guest', guest)):
                await pg.wait_for_selector('.menu[data-screen="results"] .rs', timeout=90000)
                await pg.wait_for_timeout(1500)
                word = await pg.evaluate("document.querySelector('.rs-word h2')?.textContent")
                check(word == 'Extracted', f'{tag} results: {word}')
                await pg.screenshot(path=f'{OUT}/net-{tag}-results.png')
            juggler.cancel()
            await browser.close()
    except Exception as err:
        fails.append(f'exception: {str(err)[:400]}')
    finally:
        srv.terminate()
    errors = [e for e in errors if 'GL Driver' not in e and 'GPU stall' not in e]
    for e in errors[:20]: print('ERROR', e)
    for f in fails: print('FAIL', f)
    print('ok' if not fails and not errors else f'{len(fails)} failures, {len(errors)} console errors')
    sys.exit(1 if fails or errors else 0)

asyncio.run(main())
