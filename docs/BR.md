# Battle royale (V12): design and the contract between its two builders

Owner's idea: a 32-player lobby with up to 8 real players and the rest bots, so even in quads every human faces at
least 4 other humans (squads or solo). Squads of 4 by default; duos and solos as options. Bots must feel like players:
loot, rotate with the circle, hold buildings, third-party fights, revive teammates. Peer-to-peer only: the host phone
runs the sim (docs/BR-PERF.md "After" says what the engine can do now: grid walls, two-level pathing, thinking
budgets, per-guest snapshots, tiled rendering).

## Two builders, one contract
- MAP builder: `js/shared/maps/br-*.js` (the giant map, id `frontier` or a better name) and its region art.
- MODE builder: everything else (rules, loot, circle, squads, downs and revives, inventory, bots, HUD, menus, lobby).
The MODE builder starts on the procedural giant test map (dev/br-perf.mjs brMap) and swaps to the real map when it
lands. Both stick to this map contract:

```js
{
  id, name, size: 'giant', region: 'mixed', width, height,     // about 400 x 400 m (may go to 480 if it plays better)
  walls, nav, decor,                                            // as every map
  modes: ['br'], large: true,
  br: {
    pois: [{ id, name, x, z, r, region, tier }],                // 12-18 named places; tier 1 best loot, 3 sparse
    loot: [{ x, z, tier, indoor }],                             // 500-900 floor loot spots (most indoors)
    chests: [{ x, z, tier }],                                   // 30-60 supply caches (better rolls)
    drop: { from: { x, z }, to: { x, z } } | null,             // null: the mode picks a random flight line
    circleBias: [{ x, z, w }],                                  // optional weights for where final circles may end
  },
}
```

## Rules (MODE builder decides the numbers, these are the shape)
- Drop: everyone rides a transport across the map; tap to jump; a short glide lets you steer to a spot. Bots pick
  POIs spread out, with some hot drops.
- Loot: floor guns of every class with rarity tiers (common, uncommon, rare, epic, legendary) that add attachments
  (reuse js/shared/attachments.js) and better base kits; ammo by type; armor plates (3 slots, plate up takes time);
  lethals/tacticals from the gear catalog; consumables (medkit, plate, a self-revive kit). Two primary slots plus
  melee or pistol; a light, readable inventory on a phone (auto-pickup ammo and plates, tap to swap guns).
- Your own loadout: not used in BR except operator, skins and camos (cosmetic). Kills feed weapon XP and mastery.
- Circle: 6-7 phases, shrinking, damage that rises per phase, visible on the minimap and as a wall in the world.
- Downs: in squads, lethal damage downs you (crawl, bleed out); a teammate revives by holding near you; a squad is out
  when all are down or dead. Optional later: redeploy/respawn beacons.
- Win: last squad standing. Placement, kills and revives give XP and a BR results screen.
- Streaks: none in BR, but kill streak score can buy care packages or UAV scans from loot (MODE builder's call).
- Networking: up to 8 humans; bots are on the host. Rejoin uses the held-slot system (a dropped player's character
  stays down or idle, never bot-driven). Late joiners cannot drop in after the jump.
- Phones: the 32-player match must hold 60 fps on Low on the reference profile with the tiled world; the host's sim must
  stay under 4 ms per tick average.
