# Graveyard Shift (ROADMAP item 26)

Our own co-op wave survival: up to four players (friends from the lobby, bot teammates in every empty seat) hold off a
horde round after round on Night Market (`neon`), Ruins (`ruins`), Foundry (`foundry`) and Ashgrove Halt (`ashgrove`, built
for the mode: see "Ashgrove Halt" below). Everyone starts with a
pistol and the blade; points from hits and kills buy guns off the walls, the mystery crate, gates into the rest of the
map, six perk machines and the late-game economy (the upgrade bench, the supply terminal, armour plates, traps, the exfil
and a hidden quest: "Economy" below). The match ends when nobody is left up, or when the crew gets out. All names are our
own.

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
- `js/sim/zm-phone.js`: the phone that owns a human's gun applies the host's `zarm` (with a bench tier: `zmTierDef`),
  `zammo` and `zperk` events.
- `js/sim/zm-econ.js`: the economy on the host (`ZmEcon`, owned by `ZmRules.econ`): the upgrade bench, tier-3 round
  effects, the supply terminal and its gear, plates, traps, the exfil, the quest and the Gravewarden, the bots' economy
  wants, its wire block and migration.
- `js/render/zm-econ-fx.js`: the economy in the world: stations, trap floors and effects, the exfil pad and beacon,
  relics and the altar, the terminal's gear, x-ray outlines. About eighteen draw calls whatever the round.
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
  the blade, a frag and a stim; class loadouts, attachments, perks and streaks stay home (the loadout's scorestreaks
  neither charge nor fire: `ZmRules.noStreaks`, `Sim._deal`, `Sim.useStreak`). 500 points each.
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
- **Perk machines** (six, one or two per band): Ironhide (2500, half damage from the undead), Quickdraw (3000, Fast
  Hands reloads and swaps), Mercy Run (1500, revive in 2 s), Hammerfall (2000, +50% damage), Fleetfoot (2000,
  Marathon's faster sprint and slide recharge), Last Breath (3500, see "Economy"). A player holds four at most
  (`ZM.perkLimit`); at the cap a machine sells a **perk slot** instead (8000, once) that raises it to six. Going down
  loses the perks (not the slot).
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

## Economy (ROADMAP item 36)
The owner reached round 12 with lots of points and all four perks and nothing to spend on. Numbers in `ZE`
(js/shared/zombies.js), the host side in js/sim/zm-econ.js. Every piece goes through the use button (`zmUsable`).

| piece | where | what |
|---|---|---|
| **Upgrade bench** | one per map (Ashgrove: the pump house's north face) | the gun in your hands, a tier up: 5000, 15000, 30000. The gun goes in (the blade in its place) for 4 s and nobody else can use the bench meanwhile; the owner takes it back (left 30 s, it comes back by itself). Tier 1: damage x1.8, magazine x1.35, reserve x1.7; tier 2: x3, x1.7, x2.3; tier 3: x4.4 and a round effect by class: **Ember Rounds** (SMGs, pistols: burning, 60% of the hit a second for 4 s), **Arc Rounds** (ARs, LMGs: the hit jumps to the two nearest within 4.5 m at 60%), **Burst Rounds** (shotguns, launchers: a 2.6 m burst at 50%), **Rime Rounds** (marksman, snipers: 55% slower for 3 s). Tiers live on the player per gun (`p.zm.tiers`): a gun keeps its tier through swaps and loses it when given up for another. The look: tier 1 Laurel Line, tier 2 Sovereign, tier 3 the effect's camo (Molten Core, Live Wire, Event Horizon, Silver Service), which also tints the gun's tracers |
| **Supply terminal** | the start area (Ashgrove: the Halt's yard wall) | a sheet of five, one of each per player a round, prices up 5% a round past round 1: **Sentry Gun** (1500: 40 s at your feet, 15 m, 12% of a round's health a shot), **Air Strike** (2500: the thickest crowd within 25 m, five 4 m shells, 300% each; bosses 6%), **Hunter Drone** (2000: 45 s at your shoulder, flies to what it hunts, 14% a shot), **Lure** (1000: the undead within 30 m by path go for it for 12 s, then it blows for 200% in 5 m), **Armour Vest** (1250: every plate at once). At most eight pieces of gear in play. Trap, sentry, drone, strike and lure kills pay half a kill (30) and no hit points |
| **Armour bench** | one gate out (Ashgrove: the signal box) | a plate for 500, three at most (50 each); plates take claws before health (after Ironhide), the bar of three over health |
| **Traps** | 2-3 per map at gates (Ashgrove: the three reserved chokepoints) | **Live Rail** (electric floor), **Firedamp Vents** (fire), **Threshers** (spinning blades): 1000 at the switch beside it, 30 s running, 45 s cooling. The undead in it take 140% of a round's health a second (bosses 1.2%); kills pay 10. A player in it takes 14 a second |
| **Exfil** | a far area (Ashgrove: the Burial Field's north-east corner) | from round 15, 12000 to call at the pad: a final wave (a zombie every ~0.4 s, off the round's count) for 60 s, then whoever is up on the pad gets out: the match is won, "Escaped on round N", 2000 + 100 a round XP and the map's escape record. Nobody on the pad: the exfil leaves, the match goes on |
| **The quest** | three relics (Ashgrove: the lamp room, the crypt, the coal stage) and the altar (the obelisk's south face) | pick up the relics (shared by the crew), set them on the altar: the **Gravewarden** rises (40x a round's health, +10% per player, calls up two runners every 10 s, off the round's count). Putting it down pays 3000 each, 3000 XP and the **Lantern Out** calling card |
| **Last Breath** | a perk machine | go down and get yourself up 3 s later with every perk kept, even with nobody else up; then spent for three rounds |

**Placement.** Ashgrove uses its reserved spots (`map.zm.reserved`) and its own `quest` block. The banded maps place the
pieces after everything else (so the older placements stay put): the terminal in the start band, the armour bench one
band out, the bench in the deepest band, a trap 2.8 m through each of the first three gates (Night Market and Ruins have
two gates, so two traps), the exfil pad on open ground (2 m clear all round) away from the gates in a far band, the altar
against a wall in another, the relics in the floor cell furthest from the middle of three different bands. Each trap's
switch stands just outside it (`finishEcon`).

**Bots** buy sensibly with spare points: a tier for a gun worth it (not the pistol) from round 6 with a cushion, plates
when one short, a trap with three or more undead in or near it, the terminal from round 4 with 2500 over (a vest when
short of plates and the armour bench is shut, else a sentry, a drone, a strike on a crowd of six from round 8), a perk
slot when 2500 over its price. During an exfil every bot goes to the pad; a bot with its gun on the bench waits for it.
They never call the exfil or do the quest.

**HUD**: the use button's prompts for each piece (UPGRADE <gun> with the tier and effect, UPGRADING, TAKE, SUPPLY
TERMINAL, ARMOUR PLATE, the trap's name, PERK SLOT, CALL EXFIL, PICK IT UP, SET THE RELICS), the plate bar over health,
three tier pips on the weapon panel (tier 3 in its effect's colour), the terminal's sheet (`.zm-shop`: five items,
price this round, greyed when bought or too dear; in js/ui/gamepad.js MATCH_PANELS, so a controller walks it), the exfil
clock and the relic count on the round plate, a quest hint at round 3, banners and notes for each event.

## Economy pacing (dev/sim-zm-econ.mjs)
A bot crew held up (spawn protection, so the run reaches round 20 whatever the bots do) shooting, shopping and upgrading
as usual. Per player per round, the mean of four; "choices" is how many of the economy's buys (a bench tier, each
terminal item, a plate, a perk or a slot) a player could afford at the round's start.

Night Market (`node dev/sim-zm-econ.mjs --map=neon`):

| round | earned | spent | bank | guns | gates | perks | bench | terminal | armour | traps | choices |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 785 | 250 | 1790 | 0 | 0 | 0 | 0 | 0 | 250 | 0 | 1.3 |
| 8 | 2128 | 1850 | 1603 | 600 | 0 | 1000 | 0 | 0 | 0 | 250 | 0.3 |
| 10 | 5568 | 875 | 6808 | 0 | 0 | 875 | 0 | 0 | 0 | 0 | 0.8 |
| 11 | 3115 | 4575 | 5348 | 1188 | 0 | 375 | 2500 | 0 | 500 | 250 | 3.8 |
| 12 | 2948 | 3913 | 4383 | 950 | 0 | 750 | 1250 | 588 | 375 | 0 | 3.5 |
| 13 | 2770 | 4325 | 2828 | 3088 | 0 | 0 | 0 | 1200 | 500 | 250 | 4 |
| 14 | 4478 | 1850 | 5455 | 713 | 0 | 500 | 0 | 0 | 625 | 250 | 2.8 |
| 15 | 4180 | 2338 | 7298 | 950 | 0 | 375 | 1250 | 0 | 0 | 0 | 3.8 |
| 16 | 4208 | 5563 | 5943 | 1438 | 0 | 500 | 2500 | 0 | 875 | 250 | 4.5 |
| 17 | 6300 | 4625 | 7618 | 238 | 0 | 2750 | 1250 | 0 | 625 | 0 | 2 |
| 18 | 7735 | 5750 | 9603 | 475 | 0 | 1625 | 1250 | 1400 | 750 | 250 | 4 |
| 19 | 3710 | 8175 | 5138 | 1013 | 0 | 3375 | 1250 | 1663 | 875 | 0 | 3.8 |
| 20 | 5038 | 5263 | 4913 | 1763 | 0 | 500 | 1250 | 738 | 750 | 500 | 2.3 |

Rounds 1-20: 63,100 earned, 58,700 spent (93%).

Ashgrove Halt (`--map=ashgrove`; the perks wait for the power, so the late game starts later):

| round | earned | spent | bank | guns | gates | perks | bench | terminal | armour | traps | choices |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 1725 | 1340 | 2228 | 90 | 0 | 875 | 0 | 0 | 375 | 0 | 0.3 |
| 12 | 3305 | 5013 | 1328 | 450 | 1063 | 3125 | 0 | 0 | 375 | 0 | 0.3 |
| 14 | 3185 | 450 | 5223 | 450 | 0 | 0 | 0 | 0 | 0 | 0 | 1.8 |
| 15 | 4405 | 2388 | 7240 | 0 | 0 | 750 | 0 | 638 | 1000 | 0 | 3.8 |
| 16 | 3228 | 3875 | 6593 | 0 | 0 | 625 | 2500 | 0 | 750 | 0 | 5.3 |
| 17 | 4995 | 2950 | 8638 | 0 | 0 | 0 | 1250 | 1575 | 125 | 0 | 5 |
| 18 | 3555 | 7200 | 4993 | 0 | 0 | 2750 | 2500 | 700 | 1250 | 0 | 4 |
| 19 | 4063 | 3550 | 5505 | 0 | 0 | 875 | 1250 | 1425 | 0 | 0 | 3.8 |
| 20 | 3595 | 375 | 8725 | 0 | 0 | 0 | 0 | 0 | 375 | 0 | 4 |

Rounds 1-20: 45,900 earned, 37,700 spent (82%).

Reading it: by round 10 a bot earns 3-6k a round and from round 11 spends it across perks, the bench, the terminal,
plates and traps, with three to five of the economy's buys in reach at a round's start; nothing piles up (the bank stays
at 5-9k, a tier-2 upgrade's worth). A human who lands more of the kills than a bot (the owner's case: a tier 1 bought
at round 12 would have taken 5,000 of a bank that had nowhere to go) moves up the tiers faster: tier 2 around round 14,
tier 3 by round 20, with the perk slot (8000) and two more perks (5500) beside them. Prices kept as first set: the bench
at the suggested 5000 / 15000 / 30000, the terminal's cheapest items (lure, sentry) at about a round's income at round
10, plates at a tenth of it.

## Wire
The horde never goes out as player records. The rules block (`encode`) carries round, state, timer, undead left, the
open-gate mask, the crate, Double Pay, a short crew array `[points, perk bits | downed | revive progress, kills,
revives]`, the live horde as one packed number each (`packZombie`: seat, x and z in decimetres, aim in 64ths, kind, a
windup flag; about a dozen characters), drops, boss health, count and the best round, the power, then the economy's block (`ZmEcon.encode`: the bench
[state, owner, gun, tier, timer], each trap [state, timer], the gear [kind, x, z, aim, life, owner] each, the exfil
[state, timer, caller, who got out], the quest [relics found, state], the Gravewarden's seat) and the Gravewarden's
health. Each crew entry is [points, perk bits (six) | downed | revive progress | perk slot, kills, revives, plates,
Last Breath's round, gun tiers [weapon, tier]..., earned, spent]. A guest derives zombie velocities from consecutive
snapshots. Round 20 with 24 alive, every trap running, two sentries and two drones: about 0.96 KB mean per guest
snapshot, 1.6 KB max. Host migration (`restore`) keeps round, gates, crate, drops, points, the live horde (the bosses at
the health their bars showed), the bench, traps, gear, the exfil, the quest and every player's tiers, plates and perk
cap.

## Progression
- XP: match played, 12 per kill, 4 per headshot, 120 per round survived, 400 per boss round passed; guns earn 30% of the
  usual weapon XP. Kills stay off the K/D boards.
- Save: `save.zmBest` = `{mapId: rounds}` (best rounds survived), only ever goes up; SY4 export code entry [19],
  appended after career [17] and season [18] (written only when there is a record). `recordZmBest`, `cleanZmBest`.
- Feats (item 36): `save.zmFeats` = `{mapId: [best round escaped on, Gravewarden down 0|1]}`, only ever goes up; SY4
  entry [21], appended after the finisher picks [20] (written only when there is one). `recordZmFeat`, `cleanZmFeats`.
  An escape pays 2000 + 100 a round ("Escaped on round N"), the Gravewarden 3000; the **Lantern Out** calling card
  (Career) follows the flag on any map. The results screen says Escaped and lists the best escape.

## Performance (dev/sim-zombies.mjs, 24 live, every gate open, every trap running, two sentries, two drones, tier-3 guns)
| map | round | host tick mean | p99 | max | snapshot mean / max |
|---|---|---|---|---|---|
| neon | 20 | 0.49 ms | 5.0 ms | 6.6 ms | 957 / 1587 B |
| neon | 30 | 0.28 ms | 4.5 ms | 4.9 ms | 958 / 1600 B |
| ruins | 20 | 0.28 ms | 2.9 ms | 4.7 ms | 972 / 1605 B |
| ruins | 30 | 0.34 ms | 3.7 ms | 6.2 ms | 959 / 1591 B |
| foundry | 20 | 0.61 ms | 4.2 ms | 6.3 ms | 990 / 1713 B |
| foundry | 30 | 0.35 ms | 3.2 ms | 5.4 ms | 988 / 1658 B |
| ashgrove | 20 | 0.23 ms | 1.4 ms | 4.0 ms | 984 / 1631 B |
| ashgrove | 30 | 0.25 ms | 2.2 ms | 5.2 ms | 975 / 1614 B |

Inside docs/BR-PERF.md's gate (mean under 3 ms, no tick over 33 ms). The renderer adds no per-zombie draw calls; the
economy adds about eighteen fixed ones (gear is instanced).

## Tests
- `node dev/sim-zombies.mjs [--quick]`: layout (sealed bands, reachability, placements), Ashgrove (the loop, dead ends,
  reserved spots, power gating perks, the bot power run, boss arena spawns, the power on the wire and through a migration), rounds and escalation, a bot crew
  playing rounds and buying, economy (hits, kills, Double Pay, gates, wall-buys and ammo, the crate roll / offer / take /
  move), perks, revive and bleed-out, game over, power-ups, wire round-trip and migration, the save record through an
  export code, determinism, round-20 and round-30 performance with the economy busy. The `econ` section (item 36):
  loadout streaks off (no slots, none called in a bot match); the bench (prices, the gun out of the hands, the bench
  busy, the wait, take, magazines, damage per tier, left too long, tier 3's arcs, burning and slow, tiers kept through a
  swap and lost with the gun); the terminal (every item at its price, prices climb, once a round, sentry and drone fire,
  strike shells, the lure pulls); plates (three, soak, break); traps (arm, kill and the reduced pay, a player hurt
  lightly, cooldown, ready again); the perk cap and slot, Fleetfoot, Last Breath (alone, kept perks, spent); the exfil
  (not before 15, the wave off the count, escaped and won, guests see it, failure); the quest (relics, the altar, the
  Gravewarden, its bar, pay, off the count); bots buying bench tiers, plates, terminal items and a slot; the economy
  through a guest's view and a host migration that carries on; feats through an export code and the calling card.
- `node dev/sim-zm-econ.mjs [--map=] [--rounds=]`: the pacing table above.
- `python3 dev/ui-zombies-test.py <port>`: in Chromium at 852x393 and 667x375: Multiplayer > Zombies > Solo with bots >
  Find match, round 1 with zombies in view, the round survived, a wall-buy, a perk and a gate through the use button
  (clear of the sticks), then Overrun results with the Rounds survived XP line and the saved record. The economy part
  (`ZM_ONLY=econ`, Ashgrove at both sizes): a gun upgraded at the bench (out of the hands, back at tier 1 with one pip and
  the tier's camo), tier 3's look, the terminal's sheet and a sentry bought from it (firing), each trap armed, two plates
  (the bar), the exfil called at round 15 (its clock), a relic, the altar and the Gravewarden's bar.
- `python3 dev/ui-gamepad-test.py`: the terminal's sheet from a controller (Interact opens it, the d-pad walks it, A buys,
  B closes). `python3 dev/ui-hud-layout-test.py --only zm`: the plates, tier pips, exfil clock, relic count and an
  upgrade prompt clear of each other and the sticks at every size.

## Ashgrove Halt (ROADMAP item 38)
A country rail halt and its churchyard on the edge of the farm valley, at night, in the fog: `js/shared/maps/ashgrove.js`
(medium, 76 x 48, region farmland), theme `js/render/themes/ashgrove.js`. Our own place and names. Built for Graveyard
Shift and nothing else: `hidden: true`, `modes: []`, `zmOnly: true` (so `mapModes` gives it zm alone, no Free-for-All or
Gun Game, and it never shows in a 6v6 vote, the solo picker or the menu backdrop); `MODES.zm.maps` lists it.

The story, as the crew walks it (x east, z south):

| area | id | where | what is there |
|---|---|---|---|
| The Halt (start) | `halt` | south-west | the platform, the waiting room; SMG and shotgun on the walls, Mercy Run, the supply terminal |
| Goods Yard | `goods` | west | the goods shed, a parked van, the lamp room (a dead end, crate spot, a relic); AR, DMR, Quickdraw, Fleetfoot (the van), a trap at the gate into the Churchyard |
| Churchyard | `church` | north | the chapel, headstones, the crypt (a dead end, crate spot, a relic); PDW, heavy SMG, Hammerfall, Last Breath (the chapel porch) |
| Pump Yard (power) | `pump` | centre | the pump house with the power switch and the upgrade bench, the water tower; heavy AR. Ringed by a low railing you see and shoot over from the Churchyard and the Lane |
| Burial Field (boss arena) | `field` | east | open ground round the obelisk (the altar at its foot), chest tombs; LMG, saw, a crate spot, the exfil pad |
| Crossing Lane | `lane` | south | the level crossing, the signal box (the armour bench), the coal stage behind a wall (a dead end, crate spot, a relic); carbine, Ironhide, two traps |

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

**The economy's spots** (`map.zm.reserved`, copied to `L.reserved` with each spot's area; graphLayout puts the bench,
terminal, armour bench, traps and exfil pad on them, and the quest's altar and relics come from `map.zm.quest`):

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

## Scorestreaks
Off in this mode (item 36): the loadout's streaks are dealt away (`Sim._deal` with `rules.noStreaks`), so kills charge
nothing and neither a human (touch tiles were already hidden; a controller's Streak button) nor a bot can call one
(`Sim.useStreak` refuses). The supply terminal sells the mode's own instead. Before this, one test run on Ruins saw six
UAVs, five turrets and three gunships from the bots in eight rounds.

## Open
- The economy on the banded maps sits where the placement rules put it; a hand-placed pass (like Ashgrove's) would read
  better on Foundry, whose deepest bands are big.
- A new banded map needs a `ZM_MAPS` entry (cuts, door z, start band); a new built map a `map.zm` block (see Ashgrove)
  and a pass of the layout tests.
