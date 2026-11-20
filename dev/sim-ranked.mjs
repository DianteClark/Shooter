// Ranked seasons with rewards, and shareable replay codes (docs/RANKED.md, docs/REPLAYS.md; ROADMAP item 60).
// node dev/sim-ranked.mjs [quick]
//   season     the season a date is in, its countdown, Season 2 and the replays
//   sr         placements, rating movement, the floor, the soft reset carrying three quarters
//   rewards    every division pays its card, crest and title; Gold and up the season's ranked camo; paid at the end,
//              owned for good, titles worn through the save (and the save code) and refused when not owned
//   bots       a ranked match's pool bots wear their Ranked board division; the pool's seed and tags untouched
//   code       a real bot match recorded, its highlight and its whole clip as codes, decoded and played back through
//              ClipReader: positions, kills, feed names, sizes; bad, cut, old and foreign codes refused cleanly
//   caster     the caster camera's pure parts: follow cycling, the tactical framing, the player list order
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

const S = await import('../js/shared/seasons.js');
const R = await import('../js/shared/ranked.js');
const I = await import('../js/shared/season-items.js');
const P = await import('../js/shared/progression.js');
const B = await import('../js/shared/boards.js');
const Pool = await import('../js/shared/botpool.js');
const { CAMOS, getCamo } = await import('../js/shared/camos.js');
const { Sim, buildRoster } = await import('../js/sim/sim.js');
const { ReplayRecorder, ClipReader } = await import('../js/game/replay.js');
const RC = await import('../js/game/replay-code.js');
const { MAPS } = await import('../js/shared/map.js');
const { SIM_HZ } = await import('../js/shared/constants.js');
const C = await import('../js/game/caster-core.js');

const QUICK = process.argv.includes('quick');
let fails = 0, passes = 0;
function ok(cond, name, info = '') {
  if (cond) { passes++; console.log(`  ok   ${name}${info !== '' ? `: ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`); }
  else { fails++; console.log(`  FAIL ${name}${info !== '' ? `: ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`); }
}
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

/* ---------- season ---------- */
console.log('season');
{
  const s1 = S.seasonAt(at(2026, 11, 20));
  ok(s1.key === 'S1' && s1.def.n === 1, 'Nov 20 is Season 1', s1.title);
  ok(s1.daysLeft === 38 && R.countdownText(s1.endsAt - at(2026, 11, 20).getTime()) === '37d 12h', 'the hub countdown reads days and hours', R.countdownText(s1.endsAt - at(2026, 11, 20).getTime()));
  ok(R.countdownText(5 * 3600e3 + 20 * 60e3) === '5h 20m' && R.countdownText(14 * 60e3 + 5e3) === '14m', 'then hours and minutes, then minutes');
  const s2 = S.seasonAt(at(2026, 12, 28, 0));
  ok(s2.key === 'S2' && s2.short === 'Season 2', 'Dec 28 opens Season 2');
  ok(S.seasonAt(at(2027, 2, 8)).key === 'S3' && S.seasonAt(at(2027, 3, 22)).key === 'S1R1', 'Feb 8 opens Season 3, Mar 22 is Season Replay: Cold Iron');
}

/* ---------- sr ---------- */
console.log('sr');
{
  const rk = R.blankRanked('S1');
  for (let i = 0; i < 5; i++) R.applyRanked(rk, { outcome: i < 3 ? 'win' : 'loss', perf: 0.2, rating: 0.4 });
  ok(R.placed(rk) && rk.sr === Math.round(R.ratingToSr(0.4) - 250 + 0.5 * 140 + 0.2 * 30), 'five placements place you from your rating', rk.sr);
  const before = rk.sr, w = R.applyRanked(rk, { outcome: 'win', perf: 0, lobby: before });
  ok(w.delta === 48, 'an even win is +48', w.delta);
  const l = R.applyRanked(rk, { outcome: 'loss', perf: 0, lobby: rk.sr });
  ok(l.delta === -42, 'an even loss is -42', l.delta);
  // The floor holds once.
  const f = { ...R.blankRanked('S1'), pm: 5, sr: 1810, peak: 1810, prot: 1 };
  const h1 = R.applyRanked(f, { outcome: 'loss', perf: -1, lobby: 1500 });
  ok(h1.protectedLoss && f.sr === 1800, 'the first drop out of Gold stops on its floor', f.sr);
  R.applyRanked(f, { outcome: 'loss', perf: -1, lobby: 1500 });
  ok(f.sr < 1800, 'the next one drops', f.sr);
  // The soft reset.
  const end = { ...R.blankRanked('S1'), pm: 5, sr: 3000, peak: 3300 };
  ok(R.carriedSr(end) === 2250, 'the soft reset carries three quarters', R.carriedSr(end));
  const top = { ...R.blankRanked('S1'), pm: 5, sr: 7000, peak: 7000 };
  ok(R.carriedSr(top) === R.PLACEMENT_CAP, 'never above Diamond III', R.carriedSr(top));
  const roll = R.rolloverRanked(end, 'S2');
  ok(roll.rk.base === 2250 && roll.rk.pm === 0 && roll.ended.peakDiv === 3, 'a new season: placements again from the carried SR, paid on the peak', roll.ended);
  const lad = R.ladder({ ...R.blankRanked('S1'), pm: 5, sr: 2000, peak: 2900 });
  ok(lad.filter(x => x.reached).length === 4 && lad.find(x => x.current).id === 'gold', 'the ladder: reached to the peak, held now', lad.map(x => `${x.id}${x.reached ? '+' : ''}${x.current ? '*' : ''}`).join(' '));
}

/* ---------- rewards ---------- */
console.log('rewards');
{
  for (const def of I.SEASON_DEFS) {
    const t = I.rankedTitles(def), rw = S.rankedRewards(def);
    ok(t.length === 7 && new Set(t.map(x => x.name)).size === 7, `${def.name}: a title per division`, t.map(x => x.name).join(', '));
    ok(rw.filter(r => r.camo).length === 1 && rw[I.RANKED_CAMO_DIV].camo === I.rankedCamoId(def), `${def.name}: one ranked camo, at ${I.DIVISIONS[I.RANKED_CAMO_DIV].name}`);
    const camo = getCamo(I.rankedCamoId(def));
    ok(camo.id === I.rankedCamoId(def) && camo.season === def.id && camo.ranked === I.RANKED_CAMO_DIV, 'the camo is a CAMOS row', camo.name);
    ok(P.camoRequirement(camo).startsWith('Reach Gold or higher in Season'), 'its requirement says how', P.camoRequirement(camo));
    ok(!P.camoGateOpen(camo, {}), 'no ordinary gate opens it');
  }
  ok(CAMOS.length === new Set(CAMOS.map(c => c.id)).size, 'camo ids stay unique');
  // The ranked camos are appended: every older camo keeps its index.
  const firstRk = CAMOS.findIndex(c => c.ranked !== undefined);
  ok(firstRk === CAMOS.length - I.SEASON_DEFS.length && CAMOS[firstRk - 1].tourney, 'ranked camos go on the end, after the tournament camo');
  // Paid at the season's end, through the rollover.
  const st = S.blankSeasonState();
  S.rollover(st, at(2026, 11, 20));
  st.rk = { ...st.rk, pm: 5, sr: 2400, peak: 2750 };      // Platinum peak (index 3), Gold now.
  let own = S.seasonOwned(st);
  ok(!own.has('title:rk-s1-bronze') && !own.has('camo:rk-s1'), 'nothing is paid before the season ends');
  const r = S.rollover(st, at(2026, 12, 28, 1));
  own = S.seasonOwned(st);
  ok(r.ranked?.peakDiv === 3 && st.rr.S1 === 3, 'Season 1 pays on the peak division', r.ranked?.peakDiv);
  ok(['bronze', 'silver', 'gold', 'platinum'].every(d => own.has(`title:rk-s1-${d}`) && own.has(`card:rk-s1-${d}`) && own.has(`emblem:rk-s1-${d}`)), 'every division up to it: card, crest and title');
  ok(!own.has('title:rk-s1-diamond') && own.has('camo:rk-s1'), 'none past it; the ranked camo (Gold and up)');
  ok(st.rk.base === R.carriedSr({ pm: 5, sr: 2400 }) && st.rk.k === 'S2', 'Season 2 placements start from the carried SR', st.rk.base);
  const low = S.blankSeasonState(); S.rollover(low, at(2026, 11, 20)); low.rk = { ...low.rk, pm: 5, sr: 1500, peak: 1700 };
  S.rollover(low, at(2026, 12, 28, 1));
  ok(!S.seasonOwned(low).has('camo:rk-s1') && S.seasonOwned(low).has('title:rk-s1-silver'), 'Silver: titles to Silver, no camo');
  // The worn title rides in the block, and in the save code; a block without one is exactly as before.
  st.tl = 'rk-s1-gold';
  const clean = S.cleanSeasonState(JSON.parse(JSON.stringify(st)));
  ok(clean.tl === 'rk-s1-gold', 'the worn title survives a clean');
  ok(S.cleanSeasonState({ ...st, tl: 'rk-s9-gold' }).tl === undefined && S.cleanSeasonState({ ...st, tl: '<b>' }).tl === undefined, 'an unknown title is dropped');
  ok(!('tl' in S.cleanSeasonState(S.blankSeasonState())) && S.seasonStateEmpty(S.blankSeasonState()), 'a block without one has no tl at all (old codes re-export unchanged)');
  ok(S.titleById('rk-s1-champion')?.name === 'Cold Iron Champion' && S.titleById('rk-s2-gold')?.name === 'Gold Vanguard', 'titles by id');
  // Through Progress (the save and its code).
  const Prog = (await import('../js/ui/progress.js')).Progress;
  const now = at(2026, 12, 28, 2);
  const data = Prog.season(now);
  ok(data.ranked.k === 'S2' || data.info.key === 'S2', 'Progress rolls to Season 2');
  ok(Prog.setTitle('rk-s1-gold') === false, 'a title not owned cannot be worn');
}

/* ---------- bots ---------- */
console.log('bots');
{
  ok(Pool.POOL_SEED !== undefined, 'the pool seed is there (never changed here)', String(Pool.POOL_SEED));
  const now = at(2026, 12, 20, 15).getTime();
  const entries = B.poolEntries(now);
  const placedBots = entries.filter(e => e.sn.sr >= 0);
  ok(placedBots.length > 20, 'a month in, many pool bots are placed', placedBots.length);
  const roster = [
    { id: 'local', team: 0 },
    ...entries.slice(0, 11).map((e, i) => ({ id: `bot${i}`, isBot: true, pool: e.id, team: i % 2, rating: 0.4, badge: { level: 10, prestige: 0 } })),
  ];
  const out = R.rankedBots(roster, id => B.poolSr(id, now));
  ok(out[0] === roster[0], 'humans pass through untouched');
  ok(out.slice(1).every((r, i) => {
    const sr = entries[i].sn.sr;
    return r.rankSr === sr && r.badge.rk === (sr >= 0 ? R.division(sr).code : -1) && r.badge.level === 10;
  }), 'each pool bot wears the division its Ranked board row shows', out.slice(1).map(r => r.badge.rk).join(','));
  ok(B.poolSr('no-such-bot', now) === -1, 'an unknown bot is unplaced');
}

/* ---------- code ---------- */
console.log('code');
function recordMatch({ mode = 'tdm', map = 'railyard', seconds = 34, seed = 11, teamSize = 6 } = {}) {
  const roster = buildRoster([], { botSkill: 'veteran', teamSize, mapId: map, mode, seed });
  const sim = new Sim({ roster, map: MAPS[map], seed, mode, scoreLimit: 999, timeLimit: 600 });
  const localId = roster[0].id;
  const rec = new ReplayRecorder({ localId });
  const STEP = 1 / SIM_HZ;
  let kills = 0;
  globalThis.performance ??= { now: () => Date.now() };
  for (let i = 0; i < seconds * SIM_HZ; i++) {
    sim.step(STEP);
    const ev = sim.drainEvents();
    kills += ev.filter(e => e.t === 'kill').length;
    const view = sim.decodeSnapshot(sim.encodeSnapshot(), localId);
    rec.record(view, ev, STEP);
  }
  const clip = rec.finish({ mapId: map, mode, roster, myTeam: 0 });
  return { clip, kills, roster };
}
const maps = new Set(Object.keys(MAPS));
{
  const { clip, kills } = recordMatch();
  ok(clip && clip.dur > 25 && kills > 0, 'a recorded bot match', `${clip.dur.toFixed(1)} s, ${kills} kills, ${clip.ev.length} events`);
  const full = await RC.encodeReplay(clip, { from: 0, to: clip.dur, title: 'Railyard TDM' });
  ok(full.ok && full.code.startsWith('SYR1.'), 'the whole clip as a code', `${full.code?.length} chars (${full.bytes} bytes deflated, ${full.raw} raw)`);
  ok(full.code.length < 14000, 'the whole 30 s under 14,000 characters', full.code.length);
  const hl = RC.highlightRange(clip);
  const high = await RC.encodeReplay(clip, hl);
  ok(high.ok && high.code.length < 6000 && high.code.length < full.code.length / 2, 'a highlight is a fraction of it', `${high.code.length} chars for ${high.seconds} s`);
  const dec = await RC.decodeReplay(full.code, { maps });
  ok(dec.ok, 'it decodes', dec.error ?? '');
  const c2 = dec.clip;
  ok(c2.mapId === clip.mapId && c2.mode === 'tdm' && c2.title === 'Railyard TDM' && c2.shared, 'map, mode and title come through');
  ok(Math.abs(c2.dur - clip.dur) < 0.25, 'about the same length', `${c2.dur.toFixed(2)} vs ${clip.dur.toFixed(2)}`);
  // Positions: sample both at many times; every player within a few cm.
  const a = new ClipReader(clip), b = new ClipReader(c2);
  let worst = 0, aliveMismatch = 0, checked = 0;
  for (let t = 0.2; t < c2.dur - 0.2; t += 0.7) {
    const va = a.sample(t + clip.frames.at[0]), byName = new Map(va.players.map(p => [p.name, { x: p.x, z: p.z, alive: p.alive, hp: p.hp, team: p.team, weapon: p.weapon }]));
    const vb = b.sample(t);
    for (const p of vb.players) {
      const q = byName.get(p.name);
      if (!q) continue;
      checked++;
      if (q.alive !== p.alive) { aliveMismatch++; continue; }
      if (!p.alive) continue;
      worst = Math.max(worst, Math.hypot(q.x - p.x, q.z - p.z));
    }
  }
  ok(checked > 200 && worst < 1.2 && aliveMismatch / checked < 0.04, 'the players are where they were', `${checked} samples, worst ${worst.toFixed(2)} m, ${aliveMismatch} life flips at keyframe edges`);
  const k1 = clip.ev.filter(e => e.t === 'kill'), k2 = c2.ev.filter(e => e.t === 'kill');
  ok(k1.length === k2.length && k2.every((e, i) => b.name(e.by) === a.name(k1[i].by) && b.name(e.target) === a.name(k1[i].target) && e.weapon === k1[i].weapon),
    'every kill, with its killer, victim and gun (the feed reads the same)', k2.length);
  ok(c2.ev.filter(e => e.t === 'shot').every(e => e.rays.length <= 1 && typeof e.by === 'string'), 'shots keep one ray and a shooter');
  ok(c2.localId && b.name(c2.localId) === a.name(clip.localId), 'the recording player is still "you"');
  ok(c2.roster.length === c2.cast.length && c2.roster.every(r => r.loadout && 'tracer' in r.loadout), 'a roster the character art can dress');
  const v = b.sample(c2.dur / 2);
  ok(v.players.some(p => p.alive && Math.hypot(p.vx, p.vz) > 0.5), 'running players have a velocity again (from their positions)');
  // A highlight keeps the final kill.
  if (clip.lastKill) {
    const hd = await RC.decodeReplay(high.code, { maps });
    ok(hd.ok && hd.clip.lastKill && hd.clip.lastKill.at >= 0, 'the highlight keeps the final kill', hd.clip?.lastKill);
  }
  // Refusals.
  const bad = async (code, error, name) => { const r = await RC.decodeReplay(code, { maps }); ok(!r.ok && r.error === error, name, r.error); };
  await bad('hello', 'format', 'not a code');
  await bad(`SY4R1.${full.code.slice(5)}`, 'format', 'a save code is not a replay code');
  await bad(full.code.replace(/^SYR1\./, 'SYR0.'), 'version', 'an old version');
  await bad(full.code.replace(/^SYR1\./, 'SYR2.'), 'version', 'a newer version');
  await bad(full.code.slice(0, full.code.length - 40) + full.code.slice(-8), 'checksum', 'a cut paste');
  const mid = Math.floor(full.code.length / 2), flip = full.code[mid] === 'A' ? 'B' : 'A';
  await bad(full.code.slice(0, mid) + flip + full.code.slice(mid + 1), 'checksum', 'a typo');
  ok((await RC.decodeReplay(`  ${full.code.slice(0, 50)}\n${full.code.slice(50)} `, { maps })).ok, 'line breaks and spaces from a chat app are fine');
  // A body that passes the checksum but is not a replay: forged with a valid sum.
  const forge = async body => { const head = 'SYR1'; const { createHash } = await import('node:crypto'); void createHash; let h = 0x811c9dc5; const s = `${head}.${body}`; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return `${head}.${body}.${(h >>> 0).toString(36)}`; };
  await bad(await forge('AAAA'), 'data', 'a body that is not a replay');
  const unknownMap = await RC.decodeReplay(full.code, { maps: new Set(['frontier']) });
  ok(!unknownMap.ok && unknownMap.error === 'map', 'a map this build lacks', unknownMap.error);
  ok(Object.keys(RC.CODE_ERRORS).every(k => RC.CODE_ERRORS[k].length > 10), 'every refusal has words for the player');
  // Determinism: the same clip makes the same code.
  const again = await RC.encodeReplay(clip, { from: 0, to: clip.dur, title: 'Railyard TDM' });
  ok(again.code === full.code, 'the same clip makes the same code');
  if (!QUICK) {
    const gw = recordMatch({ mode: 'tdm', map: 'harvest', seconds: 32, teamSize: 16, seed: 5 });
    const gc = await RC.encodeReplay(gw.clip, { from: 0, to: gw.clip.dur });
    const gd = gc.ok && await RC.decodeReplay(gc.code, { maps });
    ok(gc.ok && gd.ok && gd.clip.cast.length >= 30, 'Ground War 16 a side: the whole clip', `${gc.code?.length} chars, ${gd.clip?.cast.length} players`);
    const gh = await RC.encodeReplay(gw.clip, RC.highlightRange(gw.clip));
    ok(gh.ok && gh.code.length < 16000, 'and its highlight', gh.code.length);
  }
}

/* ---------- caster ---------- */
console.log('caster');
{
  const players = [
    { id: 'a', team: 0, alive: true, x: 10, z: 10, score: 300, kills: 3, deaths: 1 },
    { id: 'b', team: 1, alive: true, x: 40, z: 20, score: 500, kills: 5, deaths: 2 },
    { id: 'c', team: 0, alive: false, x: 0, z: 0, score: 100, kills: 1, deaths: 3 },
    { id: 'd', team: 1, alive: true, x: 30, z: 30, score: 200, kills: 2, deaths: 2 },
    { id: 'z', team: 9, alive: true, x: 5, z: 5, zk: 1, ai: true },
  ];
  const view = { players };
  ok(C.followable(players[0]) && !C.followable(players[2]) && !C.followable(players[4]), 'only the living, and no zombies or patrols');
  ok(C.cycle(view, 'a', 1) === 'b' && C.cycle(view, 'b', 1) === 'd' && C.cycle(view, 'd', 1) === 'a', 'Next goes round the living');
  ok(C.cycle(view, 'a', -1) === 'd', 'Previous goes back');
  ok(C.cycle(view, null, 1) === 'a' && C.cycle(view, 'c', 1) === 'a', 'from nobody (or the dead) to the first');
  const order = C.listOrder(players, [], 0);
  ok(order.map(p => p.id).join('') === 'acbd', 'the list: side by side, best score first', order.map(p => p.id).join(''));
  const fr = C.tacticalFrame(players.filter(C.followable), { width: 120, height: 80 });
  ok(fr.x > 10 && fr.x < 40 && fr.dist >= C.TACTICAL_MIN && fr.dist <= C.TACTICAL_MAX, 'the tactical view frames the fight', fr);
  const empty = C.tacticalFrame([], { width: 120, height: 80 });
  ok(empty.x === 60 && empty.z === 40, 'and the map centre with nobody to frame', empty);
  const sh = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 26 };
  C.aimShot(sh, { x: 50, z: 50, dist: 30, fov: 26 }, 1);
  const sx = sh.tx; C.aimShot(sh, { x: 90, z: 50, dist: 30, fov: 26 }, 1 / 60);
  ok(sx === 50 && sh.tx > 50 && sh.tx < 55, 'a cut eases over (no jump)', sh.tx.toFixed(2));
}

console.log(`\n${passes} passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
