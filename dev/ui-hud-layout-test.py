#!/usr/bin/env python3
"""In-match HUD layout (css/hud.css, js/ui/hud.js layout): python3 dev/ui-hud-layout-test.py [port] [--only m1,m2]
[--sizes 640x360,...] [--shots DIR] [--quick]

Serves the repo, then starts one match per mode through the debug hooks (?debug=1&map=&mode= and the Custom button,
window.__game.training/range/tutorial) and, for every screen size, both hands (Options lefty) and every HUD size
(Options hudSize, applied live), checks the screen as it stands:

  zone      a HUD panel overlaps the move stick's or the aim stick's resting circle (Controls.zones: they follow the
            move stick size, the fire ring and the sensitivity)
  button    a HUD panel overlaps an action button's touch rect (slide, swap, tactical, lethal) or the chat button
  overlap   two HUD panels overlap each other
  cut       a HUD panel reaches past the edge of the screen
  target    a streak tile's touch rect is under 44 px

Panels: the score bar, every objective strip row, the minimap, the kill feed (filled to its three rows), the corner
chips, the weapon panel, health, the streak tiles, the battle royale's kit and squad panels, extraction's squad panel,
the modifiers, the range's Leave, prompts in the lane, the tutorial's card and Skip, and on the death screen its card,
Next life, Respawn and the wait plate. Then it dies once per size (killcam, then the death screen) and checks again.
Battle royale is checked on the ground, with both hands full and a ground gun in reach (the Take prompt).
Screenshots at 667x375, 852x393 and 932x430, plus left-handed and Large samples, go to DIR (default /tmp/hud).
Fails (exit 1) on any finding or console error. Ports 8401-8409 are the HUD's; the default is 8405.
"""
import asyncio, subprocess, sys, os, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
PORT = int(args[0]) if args and args[0].isdigit() else 8405
def opt(name, default):
    return args[args.index(name) + 1] if name in args else default
SIZES = [tuple(map(int, s.split('x'))) for s in opt('--sizes', '640x360,667x375,852x393,932x430,956x440').split(',')]
SHOTS = opt('--shots', '/tmp/hud')
QUICK = '--quick' in args
GL = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game'

# (map, mode): the standard modes on a medium map, Ground War on a huge one, battle royale and extraction on Frontier.
MATCHES = [
    ('topside', 'tdm'), ('topside', 'dom'), ('topside', 'kc'), ('topside', 'hard'), ('topside', 'snd'), ('topside', 'ctf'),
    ('topside', 'ffa'), ('topside', 'gun'), ('topside', 'hq'), ('topside', 'ko'), ('topside', 'inf'), ('topside', 'oic'),
    ('topside', 'ctl'), ('topside', 'grind'),
    ('harvest', 'gwtdm'), ('harvest', 'gwdom'), ('harvest', 'gwhq'), ('harvest', 'gwko'), ('harvest', 'gwinf'),
    ('frontier', 'br'), ('frontier', 'brduo'), ('frontier', 'brsolo'), ('frontier', 'exq'), ('frontier', 'exd'),
    ('neon', 'zm'),
    ('', 'training'), ('', 'range'), ('', 'tutorial'),
]
ONLY = opt('--only', '')
if ONLY: MATCHES = [m for m in MATCHES if m[1] in ONLY.split(',')]
SHOT_SIZES = {(667, 375), (852, 393), (932, 430)}

CHECK = r"""
(phase) => {
  const g = window.__game, hud = g.hud, ctl = g.controls, W = innerWidth, H = innerHeight, out = [];
  const shown = el => {
    if (!el || !el.getClientRects().length) return false;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
    }
    return true;
  };
  const panels = [];
  const add = (name, el, why = '') => {
    if (!shown(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    panels.push({ name, r: { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } });
  };
  const q = s => hud.el.querySelector(s), qa = s => [...hud.el.querySelectorAll(s)];
  const anyShown = el => el && [...el.children].some(shown);
  add('scorebar', q('.scorebar'));
  for (const row of qa('.os-row')) if (anyShown(row)) add(`strip row ${row.dataset.row}`, row);
  add('minimap', q('.minimap'));
  if (q('.feed').children.length) add('feed', q('.feed'));
  if (anyShown(q('.corner'))) add('corner', q('.corner'));
  add('weapon panel', q('.arms'));
  add('health', q('.vitals'));
  const row = ctl.el.querySelector('.stk-row');
  if ([...row.children].some(shown)) add('streak tiles', row);
  add('battle royale kit', q('.br-inv'));
  for (const s of ['.br-squad', '.ex-squad']) if (anyShown(q(s))) add('squad panel', q(s));
  add('modifiers', q('.mh-mods'));
  add('leave range', q('.range-leave'));
  for (const s of ['.br-take', '.snd-carry', '.ctf-carry', '.snd-spec', '.br-jump-main', '.br-hint', '.br-down', '.ex-down', '.br-out']) add(s.slice(1), q(s));
  if (anyShown(q('.ex-acts'))) add('ex-acts', q('.ex-acts'));
  add('tutorial card', document.querySelector('.tut-card'));
  add('perf overlay', document.querySelector('.perf'));
  add('tutorial skip', document.querySelector('.tut-skip'));
  if (phase === 'dead') for (const s of ['.death-card', '.death-next', '.death-timer', '.mh-wait']) add(s.slice(1), q(s));
  const chat = q('.qc-btn');
  const inter = (a, b, pad = 0) => a.x0 < b.x1 - pad && b.x0 < a.x1 - pad && a.y0 < b.y1 - pad && b.y0 < a.y1 - pad;
  const live = ctl.el.classList.contains('live') && !ctl.el.classList.contains('down-state');
  const zones = live && ctl.zones ? [['move stick', ctl.zones.move], ['aim stick', ctl.zones.aim]] : [];
  const buttons = live ? ['slide', 'swap', 'tactical', 'lethal'].filter(b => shown(ctl.buttons[b])).map(b => [b, ctl.rects[b]]) : [];
  if (shown(chat)) { const r = chat.getBoundingClientRect(); buttons.push(['chat', { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }]); }
  const round = r => `${Math.round(r.x0)},${Math.round(r.y0)} ${Math.round(r.x1 - r.x0)}x${Math.round(r.y1 - r.y0)}`;
  for (const p of panels) {
    const r = p.r;
    if (r.x0 < -1 || r.y0 < -1 || r.x1 > W + 1 || r.y1 > H + 1) out.push(`cut: ${p.name} [${round(r)}]`);
    for (const [n, c] of zones) {
      const nx = Math.max(r.x0, Math.min(c.x, r.x1)), ny = Math.max(r.y0, Math.min(c.y, r.y1));
      if (Math.hypot(nx - c.x, ny - c.y) < c.r - 1) out.push(`zone: ${p.name} [${round(r)}] on the ${n}`);
    }
    for (const [n, b] of buttons) {
      if (n === 'chat' && p.name === 'corner') continue;
      if (inter(r, b, 1)) out.push(`button: ${p.name} [${round(r)}] on ${n} [${round(b)}]`);
    }
  }
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    if (inter(panels[i].r, panels[j].r, 1)) out.push(`overlap: ${panels[i].name} [${round(panels[i].r)}] and ${panels[j].name} [${round(panels[j].r)}]`);
  }
  // Kill feed rows: nothing may run out of its row (once a fresh row's slide-in is over).
  for (const row of qa('.feed .f-row')) row.getAnimations().forEach(a => a.finish());
  for (const row of qa('.feed .f-row')) {
    const rr = row.getBoundingClientRect(), fr = q('.feed').getBoundingClientRect();
    if (rr.right > fr.right + 1 || rr.left < fr.left - 1) out.push(`cut: feed row wider than the feed (${Math.round(rr.width)})`);
    for (const c of row.querySelectorAll('*')) { const r = c.getBoundingClientRect(); if (r.width && (r.right > rr.right + 1 || r.left < rr.left - 1)) { out.push(`cut: feed row text runs out of its row (${c.className || c.tagName})`); break; } }
  }
  if (live) ctl.tiles.forEach((t, i) => {
    const r = ctl.rects[`tile${i}`];
    if (shown(t.node) && r && (r.x1 - r.x0 < 44 || r.y1 - r.y0 < 44)) out.push(`target: streak tile ${i} is ${Math.round(r.x1 - r.x0)}x${Math.round(r.y1 - r.y0)}`);
  });
  return out;
}
"""

# A full kill feed: three rows of long names, as a busy 16v16 match leaves it.
FILL_FEED = f"""(() => {{ const h = {G}.hud;
  // Every kind of row with the longest names (the feed keeps the newest three): a kill, a note on its own, an
  // infection, a VIP kill.
  h.pushFeed('<em>LongestNameHere0</em><span class="f-w">FOREMAN</span><em>AnotherLongName</em>', false, 'foe');
  h.pushFeed('<span class="f-note">[CLAN] ExtremelyLongPlayerName took over as host of this very match</span>');
  h.pushFeed('<span class="f-ico"><svg width="13" height="13"></svg></span><em>ExtremelyLongPlayerName</em><span class="f-note">was infected</span>', false, 'foe');
  h.pushFeed('<span class="f-ico"><svg width="13" height="13"></svg></span><em>ExtremelyLongPlayerName</em><span class="f-note">killed VIP</span><em>AnotherVeryLongName</em>', true, 'ally');
  }})()"""
SAFE = f"""(() => {{ const m = {G}.app.match, me = m?.sim?.byId.get(m.localId); if (me) me.spawnProtect = 9999; }})()"""


async def start(pg, mp, mode):
    url = f'http://localhost:{PORT}/?debug=1&bots=recruit' + (f'&map={mp}&mode={mode}' if mp else '')
    await pg.goto(url)
    await pg.wait_for_timeout(700)
    await pg.evaluate(f"{G}.Progress.name='Tester'; {G}.Progress.setFlag('tutorialOffered'); {G}.Options.set('lefty', false); {G}.Options.set('hudSize', 'normal'); {G}.Options.set('fps', true)")
    await pg.reload()
    await pg.wait_for_timeout(1000)
    if mode == 'tutorial': await pg.evaluate(f'{G}.tutorial()')
    elif mode == 'training': await pg.evaluate(f'{G}.training()')
    elif mode == 'range': await pg.evaluate(f'{G}.range()')
    else: await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_function(f'{G}.app.match?.interp.newest?.phase === "live"', timeout=90000)
    if mode.startswith('br'):
        await pg.wait_for_timeout(1500)
        await pg.locator('.br-jump-map').click(timeout=30000)
        await pg.wait_for_function(f'{G}.app.match.brAir === 0', timeout=90000)
        # The squad lands too (a teammate in the air takes no damage, so the squad panel's states would not show).
        await pg.wait_for_function(f'(() => {{ const m = {G}.app.match, sim = m.sim, me = sim.byId.get(m.localId); return sim.players.every(p => p.team !== me.team || !p.brAir); }})()', timeout=90000)
        # Both hands full and a rare gun at your feet: the hand slots and the Take prompt.
        await pg.evaluate(f"""(() => {{ const m = {G}.app.match, sim = m.sim, me = sim.byId.get(m.localId);
          for (let s = 0; s < 2; s++) if (!me.br.guns[s]) sim.br._takeGun(me, sim.br._addItem({{ kind: 0, v: 0, r: 1, n: 1, x: m.ps.x, z: m.ps.z }}), s);
          me.br.plates = 3;
          for (const it of sim.br.near(m.ps.x, m.ps.z, 4)) if (it.kind === 0) sim.br._removeItem(it);
          sim.br._addItem({{ kind: 0, v: 2, r: 4, n: 1, x: m.ps.x + 0.3, z: m.ps.z }}); }})()""")
    if mode.startswith('br') or mode.startswith('ex'):
        # A squad in every state: one teammate out, one down (the squad panel's tags).
        await pg.evaluate(f"""(() => {{ const m = {G}.app.match, sim = m.sim, me = sim.byId.get(m.localId);
          const mates = sim.players.filter(p => p.team === me.team && p.id !== me.id), foe = sim.players.find(p => p.team !== me.team);
          if (mates[0]) {{ mates[0].spawnProtect = 0; sim._damage(mates[0], foe, 900, 'ar', 8); sim._damage(mates[0], foe, 900, 'ar', 8); }}
          if (mates[1]) {{ mates[1].spawnProtect = 0; sim._damage(mates[1], foe, 900, 'ar', 8); }} }})()""")
    await pg.evaluate(SAFE)
    await pg.wait_for_timeout(2500)


async def sweep(pg, mode, phase, failures, shots):
    for (w, h) in SIZES:
        await pg.set_viewport_size({'width': w, 'height': h})
        await pg.wait_for_timeout(350)
        combos = [(False, 'normal')] if QUICK else [(l, s) for l in (False, True) for s in ('small', 'normal', 'large')]
        if phase in ('dead', 'out'): combos = [(False, 'normal'), (True, 'normal')]
        for lefty, size in combos:
            await pg.evaluate(f"{G}.Options.set('lefty', {'true' if lefty else 'false'}); {G}.Options.set('hudSize', '{size}')")
            if phase == 'live': await pg.evaluate(FILL_FEED)
            await pg.wait_for_timeout(160)
            found = await pg.evaluate(CHECK, phase)
            tag = f"{mode} {phase} {w}x{h} {'left' if lefty else 'right'} {size}"
            for f in found: failures.append(f'{tag}: {f}')
            if shots and (w, h) in SHOT_SIZES:
                name = None
                if not lefty and size == 'normal': name = f'{mode}-{phase}-{w}x{h}'
                elif lefty and size == 'normal' and (w, h) == (852, 393): name = f'{mode}-{phase}-{w}x{h}-lefty'
                elif not lefty and size == 'large' and (w, h) == (667, 375): name = f'{mode}-{phase}-{w}x{h}-large'
                if name: await pg.screenshot(path=f'{SHOTS}/{name}.png')
    await pg.evaluate(f"{G}.Options.set('lefty', false); {G}.Options.set('hudSize', 'normal')")


async def die(pg, mode):
    """Killed by a bot: the killcam (shot), then its Skip, then the death screen."""
    ok = await pg.evaluate(f"""(() => {{ const m = {G}.app.match, sim = m.sim, me = sim.byId.get(m.localId);
      const bot = sim.players.find(p => p.team !== me.team && p.isBot) ?? sim.players.find(p => p.id !== me.id);
      if (!me || !bot) return false; me.spawnProtect = 0; sim._damage(me, bot, 900, 'ar', 8); return !me.alive; }})()""")
    return ok


async def run(browser, mp, mode, failures, errors):
    ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{mode}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'{mode}: PAGEERR {e}'))
    try:
        await start(pg, mp, mode)
        await sweep(pg, mode, 'live', failures, True)
        if mode in ('br', 'exq'):
            # Out of it and watching a teammate: the out plate on the bottom edge, no weapon panel.
            await pg.set_viewport_size({'width': 852, 'height': 393})
            await pg.evaluate(f"""(() => {{ const m = {G}.app.match, sim = m.sim, me = sim.byId.get(m.localId), foe = sim.players.find(p => p.team !== me.team);
              const R = sim.rules; if (R?.squadOf) {{ const sq = R.squadOf(me); if (sq) sq.lives = 0; R._dirty?.(); }}
              me.spawnProtect = 0; for (let i = 0; i < 3 && me.alive; i++) sim._damage(me, foe, 900, 'ar', 8); }})()""")
            await pg.wait_for_timeout(3500)
            await pg.evaluate("document.querySelector('.killcam-skip')?.click()")
            await pg.wait_for_timeout(1500)
            await sweep(pg, mode, 'out', failures, True)
        if mode not in ('training', 'range', 'tutorial') and not mode.startswith('br') and not mode.startswith('ex'):
            await pg.set_viewport_size({'width': 852, 'height': 393})
            if await die(pg, mode):
                await pg.wait_for_timeout(700)
                if await pg.locator('.killcam-skip.on').count():
                    await pg.screenshot(path=f'{SHOTS}/{mode}-killcam-852x393.png')
                    await pg.evaluate("document.querySelector('.killcam-skip')?.click()")
                await pg.wait_for_timeout(900)
                await sweep(pg, mode, 'dead', failures, True)
    except Exception as e:
        failures.append(f'{mode}: {type(e).__name__}: {str(e)[:200]}')
    await ctx.close()


async def main():
    os.makedirs(SHOTS, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await asyncio.sleep(1)
    failures, errors = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=GL)
            for mp, mode in MATCHES:
                n = len(failures)
                await run(browser, mp, mode, failures, errors)
                print(f'{mode}: {"ok" if len(failures) == n else f"{len(failures) - n} findings"}', flush=True)
                for f in failures[n:]: print('  ', f, flush=True)
            await browser.close()
    finally:
        srv.terminate()
    errors = [e for e in errors if 'GL Driver' not in e]
    print('console errors:', errors[:8] or 'none')
    if failures or errors:
        print(f'FAILED: {len(failures)} findings')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
