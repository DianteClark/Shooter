// Freight yard at dusk: three lanes split by sheds and container rows.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

function build() {
  const W = 72, H = 48;
  const walls = [];
  // West half. The east half is this list rotated 180 degrees around the centre, which keeps it fair.
  rotated(walls, W, H, [
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
  ]);
  // Centrepiece: mid lane has to split around it.
  walls.push(wall(33, 20.5, 6, 7, 3.0, 'building', { landmark: true }));
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3.5, [5, 11, 17, 21, 27, 31, 37, 43]);
  // Lane centre-lines, used for bot routing and for painting the ground.
  const lanes = [{ id: 'north', z: 8 }, { id: 'mid', z: 24 }, { id: 'south', z: 40 }];
  const nav = navGrid(walls, [4, 14, 27, 45, 58, 68], [8, 24, 40]);

  // B wraps the signal box: the map centre is inside it, so the zone is the ring around the building.
  const points = symmetricPoints(W, H,
    { x: 22, z: 24, r: 4 },
    { x: 36, z: 24, r: 6.5 },
    [{ x: 36, z: 13.5, r: 4.5 }, { x: 22, z: 24, r: 4.5 }]);

  // Search and Destroy (see bombSites). A sits in the north lane past the container stacks, B behind the south sheds: both a long walk for attackers down their lane, with the signal box splitting any rotation through the middle.
  points.snd = bombSites({ x: 57, z: 6.5 }, { x: 57, z: 39.5 });

  // Capture the Flag (see flagBases). At the head of the middle lane, between the two sheds and in front of the spawn screens: every run home crosses the signal box.
  points.ctf = flagBases(W, H, { x: 15, z: 24 });

  return { id: 'railyard', name: 'Railyard', theme: 'railyard', size: 'medium', region: 'industrial', width: W, height: H, walls, spawns, lanes, nav, points };
}

export default build();
