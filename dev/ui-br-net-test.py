#!/usr/bin/env python3
"""Battle royale with two humans over ?net=local (two tabs, BroadcastChannel): python3 dev/ui-br-net-test.py [port] [outdir]

The host opens a room, a second tab joins, the room votes the Battle Royale card, and both land in one squad. Checks:
same squad; the guest jumps and lands on its own phone; a gun the host hands the guest reaches the guest's own player
(brgive); the guest's loot table mirrors the host's after changes; the guest's per-guest snapshot carries its inventory;
the guest's tab closing leaves its character standing and not bot-driven, and the guest rejoins into it.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8274
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/br-mode'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']   # Both tabs keep running.
G = 'window.__game.app'
URL = f'http://localhost:{PORT}/?debug=1&net=local&vote=15&brtest'


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails, errors = [], []
    check = lambda ok, msg: (print(('ok   ' if ok else 'FAIL ') + msg), None if ok else fails.append(msg))
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 568, 'height': 320}, has_touch=True, is_mobile=True)
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
            # Two tabs in one window: only the one in front gets animation frames, and the host's match runs on them.
            # Hand the front back and forth so both keep running.
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
            i = await host.evaluate(f"(() => {{ const o = {G}.vote.options; const k = o.findIndex(x => x.mode === 'br'); return k >= 0 ? k : o.findIndex(x => x.mode === 'brduo'); }})()")
            check(i >= 0, f'the friend vote offers Battle Royale (card {i})')
            # Two SwiftShader tabs cannot draw Frontier fast enough to keep the host's clock near real time: play the card
            # on the small test map (the host resolves the winning card, so this is all it takes).
            await host.evaluate(f"{G}.vote.options[{i}].mapId = 'brtest'")
            for pg in (host, guest):
                await pg.wait_for_selector(f'.vote-card[data-i="{i}"]', timeout=10000)
                await pg.locator(f'.vote-card[data-i="{i}"]').click(timeout=4000)
            for _ in range(30):
                st = await host.evaluate(f"JSON.stringify([{G}.inMatch, {G}.vote && {G}.vote.winner, {G}.vote && {G}.vote.left, {G}.matchInfo && {G}.matchInfo.mapId, !!({G}.match && {G}.match.interp.newest)])")
                if st.endswith("true]"):
                    print("     started", await host.evaluate(f"JSON.stringify([{G}.matchInfo.mapId, {G}.matchInfo.mode, {G}.match.mode, !!{G}.match.interp.newest.br])"))
                    break
                print('     host', st)
                await host.wait_for_timeout(2000)
            await host.wait_for_function(f'{G}.match?.interp.newest?.br', timeout=90000)
            for _ in range(15):
                st = await guest.evaluate(f"JSON.stringify([{G}.inMatch, !!{G}.match, {G}.match && {G}.match.interp.buffer.length, {G}.match && {G}.match.mode, {G}.matchInfo && {G}.matchInfo.mapId])")
                if '"br' in st and ',true,' in st and not ',0,' in st: break
                print('     guest', st)
                await guest.wait_for_timeout(2000)
            await guest.wait_for_function(f'{G}.match?.interp.newest?.br', timeout=90000)
            for pg in (host, guest): await pg.evaluate(f"{G}.renderer?.setQuality?.('potato')")   # Two software-rendered tabs.
            hid = await host.evaluate(f'{G}.match.localId')
            gid = await guest.evaluate(f'{G}.match.localId')
            teams = await host.evaluate(f"[{G}.match.sim.byId.get('{hid}').team, {G}.match.sim.byId.get('{gid}').team, {G}.match.mode]")
            check(teams[0] == teams[1] and teams[2] in ('br', 'brduo'), f'both humans in one squad ({teams})')
            for _ in range(20):
                st = await guest.evaluate(f"[{G}.match.interp.newest.phase, {G}.match.interp.newest.br.plane.f, {G}.match.interp.buffer.length]")
                hs = await host.evaluate(f"[{G}.match.sim.phase, {G}.match.sim.br.plane.f, {G}.match.sim.tick]")
                if st[0] == 'live' and st[1] > 0.25: break
                print('     waiting', st, hs)
                await guest.wait_for_timeout(2000)
            await guest.screenshot(path=f'{OUT}/net-guest-flight.png')
            await guest.evaluate(f"{G}.match.brCommand('jump')")
            await host.evaluate(f"{G}.match.brCommand('jump')")
            await guest.wait_for_function(f'{G}.match.brAir === 0', timeout=60000)
            await host.wait_for_function(f"{G}.match.sim.byId.get('{gid}').brAir === 0", timeout=60000)
            check(True, 'the guest jumped and landed, and the host saw it')
            # A gun handed over by the host reaches the guest's own player.
            await host.evaluate(f"""(() => {{ const sim = {G}.match.sim, g = sim.byId.get('{gid}'); g.spawnProtect = 999; sim.byId.get('{hid}').spawnProtect = 999;
              const it = sim.br._addItem({{ kind: 0, v: 0, r: 3, n: 1, x: g.ps.x, z: g.ps.z }}); sim.br._takeGun(g, it, 0); }})()""")
            await guest.wait_for_timeout(1200)
            gun = await guest.evaluate(f"[{G}.match.ps.primary, {G}.match.ps.defs[0].rarity]")
            check(gun[0] == 'ar' and gun[1] == 3, f'the guest phone armed the handed gun ({gun})')
            await guest.wait_for_timeout(1500)
            counts = await host.evaluate(f"{G}.match.sim.br.items.filter(Boolean).length")
            gcounts = await guest.evaluate(f"{G}.match.sim.br.items.filter(Boolean).length")
            check(abs(counts - gcounts) <= 2, f'guest loot table follows the host ({gcounts} / {counts})')
            inv = await guest.evaluate(f"JSON.stringify({G}.match.interp.newest.br.inv)")
            check(inv != 'null', f'guest snapshot carries its own inventory {inv}')
            snap = await host.evaluate(f"JSON.stringify({G}.match.sim.encodeSnapshotFor('{gid}')).length")
            print(f'     per-guest snapshot {snap} bytes')
            await guest.screenshot(path=f'{OUT}/net-guest-ground.png')
            await host.screenshot(path=f'{OUT}/net-host-ground.png')
            # The guest drops: the character stays standing, nobody drives it.
            pages['list'] = [host]
            pid = await guest.evaluate("sessionStorage.getItem('switchyard-player')")
            await guest.close()
            await host.wait_for_function(f"{G}.match.sim.byId.get('{gid}').away", timeout=60000)
            st = await host.evaluate(f"(() => {{ const p = {G}.match.sim.byId.get('{gid}'); return [p.alive, !!p.bot, p.isBot]; }})()")
            check(st[0] and not st[1] and not st[2], f'held slot: standing, not bot-driven ({st})')
            # The same phone coming back: the same player id (a tab keeps it in sessionStorage under ?net=local).
            guest = await page('guest2')
            await guest.evaluate(f"sessionStorage.setItem('switchyard-player', '{pid}')")
            await guest.reload()
            await guest.wait_for_timeout(1500)
            pages['list'] = [host, guest]
            await guest.evaluate(f"window.__game.join('{code}')")
            await guest.wait_for_function(f'{G}.match?.interp.newest?.br', timeout=90000)
            await guest.wait_for_timeout(2500)
            back = await guest.evaluate(f"[{G}.match.brAir, {G}.match.ps.primary, {G}.match.localAlive, {G}.match.sim.br.items.filter(Boolean).length]")
            check(back[0] == 0 and back[1] == 'ar' and back[2], f'the guest rejoined into its own character ({back})')
            await guest.screenshot(path=f'{OUT}/net-guest-rejoined.png')
            # Host migration: the host gives the guest two plates and a medkit, someone on another squad goes down, and a
            # supply cache opens. Once a backup has gone out (every 3 s) the host's tab closes and the guest carries on.
            await host.evaluate(f"""(() => {{ const sim = {G}.match.sim, g = sim.byId.get('{gid}'); g.br.plates = 2; g.br.meds = 1;
              const foe = sim.players.find(p => p.team !== g.team && p.alive && p.isBot && !p.brAir && sim.players.some(q => q !== p && q.team === p.team && q.alive && !q.brAir));
              if (foe) {{ foe.spawnProtect = 0; sim._damage(foe, g, 400, 'ar', 10); }}
              const c = sim.br._addItem({{ kind: 7, v: 1, r: 3, n: 1, x: g.ps.x + 0.5, z: g.ps.z }}); sim.br._openChest(c); }})()""")
            await guest.wait_for_timeout(4500)
            before = await host.evaluate(f"""(() => {{ const sim = {G}.match.sim, b = sim.br; return {{ phase: b.phase, state: b.state, r: b.circle.r, nx: b.next.x, items: b.items.filter(Boolean).length,
              downed: sim.players.filter(p => p.downed).map(p => p.id), plates: sim.byId.get('{gid}').br.plates }}; }})()""")
            mirror = await guest.evaluate(f'{G}.match.sim.br.items.filter(Boolean).length')
            pages['list'] = [guest]
            await host.close()
            await guest.wait_for_function(f'{G}.isHost && {G}.match?.isHost', timeout=60000)
            after = await guest.evaluate(f"""(() => {{ const sim = {G}.match.sim, b = sim.br; return {{ phase: b.phase, state: b.state, r: b.circle.r, nx: b.next.x, items: b.items.filter(Boolean).length,
              downed: sim.players.filter(p => p.downed).map(p => p.id), plates: sim.byId.get('{gid}').br.plates, auth: b.authority, tick: sim.tick, away: !!sim.byId.get('{hid}').away,
              hostAlive: sim.byId.get('{hid}').alive, hostBot: !!sim.byId.get('{hid}').bot }}; }})()""")
            print('     before', before)
            print('     after ', after)
            check(after['auth'] and after['phase'] == before['phase'] and abs(after['nx'] - before['nx']) < 0.5 and abs(after['r'] - before['r']) < 8, 'the new host restored the circle')
            check(abs(after['items'] - mirror) <= 4, f"the new host kept the loot on the ground and the opened cache ({after['items']} / {mirror} mirrored, {before['items']} on the old host)")
            check(after['plates'] == before['plates'], f"the new host kept the guest's plates ({after['plates']})")
            check(set(before['downed']) <= set(after['downed']) or len(after['downed']) >= len(before['downed']) - 1, f"downs carried over ({before['downed']} -> {after['downed']})")
            check(after['away'] and not after['hostBot'], 'the old host is held, never bot-driven')
            t0 = after['tick']
            await guest.wait_for_timeout(2000)
            t1 = await guest.evaluate(f'{G}.match.sim.tick')
            check(t1 > t0 + 20, f'the match runs on the new host ({t0} -> {t1})')
            await guest.screenshot(path=f'{OUT}/net-migrated.png')
            juggler.cancel()
            await browser.close()
    except Exception as err:
        fails.append(f'exception: {str(err)[:300]}')
    finally:
        srv.terminate()
    errors = [e for e in errors if 'GL Driver' not in e and 'GPU stall' not in e]
    for e in errors[:20]: print('ERROR', e)
    for f in fails: print('FAIL', f)
    print('ok' if not fails and not errors else f'{len(fails)} failures, {len(errors)} console errors')
    sys.exit(1 if fails or errors else 0)

asyncio.run(main())
