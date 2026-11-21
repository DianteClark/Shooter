# Maps overhaul (V9): one world, five size tiers

Owner direction: "awesome variety in all areas". Every map belongs to a region of one connected world; later the giant
battle royale map (32 players: up to 8 humans, the rest bots, squads of 4) stitches the regions together and reuses
their landmark buildings, so build landmarks as reusable pieces.

## Map fields (new, required on every map)
- `size`: `'small' | 'medium' | 'large' | 'huge'` (giant comes with battle royale).
- `region`: `'metro' | 'desert' | 'jungle' | 'arctic' | 'coast' | 'industrial' | 'farmland' | 'mountain'` (labels and tag colours:
  `REGIONS` in js/shared/map.js and `.sm-region` in css/menus.css).
- Footprints (metres, W x H): small 46-58 x 30-38; medium 64-84 x 42-52 (today's maps); large 92-112 x 56-70 (6v6,
  long lanes, vehicles-free); huge 120-150 x 72-92 (16v16 only: `modes: ['gwtdm', 'gwdom'], large: true`, like Harvest).
- small, medium and large maps host every standard mode: tdm, kc, dom, hard, snd, ctf, ffa, gun. That means
  `points.dom` (3 flags), `points.hard` (hardpoint rotation), `points.snd` (bombSites), `points.ctf` (flagBases), and
  enough spawns for FFA (12 players on large). Huge maps need GW Domination's five flags (see harvest.js).

## Rules for every map
- Fair: rotationally symmetric (the `rotated` helper in maps/build.js) unless the asymmetry is deliberate and tested.
- Three lanes (or a clear equivalent), each with a reason to take it; a landmark at the centre; spawn cover; no
  sight line longer than the size tier wants (small: close quarters, mostly under 25 m; large: some 50 m+ lanes).
- Bots must play it: nav grid covers every lane; every spawn and objective is reachable; no props that trap a player
  (resolveCircle) or hide a mine; no gaps narrower than a player (2 x PLAYER_RADIUS + margin) that look passable.
- Phones: low-poly, instanced or merged meshes, within the quality profiles in js/render/quality.js. Large and huge
  maps must hold the frame rate Harvest holds on the Low profile.
- Map art: each map ships `assets/maps/<id>.jpg` made by `dev/render-snapshots.mjs` like the others.

## Code layout for parallel work
- New maps: `js/shared/maps/<id>.js`, registered in `js/shared/map.js` (one import line + one key each).
- New theme visuals go in their own module `js/render/themes/<theme>.js` exporting `{ dress, stage, thumb }`; world.js
  only gets an import and one entry per table (DRESS, THEME_STAGES, THUMB_STYLE). Do not grow world.js.
  A theme module registers its palette with `THEMES.<id> = {...}` (import THEMES from ../art.js) and cannot import
  world.js back: drawers get `ctx.kit` (box3, emissive, scale, skyRing, WATER_Y and the shared building, container,
  crate, barrier, concreteWall, border drawers) and read colours from `ctx.theme.ink`. `stage.ground(ctx)` (optional)
  returns the per-vertex ground shader like the built-in ones. See themes/coast.js (Pier, plus shared `sea`, `palm`,
  `lighthouse`) and themes/industrial.js (Foundry, plus the shared `skyline`). Also add the theme to SETS in props.js,
  LIFE in ambient.js, ART in dev/render-maps.html and a `map:<id>` icon in js/ui/icons.js.
- Each builder validates its maps with its own `dev/map-check-<region>.mjs` (or the shared `dev/map-validate.mjs`
  once merged).

## Size tiers in the game
- Everything reads `map.size` through `sizeOf` (js/shared/map.js); a map without it counts as medium. `SIZES` holds
  each tier's picker label and its weight in a Random or Quick play roll (small .3, medium .45, large .25, huge 0: a
  tier's share is split between its maps, and huge maps only come up when the mode asked for is a Ground War mode).
- Free-for-all and Gun Game seats follow the tier: small 6, medium 8, large and huge 12 (`smallPlayers`, `players`,
  `largePlayers` in js/shared/modes.js, read by `playersFor`).
- The solo picker shows one section per tier (Small, Medium, Large, Huge 16 v 16) in a scrolling column, Random
  beside it; each card carries its region tag. A friend lobby's vote offers three different maps from three different
  tiers when it can, Ground War rarely (as before).

## Validator
`node dev/map-validate.mjs [ids] [--quick] [--ascii] [--all] [--seconds=N] [--modes=a,b]` checks every registered map:
fields and footprint against the tier, nav reachability of spawns, objectives, lanes and waypoints, unreachable
pockets, gaps narrower than a player (2 x PLAYER_RADIUS + 0.1 m) between blocking pieces, spawn-to-objective
fairness (mean walk per team within 10%), the longest sight lines, and a bot-only match per hosted mode (kills,
objective events, bots stuck pushing into a wall). It exits non-zero on a failure; read the warnings too.

## New 6v6 maps (ROADMAP 56)
Three maps, each its own theme module, palette and time of day, appended to `MAPS` after `brtest` (ids and order of
the earlier maps never change; their calling cards are appended to `MAP_ART` in js/ui/cardbook.js the same way).
- **Launchpad** (`launchpad`, large 104 x 64, desert; js/shared/maps/launchpad.js, js/render/themes/launchpad.js):
  a rocket and its orange service tower on a raised apron dead centre of a white salt flat at high noon. North-west
  tank farm (spherical tanks, pipe rack, horizontal tank, pump shed), south-west tracking station (radar dish, uplink
  hut, generator), a launch-control blockhouse in each spawn; the east half is the image. Five lanes: the two edge
  roads (the 50 m+ lanes), the crawlerway either side of the middle (crawler parked on it), the pad road. Short blue
  shadows, cracked salt crust, heat haze and blown salt. Four hardpoints (no centre one: the apron fills too much of a
  centre zone).
- **Observatory** (`observatory`, medium 76 x 46, mountain): a summit observatory at sunrise, alpenglow pink snow and
  lilac shadows. The telescope dome in its walled courtyard splits the middle lane; ridge path north (tor, instrument
  hut, radio mast, solar row), pine slope south (weather screen, tor, drifts); each team's cable-car top station at
  its corner, the lodge and the snow groomer screening its spawn. A sea of cloud and neighbouring peaks round it.
- **Pagoda** (`pagoda`, medium 72 x 44, mountain): a hillside temple at blue hour in autumn. A five-storey pagoda
  between two koi ponds (each crossed by a plank bridge), worship hall and bell tower at each end, vermilion gates
  on the north path, the raked gravel garden and the tea house on the south one; stone lanterns light the paths.
- `mountain` is a new region (label Mountain, tag colour in css/menus.css): Observatory on the summit, Pagoda on the
  slope below it, for the battle royale world to stitch later.
- Wiring per map, as for the others: map.js import + key; world.js import + DRESS/THEME_STAGES/THUMB_STYLE entries;
  SETS (props.js), LIFE (ambient.js), THEME_AUDIO (audio.js), ART (dev/render-maps.html), `map:<id>` icon
  (icons-maps.js + the alias list in icons.js), calling-card pattern (cardart.js: `liftoff`, `stardome`, `tiers`),
  vote art assets/maps/<id>.jpg. `ball` (sphere/dome bands) and `lattice` (square lattice tower) were added to
  themes/kit.js for them. dev/sim-modes-v10.mjs plays HQ on Launchpad, Kill Order on Pagoda, Control on Observatory.

## Jadefall's region (docs/BR.md "Jadefall")
The second battle royale island and two Ground War maps cut from its coast (Tidebreak, Coral Quarter). Those two set
`giantWorld: true` and `theme: 'jadefall'`: js/render/world.js hands them to the giant-world streamer
(js/render/themes/frontier.js) with the island's palette, so they share the island's buildings (enterable, roofs that
dissolve round you), beaches, shallows (walkable, slow: `map.shallows`) and landmarks. Build such a map with
js/shared/maps/isle-kit.js: a symmetric land/water lattice (`lattice`, `water`) and `twins` for each piece and its image.

## World art pass on the older maps (ROADMAP 53)
Every 6v6 and Ground War map made before 2026-11-20 gets a per-map **mood** in `js/render/themes/moods/` (urban.js:
Railyard, Harbor, Neon, Overpass, Downtown, Turnstile, Topside, Foundry, Pier; wild.js: Dust, Oasis, Canyon, Ruins,
Canopy, Riverbend, Expedition, Sunken, Frostline, Icebreaker, Harvest, Millbrook). Art only: no map file changed, so
collision, cover, spawns, objectives and nav are untouched and `dev/map-validate.mjs` prints the same results.
- `MOODS.<mapId> = { theme, life, lights, ground, paint, decor, thumb }`, registered into `MOODS` (js/render/art.js)
  the way theme modules register `THEMES`. `themeFor(map)` merges `theme` (light, fog, clear, shadow, lamp, water,
  weather, `sky` for the horizon ring, `ink` as hex) over the base theme and keeps the base id, so every table keyed by
  theme id still works. Maps that share a theme now differ: desert (Dust pink-gold evening, Oasis misty dawn, Canyon
  red-rock sunset), jungle (Ruins sunrise mist, Canopy after rain, Riverbend gold afternoon, Expedition monsoon with
  lightning), metro (Neon ultraviolet night, Overpass sodium smog dusk, Downtown teal rainy blue hour), arctic
  (Frostline aurora night, Icebreaker polar noon).
- buildWorld runs `lights` after the theme's lights (so lamps bake), `ground(ctx, p, colour)` over the theme's ground
  shader (free: plazas, the Dust star, the Turnstile roundel, oil stains), `paint` and `decor` after the theme's. New
  solids only sit on blocking pieces, outside the border or flat on the ground (helpers in moods/lib.js: beacon,
  festoon, bunting, waterTower, mast, stack, disc, scatter).
- `life` overrides the theme's LIFE entry in ambient.js; `life.emit` (array or `map => [...]`) places fixed emitters
  (smoke, steam, ember, spray, mist, drip, spark) that ride the VFX particle batch: no draw call, skipped off screen,
  thinned on Low Power.
- Landmarks: Railyard water tower, Overpass clock tower and brick plaza, Downtown fountain statue and jet, Dust
  well-head and tiled star, Canyon dam mast and floodlight, Ruins altar braziers, Canopy lookout lantern and flag,
  Riverbend idol's lamp ring, Expedition's burning wreck and tower lights, Frostline depot chimney and clock,
  Icebreaker funnels, Neon's roof roundel and lantern strings, Topside's crane mast, Harvest and Millbrook chimneys.
- Budget: each map stays at or under its draw calls and triangles before the pass +15% (measured with
  `dev/perf-render.mjs --root=<before checkout>`; table in the ROADMAP 53 report).
