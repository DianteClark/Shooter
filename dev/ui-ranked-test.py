#!/usr/bin/env python3
"""Ranked seasons with rewards, the caster camera and replay codes (docs/RANKED.md, ROADMAP item 60), in a real page.

python3 dev/ui-ranked-test.py [port] [hub] [code] [caster] [spec] [--shots]   (no part named: all of them)
  hub     on Dec 27 (Season 1's last day): five placement wins place the player; the Season screen's Ranked tab is the
          hub (division, SR bar, countdown, the seven-division rewards track with the marker, the rules). The save
          goes to Dec 28: Season 1 pays (titles, cards, crests, the Cold Iron Contender camo on every gun), the hub
          is Season 2's with placement pips; a title is worn from the picker, shows on the profile card and in the
          lobby badge, and rides through the save code.
  code    a solo TDM to its results, Watch replay, Share: a SYR1 code (highlight and whole clip); History > Clips >
          Replay code: garbage is refused with words, the code plays as a shared replay.
  caster  Search and Destroy solo: the player killed with teammates alive, Caster cam opens: the HUD steps back, the
          renderer takes the caster's shot, the list has every player, Next follows someone else, Tactical goes high,
          a drag moves the free camera, Close gives the picture back. Frame times printed.
  spec    two tabs over ?net=local: the guest taps Watch, the host starts: the guest is not in the roster and watches
          through the caster camera (the list, the shot), Leave goes back to the room.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8931))
ONLY = [a for a in sys.argv[1:] if not a.isdigit() and not a.startswith('--')]
SHOTS = '--shots' in sys.argv
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
G = 'window.__game'
failures, errors = [], []


def check(name, ok, info=''):
    print(f'  {name:<66} {"ok" if ok else "FAIL"} {info}')
    if not ok: failures.append(f'{name}: {info}')


def fake_date(day, hour=12):
    return """(() => {
  const Real = Date, offset = new Real('%sT%02d:00:00').getTime() - Real.now();
  class FakeDate extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); }
    static now() { return Real.now() + offset; }
  }
  window.Date = FakeDate;
})();""" % (day, hour)


def seed_storage(items):
    # Before the page's scripts, once per context (a reload keeps what the page wrote since).
    return """(() => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
  const items = %s; for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); })();""" % json.dumps(items)


async def new_page(browser, day=None, hour=12, storage=None, tag=''):
    ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
    if day: await ctx.add_init_script(fake_date(day, hour))
    if storage: await ctx.add_init_script(seed_storage(storage))
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{tag}: {m.text[:300]}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'{tag}: PAGEERR {e}'))
    return ctx, pg


async def boot(pg, query=''):
    await pg.goto(f'http://localhost:{PORT}/?debug=1{query}')
    await pg.wait_for_function(f'!!{G}?.Progress', timeout=60000)
    await pg.evaluate(f"{G}.Progress.name='Tester'; {G}.Progress.setFlag('tutorialOffered'); {G}.Progress.setFlag('aimHint');"
                      "(async () => { const { BUILD } = await import('./js/build.js'); localStorage.setItem('switchyard.seenBuild', BUILD); })()")
    await pg.wait_for_timeout(300)
    await pg.reload()
    await pg.wait_for_function(f'!!{G}?.Progress', timeout=60000)
    await pg.wait_for_timeout(900)


async def shot(pg, name):
    if SHOTS:
        os.makedirs('/tmp/ranked', exist_ok=True)
        await pg.screenshot(path=f'/tmp/ranked/{name}.png')


OPEN_HUB = f"{G}.menu.season({{ onBack: () => {{}}, onPlayRanked: () => {{}}, tab: 'ranked' }})"
HUB = """(() => { const q = s => document.querySelector(s); return {
  hub: !!q('.rk-hub'), steps: document.querySelectorAll('.rk-step').length, got: document.querySelectorAll('.rk-step.got, .rk-step.now').length,
  now: q('.rk-step.now .rk-step-h b')?.textContent ?? null, count: q('.rk-count-t')?.textContent ?? '', you: !!q('.rk-you'),
  name: q('.sz-rk-name')?.textContent ?? '', pips: document.querySelectorAll('.rk-pips i').length, camo: !!q('.rk-rw-camo'),
  titles: [...document.querySelectorAll('.rk-rw-title')].map(e => e.textContent), worn: q('.rk-worn b')?.textContent ?? '',
  reset: q('.rk-reset')?.textContent ?? '', title: q('.bar h1, .sz-bar-h h1, header h1')?.textContent ?? '' }; })()"""


async def hub(browser):
    print('hub: Dec 27, Season 1 last day')
    ctx, pg = await new_page(browser, '2026-12-27', 15, tag='hub')
    await boot(pg)
    for i in range(5):
        await pg.evaluate(f"{G}.Progress.applySeasonMatch({{ xp: 1000, counts: {{}}, career: null, ranked: {{ outcome: 'win', perf: 0.6, rating: 0.62 }} }})")
    rk = await pg.evaluate(f'{G}.Progress.ranked()')
    check('five placement wins place the player', rk['placed'] and rk['sr'] > 2000, rk['sr'])
    await pg.evaluate(OPEN_HUB)
    await pg.wait_for_timeout(700)
    h = await pg.evaluate(HUB)
    check('the Ranked tab is the hub', h['hub'] and h['steps'] == 7, h)
    check('the countdown reads hours (last day)', 'h' in h['count'] and 'd' not in h['count'], h['count'])
    check('the marker sits on the track, a division is current', h['you'] and h['now'] is not None, h['now'])
    check('each division names its title; Gold carries the camo', h['camo'] and 'Gold Vanguard' in h['titles'], h['titles'][:3])
    check('the soft reset says what carries', 'carry' in h['reset'] and 'SR' in h['reset'], h['reset'])
    await shot(pg, 'hub-s1')
    # The title picker: nothing owned yet.
    await pg.locator('[data-act="rkTitles"]').first.tap()
    await pg.wait_for_timeout(300)
    none = await pg.evaluate("document.querySelectorAll('.rk-tl').length")
    check('no titles before the season ends (only None)', none == 1, none)
    await pg.locator('[data-act="rkTitlesDone"]').first.tap()
    save = await pg.evaluate("localStorage.getItem('switchyard.save')")
    gen = await pg.evaluate("localStorage.getItem('switchyard.resetGen')")
    await ctx.close()

    print('hub: Dec 28, Season 2')
    ctx, pg = await new_page(browser, '2026-12-28', 10, storage={'switchyard.save': save, 'switchyard.resetGen': gen or '1'}, tag='hub2')
    await pg.goto(f'http://localhost:{PORT}/?debug=1')
    await pg.wait_for_function(f'!!{G}?.Progress', timeout=60000)
    await pg.wait_for_timeout(900)
    titles = await pg.evaluate(f'{G}.Progress.titles().filter(t => t.owned).map(t => t.id)')
    check('Season 1 paid a title for every division to the peak', 'rk-s1-bronze' in titles and len(titles) >= 3, titles)
    camos = await pg.evaluate(f"{G}.Progress.camos('ar').filter(c => c.camo.id === 'rk-s1').map(c => c.unlocked)")
    check('the Cold Iron Contender camo is on every gun', camos == [True] and await pg.evaluate(f"{G}.Progress.isUnlocked('smg', 'rk-s1')"), camos)
    await pg.evaluate(OPEN_HUB)
    await pg.wait_for_timeout(700)
    h = await pg.evaluate(HUB)
    check('the hub is Season 2: placements again', h['pips'] == 5 and h['name'] in ('Placements', 'Unranked'), h)
    check('the countdown reads days', 'd' in h['count'], h['count'])
    await pg.locator('[data-act="rkTitles"]').first.tap()
    await pg.wait_for_timeout(300)
    n = await pg.evaluate("document.querySelectorAll('.rk-tl').length")
    check('the picker lists the titles owned', n == len(titles) + 1, n)
    await shot(pg, 'hub-titles')
    await pg.locator(f'.rk-tl[data-id="{titles[-1]}"]').first.tap()
    await pg.wait_for_timeout(400)
    worn = await pg.evaluate(f'{G}.Progress.title()?.id')
    check('a title is worn', worn == titles[-1], worn)
    await pg.locator('[data-act="rkTitlesDone"]').first.tap()
    await pg.wait_for_timeout(200)
    h = await pg.evaluate(HUB)
    check('the hub shows it', h['worn'] and h['worn'] != 'Wear a title', h['worn'])
    await shot(pg, 'hub-s2')
    code = await pg.evaluate(f'{G}.Progress.exportCode()')
    await pg.evaluate(f'{G}.Progress.setTitle(null)')
    r = await pg.evaluate(f'{G}.Progress.importCode({json.dumps(code)})')
    back = await pg.evaluate(f'{G}.Progress.title()?.id')
    check('the worn title rides through the save code', r.get('ok') and back == worn, (r, back))
    # The title screen's profile card wears it.
    await pg.reload()
    await pg.wait_for_function(f'!!{G}?.Progress', timeout=60000)
    await pg.wait_for_timeout(1200)
    pc = await pg.evaluate("document.querySelector('.pc-tl')?.textContent ?? null")
    check('the profile card shows the title', pc is not None and len(pc) > 3, pc)
    await ctx.close()


RP = f"""(() => {{ const v = {G}.replay(); if (!v) return null; return {{ c: v.c, dur: v.reader.duration, shared: !!v.clip.shared, title: v.clip.title ?? '', playing: v.playing }}; }})()"""


async def code(browser):
    print('code: share and paste a replay')
    ctx, pg = await new_page(browser, tag='code')
    await boot(pg, '&map=railyard&mode=tdm&time=20&limit=500')
    await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_function(f'{G}.app.inMatch && {G}.app.match?.interp?.newest?.phase === "live"', timeout=120000)
    await pg.wait_for_function(f"{G}.menu.el.dataset.screen === 'results' && {G}.menu.el.classList.contains('on')", timeout=180000)
    await pg.wait_for_timeout(800)
    await pg.locator('[data-act="resReplay"]').click()
    await pg.wait_for_timeout(1500)
    check('the replay player has Share', await pg.locator('.rp-share').count() == 1)
    await pg.locator('.rp-share').click()
    await pg.wait_for_function("(document.querySelector('.rc-code')?.value ?? '').startsWith('SYR1.')", timeout=30000)
    hl = await pg.evaluate("document.querySelector('.rc-code').value")
    size = await pg.evaluate("document.querySelector('.rc-size').textContent")
    check('Share makes a highlight code', hl.startswith('SYR1.') and len(hl) < 8000, f'{len(hl)} chars, {size}')
    await pg.locator('.rc-pick button[data-what="all"]').click()
    await pg.wait_for_function(f"(document.querySelector('.rc-code')?.value ?? '').startsWith('SYR1.') && document.querySelector('.rc-code').value !== {json.dumps(hl)}", timeout=30000)
    full = await pg.evaluate("document.querySelector('.rc-code').value")
    check('and the whole clip, a longer code', len(full) > len(hl), f'{len(full)} chars')
    paused = await pg.evaluate(RP)
    check('the replay waits while the sheet is open', paused and not paused['playing'], paused)
    await shot(pg, 'code-share')
    await pg.locator('.rc-close').click()
    await pg.wait_for_timeout(300)
    await pg.locator('.rp-close').click()
    await pg.wait_for_timeout(800)
    # History > Clips > Replay code.
    await pg.evaluate(f"{G}.menu.history({{ onBack: () => {{}}, tab: 'clips', onWatch: () => {{}}, onWatchCode: c => window.__shared = c }})")
    await pg.wait_for_timeout(800)
    check('History > Clips has Replay code', await pg.locator('[data-act="hcCode"]').count() == 1)
    # Through main.js's own handler: the real History.
    await pg.evaluate("document.querySelector('.rc-sheet')?.remove()")
    await pg.evaluate(f"{G}.menu.hide()")
    await pg.evaluate("(() => { const b = [...document.querySelectorAll('[data-act]')].find(b => b.dataset.act === 'history'); b?.click(); })()")
    await pg.wait_for_timeout(800)
    await pg.evaluate("document.querySelector('[data-act=\"hsTab\"][data-tab=\"clips\"]')?.click()")
    await pg.wait_for_timeout(800)
    if await pg.locator('[data-act="hcCode"]').count() == 0:
        await pg.evaluate(f"{G}.menu.history({{ onBack: () => {{}}, tab: 'clips', onWatch: () => {{}}, onWatchCode: c => window.__shared = c }})")
        await pg.wait_for_timeout(800)
    await pg.locator('[data-act="hcCode"]').first.click()
    await pg.wait_for_timeout(300)
    await pg.locator('.rc-in').fill('SYR1.nonsense.abc')
    await pg.locator('.rc-watch').click()
    await pg.wait_for_timeout(500)
    msg = await pg.evaluate("document.querySelector('.rc-msg').textContent")
    check('a bad code is refused with words', 'typo' in msg or 'incomplete' in msg, msg)
    await pg.locator('.rc-in').fill(full[:40] + '\n' + full[40:])
    await pg.locator('.rc-watch').click()
    await pg.wait_for_function(f"!!{G}.replay() || !!window.__shared", timeout=30000)
    if await pg.evaluate("!!window.__shared"):
        # The menu here was opened with a test handler: hand the clip to main.js's own (History's Replay code).
        await pg.evaluate(f"(() => {{ const c = window.__shared; window.__shared = null; {G}.watchShared(c); }})()")
    if True:
        # The first frames compile the map's shaders (seconds on SwiftShader): wait for the clock to move.
        try: await pg.wait_for_function(f'({G}.replay()?.c ?? 0) > 0.3', timeout=90000)
        except Exception: pass
        rp = await pg.evaluate(RP)
        check('the code plays as a shared replay', rp and rp['shared'] and rp['c'] >= 0.3, rp)
        await shot(pg, 'code-shared')
        await pg.locator('.rp-close').click()
    await ctx.close()


CS = f"""(() => {{ const m = {G}.app.match, c = m?.caster; if (!c) return null; const r = {G}.app.renderer;
  return {{ active: c.active, cam: c.cam, target: c.target, btn: !!document.querySelector('.cs-open.on'), on: document.body.classList.contains('caster-on'),
    cine: r?.cine === c.shot, py: c.shot.py, tx: c.shot.tx, tz: c.shot.tz, rows: [...document.querySelectorAll('.cs-row')].filter(e => !e.hidden).length,
    players: m.interp.newest?.players.filter(p => !p.zk && !p.ai).length ?? 0, who: document.querySelector('.cs-who b')?.textContent ?? '' }}; }})()"""
FPS = """(async () => { const t = []; let last = performance.now(); for (let i = 0; i < 90; i++) { await new Promise(r => requestAnimationFrame(r)); const n = performance.now(); t.push(n - last); last = n; }
  t.sort((a, b) => a - b); return { median: t[45], p90: t[81] }; })()"""


async def caster(browser):
    print('caster: out of play in Search and Destroy')
    ctx, pg = await new_page(browser, tag='caster')
    await boot(pg, '&map=railyard&mode=snd')
    await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_function(f"{G}.app.inMatch && {G}.app.match?.sim?.snd?.state === 'live'", timeout=120000)
    await pg.wait_for_timeout(500)
    before = await pg.evaluate(FPS)
    cs = await pg.evaluate(CS)
    check('alive: no Caster cam button', cs and not cs['btn'], cs)
    # Out for the round: the host's sim takes the local player down; a teammate is still up.
    await pg.evaluate(f"""(() => {{ const m = {G}.app.match, s = m.sim, me = s.byId.get(m.localId), foe = s.players.find(p => p.team !== me.team);
      for (const p of s.players) if (p.isBot) p.bot = null;     // Everyone else stands still: the round cannot end meanwhile.
      me.spawnProtect = 0; s._damage(me, foe, 999, 'ar', 5); }})()""")
    await pg.wait_for_function(f"!!document.querySelector('.cs-open.on')", timeout=20000)
    # Any death replay first; then the button.
    await pg.wait_for_timeout(500)
    await pg.locator('.cs-open.on').click(force=True)
    # A death replay may still be playing: the caster takes the picture once it is over.
    try: await pg.wait_for_function(f'{G}.app.renderer?.cine === {G}.app.match?.caster?.shot', timeout=20000)
    except Exception: pass
    await pg.wait_for_timeout(500)
    cs = await pg.evaluate(CS)
    check('Caster cam opens: the HUD steps back, the shot is the caster\'s', cs['active'] and cs['on'] and cs['cine'], cs)
    check('the list has every player', cs['rows'] == cs['players'] and cs['rows'] >= 6, (cs['rows'], cs['players']))
    check('it follows someone alive', cs['target'] is not None and cs['who'] not in ('', 'Nobody to follow'), cs['who'])
    t0 = cs['target']
    await pg.locator('.cs-next').click(force=True)
    await pg.wait_for_timeout(600)
    cs = await pg.evaluate(CS)
    check('Next follows someone else', cs['target'] != t0, (t0, cs['target']))
    y0 = cs['py']
    await pg.locator('.cs-mode[data-cam="tactical"]').click(force=True)
    await pg.wait_for_timeout(2000)
    cs = await pg.evaluate(CS)
    check('Tactical eases up high', cs['cam'] == 'tactical' and cs['py'] > y0 + 15, f"{y0:.1f} -> {cs['py']:.1f}")
    await shot(pg, 'caster-tactical')
    await pg.locator('.cs-mode[data-cam="free"]').click(force=True)
    await pg.wait_for_timeout(400)
    cs = await pg.evaluate(CS)
    x0 = cs['tx']
    await pg.mouse.move(500, 200); await pg.mouse.down(); await pg.mouse.move(300, 200, steps=8); await pg.mouse.up()
    await pg.wait_for_timeout(700)
    cs = await pg.evaluate(CS)
    check('a drag moves the free camera', cs['cam'] == 'free' and cs['tx'] > x0 + 3, f"{x0:.1f} -> {cs['tx']:.1f}")
    during = await pg.evaluate(FPS)
    print(f"    frame interval median / p90: playing {before['median']:.1f} / {before['p90']:.1f} ms, caster {during['median']:.1f} / {during['p90']:.1f} ms (SwiftShader, shared CPU)")
    await shot(pg, 'caster-free')
    # (On a slow machine the round can end meanwhile: the caster then closes by itself.)
    if await pg.locator('.cs-exit').count(): await pg.locator('.cs-exit').click(timeout=10000, force=True)
    await pg.wait_for_timeout(500)
    cs = await pg.evaluate(CS)
    check('Close gives the picture back', not cs['active'] and not cs['on'] and not cs['cine'], cs)
    await ctx.close()


async def spec(browser):
    print('spec: a friend room spectator seat')
    ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
    async def page(tag):
        pg = await ctx.new_page()
        pg.on('console', lambda m: errors.append(f'{tag}: {m.text[:300]}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append(f'{tag}: PAGEERR {e}'))
        await pg.goto(f'http://localhost:{PORT}/?debug=1&net=local&vote=4')
        await pg.wait_for_function(f'!!{G}?.Progress', timeout=60000)
        return pg
    A = f'{G}.app'
    host = await page('host')
    await host.evaluate(f"{G}.Progress.name='Hosty'; {G}.Progress.setFlag('tutorialOffered'); {G}.Progress.setFlag('aimHint')")
    await host.reload(); await host.wait_for_function(f'!!{G}?.Progress', timeout=60000); await host.wait_for_timeout(800)
    await host.locator('[data-act="host"]').first.click()
    await host.wait_for_function(f'{A}.code', timeout=30000)
    room = await host.evaluate(f'{A}.code')
    guest = await page('guest')
    await guest.evaluate(f"{G}.Progress.name='Watcher'; {G}.Progress.setFlag('tutorialOffered'); {G}.Progress.setFlag('aimHint')")
    pages = [host, guest]
    async def juggle():
        while True:
            for p in pages:
                try: await p.bring_to_front()
                except Exception: pass
                await asyncio.sleep(0.12)
    juggler = asyncio.create_task(juggle())
    try:
        await guest.evaluate(f"{G}.join('{room}')")
        await host.wait_for_function(f'{A}.lobby.humans.length === 2', timeout=60000)
        await guest.wait_for_function("!!document.querySelector('[data-act=\"toggleWatch\"]')", timeout=20000)
        await guest.locator('[data-act="toggleWatch"]').first.click()
        await host.wait_for_function(f'{A}.lobby.humans.some(h => h.spec)', timeout=20000)
        check('Watch reaches the host', True)
        st = await host.evaluate("[...document.querySelectorAll('.car-st small')].map(e => e.textContent)")
        check("the host's lobby says the guest is watching", 'Watching' in st, st)
        await guest.locator('[data-act="toggleReady"]').first.click()
        await host.wait_for_function(f'{A}.lobby.humans.every(h => h.ready || h.host)', timeout=20000)
        await host.locator('[data-act="start"]').first.click()
        await host.wait_for_function(f'{A}.vote?.options', timeout=20000)
        i = await host.evaluate(f"{A}.vote.options.findIndex(o => ['tdm', 'dom', 'kc', 'hard'].includes(o.mode))")
        i = max(i, 0)
        for p in pages:
            try: await p.locator(f'.vote-card[data-i="{i}"]:not([disabled])').click(timeout=6000)
            except Exception: pass
        await host.wait_for_function(f'{A}.inMatch && {A}.match?.interp?.newest', timeout=120000)
        roster = await host.evaluate(f'{A}.matchInfo.roster.map(r => r.id)')
        gid = await guest.evaluate(f'{A}.net.localId')
        check('the spectator is not in the roster', gid not in roster, (gid, len(roster)))
        await guest.wait_for_function(f'{A}.match?.spectator && document.body.classList.contains("caster-on")', timeout=60000)
        await guest.wait_for_function(f"document.querySelectorAll('.cs-row:not([hidden])').length > 0", timeout=60000)
        await guest.wait_for_timeout(1500)
        g = await guest.evaluate(f"""(() => {{ const m = {A}.match, c = m.caster; return {{ rows: document.querySelectorAll('.cs-row:not([hidden])').length,
          players: m.interp.newest?.players.length ?? 0, cine: {A}.renderer?.cine === c.shot, target: c.target, tag: document.querySelector('.cs-tag b')?.textContent }}; }})()""")
        check('the spectator watches through the caster camera', g['cine'] and g['rows'] == g['players'] and g['rows'] > 0 and g['tag'] == 'Spectating', g)
        await shot(guest, 'spec')
        await guest.evaluate("document.querySelector('.cs-exit').click()")
        await guest.wait_for_function(f"!{A}.inMatch && {G}.menu.el.dataset.screen === 'lobby'", timeout=90000)
        check('Leave goes back to the room', True)
        check('the host plays on', await host.evaluate(f'{A}.inMatch'))
    finally:
        juggler.cancel()
        await ctx.close()


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for name, fn in [('hub', hub), ('code', code), ('caster', caster), ('spec', spec)]:
                if ONLY and name not in ONLY: continue
                try: await fn(browser)
                except Exception as err:
                    check(f'{name}: ran to the end', False, repr(err)[:300])
            await browser.close()
    finally:
        srv.terminate()
    real = [e for e in errors if 'WebGL' not in e and 'GPU' not in e and 'GL Driver' not in e]
    check('no console errors', not real, real[:6])
    print(f'\n{len(failures)} failed' if failures else '\nall ok')
    sys.exit(1 if failures else 0)


asyncio.run(main())
