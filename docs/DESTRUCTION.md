# Destruction (ROADMAP item 64)

Owner: "The destruction was the main thing I was looking for." Pieces of every 6v6, Ground War and battle royale map
break: crates, stalls, furniture, tents and shop fronts (wood), windows (glass), barriers, sandbags, sheds, adobe and
short partition walls (light wall), longer free-standing walls (heavy wall). Explosives break them; heavy guns chip
wood and glass. Outer walls, borders, containers, rock, hulls, cranes, landmarks, tall buildings and anything that
screens a spawn never break, so a map cannot be flattened.

## Map data (append-only, carried by whoever moves map files)
A map file does not change. What breaks comes from two places, both resolved once per map at import (js/shared/map.js
calls `prepareBreakables(map)`):

1. **Kind rules** (`RULES` in js/shared/destruction.js): a wall's kind, size and flags give its material, e.g. every
   `crate` is wood, a window (`barrier` with `window: true`) is glass, a `building` of at most 26 m^2 and 4.6 m high is
   a light-wall shed. The rules only look at the wall itself, so a 180-degree map stays fair by construction.
2. **The side table** `BREAKABLES` in js/shared/breakables.js, one entry per map id:
   ```js
   railyard: {
     pick: [[x, z, 'wood' | 'glass' | 'light' | 'heavy' | null], ...],  // the wall containing (x, z): this material
                                                                        // (null: never breaks), over the rules
     mirror: true,         // also apply each pick at its 180-degree image (W - x, H - z): for `rotated` maps
     off: false,           // true: nothing on this map breaks
   }
   ```
   A pick names a point inside the wall it means (the wall's centre is the safest), not a wall index, so it survives
   walls being added or reordered. **districts / region maps**: when a map is assembled from others at an offset
   (dx, dz), carry `pick` over with the offset added, or give the new map its own entry; the kind rules come along
   with the walls for free. Never rely on piece ids across maps.

Protected whatever the rules say: `border`, `water`, `container`, `rock`, `hull`, `crane`, `boulder`, `landmark: true`,
enterable buildings' outer walls (`bwall` without `inner`), walls within 0.6 m of the map edge, anything within 5 m of
a spawn point, and (Search and Destroy only) anything within the bomb site's radius + 3 m.

## Resolved form (what code reads)
`map.breakables`: an array, one entry per breakable piece, in wall order; the index is the piece id the wire uses.
`{ id, wi (index in map.walls), wall (the wall object), mat ('glass'|'wood'|'light'|'heavy'), hp, x, z, w, d, h
(the intact rect), flags (the intact blocksMove/Bullet/Vision), pile: null | {x, z, w, d, h}, snd (true: near a bomb
site) }`.
A piece has three stages: 0 intact, 1 damaged (under 55% health: darker, cracked), 2 broken. Broken: the wall stops
blocking anything, or, for pieces with a `pile` (sheds, adobe, thick walls), shrinks to a waist-high rubble pile in
its middle (blocks movement, see and shoot over: low cover) with at least 1.5 m clear around it. A wall object is
never removed from `map.walls` (indices and the wall grid stay valid; the pile sits inside the old rect).
`applyStage(map, id, stage)` sets the wall; `resetBreakables(map)` puts every piece back (a new match on a shared map
object).

## Materials (js/shared/destruction.js `MATERIALS`, wire order fixed: append only)
| mat | hp | bullets | explosives |
|---|---|---|---|
| glass | 20 | any round breaks it | yes |
| wood | 260 | LMG, marksman, sniper and shotgun rounds chip it | yes |
| light | 420 | no | yes (a frag landing at it, a rocket, a satchel) |
| heavy | 1200 | no | launchers, satchels, streaks (frag-class at a third) |
Blast damage to a piece: the source's structural power (`POWER_*` in js/sim/destruction.js: frag 460, launcher 640,
satchel 900, airstrike 1000, missile 1200, mortar 600...) times 1 - 0.6 x (distance to the rect / reach), within reach = 0.8 x blast radius + 0.5 m,
and only when nothing that blocks vision stands between the blast and the piece.

## Sim (js/sim/destruction.js, host only)
`sim.brk = new Destruction(sim)`. Off in Graveyard Shift, the campaign, the range, training and Showdown. Hooks:
`Sim._emit` sees every `explosion` event and every `bang` of a blast kind and calls `brk.blast`; `applyShot` hands
wall rays to `brk.bullet`. A piece that breaks: wall flags change, `reblockNav` re-marks the nav cells round it (on big
maps `NavGrid.reopen` joins the opened cells to their sector's regions: a break only opens ground, so the graph stays
safe without a rebuild that would cost tens of ms on a giant map), bots whose path passes near it replan, and the event
`{t:'brk', i, s, x, z, m, dx, dz}` goes out (s = new stage, m = material index, dx dz = push direction).
Bots: a bot walking a long way round a breakable light wall or shed that stands between it and its goal may throw its
frag (or fire its launcher) at it (js/sim/bots.js `_thinkBreach`).

## Wire
`encodeBreak(stages)` / `decodeBreak(text, n)`: the pieces not intact, as a string of 6-bit characters (base64url
alphabet; each value is gap * 4 + stage in 5-bit groups, the high bit of a character meaning "more follows"). '' when
everything stands. Snapshot: after the player records come `finBlock or 0` and then the break string, sent every
snapshot for 1 s after a change, then every 15th tick, and every snapshot of a match's first ticks (late joiners have it
within half a second). `decodeSnapshot` applies it to the guest's map (`setBreakState`) and puts it on `view.brk`.
Host migration: `Sim.fromSnapshot` restores it (health back to the stage's threshold).

## Replays
`brk` is a clip extra (js/game/replay.js EXTRAS) and a replay-code extra (js/game/replay-code.js EXTRA_KEYS), and `brk`
events are kept in clips and SYR1 codes (appended to EV_FIELDS, so older codes still read). A replay seek sets the
state the keyframe had, so walls stand up again when you scrub back.

## Picture (js/render/destruct-fx.js)
No draw call per piece and none per break: each breakable piece is drawn into the normal world mesh, its vertex range
remembered (`DestructFx`), and a rubble set for it is pre-built beside it, collapsed. Breaking collapses the piece's
range to a point and opens the rubble's; damage darkens the piece's colours. Chunks fly from the shared VFX shard pool,
dust and splinters from the particle batch, a scorch decal on the ground. The renderer refreshes the wall lists its
fog and visibility tests use when the map's break version changes; the minimap redraws its wall layer.

## Tests
`node dev/sim-destruction.mjs [--quick]`: resolution counts per map, determinism, snapshot / late joiner / migration /
replay-code round trips, nav re-path through a new opening, bots breaching, perf. `python3 dev/ui-destruction-test.py
<port>`: a wall breaking on screen (before/after screenshots), the minimap, frame time and draw calls.
`node dev/map-validate.mjs` validates every map a second time with every piece broken (nav, objectives, gaps,
fairness, the giant checks); `--intact` skips that pass.

## Numbers (2026-11-22, the shared 2-vCPU box, so CPU times are noisy)
- Pieces: 1,616 over 28 maps (6v6 6 to 42, Ground War 50 to 127, Frontier 424, Jadefall 274); Graveyard Shift's own
  maps and the range have none.
- Draw calls: unchanged (dev/perf-render.mjs on Low, before / after: Railyard 25 / 25, Riverbend 24 / 24, Downtown
  36 / 35). Triangles submitted: +2% to +10% (the collapsed rubble sets: Riverbend world 48k -> 52k), and breaking
  changes neither (ranges are rewritten in place, dev/ui-destruction-test.py checks both).
- Host sim: a blast on Frontier's 424 pieces costs 1 to 16 us (the line-of-sight tests to the pieces in reach); the nav
  patch after a wall goes down on Frontier 0.3 ms (a full sector rebuild there is 30 to 160 ms, so it is never done);
  a Ground War tick with destruction on and off is the same within noise (0.3 to 0.5 ms here).
- Wire: about one character per broken piece (`encodeBreak`), so ten broken pieces add ten bytes to a snapshot of about
  880, and only while it is being sent (1 s after a change, then twice a second).
- Bots: Ground War with frags, 150 s each on Downtown, Expedition and Harvest: 16 breach throws and 97 pieces broken by
  bots in all (637 kills), nobody stuck.
