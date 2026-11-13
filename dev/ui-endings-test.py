#!/usr/bin/env python3
"""End of match, every mode (docs/MODES.md "End of match"): python3 dev/ui-endings-test.py [port] [filter...]

Starts a solo match of each mode in a real browser (the Custom button with the ?map=&mode= hook, or Training), forces
an ending on the host (a win, a loss, a draw, a placement, an Extraction wipe or time-out, a Graveyard Shift overrun,
a ranked placement), and checks the end banner and the results header against the table: the headline word, the line
under it, and the score shown by the headline (a pair, one number with its label, or none). Then checks the rows no
forced ending reaches (extracted, escaped, left behind, Showdown 6-4, Rebound, an SR move, training) on matchHeader
itself in the page. Fails on any console error.
"""
import asyncio, subprocess, sys, time, os, re, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8473
FILTERS = [a for a in sys.argv[1:] if not a.isdigit()]
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
G = 'window.__game.app'

# How each case ends. `me` is the local player, `sim` the host's sim, `R` its rules.
WIN = "sim.scores[me.team] = 7; sim.scores[1 - me.team] = 3; sim._end(me.team);"
LOSS = "sim.scores[me.team] = 2; sim.scores[1 - me.team] = 5; sim._end(1 - me.team);"
DRAW = "sim.scores[0] = 4; sim.scores[1] = 4; sim._end(null);"
ROUNDS_WIN = "sim.scores[me.team] = 4; sim.scores[1 - me.team] = 2; sim._end(me.team);"
# Free-for-all: someone else on top, the local player second.
FFA_2ND = """const o = sim.players.find(p => p.team !== me.team && !p.dummy); for (const p of sim.players) sim.scores[p.team] = 0;
  sim.scores[o.team] = 9; sim.scores[me.team] = 6; for (const p of sim.players) if (p !== o && p !== me) sim.scores[p.team] = 1; sim._end(o.team);"""
FFA_1ST = """for (const p of sim.players) sim.scores[p.team] = 1; sim.scores[me.team] = 9; sim._end(me.team);"""
BR_LOSS = "const o = sim.players.find(p => p.team !== me.team); sim._end(o.team);"
INF_ALL = "for (const p of sim.players) p.team = 1; sim.scores[0] = 0; sim.scores[1] = sim.players.length; sim._end(1);"
EX_WIPE = """const s = R.squads.get(me.team); s.lives = 0; s.done = true; s.wiped = true; R._dirty();
  await new Promise(r => setTimeout(r, 800)); sim._end(null);"""
EX_TIME = "R.t = R.t > 0 ? Math.max(R.t, 899.5) : 899.5;"
ZM_OVERRUN = "for (const p of sim.players) if (p.team === 0 && p.alive) { p.spawnProtect = 0; p.downed = false; sim._selfKill(p, 'bleed'); }"
RANKED = "m.awards.ranked = { lobby: null, rating: 0.3 }; " + WIN

PAIR = lambda a, b: ('pair', f'{a}-{b}')
# (name, launch, ending, word (exact or regex), line regex, score: ('pair', 'a-b') | ('pair', None) | ('one', label regex) | ('none',))
CASES = [
    ('tdm win', ('random', 'tdm'), WIN, 'Victory', r'^The yard is yours$', PAIR(7, 3)),
    ('kc loss', ('random', 'kc'), LOSS, 'Defeat', r'^The yard is lost$', PAIR(2, 5)),
    ('dom draw', ('random', 'dom'), DRAW, 'Draw', r'^Neither side broke through$', PAIR(4, 4)),
    ('hard win', ('random', 'hard'), WIN, 'Victory', r'^The yard is yours$', PAIR(7, 3)),
    ('hq loss', ('random', 'hq'), LOSS, 'Defeat', r'^The yard is lost$', PAIR(2, 5)),
    ('ko win', ('random', 'ko'), WIN, 'Victory', r'^The yard is yours$', PAIR(7, 3)),
    ('grind win', ('random', 'grind'), WIN, 'Victory', r'^The yard is yours$', PAIR(7, 3)),
    ('gwtdm win', ('random', 'gwtdm'), WIN, 'Victory', r'^The yard is yours$', PAIR(7, 3)),
    ('snd win', ('random', 'snd'), ROUNDS_WIN, 'Victory', r'^Won 4 rounds to 2$', PAIR(4, 2)),
    ('ctl win', ('random', 'ctl'), ROUNDS_WIN, 'Victory', r'^Won 4 rounds to 2$', PAIR(4, 2)),
    ('gf loss', ('random', 'gf'), LOSS, 'Defeat', r'^Lost 2 rounds to 5$', PAIR(2, 5)),
    ('ctf win', ('random', 'ctf'), WIN, 'Victory', r'^Won 7 captures to 3$', PAIR(7, 3)),
    ('inf all infected', ('random', 'inf'), INF_ALL, 'Victory', r'^Everyone was infected$', ('one', r'^Survivors$')),
    ('ffa 2nd', ('random', 'ffa'), FFA_2ND, '2nd place', r'^One short of the top$', PAIR(6, 9)),
    ('gun 1st', ('random', 'gun'), FFA_1ST, '1st place', r'^Through every gun to the Verdict$', ('pair', None)),
    ('oic 2nd', ('random', 'oic'), FFA_2ND, '2nd place', r'^One short of the top$', PAIR(6, 9)),
    ('br placed', ('random', 'br'), BR_LOSS, r'^\d+(st|nd|rd|th) place$', r'^#\d+ of \d+ squads$', ('one', r'^of \d+ squads$')),
    ('brsolo placed', ('random', 'brsolo'), BR_LOSS, r'^\d+(st|nd|rd|th) place$', r'^#\d+ of \d+ players$', ('one', r'^of \d+ players$')),
    ('rb placed', ('random', 'rb'), BR_LOSS, r'^\d+(st|nd|rd|th) place$', r'^#\d+ of \d+ squads$', ('one', r'^of \d+ squads$')),
    ('exq wiped', ('random', 'exq'), EX_WIPE, 'Squad wiped', r'^.*(lost: nobody got out|Out of lives before anyone got out)$', ('none',)),
    ('exd out of time', ('random', 'exd'), EX_TIME, 'Out of time', r'^.*(lost: nobody got out|Nobody in the squad got out)$', ('none',)),
    ('zm overrun', ('neon', 'zm'), ZM_OVERRUN, 'Overrun', r'^Survived \d+ rounds?', ('one', r'^Round$')),
    ('ranked tdm win', ('random', 'tdm'), RANKED, 'Victory', r'^The yard is yours · Placement 1/\d+$', PAIR(7, 3)),
    ('training', 'training', WIN, 'Training over', r'^Practice: no XP, no record$', ('none',)),
]

# Rows no forced ending above reaches, on matchHeader itself.
UNITS = """(async () => {
  const { matchHeader } = await import('/js/ui/outcome.js');
  const r = (d) => { const h = matchHeader(d); return [h.word, h.line, h.score.kind, h.score.kind === 'pair' ? `${h.score.mine}-${h.score.them}` : h.score.kind === 'one' ? `${h.score.label} ${h.score.value}` : '']; };
  const roster = [{ id: 'me', team: 0, kills: 0, deaths: 0, place: 3 }, { id: 'b', team: 1, kills: 0, deaths: 0, place: 1 }, { id: 'c', team: 2, kills: 0, deaths: 0, place: 2 }, { id: 'd', team: 3, kills: 0, deaths: 0, place: 4 }];
  return {
    extracted: r({ modeId: 'exq', outcome: 'win', myTeam: 0, scores: [0, 0], roster, ex: { extracted: true, banked: [{ type: 'hvt', tier: 1 }, { type: 'intel', tier: 2 }], lost: [], lives: 3 } }),
    exLeft: r({ modeId: 'exq', outcome: 'loss', myTeam: 0, scores: [0, 0], roster, early: true, ex: { extracted: false, banked: [], lost: [], lives: 4 }, exView: { squads: [{ team: 0, lives: 4, pot: [] }] } }),
    zmEscaped: r({ modeId: 'zm', outcome: 'win', myTeam: 0, scores: [18, 0], roster, zm: { escaped: 18, survived: 18 }, zmView: { round: 18, escaped: ['me'] } }),
    zmLeft: r({ modeId: 'zm', outcome: 'loss', myTeam: 0, scores: [12, 0], roster, zm: { escaped: 0, survived: 11 }, zmView: { round: 12, escaped: ['b'] } }),
    showdown: r({ modeId: 'gf', outcome: 'win', myTeam: 0, scores: [6, 4], roster }),
    rebound: r({ modeId: 'rb', outcome: 'loss', myTeam: 0, scores: [0, 0, 0, 0], roster, localId: 'me' }),
    reboundWin: r({ modeId: 'rbduo', outcome: 'win', myTeam: 0, scores: [0, 0, 0, 0], roster, localId: 'me' }),
    sr: r({ modeId: 'dom', outcome: 'loss', myTeam: 0, scores: [150, 200], roster, ranked: { before: { sr: 1500 }, after: { sr: 1482 }, delta: -18 } }),
    infHeld: r({ modeId: 'inf', outcome: 'win', myTeam: 0, scores: [2, 10], roster }),
    early: r({ modeId: 'tdm', outcome: 'loss', myTeam: 0, scores: [10, 12], roster, early: true }),
  };
})()"""
UNIT_WANT = {
    'extracted': ['Extracted', '2 contracts banked · 2,550 XP', 'none', ''],
    'exLeft': ['Left the match', 'Nobody in the squad got out', 'none', ''],
    'zmEscaped': ['Escaped', 'Escaped on round 18', 'one', 'Round 18'],
    'zmLeft': ['Left behind', 'Survived 11 rounds', 'one', 'Round 12'],
    'showdown': ['Victory', 'Won 6 rounds to 4', 'pair', '6-4'],
    'rebound': ['3rd place', '#3 of 4 squads', 'one', 'of 4 squads #3'],
    'reboundWin': ['Victory', 'Last squad standing', 'one', 'of 4 squads #1'],
    'sr': ['Defeat', 'The yard is lost · -18 SR', 'pair', '150-200'],
    'infHeld': ['Victory', 'You held out to the end', 'one', 'Survivors 2'],
    'early': ['Defeat', 'You left before the end', 'pair', '10-12'],
}

HEADER = """(() => { const top = document.querySelector('.rs-top'); const sc = top?.querySelector('.rs-score');
  return { word: document.querySelector('.rs-word h2')?.textContent ?? null, line: window.__heroLine ?? null,
    kind: sc ? sc.dataset.kind : 'none', label: sc?.querySelector('small')?.textContent ?? '',
    score: sc ? [...sc.querySelectorAll('u')].map(u => u.textContent.trim()).join('-') : '' }; })()"""


def match(want, got):
    return got is not None and (re.search(want, got) if want.startswith('^') else want == got)


async def run_case(browser, case, report):
    name, launch, ending, word, line, score = case
    ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    errors, fails = [], []
    pg.on('console', lambda m: errors.append(m.text[:300]) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
    ev = pg.evaluate
    t0 = time.time()
    try:
        q = '?debug=1' + (f'&map={launch[0]}&mode={launch[1]}' if isinstance(launch, tuple) else '')
        await pg.goto(f'http://localhost:{PORT}/{q}')
        await pg.wait_for_function('!!window.__game?.Progress', timeout=30000)
        await ev("window.__game.Progress.name='Ender'; window.__game.Progress.setFlag('tutorialOffered'); window.__game.Progress.setFlag('aimHint')")
        await pg.reload()
        await pg.wait_for_function('!!window.__game?.Progress', timeout=30000)
        await pg.wait_for_timeout(800)
        if launch == 'training':
            await ev("window.__game.training()")
            await pg.wait_for_timeout(800)
            if not await ev(f'{G}.inMatch'):
                btn = pg.locator('[data-act="trainStart"], [data-act="training"]').first
                if await btn.count(): await btn.click()
        else:
            await pg.locator('[data-act="custom"]').first.click()
        await pg.wait_for_function(f'{G}.inMatch && !!{G}.match?.sim', timeout=60000)
        await pg.wait_for_function(f"{G}.match.sim.phase === 'live'", timeout=60000)
        await pg.wait_for_timeout(1200)
        # The hero line is gone once the tables slide in: keep it as it is drawn.
        await ev("""new MutationObserver(() => { const h = document.querySelector('.rs-hero > small'); if (h) window.__heroLine = h.textContent; })
          .observe(document.body, { childList: true, subtree: true })""")
        await ev(f"""(async () => {{ const m = {G}.match, sim = m.sim, R = sim.rules, me = sim.byId.get(m.localId); {ending} }})()""")
        await pg.wait_for_function("document.querySelector('.endbanner.show') || document.querySelector('.menu[data-screen=\"results\"] .rs')", timeout=60000)
        banner = await ev("(() => { const e = document.querySelector('.endbanner'); return e?.classList.contains('show') ? [e.querySelector('b').textContent, e.querySelector('small').textContent] : null; })()")
        await pg.wait_for_selector('.menu[data-screen="results"] .rs.in', timeout=90000)
        await pg.wait_for_timeout(1500)
        h = await ev(HEADER)
        if not match(word, h['word']): fails.append(f"word {h['word']!r} want {word!r}")
        if not match(line, h['line']): fails.append(f"line {h['line']!r} want {line!r}")
        if h['kind'] != score[0]: fails.append(f"score kind {h['kind']} ({h['score']!r}) want {score[0]}")
        elif score[0] == 'pair' and score[1] and h['score'] != score[1]: fails.append(f"score {h['score']!r} want {score[1]!r}")
        elif score[0] == 'one' and not re.search(score[1], h['label']): fails.append(f"score label {h['label']!r} want {score[1]!r}")
        # The banner says what the header says (S&D's adds how the last round went; the SR move is only known after).
        if banner is None: fails.append('no end banner')
        elif not match(word, banner[0]): fails.append(f'banner word {banner[0]!r} want {word!r}')
        elif name.split()[0] not in ('snd', 'ranked') and not match(line, banner[1]): fails.append(f'banner line {banner[1]!r} want {line!r}')
        note = f"{h['word']} | {h['line']} | {h['kind']} {h['label']} {h['score']}"
    except Exception as e:
        fails.append(f'exception: {str(e)[:300]}')
        note = ''
    errs = [e for e in errors if 'favicon' not in e]
    if errs: fails.append(f'console errors: {errs[:4]}')
    print(f"{'FAIL' if fails else 'ok  '} {name:<18} {round(time.time() - t0):>3}s  {note}" + (f"  | {' / '.join(fails)}" if fails else ''), flush=True)
    report.append(not fails)
    await ctx.close()


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    report = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=ARGS)
            if not FILTERS or 'units' in FILTERS:
                ctx = await browser.new_context()
                pg = await ctx.new_page()
                await pg.goto(f'http://localhost:{PORT}/?debug=1')
                await pg.wait_for_function('!!window.__game?.Progress', timeout=30000)
                got = await pg.evaluate(UNITS)
                for k, want in UNIT_WANT.items():
                    ok = got.get(k) == want
                    print(f"{'ok  ' if ok else 'FAIL'} unit {k:<13} {got.get(k)}" + ('' if ok else f'  want {want}'))
                    report.append(ok)
                await ctx.close()
            for case in CASES:
                if FILTERS and not any(f in case[0] for f in FILTERS): continue
                await run_case(browser, case, report)
            await browser.close()
    finally:
        srv.terminate()
    print(f'{sum(report)}/{len(report)} ok')
    sys.exit(0 if all(report) else 1)


asyncio.run(main())
