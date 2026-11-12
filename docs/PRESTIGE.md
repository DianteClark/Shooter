# Prestige and Master Prestige (ROADMAP item 39)

Player prestige stays manual: at level 50 the service record (and the Prestige view) offers Enter prestige, the level
goes back to 1 and everything earned stays. What changed is what a rank gives, how the moment plays, and what happens
past Prestige X.

## Every rank's rewards

Each prestige rank 1..10 awards, on reaching it (`prestigeRankRewards(n)` in js/shared/progression.js):

| Rank | Name | Icon | Camo (every gun) | Calling card |
| --- | --- | --- | --- | --- |
| I | Brakeman | `badge:1` | `pp-brake` Brake Dust (splinter) | `prestige-1` |
| II | Coupler | `badge:2` | `pp-coupler` Coupling Brass (hex) | `prestige-2` |
| III | Signalman | `badge:3` | `pp-aspect` Three Aspect (digital) | `prestige-3` |
| IV | Switchman | `badge:4` | `pp-points` Crossover (carbon) | `prestige-4` |
| V | Dispatcher | `badge:5` | `pp-dispatch` Night Dispatch (aurora, animated) | `prestige-5` |
| VI | Conductor | `badge:6` | `pp-silver` Silver Service (gold sweep) | `prestige-6` (animated) |
| VII | Engine Driver | `badge:7` | `pp-firebox` Footplate (molten) | `prestige-7` (animated) |
| VIII | Yardmaster | `badge:8` | `pp-laurel` Laurel Line (live wire) | `prestige-8` (animated) |
| IX | Roadmaster | `badge:9` | `pp-sunset` Sunset Limited (prism) | `prestige-9` (animated) |
| X | Sovereign of the Yard | `badge:10` | `pp-crown` Crown Jewels (singularity) | `prestige-10` (prism) |

- Icons are the existing badge emblems (`badgeSvg`), one per rank. Camos are `RANK_CAMOS` in js/shared/camos.js with
  `pp: n`, coloured after the rank's badge; `camoGateOpen(camo, w, life, rank)` opens them on every gun once
  `rank.prestige >= pp`. They are separate from the weapon prestige camos (`prestige: n`, per gun).
- Cards are the Prestige group's `prestige-<n>` cards; from VI they animate (gold, X prism).

## Master Prestige

Past Prestige X the level keeps counting. Master level 1 is Prestige X at level 50; every `MASTER_LEVEL_XP` (2,500, about
one match at the top of the curve) is one more Master level, up to `MASTER_MAX` (1,000).

- It is read from total XP, nothing new is stored: `masterOf(prestige, level, totalXp)` is 0 below Prestige X level 50,
  else `1 + floor((totalXp - MASTER_START_XP) / 2500)`, capped. `MASTER_START_XP` is eleven full climbs of the player
  curve (896,896 XP). Any XP earned while sitting at level 50 (before a prestige, or at Prestige X before this build)
  counts, so an existing Prestige X player converts on load to the right Master level with no loss, and an old save
  code imports the same.
- Bots follow the same rule: `levelFromXp` in js/shared/botpool.js returns `master` from the career XP. Prestige and
  level are unchanged for every XP, so the pool's profiles, careers, matchmaking and boards stay exactly as they were;
  the Master level is extra. The pool's top grinders are Masters (62 on 2026-11-12, the top at about 840).
- Icon tiers every `MASTER_TIER_STEP` (100) levels: 1-99 Iron, then Bronze, Silver, Gold, Platinum, Emerald, Sapphire,
  Ruby, Amethyst, Obsidian, and Eternal at 1,000. Each is a faceted diamond with an "M" of rail sections in the tier's
  metal, gathering rays, wings, laurels, a gear and a crown as it climbs, plus a rim pip per tier (`badgeSvg(p, size,
  master)` / `masterTierSvg(tier)`).
- Milestones (`MASTER_REWARDS`): Master 1 card `mp-1` Past the Last Stop; 100 camo `ml-platinum` Master Line; 250
  emblem `mastermark` Master Mark (js/ui/emblems.js `RANK_EMBLEMS`, kept out of the pool's `EMBLEMS`); 500 card
  `mp-500` Half the Thousand; 750 camo `ml-lamps` Thousand Lamps; 1,000 card `mp-1000` The Whole Line.

## Where a level shows

`Progress.badge()` is `{ prestige, level, master }`; peers clean `master` (main.js `cleanBadge`, only at Prestige X level
50; older builds send none and show their old badge). `badgeMark(prestige, size, master)`, `badgeMarkOf(badge)` and
`badgeLevel(badge)` (js/ui/widgets.js) draw the Master icon and print the Master level instead of 50: title player card
("Master 137", an M plate), service record, lobby cars, match intro, scoreboard, kill feed, killer card, results tables
and the results XP bar (which fills the Master bar, "M 137", and stamps each Master level; reaching Master 1 plays the
Master Prestige stamp). Boards: the Level category ranks `rankValue` (prestige x 50 + level + Master level), ties by
total XP, and reads "Master 137 · 1.2M XP"; friends' cards from any build and bots get their Master level from XP.

## The Prestige view and the reveal

Service record -> the rank ladder (now a button, with an M step after X) opens the Prestige view (js/ui/prestige.js
`prestigeScreen`): the current rank and bar, what is next with its rewards and what it takes, Enter prestige, every
rank's icon, camo and card with earned marks, then the Master icon tiers and milestones. Entering prestige confirms,
then plays the reveal (`prestigeReveal`): the badge stamped in over turning rays, its camo and calling card as tiles,
and the next rank. Master icon tiers, the Master camos and the emblem stamp in the results reel (`rankStamp`), once
each rather than once per gun.

## Tests

- dev/ui-mastery-test.mjs: rank rewards, Master levels and milestones, old Prestige X saves and codes, the Progress flow
  from Prestige IX to Master 101.
- dev/sim-botpool.mjs (master): `levelFromXp` unchanged for prestige and level, Master never falls, same per date in a
  fresh process, pool Masters, badges; the careers hash ignores the derived `master`.
- dev/sim-boards.mjs (master): Level board order and text, older cards, pool Masters, never falling over 60 days.
- dev/ui-prestige-test.py [port]: the view, the reveal and Master levels in a browser at 667x375 and 852x393.
- dev/ui-gallery.html scenes `prestige`, `prestige-master`, `prestige-reveal`, `title-master`, `profile-master`,
  `results-master` (also in dev/ui-overflow-test.py).
