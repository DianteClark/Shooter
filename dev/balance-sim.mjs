// Weapon balance measurement: headless bot-vs-bot matches and duels, deterministic for a seed.
//
//   node dev/balance-sim.mjs                         every primary: mirrored matches + duels (about two minutes)
//   node dev/balance-sim.mjs --class=Shotgun         one class, quickly (its guns in every match, the rest as filler)
//   node dev/balance-sim.mjs --gun=pdw,battle        named guns only
//   node dev/balance-sim.mjs --sidearms              the sidearms, carried as the main gun, against each other
//   node dev/balance-sim.mjs --human                 the scripted human-like thumb (js/sim/humanlike.js) against bots
//   node dev/balance-sim.mjs --realistic             lobbies like the owner's: see REALISTIC below
//   options: --rounds=3 --seconds=120 --seed=1 --maps=pier+turnstile,railyard+dust,foundry+canyon --modes=tdm,dom --skill=mixed|regular|...
//            --trials=3 (duels per pairing, distance and scenario) --no-matches --no-duels --kits (bot attachments)
//            --streaks --equipment (both off by default: this measures guns) --json=out.json --compare=before.json
//            --assist=0.8 (human: Options aim-assist slider) --thumb=key:value,... (override THUMB fields)
//            --builds=dev/out/best-builds.json (V11: every gun carries the kit dev/best-builds.mjs found strongest, both
//            sides of the mirror, instead of none or --kits)
//
// REALISTIC (--realistic, Pass 2): what a real lobby is, as opposed to a gun lab. Rosters come from the game's own
// buildRoster (js/sim/sim.js) with Mixed skill, so bots draw their primaries, kits, perks, equipment and streaks the way
// they do in a match (twelve consecutive guns from a seeded offset, not mirrored); scorestreaks and equipment are on;
// the mode's own score limit applies; maps and modes are drawn the way Quick Play draws them (js/ui/vote.js
// resolvePick: map by size-tier weight, then any mode it hosts; Gun Game is left out because it hands out its own
// guns); and one human-like thumb (js/sim/humanlike.js) carries the gun under test (--gun / --class pick the thumb's
// guns; default: two of every class). --maps / --modes given explicitly replace the draw. Reported: every primary's
// K/D across all bots in those lobbies, and the thumb's K/D with each gun it carried. --seconds (default 300) caps a
// match; --rounds lobbies per thumb gun (default 3).
//
// MATCHES are mirrored: both teams field the same six guns in the same slots at the same skill, so a gun's kills and
// deaths are earned against an identical field. A round deals every gun into a set of six once and plays each set on
// every map and mode; guns, sets and skills rotate between rounds. Numbers come from the game's own MatchTelemetry
// (js/game/telemetry.js), so they mean what the Stats screen means: K/D is kills with the gun over deaths holding it.
//
// DUELS are 1 v 1 on an empty strip, same skill both sides, started 4, 10, 20, 35 and 55 m apart:
//   aware    facing each other and knowing where the other is (beyond sight range they have to close until they see)
//   flank    one side starts behind the other, unseen. `flank` is how often the flanker wins; `flanked` is how often
//            the gun survives being flanked.
// A duel nobody wins inside its time limit counts half to each. Win rates are against the whole field (every other
// gun in the run's list), so 50% is par at that distance.

import { writeFileSync, readFileSync } from 'node:fs';
import { MAPS, MAP_IDS, SIZES, sizeOf } from '../js/shared/map.js';
import { MODES, MODE_IDS, modeFitsMap } from '../js/shared/modes.js';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { SIM_HZ, PRIMARY_IDS, SECONDARY_IDS, GOLDEN_ID, CATEGORIES } from '../js/shared/constants.js';
import { WEAPONS } from '../js/shared/weapons.js';
import { normalizeLoadout } from '../js/shared/catalog.js';
import { botAttachments } from '../js/sim/bots.js';
import { MatchTelemetry, FIELDS, DIST_LABELS, gunRows } from '../js/game/telemetry.js';
import { wall, perimeter, edgeSpawns, navGrid } from '../js/shared/maps/build.js';
import { THUMB, makeHumanLike } from '../js/sim/humanlike.js';

const args = process.argv.slice(2);
const has = k => args.includes(`--${k}`);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const SEED = Number(opt('seed', 1));
const ROUNDS = Number(opt('rounds', 3));
const REALISTIC = has('realistic');
const SECONDS = Number(opt('seconds', REALISTIC ? 300 : 120));
const QUICK = REALISTIC && !opt('maps', null) && !opt('modes', null);
const TRIALS = Number(opt('trials', 3));
// A + B alternates by round, so a default run covers two maps of each size for the price of one.
const MAP_LIST = opt('maps', 'pier+turnstile,railyard+dust,foundry+canyon').split(',').map(m => m.split('+'));
const mapsFor = round => MAP_LIST.map(alts => alts[round % alts.length]);
const MODE_LIST = opt('modes', REALISTIC ? 'tdm,dom,kc' : 'tdm,dom').split(',');
const SKILL = opt('skill', 'regular');
const MIXED = ['regular', 'veteran', 'regular', 'recruit', 'regular', 'elite'];
const STEP = 1 / SIM_HZ;
const DISTS = [4, 10, 20, 35, 55];
const F = Object.fromEntries(FIELDS.map((k, i) => [k, i]));
const SIDEARMS = SECONDARY_IDS.filter(id => id !== GOLDEN_ID);
const WANT_SIDEARMS = has('sidearms');
const POOL = WANT_SIDEARMS ? SIDEARMS : PRIMARY_IDS.filter(id => WEAPONS[id]);     // Every gun the run can field.

function focusList() {
  const cls = opt('class', null), guns = opt('gun', null);
  let list = null;
  if (guns) list = guns.split(',');
  else if (cls) list = POOL.filter(id => cls.split(',').some(c => WEAPONS[id].category.toLowerCase() === c.toLowerCase()));
  if (list) for (const id of list) if (!WEAPONS[id]) { console.error(`unknown gun '${id}'`); process.exit(2); }
  if (list && !list.length) { console.error('no guns match'); process.exit(2); }
  return list;
}
const FOCUS = focusList();

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(...parts) {
  let h = 2166136261;
  for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}
function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---- Matches ----------------------------------------------------------------------------------------------------

const newAgg = () => ({ matches: 0, live: 0, pm: { a: 0, h: 0, m: 0 }, g: { a: {}, h: {}, m: {} } });
function foldRows(dst, src) {
  for (const gun in src) {
    const row = dst[gun] || (dst[gun] = new Array(FIELDS.length).fill(0));
    for (let i = 0; i < src[gun].length; i++) row[i] += src[gun][i] || 0;
  }
}

const BUILDS = opt('builds', null) ? JSON.parse(readFileSync(opt('builds'), 'utf8')) : null;
function loadoutFor(gun, skill, i) {
  return normalizeLoadout({
    primary: gun, secondary: gun === 'pistol' ? 'revolver' : 'pistol',
    attachments: BUILDS ? { [gun]: BUILDS[gun]?.kit ?? {} } : has('kits') ? { [gun]: botAttachments(gun, skill, i) } : {},
  });
}

function quiet(sim) {
  for (const p of sim.players) {
    if (!p.bot) continue;
    if (!has('streaks') && !REALISTIC) p.bot._thinkStreaks = () => {};
    if (!has('equipment') && !REALISTIC) p.bot._thinkEquipment = () => {};
  }
}

// What MatchTelemetry reads of a GameView, without the cost of building a whole one every tick.
function lightView(sim, localId) {
  return {
    t: sim.time, phase: sim.phase, mode: sim.mode, mapId: sim.map.id, localId,
    players: sim.players.map(p => ({ id: p.id, isBot: p.isBot, team: p.team, alive: p.alive, weapon: p.ps.weapon, adsT: p.ps.adsT, x: p.ps.x, z: p.ps.z })),
  };
}

// One mirrored match. guns/skills: six each. `human`: {slot, thumb} puts the human-like thumb in that slot of team 0;
// the same slot of team 1 is its control, a plain bot with the same gun. Returns telemetry rows by scope.
function runMatch({ mapId, mode, seed, guns, skills, seconds = SECONDS, human = null }) {
  const roster = [];
  for (let team = 0; team < 2; team++) for (let i = 0; i < guns.length; i++) {
    const loadout = loadoutFor(guns[i], skills[i], i);
    roster.push({ id: `t${team}s${i}`, name: `${guns[i]}${team}`, team, isBot: true, skill: skills[i], primary: guns[i], camo: 'none', loadout });
  }
  const sim = new Sim({ roster, map: MAPS[mapId], seed, mode, scoreLimit: 1e9, timeLimit: seconds });
  sim.step(STEP);
  quiet(sim);
  const humanId = human ? `t0s${human.slot}` : null, controlId = human ? `t1s${human.slot}` : null;
  if (human) { makeHumanLike(sim, humanId, human.thumb); quiet(sim); }
  const tel = new MatchTelemetry({ localId: humanId });
  const ctl = human ? new MatchTelemetry({ localId: controlId }) : null;
  tel.mapId = mapId; if (ctl) ctl.mapId = mapId;
  const end = Math.round((3.2 + seconds) * SIM_HZ) + 5;
  let view = null;
  for (let tick = 0; tick < end && sim.phase !== 'ended'; tick++) {
    sim.step(STEP);
    const ev = sim.drainEvents();
    // The view is only needed when something happened, and often enough for held time (telemetry caps a gap at 0.5 s).
    if (ev.length || tick % 3 === 0) {
      view = lightView(sim, humanId);
      tel.onEvents(ev, view);
      if (ctl) ctl.onEvents(ev, view);
    }
  }
  view = lightView(sim, humanId);
  const rec = tel.finish(view);
  const out = { a: rec ? rec.g.a : {}, live: rec ? rec.live : 0 };
  if (human) { out.m = rec ? rec.g.m : {}; out.c = ctl.finish(view)?.g.m ?? {}; }
  return out;
}

function skillsFor(shift) {
  return Array.from({ length: 6 }, (_, i) => (SKILL === 'mixed' ? MIXED[(i + shift) % MIXED.length] : SKILL));
}

// The sets of six for one round. Unfocused: every gun once (the list padded round to a multiple of six with guns
// from its own start). Focused: the focus guns, at most four a match, with the rest of the field rotating as filler.
function setsFor(round, rng) {
  const sets = [];
  if (!FOCUS) {
    const perm = shuffled(POOL, rng);
    while (perm.length % 6) perm.push(perm[perm.length % 6]);
    for (let i = 0; i < perm.length; i += 6) sets.push(perm.slice(i, i + 6));
    return sets;
  }
  const filler = shuffled(POOL.filter(id => !FOCUS.includes(id)), rng);
  let f = 0;
  const focus = shuffled(FOCUS, rng);
  for (let i = 0; i < focus.length; i += 4) {
    const set = focus.slice(i, i + 4);
    while (set.length < 6) set.push(filler.length ? filler[f++ % filler.length] : focus[(i + set.length) % focus.length]);
    sets.push(shuffled(set, rng));
  }
  return sets;
}

function runMatches() {
  const agg = newAgg(), bySize = {};
  const rng = mulberry32(hash('sets', SEED));
  const t0 = performance.now();
  let n = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const sets = setsFor(r, rng);
    sets.forEach((guns, gi) => {
      for (const mapId of mapsFor(r)) for (const mode of MODE_LIST) {
        const res = runMatch({ mapId, mode, seed: hash('m', SEED, r, gi, mapId, mode), guns, skills: skillsFor(r + gi) });
        foldRows(agg.g.a, res.a);
        const size = sizeOf(MAPS[mapId]);
        foldRows((bySize[size] ||= {}), res.a);
        agg.matches++; agg.live += res.live; agg.pm.a += 12; n++;
      }
    });
  }
  return { agg, bySize, n, ms: performance.now() - t0 };
}

// ---- Duels ------------------------------------------------------------------------------------------------------

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

function duelSim(gunA, gunB, skillA, skillB, seed, humanA = null) {
  const roster = [
    { id: 'A', name: 'A', team: 0, isBot: true, skill: skillA, primary: gunA, camo: 'none', loadout: loadoutFor(gunA, skillA, 0) },
    { id: 'B', name: 'B', team: 1, isBot: true, skill: skillB, primary: gunB, camo: 'none', loadout: loadoutFor(gunB, skillB, 1) },
  ];
  const sim = new Sim({ roster, map: ARENA, seed, mode: 'tdm', scoreLimit: 1e9, timeLimit: 1e9 });
  while (sim.phase !== 'live') sim.step(STEP);
  sim.step(STEP);
  if (humanA) makeHumanLike(sim, 'A', humanA);
  quiet(sim);
  for (const p of sim.players) { p.bot._thinkTurrets = () => {}; }
  return sim;
}

// One duel in an existing sim. scenario: 'aware' | 'flankA' (A behind B) | 'flankB'. Returns 1 if A won, 0 if B, 0.5.
function duel(sim, d, scenario) {
  const [a, b] = sim.players;
  const z = 13 + (sim.rng() - 0.5) * 6, zb = 13 + (sim.rng() - 0.5) * 6;
  let ax, bx, aimA, aimB;
  if (scenario === 'aware') { ax = 62 - d / 2; bx = 62 + d / 2; aimA = 0; aimB = Math.PI; }
  // The flanked side is where its lane walk carries it away from the flanker, facing away.
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

function runDuels() {
  const guns = FOCUS || POOL, field = POOL;
  const skill = SKILL === 'mixed' ? 'regular' : SKILL;
  const res = {};
  const cell = () => ({ w: 0, n: 0 });
  for (const g of field) res[g] = { aware: DISTS.map(cell), flank: DISTS.map(cell), flanked: DISTS.map(cell) };
  const t0 = performance.now();
  let n = 0;
  const done = new Set();
  for (const A of guns) for (const B of field) {
    if (A === B || done.has(`${B}|${A}`)) continue;
    done.add(`${A}|${B}`);
    const sim = duelSim(A, B, skill, skill, hash('d', SEED, A, B));
    DISTS.forEach((d, di) => {
      for (let t = 0; t < TRIALS; t++) {
        const r = duel(sim, d, 'aware'); n++;
        res[A].aware[di].w += r; res[A].aware[di].n++;
        res[B].aware[di].w += 1 - r; res[B].aware[di].n++;
      }
      for (let t = 0; t < Math.max(1, Math.ceil(TRIALS / 2)); t++) {
        const ra = duel(sim, d, 'flankA'), rb = duel(sim, d, 'flankB'); n += 2;
        res[A].flank[di].w += ra; res[A].flank[di].n++;
        res[B].flanked[di].w += 1 - ra; res[B].flanked[di].n++;
        res[B].flank[di].w += 1 - rb; res[B].flank[di].n++;
        res[A].flanked[di].w += rb; res[A].flanked[di].n++;
      }
    });
  }
  return { res, n, ms: performance.now() - t0 };
}

// ---- Human-like thumb -------------------------------------------------------------------------------------------

function thumbFromArgs() {
  const t = { ...THUMB, assist: Number(opt('assist', THUMB.assist)) };
  const o = opt('thumb', null);
  if (o) for (const kv of o.split(',')) { const [k, v] = kv.split(':'); t[k] = Number(v); }
  return t;
}

const HUMAN_GUNS = ['pdw', 'ar', 'smg', 'lightlmg', 'burst', 'battle'];
function runHuman() {
  const thumb = thumbFromArgs();
  const guns = FOCUS || HUMAN_GUNS;
  const out = { duels: {}, match: {}, control: {} };
  const dists = [4, 10, 20, 30];
  const N = Math.max(8, TRIALS * 8);
  for (const g of guns) {
    out.duels[g] = {};
    for (const skill of ['recruit', 'regular', 'veteran']) {
      const sim = duelSim(g, g, 'regular', skill, hash('h', SEED, g, skill), thumb);
      out.duels[g][skill] = dists.map(d => { let w = 0; for (let t = 0; t < N; t++) w += duel(sim, d, 'aware'); return w / N; });
    }
  }
  // Matches: the thumb in one slot of team 0 with the gun under test, a regular bot with the same gun opposite.
  const rng = mulberry32(hash('hm', SEED));
  // Mixed is the lobby default the owner plays: js/sim/sim.js MIXED_SKILLS, with the thumb's slot and its mirror regular.
  const skills = SKILL === 'mixed' ? ['regular', 'veteran', 'veteran', 'regular', 'elite', 'recruit'] : Array(6).fill(SKILL);
  const hAgg = {}, cAgg = {};
  for (const g of guns) for (let r = 0; r < Math.max(1, ROUNDS - 1); r++) {
    const filler = shuffled(POOL.filter(id => id !== g), rng).slice(0, 5);
    for (const mapId of mapsFor(r)) {
      const res = runMatch({ mapId, mode: 'tdm', seed: hash('hm', SEED, g, r, mapId), guns: [g, ...filler], skills, human: { slot: 0, thumb } });
      foldRows(hAgg, { [g]: res.m[g] || [] });
      foldRows(cAgg, { [g]: res.c[g] || [] });
    }
  }
  out.match = hAgg; out.control = cAgg;
  return out;
}

// ---- Realistic lobbies -----------------------------------------------------------------------------------------

// Two of every class that has primaries: what the thumb carries when no --gun/--class is given.
function defaultThumbGuns() {
  const out = [];
  for (const c of CATEGORIES) out.push(...POOL.filter(id => WEAPONS[id].category === c).slice(0, 2));
  return out;
}

// js/ui/vote.js resolvePick(RANDOM, RANDOM), without the UI module: a map by size-tier weight, then a mode it hosts.
const QUICK_MODES = MODE_IDS.filter(m => MODES[m].rules !== 'gun');
function quickPick(rng) {
  const maps = MAP_IDS.filter(id => QUICK_MODES.some(m => modeFitsMap(MAPS[id], m)));
  const per = {};
  for (const id of maps) per[sizeOf(MAPS[id])] = (per[sizeOf(MAPS[id])] ?? 0) + 1;
  const w = maps.map(id => SIZES[sizeOf(MAPS[id])].weight / per[sizeOf(MAPS[id])]);
  let x = rng() * w.reduce((a, b) => a + b, 0), mapId = maps[maps.length - 1];
  for (let i = 0; i < maps.length; i++) if ((x -= w[i]) < 0) { mapId = maps[i]; break; }
  const modes = QUICK_MODES.filter(m => modeFitsMap(MAPS[mapId], m));
  return { mapId, mode: modes[Math.floor(rng() * modes.length)] };
}

function runRealistic() {
  const thumb = thumbFromArgs();
  const thumbGuns = FOCUS || defaultThumbGuns();
  const bots = {}, thumbRows = {}, perThumbGun = {};
  // How bots holding each gun die, from the kill events: by a streak or thrown kit, or by gunfire inside 10 m.
  const how = {};
  const t0 = performance.now();
  let n = 0;
  const lobbies = [];
  for (let r = 0; r < ROUNDS; r++) {
    if (QUICK) {
      // The same draw for every thumb gun in a round, so guns are compared on the same lobbies.
      const rng = mulberry32(hash('quick', SEED, r));
      for (let k = 0; k < 6; k++) lobbies.push({ r, ...quickPick(rng) });
    } else for (const mapId of mapsFor(r)) for (const mode of MODE_LIST) lobbies.push({ r, mapId, mode });
  }
  for (const g of thumbGuns) for (const { r, mapId, mode } of lobbies) {
    const seed = hash('real', SEED, r, g, mapId, mode);
    const human = { id: 'me', name: 'thumb', team: 0, loadout: { primary: g, secondary: 'pistol' } };
    const roster = buildRoster([human], { botSkill: 'mixed', mapId, mode, seed });
    // The thumb rides a BotBrain for everything but its right thumb, so the sim has to make it one.
    const me = roster.find(e => e.id === 'me');
    me.isBot = true; me.skill = 'regular';
    // The mode's own limits; the loop below stops at SECONDS (an S&D round timer is the mode's business).
    const sim = new Sim({ roster, map: MAPS[mapId], seed, mode });
    sim.step(STEP);
    makeHumanLike(sim, 'me', thumb);
    quiet(sim);
    const tel = new MatchTelemetry({ localId: 'me' });
    tel.mapId = mapId;
    const end = Math.round((3.2 + SECONDS) * SIM_HZ) + 5;
    for (let tick = 0; tick < end && sim.phase !== 'ended'; tick++) {
      sim.step(STEP);
      const ev = sim.drainEvents();
      if (ev.length || tick % 3 === 0) tel.onEvents(ev, lightView(sim, 'me'));
      for (const e of ev) {
        if (e.t !== 'kill' || e.target === 'me' || !e.vw || e.by === e.target) continue;
        const h = how[e.vw] ||= { n: 0, kit: 0, close: 0 };
        h.n++;
        if (e.streak || e.equip) h.kit++;
        else if (e.dist < 10) h.close++;
      }
    }
    const rec = tel.finish(lightView(sim, 'me'));
    n++;
    if (!rec) continue;
    // Bots only: everyone minus the thumb.
    const mine = rec.g.m;
    const others = {};
    for (const gun in rec.g.a) others[gun] = rec.g.a[gun].map((v, i) => v - (mine[gun]?.[i] || 0));
    foldRows(bots, others);
    foldRows(thumbRows, { [g]: mine[g] || [] });
    foldRows((perThumbGun[g] ||= {}), others);
  }
  return { bots, thumbRows, perThumbGun, thumbGuns, how, n, ms: performance.now() - t0 };
}

function reportRealistic(res) {
  const ids = sortGuns(POOL);
  const rowsOf = rows => Object.fromEntries(gunRows({ g: { x: rows }, pm: { x: 1 } }, 'x', ids).map(r => [r.id, r]));
  const bots = rowsOf(res.bots);
  console.log(`\nREALISTIC  ${res.n} lobbies of up to ${SECONDS} s (${QUICK ? 'Quick Play draw' : `${MAP_LIST.map(m => m.join('+')).join(', ')} x ${MODE_LIST.join(', ')}`}), Mixed bots, streaks + equipment, one thumb, seed ${SEED}, ${(res.ms / 1000).toFixed(0)} s`);
  console.log(`${pad('class', 9)}${pad('gun', 11)}${pad('name', 12)} bot K/D  kills deaths  k/min  ads% cone% onAcc   hs%  died to: kit% <10m%`);
  const json = { seed: SEED, realistic: true, guns: {}, thumb: {} };
  for (const id of ids) {
    const r = bots[id];
    if (!r.kills && !r.deaths) continue;
    console.log(`${pad(WEAPONS[id].category, 9)}${pad(id, 11)}${pad(WEAPONS[id].name, 12)}${num(r.kd, 2, 8)} ${String(r.kills).padStart(6)} ${String(r.deaths).padStart(6)} ${num(r.kpm)} ${pct(r.adsShare)} ${pct(r.coneShare)} ${num(r.coneAcc)} ${pct(r.head)}          ${pct(res.how[id] ? res.how[id].kit / res.how[id].n : null)} ${pct(res.how[id] ? res.how[id].close / res.how[id].n : null)}`);
    json.guns[id] = { kd: r.kd, kills: r.kills, deaths: r.deaths, how: res.how[id] };
  }
  const prim = ids.filter(id => bots[id].deaths >= 20 && PRIMARY_IDS.includes(id));
  const out = prim.filter(id => bots[id].kd < 0.8 || bots[id].kd > 1.25);
  console.log(`bot K/D range ${Math.min(...prim.map(id => bots[id].kd)).toFixed(2)} to ${Math.max(...prim.map(id => bots[id].kd)).toFixed(2)}; primaries outside 0.80-1.25: ${out.length ? out.map(id => `${WEAPONS[id].name} ${bots[id].kd.toFixed(2)}`).join(', ') : 'none'}`);
  const thumb = rowsOf(res.thumbRows);
  console.log(`\nTHUMB in those lobbies (bots' all-gun K/D in the same lobbies for reference)`);
  console.log(`${pad('class', 9)}${pad('gun', 11)}${pad('name', 12)}   K/D  kills deaths  k/min   acc  ads% cone% onAcc   hs%  lobby`);
  let hk = 0, hd = 0;
  for (const id of sortGuns(res.thumbGuns)) {
    const r = thumb[id];
    const lob = Object.values(res.perThumbGun[id] || {}).reduce((a, row) => [a[0] + row[F.kills], a[1] + row[F.deaths]], [0, 0]);
    console.log(`${pad(WEAPONS[id].category, 9)}${pad(id, 11)}${pad(WEAPONS[id].name, 12)}${num(r.kd)} ${String(r.kills).padStart(6)} ${String(r.deaths).padStart(6)} ${num(r.kpm)} ${num(r.acc)} ${pct(r.adsShare)} ${pct(r.coneShare)} ${num(r.coneAcc)} ${pct(r.head)} ${num(lob[0] / Math.max(1, lob[1]))}`);
    json.thumb[id] = { kd: r.kd, kills: r.kills, deaths: r.deaths, adsShare: r.adsShare, coneAcc: r.coneAcc };
    hk += r.kills; hd += r.deaths;
  }
  console.log(`thumb all guns: K/D ${(hk / Math.max(1, hd)).toFixed(2)}`);
  return json;
}

// ---- Report -----------------------------------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 2, w = 6) => (v === null || v === undefined || Number.isNaN(v) ? '-' : v.toFixed(n)).padStart(w);
const pct = (v, w = 5) => (v === null || v === undefined || Number.isNaN(v) ? '-' : Math.round(v * 100) + '').padStart(w);
const kd = r => (r && r[F.deaths] ? r[F.kills] / r[F.deaths] : null);

function sortGuns(ids) {
  return ids.slice().sort((a, b) => CATEGORIES.indexOf(WEAPONS[a].category) - CATEGORIES.indexOf(WEAPONS[b].category) || POOL.indexOf(a) - POOL.indexOf(b));
}

function report(matches, duels, before) {
  const ids = sortGuns(FOCUS || POOL);
  const json = { seed: SEED, guns: {} };
  if (matches) {
    const rows = Object.fromEntries(gunRows(matches.agg, 'a', POOL).map(r => [r.id, r]));
    console.log(`\nMATCHES  ${matches.n} mirrored matches of ${SECONDS} s (${MAP_LIST.map(m => m.join('+')).join(', ')} x ${MODE_LIST.join(', ')}), skill ${SKILL}, seed ${SEED}, ${(matches.ms / 1000).toFixed(0)} s`);
    console.log(`${pad('class', 9)}${pad('gun', 11)}${pad('name', 12)}   K/D${before ? '  (was)' : ''}  small   med  large  k/min   ttk   acc  ads% cone% onAcc  kills   damage share by range ${DIST_LABELS.join(' ')}`);
    for (const id of ids) {
      const r = rows[id], raw = r.raw;
      const total = DIST_LABELS.reduce((s, _, i) => s + raw[F.dmg0 + i], 0);
      const share = DIST_LABELS.map((_, i) => (total ? pct(raw[F.dmg0 + i] / total, 4) : '   -')).join(' ');
      const sz = ['small', 'medium', 'large'].map(s => num(kd(matches.bySize[s]?.[id]), 2, 6)).join(' ');
      const was = before?.guns?.[id]?.kd;
      console.log(`${pad(WEAPONS[id].category, 9)}${pad(id, 11)}${pad(WEAPONS[id].name, 12)}${num(r.kd)}${before ? num(was, 2, 7) : ''} ${sz} ${num(r.kpm)} ${num(r.ttk)} ${num(r.acc)} ${pct(r.adsShare)} ${pct(r.coneShare)} ${num(r.coneAcc)} ${String(r.kills).padStart(6)}   ${share}`);
      json.guns[id] = { kd: r.kd, kpm: r.kpm, ttk: r.ttk, acc: r.acc, kills: r.kills, deaths: r.deaths, adsShare: r.adsShare, coneShare: r.coneShare, coneAcc: r.coneAcc,
        bySize: Object.fromEntries(['small', 'medium', 'large'].map(s => [s, kd(matches.bySize[s]?.[id])])),
        dmgShare: DIST_LABELS.map((_, i) => (total ? raw[F.dmg0 + i] / total : null)) };
    }
    const kds = ids.map(id => rows[id].kd).filter(v => v !== null);
    const out = ids.filter(id => rows[id].kd !== null && (rows[id].kd < 0.85 || rows[id].kd > 1.2));
    console.log(`K/D range ${Math.min(...kds).toFixed(2)} to ${Math.max(...kds).toFixed(2)}; outside 0.85-1.20: ${out.length ? out.map(id => `${WEAPONS[id].name} ${rows[id].kd.toFixed(2)}`).join(', ') : 'none'}`);
  }
  if (duels) {
    console.log(`\nDUELS  ${duels.n} duels, ${SKILL === 'mixed' ? 'regular' : SKILL} v same, win % against the field (50 is par), ${(duels.ms / 1000).toFixed(0)} s`);
    console.log(`${pad('class', 9)}${pad('gun', 11)}${pad('name', 12)} aware ${DISTS.map(d => (d + 'm').padStart(5)).join('')}   flank ${DISTS.map(d => (d + 'm').padStart(5)).join('')}  flanked ${DISTS.map(d => (d + 'm').padStart(5)).join('')}`);
    const rate = c => (c.n ? c.w / c.n : null);
    for (const id of ids) {
      const r = duels.res[id];
      console.log(`${pad(WEAPONS[id].category, 9)}${pad(id, 11)}${pad(WEAPONS[id].name, 12)}       ${r.aware.map(c => pct(rate(c))).join('')}         ${r.flank.map(c => pct(rate(c))).join('')}          ${r.flanked.map(c => pct(rate(c))).join('')}`);
      (json.guns[id] ||= {}).duel = { aware: r.aware.map(rate), flank: r.flank.map(rate), flanked: r.flanked.map(rate) };
    }
    // Which class owns each distance: mean aware win rate of the class's guns.
    const cats = [...new Set(ids.map(id => WEAPONS[id].category))];
    console.log(`\nCLASS BANDS (mean aware win %)   ${DISTS.map(d => (d + 'm').padStart(5)).join('')}`);
    for (const c of cats) {
      const list = ids.filter(id => WEAPONS[id].category === c);
      const means = DISTS.map((_, i) => list.reduce((s, id) => s + (rate(duels.res[id].aware[i]) ?? 0.5), 0) / list.length);
      console.log(`${pad(c, 33)}${means.map(v => pct(v)).join('')}`);
    }
  }
  return json;
}

function reportHuman(h) {
  console.log(`\nHUMAN-LIKE THUMB v BOTS, same gun. Duel win % for the thumb (aware, 50 is par) at 4/10/20/30 m`);
  console.log(`${pad('gun', 11)}${pad('name', 11)} v recruit           v regular           v veteran`);
  for (const g in h.duels) {
    console.log(`${pad(g, 11)}${pad(WEAPONS[g].name, 11)} ${['recruit', 'regular', 'veteran'].map(s => h.duels[g][s].map(v => pct(v, 4)).join('') + '    ').join('')}`);
  }
  const mean = s => { let w = 0, n = 0; for (const g in h.duels) for (const v of h.duels[g][s]) { w += v; n++; } return w / n; };
  console.log(`mean: v recruit ${pct(mean('recruit'), 0)}%, v regular ${pct(mean('regular'), 0)}%, v veteran ${pct(mean('veteran'), 0)}%`);
  console.log(`\nIn 6 v 6 matches (thumb in one slot; "bot" is the regular bot holding the same gun in the mirror slot)`);
  console.log(`${pad('gun', 11)}${pad('who', 7)}   K/D  k/min   acc  ads% cone% onAcc  kills deaths  shots`);
  const line = (g, who, r) => {
    const row = gunRows({ g: { x: { [g]: r } }, pm: { x: 1 } }, 'x', [g])[0];
    console.log(`${pad(g, 11)}${pad(who, 7)}${num(row.kd)} ${num(row.kpm)} ${num(row.acc)} ${pct(row.adsShare)} ${pct(row.coneShare)} ${num(row.coneAcc)} ${String(row.kills).padStart(6)} ${String(row.deaths).padStart(6)} ${String(row.shots).padStart(6)}`);
    return row;
  };
  let hk = 0, hd = 0, ck = 0, cd = 0;
  for (const g in h.match) {
    const a = line(g, 'thumb', h.match[g]), b = line(g, 'bot', h.control[g] || []);
    hk += a.kills; hd += a.deaths; ck += b.kills; cd += b.deaths;
  }
  console.log(`all guns: thumb K/D ${(hk / Math.max(1, hd)).toFixed(2)}, mirror bot K/D ${(ck / Math.max(1, cd)).toFixed(2)}`);
}

// ---- Run --------------------------------------------------------------------------------------------------------

let before = null;
if (opt('compare', null)) { try { before = JSON.parse(readFileSync(opt('compare'), 'utf8')); } catch { console.error('cannot read --compare file'); } }

if (REALISTIC) {
  const json = reportRealistic(runRealistic());
  if (opt('json', null)) writeFileSync(opt('json'), JSON.stringify(json, null, 1));
} else if (has('human')) {
  reportHuman(runHuman());
} else {
  const matches = has('no-matches') ? null : runMatches();
  const duels = has('no-duels') ? null : runDuels();
  const json = report(matches, duels, before);
  if (opt('json', null)) writeFileSync(opt('json'), JSON.stringify(json, null, 1));
}
