// Battle royale headless test (docs/BR.md): full 32-player bot matches on the dev BR map, with rule checks.
//   node dev/sim-br.mjs            quads, duos and solos, plus the unit checks
//   node dev/sim-br.mjs --quick    one quads match and the unit checks (--map=brtest for the test map)
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS } from '../js/shared/map.js';
import { BR } from '../js/shared/modes.js';
import { SIM_HZ, MAX_HP } from '../js/shared/constants.js';
import { BR_KIND } from '../js/sim/br.js';

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
  const guests = sim.players.slice(0, 7);       // Pretend seven of them are guests, for the per-guest snapshot size.
  let tick = 0;
  const maxTicks = SIM_HZ * 60 * 14;
  while (sim.phase !== 'ended' && tick < maxTicks) {
    const c = process.cpuUsage();
    sim.step(STEP);
    const cu = process.cpuUsage(c);
    tick++;
    if (sim.phase === 'live' && tick > SIM_HZ * 12) times.push((cu.user + cu.system) / 1000);
    if (tick % 2 === 0 && sim.phase === 'live') {
      for (const g of guests) snapBytes.push(JSON.stringify(sim.encodeSnapshotFor(g.id)).length);
    }
    for (const e of sim.drainEvents()) {
      if (e.t in ev) ev[e.t]++;
      if (e.t === 'brpick') ev.pick++;
      if (e.t === 'hit' && e.plate) ev.plateHits++;
      if (e.t === 'kill' && e.equip === 'zone') ev.zoneDeaths++;
      if (e.t === 'brland') ev.landed++;
    }
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const winner = sim.winner;
  const alive = sim.players.filter(p => p.alive);
  const snapMean = snapBytes.reduce((a, b) => a + b, 0) / snapBytes.length;
  const removed = sim.br.items.filter(x => x === null).length;
  return { sim, mode, minutes: sim.time / 60, mean, p99: times[Math.floor(times.length * 0.99)], worst: times[times.length - 1], startMs, ev, winner, alive, snapMean, snapMax: Math.max(...snapBytes), removed };
}

function report(r) {
  const { sim, ev } = r;
  console.log(`${r.mode}: ${r.minutes.toFixed(1)} sim min, winner team ${r.winner} (${r.alive.length} alive), tick mean ${r.mean.toFixed(2)} ms p99 ${r.p99.toFixed(1)} worst ${r.worst.toFixed(1)}, first tick ${r.startMs.toFixed(0)} ms`);
  console.log(`  events ${JSON.stringify(ev)}, loot taken ${r.removed}/${sim.br.items.length}, snapshot per guest ${r.snapMean.toFixed(0)} B mean ${r.snapMax} B max`);
  check(sim.phase === 'ended' && r.minutes < 12, `${r.mode}: one squad wins inside 12 sim minutes`);
  check(r.alive.every(p => p.team === r.winner), `${r.mode}: everyone alive is on the winning squad`);
  check(ev.landed >= 30, `${r.mode}: everyone jumped and landed`);
  check(r.removed > 60 && ev.brgive > 20, `${r.mode}: loot picked up (guns ${ev.brgive})`);
  check(ev.brplate > 5 && ev.plateHits > 5, `${r.mode}: plates go on and soak hits`);
  if (sim.br.downs) check(ev.down > 5 && ev.revive > 0, `${r.mode}: downs (${ev.down}) and revives (${ev.revive})`);
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

units();
const modes = QUICK ? ['br'] : ['br', 'brduo', 'brsolo'];
const results = [];
for (const [i, mode] of modes.entries()) {
  const r = runMatch(mode, 11 + i);
  report(r);
  results.push(r);
}
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
