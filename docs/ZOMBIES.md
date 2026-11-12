# Graveyard Shift (ROADMAP item 26)

Our own co-op wave survival: up to four players (friends from the lobby, bot teammates in every empty seat) hold off a
horde round after round on Night Market (`neon`), Ruins (`ruins`), Foundry (`foundry`) and Ashgrove Halt (`ashgrove`, built
for the mode: see "Ashgrove Halt" below). Everyone starts with a
pistol and the blade; points from hits and kills buy guns off the walls, the mystery crate, gates into the rest of the
map and four perk machines. The match ends when nobody is left up. All names are our own.

| id | name | players | maps |
|---|---|---|---|
| `zm` | Graveyard Shift | 1-4 humans, bots fill to 4, plus 24 horde seats | neon, ruins, foundry, ashgrove |

Rule set `zm` (`js/sim/zombies.js`, registered in `js/sim/rules.js`), numbers, formulas and layouts in
`js/shared/zombies.js` (`ZM`), mode entry `MODES.zm` (`js/shared/modes.js`, `maps` lists where it plays).

## Files
- `js/shared/zombies.js`: numbers (`ZM`), kinds, perks, power-ups, wall guns, crate guns, round formulas, and each map's
  layout (`zmLayout`): fences, gates, bands, wall-buys, crate spots, perk machines, risers and starts, built from the
  map's walls alone so every phone gets the same one (the banded form), or declared on the map itself (`map.zm`, the
  graph form, Ashgrove Halt). `placeZmWalls / syncZmDoors / clearZmWalls / reblockNav` put the
  fences and closed gates on the map as walls and keep the nav grid in step; `zmUsable` says what a player standing at
  a spot can use (shared by the host's command check, the HUD's button and the bots).
- `js/sim/zombies.js`: the host rules (`ZmRules`): rounds, spawning, horde driving, damage, downs and revives, buying,
  the crate, power-ups, bot teammates' shopping and revives, the snapshot block, host migration.
- `js/sim/zm-phone.js`: the phone that owns a human's gun applies the host's `zarm`, `zammo` and `zperk` events.
- `js/sim/sim.js`: `buildZmRoster` (four player seats, then `ZM.seats` horde seats on team `ZM_TEAM`), the pool roster
  keeps the horde seats; per-guest records skip the horde (`rules.seatCode`).
- `js/render/zm-fx.js`: fences, gates (an opened one drops away), wall-buy chalk outlines, perk machines, the crate and
  its beam and floating gun, power-ups. About eight draw calls whatever the round.
- `js/render/zm-power.js`: a layout with a power switch: the breaker panel and its lever, a beacon over it while the
  power is off, and the perk machines dark (dimmed, crowns out) until it is on. Four small draw calls.

- `js/render/zm-fx.js`: fences, gates (an opened one drops away), wall-buys (a chalk frame and the gun in gold with a
  pulsing glow, and an x-ray copy drawn only where walls or roofs hide it, so a buy reads through walls), perk machines,
  the crate (a plank crate with iron corners and a lid hinged at the back, its outline through walls too: rolling, the
  lid opens and guns cycle up out of it, slowing as it settles; the offer floats and turns; the lid shuts once it is
  taken; a move lifts it up the beam and drops it in at its new spot), power-ups. About eleven draw calls whatever the
  round; the x-ray passes are one merged mesh for every wall-buy and one box for the crate.
- `js/render/zm-looks.js` + `js/render/characters.js`: the undead (shambler, runner, brute, boss) in the operators'
  parts kit, greyed and torn, as four extra operator uniform slots after `MAX_OPERATORS`. They ride the same instanced
  character meshes as soldiers (no extra draw calls); a horde seat's look comes from the view (`zk`).
- `js/ui/zm-hud.js`: round plate (round, undead left or the break countdown, points, Double Pay, boss health), crew list
  (points, perk chips, downed), the use button bottom-centre between the sticks (OPEN GATE, BUY <gun>, AMMO, MYSTERY
  CRATE, TAKE, perk name; greyed with "need N more" when short), downed/reviving bars, the back-next-round panel, point
  pops and round banners. Replaces the scorebar, streaks and death screen while on.
- `js/ui/matchmaking.js`: the Zombies tab (Co-op, 1-4): Solo with bots, or With friends (hosts a room set to the mode;
  friends take bot seats, `roomCap` caps it at four). `js/ui/results.js`: Overrun screen with the crew table and the
  map record. `js/game/awards.js`: XP lines and the record.

## Rules
- **Start**: 6 s warmup. Everyone (humans and bots) spawns together on open ground in the start band with the pistol,
  the blade, a frag and a stim; class loadouts, attachments, perks and streaks stay home. 500 points each.
- **Rounds**: count `roundCount(r)` (6, 9, 12, 16, 20, then 0.15r^2 + 2.3r + 8, at most 220; boss rounds 60%); shambler
  health `roundHp(r)` (120 + 70 a round to round 9, then +6% a round); runners from round 3 (75% of the horde at most),
  brutes from round 5 (up to 12%, never more than three alive); every 10th round starts with the boss (the Yardmaster,
  22x health, +10% per player). Spawns come every `spawnGap(r)` (2.1 s falling to 0.45 s). 10 s between rounds.
- **The cap**: at most `ZM.seats` = 24 zombies alive. The rest of the round's count waits for a seat.
- **Horde AI**: a Dijkstra flow field per player who is up over the nav grid (rebuilt when they change cell, at most every
  12 ticks, staggered by seat); each zombie walks downhill on the field of the nearest player by path, straight in
  when close with a clear line, with a little shoulder room so crowds spread. A claw: windup (`zswing`), then damage
  if still in reach. Risers: open bands only, 12-42 m by path from the nearest player. A zombie stuck for ~6 s sinks
  and rises again elsewhere (its place in the count is not lost).
- **Kinds** (`ZM.kinds`): shambler (slow, 40 per claw), runner (fast, 0.85x health), brute (4x health, 70), boss (90).
- **Points** (`ZM.pts`): hit 10, kill 60, headshot kill 100, melee kill 130, boss 1500, revive 100. Double Pay doubles
  hits and kills.
- **Gates**: fences cut each map into bands along x; each cut has one gate. Price by depth from the start band: 750,
  1000, 1250, 1500, 1750. Opening one takes its wall off the map and the nav grid on every phone (the open mask is in
  the snapshot).
- **Wall-buys**: two or three per band, better guns deeper in (SMG and shotgun at the start; ARs, then heavies and LMGs).
  Buying one you hold buys ammo (40% of the price).
- **Mystery crate**: 950 points, rolls 3 s, offers one gun from `BOX_GUNS` (specialists and heavy hitters, never one you
  hold) to whoever paid for 9 s. After 4-8 rolls a roll comes up empty: the money back, and the crate moves to another
  spot after 6 s.
- **Power** (a layout with `power: true`, Ashgrove Halt only): the perk machines stand dark and sell nothing (the use
  button shows the machine greyed, "No power: find the switch") until someone throws the power switch: free, but it
  stands in an area behind gates. Once on it stays on (`zlights` event, a banner, the wire's `power` flag; a host
  migration keeps it). Maps without a switch are always on.
- **Perk machines** (four, one or two per band): Ironhide (2500, half damage from the undead), Quickdraw (3000, Fast
  Hands reloads and swaps), Mercy Run (1500, revive in 2 s), Hammerfall (2000, +50% damage). Going down loses them all.
- **Downs**: lethal damage downs you while anyone else is up (battle royale's crawl, 30 s bleed). A teammate standing by
  (within 1.9 m, not running) revives in 4 s (2 s with Mercy Run) to 60 HP. Bleeding out: back at the next round
  with the pistol, beside a teammate. Nobody up: game over (the horde's side wins; `zover`).
- **Power-ups**: a kill drops one 3% of the time (four a round at most, 25 s on the ground); the boss always drops Full
  Crate. Full Crate (everyone's guns full), Double Pay (30 s), Clean Sweep (every zombie but the boss, +400 each).
- **Bot teammates**: revive first; then take their own crate roll; then shop (a wall gun better than what they hold,
  perks with a cushion, ammo when low, the crate once they have two perks and a middling gun, gates only with no humans
  or when rich); otherwise a loose ring round the lead human. On a map with a power switch, solo (at most one human)
  from round 3, the first bot up goes and throws it if nobody has, buying the gates on the way to it when it can. They backpedal from anything inside 4.5 m (`bot.kite`),
  and never walk off to shop in the middle of a fight.

## Wire
The horde never goes out as player records. The rules block (`encode`) carries round, state, timer, undead left, the
open-gate mask, the crate, Double Pay, a short crew array `[points, perk bits | downed | revive progress, kills,
revives]`, the live horde as one packed number each (`packZombie`: seat, x and z in decimetres, aim in 64ths, kind, a
windup flag; about a dozen characters), drops, boss health, count and the best round. A guest derives zombie velocities
from consecutive snapshots. Round 20 with 24 alive: about 0.7 KB mean per guest snapshot, 1.4 KB max. Host migration
(`restore`) keeps round, gates, crate, drops, points and the live horde.

## Progression
- XP: match played, 12 per kill, 4 per headshot, 120 per round survived, 400 per boss round passed; guns earn 30% of the
  usual weapon XP. Kills stay off the K/D boards.
- Save: `save.zmBest` = `{mapId: rounds}` (best rounds survived), only ever goes up; SY4 export code entry [19],
  appended after career [17] and season [18] (written only when there is a record). `recordZmBest`, `cleanZmBest`.

## Performance (dev/sim-zombies.mjs, round 20, 24 live, every gate open)
| map | host tick mean | p99 | max | snapshot mean / max |
|---|---|---|---|---|
| neon | 0.40 ms | 4.5 ms | 13.5 ms | 719 / 1356 B |
| ruins | 0.27 ms | 2.9 ms | 4.9 ms | 713 / 1382 B |
| foundry | 0.24 ms | 2.3 ms | 5.0 ms | 721 / 1349 B |
| ashgrove | 0.17 ms | 2.0 ms | 3.6 ms | 721 / 1333 B |

Inside docs/BR-PERF.md's gate (mean under 3 ms, no tick over 33 ms). The renderer adds no per-zombie draw calls.

## Tests
- `node dev/sim-zombies.mjs [--quick]`: layout (sealed bands, reachability, placements), Ashgrove (the loop, dead ends,
  reserved spots, power gating perks, the bot power run, boss arena spawns, the power on the wire and through a migration), rounds and escalation, a bot crew
  playing rounds and buying, economy (hits, kills, Double Pay, gates, wall-buys and ammo, the crate roll / offer / take /
  move), perks, revive and bleed-out, game over, power-ups, wire round-trip and migration, the save record through an
  export code, determinism, round-20 performance.
- `python3 dev/ui-zombies-test.py <port>`: in Chromium at 852x393 and 667x375: Multiplayer > Zombies > Solo with bots >
  Find match, round 1 with zombies in view, the round survived, a wall-buy, a perk and a gate through the use button
  (clear of the sticks), then Overrun results with the Rounds survived XP line and the saved record.

## Ashgrove Halt (ROADMAP item 38)
A country rail halt and its churchyard on the edge of the farm valley, at night, in the fog: `js/shared/maps/ashgrove.js`
(medium, 76 x 48, region farmland), theme `js/render/themes/ashgrove.js`. Our own place and names. Built for Graveyard
Shift and nothing else: `hidden: true`, `modes: []`, `zmOnly: true` (so `mapModes` gives it zm alone, no Free-for-All or
Gun Game, and it never shows in a 6v6 vote, the solo picker or the menu backdrop); `MODES.zm.maps` lists it.

The story, as the crew walks it (x east, z south):

| area | id | where | what is there |
|---|---|---|---|
| The Halt (start) | `halt` | south-west | the platform, the waiting room; SMG and shotgun on the walls, Mercy Run |
| Goods Yard | `goods` | west | the goods shed, a parked van, the lamp room (a dead end, crate spot); AR, DMR, Quickdraw |
| Churchyard | `church` | north | the chapel, headstones, the crypt (a dead end, crate spot); PDW, heavy SMG, Hammerfall |
| Pump Yard (power) | `pump` | centre | the pump house with the power switch, the water tower; heavy AR. Ringed by a low railing you see and shoot over from the Churchyard and the Lane |
| Burial Field (boss arena) | `field` | east | open ground round the obelisk, chest tombs; LMG, saw, a crate spot |
| Crossing Lane | `lane` | south | the level crossing, the signal box, the coal stage behind a wall (a dead end, crate spot); carbine, Ironhide |

Gates (price): Halt-Goods 750, Halt-Lane 750, Goods-Church 1000, Lane-Pump 1250, Church-Pump 1250, Church-Field 1500,
Lane-Field 1500. They make one loop (Halt, Goods Yard, Churchyard, Burial Field, Crossing Lane, back to the Halt) with the
Pump Yard reached from either side; every gate is a chokepoint. An area is open when the open gates join it to the Halt
(`bandOpen` walks the gate graph), so the loop can be opened either way round.

**The graph form** (`ZM_MAPS[id] = { graph: true, power: true }`, `map.zm`; `graphLayout` in js/shared/zombies.js): areas
are found by flooding from each area's `seed` with every gate shut; gates are the rects that fill the openings in the
map's walls (no fences), each with its two areas (`a`, `b`), price and a stand point on each side (`stand[area]`,
`zmDoorStand(L, open, d)` for the side that is open). Wall-buys, crate spots (the first two are where the crate can
start), machines and the switch name a floor spot and the side its wall is on (`wall`: n, s, e, w); the wall point and
facing come from the map's walls. Spawn windows (`risers`) and the crew's `starts` are listed per area. The banded form
(neon, ruins, foundry) is unchanged.

**Power**: `power: true` on the layout puts the switch on the pump house's west wall (`L.power`). **Boss arena**:
`L.boss = { band, spots }`: on a boss round (10, 20, ...) the Yardmaster rises in the Burial Field, at the listed spot
furthest from the crew, when the field is open; otherwise at an ordinary riser (it never rises behind a shut gate). The
field is the biggest area (about 480 m2 of floor) with the obelisk to kite round.

**Kept for the economy** (`map.zm.reserved`, copied to `L.reserved` with each spot's area; nothing reads them yet):

| key | where | for |
|---|---|---|
| `bench` | Pump Yard, the pump house's north face | the upgrade bench |
| `terminal` | the Halt, on the yard wall | the supply terminal |
| `armour` | Crossing Lane, the signal box's south face | the armour bench |
| `traps` (3) | the Goods Yard gate into the Churchyard; the lane squeezed between the signal box and the railing; the Burial Field gate onto the lane | traps at chokepoints (`r` metres round x, z) |
| `exfil` | the Burial Field's far (north-east) corner, r 3 | the exfil pad |

Each has a `note`; spots against a wall carry `wall` (and `wx`, `wz`, `face` like a wall-buy).

**Art and budget**: night, cold moonlight from the north-west, ground mist (big faint motes), 22 oil lamp posts and the
lit chapel, waiting room and signal box windows, a ring of dark conifers beyond the hedges. The world is about 26k
triangles in 3 draw calls (Ruins 23k, Pier 26k, Night Market 29k, Foundry 39k), 27 lamp pools baked in; zm-fx adds its
usual handful and the power switch four. No team spawn pads (a zombies map has no team ends).

**Tests**: `node dev/map-validate.mjs ashgrove` (fields, nav, gaps; the zm layout: shut gates seal the Halt, each gate
opens exactly the area behind it, every placement, riser, start, boss spot and reserved spot on reachable floor in an
area; a 300 s bot crew match); the `ashgrove` section of dev/sim-zombies.mjs; the Ashgrove part of
dev/ui-zombies-test.py (932x430: power out, a dark machine refuses, gates to the Pump Yard, the switch through the use
button, the perk bought).

## Scorestreaks (as of build NEXT, unchanged pending the owner)
Loadout streaks do trigger here: the kit (`ZmRules.kit`) deals no streaks, but the streak slots come from the roster's
loadout, and kills still feed streak score (`Sim._kill`). Bots call them (one test run on Ruins, eight rounds: six UAVs,
five turrets, three gunships). The touch HUD hides the streak tiles in this mode, so a human on touch cannot call one; a
controller's Streak button could.

## Open
- Ashgrove's reserved spots wait for the economy (item 36).
- A new banded map needs a `ZM_MAPS` entry (cuts, door z, start band); a new built map a `map.zm` block (see Ashgrove)
  and a pass of the layout tests.
