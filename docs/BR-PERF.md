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

## After: the engine performance pass (2026-11-11, branch perf)

Changes 1 to 5 above are in. Everything below was measured on the same 2-vCPU sandbox (busy, so CPU times wander);
`dev/perf-sim.mjs`, `dev/perf-render.mjs` and `dev/perf-geometry.mjs` reproduce it, and run against an older checkout
(`--root=` / `--ref=`) for the before side. "Before" for the giant map and the renderer is the parent commit (338a22c);
for the existing maps' sim it is also the dev tip the branch merged (same game code, without this pass).

**Nothing about play changed on today's maps.** The wall grid returns bit-identical answers to the old loops (276,000
rays, 92,000 sight lines, 276,000 collisions over all 21 maps and the giant map, plus walls added and removed
mid-match as Bulwarks do; every map's NavGrid has the same blocked cells, cover points and holds). Fingerprints of
every player's position, aim and hp on every tick and of every event match the old code over 60 s matches on
Harvest, Downtown and Expedition, and `dev/map-validate.mjs` (148 bot matches on 20 maps) prints the same kills,
objective events, scores and stuck counts. The changes that do alter bots (two-level paths, the think budget) and the
per-guest snapshots switch on only past 40,000 cells / m^2, which no map in the rotation comes near.

### Host sim (32 bots, 16 v 16 Ground War TDM, 60 s live, CPU ms per tick)
| map | walls | start (nav + bots) | mean | p99 | worst | before: start / mean / p99 / worst |
|---|---|---|---|---|---|---|
| Harvest | 179 | 62 ms | 0.73 | 6.9 | 21 | 389 ms / 2.43 / 10.6 / 36 |
| Downtown | 137 | 37 ms | 0.51 | 5.3 | 23 | 361 ms / 1.73 / 8.6 / 16 |
| Expedition | 156 | 52 ms | 0.37 | 3.3 | 19 | 476 ms / 1.75 / 7.7 / 17 |
| giant, density 1, spread | 1,396 | 245 ms | 0.32 | 4.8 | 28 | 36 s / 7.50 / 16.0 / 42 |
| giant, density 2 | 2,248 | 300 ms | 0.25 | 3.1 | 13 | 54 s / 11.46 / 19.8 / 31 |
| giant, density 1, dense | 1,396 | 165 ms | 0.25 | 2.4 | 14 | 36 s / 7.28 / 13.1 / 33 |

- Mean tick 3 to 5x cheaper on today's maps, 23 to 46x on the giant map, which now costs less than Harvest did. The
  budget gate in change 6 (under 3 ms mean at 3,300 walls, no tick over 33 ms) holds for density 2.
- p99 and worst are CPU time of the whole process, so they include garbage collection and the JIT's compiler
  threads (the first live seconds); the worst ticks left are mostly those, not game work. The old wall-clock p95/worst
  in the table above also counted the neighbours' load.
- Nav build: Harvest 1.2 s to 0.1 s, Downtown 0.7 s to 0.04 s, giant 44 to 55 s to 0.2 to 0.3 s (per-wall blocked
  cells and tactical points, grid-backed hold rating). Big-map paths: about 1 ms each after warm-up, worst under 3 ms.
- `dev/map-validate.mjs` mean bot-match tick over all 148 matches: 0.49 to 0.34 ms.

### Renderer (852 x 393, headless Chromium, SwiftShader; calls and triangles exact, frame ms median of 30)
| map | q | calls | triangles drawn | world geometry | frame ms | before: calls / triangles / geometry / frame |
|---|---|---|---|---|---|---|
| Firing range | low | 21 | 26.6k | 1.2 MB | 89 | 21 / 26.6k / 2.0 MB / 103 |
| Firing range | high | 27 | 29.2k | 1.2 MB | 176 | 27 / 29.2k / 2.0 MB / 180 |
| Railyard | low | 25 | 47.9k | 2.2 MB | 149 | 25 / 47.9k / 3.7 MB / 150 |
| Railyard | high | 31 | 51.4k | 2.2 MB | 279 | 31 / 51.4k / 3.7 MB / 280 |
| Pier | low | 28 | 42.6k | 1.8 MB | 138 | 28 / 42.6k / 3.0 MB / 142 |
| Pier | high | 34 | 46.2k | 1.8 MB | 262 | 34 / 46.2k / 3.0 MB / 266 |
| Foundry | low | 22 | 48.1k | 2.6 MB | same draw | 22 / 48.1k / 4.3 MB / 112 |
| Foundry | high | 28 | 52.0k | 2.6 MB | same draw | 28 / 52.0k / 4.3 MB / 243 |
| Harvest | low | 32 | 39.0k | 3.9 MB | 107 | 23 / 68.1k / 6.5 MB / 223 |
| Harvest | high | 37 | 44.1k | 3.9 MB | 236 | 28 / 73.1k / 6.5 MB / 244 |
| Downtown | low | 36 | 31.7k | 4.1 MB | 119 | 26 / 67.4k / 6.4 MB / 132 |
| Downtown | high | 42 | 36.1k | 4.1 MB | 233 | 32 / 71.9k / 6.4 MB / 239 |
| Expedition | low | 29 | 26.6k | 3.9 MB | 111 | 23 / 67.1k / 6.4 MB / 116 |
| Expedition | high | 35 | 30.4k | 3.9 MB | 233 | 30 / 70.9k / 6.4 MB / 232 |
| giant, density 1 | low | 25 | 29.0k | 39.4 MB | 124 | 20 / 589.5k / 65.1 MB / 340 |
| giant, density 1 | high | 32 | 31.8k | 39.4 MB | 429 | 26 / 592.4k / 65.1 MB / 470 |

- The world mesh is packed (position Float32, colour normalised Uint16, normal and wet amount normalised Int8):
  24 bytes a vertex instead of 40, so 37 to 40% less vertex memory on every map, no visible difference.
- Huge maps and anything bigger are cut into 32 m tiles per layer (world, shadow decals, signs, glow), culled by their
  bounding boxes against the frustum (three's bounding spheres were far too loose for flat tiles: 80 calls on the giant
  map in the study, 25 to 32 now) and, on Low and Potato, by a 60 m distance cut. Triangles drawn fall by half on the
  Ground War maps for 6 to 10 more calls, and by 95% on the giant map. Small, medium and large maps stay one mesh per
  layer: chunking Foundry measured 22 to 36 calls for 26% fewer triangles and no faster frame, Railyard 25 to 34 calls
  for 20% fewer, so those keep exactly their old draw.
- Instanced props are at most 40 per map, so per-tile culling would buy nothing; lamps are baked into the vertex
  colours and their glow is a tiled layer, so lights go with their tiles. The fog mask, minimap and spawn pads were
  checked in screenshots of real matches on Harvest, Downtown and Foundry (all 21 maps load with no console errors).
- Still to do for the battle royale: the giant map's mesh is still built whole (39 MB at density 1, more at the
  realistic 3,300 walls) and takes 1 to 2 s; building tiles lazily as the camera approaches, as change 3 suggested,
  is the next step and fits the tile code as it is.

### Snapshots (per guest, with interest management forced on; 7 of the 32 count as guests)
| map | broadcast snapshot | per-guest snapshot | a guest's downlink (snapshots + events) |
|---|---|---|---|
| giant, spread | 1,469 B | 786 B | 22.5 to 12.4 KB/s |
| giant, density 2 | 1,528 B | 877 B | 23.5 to 13.9 KB/s |
| giant, dense | 1,658 B | 1,123 B | 25.6 to 17.7 KB/s |
| Harvest (left off in play) | 1,893 B | 1,792 B | 30.7 to 29.2 KB/s |
| Downtown (left off in play) | 1,837 B | 1,689 B | 29.3 to 27.1 KB/s |

- On maps over 40,000 m^2 the host sends each guest its own snapshot: anyone more than 60 m away from the guest
  (unless firing, marked, or an enemy under the guest's UAV) gets a position-only record every third snapshot (5 Hz)
  and nothing in between; slow blocks still go out as before. Shots fired more than 150 m away by the other side are
  not sent to that guest. Decoded on a guest's own Sim, players within 40 m match the host to the wire's rounding
  (0.014 m) and far ones lag by at most about 3 m. Host upload for 7 guests on the giant map: about 160 to 90 KB/s.
- Today's maps leave it off: it saves only 5 to 8% there (a guest sees most of a Ground War map), and the broadcast
  snapshot is one encode for everyone.

## Tick spikes: the host's single slow ticks (2026-11-22, branch botperf)

Mean host ticks were fine (0.1 to 0.6 ms) but single ticks of 10 to 40 ms turned up on every map: a visible hitch for
every player when a phone hosts. Target: worst tick under about 8 ms and p99.9 under about 4 ms (wall clock, main thread)
in 32-player BR on Frontier, Jadefall and Meridian, Ground War 16 v 16 on Harvest and Tidebreak, Conquest and
Breakthrough on Meridian, Graveyard Shift rounds 20 and 30, and 6 v 6 TDM.

### The profiler: `dev/sim-tickspikes.mjs`
- Plays each scenario (bot-only, mixed skill, seed 5: BR to the end, the others 4 minutes, Graveyard Shift 1 minute at
  round 20 / 30 with the horde kept full) and times every host tick after the load step, countdown included.
- `--repeat=N` plays it N times, each in a fresh process (so every run pays the cold start), checks with a position
  fingerprint that it was the same match each time, and reports the **per-tick minimum** over the runs. This sandbox
  has 2 cores shared by four builders (load 2 to 12 while this was measured): one run's worst tick is mostly someone
  else's process, and taking the same tick's best of five leaves what the game costs. One-run medians are printed too.
- A sampling CPU profile (node:inspector, 100 us, on the same clock as the ticks) is cut at the tick boundaries: each
  slow tick lists its phase (the call under `Sim._tick`, and for bots the method under think or drive), the functions
  with the most self time, GC from the `gc` performance entries, and `(descheduled)` for gaps where the thread was not
  running. `--alloc` lists allocation sites (bytes a second, collected objects included). `node --expose-gc` runs a full
  collection between ticks every `--gc-every` ticks so the spikes left are the game's own. `--cold` switches the
  load-time warm-up off; the fingerprint must not change (it does not, on every scenario).

### What the spikes were
- **The first live tick and a battle royale landing (6 to 25 ms)**: every bot's think, drive, path search and the gun
  and movement code running for the first time at once, in the engine's slowest tier; on Meridian a 1,000-cell path
  search took 9 ms cold against 0.2 ms warm.
- **Path searches**: a capped big-map search costs 0.8 to 1.3 ms, and two could run in one tick (BR has no rules budget).
- **Garbage**: 5.6 MB/s of allocation on Ground War, a quarter of it `Math.hypot` (in V8 a library call that returns a
  boxed number; about 20x the cost of `Math.sqrt(x*x + z*z)`), then collision and the bots' own temporaries.
- Single expensive decisions (`_bestThrow`'s throw simulations, cover searches, a close gun's corner search: twelve
  rays per cover point), and every BR squad's plan on the same tick: rarely a spike on their own, but they pile up in
  the ticks where many bots meet a fight at once.

### What changed
- **Warm-up at load** (`Sim.warm`, set by the host in js/game/match.js and for a new host in `promoteToHost`): the step
  that builds the nav grid starts a throwaway bot match of the same mode (BR: Conquest on the same map, everyone on the
  ground from the start) on a copy of the map, with a nav grid that shares the static parts and the search scratch
  (`new NavGrid(map, from)`; one search-id counter) and owns its blocked cells, danger and regions. 200 ms of it at load,
  then 1.5 ms a tick through the countdown (nobody moves then), 600 ticks at most; a new host mid-match plays 450 ms at
  load. The copies are made so they keep the real objects' hidden classes (the map by spread, the grid through its
  constructor): with `Object.create` copies the engine's optimised code was thrown away the moment it met the real map.
  Nothing of it reaches the match: its own walls, breakables, random stream; the fingerprints match with and without.
- **Path budget on every map** (`sim.pathWork`, 3,000 cells a tick next to the old 2 searches a tick): a search always
  runs to its end; once the tick has paid for 3,000 cells the next bot waits a tick for its route. One capped search a
  tick on a giant map, two on the others most ticks.
- **Decision budget** (`sim.thinkWork`, 24 units a tick; bots.js `_spend`): throw simulations (one unit a line tried)
  and cover searches share it. When it is spent the decision is not skipped: the bot thinks again on the next tick
  (fallbacks that would have made a different choice wait too). It never bound in the first minutes of any scenario
  (fingerprints unchanged).
- **BR squad plans staggered**: each squad still plans every 15 ticks, squad k on ticks k mod 15.
- **Cached exposure** of cover points (`coverExposure`, keyed on the map object, its break version and wall count, so it is
  the same answer as before).
- **`hyp(x, z)`** (js/shared/geometry.js) for the sim's two-argument distances: allocation 5.6 to 3.8 MB/s on Ground War.
  It can differ from `Math.hypot` in the last bit, so matches run slightly differently from before (deterministically).
- Counted in cells and decisions, never milliseconds: every phone and replay agrees. Wall time only decides how much of
  the throwaway warm-up match is played.

### Numbers (per-tick minimum over 5 fresh-process runs each, before and after alternated; load average about 2)
| scenario | worst ms | p99.9 | p99 | mean | first live tick | ticks >= 4 ms | bots: kills / objective events / stuck s a bot-min |
|---|---|---|---|---|---|---|---|
| BR Frontier (12 min) | 8.1 -> **2.3** | 1.37 -> 1.80 | 0.61 -> 0.56 | 0.09 -> 0.10 | 1.8 -> 0.8 | 3 -> 0 | 37/65/0.01 -> 36/63/0.03 |
| BR Jadefall | 9.3 -> **2.1** | 1.28 -> 1.68 | 0.61 -> 0.54 | 0.07 -> 0.10 | 1.6 -> 0.9 | 1 -> 0 | 35/61/0.05 -> 33/64/0.02 |
| BR Meridian | 10.4 -> **2.1** | 1.23 -> 1.55 | 0.59 -> 0.66 | 0.07 -> 0.09 | 1.8 -> 0.8 | 2 -> 0 | 35/54/0.01 -> 36/58/0.08 |
| Ground War Harvest | 7.8 -> **2.1** | 1.97 -> 1.87 | 0.92 -> 1.56 | 0.37 -> 0.35 | 7.8 -> 1.7 | 1 -> 0 | 351/0/0.09 -> 345/0/0.13 |
| Ground War Tidebreak | 9.8 -> **2.4** | 1.42 -> 1.79 | 0.79 -> 1.52 | 0.32 -> 0.32 | 9.8 -> 1.4 | 1 -> 0 | 315/0/0.01 -> 299/0/0.09 |
| Conquest Meridian | 6.6 -> **2.5** | 1.75 -> 1.65 | 1.23 -> 1.25 | 0.49 -> 0.45 | 6.6 -> 2.0 | 1 -> 0 | 413/18/0.03 -> 379/32/0.02 |
| Breakthrough Meridian | 11.2 -> **3.0** | 1.99 -> 1.91 | 1.47 -> 1.61 | 0.53 -> 0.52 | 11.2 -> 2.5 | 1 -> 0 | 531/3/0.06 -> 493/5/0.14 |
| Graveyard Shift r20 | 3.1 -> **1.2** | 2.75 -> 1.13 | 0.93 -> 0.83 | 0.23 -> 0.24 | 3.1 -> 1.2 | 0 -> 0 | (crew kills) 11 -> 13 |
| Graveyard Shift r30 | 2.9 -> **1.2** | 2.40 -> 1.09 | 0.87 -> 0.88 | 0.24 -> 0.23 | 2.9 -> 1.2 | 0 -> 0 | 8 -> 28 |
| TDM 6 v 6 Harbor | 5.4 -> **0.9** | 0.86 -> 0.48 | 0.38 -> 0.30 | 0.10 -> 0.08 | 5.4 -> 0.4 | 1 -> 0 | 129/0/0.11 -> 116/0/0.03 |

- One run on its own (median of the five) on this busy machine: BR Meridian worst 15.2 -> 9.1 ms, p99.9 4.7 -> 4.6;
  Harvest 9.7 -> 9.2, 5.3 -> 6.1; Breakthrough Meridian 13.4 -> 10.9, 6.6 -> 6.3. What is left there is the neighbours:
  the profile of those ticks is `(descheduled)`, at different ticks in every run.
- The cost: the countdown ticks carry the warm-up slice (about 1.5 to 2 ms instead of 0.3), which is why p99 rose on the
  Ground War maps (90 of 7,200 ticks) and p99.9 a little in BR (210 countdown ticks). No gameplay happens in them.
  Load: about 200 ms more at the step that builds the nav grid.
- Bots over more matches (sim-conquest / sim-breakthrough, Harvest, Tidebreak, Frontier, three seeds each, before ->
  after): Conquest 132 -> 132 kills a minute, 19.8 -> 19.2 captures, 2.68 -> 2.62 flags covered, stuck 0.060 -> 0.067,
  side 0 won 4 -> 4 of 9; Breakthrough 166 -> 161 kills a minute, attackers won 4 -> 5 of 9, stuck 0.078 -> 0.064.
  The single-seed rows above move as any change to a match's trajectory moves them.
- `node --expose-gc dev/sim-tickspikes.mjs` (a full collection between ticks every 10 s): what is left in the slowest
  ticks is a countdown warm-up slice or a busy tick of ordinary work (equipment bursts, a path search), each under 3 ms
  of running time. Not done, and the next step if a phone shows more: the per-player event objects (`shot` rays) and
  boxed doubles in collision are most of the remaining 3.8 MB/s.
