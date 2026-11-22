// Coast, large: Boardwalk, 100 x 56, a district of Kittiwake Bay (docs/DISTRICTS.md "The Coast") and a 6v6 map of its
// own. The resort on its sand spit: the planked promenade down the middle under the pier gates (B), a carousel at one
// end and the helter-skelter at the other, rows of arcades and tea rooms either side, and beyond them the beaches with
// their huts, deckchairs and groynes running out into the surf. The beaches are the long lanes, the surf slows anyone
// who wades it; the alleys between the arcades carry the rotations. In Kittiwake Bay the arcades open up to loot, the
// promenade runs on along the spit and the pleasure pier goes out to sea from the south beach. Drawn by the giant-world
// streamer with the bay's palette (themes/shore.js).
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';
import { coastWater, mirror } from './coast-kit.js';

const S = (x, z, w, d, h, kind, extra = {}) => [x, z, w, d, h, kind, { skin: 'shore', ...extra }];
const arcade = (x, z, w, d, h, extra = { arcade: true }) => S(x, z, w, d, h, 'building', extra);

export const W = 100, H = 56;

function build() {
  const walls = [];
  // Surf along both shores of the spit: the open sea to the south, the back bay to the north.
  const water = coastWater(W, H, { shallow: mirror(W, H, [{ x: 0, z: 0, w: W, d: 4 }]) });
  for (const [x, z, w, d, f] of water.water) walls.push(wall(x, z, w, d, 0, 'water', { region: 'kwdune', ...f }));
  rotated(walls, W, H, [
    // ---- The north row (arcades, a tea room) and the south row (the chip shop, an arcade, a tea room), west halves.
    arcade(8, 12, 14, 8, 4.4), arcade(26, 12, 12, 8, 4.2), arcade(42, 12, 6, 8, 3.8, { tearoom: true }),
    arcade(6, 36, 10, 8, 4.0, { chippy: true }), arcade(20, 36, 14, 8, 4.4), arcade(38, 36, 8, 8, 3.8, { tearoom: true }),

    // ---- The promenade: a kiosk, benches, a shelter, the pier gates' posts either side of the middle.
    S(14, 21, 2.6, 2.6, 2.8, 'shop', { kiosk: true }),
    S(36, 21, 2.4, 0.6, 0.9, 'barrier', { bench: true }),
    S(38, 33.2, 3.6, 1.4, 2.4, 'barrier', { shelter: true }),
    S(49.5, 20.6, 1, 1, 4.6, 'wall', { pierarch: true }),

    // ---- The north beach: huts, a windbreak, deckchairs, an upturned boat, the lifeguard's chair.
    S(14, 4.6, 7.2, 2.2, 2.6, 'shop', { beachhuts: 3 }),
    S(28, 7, 3, 0.5, 1.2, 'barrier', { windbreak: true }),
    S(22, 9.4, 3, 1.4, 0.8, 'barrier', { deckchairs: true }),
    S(36, 5.2, 3.6, 1.6, 0.9, 'barrier', { boat: true }),
    S(44, 6, 1.6, 1.6, 3.4, 'wall', { lifeguard: true }),

    // ---- The south beach: more huts, deckchairs, a boat, a groyne running out into the surf.
    S(8, 49.2, 9.6, 2.2, 2.6, 'shop', { beachhuts: 4 }),
    S(26, 46.4, 3, 1.4, 0.8, 'barrier', { deckchairs: true }),
    S(36, 49, 3.6, 1.6, 0.9, 'barrier', { boat: true }),
    S(44, 48, 0.6, 8, 1.0, 'barrier', { groyne: true }),
  ]);
  // The carousel and, as its image, the helter-skelter: the same footprint, each its own ride (landmarks: they stay
  // solid in the region).
  walls.push(wall(24, 24.5, 7, 7, 4.2, 'shop', { skin: 'shore', carousel: true, keep: true }));
  walls.push(wall(W - 31, H - 31.5, 7, 7, 4.2, 'shop', { skin: 'shore', helter: true, keep: true }));
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3, [6, 9, 22, 25, 28, 31, 34, 47, 50]);
  const lanes = [{ id: 'north', z: 8.5 }, { id: 'mid', z: 28 }, { id: 'south', z: 47.5 }];
  const nav = navGrid(walls, [3, 11, 18, 24, 32, 40, 50, 60, 68, 76, 82, 89, 97], [6, 8.5, 16, 28, 40, 47.5, 50]);
  // Domination: A the west promenade, B under the pier gates, C the east promenade.
  const points = symmetricPoints(W, H, { x: 14, z: 28, r: 3.6 }, { x: 50, z: 28, r: 4.2 },
    [{ x: 50, z: 8, r: 3.2 }, { x: 32, z: 48.5, r: 2.8 }]);
  points.hard.push({ id: 'h5', x: 50, z: 28, r: 4 });
  // Search and Destroy (see bombSites): A on the north beach past the gates, B on the south beach by the east arcade.
  points.snd = bombSites({ x: 67.2, z: 8.6 }, { x: 66, z: 47 }, 2.8);
  // Capture the Flag (see flagBases): the promenade in front of the spawns.
  points.ctf = flagBases(W, H, { x: 8.5, z: 28 });

  const zones = [
    { x: 0, z: 4, w: W, d: 8, kind: 'kwsand' }, { x: 0, z: 44, w: W, d: 8, kind: 'kwsand' },
    { x: 0, z: 20, w: W, d: 16, kind: 'kwboards' },
  ];
  const regionSeeds = [['kwdune', 50, 28, 30], ['kwdune', 10, 10], ['kwdune', 90, 46]];

  return {
    id: 'boardwalk', name: 'Boardwalk', theme: 'shore', giantWorld: true, size: 'large', region: 'coast',
    width: W, height: H, walls, spawns, lanes, nav, points, zones, regionSeeds, roads: [], rails: [],
    rooms: water.decks, roofs: [], shallows: water.shallows, underDecks: water.underDecks, cells: water.cells,
    promenade: [{ x: 0, z: 20, w: W, d: 16 }],
  };
}

export default build();
