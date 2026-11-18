// Polestar Relay (arctic, medium; Graveyard Shift only, docs/ZOMBIES.md "Polestar Relay"). An iced-in polar research
// station and its radio relay, at night under the aurora. Built for the zombies mode, not for 6v6: hidden from every
// other playlist, no modes of its own (MODES.zm.maps puts it in Graveyard Shift).
//
// The story, as the crew walks it (x east, z south; the camera looks north):
//   Mess Hall      (start, south-west)  the mess hut and the yard where the crew sat out the storm.
//   Kennels        (west)               the dog shed, a parked snowcat, the dog run (a dead end; a crate spot, a radio).
//   Lab Block      (north)              the lab hut, the cold store in the corner (a dead end; a crate spot).
//   Boiler House   (centre)             the boiler with the POWER switch, the header tanks: walled in on every side,
//                                        reached from the Lab Block or the Hangar.
//   Mast Field     (north-east)         the relay mast and the big dish: the boss arena, open snow to kite in.
//   Fuel Depot     (south-east)         the fuel tanks, the helipad (the exfil), the tank alcove (a dead end, a radio).
//   Hangar         (south)              the aircraft hangar and its workshop (the upgrade bench), the radio room (a dead
//                                        end, a radio).
// Gates make one loop (Mess Hall, Kennels, Lab Block, Mast Field, Fuel Depot, Hangar, back to the Mess Hall) with the
// Boiler House reached from the Lab Block or the Hangar. The hidden quest is the radios: with the power on, tune the
// three sets (kennels, radio room, tank alcove), then transmit from the console at the mast's foot and something out
// on the ice answers (the Listener, in the Mast Field). js/shared/zombies.js (zmLayout) reads the `zm` block below.
import { wall, perimeter, navGrid } from './build.js';

const W = 80, H = 52;
// Prefab panel walls between the areas, snow-banked; the station's huts are 'building'.
const panel = (x, z, w, d, h = 3.4, extra = {}) => wall(x, z, w, d, h, 'wall', { prefab: true, ...extra });
const drift = (x, z, w, d) => wall(x, z, w, d, 1.0, 'barrier', { drift: true });
const crate = (x, z, w = 2, d = 1.4, extra = {}) => wall(x, z, w, d, 1.2, 'crate', extra);

function build() {
  const walls = [];
  walls.push(
    // ---- The long walls between the areas (openings are the gates, see zm.gates).
    panel(24, 0, 1, 6), panel(24, 10, 1, 30), panel(24, 44, 1, 8),                // West wall, gates at z 6 and 40.
    panel(0, 29, 10, 1), panel(14, 29, 10, 1),                                    // Mess Hall / Kennels, gate at x 10.
    panel(25, 16, 13, 1), panel(42, 16, 13, 1),                                   // Lab Block / Boiler House, gate at x 38.
    panel(25, 34, 13, 1), panel(42, 34, 13, 1),                                   // Boiler House / Hangar, gate at x 38.
    panel(55, 0, 1, 10), panel(55, 14, 1, 27), panel(55, 45, 1, 7),               // East wall, gates at z 10 and 41.
    panel(56, 31, 10, 1), panel(70, 31, 10, 1),                                   // Mast Field / Fuel Depot, gate at x 66.

    // ---- Mess Hall (start).
    wall(3, 43, 10, 6, 3.6, 'building', { messhut: true, landmark: true }),
    drift(5, 34, 3.5, 1.2), crate(18, 47.5, 1.6, 1.6, { drums: true }),

    // ---- Kennels. The dog run in the corner: one doorway, from the south.
    panel(0, 9, 4, 1, 2.6, { run: true }), panel(7, 9, 3, 1, 2.6, { run: true }), panel(9, 0, 1, 9, 2.6, { run: true }),
    wall(13, 3, 8, 5, 3.4, 'building', { dogshed: true }),
    wall(3, 17, 6, 2.6, 2.6, 'container', { snowcat: true }),
    crate(15, 15, 2, 2), crate(19, 22, 2, 2), crate(6, 24, 2.2, 1.1, { sled: true }),

    // ---- Lab Block. The cold store in the north-east corner: one doorway, from the south.
    wall(33, 2, 12, 6, 3.8, 'building', { labhut: true, landmark: true }),
    panel(48, 0, 1, 8), panel(48, 8, 2, 1), panel(53, 8, 2, 1),
    crate(28, 12, 2.2, 1.2, { lab: true }), crate(50, 12, 2.2, 1.2, { lab: true }),

    // ---- Boiler House (power): the boiler, its header tank, a coal bunker.
    wall(36, 22, 8, 6, 4.4, 'building', { boiler: true, landmark: true }),
    wall(48, 20, 3, 3, 4.2, 'container', { tank: true }),
    crate(28, 29, 2.2, 2, { bunker: true }),

    // ---- Hangar: the hangar itself, a snowcat, and the radio room in the south-west corner (a dead end).
    wall(40, 45, 11, 7, 5.2, 'building', { hangar: true, landmark: true }),
    panel(25, 44, 1.5, 1, 3), panel(29.5, 44, 2.5, 1, 3), panel(31, 45, 1, 7, 3),
    wall(33, 38, 5, 2.4, 2.6, 'container', { snowcat: true }),
    crate(46, 39.5, 2, 1.4),

    // ---- Mast Field (boss arena): the relay mast in the middle to kite round, the dish, instrument crates.
    wall(66, 12, 2.4, 2.4, 9, 'crane', { mast: true }),
    wall(73, 4, 3.2, 3.2, 2.2, 'building', { dish: true }),
    crate(60, 6, 2.4, 1.2, { instrument: true }), crate(60, 24, 2.4, 1.2, { instrument: true }), crate(73, 24, 2.4, 1.2, { instrument: true }),

    // ---- Fuel Depot: the tank alcove in the south-east corner (a dead end), a fuel tank on its cradle.
    panel(72, 42, 5, 1, 3), panel(72, 43, 1, 9, 3),
    wall(60, 46, 6, 2.5, 2.6, 'container', { fueltank: true }),
    crate(76, 34.5, 1.6, 1.6, { drums: true }),
  );
  perimeter(walls, W, H, 4);

  // Spawns only matter to tools (thumbnails, the validator): the zombies rules place everyone themselves.
  const spawns = [
    [{ x: 16, z: 37, aim: 0 }, { x: 19, z: 37, aim: 0 }, { x: 16, z: 40, aim: 0 }, { x: 19, z: 40, aim: 0 }],
    [{ x: 66, z: 20, aim: Math.PI }, { x: 64, z: 38, aim: Math.PI }, { x: 46, z: 12, aim: Math.PI }, { x: 30, z: 40, aim: Math.PI }],
  ];
  const lanes = [{ id: 'north', z: 11 }, { id: 'mid', z: 25 }, { id: 'south', z: 40 }];
  const nav = navGrid(walls, [4, 12, 20, 29, 40, 50, 60, 68, 76], [4, 12, 20, 26, 32, 38, 44, 50]);

  // ---- Graveyard Shift layout (zmLayout's graph form, docs/ZOMBIES.md). Areas are found by flooding from `seed` with
  // every gate shut; everything else names a floor spot (x, z) and, for things on a wall, which side the wall is on
  // (`wall`: n, s, e, w).
  const zm = {
    areas: [
      { id: 'mess', name: 'Mess Hall', seed: { x: 17, z: 38 } },
      { id: 'kennel', name: 'Kennels', seed: { x: 12, z: 14 } },
      { id: 'lab', name: 'Lab Block', seed: { x: 40, z: 12 } },
      { id: 'boiler', name: 'Boiler House', seed: { x: 31, z: 22 } },
      { id: 'mast', name: 'Mast Field', seed: { x: 64, z: 20 } },
      { id: 'depot', name: 'Fuel Depot', seed: { x: 64, z: 40 } },
      { id: 'hangar', name: 'Hangar', seed: { x: 36, z: 43 } },
    ],
    start: 'mess',
    gates: [
      { x: 10, z: 29, w: 4, d: 1, a: 'mess', b: 'kennel', cost: 750 },
      { x: 24, z: 40, w: 1, d: 4, a: 'mess', b: 'hangar', cost: 750 },
      { x: 24, z: 6, w: 1, d: 4, a: 'kennel', b: 'lab', cost: 1000 },
      { x: 55, z: 41, w: 1, d: 4, a: 'hangar', b: 'depot', cost: 1000 },
      { x: 38, z: 16, w: 4, d: 1, a: 'lab', b: 'boiler', cost: 1250 },
      { x: 38, z: 34, w: 4, d: 1, a: 'hangar', b: 'boiler', cost: 1250 },
      { x: 55, z: 10, w: 1, d: 4, a: 'lab', b: 'mast', cost: 1500 },
      { x: 66, z: 31, w: 4, d: 1, a: 'depot', b: 'mast', cost: 1500 },
    ],
    wallBuys: [
      { x: 8, z: 42.3, wall: 's', gun: 'smg', cost: 1000 },             // Mess Hall: the mess hut's front.
      { x: 4, z: 30.7, wall: 'n', gun: 'shotgun', cost: 900 },          // Mess Hall: the kennel wall.
      { x: 17, z: 8.7, wall: 'n', gun: 'ar', cost: 1200 },              // Kennels: the dog shed's front.
      { x: 23.3, z: 20, wall: 'e', gun: 'dmr', cost: 1000 },            // Kennels: the boiler wall.
      { x: 32.3, z: 5, wall: 'e', gun: 'pdw', cost: 1100 },             // Lab Block: the lab's west end.
      { x: 45.7, z: 5, wall: 'w', gun: 'heavysmg', cost: 1400 },        // Lab Block: the lab's east end.
      { x: 44.7, z: 25, wall: 'w', gun: 'heavyar', cost: 1500 },        // Boiler House: the boiler's east side.
      { x: 45, z: 44.3, wall: 's', gun: 'carbine', cost: 1300 },        // Hangar: the hangar's front.
      { x: 30, z: 35.7, wall: 'n', gun: 'autoshot', cost: 1500 },       // Hangar: the boiler wall.
      { x: 60, z: 30.3, wall: 's', gun: 'lmg', cost: 1800 },            // Mast Field: the depot wall.
      { x: 74.5, z: 41.3, wall: 's', gun: 'saw', cost: 1800 },          // Fuel Depot: the tank alcove's wall.
      { x: 56.7, z: 49, wall: 'w', gun: 'battle', cost: 1600 },         // Fuel Depot: the hangar wall.
    ],
    // Mystery crate spots: the first two are where it can start.
    boxes: [
      { x: 8.3, z: 4.5, wall: 'e' },        // Kennels: the dog run (dead end).
      { x: 73.7, z: 47, wall: 'w' },        // Fuel Depot: the tank alcove (dead end).
      { x: 54.3, z: 4, wall: 'e' },         // Lab Block: the cold store (dead end).
      { x: 56.7, z: 26, wall: 'w' },        // Mast Field.
    ],
    machines: [
      { x: 13.7, z: 46, wall: 'w', perk: 'mercy' },      // Mess Hall: the mess hut's east end.
      { x: 6.5, z: 20.3, wall: 'n', perk: 'stride' },    // Kennels: the snowcat's tail.
      { x: 39, z: 8.7, wall: 'n', perk: 'quick' },       // Lab Block: the lab's front.
      { x: 49.5, z: 23.7, wall: 'n', perk: 'hammer' },   // Boiler House: the header tank.
      { x: 32.7, z: 48, wall: 'w', perk: 'iron' },       // Hangar: the radio room's wall.
      { x: 56.7, z: 20, wall: 'w', perk: 'breath' },     // Mast Field: the west wall.
    ],
    // The power switch on the boiler's west side: free, but someone has to get there.
    power: { x: 35.3, z: 25, wall: 'e' },
    // Boss rounds (and the quest's Listener): out in the Mast Field when it is open.
    boss: { area: 'mast', spots: [{ x: 66, z: 3 }, { x: 77, z: 15 }, { x: 60, z: 16 }, { x: 70, z: 27 }] },
    // Spawn windows: where the undead climb in, per area (over the panel walls, up out of the drifts).
    risers: [
      { x: 2, z: 32 }, { x: 22.5, z: 32 }, { x: 2, z: 50.5 }, { x: 22.5, z: 50.5 }, { x: 15, z: 50.5 }, { x: 2, z: 38 },
      { x: 2, z: 12 }, { x: 2, z: 27.5 }, { x: 22.5, z: 1.5 }, { x: 11, z: 27.5 }, { x: 22.5, z: 27.5 }, { x: 11, z: 1.5 },
      { x: 26.5, z: 1.5 }, { x: 32, z: 1.5 }, { x: 30, z: 14.5 }, { x: 53, z: 14 }, { x: 47, z: 11 }, { x: 26.5, z: 14.5 },
      { x: 26.5, z: 19 }, { x: 53.5, z: 19 }, { x: 26.5, z: 32.5 }, { x: 53.5, z: 32.5 }, { x: 32, z: 19 }, { x: 47, z: 32.5 },
      { x: 57.5, z: 1.5 }, { x: 78.5, z: 1.5 }, { x: 78.5, z: 29.5 }, { x: 57.5, z: 29.5 }, { x: 78.5, z: 12 }, { x: 58, z: 6 },
      { x: 78.5, z: 33.5 }, { x: 57.5, z: 50.5 }, { x: 70, z: 50.5 }, { x: 78.5, z: 39.5 }, { x: 64, z: 44 }, { x: 58, z: 33.5 },
      { x: 26.5, z: 36.5 }, { x: 53.5, z: 37 }, { x: 36, z: 50.5 }, { x: 53, z: 50.5 }, { x: 45, z: 37 }, { x: 33, z: 42.5 },
    ],
    // The crew starts together in the yard in front of the mess hut.
    starts: [{ x: 16, z: 37 }, { x: 19, z: 37 }, { x: 16, z: 40 }, { x: 19, z: 40 }],
    // The zombies economy's pieces (js/shared/zombies.js graphLayout reads them). Each is open floor in its area; `wall`
    // says which side a bench stands against; traps cover a chokepoint (`r` metres round x, z).
    reserved: {
      bench: { x: 39.3, z: 48.5, wall: 'e', note: 'upgrade bench: the hangar workshop, west door' },
      terminal: { x: 19, z: 30.7, wall: 'n', note: 'supply terminal: the Mess Hall, on the kennel wall' },
      armour: { x: 12.3, z: 5.5, wall: 'e', note: 'armour bench: the dog shed, west end' },
      traps: [
        { x: 26.5, z: 8, r: 1.8, note: 'the Kennels gate into the Lab Block' },
        { x: 40, z: 32.4, r: 1.8, note: 'the Boiler House gate onto the Hangar' },
        { x: 57.8, z: 43, r: 1.8, note: 'the Hangar gate into the Fuel Depot' },
      ],
      exfil: { x: 62, z: 38.5, r: 3, note: 'exfil pad: the Fuel Depot helipad' },
    },
    // The hidden quest: the radios. With the power on, tune the three sets (stand at each while it locks on), then
    // transmit from the console at the mast's foot (its south face, toward the camera): the Listener answers.
    quest: {
      kind: 'radio',
      console: { x: 67.2, z: 15.1, wall: 'n' },
      radios: [{ x: 2.2, z: 2.5 }, { x: 26.6, z: 50.4 }, { x: 78.2, z: 50.4 }],
    },
  };

  return {
    id: 'polestar', name: 'Polestar Relay', theme: 'polestar', size: 'medium', region: 'arctic',
    hidden: true, modes: [], zmOnly: true,
    width: W, height: H, walls, spawns, lanes, nav, points: { dom: [], hard: [] },     // No flags: zombies only.
    decor: [{ type: 'aerial', x: 67.2, z: 13.2, h: 22 }, { type: 'pad', x: 62, z: 38.5, r: 3 }],
    zm,
  };
}

export default build();
