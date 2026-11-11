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
| Season Replay | from 2027-02-08, 42 days each | the replayed season's | Cold Iron (`S1R1`), Signal Fire (`S2R1`), Cold Iron (`S1R2`), ... |

A season opens at local midnight of its start day. Replays are fresh instances: the track, weekly sets and ranked start
over; rewards already owned show as owned. The title shows a Season chip (days left, a dot when tiers wait to be
claimed) in the free slot of the button grid, and the division badge on the profile card.

## The free track (100 tiers)
- XP: every match's XP total (whatever the match paid: kills, wins, dailies, mastery) goes on the track; 5,000 XP a tier
  (`TIER_XP`). Weekly season challenges pay stars, one tier a star. Never paid, no XP boosts.
- Each season: 40 calling cards (group Season; tier 1 is the season's own card, 37-40 animated), 40 emblems, 10 camos
  (8 static, 2 animated, every gun), 8 operator skins (`skin:<op>-s<n>`, tier label Season), and two existing locked items
  early (tier 25 a gun, tier 75 an operator; their level or challenge still opens them too).
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
