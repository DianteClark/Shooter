// Stats code checks (js/game/telemetry.js): encode/decode round trips with builds, mode groups and gear rows, the
// owner's older codes, and that a decoder from before mode groups reads a new code's totals unchanged.
//   node dev/sim-telemetry.mjs
import { readFileSync } from 'node:fs';
import { GunStats, decodeStatsCode, encodeStatsCode, FIELDS, SCOPES, EQ_PREFIX, MODE_GROUPS, UNKNOWN_GROUP, modeGroupOf }
  from '../js/game/telemetry.js';

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const NF = FIELDS.length;
const row = (seed) => Array.from({ length: NF }, (_, i) => (seed * 7 + i * 3) % 50);
const rec = (mg, b, seed, extra = {}) => ({
  at: 1000 + seed, b, map: 'pier', mode: 'tdm', mg, live: 200 + seed, pm: { a: 12, h: 1, m: 1 },
  g: { a: { ar: row(seed), [EQ_PREFIX + 'frag']: row(seed + 1), ...extra }, h: { ar: row(seed + 2) }, m: { ar: row(seed + 2) } },
});
const sameRows = (x, y) => SCOPES.every(s => {
  const kx = Object.keys(x.g[s]).sort(), ky = Object.keys(y.g[s]).sort();
  return kx.join() === ky.join() && kx.every(k => x.g[s][k].join() === y.g[s][k].join()) && x.pm[s] === y.pm[s];
});

// Mode groups of the real modes.
check(modeGroupOf('tdm') === 'core' && modeGroupOf('hard') === 'core' && modeGroupOf('gwdom') === 'gw'
  && modeGroupOf('br') === 'br' && modeGroupOf('rbduo') === 'br' && modeGroupOf('exq') === 'ex'
  && modeGroupOf('gf') === 'sd' && modeGroupOf('zm') === 'zm', 'modeGroupOf maps every group');
check(modeGroupOf(null, 'zm') === 'zm' && modeGroupOf(null, 'tdm') === UNKNOWN_GROUP, 'older records: rules decide when they can');

// Live store: Graveyard Shift stays out of the totals, every group keeps its own.
GunStats.clear();
GunStats.add(rec('core', '1118-1', 1));
GunStats.add(rec('gw', '1118-1', 2));
GunStats.add(rec('zm', '1118-1', 3, { autoshot: row(9) }));
GunStats.add(rec('core', '1118-2', 4));
const tot = GunStats.totals();
check(tot.matches === 3, 'totals leave Graveyard Shift out (3 of 4 matches)');
check(!tot.g.a.autoshot, 'a zombie-only gun is not in the totals');
check(tot.byGroup.zm?.matches === 1 && tot.byGroup.zm.g.a.autoshot, 'Graveyard Shift keeps its own group');
check(tot.byGroup.core.matches === 2 && tot.byGroup.gw.matches === 1, 'core and gw groups');
check(tot.g.a.ar[0] === row(1)[0] + row(2)[0] + row(4)[0], 'totals sum the PvP matches');

// Round trip of the live code.
const code = GunStats.exportCode();
const dec = decodeStatsCode(code);
check(dec && sameRows(dec, tot), 'round trip: totals');
check(dec.g.a[EQ_PREFIX + 'frag']?.join() === tot.g.a[EQ_PREFIX + 'frag'].join(), 'round trip: gear row with a colon');
check(MODE_GROUPS.every(k => !tot.byGroup[k] || (dec.byGroup[k] && dec.byGroup[k].matches === tot.byGroup[k].matches
  && sameRows(dec.byGroup[k], tot.byGroup[k]))), 'round trip: every mode group');
check(Object.keys(dec.byBuild).sort().join() === Object.keys(tot.byBuild).sort().join() && sameRows(dec.byBuild['1118-1'], tot.byBuild['1118-1']), 'round trip: builds');
check(encodeStatsCode(dec) === code, 're-encoding a decoded code gives the same code');

// A decoder from before mode groups splits keys on '@' and keeps a, h, m and b: none of the new parts may look like those.
const newParts = code.split('~').slice(2).map(p => p.slice(0, p.indexOf(':'))).filter(k => k === 'g' || k.includes('!'));
check(newParts.length > 0 && newParts.every(k => !SCOPES.includes(k.split('@')[0]) && k !== 'b'), 'older decoders skip the group parts');
const stripped = code.split('~').filter(p => { const k = p.slice(0, p.indexOf(':')); return k !== 'g' && !k.includes('!'); }).join('~');
check(sameRows(decodeStatsCode(stripped), tot) && !decodeStatsCode(stripped).byGroup, 'the code without its group parts decodes to the same totals');

// One group only (not zm): no group rows written, decoder fills them from the totals.
GunStats.clear();
GunStats.add(rec('core', '1118-1', 5));
const one = GunStats.exportCode(), dOne = decodeStatsCode(one);
check(!one.includes('!core') && dOne.byGroup.core && sameRows(dOne.byGroup.core, dOne), 'one group: rows implied by the totals');

// Only Graveyard Shift: empty totals, the group carries the rows.
GunStats.clear();
GunStats.add(rec('zm', '1118-1', 6));
const z = decodeStatsCode(GunStats.exportCode());
check(z.matches === 0 && z.byGroup.zm.matches === 1 && z.byGroup.zm.g.a.ar, 'only Graveyard Shift: its own rows, empty totals');
GunStats.clear();

// The owner's codes from before groups (and before builds) still decode and round trip.
for (const f of ['docs/stats-2026-11-18.txt', 'docs/stats-2026-11-10-b.txt', 'docs/stats-2026-11-10-c.txt']) {
  let txt;
  try { txt = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { continue; }
  const d = decodeStatsCode(txt);
  check(d && d.matches > 0 && !d.byGroup, `${f}: decodes (${d?.matches} matches), no groups`);
  const again = decodeStatsCode(encodeStatsCode(d));
  check(again && sameRows(again, d), `${f}: round trip`);
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
