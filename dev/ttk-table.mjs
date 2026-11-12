// Ideal time to kill per range band: body shots, aimed, every round (every pellet) landing, from the effective def of
// each gun with a build. TTK = the time from the first round to the killing round: shot intervals as js/sim/player.js
// fires them (wind-up, burst gap and recovery), plus the charge time of a charge gun. Not what a bot achieves (the match
// table's ttk is that), but where a build moves a gun's kill breakpoints.
//
//   node dev/ttk-table.mjs                                   stock
//   node dev/ttk-table.mjs --builds=dev/out/best-builds.json [--vs]   that build (--vs: show stock -> build)
//   node dev/ttk-table.mjs --picks=dev/out/best-builds.json  how often each part is in a best build (of guns that take it)
import { readFileSync } from 'node:fs';
import { PRIMARY_IDS, MAX_HP } from '../js/shared/constants.js';
import { WEAPONS, effectiveWeapon, damageAt } from '../js/shared/weapons.js';
import { SLOTS, ATTACHMENTS, availableFor } from '../js/shared/attachments.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const DISTS = [5, 10, 20, 35, 55];
const GUNS = PRIMARY_IDS.filter(id => WEAPONS[id] && !WEAPONS[id].melee);

if (opt('picks', null)) {
  const b = JSON.parse(readFileSync(opt('picks'), 'utf8'));
  const count = {}, could = {};
  for (const g of GUNS) {
    for (const s of SLOTS) if (b[g]?.kit?.[s]) count[b[g].kit[s]] = (count[b[g].kit[s]] || 0) + 1;
    for (const a of availableFor(g)) could[a.id] = (could[a.id] || 0) + 1;
  }
  const rows = Object.entries(count).sort((x, y) => y[1] / could[y[0]] - x[1] / could[x[0]] || y[1] - x[1]);
  console.log(`part              in best builds   share of guns that take it   share of all ${GUNS.length} builds`);
  for (const [id, n] of rows) console.log(`${(ATTACHMENTS[id]?.name ?? id).padEnd(20)}${String(n).padStart(4)} / ${String(could[id]).padEnd(4)}${(100 * n / could[id]).toFixed(0).padStart(14)}%${(100 * n / GUNS.length).toFixed(0).padStart(26)}%`);
  process.exit(0);
}

function ttk(w, dist) {
  if (dist > w.range) return null;
  const per = damageAt(w, dist, true) * (w.pellets || 1);
  if (per <= 0) return null;
  const n = Math.ceil(MAX_HP / per);
  let t = w.charge ? w.charge.time : 0, burstLeft = w.burst ? w.burst.count : 0;
  for (let i = 1; i < n; i++) {
    if (w.burst) {
      burstLeft--;
      if (burstLeft > 0) t += w.burst.gap;
      else { t += Math.max(w.burst.gap, w.burst.count * 60 / w.rpm - (w.burst.count - 1) * w.burst.gap); burstLeft = w.burst.count; }
    } else {
      let rpm = w.rpm;
      if (w.spinup) rpm *= w.spinup.from + (1 - w.spinup.from) * Math.min(1, (i - 1) / w.spinup.shots);
      t += 60 / rpm;
    }
    if (w.magazine && i >= w.magazine) return null;
  }
  return { n, t };
}

const builds = opt('builds', null) ? JSON.parse(readFileSync(opt('builds'), 'utf8')) : null;
const vs = args.includes('--vs');
const cell = r => (r ? `${r.n}/${r.t.toFixed(2)}` : '-').padStart(vs ? 9 : 10);
console.log(`gun        name        shots/seconds at ${DISTS.map(d => `${d}m`.padStart(vs ? 19 : 10)).join('')}`);
for (const g of GUNS) {
  const kit = builds?.[g]?.kit ?? {};
  const w = effectiveWeapon(g, kit), s = WEAPONS[g];
  const cells = DISTS.map(d => (vs ? `${cell(ttk(s, d))}->${cell(ttk(w, d)).trim().padEnd(8)}` : cell(ttk(w, d))));
  console.log(`${g.padEnd(11)}${s.name.padEnd(12)}${cells.join(' ')}`);
}
