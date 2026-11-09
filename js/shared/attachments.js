// Weapon attachments: data, availability, unlock levels and the effective weapon def.
// Data only apart from a few pure functions. No DOM, no three, runs in node.
//
// A KIT is one weapon's fitted attachments: { optic?, barrel?, mag?, grip? } of attachment ids, at most one
// per slot. `loadout.attachments` holds kits per weapon, { ar: {optic:'reflex'}, pistol: {mag:'extmag'} }, so
// a player keeps their setup when they swap guns. A flat kit { optic:'reflex' } is accepted too and belongs to
// the loadout's primary. Always read through attachmentsFor(); unknown ids are dropped, so an old save or a
// peer on another build cannot break a match.
//
// Mods are multipliers on the stat of the same name in weapons.js, except:
//   suppressed  true: no firingT minimap reveal, muted muzzle/tracer visuals (`sup` on shot events)
//   range       scales `range` and falloff start/end together
//   patternAmp  scales pattern.amp
//   heatRounds  scales heat.rounds, rounded
//   heatCool    scales heat.coolTime
// `magazine` is rounded and always moves by at least one round. A mod on a stat the gun lacks (turnCap on the
// SMG) does nothing. damage and rpm are never modded: attachments change how a gun handles, not how it kills.
//
// weapons: allow-list of weapon ids (absent = every gun). perWeapon: mods replaced per weapon, merged over mods.
// unlock: the weapon level (1 to 30) that unlocks it. Level ties only happen between attachments that can never
// be on the same gun. Tracks by weapon come from trackFor(); the unlock order is ATTACHMENT_LIST.

export const SLOTS = ['optic', 'barrel', 'mag', 'grip'];

export const ATTACHMENTS = {
  // ---- Optic: precision against time to aim ----
  reflex: {
    id: 'reflex', slot: 'optic', name: 'Pinhole Reflex', unlock: 2,
    desc: 'Tighter aimed fire. Slower to aim.',
    weapons: ['ar', 'smg', 'shotgun', 'lmg', 'pistol'],
    mods: { adsSpread: 0.82, adsTime: 1.06 },
  },
  holo: {
    id: 'holo', slot: 'optic', name: 'Wideview Holo', unlock: 8,
    desc: 'Tighter hipfire, a touch quicker to aim. Looser aimed fire.',
    weapons: ['ar', 'smg', 'shotgun', 'lmg', 'pistol'],
    mods: { hipSpread: 0.88, adsTime: 0.96, adsSpread: 1.16 },
  },
  longeye: {
    id: 'longeye', slot: 'optic', name: 'Longeye 3x', unlock: 26,
    desc: 'Very tight aimed fire. Slow to aim, wide from the hip, slower while aimed, swings slower.',
    weapons: ['ar', 'lmg'],
    mods: { adsSpread: 0.68, adsTime: 1.22, hipSpread: 1.2, adsMoveMult: 0.92, turnCap: 0.88 },
  },
  snapsight: {
    id: 'snapsight', slot: 'optic', name: 'Snap Sight', unlock: 5,
    desc: 'Scope up much faster. One-shot range drops a lot and aimed fire is looser.',
    weapons: ['sniper'],
    mods: { adsTime: 0.72, sprintToFire: 0.9, range: 0.55, adsSpread: 3 },
  },

  // ---- Barrel: range against stealth, recoil and handling ----
  suppressor: {
    id: 'suppressor', slot: 'barrel', name: 'Hush Can', unlock: 18,
    desc: 'Firing stays off the enemy minimap and is harder to hear. Shorter range, slower to aim.',
    mods: { suppressed: true, range: 0.82, adsTime: 1.05, sprintToFire: 1.08 },
    perWeapon: {
      shotgun: { suppressed: true, range: 0.75, adsTime: 1.05, sprintToFire: 1.08 },
      pistol: { suppressed: true, range: 0.78, adsTime: 1.05, sprintToFire: 1.08 },
      // Sniper falloff begins past any real sightline, so its cost has to be much larger to exist at all.
      sniper: { suppressed: true, range: 0.5, adsTime: 1.1, sprintToFire: 1.08 },
    },
  },
  longbarrel: {
    id: 'longbarrel', slot: 'barrel', name: 'Longline Barrel', unlock: 5,
    desc: 'Damage holds further out. Wider from the hip, slower to aim and move.',
    weapons: ['ar', 'smg', 'lmg', 'pistol'],
    mods: { range: 1.2, hipSpread: 1.12, adsTime: 1.08, moveMult: 0.98 },
  },
  compensator: {
    id: 'compensator', slot: 'barrel', name: 'Kickstop Brake', unlock: 11,
    desc: 'Far less recoil sway and bloom. Wider from the hip, slower out of a sprint.',
    weapons: ['ar', 'smg', 'lmg', 'pistol'],
    mods: { patternAmp: 0.72, bloomPerShot: 0.82, hipSpread: 1.1, sprintToFire: 1.12 },
  },
  heatsink: {
    id: 'heatsink', slot: 'barrel', name: 'Radiator Jacket', unlock: 30,
    desc: 'Half again as many rounds before overheating. Slower to aim, swings even slower.',
    weapons: ['lmg'],
    mods: { heatRounds: 1.5, adsTime: 1.22, turnCap: 0.85, sprintToFire: 1.1 },
  },
  choke: {
    id: 'choke', slot: 'barrel', name: 'Tight Choke', unlock: 5,
    desc: 'A narrower pellet fan. Slower to aim and to bring up.',
    weapons: ['shotgun'],
    mods: { adsSpread: 0.7, hipSpread: 0.85, adsTime: 1.12, swapTime: 1.12 },
  },
  sawnoff: {
    id: 'sawnoff', slot: 'barrel', name: 'Sawn Barrel', unlock: 11,
    desc: 'Quicker to aim and to move. A wider fan that drops off sooner.',
    weapons: ['shotgun'],
    mods: { adsTime: 0.85, moveMult: 1.04, hipSpread: 1.25, adsSpread: 1.2, range: 0.8 },
  },
  fluted: {
    id: 'fluted', slot: 'barrel', name: 'Fluted Barrel', unlock: 11,
    desc: 'Lighter: faster to scope, swap and move. One-shot range drops a lot.',
    weapons: ['sniper'],
    mods: { adsTime: 0.86, swapTime: 0.9, moveMult: 1.03, range: 0.5 },
  },

  // ---- Mag: capacity against reload and weight ----
  extmag: {
    id: 'extmag', slot: 'mag', name: 'Deep Mag', unlock: 3,
    desc: 'A third more rounds. Slower reload, slower to aim, a little slower on foot.',
    mods: { magazine: 1.33, reload: 1.18, adsTime: 1.06, moveMult: 0.98 },
    perWeapon: {
      lmg: { magazine: 1.3, reload: 1.12, adsTime: 1.06, moveMult: 0.97 },
      sniper: { magazine: 1.4, reload: 1.18, adsTime: 1.06, moveMult: 0.98 },
      shotgun: { magazine: 1.29, reload: 1.18, adsTime: 1.06, moveMult: 0.98 },
    },
  },
  speedmag: {
    id: 'speedmag', slot: 'mag', name: 'Speed Mag', unlock: 9,
    desc: 'Reloads much faster. Fewer rounds.',
    mods: { reload: 0.72, magazine: 0.8 },
  },
  lightmag: {
    id: 'lightmag', slot: 'mag', name: 'Feather Mag', unlock: 15,
    desc: 'Lighter on the move and quicker to aim. Fewer rounds.',
    mods: { moveMult: 1.03, adsTime: 0.94, magazine: 0.87 },
  },

  // ---- Grip: speed against steadiness ----
  angled: {
    id: 'angled', slot: 'grip', name: 'Angled Grip', unlock: 6,
    desc: 'Aims much faster. More recoil and bloom, slower out of a sprint.',
    weapons: ['ar', 'smg', 'lmg', 'shotgun', 'sniper'],
    mods: { adsTime: 0.85, patternAmp: 1.15, bloomPerShot: 1.12, sprintToFire: 1.08 },
  },
  vertical: {
    id: 'vertical', slot: 'grip', name: 'Vertical Foregrip', unlock: 13,
    desc: 'Steadier under sustained fire. Slower to aim, slower out of a sprint.',
    weapons: ['ar', 'smg', 'lmg', 'shotgun'],
    mods: { patternAmp: 0.75, bloomPerShot: 0.88, adsTime: 1.1, sprintToFire: 1.08 },
  },
  wrap: {
    id: 'wrap', slot: 'grip', name: 'Slick Wrap', unlock: 20,
    desc: 'Fires sooner after a sprint and swaps faster. Looser aimed fire, slower while aimed, more recoil.',
    mods: { sprintToFire: 0.78, swapTime: 0.82, adsSpread: 1.1, adsMoveMult: 0.92, patternAmp: 1.1 },
  },
  brace: {
    id: 'brace', slot: 'grip', name: 'Swing Brace', unlock: 23,
    desc: 'Heavy guns swing faster and move better while aimed. Looser fire, slower on foot.',
    weapons: ['ar', 'lmg', 'sniper', 'shotgun'],
    mods: { turnCap: 1.35, adsMoveMult: 1.1, hipSpread: 1.1, adsSpread: 1.14, moveMult: 0.97 },
  },
};

// Every attachment in level-track order. Stable table order breaks ties.
export const ATTACHMENT_LIST = Object.values(ATTACHMENTS).sort((a, b) => a.unlock - b.unlock);

// What each mod key means, for gunsmith UI and tests. better: 1 means a higher multiplier helps the player, -1 lower.
export const MOD_INFO = {
  adsSpread:    { label: 'Aimed spread',       better: -1 },
  hipSpread:    { label: 'Hip spread',         better: -1 },
  bloomPerShot: { label: 'Bloom per shot',     better: -1 },
  patternAmp:   { label: 'Recoil sway',        better: -1 },
  adsTime:      { label: 'Time to aim',        better: -1 },
  sprintToFire: { label: 'Sprint to fire',     better: -1 },
  swapTime:     { label: 'Swap time',          better: -1 },
  reload:       { label: 'Reload',             better: -1 },
  heatCool:     { label: 'Cooling time',       better: -1 },
  magazine:     { label: 'Magazine',           better: 1 },
  range:        { label: 'Range',              better: 1 },
  moveMult:     { label: 'Move speed',         better: 1 },
  adsMoveMult:  { label: 'Move speed aimed',   better: 1 },
  turnCap:      { label: 'Swing speed',        better: 1 },
  heatRounds:   { label: 'Rounds to overheat', better: 1 },
};

const SLOT_IDS = SLOTS.map(slot => Object.values(ATTACHMENTS).filter(a => a.slot === slot).map(a => a.id));
const KIT_BITS = 4;     // Per slot in packKit: room for 15 options a slot.

export const NO_ATTACHMENTS = Object.freeze({});

export function isAvailable(weaponId, attachmentId) {
  const a = ATTACHMENTS[attachmentId];
  return !!a && (!a.weapons || a.weapons.includes(weaponId));
}

// Attachments this gun can use, in unlock order; only one slot's when `slot` is given.
export function availableFor(weaponId, slot) {
  return ATTACHMENT_LIST.filter(a => (!slot || a.slot === slot) && isAvailable(weaponId, a.id));
}

// The mods that really apply to this gun, after any perWeapon replacement.
export function modsFor(weaponId, attachmentId) {
  const a = ATTACHMENTS[attachmentId];
  return (a && a.perWeapon && a.perWeapon[weaponId]) || (a && a.mods) || {};
}

// Weapon level that unlocks this attachment on this gun, or null if the gun cannot take it.
export function unlockFor(weaponId, attachmentId) {
  return isAvailable(weaponId, attachmentId) ? ATTACHMENTS[attachmentId].unlock : null;
}

// This gun's level track: [{level, attachment}] ascending, within 1 to 30.
export function trackFor(weaponId) {
  return availableFor(weaponId).map(attachment => ({ level: attachment.unlock, attachment }));
}

function keyOfKit(kit) {
  let key = '';
  for (let i = 0; i < SLOTS.length; i++) {
    const id = kit[SLOTS[i]];
    key += (i ? '|' : '') + (id || '');
  }
  return key;
}

const CANON = new Map();  // weaponId|key -> frozen kit, so equal kits are one object (geometry caches rely on it).

// Validates a raw kit for one gun: unknown ids, wrong-slot ids and ids the gun cannot take are dropped.
// Returns a frozen kit, the same object for equal kits. Accepts null/garbage.
export function normalizeKit(weaponId, raw) {
  if (!raw || typeof raw !== 'object') return NO_ATTACHMENTS;
  let key = '';
  for (let i = 0; i < SLOTS.length; i++) {
    const slot = SLOTS[i], id = raw[slot];
    const ok = typeof id === 'string' && ATTACHMENTS[id] && ATTACHMENTS[id].slot === slot && isAvailable(weaponId, id);
    key += (i ? '|' : '') + (ok ? id : '');
  }
  if (key === '|||') return NO_ATTACHMENTS;
  const memoKey = weaponId + ':' + key;
  let kit = CANON.get(memoKey);
  if (!kit) {
    const parts = key.split('|');
    const obj = {};
    for (let i = 0; i < SLOTS.length; i++) if (parts[i]) obj[SLOTS[i]] = parts[i];
    kit = Object.freeze(obj);
    CANON.set(memoKey, kit);
  }
  return kit;
}

// The normalized kit a loadout has fitted to a gun. Reads both the per-weapon and the flat form.
export function attachmentsFor(loadout, weaponId) {
  const a = loadout && loadout.attachments;
  if (!a || typeof a !== 'object') return NO_ATTACHMENTS;
  const own = a[weaponId];
  if (own && typeof own === 'object') return normalizeKit(weaponId, own);
  for (let i = 0; i < SLOTS.length; i++) {
    if (typeof a[SLOTS[i]] === 'string') return loadout.primary === weaponId ? normalizeKit(weaponId, a) : NO_ATTACHMENTS;
  }
  return NO_ATTACHMENTS;
}

// Stable string for a normalized kit, for variant caches. '' for no attachments.
export function kitKey(kit) {
  const k = keyOfKit(kit || NO_ATTACHMENTS);
  return k === '|||' ? '' : k;
}

// Kit to/from one small int, for the snapshot's meta block.
export function packKit(kit) {
  let n = 0;
  for (let i = 0; i < SLOTS.length; i++) n |= (SLOT_IDS[i].indexOf(kit[SLOTS[i]]) + 1) << (i * KIT_BITS);
  return n;
}

export function unpackKit(weaponId, n) {
  const obj = {};
  for (let i = 0; i < SLOTS.length; i++) {
    const id = SLOT_IDS[i][((n >>> (i * KIT_BITS)) & ((1 << KIT_BITS) - 1)) - 1];
    if (id) obj[SLOTS[i]] = id;
  }
  return normalizeKit(weaponId, obj);
}

function scaled(v, k) { return v * k; }

function scaledRounds(v, k) {
  const n = Math.round(v * k);
  if (k > 1) return Math.max(n, v + 1);
  if (k < 1) return Math.max(1, Math.min(n, v - 1));
  return n;
}

function applyMods(eff, m) {
  for (const key in m) {
    const k = m[key];
    switch (key) {
      case 'suppressed': eff.suppressed = !!k; break;
      case 'range':
        eff.range = scaled(eff.range, k);
        eff.falloff = { ...eff.falloff, start: scaled(eff.falloff.start, k), end: scaled(eff.falloff.end, k) };
        break;
      case 'patternAmp': if (eff.pattern) eff.pattern = { ...eff.pattern, amp: scaled(eff.pattern.amp, k) }; break;
      case 'heatRounds': if (eff.heat) eff.heat = { ...eff.heat, rounds: scaledRounds(eff.heat.rounds, k) }; break;
      case 'heatCool': if (eff.heat) eff.heat = { ...eff.heat, coolTime: scaled(eff.heat.coolTime, k) }; break;
      case 'magazine': eff.magazine = scaledRounds(eff.magazine, k); break;
      default: if (typeof eff[key] === 'number') eff[key] = scaled(eff[key], k);
    }
  }
}

const EFFECTIVE = new WeakMap();  // base def -> Map(key -> effective def)

// The stats a gun really has with `attachments` on (a raw or normalized kit). Memoised: equal kits on the same
// base def return the same frozen object, and an empty kit returns the base def itself, so stat reads and
// identity checks stay cheap. Damage and fire rate are never touched.
export function applyAttachments(weaponDef, attachments) {
  const kit = normalizeKit(weaponDef.id, attachments);
  if (kit === NO_ATTACHMENTS) return weaponDef;
  let byKey = EFFECTIVE.get(weaponDef);
  if (!byKey) { byKey = new Map(); EFFECTIVE.set(weaponDef, byKey); }
  const key = keyOfKit(kit);
  let eff = byKey.get(key);
  if (!eff) {
    eff = { ...weaponDef, kit };
    for (let i = 0; i < SLOTS.length; i++) {
      const id = kit[SLOTS[i]];
      if (id) applyMods(eff, modsFor(weaponDef.id, id));
    }
    Object.freeze(eff);
    byKey.set(key, eff);
  }
  return eff;
}
