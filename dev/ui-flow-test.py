#!/usr/bin/env python3
"""The play flow (docs/ROADMAP.md item 14): Multiplayer, Custom Match and Training, end to end in one page.

Run from anywhere: python3 dev/ui-flow-test.py [port] [--shots]. It serves the repo itself and checks:
  Title       Multiplayer, Custom, Quick play, Host, Join; no Play vs bots or Firing range button.
  Multiplayer every tab: a pick (ticked modes, a playlist, BR duos, the featured playlist), the search moment, the
              pre-match vote with 2-3 map options of the tab's tier (one on Battle Royale: a single giant map), a ballot,
              then the match on a map of the right size, with a mode from the pick, mixed bots, the playlist's modifiers.
  Custom      Match: map, mode and difficulty honoured. Host room: the friend lobby carries the custom settings.
  Training    the range (practice), a map with N enemy bots at the chosen difficulty: infinite ammo, no death, each bot
              behaviour (standing still, strafing, rushing), the damage readout, the armory's instant swap, and after a
              session ended with kills: XP, mastery, challenges, history and gun stats all unchanged.
With --shots it also saves the screens at 667x375 and 852x393 to /tmp/mp/.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8334))
SHOTS = '--shots' in sys.argv
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
failures, errors = [], []


def check(name, ok, info=''):
    print(f'  {name:<58} {"ok" if ok else "FAIL"} {info}')
    if not ok: failures.append(f'{name}: {info}')


INFO = """(async () => { const g = window.__game, m = g.app.matchInfo; if (!m) return null;
  const { MAPS, sizeOf } = await import('./js/shared/map.js');
  const map = MAPS[m.mapId], bots = m.roster.filter(r => r.isBot);
  return { mapId: m.mapId, mode: m.mode, mods: m.mods, size: map.size, large: !!map.large, n: m.roster.length,
    skills: [...new Set(bots.map(r => r.skill))], teams: [...new Set(bots.map(r => r.team))], training: m.training,
    practice: !!g.app.match?.isPractice() }; })()"""
# Everything a match could write: the save (flags aside: first-match hints), challenges, history, gun stats.
PROGRESS = """(() => { const out = {};
  for (const k of ['switchyard.save', 'switchyard.challenges', 'switchyard.history', 'switchyard.gunstats']) {
    let v = localStorage.getItem(k);
    if (k === 'switchyard.save' && v) { const o = JSON.parse(v); delete o.flags; delete o.savedAt; delete o.active; v = JSON.stringify(o); }
    out[k] = v; }
  out.xp = window.__game.Progress.totalXp; return out; })()"""


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e} {getattr(e, "stack", "")[:600]}'))
            await pg.goto(f'http://localhost:{PORT}/?debug=1&net=local&vote=8&search=700')
            await pg.wait_for_timeout(900)
            await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
            await pg.reload()
            await pg.wait_for_timeout(1300)

            async def tap(sel, wait=350):
                await pg.locator(sel).first.tap()
                await pg.wait_for_timeout(wait)

            screen = lambda: pg.evaluate("window.__game.menu.el.dataset.screen")
            # Every screen the menu shows, in order: a short moment (the search) is caught however slow the machine.
            await pg.evaluate("window.__screens = []; new MutationObserver(() => window.__screens.push(window.__game.menu.el.dataset.screen)).observe(window.__game.menu.el, { attributes: true, attributeFilter: ['data-screen'] })")
            seen = lambda name: pg.evaluate(f"window.__screens.splice(0).includes('{name}')")

            async def leave():
                await pg.evaluate("window.__game.hud.leaveCb()")
                await pg.wait_for_timeout(500)

            print('Title')
            if SHOTS: await shots(pg, 'title')
            acts = await pg.evaluate("[...document.querySelectorAll('.menu [data-act]')].map(b => b.dataset.act)")
            check('title offers Multiplayer, Custom, Quick play, Host, Join', all(a in acts for a in ('multiplayer', 'custom', 'quickPlay', 'host', 'join')), acts)
            check('no Play vs bots or Firing range on the title', 'solo' not in acts and 'range' not in acts)

            async def find_and_vote(expect_tier, expect_modes, cards=(2, 3)):
                await pg.evaluate("window.__screens.length = 0")
                await tap('[data-act="mpFind"]', 150)
                await pg.wait_for_function("window.__game.menu.el.dataset.screen === 'vote'", timeout=15000)
                check('  search moment shown', await seen('mpsearch'))
                opts = await pg.evaluate("""(async () => { const { MAPS } = await import('./js/shared/map.js'); const { tierOf } = await import('./js/ui/vote.js');
                  return window.__game.app.vote.options.map(o => ({ mapId: o.mapId, mode: o.mode, tier: MAPS[o.mapId].size === 'giant' ? 'giant' : tierOf(o.mapId) })); })()""")
                n_cards = await pg.evaluate("document.querySelectorAll('.vote-card').length")
                check(f'  vote: {cards[0]}-{cards[1]} map options, as many cards', cards[0] <= len(opts) <= cards[1] and n_cards == len(opts), opts)
                check('  options on different maps of the tab tier, picked modes', len({o['mapId'] for o in opts}) == len(opts)
                      and all(o['tier'] in expect_tier and o['mode'] in expect_modes for o in opts), opts)
                await tap('.vote-card[data-i="0"]', 100)
                mine = await pg.evaluate("window.__game.app.vote?.mine")
                # A one-card vote (Battle Royale has one giant map) can resolve before the tap lands.
                check('  ballot cast', mine == 0 or len(opts) == 1, mine)
                await pg.wait_for_function('window.__game.app.inMatch', timeout=20000)
                await pg.wait_for_timeout(600)
                info = await pg.evaluate(INFO)
                check('  match on a map of the right size, a picked mode', tierok(info, expect_tier) and info['mode'] in expect_modes, info)
                return opts, info

            def tierok(info, tiers):
                size = 'huge' if info['large'] and info['size'] != 'giant' else info['size']
                return size in tiers or (info['size'] == 'giant' and 'giant' in tiers)

            print('Multiplayer: Standard, ticked modes')
            await tap('[data-act="multiplayer"]', 600)
            check('Multiplayer screen', await screen() == 'multiplayer')
            if SHOTS: await shots(pg, 'multiplayer-standard')
            pls = await pg.evaluate("[...document.querySelectorAll('.mp-pl')].map(b => b.dataset.id)")
            check('Standard playlists: quick play, objective, party, featured', pls == ['qp', 'obj', 'party', 'featured'], pls)
            n_modes = await pg.evaluate("document.querySelectorAll('.mp-mode').length")
            check('Standard lists the 14 single modes', n_modes == 14, n_modes)
            pickers = await pg.evaluate("document.querySelectorAll('.menu .solo-map, .menu [data-act=\"soloBots\"], .menu .bm-seg').length")
            check('no map or difficulty pickers in Multiplayer', pickers == 0, pickers)
            await tap('[data-act="mpMode"][data-id="tdm"]')
            await tap('[data-act="mpMode"][data-id="dom"]')
            st = await pg.evaluate("({ on: [...document.querySelectorAll('.mp-mode.on')].map(b => b.dataset.id), pl: document.querySelectorAll('.mp-pl.on').length, find: !document.querySelector('.mp-find').disabled })")
            check('two modes ticked, no playlist, Find match open', st['on'] == ['tdm', 'dom'] and st['pl'] == 0 and st['find'], st)
            opts, info = await find_and_vote({'small', 'medium', 'large'}, {'tdm', 'dom'})
            check('  12 players, mixed difficulty bots', info['n'] == 12 and len(info['skills']) > 1, info)
            await leave()

            print('Multiplayer: Ground War')
            await tap('[data-act="multiplayer"]', 500)
            await tap('[data-act="mpTab"][data-tab="groundwar"]')
            if SHOTS: await shots(pg, 'multiplayer-groundwar')
            await tap('[data-act="mpPlaylist"][data-id="gwqp"]')
            opts, info = await find_and_vote({'huge'}, {'gwtdm', 'gwdom', 'gwhq', 'gwko', 'gwinf'})
            check('  32 players', info['n'] == 32, info['n'])
            await leave()

            print('Multiplayer: Battle Royale')
            await tap('[data-act="multiplayer"]', 500)
            await tap('[data-act="mpTab"][data-tab="br"]')
            pls = await pg.evaluate("[...document.querySelectorAll('.mp-pl')].map(b => b.dataset.id)")
            check('Battle Royale: Quads, Duos, Solos', pls == ['quads', 'duos', 'solos'], pls)
            soon = await pg.evaluate("document.querySelector('[data-act=\"mpTab\"][data-tab=\"extraction\"]')?.disabled")
            check('Extraction tab shown and open', soon is False, soon)
            await tap('[data-act="mpPlaylist"][data-id="duos"]')
            if SHOTS: await shots(pg, 'multiplayer-br')
            opts, info = await find_and_vote({'giant'}, {'brduo'}, cards=(1, 3))
            await leave()

            print('Multiplayer: featured playlist')
            await tap('[data-act="multiplayer"]', 500)
            await tap('[data-act="mpTab"][data-tab="standard"]')
            await tap('[data-act="mpPlaylist"][data-id="featured"]')
            f = await pg.evaluate("import('./js/shared/playlist.js').then(m => m.featured())")
            await tap('[data-act="mpFind"]', 150)
            await pg.wait_for_function("window.__game.menu.el.dataset.screen === 'vote'", timeout=15000)
            if SHOTS: await shots(pg, 'vote')
            await pg.wait_for_function('window.__game.app.inMatch', timeout=20000)
            info = await pg.evaluate(INFO)
            check('featured: its mode and modifiers', info['mode'] == f['mode'] and info['mods'] == f['mods'], (info['mode'], info['mods'], f))
            await leave()

            print('Quick play from the title')
            await pg.evaluate("window.__screens.length = 0")
            await tap('[data-act="quickPlay"]', 150)
            await pg.wait_for_function('window.__game.app.inMatch', timeout=20000)
            check('quick play goes through the search and the vote', await pg.evaluate("window.__screens.includes('mpsearch') && window.__screens.includes('vote')"))
            await pg.wait_for_function('window.__game.app.inMatch', timeout=20000)
            info = await pg.evaluate(INFO)
            check('quick play: a Standard quick play mode', info['mode'] in ('tdm', 'dom', 'kc', 'hard', 'hq', 'ffa'), info)
            await leave()

            print('Custom: Match')
            await tap('[data-act="custom"]', 600)
            if SHOTS: await shots(pg, 'custom-match')
            await tap('[data-act="soloMap"][data-id="dust"]')
            await tap('[data-act="soloMode"][data-id="dom"]')
            await tap('[data-act="soloBots"]', 400)
            await tap('[data-act="bmSkill"][data-skill="veteran"]')
            await tap('[data-act="bmDone"]')
            await tap('[data-act="soloStart"]', 200)
            await pg.wait_for_function('window.__game.app.inMatch', timeout=20000)
            info = await pg.evaluate(INFO)
            check('custom match: map, mode and difficulty honoured', info['mapId'] == 'dust' and info['mode'] == 'dom' and info['skills'] == ['veteran'], info)
            await leave()
            await pg.evaluate("localStorage.removeItem('switchyard-botmatch')")

            print('Custom: Host room')
            await tap('[data-act="custom"]', 500)
            await tap('[data-act="soloMap"][data-id="harbor"]')
            await tap('[data-act="soloMode"][data-id="kc"]')
            await tap('[data-act="customHost"]', 900)
            lob = await pg.evaluate("({ screen: window.__game.menu.el.dataset.screen, custom: window.__game.app.lobby.custom, chip: document.querySelector('.cu-chip')?.textContent.trim() })")
            check('host room: lobby carries the custom settings', lob['screen'] == 'lobby' and lob['custom'] and lob['custom']['mapId'] == 'harbor' and lob['custom']['mode'] == 'kc', lob)
            if SHOTS: await shots(pg, 'lobby-custom')
            check('lobby shows them', 'Kill Confirmed on Harbor' in (lob['chip'] or ''), lob['chip'])
            await tap('[data-act="lobbyCustom"]', 500)
            await tap('[data-act="customVote"]', 500)
            lob = await pg.evaluate("({ screen: window.__game.menu.el.dataset.screen, custom: window.__game.app.lobby.custom })")
            check('host switches the room back to the map vote', lob['screen'] == 'lobby' and lob['custom'] is None, lob)
            await tap('[data-act="lobbyCustom"]', 500)
            await tap('[data-act="soloMap"][data-id="pier"]')
            await tap('[data-act="soloMode"][data-id="tdm"]')
            await tap('[data-act="soloStart"]', 500)
            lob = await pg.evaluate("({ screen: window.__game.menu.el.dataset.screen, custom: window.__game.app.lobby.custom })")
            check('host sets custom settings from the lobby', lob['screen'] == 'lobby' and (lob['custom'] or {}).get('mapId') == 'pier', lob)
            await tap('[data-act="start"]', 300)
            await pg.wait_for_function('window.__game.app.inMatch', timeout=20000)
            info = await pg.evaluate(INFO)
            check('custom room starts on its map and mode, no vote, its difficulty', info['mapId'] == 'pier' and info['mode'] == 'tdm' and info['skills'] == [lob['custom']['skill']], info)
            await leave()

            print('Training: the range')
            await tap('[data-act="custom"]', 500)
            await tap('[data-act="customTab"][data-tab="training"]', 400)
            if SHOTS: await shots(pg, 'training')
            await tap('[data-act="trMap"][data-id="range"]')
            await tap('[data-act="trStart"]', 200)
            await pg.wait_for_function('window.__game.app.inMatch', timeout=20000)
            info = await pg.evaluate(INFO)
            check('range: practice', info['mode'] == 'range' and info['practice'], info)
            await leave()
            check('leaving goes back to Training', await pg.evaluate("!!document.querySelector('.menu .trn')"))

            print('Training: a map with bots')
            before = await pg.evaluate(PROGRESS)
            await tap('[data-act="trMap"][data-id="dust"]')
            for _ in range(12):
                if await pg.evaluate("document.querySelector('[data-act=\"trStep\"][data-dir=\"-1\"]').disabled"): break
                await tap('[data-act="trStep"][data-dir="-1"]', 60)
            await tap('[data-act="trStep"][data-dir="1"]', 60)
            await tap('[data-act="trStep"][data-dir="1"]', 60)
            await tap('[data-act="trSkill"][data-id="elite"]', 100)
            await tap('[data-act="trDrill"][data-id="standing"]', 100)
            tg = await pg.evaluate("({ ammo: document.querySelector('[data-key=\"ammo\"]').classList.contains('on'), nd: document.querySelector('[data-key=\"noDeath\"]').classList.contains('on') })")
            if not tg['ammo']: await tap('[data-act="trToggle"][data-key="ammo"]', 100)
            if not tg['nd']: await tap('[data-act="trToggle"][data-key="noDeath"]', 100)
            if SHOTS: await shots(pg, 'training-map')
            await tap('[data-act="trStart"]', 200)
            await pg.wait_for_function('window.__game.app.inMatch', timeout=20000)
            await pg.wait_for_timeout(1200)
            info = await pg.evaluate(INFO)
            check('3 bots, all enemies, elite, practice', info['n'] == 4 and info['teams'] == [1] and info['skills'] == ['elite'] and info['practice'], info)
            check('training switches reach the sim', (info['training'] or {}).get('behaviour') == 'standing' and info['training']['ammo'] and info['training']['noDeath'], info['training'])
            if SHOTS: await shots(pg, 'training-hud', menu=False)
            # Infinite ammo: an empty magazine refills on the reload, and reserve never drains.
            ammo = await pg.evaluate("""(async () => { const m = window.__game.app.match, ps = m.ps, s = ps.slot, res = ps.reserve[s];
              const { stepPlayer } = await import('./js/sim/player.js');
              ps.ammo[s] = 0; return { inst: ps.instantReload, reserve: res }; })()""")
            await pg.wait_for_timeout(700)
            ammo2 = await pg.evaluate("(() => { const ps = window.__game.app.match.ps; return { ammo: ps.ammo[ps.slot], reserve: ps.reserve[ps.slot], mag: ps.defs?.[ps.slot]?.magazine }; })()")
            check('infinite ammo: instant refill, reserve kept', ammo['inst'] and ammo2['ammo'] > 0 and ammo2['reserve'] == ammo['reserve'], (ammo, ammo2))
            # No death: a lethal hit puts the player straight back up where they stood.
            nd = await pg.evaluate("""(() => { const sim = window.__game.app.match.sim, me = sim.byId.get('local'), bot = sim.players.find(p => p.isBot);
              me.spawnProtect = 0; const x = me.ps.x, z = me.ps.z, d0 = me.deaths;
              sim._damage(me, bot, 500, 'ar', 5);
              return { alive: me.alive, hp: me.hp, deaths: me.deaths - d0, moved: Math.hypot(me.ps.x - x, me.ps.z - z) }; })()""")
            check('no death: alive, full health, in place', nd['alive'] and nd['hp'] >= 99 and nd['deaths'] == 1 and nd['moved'] < 0.01, nd)
            # Readout: damage to a bot shows on the range readout.
            ro = await pg.evaluate("""(() => { const sim = window.__game.app.match.sim, me = sim.byId.get('local'), bot = sim.players.find(p => p.isBot && p.alive);
              bot.spawnProtect = 0; sim._damage(bot, me, 30, 'ar', 12); return sim.range.view(); })()""")
            await pg.wait_for_timeout(1200)
            panel = await pg.evaluate("(() => { const p = document.querySelector('.range-panel'); return { shown: !p.hidden, head: p.querySelector('.rp-head').textContent, last: p.querySelector('.rp-last').textContent }; })()")
            check('damage readout on a bot', ro['lastDamage'] == 30 and panel['shown'] and panel['head'] == 'Training' and '30' in panel['last'], (ro['lastDamage'], panel))

            async def drill(kind, secs=3.0):
                """Each bot's path length (sampled, so a strafe's turns count) and how much closer it got to the player."""
                await pg.evaluate(f"window.__game.app.match.sim.training.behaviour = '{kind}'")
                pos = "Object.fromEntries((s => s.players.filter(p => p.isBot && p.alive).map(p => [p.id, [p.ps.x, p.ps.z, Math.hypot(p.ps.x - s.byId.get('local').ps.x, p.ps.z - s.byId.get('local').ps.z)]]))(window.__game.app.match.sim))"
                first = prev = await pg.evaluate(pos)
                path = {k: 0.0 for k in first}
                for _ in range(int(secs / 0.25)):
                    await pg.wait_for_timeout(250)
                    cur = await pg.evaluate(pos)
                    for k in path:
                        if k in cur and k in prev: path[k] += ((cur[k][0] - prev[k][0]) ** 2 + (cur[k][1] - prev[k][1]) ** 2) ** .5
                    prev = cur
                return [path[k] for k in path if k in prev], [first[k][2] - prev[k][2] for k in first if k in prev]

            # Keep the player safe and still while the bots act.
            await pg.evaluate("(() => { const sim = window.__game.app.match.sim; for (const p of sim.players) if (p.isBot) p.spawnProtect = 0; })()")
            moved, _ = await drill('standing')
            check('behaviour standing: no bot moves', moved and max(moved) < 0.3, [round(m, 2) for m in moved])
            moved, _ = await drill('strafing')
            check('behaviour strafing: bots move', moved and sum(moved) / len(moved) > 1.0, [round(m, 2) for m in moved])
            moved, closer = await drill('rushing', 4)
            check('behaviour rushing: bots close in', closer and sum(closer) / len(closer) > 2.0, [round(c, 1) for c in closer])
            await pg.evaluate("window.__game.app.match.sim.training.behaviour = 'standing'")
            # Armory: a different owned gun goes on at once.
            await tap('.rp-armory', 300)
            guns = await pg.evaluate("[...document.querySelectorAll('.arm-gun')].map(b => b.dataset.gun)")
            cur = await pg.evaluate("window.__game.app.match.ps.primary")
            want = next((g for g in guns if g != cur and g in ('smg', 'ar', 'autoshot', 'pdw', 'burst')), None)
            if SHOTS: await shots(pg, 'training-armory', menu=False)
            check('armory lists owned guns', len(guns) >= 3 and want is not None, (cur, guns[:8]))
            if want:
                await tap(f'.arm-gun[data-gun="{want}"]', 900)
                sw = await pg.evaluate("(() => { const m = window.__game.app.match, p = m.sim.byId.get('local'); return { ps: m.ps.primary, sim: p.loadout.primary, alive: p.alive }; })()")
                check('armory swap is instant', sw['ps'] == want and sw['sim'] == want and sw['alive'], sw)
            # Kills, then the session ends as a match would: nothing is paid or recorded.
            kills = await pg.evaluate("""(() => { const sim = window.__game.app.match.sim, me = sim.byId.get('local');
              for (let i = 0; i < 3; i++) { const bot = sim.players.find(p => p.isBot && p.alive); if (!bot) break; bot.spawnProtect = 0; sim._damage(bot, me, 500, me.ps.weapon, 8, null, true); }
              sim._end(0); return me.kills; })()""")
            # The final-kill replay plays first: about 12 s, longer on a loaded machine.
            await pg.wait_for_function("window.__game.menu.el.dataset.screen === 'results' || !window.__game.app.inMatch", timeout=60000)
            await pg.wait_for_timeout(5500)
            check('training session ended with kills', kills >= 1, kills)
            after = await pg.evaluate(PROGRESS)
            same = {k: before[k] == after[k] for k in before}
            check('XP, mastery, challenges, history and gun stats unchanged', all(same.values()), same)
            await pg.evaluate("window.__game.menu.el.querySelector('[data-act=\"resMenu\"]')?.click()")
            await pg.wait_for_timeout(500)
            await browser.close()
    finally:
        srv.terminate()
    errs = [e for e in errors if 'favicon' not in e]
    print('console errors:', errs[:5] or 'none')
    if failures or errs:
        print('FAILED:', *failures, sep='\n  ')
        sys.exit(1)
    print('PASS')


async def shots(pg, name, menu=True):
    """The current screen at both review sizes, saved to /tmp/mp/."""
    os.makedirs('/tmp/mp', exist_ok=True)
    for w, h in ((667, 375), (852, 393)):
        await pg.set_viewport_size({'width': w, 'height': h})
        await pg.wait_for_timeout(450)
        await pg.screenshot(path=f'/tmp/mp/{name}-{w}x{h}.png')
    await pg.set_viewport_size({'width': 852, 'height': 393})
    await pg.wait_for_timeout(200)


asyncio.run(main())
