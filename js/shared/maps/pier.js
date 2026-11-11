// Coast, small. A fishing pier on a grey, windy morning, 54 x 34 m. Two tidal inlets run in from opposite ends and,
// with a boathouse continuing each one's line, split the yard into three tight lanes: the north boardwalk, the fish
// market hall in the middle and the south slipway. A plank footbridge crosses each inlet. Water stops feet, not
// bullets or eyes. Half is listed; the other half is its 180-degree image.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

// Pieces by what they are, so the coast dressing (js/render/themes/coast.js) can tell them apart.
const boathouse = (x, z, w, d) => [x, z, w, d, 3.6, 'building', { boathouse: true }];
const shed = (x, z, w, d) => [x, z, w, d, 3.2, 'building', { shed: true }];
const hall = (x, z, w, d) => [x, z, w, d, 3.4, 'wall', { hall: true }];      // Fish market walls: timber, solid.
const pots = (x, z) => [x, z, 1.6, 1.6, 1.15, 'crate', { pots: true }];    // Lobster pots stacked waist high.
const fishbox = (x, z, w, d) => [x, z, w, d, 2.5, 'container', { fishbox: true }]; // Fish box stacks, over head height.
const nets = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { nets: true }];  // Net drying rack / fish counter.

function build() {
  const W = 54, H = 34;
  const walls = [];
  rotated(walls, W, H, [
    // North inlet, crossed by a footbridge (the gap at x 19..21.5), and the boathouse that carries its line east.
    [13, 8, 6, 3.5, 0, 'water'],
    [21.5, 8, 7.5, 3.5, 0, 'water'],
    boathouse(34, 8, 7, 3.5),

    // Fish market hall around the centre: doors on every side, so the middle lane is a room to clear.
    hall(22, 13, 4, 0.5), hall(29.5, 13, 2.5, 0.5),
    hall(22, 13.5, 0.5, 2.5),

    // North boardwalk: the boathouse on the sea wall, fish box stacks that break the long line.
    boathouse(11, 0, 6, 4),
    fishbox(24, 3, 2.2, 3),
    pots(29.5, 5.2),
    nets(14, 5.6, 3, 0.6),
    // Spawn screens.
    [7, 3.5, 1, 5, 2.4, 'wall'],
    [7, 25.5, 1, 5, 2.4, 'wall'],

    // Middle lane west: the bait shed and loose cover in front of the hall.
    shed(10, 14.5, 3.4, 3),
    pots(15.5, 12.9),
    nets(17.5, 18.4, 0.6, 2.6),
    pots(13.6, 19.6),

    // South lane west: the slipway shed on the sea wall, a dinghy on its trolley, a pot stack.
    shed(12, 30, 6, 4),
    [19.5, 27.6, 3.4, 1.6, 1.1, 'barrier', { dinghy: true }],
    fishbox(5, 15.6, 2, 2.2),
  ]);
  // The gutting counter in the middle of the hall is its own image.
  walls.push(wall(25.5, 16.6, 3, 0.8, 1.0, 'barrier', { nets: true, counter: true }));
  perimeter(walls, W, H, 3);

  const spawns = edgeSpawns(W, H, 3, [2.5, 6, 10, 13.5, 20.5, 24, 28, 31.5]);
  const lanes = [{ id: 'north', z: 6 }, { id: 'mid', z: 17 }, { id: 'south', z: 28 }];
  const nav = navGrid(walls, [3, 10, 20, 27, 34, 44, 51], [6, 17, 28]);
  // A in the south-west corner by the slipway, B in the hall, C its image on the north boardwalk.
  const points = symmetricPoints(W, H,
    { x: 16, z: 26.5, r: 3.2 },
    { x: 27, z: 17, r: 3.4 },
    [{ x: 27, z: 5.8, r: 3.2 }, { x: 14.5, z: 16.5, r: 3 }]);

  // Search and Destroy (see bombSites). A on the boardwalk past the boathouse, B beside the far slipway shed: the
  // hall stands between them, so a rotation is a fight through the middle.
  points.snd = bombSites({ x: 44, z: 4.5, r: 2.8 }, { x: 45.5, z: 26.5, r: 2.8 });

  // Capture the Flag (see flagBases). In the gap between the bait shed and the spawns' fish boxes.
  points.ctf = flagBases(W, H, { x: 8, z: 21 });

  // Render-only: the sea beyond the north and south walls, and the pier legs under the boardwalk edge.
  const decor = [{ type: 'sea', sides: ['north', 'south'] }];

  return {
    id: 'pier', name: 'Pier', theme: 'pier', size: 'small', region: 'coast',
    width: W, height: H, walls, spawns, lanes, nav, points, decor,
  };
}

export default build();
