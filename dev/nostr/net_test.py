"""Public lobbies (local Nostr relay) + held slots (two tabs, ?net=local). Run: python3 dev/nostr/net_test.py"""
import os
import asyncio, subprocess, time, os, sys, json
from playwright.async_api import async_playwright

ROOT = '/home/claude/shooter'
PORT, RPORT = 8473, 7473
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
RELAY = f'ws://localhost:{RPORT},ws://LOCALHOST:{RPORT}/,ws://localhost:7999'   # one real relay twice, one dead
BASE = f'http://localhost:{PORT}/?debug=1&net=local&vote=1&bots=recruit&relay={RELAY}'
SHOTS = '/tmp/nostr-shots'
os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []

def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond: fails.append(what)

async def wait_for(pg, js, timeout=15000, step=250):
    t = 0
    while t < timeout:
        v = await pg.evaluate(js)
        if v: return v
        await pg.wait_for_timeout(step); t += step
    return await pg.evaluate(js)

async def fresh(ctx, name, url=BASE, size=(844, 390)):
    pg = await ctx.new_page()
    await pg.set_viewport_size({'width': size[0], 'height': size[1]})
    pg.on('console', lambda m, n=name: errors.append(f'{n}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e, n=name: errors.append(f'{n} PAGEERR {e}'))
    await pg.goto(url); await pg.wait_for_timeout(700)
    await pg.evaluate(f"window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.name='{name}'")
    await pg.reload(); await pg.wait_for_timeout(900)
    return pg

tap = lambda pg, sel: pg.locator(sel).first.tap()
ROWS = "[...document.querySelectorAll('.br-row')].map(r => ({code: r.dataset.code, text: r.innerText.replace(/\\s+/g,' '), on: !r.classList.contains('is-off')}))"
SLOT = "(id => { const p = window.__game.app.match?.sim.byId.get(id); return p && {away: p.away, open: p.open, isBot: p.isBot, alive: p.alive, kills: p.kills, team: p.team, name: p.name, index: p.index}; })"

async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    relay_log = open('/tmp/relay.log', 'w')
    relay = subprocess.Popen(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'relay.mjs'), str(RPORT)], stdout=relay_log, stderr=subprocess.STDOUT)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True)

            # ---------- Offline state (no reachable relay) ----------
            off = await fresh(ctx, 'Offline', f'http://localhost:{PORT}/?debug=1&net=local&relay=ws://localhost:7999', (667, 375))
            await tap(off, '[data-act="browse"]')
            ok = await wait_for(off, "document.querySelector('.br-empty h2')?.textContent === 'Lobby list offline'", 9000)
            check(ok, 'offline: clear empty state when no relay answers')
            check(await off.locator('[data-act="brCode"]').count() == 1, 'offline: Enter a code offered')
            await off.wait_for_timeout(400)
            await off.screenshot(path=f'{SHOTS}/browse_offline_667.png')
            await tap(off, '[data-act="brCode"]')
            check(await wait_for(off, "document.querySelector('.menu').dataset.screen === 'keypad'"), 'offline: code join still reachable')
            await off.close()

            # ---------- Host goes public ----------
            h = await fresh(ctx, 'Hosty')
            g = await fresh(ctx, 'Guesty', size=(667, 375))
            print('hidden?', await h.evaluate('document.hidden'), await g.evaluate('document.hidden'))
            await tap(g, '[data-act="browse"]')
            check(await wait_for(g, "document.querySelector('.br-empty h2')?.textContent.startsWith('No public games')", 8000), 'browse: empty state while nothing is public')
            await g.screenshot(path=f'{SHOTS}/browse_empty_667.png')
            await tap(h, '[data-act="host"]')
            await h.wait_for_timeout(600)
            code = await h.evaluate('window.__game.app.code')
            await tap(h, '[data-act="lobbyPublic"]')
            check(await h.evaluate('window.__game.app.public') is True, 'host: room marked public')
            rows = await wait_for(g, ROWS, 9000)
            check(any(r['code'] == code for r in rows or []), f'browse: public room {code} listed ({rows})')
            await g.wait_for_timeout(5500)
            rows = await g.evaluate(ROWS)
            check(len([r for r in rows if r['code'] == code]) == 1, 'browse: duplicate relays give one row')
            # Host cannot see its own room.
            own = await h.evaluate("""(async () => { const m = await import('/js/net/lobbies.js');
              const b = new m.LobbyBrowser({ selfId: window.__game.app.net.localId });
              await new Promise(r => setTimeout(r, 6500)); const n = b.list().length; b.close(); return n; })()""")
            check(own == 0, f'host: own room hidden from its list ({own})')
            # Squad tags, and a room from another version.
            res = await g.evaluate("""(async () => { const m = await import('/js/net/lobbies.js');
              const tagged = new m.LobbyBrowser({ squad: 'alpha' }), plain = new m.LobbyBrowser({ squad: '' }), other = new m.LobbyBrowser({ squad: 'BRAVO' });
              const a = new m.LobbyAnnouncer({ squad: 'ALPHA', getInfo: () => ({ code: 'TAGD', host: 'Tagger', pid: 'Pxx', map: 'dust', mode: 'kc', phase: 'lobby', humans: 2, slots: 12, left: 0, open: 0, held: [] }) });
              const { createEvent } = await import('trystero');
              const ws = new WebSocket('ws://localhost:%d');
              await new Promise(r => ws.onopen = r);
              await new Promise(r => setTimeout(r, 1200));
              ws.send(await createEvent('switchyard-6v6-1/lobbies/open', JSON.stringify({ code: 'OLDV', host: 'Oldie', pid: 'Pyy', map: 'neon', mode: 'tdm', phase: 'lobby', humans: 1, slots: 12, v: '0.1', since: 1, seq: 1 })));
              await new Promise(r => setTimeout(r, 6000));
              const out = { tagged: tagged.list().map(l => l.code), plain: plain.list().map(l => l.code), other: other.list().map(l => l.code), old: plain.lobbies.get('OLDV')?.compatible };
              await a.stop(); await new Promise(r => setTimeout(r, 800));
              out.afterStop = tagged.list().map(l => l.code);
              tagged.close(); plain.close(); other.close(); ws.close(); return out; })()""" % RPORT)
            check(res['tagged'] == ['TAGD'], f"squad: tagged room only for the same tag ({res})")
            check('TAGD' not in res['plain'] and 'TAGD' not in res['other'], 'squad: untagged and other-tag phones do not see it')
            check(res['old'] is False, 'version mismatch flagged')
            check(res['afterStop'] == [], 'announcer stop drops the room at once')
            await g.wait_for_timeout(1200)
            old = await wait_for(g, "[...document.querySelectorAll('.br-row.is-old')].map(r => r.dataset.code)", 6000)
            check('OLDV' in (old or []), 'browse: other version greyed out')
            for w, hh in ((667, 375), (852, 393)):
                await g.set_viewport_size({'width': w, 'height': hh}); await g.wait_for_timeout(700)
                await g.screenshot(path=f'{SHOTS}/browse_list_{w}.png')
            # Stale: OLDV stops announcing and is gone within ~15 s.
            gone = await wait_for(g, "!document.querySelector('.br-row[data-code=\"OLDV\"]')", 17000, 500)
            check(gone, 'stale entries vanish')

            # ---------- Join from the list ----------
            await tap(g, f'[data-act="brJoin"][data-code="{code}"]')
            check(await wait_for(h, 'window.__game.app.lobby.humans.length === 2', 15000), 'join from list: guest seated in host lobby')
            await wait_for(g, "document.querySelector('.menu').dataset.screen === 'lobby'")
            check(await g.evaluate('window.__game.app.public') is True, 'guest knows the room is public')
            await g.set_viewport_size({'width': 844, 'height': 390})
            await h.screenshot(path=f'{SHOTS}/lobby_public_host.png')
            await tap(g, '[data-act="toggleReady"]'); await g.wait_for_timeout(500)
            await tap(h, '[data-act="start"]')
            check(await wait_for(h, 'window.__game.app.inMatch', 15000), 'match started on host')
            check(await wait_for(g, 'window.__game.app.inMatch', 15000), 'match started on guest')
            gid = await g.evaluate('window.__game.app.net.localId')
            await h.wait_for_timeout(4000)
            await h.evaluate(f"(p => {{ p.kills = 3; p.score.score = 9000; }})(window.__game.app.match.sim.byId.get('{gid}'))")
            bots = await h.evaluate("window.__game.app.match.sim.players.filter(p => p.isBot).length")

            # ---------- Drop: slot held, no bot ----------
            await g.reload(); await g.wait_for_timeout(800)
            await h.bring_to_front()     # Headless Chrome only runs frames briskly for the front tab; the host's sim needs them.
            st = await wait_for(h, f"({SLOT})('{gid}')?.away && ({SLOT})('{gid}')", 25000)
            check(bool(st) and st['away'] and not st['isBot'] and not st['alive'], f'drop: slot held off the field, no bot ({st})')
            check(await h.evaluate("window.__game.app.match.sim.players.filter(p => p.isBot).length") == bots, 'drop: bot count unchanged')
            await h.evaluate("window.__game.hud.toggleBoard()"); await h.wait_for_timeout(1300)
            txt = await h.evaluate("[...document.querySelectorAll('.lb-away')].map(e => e.textContent)")
            check('Reconnecting' in txt, f'scoreboard shows Reconnecting ({txt})')
            await h.screenshot(path=f'{SHOTS}/board_reconnecting.png')
            await h.evaluate("window.__game.hud.toggleBoard()")
            await g.bring_to_front()
            check(await g.locator('[data-act="rejoin"]').count() == 1, 'title offers Rejoin')
            # The dropped player finds the room in Browse marked as theirs.
            await tap(g, '[data-act="browse"]')
            rows = await wait_for(g, f"({ROWS}).filter(r => r.code === '{code}' && /Rejoin/.test(r.text))", 9000)
            check(bool(rows), f'browse: held slot offers Rejoin to its owner ({rows})')
            await g.screenshot(path=f'{SHOTS}/browse_rejoin.png')
            await tap(g, f'[data-act="brJoin"][data-code="{code}"]')
            check(await wait_for(g, 'window.__game.app.inMatch', 15000), 'rejoin: back in the match')
            st = await wait_for(h, f"!({SLOT})('{gid}').away && ({SLOT})('{gid}')", 8000)
            check(bool(st) and st['kills'] == 3 and not st['isBot'], f'rejoin: own slot with stats ({st})')
            check(await wait_for(g, "window.__game.app.match?.localAlive", 8000), 'rejoin: guest spawned and playing')

            # ---------- Open slot ----------
            await g.reload(); await g.wait_for_timeout(800)
            await h.bring_to_front()
            await wait_for(h, f"({SLOT})('{gid}')?.away", 25000)
            await h.evaluate(f"window.__game.app.match.sim.byId.get('{gid}').awayT = 179")
            print('before open:', await h.evaluate(f"({SLOT})('{gid}')"), await h.evaluate(f"window.__game.app.match.sim.byId.get('{gid}').awayT"))
            check(await wait_for(h, f"({SLOT})('{gid}')?.open", 5000), 'slot opens after the hold')
            print('after:', await h.evaluate(f"window.__game.app.match.sim.byId.get('{gid}').awayT"))
            n = await fresh(ctx, 'Newbie', size=(852, 393))
            await tap(n, '[data-act="browse"]')
            rows = await wait_for(n, f"({ROWS}).filter(r => r.code === '{code}' && /Open slot/.test(r.text) && r.on)", 9000)
            check(bool(rows), f'browse: Open slot listed and joinable ({rows})')
            await n.screenshot(path=f'{SHOTS}/browse_openslot_852.png')
            team = (await h.evaluate(f"({SLOT})('{gid}')"))['team']
            await tap(n, f'[data-act="brJoin"][data-code="{code}"]')
            check(await wait_for(n, 'window.__game.app.inMatch', 15000), 'open slot: newcomer in the match')
            nid = await n.evaluate('window.__game.app.net.localId')
            st = await wait_for(h, f"({SLOT})('{nid}')", 8000)
            check(bool(st) and st['kills'] == 0 and st['team'] == team and st['name'] == 'Newbie' and not st['away'] and not st['isBot'],
                  f'open slot: same seat, fresh stats, no bot ({st})')
            check(await h.evaluate(f"!window.__game.app.match.sim.byId.has('{gid}')"), 'open slot: old id released')
            check(await wait_for(n, 'window.__game.app.match?.localAlive', 8000), 'open slot: newcomer spawned')
            seen = await h.evaluate(f"window.__game.app.match.roster.some(r => r.id === '{nid}' && r.name === 'Newbie')")
            check(seen, 'host roster follows the new owner')
            await n.wait_for_timeout(2000)
            # The old owner can no longer get in by the code: no held slot, nothing open.
            await h.wait_for_timeout(5500)
            await browser.close()
    finally:
        srv.terminate(); relay.terminate(); relay_log.close()
    errs = [e for e in errors if 'ERR_CONNECTION_REFUSED' not in e and 'WebSocket connection' not in e]
    print('console errors:', len(errs)); print('\n'.join(errs[:20]))
    print('ignored socket errors:', len(errors) - len(errs))
    print('FAILED' if fails or errs else 'ALL PASSED', fails)

asyncio.run(main())
