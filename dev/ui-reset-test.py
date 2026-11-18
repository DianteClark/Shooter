#!/usr/bin/env python3
"""The progress reset (docs/RESET.md, ROADMAP item 41), in a real page.

Run from anywhere: python3 dev/ui-reset-test.py [port]. It serves the repo itself (python3 -m http.server <port>) and:
  Seeds a phone as a pre-reset build left it: a rich save (prestige, name, records), the gun stats tracker, match
  history, friends' cards, challenges, new-unlock dots, operator picks, bot match and training picks, event and What's
  new marks, the last room, the device id, an unknown future key, plus options (with remembered menu picks), the
  quality governor, the GPU and the tuning panel, and another app's key.
  Loads the new build: every progress key is gone (the save reads as new: level 1, no name, no XP), options and the
  other device settings are kept exactly (the remembered menu picks emptied), another app's key untouched.
  The notice shows once on the title, with the exact words; Got it goes on to the training offer.
  The save screen refuses a code from before the reset with "This code is from before the reset"; a code made now
  imports and round-trips byte for byte.
  Reload: no second wipe, no second notice, the new progress stays.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8347))
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
failures, errors = [], []
NOTICE = 'Fresh start: all progress has been reset for everyone. Your settings were kept.'


def check(name, ok, info=''):
    print(f'  {name:<64} {"ok" if ok else "FAIL"} {info if not ok or info else ""}')
    if not ok: failures.append(f'{name}: {info}')


# Runs on a plain page of the same origin (no game loaded, so no wipe yet): writes what an old build left behind and
# returns an old-format code for the same save.
SEED = """(async () => {
  const P = await import('/js/shared/progression.js');
  const s = P.blankSave();
  Object.assign(s, { name: 'OldTimer', prestige: 3, peakLevel: 50, xp: 20000, totalXp: 3 * P.PLAYER_CURVE.cap + 20000 });
  s.weapons = { ...s.weapons, ar: { ...(s.weapons?.ar ?? {}), xp: 40000, kills: 900 } };
  s.life = { played: 300, kills: 4200, wins: 160 };
  s.records = { st: 14, lk: 61 };
  const fnv = str => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
  const body = P.encodeSave(P.sanitizeSave(s)).split('.')[1];
  const oldCode = `SY4.${body}.${fnv(body)}`;
  localStorage.clear();
  const put = (k, v) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  put('switchyard.save', P.sanitizeSave(s));
  put('switchyard.progress.v1', { xp: 5000 });
  put('switchyard.save.bak', P.sanitizeSave(s));
  put('switchyard.save.bad', '{oops');
  put('switchyard.gunstats', { v: 3, list: [{ b: '1113-5', m: 'tdm', g: { ar: { k: 20 } } }] });
  put('switchyard.history', { v: 1, list: [{ at: 1, mode: 'tdm', map: 'pier', k: 20, d: 5 }] });
  put('switchyard.friends', { v: 1, list: [{ id: 'Pfriend1', at: 1, card: { v: 1, name: 'Pal', level: 40, prestige: 2, xp: 9e5, k: 5000, m: 300 } }] });
  put('switchyard.challenges', { daily: { key: 'x', list: [] } });
  put('switchyard-seen', 'abcdefghij');
  put('switchyard.custom.v1', { skins: { anvil: 'skin:anvil-field' } });
  put('switchyard-mods', ['hardcore']);
  put('switchyard-botmatch', { skill: 'elite', modes: { tdm: { bots: 3 } } });
  put('switchyard-training', { map: 'pier', bots: 8 });
  put('switchyard.eventSeen', 'E2026-11-16');
  put('switchyard.seasonSeen', 'S1');
  put('switchyard.seenBuild', '1113-5');
  put('switchyard-last-room', { code: 'ABCD', at: Date.now() });
  put('switchyard-player', 'Pold00000000');
  put('switchyard-backdrop', '7');
  put('switchyard.tournament.cup', { round: 3 });
  put('switchyard-options', { sound: 0.3, music: 0.2, quality: 'low', hudSize: 'large', lefty: true, haptics: true, fullscreen: false,
    padMap: { fire: 3 }, colorMode: 'deutan', textSize: 'large', squad: 'YARD', recall: { mpTab: 'core', soloPick: { mapId: 'pier' } } });
  put('switchyard-quality', { step: 'medium', at: 1 });
  put('switchyard-gpu', 'ANGLE (SwiftShader)');
  put('switchyard.tuning.v1', { camZoom: 1.1 });
  put('switchyard.tuner.ui.v1', { dock: 'left' });
  put('other-app', 'keep me');
  return oldCode;
})()"""

DUMP = "JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))"

PROGRESS_KEYS = ['switchyard.save.bak', 'switchyard.save.bad', 'switchyard.progress.v1', 'switchyard.gunstats', 'switchyard.history',
                 'switchyard.friends', 'switchyard-seen', 'switchyard.custom.v1', 'switchyard-mods', 'switchyard-botmatch',
                 'switchyard-training', 'switchyard-last-room', 'switchyard-player', 'switchyard-backdrop', 'switchyard.tournament.cup']
KEPT = ['switchyard-quality', 'switchyard.tuning.v1', 'switchyard.tuner.ui.v1', 'other-app']


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
            pg.on('response', lambda r: errors.append(f'404 {r.url}') if r.status == 404 else None)
            base = f'http://localhost:{PORT}'

            print('Seed (a phone as the old build left it)')
            await pg.goto(f'{base}/manifest.webmanifest')
            old_code = await pg.evaluate(SEED)
            before = json.loads(await pg.evaluate(DUMP))
            check('seeded a rich save, stats, friends and options', len(before) >= 26 and 'switchyard.save' in before, len(before))

            print('Load the new build')
            await pg.goto(f'{base}/?debug=1&net=local')
            await pg.wait_for_timeout(1500)
            after = json.loads(await pg.evaluate(DUMP))
            wipe = await pg.evaluate("window.__game.wipe")
            check('the wipe ran and reported what it took', len(wipe['wiped']) >= 20 and wipe['notice'], len(wipe['wiped']))
            missing = [k for k in before if k.startswith('switchyard') and k not in KEPT and k not in ('switchyard-options', 'switchyard-gpu') and k not in wipe['wiped']]
            check('every seeded progress key was wiped', not missing, missing)
            # The dots and the title backdrop write fresh state at start; nothing comes back as it was.
            back = [k for k in PROGRESS_KEYS if k in after and after[k] == before[k]]
            check('none of them came back', not back, back)
            prog = await pg.evaluate("""(() => { const P = window.__game.Progress; return { name: P.name, xp: P.totalXp, level: P.level, prestige: P.prestige, kills: P.records().streak ?? 0 }; })()""")
            check('the save reads as new: no name, level 1, no XP, no records', prog == {'name': '', 'xp': 0, 'level': 1, 'prestige': 0, 'kills': 0}, prog)
            if 'switchyard.save' in after:
                s = json.loads(after['switchyard.save'])
                check('a stored save, if any, is a blank one', s.get('name', '') == '' and s.get('totalXp', 0) == 0, s.get('name'))
            check('the generation is stored', after.get('switchyard.resetGen') == '1', after.get('switchyard.resetGen'))
            opts = json.loads(after.get('switchyard-options', '{}'))
            want = {'sound': 0.3, 'music': 0.2, 'quality': 'low', 'hudSize': 'large', 'lefty': True, 'haptics': True, 'fullscreen': False,
                    'padMap': {'fire': 3}, 'colorMode': 'deutan', 'textSize': 'large', 'squad': 'YARD'}
            check('options kept exactly', all(opts.get(k) == v for k, v in want.items()), {k: opts.get(k) for k in want})
            live = await pg.evaluate("(() => { const O = window.__game.Options; return { sound: O.get('sound'), quality: O.get('quality'), lefty: O.get('lefty'), recall: O.get('recall') }; })()")
            check('and live in the game', live == {'sound': 0.3, 'quality': 'low', 'lefty': True, 'recall': {}}, live)
            check('remembered menu picks emptied', opts.get('recall') == {}, opts.get('recall'))
            check('the GPU name is kept (the governor rewrites it as it detects)', bool(after.get('switchyard-gpu')))
            check('graphics governor, tuning panel and another app\'s key kept', all(after.get(k) == before[k] for k in KEPT),
                  [k for k in KEPT if after.get(k) != before[k]])
            friends = await pg.evaluate("(async () => (await import('./js/ui/progress.js')).Friends.list().length)()")
            history = await pg.evaluate("(async () => (await import('./js/ui/progress.js')).MatchHistory.list().length)()")
            stats = await pg.evaluate("(async () => (await import('./js/game/telemetry.js')).GunStats.totals().matches)()")
            check('friends, match history and gun stats are empty', friends == 0 and history == 0 and stats == 0, (friends, history, stats))

            print('The notice')
            text = await pg.evaluate("document.querySelector('.reset-notice')?.textContent ?? ''")
            check('the notice is on the title', NOTICE in text, text[:120])
            check('What\'s new stays quiet (the notice speaks instead)', await pg.evaluate("!document.querySelector('.whats-new:not(.reset-notice)')"))
            check('it is marked seen as it shows', after.get('switchyard.resetNotice') is None or not await pg.evaluate("localStorage.getItem('switchyard.resetNotice')"))
            await pg.locator('[data-act="rnClose"]').first.tap()
            await pg.wait_for_timeout(500)
            check('Got it leads on to the training offer', await pg.evaluate("!!document.querySelector('.tut-offer')"))
            await pg.locator('[data-act="tutSkip"]').first.tap()
            await pg.wait_for_timeout(400)

            print('Save codes')
            await pg.evaluate("window.__game.menu.saveCode({ onBack: () => {}, onImported: () => { window.__imported = true; } })")
            await pg.wait_for_timeout(500)
            await pg.locator('.sv-input').fill(old_code)
            await pg.locator('[data-act="svLoad"]').first.tap()
            await pg.wait_for_timeout(400)
            await pg.locator('[data-act="cfYes"]').first.tap()
            await pg.wait_for_timeout(400)
            err = await pg.evaluate("document.querySelector('.sv-err')?.textContent ?? ''")
            check('an old code is refused: "This code is from before the reset"', 'This code is from before the reset' in err, err)
            check('and nothing was loaded', await pg.evaluate("window.__game.Progress.totalXp === 0 && !window.__imported"))
            new_code = await pg.evaluate("""(async () => {
              const P = await import('./js/shared/progression.js');
              const s = P.blankSave(); Object.assign(s, { name: 'Fresh', xp: 9000, totalXp: 9000 });
              return P.encodeSave(P.sanitizeSave(s)); })()""")
            check('a code made now carries the generation', new_code.startswith('SY4R1.'), new_code[:8])
            await pg.locator('.sv-input').fill(new_code)
            await pg.locator('[data-act="svLoad"]').first.tap()
            await pg.wait_for_timeout(400)
            await pg.locator('[data-act="cfYes"]').first.tap()
            await pg.wait_for_timeout(500)
            got = await pg.evaluate("(() => { const P = window.__game.Progress; return { ok: !!window.__imported, name: P.name, xp: P.totalXp, code: P.exportCode() }; })()")
            check('it imports', got['ok'] and got['name'] == 'Fresh' and got['xp'] == 9000, {k: got[k] for k in ('ok', 'name', 'xp')})
            check('and round-trips byte for byte', got['code'] == new_code)
            check('the dressed-up old code (new header, old checksum) is refused too',
                  await pg.evaluate(f"window.__game.Progress.importCode({json.dumps('SY4R1.' + old_code[4:])}).ok === false"))

            print('Reload')
            await pg.reload()
            await pg.wait_for_timeout(1500)
            wipe2 = await pg.evaluate("window.__game.wipe")
            check('no second wipe', wipe2['wiped'] == [] and not wipe2['notice'], wipe2)
            check('no second notice', await pg.evaluate("!document.querySelector('.reset-notice')"))
            kept = await pg.evaluate("(() => { const P = window.__game.Progress; return [P.name, P.totalXp]; })()")
            check('the new progress stays', kept == ['Fresh', 9000], kept)
            check('options still kept', await pg.evaluate("window.__game.Options.get('sound') === 0.3 && window.__game.Options.get('quality') === 'low'"))

            print('A brand-new phone')
            ctx2 = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            pg2 = await ctx2.new_page()
            await pg2.goto(f'{base}/?debug=1&net=local')
            await pg2.wait_for_timeout(1500)
            check('nothing to lose: no notice, the usual training offer', await pg2.evaluate("!document.querySelector('.reset-notice') && !!document.querySelector('.tut-offer')"))
            check('and the generation is stored', await pg2.evaluate("localStorage.getItem('switchyard.resetGen') === '1'"))
            await browser.close()
    finally:
        srv.terminate()
    real = [e for e in errors if 'favicon' not in e and 'Failed to load resource' not in e and 'WebGL' not in e and 'GPU stall' not in e]
    check('no page errors', not real, real[:3])
    print(f'\n{len(failures)} FAILED' if failures else '\nall ok')
    for f in failures: print('  ' + f)
    sys.exit(1 if failures else 0)


asyncio.run(main())
