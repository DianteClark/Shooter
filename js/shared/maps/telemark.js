// The North, large: Telemark, 108 x 64, a district of Kaldvik (docs/DISTRICTS.md "The North") and a 6v6 map of its
// own. A ski village at the foot of the slopes: timber chalets with snow-loaded roofs, the old lodge, the rental
// sheds, and in the middle the chairlift's base station with its line of pylons running north and south over the
// village green. The village street through the middle is Kaldvik's Fjord Road (it runs on east and west through the
// region); the upper and lower roads are the long lanes, the alleys between the chalets and the car parks carry the
// rotations. In Kaldvik its chalets open up as buildings to loot.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const chalet = (x, z, w, d, h = 4.2, extra = {}) => [x, z, w, d, h, 'building', { chalet: true, ...extra }];
const car = (x, z, along = true) => [x, z, along ? 4.2 : 1.9, along ? 1.9 : 4.2, 1.4, 'barrier', { car: true }];
const sled = (x, z, along = true) => [x, z, along ? 2.4 : 1.2, along ? 1.2 : 2.4, 1.1, 'barrier', { sled: true }];
const rack = (x, z, w, d) => [x, z, w, d, 1.2, 'barrier', { skirack: true }];
const fence = (x, z, w, d) => [x, z, w, d, 1.1, 'barrier', { snowfence: true }];
const fir = (x, z) => [x, z, 1, 1, 5.5, 'wall', { tree: true, fir: true }];
const bench = (x, z, w = 2.2, d = 0.6) => [x, z, w, d, 0.9, 'barrier', { bench: true }];
const jersey = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { jersey: true }];

function build() {
  const W = 108, H = 64;
  const walls = [];
  rotated(walls, W, H, [
    // ---- North edge chalets, the upper road (z 3.8-12): a snowmobile, a ski rack.
    chalet(10, 0, 13, 3.8, 3.8), chalet(28, 0, 12, 3.8, 3.6),
    sled(14, 6.2), rack(32, 8.8, 3.2, 0.6),

    // ---- North blocks (z 13-25): the old lodge, then the rental sheds split by a service alley.
    chalet(9, 13, 12, 11, 5.4, { lodge: true }),
    chalet(25, 13, 12, 5, 3.8), chalet(25, 20.5, 12, 4.5, 3.6),

    // ---- The village green's west half (x 41-52): firs, a ski rack, a bench, the lift's pylon.
    fir(41.5, 14), fir(45, 22.5), fir(42.5, 46.5),
    rack(44, 17.5, 0.6, 3.2), bench(46.5, 26.8), [53.6, 16.5, 0.8, 0.8, 7, 'wall', { pylon: true }],
    [46.5, 42.5, 1.4, 1.4, 1.7, 'barrier', { snowman: true }],

    // ---- The village street, Kaldvik's Fjord Road (z 26-38): a piste groomer, snowmobiles, a snow fence.
    [17, 30.7, 5.6, 2.6, 2.6, 'container', { groomer: true }],
    sled(10, 27.8), sled(32, 34.8), fence(28, 27.6, 3.4, 0.5),

    // ---- South-west: a chalet block, then the car park with the lift ticket hut.
    chalet(9, 40, 10, 12, 4.8),
    car(23.5, 41, false), car(27.5, 41, false), car(35, 41, false), car(23.5, 47.2, false), car(31, 47.6, false),
    [36.5, 47.6, 2, 2, 2.4, 'shop', { booth: true, tickets: true }],

    // ---- Spawn cover.
    jersey(6.5, 17, 0.7, 4), jersey(6.5, 43, 0.7, 4),
  ]);
  // The chairlift's base station in the middle of the green: its own image.
  walls.push(wall(52, 30, 4, 4, 4.2, 'building', { liftstation: true, landmark: true }));
  perimeter(walls, W, H, 4);

  const spawns = edgeSpawns(W, H, 3.5, [5, 9, 21, 25, 29.5, 34.5, 39, 50, 55, 59]);
  const lanes = [{ id: 'north', z: 7.5 }, { id: 'nmid', z: 19 }, { id: 'mid', z: 32 }, { id: 'smid', z: 45 }, { id: 'south', z: 56.5 }];
  const nav = navGrid(walls, [4, 16, 22, 30, 39, 46, 54, 62, 69, 78, 86, 92, 104], lanes.map(l => l.z));
  // Domination: A the west car park, B round the lift station, C the east car park.
  const points = symmetricPoints(W, H, { x: 30, z: 45, r: 4.6 }, { x: 54, z: 32, r: 5.6 },
    [{ x: 47, z: 19.5, r: 4.2 }, { x: 22, z: 7.5, r: 4.2 }]);
  points.hard.push({ id: 'h5', x: 54, z: 32, r: 5.4 });
  // Search and Destroy (see bombSites): A in the north-east car park, B on the lower road by the east block.
  points.snd = bombSites({ x: 76, z: 18 }, { x: 74, z: 56.5 }, 3.4);
  // Capture the Flag (see flagBases): on the village street in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 32 });

  const zones = [];
  for (const [x, z, w, d] of [[0, 4.5, W, 6.5], [0, 26.5, W, 11], [0, 53, W, 6.5], [21, 12, 4, 14], [83, 38, 4, 14]]) zones.push({ x, z, w, d, kind: 'road' });
  zones.push({ x: 22, z: 39, w: 18, d: 13, kind: 'lot' }, { x: 68, z: 12, w: 18, d: 13, kind: 'lot' });
  zones.push({ x: 41, z: 12, w: 26, d: 40, kind: 'piste' });

  return {
    id: 'telemark', name: 'Telemark', theme: 'north', size: 'large', region: 'arctic',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
