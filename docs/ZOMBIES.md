# Graveyard Shift (ROADMAP item 26)

Our own co-op wave survival: up to four players (friends from the lobby, bot teammates in every empty seat) hold off a
horde round after round on Night Market (`neon`), Ruins (`ruins`) and Foundry (`foundry`). Everyone starts with a
pistol and the blade; points from hits and kills buy guns off the walls, the mystery crate, gates into the rest of the
map and four perk machines. The match ends when nobody is left up. All names are our own.

| id | name | players | maps |
|---|---|---|---|
| `zm` | Graveyard Shift | 1-4 humans, bots fill to 4, plus 24 horde seats | neon, ruins, foundry |

Rule set `zm` (`js/sim/zombies.js`, registered in `js/sim/rules.js`), numbers, formulas and layouts in
`js/shared/zombies.js` (`ZM`), mode entry `MODES.zm` (`js/shared/modes.js`, `maps` lists where it plays).

## Files
- `js/shared/zombies.js`: numbers (`ZM`), kinds, perks, power-ups, wall guns, crate guns, round formulas, and each map's
  layout (`zmLayout`): fences, gates, bands, wall-buys, crate spots, perk machines, risers and starts, built from the
  map's walls alone so every phone gets the same one. `placeZmWalls / syncZmDoors / clearZmWalls / reblockNav` put the
  fences and closed gates on the map as walls and keep the nav grid in step; `zmUsable` says what a player standing at
  a spot can use (shared by the host's command check, the HUD's button and the bots).
- `js/sim/zombies.js`: the host rules (`ZmRules`): rounds, spawning, horde driving, damage, downs and revives, buying,
  the crate, power-ups, bot teammates' shopping and revives, the snapshot block, host migration.
- `js/sim/zm-phone.js`: the phone that owns a human's gun applies the host's `zarm`, `zammo` and `zperk` events.
- `js/sim/sim.js`: `buildZmRoster` (four player seats, then `ZM.seats` horde seats on team `ZM_TEAM`), the pool roster
  keeps the horde seats; per-guest records skip the horde (`rules.seatCode`).
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
- **Perk machines** (four, one or two per band): Ironhide (2500, half damage from the undead), Quickdraw (3000, Fast
  Hands reloads and swaps), Mercy Run (1500, revive in 2 s), Hammerfall (2000, +50% damage). Going down loses them all.
- **Downs**: lethal damage downs you while anyone else is up (battle royale's crawl, 30 s bleed). A teammate standing by
  (within 1.9 m, not running) revives in 4 s (2 s with Mercy Run) to 60 HP. Bleeding out: back at the next round
  with the pistol, beside a teammate. Nobody up: game over (the horde's side wins; `zover`).
- **Power-ups**: a kill drops one 3% of the time (four a round at most, 25 s on the ground); the boss always drops Full
  Crate. Full Crate (everyone's guns full), Double Pay (30 s), Clean Sweep (every zombie but the boss, +400 each).
- **Bot teammates**: revive first; then take their own crate roll; then shop (a wall gun better than what they hold,
  perks with a cushion, ammo when low, the crate once they have two perks and a middling gun, gates only with no humans
  or when rich); otherwise a loose ring round the lead human. They backpedal from anything inside 4.5 m (`bot.kite`),
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

Inside docs/BR-PERF.md's gate (mean under 3 ms, no tick over 33 ms). The renderer adds no per-zombie draw calls.

## Tests
- `node dev/sim-zombies.mjs [--quick]`: layout (sealed bands, reachability, placements), rounds and escalation, a bot crew
  playing rounds and buying, economy (hits, kills, Double Pay, gates, wall-buys and ammo, the crate roll / offer / take /
  move), perks, revive and bleed-out, game over, power-ups, wire round-trip and migration, the save record through an
  export code, determinism, round-20 performance.
- `python3 dev/ui-zombies-test.py <port>`: in Chromium at 852x393 and 667x375: Multiplayer > Zombies > Solo with bots >
  Find match, round 1 with zombies in view, the round survived, a wall-buy, a perk and a gate through the use button
  (clear of the sticks), then Overrun results with the Rounds survived XP line and the saved record.

## Scorestreaks (as of build NEXT, unchanged pending the owner)
Loadout streaks do trigger here: the kit (`ZmRules.kit`) deals no streaks, but the streak slots come from the roster's
loadout, and kills still feed streak score (`Sim._kill`). Bots call them (one test run on Ruins, eight rounds: six UAVs,
five turrets, three gunships). The touch HUD hides the streak tiles in this mode, so a human on touch cannot call one; a
controller's Streak button could.

## Open
- No dedicated sounds yet for claws, the crate or the machines (hits and kills use the usual ones).
- Only the three maps listed; a new map needs a `ZM_MAPS` entry (cuts, door z, start band) and a pass of the layout test.
