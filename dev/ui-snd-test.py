#!/usr/bin/env python3
"""Search and Destroy HUD, spectating and results, plus tap/auto respawn, in a real solo match.
Run: python3 dev/ui-snd-test.py [port] [snd] [respawn]  (both parts by default; serves the repo on its own port).
Stages each state through the host sim (window.__game with ?debug=1), checks the HUD, and saves screenshots to
/tmp/snd-shots. The results round strip relies on results.snd, which the test injects the way match.js/main.js pass it.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8471))
ARGS=['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']
OUT = '/tmp/snd-shots'
os.makedirs(OUT, exist_ok=True)
errors=[]; fails=[]
def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond: fails.append(what)

G = "const g = window.__game, m = g.app.match, sim = m.sim, me = sim.byId.get(m.localId);"
async def ev(pg, js): return await pg.evaluate(f"(async () => {{ {G} {js} }})()")

async def boot(pg, query, opts=''):
    await pg.goto(f'http://localhost:{PORT}/?debug=1')
    await pg.wait_for_timeout(700)
    await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    if opts: await pg.evaluate(opts)
    await pg.goto(f'http://localhost:{PORT}/?debug=1&{query}')
    await pg.wait_for_timeout(1200)
    await pg.click('[data-act="custom"]')
    for _ in range(80):
        if await pg.evaluate("!!window.__game.app.match?.sim"): break
        await pg.wait_for_timeout(100)
    await pg.wait_for_timeout(400)

async def simwait(pg, secs, cap=60):
    t0 = await ev(pg, "return sim.time;")
    for _ in range(cap * 10):
        await pg.wait_for_timeout(100)
        if await ev(pg, "return window.__game.app.match ? m.sim.time : 1e9;") >= t0 + secs: return

async def shot(pg, name):
    await pg.screenshot(path=f'{OUT}/{name}.png')

STOP_BOTS = "for (const p of sim.players) if (p.isBot) { p.bot = null; p.ps.vx = 0; p.ps.vz = 0; }"

async def snd_run(pg):
    await boot(pg, 'map=railyard&mode=snd&bots=recruit')
    await pg.wait_for_timeout(1300)
    await shot(pg, '01_intro_freeze')
    # Live, everyone held still so the stage is ours.
    await ev(pg, "sim.phaseT = 0.05;")
    await pg.wait_for_timeout(500)
    await ev(pg, STOP_BOTS + "sim.snd._give(me, true); me.spawnProtect = 0;")
    await pg.wait_for_timeout(900)
    await shot(pg, '02_live_carrier')
    check(await pg.is_visible('.snd-carry'), 'carrier plate shows for the local carrier')
    check(await pg.is_visible('.snd-alive'), 'alive strip shows')
    await ev(pg, "const s = sim.snd.sites[0]; m.ps.x = s.x; m.ps.z = s.z + 0.5; m.ps.vx = 0; m.ps.vz = 0;")
    await simwait(pg, 2.0)
    await shot(pg, '03_planting')
    check(await pg.is_visible('.snd-ring'), 'plant ring shows while planting')
    check('Planting A' in (await pg.inner_text('.snd-ring b')), 'ring says Planting A')
    await simwait(pg, 2.4)
    st = await ev(pg, "return sim.snd.bomb.state;")
    check(st == 'planted', f'bomb planted ({st})')
    await ev(pg, "m.ps.x -= 7; m.ps.z += 3;")
    await pg.wait_for_timeout(800)
    await shot(pg, '04_planted')
    check('urgent' in (await pg.get_attribute('.sb-time b', 'class') or ''), 'bomb timer replaces the clock')
    # Out for the round: spectate.
    await ev(pg, "const foe = sim.players.find(p => p.team !== me.team); me.spawnProtect = 0; sim._damage(me, foe, 999, 'ar', 5);")
    await simwait(pg, 3.5)
    await pg.wait_for_timeout(300)
    await shot(pg, '05_spectating')
    check(await pg.is_visible('.snd-spec'), 'spectate plate shows when out')
    first = await pg.inner_text('.ss-name')
    watched = await ev(pg, "return g.app.renderer.watching;")
    check(watched is not None, f'renderer follows a teammate ({watched})')
    await pg.tap('.snd-spec')
    await pg.wait_for_timeout(700)
    second = await pg.inner_text('.ss-name')
    check(first != second, f'tap switches who is watched ({first} -> {second})')
    watched2 = await ev(pg, "return g.app.renderer.watching;")
    check(watched2 != watched, 'camera follows the new pick')
    await shot(pg, '06_spectate_switched')
    check(not await pg.is_visible('.death-go'), 'no Respawn button in S&D')
    # The bomb goes off.
    await ev(pg, "sim.snd.bomb.fuse = 1.2;")
    await simwait(pg, 2.0)
    await pg.wait_for_timeout(300)
    await shot(pg, '07_round_won')
    check('Round won' in await pg.inner_text('.snd-big b'), 'round won banner')
    check('detonated' in await pg.inner_text('.sbg-sub'), 'reason: detonated')
    await simwait(pg, 4.0)
    await pg.wait_for_timeout(300)
    await shot(pg, '08_freeze_buy')
    check('Round 2' in await pg.inner_text('.sbg-kick'), 'round 2 freeze banner')
    check(await pg.is_visible('.dn-change'), 'buy-in loadout line in the freeze')
    await pg.tap('.dn-change')
    await pg.wait_for_timeout(500)
    await shot(pg, '09_buy_picker')
    await pg.tap('.pk-close')
    # Halftime.
    await ev(pg, "sim.snd.round = 3; sim.scores[0] = 2; sim.scores[1] = 1; sim.snd.startRound(); " + STOP_BOTS)
    await pg.wait_for_timeout(900)
    await shot(pg, '10_halftime')
    check('Halftime' in await pg.inner_text('.sbg-kick'), 'halftime banner')
    check('Defend' in await pg.inner_text('.snd-big b'), 'now defending')
    await ev(pg, "sim.scores[0] = 3; sim.scores[1] = 2; sim.snd.startRound(); " + STOP_BOTS)
    await pg.wait_for_timeout(900)
    await shot(pg, '11_match_point')
    check('Match point' in await pg.inner_text('.sbg-kick'), 'match point banner')
    # Live, a bot plants at B, the local defender defuses.
    await ev(pg, "sim.phaseT = 0.05;")
    await pg.wait_for_timeout(400)
    await ev(pg, STOP_BOTS + "const c = sim.snd.bomb.carrier, s = sim.snd.sites[1]; c.ps.x = s.x; c.ps.z = s.z; c.ps.vx = 0; c.ps.vz = 0;")
    await simwait(pg, 4.4)
    check(await ev(pg, "return sim.snd.bomb.state;") == 'planted', 'bot carrier planted at B')
    await ev(pg, "const b = sim.snd.bomb; for (const p of sim.players) if (p.team !== me.team) { p.ps.x = sim.map.width - 4; p.ps.z = 3 + p.index; } m.ps.x = b.x + 0.8; m.ps.z = b.z; m.ps.vx = 0; m.ps.vz = 0;")
    await simwait(pg, 2.2)
    await pg.wait_for_timeout(200)
    await shot(pg, '12_defusing')
    check('Defusing' in await pg.inner_text('.snd-ring b'), 'defuse ring for the local defuser')
    # Hand the final S&D state to the results the way the lead's match.js edit will (results.snd).
    await ev(pg, "const orig = m.onEnd; m.onEnd = r => { window.__snd = m.interp.newest.snd ?? null; orig({ ...r, snd: window.__snd }); }; const mr = g.menu.results.bind(g.menu); g.menu.results = (d, cb) => mr({ ...d, snd: window.__snd }, cb);")
    await simwait(pg, 4.2)
    await pg.wait_for_timeout(500)
    await shot(pg, '13_end')
    for _ in range(40):
        if await pg.evaluate("window.__game.menu.el.dataset.screen === 'results' && !!document.querySelector('.rs.in')"): break
        await pg.wait_for_timeout(500)
    await pg.wait_for_timeout(600)
    await shot(pg, '14_results')
    check(await pg.evaluate("window.__game.menu.el.dataset.screen") == 'results', 'results screen')
    heads = await pg.evaluate("[...document.querySelectorAll('.rb-head span')].map(e => e.textContent).join(',')")
    check('P/D' in heads, 'results show plants/defuses')
    check(await pg.evaluate("document.querySelectorAll('.rs-rounds i').length") == await pg.evaluate("window.__snd.history.length"), 'results round strip, one chip per round played')

async def respawn_run(pg, auto):
    opt = f"import('./js/ui/options.js').then(o => o.Options.set('autoRespawn', {'true' if auto else 'false'}))"
    await boot(pg, 'map=railyard&mode=tdm&bots=recruit', opt)
    await ev(pg, "sim.phaseT = 0.05;")
    await pg.wait_for_timeout(800)
    await ev(pg, STOP_BOTS + "const foe = sim.players.find(p => p.team !== me.team); me.spawnProtect = 0; sim._damage(me, foe, 999, 'ar', 5);")
    await simwait(pg, 0.6)
    await pg.wait_for_timeout(200)
    sub = await pg.inner_text('.dg-sub')
    tag = 'on' if auto else 'off'
    await shot(pg, f'20_respawn_{tag}')
    # The countdown starts once the killcam replay ends (or 0.8 s after death when there is none), so poll for each step.
    async def until(js, secs):
        for _ in range(int(secs * 5)):
            if await pg.evaluate(js): return True
            await pg.wait_for_timeout(200)
        return False
    alive = "(() => { const m = window.__game.app.match; return !!m.sim.byId.get(m.localId)?.alive; })()"
    if auto:
        check('Respawning in' in sub or 'After the replay' in sub, f'auto on: "{sub}"')
        check(await until(alive, 14), 'auto on: back on its own once the countdown ends')
    else:
        ready = "(() => { const t = document.querySelector('.dg-sub')?.textContent || ''; return t.includes('Tap now'); })()"
        check(await until(ready, 14), f'auto off: waits for the tap ("{await pg.inner_text(".dg-sub")}")')
        check(not await ev(pg, "return me.alive;"), 'auto off: still down until tapped')
        await pg.tap('.death-go')
        check(await until(alive, 3), 'auto off: tap respawns')

async def main():
    srv = subprocess.Popen(['python3','-m','http.server',str(PORT)],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(channel='chrome', args=ARGS)
            for run in ([snd_run] if 'snd' in sys.argv or len(sys.argv) < 2 or sys.argv[1:] == [str(PORT)] else []) + ([lambda pg: respawn_run(pg, False), lambda pg: respawn_run(pg, True)] if 'respawn' in sys.argv or len(sys.argv) < 2 or sys.argv[1:] == [str(PORT)] else []):
                ctx = await b.new_context(viewport={'width':844,'height':390}, has_touch=True, is_mobile=True)
                pg = await ctx.new_page()
                pg.on('console', lambda m: errors.append(m.text) if m.type=='error' else None)
                pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
                await run(pg)
                await ctx.close()
            await b.close()
    finally:
        srv.terminate()
    check(not errors, f'no console errors {errors[:5]}')
    print('FAILED' if fails else 'ALL OK', len(fails))
asyncio.run(main())
