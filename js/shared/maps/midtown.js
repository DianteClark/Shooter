// Metro, large: Midtown, 108 x 64, a district of Meridian City (docs/DISTRICTS.md) and a 6v6 map of its own. Towers
// either side of Monument Plaza, the square in the middle with the city's founder on his plinth. The middle avenue is
// the city's boulevard (it runs on east and west through the region); the north and south avenues are the long lanes,
// the alleys and the parking lots carry the rotations. In Meridian City its towers open up as buildings to loot.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const tower = (x, z, w, d, h = 4.6) => [x, z, w, d, h, 'building', { tower: true }];
const store = (x, z, w, d, h = 3.6) => [x, z, w, d, h, 'building', { store: true }];
const car = (x, z, along = true) => [x, z, along ? 4.2 : 1.9, along ? 1.9 : 4.2, 1.4, 'barrier', { car: true }];
const planter = (x, z, w, d) => [x, z, w, d, 0.9, 'barrier', { planter: true }];
const jersey = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { jersey: true }];
const shelter = (x, z) => [x, z, 3.6, 1.3, 2.4, 'barrier', { shelter: true }];
const tree = (x, z) => [x, z, 1, 1, 4.5, 'wall', { tree: true }];
const bench = (x, z, w = 2.2, d = 0.6) => [x, z, w, d, 0.9, 'barrier', { bench: true }];

function build() {
  const W = 108, H = 64;
  const walls = [];
  rotated(walls, W, H, [
    // ---- North edge shopfronts, the north avenue (z 3.5-12): parked cars, a bus shelter, a kerb barrier.
    store(10, 0, 14, 3.5), store(28, 0, 13, 3.5),
    car(13, 5.2), car(31, 9.4), shelter(43, 3.5), jersey(22, 8, 0.7, 2.6),

    // ---- North blocks (z 12-25): a tower, then a pair split by a service alley.
    tower(9, 13, 11, 11, 5),
    tower(24, 13, 13, 4.5), tower(24, 20.5, 13, 4.5, 4),

    // ---- Monument Plaza's west half (x 41-54): planters, benches, trees, a newsstand.
    planter(43, 14, 3.4, 1.2), planter(44, 22, 1.2, 3.4), planter(43, 40.5, 3.4, 1.2),
    bench(47, 26.5), tree(42.5, 47), tree(48, 16.5),
    [46.5, 44.5, 2, 1.6, 2.4, 'shop', { newsstand: true }],

    // ---- Middle avenue, the boulevard (z 26-38): a bus, parked cars, a kerb barrier.
    [17, 30.7, 9.5, 2.6, 3.2, 'container', { bus: true }],
    car(9.5, 27.6), car(32, 34.4), jersey(29, 27.6, 3, 0.7),

    // ---- South-west: a tower block, then a parking lot with a pay booth.
    tower(9, 40, 10, 12, 4.8),
    car(23.5, 41, false), car(27.5, 41, false), car(35, 41, false), car(23.5, 47.2, false), car(31, 47.6, false),
    [36.5, 47.6, 2, 2, 2.4, 'shop', { booth: true }],

    // ---- Spawn cover.
    jersey(6.5, 17, 0.7, 4), jersey(6.5, 43, 0.7, 4),
  ]);
  // The founder on his plinth, the middle of the plaza: its own image.
  walls.push(wall(52, 30, 4, 4, 3, 'wall', { statue: true, landmark: true }));
  perimeter(walls, W, H, 4);

  const spawns = edgeSpawns(W, H, 3.5, [5, 9, 21, 25, 29.5, 34.5, 39, 50, 55, 59]);
  const lanes = [{ id: 'north', z: 7.5 }, { id: 'nmid', z: 19 }, { id: 'mid', z: 32 }, { id: 'smid', z: 45 }, { id: 'south', z: 56.5 }];
  const nav = navGrid(walls, [4, 16, 22, 30, 39, 46, 54, 62, 69, 78, 86, 92, 104], lanes.map(l => l.z));
  // Domination: A the west parking lot, B round the founder, C the east lot.
  const points = symmetricPoints(W, H, { x: 30, z: 45, r: 4.6 }, { x: 54, z: 32, r: 5.6 },
    [{ x: 46, z: 19.5, r: 4.2 }, { x: 22, z: 7.5, r: 4.2 }]);
  points.hard.push({ id: 'h5', x: 54, z: 32, r: 5.4 });
  // Search and Destroy (see bombSites): A in the north-east lot, B on the south avenue by the east tower.
  points.snd = bombSites({ x: 76, z: 18 }, { x: 74, z: 56.5 }, 3.4);
  // Capture the Flag (see flagBases): on the boulevard in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 32 });

  const zones = [];
  for (const [x, z, w, d] of [[0, 4.5, W, 6.5], [0, 26.5, W, 11], [0, 53, W, 6.5], [20.5, 12, 3.5, 14], [84, 38, 3.5, 14]]) zones.push({ x, z, w, d, kind: 'road' });
  zones.push({ x: 22, z: 39, w: 18, d: 13, kind: 'lot' }, { x: 68, z: 12, w: 18, d: 13, kind: 'lot' });
  zones.push({ x: 41, z: 12, w: 26, d: 40, kind: 'plaza' });

  return {
    id: 'midtown', name: 'Midtown', theme: 'metro', size: 'large', region: 'metro',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
