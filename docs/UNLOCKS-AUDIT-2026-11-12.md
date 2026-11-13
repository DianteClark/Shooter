# Rewards check, 2026-11-12 (calling cards, achievements, unlocks, challenges, modes)

The owner's ask: "check all rewards and calling cards and achievements and game modes and ensure all works well".
Branch `scrub`. New test: `node dev/sim-unlocks.mjs [quick]` (about 4 minutes; quick about 1). Extended:
`dev/ui-sweep-play.py` now also checks the results screen against the save (see 4).

## 1. Inventory (what exists, and where its rule lives)

| unlockable | count | source of truth | how it is earned |
|---|---|---|---|
| Player levels / prestige / Master | 50 levels, 10 prestige ranks, Master 1-1000 (11 icon tiers) | `js/shared/progression.js` (`PLAYER_CURVE`, `prestigeRankRewards`, `MASTER_REWARDS`) | XP; prestige pays a badge, a camo for every gun and a card; Master pays 3 cards, 2 camos, 1 emblem |
| Level unlocks (guns, perks, gear, streaks) | 104 rows | `UNLOCK_SCHEDULE` | peak level |
| Unlock challenges on late gear | 13 (6 base, 2 gear wave, 3 V9, 2 extraction) | `UNLOCK_CHALLENGES` | mastery counters / extraction tallies on top of the level |
| Attachments | 137 kinds, 1,132 per-gun unlocks | `js/shared/attachments*.js` | weapon level |
| Weapon camos | 52 total: 10 challenge, 3 mastery, 4 weapon prestige, 2 extraction, 10 player prestige, 2 Master, 20 season, 1 default | `js/shared/camos.js` + `camoGateOpen` | per gun or every gun at once |
| Weapon mastery ladder | 47 guns x 5 tiers | `WEAPON_LADDER` | past weapon level 30 |
| Gear / streak / operator mastery tracks | 80 tracks, 349 tiers (14 tactical, 14 lethal, 23 streak, 29 operator) | `MASTERY_TRACKS` | per-item counters (`MasteryTracker`) |
| Pro perks | 16 | `PRO_CHALLENGES` | per-perk counters (`ProTracker`) |
| Calling cards | 306: Starter 1, Pro 16, Prestige 13 (incl. 3 Master), Mastery 137, Career 17, Maps 8, Modes 12, Arms 8, Season 80, Ranked 14 | `CARDS` (progression.js) + `js/ui/cardbook.js` | career, lifetime tallies, mastery grants, season track, ranked |
| Emblems | 117: 22 base, 94 season + ranked, 1 Master | `js/ui/emblems.js` | starter, level, prestige, Master, career, lifetime tallies, grants |
| Operators | 29: 3 at start, 12 by level, 3 by prestige, 2 by career stat, 9 by lifetime tally (2 of them Extraction) | `js/ui/operators.js` | |
| Operator skins | 190: 29 issue, 29 field (career rule), 116 mastery (tiers 2-5), 16 season | `js/ui/operators.js` `SKINS` | |
| Finishers / emotes | 6 / 8 | `js/shared/finishers.js` | level, any operator's mastery tier, a season track tier |
| Tracers / kill effects | 7 / 7 | `js/shared/camos.js` | weapon prestige |
| Extraction exclusives | 7 (2 operators, 1 perk, 2 streaks, 2 camos) | `js/shared/extraction.js` `EX_UNLOCKS` | contracts banked on extraction |
| Daily / weekly challenges | 75 in the pool (49 daily, 26 weekly), 3 a day and 3 a week | `buildPool` (progression.js) | `ChallengeTally` |
| Season track | 100 tiers a season x 2 seasons (then replays) | `js/shared/season-items.js` `trackRewards` | 5,000 XP a tier, weekly stars |
| Season weekly sets | 5 a week x 6 weeks a season, from 20 templates | `js/shared/seasons.js` | `ChallengeTally` + ranked |
| Ranked rewards | card + emblem per division per season | `rankedCards` / `rankedEmblems` | best division at season end |
| Graveyard Shift records | best round per map, escape round and Gravewarden per map, the Lantern Out card | `recordZmBest`, `recordZmFeat` | |
| Medals | 37 kinds emitted by the sim, every one with a HUD row and an icon | `js/sim/*`, `js/ui/hud.js` | |

## 2. What was checked (`dev/sim-unlocks.mjs`)

A. **Data.** Ids unique in every table (cards, camos, emblems, skins, operators, finishers, emotes, tracks, the
challenge pool, every season's weekly ids); names unique within a picker; every reward id a mastery track, gun ladder,
season track, ranked division or Master level grants exists in its table; every card has art and is locked on a blank
career (only Switchyard open); every emblem draws; finisher and emote rules are ones the check knows; every label
states its real number (challenges, season weeklies, mastery tiers, ladder, Pro steps, unlock challenges, extraction
exclusives) and map emblems name the right map.

B. **Reachability.** Every one of the 28 modes played headless by bots (3 seeds each, S&D 6), to the end, with the real
`ChallengeTally`, `ProTracker` and `MasteryTracker` on every player and every tactical, lethal, streak, perk set and
operator dealt round the bots. Then: every daily/weekly challenge's stat is counted, the mode ones in their own mode
(`played:`/`won:`/`top3:` in a mode with those rules); every season weekly template likewise; every lifetime tally an
operator, emblem, extraction exclusive or calling card reads is counted (map tallies come from `applyMatch`, `ex:*`
from real bot extractions); every Pro step stat; every mastery tier stat of every item (see below for the ones bots
are too clumsy for); the gun ladder's stats.

C. **Through the save.** A 90-match career through the real `Progress` API (stand-in localStorage, `js/ui/cards.js`
loaded as in the game), prestiging guns and the player whenever possible, to Prestige 10 and Master 1000. After each
match: every card, operator, Pro perk, gear item, attachment and camo that opened was stamped in the match's unlocks,
and nothing was stamped twice over the whole career. At the end everything not tied to a season is open in its own
list (cards, operators, camos per gun, skins, emblems, finishers, emotes, gear, Pro, attachments, the Golden gun).
Then a Season 1 day: 100 tiers paid once, every reward shows owned, a season card, emblem, camo and skin equip, the
season finisher and emote open. Then an SY4 code: picks (card, emblem, camo, skin, finisher), every open set and the
Graveyard Shift records survive a wipe and re-import, and the code re-exports byte for byte. Every mastery reward id is
in `Progress.rewards()`. Daily and weekly challenges move by exactly the counted amount.

D. **Generators.** 120 days of daily sets and the weeks in them (from 2026-11-12): always 3, never two of a family,
every one reachable (B); 70 of the 75 pool entries come up. Every gun goal names a level 1 gun and every class goal a
class with one. Season weekly sets of both seasons checked in B.

Bot-rare but reachable (hand-checked, reported by the test, not failed): Drill wall kills (bots never aim at walls; the
test throws Drills into thin cover on four maps and they bore through), lethal and streak multi-kills, Sticky kills
from 12 m, Tripwire kills (1 in two elite matches), Thermite melts, stolen Airdrops (the event carries `stolen`).

## 3. Broken and fixed

1. **Calling cards earned in a match were never shown as new**: all 87 cards in `cardbook.js` (maps, modes, arms,
   the career-tally ones, the 46 gun Master cards and the animated mastery ones). `cardbook.js` memoises the card career for one synchronous pass, and
   `Progress.applyMatch` took its before and after card lists in the same pass, so both saw the old numbers; the cards
   unlocked silently, and `Progress.cards()` read stale until the next tick. The save now drops the memo on every
   write. js/ui/cardbook.js, js/ui/progress.js.
2. **Lantern Out (Gravewarden) was never stamped**: awards.js recorded the feat before `applyMatch` took its card list.
   `applyMatch` now records the feat itself (`zmFeat`), after the list. js/ui/progress.js, js/game/awards.js.
3. **A gun's mastery ladder granted a card that does not exist** (`card:mastery-<gun>`): the last tier's stamp said
   "New calling card" and drew the starter card. It now grants the gun's own Master card (`gun-<id>`, also earned by
   every camo challenge); if the camo challenges already earned it, that tier shows no second "New calling card". The
   Golden gun has no card and gets none. Save-compatible (rewards are derived from tiers, not stored).
   js/shared/progression.js, js/ui/cardbook.js, js/ui/mastery.js.
4. **Vulture was an Attack Chopper to everything but its armour**: the call was announced as "Attack Chopper", its
   kills went to the Chopper, and its own mastery track could never move. It now announces, counts and credits as
   Vulture (it also counts for Engineer Pro's aircraft calls). js/sim/sim.js, js/shared/progression.js.
5. **"Finish top 3 in Free-for-All / Gun Game / One in the Chamber 5 times"** counted a podium in any of the three.
   Each now counts its own mode (`top3:<rules>`; the Podium card still counts all). js/shared/progression.js.
6. **"Capture N flags or zones"** (daily, weekly, season weekly, the Flint operator, the objective mastery tiers of
   Yard Dog, Cipher, Flint and Tinker) ignored Headquarters and Control captures. They count now.
7. **Future-proofing the daily draw**: a mode a season date-locks (`content`) is left out of the daily and weekly
   draw (and rerolls) until it opens. Nothing is date-locked today.

## 4. Game modes

`dev/ui-sweep-play.py` (every Multiplayer playlist, every Custom mode, Graveyard Shift on its four maps, Training,
range, tutorial) now also checks that the results screen's XP lines add up to exactly what the save gained, and that
every daily/weekly challenge row on the results says what the stored challenge says. Results: see 6.

## 5. For the owner to decide

- **Nightjar**: the rifle (`hushdmr`) and the Extraction operator share the name, so both Master cards read "Nightjar
  Master" side by side in the Mastery group. Rename one (the operator came later).
- **Graveyard Shift kills count for everything except the boards**: daily/weekly kill goals, class goals ("50 SMG
  kills" operators, the Arms cards), camo challenges and operator mastery all count zombie kills (weapon XP is cut,
  K/D boards are not). Easy farming; intended?
- Weekly "Clutch 2 Search and Destroy rounds" also counts Showdown clutches, and "Confirm 8 kills in Kill Confirmed"
  also counts Grind tags. Generous, left as is.
- Map cards exist for the first eight maps only (14 newer maps have none); mode cards for the original six modes,
  S&D and CTF (none for Headquarters, Kill Order, Control, Grind, Infected, One in the Chamber, Showdown, battle royale,
  Rebound, Extraction or Graveyard Shift beyond Lantern Out).

## 6. Test runs (end of the branch)

(filled in below)
