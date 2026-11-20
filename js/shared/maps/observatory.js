// Mountain, medium. Observatory: a mountain-top observatory at first light, 76 x 46 m, the snow pink with alpenglow.
// The telescope dome stands dead centre in its walled courtyard (the landmark; the middle lane splits round it). Each
// team comes up on its own cable car: the top station stands at the north-west corner (its image south-east), the
// visitor lodge and the snow groomer screen the spawn, the instrument hut and the radio mast line the north ridge path,
// and stunted pines, the weather screen and a granite tor fill the south slope. The east half is the 180-degree image.
// Three lanes: the ridge path (north), the courtyard round the dome (middle) and the pine slope (south).
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

// Pieces by what they are: a wall kind (see build.js) plus a flag for the renderer (js/render/themes/observatory.js).
const rock = (x, z, w, d, h = 3.2) => [x, z, w, d, h, 'rock', { granite: true }];
const drift = (x, z, w, d) => [x, z, w, d, 1.0, 'sandbag', { drift: true }];       // Snowdrift: shoot over it.
const parapet = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { parapet: true }];   // Courtyard wall, waist high.
const solar = (x, z, w, d) => [x, z, w, d, 1.0, 'barrier', { solar: true }];
const pine = (x, z) => [x, z, 1, 1, 4.6, 'wall', { pine: true }];                  // Trunk blocks; the crown is above.
const scope = (x, z) => [x, z, 1.4, 1.4, 1.2, 'crate', { scope: true }];           // Small telescope on a pier.
const crate = (x, z, s = 1.6) => [x, z, s, s, 1.1, 'crate'];

function build() {
  const W = 76, H = 46;
  const walls = [];
  rotated(walls, W, H, [
    // ---- West end: the cable car's top station (north-west corner), a granite screen in front of the spawn.
    [7.5, 0, 6, 4.6, 4, 'building', { station: true }],
    rock(7.5, 20.4, 2.2, 5.2, 2.8),

    // ---- The ridge path (z 0..11): a tor, the instrument hut, the radio mast, a drift and the solar row.
    rock(17, 0, 5, 3, 3.4), [23.5, 4.6, 4.2, 3.4, 3, 'building', { hut: true }],
    [31, 1, 1.2, 1.2, 9, 'crane', { mast: true }],
    drift(18.4, 8.4, 2.8, 1), solar(36.2, 6.4, 5, 0.9), crate(32.2, 8.4), rock(43.6, 9.4, 2.4, 2.2, 2.6),

    // ---- West of the courtyard: the visitor lodge north of the middle lane, the snow groomer south of it.
    [13, 12, 6.4, 6, 3.6, 'building', { lodge: true }],
    [14, 28.6, 4.6, 2.3, 2.4, 'container', { groomer: true }],
    // The courtyard's west wall, broken for the gate on the middle lane, and two telescope piers inside it.
    parapet(27, 14, 5, 0.6), parapet(27, 14.6, 0.6, 4.4), parapet(27, 27.4, 0.6, 4),
    scope(29.6, 17.6), scope(24, 24.6),

    // ---- The pine slope (z 33..46) and the weather screen; its image is the north-east.
    [21.6, 35.4, 1.4, 1.4, 1.4, 'crate', { screen: true }],
    pine(11, 36), pine(16.6, 33.2), pine(13.4, 41.4), pine(30.4, 38.6),
    rock(25, 42, 5.6, 4, 3), drift(33, 33.6, 3, 1),
  ]);
  // The dome on its drum, centred on the map so it is its own image.
  walls.push(wall(34, 19, 8, 8, 6.5, 'building', { landmark: true, dome: true }));
  perimeter(walls, W, H, 3.6);

  const spawns = edgeSpawns(W, H, 3.2, [3.5, 8.5, 14, 19, 27, 32, 37.5, 42.5]);
  const lanes = [{ id: 'north', z: 5.5 }, { id: 'mid', z: 23 }, { id: 'south', z: 40.5 }];
  const nav = navGrid(walls, [3, 10, 16, 22, 28, 33, 38, 43, 48, 54, 60, 66, 73], [3, 5.5, 10.5, 15, 23, 31, 35.5, 40.5, 43]);
  // Domination: A on the ridge path between the tor and the hut, B round the dome, C its image.
  // Hardpoint: the instrument hut's yard, the pine slope by the weather screen, their images, then the courtyard gate.
  const points = symmetricPoints(W, H,
    { x: 21, z: 10.5, r: 3.6 },
    { x: 38, z: 23, r: 6.5 },
    [{ x: 28, z: 10, r: 3.4 }, { x: 22, z: 32, r: 3.4 }]);

  // Search and Destroy (see bombSites). A by the east weather screen at the head of the north-east slope, B under the
  // east instrument hut on the south ridge path; the dome splits them.
  points.snd = bombSites({ x: 56, z: 9.4 }, { x: 56.5, z: 37 }, 3);
  // Capture the Flag (see flagBases). In the gap between the lodge and the groomer, in front of the spawns.
  points.ctf = flagBases(W, H, { x: 11.5, z: 23 });

  // Render-only: the cable car's line, from the top station out over the west (and east) edge.
  const decor = [{ type: 'cable', x: 10.5, z: 2.3 }, { type: 'cable', x: W - 10.5, z: H - 2.3 }];

  return {
    id: 'observatory', name: 'Observatory', theme: 'observatory', size: 'medium', region: 'mountain',
    width: W, height: H, walls, spawns, lanes, nav, points, decor,
  };
}

export default build();
