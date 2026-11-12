// Rebound headless test (ROADMAP 27, docs/BR.md "Rebound"; the roadmap's working name was Resurgence): the battle royale
// variant on part of Frontier, with redeploys while a squadmate is in.
//   node dev/sim-resurgence.mjs           units, redeploy rules, a guest's view, determinism, then 4 quads + 3 duos matches
//   node dev/sim-resurgence.mjs --quick   the same with one match of each
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS } from '../js/shared/map.js';
import { BR, RB, MODES, brPhases, isBr, isRebound } from '../js/shared/modes.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { reboundArea } from '../js/sim/br.js';
import { cleanMods } from '../js/shared/playlist.js';

const STEP = 1 / SIM_HZ;
const QUICK = process.argv.includes('--quick');
const MAP = MAPS.frontier;
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };

const makeSim = (mode, seed, humans = []) => new Sim({ roster: buildRoster(humans, { botSkill: 'mixed', mode, mapId: MAP.id, seed }), map: MAP, seed, mode });
const stepFor = (sim, s, sink = null) => { for (let i = 0; i < s * SIM_HZ && sim.phase !== 'ended'; i++) { sim.step(STEP); const ev = sim.drainEvents(); if (sink) sink.push(...ev); } };
const live = sim => { while (sim.phase !== 'live') sim.step(STEP); };

function units() {
  console.log('units');
  check(isBr('rb') && isBr('rbduo') && isRebound('rb') && !isRebound('br'), 'Rebound is a battle royale mode with the rebound switch');
  check(MODES.rb.players >= 16 && MODES.rb.players <= 24 && MODES.rbduo.players >= 16 && MODES.rbduo.players <= 24, `seats: quads ${MODES.rb.players}, duos ${MODES.rbduo.players}`);
  check(brPhases('rb') === RB.phases && brPhases('br') === BR.phases, 'its own circle phases');
  const circle = RB.phases.reduce((a, p) => a + p.wait + p.shrink, 0);
  check(circle >= 8 * 60 && circle <= 10 * 60, `the circle closes in ${(circle / 60).toFixed(1)} min (8-10)`);
  check(cleanMods(['hardcore'], 'rb').length === 0, 'no modifiers');
  // The area: on the map, the same for a seed, several regions across seeds, each with places to land.
  const areas = new Set();
  let fine = true;
  for (let s = 1; s <= 40; s++) {
    const a = reboundArea(MAP, s), b = reboundArea(MAP, s);
    if (a.x !== b.x || a.z !== b.z) fine = false;
    if (a.x - a.r < 0 || a.z - a.r < 0 || a.x + a.r > MAP.width || a.z + a.r > MAP.height) fine = false;
    const pois = MAP.br.pois.filter(q => Math.hypot(q.x - a.x, q.z - a.z) < a.r - 8).length;
    if (pois < 5) fine = false;
    areas.add(`${a.x},${a.z}`);
  }
  check(fine, 'the area is on the map, the same on every phone for a seed, with 5 or more places in it');
  check(areas.size >= 3, `the seed moves it around the map (${areas.size} areas over 40 seeds)`);
  const area = MAP.width * MAP.height, part = Math.PI * RB.area * RB.area;
  check(part < area * 0.6, `a smaller playable area: ${(part / area * 100).toFixed(0)}% of Frontier`);
  // (The playlists, lobby size and vote are checked in the browser: dev/ui-modes2-test.py.)
  // A match: area, circle, flight line, drops inside it.
  const sim = makeSim('rb', 4, [{ id: 'h1', name: 'Me', team: 0 }, { id: 'h2', name: 'Pal', team: 0 }]);
  const A = sim.br.area;
  check(sim.players.length === MODES.rb.players && new Set(sim.players.map(p => p.team)).size === MODES.rb.players / 4, `${sim.players.length} players in squads of four`);
  check(sim.byId.get('h1').team === sim.byId.get('h2').team, 'friends share a squad');
  check(Math.abs(sim.br.circle.r - A.r) < 0.01 && sim.br.circle.x === A.x, 'the first circle is the area');
  const pl = sim.br.plane, mx = (pl.fx + pl.tx) / 2, mz = (pl.fz + pl.tz) / 2;
  check(Math.hypot(mx - A.x, mz - A.z) < A.r * 0.3 && pl.len < A.r * 2 + 2 * BR.planeOver + 1, 'the transport crosses the area');
  live(sim);
  stepFor(sim, 30);
  const landed = sim.players.filter(p => p.isBot && p.brAir === 0);
  const inside = landed.filter(p => Math.hypot(p.ps.x - A.x, p.ps.z - A.z) < A.r + 4).length;
  check(landed.length > 15 && inside === landed.length, `bots land inside the area (${inside}/${landed.length})`);
}

// Redeploys: a death with a squadmate up waits, then parachutes in near the squad with a starter kit; none past the
// cut-off; a squad with nobody left up is out and nobody in it comes back.
function redeploys() {
  console.log('redeploys');
  const sim = makeSim('rb', 9, [{ id: 'h1', name: 'Me', team: 0 }]);
  live(sim);
  stepFor(sim, 25);
  const me = sim.byId.get('h1'), mates = sim.players.filter(p => p.team === me.team && p !== me);
  me.brAir = 0; me.br.landed = true;
  for (const q of mates) { q.ps.x = me.ps.x + 3; q.ps.z = me.ps.z; q.brAir = 0; q.alive = true; q.downed = false; }
  const ev = [];
  sim.drainEvents();
  sim.br._die(me, null, null, 'test');
  ev.push(...sim.drainEvents());
  const wait = ev.find(e => e.t === 'brwait' && e.id === 'h1');
  check(!me.alive && wait && Math.abs(wait.secs - RB.redeploy[sim.br.phase]) < 0.01, `dead, redeploy in ${wait?.secs} s`);
  // A guest's phone sees its countdown and the squad panel's mark.
  const guest = makeSim('rb', 9, [{ id: 'h1', name: 'Me', team: 0 }]);
  const gv = guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshotFor('h1'))), 'h1');
  check(gv.br.inv?.redeploy > 0 && gv.players.find(p => p.id === 'h1').redeploy && gv.br.rebound && gv.br.area?.r === sim.br.area.r, `the guest's view: countdown ${gv.br.inv?.redeploy} s, the redeploy mark, the area`);
  // Hold the squad still and safe while it waits.
  for (let i = 0; i < (RB.redeploy[sim.br.phase] + 1) * SIM_HZ; i++) {
    for (const q of mates) { q.hp = 100; q.alive = true; q.downed = false; }
    sim.step(STEP); ev.push(...sim.drainEvents());
  }
  const back = ev.find(e => e.t === 'brredeploy' && e.id === 'h1');
  const near = back && Math.hypot(back.x - sim.byId.get(back.by).ps.x, back.z - sim.byId.get(back.by).ps.z);
  check(me.alive && back && near < 16, `back in next to a squadmate (${near?.toFixed(1)} m)`);
  check(me.brAir === 2 && me.br.glideT > 0, 'on the parachute');
  check(me.br.guns[0] && me.br.guns[0].r <= RB.kitRarity && me.br.guns[1]?.id === 'pistol' && me.br.armor === RB.kitArmor, `a starter kit: ${me.br.guns[0]?.id} (rarity ${me.br.guns[0]?.r}), pistol, ${me.br.armor} armor`);
  const inv = ev.filter(e => e.t === 'brinv' && e.id === 'h1').at(-1);
  check(inv && inv.air === 2 && inv.glideT > 0 && inv.guns[0], 'the phone is told: guns, and that it is gliding');
  stepFor(sim, BR.glide + 1, ev);
  check(me.brAir === 0, 'landed');
  // Past the cut-off a death is final.
  sim.br.phase = RB.redeployEnd;
  for (const q of mates) { q.alive = true; q.hp = 100; }
  sim.br._die(me, null, null, 'test');
  check(!me.alive && !(me.br.redeployT > 0), `no redeploy from circle ${RB.redeployEnd + 1}`);
  // A squad wiped while one of them waits: out, and the wait is cancelled.
  sim.br.phase = 1;
  const s2 = makeSim('rb', 12);
  live(s2); stepFor(s2, 25);
  const team = s2.players[0].team, sq = s2.players.filter(p => p.team === team);
  for (const p of sq) { p.brAir = 0; }
  s2.br._die(sq[0], null, null, 'test');
  check(sq[0].br.redeployT > 0, 'first death of a squad waits to redeploy');
  for (const p of sq.slice(1)) s2.br._die(p, null, null, 'test');
  check(s2.br.squadsOut.has(team), 'the rest dead: the squad is out');
  stepFor(s2, RB.redeploy[0] + 2);
  check(sq.every(p => !p.alive), 'and nobody in it comes back');
  // Downed while a squadmate is on the way back in: a down, not a death.
  const s3 = makeSim('rb', 14);
  live(s3); stepFor(s3, 25);
  const t3 = s3.players[0].team, q3 = s3.players.filter(p => p.team === t3);
  for (const p of q3) p.brAir = 0;
  for (const p of q3.slice(0, 3)) s3.br._die(p, null, null, 'test');
  check(q3.slice(0, 3).every(p => p.br.redeployT > 0), 'three dead, all waiting (the fourth is up)');
  check(s3.br.tryDown(q3[3], null, null) && q3[3].downed && !s3.br.squadsOut.has(t3), 'the last one up goes down, not out: help is coming');
  let ok = false;
  for (let i = 0; i < (RB.redeploy[0] + BR.glide + 8) * SIM_HZ && !ok; i++) { s3.step(STEP); s3.drainEvents(); if (!q3[3].downed && q3[3].alive) ok = true; q3[3].hp = Math.max(q3[3].hp, 60); }
  check(ok, 'a redeployed bot lands by the downed one and revives them');
}

// The same seed plays the same match.
function determinism() {
  console.log('determinism');
  const hash = seed => {
    const sim = makeSim('rb', seed);
    let h = 0;
    for (let i = 0; i < 150 * SIM_HZ && sim.phase !== 'ended'; i++) {
      sim.step(STEP);
      for (const e of sim.drainEvents()) { const s = `${e.t}${e.id ?? ''}${e.target ?? ''}${e.x ?? ''}`; for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0; }
    }
    return `${h}:${sim.players.map(p => `${p.ps.x.toFixed(2)},${p.ps.z.toFixed(2)}`).join(';').length}:${sim.players.filter(p => p.alive).length}`;
  };
  const a = hash(21), b = hash(21);
  check(a === b, `two runs of seed 21 match (${a})`);
}

function runMatch(mode, seed) {
  const sim = makeSim(mode, seed);
  const ev = { kill: 0, brwait: 0, brredeploy: 0, brsquad: 0, revive: 0 };
  let landFar = 0, tick = 0, redeployOk = true;
  while (sim.phase !== 'ended' && tick < SIM_HZ * 60 * 16) {
    sim.step(STEP); tick++;
    for (const e of sim.drainEvents()) {
      if (e.t in ev) ev[e.t]++;
      if (e.t === 'brredeploy') {
        const by = sim.byId.get(e.by);
        // (A mate outside the circle, or still in the air, has the landing pulled in toward the middle.)
        const c = sim.br.circle, inC = Math.hypot(by.ps.x - c.x, by.ps.z - c.z) < c.r * 0.85;
        if (inC && !by.brAir && Math.hypot(by.ps.x - e.x, by.ps.z - e.z) > 20) landFar++;
        if (sim.br.phase >= RB.redeployEnd + 1) redeployOk = false;     // A wait from before the cut-off may land just after it.
      }
    }
  }
  const alive = sim.players.filter(p => p.alive);
  return { sim, mode, seed, minutes: sim.time / 60, ev, landFar, redeployOk, alive };
}

function matches() {
  console.log('matches');
  const runs = [];
  const seeds = QUICK ? { rb: [5], rbduo: [6] } : { rb: [5, 6, 8, 10], rbduo: [5, 6, 7] };
  for (const mode of ['rb', 'rbduo']) {
    for (const seed of seeds[mode]) {
      const r = runMatch(mode, seed);
      runs.push(r);
      console.log(`  ${mode} seed ${seed}: ${r.minutes.toFixed(1)} min, winner ${r.sim.winner}, ${JSON.stringify(r.ev)}`);
      check(r.sim.phase === 'ended' && r.alive.every(p => p.team === r.sim.winner), `${mode} ${seed}: one squad left standing`);
      check(r.minutes >= 4.5 && r.minutes <= 11, `${mode} ${seed}: ${r.minutes.toFixed(1)} min (4.5-11)`);
      check(r.ev.brredeploy >= 3 && r.landFar === 0, `${mode} ${seed}: ${r.ev.brredeploy} redeploys, all next to a squadmate (${r.landFar} far)`);
      check(r.redeployOk, `${mode} ${seed}: no redeploy after the cut-off`);
    }
  }
  const mean = runs.reduce((a, r) => a + r.minutes, 0) / runs.length;
  // Bot-only battle royales run shorter than ones with people in them (docs/BR.md); the circle is 9 minutes.
  check(mean >= 6 && mean <= 10, `mean match ${mean.toFixed(1)} min (6-10 for bots alone; the circle closes at ${(RB.phases.reduce((a, p) => a + p.wait + p.shrink, 0) / 60).toFixed(1)})`);
}

units();
redeploys();
determinism();
matches();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
