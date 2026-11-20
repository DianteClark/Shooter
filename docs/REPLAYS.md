# Match replays

After a match, the results screen offers **Watch replay**: the last 30 seconds of the match, as this phone saw it, played
back in the match renderer with play/pause, a scrub bar, 0.5x / 1x / 2x and three cameras. **Save clip** keeps it on
the phone (up to 5), and History's **Clips** tab plays or deletes them.

## Pieces
| file | what |
|---|---|
| js/game/replay.js | `ReplayRecorder` (the rolling record), `ClipReader` (rebuilds views from a clip), `packClip` / `unpackClip` (storage form) |
| js/game/match.js | records every frame (`recorder.record(view, events, dt)`, beside the killcam) and hands `results.replay` (the clip) to main.js |
| js/game/replay-player.js | `ReplayPlayer`: its own `GameRenderer` on the game canvas, the controls layer, cameras, names, kill feed, the controller map |
| js/ui/clips.js | IndexedDB store `switchyard-clips` (stores `meta` and `data`), `MAX_CLIPS` 5, `CLIP_MAX_BYTES` 4 MB |
| js/ui/results.js | the Watch replay button on the final kill card |
| js/ui/history.js | the Matches / Clips tabs; Clips: map, mode, date, length, your kills, Watch, Delete (tap twice) |
| js/main.js | `openReplay(clip)`, `watchClip(id)`: stops the yard backdrop, hides the menus (`body.replay-on`), and gives the canvas back on Close |
| js/ui/gamepad.js | `Pad.owner`: while a replay plays it takes every press |
| js/shared/reset.js, js/ui/wipe.js | `WIPE_DBS`: the progress reset deletes the clips database (docs/RESET.md) |
| css/replay.css | the player's layer and the Clips tab |
| js/game/replay-code.js | replay codes: `encodeReplay` / `decodeReplay` / `highlightRange` (see Replay codes below) |
| js/ui/replaycode.js | the Share sheet (replay player) and the Replay code sheet (History > Clips) |

## Recording
What is recorded is exactly what the renderer was fed: the interpolated view (`Match.frame`'s `view`, with the local
player overlaid) and this frame's events, so it works the same on a host and a guest and in every mode.
- **Events**: every frame, those the renderer or the feed reacts to (shots, hits, kills, explosions, throws, streaks,
  emotes, spawns...) go into a ring of 4,000 by reference (decoded events are never mutated afterwards; the killcam
  relies on the same). Ground War at full tilt is about 120 a second, so 30 s fit.
- **Keyframes at 15 Hz**: each player quantised into 20 Int16 values (position 1/32 m, aim, velocity, hp, state flags,
  ADS, reload, heat, weapon and camo as indices into a string table, side, glide, zombie kind, armour) in a
  preallocated `Int16Array`; names and attachments live once per player in a cast table. Grenades, smokes, turrets,
  aircraft, drones, deployables, tags, objectives, scores and the battle royale circle and transport are kept by
  reference (each belongs to one decoded snapshot; lists capped at 64). Finishers keep their state per keyframe.
- **Bounded**: 458 keyframes x 40 players x 40 bytes = 715 KB preallocated, plus the event ring. Nothing grows.
- **Busy modes**: at most `MAX_REC` = 40 players a keyframe. Over that (or with a lower cap), the record keeps you,
  everyone in a kill of the last 4 s (so the killer of the final kill is always there), then the nearest; players more
  than 90 m away are skipped first. Battle royale (32) and Graveyard Shift round 20 (28 with the horde) fit under 40
  today; the selection is tested with the cap lowered to 16.
- Recording stops 1.2 s after the match ends (the final kill's aftermath), so the final kill replay's hold is not
  recorded. `finish()` copies the last 30 s into one contiguous clip (typed arrays plus the extras) for the results.

### Cost (dev/ui-replay-test.py, headless Chromium, 2 shared vCPUs)
`recorder.stats` times every `record()` call:
| case | players | mean per frame | worst frame |
|---|---|---|---|
| TDM Railyard 6v6 | 12 | 0.05 ms | 1.2 ms |
| Battle royale Frontier | 32 (16 kept) | 0.03 ms | 0.5 to 0.9 ms |
| Graveyard Shift round 20 | 28 (16 kept) | 0.04 to 0.09 ms | 0.5 to 1.7 ms |

The worst frames are GC or timer noise on this machine (the keyframe itself is a few dozen microseconds).
dev/ui-sweep-perf.py before and after (Low, 932 x 430, median script ms of the perf overlay; two runs each, the noise
between runs is larger than any difference):
| case | before | after |
|---|---|---|
| tdm (Railyard) | 4.4 / 4.5 | 4.2 / 4.0 |
| gw (Harvest, 16 a side) | 5.3 / 5.1 | 6.5 / 5.2 |
| br (Frontier, on the ground) | 4.3 / 6.8 | 4.8 / 4.6 |
| zm20 (Ashgrove round 20) | 6.0 / 6.5 | 6.0 / 5.5 |
Draw calls and triangles are unchanged (recording draws nothing).

## Clip format
`finish()` returns (and the player reads) one object:
`{ v, hz, stride, at (Date.now()), localId, mapId, mode, mods, myTeam, roster (slim: operator, skin, tracer, kill
effect), cast [{id, name, att}], strings, dur, frames { at Float32Array, n Uint8Array, data Int16Array }, x [extras per
keyframe], fins [[keyframe, slot, fin]], evAt Float32Array, ev [events], lastKill { by, target, at, weapon } }`.

Stored (`packClip`): the typed arrays as they are (IndexedDB stores them natively), the per-keyframe extras as indices
into a table of distinct JSON values (objectives and scores repeat from keyframe to keyframe), events and the cast as
JSON. Measured: TDM 6v6 24 s about 265 KB, battle royale about 270 to 440 KB, Graveyard Shift round 20 about 100 to
140 KB. A clip over 4 MB is thinned (a shotgun's pellets to one tracer, then every other shot) or refused.

## Playback
`ReplayPlayer` builds a `GameRenderer` for the clip's map, sets the roster's looks, and drives it the way the killcam
does: a rebuilt view (`ClipReader.sample(c)` blends the two keyframes around clip time `c`), the events between the last
frame and this one, and a cinematic shot (`renderer.setCinematic`) it aims itself. In a cinematic the renderer treats
nobody as "you": no fog of war, everyone shown, no hurt flashes. `shot.rate` is the speed (0 paused), so effects and
animation slow down, stop and speed up with the clip. A seek clears what was in the air (`vfx.clear`,
`chars.resetTransient`, `combat.reset`) and moves the event cursor.

Cameras (the match camera's 55 degree tilt):
- **You**: the match camera's distance over your player.
- **Killer**: over the killer of the final kill (`clip.lastKill.by`; greyed out when there was none).
- **Overview**: about twice as high (64 m, wider lens), dragged with a finger or pushed with either stick.

The follow cameras keep the quality step's world distance cut (`shot.cut`, a small renderer hook); the overview uses
an 80 m cut. HUD: the replay tag, names over heads (at most 14), the kill feed of the last 6 s, kill ticks on the scrub
bar (yours gold, your deaths red).

Measured on Low (as docs/BR-PERF.md; two runs, the numbers depend on where the record is): battle royale follow camera
13 to 35 calls / 9k to 57k triangles, overview 24 to 42 / 14k to 68k (the match itself, dev/ui-sweep-perf.py: 37 to 42
/ 43k to 45k); Graveyard Shift round 20 follow 44 / 108k to 140k (the match: 57 to 61 / 130k to 135k), overview 50 to
55 / 174k. Playback script time per frame, renderer included: 2.8 to 3.1 ms TDM, 4.2 to 5.1 ms battle royale, 5.6 to
6.0 ms Graveyard Shift (SwiftShader, CPU side). The auto quality governor runs in the replay as in a match.

Controller: A or Menu play/pause, B close, X save, Y next camera, LB/RB speed, d-pad left/right 5 s, LT/RT hold to
rewind / fast-forward, sticks pan (switching to the overview). Touch: every control is a button; the scrub bar takes a
press and drag (the picture follows, paused, while dragging).

## Lifecycle
- The results screen stays mounted under the player (hidden by `body.replay-on`); Close shows it again exactly as it
  was. The final kill turntable pauses meanwhile (`menu.pausePreview` / `resumePreview`).
- A match starting (a rematch countdown, a host starting) closes the player first. The yard backdrop never starts
  while a replay owns the canvas.
- `app.renderer` points at the replay's renderer while it plays, so resizes, the Graphics option and the perf overlay
  (`?fps=1`) follow it.

## Replay codes (ROADMAP item 60)
**Share** in the replay player makes a text code of the clip: the **Highlight** (the 8.5 seconds around the final kill,
`highlightRange`) or the **Whole clip**, copied or sent with the system share sheet. Another phone pastes it in History >
Clips > **Replay code** and watches it in the same player (title "Shared"; Save keeps it as a clip). No server: the
code is the replay.

Format `SYR1.<base64url>.<checksum>` (fnv-1a over `SYR1.<body>`, base 36, as the save code). The body is deflate-raw
(`CompressionStream`, Safari 16.4+) of one binary record, column by column so deflate finds the repeats:
- a JSON header: map, mode, modifiers, rate, length, which cast member was "you", the final kill, the title, and the cast
  (name, side, operator, skin, tracer, kill effect, bot) and the string table (weapons, camos);
- keyframes at 10 Hz (the clip keeps 15) as five streams: heads (gap, count, cast index), flags (alive, sprint, slide,
  spawn protection, ghost, downed, ADS, and a "changed" bit followed by weapon, camo and side), positions in 1/16 m as
  the error of a straight-line guess from the last two, aim as the turn since last time (256 steps a circle), and
  health as changes;
- objectives and scores as a table of distinct values and an index per keyframe (dropped if huge);
- the events the picture and the feed use (shots with one ray, hits, kills, explosions, bangs, spawns, throws, swaps,
  slides, emotes), ids as cast indices, times as gaps in ms.
Decoding rebuilds an ordinary clip (`ClipReader` plays it): velocities come back from the positions, reloads, heat and
the extras the code leaves out (grenades in flight, smokes, streaks, the battle royale circle) are simply not drawn.

Sizes (dev/sim-ranked.mjs, a real bot match): TDM 6v6 highlight about 4,200 characters, whole 30 s about 10,000
(27 KB before deflate); Ground War 16 a side highlight about 9,500, whole clip about 25,000. The same clip always makes
the same code.

Refused cleanly, with words on the sheet (`CODE_ERRORS`): not a code (`format`), another version (`version`: a new
format bumps the number and old codes are refused, not misread), a cut paste or a typo (`checksum`), a body that does
not read (`data`), a map this build does not have (`map`), over 200,000 characters (`size`), a browser without
`DecompressionStream` (`unsupported`). Spaces and line breaks a chat app adds are ignored.

## Tests
`node dev/sim-ranked.mjs` (code): a recorded bot match to a code and back, players within 0.4 m of where they were,
every kill with its killer, victim and gun, the final kill in the highlight, every refusal, Ground War sizes.
`python3 dev/ui-ranked-test.py [port] code`: Share in the player (highlight and whole), a bad code refused, the code
played as a shared replay.
`python3 dev/ui-replay-test.py [port] [tdm|pad|cap|br|zm]`: a short solo TDM to its results, Watch replay, scrub,
speeds, pause, kill feed, the three cameras, Save, Close back to the results; History > Clips: list, watch, delete; a
fake pad; the 5-clip cap; battle royale and Graveyard Shift with the record's cap. dev/ui-reset-test.py seeds an old
clip and checks the wipe deletes it.
