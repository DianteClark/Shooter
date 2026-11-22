// Metro, medium: Old Quarter, 76 x 46, a district of Meridian City (docs/DISTRICTS.md) and a 6v6 map of its own.
// Rows of brownstones on narrow lanes, three-metre alleys between them, and Fountain Square in the middle where the
// lanes meet. Close fights round corners, a market street through the middle with its stalls to shoot over. In
// Meridian City the brownstones open up as buildings to loot.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const house = (x, z, w, d, h = 4) => [x, z, w, d, h, 'building', { store: true }];
const store = (x, z, w, d) => [x, z, w, d, 3.4, 'building', { store: true }];
const car = (x, z, along = true) => [x, z, along ? 4.2 : 1.9, along ? 1.9 : 4.2, 1.4, 'barrier', { car: true }];
const planter = (x, z, w, d) => [x, z, w, d, 0.9, 'barrier', { planter: true }];
const tree = (x, z) => [x, z, 1, 1, 4.5, 'wall', { tree: true }];
const bench = (x, z, w = 2.2, d = 0.6) => [x, z, w, d, 0.9, 'barrier', { bench: true }];

function build() {
  const W = 76, H = 46;
  const walls = [];
  rotated(walls, W, H, [
    // ---- Edges: shopfronts on the north edge, more on the south one (each half lists its own; the images fill in).
    store(8, 0, 11, 3.4), store(22, 0, 9, 3.4), store(11, 42.6, 9, 3.4),

    // ---- North row (z 9-17) and south row (z 29-37) of brownstones, west of the square, split by alleys.
    house(8, 9, 9, 8), house(20, 9, 8, 8, 3.8),
    house(8, 29, 8, 8, 3.8), house(19, 29, 9, 8),

    // ---- The market street through the middle (z 17-29): a stall to shoot over, a kiosk.
    [11, 21.6, 3, 1.1, 1.0, 'stall'],
    [25, 18.6, 2, 1.6, 2.4, 'shop', { newsstand: true }],

    // ---- The lanes: a car on the north lane, a planter on the south.
    car(27, 4.6), planter(26, 38.8, 3, 1.2),

    // ---- Fountain Square's west half (x 30-38): benches, trees, planters.
    bench(32, 13.6), tree(31, 31.5), planter(31, 18.4, 1.2, 3), tree(35.5, 10.4),

    // ---- Spawn screens.
    [6, 5, 1, 4, 2.4, 'wall'], [6, 37, 1, 4, 2.4, 'wall'],
  ]);
  // The fountain in the middle of the square: its own image. Water: shoot and see across it.
  walls.push(wall(36.5, 21.5, 3, 3, 0, 'water', { fountain: true }));
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3, [3, 7, 11, 19, 23, 27, 35, 39, 43]);
  const lanes = [{ id: 'north', z: 6.2 }, { id: 'mid', z: 23 }, { id: 'south', z: 39.8 }];
  const nav = navGrid(walls, [3, 12, 18.5, 26, 33, 43, 50, 57.5, 64, 73], lanes.map(l => l.z));
  // Domination: A the west market street, B round the fountain, C the east one.
  const points = symmetricPoints(W, H, { x: 18, z: 23, r: 3.6 }, { x: 38, z: 23, r: 4.2 },
    [{ x: 31, z: 6.2, r: 3.4 }, { x: 18, z: 39.8, r: 3.4 }]);
  points.hard.push({ id: 'h5', x: 38, z: 23, r: 4 });
  // Search and Destroy (see bombSites): A on the north lane past the square, B in the far south alley mouth.
  points.snd = bombSites({ x: 52, z: 6.2 }, { x: 58, z: 39.8 }, 2.8);
  // Capture the Flag (see flagBases): on the market street in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 23 });

  const zones = [{ x: 0, z: 3.4, w: W, d: 5.6, kind: 'road' }, { x: 0, z: 37, w: W, d: 5.6, kind: 'road' }, { x: 0, z: 17, w: W, d: 12, kind: 'road' },
    { x: 30, z: 9, w: 16, d: 28, kind: 'plaza' }];

  return {
    id: 'oldquarter', name: 'Old Quarter', theme: 'metro', size: 'medium', region: 'metro',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
