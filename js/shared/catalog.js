// Everything a loadout can contain. Adding an item is one line of data here plus its behaviour in the sim.

export const SCORE = { kill: 100, headshot: 25, assist: 50, confirm: 50, deny: 25, capture: 100, defend: 50, holdTick: 10 };

// `air` streaks count against the airspace limit. `limit` is how many of that streak one team may have up at once.
// `role` is display information only: 'intel', 'offense', 'support' or 'denial'.
// Costs are set against measured bot matches, with score resetting on death.
export const STREAKS = {
  uav:       { id: 'uav',       name: 'UAV',          cost: 500,  air: true,  limit: 1, role: 'intel',   desc: 'Reveals enemies on the minimap for 20 s' },
  jammer:    { id: 'jammer',    name: 'Jammer',       cost: 600,  air: true,  limit: 1, role: 'denial',  desc: 'Blanks the enemy minimap and UAV for 15 s' },
  resupply:  { id: 'resupply',  name: 'Supply Drop',  cost: 750,  air: false, limit: 0, role: 'support', desc: 'Heals and re-arms everyone on your team near you' },
  turret:    { id: 'turret',    name: 'Sentry',       cost: 900,  air: false, limit: 2, role: 'offense', desc: 'Automated gun at your position' },
  mortar:    { id: 'mortar',    name: 'Mortar Team',  cost: 1100,  air: false, limit: 1, role: 'offense', desc: 'Five shells on enemies your team can see' },
  strike:    { id: 'strike',    name: 'Airstrike',    cost: 1300, air: true,  limit: 1, role: 'offense', desc: 'Line of explosions on the enemy' },
  overwatch: { id: 'overwatch', name: 'Overwatch',    cost: 1450, air: true,  limit: 1, role: 'intel',   desc: 'Advanced UAV for 25 s. Reveals Ghost too' },
  chopper:   { id: 'chopper',   name: 'Attack Chopper', cost: 1600, air: true, limit: 1, role: 'offense', desc: 'Flies low and hunts enemies your team can see' },
  emp:       { id: 'emp',       name: 'EMP',          cost: 1800, air: false, limit: 0, role: 'denial',  desc: 'Knocks out enemy air, sentries and radar' },
  gunship:   { id: 'gunship',   name: 'Gunship',      cost: 2200, air: true,  limit: 1, role: 'offense', desc: 'Circles the map, firing on visible enemies' },
};
export const STREAK_IDS = Object.keys(STREAKS);

// What a tile says when its streak is held but cannot be called right now. Slot `denied` and streak_denied `reason`.
export const STREAK_DENY_REASONS = ['limit', 'airspace', 'no_target'];
export const STREAK_DENY_TEXT = { limit: 'Already up', airspace: 'Airspace full', no_target: 'No target' };

export const TACTICALS = {
  smoke:  { id: 'smoke',  name: 'Smoke',  count: 2, desc: 'Cloud that blocks line of sight' },
  flash:  { id: 'flash',  name: 'Flash',  count: 2, desc: 'Blinds enemies in the blast' },
  stim:   { id: 'stim',   name: 'Stim',   count: 1, desc: 'Instant heal' },
  decoy:  { id: 'decoy',  name: 'Decoy',  count: 1, desc: 'Fakes gunfire where it lands' },
  sensor: { id: 'sensor', name: 'Sensor', count: 1, desc: 'Marks enemies near it, through walls' },
  trophy: { id: 'trophy', name: 'Trophy', count: 1, desc: 'Shoots down enemy grenades near it' },
};
export const LETHALS = {
  frag:    { id: 'frag',    name: 'Frag',     count: 2, desc: 'Bounces, explodes after a fuse' },
  sticky:  { id: 'sticky',  name: 'Sticky',   count: 1, desc: 'Sticks where it lands, short fuse' },
  molotov: { id: 'molotov', name: 'Molotov',  count: 1, desc: 'Burning ground that denies an area' },
  mine:    { id: 'mine',    name: 'Mine',     count: 1, desc: 'Sits still, goes off when an enemy comes close' },
  cluster: { id: 'cluster', name: 'Cluster',  count: 1, desc: 'Bursts, then scatters small bomblets' },
  hatchet: { id: 'hatchet', name: 'Hatchet',  count: 1, desc: 'Direct hit kills. Sticks where it lands' },
};

// One pick per tier: `perks: [tier0, tier1, tier2]`.
export const PERK_TIERS = ['Body', 'Hands', 'Senses'];
export const PERKS = {
  marathon:    { id: 'marathon',    tier: 0, name: 'Marathon',     desc: 'Faster sprint, quicker slide recharge' },
  flak:        { id: 'flak',        tier: 0, name: 'Flak',         desc: 'Take less explosive damage' },
  quickmend:   { id: 'quickmend',   tier: 0, name: 'Quick Mend',   desc: 'Health starts to recover sooner, and faster' },
  tacmask:     { id: 'tacmask',     tier: 0, name: 'Tac Mask',     desc: 'Flashes wear off fast, fire hurts half as much' },
  adrenaline:  { id: 'adrenaline',  tier: 0, name: 'Adrenaline',   desc: 'A gun kill restores 40 health' },

  scavenger:   { id: 'scavenger',   tier: 1, name: 'Scavenger',    desc: 'Refill ammo reserve from kills' },
  fasthands:   { id: 'fasthands',   tier: 1, name: 'Fast Hands',   desc: 'Faster swaps and reloads' },
  strongarm:   { id: 'strongarm',   tier: 1, name: 'Strong Arm',   desc: 'Throw equipment much further' },
  bandolier:   { id: 'bandolier',   tier: 1, name: 'Bandolier',    desc: 'One extra tactical and one extra lethal' },
  hardline:    { id: 'hardline',    tier: 1, name: 'Hardline',     desc: 'Scorestreaks cost 15% less' },

  ghost:       { id: 'ghost',       tier: 2, name: 'Ghost',        desc: 'Hidden from enemy UAV' },
  coldblood:   { id: 'coldblood',   tier: 2, name: 'Cold Blooded', desc: 'Sentries, aircraft, mortars and mines ignore you until you are close' },
  deadsilence: { id: 'deadsilence', tier: 2, name: 'Dead Silence', desc: 'Your footsteps make no sound' },
  tracker:     { id: 'tracker',     tier: 2, name: 'Tracker',      desc: 'Enemies you hit stay on your team\'s minimap for 4 s' },
  engineer:    { id: 'engineer',    tier: 2, name: 'Engineer',     desc: 'Your sentries, aircraft and Trophy last longer' },
};
export const PERK_IDS = Object.keys(PERKS);
export const HARDLINE_MULT = 0.85;

// A streak's cost for a player, as a whole multiple of 10. Hardline lowers it.
export function streakCost(id, perks) {
  const base = STREAKS[id].cost;
  return perks && perks.includes('hardline') ? Math.round(base * HARDLINE_MULT / 10) * 10 : base;
}

export const DEFAULT_LOADOUT = Object.freeze({
  primary: 'ar', camo: 'none', secondary: 'pistol', attachments: {},
  perks: ['marathon', 'scavenger', 'tracker'], tactical: 'smoke', lethal: 'frag',
  streaks: ['uav', 'turret', 'gunship'],
});

// A tier-preserving perk gate for progression: a pick not yet unlocked (`has(id)` false) falls back to the first
// tier default the player does have, so a level 1 loadout is still full.
export function gatePerks(perks, has) {
  return pickPerks(perks).map((id, tier) => {
    if (has(id)) return id;
    return [DEFAULT_LOADOUT.perks[tier], ...PERK_IDS.filter(p => PERKS[p].tier === tier)].find(has) ?? id;
  });
}

// One perk per tier. Takes either the three-tier form or an old two-perk save: each id lands in its own tier,
// the first pick for a tier wins, and the defaults fill whatever is left.
function pickPerks(list) {
  const out = [null, null, null];
  for (const id of Array.isArray(list) ? list : []) {
    const p = PERKS[id];
    if (p && out[p.tier] === null) out[p.tier] = id;
  }
  for (let t = 0; t < 3; t++) if (out[t] === null) out[t] = DEFAULT_LOADOUT.perks[t];
  return out;
}

// Fills gaps and removes unknown ids, so old saves and peers on another version cannot break a match.
export function normalizeLoadout(l = {}) {
  const d = DEFAULT_LOADOUT;
  const pick = (table, list, n, dflt) => {
    const out = [...new Set((list || []).filter(id => table[id]))].slice(0, n);
    for (const id of dflt) if (out.length < n && !out.includes(id)) out.push(id);
    return out;
  };
  return {
    primary: l.primary || d.primary,
    camo: l.camo || d.camo,
    secondary: l.secondary || d.secondary,
    attachments: l.attachments && typeof l.attachments === 'object' ? l.attachments : {},
    perks: pickPerks(l.perks),
    tactical: TACTICALS[l.tactical] ? l.tactical : d.tactical,
    lethal: LETHALS[l.lethal] ? l.lethal : d.lethal,
    streaks: pick(STREAKS, l.streaks, 3, d.streaks).sort((a, b) => STREAKS[a].cost - STREAKS[b].cost),
    tracer: l.tracer || null,
    killFx: l.killFx || null,
    operator: l.operator || null,
  };
}
