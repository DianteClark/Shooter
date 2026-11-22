// Sirocco, large: Caravanserai, 100 x 64, a district of Sirocco Basin (docs/DISTRICTS.md) and a 6v6 map of its own.
// A walled caravan inn straddles the Spice Road: the road runs in at its west gate, across the courtyard past the domed
// well house in the middle and out at the east gate. Arcades line the courtyard's north and south walls; outside, the
// souk street runs along the north edge and the camel yards along the south, with gates into the courtyard from both.
// Dusk in a rising sandstorm (theme 'sirocco', js/render/themes/sirocco.js). In Sirocco Basin its merchant houses open up
// as buildings to loot.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const store = (x, z, w, d, h = 3.8) => [x, z, w, d, h, 'building', { souk: true }];
const house = (x, z, w, d, h = 4.2) => [x, z, w, d, h, 'building', { merchant: true }];
const sw = (x, z, w, d) => [x, z, w, d, 3.6, 'wall', { serai: true }];             // The serai's outer wall.
const tower = (x, z, w = 4, d = 4, h = 6.2) => [x, z, w, d, h, 'adobe', { ksar: true }];
const pillar = (x, z) => [x, z, 0.8, 0.8, 3.2, 'wall', { pillar: true, arch: 3.5 }];
const stall = (x, z, w = 3.2, d = 1.2) => [x, z, w, d, 1.0, 'stall', { canopy: true }];
const sacks = (x, z, w = 2.2, d = 1) => [x, z, w, d, 1.0, 'sandbag', { sacks: true }];
const wagon = (x, z, along = true) => [x, z, along ? 5 : 2.2, along ? 2.2 : 5, 2.4, 'container', { wagon: true }];
const fence = (x, z, w, d) => [x, z, w, d, 1.1, 'barrier', { rail: true }];
const camel = (x, z, along = true) => [x, z, along ? 2.2 : 0.9, along ? 0.9 : 2.2, 1.7, 'barrier', { camel: true }];
const trough = (x, z, w, d) => [x, z, w, d, 0.9, 'barrier', { trough: true }];
const tree = (x, z) => [x, z, 0.9, 0.9, 4.2, 'wall', { acacia: true }];

function build() {
  const W = 100, H = 64;
  const walls = [];
  rotated(walls, W, H, [
    // ---- The souk: shopfronts on the north edge (and the south edge's west half; the images fill in), awnings and
    // stalls along the souk street (z 4.6-11).
    store(10, 0, 12, 4.6), store(26, 0, 9, 4.6, 3.4), store(39, 0, 8, 4.6),
    store(12, 59.4, 11, 4.6), store(27, 59.4, 9, 4.6, 3.4), store(40, 59.4, 7, 4.6),
    stall(15, 7.6), stall(30.5, 8.4, 2.6), sacks(23.8, 6.2, 1.6, 1.6),
    [44, 4.6, 3, 2.8, 2.6, 'tent', { awning: true }], wagon(35.4, 8),

    // ---- The serai's outer wall (x 30-70, z 12-52), corner towers, the west road gate (z 27-37) and its towers; the
    // north gates at x 40-43.6 and 59.4-63, the south ones at 37-40.6 and 56.4-60.
    sw(30, 12, 10, 1.2), sw(43.6, 12, 6.4, 1.2),
    sw(30, 50.8, 7, 1.2), sw(40.6, 50.8, 9.4, 1.2),
    sw(30, 13.2, 1.2, 13.8), sw(30, 37, 1.2, 13.8),
    tower(28.6, 10.6), tower(28.6, 49.4),
    tower(28.4, 23.4, 3.6, 3.6, 5.4), tower(28.4, 37, 3.6, 3.6, 5.4),

    // ---- The arcades inside the north and south walls: pillars every 3.5 m, the walk behind them.
    pillar(33.6, 17), pillar(37.1, 17), pillar(40.6, 17), pillar(44.1, 17), pillar(47.6, 17),
    pillar(33.6, 46.2), pillar(37.1, 46.2), pillar(40.6, 46.2), pillar(44.1, 46.2), pillar(47.6, 46.2),
    sacks(35, 14.2, 1.8, 1), sacks(42.4, 48.8, 1.8, 1),

    // ---- The courtyard (x 31-69, z 18-46): a spice pavilion, stalls, sacks, a trough by the west gate.
    [39, 21.6, 4.4, 3.2, 2.6, 'tent', { pavilion: true }],
    stall(36, 40.2), stall(44.6, 39.2, 1.2, 3.2), sacks(44.6, 25.6),
    trough(34.4, 29.6, 0.9, 3.4),

    // ---- West of the serai: the caravan yard. A caravan office and a merchant house on the north side, the camel pen
    // and its water trough on the south, wagons drawn up along the road, two acacias.
    house(9, 13.4, 10, 7), house(21, 14.4, 6, 5.6, 3.8),
    wagon(13, 34.6), wagon(20.6, 27.2),
    fence(13, 42, 11, 0.3), fence(13, 42.3, 0.3, 6.4), fence(23.7, 42.3, 0.3, 2.4), fence(13, 53, 6, 0.3),
    camel(16, 45.2), camel(19.6, 49.2), trough(15.4, 55.6, 3.2, 0.9),
    tree(25.4, 47.8), tree(7.6, 25),

    // ---- Spawn cover.
    sacks(6.4, 8.4, 0.9, 2.6), sacks(6.4, 52.4, 0.9, 2.6),
  ]);
  // The domed well house in the middle of the courtyard, on the road: its own image.
  walls.push(wall(48.4, 30.4, 3.2, 3.2, 3.6, 'wall', { wellhouse: true, landmark: true }));
  perimeter(walls, W, H, 4);

  const spawns = edgeSpawns(W, H, 3.5, [4.5, 9, 22, 26, 30, 34, 38, 42, 55, 59.5]);
  const lanes = [{ id: 'north', z: 7 }, { id: 'nmid', z: 19.8 }, { id: 'mid', z: 32 }, { id: 'smid', z: 44.2 }, { id: 'south', z: 57 }];
  const nav = navGrid(walls, [4, 12, 20, 27, 35, 42, 50, 58, 65, 73, 80, 88, 96], lanes.map(l => l.z));
  // Domination: A the caravan yard's north side, B round the well house, C its image.
  const points = symmetricPoints(W, H, { x: 22, z: 24, r: 4.4 }, { x: 50, z: 32, r: 5.6 },
    [{ x: 40, z: 15, r: 3.6 }, { x: 22, z: 7, r: 4 }]);
  points.hard.push({ id: 'h5', x: 50, z: 32, r: 5.4 });
  // Search and Destroy (see bombSites): A in the courtyard's north-east quarter, B in the far camel yard.
  points.snd = bombSites({ x: 62, z: 25 }, { x: 80, z: 38 }, 3.4);
  // Capture the Flag (see flagBases): on the road in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 32 });

  const zones = [{ x: 0, z: 27, w: W, d: 10, kind: 'road' },
    { x: 0, z: 4.6, w: W, d: 6.6, kind: 'souk' }, { x: 0, z: 52.8, w: W, d: 6.6, kind: 'souk' },
    { x: 31.2, z: 13.2, w: 37.6, d: 37.6, kind: 'court' }];

  return {
    id: 'caravanserai', name: 'Caravanserai', theme: 'sirocco', size: 'large', region: 'desert',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
