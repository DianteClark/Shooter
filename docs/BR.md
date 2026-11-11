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
