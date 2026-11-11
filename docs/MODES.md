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
  the rest hunt the enemy VIP. Infected: survivors stack a hold and move every 35 s; infected chase the nearest
  survivor. One in the Chamber: free-for-all fighting; out of rounds, the blade. Control: attackers stack the zone
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

## Play flow (ROADMAP item 14)
- **Multiplayer** (title hero; `js/ui/matchmaking.js` data, `js/ui/playscreens.js` screens, flow in `main.js`
  `findMatch` / `startMpVote` / `launchMp`): tabs Standard, Ground War, Battle Royale (Quads, Duos, Solos) and a
  disabled Extraction. A pick is one playlist (Quick Play, Objective, Party modes, today's Featured with its modifiers)
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
