// Node tests for the V11 attachments wave (js/shared/attachments-v11.js): signature attachments and conversion kits,
// and for attachments wave 2 (js/shared/attachments-w2.js, the section at the end).
// Every attachment applies to every gun that takes it and gives something and costs something; its model fits the
// gun (drawn, not floating off it); kits do what their description says when the gun is fired; wire packing keeps the
// old ints; save codes round-trip and an old code with attachments still loads; unlocks spread over levels and the
// mastery ladder; bots fit only what their gun takes. Run: node dev/sim-attachments.mjs
// Exits non-zero on the first failed check, printing what failed.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createPlayerState, stepPlayer, weaponDef } from '../js/sim/player.js';
import { WEAPONS, headMultAt, shotsToKill } from '../js/shared/weapons.js';
import { WEAPON_IDS, SECONDARY_IDS, GOLDEN_ID } from '../js/shared/constants.js';
import { ATTACHMENTS, MOD_INFO, IDENTITY_MODS, SLOTS, LADDER_BASE, availableFor, isAvailable, normalizeKit, packKit, unpackKit,
  trackFor, applyAttachments, attachmentDeltas, unlockMet, unlockLabel } from '../js/shared/attachments.js';
import { V11_ATTACHMENTS } from '../js/shared/attachments-v11.js';
import { W2_ATTACHMENTS, W2_EXTEND } from '../js/shared/attachments-w2.js';
import { blankSave, encodeSave, decodeSave, cleanLoadout, WEAPON_LADDER } from '../js/shared/progression.js';
import { botAttachments } from '../js/sim/bots.js';
import { MAPS } from '../js/shared/map.js';
import { raycastMap } from '../js/shared/geometry.js';

// The gun models import 'three' by bare name (the page's import map); point node at the vendored copy.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: ${JSON.stringify(new URL('../vendor/three.min.js', import.meta.url).href)}, shortCircuit: true };
  return next(s, c); }`));
const { getGun, modelKit } = await import('../js/render/guns.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.error(`FAIL ${name}\n${err.stack}`); process.exit(1); }
}

const NEW = Object.values(V11_ATTACHMENTS);
const SIGS = NEW.filter(a => a.kind === 'sig'), KITS = NEW.filter(a => a.kind === 'kit');
const DT = 1 / 60;
const MAP = MAPS.railyard;
const mid = () => 0.5;
const IDLE = { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, reload: false, swap: false, streak: false };
function lane() {
  for (let z = 4; z < MAP.height - 4; z++) for (let x = 4; x < MAP.width - 30; x++) {
    if (![-1.5, 0, 1.5].some(dz => raycastMap(MAP, x - 1, z + dz, 1, 0, 26, 'blocksBullet'))) return { x, z };
  }
  throw new Error('no lane');
}
const LANE = lane();
function shooter(id, kit) {
  const secondary = SECONDARY_IDS.includes(id);
  const loadout = secondary ? { primary: 'ar', secondary: id, attachments: { [id]: kit } } : { primary: id, attachments: { [id]: kit } };
  const ps = createPlayerState({ id: 'p', primary: loadout.primary, loadout });
  ps.x = LANE.x; ps.z = LANE.z; ps.aim = 0;
  if (secondary) { stepPlayer(ps, { ...IDLE, swap: true }, DT, MAP, mid); run(ps, 1.2); }
  assert.equal(ps.weapon, id);
  return ps;
}
function run(ps, seconds, input = {}) {
  const out = [], inp = { ...IDLE, ...input };
  for (let t = 0; t < seconds - 1e-9; t += DT) for (const s of stepPlayer(ps, inp, DT, MAP, mid)) out.push({ ...s, t });
  return out;
}
const fire = (id, kit, seconds) => { const ps = shooter(id, kit); run(ps, 0.8, { aiming: true }); return { ps, shots: run(ps, seconds, { aiming: true, fire: true }) }; };
const gaps = shots => shots.slice(1).map((s, i) => +(s.t - shots[i].t).toFixed(3));

/* ---------------- Data ---------------- */

test('60-80 signature attachments and 8-12 kits, one gun each, appended after every older id', () => {
  assert.ok(SIGS.length >= 60 && SIGS.length <= 80, `${SIGS.length} signatures`);
  assert.ok(KITS.length >= 8 && KITS.length <= 12, `${KITS.length} kits`);
  const ids = Object.keys(ATTACHMENTS);
  const first = ids.indexOf(NEW[0].id);
  // Wave 2's general parts (attachments-w2.js) come after V11, so V11 is one block in its own order.
  assert.deepEqual(ids.slice(first, first + NEW.length), NEW.map(a => a.id), 'V11 ids follow the older table, in order');
  assert.ok(ids.slice(first + NEW.length).every(id => W2_ATTACHMENTS[id]), 'only wave 2 comes after V11');
  assert.ok(ids.slice(0, first).every(id => !ATTACHMENTS[id].kind));
  for (const a of NEW) {
    assert.ok(a.name && a.desc && a.for && SLOTS.includes(a.slot), a.id);
    assert.equal(a.weapons.length, 1, `${a.id} names one gun`);
    assert.ok(WEAPONS[a.weapons[0]] && a.weapons[0] !== GOLDEN_ID, `${a.id} gun`);
    for (const k of Object.keys(a.mods)) assert.ok(MOD_INFO[k], `${a.id}.${k} has a label`);
  }
  // Identity keys (damage, rpm, wind-up...) belong to signatures and kits only.
  for (const a of Object.values(ATTACHMENTS).filter(x => !x.kind)) {
    for (const k of Object.keys(a.mods)) assert.ok(!IDENTITY_MODS.has(k), `${a.id} must not touch ${k}`);
    assert.ok(!a.set, `${a.id} has no set`);
  }
  // Every gun but the Golden Gun has at least one signature attachment; every class at least one kit.
  for (const w of WEAPON_IDS.filter(id => id !== GOLDEN_ID)) assert.ok(SIGS.some(a => a.weapons[0] === w), `${w} has a signature`);
  for (const cat of ['Assault', 'SMG', 'Shotgun', 'LMG', 'Marksman', 'Sniper', 'Pistol']) {
    assert.ok(KITS.some(a => WEAPONS[a.weapons[0]].category === cat), `${cat} has a kit`);
  }
  assert.equal(availableFor(GOLDEN_ID).length, 0, 'the Golden Gun takes nothing');
});

test('every attachment applies on every gun that takes it, and every one gives something and costs something', () => {
  let n = 0;
  for (const a of Object.values(ATTACHMENTS)) for (const w of WEAPON_IDS.filter(id => isAvailable(id, a.id))) {
    const eff = applyAttachments(WEAPONS[w], { [a.slot]: a.id });
    assert.notEqual(eff, WEAPONS[w], `${a.id} on ${w} makes an effective def`);
    for (const k of ['damage', 'rpm', 'magazine', 'range', 'reload', 'adsTime', 'moveMult', 'adsSpread', 'hipSpread']) {
      assert.ok(Number.isFinite(eff[k]) && eff[k] > 0, `${a.id} on ${w}: ${k} = ${eff[k]}`);
    }
    const d = attachmentDeltas(WEAPONS[w], a.id);
    const up = d.filter(x => x.better === true), down = d.filter(x => x.better === false);
    assert.ok(up.length >= 1, `${a.id} on ${w} gives something: ${JSON.stringify(d)}`);
    assert.ok(down.length >= 1, `${a.id} on ${w} costs something: ${JSON.stringify(d)}`);
    n++;
  }
  assert.ok(n > 900, `${n} gun-attachment pairs`);
});

test('a kit that changes damage re-derives the head multiplier; a full-auto marksman rifle cannot one-tap heads', () => {
  const slug = applyAttachments(WEAPONS.shotgun, { barrel: 'k_slugbarrel' });
  assert.equal(slug.pellets, 1); assert.equal(slug.damage, 70);
  assert.equal(shotsToKill(slug, 10, 100, true, false), 2, 'two slugs to the body at 10 m');
  assert.equal(shotsToKill(slug, 10, 100, true, true), 1, 'an aimed head slug kills');
  const sear = applyAttachments(WEAPONS.dmr, { grip: 'k_runaway' });
  assert.equal(sear.auto, true); assert.equal(sear.boltKick, undefined);
  assert.equal(shotsToKill(sear, 20, 100, true, false), 3, 'three to the body');
  assert.ok(sear.damage * headMultAt(sear, true) < 100, 'a head hit alone does not kill');
  const self = applyAttachments(WEAPONS.sniper, { mag: 'k_selfloader' });
  assert.equal(shotsToKill(self, 30, 100, true, false), 2, 'Self-Loader: two to the body');
  assert.equal(shotsToKill(self, 30, 100, true, true), 1, 'and a head kill');
});

/* ---------------- Behaviour ---------------- */

test('kits change behaviour as described when fired', () => {
  // Tri-Burst: rounds leave in threes, 55 ms apart, with a longer recovery between groups.
  let g = gaps(fire('ar', { grip: 'k_triburst' }, 1.2).shots);
  assert.ok(g.length >= 5 && g[0] < 0.07 && g[1] < 0.07 && g[2] > 0.12, `tri-burst gaps ${g}`);
  // Open Bolt: no bursts, an even cadence near 625 rpm.
  g = gaps(fire('burst', { grip: 'k_openbolt' }, 1).shots);
  assert.ok(Math.max(...g) - Math.min(...g) < 0.02 && Math.abs(g[2] - 60 / 625) < 0.02, `open bolt gaps ${g}`);
  // Triple Tap: the Deuce fires threes instead of pairs.
  g = gaps(fire('deuce', { grip: 'k_tripletap' }, 1).shots);
  assert.ok(g[0] < 0.08 && g[1] < 0.08 && g[2] > 0.1, `triple tap gaps ${g}`);
  // Runaway Sear: full auto at about 407 rpm, and the scope stays up (no bolt kick).
  let r = fire('dmr', { grip: 'k_runaway' }, 1);
  assert.ok(r.shots.length >= 6, `${r.shots.length} rounds a second`);
  assert.ok(r.ps.adsT > 0.9, 'stays aimed while firing');
  const plain = fire('dmr', {}, 1);
  assert.ok(plain.shots.length <= 4 && plain.ps.adsT < 0.95, 'the stock Tallyman is semi and kicks the scope');
  // Slug Barrel / Buckshot Tube / Scatter Loads: one ray against seven and six.
  assert.ok(fire('shotgun', { barrel: 'k_slugbarrel' }, 0.3).shots.every(s => s.angles.length === 1));
  assert.ok(fire('slug', { mag: 'k_bucktube' }, 0.3).shots.every(s => s.angles.length === 7));
  assert.ok(fire('lever', { mag: 'k_scatterloads' }, 0.3).shots.every(s => s.angles.length === 6));
  // Self-Loader: over twice the Lancet's rate.
  assert.ok(fire('sniper', { mag: 'k_selfloader' }, 2.2).shots.length >= 3, 'self-loader cycles');
  // Hive Drum: 72 rounds.
  assert.equal(shooter('smg', { mag: 'k_hivedrum' }).ammo[0], 72);
  // Assault Box: no wind-up, so the first gaps are already full rate; the stock Bulwark starts slow.
  const box = gaps(fire('lmg', { mag: 'k_assaultbox' }, 0.5).shots), stock = gaps(fire('lmg', {}, 0.5).shots);
  assert.ok(Math.abs(box[0] - 60 / 640) < 0.02 && stock[0] > box[0] * 1.3, `assault box ${box[0]} v ${stock[0]}`);
  // Whisper Barrel: suppressed shots, no minimap reveal. Open Muzzle: the Murmur shows up.
  r = fire('carbine', { barrel: 'k_whisper' }, 0.3);
  assert.ok(r.shots.every(s => s.sup === 1) && r.ps.firingT === 0, 'whisper is suppressed');
  r = fire('hushsmg', { barrel: 'k_openmuzzle' }, 0.3);
  assert.ok(r.shots.every(s => !s.sup) && r.ps.firingT > 0, 'open muzzle is loud');
});

test('signature mechanics move the gun they are made for', () => {
  // Light Flywheel: the first rounds leave sooner.
  const light = gaps(fire('rampar', { grip: 's_lightwheel' }, 0.6).shots), stock = gaps(fire('rampar', {}, 0.6).shots);
  assert.ok(light[0] < stock[0], `light flywheel ${light[0]} v ${stock[0]}`);
  // Long Belt: a longer belt. Bedded Receiver: settles in fewer rounds from a tighter start.
  assert.equal(shooter('beltlmg', { mag: 's_longbelt' }).ammo[0], Math.round(90 * ATTACHMENTS.s_longbelt.mods.magazine));
  const bed = weaponDef(shooter('beltlmg', { grip: 's_bedded' }));
  assert.ok(bed.settle.shots < 15 && bed.settle.from < 4.5);
  // Capacitor Bank charges faster; Lockstep Sear packs the pair.
  assert.ok(applyAttachments(WEAPONS.rail, { mag: 's_capacitor' }).charge.time < WEAPONS.rail.charge.time);
  assert.ok(applyAttachments(WEAPONS.twinshot, { grip: 's_lockstep' }).burst.gap < WEAPONS.twinshot.burst.gap);
  // Iron Head: the Maul reaches further and swings slower; Lunge Strap throws the Gaff further.
  const head = applyAttachments(WEAPONS.maul, { barrel: 's_ironhead' });
  assert.ok(head.range > WEAPONS.maul.range && head.rpm < WEAPONS.maul.rpm);
  assert.ok(applyAttachments(WEAPONS.knife, { grip: 's_lungestrap' }).lunge > WEAPONS.knife.lunge);
  // Hair Trigger: the Foreman taps faster and blooms more.
  const hair = applyAttachments(WEAPONS.battle, { grip: 's_hairtrigger' });
  assert.ok(hair.rpm > WEAPONS.battle.rpm && hair.bloomPerShot > WEAPONS.battle.bloomPerShot);
});

/* ---------------- Models ---------------- */

test('every signature attachment and kit model fits its gun: drawn, and inside the gun\'s own reach', () => {
  let drawn = 0;
  for (const a of NEW) for (const w of a.weapons) {
    const base = getGun(w), g = getGun(w, { [a.slot]: a.id });
    const bb = base.geometry.boundingBox, gb = g.geometry.boundingBox;
    const grow = Math.max(bb.min.x - gb.min.x, gb.max.x - bb.max.x, bb.min.y - gb.min.y, gb.max.y - bb.max.y, bb.min.z - gb.min.z, gb.max.z - bb.max.z);
    assert.ok(grow < 0.8, `${a.id} on ${w} sticks ${grow.toFixed(2)} m past the gun`);
    if (!a.look) continue;
    // A look is one of the gun's own parts for that slot, so it lands where that part lands.
    for (const [slot, id] of Object.entries(a.look)) assert.equal(ATTACHMENTS[id]?.slot, slot, `${a.id} look ${id} is a ${slot} part`);
    const same = base.geometry.attributes.position.count === g.geometry.attributes.position.count
      && base.geometry.attributes.position.array.every((v, i) => v === g.geometry.attributes.position.array[i]);
    assert.ok(!same, `${a.id} on ${w} changes the model`);
    assert.deepEqual(modelKit({ [a.slot]: a.id }), a.look, `${a.id} is drawn as its look`);
    assert.ok(g.muzzle.every(Number.isFinite));
    drawn++;
  }
  assert.ok(drawn >= 60, `${drawn} with a visible model change`);
});

/* ---------------- Wire, saves, unlocks, bots ---------------- */

test('wire: old kit ints unchanged, every new kit survives, an older build sees stock for a new part', () => {
  assert.equal(packKit({ optic: 'reflex', barrel: 'shroud', mag: 'apmag', grip: 'heavystock' }), 30673);
  assert.equal(packKit({ optic: 'reticle', barrel: 'suppressor', mag: 'extmag', grip: 'angled' }), 4376);
  for (const w of WEAPON_IDS) {
    const kit = {};
    for (const slot of SLOTS) { const own = availableFor(w, slot).filter(a => a.kind); if (own.length) kit[slot] = own.at(-1).id; }
    const n = packKit(kit);
    assert.ok(Number.isSafeInteger(n));
    assert.deepEqual(unpackKit(w, n), normalizeKit(w, kit), `${w} round-trips`);
    // What a pre-V11 build decodes: only the low 16 bits, 4 a slot. A V11 part reads as stock, never as another part.
    for (let i = 0; i < SLOTS.length; i++) {
      if (!kit[SLOTS[i]]) continue;
      const oldLen = Object.values(ATTACHMENTS).filter(a => a.slot === SLOTS[i] && !a.kind && !W2_ATTACHMENTS[a.id]).length, nib = (n % 65536 >>> (i * 4)) & 15;
      assert.ok(nib === 0 || nib > oldLen, `${w} ${SLOTS[i]}: an older build would read nibble ${nib} as an older part`);
    }
  }
  // A mixed kit: an old part in one slot, a new one in another.
  const mixed = { optic: 'reflex', barrel: 's_trueline', mag: 'extmag', grip: 'k_triburst' };
  assert.deepEqual(unpackKit('ar', packKit(mixed)), normalizeKit('ar', mixed));
});

const OLD_CODE = 'SY4.WzQsIk9sZCBIYW5kIiw4MTUzNiw0MDAwMDAsMCw1MCwwLFtbImFyIiwxMjEyMiwzMCwwLDQyMCw3MCwzMSw0NCwzMDAsWyJhc2giXSwiYXNoIiwibm9uZSIsIm5vbmUiLFs2MCwwLDAsMF0sMF0sWyJjcm9zc2JvdyIsNTAwMCwxNSwwLDEyLDAsMCwwLDAsW10sIm5vbmUiLCJub25lIiwibm9uZSIsWzAsMCwwLDBdLDBdXSxbWyJNYWluIiwiYXIiLCJzY2F0dGVyIix7ImFyIjp7Im9wdGljIjoicmVmbGV4IiwibWFnIjoiYXBtYWciLCJncmlwIjoiaGVhdnlzdG9jayJ9LCJzY2F0dGVyIjp7ImJhcnJlbCI6InN1cHByZXNzb3IifX0sWyJtYXJhdGhvbiIsInNjYXZlbmdlciIsInRyYWNrZXIiXSwic21va2UiLCJmcmFnIixbInVhdiIsInR1cnJldCIsImd1bnNoaXAiXSxudWxsXSxbIlJ1c2giLCJzbWciLCJwaXN0b2wiLHt9LFsibWFyYXRob24iLCJzY2F2ZW5nZXIiLCJ0cmFja2VyIl0sInNtb2tlIiwiZnJhZyIsWyJ1YXYiLCJ0dXJyZXQiLCJzdHJpa2UiXSxudWxsXSxbIkJyZWFjaCIsInNob3RndW4iLCJwaXN0b2wiLHt9LFsibWFyYXRob24iLCJzY2F2ZW5nZXIiLCJ0cmFja2VyIl0sInNtb2tlIiwiZnJhZyIsWyJ1YXYiLCJ0dXJyZXQiLCJzdHJpa2UiXSxudWxsXSxbIlN1cHByZXNzIiwibG1nIiwicGlzdG9sIix7fSxbIm1hcmF0aG9uIiwic2NhdmVuZ2VyIiwidHJhY2tlciJdLCJzbW9rZSIsImZyYWciLFsidWF2IiwidHVycmV0Iiwic3RyaWtlIl0sbnVsbF0sWyJPdmVyd2F0Y2giLCJzbmlwZXIiLCJwaXN0b2wiLHt9LFsibWFyYXRob24iLCJzY2F2ZW5nZXIiLCJ0cmFja2VyIl0sInNtb2tlIiwiZnJhZyIsWyJ1YXYiLCJ0dXJyZXQiLCJzdHJpa2UiXSxudWxsXV0sW10sW10sInlhcmQiLFtdLFtdLFtdLG51bGwsW11d.pd3bly';

test('SY4 codes: an old code with attachments loads; a save with signatures and kits round-trips', () => {
  const old = decodeSave(OLD_CODE);
  assert.ok(old.ok, old.error);
  assert.deepEqual(old.save.loadouts[0].attachments.ar, { optic: 'reflex', mag: 'apmag', grip: 'heavystock' });
  assert.deepEqual(old.save.loadouts[0].attachments.scatter, { barrel: 'suppressor' });
  const s = blankSave();
  s.name = 'Kitted';
  s.loadouts[0] = cleanLoadout({ ...s.loadouts[0], primary: 'dmr', secondary: 'maul',
    attachments: { dmr: { optic: 's_cheekpiece', grip: 'k_runaway', mag: 'extmag' }, maul: { barrel: 's_ironhead' }, shotgun: { barrel: 'k_slugbarrel' } } }, 0);
  const back = decodeSave(encodeSave(s));
  assert.ok(back.ok, back.error);
  assert.deepEqual(back.save.loadouts[0].attachments.dmr, { optic: 's_cheekpiece', mag: 'extmag', grip: 'k_runaway' });
  assert.deepEqual(back.save.loadouts[0].attachments.maul, { barrel: 's_ironhead' });
  assert.deepEqual(back.save.loadouts[0].attachments.shotgun, { barrel: 'k_slugbarrel' });
  assert.equal(encodeSave(back.save), encodeSave(s), 'and re-exports to the same code');
});

test('unlocks: levels and mastery tiers, at most two on one level of a gun, something new every few levels', () => {
  for (const a of NEW) assert.ok(a.unlock >= 2 && a.unlock <= LADDER_BASE + WEAPON_LADDER.length, `${a.id} unlock ${a.unlock}`);
  assert.ok(NEW.some(a => a.unlock > LADDER_BASE), 'some open on the mastery ladder');
  assert.equal(unlockLabel(31), 'Mastery I'); assert.equal(unlockLabel(12), 'Level 12');
  assert.ok(unlockMet(31, { peak: 30, ladT: 1 }) && !unlockMet(31, { peak: 30, ladT: 0 }) && unlockMet(12, { peak: 12 }));
  for (const w of WEAPON_IDS.filter(id => id !== GOLDEN_ID)) {
    const lv = trackFor(w).map(t => t.level);
    const at = {};
    for (const t of trackFor(w)) (at[t.level] ??= []).push(t.attachment);
    // Wave 2 shares levels with older parts: at most two a level, never two for one slot, never two wave 2 parts.
    for (const l in at) {
      assert.ok(at[l].length <= 2 && new Set(at[l].map(a => a.slot)).size === at[l].length, `${w}: level ${l} opens ${at[l].map(a => a.id)}`);
      assert.ok(at[l].filter(a => W2_ATTACHMENTS[a.id]).length <= 1, `${w}: two wave 2 parts on level ${l}`);
    }
    if (WEAPONS[w].melee) continue;
    const levels = [1, ...lv.filter(l => l <= LADDER_BASE), LADDER_BASE];
    const gap = Math.max(...levels.slice(1).map((l, i) => l - levels[i]));
    // Launchers take fewer parts in all; every other gun gets something new at least every six levels.
    assert.ok(gap <= (WEAPONS[w].category === 'Launcher' ? 7 : 6), `${w}: ${gap} levels without anything new (${lv})`);
    assert.ok(trackFor(w).some(t => t.attachment.kind), `${w} earns something of its own`);
  }
});

test('bots fit only parts their gun takes, more of the gun\'s own as skill rises', () => {
  let own = { recruit: 0, regular: 0, veteran: 0, elite: 0 };
  for (const w of WEAPON_IDS) for (const skill of Object.keys(own)) for (let i = 0; i < 3; i++) {
    const kit = botAttachments(w, skill, i);
    for (const slot in kit) {
      assert.ok(isAvailable(w, kit[slot]) && ATTACHMENTS[kit[slot]].slot === slot, `${w} ${skill} ${kit[slot]}`);
      if (ATTACHMENTS[kit[slot]].kind) own[skill]++;
    }
    assert.ok(Object.keys(kit).length <= { recruit: 1, regular: 2, veteran: 3, elite: 4 }[skill]);
  }
  assert.ok(own.recruit === 0 && own.regular < own.veteran && own.veteran < own.elite, JSON.stringify(own));
  assert.ok(KITS.every(k => [0, 1, 2].some(i => botAttachments(k.weapons[0], 'elite', i)[k.slot] === k.id)), 'elites run every kit');
});

// Battle royale floor loot (js/sim/br.js): class parts by rarity; a signature only on epic and legendary guns, a kit
// only on legendary; every part one the gun takes; the kit survives the BR wire.
const { BrRules } = await import('../js/sim/br.js');
test('battle royale loot: signatures on epic and legendary guns, kits only on legendary, all legal', () => {
  let a = 7;
  const rng = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
  const sig = [0, 0, 0, 0, 0], kit = [0, 0, 0, 0, 0], n = [0, 0, 0, 0, 0];
  for (let i = 0; i < 6000; i++) {
    const g = BrRules.prototype._rollGun.call({}, rng, i % 2 ? 'chest' : 1);
    const id = WEAPON_IDS[g.v];
    n[g.r]++;
    for (const slot in g.kit) {
      const att = ATTACHMENTS[g.kit[slot]];
      assert.ok(isAvailable(id, att.id) && att.slot === slot, `${id} ${att.id}`);
      if (att.kind === 'sig') sig[g.r]++;
      if (att.kind === 'kit') kit[g.r]++;
    }
    assert.deepEqual(unpackKit(id, packKit(g.kit)), g.kit);
  }
  assert.ok(sig[0] + sig[1] + sig[2] === 0 && sig[3] > n[3] * 0.2 && sig[4] > n[4] * 0.3, `signatures by rarity ${sig} of ${n}`);
  assert.ok(kit[0] + kit[1] + kit[2] + kit[3] === 0 && kit[4] > 0, `kits by rarity ${kit}`);
});

/* ---------------- Attachments wave 2 (js/shared/attachments-w2.js) ---------------- */

const W2 = Object.values(W2_ATTACHMENTS);
const W2_IDS = new Set(W2.map(a => a.id));
// What a gun could fit before wave 2: no wave 2 part, and the parts wave 2 opened to more classes only where they were.
const OPENED = new Map(W2_EXTEND.map(([id, more]) => [id, new Set(more)]));
const before = (w, a) => !W2_IDS.has(a.id) && !OPENED.get(a.id)?.has(w);
const GUNS = WEAPON_IDS.filter(id => id !== GOLDEN_ID && !WEAPONS[id].melee);
// Each W2 part on each gun that takes it, plus the classes an older part was opened to.
const W2_PAIRS = [...W2.flatMap(a => GUNS.filter(w => isAvailable(w, a.id)).map(w => [a, w])),
  ...W2_EXTEND.flatMap(([id, more]) => more.filter(w => isAvailable(w, id)).map(w => [ATTACHMENTS[id], w]))];

test('wave 2: sixteen general parts, appended after V11, plain trade-offs on MOD_INFO keys', () => {
  assert.equal(W2.length, 16);
  const ids = Object.keys(ATTACHMENTS);
  assert.deepEqual(ids.slice(-W2.length), W2.map(a => a.id), 'wave 2 is the tail of the table');
  for (const a of W2) {
    assert.ok(a.name && a.desc && a.for && SLOTS.includes(a.slot) && !a.kind && !a.set && !a.look, a.id);
    assert.ok(Number.isInteger(a.unlock) && a.unlock >= 2 && a.unlock <= 30, `${a.id} unlock ${a.unlock}`);
    for (const m of [a.mods, ...Object.values(a.perWeapon ?? {})]) for (const k of Object.keys(m)) {
      assert.ok(MOD_INFO[k] && !IDENTITY_MODS.has(k), `${a.id}.${k}`);
    }
    assert.ok(!a.weapons.includes(GOLDEN_ID) || !isAvailable(GOLDEN_ID, a.id));
    assert.ok(GUNS.filter(w => isAvailable(w, a.id)).length >= 2, `${a.id} fits more than one gun`);
    assert.ok(!GUNS.some(w => WEAPONS[w].melee && isAvailable(w, a.id)), `${a.id} stays off blades`);
  }
  // The names read differently from every older part.
  const names = Object.values(ATTACHMENTS).map(a => a.name);
  assert.equal(new Set(names).size, names.length, 'every part has its own name');
});

test('wave 2: every gun has about five to seven choices in each slot it uses', () => {
  const FEW = { scatter: { mag: 3 }, nailer: { mag: 4, barrel: 4 } };   // Shells, a nail strip and a nose: little to change.
  let grew = 0;
  for (const w of GUNS) for (const slot of SLOTS) {
    const all = availableFor(w, slot), old = all.filter(a => before(w, a));
    if (!all.length) continue;
    const min = FEW[w]?.[slot] ?? (WEAPONS[w].category === 'Launcher' ? 3 : 5);   // Launchers take fewer parts in all.
    assert.ok(all.length >= min && all.length <= 10, `${w} ${slot}: ${all.length} choices`);
    if (all.length > old.length) grew++;
  }
  assert.ok(grew >= 120, `${grew} gun slots gained a choice`);
  // The slots that were thinnest are the ones that grew.
  for (const [w, slot] of [['sniper', 'optic'], ['pistol', 'grip'], ['pistol', 'mag'], ['launcher', 'barrel'], ['shotgun', 'optic'], ['coach', 'mag']]) {
    assert.ok(availableFor(w, slot).length >= availableFor(w, slot).filter(a => before(w, a)).length + 2, `${w} ${slot} grew by two`);
  }
});

test('wave 2: no part moves a gun\'s kill ranges or spread far past its best older build', () => {
  // The best a gun can do with general parts, one per slot, before and after wave 2.
  const best = (w, read, dir, allow) => {
    let p = 1;
    for (const slot of SLOTS) {
      let m = 1;
      for (const a of availableFor(w, slot)) {
        if (a.kind || !allow(w, a)) continue;
        const v = read(applyAttachments(WEAPONS[w], { [slot]: a.id })) / read(WEAPONS[w]);
        if ((v - m) * dir > 0) m = v;
      }
      p *= m;
    }
    return p;
  };
  const any = () => true;
  for (const w of GUNS) {
    const reachOld = best(w, d => d.falloff.start, 1, before), reachNew = best(w, d => d.falloff.start, 1, any);
    assert.ok(reachNew <= reachOld * 1.06 + 1e-9, `${w}: full-damage reach x${reachOld.toFixed(3)} -> x${reachNew.toFixed(3)}`);
    // Every shots-to-kill breakpoint, aimed and to the body, holds within 6% of its old furthest distance.
    const kitOf = allow => Object.fromEntries(SLOTS.map(slot => {
      const opts = availableFor(w, slot).filter(a => !a.kind && allow(w, a));
      opts.sort((x, y) => applyAttachments(WEAPONS[w], { [slot]: y.id }).falloff.end - applyAttachments(WEAPONS[w], { [slot]: x.id }).falloff.end);
      return [slot, opts[0]?.id];
    }).filter(e => e[1]));
    const defOld = applyAttachments(WEAPONS[w], kitOf(before)), defNew = applyAttachments(WEAPONS[w], kitOf(any));
    const reach = (def, n) => { let r = 0; for (let d = 0.5; d <= def.range; d += 0.25) if (shotsToKill(def, d) <= n) r = d; return r; };
    for (let n = shotsToKill(WEAPONS[w], 1); n <= Math.min(12, shotsToKill(WEAPONS[w], 1) + 4); n++) {
      const o = reach(defOld, n), nw = reach(defNew, n);
      assert.ok(nw <= o * 1.06 + 0.5, `${w}: ${n} to kill reaches ${o} m before, ${nw} m now`);
    }
    for (const key of ['adsSpread', 'hipSpread']) {
      const o = best(w, d => d[key], -1, before), nw = best(w, d => d[key], -1, any);
      assert.ok(nw >= o * 0.8 - 1e-9, `${w}: best ${key} x${o.toFixed(3)} -> x${nw.toFixed(3)}`);
    }
  }
});

test('wave 2: every new part survives the wire and save codes; older builds read it as stock', () => {
  for (const [a, w] of W2_PAIRS) {
    const kit = { [a.slot]: a.id }, n = packKit(kit);
    assert.ok(Number.isSafeInteger(n));
    assert.deepEqual(unpackKit(w, n), normalizeKit(w, kit), `${a.id} on ${w}`);
    // An older build (V11: its slot list stops before wave 2) finds no part at that index.
    const i = SLOTS.indexOf(a.slot), v11Len = Object.values(ATTACHMENTS).filter(x => x.slot === a.slot && !W2_IDS.has(x.id)).length;
    const nib = (n % 65536 >>> (i * 4)) & 15, ext = Math.floor(n / 65536 / 2 ** (i * 7)) % 128;
    if (W2_IDS.has(a.id)) assert.ok((ext || nib) > v11Len, `${a.id}: index ${ext || nib} is past an older build's ${v11Len}`);
  }
  // A full wave 2 kit next to a signature, and an old kit int, unchanged.
  const mix = { optic: 'irons', barrel: 'muzzlebrake', mag: 's_stripper', grip: 'thumbrest' };
  assert.deepEqual(unpackKit('scout', packKit(mix)), normalizeKit('scout', mix));
  assert.equal(packKit({ optic: 'reflex', barrel: 'shroud', mag: 'apmag', grip: 'heavystock' }), 30673);
  const s = blankSave();
  s.loadouts[0] = cleanLoadout({ ...s.loadouts[0], primary: 'shotgun', secondary: 'launcher',
    attachments: { shotgun: { optic: 'laserbox', barrel: 'ventrib', mag: 'magnum', grip: 'rubber' }, launcher: { optic: 'rangefinder', barrel: 'guiderail', mag: 'lightrocket', grip: 'thumbrest' }, pistol: { grip: 'beavertail', mag: 'tapedmag' } } }, 0);
  const back = decodeSave(encodeSave(s));
  assert.ok(back.ok, back.error);
  assert.deepEqual(back.save.loadouts[0].attachments.shotgun, { optic: 'laserbox', barrel: 'ventrib', mag: 'magnum', grip: 'rubber' });
  assert.deepEqual(back.save.loadouts[0].attachments.launcher, { optic: 'rangefinder', barrel: 'guiderail', mag: 'lightrocket', grip: 'thumbrest' });
  assert.deepEqual(back.save.loadouts[0].attachments.pistol, { grip: 'beavertail', mag: 'tapedmag' });
  assert.equal(encodeSave(back.save), encodeSave(s));
  assert.ok(decodeSave(OLD_CODE).ok, 'the old code still loads');
});

test('wave 2: every new part has its own model piece on every gun that takes it, inside the gun\'s reach', () => {
  const geo = g => Object.keys(g.geometry.attributes).sort().map(n => `${n}:${g.geometry.attributes[n].array.join(',')}`).join('|');
  let n = 0;
  for (const [a, w] of W2_PAIRS) {
    const base = getGun(w), g = getGun(w, { [a.slot]: a.id });
    assert.equal(modelKit({ [a.slot]: a.id })[a.slot], a.id, `${a.id} draws itself, not a borrowed look`);
    const bb = base.geometry.boundingBox, gb = g.geometry.boundingBox;
    const grow = Math.max(bb.min.x - gb.min.x, gb.max.x - bb.max.x, bb.min.y - gb.min.y, gb.max.y - bb.max.y, bb.min.z - gb.min.z, gb.max.z - bb.max.z);
    assert.ok(grow < 0.5, `${a.id} on ${w} sticks ${grow.toFixed(2)} m past the gun`);
    assert.ok(g.muzzle.every(Number.isFinite) && g.fore.every(Number.isFinite) && g.length > 0.5, `${a.id} on ${w} hand points`);
    const mine = geo(g);
    assert.notEqual(mine, geo(base), `${a.id} on ${w} changes the model`);
    for (const o of availableFor(w, a.slot)) if (o.id !== a.id && !o.kind) assert.notEqual(geo(getGun(w, { [a.slot]: o.id })), mine, `${a.id} on ${w} looks like ${o.id}`);
    n++;
  }
  assert.ok(n >= 190, `${n} gun-part models`);
});

test('wave 2: unlocks spread over the levels; no gun goes more than four levels without a new part', () => {
  const levels = new Set(W2.map(a => a.unlock));
  assert.ok(levels.size >= 14, `${levels.size} distinct levels`);
  assert.ok(W2.some(a => a.unlock <= 7) && W2.some(a => a.unlock >= 25), 'early and late parts');
  for (const w of GUNS) {
    const lv = trackFor(w).map(t => t.level).filter(l => l <= LADDER_BASE);
    const gaps = [1, ...lv, LADDER_BASE].slice(1).map((l, i, arr) => l - ([1, ...lv][i]));
    assert.ok(Math.max(...gaps) <= (WEAPONS[w].category === 'Launcher' ? 5 : 4), `${w}: ${Math.max(...gaps)} levels without anything new (${lv})`);
  }
});

test('wave 2: bots and battle royale floor loot use every new part, only where it fits', () => {
  const seen = new Set();
  for (const w of WEAPON_IDS) for (const skill of ['regular', 'veteran', 'elite']) for (let i = 0; i < 15; i++) {
    const kit = botAttachments(w, skill, i);
    for (const slot in kit) { assert.ok(isAvailable(w, kit[slot])); if (W2_IDS.has(kit[slot]) || kit[slot] === 'tapedmag') seen.add(kit[slot]); }
  }
  for (const a of W2) assert.ok(seen.has(a.id), `no bot fits ${a.id}`);
  let r = 11;
  const rng = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const loot = new Set();
  for (let i = 0; i < 20000; i++) {
    const g = BrRules.prototype._rollGun.call({}, rng, i % 2 ? 'chest' : 2);
    const id = WEAPON_IDS[g.v];
    for (const slot in g.kit) { assert.ok(isAvailable(id, g.kit[slot])); loot.add(g.kit[slot]); }
    assert.deepEqual(unpackKit(id, packKit(g.kit)), g.kit);
  }
  const missing = W2.filter(a => !loot.has(a.id)).map(a => a.id);
  assert.equal(missing.length, 0, `never on the floor: ${missing}`);
});

console.log(`\n${passed} checks passed`);
