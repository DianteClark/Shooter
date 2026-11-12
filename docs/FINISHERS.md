# Finishing moves and emotes (roadmap item 32)

## Finishers
Melee an enemy who is **down** (battle royale, Rebound, extraction) or who has **their back to you** (every mode except
Graveyard Shift) to play a finishing move: both players are locked in the animation for 1.2 to 1.8 s, then the target
dies. Both are exposed while it plays: **any damage to the attacker cancels it** (the target is let go, still down if
they were). A target killed by someone else, a death or a disconnect also ends it.

- Reach: 2.4 m to a downed enemy (any side), 2.0 m from behind (the target's facing points away from you:
  `cos < -0.2`), in line of sight, not spawn protected, not in the air, not already in a finisher. The host allows
  0.8 m of slack on a phone's request. Rules: `finishable()` in `js/shared/finishers.js`, `canFinish()` in
  `js/sim/finishers.js`.
- How: the **Finish** button (prompt lane, shows while someone qualifies, with their name), a controller's **Melee**,
  or swinging a blade at someone who qualifies. The phone names the target it sees (`{cmd:'finish', target}`); the
  host decides.
- Host sim (`js/sim/finishers.js`): `startFinisher` steps the attacker to arm's length (0.85 m) on the line they came
  from and pins both (`pin`, every tick, and over late phone states in `applyHumanState`); no shots, throws or bot
  thinking while pinned. `stepFins` ends it with a `hit` (`fin:1`) and a `kill` carrying `fin: <id>` through the usual
  `_kill` (score, streaks, medals, assists, battle royale and mode rules all as for any kill). `cancelFin` emits
  `finx {by, target, why:'hit'|'broken'}`. Revives and self-revives wait while a downed player is being finished.
- Wire: events `fin {by, target, k, x, z, down}`, `finx`, `kill.fin`; the snapshot carries a trailing block after the
  player records, `[attacker index, target index, finisher index, centiseconds in, ...]` (also in per-guest
  snapshots). Decoded players have `fin = {k, role:'a'|'v', other, t, dur}` or null. Each phone locks its own player
  while its record has a `fin` (`match.js #stepLocal`: no input, stands where the host pinned it).
- Determinism: bot rolls use their own seeded stream (`sim.finRng`), so a seed replays its finishers and matches with
  none are unchanged.
- Bots: a bot with someone in reach takes the finisher now and then (45% on a downed enemy, 55% from behind); one that
  sees an enemy's back (or a downed enemy) within 10 m may creep up for one (30-50%, `p.finStalk`, followed in
  `BotBrain.update` through `stalkInput`). A bot that finishes someone sometimes taunts after.
- Seen: poses in `js/render/finisher-anim.js` (a layer the rig adds: lean, twist, travel, gun offsets and stowing,
  hand targets, lying face down or on the back), the target jolting on each blow; the killcam replays it and its banner
  says "Finished" / "X finished you"; the feed tags the kill FINISHED, the death card says "Finished by". Sounds:
  `js/audio/fin-sfx.js` (grab, blows on the audio clock, the kill; a cancel drops the blows still to come).

| Id | Name | Length | Unlock |
|---|---|---|---|
| lights | Lights Out | 1.3 s | default |
| switchback | Switchback | 1.5 s | level 8 |
| coupling | Hard Coupling | 1.6 s | level 22 |
| railspike | Railspike | 1.5 s | operator mastery tier 3 (any operator) |
| lastcall | Last Call | 1.2 s | season track tier 30 (any season) |
| derail | Derail | 1.8 s | operator mastery tier 5 (any operator) |

Picked per operator on the Operators screen (the Finisher row in the operator's file), saved as `save.finishers`
`{operator: id}` (save code tail slot 20). A pick that is no longer unlocked plays the default. The roster carries it
as `loadout.finisher`; bots get one by seat.

## Emotes
Eight short emotes on a 4 x 2 wheel (the Emote chip beside quick chat, or a controller's Emote wheel action, unbound
by default): Wave, Salute, Over There, Thumbs Up (default), Laugh (level 6), Yard Shuffle (level 15), Come On (level
28), Turntable (season tier 20). `{cmd:'emote', e}` to the host, which rate limits it (1 s) and sends `emote {id, e}`
to everyone; the character plays it (`emotePose`) until it ends or its player moves, fires, goes down or is caught in
a finisher. During battle royale's pregame (aboard the transport, where nobody is drawn) a squadmate's emote shows as a
feed line. On the title screen the Emote button plays one on the operator in the yard.

## Graveyard Shift sounds
`js/audio/zm-sfx.js`, all synthesised: groans from the undead near you (runners rasp, brutes and the boss bellow; more
often the more there are), claw swipes and hits, the mystery crate (lid, music box while it rolls, offer chime, the
toll and laugh when it moves), perk machines, wall-buys and ammo (ka-ching), gates, round start (boss rounds deeper),
round cleared, the crew falling, power-ups and drops.

## Tests
`node dev/sim-finishers.mjs [--quick]` (rules, finish, cancel, downed and revive, wire, emotes, bots and determinism);
`python3 dev/ui-finishers-test.py <port>` (title emote, operator finishers, a finisher and its cancel in a match, the
emote wheel).
