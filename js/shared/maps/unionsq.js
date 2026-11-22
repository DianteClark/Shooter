// Metro, small: Union Square, 56 x 36, a district of Meridian City (docs/DISTRICTS.md) and a 6v6 map of its own. A
// square of trees and hedges round the bandstand, shopfronts on the streets either side; close quarters, round the
// bandstand and across the hedges. In Meridian City its shops open up as buildings to loot.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const store = (x, z, w, d) => [x, z, w, d, 3.4, 'building', { store: true }];
const car = (x, z, along = true) => [x, z, along ? 4.2 : 1.9, along ? 1.9 : 4.2, 1.4, 'barrier', { car: true }];
const tree = (x, z) => [x, z, 1, 1, 4.5, 'wall', { tree: true }];
const hedge = (x, z, w, d) => [x, z, w, d, 1.1, 'barrier', { hedge: true }];
const bench = (x, z, w = 2.2, d = 0.6) => [x, z, w, d, 0.9, 'barrier', { bench: true }];

function build() {
  const W = 56, H = 36;
  const walls = [];
  rotated(walls, W, H, [
    // ---- Shopfronts on the edges (each half lists its own; the images fill in).
    store(8, 0, 10, 3.2), store(21, 0, 8, 3.2), store(9, 32.8, 9, 3.2),
    // ---- The streets: a parked car, a newsstand.
    car(12, 4.4), [31, 4.6, 2, 1.6, 2.4, 'shop', { newsstand: true }],

    // ---- The square's west half (x 12-28): trees, hedges, benches.
    tree(15, 11), tree(19.5, 25), tree(23, 10.5),
    hedge(14, 15, 0.8, 6), hedge(18, 21.4, 5, 0.8), hedge(22, 15.6, 0.8, 3.4), [10.5, 30.4, 3, 1.1, 1.0, 'stall'],
    bench(20, 13.4), bench(13.4, 26.4),

    // ---- Spawn screens.
    [7, 8, 1, 5, 2.4, 'wall'], [7, 23, 1, 5, 2.4, 'wall'],
  ]);
  // The bandstand in the middle: its own image.
  walls.push(wall(26, 16, 4, 4, 2.6, 'shop', { bandstand: true, landmark: true }));
  perimeter(walls, W, H, 3.6);

  const spawns = edgeSpawns(W, H, 3, [3, 6, 15.5, 20.5, 30, 33]);
  const lanes = [{ id: 'north', z: 5.8 }, { id: 'mid', z: 18 }, { id: 'south', z: 30.2 }];
  const nav = navGrid(walls, [3, 11, 17, 22, 28, 34, 39, 45, 53], lanes.map(l => l.z));
  // Domination: A the square's south-west corner, B round the bandstand, C its image.
  const points = symmetricPoints(W, H, { x: 16, z: 29.5, r: 3 }, { x: 28, z: 18, r: 4.4 },
    [{ x: 20, z: 5.8, r: 3 }, { x: 10.5, z: 18, r: 3 }]);
  points.hard.push({ id: 'h5', x: 28, z: 18, r: 4.2 });
  // Search and Destroy (see bombSites): A on the north street past the square, B in the far south-east corner.
  points.snd = bombSites({ x: 43, z: 8 }, { x: 46, z: 30 }, 2.6);
  // Capture the Flag (see flagBases): between the spawn screens.
  points.ctf = flagBases(W, H, { x: 8.5, z: 18 });

  const zones = [{ x: 0, z: 3.2, w: W, d: 4.8, kind: 'road' }, { x: 0, z: 28, w: W, d: 4.8, kind: 'road' }, { x: 12, z: 8, w: 32, d: 20, kind: 'park' }];

  return {
    id: 'unionsq', name: 'Union Square', theme: 'metro', size: 'small', region: 'metro',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
