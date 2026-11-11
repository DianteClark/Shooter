// Canopy (jungle, medium). A field-research camp on stilts beside the pool under a waterfall. The pool fills the
// middle; a lookout tower stands on the island in it, reached by four rope bridges. Streams run out of the pool to
// the north and south edges, each crossed by one more bridge, so every way east is a bridge: the stream crossings
// on the flanks, or over the island in the middle, where you can be shot at from every bank.
import { wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints, bombSites, flagBases } from './build.js';
import { tree, thicket, fern, log, hut, lab, tent, crate, sandbag, bamboo } from './jungle-kit.js';

const water = (x, z, w, d) => [x, z, w, d, 0, 'water'];

function build() {
  const W = 76, H = 48;
  const walls = [];
  rotated(walls, W, H, [
    // ---- The pool (x 28..48, z 14..34) round the island (x 33..43, z 19..29), gapped for the bridges.
    water(28, 14, 6.5, 5), water(36.9, 14, 11.1, 5),        // North strip; the north bridge lands at x 34.5..36.9.
    water(28, 19, 5, 4), water(28, 25.4, 5, 3.6),           // West strip; the west bridge at z 23..25.4.
    // The stream from the waterfall out to the north edge, crossed by the north lane's bridge at z 5..8.
    water(37, 0, 2.6, 5), water(37, 8, 2.6, 6),
    // Sandbags on the island's edges, against the water.
    sandbag(33, 19, 0.9, 3.2), sandbag(40.8, 19, 2.2, 0.9),

    // ---- West camp.
    bamboo(7, 9, 1.2, 6), bamboo(7, 32, 1.2, 6),           // Spawn screens.
    lab(12, 2.5, 6, 4), hut(22, 8.5, 5, 4), tent(28.5, 1.6, 4, 3),
    lab(13, 38, 6, 5), hut(21, 33.5, 4.5, 4), tent(27, 42.4, 4, 3),
    tree(20, 6.6, 2), crate(31.4, 9.2), sandbag(35.8, 2.2, 1.2, 2.8),
    // The bank beside the pool: big trees and growth, a log, ferns.
    thicket(22.4, 14.6, 3, 4), thicket(23.4, 25.8, 3, 4.2),
    tree(16.6, 12.6, 2.4), tree(12.4, 31.6, 2), tree(24, 0, 2.2), tree(51, 0, 2.2), tree(30.6, 37.2, 2.2), tree(1.4, 22.6, 2.2),
    lab(19.4, 22.2, 2.6, 3.4, 3), lab(15, 18.6, 4.4, 3.6), tree(16.4, 27.6, 2), log(27, 19, 1, 2.6),
    fern(9.8, 28.2, 2.4, 1.3), fern(31, 12.6, 2.4, 1.4),
  ]);
  // The lookout tower in the middle of the island.
  walls.push(wall(36.3, 22.3, 3.4, 3.4, 4.6, 'building', { landmark: true, lookout: true }));
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3.2, [3.5, 8, 12.5, 18, 30, 35.5, 40, 44.5]);
  const lanes = [{ id: 'north', z: 6.5 }, { id: 'mid', z: 24.2 }, { id: 'south', z: 41.5 }];
  const nav = navGrid(walls, [4, 12, 20, 26, 31, 38, 45, 50, 56, 64, 72], [3, 6.5, 12, 24.2, 36, 41.5, 45]);
  const points = symmetricPoints(W, H,
    { x: 17, z: 30, r: 3.8 },
    { x: 38, z: 24, r: 5.8 },
    [{ x: 31, z: 7, r: 3.6 }, { x: 20.5, z: 20, r: 3.6 }]);
  // Search and Destroy: both in the east camp, one by each stream crossing's far end.
  points.snd = bombSites({ x: 48, z: 9 }, { x: 52, z: 43 });
  // Capture the Flag: on the open ground in front of the spawns, a bridge run from the island.
  points.ctf = flagBases(W, H, { x: 11, z: 24.2 });

  // Floors the renderer draws: plank bridges over the water and the island's deck.
  const rooms = [];
  for (const r of [[34.5, 14, 2.4, 5, 'bridge'], [28, 23, 5, 2.4, 'bridge'], [37, 5, 2.6, 3, 'bridge'], [33, 19, 10, 10, 'deck']]) {
    rooms.push({ x: r[0], z: r[1], w: r[2], d: r[3], floor: r[4] });
    if (r[4] !== 'deck') rooms.push({ x: W - r[0] - r[2], z: H - r[1] - r[3], w: r[2], d: r[3], floor: r[4] });
  }

  return { id: 'canopy', name: 'Canopy', theme: 'jungle', size: 'medium', region: 'jungle', width: W, height: H, walls, spawns, lanes, nav, points, rooms };
}

export default build();
