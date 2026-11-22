# Modes overhaul (V10)

Six new 6v6 modes on the small, medium and large maps, two Ground War versions on the huge maps, four modifiers that
go with any mode, and a featured playlist that changes every day. None of them is offered on the giant battle royale map.

| id | name | one line | sizes | points |
|---|---|---|---|---|
| hq | Headquarters | Take the HQ and hold it. While it stands, its team cannot respawn. | S M L | hardpoint zones (or Domination flags) |
| ko | Kill Order | Each team has a marked VIP. Only killing theirs scores. Guard yours. | S M L | none |
| inf | Infected | Killed by the infected, you join them. Survive the clock to win. | S M L | (hardpoint zones as survivor holds) |
| oic | One in the Chamber | One bullet, one-shot kills, five lives. A kill gives the bullet back. | S M L (5/6/8 players) | none |
| ctl | Control | Attack two zones or defend them, sides swap each round. Limited lives. | S M L | the bomb sites, widened to 5 m |
| grind | Grind | Grab tags from kills and carry them to a bank. Die and you drop them all. | S M L | outer Domination flags as banks |
| gwhq | Ground War HQ | 16 v 16 Headquarters. | huge | Domination flags |
| gwko | Ground War Kill Order | 16 v 16 Kill Order. | huge | none |
| gwinf | Ground War Infected | 32 players, two start infected. | huge | (hardpoint or Domination points as survivor holds) |

`MODES` (js/shared/modes.js) declares `sizes` and `needs` (point sets, any one of a list); `modeFitsMap` checks both,
and `everyHuge` puts a Ground War mode on every huge map. `look` is the rule set the renderer and HUD draw the mode's
zones as (HQ as a hardpoint, Control and Grind as Domination flags).

## Code
- Rules: one module per rule set, `js/sim/{hq,ko,inf,oic,ctl,grind}.js`, registered in `js/sim/rules.js`, which documents
  the hooks the Sim calls through `sim.rules` (step, onLive, onSpawn, onKill, damage, holdDead, spawnFlow, timeUp, kit,
  plan, playerView, view/encode/decode/restore). Shared helpers in `js/sim/mode-kit.js`.
- Mode state rides the snapshot's objective block, the view as `view.obj` and `view.points.obj` (`objOf`), and host
  migration through `restore`. Infected changes sides: every change is a `{t:'team'}` event before the spawn that
  follows it, and the block carries the whole list. One in the Chamber's round lives on the phone like all ammo: the
  loadout's `rounds` (player.js) and an `{t:'ammo'}` refund event (match.js).
- Bots: each module's `plan(team, crew)`, called from `planObjectives` (bots.js). HQ: everyone on the HQ, holders guard
  it with long guns outside, thinkers rotate to the next site. Kill Order: the VIP stays with the pack, two guard it,
  the rest hunt the enemy VIP. Infected: survivors hold several spots in small groups (see "Infected bots"); the
  infected spread over the survivors and come in from the side. One in the Chamber: free-for-all fighting; out of rounds, the blade. Control: attackers stack the zone
  they have most on (a third split to the other); defenders weight the threatened zone. Grind: pick up near tags, bank
  at 3 or when a bank is near, one guard on the home bank.
- Modifiers and the featured playlist: `js/shared/playlist.js` (`cleanMods`, `dealLoadout`, `featured`). The Sim takes
  `mods`; phones deal their own loadout with `Sim.dealFor` at each spawn. Battle royale and the range take none; the
  modes that deal guns (Gun Game, One in the Chamber, Infected) ignore Snipers and Melee.
- UI: `js/ui/mode-hud.js` (status plate, wait plate on the death screen, VIP tags, minimap, banners, scoreboard and
  results column), `js/ui/modifiers.js` (toggles in the bot match sheet and the friend lobby's chip and sheet, the
  featured button on the title and the picker).
- Tests: `node dev/sim-modes-v10.mjs [quick]`; `node dev/map-validate.mjs` checks each new mode's points per map and runs
  a bot match per hosted mode.

## Fix: the next HQ never opened (owner report)
The host decodes its own snapshot every tick for its view (`Match.#pushHostView`). `HqRules.decode` wrote the block's
rounded numbers back into the live rules: the gap's clock is sent as `ceil(t * 10)`, so 5 s minus one tick came back as
5.0 and the gap never ended. Headless tests never decoded on the host, so they missed it. Control had the same fault
with zone capture (one attacker adds 1/270 a tick, rounded away to nothing). Now `Sim.step` marks the stepping sim as the
authority and `decode(a, out, host)` leaves a host's own state alone (hq.js, ctl.js; the other modules only copy exact
values). `dev/sim-modes-v10.mjs` runs HQ as a host does (step, encode, decode) over five maps and two seeds and Ground
War HQ, through host migrations in the gap and while held, and Control's lone capture.

## Tuning notes (bot-only matches)
- One in the Chamber with bots is quick (about a minute on a small map): bots land the one round often. Lives went
  from three to five and the field down to 5/6/8 to stretch it.
- Control on small maps is mostly decided on lives; attackers get 7 lives a player, defenders 5.
- Ground War Infected (`MODES.gwinf.inf` overrides `INF`): two first infected; the alphas take half damage while the
  infected are two or fewer; infected respawn at a spawn about 120 m or less from the nearest survivor (`spawnNear`,
  without it they spawned across the map and were shot on the way back); survivor bots split into two holds (`holds`;
  thirty stacked on one spot never fell on Expedition); five-minute clock. Measured (bots, 3 huge maps x 5 seeds):
  survivors 6, infected 9 (before the spawn cap: survivors won every Expedition match 27-5 and lost every other).
- Infected: the infected throw Shivs, not Hatchets (one-hit throws ended matches in 90 s).
- Infected bots (ROADMAP 25; js/sim/inf.js `plan`). Survivor bots used to stack one hardpoint and wait. Now they form
  groups of 4, 4, 1 and 3 in the order they join (Ground War keeps its `holds` big groups). Each group holds its own
  haven: one of the mode's zones or a hold point (up to 24 spots, 9 m or more apart), 16 m or more from the other
  groups' spots and within 22 m of one of them, so neighbours can cover each other. Members commit to the spot and each
  watches its own side of it, turned toward the nearest infected (`aim` on a bot objective, bots.js). A group moves on
  after 60-100 s, or 8 s after it loses someone, but only with no infected within 22 m. With more infected than members
  within 12 m of the spot it falls back on a neighbouring group's spot. The loner roams every 12-20 s while 7 or more
  survivors are left. Groups close ranks as survivors fall: one group per four. The infected pick prey with a cost for
  each other infected already on it, and from 18 m out they swing in from alternate sides.
  Measured over oasis, canyon, railyard and dust, 8 seeds each (32 matches):

  | | Survivor clusters (12 m) | Biggest cluster | Survivors win | Mean round |
  |---|---|---|---|---|
  | Before (one camp) | 1.19 | 97% | 11/32 | 178 s |
  | Small groups, no commit or close ranks | 3.8 | 44% | 0/32* | ~105 s |
  | Shipped | 2.40 | 63% | 7/32 | 161 s |

  *First cut, 8 matches. Small groups spread thin lost one by one. Committing to the spot, moving only when it is
  quiet, falling back on friends and closing ranks brought the rounds back near the old length.

## Play flow (ROADMAP item 14)
- **Multiplayer** (title hero; `js/ui/matchmaking.js` data, `js/ui/playscreens.js` screens, flow in `main.js`
  `findMatch` / `startMpVote` / `launchMp`): tabs Standard (with Showdown 2v2), Ground War, Battle Royale (Quads, Duos, Solos, Rebound Quads and Duos) and
  Extraction (Quads, Duos; docs/EXTRACT.md). A pick is one playlist (Quick Play, Objective, Party modes, today's Featured with its modifiers)
  or one or more ticked modes. Find match: a short search, then the pre-match lobby on the vote screen with 2-3 maps of
  the tab's size tier (`mpVoteOptions`; one card on Battle Royale, which has one giant map) while the other seats'
  ballots come in, then the match. No map or difficulty pickers. **Quick play** on the title is Standard Quick Play;
  results' main button is Next match (the same pick again).
- **Bot seam**: `pickBotsForMatch({humans, mode, mapId, seed})` in `js/ui/matchmaking.js` fills every Multiplayer match
  and every friend lobby map-vote match (default mixed difficulty). The bot overhaul replaces its body.
- **Custom**: Match is the old solo picker (map by size, mode, modifiers, bots per side, difficulty, limits); Host room
  opens the friend lobby with those settings (`app.lobby.custom`, sent to guests, shown on the lobby chip). In any
  friend lobby the host can swap the map vote for custom settings and back. Training: the firing range, or any map with
  1-12 enemy bots (difficulty), switches for infinite ammo and no death (the sim stands you back up in place), bot
  behaviour (normal, standing, strafing, rushing: `BotBrain._drill`), the range readout on every bot, and the Armory
  (`js/ui/trainarmory.js`; the sim's `trainSwap` puts an owned gun on at once). The Sim takes `training`.
- **Training never counts**: `Match.isPractice()` (range, training, tutorial) sets `practice` on MatchAwards and
  MatchTelemetry, the only writers of XP, levels, weapon XP, mastery, challenges, history, career stats and gun stats.
  `dev/ui-flow-test.py` checks the stored save, challenges, history and gun stats are unchanged after a session.

## Showdown (ROADMAP item 31)
The roadmap's "Gunfight": 2 v 2 rounds. Mode `gf` (js/shared/modes.js; rules js/sim/gf.js, registered in js/sim/rules.js),
`sizes: ['small']`, so it plays on Pier, Turnstile, Oasis, Ruins and Millbrook. On the Standard tab as its own playlist (Showdown
2v2) and a tickable mode; in the featured rotation; its rule set brings a "Play 2 Showdown matches" daily challenge.
Solo is you and a bot against two bots; two friends in a room play the bots. Lobby size 4.
- Rounds as in Control: freeze (`GF.freeze` 5 s, sim phase warmup), live, post (4 s). One life a round (`holdDead`), no
  health regeneration (`noRegen` on spawn), no scorestreaks. Wipe the other pair to win the round. After the 40 s round
  clock (the mode's `timeLimit`) the overtime flag rises (`GF.ot` 15 s): a side alone on it for `GF.capture` 3 s takes the
  round (a second player on it is half again as fast; the other side alone on it first wears the progress down);
  both on it holds it. At the end of overtime the side with more health left wins; level is a drawn round, no point.
  First to 6 (`scoreLimit`); after `GF.maxRounds` 15 the leader takes it.
- The flag (`flagSpot(map)`): the middle of the line between the two ends' spawns, moved to the nearest spot with room
  round it. Pure geometry, so every phone puts it in the same place; drawn as a hardpoint (`look: 'hard'`) while it is
  up (sim.points holds it only in overtime).
- Kits: `kitFor(seed, k)` deals kit k (a primary from the six primary classes, weighted toward rifles and SMGs, two or
  three attachments, a pistol, a lethal and a tactical, the same three perks) from the match seed; it changes every
  `GF.kitEvery` 2 rounds, and the pairs swap ends with it. The host re-deals everyone's loadout at the round start; a
  phone deals its own through `Sim.dealFor`, its codec's rules taking the `{t:'gf', kind:'round'}` event before the
  spawns that follow it (match.js calls `rules.event`). Players' cosmetics for the dealt gun stay theirs. Snipers Only and
  Melee Only do not apply (playlist.js `DEALT`); Hardcore does.
- Bots (`plan`): the pair walks up toward the middle a few metres apart for the first 6-8 s, then hunts the nearest
  living enemy, the second of the pair swinging 7 m wide of the line; in overtime both go to the flag.
- HUD (js/ui/mode-hud.js `_gf`): the plate says "Round N" in the freeze (and whether the kit is new), "2 v 1" while live,
  "Overtime: take the flag", with the rounds score; every enemy's health as a bar over their head; on the death screen
  the watch plate (tap to switch); banners for the round, overtime and its end; scoreboard column Rds (rounds won).
- Tests: `node dev/sim-gunfight.mjs [--quick]` (maps, kits the same for everyone and changing every two rounds, a phone
  dealing the host's kit, the flag on walkable ground, overtime by the flag, by health and drawn, both on the flag,
  rosters solo and with a friend, determinism, bot matches on every small map: rounds of 7-12 s of play, 2.3-3.9 minute
  matches). `python3 dev/ui-modes2-test.py [port]` (playlist, the match on a small map, the plate, one kit, enemy health
  tags, the watch plate, round 2, results).

## End of match: what the banner and results header say
One function decides it for every mode, `matchHeader` in `js/ui/outcome.js`: the results header (`js/ui/results.js`)
draws it, and the end banners (`js/ui/hud.js`, `ex-hud.js`) use its word and line, so the two always agree (battle
royale's and Graveyard Shift's banners say the same in their own layers). A score sits by the word only where it
means something. `python3 dev/ui-endings-test.py [port]` ends a match of every mode and checks this table.

| Mode | Headline | Line under it | Score by the headline |
|---|---|---|---|
| TDM, Kill Confirmed, Domination, Hardpoint, Headquarters, Kill Order, Grind (and their Ground War versions) | Victory / Defeat / Draw | The yard is yours / lost / Neither side broke through | team score, yours - theirs |
| Search and Destroy, Control, Showdown | Victory / Defeat / Draw | Won 4 rounds to 2 (Lost ..., Level at N rounds each); S&D's banner adds how the last round went | rounds won, 6 - 4 |
| Capture the Flag | Victory / Defeat / Draw | Won 3 captures to 1 (Lost ..., Level at ...) | captures, yours - theirs |
| Conquest | Victory / Defeat / Draw | Their tickets ran out, More tickets at the clock (and the losing side's own) | tickets left, yours - theirs |
| Breakthrough | Victory / Defeat | Broke through all 3 sectors, Out of tickets (or time) at sector 2 of 3, Held at sector 2 of 3, All 3 sectors fell | sectors: taken (attackers) - still standing (defenders) |
| Infected | Victory / Defeat (by the side you ended on) | You held out to the end / N survivors held out / Everyone was infected | one number: Survivors N |
| Free-for-All, Gun Game, One in the Chamber | 1st place / 2nd place / ... | Nobody else came close, One short of the top, On the podium, or who took the yard (Gun Game: Through every gun) | your score - the best other score (Gun Game: guns) |
| Battle Royale, Duos, Solos, Rebound | Victory, or 3rd place | Last squad standing, or #3 of 8 squads (players in Solos) | one number: #3, "of 8 squads" |
| Extraction (Quads, Duos) | Extracted / Squad wiped / Out of time / Left the match | 2 contracts banked · 2,550 XP, or 3 contracts lost: nobody got out | none |
| Graveyard Shift | Escaped / Overrun / Left behind (the crew got out without you) | Escaped on round 18, or Survived 12 rounds · best 15 (records and the Gravewarden added) | one number: Round N |
| Ranked (any ranked mode) | as the mode | as the mode, then · +24 SR (or · Placement 2/5, · Placed) | as the mode |
| Training (Custom > Training) | Training over | Practice: no XP, no record | none (only if its 100-minute clock ever runs out; leaving goes back to Training) |
| Firing range, tutorial | no results screen: the range is left from its menu, the tutorial ends on its own sheet | | |

Left a team match early: Defeat, "You left before the end". Before this, Extraction's header put contracts banked
against contracts lost as if they were a score ("0 - 2" after a wipe), battle royale's put the place against the
squad count ("3 - 8"), and draws said Stalemate on the banner.

## Conquest and Breakthrough (ROADMAP 65)
Two Battlefield-style modes, 16 v 16 (32 players at most), on every Ground War map (Harvest, Downtown, Expedition,
Tidebreak, Coral Quarter) and on parts of the battle royale islands (Frontier: Downtown and Southbound; Jadefall: West
Isle and Coast Road). No vehicles, classes or squad spawns. Mode ids `cq` and `bt` (js/shared/modes.js, `bf` marks the
family, `look: 'dom'` draws their flags as Domination flags); rules js/sim/conquest.js and js/sim/breakthrough.js
(registered in js/sim/rules.js), shared host helpers js/sim/bf-kit.js, the numbers and layouts js/shared/bf.js.

| id | name | one line |
|---|---|---|
| cq | Conquest | 5-7 flags, a ticket pool a side; deaths cost tickets, holding more flags drains theirs; spawn on held flags or HQ |
| bt | Breakthrough | attackers take 3-4 sectors in turn on a limited, refilled ticket pool; defenders fall back line by line |

### Layout format (for any map, the districts maps included)
A map hosts these modes when it has a layout: declare them in `map.bf`, or (any map with three or more Domination
flags and two spawn lists, i.e. every Ground War map) get one derived. Everything is pure data and geometry, read the
same way by the host, every phone, the HUD, the renderer and the bots from the map and the match seed: nothing about
the layout rides the wire.

```js
map.bf = {
  conquest: [{
    id: 'downtown', name: 'Frontier: Downtown',   // name: the intro card, the vote card (on an island part)
    area: { x, z, w, h },                         // the field; outside is out of bounds (omit: the whole map)
    hq: [{ x, z, r }, { x, z, r }],               // team 0's and team 1's HQ: always a spawn, never capturable
    flags: [{ id: 'A', x, z, r?, name? }, ...],   // 5-7 flags; r defaults to BF.radius (5.5 m)
    tickets?,                                     // each side's pool (default BF.cq.tickets by flag count)
  }],
  breakthrough: [{
    id, name, area,
    hq: [{ x, z, r }, { x, z, r }],               // hq[0] the attackers' end, hq[1] the defenders' last stand
    sectors: [{ name, objs: [{ x, z, r? }, ...] }, ...],   // 3-4 sectors from hq[0] toward hq[1], 1-2 objectives each
    tickets?, refill?,                            // the attackers' starting pool and what a fallen sector adds
    clock?, defendDelay?,                         // seconds a sector (300) and extra defender respawn wait (0)
  }],
};
```

- Objectives are lettered A, B, C... in play order; flags keep their ids. An HQ may carry `spawns: [{x, z}]`; without
  them up to 16 spots are found round its centre by geometry (no nav grid needed: the opening places everyone).
- **Front lines are not data.** The attack axis runs from hq[0] to hq[1]; each line lies across it halfway between one
  sector's farthest objective and the next sector's nearest (`lines`, metres along the axis; `lineSegment(l, s)` clips
  one to the area for drawing). So place objectives in order along the axis, with room between sectors.
- A map with several layouts of a kind plays the one the seed picks (`bfLayout(map, kind, seed)`); which side attacks
  in Breakthrough is the seed's too (`btAttackers`). The vote card names a single island layout ("Frontier: Downtown").
- Derived layouts (no `map.bf`): Conquest takes the Domination flags (radius at least 5.5 m) and the spawn lists as HQs;
  Breakthrough sorts the flags along the axis from team 0's spawns to team 1's and groups them 2-1-2 (five flags),
  1-2-1 (four), 2-2-2 (six), 2-1-2-2 (seven). The area is the whole map, so there is no out of bounds but the lines.
- `node dev/sim-conquest.mjs` and `dev/sim-breakthrough.mjs` check every layout of every map that hosts the modes:
  each point on walkable ground, reachable on foot from hq[0] inside the area, lines in order, then play bot matches on
  it. A district map that declares layouts is picked up by both with no change (`--maps=<id>` runs one).

### Conquest
- Flags start neutral. Whoever has more players on a flag moves it their way, faster with a bigger edge
  (`BF.capture` 10 s alone from neutral, `BF.crowd` by the edge); equal numbers: contested, nothing moves. A held flag
  goes neutral before it changes hands; left alone part taken it drifts back. (`stepFlag`, js/sim/bf-kit.js.)
- Tickets: each side starts with the layout's pool (850 for five flags, 1050 for seven; the custom score limit is a
  percentage of it). A death costs one; while one side holds more flags, the other bleeds `BF.cq.bleed[lead]` a second
  (+`allBleed` holding every flag). Zero loses; at the 20-minute clock more tickets wins. sim.scores are tickets.
- Spawns: the HQ, or a flag the side holds outright, not contested, with no enemy within 22 m (`canDeploy`); spots in a
  6-13 m ring round it from the nav grid (`spawnSpots`, `bestSpot`: away from enemies and their sight). The phone picks
  on the death screen ({cmd:'bf', act:'deploy', at}); Auto is the held flag nearest the front. Bots deploy at the held
  flag nearest where they were sent.
- Bots: two or three back to any held flag under attack, a small quota on calm ones, the rest spread over the flags the
  side does not hold (each flag's load costs, at most a third of the free bots on one), half hunting when everything is
  held. On an island part a bot near the edge walks back in first.
- Events `{t:'cq', kind:'capture'|'neutral'|'low'|'all'|'deploy'}`; medals cq_capture, cq_neutral (and defend).

### Breakthrough
- Only the current sector's objectives are live; they start the defenders'. Attackers take one as a Conquest flag
  (slower: `BF.bt.capture` 16 s alone), and each one taken puts a minute back on the sector clock; defenders can take it back. All held at once: the sector falls, the attackers
  get `refill` tickets, the sector clock (5 minutes, or the layout's `clock`) restarts, and the next objectives stay locked
  for `BF.bt.lock` s while both sides move up.
- Attackers spend a ticket a death; at zero they stop respawning and lose when the last is down. Defenders respawn
  freely (a layout's `defendDelay` s later than usual: the islands' 1.5 s). The clock running out with no attacker on a live objective ends it
  for the defenders; with one on it, overtime. sim.scores: the attackers' sectors taken, the defenders' still standing.
- Bounds: attackers may not go more than `BF.bt.margin` past the line ahead, defenders no further back than the line
  behind; outside, the out-of-bounds clock (8 s, then death without credit). Defenders caught behind a fallen line get
  `BF.bt.fallBack` 12 s ("Fall back").
- Spawns: attackers 18-34 m short of the sector's nearest objective, never past the line behind it (and the HQ in
  sector one); defenders 14-30 m behind its farthest objective, 16 m or more from any live objective (the last sector
  adds their HQ). Both sides walk about as far to the fight.
- Bots: attackers spread over the objectives still to take (two hold one taken), pushing onto it shooting on the move
  within 18 m (`commit`); defenders split over the objectives, four more on one under attack, long guns covering from
  behind, most of the side back to retake a lost one.
- Events `{t:'bt', kind:'capture'|'neutral'|'retake'|'sector'|'overtime'|'low'|'end'}`; medals bt_capture, bt_sector.

### Tuning (bot-only matches, 32 mixed bots, every map, two seeds; `dev/sim-conquest.mjs`, `dev/sim-breakthrough.mjs`)
- Bots die often: about 60 deaths a minute a side on a Ground War map, so pools are big (850 tickets for five flags).
  Conquest: matches of 7-9 minutes on the Ground War maps and 9-12 on the island parts, both sides winning
  (6 / 8 over 14), 7-49 flag captures a match, bots on 2.3-3.2 flags a side at any moment, stuck under 0.2 s a bot a
  minute, host tick 0.45-0.7 ms mean.
- Breakthrough took the most work. With defenders spawning beside the objectives and attackers at the HQ, no sector
  ever fell on the islands; with attackers pushing onto the objective (`commit`) and defenders delayed, Ground War
  sectors fell in under a minute. Shipped: both sides spawn about as far from the objectives (the bands above), a
  slower capture (16 s), a 12 s lock after a sector falls, and the islands' own `clock` (7 min), `defendDelay` (1.5 s)
  and bigger pools, and a minute back on the clock for every objective taken. Measured after the merge with
  destruction: attackers won 4 of 14 and reached the last sector in 5 more, 3-15 minute matches, stuck under 0.25 s
  a bot a minute, host tick under 0.7 ms mean. Conquest over the same maps: 6 / 8, 7-13 minutes.

### Wire, migration, replays
- Conquest's block: tickets (ds), every flag packed (`packZone`), stats (cqCaps, oob ds). Breakthrough's: sector,
  tickets, pool size, overtime and done bits, the end's reason, the lock (ds), the live objectives packed, stats (btCaps,
  oob ds). The host decoding its own snapshot keeps its exact state (as Headquarters does). `restore` rebuilds both from
  a guest's view, sector and lock included; Conquest's pool size is not scaled twice (scoreLimit stays the percentage).
- Replays record the flags (view.points) as any Domination match; the front lines draw from the view's mode block,
  which shared replay codes leave out, so a shared code shows the flags without the lines.

### HUD, world, menus
- js/ui/mode-hud.js `_cq` / `_bt` paint the status plate (ticket bars, flags held; the sector, its objectives and the
  attackers' tickets, the lock and overtime); js/ui/bf-hud.js adds the deploy row on Conquest's death screen, the
  out-of-bounds plate, and on the minimap the HQs, Breakthrough's lines with the given-up ground washed in each side's
  colour, and an island part's edge (the minimap frames the part, as the campaign's does). The flag strip shows one chip
  a flag (up to seven; the renderer's point instances went from six to eight).
- js/render/bf-fx.js: the front lines (the line ahead in the defenders' colour, the one behind in the attackers') and an
  island part's edge as glowing ground strips under a low curtain of light; two draw calls.
- Ground War tab: Conquest and Breakthrough playlists, both in Ground War Quick Play and tickable; the tab's maps now
  include the islands (only these two modes fit them). Custom and friend rooms offer them on every map that fits.
  Help cards and videos (`cq`, `bt`), first-time tips, the "Breakline" music theme (js/audio/music-themes.js `bf`),
  medals, results lines (js/ui/outcome.js: "Their tickets ran out", "Broke through all 3 sectors", "Held at sector 2 of
  3"), and daily "Play 2 Conquest / Breakthrough matches" (the pool adds every rule set by itself).
- Tests: `node dev/sim-conquest.mjs [quick]`, `node dev/sim-breakthrough.mjs [quick]`,
  `python3 dev/ui-bfmodes-test.py [port]`.
