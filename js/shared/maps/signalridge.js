// Sirocco, medium: Signal Ridge, 76 x 46, a district of Sirocco Basin (docs/DISTRICTS.md) and a 6v6 map of its own.
// A listening station on a red-rock ridge: rows of dish antennas on their pedestals along the crest paths, the great
// dish in the middle over the access road, fenced transformer yards, prefab huts and the control block at each end.
// The fences stop feet, not shots: every yard is a window. Crags along both edges where the ridge falls away. Nothing
// like Observatory's snowy summit: dusk, sand haze, steel dishes. In Sirocco Basin its huts open up as buildings to loot.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const crag = (x, z, w, d, h = 3.6) => [x, z, w, d, h, 'rock', { ridgerock: true }];
const dish = (x, z, s = 2.4) => [x, z, s, s, 2.8, 'building', { dish: true, keep: true }];
const hut = (x, z, w, d, h = 3.2) => [x, z, w, d, h, 'building', { prefab: true }];
const control = (x, z, w, d, h = 3.8) => [x, z, w, d, h, 'building', { control: true }];
const fence = (x, z, w, d) => [x, z, w, d, 2.2, 'barrier', { fence: true }];
const transformer = (x, z) => [x, z, 1.8, 1.6, 1.9, 'container', { transformer: true }];
const generator = (x, z, along = true) => [x, z, along ? 3 : 1.8, along ? 1.8 : 3, 2, 'container', { generator: true }];
const spool = (x, z) => [x, z, 1.5, 1.5, 1.1, 'crate', { spool: true }];
const sandbag = (x, z, w, d) => [x, z, w, d, 1.0, 'sandbag', {}];

function build() {
  const W = 76, H = 46;
  const walls = [];
  rotated(walls, W, H, [
    // ---- The crags where the ridge falls away: the north edge's west half and the south edge's (images make the rest).
    crag(0, 0, 10, 2), crag(10, 0, 6, 3.2), crag(16, 0, 9, 1.8), crag(25, 0, 7, 2.6, 3), crag(32, 0, 6, 1.6, 2.8),
    crag(0, 44, 13, 2), crag(13, 43, 8, 3), crag(21, 44, 9, 2, 3), crag(30, 43.4, 8, 2.6),

    // ---- The north crest path (z 3-12): two dishes, a prefab hut, a mast.
    dish(12, 9.6), dish(24, 8.4), hut(26, 13.4, 6, 4.8), spool(18.4, 5.4),

    // ---- The transformer yard (x 14-22, z 13-18), fenced, with an opening on the east and one on the south.
    fence(14, 13, 8, 0.2), fence(14, 13.2, 0.2, 4.8), fence(21.8, 13.2, 0.2, 2.4), fence(14, 18, 5, 0.2),
    transformer(16, 14.8),

    // ---- The south crest path (z 30-42): a dish, the control block, a generator, sandbags, a cable spool.
    dish(18, 33.4), control(7.6, 29.5, 9, 6), generator(30, 29), sandbag(25.6, 38.4, 3, 1), spool(35.4, 37),

    // ---- The access road (z 20-26): a cable drum, a parked truck.
    spool(10, 20.6), [20, 24.2, 5, 2.2, 2.6, 'container', { truck: true }],

    // ---- Spawn cover.
    sandbag(4.8, 4, 0.9, 3), sandbag(4.8, 38.6, 0.9, 3),
  ]);
  // The great dish on its pedestal over the road, the middle of the ridge: its own image.
  walls.push(wall(36, 21, 4, 4, 3.4, 'building', { dish: true, big: true, landmark: true }));
  // Radio masts at the two ends of the crest.
  walls.push(wall(37.5, 4.2, 1, 1, 12, 'crane', { mast: true }), wall(37.5, 40.8, 1, 1, 12, 'crane', { mast: true }));
  perimeter(walls, W, H, 4);

  const spawns = edgeSpawns(W, H, 2.6, [3.4, 8, 12, 21, 23, 25, 34, 38, 42]);
  const lanes = [{ id: 'north', z: 6 }, { id: 'mid', z: 23 }, { id: 'south', z: 40 }];
  const nav = navGrid(walls, [2.6, 9, 15, 20, 28, 33, 43, 48, 56, 61, 67, 73.4], lanes.map(l => l.z));
  // Domination: A at the transformer yard's gate, B under the great dish, C its image.
  const points = symmetricPoints(W, H, { x: 24, z: 19.2, r: 3.4 }, { x: 38, z: 23, r: 4.6 },
    [{ x: 30, z: 6.6, r: 3.4 }, { x: 22, z: 36.4, r: 3.2 }]);
  points.hard.push({ id: 'h5', x: 38, z: 23, r: 4.4 });
  // Search and Destroy (see bombSites): A at the far north dish row, B by the far control block.
  points.snd = bombSites({ x: 50, z: 6.6 }, { x: 58, z: 18.6 }, 3);
  // Capture the Flag (see flagBases): on the road in front of the spawns.
  points.ctf = flagBases(W, H, { x: 6.4, z: 23 });

  const zones = [{ x: 0, z: 20, w: W, d: 6, kind: 'road' }, { x: 14, z: 13, w: 8, d: 5.2, kind: 'yard' }, { x: 54, z: 27.8, w: 8, d: 5.2, kind: 'yard' },
    { x: 30, z: 17, w: 16, d: 12, kind: 'apron' }];

  return {
    id: 'signalridge', name: 'Signal Ridge', theme: 'sirocco', size: 'medium', region: 'desert',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
