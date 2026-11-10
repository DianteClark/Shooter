// Unfinished tower top at sunset, forty floors up. An open concrete slab on a grid of steel columns, with
// half-built block walls, pallet stacks and two open light wells in the slab: lots of partial cover and
// thin columns to peek past, so fights are mid-range and from every angle. The wells stop feet, not bullets.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

function build() {
  const W = 68, H = 44;
  const walls = [];
  rotated(walls, W, H, [
    // Light wells: holes in the slab down to the floor below. Water rules: shoot and see across, never walk.
    [15, 17.5, 5.5, 7, 0, 'water', { void: true }],

    // Steel columns on the structural grid.
    [11.5, 3.5, 0.9, 0.9, 4.2, 'crane', { column: true }],
    [11.5, 39, 0.9, 0.9, 4.2, 'crane', { column: true }],
    [20, 9.5, 0.9, 0.9, 4.2, 'crane', { column: true }],
    [20, 30, 0.9, 0.9, 4.2, 'crane', { column: true }],
    [27.5, 3.5, 0.9, 0.9, 4.2, 'crane', { column: true }],
    [26.6, 16.4, 0.9, 0.9, 4.2, 'crane', { column: true }],
    [27.5, 39, 0.9, 0.9, 4.2, 'crane', { column: true }],

    // Spawn screens and the stair core behind each spawn.
    [7, 5, 1, 10, 2.4, 'wall'],
    [7, 29, 1, 10, 2.4, 'wall'],
    [3.5, 17, 4, 10, 3.6, 'building', { stairs: true }],

    // Half-built blockwork: solid, waist-high where the courses stop.
    [13.5, 9, 5, 0.8, 2.6, 'wall', { block: true }],
    [13.5, 3.5, 0.8, 5.5, 2.6, 'wall', { block: true }],
    [19.2, 33, 0.8, 4.8, 2.6, 'wall', { block: true }],
    [19.5, 13.5, 3.6, 2.2, 2.4, 'container', { stack: 'rebar' }],
    [23, 22.5, 0.8, 6, 2.6, 'wall', { block: true }],
    [23.8, 27.7, 3, 0.8, 2.6, 'wall', { block: true }],
    [14, 33, 5.2, 0.8, 2.6, 'wall', { block: true }],
    [24, 12.5, 4, 0.8, 2.6, 'wall', { block: true }],
    [28.5, 9.5, 3.2, 0.8, 2.6, 'wall', { block: true }],
    [29.5, 32, 0.8, 4.5, 2.6, 'wall', { block: true }],
    [17, 39.5, 0.8, 4.5, 2.6, 'wall', { block: true }],

    // Pallet stacks of plasterboard and rebar: tall, solid.
    [20.5, 1.5, 4, 2, 2.4, 'container', { stack: 'board' }],
    [9.5, 24.5, 2, 3.5, 2.4, 'container', { stack: 'rebar' }],
    [25, 34.5, 2.2, 2.4, 2.4, 'container', { stack: 'board' }],
    [24.5, 5.5, 2.4, 3, 2.4, 'container', { stack: 'rebar' }],
    [31, 12.5, 2.6, 2.6, 2.4, 'container', { stack: 'board' }],
    [30.6, 29.2, 2.4, 2.4, 2.4, 'container', { stack: 'board' }],

    // Waist-high cover: brick pallets, a jersey line, rooftop plant.
    [11, 14.5, 1.8, 1.8, 1.1, 'crate'],
    [21.5, 17, 1.8, 1.8, 1.1, 'crate'],
    [12.5, 28.5, 2.6, 0.8, 0.9, 'barrier'],
    [32.5, 7.2, 2.8, 0.8, 0.9, 'barrier'],
    [17.5, 4.5, 2.6, 1.6, 1.1, 'barrier', { plant: true }],
    [25.6, 23.4, 1.6, 2.6, 1.1, 'barrier', { plant: true }],
  ]);
  // Lift core and the tower crane's mast: the solid middle of the slab.
  walls.push(wall(30.5, 19, 7, 6, 3.8, 'building', { landmark: true }));
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3, [3, 6.5, 10, 13.5, 30.5, 34, 37.5, 41]);
  const lanes = [{ id: 'north', z: 6.5 }, { id: 'mid', z: 22 }, { id: 'south', z: 37.5 }];
  const nav = navGrid(walls, [3, 12, 24, 34, 44, 56, 65], [6.5, 22, 37.5]);
  const points = symmetricPoints(W, H,
    { x: 22, z: 37, r: 3.8 },
    { x: 34, z: 22, r: 6 },
    [{ x: 34, z: 5.5, r: 4.2 }, { x: 11, z: 21.5, r: 3.6 }]);

  // Search and Destroy (see bombSites). A among the north blockwork, B on the slab beside the far light well: the lift core blocks the line between them.
  points.snd = bombSites({ x: 45, z: 4.5 }, { x: 53, z: 30.5 });

  // Capture the Flag (see flagBases). On the roof in front of the parapet block, beside the near light well.
  points.ctf = flagBases(W, H, { x: 10, z: 22 });

  return { id: 'topside', name: 'Topside', theme: 'topside', width: W, height: H, walls, spawns, lanes, nav, points };
}

export default build();
