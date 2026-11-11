// Ground War. A farming valley on an autumn morning, 120 x 72 m: about 2.5 times Railyard. Five east-west lanes run
// from each team's farmyard through barns, a chapel ruin, vineyard rows and open stubble fields to a co-op grain
// yard in the middle. Hedgerows and the big buildings break the long lines; the shells (barn, chapel, cottage, shed)
// are roofless interiors to fight through. Half is listed; the other half is its 180-degree image.
import { wall, rotated, perimeter, edgeSpawns, navGrid } from './build.js';

// Pieces by what they are. Each is a wall kind (see build.js) plus a flag for the renderer.
const hedge = (x, z, w, d) => [x, z, w, d, 2.3, 'wall', { hedge: true }];
const plank = (x, z, w, d) => [x, z, w, d, 3.2, 'wall', { plank: true }];       // Barn and shed walls.
const stone = (x, z, w, d) => [x, z, w, d, 3.0, 'wall', { stone: true }];       // Ruin walls.
const dyke = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { stone: true }];     // Dry-stone field wall, waist high.
const vines = (x, z, w, d) => [x, z, w, d, 1.15, 'barrier', { vine: true }];
const bale = (x, z) => [x, z, 1.6, 1.6, 1.25, 'crate', { bale: true }];
const stack = (x, z, w = 2.4, d = 2.4) => [x, z, w, d, 2.7, 'container', { hay: true }];
const tractor = (x, z, w = 3.4, d = 1.9) => [x, z, w, d, 2.3, 'container', { tractor: true }];
const trailer = (x, z, w, d) => [x, z, w, d, 2.4, 'container', { trailer: true }];
const house = (x, z, w, d, h = 4.4) => [x, z, w, d, h, 'building', { house: true }];
const silo = (x, z, s = 3.4) => [x, z, s, s, 7.5, 'building', { silo: true }];

function build() {
  const W = 120, H = 72;
  const walls = [];
  rotated(walls, W, H, [
    // ---- North lane (z 0..15): barn shell, stubble field, chapel ruin (flag B).
    plank(16, 3, 5.8, 0.6), plank(24.2, 3, 5.8, 0.6),
    plank(16, 12.4, 4, 0.6), plank(22.4, 12.4, 7.6, 0.6),
    plank(16, 3.6, 0.6, 2.8), plank(16, 8.8, 0.6, 3.6),
    plank(29.4, 3.6, 0.6, 2.4), plank(29.4, 8.4, 0.6, 4),
    stack(18.2, 4.8, 2.2, 2.2), bale(25.6, 9.2), [21.5, 7.6, 2.6, 0.6, 1.0, 'barrier', { stall: true }],
    bale(33, 4), stack(34.4, 9.6, 2.2, 2.2), dyke(31.5, 14, 5, 0.7),
    stone(38, 9, 3.6, 0.7), stone(44, 9, 6, 0.7),
    stone(38, 18.3, 5, 0.7), stone(45.4, 18.3, 4.6, 0.7),
    stone(38, 9.7, 0.7, 2.5), stone(38, 14.6, 0.7, 3.7),
    stone(49.3, 9.7, 0.7, 1.8), stone(49.3, 13.9, 0.7, 4.4),
    [43.2, 11.4, 1.8, 1.1, 1.0, 'barrier', { altar: true }],
    dyke(40.2, 15.4, 2.6, 0.6), dyke(45.6, 15.4, 2.6, 0.6),
    bale(44, 3), stack(49.5, 2.2), hedge(53, 0, 1.2, 6.5), trailer(55, 10, 4.6, 2.2),
    house(57, 16, 6, 4, 3.6),                     // Weigh house at the grain yard's north gate.

    // ---- North-middle lane (z 15..29): farmhouse, vineyard, grain elevator.
    house(9, 17, 7, 6),
    vines(21, 17.6, 6.5, 0.5), vines(29.5, 17.6, 6.5, 0.5),
    vines(21, 20.6, 6.5, 0.5), vines(29.5, 20.6, 6.5, 0.5),
    vines(21, 23.6, 6.5, 0.5), vines(29.5, 23.6, 6.5, 0.5),
    vines(21, 26.6, 6.5, 0.5), vines(29.5, 26.6, 6.5, 0.5),
    dyke(38.5, 22, 0.7, 6), stack(43.5, 23, 2.4, 2.4), hedge(30.5, 28.6, 7, 1.2),
    [49, 24, 6, 8, 9, 'building', { elevator: true }], stack(56.6, 23.5, 2.2, 2.2),

    // ---- Middle lane (z 29..43): the home farmyard (flag A) and the field to the grain yard.
    silo(14.5, 29.6), silo(14.5, 39),
    tractor(20.5, 30.4), dyke(27.6, 33, 0.7, 3), stack(29, 39.2), bale(21.6, 40.6),
    [35.5, 30.8, 6.5, 4.5, 0, 'water', { pond: true }],
    stack(43, 33.2), house(39.5, 37.6, 3.2, 2.8, 3.2),       // Hay and the pump house beside the pond.
    dyke(46.6, 33.5, 0.7, 5), hedge(46.5, 40, 6.5, 1.2),
    stack(51, 36.4, 2.2, 2.2), bale(53.5, 33.4),

    // ---- South-middle lane (z 43..57): hedgerows, a cottage, the ruined cottage.
    hedge(7.5, 25, 1, 5.5), hedge(7.5, 37.5, 1, 5.5),           // Spawn screens.
    stack(39, 43.6, 2.4, 2.2),
    hedge(18, 45, 8, 1.2), hedge(30.5, 45, 6.5, 1.2), hedge(36.5, 46.2, 1.2, 5.5),
    house(25, 49, 6, 5, 4),
    dyke(32, 53.5, 7, 0.7), bale(40.5, 49),
    stone(44, 46, 3, 0.6), stone(49.4, 46, 2.6, 0.6),
    stone(44, 53.4, 2.4, 0.6), stone(48.8, 53.4, 3.2, 0.6),
    stone(44, 46.6, 0.6, 2.4), stone(44, 51.4, 0.6, 2),
    stone(51.4, 46.6, 0.6, 1.5), stone(51.4, 50.6, 0.6, 2.8),
    bale(46.6, 49.4),

    // ---- South lane (z 57..72): open-fronted machine shed, hay stacks, a trailer.
    plank(12, 69.4, 14, 0.6), plank(12, 61, 0.6, 8.4), plank(25.4, 64.6, 0.6, 4.8),
    [12.6, 61, 3.2, 0.6, 3.2, 'wall', { plank: true }],
    tractor(16, 64.4), bale(21.4, 66.2),
    stack(31.5, 59.5), stack(37.5, 65.5),
    trailer(41.5, 59.4, 4.6, 2.2), dyke(46.5, 63, 0.7, 6), hedge(52, 57.5, 1.2, 7),
    bale(56, 66),
  ]);
  // The well in the middle of the grain yard (flag C) is its own image.
  walls.push(wall(59, 35, 2, 2, 1.1, 'crate', { well: true }));
  perimeter(walls, W, H, 3.2);

  const spawns = edgeSpawns(W, H, 3.5, [3, 7, 11, 15, 19.5, 25.5, 29.5, 33.5, 38.5, 43, 47, 51, 55, 59, 64, 69]);
  const lanes = [{ id: 'north', z: 8 }, { id: 'northmid', z: 22 }, { id: 'mid', z: 36 }, { id: 'southmid', z: 50 }, { id: 'south', z: 64 }];
  const nav = navGrid(walls, [4, 14, 24, 34, 46, 60, 74, 86, 96, 106, 116], lanes.map(l => l.z));

  // Five flags: each team has two near home (A and B for the west), C is the centre, the only point a 180-degree
  // map can hold fairly. Ids run west to east.
  const image = p => ({ x: W - p.x, z: H - p.z, r: p.r });
  const A = { x: 24, z: 36, r: 4.5 }, B = { x: 44, z: 14, r: 4.5 }, C = { x: 60, z: 36, r: 5 };
  const points = {
    dom: [{ id: 'A', ...A }, { id: 'B', ...B }, { id: 'C', ...C }, { id: 'D', ...image(B) }, { id: 'E', ...image(A) }],
    hard: [],
  };

  // Interior floors, for the renderer: boards in the barns and shed, flags in the ruins.
  const rooms = [];
  for (const r of [[16, 3, 14, 10, 'boards'], [38, 9, 12, 10, 'flags'], [44, 46, 8, 8, 'flags'], [12, 61, 14, 9, 'boards']]) {
    rooms.push({ x: r[0], z: r[1], w: r[2], d: r[3], floor: r[4] });
    rooms.push({ x: W - r[0] - r[2], z: H - r[1] - r[3], w: r[2], d: r[3], floor: r[4] });
  }

  return {
    id: 'harvest', name: 'Harvest', theme: 'harvest', size: 'huge', region: 'farmland', width: W, height: H, walls, spawns, lanes, nav, points, rooms,
    modes: ['gwtdm', 'gwdom'], large: true,
  };
}

export default build();
