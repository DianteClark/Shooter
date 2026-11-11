// Metro, small. An underground station, 56 x 34 m. A train stands at the platform down the middle: its two outer
// cars are open at the ends and can be run through, the middle car is shut at both ends and entered by its side doors.
// Tiled walls with three stair gaps split each platform from its ticket hall, and turnstile banks choke the halls.
// Everything is close: the longest clean lines are the platforms, broken by columns and escalator housings.
import { bombSites, flagBases, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

// Pieces by what they are. Each is a wall kind (see build.js) plus a flag for the renderer.
const tile = (x, z, w, d) => [x, z, w, d, 3.4, 'wall', { tile: true }];
const column = (x, z) => [x, z, 0.8, 0.8, 3.4, 'wall', { column: true }];
const stairs = (x, z, w, d) => [x, z, w, d, 2.6, 'wall', { stairs: true }];
const car = (x, z, w, d) => [x, z, w, d, 3.0, 'container', { car: true }];
const gate = (x, z, d) => [x, z, 0.8, d, 1.0, 'barrier', { turnstile: true }];
const bench = (x, z, w = 2.4, d = 0.6) => [x, z, w, d, 0.9, 'barrier', { bench: true }];
const vending = (x, z, w = 1.4, d = 0.9) => [x, z, w, d, 2.1, 'shop', { vending: true }];

function build() {
  const W = 56, H = 34;
  const walls = [];
  rotated(walls, W, H, [
    // Tiled wall between the north ticket hall and the north platform: stair gaps at x 11-14, 26.5-29.5 and 42-45.
    tile(6, 7, 5, 1), tile(14, 7, 12.5, 1), tile(29.5, 7, 12.5, 1), tile(45, 7, 5, 1),

    // Ticket hall: the ticket office in the middle, a turnstile bank either side of it.
    [25, 2.4, 6, 2.6, 2.8, 'shop', { ticket: true }],
    gate(19.6, 0, 1.7), gate(19.6, 3.3, 1.5), gate(19.6, 6.2, 0.8),
    gate(35.6, 0, 1.7), gate(35.6, 3.3, 1.5), gate(35.6, 6.2, 0.8),
    bench(9, 0), vending(46.5, 0),

    // North platform: columns down the middle, an escalator housing against the wall, benches and machines.
    column(9.5, 13.2), column(20, 11.4), column(40.5, 11.4), column(48, 13.2),
    stairs(31, 8, 6, 2.6),
    [25.5, 11.6, 3, 1.6, 2.4, 'shop', { kiosk: true }],
    vending(16, 8), bench(20.5, 8), bench(40.6, 8, 1.8),

    // Train: outer car (x 9.5-20.5), side panels with two 1.8 m doors a side; the far car is its image.
    car(9.5, 15.5, 2.1, 0.3), car(13.4, 15.5, 3.2, 0.3), car(18.4, 15.5, 2.1, 0.3),
    car(9.5, 18.2, 2.1, 0.3), car(13.4, 18.2, 3.2, 0.3), car(18.4, 18.2, 2.1, 0.3),
    // Middle car (x 22.5-33.5): listing its north panels gives the south ones; its west end wall gives the east one.
    car(22.5, 15.5, 2.1, 0.3), car(26.4, 15.5, 3.2, 0.3), car(31.4, 15.5, 2.1, 0.3),
    car(22.5, 15.8, 0.3, 2.4),

    // Buffer stop at the end of the track, and a screen in front of the spawns.
    [5.6, 15.8, 0.8, 2.4, 1.1, 'barrier', { buffer: true }],
    [5.4, 9.6, 0.8, 3.2, 2.4, 'wall', { tile: true }],
  ]);
  perimeter(walls, W, H, 4.2);

  const spawns = edgeSpawns(W, H, 3, [2.5, 6, 9, 13.5, 20.5, 25, 28, 31.5]);
  const lanes = [{ id: 'north', z: 3.5 }, { id: 'nplat', z: 12.5 }, { id: 'mid', z: 17 }, { id: 'splat', z: 21.5 }, { id: 'south', z: 30.5 }];
  const nav = navGrid(walls, [3, 15, 28, 41, 53], lanes.map(l => l.z));
  // Domination: A in the west ticket hall by the turnstiles, B the middle car, C the east hall (the image of A).
  const points = symmetricPoints(W, H,
    { x: 14.5, z: 3.5, r: 3.2 },
    { x: 28, z: 17, r: 3.4 },
    [{ x: 21, z: 12.5, r: 3 }, { x: 28, z: 6, r: 3.2 }]);
  points.hard.push({ id: 'h5', x: 28, z: 17, r: 3.2 });

  // Search and Destroy (see bombSites). A on the north platform under the east stairs, B in the south ticket hall.
  points.snd = bombSites({ x: 43.5, z: 12.5 }, { x: 43, z: 30.5 }, 2.8);
  // Capture the Flag (see flagBases). On the track bed between the buffer stop and the first car: reached from
  // either platform or out of the train.
  points.ctf = flagBases(W, H, { x: 7.8, z: 17 });

  // Floors and the train for the renderer.
  const zones = [
    { x: 0, z: 0, w: W, d: 7, kind: 'hall' }, { x: 0, z: 27, w: W, d: 7, kind: 'hall' },
    { x: 0, z: 8, w: W, d: 7.5, kind: 'platform' }, { x: 0, z: 18.5, w: W, d: 7.5, kind: 'platform' },
    { x: 0, z: 15.5, w: W, d: 3, kind: 'track' },
  ];
  const trains = [{ x: 9.5, z: 15.5, w: 11, d: 3 }, { x: 22.5, z: 15.5, w: 11, d: 3, closed: true }, { x: 35.5, z: 15.5, w: 11, d: 3 }];

  return {
    id: 'turnstile', name: 'Turnstile', theme: 'subway', size: 'small', region: 'metro',
    width: W, height: H, walls, spawns, lanes, nav, points, zones, trains, underground: true,
  };
}

export default build();
