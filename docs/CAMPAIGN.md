# Co-op campaign: Operation Nightrail (ROADMAP item 59)

Eight short scripted missions for one to four players against the Meridian Line, a private rail-security company that
has seized the rail network. Friends join through a friend room; bots fill the rest of the squad. The story is told in
briefing cards and radio lines (text with a synthesised radio squelch, no voice acting). Mode id `cp`, rule set `cp`
(`js/sim/campaign.js`, registered in `js/sim/rules.js`); the missions, numbers and save rules in `js/shared/campaign.js`.

| # | Mission | Map | Kind | Steps |
|---|---|---|---|---|
| 1 | Switch Room | Railyard | Infiltrate and hack | reach the yard office, splice into the junction box, hack the signal terminal (waves at 35% and 70%), hold the box while it uploads, get out |
| 2 | Quiet Hours | Night Market | Stealth | slip in, plant two listening taps, photograph the ledger, copy the paymaster's laptop, get out: watchmen with torches, an alarm brings waves |
| 3 | Seawall | Harbor | Defend | take the pier relay, plug in, hold it 3:30 against five waves, take out the harbour officer, sink his boat, fall back |
| 4 | Kestrel | Downtown | Escort | find Kestrel at the safehouse, walk her through five stops to the east platforms, hold the platform for her train |
| 5 | Long Fuse | Foundry | Sabotage | take the foreman's keys, set three charges inside four minutes, keep the Line off them for the 40 s fuse, hold the west hall, get clear |
| 6 | Kingfisher | Frontier | Hunt | close in on the Freight Yard, take down Kingfisher before his plane leaves the Airfield, take his phone, hold Central Station for the pickup |
| 7 | Dead Man's Run | Frontier | Chase | five relays across the west of Frontier against the clock (each buys time), the convoy commander at the dam, blow the dam road |
| 8 | Iron Crown | Canyon | Boss | push into the canyon, blow the gate to his yard, bring down Marshal Kordell in his juggernaut suit |

## The mission script (`js/sim/campaign.js`)
- **The match carries the mission**: the scoreLimit is `cpCode(mission, difficulty)` ((index + 1) x 10 + difficulty),
  so the friend room's start, a rejoin and a host migration build the same script with no new field on the wire. The mode
  is never offered by a picker or a vote (`modeFitsMap` is false for it); it takes no modifiers and no scorestreaks.
- **Roster** (`buildCpRoster`, js/sim/sim.js): humans on team 0 (four at most), bot squadmates in the empty seats, one
  seat for an escorted VIP (team 0, AI, off the field unless the mission has one), then `CP.seats` (26) AI seats for the
  Line on team 1. Groups take seats as the script spawns them and give them back when they die.
- **States**: briefing (the warmup), live, failed (`CP.failHold` 7 s on screen), complete (`CP.endHold`, then the end).
- **Steps** (one objective each, in order): `goto`, `hack` (alone in the zone; an enemy inside pauses it), `defend`
  (hold for `time`; an enemy alone in the zone fills the lost meter, `CP.lostAfter` s to lose it), `escort` (the VIP walks
  the nav path to each stop while a squad member is within 9 m and no enemy within 10 m has a line on her; she can be hit
  only on the move: delivered, she is in cover), `plant` (stand
  still on each site; with a fuse the charges blow `fuse` s after the last one is set, and an enemy standing on one pulls
  it; `timer` to set them all), `kill` (every target down; a fleeing target runs stop to stop when the squad is within
  `CP.hvtNear` or after `CP.hvtWait`, and escapes after `CP.hvtEscape` at his last stop), `chase` (gates in order before the
  clock, each adds time), `boss`, `extract` (everyone up inside the zone for `time`).
- **Triggers** on a step: `{t}` seconds in, `{prog}` progress, `{gate}` stops reached, `{planted}` charges set,
  `{phase}` boss phase; each spawns groups and/or plays radio lines once (a bit each in `fired`).
- **Checkpoints**: a step with `checkpoint` sets the squad's respawn spot when it starts; escort stops, chase relays and
  the fleeing target's stops move it on during the step; a boss phase is a checkpoint of its own (his health at it), and
  so is each wave into a defence (a retry starts the hold from that wave). Back at a checkpoint part way through a step,
  the step's posts within 22 m of it are not put back.
- **Respawns, downs, wipes**: lethal damage downs a squad member while someone else is up (battle royale's crawl, 30 s
  bleed, a 4 s revive by a squadmate standing still beside them; bots go for the downed first). The dead come back after
  the difficulty's wait at the checkpoint, or behind a squadmate when the fight has moved more than 45 m from it.
- **Fail conditions**: the squad wiped (nobody up), the VIP killed, a timer run out, the zone lost, the target escaped.
  Failed, the mission waits `CP.failHold` s (Retry now skips it), then: the Line's seats cleared, the checkpoint's step
  started again (its triggers up to the checkpoint's stop count as fired), the squad stood up at the checkpoint. Abort
  (`{cmd:'cp', act:'abort'}`, a human) ends the match as failed.
- **Determinism**: only the sim's rng, the map and the script. Places resolve by pure geometry (`cpPoint` names: `s0`/`s1`
  the spawn ends, `d`/`h`/`b`/`f` points, `p<i>` Frontier places, offsets and lerps, `@kill`), moved onto open ground the
  same way on every phone. `dev/sim-campaign.mjs` plays one seed twice and compares every event.

## Enemy AI (the bot system with mission roles)
- **guard**: a post, spread round the spot, each looking its own sector and turning every few seconds.
- **patrol**: walks a route loop at walking pace (`BotBrain.calm`), the others in file behind the leader.
- **assault**: hunts toward the objective it is there to stop (the hack zone, the defended zone, a set charge to pull,
  the VIP) and into the squad when close; reinforcements walk in from out of sight.
- **sniper** (overwatch): holds a far spot with a marksman rifle or sniper and sees further (`sightK` 1.6).
- **target**: a fleeing HVT (or a commander who holds) and his minders, who stay close behind him.
- **boss**: Marshal Kordell (see below).
Guards and patrols are calm until they see, hear (gunfire near) or are shot at, then the group goes after it, on a 36 m
leash from home, and calms down 20 s after the last sign.

### Stealth (mission 2)
Watchmen are blind but for their torches: the rules see for them (`CP.detect`: 15 m, a 71° cone, line of sight). A
meter per watchman fills while someone of the squad is in the cone (faster close up and sprinting, slower standing
still; bots count half) and drains when nobody is. A full meter, an unsuppressed shot within 24 m of one (6 m
suppressed), a watchman shot and left standing, or a body another watchman can see raises the alarm: everyone's eyes
open (the squad's own bots are weapons-tight until then), the mission's alarm waves come in, and the Stay hidden bonus
is lost. The torches are drawn on the ground (a fan that warms as the meter fills); the HUD has a HIDDEN/ALARM chip and a
SUSPICIOUS meter.

### The boss (mission 8)
Marshal Kordell wears the Juggernaut suit (the armour look, drawn from `armor` on his view record), gilded with a crimson
visor, over a body a fifth bigger than his guard's (js/render/characters.js `bossLook`, keyed on `cpRole` 5), with a gold
crest turning over his head, a crimson beam on him and a crimson ring breathing at his feet (js/render/cp-fx.js: one
extra draw call, the crest; the beam and ring come from the objective pools). He has his own health
pool (`CP.boss.hp` 12,000 x the difficulty's `boss`); the bar on his head shows the pool. He shoots a light machine gun at a
fair rate and aim; his danger is the telegraphs:
- **Barrage** (every 8 / 6 / 5 s by phase): a red ring on (just ahead of) up to three of the squad, filling for 1.7 s,
  then a blast (45 damage x 0.7 / 1 / 1.3 by difficulty) on anyone still inside.
- **Kneel** at 66% and 33%: 3.5 s untouchable while he calls four of his guard from the arena's edges.
- **Charge** (phase 3, every other attack): a red line toward the nearest of the squad, 1.3 s to step aside, then he
  runs it at 15 m/s; 60 damage to anyone he passes.
Bots step out of rings and off the line. A retry brings him back at the phase's health.

## Difficulty, stars, rewards
| | Recruit | Regular | Veteran |
|---|---|---|---|
| Enemies | x0.7 | x1 | x1.25 |
| Damage they deal | 30% | 45% | 56% |
| Damage they take | 125% | 100% | 88% |
| Skill (rating) | 0.04 | 0.22 | 0.45 |
| Respawn wait | 8 s | 12 s | 15 s |
| Boss health | x0.7 | x1 | x1.25 |
| Timers | x1.25 | x1 | x0.85 |
| XP | 1,200 | 2,000 | 3,000 |

Stars (each 400 XP): the mission's bonus objective (Hack without a pause, Stay hidden, Never let the relay fall below
half, Kestrel above half health, No charge pulled, Take him before his second stop, Never drop under 15 seconds, Nobody
caught by a barrage), under the par time, and nobody in the squad killed with no retries (with humans in the squad only
their deaths count). The first clear of a mission pays 1,000 more and earns its calling card (group Campaign). Every
mission cleared on Veteran earns Marshal's Nightrail skin (tier Campaign) and the Nightrail emblem (a feat emblem).

## Save
`save.cp` (js/shared/progression.js, appended): `{m1: [cleared difficulties as bits 1/2/4, best stars, best time s]}`;
save codes carry it in slot [24] only when there is one (an older save keeps its old code). The lifetime tallies
`cp:<mission>` (one per clear) and `cp:vetall` (once) drive the cards, emblem and skin through the usual unlock rules. It
lives in `switchyard.save`, so the progress reset (docs/RESET.md) wipes it with everything else; the Campaign tab's last
pick is a `recall` entry in the options (emptied by the reset too).

## Menus and HUD
- **Multiplayer > Campaign** (js/ui/campaign.js, css/campaign.css): Operation Nightrail's route map (a station per
  mission: locked, open, cleared with its stars), the picked mission's plate (map, kind, first briefing card, best stars
  and time, par, Recruit / Regular / Veteran), With friends (a friend room set to the mission: up to four, bots fill the
  rest; the room moves on to the next mission after a clear) and Briefing.
- **Briefing**: the three cards, the objectives in order, the stars, what it pays, the difficulty, With friends, Deploy.
- **HUD** (js/ui/cp-hud.js): the mission chip, a timer chip while a clock runs, the stealth chip; the objective card
  (the step, what it needs now, the distance, a bar); radio subtitles typed in under the screen centre; screen tags on
  the objective, charges, Kestrel and the target's last ping; the boss bar with its phase marks; the downed and reviving
  bars; callouts (objective complete, checkpoint, alarm, phases, mission complete); the failed panel with Retry now and
  Abort. On Frontier the minimap is a window round you.
- **World** (js/render/cp-fx.js): the objective beam and zone ring, the terminal, charges with their lamps, the boss's
  rings and charge line, the watchmen's torches. Sounds (js/audio/cp-sfx.js): radio squelch, alarm, objective, checkpoint,
  fail and win stings, the barrage whistle, the charge growl, the phase horn, charges set and pulled.
- **Results**: Mission complete / Mission failed, the stars as the one number, the squad table and the stars table (each
  star, time, best). The main button is Next mission after a clear, Retry mission otherwise.

## Wire and migration
The objective block: `[t, flags (state, alarm, bonus, contested, VIP moving), step, progress, timer, gate, lost meter,
state clock, checkpoint, fails, deaths, why, sites, fuse, hazards, boss, target, VIP, ping, kill spot, per player (down,
revive, torch meter, role, target), revives, backup]`. Every 6 s the backup (groups and their seats, trigger bits, the
checkpoint's stop, timer, alarm and boss health, the boss's and target's clocks, per-seat toughness) rides along to the
humans' phones. `restore` rebuilds from the guest's mirror and that backup; living Line soldiers nobody claimed become one
assault group.

## Tests
- `node dev/sim-campaign.mjs [--quick | --full]`: places on walkable ground on every map, codes, stars, XP, the save
  block and save code, a wipe and the retry at the checkpoint, every other fail (VIP, the charges' clock, the zone, the
  escaped target, the chase clock), stealth (the torch meter, gunfire, weapons-tight bots, the alarm waves), Abort and
  Retry now, determinism, host migration mid-escort and mid-boss (the new host finishes the mission), then every mission
  played to the end by a squad of bots (Regular twice and Recruit by default, Veteran with --full).
- `python3 dev/ui-campaign-test.py [port] [outdir]`: the tab, the briefing, mission 1 solo through a checkpoint, a wipe
  and Retry now, forced to the end, the results and rewards, the torches and alarm of mission 2, the boss of mission 8,
  screenshots in /tmp/campaign.

## Measured (node dev/sim-campaign.mjs --full, bot squads, 2026-11-20)
Bot squads clear every mission on every difficulty. Times are bots' (they rush, trip every alarm and never sneak;
people take longer, about the par times). Per-guest snapshots about 2.4-2.7 KB.

| Mission | Regular (2 seeds) | Recruit | Veteran |
|---|---|---|---|
| Switch Room | 3:01, 2:58 | 2:53 | 3:24, 1 retry |
| Quiet Hours | 1:12 (1 retry), 1:08 | 1:03 | 1:08, 1 retry |
| Seawall | 4:58, 4:34 | 4:33 | 7:26, 10 retries |
| Kestrel | 3:22 (3 retries), 3:00 (1) | 2:38 | 6:28, 16 retries |
| Long Fuse | 2:35, 2:38 | 2:21 | 2:50, 1 retry |
| Kingfisher | 1:36, 1:34 | 1:33 | 3:23, 3 retries |
| Dead Man's Run | 1:56, 1:50 | 1:31 | 2:15, 2 retries |
| Iron Crown | 3:46 (8 retries), 2:58 (5) | 1:15 | 11:54, 35 retries |

Tuning that got here: the boss's pool (4,200, then 24,000: bots deal far less than their paper damage, so 12,000) and his
gun (an elite LMG wiped squads in seconds: now a fair aim at 22-32% damage, the telegraphs are the threat); his phase
health as a checkpoint; a wave into a defence as a checkpoint; no posts respawned on a squad back at a mid-step
checkpoint (Kestrel's retries used to land on the guards of the stop she had reached); Kestrel in cover once delivered;
Veteran at 1.25x enemies dealing 56%.
