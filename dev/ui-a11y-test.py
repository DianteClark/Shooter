#!/usr/bin/env python3
"""Accessibility (docs/ACCESSIBILITY.md): python3 dev/ui-a11y-test.py [port] [--shots DIR]

Serves the repo on the port (default 8475), then checks:
  colour    every colour mode changes the palette: the CSS tokens on the root, TEAMS and battle royale rarity, and in a
            match the renderer's shared team colours, the enemy ring shape uniform and a HUD element that uses them
  editor    Options > Accessibility > Edit layout: a drag moves Slide, a drop on another control is pushed clear, the
            plus button resizes, Save writes Options.layout; Reset clears it
  match     the saved layout applies in a match (Slide where it was dropped and at its size, the streak tiles placed and
            out of the dock) with no HUD panel on a stick, a button or another panel, inside the safe area
  lefty     left-handed with the same custom layout: the placed controls mirror, the HUD checks still pass
  calm      Reduce shake and flashes: the flag on the root, the dark flashbang veil, the motion scale
  cues      the grenade marker shows for an enemy grenade near the player and points at it; steps only on 'all'
  title     the title's emote row, open, fits beside the Join and Browse buttons at 640-956 px wide
Screenshots go to DIR (default /tmp/a11y). Fails (exit 1) on any finding or console error.
"""
import asyncio, subprocess, sys, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
PORT = int(args[0]) if args and args[0].isdigit() else 8475
SHOTS = args[args.index('--shots') + 1] if '--shots' in args else '/tmp/a11y'
GL = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game'
fails, errors = [], []


def check(cond, msg):
    if not cond: fails.append(msg)
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)


async def fresh(ctx, query=''):
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERR {e}'))
    url = f'http://localhost:{PORT}/?debug=1{query}'
    await pg.goto(url)
    await pg.wait_for_function(f'!!({G} && {G}.Progress)', timeout=40000)
    await pg.evaluate(f"{G}.Progress.name='Tester'; {G}.Progress.setFlag('tutorialOffered'); {G}.Options.set('fps', false)")
    await pg.reload()
    await pg.wait_for_function(f'!!({G} && {G}.Progress)', timeout=40000)
    await pg.wait_for_timeout(900)
    return pg


async def start_match(pg):
    await pg.locator('[data-act="custom"]').first.click()
    await pg.wait_for_function(f'{G}.app.match?.interp.newest?.phase === "live"', timeout=90000)
    await pg.evaluate(f"(() => {{ const m = {G}.app.match, me = m?.sim?.byId.get(m.localId); if (me) me.spawnProtect = 9999; }})()")
    await pg.wait_for_timeout(1500)


# The HUD layout test's panel checks (dev/ui-hud-layout-test.py), trimmed: panels against the sticks, the buttons
# (and placed streak tiles) and each other, and the screen's edge.
HUD_CHECK = r"""
() => {
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
  const add = (name, el) => { if (!shown(el)) return; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return; panels.push({ name, r: { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } }); };
  const q = s => hud.el.querySelector(s);
  const anyShown = el => el && [...el.children].some(shown);
  add('scorebar', q('.scorebar'));
  for (const row of hud.el.querySelectorAll('.os-row')) if (anyShown(row)) add(`strip row ${row.dataset.row}`, row);
  add('minimap', q('.minimap'));
  if (q('.feed').children.length) add('feed', q('.feed'));
  if (anyShown(q('.corner'))) add('corner', q('.corner'));
  add('weapon panel', q('.arms'));
  add('health', q('.vitals'));
  const tiles = ctl.el.querySelector('.stk-row'), placed = ctl.el.querySelector('.streaks').classList.contains('placed');
  if (!placed && [...tiles.children].some(shown)) add('streak tiles', tiles);
  const inter = (a, b, pad = 0) => a.x0 < b.x1 - pad && b.x0 < a.x1 - pad && a.y0 < b.y1 - pad && b.y0 < a.y1 - pad;
  const zones = [['move stick', ctl.zones.move], ['aim stick', ctl.zones.aim]];
  const buttons = ['slide', 'swap', 'tactical', 'lethal'].filter(b => shown(ctl.buttons[b])).map(b => [b, ctl.rects[b]]);
  if (placed) { const r = tiles.getBoundingClientRect(); buttons.push(['placed tiles', { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }]); }
  const round = r => `${Math.round(r.x0)},${Math.round(r.y0)} ${Math.round(r.x1 - r.x0)}x${Math.round(r.y1 - r.y0)}`;
  for (const p of panels) {
    const r = p.r;
    if (r.x0 < -1 || r.y0 < -1 || r.x1 > W + 1 || r.y1 > H + 1) out.push(`cut: ${p.name} [${round(r)}]`);
    for (const [n, c] of zones) {
      const nx = Math.max(r.x0, Math.min(c.x, r.x1)), ny = Math.max(r.y0, Math.min(c.y, r.y1));
      if (Math.hypot(nx - c.x, ny - c.y) < c.r - 1) out.push(`zone: ${p.name} [${round(r)}] on the ${n}`);
    }
    for (const [n, b] of buttons) if (inter(r, b, 1)) out.push(`button: ${p.name} [${round(r)}] on ${n} [${round(b)}]`);
  }
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++)
    if (inter(panels[i].r, panels[j].r, 1)) out.push(`overlap: ${panels[i].name} and ${panels[j].name}`);
  // Controls: inside the screen, and no two buttons (with the placed tiles) on each other.
  for (const [n, b] of buttons) if (b.x0 < -9 || b.y0 < -9 || b.x1 > W + 9 || b.y1 > H + 9) out.push(`cut: control ${n} [${round(b)}]`);
  const vis = buttons.map(([n, b]) => [n, b]);
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i][1], b = vis[j][1];
    // Touch rects carry 8 px slop each side (3 for tiles); the faces themselves may not meet.
    if (inter(a, b, 9)) out.push(`controls: ${vis[i][0]} on ${vis[j][0]}`);
  }
  return out;
}
"""

CENTRE = "(sel => { const r = window.__game.controls.el.querySelector(sel).getBoundingClientRect(); return [ (r.left + r.right) / 2, (r.top + r.bottom) / 2, r.width, r.height ]; })"


async def colour_modes(browser):
    print('colour modes', flush=True)
    ctx = await browser.new_context(viewport={'width': 852, 'height': 393}, has_touch=True, is_mobile=True)
    pg = await fresh(ctx, '&bots=recruit&map=topside&mode=tdm')
    read = """async () => {
      const C = await import('/js/shared/constants.js'), M = await import('/js/shared/modes.js');
      const cs = getComputedStyle(document.documentElement);
      return { blue: cs.getPropertyValue('--c-blue').trim(), red: cs.getPropertyValue('--c-red').trim(), go: cs.getPropertyValue('--c-go').trim(),
        t0: C.TEAMS[0].css, t1: C.TEAMS[1].css, t2: C.TEAMS[2].css, t20: C.TEAMS[20].css, rare: M.BR.rarityCss[1], cb: document.documentElement.dataset.cb ?? 'off' };
    }"""
    seen = {}
    for mode in ['off', 'protan', 'deutan', 'tritan', 'contrast']:
        await pg.evaluate(f"{G}.Options.set('colorMode', '{mode}')")
        v = await pg.evaluate(read)
        seen[mode] = v
        check(v['cb'] == mode, f'colour {mode}: html[data-cb] is {v["cb"]}')
        check(v['blue'] == v['t0'] and v['red'] == v['t1'], f'colour {mode}: CSS tokens follow TEAMS ({v["blue"]} {v["red"]} / {v["t0"]} {v["t1"]})')
    base = seen['off']
    for mode in ['protan', 'deutan', 'tritan', 'contrast']:
        v = seen[mode]
        check((v['t0'], v['t1']) != (base['t0'], base['t1']), f'colour {mode}: team colours change ({v["t0"]}, {v["t1"]})')
        check(v['t2'] != base['t2'] and v['rare'] != base['rare'], f'colour {mode}: free-for-all and rarity colours change')
        check(v['t20'] != '', f'colour {mode}: squad colours past twelve are set')
    pairs = {(seen[m]['t0'], seen[m]['t1']) for m in seen}
    check(len(pairs) == 5, f'colour: the five modes are five palettes ({len(pairs)})')

    # In a match: the renderer's shared colours, the ring shape, a HUD element.
    await pg.evaluate(f"{G}.Options.set('colorMode', 'deutan')")
    await start_match(pg)
    m = await pg.evaluate(f"""(() => {{ const r = {G}.app.renderer, rgb = r.chars.teamRGB[1].map(v => Math.round(v * 255));
      const dmg = getComputedStyle(document.querySelector('.dmg-arc')).fill;
      return {{ rgb, shapes: r.chars.ringMat.uniforms.uShapes.value, same: r.chars.teamRGB === r.combat?.teamRGB || r.combat === undefined, dmg }}; }})()""")
    check(m['rgb'] == [0xff, 0xd2, 0x3a], f'colour in a match: renderer team 1 colour {m["rgb"]}')
    check(m['shapes'] == 1, 'colour in a match: enemy rings dashed (uShapes 1)')
    check('255, 210, 58' in m['dmg'] or '1 0.823529 0.227451' in m['dmg'], f'colour in a match: damage arc follows the palette ({m["dmg"]})')
    await pg.wait_for_timeout(400)
    await pg.screenshot(path=f'{SHOTS}/match-deutan.png')
    await pg.evaluate(f"{G}.Options.set('colorMode', 'off')")
    await pg.wait_for_timeout(100)
    m = await pg.evaluate(f"({G}.app.renderer.chars.teamRGB[1].map(v => Math.round(v * 255)))")
    check(m == [0xff, 0x4d, 0x3d], f'colour off mid-match: back to the usual red {m}')
    await ctx.close()


async def editor_and_match(browser):
    print('layout editor', flush=True)
    W, H = 852, 393
    ctx = await browser.new_context(viewport={'width': W, 'height': H}, has_touch=True, is_mobile=True)
    pg = await fresh(ctx, '&bots=recruit&map=topside&mode=tdm')
    await pg.evaluate(f"{G}.Options.set('layout', {{}}); {G}.Options.set('lefty', false)")
    await pg.locator('[data-act="options"]').first.click()
    await pg.wait_for_timeout(500)
    await pg.locator('[data-act="optA11y"]').click()
    await pg.wait_for_timeout(500)
    await pg.screenshot(path=f'{SHOTS}/a11y-screen.png')
    await pg.locator('[data-act="a11yLayout"]').click()
    await pg.wait_for_timeout(400)
    box = lambda sel: pg.evaluate(f"(() => {{ const r = document.querySelector('.lay-ed {sel}').getBoundingClientRect(); return [(r.left + r.right) / 2, (r.top + r.bottom) / 2, r.width]; }})()")
    sx, sy, sw = await box('.tbtn-slide')
    # Drag Slide to the lower middle of the aim side.
    tx, ty = 560, 300
    await pg.mouse.move(sx, sy); await pg.mouse.down()
    for i in range(1, 9): await pg.mouse.move(sx + (tx - sx) * i / 8, sy + (ty - sy) * i / 8)
    await pg.mouse.up()
    await pg.wait_for_timeout(100)
    nx, ny, _ = await box('.tbtn-slide')
    check(abs(nx - tx) < 6 and abs(ny - ty) < 6, f'editor: Slide dragged to ({nx:.0f},{ny:.0f}), wanted ({tx},{ty})')
    # Bigger twice.
    await pg.locator('.lay-bar [data-k="bigger"]').click(); await pg.locator('.lay-bar [data-k="bigger"]').click()
    _, _, w2 = await box('.tbtn-slide')
    check(abs(w2 / sw - 1.2) < 0.03, f'editor: Slide resized to {w2 / sw:.2f}x')
    # Swap dropped right on Slide is pushed clear of it.
    wx, wy, _ = await box('.tbtn-swap')
    await pg.mouse.move(wx, wy); await pg.mouse.down()
    for i in range(1, 9): await pg.mouse.move(wx + (tx - wx) * i / 8, wy + (ty - wy) * i / 8)
    await pg.mouse.up()
    await pg.wait_for_timeout(100)
    ov = await pg.evaluate("""(() => { const a = document.querySelector('.lay-ed .tbtn-slide').getBoundingClientRect(), b = document.querySelector('.lay-ed .tbtn-swap').getBoundingClientRect();
      return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; })()""")
    check(not ov, 'editor: Swap dropped on Slide is pushed clear')
    # The streak tiles to the left of the aim stick, a little up; and a drag into the HUD's top band stops under it.
    kx, ky, _ = await box('.stk-row')
    await pg.mouse.move(kx, ky); await pg.mouse.down()
    for i in range(1, 9): await pg.mouse.move(kx + (330 - kx) * i / 8, ky + (330 - ky) * i / 8)
    await pg.mouse.up()
    lx, ly, _ = await box('.tbtn-lethal')
    await pg.mouse.move(lx, ly); await pg.mouse.down()
    for i in range(1, 9): await pg.mouse.move(lx + (700 - lx) * i / 8, ly + (20 - ly) * i / 8)
    await pg.mouse.up()
    top = await pg.evaluate("document.querySelector('.lay-ed .tbtn-lethal').getBoundingClientRect().top")
    check(top >= 393 * 0.34 - 1, f'editor: a drag into the top band stops under it (top {top:.0f})')
    await pg.screenshot(path=f'{SHOTS}/editor-852.png')
    await pg.locator('.lay-bar [data-k="save"]').click()
    await pg.wait_for_timeout(200)
    lay = await pg.evaluate(f"{G}.Options.get('layout')")
    check(lay.get('slide', {}).get('s') == 1.2 and 'x' in lay.get('slide', {}), f'editor: Save writes Slide {lay.get("slide")}')
    check('x' in lay.get('swap', {}) and 'x' in lay.get('streaks', {}), 'editor: Save writes Swap and the streak tiles')
    note = await pg.locator('.a11y-lay-note').text_content()
    check(note.startswith('Custom'), f'editor: the screen says the layout is custom ("{note[:40]}")')

    print('custom layout in a match', flush=True)
    await pg.reload()
    await pg.wait_for_function(f'!!({G} && {G}.Progress)', timeout=40000)
    await pg.wait_for_timeout(800)
    await start_match(pg)
    cx, cy, cw, _ = await pg.evaluate(CENTRE + "('.tbtn-slide')")
    check(abs(cx - tx) < 8 and abs(cy - ty) < 8, f'match: Slide at ({cx:.0f},{cy:.0f}), saved at ({tx},{ty})')
    check(abs(cw / 74 - 1.2) < 0.04, f'match: Slide at its saved size ({cw / 74:.2f}x)')
    rect = await pg.evaluate(f"{G}.controls.rects.slide")
    check(abs((rect['x0'] + rect['x1']) / 2 - cx) < 2, 'match: the touch rect follows the placed Slide')
    placed = await pg.evaluate(f"{G}.controls.el.querySelector('.streaks').classList.contains('placed')")
    check(placed, 'match: the streak tiles are placed out of the dock')
    for (w, h) in [(852, 393), (667, 375), (956, 440)]:
        await pg.set_viewport_size({'width': w, 'height': h})
        await pg.wait_for_timeout(400)
        found = await pg.evaluate(HUD_CHECK)
        check(not found, f'match {w}x{h}: HUD clear of the custom layout {found[:3]}')
    await pg.set_viewport_size({'width': W, 'height': H})
    await pg.wait_for_timeout(400)
    await pg.screenshot(path=f'{SHOTS}/match-custom-852.png')

    print('left-handed with the custom layout', flush=True)
    await pg.evaluate(f"{G}.Options.set('lefty', true)")
    await pg.wait_for_timeout(400)
    lx, ly, _, _ = await pg.evaluate(CENTRE + "('.tbtn-slide')")
    check(abs(lx - (W - cx)) < 8 and abs(ly - cy) < 4, f'lefty: Slide mirrored to ({lx:.0f},{ly:.0f}) from ({cx:.0f},{cy:.0f})')
    zones = await pg.evaluate(f"{G}.controls.zones")
    check(zones['move']['x'] > W / 2 and zones['aim']['x'] < W / 2, 'lefty: the sticks swapped sides')
    for (w, h) in [(852, 393), (667, 375)]:
        await pg.set_viewport_size({'width': w, 'height': h})
        await pg.wait_for_timeout(400)
        found = await pg.evaluate(HUD_CHECK)
        check(not found, f'lefty {w}x{h}: HUD clear of the custom layout {found[:3]}')
    await pg.set_viewport_size({'width': W, 'height': H})
    await pg.wait_for_timeout(400)
    await pg.screenshot(path=f'{SHOTS}/match-custom-lefty-852.png')

    print('default layout back', flush=True)
    await pg.evaluate(f"{G}.Options.set('layout', {{}}); {G}.Options.set('lefty', false)")
    await pg.wait_for_timeout(300)
    dx, dy, dw, _ = await pg.evaluate(CENTRE + "('.tbtn-slide')")
    check(abs(dx - (W - 14 - 37)) < 6 and abs(dw - 74) < 1, f'reset: Slide back in its corner ({dx:.0f},{dy:.0f}) at 74 px')
    found = await pg.evaluate(HUD_CHECK)
    check(not found, f'reset: HUD checks pass {found[:3]}')

    print('calm and sound cues', flush=True)
    await pg.evaluate(f"{G}.Options.set('calm', true)")
    calm = await pg.evaluate("""(async () => { const f = await import('/js/render/feel.js'), m = await import('/js/ui/motion.js');
      return { flag: document.documentElement.hasAttribute('data-calm'), veil: getComputedStyle(document.querySelector('.flashbang')).backgroundColor, motion: f.feelMotion(), flash: f.feelFlash(), reduced: m.reducedMotion() }; })()""")
    check(calm['flag'] and calm['veil'] == 'rgb(43, 48, 56)', f'calm: flag and dark flashbang veil ({calm["veil"]})')
    check(calm['motion'] < 0.5 and calm['flash'] < 0.5 and calm['reduced'], f'calm: shake {calm["motion"]}, light {calm["flash"]}, reduced motion {calm["reduced"]}')
    await pg.evaluate(f"{G}.Options.set('calm', false)")
    calm = await pg.evaluate("(async () => { const f = await import('/js/render/feel.js'); return [f.feelMotion(), f.feelFlash(), document.documentElement.hasAttribute('data-calm')]; })()")
    check(calm == [1, 1, False], f'calm off: back to full ({calm})')

    cue = """(level => { const g = window.__game, h = g.hud, m = g.app.match, me = h.view.players.find(p => p.id === m.localId);
      const foe = h.view.players.find(p => p.team !== me.team);
      g.Options.set('cues', level);
      const view = { players: [{ ...me }, { id: foe.id, team: foe.team, alive: true, x: me.x, z: me.z + 8, vx: 0, vz: 7, sprinting: true }],
        projectiles: [{ kind: 'frag', owner: foe.id, x: me.x + 4, z: me.z, stuck: false }] };
      h.cues.update(view, me);
      const n = [...h.el.querySelectorAll('.cue-nade')].filter(e => e.style.opacity === '1');
      const s = [...h.el.querySelectorAll('.cue-step')].filter(e => +e.style.opacity > 0);
      const r = n[0]?.getBoundingClientRect();
      return { nades: n.length, steps: s.length, right: r ? (r.left + r.right) / 2 > innerWidth / 2 : null, label: n[0]?.querySelector('small').textContent ?? '' };
    })"""
    v = await pg.evaluate(cue + "('nades')")
    check(v['nades'] == 1 and v['right'] and v['label'] == 'Frag', f'cues: grenade marker on the grenade\'s side {v}')
    check(v['steps'] == 0, 'cues: no steps unless asked for')
    v = await pg.evaluate(cue + "('all')")
    check(v['steps'] == 1, f'cues all: the running enemy\'s steps show {v}')
    v = await pg.evaluate(cue + "('off')")
    hidden = await pg.evaluate(f"{G}.hud.el.querySelector('.cues').hidden")
    check(hidden, 'cues off: hidden')
    await pg.evaluate(f"{G}.Options.set('cues', 'nades')")
    await ctx.close()


async def title(browser):
    print('title emote row', flush=True)
    for (w, h) in [(640, 360), (667, 375), (736, 414), (852, 393), (932, 430), (956, 440)]:
        ctx = await browser.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True)
        pg = await fresh(ctx)
        await pg.locator('.ttl-emote').click()
        await pg.wait_for_timeout(250)
        found = await pg.evaluate("""(() => {
          const r = el => { const b = el.getBoundingClientRect(); return { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom }; };
          const row = r(document.querySelector('.ttl-emotes')), out = [];
          const hit = (a, b) => a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1 && a.y0 < b.y1 - 1 && b.y0 < a.y1 - 1;
          if (row.x0 < 0 || row.y0 < 0 || row.x1 > innerWidth || row.y1 > innerHeight) out.push('off screen');
          for (const sel of ['.ttl-left', '.tl-btn', '.ttl-sec', '.ttl-emote', '.pcard'])
            for (const el of document.querySelectorAll(sel)) if (hit(row, r(el))) out.push(sel + (el.dataset.act ? ' ' + el.dataset.act : ''));
          const tch = document.querySelector('.tch');
          if (tch && getComputedStyle(tch).visibility !== 'hidden' && hit(row, r(tch))) out.push('challenges');
          for (const b of document.querySelectorAll('.ttl-em')) { const e = r(b); if (e.x1 - e.x0 < 40 || e.y1 - e.y0 < 26) out.push('small tile'); }
          return out;
        })()""")
        check(not found, f'title {w}x{h}: emote row fits {found[:4]}')
        if (w, h) in [(640, 360), (667, 375)]: await pg.screenshot(path=f'{SHOTS}/title-emotes-{w}.png')
        await ctx.close()


async def main():
    os.makedirs(SHOTS, exist_ok=True)
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await asyncio.sleep(1)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', args=GL)
            for step in (title, colour_modes, editor_and_match):
                try:
                    await step(browser)
                except Exception as e:
                    fails.append(f'{step.__name__}: {type(e).__name__}: {str(e)[:300]}')
                    print('  FAIL', fails[-1], flush=True)
            await browser.close()
    finally:
        srv.terminate()
    errs = [e for e in errors if 'GL Driver' not in e]
    print('console errors:', errs[:8] or 'none')
    if fails or errs:
        print(f'FAILED: {len(fails)} findings')
        sys.exit(1)
    print('PASS')


asyncio.run(main())
