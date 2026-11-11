// Extraction headless tests (docs/EXTRACT.md): rule units on Frontier, then full bot matches in quads and duos.
//   node dev/sim-extract.mjs            units, then 3 quads and 3 duos matches (tick budget, snapshot bytes)
//   node dev/sim-extract.mjs --quick    units and one match of each
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS } from '../js/shared/map.js';
import { EX, EX_AI_TEAM, CONTRACT_TYPES, MODES } from '../js/shared/modes.js';
import { SIM_HZ, FFA_TEAM } from '../js/shared/constants.js';
import { extractionPay, EX_UNLOCKS, exUnlockStatus } from '../js/shared/extraction.js';
import { objOf } from '../js/sim/rules.js';
import { blankSave, addLife, unlockChallenge, itemOpen, sanitizeSave } from '../js/shared/progression.js';

const STEP = 1 / SIM_HZ;
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const MAP = MAPS.frontier;
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };

function makeSim(mode, seed, humans = []) {
  const roster = buildRoster(humans, { botSkill: 'mixed', mode, mapId: MAP.id, seed });
  return { sim: new Sim({ roster, map: MAP, seed, mode }), roster };
}
const live = sim => { while (sim.phase !== 'live') { sim.step(STEP); sim.drainEvents(); } sim.step(STEP); };
const run = (sim, secs, onEvent = null) => {
  for (let i = 0; i < secs * SIM_HZ && sim.phase !== 'ended'; i++) { sim.step(STEP); for (const e of sim.drainEvents()) onEvent?.(e); }
};
const place = (p, x, z) => { p.ps.x = x; p.ps.z = z; p.ps.vx = 0; p.ps.vz = 0; for (let i = 0; i < p.hx.length; i++) { p.hx[i] = x; p.hz[i] = z; } };
// Freeze every bot (so a unit test controls who stands where) and park everyone else far off.
function freeze(sim) { for (const p of sim.players) if (p.bot) p.bot.update = () => []; }
const squadOf = (sim, team) => sim.rules.squads.get(team);

function units() {
  console.log('units');
  {
    const { sim, roster } = makeSim('exq', 3);
    const R = sim.rules;
    check(roster.length === 16 + EX.aiSlots, `quads roster: 16 squad seats + ${EX.aiSlots} AI seats (${roster.length})`);
    check(R.squads.size === 4 && [...R.squads.values()].every(s => sim.players.filter(p => p.team === s.team).length === 4), 'four squads of four');
    check(sim.players.filter(p => p.ai).every(p => p.team === EX_AI_TEAM && !p.alive), 'AI seats start off the field on their own side');
    check(R.exfils.length >= 5 && R.exfils.filter(e => e.final).length === 1, `exfil sites (${R.exfils.length}, one final)`);
    check(R.phones.length === MAP.br.pois.length && R.boxes.length > 25, `a contract phone per place, ${R.boxes.length} ammo boxes`);
    const ins = [...R.squads.values()].map(s => s.insert);
    let minGap = Infinity;
    for (let i = 0; i < ins.length; i++) for (let j = i + 1; j < ins.length; j++) minGap = Math.min(minGap, Math.hypot(ins[i].x - ins[j].x, ins[i].z - ins[j].z));
    check(minGap > 120, `insertion points spread (closest pair ${minGap.toFixed(0)} m)`);
    const { sim: d } = makeSim('exd', 3);
    check(d.rules.squads.size === 8 && d.players.filter(p => !p.ai).length === 16, 'duos: eight squads of two');
    // Every phone works out the same offers.
    const a = R.offers(2, FFA_TEAM, 1), b = makeSim('exq', 3).sim.rules.offers(2, FFA_TEAM, 1);
    check(JSON.stringify(a) === JSON.stringify(b) && a.length === 3, 'phone offers are the same on every copy');
  }

  // Lives pool, respawns and spectating.
  {
    const { sim } = makeSim('exq', 5);
    live(sim);
    freeze(sim);
    const team = FFA_TEAM, s = squadOf(sim, team), mates = sim.players.filter(p => p.team === team);
    const lives0 = s.lives;
    check(lives0 === EX.lives[4], `quads pool starts at ${EX.lives[4]}`);
    const victim = mates[0], killer = sim.players.find(p => p.team === FFA_TEAM + 1);
    sim._kill(victim, killer, killer.ps.weapon, 10, null, false, null);
    check(!victim.alive && s.lives === lives0, 'a death costs nothing until the respawn');
    run(sim, EX.respawn + 1);
    check(victim.alive && s.lives === lives0 - 1, `respawned after ${EX.respawn} s and the pool paid one`);
    s.lives = 0;
    sim._kill(victim, killer, killer.ps.weapon, 10, null, false, null);
    run(sim, EX.respawn + 3);
    check(!victim.alive && sim.rules.holdDead(victim), 'pool empty: the dead stay out and spectate');
    for (const q of mates) if (q.alive) { q.downed = false; sim._kill(q, killer, killer.ps.weapon, 10, null, false, null); }
    run(sim, 1);
    check(s.done && s.wiped, 'squad out of lives and players: done, nothing banked');
  }

  // Downs and revives.
  {
    const { sim } = makeSim('exq', 6);
    live(sim);
    freeze(sim);
    const mates = sim.players.filter(p => p.team === FFA_TEAM), enemy = sim.players.find(p => p.team === FFA_TEAM + 2);
    place(mates[0], 100, 100); place(mates[1], 101, 100);
    for (const q of sim.players) q.spawnProtect = 0;
    sim._damage(mates[0], enemy, 500, enemy.ps.weapon, 10);
    check(mates[0].alive && mates[0].downed, 'lethal damage downs while a squadmate is up');
    run(sim, 4.6);
    check(mates[0].alive && !mates[0].downed, 'a squadmate standing by revives in 4 s');
  }

  // Each contract type completes.
  for (const type of CONTRACT_TYPES) {
    const { sim } = makeSim('exq', 11);
    live(sim);
    const R = sim.rules, team = FFA_TEAM + 1, s = squadOf(sim, team);
    const poi = MAP.br.pois.findIndex(p => p.tier === 2);
    R._assign(s, { type, poi });
    const c = s.contract;
    // Park AI and other squads; one member of the squad does the job.
    for (const p of sim.players) if (p.team !== team && !p.ai) place(p, 5, 5);
    freeze(sim);
    const me = sim.players.find(p => p.team === team);
    let done = false;
    const onEvent = e => { if (e.t === 'excontract' && e.done && e.team === team && e.type === type) done = true; };
    for (let i = 0; i < 160 * SIM_HZ && !done; i++) {
      if (i % 3 === 0) for (const q of sim.players) if (q.ai && q.alive) { q.alive = false; q.hp = 0; q.exGroup = null; }
      if (type === 'intel') { const tx = c.carrier >= 0 ? c.dx : c.x, tz = c.carrier >= 0 ? c.dz : c.z; place(me, tx, tz); }
      else if (type === 'hvt') {
        const g = R.groups.find(x => x.id === c.group);
        if (g.state === 'asleep') { place(me, c.x + 30, c.z); R._wake(g); }
        const boss = g.members.find(q => q.exCommander);
        if (boss && boss.alive) sim._damage(boss, me, 400, me.ps.weapon, 5);
      } else if (type === 'escort') place(me, c.x + 2, c.z);
      else place(me, c.x, c.z);
      sim.step(STEP);
      for (const e of sim.drainEvents()) onEvent(e);
    }
    check(done && s.pot.some(d => d.type === type), `${type} contract completes and pays into the pot`);
    run(sim, 3);
    check(s.contract && s.contract.id !== c.id, `${type}: the next contract is revealed`);
  }

  // Taking a contract at a phone.
  {
    const { sim } = makeSim('exq', 12);
    live(sim);
    freeze(sim);
    const R = sim.rules, team = FFA_TEAM, s = squadOf(sim, team), me = sim.players.find(p => p.team === team);
    const ph = R.phones[4];
    place(me, ph.x, ph.z);
    const o = R.offers(ph.i, team, s.taken)[1];
    check(sim.applyCommand(me.id, { cmd: 'ex', act: 'take', phone: ph.i, k: 1 }) && s.contract.type === o.type && s.contract.poi === o.poi, `a phone deals the offer picked (${o.type})`);
  }

  // Exfil: call, land, contest, lift; rewards banked for the whole squad by one member; not for those who stay.
  {
    const { sim } = makeSim('exq', 13);
    live(sim);
    freeze(sim);
    const R = sim.rules;
    for (const p of sim.players) if (!p.ai) place(p, 5 + p.index, 5);
    R.t = EX.windows[0].open + 1;
    R._stepWindows();
    const e = R.exfils.find(x => x.state === 1);
    check(!!e, 'the first window opens sites');
    const A = FFA_TEAM, B = FFA_TEAM + 1, sa = squadOf(sim, A), sb = squadOf(sim, B);
    sa.pot.push({ type: 'hack', tier: 2 }, { type: 'intel', tier: 1 });
    sb.pot.push({ type: 'cache', tier: 3 });
    const [a0, a1] = sim.players.filter(p => p.team === A), b0 = sim.players.find(p => p.team === B);
    place(a0, e.x, e.z);
    check(sim.applyCommand(a0.id, { cmd: 'ex', act: 'call' }) && e.state === 2, 'a squad member in an open zone calls the helicopter');
    run(sim, EX.inbound + 0.5);
    check(e.state === 3, 'it lands after the flight in');
    for (const q of sim.players) if (q.ai && q.alive) { q.alive = false; q.hp = 0; q.exGroup = null; }
    place(b0, e.x + 2, e.z + 1);
    run(sim, EX.hold + 2);
    check(e.contested && e.hold < EX.hold && sa.extracted === 0, 'another squad in the zone contests it: the hold stops');
    place(b0, 5, 5);
    run(sim, EX.hold + 1);
    check(sa.extracted === 1 && a0.ex.out && !a0.alive, 'held alone: the squad member in the zone is lifted out');
    check(sa.banked.length === 2 && !sa.pot.length, 'the pot is banked for the squad');
    const payA1 = extractionPay(objOf(sim.getView(a1.id)).squads.find(q => q.team === A), { primary: 'ar', operator: 'trooper' });
    check(payA1.extracted && payA1.banked.length === 2 && payA1.weaponXp > 0 && payA1.life['ex:hack'] === 1, 'a squadmate left behind gets the banked rewards too');
    const payB = extractionPay(objOf(sim.getView(b0.id)).squads.find(q => q.team === B), { primary: 'ar', operator: 'trooper' });
    check(!payB.extracted && payB.weaponXp === 0 && !Object.keys(payB.life).length && payB.lost.length === 1, 'a squad that never got out banks nothing (participation XP only)');
  }

  // Exclusive unlocks: progress per item from banked contracts, over several matches.
  {
    const save = blankSave();
    const u = EX_UNLOCKS.find(x => x.id === 'streak:vulture');
    check(!itemOpen(save, 'streak', 'vulture') && unlockChallenge(save, 'streak', 'vulture')?.goal === u.goal, 'Vulture starts locked behind HVT contracts');
    for (let m = 0; m < 3; m++) addLife(save, extractionPay({ extracted: 1, banked: [{ type: 'hvt', tier: 1 }, { type: 'hvt', tier: 2 }], pot: [] }).life);
    check(exUnlockStatus(u, save.life).value === u.goal && itemOpen(save, 'streak', 'vulture'), 'three extractions with two HVTs each open it');
    const s2 = blankSave();
    addLife(s2, extractionPay({ extracted: 0, banked: [], pot: [{ type: 'hvt', tier: 1 }] }).life);
    check(exUnlockStatus(u, s2.life).value === 0, 'contracts not extracted count for nothing');
    check(EX_UNLOCKS.length >= 6 && new Set(EX_UNLOCKS.map(x => x.kind)).size >= 4, `${EX_UNLOCKS.length} exclusive items across ${[...new Set(EX_UNLOCKS.map(x => x.kind))].join(', ')}`);
    const clean = sanitizeSave({ ...blankSave(), extractions: 7 });
    check(clean.extractions === 7 && blankSave().extractions === 0, 'the save keeps a lifetime extractions count');
  }

  // Host migration: a guest's mirror and backup carry the contracts, the exfil and the AI on.
  {
    const { sim, roster } = makeSim('exq', 21, [{ id: 'h1', name: 'Host', team: 0 }, { id: 'h2', name: 'Guest', team: 0 }]);
    const guest = new Sim({ roster, map: MAP, seed: 21, mode: 'exq' });
    for (const p of sim.players) if (!p.isBot) p.wantRespawn = true;
    let view = null;
    const R = sim.rules;
    const pump = n => { for (let i = 0; i < n && sim.phase !== 'ended'; i++) { sim.step(STEP); sim.drainEvents(); if (sim.tick % 2 === 0) view = guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshotFor('h2'))), 'h2'); } };
    pump(SIM_HZ * 60);
    // Set up some state that only the host had: a pot, a carried case, an exfil on its way.
    R.t = Math.max(R.t, EX.windows[0].open + 2); R._stepWindows();
    const s = squadOf(sim, sim.byId.get('h1').team);
    s.pot.push({ type: 'escort', tier: 2 });
    const e = R.exfils.find(x => x.state === 1);
    e.state = 2; e.timer = 12; e.caller = s.team;
    pump(SIM_HZ * 4);
    const before = { lives: [...R.squads.values()].map(q => q.lives), pots: [...R.squads.values()].map(q => q.pot.length), contracts: [...R.squads.values()].map(q => q.contract && `${q.contract.type}@${q.contract.poi}`),
      exfil: R.exfils.map(x => x.state), ai: sim.players.filter(p => p.ai && p.alive).length };
    const host2 = Sim.fromSnapshot(view, roster, { map: MAP, seed: 21, gone: ['h1'] });
    const R2 = host2.rules;
    const after = { lives: [...R2.squads.values()].map(q => q.lives), pots: [...R2.squads.values()].map(q => q.pot.length), contracts: [...R2.squads.values()].map(q => q.contract && `${q.contract.type}@${q.contract.poi}`),
      exfil: R2.exfils.map(x => x.state), ai: host2.players.filter(p => p.ai && p.alive).length };
    check(JSON.stringify(before.lives) === JSON.stringify(after.lives) && JSON.stringify(before.pots) === JSON.stringify(after.pots), `lives and pots carry over (${after.lives.join('/')}, pots ${after.pots.join('/')})`);
    check(JSON.stringify(before.contracts) === JSON.stringify(after.contracts), `contracts carry over (${after.contracts.join(', ')})`);
    check(JSON.stringify(before.exfil) === JSON.stringify(after.exfil) && R2.exfils[e.i].caller === s.team, 'exfil states and the caller carry over');
    check(R2.groups.some(g => g.members.length) || before.ai === 0, `AI groups keep their seats (${after.ai} on the field)`);
    let ok = true;
    try { for (let i = 0; i < SIM_HZ * 40 && host2.phase !== 'ended'; i++) { host2.step(STEP); host2.drainEvents(); } } catch (err) { ok = false; console.log(err); }
    check(ok && R2.exfils[e.i].state >= 3, 'the new host plays on: the helicopter lands');
  }
}

function runMatch(mode, seed) {
  const { sim } = makeSim(mode, seed);
  const R = sim.rules;
  const ev = { excontract: 0, done: 0, exfil: 0, excall: 0, kill: 0, aiKills: 0, down: 0, revive: 0, exwave: 0, contested: 0, exammo: 0, pvp: 0 };
  const types = new Set();
  const times = [], bytes = [];
  const guests = sim.players.filter(p => !p.ai).slice(0, 7);
  let tick = 0;
  while (sim.phase !== 'ended' && tick < SIM_HZ * (EX.length + 30)) {
    const c = process.cpuUsage();
    sim.step(STEP);
    const cu = process.cpuUsage(c);
    tick++;
    if (sim.phase === 'live' && tick > SIM_HZ * 12) times.push((cu.user + cu.system) / 1000);
    if (tick % 2 === 0 && sim.phase === 'live') for (const g of guests) bytes.push(JSON.stringify(sim.encodeSnapshotFor(g.id)).length);
    if (R.exfils.some(e => e.contested)) ev.contested++;
    for (const e of sim.drainEvents()) {
      if (e.t in ev) ev[e.t]++;
      if (e.t === 'excontract' && e.done) { ev.done++; types.add(e.type); }
      if (e.t === 'kill' && sim.byId.get(e.target)?.ai) ev.aiKills++;
      if (e.t === 'kill' && !sim.byId.get(e.target)?.ai && !sim.byId.get(e.by)?.ai && sim.byId.get(e.by)?.team !== sim.byId.get(e.target)?.team) ev.pvp++;
    }
  }
  times.sort((a, b) => a - b);
  bytes.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const squads = [...R.squads.values()];
  const r = { mode, seed, t: R.t, ended: sim.phase === 'ended', mean, p99: times[Math.floor(times.length * 0.99)], snapMean: bytes.reduce((a, b) => a + b, 0) / bytes.length, snapMax: bytes[bytes.length - 1],
    extracted: squads.filter(s => s.extracted).length, banked: squads.reduce((n, s) => n + s.banked.length, 0), types, ev };
  console.log(`  ${mode} seed ${seed}: ${r.t.toFixed(0)} s, ${r.extracted}/${squads.length} squads out, ${r.banked} contracts banked, ${ev.done} done (${[...types].join(' ')}), ${ev.exfil} lifts, ${ev.excall} calls, `
    + `kills ${ev.kill} (AI ${ev.aiKills}, squad v squad ${ev.pvp}), downs ${ev.down}, revives ${ev.revive}, waves ${ev.exwave}, contested ticks ${ev.contested}, ammo ${ev.exammo}; `
    + `tick ${mean.toFixed(2)} ms mean, p99 ${r.p99.toFixed(1)}; snapshot per guest ${r.snapMean.toFixed(0)} B mean, ${r.snapMax} max`);
  return r;
}

units();
console.log('matches');
const runs = [];
for (const mode of ['exq', 'exd']) for (const seed of QUICK ? [1] : [1, 2, 3]) runs.push(runMatch(mode, seed));
for (const mode of ['exq', 'exd']) {
  const rs = runs.filter(r => r.mode === mode);
  check(rs.every(r => r.ended), `${MODES[mode].name}: every match ends`);
  check(rs.every(r => r.extracted >= 1), `${MODES[mode].name}: at least one squad extracts in every match`);
  check(rs.reduce((n, r) => n + r.ev.revive, 0) > 0 && rs.reduce((n, r) => n + r.ev.aiKills, 0) > 10, `${MODES[mode].name}: bots revive and fight the patrols`);
}
const allTypes = new Set(runs.flatMap(r => [...r.types]));
check(allTypes.size === CONTRACT_TYPES.length, `bots complete every contract type across the matches (${[...allTypes].join(', ')})`);
check(runs.some(r => r.ev.contested > 0), 'some exfil gets contested in bot matches');
check(runs.every(r => r.mean < 4), `host tick under 4 ms mean (worst ${Math.max(...runs.map(r => r.mean)).toFixed(2)} ms)`);
check(runs.every(r => r.snapMean < 1500), `snapshot per guest within battle royale's, about 1.3 KB measured the same way (worst mean ${Math.max(...runs.map(r => r.snapMean)).toFixed(0)} B)`);
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
