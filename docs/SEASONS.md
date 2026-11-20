# Seasons and ranked (ROADMAP items 21 and 22)

Date-driven, no server: every phone works out the season from its own local calendar date, the same way the boards
read dates, so two phones on the same date agree wherever they are. Owner: seasons (`js/shared/season-items.js` data,
`js/shared/seasons.js` dates/track/weekly/save block, `js/shared/ranked.js` rating, `js/ui/season.js` screens,
`css/seasons.css`). Tests: `node dev/sim-seasons.mjs`; overflow scenes `title-season`, `season-*`, `mp-ranked`,
`boards-season`, `boards-ranked`, `results-season` (the gallery runs them on 2026-12-02; `&date=YYYY-MM-DD` for any day).

## Schedule
| | Dates (local) | Event (limited-time playlist) | Early unlocks on the track |
|---|---|---|---|
| Preseason | to 2026-11-15 | none; ranked plays, the track waits | |
| Season 1: Cold Iron | 2026-11-16 to 2026-12-27 (42 days) | Cold Snap, Hardcore Infected, days 14-27 (Nov 30 - Dec 13) | Rotary (tier 25), Ghoul (tier 75) |
| Season 2: Signal Fire | 2026-12-28 to 2027-02-07 | Lights Out, Hardcore Kill Order, days 7-20 (Jan 4 - Jan 17) | Anti-Materiel (25), Mako (75) |
| Season 3: Third Rail | 2027-02-08 to 2027-03-21 (42 days) | Lightning Rod, Snipers Only Grind, days 7-20 (Feb 15 - Feb 28) | Lodestone (25), Halcyon (75) |
| Season Replay | from 2027-03-22, 42 days each | the replayed season's | Cold Iron (`S1R1`, Mar 22), Signal Fire (`S2R1`, May 3), Third Rail (`S3R1`, Jun 14), Cold Iron (`S1R2`, Jul 26), ... |

A season opens at local midnight of its start day. Replays are fresh instances: the track, weekly sets and ranked start
over; rewards already owned show as owned. The title shows a Season chip (days left, a dot when tiers wait to be
claimed) in the free slot of the button grid, and the division badge on the profile card.

## The free track (100 tiers)
- XP: every match's XP total (whatever the match paid: kills, wins, dailies, mastery) goes on the track; 5,000 XP a tier
  (`TIER_XP`). Weekly season challenges pay stars, one tier a star. Never paid, no XP boosts.
- Each season: 40 calling cards (group Season; tier 1 is the season's own card, 37-40 animated), 40 emblems, 10 camos
  (8 static, 2 animated, every gun), 8 operator skins (`skin:<op>-s<n>`, tier label Season), and two existing locked items
  early (tier 25 a gun, tier 75 an operator; their level or challenge still opens them too). A season may add skin rows
  past the eighth with `fillerSkinTiers` (one tier each, emblem tiers only): the emblem there leaves the season and
  every other reward keeps its tier. Season 2 does: the Signal Fire set, six more skins on tiers 7, 17, 42, 64, 77, 89.
- Claim on the Season screen's Track tab (tiles pop in turn); results stamp each tier reached. A season that ends
  claims whatever was reached for the player.
- Season cosmetics are hidden in pickers until owned or their season is running, and locked before their season starts
  (`dateLocked`). Season emblems are kept out of `EMBLEMS` (the bot pool draws from it by index): `ALL_EMBLEMS`.

## Weekly sets
Five challenges a week, six weeks, drawn by season and week from `WEEKLY_TEMPLATES` (no two of a family; each week has a
ranked/wins goal and an objective/mode goal). Week w opens at day 7w and stays open to the season's end. Stars 1-2.
Stats are ChallengeTally counts plus `ranked` (a ranked match played).

## Ranked
- Multiplayer > Standard > Ranked (first playlist): Hardpoint, Search and Destroy, Control on the eight medium maps,
  the modes' standard limits, no modifiers. Matchmaking draws pool bots near your SR (`rankedTarget`, spread 0.11
  against the usual 0.17); placements use your normal rating.
- Friend rooms: when all 12 seats are humans (6 a side, not custom) the host gets a Ranked chip; on, the vote offers the
  ranked modes and maps, no modifiers, and each phone moves its own player's rating. Training and Custom never count.
- Divisions: Bronze, Silver, Gold, Platinum, Diamond, Master (900 SR each, tiers I-III of 300), Champion 5,400+.
- Placements: 5 matches. Start = last season's carried SR, else rating x 5,100 - 250; then +140 per win above 2.5 and
  +-30 by performance; capped at Diamond III (4,499).
- A placed match: win +48, loss -42 at even strength; performance (place in your team's table, nudged by K/D) +-22/18;
  lobby strength (their average SR vs yours) up to +-16; never less than 8 either way. The first loss that would drop
  you out of a division stops on its floor once (protection renews on promotion).
- Reset: a new season (or replay) carries 75% of the SR into new placements. End-of-season rewards: the calling card
  and crest of every division up to the best reached (`card:rk-s1-gold`, `emblem:rk-s1-gold`). The Preseason pays none.
- Badges: the lobby car and the boards show the division badge (`badge.rk`, a code 0..18, -1 unranked).
- Bots: about 60% play ranked; SR = their usual rating x 5,100 - 250 + climb from ranked matches in the season window
  (to +700) + a per-season roll (+-250); placed after 5 ranked matches. A function of the date alone (`botSr`).

## Boards
A fourth view, Season: the season's window (pool rows from `poolWindow(season start, today)`, yours from the save, friends
from their card's `sn` when it is this season's): kills, K/D (10+ matches), wins, BR wins/top 5, Ranked, Tier. A Ranked
category in every view (placed players only). Career cards gain an optional `sn` {key, m, k, d, w, brw, br5, t, sr}.

## Weekly events
One event a week, every week, from `EVENT_EPOCH` (Monday 2026-11-16): Monday 00:00 local to the next Monday, the same on
every phone for the same local date, round and round the list for ever (no update needed). Owner: events
(`js/shared/events.js` data, dates, state; `js/ui/eventbanner.js`; the event bits of `js/ui/challenges.js`,
`js/ui/matchmaking.js`, `js/game/awards.js`). Tests: `node dev/sim-events.mjs [quick]`, `python3 dev/ui-events-test.py
[port]`; overflow scenes `title-event`, `title-season-event`, `challenges-event`, `mp-event`, `unlock-event` (the
gallery runs them on 2026-11-25).

| # | Event | Plays | Reward |
|---|---|---|---|
| 0 | Gloves Only | Rebound Quads, `gloves`: no guns on the floor or in chests (plates and meds instead), no starting pistol, redeploys with the gloves | card Glass Jaw |
| 1 | Snipers Only Rebound | Rebound Quads, `snipers`: every floor gun a sniper rifle (the pistol stays) | emblem Long Watch |
| 2 | Night Graveyard | Graveyard Shift with bots, `night`: the fog every round but the boss rounds, every point paid double | card Lantern Hour |
| 3 | Pistols at Dawn | TDM, `pistols`: primaries (and a launcher sidearm) become pistols | emblem High Noon Duel |
| 4 | Gun Game Gauntlet | Hardcore Gun Game | card Every Rung |
| 5 | Infected Overrun | Ground War Infected | emblem Patient Zero |
| 6 | Showdown Shuffle | Showdown 2v2 | card Dealt In |
| 7 | Blade Brawl | Melee Only TDM | emblem Cold Edge |
| 8 | Iron Hill | Hardcore Hardpoint, No Streaks | card King of the Hill |

- Where: the Multiplayer Spotlight (Standard tab) carries the event's playlist (`wkevent`, eyebrow Weekly event, days
  left) whichever tab its mode belongs to; Find match takes the lobby size and the maps from that tab (`tab`). The
  Spotlight's order rule for every builder: a tournament, then the events (weekly, then the season's limited-time one),
  then Ranked, then the featured playlist (`js/ui/playscreens.js` mpGroups).
- Challenges: three or four per event, ChallengeTally stats (plus `zm:rounds`, the rounds survived), counted only in
  matches played from the event's playlist (main.js tags them, `MatchAwards.event`); a match from last week's playlist
  that ends after Monday midnight counts for nothing. 1,500 XP each, once a week. Event matches pay a 10% bonus on the
  match's XP (`Weekly event bonus` line). Shown on the title's challenge plate (one line) and in their own panel on the
  Challenges screen, each with Play (the event playlist).
- Reward: finishing every challenge pays the event's calling card (group Events) or emblem, once ever; the event coming
  round again resets the challenges but pays no second reward. Its unlock sheet says how and when the event is next
  on, shows the challenges done while it runs, and offers Play now only then.
- Banner: the week's first visit to the title (not on a brand-new save) shows a strip under the wordmark for 8 seconds;
  a tap opens the playlist. The week a new season or replay opens it announces the season instead (opens the Season
  screen). Stored per phone (`switchyard.eventSeen`, `switchyard.seasonSeen`).
- Event modifiers (`js/shared/playlist.js` `EVENT_MODS`) never show in the pickers. `gloves` and `snipers` are the only
  modifiers battle royale takes (the loot rolls draw the same numbers either way, so every phone's loot table agrees);
  `night` is Graveyard Shift's alone.
- Save: `save.season.ev` `{ k: 'w<week>', c: {challengeId: progress}, got: [event ids paid] }`, in the season block (so
  in the save code); ownership comes from `got`.
- Adding an event: append to `EVENTS` (never reorder: ids are in saves, and the list order is the rotation, so an
  appended event changes which event future weeks get). Run `node dev/sim-events.mjs`: it plays the event's mode with its
  modifiers and checks every challenge moves there and the goals are in reach.

## Season 2 readiness (checked 2026-11-18)
`dev/sim-seasons.mjs` "season 2" plays the switch through Progress on a mocked clock (Dec 27 22:00 to Dec 28 00:00):
reached tiers claimed for the player, Season 1 ranked paid, the Signal Fire track (100 tiers, every reward in its
table, Anti-Materiel and Mako early), Season 2 camos in the picker only from the 28th, six weekly sets (week 2 on Jan 4),
Lights Out in the Spotlight Jan 4-17 only, placements again from 75% of the SR, the Season boards on the Season 2 window;
then Season Replay on Feb 8 (as of 2026-11-18; Season 3 has since moved the replays to Mar 22, see below).
`dev/ui-events-test.py` checks the same in the page: the new-season banner, the Season chip, the Season screen, Ranked
placements, What's new. Nothing needed fixing for the switch itself.

## Season 3 readiness (checked 2026-11-20)
Season 3: Third Rail (ROADMAP item 57), `S3` in `SEASON_DEFS`, 2027-02-08 to 2027-03-21: a late-winter storm over the
electrified lines (storm slate, electric yellow, violet). Data only, like Seasons 1 and 2: no new code paths.
- Track: 100 tiers in the Season 1 layout (no `fillerSkinTiers`): 40 cards (tier 1 is the season's own card, Third Rail;
  37-40 animated with the existing `gold`/`prism` card animations), 40 emblems (in `ALL_EMBLEMS` through
  `SEASON_EMBLEMS`, never in `EMBLEMS`), 10 camos on every gun (8 static: Cloudburst, Downpour, Gale Force, Nimbus,
  Stormglass, Ozone, Hailstone, Thunderclap; 2 animated on the existing shader patterns: Forked Bolt `livewire`, Eye of
  the Storm `aurora`), 8 skins (`skin:<op>-s3`: Ghoul Stormcrow, Ram Thunder Ram, Sable Rain Shadow, Linnet Flash Flood,
  Mako Storm Surge, Skylark Cloudbreaker, Gambit Storm Chaser, Warden High Tempest).
- Early unlocks: tier 25 the Lodestone (`rail`, the coil sniper, level 40), tier 75 Halcyon (10 Search and Destroy
  rounds won). Both still open the usual way.
- Spotlight: Lightning Rod (`lightningrod`), Snipers Only Grind, days 7-20 (Feb 15 - Feb 28). A remix of existing rules
  (Grind is not a dealt mode, so Snipers Only swaps primaries to sniper rifles; the sidearm stays). It sits after the
  weekly event in the Spotlight per the order rule.
- Weekly: six sets of five drawn from `WEEKLY_TEMPLATES` by `S3` and week (`S3.w1.*` .. `S3.w6.*`).
- Date locks: every S3 camo and skin is `dateLocked` until Feb 8 00:00 local (hidden in pickers until then, as Season 2).
- Replay: appending S3 moved Season Replay to start when Third Rail ends (Mar 22): Cold Iron `S1R1`, Signal Fire
  `S2R1` (May 3), Third Rail `S3R1` (Jun 14), Cold Iron `S1R2` (Jul 26). Nobody can hold a replay key yet (the earliest
  was Feb 8), so no save is affected.
- Tests: `node dev/sim-seasons.mjs` (schedule and five time zones across Feb 8 / Feb 15 / Mar 22, replay order and
  back-to-back windows, date locks, "season 2 and season 3": the Feb 8 switch through Progress on a mocked clock with
  every reward real, Lodestone/Halcyon early, cosmetics equip, weekly sets, Lightning Rod Feb 15-28 only, then the
  replays), `node dev/sim-events.mjs` (every season event's playlist plays in bot matches with its modifiers: Lightning
  Rod gets only sniper/sidearm kills and tags still bank), `python3 dev/ui-events-test.py` (Feb 8 in the page: banner,
  chip, Season screen, the Spotlight on Feb 16, Replay on Mar 24).
- TODO (ranked owner, branch `ranked`): Season 3 gets ranked end-of-season rewards automatically (`rankedCards` /
  `rankedEmblems` read `SEASON_DEFS`: `card:rk-s3-*`, `emblem:rk-s3-*`) and the reset runs on Feb 8 like any season
  switch. Nothing ranked was changed here; `dev/sim-seasons.mjs` "Season 3 Ranked: placements again" asserts today's 75%
  carry and will need the new soft-reset rule when that branch lands.

## Save
`save.season` (appended to v4, no version bump), the save code's 19th entry (null in the 18th when there is no career
entry). Left out while it only knows the date, so older codes re-export unchanged. Ownership is derived from `cl`
(best tier claimed per season) and `rr` (best ranked division paid per season), so codes stay short (~0.3 KB).

## Adding a season (for the lead)
1. Append a row to `SEASON_DEFS` in `js/shared/season-items.js` (never reorder or edit a shipped one): `id` `S<n>`,
   `n`, `name`, `start` (the day the previous one ends; a gap is covered by the previous season running long),
   `theme`, five `palettes`, `event` (mode, mods, days `from`/`to`), `paths` (a gun and an operator that are locked early
   in the game), optional `content` (`{kind: 'map'|'mode'|'weapon'|'operator', id}` to date-lock new content until the
   start), 10 `camos` (existing shader patterns), 8 `skins` (existing operators), 10+10 card words and 10+10 emblem words.
2. `node dev/sim-seasons.mjs`: it checks names against the whole game (fix clashes), boundaries and the track.
3. Ship it at least one season ahead (the owner's rule: two seasons ahead per update). Replay order is the list order;
   adding seasons after the replays started simply turns the replay days into the new seasons.
4. Bump js/build.js as usual. Nothing else: cards, emblems, camos, skins, ranked rewards and boards read the list.
