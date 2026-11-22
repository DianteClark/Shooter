// The North, medium: Trawler Basin, 80 x 48, a district of Kaldvik (docs/DISTRICTS.md "The North") and a 6v6 map of
// its own. A fishing harbour frozen solid: the fish halls and the net sheds stand on the two quays, and between them
// the basin is ice you can walk on, with two trawlers locked in it bow to stern, the ice fishers' shanties and the
// black open leads the icebreaker left. Three lanes: the quay road along the north sheds, the ice road between the
// ships (the middle, where the fight is), and the south quay. The leads stop feet, not shots. Snow blows in from the
// west under a copper dusk (themes/north.js). In Kaldvik its halls open up as buildings to loot.
import { bombSites, flagBases, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const shed = (x, z, w, d, h = 3.6) => [x, z, w, d, h, 'building', { shed: true }];
const hall = (x, z, w, d, h = 4.4) => [x, z, w, d, h, 'building', { fishhall: true }];
const lead = (x, z, w, d) => [x, z, w, d, 0, 'water', { lead: true }];
const shanty = (x, z) => [x, z, 2.4, 2.4, 2.4, 'building', { shanty: true }];
const ridge = (x, z, w, d) => [x, z, w, d, 1.1, 'sandbag', { ridge: true }];
const fishbox = (x, z, w = 1.6, d = 1.6) => [x, z, w, d, 1.1, 'crate', { fishbox: true }];
const box = (x, z, w, d) => [x, z, w, d, 2.6, 'container', {}];
const bollard = (x, z) => [x, z, 0.7, 0.7, 0.9, 'barrier', { bollard: true }];
const jersey = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { jersey: true }];

function build() {
  const W = 80, H = 48;
  const walls = [];
  rotated(walls, W, H, [
    // ---- North quay (z 0-9): net sheds along the edge, the quay road in front of them.
    shed(6, 0, 12, 3.4), shed(21, 0, 9, 3.4, 3.2),
    fishbox(13, 5.6), bollard(25, 6.2),

    // ---- West quay (x 0-27): the fish hall, the cold store, the crane over the quay edge.
    hall(7, 11, 13, 9),
    hall(8, 31, 11, 9, 4.2),
    [22.5, 12.5, 1.2, 1.2, 6.5, 'crane', { quaycrane: true }], [22.5, 17.5, 1.2, 1.2, 6.5, 'crane', { quaycrane: true }],
    box(22, 31.5, 2.5, 6), fishbox(14, 25.6, 2.4, 1.4),

    // ---- The basin (x 27-53): ice. A trawler locked in it, a lead behind its stern, shanties, a pressure ridge.
    [33, 12, 14, 4.6, 3.2, 'hull', { trawler: true, bow: 1 }],
    lead(28, 8.4, 4, 2.4),
    shanty(29, 20.5),
    ridge(35, 40.5, 6, 0.9),

    // ---- Spawn cover.
    jersey(6.5, 4.5, 0.7, 3.4), jersey(5.6, 39.5, 0.7, 3.4),
  ]);
  perimeter(walls, W, H, 4);

  const spawns = edgeSpawns(W, H, 3, [3, 7, 11, 22, 25, 28, 36, 41, 45]);
  const lanes = [{ id: 'north', z: 6 }, { id: 'mid', z: 24 }, { id: 'south', z: 42.5 }];
  const nav = navGrid(walls, [3, 12, 24, 31, 40, 49, 56, 68, 77], lanes.map(l => l.z));
  // Domination: A on the west quay between the halls, B on the ice between the ships, C its image.
  const points = symmetricPoints(W, H, { x: 16, z: 25, r: 3.6 }, { x: 40, z: 24, r: 3.8 },
    [{ x: 30, z: 4.6, r: 3.2 }, { x: 25, z: 44, r: 3 }]);
  points.hard.push({ id: 'h5', x: 40, z: 24, r: 3.4 });
  // Search and Destroy (see bombSites): A by the east net sheds on the quay road, B on the south-east quay.
  points.snd = bombSites({ x: 54, z: 5.5 }, { x: 60, z: 43.5 }, 3);
  // Capture the Flag (see flagBases): on the quay in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 24 });

  const zones = [
    { x: 0, z: 3.4, w: W, d: 5.2, kind: 'road' }, { x: 0, z: 39.4, w: W, d: 5.2, kind: 'road' },
    { x: 0, z: 0, w: 27, d: H, kind: 'quay' }, { x: 53, z: 0, w: 27, d: H, kind: 'quay' },
    { x: 27, z: 0, w: 26, d: H, kind: 'ice' },
  ];

  return {
    id: 'trawler', name: 'Trawler Basin', theme: 'north', size: 'medium', region: 'arctic',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
