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

## The Coast (`kittiwake`, Kittiwake Bay): the third region
400 x 400 m, a bright, windy morning (theme `shore`): a low sun out of the east, a pale washed sky, spray and sand on
an onshore wind, a cold green-grey sea, gulls (ambient life `shore`). The west and the south are open sea. Four new
districts, each a 6v6 map. Unlike the City's, they are drawn by the giant-world streamer with the bay's own palette
(`giantWorld: true`, `theme: 'shore'`, like Tidebreak and Coral Quarter), so they look the same on their own as in the
bay, and nothing like Harbor, Pier, Sunken or Jadefall (none of which was touched):

| District | Map (size) | Region rect (x, z, w, h) | What it is |
|---|---|---|---|
| Fish Market | `fishmarket` (medium, 80 x 48) | 40, 152, 80, 48 | An open iron market hall on its columns, counters under it, the auction floor (B) in the middle; harbour basins at two corners with a trawler in each; quay road and dock road as the long lanes |
| Shipyard | `shipyard` (large, 104 x 60) | 148, 146, 104, 60 | A dry dock through the middle with two hulls bow to bow (B between the bows), two gantry cranes over it, steps in the rim; plate stacks, timber and sheds in the yards; fitting-out quays at two corners |
| Boardwalk | `boardwalk` (large, 100 x 56) | 140, 272, 100, 56 | The resort on the spit: the planked promenade under the pier gates (B), a carousel and its image the helter-skelter, rows of arcades, beaches with huts, deckchairs and groynes, wading surf on both shores |
| Stilt Row | `stiltrow` (medium, 80 x 50) | 262, 220, 80, 50 | A fishing hamlet on a shingle bank between two tidal flats: stilt huts on plank platforms out on the flats, a creek with a footbridge into each side, net sheds and the cockle shed on the bank |

Harbour Road (z 176) is the middle lane of the Fish Market and the Shipyard and runs on west to the Lifeboat Station
and east past the Cannery to the headland. Between the districts: Slipway Lane (28 m, the town down to Harbour Road and
on as the Causeway across the back bay to the spit). Places round them (region fill, 18 in all): Market Cross, the
Harbour Office, St Agnes, Windmill Hill (the town on its hill, north), the Freight Quay's wet basin with a coaster in
it, the Lifeboat Station at the harbour mouth, the Cannery, the Coastguard Station, the Gun Battery and Lantern Point
(the lighthouse) on the headland, the Dune Camp, the Lido and the Winter Gardens on the spit, the Pleasure Pier with
its big wheel out at sea. The back bay between Harbour Road and the spit is tidal flats you wade (`shallows`: slower,
no slides) with a deep channel through them, crossed by the Causeway's bridge.

### Water: one lattice (js/shared/maps/coast-kit.js)
The bay keeps the same land/water lattice as Jadefall's maps (isle-kit.js `cells`, deep water as `water` walls,
wading water as `shallows`), so the streamer draws beaches, banks and the shallow-water sheet as it does on the island.
- A district gives its water as rects for its west half (`mirror` adds the 180-degree images): `deep` (flag `quay`: a
  stone quay edge, drawn with the streamer's `waterBanks` instead of a beach slope), `steep` (a creek), `shallow`,
  `deck` (plank platforms and footbridges: dry footing, planks drawn, water under). `coastWater` turns them into the
  lattice, the water walls, the shallows, the deck rooms and `underDecks`.
- The region builds one lattice for the whole bay: `seaBase` returns the district's own cell inside each district rect
  and the sea, surf, back bay and channel outside, then the bay's own quays and decks. Water walls come only from cells
  outside the districts (`wallMask`); the districts' come through `placeDistrict` as usual. The shallows list is the
  whole lattice's. District offsets are even, so their 2 m cells line up.
- Districts carry art lists the bay translates into its own (`halls`, `docks`, `promenade`), plus their deck rooms and
  `underDecks`.

### What was built (files)
- `js/shared/maps/coast-kit.js` (new): `coastWater`, `waterOf`, `mirror`.
- `js/shared/maps/fishmarket.js`, `shipyard.js`, `boardwalk.js`, `stiltrow.js`: the districts (appended to `MAPS`).
- `js/shared/maps/br-kittiwake.js`: the bay. `districts`, `br` (18 places, loot, caches, `circleBias`,
  `reboundAreas`, `exfils` with reserved landing zones), `bf` (Conquest "Kittiwake: Harbour", six flags: Fish
  Market, Shipyard, Swing Bridge, Boardwalk, The Cannery, Stilt Row; Breakthrough "Kittiwake: Harbour Road", west to
  east, one sector per place: Fish Market, Shipyard, The Cannery).
- `js/render/themes/shore.js` (new): `THEMES.shore` (`giant: true`), ground, zones, roads, building styles, the `shore`
  skin's drawers for every piece the bay uses (market hall columns and counters, sheds, ice house, smokehouse, net
  shops, stilt huts, arcades and tea rooms, beach huts, kiosks, carousel, helter-skelter, bandstand, caravans, hulls on
  blocks and afloat, gantry and quay cranes, boats, groynes, windbreaks, deckchairs, nets, the lighthouse, the
  windmill, the spire, the mast, the big wheel), tile decor (the hall's frame, the dock walls, gantry girders, the pier
  gates' arch, promenade lamps and bunting) and the edge of the bay (dry-stone walls and heath).
- Wiring: `themes/frontier.js` merges the tables, `EXTRAS.shore`, and draws `quay` water as stone banks (one line,
  additive); `world.js` `DRESS.shore`, `THUMB_STYLE.shore`; `THEME_AUDIO.shore`, step surface sand, ambient `shore`,
  props `shore`; `map:<id>` icons, cards (cardbook.js `MAP_ART`; `kittiwake` plays-based), new card patterns
  `seawind`, `drydock`, `stilts` and `fishhall` (cardart.js), framings in `dev/render-maps.html`,
  perf case `brbay` in `dev/ui-sweep-perf.py`, art `assets/maps/<id>.jpg` and `assets/maps/kittiwake-overview.jpg`.
- region-kit.js is unchanged: `placeDistrict` already keeps per-piece flags (`quay`, `sea`, `channel`), and the
  district's deck rooms and art lists are translated by the bay itself.

### Measured
(2-vCPU sandbox shared with three other builders: CPU times wander; calls and triangles are exact.)

| | walls | buildings | loot / caches | places | shallows rects | host tick mean (validator roam / sim-br quads, duos, solos) |
|---|---|---|---|---|---|---|
| Meridian City | 2,766 | 122 | 871 / 41 | 18 | - | 0.36-0.51 ms / 0.24 ms |
| Kittiwake Bay | 2,132 | 96 | 646 / 37 | 18 | 112 | 0.72 ms (worst 33.7 CPU, busier box) / 0.28, 0.20, 0.17 ms |

| Low quality, 932 x 430, on the ground after the jump (dev/ui-sweep-perf.py, the same run) | calls median (max) | triangles median (max) | script ms median (max) |
|---|---|---|---|
| Meridian, Midtown's boulevard (`brcity`) | 49.0 (53) | 44.2k (65.6k) | 9.5 (49.4) |
| Kittiwake, the Shipyard's west yard (`brbay`) | 37.5 (45) | 19.9k (35.5k) | 10.0 (15.3) |

- Region build (node import of the map file): 209 ms against Meridian's 182 ms; the lattice (40,000 cells) and the
  reach flood are most of the difference.
- Battle royale pacing (sim-br, 12 bot matches): 11.7 min mean (9.1-12.6), 40% of deaths in the first three minutes.
  Rebound (sim-resurgence): 5.9-8.3 min, mean 7.1. Shipyard is the only tier 1 district; Lantern Point is the other
  tier 1 place.
- Conquest (sim-conquest, bot matches): with the Causeway as flag C the east side had two flags near its HQ (the
  Cannery, Stilt Row) to the west's one and won both seeds by 322-408 tickets; with C at the Swing Bridge the west won
  all three. With D moved from the pier gates to the promenade's east end (214, 300) as well: west 2, east 1 over three
  seeds, 10-15 minutes, stuck 0.04-0.07 s a bot a minute, host tick 0.68-0.84 ms mean. Breakthrough "Harbour Road":
  attackers took all three sectors in one of two seeds (9.9 min) and were held in the first in the other (4.0 min),
  as on Meridian.
- Extraction (sim-extract --quick): quads 3 of 4 squads out, duos 2 of 8, tick 0.34-0.36 ms mean.
- dev/sim-br.mjs's pickup check stood the test player on the nav cell nearest (200, 200), which in the bay is inside
  the Shipyard's opened paint store, on its floor loot; the test now clears the map's own items round that spot.

### Tests
`node dev/map-validate.mjs fishmarket shipyard boardwalk stiltrow kittiwake`; `node dev/sim-br.mjs --map=kittiwake`;
`node dev/sim-resurgence.mjs --map=kittiwake`; `node dev/sim-extract.mjs --map=kittiwake --quick`;
`node dev/sim-conquest.mjs --maps=kittiwake`; `node dev/sim-breakthrough.mjs --maps=kittiwake`;
`python3 dev/ui-sweep-perf.py [port] [out] brbay`; `node dev/br-overview.mjs kittiwake`;
`node dev/render-snapshots.mjs fishmarket shipyard boardwalk stiltrow kittiwake`.

## The rest (plan)
Each later region is new districts too (the existing maps stay as they are):
- **The Coast**: built, see Kittiwake Bay above.
- **The Desert**: built, see Sirocco Basin above.
- **The Wilds**: a river valley: a jungle landing, a waterfall temple, a rope-bridge gorge.
- **The North**: a frozen harbour, a ski village, a research base on the ice shelf.
- Each later region reuses region-kit.js unchanged: list the districts and their offsets, write the fill, a palette
  module, the art. A district can be in at most one region.
- Later, a district that only exists inside a region (a region place good enough for 6v6) can be promoted: make it its
  own map file with spawns and objectives, then have the region place it like the others.
