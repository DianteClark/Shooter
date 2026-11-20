// Node tests for roadmap 63 (docs/TUTORIAL.md, docs/ACCESSIBILITY.md): the help video scripts and every one run headless
// through its director (real Sim, bots only), the first-time tips, the tutorial's device prompts, the menu labeller's
// action names, the reduced-motion keyframes and the new Options keys surviving the progress reset.
//   node dev/help-videos-test.mjs          everything
//   node dev/help-videos-test.mjs quick    skip the headless runs
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

const QUICK = process.argv.includes('quick');
const HV = await import('../js/shared/help-videos.js');
const { MAPS } = await import('../js/shared/map.js');
const { MODES } = await import('../js/shared/modes.js');
const TIPS = await import('../js/shared/mode-tips.js');
const { KEEP_KEYS, OPTIONS_KEY, wipeProgress, RESET_GEN, GEN_KEY } = await import('../js/shared/reset.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok  ${name}`); };

/* ---------- Scripts ---------- */
test('every video script is sound: length 10-25 s, captions in order and long enough, known ops, map and mode', () => {
  for (const v of HV.VIDEOS) assert.deepEqual(HV.videoProblems(v, { maps: MAPS, modes: MODES }), [], v.id);
  assert.equal(new Set(HV.VIDEOS.map(v => v.id)).size, HV.VIDEOS.length);
});
test('the roadmap list is covered', () => {
  const ids = new Set(HV.VIDEOS.map(v => v.id));
  for (const id of ['move', 'slide', 'nades', 'streaks', 'dom', 'hard', 'snd', 'kc', 'hq', 'ctf', 'br', 'brfight', 'ex', 'zm', 'cp', 'ranked', 'gunsmith', 'caster']) assert.ok(ids.has(id), id);
  for (const id of Object.values(HV.CARD_VIDEOS)) assert.ok(HV.VIDEO_BY_ID[id], id);
});
test('videoProblems catches bad scripts', () => {
  const v = HV.VIDEO_BY_ID.dom;
  assert.ok(HV.videoProblems({ ...v, len: 40 }).some(p => p.includes('length')));
  assert.ok(HV.videoProblems({ ...v, captions: [[1, 'x']] }).some(p => p.includes('caption at 0')));
  assert.ok(HV.videoProblems({ ...v, captions: [[0, 'a'], [1, 'b']] }).some(p => p.includes('under 2.5')));
  assert.ok(HV.videoProblems({ ...v, ops: [[2, 'teleport']] }).some(p => p.includes('op teleport')));
  assert.ok(HV.videoProblems({ ...v, map: 'nowhere' }, { maps: MAPS }).some(p => p.includes('map')));
});
test('captionAt / captionText / fillButtons', () => {
  const v = HV.VIDEO_BY_ID.move;
  assert.equal(HV.captionAt(v, 0).i, 0);
  assert.equal(HV.captionAt(v, v.captions[1][0]).i, 1);
  assert.equal(HV.captionAt(v, v.len - 0.01).i, v.captions.length - 1);
  assert.equal(HV.captionAt({ captions: [[2, 'x']] }, 1), null);
  assert.equal(HV.captionText(v, 0, 'touch').text, v.captions[0][1]);
  assert.equal(HV.captionText(v, 0, 'pad').text, v.captions[0][2]);
  const late = HV.captionText(v, v.len - 0.1, 'pad');
  assert.equal(late.text, v.captions.at(-1)[2] ?? v.captions.at(-1)[1]);    // No controller words: the touch ones.
  assert.equal(HV.fillButtons('Pull {fire} to fire', id => (id === 'fire' ? 'RT' : '')), 'Pull RT to fire');
  assert.equal(HV.fillButtons('Press {slide}', () => ''), 'Press Slide');
  for (const vid of HV.VIDEOS) for (const c of vid.captions) assert.ok(!/\{/.test(c[1]), `${vid.id}: touch caption with a button token`);
});

/* ---------- Headless runs ---------- */
if (!QUICK) {
  const { HelpDirector, STAR_ID } = await import('../js/game/help-director.js');
  const sig = d => d.sim.players.map(p => `${p.id}:${p.ps.x.toFixed(2)},${p.ps.z.toFixed(2)}:${p.alive ? 1 : 0}`).join('|');
  for (const v of HV.VIDEOS) {
    test(`${v.id}: runs ${v.len} s headless, the star is in it, its moments happen`, () => {
      const t0 = performance.now();
      const d = new HelpDirector(v);
      assert.ok(d.ready);
      assert.ok(d.star, 'star in the roster');
      let frames = 0, viewOk = true;
      while (!d.done) { d.advance(1 / 30); if (++frames % 60 === 0) viewOk = viewOk && Array.isArray(d.view().players); }
      assert.ok(viewOk);
      assert.ok(Math.abs(d.t - v.len) < 1e-6);
      assert.equal(d.advance(1).length, 0, 'nothing after the end');
      const ops = v.ops ?? [];
      const want = k => ops.filter(o => o[1] === k).length;
      if (want('slide')) assert.ok(d.counts.slide >= want('slide'), `slides ${d.counts.slide}/${want('slide')}`);
      if (want('lethal') + want('tactical')) assert.ok(d.counts.throw >= want('lethal') + want('tactical'), `throws ${d.counts.throw}`);
      if (want('streak')) assert.ok(d.counts.streak >= want('streak'), `streaks ${d.counts.streak}/${want('streak')}`);
      const ms = performance.now() - t0;
      // A budget for the phone: the whole lead-in plus the video, headless, well under the video's own length.
      assert.ok(ms < v.len * 1000 * 0.6, `${ms.toFixed(0)} ms for ${v.len} s`);
      console.log(`    ${v.id}: ${ms.toFixed(0)} ms, star ${JSON.stringify(d.counts)}`);
      assert.equal(d.sim.byId.get(STAR_ID).name, 'You');
    });
  }
  test('same seed, same video: Replay shows the same match', () => {
    for (const id of ['slide', 'dom']) {
      const a = new HelpDirector(HV.VIDEO_BY_ID[id]), b = new HelpDirector(HV.VIDEO_BY_ID[id]);
      for (let i = 0; i < 180; i++) { a.advance(1 / 30); b.advance(1 / 30); }
      assert.equal(sig(a), sig(b), id);
    }
  });
  test('lazy lead-in: prepare runs in slices and lands where the eager one does', () => {
    const v = HV.VIDEO_BY_ID.kc;
    const lazy = new HelpDirector(v, { lazy: true }), eager = new HelpDirector(v);
    assert.equal(lazy.ready, false);
    assert.equal(lazy.advance(0.5).length, 0, 'no video before the lead-in');
    let slices = 0;
    while (!lazy.prepare(0.0001)) slices++;
    assert.ok(slices > 5);
    assert.equal(sig(lazy), sig(eager));
  });
}

/* ---------- First-time tips ---------- */
test('tips: every mode has one, variants share, shown once', () => {
  for (const id of Object.keys(MODES)) assert.ok(TIPS.TIP_OF[id], `mode ${id} has a tip key`);
  for (const key of Object.values(TIPS.TIP_OF)) assert.ok(TIPS.TIPS[key], key);
  for (const t of Object.values(TIPS.TIPS)) { if (t.video) assert.ok(HV.VIDEO_BY_ID[t.video], t.video); assert.ok(t.lines.length >= 1 && t.lines.every(l => l.length < 110)); }
  assert.equal(TIPS.tipFor('gwdom').key, 'dom');
  let seen = {};
  assert.ok(TIPS.tipFor('dom', seen));
  seen = TIPS.markSeen(seen, 'dom');
  assert.equal(TIPS.tipFor('dom', seen), null);
  assert.equal(TIPS.tipFor('gwdom', seen), null, 'Ground War Domination is the same tip');
  assert.ok(TIPS.tipFor('hard', seen));
  assert.equal(TIPS.tipFor('range', {}), null);
  assert.deepEqual(TIPS.markSeen(null, 'kc'), { kc: 1 });
});

/* ---------- Options keys survive the reset ---------- */
store.clear();
store.set(OPTIONS_KEY, JSON.stringify({ tipsSeen: { dom: 1, 'bad key!': 1 }, hudContrast: true, captions: true, shotCues: true, padAim: 'toggle', padSprint: 'nope' }));
store.set('switchyard.save', 'x');
const wiped = wipeProgress({ get length() { return store.size; }, key: i => [...store.keys()][i], getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) });
const { Options, OPTION_DEFAULTS } = await import('../js/ui/options.js');
test('new Options keys load, sanitize and survive the progress reset', () => {
  assert.ok(KEEP_KEYS.includes(OPTIONS_KEY));
  assert.ok(wiped.ran);
  assert.equal(store.get(GEN_KEY), String(RESET_GEN));
  assert.ok(store.has(OPTIONS_KEY), 'options kept');
  assert.ok(!store.has('switchyard.save'), 'progress gone');
  for (const k of ['tipsSeen', 'hudContrast', 'captions', 'shotCues', 'padAim', 'padSprint']) assert.ok(k in OPTION_DEFAULTS, k);
  const v = Options.values;
  assert.deepEqual(v.tipsSeen, { dom: 1 });
  assert.equal(v.hudContrast, true);
  assert.equal(v.captions, true);
  assert.equal(v.shotCues, true);
  assert.equal(v.padAim, 'toggle');
  assert.equal(v.padSprint, 'toggle', 'unknown value falls back');
});

/* ---------- Tutorial prompts, labels, calm frames ---------- */
const { STEPS, stepPrompt } = await import('../js/game/tutorial.js');
test('tutorial: every step has controller words; prompts fill the bound buttons', () => {
  for (const s of STEPS) if (s.id !== 'fight') assert.ok(s.pad, s.id);
  const fire = STEPS.find(s => s.id === 'fire');
  assert.equal(stepPrompt(fire, 'pad', id => ({ fire: 'RT' }[id] ?? '')), 'Pull RT to fire. Drop two targets.');
  assert.equal(stepPrompt(fire, 'touch'), fire.text);
  assert.equal(stepPrompt(STEPS.find(s => s.id === 'slide'), 'pad', () => ''), 'While moving, press Slide. A slide makes you a smaller target.');
  assert.ok(STEPS.some(s => s.id === 'swap'));
});
const { actName } = await import('../js/ui/aria.js');
test('menu labeller: action ids read as words', () => {
  assert.equal(actName('optSquadClear'), 'Squad clear');
  assert.equal(actName('a11yBack'), 'Back');
  assert.equal(actName('helpVideo'), 'Video');
  assert.equal(actName('close'), 'Close');
  assert.equal(actName(''), '');
});
const { calmFrames } = await import('../js/ui/motion.js');
test('reduced motion: keyframes lose movement, keep fades, and drop when nothing is left', () => {
  assert.equal(calmFrames([{ transform: 'scale(1.3)' }, { transform: 'none' }]), null);
  assert.deepEqual(calmFrames([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }]), [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(calmFrames([{ filter: 'brightness(2)' }, { filter: 'none' }]), null);
  const f = [{ opacity: 1, offset: 0.2 }, { opacity: 0 }];
  assert.equal(calmFrames(f), calmFrames(f), 'cached per frames array');
});
const { sideOf } = await import('../js/ui/cues-hud.js').catch(() => ({ sideOf: null }));
if (sideOf) test('sound captions: sides as the screen shows them', () => {
  assert.equal(sideOf(5, 0), 'right');
  assert.equal(sideOf(-5, 0), 'left');
  assert.equal(sideOf(0, -5), 'above');
  assert.equal(sideOf(0, 5), 'below');
  assert.equal(sideOf(3, -3), 'above right');
});

console.log(`\n${passed} passed`);
