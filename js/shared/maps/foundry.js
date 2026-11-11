// Industrial, large. A steel mill at the end of a night shift, 104 x 64 m. Two rail lanes run the full length of the
// north and south edges past parked ore wagons: the long lanes, 50 m and more between breaks. Inside them a crane yard
// of coil and slab stacks under a gantry on one side and the ore bunkers under the stack on the other, and in the middle
// the casting hall: four doors, the furnace in the centre, conveyor lines running out of its end doors. Conveyors and
// coils are waist high (shoot over them); wagons, slab stacks, bunkers and the hall are solid.
// Half is listed; the other half is its 180-degree image.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const wagon = (x, z, w = 9, d = 2.6) => [x, z, w, d, 2.8, 'container', { wagon: true }];
const slab = (x, z, w = 2.6, d = 2.6) => [x, z, w, d, 2.5, 'container', { slab: true }];
const coil = (x, z, w = 1.8, d = 1.8) => [x, z, w, d, 1.3, 'crate', { coil: true }];
const conveyor = (x, z, w, d) => [x, z, w, d, 1.1, 'barrier', { conveyor: true }];
const hallWall = (x, z, w, d) => [x, z, w, d, 4.2, 'wall', { hall: true }];
const bunker = (x, z, w, d) => [x, z, w, d, 2.6, 'wall', { bunker: true }];
const leg = (x, z) => [x, z, 1.2, 1.2, 6, 'crane', { gantry: true }];
const buffer = (x, z) => [x, z, 1, 2.4, 1.1, 'barrier', { buffer: true }];   // Buffer stop at the end of a siding.
const sleepers = (x, z, w = 3, d = 1.2) => [x, z, w, d, 0.9, 'barrier', { sleepers: true }];

function build() {
  const W = 104, H = 64;
  const walls = [];
  rotated(walls, W, H, [
    // ---- Casting hall (x 40..64, z 24..40): north wall with two doors, west wall with the conveyor door.
    hallWall(40, 24, 8, 0.6), hallWall(51, 24, 6, 0.6), hallWall(60, 24, 4, 0.6),
    hallWall(40, 24.6, 0.6, 4), hallWall(40, 35.4, 0.6, 4),
    // Inside: ingot moulds (low) and a ladle car (solid) either side of the furnace.
    coil(43.5, 27, 2.2, 1.6), [43.4, 35.6, 3, 1.4, 1.0, 'barrier', { moulds: true }],
    [57.5, 26.2, 2.4, 2.2, 2.6, 'container', { ladle: true }],

    // ---- Conveyor line out of the west door, with a gap to step through. Waist high: a lane you can shoot across.
    conveyor(22, 31.4, 8, 1.2), conveyor(32.5, 31.4, 7.5, 1.2),

    // ---- North rail lane (z 0..12): wagons on the two tracks, buffer stops, sleeper piles.
    wagon(19, 2.2), wagon(46, 7.6, 10), wagon(70, 2.2, 8),
    buffer(14, 1.6), sleepers(33, 8.6), sleepers(58, 3.2, 3.4), coil(85, 8.2),
    [88, 0, 5, 4, 3.4, 'building', { cabin: true }],      // Signal cabin at the east end of the lane.

    // ---- Crane yard (x 16..38, z 13..26): gantry legs, slab stacks and coils.
    leg(17, 14), leg(36, 14), leg(17, 24.4), leg(36, 24.4),
    slab(21, 16.5), slab(28, 21, 3, 2.4), slab(32.4, 15.6, 2.2, 3),
    coil(25.5, 15), coil(21.5, 21.8), coil(33, 21.4),

    // ---- Ore bunkers under the stack (x 66..92, z 13..24): three-sided concrete bays, open to the rail lane.
    bunker(68, 13, 0.7, 7), bunker(75, 13, 0.7, 7), bunker(82, 13, 0.7, 7),
    [77, 16, 3.6, 3.6, 9, 'building', { stack: true }],
    slab(88.5, 17.4, 2.4, 2.4),

    // ---- West end: the spawn yard. Screens, the mess hut, a weighbridge cabin.
    [8, 4, 1.2, 7, 2.4, 'wall'], [8, 22, 1.2, 6, 2.4, 'wall'],
    [9.5, 34.5, 4, 3.6, 3.4, 'building', { cabin: true }],
    slab(13, 11.5, 2.4, 2.4), coil(13.6, 27.5),
  ]);
  // The furnace: the hall's solid heart, centred on the map so it is its own image.
  walls.push(wall(48, 29, 8, 6, 5.5, 'building', { landmark: true, furnace: true }));
  perimeter(walls, W, H, 4.5);

  const spawns = edgeSpawns(W, H, 3.5, [3, 8, 14, 19.5, 26, 31, 38, 44, 50, 56, 61]);
  const lanes = [{ id: 'north', z: 5.5 }, { id: 'northmid', z: 19 }, { id: 'mid', z: 32 }, { id: 'southmid', z: 45 }, { id: 'south', z: 58.5 }];
  const nav = navGrid(walls, [4, 15, 28, 40, 52, 64, 76, 89, 100], lanes.map(l => l.z));
  // A in the crane yard's image (south-west, under the stack's twin), B around the furnace, C its image.
  const points = symmetricPoints(W, H,
    { x: 27, z: 19.5, r: 4.5 },
    { x: 52, z: 32, r: 7.5 },
    [{ x: 52, z: 5.5, r: 4.5 }, { x: 27, z: 44, r: 4.5 }]);

  // Search and Destroy (see bombSites). A by the signal cabin at the east end of the north rail lane, B in the ore bunker
  // bays' image south-east of the hall: the hall splits them, and the rail lanes give the long approach.
  points.snd = bombSites({ x: 82, z: 6, r: 3.4 }, { x: 80, z: 46, r: 3.4 });

  // Capture the Flag (see flagBases). Behind the spawn screens' gap, in front of the mess hut: every run home crosses a
  // conveyor or a rail lane.
  points.ctf = flagBases(W, H, { x: 14, z: 32 });

  // Render-only: the gantry beam over the crane yard (and its image), rails down both edge lanes.
  const decor = [
    { type: 'gantry', x0: 17.6, x1: 36.6, z0: 14.6, z1: 25 },
    { type: 'gantry', x0: W - 36.6, x1: W - 17.6, z0: H - 25, z1: H - 14.6 },
    { type: 'rails', z: [3.5, 8.9, H - 8.9, H - 3.5] },
  ];

  return {
    id: 'foundry', name: 'Foundry', theme: 'foundry', size: 'large', region: 'industrial',
    width: W, height: H, walls, spawns, lanes, nav, points, decor,
  };
}

export default build();
