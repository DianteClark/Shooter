#!/usr/bin/env python3
"""Extraction end to end in a real browser (docs/EXTRACT.md): python3 dev/ui-ex-test.py [port] [outdir]

Serves the repo, opens Multiplayer, the Extraction tab, Quads, Find match, rides the search and the vote into a match
on Frontier, opens the full map, finds the phone greyed while a contract is under way, holds Abandon on the
contract card, takes a contract at the phone, does it (the local player is moved to the objective; a
commander is shot on the host), waits for the first exfil window (the match clock is wound forward on the host), calls
the helicopter, holds the zone, gets lifted out and checks the extraction results screen. Screenshots at 852x393 and
667x375 go to outdir (default /tmp/exfil). Fails on any console error, and on HUD panels that spill off the screen.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8361
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/exfil'
ARGS = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
G = 'window.__game.app'

# Elements that must sit inside the viewport when shown.
OVERFLOW = """((sels) => {
  const W = innerWidth, H = innerHeight, bad = [];
  for (const s of sels) for (const n of document.querySelectorAll(s)) {
    if (n.hidden || n.closest('[hidden]') || getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden') continue;
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) bad.push(`${s} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.right)}x${Math.round(r.bottom)}`);
  }
  return bad;
})"""


def cid_js():
    return f"{G}.match.sim.rules.squads.get({G}.match.sim.byId.get({G}.match.localId).team).contract?.id ?? null"


# Visible text boxes that must not overlap each other.
OVERLAP = """((sels) => {
  const boxes = [];
  for (const s of sels) for (const n of document.querySelectorAll(s)) {
    if (n.hidden || n.closest('[hidden]') || getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden' || +getComputedStyle(n).opacity === 0) continue;
    const r = n.getBoundingClientRect();
    if (r.width && r.height) boxes.push({ s, r, n });
  }
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.n.contains(b.n) || b.n.contains(a.n)) continue;
    const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    const R = r => `${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`;
    if (ox > 2 && oy > 2) bad.push(`${a.s} [${R(a.r)}] / ${b.s} [${R(b.r)}] "${(b.n.textContent || '').slice(0, 40)}"`);
  }
  return bad;
})"""


async def check_overlap(pg, sels, tag, failures):
    for b in await pg.evaluate(f"{OVERLAP}({sels!r})"): failures.append(f'{tag}: overlap: {b}')


async def take_offer(pg, ev, tag, failures, k, name=None):
    if await ev("document.querySelector('.ex-phone').classList.contains('off')"): failures.append(f'{tag}: the phone is greyed with no contract')
    await pg.locator('.ex-phone').first.click()
    await pg.wait_for_timeout(400)
    if name:
        vw = await ev('innerWidth'); vh = await ev('innerHeight')
        print(f'  {vw}x{vh} {name}', flush=True)
        await pg.screenshot(path=f'{OUT}/{name}-{vw}x{vh}.png')
        await check_fit(pg, ['.ex-offer', '.ex-offers h3', '.ex-offers .close'], f'{tag} offers', failures)
    before = await ev(f"{G}.match.sim.rules.squads.get({G}.match.sim.byId.get({G}.match.localId).team).taken")
    await pg.locator(f'.ex-offer[data-k="{k}"]').first.click()
    await pg.wait_for_timeout(500)
    after = await ev(f"{G}.match.sim.rules.squads.get({G}.match.sim.byId.get({G}.match.localId).team).taken")
    if after != before + 1: failures.append(f'{tag}: taking a contract at the phone did nothing ({before} -> {after})')


async def check_fit(pg, sels, tag, failures):
    bad = await pg.evaluate(f"{OVERFLOW}({sels!r})")
    for b in bad: failures.append(f'{tag}: off screen: {b}')


async def run(browser, vw, vh, failures, errors):
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'{vw}: PAGEERR {e} {getattr(e, "stack", "")}'))
    async def shot(name):
        print(f'  {vw}x{vh} {name}', flush=True)
        await pg.screenshot(path=f'{OUT}/{name}-{vw}x{vh}.png')
    ev = lambda js: pg.evaluate(js)
    tag = f'{vw}x{vh}'
    await pg.goto(f'http://localhost:{PORT}/?debug=1&vote=2&search=600')
    await pg.wait_for_timeout(900)
    await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="multiplayer"]').first.click()
    await pg.wait_for_timeout(600)
    await pg.locator('[data-act="mpTab"][data-tab="extraction"]').first.click()
    await pg.wait_for_timeout(500)
    await pg.locator('[data-act="mpPlaylist"][data-id="exquads"]').first.click()
    await pg.wait_for_timeout(300)
    await shot('01-multiplayer')
    await check_fit(pg, ['.mp-pl', '.mp-find', '.mp-tabs'], f'{tag} multiplayer', failures)
    await pg.locator('[data-act="mpFind"]').first.click()
    await pg.wait_for_timeout(1300)
    await shot('02-vote')
    await pg.wait_for_function(f'{G}.match?.interp.newest?.obj?.ex || {G}.match?.interp.newest?.points?.obj?.ex', timeout=40000)
    mode = await ev(f'{G}.match.mode')
    if mode != 'exq': failures.append(f'{tag}: match mode {mode}')
    await pg.wait_for_function(f'{G}.match.interp.newest.phase === "live"', timeout=30000)
    await pg.wait_for_timeout(1500)
    # Shield the local squad so a stray fight cannot end the run; the AI and other squads leave a shielded player be.
    await ev(f"""(() => {{ const sim = {G}.match.sim, me = sim.byId.get({G}.match.localId);
      window.__shield = setInterval(() => {{ for (const p of sim.players) if (p.team === me.team) {{ p.spawnProtect = 99; if (p.downed) {{ p.downed = false; p.hp = 100; }} }} }}, 200); }})()""")
    await shot('03-insertion')
    await check_fit(pg, ['.ex-top', '.ex-con', '.ex-squad', '.minimap'], f'{tag} hud', failures)
    # Nothing is dealt: the squad starts without a contract and the tracker points at the nearest phone.
    if await ev(cid_js()) is not None: failures.append(f'{tag}: a contract was dealt at the start')
    none = await ev("(() => { const c = document.querySelector('.ex-con'); return !c.hidden && c.classList.contains('none') && c.querySelector('p').textContent; })()")
    if not none or 'phone' not in none: failures.append(f'{tag}: no "pick one up at a phone" tracker at the start ({none!r})')
    if not await ev("[...document.querySelectorAll('.ex-tag.need:not([hidden])')].length"): failures.append(f'{tag}: no marker toward a contract phone with no contract')
    # The full map from the minimap.
    await pg.locator('.minimap').first.click()
    await pg.wait_for_timeout(500)
    await shot('04-map')
    await check_fit(pg, ['.ex-map-frame', '.ex-map-side'], f'{tag} map', failures)
    await pg.locator('.ex-map-close').first.click()
    await pg.wait_for_timeout(300)
    # A phone: walk (teleport) to one, open the offers, take the second.
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, me = m.sim.byId.get(m.localId);
      const ph = R.phones.slice().sort((a, b) => Math.hypot(a.x - me.ps.x, a.z - me.ps.z) - Math.hypot(b.x - me.ps.x, b.z - me.ps.z))[0];
      m.ps.x = ph.x; m.ps.z = ph.z + 1; }})()""")
    await pg.wait_for_selector('.ex-phone:not([hidden])', timeout=8000)
    await pg.wait_for_timeout(300)
    await shot('05-phone')
    await take_offer(pg, ev, tag, failures, 0)
    # The full card for a few seconds, then the one-line tracker with the small Abandon at its side.
    full = await ev("(() => { const c = document.querySelector('.ex-con'); return !c.classList.contains('mini') && getComputedStyle(c.querySelector('b')).display !== 'none'; })()")
    if not full: failures.append(f'{tag}: no full contract card right after taking one')
    await shot('05a-card-full')
    await pg.wait_for_function("document.querySelector('.ex-con').classList.contains('mini')", timeout=9000)
    await pg.wait_for_timeout(200)
    await shot('05a-card-tracker')
    geo = await ev("""(() => { const c = document.querySelector('.ex-con').getBoundingClientRect(), a = document.querySelector('.ex-con .ex-ab').getBoundingClientRect(), p = document.querySelector('.ex-con p');
      const d = document.querySelector('.ex-con .dist'), dr = d.getBoundingClientRect();
      return { h: c.height, w: c.width, ab: [a.left - c.left, a.right - c.right, a.width, a.height], text: `${p.textContent} ${d.textContent}`, clip: p.scrollWidth > p.clientWidth + 1,
        distIn: dr.width > 0 && dr.left >= c.left && dr.right <= a.left + 1, top: c.top, left: c.left, right: c.right }; })()""")
    if not geo['distIn']: failures.append(f'{tag}: the tracker distance is hidden or under the abandon button')
    if geo['h'] > 34: failures.append(f'{tag}: the tracker is {geo["h"]:.0f} px tall (one line wanted)')
    if geo['ab'][2] > 40 or geo['ab'][1] > 1 or geo['ab'][0] < geo['w'] * 0.6: failures.append(f'{tag}: abandon is not a small button at the tracker side {geo["ab"]}')
    if ' m' not in geo['text']: failures.append(f'{tag}: the tracker has no distance: {geo["text"]!r}')
    print(f'  tracker {geo["w"]:.0f}x{geo["h"]:.0f}: {geo["text"]!r}{" (clipped)" if geo["clip"] else ""}', flush=True)
    await check_fit(pg, ['.ex-con', '.ex-top', '.minimap'], f'{tag} tracker', failures)
    # One contract at a time: with one under way the phone is greyed, says why, and opens nothing.
    busy = await ev("(() => { const b = document.querySelector('.ex-phone'); return [b.classList.contains('off'), b.querySelector('small').textContent]; })()")
    if not busy[0] or busy[1] != 'Finish your current contract first': failures.append(f'{tag}: phone with a contract under way shows {busy}')
    await pg.locator('.ex-phone').first.click(force=True)
    await pg.wait_for_timeout(300)
    if await ev("!document.querySelector('.ex-offers').hidden"): failures.append(f'{tag}: the greyed phone opened the offers')
    # Abandon on the contract card: a short press does nothing, a held one (about 1 s, the bar fills) drops it.
    cid = f"{G}.match.sim.rules.squads.get({G}.match.sim.byId.get({G}.match.localId).team).contract?.id ?? null"
    c0 = await ev(cid)
    ab = pg.locator('.ex-con .ex-ab').first
    box = await ab.bounding_box()
    if not box: failures.append(f'{tag}: no abandon button on the contract card')
    else:
        await ev("document.querySelector('.ex-con .ex-ab').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
        await pg.wait_for_timeout(300)
        await ev("document.querySelector('.ex-con .ex-ab').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))")
        await pg.wait_for_timeout(1300)
        if await ev(cid) != c0: failures.append(f'{tag}: a short press abandoned the contract')
        await ev("document.querySelector('.ex-con .ex-ab').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
        await pg.wait_for_timeout(500)
        k = await ev("document.querySelector('.ex-con .ex-ab i').style.transform")
        await shot('05b-abandon-hold')
        if 'scaleX(0)' == k or not k: failures.append(f'{tag}: the abandon hold bar did not fill ({k!r})')
        try: await pg.wait_for_function(f"({cid}) === null", timeout=6000)
        except Exception: failures.append(f'{tag}: holding abandon did not drop the contract')
        await ev("document.querySelector('.ex-con .ex-ab').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))")
    try: await pg.wait_for_selector('.ex-phone:not(.off):not([hidden])', timeout=5000)
    except Exception: failures.append(f'{tag}: the phone stayed greyed after abandoning')
    await pg.wait_for_timeout(1500)
    if await ev(cid) is not None: failures.append(f'{tag}: a contract was dealt after abandoning')
    await take_offer(pg, ev, tag, failures, 1, '06-offers')
    # Do it: stand where it wants us (the case, then the drop; beside the mule; on the cache or terminal), commander shot.
    ctype = await ev(f"{G}.match.sim.rules.squads.get({G}.match.sim.byId.get({G}.match.localId).team).contract.type")
    done = await ev(f"""(async () => {{
      const m = {G}.match, R = m.sim.rules, me = m.sim.byId.get(m.localId), s = R.squads.get(me.team), c = s.contract, n0 = s.pot.length;
      for (let i = 0; i < 900 && s.pot.length === n0; i++) {{
        for (const q of m.sim.players) if (q.ai && q.alive && Math.hypot(q.ps.x - me.ps.x, q.ps.z - me.ps.z) < 40 && !q.exCommander) {{ q.alive = false; q.hp = 0; q.exGroup = null; }}
        let tx = c.x, tz = c.z;
        if (c.type === 'intel' && c.carrier >= 0) {{ tx = c.dx; tz = c.dz; }}
        if (c.type === 'escort') tx += 2;
        if (c.type === 'hvt') {{
          const g = R.groups.find(x => x.id === c.group); tx = c.x + 25;
          if (g.state === 'asleep') R._wake(g);
          const boss = g.members.find(q => q.exCommander);
          if (boss?.alive) m.sim._damage(boss, me, 60, me.ps.weapon, 10);
        }}
        m.ps.x = tx; m.ps.z = tz; m.ps.vx = 0; m.ps.vz = 0;
        if (i === 30) window.__mid = true;
        await new Promise(r => setTimeout(r, 120));
      }}
      return s.pot.length > n0;
    }})()""")
    if not done: failures.append(f'{tag}: the {ctype} contract did not complete')
    await pg.wait_for_timeout(500)
    await shot('07-contract-done')
    pot = await ev(f"document.querySelector('.ex-pot b').textContent")
    if pot.strip() in ('', '0'): failures.append(f'{tag}: the pot chip shows {pot!r} after a contract')
    await pg.wait_for_timeout(3500)
    if await ev(cid) is not None: failures.append(f'{tag}: a contract was dealt after finishing one')
    # Wind the clock to the first exfil window, go to an open site and call it.
    await ev(f"""(() => {{ const R = {G}.match.sim.rules; R.t = Math.max(R.t, 211); R._stepWindows(); }})()""")
    await ev(f"""(() => {{ const m = {G}.match, R = m.sim.rules, e = R.exfils.find(x => x.state === 1); m.ps.x = e.x; m.ps.z = e.z; window.__site = e.i;
      for (const q of m.sim.players) if (!q.ai && q.team !== m.sim.byId.get(m.localId).team) {{ q.ps.x = 5 + q.index; q.ps.z = 5; }} }})()""")
    try: await pg.wait_for_selector('.ex-call:not([hidden])', timeout=25000)
    except Exception:
        print('  debug', await ev(f"(() => {{ const m = {G}.match, R = m.sim.rules, me = m.sim.byId.get(m.localId), v = m.interp.newest; return JSON.stringify({{ t: R.t, site: window.__site, e: R.exfils[window.__site], me: [me.ps.x, me.ps.z, me.alive, me.downed], ps: [m.ps.x, m.ps.z], acts: document.querySelector('.ex-acts').outerHTML.slice(0, 300) }}); }})()"))
        raise
    await pg.wait_for_timeout(300)
    await shot('08-exfil-zone')
    await check_fit(pg, ['.ex-call', '.ex-top', '.ex-tag:not([hidden])'], f'{tag} exfil', failures)
    await pg.locator('.ex-call').first.click()
    await pg.wait_for_timeout(600)
    state = await ev(f"{G}.match.sim.rules.exfils[window.__site].state")
    if state != 2: failures.append(f'{tag}: calling the exfil left the site in state {state}')
    await shot('09-inbound')
    # Bring it in (the flight is the wait), keep the zone clear, hold it, get lifted.
    await ev(f"""(() => {{ const R = {G}.match.sim.rules; R.exfils[window.__site].timer = 0.3; }})()""")
    await ev(f"""(() => {{ const m = {G}.match; window.__clear = setInterval(() => {{ for (const q of m.sim.players) if (q.ai && q.alive) {{ q.alive = false; q.hp = 0; q.exGroup = null; }} }}, 150); }})()""")
    # Software rendering runs the sim slower than real time: the hold is wound on too.
    try: await pg.wait_for_function(f"{G}.match.sim.rules.exfils[window.__site].state === 3", timeout=30000)
    except Exception:
        print('  debug', await ev(f"JSON.stringify({{site: window.__site, e: {G}.match.sim.rules.exfils[window.__site], t: {G}.match.sim.rules.t, phase: {G}.match.sim.phase, time: {G}.match.sim.time}})"))
        raise
    await pg.wait_for_timeout(2500)
    await shot('10-holding')
    await ev(f"(() => {{ const e = {G}.match.sim.rules.exfils[window.__site]; if (e.holder >= 0) e.hold = Math.max(e.hold, 8.5); }})()")
    await check_fit(pg, ['.ex-hold', '.ex-top'], f'{tag} hold', failures)
    await pg.wait_for_function(f"{G}.match?.sim.rules.squads.get({G}.match.sim.byId.get({G}.match.localId).team).extracted > 0 || document.querySelector('#ui .menu[data-screen=\"results\"]')", timeout=60000)
    await pg.wait_for_timeout(600)
    await shot('11-lifted')
    # Lifted out: Spectate keeps the match going (well past the choice window) until Leave.
    try: await pg.wait_for_selector('.ex-held:not([hidden]) .ex-spec:not([hidden])', timeout=8000)
    except Exception: failures.append(f'{tag}: no Spectate on the out panel after extracting')
    await check_overlap(pg, ['.br-out.ex-held .txt b', '.br-out.ex-held .place', '.br-out.ex-held small', '.br-out.ex-held .acts', '.ex-callout b', '.ex-callout small', '.ex-top', '.ex-con'], f'{tag} lifted', failures)
    await pg.locator('.ex-spec').first.click()
    try: await pg.wait_for_function("document.querySelector('.br-out.ex-held').classList.contains('watching')", timeout=6000)
    except Exception: failures.append(f'{tag}: Spectate did not switch to watching')
    if not await ev(f"{G}.match.sim.byId.get({G}.match.localId).ex.watch"): failures.append(f'{tag}: the host was not told about Spectate')
    await pg.wait_for_timeout(1200)
    await check_overlap(pg, ['.br-out.ex-held .txt', '.br-out.ex-held .acts', '.spec-card', '.ex-top', '.ex-squad', '.minimap'], f'{tag} watching', failures)
    t0 = await ev(f"{G}.match.sim.rules.t")
    try: await pg.wait_for_function(f"{G}.match?.sim.rules.t > {t0} + 22 || {G}.match?.ended || document.querySelector('.menu[data-screen=\"results\"]')", timeout=90000)
    except Exception: pass
    if await ev(f"!!({G}.match?.ended) || !!document.querySelector('.menu[data-screen=\"results\"]')"): failures.append(f'{tag}: the match left while spectating after extracting')
    await shot('11b-spectating')
    await check_fit(pg, ['.br-out.ex-held', '.br-out.ex-held button'], f'{tag} spectating', failures)
    clipped = await ev("[...document.querySelectorAll('.br-out.ex-held:not([hidden]) button')].filter(b => !b.hidden && b.offsetWidth && b.scrollWidth > b.clientWidth + 1).map(b => b.textContent)")
    if clipped: failures.append(f'{tag}: clipped buttons on the watching plate: {clipped}')
    pr = await ev("(() => { const a = document.querySelector('.br-out.ex-held').getBoundingClientRect(), b = [...document.querySelectorAll('.br-out.ex-held button')].filter(x => !x.hidden).map(x => x.getBoundingClientRect()); return b.every(r => r.right <= a.right + 1 && r.left >= a.left - 1); })()")
    if not pr: failures.append(f'{tag}: watching plate buttons spill out of it')
    await check_overlap(pg, ['.br-out.ex-held .txt', '.br-out.ex-held .acts', '.spec-card', '.ex-top', '.ex-squad', '.minimap'], f'{tag} spectating', failures)
    await pg.locator('.ex-leave').first.click()
    await pg.wait_for_selector('.menu[data-screen="results"] .rs', timeout=90000)
    await pg.wait_for_timeout(2500)
    # The screen slides in; let the entrance finish (software rendering is slow) before judging the layout.
    for _ in range(10):
        if not await pg.evaluate(f"{OVERFLOW}(['.rs-top'])"): break
        await pg.wait_for_timeout(700)
    await shot('12-results')
    word = await ev("document.querySelector('.rs-word h2')?.textContent")
    if word != 'Extracted': failures.append(f'{tag}: results say {word!r}')
    rows = await ev("[...document.querySelectorAll('.rb.theirs .rb-row b')].map(n => n.textContent)")
    if not any(r for r in rows if r and 'No contracts' not in r): failures.append(f'{tag}: no contract rows on results: {rows}')
    xp = await ev("[...document.querySelectorAll('.xp-row span')].map(n => n.textContent)")
    if 'Extracted' not in xp: failures.append(f'{tag}: no Extracted XP line: {xp}')
    await check_fit(pg, ['.rs-top', '.rb-pair', '.rs-cards'], f'{tag} results', failures)
    await ev('clearInterval(window.__shield); clearInterval(window.__clear)')
    await ctx.close()


async def start_match(pg, ev):
    await pg.goto(f'http://localhost:{PORT}/?debug=1&vote=2&search=600')
    await pg.wait_for_timeout(900)
    await ev("window.__game.Progress.name='Tester'; window.__game.Progress.setFlag('tutorialOffered')")
    await pg.reload()
    await pg.wait_for_timeout(1200)
    await pg.locator('[data-act="multiplayer"]').first.click()
    await pg.wait_for_timeout(600)
    await pg.locator('[data-act="mpTab"][data-tab="extraction"]').first.click()
    await pg.wait_for_timeout(500)
    await pg.locator('[data-act="mpPlaylist"][data-id="exquads"]').first.click()
    await pg.wait_for_timeout(300)
    await pg.locator('[data-act="mpFind"]').first.click()
    await pg.wait_for_function(f'{G}.match?.interp.newest?.obj?.ex || {G}.match?.interp.newest?.points?.obj?.ex', timeout=40000)
    await pg.wait_for_function(f'{G}.match.interp.newest.phase === "live"', timeout=30000)
    await pg.wait_for_timeout(1000)


# Squad wiped: the callout, the out panel and later the end banner must not run into each other.
async def run_wipe(browser, vw, vh, failures, errors):
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{vw}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'{vw}: PAGEERR {e}'))
    ev = lambda js: pg.evaluate(js)
    tag = f'{vw}x{vh} wipe'
    await start_match(pg, ev)
    await ev(f"""(() => {{ const m = {G}.match, sim = m.sim, me = sim.byId.get(m.localId), s = sim.rules.squads.get(me.team); s.lives = 0;
      const foe = sim.players.find(p => !p.ai && p.team !== me.team);
      for (const p of sim.players) if (p.team === me.team && p.alive) sim._kill(p, foe, foe.ps.weapon, 20, null, false, null); }})()""")
    sels = ['.br-out.ex-held .txt b', '.br-out.ex-held .place', '.br-out.ex-held small', '.br-out.ex-held .acts', '.ex-callout b', '.ex-callout small', '.ex-top', '.ex-con', '.ex-lives-note', '.endbanner b', '.endbanner small', '.feed', '.ex-squad', '.minimap']
    for k, wait in enumerate([700, 1500, 2500]):
        await pg.wait_for_timeout(wait)
        await pg.screenshot(path=f'{OUT}/20-wipe-{k}-{vw}x{vh}.png')
        await check_overlap(pg, sels, f'{tag} {k}', failures)
        await check_fit(pg, ['.ex-held', '.ex-callout'], f'{tag} {k}', failures)
    # Then the end of the match (nobody left): the end banner over the HUD.
    try: await pg.wait_for_function(f"{G}.match?.ended || document.querySelector('.endbanner.show')", timeout=60000)
    except Exception: failures.append(f'{tag}: the match did not end after the wipe')
    for k in range(3):
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=f'{OUT}/21-wipe-end-{k}-{vw}x{vh}.png')
        await check_overlap(pg, sels, f'{tag} end {k}', failures)
    await pg.wait_for_selector('.menu[data-screen="results"] .rs', timeout=90000)
    await pg.wait_for_timeout(3000)
    await pg.screenshot(path=f'{OUT}/22-wipe-results-{vw}x{vh}.png')
    await check_overlap(pg, ['.rs-word h2', '.rs-word small', '.rs-top > *'], f'{tag} results', failures)
    await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failures, errors = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=ARGS)
            sizes = [(852, 393), (667, 375), (640, 360), (956, 440)]
            if os.environ.get('EX_SIZE'): sizes = [tuple(int(v) for v in os.environ['EX_SIZE'].split('x'))]
            only = os.environ.get('EX_ONLY', '')
            for vw, vh in sizes:
                if only != 'wipe':
                    try: await run(browser, vw, vh, failures, errors)
                    except Exception as e: failures.append(f'{vw}x{vh}: {type(e).__name__}: {e}')
                if only != 'flow':
                    try: await run_wipe(browser, vw, vh, failures, errors)
                    except Exception as e: failures.append(f'{vw}x{vh} wipe: {type(e).__name__}: {e}')
            await browser.close()
    finally:
        server.terminate()
    for e in errors: print('console error:', e)
    for f in failures: print('FAIL', f)
    print(f'screenshots in {OUT}')
    print('ok' if not failures and not errors else f'{len(failures)} failures, {len(errors)} console errors')
    sys.exit(1 if failures or errors else 0)


asyncio.run(main())
