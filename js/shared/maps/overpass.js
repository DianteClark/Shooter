// Metro, large. City blocks under an elevated railway, 104 x 64 m, at dusk in the rain. The El runs east-west over the
// middle avenue on two rows of steel columns; its deck is open ties, so nothing up there hides a player. North and
// south avenues are the long lanes (about 50 m to the hoarding in the middle), the middle avenue is broken up by a
// bus and the subway entrance at the centre, and alleys, a parking lot and two plazas carry the rotations between.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const tower = (x, z, w, d, h = 4.4) => [x, z, w, d, h, 'building', { tower: true }];
const store = (x, z, w, d, h = 3.6) => [x, z, w, d, h, 'building', { store: true }];
const column = (x, z) => [x, z, 0.8, 0.8, 6, 'crane', { el: true }];
const car = (x, z, along = true) => [x, z, along ? 4.2 : 1.9, along ? 1.9 : 4.2, 1.4, 'barrier', { car: true }];
const planter = (x, z, w, d) => [x, z, w, d, 0.9, 'barrier', { planter: true }];
const jersey = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { jersey: true }];
const shelter = (x, z) => [x, z, 3.6, 1.3, 2.4, 'barrier', { shelter: true }];     // Glass: see and shoot through.

function build() {
  const W = 104, H = 64;
  const walls = [];
  rotated(walls, W, H, [
    // ---- North edge: a row of shopfronts with a gap for the alley behind, facing the north avenue.
    store(9, 0, 15, 3.5), store(27, 0, 14, 3.5),
    // North avenue (z 3.5-12): parked cars, a bus shelter, and the hoarding round a roadworks pit in the middle.
    car(14, 5.2), car(30.5, 9.8), shelter(36, 3.5), jersey(21.5, 7.8, 0.7, 2.6),
    [47, 6.2, 10, 1.4, 2.6, 'wall', { hoarding: true }],

    // ---- North blocks (z 12-26). A tower, then a pair split by a service alley.
    tower(9, 13, 12, 12, 5),
    tower(27, 13, 14, 5), tower(27, 20.6, 14, 4.4, 3.8),
    // North plaza (x 46-58): a statue, planters, a newsstand.
    [51, 17.5, 2, 2, 3, 'wall', { statue: true }],
    planter(46.8, 13.4, 3.4, 1.2), planter(54, 23.4, 3.2, 1.2), planter(46.8, 21.6, 1.2, 3),
    [55.4, 13.2, 2, 1.6, 2.4, 'shop', { newsstand: true }],

    // ---- Middle avenue under the El (z 26-38). Columns on both kerbs; a bus and parked cars along it.
    column(10, 27.6), column(22, 27.6), column(34, 27.6), column(46, 27.6),
    column(10, 35.6), column(22, 35.6), column(34, 35.6), column(46, 35.6),
    [26, 31.6, 9.5, 2.6, 3.2, 'container', { bus: true }],
    car(13.5, 29.6), car(38.5, 29.6), jersey(16.5, 34, 3, 0.7),

    // ---- South-west: a tower block, then an open parking lot with rows of cars and a pay booth.
    tower(9, 39, 10, 12, 4.8),
    car(25.5, 41, false), car(29.5, 41, false), car(37.5, 41, false),
    car(25.5, 47, false), car(33.5, 47.5, false),
    [39.5, 47.5, 2, 2, 2.4, 'shop', { booth: true }],
    [24, 39, 0.6, 1.4, 0.9, 'barrier', { jersey: true }],

    // ---- Spawn cover: low kerb walls and a news kiosk.
    jersey(6.5, 17, 0.7, 4), jersey(6.5, 44, 0.7, 4),
  ]);
  // The subway entrance at the centre, under the El: its own image.
  walls.push(wall(49.5, 29.5, 5, 5, 3, 'shop', { metro: true, landmark: true }));
  perimeter(walls, W, H, 4);

  const spawns = edgeSpawns(W, H, 3.5, [5, 9, 13.5, 21, 25, 29.5, 34, 38, 42, 49.5, 54.5, 59]);
  const lanes = [{ id: 'north', z: 8 }, { id: 'nmid', z: 19 }, { id: 'mid', z: 32 }, { id: 'smid', z: 45 }, { id: 'south', z: 56 }];
  const nav = navGrid(walls, [4, 16, 24, 36, 44, 52, 60, 68, 80, 88, 100], lanes.map(l => l.z));
  // Domination: A the parking lot on the west's side, B round the subway entrance, C the other lot.
  const points = symmetricPoints(W, H,
    { x: 33, z: 45, r: 4.6 },
    { x: 52, z: 32, r: 5.2 },
    [{ x: 51.5, z: 21, r: 4.4 }, { x: 22, z: 8, r: 4.4 }]);
  points.hard.push({ id: 'h5', x: 52, z: 32, r: 5 });

  // Search and Destroy (see bombSites). A in the north-east parking lot, B in the alley mouth on the south avenue.
  points.snd = bombSites({ x: 71, z: 19 }, { x: 74, z: 56.5 }, 3.4);
  // Capture the Flag (see flagBases). Under the El in front of the spawns, between the first columns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 32 });

  const zones = [];
  // Roads (the rest is pavement). The El's avenue, the two outer avenues, the cross streets.
  for (const [x, z, w, d] of [[0, 5, W, 5.5], [0, 28.5, W, 7], [0, 53.5, W, 5.5], [21, 12, 6, 14], [41.5, 12, 4.5, 14], [77, 38, 6, 14], [58, 38, 4.5, 14]]) {
    zones.push({ x, z, w, d, kind: 'road' });
  }
  zones.push({ x: 24, z: 39, w: 18, d: 13, kind: 'lot' }, { x: 62, z: 12, w: 18, d: 13, kind: 'lot' });
  zones.push({ x: 46, z: 12, w: 12, d: 14, kind: 'plaza' }, { x: 46, z: 38, w: 12, d: 14, kind: 'plaza' });

  return {
    id: 'overpass', name: 'Overpass', theme: 'metro', size: 'large', region: 'metro',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
    el: { z0: 28, z1: 36, y: 7 },
  };
}

export default build();
