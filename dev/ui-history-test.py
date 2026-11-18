#!/usr/bin/env python3
"""Match history detail (js/ui/history.js matchDetail): a real solo match lands in History with its detail.

Run from anywhere: python3 dev/ui-history-test.py [port] [--shots]. It serves the repo itself, then on a fresh save:
  TDM         plays a short Custom match on Railyard: the player kills three bots (by the sim's own damage path) and is
              killed once, then the match is ended. History lists it; tapping it opens the detail: the header (mode,
              result, map, date, duration, XP), three kill spots and one death spot with the line from the killer on
              the map, the gun table from that match's gun stats record (kills, deaths, damage, accuracy, headshots,
              held), medals and challenges tabs; Newer/Older step and the back button return to the list.
  Showdown    a short Showdown match with one round won: the detail has the Rounds tab with that round.
  Storage     the entry's detail is compact (spots whole metres) and lives in switchyard.history (the reset's sweep).
With --shots it saves the detail screens to /tmp/history-*.png.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8336))
SHOTS = '--shots' in sys.argv
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game.app'
failures, errors = [], []


def check(name, ok, info=''):
    print(f'  {name:<58} {"ok" if ok else "FAIL"} {info}')
    if not ok: failures.append(f'{name}: {info}')


# The sim's own damage path: the local player kills `n` enemies, then (die) an enemy kills the player.
KILL = """(n) => { const s = window.__game.app.match.sim, me = s.byId.get(window.__game.app.match.localId);
  const foes = s.players.filter(p => p.team !== me.team && p.alive).slice(0, n);
  for (const f of foes) s._damage(f, me, 9999, me.ps.weapon, 14, null, true);
  return foes.length; }"""
DIE = """() => { const s = window.__game.app.match.sim, me = s.byId.get(window.__game.app.match.localId);
  const foe = s.players.find(p => p.team !== me.team && p.alive);
  if (!foe || !me.alive) return false;
  s._damage(me, foe, 9999, foe.ps.weapon, 16);
  return true; }"""
END = """() => { const s = window.__game.app.match.sim, me = s.byId.get(window.__game.app.match.localId); if (s.phase !== 'ended') s._end(me.team); }"""


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
            await pg.goto(f'http://localhost:{PORT}/?debug=1&bots=easy&time=120')
            await pg.wait_for_timeout(900)
            await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
            await pg.reload()
            await pg.wait_for_timeout(1300)

            async def tap(sel, wait=400):
                await pg.locator(sel).first.tap()
                await pg.wait_for_timeout(wait)

            async def play(map_id, mode, body):
                await tap('[data-act="custom"]', 700)
                await tap(f'[data-act="soloMap"][data-id="{map_id}"]', 300)
                await tap(f'[data-act="soloMode"][data-id="{mode}"]', 300)
                await tap('[data-act="soloStart"]', 300)
                await pg.wait_for_function(f'{G}.inMatch && {G}.match?.sim?.phase === "live"', timeout=60000)
                await body()
                await pg.evaluate(END)
                await pg.wait_for_function(f'!{G}.inMatch', timeout=60000)
                await pg.wait_for_timeout(3000)
                await tap('[data-act="resMenu"]', 800)

            print('A short TDM match')

            async def tdm():
                await pg.wait_for_timeout(4500)                  # Held time for the gun table (3 s counts as used).
                for _ in range(3):
                    await pg.evaluate(f'({KILL})(1)')
                    await pg.wait_for_timeout(700)
                died = await pg.evaluate(f'({DIE})()')
                check('the player was killed once', died)
                await pg.wait_for_timeout(1200)
            await play('railyard', 'tdm', tdm)

            raw = await pg.evaluate("localStorage.getItem('switchyard.history')")
            hist = json.loads(raw)['list']
            e = hist[0]
            d = e.get('d') or {}
            check('history entry has a detail', bool(d), list(d.keys()))
            check('three kill spots, one death spot with the killer', len(d.get('k', [])) == 3 and len(d.get('x', [])) == 1 and len(d['x'][0]) == 4, (d.get('k'), d.get('x')))
            check('spots are whole metres', all(isinstance(v, int) for pt in d.get('k', []) + d.get('x', []) for v in pt))
            check('linked to the gun stats record', bool(d.get('gs')) and await pg.evaluate(f"import('./js/game/telemetry.js').then(m => !!m.GunStats.match({d.get('gs', 0)}))"))
            check('detail stays compact', len(json.dumps(d)) < 1500, len(json.dumps(d)))

            await tap('[data-act="history"]', 700)
            rows = await pg.locator('.hs-body .hs-row').count()
            check('History lists the match', rows == 1, rows)
            await tap('.hs-body .hs-row[data-i="0"]', 700)
            st = await pg.evaluate("""(() => { const q = s => document.querySelector(s), all = s => [...document.querySelectorAll(s)];
              return { screen: window.__game.menu.el.dataset.screen, word: q('.hm-hero h3')?.textContent, tag: q('.hm-hero .hd-tag')?.textContent,
                meta: q('.hm-meta')?.textContent, kills: all('.hm-kill').length, deaths: all('.hm-death').length, lines: all('.hm-death line').length,
                img: q('.hm-map img')?.naturalWidth ?? 0, mapBox: (() => { const r = q('.hm-map')?.getBoundingClientRect(); return r ? [r.width, r.height] : null; })(),
                heads: all('.hm-guns th').map(t => t.textContent), guns: all('.hm-guns tbody tr').map(r => [...r.cells].map(c => c.textContent.trim())),
                tabs: all('.hm-tabs .seg').map(b => b.dataset.tab) }; })()""")
            check('detail screen opened', st['screen'] == 'historyMatch', st['screen'])
            check('header: mode, result, map, date, duration, XP', st['tag'] and 'Team' in st['tag'] and st['word'] == 'Victory'
                  and 'Railyard' in st['meta'] and ':' in st['meta'] and 'XP' in st['meta'], (st['tag'], st['word'], st['meta']))
            check('map art drawn and sized', st['img'] > 0 and st['mapBox'] and st['mapBox'][0] > 100 and st['mapBox'][1] > 60, (st['img'], st['mapBox']))
            check('map dots: 3 kills, 1 death, 1 killed-from line', st['kills'] == 3 and st['deaths'] == 1 and st['lines'] == 1, (st['kills'], st['deaths'], st['lines']))
            check('gun table columns', st['heads'] == ['Gun', 'Kills', 'Deaths', 'Dmg', 'Acc', 'HS%', 'Held'], st['heads'])
            g = st['guns'][0] if st['guns'] else []
            check('gun row: 3 kills, 1 death, damage, held time', len(g) == 7 and g[1] == '3' and g[2] == '1' and int(g[3].replace(',', '')) > 0 and ':' in g[6], st['guns'])
            check('tabs: guns, medals, challenges (no mode tab in TDM)', st['tabs'] == ['guns', 'awards', 'ch'], st['tabs'])
            if SHOTS: await pg.screenshot(path='/tmp/history-tdm.png')
            await tap('[data-act="hmTab"][data-tab="awards"]', 300)
            medals = await pg.evaluate("[...document.querySelectorAll('.hm-pane .hm-chip b')].map(b => b.textContent)")
            check('medals listed (headshots at least)', 'Headshot' in medals, medals)
            await tap('[data-act="hmTab"][data-tab="ch"]', 300)
            ch = await pg.evaluate("document.querySelector('.hm-pane').innerText")
            check('challenges pane renders', len(ch) > 5, ch[:80])
            older = await pg.evaluate("document.querySelector('[data-act=\"hmStep\"][data-d=\"1\"]').disabled")
            check('only match: Older is disabled', older)
            await tap('[data-act="hmBack"]', 600)
            check('back returns to the list', await pg.evaluate("window.__game.menu.el.dataset.screen") == 'history')
            await tap('[data-act="hsBack"]', 700)

            print('A short Showdown match')

            async def showdown():
                await pg.wait_for_function(f'{G}.match.sim.rules?.state === "live" || {G}.match.sim.rules?.live || true')
                await pg.wait_for_timeout(5000)
                await pg.evaluate(f'({KILL})(2)')
                await pg.wait_for_timeout(2500)
            await play('pier', 'gf', showdown)
            hist = json.loads(await pg.evaluate("localStorage.getItem('switchyard.history')"))['list']
            sd = (hist[0].get('d') or {}).get('sd', '')
            check('Showdown rounds recorded', sd.startswith('w'), sd)
            await tap('[data-act="history"]', 700)
            await tap('.hs-body .hs-row[data-i="0"]', 700)
            tabs = await pg.evaluate("[...document.querySelectorAll('.hm-tabs .seg')].map(b => b.textContent)")
            check('Showdown detail has a Rounds tab', 'Rounds' in tabs, tabs)
            await tap('[data-act="hmTab"][data-tab="mode"]', 300)
            rounds = await pg.evaluate("[...document.querySelectorAll('.hm-rounds span')].map(s => s.className)")
            check('round by round strip', rounds[:1] == ['r-w'], rounds)
            if SHOTS: await pg.screenshot(path='/tmp/history-sd.png')
            await tap('[data-act="hmStep"][data-d="1"]', 500)
            word = await pg.evaluate("document.querySelector('.hm-hero h3')?.textContent")
            check('Older steps to the TDM match', word == 'Victory' and await pg.evaluate("document.querySelectorAll('.hm-kill').length") == 3, word)
            await browser.close()
    finally:
        srv.terminate()
    print('console errors:', errors[:5] or 'none')
    if failures or errors:
        print('FAILED:', *failures, sep='\n  ')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
