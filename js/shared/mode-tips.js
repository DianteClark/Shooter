// First-time tips (docs/TUTORIAL.md, roadmap 63): the first time a player enters a mode, one short card says what wins
// it. Shown once per tip, dismissable, kept on this phone in Options.tipsSeen (a device setting, so the progress reset
// keeps it: js/shared/reset.js KEEP_KEYS), and reset from Options (Tips: Show again).
//
// Pure, no DOM: tipFor(mode, seen) is what js/ui/modetips.js shows; dev/tutorial-test.mjs checks the table.
//
//   TIP_OF[mode]      the tip key a mode id uses (variants share one: Ground War Domination is Domination)
//   TIPS[key]         { title, lines: [..], video } (video: the Help video that shows it, js/shared/help-videos.js)
//   tipFor(mode, seen)  the tip to show now, or null (seen already, or a mode without one)
//   markSeen(seen, key) a new seen object with the key in it
export const TIPS = {
  tdm: { title: 'Team Deathmatch', lines: ['First team to the kill limit wins.', 'Stay near teammates: trades win fights.'] },
  kc: { title: 'Kill Confirmed', lines: ['A kill scores only when someone grabs the enemy tag it drops.', 'Grab your own team\'s tags to deny them.'], video: 'kc' },
  dom: { title: 'Domination', lines: ['Stand in a flag ring to capture it. Held flags score all the time.', 'Hold two of the three.'], video: 'dom' },
  hard: { title: 'Hardpoint', lines: ['Only time inside the zone scores, with no enemy in it.', 'It moves: the next one shows before it does.'], video: 'hard' },
  snd: { title: 'Search and Destroy', lines: ['One life a round. Attackers plant at A or B, defenders defuse.', 'Out? You watch a teammate until the round ends.'], video: 'snd' },
  ctf: { title: 'Capture the Flag', lines: ['Run the enemy flag home. Your own must be at home to score.', 'Touch your dropped flag to send it back.'], video: 'ctf' },
  hq: { title: 'Headquarters', lines: ['Stand in the HQ to take it; held, it scores every second.', 'While it stands your team cannot respawn.'], video: 'hq' },
  ffa: { title: 'Free-for-All', lines: ['Everyone is an enemy. Most kills wins.'] },
  gun: { title: 'Gun Game', lines: ['Every kill moves you to the next gun. A kill with the last one wins.', 'A thrown kill knocks the victim back a gun.'] },
  ko: { title: 'Kill Order', lines: ['Only killing the enemy VIP scores. Guard yours.'] },
  inf: { title: 'Infected', lines: ['Anyone the infected kill joins them.', 'Survivors win if any are left when time runs out.'] },
  oic: { title: 'One in the Chamber', lines: ['One round that kills on any hit; a kill gives it back.', 'Five lives. Last one standing wins.'] },
  ctl: { title: 'Control', lines: ['Attackers take zones A and B, defenders hold them until time runs out.', 'Each team has a pool of lives. Sides swap every round.'] },
  grind: { title: 'Grind', lines: ['Kills drop tags: carry them to bank A or B to score.', 'Die and you drop everything you carry.'] },
  gf: { title: 'Showdown', lines: ['2 v 2, one life a round, no health regen.', 'After 40 s, a flag in the middle wins the round.'] },
  br: { title: 'Battle Royale', lines: ['Tap Jump over where you want to land. Loot ammo, plates and medkits.', 'Stay inside the circle. Downed squadmates can be revived.'], video: 'br' },
  rb: { title: 'Rebound', lines: ['While a squadmate is in, you redeploy beside them after a short countdown.', 'A squad is out only when nobody in it is left.'], video: 'brfight' },
  ex: { title: 'Extraction', lines: ['Do contracts for rewards; AI patrols guard every place.', 'Call the exfil and hold until it lands to get out with your loot.'], video: 'ex' },
  zm: { title: 'Graveyard Shift', lines: ['Hits and kills pay points: buy gates, wall guns, perks and the crate.', 'Revive downed crewmates before they bleed out.'], video: 'zm' },
  cq: { title: 'Conquest', lines: ['Hold more flags to drain their tickets. Every death costs one.', 'Dead? Pick a flag your side holds to deploy on.'], video: 'cq' },
  bt: { title: 'Breakthrough', lines: ['Attackers take every objective of a sector to make it fall.', 'Defenders fall back to the next line. Attackers have limited tickets.'], video: 'bt' },
  cp: { title: 'Campaign', lines: ['The card at the top says what to do next; the radio is subtitled.', 'Downed squadmates can be revived.'], video: 'cp' },
};

export const TIP_OF = {
  tdm: 'tdm', kc: 'kc', dom: 'dom', hard: 'hard', snd: 'snd', ctf: 'ctf', hq: 'hq', ffa: 'ffa', gun: 'gun', ko: 'ko', inf: 'inf',
  oic: 'oic', ctl: 'ctl', grind: 'grind', gf: 'gf', gwtdm: 'tdm', gwdom: 'dom', gwhq: 'hq', gwko: 'ko', gwinf: 'inf',
  br: 'br', brduo: 'br', brsolo: 'br', rb: 'rb', rbduo: 'rb', exq: 'ex', exd: 'ex', zm: 'zm', cp: 'cp', cq: 'cq', bt: 'bt',
};

export function tipFor(mode, seen = {}) {
  const key = TIP_OF[mode];
  if (!key || !TIPS[key] || (seen && seen[key])) return null;
  return { key, ...TIPS[key] };
}

export function markSeen(seen, key) {
  return { ...(seen && typeof seen === 'object' ? seen : {}), [key]: 1 };
}
