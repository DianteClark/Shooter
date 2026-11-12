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
16. DONE (1111-13). Leaderboards: bots' careers grow deterministically by date; friends' career summaries are swapped in shared lobbies and
    saved "as of" that match; boards for level, kills, K/D, wins, BR wins/top 5, extractions, mastery, weekly.
    DONE (boards). Save v4 gains `career` (appended, defaults; old saves and SY4 codes seed it from the lifetime tally,
    and a code with nothing new re-exports unchanged): matches, kills, team wins, BR matches/wins/top 5, extractions
    (`recordCareer` takes `extracted` from the extraction mode), K/D over tracked matches only, and a weekly window
    (Monday, local). Lobby message `career` (guest to host) / `careers` (host relays all): Progress.careerCard() only,
    ~230 bytes; friends kept in `switchyard.friends`, newest 100, "as of" the last shared lobby or match. Boards screen
    (js/ui/boards.js; title and Gun stats): 10 categories (K/D needs 25 matches), Everyone / Friends / Around me; pool
    rows from careerAt on the local date read as UTC (identical on every phone that date), clan tag slot via clanOf,
    `poolWindow(from, to)` for seasonal boards. No per-match bump for bots you met: it would differ between phones.
    Tests: dev/sim-boards.mjs, dev/ui-boards-net-test.py, overflow scenes boards*.
17. DONE (exfil, docs/EXTRACT.md). Extraction mode (our own name, not "DMZ"): 4 squads of 4 (or duos) on Frontier, empty slots filled with bot squads;
    AI patrols harder toward the centre; contracts (intel, HVT, cache, hack, escort); own loadouts; only ammo loot; no
    streaks; respawn timer but a shared squad life pool, then spectate; must exfil to bank rewards (one squadmate out is
    enough); rewards are mastery progress plus exclusive streaks, weapons, perks and operators.

## Owner's wave (2026-11-11 afternoon), approved "full force"
18. DONE (1111-15). Owner fixes: Infected Ground War (two starting infected); gunsmith gun cards' level/XP bar at the bottom of the card,
    clear of the picture; BR: parachute folds on landing, visible glide descent and a landing animation instead of
    spawning on the ground; BR pickup prompt bottom-centre (not over the aim stick), naming the slot it replaces, and
    auto-swap to melee when out of ammo; wiped BR players choose Spectate or Leave.
19. DONE (1111-15). Clans: grow the bot pool to about 300 (append, never reorder); 20-25 fake clans of 3-8 with shared tags, some
    stacked, some average, members queue together and share a team; regular duos; loners. Clan tags on leaderboards.
20. Bug sweep (every mode and screen at both sizes, saves, friend lobbies) and a phone performance pass (with the
    owner's Performance overlay screenshots).
21. DONE (seasons). Ranked: placements, divisions, seasonal resets, matched against the bot pool and friends. docs/SEASONS.md.
22. DONE (1111-17). Seasons: date-driven, no server. Each ~6 weeks: free 100-tier reward track, weekly challenge sets, a featured
    mode/event, ranked reset, seasonal boards. Ship two seasons ahead per update, content date-locked; if updates stop,
    "Season Replay" rotates past seasons. Season 1 with the framework.
    DONE (seasons): docs/SEASONS.md. Season 1 Cold Iron (2026-11-16), Season 2 Signal Fire (2026-12-28), then Season
    Replay; free 100-tier track, weekly sets, an event playlist each, ranked reset, Season boards view and Ranked category.
23. Accessibility: colorblind modes, adjustable control layout and sizes, left-handed check.
24. DONE (1111). Music: synthesised menu and match music. js/audio/music-synth.js (instruments, arrangements, offline render),
    js/audio/music.js (director: scenes, layers, stings; music.cue(...)). Options: Music slider, "In matches" switch.

## Owner's wave (2026-11-11 evening), approved "do em all with confidence" (target: 80% of the week, keep 20% for fixes)
25. DONE (1111-21). BR and modes sweep (owner's notes): drop the "Close map" button on the BR drop screen; flight lines vary (edges as
    well as the middle); bot squadmates must not copy the player's input after an app switch; BR heals with medkits only
    (no regen; extraction keeps regen); calmer early bots (loot and rotate first) and somewhat shorter rings so matches
    reach the late circles; one Hardcore switch on the playlist screen applying hardcore rules to every mode; Control
    spectates the remaining players once your side is out of lives.
26. DONE (zombies). Zombies: co-op wave survival for up to 4 (friends or bots), points, wall-buys, mystery box, doors, perk machines,
    a boss every 10 rounds, on existing maps. Graveyard Shift on Night Market, Ruins and Foundry; docs/ZOMBIES.md.
27. DONE (modes2). Resurgence BR: small map, fast circle, redeploy while any squadmate lives. Rebound (Quads 24, Duos 20) on a
    seeded 150 m part of Frontier, a 9-minute circle, redeploys until circle 5; docs/BR.md "Rebound".
28. DONE (voice). Voice chat with friends: peer to peer audio over the existing connection, push-to-talk or open mic, per-player mute.
    Options Mic chip (Open / Hold to talk); party voice in the friend lobby (mic in the lobby header); mute plates on the
    lobby cars and the scoreboard rows; talking marks from RTP audio levels; docs/CONTROLLER.md (Voice).
29. DONE (voice). Controller support: the Gamepad API (PlayStation, Xbox, MFi), remappable, menus navigable.
    js/ui/gamepad.js, Options > Controller (remap, deadzone, aim sensitivity, invert Y); docs/CONTROLLER.md.
30. Attachments wave 2: more attachments per gun, visible on the model.
31. DONE (modes2). Gunfight 2v2: short rounds, the same random loadout for everyone, small maps. Showdown on Pier, Turnstile,
    Oasis and Ruins: first to 6, 40 s rounds then an overtime flag, enemy health over their heads; docs/MODES.md "Showdown".
32. DONE (finishers). Finishing moves and an emote wheel: six finishers (melee a downed enemy or one with their back
    turned; both locked, the attacker can be shot to cancel), picked per operator, unlocked by level, operator mastery
    and the season track; eight emotes on a wheel beside quick chat (and on the title's yard operator); bots use both;
    Graveyard Shift sounds. docs/FINISHERS.md.
33. Daily challenges feeding season XP (alongside the weekly sets).
34. DONE (NEXT). Every phone: Android (Chrome/Samsung Internet) and all iPhone sizes and ages, with quality tiers picked per device,
    touch and safe areas checked on both; an install guide in the game (Add to Home Screen on iOS Safari, Install app
    on Android Chrome) with a plain explanation of where progress lives (on the phone, in the browser's storage for
    this site; the save code is the backup; nothing is sent to a server; clearing site data or deleting the app
    without a code loses it). Device tiers by GPU/memory/screen with per-tier DPR caps, Android full screen, back
    gesture, vibration option, install worker and manifest, How to play > Install; docs/DEVICES.md.
35. Signature attachments read as clear upgrades: DONE (1111-18), strengths x1.5, costs halved.
