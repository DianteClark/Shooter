#!/usr/bin/env python3
"""Fresh start end to end (bug sweep 2026-11-18): python3 dev/ui-sweep-fresh.py [port] [outdir]

Serves the repo itself. Phone A (852x393, touch) is seeded as a pre-reset build left it (dev/ui-reset-test.py's SEED:
a prestige-3 save, history, friends, a clan, a saved clip, options), then loads the current build and goes the way a
returning player does:
  wipe       every progress key gone, options kept, the notice once (exact words); Got it, then the training offer
             (Not now); Custom > Millbrook > TDM asks for a callsign on the keypad first
  match      three kills and a death by the sim's own damage path, then the match ends; results pay XP; Watch replay,
             Save clip, Close
  progress   level and XP up from zero, life tallies (1 played, 3 kills), the gun stats tracker has a record for this
             match's mode (per-mode gun stats), History lists the one match and its detail opens (3 kills, 1 death),
             History > Clips lists the clip; Profile > Clan founds [FRSH]
  code       the Save code screen shows Progress.exportCode() (an SY4R1 code)
Phone B (a second context, its own storage, brand new: no notice) imports the code through the Save code screen (paste,
Load, Replace): name, XP, level, prestige, life tallies, weapon XP and the tournament/event blocks match phone A's;
the clan is per phone (not in a code, docs: js/shared/clans.js), so B joins it with A's clan code on the keypad.
Then two tabs on phone B make a friend room (?net=local): after the lobby both tabs hold the other's career card
(with the reset generation `rg`), and Boards > Friends lists the friend.
Any console or page error fails it. Screenshots in outdir.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8395
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/sweep-fresh'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
G = 'window.__game'
import ast
SEED = next(n.value.value for n in ast.parse(open(os.path.join(ROOT, 'dev', 'ui-reset-test.py')).read()).body
            if isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') == 'SEED')     # The reset test's old phone.
NOTICE = 'Fresh start: all progress has been reset for everyone. Your settings were kept.'
fails, errors = [], []


def check(name, ok, info=''):
    print(f'  {name:<66} {"ok" if ok else "FAIL"} {info if (not ok or info) else ""}', flush=True)
    if not ok: fails.append(f'{name}: {info}')


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
PROG = """(() => { const P = window.__game.Progress, s = JSON.parse(localStorage.getItem('switchyard.save') || '{}');
  return { name: P.name, xp: P.totalXp, level: P.level, prestige: P.prestige, life: s.life ?? null, weapons: Object.fromEntries(Object.entries(s.weapons ?? {}).map(([k, w]) => [k, w.xp ?? 0])),
    tn: s.tn ?? null, season: s.season ?? null }; })()"""


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    base = f'http://localhost:{PORT}'
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)

            async def phone():
                ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
                return ctx

            def watch(pg, tag):
                pg.on('console', lambda m: errors.append(f'{tag}: {m.text} {m.location}') if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errors.append(f'{tag}: PAGEERR {e}'))
                pg.on('response', lambda r: errors.append(f'{tag}: 404 {r.url}') if r.status == 404 else None)

            async def tap(pg, sel, wait=400, timeout=45000):
                # The results' Unlocked summary (an overlay after the reel, with its own Menu and Rematch) covers the
                # results screen: Continue closes it first.
                if 'ux' not in sel: await pg.evaluate("document.querySelector('.overlay.show [data-act=\"uxDone\"]')?.click()")
                try:
                    await pg.locator(sel).first.click(timeout=timeout)
                except Exception:
                    # What covers it: the element at the target's centre, and the screen.
                    over = await pg.evaluate(f"""(() => {{ const el = document.querySelector({json.dumps(sel)}); if (!el) return 'none';
                      const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                      return [r.x, r.y, r.width, r.height, top?.className ?? null, top?.outerHTML?.slice(0, 200) ?? null, innerWidth, innerHeight]; }})()""")
                    print('   tap failed', sel, over, flush=True)
                    await pg.screenshot(path=f'{OUT}/tap-failed.png')
                    raise
                await pg.wait_for_timeout(wait)

            async def type_keys(pg, text, done=True):
                for ch in text:
                    await tap(pg, f'[data-act="kpKey"][data-k="{ch}"]', 120)
                if done: await tap(pg, '[data-act="kpDone"]', 500)

            screen = lambda pg: pg.evaluate("window.__game.menu.el.dataset.screen")

            # ---------------- Phone A ----------------
            print('Phone A: an old rich save, then the new build')
            ctx_a = await phone()
            a = await ctx_a.new_page()
            watch(a, 'A')
            await a.goto(f'{base}/manifest.webmanifest')
            await a.evaluate(SEED)
            n_old = await a.evaluate("Object.keys(localStorage).length")
            check('seeded', n_old >= 26, n_old)
            await a.goto(f'{base}/?debug=1&net=local&bots=easy&time=120')
            await a.wait_for_function(f'!!{G}?.Progress', timeout=30000)
            await a.wait_for_timeout(1500)
            wipe = await a.evaluate(f'{G}.wipe')
            check('wipe ran with the notice', wipe['notice'] and len(wipe['wiped']) >= 20, len(wipe['wiped']))
            prog = await a.evaluate(PROG)
            check('progress reads new', prog['name'] == '' and prog['xp'] == 0 and prog['level'] == 1 and prog['prestige'] == 0, prog)
            check('options kept', await a.evaluate(f"{G}.Options.get('sound') === 0.3 && {G}.Options.get('lefty') === true"))
            clips0 = await a.evaluate(f'{G}.clips.listClips()')
            check('the old saved clip is gone', clips0 == [], clips0)
            txt = await a.evaluate("document.body.innerText")
            check('the notice is on the title with its words', NOTICE in txt)
            await a.screenshot(path=f'{OUT}/a-notice.png')
            await tap(a, '[data-act="rnClose"]', 700)
            offer = await a.locator('[data-act="tutSkip"]').count()
            check('Got it goes on to the training offer', offer == 1, offer)
            if offer: await tap(a, '[data-act="tutSkip"]', 500)

            print('Phone A: first match (Custom, Millbrook, TDM)')
            await tap(a, '[data-act="custom"]', 700)
            check('the callsign keypad comes first', await screen(a) == 'keypad', await screen(a))
            await a.screenshot(path=f'{OUT}/a-callsign.png')
            await type_keys(a, 'FRESHY')
            await tap(a, '[data-act="soloMap"][data-id="millbrook"]', 300)
            await tap(a, '[data-act="soloMode"][data-id="tdm"]', 300)
            await tap(a, '[data-act="soloStart"]', 600)
            await a.wait_for_function(f'{G}.app.inMatch && {G}.app.match?.sim?.phase === "live"', timeout=90000)
            check('the match started with the new callsign', await a.evaluate(f"{G}.Progress.name") == 'FRESHY')
            await a.evaluate(f"{G}.app.renderer?.setQuality?.('potato')")
            await a.wait_for_timeout(4000)
            try:
                await a.wait_for_function(f"Object.values({G}.app.match.telemetry.scopes?.a || {{}}).some(r => r[2] > 0)", timeout=45000)
            except Exception:
                check('the bots fired (gun stats need a shot)', False)
            for _ in range(3):
                await a.evaluate(f'({KILL})(1)')
                await a.wait_for_timeout(700)
            check('killed once', await a.evaluate(f'({DIE})()'))
            await a.wait_for_timeout(5000)
            await a.screenshot(path=f'{OUT}/a-match.png')
            await a.evaluate(END)
            await a.wait_for_selector('.menu[data-screen="results"] .rs', timeout=120000)
            await a.wait_for_timeout(3500)
            await a.screenshot(path=f'{OUT}/a-results.png')
            check('results offer Watch replay', await a.locator('[data-act="resReplay"]').count() >= 1)
            await tap(a, '[data-act="resReplay"]', 2500)
            await a.locator('.rp-save').click()
            await a.wait_for_function("document.querySelector('.rp-save')?.textContent === 'Saved'", timeout=15000)
            await a.screenshot(path=f'{OUT}/a-replay.png')
            await a.locator('.rp-close').click()
            await a.wait_for_timeout(500)
            await tap(a, '[data-act="resMenu"]', 1200)

            print('Phone A: progress after one match')
            prog_a = await a.evaluate(PROG)
            check('XP and level up from zero', prog_a['xp'] > 0 and prog_a['level'] >= 1, (prog_a['xp'], prog_a['level']))
            life = prog_a['life'] or {}
            check('life tallies: 1 played, 3 kills', life.get('played') == 1 and life.get('kills') == 3, life)
            gs = await a.evaluate("JSON.parse(localStorage.getItem('switchyard.gunstats') || 'null')")
            recs = (gs or {}).get('recent', [])
            check('gun stats: one record, this match, in its mode group (per-mode stats)', len(recs) == 1 and recs[0].get('mode') == 'tdm' and recs[0].get('map') == 'millbrook' and recs[0].get('mg'), [(r.get('mode'), r.get('map'), r.get('mg')) for r in recs])
            grp = await a.evaluate("import('/js/game/telemetry.js').then(m => { const t = m.GunStats.totals(); return { matches: t.matches, groups: Object.keys(t.byGroup ?? {}) }; })")
            check('and the totals count it, by group', grp['matches'] == 1 and len(grp['groups']) >= 1, grp)
            await tap(a, '[data-act="history"]', 800)
            rows = await a.locator('.hs-body .hs-row').count()
            check('History lists the one match', rows == 1, rows)
            await tap(a, '.hs-body .hs-row[data-i="0"]', 800)
            st = await a.evaluate("({ screen: window.__game.menu.el.dataset.screen, kills: document.querySelectorAll('.hm-kill').length, deaths: document.querySelectorAll('.hm-death').length, meta: document.querySelector('.hm-meta')?.textContent ?? '' })")
            check('its detail: 3 kills, 1 death, on Millbrook', st['screen'] == 'historyMatch' and st['kills'] == 3 and st['deaths'] == 1 and 'Millbrook' in st['meta'], st)
            await a.screenshot(path=f'{OUT}/a-history-detail.png')
            await tap(a, '[data-act="hmBack"]', 600)
            await tap(a, '[data-act="hsTab"][data-tab="clips"], [data-tab="clips"]', 800)
            n_clips = await a.locator('[data-act="hcWatch"]').count()
            check('History > Clips lists the saved clip', n_clips == 1, n_clips)
            await a.screenshot(path=f'{OUT}/a-clips.png')
            await tap(a, '[data-act="hsBack"]', 700)

            await tap(a, '[data-act="profile"]', 800)
            await tap(a, '[data-act="pfClan"]', 600)
            await tap(a, '[data-act="clFound"]')
            await tap(a, '[data-act="clTag"]')
            await type_keys(a, 'FRSH')
            await tap(a, '[data-act="clName"]')
            await type_keys(a, 'FRESH-START')
            await tap(a, '[data-act="clSave"]', 600)
            clan_a = json.loads(await a.evaluate("import('/js/ui/progress.js').then(m => JSON.stringify(m.Clan.get()))"))
            check('clan [FRSH] founded', clan_a and clan_a['tag'] == 'FRSH' and clan_a.get('own'), clan_a)
            clan_code = await a.evaluate("document.querySelector('.cl-codebtn b')?.textContent ?? ''")
            await a.screenshot(path=f'{OUT}/a-clan.png')
            await tap(a, '[data-act="clBack"]', 500)
            await tap(a, '[data-act="pfSave"]', 700)
            shown = await a.evaluate("document.querySelector('.sv-code')?.value ?? ''")
            code = await a.evaluate(f'{G}.Progress.exportCode()')
            check('Save code screen shows the export (SY4R1)', shown == code and code.startswith('SY4R1.'), code[:12])
            prog_a = await a.evaluate(PROG)

            # ---------------- Phone B ----------------
            print('Phone B: brand new, imports the code')
            ctx_b = await phone()
            b = await ctx_b.new_page()
            watch(b, 'B')
            await b.goto(f'{base}/?debug=1&net=local&vote=5')
            await b.wait_for_function(f'!!{G}?.Progress', timeout=30000)
            await b.wait_for_timeout(1200)
            wipe_b = await b.evaluate(f'{G}.wipe')
            check('a brand-new phone sees no notice', not wipe_b['notice'] and NOTICE not in await b.evaluate("document.body.innerText"), wipe_b)
            if await b.locator('[data-act="tutSkip"]').count(): await tap(b, '[data-act="tutSkip"]', 500)
            await tap(b, '[data-act="saveCode"]', 700)
            await b.locator('.sv-input').fill(code)
            await tap(b, '[data-act="svLoad"]', 500)
            await tap(b, '[data-act="cfYes"]', 1200)
            prog_b = await b.evaluate(PROG)
            same = {k: (prog_a[k], prog_b[k]) for k in prog_a if prog_a[k] != prog_b[k]}
            check('B matches A: name, XP, level, prestige, life, weapon XP, tournament and season blocks', not same, same)
            await b.reload()
            await b.wait_for_function(f'!!{G}?.Progress', timeout=30000)
            await b.wait_for_timeout(1000)
            prog_b2 = await b.evaluate(PROG)
            check('and it survives a reload', prog_b2 == prog_b, {k: (prog_b[k], prog_b2[k]) for k in prog_b if prog_b[k] != prog_b2[k]})
            check('no notice after an import either', NOTICE not in await b.evaluate("document.body.innerText"))
            await tap(b, '[data-act="profile"]', 800)
            await tap(b, '[data-act="pfClan"]', 600)
            await tap(b, '[data-act="clCode"]')
            await type_keys(b, clan_code.replace('-', ''))
            clan_b = json.loads(await b.evaluate("import('/js/ui/progress.js').then(m => JSON.stringify(m.Clan.get()))"))
            check('B joins [FRSH] with the clan code', clan_b and clan_b['id'] == clan_a['id'] and not clan_b.get('own'), clan_b)
            await tap(b, '[data-act="clBack"]', 600)
            await tap(b, '[data-act="pfBack"]', 800, timeout=20000)

            print('Phone B: a friend room in two tabs')
            await tap(b, '[data-act="host"]', 300)
            await b.wait_for_function(f'{G}.app.code', timeout=30000)
            room = await b.evaluate(f'{G}.app.code')
            b2 = await ctx_b.new_page()
            watch(b2, 'B2')
            await b2.goto(f'{base}/?debug=1&net=local&vote=5')
            await b2.wait_for_function(f'!!{G}?.Progress', timeout=30000)
            await b2.wait_for_timeout(800)
            # The second tab is a friend: its own name (in memory; the host's tab keeps its own).
            await b2.evaluate(f"{G}.Progress.name = 'PALLY'")
            pages = [b, b2]

            async def juggle():
                while True:
                    for pg in pages:
                        try: await pg.bring_to_front()
                        except Exception: pass
                        await asyncio.sleep(0.12)
            juggler = asyncio.create_task(juggle())
            await b2.evaluate(f"window.__game.join('{room}')")
            await b.wait_for_function(f'{G}.app.lobby.humans.length === 2', timeout=60000)
            got = None
            for _ in range(40):
                fa = await b.evaluate(f"import('/js/ui/progress.js').then(m => m.Friends.list({G}.app.net?.localId).map(f => ({{ id: f.id, name: f.card.name, rg: f.card.rg, level: f.card.level }})))")
                fb = await b2.evaluate(f"import('/js/ui/progress.js').then(m => m.Friends.list({G}.app.net?.localId).map(f => ({{ id: f.id, name: f.card.name, rg: f.card.rg, level: f.card.level }})))")
                if any(f['name'] == 'PALLY' for f in fa) and any(f['name'] == 'FRESHY' for f in fb):
                    got = (fa, fb); break
                await asyncio.sleep(0.5)
            check("each tab keeps the other's career card after the reset", got is not None, got or (fa, fb))
            if got:
                check('the cards carry the reset generation', all(f.get('rg') == 1 for f in got[0] + got[1]), got)
            await b.screenshot(path=f'{OUT}/b-lobby.png')
            juggler.cancel()
            await b2.close()
            await b.evaluate(f"import('/js/ui/boards.js').then(m => m.boardsScreen(window.__game.menu, {{ onBack: () => {{}}, myId: {G}.app.net?.localId ?? 'me', view: 'friends', cat: 'kills' }}))")
            await b.wait_for_timeout(800)
            listed = await b.evaluate("document.querySelector('.bd-body')?.textContent ?? ''")
            check('Boards > Friends lists the friend', 'PALLY' in listed, listed[:120])
            await b.screenshot(path=f'{OUT}/b-friends.png')
            await browser.close()
    finally:
        srv.terminate()
    errs = [e for e in errors if 'favicon' not in e]
    for e in errs: print('ERROR', e)
    print('FAILED' if fails or errs else 'all ok')
    sys.exit(1 if fails or errs else 0)


asyncio.run(main())
