// Coast, medium: Stilt Row, 80 x 50, a district of Kittiwake Bay (docs/DISTRICTS.md "The Coast") and a 6v6 map of its
// own. The fishing hamlet out on the tidal flats: a shingle bank down the middle with the net sheds, the cockle shed,
// boats drawn up and the capstan, and either side of it the flats, ankle-deep at low tide, where the stilt huts stand
// on their plank platforms. A tidal creek cuts into each side's flats with a footbridge over it. The bank is the
// middle lane; the flats are the long ones, slow to wade unless you keep to the platforms. In Kittiwake Bay the huts
// and sheds open up to loot and the flats run on into the back bay. Drawn by the giant-world streamer with the bay's
// palette (themes/shore.js).
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';
import { coastWater, mirror } from './coast-kit.js';

const S = (x, z, w, d, h, kind, extra = {}) => [x, z, w, d, h, kind, { skin: 'shore', ...extra }];
const hut = (x, z, w, d, h = 3.4) => S(x, z, w, d, h, 'building', { stilt: true });

export const W = 80, H = 50;

function build() {
  const walls = [];
  // The flats north of the bank (and their image south of it), the creek, the plank platforms the huts stand on and
  // the footbridge over the creek (dry footing: the lattice says land under every deck).
  const water = coastWater(W, H, {
    shallow: mirror(W, H, [{ x: 0, z: 0, w: W, d: 12 }]),
    steep: mirror(W, H, [{ x: 30, z: 0, w: 4, d: 12 }]),
    deck: mirror(W, H, [
      { x: 8, z: 2, w: 10, d: 8 }, { x: 12, z: 10, w: 2, d: 2 },       // The west hut's platform and its walkway.
      { x: 20, z: 4, w: 8, d: 8 },                                     // The next hut's, against the bank.
      { x: 30, z: 4, w: 4, d: 4 },                                     // The footbridge over the creek.
      { x: 12, z: 40, w: 10, d: 8 }, { x: 16, z: 38, w: 2, d: 2 },     // The south-west hut's platform and walkway.
    ]),
  });
  for (const [x, z, w, d, f] of water.water) walls.push(wall(x, z, w, d, 0, 'water', { region: 'kwflat', ...f }));
  rotated(walls, W, H, [
    // ---- The huts on their platforms.
    hut(10, 3, 6, 5, 3.6), hut(21, 5, 6, 5), hut(14, 42, 6, 5, 3.6),

    // ---- The bank: the net shed, the cockle shed, net racks, boats drawn up, the capstan, fish boxes.
    S(8, 14, 8, 6, 3.4, 'building', { netshed: true }),
    S(16, 29, 10, 7, 3.8, 'building', { shed: true }),
    S(28, 15.5, 5, 0.6, 1.4, 'barrier', { nets: true }),
    S(30, 32, 3.6, 1.6, 0.9, 'barrier', { boat: true }),
    S(34, 21, 1.4, 1.4, 1.0, 'barrier', { capstan: true }),
    S(24, 23, 1.6, 1.6, 1.1, 'crate', { fishbox: true }), S(18, 22, 1.6, 1.6, 1.15, 'crate', { pots: true }),
    S(36.4, 33.6, 0.6, 3, 1.4, 'barrier', { nets: true }),
    S(26, 44, 0.8, 0.8, 1.2, 'barrier', { post: true }),

    // ---- Out on the flats: a dinghy sitting on the mud. A spawn screen of stacked boxes.
    S(36, 4, 3, 1.4, 0.8, 'barrier', { boat: true, afloat: true }),
    S(6, 24, 0.9, 3.4, 2.0, 'wall', { boxwall: true }),
  ]);
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3, [13.5, 16, 20, 23, 27, 30, 33, 36.5]);
  const lanes = [{ id: 'north', z: 6 }, { id: 'mid', z: 25 }, { id: 'south', z: 44 }];
  const nav = navGrid(walls, [3, 12, 19, 26, 33, 40, 47, 54, 61, 68, 77], [6, 13, 19, 25, 31, 37, 44]);
  // Domination: A the west end of the bank, B the middle of it, C the east end.
  const points = symmetricPoints(W, H, { x: 14, z: 25, r: 3.5 }, { x: 40, z: 25, r: 4 },
    [{ x: 40, z: 14, r: 3 }, { x: 24, z: 44, r: 3 }]);
  points.hard.push({ id: 'h5', x: 40, z: 25, r: 3.8 });
  // Search and Destroy (see bombSites): A on the bank's north edge by the east hut's walkway, B by the east net shed.
  points.snd = bombSites({ x: 70, z: 14 }, { x: 58, z: 33 }, 3);
  // Capture the Flag (see flagBases): the bank in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 25 });

  const zones = [{ x: 0, z: 12, w: W, d: 26, kind: 'kwshingle' }, { x: 26, z: 20, w: 28, d: 10, kind: 'kwslip' }];
  const regionSeeds = [['kwflat', 40, 25, 30], ['kwheath', 10, 25], ['kwheath', 70, 25]];

  return {
    id: 'stiltrow', name: 'Stilt Row', theme: 'shore', giantWorld: true, size: 'medium', region: 'coast',
    width: W, height: H, walls, spawns, lanes, nav, points, zones, regionSeeds, roads: [], rails: [],
    rooms: water.decks, roofs: [], shallows: water.shallows, underDecks: water.underDecks, cells: water.cells,
  };
}

export default build();
