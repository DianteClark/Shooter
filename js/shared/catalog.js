// Everything a loadout can contain. Adding an item is one line of data here plus its behaviour in the sim.

export const SCORE = { kill: 100, headshot: 25, assist: 50, confirm: 50, deny: 25, capture: 100, defend: 50, holdTick: 10 };

// `air` streaks count against the airspace limit. `limit` is how many of that streak one team may have up at once.
// `role` is display information only: 'intel', 'offense', 'support' or 'denial'.
// Costs are set against measured bot matches with score persisting through death (Wave 6): a good player earns about
// one mid-list streak a match (turret to overwatch), the top of the list rarely. See the earn-rate test in the report.
export const STREAKS = {
  uav:       { id: 'uav',       name: 'UAV',          cost: 1000, air: true,  limit: 1, role: 'intel',   desc: 'Reveals enemies on the minimap for 20 s' },
  jammer:    { id: 'jammer',    name: 'Jammer',       cost: 1200, air: true,  limit: 1, role: 'denial',  desc: 'Blanks the enemy minimap and UAV for 15 s' },
  resupply:  { id: 'resupply',  name: 'Supply Drop',  cost: 1500, air: false, limit: 0, role: 'support', desc: 'Heals and re-arms everyone on your team near you' },
  turret:    { id: 'turret',    name: 'Sentry',       cost: 2100, air: false, limit: 2, role: 'offense', desc: 'Automated gun at your position' },
  mortar:    { id: 'mortar',    name: 'Mortar Team',  cost: 2500, air: false, limit: 1, role: 'offense', desc: 'Five shells on enemies your team can see' },
  strike:    { id: 'strike',    name: 'Airstrike',    cost: 2800, air: true,  limit: 1, role: 'offense', desc: 'Line of explosions on the enemy' },
  overwatch: { id: 'overwatch', name: 'Overwatch',    cost: 3100, air: true,  limit: 1, role: 'intel',   desc: 'Advanced UAV for 25 s. Reveals Ghost too' },
  chopper:   { id: 'chopper',   name: 'Attack Chopper', cost: 3600, air: true, limit: 1, role: 'offense', desc: 'Flies low and hunts enemies your team can see' },
  emp:       { id: 'emp',       name: 'EMP',          cost: 4100, air: false, limit: 0, role: 'denial',  desc: 'Knocks out enemy air, sentries and radar' },
  gunship:   { id: 'gunship',   name: 'Gunship',      cost: 4800, air: true,  limit: 1, role: 'offense', desc: 'Circles the map, firing on visible enemies' },
  // V8. Wire ids are STREAK_IDS order (4 bits in the loadout ints): new ones only ever go on the end.
  missile:   { id: 'missile',   name: 'Cruise Missile', cost: 1800, air: true, limit: 1, role: 'offense', desc: 'Steer it with the aim stick for a few seconds, then boom' },
  swarm:     { id: 'swarm',     name: 'Drone Swarm',  cost: 3300, air: true,  limit: 1, role: 'offense', desc: 'Three drones that dive on enemies your team can see' },
  juggernaut: { id: 'juggernaut', name: 'Juggernaut', cost: 4400, air: false, limit: 0, role: 'support', armor: 300, desc: '300 armour over your health until you die' },
};
export const STREAK_IDS = Object.keys(STREAKS);

// What a tile says when its streak is held but cannot be called right now. Slot `denied` and streak_denied `reason`.
export const STREAK_DENY_REASONS = ['limit', 'airspace', 'no_target'];
export const STREAK_DENY_TEXT = { limit: 'Already up', airspace: 'Airspace full', no_target: 'No target' };

// Equipment. Ids are on the wire and in saves by position (js/sim/sim.js TACTICAL_IDS, LETHAL_IDS, 4 bits each): never
// reorder, only append, at most 16 per slot. `job` is the one-line role the loadout shows; `counter` is what beats it
// (Help lists both). Behaviour lives in js/sim/equipment.js under the same id.
export const TACTICALS = {
  smoke:  { id: 'smoke',  name: 'Smoke',  count: 2, job: 'Cover a crossing', counter: 'Snapshot, Sensor and Tagger see through it', desc: 'Cloud that blocks line of sight for 9 s' },
  flash:  { id: 'flash',  name: 'Flash',  count: 2, job: 'Blind, then push', counter: 'Tac Mask; a wall between you and it', desc: 'Whites out the screens of enemies who can see it go off' },
  stim:   { id: 'stim',   name: 'Stim',   count: 1, job: 'Win the next fight', counter: 'Burst damage before they use it', desc: 'Instant full heal' },
  decoy:  { id: 'decoy',  name: 'Decoy',  count: 1, job: 'Fake a flank', counter: 'Shoot it; it never moves', desc: 'Fakes gunfire where it lands, on enemy minimaps too' },
  sensor: { id: 'sensor', name: 'Sensor', count: 1, job: 'Watch a lane', counter: 'Shoot it, Shock or Blackout; Cold Blooded', desc: 'Planted: pings enemies within 10 m every 2.5 s, through walls' },
  trophy: { id: 'trophy', name: 'Trophy', count: 1, job: 'Stop grenades', counter: 'Shoot it, Shock or Blackout; throw three', desc: 'Shoots down three enemy grenades and devices near it' },
  // V8 equipment.
  stun:   { id: 'stun',   name: 'Stun',   count: 2, job: 'Slow a defender', counter: 'Tac Mask; a wall', desc: 'Slows movement and turning of enemies in the blast' },
  gas:    { id: 'gas',    name: 'Gas',    count: 1, job: 'Flush a camper', counter: 'Tac Mask ignores it; walk out', desc: 'Lingering cloud that slows and chips enemies' },
  shock:  { id: 'shock',  name: 'Shock',  count: 1, job: 'Clear devices', counter: 'Shoot it; Tac Mask; stay out of reach', desc: 'Sticks and arcs three times: jolts enemies, fries their devices' },
  // Gear wave (2026-11). Appended: old ids keep their wire numbers.
  snapshot: { id: 'snapshot', name: 'Snapshot', count: 1, job: 'Instant recon', counter: 'Cold Blooded halves it, Blank Slate ignores it', desc: 'Pops on landing: shows every enemy within 12 m through walls for 3 s' },
  blackout: { id: 'blackout', name: 'Blackout', count: 1, job: 'Shut down kit', counter: 'Engineer is immune; stay out of the 7 m', desc: 'EMP burst: enemies in it lose equipment and minimap for 6 s, devices die' },
  bulwark:  { id: 'bulwark',  name: 'Bulwark',  count: 1, job: 'Instant cover', counter: 'Explosives wreck it; two magazines break it; flank', desc: 'Waist-high shield where it lands. Shoot over it. Lasts 25 s' },
  tagger:   { id: 'tagger',   name: 'Tagger',   count: 1, job: 'Track one target', counter: 'Blank Slate ignores it, Cold Blooded halves it', desc: 'Dart that sticks to an enemy and shows them to your team for 8 s' },
  medpack:  { id: 'medpack',  name: 'Medpack',  count: 1, job: 'Heal the squad', counter: 'Shoot it, Shock or Blackout', desc: 'Heals you and teammates within 3.5 m for 15 s' },
};
export const LETHALS = {
  frag:    { id: 'frag',    name: 'Frag',     count: 2, job: 'Clear a room', counter: 'Flak; Trophy; run when it lands', desc: 'Bounces off walls, explodes after a 1.8 s fuse' },
  sticky:  { id: 'sticky',  name: 'Sticky',   count: 1, job: 'Stick a target', counter: 'Flak survives it; Trophy', desc: 'Sticks to walls and to enemies it hits. Short fuse' },
  molotov: { id: 'molotov', name: 'Molotov',  count: 1, job: 'Burn a wide area', counter: 'Tac Mask halves the burn; wait 5 s', desc: 'Bursts into a wide pool of fire for 5 s' },
  mine:    { id: 'mine',    name: 'Mine',     count: 1, job: 'Guard a spot', counter: 'Shoot it; Cold Blooded; Shock', desc: 'Goes off when an enemy comes within 2.4 m, any direction' },
  cluster: { id: 'cluster', name: 'Cluster',  count: 1, job: 'Saturate an area', counter: 'Flak; Trophy; keep moving', desc: 'Bursts, then scatters four bomblets around it' },
  hatchet: { id: 'hatchet', name: 'Hatchet',  count: 1, job: 'One-hit kill', counter: 'Strafe; it is slow to arrive', desc: 'Direct hit kills anywhere. Arcs, sticks where it lands' },
  // V8 equipment.
  impact:   { id: 'impact',   name: 'Impact',   count: 1, job: 'No fuse to run from', counter: 'Flak; Trophy; cover', desc: 'Goes off the instant it touches anything' },
  claymore: { id: 'claymore', name: 'Claymore', count: 1, job: 'Lock a doorway', counter: 'Its laser cone is visible: go around or shoot it', desc: 'Faces where you throw it. Fires a cone at enemies who walk into it' },
  drill:    { id: 'drill',    name: 'Drill',    count: 1, job: 'Through cover', counter: 'Flak; move off the wall it bites', desc: 'Bores through a thin wall and blows on the far side' },
  // Gear wave (2026-11). Appended: old ids keep their wire numbers.
  charge:   { id: 'charge',   name: 'Satchel',  count: 1, job: 'Remote blast', counter: 'Shoot it, Shock or Blackout; kill the owner', desc: 'Sticks where it lands. Tap Lethal again to set it off' },
  thermite: { id: 'thermite', name: 'Thermite', count: 1, job: 'Deny a doorway', counter: 'Tac Mask halves the burn; wait it out', desc: 'Sticks and burns white-hot in a tight circle for 7 s. Melts devices' },
  tripwire: { id: 'tripwire', name: 'Tripwire', count: 1, job: 'Trap a lane', counter: 'Its beam is visible; shoot the anchor', desc: 'Stick it to a wall: a laser beam across the lane blows on whoever breaks it' },
  crawler:  { id: 'crawler',  name: 'Crawler',  count: 1, job: 'Hunt a camper', counter: 'Sprint away; shoot it; Trophy', desc: 'Lands, then scuttles after the nearest enemy it can see and blows' },
  shiv:     { id: 'shiv',     name: 'Shiv',     count: 2, job: 'Quiet finisher', counter: 'Face it: only a hit in the back kills', desc: 'Fast throwing knife: 60 damage, a kill in the back. Pick it back up' },
};

// One pick per tier: `perks: [tier0, tier1, tier2]`.
export const PERK_TIERS = ['Body', 'Hands', 'Senses'];
export const PERKS = {
  marathon:    { id: 'marathon',    tier: 0, name: 'Marathon',     desc: 'Faster sprint, quicker slide recharge' },
  flak:        { id: 'flak',        tier: 0, name: 'Flak',         desc: 'Take less explosive damage' },
  quickmend:   { id: 'quickmend',   tier: 0, name: 'Quick Mend',   desc: 'Health starts to recover sooner, and faster' },
  tacmask:     { id: 'tacmask',     tier: 0, name: 'Tac Mask',     desc: 'Flashes and stuns fade fast, fire hurts half, gas does nothing' },
  adrenaline:  { id: 'adrenaline',  tier: 0, name: 'Adrenaline',   desc: 'A gun kill restores 40 health' },

  scavenger:   { id: 'scavenger',   tier: 1, name: 'Scavenger',    desc: 'Refill ammo reserve from kills' },
  fasthands:   { id: 'fasthands',   tier: 1, name: 'Fast Hands',   desc: 'Faster swaps and reloads' },
  strongarm:   { id: 'strongarm',   tier: 1, name: 'Strong Arm',   desc: 'Throw equipment much further' },
  bandolier:   { id: 'bandolier',   tier: 1, name: 'Bandolier',    desc: 'One extra tactical and one extra lethal' },
  hardline:    { id: 'hardline',    tier: 1, name: 'Hardline',     desc: 'Scorestreaks cost 15% less' },

  ghost:       { id: 'ghost',       tier: 2, name: 'Ghost',        desc: 'Hidden from enemy UAV' },
  coldblood:   { id: 'coldblood',   tier: 2, name: 'Cold Blooded', desc: 'Sentries, aircraft, mortars and mines ignore you until close; recon marks fade twice as fast' },
  deadsilence: { id: 'deadsilence', tier: 2, name: 'Dead Silence', desc: 'Your footsteps make no sound' },
  tracker:     { id: 'tracker',     tier: 2, name: 'Tracker',      desc: 'Enemies you hit stay on your team\'s minimap for 4 s' },
  engineer:    { id: 'engineer',    tier: 2, name: 'Engineer',     desc: 'Your sentries, aircraft and Trophy last longer; Blackout cannot jam you' },
};
export const PERK_IDS = Object.keys(PERKS);
export const HARDLINE_MULT = 0.85;

// Pro: what a perk adds once its challenges are done (js/shared/progression.js PRO_CHALLENGES). Always a related extra
// ability, never a bigger number on the main effect. There is no toggle: a Pro perk is always Pro. The behaviour lives in
// the sim (js/sim/player.js, equipment.js, sim.js) or, for the senses, in what the HUD draws; `where` says which.
// A loadout's `pro` lists every perk its owner has Pro on; hasPro (js/sim/player.js) also needs the perk equipped.
export const PRO = {
  marathon:    { name: 'Run and Load',    desc: 'Reloads run 35% faster while you sprint', where: 'player' },
  flak:        { name: 'Shock Absorber',  desc: 'Blast damage no longer pauses your health regen', where: 'sim' },
  quickmend:   { name: 'Field Medic',     desc: 'Teammates within 7 m heal at your Quick Mend pace', where: 'sim' },
  tacmask:     { name: 'Spotter',         desc: 'Enemies you flash show on your team\'s minimap while blinded', where: 'sim' },
  adrenaline:  { name: 'Second Wind',     desc: 'Take 25% less damage for 2.5 s after a gun kill', where: 'sim' },
  scavenger:   { name: 'Pack Rat',        desc: 'Kills also restore one lethal, or a tactical when lethals are full', where: 'sim' },
  fasthands:   { name: 'Sleight',         desc: 'Swapping mid-reload finishes that reload in the holster', where: 'player' },
  strongarm:   { name: 'Fastball',        desc: 'Throws fly 35% faster, and your aim shows the blast radius', where: 'equipment' },
  bandolier:   { name: 'Quartermaster',   desc: 'Spent equipment comes back, one piece every 30 s', where: 'sim' },
  hardline:    { name: 'Team Player',     desc: 'Assists count as kills toward your scorestreaks', where: 'sim' },
  ghost:       { name: 'Phantom',         desc: 'Your gunfire never pings you on the enemy minimap', where: 'sim' },
  coldblood:   { name: 'Blank Slate',     desc: 'Sensors, Snapshots, Taggers and Tracker hits cannot mark you', where: 'sim' },
  deadsilence: { name: 'Keen Ears',       desc: 'Sprinting enemies within 14 m ping your minimap', where: 'hud' },
  tracker:     { name: 'Footprints',      desc: 'See enemy footprints from the last 4 s wherever you have sight', where: 'hud' },
  engineer:    { name: 'Hijacker',        desc: 'See enemy equipment through walls; stand at an enemy Sentry for 1.5 s to take it', where: 'sim' },
};

// Calling card ids are data in js/shared/progression.js (CARDS); a loadout only carries the id, checked there.
const CARD_ID = /^[a-z0-9_-]{1,24}$/;

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

// Keeps a {weaponId: cosmeticId} map of short string ids and nothing else; it arrives from other players.
function cosmeticMap(m) {
  const out = {};
  if (!m || typeof m !== 'object') return out;
  for (const k of Object.keys(m).slice(0, 64)) {
    const v = m[k];
    if (typeof k === 'string' && k.length <= 24 && typeof v === 'string' && v.length <= 24) out[k] = v;
  }
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
    // Per-weapon cosmetics ({weaponId: id}), for modes that hand out other guns mid-match (Gun Game).
    camos: cosmeticMap(l.camos),
    tracers: cosmeticMap(l.tracers),
    killFxs: cosmeticMap(l.killFxs),
    // Identity that travels with the loadout through lobby and roster, so no other message has to change.
    pro: Array.isArray(l.pro) ? PERK_IDS.filter(id => l.pro.includes(id)) : [],
    card: typeof l.card === 'string' && CARD_ID.test(l.card) ? l.card : null,
  };
}
