// Player-facing changelog, newest first. "What's new" (js/ui/whatsnew.js) shows every entry newer than the build this
// phone last saw; Help > Updates lists them all. Add a row on every push that changes something a player can notice:
// `build` must match js/build.js BUILD for that push. Plain words, no internal names.

export const CHANGELOG = [
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
