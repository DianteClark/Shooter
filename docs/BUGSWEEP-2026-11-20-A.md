# Bug sweep A, 2026-11-20

Scope: the 1120 wave (builds 1120-1 to 1120-13). Branch `sweepA` from dev at 1120-13. Two shared vCPUs with sweep B
running alongside (load average 8 to 21 the whole time) and two server restarts mid-sweep, so every browser failure was
looked at for load before it counted, and timings only compare within a table.

## 1. Results

### Node

| test | result |
|---|---|
| sim-arsenal, sim-attachments, sim-audio, sim-boards, sim-campaign, sim-clans, sim-ctf, sim-events, sim-extract, sim-finishers, sim-gear, sim-golden-respawn, sim-gunfight, sim-heldslots, sim-modes-v10, sim-music, sim-ranked, sim-snd, sim-streaks-v8, sim-streaks-v9, sim-telemetry, sim-tournament, sim-unlocks, sim-zm-allies, sim-zm-econ, sim-zm-runs, sim-zombies | pass |
| sim-botpool | FAIL then pass: a tag clash (fix 2) and its cost check under load (fix 8) |
| sim-br | pass (rerun after fix 3: pass) |
| sim-resurgence | quick FAIL "back in next to a squadmate (20.1 m)", fixed (fix 3); full pass after |
| sim-seasons | pass (rerun after the camo rename: pass) |
| help-videos-test.mjs | pass (30) |
| map-validate.mjs (full) | FAIL oasis: "hq: no objective activity in 60 s" (fix 7); every other map passes |

### Browser (python3 dev/ui-*.py, ports 9800-9849)

RESULTS_TABLE

## 2. Fixes

1. **Campaign HUD on every match (the tutorial card overlap, ~60 findings).** js/ui/cp-hud.js mounts its mission
   chips (`.cp-top`) and objective card (`.cp-card`), the boss bar and revive bar into the shared objective strip, which
   takes them out of `.cp-ui`; hiding `.cp-ui` outside the campaign no longer hid them. Every non-campaign match showed
   a "1 MISSION" chip and an empty card under the score bar, and the tutorial card sat on top of them. They are now hidden
   unless the HUD has `cp-on` (the pattern extraction's HUD uses). `ui-hud-layout-test --only tutorial,tdm`: pass.
2. **Season 3 camo "Hailstone" clashed with the bot gamer tag Hailstone** (sim-botpool: no tag may match an item
   name). Tags are append-only and shown on boards, so the camo's display name is now **Graupel** (its id `hailstone`
   stays, so saves and SY4 codes are untouched). docs/SEASONS.md updated.
3. **Rebound redeploy far from the squadmate.** `_redeploy` (js/sim/br.js) picked one spot 5 to 11 m off the mate and
   snapped it to the nearest open cell; inside a building or water that can be far off. It now tries six sides of the
   mate and falls back to the mate's own spot (pulled-in landings for a mate outside the circle keep the old rule). The
   20.1 m in sim-resurgence's unit check was itself measured a second late (the mate, a bot, kept running after the
   redeploy): the check now measures at the event (13.2 m).
4. **Extraction watching plate buttons spill out at 640x360** (ui-ex-test). The plate is narrowed to the gap between
   the squad list and the spectate card, and its buttons were `nowrap` and never shrink; they now wrap to a second row
   when the gap is too narrow (js/ui/ex-hud.js).
5. **A quick melee swap restarted by its own swap event** (ui-anim-test). When the view's weapon change reaches the
   rig before the sim's swap event, the rig starts the swap; a blade's 0.12 s swap can be over in one slow frame, and
   the event then restarted it from the new weapon (put away and drawn again). The rig now remembers that the view
   started the swap (`swapByView`) and the event leaves it alone (js/render/characters.js). The test also emitted a
   second swap event of its own on top of the sim's, and could pick a bot whose second weapon is a blade (over before
   it looks): it now swaps to a pistol and relies on the sim's event.
6. **Wrenfield vote art** re-rendered (`node dev/render-snapshots.mjs wrenfield`, 28.7 KB).
7. **map-validate Oasis HQ**: deterministic with seed 1234 since 1120: a 6 v 6 brawl on the middle zone swings the
   capture back and forth for the whole 60 s (other seeds capture; at 120 s seed 1234 does too). Headquarters now gets
   the doubled window, as CTF, Control and Infected have. Not a map fault.
8. **sim-botpool "the whole pool two years on is cheap"** failed at 100 ms and 60.1 ms under load (26 ms alone): best of
   three passes (careerAt has no cache, so it still measures the work).
9. **ui-clans-test**: the vote had no 6 v 6 team card (a friend vote always carries a BR card, and 1120 added modes), so
   a random card won (One in the Chamber: no teammate bot, chatter and tag checks failed). If no team card is on offer
   the host's first card becomes Railyard TDM; votes go through the DOM.
10. **ui-br-test** under load: plane wait 40 to 90 s, Host tap 60 s.

## 3. Screens looked at

FIXME

## 4. Open

FIXME
