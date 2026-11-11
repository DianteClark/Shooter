# Bots overhaul (ROADMAP item 15)

Standard modes should look like multiplayer, not "play vs bots": the bots are now 200 named players with persistent
profiles, drawn into each match by matchmaking, each playing at a per-match form. Their decisions changed too.

## The pool (`js/shared/botpool.js`)
- Built from a fixed seed (`POOL_SEED`), so every phone holds the identical pool and nothing about it is sent: a roster
  entry names the profile (`pool: 'p017'`) and carries this match's `rating`. `dev/sim-botpool.mjs` rebuilds it in a
  fresh process and compares.
- 200 gamer tags (`TAGS`, append only: a tag's index is its profile id). Checked against every gun, attachment, perk,
  equipment, streak, operator, skin, map, mode, medal, card, emblem, camo, tracer and kill effect name; at most 12
  characters, like a human's name.
- A profile: `style` (rusher, anchor, flanker, objective, sniper, support), two favourite classes and three favourite
  guns with a kit index each, sidearm, perks, tactical, lethal, three streaks, operator, skin, calling card, emblem
  (or none), camo, `skill`, `activity` (matches a day), `brShare`, `joined`, `base` (career at the epoch).
- `skill`: about a fifth are `locked` at a tier (mostly elite or recruit: the player who is always a menace, the one
  who never is) and always play at it. The rest have `mu` (their usual rating, 0..1) and `form` (sigma).
  `formRating(profile, seed)` is a match's roll: mu + form x N(0,1), with about one match in twenty a bad night
  (-1.8 sigma) and one in twenty a hot streak (+1.4 sigma). About 30% of matches put a player off their usual tier.
- Play style changes how a bot plays (`STYLES[style].lean`: flank, hold, objective, push, sprint, slide multipliers in
  `skillAt`), never how well it aims or how fast it reacts.

## Matchmaking
- `buildRoster(humans, { ..., pool })` (js/sim/sim.js): with `pool` ({ target, level, spread, recent, date, locked }
  or `true`) bots are drawn from the pool instead of dealt. Without it, rosters are exactly as before (tests and
  `dev/map-validate.mjs` rely on that).
- `pickPoolBots`: weighted draw without replacement. Weight = a bell on |mu - target| (sigma `spread` 0.17) x a loose
  bell on level and prestige distance (floor 0.35) x 0.3 if the profile was in one of this phone's last two lobbies x
  how often they play. Never the same bot twice in a match; back-to-back lobbies share about 0.4 of 11 players and
  never all of them (tested over 60 lobbies).
- Teams are evened like matchmaking would: strongest first, each to the side with the lower rating total, humans
  counted at the target. Battle royale and free-for-all keep their own seating; only who fills the bot seats changes.
- Names, levels (`badge` from `careerAt(now)`), operators, skins, cards, emblems, camos and loadouts (favourite gun most
  matches, the other two now and then; kit by their usual tier, not tonight's form) come from the profile.
- The human side: `humanRating({ level, prestige, kd, matches })` puts a player on the same scale, `HUMAN_BASE` for an
  average player (calibrated with `dev/balance-sim.mjs --realistic`: the human-like thumb's K/D about 1), moved by
  their last ten matches' K/D and a little by level. js/main.js `poolFor(humans)` averages the match's humans.
- Custom: a difficulty other than Mixed (`botSkill`) holds every pool bot at that tier (`rating` = the tier's); Mixed
  is the form-rolled pool. The roster is still the pool's names and looks.
- UI: pool bots wear their profile emblem (js/ui/cards.js) and lose the intro roster's "Bot" tag (js/ui/hud.js).

## Careers, for leaderboards (ROADMAP item 16)
`careerAt(profile, date)` returns `{ matches, kills, deaths, kd, wins, brMatches, brWins, brTop5, extractions, xp,
level, prestige, days }` as of `date` (a Date or ms):
- Deterministic (same answer on every phone) and every total non-decreasing in the date (tested daily, then every
  nine days, over two years for all 200).
- Before `POOL_EPOCH` (2026-11-01 UTC) it is the profile's `base`. After, each week adds `activity x 7 x busy`
  matches (busy 0..2 from a hash of id and week) at the profile's rates (from `skill.mu`: kills a match 7..20, K/D
  0.55..2.1, team win rate 0.40..0.62, BR win 1..14%, top five 12..52%, XP a match 1,700..3,600) times a weekly form
  (0.8..1.2). The current week counts its days so far. Integers, floored.
- `level` / `prestige` come from `xp` through the player curve (`levelFromXp`); this is the badge matchmaking shows.
- `extractions` stays 0 until `EXTRACTION_LAUNCH` (2026-11-11, the day extraction mode shipped); never move it (that
  would rewrite every career). From then extraction matches come out of the team share.
- Cost: about 25 ms for the whole pool two years on (one loop step per week). Cache per day if a board needs it often.
- Never change `POOL_SEED`, `POOL_EPOCH`, the tag order or `rates()` once boards are live: every bot's history would
  change under the players' eyes. New profiles go on the end of `TAGS`.

## Behaviour (js/sim/bots.js)
Ratings between tiers read `SKILLS` in between (`skillAt`); the tiers sit at 0, 1/3, 2/3 and 1, so a forced tier
plays exactly as before. New traits, all scaled by rating (recruit .. elite):
- trade (0.15 .. 0.85): a teammate killed within 16..30 m: move up to where they fell and look where the shots came from
  (as their last callout would say); a bot holding a point or angle turns to face it instead.
- footsteps (0.3 .. 0.85 of hearing): an enemy on the move is heard (sprinting further than walking, through walls
  shorter, Dead Silence silent), and a bot on the move stops and holds that angle for 1.2..2.6 s.
- peekCover (0 .. 0.8): a mid-range duel (9..40 m) with a long gun is fought from a spot beside cover, jiggling there,
  stepping back behind the cover to reload or heal, then out again (mode 'peek').
- preaim (0.08 .. 0.92, per walk): on the move, the eyes go down the lane ahead (the longest enemy-side sight line of a
  hold point near by), not at the feet.
- spreadOut (0 .. 0.95): the third bot hunting the same noise takes it from the side instead.
- topOff (0 .. 1): sights down between fights so a part-empty magazine refills.
- Weak-player habits, falling with rating: tunnel (0.55 .. 0.04: busy with one enemy, misses the next) and overpeek
  (0.45 .. 0.02: walks out of a held angle toward what it saw).
- Close guns that still hit at range (SMGs) fight out to 72% of their range instead of sprinting mute at a shooter
  (their `rush` was 13..15 m): on small maps the first shot decides most fights, and the SMG never had it.

Measured (dev/balance-sim.mjs --realistic, seed 1, the human-like thumb):
- Before, dealt Mixed bots, 216 lobbies: thumb K/D 0.70. Same dealt Mixed roster with the new brains: 0.65 (144).
- Pool at HUMAN_BASE 0.27, 216 lobbies: thumb K/D 0.92; per lobby median 1.06, p10 0.40, p90 1.87 (12% of lobbies
  under 0.5, 8% over 2). `--locked=elite`: 0.17. `--locked=recruit`: 2.41.
- Small maps, pool lobbies: SMG K/D 0.81 to 0.93-0.96, LMG 1.20-1.33 to 1.16-1.17.
- Host tick (dev/perf-sim.mjs, 32 bots, interleaved runs): Downtown 0.56-0.64 ms against 0.58-0.62 before; the full
  dev/map-validate.mjs: same stuck total (231 against 240) and tick within noise.

Tried and dropped: breaking off a fight only when losing it (bot-vs-bot K/D worse), a shorter dash to cover under fire
(worse), routing close guns round long sight lines (no measurable gain, +30% path cost).
