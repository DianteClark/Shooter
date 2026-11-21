#!/usr/bin/env python3
"""Browser test for weekend tournaments (docs/TOURNAMENTS.md): python3 dev/ui-tourney-test.py [port] [--shots] [--only solo|champ|wed|party]

Serves the repo itself (python3 -m http.server <port>) and runs the game on a fixed local date (a fake Date):
  1. Saturday 2026-11-21, a fresh save: Multiplayer's Spotlight has the live Team Cup; it opens the bracket: eight
     squads with clan tags, three rounds named with mode and map, nothing past the screen's edges.
  2. Enter and play: the intro names the round ("Quarter-final vs [TAG] Name"), the enemy wears the clan's tag; a forced
     win shows the round in the Unlocked summary and the XP lines; Bracket goes back to the bracket: the win is marked, the quarter-finals
     elsewhere are resolved, the semi-final is next; the entrant and semi-finalist cards are owned.
  3. A forced loss in the semi-final knocks the run out; Re-enter goes back to the quarter-final, and winning it again
     pays no round XP twice.
  4. Leaving a round's match (a reload mid-match) counts as lost and says so; the run then has no entry left.
  5. A second weekend (the Showdown Cup): win all three rounds: champion, the crest and camo owned, the Trophy Case
     shelf lists both weekends.
  6. Wednesday: the Spotlight counts down to Friday 18:00 and the bracket is a preview with no Play.
  7. A friend room (two tabs, ?net=local): the host's lobby has the cup chip; the guest sees the host's bracket; the
     host plays the quarter-final with the guest in the squad; both intros name the round; after a forced win the
     guest's run follows the host's bracket.
Any console error or page error fails it. With --shots the screens go to /tmp/tourney/.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8486))
SHOTS = '--shots' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else ''     # solo | champ | wed | party
OUT = '/tmp/tourney'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
G = 'window.__game'

def fake(day):
    return """(() => { const Real = Date, offset = new Real('%s').getTime() - Real.now();
  class FakeDate extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); } static now() { return Real.now() + offset; } }
  window.Date = FakeDate; })();""" % day

BRACKET = """(() => { const all = s => [...document.querySelectorAll(s)];
  const over = all('.tn-side *').filter(el => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1); }).length;
  return { screen: window.__game.menu.el.dataset.screen, squads: all('.tn-col[data-round="0"] .tn-sq').length, tags: all('.tn-col[data-round="0"] .tn-sq u').map(u => u.textContent),
    rounds: all('.tn-col h4 b').map(b => b.textContent), plans: all('.tn-col h4 small').map(s => s.textContent),
    you: all('.tn-sq.you').length, wins: all('.tn-sq.win').length, line: document.querySelector('.tn-line')?.textContent ?? '',
    play: !!document.querySelector('[data-act="tnPlay"]'), reenter: !!document.querySelector('[data-act="tnReenter"]'), host: document.querySelector('.tn-host')?.textContent ?? '',
    owned: all('.tn-rw-row.own').length, title: document.querySelector('.bar-title')?.textContent ?? '', over }; })()"""


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    fails, errors = [], []

    def check(label, cond, info=''):
        print(f'  {"ok  " if cond else "FAIL"} {label}{": " + str(info) if info != "" else ""}')
        if not cond:
            fails.append(f'{label} {info}')

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=ARGS)

            async def open_page(ctx, tag, url_extra=''):
                pg = await ctx.new_page()
                pg.on('console', lambda m, tag=tag: errors.append(f'{tag}: {m.text}') if m.type == 'error' else None)
                pg.on('pageerror', lambda e, tag=tag: errors.append(f'{tag}: PAGEERR {e}'))
                await pg.goto(f'http://localhost:{PORT}/?debug=1{url_extra}')
                await pg.wait_for_function(f'{G}?.Progress', timeout=30000)
                return pg

            async def fresh(pg, name='Tester'):
                await pg.evaluate(f"localStorage.clear(); sessionStorage.clear(); localStorage.setItem('switchyard.resetGen', '1'); {G}.Progress.setFlag('tutorialOffered'); {G}.Progress.name = '{name}'")
                await pg.reload()
                await pg.wait_for_function(f"{G}?.menu?.el?.dataset.screen === 'title'", timeout=30000)
                await pg.wait_for_timeout(500)

            async def shot(pg, name):
                if SHOTS:
                    await pg.screenshot(path=f'{OUT}/{name}.png')

            async def tap(pg, sel, wait=500):
                # The results' Unlocked summary (an overlay after the reel) covers the screen: Continue closes it.
                if 'ux' not in sel: await pg.evaluate("document.querySelector('.overlay.show [data-act=\"uxDone\"]')?.click()")
                await pg.locator(sel).first.tap()
                await pg.wait_for_timeout(wait)

            async def play_round(pg, win, name):
                """From the bracket: Play, the intro, a forced result, the results screen. Returns (intro title, results info)."""
                await pg.wait_for_function(f"{G}.app.match?.sim", timeout=30000)
                await pg.wait_for_timeout(1200)
                intro = await pg.evaluate("document.querySelector('.in-tn')?.textContent ?? ''")
                enemy = await pg.evaluate(f"(() => {{ const m = {G}.app.matchInfo; const me = m.roster.find(r => !r.isBot); return m.roster.filter(r => r.team !== me.team).map(r => r.name); }})()")
                await shot(pg, f'{name}-intro')
                await pg.wait_for_function(f"{G}.app.match.sim.phase === 'live'", timeout=60000)
                await pg.evaluate(f"{G}.app.match.sim._end({0 if win else 1})")
                await pg.wait_for_function(f"{G}.menu.el.dataset.screen === 'results'", timeout=30000)
                await pg.wait_for_timeout(2500)
                await shot(pg, f'{name}-results')
                res = await pg.evaluate("({ lines: [...document.querySelectorAll('.xp-row')].map(e => e.textContent).join('|'), primary: document.querySelector('.res-choice .primary')?.textContent ?? '' })")
                return intro, enemy, res

            # ---------- 1-4: Saturday, solo ----------
            if not ONLY or ONLY == 'solo':
                print('Saturday 2026-11-21, solo')
                ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
                await ctx.add_init_script(fake('2026-11-21T12:00:00'))
                pg = await open_page(ctx, 'solo')
                await fresh(pg)
                await tap(pg, '[data-act="multiplayer"]', 700)
                card = await pg.evaluate("(() => { const c = document.querySelector('[data-act=\"mpTourney\"]'); return c ? { live: c.classList.contains('live'), text: c.textContent.replace(/\\s+/g, ' ').trim(), spot: !!c.closest('.mp-sec-spot') } : null; })()")
                check('Spotlight has the live Team Cup', card and card['live'] and card['spot'] and 'Team Cup' in card['text'] and 'left' in card['text'], card)
                await shot(pg, 'mp-spotlight')
                await tap(pg, '[data-act="mpTourney"]', 800)
                b = await pg.evaluate(BRACKET)
                check('bracket opens', b['screen'] == 'tourney' and b['title'].startswith('Team Cup'), b['title'])
                check('eight squads, seven clan tags', b['squads'] == 8 and len(b['tags']) == 8 and b['you'] == 1, b['tags'])
                check('rounds named with mode and map', b['rounds'][:3] == ['Quarter-final', 'Semi-final', 'Final'] and all(' · ' in s for s in b['plans'][:3]), b['plans'])
                check('side panel inside the screen', b['over'] == 0, b['over'])
                check('play offered', b['play'] and b['line'].startswith('Quarter-final vs ['), b['line'])
                await shot(pg, 'bracket-fresh')
                qf_line = b['line']
                await tap(pg, '[data-act="tnPlay"]', 300)
                intro, enemy, res = await play_round(pg, True, 'qf')
                check('intro names the round', intro.strip() == qf_line, [intro, qf_line])
                tag = qf_line.split('[')[1].split(']')[0]
                check('the enemy wears the clan tag', len(enemy) == 4 and all(n.startswith(f'[{tag}] ') for n in enemy), enemy)
                check('results: entry and round XP lines', 'Tournament entry' in res['lines'] and 'Quarter-final won' in res['lines'], res['lines'][:300])
                check('results button goes to the bracket', 'Bracket' in res['primary'], res['primary'])
                # Since the results reel's one-big-reveal rule (308dd12) only a cup won gets the full stamp; a round won
                # is a tile in the Unlocked summary after the reel.
                try:
                    await pg.wait_for_selector('.overlay.show .ux', timeout=60000)
                    stamp = await pg.evaluate("[...document.querySelectorAll('.overlay.show .ux-tile')].map(t => t.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')")
                except Exception:
                    stamp = ''
                check('the Unlocked summary lists the round won', 'round won' in stamp, stamp)
                await shot(pg, 'qf-stamp')
                st = await pg.evaluate(f"(() => {{ const t = {G}.Progress.tourney(); return {{ run: t.run, entrant: {G}.Progress.hasReward('card:tn-entrant'), semi: {G}.Progress.hasReward('card:tn-semi'), fin: {G}.Progress.hasReward('card:tn-finalist') }}; }})()")
                check('QF won: semi-final next; entrant and semi-finalist cards', st['run']['round'] == 1 and st['entrant'] and st['semi'] and not st['fin'], st)
                await tap(pg, '.res-choice .primary', 900)
                b = await pg.evaluate(BRACKET)
                check('back on the bracket: the win marked, the other quarter-finals resolved', b['screen'] == 'tourney' and b['wins'] == 4 and b['line'].startswith('Semi-final vs ['), b)
                check('two placing rewards owned', b['owned'] == 2, b['owned'])
                await shot(pg, 'bracket-qf-won')
                # 3. Lose the semi-final, re-enter.
                await tap(pg, '[data-act="tnPlay"]', 300)
                intro, enemy, res = await play_round(pg, False, 'sf')
                check('SF intro', intro.strip().startswith('Semi-final vs ['), intro)
                await tap(pg, '.res-choice .primary', 900)
                b = await pg.evaluate(BRACKET)
                check('knocked out: re-entry offered', b['reenter'] and not b['play'] and 'Semi-final' in b['line'], b['line'])
                await shot(pg, 'bracket-out')
                await tap(pg, '[data-act="tnReenter"]', 300)
                intro, enemy, res = await play_round(pg, True, 'qf2')
                check('re-entry plays the quarter-final again', intro.strip() == qf_line, intro)
                check('no round XP twice', 'Quarter-final won' not in res['lines'] and 'Tournament entry' not in res['lines'], res['lines'][:300])
                await tap(pg, '.res-choice .primary', 900)
                # 4. A reload mid-match forfeits.
                await tap(pg, '[data-act="tnPlay"]', 300)
                await pg.wait_for_function(f"{G}.app.match?.sim", timeout=30000)
                await pg.wait_for_timeout(800)
                await pg.reload()
                await pg.wait_for_function(f"{G}?.menu?.el?.dataset.screen === 'title'", timeout=30000)
                await pg.wait_for_timeout(500)
                await tap(pg, '[data-act="multiplayer"]', 600)
                await tap(pg, '[data-act="mpTourney"]', 800)
                b = await pg.evaluate(BRACKET)
                toast = await pg.evaluate("document.querySelector('.toast')?.textContent ?? ''")
                check('a round left unfinished is lost', not b['play'] and not b['reenter'] and 'unfinished' in toast, [b['line'], toast])
                await shot(pg, 'bracket-forfeit')
                await ctx.close()

            # ---------- 5: next weekend, champion ----------
            if not ONLY or ONLY == 'champ':
                print('Saturday 2026-11-28, champion')
                ctx = await browser.new_context(viewport={'width': 667, 'height': 375}, has_touch=True, is_mobile=True)
                await ctx.add_init_script(fake('2026-11-28T15:00:00'))
                pg = await open_page(ctx, 'champ')
                await fresh(pg)
                await tap(pg, '[data-act="multiplayer"]', 600)
                await tap(pg, '[data-act="mpTourney"]', 800)
                b = await pg.evaluate(BRACKET)
                check('the Showdown Cup', b['title'].startswith('Showdown Cup') and all(s.startswith('Showdown') for s in b['plans'][:3]), b['plans'])
                check('nothing past the edges at 667', b['over'] == 0, b['over'])
                for rnd, name in enumerate(['qf', 'sf', 'final']):
                    await tap(pg, '[data-act="tnPlay"]', 300)
                    intro, enemy, res = await play_round(pg, True, f'sd-{name}')
                    check(f'Showdown {name}: 2 v 2 against the clan', len(enemy) == 2 and all(n.startswith('[') for n in enemy), enemy)
                    await tap(pg, '.res-choice .primary', 900)
                st = await pg.evaluate(f"(() => {{ const P = {G}.Progress, t = P.tourney(); return {{ champ: t.run.champion, card: P.hasReward('card:tn-champion'), crest: P.hasReward('emblem:tn-champion'), camo: P.camos('ar').some(c => c.camo.id === 'tn-laurel' && c.unlocked), log: t.log }}; }})()")
                check('champion: card, crest and camo', st['champ'] and st['card'] and st['crest'] and st['camo'], st)
                b = await pg.evaluate(BRACKET)
                check('the bracket crowns the player', await pg.evaluate("!!document.querySelector('.tn-cup.mine')") and not b['play'], b['line'])
                await shot(pg, 'bracket-champion')
                await tap(pg, '[data-act="tnBack"]', 500)
                await tap(pg, '[data-act="mpBack"]', 500)
                await tap(pg, '[data-act="profile"]', 700)
                await tap(pg, '[data-act="pfTrophy"]', 800)
                shelf = await pg.evaluate("[...document.querySelectorAll('.tc-tn-t')].map(t => t.textContent.replace(/\\s+/g, ' ').trim())")
                check('Trophy Case shelf lists the cup', len(shelf) == 1 and 'Champion' in shelf[0] and 'Showdown Cup' in shelf[0] and 'Nov 27, 2026' in shelf[0], shelf)
                await shot(pg, 'trophy-shelf')
                await ctx.close()

            # ---------- 6: Wednesday ----------
            if not ONLY or ONLY == 'wed':
                print('Wednesday 2026-11-18')
                ctx = await browser.new_context(viewport={'width': 640, 'height': 360}, has_touch=True, is_mobile=True)
                await ctx.add_init_script(fake('2026-11-18T12:00:00'))
                pg = await open_page(ctx, 'wed')
                await fresh(pg)
                await tap(pg, '[data-act="multiplayer"]', 600)
                card = await pg.evaluate("(() => { const c = document.querySelector('[data-act=\"mpTourney\"]'); return c ? { live: c.classList.contains('live'), text: c.textContent.replace(/\\s+/g, ' ').trim() } : null; })()")
                check('Spotlight counts down', card and not card['live'] and 'Opens in 2d 6h' in card['text'], card)
                await tap(pg, '[data-act="mpTourney"]', 800)
                b = await pg.evaluate(BRACKET)
                check('a preview with no Play', b['screen'] == 'tourney' and 'preview' in b['title'] and not b['play'] and b['squads'] == 8, b)
                check('nothing past the edges at 640', b['over'] == 0, b['over'])
                await shot(pg, 'bracket-preview')
                await ctx.close()

            # ---------- 7: a friend room ----------
            if not ONLY or ONLY == 'party':
                print('Friend room')
                ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
                await ctx.add_init_script(fake('2026-11-21T20:00:00'))
                host = await open_page(ctx, 'host', '&net=local')
                await fresh(host, 'Hosty')
                await tap(host, '[data-act="host"]', 300)
                await host.wait_for_function(f'{G}.app.code', timeout=20000)
                code = await host.evaluate(f'{G}.app.code')
                guest = await open_page(ctx, 'guest', '&net=local')
                await fresh(guest, 'Guesty')
                pages = [host, guest]
                stop = False

                async def juggle():
                    while not stop:
                        for q in pages:
                            try: await q.bring_to_front()
                            except Exception: pass
                            await asyncio.sleep(0.12)
                juggler = asyncio.create_task(juggle())
                await guest.evaluate(f"{G}.join('{code}')")
                await host.wait_for_function(f'{G}.app.lobby.humans.length === 2', timeout=60000)
                await host.wait_for_timeout(800)
                chip = await host.evaluate("document.querySelector('[data-act=\"lobbyTourney\"]')?.textContent ?? ''")
                check("the host's lobby has the cup chip", 'Team Cup' in chip, chip)
                await guest.wait_for_function("!!document.querySelector('[data-act=\"lobbyTourney\"]')", timeout=10000)
                await guest.locator('[data-act="lobbyTourney"]').first.click()
                await guest.wait_for_timeout(800)
                gb = await guest.evaluate(BRACKET)
                check('the guest sees the host\'s bracket, no Play', gb['screen'] == 'tourney' and not gb['play'] and 'Hosty' in gb['host'], gb)
                await host.locator('[data-act="lobbyTourney"]').first.click()
                await host.wait_for_timeout(800)
                hb = await host.evaluate(BRACKET)
                check('the same squads on both phones', hb['tags'] == gb['tags'] and hb['plans'] == gb['plans'], [hb['tags'], gb['tags']])
                await shot(host, 'party-bracket')
                await host.locator('[data-act="tnPlay"]').first.click()
                await guest.wait_for_function(f'{G}.app.inMatch && {G}.app.matchInfo', timeout=60000)
                await host.wait_for_function(f'{G}.app.match?.sim', timeout=30000)
                await host.wait_for_timeout(1500)
                ti = await host.evaluate(f"{G}.hud.introTitle ?? ''")
                gi = await guest.evaluate(f"{G}.hud.introTitle ?? ''")
                print('    guest', await guest.evaluate(f"JSON.stringify({{ t: {G}.app.matchInfo?.tourney, a: {G}.app.match?.awards?.tourney, screen: {G}.menu.el.dataset.screen }})"))
                check('both intros name the round', ti and ti == gi and ti.startswith('Quarter-final vs ['), [ti, gi])
                seats = await host.evaluate(f"(() => {{ const r = {G}.app.matchInfo.roster; return [r.filter(x => x.team === 0 && !x.isBot).length, r.filter(x => x.team === 0).length, r.filter(x => x.team === 1).length]; }})()")
                check('both players on one side, 4 v 4', seats == [2, 4, 4], seats)
                await host.wait_for_function(f"{G}.app.match.sim.phase === 'live'", timeout=60000)
                await host.evaluate(f"{G}.app.match.sim._end(0)")
                try:
                    await guest.wait_for_function(f"{G}.menu.el.dataset.screen === 'results'", timeout=60000)
                except Exception:
                    print('    guest stuck', await guest.evaluate(f"JSON.stringify({{ screen: {G}.menu.el.dataset.screen, inMatch: {G}.app.inMatch, phase: {G}.app.match?.interp?.newest?.phase }})"), errors[-5:])
                    raise
                await host.wait_for_function(f"{G}.menu.el.dataset.screen === 'results'", timeout=60000)
                await guest.wait_for_timeout(1000)
                hid = await host.evaluate(f'{G}.app.net.localId')
                gt = await guest.evaluate(f"(() => {{ const t = {G}.Progress.tourney(); return {{ owner: t.owner, round: t.run.round, log: t.log }}; }})()")
                check("the guest's run follows the host's bracket", gt['owner'] == hid and gt['round'] == 1 and gt['log'] and gt['log'][0][2] == 2, gt)
                ht = await host.evaluate(f"{G}.Progress.tourney().run.round")
                check("the host's run moves on too", ht == 1, ht)
                await shot(guest, 'party-guest-results')
                stop = True
                juggler.cancel()
                await ctx.close()
            await browser.close()
    finally:
        srv.terminate()
    # The local test transport logs nothing as an error; anything here is a real failure.
    errors = [e for e in errors if 'favicon' not in e]
    for e in errors[:20]:
        print('  ERROR', e)
    if errors:
        fails.append(f'{len(errors)} console/page errors')
    print(f'{"FAILED" if fails else "PASSED"}: {len(fails)} failure(s)')
    sys.exit(1 if fails else 0)


asyncio.run(main())
