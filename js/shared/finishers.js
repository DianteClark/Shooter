// Finishing moves and emotes (docs/FINISHERS.md, roadmap item 32): plain data and the unlock rules, no imports, so the
// sim, the renderer, the HUD and the progression screens all read the same lists.
//
// FINISHERS: a melee on a downed enemy, or on one who has not seen you from behind, plays one of these. Both players are
// locked for `dur` seconds (the sim pins them, js/sim/finishers.js); the target dies at the end unless the attacker is
// hit first. Ids are in saves and on the wire (by index): append only, never reorder.
// EMOTES: short cosmetic animations on the quick wheel (js/ui/finisher-hud.js), synced as an event. Append only too.
//
// unlock: {} default | { level } peak player level | { opTier } any operator's mastery tier | { season } a season
// track tier reached (any season, kept once claimed).

export const FINISHERS = [
  { id: 'lights', name: 'Lights Out', dur: 1.3, unlock: {}, desc: 'A stock to the back of the head, then a second for good measure.' },
  { id: 'switchback', name: 'Switchback', dur: 1.5, unlock: { level: 8 }, desc: 'Spin them round by the collar and drive a knee home.' },
  { id: 'coupling', name: 'Hard Coupling', dur: 1.6, unlock: { level: 22 }, desc: 'Hook the arm, hip throw, a heel on the way down.' },
  { id: 'railspike', name: 'Railspike', dur: 1.5, unlock: { opTier: 3 }, desc: 'Both hands up, one hammer blow straight down.' },
  { id: 'lastcall', name: 'Last Call', dur: 1.2, unlock: { season: 30 }, desc: 'Quiet and quick: a hand over the mouth and a sharp twist.' },
  { id: 'derail', name: 'Derail', dur: 1.8, unlock: { opTier: 5 }, desc: 'Lift them clean off their feet and slam them into the ballast.' },
];
export const FINISHER_IDS = FINISHERS.map(f => f.id);
export const DEFAULT_FINISHER = 'lights';
export const getFinisher = id => FINISHERS.find(f => f.id === id) ?? FINISHERS[0];
export const finisherIndex = id => Math.max(0, FINISHER_IDS.indexOf(id));
export const cleanFinisher = id => (FINISHER_IDS.includes(id) ? id : DEFAULT_FINISHER);

export const EMOTES = [
  { id: 'wave', name: 'Wave', icon: 'ui:user', dur: 2.0, unlock: {} },
  { id: 'salute', name: 'Salute', icon: 'ui:star', dur: 1.8, unlock: {} },
  { id: 'point', name: 'Over There', icon: 'ui:aim', dur: 1.6, unlock: {} },
  { id: 'thumbs', name: 'Thumbs Up', icon: 'ui:check', dur: 1.5, unlock: {} },
  { id: 'laugh', name: 'Laugh', icon: 'ui:chat', dur: 2.2, unlock: { level: 6 } },
  { id: 'shuffle', name: 'Yard Shuffle', icon: 'ui:party', dur: 3.0, unlock: { level: 15 } },
  { id: 'taunt', name: 'Come On', icon: 'ui:warning', dur: 2.0, unlock: { level: 28 } },
  { id: 'turntable', name: 'Turntable', icon: 'ui:refresh', dur: 2.6, unlock: { season: 20 } },
];
export const EMOTE_IDS = EMOTES.map(e => e.id);
export const getEmote = id => EMOTES.find(e => e.id === id) ?? null;

// The rules of a finisher, shared by the host (which decides) and the phone (which shows the Finish button).
export const FIN = {
  reachDowned: 2.4,      // Metres to a downed enemy.
  reachBehind: 2.0,      // Metres to an unaware one, from behind.
  slack: 0.8,            // The host's allowance on a phone's request: the target moved a little since the phone saw it.
  behindCos: -0.2,       // The target's facing against the direction to the attacker: below this they cannot see you.
  stand: 0.85,           // Where the attacker is placed, this far from the target.
  emoteGap: 1.0,         // Shortest gap between two emotes from one player (host side).
};

// Whether attacker `a` may finish target `v` ({x, z, aim, team, alive, downed, air, fin, spawnProtect, ai}), by distance
// and facing only; walls, phases and modes are the caller's. `slack` widens the reach (a host checking a phone's request).
export function finishable(a, v, slack = 0) {
  if (!a || !v || a === v || !v.alive || v.team === a.team || v.fin || v.spawnProtect || v.air || v.zk) return false;
  const dx = a.x - v.x, dz = a.z - v.z, d = Math.hypot(dx, dz);
  if (v.downed) return d <= FIN.reachDowned + slack;
  if (d > FIN.reachBehind + slack || d < 1e-3) return false;
  // Facing away: the target's aim points away from the attacker.
  return (Math.cos(v.aim) * dx + Math.sin(v.aim) * dz) / d < FIN.behindCos;
}

// What a save has reached, for the unlock rules: { level, opTier, season }.
export function unlockOk(unlock, ctx = {}) {
  if (unlock.level && (ctx.level ?? 1) < unlock.level) return false;
  if (unlock.opTier && (ctx.opTier ?? 0) < unlock.opTier) return false;
  if (unlock.season && (ctx.season ?? 0) < unlock.season) return false;
  return true;
}
export function unlockText(unlock) {
  if (unlock.level) return `Reach level ${unlock.level}`;
  if (unlock.opTier) return `Reach operator mastery tier ${unlock.opTier} with any operator`;
  if (unlock.season) return `Reach tier ${unlock.season} on a season track`;
  return 'Default';
}
