// Node tests for the V10 arsenal (js/shared/weapons-v10.js): sixteen guns, eight attachments, three small mechanics.
// Every gun fires, reloads, kills and shows its own mechanic; bots carrying each one get kills in a 60 s match; a
// pre-V10 save code loads; mastery moves. Run: node dev/sim-arsenal.mjs   (add `quick` to skip the bot matches)
// Exits non-zero on the first failed check, printing what failed.
import assert from 'node:assert/strict';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { createPlayerState, stepPlayer, currentSpread, weaponDef, MOVE } from '../js/sim/player.js';
import { WEAPONS, shotsToKill } from '../js/shared/weapons.js';
import { V10_WEAPONS, V10_GUNS, V10_LIKE, V10_UNLOCKS } from '../js/shared/weapons-v10.js';
import { W3_WEAPONS, W3_GUNS, W3_LIKE, W3_UNLOCKS } from '../js/shared/weapons-w3.js';
import { W4_WEAPONS, W4_GUNS, W4_LIKE, W4_UNLOCKS } from '../js/shared/weapons-w4.js';
import { W5_WEAPONS, W5_GUNS, W5_LIKE, W5_UNLOCKS } from '../js/shared/weapons-w5.js';
import { FINISHERS, weaponFinisher, OPERATOR_FINISHERS } from '../js/shared/finishers.js';
import { SIM_HZ, WEAPON_IDS, PRIMARY_IDS, SECONDARY_IDS, CATEGORIES, WEAPON_CATEGORY } from '../js/shared/constants.js';
import { ATTACHMENTS, MOD_INFO, SLOTS, availableFor, isAvailable, modsFor, normalizeKit, packKit, unpackKit, trackFor, applyAttachments } from '../js/shared/attachments.js';
import { GUN_LADDER } from '../js/shared/modes.js';
import { raycastMap } from '../js/shared/geometry.js';
import { MAPS } from '../js/shared/map.js';
import { MasteryTracker, applyMasteryGains, blankSave, blankWeapon, sanitizeSave, migrateSave, encodeSave, decodeSave, itemOpen, itemUnlockLevel,
  UNLOCK_SCHEDULE, challengesFor, ladderStatus, levelOf, PLAYER_CURVE, MAX_LEVEL, GOLDEN_REQ_WEAPONS, cleanLoadout } from '../js/shared/progression.js';
import { hasIcon } from '../js/ui/icons.js';
import { statBars, weaponFacts, compareStats } from '../js/ui/gunstats.js';

const STEP = 1 / SIM_HZ, DT = 1 / 60;
const NEW = Object.keys(V10_WEAPONS);
const W3 = Object.keys(W3_WEAPONS);                    // Weapons wave 3 (weapons-w3.js), after the V10 guns.
const W4 = Object.keys(W4_WEAPONS);                    // Weapons wave 4's melee (weapons-w4.js), after wave 3.
const W5 = Object.keys(W5_WEAPONS);                    // Weapons wave 5 (weapons-w5.js), after wave 4.
const NEW_ATTACHMENTS = ['steady', 'ghostring', 'breacher', 'floated', 'satchel', 'tapedmag', 'bipod', 'handstop'];
const OLD_IDS = ['ar', 'burst', 'heavyar', 'smg', 'pdw', 'tacsmg', 'shotgun', 'autoshot', 'coach', 'lmg', 'saw', 'rotary', 'dmr', 'battle', 'lever',
  'sniper', 'antimat', 'semisnipe', 'pistol', 'revolver', 'machpistol', 'deuce', 'launcher', 'thumper', 'golden',
  'carbine', 'heavysmg', 'slug', 'lightlmg', 'crossbow', 'scatter'];
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}

/* ---------------- Harness ---------------- */
const MAP = MAPS.railyard;
const mid = () => 0.5;                                   // An rng that puts every round on the centre of its cone.
const inWall = (map, x, z, pad = 1) => map.walls.some(w => x > w.x - pad && x < w.x + w.w + pad && z > w.z - pad && z < w.z + w.d + pad);
function openLane(map, len) {
  for (let z = 4; z < map.height - 4; z += 1) {
    for (let x = 4; x < map.width - len - 4; x += 1) {
      if ([-1.5, 0, 1.5].some(dz => inWall(map, x, z + dz) || inWall(map, x + len, z + dz))) continue;
      if ([-1.5, 0, 1.5].some(dz => raycastMap(map, x, z + dz, 1, 0, len, 'blocksBullet'))) continue;
      return { x, z };
    }
  }
  throw new Error('no open lane');
}
const LANE = openLane(MAP, 24);
const IDLE = { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, reload: false, swap: false, streak: false };

// A lone player state with `id` in hand (in its real slot), standing at the head of the open lane, facing down it.
function shooter(id, kit) {
  const secondary = SECONDARY_IDS.includes(id);
  const loadout = secondary ? { primary: 'ar', secondary: id, attachments: kit ? { [id]: kit } : {} } : { primary: id, attachments: kit ? { [id]: kit } : {} };
  const ps = createPlayerState({ id: 'p', primary: loadout.primary, loadout });
  ps.x = LANE.x; ps.z = LANE.z; ps.aim = 0;
  if (secondary) { stepPlayer(ps, { ...IDLE, swap: true }, DT, MAP, mid); run(ps, 1.2); }
  assert.equal(ps.weapon, id, `${id} in hand`);
  return ps;
}
// Steps `seconds` of input, returning every shot with the time it left.
function run(ps, seconds, input = {}, rng = mid) {
  const out = [], inp = { ...IDLE, ...input };
  for (let t = 0; t < seconds - 1e-9; t += DT) for (const s of stepPlayer(ps, inp, DT, MAP, rng)) out.push({ ...s, t });
  return out;
}
const AIM_FIRE = { aiming: true, fire: true }, AIM = { aiming: true };
const aimedIn = (ps, id) => { run(ps, WEAPONS[id].adsTime * 1.6 + 0.3, AIM); return ps; };

// A live match with brainless bots; h1 carries `id` as primary, so the test drives it and the host scores it.
function duel(id, dist) {
  const HUMAN = { id: 'h1', name: 'Human', team: 0, primary: id, camo: 'none', loadout: { primary: id } };
  const roster = buildRoster([HUMAN], { botSkill: 'regular', teamSize: 2, mapId: 'railyard', mode: 'tdm', seed: 7 });
  const sim = new Sim({ roster, map: 'railyard', seed: 7, mode: 'tdm' });
  sim.step(0);
  for (const p of sim.players) p.bot = null;
  sim._setPhase('live');
  const h = sim.byId.get('h1'), foe = sim.players.find(p => p.team !== h.team);
  for (const p of sim.players) {
    p.spawnProtect = 0;
    if (p !== h && p !== foe) { p.alive = false; p.respawnT = 999; p.wantRespawn = false; }
    p.ps.perks = ['marathon', 'scavenger', 'tracker'];
  }
  h.ps.x = LANE.x; h.ps.z = LANE.z; h.ps.aim = 0;
  foe.ps.x = LANE.x + dist; foe.ps.z = LANE.z; foe.ps.aim = Math.PI;
  sim.drainEvents();
  return { sim, h, foe };
}
// Holds the sights on the foe and the trigger down until it dies or `limit` seconds pass. Returns seconds, or -1.
function killTime(id, dist, limit = 8) {
  const { sim, h, foe } = duel(id, dist);
  assert.equal(h.ps.weapon, id);
  const inp = { ...IDLE, aim: 0, aiming: true };
  for (let t = 0; t < WEAPONS[id].adsTime * 1.6 + 0.3; t += STEP) { stepPlayer(h.ps, inp, STEP, sim.map, mid); sim.step(STEP); }
  inp.fire = true;
  for (let t = 0; t < limit; t += STEP) {
    for (const s of stepPlayer(h.ps, inp, STEP, sim.map, mid)) sim.applyShot('h1', s, 0);
    sim.step(STEP);
    if (sim.drainEvents().some(e => e.t === 'kill' && e.by === 'h1' && e.target === foe.id && e.weapon === id)) return t;
  }
  return -1;
}

/* ---------------- Data, wire, catalog ---------------- */

test('sixteen new guns, every class gains at least one, and a Melee class', () => {
  assert.equal(NEW.length, 16);
  assert.deepEqual(Object.values(V10_GUNS).flat().sort(), [...NEW].sort());
  for (const cat of ['Assault', 'SMG', 'Shotgun', 'LMG', 'Marksman', 'Sniper', 'Pistol', 'Launcher', 'Melee']) {
    assert.ok(CATEGORIES.includes(cat));
    assert.ok(NEW.some(id => WEAPON_CATEGORY[id] === cat), `${cat} gains a gun`);
  }
  const names = WEAPON_IDS.map(id => WEAPONS[id].name);
  assert.equal(new Set(names).size, names.length, 'no two guns share a name');
  for (const id of NEW) {
    const w = WEAPONS[id];
    assert.equal(w.id, id); assert.equal(w.category, WEAPON_CATEGORY[id]);
    assert.ok(w.name && w.role && w.botUse && w.botUse.pref > 0, `${id} name, role, bot hint`);
    assert.ok(w.headMult >= 1 && Number.isFinite(w.headMult), `${id} head multiplier derived`);
    assert.ok(w.longshot > 0);
    for (const k of ['damage', 'rpm', 'magazine', 'reload', 'range', 'adsSpread', 'hipSpread', 'adsTime', 'sprintToFire', 'swapTime', 'moveMult', 'adsMoveMult', 'kickCam', 'tracerWidth'])
      assert.ok(Number.isFinite(w[k]) && w[k] > 0, `${id}.${k}`);
    assert.ok(w.falloff && w.falloff.start < w.falloff.end && w.falloff.min > 0 && w.falloff.min <= 1);
    for (const key of ['sound', 'fx', 'reload', 'hold', 'force']) assert.ok(OLD_IDS.includes(V10_LIKE[id][key]), `${id} borrows a real ${key}`);
  }
});

test('older ids keep their wire index; the new ones are appended, primaries then secondaries', () => {
  assert.deepEqual(WEAPON_IDS.slice(0, OLD_IDS.length), OLD_IDS);
  assert.deepEqual([...WEAPON_IDS.slice(OLD_IDS.length, OLD_IDS.length + NEW.length)].sort(), [...NEW].sort());
  const w3 = WEAPON_IDS.slice(OLD_IDS.length + NEW.length, OLD_IDS.length + NEW.length + W3.length);
  assert.deepEqual([...w3].sort(), [...W3].sort(), 'wave 3 after the V10 guns');
  assert.deepEqual(WEAPON_IDS.slice(OLD_IDS.length + NEW.length + W3.length, OLD_IDS.length + NEW.length + W3.length + W4.length), W4, 'then wave 4\'s melee, in order');
  assert.deepEqual(WEAPON_IDS.slice(OLD_IDS.length + NEW.length + W3.length + W4.length), W5, 'then wave 5, primaries then secondaries, and nothing else');
  assert.deepEqual(w3.map(id => SECONDARY_IDS.includes(id)), [...w3].map(id => SECONDARY_IDS.includes(id)).sort(), 'wave 3: primaries, then secondaries');
  for (const id of W3) assert.equal(PRIMARY_IDS.includes(id) + SECONDARY_IDS.includes(id), 1, `${id} is in exactly one slot list`);
  assert.equal(new Set(WEAPON_IDS).size, WEAPON_IDS.length);
  for (const id of NEW) assert.equal(PRIMARY_IDS.includes(id) + SECONDARY_IDS.includes(id), 1, `${id} is in exactly one slot list`);
  for (const id of ['akimbo', 'nailer', 'salvo', 'knife', 'maul']) assert.ok(SECONDARY_IDS.includes(id));
  assert.ok(GOLDEN_REQ_WEAPONS.includes('rail'), 'new guns join the Golden Gun requirement');
});

test('unlock levels are spread through the level curve, one gun per level', () => {
  const lv = NEW.map(id => itemUnlockLevel('weapon', id));
  assert.equal(V10_UNLOCKS.length, 16);
  for (const id of NEW) assert.ok(UNLOCK_SCHEDULE.some(u => u.kind === 'weapon' && u.id === id), `${id} has a schedule row`);
  assert.ok(Math.min(...lv) <= 5 && Math.max(...lv) >= 35 && Math.max(...lv) <= MAX_LEVEL);
  assert.equal(new Set(lv).size, 16, 'no two new guns on one level');
  assert.ok(lv.filter(l => l <= 20).length >= 6 && lv.filter(l => l > 20).length >= 6, 'not all at one end');
});

test('each has an icon, stat bars, facts, and joins the bot rotations and Gun Game', () => {
  for (const id of [...NEW, ...W3]) {
    assert.ok(hasIcon(id), `${id} icon`);
    assert.ok(statBars(id).length >= (WEAPONS[id].melee ? 5 : 11) && statBars(id).every(b => b.score >= 0 && b.score <= 1), `${id} stat bars`);
    assert.equal(weaponFacts(id).length, 6);
  }
  assert.ok(hasIcon('cat:Melee'));
  assert.ok(statBars('rail').some(b => b.id === 'charge') && statBars('heatar').some(b => b.id === 'heat'));
  const carried = new Set();
  for (const mapId of Object.keys(MAPS)) for (const mode of ['tdm', 'dom', 'kc']) for (const r of buildRoster([], { botSkill: 'regular', teamSize: 6, mapId, mode, seed: 3 })) { carried.add(r.loadout.primary); carried.add(r.loadout.secondary); }
  for (const id of [...NEW, ...W3].filter(i => i !== 'bat')) assert.ok(carried.has(id), `bots are dealt the ${id}`);
  assert.ok(!carried.has('bat'), 'the Slugger stays out of the bot rotations');
  assert.ok(['rampar', 'magshot', 'twinshot', 'akimbo'].every(id => GUN_LADDER.includes(id)));
  assert.equal(GUN_LADDER[GUN_LADDER.length - 1], 'revolver', 'the ladder still ends on the Verdict');
  assert.equal(new Set(GUN_LADDER).size, GUN_LADDER.length);
});

/* ---------------- Every gun: fires, reloads, kills ---------------- */

for (const id of [...NEW, ...W3]) {
  const w = WEAPONS[id];
  test(`${w.name} (${id}): fires at its cadence, reloads, and kills`, () => {
    const ps = shooter(id);
    const shots = run(ps, 3, { fire: true });
    assert.ok(shots.length >= 1 && shots.every(s => s.weapon === id && s.angles.length === (w.pellets || 1)), 'fires');
    if (!w.heat && !w.charge && !w.spinup && !w.melee && w.magazine * 60 / w.rpm > 3.2) {
      assert.ok(Math.abs(shots.length - 3 * w.rpm / 60) <= Math.max(2, 0.06 * 3 * w.rpm / 60), `${shots.length} rounds in 3 s at ${w.rpm} rpm`);
    }
    if (w.melee) {
      assert.equal(ps.ammo[ps.slot], w.magazine, 'a swing spends nothing');
      assert.equal(ps.reloadT, 0);
    } else {
      // Run it dry (in strings, so a heat gun cools), then let go: it reloads itself to a full magazine.
      for (let i = 0; i < 400 && ps.ammo[ps.slot] > 0; i++) { run(ps, 0.5, { fire: true }); run(ps, w.heat ? 2.5 : 0.02); }
      assert.equal(ps.ammo[ps.slot], 0, 'runs dry');
      run(ps, 60 / w.rpm + 0.1);                         // The last round's cycle has to finish first.
      assert.ok(ps.reloadT > 0, 'starts a reload when empty');
      run(ps, (w.shellReload ? w.reload * w.magazine : w.reload) + 0.6);
      assert.equal(ps.ammo[ps.slot], w.magazine, 'reload fills the magazine');
    }
    // The lane has waist-high cover at 7.5 m: a light round (no penetrate) is tested short of it.
    const dist = w.melee ? 1.8 : Math.min(w.botUse.pref, w.range * 0.6, 20, w.penetrate || w.explosive ? 99 : 7);
    const t = killTime(id, dist);
    assert.ok(t >= 0, `kills a standing target at ${dist} m`);
    const expect = (shotsToKill(w, dist) - 1) * 60 / w.rpm + (w.charge ? w.charge.time : 0);
    assert.ok(t <= expect * 1.6 + 1.2, `kill took ${t.toFixed(2)} s, the sheet says about ${expect.toFixed(2)} s`);
  });
}

/* ---------------- Each gun's own mechanic ---------------- */

test('Flywheel: starts at 55% of its rate and winds up to all of it', () => {
  const t = run(shooter('rampar'), 2.2, { fire: true }).map(s => s.t);
  const first = t[1] - t[0], late = t[t.length - 1] - t[t.length - 2];
  assert.ok(Math.abs(first - 60 / (900 * 0.55)) < 0.03, `first gap ${first.toFixed(3)}`);
  assert.ok(Math.abs(late - 60 / 900) < 0.02, `late gap ${late.toFixed(3)}`);
  assert.ok(t.length < 2.2 * 15 && t.length > 2.2 * 11);
});

test('Kiln: no bloom, a heat bar that locks it after 17 rounds, and it cools without a reload', () => {
  const ps = aimedIn(shooter('heatar'), 'heatar');
  const shots = run(ps, 3, AIM_FIRE);
  assert.equal(shots.length, 17);
  assert.ok(ps.overheated, 'locked');
  assert.equal(ps.reloadT, 0, 'no reload: the casket is still nearly full');
  const early = run(aimedIn(shooter('heatar'), 'heatar'), 0.8, AIM_FIRE);
  assert.ok(early.every(s => Math.abs(s.angles[0] - s.aim) < 0.012), 'a short string is straight');
  run(ps, 1.8 + 0.2);
  assert.ok(!ps.overheated && run(ps, 0.3, AIM_FIRE).length > 0, 'fires again after the lockout');
});

test('Murmur, Lapwing, Gaff, Maul: suppressed by nature, and cannot take a Hush Can', () => {
  for (const id of ['hushsmg', 'hushdmr', 'knife', 'maul']) {
    const ps = shooter(id);
    const shots = run(ps, 1, { fire: true });
    assert.ok(shots.length && shots.every(s => s.sup === 1), `${id} shots are flagged suppressed`);
    assert.equal(ps.firingT, 0, `${id} never lights the minimap`);
    assert.ok(!isAvailable(id, 'suppressor'));
  }
  const loud = shooter('drumsmg');
  assert.ok(run(loud, 0.5, { fire: true }).every(s => !s.sup) && loud.firingT > 0);
  assert.ok(isAvailable('drumsmg', 'suppressor'));
});

test('Hopper: 64 rounds without a reload, far more than any other SMG', () => {
  const ps = shooter('drumsmg');
  const n = run(ps, 63 * 60 / WEAPONS.drumsmg.rpm, { fire: true }).length;
  assert.ok(n >= 63 && n <= 64, `${n} rounds in one string`);
  assert.ok(ps.ammo[0] <= 1 && ps.reloadT === 0, 'still on the first drum');
  for (const id of ['smg', 'pdw', 'tacsmg', 'heavysmg', 'hushsmg']) assert.ok(WEAPONS[id].magazine * 1.75 <= 64);   // Skitter went to 36 in the V10 balance pass.
  assert.ok(!isAvailable('drumsmg', 'drummag') && isAvailable('drumsmg', 'extmag'));
});

test('Trammel: a fan of eight from a box magazine, one magazine change instead of shell by shell', () => {
  const ps = shooter('magshot');
  const shots = run(ps, WEAPONS.magshot.magazine * 60 / WEAPONS.magshot.rpm + 0.2, { fire: true });
  assert.equal(shots.length, WEAPONS.magshot.magazine);
  assert.ok(shots.every(s => s.angles.length === 8));
  run(ps, 0.1);
  assert.ok(Math.abs(ps.reloadDur - WEAPONS.magshot.reload) < 0.05 && !WEAPONS.magshot.shellReload);
  run(ps, 1.0);
  assert.equal(ps.ammo[0], 0, 'nothing chambered part way');
  assert.equal(shotsToKill(WEAPONS.magshot, 3), 1);
});

test('Thistle: five darts in a fan a third of buckshot width, two shells to kill at 20 m, through a crate', () => {
  const fan = (id) => { const s = run(aimedIn(shooter(id), id), 0.3, AIM_FIRE)[0].angles; return Math.max(...s) - Math.min(...s); };
  assert.equal(WEAPONS.flechette.pellets, 5);
  assert.ok(fan('flechette') < fan('shotgun') * 0.4, 'narrow');
  assert.equal(shotsToKill(WEAPONS.flechette, 20), 2);
  assert.ok(shotsToKill(WEAPONS.flechette, 2) === 2 && 20 > WEAPONS.shotgun.range, 'no one-shot up close; reaches where the Thresher cannot');
  assert.ok(WEAPONS.flechette.penetrate > 0 && !WEAPONS.shotgun.penetrate);
  const t = killTime('flechette', 19);
  assert.ok(t >= 0 && t < 2.5, `kills at 19 m in ${t.toFixed(2)} s`);
});

test('Stanchion: the cone starts 4.5 times wide and settles to the tightest automatic; letting go resets it', () => {
  const ps = aimedIn(shooter('beltlmg'), 'beltlmg');
  const w = weaponDef(ps);
  const cold = currentSpread(ps, w);
  run(ps, 16 * 60 / WEAPONS.beltlmg.rpm + 0.05, AIM_FIRE);
  const hot = currentSpread(ps, w);
  assert.ok(Math.abs(cold / hot - 4.5) < 0.05, `cold ${cold.toFixed(4)} hot ${hot.toFixed(4)}`);
  const autos = WEAPON_IDS.filter(id => WEAPONS[id].auto && !WEAPONS[id].burst && id !== 'beltlmg');
  assert.ok(autos.every(id => WEAPONS[id].adsSpread > WEAPONS.beltlmg.adsSpread), 'settled, nothing automatic is tighter');
  assert.ok(cold > WEAPONS.lmg.adsSpread, 'cold, it is looser than the Bulwark');
  run(ps, 1.2, AIM);
  assert.ok(Math.abs(currentSpread(ps, w) - cold) < 1e-6, 'settles again from scratch');
  assert.ok(!isAvailable('beltlmg', 'heatsink') && !isAvailable('beltlmg', 'shroud') && !w.heat);
});

test('Tandem: two rounds per pull, a hair apart, committed once started', () => {
  const ps = shooter('twinshot');
  const t = run(ps, 1.0, { fire: true }).map(s => s.t);
  assert.ok(t.length >= 4 && t.length % 2 === 0);
  for (let i = 0; i + 1 < t.length; i += 2) assert.ok(Math.abs(t[i + 1] - t[i] - 0.085) < 0.02, 'pair gap');
  assert.ok(Math.abs(t[2] - t[0] - 2 * 60 / WEAPONS.twinshot.rpm) < 0.03, 'pairs at half the rpm');
  const tap = shooter('twinshot');
  const one = [...run(tap, DT, { fire: true }), ...run(tap, 0.4)];
  assert.equal(one.length, 2, 'a tap still sends the pair');
  assert.equal(shotsToKill(WEAPONS.twinshot, 15), 3);
});

test('Harrier: stays on the scope between shots where a bolt gun is thrown off it; two to the body at any range', () => {
  const stay = aimedIn(shooter('scout'), 'scout'), bolt = aimedIn(shooter('sniper'), 'sniper');
  run(stay, 0.05, AIM_FIRE); run(bolt, 0.05, AIM_FIRE);
  assert.ok(stay.adsT >= 0.85, 'still fully aimed');
  assert.ok(bolt.adsT < 0.6, 'the Lancet is not');
  for (const d of [5, 30, 60]) assert.equal(shotsToKill(WEAPONS.scout, d), 2);
  assert.ok(60 / WEAPONS.scout.rpm < 60 / WEAPONS.semisnipe.rpm);
});

test('Lodestone: nothing leaves until the trigger has been held for its charge time, then it goes by itself; letting go bleeds the charge', () => {
  const CT = WEAPONS.rail.charge.time;
  const ps = aimedIn(shooter('rail'), 'rail');
  assert.equal(run(ps, CT - 0.1, AIM_FIRE).length, 0, 'no shot before the charge is full');
  assert.ok(ps.heat > 0.5 && ps.heat < 0.95, 'the bar shows the charge');
  const shots = run(ps, 0.2, AIM_FIRE);
  assert.equal(shots.length, 1, 'the round leaves on its own once charged');
  assert.equal(ps.ammo[0], 3);
  assert.ok(ps.heat < 0.05, 'bar empties with the shot');
  // Tapping never fires it.
  const tap = aimedIn(shooter('rail'), 'rail');
  let n = 0;
  for (let i = 0; i < 12; i++) { n += run(tap, CT - 0.12, AIM_FIRE).length; n += run(tap, 0.3, AIM).length; }
  assert.equal(n, 0, 'twelve short pulls, no shot');
  // Held down it cycles at charge + cooldown.
  const hold = aimedIn(shooter('rail'), 'rail');
  const t = run(hold, 3.2, AIM_FIRE).map(s => s.t);
  assert.ok(t.length >= 2);
  assert.ok(Math.abs(t[1] - t[0] - (CT + 60 / WEAPONS.rail.rpm)) < 0.08, `cycle ${(t[1] - t[0]).toFixed(2)} s`);
  assert.equal(shotsToKill(WEAPONS.rail, 70), 1);
  assert.ok(!WEAPONS.rail.heat && PRIMARY_IDS.includes('rail'), 'a charge gun is a primary with no heat bar of its own');
});

test('Magpies: the pair kick left and right in turn, and aiming barely tightens them', () => {
  const ps = shooter('akimbo');
  const off = run(ps, 0.6, { fire: true }).map(s => s.angles[0] - s.aim);
  assert.ok(off.length >= 6);
  assert.ok(off[1] > 0.004 && off[3] < -0.004 && off[5] > 0.004, `alternates: ${off.slice(0, 6).map(v => v.toFixed(3))}`);
  const w = WEAPONS.akimbo;
  assert.ok(w.adsSpread / w.hipSpread > 0.75);
  assert.ok(Object.values(WEAPONS).filter(g => g.category === 'Pistol' && g.id !== 'akimbo' && g.id !== 'golden').every(g => g.rpm < w.rpm || g.id === 'machpistol'));
});

test('Tacker: the tightest hip fire of the sidearms and the only one whose round goes through cover', () => {
  const pistols = WEAPON_IDS.filter(id => WEAPON_CATEGORY[id] === 'Pistol' && id !== 'nailer');
  assert.ok(pistols.every(id => WEAPONS[id].hipSpread > WEAPONS.nailer.hipSpread));
  assert.ok(pistols.every(id => !WEAPONS[id].penetrate) && WEAPONS.nailer.penetrate > 0);
});

test('Ripple: one pull is three rockets and three blasts, none of which kills alone', () => {
  const { sim, h, foe } = duel('salvo', 12);
  let shots = 0, booms = 0, hits = 0;
  const pull = { ...IDLE, aim: 0, aiming: true };
  for (let t = 0; t < 0.6; t += STEP) { stepPlayer(h.ps, pull, STEP, sim.map, mid); sim.step(STEP); }
  for (let t = 0; t < 1.2; t += STEP) {
    for (const s of stepPlayer(h.ps, { ...pull, fire: t < STEP * 1.5 }, STEP, sim.map, mid)) { shots++; sim.applyShot('h1', s, 0); }
    sim.step(STEP);
    for (const e of sim.drainEvents()) { if (e.t === 'explosion' && e.by === 'h1') booms++; if (e.t === 'hit' && e.by === 'h1' && e.target === foe.id) hits++; }
  }
  assert.equal(shots, 3); assert.equal(booms, 3);
  assert.equal(h.ps.ammo[0], 0);
  assert.ok(hits >= 1);
  assert.ok(WEAPONS.salvo.explosive.damage < 100 && WEAPONS.salvo.explosive.damage * 2 >= 100);
});

test('Gaff and Maul: reach three metres and no further, the Gaff lunges and the Maul swings in place, two swings and one', () => {
  for (const [id, swings] of [['knife', 2], ['bat', 2], ['maul', 1]]) {
    const w = WEAPONS[id];
    assert.equal(shotsToKill(w, 1.5), swings);
    assert.equal(killTime(id, 6, 60 / w.rpm - 0.05), -1, `${id}: a swing does nothing at 6 m`);
    const ps = shooter(id);
    const x0 = ps.x;
    const shots = run(ps, DT * 2, { fire: true });
    assert.equal(shots.length, 1);
    if (w.lunge >= 8) {
      assert.ok(Math.hypot(ps.vx, ps.vz) > MOVE.run * 1.5, `${id} lunges: ${Math.hypot(ps.vx, ps.vz).toFixed(1)} m/s`);
    }
    run(ps, 0.5);
    const moved = ps.x - x0;
    if (w.lunge >= 8) assert.ok(moved > 0.6 && moved < 3.2, `${id} carried ${moved.toFixed(2)} m`);
    else if (w.lunge) assert.ok(moved > 0.1 && moved < 1.2, `${id} steps in: ${moved.toFixed(2)} m`);   // The Slugger: a short step.
    else assert.ok(Math.abs(moved) < 0.3, `${id} swings in place: ${moved.toFixed(2)} m`);   // The Maul is an overhead swing, not a charge.
    assert.ok(Math.hypot(ps.vx, ps.vz) < 0.2, 'and stops');
    // V11: a blade takes only its own signature attachments, never the gun attachments.
    assert.ok(availableFor(id).every(a => a.kind === 'sig' && a.weapons.length === 1), `${id} takes only its own signatures`);
    assert.equal(normalizeKit(id, { grip: 'wrap', mag: 'extmag' }), normalizeKit(id, null));
  }
  assert.ok(WEAPONS.knife.moveMult > Math.max(...WEAPON_IDS.filter(i => i !== 'knife').map(i => WEAPONS[i].moveMult)), 'nothing runs faster than the Gaff');
});

/* ---------------- Attachments ---------------- */

test('eight new attachments: appended, real trade-offs, fit old and new guns, at most two parts a level', () => {
  // Slot lists only grow at the end, so the kit ints older builds send still mean the same kit.
  assert.equal(packKit({ optic: 'reflex', barrel: 'shroud', mag: 'apmag', grip: 'heavystock' }), 30673);
  assert.equal(packKit({ optic: 'reticle', barrel: 'suppressor', mag: 'extmag', grip: 'angled' }), 4376);
  // V11: past 15 a slot's options ride the high bits (7 a slot); the old low 16 bits are untouched.
  for (const slot of SLOTS) assert.ok(Object.values(ATTACHMENTS).filter(a => a.slot === slot).length <= 127, `${slot} fits 7 bits`);
  for (const id of NEW_ATTACHMENTS) {
    const a = ATTACHMENTS[id];
    assert.ok(a && a.name && a.desc && a.unlock >= 1 && a.unlock <= 30, id);
    const mods = Object.entries(a.mods);
    for (const [k] of mods) assert.ok(MOD_INFO[k], `${id}.${k} has a label`);
    const good = mods.filter(([k, v]) => (v - 1) * MOD_INFO[k].better > 0).length, bad = mods.filter(([k, v]) => (v - 1) * MOD_INFO[k].better < 0).length;
    assert.ok(good >= 1 && bad >= 2, `${id}: ${good} better, ${bad} worse`);
    assert.ok(OLD_IDS.some(w => isAvailable(w, id)) && NEW.some(w => isAvailable(w, id)), `${id} fits old and new guns`);
    const w = WEAPON_IDS.find(g => isAvailable(g, id));
    assert.deepEqual(unpackKit(w, packKit({ [a.slot]: id })), normalizeKit(w, { [a.slot]: id }), `${id} survives the wire`);
    assert.ok(compareStats(w, {}, { [a.slot]: id }).some(r => r.changed), `${id} moves a stat bar on the ${w}`);
  }
  // Wave 2 (attachments-w2.js) shares levels with older parts: at most two on one level of a gun, never one slot twice.
  for (const w of WEAPON_IDS) {
    const at = {};
    for (const t of trackFor(w)) (at[t.level] ??= []).push(t.attachment.slot);
    for (const l in at) assert.ok(at[l].length <= 2 && new Set(at[l]).size === at[l].length, `${w}: level ${l} opens ${at[l]}`);
  }
  assert.equal(applyAttachments(WEAPONS.ar, { mag: 'satchel' }).reserve, 225);
  assert.equal(applyAttachments(WEAPONS.launcher, { mag: 'satchel' }).reserve, 5);
  assert.ok(!isAvailable('pistol', 'satchel') && !isAvailable('golden', 'handstop'));
  assert.equal(applyAttachments(WEAPONS.ar, { mag: 'tapedmag' }).magazine, 30);
});

test('new guns take their class kit; class exclusions hold', () => {
  for (const id of NEW.filter(g => !WEAPONS[g].melee)) {
    const slots = new Set(availableFor(id).map(a => a.slot));
    assert.ok(slots.size >= 3, `${id} has ${slots.size} slots`);
    for (const a of availableFor(id).filter(x => !x.kind)) {   // V11 signatures and kits are meant to touch these.
      const eff = applyAttachments(WEAPONS[id], { [a.slot]: a.id });
      assert.equal(eff.damage, WEAPONS[id].damage); assert.equal(eff.rpm, WEAPONS[id].rpm);
      assert.ok(eff.magazine >= 1 && eff.range > 0);
      for (const k of ['settle', 'charge', 'burst', 'spinup']) assert.deepEqual(eff[k], WEAPONS[id][k], `${a.id} leaves ${id}.${k} alone`);
      assert.ok(Object.keys(modsFor(id, a.id)).length > 0);
    }
  }
  const ps = shooter('rail', { mag: 'extmag' });
  assert.equal(ps.ammo[0], applyAttachments(WEAPONS.rail, { mag: 'extmag' }).magazine);
});

/* ---------------- Saves and mastery ---------------- */

// A level 50 code exported by the build before V10 (git archive of the parent commit): AR at weapon level 30 with
// camo progress and a ladder count, a crossbow entry, a loadout with a kit.
const OLD_CODE = 'SY4.WzQsIk9sZCBIYW5kIiw4MTUzNiw0MDAwMDAsMCw1MCwwLFtbImFyIiwxMjEyMiwzMCwwLDQyMCw3MCwzMSw0NCwzMDAsWyJhc2giXSwiYXNoIiwibm9uZSIsIm5vbmUiLFs2MCwwLDAsMF0sMF0sWyJjcm9zc2JvdyIsNTAwMCwxNSwwLDEyLDAsMCwwLDAsW10sIm5vbmUiLCJub25lIiwibm9uZSIsWzAsMCwwLDBdLDBdXSxbWyJNYWluIiwiYXIiLCJzY2F0dGVyIix7ImFyIjp7Im9wdGljIjoicmVmbGV4IiwibWFnIjoiYXBtYWciLCJncmlwIjoiaGVhdnlzdG9jayJ9LCJzY2F0dGVyIjp7ImJhcnJlbCI6InN1cHByZXNzb3IifX0sWyJtYXJhdGhvbiIsInNjYXZlbmdlciIsInRyYWNrZXIiXSwic21va2UiLCJmcmFnIixbInVhdiIsInR1cnJldCIsImd1bnNoaXAiXSxudWxsXSxbIlJ1c2giLCJzbWciLCJwaXN0b2wiLHt9LFsibWFyYXRob24iLCJzY2F2ZW5nZXIiLCJ0cmFja2VyIl0sInNtb2tlIiwiZnJhZyIsWyJ1YXYiLCJ0dXJyZXQiLCJzdHJpa2UiXSxudWxsXSxbIkJyZWFjaCIsInNob3RndW4iLCJwaXN0b2wiLHt9LFsibWFyYXRob24iLCJzY2F2ZW5nZXIiLCJ0cmFja2VyIl0sInNtb2tlIiwiZnJhZyIsWyJ1YXYiLCJ0dXJyZXQiLCJzdHJpa2UiXSxudWxsXSxbIlN1cHByZXNzIiwibG1nIiwicGlzdG9sIix7fSxbIm1hcmF0aG9uIiwic2NhdmVuZ2VyIiwidHJhY2tlciJdLCJzbW9rZSIsImZyYWciLFsidWF2IiwidHVycmV0Iiwic3RyaWtlIl0sbnVsbF0sWyJPdmVyd2F0Y2giLCJzbmlwZXIiLCJwaXN0b2wiLHt9LFsibWFyYXRob24iLCJzY2F2ZW5nZXIiLCJ0cmFja2VyIl0sInNtb2tlIiwiZnJhZyIsWyJ1YXYiLCJ0dXJyZXQiLCJzdHJpa2UiXSxudWxsXV0sW10sW10sInlhcmQiLFtdLFtdLFtdLG51bGwsW11d.pd3bly';

test('a save code from before V10 imports unchanged, and re-exports to the same code', () => {
  assert.equal(decodeSave(OLD_CODE).error, 'reset', 'a code from before the progress reset is refused');
  const r = decodeSave(OLD_CODE, { preReset: true });
  assert.ok(r.ok, `decodes: ${r.error}`);
  const s = r.save;
  assert.equal(s.name, 'Old Hand'); assert.equal(s.peakLevel, 50);
  assert.deepEqual([s.weapons.ar.kills, s.weapons.ar.head, s.weapons.ar.long, s.weapons.ar.peak, s.weapons.ar.camo, s.weapons.ar.lad.kills], [420, 70, 31, 30, 'ash', 60]);
  assert.equal(s.weapons.crossbow.kills, 12);
  assert.deepEqual(s.loadouts[0].attachments.ar, { optic: 'reflex', mag: 'apmag', grip: 'heavystock' });
  assert.equal(s.loadouts[0].secondary, 'scatter');
  // The body has not moved; only the header now carries the reset generation (SY4R1, docs/RESET.md).
  assert.equal(encodeSave(s).split('.')[1], OLD_CODE.split('.')[1], 'the code format has not moved');
  assert.ok(encodeSave(s).startsWith('SY4R1.'));
  for (const id of NEW) assert.ok(itemOpen(s, 'weapon', id), `level 50 has the ${id}`);
});

test('old stored saves (v4, v3, v1) load; new guns open by level and take progress', () => {
  const v4 = blankSave();
  v4.xp = v4.totalXp = PLAYER_CURVE.floor(20); v4.peakLevel = 20;
  v4.weapons.smg = { ...blankWeapon(), kills: 80 };
  const s = migrateSave(JSON.parse(JSON.stringify(v4)));
  assert.equal(levelOf(s.xp), 20); assert.equal(s.weapons.smg.kills, 80);
  for (const id of NEW) assert.equal(itemOpen(s, 'weapon', id), itemUnlockLevel('weapon', id) <= 20, `${id} at level 20`);
  assert.ok(itemOpen(s, 'weapon', 'knife') && !itemOpen(s, 'weapon', 'rail'));
  const v3 = migrateSave({ version: 3, name: 'Three', xp: 5000, totalXp: 5000, prestige: 0, peakLevel: 6, weapons: { ar: { xp: 900, kills: 30 } }, loadouts: [] });
  assert.equal(v3.weapons.ar.kills, 30); assert.equal(v3.version, 4);
  const v1 = migrateSave({ name: 'One', primary: 'ar', kills: { ar: 40 }, xp: 1200 });
  assert.equal(v1.name, 'One');
  // A save that already uses the new guns and attachments round-trips through a code.
  const n = blankSave();
  n.xp = n.totalXp = PLAYER_CURVE.floor(45); n.peakLevel = 45;
  n.weapons.rail = { ...blankWeapon(), xp: 3000, kills: 25, head: 4 };
  n.loadouts[0] = cleanLoadout({ name: 'Coil', primary: 'rail', secondary: 'knife', attachments: { rail: { optic: 'steady', grip: 'bipod', mag: 'satchel' } }, perks: ['marathon', 'scavenger', 'tracker'], tactical: 'smoke', lethal: 'frag', streaks: ['uav', 'turret', 'gunship'] }, 0);
  const back = decodeSave(encodeSave(sanitizeSave(n)));
  assert.ok(back.ok);
  assert.equal(back.save.loadouts[0].primary, 'rail'); assert.equal(back.save.loadouts[0].secondary, 'knife');
  assert.deepEqual(back.save.loadouts[0].attachments.rail, { optic: 'steady', grip: 'bipod', mag: 'satchel' });
  assert.equal(back.save.weapons.rail.kills, 25);
});

test('mastery: a new gun has camo challenges and a ladder, kills count, and the ladder pays out', () => {
  for (const id of NEW) {
    assert.ok(challengesFor(blankWeapon()).length >= 8);
    const st = ladderStatus(id, blankWeapon());
    assert.equal(st.tiers.length, 5); assert.equal(st.open, false);
  }
  // The tracker reads the sim's real kill event.
  const { sim, h, foe } = duel('twinshot', 10);
  const m = new MasteryTracker('h1', { loadout: { operator: 'trooper' } });
  const inp = { ...IDLE, aim: 0, aiming: true, fire: true };
  for (let t = 0; t < 4; t += STEP) {
    for (const sh of stepPlayer(h.ps, inp, STEP, sim.map, mid)) sim.applyShot('h1', sh, 0);
    sim.step(STEP);
    m.onEvents(sim.drainEvents(), sim.getView('h1'));
    if (!foe.alive) break;
  }
  assert.equal(m.gains().weapons.twinshot?.kills, 1, 'one gun kill counted for the Tandem');
  const save = blankSave();
  save.weapons.twinshot = { ...blankWeapon(), peak: 30, xp: 1e6 };
  const r = applyMasteryGains(save, { weapons: { twinshot: { kills: 100, hurt: 30 } } });
  assert.equal(save.weapons.twinshot.ladT, 2, 'two ladder tiers');
  assert.ok(r.xp >= 5000 && r.ups.some(u => u.rewards.some(x => x.id === 'badge:twinshot-1')));
  const low = blankSave();
  low.weapons.knife = { ...blankWeapon(), peak: 12 };
  applyMasteryGains(low, { weapons: { knife: { kills: 100 } } });
  assert.equal(low.weapons.knife.ladT, 0, 'the ladder only opens at weapon level 30');
});

/* ---------------- Bots ---------------- */

/* ---------------- Weapons wave 3 (js/shared/weapons-w3.js) ---------------- */

test('wave 3: three guns in their classes, with names, feel, a borrowed reload, and a level no other gun opens on', () => {
  assert.deepEqual(Object.values(W3_GUNS).flat().sort(), [...W3].sort());
  for (const id of W3) {
    const w = WEAPONS[id];
    assert.equal(w.category, WEAPON_CATEGORY[id]);
    assert.ok(w.feel && w.feel.fx && w.feel.voice && w.feel.recoil, `${id} has its own flash, voice and kick`);
    for (const key of ['sound', 'fx', 'reload', 'hold', 'force']) assert.ok(OLD_IDS.includes(W3_LIKE[id][key]), `${id} borrows a real ${key}`);
    assert.ok(w.headMult >= 1 && Number.isFinite(w.headMult));
  }
  const levels = UNLOCK_SCHEDULE.filter(u => u.kind === 'weapon');
  for (const u of W3_UNLOCKS) assert.equal(levels.filter(v => v.level === u.level).length, 1, `${u.id}: level ${u.level} is its own`);
});

test('Clatter: three rounds a pull, a hair apart; two bursts kill to 17 m, where every other SMG needs more; slow in a room', () => {
  const w = WEAPONS.burstsmg;
  const ps = shooter('burstsmg');
  const t = [...run(ps, 1.0, { fire: true }).map(s => s.t), ...run(ps, 0.15).map(s => 1.0 + s.t)];   // Let go: a started burst finishes.
  assert.ok(t.length >= 6 && t.length % 3 === 0, `${t.length} rounds`);
  for (let i = 0; i + 2 < t.length; i += 3) assert.ok(Math.abs(t[i + 1] - t[i] - w.burst.gap) < 0.02 && Math.abs(t[i + 2] - t[i + 1] - w.burst.gap) < 0.02, 'burst gap');
  assert.ok(Math.abs(t[3] - t[0] - 3 * 60 / w.rpm) < 0.03, 'bursts at its rpm');
  assert.equal(shotsToKill(w, 17), 4);
  for (const id of WEAPON_IDS.filter(id => WEAPONS[id].category === 'SMG' && id !== 'burstsmg')) assert.ok(shotsToKill(WEAPONS[id], 17) > 4, `${id} needs more at 17 m`);
  // Ideal time to the killing round: whole bursts at the cadence, then the gap inside the last one.
  const ttk = (d, x) => { const n = shotsToKill(d, x) - 1; return d.burst ? Math.floor(n / d.burst.count) * d.burst.count * 60 / d.rpm + (n % d.burst.count) * d.burst.gap : n * 60 / d.rpm; };
  for (const id of ['smg', 'pdw', 'tacsmg', 'heavysmg', 'hushsmg']) assert.ok(ttk(w, 5) > ttk(WEAPONS[id], 5), `slower in a room than the ${id}`);
  for (const id of WEAPON_IDS.filter(id => WEAPONS[id].category === 'SMG' && id !== 'burstsmg')) assert.ok(ttk(w, 17) < ttk(WEAPONS[id], 17), `quicker at 17 m than the ${id}`);
});

test('Bullhead: one shell kills further out than any other pellet gun, four in the tube, through a crate', () => {
  const w = WEAPONS.heavyshot;
  assert.equal(shotsToKill(w, 12), 1);
  const reach = d => { let r = 0; for (let x = 0.5; x < 30; x += 0.25) if (shotsToKill(d, x) === 1) r = x; return r; };
  for (const id of WEAPON_IDS.filter(id => (WEAPONS[id].pellets || 1) > 1 && id !== 'heavyshot')) assert.ok(reach(w) > reach(WEAPONS[id]), `${id} reaches ${reach(WEAPONS[id])} m`);
  assert.ok(w.magazine === 4 && w.shellReload && w.penetrate > 0);
  assert.ok(60 / w.rpm > 60 / WEAPONS.shotgun.rpm, 'the slowest pump');
});

test('Gavel: three to the body out to 22 m, the quickest sidearm kill from 18 m out, at a slower pace than the Flicker', () => {
  const w = WEAPONS.battlepistol;
  assert.equal(shotsToKill(w, 22), 3);
  const ttk = (d, x) => (shotsToKill(d, x) - 1) * 60 / d.rpm;
  for (const id of WEAPON_IDS.filter(id => WEAPONS[id].category === 'Pistol' && !WEAPONS[id].golden && id !== 'battlepistol')) {
    for (const x of [18, 22, 28]) if (WEAPONS[id].range > x) assert.ok(ttk(w, x) < ttk(WEAPONS[id], x), `${id} at ${x} m`);
  }
  assert.ok(ttk(w, 6) > ttk(WEAPONS.revolver, 6), 'the Verdict still wins a room');
  assert.ok(w.rpm < WEAPONS.pistol.rpm && SECONDARY_IDS.includes('battlepistol'));
});

/* ---------------- Weapons wave 5 (js/shared/weapons-w5.js, js/sim/arsenal-w5.js) ---------------- */

test('wave 5: five guns in their classes, with names, feel, a borrowed reload, icons, and a level no other gun opens on', () => {
  assert.deepEqual(Object.values(W5_GUNS).flat(), W5);
  const names = new Set(Object.values(WEAPONS).map(w => w.name));
  assert.equal(names.size, Object.keys(WEAPONS).length, 'every weapon has its own name');
  for (const id of W5) {
    const w = WEAPONS[id];
    assert.equal(w.category, WEAPON_CATEGORY[id]);
    assert.ok(w.feel && w.feel.fx && w.feel.voice && w.feel.recoil, `${id} has its own flash, voice and kick`);
    for (const key of ['sound', 'fx', 'reload', 'hold', 'force']) assert.ok(OLD_IDS.includes(W5_LIKE[id][key]), `${id} borrows a real ${key}`);
    assert.ok(w.headMult >= 1 && Number.isFinite(w.headMult) && hasIcon(id), id);
    assert.equal(PRIMARY_IDS.includes(id) + SECONDARY_IDS.includes(id), 1, `${id} is in exactly one slot list`);
  }
  const levels = UNLOCK_SCHEDULE.filter(u => u.kind === 'weapon');
  for (const u of W5_UNLOCKS) assert.equal(levels.filter(v => v.level === u.level).length, 1, `${u.id}: level ${u.level} is its own`);
  const carried = new Set();
  for (const mapId of Object.keys(MAPS)) for (const mode of ['tdm', 'dom', 'kc']) for (const r of buildRoster([], { botSkill: 'regular', teamSize: 6, mapId, mode, seed: 3 })) { carried.add(r.loadout.primary); carried.add(r.loadout.secondary); }
  for (const id of W5) assert.ok(carried.has(id), `bots are dealt the ${id}`);
});

test('Gadfly: the tightest hip cone of any automatic primary, and aiming it adds almost nothing', () => {
  const w = WEAPONS.hipsmg;
  for (const id of PRIMARY_IDS.filter(id => WEAPONS[id].auto && id !== 'hipsmg' && (WEAPONS[id].pellets || 1) === 1)) {
    assert.ok(w.hipSpread < WEAPONS[id].hipSpread, `tighter from the hip than the ${id}`);
  }
  assert.ok(w.adsSpread / w.hipSpread > 0.75, 'the sight barely tightens it');
  for (const id of ['smg', 'pdw', 'tacsmg', 'hushsmg']) assert.ok(w.adsTime > WEAPONS[id].adsTime, `slower to aim than the ${id}`);
  const ps = shooter('hipsmg');
  const shots = run(ps, 1.0, { fire: true });
  assert.ok(shots.length >= 13, `${shots.length} rounds from the hip in a second`);
  const kt = killTime('hipsmg', 6);
  assert.ok(kt >= 0, `it kills (${kt})`);
});

test('Carousel: three to the body to 16 m from the first pull, no heat, no wind-up; slower than the belt guns, slower to change', () => {
  const w = WEAPONS.panlmg;
  assert.equal(shotsToKill(w, 16), 3);
  assert.ok(!w.heat && !w.spinup && w.magazine === 47 && w.reload > WEAPONS.lightlmg.reload, 'a slow pan change');
  for (const id of WEAPON_IDS.filter(id => WEAPONS[id].category === 'LMG' && id !== 'panlmg')) {
    assert.ok(shotsToKill(WEAPONS[id], 16) > 3, `the ${id} needs more`);
    assert.ok(w.rpm < WEAPONS[id].rpm, `slower than the ${id}`);
  }
  assert.ok(!isAvailable('panlmg', 'heatsink') && !isAvailable('panlmg', 'shroud'), 'no heat parts on a gun with no heat bar');
  const t = killTime('panlmg', 6);
  assert.ok(t >= 0 && t < 0.6, `kills at 6 m in ${t}`);
});

test('Vigil: two to the body anywhere it reaches, never one, semi-automatic, the scope thrown every round', () => {
  const w = WEAPONS.autosniper;
  for (const d of [5, 20, 40, 60]) assert.equal(shotsToKill(w, d), 2, `${d} m`);
  assert.ok(!w.auto && w.boltKick > 0 && w.magazine >= 6);
  for (const id of ['sniper', 'antimat', 'semisnipe']) assert.ok(w.rpm > 2 * WEAPONS[id].rpm, `far quicker follow-ups than the ${id}`);
  const ps = aimedIn(shooter('autosniper'), 'autosniper');
  const shots = run(ps, 1.6, AIM_FIRE);
  assert.ok(shots.length >= 3, `${shots.length} aimed rounds in 1.6 s`);
  const t = killTime('autosniper', 20);
  assert.ok(t >= 0 && t < 1.2, `kills at 20 m in ${t}`);
});

test('Fusee: one flare burns its target for three seconds, lights them on the map, never kills a healthy player alone; a burn kill is its kill', () => {
  const w = WEAPONS.flare;
  assert.ok(w.burn && w.burn.mark && w.magazine === 1 && SECONDARY_IDS.includes('flare'));
  assert.ok(w.damage + w.burn.dps * w.burn.time < 100, 'one flare is never a kill on full health');
  const { sim, h, foe } = duel('flare', 8);
  h.ps.slot = 1; h.ps.weapon = 'flare';
  sim.applyShot('h1', { weapon: 'flare', ox: h.ps.x, oz: h.ps.z, aim: 0, ads: true, angles: [0] }, 0);
  let ev = sim.drainEvents();
  assert.ok(ev.some(e => e.t === 'ignite' && e.id === foe.id && e.by === 'h1'), 'it ignites');
  assert.ok(foe.markT > 0 && foe.burn, 'burning and marked');
  const hp0 = foe.hp;
  for (let i = 0; i < SIM_HZ * 3.2; i++) sim.step(STEP);
  ev = sim.drainEvents();
  assert.ok(Math.abs(hp0 - foe.hp - w.burn.dps * w.burn.time) < 1, `burned ${hp0 - foe.hp}`);
  assert.ok(foe.alive && !foe.burn, 'the fire goes out; still alive');
  // Tac Mask halves it; a burn that finishes a hurt player is the Fusee's kill.
  foe.ps.perks = ['tacmask', 'scavenger', 'tracker']; foe.hp = 100;
  sim.applyShot('h1', { weapon: 'flare', ox: h.ps.x, oz: h.ps.z, aim: 0, ads: true, angles: [0] }, 0);
  const masked = foe.hp;
  for (let i = 0; i < SIM_HZ * 3.2; i++) sim.step(STEP);
  assert.ok(Math.abs(masked - foe.hp - w.burn.dps * w.burn.time / 2) < 1, `masked burn ${masked - foe.hp}`);
  foe.hp = 30; foe.ps.perks = ['marathon', 'scavenger', 'tracker'];
  sim.drainEvents();
  sim.applyShot('h1', { weapon: 'flare', ox: h.ps.x, oz: h.ps.z, aim: 0, ads: true, angles: [0] }, 0);
  foe.hp = 20;
  let kill = null;
  for (let i = 0; i < SIM_HZ * 3.2 && !kill; i++) { sim.step(STEP); kill = sim.drainEvents().find(e => e.t === 'kill' && e.target === foe.id); }
  assert.ok(kill && kill.weapon === 'flare' && kill.by === 'h1' && !kill.equip && !kill.streak, 'the burn kill is the Fusee\'s');
});

test('Skyhook: fully aimed at an enemy aircraft in its cone it cannot miss; two bring a chopper down; at people a small rocket', () => {
  const w = WEAPONS.lockon;
  assert.ok(w.lockon && w.explosive && w.explosive.damage < 100 && SECONDARY_IDS.includes('lockon'));
  const { sim, h, foe } = duel('lockon', 20);
  foe.alive = true;
  sim._launchChopper(foe);
  const g = sim.gunships.find(x => x.kind === 'chopper' && x.team === foe.team);
  g.x = h.ps.x + 18; g.z = h.ps.z + 6;        // Well off the line of the aim, inside the cone.
  const aim = 0;
  sim.drainEvents();
  sim.applyShot('h1', { weapon: 'lockon', ox: h.ps.x, oz: h.ps.z, aim, ads: false, angles: [aim] }, 0);
  assert.ok(!sim.drainEvents().some(e => e.t === 'shot' && e.lk), 'from the hip it does not lock');
  sim.applyShot('h1', { weapon: 'lockon', ox: h.ps.x, oz: h.ps.z, aim, ads: true, angles: [aim] }, 0);
  const ev = sim.drainEvents();
  assert.ok(ev.some(e => e.t === 'shot' && e.lk && Math.abs(e.lk[0] - g.x) < 0.1), 'aimed, it locks and the shot says where');
  assert.ok(g.hp < g.maxHp && g.hp > 0, 'one rocket hurts it');
  sim.applyShot('h1', { weapon: 'lockon', ox: h.ps.x, oz: h.ps.z, aim, ads: true, angles: [aim] }, 0);
  assert.ok(sim.drainEvents().some(e => e.t === 'air_down' && e.by === 'h1'), 'two bring it down');
  // Behind you: no lock.
  sim._launchChopper(foe);
  const g2 = sim.gunships.at(-1); g2.x = h.ps.x - 20; g2.z = h.ps.z;
  sim.applyShot('h1', { weapon: 'lockon', ox: h.ps.x, oz: h.ps.z, aim, ads: true, angles: [aim] }, 0);
  assert.ok(!sim.drainEvents().some(e => e.t === 'shot' && e.lk), 'outside the cone, no lock');
});

/* ---------------- Weapons wave 4: six melee weapons (js/shared/weapons-w4.js) ---------------- */

test('wave 4: six melee secondaries with their own swings, names, levels, finishers and a signature each; no bot carries one', () => {
  assert.deepEqual(W4_GUNS.Melee, W4);
  const names = new Set(Object.values(WEAPONS).map(w => w.name));
  assert.equal(names.size, Object.keys(WEAPONS).length, 'every weapon has its own name');
  const swings = new Set();
  for (const id of W4) {
    const w = WEAPONS[id];
    assert.ok(w.melee && w.category === 'Melee' && SECONDARY_IDS.includes(id) && !PRIMARY_IDS.includes(id), id);
    assert.ok(w.feel && w.feel.recoil, `${id} has its own kick`);
    for (const key of ['sound', 'fx', 'reload', 'hold', 'force']) assert.ok(WEAPONS[W4_LIKE[id][key]], `${id} borrows a real ${key}`);
    assert.ok(hasIcon(id), `${id} has an icon`);
    assert.ok(availableFor(id).length === 1 && availableFor(id)[0].kind === 'sig', `${id}: one signature, no gun parts`);
    assert.ok(weaponFinisher(id) && FINISHERS.includes(weaponFinisher(id)) && !OPERATOR_FINISHERS.includes(weaponFinisher(id)), `${id} has its own finisher`);
    swings.add(w.swing);
  }
  assert.ok(availableFor('bat').length === 1, 'the Slugger has its signature');
  assert.deepEqual([...swings].sort(), ['double', 'jab', 'level', 'overhead', 'slash', 'thrust']);
  const levels = UNLOCK_SCHEDULE.filter(u => u.kind === 'weapon');
  for (const u of W4_UNLOCKS) assert.equal(levels.filter(v => v.level === u.level).length, 1, `${u.id}: level ${u.level} is its own`);
  const carried = new Set();
  for (const mapId of Object.keys(MAPS)) for (const mode of ['tdm', 'dom', 'kc']) for (const r of buildRoster([], { botSkill: 'regular', teamSize: 6, mapId, mode, seed: 3 })) { carried.add(r.loadout.primary); carried.add(r.loadout.secondary); }
  for (const id of W4) assert.ok(!carried.has(id), `bots never carry the ${id}`);
});

test('wave 4: each blade has its own identity: hits to kill, reach, lunge and pace', () => {
  const W = WEAPONS, swing = id => 60 / W[id].rpm;
  // Hits to kill (a burst's cuts each count).
  for (const [id, n] of [['katana', 2], ['fireaxe', 1], ['shovel', 2], ['kama', 3], ['machete', 2], ['tonfa', 3]]) assert.equal(shotsToKill(W[id], 1.5), n, id);
  // The Spade reaches furthest of any melee; the Kagero lunges furthest.
  for (const id of WEAPON_IDS.filter(i => W[i].melee && i !== 'shovel')) assert.ok(W.shovel.range > W[id].range, `the Spade outreaches the ${id}`);
  for (const id of WEAPON_IDS.filter(i => W[i].melee && i !== 'katana')) assert.ok(W.katana.lunge > (W[id].lunge ?? 0), `the Kagero lunges past the ${id}`);
  // Kindling: one blow like the Maul, sooner again, but shorter.
  assert.ok(swing('fireaxe') < swing('maul') && W.fireaxe.range < W.maul.range);
  // The Nightstick swings fastest of all.
  for (const id of WEAPON_IDS.filter(i => W[i].melee && i !== 'tonfa')) assert.ok(W.tonfa.rpm > W[id].rpm, `the Nightstick out-paces the ${id}`);
  // Bushwhack: a little more reach than the Gaff, a shorter lunge, a hair slower.
  assert.ok(W.machete.range > W.knife.range && W.machete.lunge < W.knife.lunge && W.machete.rpm < W.knife.rpm);
});

test('wave 4: every blade swings, reaches no further than its range, and the Gleaner cuts twice a pull', () => {
  for (const id of W4) {
    const w = WEAPONS[id];
    assert.equal(killTime(id, w.range + 1.5, 60 / w.rpm - 0.05), -1, `${id}: a swing does nothing past its reach`);
    const ps = shooter(id);
    const x0 = ps.x;
    const shots = run(ps, w.burst ? 0.3 : DT * 2, { fire: true });
    assert.equal(shots.length, w.burst ? 2 : 1, `${id}: ${shots.length} cuts a pull`);
    run(ps, 0.6);
    const moved = ps.x - x0;
    if (!w.lunge) assert.ok(Math.abs(moved) < 0.3, `${id} swings in place: ${moved.toFixed(2)} m`);
    else assert.ok(moved > 0.1 && moved < 4.2, `${id} steps in: ${moved.toFixed(2)} m`);
    assert.ok(Math.hypot(ps.vx, ps.vz) < 0.2, `${id} stops`);
  }
});

if (!process.argv.includes('quick')) {
  const line = [];
  for (const id of [...NEW, ...W3.filter(id => PRIMARY_IDS.includes(id)), ...W5.filter(id => PRIMARY_IDS.includes(id))]) {
    test(`bots carrying the ${WEAPONS[id].name} get kills with it in a 60 s match`, () => {
      let best = 0, note = '';
      // Two seeds on two maps: a gun has to work somewhere on its own, not ride one lucky spawn.
      for (const [mapId, seed] of [['railyard', 11], ['dust', 5]]) {
        const roster = buildRoster([], { botSkill: 'veteran', teamSize: 6, mapId, mode: 'tdm', seed });
        for (const r of roster) { r.primary = id; r.loadout = { ...r.loadout, primary: id, attachments: {} }; }
        const sim = new Sim({ roster, map: mapId, seed, mode: 'tdm', timeLimit: 600, scoreLimit: 999 });
        let kills = 0, shots = 0;
        for (let i = 0; i < SIM_HZ * 63; i++) {
          sim.step(STEP);
          for (const e of sim.drainEvents()) {
            if (e.t === 'shot' && e.weapon === id) shots++;
            if (e.t === 'kill' && e.weapon === id && !e.equip && !e.streak) kills++;
          }
        }
        note += ` ${mapId} ${kills}k/${shots}s`;
        best = Math.max(best, kills);
        assert.ok(shots > 0, `bots fire the ${id} on ${mapId}`);
      }
      line.push(`${WEAPONS[id].name}:${note}`);
      assert.ok(best >= 2, `${id}:${note}`);
    });
  }
  console.log('    kills/shots by twelve veteran bots in 60 s:\n      ' + line.join('\n      '));
}

console.log(`\n${passed} checks passed`);
