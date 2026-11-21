# Bug sweep B, 2026-11-20

Scope: the 1120 wave (builds 1120-1 to 1120-13: Wrenfield, melee and gun art, operators, zombie models, Jadefall and
its Ground War maps, the co-op campaign, ranked hub / caster camera / replay codes, Launchpad, Observatory, Pagoda,
Season 3, music and sound, the animation pass, the world art pass, help videos and accessibility). Branch `sweepB`.
Sweep A ran node sims and the first half of the UI tests alongside on the same two shared vCPUs (load average 11 to 21
the whole time), so every failure was retried before it counted and timings only compare within a table. The session
was cut three times by server restarts; work resumed from the commits.

The theme of the day: under this load the solo sim runs well behind the wall clock (a 5 s radio tune took over 12 s, a
20 s match several minutes), so most "failures" were waits sized for a quiet machine. Those waits now wait on game
state for longer (a pass still returns at once), and taps on screens that animate go through the DOM.

## 1. Every test

| test | first run | after fixes / retry |
|---|---|---|
| ui-mastery-badges-test | pass | |
| ui-modes2-test | Rebound and Showdown timeouts (load) | waits on sim state lengthened, Skip clicked through the DOM; pass |
| ui-music-test | pass | |
| ui-overflow-test (667x375, 932x430, all sections) | a gallery scene never became ready in 40 s (load), run cut | scenes get 120 s; rerun: 666 states, no spill or cut; the gunsmith scroll checks failed because the walk's last tap on a locked part leaves its unlock sheet open over the bench (test 11); `--only gunsmith` at both sizes: pass |
| ui-prestige-test | pass | |
| ui-qol-test | 2 fails | **real bug** fixed (game 2), friend room stabilised (test 3); pass |
| ui-ranked-test | pass | also hub + caster at 667x375 and 932x430 with shots (new `RK_SIZE`): pass |
| ui-replay-test | tdm/cap/zm timing fails, BR overview triangles | cap: Unlocked summary (test 1); results wait follows sim time; full run then tdm+pad rerun: all pass. The BR overview check depends on where the record is (172k, then 20k on a rerun; Frontier's world triangles are identical before and after the Jadefall work, see Perf) |
| ui-reset-test | pass | |
| ui-results-test | match end 120 s timeout (load), then a stale map list | waits 360 s with a state dump; ranked's medium maps include Observatory and Pagoda (test 7); pass |
| ui-snd-test | pass | |
| ui-streak-cam-test | pass | |
| ui-sweep-fresh | Menu under the Unlocked summary | test 1; pass |
| ui-sweep-net | pass (TDM, Graveyard Shift, BR with host migration) | |
| ui-sweep-perf | brjade timed out waiting for the plane (load) | BR waits 180 s; all 16 cases measured (section 3) |
| ui-sweep-play | (26 cases, PLAY_S=20) | **26/26 clean**, incl. 12 new 1120 cases (section 2) |
| ui-sweep-shots | 54 screens, all ok | |
| ui-touch-test | pass | |
| ui-tourney-test | "reel stamps the round" stale, then a tap under the Unlocked summary | test 2; pass |
| ui-trophy-test | stale counts (6 zombies maps, 15 feat emblems); one "past the edges" at 667 | counts updated; the edge check passed on the rerun (flaky); pass |
| ui-viewport-test | match start 40 s (load) | 120 s; pass |
| ui-voice-test | pass | |
| ui-zm-bodies-test | pass | |
| ui-zombies-test (full) | Polestar "radio never locked on", "crate never offered"; Ashgrove first-click timeouts (earlier today) | **not real**: the radio did lock on and the crate did offer, seconds after the waits gave up (the screenshot shows 1/3 Radios and the feed line); the first click timed out while the page was still booting. Waits x3, 90 s default tap timeout: full run pass |
| dev/wpn-feel-test.py (full) | the first tap hung at "performing click" (page busy booting under load) | 120 s default timeout; full run (61 guns, staged reload, low ammo, dry fire, shots per class): PASS |

## 2. Play-throughs and screens
- `dev/ui-sweep-play.py` gained the 1120 cases: Launchpad (TDM, Dom, SnD), Observatory (TDM, HQ, KC), Pagoda (TDM,
  CTF, FFA), Jadefall BR, Tidebreak Ground War TDM, Coral Quarter Ground War Dom. Run at PLAY_S=20 with Multiplayer
  Ranked, Quick Play, Ground War, BR Quads (rolled Jadefall), Extraction Quads (Jadefall), Zombies, Graveyard Shift on
  Polestar and Wrenfield, five weekly event weeks and the weekend tournament: 26/26 clean (no console errors, no HUD
  off screen, XP lines and challenge rows match the save, the save survives a reload).
- Menus reviewed at 667x375 and 932x430 on three clock dates (today, 2027-02-10 in Season 3, 2027-03-23 in Season
  Replay) with the overflow test's text check: title, Campaign tab, a locked station, the briefing, Season Track /
  Weekly / Ranked, Help Videos, Accessibility. No spills or cuts except the Campaign map's station labels, which the
  checker flags because they hang below their button by design (absolutely placed, pointer-events none); they read
  whole on screen. The ranked hub, titles picker and caster camera (follow, tactical, free, list) at both sizes via
  ui-ranked-test shots: no overlaps or clipped text.
- Found: Help > Videos at 667 wide cut both Battle Royale titles to the same "BATTLE ROYALE..." (game 3).

## 3. Performance (`dev/ui-sweep-perf.py`, 932x430, Low pinned, medians over 12 s, max in brackets)
Budget (docs/ARCHITECTURE.md): under 120 draw calls. docs/BR-PERF.md's reference: Harvest draws 71k triangles; host
sim tick budget 33 ms (not measured here; sweep A runs the node sims).

| case | calls | triangles | script ms | 2026-11-18 sweep |
|---|---|---|---|---|
| TDM, Railyard | 31 (38) | 64k (81k) | 8.7 | 33 / 58k (11-12) |
| TDM, Millbrook | 32 (37) | 42k (61k) | 9.2 | 38 / 62k |
| TDM, Launchpad (new) | 30 (35) | 60k (70k) | 9.3 | |
| TDM, Observatory (new) | 33 (38) | 71k (84k) | 9.8 | |
| TDM, Pagoda (new) | 32 (39) | 46k (57k) | 12.6 | |
| Ground War TDM, Harvest | 46 (50) | 88k (110k) | 16.8 | 41 / 46k |
| Ground War TDM, Tidebreak (new) | 39 (44) | 52k (66k) | 17.3 | |
| Ground War TDM, Coral Quarter (new) | 24 (36) | 13k (38k) | 19.0 | |
| BR Quads, Frontier, on the ground | 36 (42) | 51k (52k) | 7.2 | 43 / 43k |
| BR Quads, Jadefall, on the ground | 42 (47) | 55k (57k) | 5.2 | |
| Graveyard Shift r20, Ashgrove | 56 (60) | 66k (70k) | 20.6 | 58 / 116k |
| Graveyard Shift r20, Night Market | 60 (67) | 84k (103k) | 20.1 | |
| Graveyard Shift r20, Polestar | 59 (63) | 77k (82k) | 19.6 | 59 / 126k |
| Graveyard Shift r20, Wrenfield (new) | 54 (57) | 70k (74k) | 22.9 | |
| Campaign mission 8 at the boss (new) | 44 (45) | 87k (91k) | 15.6 | |
| Replay playback, Railyard TDM | 22 (24) | 71k (74k) | 3.4 | 17 / 49k |

Every case is far inside 120 calls (worst 67). Script ms is about twice the 11-18 sweep across the board, which is the
load (11-18 ran at 12 to 17, this at up to 21), not the code: the same cases moved together. Harvest's triangles
(88k vs 46k) looked like a world art regression, so I measured the world mesh at 1120-11 against today on the same
spawn: 58.2k vs 59.1k triangles and the same calls; what the camera sees in a 12 s sample swings with where the player
walks and how many soldiers are on screen (a second probe: 69k drawn at 1120-11, 42k today). Likewise Frontier's
world triangles at eight fixed overview and follow cameras are identical before and after the Jadefall work (189k /
110k summed both times). The campaign boss's new look costs one draw call (the crest).

## 4. Fixed (game)
1. **Campaign: Marshal Kordell did not stand out from his guard** (open item 2; only the Juggernaut overlay marked
   him). He is now a fifth bigger (characters.js `bossLook`, a scaled copy of his operator's build keyed on the view
   record's `cpRole` 5, so stance, limbs and head scale together), his suit is gilded with a crimson pulsing visor
   (combat.js), and cp-fx.js draws a gold five-point crest turning over his head, a crimson beam on him (the boss step
   had no objective beam) and a crimson ring breathing at his feet. One extra draw call (the crest mesh, only while he
   stands); the beam and ring come from the existing instanced pools. ui-campaign-test checks the crest sits over him;
   docs/CAMPAIGN.md updated. Screenshots at 932x430 and 667x375 read him at a glance among four guards.
2. **A Battle Royale challenge's Play button opened the weekly event** (this week's event is a BR twist): the
   shortcut's filter skipped `p.event` but the event playlist carries `wkevent`. It now skips both (js/ui/shortcuts.js).
3. **Help > Videos titles cut to one line**: at 667 wide "Battle Royale: drop and loot" and "Battle Royale: plates,
   circle, revive" both read "BATTLE ROYALE...". Titles now wrap to two lines before an ellipsis (css/menus.css).

Changelog: one NEXT entry with the three.

## 5. Verified, no change needed
- **iPhone touch guards** (open item 3): intact after the music and sound work. audio.js `_onGesture` returns on a
  touchend with other touches down; wakelock.js, voice.js (`resumeTouch`) and main.js's unlock all check
  `!e.touches?.length`. The new music module (js/audio/music.js) listens to pointerdown/keydown only to mark input for
  the idle calm, and only changes gains on the already-running context: it starts no media and resumes nothing. The
  help videos are in-engine (no media elements). android.js's touchend fullscreen is Android-only.
- **ui-zombies-test Polestar / Ashgrove** (open item 1): load, not the game (section 1).

## 6. Tests changed
1. The results' **Unlocked summary** (since 308dd12, 11-19) opens over the results after the reel with its own Menu and
   Rematch, so taps on the results' buttons landed on it: sweep-fresh, -shots, -play, -perf, replay and tourney now let
   the reel finish (Skip) and close the summary (Continue) first.
2. ui-tourney-test: only a cup won gets the full stamp now (one big reveal per match); a round won is a tile in the
   summary ("Team Cup: round won"), which the test reads.
3. ui-qol-test: the friend room's vote is set to a TDM on Railyard (a random card could be a BR, which the 12 s limit
   never ends); parts run by name (`python3 dev/ui-qol-test.py PORT friend_room`); a state dump if results never come.
4. ui-zombies-test: every short state wait x3, a 90 s default tap timeout.
5. ui-trophy-test: six Graveyard Shift maps, 15 feat emblems.
6. ui-modes2-test, ui-viewport-test, ui-results-test, ui-replay-test, wpn-feel-test, ui-overflow-test, ui-sweep-perf:
   longer waits on game state / page boot under load (results and modes2 dump the state on a timeout).
7. ui-results-test: ranked's medium maps include Observatory and Pagoda.
8. ui-sweep-perf: cases for Launchpad, Observatory, Pagoda and the campaign boss (from the Campaign tab).
9. ui-sweep-play: the 1120 maps (section 2). ui-ranked-test: `RK_SIZE=WxH`, shots named by size.
10. ui-campaign-test: the boss's crest check (pass).
11. ui-overflow-test: the gunsmith scroll checks close the unlock sheet the walk leaves open first.

## 7. Open
- Nothing failing. Load-only flakes seen once and passing on a rerun: ui-trophy-test's "still nothing past the edges"
  at 667 (16 nodes, once), ui-replay-test's playback-rate and clip-time checks (wall-clock based; they pass when the
  machine has a moment).
- ui-replay-test's BR overview check ("2.5x the follow camera's triangles") compares two cameras at wherever the
  record happens to be, so it can fail on a busy spot (172k vs a 14k follow shot) and pass on the next run; worth
  making it compare fixed positions.
- The Campaign map's station labels hang outside their buttons by design; if the Campaign tab joins the overflow
  test's gallery scenes, the checker needs to allow them.
- Merged dev (1120-14, sweep A's fixes) at the end: the changelog stacked (NEXT above 1120-14); rerun after the merge:
  the boss look script (crest over him at both sizes, no console errors) and ui-campaign-test.
