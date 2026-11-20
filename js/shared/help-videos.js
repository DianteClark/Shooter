// In-engine help videos (docs/TUTORIAL.md, roadmap 63): short scripted demos played in the real renderer from Help cards.
// A video is not a recording: it is a seeded bot match (the real Sim, bots only) run for a few seconds, with a director
// (js/game/help-director.js) that nudges the star bot at set times (slide now, throw now, call the streak) and a
// camera. Same seed, same script, same pictures: Replay simply builds the match again.
//
// Pure data and helpers, no DOM: node tests (dev/help-videos-test.mjs) run every script headless.
//
//   VIDEOS              every video, in the order the Videos tab lists them
//   VIDEO_BY_ID         id -> video
//   CARD_VIDEOS         Help card key -> video id (the Play chip on that card)
//   captionAt(v, t)     the caption showing at video second t (index and text), or null
//   videoProblems(v)    what is wrong with a script ([] when nothing): the tests and the player's guard
//   OP_KINDS            the director's operations
//
// A script:
//   id, title, group ('basics' | 'modes' | 'big' | 'more'), icon (js/ui/icons.js id)
//   map, mode, seed       the match to build (mode is a js/shared/modes.js id)
//   len                   seconds shown, 10-25
//   pre                   seconds run headless before the first frame (past the warmup, to where the action is)
//   team, skill           bots per side (team modes) and their skill; the star is always 'veteran'
//   star                  { primary, secondary, lethal, tactical, streaks, perks } for the bot the camera follows
//   cam                   'follow' (the match camera over the star), 'wide' (higher, over the star),
//                         'tactical' (the caster's frame over every player), or 'caster' (cuts between players)
//   sticks                true: ghost thumbs and buttons show what the star's inputs would be (basics videos)
//   ops                   [[t, kind, arg?], ...] director operations at video second t (see OP_KINDS)
//   captions              [[t, text], ...] in time order; each shows until the next
export const VIDEO_MIN = 10, VIDEO_MAX = 25;

// What the director can do at a moment (js/game/help-director.js):
//   slide            the star slides on this tick (it runs first if standing)
//   sprint           the star sprints for arg seconds
//   lethal|tactical  the star throws along its aim, arg metres (quick throw: arg 0 throws where it faces)
//   charge           the star's streak score goes to its slot arg's cost: the tile is ready
//   streak           the star calls the streak in slot arg
//   swap             the star swaps weapon
//   cam              the camera changes to arg ('follow', 'wide', 'tactical', 'caster')
//   next             the caster camera cuts to the next player
export const OP_KINDS = new Set(['slide', 'sprint', 'lethal', 'tactical', 'charge', 'streak', 'swap', 'cam', 'next']);
export const CAMS = new Set(['follow', 'wide', 'tactical', 'caster']);
export const GROUPS = [['basics', 'Basics'], ['modes', 'Core modes'], ['big', 'Big modes'], ['more', 'More']];

const KIT = { primary: 'ar', secondary: 'pistol', lethal: 'frag', tactical: 'smoke', streaks: ['uav', 'turret', 'strike'], perks: ['marathon', 'scavenger', 'tracker'] };

export const VIDEOS = [
  { id: 'move', title: 'Moving and aiming', group: 'basics', icon: 'marathon', map: 'railyard', mode: 'tdm', seed: 5, len: 16, pre: 3.4, team: 3, skill: 'regular',
    star: KIT, cam: 'follow', sticks: true,
    ops: [[3, 'sprint', 2.5]],
    captions: [[0, 'Left thumb: drag anywhere on the left half to move', 'Left stick: move'], [3, 'Push the stick all the way to sprint', 'Click {sprint} to sprint while you move'],
      [6, 'Right thumb: touch and hold to aim down sights', 'Right stick: turn. Hold {aim} to aim down sights'], [9.5, 'Push past the outer ring to fire. Let go to stop', 'Pull {fire} to fire'],
      [13, 'Aim assist helps a little on targets you can see']] },
  { id: 'slide', title: 'Sliding and sprinting', group: 'basics', icon: 'slide', map: 'topside', mode: 'tdm', seed: 7, len: 14, pre: 3.4, team: 3, skill: 'regular',
    star: { ...KIT, primary: 'smg' }, cam: 'follow', sticks: true,
    ops: [[0.5, 'sprint', 3], [3, 'slide'], [6.5, 'sprint', 2.5], [8.6, 'slide'], [11.5, 'slide']],
    captions: [[0, 'Sprint: push the move stick to the edge', 'Sprint: click {sprint} while moving'], [3, 'Tap Slide while running: you drop low and fast', 'Press {slide} while running: you drop low and fast'],
      [6, 'A slide pays off most of the sprint-to-fire delay'], [9.5, 'You are a smaller target mid-slide. It needs speed: run first']] },
  { id: 'nades', title: 'Grenades and quick throw', group: 'basics', icon: 'frag', map: 'railyard', mode: 'tdm', seed: 9, len: 16, pre: 3.4, team: 3, skill: 'regular',
    star: KIT, cam: 'follow', sticks: true,
    ops: [[2.5, 'lethal', 0], [8, 'tactical', 9], [12, 'lethal', 12]],
    captions: [[0, 'Quick throw: tap Lethal and it flies where you face', 'Quick throw: tap {lethal} and it flies where you face'], [5.5, 'Aimed throw: hold the button and drag. The arc shows where it lands', 'Aimed throw: hold {lethal}, aim with the right stick, let go'],
      [8, 'Smoke blocks sight lines: cross open ground behind it'], [11.5, 'Drag back onto the button to cancel. Counts refill when you respawn', 'Tactical is {tactical}. Counts refill when you respawn']] },
  { id: 'streaks', title: 'Scorestreaks', group: 'basics', icon: 'uav', map: 'harbor', mode: 'tdm', seed: 5, len: 18, pre: 3.4, team: 3, skill: 'regular',
    star: KIT, cam: 'follow', sticks: true,
    ops: [[2.5, 'charge', 0], [4.5, 'streak', 0], [8, 'charge', 1], [10, 'streak', 1], [13, 'charge', 2], [14.5, 'streak', 2]],
    captions: [[0, 'Kills, assists and objective play fill your streak score'], [2.5, 'A tile lights when a streak is ready: tap it', 'A tile lights when a streak is ready: press {streak}'],
      [5, 'UAV: enemies show on your minimap'], [10, 'Turret: placed where you stand, it guards a lane'],
      [14.5, 'Airstrike: called on the enemy side. Die and the score resets, the held tiles stay']] },
  { id: 'dom', title: 'Domination', group: 'modes', icon: 'mode:dom', map: 'railyard', mode: 'dom', seed: 3, len: 18, pre: 9, team: 4, skill: 'regular',
    star: KIT, cam: 'wide',
    ops: [[9, 'cam', 'tactical']],
    captions: [[0, 'Three flags: A, B and C. Stand in a ring to capture it'], [5, 'More players inside captures faster. An enemy inside stops it'],
      [9, 'Every flag you hold scores on its own, all the time'], [13.5, 'Hold two of three and you win the race']] },
  { id: 'hard', title: 'Hardpoint', group: 'modes', icon: 'mode:hard', map: 'harbor', mode: 'hard', seed: 3, len: 16, pre: 8, team: 4, skill: 'regular',
    star: KIT, cam: 'wide',
    ops: [[8, 'cam', 'tactical']],
    captions: [[0, 'One zone at a time. Stand in it with no enemy inside to score'], [5, 'Contested: both teams inside, nobody scores'],
      [8, 'The zone moves after a while: be there first'], [12, 'Time in the zone is the whole game']] },
  { id: 'snd', title: 'Search and Destroy', group: 'modes', icon: 'mode:snd', map: 'topside', mode: 'snd', seed: 2, len: 22, pre: 4, team: 4, skill: 'regular',
    star: KIT, cam: 'wide',
    ops: [[11, 'cam', 'tactical']],
    captions: [[0, 'One life a round. Attackers carry the bomb to A or B'], [5.5, 'Plant it and defend: the defenders must defuse in time'],
      [11, 'Out? You watch a living teammate until the round ends'], [16.5, 'Wipe the other side or win the bomb. First to 4 rounds']] },
  { id: 'kc', title: 'Kill Confirmed', group: 'modes', icon: 'mode:kc', map: 'railyard', mode: 'kc', seed: 6, len: 16, pre: 10, team: 4, skill: 'regular',
    star: KIT, cam: 'wide',
    captions: [[0, 'Every death drops a tag where the player fell'], [4.5, 'Grab an enemy tag to score for your team'],
      [8.5, 'Grab your own team\'s tag to deny theirs'], [12, 'A kill only counts once someone picks it up']] },
  { id: 'hq', title: 'Headquarters', group: 'modes', icon: 'mode:hq', map: 'harbor', mode: 'hq', seed: 4, len: 18, pre: 6, team: 4, skill: 'regular',
    star: KIT, cam: 'wide',
    ops: [[8, 'cam', 'tactical']],
    captions: [[0, 'Stand in the HQ to capture it'], [4.5, 'Held, it scores a point a second'],
      [8, 'But your team cannot respawn while it stands'], [12.5, 'The other side destroys it by standing inside. Then it moves']] },
  { id: 'ctf', title: 'Capture the Flag', group: 'modes', icon: 'mode:ctf', map: 'topside', mode: 'ctf', seed: 5, len: 20, pre: 6, team: 4, skill: 'regular',
    star: KIT, cam: 'wide',
    ops: [[10, 'cam', 'tactical']],
    captions: [[0, 'Take the enemy flag and run it home to score'], [5, 'Your own flag must be at home to capture'],
      [10, 'Carrier down? The flag drops. Touch your own to send it home'], [15, 'First to 3 captures wins']] },
  { id: 'br', title: 'Battle Royale: drop and loot', group: 'big', icon: 'mode:br', map: 'frontier', mode: 'br', seed: 8, len: 24, pre: 3.4, skill: 'regular',
    star: KIT, cam: 'wide',
    captions: [[0, 'The transport crosses the island. Tap Jump over where you want to land'], [6, 'Steer the glide with the move stick'],
      [11, 'You land with fists and a pistol: walk over loot to take ammo, plates and medkits'], [17, 'Tap to swap for a better gun. Rarer colours handle better']] },
  { id: 'brfight', title: 'Battle Royale: plates, circle, revive', group: 'big', icon: 'plates', map: 'frontier', mode: 'rb', seed: 2, len: 24, pre: 26, skill: 'regular',
    star: KIT, cam: 'wide',
    captions: [[0, 'Armour plates soak damage before health. Hold Plate to put one on'], [6, 'The circle closes: outside it you lose health every second'],
      [12, 'Downed, you crawl. A squadmate can hold to revive you'], [18, 'Out? A respawn beacon or a redeploy brings you back while your squad lives']] },
  { id: 'ex', title: 'Extraction', group: 'big', icon: 'mode:ex', map: 'frontier', mode: 'exq', seed: 4, len: 22, pre: 8, skill: 'regular',
    star: KIT, cam: 'wide',
    captions: [[0, 'Your own loadout, four squads, AI patrols everywhere'], [5.5, 'Take contracts: carry intel, hunt a commander, hold a terminal'],
      [11, 'Patrols are tougher toward the middle and call reinforcements'], [16.5, 'Call the exfil and hold until it lands. Out with your loot or lose it']] },
  { id: 'zm', title: 'Graveyard Shift', group: 'big', icon: 'mode:zm', map: 'ashgrove', mode: 'zm', seed: 2, len: 22, pre: 12, skill: 'regular',
    star: KIT, cam: 'wide',
    captions: [[0, 'Survive the waves with your crew. Every hit and kill pays points'], [5.5, 'Spend points on gates, wall guns, perks and the mystery crate'],
      [11, 'Turn the power on to wake perks and traps'], [16.5, 'Down? A crewmate can revive you before you bleed out']] },
  { id: 'cp', title: 'Campaign', group: 'big', icon: 'mode:cp', map: 'railyard', mode: 'cp', seed: 3, len: 20, pre: 6, skill: 'veteran',
    star: KIT, cam: 'wide',
    captions: [[0, 'Operation Nightrail: eight story missions for one to four players'], [5, 'The card at the top says what to do next'],
      [10, 'The radio tells the story, with subtitles'], [15, 'Downed squadmates can be revived. Bots fill the seats']] },
  { id: 'ranked', title: 'Ranked', group: 'more', icon: 'ui:rank', map: 'harbor', mode: 'hard', seed: 11, len: 16, pre: 8, team: 4, skill: 'veteran',
    star: KIT, cam: 'tactical',
    captions: [[0, 'Ranked: Hardpoint, Search and Destroy and Control, standard rules, no modifiers'], [4.5, 'Five placement matches, then a win adds SR and a loss takes it'],
      [8.5, 'How you play and who you play nudge it a little either way'], [12.5, 'Bronze to Master, then Champion. Season rewards for the best you reach']] },
  { id: 'gunsmith', title: 'The Gunsmith', group: 'more', icon: 'ui:gunsmith', map: 'range', mode: 'range', seed: 1, len: 14, pre: 1, skill: 'regular',
    star: { ...KIT, primary: 'lmg' }, cam: 'follow',
    captions: [[0, 'Four slots: optic, barrel, magazine and grip'], [4, 'Every part gives something and costs something: green better, red worse'],
      [8, 'Parts unlock as the gun levels up. Try them here on the range'], [11, 'Kits change how a gun plays, at a real price']] },
  { id: 'caster', title: 'The caster camera', group: 'more', icon: 'ui:eye', map: 'railyard', mode: 'dom', seed: 12, len: 18, pre: 10, team: 4, skill: 'regular',
    star: KIT, cam: 'caster',
    ops: [[4, 'next'], [8, 'cam', 'tactical'], [12, 'cam', 'caster'], [12.1, 'next'], [15, 'next']],
    captions: [[0, 'Out of play, or a spectator in a friend room: tap Caster cam'], [4, 'Follow: Next and Previous step through the players'],
      [8, 'Tactical: one high frame over everyone in play'], [12, 'Free: drag to pan, pinch to zoom. Not in Ranked']] },
];

export const VIDEO_BY_ID = Object.fromEntries(VIDEOS.map(v => [v.id, v]));

// Help cards with a Play chip: card key (js/ui/help.js) -> video.
export const CARD_VIDEOS = {
  'ctl:left': 'move', 'ctl:right': 'move', 'ctl:slide': 'slide', 'ctl:throw': 'nades', 'streaks': 'streaks',
  'mode:dom': 'dom', 'mode:hard': 'hard', 'mode:snd': 'snd', 'mode:kc': 'kc', 'mode:hq': 'hq', 'mode:ctf': 'ctf',
  'mode:br': 'br', 'mode:rb': 'brfight', 'mode:ex': 'ex', 'mode:zm': 'zm', 'mode:cp': 'cp', 'mode:ranked': 'ranked', 'gunsmith': 'gunsmith', 'caster': 'caster',
};

// The caption's words for this device: a caption may carry a controller version as its third entry, where {action}
// stands for the button bound to it (js/ui/gamepad.js action ids: fire, aim, slide, lethal...).
export function captionText(v, t, device = 'touch') {
  const c = captionAt(v, t);
  if (!c) return null;
  const row = v.captions[c.i];
  return { i: c.i, text: device === 'pad' && row[2] ? row[2] : row[1] };
}

// Fills each {action} with nameOf(action) ('' or unknown: the action's own word, capitalised).
export function fillButtons(text, nameOf) {
  return String(text).replace(/\{(\w+)\}/g, (_, id) => nameOf(id) || id[0].toUpperCase() + id.slice(1));
}

export function captionAt(v, t) {
  const list = v?.captions ?? [];
  let k = -1;
  for (let i = 0; i < list.length; i++) if (list[i][0] <= t + 1e-6) k = i;
  return k < 0 ? null : { i: k, text: list[k][1] };
}

// Pure checks; the tests run these and the map and mode ones against the real tables.
export function videoProblems(v, { maps = null, modes = null } = {}) {
  const out = [];
  if (!v || typeof v.id !== 'string') return ['no id'];
  if (!(v.len >= VIDEO_MIN && v.len <= VIDEO_MAX)) out.push(`${v.id}: length ${v.len} not ${VIDEO_MIN}-${VIDEO_MAX} s`);
  if (!CAMS.has(v.cam)) out.push(`${v.id}: camera ${v.cam}`);
  if (maps && !maps[v.map]) out.push(`${v.id}: map ${v.map}`);
  if (modes && v.mode !== 'range' && !modes[v.mode]) out.push(`${v.id}: mode ${v.mode}`);
  if (!GROUPS.some(([g]) => g === v.group)) out.push(`${v.id}: group ${v.group}`);
  const caps = v.captions ?? [];
  if (!caps.length || caps[0][0] !== 0) out.push(`${v.id}: needs a caption at 0`);
  for (let i = 0; i < caps.length; i++) {
    const [t, text] = caps[i];
    if (!(t >= 0 && t < v.len)) out.push(`${v.id}: caption at ${t} outside the video`);
    if (i && t <= caps[i - 1][0]) out.push(`${v.id}: captions out of order at ${t}`);
    if (typeof text !== 'string' || !text || text.length > 90) out.push(`${v.id}: caption ${i} text`);
    if (caps[i][2] !== undefined && (typeof caps[i][2] !== 'string' || !caps[i][2] || caps[i][2].length > 90)) out.push(`${v.id}: caption ${i} controller text`);
    const next = caps[i + 1]?.[0] ?? v.len;
    if (next - t < 2.5) out.push(`${v.id}: caption ${i} shows under 2.5 s`);
  }
  for (const op of v.ops ?? []) {
    if (!OP_KINDS.has(op[1])) out.push(`${v.id}: op ${op[1]}`);
    if (!(op[0] >= 0 && op[0] < v.len)) out.push(`${v.id}: op at ${op[0]} outside the video`);
    if (op[1] === 'cam' && !CAMS.has(op[2])) out.push(`${v.id}: op camera ${op[2]}`);
  }
  return out;
}
