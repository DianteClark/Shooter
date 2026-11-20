# Tutorial, help videos and first-time tips (roadmap item 63)

Three ways a new player learns the game, all on the phone, no servers: in-engine help videos in Help, the guided
Training match, and a short tip the first time each mode is played. Accessibility depth from the same item is in
docs/ACCESSIBILITY.md.

## Help videos

Short demos played in the real renderer: not recordings, but a seeded bot match run live for 10-25 s with a script on
top. Same seed and script, same pictures, so Replay just builds the match again.

| File | What |
|---|---|
| `js/shared/help-videos.js` | the scripts (`VIDEOS`), `captionAt` / `captionText` / `fillButtons`, `videoProblems` (pure) |
| `js/game/help-director.js` | `HelpDirector`: builds the roster (the star plus bots), the real `Sim`, runs the lead-in, applies the script's moments (no DOM; node runs it) |
| `js/game/help-video.js` | `HelpVideoPlayer`: the renderer on the game canvas, cameras, captions, ghost thumbs, Loop / Replay / Skip, the end card; its CSS rides inside it |
| `js/ui/help.js` | the Videos tab and the Watch chips on cards |
| `js/main.js` | `openHelpVideo(id)`: imports the player on demand, hides Help under it (`body.hv-on`), gives the canvas back |

**Videos** (18): Basics (moving and aiming, sliding and sprinting, grenades and quick throw, scorestreaks), Core modes
(Domination, Hardpoint, Search and Destroy, Kill Confirmed, Headquarters, Capture the Flag), Big modes (Battle Royale
drop and loot; plates, circle and revive on Rebound; Extraction; Graveyard Shift; Campaign), More (Ranked, the Gunsmith
on the firing range, the caster camera).

**A script**: `map`, `mode`, `seed`, `len` (10-25 s), `pre` (seconds run before the first frame: the warmup and any
lead-in, e.g. Rebound's flight), `team` and `skill` for the bots, `star` (the kit of the bot the camera follows, named
"You"), `cam`, `sticks`, `ops`, `captions`.

- Cameras: `follow` (the match camera over the star, `renderer.setLocal`), `wide` (a higher cinematic shot over the
  star, higher still aboard the transport or gliding; once the star is out, a living teammate), `tactical` (the caster
  camera's frame over everyone, `caster-core.tacticalFrame`), `caster` (follows one player; `next` cuts to the next).
- Moments (`ops`, at video seconds): `sprint` (s), `slide` (retries for 1.2 s, running meanwhile, until it starts),
  `lethal` / `tactical` (the throw command along the star's aim; 0 metres is a quick throw), `charge` (streak score to a
  slot's cost), `streak` (call it), `swap`, `cam`, `next`. They go through the doors a phone uses (`applyCommand`,
  `useStreak`) or the star's bot input (a wrapper on its brain's `drive`, re-hooked when a brain is replaced). The
  star respawns quickly in modes that allow it.
- Captions: `[t, touch words, controller words?]`, each shown until the next (at least 2.5 s each). Controller words
  may name actions as `{fire}`, `{slide}`...: with `body.pad-on` they are shown with the bound buttons' names
  (`gamepad.js buttonName(bindingOf(id))`). The caption is `aria-live`, sized by Menu text size.
- Ghost thumbs (`sticks`, the basics): the move stick leans with the star's move input, the aim stick with its aim
  when aiming or firing (red when firing), and Slide / Lethal / Tactical / Streak light when the star does them.
  Labels switch to stick and button names with a controller. Mirrored for the left hand.

**Lightweight**: nothing of the player is fetched until the first Watch tap (`import()`), the scripts are a few KB of
data, the renderer is built per video and disposed on close, and the lead-in runs in 10 ms slices a frame behind a
loading bar, so the menu never freezes (Rebound's 26 s lead-in is the longest, about two seconds on a phone). Frame
cost while playing is a host bot match of that mode plus the renderer, as in a match; nothing runs once closed.

**Controls**: Skip (top right), Escape, or a controller's B / Start close it; Replay (A) starts it again; Loop (Y)
replays it at the end; without Loop the end card offers Watch again, Next video and Done. Help stays mounted under the
video, so closing returns to the same tab. A match starting (an invite, a host) closes it.

**Adding one**: add a script to `VIDEOS` (and `CARD_VIDEOS` / a card's `watch` id in help.js), then
`node dev/help-videos-test.mjs` checks it (lengths, captions, ops, map, mode) and runs it headless (moments must
happen, the run must fit a budget, the same seed must give the same match). Pick a seed with the star busy: the test
prints the star's counts.

## Training (the guided first match)

`js/game/tutorial.js`, offered once on first run (never to a player who has XP) and from Help > Training any time.
Eight steps on Railyard's middle lane, each passed only when the player really does it: Move, Aim, Fire (two targets),
Slide, Swap (new), Throw (an aimed throw), Scorestreak (a UAV handed over), Live fire (three kills, or 90 s).

- Every step has touch words and controller words (`STEPS[i].pad`, `stepPrompt(step, device, nameOf)`), with the
  player's own bindings filled in. The device is read each frame (`body.pad-on`, set by js/ui/gamepad.js): pick up a
  controller mid-step and the same step switches to its words, and the ghost thumb and the ring around a touch button
  hide; put it down and they come back. The nudges (a slide too slow, a quick tap instead of an aimed throw) follow the
  device too.
- The card is a live region; its entrance, nudge and finish stamp follow reduced motion (`motion.anim`).

## First-time tips

`js/shared/mode-tips.js` (pure: `TIPS`, `TIP_OF`, `tipFor`, `markSeen`) and `js/ui/modetips.js` (the card). The first
match of each mode shows one card with two short lines on how to win it (and "Help has a video of it" where there is
one), with Got it; it also goes after 14 s. Variants share a tip (Ground War Domination is Domination's, Duos is Battle
Royale's). It waits until the match intro has finished, is marked seen the moment it shows, and never shows in
Training, the tutorial, the range or a rejoin.

- Seen tips live in `Options.tipsSeen` (`switchyard-options`, kept by the progress reset). Options > First-time tips:
  Show again empties it.
- Test pages (`?debug=1`) keep tips off unless they ask with `&tips=1`, so every other UI test's first match is as
  before.
- No tip costs a frame: the card is built on first use and the wait for the intro is a 4 Hz timer, never per frame.

## Tests

- `node dev/help-videos-test.mjs [quick]`: scripts, captions, every video headless (moments, budget, determinism,
  the lazy lead-in), tips, tutorial prompts, the menu labeller's names, calm keyframes, the new Options keys through a
  progress reset.
- `python3 dev/ui-help-videos-test.py [port] [--all]`: lazy loading, the Videos tab and Watch chips, a sample of
  videos playing (every one with `--all`), controller captions, Replay, Loop, the end card and Next, Skip and Escape.
- `python3 dev/ui-access-test.py [port]`: tips and the tutorial's controller words, with the accessibility checks.
