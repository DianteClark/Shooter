// Storm-lashed night docks. Two flooded basins with moored ships split the map into three long
// strips: north quay, the central causeway and south quay. Water stops feet, not bullets or eyes.
import { bombSites, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

function build() {
  const W = 80, H = 48;
  const walls = [];
  rotated(walls, W, H, [
    // Basins and the ships moored in them. The hull deliberately sits inside its basin.
    [24, 9, 28, 11, 0, 'water'],
    [28, 9.3, 22, 6, 4, 'hull', { bow: 1, ship: true }],
    [37, 15.3, 6, 4.7, 2.2, 'hull', { bow: -1, tug: true }],

    // Spawn screens and the bonded warehouses that divide the aprons.
    [7, 7, 1.2, 6, 2.4, 'wall'],
    [7, 35, 1.2, 6, 2.4, 'wall'],
    [11, 10, 9, 9, 3.6, 'building'],
    [11, 29, 9, 9, 3.6, 'building'],

    // Causeway: staggered boxes so nobody owns the whole 80 metres.
    [25, 20.6, 3.5, 2.5, 2.7, 'container'],
    [31, 23, 2.2, 2.4, 2.9, 'container'],
    [35.5, 21.5, 3, 0.8, 0.9, 'barrier'],
    [36, 25.8, 1.8, 2.2, 2.7, 'container'],

    // North quay: crane legs and a broken line of boxes.
    [25, 2, 6, 2.5, 2.7, 'container'],
    [40, 6.5, 6, 2.5, 2.7, 'container'],
    [49, 1, 2.5, 5.7, 2.7, 'container'],
    [34, 0.6, 1.4, 1.4, 2.4, 'crane'],
    [34, 6.4, 1.4, 1.4, 2.4, 'crane'],
    [56, 5, 1.6, 1.6, 1.1, 'crate'],
    [60, 2.2, 3, 2.5, 2.7, 'container'],
    [21, 4, 2.5, 3.2, 2.7, 'container'],

    // Apron cover around the causeway mouths.
    [14, 22.6, 2, 2, 1.1, 'crate'],
    [21.5, 22.5, 2.5, 3, 2.7, 'container'],
    [7.5, 19.5, 1.2, 9, 2.4, 'wall'],
  ]);
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3.5, [5, 11, 16, 20.5, 27.5, 32, 37, 43]);
  const lanes = [{ id: 'north', z: 4.5 }, { id: 'mid', z: 24 }, { id: 'south', z: 43.5 }];
  const nav = navGrid(walls, [4, 22, 40, 58, 76], [4.5, 24, 43.5]);
  const points = symmetricPoints(W, H,
    { x: 22, z: 28.5, r: 3.8 },
    { x: 40, z: 24, r: 4 },
    [{ x: 45, z: 3.5, r: 4 }, { x: 29, z: 24.5, r: 3.6 }]);

  // Render-only dressing: gantry cranes straddle the quay on their crane-kind legs.
  const decor = [{ type: 'gantry', x: 34.7, z0: 1.3, z1: 7.1, boomZ: 15 }, { type: 'gantry', x: 45.3, z0: 46.7, z1: 40.9, boomZ: 37 }];

  // Search and Destroy (see bombSites). One on each quay, beyond the crane legs and the box line: the basins keep them apart, so a rotation goes back around the warehouses.
  points.snd = bombSites({ x: 64.5, z: 6 }, { x: 63, z: 41.5 });

  return { id: 'harbor', name: 'Harbor', theme: 'harbor', width: W, height: H, walls, spawns, lanes, nav, points, decor };
}

export default build();
