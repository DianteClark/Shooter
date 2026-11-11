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
- Tests: `node dev/sim-br.mjs` (units, then quads, duos and solos on Frontier: one winner inside 12 minutes, loot, plates,
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
