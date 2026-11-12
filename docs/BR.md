# Battle royale (V12): design and the contract between its two builders

Owner's idea: a 32-player lobby with up to 8 real players and the rest bots, so even in quads every human faces at
least 4 other humans (squads or solo). Squads of 4 by default; duos and solos as options. Bots must feel like players:
loot, rotate with the circle, hold buildings, third-party fights, revive teammates. Peer-to-peer only: the host phone
runs the sim (docs/BR-PERF.md "After" says what the engine can do now: grid walls, two-level pathing, thinking
budgets, per-guest snapshots, tiled rendering).

## Two builders, one contract
- MAP builder: `js/shared/maps/br-*.js` (the giant map, id `frontier` or a better name) and its region art.
- MODE builder: everything else (rules, loot, circle, squads, downs and revives, inventory, bots, HUD, menus, lobby).
The MODE builder starts on the procedural giant test map (dev/br-perf.mjs brMap) and swaps to the real map when it
lands. Both stick to this map contract:

```js
{
  id, name, size: 'giant', region: 'mixed', width, height,     // about 400 x 400 m (may go to 480 if it plays better)
  walls, nav, decor,                                            // as every map
  modes: ['br'], large: true,
  br: {
    pois: [{ id, name, x, z, r, region, tier }],                // 12-18 named places; tier 1 best loot, 3 sparse
    loot: [{ x, z, tier, indoor }],                             // 500-900 floor loot spots (most indoors)
    chests: [{ x, z, tier }],                                   // 30-60 supply caches (better rolls)
    drop: { from: { x, z }, to: { x, z } } | null,             // null: the mode picks a random flight line
    circleBias: [{ x, z, w }],                                  // optional weights for where final circles may end
  },
}
```

## Rules (MODE builder decides the numbers, these are the shape)
- Drop: everyone rides a transport across the map; tap to jump; a short glide lets you steer to a spot. Bots pick
  POIs spread out, with some hot drops.
- Loot: floor guns of every class with rarity tiers (common, uncommon, rare, epic, legendary) that add attachments
  (reuse js/shared/attachments.js) and better base kits; ammo by type; armor plates (3 slots, plate up takes time);
  lethals/tacticals from the gear catalog; consumables (medkit, plate, a self-revive kit). Two primary slots plus
  melee or pistol; a light, readable inventory on a phone (auto-pickup ammo and plates, tap to swap guns).
- Your own loadout: not used in BR except operator, skins and camos (cosmetic). Kills feed weapon XP and mastery.
- Circle: 6-7 phases, shrinking, damage that rises per phase, visible on the minimap and as a wall in the world.
- Downs: in squads, lethal damage downs you (crawl, bleed out); a teammate revives by holding near you; a squad is out
  when all are down or dead. Optional later: redeploy/respawn beacons.
- Win: last squad standing. Placement, kills and revives give XP and a BR results screen.
- Streaks: none in BR, but kill streak score can buy care packages or UAV scans from loot (MODE builder's call).
- Networking: up to 8 humans; bots are on the host. Rejoin uses the held-slot system (a dropped player's character
  stays down or idle, never bot-driven). Late joiners cannot drop in after the jump.
- Phones: the 32-player match must hold 60 fps on Low on the reference profile with the tiled world; the host's sim must
  stay under 4 ms per tick average.

## The map: Frontier (`frontier`, js/shared/maps/br-frontier.js)
400 x 400 m, `size: 'giant'`, `modes: ['br']`, `large: true`, `region: 'mixed'`, `theme: 'frontier'`. Registered in
js/shared/map.js but kept out of `MAP_IDS` (votes, rolls, solo picker sections, backdrop, cardbook); `BR_MAP_IDS`
lists giant maps for the mode. 17 places (`br.pois`), tier 1: Downtown, Central Station (metro), Steel Mill
(industrial), Jungle Temple; tier 2: Freight Yard, Fishing Port, Frozen Ship, Polar Station, Harvest Farms, Canyon Dam,
Oasis Town, Airfield, River Village; tier 3: Lighthouse Point, Grain Co-op, Radio Hill, Quarry. A river from the south
edge to the north-east sea has six crossings (z 70, 122, 200, 244, 324 and a ford at 384); the arctic ridge and both
canyon rims have two passes each; roads join every place to two or more neighbours.
- `br.loot` about 560 spots (about 380 indoors, `indoor: true`), `br.chests` 44 (three per tier 1 place, two per tier 2,
  one per tier 3, ten out in the open), `br.drop: null`, `br.circleBias` the places by tier plus five open spots.
- Extra fields the mode can use: `roofs` (every enterable building: `{ id, x, z, w, d, h, style, region }`; a point
  inside one is indoors, and a mortar or gunship round over one could be spent on it), `rooms` (floors; `bld` is the
  roof id), `zones`, `roads`, `rails`, `regionSeeds` (with `regionField` from br-kit.js: the region of any point).
  `spawns` (two teams of 16 at the places), `lanes` and `nav` exist only so team modes and bots can run on it for tests.
- Building kit (js/shared/maps/br-kit.js `Plan.building`): 0.5 m walls (`bwall`, `bld`), 2.4 m door gaps (two or more
  per building, never on the end of the inside wall), waist-high window sills (`window`, see and shoot over), an inside
  wall with a doorway when the long side is 11 m or more, furniture flush with the walls (`furn`: table, counter or a
  head-high shelf), loot on a 1.8 m lattice clear of walls and doorways.
- Rendering (js/render/themes/frontier.js): tiles of 32 m built near the camera on demand (urgent within 20 m, the rest
  within the cut + 24 m at 5 ms a frame), dropped past 190 m. Roofs dissolve round the local player and up to three
  teammates within 30 m (`world.setCutters`, called by the renderer). `world.buildAll()` builds everything (the overview).
- Art: assets/maps/frontier.jpg (card) and assets/maps/frontier-overview.jpg (1024 x 1024, north up, edge to edge:
  map x = px / 1024 * 400) for the big map and the drop map; dev/br-overview.mjs remakes it.
- Testing: `?debug=1&map=frontier&mode=tdm` plays it under a team mode (dev path in main.js); `node dev/map-validate.mjs
  frontier` checks the contract, reachability, sealed rooms, door widths and a 32-bot free roam;
  `node dev/br-render.mjs` measures load and frames.

## The mode (`br`, `brduo`, `brsolo`; js/sim/br.js)
Rules module `BrRules`, owned by the Sim when the rule set is `br` (hooks: the `this.br` checks in sim.js). Squads are
sides: team `FFA_TEAM + squad`; humans fill squads first in lobby order (friends together), bots fill to 32. Numbers live
in `BR` (js/shared/modes.js).
- Start: everyone aboard the transport for `BR.warmup` (7 s, drop map up), then it flies a random line through the middle
  third at 30 m/s. Jump (button on the drop map and the HUD), 7.5 s steerable glide at 16 m/s, landing pushed clear of
  walls. Anyone aboard at 94% of the line is thrown out. Bot squads pick places along the line by tier (hot drops: a
  place already picked weighs 0.3x per squad); bots in a human's squad jump with their human and glide to them.
- Loot: the seed builds the table on every phone (`br.loot` spots: a floor roll of gun 34%, ammo 26, plate 16, medkit 8,
  lethal 7, tactical 6, self-revive kit 3; guns come with ammo 60% of the time; `br.chests` are closed caches that open
  when someone stands at one and spill two guns at chest rarity, plates and a kit or lethal). Rarity by tier
  (common to legendary; chests 0/18/38/30/14%) gives 0-4 attachments and 4% better handling per step (aim, reload, swap,
  sprint-to-fire, hip spread; damage and fire rate untouched). Ammo types: light (SMG, pistol), rifle (AR, LMG), shells,
  heavy (marksman, sniper), rockets. Walking over loot takes ammo for a held gun, plates (carry 5), medkits (3), one kit,
  equipment of the kind held (cap 3); a gun fills an empty hand by itself and is tapped to swap otherwise (the old gun
  drops). Two hands; an empty hand is fists (the Gaff). Everyone starts with fists and a common pistol.
- Armor: 3 plates of 50; one tap plates you up, 1.1 s a plate, cancelled by firing or a hit. Plates take gunfire and
  blasts first; the circle ignores them. Medkit 2.6 s to full health.
- Circle: 7 phases (wait/shrink seconds, radius as a share of the map, damage per second): 130/60 0.40 1, 110/65 0.28 4,
  90/55 0.18 8, 60/45 0.11 12, 45/35 0.06 16, 35/30 0.03 20, 25/40 0 25. The first wait starts when the transport has
  crossed. Each next centre lies inside the current circle, weighted by `br.circleBias`. A full match is 9-14 minutes.
- Downs (squads only): lethal damage downs you while a teammate is up: crawl at 0.32 speed, no gun, bleed out in 30 s,
  finished by more damage. A teammate standing within 1.9 m (not firing, not running) revives in 4 s to 35 health; a
  self-revive kit takes 5 s. A squad is out once nobody in it is up (anyone still down dies then); placement is squads
  left + 1. In solos lethal damage kills.
- Bots (`BrRules.plan`, 2 Hz per squad, through `BotBrain.setObjective`): loot their place (claims stop squadmates
  chasing one item), move on to the nearest unvisited place inside the next circle, rotate when the walk in would not
  beat the circle, hold a room or a hold point inside the next circle once geared (late phases prefer rooms), third-party
  fights they hear within 37-56 m once geared (each burst weighed once, 45%), revive downed teammates when nothing is in
  view, plate and heal between fights, finish downed enemies (downed targets rank behind active ones). Aboard, gliding and
  downed bots are driven by the rules (`driveBot`).
- Wire: the objective slot of the snapshot carries the BR block (`encodeFor(guest)`): circle, transport, per-player
  armor/down/air/revive/place, the guest's own inventory, the loot changes it has not had (re-sent for 1.2 s; all of
  them to a rejoining phone), and per-player stats every 3 s and at the end. Guns and ammo for a human go to their phone
  as `brgive`/`bramm`/`brinv` events (the phone owns its gun state). A dropped human's character stays standing (or
  down), never bot-driven, and rejoins into it; nobody joins after the start.
- Map contract use: `br.pois` (drop map names, bot drops), `br.loot`, `br.chests`, `br.circleBias`, `br.drop` (null:
  random line), `rooms` (late holds), `assets/maps/<id>-overview.jpg` (drop and full map). Any map with `modes`
  including `br` gets `brduo` and `brsolo` too (js/shared/map.js). `brtest` (js/shared/maps/brtest.js, hidden) is the
  small stand-in used by `node dev/sim-br.mjs --map=brtest` and `?brtest` in the picker.
- Tests: `node dev/sim-br.mjs` (units, then quads, duos and solos on Frontier: one winner inside 14.5 minutes, loot, plates,
  downs, revives, wipes, tick budget, snapshot bytes), `python3 dev/ui-br-test.py [port]` (picker to results in a
  browser, screenshots), `python3 dev/ui-br-net-test.py [port]` (two tabs over ?net=local: one squad, guns to the guest,
  loot mirror, drop and rejoin).

## Second pass (br2)
- Pacing: matches run 9-14 sim minutes (before: 4-7), about 30% of deaths in the first three minutes (before: 63-89%),
  some circle deaths (before: none), 2-4 squads when the final circles start. How: most squads land at least ~70 m from
  every other squad (`HOT_DROP` per squad size: a few pick a contested tier 1 place on purpose, never three to a place;
  duos and solos also land at loot spots between places); a squad loots together round its place and the squad's middle
  and stays there through the first wait (`LOOT_DWELL`, settles in once half have a long gun); a looting bot sees less
  (`LOOT_SIGHT`, `BotBrain.sightK`); nobody third-parties while the first circle waits, then `JOIN_FIGHT` by phase times
  the squad's `aggro` (late on squads mostly hold); holds are chosen near the squad, on a ring inside the next circle
  (edge squads, `plan.late` > 0.65, sit just outside it, `EDGE_RING`), and kept until the circle moves them; the first
  circle only moves a squad when its edge comes near; greedy squads (`plan.late` > 0.6) shrug the circle off until
  someone drops under `GREEDY_HP` and do not heal in it, which is where most circle deaths come from. Downed teammates
  are not pushed away by squad separation (more revives). `node dev/sim-br.mjs --pacing=N` prints the numbers per seed;
  the full run checks them over 12 matches.
- Squad size in friend rooms (js/ui/br-squad.js): Quads/Duos/Solos, the host's call (`app.lobby.brSquad`, sent with the
  lobby state and the vote), shown in the lobby header once the room plays BR and under the vote cards while a BR card
  is up (the cards' names follow it); a winning BR card plays the mode of that size (`brMode`). `buildBrRoster` keeps
  each lobby side together: whole squads first, then the remainders packed largest first.
- Host migration: every human guest gets a backup in its BR block (half the players every 1.5 s: packs, guns with
  rarity and kit, both hands' rounds, ammo pouch, fists, downs, use timers, drop plans while airborne; the rules' clock and
  the shrink's start). `Sim.fromSnapshot(..., { br: guestRules })` calls `BrRules.restore`: circle, the guest's loot
  mirror (same ids), packs, plates, downs, squads out, stats; held humans stay on the field.
- Inventory: fists are a third slot (HUD slots over the ammo readout; `brSlot` on the phone, `{act:'fists'}` to the
  host; the gun put away keeps its rounds in `br.stash`). Ammo for guns you do not hold goes in a pouch (`POUCH_CAP`),
  tops up a gun of that type when taken or brought back, the old gun's spare rounds go in it, and it drops on death.
- Visuals and clarity: crawl pose for downed players and a kneel for the reviver (characters.js), revive bars over both
  and on the reviver's HUD, parafoil canopies, the minimap zoomed to 120 m round you with the circle and a line in to the
  next circle (the full map is still a tap away), squad panel top right under 667 px, the down panel under your
  character; landing pings (tap the map: `{act:'ping'}` → `brping`), the kill leader named and shown on the maps every
  30 s, a "Final circles" callout. Tests: `python3 dev/ui-br-visuals.py [port]` (staged crawl, revive, canopy, minimap).

## Owner fixes (ROADMAP item 18)
- The drop: gliders hang in the air (js/render/characters.js `glideRig`): height from the glide clock (the local player's
  own `glideT`; anyone else's counted from when the view first shows them gliding), `GLIDE_ALT` 14 m at the jump (the
  transport's height), no stride, a shrinking shadow and their team ring on the ground below. The camera rides your own
  glide down (renderer: aboard it waits at the jump height, then follows the descent, level with the ground on landing).
  On touch-down the canopy folds away in 0.3 s (br-fx reads the rig's `chute`), the body dips into the legs and dust kicks
  up. Everyone's glides read the same.
- Ground guns: the take prompt sits in the gap between the vitals and the aim stick's ring, just over the plate and
  medkit buttons (measured per screen size, `#placeTake`), and says what the tap does to which hand: "Swap primary for"
  (the hand you hold, or the hand fists are out in) or "Pick up as secondary", then the gun in its rarity colour. The tap
  sends that slot. Out of rounds altogether (magazine, reserve and the pouch's rounds of its type, after the usual
  fall-through to a loaded other gun) the fists come out on their own a moment later (`Match.#brDry`).
- Out of the match: watching a teammate still in (Next teammate, Leave); squad out, Spectate or Leave. Spectate watches
  anyone left (`spectate.any`), Next player and Next squad; the plate becomes a strip at the bottom. Leave
  (`Match.leaveNow`) goes to results at once (no banner, `results.early`: a loss, your place, squads still in listed as
  "In"); a guest's phone just stops following; a host with other people in the room keeps simulating the match, drawing
  nothing (`headless`), until it ends for them (Rematch waits for it; going to the title ends it, as leaving a room does).

## Owner sweep (ROADMAP item 25)
- Drop screen: no Close map button. The drop map stays up until you jump (js/ui/br-hud.js; dev/ui-br-test.py checks
  that the button is gone).
- Flight lines (`flightLine` in js/sim/br.js): 40% of lines cross the middle, 35% a third and 25% run near an edge, on
  either side. A line with too little land under it is pulled in toward the centre until it has enough. Enough means a
  chord of at least 70% of the map, and at least 40% of the named places (4 or more) within glide reach. The line comes
  from the seed, and guests decode it from the snapshot as before. `node dev/sim-br.mjs --flight`: 60 seeds, 22 middle,
  17 thirds, 21 edges, every line over enough land.
- Bot squadmates of a human (the owner jumped, switched apps, came back, and his three bots moved as he did). Cause:
  in the glide a following bot steered for the human's position plus a 3 m offset every tick. On the ground it held
  4 m off the human with the human's `aim`, so the squad copied every stroke of the stick. After an app switch this was
  plain to see: the host stepped a frozen human and then a burst of catch-up. Now each bot glides to its own slot
  about 7 m off the human and moves it only once the human's slot has drifted 8 m away. On the ground it loots within
  22 m of the human and regroups past 34 m. Between times it holds its own spot round the human, re-picked once the
  human has moved 12 m, and watches its own sector (`aim` on bot objectives now works, js/sim/bots.js). Its landing slot is
  set from the human when it jumps, never from the transport's start point. `Match` (js/game/match.js) also resets its
  frame clock and catch-up on `visibilitychange` and lets go of the held input, so coming back is not a burst of
  stale steps. `node dev/sim-br.mjs --follow` checks four seeds with a 1.5 s freeze after the jump: bots glide in step
  with the human on 2% of ticks, walk with them on 14% of ticks and copy their aim on 4%.
- Healing: medkits only in BR (no regen; extraction keeps it). Medkits are half again as common, and bots heal by need
  and detour for a medkit when hurt.
- Pacing (the owner's match was over by the second circle). Changes:
  - Calmer early bots. By circle phase, any bot picks fights from 40/55/75/85/90/100% of its sight (`PHASE_SIGHT`) and
    notices someone not shooting at 20/40/60/75/85/100% of its usual rate (`PHASE_NOTICE`, `BotBrain.noticeK`).
  - A looting bot sees 45/60/80% (`LOOT_SIGHT`).
  - Heard fights are joined less (`JOIN_FIGHT` 0.03-0.1).
  - Fewer hot drops (`HOT_DROP` 2-4%) and wider drop spacing (`DROP_GAP` 120 m).
  - Squads' holds keep 40 m apart (`HOLD_GAP`).
  - Circles (js/shared/modes.js `BR.phases`): the first two come sooner (waits 90 and 75 s, were 130 and 110). The
    later ones are a little wider (26/19/13/8% of the map, were 18/11/6/3%) and held a little longer, so several squads
    fit in them. 795 s of circle (was 825).

  Measured with `node dev/sim-br.mjs --pacing=8 --modes=br` and `--pacing=6 --modes=brduo,brsolo`, seeds 101 + 7k,
  Frontier. Phase 4 is the fifth circle.

  | | Mean length | Deaths in first 3 min | Squads at phase 3/4/5/6 starts |
  |---|---|---|---|
  | Quads, before | 10.5 min (9.3-11.1) | 52% | 3.6 / 1.9 / 0.0 / 0.0 |
  | Quads, after | 11.9 min (10.7-12.4) | 41% | 6.0 / 5.0 / 3.8 / 1.6 |
  | Duos, before | 10.8 min | 27% | 6.2 / 1.5 / 0.7 / 0.0 |
  | Duos, after | 12.3 min | 30% | 10.8 / 6.7 / 3.8 / 2.2 |
  | Solos, before | 11.2 min | 22% | 6.2 / 4.0 / 0.3 / 0.0 |
  | Solos, after | 11.8 min | 40% | 14.2 / 8.5 / 4.7 / 1.8 |

  Bot-only matches end at 11-12.5 min, when the sixth and seventh circles leave no room. Matches with humans, who
  rarely play to the end, run longer. The full `node dev/sim-br.mjs` checks a 10.5-15 min mean, at most 45% early
  deaths, and 3 or more squads at phase 4 and 2 or more at phase 5, over 12 matches (now 11.3 min, 35%, 6.1 and 3.0).
  After the dev merge (signature attachments) quads measured 12.2 min, 46% early, and 5.6/4.8/3.8/2.1 squads; duos
  12.1 min, 28%, 10.7/6.8/3.8/2.2; solos 12.3 min, 38%, 12.3/6.8/3.5/2.8.

## Rebound (ROADMAP item 27)
The roadmap's "Resurgence": a small, fast battle royale with redeploys. Modes `rb` (Quads, 24 players, 6 squads) and
`rbduo` (Duos, 20 players, 10 pairs), on the Battle Royale tab of Multiplayer. Both are the `br` rule set with
`rebound: true` (js/shared/modes.js), so loot, plates, medkits, downs, revives, the transport and glide, spectating,
results and XP are battle royale's own; the numbers that differ are `RB` in js/shared/modes.js, and the code is the
`this.rb` branches of js/sim/br.js.
- Area: `reboundArea(map, seed)` (js/sim/br.js) puts a circle of `RB.area` (150 m) on the map where the named places are
  thickest (the seed picks among the four best centres, 60 m or more apart; 4 regions of Frontier over 40 seeds). It is
  the first circle (44% of Frontier). The transport flies a line across it, never far off its middle; bots only drop on
  places and loot spots inside it (`_dropCands`) and only jump over it.
- Circle: `RB.phases`, six phases whose radius `k` is a share of the area's: 75/45 0.68 3, 65/40 0.46 5, 60/35 0.31 8,
  55/30 0.19 12, 50/25 0.10 16, 35/35 0 22 (wait/shrink s, radius, damage per second). 9.2 minutes of circle. The HUD's
  pips and "Final circles" callout follow the mode's phase count (`brPhases`).
- Redeploy: a death while a squadmate is on the field (up or downed) earns one (`_canRedeploy`): after
  `RB.redeploy[phase]` seconds (12, 15, 20, 25) you parachute in (`_redeploy`) a few metres from the squadmate with the
  fewest enemies near (a downed one will do: land and pick them up), starting 40 m out on a full glide, with a common or
  uncommon long gun and two spare magazines, the pistol and 50 armor (`_startKit(p, true)`; a human's phone gets it as a
  `brinv` with `air: 2`). Damage, revives and knocks carry over. No redeploy for a death from circle 5 on
  (`RB.redeployEnd` 4, the phase index). A squad is out once nobody in it is up and nobody is waiting to redeploy, or
  nobody in it is left on the field; anyone waiting then stays out. A squadmate on the way back in also lets the last one
  up be downed instead of killed (`tryDown`), so a redeploy can turn into a revive. A held (dropped) human waits until
  the phone is back.
- Wire: per player bit 22 of the BR pack marks "waiting to redeploy" (`view.players[i].redeploy`, the squad panel says
  Redeploy); the guest's own inventory block carries its countdown (`view.br.inv.redeploy`, seconds); `view.br.area`,
  `view.br.rebound`, `view.br.phases`. Events `{t:'brwait', id, secs}` and `{t:'brredeploy', id, by, x, z}`. Host
  migration restarts a cut-short wait at 10 s.
- HUD (js/ui/br-hud.js): a note as the last row of the squad column, "Redeploys on until circle 5", then "Redeploys over";
  the out panel says "Redeploying in N" with a bar while you watch a squadmate; notices when you or a squadmate are back.
- Bots: squads land closer together (`RB_DROP_GAP` 110 m), settle in for 60 s, join heard fights at 0.6x BR's rate but
  from the second circle; a squad with someone waiting to land, and the last three squads, go calm (no third-partying,
  sight and notice x0.6) so redeployers can rejoin and the circle brings the end. Redeployed bots glide to their slot by
  the squadmate, then play the squad's plan (loot near it while under-geared, revive).
- Tuning (bots only, `node dev/sim-resurgence.mjs`): first cut (120 m area, 7.5 min of circle, BR's bots) ended in 3-6
  minutes with squads wiped in one fight before a redeploy could land. The calm rules, a 150 m area and a 9.2 minute
  circle give quads 7.4-8.4 min and duos 7.4-8.4 min, mean 7.9 (seeds 5-10), 30-40 redeploys a quads match. As with
  BR, matches with people in them run longer than bot-only ones.
- Tests: `node dev/sim-resurgence.mjs [--quick]` (area, circle, flight line, landing inside, redeploy rules and kit,
  the guest's view, no redeploy after the cut-off, a wiped squad stays out, a redeployer reviving the downed last one,
  determinism, 4 quads and 3 duos matches with length and redeploy checks); `python3 dev/ui-modes2-test.py [port]`
  (the playlist, the drop, the note, a redeploy countdown and glide, results).
