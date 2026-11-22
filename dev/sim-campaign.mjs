// The co-op campaign's headless tests (docs/CAMPAIGN.md): the script's units (places, fail and retry from a checkpoint,
// every fail condition, stealth alarm, abort), determinism, host migration mid-mission, the save block, then every
// mission played through by a squad of bots.
//   node dev/sim-campaign.mjs            units, then every mission on Regular and Recruit (two seeds on Regular)
//   node dev/sim-campaign.mjs --quick    units, then every mission on Regular once
//   node dev/sim-campaign.mjs --full     as the default, plus every mission on Veteran
//   node dev/sim-campaign.mjs --units    the units alone
//   --missions=9,10                      play only these missions (by number)
import { Sim, buildRoster } from '../js/sim/sim.js';
import { MAPS } from '../js/shared/map.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { NavGrid } from '../js/sim/nav.js';
import { hasLineOfSight } from '../js/shared/geometry.js';
import { objOf } from '../js/sim/rules.js';
import { MISSIONS, CP, CP_DIFFS, cpCode, cpDecode, missionLines, cpStars, cpXp, recordCampaign, cleanCampaign, campaignVetAll, missionOpen, OPERATIONS, opOf } from '../js/shared/campaign.js';
import { blankSave, encodeSave, decodeSave } from '../js/shared/progression.js';
import { modeFitsMap, MODES } from '../js/shared/modes.js';

const STEP = 1 / SIM_HZ;
const args = process.argv.slice(2);
const QUICK = args.includes('--quick'), FULL = args.includes('--full');
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };

function makeSim(k, diff = 1, seed = 1, humans = []) {
  const m = MISSIONS[k];
  const roster = buildRoster(humans, { botSkill: 'mixed', mode: 'cp', mapId: m.map, seed });
  return { sim: new Sim({ roster, map: MAPS[m.map], seed, mode: 'cp', scoreLimit: cpCode(k, diff) }), roster, m };
}
const run = (sim, secs, onEvent = null) => {
  for (let i = 0; i < secs * SIM_HZ && sim.phase !== 'ended'; i++) { sim.step(STEP); for (const e of sim.drainEvents()) onEvent?.(e); }
};
const until = (sim, pred, secs, onEvent = null) => {
  for (let i = 0; i < secs * SIM_HZ && sim.phase !== 'ended'; i++) { sim.step(STEP); for (const e of sim.drainEvents()) onEvent?.(e); if (pred()) return true; }
  return pred();
};
const place = (p, x, z) => { p.ps.x = x; p.ps.z = z; p.ps.vx = 0; p.ps.vz = 0; for (let i = 0; i < p.hx.length; i++) { p.hx[i] = x; p.hz[i] = z; } };
const freeze = sim => { for (const p of sim.players) if (p.bot) p.bot.update = () => []; };
const squadOf = sim => sim.players.filter(p => p.team === 0 && !p.ai);
// Straight to a mission's first step of a kind (the script starts it as if the steps before were done).
const jump = (sim, pred) => { until(sim, () => sim.rules.state === 1, 20); const i = sim.rules.m.steps.findIndex(pred); sim.rules._begin(i); return i; };
const killAll = sim => { for (const p of squadOf(sim)) if (p.alive) { p.downed = false; sim._selfKill(p, 'bleed'); } };

async function units() {
  console.log('units');
  // Codes, data.
  check(MISSIONS.length === 12 && OPERATIONS.length === 2 && OPERATIONS[1].from === 8 && OPERATIONS[1].to === 12 && MISSIONS.every((m, k) => m.op === opOf(k).id && m.n === k + 1), `${MISSIONS.length} missions in ${OPERATIONS.length} operations`);
  check(MISSIONS.every((m, k) => [0, 1, 2].every(d => { const c = cpDecode(cpCode(k, d)); return c.k === k && c.diff === d; })), 'mission and difficulty ride the scoreLimit both ways');
  check(!Object.values(MAPS).some(map => modeFitsMap(map, 'cp')) && MODES.cp.noMods, 'no map offers the campaign mode to the pickers; it takes no modifiers');
  const kinds = new Set(MISSIONS.flatMap(m => m.steps.map(s => s.type)));
  check(['hack', 'defend', 'escort', 'kill', 'plant', 'chase', 'boss', 'extract', 'goto', 'pursue'].every(t => kinds.has(t)) && MISSIONS.some(m => m.steps.some(s => s.stealth)), `every objective kind is used (${[...kinds].join(', ')}), and a stealth section`);
  check(MISSIONS.every(m => missionLines(m).length >= 3 && m.brief.length >= 2 && m.bonus), 'every mission has briefing cards, radio lines and a bonus objective');
  for (const m of MISSIONS) {
    const map = MAPS[m.map], nav = new NavGrid(map);
    const { sim } = makeSim(MISSIONS.indexOf(m));
    const R = sim.rules;
    const bad = [];
    const at = (ref, what) => { const p = R._pt(ref); if (!nav.isWalkable(p.x, p.z)) bad.push(`${what} ${JSON.stringify(ref)} -> ${p.x},${p.z}`); };
    at(m.insert, 'insert');
    m.steps.forEach((s, i) => {
      if (s.at && s.at !== '@kill') at(s.at, `step ${i} at`);
      for (const r of s.route ?? []) at(r, `step ${i} route`);
      for (const r of s.sites ?? []) at(r, `step ${i} site`);
      for (const g of [...(s.spawn ?? []), ...(s.on ?? []).flatMap(t => t.spawn ?? [])]) { at(g.at, `step ${i} ${g.role}`); for (const r of g.route ?? []) at(r, `step ${i} ${g.role} route`); }
    });
    check(!bad.length, `${m.name} (${map.name}): every place stands on walkable ground${bad.length ? ': ' + bad.join('; ') : ''}`);
  }

  // Stars, XP, the save block and the save code.
  {
    check(cpStars({ bonus: true, secs: 300, par: 400, deaths: 0, fails: 0 }).n === 3 && cpStars({ bonus: false, secs: 500, par: 400, deaths: 1 }).n === 0, 'stars: bonus, par time, no deaths');
    check(cpXp({ diff: 2, stars: 3, first: true }).reduce((n, l) => n + l[1], 0) === CP_DIFFS[2].xp + 3 * 400 + 1000, 'XP: difficulty, stars and the first clear');
    const save = blankSave();
    const a = recordCampaign(save, { id: 'm1', diff: 1, stars: 2, secs: 400 });
    const b = recordCampaign(save, { id: 'm1', diff: 2, stars: 1, secs: 380 });
    check(a.first && !b.first && save.cp.m1[0] === 6 && save.cp.m1[1] === 2 && save.cp.m1[2] === 380, `the save keeps cleared difficulties, best stars and best time (${JSON.stringify(save.cp.m1)})`);
    check(missionOpen(save.cp, 1) && !missionOpen(save.cp, 2), 'clearing a mission opens the next');
    let vet = null;
    for (const m of MISSIONS.slice(0, 8)) vet = recordCampaign(save, { id: m.id, diff: 2, stars: 3, secs: 300 });
    check(vet.vetAll && !vet.vetAll2 && campaignVetAll(save.cp) && !campaignVetAll(save.cp, 1) && !recordCampaign(save, { id: 'm1', diff: 2 }).vetAll, 'the last Veteran clear of Nightrail reports its full set once');
    check(missionOpen(save.cp, 8) && !missionOpen(save.cp, 9), 'Operation Starfall opens once Nightrail\'s last mission is cleared');
    for (const m of MISSIONS.slice(8)) vet = recordCampaign(save, { id: m.id, diff: 2, stars: 3, secs: 300 });
    check(vet.vetAll2 && !vet.vetAll && campaignVetAll(save.cp, 1) && !recordCampaign(save, { id: 'm9', diff: 2 }).vetAll2, 'and Starfall\'s last reports its own set once');
    const back = decodeSave(encodeSave(save));
    check(back.ok && JSON.stringify(back.save.cp) === JSON.stringify(cleanCampaign(save.cp)), 'the campaign block survives a save code');
    const plain = blankSave();
    const body = c => JSON.parse(Buffer.from(c.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    check(decodeSave(encodeSave(plain)).ok && body(encodeSave(plain)).length < 25 && body(encodeSave(save)).length === 25, 'the block rides the code\'s slot 24 only when there is one (an older save keeps its old code)');
  }

  // Fail and retry: the squad wiped on mission 1's hack step goes back to its checkpoint.
  {
    const { sim } = makeSim(0, 1, 5);
    const R = sim.rules;
    const ev = [];
    check(until(sim, () => R.stepI === 2, 200, e => ev.push(e)), 'mission 1 reaches its hack step');
    const cpStep = R.cpStep, cpAt = { ...R.cpAt };
    killAll(sim);
    run(sim, 0.5, e => ev.push(e));
    check(R.state === 2 && ev.some(e => e.t === 'cpfail' && e.why === 'wipe'), 'a wiped squad fails the mission');
    until(sim, () => ev.some(e => e.t === 'cpretry'), CP.failHold + 1, e => ev.push(e));
    const squad = squadOf(sim);
    check(R.state === 1 && R.stepI === cpStep && ev.some(e => e.t === 'cpretry') && squad.every(p => p.alive && Math.hypot(p.ps.x - cpAt.x, p.ps.z - cpAt.z) < 8), `the retry stands everyone up at the checkpoint (step ${R.stepI}, ${squad.filter(p => p.alive).length} up)`);
    check(R.fails === 1 && cpStars({ bonus: true, secs: 1, par: 999, deaths: R.deaths, fails: R.fails }).n === 2, 'a retry costs the no-deaths star');
  }

  // Every other fail condition.
  {
    const { sim } = makeSim(3, 1, 2);
    const R = sim.rules;
    until(sim, () => R.cur?.type === 'escort' && R._vip()?.alive, 200);
    const vip = R._vip();
    const ev = [];
    sim._selfKill(vip, 'bleed');
    run(sim, 0.3, e => ev.push(e));
    check(ev.some(e => e.t === 'cpfail' && e.why === 'vip'), 'losing the VIP fails the escort');
    run(sim, CP.failHold + 1);
    check(R._vip()?.alive && R.state === 1, 'the VIP is back at the checkpoint after the retry');
  }
  {
    const k = MISSIONS.findIndex(m => m.steps.some(s => s.type === 'plant' && s.timer));
    const { sim } = makeSim(k, 1, 3);
    const R = sim.rules;
    jump(sim, s => s.type === 'plant' && s.timer);
    freeze(sim);
    R.timer = 0.5;
    const ev = [];
    run(sim, 1, e => ev.push(e));
    check(ev.some(e => e.t === 'cpfail' && e.why === 'time'), 'the charges\' clock running out fails the sabotage');
  }
  {
    const k = MISSIONS.findIndex(m => m.bonus.id === 'zone' && m.steps.some(s => s.type === 'defend'));
    const { sim } = makeSim(k, 1, 3);
    const R = sim.rules;
    jump(sim, s => s.type === 'defend');
    freeze(sim);
    const at = R.geo(R.stepI).at, foe = sim.players.find(p => p.team === CP.team && p.alive) ?? sim.players.find(p => p.team === CP.team);
    if (!foe.alive) sim._placeAt(foe, at, 0);
    for (const p of squadOf(sim)) place(p, 2, 2);
    place(foe, at.x, at.z);
    const ev = [];
    run(sim, CP.lostAfter + 2, e => ev.push(e));
    check(ev.some(e => e.t === 'cpfail' && e.why === 'lost') && !R.bonusOk, 'an enemy alone on the zone long enough loses the defence (and its bonus)');
  }
  {
    const k = MISSIONS.findIndex(m => m.steps.some(s => s.type === 'kill' && s.spawn?.some(g => g.route)));
    const { sim } = makeSim(k, 1, 4);
    const R = sim.rules;
    jump(sim, s => s.type === 'kill' && s.spawn?.some(g => g.route));
    freeze(sim);
    for (const p of squadOf(sim)) place(p, 5, 5);
    const T = R.target, last = T.route[T.route.length - 1];
    for (const q of T.g.members) place(q, last.x, last.z);
    T.wp = T.route.length - 1; T.moving = true; T.started = true; R.gate = T.route.length - 1;
    const ev = [];
    run(sim, CP.hvtEscape + 3, e => ev.push(e));
    check(ev.some(e => e.t === 'cpfail' && e.why === 'escaped'), 'the target waiting out his last stop escapes');
  }
  {
    const k = MISSIONS.findIndex(m => m.steps.some(s => s.type === 'chase'));
    const { sim } = makeSim(k, 1, 4);
    const R = sim.rules;
    until(sim, () => R.cur?.type === 'chase', 60);
    freeze(sim);
    R.timer = 0.4;
    const ev = [];
    run(sim, 1, e => ev.push(e));
    check(ev.some(e => e.t === 'cpfail' && e.why === 'time'), 'the chase clock running out fails the run');
  }

  // Stealth: someone standing in a watchman's torch long enough raises the alarm; it brings the alarm waves.
  {
    const k = MISSIONS.findIndex(m => m.stealth);
    const { sim } = makeSim(k, 1, 6, [{ id: 'h1', name: 'Host', team: 0 }]);
    const R = sim.rules;
    until(sim, () => R.stepI === 0 && R.groups.length, 30);
    freeze(sim);
    run(sim, 0.2);
    const g = R.groups.find(x => x.stealth && x.members.length), guard = g.members[0], me = sim.byId.get('h1');
    for (const p of squadOf(sim)) if (p !== me) place(p, 3, 3);
    check(R._stealthOn() && sim.players.filter(p => p.team === 0 && !p.ai && p.bot).every(p => p.bot.sightK < 0.1) && guard.bot.sightK < 0.1, 'a stealth step: the guards and the squad\'s bots are weapons-tight');
    const before = sim.players.filter(p => p.team === CP.team && p.alive).length;
    // A spot in the torch: in front of the guard, in the open, in his line of sight.
    let a = guard.ps.aim, x = guard.ps.x, z = guard.ps.z;
    const nav = new NavGrid(sim.map);
    search: for (let t = 0; t < 32; t++) for (const d of [4, 6, 8]) {
      const aa = t * Math.PI / 16, px = guard.ps.x + Math.cos(aa) * d, pz = guard.ps.z + Math.sin(aa) * d;
      if (nav.isWalkable(px, pz) && hasLineOfSight(sim.map, guard.ps.x, guard.ps.z, px, pz)) { a = aa; x = px; z = pz; break search; }
    }
    const ev = [];
    let seen = 0;
    for (let i = 0; i < 6 * SIM_HZ && !R.alarm; i++) { place(me, x, z); guard.ps.aim = a; sim.step(STEP); for (const e of sim.drainEvents()) ev.push(e); seen = Math.max(seen, guard.cpSee ?? 0); }
    check(R.alarm && ev.some(e => e.t === 'cpalarm') && !R.bonusOk, `standing in a torch beam fills the meter (${seen.toFixed(2)}) and raises the alarm`);
    check(sim.players.filter(p => p.team === CP.team && p.alive).length > before && guard.bot.sightK === 1, 'the alarm brings its waves and opens everyone\'s eyes');
  }
  {
    const k = MISSIONS.findIndex(m => m.stealth);
    const { sim } = makeSim(k, 1, 7, [{ id: 'h1', name: 'Host', team: 0 }]);
    const R = sim.rules;
    until(sim, () => R.groups.length, 30);
    freeze(sim);
    const g = R.groups.find(x => x.stealth && x.members.length), guard = g.members[0], me = sim.byId.get('h1');
    place(me, guard.ps.x + 12, guard.ps.z);
    R.onShot(me);         // The hook applyShot calls for every shot fired.
    check(!!R.alarm, 'an unsuppressed shot near a watchman is the alarm');
  }

  // Operation Starfall's own mechanics.
  {
    // The night: everyone's sight cut until a flare goes up; the flare on the wire; it burns out.
    const k = MISSIONS.findIndex(m => m.night);
    const { sim } = makeSim(k, 1, 21);
    const R = sim.rules;
    jump(sim, s => s.type === 'defend');
    run(sim, 1);
    const bot = sim.players.find(p => p.bot && p.alive && p.team === 0);
    check(R.night && Math.abs(bot.bot.sightK - CP.nightSight) < 1e-6, `the night cuts the bots' sight (${bot.bot.sightK})`);
    const ev = [];
    R._flare();
    run(sim, 0.2, e => ev.push(e));
    check(ev.some(e => e.t === 'cpflare') && R.flareT > CP.flare - 1 && bot.bot.sightK === 1, 'a flare lights the field');
    const view = objOf(sim.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshot())), null));
    check(view?.flareT > CP.flare - 1 && view.night, `and rides the wire (${view?.flareT})`);
    run(sim, CP.flare);
    check(R.flareT === 0 && sim.players.filter(p => p.bot && p.alive && p.team === 0).every(p => Math.abs(p.bot.sightK - CP.nightSight) < 1e-6), 'then burns out');
  }
  {
    // The hostage: held at her spot, never finished; an alarm before she is free starts the clock, run out it fails;
    // freed, the clock stops and the bonus holds only if nobody raised the alarm first.
    const k = MISSIONS.findIndex(m => m.hostage);
    const m = MISSIONS[k];
    const { sim } = makeSim(k, 1, 22, [{ id: 'h1', name: 'Host', team: 0 }]);
    const R = sim.rules;
    until(sim, () => R.state === 1, 20);
    freeze(sim);
    run(sim, 0.5);
    const vip = R._vip(), spot = R._pt(m.vip.at);
    check(vip?.alive && Math.hypot(vip.ps.x - spot.x, vip.ps.z - spot.z) < 3, 'the hostage is held at her spot from the start');
    const { canFinish } = await import('../js/sim/finishers.js');
    const foe = sim.players.find(p => p.team === CP.team && p.alive);
    check(!R.noFinish || R.noFinish(foe, vip), 'nobody can finish the hostage');
    const ev = [];
    R._raiseAlarm(vip.ps.x, vip.ps.z);
    run(sim, 0.2, e => ev.push(e));
    check(R.execT > 0 && Math.abs(R.timer - m.hostage.clock * R.D.timer) < 1 && !R.bonusOk, `an alarm before she is free starts the clock (${R.timer.toFixed(1)} s) and costs the bonus`);
    run(sim, m.hostage.clock + 1, e => ev.push(e));
    check(ev.some(e => e.t === 'cpfail' && e.why === 'hostage'), 'run out, they moved her: the mission fails');
    void canFinish;
    const { sim: s2 } = makeSim(k, 1, 23, [{ id: 'h1', name: 'Host', team: 0 }]);
    const R2 = s2.rules;
    jump(s2, s => s.hostage);
    freeze(s2);
    R2._raiseAlarm(10, 10);
    const me = s2.byId.get('h1'), site = R2.sites[0];
    for (const p of squadOf(s2)) place(p, 2, 2);
    place(me, site.x, site.z);
    until(s2, () => R2.freed, 10);
    check(R2.freed && R2.execT === 0 && R2.cur.type === 'escort' && R2.state === 1, 'freed in time: the clock stops and the escort starts');
  }
  {
    // The pursuit: he shrugs off fire on the run; left alone too long, he is lost.
    const k = MISSIONS.findIndex(m => m.steps.some(s => s.type === 'pursue'));
    const { sim } = makeSim(k, 1, 24, [{ id: 'h1', name: 'Host', team: 0 }]);
    const R = sim.rules;
    jump(sim, s => s.type === 'pursue');
    freeze(sim);
    run(sim, 0.5);
    const T = R.target, me = sim.byId.get('h1');
    check(T?.p?.alive && T.route.length >= 3, `the courier is up with his route (${T?.route.length} stops)`);
    for (const p of squadOf(sim)) place(p, T.p.ps.x + 6, T.p.ps.z);
    run(sim, 1.5);
    check(T.moving && T.started, 'he runs once the squad is on him');
    const hp = T.p.hp;
    sim._damage(T.p, me, 60, 'ar', 8);
    check(T.p.hp === hp, 'bullets do not stop him on the run');
    const ev = [];
    const far = R._pt(MISSIONS[k].insert);
    for (const p of squadOf(sim)) place(p, far.x, far.z);
    for (let i = 0; i < (CP.trail + 3) * SIM_HZ && !ev.some(e => e.t === 'cpfail'); i++) { for (const p of squadOf(sim)) place(p, far.x, far.z); sim.step(STEP); for (const e of sim.drainEvents()) ev.push(e); }
    check(ev.some(e => e.t === 'cpfail' && e.why === 'trail') && !R.bonusOk, 'left alone too long, he is lost (and the bonus with him)');
  }
  {
    // The final boss: Vane's salvo (a line of rings walking out toward one of the squad) and the launch clock.
    const k = MISSIONS.findIndex(m => m.boss?.salvo);
    const { sim } = makeSim(k, 1, 25);
    const R = sim.rules;
    jump(sim, s => s.type === 'boss');
    freeze(sim);
    run(sim, 0.5);
    check(R.boss && Math.abs(R.boss.max - CP.boss.hp * R.D.boss * MISSIONS[k].boss.hp) < 1, `Vane's own pool (${Math.round(R.boss?.max)})`);
    R.boss.n = 1; R.boss.atk = 0; R.hazards = [];
    const q = squadOf(sim)[0];
    place(q, R.boss.p.ps.x + 14, R.boss.p.ps.z);
    run(sim, 0.1);
    const hz = R.hazards.filter(h => h.k === 0);
    const lined = hz.length >= 3 && hz.every((h, i) => i === 0 || h.t > hz[i - 1].t - 1e-6);
    check(lined, `a salvo: ${hz.length} rings walking out, each landing after the last`);
    R.timer = 0.3;
    const ev = [];
    run(sim, 0.6, e => ev.push(e));
    check(ev.some(e => e.t === 'cpfail' && e.why === 'time'), 'the launch clock run out fails the mission');
  }

  // Abort: a human ends a failed mission instead of retrying.
  {
    const { sim } = makeSim(0, 0, 8, [{ id: 'h1', name: 'Host', team: 0 }]);
    const R = sim.rules;
    until(sim, () => R.stepI >= 0, 20);
    killAll(sim);
    run(sim, 1);
    check(R.state === 2 && sim.applyCommand('h1', { cmd: 'cp', act: 'abort' }) && sim.phase === 'ended' && sim.winner === null, 'Abort during a failed mission ends the match with no winner');
    const { sim: s2 } = makeSim(0, 0, 8, [{ id: 'h1', name: 'Host', team: 0 }]);
    until(s2, () => s2.rules.stepI >= 0, 20);
    killAll(s2); run(s2, 2);
    check(s2.applyCommand('h1', { cmd: 'cp', act: 'retry' }) && s2.rules.state === 1, 'Retry now skips the rest of the fail screen');
    check(!s2.applyCommand('bot0', { cmd: 'cp', act: 'abort' }), 'a bot cannot abort');
  }

  // Determinism: the same seed plays the same mission the same way.
  {
    const sig = () => {
      const { sim } = makeSim(0, 1, 11);
      const out = [];
      run(sim, 240, e => { if (e.t.startsWith('cp') || e.t === 'kill') out.push(`${sim.tick}:${e.t}:${e.i ?? e.k ?? e.target ?? ''}`); });
      return out.join('|') + `|${sim.phase}|${sim.tick}`;
    };
    const a = sig(), b = sig();
    check(a === b && a.length > 40, `two runs on one seed match exactly (${a.split('|').length} events)`);
  }

  // Host migration: a guest's mirror and backup carry the script on, mid-escort and mid-boss.
  for (const [k, label, pred] of [[3, 'mid-escort', R => R.cur?.type === 'escort' && R.gate >= 1], [7, 'mid-boss', R => R.boss && R.boss.pool < R.boss.max * 0.9]]) {
    const humans = [{ id: 'h1', name: 'Host', team: 0 }, { id: 'h2', name: 'Guest', team: 0 }];
    const { sim, roster, m } = makeSim(k, 0, 21, humans);
    const guest = new Sim({ roster, map: MAPS[m.map], seed: 21, mode: 'cp', scoreLimit: cpCode(k, 0) });
    for (const p of sim.players) if (!p.isBot) { p.wantRespawn = true; }
    let view = null;
    const R = sim.rules;
    // The humans stand in for bots so the mission moves (two idle phones would just hold the squad back).
    for (const p of sim.players) if (!p.isBot && !p.dummy) { p.isBot = true; }
    sim._initBots?.();
    let ok = false;
    for (let i = 0; i < 900 * SIM_HZ && sim.phase !== 'ended'; i++) {
      sim.step(STEP); sim.drainEvents();
      if (sim.tick % 2 === 0) view = guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshotFor('h2'))), 'h2');
      if (pred(R) && objOf(view)?.rules?.saved && sim.tick % 180 > 30) { ok = true; break; }
    }
    // A moment more, so the guest's mirror has the latest snapshot.
    for (let i = 0; i < SIM_HZ && ok; i++) { sim.step(STEP); sim.drainEvents(); if (sim.tick % 2 === 0) view = guest.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshotFor('h2'))), 'h2'); }
    if (!ok) { check(false, `${label}: never reached the moment to migrate`); continue; }
    const before = { step: R.stepI, gate: R.gate, fails: R.fails, boss: R.boss ? Math.round(R.boss.pool) : null, vip: !!R._vip()?.alive, groups: R.groups.filter(g => g.members.length).length };
    const mirror = objOf(view);
    const host2 = Sim.fromSnapshot(view, roster, { map: MAPS[m.map], seed: 21, gone: ['h1'] });
    const R2 = host2.rules;
    const after = { step: R2.stepI, gate: R2.gate, fails: R2.fails, boss: R2.boss ? Math.round(R2.boss.pool) : null, vip: !!R2._vip()?.alive, groups: R2.groups.filter(g => g.members.length).length };
    check(after.step === before.step && after.gate === before.gate && after.fails === before.fails && after.vip === before.vip, `${label}: the new host has the step, gate, fails and VIP (${JSON.stringify(after)})`);
    if (before.boss !== null) check(after.boss !== null && Math.abs(after.boss - before.boss) < before.boss * 0.15, `${label}: the boss keeps his health (${before.boss} -> ${after.boss})`);
    check(after.groups > 0 || before.groups === 0, `${label}: the Line's groups keep their seats (${after.groups} of ${before.groups})`);
    check(mirror.state === 'live', `${label}: the guest's mirror shows the mission live`);
    for (const p of host2.players) if (!p.isBot && !p.dummy && !p.away) { p.isBot = true; }
    host2._initBots();
    let done = false;
    try { for (let i = 0; i < 900 * SIM_HZ && host2.phase !== 'ended'; i++) { host2.step(STEP); host2.drainEvents(); } done = host2.phase === 'ended' && host2.winner === 0; } catch (err) { console.log(err); }
    check(done, `${label}: the new host plays the mission to the end (${host2.rules.fails} more fails)`);
  }
}

function playMission(k, diff, seed) {
  const { sim, m } = makeSim(k, diff, seed);
  const t0 = Date.now();
  let ticks = 0, slow = 0, bytes = 0, snaps = 0;
  for (let i = 0; i < 40 * 60 * SIM_HZ && sim.phase !== 'ended'; i++) {
    const a = performance.now();
    sim.step(STEP); sim.drainEvents();
    const dt = performance.now() - a;
    ticks++; if (dt > 8) slow++;
    if (sim.tick % 60 === 0) { bytes += JSON.stringify(sim.encodeSnapshot()).length; snaps++; }
  }
  const R = sim.rules;
  const won = sim.phase === 'ended' && sim.winner === 0;
  const stars = cpStars({ bonus: R.bonusOk, secs: R.t, par: m.par, deaths: R.deaths, fails: R.fails }).n;
  check(won, `${m.name.padEnd(16)} ${CP_DIFFS[diff].name.padEnd(8)} seed ${seed}: ${won ? 'complete' : 'NOT complete'} in ${Math.round(R.t)} s, ${R.fails} fails, ${R.deaths} deaths, ${stars} stars (${Date.now() - t0} ms, ${Math.round((Date.now() - t0) / ticks * 1000)} us/tick, snapshot ~${Math.round(bytes / Math.max(1, snaps))} B)`);
  return { won, t: R.t, fails: R.fails };
}

await units();
if (args.includes('--units')) { console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} (units only)`); process.exit(failed ? 1 : 0); }
console.log('missions');
const runs = [];
const only = (args.find(a => a.startsWith('--missions='))?.split('=')[1] ?? '').split(',').filter(Boolean).map(Number);
for (let k = 0; k < MISSIONS.length; k++) {
  if (only.length && !only.includes(k + 1)) continue;
  runs.push(playMission(k, 1, 1));
  if (!QUICK) { runs.push(playMission(k, 1, 2)); runs.push(playMission(k, 0, 3)); }
  if (FULL) runs.push(playMission(k, 2, 4));
}
console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} (${runs.filter(r => r.won).length}/${runs.length} missions completed by bots)`);
process.exit(failed ? 1 : 0);
