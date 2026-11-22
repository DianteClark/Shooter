// Sirocco, medium: Copperstep, 80 x 50, a district of Sirocco Basin (docs/DISTRICTS.md) and a 6v6 map of its own. An
// open-pit copper mine cut in steps: the upper benches along the north and south edges carry the haul roads past the
// tin sheds, two stepped terrace faces drop from each down to the pit floor, and the haul road through the floor (the
// Spice Road's branch in the basin) passes the shaft's headframe in the middle. Terrace faces are waist high: shoot
// over them, climb round them at the ramps. Ore carts, hoppers and spoil heaps on the floor. In Sirocco Basin its sheds
// and the mine office open up as buildings to loot.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const shed = (x, z, w, d, h = 3.6) => [x, z, w, d, h, 'building', { tinshed: true }];
const office = (x, z, w, d, h = 3.6) => [x, z, w, d, h, 'building', { mineoffice: true }];
const face = (x, z, w, d = 0.8) => [x, z, w, d, 1.3, 'barrier', { terrace: true }];
const cart = (x, z) => [x, z, 2.6, 1.4, 1.3, 'barrier', { orecart: true }];
const hopper = (x, z, s = 3.2) => [x, z, s, s, 3.6, 'container', { hopper: true }];
const heap = (x, z, w, d, h = 2.4) => [x, z, w, d, h, 'rock', { spoil: true }];
const drums = (x, z) => [x, z, 1.6, 1.6, 1.1, 'crate', { drums: true }];
const magazine = (x, z, w = 4, d = 2.4) => [x, z, w, d, 2.4, 'container', { magazine: true }];
const rig = (x, z) => [x, z, 3, 2, 2.2, 'container', { drill: true }];

function build() {
  const W = 80, H = 50;
  const walls = [];
  rotated(walls, W, H, [
    // ---- The upper benches: tin sheds on the north edge's west half and the south edge's west half (the images fill
    // the rest), the haul road in front of them (z 4-10), a drill rig, drums.
    shed(11, 0, 10, 4), shed(27, 0, 7, 4, 3.4),
    shed(9, 46, 9, 4, 3.4), shed(24, 46, 10, 4),
    rig(32.6, 6.4), drums(20, 6.6),

    // ---- The terrace faces: the top step (z 10.4) and the second (z 16.6) on the north side, and the same on the south
    // (z 38.8, 32.6), each listed for its west half with ramps between the runs.
    face(6, 10.4, 14), face(24, 10.4, 12),
    face(10, 16.6, 8), face(22, 16.6, 10),
    face(8, 38.8, 12), face(25, 38.8, 11),
    face(12, 32.6, 9), face(25, 32.6, 9),

    // ---- The steps between the faces: a spoil heap, a cart left on the bench, drums.
    heap(28.6, 12.6, 4, 2.4, 1.8), cart(12, 13.4), drums(36.6, 35.4),

    // ---- The pit floor (z 17.4-32.6): ore carts on the two tracks, a hopper, a spoil heap, the mine office and the
    // explosives magazine at the west end.
    cart(15, 20.4), cart(30, 28.2),
    hopper(23.6, 26.6), heap(8, 27.8, 5, 3.4),
    office(5.4, 18.8, 7, 4.8), magazine(16.6, 29.2),
    drums(34.6, 19.6), [26, 18.8, 5.4, 2.6, 3, 'container', { haultruck: true }],
    [38, 4.6, 4, 3.4, 3.4, 'container', { crusher: true }],

    // ---- Spawn cover.
    drums(4.6, 6.4), drums(4.6, 42),
  ]);
  // The shaft's headframe in the middle of the pit floor: its own image.
  walls.push(wall(38.5, 23.5, 3, 3, 9, 'crane', { headframe: true, landmark: true }));
  perimeter(walls, W, H, 4);

  const spawns = edgeSpawns(W, H, 2.6, [4, 8, 13.6, 24, 27.6, 36, 44.6, 47.4]);
  const lanes = [{ id: 'north', z: 7 }, { id: 'nmid', z: 14.4 }, { id: 'mid', z: 25 }, { id: 'smid', z: 35.6 }, { id: 'south', z: 43 }];
  const nav = navGrid(walls, [2.6, 10, 18, 22, 29, 34.5, 40, 45.5, 51, 58, 62, 70, 77.4], lanes.map(l => l.z));
  // Domination: A at the west ramps on the upper steps, B round the headframe, C its image.
  const points = symmetricPoints(W, H, { x: 22, z: 13.6, r: 3.6 }, { x: 40, z: 25, r: 4.6 },
    [{ x: 26, z: 7, r: 3.4 }, { x: 20, z: 24, r: 3.4 }]);
  points.hard.push({ id: 'h5', x: 40, z: 25, r: 4.4 });
  // Search and Destroy (see bombSites): A on the far upper bench by the drill rig's image, B on the far pit floor.
  points.snd = bombSites({ x: 52, z: 7 }, { x: 60, z: 25 }, 3);
  // Capture the Flag (see flagBases): on the haul road in front of the spawns.
  points.ctf = flagBases(W, H, { x: 6.6, z: 25 });

  const zones = [{ x: 0, z: 21.4, w: W, d: 7.2, kind: 'road' },
    { x: 0, z: 4, w: W, d: 6.4, kind: 'bench' }, { x: 0, z: 39.6, w: W, d: 6.4, kind: 'bench' },
    { x: 0, z: 11.2, w: W, d: 5.4, kind: 'step' }, { x: 0, z: 33.4, w: W, d: 5.4, kind: 'step' },
    { x: 0, z: 17.4, w: W, d: 15.2, kind: 'pit' }];

  return {
    id: 'copperstep', name: 'Copperstep', theme: 'sirocco', size: 'medium', region: 'desert',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
