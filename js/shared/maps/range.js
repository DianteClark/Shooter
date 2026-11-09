// Firing range. One long open lane running east from a firing line, with dummies at marked distances:
// stationary at 10, 20, 30 and 40 m, strafing on rails at 15, 25 and 35 m. Waist-high furniture only, so every
// target stays in view from the firing line. Hidden from the vote (see ../map.js); reached from its own menu entry.
import { perimeter, wall, navGrid } from './build.js';

const W = 58, H = 30;
const LINE_X = 4, MID = H / 2;   // Firing line, and the centre row. Distances below are metres east of the line.

function build() {
  const walls = [];
  perimeter(walls, W, H);
  // Side walls guide the eye down the lane; waist-high crates flank the firing line.
  walls.push(wall(0, 0, W, 1.4, 3.4, 'wall'));
  walls.push(wall(0, H - 1.4, W, 1.4, 3.4, 'wall'));
  walls.push(wall(W - 1.4, 1.4, 1.4, H - 2.8, 3.4, 'wall'));
  walls.push(wall(LINE_X + 1.8, MID - 7.5, 1.2, 4.5, 1.0, 'sandbag'));
  walls.push(wall(LINE_X + 1.8, MID + 3, 1.2, 4.5, 1.0, 'sandbag'));
  // Distance boards the renderer draws; low enough to shoot over, and clear of the dummy rails.
  for (const d of [10, 20, 30, 40]) walls.push(wall(LINE_X + d - 0.4, 2.2, 0.8, 0.6, 0.9, 'crate'));

  const spawns = [
    [{ x: LINE_X, z: MID, aim: 0 }, { x: LINE_X, z: MID - 4, aim: 0 }, { x: LINE_X, z: MID + 4, aim: 0 }],
    [],
  ];
  const lanes = [{ id: 'north', z: 8 }, { id: 'mid', z: MID }, { id: 'south', z: 22 }];
  const nav = navGrid(walls, [LINE_X, 20, 40, 56], [8, MID, 22]);

  // move: slides between z0 and z1 on a rail at `speed`. Absent: stands still.
  const dummies = [
    { d: 10, z: MID },
    { d: 20, z: MID - 5 },
    { d: 30, z: MID + 5 },
    { d: 40, z: MID },
    { d: 15, z: MID - 2, move: { z0: 6, z1: 24, speed: 3.6 } },
    { d: 25, z: MID, move: { z0: 5, z1: 25, speed: 5.4 } },
    { d: 35, z: MID + 2, move: { z0: 7, z1: 23, speed: 7.4 } },
  ].map(t => ({ ...t, x: LINE_X + t.d, aim: Math.PI }));
  const marks = [10, 15, 20, 25, 30, 35, 40].map(d => ({ d, x: LINE_X + d, z: 3.2, label: `${d} m` }));

  return {
    id: 'range', name: 'Firing Range', theme: 'railyard', hidden: true, width: W, height: H, walls, spawns, lanes, nav,
    points: { dom: [], hard: [] }, dummies, marks,
  };
}

export default build();
