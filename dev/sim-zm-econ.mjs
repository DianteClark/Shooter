// Graveyard Shift economy pacing (ROADMAP item 36, docs/ZOMBIES.md "Economy pacing"): a bot crew plays rounds 1 to N
// on a map, the crew held up (spawn protection, so the run reaches the late rounds whatever the bots do) but shooting,
// shopping and upgrading as usual. Per round it prints what a player earned and spent (mean of four), what was banked,
// where the points went, and how many of the economy's choices a player could afford at the round's start.
//   node dev/sim-zm-econ.mjs [--map=neon] [--rounds=20] [--seed=7] [--json]
import { Sim, buildRoster } from '../js/sim/sim.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { ZM, ZE, ZM_PERKS, supplyCost, clearZmWalls } from '../js/shared/zombies.js';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const MAP = arg('map', 'neon'), ROUNDS = Number(arg('rounds', 20)), SEED = Number(arg('seed', 7));
const DT = 1 / SIM_HZ;

const roster = buildRoster([], { mode: 'zm', mapId: MAP, seed: SEED });
const sim = new Sim({ roster, map: MAP, seed: SEED, mode: 'zm' });
sim.step(DT);
const R = sim.rules;
const CATS = ['guns', 'gates', 'perks', 'bench', 'terminal', 'armour', 'trap', 'exfil'];
const snap = () => R.crew.map(p => ({ earned: p.zm?.earned ?? 0, spent: p.zm?.spent ?? 0, pts: p.zm?.pts ?? 0, by: { ...(p.zm?.spentBy ?? {}) } }));
// What a player could buy now, of the late-game economy: a bench tier on their best gun, a terminal item, a plate, the
// perks they lack (within the cap) or a slot; counted when the bank covers it.
function choices(p) {
  const z = p.zm, r = R.round;
  if (!z) return 0;
  let n = 0;
  const gun = [p.ps.primary, p.ps.secondary].find(g => g !== 'pistol' && g !== 'knife');
  const t = gun ? z.tiers[gun] ?? 0 : 0;
  if (gun && t < 3 && z.pts >= ZE.bench.cost[t]) n++;
  for (const k of ZE.supplyOrder) if (z.pts >= supplyCost(k, r)) n++;
  if (z.plates < ZE.plate.hp * ZE.plate.max && z.pts >= ZE.plate.cost) n++;
  if (z.perks.length < z.limit) { for (const k of Object.keys(ZM_PERKS)) if (!z.perks.includes(k) && z.pts >= ZM_PERKS[k].cost) { n++; break; } }
  else if (z.limit < ZM.perkMax && z.pts >= ZM.slotCost) n++;
  return n;
}
const rows = [];
let last = snap(), lastT = 0, choiceNow = 0;
const t0 = Date.now();
for (let i = 0; i < SIM_HZ * 60 * 60 && sim.phase !== 'ended'; i++) {
  for (const p of R.crew) p.spawnProtect = 1e9;
  sim.step(DT);
  for (const e of sim.drainEvents()) {
    if (e.t === 'zround') {
      choiceNow = R.crew.reduce((s, p) => s + choices(p), 0) / R.crew.length;
    }
    if (e.t !== 'zbreak') continue;
    const now = snap(), n = now.length;
    const row = { round: e.round, secs: Math.round(sim.time - lastT), earned: 0, spent: 0, bank: 0, by: {}, choices: Math.round(choiceNow * 10) / 10,
      tiers: R.crew.reduce((s, p) => s + Object.values(p.zm.tiers).reduce((a, b) => a + b, 0), 0), plates: Math.round(R.crew.reduce((s, p) => s + p.zm.plates, 0) / n),
      perks: R.crew.reduce((s, p) => s + p.zm.perks.length, 0) / n };
    now.forEach((s, k) => {
      row.earned += (s.earned - last[k].earned) / n; row.spent += (s.spent - last[k].spent) / n; row.bank += s.pts / n;
      for (const c of CATS) row.by[c] = (row.by[c] ?? 0) + ((s.by[c] ?? 0) - (last[k].by[c] ?? 0)) / n;
    });
    rows.push(row);
    last = now; lastT = sim.time;
    if (e.round >= ROUNDS) i = Infinity;
  }
}
const f = v => String(Math.round(v)).padStart(6);
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
else {
  console.log(`${MAP}, seed ${SEED}: a bot crew (held up), per player per round (mean of four); ${((Date.now() - t0) / 1000).toFixed(0)} s wall`);
  console.log('round   secs earned  spent   bank | guns gates perks bench  term armour trap | tiers plates perks choices');
  for (const r of rows) {
    console.log(`${String(r.round).padStart(5)} ${f(r.secs)} ${f(r.earned)} ${f(r.spent)} ${f(r.bank)} |${['guns', 'gates', 'perks', 'bench', 'terminal', 'armour', 'trap'].map(c => f(r.by[c] ?? 0).slice(1)).join('')} | ${String(r.tiers).padStart(5)} ${String(r.plates).padStart(6)} ${r.perks.toFixed(1).padStart(5)} ${String(r.choices).padStart(7)}`);
  }
  const tot = rows.reduce((a, r) => ({ e: a.e + r.earned, s: a.s + r.spent }), { e: 0, s: 0 });
  console.log(`total earned ${Math.round(tot.e)}, spent ${Math.round(tot.s)} (${Math.round(tot.s / Math.max(1, tot.e) * 100)}%)`);
}
clearZmWalls(sim.map);
