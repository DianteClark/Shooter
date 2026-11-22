# Districts and regions (ROADMAP items 66/67)

Owner: "Maybe make enormous maps that are made by like 3-5 smaller maps. Like all of downtown can be made up of smaller
maps. But seeing downtown as a whole it's huge on BR modes."

A **region** is a giant map (400 x 400 m, `size: 'giant'`) assembled from 3-5 **district** maps placed edge to edge,
joined by connecting streets or terrain and filled out with the region's own blocks. A district is an ordinary 6v6 (or
Ground War) map: its own file, id, spawns, objectives, bounds and stat history. The region places it, it does not copy it.

## The rule that keeps the 6v6 maps safe
- **The district file is the source of truth.** `js/shared/maps/<district>.js` stays exactly what the 6v6 rotation
  plays (map-validate, fairness, three lanes, ids, cards, `won:<id>` stats). A region imports the built district map and
  places it with an offset (`placeDistrict` in js/shared/maps/region-kit.js). Change a district's layout and the region
  picks the change up on the next load; nothing is kept twice.
- **Ids are append-only.** A region is a new map id appended to `MAPS` (the City: `meridian`). A district that one day
  replaces an existing map keeps that map's id. Regions never take a district's id.
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
- **Map-level art moves with it.** Fields the renderer reads (Overpass `el`, Night Market `strings` and `crossings`,
  Turnstile `trains` and floor `zones`, Downtown `zones`) are translated into the region's lists. Any other top-level
  list of rects or points a later builder adds to map data (destruction's breakable pieces, docs/DESTRUCTION.md on
  branch destruct) is carried over by the same offset (`CARRY` in region-kit.js), and per-piece flags ride along on the
  pieces themselves, so breakables stay breakable in the region.
- **Shells for maps that are not at street level.** Turnstile is a station under the street: the region wraps its rect
  in a tiled shell with four stair entrances and a roof that dissolves when you go in (so the whole station is
  "indoors" for loot and late-circle holds). Topside is a tower top: in the City it is the site at street level of the
  tower going up, behind hoarding with gates; its light wells read as excavation pits (they still stop feet, not shots).
- **Tiers.** A district is a tier 1 or 2 place (`br.pois`) named after the district, with its own loot tier, caches and
  outdoor loot round its cover.

## How a region is laid out
- **Shared grid, matching edges.** Districts are placed so their main streets continue as the region's streets: in the
  City, Overpass's El avenue, Downtown's middle street (past the fountain park) and the Night Market's drag line up into
  one east-west boulevard across the whole map, and the El itself runs on west of Overpass to the map edge. Between
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
- **Conquest and Breakthrough** (branch bfmodes, docs/MODES.md there): the region declares its large-mode data
  whatever that builder settles on; until then the hook is `bf: { flags: [{ id, name, x, z, r, district }], sectors:
  [{ id, name, flags: [ids], rect }] }` on the map: one or two flags per district (a district is a natural sector),
  sectors ordered west to east for Breakthrough's push. A region can also cut a Ground War map out of itself later as
  Jadefall's Tidebreak and Coral Quarter were (`giantWorld: true` on a huge map).

## The City (`meridian`, Meridian City): the first region
400 x 400 m, dusk with the city lights coming on. Five districts:

| District | 6v6 map (size) | Region rect (x, z, w, h) | In the City |
|---|---|---|---|
| Downtown | `downtown` (huge, 136 x 80) | 150, 160, 136, 80 | The centre: towers, the fountain park, the construction site, the subway plaza |
| Overpass | `overpass` (large, 104 x 64) | 34, 168, 104, 64 | West of Downtown; its El carries on west to the edge of the city |
| Night Market | `neon` (medium, 64 x 44) | 298, 178, 64, 44 | East of Downtown, its drag on the boulevard down to the waterfront |
| Turnstile | `turnstile` (small, 56 x 34) | 190, 254, 56, 34 | Central Station under Union Square, south of Downtown |
| Topside | `topside` (medium, 68 x 44) | 184, 102, 68, 44 | Topside Works: the tower site north of Downtown |

Region places round them (fill): Rail Depot (north-west), Meridian Park (west), Uptown (north), Ferry Terminal and the
Waterfront Docks (the east shore), City Hall (east), the Stadium (south-west), Old Town (south), Mercy Hospital
(south-east), Westgate. The sea along the east edge is where the coast region (Harbor, Pier, Sunken) will join one day.

## The rest (plan)
- **The Coast** (Harbor, Pier, Sunken + a lighthouse headland): a shoreline region on the City's east shore idea: the
  three maps along a 400 m quay, Sunken's flooded quarter as the tidal south, piers into the sea, a ferry to an islet.
- **The Desert** (Dust, Oasis, Canyon, Launchpad): Canyon's gorge as the spine, Dust's town and Oasis at either end,
  Launchpad's salt flat as the open east; dunes and mesas as the fill.
- **The Wilds** (Ruins, Canopy, Riverbend, Expedition): a jungle valley down Riverbend's river.
- **The North** (Frostline, Icebreaker, Observatory, Pagoda): the frozen bay and the mountain above it.
- Each later region reuses region-kit.js unchanged: list the districts and their offsets, write the fill, a palette
  module, the art. A district can be in at most one region.
- Later, a district that only exists inside a region (a region place good enough for 6v6) can be promoted: make it its
  own map file with spawns and objectives, then have the region place it like the others.
