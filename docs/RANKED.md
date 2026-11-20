# Ranked seasons, the caster camera and replay codes (ROADMAP item 60)

Built on the ranked play and seasons of items 21 and 22 (docs/SEASONS.md) and the match replays of docs/REPLAYS.md.
No server: seasons, ratings and rewards are worked out on each phone from its own date and results; spectators watch the
host's snapshots; a replay code is the whole replay.

Tests: `node dev/sim-ranked.mjs [quick]` (season, SR, rewards, bots, replay codes, the caster's pure parts);
`python3 dev/ui-ranked-test.py [port] [hub] [code] [caster] [spec] [--shots]` (screenshots to /tmp/ranked).

## Seasons
- Season number, dates and the countdown come from `seasonAt()` (js/shared/seasons.js): Season 1 Cold Iron to Dec 27,
  Season 2 Signal Fire from Dec 28, then Season Replay. Ranked runs per season instance (`S1`, `S2`, `S1R1`, ...).
- Placements: 5 matches (wins and losses shown as pips on the hub). The first season places from your usual rating;
  later seasons from the soft reset.
- Soft reset: at the rollover, three quarters of the SR (`CARRY` 0.75, capped at Diamond III) becomes the base for the
  next season's placements (`carriedSr(rk)` previews it on the hub). Unplaced players keep an older base, if any.
- Divisions: Bronze, Silver, Gold, Platinum, Diamond, Master (900 SR each, tiers I-III), Champion 5,400+. Icons:
  `rankBadge(code)` in js/ui/season.js (a cut shield in the division's colour, one to three bars, Champion's crown).

## End-of-season rewards
Paid on the season's peak division when the season rolls over (`rollover()` writes `rr[seasonId]`); ownership is
derived from `rr`, so nothing can be paid twice and the save stays small.

| per division reached (every division up to the peak) | id | added in |
|---|---|---|
| calling card | `card:rk-s<n>-<division>` | items 21/22 |
| crest emblem | `emblem:rk-s<n>-<division>` | items 21/22 |
| title | `title:rk-s<n>-<division>` | this item |
| the season's ranked camo, Gold or higher (`RANKED_CAMO_DIV` 2) | `camo:rk-s<n>` | this item |

- Titles (`rankedTitles(def)` in js/shared/season-items.js): Bronze Brawler, Silver Striker, Gold Vanguard, Platinum Ace,
  Diamond Virtuoso, Master Tactician and `<Season name> Champion`. One is worn (`save.season.tl`, kept only while set,
  so a save without one and its code are exactly as before); it shows on the title's profile card, the hub, and the
  lobby car (`badge.tl`, checked against `TITLE_IDS` on the way in; older builds ignore it).
- The ranked camo (`rankedCamo(def)`): the season's theme colours in the animated gold pattern, every gun, appended to
  `CAMOS` after the tournament camo (peers send camo ids, not indices). One per season keeps the shader's uniform
  arrays small (each camo is five vectors in the fragment shader).
- Save code SY4: nothing reordered. The season block (entry 19) gains the optional `tl`.

## The ranked hub
The Season screen's Ranked tab (js/ui/season.js `rankedPane`, css/ranked.css): your badge, division, SR and the bar to
the next tier (placement pips while placing), wins, losses, best, the worn title (tap: the title picker), Play Ranked;
then the season and its countdown (two units, refreshed every 30 s while the screen is up), the soft reset preview, the
rewards track (seven columns: badge, SR floor, card, crest, the camo on Gold, the title; reached and current marked,
a marker where your SR sits) and the rules. Opened from the title's Season chip (Ranked tab) or
`menu.season({ tab: 'ranked' })`.

## Bots in ranked
A ranked match's pool bots wear the division of their SR on the Ranked board (`poolSr()` in js/shared/boards.js, from
`botSr`, a function of the date): `rankedBots(roster, srOf)` sets `badge.rk` (-1 while the board has them in
placements) and `rankSr`, which the lobby-strength part of the SR change reads. So the lobby, the boards and the hub
agree. js/shared/botpool.js is untouched (`POOL_SEED`, tags and their order unchanged).

## The caster camera (js/game/caster.js, js/game/caster-core.js)
For a friend room's spectators and for players out of play (out for the round in Search and Destroy, Control,
Showdown, a Graveyard Shift bleed-out, out of a battle royale or an extraction: whenever `spectate.target` has someone
to watch). A **Caster cam** button shows then; the caster closes itself when you are back in play.
- Cameras: **Follow** (the match camera's angle over one player; Next / Previous, a tap on the list; a followed player
  who dies hands over to the next after 1.6 s), **Tactical** (high, framing everyone in play, 56 to 96 m), **Free**
  (drag to pan, pinch or + / - to zoom, 22 to 90 m). Every change eases (`aimShot`), no cuts.
- The player list (side, name, kills-deaths and score, an HP bar; dead dimmed), its own kill feed, who is on camera.
- Controller (it takes the pad, `Pad.owner`): LB / RB previous / next, Y camera, X list, B close, sticks pan, triggers zoom.
- How it drives the picture: the killcam calls `direct()` whenever it is not playing a replay, which hands the renderer
  the caster's cinematic shot (`renderer.setCinematic`); a death replay still plays first. HUD hidden (`body.caster-on`).
- Fairness: a cinematic has no fog of war, so the caster sees everyone. It is off in Ranked for players out of play
  (and in Training, the tutorial and the range): `match.caster.canOpen`.
- Performance: no allocation per frame (one shot, a reused list array and row pool); the list repaints five times a
  second and only the cells that changed; the feed on kills only. Tactical and free keep a world distance cut (80 to
  120 m). Measured with dev/ui-ranked-test.py caster (SwiftShader on the shared 2-core machine: see the printout).

### Spectator seats (js/game/spectator.js)
In a friend room a guest taps **Watch** in the lobby (a `{t:'spec'}` message; the car says Watching). The host leaves
spectators out of the roster (and out of the Ranked room count and team seats); the start message reaches them anyway
and they watch the match: `SpectatorMatch` decodes the host's snapshots and events (sent to every guest in the room)
with the caster camera open, the sound's listener on the camera. Nothing is simulated or sent from the spectator.
Leave, or the match ending, goes back to the room (marked ready for the next one). Limits: the host cannot spectate;
a spectator is never elected host if the host drops mid-match (it has no sim; the room's match is lost as it would be
with no guest left). Joining a match already running still takes a free slot or is refused as before.

## Replay codes
See docs/REPLAYS.md, "Replay codes". `SYR1.<body>.<checksum>`; the replay player's Share makes one (a highlight or the
whole clip), History > Clips > Replay code plays one.
