// Expedition (jungle, huge: Ground War). An old jungle airstrip, 136 x 80 m, with an expedition camped at each end.
// The runway runs the length of the middle, a cargo plane broken in two across it; north of it stands a temple court
// in the trees, south of it a coffee plantation, and a river comes down to the runway from each side, crossed by a
// plank bridge and a ford. Five lanes: camp and bridge, temple and ford, the runway, and their images. Half is
// listed; the other half is its 180-degree image.
import { wall, rotated, perimeter, edgeSpawns, navGrid } from './build.js';
import { tree, thicket, fern, block, log, hut, lab, tent, crate, sandbag, canoe, crops, banana, truck, drums, tin, templeCourt } from './jungle-kit.js';

const water = (x, z, w, d) => [x, z, w, d, 0, 'water'];
const plane = (x, z, w, d) => [x, z, w, d, 2.8, 'container', { plane: true }];
const wing = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { wing: true }];

function build() {
  const W = 136, H = 80;
  const walls = [];
  rotated(walls, W, H, [
    // ---- North lane (z 0..10): the expedition camp, then the corridor along the temple's north wall to the bridge.
    tent(13, 4, 4, 3), tent(21, 2.4, 4, 3), crate(18.2, 9.6), crate(27, 3.4), tree(28, 6.4, 2.4),
    thicket(7.6, 12, 1.6, 5),                                // Spawn screen.
    log(35, 3.2, 3.2, 1), fern(46, 1.4, 2.8, 1.3), tree(40.4, 6.2, 2.2), thicket(34, 7.4, 2.6, 2.6), tree(51, 0, 2.2), tree(8.4, 0, 2.2), sandbag(54.2, 3.6, 1, 2.6),
    water(58, 0, 5, 6), water(58, 9.5, 5, 11), water(58, 25, 5, 8),   // The river; bridge z 6..9.5, ford z 20.5..25.

    // ---- North-middle lane (z 10..33): the temple court (flag B) and the control tower above the runway.
    ...templeCourt(32, 10, 20, 16, 7),
    [38.5, 14.5, 7, 7, 5, 'building', { temple: true }],
    block(34.6, 22.2, 2.2, 1), fern(47.4, 13, 1.3, 2.4),
    lab(10, 19, 6, 4), truck(20.6, 24.4, 4.4, 2.2), crate(25, 18), tree(24.6, 11.6, 2.2), tree(5.6, 26, 2.2),
    [44, 28.6, 4, 4, 7.5, 'building', { tower: true }],
    tree(27.6, 28.4, 2.4), crate(54, 14.4), block(54.6, 21.6, 1.4, 1.4), canoe(57, 26.4, 1, 3.4),

    // ---- Middle lane (z 33..47): the west hangar (flag A), the runway, the broken plane in the middle.
    tin(14, 33, 14, 0.6), tin(14, 46.4, 14, 0.6), tin(14, 33.6, 0.6, 4.4), tin(14, 42, 0.6, 4.4),
    plane(17.6, 38.6, 6.4, 2.8), drums(25.6, 35, 1.2, 2.2),
    truck(34, 41.8, 4.4, 2.2), crate(40, 35.6), crate(47.4, 42.6), sandbag(51.4, 35, 2.6, 1),
    plane(55, 38.5, 9, 3), wing(58.5, 35, 3, 3.5),

    // ---- South-middle and south lanes (z 47..80): the coffee plantation, its house and drying barn.
    [10, 51.6, 7, 6, 4.4, 'building', { house: true }],
    thicket(7.6, 63, 1.6, 5),                                // Spawn screen.
    hut(36, 50, 8, 4, 3.8), tree(20, 49.6, 2.4), drums(30.6, 53.4, 2, 1.2),
    crops(20, 61, 12, 0.6), crops(35, 61, 12, 0.6), crops(20, 64.6, 12, 0.6), crops(35, 64.6, 12, 0.6),
    crops(20, 68.2, 12, 0.6), crops(35, 68.2, 12, 0.6), crops(20, 71.8, 12, 0.6), crops(35, 71.8, 12, 0.6),
    banana(49.6, 59.4, 4, 4.4), banana(24, 75, 5, 3.4), banana(13, 69, 3.6, 4), truck(50, 66.4, 4.4, 2.2),
    // The workers' huts down by the east river (its image is the camp beside the west river's far bank).
    hut(58, 51.6, 5, 4), hut(63.4, 62, 4.6, 4.4), tree(60, 72.4, 2.4), thicket(65, 48.6, 3.6, 2.6),
    crate(56, 58.4), fern(66.6, 76, 2.8, 1.3),
  ]);
  perimeter(walls, W, H, 4.2);

  const spawns = edgeSpawns(W, H, 3.5, [3, 7.5, 18, 22.5, 27, 31, 35, 39.5, 44, 48, 52.5, 57, 61.5, 70, 74, 77.5]);
  const lanes = [{ id: 'north', z: 7.8 }, { id: 'northmid', z: 23 }, { id: 'mid', z: 40 }, { id: 'southmid', z: 57 }, { id: 'south', z: 72.2 }];
  const nav = navGrid(walls, [4, 14, 24, 34, 46, 56, 68, 80, 90, 102, 112, 122, 132], lanes.map(l => l.z));

  // Five flags: two near each team's home (A hangar and B temple for the west), C in the middle of the runway, the only
  // point a 180-degree map can hold fairly. Ids run west to east.
  const image = p => ({ x: W - p.x, z: H - p.z, r: p.r });
  const A = { x: 24, z: 44, r: 4.5 }, B = { x: 48.6, z: 18, r: 4.2 }, C = { x: 68, z: 40, r: 4.5 };
  const points = {
    dom: [{ id: 'A', ...A }, { id: 'B', ...B }, { id: 'C', ...C }, { id: 'D', ...image(B) }, { id: 'E', ...image(A) }],
    hard: [],
  };

  // Floors for the renderer: the runway, the hangars, the temple courts, the bridges and fords.
  const rooms = [{ x: 26, z: 34, w: 84, d: 12, floor: 'runway' }];
  for (const r of [[14, 33, 14, 14, 'concrete'], [32, 10, 20, 16, 'flags'], [58, 6, 5, 3.5, 'bridge'], [58, 20.5, 5, 4.5, 'ford']]) {
    rooms.push({ x: r[0], z: r[1], w: r[2], d: r[3], floor: r[4] });
    rooms.push({ x: W - r[0] - r[2], z: H - r[1] - r[3], w: r[2], d: r[3], floor: r[4] });
  }

  return {
    id: 'expedition', name: 'Expedition', theme: 'jungle', size: 'huge', region: 'jungle', width: W, height: H,
    walls, spawns, lanes, nav, points, rooms, modes: ['gwtdm', 'gwdom'], large: true,
  };
}

export default build();
