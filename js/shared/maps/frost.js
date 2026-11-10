// Snowbound rail depot at night. The tracks run north-south, across the push: each row of parked wagons is a
// line to break through at its couplings, so fights go wagon to wagon, gap to gap, with the signal box and
// its loading platform as the open middle everyone has to cross.
import { bombSites, flagBases, wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

function build() {
  const W = 76, H = 46;
  const walls = [];
  rotated(walls, W, H, [
    // First wagon row in front of the spawn: couplings at z 9.5-13.5, 21-26 and 35-39.
    [15, 1.5, 2.8, 8, 3.1, 'container', { wagon: 'box' }],
    [15, 13.5, 2.8, 7.5, 3.1, 'container', { wagon: 'box' }],
    [15, 26, 2.8, 9, 3.1, 'container', { wagon: 'tank' }],
    [15, 39, 2.8, 5.5, 3.1, 'container', { wagon: 'box' }],
    // Second row, couplings staggered against the first so no gap lines up with another.
    [25, 0, 2.8, 5, 3.1, 'container', { wagon: 'box' }],
    [25, 8.5, 2.8, 9, 3.1, 'container', { wagon: 'tank' }],
    [25, 21, 2.8, 6.5, 3.1, 'container', { wagon: 'box' }],
    [25, 32, 2.8, 8.5, 3.1, 'container', { wagon: 'box' }],

    // Spawn screens and the lamp-room sheds that frame each spawn.
    [7, 7, 1.2, 6, 2.4, 'wall'],
    [7, 33, 1.2, 6, 2.4, 'wall'],
    [5.5, 19.5, 4, 7, 3.2, 'building', { shed: true }],

    // Snowbanks ploughed against the wagons: waist-high, shoot over them.
    [11, 10.5, 2.2, 1.1, 1.0, 'sandbag'],
    [19.5, 23, 1.2, 2.6, 1.0, 'sandbag'],
    [20, 37.5, 2.6, 1.1, 1.0, 'sandbag'],
    [29.2, 2.2, 2.2, 1.1, 1.0, 'sandbag'],
    // Crates and a points lever box on the open ground between rows.
    [19.6, 4.5, 1.8, 1.8, 1.1, 'crate'],
    [10.5, 30, 1.8, 1.8, 1.1, 'crate'],
    [21, 13, 1.6, 1.6, 1.1, 'crate'],
    // Stub sidings between the rows, one hard against each row, so the track corridor is never one long lane.
    [17.8, 17, 4.7, 2.6, 3.1, 'container', { wagon: 'box', across: true }],
    [20.3, 29.4, 4.7, 2.6, 3.1, 'container', { wagon: 'box', across: true }],
    [30.5, 29.5, 2.4, 0.8, 0.9, 'barrier'],

    // The yard throat: the loading platform and a coal stage either side of the signal box.
    [30.5, 5.5, 5.5, 7, 2.9, 'building', { stage: true }],
    [34.6, 32.5, 2.5, 6, 3.1, 'container', { wagon: 'box' }],
    // A shunting engine left on the headshunt, along the edge of the yard.
    [36.5, 0, 6.5, 2.8, 3.3, 'container', { wagon: 'loco', across: true }],
    [31.5, 18.5, 0.9, 3, 0.9, 'barrier'],
    // Water tower and a relay hut: they break the diagonals across the throat.
    [29.2, 36.5, 2.8, 2.8, 3.4, 'building', { tower: true }],
    [27.8, 14.5, 2.2, 2.2, 2.6, 'building', { hut: true }],
  ]);
  // The signal box: the one tall silhouette, dead centre, so mid has to split around it.
  walls.push(wall(34.5, 19.5, 7, 7, 3.6, 'building', { landmark: true }));
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3.2, [3.5, 9.5, 15, 28, 31, 35.5, 40, 43]);
  const lanes = [{ id: 'north', z: 11.5 }, { id: 'mid', z: 23.5 }, { id: 'south', z: 36.5 }];
  const nav = navGrid(walls, [4, 12, 21, 30, 46, 55, 64, 72], [4, 11.5, 23.5, 36.5, 42]);
  const points = symmetricPoints(W, H,
    { x: 21, z: 30, r: 3.8 },
    { x: 38, z: 23, r: 6.2 },
    [{ x: 38, z: 5, r: 4.2 }, { x: 21, z: 10, r: 3.8 }]);

  // Search and Destroy (see bombSites). Both between the far wagon rows, at the north and south ends of the track corridor, so attackers have to break a coupling to reach either.
  points.snd = bombSites({ x: 55, z: 4 }, { x: 55.5, z: 36.5 });

  // Capture the Flag (see flagBases). In front of the long wagon wall that screens the spawns, between the near wagon rows.
  points.ctf = flagBases(W, H, { x: 12, z: 23 });

  return { id: 'frost', name: 'Frostline', theme: 'frost', width: W, height: H, walls, spawns, lanes, nav, points };
}

export default build();
