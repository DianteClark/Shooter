// Graveyard Shift ally bots: who each one is (docs/ZOMBIES.md "Ally bots"). ZmRules._planCrew and _botWant
// (js/sim/zombies.js) and ZmEcon.botWants (js/sim/zm-econ.js) read a bot's persona for how it shops and fights;
// js/sim/chatter.js for what it says.
//
// A pool bot's play style (js/shared/botpool.js STYLES) picks its persona; a dealt bot without one takes the next in
// PERSONA_ORDER by its seat among the crew's bots, so a crew of three is three different teammates.
//   aggressive  close in, backpedals late; guns and the bench first, Hammerfall early; calls its streak late
//   support     stays at the lead's shoulder, revives from further, Mercy Run first; calls its streak early
//   hoarder     banks for the bench's tiers, buys little else past the basics
//   shopper     spends freely: the crate, the terminal, kit refills
//
// Fields: kite (backpedal inside this, m), ring (distance from the lead it keeps, m), cushion (x the points it keeps
// back on a buy), perks (the order it buys them: health and revives first), bench (the round it starts on tiers),
// benchBias (score added to a tier), save (the share of its next bench tier it banks first, from two rounds before
// `bench`: a tier is worth more than anything else on the shelf), box (points over the crate's price before it pulls), streak (undead within 14 m
// before it calls its held streak in), low (health it falls back at with no plates), revive (how far it goes for a
// downed mate, m), item (the terminal item it holds).

export const ZM_PERSONAS = {
  aggressive: { kite: 3.6, ring: 4.5, cushion: 0.6, perks: ['iron', 'hammer', 'mercy', 'quick', 'breath', 'stride'], bench: 4, benchBias: 4, save: 1, box: 1500, streak: 8, low: 30, revive: 45, item: 'drone' },
  support: { kite: 5.2, ring: 2.6, cushion: 1, perks: ['mercy', 'iron', 'quick', 'breath', 'hammer', 'stride'], bench: 5, benchBias: 0, save: 0.5, box: 3000, streak: 5, low: 50, revive: 60, item: 'sentry' },
  hoarder: { kite: 4.6, ring: 3.4, cushion: 1.5, perks: ['iron', 'mercy', 'breath', 'hammer', 'quick', 'stride'], bench: 4, benchBias: 10, save: 1, box: 6000, streak: 9, low: 45, revive: 45, item: 'sentry' },
  shopper: { kite: 4.6, ring: 3.6, cushion: 0.45, perks: ['iron', 'mercy', 'quick', 'hammer', 'stride', 'breath'], bench: 5, benchBias: 0, save: 0.4, box: 900, streak: 6, low: 40, revive: 45, item: 'strike' },
};
export const PERSONA_ORDER = ['support', 'aggressive', 'shopper', 'hoarder'];
const FROM_STYLE = { rusher: 'aggressive', flanker: 'aggressive', support: 'support', objective: 'support', anchor: 'hoarder', sniper: 'shopper' };

// The persona id for a crew member (cached on the player as p.zPersona). `crew`: the rules' crew, for the seat order.
export function personaId(p, crew) {
  if (p.zPersona) return p.zPersona;
  const k = crew.filter(q => q.isBot).indexOf(p);
  p.zPersona = FROM_STYLE[p.style] ?? PERSONA_ORDER[Math.max(0, k) % PERSONA_ORDER.length];
  return p.zPersona;
}
export const personaOf = (p, crew) => ZM_PERSONAS[personaId(p, crew)];
