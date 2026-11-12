// Player-facing changelog, newest first. "What's new" (js/ui/whatsnew.js) shows every entry newer than the build this
// phone last saw; Help > Updates lists them all. Add a row on every push that changes something a player can notice:
// `build` must match js/build.js BUILD for that push. Plain words, no internal names.

export const CHANGELOG = [
  {
    build: '1111-33', date: '2026-11-12', title: 'Weapon balance after the new attachments',
    items: [
      'Toned down: Kestrel (slower, one-shot range 18 m, a touch slower to aim), Bulwark, Millrace, Gantry, Tallyman, Kiln and Monolith (all fire a little slower).',
      'Toned up: Foreman (faster, steadier), Murmur (faster, keeps its damage a little further), Thistle and Railspike (faster), Trammel and Skitter (full damage a metre further).',
      'Snap Sight: scopes in a little slower.',
      'Assault Box (Bulwark): no wind-up as before, but it fires slower, overheats sooner and is less of a speed boost.',
      'Signatures that made their gun too strong are trimmed (still upgrades over stock): Pre-Spun Motor, Overdrive Motor, Loop Lever, Hot Chamber, Capacitor Bank, Long Belt, Bedded Receiver and Mule Rounds.',
      'Signatures that held their gun back cost less: Muffled Bolt and Ram Rounds no longer slow the fire rate, Featherweight Frame no longer cuts range, Buck and Ball is no wider from the hip, and Hopper Gyro, Box Twelve and Recurve Limbs no longer slow you down.',
    ],
  },
  {
    build: '1111-32', date: '2026-11-12', title: 'Graveyard Shift: somewhere to spend your points',
    items: [
      'Upgrade bench: bring the gun in your hands to the bench and it comes back stronger, with a bigger magazine and more ammo. Three tiers (5,000, 15,000 and 30,000 points); the third adds special rounds that set the undead burning, arc between them, burst on impact or slow them down, depending on the gun. Upgraded guns glow and fire coloured tracers, and keep their tier when you swap.',
      'Supply terminal: buy a Sentry Gun, an Air Strike on the thickest crowd near you, a Hunter Drone, a Lure that draws the undead in and then blows, or an Armour Vest. One of each per round; prices rise as the rounds go on. Your class scorestreaks no longer work in Graveyard Shift, for you or the bots.',
      'Traps at chokepoints: the Live Rail, the Firedamp Vents and the Threshers. Pay to switch one on for 30 seconds. They shred the undead (for fewer points than a gun kill) and sting anyone standing in them.',
      'Armour plates: up to three, bought at the armour bench, shown over your health bar. They take the undead\'s hits first.',
      'Two new perk machines: Fleetfoot (faster sprint and slides) and Last Breath (go down and get yourself back up, once every three rounds). You can hold four perks; a perk slot at any machine raises that to six.',
      'From round 15 you can call the exfil at the exfil pad. Hold out on the pad for 60 seconds against everything that comes, and get out for big XP and an "Escaped on round" record for the map.',
      'Something is hidden on every map. Find three old lanterns and set them on the altar to wake the Gravewarden. Put it down for a lot of XP, points for the whole crew and a new calling card, Lantern Out.',
      'Bot teammates use all of it too: they upgrade their guns, buy plates and supplies, and switch traps on when the undead pile in.',
    ],
  },
  {
    build: '1111-31', date: '2026-11-12', title: 'Recall Beacons, boxing gloves and a better crate',
    items: [
      'Battle royale: Recall Beacons. When a squadmate is eliminated their tag drops where they fell. Pick it up, hold it at a Recall Beacon for a few seconds and they parachute back in beside it with a basic kit. Each beacon works once, everyone nearby can hear and see one in use, and they go offline from the fifth circle.',
      'Beacons show on the map and minimap while you have a squadmate to bring back. In Rebound they switch on once redeploys are over.',
      'The drop map shows how many players are still aboard the transport and whether each squadmate is aboard, gliding or landed. You can also see them sitting on the transport.',
      'Battle royale fists are now boxing gloves, with a proper punch and a boing when it lands. They hit as hard as before.',
      'No more gun slots on the battle royale HUD: Swap changes guns. When both guns run dry your fists come out by themselves, and walking over ammo for one of your guns brings it back.',
      'Graveyard Shift: wall guns glow, and you can see them and the mystery crate through walls. The crate is a proper crate now: the lid opens, guns spin up out of it, your pick floats until you take it, and it flies off to its next spot.',
      'Headquarters: fixed the next HQ sometimes never appearing after one was destroyed or moved.',
      'Control: fixed a single attacker being unable to take a zone.',
    ],
  },
  {
    build: '1111-30', date: '2026-11-12', title: 'Graveyard Shift: Ashgrove Halt',
    items: [
      'A new map built for Graveyard Shift: Ashgrove Halt, a country rail halt and its churchyard on a foggy night. Start on the platform and open your way round the goods yard, the churchyard, the burial field and the level crossing.',
      'The power is out at Ashgrove: the perk machines stay dark until someone reaches the pump house in the middle of the map and throws the switch. It costs nothing, but you have to get there.',
      'On boss rounds the Yardmaster rises in the burial field, open ground round the old memorial with room to run.',
      'Three dead ends hide the mystery crate: the lamp room, the crypt and the coal stage.',
      'Playing solo with bots, a bot teammate will go and turn the power on after round 2 if you have not.',
    ],
  },
  {
    build: '1111-29', date: '2026-11-12', title: 'A cleaner Multiplayer screen and menu fixes',
    items: [
      'Leaderboards: players on the same level are ranked by their total XP instead of sharing a rank.',
      'The Multiplayer screen is redone: clear tabs across the top, one smooth scrolling list, Ranked and today\'s featured playlist together in a Spotlight at the top, and the Hardcore switch and Find match in a tidy bar at the bottom.',
      'Battle Royale lists its playlists side by side under Battle Royale and Rebound, so every name fits.',
      'Help > Updates and every long Help page scroll smoothly again.',
      'Leaderboards: big numbers fit. XP over a million reads 2.1M, and a maxed player\'s row shows their level over their XP.',
      'Gunsmith camos sit in an even grid with space between them, each with its name underneath.',
      'Options: rows no longer run into each other on smaller phones; a column scrolls when it is full.',
      'Rebound: the map vote names the right playlist, and the redeploy messages fit on screen.',
    ],
  },
  {
    build: '1111-28', date: '2026-11-12', title: 'Prestige and Master Prestige',
    items: [
      'Every prestige rank now brings its own camo for every gun, alongside its icon and calling card. Ranks you already hold have theirs waiting.',
      'Entering prestige plays a new reveal: your new icon, its camo and calling card, and what the next rank brings.',
      'New Prestige view: tap the rank ladder in your service record to see every rank and its rewards, and what comes next.',
      'Master Prestige: past Prestige X at level 50 your level keeps counting, up to Master 1,000, with a new icon every 100 levels and cards, camos and an emblem along the way. Prestige X players start at the Master level their XP has already earned.',
      'Master levels show wherever a level does: your player card, lobbies, scoreboards, the kill feed, results and the boards. The busiest bot players are Masters too.',
    ],
  },
  {
    build: '1111-27', date: '2026-11-12', title: 'Accessibility',
    items: [
      'New in Options: Accessibility. Colour modes for red-weak, green-weak and blue-weak eyes, and a high contrast mode. They change team colours everywhere: players, rings, the minimap, the kill feed, objectives, squads and loot.',
      'In a colour mode enemies also differ in shape: their rings are dashed and their kill feed rows are striped. Battle royale guns show their rarity as pips.',
      'Touch layout: drag the sticks, buttons and streak tiles where your thumbs want them and make them bigger or smaller. It is mirrored when you play left-handed, and nothing can end up under another control or the HUD.',
      'Reduce shake and flashes: less camera shake, dimmer explosions, a dark flashbang instead of a white one, and no blinking warnings.',
      'Sound cues: a marker points at grenades landing near you. You can also turn on footsteps, shown as an arc on the side they come from.',
      'A larger text size for menus.',
      'The emote row on the title screen no longer covers the Join and Browse buttons on smaller phones.',
    ],
  },
  {
    build: '1111-26', date: '2026-11-12', title: 'Sixteen new attachments',
    items: [
      'Sixteen new attachments, so every gun has more to choose from in each slot. Snipers, pistols, shotguns and launchers gain the most.',
      'New optics: Flip Irons, Prism 2x, Tac Laser and, for launchers, a Rangefinder. New barrels: Birdcage Hider, Tank Brake, Vent Rib, and a Venturi Nozzle and Guide Rail for launchers.',
      'New magazines: Subsonic Rounds for SMGs and pistols, Magnum Shells and Flite Wads for shotguns, Light Rockets for launchers. Taped Mags now fit SMGs and pistols too.',
      'New grips: Rubber Sleeve, Thumb Rest and Beavertail.',
      'Every new part shows on the gun, in the Gunsmith and in the match. Each one gives something and costs something: the Gunsmith lists exactly what it changes.',
      'They unlock as your guns level up, spread from level 4 to 28. Bots use them too, and they turn up on guns in battle royale.',
    ],
  },
  {
    build: '1111-26', date: '2026-11-12', title: 'Finishing moves and emotes',
    items: [
      'Finishing moves: get close to a downed enemy, or to one with their back to you, and tap Finish (or press Melee on a controller, or swing a blade). You both play out the move, then they are out.',
      'You are both open while it plays: if anyone shoots you mid-move, it stops and your target gets away.',
      'Six finishers to earn through levels, operator mastery and the season track. Pick one for each operator in the Operators screen.',
      'Emotes: a new button beside quick chat opens a wheel of eight, from Wave and Salute to the Yard Shuffle. Moving or firing stops one. Try them on the title screen too.',
      'Kills from a finisher show as FINISHED in the feed and the killcam. Bots use finishers and emotes now and then.',
      'Graveyard Shift now has its own sounds: the undead groan and claw, the mystery crate plays its tune, and perk machines, wall-buys, gates and every round start and end have a sound of their own.',
    ],
  },
  {
    build: '1111-25', date: '2026-11-12', title: 'Every phone, and an install guide',
    items: [
      'Android phones are welcome: Chrome and Samsung Internet now fit the game to the screen, go full screen with a tap and hold it sideways.',
      'On Android the back gesture goes back one screen instead of closing the game. On the title screen, back twice to close.',
      'Install the game as an app on Android, with its own icon. Chrome and Samsung Internet offer an Install button.',
      'Graphics quality now starts at a better level for your phone, older iPhones and Android phones included, and steps down sooner if the frame rate drops.',
      'New option on Android: Vibrate on hits (off unless you turn it on).',
      'How to play > Install shows how to add Switchyard to your Home Screen on iPhone or Android, step by step for your browser.',
      'It also explains where your progress lives: only on this phone, nothing sent to a server. Keep your Save code as a backup to move to another phone or recover after clearing website data.',
    ],
  },
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
