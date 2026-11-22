// Metro, medium: Canal Row, 80 x 48, a district of Meridian City (docs/DISTRICTS.md) and a 6v6 map of its own. A
// canal splits the warehouses down the middle; three bridges cross it and each is a lane: the narrow north and south
// footbridges, the wide middle bridge where the fight is. The water stops feet, not shots, so every crossing is
// watched from the far quay. In Meridian City its warehouses open up as buildings to loot.
import { bombSites, flagBases, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const shed = (x, z, w, d, h = 4.4) => [x, z, w, d, h, 'building', { store: true }];
const store = (x, z, w, d) => [x, z, w, d, 3.4, 'building', { store: true }];
const box = (x, z, w, d) => [x, z, w, d, 2.6, 'container', {}];
const crate = (x, z, s = 1.6) => [x, z, s, s, 1.1, 'crate', {}];
const jersey = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { jersey: true }];
const car = (x, z, along = true) => [x, z, along ? 4.2 : 1.9, along ? 1.9 : 4.2, 1.4, 'barrier', { car: true }];

function build() {
  const W = 80, H = 48;
  const walls = [];
  rotated(walls, W, H, [
    // ---- The canal (x 37-43): water between the bridges (north z 3-8.5, middle z 21-27, south z 39.5-45).
    [37, 0, 6, 3, 0, 'water', { canal: true }], [37, 8.5, 6, 12.5, 0, 'water', { canal: true }],

    // ---- West quay: two warehouses, a shopfront on the north edge, containers and crates along the water.
    store(10, 0, 12, 3.2),
    shed(9, 10, 12, 10), shed(9, 30, 10, 9, 4),
    box(25, 12, 2.5, 6), box(27.5, 33, 6, 2.5), crate(31, 16), crate(30, 28.5), crate(24.5, 38.6),
    car(16, 23.2), jersey(26, 24.6, 3, 0.7),

    // ---- Spawn cover.
    jersey(6.5, 4.5, 0.7, 3.4), jersey(6.5, 38, 0.7, 3.4),
  ]);
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3, [3, 7, 11, 21, 24, 27, 37, 41, 45]);
  const lanes = [{ id: 'north', z: 5.75 }, { id: 'mid', z: 24 }, { id: 'south', z: 42.25 }];
  const nav = navGrid(walls, [3, 14, 23, 30, 40, 50, 57, 66, 77], lanes.map(l => l.z));
  // Domination: A between the west warehouses, B on the middle bridge, C between the east ones.
  const points = symmetricPoints(W, H, { x: 20, z: 24, r: 3.6 }, { x: 40, z: 24, r: 3.2 },
    [{ x: 30, z: 5.75, r: 3.2 }, { x: 30, z: 42.25, r: 3.2 }]);
  points.hard.push({ id: 'h5', x: 40, z: 24, r: 3 });
  // Search and Destroy (see bombSites): A on the east quay by the north footbridge, B by the south-east warehouse.
  points.snd = bombSites({ x: 50, z: 8 }, { x: 56, z: 42.5 }, 3);
  // Capture the Flag (see flagBases): on the quay road in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 24 });

  const zones = [{ x: 0, z: 3, w: W, d: 5.5, kind: 'road' }, { x: 0, z: 39.5, w: W, d: 5.5, kind: 'road' }, { x: 0, z: 21, w: W, d: 6, kind: 'road' },
    { x: 31, z: 0, w: 6, d: H, kind: 'quay' }, { x: 43, z: 0, w: 6, d: H, kind: 'quay' }];

  return {
    id: 'canalrow', name: 'Canal Row', theme: 'metro', size: 'medium', region: 'metro',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
