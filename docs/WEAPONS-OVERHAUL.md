# Weapons overhaul (V10)

Owner direction: the game is free, so pack it with variety; overhaul one section at a time. Battle royale comes later
and will need loot rarities, so every gun must stand on its own identity. New guns get mastery tracks, camos, armory
art and unlock levels when they are built, not later.

## What the owner's stats say (docs/stats-2026-11-10-b.txt, 45 matches; decode with js/game/telemetry.js)
Scope `a` is every player (mostly bots), `h` is the owner. The last 11 matches are after the previous balance pass.

Last 11 matches, all players, K/D by gun (see the table at the end):
- Shotguns are still the worst guns in the game after a damage buff: Squall 0.26, Thresher 0.39, Doublet 0.50,
  Railspike 0.77. Hit rates are 86-92% and damage per hit is fine inside 5 m (63-76), so the problem is not damage:
  their users die on the way in. This needs identity (mobility, hip-fire, sprint-to-fire, one-shot range) and bots
  that play a shotgun like a shotgun, not more damage.
- Foreman (battle rifle) is the best primary by a distance: 1.68 K/D, 5.7 kills/min, 39-45 damage out to 30 m.
- Rasp fell from the top to 0.58 after its nerf (damage per hit 21/22/16/9): over-corrected.
- Weak: Kestrel 0.40, Bodkin 0.55, Gantry 0.67 (20% accuracy), Drayman 0.67, Stitch 0.71, Monolith 0.74, Skitter 0.75.
- Healthy band (0.85-1.25): Halyard, Bulwark, Lancet, Shunter, Drover, Prospector, Tallyman, Millrace, Ballast, Cadence.
- Sidearm kills/min are inflated by short held time; judge them by K/D and time to kill.

The owner (scope `h`): 77% Rasp picks over 45 matches; K/D 0.74 lifetime, 0.52 in the last 11. Shots that hit: 6-8%
with automatic guns, against 35-55% for bots with the same guns. Either the human is disadvantaged against bots at
range (aim assist, bloom, bot aim), or holding the fire ring down between targets is normal touch play and accuracy is
the wrong lens. Find out which, and make a human on a phone at least as effective as a Regular bot with the same gun.

## Targets
- Every primary between 0.85 and 1.20 K/D in mirrored bot play on small, medium and large maps, with each class
  winning in its own range band (shotgun and SMG close, AR mid, marksman and LMG long lanes, sniper longest).
- No gun strictly better than another in its class: each has a reason to pick it.
- Map sizes now range from 52x34 to 136x80 (docs/MAPS-OVERHAUL.md); balance across all of them.

## Parallel work (three builders, separate worktrees)
- BALANCE: existing entries of js/shared/weapons.js, js/sim/player.js, js/sim/bots.js (weapon use), js/shared/tuning.js,
  js/game/telemetry.js, js/ui/help.js Weapons tab. Ships dev/balance-sim.mjs, which the lead reruns after the merge.
- ARSENAL: new guns and attachments in NEW files (js/shared/weapons-v10.js merged into WEAPONS by one line in
  weapons.js; models in js/render/guns-v10.js hooked by one line in guns.js), plus their catalog/progression/mastery/
  camo/armory/gunsmith/Gun Game/telemetry entries.
- FEEL: js/render/guns.js (existing models and animation), js/render/vfx.js, js/render/combat.js, js/audio/audio.js:
  how every gun looks, sounds and kicks.

## Balance pass: what shipped (BALANCE builder)

Measured with `node dev/balance-sim.mjs` (see the header of that file for every option). The K/D pairs below are the
tool's mirrored 6 v 6 bot matches on the code before this pass and after it: 4 seeds x 2 rounds x (Pier/Turnstile,
Railyard/Dust, Foundry/Canyon) x (TDM, Domination), Regular bots, 430-880 kills a gun
(`for s in 1 2 3 4; do node dev/balance-sim.mjs --no-duels --rounds=2 --seed=$s --json=out-$s.json; done`, then add
kills and deaths). Before: 0.47 to 1.59, fifteen of 23 primaries outside 0.85-1.20. After: 0.88 to 1.17, none outside.
The sim's "before" ranks guns the way the owner's 45 matches do (shotguns bottom, Foreman/LMGs/snipers top) but is
compressed, because it fields every gun equally and at one skill.

One line per gun (identity; what changed):
- **Halyard** (`ar`, sim K/D 1.28 -> 1.15): the all-rounder, best at 15-25 m. Changed: was the top AR (1.28): 28->27 damage, 700->680 rpm, full damage to 16 m (was 18), a little more aimed spread and bloom. Pass 2: 670 rpm (was 680): it ran 1.24 in mirrored play once Foreman came down.
- **Cadence** (`burst`, sim K/D 1.06 -> 1.03): three-round burst that wins the 20-35 m lane on rhythm. Changed: unchanged.
- **Drayman** (`heavyar`, sim K/D 1.23 -> 0.99): slow heavy AR, four to the body out to 35 m. Changed: unchanged; it was weak only against the old LMGs, snipers and Foreman. Pass 2: full damage to 18 m (was 20): top of the realistic table (1.22).
- **Shunter** (`carbine`, sim K/D 1.06 -> 1.00): the AR that moves like an SMG and fires out of a slide. Changed: unchanged.
- **Skitter** (`smg`, sim K/D 0.90 -> 0.91): fastest feet, the SMG that still bites at 20 m. Changed: 22->23 damage, 950->980 rpm, 32->36 rounds, full damage to 12 m (was 8) and 60% past 20 m, tighter hip, faster out of a sprint.
- **Rasp** (`pdw`, sim K/D 0.77 -> 0.88): fastest kill in a room: four rounds inside 7 m, spent past 14 m. Changed: over-nerf undone where it matters: 20->25 damage, but falloff starts at 7 m and bottoms at 42%, so it does not come back as a mid-range gun. Pass 2: 26 damage (was 25), full damage to 9 m (was 7) and 45% past 14 m (was 42%), hip 0.042 -> 0.038: still four rounds in a room, spent past 14 m. Realistic 0.66 -> 0.79.
- **Stitch** (`tacsmg`, sim K/D 0.93 -> 0.97): the SMG you aim: a laser down the sights, poor from the hip. Changed: 24->25 damage, 780->800 rpm, falloff to 24 m at 62%: four to the body out to 12 m; bots close to 22 m before plinking.
- **Ballast** (`heavysmg`, sim K/D 0.72 -> 0.93): slow bruiser SMG: three to the body, goes through crates. Changed: 34->36 damage, 500->560 rpm, 24->26 rounds, full damage to 9 m, tighter hip, a touch faster on foot.
- **Thresher** (`shotgun`, sim K/D 0.67 -> 0.98): the dependable pump: one shell kills to 7 m, seven shells loaded singly. Changed: damage untouched; one-shot range 5->7 m (falloff 7/13), tighter fan, sprint-to-fire 0.14->0.10 s, faster feet. Pass 2: one-shot range 7.5 -> 9 m, feet 1.04 -> 1.09. Shotgun bots die on the way in (about 60% of their deaths are past 10 m), so reach and feet, not more damage.
- **Squall** (`autoshot`, sim K/D 0.47 -> 0.89): the shotgun you run with: three shells a second from the hip and out of a slide. Changed: 8 light pellets (was 7), 320 rpm, falloff 5.5/11 (was 4/8), hip fan 0.1->0.075, fires out of a slide, sprint-to-fire 0.17->0.11 s, moves at 1.02 (was 0.97) and keeps moving while aimed, reload 3->2.4 s. Pass 2: falloff 7/11.5 (was 5.5/11), feet 1.02 -> 1.08.
- **Doublet** (`coach`, sim K/D 0.67 -> 0.90): ambush gun: hardest hit in the class, quickest out of a sprint, two shells then nothing. Changed: 17->20 per pellet so half the fan kills inside 7.5 m, falloff 7.5/12, sprint-to-fire 0.06 s, reload 2.1->1.6 s, faster feet. Pass 2: falloff 8.5/12.5 (was 7.5/12), feet 1.07 -> 1.12.
- **Railspike** (`slug`, sim K/D 0.75 -> 0.91): one aimed slug: two to the body out to 13 m, through cover. Changed: 58->62 damage, 160->220 rpm, 6 rounds, falloff 13/24, quicker to aim and strafes while aimed; bots take it to 20 m.
- **Bulwark** (`lmg`, sim K/D 1.37 -> 1.17): wall of fire down a long lane once it is spun up. Changed: was 1.37: 32->29 damage, 720->660 rpm, full damage to 18 m (was 22), heat after 30 rounds (was 40) with a longer lockout, slower feet. Pass 2: turns at 2.6 rad/s (was 2.4): 0.76 in realistic lobbies, where flanks come from Mixed bots. A 2.9 turn plus quicker ADS pushed it to 1.30 mirrored, so only the turn.
- **Drover** (`saw`, sim K/D 1.37 -> 1.10): the LMG that can walk. Changed: was 1.37: 700->640 rpm, a little more aimed spread, heat after 19 rounds (was 21).
- **Millrace** (`rotary`, sim K/D 1.21 -> 1.13): area denial: highest rate of fire, turns like a freight car. Changed: 1300->1200 rpm, heat after 80 rounds (was 90).
- **Gantry** (`lightlmg`, sim K/D 1.16 -> 1.14): box-fed light LMG, an AR with a 45-round box and tight sights. Changed: 600->580 rpm only; its 20% accuracy in the owner data was bots spraying at range, fixed by the bot changes.
- **Tallyman** (`dmr`, sim K/D 1.11 -> 1.02): two to the body through mid range, flinches the target. Changed: unchanged; sees 2 m further down its scope.
- **Foreman** (`battle`, sim K/D 1.27 -> 1.00): fast semi that keeps a target pinned at 25-45 m. Changed: was the best primary (owner 1.68, sim 1.27): 39->38 damage, 310->280 rpm, 20->18 rounds, worse from the hip; still three to the body. Pass 2: `headMax: 2.4`: a head hit is never a kill on its own at any stance (as a Marksman rifle it always was: 61% of the owner's Foreman kills and 64% of bots' were head kills, at up to 280 rpm). Paid back on the body so it still pins: 39 damage (still three to the body), 305 rpm (was 280), bloom per shot 0.26 -> 0.21, 20 rounds, reload 2.1 s. The head cap is the lever an aimed-in tapping human feels most.
- **Prospector** (`lever`, sim K/D 0.85 -> 0.94): two-shot skirmisher carried at the hip and on the move. Changed: 68->72 damage, 120->150 rpm, less bloom per shot, quicker to aim and to load.
- **Bodkin** (`crossbow`, sim K/D 0.86 -> 0.90): silent one-bolt hunter. Changed: one-bolt range 15->18 m, reload 1.25->0.95 s, quicker to aim.
- **Lancet** (`sniper`, sim K/D 1.59 -> 1.08): overwatch: erases anyone when fully aimed, at 35 m and beyond. Changed: was 1.59 in the sim: 46->38 rpm, the bolt throws the scope further off (boltKick 0.45->0.3), slower to aim and on foot; bots see 4 m past normal down its scope instead of 10.
- **Monolith** (`antimat`, sim K/D 1.29 -> 1.09): one body shot anywhere it reaches, through cover; owns 35 m+. Changed: stats unchanged; bot scope reach 10->7 m. Its weakness in the owner data was dying to rushers, which the engagement-distance changes address.
- **Kestrel** (`semisnipe`, sim K/D 0.91 -> 1.04): the quickscope bolt gun for people who keep moving. Changed: one-shot range 16->18 m, aims in 0.21 s (was 0.23), bots see 4 m further down its scope. Pass 2: 68 rpm (was 62), one-shot range 20 m (was 18), aims in 0.19 s (was 0.21), hip shots 60% (was 55%). Realistic 0.59 -> 0.64 only: see Pass 2 below.
- Sidearms and launchers: untouched except **Verdict** (`revolver`): 125->140 rpm, reload 2.4->2.1 s (0.72 -> 0.84 in
  `--sidearms`, where sidearms are carried as the main gun against each other; that table is noisier and is not a target).

Range bands (1 v 1 duels, Regular v Regular, mean "aware" win % of the class against the whole field, 50 is par):
```
            4m  10m  20m  35m  55m
Assault     45   43   57   55   54
SMG         58   65   54   51   47
Shotgun     68   57   34   33   37
LMG         45   42   55   45   47
Marksman    43   47   54   49   56
Sniper      39   44   45   72   62
```
Shotguns own 4 m, SMGs 10 m, ARs 20 m, snipers 35 m and beyond, marksman rifles are second at 55 m. LMGs do not win a
duel distance; they earn their K/D (1.10-1.17, the top of the band) in matches by holding lanes, which a duel on an
empty strip does not measure. Known residue: on the two small maps close guns sit at 0.76-0.95 and LMGs/Lancet at
1.2-1.5 (per-size numbers are a third of the sample each); on medium maps the close guns lead.

No gun strictly better than a classmate: within each class every gun leads the others on at least one of duel
distance, flank, mobility or sustained fire (for example Rasp 4 m, Stitch 10-20 m, Skitter feet and an even 55% at every distance, Ballast
cover penetration; Squall 4 m and hip/slide, Thresher capacity, Doublet burst and 20 m, Railspike 55 m).

### Shotguns: identity, not damage
Pellet damage is unchanged on Thresher and Squall (Doublet +3 a pellet so half its fan is a kill). What changed is
where the one-shot range ends (5 -> 7-7.5 m), how tight the fan is, how fast the gun comes up out of a sprint
(0.06-0.11 s) and how fast its carrier moves; Squall fires out of a slide. And bots now play them: see below.

### Bots choose their distance by gun (js/sim/bots.js)
- Close guns (`botUse.rush`: shotguns, SMGs, pocket guns) no longer cross open ground at an enemy who is facing them.
  They bound to cover that is nearer the target and out of its sight (`_closeIn`, mode `close`), wait at the corner,
  and charge only the last 2 m past `rush` or a turned back; with no cover they ambush, and a gun that still reaches
  shoots back (`plink`). Between fights they route along the least open side of the lane and hold corners with short
  sight lines (`_goCorner`) instead of lane overwatch spots. They fight at `pref`, not `pref + 4`.
- Shotgun bots are `precise`: they only pull the trigger with the fan on the body.
- Long guns back away from anyone inside their distance and see further down a scope by `botUse.sight` metres
  (Tallyman/Prospector 2, Lancet/Kestrel 4, Monolith 7; it used to be a flat +10 for the two big snipers).
- New guns get all of this from their own `botUse` (`rush`, `fireMax`, `precise`, `sight`); nothing is keyed on gun id.

### Human versus bot
`node dev/balance-sim.mjs --human` puts a scripted thumb (js/sim/humanlike.js: aim is a stick position with lag,
jitter and a flick error, the fire ring is held for the whole fight and a second after, 25% of fights in ADS, the
game's real aim assist applied) in one slot, with a Regular bot holding the same gun in the mirror slot.
- It reproduces the owner: 9-12% of shots hit (owner 6-8%), K/D 0.64 in the default Mixed lobby on the
  old code (owner 0.5-0.75).
- Why accuracy is so low: only 30-45% of the thumb's shots are fired with an enemy in front of the muzzle at all (bots:
  about 90%). Holding the ring down between targets is normal touch play, so raw accuracy is the wrong lens. But it is
  not the whole story: of the shots that do have a target in the cone the thumb lands 26-34% against a bot's 37-48%,
  because a thumb cannot follow a strafe. And the Mixed lobby is two Veterans and an Elite in every six.
- Changed: aim assist now also follows part of the target's sideways drift (45% from the hip, 60% aimed, capped at
  2.5 rad/s) in addition to friction (0.32 -> 0.38), reaches a little wider (edge 1.25 -> 1.5, offset cap 6 -> 7
  degrees). It never turns toward a target: it follows a share of the bearing's change, never the gap to the centre.
  Veteran bots react and settle slightly slower (reaction 0.24-0.38 -> 0.26-0.42 s, aim floor 0.03 -> 0.036).
  Recruit and Regular are unchanged.
- Result, same-gun duels, thumb win rate: v Recruit 84% -> 88%, v Regular 51% -> 60%, v Veteran 33% -> 37%.
  In 6 v 6: all-Regular lobby thumb K/D 1.06 -> 1.37 (mirror bot 0.84); Mixed lobby 0.64 -> 0.80 (mirror bot 0.65).
  The model is a model: confirm with the next stats export, which now carries the fields below.

### Telemetry (js/game/telemetry.js)
Five fields appended to every gun row: `adsShots`, `hipShots`, `adsHits`, `hipHits`, `coneShots` (shots with a visible
enemy in range within 10 degrees of the aim). `gunRows` adds `adsShare`, `adsAcc`, `hipAcc`, `coneShare`, `coneAcc`
(null for rows saved before the fields existed). STATS_VERSION and the `SYS1~` code format are unchanged; old rows are
simply shorter. Verified: docs/stats-2026-11-10-b.txt and the 34-match file decode to the same numbers as the tables
below and survive a re-encode.

## Tables
```
NEW MATCHES ONLY: 11 live min 54 { a: 212, h: 14, m: 11 }

== a ==      name         kills deaths  K/D   acc   hs%   ttk  k/min pick%  dmg/hit by range
machpistol  Gnat           16     8  2.00  0.56  0.63  0.97     -     1     15  18  21   8   -   -
battle      Foreman       230   137  1.68  0.47  0.62  0.54  5.72     4     45  40  40  39  28  27
launcher    Breaker        97    73  1.33  0.77  0.00  0.07 19.53     7     71  67  67  71   -   -
deuce       Deuce          23    18  1.28  0.54  0.39  0.33 40.59     1     33  26  33   -   -   -
ar          Halyard       292   240  1.22  0.36  0.48  0.47  4.88    16     28  28  27  26  20  13
lmg         Bulwark       214   178  1.20  0.40  0.49  0.46  4.17     4     33  30  30  30  25   -
sniper      Lancet        117   100  1.17  0.57  0.25  0.06  3.16     3     89  74  72  78  67   -
carbine     Shunter       125   121  1.03  0.50  0.53  0.68  3.81     3     25  23  22  21  15   -
saw         Drover        180   179  1.01  0.40  0.57  0.45  3.95    11     26  25  25  22  15   -
lever       Prospector    142   152  0.93  0.60  0.39  0.31  3.30     4     61  58  57  50  38   -
dmr         Tallyman      143   158  0.91  0.60  0.55  0.31  2.99     4     54  51  47  47 100   -
rotary      Millrace      129   143  0.90  0.35  0.50  0.69  2.93     4     20  21  19  15   6   -
heavysmg    Ballast       134   155  0.86  0.59  0.53  0.55  3.92     3     32  31  26  26   -   -
burst       Cadence       189   221  0.86  0.43  0.47  0.48  3.42     9     30  28  28  25  16   -
slug        Railspike     115   150  0.77  0.66  0.30  0.35  2.72     4     49  53  43  28   -   -
smg         Skitter       178   238  0.75  0.52  0.54  0.30  3.34    13     22  23  20  13   -   -
antimat     Monolith      136   185  0.74  0.64  0.21  0.00  2.41     5     84  80  81  76  78   -
revolver    Verdict         5     7  0.71  0.45  0.60  0.47  9.68     2     62  52  76   -   -   -
tacsmg      Stitch        121   170  0.71  0.46  0.60  0.32  2.73     3     28  26  24  28   -   -
scatter     Bramble        17    25  0.68  0.51  0.24  0.94  9.90     3     56  29   -   -   -   -
lightlmg    Gantry        134   200  0.67  0.20  0.43  0.54  2.48     5     29  28  29  29  20   -
heavyar     Drayman       112   168  0.67  0.44  0.38  0.31  2.49     3     32  36  35  33  24   -
thumper     Bombard        56    84  0.67  0.80  0.00  0.50 14.18     5     60  58  55  52  37   -
pdw         Rasp          166   287  0.58  0.19  0.51  0.28  2.10    10     21  22  16   9   -   -
crossbow    Bodkin        103   186  0.55  0.46  0.19  0.01  2.14     4     78  81  84  75   -   -
coach       Doublet        80   160  0.50  0.92  0.30  0.14  1.89     6     76  45  28   -   -   -
pistol      Flicker         8    19  0.42  0.47  0.38  0.49     -     0     35  34  54   -   -   -
semisnipe   Kestrel        66   167  0.40  0.60  0.30  0.44  1.71     4     91  72  60  52   -   -
shotgun     Thresher       63   161  0.39  0.87  0.29  0.20  1.62     3     63  49  25   -   -   -
autoshot    Squall         48   182  0.26  0.86  0.25  0.27  1.05    13     49  24   -   -   -   -

== h ==      name         kills deaths  K/D   acc   hs%   ttk  k/min pick%  dmg/hit by range
burst       Cadence         1     1  1.00  0.07  0.00  0.00     -     7      -  29  21   -   -   -
saw         Drover          1     1  1.00  0.10  1.00  0.07     -     7      -  50  24   -   -   -
lightlmg    Gantry         25    28  0.89  0.06  0.32  0.37  2.34    14     30  24  27  28  21   -
ar          Halyard        16    19  0.84  0.08  0.44  0.72  2.86    36     29  21  36  24  19   -
smg         Skitter         3     4  0.75  0.25  0.00  0.71  3.16    21     21  22  16   -   -   -
pdw         Rasp           35    67  0.52  0.06  0.80  0.31  1.30    43     20  21  18   9   -   -
launcher    Breaker         1     2  0.50  0.43  0.00  0.00  1.40     7      -   -   -  49   -   -
crossbow    Bodkin          5    13  0.38  0.10  0.20  0.00  1.34     7     55 100 100   -   -   -
autoshot    Squall          1     3  0.33  0.25  0.00  0.73     -     7     55   -   -   -   -   -
scatter     Bramble         0     4  0.00  0.04     -     -  0.00    29      -  28   -   -   -   -

matches 45 live min 219 pm { a: 756, h: 48, m: 45 }

== ALL (bots + you) ==  id        name          class    kills  K/D   acc   hs%   ttk   k/min pick%  dmg/hit 0-5 5-10 10-20 20-30 30-45 45+
machpistol  Gnat                       81  2.70  0.55  0.74  0.66 55.86     1     19   22   27   54    -    -
deuce       Deuce                      44  1.05  0.57  0.48  0.42 41.25     1     34   29   35    -    -    -
pistol      Flicker                    19  0.79  0.49  0.47  0.47 32.57     0     46   32   48  100    -    -
launcher    Breaker                   255  1.46  0.84  0.00  0.19 19.17     6     68   65   70   69   68    -
revolver    Verdict                    57  0.73  0.40  0.37  0.53 14.37     3     48   52   60   47    -    -
thumper     Bombard                   277  0.60  0.70  0.00  0.43 11.50     9     63   58   57   55   37    -
scatter     Bramble                    17  0.68  0.51  0.24  0.94  9.90     1     56   29    -    -    -    -
battle      Foreman                   865  1.32  0.49  0.62  0.46  4.87     6     44   42   40   39   28   27
burst       Cadence                   877  1.14  0.41  0.65  0.36  4.67     8     34   34   33   33   23   12
tacsmg      Stitch                    689  1.09  0.50  0.66  0.35  4.46     4     28   29   29   22    -    -
ar          Halyard                   749  1.02  0.39  0.58  0.38  4.22    10     33   31   30   28   33   15
rotary      Millrace                  704  1.25  0.34  0.70  0.39  4.21     4     28   27   23   22   21    -
saw         Drover                    758  0.96  0.37  0.65  0.39  3.94     8     31   30   28   25   14    -
heavysmg    Ballast                   134  0.86  0.59  0.53  0.55  3.92     1     32   31   26   26    -    -
smg         Skitter                   739  0.90  0.52  0.70  0.29  3.83    10     28   26   23   17    -    -
carbine     Shunter                   125  1.03  0.50  0.53  0.68  3.81     1     25   23   22   21   15    -
heavyar     Drayman                   674  0.94  0.44  0.58  0.34  3.59     5     42   39   39   38   35    -
pdw         Rasp                     1082  0.89  0.15  0.76  0.26  3.34    11     27   24   21   25    -    -
lmg         Bulwark                   577  1.02  0.36  0.62  0.41  3.30     5     35   34   34   31   29   17
lever       Prospector                525  0.73  0.61  0.50  0.34  2.85     5     65   61   58   48   36    -
slug        Railspike                 115  0.77  0.66  0.30  0.35  2.72     1     49   53   43   28    -    -
dmr         Tallyman                  425  0.72  0.61  0.52  0.38  2.52     4     54   51   49   50   52    -
lightlmg    Gantry                    134  0.67  0.20  0.43  0.54  2.48     1     29   28   29   29   20    -
sniper      Lancet                    338  0.87  0.55  0.22  0.08  2.16     4     83   86   79   82   76    -
crossbow    Bodkin                    103  0.55  0.46  0.19  0.01  2.14     1     78   81   84   75    -    -
antimat     Monolith                  351  0.70  0.60  0.21  0.07  2.04     4     83   84   83   85   86    -
semisnipe   Kestrel                   334  0.47  0.62  0.36  0.20  2.04     5     91   79   68   58    -    -
coach       Doublet                   370  0.47  0.87  0.34  0.12  1.92     7     66   44   26    -    -    -
shotgun     Thresher                  223  0.33  0.88  0.35  0.29  1.36     4     65   46   24    -    -    -
autoshot    Squall                    211  0.29  0.86  0.44  0.29  1.14    10     47   27   12    -    -    -

== YOU ==  id        name          class    kills  K/D   acc   hs%   ttk   k/min pick%  dmg/hit 0-5 5-10 10-20 20-30 30-45 45+
smg         Skitter                     7  1.00  0.28  0.57  0.41  4.94    10     21   33   19    -    -    -
ar          Halyard                    18  0.67  0.08  0.50  0.65  2.75    15     31   23   35   24   19    -
lightlmg    Gantry                     25  0.89  0.06  0.32  0.37  2.34     4     30   24   27   28   21    -
coach       Doublet                    13  0.37  0.42  0.46  0.09  2.26     6     66   33   17    -    -    -
pdw         Rasp                      340  0.74  0.06  0.81  0.34  2.23    77     28   24   20   20    -    -
revolver    Verdict                     4  0.44  0.07  0.25  0.57  2.20    15      -   62   45   70    -    -
launcher    Breaker                     8  0.89  0.30  0.00  0.00  1.96    19      -   33   76   57    -    -
thumper     Bombard                     3  0.27  0.21  0.00  0.20  1.80     8     63   53   46   67    -    -
lmg         Bulwark                     2  0.50  0.07  0.50  0.50  1.46     2      -   26   32   39    -    -
crossbow    Bodkin                      5  0.38  0.10  0.20  0.00  1.34     2     55  100  100    -    -    -
autoshot    Squall                      1  0.13  0.13  0.00  0.73  1.33     4     27   14    4    -    -    -
burst       Cadence                     1  1.00  0.07  0.00  0.00    -     2      -   29   21    -    -    -
pistol      Flicker                     0    -    -    -    -    -     0      -    -    -    -    -    -
saw         Drover                      1  1.00  0.10  1.00  0.07    -     2      -   50   24    -    -    -
scatter     Bramble                     0  0.00  0.04    -    -  0.00     8      -   28    -    -    -    -
sniper      Lancet                      0  0.00  0.00    -    -  0.00     6      -    -    -    -    -    -
```

## After merging the 16 new guns (lead, 4 seeds x 2 rounds x 6 maps x TDM and Domination)
All 39 primaries sit between 0.81 and 1.15 K/D. Just under the band: Hopper 0.81, Ballast 0.81, Lodestone 0.82,
Trammel 0.84, Murmur 0.84. Known gap: on the small maps (Pier, Turnstile) SMGs run 0.64-0.70 and LMGs 1.2-1.45, the
reverse of what the size should favour: bots hold the long lanes there. Look at bot play on small maps, not gun stats.
Tuned from their first numbers: Trammel, Thistle, Murmur, Hopper, Harrier, Lodestone up; Kiln, Stanchion, Bulwark,
Tallyman, Monolith down a touch; Ballast and Thresher up a touch.

## Pass 2: real lobbies (ROADMAP item 6)

The owner's 7 matches on the new build (docs/stats-2026-11-10-c.txt minus -b) had Foreman at 2.25 (owner 3.52, 88-25,
83% aimed, 61% head kills, 73% of its damage past 20 m) and shotguns at 0.17-0.68, where the mirrored rig had every
primary at 0.81-1.15.

### The realistic preset
`node dev/balance-sim.mjs --realistic` (header of that file): rosters from the game's own buildRoster with Mixed skill,
so bots draw guns, kits, perks, equipment and streaks as in a match (not mirrored); streaks and equipment on; maps and
modes drawn like Quick Play (size-tier weights, every mode but Gun Game); the mode's own limits, capped at 300 s; one
human-like thumb carrying the gun under test. It also reports how bots holding each gun die (streak/kit, inside 10 m).
The thumb now aims in for 80% of fights with a `scoped` gun (`settleLong`; owner: 83% on Foreman) and sees the
camera's ADS lead (`adsLook` 7.5 m); `tapAll` is an option for a careful tapper.

### Did it reproduce the owner? Partly
- Shotguns, yes: 0.58-0.69 in realistic lobbies against 0.96 mirrored. The difference is the lobby, mostly equipment:
  the same class mirrored with `--equipment` drops by 0.2-0.3, with `--streaks` alone it does not move. Snipers show
  the same equipment drop (Lancet 1.06 -> 0.77, Kestrel 1.00 -> 0.89, Lodestone 0.90 -> 0.76). Streak kills are not
  credited to guns (sim.js flags `streak`/`equip`, telemetry skips them), so that is not it.
- Foreman, no: 1.00-1.15 for bots and no thumb edge (0.6-0.7 like its classmates) at any thumb setting tried (longer
  sight, always aimed, tapping), on Quick Play maps or on Ground War maps. What the rig cannot model is a player
  who holds long sight lines at 25-45 m aimed in. Also the 7 matches cannot have been dealt by this code: none of the
  10 V10 bot primaries (Flywheel, Kiln, Trammel...) appears in them, which under buildRoster happens about once in
  1,500 seven-match runs. They came from another build, which is why stats now carry the build (below).
- Foreman was nerfed anyway, where the owner's data points (head kills of a fast precise gun), see its line above.

### Other Pass 2 changes (V10 guns)
Hopper 24 damage, 920 rpm, full damage to 11 m at 55%; Trammel one-shot range 7.5 m, feet 1.08; Thistle full damage to
13 m, feet 1.03; Tandem 290 rpm, bloom 0.18, full damage to 25 m at 75%; Nightjar 52 damage, 255 rpm, 72% at range;
Harrier 130 rpm, aims in 0.21 s; Lodestone charge 0.3 s, reload 2.8 s, aims in 0.32 s; Kiln 605 rpm. Bulwark turns at
2.6 rad/s. Halyard 670 rpm; Drayman full damage to 18 m.

### Results (2 seeds x 3 rounds x 6 Quick Play lobbies x 8 thumb guns = 288 realistic lobbies; mirrored 4 seeds x 2)
Realistic "before" is the pre-Pass-2 guns on dev 6d8b388, "after" is on dev dbe1804 (the streak overhaul moved
lobbies a little too). K/D: realistic before -> after | mirrored before -> after.
```
Halyard     0.94 -> 0.90 | 1.01 -> 1.09
Cadence     1.07 -> 1.07 | 1.01 -> 1.02
Drayman     1.06 -> 1.02 | 1.15 -> 1.10
Shunter     1.06 -> 1.09 | 1.11 -> 1.10
Flywheel    0.82 -> 0.83 | 0.92 -> 0.92
Kiln        0.96 -> 0.95 | 1.14 -> 1.08
Skitter     0.83 -> 0.84 | 0.94 -> 0.90
Rasp        0.66 -> 0.79 | 0.91 -> 0.93
Stitch      0.80 -> 0.84 | 0.98 -> 0.94
Ballast     0.88 -> 0.78 | 0.81 -> 0.83
Murmur      0.94 -> 0.96 | 0.84 -> 0.79
Hopper      0.85 -> 0.92 | 0.81 -> 0.95
Thresher    0.65 -> 0.69 | 0.97 -> 0.89
Squall      0.58 -> 0.66 | 0.97 -> 1.03
Doublet     0.69 -> 0.76 | 0.96 -> 0.97
Railspike   0.86 -> 0.82 | 0.91 -> 0.90
Trammel     0.67 -> 0.70 | 0.84 -> 0.86
Thistle     0.69 -> 0.71 | 0.86 -> 0.86
Bulwark     1.08 -> 1.17 | 1.14 -> 1.14
Drover      1.03 -> 1.03 | 1.15 -> 1.14
Millrace    0.86 -> 0.88 | 1.19 -> 1.14
Gantry      0.98 -> 1.03 | 1.18 -> 1.18
Stanchion   0.81 -> 0.78 | 1.15 -> 1.15
Tallyman    0.82 -> 0.76 | 1.20 -> 1.18
Foreman     1.15 -> 0.89 | 1.00 -> 0.85
Prospector  0.90 -> 0.89 | 1.00 -> 0.97
Bodkin      0.81 -> 0.77 | 0.96 -> 0.81
Tandem      0.86 -> 0.89 | 1.00 -> 1.09
Nightjar    1.07 -> 1.02 | 0.96 -> 1.07
Lancet      0.83 -> 0.75 | 1.08 -> 0.96
Monolith    0.87 -> 0.87 | 1.18 -> 1.20
Kestrel     0.59 -> 0.64 | 1.08 -> 1.24 (1.14 once hip shots went 65% -> 60%; focused run)
Harrier     0.81 -> 0.84 | 1.06 -> 1.07
Lodestone   0.69 -> 0.72 | 0.82 -> 1.12
```
Mirrored: all 34 primaries 0.79-1.20 (Murmur 0.79 untouched, noise). Realistic: the mean bot gun K/D is about 0.88
(deaths to streaks and kit count, kills by them do not), so 0.80 is close to par. Still under 0.80: the five pellet
shotguns (0.66-0.76), Kestrel 0.64, Lodestone 0.72, Lancet 0.75, Tallyman, Bodkin, Ballast, Stanchion (0.76-0.78).
Their mirrored numbers have little room left (Kestrel 1.14-1.24, Monolith 1.20), so the rest of the gap is for the
equipment side: what bots throw at a stationary long gun and at a shotgun closing in.
Thumb (human-like) K/D by gun, before -> after: Halyard 0.82 -> 0.68, Rasp 0.71 -> 0.69, Squall 0.65 -> 0.76,
Doublet 0.92 -> 0.86, Bulwark 0.64 -> 0.66, Tallyman 0.61 -> 0.84, Foreman 0.71 -> 0.60, Kestrel 0.63 -> 0.63 (about 270
deaths each, so +-0.08). No gun puts the thumb near 2x its classmates; a shotgun thumb is not helpless.

### Build tag in stats (js/game/telemetry.js)
Each match record carries `b: BUILD` (js/build.js). The export code is unchanged up front and appends
`~b:<build>=<matches>.<live>,...` and, when there is more than one build, each build's own rows as `~a@<build>:...`.
Decoders from before skip both; old codes decode as before (no `byBuild`). `decodeStatsCode(code).byBuild[build]` is
an aggregate per build, `buildsOf(agg)` lists them newest first. Matches saved before this read as build `?`.

## Attachments wave (ROADMAP item 10)

Owner: "I'd like each weapon to feel like it offers something and with its attachments it can mean more."
Data in js/shared/attachments-v11.js, appended to ATTACHMENTS after every older id (attachments.js), so packKit's
slot lists, SY4 codes and wire indices keep their meaning. 66 signature attachments (`kind: 'sig'`, made for one gun)
and 12 conversion kits (`kind: 'kit'`, one slot that changes how a gun plays); 121 attachments in all.

**Rules.** Every signature or kit names one gun (`weapons: [id]`), has a `for` line (what it is for) and a `desc`
(what it changes), and gives something and costs something on that gun (dev/sim-attachments.mjs checks every
gun-attachment pair, the 43 older attachments included, from the effective def). Only signatures and kits may touch
a gun's identity: damage, rpm, settle, wind-up, charge, burst gap, bolt kick, unaimed damage (adsGate), lunge, damage
at range (falloffMin), overheat lockout (`IDENTITY_MODS`), or replace fields outright with `set` (fire mode, pellets,
falloff, suppression, bot behaviour). A kit that changes damage re-derives the head multiplier, so "any aimed head hit
kills" still holds; the full-auto Tallyman takes Foreman's `headMax: 2.4` so it cannot one-tap heads at 400 rpm.

**Unlocks.** `unlock` 1-30 is a weapon level; 31-35 is mastery ladder tier I-V (`LADDER_BASE`, `unlockMet`,
`unlockLabel`). Signatures fill each gun's empty levels so every gun gets something new at least every six levels
(launchers seven); 17 second signatures open at Mastery I. Progress.hasAttachment reads the ladder tier; the results
screen reports ladder unlocks; the Gunsmith's Mastery tab names the part each tier opens.

**Models.** `look: {slot: id}` draws a signature or kit as a part the gun's own model already fits (js/render/guns.js
`modelKit`), so nothing floats or clips; a kit may also fill an empty slot's look. 73 of 78 change the model; the two
blade pairs and Barbed Darts (the Thistle draws no magazine) do not.

**Wire.** packKit keeps the low 16 bits (4 a slot) exactly as before; a part past the 15th of its slot leaves its
nibble empty or past an older build's list (so an older build sees stock) and puts its whole index in the high part, 7
bits a slot (an exact integer below 2^44 in the JSON snapshot).

**Battle royale loot** (js/sim/br.js `_rollGun`): class parts by rarity as before (botAttachments with `own: false`);
an epic gun carries one of its signature attachments 35% of the time, a legendary one 50%, and only a legendary can roll
its conversion kit (20% when the gun has one). dev/sim-attachments.mjs checks the rates and that every rolled part is
legal and survives the BR wire. dev/sim-br.mjs now checks revives over all squad matches together: bots carrying
signatures change the deal, and seed 11 alone gave 0 revives (dev itself gives 1-9 over seeds 11-14).

**Gunsmith.** The option list scrolls (30 px rows) and keeps the tried or fitted part in view; signatures and kits
carry a Signature/Kit chip; locks read "Level 12" or "Mastery I" and the foot names the requirement; the foot shows
what the part is for; a strip lists every number it moves on this gun (green up, red down, mode changes as notes),
from `attachmentDeltas`. The bench now shows the kit kept for any gun, equipped or not (`Progress.kitFor`).

**Bots.** botAttachments: regulars fit the gun's first signature on every other deal, veterans always, elites every
signature; veterans and elites run the gun's kit one deal in three. A kit's `set.botUse` changes how the bot fights
with it (a slug-barrel Thresher plays at 10 m, not 4). The tier's part count is unchanged.

**Balance method.** `node dev/best-builds.mjs` finds each gun's strongest legal build greedily (every slot in turn,
two passes, every part unlocked) by duel win rate against a fixed stock field (4, 10, 20, 35, 55 m, aware and both
flanks, same seed for every candidate); output dev/out/best-builds.json. `node dev/balance-sim.mjs --builds=...` then
plays mirrored matches with every gun carrying its best build; `node dev/kd-combine.mjs` adds seeds up. A duel proxy
cannot see stealth, cover or a lane, so a few duel-best builds play worse than stock in matches (Squall's first search
picked Runner's Choke; an 8-trial rerun did not); those are trade-offs that matches punish, not over-strong builds.

Results, mirrored, 4 seeds x 2 rounds, best builds on every primary (stock in brackets, same seeds): all 34 primaries 0.82-1.22 (stock 0.79-1.24, five outside 0.85-1.20). Just outside, inside
the +-0.06 a gun's 1,400 kills and deaths carry: Bulwark 1.22 (1.17 the run before; canted dot and Hush Can), Murmur
0.84 (stock 0.79) and Ballast 0.82 (stock 0.83, both weak without attachments). Biggest lifts from a best build:
Thistle 0.86 -> 1.11 (Needle Choke, Barbed Darts), Lancet 0.96 -> 1.12, Flywheel 0.92 -> 1.02, Prospector 0.97 -> 1.05;
biggest drops (duel-best, match-worse): Shunter 1.10 -> 0.98, Doublet 0.97 -> 0.85, Lodestone 1.12 -> 1.00.

Changes made from those runs: Gantry 565 rpm (was 580; best build 1.25), Ballast full damage to 10 m (was 9; stock and
best build 0.83-0.84), Needle Choke falloff x1.3 (was 1.4), Capacitor Bank charge x0.72 (was 0.65) and slower to aim
(Lodestone 1.23), Hollow Points keeps half its pierce instead of none (Nightjar 0.81 with it), Sabot Slugs 5 shells
(was 4), Siege Rounds reworked (Monolith's pierce was already at the cap), Twin Tube reload x2 and slower swap.
Most-picked parts in best builds: Canted Dot 7 of 23 guns that take it, Speed Mag 6/34, Holo 5/29: no part is in every
best build. Sidearms (`--sidearms`, not a target): pistols 0.87-1.16 with best builds; launchers were already above
the band stock (Breaker 1.44, Bombard 1.43) and stay there.

| Class | Gun | Part | Kind | Slot | Gives | Costs | Unlock |
|---|---|---|---|---|---|---|---|
| Assault | Halyard | Trueline Upper | Sig | barrel | recoil sway -22%, settle speed +15% | fire rate -6%, time to aim +4% | Level 7 |
| Assault | Halyard | Match Mags | Sig | mag | settle speed +25%, recoil sway -12% | magazine -5, reload +6% | Mastery I |
| Assault | Halyard | Tri-Burst Group | Kit | grip | Fires three-round bursts, recoil sway -40%, bloom per shot -30%, aimed spread -22% | fire rate -18%, hip spread +12%, sprint to fire +6% | Level 25 |
| Assault | Cadence | Metronome Spring | Sig | grip | gap in a burst -30% | recoil sway +30%, bloom per shot +20% | Level 7 |
| Assault | Cadence | Open Bolt | Kit | grip | Full auto: no bursts, fire rate +25% | bloom per shot +40%, aimed spread +30%, damage -7% | Level 25 |
| Assault | Drayman | Mule Rounds | Sig | mag | damage +8% | magazine -5, fire rate -12%, reload +10% | Level 7 |
| Assault | Shunter | Dash Sling | Sig | grip | swap time -25%, sprint to fire -20% | recoil sway +22%, aimed spread +15% | Level 7 |
| Assault | Shunter | Whisper Barrel | Kit | barrel | Suppressed: off the minimap | range -25%, fire rate -7% | Level 25 |
| Assault | Flywheel | Light Flywheel | Sig | grip | rounds to wind up -4, starting fire rate +25% | fire rate -8% | Level 7 |
| Assault | Flywheel | Heavy Flywheel | Sig | grip | fire rate +8% | rounds to wind up +4, starting fire rate -15% | Mastery I |
| Assault | Kiln | Kiln Baffles | Sig | barrel | overheat lockout -45% | rounds to overheat -3, time to aim +5% | Level 7 |
| Assault | Kiln | Firebrick Liner | Sig | mag | rounds to overheat +5 | cooling time +35%, move speed -3% | Mastery I |
| SMG | Skitter | Featherweight Frame | Sig | grip | sprint to fire -15%, move speed +3% | recoil sway +20%, range -15% | Level 16 |
| SMG | Skitter | Hive Drum | Kit | mag | 72-round drum, magazine +36 | reload +55%, time to aim +10%, fire rate -8%, move speed -5% | Level 26 |
| SMG | Rasp | Rattle Spring | Sig | mag | fire rate +8% | recoil sway +30%, magazine -4 | Level 27 |
| SMG | Rasp | Burr Muzzle | Sig | barrel | damage at range +20%, range +10% | hip spread +10%, sprint to fire +10% | Level 24 |
| SMG | Stitch | Needle Sight | Sig | optic | aimed spread -25%, time to aim -8% | hip spread +30%, move speed aimed -15% | Level 25 |
| SMG | Stitch | Suture Barrel | Sig | barrel | range +15%, damage at range +12% | hip spread +25%, move speed -3% | Mastery I |
| SMG | Ballast | Ram Rounds | Sig | mag | damage through cover +35% | magazine -4, fire rate -8% | Level 25 |
| SMG | Murmur | Muffled Bolt | Sig | grip | sprint to fire -15%, move speed aimed +10% | range -10%, fire rate -6% | Level 16 |
| SMG | Murmur | Open Muzzle | Kit | barrel | range +30%, damage at range +15% | Not suppressed: shows on the minimap | Level 26 |
| SMG | Hopper | Hopper Gyro | Sig | grip | bloom per shot -30%, recoil sway -20% | sprint to fire +15%, move speed -4% | Level 25 |
| Shotgun | Thresher | Breach Pump | Sig | grip | fire rate +15% | swap time +10%, move speed -3% | Level 27 |
| Shotgun | Thresher | Slug Barrel | Kit | barrel | Fires a single slug, range +150%, damage through cover +100%, damage at range +83%, aimed spread -81%, hip spread -17% | damage -60% | Level 24 |
| Shotgun | Squall | Runner's Choke | Sig | barrel | hip spread -15%, range +8% | fire rate -12% | Level 26 |
| Shotgun | Squall | Squall Drum | Sig | mag | magazine +8 | reload +30%, move speed -5% | Mastery I |
| Shotgun | Doublet | Twin Triggers | Sig | grip | fire rate +60% | hip spread +15%, reload +15%, aimed spread +10% | Level 26 |
| Shotgun | Doublet | Buck and Ball | Sig | mag | Six heavy pellets, range +25%, aimed spread -15% | hip spread +10%, damage -10% | Mastery I |
| Shotgun | Railspike | Sabot Slugs | Sig | mag | range +15%, damage through cover +15% | magazine -1, reload +10% | Level 27 |
| Shotgun | Railspike | Buckshot Tube | Kit | mag | Fires buckshot, damage +92% | aimed spread +567%, hip spread +132%, damage through cover -100%, damage at range -45%, range -40% | Level 24 |
| Shotgun | Trammel | Box Twelve | Sig | mag | magazine +4 | reload +25%, time to aim +6%, move speed -4% | Level 26 |
| Shotgun | Thistle | Needle Choke | Sig | barrel | damage at range +30%, aimed spread -20%, range +15% | hip spread +25%, time to aim +8% | Level 26 |
| Shotgun | Thistle | Barbed Darts | Sig | mag | damage +11% | magazine -1, reload +10% | Mastery I |
| LMG | Bulwark | Pre-Spun Motor | Sig | grip | starting fire rate +30% | rounds to overheat -4 | Level 14 |
| LMG | Bulwark | Assault Box | Kit | mag | No wind-up, swing speed +30%, time to aim -15%, move speed +8% | magazine -50, rounds to overheat -7, hip spread +10% | Level 22 |
| LMG | Drover | Drover Sling | Sig | grip | move speed aimed +20%, move speed +2% | rounds to overheat -3, recoil sway +15% | Level 14 |
| LMG | Drover | Quick-Change Barrel | Sig | barrel | overheat lockout -45% | rounds to overheat -3, time to aim +5% | Mastery I |
| LMG | Millrace | Light Barrels | Sig | barrel | swing speed +25%, rounds to wind up -3 | fire rate -12%, rounds to overheat -8 | Level 14 |
| LMG | Millrace | Overdrive Motor | Sig | mag | fire rate +10% | rounds to overheat -16, swing speed -10% | Mastery I |
| LMG | Gantry | Gantry 75 Box | Sig | mag | magazine +30 | reload +30%, time to aim +6%, move speed -4% | Level 14 |
| LMG | Stanchion | Long Belt | Sig | mag | magazine +41 | reload +35%, move speed -5% | Level 14 |
| LMG | Stanchion | Bedded Receiver | Sig | grip | unsettled spread -28%, rounds to settle -3 | move speed aimed -15%, swap time +15% | Mastery I |
| Marksman | Tallyman | Tally Cheekpiece | Sig | optic | scope kept per shot +20% | time to aim +8%, move speed -3% | Level 19 |
| Marksman | Tallyman | Runaway Sear | Kit | grip | Full auto, fire rate +120%, magazine +8, bloom per shot -50% | aimed spread +60%, damage -27% | Level 25 |
| Marksman | Foreman | Hair Trigger | Sig | grip | fire rate +15% | bloom per shot +35%, hip spread +10% | Level 19 |
| Marksman | Foreman | Pin Barrel | Sig | barrel | range +12%, damage at range +10% | fire rate -10%, time to aim +6% | Mastery I |
| Marksman | Prospector | Loop Lever | Sig | grip | fire rate +20% | aimed spread +20%, time to aim +5% | Level 19 |
| Marksman | Prospector | Scatter Loads | Kit | mag | Fires buckshot, damage +67% | aimed spread +650%, damage through cover -100%, range -57%, hip spread +56%, damage at range -50% | Level 25 |
| Marksman | Bodkin | Broadhead Bolts | Sig | mag | unaimed damage +25%, damage +10% | reload +20%, range -20% | Level 19 |
| Marksman | Bodkin | Recurve Limbs | Sig | grip | range +25% | time to aim +10%, move speed -3% | Mastery I |
| Marksman | Tandem | Lockstep Sear | Sig | grip | gap in a burst -40% | recoil sway +30%, bloom per shot +20% | Level 19 |
| Marksman | Nightjar | Hollow Points | Sig | mag | damage +12% | damage through cover -50%, magazine -1 | Level 19 |
| Sniper | Lancet | Heavy Bolt | Sig | grip | scope kept per shot +60% | fire rate -12% | Level 16 |
| Sniper | Lancet | Self-Loader | Kit | mag | Semi-automatic, fire rate +120%, scope kept per shot +100%, magazine +3 | aimed spread +35%, damage -22% | Level 25 |
| Sniper | Monolith | Siege Rounds | Sig | mag | unaimed damage +45% | magazine -1, range -15%, reload +15% | Level 16 |
| Sniper | Monolith | Monolith Brake | Sig | barrel | scope kept per shot +50% | time to aim +6%, move speed -4% | Mastery I |
| Sniper | Kestrel | Hot Chamber | Sig | grip | fire rate +25% | aimed spread +30% | Level 16 |
| Sniper | Kestrel | Kestrel Eye | Sig | optic | time to aim -15%, unaimed damage +15% | aimed spread +40%, range -20% | Mastery I |
| Sniper | Harrier | Stripper Clips | Sig | mag | reload -30% | swap time +10%, move speed -3% | Level 16 |
| Sniper | Harrier | Wing Bolt | Sig | grip | fire rate +12% | aimed spread +20% | Mastery I |
| Sniper | Lodestone | Capacitor Bank | Sig | mag | charge time -28% | magazine -1, reload +15%, time to aim +8% | Level 16 |
| Sniper | Lodestone | Overcharge Coil | Sig | barrel | damage +15% | charge time +60%, move speed -4% | Mastery I |
| Pistol | Flicker | Snap Holster | Sig | grip | swap time -40%, sprint to fire -20% | aimed spread +25%, range -15% | Level 24 |
| Pistol | Verdict | Speedloader | Sig | mag | reload -40% | swap time +15%, move speed -3% | Level 25 |
| Pistol | Verdict | Heavy Frame | Sig | barrel | bloom per shot -30% | swap time +15%, fire rate -10% | Mastery I |
| Pistol | Gnat | Gnat Stock | Sig | grip | recoil sway -35%, aimed spread -20% | swap time +35%, move speed -2% | Level 25 |
| Pistol | Deuce | Triple Tap | Kit | grip | Fires three-round bursts, magazine +4, gap in a burst -13%, fire rate +10% | damage -16% | Level 22 |
| Pistol | Deuce | Long Slide | Sig | barrel | gap in a burst -15%, range +15% | swap time +20%, sprint to fire +15% | Level 26 |
| Pistol | Bramble | Bramble Spreader | Sig | barrel | Eight pellets, damage +7% | hip spread +25%, aimed spread +20%, range -15% | Level 25 |
| Pistol | Magpies | Crossfire Grips | Sig | grip | hip spread -15% | swap time +15%, fire rate -10% | Level 25 |
| Pistol | Tacker | Framing Drive | Sig | mag | damage +14% | magazine -8, fire rate -15% | Level 25 |
| Launcher | Breaker | Twin Tube | Sig | mag | magazine +1 | reload +100%, swap time +25%, move speed -7% | Level 24 |
| Launcher | Bombard | Pump Drum | Sig | mag | magazine +2 | reload +30%, move speed -4% | Level 24 |
| Launcher | Ripple | Tight Pack | Sig | barrel | gap in a burst -40%, aimed spread -20% | blast radius -15% | Level 24 |
| Melee | Gaff | Serrated Hook | Sig | barrel | range +20% | move speed -3% | Level 5 |
| Melee | Gaff | Lunge Strap | Sig | grip | lunge +30% | fire rate -15% | Level 15 |
| Melee | Maul | Iron Head | Sig | barrel | damage +15%, range +15% | fire rate -18%, move speed -4% | Level 5 |
| Melee | Maul | Ash Haft | Sig | grip | fire rate +30%, move speed +3% | damage -22%, range -12% | Level 15 |
