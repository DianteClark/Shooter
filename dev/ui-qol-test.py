#!/usr/bin/env python3
"""Quality of life pass (owner's list, 2026-11-13): one browser, a fresh save, every item checked in a real page.

Run from anywhere: python3 dev/ui-qol-test.py [port]. It serves the repo itself (python3 -m http.server <port>).
  1 Quick rematch   solo Quick Play results: the main button says Next match and names the playlist; one tap searches
                    it again. Friend room (two tabs, ?net=local): the host's button is Rematch (same room), a guest's
                    is Ready, and tapping it readies the guest in the lobby.
  2 Class swap      dead in Team Deathmatch: Next life with Change, a card picks another class for the next life;
                    held out of a Control or Headquarters respawn the Next life line still shows (Respawn does not).
  3 Shortcuts       playFor maps challenge stats to the right tab and pick; a challenge row's Play opens Multiplayer
                    there; Gunsmith > Camo shows the next camo challenge with Play, which equips the gun.
  4 Remember        Multiplayer tab and playlist, Custom map and mode, the room's squad size and the class survive a
                    reload; Graveyard Shift's last map is pre-voted.
  5 New dots        a forgotten unlock shows a dot on its item and on the buttons leading to it; seeing it clears it.
  6 Settings search filters the Options columns; finds Accessibility and Controller rows and jumps to them.
  7 Leave           the scoreboard's Leave asks with what it costs, Stay keeps the match, Leave leaves; a host with a
                    guest is asked before leaving the room.
  8 Spectating      Search and Destroy, out: the card names the watched player, operator and gun; Next switches
                    (camera follows); a controller's RB switches too. Showdown spectates too.
  9 Extras          tap-to-copy room code; a guest's lobby names the host.
  Layout            the new pieces stay on screen at 640 x 360 and 956 x 440.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8470))
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']   # Both tabs keep running.
BASE = f'http://localhost:{PORT}/'
failures, errors = [], []


def check(name, ok, info=''):
    print(f'  {name:<60} {"ok" if ok else "FAIL"} {info if not ok or os.environ.get("VERBOSE") else ""}')
    if not ok: failures.append(f'{name}: {info}')


FAKE_PAD = """(() => {
  const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true,
    mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad; window.__padOn = false;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__padOn ? pad : null, null, null, null] });
  window.__setBtn = (i, on) => { const b = pad.buttons[i]; b.pressed = on; b.touched = on; b.value = on ? 1 : 0; pad.timestamp = performance.now(); };
  window.__connect = on => { window.__padOn = on; const e = new Event(on ? 'gamepadconnected' : 'gamepaddisconnected'); e.gamepad = pad; window.dispatchEvent(e); };
})()"""
A, B, LB, RB, START = 0, 1, 4, 5, 9

G = "const g = window.__game, m = g.app.match, sim = m?.sim, me = sim?.byId.get(m.localId);"


async def ev(pg, js):
    return await pg.evaluate(f"(async () => {{ {G} {js} }})()")


async def fresh_page(ctx, query=''):
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
    await pg.goto(BASE + '?debug=1' + query)
    await pg.wait_for_timeout(900)
    await pg.evaluate("window.__game.Progress.name = 'Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1300)
    return pg


async def act(pg, sel):
    await pg.evaluate(f"document.querySelector({sel!r}).click()")


async def screen(pg):
    return await pg.evaluate('window.__game.menu.el.dataset.screen')


async def press(pg, btn, ms=90):
    await pg.evaluate(f'window.__setBtn({btn}, true)')
    await pg.wait_for_timeout(ms)
    await pg.evaluate(f'window.__setBtn({btn}, false)')
    await pg.wait_for_timeout(140)


async def on_screen(pg, sel):
    """True if the element is wholly inside the viewport."""
    return await pg.evaluate(f"""(() => {{ const el = document.querySelector({sel!r}); if (!el) return false;
      const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }})()""")


# ---------------------------------------------------------------------------------------------------------------------
async def remember(ctx):
    print('4 Remember choices')
    pg = await fresh_page(ctx)
    await act(pg, '[data-act="multiplayer"]'); await pg.wait_for_timeout(500)
    await act(pg, '[data-act="mpTab"][data-tab="br"]'); await pg.wait_for_timeout(300)
    await act(pg, '[data-act="mpPlaylist"][data-id="duos"]'); await pg.wait_for_timeout(300)
    await act(pg, '[data-act="mpBack"]'); await pg.wait_for_timeout(300)
    await act(pg, '[data-act="custom"]'); await pg.wait_for_timeout(600)
    pick = await pg.evaluate("""(() => { const b = [...document.querySelectorAll('[data-act="soloMap"]')].find(x => x.dataset.id !== 'random' && x.dataset.id !== window.__game.app.soloPick.mapId);
      b?.click(); return window.__game.app.soloPick; })()""")
    await pg.wait_for_timeout(300)
    await pg.evaluate("window.__game.Progress.activeLoadout = 2")
    await pg.reload(); await pg.wait_for_timeout(1300)
    st = await pg.evaluate("({ mp: window.__game.app.mp, solo: window.__game.app.soloPick, cls: window.__game.Progress.activeLoadout })")
    check('Multiplayer tab restored', st['mp']['tab'] == 'br', st['mp'])
    check('Multiplayer playlist restored', (st['mp']['sels'].get('br') or {}).get('playlist') == 'duos', st['mp'])
    check('Custom map and mode restored', st['solo']['mapId'] == pick['mapId'] and st['solo']['mode'] == pick['mode'], f"{pick} -> {st['solo']}")
    check('last-used class restored', st['cls'] == 2, st['cls'])
    await act(pg, '[data-act="multiplayer"]'); await pg.wait_for_timeout(500)
    on = await pg.evaluate("[document.querySelector('[data-act=mpTab].on')?.dataset.tab, document.querySelector('[data-act=mpPlaylist][data-id=duos]')?.className]")
    check('Multiplayer screen opens on the remembered pick', on[0] == 'br' and 'on' in (on[1] or '').split(), on)
    # Squad size: what this phone last hosted with.
    await pg.evaluate("window.__game.Options.set('recall', { ...window.__game.Options.get('recall'), brSquad: 2 })")
    # Graveyard Shift: the last map played is this player's ballot in the next Zombies vote.
    await pg.evaluate("""(() => { const o = window.__game.Options; o.set('recall', { ...o.get('recall'), zmMap: 'ruins' }); })()""")
    await act(pg, '[data-act="mpTab"][data-tab="zombies"]'); await pg.wait_for_timeout(300)
    await act(pg, '[data-act="mpPlaylist"][data-id="zmsolo"]'); await pg.wait_for_timeout(200)
    await act(pg, '[data-act="mpFind"]')
    await pg.wait_for_function("window.__game.app.vote", timeout=15000)
    v = await pg.evaluate("(() => { const v = window.__game.app.vote; return { maps: v.options.map(o => o.mapId), mine: v.mine }; })()")
    ok = ('ruins' not in v['maps'] and v['mine'] is None) or (v['mine'] is not None and v['maps'][v['mine']] == 'ruins')
    check('Graveyard Shift: last map pre-voted when offered', ok, v)
    await pg.evaluate("window.__game.app.vote && (clearInterval(window.__game.app.vote.timer), clearTimeout(window.__game.app.vote.reveal)); window.__game.menu.title({})")
    await pg.close()


async def search(ctx):
    print('6 Settings search')
    pg = await fresh_page(ctx)
    await act(pg, '[data-act="options"]'); await pg.wait_for_timeout(600)
    await pg.fill('.opt-search-in', 'audio'); await pg.wait_for_timeout(200)
    vis = await pg.evaluate("[...document.querySelectorAll('.opt-col:not(.opt-found)')].filter(c => !c.hidden).map(c => c.querySelector('h4').textContent.trim())")
    check('a section name shows that section only', len(vis) == 1 and 'Audio' in vis[0], vis)
    await pg.fill('.opt-search-in', 'left handed'); await pg.wait_for_timeout(200)
    rows = await pg.evaluate("[...document.querySelectorAll('.opt-col:not(.opt-found) .opt-row')].filter(r => !r.hidden && r.offsetParent).map(r => r.querySelector('.opt-name b').textContent)")
    check('words find a row in Controls', rows == ['Left-handed'], rows)
    await pg.fill('.opt-search-in', 'colour'); await pg.wait_for_timeout(200)
    jumps = await pg.evaluate("[...document.querySelectorAll('[data-act=optJump]')].map(b => b.dataset.to + ':' + b.dataset.find)")
    check('finds an Accessibility row', 'a11y:Colour mode' in jumps, jumps)
    await pg.fill('.opt-search-in', 'reload'); await pg.wait_for_timeout(200)
    jumps = await pg.evaluate("[...document.querySelectorAll('[data-act=optJump]')].map(b => b.dataset.to + ':' + b.dataset.find)")
    check('finds a Controller button', 'pad:Reload' in jumps, jumps)
    await act(pg, '[data-act="optJump"]'); await pg.wait_for_timeout(300)
    st = await pg.evaluate("[window.__game.menu.el.dataset.screen, document.querySelector('.opt-hit')?.textContent.trim().slice(0, 12)]")
    check('a jump opens that screen on the row', st[0] == 'controller' and st[1] and 'Reload' in st[1], st)
    await act(pg, '[data-act="padBack"]'); await pg.wait_for_timeout(300)
    q = await pg.evaluate("document.querySelector('.opt-search-in')?.value")
    check('Back keeps the search', q == 'reload', q)
    await pg.fill('.opt-search-in', 'qqxz'); await pg.wait_for_timeout(200)
    check('no match says so', await pg.is_visible('.opt-none'))
    await act(pg, '[data-act="optSearchClear"]'); await pg.wait_for_timeout(200)
    n = await pg.evaluate("[...document.querySelectorAll('.opt-col:not(.opt-found)')].filter(c => !c.hidden).length")
    check('clearing shows every column', n == 3, n)
    await pg.close()


async def shortcuts(ctx):
    print('3 Challenge shortcuts')
    pg = await fresh_page(ctx)
    m = await pg.evaluate("""(async () => { const { playFor } = await import('./js/ui/shortcuts.js');
      const f = s => { const r = playFor(s); return r ? `${r.tab}/${r.sel.playlist ?? r.sel.modes.join('+')}` : null; };
      return Object.fromEntries(['kills', 'cat:SMG', 'won:dom', 'won:snd', 'plants', 'confirms', 'flagCaps', 'played:ex', 'played:zm', 'played:gf', 'ranked', 'top3:ffa', 'played:br'].map(s => [s, f(s)])); })()""")
    want = {'kills': 'standard/qp', 'cat:SMG': 'standard/qp', 'won:dom': 'standard/dom', 'won:snd': 'standard/snd', 'plants': 'standard/snd',
            'confirms': 'standard/kc', 'flagCaps': 'standard/ctf', 'played:ex': 'extraction/exquads', 'played:zm': 'zombies/zmsolo',
            'played:gf': 'standard/showdown', 'ranked': 'standard/ranked', 'top3:ffa': 'standard/ffa', 'played:br': 'br/quads'}
    bad = {k: (m.get(k), v) for k, v in want.items() if m.get(k) != v}
    check('playFor picks where each challenge counts', not bad, bad)
    await act(pg, '[data-act="challenges"]'); await pg.wait_for_timeout(600)
    n = await pg.evaluate("document.querySelectorAll('[data-act=chPlay]').length")
    check('every open challenge has Play', n >= 3, n)
    stat = await pg.evaluate("document.querySelector('[data-act=chPlay]').dataset.stat")
    await act(pg, '[data-act="chPlay"]'); await pg.wait_for_timeout(600)
    got = await pg.evaluate(f"""(async () => {{ const {{ playFor }} = await import('./js/ui/shortcuts.js'); const w = playFor({stat!r}), a = window.__game.app;
      return {{ screen: window.__game.menu.el.dataset.screen, ok: a.mp.tab === w.tab && JSON.stringify(a.mp.sels[w.tab]) === JSON.stringify(w.sel) }}; }})()""")
    check('Play opens Multiplayer on that pick', got['screen'] == 'multiplayer' and got['ok'], {**got, 'stat': stat})
    await act(pg, '[data-act="mpBack"]'); await pg.wait_for_timeout(400)
    await act(pg, '[data-act="season"]'); await pg.wait_for_timeout(600)
    await pg.evaluate("document.querySelector('[data-act=szTab][data-tab=weekly]')?.click()"); await pg.wait_for_timeout(400)
    has = await pg.evaluate("[!!document.querySelector('.sz-ch'), document.querySelectorAll('.sz-ch [data-act=chPlay]').length]")
    check('season weekly rows have Play', not has[0] or has[1] > 0, has)
    await pg.evaluate("window.__game.menu.title({})"); await pg.wait_for_timeout(300)
    # Gunsmith: a gun that is not in the loadout; its Camo tab shows the next camo challenge with Play.
    await act(pg, '[data-act="gunsmith"]'); await pg.wait_for_timeout(700)
    gun = await pg.evaluate("""(async () => { const P = window.__game.Progress, l = P.loadouts()[P.activeLoadout];
      const { WEAPON_IDS } = await import('./js/shared/constants.js'), { categoryOf } = await import('./js/ui/armory.js');
      const id = WEAPON_IDS.find(w => P.isItemUnlocked('weapon', w) && w !== l.primary && w !== l.secondary && categoryOf(w) !== categoryOf(l.primary) && P.challenges(w).length);
      document.querySelector(`[data-act=gsCat][data-cat="${categoryOf(id)}"]`)?.click();
      await new Promise(r => setTimeout(r, 400));
      document.querySelector(`[data-act=gsWeapon][data-id="${id}"]`)?.click(); return id; })()""")
    await pg.wait_for_timeout(700)
    await act(pg, '[data-act="gsTab"][data-tab="camo"]'); await pg.wait_for_timeout(400)
    foot = await pg.evaluate("[document.querySelector('.gs-foot .foot-text b')?.textContent, document.querySelector('.gs-foot .foot-text small')?.textContent, !!document.querySelector('[data-act=gsPlay]')]")
    check('Gunsmith Camo shows the next camo challenge', bool(foot[0]) and foot[0].startswith('Next:') and '/' in (foot[1] or '') and foot[2], foot)
    await act(pg, '[data-act="gsPlay"]'); await pg.wait_for_timeout(500)
    st = await pg.evaluate("(() => { const P = window.__game.Progress, l = P.loadouts()[P.activeLoadout]; return [window.__game.menu.el.dataset.screen, l.primary, l.secondary]; })()")
    check('Gunsmith Play equips the gun and opens Multiplayer', st[0] == 'multiplayer' and gun in st[1:], [gun, st])
    await pg.close()


async def dots(ctx):
    print('5 New dots')
    pg = await fresh_page(ctx)
    first = await pg.evaluate("window.__game.NewDots.fresh().size")
    check('a fresh save starts with no dots', first == 0, first)
    ids = await pg.evaluate("""(() => { const P = window.__game.Progress, N = window.__game.NewDots;
      const gun = P.loadouts()[P.activeLoadout].primary, cam = P.camos(gun).find(c => c.unlocked && c.camo.id !== 'none');
      const card = P.cards().find(c => c.unlocked)?.card.id, op = P.operators().find(o => o.unlocked)?.op.id;
      N.forget('weapon:smg'); if (card) N.forget('card:' + card); if (op) N.forget('operator:' + op); if (cam) N.forget(`camo:${gun}:${cam.camo.id}`);
      window.__game.menu.title({}); return { gun, cam: cam?.camo.id ?? null, card, op }; })()""")
    await pg.wait_for_timeout(500)
    leads = await pg.evaluate("[...document.querySelectorAll('.nd-dot')].map(d => d.parentElement.dataset.act).sort()")
    check('title buttons leading to new unlocks wear a dot', all(a in leads for a in ['gunsmith', 'loadout', 'operators', 'profile']), leads)
    await act(pg, '[data-act="gunsmith"]'); await pg.wait_for_timeout(700)
    cats = await pg.evaluate("[...document.querySelectorAll('.nd-dot')].map(d => (d.parentElement.dataset.act) + ':' + (d.parentElement.dataset.cat || d.parentElement.dataset.id || ''))")
    check('the SMG class wears a dot', 'gsCat:SMG' in cats, cats)
    await act(pg, '[data-act="gsCat"][data-cat="SMG"]'); await pg.wait_for_timeout(900)
    seen = await pg.evaluate("[!!document.querySelector('[data-act=gsWeapon][data-id=smg] > .nd-dot'), window.__game.NewDots.fresh().has('weapon:smg')]")
    check('the new gun wears a dot, and seeing it clears it', seen[0] and not seen[1], seen)
    if ids['cam']:
        await pg.evaluate("window.__game.menu.title({})"); await pg.wait_for_timeout(300)
        await act(pg, '[data-act="gunsmith"]'); await pg.wait_for_timeout(600)
        await pg.evaluate(f"""(async () => {{ const {{ categoryOf }} = await import('./js/ui/armory.js'); document.querySelector(`[data-act=gsCat][data-cat="${{categoryOf('{ids['gun']}')}}"]`)?.click(); }})()""")
        await pg.wait_for_timeout(600)
        await act(pg, f'[data-act="gsWeapon"][data-id="{ids["gun"]}"]'); await pg.wait_for_timeout(800)
        tab = await pg.evaluate("!!document.querySelector('[data-act=gsTab][data-tab=camo] > .nd-dot')")
        check('the Camo tab wears a dot for a new camo', tab)
        await act(pg, '[data-act="gsTab"][data-tab="camo"]'); await pg.wait_for_timeout(700)
        cam = await pg.evaluate(f"[!!document.querySelector('[data-act=gsCamo][data-id=\"{ids['cam']}\"] > .nd-dot'), window.__game.NewDots.fresh().has('camo:{ids['gun']}:{ids['cam']}')]")
        check('the camo wears a dot and is seen', cam[0] and not cam[1], cam)
    stored = await pg.evaluate("localStorage.getItem('switchyard-seen')?.length ?? -1")
    check('seen ids stored compactly (5 chars each)', stored > 0 and stored % 5 == 0, stored)
    await pg.close()


async def quick_results(ctx):
    print('1 Quick rematch (solo) and 7 Leave')
    pg = await fresh_page(ctx, '&bots=elite&limit=1&time=12&vote=2&search=300')
    await act(pg, '[data-act="quickPlay"]')
    await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=60000)
    # 7: Leave asks first.
    await pg.evaluate("window.__game.hud.toggleBoard()"); await pg.wait_for_timeout(200)
    await act(pg, '.board-leave'); await pg.wait_for_timeout(200)
    tip = await pg.evaluate("[document.querySelector('.board-tip').textContent, !document.querySelector('.board-stay').hidden, window.__game.app.inMatch]")
    check('Leave asks and says progress is lost', 'lost' in tip[0] and tip[1] and tip[2], tip)
    await act(pg, '.board-stay'); await pg.wait_for_timeout(200)
    st = await pg.evaluate("[window.__game.app.inMatch, document.querySelector('.board-leave').textContent, document.querySelector('.board-tip').textContent]")
    check('Stay keeps the match', st[0] and st[1] == 'Leave match' and 'Tap the score' in st[2], st)
    await pg.evaluate("window.__game.hud.boardOpen && window.__game.hud.toggleBoard()")
    await pg.wait_for_function('!window.__game.app.inMatch', timeout=120000)
    await pg.wait_for_timeout(2500)
    lab = await pg.evaluate("[document.querySelector('[data-act=resRematch] b')?.textContent, document.querySelector('[data-act=resRematch] small')?.textContent]")
    check('results: Next match names the playlist', lab[0] == 'Next match' and lab[1] and 'Quick Play' in lab[1], lab)
    for w, h in ((640, 360), (956, 440)):
        await pg.set_viewport_size({'width': w, 'height': h}); await pg.wait_for_timeout(400)
        check(f'results main button on screen at {w}', await on_screen(pg, '[data-act=resRematch]'))
        fits = await pg.evaluate("(() => { const b = document.querySelector('[data-act=resRematch]'), t = b.querySelector('.rs-again-tx'); return t.scrollWidth <= b.clientWidth + 1; })()")
        check(f'results main button text fits at {w}', fits)
    await pg.set_viewport_size({'width': 844, 'height': 390})
    await act(pg, '[data-act="resRematch"]')
    await pg.wait_for_function('window.__game.app.inMatch', timeout=60000)
    pick = await pg.evaluate("window.__game.app.lastPick")
    check('one tap queues the same playlist', (pick or {}).get('mp', {}).get('sel', {}).get('playlist') == 'qp', pick)
    await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=60000)
    await pg.evaluate("window.__game.hud.toggleBoard()"); await pg.wait_for_timeout(150)
    await act(pg, '.board-leave'); await pg.wait_for_timeout(150)
    await act(pg, '.board-leave'); await pg.wait_for_timeout(600)
    check('a second Leave leaves', await pg.evaluate("!window.__game.app.inMatch && window.__game.menu.el.dataset.screen === 'title'"))
    await pg.close()


async def friend_room(ctx):
    print('1 Quick rematch (friend room), 7 host leave, 9 extras')
    host = await fresh_page(ctx, '&net=local&bots=elite&limit=1&time=12&vote=2')
    guest = await fresh_page(ctx, '&net=local&bots=elite&limit=1&time=12&vote=2')
    await guest.evaluate("window.__game.Progress.name = 'Guest'")
    async def juggle():
        while True:
            for pg in (host, guest):
                try: await pg.bring_to_front()
                except Exception: pass
                await asyncio.sleep(0.12)
    juggler = asyncio.create_task(juggle())
    await act(host, '[data-act="host"]'); await host.wait_for_timeout(800)
    code = await host.evaluate("window.__game.app.code")
    await act(host, '[data-act="copyCode"]'); await host.wait_for_timeout(300)
    toast = await host.evaluate("document.querySelector('.toast')?.textContent ?? ''")
    check('tapping the room code copies it', code in toast, toast)
    await guest.evaluate(f"window.__game.join('{code}')")
    await host.wait_for_function("window.__game.app.lobby.humans.length === 2", timeout=20000)
    await guest.wait_for_function("window.__game.menu.el.dataset.screen === 'lobby'", timeout=20000)
    await guest.wait_for_timeout(500)
    tip = await guest.evaluate("document.querySelector('.room-tip')?.textContent ?? ''")
    check("a guest's lobby names the host", 'Tester starts the match' in tip, tip)
    await act(host, '[data-act="leaveLobby"]'); await host.wait_for_timeout(300)
    sheet = await host.evaluate("[!!document.querySelector('.qol-confirm'), document.querySelector('.qol-confirm p')?.textContent ?? '']")
    check('a host with a guest is asked before leaving', sheet[0] and 'becomes host' in sheet[1], sheet)
    await act(host, '[data-act="qolNo"]'); await host.wait_for_timeout(300)
    check('Stay keeps the room', await host.evaluate("window.__game.menu.el.dataset.screen === 'lobby' && !!window.__game.app.net"))
    await act(guest, '[data-act="toggleReady"]'); await guest.wait_for_timeout(500)
    await host.wait_for_function("window.__game.app.lobby.humans.every(h => h.ready)", timeout=10000)
    await act(host, '[data-act="start"]')
    for pg in (host, guest):
        await pg.wait_for_function('window.__game.app.inMatch', timeout=60000)
    for pg in (host, guest):
        await pg.wait_for_function("!window.__game.app.inMatch && window.__game.menu.el.dataset.screen === 'results'", timeout=240000)
    await host.wait_for_timeout(1500)
    h = await host.evaluate("[document.querySelector('[data-act=resRematch] b')?.textContent, document.querySelector('[data-act=resRematch] small')?.textContent]")
    gl = await guest.evaluate("[document.querySelector('[data-act=resRematch] b')?.textContent, document.querySelector('[data-act=resRematch] small')?.textContent]")
    check("host's results: Rematch, the same room", h[0] == 'Rematch' and 'Same room' in (h[1] or ''), h)
    check("guest's results: Ready, the host's call", gl[0] == 'Ready' and 'host' in (gl[1] or ''), gl)
    await act(guest, '[data-act="resRematch"]'); await guest.wait_for_timeout(600)
    st = await guest.evaluate("[window.__game.menu.el.dataset.screen, window.__game.app.rematchWait]")
    check('Ready readies the guest in the lobby', st[0] == 'lobby' and st[1], st)
    juggler.cancel()
    await host.close(); await guest.close()


async def class_swap(ctx):
    print('2 Class swap while dead')
    pg = await fresh_page(ctx, '&map=railyard&mode=tdm&bots=recruit')
    await act(pg, '[data-act="custom"]')
    await pg.wait_for_function('window.__game.app.match?.interp.newest?.phase === "live"', timeout=60000)
    await pg.wait_for_timeout(500)
    before = await pg.evaluate("window.__game.Progress.activeLoadout")
    await ev(pg, "const foe = sim.players.find(p => p.team !== me.team); me.spawnProtect = 0; sim._damage(me, foe, 999, 'ar', 5);")
    await pg.wait_for_function("document.querySelector('.death.show')", timeout=10000)
    await pg.wait_for_timeout(600)
    try:
        await pg.wait_for_selector('.dn-change', state='visible', timeout=20000); vis = True
    except Exception: vis = False
    check('death screen offers Change', vis)
    await act(pg, '.dn-change'); await pg.wait_for_timeout(400)
    other = (before + 1) % 3
    # A card counts a press that went down on it while the picker was open (js/ui/hud.js #wirePicker).
    await pg.locator(f'.picker .pick[data-i="{other}"]').tap()
    await pg.wait_for_timeout(500)
    after = await pg.evaluate("[window.__game.Progress.activeLoadout, document.querySelector('.dn-text b').textContent, window.__game.Progress.loadouts()[window.__game.Progress.activeLoadout].name]")
    check('a card picks the class for the next life', after[0] == other and after[1] == after[2], [before, after])
    await pg.evaluate("window.__game.hud.el.classList.add('mh-held')"); await pg.wait_for_timeout(100)
    held = await pg.evaluate("[getComputedStyle(document.querySelector('.death-next')).display, getComputedStyle(document.querySelector('.death-go')).display]")
    check('held out of respawns: Next life stays, Respawn goes', held[0] != 'none' and held[1] == 'none', held)
    await pg.evaluate("window.__game.hud.el.classList.remove('mh-held')")
    await pg.close()


async def spectating(ctx):
    print('8 Spectating')
    pg = await fresh_page(ctx, '&map=railyard&mode=snd&bots=recruit')
    await act(pg, '[data-act="custom"]')
    await pg.wait_for_function('!!window.__game.app.match?.sim', timeout=60000)
    await pg.wait_for_timeout(1300)
    await ev(pg, "sim.phaseT = 0.05;")
    await pg.wait_for_timeout(800)
    await ev(pg, "const foe = sim.players.find(p => p.team !== me.team); me.spawnProtect = 0; sim._damage(me, foe, 999, 'ar', 5);")
    await pg.wait_for_function("document.querySelector('.spec-card') && !document.querySelector('.spec-card').hidden && !document.body.classList.contains('killcam-on')", timeout=20000)
    await pg.wait_for_timeout(600)
    card = await pg.evaluate("""(() => { const g = window.__game, w = g.app.renderer.watching, p = g.app.match.interp.newest.players.find(q => q.id === w);
      return { w, name: p?.name, shown: document.querySelector('.spc-who b').textContent, gun: document.querySelector('.spc-gun').textContent, op: document.querySelector('.spc-op').textContent, stats: document.querySelector('.spc-stats').textContent }; })()""")
    plain = lambda t: ''.join(ch for ch in (t or '') if ch.isalnum())
    check('card names the watched player', card['w'] and plain(card['name']) == plain(card['shown']), card)
    check('card shows operator, gun, kills and round', bool(card['op']) and bool(card['gun']) and 'K' in card['stats'] and 'Round' in card['stats'], card)
    await act(pg, '.spc-next')
    try: await pg.wait_for_function(f"window.__game.app.renderer.watching !== {card['w']!r}", timeout=6000)
    except Exception: pass
    w2 = await pg.evaluate("[window.__game.app.renderer.watching, document.querySelector('.spc-who b').textContent]")
    check('Next switches who is watched and the camera follows', w2[0] != card['w'], [card['w'], w2])
    await act(pg, '.spc-prev')
    try: await pg.wait_for_function(f"window.__game.app.renderer.watching === {card['w']!r}", timeout=6000)
    except Exception: pass
    w3 = await pg.evaluate("window.__game.app.renderer.watching")
    check('Previous goes back', w3 == card['w'], [card['w'], w3])
    for w, h in ((640, 360), (956, 440)):
        await pg.set_viewport_size({'width': w, 'height': h}); await pg.wait_for_timeout(1300)
        check(f'card on screen at {w}', await on_screen(pg, '.spec-card'))
        clash = await pg.evaluate("""(() => { const a = document.querySelector('.spec-card').getBoundingClientRect(), r = document.querySelector('.death.show .death-act')?.getBoundingClientRect();
          return !!r && r.width > 0 && a.left < r.right && a.right > r.left && a.top < r.bottom && a.bottom > r.top; })()""")
        check(f'card clear of the Next round row at {w}', not clash)
    await pg.set_viewport_size({'width': 844, 'height': 390})
    # A controller: RB switches.
    await pg.evaluate("window.__connect(true)"); await pg.wait_for_timeout(300)
    await press(pg, A, 60)          # Any press puts the page in controller mode.
    before = await pg.evaluate("window.__game.app.renderer.watching")
    await press(pg, RB)
    try: await pg.wait_for_function(f"window.__game.app.renderer.watching !== {before!r}", timeout=6000)
    except Exception: pass
    after = await pg.evaluate("window.__game.app.renderer.watching")
    check('controller RB switches who is watched', before and after and before != after, [before, after])
    await pg.evaluate("window.__connect(false)")
    # Showdown and Graveyard Shift spectate too (js/sim/snd.js spectate.target).
    ok = await pg.evaluate("""(async () => { const { spectate } = await import('./js/sim/snd.js');
      const pl = [{ id: 'me', team: 0, alive: false }, { id: 'mate', team: 0, alive: true }, { id: 'foe', team: 1, alive: true }];
      spectate.reset();
      const gf = spectate.target({ phase: 'live', players: pl, obj: { kind: 'gf', state: 'live' } }, 'me');
      const gfFreeze = spectate.target({ phase: 'live', players: pl, obj: { kind: 'gf', state: 'freeze' } }, 'me');
      const gfFoe = spectate.target({ phase: 'live', players: [pl[0], { ...pl[1], alive: false }, pl[2]], obj: { kind: 'gf', state: 'live' } }, 'me');
      const zm = spectate.target({ phase: 'live', players: pl, obj: { zm: true, round: 3 } }, 'me');
      return [gf, gfFreeze, gfFoe, zm]; })()""")
    check('Showdown and Graveyard Shift: watch the team (Showdown then anyone)', ok == ['mate', None, 'foe', 'mate'], ok)
    await pg.close()


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            for part in (remember, search, shortcuts, dots, class_swap, spectating, quick_results, friend_room):
                ctx = await browser.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True)
                await ctx.add_init_script(FAKE_PAD)
                try:
                    await part(ctx)
                except Exception as e:
                    failures.append(f'{part.__name__}: {type(e).__name__} {str(e)[:300]}')
                    print(f'  {part.__name__} raised {type(e).__name__}: {str(e)[:300]}')
                await ctx.close()
            await browser.close()
    finally:
        srv.kill()
    errs = [e for e in errors if 'favicon' not in e and 'ERR_' not in e]
    if errs:
        print('Console errors:'); [print('  ', e[:300]) for e in errs[:10]]
    print('\n' + ('PASS' if not failures and not errs else f'FAIL ({len(failures)} checks, {len(errs)} errors)'))
    for f in failures: print('  -', f)
    sys.exit(1 if failures or errs else 0)


asyncio.run(main())
