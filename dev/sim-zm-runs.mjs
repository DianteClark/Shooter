// Graveyard Shift difficulty and pay (owner notes after his first Ashgrove run: escaped round 18 solo with three bots,
// 692 kills, no downs, "could've easily kept going"; +28k account XP and a gun maxed in one run).
//
//   node dev/sim-zm-runs.mjs [--map=ashgrove] [--runs=6] [--seed=1] [--cap=40]            end-to-end runs
//   node dev/sim-zm-runs.mjs --held [--map=ashgrove] [--rounds=25] [--seed=7]             horde pressure by round
//
// Runs: solo with three bot teammates, the player's seat driven by the human-like stand-in (js/sim/humanlike.js: a
// thumb's aim and trigger on a bot's legs and shopping). Nobody is held up; each run goes until the crew is overrun,
// escapes or passes --cap. Prints the round, the stand-in's downs and kills, and the account and weapon XP the run pays
// (js/shared/zombies.js zmXp, as js/game/awards.js shows it). Bot legs do not kite the way a person does (they back
// into corners), so these crews fall to the round-10 boss whatever the late tuning: the runs check that the early
// rounds did not get harder for bot crews, not where a good player ends.
//
// Held: the same crew, held up (claws land and are counted but take no health), plays rounds 1 to --rounds with tier-2
// guns from round 10 (what a player who uses the bench has by then). Per round: seconds to clear it, mean and peak live
// undead, and claw damage per crew member per minute: how much a person must dodge, kite and plate against. The owner
// was untroubled on round 18 of the 1111-32 tuning; the late rounds are tuned against that.
import { Sim, buildRoster } from '../js/sim/sim.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { WEAPON_XP } from '../js/shared/progression.js';
import { ZM, clearZmWalls, zmXp, roundCount, roundHp } from '../js/shared/zombies.js';
import { makeHumanLike } from '../js/sim/humanlike.js';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const MAP = arg('map', 'ashgrove'), RUNS = Number(arg('runs', 6)), SEED = Number(arg('seed', 1)), CAP = Number(arg('cap', 40));
const HELD = process.argv.includes('--held'), ROUNDS = Number(arg('rounds', 25));
const DT = 1 / SIM_HZ;
const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

function makeSim(seed, human) {
  const roster = buildRoster(human ? [{ id: 'me', name: 'me', team: 0 }] : [], { mode: 'zm', mapId: MAP, seed });
  for (const r of roster) if (r.id === 'me') r.isBot = true;     // Driven like a bot seat, by the stand-in's brain.
  const sim = new Sim({ roster, map: MAP, seed, mode: 'zm' });
  for (let i = 0; i < SIM_HZ * 10 && human && !sim.byId.get('me').bot; i++) sim.step(DT);
  if (human) makeHumanLike(sim, 'me');
  return sim;
}

function run(seed) {
  const sim = makeSim(seed, true), R = sim.rules, me = sim.byId.get('me');
  let downs = 0, deaths = 0, kills = 0, head = 0, escaped = false, warden = false, wxp = 0;
  for (let i = 0; i < SIM_HZ * 60 * 120 && sim.phase !== 'ended' && R.round <= CAP; i++) {
    sim.step(DT);
    for (const e of sim.drainEvents()) {
      if (e.t === 'down' && e.target === me.id) downs++;
      if (e.t === 'kill' && e.target === me.id) deaths++;
      if (e.t === 'kill' && e.by === me.id && R.isZ(sim.byId.get(e.target))) {
        kills++; if (e.head) head++;
        wxp += WEAPON_XP.kill + (e.head ? WEAPON_XP.headshot : 0) + WEAPON_XP.clean;
      }
      if (e.t === 'zescape' && e.ids?.includes(me.id)) escaped = true;
      if (e.t === 'zwarden' && e.state === 2) warden = true;
    }
  }
  const round = R.round, survived = Math.max(0, round - (escaped ? 0 : 1));
  const xp = zmXp({ kills, head, survived, escaped: escaped ? round : 0, warden });
  clearZmWalls(sim.map);
  return { seed, round, over: sim.phase === 'ended', escaped, downs, deaths, kills, head, xp: xp.total, wxp: Math.min(ZM.weaponXpCap ?? Infinity, Math.round(wxp * ZM.weaponXp)), mins: Math.round(sim.time / 60) };
}

function held(seed) {
  const sim = makeSim(seed, false), R = sim.rules;
  let claws = 0;
  const orig = R.damage.bind(R);
  R.damage = (t, a, d, w, s) => { if (R.isZ(a) && !R.isZ(t)) { claws += d; return 0; } return orig(t, a, d, w, s); };
  const rows = [];
  let cur = null;
  for (let i = 0; i < SIM_HZ * 60 * 240 && sim.phase !== 'ended'; i++) {
    sim.step(DT);
    if (cur && R.state === 1) { const live = R.horde.filter(p => p.alive).length; cur.live.push(live); cur.peak = Math.max(cur.peak, live); }
    for (const e of sim.drainEvents()) {
      if (e.t === 'zround') {
        cur = { round: e.round, t0: sim.time, claws0: claws, live: [], peak: 0 };
        // From round 10 every gun in the crew's hands is at the bench's second tier, as a player's would be by then.
        if (e.round >= 10) for (const p of R.crew) for (const g of [p.ps.primary, p.ps.secondary]) if (g && g !== 'knife') p.zm.tiers[g] = Math.max(p.zm.tiers[g] ?? 0, 2);
      }
      if (e.t === 'zbreak' && cur) {
        const secs = sim.time - cur.t0;
        rows.push({ round: cur.round, secs: Math.round(secs), count: roundCount(cur.round), hp: roundHp(cur.round), live: Math.round(mean(cur.live) * 10) / 10, peak: cur.peak,
          dpm: Math.round((claws - cur.claws0) / R.crew.length / Math.max(1 / 60, secs / 60)) });
        cur = null;
        if (e.round >= ROUNDS) i = Infinity;
      }
    }
  }
  clearZmWalls(sim.map);
  return rows;
}

if (HELD) {
  const rows = held(Number(arg('seed', 7)));
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
  else {
    console.log(`${MAP}: crew held up (claws counted, no health taken), tier-2 guns from round 10`);
    console.log('round  count     hp  secs  live  peak  claw dmg/player/min');
    for (const r of rows) console.log(`${String(r.round).padStart(5)} ${String(r.count).padStart(6)} ${String(r.hp).padStart(6)} ${String(r.secs).padStart(5)} ${String(r.live).padStart(5)} ${String(r.peak).padStart(5)} ${String(r.dpm).padStart(8)}`);
  }
} else {
  const rows = [];
  for (let k = 0; k < RUNS; k++) {
    const r = run(SEED + k * 101);
    rows.push(r);
    if (!process.argv.includes('--json')) console.log(`seed ${String(r.seed).padStart(4)}: ${r.escaped ? 'escaped' : r.over ? 'overrun' : 'capped'} on round ${String(r.round).padStart(2)} (${r.mins} min); stand-in downs ${r.downs}, deaths ${r.deaths}, kills ${r.kills}, head ${r.head}; account XP ${r.xp}, weapon XP ${r.wxp}`);
  }
  const rounds = rows.map(r => r.round).sort((a, b) => a - b);
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
  else console.log(`${MAP}: rounds ${rounds.join(' ')} (median ${rounds[Math.floor(rounds.length / 2)]}); stand-in downs mean ${mean(rows.map(r => r.downs)).toFixed(1)}; account XP mean ${Math.round(mean(rows.map(r => r.xp)))}; weapon XP mean ${Math.round(mean(rows.map(r => r.wxp)))}`);
}
