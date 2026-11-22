// Coast, large: Shipyard, 104 x 60, a district of Kittiwake Bay (docs/DISTRICTS.md "The Coast") and a 6v6 map of its
// own. A dry dock runs through the middle with two hulls on their keel blocks, bow to bow, and the gap between the bows
// is the middle of the map (B). Two gantry cranes straddle the dock; steps cut its rim, so you drop in and fight along
// the hulls or keep to the rim and the yards. The north and south yards (plate stacks, timber, the fabrication sheds)
// are the long lanes. Fitting-out quays at two corners run on into the bay's water in Kittiwake Bay, where the sheds
// open up to loot. Drawn by the giant-world streamer with the bay's palette (themes/shore.js).
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';
import { coastWater, mirror } from './coast-kit.js';

const S = (x, z, w, d, h, kind, extra = {}) => [x, z, w, d, h, kind, { skin: 'shore', ...extra }];
const rim = (x, z, w, d) => S(x, z, w, d, 1.0, 'barrier', { dockedge: true });
const plates = (x, z, w, d) => S(x, z, w, d, 2.2, 'container', { plates: true });
const timber = (x, z, w, d) => S(x, z, w, d, 1.2, 'barrier', { timber: true });
const prop = (x, z) => S(x, z, 1.2, 1.2, 1.3, 'barrier', { shoring: true });

export const W = 104, H = 60;
// The dock floor (painted, a step down): the renderer reads it for the dock walls' faces.
export const DOCK = { x: 24, z: 20, w: 56, d: 20 };

function build() {
  const walls = [];
  // The fitting-out quays: deep water along the south edge's west end, its image the north edge's east end.
  const water = coastWater(W, H, { deep: mirror(W, H, [{ x: 0, z: 55, w: 44, d: 5, quay: true }]) });
  for (const [x, z, w, d, f] of water.water) walls.push(wall(x, z, w, d, 0, 'water', { region: 'kwyard', ...f }));
  // The dock's north rim (its image is the south rim), steps at three places along it.
  rotated(walls, W, H, [rim(24, 19.2, 10, 0.8), rim(37, 19.2, 12, 0.8), rim(55, 19.2, 12, 0.8), rim(70, 19.2, 10, 0.8)]);
  rotated(walls, W, H, [
    // ---- The dock's west end (its image is the east end), open in the middle for the mid lane.
    rim(23.2, 19.2, 0.8, 8), rim(23.2, 32.8, 0.8, 8),

    // ---- The hulls on their keel blocks (the east one is the image), bows meeting in the middle; shoring along them.
    S(28, 26.5, 20, 7, 3.6, 'hull', { yardship: true, bow: 1 }),
    prop(33, 22), prop(42, 36.6),

    // ---- The west gantry crane's legs, one each side of the dock (the east crane is the image).
    S(40, 16.4, 1.4, 1.4, 15, 'crane', { gantry: true }), S(40, 42.2, 1.4, 1.4, 15, 'crane', { gantry: true }),

    // ---- The north yard: the fabrication shed, steel plate stacks, timber, the paint store, a van.
    S(6, 3, 16, 10, 5.4, 'building', { shed: true }),
    plates(27, 5, 6, 2.6), plates(27, 10.6, 6, 2.6), timber(39, 4.4, 6, 1.6), timber(39, 9.6, 1.6, 4.4),
    S(50, 3, 7, 6, 3.6, 'building', { paintstore: true }),
    S(14, 15.2, 4.4, 2, 1.5, 'barrier', { van: true }),

    // ---- The west yard: keel blocks waiting, the winch house, a spawn screen.
    S(10, 22.4, 3, 1.2, 1.1, 'barrier', { keel: true }), S(8, 34, 7, 6, 3.6, 'building', { winch: true }),
    S(6, 25.6, 0.9, 3.4, 2.0, 'wall', { boxwall: true }),

    // ---- The south-west quay: bollards along it, timber and a plate stack.
    S(12, 53, 0.8, 0.8, 0.8, 'barrier', { bollard: true }), S(30, 53, 0.8, 0.8, 0.8, 'barrier', { bollard: true }),
    timber(20, 46, 6, 1.6), plates(33, 45.4, 2.6, 6),
  ]);
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3, [4, 8, 12, 16, 24, 30, 36, 44, 48, 52]);
  const lanes = [{ id: 'north', z: 16.2 }, { id: 'mid', z: 30 }, { id: 'south', z: 43.8 }];
  const nav = navGrid(walls, [3, 12, 18, 26, 35, 45, 52, 59, 69, 78, 86, 92, 101], [6, 16.2, 23.5, 30, 36.5, 43.8, 54]);
  // Domination: A the west yard in front of the dock, B between the bows, C the east yard.
  const points = symmetricPoints(W, H, { x: 17, z: 30, r: 3.6 }, { x: 52, z: 30, r: 3.4 },
    [{ x: 52, z: 13.5, r: 3.2 }, { x: 26, z: 51, r: 3 }]);
  points.hard.push({ id: 'h5', x: 52, z: 30, r: 3.2 });
  // Search and Destroy (see bombSites): A in the north-east yard by the crane, B on the south-east quay road.
  points.snd = bombSites({ x: 74.5, z: 11 }, { x: 86, z: 42 }, 3);
  // Capture the Flag (see flagBases): the west yard in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 30 });

  const zones = [
    { ...DOCK, kind: 'kwdock' },
    { x: 0, z: 14, w: 23, d: 4.4, kind: 'kwconcrete' }, { x: 81, z: 41.6, w: 23, d: 4.4, kind: 'kwconcrete' },
    { x: 0, z: 51, w: 46, d: 4, kind: 'kwquayside' }, { x: 58, z: 5, w: 46, d: 4, kind: 'kwquayside' },
    { x: 24, z: 2, w: 22, d: 14, kind: 'kwstock' }, { x: 58, z: 44, w: 22, d: 14, kind: 'kwstock' },
  ];
  const regionSeeds = [['kwyard', 52, 30, 30], ['kwyard', 10, 10], ['kwyard', 94, 50]];

  return {
    id: 'shipyard', name: 'Shipyard', theme: 'shore', giantWorld: true, size: 'large', region: 'coast',
    width: W, height: H, walls, spawns, lanes, nav, points, zones, regionSeeds, roads: [], rails: [],
    rooms: water.decks, roofs: [], shallows: water.shallows, underDecks: water.underDecks, cells: water.cells,
    docks: [DOCK],
  };
}

export default build();
