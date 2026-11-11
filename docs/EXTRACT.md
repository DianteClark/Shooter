# Extraction (ROADMAP item 17)

Our own take on the mode: squads on Frontier against AI patrols and each other, contracts that fill a pending pot, and
a helicopter out that banks it. Nothing counts until someone in the squad gets out.

| id | name | squads | lives (shared) | players |
|---|---|---|---|---|
| `exq` | Extraction (Quads) | 4 of 4 | 10 | 16 + up to 48 AI seats |
| `exd` | Extraction Duos | 8 of 2 | 5 | 16 + up to 48 AI seats |

Rule set `ex` (`js/sim/extract.js`, registered in `js/sim/rules.js`), numbers in `EX` (`js/shared/modes.js`).
Frontier only (any map listing `br` with eight or more places hosts it, `modeFitsMap`). No solos.

## Rules (the owner's, with our numbers)
- **Match**: 8 s at the insertion points, then 15:00. Squads start round the edge, each in its own slice, at the spot
  furthest from any place. The match ends at 15:00, or once no human is left in play (with no humans, once every squad
  is done). A human whose squad has not got out yet keeps watching while squadmates can still bank the pot.
- **Loadouts**: your own (guns, attachments, perks, equipment, operator). No scorestreaks (`_cleanLoadout`). No loot
  but ammo for the primary: ammo boxes at every place (3 at tier 1, 2 elsewhere; +2 magazines; back after 60 s) and a
  drop where anyone dies (+1 magazine, 45 s). The phone owns its gun: the host sends `{t:'exammo', id, mags}`.
- **Lives**: a squad shares a pool (10 quads, 5 duos). A death costs nothing; a respawn (after 12 s) takes one. With
  the pool empty, the dead spectate their squad (`holdDead`). Respawn spot: near a squadmate who is up (on the far side
  from the nearest enemy, further back when the mate is in a fight), else the insertion point. A human who drops is held
  (no newcomers: `closed`) and comes back without spending a life.
- **Downs**: battle royale's (crawl, 30 s bleed, a squadmate standing by revives in 4 s to 35 HP). Nobody up in the squad:
  everyone down dies.
- **Contracts** (one active per squad; a finished one pays into the pot and the next is dealt 2.5 s later, a type the
  squad has done least, at a place about 115 m away and away from other squads' work):
  - Secure Intel: a case indoors at a place; walk over it, carry it to a drop 50-150 m off. Carrier down or dead: the
    case drops (back home after 60 s untouched).
  - Eliminate HVT: a commander (elite, LMG, takes 45% damage) and two guards at a place. Done when he dies.
  - Destroy Cache: stand still at the cache 3 s to plant; the fuse is 30 s; another squad can pull it (5 s).
  - Hack Terminal: 55 s of the squad alone within 6 m (another squad or AI inside pauses it).
  - Escort Asset: a tracked cargo mule walks the nav path (1.4 m/s) to a point about 85 m off, only with a squad member
    within 8 m and nobody hostile within 11 m.
  - Contract phones (one per place): three offers seeded by phone, squad and contracts taken (every phone computes the
    same, nothing on the wire); taking one replaces the squad's contract (`{cmd:'ex', act:'take', phone, k}`).
  - Rewards by site tier (1 best): 1,500 / 1,050 / 700 XP, 900 / 650 / 450 weapon XP to the primary, 240 / 180 / 120
    seconds of operator mastery.
- **AI patrols** (side `EX_AI_TEAM`, hostile to every squad, bots from the roster's AI seats): every place has a post
  (guards on indoor spots) and/or a patrol (walking a six-point loop at walking pace): tier 1 a post of 3 and a patrol of
  2 (HQ sites), tier 2 one group of 3, tier 3 a post of 2. Toughness is the larger of the tier's (0.78 / 0.45 / 0.2) and
  nearness to the centre: rating 0.02-0.38 (recruit to regular), damage taken 1.0-0.75x, damage dealt 0.3-0.55x, guns from
  SMGs to LMGs and battle rifles, a grenade at the top tier. Groups are calm (walk, see less) until they see someone,
  are shot, or hear gunfire within 55 m; alert for 22 s after the last sign, chasing up to 40 m from home. HQ posts that
  lose two call a reinforcement wave (2-3) at most every 2 minutes, twice. Contracts call waves too (a planted charge,
  30% of a hack, 40% of an escort: 25% / 50% / 80% chance to skip by tier) and every exfil call one (2).
- **Budget**: a group exists only while a squad player is within 80 m of it (`EX.wake`) and goes after 15 s with nobody
  within 110 m (`EX.sleep`), taking free AI seats (48) and giving them back. A wiped post or patrol is back after 4 minutes.
- **Exfil**: six landing zones round a ring between the places, one final zone nearer the middle. Window 1 opens two at
  3:30 until 7:00, window 2 two others at 7:30 until 11:00, the final exfil is announced at 12:00 and lands at 13:00 and
  stays to the end. A squad member in an open zone taps Call exfil (`{cmd:'ex', act:'call'}`): the helicopter flies in
  for 25 s and waits 50 s. A squad that holds the 9 m zone alone (no other squad, no AI, nobody of it down) for 10 s is
  lifted out with everyone of it inside; the whole squad banks its pot. Anyone may take someone else's ride. The site
  cools down 30 s and opens again while its window lasts. The final one lifts squad after squad.
- **Pay** (`js/shared/extraction.js extractionPay`, applied by `js/game/awards.js`): extracted: 1,000 XP plus the banked
  contracts' XP, weapon XP and operator seconds, an operator mastery win, the lifetime tallies below and
  `save.extractions + 1`; not extracted: 300 XP for taking part (plus the usual kill and medal lines).

## Exclusive unlocks (`EX_UNLOCKS`)
Each counts one lifetime tally in the save (`life`), added only by contracts banked on extraction:

| item | kind | needs |
|---|---|---|
| Courier | operator | 4 Secure Intel (`ex:intel`) |
| Hard Target | perk (Body): 15% less gunfire while sprinting or sliding; Pro Evasive: for 1 s after | 4 Escort Asset (`ex:escort`) |
| Blackbird | scorestreak (3,400): Overwatch-class UAV for 45 s | 4 Hack Terminal (`ex:hack`) |
| Vulture | scorestreak (3,300): Attack Chopper with 1.5x armour that hunts for 38 s | 5 Eliminate HVT (`ex:hvt`) |
| Black Box | camo, every gun | 4 Destroy Cache (`ex:cache`) |
| Exfil Flare | camo, every gun (animated) | 3 extractions with 4+ contracts (`ex:big`) |
| Nightjar | operator | 20 contracts of any kind (`ex:contracts`) |

Streak and perk gates are `UNLOCK_CHALLENGES` entries (`extraction: true`, never grandfathered); operators use
`unlock: {life}`; camos `exfil: 'camo:<id>'` (`camoGateOpen` reads the save's `life`). Courier's and Nightjar's field skins
need 10 extractions / 10 HVTs. Progress shows on the results screen.

## Bots
- Squad bots (`_planSquad`, 2 Hz): revive a downed squadmate within 55 m first; top up at a box within 40 m when the
  primary has under a magazine; with a human in the squad, stay round them (and step into a landed zone with them);
  otherwise do the contract (intel: the nearest takes the case, the carrier walks to the drop, the rest escort; hvt:
  hunt the commander; cache: the nearest plants, the rest guard; hack: everyone in the area; escort: walk with the mule).
- Exfil: from the pot and the squad's greed (rolled per squad: out at the first window with 4+, the second with 3+, or
  the final), always with 9+, with lives low, once anyone of the squad is out, and from 11:40 on. They call it, hold the
  ring, step in once it lands, and will take another squad's ride if it is nearer. Squads not leaving contest a call
  within 140 m (20-60%) and third-party gunfights within 70 m now and then.
- AI groups (`_planGroups`, 2 Hz): posts stand their spots, patrols walk their loop (`BotBrain.calm`: walking pace, no
  sprint), alerts send the group toward the trouble.

## Wire and migration
The objective block: `[t, per squad player (down, revive, out, carrying), per site (state, timer, hold, holder,
contested), per squad contract (state, progress, a moving thing's place), full block, backup, loot]`. The full block
(squads, lives, pots, contracts, callers, stats) goes out on a change and every 2 s; ammo on the ground in its own small
block. Per-guest snapshots send AI patrols as full records within 14 m, keyframes every other snapshot to 40 m, every
third beyond (`INTEREST_FAR_AI`, `AI_NEAR`), and loadout blocks every 1.5 s (`metaEvery`). The host decodes its own
snapshots from its live state. Every 6 s a backup rides along (AI groups and their seats, contract internals, squad
timers, per-player downs); `restore` rebuilds from the guest's mirror plus that backup; groups not in it start asleep.

## Code
- `js/sim/extract.js` rules; `js/sim/sim.js` hooks (`respawn`, `tryDown`, `driveBot`, `onShot`, `ex` command, `closed`,
  `ownSpawns`, `metaEvery`, AI interest); `js/sim/bots.js` `calm`; `buildExRoster` (squads like battle royale, AI seats
  last, the first four named Commander).
- `js/shared/extraction.js` (exclusives and pay), `js/shared/modes.js` (`EX`, `exq`, `exd`, `EX_AI_TEAM`).
- UI: `js/ui/ex-hud.js`, its own module and elements so the HUD redesign can move them (chips, squad, contract card,
  Call exfil and the phone sheet placed like the battle royale's take prompt, screen markers, downed panel, the battle
  royale's out panel markup with Spectate / Next player / Next squad / Leave through `spectate.any` and main.js
  `leaveBrEarly` (Match.leaveNow, `early` into the results), zoomed minimap and full map; `hud.music?.cue('exfil')` when
  your squad calls the helicopter, a no-op until the music engine lands), `js/render/ex-fx.js` (landing zones, helicopters, contract things, phones, ammo,
  downed rings), results (`js/ui/results.js`), Multiplayer tab (`js/ui/matchmaking.js`), Help.
- Tests: `node dev/sim-extract.mjs [--quick]`; `python3 dev/ui-ex-test.py [port]` (Multiplayer to results, screenshots
  in /tmp/exfil); `python3 dev/ui-ex-net-test.py [port]` (two humans in one squad over ?net=local).

## Measured (node dev/sim-extract.mjs, bot-only, 16 players)
Host tick 0.3-0.6 ms mean (CPU time), p99 2-5 ms; per-guest snapshot about 1.3-1.4 KB mean (battle royale measured the
same way, minutes 1-5: about 1.3 KB). Bot-only matches run 5-9 minutes (squads get out or run dry; with a human the
match runs on), 2-4 extractions, 15-30 contracts finished, every type each run.
