// Night market. Blocks of shophouses leave a mesh of four-metre alleys; stalls clutter the crossings,
// so fights are short, close and corner to corner.
import { bombSites, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

function build() {
  const W = 60, H = 44;
  const walls = [];
  rotated(walls, W, H, [
    // Border rows: the outer alleys run along their fronts.
    [9, 0, 17, 4.5, 3.2, 'shop'],
    [9, 39.5, 17, 4.5, 3.2, 'shop'],
    [26, 0, 8, 3.6, 3.2, 'shop'],
    // Interior blocks, north and south of the main drag.
    [10, 10, 8, 8.5, 3.2, 'shop'],
    [22, 10, 6, 8.5, 3.2, 'shop'],
    [10, 25.5, 8, 8.5, 3.2, 'shop'],
    [22, 25.5, 6, 8.5, 3.2, 'shop'],
    // Spawn screens.
    [6.5, 5.5, 1, 6, 2.4, 'wall'],
    [6.5, 32.5, 1, 6, 2.4, 'wall'],
    // Kiosks staggered down the drag and through the outer alleys, each one a corner to peek.
    [14, 18.5, 2.4, 3.6, 2.6, 'shop'],
    [22.5, 21.6, 2.6, 3.9, 2.6, 'shop'],
    [33, 7, 2.4, 3, 2.6, 'shop'],
    [22, 4.5, 2.4, 2.9, 2.6, 'shop'],
    // Stalls: waist-high, shoot over them.
    [13, 5.6, 3, 1.1, 1.0, 'stall'],
    [26.5, 5.6, 2.2, 1.1, 1.0, 'stall'],
    [27.2, 18.5, 1.1, 1.8, 1.0, 'stall'],
    [18, 37.3, 3, 1.1, 1.0, 'stall'],
    [14, 36, 2.4, 3.5, 2.6, 'shop'],
    [28, 12, 1.6, 2.4, 2.6, 'shop'],
  ]);
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3, [4, 9.5, 14.5, 19.5, 24.5, 29.5, 34.5, 40]);
  const lanes = [{ id: 'north', z: 7.5 }, { id: 'mid', z: 22 }, { id: 'south', z: 36.5 }];
  const nav = navGrid(walls, [3, 20, 30, 40, 57], [7.5, 22, 36.5]);
  const points = symmetricPoints(W, H,
    { x: 20, z: 22, r: 3.6 },
    { x: 30, z: 22, r: 3.8 },
    [{ x: 30, z: 7.5, r: 3.4 }, { x: 15.5, z: 7.5, r: 3.4 }]);

  // Search and Destroy (see bombSites). Two alley crossings in the far blocks, smaller to fit the four-metre lanes; the kiosk staggers stop either one seeing the other.
  points.snd = bombSites({ x: 40, z: 8.3 }, { x: 42.5, z: 35.5 }, 2.8);

  return { id: 'neon', name: 'Night Market', theme: 'neon', width: W, height: H, walls, spawns, lanes, nav, points };
}

export default build();
