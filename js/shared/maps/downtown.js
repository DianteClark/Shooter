// Ground War, metro. A downtown grid at night, 136 x 80 m: about 2.8 times Railyard. Five east-west streets run
// between rows of towers from each team's end to a park in the middle (flag C, round the fountain). Each side has a
// fenced construction site (B for the west) on its north-side blocks and a subway entrance plaza (A) on its south
// side. Buses and kiosks break the long street lines; alleys cut through the blocks. Half is listed; the other half
// is its 180-degree image.
import { wall, rotated, perimeter, edgeSpawns, navGrid } from './build.js';

const tower = (x, z, w, d, h = 4.4) => [x, z, w, d, h, 'building', { tower: true }];
const store = (x, z, w, d, h = 3.6) => [x, z, w, d, h, 'building', { store: true }];
const hoard = (x, z, w, d) => [x, z, w, d, 2.6, 'wall', { hoarding: true }];
const frame = (x, z) => [x, z, 0.9, 0.9, 5, 'wall', { frame: true }];          // Bare concrete column of the new build.
const stack = (x, z, w, d) => [x, z, w, d, 2.2, 'container', { materials: true }];
const pallet = (x, z, w = 1.6, d = 1.6) => [x, z, w, d, 1.1, 'crate', { pallet: true }];
const bus = (x, z, w = 9.5, d = 2.6) => [x, z, w, d, 3.2, 'container', { bus: true }];
const car = (x, z, along = true) => [x, z, along ? 4.2 : 1.9, along ? 1.9 : 4.2, 1.4, 'barrier', { car: true }];
const tree = (x, z) => [x, z, 1, 1, 4.5, 'wall', { tree: true }];
const hedge = (x, z, w, d) => [x, z, w, d, 1.1, 'barrier', { hedge: true }];
const planter = (x, z, w, d) => [x, z, w, d, 0.9, 'barrier', { planter: true }];
const shelter = (x, z) => [x, z, 3.6, 1.3, 2.4, 'barrier', { shelter: true }];
const kiosk = (x, z, w = 2, d = 1.6) => [x, z, w, d, 2.4, 'shop', { newsstand: true }];

function build() {
  const W = 136, H = 80;
  const walls = [];
  rotated(walls, W, H, [
    // ---- North edge shopfronts (z 0-4) and the north street (z 4-12).
    store(12, 0, 14, 4), store(32, 0, 16, 4), store(54, 0, 9, 4),
    car(15, 5.6), bus(44, 7.6), car(57, 8.6), shelter(21, 4),

    // ---- Row 1 (z 12-20): a tower pair split by an alley, then the construction site, then a tower.
    tower(12, 12, 6.4, 8), tower(21, 12, 5, 8, 4.2),
    tower(54, 12, 9, 8, 5.2),

    // ---- Construction site (x 32-48, z 12-36): hoarding with gates, a tower crane, the frame of the new build.
    hoard(32, 12, 6, 0.8), hoard(42, 12, 6, 0.8),
    hoard(32, 12.8, 0.8, 8.2), hoard(32, 27, 0.8, 8.2),
    hoard(47.2, 12.8, 0.8, 5.2), hoard(47.2, 22, 0.8, 7), hoard(47.2, 33, 0.8, 2.2),
    hoard(32, 35.2, 5, 0.8), hoard(41, 35.2, 7, 0.8),
    [39, 15.5, 2, 2, 6, 'crane', { towerCrane: true }],
    frame(35, 26.5), frame(39.5, 26.5), frame(44, 26.5), frame(35, 31), frame(44, 31),
    stack(35, 16.5, 2.4, 3.4), stack(42.5, 20.5, 3.2, 2.2), [36, 21.4, 2.6, 1.2, 1.0, 'barrier', { jersey: true }],
    pallet(40.5, 31.2), pallet(43.6, 14.6), [36.9, 32.4, 2.8, 1.2, 1.1, 'crate', { pallet: true }],

    // ---- Street z 20-28.
    car(14, 21.6), kiosk(51, 21.2), car(56.5, 25.2),

    // ---- Row 2 (z 28-36): a block with a passage through it.
    tower(12, 28, 14, 3.4, 4.6), tower(12, 33.8, 14, 2.2, 3.4),

    // ---- Street z 36-44 west of the park.
    car(16, 37.6), bus(24, 39.6, 9, 2.6), planter(50.5, 38, 1.2, 3),

    // ---- Row 3 (z 44-52): a tower pair split by an alley, then the subway plaza (flag A).
    tower(12, 44, 7, 8, 4.6), tower(21.6, 44, 4.4, 8, 4.2),
    [37.5, 46, 5, 4, 3, 'shop', { metro: true }],
    planter(33, 45, 3, 1.2), planter(44, 50, 3, 1.2), shelter(33.4, 52.4), kiosk(45.4, 45),

    // ---- Street z 52-60, and row 4 (z 60-68): towers with an alley.
    car(26, 57.4), car(50, 54),
    tower(12, 60, 14, 8, 5.2), tower(32, 60, 7, 8), tower(41.6, 60, 6.4, 8, 4.6), tower(54, 60, 9, 8, 4.8),
    // ---- Street z 68-76.
    car(20, 72), bus(40, 69.6), car(58, 73.4),

    // ---- The park's west half (x 54-68, z 28-52): trees, low hedges, benches round the fountain.
    tree(56, 30), tree(60.5, 33), tree(56.5, 46.5), tree(61, 49.5), tree(66, 30.5),
    hedge(55, 37.5, 0.8, 5), hedge(59.5, 42.6, 4, 0.8), hedge(63, 32, 0.8, 3.4),
    [57.6, 39, 0.6, 2.2, 0.9, 'barrier', { bench: true }],

    // ---- Spawn cover.
    [7, 22, 0.8, 4, 1.0, 'barrier', { jersey: true }], [7, 54, 0.8, 4, 1.0, 'barrier', { jersey: true }],
  ]);
  // The fountain at the park's centre (flag C) is its own image.
  walls.push(wall(65.5, 38, 5, 4, 0, 'water', { fountain: true }));
  perimeter(walls, W, H, 3.2);

  const spawns = edgeSpawns(W, H, 3.5, [3, 7.5, 12, 16, 20.5, 25, 29.5, 34, 38.5, 43, 47.5, 52, 56.5, 61, 66, 72]);
  const lanes = [{ id: 'north', z: 8 }, { id: 'northmid', z: 24 }, { id: 'mid', z: 40 }, { id: 'southmid', z: 56 }, { id: 'south', z: 72 }];
  const nav = navGrid(walls, [4, 14, 24, 34, 46, 60, 76, 90, 102, 112, 122, 132], lanes.map(l => l.z));

  // Five flags (see harvest.js): A the subway plaza, B the construction site, C the fountain, D and E their images.
  const image = p => ({ x: W - p.x, z: H - p.z, r: p.r });
  const A = { x: 40, z: 48, r: 4.8 }, B = { x: 40, z: 24, r: 4.8 }, C = { x: 68, z: 40, r: 5.5 };
  const points = {
    dom: [{ id: 'A', ...A }, { id: 'B', ...B }, { id: 'C', ...C }, { id: 'D', ...image(B) }, { id: 'E', ...image(A) }],
    hard: [],
  };

  const zones = [];
  for (const z of [4, 20, 36, 52, 68]) zones.push({ x: 0, z: z + 1, w: W, d: 6, kind: 'road' });
  for (const x of [26, 48, 63, 82, 104]) zones.push({ x: x + 0.8, z: 0, w: x === 63 ? 8.4 : 4.4, d: H, kind: 'road' });
  zones.push({ x: 54, z: 28, w: 28, d: 24, kind: 'park' });
  zones.push({ x: 32, z: 12, w: 16, d: 24, kind: 'site' }, { x: 88, z: 44, w: 16, d: 24, kind: 'site' });
  zones.push({ x: 32, z: 44, w: 16, d: 8, kind: 'plaza' }, { x: 88, z: 28, w: 16, d: 8, kind: 'plaza' });

  return {
    id: 'downtown', name: 'Downtown', theme: 'metro', size: 'huge', region: 'metro',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
    modes: ['gwtdm', 'gwdom'], large: true,
  };
}

export default build();
