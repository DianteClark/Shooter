// Everything a loadout can contain. Adding an item is one line of data here plus its behaviour in the sim.

export const SCORE = { kill: 100, headshot: 25, assist: 50, confirm: 50, deny: 25, capture: 100, defend: 50, holdTick: 10 };

export const STREAKS = {
  uav:     { id: 'uav',     name: 'UAV',     cost: 300,  desc: 'Reveal enemies for 20 s' },
  turret:  { id: 'turret',  name: 'Turret',  cost: 500,  desc: 'Automated gun at your position' },
  strike:  { id: 'strike',  name: 'Strike',  cost: 700,  desc: 'Line of explosions on the enemy' },
  gunship: { id: 'gunship', name: 'Gunship', cost: 1000, desc: 'Circles the yard, firing on visible enemies' },
};
export const STREAK_IDS = Object.keys(STREAKS);

export const TACTICALS = {
  smoke: { id: 'smoke', name: 'Smoke', count: 2, desc: 'Cloud that blocks line of sight' },
  flash: { id: 'flash', name: 'Flash', count: 2, desc: 'Blinds enemies in the blast' },
  stim:  { id: 'stim',  name: 'Stim',  count: 1, desc: 'Instant heal' },
};
export const LETHALS = {
  frag:   { id: 'frag',   name: 'Frag',   count: 2, desc: 'Bounces, explodes after a fuse' },
  sticky: { id: 'sticky', name: 'Sticky', count: 1, desc: 'Sticks where it lands, short fuse' },
};
export const PERKS = {
  scavenger: { id: 'scavenger', name: 'Scavenger',  desc: 'Refill ammo reserve from kills' },
  ghost:     { id: 'ghost',     name: 'Ghost',      desc: 'Hidden from enemy UAV' },
  fasthands: { id: 'fasthands', name: 'Fast Hands', desc: 'Faster swaps and reloads' },
  marathon:  { id: 'marathon',  name: 'Marathon',   desc: 'Faster sprint, quicker slide recharge' },
  flak:      { id: 'flak',      name: 'Flak',       desc: 'Take less explosive damage' },
};

export const DEFAULT_LOADOUT = Object.freeze({
  primary: 'ar', camo: 'none', secondary: 'pistol', attachments: {},
  perks: ['scavenger', 'marathon'], tactical: 'smoke', lethal: 'frag',
  streaks: ['uav', 'turret', 'gunship'],
});

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
    perks: pick(PERKS, l.perks, 2, d.perks),
    tactical: TACTICALS[l.tactical] ? l.tactical : d.tactical,
    lethal: LETHALS[l.lethal] ? l.lethal : d.lethal,
    streaks: pick(STREAKS, l.streaks, 3, d.streaks).sort((a, b) => STREAKS[a].cost - STREAKS[b].cost),
    tracer: l.tracer || null,
    killFx: l.killFx || null,
  };
}
