// Greedy best-build search: for each gun, the strongest legal kit (every attachment unlocked) as judged by 1 v 1 duels
// against a fixed field of stock guns, so the balance rig can check that a gun's best build stays inside the target
// band (node dev/balance-sim.mjs --builds=out.json) and that no one attachment is in every best build.
//
//   node dev/best-builds.mjs                       every primary; writes dev/out/best-builds.json
//   node dev/best-builds.mjs --gun=ar,smg          named guns only (merged into the existing file)
//   node dev/best-builds.mjs --class=Sniper        one class
//   options: --trials=2 (aware duels per opponent and distance; flank duels are one each way) --passes=2 --seed=1
//            --out=dev/out/best-builds.json --sidearms (search the sidearms instead of the primaries)
//   node dev/best-builds.mjs --sigs [--trials=4]   no search: each signature alone on stock against the same field,
//            printed as the gun's win rate stock -> with it (is every signature an upgrade over the stock part?)
//
// Score of a kit: mean win rate (a draw counts half) over FIELD x {4,10,20,35,55 m} x {aware, flank, flanked}, Regular
// bots both sides. The same seed is used for every candidate of a gun, so candidates face the same dice where their
// play does not diverge (common random numbers): differences come from the kit, not from the draw.
// Search: start stock; for each slot in turn try every option (and none) with the other slots held, keep the best;
// repeat for --passes or until nothing changes. A greedy coordinate ascent, not an exhaustive one: it finds what a
// player tuning one slot at a time would settle on, which is what "most-picked" builds look like.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { Sim } from '../js/sim/sim.js';
import { SIM_HZ, PRIMARY_IDS, SECONDARY_IDS, GOLDEN_ID } from '../js/shared/constants.js';
import { WEAPONS } from '../js/shared/weapons.js';
import { normalizeLoadout } from '../js/shared/catalog.js';
import { SLOTS, availableFor, normalizeKit } from '../js/shared/attachments.js';
import { perimeter, edgeSpawns, navGrid } from '../js/shared/maps/build.js';

const args = process.argv.slice(2);
const has = k => args.includes(`--${k}`);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const TRIALS = Number(opt('trials', 2)), PASSES = Number(opt('passes', 2)), SEED = Number(opt('seed', 1));
const OUT = opt('out', 'dev/out/best-builds.json');
const STEP = 1 / SIM_HZ;
const DISTS = [4, 10, 20, 35, 55];
const SIDEARMS = has('sidearms');
const POOL = SIDEARMS ? SECONDARY_IDS.filter(id => id !== GOLDEN_ID && !WEAPONS[id].melee) : PRIMARY_IDS.filter(id => WEAPONS[id] && !WEAPONS[id].melee);
// One stock gun per role, so a kit is judged against every kind of fight it will meet.
const FIELD = SIDEARMS ? ['pistol', 'revolver', 'machpistol', 'deuce', 'scatter', 'akimbo']
  : ['ar', 'carbine', 'smg', 'pdw', 'shotgun', 'autoshot', 'lmg', 'dmr', 'battle', 'sniper'];

let list = POOL;
if (opt('gun', null)) list = opt('gun').split(',');
else if (opt('class', null)) list = POOL.filter(id => WEAPONS[id].category.toLowerCase() === opt('class').toLowerCase());

function hash(...parts) {
  let h = 2166136261;
  for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// The duel strip and one duel, as in dev/balance-sim.mjs (kept in step by hand: same arena, same scenarios).
function arena() {
  const W = 124, H = 26, walls = [];
  perimeter(walls, W, H);
  return {
    id: 'duel-arena', name: 'Duel strip', theme: 'railyard', size: 'large', region: 'industrial', width: W, height: H, walls,
    spawns: edgeSpawns(W, H, 3, [5, 9, 13, 17, 21]),
    lanes: [{ id: 'north', z: 7 }, { id: 'mid', z: 13 }, { id: 'south', z: 19 }],
    nav: navGrid(walls, [10, 30, 50, 62, 74, 94, 114], [7, 13, 19]),
    points: {},
  };
}
const ARENA = arena();

// Sidearms are carried as the main gun, as in balance-sim --sidearms.
const loadout = (gun, kit) => normalizeLoadout({ primary: gun, secondary: gun === 'pistol' ? 'revolver' : 'pistol', attachments: { [gun]: kit } });

function duelSim(gunA, kitA, gunB, seed) {
  const roster = [
    { id: 'A', name: 'A', team: 0, isBot: true, skill: 'regular', primary: gunA, camo: 'none', loadout: loadout(gunA, kitA) },
    { id: 'B', name: 'B', team: 1, isBot: true, skill: 'regular', primary: gunB, camo: 'none', loadout: loadout(gunB, {}) },
  ];
  const sim = new Sim({ roster, map: ARENA, seed, mode: 'tdm', scoreLimit: 1e9, timeLimit: 1e9 });
  while (sim.phase !== 'live') sim.step(STEP);
  sim.step(STEP);
  for (const p of sim.players) { p.bot._thinkStreaks = () => {}; p.bot._thinkEquipment = () => {}; p.bot._thinkTurrets = () => {}; }
  return sim;
}

function duel(sim, d, scenario) {
  const [a, b] = sim.players;
  const z = 13 + (sim.rng() - 0.5) * 6, zb = 13 + (sim.rng() - 0.5) * 6;
  let ax, bx, aimA, aimB;
  if (scenario === 'aware') { ax = 62 - d / 2; bx = 62 + d / 2; aimA = 0; aimB = Math.PI; }
  else if (scenario === 'flankA') { bx = 64; ax = 64 - d; aimA = 0; aimB = 0; }
  else { ax = 60; bx = 60 + d; aimA = Math.PI; aimB = Math.PI; }
  sim._placeAt(a, { x: ax, z }, aimA);
  sim._placeAt(b, { x: bx, z: zb }, aimB);
  a.spawnProtect = 0; b.spawnProtect = 0;
  sim.drainEvents();
  if (scenario !== 'flankB') a.bot._note(b.ps.x, b.ps.z);
  if (scenario !== 'flankA') b.bot._note(a.ps.x, a.ps.z);
  const end = Math.round((7 + d / 5) * SIM_HZ);
  for (let t = 0; t < end; t++) {
    sim.step(STEP);
    if (!a.alive || !b.alive) break;
  }
  sim.events.length = 0;
  return !b.alive && a.alive ? 1 : !a.alive && b.alive ? 0 : 0.5;
}

function score(gun, kit) {
  let w = 0, n = 0;
  for (const opp of FIELD) {
    if (opp === gun) continue;
    const sim = duelSim(gun, kit, opp, hash('bb', SEED, gun, opp));
    for (const d of DISTS) {
      for (let t = 0; t < TRIALS; t++) { w += duel(sim, d, 'aware'); n++; }
      w += duel(sim, d, 'flankA'); w += duel(sim, d, 'flankB'); n += 2;
    }
  }
  return w / n;
}

function search(gun) {
  let kit = {};
  const stock = score(gun, kit);
  let best = stock, evals = 1;
  for (let pass = 0; pass < PASSES; pass++) {
    let changed = false;
    for (const slot of SLOTS) {
      const opts = availableFor(gun, slot);
      if (!opts.length) continue;
      let pick = kit[slot] ?? null, pickScore = best;
      for (const id of [null, ...opts.map(a => a.id)]) {
        if (id === (kit[slot] ?? null)) continue;
        const k = { ...kit };
        if (id) k[slot] = id; else delete k[slot];
        const s = score(gun, k); evals++;
        if (s > pickScore + 1e-9) { pick = id; pickScore = s; }
      }
      if (pick !== (kit[slot] ?? null)) {
        changed = true;
        if (pick) kit[slot] = pick; else delete kit[slot];
        best = pickScore;
      }
    }
    if (!changed) break;
  }
  return { kit: { ...normalizeKit(gun, kit) }, score: best, stock, evals };
}

if (has('sigs')) {
  let worse = 0;
  for (const gun of list) {
    const sigs = availableFor(gun).filter(a => a.kind === 'sig');
    if (!sigs.length) continue;
    const stock = score(gun, {});
    const cells = sigs.map(a => { const s = score(gun, { [a.slot]: a.id }); if (s < stock) worse++; return `${a.name} ${(s * 100).toFixed(1)}% (${s >= stock ? '+' : ''}${((s - stock) * 100).toFixed(1)})`; });
    console.log(`${gun.padEnd(11)}${WEAPONS[gun].name.padEnd(12)} stock ${(stock * 100).toFixed(1)}%  ${cells.join('  ')}`);
  }
  console.log(`signatures under stock: ${worse}`);
  process.exit(0);
}
if (!existsSync('dev/out')) mkdirSync('dev/out', { recursive: true });
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const t0 = performance.now();
for (const gun of list) {
  const r = search(gun);
  out[gun] = r;
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`${gun.padEnd(11)}${WEAPONS[gun].name.padEnd(12)} stock ${(r.stock * 100).toFixed(1)}%  best ${(r.score * 100).toFixed(1)}%  ${SLOTS.map(s => r.kit[s] ?? '-').join(' / ')}  (${r.evals} evals, ${((performance.now() - t0) / 1000).toFixed(0)} s)`);
}
// How often each attachment is in a best build, of the guns that can take it.
const count = {}, could = {};
for (const g in out) {
  for (const s of SLOTS) if (out[g].kit[s]) count[out[g].kit[s]] = (count[out[g].kit[s]] || 0) + 1;
  for (const a of availableFor(g)) could[a.id] = (could[a.id] || 0) + 1;
}
console.log('\nmost picked:', Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, n]) => `${id} ${n}/${could[id]}`).join(', '));
