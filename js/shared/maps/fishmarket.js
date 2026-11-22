// Coast, medium: Fish Market, 80 x 48, a district of Kittiwake Bay (docs/DISTRICTS.md "The Coast") and a 6v6 map of its
// own. The open-sided market hall stands in the middle on its iron columns, rows of fish counters under it and the
// auction floor at its heart (B); harbour basins bite in at two corners, a trawler tied up in each. The quay road on
// the north and the dock road on the south are the long lanes; the yards in front of the ice house and the smokehouse
// carry the rotations. In Kittiwake Bay the ice house and the smokehouse open up as buildings to loot, the basins run
// on into the harbour and the back bay. Drawn by the giant-world streamer with the bay's palette (themes/shore.js).
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';
import { coastWater, mirror } from './coast-kit.js';

const S = (x, z, w, d, h, kind, extra = {}) => [x, z, w, d, h, kind, { skin: 'shore', ...extra }];
const column = (x, z) => S(x, z, 0.6, 0.6, 4.2, 'wall', { column: true });
const counter = (x, z, w, d) => S(x, z, w, d, 1.0, 'stall', { fishstall: true });
const boxes = (x, z, s = 1.6) => S(x, z, s, s, 1.1, 'crate', { fishbox: true });

export const W = 80, H = 48;
// The market hall's frame (art: the renderer draws its girders and glass ridge high overhead, never a roof).
export const HALL = { x: 28, z: 14, w: 24, d: 20 };

function build() {
  const walls = [];
  // The basins: the old dock in the south-west, its image the inner harbour's arm in the north-east. Stone quays.
  const water = coastWater(W, H, { deep: mirror(W, H, [{ x: 6, z: 41, w: 22, d: 7, quay: true }]) });
  for (const [x, z, w, d, f] of water.water) walls.push(wall(x, z, w, d, 0, 'water', { region: 'kwquay', ...f }));
  rotated(walls, W, H, [
    // ---- The ice house (north-west) and the smokehouse (south-west), each a block of the bay's own.
    S(8, 3, 10, 7, 4.2, 'building', { icehouse: true }),
    S(9, 28, 9, 7, 4.0, 'building', { smokehouse: true }),

    // ---- The hall's columns (its west half and the middle of its long sides).
    column(28, 14), column(28, 23.7), column(28, 33.4), column(33.8, 14), column(33.8, 33.4), column(39.7, 14),

    // ---- Under the hall: fish counters and ice chests, the auction floor in the middle left open.
    counter(31.5, 16.6, 4, 1.2), counter(31.5, 30.2, 4, 1.2), counter(31.6, 21.2, 1.2, 5.6),
    S(37, 18.6, 1.4, 1.4, 1.0, 'crate', { ice: true }),

    // ---- The west yard: a forklift, pallets of fish boxes, the fish merchant's van.
    S(19.5, 18.6, 2.4, 1.3, 1.4, 'barrier', { forklift: true }),
    boxes(22, 26.6), boxes(23.5, 12.2), S(16.6, 37.6, 4.4, 2, 1.5, 'barrier', { van: true }),

    // ---- The quays: lobster pots by the old dock, bollards, the trawler tied up in it.
    S(31, 43, 1.6, 1.6, 1.15, 'crate', { pots: true }),
    S(9.5, 43.4, 15, 3.4, 2.6, 'hull', { trawler: true, bow: 1 }),
    S(29.6, 39.2, 0.8, 0.8, 0.8, 'barrier', { bollard: true }),

    // ---- Spawn screens: fish box stacks.
    S(6, 15, 0.9, 4, 2.0, 'wall', { boxwall: true }), S(6, 33, 0.9, 4, 2.0, 'wall', { boxwall: true }),
  ]);
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3, [4, 8, 12, 20, 24, 28, 36, 40, 44]);
  const lanes = [{ id: 'north', z: 11.6 }, { id: 'mid', z: 24 }, { id: 'south', z: 37.8 }];
  const nav = navGrid(walls, [3, 12, 20, 26, 33, 40, 47, 54, 60, 68, 77], lanes.map(l => l.z));
  // Domination: A the west yard, B the auction floor, C the east yard.
  const points = symmetricPoints(W, H, { x: 20, z: 24, r: 3.6 }, { x: 40, z: 24, r: 4.2 },
    [{ x: 40, z: 11, r: 3.2 }, { x: 22, z: 38, r: 3.2 }]);
  points.hard.push({ id: 'h5', x: 40, z: 24, r: 4 });
  // Search and Destroy (see bombSites): A on the quay road by the harbour arm, B in front of the east ice house.
  points.snd = bombSites({ x: 56, z: 10.6 }, { x: 56, z: 40.5 }, 3);
  // Capture the Flag (see flagBases): on the yard in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 24 });

  const zones = [
    { x: 0, z: 10, w: W, d: 3.6, kind: 'kwsetts' }, { x: 0, z: 35, w: W, d: 6, kind: 'kwsetts' },
    { x: HALL.x, z: HALL.z, w: HALL.w, d: HALL.d, kind: 'kwmarket' },
    { x: 4, z: 38.6, w: 26, d: 2.4, kind: 'kwquayside' }, { x: 50, z: 7, w: 26, d: 2.4, kind: 'kwquayside' },
  ];
  const regionSeeds = [['kwquay', 40, 24, 20], ['kwtown', 10, 6], ['kwtown', 70, 42]];

  return {
    id: 'fishmarket', name: 'Fish Market', theme: 'shore', giantWorld: true, size: 'medium', region: 'coast',
    width: W, height: H, walls, spawns, lanes, nav, points, zones, regionSeeds, roads: [], rails: [],
    rooms: water.decks, roofs: [], shallows: water.shallows, underDecks: water.underDecks, cells: water.cells,
    halls: [HALL],
  };
}

export default build();
