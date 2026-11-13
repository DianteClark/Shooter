#!/usr/bin/env python3
"""Play-through sweep (ROADMAP item 37): every mode solo in a real browser, driven by a fake controller.

  python3 dev/ui-sweep-play.py [port] [outdir] [filter...]

Each case opens a fresh page (fresh save), starts the mode the way a player does (the Multiplayer screen's playlist and
Find match, or the Custom button with the ?map=&mode= hook for single modes and maps, or Training / Firing range /
Tutorial), plays PLAY_S seconds with input (left stick wanders, right stick aims, RT fires in bursts, A interacts, X
reloads, LB/RB throw now and then, d-pad left calls a streak), then lets the match end on its own or forces it (the
sim's _end, or the crew falls in Graveyard Shift), and checks: the results screen, XP paid (not in Training, the range
or the tutorial), the save written, a match history entry, and no console errors. Screenshots of the HUD mid-match
and the results go to outdir (default /tmp/sweep-play). Filters pick cases whose name contains any of them.
Sizes alternate: Multiplayer cases at 932x430, single-mode cases at 667x375 (SWEEP_SIZE=WxH forces one).
"""
import asyncio, subprocess, sys, time, os, json, random, re
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8391
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/sweep-play'
FILTERS = sys.argv[3:]
PLAY_S = float(os.environ.get('PLAY_S', 60))
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
G = 'window.__game.app'

FAKE_PAD = """(() => {
  const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true,
    mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad; window.__padOn = false;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__padOn ? pad : null, null, null, null] });
  window.__setBtn = (i, on) => { const b = pad.buttons[i]; b.pressed = on; b.touched = on; b.value = on ? 1 : 0; pad.timestamp = performance.now(); };
  window.__setAxes = (a) => { for (let i = 0; i < 4; i++) if (a[i] !== undefined && a[i] !== null) pad.axes[i] = a[i]; pad.timestamp = performance.now(); };
  window.__connect = on => { window.__padOn = on; const e = new Event(on ? 'gamepadconnected' : 'gamepaddisconnected'); e.gamepad = pad; window.dispatchEvent(e); };
})()"""
A, B, X, Y, LB, RB, LT, RT, SELECT, START, L3, R3, UP, DOWN, LEFT, RIGHT = range(16)

STANDARD = ['tdm', 'dom', 'kc', 'hard', 'hq', 'snd', 'ctf', 'ffa', 'ko', 'ctl', 'grind', 'gun', 'inf', 'oic', 'gf']
GW = ['gwtdm', 'gwdom', 'gwhq', 'gwko', 'gwinf']
# (name, kind, arg): kind mp = (tab, playlist); custom = (map, mode); special = training/range/tutorial
CASES = [('mp-' + pl, 'mp', (tab, pl)) for tab, pls in [
    ('standard', ['ranked', 'qp', 'obj', 'party', 'showdown', 'featured']),
    ('groundwar', ['gwqp', 'gwparty']),
    ('br', ['quads', 'duos', 'solos', 'rbquads', 'rbduos']),
    ('extraction', ['exquads', 'exduos']),
    ('zombies', ['zmsolo'])] for pl in pls]
CASES += [('custom-' + m, 'custom', ('random', m)) for m in STANDARD + GW]
CASES += [('custom-zm-' + mp, 'custom', (mp, 'zm')) for mp in ['neon', 'ruins', 'foundry', 'ashgrove']]
CASES += [('special-' + s, 'special', s) for s in ['training', 'range', 'tutorial']]

STATE = f"""(() => {{ const a = {G}, m = a.match; return {{ screen: window.__game.menu.el.dataset.screen, inMatch: !!a.inMatch,
  phase: m?.interp?.newest?.phase ?? null, mode: m?.mode ?? null, mapId: m?.mapId ?? null }}; }})()"""

SAVE = """(() => { const P = window.__game.Progress; let hist = 0;
  try { hist = JSON.parse(localStorage.getItem('switchyard-history') || '[]').length; } catch (e) {}
  return { xp: P.totalXp, raw: (localStorage.getItem('switchyard.save') || '').length, keys: Object.keys(localStorage) }; })()"""

SET_CHALLENGES = """import('/js/shared/progression.js').then(P => { const now = new Date(), set = (period, ids) => ({ key: P.periodKey(period, now), ids, prog: {}, done: [], retired: [] });
  localStorage.setItem('switchyard.challenges', JSON.stringify({ v: P.CHALLENGE_VERSION, daily: set('daily', ['d.played', 'd.kills', 'd.assist']),
    weekly: set('weekly', ['w.played', 'w.kills', 'w.assist']), reroll: '' })); })"""

# Each daily/weekly challenge row on the results, with what the stored challenge state says.
CHAL_ROWS = """import('/js/ui/progress.js').then(m => { const all = [...m.Challenges.list('daily'), ...m.Challenges.list('weekly')];
  return [...document.querySelectorAll('.rs-ch')].filter(b => b.querySelector('.rs-ch-h')?.textContent.trim() === 'Challenges')
    .flatMap(b => [...b.querySelectorAll('.rs-ch-row')]).map(r => { const label = r.querySelector('b').textContent, c = all.find(x => x.label === label);
      return { label, txt: r.querySelector('small').textContent.trim(), value: c?.value ?? null, goal: c?.goal ?? null, done: r.classList.contains('done') }; }); })"""

OVERFLOW = """(() => {
  const W = innerWidth, H = innerHeight, bad = [];
  const root = document.getElementById('ui');
  for (const n of root.querySelectorAll('.hud *, .controls > *')) {
    if (n.closest('[hidden]') || n.offsetParent === null) continue;
    const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.position === 'fixed' && false) continue;
    const r = n.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
    if (r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2) bad.push(`${n.className || n.tagName} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
  }
  return bad.slice(0, 8);
})()"""


async def run_case(browser, name, kind, arg, size, report):
    vw, vh = size
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    await ctx.add_init_script(FAKE_PAD)
    pg = await ctx.new_page()
    errors, fails, notes = [], [], []
    pg.on('console', lambda m: errors.append(m.text[:300]) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e} {getattr(e, "stack", "")[:500]}'))
    tag = f'{name}@{vw}x{vh}'
    shot = lambda n: pg.screenshot(path=f'{OUT}/{name}-{n}-{vw}x{vh}.png')
    ev = pg.evaluate
    q = '?debug=1&vote=2&search=500'
    if kind == 'custom': q += f'&map={arg[0]}&mode={arg[1]}'
    t0 = time.time()
    try:
        await pg.goto(f'http://localhost:{PORT}/{q}')
        await pg.wait_for_function('!!window.__game?.Progress', timeout=30000)
        await ev("window.__game.Progress.name='Sweeper'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
        # Today's challenges include "Play N matches", so every case has challenge rows to check against the save.
        await ev(SET_CHALLENGES)
        await pg.reload()
        await pg.wait_for_function('!!window.__game?.Progress', timeout=30000)
        await pg.wait_for_timeout(1200)
        before = await ev(SAVE)
        if kind == 'mp':
            tab, pl = arg
            await pg.locator('[data-act="multiplayer"]').first.click()
            await pg.wait_for_timeout(500)
            await pg.locator(f'[data-act="mpTab"][data-tab="{tab}"]').first.click()
            await pg.wait_for_timeout(400)
            await pg.locator(f'[data-act="mpPlaylist"][data-id="{pl}"]').first.click()
            await pg.wait_for_timeout(300)
            await pg.locator('[data-act="mpFind"]').first.click()
        elif kind == 'custom':
            await pg.locator('[data-act="custom"]').first.click()
        else:
            await ev(f"window.__game.{arg}()")
            if arg == 'training':
                await pg.wait_for_timeout(800)
                st = await ev(STATE)
                if not st['inMatch']:
                    # The Training tab of Custom: its Start button.
                    btn = pg.locator('[data-act="trainStart"], [data-act="training"]').first
                    if await btn.count(): await btn.click()
        await pg.wait_for_function(f'{G}.inMatch && !!{G}.match', timeout=60000)
        st = await ev(STATE)
        notes.append(f"{st['mode']} on {st['mapId']}")
        await pg.wait_for_function(f"['live', 'prematch', 'round'].includes({G}.match?.interp?.newest?.phase) || {G}.match?.interp?.newest?.phase === 'live'", timeout=60000)
        # BR / Rebound / Extraction start in the plane or a deploy: let the bots do it, and jump the local player out.
        await ev("window.__connect(true)")
        rnd = random.Random(hash(name) & 0xffff)
        start = time.time()
        shots_at = {PLAY_S * 0.35: 'hud', PLAY_S * 0.75: 'hud2'}
        taken = set()
        while time.time() - start < PLAY_S:
            st = await ev(STATE)
            if not st['inMatch'] or st['phase'] == 'ended': break
            ang = rnd.random() * 6.283
            import math
            await ev(f"window.__setAxes([{math.cos(ang) * 0.9:.2f}, {math.sin(ang) * 0.9:.2f}, {math.cos(ang + 1) :.2f}, {math.sin(ang + 1):.2f}])")
            r = rnd.random()
            btn = RT if r < 0.55 else A if r < 0.68 else X if r < 0.76 else LB if r < 0.8 else RB if r < 0.84 else LEFT if r < 0.9 else Y if r < 0.95 else R3
            await ev(f"window.__setBtn({btn}, true)")
            await pg.wait_for_timeout(450 if btn == RT else 120)
            await ev(f"window.__setBtn({btn}, false)")
            await pg.wait_for_timeout(250)
            # A death screen or a panel: B backs out of panels, A respawns.
            el = time.time() - start
            for at, n in shots_at.items():
                if el >= at and n not in taken:
                    taken.add(n)
                    await shot(n)
                    bad = await ev(OVERFLOW)
                    if bad: notes.append(f'off-screen at {n}: {bad}')
        await ev("window.__setAxes([0,0,0,0]); window.__connect(false)")
        played = round(time.time() - start)
        st = await ev(STATE)
        if kind == 'special':
            # Training, the range and the tutorial end by leaving.
            await ev("window.__game.hud.leaveCb()")
            await pg.wait_for_timeout(1500)
            st = await ev(STATE)
            if st['inMatch']: fails.append('still in the match after Leave')
        else:
            if st['inMatch'] and st['phase'] != 'ended':
                notes.append(f'forced end after {played}s')
                await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId);
                  if (m.mode === 'zm') {{ for (const p of sim.players) if (p.team === 0 && p.alive) {{ p.spawnProtect = 0; p.downed = false; sim._selfKill(p, 'bleed'); }} }}
                  else if (sim.br || /^(ex|rb|br)/.test(m.mode)) sim._end(me ? me.team : 0); else sim._end(sim.scores[0] === sim.scores[1] ? null : sim.scores[0] > sim.scores[1] ? 0 : 1); }})()""")
            else:
                notes.append(f'ended on its own after {played}s')
            try:
                await pg.wait_for_selector('.menu[data-screen="results"] .rs', timeout=120000)
            except Exception:
                fails.append(f'no results screen (screen {await ev("window.__game.menu.el.dataset.screen")})')
            await pg.wait_for_timeout(3500)
            await shot('results')
            word = await ev("document.querySelector('.rs-word h2')?.textContent ?? null")
            xp = await ev("[...document.querySelectorAll('.xp-row')].map(n => n.textContent.replace(/\\s+/g, ' ').trim())")
            notes.append(f'results: {word}; xp rows {len(xp)}')
            after = await ev(SAVE)
            if after['xp'] <= before['xp']: fails.append(f"no XP paid ({before['xp']} -> {after['xp']})")
            # The results screen's numbers are the save's: the XP lines add up to what the save gained, and every
            # challenge row says what the stored challenge says (docs/UNLOCKS-AUDIT-2026-11-12.md).
            shown = sum(int(re.sub(r'[^0-9]', '', r.rsplit('+', 1)[-1]) or 0) for r in xp)
            if xp and shown != after['xp'] - before['xp']: fails.append(f"XP lines add to {shown}, the save gained {after['xp'] - before['xp']}")
            if xp: notes.append(f'xp {shown}')
            rows = await ev(CHAL_ROWS)
            for r in rows:
                if r['value'] is None: fails.append(f"challenge row {r['label']!r} is not a current challenge")
                elif r['done'] and r['value'] != r['goal']: fails.append(f"challenge {r['label']!r} shown done, saved {r['value']}/{r['goal']}")
                elif not r['done'] and r['txt'] != f"{r['value']}/{r['goal']}": fails.append(f"challenge {r['label']!r} shows {r['txt']}, saved {r['value']}/{r['goal']}")
            if rows: notes.append(f'challenges {len(rows)} rows match the save')
            hist = await ev("import('/js/ui/progress.js').then(m => m.MatchHistory.list().length)")
            if hist < 1: fails.append('no match history entry')
            # Back to the menu from the results.
            btn = pg.locator('[data-act="resMenu"]').first
            if await btn.count():
                await btn.click()
                await pg.wait_for_timeout(1200)
                scr = await ev("window.__game.menu.el.dataset.screen")
                notes.append(f'after results: {scr}')
                # The save survives a reload.
                await pg.reload()
                await pg.wait_for_function('!!window.__game?.Progress', timeout=30000)
                xp2 = await ev("window.__game.Progress.totalXp")
                if xp2 != after['xp']: fails.append(f"XP after reload {xp2} != {after['xp']}")
    except Exception as e:
        fails.append(f'exception: {str(e)[:300]}')
        try: await shot('fail')
        except Exception: pass
    errs = [e for e in errors if 'favicon' not in e]
    if errs: fails.append(f'console errors: {errs[:6]}')
    line = f"{'FAIL' if fails else 'ok  '} {tag} {round(time.time() - t0)}s | {'; '.join(notes)}" + (f" | {' / '.join(fails)}" if fails else '')
    print(line, flush=True)
    report.append({'case': tag, 'ok': not fails, 'notes': notes, 'fails': fails})
    await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    report = []
    force = os.environ.get('SWEEP_SIZE')
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for name, kind, arg in CASES:
                if FILTERS and not any(f in name for f in FILTERS): continue
                size = tuple(map(int, force.split('x'))) if force else (932, 430) if kind == 'mp' else (667, 375)
                await run_case(browser, name, kind, arg, size, report)
            await browser.close()
    finally:
        srv.terminate()
    with open(f'{OUT}/report.json', 'w') as f: json.dump(report, f, indent=1)
    bad = [r for r in report if not r['ok']]
    print(f'{len(report) - len(bad)}/{len(report)} cases clean')
    sys.exit(1 if bad else 0)


asyncio.run(main())
