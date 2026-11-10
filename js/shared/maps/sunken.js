// Flooded jungle ruin on a grey, steaming morning. A moat rings the walled temple island in the middle and you
// cross it on four broken causeways, so the map plays as king of the hill: the island courtyard holds the
// centre, the causeways are the chokepoints, and the banks are thick with fig trunks and fallen masonry.
import { wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints } from './build.js';

function build() {
  const W = 72, H = 48;
  const walls = [];
  rotated(walls, W, H, [
    // The moat. Gaps in the ring are the causeways: north-west, west, and their images south-east and east.
    [23, 12, 7.5, 3, 0, 'water'],
    [36.5, 12, 12.5, 3, 0, 'water'],
    [23, 15, 3, 5, 0, 'water'],
    [23, 26, 3, 7, 0, 'water'],
    // A guardian statue mid-causeway: two ways past it, and nothing sees straight down the moat.
    [24, 22.5, 1, 1, 2.8, 'rock', { ruin: 'statue' }],
    [33, 13, 1, 1, 2.8, 'rock', { ruin: 'statue' }],

    // The island's broken curtain wall, gapped where the causeways land.
    [26.5, 15.5, 4.5, 1.2, 3.2, 'rock', { ruin: true }],
    [26.5, 16.7, 1.2, 3.3, 3.2, 'rock', { ruin: true }],
    [26.5, 26.5, 1.2, 4.8, 3.2, 'rock', { ruin: true }],
    [38, 15.5, 7.5, 1.2, 3.2, 'rock', { ruin: true }],
    // Inside the courtyard: a colonnade stump and fallen blocks.
    [30.4, 26.6, 1.2, 1.2, 3.4, 'rock', { ruin: 'pillar' }],
    // Baffles just inside the gates, so no line runs from one causeway through the courtyard to the next.
    [31.5, 18, 3, 1.2, 3, 'rock', { ruin: true }],
    [28.8, 21.8, 1.2, 3.4, 3, 'rock', { ruin: true }],

    // Spawn screens.
    [7, 7, 1.2, 6, 2.4, 'wall'],
    [7, 35, 1.2, 6, 2.4, 'wall'],

    // The jungle bank: strangler-fig trunks, ruined walls and a fallen idol.
    [12.5, 2.5, 2.4, 2.4, 4, 'rock', { tree: true }],
    [20.6, 17.6, 2.4, 2.4, 4, 'rock', { tree: true }],
    [11, 28, 2.4, 2.4, 4, 'rock', { tree: true }],
    [19.5, 12.5, 2.6, 2.6, 4, 'rock', { tree: true }],
    [21, 39, 2.6, 2.6, 4, 'rock', { tree: true }],
    [34, 9.6, 2.4, 2.4, 4, 'rock', { tree: true }],
    [45, 2.2, 2.6, 2.6, 4, 'rock', { tree: true }],
    [13, 12, 5, 1.2, 3, 'rock', { ruin: true }],
    [16.5, 30, 1.2, 5, 3, 'rock', { ruin: true }],
    [17.7, 31.5, 4, 1.2, 3, 'rock', { ruin: true }],
    [25, 3.5, 6, 1.2, 3, 'rock', { ruin: true }],
    [28.5, 37.5, 1.2, 4.5, 3, 'rock', { ruin: true }],
    [36.5, 0, 2.4, 2.2, 3, 'rock', { ruin: true }],
    [19.5, 6.5, 2.6, 1.6, 1.0, 'boulder', { idol: true }],
    [10.5, 21.5, 1.8, 1.8, 1.0, 'boulder'],
    [14.5, 40.5, 2.6, 1.2, 1.0, 'boulder'],
    [37.5, 8, 2, 1.4, 1.0, 'boulder'],
    [18.4, 25, 2.4, 2.4, 4, 'rock', { tree: true }],
  ]);
  // The shrine: the island's one tall block, dead centre.
  walls.push(wall(33.8, 21.5, 4.4, 5, 3.8, 'building', { landmark: true }));
  perimeter(walls, W, H);

  const spawns = edgeSpawns(W, H, 3.2, [3.5, 7.5, 12.5, 20, 28, 35.5, 40.5, 44.5]);
  const lanes = [{ id: 'north', z: 8.5 }, { id: 'mid', z: 23 }, { id: 'south', z: 39.5 }];
  const nav = navGrid(walls, [4, 15, 24.5, 33.5, 38.5, 47.5, 57, 68], [8.5, 23, 39.5]);
  const points = symmetricPoints(W, H,
    { x: 18, z: 36, r: 3.8 },
    { x: 36, z: 24, r: 6 },
    [{ x: 33.5, z: 13.5, r: 3.6 }, { x: 31.5, z: 23.5, r: 3.6 }]);

  return { id: 'sunken', name: 'Sunken', theme: 'sunken', width: W, height: H, walls, spawns, lanes, nav, points };
}

export default build();
