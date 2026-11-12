#!/usr/bin/env python3
"""Voice chat options (roadmap item 28) with a fake room: push to talk, per-player mute, speaking marks, lobby voice.

Run from anywhere: python3 dev/ui-voice-test.py [port]. It serves the repo itself and, in one page, builds a real Voice
(js/net/voice.js) on a fake Trystero room whose peer connections report RTP audio levels, with getUserMedia stubbed:
  PTT         Options' Mic chip switches to push to talk; a hold of the lobby mic sends (track enabled), release stops
  Open mic    a tap turns the mic on and it stays on
  Lobby       party voice reaches every human in the lobby; each other player's car has a mute plate; a tap mutes that
              player's audio element only; a player heard above the floor gets the talking mark
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8337))
failures, errors = [], []


def check(name, ok, info=''):
    print(f'  {name:<58} {"ok" if ok else "FAIL"} {info}')
    if not ok: failures.append(f'{name}: {info}')


SETUP = """(async () => {
  const { Voice } = await import('./js/net/voice.js');
  const g = window.__game;
  // A microphone that always says yes.
  window.__track = { kind: 'audio', enabled: true, stop() { this.stopped = true; } };
  navigator.mediaDevices.getUserMedia = async () => ({ getAudioTracks: () => [window.__track], getTracks: () => [window.__track] });
  // Two friends in the room; each sends a stream whose receiver reports a level the test sets.
  window.__levels = { ann: 0, bob: 0 };
  const ac = new AudioContext();
  window.__streams = { ann: ac.createMediaStreamDestination().stream, bob: ac.createMediaStreamDestination().stream };
  const recv = id => { const track = window.__streams[id].getAudioTracks()[0]; return { track, getSynchronizationSources: () => [{ audioLevel: window.__levels[id], timestamp: performance.now() }] }; };
  const peers = { 'tid-ann': { getReceivers: () => [window.__recv.ann], getSenders: () => [] }, 'tid-bob': { getReceivers: () => [window.__recv.bob], getSenders: () => [] } };
  window.__recv = { ann: recv('ann'), bob: recv('bob') };
  const room = { onPeerStream: null, getPeers: () => peers, addStream: async () => {}, removeStream: () => {} };
  const net = { room, localId: 'me', peers: ['ann', 'bob'], playerIdOf: t => t.replace('tid-', ''), transportIdOf: id => 'tid-' + id,
    onPeerLeave() {}, onPeerJoin() {} };
  const voice = new Voice({ net, audio: null, onState: () => {} });
  voice.setMode(g.Options.get('voiceMode'));
  g.app.voice = voice;
  voice.setTeammates(['ann', 'bob']);
  for (const id of ['ann', 'bob']) room.onPeerStream(window.__streams[id], 'tid-' + id);
  g.menu.lobby({ code: 'VOX1', humans: [
    { id: 'me', name: 'Tester', team: 0, ready: true, host: true }, { id: 'ann', name: 'Ann', team: 0, ready: true }, { id: 'bob', name: 'Bob', team: 1, ready: false },
  ], botSkill: 'mixed', isHost: true, localId: 'me', hostId: 'me', voice: true });
  return true;
})()"""


async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome')
            ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
            await pg.goto(f'http://localhost:{PORT}/?debug=1&net=local')
            await pg.wait_for_timeout(900)
            await pg.evaluate("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
            await pg.reload()
            await pg.wait_for_timeout(1200)

            print('Options')
            await pg.locator('[data-act="options"]').first.tap()
            await pg.wait_for_timeout(400)
            chip = lambda: pg.evaluate("document.querySelector('.opt-voicemode b').textContent")
            check('the Mic chip starts on Open', await chip() == 'Open', await chip())
            await pg.locator('.opt-voicemode').tap()
            await pg.wait_for_timeout(150)
            check('a tap switches it to Hold to talk (saved)', await chip() == 'Hold to talk' and await pg.evaluate("window.__game.Options.get('voiceMode')") == 'ptt')

            print('Lobby, push to talk')
            await pg.evaluate(SETUP)
            await pg.wait_for_timeout(400)
            v = "window.__game.app.voice"
            mic = lambda: pg.evaluate("(() => { const b = document.querySelector('.lb-mic'); return b ? [b.dataset.state, b.textContent.trim()] : null; })()")
            m = await mic()
            check('lobby mic shows Hold to talk', m and m[0] == 'ptt' and 'Hold to talk' in m[1], m)
            check('party voice goes to everyone in the lobby', await pg.evaluate(f"[...{v}.teammates].sort().join()") == 'ann,bob')
            box = await pg.locator('.lb-mic').bounding_box()
            cdp = await ctx.new_cdp_session(pg)
            pt = {'x': box['x'] + box['width'] / 2, 'y': box['y'] + box['height'] / 2, 'id': 1}
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [pt]})
            await pg.wait_for_timeout(300)
            held = await pg.evaluate(f"[{v}.state, {v}.talking, window.__track.enabled, {v}.shownState]")
            m = await mic()
            check('holding the mic sends (track enabled, Talking)', held[0] == 'on' and held[1] and held[2] and m[0] == 'on', [held, m])
            spk = await pg.evaluate(f"[...{v}.speaking()]")
            check('you count as speaking while you hold', 'me' in spk, spk)
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            await pg.wait_for_timeout(300)
            rel = await pg.evaluate(f"[{v}.state, {v}.talking, window.__track.enabled, {v}.shownState]")
            check('release stops sending; the capture stays ready', rel[0] == 'on' and not rel[1] and not rel[2] and rel[3] == 'ptt', rel)

            print('Lobby, mute and speaking')
            mutes = await pg.evaluate("[...document.querySelectorAll('.car-mute')].map(b => [b.dataset.voiceMute, b.hidden])")
            check('a mute plate on each other player, none on you', sorted(mutes) == [['ann', False], ['bob', False]], mutes)
            await pg.locator('.car-mute[data-voice-mute="bob"]').tap()
            await pg.wait_for_timeout(300)
            st = await pg.evaluate(f"""(() => {{ const v = {v}; return {{ bob: v.players.get('bob').el.muted, ann: v.players.get('ann').el.muted, plate: document.querySelector('.car-mute[data-voice-mute="bob"]').classList.contains('on') }}; }})()""")
            check('muting Bob silences only Bob', st['bob'] and not st['ann'] and st['plate'], st)
            await pg.evaluate("window.__levels.ann = 0.3; window.__levels.bob = 0.3")
            await pg.wait_for_timeout(400)
            talk = await pg.evaluate("[...document.querySelectorAll('.car-cell.talking')].map(c => c.dataset.voice)")
            check('Ann talking gets the mark; muted Bob does not', talk == ['ann'], talk)
            dot = await pg.evaluate("getComputedStyle(document.querySelector('.car-cell[data-voice=\"ann\"] .vc-dot')).display")
            check('the talking dot shows beside the name', dot != 'none', dot)
            await pg.evaluate("window.__levels.ann = 0")
            await pg.wait_for_timeout(800)
            check('the mark clears when Ann stops', await pg.evaluate("document.querySelectorAll('.car-cell.talking').length") == 0)
            await pg.locator('.car-mute[data-voice-mute="bob"]').tap()
            await pg.wait_for_timeout(250)
            check('a second tap unmutes Bob', not await pg.evaluate(f"{v}.players.get('bob').el.muted"))

            print('Open mic')
            await pg.evaluate(f"window.__game.Options.set('voiceMode', 'open')")
            await pg.wait_for_timeout(250)
            check('switching modes quiets the mic', await pg.evaluate(f"{v}.state") == 'off')
            await pg.locator('.lb-mic').tap()
            await pg.wait_for_timeout(400)
            om = await pg.evaluate(f"[{v}.state, window.__track.enabled]")
            m = await mic()
            check('a tap turns the open mic on, and it stays on', om == ['on', True] and m[0] == 'on' and 'Mic on' in m[1], [om, m])
            await pg.locator('.lb-mic').tap()
            await pg.wait_for_timeout(300)
            check('a second tap turns it off', await pg.evaluate(f"{v}.state") == 'off')
            await browser.close()
    finally:
        srv.kill()
    bad = [e for e in errors if 'favicon' not in e]
    check('no console errors', not bad, bad[:3])
    print(f'\n{len(failures)} failure(s)')
    sys.exit(1 if failures else 0)


asyncio.run(main())
