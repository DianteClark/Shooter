// Farmland, small. Millrace: a stone water mill on a creek through an apple orchard, on a wet spring morning, 54 x 36 m.
// The creek runs north to south down the middle; it can be seen and shot across but not waded. Three ways over it: a
// plank footbridge on the north lane, the wide stone mill bridge in the middle (flag B, open to both banks and boxed
// in by the mill to the north and the cider house to the south), and the footbridge on the south lane. West of the
// creek the farmhouse, the orchard rows, the pig pen and the grain silo; the east bank is their 180-degree image.
import { rotated, perimeter, edgeSpawns, navGrid, symmetricPoints, bombSites, flagBases } from './build.js';

// Pieces by what they are. Each is a wall kind (see build.js) plus a flag for the renderer (js/render/themes/millrace.js).
const water = (x, z, w, d) => [x, z, w, d, 0, 'water', { creek: true }];
const house = (x, z, w, d, h = 4.4) => [x, z, w, d, h, 'building', { house: true }];
const tree = (x, z, s = 1) => [x, z, s, s, 3.2, 'wall', { apple: true }];        // Apple tree: trunk blocks, crown above.
const oak = (x, z, s = 1.6) => [x, z, s, s, 5, 'wall', { oak: true }];
const hedge = (x, z, w, d) => [x, z, w, d, 2.3, 'wall', { hedge: true }];
const stack = (x, z, w = 2.2, d = 2.2) => [x, z, w, d, 2.6, 'container', { hay: true }];   // Hay stack: solid.
const cart = (x, z, w, d) => [x, z, w, d, 2.2, 'container', { cart: true }];
const crates = (x, z, s = 1.6) => [x, z, s, s, 2.1, 'container', { apples: true }];         // Apple crates piled high.
const bale = (x, z) => [x, z, 1.4, 1.4, 1.2, 'crate', { bale: true }];
const dyke = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { stone: true }];               // Dry-stone wall: see over.
const fence = (x, z, w, d) => [x, z, w, d, 1.1, 'barrier', { fence: true }];
const trough = (x, z, w, d) => [x, z, w, d, 0.8, 'barrier', { trough: true }];
const parapet = (x, z, w, d) => [x, z, w, d, 0.9, 'barrier', { parapet: true }];

function build() {
  const W = 54, H = 36;
  const walls = [];
  rotated(walls, W, H, [
    // ---- The creek (x 25.5..28.5): listed north of the mill bridge; rotation gives the south half.
    water(25.5, 0, 3, 2.5), water(25.5, 6.5, 3, 2), water(25.5, 14, 3, 1.5),
    // The mill straddles the creek between the north footbridge and the mill bridge; its image is the cider house.
    [23, 8.5, 8, 5.5, 5.2, 'building', { mill: true, landmark: true }],
    // Mill bridge parapets, waist high: the bridge is 4.4 m wide between them.
    parapet(25.5, 15.5, 3, 0.3),

    // ---- North lane (z 0..8): the farmhouse, a hay stack and the old oak at the footbridge.
    house(9, 0, 6, 4.6),
    stack(18.6, 4.8), bale(16, 1.4), oak(22.4, 0),
    dyke(14.6, 7.6, 2.8, 0.6),

    // ---- The orchard (x 10..21, z 8.5..14): two staggered rows of apple trees.
    tree(10.5, 9.4), tree(14, 9.4), tree(17.5, 9.4),
    tree(12.2, 12.2), tree(15.7, 12.2), tree(19.2, 12.2),

    // ---- Middle: spawn screen, the hay cart, apple crates at the bridge mouth.
    hedge(6, 15.6, 0.9, 4.4),
    cart(13.6, 16.4, 3.4, 1.9),
    crates(20.6, 17.4),

    // ---- South-west: the pig pen (fenced) beside the stable, the silo, a hay stack screening the spawns.
    stack(5.8, 24.6),
    fence(10, 24.4, 3, 0.4), fence(15, 24.4, 2.6, 0.4), fence(17.2, 24.8, 0.4, 2.4),
    trough(12, 27.6, 2.2, 0.7),
    house(9.6, 31, 6.6, 5, 3.6),                 // The stable, against the south hedge.
    [17.4, 27.2, 3, 3, 8, 'building', { silo: true }],
    bale(20.8, 32.6),
  ]);
  perimeter(walls, W, H, 3);

  const spawns = edgeSpawns(W, H, 3, [2.5, 6.5, 10.5, 14, 22, 25.5, 29.5, 33.5]);
  const lanes = [{ id: 'north', z: 4.5 }, { id: 'mid', z: 18 }, { id: 'south', z: 31.5 }];
  const nav = navGrid(walls, [3, 8, 12, 16, 20, 24, 27, 30, 34, 38, 42, 46, 51], [2.5, 4.5, 7, 11, 14.8, 18, 21.2, 25, 29, 31.5, 33.5]);
  // Domination: A on the north lane between the farmhouse and the orchard; B the mill bridge; C is A's image.
  // Hardpoint: the north footbridge's west end, the pig pen, their images, then the bridge.
  const points = symmetricPoints(W, H,
    { x: 13, z: 6.4, r: 3 },
    { x: 27, z: 18, r: 3.6 },
    [{ x: 22, z: 4.2, r: 3 }, { x: 13.4, z: 28.4, r: 3 }]);
  points.hard.push({ id: 'h5', x: 27, z: 18, r: 3.2 });

  // Search and Destroy (see bombSites): both on the east bank. A in the east pig pen (the image of the west one),
  // B between the east orchard and the east farmhouse.
  points.snd = bombSites({ x: 40.6, z: 7.6 }, { x: 41.4, z: 28.8 }, 2.8);
  // Capture the Flag (see flagBases): behind the spawn hedge's east face, in front of the spawns.
  points.ctf = flagBases(W, H, { x: 9.4, z: 18 });

  // Floors the renderer draws: the plank footbridges and the stone mill bridge.
  const rooms = [
    { x: 25.5, z: 2.5, w: 3, d: 4, floor: 'bridge' }, { x: 25.5, z: 29.5, w: 3, d: 4, floor: 'bridge' },
    { x: 25.5, z: 15.5, w: 3, d: 5, floor: 'stone' },
  ];

  return {
    id: 'millrace', name: 'Millrace', theme: 'millrace', size: 'small', region: 'farmland',
    width: W, height: H, walls, spawns, lanes, nav, points, rooms,
  };
}

export default build();
