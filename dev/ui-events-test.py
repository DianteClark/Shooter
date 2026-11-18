#!/usr/bin/env python3
"""Weekly events and the Season 2 switch in the real page (docs/SEASONS.md "Weekly events", js/shared/events.js).

Run from anywhere: python3 dev/ui-events-test.py [port] [--shots]. It serves the repo itself and runs the page on mocked
dates (every `new Date()` and Date.now() moved to that local day, as dev/ui-gallery.html does):
  2026-11-25  Season 1, the week of Snipers Only Rebound: the week's banner once (not on a fresh save, not twice), the
              title's challenge plate line, the Spotlight (the event first, eyebrow and days left), Find match plays
              Rebound with the snipers rule and tags the match as the event's, the Challenges screen's event panel and
              its Play, the reward's unlock sheet with Play now; finishing the challenges pays the emblem once.
  2026-12-28  Season 2 opens: the new-season banner, the title's Season chip (Season 2, 42 days), the Season screen
              (Signal Fire, 100 tiers, six weekly sets, the first open), Ranked back in placements, What's new.
  2027-01-05  Lights Out and the weekly event in the Spotlight together, in the order rule.
  2027-02-10  Season Replay: Cold Iron (the chip says Replay, the screen its title).
With --shots it saves screens to /tmp/events/.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8336))
SHOTS = '--shots' in sys.argv
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
failures, errors = [], []


def check(name, ok, info=''):
    print(f'  {name:<64} {"ok" if ok else "FAIL"} {info}')
    if not ok: failures.append(f'{name}: {info}')


def fake_date(day, hour=12):
    # Runs before the page's scripts: the clock moves to `day` at `hour` local time and keeps ticking from there.
    return """(() => {
  const Real = Date, offset = new Real('%sT%02d:00:00').getTime() - Real.now();
  class FakeDate extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); }
    static now() { return Real.now() + offset; }
  }
  window.Date = FakeDate;
})();""" % (day, hour)


async def page_on(browser, day, hour=12):
    ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
    await ctx.add_init_script(fake_date(day, hour))
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{day}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'{day}: PAGEERR {e}'))
    return ctx, pg


async def boot(pg, veteran=True):
    """A fresh save named, past the first-run offers; a veteran one has played (the banner skips brand-new saves)."""
    await pg.goto(f'http://localhost:{PORT}/?debug=1&net=local&vote=4&search=500')
    await pg.wait_for_timeout(900)
    await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
    if veteran:
        await pg.evaluate("window.__game.Progress.applyMatch({ xp: 2400, weapons: {}, pro: {}, mastery: {}, life: { played: 1 }, mapId: null, won: true, career: null })")
        # What's new is its own sheet; seen, so the title is clear for the banner checks.
        await pg.evaluate("(async () => { const { BUILD } = await import('./js/build.js'); localStorage.setItem('switchyard.seenBuild', BUILD); })()")
        # This load saw a brand-new save (no banner, the week recorded): forget the week so the next load is a first.
        await pg.evaluate("localStorage.removeItem('switchyard.eventSeen'); localStorage.removeItem('switchyard.seasonSeen')")


async def tap(pg, sel, wait=400):
    await pg.locator(sel).first.tap()
    await pg.wait_for_timeout(wait)


screen = lambda pg: pg.evaluate("window.__game.menu.el.dataset.screen")


async def shot(pg, name):
    if SHOTS:
        os.makedirs('/tmp/events', exist_ok=True)
        await pg.screenshot(path=f'/tmp/events/{name}.png')


async def week_of_snipers(browser):
    print('2026-11-25: Season 1, Snipers Only Rebound week')
    ctx, pg = await page_on(browser, '2026-11-25')
    await boot(pg, veteran=False)
    await pg.reload(); await pg.wait_for_timeout(1300)
    check('a brand-new save gets no banner', await pg.locator('.ev-banner').count() == 0)
    await pg.evaluate("localStorage.removeItem('switchyard.eventSeen'); localStorage.removeItem('switchyard.seasonSeen')")
    await boot(pg)
    await pg.reload(); await pg.wait_for_timeout(1300)
    ban = await pg.evaluate("document.querySelector('.ev-banner')?.textContent.replace(/\\s+/g, ' ').trim() ?? null")
    check("the week's first visit: a banner names the event and time left", ban is not None and 'Snipers Only Rebound' in ban and 'left' in ban, ban)
    await shot(pg, 'title-banner')
    plate = await pg.evaluate("document.querySelector('.tch-ev')?.textContent.replace(/\\s+/g, ' ').trim() ?? null")
    check("the title's challenge plate has the event's line", plate is not None and 'Snipers Only Rebound' in plate and '0/4' in plate, plate)
    await pg.reload(); await pg.wait_for_timeout(1300)
    check('the banner shows once a week', await pg.locator('.ev-banner').count() == 0)
    await pg.evaluate("localStorage.removeItem('switchyard.eventSeen')")
    await pg.reload(); await pg.wait_for_timeout(900)
    await pg.evaluate("document.querySelector('.ev-banner').click()")     # It slides in and away again: no waiting for it to settle.
    await pg.wait_for_timeout(700)
    st = await pg.evaluate("({ s: window.__game.menu.el.dataset.screen, on: document.querySelector('.mp-pl.on')?.dataset.id, spot: [...document.querySelectorAll('.mp-sec-spot .mp-pl')].map(b => b.dataset.id), brow: document.querySelector('.mp-pl.wk .mp-brow')?.textContent, sub: document.querySelector('.mp-pl.wk small')?.textContent })")
    check('the banner opens Multiplayer on the event playlist', st['s'] == 'multiplayer' and st['on'] == 'wkevent', st)
    check('the Spotlight: the event first, then Ranked, then featured', st['spot'][:1] == ['wkevent'] and st['spot'].index('ranked') < st['spot'].index('featured'), st['spot'])
    check('  eyebrow and days left', st['brow'] == 'Weekly event' and 'days left' in (st['sub'] or ''), st)
    await shot(pg, 'mp-event')
    await tap(pg, '[data-act="mpFind"]', 150)
    await pg.wait_for_function("window.__game.menu.el.dataset.screen === 'vote'", timeout=15000)
    await pg.wait_for_function('window.__game.app.inMatch', timeout=30000)
    await pg.wait_for_timeout(800)
    m = await pg.evaluate("({ mode: window.__game.app.matchInfo?.mode, mods: window.__game.app.matchInfo?.mods ?? window.__game.app.match?.mods, event: window.__game.app.match?.awards?.event, n: window.__game.app.matchInfo?.roster?.length })")
    check('Find match plays Rebound with Snipers Only, tagged as the event', m['mode'] == 'rb' and 'snipers' in (m['mods'] or []) and m['event'] == 'sniperrb', m)
    await pg.evaluate("window.__game.hud.leaveCb()")
    await pg.wait_for_timeout(700)
    # The Challenges screen: the event's panel, its Play.
    await pg.evaluate("window.__game.menu.title({})")
    await pg.wait_for_timeout(400)
    await tap(pg, '.tch', 700)
    ch = await pg.evaluate("({ s: window.__game.menu.el.dataset.screen, n: document.querySelectorAll('.chp[data-period=\"event\"] .chc').length, head: document.querySelector('.chp[data-period=\"event\"] .chp-head')?.textContent.replace(/\\s+/g, ' ').trim(), play: document.querySelectorAll('.chp[data-period=\"event\"] [data-act=\"chPlay\"]').length })")
    check('the Challenges screen has the event panel: 4 challenges, each with Play', ch['s'] == 'challenges' and ch['n'] == 4 and ch['play'] == 4, ch)
    await shot(pg, 'challenges-event')
    await tap(pg, '.chp[data-period="event"] [data-act="chPlay"]', 700)
    st = await pg.evaluate("({ s: window.__game.menu.el.dataset.screen, on: document.querySelector('.mp-pl.on')?.dataset.id })")
    check("  an event challenge's Play opens the event playlist", st['s'] == 'multiplayer' and st['on'] == 'wkevent', st)
    # The reward's unlock sheet: how, progress, Play now.
    await pg.evaluate("window.__game.menu.title({})")
    await pg.evaluate("import('./js/ui/unlocksheet.js').then(u => u.unlockSheet(window.__game.menu, 'emblem', 'ev-sniperrb'))")
    await pg.wait_for_timeout(500)
    us = await pg.evaluate("({ txt: document.querySelector('.menu-overlay, .overlay, #ui')?.innerText ?? '', play: !!document.querySelector('[data-act=\"ulPlay\"]') })")
    check("the reward's unlock sheet says how, and offers Play now", 'Snipers Only Rebound' in us['txt'] and 'on now' in us['txt'] and us['play'], us['play'])
    await shot(pg, 'unlock-event')
    await tap(pg, '[data-act="ulPlay"]', 700)
    st = await pg.evaluate("({ s: window.__game.menu.el.dataset.screen, on: document.querySelector('.mp-pl.on')?.dataset.id })")
    check('  Play now opens the event playlist', st['s'] == 'multiplayer' and st['on'] == 'wkevent', st)
    # Finishing the challenges pays the emblem, once.
    r = await pg.evaluate("""(() => { const P = window.__game.Progress, c = { 'played:br': 3, 'cat:Sniper': 10, head: 4, 'rb:top5': 1 };
      const a = P.applyEventMatch('sniperrb', c), b = P.applyEventMatch('sniperrb', c), wrong = P.applyEventMatch('gloves', c);
      return { fresh: a?.reward?.fresh, xp: a?.xp, again: b?.reward ?? null, wrong, owned: P.hasReward('emblem:ev-sniperrb'), done: P.weeklyEvent().done }; })()""")
    check('finishing every challenge pays the emblem once', r['fresh'] is True and r['again'] is None and r['wrong'] is None and r['owned'] and r['done'] == 4, r)
    await pg.evaluate("window.__game.menu.title({})")
    await pg.wait_for_timeout(300)
    plate = await pg.evaluate("document.querySelector('.tch-ev')?.className + ' ' + document.querySelector('.tch-ev')?.textContent.replace(/\\s+/g, ' ').trim()")
    check('  the plate line reads 4/4', '4/4' in plate and ' all' in plate, plate)
    await ctx.close()


async def season_two(browser):
    print('2026-12-28: Season 2 opens')
    ctx, pg = await page_on(browser, '2026-12-27', 20)
    await boot(pg)
    await pg.reload(); await pg.wait_for_timeout(1200)
    chip = await pg.evaluate("document.querySelector('.tsn-chip')?.textContent.replace(/\\s+/g, ' ').trim()")
    check('Dec 27: the chip says Season 1, last day', chip is not None and 'Season 1' in chip and 'Last day' in chip, chip)
    await pg.evaluate("window.__game.Progress.applySeasonMatch({ xp: 60000, counts: {}, career: { kills: 3, deaths: 1, won: true } })")
    for i in range(5):
        await pg.evaluate("window.__game.Progress.applySeasonMatch({ xp: 0, counts: {}, ranked: { outcome: 'win', perf: 0.5, lobby: 2500, rating: 0.6 } })")
    s1 = await pg.evaluate("({ placed: window.__game.Progress.ranked().placed, sr: window.__game.Progress.ranked().sr })")
    check('  placed in Season 1 Ranked', s1['placed'], s1)
    store = await pg.evaluate("JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))")
    await ctx.close()
    # The next morning, same phone (the same storage).
    ctx, pg = await page_on(browser, '2026-12-28', 9)
    await pg.goto(f'http://localhost:{PORT}/?debug=1&net=local')
    await pg.evaluate(f"(() => {{ const s = {store}; localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); }})()")
    await pg.reload(); await pg.wait_for_timeout(1400)
    ban = await pg.evaluate("document.querySelector('.ev-banner.sn')?.textContent.replace(/\\s+/g, ' ').trim() ?? null")
    check('the new season is announced on the title', ban is not None and 'Season 2: Signal Fire' in ban, ban)
    await shot(pg, 'title-s2')
    chip = await pg.evaluate("document.querySelector('.tsn-chip')?.textContent.replace(/\\s+/g, ' ').trim()")
    check('the Season chip: Season 2, 42 days left', chip is not None and 'Season 2' in chip and '42d left' in chip, chip)
    await tap(pg, '.tsn-chip', 900)
    sz = await pg.evaluate("({ s: window.__game.menu.el.dataset.screen, title: document.querySelector('.menu h1, .menu .hdr-title, header h2, header b')?.textContent, tiles: document.querySelectorAll('.sz-tile').length, txt: document.querySelector('.menu').innerText })")
    check('the Season screen: Signal Fire, 100 tiers', sz['s'] == 'season' and 'Signal Fire' in sz['txt'] and sz['tiles'] == 100, {k: sz[k] for k in ('s', 'tiles')})
    await shot(pg, 'season-s2')
    await tap(pg, '[data-act="szTab"][data-tab="weekly"], [data-tab="weekly"]', 600)
    wk = await pg.evaluate("({ weeks: document.querySelectorAll('.sz-weeks > *').length, open: window.__game.Progress.weekly().filter(w => w.open).length, ids: window.__game.Progress.weekly()[0].list.map(c => c.id) })")
    check('  six weekly sets, the first open, Season 2 ids', wk['weeks'] == 6 and wk['open'] == 1 and all(i.startswith('S2.w1.') for i in wk['ids']), wk)
    toast = await pg.evaluate("document.querySelector('.toast')?.textContent ?? ''")
    rk = await pg.evaluate("(() => { const r = window.__game.Progress.ranked(); return { placed: r.placed, pm: r.pm, k: r.k, base: r.base }; })()")
    check('Ranked: Season 2 placements again from 75% of the SR', rk['k'] == 'S2' and not rk['placed'] and rk['pm'] == 0 and rk['base'] == int(s1['sr'] * 0.75), rk)
    owned = await pg.evaluate("window.__game.Progress.hasReward('card:s1-card-01') && window.__game.Progress.season().tier === 0")
    check('  Season 1 rewards kept, the new track at tier 0', owned)
    await pg.evaluate("window.__game.menu.title({})")
    await tap(pg, '[data-act="multiplayer"]', 700)
    rkcard = await pg.evaluate("document.querySelector('.mp-pl.rk')?.textContent.replace(/\\s+/g, ' ').trim()")
    check('  the Ranked playlist says Placements 0/5', rkcard is not None and 'Placements 0/5' in rkcard, rkcard)
    # What's new: the next update's sheet mentions both.
    await pg.evaluate("localStorage.removeItem('switchyard.seenBuild')")
    await pg.reload(); await pg.wait_for_timeout(1400)
    wn = await pg.evaluate("document.querySelector('.whats-new')?.innerText ?? ''")
    check("What's new lists this update (weekly events, Season 2)", 'event' in wn.lower() and 'Season 2' in wn, wn[:160].replace('\n', ' '))
    await ctx.close()

    print('2027-01-05: Lights Out and the weekly event')
    ctx, pg = await page_on(browser, '2027-01-05')
    await boot(pg)
    await pg.reload(); await pg.wait_for_timeout(1200)
    await pg.evaluate("window.__game.menu.overlay('')")
    await tap(pg, '[data-act="multiplayer"]', 700)
    spot = await pg.evaluate("[...document.querySelectorAll('.mp-sec-spot .mp-pl')].map(b => [b.dataset.id, b.querySelector('b')?.textContent])")
    ids = [s[0] for s in spot]
    check('the Spotlight: weekly event, Lights Out, Ranked, featured', ids == ['wkevent', 'event', 'ranked', 'featured'] and spot[1][1] == 'Lights Out', spot)
    await shot(pg, 'mp-s2-events')
    await ctx.close()

    print('2027-02-10: Season Replay')
    ctx, pg = await page_on(browser, '2027-02-10')
    await boot(pg)
    await pg.reload(); await pg.wait_for_timeout(1200)
    await pg.evaluate("window.__game.menu.overlay('')")
    chip = await pg.evaluate("document.querySelector('.tsn-chip')?.textContent.replace(/\\s+/g, ' ').trim()")
    check('the chip says Replay', chip is not None and 'Replay' in chip, chip)
    await tap(pg, '.tsn-chip', 900)
    txt = await pg.evaluate("document.querySelector('.menu').innerText")
    check('the Season screen: Season Replay: Cold Iron, 100 tiers', 'Season Replay: Cold Iron'.lower() in txt.lower() and await pg.evaluate("document.querySelectorAll('.sz-tile').length") == 100)
    await shot(pg, 'season-replay')
    await ctx.close()


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            await week_of_snipers(browser)
            await season_two(browser)
            await browser.close()
    finally:
        srv.terminate()
    real = [e for e in errors if 'WebGL' not in e and 'GPU' not in e]
    check('no console errors', not real, real[:5])
    print(f'\n{len(failures)} failed' if failures else '\nall ok')
    sys.exit(1 if failures else 0)


asyncio.run(main())
