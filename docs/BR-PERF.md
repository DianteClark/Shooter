# Battle royale feasibility: what a 400 x 400 m map costs today

Dev-only experiment, nothing shipped. Question: can the host phone run 32 players (up to 8 humans, the rest bots) on
a giant map with today's engine, and what does the BR section need to change first?

## Setup
- **Map**: `dev/br-map.mjs`, a procedural 400 x 400 m city: 12 x 12 blocks of 24 m between 8 m streets, each block
  built up (buildings, containers, crates, barriers), a park (low cover) or a pond. `density` scales what stands in
  a block. Density 1 = 1,396 walls. For scale, Harvest has 179 walls on 8,640 m^2 (0.021 per m^2); a 400 x 400 world
  stitched from today's regions at that density would carry about **3,300 walls**, so density 2 (2,248) is the
  realistic case, not density 1.
- **Sim**: `node dev/br-perf.mjs`: 32 regular bots, 16 v 16 under Ground War TDM rules, 30 s live per run, CPU time
  per 30 Hz tick (`process.cpuUsage`), snapshot size as sent (JSON of `encodeSnapshot()`), nav build and pathing cost,
  and micro-benchmarks of ray casts and collision against a prototype spatial grid. `--profile` gives self time per
  function over the live ticks.
- **Renderer**: `node dev/br-render.mjs` drives `dev/br-render.html`: the real `GameRenderer` in headless Chromium at
  852 x 393, quality pinned to Low (device pixel ratio capped at 1.3), the local player walking a circle through the
  middle. Three variants: the world as built today (one merged mesh, never culled), the same triangles split into
  32 m chunks with bounding spheres (three.js frustum culling), and chunks plus a 60 m distance cut.
- **Caveat**: the sandbox has 2 vCPUs shared with other jobs (load average 9 to 11 during these runs). CPU times
  wander by up to 3x between runs (the nav build measured 7.3 s once and 26 s another time); trust the ratios and
  the scaling, not the absolute milliseconds. SwiftShader is a CPU rasteriser, so its frame times only say "more or
  less than Harvest"; draw calls and triangles are exact.

## Numbers

### Host sim (32 bots, CPU ms per 30 Hz tick; budget is 33 ms, but the host also renders at 60 fps)
| map | walls | mean | p95 | worst | nav build (CPU) | snapshot |
|---|---|---|---|---|---|---|
| Harvest (Ground War today) | 179 | 1.4 to 1.7 | 4.8 | 12 | 0.3 to 0.8 s | 1.8 KB |
| giant, density 0.25 | 367 | 1.6 to 1.7 | 3.5 | 16 | 6.5 to 7 s | 1.75 KB |
| giant, density 0.5 | 721 | 2.5 to 3.0 | 3.9 | 16 | 13 s | 1.76 KB |
| giant, density 1, spread | 1,396 | 4.7 to 5.2 | 23 | 450 | 7 to 26 s | 1.74 KB |
| giant, density 1, dense (all 32 in the middle 120 m) | 1,396 | 4.8 to 5.2 | 20 to 43 | 650 | 25 s | 1.79 KB |
| giant, density 2 | 2,248 | 7.4 to 8.2 | 12 to 64 | 660 | 38 to 56 s | 1.76 KB |

- Tick cost is linear in walls: about **1.2 ms + 2.9 ms per 1,000 walls** here. At the realistic 3,300 walls that is
  about 10 ms per tick on this machine, and a phone is slower again: a host phone would spend most of every other
  frame simulating.
- Profile of the dense run, live ticks only: **`resolveCircle` 38%, `stepMovement` 19%** (its substeps call
  resolveCircle against every wall), GC 8%, then bots (`update`, `think`, `findPath`, `_goHold`, `drive`, `_pickGoal`)
  about 12% together. Line of sight (`raycastMap`, `rayRect`, `hasLineOfSight`, `_teamVisible`) is under 3% and
  `encodeSnapshot` under 1%. Collision against every wall is the bottleneck, not vision.
- **Spikes**: the worst ticks (450 to 660 ms) come with A* on the 160,000-cell grid (a cross-map path costs 6 to 37 ms,
  and several bots replan in one tick) plus GC.
- **Nav build**: `NavGrid` tests every cell against every wall twice (blocked cells, tactical points) and casts
  32 vision rays per tactical point against every wall: cells x walls. 7 to 26 s of CPU at density 1 before the first
  tick, on a host that is also the player's phone. Not shippable as is.
- **Micro-benchmarks** (density 1, best of five, the prototype `WallGrid` in br-perf.mjs, 8 m cells): a 10 to 60 m
  vision ray costs 9 to 22 us brute force and 0.3 to 0.4 us through the grid (**26 to 56x**, identical answers on
  4,000 rays); `resolveCircle` 10 to 100 us brute and 0.2 to 0.3 us with the grid (**56 to 350x**). On Harvest the
  grid already wins 10x for rays and 20x for collision.

### Snapshot (host to each guest, every other tick = 15 Hz)
- 32 players: **1.75 to 1.8 KB per snapshot**, 2.8 KB at worst, about the same as Ground War today (it already ships
  32 players). That is about 27 KB/s per guest and **190 KB/s of host upload for 7 guests**, before events. Workable on
  Wi-Fi, marginal on a phone hotspot or 4G uplink, and it grows with every entity (projectiles, turrets, loot, zone).
- Per player the snapshot carries position, aim, state flags, ammo, streak slots and score every time, wherever the
  player is.

### Renderer (852 x 393, Low, headless Chromium)
| world | walls | world triangles | geometry | build | draw calls | triangles drawn | frame (SwiftShader, quiet / loaded) |
|---|---|---|---|---|---|---|---|
| Harvest | 179 | 58k | 6.5 MB | 0.4 to 0.7 s | 25 | 71k | 139 / 220 to 490 ms |
| giant, merged (today) | 1,396 | 580k | 65 MB | 1.0 to 4 s | 20 | 589k | 328 / 470 to 810 ms |
| giant, 32 m chunks | 1,396 | 580k (414 chunks) | 65 MB | same | 80 | 132k | 153 / 233 to 334 ms |
| giant, chunks + 60 m cut | 1,396 | 580k | 65 MB | same | 32 | 39k | 118 / 192 to 297 ms |

- Today's merged world draws **all 589k triangles every frame**, 8x Harvest: the camera only ever sees about
  60 x 40 m of it. Chunking alone brings it to 132k triangles for 80 calls; a distance cut brings it to 39k
  triangles for 32 calls, **below Harvest on both**, and the frame time follows.
- The real problem is memory: **65 MB of vertex data** for a density-1 world (flat-shaded, 4 float attributes, 120 bytes
  per triangle), and the JS arrays that build it are bigger again while building. Scaled to 3,300 walls that is
  about 150 MB, which an iPhone Safari tab will not survive. Building it takes 1 to 4 s on a desktop.
- Vision fog is fine: `FogMask` already sweeps a 72 x 56 m window around the player on big maps, so its cost does not
  grow with the map.

## Bottlenecks, in order
1. **Collision against every wall** (`resolveCircle`, called per movement substep for every player, on the host and
   again on every phone for its own player at 60 fps). Over half the host tick.
2. **Nav build** (cells x walls) and **long A* paths** on a 160,000-cell grid: seconds before the match, and the
   tick spikes.
3. **World mesh size**: everything merged, never culled, 65 to 150 MB of vertices.
4. **Host upload**: every player in every snapshot to every guest.

## What the BR section needs (concrete changes)
1. **Spatial grid for walls** (geometry.js): build a bucket grid (8 m cells) once per map, cached on the map object;
   `raycastMap` walks the cells along the ray (Amanatides-Woo, stopping when a hit is nearer than the next cell
   boundary), `resolveCircle` and `hasLineOfSight` query only the cells they touch, and `equipment.js` sweeps use the
   same query. The prototype `WallGrid` in `dev/br-perf.mjs` returns identical ray hits. This also speeds up every
   existing map (10 to 20x on Harvest's rays and collision) and every phone's own movement. Keep the walls array as the
   source of truth; the grid is an index.
2. **Nav**: build `NavGrid` blocked cells and tactical points through the wall grid (cells x nearby walls), or
   precompute them offline per map and ship them (`assets/nav/<id>.bin`); rate holds with the grid-accelerated ray.
   Replace cross-map A* with a two-level search: a coarse graph (street crossings or 16 m sectors, built from the
   map) for the route, fine A* only within the next sector. Time-slice replanning: at most N path searches per tick.
3. **Chunked world rendering** (world.js): emit geometry per 32 m chunk (the drawers already work per wall, so a
   chunk is the walls whose centre lies in it plus its ground tiles), one mesh per chunk with a bounding sphere and
   frustum culling, plus a distance cut around the camera target (60 m is out of view at gameplay zoom). Build chunks
   lazily as the player approaches and drop far ones, so memory follows the view, not the map. Shrink the vertex
   format: positions as float, colour as normalised Uint8 (3 bytes), normal as a packed Int8 (or derived in the
   shader from flat-shading derivatives), part as Uint8: 120 to about 48 bytes per triangle. Merge chunk decals the
   same way. Regions' landmark buildings become chunk-sized prefabs reused across the world.
4. **Snapshot interest management** (sim.js / net): per guest, send full state only for that guest's squad and players
   within about 60 m (or in the guest's line of sight, which the host already computes for fog of war), position-only
   at 5 Hz for the rest of the alive count, nothing for the dead beyond the counter. At 32 players this halves to
   thirds the bytes; it also stops wallhacks reading the snapshot. Quantise positions to 2 bytes on a 400 m map
   (6 mm steps) once snapshots move to binary.
5. **Bots at range**: bots far from every human (beyond 100 m) think at a lower rate and skip perception and LOS
   until someone is near; they still move along their coarse routes and take part in the zone. Mostly free once 1
   and 2 land, but it keeps the 32-bot tick flat as density rises.
6. **Budget gate**: add the BR map to `dev/map-validate.mjs`'s bot match and a CI-style check in br-perf: mean host
   tick at 3,300 walls under 3 ms on this machine (Harvest level) and no tick over 33 ms.

## Recommendation
Do not build the BR map on today's engine: the sim would cost a phone host most of a frame every tick, the match would
take tens of seconds to start, and the world mesh would not fit in a phone's memory. Do changes 1 to 3 first (the
wall grid is the single biggest win and helps every existing map now), then 4 and 5 with the BR section. With the
grid and chunking, the measured costs fall to Harvest's: collision and rays 26 to 350x cheaper, and 39k triangles
in 32 draw calls on screen against Harvest's 71k in 25.

No engine code was changed for this experiment: the prototype grid and chunker live in `dev/br-perf.mjs` and
`dev/br-render.html` only.
