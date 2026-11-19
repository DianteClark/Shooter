# Progress reset (ROADMAP item 41)

The owner asked for a full progress reset: a hard wipe of every player's progress, on every phone, with no way back.
Everyone starts again from level 1 together; device settings stay.

## The epoch
js/shared/reset.js holds it, in one place:
- `PROGRESS_RESET = '2026-11-19'`, `RESET_AT` (that day, 00:00 UTC, in ms), `RESET_GEN = 1`.
- `switchyard.resetGen` in localStorage is the generation this phone last wiped for.
- Another full wipe some day: bump `RESET_GEN` (and the date). Nothing else needs to change for the wipe itself.

## On app start
js/main.js imports js/ui/wipe.js first; it imports nothing that touches storage, so it runs before any module reads
the save, the stats tracker, friends or options at load. `wipeProgress(localStorage)`:
1. If `switchyard.resetGen` is `RESET_GEN`, nothing happens (every later start).
2. Otherwise every key below is removed, and so is any other key under the `switchyard.` / `switchyard-` prefix that is
   not kept (so a key added later, a tournament or a new tracker, can never slip through). Keys of other sites or apps
   on the origin are not touched.
3. The options key stays, with its `recall` entry (remembered menu picks) emptied.
4. If anything was removed, `switchyard.resetNotice` is set (the title's one-time notice). A brand-new phone had
   nothing to lose and sees no notice.
5. `switchyard.seenBuild` is set to the running build, so "What's new" stays quiet: the notice speaks instead.
6. `switchyard.resetGen` is set to `RESET_GEN`. A store that throws (private mode, full) leaves the generation unset,
   so the next start tries again.
7. Whenever the wipe ran (`ran` in its result), js/ui/wipe.js also deletes the IndexedDB databases in `WIPE_DBS`:
   `switchyard-clips`, the saved replay clips (docs/REPLAYS.md). The delete is queued ahead of any later open, so no
   old clip is ever read. Add any future IndexedDB database that holds progress to `WIPE_DBS`.

`window.__game.wipe` (with `?debug=1`) is `{ wiped: [keys], notice }` for this start.

## Keys wiped
Found by grepping `localStorage` and the key constants across js/ (the vendor scripts do not use storage):

| Key | What it held | Written by |
| --- | --- | --- |
| `switchyard.save` | the save: name, XP, prestige, weapons, loadouts, unlocks, mastery, Pro, cards, skins, emblems, career totals, season track and ranked SR/placements, records (Trophy Case), Graveyard Shift bests and feats, finishers, first-run flags | js/ui/progress.js |
| `switchyard.progress.v1` | the v1 save, kept as a backup after migration | js/ui/progress.js |
| `switchyard.save.bad` | a save that could not be read | js/ui/progress.js |
| `switchyard.save.bak` | the save an import replaced | js/ui/progress.js |
| `switchyard.challenges` | daily, weekly, season and event challenge state | js/ui/progress.js |
| `switchyard.history` | match history | js/ui/progress.js |
| `switchyard.friends` | friends' career cards (Friends boards) | js/ui/progress.js |
| `switchyard.gunstats` | the gun stats tracker | js/game/telemetry.js |
| `switchyard-seen` | new-unlock dots already seen | js/ui/newdots.js |
| `switchyard.custom.v1` | operator field-skin picks | js/ui/operators.js |
| `switchyard-mods` | solo match modifiers picked | js/ui/modifiers.js |
| `switchyard-botmatch` | Custom bot match settings | js/ui/botsettings.js |
| `switchyard-training` | Training picks | js/ui/playscreens.js |
| `switchyard.eventSeen` | weekly event banner shown for the week | js/ui/eventbanner.js |
| `switchyard.seasonSeen` | season banner shown for the season | js/ui/eventbanner.js |
| `switchyard.seenBuild` | "What's new": last build seen (rewritten to the running build) | js/ui/whatsnew.js |
| `switchyard-last-room` | last room, for Rejoin | js/main.js |
| `switchyard-player` | this device's player id (rejoin slot, friends' cards key) | js/net/star.js |
| `switchyard-backdrop` | the title backdrop's map rotation | js/ui/backdrop.js |
| `switchyard.clan` | this phone's player clan (tag, name, colour, mark) | js/ui/progress.js `Clan` |
| `switchyard-options` `recall` entry | remembered menu picks: Multiplayer tab and playlists, Custom map and mode, squad size, last Graveyard map | js/ui/recall.js |
| any other `switchyard.*` / `switchyard-*` key | tournament state or anything added later | (prefix sweep) |

The player name lives in the save, so it goes with it; the callsign is asked again the first time they play.

## Keys kept (device settings)
| Key | What it holds |
| --- | --- |
| `switchyard-options` | graphics quality, sound, music and voice volumes, aim stick and aim assist, left-handed, HUD size, touch layout, accessibility (colour mode, text size, calm, cues), controller mapping, deadzone and sensitivity, haptics, full screen, damage numbers, squad tag, the Hardcore switch, voice mode |
| `switchyard-quality` | the Auto graphics governor's settled step |
| `switchyard-gpu` | this phone's GPU name, for that governor |
| `switchyard.tuning.v1` | the hidden tuning panel's control and camera values |
| `switchyard.tuner.ui.v1` | where that panel docks |
| `switchyard.resetGen`, `switchyard.resetNotice` | the reset's own marks |

## The notice
js/ui/resetnotice.js, on the first title after a wipe that took something: "Fresh start: all progress has been reset
for everyone. Your settings were kept." It is marked seen as it shows (a reload never shows it twice). Got it goes on
to the usual first-run flow: the training offer, then the callsign the first time they play.

## Save codes
Codes carry the generation: `SY4R1.<body>.<checksum>`, and the checksum covers `R1`, so an old code cannot be dressed
up by editing its header. The body is unchanged (append-only). `decodeSave` refuses a code with no generation (any
SY2, SY3 or plain SY4 code) or an older one with error `reset`; the save screen says "This code is from before the
reset. All progress was reset for everyone, so it cannot be loaded." A build from before the reset reads a new code as
not a save code. Dev tests that check old codes still migrate pass `{ preReset: true }`; the game never does.

## Bots, boards, seasons and ranked
- js/shared/botpool.js: careers accrue from `CAREER_START = RESET_AT` and every profile's base career is zero, so on
  the reset date every bot is level 1 with no matches, kills, wins, mastery or extractions, and grows day by day at the
  same rates as before (deterministic on every phone). `POOL_SEED`, `POOL_EPOCH`, the tag order, the rates and every
  profile (habits, skill, looks) are unchanged; matchmaking skill (`mu`, `form`) is the same, so bots play as well as
  before. `looksAt` shows a bot's card, skin, camo and emblem only once its new career backs them (plain on day one).
- Boards (js/shared/boards.js): the pool's rows, weekly and season windows and ranked SR all come from `careerAt`, so
  on day one everyone reads level 1 with zeros, nobody is on the K/D board (25 matches) or the Ranked board (not
  placed), and a player's first kills put them at the top. Placements come back as bots play.
- Seasons: the current season continues by date (its calendar does not move). Each player's season track, tiers,
  claimed rewards, ranked SR, placements and carried base were in the save, so they start fresh; bots' season windows
  count only days since the reset.
- Trophy Case: reads only this phone's save, so it starts empty ("Nothing rare yet").

## Tests
- `python3 dev/ui-reset-test.py [port]`: seeds a phone as an old build left it (rich save, stats, history, friends,
  challenges, dots, picks, event marks, last room, an unknown future key, options with menu picks, the governor, the
  tuning panel, another app's key), loads the new build: everything but the settings is gone, the notice shows once
  and leads to the training offer, an old code is refused with the message, a new code imports and round-trips byte
  for byte, a reload does not wipe again, a brand-new phone sees no notice.
- `node dev/sim-botpool.mjs`: every profile unchanged by the reset (hash of all but `base`), careers since the reset
  pinned by hash, every career zero on and before the reset date, non-decreasing over two years, looks plain on day one
  and kept once earned, a day-one lobby is level 1 bots at their usual skill.
- `node dev/sim-boards.mjs`: the reset section: day-one rows, boards and ranked, a week on, placements returning.
- UI tests that clear storage mid-run set `switchyard.resetGen` again so their reload does not count as a pre-reset phone.
