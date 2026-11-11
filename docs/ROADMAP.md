# Roadmap (owner-approved order, 2026-11-10)

The owner asked for one section at a time, each a big overhaul, and approved working through the night without stopping
("feel free to add any additional content you feel would make an impact"). Rules: push to GitHub (dev and main) as
each section completes, at most 4 agents including the lead, peer-to-peer only (no servers, no TURN), bump js/build.js
on every push, keep 2% of weekly usage for bugs.

1. Maps overhaul: DONE (1110-8). 20 maps, six regions, four sizes. docs/MAPS-OVERHAUL.md.
2. Weapons part 1: DONE (1110-10). 16 new guns incl. Melee, 8 attachments, balance, aim assist. docs/WEAPONS-OVERHAUL.md.
3. Weapons part 2, look and sound: DONE (1111-1).
4. DONE (1111-2). Lethals and tacticals overhaul: new items, identities, counters, mastery, bots that use them well.
5. DONE (1111-3). Engine performance (the BR prerequisites in docs/BR-PERF.md): spatial grid for walls, nav and bot thinking budgets,
   chunked world rendering with distance culling, snapshot interest management. Speeds every existing map too.
6. Balance follow-up from real stats (docs/stats-2026-11-10-c.txt): in real lobbies Foreman is still far ahead
   (owner 3.52 K/D with it, everyone 2.25) and shotguns still lose badly (Squall 0.20, Doublet 0.17, Railspike 0.32),
   which the bot-only rig did not show. Rerun the rig with streaks, equipment, Mixed skill and the human-like thumb.
   Pass 2 done (bal2): `--realistic` rig preset, Foreman head cap, shotgun/SMG/sniper help, build tag in stats; see
   docs/WEAPONS-OVERHAUL.md "Pass 2". Open: equipment costs shotguns and snipers 0.2-0.3 K/D in real lobbies.
7. DONE (1111-8): battle royale (docs/BR.md): 32 players (up to 8 humans, the rest bots), squads of 4 (plus duos/solos), giant map stitched from
   the regions, loot rarities, closing circle, revives, bots that loot, rotate and fight like players.
8. DONE (1111-4). Scorestreaks overhaul.
9. DONE (modes). Game modes overhaul (docs/MODES.md): Headquarters, Kill Order, Infected, One in the Chamber, Control,
   Grind, Ground War HQ and Kill Order; modifiers (Hardcore, Snipers Only, Melee Only, No Streaks); a daily featured playlist.
10. DONE (atts). Attachments wave: 66 signature attachments, 12 conversion kits, unlocked through weapon levels and the
    mastery ladder; best-build balance rig (dev/best-builds.mjs). docs/WEAPONS-OVERHAUL.md "Attachments wave".
11. DONE (ops). Operators overhaul: 27 operators (18 new, nine of them women) from a parametric parts kit, builds in the
    shader, four mastery skins each, challenge unlocks, a scrolling operator screen, bots in a mixed seeded order.

## Owner's next wave (2026-11-11 morning)
12. DONE (fixes). Quick fixes: calling card progress bars; results screen challenges scroll; duplicate names across guns, perks,
    equipment, streaks and operators (e.g. Bulwark gun and Bulwark tactical); operators screen text.
    Name audit (fixes): every display name across guns, attachments, perks, equipment, streaks, operators and their
    skins, maps, modes, medals, calling cards, emblems, camos, tracers and kill effects; ids unchanged. Renamed:
    tactical Bulwark -> Rampart (the LMG keeps Bulwark; its mastery card is now "Rampart Master"); Anvil skin Bulwark ->
    Bastion; Flint skin Shaped Charge -> Detonator (the attachment keeps it); Halcyon skins Glacier -> Icefall, Polar
    Night -> Long Night, Whiteout -> Snowblind (camos and the Frostline card keep theirs); Trooper skin Sovereign ->
    Imperial; Anvil field skin Foundry -> Forgehand; Flint skin Hazard -> Hi-Vis (Ram keeps Hazard); Ox skin Furnace
    -> Smelter (Ram keeps Furnace); Coyote skin Dust Devil -> Sirocco; Sable skin Oasis -> Lagoon; Mako skin Deep Water
    -> Riptide; Marshal skin Old Guard -> Grey Guard (the emblem keeps it); every operator's base skin "Standard issue"
    -> "<Operator> issue"; card Wingman (500 assists) -> Right Hand (the streak keeps Wingman); card Night Market ->
    Neon Lights (the map keeps it); cards Sovereign, Molten Core, Prism -> Gold Standard, Meltdown, Kaleidoscope (the
    camos keep theirs); prestige title Engineer -> Engine Driver (the perk keeps Engineer); kill effect Standard -> No
    Effect (the tracer keeps Standard); medals Kill Confirmed -> Tag Confirmed (the mode keeps it), Last One Standing ->
    Last Gun Standing (the S&D card keeps it); emblems Whiteout -> Frostbite, Prism -> Refraction, Live Wire -> Spark
    Gap. The Harrier (id `scout`) clashes with nothing (the streak is Recon Drone). Left on purpose: each prestige
    rank's calling card is named after its rank, and signature attachments carry their gun's name (Kiln Baffles).
13. DONE (fixes). Gunsmith overhaul: weapon classes as big tiles in a horizontal scroller on top, that class's guns as big cards in a
    vertical scroller below; attachments list with smooth native scrolling; nothing cramped or overflowing.
    Built as two views in js/ui/gunsmith.js: pick (class tiles in a snapping .scroll-x strip, gun cards with picture,
    level and mastery steps in a .scroll-y grid) and bench (preview, bars, facts; tabs with the slots in a column beside
    a native .scroll-y parts list, 44 px rows, Signature/Kit chips and the delta strip kept). Opened from a loadout's
    Gunsmith button it starts on that gun's bench ("Guns" goes back to the pick view, "Done" leaves). Guarded by
    dev/ui-overflow-test.py (every menu and the gunsmith at 667x375 and 852x393, plus touch drags on its scrollers).
14. DONE (1111-12). Multiplayer restructure: "Play vs bots" becomes Multiplayer with tabs Standard / Ground War / Battle Royale (later the
    extraction mode); you pick a mode or mix and get a match; map is random or a vote of 2-3. Custom has two tabs:
    Match (map, mode, bots, difficulty, modifiers; friends can join) and Training (the range, or any map with N bots,
    infinite ammo, no death, bot behaviour options, damage readout; never counts toward progress).
15. DONE (1111-12). Bot overhaul: a pool of 150+ named bot players with persistent profiles (level, loadout habits, play style), most with
    a hidden skill range and a random per-match form, some locked at a tier; smarter decisions at every tier; the
    difficulty selector only in Custom.
    DONE (bots): docs/BOTS.md. 200 seeded profiles (js/shared/botpool.js), a fifth locked; matchmaking by rating and
    level into `buildRoster(..., { pool })`; `careerAt(profile, date)` for item 16; bots trade, hear footsteps, peek
    from cover, pre-aim lanes; weak bots tunnel and overpeek; SMGs fight to 72% of their range.
16. Leaderboards: bots' careers grow deterministically by date; friends' career summaries are swapped in shared lobbies and
    saved "as of" that match; boards for level, kills, K/D, wins, BR wins/top 5, extractions, mastery, weekly.
17. Extraction mode (our own name, not "DMZ"): 4 squads of 4 (or duos) on Frontier, empty slots filled with bot squads;
    AI patrols harder toward the centre; contracts (intel, HVT, cache, hack, escort); own loadouts; only ammo loot; no
    streaks; respawn timer but a shared squad life pool, then spectate; must exfil to bank rewards (one squadmate out is
    enough); rewards are mastery progress plus exclusive streaks, weapons, perks and operators.
