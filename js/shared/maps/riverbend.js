// Riverbend (jungle, large). A brown river winds north to south through the middle in a long S, splitting the map;
// fishing villages stand on either bank. Three ways over: the plank bridge in the north, the stepping-stone ford in
// the middle under the river god's statue, and the boat dock in the south (the bridge's 180-degree image, moored
// boats lashed into a walkway). The river is open water, so every reach is a long sight line to cross under fire.
import { wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints, bombSites, flagBases } from './build.js';
import { tree, thicket, fern, block, log, hut, crate, sandbag, canoe, bamboo } from './jungle-kit.js';

const water = (x, z, w, d) => [x, z, w, d, 0, 'water'];

function build() {
  const W = 104, H = 64;
  const walls = [];
  rotated(walls, W, H, [
    // ---- The river: north reach (bridge at z 8..11), the bend, and the ford's north bank (ford z 28.5..35.5).
    water(44, 0, 7, 8), water(44, 11, 7, 9),
    water(44, 20, 13, 6), water(47, 26, 10, 2.5),

    // ---- North village: stilt huts round a yard, the longhouse by the river, canoes drawn up at the bridge.
    hut(14, 4, 5, 4), hut(24, 1.5, 4.5, 4), hut(18, 14, 4, 4.5), hut(29, 13, 8, 4, 3.9),
    bamboo(33.6, 3.6, 1, 4.4), sandbag(39.6, 6.4, 1, 2.6), canoe(41.4, 13.4, 1, 3.4),
    crate(25.2, 8.8), crate(10.6, 1.4), tree(38.4, 0, 2.2),
    fern(21.6, 20.6, 2.6, 1.3), tree(26.4, 18.6, 2.4),

    // ---- Middle bank: open ground down to the ford, broken by big trees and the old shrine stones.
    bamboo(8, 13, 1.2, 6), bamboo(8, 45, 1.2, 6),         // Spawn screens.
    thicket(28.6, 22.4, 4, 3.4), tree(38.6, 22.6, 2.4), hut(18.6, 25.6, 5, 4.4),
    block(41, 28.6, 1.4, 2.2), log(41.4, 34.6, 2.8, 1), fern(33.2, 29.6, 1.4, 3),
    tree(26, 35, 2.4), crate(14.4, 36), [30.4, 31, 1.2, 4.6, 2.8, 'rock', { ruin: true }], thicket(34.4, 38.6, 3.6, 4.4),

    // ---- South bank: the fishing hamlet and its boathouse at the dock.
    hut(41.6, 57.4, 6, 4, 3.9), bamboo(35, 50.6, 4.4, 1), hut(25.4, 52.4, 5, 4), hut(11.6, 51, 4.5, 4),
    tree(19.6, 43.4, 2.4), tree(31.6, 59.8, 2.2), canoe(49.4, 46.6, 1, 3.4), crate(48.6, 52.2),
    fern(15.6, 58.6, 2.6, 1.3), sandbag(29.4, 44.6, 2.6, 1),
  ]);
  // The river god: a statue standing in the middle of the ford.
  walls.push(wall(51.2, 31.2, 1.6, 1.6, 3.4, 'rock', { ruin: 'statue', landmark: true }));
  perimeter(walls, W, H, 4.2);

  const spawns = edgeSpawns(W, H, 3.4, [3.5, 9.5, 16, 22, 42, 48, 54.5, 60.5]);
  const lanes = [{ id: 'north', z: 9.5 }, { id: 'mid', z: 32 }, { id: 'south', z: 54.5 }];
  const nav = navGrid(walls, [4, 14, 24, 34, 41, 52, 63, 70, 80, 90, 100], [3, 9.5, 20, 32, 44, 54.5, 61]);
  const points = symmetricPoints(W, H,
    { x: 24, z: 44, r: 4.2 },
    { x: 52, z: 32, r: 5 },
    [{ x: 37, z: 9.5, r: 4 }, { x: 37, z: 32.5, r: 4 }]);
  // Search and Destroy: both on the east bank, one up from the bridge, one in the village behind the dock.
  points.snd = bombSites({ x: 66, z: 7 }, { x: 68, z: 54 });
  // Capture the Flag: in the open in front of the spawns.
  points.ctf = flagBases(W, H, { x: 12.5, z: 32 });

  // Floors the renderer draws: the bridge, the dock (its image) and the ford's stepping stones.
  const rooms = [
    { x: 44, z: 8, w: 7, d: 3, floor: 'bridge' }, { x: 53, z: 53, w: 7, d: 3, floor: 'dock' },
    { x: 47, z: 28.5, w: 10, d: 7, floor: 'ford' },
  ];

  return { id: 'riverbend', name: 'Riverbend', theme: 'jungle', size: 'large', region: 'jungle', width: W, height: H, walls, spawns, lanes, nav, points, rooms };
}

export default build();
