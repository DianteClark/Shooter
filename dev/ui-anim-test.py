#!/usr/bin/env python3
"""The animation pass in a real match (ROADMAP item 62, docs/ANIMATION.md): python3 dev/ui-anim-test.py [port] [outdir]

Serve the repo first: python3 -m http.server <port>. Custom > Match on Railyard (TDM) with every bot held still; enemies
are stood in a row in front of you and killed by the host the ways the game kills: a rifle from the front, from behind,
from the side, a headshot, a melee kill, a shotgun at close range, a frag. Each body must fall the matching way (the
rig's death kind), keep its operator's look while it falls (drawn, not dismantled), lie, fade and be gone; the frag
must take its body apart (corpses). Then a bot reloads from empty and from a part mag (the rig picks the empty and
tactical tracks), swaps guns, and is hit (the flinch springs move). With reduced motion the falls settle without the
flight. Screenshots in outdir (default /tmp/anim-game). Fails on any console error.
"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9611
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/anim-game'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']

fails = []
def check(name, ok, info=''):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'' if ok else f' :: {info}'}", flush=True)
    if not ok: fails.append(name)

# Holds every bot still and stands the enemies in a row 4 m in front of the player, facing it. Returns their ids.
LINEUP = """(() => {
  const app = window.__game.app, sim = app.match.sim, me = app.match.ps;
  for (const p of sim.players) if (p.bot) { p.bot.update = () => []; p.finCool = 1e9; }
  const foes = sim.players.filter(p => p.team !== 0);
  const ax = Math.cos(me.aim), az = Math.sin(me.aim);
  window.__spots = foes.map((f, i) => { const s = (i - (foes.length - 1) / 2) * 1.6; return { id: f.id, x: me.x + ax * 4.5 - az * s, z: me.z + az * 4.5 + ax * s, aim: me.aim + Math.PI }; });
  clearInterval(window.__hold);
  window.__hold = setInterval(() => { for (const s of window.__spots) { const f = sim.players.find(p => p.id === s.id); if (!f || !f.alive) continue; f.ps.x = s.x; f.ps.z = s.z; f.ps.aim = s.aim; f.ps.vx = f.ps.vz = 0; f.spawnProtect = 0; } }, 30);
  return foes.map(f => f.id);
})()"""

# Stands the local player where foe `id`'s killing shot comes from (front / behind / side of its facing): the renderer
# reads the push from the killer's rig to the target. MOVE first, wait a frame or two, then KILL, then BACK.
MOVE = """(([id, how]) => {
  const app = window.__game.app, sim = app.match.sim, me = app.match.ps;
  const t = sim.players.find(p => p.id === id), s = window.__spots.find(q => q.id === id);
  const at = { front: s.aim, behind: s.aim + Math.PI, side: s.aim + Math.PI / 2 }[how.from] ?? s.aim;
  window.__home = window.__home || { x: me.x, z: me.z };
  me.x = t.ps.x + Math.cos(at) * 2.5; me.z = t.ps.z + Math.sin(at) * 2.5;
  const k = sim.players.find(p => p.id === app.match.localId); k.ps.x = me.x; k.ps.z = me.z;
})"""
KILL = """(([id, how]) => {
  const app = window.__game.app, sim = app.match.sim;
  const t = sim.players.find(p => p.id === id), killer = sim.players.find(p => p.id === app.match.localId);
  if (how.frag) sim._damage(t, killer, 999, 'frag', 3, null, false, 'frag');
  else sim._damage(t, killer, 999, how.w, 3, null, !!how.head);
  return t.alive;
})"""
BACK = """(() => { const app = window.__game.app, me = app.match.ps, h = window.__home; if (!h) return;
  me.x = h.x; me.z = h.z; const k = app.match.sim.players.find(p => p.id === app.match.localId); k.ps.x = h.x; k.ps.z = h.z; })()"""

RIG = """((id) => { const r = window.__game.app.match.renderer.chars.rigs.get(id); return r ? { dying: r.dying, kind: r.die.kind, t: r.die.t, settled: r.dieSettled, down: r.down, visible: r.visible, reveal: r.reveal } : null; })"""

KINDS = ['back', 'front', 'side', 'head', 'melee', 'blown', 'down', 'fin', 'explode']


async def main():
    os.makedirs(OUT, exist_ok=True)
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=ARGS)
        for reduce in (False, True):
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True, reduced_motion='reduce' if reduce else 'no-preference')
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
            ev = pg.evaluate
            tag = 'calm-' if reduce else ''
            async def tap(sel, wait=300):
                try: await pg.locator(sel).first.click(timeout=4000)
                except Exception: await pg.evaluate(f"document.querySelector({sel!r})?.click()")
                await pg.wait_for_timeout(wait)
            await pg.goto(f'http://localhost:{PORT}/?debug=1&vote=2&search=600', timeout=120000)
            await pg.wait_for_timeout(900)
            await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
            await pg.reload()
            await pg.wait_for_function('window.__game.backdrop.renderer && window.__game.backdrop.state === "live"', timeout=120000)
            await tap('[data-act="custom"]', 600)
            await tap('[data-act="soloMap"][data-id="railyard"]')
            await tap('[data-act="soloMode"][data-id="tdm"]')
            await tap('[data-act="soloStart"]', 300)
            await pg.wait_for_function('window.__game.app.inMatch && window.__game.app.match?.interp.newest?.phase === "live" && window.__game.app.match.localAlive', timeout=120000)
            await pg.wait_for_timeout(1500)
            print('reduced motion' if reduce else 'deaths')
            # The quality step's corpse budget also caps bodies falling at once (Potato: 3); lift it to see every kind.
            await ev("window.__game.app.match.renderer.chars.maxDying = 12")
            ids = await ev(LINEUP)
            await pg.wait_for_timeout(2500)
            ways = [('back', {'from': 'front', 'w': 'ar'}), ('front', {'from': 'behind', 'w': 'ar'}), ('side', {'from': 'side', 'w': 'smg'}),
                    ('head', {'from': 'front', 'w': 'dmr', 'head': True}), ('melee', {'from': 'side', 'w': 'knife'}),
                    ('blown', {'from': 'front', 'w': 'shotgun'}), ('explode', {'from': 'front', 'frag': True})]
            if reduce: ways = [w for w in ways if w[0] in ('blown', 'explode', 'back')]
            for i, (want, how) in enumerate(ways[:len(ids)]):
                await ev(MOVE, [ids[i], how])
                await pg.wait_for_timeout(120)
                alive = await ev(KILL, [ids[i], how])
                await pg.wait_for_timeout(80)
                await ev(BACK)
                check(f'{want}: the kill lands', alive is False)
            await pg.wait_for_timeout(250)
            await pg.screenshot(path=f'{OUT}/{tag}01-falling.png')
            states = [await ev(RIG, i) for i in ids[:len(ways)]]
            for (want, how), st in zip(ways, states):
                exp = want
                if reduce and want in ('blown', 'explode'): exp = 'back'
                if exp == 'explode':
                    check(f'{want}: blown apart, not posed', st and not st['dying'], st)
                else:
                    got = KINDS[st['kind']] if st and st['dying'] else None
                    check(f'{want}: falls as {exp}', got == exp, st)
            await pg.wait_for_timeout(500)
            await pg.screenshot(path=f'{OUT}/{tag}02-down.png')
            # The clock runs slower than the wall under a software renderer: wait for the falls' own time.
            try: await pg.wait_for_function(f"{json.dumps(ids[:len(ways)])}.every(id => {{ const r = window.__game.app.match.renderer.chars.rigs.get(id); return !r.dying || r.die.t > 1.3; }})", timeout=15000)
            except Exception: pass
            settled = [await ev(RIG, i) for i in ids[:len(ways)]]
            check('the bodies come to rest (limbs kept, not solved)', all(s['settled'] for s in settled if s and s['dying']), settled)
            try: await pg.wait_for_function(f"{json.dumps(ids[:len(ways)])}.every(id => !window.__game.app.match.renderer.chars.rigs.get(id).dying)", timeout=20000)
            except Exception: pass
            gone = [await ev(RIG, i) for i in ids[:len(ways)]]
            check('and fade away', not any(s and s['dying'] for s in gone), gone)
            await pg.screenshot(path=f'{OUT}/{tag}03-gone.png')

            if not reduce:
                print('reloads, swap, flinch')
                await pg.wait_for_function('window.__game.app.match.sim.players.filter(p => p.team !== 0 && p.alive).length >= 2', timeout=30000)
                await pg.wait_for_timeout(600)
                pair = await ev("""(() => { const sim = window.__game.app.match.sim; const f = sim.players.filter(p => p.team !== 0 && p.alive);
                  window.__spots = window.__spots.filter(s => f.some(q => q.id === s.id)); return f.slice(0, 2).map(p => p.id); })()""")
                await ev("""(([a, b]) => { const sim = window.__game.app.match.sim;
                  for (const [id, n] of [[a, 0], [b, 7]]) { const p = sim.players.find(q => q.id === id); p.ps.slot = 0; p.ps.weapon = p.ps.primary; p.ps.ammo[0] = n; p.ps.reloadT = 0; p.ps.swapT = 0; }
                })""", pair)
                # Start the reloads on the sim state directly (the bots are held still and press nothing).
                await ev("""(([a, b]) => { const sim = window.__game.app.match.sim;
                  for (const id of [a, b]) { const p = sim.players.find(q => q.id === id); if (p.ps.reloadT <= 0) { p.ps.reloadDur = 2.2; p.ps.reloadT = 2.2; } } })""", pair)
                await pg.wait_for_timeout(500)
                rel = await ev("""(([a, b]) => [a, b].map(id => { const r = window.__game.app.match.renderer.chars.rigs.get(id); return { empty: r.relEmpty, u: r.reloadU }; }))""", pair)
                check('a reload from empty plays the empty track', rel[0]['empty'] is True, rel)
                check('a reload with rounds left plays the tactical one', rel[1]['empty'] is False, rel)
                await pg.screenshot(path=f'{OUT}/04-reloads.png')
                await pg.wait_for_timeout(2200)
                # A pistol to swap to: a bot may carry a melee weapon second (1120), whose swap is over (a blade's in 0.12 s)
                # before the check below looks. The sim emits the swap event itself (_diffFx) when the weapon changes.
                sw = await ev("""((id) => { const sim = window.__game.app.match.sim, p = sim.players.find(q => q.id === id);
                  p.ps.secondary = p.ps.primary === 'pistol' ? 'revolver' : 'pistol';
                  p.ps.slot = 1 - p.ps.slot; p.ps.weapon = p.ps.slot ? p.ps.secondary : p.ps.primary; p.ps.swapT = 0.35; return p.ps.weapon; })""", pair[0])
                await pg.wait_for_timeout(120)
                s1 = await ev("""((id) => { const r = window.__game.app.match.renderer.chars.rigs.get(id); return { u: r.swapU, from: r.swapFrom, w: r.weapon }; })""", pair[0])
                check('a swap puts the old gun away and brings the new one up', 0 < s1['u'] < 1 and s1['from'] and s1['from'] != sw and s1['w'] == sw, s1)
                await pg.screenshot(path=f'{OUT}/05-swap.png')
                # Watch the rig's springs every frame for a moment after a headshot that does not kill.
                await ev("""((id) => { const app = window.__game.app, sim = app.match.sim, t = sim.players.find(q => q.id === id), me = sim.players.find(q => q.id === app.match.localId);
                  window.__fl = [0, 0, 0, 0, 0, 0, 0, 0, 0]; const r = app.match.renderer.chars.rigs.get(id);
                  const tick = () => { for (let k = 0; k < 9; k++) window.__fl[k] = Math.max(window.__fl[k], Math.abs(r.sx[k])); if (window.__flOn) requestAnimationFrame(tick); };
                  window.__flOn = true; requestAnimationFrame(tick);
                  t.spawnProtect = 0; t.hp = 1e6; sim._damage(t, me, 20, 'ar', 4, null, true); })""", pair[1])
                await pg.wait_for_timeout(500)
                fl = await ev("(() => { window.__flOn = false; return window.__fl.map(v => +v.toFixed(3)); })()")
                check('a hit moves the flinch springs (twist, head, gun)', abs(fl[6]) + abs(fl[7]) + abs(fl[8]) > 0.01, fl)
                await pg.screenshot(path=f'{OUT}/06-flinch.png')
            await ctx.close()
        await browser.close()
    real = [e for e in errors if 'GPU stall' not in e and 'favicon' not in e]
    check('no console errors', not real, real[:5])
    print('\nall passed' if not fails else f'\n{len(fails)} failed: {fails}')
    sys.exit(1 if fails else 0)

asyncio.run(main())
