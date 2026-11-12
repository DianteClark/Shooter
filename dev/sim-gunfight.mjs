// Showdown headless test (ROADMAP 31, docs/MODES.md "Showdown"; the roadmap's working name was Gunfight): 2 v 2 rounds on
// the small maps with one dealt kit for everyone.
//   node dev/sim-gunfight.mjs          units, overtime, phones' kits, determinism, then bot matches on every small map
//   node dev/sim-gunfight.mjs --quick  one match per map
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS, MAP_IDS } from '../js/shared/map.js';
import { MODES, modeFitsMap } from '../js/shared/modes.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { WEAPONS } from '../js/shared/weapons.js';
import { GF, kitFor, flagSpot } from '../js/sim/gf.js';
import { cleanMods, featured, FEATURED } from '../js/shared/playlist.js';
import { CHALLENGE_POOL } from '../js/shared/progression.js';
import { NavGrid } from '../js/sim/nav.js';

const STEP = 1 / SIM_HZ;
const QUICK = process.argv.includes('--quick');
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };
const makeSim = (mapId, seed, humans = []) => new Sim({ roster: buildRoster(humans, { botSkill: 'mixed', mode: 'gf', mapId, seed }), map: MAPS[mapId], seed, mode: 'gf' });
const GF_MAPS = MAP_IDS.filter(id => modeFitsMap(MAPS[id], 'gf'));

function units() {
  console.log('units');
  check(GF_MAPS.length >= 2 && GF_MAPS.length <= 4 && GF_MAPS.every(id => MAPS[id].size === 'small'), `small maps only: ${GF_MAPS.join(', ')}`);
  check(MODES.gf.teamSize === 2 && MODES.gf.scoreLimit === 6 && MODES.gf.timeLimit === 40, '2 v 2, first to 6, 40 s rounds');
  check(cleanMods(['snipers', 'hardcore'], 'gf').join() === 'hardcore', 'deals its own guns: Snipers Only does not apply, Hardcore does');
  check(FEATURED.some(f => f.mode === 'gf'), 'in the featured rotation');
  void featured;
  check(CHALLENGE_POOL.some(c => c.stat === 'played:gf'), 'a daily challenge for it ("Play 2 Showdown matches")');
  // Kits: the same for a seed and number, different across numbers, real guns.
  const ks = Array.from({ length: 12 }, (_, k) => kitFor(77, k));
  check(JSON.stringify(kitFor(77, 3)) === JSON.stringify(kitFor(77, 3)), 'a kit is the same on every phone');
  check(new Set(ks.map(k => k.primary)).size >= 5 && ks.every(k => WEAPONS[k.primary] && WEAPONS[k.secondary]), `kits vary (${new Set(ks.map(k => k.primary)).size} guns in 12)`);
  // The flag: in the middle, on open ground every bot can reach from both ends.
  for (const id of GF_MAPS) {
    const map = MAPS[id], f = flagSpot(map), nav = new NavGrid(map);
    const ok = nav.isWalkable(f.x, f.z) && Math.hypot(f.x - map.width / 2, f.z - map.height / 2) < 12;
    check(ok, `${id}: overtime flag at ${f.x}, ${f.z}`);
  }
  // Rosters: solo is you and a bot against two; two friends against two bots.
  const solo = buildRoster([{ id: 'h1', name: 'Me', team: 0 }], { mode: 'gf', mapId: 'pier', seed: 1 });
  const duo = buildRoster([{ id: 'h1', name: 'Me', team: 0 }, { id: 'h2', name: 'Pal', team: 0 }], { mode: 'gf', mapId: 'pier', seed: 1 });
  check(solo.length === 4 && solo.filter(r => r.team === 0).length === 2 && solo.filter(r => r.isBot).length === 3, 'solo: you and a bot v two bots');
  check(duo.length === 4 && duo.filter(r => r.team === 0 && !r.isBot).length === 2 && duo.filter(r => r.isBot && r.team === 1).length === 2, 'friends: the two of you v two bots');
}

// Everyone holds the same kit each round, a new one every two rounds; a phone deals itself the same one.
function kits() {
  console.log('kits');
  const humans = [{ id: 'h1', name: 'Me', team: 0, loadout: { primary: 'sniper', camos: {} } }];
  const sim = makeSim('oasis', 31, humans), guest = makeSim('oasis', 31, humans);
  const seen = [];
  let same = true, phone = true, t = 0;
  while (sim.phase !== 'ended' && t < SIM_HZ * 60 * 12) {
    sim.step(STEP); t++;
    for (const e of sim.drainEvents()) {
      if (e.t === 'gf' && e.kind === 'round') guest.rules.event(e);
      if (e.t === 'gf' && e.kind === 'go') {
        const guns = sim.players.map(p => `${p.ps.primary}/${p.ps.secondary}`);
        if (new Set(guns).size !== 1) same = false;
        seen.push(sim.players[1].ps.primary);
        // The guest's codec deals the phone's own player the host's kit.
        const dealt = guest.dealFor('h1', { primary: 'sniper', secondary: 'pistol' });
        if (dealt.primary !== sim.byId.get('h1').loadout.primary || dealt.lethal !== sim.byId.get('h1').loadout.lethal) phone = false;
      }
    }
  }
  check(same && seen.length >= 6, `all four carry the same guns every round (${seen.length} rounds)`);
  const pairs = seen.every((g, i) => i % 2 === 0 || g === seen[i - 1]);
  const changes = seen.filter((g, i) => i % 2 === 0 && i > 0 && g !== seen[i - 2]).length;
  check(pairs && changes >= 1, `the kit holds for two rounds, then changes (${seen.join(' ')})`);
  check(phone, 'a phone deals itself the same kit as the host');
  check(sim.players.every(p => p.loadout.streaks.length === 0), 'no scorestreaks');
}

// Overtime: the flag after the clock, taken by a side alone on it; or more health at the end; or a draw.
function overtime() {
  console.log('overtime');
  const run = (setup, label) => {
    const sim = makeSim('pier', 3);
    sim.step(STEP);
    for (const p of sim.players) p.bot.update = () => [];        // Nobody moves or shoots.
    const ev = [];
    let t = 0;
    while (t < SIM_HZ * (GF.freeze + MODES.gf.timeLimit + GF.ot + 3) && !ev.some(e => e.t === 'gf' && e.kind === 'end')) {
      sim.step(STEP); t++;
      if (sim.rules.overtime) setup(sim);
      ev.push(...sim.drainEvents());
    }
    const ot = ev.find(e => e.t === 'gf' && e.kind === 'overtime'), end = ev.find(e => e.t === 'gf' && e.kind === 'end');
    console.log(`    ${label}: ${end ? `${end.winner}:${end.reason}` : 'no end'} after ${(sim.time).toFixed(0)} s`);
    return { sim, ot, end };
  };
  const a = run(sim => { const p = sim.players.find(q => q.team === 1); p.ps.x = sim.rules.flag.x; p.ps.z = sim.rules.flag.z; }, 'team 1 on the flag');
  check(a.ot && a.sim.time > GF.freeze + MODES.gf.timeLimit - 1, 'the flag rises when the round clock runs out');
  check(a.end?.winner === 1 && a.end.reason === 'flag' && a.sim.scores[1] === 1, 'a side alone on the flag takes the round');
  const b = run(sim => { for (const p of sim.players) if (p.team === 0) p.hp = 60; }, 'team 0 hurt');
  check(b.end?.winner === 1 && b.end.reason === 'health', 'nobody on the flag: more health left wins');
  const c = run(() => {}, 'level');
  check(c.end?.winner === -1 && c.end.reason === 'draw' && c.sim.scores[0] + c.sim.scores[1] === 0, 'level health: a drawn round, no point');
  const d = run(sim => { for (const p of sim.players) { p.ps.x = sim.rules.flag.x + (p.team ? 0.5 : -0.5); p.ps.z = sim.rules.flag.z; } }, 'both on the flag');
  check(d.end?.reason !== 'flag', 'both sides on the flag: nobody takes it');
}

function determinism() {
  console.log('determinism');
  const hash = seed => {
    const sim = makeSim('turnstile', seed);
    let h = 0;
    for (let i = 0; i < 90 * SIM_HZ && sim.phase !== 'ended'; i++) {
      sim.step(STEP);
      for (const e of sim.drainEvents()) { const s = `${e.t}${e.id ?? ''}${e.target ?? ''}${e.kind ?? ''}`; for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0; }
    }
    return `${h}:${sim.scores.join('-')}`;
  };
  const a = hash(8), b = hash(8);
  check(a === b, `two runs of seed 8 match (${a})`);
}

function matches() {
  console.log('matches');
  const lens = [];
  for (const id of GF_MAPS) {
    for (const seed of QUICK ? [5] : [5, 9]) {
      const sim = makeSim(id, seed, seed === 9 ? [{ id: 'h1', name: 'Me', team: 0 }] : []);
      const ends = [];
      let t = 0, kills = 0;
      while (sim.phase !== 'ended' && t < SIM_HZ * 60 * 20) {
        sim.step(STEP); t++;
        for (const e of sim.drainEvents()) { if (e.t === 'gf' && e.kind === 'end') ends.push(e); if (e.t === 'kill') kills++; }
        // A human seat (seed 9) stands where it spawned, as an idle phone would: the bots still finish rounds.
      }
      const min = sim.time / 60;
      lens.push(min);
      const top = Math.max(...sim.scores);
      console.log(`  ${id} seed ${seed}: ${min.toFixed(1)} min, ${sim.scores.join('-')}, ${ends.length} rounds (${ends.map(e => e.reason[0]).join('')}), ${kills} kills`);
      check(sim.phase === 'ended' && (top === MODES.gf.scoreLimit || ends.length >= GF.maxRounds), `${id} ${seed}: first to ${MODES.gf.scoreLimit}`);
      check(ends.length >= 6 && ends.length <= GF.maxRounds, `${id} ${seed}: ${ends.length} rounds`);
      const roundLen = (sim.time - ends.length * (GF.freeze + GF.post)) / ends.length;
      check(roundLen > 4 && roundLen < MODES.gf.timeLimit + GF.ot, `${id} ${seed}: rounds of ${roundLen.toFixed(0)} s of play`);
    }
  }
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  check(mean >= 2 && mean <= 8, `mean match ${mean.toFixed(1)} min (2-8)`);
}

units();
kits();
overtime();
determinism();
matches();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
