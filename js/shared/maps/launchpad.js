// Desert, large. Launchpad: a rocket on its pad in the middle of a white salt flat at high noon, 104 x 64 m. The rocket
// and its service tower stand dead centre on a raised concrete apron (the landmark: everybody has to go round it).
// North-west the propellant farm (two spherical tanks, a pipe rack, a horizontal tank, a pump shed), south-west the
// tracking station (radar dish, uplink hut, a generator), each team's launch-control blockhouse at its end; the east
// half is the 180-degree image, so each side has a tank farm on one flank and a tracking station on the other.
// Five lanes: the tank-farm road and the tracking road on the edges (the long lanes, 50 m and more), the crawlerway
// either side of the middle, and the pad road through it. Pipe racks, berms and jersey barriers are waist high.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

// Pieces by what they are: a wall kind (see build.js) plus a flag for the renderer (js/render/themes/launchpad.js).
const sphere = (x, z, s) => [x, z, s, s, s, 'building', { sphere: true }];        // Spherical propellant tank on legs.
const tank = (x, z, w, d) => [x, z, w, d, 2.8, 'container', { tank: true }];      // Horizontal tank on saddles.
const pipe = (x, z, w, d) => [x, z, w, d, 1.1, 'barrier', { pipe: true }];        // Pipe rack: shoot over it.
const jersey = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { jersey: true }];
const berm = (x, z, w, d) => [x, z, w, d, 1.0, 'sandbag', { berm: true }];        // Salt-crust berm.
const crate = (x, z, s = 1.7) => [x, z, s, s, 1.1, 'crate'];
const drum = (x, z) => [x, z, 1.6, 1.6, 1.1, 'crate', { drum: true }];             // Cable drum on its side.
const blast = (x, z, w, d) => [x, z, w, d, 2.4, 'wall', { blast: true }];          // Blast wall: solid.
const mast = (x, z) => [x, z, 1, 1, 10, 'crane', { mast: true }];                  // Lightning mast.

function build() {
  const W = 104, H = 64;
  const walls = [];
  rotated(walls, W, H, [
    // ---- West end: launch control. The blockhouse in the middle of the spawn yard, blast walls screening the lanes.
    [7, 24.5, 4.4, 7, 3, 'building', { blockhouse: true }],
    blast(8.5, 5, 1.2, 6), blast(8.5, 45, 1.2, 6),
    jersey(12, 15, 0.8, 3.2), jersey(12, 37, 3.2, 0.8),

    // ---- North-west: the propellant farm along the tank-farm road (z 0..12).
    sphere(16, 0, 5), sphere(30, 0, 4.4), pipe(21, 2.2, 6.4, 0.8),
    tank(38, 6.5, 7, 2.6), crate(25, 8.6), [45, 0, 4.4, 3.4, 3.2, 'building', { shed: true }],

    // ---- The crawlerway (z 13..26): the crawler transporter parked on it, jersey barriers and crates either side.
    [26, 15, 9, 5.6, 3.4, 'container', { crawler: true }],
    jersey(16, 13.5, 3.2, 0.8), jersey(40, 21.4, 0.8, 3.2),
    crate(19.6, 21.8), crate(37.2, 13.2, 1.5),
    mast(44.6, 14.6),

    // ---- The pad road (z 26..38): a propellant trailer, a berm and a crate on the way in to the apron.
    [19, 29.4, 7, 2.6, 2.8, 'container', { trailer: true }],
    berm(32, 34, 3.4, 1), crate(37.6, 28, 1.5),
    jersey(43.4, 37.6, 3.2, 0.8),

    // ---- South-west: the tracking station on the tracking road (z 50..64), and a berm and drums on the southern crawlerway.
    [17, 52, 4.6, 4.6, 3.4, 'building', { dish: true }],
    [28, 57.5, 5, 4, 3, 'building', { hut: true }],
    [36, 51.6, 6, 2.4, 2.6, 'container', { genset: true }],
    drum(24.4, 46.4), drum(43, 58.6),
    berm(30, 42.6, 4, 1), [13.4, 40.6, 4, 2.4, 2.6, 'container', { trailer: true }],
    mast(47.4, 46.4),
  ]);
  // The rocket on its pad: the apron, the launch mount and the service tower, centred so it is its own image.
  walls.push(wall(47, 28, 10, 8, 7, 'building', { landmark: true, rocket: true }));
  perimeter(walls, W, H, 4);

  const spawns = edgeSpawns(W, H, 3.5, [3, 8, 14, 19.5, 26, 31, 38, 44, 50, 56, 61]);
  const lanes = [{ id: 'north', z: 5.5 }, { id: 'northmid', z: 19 }, { id: 'mid', z: 32 }, { id: 'southmid', z: 45 }, { id: 'south', z: 58.5 }];
  const nav = navGrid(walls, [4, 14, 24, 36, 44, 52, 60, 68, 80, 90, 100], [3, 5.5, 12, 19, 25, 32, 39, 45, 52, 58.5, 61]);
  // Domination: A on the west crawlerway in front of the crawler, B round the pad, C the east crawlerway.
  // Hardpoint: the tank-farm road by the horizontal tank, the southern crawlerway, then their images.
  const points = symmetricPoints(W, H,
    { x: 22, z: 24.5, r: 4.4 },
    { x: 52, z: 32, r: 7.5 },
    [{ x: 40, z: 11, r: 4.2 }, { x: 34, z: 47, r: 4.2 }]);

  // Search and Destroy (see bombSites). A by the east tracking station's radar dish (north-east), B in the east tank
  // farm by the horizontal tank (south-east): the pad splits them.
  points.snd = bombSites({ x: 77, z: 9.5, r: 3.4 }, { x: 70, z: 53, r: 3.4 });
  // Capture the Flag (see flagBases). On the pad road in front of the blockhouse.
  points.ctf = flagBases(W, H, { x: 15, z: 33 });

  // Render-only: the crawlerway's two gravel tracks (z centres) and the pad road.
  const decor = [{ type: 'crawlerway', z: [17, 21, H - 21, H - 17] }];

  return {
    id: 'launchpad', name: 'Launchpad', theme: 'launchpad', size: 'large', region: 'desert',
    width: W, height: H, walls, spawns, lanes, nav, points, decor,
  };
}

export default build();
