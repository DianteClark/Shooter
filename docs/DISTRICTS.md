# Districts and regions (ROADMAP items 66/67)

Owner: "Maybe make enormous maps that are made by like 3-5 smaller maps. Like all of downtown can be made up of smaller
maps. But seeing downtown as a whole it's huge on BR modes." Then: "If it's easier just do the districts idea with new
maps rather than redoing maps already in place." So **regions are built from new district maps**; the maps already in
the rotation (Downtown, Overpass, Night Market, Turnstile, Topside and the rest) are untouched.

A **region** is a giant map (400 x 400 m, `size: 'giant'`) assembled from 3-5 **district** maps placed edge to edge,
joined by connecting streets or terrain and filled out with the region's own blocks. A district is an ordinary 6v6 (or
Ground War) map: its own file, id, spawns, objectives, bounds and stat history. The region places it, it does not copy it.

## The rule that keeps the 6v6 maps safe
- **The district file is the source of truth.** `js/shared/maps/<district>.js` stays exactly what the 6v6 rotation
  plays (map-validate, fairness, three lanes, ids, cards, `won:<id>` stats). A region imports the built district map and
  places it with an offset (`placeDistrict` in js/shared/maps/region-kit.js). Change a district's layout and the region
  picks the change up on the next load; nothing is kept twice.
- **Ids are append-only.** Each district is a new map appended to `MAPS` (the City's: `midtown`, `oldquarter`,
  `canalrow`, `unionsq`), and so is the region (`meridian`). Regions never take a district's id; no existing map is
  replaced or edited.
- **Built to fit.** A district is designed for its place in the region: its middle lane is the region's street that
  runs through it (the City's boulevard), its edges are streets or shopfronts that face the region's connecting streets,
  and it is still a complete 6v6 map on its own (180-degree symmetric, three lanes, every standard mode's points,
  map-validate clean).
- **The window.** Each region lists its districts: `districts: [{ id, name, x, z, w, h }]` (the 6v6 map's rect in region
  metres). Cut out that rect and you have the 6v6 map's ground plan: same pieces at the same places, plus nothing
  (fill never enters a district rect or its 2 m margin). The district's own `spawns`, `points`, `lanes` and bounds are
  its 6v6 map's, untouched, so "play this district on its own" is just its id in the 6v6 rotation.

## What changes when a district sits inside a region
`placeDistrict(P, map, ox, oz, opts)` adds every piece of the district translated by (ox, oz), with these rules:
- **No border.** The district's `border` walls (its 6v6 perimeter) are dropped: its streets run on into the region's.
- **Buildings open up.** A battle royale needs loot indoors. Every solid `building`/`shop` block of the district that
  is at least 5.5 m on its short side becomes an enterable kit building (`Plan.building`, js/shared/maps/br-kit.js) on
  the same footprint, at the same height: 0.5 m walls, two or three 2.4 m doors on sides that open onto clear ground
  (tested against every district piece, so a door never faces a wall or a 1 m slot), windows, an inside partition on
  long ones, furniture and floor loot. Narrow blocks, tall landmark towers and anything the district marks `keep`
  stay solid. Outside the buildings the cover is the 6v6 cover, piece for piece.
- **Map-level art moves with it.** Fields the renderer reads (`el`, `strings`, `crossings`, `trains`, floor `zones`)
  are translated into the region's lists. Any other top-level
  list of rects or points a later builder adds to map data (destruction's breakable pieces, docs/DESTRUCTION.md on
  branch destruct) is carried over by the same offset (`CARRY` in region-kit.js), and per-piece flags ride along on the
  pieces themselves, so breakables stay breakable in the region.
- **Shells.** A district that is not at street level (a station, a rooftop) can be wrapped in a shell where its 6v6
  border was, with gates and a roof that dissolves inside (`shellWalls`, region-kit.js). The City needs none.
- **Tiers.** A district is a tier 1 or 2 place (`br.pois`) named after the district, with its own loot tier, caches and
  outdoor loot round its cover.

## How a region is laid out
- **Shared grid, matching edges.** Districts are placed so their main streets continue as the region's streets: in the
  City, the middle lanes of the Old Quarter, Midtown and Canal Row are one east-west boulevard across the whole map. Between
  districts there is always a connecting street of 12 m or more (no slot where two maps' edge pieces nearly touch: the
  validator's gap check covers the seams). The region's own blocks sit on an 8 m grid.
- **Shared theme.** A region has one giant-world palette and time of day (`theme: 'city'`, js/render/themes/city.js,
  through the giant-world streamer in js/render/themes/frontier.js like Jadefall). District pieces are drawn by their
  own 6v6 drawers (`skin: 'metro'`, `'topside'`), so a district looks like itself inside the region.
- **Fill.** Between and round the districts the region builds its own places with the battle royale kit: blocks of
  enterable shops and flats split by alleys, solid towers, parks, a rail depot, a waterfront, landmarks. All of it is
  region-only (no 6v6 map to keep stable), so it is free to change.
- **Budgets** (docs/BR-PERF.md): 3,300 walls at most (the engine's tested ceiling: 0.25 ms a tick at 2,248), 500-900
  loot spots with most indoors, 30-60 caches, 12-18 places; the streamer builds 32 m tiles near the camera, so draw
  calls and triangles depend on what is in view, not on the size of the region.

## What a region hosts
- **Battle Royale, Rebound, Extraction**: as every giant map (`modes: ['br']`, listed in `BR_MAP_IDS`, so the Battle
  Royale and Extraction tabs and the friend-lobby battle royale card offer it). `br.reboundAreas` puts Rebound's
  150 m areas over the densest districts; Extraction builds its exfils from the places (or `br.exfils` when a region
  wants its own).
- **Conquest and Breakthrough** (branch bfmodes, docs/MODES.md "Layout format" there): the region declares `map.bf`
  in that format, `{ conquest: [{ id, name, area, hq, flags }], breakthrough: [{ id, name, area, hq, sectors }] }`. The
  City has Conquest "Meridian: Boulevard" (five flags: Old Quarter, The Exchange, Midtown, Union Square, Canal Row; HQs
  at either end of the boulevard) and Breakthrough "Meridian: Crosstown" (west to east along the boulevard, one sector
  per district). Each district, a 6v6 map, plays them only if bfmodes derives layouts for 6v6 maps (it derives them
  from Domination flags on Ground War maps).
- **Destruction** (branch destruct, docs/DESTRUCTION.md there): nothing to carry. Its kind rules read each wall and the
  walls come with their flags; the opened-up buildings' outer walls are `bwall` (protected), their furniture and window
  sills break like Frontier's. A district that gets its own `BREAKABLES` entry hands it to the region with
  `offsetPicks` (region-kit.js).

## The City (`meridian`, Meridian City): the first region
400 x 400 m, blue hour with the city lights coming on. Four new districts, each a 6v6 map (theme `metro`):

| District | Map (size) | Region rect (x, z, w, h) | What it is |
|---|---|---|---|
| Midtown | `midtown` (large, 108 x 64) | 146, 168, 108, 64 | The centre: towers either side of Monument Plaza and its statue; north and south avenues as the long lanes, the boulevard through the middle |
| Old Quarter | `oldquarter` (medium, 76 x 46) | 58, 177, 76, 46 | Brownstone rows on narrow lanes round Fountain Square; a market street through the middle |
| Canal Row | `canalrow` (medium, 80 x 48) | 266, 176, 80, 48 | Warehouses either side of a canal; three bridges, three lanes, the water stops feet not shots |
| Union Square | `unionsq` (small, 56 x 36) | 172, 258, 56, 36 | Trees and hedges round the bandstand, shopfronts on its streets; close quarters |

Places round them (region fill, 18 in all): the Rail Depot, Uptown and Gallery Row (north), The Exchange (north of
Midtown), the Ferry Terminal and the Waterfront Docks (the east shore), City Hall, Mercy Hospital, Meridian Park,
Westgate, the Stadium, Southside and Chapel Row (south), the Power Station. The sea along the east edge is where the
coast region will join one day.

### What was built (files)
- `js/shared/maps/region-kit.js`: `placeDistrict`, `doorSpots`, `cityBlock` (region fill), `shellWalls`, `floorLoot`,
  `pruneUnreachable` (drops loot a bot could never reach, same rule as the nav grid and the validator), `offsetPicks`.
- `js/shared/maps/midtown.js`, `oldquarter.js`, `canalrow.js`, `unionsq.js`: the districts (appended to `MAPS`).
- `js/shared/maps/br-meridian.js`: the City. `districts` (each district's rect), `br` (18 places, loot, caches,
  `circleBias`, `reboundAreas`, `exfils` with reserved landing zones), `bf` (Conquest and Breakthrough layouts).
  District street zones become painted `roads`; streets of the city's own are `ROADS`.
- `js/render/themes/city.js`: the City palette (`THEMES.city`, `giant: true`), ground, zones, the brownstone style,
  per-tile lights (streetlamp pools baked across tile edges), lamp posts, El decks, lantern strings, trains, shop sign
  styles, the edge of the city. Hooked into the giant-world streamer (themes/frontier.js `EXTRAS`), which also draws
  `void` pits (light wells) as holes, not water.
- Wiring: `map:<id>` icons (icons-maps.js, icons.js), cards (cardbook.js `MAP_ART`; `meridian` is plays-based like the
  islands; new pattern `metropolis` in cardart.js), `THEME_AUDIO.city`, ambient `city`, props `city`, `THUMB_STYLE.city`,
  `dev/render-maps.html` framings, art `assets/maps/<id>.jpg` and `assets/maps/meridian-overview.jpg`.

### Measured (2-vCPU sandbox, busy; SwiftShader frame times compare runs here only, calls and triangles are exact)
| | walls | buildings | loot / caches | places | host tick mean (validator roam / sim-br quads) |
|---|---|---|---|---|---|
| Frontier | 1,561 | 75 | 560 / 44 | 17 | - / - |
| Meridian City | ~2,800 | ~120 | ~870 / ~43 | 18 | 0.36-0.51 ms / 0.24 ms |

| Low quality, 932 x 430, on the ground after the jump (dev/ui-sweep-perf.py) | calls median (max) | triangles median (max) | script ms median (max) |
|---|---|---|---|
| Frontier (`br`) | 51.5 (59) | 61.0k (83.3k) | 10.6 (18.8) |
| Jadefall (`brjade`) | 47.0 (53) | 55.1k (55.5k) | 9.8 (20.0) |
| Meridian, Midtown's boulevard (`brcity`) | 55.5 (69) | 48.6k (68.9k) | 12.0 (81.5: the frame the test teleports the player in, when the nearest tiles are built at once) |

### Tuning notes
- Places: Midtown is the only tier 1 district; the Old Quarter, Canal Row and Union Square are tier 2. With three tier 1
  districts side by side, Rebound squads were all geared within a minute and some matches ended at 4.5 min.
- Rebound areas (`br.reboundAreas`): four 150 m areas over the middle of the city. One leaning east over the sea left
  too little land (a 4.5 min match); one leaning north put Gallery Row on its edge, where a bot's landing spot pushed
  out of a building ended up just outside the area. Measured after: quads 5.9-7.3 min, duos 5.9-7.1, mean 6.5.
- Extraction's landing zones are named and reserved before the fill (a dense city has no open clearings for the
  derived ones): seven round the city, the final at one of the four junctions round Midtown, eight inserts.
- dev/sim-extract.mjs: two unit checks were map-dependent (squads parked a metre apart in one corner took finishers
  off each other; an idle guest was found by a patrol). The test now parks them 2.2 m apart and keeps the guest up;
  Frontier and Jadefall still pass.

### Tests
`node dev/map-validate.mjs midtown oldquarter canalrow unionsq meridian`; `node dev/sim-br.mjs --map=meridian`;
`node dev/sim-resurgence.mjs --map=meridian`; `node dev/sim-extract.mjs --map=meridian` (`--quick` for one match
each); `python3 dev/ui-sweep-perf.py [port] [out] brcity`; `node dev/br-overview.mjs meridian`;
`node dev/render-snapshots.mjs midtown oldquarter canalrow unionsq meridian`.

## The Desert (`sirocco`, Sirocco Basin): the second region
400 x 400 m, desert dusk with a sandstorm coming in from the west. Four new districts, each a 6v6 map (theme `sirocco`,
js/render/themes/sirocco.js), built to look and play nothing like Dust, Oasis and Canyon (untouched): red sandstone and
red mud brick instead of pale adobe, striped canvas, copper-green spoil and steel dishes, a dusk sky instead of the hard
white afternoon, and layouts of their own (a walled courtyard, a cliff street, terraces, fenced yards).

| District | Map (size) | Region rect (x, z, w, h) | What it is |
|---|---|---|---|
| Caravanserai | `caravanserai` (large, 100 x 64) | 150, 168, 100, 64 | The centre: a walled caravan inn straddling the Spice Road; the road runs in at the west gate, across the courtyard past the domed well house (the Sunwell) and out at the east gate. Arcades inside the north and south walls, two gates in each; the souk street along the north edge, camel yards along the south |
| Red Gulch | `redgulch` (small, 56 x 36) | 82, 182, 56, 36 | A canyon town: cliffs on both sides, a row of tall mud tower houses at the foot of each, the main street (the road) between them under the stone arch; ledge paths along the cliff feet, 3 m alleys joining them to the street |
| Signal Ridge | `signalridge` (medium, 76 x 46) | 262, 128, 76, 46 | A dish array on a ridge: dishes on pedestals along the crest paths, the great dish over the access road (the road's north branch), chain-link transformer yards (stop feet, not shots), prefab huts, the control block, radio masts |
| Copperstep | `copperstep` (medium, 80 x 50) | 262, 224, 80, 50 | An open-pit copper mine: upper benches with tin sheds, two waist-high terrace faces down each side with ramps, the pit floor and its haul road (the road's south branch) past the headframe, ore carts on two tracks, a hopper, a haul truck |

The Spice Road (z 200) comes in from the west edge through the canyon, Red Gulch and the inn to the Fork Road (x 256),
which runs north-south between the inn and the two eastern districts; the ridge and the mine sit on its two branches
(z 151 and 249). Places round them (region fill, 14; 18 in all): the Rail Halt, the Citadel (tier 1: a walled fort with
its keep and barracks), the Airstrip and the Fuel Stop on the Highway across the north; the Necropolis (tombs cut into
the canyon's north wall) and Gulch Mouth on the canyon floor; the Souk Quarter and Lower Town either side of the inn;
the Pump Station, the Smelter and the Wreck Dunes (a cargo plane down in two pieces) in the east and south; the Date
Grove, the Nomad Camp and the Saltworks in the south-west. The Fork's trading post (Conquest's flag E) has no place
name of its own. The canyon's two cliff walls run from Red Gulch to the west edge with a pass in each for the west
track.

### What was built (files)
- `js/shared/maps/caravanserai.js`, `redgulch.js`, `copperstep.js`, `signalridge.js`: the districts (appended to `MAPS`).
- `js/shared/maps/br-sirocco.js`: the basin. `districts`, `br` (18 places, loot, caches, `circleBias`, `reboundAreas`,
  `exfils` with reserved landing zones), `bf` (Conquest "Sirocco: Spice Road", five flags Red Gulch, Souk Quarter,
  Caravanserai, Lower Town, The Fork, HQs at either end of the road; Breakthrough "Sirocco: Caravan Run", west to east,
  sectors Red Gulch, Caravanserai, The Fork with one objective on each branch). District road zones become `dirt` tracks.
  `cliffWall` builds the canyon walls whole (tested once, pieces touching end to end, allowed to meet the map edge: the
  first pass tested each 16 m piece against its neighbour and kept every other one).
- `js/render/themes/sirocco.js`: the district theme (`THEMES.sirocco`, dress, stage, thumb): tower houses, souk shops
  with awnings, merchant houses, the serai wall and ksar towers, arcade pillars and their arches, the arch over Red
  Gulch's street (drawn to its partner pier), the Sunwell, layered cliffs, terrace faces, ore carts, hopper, headframe,
  dishes, chain-link and rail fences, camels, wagons, pavilion, canopy stalls, the wreck's hull pieces, dunes, palms.
  Cliffs on the south side of the ground they wall in (the south half, or flagged `low`) are drawn as a low lip: the
  camera looks north at 55 degrees and a 7 m cliff hid the whole south ledge path. Red Gulch's houses are 4.8-5.8 m
  for the same reason (as Midtown's towers).
- `js/render/themes/basin.js`: the basin's palette (`THEMES.basin`, `giant: true`), ground regions (`dunes`, `scrub`,
  `gulch`, `saltpan`, `spoil`, all dressed by `sirocco`), zones and styles under keys of their own (the streamer's
  tables are shared: `court`, `plaza` and the style `tin` belong to Frontier and Jadefall, so the districts' zones are
  `serai`, `gulchsq`, `pad`, `compound` and the shed style `tinshed`), lanterns by the bigger buildings, the Highway's
  lamps, sand ripples and scrub per tile, and the mountains round the edge (tall only to the north).
- Wiring: `EXTRAS.basin` and the merged tables in themes/frontier.js; world.js `DRESS`/`THEME_STAGES`/`THUMB_STYLE`;
  `THEME_AUDIO.sirocco`/`basin`, footsteps on sand, ambient life (dust devils), props; icons (icons-maps.js, icons.js),
  cards (cardbook.js `MAP_ART`, `sirocco` plays-based; patterns `serai`, `gulch`, `terraces`, `dishes`, `sirocco` in
  cardart.js); `dev/render-maps.html` framings; perf case `brsirocco`; art `assets/maps/<id>.jpg` and
  `assets/maps/sirocco-overview.jpg`.

### Measured
2-vCPU sandbox, busy (load 3-10 from another builder: frame and worst-tick times compare nothing; calls, triangles and
counts are exact).

| | walls | buildings | loot / caches | places | host tick mean (validator roam / sim-br quads) |
|---|---|---|---|---|---|
| Meridian City | 2,766 | 122 | 871 / 41 | 18 | 0.36-0.51 ms / 0.24 ms |
| Sirocco Basin | 1,901 | 104 | 582 / 45 | 18 | 0.60 ms / 0.24 ms (duos 0.17, solos 0.19; p99 0.8-1.9 ms) |

| Low, 932 x 430, on the ground after the jump (dev/ui-sweep-perf.py), same run | calls median (max) | triangles median (max) |
|---|---|---|
| Meridian, Midtown's boulevard (`brcity`) | 50 (55) | 41.5k (52.1k) |
| Sirocco, the Caravanserai's courtyard (`brsirocco`) | 46 (50) | 49.5k (63.2k) |

- Battle royale (sim-br, 12 matches): 12.0 min mean (10.6-12.4), 36% of deaths in the first 3 min, 8.2 squads at
  phase 4. Rebound: quads 5.9-8.5 min, duos 5.9-8.4. Extraction (quick): quads 2/4 squads out, duos 4/8.
- Conquest "Spice Road": with HQs at the canyon's mouth (40, 200) the west side lost both seeds (0/318, 0/179: the
  canyon is the only way out); with the west HQ at (58, 200), the east one and flag E 8 m further out, 2 to 1 for the
  west over three seeds, 6.8-10.8 min, 2.0-2.3 flags a side, stuck 0.01-0.07 s a bot a minute, tick 0.62-0.66 ms mean.
- Breakthrough "Caravan Run": at 300/240 tickets the attackers won both seeds, one in 6.2 min with 475 left; at
  260/210, 2 of 3 (6.2 and 14.0 min, 15 tickets left in the second) and one hold at sector 1. Tick 0.58-0.69 ms mean.
- 6v6 (map-validate, 60-120 s per mode): no hard failures; Signal Ridge's control block stood on the west spawns' way
  out (4 stuck in TDM) and moved 1.8 m east (0 after).

### Tests
`node dev/map-validate.mjs caravanserai redgulch copperstep signalridge sirocco`; `node dev/sim-br.mjs --map=sirocco`;
`node dev/sim-resurgence.mjs --map=sirocco`; `node dev/sim-extract.mjs --quick --map=sirocco`;
`node dev/sim-conquest.mjs --maps=sirocco`; `node dev/sim-breakthrough.mjs --maps=sirocco`;
`python3 dev/ui-sweep-perf.py [port] [out] brsirocco`; `node dev/br-overview.mjs sirocco`;
`node dev/render-snapshots.mjs caravanserai redgulch copperstep signalridge sirocco`.
## The North (`kaldvik`, Kaldvik): the fourth region (branch region4)
400 x 400 m, a fishing town on a frozen fjord under a **blizzard dusk**: a copper sun low in the west-south-west behind
a snow squall, warm grey-white snow with long violet shadows, sodium lamps and lit windows, snow driving in sideways
from the west. Made to look and play unlike the snow maps already in the game (Frostline and Icebreaker: blue hour and
an aurora over station red; Polestar: polar night; Observatory: an alpine dawn), which are untouched: timber, falu red,
ochre, research yellow and slate; walkable ice everywhere (the harbour, the river, the reservoir, the sea ice) with
open leads that stop feet but not shots. Four new districts, each a 6v6 map (theme `north`, region tag Arctic):

| District | Map (size) | Region rect (x, z, w, h) | What it is |
|---|---|---|---|
| Trawler Basin | `trawler` (medium, 80 x 48) | 160, 40, 80, 48 | Net sheds and fish halls on two quays; between them the frozen basin with two trawlers locked in the ice bow to stern, shanties, a lead; the ice road between the ships is the middle lane |
| Telemark | `telemark` (large, 108 x 64) | 34, 188, 108, 64 | Ski village: chalets and the old lodge, the chairlift's base station on the green with its pylons running north and south, car parks; its village street is the Fjord Road |
| Ice Core | `icecore` (medium, 76 x 46) | 290, 197, 76, 46 | A drilling camp on the ice shelf: lab pods on legs, snowcats, drums, crevasses between the lanes, and the fight under the derrick's four legs in the middle |
| Spillway | `spillway` (small, 56 x 36) | 192, 300, 56, 36 | The dam's crest runs north-south through the middle (parapets broken at the lanes, two gatehouses); the frozen reservoir west of it and the tailrace east (the map is a 180-degree turn, so the zones say which ice is which) |

Places (18): the four districts (Telemark tier 1, the others tier 2), Kaldvik Town (tier 1: the church and its steeple,
the town hall, the square with the town's lit tree, four blocks), Birchwood, the Cannery, Lighthouse Point, the Tank
Farm, the Radar Dome, the Freight Depot (the ore line), the Logging Camp, the Ski Jump, the Summit Lodge (the chairlift
runs on up to it from Telemark), the Ice Fishing Camp on the reservoir, the Turbine Hall, the Shelf Airstrip and the Hot
Springs. Open sea along the north edge (sea ice inside it), mountains south and west, the shelf's ice cliffs east.

- **Modes**: Battle Royale, Rebound, Extraction (`BR_MAP_IDS` picks it up as a giant map). `map.bf`: Conquest
  "Kaldvik: Fjord Road" (A Telemark, B Kaldvik Town, C Crossroads, D Birchwood, E Ice Core; HQs at the two ends of the
  Fjord Road) and Breakthrough "Kaldvik: Harbour Run" (north to south down the Harbour Road: Trawler Basin, Kaldvik
  Town, Spillway; attackers from the sea ice, defenders' last stand on the reservoir).
- **Files**: `js/shared/maps/trawler.js`, `telemark.js`, `icecore.js`, `spillway.js`, `br-kaldvik.js` (appended to
  `MAPS`); `js/render/themes/north.js` (THEMES.north for the districts, THEMES.kaldvik for the region; the drawers
  for every new piece: chalets, net sheds, fish halls, shanties, lab pods, the lift station and pylons, the intake
  tower, gatehouses, the steeple, tanks, the radome, the ski jump, trawlers, the plane, the derrick, firs and birches,
  snowmobiles, ski racks, snow fences, drifts, pressure ridges, icebergs, leads, crevasses, hot springs; the 6v6 stages;
  the region's tables and `giant` extras). Wiring: world.js `DRESS`/`THEME_STAGES`/`THUMB_STYLE`, frontier.js tables
  and `EXTRAS.kaldvik`, audio (snow steps, the arctic room), ambient, props, cards (Iced In, Chairlift, Bore Hole,
  Floodgate, Squall Line; new pattern `fjord`), icons, `dev/render-maps.html` framings, `dev/ui-sweep-perf.py` case
  `brnorth`, art `assets/maps/<id>.jpg` and `assets/maps/kaldvik-overview.jpg`.
- **region-kit.js is unchanged.** Everything new is additive and keyed so it cannot repaint another region: ground
  regions are `kv*` (kvtown, kvsnow, kvice, kvshelf, kvforest, kvpiste, kvquay, kvlake), building styles `kv*`
  (kvnordic, kvchalet, kvboathouse, kvshed, kvlab, kvplant, kvchurch, kvhall), new zone kinds only (seaice, river,
  piste, lake, reservoir, tailrace, crest, drillpad; Kaldvik's `zoneColour` repaints the shared kinds on its own map
  only), and a new road kind `plough` (packed slush, no kerbs or paint) added to the streamer's `ROAD` table.
- **Weather** stays in the existing pools: 130 streaks, 160 flakes and 14 gusts (the arctic set is 316 particles too).

### Measured (2-vCPU sandbox shared by four builders; wall-clock worst ticks are mostly the neighbours)
| | walls | buildings | loot / caches | places | host tick mean (validator roam / sim-br quads) |
|---|---|---|---|---|---|
| Meridian City | ~2,800 | ~120 | ~870 / ~43 | 18 | 0.36-0.51 ms / 0.24 ms |
| Kaldvik | 2,011 | 90 | 681 / 41 | 18 | 0.61 ms / 0.18 ms |

| Low quality, 932 x 430, on the ground after the jump (dev/ui-sweep-perf.py, same run) | calls median (max) | triangles median (max) | script ms median (max) |
|---|---|---|---|
| Meridian, Midtown's boulevard (`brcity`) | 47.5 (54) | 36.6k (59.6k) | 11.0 (36.4) |
| Kaldvik, the church square (`brnorth`) | 41.5 (54) | 32.8k (64.8k) | 8.2 (23.4) |

- Rebound (`node dev/sim-resurgence.mjs --map=kaldvik`): quads 7.2-8.0 min, duos 7.0-8.4 min, 30-52 redeploys a quads
  match. Conquest: B and D sit a touch west of the middle (the west has to push through Telemark's chalets): 3 / 3 over
  six seeds, 6.7-9.1 minutes (before: the east won 5 of 6 with C at the river and D 22 m nearer its HQ). Breakthrough:
  attackers 1 of 2 (all three sectors in 7.3 min; held at sector 2 of 3 at the clock).
- Districts (`node dev/map-validate.mjs trawler telemark icecore spillway`): every mode, fairness within 10% (intact
  and all broken), bot matches with no stuck bots worth a warning (Trawler's Kill Order had no objective activity in its
  60 s, as other maps do).

### Tests
`node dev/map-validate.mjs trawler telemark icecore spillway kaldvik`; `node dev/sim-br.mjs --map=kaldvik`;
`node dev/sim-resurgence.mjs --map=kaldvik`; `node dev/sim-extract.mjs --map=kaldvik --quick`;
`node dev/sim-conquest.mjs --maps=kaldvik --seeds=6`; `node dev/sim-breakthrough.mjs --maps=kaldvik`;
`python3 dev/ui-sweep-perf.py [port] [out] brnorth`; `node dev/br-overview.mjs kaldvik`;
`node dev/render-snapshots.mjs trawler telemark icecore spillway kaldvik`.

## The rest (plan)
Each later region is new districts too (the existing maps stay as they are):
- **The Coast**: a shoreline region east of the City's waterfront: a fish market, a boardwalk and its pier, a tidal
  quarter of stilt houses, a lighthouse headland (4 new 6v6 maps) along a 400 m quay.
- **The Desert**: built, see Sirocco Basin above.
- **The Wilds**: a river valley: a jungle landing, a waterfall temple, a rope-bridge gorge.
- **The North**: built (above, Kaldvik).
- Each later region reuses region-kit.js unchanged: list the districts and their offsets, write the fill, a palette
  module, the art. A district can be in at most one region.
- Later, a district that only exists inside a region (a region place good enough for 6v6) can be promoted: make it its
  own map file with spawns and objectives, then have the region place it like the others.
