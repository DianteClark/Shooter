// The North, small: Spillway, 56 x 36, a district of Kaldvik (docs/DISTRICTS.md "The North") and a 6v6 map of its
// own. The hydro dam above Kaldvik: its concrete crest runs north to south through the middle, parapets along both
// edges and two gatehouses on top, and the three lanes cross it where the parapets break. West of the crest the
// reservoir is frozen over (the intake tower stands in the ice, a lead stays open by the dam face); east of it the
// tailrace below the spillway, frozen too, with the valve house and the penstock pipes (the map is a 180-degree turn,
// so each side has both; the ground says which water is which). Close quarters round the gatehouses and across the
// pipes. In Kaldvik its huts open up as buildings to loot.
import { bombSites, flagBases, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

const parapet = (x, z, w, d) => [x, z, w, d, 1.1, 'barrier', { parapet: true }];
const lead = (x, z, w, d) => [x, z, w, d, 0, 'water', { lead: true }];
const drums = (x, z, s = 1.5) => [x, z, s, s, 1.1, 'crate', { drums: true }];

function build() {
  const W = 56, H = 36;
  const walls = [];
  rotated(walls, W, H, [
    // ---- North edge: the dam keeper's hut, the service road in front of it (z 3.2-8).
    [8, 0, 9, 3.2, 3.2, 'building', { damhut: true }],
    drums(19.5, 4.4, 1.3),

    // ---- West of the crest: the intake tower in the reservoir ice, a lead by the dam face, the valve house,
    // a penstock pipe across the middle lane, drums.
    [14, 9.5, 4.4, 4.4, 5.5, 'building', { intake: true }],
    lead(18, 24.5, 4.6, 3),
    [7, 24, 6, 5.2, 3.4, 'building', { valvehouse: true }],
    [9, 19.6, 8, 1.1, 0.95, 'barrier', { penstock: true }],
    drums(19.5, 15.5),

    // ---- The crest (x 25-31): parapets either side broken at the lanes, a gatehouse between each pair of lanes.
    parapet(24.4, 8.5, 0.6, 6.5), parapet(24.4, 21, 0.6, 6.5),
    [26.5, 9.5, 3, 3, 4.6, 'building', { gatehouse: true }],

    // ---- Spawn screens.
    [4.8, 9, 0.8, 4.5, 2.4, 'wall', { snowwall: true }], [4.8, 22.5, 0.8, 4.5, 2.4, 'wall', { snowwall: true }],
  ]);
  perimeter(walls, W, H, 3.6);

  const spawns = edgeSpawns(W, H, 3, [3, 6, 16, 20, 30, 33]);
  const lanes = [{ id: 'north', z: 5.2 }, { id: 'mid', z: 18 }, { id: 'south', z: 30.8 }];
  const nav = navGrid(walls, [3, 10, 17, 22, 28, 34, 39, 46, 53], lanes.map(l => l.z));
  // Domination: A between the intake and the pipe, B on the crest between the gatehouses, C its image.
  const points = symmetricPoints(W, H, { x: 12, z: 16.6, r: 2.6 }, { x: 28, z: 18, r: 3.6 },
    [{ x: 21, z: 5.2, r: 2.8 }, { x: 16, z: 31.5, r: 2.8 }]);
  points.hard.push({ id: 'h5', x: 28, z: 18, r: 3.2 });
  // Search and Destroy (see bombSites): A on the north service road past the crest, B in the south-east corner.
  points.snd = bombSites({ x: 41, z: 5.5 }, { x: 46, z: 30.5 }, 2.6);
  // Capture the Flag (see flagBases): between the spawn screens.
  points.ctf = flagBases(W, H, { x: 8.5, z: 18 });

  const zones = [
    { x: 0, z: 3.2, w: W, d: 4.8, kind: 'road' }, { x: 0, z: 28.8, w: W, d: 4.8, kind: 'road' },
    { x: 0, z: 8, w: 24.4, d: 20.8, kind: 'reservoir' }, { x: 31.6, z: 8, w: 24.4, d: 20.8, kind: 'tailrace' },
    { x: 24.4, z: 0, w: 7.2, d: H, kind: 'crest' },
  ];

  return {
    id: 'spillway', name: 'Spillway', theme: 'north', size: 'small', region: 'arctic',
    width: W, height: H, walls, spawns, lanes, nav, points, zones,
  };
}

export default build();
