# Audio: music for every mode, and the sound pass (ROADMAP 61)

Everything is synthesised in the browser: no audio files, no downloads. Sound effects and music are rendered into
AudioBuffers after the first tap (in small slices, in the menus) and played back as buffers, which is what keeps a
32-player firefight cheap on a phone.

## Files

| File | What |
| --- | --- |
| `js/audio/audio.js` | The engine: buses, compressor, limiter, soft clip; every gun, impact, footstep, UI sound; voice budget. |
| `js/audio/music.js` | The music director: scenes (menu, lobby, match, results), stings, ducking, the Music option. |
| `js/audio/music-synth.js` | Offline synth: instruments, the menu and lobby stems, the stings, and single samples for the kit. |
| `js/audio/music-seq.js` | The live sequencer: the kit, two decks, the lookahead scheduler. |
| `js/audio/music-themes.js` | The match themes (one per kind of match, four levels each) and `pickTheme`, the state machine. |
| `js/audio/mode-sfx.js` | Mode and objective sounds nothing else voiced (Extraction, Infected, HQ, KO, rounds, marks, jets...). |
| `js/audio/{br,zm,cp,streaks,equipment,fin,melee}-sfx.js` | Per-feature sound modules, all through the engine's `_play` / `_world`. |

## Music

### Menus
Pre-rendered stems (music-synth.js `TRACKS`): the title theme (two stems; the bed alone is the calm variant after
75 s untouched), the lobby loop (lobby, vote, matchmaking screens and under the results reel), and one-shot stings:
match intro, victory, defeat, match point, boss, level up, unlock, prestige.

### Matches: one theme per kind of match
Sequenced live, note by note, from a 20-sample kit (3.8 MB). Every theme has four levels:
0 the bed, 1 the pulse, 2 the full groove, 3 the peak (the title motif on the lead, crashes, fills).

| Match | Theme | What moves it |
| --- | --- | --- |
| TDM, KC, Dom, Hardpoint, FFA, Gun Game, CTF, HQ, Kill Order, Grind | `tdm` "Switchyard Run", 104 bpm D minor | warm-up 0, live 1, firefight 2 (held 8 s), last minute or the engine's "last kills" 3 + match point sting |
| Any standard mode in Ranked | `ranked` "Ladder", 122 bpm C minor techno | as above |
| S&D, Control, Showdown, One in the Chamber | `tactical` "Clockwork", 90 bpm A minor | as above |
| Ground War (all its modes but Infected) | `gw` "Front Line", 84 bpm war drums | as above |
| Battle Royale, Rebound | `brdrop` "Drop Zone" in the air; `br` "Island" on the ground; `brfinal` "Last Circle" | ground: circle phase 0-1 calm (0), 2-3 (1), +1 while it shrinks, firefight ≥ 2; final circle 2, two squads or four players left 3 |
| Extraction | `ex` "Contract"; `exfil` "Dust Off" once your squad calls exfil | firefight 2, last two minutes 2; exfil 2, final exfil 3 |
| Graveyard Shift | `zm` "Night Shift" (music box, tritone, heartbeat); `zmboss` "The Warden" | rounds 1-2: 0, 3-5: 1, 6-9: 2, 10+: 3; the break between rounds two lower; a boss (round 10, 20... or the quest warden) switches to `zmboss` with the boss sting, level 3 in his last third |
| Campaign | `cpstealth` "Quiet Hours", `cpaction` "Nightrail", `cpchase` "Dead Man's Run", `cpboss` "Iron Crown" | each mission its own mood and key (`MISSION_MOOD`); the alarm on a stealth mission 2; a timer under 30 s 3; the boss: `cpboss` + sting, 3 in his last phase |
| Infected, Ground War Infected | `inf` "Outbreak", 118 bpm E Phrygian | before the first turn 0; then 1, half turned 2, one survivor or the last 30 s 3 |
| Range, tutorial | none | |

Victory and defeat: the theme fades with the end of the match and the outcome sting plays over the results.

### How it is scheduled (CPU)
- A timer every 60 ms schedules every bar whose start is within 0.32 s, whole bars at a time, on the audio clock. A
  frame (or three) of main-thread stall changes nothing; a longer stall skips to the next bar line rather than
  bunching notes up. The timer stops whenever no theme plays (menus, music off, volume 0, hidden page).
- A level change waits for the next bar line. A theme change starts the new theme on the old one's next bar line on
  the second deck and crossfades over ~2.4 s; a third change mid-fade drops the oldest at once.
- Per note, the only node made is the AudioBufferSourceNode (the API needs a fresh one). Every channel owns a ring of
  GainNodes built once (236 in all, idle ones cost nothing); held notes loop a seamless stretch of their sample.
  No per-frame allocation: `frame()` compares a few numbers.
- Measured (dev/sim-audio.mjs, node): ~0.01 ms per tick; the busiest theme peaks under 40 notes a second.
  Memory: 16.5 MB of music buffers in all (12.7 MB menu stems and stings, 3.8 MB kit), down from 17.5 MB when the
  match music was five pre-rendered loops.

### Mix and ducking
The sequencer's bus sits at 0.55 (about 5 dB under the title theme). Everything goes through the director's duck:
a firefight (down to 55%), the open mic (50%), a teammate talking on voice chat (55%, from `voice-ui.js` speaking
marks), campaign radio (50% for the line). The engine's music bus then takes the Music volume and the mic-mode trim.
A dead player hears the music through a low-pass; low health muffles the world but not the music.

### Options
Options, Audio: the Music slider (default 60%, was 100%) and a switch beside it: **Everywhere** (default), **Menus
only** (menus and stings, nothing under play: the old default), **Off** (no music or stings at all). Option key
`musicMode`; the old `matchMusic` boolean is gone.

## Sound effects: the audit (2026-11-20)

| Area | State before | This pass |
| --- | --- | --- |
| Guns (every class) | Hand-made or derived voices per gun (near, suppressed, tail, map reflection), low-ammo ring, dry fire, occlusion, whizz by round class | Audited, kept |
| Melee | Wave 4 melee module, bat crack, gloves in BR | Kept |
| Reloads | Per-gun foley (out, in per shell, rack), cancelled when a reload stops | Kept |
| Footsteps | One concrete set for every map | **Six surfaces by map** (gravel, dirt, snow, sand, wood, steel; concrete stays the default) |
| Explosions, aircraft | Frag/explosion bodies, gunship rumble, bomber drone, chopper, seekers | **Airstrike jets fly over**; **a distant bus**: past 44 m world sounds lose all but the low end |
| Hit markers, headshots, kills | Tick, headshot ring, kill chain climbing | Kept |
| UI | Taps, tabs, confirm/deny, sliders, level/rank/unlock with music stings | Kept |
| Zombies | Groans by kind, claws, crate, perks, rounds, specials | **Traps, exfil, escape, the warden rising, frost and burn hits, supply buys** |
| Objectives | S&D, CTF, Dom/HP captures, streak calls | **Extraction** (exfil open, flare, helicopter in and out, reinforcements, charges, caches, squad lost), **Infected** (turning), **HQ**, **Kill Order** (the crown), **OIC**, **Showdown and Control** (round bell, whistle, overtime), **Grind** (bank), **marked by a sweep**, **hijack**, **ammo scavenged** |

### Voice budget (unchanged design, now checked at 32 players)
26 voices at most, a strict priority list (your gun, threats near you, hit feedback, explosions, nearby guns, world,
far guns, steps, tails) and hard per-class caps; guns past 30 m never take a voice and only raise one looped far
firefight layer; per-shooter and global rate limits on shots, tails and reflections. dev/ui-audio-test.py runs a
32-player Ground War fight with the music on through the real graph: the budget and every cap hold, the output does
not clip, and the engine's main-thread cost is reported per frame. Last run (headless Chrome, loaded 2-core box,
2019 events in 12 s): 19 voices at the peak, every class at or under its cap, output peak 0.86, engine cost per frame
median 0.10 ms, p95 0.40 ms. The sound modules every match uses (mode, equipment, streaks, finishers) now bake in the
menus when the engine is ready, not at the first event of a match (the stress test's first frame went from ~1 s
offline to 26 ms).

## iOS rules (do not regress)
The context is created and resumed only inside the engine's gesture handler, and never on a `touchend` that leaves
another finger down (that would cancel the other thumb's touch on iOS); wakelock.js, voice.js and main.js keep the
same guard. The music adds no gesture handlers that start media: it plays only into the engine's context once it
runs, and stops everything when the page is hidden.

## Tests and previews
- `node dev/sim-audio.mjs [wav]`: the kit, every theme at every level, the scheduler on a stand-in context (bars back
  to back, level changes on the bar line, crossfades, stalls, stop, cost), the state machine for every mode family,
  the director. `wav` writes node mixdowns of every theme to /tmp/audio/node/.
- `node dev/sim-music.mjs [wav]`: the menu stems and stings (lengths, seams, peaks, build cost).
- `python3 dev/ui-music-test.py 95xx`: the director in the browser and the live page (title, options switch, match).
- `python3 dev/ui-audio-test.py 95xx`: the themes through the real graph to /tmp/audio/*.wav, and the 32-player stress.

## Adding a theme
Write `bar(b, L, e)` in music-themes.js (helpers: `pat`, `hits`, `chord`, `figure`, `arp`, `motif`, `mel`, `fill`,
`joints`), keep each channel inside its rate range (sim-audio checks 0.4x-3.5x of the kit sample), make level 3 at
least as busy as level 0, map it in `baseTheme` / `pickTheme`, and add it to the previews.
