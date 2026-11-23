# Bug sweep D, 2026-11-22

Scope: the 1122 wave (builds 1122-1 to 1122-10: destruction, Meridian City, Conquest and Breakthrough, five guns and
five perks with Overkill, VTOL / Napalm / SAM and four operators, Saltmere Abbey and Operation Starfall, Breakthrough
balance, Sirocco Basin, Kittiwake Bay, Kaldvik, host tick spikes). Branch `sweepD`, from dev at 1122-10. Sweep C ran
the node sims and the first half of the UI tests alongside on the same two vCPUs (load average 9 to 17 most of the
time), and the server restarted once mid-sweep (the runs it cut were run again). Every failure was retried before it
counted; timings only compare within a table.

## 1. Every test

| test | first run | after fixes / retry |
|---|---|---|
| ui-mastery-badges-test | pass | |
| ui-mastery-test (node) | pass | |
| ui-modes2-test | pass | |
| ui-music-test | pass | |
| ui-overflow-test, 667x375 and 932x430, all sections | (new scenes: Campaign tab on Nightrail and Starfall, Starfall's finale briefing, Conquest and Breakthrough picked on Ground War, Loadouts with Overkill; the five new guns on the bench; a new "broken word" check) Breakthrough's mode chip broke mid-word at 667; at 932 the Service Record's Next unlocks ran off the screen and the finale briefing's Deploy was cut | **3 game fixes** (section 4: 1, 4, 5); the failing scenes rerun at 667, 852 and 932: pass. Totals: menus 178 + 178 states, gunsmith 227 + 227, no other spill, cut or broken word |
| ui-prestige-test | pass | |
| ui-qol-test | pass | |
| ui-ranked-test | pass | |
| ui-replay-test | tdm "Delete removes the clip" timed out, then cap's fifth clip refused (the clip left behind) | the confirm tap goes through the DOM before the 2.5 s arm lapses, cap starts with no clips; tdm + cap rerun: pass. BR overview now at five fixed points, paused (section 3) |
| ui-reset-test | pass | |
| ui-results-test | stale: Harvest now hosts Conquest and Breakthrough; ranked rolled Trawler Basin (a new medium map) | allowed lists updated (ranked's medium maps now come from the game's own list); pass |
| ui-snd-test | pass | |
| ui-streak-cam-test | VTOL, Napalm and SAM: up in the sim, camera stays on the player. Hardcore Sonar Sweep "enemies on it" failed once | the two enemies brought close could both carry Ghost (bots' random perks); the test now never picks two Ghosts. `--radar` and the full run: pass |
| ui-sweep-fresh | pass (rerun after the restart: pass) | |
| ui-sweep-net | TDM pass; Graveyard Shift and BR timed out | the vote could end on a random card under load (a TDM where a BR was wanted), and the waits polled on animation frames of a page left behind the other. Every card is now the case's map and mode, waits poll on a timer, `NET_TRACE=1` names each wait. BR alone: pass; TDM and Graveyard Shift passed (with migration) on the run before; full rerun at the end: see section 7 |
| ui-sweep-perf | all 26 cases (section 3); cpboss could not find Nightrail's mission 8 | with every mission open the Campaign tab opens on Starfall: the case picks Nightrail first; rerun pass |
| ui-sweep-play (PLAY_S=20) | 27 cases: the 16 district maps as 6v6 (one mode each round the Standard list), Saltmere, the Conquest and Breakthrough playlists, Conquest on Harvest, Breakthrough on Tidebreak, Quick Play, Ground War, BR Quads, Extraction Quads, Zombies. Red Gulch and Signal Ridge: Custom's click timed out while the match booted | the Custom tap goes through the DOM; both rerun: **27/27 clean** (results, XP lines equal the save's gain, challenge rows match, history, save survives a reload, nothing off screen) |
| ui-sweep-shots | first run stopped at 667: Multiplayer reopened on the Campaign tab my new shots left it on | the test opens the Standard tab; added the 1122 screens (the four islands in Custom and on vote cards with Conquest / Breakthrough on Meridian, Campaign Starfall, finale briefing, Loadouts with Overkill, unlock sheets of the 5 guns, 4 operators, Overkill, VTOL, Napalm, SAM) and a 667x375 size: **160 screens, all ok** |
| ui-touch-test | pass (also after the HUD layout change, section 7) | |
| ui-tourney-test | the Unlocked summary opened after the tap's close, then covered Back to bracket | taps close the summary and retry, and stop once the button is gone; pass |
| ui-trophy-test | stale (7 Graveyard Shift maps, 17 feat emblems); "nothing past the edges: 16" (once at 667, once at 956) | counts updated; the edge checks wait out the done column's slide-in from the left (the 16 nodes); pass |
| ui-viewport-test | pass | |
| ui-voice-test | pass | |
| ui-wave5-test | pass | |
| ui-zm-bodies-test | pass | |
| ui-zombies-test (full, and ZM_ONLY=saltmere) | pass, pass | |
| dev/wpn-feel-test.py (full) | PASS: 66 guns incl. Gadfly, Carousel, Vigil, Fusee, Skyhook (each its own voice, flash, tracer; Skyhook a rocket) | |

## 2. Play-review (screenshots at 667x375 and 932x430)
- **Destruction** (dev/ui-destruction-test.py on Midtown, Caravanserai, Trawler Basin): walls and glass break with
  debris and scorch, no draw call per break, world triangles unchanged, minimap redraws. Trawler's "a thrown frag broke
  the crate" missed its 6 s wall-clock poll once under load; the screenshot shows the crate in pieces (sweep C's test).
- **Overkill loadout**: a Vigil in the sidearm slot with its OVERKILL tag, the new streaks' tiles; long perk and streak
  names truncate with an ellipsis at 667 (as before).
- **Starfall**: Campaign tab (line, stations, plate), the finale briefing (fixed at 932), all four missions played
  step by step (forced) with shots of each step: objective card, boss bar (fixed overlap at 932, section 4.6), radio
  lines, Director Vane's crest.
- **Saltmere Abbey**: HUD at both sizes and the zombies test's 11 Saltmere shots (quay, font, power, bell, Ferryman,
  dive, cloister): nothing off.
- **The four new BR islands**: Custom picker, vote cards, drop map and the ground after landing at both sizes. The
  drop maps of Meridian, Sirocco and Kittiwake printed place names over each other (fixed, section 4.3); Kaldvik's was
  readable.
- Conquest and Breakthrough HUDs (flags row, sector banner, ticket bars) at 932: no overlaps.

## 3. Performance (`dev/ui-sweep-perf.py`, 932x430, Low pinned, medians over 12 s, max in brackets)
Budget (docs/ARCHITECTURE.md): under 120 draw calls; docs/BR-PERF.md's references: Harvest 39k to 71k triangles drawn
on Low, the giant study map 29k after tiling. Script ms is the perf overlay's (SwiftShader, loaded box).

| case | calls | triangles | script ms | 11-20 sweep (calls / tris) |
|---|---|---|---|---|
| BR Quads, Frontier, on the ground | 44 (48) | 43k (55k) | 10.6 | 36 / 51k |
| BR Quads, Jadefall | 47 (50) | 25k (45k) | 11.6 | 42 / 55k |
| BR Quads, Meridian City (Midtown boulevard) | 48 (54) | 32k (49k) | 10.8 | |
| BR Quads, Sirocco Basin (Caravanserai) | 42 (49) | 55k (60k) | 11.5 | |
| BR Quads, Kittiwake Bay (Shipyard) | 36 (43) | 19k (31k) | 10.3 | |
| BR Quads, Kaldvik (church square) | 46 (53) | 40k (45k) | 9.3 | |
| Ground War TDM, Harvest | 43 (49) | 65k (109k) | 8.5 | 46 / 88k |
| Ground War TDM, Tidebreak | 30 (40) | 18k (77k) | 9.0 | 39 / 52k |
| Ground War TDM, Coral Quarter | 33 (37) | 22k (37k) | 6.8 | 24 / 13k |
| Conquest, Harvest | 52 (57) | 90k (115k) | 9.8 | |
| Breakthrough, Tidebreak | 66 (73) | 71k (155k) | 17.1 | |
| Conquest, Meridian City | 62 (72) | 54k (153k) | 9.6 | |
| Breakthrough, Meridian City | 54 (60) | 55k (79k) | 13.2 | |
| Graveyard Shift r20, Ashgrove | 55 (58) | 70k (74k) | 11.7 | 56 / 66k |
| Graveyard Shift r20, Night Market | 66 (72) | 92k (104k) | 12.9 | 60 / 84k |
| Graveyard Shift r20, Polestar | 57 (63) | 73k (80k) | 11.0 | 59 / 77k |
| Graveyard Shift r20, Wrenfield | 57 (61) | 77k (82k) | 10.8 | 54 / 70k |
| Graveyard Shift r20, Saltmere Abbey | 53 (58) | 72k (88k) | 13.4 | |
| TDM, Railyard | 25 (32) | 47k (52k) | 6.8 | 31 / 64k |
| TDM, Millbrook | 34 (39) | 71k (91k) | 7.7 | 32 / 42k |
| TDM, Launchpad / Observatory / Pagoda | 30 / 32 / 35 | 59k / 57k / 65k | 7.0 / 7.5 / 6.5 | 30 / 33 / 32 |
| Campaign mission 8 at the boss | 46 (50) | 90k (94k) | 10.2 | 44 / 87k |
| Campaign Starfall finale (mission 12) at Director Vane | 43 (46) | 68k (75k) | 10.2 | |
| Replay playback, Railyard TDM | 22 (22) | 74k (85k) | 2.5 | 22 / 71k |

Every case is inside 120 calls (worst 73, Breakthrough on Tidebreak). The new islands sit with Frontier and Jadefall
(36 to 48 calls, 19k to 55k triangles). The one thing worth a look: Conquest and Breakthrough on Tidebreak and
Meridian peak at 150k+ triangles (medians 54k to 71k) and Breakthrough is the busiest case for calls and script time:
32 soldiers pushing through one sector on screen at once. Within budget; noted for the next perf pass. No console
errors in any case.

Replay's BR overview check (last sweep's open item) now pauses playback and compares the overview with the follow
camera at five fixed points of the map (the follow camera held on each point): Frontier 137k overview vs 65k follow
summed (2.1x, under 2.5x), Ashgrove 256k vs 254k, overview at most 40 / 47 calls.

## 4. Fixed (game)
1. **Breakthrough's mode chip broke mid-word** on the Ground War tab at 667 wide ("BREAKTHRO / UGH"), in Custom's mode
   list too. A soft hyphen, as Headquarters has (js/ui/playscreens.js, js/ui/vote.js).
2. **Golden Gun's unlock sheet said "Reach level 1, 1 / 1, Locked"** from the Gunsmith (its locked card read
   "Level 1"). The sheet now shows the requirement (max everything) and its four steps with progress; the card reads
   "Max all" (js/ui/unlocksheet.js, js/ui/gunsmith.js). Older than 1122, found in the overflow walk's shots.
3. **BR drop map place names printed over each other** on the new islands (Meridian: Westgate / Old Quarter, Gallery
   Row / Ferry Terminal, Chapel Row / Waterfront Docks; Kittiwake: Harbour Office / Market Cross, Lifeboat Station /
   Fish Market; Sirocco: Gulch Mouth / Red Gulch, Signal Ridge / Pump Station). Names are now laid out once per map
   (best places first; a name that would overlap one already placed moves a line up or down, or a little sideways),
   cached by content so a guest's per-snapshot list costs nothing (js/ui/br-hud.js). Checked on Meridian and Kittiwake
   at both sizes.
4. **Service Record at 932x430: Next unlocks off the bottom of the screen.** The Pro perks grid was 16 columns; the 21
   perks of 1122-4 wrapped to a second row. It is one row of however many perks now (css/cards.css).
5. **Starfall finale briefing at 932x430: Deploy cut at the bottom** (the Veteran pay line names the skin and emblem,
   one line more). The map picture gives way first (css/campaign.css).
6. **Campaign boss bar over the objective card's foot at 932x430.** The objective strip placed its rows from heights
   measured when the card was still empty. A row that changes height now has the rows placed again (one layout a frame
   at most, from the existing ResizeObserver; steady state: no extra layout calls, measured on Midtown Dom, Meridian BR
   and Harvest Conquest) (js/ui/hud.js).

Changelog: one NEXT entry with the six (player-facing wording).

## 5. Verified, no change needed
- iPhone touch guards: ui-touch-test passes, including the throw edge band (drag a Frag to the screen edge, thumb
  cancelled 16 ms later: kept, the grenade still went, a new thumb takes the kept stick), before and after the HUD
  layout change.
- VTOL, Napalm and SAM through the streak camera test: each is up in the sim after the call (VTOL in the gunships,
  SAM in the turrets, Napalm's run or its fuel) and the camera never leaves the player.
- Save code SY4, botpool seed and tag order: untouched.

## 6. Tests changed
1. ui-overflow-test: Campaign tab (its station labels hang below their buttons by design: only the screen edge counts
   for them), Starfall tab and finale briefing, Conquest and Breakthrough picked, Loadouts with Overkill (new gallery
   scenes in dev/ui-gallery.html), the five new guns on the bench, a **broken word** check (a word split across lines
   without a hyphen; not when the run is truncated with an ellipsis or clamp), `--scenes a,b`, failures printed as
   found.
2. ui-replay-test: BR / zombies overview vs follow at five fixed points, paused; the clip delete's confirm via the DOM;
   cap clears leftover clips.
3. ui-streak-cam-test: VTOL / Napalm / SAM "up" checks and shots; the radar check never picks two Ghosts.
4. ui-sweep-perf: cq, bt, cqcity, btcity, zm20saltmere, cpfinale; cpboss picks Nightrail first.
5. ui-sweep-play: the 16 districts, Saltmere, Conquest / Breakthrough cases; the Custom tap through the DOM; longer
   boot waits.
6. ui-sweep-shots: the 1122 screens, 667x375, the Standard tab before the Spotlight, broken words reported.
7. ui-results-test, ui-trophy-test: stale lists and counts; trophy edge checks wait out the slide-in.
8. ui-tourney-test: taps close a late Unlocked summary and retry.
9. ui-sweep-net: every vote card is the case's map and mode, waits poll on a 500 ms timer and are three times longer,
   `NET_TRACE=1`.

## 7. Open
- ui-sweep-net under heavy load: one full run saw the guest take over as host while the old host was still there
  (its page starved for seconds; "You took over as host" on one page, both pages still in the match). The game's
  heartbeat timeout reads a long stall as a dropped host. On a phone that is a host frozen for seconds (a call, the app
  backgrounded); worth deciding whether the old host should yield cleanly when it comes back. Runs with less load pass.
- Conquest / Breakthrough triangle peaks (section 3).
- Sweep C's ui-destruction-test: the frag-at-crate check polls 6 s of wall clock; under load the frag can go off just
  after (the crate did break).
- Merged dev at the end: already up to date (dev still at 1122-10).
