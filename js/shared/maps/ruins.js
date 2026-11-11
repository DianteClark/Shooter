// Ruins (jungle, small). An overgrown temple court in the afternoon heat. The walled court holds the middle with its
// stepped altar; outside it, a colonnade runs along the north and south edges, half of it fallen into the ferns.
// Close quarters all round: the court's four gates are the fights, and nothing sees much past 25 m.
import { wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints, bombSites, flagBases } from './build.js';
import { tree, thicket, ruin, pillar, fern, block, templeCourt } from './jungle-kit.js';

function build() {
  const W = 52, H = 34;
  const walls = [];
  // The court, 24 x 16, centred: its own 180-degree image, so it goes in whole.
  for (const [x, z, w, d, h, kind, extra] of templeCourt(14, 9, 24, 16, 8)) walls.push(wall(x, z, w, d, h, kind, extra));
  rotated(walls, W, H, [
    // Spawn screens: the court's outer stair walls, broken down to head height.
    ruin(7, 5.5, 1.2, 5, 2.6), ruin(7, 23.5, 1.2, 5, 2.6),
    // Colonnade along the north edge: a fallen gate tower in the middle, standing columns, wall stubs off the court
    // that make the lane weave, and the fallen columns in the ferns.
    pillar(12.6, 2.6, 1.4), pillar(17.4, 3.9, 1.4), pillar(33.2, 3.9, 1.4), pillar(38, 2.6, 1.4),
    ruin(21, 5.4, 1.2, 3.6), ruin(29.8, 5.4, 1.2, 3.6),
    block(15.4, 0, 2.6, 1.1), fern(32.4, 7.4, 2.2, 1.6),
    tree(8.6, 0, 2.2), tree(41.2, 0, 2.2), tree(42.4, 5.4, 2),
    // In front of the west gate: ferns and a thicket either side, so the gate is not a lane from the spawn.
    fern(10.4, 15.6, 1.4, 2.8),
    thicket(9.8, 10.6, 2.6, 2.2), thicket(9.8, 21.2, 2.6, 2.2),
    // Inside the court: a stele inside each gate so no line runs gate to gate, columns, fallen drums.
    ruin(17.6, 13.2, 1.2, 1.8, 2.6), ruin(32.2, 13.2, 1.2, 1.8, 2.6),
    block(20.4, 16.4, 1.4, 1.2),
    fern(21.6, 11.6, 1.8, 1.1),
  ]);
  // The gate tower, fallen across the north edge, and its image on the south: one listed, it is its own pair.
  walls.push(wall(23.5, 0, 5, 4, 3.2, 'rock', { ruin: true }), wall(23.5, 30, 5, 4, 3.2, 'rock', { ruin: true }));
  // The altar: a stepped block dead centre, the one tall thing in the court.
  walls.push(wall(24, 15, 4, 4, 3.4, 'building', { landmark: true, altar: true }));
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3.2, [3.2, 7, 10.8, 14.6, 19.4, 23.2, 27, 30.8]);
  const lanes = [{ id: 'north', z: 6.5 }, { id: 'mid', z: 17 }, { id: 'south', z: 27.5 }];
  const nav = navGrid(walls, [4, 12, 18, 26, 34, 40, 48], [2, 6.5, 17, 27.5, 32]);
  const points = symmetricPoints(W, H,
    { x: 14.5, z: 29.5, r: 3.4 },
    { x: 26, z: 13, r: 3.4 },
    [{ x: 22, z: 6.6, r: 3.2 }, { x: 16.5, z: 16.5, r: 3 }]);
  // B sits on the altar's north step, not on top of it: move it to the centre line so it is its own image.
  points.dom[1] = { id: 'B', x: 26, z: 17, r: 4.4 };
  // Search and Destroy: both sites in the east half of the colonnade, at the gates the attackers must break through.
  points.snd = bombSites({ x: 37, z: 6.8 }, { x: 35, z: 28 });
  // Capture the Flag: on the flagstones in front of the spawn, behind the gate thickets.
  points.ctf = flagBases(W, H, { x: 8.8, z: 17 });

  return { id: 'ruins', name: 'Ruins', theme: 'jungle', size: 'small', region: 'jungle', width: W, height: H, walls, spawns, lanes, nav, points };
}

export default build();
