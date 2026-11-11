# Roadmap (owner-approved order, 2026-11-10)

The owner asked for one section at a time, each a big overhaul, and approved working through the night without stopping
("feel free to add any additional content you feel would make an impact"). Rules: push to GitHub (dev and main) as
each section completes, at most 4 agents including the lead, peer-to-peer only (no servers, no TURN), bump js/build.js
on every push, keep 2% of weekly usage for bugs.

1. Maps overhaul: DONE (1110-8). 20 maps, six regions, four sizes. docs/MAPS-OVERHAUL.md.
2. Weapons part 1: DONE (1110-10). 16 new guns incl. Melee, 8 attachments, balance, aim assist. docs/WEAPONS-OVERHAUL.md.
3. Weapons part 2, look and sound: IN PROGRESS (branch wpn-feel).
4. Lethals and tacticals overhaul: new items, identities, counters, mastery, bots that use them well.
5. Engine performance (the BR prerequisites in docs/BR-PERF.md): spatial grid for walls, nav and bot thinking budgets,
   chunked world rendering with distance culling, snapshot interest management. Speeds every existing map too.
6. Balance follow-up from real stats (docs/stats-2026-11-10-c.txt): in real lobbies Foreman is still far ahead
   (owner 3.52 K/D with it, everyone 2.25) and shotguns still lose badly (Squall 0.20, Doublet 0.17, Railspike 0.32),
   which the bot-only rig did not show. Rerun the rig with streaks, equipment, Mixed skill and the human-like thumb.
7. Battle royale: 32 players (up to 8 humans, the rest bots), squads of 4 (plus duos/solos), giant map stitched from
   the regions, loot rarities, closing circle, revives, bots that loot, rotate and fight like players.
8. Scorestreaks overhaul.
9. Game modes overhaul (new modes built on the new maps).
10. Attachments wave: signature attachments per gun, conversion kits, unlocked through each gun's mastery.
11. Operators overhaul: many more unlockable operators including female operators; mastery for them.
