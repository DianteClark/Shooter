# Maps overhaul (V9): one world, five size tiers

Owner direction: "awesome variety in all areas". Every map belongs to a region of one connected world; later the giant
battle royale map (32 players: up to 8 humans, the rest bots, squads of 4) stitches the regions together and reuses
their landmark buildings, so build landmarks as reusable pieces.

## Map fields (new, required on every map)
- `size`: `'small' | 'medium' | 'large' | 'huge'` (giant comes with battle royale).
- `region`: `'metro' | 'desert' | 'jungle' | 'arctic' | 'coast' | 'industrial' | 'farmland'` (labels and tag colours:
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
