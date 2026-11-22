#!/usr/bin/env python3
"""Match replays (docs/REPLAYS.md) in a real page.

Run from anywhere: python3 dev/ui-replay-test.py [port]. It serves the repo itself (python3 -m http.server <port>) and:
  TDM       plays a short solo Team Deathmatch on Railyard (?time=20) to its results; Watch replay is on the final kill
            card; the replay plays (clip time moves, names over heads, the kill feed fills), the scrub bar seeks (tap at
            three quarters), 2x runs about four times as fast as 0.5x, pause holds, the three cameras (you, the killer,
            the overview, which pans by drag) aim where they should; the recorder's memory is bounded and its per-frame
            cost is printed; playback frame cost printed. Save clip stores it (IndexedDB); Close returns to the same results.
  History   Menu > History > Clips lists the clip with its map, mode and date; Watch opens it (no Save button, it is
            saved); Close comes back to the Clips tab; Delete (tap twice) removes it and the list is empty.
  Pad       a fake standard pad: A pauses and plays, RB speeds up, Y changes camera, d-pad right seeks 5 s, B closes.
  Busy      battle royale on Frontier and Graveyard Shift round 20 on Ashgrove: the record never holds more than the
            cap of players per keyframe, the local player is always in it, the replay plays.
  Cap       six saves: the sixth is refused with the "5 clips" message, nothing is lost.
"""
import asyncio, subprocess, sys, time, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8573))
ONLY = [a for a in sys.argv[1:] if not a.isdigit()]
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
G = 'window.__game'
failures, errors = [], []


def check(name, ok, info=''):
    print(f'  {name:<64} {"ok" if ok else "FAIL"} {info}')
    if not ok: failures.append(f'{name}: {info}')


FAKE_PAD = """(() => {
  const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true,
    mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad; window.__padOn = false;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__padOn ? pad : null, null, null, null] });
  window.__setBtn = (i, on) => { const b = pad.buttons[i]; b.pressed = on; b.touched = on; b.value = on ? 1 : 0; pad.timestamp = performance.now(); };
  window.__connect = on => { window.__padOn = on; const e = new Event(on ? 'gamepadconnected' : 'gamepaddisconnected'); e.gamepad = pad; window.dispatchEvent(e); };
})()"""

RP = f"""(() => {{ const v = {G}.replay(); if (!v) return null;
  return {{ c: v.c, dur: v.reader.duration, playing: v.playing, speed: v.speed, cam: v.cam, killer: v.killer, saved: v.saved,
    frames: v.clip.frames.at.length, maxN: Math.max(...v.clip.frames.n), ev: v.clip.ev.length, cast: v.clip.cast.length,
    shot: {{ px: v.shot.px, py: v.shot.py, tx: v.shot.tx, tz: v.shot.tz }}, stats: v.stats,
    names: [...document.querySelectorAll('.rp-names span')].filter(s => !s.hidden).length,
    feed: document.querySelectorAll('.rp-feed .rp-kill').length,
    save: document.querySelector('.rp-save')?.textContent ?? null }}; }})()"""
REC = f"""(() => {{ const r = {G}.app.match?.recorder; if (!r) return null; let maxN = 0; for (const f of r.frames) if (f.at >= 0) maxN = Math.max(maxN, f.n);
  const me = r.frames[(r.head - 1 + r.frames.length) % r.frames.length];
  let mine = false; for (let i = 0; i < me.n; i++) if (r.cast[me.d[i * 20]]?.id === r.localId) mine = true;
  return {{ count: r.count, maxN, cap: r.maxP, cast: r.cast.length, players: {G}.app.match.interp.newest?.players.length ?? 0, mine,
    bytes: r.frames.length * r.frames[0].d.byteLength, s: r.stats }}; }})()"""
SCREEN = f"""(() => ({{ screen: {G}.menu.el.dataset.screen, on: {G}.menu.el.classList.contains('on'), replayOn: document.body.classList.contains('replay-on'),
  inMatch: {G}.app.inMatch }}))()"""


async def boot(ctx, url):
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text[:300]) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
    await pg.goto(url)
    await pg.wait_for_function(f'!!{G}?.Progress', timeout=30000)
    await pg.evaluate(f"{G}.Progress.name='Tester'; {G}.Progress.setFlag('tutorialOffered'); {G}.Progress.setFlag('aimHint')")
    await pg.reload()
    await pg.wait_for_function(f'!!{G}?.Progress', timeout=30000)
    await pg.wait_for_timeout(900)
    return pg


async def start_custom(pg):
    await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_function(f'{G}.app.inMatch && {G}.app.match?.interp?.newest?.phase === "live"', timeout=90000)


async def to_results(pg, timeout=300000):     # Sim time: a 20 s match runs minutes under load.
    await pg.wait_for_function(f"{G}.menu.el.dataset.screen === 'results' && {G}.menu.el.classList.contains('on')", timeout=timeout)
    await pg.wait_for_timeout(600)
    await settle_results(pg)


async def settle_results(pg):
    """The results reel to its end (Skip), then the Unlocked summary it opens over the screen closed (Continue): that
    overlay carries its own Menu and Rematch and covers the results' buttons (bug sweep 2026-11-20)."""
    await pg.evaluate("document.querySelector('.res-skip:not([hidden])')?.click()")
    try: await pg.wait_for_function("!document.querySelector('.res-skip') || document.querySelector('.res-skip').hidden", timeout=60000)
    except Exception: pass
    await pg.wait_for_timeout(300)
    await pg.evaluate("document.querySelector('.overlay.show [data-act=\"uxDone\"]')?.click()")
    await pg.wait_for_timeout(300)


async def tdm(ctx):
    print('TDM')
    pg = await boot(ctx, f'http://localhost:{PORT}/?debug=1&map=railyard&mode=tdm&time=20&limit=500')
    # Start clean: no clips from an earlier run.
    for c in await pg.evaluate(f'{G}.clips.listClips()'):
        await pg.evaluate(f'{G}.clips.deleteClip("{c["id"]}")')
    await start_custom(pg)
    await pg.wait_for_timeout(6000)
    rec = await pg.evaluate(REC)
    s = rec['s']
    print(f"    recorder: {s['frames']} frames, {s['keyframes']} keyframes, mean {1000 * s['totalMs'] / max(1, s['frames']):.1f} us/frame, "
          f"keyframe mean {1000 * s['keyMs'] / max(1, s['keyframes']):.1f} us, worst {s['maxMs']:.2f} ms; ring {rec['bytes'] // 1024} KB of keyframes")
    check('recorder keeps every player of a 6v6', rec['maxN'] == rec['players'] and rec['mine'], rec)
    check('recorder per-frame cost under 0.5 ms mean', s['totalMs'] / max(1, s['frames']) < 0.5, s)
    await to_results(pg)
    check('results: Watch replay on the final kill card', await pg.locator('.finalcard [data-act="resReplay"]').count() == 1)
    await pg.locator('[data-act="resReplay"]').click()
    await pg.wait_for_timeout(2500)
    st = await pg.evaluate(SCREEN)
    rp = await pg.evaluate(RP)
    check('replay opens over the results', rp is not None and st['replayOn'] and st['screen'] == 'results', st)
    check('clip is about the last 30 s, 6v6 in every keyframe', rp and 15 < rp['dur'] <= 31 and rp['maxN'] == 12, rp and {k: rp[k] for k in ('dur', 'maxN', 'frames')})
    check('playing: clip time moves', rp and rp['c'] > 0.8 and rp['playing'], rp and rp['c'])
    check('names over heads', rp and rp['names'] >= 1, rp and rp['names'])
    # Scrub: a tap at three quarters of the bar.
    box = await pg.locator('.rp-scrub').bounding_box()
    await pg.mouse.click(box['x'] + box['width'] * 0.75, box['y'] + box['height'] / 2)
    await pg.wait_for_timeout(150)
    rp = await pg.evaluate(RP)
    check('scrub bar seeks to three quarters', abs(rp['c'] - rp['dur'] * 0.75) < 1.2, f"{rp['c']:.2f} of {rp['dur']:.2f}")
    # Drag back to the start, then let the kill feed fill as it plays through the kills.
    await pg.mouse.move(box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2)
    await pg.mouse.down(); await pg.mouse.move(box['x'] + 2, box['y'] + box['height'] / 2, steps=5); await pg.mouse.up()
    rp = await pg.evaluate(RP)
    check('scrub drag back to the start', rp['c'] < 1.0, rp['c'])
    # Speeds: the clock's progress in wall time at 0.5x and at 2x.
    async def rate(i):
        await pg.locator(f'.rp-speed[data-i="{i}"]').click()
        a = await pg.evaluate(RP); t0 = time.time()
        await pg.wait_for_timeout(1500)
        b = await pg.evaluate(RP)
        return (b['c'] - a['c']) / (time.time() - t0), b['speed']
    slow, s0 = await rate(0)
    fast, s2 = await rate(2)
    check('0.5x and 2x: 2x runs ~4x as fast', s0 == 0.5 and s2 == 2 and fast > slow * 2.5, f'{slow:.2f} vs {fast:.2f} clip s per s')
    await pg.locator('.rp-speed[data-i="1"]').click()
    # Pause holds the clock.
    await pg.locator('.rp-play').click()
    a = await pg.evaluate(RP); await pg.wait_for_timeout(600); b = await pg.evaluate(RP)
    check('pause holds', not b['playing'] and abs(b['c'] - a['c']) < 0.01, (a['c'], b['c']))
    await pg.locator('.rp-play').click()
    # Kill feed: seek to just after the first kill and play a moment.
    first_kill = await pg.evaluate(f"(() => {{ const v = {G}.replay(); const i = v.clip.ev.findIndex(e => e.t === 'kill'); return i < 0 ? -1 : v.clip.evAt[i]; }})()")
    if first_kill >= 0:
        await pg.evaluate(f"(() => {{ const v = {G}.replay(); v.setPlaying(true); }})()")
        box = await pg.locator('.rp-scrub').bounding_box()
        await pg.mouse.click(box['x'] + box['width'] * max(0, first_kill - 0.6) / rp['dur'], box['y'] + box['height'] / 2)
        await pg.wait_for_timeout(1800)
        rp = await pg.evaluate(RP)
        check('kill feed shows the kill', rp['feed'] >= 1, rp['feed'])
    # Cameras.
    await pg.locator('.rp-cam[data-cam="free"]').click(); await pg.wait_for_timeout(700)
    a = await pg.evaluate(RP)
    sb = await pg.locator('.rp-stage').bounding_box()
    await pg.mouse.move(sb['x'] + 400, sb['y'] + 200); await pg.mouse.down(); await pg.mouse.move(sb['x'] + 250, sb['y'] + 200, steps=6); await pg.mouse.up()
    await pg.wait_for_timeout(500)
    b = await pg.evaluate(RP)
    check('overview: high camera', a['shot']['py'] > 50, a['shot'])
    check('overview: drag pans the map', b['shot']['tx'] - a['shot']['tx'] > 5, (a['shot']['tx'], b['shot']['tx']))
    if rp['killer']:
        await pg.locator('.rp-cam[data-cam="killer"]').click(); await pg.wait_for_timeout(900)
        k = await pg.evaluate(f"""(() => {{ const v = {G}.replay(); const p = v.reader.view.players.find(q => q.id === v.killer);
          return p ? Math.hypot(p.x - v.shot.tx, p.z - v.shot.tz) : -1; }})()""")
        check('killer camera follows the final kill\'s killer', 0 <= k < 8, k)
    await pg.locator('.rp-cam[data-cam="me"]').click(); await pg.wait_for_timeout(900)
    k = await pg.evaluate(f"""(() => {{ const v = {G}.replay(); const p = v.reader.view.players.find(q => q.id === v.clip.localId);
      return p ? Math.hypot(p.x - v.shot.tx, p.z - v.shot.tz) : -1; }})()""")
    check('you camera follows you', 0 <= k < 8, k)
    await pg.screenshot(path='/tmp/replay-tdm.png')
    rp = await pg.evaluate(RP)
    s = rp['stats']
    print(f"    playback: {s['frames']} frames, mean {s['totalMs'] / max(1, s['frames']):.1f} ms per frame (renderer {s['renderMs'] / max(1, s['frames']):.1f} ms), worst {s['maxMs']:.1f} ms (SwiftShader)")
    # Save, then Close back to the results.
    await pg.locator('.rp-save').click()
    await pg.wait_for_function("document.querySelector('.rp-save')?.textContent === 'Saved'", timeout=10000)
    clips = await pg.evaluate(f'{G}.clips.listClips()')
    check('Save clip stores one clip', len(clips) == 1 and clips[0]['mapId'] == 'railyard' and clips[0]['mode'] == 'tdm', clips)
    if clips: print(f"    stored clip: {clips[0]['bytes'] // 1024} KB, {clips[0]['dur']:.1f} s")
    await pg.locator('.rp-close').click()
    await pg.wait_for_timeout(400)
    st = await pg.evaluate(SCREEN)
    check('Close returns to the same results screen', st['screen'] == 'results' and st['on'] and not st['replayOn'] and await pg.locator('.rs').count() == 1, st)
    check('canvas belongs to nobody after Close', await pg.evaluate(f'{G}.app.renderer === null && !{G}.replay()'))

    print('History')
    await pg.locator('[data-act="resMenu"]').first.click()
    await pg.wait_for_timeout(900)
    await pg.locator('[data-act="history"]').first.click()
    await pg.wait_for_timeout(700)
    check('History opens', await pg.evaluate(f"{G}.menu.el.dataset.screen") == 'history')
    await pg.locator('.hs-tabs [data-tab="clips"]').click()
    await pg.wait_for_selector('.hc-row', timeout=5000)
    row = await pg.locator('.hc-row').first.inner_text()
    check('Clips tab lists the clip with map and mode', 'Railyard' in row and 'Team Deathmatch' in row, row.replace('\n', ' | '))
    await pg.locator('[data-act="hcWatch"]').first.click()
    await pg.wait_for_function(f'!!{G}.replay()', timeout=15000)
    await pg.wait_for_timeout(1500)
    rp = await pg.evaluate(RP)
    check('saved clip plays', rp['c'] > 0.3 and rp['saved'] and rp['save'] == 'Saved', rp and {k: rp[k] for k in ('c', 'saved', 'save')})
    await pg.locator('.rp-close').click()
    await pg.wait_for_timeout(600)
    check('Close comes back to the Clips tab', await pg.locator('.hs-tabs .seg.on[data-tab="clips"]').count() == 1 and await pg.locator('.hc-row').count() == 1)
    await pg.locator('[data-act="hcDel"]').first.click()
    await pg.wait_for_timeout(200)
    check('Delete asks once', await pg.locator('.hc-del.arm').count() == 1)
    # The confirm tap through the DOM: the arm lapses after 2.5 s, and under load a locator click's actionability waits
    # can outlast it, so the tap re-arms instead of deleting (bug sweep 2026-11-22).
    await pg.evaluate("document.querySelector('.hc-del.arm')?.click()")
    await pg.wait_for_selector('.hs-empty', timeout=20000)
    check('Delete removes the clip', len(await pg.evaluate(f'{G}.clips.listClips()')) == 0)
    await pg.close()


async def pad(ctx):
    print('Pad')
    pg = await boot(ctx, f'http://localhost:{PORT}/?debug=1&map=railyard&mode=tdm&time=12&limit=500')
    await pg.evaluate(FAKE_PAD)
    await pg.evaluate('window.__connect(true)')
    await start_custom(pg)
    await to_results(pg)
    await pg.locator('[data-act="resReplay"]').click()
    await pg.wait_for_timeout(1200)

    async def press(i, ms=90):
        await pg.evaluate(f'window.__setBtn({i}, true)'); await pg.wait_for_timeout(ms)
        await pg.evaluate(f'window.__setBtn({i}, false)'); await pg.wait_for_timeout(160)
    await press(0)      # Wakes the pad (first press) and pauses.
    rp = await pg.evaluate(RP)
    if rp['playing']: await press(0); rp = await pg.evaluate(RP)
    check('A pauses', not rp['playing'], rp['playing'])
    await press(0)
    check('A plays', (await pg.evaluate(RP))['playing'])
    await press(5)
    check('RB speeds up', (await pg.evaluate(RP))['speed'] == 2)
    cam = (await pg.evaluate(RP))['cam']
    await press(3)
    check('Y changes camera', (await pg.evaluate(RP))['cam'] != cam)
    await press(0)      # Pause, so the seek is exact.
    a = (await pg.evaluate(RP))['c']
    await press(15)
    b = (await pg.evaluate(RP))['c']
    check('d-pad right seeks 5 s', abs((b - a) - min(5, (await pg.evaluate(RP))['dur'] - a)) < 0.3, (a, b))
    await press(1)
    check('B closes', not await pg.evaluate(f'!!{G}.replay()') and (await pg.evaluate(SCREEN))['screen'] == 'results')
    await pg.close()


ZM20 = f"""(async () => {{
  const m = {G}.app.match, sim = m.sim, R = sim.rules;
  const Z = await import('/js/shared/zombies.js');
  for (const d of R.L.doors) R.open |= 1 << d.i;
  Z.syncZmDoors(sim.map, R.open);
  for (const d of R.L.doors) Z.reblockNav(sim.nav, sim.map, d);
  for (const p of R.crew) p.spawnProtect = 1e9;
  R._startRound(20); R.spawnT = 0;
  for (let k = 0; k < 200 && R.horde.some(p => !p.alive); k++) {{ R.spawnT = 0; R._stepSpawns(1 / 30); }}
  const me = sim.byId.get(m.localId); const k = sim.nav.nearestFree(sim.map.width / 2, sim.map.height / 2);
  m.ps.x = k % sim.nav.w + 0.5; m.ps.z = Math.floor(k / sim.nav.w) + 0.5;
  return R.horde.filter(p => p.alive).length;
}})()"""


async def busy(ctx, name, mapId, mode):
    print(f'Busy: {name}')
    pg = await boot(ctx, f'http://localhost:{PORT}/?debug=1&map={mapId}&mode={mode}')
    await start_custom(pg)
    # The cap's selection, exercised: this match records at most 16 players a keyframe (the default cap is 40).
    await pg.evaluate(f'(() => {{ const r = {G}.app.match.recorder; r.maxP = 16; for (const f of r.frames) f.at = -1; r.count = 0; }})()')
    if name == 'zm':
        horde = await pg.evaluate(ZM20)
        print(f'    horde {horde}')
    else:
        await pg.wait_for_function(f'{G}.app.match.interp.newest.br?.plane?.f > 0.25', timeout=60000)
        await pg.evaluate(f"{G}.app.match.brCommand('jump')")
    await pg.wait_for_timeout(9000)
    rec = await pg.evaluate(REC)
    s = rec['s']
    print(f"    {rec['players']} in the view, {rec['maxN']} per keyframe at most (cap {rec['cap']}), {rec['cast']} seen; "
          f"recorder mean {1000 * s['totalMs'] / max(1, s['frames']):.1f} us/frame, keyframe {1000 * s['keyMs'] / max(1, s['keyframes']):.1f} us, worst {s['maxMs']:.2f} ms")
    check(f'{name}: keyframes capped (cap lowered to 16 for the test)', rec['maxN'] <= rec['cap'] == 16 and rec['maxN'] > 0 and rec['players'] > 16, rec)
    check(f'{name}: you are always in the record', rec['mine'], rec)
    check(f'{name}: recorder per-frame cost under 0.5 ms mean', s['totalMs'] / max(1, s['frames']) < 0.5, s)
    await pg.evaluate(f"(() => {{ const sim = {G}.app.match.sim, me = sim.byId.get({G}.app.match.localId); const o = sim.players.find(p => p.team !== me.team); sim._end(o ? o.team : null); }})()")
    await to_results(pg, 60000)
    has = await pg.locator('[data-act="resReplay"]').count() == 1
    check(f'{name}: Watch replay on the results', has)
    if has:
        await pg.locator('[data-act="resReplay"]').click()
        await pg.wait_for_timeout(3000)
        rp = await pg.evaluate(RP)
        check(f'{name}: replay plays', rp and rp['c'] > 0.5, rp and rp['c'])
        await pg.evaluate(f"{G}.app.renderer.setQuality('low')")     # As docs/BR-PERF.md and dev/ui-sweep-perf.py measure.
        # The overview against the follow camera at fixed points on the map, playback paused (bug sweep 2026-11-22: the
        # old check compared the two cameras wherever the record happened to be, so a busy spot failed it). The follow
        # camera is held on each point by giving the clip a local id nobody has, so it keeps the target it is given.
        cams = await pg.evaluate(f"""(async () => {{ const v = {G}.replay(), m = v.map, out = [];
          v.setPlaying(false); const me = v.clip.localId; v.clip.localId = '__fixed__';
          const frames = async () => {{ for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r)); await new Promise(r => setTimeout(r, 300)); }};
          const read = async () => {{ let c = 0, t = 0; for (let i = 0; i < 3; i++) {{ await frames(); const s = {G}.app.renderer.getStats(); c = Math.max(c, s.calls); t = Math.max(t, s.triangles); }} return [c, t]; }};
          for (const [fx, fz] of [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]]) {{
            const x = m.width * fx, z = m.height * fz;
            v.setCam('me'); v.follow.x = x; v.follow.z = z; v.follow.ok = true; v.snap = true;
            const f = await read();
            v.setCam('free'); v.pan.x = x; v.pan.z = z; v.snap = true;
            const o = await read();
            out.push({{ at: [Math.round(x), Math.round(z)], follow: f, over: o }});
          }}
          v.clip.localId = me; v.setCam('free'); v.setPlaying(true);
          return out; }})()""")
        for c in cams:
            print(f"    low, fixed {c['at']}: follow {c['follow'][0]} calls {c['follow'][1]} tris; overview {c['over'][0]} calls {c['over'][1]} tris")
        fsum, osum = sum(c['follow'][1] for c in cams), sum(c['over'][1] for c in cams)
        ocalls = max(c['over'][0] for c in cams)
        check(f'{name}: overview under 64 calls and 2.5x the follow camera\'s triangles at five fixed points', ocalls < 64 and osum < 2.5 * max(fsum, 5 * 20000), (ocalls, osum, fsum))
        await pg.screenshot(path=f'/tmp/replay-{name}.png')
        rp = await pg.evaluate(RP)
        s = rp['stats']
        print(f"    playback mean {s['totalMs'] / max(1, s['frames']):.1f} ms per frame (renderer {s['renderMs'] / max(1, s['frames']):.1f}), worst {s['maxMs']:.1f} ms")
        sv = await pg.evaluate(f"{G}.clips.saveClip({G}.replay().clip).then(r => r)")
        clips = await pg.evaluate(f'{G}.clips.listClips()')
        check(f'{name}: clip saves under the size cap', sv['ok'], sv)
        if clips: print(f"    stored clip: {clips[0]['bytes'] // 1024} KB")
        for c in clips: await pg.evaluate(f'{G}.clips.deleteClip("{c["id"]}")')
        await pg.locator('.rp-close').click()
    await pg.close()


async def cap(ctx):
    print('Cap')
    pg = await boot(ctx, f'http://localhost:{PORT}/?debug=1&map=railyard&mode=tdm&time=8&limit=500')
    await start_custom(pg)
    await to_results(pg)
    await pg.locator('[data-act="resReplay"]').click()
    await pg.wait_for_timeout(800)
    for c in await pg.evaluate(f'{G}.clips.listClips()'): await pg.evaluate(f'{G}.clips.deleteClip("{c["id"]}")')     # A part before may have left one.
    res = await pg.evaluate(f"""(async () => {{ const v = {G}.replay(), out = [];
      for (let i = 0; i < 5; i++) out.push((await {G}.clips.saveClip({{ ...v.clip, at: v.clip.at + i }})).ok);
      return out; }})()""")
    check('five clips save', all(res), res)
    await pg.locator('.rp-save').click()
    await pg.wait_for_timeout(800)
    toast = await pg.locator('.rp-toast').inner_text()
    check('a sixth is refused with the 5 clips message', '5 clips' in toast and len(await pg.evaluate(f'{G}.clips.listClips()')) == 5, toast)
    for c in await pg.evaluate(f'{G}.clips.listClips()'): await pg.evaluate(f'{G}.clips.deleteClip("{c["id"]}")')
    await pg.close()


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=ARGS)
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            for name, fn in [('tdm', tdm), ('pad', pad), ('cap', cap), ('br', lambda c: busy(c, 'br', 'frontier', 'br')), ('zm', lambda c: busy(c, 'zm', 'ashgrove', 'zm'))]:
                if ONLY and name not in ONLY: continue
                try: await fn(ctx)
                except Exception as e: check(f'{name} ran', False, repr(e)[:300])
            await browser.close()
    finally:
        srv.kill()
    bad = [e for e in errors if 'favicon' not in e and 'WebGL' not in e and 'GPU stall' not in e]
    check('no console errors', not bad, bad[:6])
    print('\nFAILURES:\n  ' + '\n  '.join(failures) if failures else '\nall ok')
    sys.exit(1 if failures else 0)


asyncio.run(main())
