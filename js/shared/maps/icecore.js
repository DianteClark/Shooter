// The North, medium: Ice Core, 76 x 46, a district of Kaldvik (docs/DISTRICTS.md "The North") and a 6v6 map of its
// own. A drilling camp out on the ice shelf: lab pods on hydraulic legs in yellow and blue, the core store, fuel
// drums, snowcats, and in the middle the drill derrick over its bore hole, four steel legs round open ice where the
// fight is. Crevasses split the shelf between the lanes (they stop feet, not shots). Not Icebreaker's red station on
// pack ice or Polestar's night watch: a working camp in a copper blizzard dusk (themes/north.js). The middle lane is
// Kaldvik's Fjord Road where it runs out onto the shelf. In Kaldvik its pods open up as buildings to loot.
import { bombSites, flagBases, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const pod = (x, z, w, d, h = 3.8, extra = {}) => [x, z, w, d, h, 'building', { pod: true, ...extra }];
const crevasse = (x, z, w, d) => [x, z, w, d, 0, 'water', { crevasse: true }];
const drums = (x, z, s = 1.5) => [x, z, s, s, 1.1, 'crate', { drums: true }];
const ridge = (x, z, w, d) => [x, z, w, d, 1.1, 'sandbag', { ridge: true }];
const jersey = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { jersey: true }];
const leg = (x, z) => [x, z, 1, 1, 9, 'crane', { derrick: true }];

function build() {
  const W = 76, H = 46;
  const walls = [];
  rotated(walls, W, H, [
    // ---- North edge: the vehicle shed; the supply road in front of it (z 3.6-9).
    pod(9, 0, 13, 3.6, 3.6, { garage: true }),
    drums(14, 5.4), [27.5, 5.2, 0.7, 0.7, 7.5, 'wall', { anemometer: true }],

    // ---- West camp: two lab pods on their legs, a snowcat between them, drums, the core store's drift.
    pod(8, 11, 14, 6),
    pod(8, 30, 12, 6, 3.6, { corestore: true }),
    [12, 19.4, 5.2, 2.6, 2.6, 'container', { snowcat: true }],
    drums(24, 13), drums(22.5, 34.5, 1.3), ridge(25, 40.6, 5, 0.9),

    // ---- The shelf: a crevasse between the middle and south lanes, the derrick's legs round the bore hole.
    crevasse(24, 28.5, 7, 2),
    leg(33.5, 18.5), leg(41.5, 18.5),

    // ---- Spawn cover.
    jersey(5.6, 4.5, 0.7, 3.4), jersey(5.6, 38, 0.7, 3.4),
  ]);
  perimeter(walls, W, H, 4);

  const spawns = edgeSpawns(W, H, 3, [3, 7, 11, 21, 24, 27, 35, 39, 43]);
  const lanes = [{ id: 'north', z: 6.3 }, { id: 'mid', z: 23 }, { id: 'south', z: 39.7 }];
  const nav = navGrid(walls, [3, 12, 22, 30, 38, 46, 54, 64, 73], lanes.map(l => l.z));
  // Domination: A between the west pods, B under the derrick, C its image.
  const points = symmetricPoints(W, H, { x: 18, z: 25.5, r: 3.4 }, { x: 38, z: 23, r: 3.6 },
    [{ x: 29, z: 9.5, r: 3 }, { x: 24, z: 39.7, r: 3 }]);
  points.hard.push({ id: 'h5', x: 38, z: 23, r: 3.2 });
  // Search and Destroy (see bombSites): A by the east vehicle shed, B on the south-east supply road.
  points.snd = bombSites({ x: 52, z: 6.3 }, { x: 58, z: 40 }, 3);
  // Capture the Flag (see flagBases): on the shelf road in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 23 });

  const zones = [
    { x: 0, z: 3.6, w: W, d: 5.4, kind: 'road' }, { x: 0, z: 37, w: W, d: 5.4, kind: 'road' }, { x: 0, z: 20.5, w: W, d: 5, kind: 'road' },
    { x: 32, z: 17.5, w: 12, d: 11, kind: 'drillpad' },
  ];

  return {
    id: 'icecore', name: 'Ice Core', theme: 'north', size: 'medium', region: 'arctic',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
