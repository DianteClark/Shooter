// Ashgrove Halt (farmland, medium; Graveyard Shift only, ROADMAP item 38, docs/ZOMBIES.md). A country rail halt and
// its churchyard on the edge of the farm valley, at night, in the fog. Built for the zombies mode, not for 6v6: it is
// hidden from every other playlist and lists no modes of its own (MODES.zm.maps puts it in Graveyard Shift).
//
// The story, as the crew walks it (x east, z south; the camera looks north):
//   The Halt        (start, south-west)  the platform and the waiting room where the last train never came.
//   Goods Yard      (west)               the goods shed, a parked van, and the lamp room (a dead end; a crate spot).
//   Churchyard      (north)              the chapel, rows of headstones, the crypt (a dead end; a crate spot).
//   Pump Yard       (centre)             the pump house with the POWER switch, ringed by a low railing you can see and
//                                         shoot over from the churchyard and the lane: the visible heart of the loop.
//   Burial Field    (east)               the old field round the obelisk: the boss arena, open ground to kite in.
//   Crossing Lane   (south)              the level crossing and the signal box; the coal stage behind it (a dead end).
// Gates make one loop (Halt, Goods Yard, Churchyard, Burial Field, Crossing Lane, back to the Halt) with the Pump Yard
// reached from either the Churchyard or the Lane. The layout itself (gates, wall-buys, crate spots, machines, the power
// switch, spawn windows, the boss arena and the spots kept for the economy) is the `zm` block below; js/shared/zombies.js
// (zmLayout) reads it.
import { wall, perimeter, navGrid } from './build.js';

const W = 76, H = 48;
const stone = (x, z, w, d, h = 3.4, extra = {}) => wall(x, z, w, d, h, 'wall', { stone: true, ...extra });
const railing = (x, z, w, d) => wall(x, z, w, d, 1.1, 'barrier', { railing: true });
const grave = (x, z) => wall(x, z, 1.0, 0.4, 1.0, 'barrier', { grave: true });
const tomb = (x, z, w = 2.4, d = 1.2) => wall(x, z, w, d, 1.1, 'crate', { tomb: true });
const tree = (x, z, extra = {}) => wall(x, z, 1.1, 1.1, 6, 'rock', { tree: true, ...extra });

function build() {
  const walls = [];
  walls.push(
    // ---- The long walls between the areas (openings are the gates, see zm.gates).
    stone(24, 0, 1, 10), stone(24, 14, 1, 25), stone(24, 43, 1, 5),               // West wall, gates at z 10 and 39.
    stone(0, 28, 9, 1), stone(13, 28, 11, 1),                                    // Halt / Goods Yard, gate at x 9.
    stone(56, 0, 1, 9), stone(56, 13, 1, 22),                                    // East wall, gate at z 9.
    stone(57, 35, 7, 1), stone(68, 35, 8, 1),                                    // Burial Field / Lane, gate at x 64.
    railing(25, 17, 12, 1.4), railing(41, 17, 15, 1.4),                          // Pump Yard, north railing, gate at x 37.
    railing(25, 33.6, 14, 1.4), railing(43, 33.6, 13, 1.4),                      // Pump Yard, south railing, gate at x 39.

    // ---- The Halt (start).
    wall(13, 32, 8, 4.5, 3.6, 'building', { waiting: true }),
    wall(3, 37.5, 2.4, 0.8, 0.9, 'crate', { bench: true }), wall(3, 42.5, 2.4, 0.8, 0.9, 'crate', { bench: true }),
    wall(8, 32.5, 2, 1.2, 1.0, 'crate', { trolley: true }),
    wall(18, 41, 1.4, 1.4, 1.2, 'barrier', { kiosk: true }),

    // ---- Goods Yard. The lamp room in the corner: one doorway, from the south.
    stone(0, 8, 3, 1), stone(6, 8, 3, 1), stone(8, 0, 1, 8),
    wall(12, 3, 8, 6, 4.2, 'building', { shed: true }),
    wall(3, 15, 7, 2.6, 2.8, 'container', { van: true }),
    wall(14, 15, 2.2, 2.2, 1.2, 'crate'), wall(17.4, 21, 2, 2, 1.2, 'crate'), wall(5, 22, 1.6, 1.6, 1.0, 'crate', { sacks: true }),

    // ---- Churchyard. The crypt in the corner: one doorway, from the south.
    stone(31, 0, 1, 8), stone(25, 8, 2, 1), stone(30, 8, 2, 1),
    wall(36, 2, 10, 7, 5, 'building', { chapel: true, landmark: true }),
    grave(28, 11.5), grave(31, 11.5), grave(34, 11.5), grave(28, 14.2), grave(31, 14.2), grave(34, 14.2),
    grave(44, 11.5), grave(47, 11.5), grave(50, 11.5), grave(53, 11.5), grave(44, 14.2), grave(47, 14.2), grave(50, 14.2), grave(53, 14.2),
    tree(49, 3, { yew: true }),

    // ---- Pump Yard (power). The pump house, the water tower's legs, transformer cabinets.
    wall(37, 23, 7, 6, 4, 'building', { pumphouse: true, landmark: true }),
    wall(48, 21, 0.5, 0.5, 7, 'crane', { tower: true }), wall(51, 21, 0.5, 0.5, 7, 'crane', { tower: true }),
    wall(48, 24.5, 0.5, 0.5, 7, 'crane', { tower: true }), wall(51, 24.5, 0.5, 0.5, 7, 'crane', { tower: true }),
    wall(29, 21, 2, 1.6, 1.4, 'crate', { transformer: true }), wall(29, 29.5, 2, 1.6, 1.4, 'crate', { transformer: true }),
    wall(51, 29, 2, 1.6, 1.4, 'crate', { transformer: true }),

    // ---- Burial Field (boss arena): the obelisk in the middle to kite round, chest tombs, two dead trees.
    wall(65, 15, 2.4, 2.4, 6, 'building', { obelisk: true }),
    tomb(60, 6), tomb(71, 6), tomb(60, 26), tomb(71, 26),
    tree(62, 11, { dead: true }), tree(70, 21, { dead: true }),

    // ---- Crossing Lane: the signal box, a handcar, and the coal stage behind a wall at the east end (a dead end).
    wall(46, 38, 5, 4, 4.4, 'building', { signalbox: true }),
    wall(32, 40, 2.4, 1.6, 1.1, 'crate', { handcar: true }),
    stone(69, 39, 1, 9, 2.8, { coal: true }),
    wall(72.5, 44.5, 2.5, 2, 1.3, 'crate', { coalheap: true }),
  );
  perimeter(walls, W, H, 4);

  // Spawns only matter to tools (thumbnails, the validator): the zombies rules place everyone themselves.
  const spawns = [
    [{ x: 8, z: 39.5, aim: 0 }, { x: 11, z: 39.5, aim: 0 }, { x: 8, z: 42.5, aim: 0 }, { x: 11, z: 42.5, aim: 0 }],
    [{ x: 40, z: 44, aim: Math.PI }, { x: 60, z: 42, aim: Math.PI }, { x: 66, z: 26, aim: Math.PI }, { x: 44, z: 12, aim: Math.PI }],
  ];
  const lanes = [{ id: 'north', z: 12.5 }, { id: 'mid', z: 26 }, { id: 'south', z: 44 }];
  const nav = navGrid(walls, [5, 12, 20, 28, 34, 46, 53, 60, 68, 74], [5, 12.5, 20, 26, 31, 38, 44]);

  // ---- Graveyard Shift layout (zmLayout's graph form, docs/ZOMBIES.md "Ashgrove Halt"). Areas are found by flooding
  // from `seed` with every gate shut; everything else names a floor spot (x, z) and, for things on a wall, which side
  // the wall is on (`wall`: n, s, e, w).
  const zm = {
    areas: [
      { id: 'halt', name: 'The Halt', seed: { x: 10, z: 40 } },
      { id: 'goods', name: 'Goods Yard', seed: { x: 14, z: 20 } },
      { id: 'church', name: 'Churchyard', seed: { x: 40, z: 13 } },
      { id: 'pump', name: 'Pump Yard', seed: { x: 33, z: 26 } },
      { id: 'field', name: 'Burial Field', seed: { x: 66, z: 24 } },
      { id: 'lane', name: 'Crossing Lane', seed: { x: 40, z: 44 } },
    ],
    start: 'halt',
    // Gates: the rect that fills each opening, the two areas it joins, its price.
    gates: [
      { x: 9, z: 28, w: 4, d: 1, a: 'halt', b: 'goods', cost: 750 },
      { x: 24, z: 39, w: 1, d: 4, a: 'halt', b: 'lane', cost: 750 },
      { x: 24, z: 10, w: 1, d: 4, a: 'goods', b: 'church', cost: 1000 },
      { x: 39, z: 33.6, w: 4, d: 1.4, a: 'lane', b: 'pump', cost: 1250 },
      { x: 37, z: 17, w: 4, d: 1.4, a: 'church', b: 'pump', cost: 1250 },
      { x: 56, z: 9, w: 1, d: 4, a: 'church', b: 'field', cost: 1500 },
      { x: 64, z: 35, w: 4, d: 1, a: 'lane', b: 'field', cost: 1500 },
    ],
    wallBuys: [
      { x: 12.2, z: 34, wall: 'e', gun: 'smg', cost: 1000 },          // Halt: the waiting room's west end.
      { x: 4.5, z: 29.7, wall: 'n', gun: 'shotgun', cost: 900 },        // Halt: on the yard wall.
      { x: 16, z: 9.7, wall: 'n', gun: 'ar', cost: 1200 },              // Goods Yard: the shed's front.
      { x: 23.3, z: 21, wall: 'e', gun: 'dmr', cost: 1000 },            // Goods Yard: the west wall.
      { x: 35.3, z: 5.5, wall: 'e', gun: 'pdw', cost: 1100 },           // Churchyard: the chapel's west end.
      { x: 46.7, z: 5.5, wall: 'w', gun: 'heavysmg', cost: 1400 },      // Churchyard: the chapel's east end.
      { x: 44.7, z: 26, wall: 'w', gun: 'heavyar', cost: 1500 },        // Pump Yard: the pump house.
      { x: 57.7, z: 22, wall: 'w', gun: 'lmg', cost: 1800 },            // Burial Field: the east wall.
      { x: 72, z: 34.3, wall: 's', gun: 'saw', cost: 1800 },            // Burial Field: the lane wall.
      { x: 45.3, z: 40, wall: 'e', gun: 'carbine', cost: 1300 },        // Crossing Lane: the signal box.
    ],
    // Mystery crate spots: the first two are where it can start.
    boxes: [
      { x: 6.8, z: 4, wall: 'e' },          // Goods Yard: the lamp room (dead end).
      { x: 70.7, z: 44, wall: 'w' },        // Crossing Lane: the coal stage (dead end).
      { x: 30.3, z: 4, wall: 'e' },         // Churchyard: the crypt (dead end).
      { x: 57.7, z: 29, wall: 'w' },        // Burial Field.
    ],
    machines: [
      { x: 17, z: 37.2, wall: 'n', perk: 'mercy' },      // Halt: the waiting room's platform side.
      { x: 11.3, z: 6, wall: 'e', perk: 'quick' },       // Goods Yard: the shed's west end.
      { x: 55.3, z: 3, wall: 'e', perk: 'hammer' },      // Churchyard: the east wall.
      { x: 51.7, z: 40, wall: 'w', perk: 'iron' },       // Crossing Lane: the signal box.
    ],
    // The power switch on the pump house's west wall: free, but someone has to get there.
    power: { x: 36.2, z: 26, wall: 'e' },
    // Boss rounds: the boss rises in the Burial Field when it is open (else at an ordinary riser).
    boss: { area: 'field', spots: [{ x: 66, z: 4 }, { x: 73, z: 16 }, { x: 60, z: 18 }, { x: 66, z: 31 }] },
    // Spawn windows: where the undead climb in, per area (over walls, out of graves, up the embankment).
    risers: [
      { x: 2, z: 31 }, { x: 22.5, z: 30.5 }, { x: 2, z: 46.5 }, { x: 15, z: 46.5 }, { x: 22.5, z: 46.5 }, { x: 7, z: 35 },
      { x: 2, z: 12 }, { x: 2, z: 26 }, { x: 22.5, z: 1.5 }, { x: 11, z: 26.5 }, { x: 22.5, z: 26.5 }, { x: 4.5, z: 2 },
      { x: 27, z: 4 }, { x: 33.5, z: 1.5 }, { x: 54.5, z: 1.5 }, { x: 30, z: 13 }, { x: 52, z: 13 }, { x: 47.5, z: 8 },
      { x: 26.5, z: 25 }, { x: 54.5, z: 20 }, { x: 54.5, z: 31.5 }, { x: 33, z: 31.5 }, { x: 46, z: 30.5 },
      { x: 59, z: 2 }, { x: 74.5, z: 2 }, { x: 74.5, z: 33 }, { x: 59, z: 33 }, { x: 74.5, z: 12 }, { x: 58.5, z: 12 },
      { x: 27, z: 46.5 }, { x: 40, z: 46.5 }, { x: 55, z: 46.5 }, { x: 62, z: 37.5 }, { x: 73, z: 40.5 }, { x: 36, z: 37 },
    ],
    // The crew starts together on the platform.
    starts: [{ x: 8.5, z: 40 }, { x: 11, z: 40 }, { x: 8.5, z: 42.5 }, { x: 11, z: 42.5 }],
    // Kept for the zombies economy (not used yet): the next builder places these pieces here. Each is open floor in
    // its area; `wall` says which side a bench stands against; traps cover a chokepoint (`r` metres round x, z).
    reserved: {
      bench: { x: 40.5, z: 22.2, wall: 's', note: 'upgrade bench: the pump house, north face' },
      terminal: { x: 19, z: 29.7, wall: 'n', note: 'supply terminal: the Halt, on the yard wall' },
      armour: { x: 48.5, z: 42.7, wall: 'n', note: 'armour bench: the signal box, south face' },
      traps: [
        { x: 26.5, z: 12, r: 1.8, note: 'the Goods Yard gate into the Churchyard' },
        { x: 48.5, z: 36.5, r: 1.6, note: 'the lane squeezed between the signal box and the railing' },
        { x: 66, z: 37, r: 2, note: 'the Burial Field gate onto the lane' },
      ],
      exfil: { x: 72, z: 4, r: 3, note: 'exfil pad: the Burial Field, far corner' },
    },
  };

  return {
    id: 'ashgrove', name: 'Ashgrove Halt', theme: 'ashgrove', size: 'medium', region: 'farmland',
    hidden: true, modes: [], zmOnly: true,
    width: W, height: H, walls, spawns, lanes, nav, points: {},
    decor: [{ type: 'rails', z: [45.6] }, { type: 'tank', x: 48, z: 21, w: 3.5, d: 4, y: 7 }],
    zm,
  };
}

export default build();
