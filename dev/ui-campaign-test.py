#!/usr/bin/env python3
"""The co-op campaign end to end in a real browser (docs/CAMPAIGN.md): python3 dev/ui-campaign-test.py [port] [outdir]

Serves the repo, opens Multiplayer, the Campaign tab (the route map: mission 1 open, the rest locked; a locked station
says so), the briefing (cards, objectives, stars, Deploy), then mission 1 solo with three bots: the intro card and the
objective card, the local player walked (teleported) to the first objective (a checkpoint reached, the next step on the
card, the radio subtitle), the squad wiped (the failed panel: reason, Retry now, Abort) and Retry now (back at the
checkpoint, every step's progress kept), then the rest of the steps forced done on the host. The results screen says
Mission complete with the stars and the campaign's XP lines; the save has mission 1 cleared, its calling card is
earned, and the Campaign tab now opens mission 2. Then, with every mission opened in the save, a look at mission 2's
watchmen and their torches and at mission 8's boss with his barrage rings, a friend room set to mission 3 (one squad
of four) started, the briefing at 667x375, and a guest over the local net in the host's squad, following the script.
Operation Starfall: the route map switched to it (four stations), Dark Sky's briefing, its night (the dark round the
player, a flare lifting it) and Zero Hour's Director Vane (his salvo, his crest, the launch clock).
Screenshots go to outdir (default /tmp/campaign). Fails on any console error and on HUD panels that spill off the screen.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9140
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/campaign'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game.app'
R = f'{G}.match.sim.rules'
failures, errors = [], []


def check(name, ok, info=''):
    print(f'  {name:<64} {"ok" if ok else "FAIL"} {info if not ok else ""}', flush=True)
    if not ok: failures.append(f'{name}: {info}')


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

# Every mission open (mission k cleared on Regular for k < 7), so the later missions can be deployed.
# Nightrail done and the first three of Starfall: every mission open.
OPEN_STARFALL = """(() => { const s = JSON.parse(localStorage.getItem('switchyard.save'));
  s.cp = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`m${i + 1}`, [2, 1, 400]]));
  localStorage.setItem('switchyard.save', JSON.stringify(s)); })()"""
OPEN_ALL = """(() => { const s = JSON.parse(localStorage.getItem('switchyard.save'));
  s.cp = { m1: [2, 1, 400], m2: [2, 0, 500], m3: [2, 0, 500], m4: [2, 0, 500], m5: [2, 0, 500], m6: [2, 0, 500], m7: [2, 0, 500] };
  localStorage.setItem('switchyard.save', JSON.stringify(s)); })()"""


# Two tabs over the local net (?net=local): the host opens a campaign room, a guest joins and readies, the host starts;
# the guest's phone shows the mission (its objective card) and follows the host's script to the next step.
async def coop_net(browser):
    print('Co-op over the local net: a guest in the squad')
    ctx = await browser.new_context(viewport={'width': 667, 'height': 375}, has_touch=True, is_mobile=True)
    async def page(tag, name):
        pg = await ctx.new_page()
        pg.set_default_timeout(90000)
        pg.on('console', lambda m: errors.append(f'{tag}: {m.text}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append(f'{tag}: PAGEERR {e}'))
        await pg.goto(f'http://localhost:{PORT}/?debug=1&net=local', timeout=120000)
        await pg.wait_for_timeout(900)
        await pg.evaluate(f"window.__game.Progress.name='{name}'; window.__game.Progress.setFlag('tutorialOffered')")
        await pg.reload(timeout=120000)
        await pg.wait_for_timeout(1000)
        return pg
    host = await page('host', 'Hosty')
    for sel in ['[data-act="multiplayer"]', '[data-act="mpTab"][data-tab="campaign"]', '[data-act="cpFriends"]']:
        await host.locator(sel).first.click()
        await host.wait_for_timeout(600)
    await host.wait_for_function(f'{G}.code')
    code = await host.evaluate(f'{G}.code')
    guest = await page('guest', 'Guesty')
    pages = [host, guest]
    async def juggle():
        while True:
            for pg in pages:
                try: await pg.bring_to_front()
                except Exception: pass
                await asyncio.sleep(0.12)
    juggler = asyncio.create_task(juggle())
    try:
        await guest.evaluate(f"window.__game.join('{code}')")
        await host.wait_for_function(f'{G}.lobby.humans.length === 2', timeout=60000)
        await guest.wait_for_selector('[data-act="toggleReady"]', timeout=20000)
        await guest.locator('[data-act="toggleReady"]').first.click()
        await host.wait_for_function(f'{G}.lobby.humans.every(h => h.ready || h.host)', timeout=20000)
        await host.locator('[data-act="start"]').first.click()
        try: await guest.wait_for_function(f'{G}.match?.interp.newest?.points?.obj?.cp', timeout=60000)
        except Exception:
            # The two-tab channel sometimes leaves a guest without snapshots; the same phone rejoins its held slot.
            print('     guest has no snapshots: rejoining', flush=True)
            await guest.reload()
            await guest.wait_for_timeout(1500)
            await guest.evaluate(f"window.__game.join('{code}')")
            await guest.wait_for_function(f'{G}.match?.interp.newest?.points?.obj?.cp', timeout=90000)
        await host.wait_for_function(f'{G}.match.sim.rules.state === 1', timeout=90000)
        await guest.wait_for_timeout(3000)
        a = await guest.evaluate(f"({{ card: document.querySelector('.cp-card b')?.textContent, team: {G}.match.sim.byId.get({G}.match.localId).team, mode: {G}.match.mode }})")
        check('the guest is in the squad and sees the mission', a['mode'] == 'cp' and a['team'] == 0 and bool(a['card']), a)
        step = await host.evaluate(f"{G}.match.sim.rules.stepI")
        await host.evaluate(f"{G}.match.sim.rules._complete()")
        nxt = await host.evaluate(f"{G}.match.sim.rules.cur.label")
        ok = False
        for _ in range(60):
            if await guest.evaluate("document.querySelector('.cp-card b')?.textContent") == nxt: ok = True; break
            await guest.wait_for_timeout(250)
        check('  the host moves the script on: the guest\'s card follows', ok, [step, nxt])
        await guest.screenshot(path=f'{OUT}/21-guest-mission-667x375.png')
    finally:
        juggler.cancel()
        await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=ARGS)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            pg = await ctx.new_page()
            pg.set_default_timeout(90000)      # A loaded machine: page loads and taps can take a while.
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e} {getattr(e, "stack", "")}'))
            ev = lambda js: pg.evaluate(js)

            async def shot(name):
                vp = pg.viewport_size
                await pg.screenshot(path=f'{OUT}/{name}-{vp["width"]}x{vp["height"]}.png')

            async def tap(sel, wait=500):
                await pg.wait_for_load_state('load')
                await pg.locator(sel).first.click()
                await pg.wait_for_timeout(wait)

            async def fit(sels, tag):
                for b in await ev(f"{OVERFLOW}({sels!r})"): failures.append(f'{tag}: off screen: {b}')

            async def until(js, secs=60, step=250):
                for _ in range(int(secs * 1000 / step)):
                    if await ev(js): return True
                    await pg.wait_for_timeout(step)
                return False

            await pg.goto(f'http://localhost:{PORT}/?debug=1')
            await pg.wait_for_timeout(1200)
            await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
            await pg.reload()
            await pg.wait_for_timeout(1500)

            print('Campaign tab')
            await tap('[data-act="multiplayer"]', 700)
            await tap('[data-act="mpTab"][data-tab="campaign"]', 700)
            st = await ev("({ n: document.querySelectorAll('.cpm-st').length, locked: document.querySelectorAll('.cpm-st.locked').length, on: document.querySelector('.cpm-st.on')?.dataset.k, side: document.querySelector('.cpm-side h3')?.textContent, go: !document.querySelector('.cpm-go').disabled })")
            check('the route map: 8 missions, 7 locked, mission 1 picked', st['n'] == 8 and st['locked'] == 7 and st['on'] == '0' and st['side'] == 'Switch Room' and st['go'], st)
            tabs = await ev("(() => { const n = document.querySelector('.mp-tabs'), on = n.querySelector('.seg.on').getBoundingClientRect(), r = n.getBoundingClientRect(); return on.right <= r.right + 1 && on.left >= r.left - 1; })()")
            check('the Campaign tab is in view on the bar', tabs)
            await shot('01-campaign-tab')
            await fit(['.cpm-st', '.cpm-side', '.cpm-go', '.cpm-friends', '.mp-tabs'], 'campaign tab')
            await tap('[data-act="cpPick"][data-k="3"]', 400)
            locked = await ev("({ go: document.querySelector('.cpm-go').disabled, pick: document.querySelector('.cpm-pick').textContent })")
            check('a locked mission cannot be deployed', locked['go'] and 'Clear' in locked['pick'], locked)
            await tap('[data-act="cpPick"][data-k="0"]', 300)
            await tap('[data-act="cpDiff"][data-d="0"]', 300)
            d = await ev("document.querySelector('.cpm-diff .bm-seg.on')?.textContent")
            check('difficulty picked: Recruit', d and d.startswith('Recruit'), d)

            print('Briefing')
            await tap('[data-act="cpBrief"]', 700)
            br = await ev("({ screen: document.querySelector('.menu')?.dataset.screen, cards: document.querySelectorAll('.cpb-card').length, obj: document.querySelectorAll('.cpb-obj li').length, stars: document.querySelectorAll('.cpb-stars li').length })")
            check('the briefing: three cards, the objectives, three stars', br['screen'] == 'cpbrief' and br['cards'] == 3 and br['obj'] >= 3 and br['stars'] == 3, br)
            await shot('02-briefing')
            await fit(['.cpb-card', '.cpb-side', '.cpb-go', '.cpb-obj'], 'briefing')

            print('Mission 1, solo')
            # The intro card and the first radio line come and go in seconds: note them as they appear.
            await ev("""window.__cpSeen = {}; new MutationObserver(() => { if (document.querySelector('.cp-intro')) window.__cpSeen.intro = true;
              const r = document.querySelector('.cp-radio'); if (r && !r.hidden && r.querySelector('b').textContent) window.__cpSeen.radio = r.querySelector('b').textContent; })
              .observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });""")
            await tap('[data-act="cpSolo"]', 300)
            check('the mission starts', await until(f"{G}.inMatch && !!{G}.match?.sim?.players.some(p => p.bot)", 60, 50))
            # Keep the squad's bots still from the start, so the steps move only when this test moves them.
            await ev(f"for (const p of {G}.match.sim.players) if (p.bot && p.team === 0) p.bot.update = () => [];")
            info = await ev(f"({{ mode: {G}.matchInfo.mode, map: {G}.matchInfo.mapId, code: {G}.matchInfo.scoreLimit, n: {G}.matchInfo.roster.filter(r => r.team === 0 && !r.ai).length, bots: {G}.matchInfo.roster.filter(r => r.team === 0 && r.isBot && !r.ai).length }})")
            check('  Railyard, mission 1 on Recruit, you and three bots', info['mode'] == 'cp' and info['map'] == 'railyard' and info['code'] == 10 and info['n'] == 4 and info['bots'] == 3, info)
            intro = await until("!!window.__cpSeen?.intro", 10, 100)
            check('  the intro card', intro)
            await shot('03-intro')
            check('  the first step goes live', await until(f"{R}.stepI === 0 && {R}.state === 1", 30))
            card = await ev("document.querySelector('.cp-card b')?.textContent")
            check('  the objective card names the step', card == 'Reach the yard office', card)
            radio = await until("window.__cpSeen?.radio === 'Lantern'", 10, 100)
            check('  Lantern on the radio', radio)
            await shot('04-mission')
            await fit(['.cp-top', '.cp-card', '.cp-radio', '.minimap', '.cp-tag'], 'mission')

            # Walk (teleport) to the yard office: the host places the local player there.
            await ev(f"(() => {{ const m = {G}.match, R = m.sim.rules, at = R.geo(R.stepI).at, me = m.sim.byId.get('local'); m.sim._placeAt(me, at, 0); }})()")
            ok = await until(f"{R}.stepI === 1", 10, 100)
            check('reached the yard office: the next step', ok, await ev(f"{R}.stepI"))
            cpok = await until("[...document.querySelectorAll('.feed *')].some(n => /Checkpoint reached/.test(n.textContent)) || !!document.querySelector('.cp-callout')", 6, 100)
            check('  checkpoint reached on the feed, objective complete callout', cpok)
            card = await ev("document.querySelector('.cp-card b')?.textContent")
            check('  the card moves on', card == 'Splice into the junction box', card)
            await shot('05-checkpoint')

            print('Fail and retry')
            cp_at = await ev(f"{R}.cpAt")
            await ev(f"(() => {{ const s = {G}.match.sim; for (const p of s.players) if (p.team === 0 && !p.ai && p.alive) {{ p.downed = false; s._selfKill(p, 'bleed'); }} }})()")
            ok = await until("!document.querySelector('.cp-fail').hidden", 6, 100)
            fail = await ev("({ p: document.querySelector('.cp-fail p')?.textContent, small: document.querySelector('.cp-fail small')?.textContent, retry: !!document.querySelector('.cp-retry'), abort: !!document.querySelector('.cp-abort') })")
            check('the squad wiped: Mission failed, Retry now, Abort', ok and fail['p'] == 'The squad was wiped out' and fail['retry'] and fail['abort'], fail)
            await shot('06-failed')
            await fit(['.cp-fail h2', '.cp-fail .acts'], 'failed')
            await pg.wait_for_timeout(1700)
            await tap('.cp-retry', 300)
            ok = await until(f"{R}.state === 1 && {G}.match.sim.byId.get('local').alive", 6, 100)
            pos = await ev(f"(() => {{ const p = {G}.match.sim.byId.get('local').ps; return [p.x, p.z]; }})()")
            near = cp_at and abs(pos[0] - cp_at['x']) < 8 and abs(pos[1] - cp_at['z']) < 8
            check('  Retry now: back at the checkpoint on the same step', ok and near and await ev(f"{R}.stepI") == 1 and await ev(f"{R}.fails") == 1, [pos, cp_at])
            hidden = await until("document.querySelector('.cp-fail').hidden", 3, 100)
            check('  the failed panel goes', hidden)

            print('Finish (objectives forced on the host)')
            for _ in range(6):
                if await ev(f"{R}.state") != 1: break
                await ev(f"{R}._complete()")
                await pg.wait_for_timeout(500)
            check('mission complete', await until(f"{R}.state === 3", 5, 100))
            banner = await until("/Mission complete/.test(document.querySelector('.cp-callout b')?.textContent ?? '') || /Mission complete/i.test(document.querySelector('.end b')?.textContent ?? '')", 8, 100)
            check('  Mission complete on screen', banner)
            await shot('07-complete')
            ok = await until("document.querySelector('.menu')?.dataset.screen === 'results'", 40, 250)
            check('the results screen', ok)
            await pg.wait_for_timeout(1500)
            if await ev("!!document.querySelector('[data-act=\"resSkip\"]:not([hidden])')"): await tap('[data-act="resSkip"]', 1500)
            await pg.wait_for_timeout(2500)
            res = await ev("({ word: document.querySelector('.rs-word h2')?.textContent, line: document.querySelector('.rs-word small')?.textContent, rows: [...document.querySelectorAll('.rb.theirs .rb-row b')].map(n => n.textContent), btn: document.querySelector('.rs-rematch b, [data-act=\"resRematch\"] b')?.textContent })")
            check('  Mission complete, the stars table', res['word'] == 'Mission complete' and any('par' in r for r in res['rows']), res)
            await shot('08-results')
            save = await ev("JSON.parse(localStorage.getItem('switchyard.save'))")
            cp = save.get('cp', {})
            check('  the save: mission 1 cleared on Recruit', cp.get('m1', [0])[0] & 1 == 1, cp)
            check('  the life tally the card reads', save.get('life', {}).get('cp:m1', 0) >= 1, save.get('life', {}).get('cp:m1'))
            card_ok = await ev("window.__game.Progress.cards().some(c => c.card.id === 'cp-m1' && c.unlocked)")
            check('  the Switch Room calling card is earned', card_ok, card_ok)
            lines = await ev("[...document.querySelectorAll('.xp-lines .xp-row span')].map(n => n.textContent)")
            check('  the campaign XP lines: the clear and the first clear', 'Recruit clear' in lines and 'First clear' in lines, lines)

            print('Back on the Campaign tab')
            await pg.goto(f'http://localhost:{PORT}/?debug=1')
            await pg.wait_for_timeout(1500)
            await tap('[data-act="multiplayer"]', 700)
            await tap('[data-act="mpTab"][data-tab="campaign"]', 700)
            st = await ev("({ locked: document.querySelectorAll('.cpm-st.locked').length, done: document.querySelectorAll('.cpm-st.done').length, on: document.querySelector('.cpm-st.on')?.dataset.k })")
            check('mission 1 shows cleared, mission 2 open', st['locked'] == 6 and st['done'] == 1, st)
            await shot('09-campaign-after')

            print('Mission 2: the watchmen and their torches')
            await ev(OPEN_ALL)
            await pg.reload()
            await pg.wait_for_timeout(1500)
            await tap('[data-act="multiplayer"]', 700)
            await tap('[data-act="mpTab"][data-tab="campaign"]', 600)
            await tap('[data-act="cpPick"][data-k="1"]', 300)
            await tap('[data-act="cpBrief"]', 500)
            await tap('[data-act="cpSolo"]', 300)
            ok = await until(f"{G}.inMatch && {R}?.state === 1 && {R}.groups.some(g => g.stealth && g.members.length)", 40)
            check('mission 2: watchmen on their posts, stealth on', ok and await ev(f"{R}._stealthOn()"))
            await ev(f"for (const p of {G}.match.sim.players) if (p.bot && p.team === 0) p.bot.update = () => [];")
            # Stand in front of a watchman long enough for the meter to show.
            await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, g = R.groups.find(x => x.stealth && x.members.length), q = g.members[0], me = m.sim.byId.get('local');
              m.sim._placeAt(me, {{ x: q.ps.x + Math.cos(q.ps.aim) * 7, z: q.ps.z + Math.sin(q.ps.aim) * 7 }}, q.ps.aim + Math.PI); }})()""")
            await pg.wait_for_timeout(1200)
            chip = await ev("document.querySelector('.cp-hide b')?.textContent")
            check('  the stealth chip', chip in ('HIDDEN', 'ALARM'), chip)
            await shot('10-stealth')
            await fit(['.cp-top', '.cp-card', '.cp-eye'], 'stealth')
            await ev(f"{R}._raiseAlarm(10, 10)")
            await pg.wait_for_timeout(800)
            chip = await ev("document.querySelector('.cp-hide b')?.textContent")
            check('  the alarm: the chip and the callout', chip == 'ALARM', chip)
            await shot('11-alarm')

            print('Mission 8: the boss')
            await ev(f"(() => {{ const R = {R}; R.state = 3; R.stateT = 99; }})()")
            await until("document.querySelector('.menu')?.dataset.screen === 'results'", 40, 250)
            await pg.goto(f'http://localhost:{PORT}/?debug=1')
            await pg.wait_for_timeout(1500)
            await tap('[data-act="multiplayer"]', 700)
            await tap('[data-act="mpTab"][data-tab="campaign"]', 600)
            await tap('[data-act="cpPick"][data-k="7"]', 300)
            await tap('[data-act="cpBrief"]', 500)
            await tap('[data-act="cpSolo"]', 300)
            ok = await until(f"{G}.inMatch && {R}?.state === 1", 40)
            for _ in range(4):
                if await ev(f"{R}.cur?.type") == 'boss': break
                await ev(f"{R}._complete()")
                await pg.wait_for_timeout(300)
            ok = await until(f"!!{R}.boss", 10)
            check('mission 8: Marshal Kordell on the field', ok)
            await ev(f"(() => {{ const m = {G}.match, R = m.sim.rules, b = R.boss.p, me = m.sim.byId.get('local'); m.sim._placeAt(me, {{ x: b.ps.x - 12, z: b.ps.z }}, 0); R.boss.atk = 0.2; }})()")
            ok = await until(f"{R}.hazards.length > 0", 10, 100)
            check('  his barrage: rings on the ground', ok)
            await pg.wait_for_timeout(600)
            bar = await ev("({ shown: !document.querySelector('.cp-boss').hidden, name: document.querySelector('.cp-boss b')?.textContent })")
            check('  the boss bar', bar['shown'] and 'Kordell' in (bar['name'] or ''), bar)
            look = await ev(f"(() => {{ const fx = {G}.renderer.cpFx, b = {R}.boss.p; return {{ crest: !!fx?.crest?.visible, at: fx?.crest && Math.hypot(fx.crest.position.x - b.ps.x, fx.crest.position.z - b.ps.z) }}; }})()")
            check('  his look: the gold crest over his head', look['crest'] and look['at'] < 1.5, look)
            await shot('12-boss')
            await fit(['.cp-top', '.cp-card', '.cp-boss'], 'boss')
            await ev(f"(() => {{ const R = {R}; R.boss.pool = R.boss.max * 0.6; }})()")
            ok = await until(f"{R}.boss?.phase === 1", 5, 100)
            check('  phase 2 at 66%: he kneels and calls his guard', ok)
            await pg.wait_for_timeout(800)
            await shot('13-boss-phase')

            print('Operation Starfall: the route map, the night, the hostage, Vane')
            await ev(f"(() => {{ const R = {R}; R.state = 3; R.stateT = 99; }})()")
            await until("document.querySelector('.menu')?.dataset.screen === 'results'", 40, 250)
            await ev(OPEN_STARFALL)
            await pg.goto(f'http://localhost:{PORT}/?debug=1')
            await pg.wait_for_timeout(1500)
            await tap('[data-act="multiplayer"]', 700)
            await tap('[data-act="mpTab"][data-tab="campaign"]', 600)
            await tap('[data-act="cpOp"][data-o="1"]', 500)
            st = await ev("({ n: document.querySelectorAll('.cpm-st').length, head: document.querySelector('.cpm-head b')?.textContent, on: document.querySelector('.cpm-st.on')?.dataset.k, locked: document.querySelectorAll('.cpm-st.locked').length })")
            check('Starfall: its own route map of four, its first mission not cleared picked', st['n'] == 4 and 'Starfall' in (st['head'] or '') and st['on'] == '11' and st['locked'] == 0, st)
            await shot('20-starfall-tab')
            await fit(['.cpm-st', '.cpm-side', '.cpm-go', '.cpm-ops'], 'starfall tab')
            await tap('[data-act="cpPick"][data-k="8"]', 400)
            await tap('[data-act="cpBrief"]', 500)
            brief = await ev("document.querySelector('.cpb-title')?.textContent ?? ''")
            check('  the briefing names the operation and the night defence', 'Operation Starfall' in brief and 'Dark Sky' in brief, brief)
            await shot('21-starfall-brief')
            await tap('[data-act="cpSolo"]', 300)
            ok = await until(f"{G}.inMatch && {R}?.state === 1 && {R}.night", 40)
            check('Dark Sky: a night mission', ok)
            await ev(f"for (const p of {G}.match.sim.players) if (p.bot && p.team === 0) p.bot.update = () => [];")
            await pg.wait_for_timeout(2500)
            dark = await ev("(() => { const n = document.querySelector('.cp-night'); return !!n && !n.hidden && Number(n.style.opacity) > 0.5 && /radial-gradient/.test(n.style.background); })()")
            check('  the dark round the player', dark, await ev("document.querySelector('.cp-night')?.style.opacity"))
            await shot('22-night')
            await ev(f"{R}._flare()")
            await pg.wait_for_timeout(1800)
            lit = await ev("Number(document.querySelector('.cp-night')?.style.opacity ?? 0) < 0.4")
            check('  a flare lifts it', lit, await ev("document.querySelector('.cp-night')?.style.opacity"))
            await shot('23-flare')
            await ev(f"(() => {{ const R = {R}; R.state = 3; R.stateT = 99; }})()")
            await until("document.querySelector('.menu')?.dataset.screen === 'results'", 40, 250)
            await pg.goto(f'http://localhost:{PORT}/?debug=1')
            await pg.wait_for_timeout(1500)
            await tap('[data-act="multiplayer"]', 700)
            await tap('[data-act="mpTab"][data-tab="campaign"]', 600)
            await tap('[data-act="cpPick"][data-k="11"]', 300)
            await tap('[data-act="cpBrief"]', 500)
            await tap('[data-act="cpSolo"]', 300)
            ok = await until(f"{G}.inMatch && {R}?.state === 1", 40)
            for _ in range(4):
                if await ev(f"{R}.cur?.type") == 'boss': break
                await ev(f"{R}._complete()")
                await pg.wait_for_timeout(300)
            ok = await until(f"!!{R}.boss", 10)
            check('Zero Hour: Director Vane on the field, the launch clock running', ok and await ev(f"{R}.timer > 300"))
            await ev(f"(() => {{ const m = {G}.match, R = m.sim.rules, b = R.boss.p, me = m.sim.byId.get('local'); m.sim._placeAt(me, {{ x: b.ps.x - 14, z: b.ps.z }}, 0); R.boss.n = 1; R.boss.atk = 0.2; }})()")
            ok = await until(f"{R}.hazards.filter(h => h.k === 0).length >= 3", 10, 100)
            check('  his salvo: a line of rings', ok)
            await pg.wait_for_timeout(500)
            info = await ev(f"(() => {{ const fx = {G}.renderer.cpFx; return {{ crest: fx?.crest?.material.color.getHex(), bar: document.querySelector('.cp-boss b')?.textContent, timer: !document.querySelector('.cp-timer').hidden && document.querySelector('.cp-timer small')?.textContent }}; }})()")
            check('  his bar, his crest and the launch clock', 'Vane' in (info['bar'] or '') and info['crest'] == 0x9ad8ff and info['timer'] == 'To launch', info)
            await shot('24-vane-salvo')
            await fit(['.cp-top', '.cp-card', '.cp-boss'], 'vane')

            print('With friends: a co-op room')
            await pg.goto(f'http://localhost:{PORT}/?debug=1&net=local')
            await pg.wait_for_timeout(1500)
            await tap('[data-act="multiplayer"]', 700)
            await tap('[data-act="mpTab"][data-tab="campaign"]', 600)
            await tap('[data-act="cpOp"][data-o="0"]', 400)
            await tap('[data-act="cpPick"][data-k="2"]', 300)
            await tap('[data-act="cpFriends"]', 1200)
            lob = await ev("({ screen: window.__game.menu.el.dataset.screen, custom: window.__game.app.lobby?.custom, chip: document.querySelector('.cu-chip')?.textContent.trim(), trains: document.querySelectorAll('.train').length, seats: document.querySelectorAll('.train .car').length })")
            check('the room is set to the mission: one squad of four', lob['screen'] == 'lobby' and lob['custom'] and lob['custom']['mode'] == 'cp' and 'Seawall' in (lob['chip'] or '') and lob['trains'] == 1 and lob['seats'] == 4, lob)
            await shot('16-lobby')
            await tap('[data-act="start"]', 300)
            ok = await until(f"{G}.inMatch && {G}.matchInfo?.mode === 'cp' && {G}.matchInfo.mapId === 'harbor'", 60)
            check('  Start: mission 3 on Harbor for the room', ok, await ev(f"{G}.matchInfo && [{G}.matchInfo.mode, {G}.matchInfo.mapId, {G}.matchInfo.scoreLimit]"))
            await pg.wait_for_timeout(1500)
            await shot('17-room-mission')

            print('Briefing at 667x375')
            await pg.set_viewport_size({'width': 667, 'height': 375})
            await pg.goto(f'http://localhost:{PORT}/?debug=1')
            await pg.wait_for_timeout(1500)
            await tap('[data-act="multiplayer"]', 700)
            await tap('[data-act="mpTab"][data-tab="campaign"]', 600)
            await shot('14-campaign-tab')
            await fit(['.cpm-st', '.cpm-side', '.cpm-go', '.cpm-friends'], 'campaign tab 667')
            await tap('[data-act="cpBrief"]', 600)
            await shot('15-briefing')
            await fit(['.cpb-side', '.cpb-go', '.cpb-title'], 'briefing 667')
            # The two-tab channel is known to drop a guest now and then (dev/ui-ex-net-test.py rejoins the same way): one retry.
            try: await coop_net(browser)
            except Exception as err:
                print(f'     the two-tab room failed ({str(err)[:80]}): once more', flush=True)
                await coop_net(browser)
            await browser.close()
    finally:
        server.terminate()
    real = [e for e in errors if 'favicon' not in e and 'net::ERR' not in e and 'Failed to load resource' not in e]
    for e in real[:12]: print('  console:', e[:300])
    if real: failures.append(f'{len(real)} console errors')
    print(f'\n{"FAILED: " + "; ".join(failures) if failures else "all passed"}')
    sys.exit(1 if failures else 0)


asyncio.run(main())
