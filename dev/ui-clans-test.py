#!/usr/bin/env python3
"""Player clans and bot chatter in the browser: python3 dev/ui-clans-test.py [port] [outdir]

Serves the repo with python3 -m http.server <port> and drives two tabs over ?net=local (BroadcastChannel).
  host   founds a clan from Profile > Clan with the keypad: a bot clan's tag (VXN) is refused, RAIL is taken; name, colour;
         the Clan screen shows the plate and a join code; Profile shows the tag
  lobby  the host opens a room, the guest joins: the host's seat reads [RAIL] on both tabs; after the career cards swap
         the guest's lobby offers Join [RAIL]; tapping it joins the same clan (same id), and the host re-seats the
         guest as [RAIL] Guesty
  match  both names carry the tag on the roster and the scoreboard; the host runs bot chatter, the guest does not; a
         chatter event shows as a line from the bot in the feed, an enemy's does not, GG does; Options > Bot chatter
         off hides them; quick chat's wheel has the new callouts
  after  results show the tag; the guest's Boards > Clans lists RAIL with both members; leave, then join again with the
         host's code typed on the keypad; the Options toggle is there
Screenshots in outdir.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8371
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/clans'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
G = 'window.__game.app'
URL = f'http://localhost:{PORT}/?debug=1&net=local&vote=5'
CLAN = "import('/js/ui/progress.js').then(m => JSON.stringify(m.Clan.get()))"


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails, errors = [], []
    check = lambda ok, msg: (print(('ok   ' if ok else 'FAIL ') + msg), None if ok else fails.append(msg))
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)

            async def page(tag, name):
                pg = await ctx.new_page()
                pg.on('console', lambda m: errors.append(f'{tag}: {m.text}') if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f'{tag}: PAGEERR {e}'))
                await pg.goto(URL)
                await pg.wait_for_function("!!window.__game?.Progress", timeout=30000)
                # Both tabs share one storage: the guest starts with no clan (the host's stays in its tab's memory).
                await pg.evaluate(f"window.__game.Progress.name='{name}'; window.__game.Progress.setFlag('tutorialOffered'); localStorage.removeItem('switchyard.clan')")
                await pg.reload()
                await pg.wait_for_function("!!window.__game?.Progress", timeout=30000)
                await pg.wait_for_timeout(1000)
                return pg

            async def tap(pg, sel, timeout=20000):
                # no_wait_after: under load Playwright's wait for "scheduled navigations" after a click outlived the timeout.
                await pg.locator(sel).first.click(timeout=timeout, no_wait_after=True)
                await pg.wait_for_timeout(250)

            async def type_keys(pg, text):
                for ch in text:
                    await tap(pg, f'[data-act="kpKey"][data-k="{ch}"]')
                await tap(pg, '[data-act="kpDone"]')

            async def screen(pg):
                return await pg.evaluate("window.__game.menu.el.dataset.screen")

            # ---- Found a clan ----
            print('Found a clan (host)')
            host = await page('host', 'Hosty')
            await tap(host, '[data-act="profile"]')
            await tap(host, '[data-act="pfClan"]')
            check(await screen(host) == 'clan', 'Profile > Clan opens the Clan screen')
            await host.screenshot(path=os.path.join(OUT, 'clan-none-852x393.png'))
            await tap(host, '[data-act="clFound"]')
            await tap(host, '[data-act="clTag"]')
            await type_keys(host, 'VXN')
            toast = await host.evaluate("document.querySelector('.toast')?.textContent ?? ''")
            draft_tag = await host.evaluate("document.querySelector('[data-act=\"clTag\"] b')?.textContent ?? ''")
            check('taken' in toast and draft_tag == 'Pick a tag', f'a bot clan tag is refused: "{toast}", field "{draft_tag}"')
            await tap(host, '[data-act="clTag"]')
            await type_keys(host, 'RAIL')
            await tap(host, '[data-act="clName"]')
            await type_keys(host, 'RAIL_DOGS')
            await tap(host, '[data-act="clColor"][data-i="2"]')
            await tap(host, '[data-act="clMark"][data-i="3"]')
            await host.screenshot(path=os.path.join(OUT, 'clan-edit-852x393.png'))
            await tap(host, '[data-act="clSave"]')
            hc = json.loads(await host.evaluate(CLAN))
            check(hc and hc['tag'] == 'RAIL' and hc['name'] == 'RAIL DOGS' and hc['c'] == 2 and hc['mk'] == 3 and hc.get('own'), f'founded: {hc}')
            code = await host.evaluate("document.querySelector('.cl-codebtn b')?.textContent ?? ''")
            check(len(code.replace('-', '')) >= 16, f'the Clan screen shows a join code: {code}')
            plate = await host.evaluate("document.querySelector('.cl-mine .cl-plate b')?.textContent ?? ''")
            check(plate == 'RAIL', 'and the plate')
            await host.screenshot(path=os.path.join(OUT, 'clan-mine-852x393.png'))
            await tap(host, '[data-act="clBack"]')
            pf = await host.evaluate("document.querySelector('.pf-name .cl-plate b')?.textContent ?? ''")
            check(pf == 'RAIL', f'Profile shows the tag by the callsign: {pf}')
            await tap(host, '[data-act="pfBack"]')

            # ---- Lobby: the guest is offered Join [RAIL] ----
            print('Friend lobby')
            await tap(host, '[data-act="host"]')
            await host.wait_for_function(f'{G}.code')
            room = await host.evaluate(f'{G}.code')
            guest = await page('guest', 'Guesty')
            pages = [host, guest]

            async def juggle():
                while True:
                    for pg in pages:
                        try: await pg.bring_to_front()
                        except Exception: pass
                        await asyncio.sleep(0.12)
            juggler = asyncio.create_task(juggle())
            await guest.evaluate(f"window.__game.join('{room}')")
            await host.wait_for_function(f'{G}.lobby.humans.length === 2', timeout=60000)
            for tag, pg in (('host', host), ('guest', guest)):
                await pg.wait_for_function("[...document.querySelectorAll('.car.human .car-id b')].some(b => b.querySelector('.ctag')?.textContent === 'RAIL')", timeout=10000)
                check(True, f'{tag}: the host\'s seat reads [RAIL] in the lobby')
            await guest.wait_for_selector('[data-act="lobbyClanJoin"]', timeout=15000)
            offer = await guest.evaluate("document.querySelector('[data-act=\"lobbyClanJoin\"]').textContent")
            check('Join [RAIL]' in offer, f'the guest is offered: {offer.strip()}')
            check(await host.locator('[data-act="lobbyClanJoin"]').count() == 0, 'the host (already in it) is not')
            await guest.screenshot(path=os.path.join(OUT, 'lobby-offer-852x393.png'))
            await guest.locator('[data-act="lobbyClanJoin"]').first.click()
            await guest.wait_for_timeout(500)
            gc = json.loads(await guest.evaluate(CLAN))
            check(gc and gc['id'] == hc['id'] and gc['tag'] == 'RAIL' and not gc.get('own'), f'the guest joined the same clan as a member: {gc}')
            await host.wait_for_function(f"{G}.lobby.humans.some(h => h.name === '[RAIL] Guesty')", timeout=10000)
            check(True, 'the host re-seats the guest as [RAIL] Guesty')
            await guest.wait_for_function("!document.querySelector('[data-act=\"lobbyClanJoin\"]')", timeout=10000)
            check(True, 'the offer is gone once joined')

            # ---- Match ----
            print('Match')
            await guest.wait_for_selector('[data-act="toggleReady"]', timeout=10000)
            await guest.locator('[data-act="toggleReady"]').first.click()
            await host.wait_for_function(f'{G}.lobby.humans.every(h => h.ready || h.host)', timeout=10000)
            await host.wait_for_timeout(300)
            await host.locator('[data-act="start"]').first.click()
            await host.wait_for_function(f'{G}.vote?.options', timeout=10000)
            # A 6v6 team mode, so both sides have bots (the chatter checks need a teammate and an enemy). Matched on the
            # card's mode name, not its text: a description can name another mode, and a Ground War, Gunfight or
            # Showdown card leaves the two humans with no bot beside them.
            pick = """(() => { const want = ['Team Deathmatch', 'Kill Confirmed', 'Domination', 'Hardpoint', 'Capture the Flag', 'Headquarters'];
              const cards = [...document.querySelectorAll('.vote-card')].filter(c => !c.classList.contains('random') && !c.querySelector('.vc-gw'));
              for (const w of want) { const i = cards.findIndex(c => c.querySelector('.vc-mode-name')?.textContent.trim() === w); if (i >= 0) return cards[i].dataset.i; }
              return null; })()"""
            idx = await host.evaluate(pick)
            if idx is None:
                # None on offer (a friend vote has a BR card, and 1120 added more modes): the host's first card becomes
                # Railyard TDM (the host resolves the winner from its own options) and everyone votes for it.
                await host.evaluate(f"{G}.vote.options[0] = {{ mapId: 'railyard', mode: 'tdm' }}")
                idx = '0'
            print(f'     vote: card {idx}')
            for pg in pages:
                if idx is not None:
                    # Through the DOM (the card's enter animation can keep it "unstable" past a tap's timeout).
                    try: await pg.wait_for_selector(f'.vote-card[data-i="{idx}"]', state='attached', timeout=15000)
                    except Exception: pass
                    await pg.evaluate(f"document.querySelector('.vote-card[data-i=\"{idx}\"]')?.click()")
            await host.wait_for_function(f'{G}.inMatch && !!{G}.match?.sim', timeout=30000)
            await guest.wait_for_function(f'{G}.inMatch && !!{G}.match', timeout=30000)
            for pg in pages: await pg.evaluate(f"{G}.renderer?.setQuality?.('potato')")
            print('     mode:', await host.evaluate(f"{G}.match.mode"))
            names = await guest.evaluate(f"{G}.matchInfo.roster.filter(r => !r.isBot).map(r => r.name)")
            check(sorted(names) == ['[RAIL] Guesty', '[RAIL] Hosty'], f'both humans carry the tag on the roster: {names}')
            check(await host.evaluate(f"!!{G}.match.chatter") and await guest.evaluate(f"!{G}.match.chatter"), 'the host runs bot chatter, the guest does not')
            await guest.wait_for_timeout(1500)
            # Chatter lines on the guest: a teammate bot's shows, an enemy's does not, GG (an all line) does.
            ids = await guest.evaluate(f"""(() => {{ const r = {G}.matchInfo.roster, me = r.find(x => x.id === {G}.net.localId);
              const mate = r.find(x => x.isBot && x.team === me.team), foe = r.find(x => x.isBot && x.team !== me.team);
              return [mate?.id ?? null, foe?.id ?? null, mate?.name ?? ''] }})()""")
            feed = "[...document.querySelectorAll('.qc-row.qc-bot')].map(r => r.textContent)"
            if ids[0] and ids[1]:
                await guest.evaluate(f"window.__game.hud.onEvents([{{ t: 'chatter', id: '{ids[1]}', l: 0 }}])")
                await guest.wait_for_timeout(100)
                check(len(await guest.evaluate(feed)) == 0, 'an enemy bot\'s "Nice shot" is not shown')
                await guest.evaluate(f"window.__game.hud.onEvents([{{ t: 'chatter', id: '{ids[0]}', l: 0 }}])")
                await guest.wait_for_timeout(100)
                rows = await guest.evaluate(feed)
                check(len(rows) == 1 and 'Nice shot' in rows[0], f'a teammate bot\'s line shows in the feed: {rows}')
                await guest.evaluate(f"window.__game.hud.onEvents([{{ t: 'chatter', id: '{ids[1]}', l: 11 }}])")
                await guest.wait_for_timeout(100)
                rows = await guest.evaluate(feed)
                check(any('GG' in r for r in rows), f'an enemy\'s GG is for everyone: {rows}')
                await guest.screenshot(path=os.path.join(OUT, 'match-chatter-852x393.png'))
                await guest.evaluate("window.__game.Options.set('botChatter', false)")
                # Count the line itself: other rows fade out meanwhile on a slow machine, so the feed's length can drop.
                reloading = f"{feed}.filter(t => t.includes('Reloading')).length"
                before = await guest.evaluate(reloading)
                await guest.evaluate(f"window.__game.hud.onEvents([{{ t: 'chatter', id: '{ids[0]}', l: 2 }}])")
                await guest.wait_for_timeout(100)
                check(await guest.evaluate(reloading) <= before, 'Options > Bot chatter off hides the lines')
                await guest.evaluate("window.__game.Options.set('botChatter', true)")
            else:
                check(False, f'bots on both sides to test chatter: {ids}')
            wheel = await guest.evaluate("[...document.querySelectorAll('.qc-wheel .qc-item b')].map(b => b.textContent)")
            check(len(wheel) >= 13 and ('Push up' in wheel or 'Need a revive!' in wheel or 'Planting' in wheel), f'the quick chat wheel has the new callouts: {wheel}')
            # The scoreboard shows the tags (open it on the guest).
            await guest.evaluate("window.__game.hud.boardOpen || window.__game.hud.toggleBoard()")
            await guest.wait_for_timeout(400)
            tags = await guest.evaluate("[...document.querySelectorAll('.ctag')].map(t => t.textContent)")
            check(tags.count('RAIL') >= 2, f'the HUD (scoreboard or feed) shows the RAIL tag on both humans: {tags.count("RAIL")} of {len(tags)} plates')
            await guest.screenshot(path=os.path.join(OUT, 'match-board-852x393.png'))
            await host.evaluate(f"(() => {{ const s = {G}.match.sim; if (s.phase !== 'ended') s._end(0); }})()")
            for pg in pages:
                await pg.wait_for_function("window.__game.menu.el.dataset.screen === 'results'", timeout=40000)
            await host.wait_for_timeout(9000)
            res = await guest.evaluate("[...document.querySelectorAll('#ui .ctag')].map(t => t.textContent)")
            check(res.count('RAIL') >= 2, f'results show the tag on both: {res.count("RAIL")} RAIL of {len(res)}')
            await guest.screenshot(path=os.path.join(OUT, 'results-852x393.png'))
            juggler.cancel()
            # Out of the room before the menus: the host's rematch countdown opens the next vote on its own, and a vote
            # takes the guest's screen wherever they are (the Clan screen too), so tapping Leave there raced it.
            # By now the vote may have taken the results over (RESULTS_MIN_MS), or the next match begun: leave from there.
            await guest.bring_to_front()
            for _ in range(60):
                if await guest.evaluate(f"!{G}.net"): break
                # The results reel (Skip) and the Unlocked summary it opens over the results (Continue) come first: the
                # summary covers resMenu, so a tap there never lands (bug sweep 2026-11-20 test 1).
                for sel in ('.res-skip:not([hidden])', '.overlay.show [data-act="uxDone"]', '[data-act="resMenu"]', '[data-act="voteLeave"]', '[data-act="leaveLobby"]', '[data-act="qolYes"]'):
                    loc = guest.locator(sel)
                    if await loc.count() and await loc.first.is_visible():
                        try: await loc.first.click(timeout=3000)
                        except Exception: pass
                        break
                await guest.wait_for_timeout(500)
            await guest.wait_for_timeout(500)
            check(await guest.evaluate(f"!{G}.net"), f'the guest left the room: {await screen(guest)}')
            # The host's tab would play on alone (its next vote, a bot match) and starve the guest's taps on a busy machine.
            await host.close()

            # ---- Boards > Clans ----
            print('Boards and leaving')
            await guest.bring_to_front()
            await guest.evaluate(f"import('/js/ui/boards.js').then(m => m.boardsScreen(window.__game.menu, {{ onBack: () => {{}}, myId: {G}.net?.localId ?? 'me', view: 'clans', cat: 'kills' }}))")
            await guest.wait_for_timeout(700)
            rows = await guest.evaluate("[...document.querySelectorAll('.bd-body .cl-row')].map(r => [r.querySelector('.cl-plate b')?.textContent, r.querySelector('.cl-n')?.textContent, r.classList.contains('mine')])")
            mine = [r for r in rows if r[0] == 'RAIL']
            check(len(rows) >= 24 and mine and mine[0][1] == '2' and mine[0][2], f'Boards > Clans: {len(rows)} clans, RAIL with 2 members, marked yours: {mine}')
            detail = await guest.evaluate("[...document.querySelectorAll('.cld-m b')].map(b => b.textContent)")
            check(any('Guesty' in d for d in detail) and any('Hosty' in d for d in detail), f'its detail lists both: {detail}')
            await guest.screenshot(path=os.path.join(OUT, 'boards-clans-852x393.png'))
            # Leave, then join with the host's code on the keypad.
            await guest.evaluate("import('/js/ui/clanscreen.js').then(m => m.clanScreen(window.__game.menu, { onBack: () => {} }))")
            await guest.wait_for_timeout(400)
            await guest.screenshot(path=os.path.join(OUT, 'clan-member-852x393.png'))
            await tap(guest, '[data-act="clLeave"]')
            check(json.loads(await guest.evaluate(CLAN)) is not None, 'the first tap on Leave only asks')
            await tap(guest, '[data-act="clLeave"]')
            check(json.loads(await guest.evaluate(CLAN)) is None, 'the second leaves')
            await tap(guest, '[data-act="clCode"]')
            await type_keys(guest, code.replace('-', ''))
            gc2 = json.loads(await guest.evaluate(CLAN))
            check(gc2 and gc2['id'] == hc['id'] and gc2['tag'] == 'RAIL', f'joined again with the code typed on the keypad: {gc2}')
            # Options: the Bot chatter toggle.
            await guest.evaluate("window.__game.menu.options({ onBack: () => {} })")
            await guest.wait_for_timeout(400)
            check(await guest.locator('[data-act="optBotChatter"]').count() == 1, 'Options has the Bot chatter toggle')
            await tap(guest, '[data-act="optBotChatter"]')
            check(await guest.evaluate("window.__game.Options.get('botChatter')") is False, 'and it switches chatter off')
            await browser.close()
    finally:
        srv.terminate()
    errors = [e for e in errors if 'favicon' not in e]
    for e in errors: print('ERROR', e)
    print('FAILED' if fails or errors else 'all ok')
    sys.exit(1 if fails or errors else 0)


asyncio.run(main())
