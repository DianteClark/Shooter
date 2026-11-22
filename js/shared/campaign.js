// Co-op campaign (ROADMAP item 59, docs/CAMPAIGN.md): Operation Nightrail, eight short scripted missions for one to four
// players (bots fill the squad) against the Meridian Line, on the existing maps and Frontier. Pure data and pure rules,
// shared by the sim (js/sim/campaign.js), the menus, the HUD, the awards and the save.
//
// A mission is a list of steps run in order by the script (js/sim/campaign.js). A step is one objective:
//   goto     any squad member within r of `at` (stealth steps: while hidden)
//   hack     the squad alone within r of `at` for `time` s in all (an enemy inside pauses it)
//   defend   hold the zone at `at` for `time` s while waves come in; enemies alone inside fill the "lost" meter
//   escort   walk the VIP along `route` (it moves with a squad member near and no enemy close); waypoints are checkpoints
//   plant    stand still at each of `sites` for `plant` s; with `fuse`, the charges blow `fuse` s after the last one is on
//            (enemies standing on a charge pull it); `timer` s to set them all
//   kill     every `target` group member dead (a fleeing target that reaches its last stop and waits there escapes)
//   chase    reach the gates of `route` in order before the clock (`timer`, plus `add` a gate) runs out
//   boss     bring the boss down (phases and telegraphed attacks: js/sim/campaign.js); with `timer`, before it runs out
//   extract  every squad member who is up within r of `at` for `time` s (at least one of them)
//   pursue   (Operation Starfall) stay within `r` of a running target (its `target` group's route, no waiting) until it
//            is cornered at its last stop, then put it down: lose it for CP.trail s and it is gone; it shrugs off most
//            of the damage while it runs
// A plant step with `hostage` frees a prisoner (the mission's `vip`, held at its spot from the start with `vip.early`):
// an alarm before then starts the mission's `hostage.clock` (they move the prisoner: fail). A step with `loud` raises the
// alarm as it starts (the escape after a quiet rescue). A mission with `night` is fought in the dark (the phones see a
// few metres round the player, the bots' sight is cut) except under a flare (`flare` on a trigger lights the field for
// CP.flare s). A mission's `boss` ({name, hp, salvo, crest}) tunes the boss step's boss: his health pool (x CP.boss.hp),
// a salvo (a line of rings walked out toward one of the squad) among his attacks, the colour of his crest.
// Step fields: label (the HUD's line), at/r, spawn (groups made when the step starts), say (radio at the start), done
// (radio at the end), on (triggers: {when: {t} | {prog} | {gate} | {planted}, spawn, say, flare}), checkpoint (the squad's
// respawn spot moves to `cp` or `at` when the step starts), stealth (guards see with cones until the alarm).
// A group: {role: guard | patrol | assault | sniper | target | boss, at, n, route, fixed (n not scaled), name, tough}.
// Places (`at`, `route`, `sites`) are names the map resolves (cpPoint): s0/s1 the two spawn ends, d0.. Domination
// flags, h0.. Hardpoint zones, b0/b1 bomb sites, f0/f1 flags, c the middle, p<i> a Frontier place; [name, dx, dz]
// offsets one, ['~', a, b, k] is k of the way from a to b, '@kill' where the step's target fell.

export const OPERATION = {
  id: 'nightrail', name: 'Operation Nightrail', short: 'Nightrail',
  blurb: 'The Meridian Line has seized the rail network. Lantern needs a squad on the ground to take it back, one yard at a time.',
};
// The second operation (appended): the Line's board, the Directorate, is buying a launch.
export const OPERATION2 = {
  id: 'starfall', name: 'Operation Starfall', short: 'Starfall',
  blurb: 'Kordell is gone, but the Line was never only his. Its board, the Directorate, means to take the signals back from orbit. Lantern needs the squad again.',
};

// Numbers the sim, HUD and menus share. Seconds and metres.
export const CP = {
  team: 1,               // The Meridian Line's side (the squad is team 0).
  squad: 4,              // Players in the squad: humans first, bots fill.
  seats: 26,             // AI seats for the Line (groups take them as steps spawn them).
  warmup: 6,             // Briefing hold at the insertion point before the first step.
  failHold: 7,           // "Mission failed" on screen before the retry from the last checkpoint (or Abort).
  endHold: 4,            // After the last step, the mission complete banner before the match ends.
  reviveTime: 4, reviveReach: 1.9, reviveHp: 40, bleed: 30, downHp: 100,
  plantReach: 1.9, defuseTime: 5, lostAfter: 14, alertKeep: 20, leash: 36,
  detect: { range: 15, cone: 0.62, rate: 0.9, fall: 0.35, crouchK: 0.55 },     // Stealth: cone half-angle (rad), fill per second at 0 m.
  hvtWait: 40, hvtNear: 55, hvtEscape: 25,     // A fleeing target holds a stop this long (or until the squad is this near); at the last it waits this long.
  ping: 20,              // Seconds between Lantern's pings on a fleeing target.
  trail: 12,             // A pursuit: seconds with nobody of the squad within the step's r before the target is lost.
  runTake: 0,            // A pursued target on the run takes this share of the damage (plated: nothing stops him until he is cornered).
  flare: 10,             // A night mission: seconds a flare lights the field.
  nightSight: 0.55,      // A night mission: everyone's sight (the bots' sightK) without a flare.
  boss: { hp: 12000, barrage: [8, 6, 5], warn: 1.7, ring: 3.4, hit: 45, charge: 9, chargeWarn: 1.3, chargeSpeed: 15, chargeHit: 60, chargeW: 2.2, guard: 4 },
};

// Difficulty: enemies' numbers (count), the damage they deal (deal) and take (take), their skill (rating, 0..1),
// the squad's respawn wait, the boss's health, how long a timer runs (timer) and the XP it pays.
export const CP_DIFFS = [
  { id: 'recruit', name: 'Recruit', count: 0.7, deal: 0.3, take: 1.25, rating: 0.04, respawn: 8, boss: 0.7, timer: 1.25, xp: 1200, blurb: 'Fewer guards, softer aim. For learning the missions.' },
  { id: 'regular', name: 'Regular', count: 1, deal: 0.45, take: 1, rating: 0.22, respawn: 12, boss: 1, timer: 1, xp: 2000, blurb: 'The operation as planned.' },
  { id: 'veteran', name: 'Veteran', count: 1.25, deal: 0.56, take: 0.88, rating: 0.45, respawn: 15, boss: 1.25, timer: 0.85, xp: 3000, blurb: 'More of them, and they shoot straight. The skin and emblem are here.' },
];
export const CP_STAR_XP = 400;       // Each star earned.
export const CP_FIRST_XP = 1000;     // The first clear of a mission (any difficulty).

// Who is on the radio, and their colour on the HUD.
export const RADIO = {
  lantern: { name: 'Lantern', css: '#7cc8ff' },
  kestrel: { name: 'Kestrel', css: '#9ff0c0' },
  line: { name: 'Meridian radio', css: '#ff8a7c' },
  magpie: { name: 'Kingfisher', css: '#ffd27c' },
  kordell: { name: 'Marshal Kordell', css: '#ff5a4a' },
  vane: { name: 'Director Vane', css: '#c8a8ff' },
};

const L = (who, text) => [who, text];

export const MISSIONS = [
  {
    id: 'm1', n: 1, name: 'Switch Room', map: 'railyard', par: 540, insert: 's0',
    tag: 'Infiltrate and hack',
    brief: [
      ['The Line goes dark', 'Three nights ago the Meridian Line took the rail network: every junction, every signal, every yard. Nobody knows what they are moving.'],
      ['Your job', 'Get into Railyard, wire Lantern\'s relay into the signal box terminal and hold it while it copies their timetable. Then walk out.'],
      ['Expect', 'Yard guards, a patrol on the platforms and a marksman on the far gantry.'],
    ],
    bonus: { id: 'clean', label: 'Hack without a pause' },
    steps: [
      { type: 'goto', at: 'd0', r: 6, label: 'Reach the yard office', checkpoint: true, cp: 's0',
        spawn: [{ role: 'guard', at: 'd1', n: 3 }, { role: 'patrol', at: 'h0', n: 2, route: ['h0', 'd2', 'h1', 'd1'] }, { role: 'sniper', at: ['s1', -3, 0], n: 1 }],
        say: [L('lantern', 'Lantern on the net. Railyard is quiet. Keep it that way as long as you can.')] },
      { type: 'plant', sites: ['h1'], plant: 4, tap: true, label: 'Splice into the junction box', checkpoint: true, cp: 'd0',
        spawn: [{ role: 'guard', at: 'h1', n: 2 }, { role: 'patrol', at: 'b1', n: 2, route: ['b1', 'h1', 'd2'] }],
        say: [L('lantern', 'Junction box first, by the south platform. Splice the relay in and the signal box will talk to us.')],
        done: [L('lantern', 'Spliced. Now the terminal.')] },
      { type: 'hack', at: 'b0', r: 5, time: 60, label: 'Hack the signal terminal', checkpoint: true, cp: 'h0',
        say: [L('lantern', 'The terminal is in the signal box. Stand on it while the relay copies.')],
        on: [{ when: { prog: 0.35 }, spawn: [{ role: 'assault', at: 's1', n: 3 }], say: [L('line', 'Signal box is talking to someone. Check it.')] },
          { when: { prog: 0.7 }, spawn: [{ role: 'assault', at: 'b1', n: 4 }], say: [L('lantern', 'Nearly there. More of them from the south track.')] }],
        done: [L('lantern', 'Copied. The upload is slow: keep them off that box while it goes out.')] },
      { type: 'defend', at: 'b0', r: 7, time: 75, label: 'Hold the signal box', checkpoint: true, cp: 'h0',
        on: [{ when: { t: 3 }, spawn: [{ role: 'assault', at: 's1', n: 3 }] }, { when: { t: 30 }, spawn: [{ role: 'assault', at: 'b1', n: 3 }] },
          { when: { t: 55 }, spawn: [{ role: 'assault', at: 'd2', n: 3 }], say: [L('line', 'They are still in the box. Burn them out!')] }],
        done: [L('lantern', 'Timetable\'s ours. They are moving something north. Get out of there.')] },
      { type: 'extract', at: 's0', r: 6, time: 5, label: 'Get back to the fence line', checkpoint: true, cp: 'd0',
        spawn: [{ role: 'assault', at: 'd2', n: 3 }],
        done: [L('lantern', 'Good work. Lantern out.')] },
    ],
  },
  {
    id: 'm2', n: 2, name: 'Quiet Hours', map: 'neon', par: 600, insert: 's0', stealth: true,
    tag: 'Stealth',
    brief: [
      ['Ears in the market', 'The timetable points at Night Market: the Line\'s paymaster meets his buyers there after closing.'],
      ['Your job', 'Plant two listening taps on their routers, one at each end of the market, and leave without anyone knowing you were there.'],
      ['Stay out of the light', 'Watchmen walk the stalls with torches: the light on the ground is where they are looking. Keep low, keep it quiet. An alarm brings the whole market down on you.'],
    ],
    bonus: { id: 'hidden', label: 'Stay hidden' },
    alarm: { spawn: [{ role: 'assault', at: 's1', n: 4 }], say: [L('line', 'Intruders in the market! Lock it down!')],
      later: { t: 40, spawn: [{ role: 'assault', at: 'h1', n: 3 }] } },
    steps: [
      { type: 'goto', at: 'h2', r: 4, label: 'Slip into the market', checkpoint: true, cp: 's0', stealth: true,
        spawn: [{ role: 'guard', at: 'd0', n: 2, stealth: true }, { role: 'guard', at: 'd2', n: 2, stealth: true },
          { role: 'patrol', at: 'h0', n: 2, route: ['h0', 'd1', 'h1', 'd1'], stealth: true }, { role: 'patrol', at: 'h3', n: 1, route: ['h3', 'd2', 'h0', 'd2'], stealth: true }],
        say: [L('lantern', 'Watchmen carry torches. If the light finds you, they start looking. Don\'t let them finish.')] },
      { type: 'plant', sites: ['h0', 'h3'], plant: 4, label: 'Plant the listening taps', checkpoint: true, cp: 'h2', stealth: true, tap: true,
        say: [L('lantern', 'Two routers. Stand on each one for a few seconds.')],
        on: [{ when: { planted: 1 }, say: [L('lantern', 'One tap live. One to go.')] }],
        done: [L('lantern', 'Both taps are talking. One more thing: the paymaster keeps a ledger at the south stalls.')] },
      { type: 'goto', at: 'h1', r: 3, label: 'Photograph the paymaster\'s ledger', checkpoint: true, cp: 'h0', stealth: true,
        done: [L('lantern', 'Got it. His laptop is on the stall in the middle. Copy it, and stay out of the light while it runs.')] },
      { type: 'hack', at: 'd1', r: 3.5, time: 25, label: 'Copy the paymaster\'s laptop', checkpoint: true, cp: 'h1', stealth: true,
        done: [L('lantern', 'Copied. Now get out the way you came.')] },
      { type: 'extract', at: 's0', r: 6, time: 3, label: 'Get out of the market', checkpoint: true, cp: 'h2', stealth: true,
        done: [L('lantern', 'Clean exit. Let\'s hear what they have to say.')] },
    ],
  },
  {
    id: 'm3', n: 3, name: 'Seawall', map: 'harbor', par: 720, insert: 's0',
    tag: 'Defend',
    brief: [
      ['The pier relay', 'The taps paid off: the Line sends its orders over a radio relay on the Harbor pier.'],
      ['Your job', 'Take the relay and hold it while Lantern turns it against them. They will come from the water and the warehouses.'],
      ['Hold the ground', 'If they stand on the relay with nobody there to stop them, they take it back. Use the containers.'],
    ],
    bonus: { id: 'zone', label: 'Never let the relay fall below half' },
    steps: [
      { type: 'goto', at: 'd1', r: 6, label: 'Take the pier relay', checkpoint: true, cp: 's0',
        spawn: [{ role: 'guard', at: 'd1', n: 3 }, { role: 'guard', at: 'd2', n: 2 }],
        say: [L('lantern', 'Relay is on the middle pier. Clear it and plug in.')] },
      { type: 'plant', sites: ['d1'], plant: 5, tap: true, label: 'Plug into the relay', checkpoint: true, cp: 'd1',
        spawn: [{ role: 'patrol', at: 'd0', n: 2, route: ['d0', 'h0', 'd1'] }] },
      { type: 'defend', at: 'd1', r: 8, time: 210, label: 'Hold the relay', checkpoint: true, cp: 'd1',
        say: [L('lantern', 'I\'m in. Three and a half minutes and their network is ours. Hold.')],
        on: [{ when: { t: 5 }, spawn: [{ role: 'assault', at: 's1', n: 3 }] },
          { when: { t: 45 }, spawn: [{ role: 'assault', at: 'h0', n: 3 }], say: [L('line', 'Relay\'s been taken. All units to the pier.')] },
          { when: { t: 85 }, spawn: [{ role: 'assault', at: 's1', n: 4 }] },
          { when: { t: 125 }, spawn: [{ role: 'assault', at: 'h1', n: 3 }, { role: 'assault', at: 's1', n: 2 }], say: [L('lantern', 'Halfway. Boats coming in on the north side.')] },
          { when: { t: 165 }, spawn: [{ role: 'assault', at: 's1', n: 4 }, { role: 'sniper', at: 'd2', n: 1 }], say: [L('lantern', 'Last push. Don\'t give them the relay now.')] }],
        done: [L('lantern', 'Their orders are ours now. Their harbour officer is coming to see why.')] },
      { type: 'kill', label: 'Take out the harbour officer', checkpoint: true, cp: 'd1',
        spawn: [{ role: 'target', at: 'd2', n: 1, fixed: true, name: 'Harbour Officer', commander: true, escorts: 3 }],
        done: [L('lantern', 'That\'s the officer. His patrol boat is tied up at the north pier: sink it.')] },
      { type: 'plant', sites: ['h0'], plant: 3, fuse: 12, label: 'Sink the patrol boat', checkpoint: true, cp: 'd1',
        spawn: [{ role: 'guard', at: ['h0', 4, 3], n: 2 }, { role: 'assault', at: 's1', n: 3 }],
        done: [L('lantern', 'Boat\'s gone. Pull back to ours.')] },
      { type: 'extract', at: 's0', r: 6, time: 4, label: 'Fall back to the boats', checkpoint: true, cp: 'd1',
        spawn: [{ role: 'assault', at: 'd2', n: 2 }],
        done: [L('lantern', 'Seawall is done. And someone just asked us for help.')] },
    ],
  },
  {
    id: 'm4', n: 4, name: 'Kestrel', map: 'downtown', par: 780, insert: 's0', vip: { name: 'Kestrel', at: 'd0' },
    tag: 'Escort',
    brief: [
      ['Kestrel', 'The relay gave us a name: Doctor Hale, callsign Kestrel, the engineer who built the Line\'s signalling. She wants out.'],
      ['Your job', 'Walk her across Downtown to the east platforms. She stops and takes cover when shots come close, so clear the street ahead of her.'],
      ['Keep her up', 'If Kestrel goes down, so does the operation. Every street corner you reach is a checkpoint.'],
    ],
    bonus: { id: 'vip', label: 'Kestrel above half health' },
    steps: [
      { type: 'goto', at: 'd0', r: 5, label: 'Find Kestrel at the safehouse', checkpoint: true, cp: 's0',
        spawn: [{ role: 'guard', at: ['d0', 6, 4], n: 3 }, { role: 'patrol', at: 'd1', n: 2, route: ['d1', 'd0', ['~', 'd0', 'd2', 0.5]] }],
        say: [L('lantern', 'Kestrel is holed up in a safehouse on the west side. The Line is already sniffing round it.')] },
      { type: 'escort', route: ['d1', 'd2', 'd3', 'd4', 's1'], label: 'Escort Kestrel to the platforms', checkpoint: true, cp: 'd0',
        spawn: [{ role: 'guard', at: 'd2', n: 3 }, { role: 'guard', at: 'd3', n: 3 }, { role: 'guard', at: 'd4', n: 3 }],
        say: [L('kestrel', 'You\'re Lantern\'s people? Good. I\'ll follow you. Please don\'t let me get shot.')],
        on: [{ when: { gate: 1 }, spawn: [{ role: 'assault', at: 'd2', n: 3 }], say: [L('line', 'The engineer is on the move. Stop her.')] },
          { when: { gate: 2 }, spawn: [{ role: 'assault', at: 's1', n: 4 }, { role: 'sniper', at: ['d3', 6, 6], n: 1 }], say: [L('kestrel', 'There is a marksman up there. I\'m staying behind you.')] },
          { when: { gate: 3 }, spawn: [{ role: 'assault', at: 'd1', n: 3 }] },
          { when: { gate: 4 }, spawn: [{ role: 'assault', at: 'd2', n: 4 }], say: [L('lantern', 'Platform\'s ahead. They are coming up behind you.')] }],
        done: [L('lantern', 'You\'re on the platform. Her train is two minutes out: hold it.')] },
      { type: 'defend', at: 's1', r: 9, time: 90, label: 'Hold the platform for Kestrel\'s train', checkpoint: true, cp: 'd4',
        on: [{ when: { t: 4 }, spawn: [{ role: 'assault', at: 'd3', n: 3 }] }, { when: { t: 35 }, spawn: [{ role: 'assault', at: 'd4', n: 4 }], say: [L('kestrel', 'They are coming up the stairs!')] },
          { when: { t: 65 }, spawn: [{ role: 'assault', at: 'd2', n: 3 }, { role: 'sniper', at: ['d3', 6, 6], n: 1 }] }],
        done: [L('kestrel', 'I\'m on the train. Thank you. The plates they are making... they are for Kordell.')] },
    ],
  },
  {
    id: 'm5', n: 5, name: 'Long Fuse', map: 'foundry', par: 720, insert: 's0',
    tag: 'Sabotage',
    brief: [
      ['The furnace line', 'Kestrel says the Line is casting armour in the Foundry: plates for something heavy.'],
      ['Your job', 'Set charges on the three furnace feeds, then keep the Line off them until they blow. You have four minutes to set them all.'],
      ['Watch the charges', 'They will try to pull them. A pulled charge has to be set again.'],
    ],
    bonus: { id: 'charges', label: 'No charge pulled' },
    steps: [
      { type: 'goto', at: 'd0', r: 7, label: 'Get inside the Foundry', checkpoint: true, cp: 's0',
        spawn: [{ role: 'guard', at: 'd0', n: 2 }, { role: 'guard', at: 'd1', n: 3 }, { role: 'guard', at: 'd2', n: 3 }, { role: 'patrol', at: 'h1', n: 2, route: ['h1', 'd1', 'h0', 'd1'] }],
        say: [L('lantern', 'Three feeds, three charges. The furnace hall is locked: the foreman has the keys.')] },
      { type: 'kill', label: 'Take the foreman\'s keys', checkpoint: true, cp: 'd0',
        spawn: [{ role: 'target', at: 'h0', n: 1, fixed: true, name: 'Foreman', commander: true, escorts: 2 }],
        done: [L('lantern', 'Keys. Now the charges: you have four minutes once the first one is on.')] },
      { type: 'plant', sites: ['d0', 'd1', 'd2'], plant: 3, fuse: 40, timer: 240, label: 'Set the charges', checkpoint: true, cp: 'd0',
        on: [{ when: { planted: 1 }, spawn: [{ role: 'assault', at: 's1', n: 3 }], say: [L('line', 'Charges on the line! Pull them!')] },
          { when: { planted: 3 }, spawn: [{ role: 'assault', at: 's1', n: 4 }, { role: 'assault', at: 'h1', n: 3 }], say: [L('lantern', 'All three are on. Forty seconds. Keep them off.')] }],
        done: [L('lantern', 'That\'s the furnace line gone. Their fire crews are coming: hold the west hall until they give up.')] },
      { type: 'defend', at: 'd0', r: 8, time: 60, label: 'Hold the west hall', checkpoint: true, cp: 'd0',
        on: [{ when: { t: 3 }, spawn: [{ role: 'assault', at: 'h0', n: 3 }] }, { when: { t: 30 }, spawn: [{ role: 'assault', at: 'h1', n: 4 }] }],
        done: [L('lantern', 'They\'ve had enough. Move.')] },
      { type: 'extract', at: 's0', r: 7, time: 4, label: 'Get clear of the Foundry', checkpoint: true, cp: 'd0',
        done: [L('lantern', 'Kordell won\'t have his armour on time. He\'ll want to know who did it.')] },
    ],
  },
  {
    id: 'm6', n: 6, name: 'Kingfisher', map: 'frontier', par: 840, insert: 'p2',
    tag: 'Hunt',
    brief: [
      ['Kingfisher', 'The plates were sold before they were cast. Kingfisher, a broker who sells to anyone, is meeting a Line courier at the Freight Yard.'],
      ['Your job', 'He runs the moment he smells you: Freight Yard, Downtown, Central Station, then a plane at the Airfield. Lantern pings him every twenty seconds.'],
      ['Don\'t lose him', 'If he reaches the Airfield and his plane, he is gone. Take him down and take his phone.'],
    ],
    bonus: { id: 'early', label: 'Take him before his second stop' },
    steps: [
      { type: 'goto', at: ['~', 'p2', 'p3', 0.45], r: 8, label: 'Close in on the Freight Yard', checkpoint: true, cp: 'p2',
        spawn: [{ role: 'patrol', at: ['~', 'p2', 'p3', 0.3], n: 2, route: [['~', 'p2', 'p3', 0.3], ['~', 'p2', 'p3', 0.6], ['p3', -20, 0]] }],
        say: [L('lantern', 'Come in from the Steel Mill. Quietly: if Kingfisher sees you coming he is gone.')] },
      { type: 'kill', label: 'Take down Kingfisher', checkpoint: true, cp: ['~', 'p2', 'p3', 0.45],
        spawn: [{ role: 'target', at: 'p3', n: 1, fixed: true, name: 'Kingfisher', route: ['p0', 'p1', 'p14'], escorts: 2 },
          { role: 'guard', at: 'p3', n: 3 }, { role: 'guard', at: 'p0', n: 3 }, { role: 'guard', at: 'p1', n: 3 }, { role: 'patrol', at: 'p14', n: 3, route: ['p14', ['p14', 20, 0], ['p14', 0, 20]] }],
        say: [L('lantern', 'Kingfisher is at the Freight Yard. Grey coat, two minders. Go quietly or he runs.')],
        on: [{ when: { gate: 1 }, say: [L('magpie', 'Line, this is your buyer. I have company. Meet me at the station.')] },
          { when: { gate: 3 }, say: [L('lantern', 'He\'s at the Airfield. If that plane leaves with him, we lose him.')] }],
        done: [L('lantern', 'Kingfisher is down. Get his phone.')] },
      { type: 'goto', at: '@kill', r: 2.6, label: 'Take Kingfisher\'s phone',
        done: [L('lantern', 'Got it. A convoy schedule... Radio Hill to Canyon Dam. Tonight. Get to Central Station: the pickup is on its way.')] },
      { type: 'defend', at: 'p1', r: 10, time: 60, label: 'Hold Central Station for the pickup', checkpoint: true, cp: '@kill',
        on: [{ when: { t: 3 }, spawn: [{ role: 'assault', at: ['p1', 30, 0], n: 3 }] }, { when: { t: 30 }, spawn: [{ role: 'assault', at: ['p1', -25, 20], n: 4 }], say: [L('line', 'Kingfisher\'s killers are at the station. All units!')] }] },
      { type: 'extract', at: 'p1', r: 9, time: 5, label: 'Board the pickup', checkpoint: true, cp: 'p1',
        done: [L('lantern', 'Everyone aboard. Good hunting.')] },
    ],
  },
  {
    id: 'm7', n: 7, name: 'Dead Man\'s Run', map: 'frontier', par: 720, insert: 'p7',
    tag: 'Chase',
    brief: [
      ['The convoy', 'Kingfisher\'s phone had the schedule: a convoy of plates leaves Radio Hill for Canyon Dam tonight, on the old service track.'],
      ['Your job', 'You can\'t stop the convoy on open ground, but you can beat it to the dam on foot. Reach each relay before the clock runs out: every relay buys you time.'],
      ['At the dam', 'The convoy\'s commander waits at Canyon Dam. Take him out before the plates cross.'],
    ],
    bonus: { id: 'spare', label: 'Never drop under 15 seconds' },
    steps: [
      { type: 'chase', route: ['p10', 'p8', 'p9', 'p12', 'p11'], r: 12, timer: 50, add: 32, label: 'Reach the next relay', checkpoint: true, cp: 'p7',
        spawn: [{ role: 'guard', at: 'p10', n: 3 }, { role: 'assault', at: ['~', 'p7', 'p10', 0.55], n: 2 }],
        say: [L('lantern', 'Clock\'s running. Radio Hill first. Move!')],
        on: [{ when: { gate: 1 }, spawn: [{ role: 'guard', at: 'p8', n: 3 }], say: [L('lantern', 'Relay one. Harvest Farms next.')] },
          { when: { gate: 2 }, spawn: [{ role: 'guard', at: 'p9', n: 3 }, { role: 'sniper', at: ['p9', 8, -6], n: 1 }], say: [L('lantern', 'Grain Co-op. Keep running.')] },
          { when: { gate: 3 }, spawn: [{ role: 'guard', at: 'p12', n: 3 }, { role: 'assault', at: ['~', 'p9', 'p12', 0.5], n: 3 }], say: [L('line', 'Someone is running the track ahead of us. Cut them off.')] },
          { when: { gate: 4 }, spawn: [{ role: 'guard', at: 'p11', n: 3 }, { role: 'target', at: ['p11', 18, 12], n: 1, fixed: true, name: 'Convoy Commander', commander: true, escorts: 3 }], say: [L('lantern', 'Last relay. The dam is just ahead.')] }],
        done: [L('lantern', 'You beat them to the dam. Find the commander.')] },
      { type: 'kill', label: 'Take out the convoy commander', checkpoint: true, cp: 'p11',
        done: [L('lantern', 'Commander down. Now blow the dam road so the plates never cross.')] },
      { type: 'plant', sites: [['p11', -8, -6], ['p11', 8, 6]], plant: 3, fuse: 20, label: 'Blow the dam road', checkpoint: true, cp: 'p11',
        spawn: [{ role: 'assault', at: ['p11', 30, -10], n: 4 }],
        done: [L('lantern', 'The plates aren\'t crossing tonight. Kordell has nothing left to hide behind but himself.')] },
    ],
  },
  {
    id: 'm8', n: 8, name: 'Iron Crown', map: 'canyon', par: 840, insert: 's0',
    tag: 'Boss',
    brief: [
      ['Iron Crown', 'Marshal Kordell, the Line\'s commander, has climbed into a juggernaut suit and dug in at Canyon.'],
      ['Read him', 'When rings light up on the ground, his barrage is coming: get out of them. When he lines up a charge, step aside. When he kneels, his guard is on the way.'],
      ['End it', 'Bring Kordell down and the Line falls with him.'],
    ],
    bonus: { id: 'dodge', label: 'Nobody caught by a barrage' },
    steps: [
      { type: 'goto', at: 'd0', r: 7, label: 'Push into the canyon', checkpoint: true, cp: 's0',
        spawn: [{ role: 'guard', at: 'd0', n: 3 }, { role: 'sniper', at: 'h0', n: 1 }, { role: 'sniper', at: 'h1', n: 1 }],
        say: [L('kordell', 'Lantern\'s little squad. Come up the canyon, then. I\'ve been waiting.')] },
      { type: 'plant', sites: ['h2'], plant: 3, fuse: 8, label: 'Blow the gate to his yard', checkpoint: true, cp: 'd0',
        spawn: [{ role: 'guard', at: 'h2', n: 2 }, { role: 'assault', at: 'h3', n: 3 }],
        say: [L('lantern', 'His yard is gated. Put a charge on it.')] },
      { type: 'boss', at: 'h3', r: 30, label: 'Bring down Marshal Kordell', checkpoint: true, cp: 'h2',
        spawn: [{ role: 'boss', at: 'h3', n: 1, fixed: true, name: 'Marshal Kordell' }, { role: 'guard', at: 'd2', n: 2 }],
        say: [L('lantern', 'That\'s him. Watch the ground: rings mean his barrage is coming.')],
        on: [{ when: { phase: 1 }, say: [L('kordell', 'Guard! To me!')] }, { when: { phase: 2 }, say: [L('kordell', 'Enough. I\'ll do it myself.')] }],
        done: [L('lantern', 'Kordell is down. The Line is ours again. Operation Nightrail is complete. Thank you, all of you.')] },
    ],
  },
  // ---- Operation Starfall (appended): four missions after Nightrail ----
  {
    id: 'm9', n: 9, op: 'starfall', name: 'Dark Sky', map: 'observatory', par: 660, insert: 's0', night: true,
    tag: 'Night defence',
    brief: [
      ['After the crown', 'Kordell is gone, but the Line was never only his. Its board, the Directorate, has bought a launch: a satellite to take the signals back from orbit.'],
      ['Your job', 'The observatory dish is the only ear high enough to hear their launch telemetry. Wire Lantern\'s receiver into it and hold the summit until dawn.'],
      ['In the dark', 'No moon tonight. You see a few metres round you, and so do they. When a flare goes up, everyone sees everything: use it.'],
    ],
    bonus: { id: 'zone', label: 'Never let the dish fall below half' },
    steps: [
      { type: 'goto', at: 'h0', r: 6, label: 'Climb to the observatory', checkpoint: true, cp: 's0',
        spawn: [{ role: 'guard', at: 'h0', n: 2 }, { role: 'guard', at: 'd1', n: 3 }, { role: 'patrol', at: 'h2', n: 2, route: ['h2', 'd1', 'h3', 'd1'] }],
        say: [L('lantern', 'Lantern on the net. Welcome back. It is darker than it looks from here: stay close to each other.')] },
      { type: 'plant', sites: ['d1'], plant: 5, tap: true, label: 'Wire the receiver into the dish', checkpoint: true, cp: 'h0',
        spawn: [{ role: 'guard', at: ['d1', 4, 3], n: 2 }],
        say: [L('lantern', 'The dish is in the dome\'s courtyard. Plug me in and keep your heads down.')],
        done: [L('lantern', 'I can hear them. Launch telemetry, clear as a bell. Now hold that dish while I copy it.')] },
      { type: 'defend', at: 'd1', r: 9, time: 240, label: 'Hold the dish until dawn', checkpoint: true, cp: 'd1',
        on: [{ when: { t: 5 }, spawn: [{ role: 'assault', at: 's1', n: 3 }] },
          { when: { t: 40 }, spawn: [{ role: 'assault', at: 'b1', n: 3 }, { role: 'assault', at: 'h1', n: 2 }], say: [L('line', 'Movement at the dish. Light it up!')], flare: true },
          { when: { t: 85 }, spawn: [{ role: 'assault', at: 's1', n: 4 }] },
          { when: { t: 125 }, spawn: [{ role: 'assault', at: 'b0', n: 3 }, { role: 'assault', at: 'h3', n: 2 }], say: [L('lantern', 'Halfway. They are coming over the ridge path, north side.')] },
          { when: { t: 170 }, spawn: [{ role: 'assault', at: 's1', n: 4 }, { role: 'sniper', at: 'd2', n: 1 }], say: [L('line', 'Flares! Find them and finish it!')], flare: true },
          { when: { t: 210 }, spawn: [{ role: 'assault', at: 'h1', n: 3 }, { role: 'assault', at: 'b1', n: 3 }], say: [L('lantern', 'Nearly dawn. Don\'t give them the dish now.')] }],
        done: [L('lantern', 'Got it all. The launch is at their desert pad, and Kestrel... they have Kestrel. She was taken last night.')] },
      { type: 'extract', at: 's0', r: 6, time: 5, label: 'Ride the cable car down', checkpoint: true, cp: 'd1',
        spawn: [{ role: 'assault', at: 'd0', n: 3 }],
        done: [L('lantern', 'Down safe. Get some sleep. Tomorrow we bring her home.')] },
    ],
  },
  {
    id: 'm10', n: 10, op: 'starfall', name: 'Paper Lanterns', map: 'pagoda', par: 660, insert: 's0', stealth: true, vip: { name: 'Kestrel', at: 'b0', early: true },
    hostage: { clock: 45 },
    tag: 'Hostage rescue',
    brief: [
      ['Taken', 'The Directorate took Kestrel to make her finish their launch software. They are holding her in the bell tower of the hillside temple.'],
      ['Your job', 'Get in quietly, cut her loose and walk her out the west gate. Once she is free, the whole temple will know.'],
      ['Quiet first', 'Watchmen carry lanterns: stay out of the light. If they raise the alarm before she is free, they move her: you will have seconds to reach her.'],
    ],
    bonus: { id: 'quiet', label: 'Free Kestrel without an alarm' },
    alarm: { spawn: [{ role: 'assault', at: 's1', n: 4 }], say: [L('line', 'Intruders in the temple! Move the prisoner!')],
      later: { t: 40, spawn: [{ role: 'assault', at: 'h1', n: 3 }] } },
    steps: [
      { type: 'goto', at: 'h0', r: 4, label: 'Slip through the north gate', checkpoint: true, cp: 's0', stealth: true,
        spawn: [{ role: 'guard', at: 'd1', n: 2, stealth: true }, { role: 'guard', at: ['h3', -7, 9], n: 2, stealth: true }, { role: 'guard', at: 'd2', n: 2, stealth: true },
          { role: 'patrol', at: 'd0', n: 2, route: ['d0', 'h3', 'd1', 'h0'], stealth: true }, { role: 'patrol', at: 'h2', n: 1, route: ['h2', 'd1', 'h1', 'd1'], stealth: true }],
        say: [L('lantern', 'Same rules as the market: their lanterns are their eyes. Kestrel is in the bell tower, east end.')] },
      { type: 'plant', sites: ['b0'], plant: 4, hostage: true, label: 'Cut Kestrel loose', checkpoint: true, cp: 'h0', stealth: true,
        say: [L('kestrel', 'Is that... you came. Quick, the ropes. They check on me every few minutes.')],
        done: [L('kestrel', 'I\'m free. They will see the empty chair any moment.')] },
      { type: 'escort', route: [['~', 'b0', 'd0', 0.5], 'd0', 'h0', 's0'], label: 'Walk Kestrel out the west gate', checkpoint: true, cp: 'b0', loud: true,
        spawn: [{ role: 'guard', at: 'd0', n: 2 }],
        on: [{ when: { gate: 1 }, spawn: [{ role: 'assault', at: 'd1', n: 3 }], say: [L('line', 'The prisoner is out! Cut them off at the gate!')] },
          { when: { gate: 2 }, spawn: [{ role: 'assault', at: 'h2', n: 3 }, { role: 'sniper', at: 'h3', n: 1 }] },
          { when: { gate: 3 }, spawn: [{ role: 'assault', at: 's1', n: 4 }], say: [L('kestrel', 'The gate! Almost there.')] }],
        done: [L('kestrel', 'Lantern, they had me writing their uplink. I know where the launch codes go: a courier takes them to the pad tonight.')] },
      { type: 'extract', at: 's0', r: 6, time: 4, label: 'Get out of the temple grounds', checkpoint: true, cp: 's0',
        spawn: [{ role: 'assault', at: 'h0', n: 3 }],
        done: [L('lantern', 'Welcome back, Kestrel. Squad: find me that courier.')] },
    ],
  },
  {
    id: 'm11', n: 11, op: 'starfall', name: 'Cold Trail', map: 'jadefall', par: 720, insert: ['p4', -40, 4],
    tag: 'Pursuit',
    brief: [
      ['The courier', 'The Directorate\'s launch codes go to the pad by hand. Their courier lands at Port Coral tonight and runs for a boat at Turtle Bay.'],
      ['Your job', 'Stay on him through the port and up the coast. He wears plates and he will not stop: bullets barely slow him while he runs. Corner him at the bay and take the codes.'],
      ['Don\'t lose him', 'If none of you is close to him for long, he is gone. Keep someone on his heels.'],
    ],
    bonus: { id: 'close', label: 'Never lose sight of him' },
    steps: [
      { type: 'goto', at: ['p4', -14, 6], r: 8, label: 'Get into Port Coral', checkpoint: true, cp: ['p4', -40, 4],
        spawn: [{ role: 'guard', at: ['p4', -10, 4], n: 3 }, { role: 'patrol', at: ['p4', 6, -8], n: 2, route: [['p4', 6, -8], ['p4', 14, 10], ['p4', -6, 12]] }],
        say: [L('lantern', 'He is on the quay now. When he sees you he will run. Let him: just don\'t let him get away.')] },
      { type: 'pursue', r: 32, label: 'Stay on the courier', checkpoint: true, cp: ['p4', -14, 6],
        spawn: [{ role: 'target', at: 'p4', n: 1, fixed: true, name: 'Courier', route: [['~', 'p4', 'p5', 0.5], 'p5', ['~', 'p5', 'p15', 0.5], 'p15'], escorts: 2 },
          { role: 'guard', at: 'p5', n: 3 }, { role: 'guard', at: ['~', 'p5', 'p15', 0.5], n: 2 }, { role: 'guard', at: 'p15', n: 3 }],
        say: [L('lantern', 'There he goes. North along the waterfront. Stay on him!')],
        on: [{ when: { gate: 1 }, say: [L('line', 'Courier to escort: I have company. Keep them off me.')] },
          { when: { gate: 2 }, spawn: [{ role: 'assault', at: ['p5', 10, -12], n: 3 }], say: [L('lantern', 'Cannery Wharf. He is making for the coast road.')] },
          { when: { gate: 4 }, say: [L('lantern', 'He is cornered at the bay: his boat is not there. Finish it.')] }],
        done: [L('lantern', 'Courier down. The codes are on him.')] },
      { type: 'goto', at: '@kill', r: 2.6, label: 'Take the launch codes',
        done: [L('lantern', 'Got them. Launch is at dawn, Launchpad. Hold the bay: a boat is coming for you.')] },
      { type: 'defend', at: 'p15', r: 10, time: 60, label: 'Hold Turtle Bay for the boat', checkpoint: true, cp: '@kill',
        on: [{ when: { t: 3 }, spawn: [{ role: 'assault', at: ['p15', 26, 10], n: 3 }] }, { when: { t: 30 }, spawn: [{ role: 'assault', at: ['p15', -24, 18], n: 4 }], say: [L('line', 'They killed the courier! All units to the bay!')] }] },
      { type: 'extract', at: 'p15', r: 9, time: 5, label: 'Board the boat', checkpoint: true, cp: 'p15',
        done: [L('lantern', 'Everyone aboard. Next stop, the desert.')] },
    ],
  },
  {
    id: 'm12', n: 12, op: 'starfall', name: 'Zero Hour', map: 'launchpad', par: 900, insert: 's0',
    boss: { name: 'Director Vane', hp: 1.1, salvo: true, crest: 0x9ad8ff },
    tag: 'Final assault',
    brief: [
      ['Zero hour', 'The rocket stands on the pad, fuelled and counting down. Director Vane has come out to watch it go, in the Directorate\'s own heavy suit.'],
      ['Your job', 'Breach the tank farm, cut the fuel lines, then bring Vane down before the count reaches zero. Then abort the launch from the gantry.'],
      ['Read him', 'Rings on the ground are his barrage. A line of rings walking toward you is his salvo: get off the line. When he kneels, his guard is coming.'],
    ],
    bonus: { id: 'dodge', label: 'Nobody caught by a barrage' },
    steps: [
      { type: 'goto', at: 'h0', r: 7, label: 'Breach the tank farm', checkpoint: true, cp: 's0',
        spawn: [{ role: 'guard', at: 'h0', n: 3 }, { role: 'guard', at: 'd0', n: 3 }, { role: 'sniper', at: 'h3', n: 1 }, { role: 'patrol', at: 'h2', n: 2, route: ['h2', 'd0', 'h0', 'd0'] }],
        say: [L('vane', 'Lantern\'s squad. You are late. Watch the sky with the rest of them.')] },
      { type: 'plant', sites: ['d0', 'h2'], plant: 3, fuse: 15, timer: 240, label: 'Cut the fuel lines', checkpoint: true, cp: 'h0',
        spawn: [{ role: 'guard', at: ['d0', 3, 3], n: 2 }, { role: 'guard', at: ['h2', 3, -3], n: 2 }],
        say: [L('lantern', 'Two fuel lines run from the tank farm to the pad. Charges on both.')],
        on: [{ when: { planted: 1 }, spawn: [{ role: 'assault', at: 'd1', n: 3 }], say: [L('line', 'Charges on the fuel lines! Pull them!')] },
          { when: { planted: 2 }, spawn: [{ role: 'assault', at: 'h1', n: 3 }] }],
        done: [L('lantern', 'Lines cut. The count is still running: Vane is on the apron. Bring him down.')] },
      { type: 'boss', at: 'd1', r: 32, timer: 420, label: 'Bring down Director Vane before the launch', checkpoint: true, cp: 'd0',
        spawn: [{ role: 'boss', at: 'd1', n: 1, fixed: true, name: 'Director Vane' }, { role: 'guard', at: 'd2', n: 2 }],
        say: [L('vane', 'Seven minutes. You will not stop the count, and you will not stop me.')],
        on: [{ when: { phase: 1 }, say: [L('vane', 'Guard! Hold the apron!')] }, { when: { phase: 2 }, say: [L('vane', 'Then we go up together.')] }],
        done: [L('lantern', 'Vane is down! The count is still running: the abort is on the gantry. Go!')] },
      { type: 'hack', at: 'd1', r: 5, time: 40, label: 'Abort the launch', checkpoint: true, cp: 'd1',
        say: [L('kestrel', 'I wrote their uplink: the abort is mine. Keep them off the console and I will walk you through it.')],
        on: [{ when: { prog: 0.3 }, spawn: [{ role: 'assault', at: 's1', n: 4 }] }, { when: { prog: 0.65 }, spawn: [{ role: 'assault', at: 'b1', n: 3 }, { role: 'assault', at: 'b0', n: 3 }], say: [L('line', 'They are at the console! Stop them!')] }],
        done: [L('lantern', 'Launch aborted. The Directorate is finished. Operation Starfall is complete. Lantern out, for good this time.')] },
    ],
  },
];
// Each operation's missions, by index in MISSIONS (appended: Nightrail 0-7, Starfall 8-11).
export const OPERATIONS = [
  { ...OPERATION, from: 0, to: 8 },
  { ...OPERATION2, from: 8, to: 12 },
];
for (const o of OPERATIONS) for (let k = o.from; k < o.to; k++) if (MISSIONS[k]) MISSIONS[k].op = o.id;
export const opOf = k => OPERATIONS.find(o => k >= o.from && k < o.to) ?? OPERATIONS[0];
export const opOfMission = m => opOf(MISSIONS.indexOf(m));
export const MISSION_IDS = MISSIONS.map(m => m.id);
export const missionById = id => MISSIONS.find(m => m.id === id) ?? null;

// The mission and difficulty ride the match's scoreLimit (it means nothing else in this mode), so every phone, a
// rejoin and a host migration build the same script without any new field on the wire: (mission index + 1) * 10 + diff.
export const cpCode = (k, diff) => (Math.max(0, Math.min(MISSIONS.length - 1, k | 0)) + 1) * 10 + Math.max(0, Math.min(2, diff | 0));
export function cpDecode(code) {
  const n = Number(code) || 10;
  const k = Math.max(0, Math.min(MISSIONS.length - 1, Math.floor(n / 10) - 1));
  return { k, mission: MISSIONS[k], diff: Math.max(0, Math.min(2, n % 10)) };
}

// Every radio line of a mission, in one list (the wire sends an index): the steps' say, on.say and done lines, then
// the alarm's.
export function missionLines(m) {
  if (m._lines) return m._lines;
  const out = [];
  for (const s of m.steps) {
    for (const l of s.say ?? []) out.push(l);
    for (const t of s.on ?? []) for (const l of t.say ?? []) out.push(l);
    for (const l of s.done ?? []) out.push(l);
  }
  for (const l of m.alarm?.say ?? []) out.push(l);
  Object.defineProperty(m, '_lines', { value: out, enumerable: false });
  return out;
}
export const lineIndex = (m, line) => missionLines(m).indexOf(line);

// A place on a map from its name (see the top of the file). Raw coordinates: the sim moves them onto open ground.
export function cpPoint(map, ref, at = null) {
  if (Array.isArray(ref)) {
    if (ref[0] === '~') {
      const a = cpPoint(map, ref[1], at), b = cpPoint(map, ref[2], at), k = ref[3] ?? 0.5;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
    }
    const p = cpPoint(map, ref[0], at);
    return { x: p.x + (ref[1] ?? 0), z: p.z + (ref[2] ?? 0) };
  }
  if (ref === '@kill' && at) return { x: at.x, z: at.z };
  const pts = map?.points ?? {};
  const W = map?.width ?? 60, H = map?.height ?? 40;
  if (typeof ref === 'string') {
    if (ref === 'c') return { x: W / 2, z: H / 2 };
    const kind = ref[0], i = Number(ref.slice(1));
    if (kind === 's' && map?.spawns?.[i]?.length) {
      const list = map.spawns[i];
      // The middle spawn of that end, pulled a few metres in from the edge.
      const s = list[Math.floor(list.length / 2)], k = s.x < W / 2 ? 1 : -1;
      return { x: s.x + 4 * k, z: s.z };
    }
    const list = kind === 'd' ? pts.dom : kind === 'h' ? pts.hard : kind === 'b' ? pts.snd : kind === 'f' ? pts.ctf : kind === 'p' ? map?.br?.pois : null;
    const p = list?.[i];
    if (p) return { x: p.x, z: p.z };
  }
  return { x: W / 2, z: H / 2 };
}

// Stars: the bonus objective, the par time, and nobody in the squad killed (a retry counts as a death).
export function cpStars({ bonus = false, secs = 0, par = 600, deaths = 0, fails = 0 } = {}) {
  const list = [!!bonus, secs > 0 && secs <= par, deaths === 0 && fails === 0];
  return { list, n: list.filter(Boolean).length };
}

// The XP a cleared mission pays: by difficulty, per star, and once for the first clear.
export function cpXp({ diff = 1, stars = 0, first = false } = {}) {
  const d = CP_DIFFS[diff] ?? CP_DIFFS[1];
  const lines = [[`${d.name} clear`, d.xp]];
  if (stars > 0) lines.push([`Stars x${stars}`, stars * CP_STAR_XP]);
  if (first) lines.push(['First clear', CP_FIRST_XP]);
  return lines;
}

// ---- The save block (appended: js/shared/progression.js, save code slot [24]) ----
// {m1: [cleared difficulties as bits (1 Recruit, 2 Regular, 4 Veteran), best stars 0..3, best time (s, 0 none)], ...}
export function cleanCampaign(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const id of MISSION_IDS) {
    const v = Array.isArray(raw[id]) ? raw[id] : null;
    if (!v) continue;
    const mask = (Number(v[0]) | 0) & 7, stars = Math.max(0, Math.min(3, Number(v[1]) | 0)), secs = Math.max(0, Math.min(99999, Math.round(Number(v[2]) || 0)));
    if (mask || stars || secs) out[id] = [mask, stars, secs];
  }
  return out;
}
// One clear into the save block. Returns {first, vetAll (every Operation Nightrail mission now cleared on Veteran, and
// this clear did it), vetAll2 (the same for Operation Starfall), best, before}. Mutates the save.
export function recordCampaign(save, { id, diff = 1, stars = 0, secs = 0 }) {
  const cp = save.cp = cleanCampaign(save.cp);
  if (!MISSION_IDS.includes(id)) return { first: false, vetAll: false, vetAll2: false };
  const was = cp[id] ?? [0, 0, 0];
  const vetBefore = campaignVetAll(cp), vet2Before = campaignVetAll(cp, 1);
  const now = [was[0] | (1 << Math.max(0, Math.min(2, diff))), Math.max(was[1], stars), was[2] && secs ? Math.min(was[2], Math.round(secs)) : Math.round(secs) || was[2]];
  cp[id] = now;
  return { first: !was[0], vetAll: !vetBefore && campaignVetAll(cp), vetAll2: !vet2Before && campaignVetAll(cp, 1), stars: now[1], starsBefore: was[1], secs: now[2], secsBefore: was[2] };
}
// Every mission of an operation (0 Nightrail, 1 Starfall) cleared on Veteran.
const opIds = o => MISSION_IDS.slice(OPERATIONS[o].from, OPERATIONS[o].to);
export const campaignVetAll = (cp, o = 0) => opIds(o).every(id => ((cp?.[id]?.[0] ?? 0) & 4) !== 0);
export const campaignCleared = (cp, id) => ((cp?.[id]?.[0] ?? 0) & 7) !== 0;
// A mission is open once the one before it is cleared (on any difficulty); the first always is.
export const missionOpen = (cp, k) => k === 0 || campaignCleared(cp, MISSIONS[k - 1]?.id);
export const campaignStars = (cp, o = -1) => (o < 0 ? MISSION_IDS : opIds(o)).reduce((n, id) => n + (cp?.[id]?.[1] ?? 0), 0);

// Rewards. Lifetime tallies (save.life) drive the cards, emblem and skin through the usual unlock rules:
// cp:<mission id> one per clear, cp:vetall once every mission is cleared on Veteran.
export const CP_LIFE = id => `cp:${id}`;
export const CP_VET_LIFE = 'cp:vetall';
export const CP_SKIN = { id: 'skin:marshal-nightrail', operator: 'marshal', name: 'Nightrail', label: 'Clear every Operation Nightrail mission on Veteran' };
export const CP_EMBLEM = { id: 'feat-nightrail', name: 'Nightrail', label: 'Clear every Operation Nightrail mission on Veteran' };
// Operation Starfall's Veteran clear (appended): Kestrel's Starfall skin and the Starfall emblem.
export const CP_VET_LIFE2 = 'cp:vetall2';
export const CP_SKIN2 = { id: 'skin:kestrel-starfall', operator: 'sparrow', name: 'Starfall', label: 'Clear every Operation Starfall mission on Veteran' };
export const CP_EMBLEM2 = { id: 'feat-starfall', name: 'Starfall', label: 'Clear every Operation Starfall mission on Veteran' };
// An operation's Veteran rewards, by its index in OPERATIONS.
export const CP_OP_REWARDS = [{ skin: CP_SKIN, emblem: CP_EMBLEM, life: CP_VET_LIFE }, { skin: CP_SKIN2, emblem: CP_EMBLEM2, life: CP_VET_LIFE2 }];
// One calling card per mission: id, name, art (pattern and colours for js/shared/progression.js card()).
export const CP_CARDS = [
  ['cp-m1', 'Switch Room', 'circuit', ['#0e1820', '#1e3a4a', '#bfe6ff', '#7cc8ff']],
  ['cp-m2', 'Quiet Hours', 'waves', ['#120e1c', '#2a2240', '#d8c8ff', '#9a8cff']],
  ['cp-m3', 'Seawall', 'waves', ['#081a20', '#163a46', '#c8f4ff', '#38b6ff']],
  ['cp-m4', 'Kestrel', 'speed', ['#0e1c14', '#1e4a2e', '#c8ffd8', '#59d36b']],
  ['cp-m5', 'Long Fuse', 'pulse', ['#1a0d0a', '#6a2a10', '#ffd2a8', '#ff7a3a']],
  ['cp-m6', 'Kingfisher', 'rings', ['#1c1a10', '#4a4220', '#fff0b8', '#ffd27c']],
  ['cp-m7', 'Dead Man\'s Run', 'chevrons', ['#1c120a', '#5a3414', '#ffd9a0', '#ff9f1c']],
  ['cp-m8', 'Iron Crown', 'rays', ['#1c0a0a', '#5a1414', '#ffd0c8', '#ff4a3a']],
  // Operation Starfall (appended).
  ['cp-m9', 'Dark Sky', 'stardome', ['#060a16', '#1a2444', '#d8e4ff', '#9ad8ff']],
  ['cp-m10', 'Paper Lanterns', 'tiers', ['#140c10', '#4a2430', '#ffe0c8', '#ff8a3a']],
  ['cp-m11', 'Cold Trail', 'speed', ['#081418', '#1e3e46', '#c8f4ff', '#38d8c8']],
  ['cp-m12', 'Zero Hour', 'liftoff', ['#1a1008', '#5a3414', '#fff0d0', '#c8a8ff']],
];
