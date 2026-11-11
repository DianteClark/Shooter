// Adds up kills and deaths per gun over several dev/balance-sim.mjs --json files (seeds) and prints K/D, flagging
// guns outside the target band. With --vs=<files> (comma list) also prints the change against a second set.
//   node dev/kd-combine.mjs out-1.json out-2.json [--vs=stock-1.json,stock-2.json] [--band=0.85,1.2]
import { readFileSync } from 'node:fs';
import { WEAPONS } from '../js/shared/weapons.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const [lo, hi] = opt('band', '0.85,1.2').split(',').map(Number);
function sum(files) {
  const out = {};
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    for (const [g, r] of Object.entries(j.guns ?? {})) {
      const o = out[g] ??= { kills: 0, deaths: 0 };
      o.kills += r.kills; o.deaths += r.deaths;
    }
  }
  for (const o of Object.values(out)) o.kd = o.kills / Math.max(1, o.deaths);
  return out;
}
const a = sum(args.filter(x => !x.startsWith('--')));
const b = opt('vs', null) ? sum(opt('vs').split(',')) : null;
const rows = Object.entries(a).sort((x, y) => y[1].kd - x[1].kd);
const out = [];
for (const [g, r] of rows) {
  const flag = r.kd < lo || r.kd > hi ? '  <-- outside' : '';
  const vs = b?.[g] ? `  stock ${b[g].kd.toFixed(2)} (${r.kd >= b[g].kd ? '+' : ''}${(r.kd - b[g].kd).toFixed(2)})` : '';
  console.log(`${(WEAPONS[g]?.category ?? '').padEnd(9)}${g.padEnd(11)}${(WEAPONS[g]?.name ?? '').padEnd(12)}${r.kd.toFixed(2)}  ${String(r.kills).padStart(5)}/${String(r.deaths).padEnd(5)}${vs}${flag}`);
  if (flag) out.push(`${WEAPONS[g]?.name ?? g} ${r.kd.toFixed(2)}`);
}
console.log(`\n${rows.length} guns, K/D ${rows.at(-1)?.[1].kd.toFixed(2)} to ${rows[0]?.[1].kd.toFixed(2)}; outside ${lo}-${hi}: ${out.join(', ') || 'none'}`);
