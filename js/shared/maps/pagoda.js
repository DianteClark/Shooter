// Mountain, medium. Pagoda: a hillside temple on an autumn evening, 72 x 44 m, lanterns lit in the blue dusk and the
// maples in full red. A five-storey pagoda stands dead centre (the landmark; the middle lane splits round it) between
// two koi ponds, each crossed by a plank bridge. Each team's end has its worship hall (north of the middle lane) and
// bell tower (south of it); the north path runs under a row of vermilion gates past a stone storehouse, the south path
// through the raked gravel garden by the tea house. The east half is the 180-degree image: the storehouse's twin sits
// in the south-west, the gates' twins in the south-east. Ponds stop feet, not bullets or eyes.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

// Pieces by what they are: a wall kind (see build.js) plus a flag for the renderer (js/render/themes/pagoda.js).
const pond = (x, z, w, d) => [x, z, w, d, 0, 'water', { pond: true }];
const torii = (x, z) => [x, z, 0.7, 0.7, 4.2, 'wall', { torii: true }];            // One gate pillar; the lintel is above.
const maple = (x, z) => [x, z, 1, 1, 5, 'wall', { maple: true }];                  // Trunk blocks; the crown is above.
const plaster = (x, z, w, d) => [x, z, w, d, 2.4, 'wall', { plaster: true }];     // White wall with a tiled cap.
const lantern = (x, z) => [x, z, 0.9, 0.9, 1.4, 'crate', { lantern: true }];       // Stone lantern: shoot over it.
const stone = (x, z, w, d) => [x, z, w, d, 1.0, 'boulder', { garden: true }];      // Garden stone in the raked gravel.
const bamboo = (x, z, w, d) => [x, z, w, d, 1.1, 'barrier', { bamboo: true }];     // Bamboo fence: see over it.

function build() {
  const W = 72, H = 44;
  const walls = [];
  rotated(walls, W, H, [
    // ---- West end: the worship hall north of the middle lane, the bell tower south of it, a wall screening the spawn.
    [9.5, 10, 7.4, 5.6, 4.4, 'building', { hall: true }],
    [11.4, 28.6, 3.6, 3.6, 5, 'building', { belfry: true }],
    plaster(7, 19.4, 0.8, 5.2),

    // ---- The north path (z 0..9): two vermilion gates, lanterns, a maple and the stone storehouse.
    torii(19, 1.8), torii(19, 7.4), torii(25, 1.8), torii(25, 7.4),
    lantern(14.6, 6.4), lantern(29.4, 4.2), maple(31.6, 1.4),
    [40, 0, 5, 3.6, 3.6, 'building', { kura: true }],
    bamboo(46.5, 6.2, 4, 0.5),

    // ---- The koi pond north of the pagoda, crossed by a plank bridge (x 31..33.4), and the garden round it.
    pond(25.6, 10, 5.4, 4), pond(33.4, 10, 4.6, 4),
    lantern(23.6, 12.6), maple(21, 17.4), plaster(25.6, 16.4, 4.4, 0.6),
    lantern(29, 20.6),

    // ---- The south path (z 34..44): the tea house, the raked gravel garden and its stones, maples.
    [8.6, 37.2, 5, 4, 3.2, 'building', { teahouse: true }],
    stone(17.2, 36.4, 2, 1.6), stone(21, 40, 1.6, 1.4), stone(19.4, 33.2, 1.4, 1.2),
    bamboo(15, 31.2, 4, 0.5),
    maple(24.6, 31.6), maple(36.6, 40),
  ]);
  // The pagoda, centred on the map so it is its own image.
  walls.push(wall(33, 19, 6, 6, 9, 'building', { landmark: true, pagoda: true }));
  perimeter(walls, W, H, 3.4);

  const spawns = edgeSpawns(W, H, 3.2, [3.5, 8, 13, 17.5, 26.5, 31, 36, 40.5]);
  const lanes = [{ id: 'north', z: 4.6 }, { id: 'mid', z: 22 }, { id: 'south', z: 39.4 }];
  const nav = navGrid(walls, [3, 9, 15, 21, 27, 32, 36, 40, 45, 51, 57, 63, 69], [3, 4.6, 8.5, 15, 18, 22, 26, 29, 35.5, 39.4, 41.5]);
  // Domination: A at the gates on the north path, B round the pagoda, C their image on the south path.
  // Hardpoint: the bridge's west end, the gravel garden, their images, then the pagoda.
  const points = symmetricPoints(W, H,
    { x: 22, z: 4.6, r: 3.4 },
    { x: 36, z: 22, r: 5.4 },
    [{ x: 24, z: 8.8, r: 3.2 }, { x: 20, z: 37.6, r: 3.4 }]);

  // Search and Destroy (see bombSites). A in the north-east gravel garden by the east tea house's twin, B at the
  // south-east gates; the pagoda and the south pond split them.
  points.snd = bombSites({ x: 52, z: 6.6 }, { x: 50, z: 39.4 }, 2.8);
  // Capture the Flag (see flagBases). Behind the spawn wall, between the worship hall and the bell tower.
  points.ctf = flagBases(W, H, { x: 11, z: 22 });

  // Floors the renderer draws: the plank bridges over the ponds.
  const rooms = [{ x: 31, z: 9.6, w: 2.4, d: 4.8, floor: 'bridge' }, { x: W - 33.4, z: H - 14.4, w: 2.4, d: 4.8, floor: 'bridge' }];

  return {
    id: 'pagoda', name: 'Pagoda', theme: 'pagoda', size: 'medium', region: 'mountain',
    width: W, height: H, walls, spawns, lanes, nav, points, rooms,
  };
}

export default build();
