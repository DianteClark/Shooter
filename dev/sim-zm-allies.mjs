// Graveyard Shift ally bots (owner: "they don't buy new weapons, they don't do much of anything except die").
//
//   node dev/sim-zm-allies.mjs [--maps=ashgrove,polestar,wrenfield,saltmere,neon] [--runs=4] [--seed=1] [--cap=30] [--v]
//
// A crew of one human-like stand-in (js/sim/humanlike.js, seated as the human: the allies revive it first, follow it
// and leave it the quest's last step) and three ally bots, run until overrun, escaped or --cap. Per run: the round
// reached, ally downs a round, ally bleed-outs, the share of their points the allies spent, the bench tier and the best
// wall gun they reached, perks, held streaks called in, revives of the human, quest steps. --v lists ally buys.
import { Sim, buildRoster } from '../js/sim/sim.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { clearZmWalls } from '../js/shared/zombies.js';
import { makeHumanLike } from '../js/sim/humanlike.js';
import { BotChatter, CHATTER } from '../js/sim/chatter.js';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const MAPS = arg('maps', 'ashgrove,polestar,wrenfield,saltmere,neon').split(','), RUNS = Number(arg('runs', 4)), SEED = Number(arg('seed', 1)), CAP = Number(arg('cap', 30));
const V = process.argv.includes('--v');
const DT = 1 / SIM_HZ;
const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const f1 = v => Math.round(v * 100) / 100;

function run(map, seed) {
  const roster = buildRoster([{ id: 'me', name: 'me', team: 0 }], { mode: 'zm', mapId: map, seed });
  for (const r of roster) if (r.id === 'me') r.isBot = true;
  const sim = new Sim({ roster, map, seed, mode: 'zm' });
  for (let i = 0; i < SIM_HZ * 10 && !sim.byId.get('me').bot; i++) sim.step(DT);
  makeHumanLike(sim, 'me');
  const me = sim.byId.get('me');
  me.isBot = false;                // The rules see a person in the seat (lead, revive first, the quest's last step).
  const R = sim.rules, allies = R.crew.filter(p => p !== me);
  const chat = new BotChatter(sim, seed, { zm: true });
  const o = { downs: 0, bleeds: 0, meDowns: 0, revMe: 0, revAlly: 0, perks: 0, deploys: 0, buys: {}, by: {}, early: 0, tierMax: 0, wallMax: 0, quest: 0, lines: {}, kills: 0 };
  const wallCost = g => sim.rules.L.wallBuys.find(w => w.gun === g)?.cost ?? 0;
  const isAlly = id => allies.some(p => p.id === id);
  for (let i = 0; i < SIM_HZ * 60 * 90 && sim.phase !== 'ended' && R.round <= CAP; i++) {
    sim.step(DT);
    const ev = sim.drainEvents();
    for (const e of [...ev, ...chat.observe(ev)]) {
      if (e.t === 'down') {
        if (e.target === me.id) o.meDowns++;
        else if (isAlly(e.target)) { o.downs++; if (R.round <= 8) o.early++; const k = sim.byId.get(e.target).zPersona ?? 'none'; o.by[k] = (o.by[k] ?? 0) + 1; }
      }
      if (e.t === 'kill' && isAlly(e.target) && !R.isZ(sim.byId.get(e.target))) o.bleeds++;
      if (e.t === 'kill' && isAlly(e.by) && R.isZ(sim.byId.get(e.target))) o.kills++;
      if (e.t === 'revive' && isAlly(e.by) && e.by !== e.id) { if (e.id === me.id) o.revMe++; else o.revAlly++; }
      if (e.t === 'zbuy' && isAlly(e.id)) {
        o.buys[e.kind] = (o.buys[e.kind] ?? 0) + 1;
        if (e.kind === 'perk') o.perks++;
        if (e.kind === 'wall') o.wallMax = Math.max(o.wallMax, wallCost(e.gun));
        if (V) console.log(`  r${R.round} ${e.id} ${e.kind} ${e.gun ?? e.perk ?? e.item ?? ''} ${e.cost}`);
      }
      if (e.t === 'zbench' && e.state === 1 && isAlly(e.by)) o.tierMax = Math.max(o.tierMax, e.tier);
      if (e.t === 'zsupply' && isAlly(e.by) && e.item !== 'vest') o.deploys++;
      if ((e.t === 'zrelic' || e.t === 'ztune' && e.state === 1 || e.t === 'zfont' && e.state === 1) && isAlly(e.by)) o.quest++;
      if (e.t === 'zfont' && e.state === 2) o.fonts = (o.fonts ?? 0) + 1;     // Saltmere Abbey: a font full (whoever fed it).
      if (e.t === 'zwarden' && e.state === 1 && isAlly(e.by)) o.questStole = 1;
      if (e.t === 'chatter') { const id = CHATTER[e.l].id; o.lines[id] = (o.lines[id] ?? 0) + 1; if (V) console.log(`  r${R.round} ${e.id}: ${CHATTER[e.l].text}`); }
    }
  }
  const rounds = Math.max(1, R.round);
  const earned = allies.reduce((s, p) => s + p.zm.earned, 0), spent = allies.reduce((s, p) => s + p.zm.spent, 0);
  const escaped = !!R.econ.escaped?.length;
  clearZmWalls(sim.map);
  return { map, seed, round: R.round, escaped, dpr: o.downs / rounds, ...o, earned, spent, share: spent / Math.max(1, earned + 500 * allies.length), mins: Math.round(sim.time / 60) };
}

const all = [];
for (const map of MAPS) {
  const rows = [];
  for (let k = 0; k < RUNS; k++) {
    const r = run(map, SEED + k * 101);
    rows.push(r); all.push(r);
    console.log(`${map} seed ${String(r.seed).padStart(4)}: round ${String(r.round).padStart(2)}${r.escaped ? ' escaped' : ''} (${r.mins} min)  ally downs ${r.downs} (${f1(r.dpr)}/rd) bleeds ${r.bleeds}  human downs ${r.meDowns} revived by allies ${r.revMe}  spent ${r.spent}/${r.earned} (${Math.round(r.share * 100)}%)  tier ${r.tierMax} wall ${r.wallMax} perks ${r.perks} streaks ${r.deploys} quest ${r.quest}${r.fonts ? ` fonts full ${r.fonts}` : ''}${r.questStole ? ' STOLE' : ''}  kills ${r.kills}  buys ${JSON.stringify(r.buys)}${Object.keys(r.lines).length ? '  lines ' + JSON.stringify(r.lines) : ''}`);
  }
  console.log(`${map}: rounds ${rows.map(r => r.round).join(' ')} (mean ${f1(mean(rows.map(r => r.round)))}); ally downs/round ${f1(mean(rows.map(r => r.dpr)))}; spent ${Math.round(mean(rows.map(r => r.share)) * 100)}%; tier ${f1(mean(rows.map(r => r.tierMax)))}; perks ${f1(mean(rows.map(r => r.perks)))}`);
}
const by = {};
for (const r of all) for (const k in r.by) by[k] = (by[k] ?? 0) + r.by[k];
console.log(`ALL: rounds mean ${f1(mean(all.map(r => r.round)))}; ally downs/round ${f1(mean(all.map(r => r.dpr)))}; ally downs in rounds 1-8 ${f1(mean(all.map(r => r.early)))} (by persona ${JSON.stringify(by)}); bleeds ${f1(mean(all.map(r => r.bleeds)))}; human revived by allies ${f1(mean(all.map(r => r.revMe)))}; spent ${Math.round(mean(all.map(r => r.share)) * 100)}%; tier ${f1(mean(all.map(r => r.tierMax)))}; wall ${Math.round(mean(all.map(r => r.wallMax)))}; perks ${f1(mean(all.map(r => r.perks)))}; streaks ${f1(mean(all.map(r => r.deploys)))}`);
