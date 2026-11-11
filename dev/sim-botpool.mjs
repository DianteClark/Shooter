// The bot player pool (js/shared/botpool.js) and its matchmaking. node dev/sim-botpool.mjs
//   pool       deterministic (a fresh process builds the identical pool), 150-200 profiles, unique ids and tags, tags
//              short and plain, no tag clashes with any gun, attachment, perk, equipment, streak, operator, skin, map,
//              mode, medal, card, emblem, camo, tracer or kill effect name
//   profiles   every gun, sidearm, perk, item, streak, operator, skin, card, emblem and camo exists; styles and locks
//   form       locked profiles always play at their tier; the rest roll a per-match rating around their own level, the
//              same for the same match on every phone, with the odd bad night and hot streak
//   matchmaking  no bot twice in a lobby; draws follow the target rating and level with spread; back-to-back lobbies
//              seldom repeat; rosters for TDM, FFA, Gun Game, Ground War and battle royale; even teams; Custom's tier override
//   careerAt   deterministic, every total non-decreasing over two years of dates, sane rates, cheap
//   skillAt    the tiers at their ratings, and everything between them in between
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Pool from '../js/shared/botpool.js';
import { buildRoster } from '../js/sim/sim.js';
import { SKILLS, skillAt } from '../js/sim/bots.js';
import { WEAPONS } from '../js/shared/weapons.js';
import { ATTACHMENTS } from '../js/shared/attachments.js';
import { V11_ATTACHMENTS } from '../js/shared/attachments-v11.js';
import { PRIMARY_IDS, SECONDARY_IDS, GOLDEN_ID } from '../js/shared/constants.js';
import { PERKS, PRO, TACTICALS, LETHALS, STREAKS } from '../js/shared/catalog.js';
import { CARDS, prestigeName, MAX_LEVEL, MAX_PRESTIGE } from '../js/shared/progression.js';
import { CAMOS, TRACERS, KILL_EFFECTS } from '../js/shared/camos.js';
import { MAPS } from '../js/shared/map.js';
import { MODES } from '../js/shared/modes.js';
import { OPERATORS, SKINS, getSkin } from '../js/ui/operators.js';
import { EMBLEMS } from '../js/ui/emblems.js';

const { BOT_POOL, formRating, pickPoolBots, careerAt, humanRating, tierOf, POOL_EPOCH, HUMAN_BASE, STYLES, TIER_RATING } = Pool;
let failed = 0;
const ok = (cond, label, info = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${info ? `: ${info}` : ''}`); if (!cond) failed++; };
const DAY = 86400000;
const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };

// ---- Pool ----
console.log('pool');
const digest = JSON.stringify(BOT_POOL);
const here = fileURLToPath(new URL('../js/shared/botpool.js', import.meta.url));
const fresh = execFileSync(process.execPath, ['--input-type=module', '-e', `import('${here}').then(m => process.stdout.write(JSON.stringify(m.BOT_POOL)))`], { encoding: 'utf8', maxBuffer: 1 << 26 });
ok(fresh === digest, 'a fresh process builds the identical pool');
const src = readFileSync(here, 'utf8');
ok(!/Math\.random/.test(src), 'no Math.random in the pool');
ok(BOT_POOL.length >= 150 && BOT_POOL.length <= 200, 'pool size', BOT_POOL.length);
ok(new Set(BOT_POOL.map(p => p.id)).size === BOT_POOL.length, 'ids unique');
const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
const names = BOT_POOL.map(p => p.name);
ok(new Set(names.map(n => n.toLowerCase())).size === names.length, 'tags unique (ignoring case)');
ok(names.every(n => /^[A-Za-z0-9_]{3,12}$/.test(n)), 'tags 3-12 characters of letters, digits and _');
ok(new Set(names.map(norm)).size === names.length, 'tags unique ignoring digits and _');

// Every item name in the game. Single words match a tag's word or any part of it (4+ letters); longer names match
// the tag squeezed down to letters.
const items = new Set();
const add = v => { if (typeof v === 'string' && v.trim()) items.add(v.trim()); };
const walk = (o, depth = 0) => {
  if (!o || depth > 3) return;
  if (Array.isArray(o)) o.forEach(x => walk(x, depth + 1));
  else if (typeof o === 'object') { add(o.name); if (depth < 2) for (const k in o) if (typeof o[k] === 'object') walk(o[k], depth + 1); }
};
[WEAPONS, ATTACHMENTS, V11_ATTACHMENTS, PERKS, PRO, TACTICALS, LETHALS, STREAKS, OPERATORS, SKINS, EMBLEMS, CARDS, CAMOS, TRACERS, KILL_EFFECTS, MAPS, MODES].forEach(t => walk(t));
for (let i = 0; i <= MAX_PRESTIGE; i++) add(prestigeName(i));
const hud = readFileSync(fileURLToPath(new URL('../js/ui/hud.js', import.meta.url)), 'utf8');
const medals = hud.slice(hud.indexOf('const MEDALS = {'), hud.indexOf('};', hud.indexOf('const MEDALS = {')));
for (const m of medals.matchAll(/['"]([A-Z][^'"]{2,30})['"]/g)) add(m[1]);
const words = t => t.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z]+/).filter(Boolean).map(w => w.toLowerCase());
const clashes = [];
for (const t of names) {
  const n = norm(t), tw = words(t);
  for (const it of items) {
    const k = norm(it), single = !/[\s-]/.test(it);
    if (k.length < 3) continue;
    if (n === k || (single && k.length >= 4 && (tw.includes(k) || n.includes(k))) || (!single && k.length >= 6 && n.includes(k))) clashes.push(`${t} ~ ${it}`);
  }
}
ok(items.size > 500, 'item names collected', items.size);
ok(clashes.length === 0, 'no tag matches an item, map or mode name', clashes.slice(0, 8).join(', '));

// ---- Profiles ----
console.log('profiles');
const bad = [];
const primaries = new Set(PRIMARY_IDS.filter(id => WEAPONS[id]));
const cardIds = new Set(CARDS.map(c => c.id)), emblemIds = new Set(EMBLEMS.map(e => e.id)), camoIds = new Set(CAMOS.map(c => c.id));
const opIds = new Set(OPERATORS.map(o => o.id));
for (const p of BOT_POOL) {
  const why = [];
  if (p.guns.length !== 3 || p.guns.some(g => !primaries.has(g) || g === GOLDEN_ID)) why.push('guns');
  if (new Set(p.guns).size !== 3) why.push('guns repeat');
  if (p.guns.some(g => !(p.kit[g] >= 0))) why.push('kit');
  if (!SECONDARY_IDS.includes(p.secondary) || p.secondary === GOLDEN_ID) why.push('secondary');
  if (p.perks.length !== 3 || p.perks.some((k, i) => PERKS[k]?.tier !== i)) why.push('perks');
  if (!TACTICALS[p.tactical] || !LETHALS[p.lethal]) why.push('equipment');
  if (p.streaks.length !== 3 || new Set(p.streaks).size !== 3 || p.streaks.some(s => !STREAKS[s])) why.push('streaks');
  if (!opIds.has(p.operator) || getSkin(p.skin)?.operator !== p.operator) why.push('operator/skin');
  if (!cardIds.has(p.card)) why.push('card');
  if (p.emblem !== null && !emblemIds.has(p.emblem)) why.push('emblem');
  if (!camoIds.has(p.camo)) why.push('camo');
  if (!STYLES[p.style]) why.push('style');
  if (p.skill.locked ? TIER_RATING[p.skill.locked] === undefined : !(p.skill.mu >= 0 && p.skill.mu <= 1 && p.skill.form > 0)) why.push('skill');
  if (why.length) bad.push(`${p.name}: ${why.join(',')}`);
}
ok(bad.length === 0, 'every profile names things that exist', bad.slice(0, 5).join('; '));
const locked = BOT_POOL.filter(p => p.skill.locked);
const share = locked.length / BOT_POOL.length;
ok(share >= 0.15 && share <= 0.26, 'about a fifth locked', `${(share * 100).toFixed(0)}%`);
for (const t of ['elite', 'recruit']) ok(locked.filter(p => p.skill.locked === t).length >= 8, `locked ${t}s`, locked.filter(p => p.skill.locked === t).length);
const styles = new Set(BOT_POOL.map(p => p.style));
ok(styles.size === Object.keys(STYLES).length, 'every play style present', [...styles].join(' '));
const mus = BOT_POOL.filter(p => !p.skill.locked).map(p => p.skill.mu);
ok(Math.min(...mus) < 0.2 && Math.max(...mus) > 0.8 && Math.abs(mean(mus) - 0.5) < 0.08, 'usual levels span weak to strong', `${Math.min(...mus).toFixed(2)}..${Math.max(...mus).toFixed(2)}, mean ${mean(mus).toFixed(2)}`);
const opsUsed = new Set(BOT_POOL.map(p => p.operator)), gunsUsed = new Set(BOT_POOL.flatMap(p => p.guns));
ok(opsUsed.size >= OPERATORS.length - 3, 'operators spread', `${opsUsed.size}/${OPERATORS.length}`);
ok(gunsUsed.size >= primaries.size * 0.8, 'favourite guns spread', `${gunsUsed.size}/${primaries.size}`);

// ---- Form ----
console.log('form');
const seeds = Array.from({ length: 400 }, (_, i) => 1000 + i * 7919);
ok(locked.every(p => seeds.slice(0, 40).every(s => formRating(p, s) === formRating(p, 1))), 'locked profiles play at their tier every match');
ok(locked.every(p => tierOf(formRating(p, 3)) === p.skill.locked), 'locked rating sits in its tier');
const free = BOT_POOL.filter(p => !p.skill.locked);
ok(free.every(p => formRating(p, 42) === formRating(p, 42)), 'a match roll is the same every time (every phone)');
let offN = 0, hotN = 0, n = 0, tierMoves = 0;
const devs = [];
for (const p of free.slice(0, 60)) {
  const r = seeds.map(s => formRating(p, s));
  devs.push(Math.abs(mean(r) - p.skill.mu));
  for (const v of r) { n++; if (v < p.skill.mu - 2 * p.skill.form) offN++; if (v > p.skill.mu + 1.6 * p.skill.form) hotN++; if (tierOf(v) !== tierOf(p.skill.mu)) tierMoves++; }
}
ok(mean(devs) < 0.04, 'form averages out to the usual level', mean(devs).toFixed(3));
ok(offN / n > 0.03 && offN / n < 0.15, 'bad nights happen, now and then', `${(offN / n * 100).toFixed(1)}%`);
ok(hotN / n > 0.03 && hotN / n < 0.2, 'hot streaks too', `${(hotN / n * 100).toFixed(1)}%`);
ok(tierMoves / n > 0.15, 'a player is not always the same tier', `${(tierMoves / n * 100).toFixed(0)}% of matches off their usual tier`);

// ---- Matchmaking ----
console.log('matchmaking');
Pool.forgetRecentLobbies();
const lobby = pickPoolBots({ count: 31, seed: 9, recent: [] });
ok(new Set(lobby.map(b => b.profile.id)).size === 31, 'no bot twice in a 32-player lobby');
ok(JSON.stringify(pickPoolBots({ count: 11, seed: 77, recent: [], date: POOL_EPOCH })) === JSON.stringify(pickPoolBots({ count: 11, seed: 77, recent: [], date: POOL_EPOCH })), 'deterministic for a seed');
const ex = lobby.slice(0, 20).map(b => b.profile.id);
ok(pickPoolBots({ count: 40, seed: 3, exclude: ex, recent: [] }).every(b => !ex.includes(b.profile.id)), 'excluded profiles are never drawn');
const drawMean = (target, extra = {}) => mean(Array.from({ length: 40 }, (_, k) => mean(pickPoolBots({ count: 11, seed: 500 + k, target, recent: [], ...extra }).map(b => b.profile.skill.mu))));
const lo = drawMean(0.2), mid = drawMean(0.5), hi = drawMean(0.8);
ok(lo < mid - 0.1 && mid < hi - 0.1, 'lobbies follow the target rating', `${lo.toFixed(2)} / ${mid.toFixed(2)} / ${hi.toFixed(2)} for 0.2 / 0.5 / 0.8`);
const spreadIn = sd(pickPoolBots({ count: 60, seed: 5, target: 0.5, recent: [] }).map(b => b.rating));
ok(spreadIn > 0.1 && spreadIn < 0.35, 'with spread: a lobby holds weaker and stronger players', spreadIn.toFixed(2));
const date = POOL_EPOCH + 30 * DAY;
const rankOf = b => b.badge.prestige * MAX_LEVEL + b.badge.level;
const newbies = mean(Array.from({ length: 20 }, (_, k) => mean(pickPoolBots({ count: 11, seed: 900 + k, level: { prestige: 0, level: 5 }, recent: [], date }).map(rankOf))));
const vets = mean(Array.from({ length: 20 }, (_, k) => mean(pickPoolBots({ count: 11, seed: 900 + k, level: { prestige: 8, level: 30 }, recent: [], date }).map(rankOf))));
ok(newbies < vets - 60, 'lobbies lean toward the players\' level', `mean rank ${newbies.toFixed(0)} for a level 5, ${vets.toFixed(0)} for prestige 8`);
Pool.forgetRecentLobbies();
let overlap = 0, same = 0, prev = null;
for (let k = 0; k < 60; k++) {
  const ids = pickPoolBots({ count: 11, seed: 3000 + k, date }).map(b => b.profile.id);
  if (prev) { const o = ids.filter(id => prev.includes(id)).length; overlap += o; if (o === ids.length) same++; }
  prev = ids;
}
ok(same === 0, 'never the exact same lobby twice in a row (60 lobbies)');
ok(overlap / 59 < 2, 'back to back lobbies share few players', `${(overlap / 59).toFixed(2)} of 11 on average`);

// Rosters.
const human = { id: 'me', name: 'me', team: 0, loadout: { primary: 'ar' }, badge: { level: 20, prestige: 1 } };
const pool = { recent: [], date, target: HUMAN_BASE };
const checkRoster = (label, r, size) => {
  const bots = r.filter(e => e.isBot);
  const okNames = new Set(r.map(e => e.name)).size === r.length && new Set(bots.map(b => b.pool)).size === bots.length;
  const okFields = bots.every(b => typeof b.rating === 'number' && b.style && b.badge && b.operator && b.loadout.skin && b.pool && WEAPONS[b.primary]);
  ok(r.length === size && okNames && okFields, `${label}: ${size} players, unique named pool bots with level, looks and loadout`);
};
const tdm = buildRoster([human], { mode: 'tdm', mapId: 'pier', seed: 11, pool });
checkRoster('TDM', tdm, 12);
checkRoster('Ground War', buildRoster([human], { mode: 'gwtdm', mapId: 'harvest', seed: 11, pool }), 32);
checkRoster('free-for-all', buildRoster([human], { mode: 'ffa', mapId: 'pier', seed: 11, pool }), buildRoster([human], { mode: 'ffa', mapId: 'pier', seed: 11 }).length);
const gun = buildRoster([human], { mode: 'gun', mapId: 'pier', seed: 11, pool });
checkRoster('Gun Game', gun, buildRoster([human], { mode: 'gun', mapId: 'pier', seed: 11 }).length);
ok(gun.filter(e => e.isBot).every(e => e.loadout.ladder), 'Gun Game bots start on the ladder');
checkRoster('battle royale', buildRoster([human], { mode: 'br', seed: 11, pool }), 32);
let diff = 0;
for (let k = 0; k < 30; k++) {
  const r = buildRoster([human], { mode: 'tdm', mapId: 'pier', seed: 100 + k, pool });
  const side = t => r.filter(e => e.team === t).reduce((a, e) => a + (e.rating ?? HUMAN_BASE), 0);
  diff += Math.abs(side(0) - side(1));
}
ok(diff / 30 < 0.35, 'teams come out even (sum of ratings)', `mean gap ${(diff / 30).toFixed(2)} over 6 players`);
const elite = buildRoster([human], { mode: 'tdm', mapId: 'pier', seed: 11, botSkill: 'elite', pool });
ok(elite.filter(e => e.isBot).every(e => e.rating === 1 && e.skill === 'elite' && e.pool), 'Custom difficulty holds every pool bot at that tier');
const legacy = buildRoster([human], { mode: 'tdm', mapId: 'pier', seed: 11 });
ok(legacy.filter(e => e.isBot).every(e => e.rating === undefined && !e.pool), 'without `pool`, rosters are dealt as before');

// ---- careerAt ----
console.log('careerAt');
const KEYS = ['matches', 'kills', 'deaths', 'wins', 'brMatches', 'brWins', 'brTop5', 'xp', 'extractions'];
let mono = true, where = '';
for (const p of BOT_POOL) {
  let last = careerAt(p, POOL_EPOCH - 5 * DAY);
  for (let d = 0; d <= 730 && mono; d += (d < 30 ? 1 : 9)) {
    const c = careerAt(p, POOL_EPOCH + d * DAY + 3600e3);
    for (const k of KEYS) if (c[k] < last[k]) { mono = false; where = `${p.name} ${k} day ${d}`; }
    if (c.prestige * MAX_LEVEL + c.level < last.prestige * MAX_LEVEL + last.level) { mono = false; where = `${p.name} level day ${d}`; }
    last = c;
  }
}
ok(mono, 'every total non-decreasing over two years', where);
const a = careerAt(BOT_POOL[7], new Date(POOL_EPOCH + 100 * DAY)), b = careerAt(BOT_POOL[7], POOL_EPOCH + 100 * DAY);
ok(JSON.stringify(a) === JSON.stringify(b), 'a Date and its time give the same career');
ok(BOT_POOL.every(p => { const c = careerAt(p, POOL_EPOCH - DAY); return c.kills === Math.floor(p.base.kills) && c.matches === p.base.matches; }), 'before the epoch: the base career');
ok(BOT_POOL.every(p => careerAt(p, POOL_EPOCH + 400 * DAY).extractions === 0), 'no extractions before the mode exists');
const yr = BOT_POOL.map(p => careerAt(p, POOL_EPOCH + 365 * DAY));
ok(yr.every(c => c.level >= 1 && c.level <= MAX_LEVEL && c.prestige >= 0 && c.prestige <= MAX_PRESTIGE && c.wins <= c.matches && c.brWins <= c.brTop5 && c.brTop5 <= c.brMatches), 'levels, prestige and wins in range');
const strong = BOT_POOL.filter(p => p.skill.mu > 0.75), weak = BOT_POOL.filter(p => p.skill.mu < 0.25);
const kdOf = list => mean(list.map(p => careerAt(p, POOL_EPOCH + 365 * DAY).kd));
ok(kdOf(strong) > kdOf(weak) + 0.6, 'strong players\' careers read strong', `K/D ${kdOf(strong).toFixed(2)} vs ${kdOf(weak).toFixed(2)}`);
const t0 = performance.now();
for (const p of BOT_POOL) careerAt(p, POOL_EPOCH + 730 * DAY);
const ms = performance.now() - t0;
ok(ms < 60, 'the whole pool two years on is cheap', `${ms.toFixed(1)} ms`);
const nowC = BOT_POOL.map(p => careerAt(p, POOL_EPOCH + 10 * DAY));
const prest = nowC.map(c => c.prestige);
ok(prest.filter(v => v === 0).length > 10 && prest.filter(v => v === MAX_PRESTIGE).length < BOT_POOL.length * 0.4, 'levels spread at launch', `${prest.filter(v => v === 0).length} unprestiged, ${prest.filter(v => v === MAX_PRESTIGE).length} at the top`);

// ---- skillAt and humanRating ----
console.log('skillAt');
const tierMatch = ['recruit', 'regular', 'veteran', 'elite'].every(t => {
  const S = skillAt(TIER_RATING[t]);
  return Object.keys(SKILLS[t]).every(k => JSON.stringify(S[k]) === JSON.stringify(SKILLS[t][k]) || Math.abs(S[k] - SKILLS[t][k]) < 1e-9);
});
ok(tierMatch, 'each tier\'s rating gives that tier\'s table');
let monoS = true;
for (let r = 0; r < 1; r += 0.05) {
  const x = skillAt(r), y = skillAt(r + 0.05);
  if (!(y.reaction[0] <= x.reaction[0] && y.aimError <= x.aimError && y.notice >= x.notice && y.tunnel <= x.tunnel && y.trade >= x.trade)) monoS = false;
}
ok(monoS, 'reaction, aim, awareness and decisions improve with rating');
ok(skillAt(0.5, 'anchor').holdProb > skillAt(0.5).holdProb && skillAt(0.5, 'flanker').flank > skillAt(0.5).flank, 'play style leans how a bot plays');
ok(skillAt(0.5, 'rusher').aimError === skillAt(0.5).aimError && skillAt(0.5, 'sniper').reaction[0] === skillAt(0.5).reaction[0], '...and never how well it shoots');
const hr = [0.4, 0.8, 1, 1.5, 3].map(kd => humanRating({ level: 20, kd, matches: 10 }));
ok(hr.every((v, i) => i === 0 || v > hr[i - 1]) && hr.every(v => v >= 0 && v <= 1), 'humanRating rises with K/D', hr.map(v => v.toFixed(2)).join(' '));
ok(humanRating({ level: 1 }) < humanRating({ level: 30, prestige: 2 }), 'and a little with level');

console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
