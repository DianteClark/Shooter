# Weekend tournaments

Date-driven like seasons (docs/SEASONS.md): no server, every phone works the schedule out from its own local date and
hour, and every bracket from the weekend and the bracket owner's id, so a reload, or a friend in the owner's room, sees
the same bracket and the same results. Owner: tournaments (`js/shared/tourney-items.js` schedule, cups, rewards and the
save block; `js/shared/tournaments.js` brackets from the bot pool; `js/ui/tourney.js` screens; `css/tourney.css`).
Tests: `node dev/sim-tournament.mjs`; `python3 dev/ui-tourney-test.py [port] [--shots]`.

## Schedule
- A weekend opens Friday 18:00 local and closes at the end of Sunday (Monday 00:00 local). Its key is the Friday's day
  number (the local Y-M-D as a UTC day, as seasons count days). The first is Friday 2026-11-20.
- Cups alternate by weekend: the **Team Cup** (4 v 4: quarter-final TDM or Kill Confirmed, semi-final Hardpoint or
  Domination, final Search and Destroy or Control; small and medium maps; TDM 50, KC 45, DOM 150, HP 120 to win) and
  the **Showdown Cup** (Showdown 2 v 2 rounds on the small maps, first to 6). Each round's mode and map are drawn by the
  weekend (`roundPlan`), three different maps, the same for every bracket that weekend.

## The bracket
- Eight squads, single elimination: seeds 1v8, 4v5, 2v7, 3v6. The player's squad is seed 1 (solo: three or one pool
  bots with no clan, around rating 0.4, the same all weekend; a friend room: its players, bots in the seats left).
- Seven clans from `CLANS` (botpool.js; never edited here): two stacked, one weak, four of the rest, shuffled by
  weekend and owner, each fielding its strongest members that weekend (a small weekly availability jitter), seeded
  2..8 by their members' usual rating. Only clans with enough members for the cup's size enter.
- In the player's match the enemy is the clan's real members, with their profiles, tags, looks and levels. Their match
  rating is 0.4 x their form that round + 0.6 x the player's rating, plus 0.02 / 0.06 / 0.10 by round, so it rises
  quarter to semi to final on top of the seeding (sim at player 0.30: about 0.25 / 0.50 / 0.65).
- Bot-against-bot matches: each squad's strength is its members' form that round (the pool's own per-match roll,
  seeded by weekend and round); the winner is a logistic draw on the gap (slope 9) with a roll seeded by weekend, owner,
  round and match. The whole bracket is known from the start; the screen reveals a round's other results once the
  player has played that round, and everything once the player is out or champion.

## The run
- Enter from the bracket (Multiplayer > Standard > Spotlight, the cup's card; in a friend room the lobby's cup chip).
  Each round goes straight into its match, no vote; the intro names it ("Semi-final vs [VXN] Vexen").
- A win moves the run on; a loss or a draw ends it. One re-entry a weekend, back at the quarter-final of the same
  bracket. Leaving a round's match (or closing the app in it) counts as lost: the round is marked as being played when
  it starts and settled as a loss the next time the cup is looked at.
- Friend rooms: the host's bracket (owner = host id), every player in the room on the squad (up to the cup's size;
  the chip says when the room is too big). The start message carries `tourney: { key, round, owner, title, cup,
  opponent }`; each guest's run follows the host's (`joinTourney`) and is paid its own placing. Guests can open the
  bracket from the lobby (the host's run comes with the room's state) but only the host plays rounds.

## Rewards
- XP on the match's lines (so the season track takes it too): 500 for the weekend's first match, then 1,500 / 2,500 /
  4,000 for winning the quarter-final / semi-final / final, each once a weekend (a re-entry never pays a round twice).
- Placings: entrant (played a quarter-final), semi-finalist, finalist, champion. A calling card for each
  (`card:tn-entrant`, `tn-semi`, `tn-finalist`, `tn-champion`, group Tournament); a champion also gets the Champion's
  Crest emblem (`emblem:tn-champion`) and the Champion's Laurel camo (`camo:tn-laurel`, every gun).
- Ownership is derived from the shelf (best placing ever), so nothing can be paid twice.
- Trophy Case: a Tournaments shelf, newest first: each weekend played with its date (the Friday), cup and placing.

## Save
`save.tn` (appended to v4, no version bump), the save code's 24th entry (index 23), left off while empty so older
codes re-export unchanged: `{ k, o, e, r, x, b, pd, ep, pl, log: [[friday, cup index, placing]] }` (see the top of
tourney-items.js). At most 104 shelf rows.

## Changing it (for the lead)
- Never reorder `CUPS` (the shelf stores the cup index) and never edit `CLANS`, `POOL_SEED` or the tags in botpool.js.
- Retuning a cup's rounds, limits or the strength numbers changes brackets from the next weekend on; change them
  between weekends.
