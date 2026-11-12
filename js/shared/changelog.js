// Player-facing changelog, newest first. "What's new" (js/ui/whatsnew.js) shows every entry newer than the build this
// phone last saw; Help > Updates lists them all. Add a row on every push that changes something a player can notice:
// `build` must match js/build.js BUILD for that push. Plain words, no internal names.

export const CHANGELOG = [
  {
    build: '1111-24', date: '2026-11-11', title: 'Rebound and Showdown',
    items: [
      'New on the Battle Royale tab: Rebound. A fast battle royale on one part of Frontier, in squads of four or pairs, with a quicker circle and matches of about eight to ten minutes.',
      'In Rebound, die while a squadmate is still in and you parachute back in next to them after a short countdown, with a gun, a sidearm and some armor. A note under your squad says at which circle redeploys end.',
      'New on the Standard tab: Showdown 2v2. Short rounds on the small maps, one life each, first to 6 rounds. Play it with a friend or with a bot partner.',
      'In Showdown everyone gets the same random kit, a new one every two rounds. Enemy health shows over their heads, and if the clock runs out a flag rises in the middle: stand on it to win the round.',
      'Showdown joins the featured playlist rotation and the daily challenges. Both modes are explained in How to play > Modes.',
    ],
  },
  {
    build: '1111-23', date: '2026-11-11', title: 'A cleaner match HUD',
    items: [
      'The weapon and ammo panel now sits up by the top corner, clear of the aim stick, on every iPhone size.',
      'Battle royale and extraction: each teammate is one tidy row with their name, a health bar and a thin plates bar. Downed shows red with a down mark, out is greyed. Longer names fit.',
      'When you are out and spectating, the weapon panel goes away and the Eliminated banner moves up, clear of both sticks.',
      'The FPS readout is now one small line in the bottom corner, so it no longer covers the contract tracker or anything else.',
      'Kill feed rows always stay inside their box: long names are shortened, and the words (like "was infected") stay readable.',
      'New HUD size option (Small, Normal, Large) in Options.',
    ],
  },
  {
    build: '1111-22', date: '2026-11-11', title: 'Controllers and voice chat',
    items: [
      'Play with a controller: PlayStation, Xbox and iPhone (MFi) controllers work on iPhone and Android. Left stick moves, right stick aims, triggers aim and fire, and every action has a button, including reload and melee.',
      'Menus work with a controller too: the d-pad moves, A or Cross picks, B or Circle goes back, the shoulder buttons switch tabs.',
      'The on-screen sticks hide while you use a controller and come back as soon as you touch the screen.',
      'Options > Controller: change any button, set the stick deadzone and aim sensitivity, or invert the right stick.',
      'Voice chat: choose open mic or hold to talk in Options. Talk with friends in the lobby before the match, not only in it.',
      'Mute any one player from the lobby or the scoreboard, and see who is talking by the mic beside their name.',
    ],
  },
  {
    build: '1111-21', date: '2026-11-11', title: 'Battle royale and modes sweep',
    items: [
      'Battle royale: the drop map stays up until you jump. The Close map button is gone.',
      'The transport flies a different line each match: through the middle, across a third or near an edge, always over plenty of land.',
      'Bot squadmates no longer copy your moves after you switch apps and come back. They glide to their own spot, loot near you and watch their own side.',
      'Battle royale health only comes back with medkits. Medkits are more common, and bots heal when they need to.',
      'Calmer battle royale openings: bots loot and move before they pick fights, and get bolder as the circle closes. The first circles come in sooner and the late ones leave more room, so more squads reach the endgame.',
      'One Hardcore switch at the bottom of the Multiplayer screen turns on Hardcore for every mode it fits, in matches and in rooms you host.',
      'Control: once your side is out of lives, you watch the players still in.',
      'Infected: survivor bots hold several spots in small groups and move when the infected close in. The infected spread out and come at them from the sides.',
    ],
  },
  {
    build: '1111-20', date: '2026-11-11', title: 'Zombies: Graveyard Shift',
    items: [
      'New co-op mode: Graveyard Shift. Hold off the undead round after round on Night Market, Ruins or Foundry. Find it under Multiplayer > Zombies.',
      'Play solo with three bot teammates, or host a room for up to four friends (bots fill the empty seats).',
      'Start with a pistol. Earn points for hits and kills, then buy guns and ammo off the walls, try the mystery crate, open gates to new areas and drink four perks: Ironhide, Quickdraw, Mercy Run and Hammerfall.',
      'Shamblers, runners, brutes and a boss every tenth round. Watch for power-ups: Full Crate, Double Pay and Clean Sweep.',
      'Go down and a teammate can revive you. When nobody is left standing, it is over. Your best round on each map is saved.',
    ],
  },
  {
    build: '1111-19b', date: '2026-11-11', title: 'Leaderboards make sense',
    items: [
      'Wins boards count every win, battle royale included, and a player\'s card shows the same total.',
      'Maxed-out players on the Level board show their total XP, which is what orders them; player cards show XP too.',
    ],
  },
  {
    build: '1111-19', date: '2026-11-11', title: 'What\'s new',
    items: [
      'After an update, the title screen shows what changed. The full history is in How to play > Updates.',
      'The Update ready button now sits centred above the Multiplayer button.',
    ],
  },
  {
    build: '1111-18', date: '2026-11-11', title: 'Signature attachments',
    items: [
      'Signature attachments are now clear upgrades over the stock part: their strengths go further and their costs are halved.',
    ],
  },
  {
    build: '1111-17', date: '2026-11-11', title: 'Extraction, ranked, seasons and music',
    items: [
      'Extraction: squads of four (or duos) on Frontier. Take contracts, share a squad pool of lives and get out on the helicopter to bank rewards, including exclusive unlocks.',
      'Ranked: placement matches, divisions and a reset each season.',
      'Seasons: Season 1 Cold Iron starts November 16 with a free 100-tier reward track, weekly challenges and an event playlist. Season 2 Signal Fire follows on December 28.',
      'Music in the menus, lobbies and matches. Turn match music on in Options.',
      'Battle royale: the plane, circle wall and next-circle ring now move correctly.',
    ],
  },
  {
    build: '1111-15', date: '2026-11-11', title: 'Fixes and clans',
    items: [
      'Infected on Ground War maps, with two starting infected.',
      'Battle royale: you glide down under the parachute and land instead of appearing on the ground; the pickup prompt sits at the bottom centre; you switch to fists when out of ammo; a wiped squad can Spectate or Leave.',
      'Clans: 300 bot players, 23 clans with tags, regular duos and loners who queue together.',
      'Gunsmith: weapon level and XP sit at the bottom of the card, clear of the gun.',
      'A cleaner title screen with today\'s featured playlist on the Multiplayer button.',
    ],
  },
  {
    build: '1111-12', date: '2026-11-11', title: 'Leaderboards and bot players',
    items: [
      'Leaderboards in ten categories: Everyone, Friends and Around me. Friends\' stats swap when you play together.',
      'Multiplayer, Custom and Training replace Play vs bots. Playlists end with a map vote; Custom has every setting.',
      'Named bot players with their own profiles, form and play style.',
      'The Gunsmith was rebuilt with big gun cards and a smooth parts list; results challenges scroll; duplicate names are fixed.',
    ],
  },
  {
    build: '1111-10', date: '2026-11-11', title: 'Battle royale and new modes',
    items: [
      'Battle royale on Frontier: squads, duos and solos in lobbies of 32, with loot, plates, downs and revives.',
      'New modes: Headquarters, Kill Order, Infected, One in the Chamber, Control and Grind, plus a daily featured playlist with modifiers.',
      'Attachments wave: 66 signature attachments and 12 conversion kits, unlocked through weapon levels and mastery.',
      '27 operators, including nine women, each with mastery skins.',
    ],
  },
  {
    build: '1111-6', date: '2026-11-11', title: 'Streaks, gear and feel',
    items: [
      'Each gun wears its own camo in matches.',
      'Eight new scorestreaks; air streaks can be shot down; bots call and counter streaks.',
      'Ten new tacticals and lethals, each with a counter.',
      'Every gun has its own sound, muzzle flash and kick. The Maul swings overhead.',
      'Balance pass from real lobbies, and faster big maps on phones.',
    ],
  },
  {
    build: '1110', date: '2026-11-10', title: 'Arsenal and maps',
    items: [
      '16 new guns including a Melee class, and a full balance pass with fairer aim assist.',
      '12 new maps across six regions and four sizes.',
      'Update ready on the title screen, and the build number to check two phones match.',
      'Fixed the move stick walking on its own or going dead; the screen stays awake while the game is open.',
      'Killcam and death screen tidied up.',
    ],
  },
];
