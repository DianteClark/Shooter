// Desert, large. A dry riverbed through a canyon, 108 x 64 m, under a hard late sun. An old dam stands across the
// riverbed at the centre: two spillway gates through it, and a way round each end over the rim. The riverbed is the
// long lane (about 47 m from the spawns to the dam); mesas split it from the rim trails, and a narrow ravine runs
// along each canyon wall for the flank.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const mesa = (x, z, w, d, h = 4.6) => [x, z, w, d, h, 'rock'];
const boulder = (x, z, w = 1.8, d = 1.6) => [x, z, w, d, 1.1, 'boulder'];
const dam = (x, z, w, d, h = 5) => [x, z, w, d, h, 'building', { dam: true }];
const hut = (x, z, w, d, h = 3.2) => [x, z, w, d, h, 'adobe', { hut: true }];

function build() {
  const W = 108, H = 64;
  const walls = [];
  rotated(walls, W, H, [
    // ---- North wall of the canyon: outcrops leave a ravine (z 0-7) along it.
    mesa(14, 0, 9, 3.2, 4.4), mesa(36, 0, 7, 4, 4.4), mesa(62, 0, 8, 3, 4.4),
    // ---- Mesas between the ravine and the rim trail.
    mesa(15, 8.5, 15, 8, 5.2), mesa(36.5, 7.5, 9, 6, 4.8),
    mesa(64, 8, 11, 7, 5), mesa(82, 9.5, 8, 5, 4.4),
    // ---- The rim trail (z 17-25): boulders, a pump house and a fallen water tank.
    boulder(25, 19.5), boulder(44, 22.6, 2.4, 1.4), hut(33, 18, 4, 3.4),
    [72, 18.6, 1.6, 4.4, 2.6, 'container', { tank: true }],
    // ---- The riverbed's north bank (z 25-29): low rock shelves and boulders.
    [20, 25.4, 7, 2, 1.6, 'rock'], boulder(35.5, 27.2), [42, 26.8, 4, 1.6, 1.2, 'boulder'],
    boulder(28, 34.4, 1.6, 1.6),
    // ---- The dam: two wing walls and the middle pier, with the spillways between them.
    dam(51, 8, 6, 15), [47.5, 16, 3.5, 1, 1.0, 'sandbag'],
    // ---- Spawn cover.
    [7, 18, 1.2, 5, 2.4, 'wall'], [8, 30.5, 2.4, 3, 1.1, 'boulder'],
  ]);
  walls.push(wall(51, 29.5, 6, 5, 5, 'building', { dam: true, landmark: true }));
  perimeter(walls, W, H, 6);

  const spawns = edgeSpawns(W, H, 3.5, [3.5, 8, 12, 17, 24, 28, 32, 36, 40, 47, 52, 56.5, 60.5]);
  const lanes = [{ id: 'north', z: 4 }, { id: 'rim', z: 21 }, { id: 'river', z: 32 }, { id: 'srim', z: 43 }, { id: 'south', z: 60 }];
  const nav = navGrid(walls, [4, 12, 24, 34, 46, 54, 62, 74, 84, 96, 104], lanes.map(l => l.z));
  // Domination: A on the west rim by the pump house, B at the dam's middle pier, C the east rim.
  const points = symmetricPoints(W, H,
    { x: 30, z: 22, r: 4.4 },
    { x: 54, z: 32, r: 5.4 },
    [{ x: 48, z: 4, r: 4.4 }, { x: 36, z: 31.5, r: 4.4 }]);
  points.hard.push({ id: 'h5', x: 54, z: 32, r: 5 });

  // Search and Destroy (see bombSites). A on the north-east rim by the fallen tank, B in the riverbed at the east mouth
  // of the north spillway, under the dam.
  points.snd = bombSites({ x: 76, z: 21 }, { x: 60.5, z: 26 }, 3.4);
  // Capture the Flag (see flagBases). On the riverbed in front of the spawns, behind the boulder.
  points.ctf = flagBases(W, H, { x: 12, z: 32 });

  // The riverbed for the renderer: a meander of sand and pebbles between the banks.
  const zones = [{ x: 0, z: 26.5, w: W, d: 11, kind: 'riverbed' }];

  return {
    id: 'canyon', name: 'Canyon', theme: 'desert', size: 'large', region: 'desert',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
