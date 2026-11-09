// Map data. A map is rectangles on the XZ plane, so sim, bots and renderer all read one source.
// X runs east (right on screen), Z runs south (down on screen), origin at the north-west corner.
// kinds: building, container, wall, border block everything; crate and barrier are waist-high:
// they block movement only, so you can see and shoot over them.

const FULL = new Set(['building', 'container', 'wall', 'border']);

function wall(x, z, w, d, h, kind, extra = {}) {
  const solid = FULL.has(kind);
  return { x, z, w, d, h, kind, blocksMove: true, blocksBullet: solid, blocksVision: solid, ...extra };
}

function buildRailyard() {
  const W = 72, H = 48;
  // West half. The east half is this list rotated 180 degrees around the centre, which keeps it fair.
  const west = [
    // Lane dividers.
    [14, 12, 12, 7, 3.4, 'building'],
    [14, 29, 12, 7, 3.4, 'building'],
    // Spawn screens.
    [7, 8, 1.2, 7, 2.4, 'wall'],
    [7, 33, 1.2, 7, 2.4, 'wall'],
    // Freight containers near the front.
    [28, 10.5, 6, 2.5, 2.7, 'container'],
    [29.5, 33, 2.5, 6.5, 2.7, 'container'],
    [27, 17.5, 2.5, 5, 2.7, 'container'],
    // North lane cover.
    [19, 2, 2, 2, 1.1, 'crate'],
    [23, 6.2, 2.2, 0.8, 0.9, 'barrier'],
    // Tall lane breaks: no gun gets a clean shot down a whole lane.
    [18.5, 7, 2.5, 3.2, 2.7, 'container'],
    [34, 5.5, 3, 2.2, 2.7, 'container'],
    [18.5, 37.5, 2.5, 3.2, 2.7, 'container'],
    [26, 0, 2.5, 5.6, 2.7, 'container'],
    [26, 42.4, 2.5, 5.6, 2.7, 'container'],
    // Mid lane cover.
    [11, 22.5, 2, 2, 1.1, 'crate'],
    [20, 21, 4.5, 0.8, 0.9, 'barrier'],
    [20, 26.2, 4.5, 0.8, 0.9, 'barrier'],
    // South lane cover.
    [17, 42, 2, 2, 1.1, 'crate'],
    [23, 40.5, 3.5, 0.8, 0.9, 'barrier'],
    [33, 42.5, 2, 2, 1.1, 'crate'],
  ];
  const walls = [];
  for (const [x, z, w, d, h, kind] of west) {
    walls.push(wall(x, z, w, d, h, kind));
    walls.push(wall(W - x - w, H - z - d, w, d, h, kind));
  }
  // Centrepiece: mid lane has to split around it.
  walls.push(wall(33, 20.5, 6, 7, 3.0, 'building', { landmark: true }));
  // Perimeter, one metre outside the playable area so positions stay in [0,W]x[0,H].
  const t = 1.5, bh = 4;
  walls.push(wall(-t, -t, W + 2 * t, t, bh, 'border'));
  walls.push(wall(-t, H, W + 2 * t, t, bh, 'border'));
  walls.push(wall(-t, 0, t, H, bh, 'border'));
  walls.push(wall(W, 0, t, H, bh, 'border'));

  const zs = [5, 11, 17, 21, 27, 31, 37, 43];
  const spawns = [
    zs.map(z => ({ x: 3.5, z, aim: 0 })),
    zs.map(z => ({ x: W - 3.5, z: H - z, aim: Math.PI })),
  ];
  // Lane centre-lines, useful for bot routing and for painting the ground.
  const lanes = [
    { id: 'north', z: 8 }, { id: 'mid', z: 24 }, { id: 'south', z: 40 },
  ];
  // Navigation points bots may path between; sim may extend this graph.
  const nav = [];
  for (const x of [4, 14, 27, 45, 58, 68]) for (const z of [8, 24, 40]) nav.push({ x, z });
  return { id: 'railyard', name: 'Railyard', width: W, height: H, walls, spawns, lanes, nav };
}

export const MAPS = { railyard: buildRailyard() };
export const DEFAULT_MAP = 'railyard';
