// Battle royale headless test (docs/BR.md): full 32-player bot matches on the dev BR map, with rule checks.
//   node dev/sim-br.mjs            quads, duos and solos, plus the unit checks
//   node dev/sim-br.mjs --quick    one quads match and the unit checks (--map=brtest for the test map)
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS } from '../js/shared/map.js';
import { BR } from '../js/shared/modes.js';
import { SIM_HZ, MAX_HP } from '../js/shared/constants.js';
import { BR_KIND } from '../js/sim/br.js';
import { brMode, cleanSquad } from '../js/ui/br-squad.js';

const STEP = 1 / SIM_HZ;
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const MAP = MAPS[(args.find(a => a.startsWith('--map=')) ?? '--map=frontier').slice(6)];   // --map=brtest: the small stand-in.
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };

function makeSim(mode, seed, humans = []) {
  const roster = buildRoster(humans, { botSkill: 'mixed', mode, mapId: MAP.id, seed });
  return new Sim({ roster, map: MAP, seed, mode });
}

function runMatch(mode, seed) {
  const sim = makeSim(mode, seed);
  const t0 = performance.now();
  sim.step(STEP);
  const startMs = performance.now() - t0;
  const times = [];
  const ev = { kill: 0, down: 0, revive: 0, brgive: 0, brchest: 0, brplate: 0, brsquad: 0, pick: 0, plateHits: 0, zoneDeaths: 0, landed: 0 };
  const snapBytes = [];
  const guests = sim.players.slice(0, 7);
  const killT = [];                             // Live seconds of each death (kills, circle, bleed-outs).
  let liveT0 = null, finalSquads = null, finalPhase = 4;
  const phaseSquads = [];                       // Squads in as each circle phase begins.       // Pretend seven of them are guests, for the per-guest snapshot size.
  let tick = 0;
  const maxTicks = SIM_HZ * 60 * 14;
  while (sim.phase !== 'ended' && tick < maxTicks) {
    const c = process.cpuUsage();
    sim.step(STEP);
    const cu = process.cpuUsage(c);
    tick++;
    if (sim.phase === 'live' && liveT0 === null) liveT0 = sim.time;
    // Squads still in when the final circles start (phase finalPhase's wait).
    if (finalSquads === null && sim.br.phase >= finalPhase) finalSquads = sim.br._squadsIn().size;
    if (sim.br.phase > phaseSquads.length) phaseSquads.push(sim.br._squadsIn().size);
    if (sim.phase === 'live' && tick > SIM_HZ * 12) times.push((cu.user + cu.system) / 1000);
    if (tick % 2 === 0 && sim.phase === 'live') {
      for (const g of guests) snapBytes.push(JSON.stringify(sim.encodeSnapshotFor(g.id)).length);
    }
    for (const e of sim.drainEvents()) {
      if (e.t in ev) ev[e.t]++;
      if (e.t === 'brpick') ev.pick++;
      if (e.t === 'hit' && e.plate) ev.plateHits++;
      if (e.t === 'kill' && e.equip === 'zone') ev.zoneDeaths++;
      if (e.t === 'kill') killT.push(sim.time - (liveT0 ?? 0));
      if (e.t === 'brland') ev.landed++;
    }
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const winner = sim.winner;
  const alive = sim.players.filter(p => p.alive);
  const snapMean = snapBytes.reduce((a, b) => a + b, 0) / snapBytes.length;
  const removed = sim.br.items.filter(x => x === null).length;
  const early = killT.filter(t => t < 180).length / Math.max(1, killT.length);
  const bins = [0, 0, 0, 0];                    // Deaths in 0-3, 3-6, 6-9, 9+ minutes.
  for (const t of killT) bins[Math.min(3, Math.floor(t / 180))]++;
  return { sim, mode, early, bins, phaseSquads, finalSquads: finalSquads ?? 0, minutes: sim.time / 60, mean, p99: times[Math.floor(times.length * 0.99)], worst: times[times.length - 1], startMs, ev, winner, alive, snapMean, snapMax: Math.max(...snapBytes), removed };
}

function report(r) {
  const { sim, ev } = r;
  console.log(`${r.mode}: ${r.minutes.toFixed(1)} sim min, winner team ${r.winner} (${r.alive.length} alive), tick mean ${r.mean.toFixed(2)} ms p99 ${r.p99.toFixed(1)} worst ${r.worst.toFixed(1)}, first tick ${r.startMs.toFixed(0)} ms`);
  console.log(`  pacing: deaths by 3-min bin ${r.bins.join('/')}, ${(r.early * 100).toFixed(0)}% in the first 3 min, circle deaths ${sim.br.zoneDeaths ?? 0}, squads at the final circles ${r.finalSquads}`);
  console.log(`  events ${JSON.stringify(ev)}, loot taken ${r.removed}/${sim.br.items.length}, snapshot per guest ${r.snapMean.toFixed(0)} B mean ${r.snapMax} B max`);
  check(sim.phase === 'ended' && r.minutes < 12, `${r.mode}: one squad wins inside 12 sim minutes`);
  check(r.alive.every(p => p.team === r.winner), `${r.mode}: everyone alive is on the winning squad`);
  check(ev.landed >= 30, `${r.mode}: everyone jumped and landed`);
  check(r.removed > 60 && ev.brgive > 20, `${r.mode}: loot picked up (guns ${ev.brgive})`);
  check(ev.brplate > 5 && ev.plateHits > 5, `${r.mode}: plates go on and soak hits`);
  // Revives are rare per match (0-9 over seeds 11-14 on Frontier), so they are checked over all squad matches together.
  if (sim.br.downs) check(ev.down > 5, `${r.mode}: downs (${ev.down}) and revives (${ev.revive})`);
  else check(ev.down === 0, `${r.mode}: no downs in solos`);
  check(ev.brsquad === new Set(sim.players.map(p => p.team)).size - 1, `${r.mode}: every other squad wiped (${ev.brsquad})`);
  check(r.mean < 4, `${r.mode}: host tick mean under 4 ms`);
  check(r.worst < 50, `${r.mode}: no tick over 50 ms after warm-up`);
}

// ---- Unit checks on a hand-driven match ----
function units() {
  console.log('units');
  const sim = makeSim('br', 3, [{ id: 'h1', name: 'Me', team: 0 }, { id: 'h2', name: 'Pal', team: 0 }]);
  const me = sim.byId.get('h1'), pal = sim.byId.get('h2');
  check(me.team === pal.team, 'friends share a squad');
  check(sim.players.length === 32 && new Set(sim.players.map(p => p.team)).size === 8, '32 players in 8 squads');
  check(sim.br.items.filter(Boolean).length > 400, `loot spawned (${sim.br.items.filter(Boolean).length})`);
  check(me.brAir === 1 && me.ps.weapon === 'knife' && me.ps.secondary === 'pistol', 'aboard with fists and a pistol');
  // Warmup, then jump.
  while (sim.phase !== 'live') sim.step(STEP);
  check(sim.applyCommand('h1', { cmd: 'br', act: 'jump' }), 'jump accepted');
  check(me.brAir === 2, 'gliding');
  for (let i = 0; i < SIM_HZ * (BR.glide + 1); i++) sim.step(STEP);
  check(me.brAir === 0, 'landed');
  // Put me next to a plate and a gun.
  const nav = sim.nav;
  const k = nav.nearestFree(200, 200); me.ps.x = k % nav.w + 0.5; me.ps.z = Math.floor(k / nav.w) + 0.5;
  pal.brAir = 0; pal.ps.x = me.ps.x + 4; pal.ps.z = me.ps.z;
  for (const p of sim.players) if (p !== me && p !== pal && p.alive && Math.hypot(p.ps.x - me.ps.x, p.ps.z - me.ps.z) < 60) { p.ps.x = 5; p.ps.z = 5; }
  const plate = sim.br._addItem({ kind: BR_KIND.plate, v: 0, r: 0, n: 2, x: me.ps.x, z: me.ps.z });
  const gun = sim.br._addItem({ kind: BR_KIND.gun, v: 0, r: 4, n: 1, x: me.ps.x + 0.3, z: me.ps.z, kit: {} });
  sim.drainEvents();
  for (let i = 0; i < 6; i++) sim.step(STEP);
  check(me.br.plates === 2 && !sim.br.items[plate.id], `plates picked up by walking over them`);
  check(me.br.guns[0]?.r === 4 && me.ps.weapon === me.br.guns[0].id, 'gun into the empty hand, and in hand');
  check(sim.drainEvents().some(e => e.t === 'brgive' && e.id === 'h1'), 'gun handed to the phone (brgive)');
  sim.applyCommand('h1', { cmd: 'br', act: 'plate' });
  for (let i = 0; i < SIM_HZ * BR.plateTime * 2 + 4; i++) sim.step(STEP);
  check(me.br.armor === 100 && me.br.plates === 0, `two plates on (${me.br.armor})`);
  // Plates absorb damage.
  const foe = sim.players.find(p => p.team !== me.team && p.alive);
  sim._damage(me, foe, 60, 'ar', 10);
  check(me.br.armor === 40 && me.hp === MAX_HP, 'plates soak before health');
  sim._damage(me, foe, 200, 'ar', 10);
  check(me.downed && me.alive, 'lethal damage downs while a teammate is up');
  const hp0 = me.hp;
  sim.step(STEP);
  check(me.hp < hp0, 'downed players bleed');
  sim.applyHumanState('h2', { x: me.ps.x + 1, z: me.ps.z, aim: 0, vx: 0, vz: 0, slot: 0, primary: 'knife', weapon: 'knife', secondary: 'pistol', sprinting: false, sliding: false, ammo: [1, 12], reserve: [999, 24], reloadT: 0, reloadDur: 0, adsT: 0, bloom: 0 });
  pal.ps.x = me.ps.x + 1; pal.ps.z = me.ps.z;
  for (let i = 0; i < SIM_HZ * (BR.reviveTime + 0.5); i++) { pal.ps.x = me.ps.x + 1; pal.ps.z = me.ps.z; pal.ps.vx = 0; pal.ps.vz = 0; sim.step(STEP); }
  check(!me.downed && me.alive && me.hp > 0, 'a teammate standing close revives');
  // Circle damages outside.
  const W = sim.map.width;
  sim.br.circle = { x: W / 2, z: W / 2, r: 10 };
  sim.br.state = 'final';
  pal.ps.x = 20; pal.ps.z = 20; const pHp = pal.hp;
  sim.step(STEP); sim.step(STEP);
  check(pal.hp < pHp, 'the circle hurts outside');
  // Both out: squad wiped when the last one up goes down. The squad's two bots go first.
  for (const b of sim.players.filter(q => q.team === me.team && q.isBot)) { sim._damage(b, foe, 500, 'ar', 10); sim._damage(b, foe, 500, 'ar', 10); }
  check(sim.players.filter(q => q.team === me.team && q.isBot).every(q => !q.alive), 'squad bots finished off');
  sim._damage(me, foe, 500, 'ar', 10);
  check(me.downed, 'downed again');
  sim._damage(pal, foe, 500, 'ar', 10);
  check(!pal.alive && !me.alive, 'last one up dies outright and the downed teammate goes with them');
  check(sim.br.squadsOut.has(me.team), 'squad wiped');
  // Wire: a guest's codec mirrors the circle, loot changes and inventory.
  const guest = makeSim('br', 3, [{ id: 'h1', name: 'Me', team: 0 }, { id: 'h2', name: 'Pal', team: 0 }]);
  const snap = sim.encodeSnapshotFor('h2');
  const view = guest.decodeSnapshot(JSON.parse(JSON.stringify(snap)), 'h2');
  check(view.br && Math.abs(view.br.circle.r - 10) < 0.2, 'guest sees the circle');
  const hostItems = sim.br.items.filter(Boolean).length, guestItems = guest.br.items.filter(Boolean).length;
  check(hostItems === guestItems, `guest loot table matches the host (${guestItems}/${hostItems})`);
  check(view.players.find(p => p.id === 'h1').out, 'guest sees the squad out');
}

const PACING = args.find(a => a.startsWith('--pacing'));
if (PACING) {
  // node dev/sim-br.mjs --pacing=N: N seeds per mode, pacing numbers only.
  const n = +(PACING.split('=')[1] ?? 4);
  for (const mode of ['br', 'brduo', 'brsolo']) {
    const rs = [];
    for (let i = 0; i < n; i++) rs.push(runMatch(mode, 101 + i * 7));
    const avg = f => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    console.log(`${mode}: minutes ${rs.map(r => r.minutes.toFixed(1)).join(' ')} | early ${rs.map(r => (r.early * 100).toFixed(0)).join(' ')}% | circle deaths ${rs.map(r => r.sim.br.zoneDeaths ?? 0).join(' ')} | squads by phase ${rs.map(r => r.phaseSquads.join('/')).join(' ')} | tick ${avg(r => r.mean).toFixed(2)} ms | snap ${avg(r => r.snapMean).toFixed(0)} B`);
  }
  process.exit(0);
}

// ---- Squad size from the lobby option, friends kept together ----
function squadUnits() {
  console.log('squad sizes');
  check(brMode('br', 2) === 'brduo' && brMode('brduo', 1) === 'brsolo' && brMode('brsolo', 4) === 'br' && brMode('tdm', 2) === 'tdm' && cleanSquad(7) === 4, 'lobby option picks the mode (quads, duos, solos)');
  const lobby = (n, sides) => Array.from({ length: n }, (_, i) => ({ id: `h${i}`, name: `H${i}`, team: sides[i] }));
  const teamsOf = (r, ids) => new Set(r.filter(p => ids.includes(p.id)).map(p => p.team));
  const size = r => { const m = new Map(); for (const p of r) m.set(p.team, (m.get(p.team) ?? 0) + 1); return [...m.values()]; };
  for (const [mode, sq] of [['br', 4], ['brduo', 2], ['brsolo', 1]]) {
    // Two friend groups of three: in quads each keeps its own squad; in duos each splits once; in solos all alone.
    const r = buildRoster(lobby(6, [0, 0, 0, 1, 1, 1]), { botSkill: 'mixed', mode, mapId: MAP.id, seed: 5 });
    check(r.length === 32 && size(r).every(n => n === sq) && size(r).length === 32 / sq, `${mode}: 32 players in squads of ${sq}`);
    const a = teamsOf(r, ['h0', 'h1', 'h2']), b = teamsOf(r, ['h3', 'h4', 'h5']);
    const together = sq === 4 ? a.size === 1 && b.size === 1 && [...a][0] !== [...b][0] : sq === 2 ? a.size === 2 && b.size === 2 : a.size === 3;
    check(together, `${mode}: friends kept together where they fit (${a.size}+${b.size} squads)`);
  }
  // Uneven sides pack: 2 + 2 + 1 humans in quads share squads without splitting a pair.
  const r = buildRoster(lobby(5, [0, 0, 1, 1, 1]), { botSkill: 'mixed', mode: 'br', mapId: MAP.id, seed: 5 });
  check(teamsOf(r, ['h0', 'h1']).size === 1 && teamsOf(r, ['h2', 'h3', 'h4']).size === 1, 'quads: a pair and a trio each stay whole');
}

squadUnits();
units();
const modes = QUICK ? ['br'] : ['br', 'brduo', 'brsolo'];
const results = [];
for (const [i, mode] of modes.entries()) {
  const r = runMatch(mode, 11 + i);
  report(r);
  results.push(r);
}
const squads = results.filter(r => r.sim.br.downs);
if (squads.length) check(squads.reduce((n, r) => n + r.ev.revive, 0) > 0, `squad matches: revives (${squads.map(r => r.ev.revive).join(', ')})`);
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
