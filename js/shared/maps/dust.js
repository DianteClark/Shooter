// Desert outpost. Rock shelves funnel the flanks into arroyos around a walled courtyard: longer
// fights across open sand, with the courtyard as the fortified close-range middle.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

function build() {
  const W = 84, H = 52;
  const walls = [];
  rotated(walls, W, H, [
    // Rock shelves between the lanes, and outcrops biting into the flanks.
    [13, 14, 13, 7.5, 4.2, 'rock'],
    [13, 30.5, 13, 7.5, 4.2, 'rock'],
    [28, 0, 10, 6, 4.4, 'rock'],
    [50, 4.5, 9, 7, 4.4, 'rock'],
    [36, 12, 5, 4, 3.6, 'rock'],
    [31, 8.5, 2.5, 5, 3.6, 'rock'],
    [53, 18.5, 3, 3.4, 3.4, 'rock'],

    // Courtyard walls, gapped with doors north, south, east and west.
    [34, 19, 4, 1.5, 3, 'adobe'],
    [42, 19, 8, 1.5, 3, 'adobe'],
    [34, 20.5, 1.5, 2, 3, 'adobe'],
    [34, 25.5, 1.5, 6, 3, 'adobe'],

    // Spawn cover.
    [7.5, 8, 1.2, 7, 2.4, 'wall'],
    [7.5, 37, 1.2, 7, 2.4, 'wall'],

    // Canvas tents on the sand.
    [20, 7, 5, 4, 2.8, 'tent'],
    [62, 3, 4.5, 4, 2.8, 'tent'],
    [28.5, 15.5, 3, 3.2, 2.8, 'tent'],

    // Sandbags, crates and boulders: waist-high.
    [9, 24.5, 3, 1, 1, 'sandbag'],
    [21, 24.5, 2, 3.5, 3.2, 'rock'],
    [29, 22.8, 2.2, 2.2, 3, 'rock'],
    [29, 26.5, 3, 1, 1, 'sandbag'],
    [36.5, 22.2, 2, 1, 1, 'sandbag'],
    [16, 9.5, 1.8, 1.8, 1.1, 'boulder'],
    [44, 6.5, 2.5, 6, 3.8, 'rock'],
    [66, 12, 1.8, 2, 1.1, 'boulder'],
  ]);
  // The old well dead centre stops a clean north-south line through both doors.
  walls.push(wall(41.2, 25.2, 1.6, 1.6, 1.3, 'rock', { landmark: true }));
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3.5, [5, 12, 18, 23, 29, 34, 40, 47]);
  const lanes = [{ id: 'north', z: 9.5 }, { id: 'mid', z: 26 }, { id: 'south', z: 42.5 }];
  const nav = navGrid(walls, [4, 27, 42, 57, 80], [9.5, 26, 42.5]);
  const points = symmetricPoints(W, H,
    { x: 26.5, z: 26, r: 4.2 },
    { x: 42, z: 26, r: 5 },
    [{ x: 42, z: 8.5, r: 4.5 }, { x: 60, z: 9.5, r: 4.5 }]);

  // Search and Destroy (see bombSites). A in the north arroyo under the rock shelf, B on the open southern sand: one close fight, one long one.
  points.snd = bombSites({ x: 63.5, z: 10 }, { x: 62.5, z: 47.5 });

  // Capture the Flag (see flagBases). In the gap between the two rock shelves, in front of the spawns: the arroyos either side are the flanks.
  points.ctf = flagBases(W, H, { x: 14.5, z: 26.5 });

  return { id: 'dust', name: 'Dust', theme: 'dust', width: W, height: H, walls, spawns, lanes, nav, points };
}

export default build();
