// Desert, small. A palm oasis in a mud-brick village, 52 x 34 m. The spring pool in the middle can be seen and shot
// across but not walked through, so the centre is a ring fight round it behind low garden walls and palm beds.
// North and south, lanes of huts and courtyard walls make tight corner-to-corner fights.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const hut = (x, z, w, d, h = 3.2) => [x, z, w, d, h, 'adobe', { hut: true }];
const yard = (x, z, w, d) => [x, z, w, d, 2.4, 'adobe'];                      // Courtyard wall, head height.
const garden = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { mud: true }];    // Low garden wall: shoot over.
const palms = (x, z, s = 1.6) => [x, z, s, s, 0.8, 'boulder', { palm: true }]; // Stone-ringed palm bed.

function build() {
  const W = 52, H = 34;
  const walls = [];
  rotated(walls, W, H, [
    // ---- North-west: huts along the north lane, a courtyard wall off the second.
    hut(8, 0, 5, 4.4), hut(16, 3.6, 4.5, 4), hut(21.5, 0, 4.5, 3),
    yard(20.5, 5.2, 1, 0.6),
    // ---- The west bank: the well-house, a garden wall, a palm bed and sandbags at the water.
    hut(9, 15.4, 3.2, 3.2, 2.8),
    garden(15, 11.2, 0.7, 3.4), palms(17.4, 20.6), palms(13, 7.6, 1.4),
    [21.6, 10.4, 2.6, 0.9, 1.0, 'sandbag'],
    // ---- South-west: a hut pair against the south wall and a market tent.
    hut(9, 24.4, 5, 4.6), hut(14, 29, 5, 5),
    [20, 24.6, 3.6, 3, 2.8, 'tent'],
    // ---- Spawn cover: a screen wall and a low garden wall.
    [6, 7.5, 0.8, 4, 2.4, 'wall'],
    garden(5.5, 20.5, 0.7, 3),
  ]);
  // The spring pool at the centre is its own image.
  walls.push(wall(21, 14.5, 10, 5, 0, 'water', { pool: true }));
  perimeter(walls, W, H, 4);

  const spawns = edgeSpawns(W, H, 3, [2.5, 6, 10, 14, 19, 23.5, 27.5, 31.5]);
  const lanes = [{ id: 'north', z: 5.5 }, { id: 'mid', z: 17 }, { id: 'south', z: 28.5 }];
  const nav = navGrid(walls, [3, 14, 26, 38, 49], lanes.map(l => l.z));
  // Domination: A north of the west well-house; B is the pool itself, a ring held from its banks; C is A's image.
  const points = symmetricPoints(W, H,
    { x: 11, z: 11.5, r: 3 },
    { x: 26, z: 17, r: 4.6 },
    [{ x: 23.5, z: 6.5, r: 3 }, { x: 18, z: 21.5, r: 3 }]);

  // Search and Destroy (see bombSites). A in the north lane between two huts, B in the yard between the south-east huts:
  // both shut off from the defenders' spawn street by a hut, so a plant can be covered.
  points.snd = bombSites({ x: 31, z: 4 }, { x: 37.8, z: 28 }, 2.8);
  // Capture the Flag (see flagBases). Between the screen wall and the well-house, in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8, z: 17 });

  return {
    id: 'oasis', name: 'Oasis', theme: 'desert', size: 'small', region: 'desert',
    width: W, height: H, walls, spawns, lanes, nav, points,
  };
}

export default build();
