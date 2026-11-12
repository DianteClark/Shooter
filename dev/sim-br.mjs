// Battle royale headless test (docs/BR.md): full 32-player bot matches on the dev BR map, with rule checks.
//   node dev/sim-br.mjs            quads, duos and solos, plus the unit checks
//   node dev/sim-br.mjs --quick    one quads match and the unit checks (--map=brtest for the test map)
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS } from '../js/shared/map.js';
import { BR } from '../js/shared/modes.js';
import { SIM_HZ, MAX_HP, WEAPON_IDS, WEAPON_CATEGORY } from '../js/shared/constants.js';
import { BR_KIND, flightLine } from '../js/sim/br.js';
import { stepPlayer } from '../js/sim/player.js';
import { brMode, cleanSquad } from '../js/ui/br-squad.js';

const STEP = 1 / SIM_HZ;
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const PACING = args.find(a => a.startsWith('--pacing'));
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
  const ev = { kill: 0, down: 0, revive: 0, brgive: 0, brchest: 0, brplate: 0, brsquad: 0, pick: 0, plateHits: 0, zoneDeaths: 0, landed: 0, medkit: 0 };
  const snapBytes = [];
  const guests = sim.players.slice(0, 7);
  const killT = [];                             // Live seconds of each death (kills, circle, bleed-outs).
  let liveT0 = null, finalSquads = null, finalPhase = 4;
  const phaseSquads = [];                       // Squads in as each circle phase begins.       // Pretend seven of them are guests, for the per-guest snapshot size.
  let tick = 0;
  const maxTicks = SIM_HZ * 60 * 18;
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
      if (e.t === 'heal' && e.kind === 'medkit') ev.medkit++;
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
  check(sim.phase === 'ended' && r.minutes < 14.5, `${r.mode}: one squad wins before the last circle closes (14.5 sim minutes)`);
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
  // The ammo pouch keeps rounds for guns not in hand, and tops up a gun of that type when one is taken.
  const shellsBefore = me.br.pouch[2];
  sim.br._addItem({ kind: BR_KIND.ammo, v: 2, r: 0, n: 12, x: me.ps.x, z: me.ps.z });
  for (let i = 0; i < 4; i++) sim.step(STEP);
  check(me.br.pouch[2] === shellsBefore + 12, `shells for a gun not held go in the pouch (${me.br.pouch[2]})`);
  const shotgun = WEAPON_IDS.find(id => WEAPON_CATEGORY[id] === 'Shotgun');
  const sg = sim.br._addItem({ kind: BR_KIND.gun, v: WEAPON_IDS.indexOf(shotgun), r: 0, n: 1, x: me.ps.x, z: me.ps.z, kit: {} });
  const resBefore = sim.byId.get('h1').ps.reserve[1];
  sim.applyCommand('h1', { cmd: 'br', act: 'take', item: sg.id, slot: 1 });
  check(me.br.guns[1]?.id === shotgun && me.br.pouch[2] < shellsBefore + 12, `a taken gun tops up from the pouch (pouch ${me.br.pouch})`);
  void resBefore;
  // Fists: the third slot puts the gun in hand away with its rounds, and brings it back.
  me.ps.slot = 0; me.ps.weapon = me.ps.primary;
  const held = me.ps.weapon, mag = me.ps.ammo[0];
  check(sim.applyCommand('h1', { cmd: 'br', act: 'fists', on: 1, slot: 0, ammo: mag, res: me.ps.reserve[0] }) && me.ps.weapon === 'knife' && me.br.stash?.slot === 0, 'fists out, gun put away');
  check(sim.br._invGuns(me)[0][3] === mag, 'the put-away gun keeps its rounds');
  check(sim.applyCommand('h1', { cmd: 'br', act: 'fists', on: 0 }) && me.ps.weapon === held && me.ps.ammo[0] === mag && !me.br.stash, 'and back to the gun');
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
  // No regen in BR: health stays where the revive left it; a medkit brings it back (ROADMAP 25).
  const hpUp = me.hp;
  me.spawnProtect = pal.spawnProtect = 999;
  for (const q of sim.players) if (q.team !== me.team && Math.hypot(q.ps.x - me.ps.x, q.ps.z - me.ps.z) < 120) { q.ps.x = 5; q.ps.z = 5; }
  for (let i = 0; i < SIM_HZ * 12; i++) { pal.ps.x = me.ps.x + 1; pal.ps.z = me.ps.z; sim.step(STEP); }
  check(me.hp === hpUp, `no health regen in BR (${hpUp} -> ${me.hp} after 12 s)`);
  me.br.meds = 1;
  check(sim.applyCommand('h1', { cmd: 'br', act: 'med' }), 'medkit accepted while hurt');
  for (let i = 0; i < SIM_HZ * (BR.medTime + 0.3); i++) sim.step(STEP);
  check(me.hp === MAX_HP && me.br.meds === 0, `a medkit heals to full (${me.hp})`);
  me.spawnProtect = pal.spawnProtect = 0;
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

if (PACING) {
  // node dev/sim-br.mjs --pacing=N: N seeds per mode, pacing numbers only.
  const n = +(PACING.split('=')[1] ?? 4);
  const only = args.find(a => a.startsWith('--modes='))?.slice(8).split(',');
  for (const mode of only ?? ['br', 'brduo', 'brsolo']) {
    const rs = [];
    for (let i = 0; i < n; i++) rs.push(runMatch(mode, 101 + i * 7));
    const avg = f => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    const at = k => avg(r => r.phaseSquads[k - 1] ?? 0).toFixed(1);
    console.log(`${mode} summary: ${avg(r => r.minutes).toFixed(1)} min mean (${Math.min(...rs.map(r => r.minutes)).toFixed(1)}-${Math.max(...rs.map(r => r.minutes)).toFixed(1)}), ${(avg(r => r.early) * 100).toFixed(0)}% of deaths in the first 3 min, squads in at phase 3/4/5/6 starts ${at(3)}/${at(4)}/${at(5)}/${at(6)}`);
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

// ---- Host migration: a guest's mirror plus the host's backups carry the match on ----
function migration(mode, seed, atS) {
  console.log(`host migration (${mode}, at ${atS} s)`);
  const humans = [{ id: 'h1', name: 'Host', team: 0 }, { id: 'h2', name: 'Guest', team: 0 }, { id: 'h3', name: 'Other', team: 1 }];
  const host = makeSim(mode, seed, humans), guest = makeSim(mode, seed, humans), g2 = makeSim(mode, seed, humans);
  let view = null;
  while (host.time < atS && host.phase !== 'ended') {
    host.step(STEP);
    host.drainEvents();
    view = guest.decodeSnapshot(JSON.parse(JSON.stringify(host.encodeSnapshotFor('h2'))), 'h2');
    if (host.tick % 2 === 0) g2.decodeSnapshot(JSON.parse(JSON.stringify(host.encodeSnapshotFor('h3'))), 'h3');
  }
  const roster = buildRoster(humans, { botSkill: 'mixed', mode, mapId: MAP.id, seed });
  const sim = Sim.fromSnapshot(view, roster, { map: MAP, seed, gone: ['h1'], br: guest.br });
  const a = host.br, b = sim.br;
  check(sim.br.authority && b.phase === a.phase && b.state === a.state && Math.abs(b.timer - a.timer) < 0.3, `circle phase ${b.phase} ${b.state}, timer ${b.timer.toFixed(1)}/${a.timer.toFixed(1)}`);
  check(Math.hypot(b.circle.x - a.circle.x, b.circle.z - a.circle.z) < 0.5 && Math.abs(b.circle.r - a.circle.r) < 0.5 && Math.hypot(b.next.x - a.next.x, b.next.z - a.next.z) < 0.2 && Math.abs(b.next.r - a.next.r) < 0.2, 'circle centre, radius and next circle');
  check(Math.abs(b.from.r - a.from.r) < 0.5 && Math.abs(b.t - a.t) < 3.5, `shrink start and the rules' clock (${b.t.toFixed(1)}/${a.t.toFixed(1)})`);
  const same = a.items.length === b.items.length && a.items.every((it, i) => (it === null) === (b.items[i] == null) && (!it || (it.kind === b.items[i].kind && it.v === b.items[i].v)));
  check(same, `loot on the ground and opened chests (${b.items.filter(Boolean).length} items, ${a.items.filter(x => x === null).length} taken)`);
  let inv = 0, guns = 0, state = 0, n = 0;
  for (let i = 0; i < host.players.length; i++) {
    const p = host.players[i], q = sim.players[i];
    if (!p.br) continue;
    n++;
    if (p.br.plates === q.br.plates && p.br.meds === q.br.meds && p.br.kits === q.br.kits) inv++;
    if ([0, 1].every(s => (p.br.guns[s]?.id ?? null) === (q.br.guns[s]?.id ?? null) && (p.br.guns[s]?.r ?? -1) === (q.br.guns[s]?.r ?? -1) && (!p.alive || p.ps.defs[s] === q.ps.defs[s]))) guns++;
    if (Math.abs(p.br.armor - q.br.armor) <= 1 && !!p.downed === !!q.downed && p.brAir === q.brAir && p.br.out === q.br.out && p.alive === q.alive && p.team === q.team) state++;
  }
  // Packs ride the 3 s backup, so a pickup in the last moments before the drop can be missing.
  check(inv >= n - 3, `every player's plates, medkits and kits (${inv}/${n})`);
  check(guns >= n - 3, `every player's guns with rarity and kit (${guns}/${n})`);
  check(state === n, `armor, downs, air and squad state (${state}/${n})`);
  check([...a.squadsOut.keys()].every(t => b.squadsOut.has(t)), `squads out (${b.squadsOut.size})`);
  const host1 = sim.byId.get('h1');
  check(host1.away && (host1.alive === host.byId.get('h1').alive), 'the old host is held, never bot-driven');
  // The new host plays it out, and the other guest (h3), now decoding from it, stays in step.
  let ok = true, ticks = 0;
  try {
    while (sim.phase !== 'ended' && ticks < SIM_HZ * 60 * 14) {
      sim.step(STEP); sim.drainEvents(); ticks++;
      if (ticks % 2 === 0) g2.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshotFor('h3'))), 'h3');
    }
    g2.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshotFor('h3'))), 'h3');      // The last moment's drops.
  } catch (e) { ok = false; console.log(e); }
  check(ok && sim.phase === 'ended', `the new host finishes the match (${(sim.time / 60).toFixed(1)} min)`);
  const gi = g2.br.items.filter(Boolean).length, hi = sim.br.items.filter(Boolean).length;
  check(gi === hi, `a guest's loot mirror follows the new host (${gi}/${hi})`);
}

// ---- Healing (ROADMAP 25): extraction keeps regen; BR has medkits often enough and bots use them ----
function healUnits() {
  console.log('healing');
  const roster = buildRoster([{ id: 'h1', name: 'Me', team: 0 }], { botSkill: 'mixed', mode: 'exq', mapId: MAP.id, seed: 4 });
  const ex = new Sim({ roster, map: MAP, seed: 4, mode: 'exq' });
  while (ex.phase !== 'live') ex.step(STEP);
  const p = ex.byId.get('h1');
  p.hp = 40; p.regenT = 0;
  for (let i = 0; i < SIM_HZ * 6; i++) ex.step(STEP);
  check(p.hp > 40, `extraction still regenerates (${p.hp | 0})`);
  const sim = makeSim('br', 9), items = sim.br.items.filter(Boolean);
  const meds = items.filter(it => it.kind === BR_KIND.med).length;
  check(meds >= 55, `medkits on the floor: ${meds} for 32 players`);
}

// ---- Flight lines (ROADMAP 25): middle, thirds and edges, always over enough land, deterministic from the seed ----
function flightUnits() {
  console.log('flight lines');
  const W = MAP.width, H = MAP.height, pois = MAP.br?.pois ?? [];
  const bands = [0, 0, 0];
  let landOk = 0, n = 0, same = 0, edgeSeed = null;
  for (let seed = 1; seed <= 60; seed++) {
    const a = makeSim('br', seed), b = makeSim('br', seed), p = a.br.plane;
    if (['fx', 'fz', 'tx', 'tz'].every(k => p[k] === b.br.plane[k])) same++;
    const dx = (p.tx - p.fx) / p.len, dz = (p.tz - p.fz) / p.len;
    const off = Math.abs((W / 2 - p.fx) * dz - (H / 2 - p.fz) * dx) / W;
    bands[off < 0.1 ? 0 : off < 0.22 ? 1 : 2]++;
    if (off > 0.24 && edgeSeed === null) edgeSeed = seed;
    // Land under it: places within glide reach of the line, and the stretch of it over the map.
    const near = pois.filter(q => Math.abs((q.x - p.fx) * dz - (q.z - p.fz) * dx) < 110).length;
    let inside = 0;
    for (let f = 0; f <= 1; f += 0.01) { const x = p.fx + (p.tx - p.fx) * f, z = p.fz + (p.tz - p.fz) * f; if (x >= 0 && x <= W && z >= 0 && z <= H) inside += p.len * 0.01; }
    if (near >= Math.min(pois.length, Math.max(4, Math.ceil(pois.length * 0.4))) && inside >= 0.68 * W) landOk++;
    n++;
  }
  console.log(`  lines by lane over ${n} seeds: middle ${bands[0]}, thirds ${bands[1]}, edges ${bands[2]}`);
  check(same === n, 'the same seed flies the same line');
  check(bands[0] >= n * 0.2 && bands[1] >= n * 0.15 && bands[2] >= n * 0.12, 'lines cross the middle, the thirds and near the edges');
  check(landOk === n, `every line crosses enough land and places (${landOk}/${n})`);
  // A line squeezed toward the corner of a map with its places in the middle is pulled in over them.
  const mid = [0, 1, 2, 3, 4, 5].map(i => ({ x: 180 + i * 8, z: 200 }));
  const fl = flightLine(400, 400, Math.PI / 4, 0.99, 0.99, mid);
  check(Math.abs(fl.off) * 400 < 110, `an edge line is pulled in over the places (${fl.off.toFixed(2)} of the width)`);
  // An edge line: bot squads still land spread over the places along it, and the guest sees the same line.
  const sim = makeSim('br', edgeSeed), guest = makeSim('br', edgeSeed);
  while (sim.time < 70 && sim.players.some(p => p.brAir)) { sim.step(STEP); sim.drainEvents(); }
  const view = guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshotFor(sim.players[0].id))), sim.players[0].id);
  check(Math.abs(view.br.plane.fx - sim.br.plane.fx) < 1 && Math.abs(view.br.plane.tz - sim.br.plane.tz) < 1, 'a guest decodes the same line');
  const landed = sim.players.filter(p => p.alive && !p.brAir);
  const spots = new Set([...sim.br.plans.values()].map(pl => pl.poi?.id));
  const onMap = landed.every(p => p.ps.x > 0 && p.ps.x < W && p.ps.z > 0 && p.ps.z < H);
  check(landed.length >= 30 && onMap, `edge line (seed ${edgeSeed}): everyone lands on the map (${landed.length})`);
  check(spots.size >= 5, `edge line: bot squads spread over ${spots.size} places`);
}

// ---- Bot squadmates follow a human as squadmates, never as copies (ROADMAP 25: after an app switch the owner found his
// three bots copying his every move). The human jumps, the phone goes quiet for 1.5 s (an app switch: the host keeps
// stepping on a frozen state), then steers a zigzag down and walks a square on the ground. Bots must land near the
// human (not at the transport's start point), and neither glide in lockstep nor move and aim with the human after. ----
function followUnits() {
  console.log('squadmates of a human');
  const I = { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1 };
  let lock = 0, lockN = 0, moveSame = 0, aimSame = 0, n = 0, landFar = 0, stuck = 0;
  for (const seed of [5, 6, 7, 8]) {
    const sim = makeSim('br', seed, [{ id: 'h1', name: 'Me', team: 0 }]);
    const me = sim.byId.get('h1'), mates = sim.players.filter(p => p.team === me.team && p !== me);
    for (const p of sim.players) if (p.team !== me.team) p.spawnProtect = 1e9;
    while (sim.phase !== 'live' || sim.br.plane.f < 0.35) { sim.step(STEP); sim.drainEvents(); }
    sim.applyCommand('h1', { cmd: 'br', act: 'jump' });
    const jumpT = sim.time;
    for (let t = 0; t < SIM_HZ * 50; t++) {
      const s = sim.time - jumpT;
      const before = mates.map(p => [p.ps.x, p.ps.z]), hx = me.ps.x, hz = me.ps.z;
      if (me.brAir === 2 && s > 1.5) {              // Back from the switch: a zigzag glide (what the phone sends).
        const a = Math.floor(s * 2) % 2 ? 0.6 : -0.6;
        me.ps.x += Math.cos(a) * BR.glideSpeed * STEP; me.ps.z += Math.sin(a) * BR.glideSpeed * STEP;
      } else if (me.brAir === 0) {
        const a = [0, 1.57, 3.14, 4.71][Math.floor(s / 3) % 4];
        I.mx = Math.cos(a); I.mz = Math.sin(a); I.aim = a + 0.7;
        stepPlayer(me.ps, I, STEP, sim.map, Math.random);
      }
      sim.step(STEP); sim.drainEvents();
      const mvx = me.ps.x - hx, mvz = me.ps.z - hz, mv = Math.hypot(mvx, mvz);
      for (const [i, p] of mates.entries()) {
        if (!p.alive) continue;
        const vx = p.ps.x - before[i][0], vz = p.ps.z - before[i][1], v = Math.hypot(vx, vz);
        if (p.brAir === 2 && me.brAir === 2 && mv > 0.01) { lockN++; if (Math.hypot(vx - mvx, vz - mvz) < mv * 0.15) lock++; }
        if (p.brAir === 0 && me.brAir === 0 && s > BR.glide + 3 && t % 3 === 0) {
          n++;
          if (v > 0.05 && (vx * I.mx + vz * I.mz) / v > 0.9) moveSame++;
          if (Math.abs(Math.atan2(Math.sin(p.ps.aim - me.ps.aim), Math.cos(p.ps.aim - me.ps.aim))) < 0.25) aimSame++;
        }
      }
      if (s > BR.glide + 2 && s < BR.glide + 2 + STEP * 1.5) {
        for (const p of mates) { if (p.brAir) stuck++; else if (Math.hypot(p.ps.x - me.ps.x, p.ps.z - me.ps.z) > 30) landFar++; }
      }
    }
  }
  console.log(`  glide lockstep ${(lock / Math.max(1, lockN) * 100).toFixed(0)}%, ground: moving with the human ${(moveSame / n * 100).toFixed(0)}%, aim copied ${(aimSame / n * 100).toFixed(0)}%`);
  check(stuck === 0, `every squadmate has landed shortly after the human (${stuck} still in the air)`);
  check(landFar === 0, `squadmates land near the human (${landFar} landed over 30 m away)`);
  check(lock / Math.max(1, lockN) < 0.3, `squadmates do not glide in lockstep with the human (${(lock / Math.max(1, lockN) * 100).toFixed(0)}% of glide ticks)`);
  check(moveSame / n < 0.2 && aimSame / n < 0.12, `squadmates do not walk or aim with the human (${(moveSame / n * 100).toFixed(0)}%, ${(aimSame / n * 100).toFixed(0)}%)`);
}

if (args.includes('--follow')) { followUnits(); console.log(failed ? `${failed} FAILED` : 'all ok'); process.exit(failed ? 1 : 0); }
if (args.includes("--flight")) { flightUnits(); console.log(failed ? failed + " FAILED" : "all ok"); process.exit(failed ? 1 : 0); }
squadUnits();
healUnits();
flightUnits();
followUnits();
if (!PACING) { migration('br', 21, 150); migration('br', 22, 330); }
units();
const modes = QUICK ? ['br'] : ['br', 'brduo', 'brsolo'];
const results = [];
for (const [i, mode] of modes.entries()) {
  const r = runMatch(mode, 11 + i);
  report(r);
  results.push(r);
}
// Pacing (docs/BR.md "Pacing" and "Owner sweep"), over these matches and three more seeds per mode: matches run 10.5-15
// minutes, kills are spread out (no more than ~45% in the first three minutes), the circle kills someone now and then,
// and several squads are still in when the fifth circle (phase 4, 13% of the map) starts. ROADMAP 25: the owner's
// matches were over by the second circle; before the calmer early bots and the new circles, 10.5 min on average and 1.9
// squads at phase 4 in quads (none at phase 5), after 11.9 and 5.0 (3.8 at phase 5).
if (!QUICK) {
  const all = [...results];
  for (const mode of modes) for (let i = 0; i < 3; i++) all.push(runMatch(mode, 101 + i * 7));
  const mean = f => all.reduce((a, r) => a + f(r), 0) / all.length;
  const mins = mean(r => r.minutes), early = mean(r => r.early), circle = all.reduce((a, r) => a + (r.sim.br.zoneDeaths ?? 0), 0);
  const p4 = mean(r => r.phaseSquads[3] ?? 1), p5 = mean(r => r.phaseSquads[4] ?? 0);
  console.log(`pacing over ${all.length} matches: ${mins.toFixed(1)} min mean (${Math.min(...all.map(r => r.minutes)).toFixed(1)}-${Math.max(...all.map(r => r.minutes)).toFixed(1)}), ${(early * 100).toFixed(0)}% of deaths in the first 3 min, ${circle} circle deaths, ${p4.toFixed(1)} squads at phase 4, ${p5.toFixed(1)} at phase 5`);
  check(mins >= 10.5 && mins <= 15, `pacing: matches average 10.5-15 sim minutes (${mins.toFixed(1)})`);
  check(early <= 0.45, `pacing: at most 45% of deaths in the first three minutes (${(early * 100).toFixed(0)}%)`);
  check(circle >= 1, `pacing: some circle deaths (${circle})`);
  check(p4 >= 3 && p5 >= 2, `pacing: several squads at the late circles (${p4.toFixed(1)} at phase 4, ${p5.toFixed(1)} at phase 5)`);
}
const squads = results.filter(r => r.sim.br.downs);
// Medkits used vary a lot by match (2-14 over seeds 11-13: a quick match leaves few wounds to heal), so over all of them.
check(results.reduce((n, r) => n + r.ev.medkit, 0) >= 6 * results.length, `bots heal with medkits (${results.map(r => r.ev.medkit).join(', ')})`);
if (squads.length) check(squads.reduce((n, r) => n + r.ev.revive, 0) > 0, `squad matches: revives (${squads.map(r => r.ev.revive).join(', ')})`);
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
