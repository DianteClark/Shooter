// Sirocco, small: Red Gulch, 56 x 36, a district of Sirocco Basin (docs/DISTRICTS.md) and a 6v6 map of its own. A
// canyon town: red sandstone cliffs close in on both sides, a row of tall mud tower houses stands at the foot of each,
// and the Spice Road runs between them as the town's main street, under the old stone arch in the little plaza. The
// ledge paths along the cliff feet are the flanks; three-metre alleys between the houses join them to the street.
// Close fights round corners, nothing like Canyon's open riverbed. In Sirocco Basin the tower houses open up to loot.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const cliff = (x, z, w, d, h = 7) => [x, z, w, d, h, 'rock', { cliff: true }];
const towerHouse = (x, z, w, d, h) => [x, z, w, d, h, 'building', { towerhouse: true }];
const boulder = (x, z, w = 1.8, d = 1.5) => [x, z, w, d, 1.1, 'boulder', { redrock: true }];
const crate = (x, z, s = 1.4) => [x, z, s, s, 1.1, 'crate', {}];
const cart = (x, z, along = true) => [x, z, along ? 3 : 1.6, along ? 1.6 : 3, 1.2, 'barrier', { cart: true }];
const trough = (x, z, w, d) => [x, z, w, d, 0.9, 'barrier', { trough: true }];
const screen = (x, z, w, d) => [x, z, w, d, 2.4, 'wall', { mudscreen: true }];

function build() {
  const W = 56, H = 36;
  const walls = [];
  rotated(walls, W, H, [
    // ---- The cliffs: the north face's west half and the south face's west half (the images make the east halves),
    // with outcrops breaking up the ledge paths at their feet.
    cliff(0, 0, 28, 2.4), cliff(0, 33.6, 28, 2.4),
    cliff(13.6, 2.4, 5, 1.4, 5), cliff(30, 32.2, 4, 1.4, 5),

    // ---- The north row of tower houses (z 7.5-14) and the south row (z 22-28.5), west of the plaza, split by the
    // alleys at x 14-17.
    towerHouse(6, 7.5, 8, 6.5, 5.2), towerHouse(17, 8, 6.4, 6, 5.8),
    towerHouse(5, 22, 9, 6.5, 4.8), towerHouse(17, 22.4, 6, 6, 5.4),

    // ---- The main street (z 14-22): a cart, a water trough by the plaza, crates by the doors.
    cart(9, 19.2), trough(21.2, 16.6, 0.9, 2.8), crate(15, 15.2),

    // ---- The ledge paths: boulders off the cliffs, a crate stack.
    boulder(24.6, 3.4), boulder(7, 30.6, 2, 1.4), crate(21, 30.4),

    // ---- Spawn screens.
    screen(4.6, 15.4, 0.8, 2.8), screen(3.2, 9, 0.8, 3),
  ]);
  // The arch over the main street at the plaza: two piers, each the other's image.
  walls.push(wall(27.4, 14, 1.2, 1.2, 4.4, 'wall', { arch: true, landmark: true }));
  walls.push(wall(27.4, 20.8, 1.2, 1.2, 4.4, 'wall', { arch: true, landmark: true }));
  perimeter(walls, W, H, 6);

  const spawns = edgeSpawns(W, H, 2.4, [4.2, 6.6, 13.4, 18, 22.6, 29.8, 32]);
  const lanes = [{ id: 'north', z: 5 }, { id: 'mid', z: 18 }, { id: 'south', z: 31 }];
  const nav = navGrid(walls, [2.4, 10, 15.5, 21, 25, 31, 35, 40.5, 46, 53.6], lanes.map(l => l.z));
  // Domination: A on the north ledge by the alley, B under the arch, C its image.
  const points = symmetricPoints(W, H, { x: 20, z: 5, r: 3 }, { x: 28, z: 18, r: 3.4 },
    [{ x: 28, z: 10.4, r: 3 }, { x: 10.5, z: 17, r: 3 }]);
  points.hard.push({ id: 'h5', x: 28, z: 18, r: 3.2 });
  // Search and Destroy (see bombSites): A on the north ledge past the plaza, B at the far end of the south ledge.
  points.snd = bombSites({ x: 37, z: 4.8 }, { x: 46, z: 31 }, 2.6);
  // Capture the Flag (see flagBases): on the main street in front of the spawns.
  points.ctf = flagBases(W, H, { x: 7, z: 18 });

  const zones = [{ x: 0, z: 14.6, w: W, d: 6.8, kind: 'road' }, { x: 23.4, z: 14, w: 9.2, d: 8, kind: 'gulchsq' },
    { x: 0, z: 2.4, w: W, d: 5, kind: 'ledge' }, { x: 0, z: 28.6, w: W, d: 5, kind: 'ledge' }];

  return {
    id: 'redgulch', name: 'Red Gulch', theme: 'sirocco', size: 'small', region: 'desert',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
