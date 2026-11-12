// Finishing moves and emotes, headless (docs/FINISHERS.md, roadmap item 32): node dev/sim-finishers.mjs [--quick]
//   data         six finishers, eight emotes, unique ids, lengths 1.2..1.8 s, unlock rules and texts
//   rules        reach and facing: from behind yes, face to face no, a downed enemy from any side, teammates never,
//                walls block, spawn protection blocks, Graveyard Shift has none
//   finish       a phone's 'finish' command pins both players for the move's length, then the target dies with the
//                kill marked fin; the phone's late states cannot move a pinned player; no shots or throws mid-move
//   cancel       the attacker shot mid-move lets go (finx 'hit', target alive); the target killed by someone else ends it
//   downed       a downed enemy can be finished face on; revives wait while it runs (battle royale)
//   wire         a guest's decoded snapshot has both players' fin {k, role, other, t}; the interest-managed snapshot too
//   emote        an emote goes out as an event, rate limited, never from someone in a finisher
//   bots         bots use finishers on their own in team matches and in battle royale; deterministic for a seed
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS } from '../js/shared/map.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { NavGrid } from '../js/sim/nav.js';
import { hasLineOfSight } from '../js/shared/geometry.js';
import { FINISHERS, EMOTES, FIN, finishable, unlockOk, unlockText, cleanFinisher, DEFAULT_FINISHER } from '../js/shared/finishers.js';
import { canFinish } from '../js/sim/finishers.js';

const QUICK = process.argv.includes('--quick');
const DT = 1 / SIM_HZ;
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL', msg); } else console.log('  ok  ', msg); };
const section = name => console.log(name);

// Two humans (no bots) on an open spot of a map: h1 (team 0) behind h2 (team 1), who faces away.
function duel(mapId = 'railyard', { finisher = 'lights', extra = [] } = {}) {
  const roster = [
    { id: 'h1', name: 'Ann', team: 0, loadout: { primary: 'ar', finisher } },
    { id: 'h2', name: 'Bo', team: 1, loadout: { primary: 'ar' } },
    ...extra,
  ];
  const sim = new Sim({ roster, map: mapId, seed: 7, mode: 'tdm' });
  while (sim.phase !== 'live') sim.step(DT);
  sim.drainEvents();
  const spot = openSpot(sim.map);
  const a = sim.byId.get('h1'), v = sim.byId.get('h2');
  for (const p of sim.players) { p.spawnProtect = 0; }
  place(a, spot.x - 1.5, spot.z, 0);
  place(v, spot.x, spot.z, 0);             // Facing east, away from h1 to the west.
  return { sim, a, v, spot };
}
function place(p, x, z, aim) { p.ps.x = x; p.ps.z = z; p.ps.aim = aim; p.ps.vx = 0; p.ps.vz = 0; p.spawnProtect = 0; }
// A spot with 5 m of open ground every way.
function openSpot(map) {
  const nav = new NavGrid(map);
  for (let z = 8; z < map.height - 8; z += 1) for (let x = 8; x < map.width - 8; x += 1) {
    let clear = true;
    for (let k = 0; k < 16 && clear; k++) { const a = k / 16 * Math.PI * 2; if (!hasLineOfSight(map, x, z, x + Math.cos(a) * 5, z + Math.sin(a) * 5) || !nav.isWalkable(x + Math.cos(a) * 3, z + Math.sin(a) * 3)) clear = false; }
    if (clear && nav.isWalkable(x, z)) return { x, z };
  }
  throw new Error('no open spot on ' + map.id);
}
const steps = (sim, secs, out = []) => { for (let i = 0; i < Math.round(secs * SIM_HZ); i++) { sim.step(DT); out.push(...sim.drainEvents()); } return out; };

function data() {
  section('data');
  ok(FINISHERS.length >= 4 && FINISHERS.length <= 6 && new Set(FINISHERS.map(f => f.id)).size === FINISHERS.length, `${FINISHERS.length} finishers, unique ids`);
  ok(FINISHERS.every(f => f.dur >= 1.2 && f.dur <= 1.8), 'every finisher lasts 1.2 to 1.8 s');
  ok(EMOTES.length >= 6 && EMOTES.length <= 8 && new Set(EMOTES.map(e => e.id)).size === EMOTES.length, `${EMOTES.length} emotes, unique ids`);
  ok(EMOTES.filter(e => !Object.keys(e.unlock).length).length >= 3 && EMOTES.some(e => Object.keys(e.unlock).length), 'some emotes are default, some unlock');
  ok(FINISHERS.some(f => f.unlock.opTier) && FINISHERS.some(f => f.unlock.season) && FINISHERS.some(f => f.unlock.level), 'finishers unlock by level, operator mastery and the season track');
  ok(unlockOk({}, {}) && !unlockOk({ level: 8 }, { level: 7 }) && unlockOk({ level: 8 }, { level: 8 }) && !unlockOk({ opTier: 3 }, { opTier: 2 }) && unlockOk({ season: 30 }, { season: 31 }), 'unlock rules');
  ok(FINISHERS.every(f => unlockText(f.unlock).length > 3), 'every finisher has a requirement line');
  ok(cleanFinisher('nope') === DEFAULT_FINISHER && cleanFinisher('derail') === 'derail', 'unknown ids fall back to the default');
}

function rules() {
  section('rules');
  const a = { x: 0, z: 0, aim: 0, team: 0, alive: true };
  const v = (x, z, aim, more = {}) => ({ x, z, aim, team: 1, alive: true, ...more });
  ok(finishable(a, v(1.5, 0, 0)), 'from behind, in reach');
  ok(!finishable(a, v(1.5, 0, Math.PI)), 'not face to face');
  ok(!finishable(a, v(1.5, 0, Math.PI / 2 + 0.3)), 'not side on (they would see you)');
  ok(!finishable(a, v(FIN.reachBehind + 0.3, 0, 0)), 'not out of reach');
  ok(finishable(a, v(2.2, 0, Math.PI, { downed: true })), 'a downed enemy, face on');
  ok(!finishable(a, v(1.5, 0, 0, { team: 0 })), 'never a teammate');
  ok(!finishable(a, v(1.5, 0, 0, { spawnProtect: true })), 'never through spawn protection');
  ok(!finishable(a, v(1.5, 0, 0, { fin: true })), 'never someone already in one');
  ok(finishable(a, v(FIN.reachBehind + 0.5, 0, 0), FIN.slack), 'the host allows a little slack on a request');
  const { sim, a: pa, v: pv } = duel();
  ok(canFinish(sim, pa, pv), 'sim: h1 can finish h2 from behind');
  pv.ps.aim = Math.PI;
  ok(!canFinish(sim, pa, pv), 'sim: not once h2 turns round');
  const zm = new Sim({ roster: buildRoster([{ id: 'h1', name: 'A', team: 0 }], { mode: 'zm', mapId: 'ruins', seed: 3 }), map: 'ruins', seed: 3, mode: 'zm' });
  while (zm.phase !== 'live') zm.step(DT);
  const z1 = zm.byId.get('h1'), zed = zm.players.find(p => p.team !== z1.team);
  if (zed) { place(zed, z1.ps.x + 1.2, z1.ps.z, 0); zed.alive = true; }
  ok(!zed || !canFinish(zm, z1, zed), 'Graveyard Shift: no finishers on the horde');
}

function finish() {
  section('finish');
  const { sim, a, v } = duel('railyard', { finisher: 'switchback' });
  const dur = FINISHERS.find(f => f.id === 'switchback').dur;
  ok(sim.applyCommand('h1', { cmd: 'finish', target: 'h2' }), 'the finish command starts it');
  const started = sim.drainEvents().find(e => e.t === 'fin');
  ok(started && started.by === 'h1' && started.target === 'h2' && FINISHERS[started.k].id === 'switchback', 'a fin event names both and the operator\'s finisher');
  ok(a.fin && v.fin && a.fin === v.fin, 'both players are locked together');
  const ax = a.ps.x, az = a.ps.z;
  ok(Math.abs(Math.hypot(ax - v.ps.x, az - v.ps.z) - FIN.stand) < 0.01, 'the attacker steps in to arm\'s length');
  // A phone's stale state tries to walk both away; it is overruled.
  sim.applyHumanState('h1', { ...stateOf(a), x: ax + 3, z: az + 2 });
  sim.applyHumanState('h2', { ...stateOf(v), x: v.ps.x + 4 });
  ok(Math.abs(a.ps.x - ax) < 1e-6 && Math.abs(v.ps.x - v.fin.vx) < 1e-6, 'pinned: late phone states cannot move either');
  sim.applyShot('h2', { ox: v.ps.x, oz: v.ps.z, aim: Math.PI, weapon: 'ar', angles: [Math.PI] }, 0);
  ok(!sim.drainEvents().some(e => e.t === 'shot'), 'no shots from inside a finisher');
  ok(!sim.applyCommand('h2', { cmd: 'throw', slot: 'lethal', aim: 0 }), 'no throws either');
  const ev = steps(sim, dur - 0.1);
  ok(v.alive && !ev.some(e => e.t === 'kill'), 'the target is still alive just before the end');
  ev.push(...steps(sim, 0.2));
  const kill = ev.find(e => e.t === 'kill');
  ok(!v.alive && kill?.by === 'h1' && kill?.target === 'h2' && kill.fin === 'switchback', 'then dies, the kill marked as a finisher');
  ok(!a.fin && !v.fin && sim.fins.length === 0, 'and the lock lets go');
  ok(a.kills === 1 && sim.scores[0] === 1, 'it counts as a kill for the score');
}
function stateOf(p) {
  const ps = p.ps;
  return { x: ps.x, z: ps.z, aim: ps.aim, vx: 0, vz: 0, slot: ps.slot, primary: ps.primary, weapon: ps.weapon, secondary: ps.secondary,
    sprinting: false, sliding: false, ammo: [...ps.ammo], reserve: [...ps.reserve], reloadT: 0, reloadDur: 0, adsT: 0, bloom: 0 };
}

function cancel() {
  section('cancel');
  const third = { id: 'h3', name: 'Cy', team: 1, loadout: { primary: 'ar' } };
  const { sim, a, v, spot } = duel('railyard', { extra: [third] });
  const c = sim.byId.get('h3');
  place(c, spot.x - 1.5, spot.z + 4, -Math.PI / 2);        // South of the attacker, aiming north at them.
  ok(sim.applyCommand('h1', { cmd: 'finish', target: 'h2' }), 'started');
  steps(sim, 0.5);
  const aim = Math.atan2(a.ps.z - c.ps.z, a.ps.x - c.ps.x);
  sim.applyShot('h3', { ox: c.ps.x, oz: c.ps.z, aim, weapon: 'ar', angles: [aim] }, 0);
  const ev = sim.drainEvents();
  const x = ev.find(e => e.t === 'finx');
  ok(x && x.why === 'hit' && x.by === 'h1', 'shooting the attacker cancels it (finx hit)');
  ok(!a.fin && !v.fin && v.alive, 'both free, the target alive');
  // A target killed by someone else ends it too.
  const s2 = duel('railyard', { extra: [{ id: 'h4', name: 'Di', team: 0, loadout: { primary: 'ar' } }] });
  s2.sim.applyCommand('h1', { cmd: 'finish', target: 'h2' });
  steps(s2.sim, 0.3);
  s2.sim._damage(s2.v, s2.sim.byId.get('h4'), 500, 'ar', 5);
  const ev2 = s2.sim.drainEvents();
  ok(ev2.some(e => e.t === 'finx' && e.why === 'broken') && ev2.find(e => e.t === 'kill')?.by === 'h4' && !ev2.find(e => e.t === 'kill')?.fin, 'the target killed by a third player: credit to them, not a finisher');
  ok(s2.sim.fins.length === 0 && !s2.a.fin, 'and the attacker is free');
}

function downed() {
  section('downed');
  const { sim, a, v } = duel();
  v.ps.aim = Math.PI;                    // Facing the attacker: no from-behind finisher...
  ok(!canFinish(sim, a, v), 'standing and facing: no');
  v.downed = true;                       // ...but down, any side will do.
  ok(canFinish(sim, a, v), 'downed and facing: yes');
  ok(sim.applyCommand('h1', { cmd: 'finish' }), 'no target named: the nearest that qualifies');
  const ev = steps(sim, 2);
  ok(ev.some(e => e.t === 'kill' && e.fin) && !v.alive, 'the downed enemy is finished');
  // Battle royale: a downed player being finished is not revived by a teammate next to them.
  const roster = buildRoster([{ id: 'h1', name: 'A', team: 0 }], { mode: 'br', seed: 5 });
  const br = new Sim({ roster, map: 'frontier', seed: 5, mode: 'br' });
  if (!br.br) { ok(false, 'battle royale sim'); return; }
  br.phase = 'live';
  const squad = br.players.filter(p => p.team === br.players[0].team);
  const foe = br.players.find(p => p.team !== squad[0].team);
  const spot = openSpot(br.map);
  for (const p of br.players) { p.brAir = 0; p.alive = p === squad[0] || p === squad[1] || p === foe; p.bot = null; }
  place(squad[0], spot.x, spot.z, 0); place(squad[1], spot.x + 1, spot.z, 0); place(foe, spot.x - 1.6, spot.z, 0);
  ok(br.br.tryDown(squad[0], foe, 'ar'), 'battle royale: down with a squadmate up');
  ok(br.applyCommand(foe.id, { cmd: 'finish', target: squad[0].id }), 'the enemy starts a finisher on the downed player');
  for (let i = 0; i < Math.round(3 * SIM_HZ); i++) br.br._stepDowned?.(squad[0], DT);
  ok(squad[0].br.reviveT === 0, 'the squadmate standing by makes no revive progress while it runs');
}

function wire() {
  section('wire');
  const { sim } = duel('railyard', { finisher: 'derail' });
  const guest = new Sim({ roster: [{ id: 'h1', name: 'Ann', team: 0, loadout: { primary: 'ar' } }, { id: 'h2', name: 'Bo', team: 1, loadout: { primary: 'ar' } }], map: 'railyard', seed: 7, mode: 'tdm' });
  sim.applyCommand('h1', { cmd: 'finish', target: 'h2' });
  steps(sim, 0.5);
  const view = guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshot())), 'h2');
  const ga = view.players.find(p => p.id === 'h1'), gv = view.players.find(p => p.id === 'h2');
  ok(ga.fin?.role === 'a' && ga.fin.k === 'derail' && ga.fin.other === 'h2', 'guest: the attacker\'s fin');
  ok(gv.fin?.role === 'v' && gv.fin.other === 'h1' && Math.abs(gv.fin.t - 0.5) < 0.05, `guest: the target's fin, ${gv.fin?.t}s in`);
  sim.setInterest(true);
  const per = guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshotFor('h2'))), 'h2');
  ok(per.players.find(p => p.id === 'h2').fin?.role === 'v', 'the per-guest snapshot carries it too');
  steps(sim, 2);
  const after = guest.decodeSnapshot(sim.encodeSnapshot(), 'h2');
  ok(after.players.every(p => p.fin === null), 'and drops it when it ends');
  ok(sim.getView('h1').players.every(p => p.fin === null), 'host view agrees');
}

function emotes() {
  section('emote');
  const { sim, a } = duel();
  ok(sim.applyCommand('h1', { cmd: 'emote', e: 1 }), 'an emote is accepted');
  const ev = sim.drainEvents();
  ok(ev.some(e => e.t === 'emote' && e.id === 'h1' && e.e === 1), 'and goes out as an event');
  ok(!sim.applyCommand('h1', { cmd: 'emote', e: 2 }), 'rate limited');
  steps(sim, 1.1);
  ok(sim.applyCommand('h1', { cmd: 'emote', e: 2 }), 'fine a second later');
  ok(!sim.applyCommand('h1', { cmd: 'emote', e: 99 }), 'unknown emote refused');
  steps(sim, 1.1);
  sim.applyCommand('h1', { cmd: 'finish', target: 'h2' });
  ok(a.fin && !sim.applyCommand('h1', { cmd: 'emote', e: 0 }), 'no emote from inside a finisher');
}

// Bots in ordinary matches and battle royale: they finish sometimes, and a seed replays exactly.
function bots() {
  section('bots');
  const run = (seed, secs) => {
    const roster = buildRoster([], { mode: 'tdm', mapId: 'railyard', seed, botSkill: 'mixed' });
    const sim = new Sim({ roster, map: 'railyard', seed, mode: 'tdm', timeLimit: 600, scoreLimit: 999 });
    let fins = 0, kills = 0, finx = 0, emotes = 0, hash = 0;
    for (let i = 0; i < secs * SIM_HZ && sim.phase !== 'ended'; i++) {
      sim.step(DT);
      for (const e of sim.drainEvents()) {
        if (e.t === 'fin') fins++;
        if (e.t === 'kill' && e.fin) kills++;
        if (e.t === 'finx') finx++;
        if (e.t === 'emote') emotes++;
        if (e.t === 'kill' || e.t === 'fin') hash = (hash * 31 + e.x * 100 + e.z * 7) % 1e9;
      }
    }
    return { fins, kills, finx, emotes, hash, sim };
  };
  const secs = QUICK ? 180 : 420;
  const r1 = run(21, secs), r2 = run(21, secs), r3 = run(5, secs);
  const started = r1.fins + r3.fins;
  ok(started > 0, `bots go for finishers now and then in team matches (${started} started, ${r1.kills + r3.kills} finished, ${r1.finx + r3.finx} cancelled, ${r1.emotes + r3.emotes} emotes in two ${secs}s matches)`);
  ok(r1.hash === r2.hash && r1.fins === r2.fins && r1.kills === r2.kills, 'deterministic: the same seed plays the same finishers');
  // Battle royale: downed enemies get finished by bots.
  const roster = buildRoster([], { mode: 'rb', mapId: 'frontier', seed: 9, botSkill: 'mixed' });
  const br = new Sim({ roster, map: 'frontier', seed: 9, mode: 'rb' });
  let downFins = 0, down = 0;
  for (let i = 0; i < (QUICK ? 360 : 720) * SIM_HZ && br.phase !== 'ended'; i++) {
    br.step(DT);
    for (const e of br.drainEvents()) { if (e.t === 'fin' && e.down) downFins++; if (e.t === 'down') down++; }
  }
  ok(downFins > 0, `Rebound bots go for finishers on downed enemies (${downFins} of ${down} downs)`);
}

data(); rules(); finish(); cancel(); downed(); wire(); emotes(); bots();
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
