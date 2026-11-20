// Ground War on Jadefall's coast (docs/BR.md "Jadefall"): Coral Quarter, 140 x 84 m. The old town of Port Coral cut
// for 16 v 16: whitewashed houses you can walk through, a market hall on each side (flag A), a harbour basin biting in
// from the sea with the customs house on its quay (flag B), and in the middle the plaza with its fountain (flag C)
// between two churches. A tidal flat floods one corner of each side: wade it slowly or go round by the lanes. Half is
// placed; the other half is its 180-degree image. Drawn by the giant-world streamer with the island's palette.
import { Plan, valueNoise } from './br-kit.js';
import { lattice, paint, water, twins, edges, cellAt, DEEP, SHALLOW, LAND, STEEP } from './isle-kit.js';
import { edgeSpawns, navGrid } from './build.js';

const W = 140, H = 84;
const REGION_SEEDS = [['beach', 20, 42], ['beach', 60, 20], ['ruins', 70, 42, 4], ['beach', 120, 42], ['beach', 80, 64], ['jungle', 10, 6], ['jungle', 130, 78]];

// Lanes: paved streets between the blocks (painted by the renderer).
const STREETS = [
  { pts: [[0, 42], [52, 42]], w: 4, kind: 'stone' }, { pts: [[88, 42], [140, 42]], w: 4, kind: 'stone' },
  { pts: [[0, 25], [52, 25]], w: 3.6, kind: 'stone' }, { pts: [[88, 59], [140, 59]], w: 3.6, kind: 'stone' },
  { pts: [[0, 62], [36, 62]], w: 3.6, kind: 'stone' }, { pts: [[104, 22], [140, 22]], w: 3.6, kind: 'stone' },
  { pts: [[40, 4], [40, 80]], w: 3.6, kind: 'stone' }, { pts: [[100, 4], [100, 80]], w: 3.6, kind: 'stone' },
];

function build() {
  const P = new Plan(W, H, 5521);
  const n1 = valueNoise(313);
  const cells = lattice(W, H, (x, z) => {
    const wob = (n1(x * 0.15, z * 0.15) - 0.5) * 3;
    // The harbour basin, cut into the south edge on this half (the north one is its image): quay walls, deep water.
    if (x > 46 && x < 64 && z > 70) return STEEP;
    // The tidal flat in the north-west corner.
    if (Math.hypot((x - 6) / 22, (z - 4) / 12) < 1 + wob * 0.06) return SHALLOW;
    return LAND;
  }, true);
  const T = twins(P);
  // The harbour mouth is open sea at the map's edge.
  paint(cells, { x: 46, z: 82, w: 18, d: 2 }, () => DEEP);
  paint(cells, { x: W - 64, z: 0, w: 18, d: 2 }, () => DEEP);
  P.region = 'beach';
  const shallows = water(P, cells);
  P.roads = STREETS;

  // ---- The plaza (flag C): fountain in the middle, a church on each side -------------------------------------------
  P.region = 'ruins';
  P.zones.push({ x: 56, z: 30, w: 28, d: 24, kind: 'plaza' });
  P.add(68, 40, 4, 4, 0, 'water', { fountain: true, skin: 'metro' });
  P.region = 'beach';
  T.B(54, 12, 12, 14, { h: 5.2, style: 'colonial', split: false, furnish: 1, doors: [['s', 0.5, 3], ['w', 0.5], ['e', 0.5]] });
  T.A(58.6, 7.2, 4.8, 4.8, 12, 'building', { belltower: true });
  for (const [x, z] of [[58, 32], [58, 50]]) T.A(x, z, 2.4, 2.4, 1.0, 'boulder', { palm: true, skin: 'desert' });
  T.A(64, 52, 4.2, 1.9, 1.4, 'barrier', { car: true, skin: 'metro' });

  // ---- The market hall (flag A) and the west blocks -----------------------------------------------------------------
  T.B(12, 30, 12, 10, { h: 4.4, style: 'market', split: false, furnish: 2, doors: [['n', 0.3], ['e', 0.5], ['s', 0.3]] });
  T.B(12, 45, 10, 9, { style: 'colonial', h: 3.8, doors: [['n', 0.5], ['e', 0.5]] });
  T.B(26, 30, 9, 9, { style: 'colonial', h: 4.0, doors: [['w', 0.5], ['s', 0.5]] });
  T.B(27, 46, 9, 9, { style: 'colonial', h: 3.6, doors: [['n', 0.5], ['e', 0.5], ['w', 0.5]] });
  T.A(31, 41, 1.6, 1.6, 1.1, 'crate', {});
  T.A(7.5, 22, 1, 5, 2.4, 'wall', { bamboo: true, skin: 'jungle' });
  T.A(7.5, 57, 1, 5, 2.4, 'wall', { bamboo: true, skin: 'jungle' });

  // ---- North-west: houses above the tidal flat ------------------------------------------------------------------
  T.B(22, 12, 10, 8, { style: 'colonial', h: 3.6, doors: [['s', 0.5], ['e', 0.5]] });
  T.B(44, 13, 8, 9, { style: 'colonial', h: 3.6, doors: [['w', 0.5], ['s', 0.5]] });
  T.A(30, 4, 3.2, 1.6, 0.9, 'barrier', { dinghy: true, skin: 'pier' });
  T.A(36, 18, 1.6, 1.6, 1.15, 'crate', { pots: true, skin: 'pier' });

  // ---- The harbour quay (flag B): customs house, cranes of nets and crates ------------------------------------------
  T.B(44, 56, 14, 9, { h: 4.6, style: 'colonial', furnish: 2, doors: [['n', 0.3], ['s', 0.5], ['w', 0.5], ['e', 0.5]] });
  T.A(68, 66, 3, 2.4, 2.4, 'shop', { stall: true, skin: 'jungle' });
  T.A(72, 72, 2.2, 3, 2.5, 'container', { fishbox: true, skin: 'pier' });
  T.A(36, 72, 2.2, 3, 2.5, 'container', { fishbox: true, skin: 'pier' });
  T.A(40.5, 76, 4, 1, 1.0, 'barrier', { nets: true, skin: 'pier' });
  T.room({ x: 52, z: 70, w: 4, d: 10, floor: 'pier' });
  T.A(28, 64, 2.2, 2.2, 1.1, 'crate', {});
  T.A(14, 68, 10, 7, 3.4, 'wall', { tin: true, skin: 'jungle' });

  P.region = 'beach';
  edges(P, W, H, (x, z) => cellAt(cells, Math.max(1, Math.min(W - 1, x)), Math.max(1, Math.min(H - 1, z))) !== LAND);

  const spawns = edgeSpawns(W, H, 3.5, [3, 7, 11, 15, 27, 31, 35, 38.5, 45.5, 49, 53, 57, 66, 70, 74, 78]);
  const lanes = [{ id: 'north', z: 25 }, { id: 'mid', z: 42 }, { id: 'south', z: 62 }];
  const nav = navGrid(P.walls, [4, 14, 24, 34, 40, 52, 62, 70, 78, 88, 100, 106, 116, 126, 136], [6, 16, 25, 34, 42, 50, 59, 68, 78]);
  const image = p => ({ x: W - p.x, z: H - p.z, r: p.r });
  const A = { x: 20, z: 42, r: 4.5 }, B = { x: 50, z: 68, r: 4.5 }, C = { x: 70, z: 42, r: 5.5 };
  const points = { dom: [{ id: 'A', ...A }, { id: 'B', ...B }, { id: 'C', ...C }, { id: 'D', ...image(B) }, { id: 'E', ...image(A) }], hard: [] };
  void SHALLOW; void STEEP;

  return {
    id: 'coral', name: 'Coral Quarter', theme: 'jadefall', giantWorld: true, size: 'huge', region: 'coast', width: W, height: H,
    walls: P.walls, spawns, lanes, nav, points, rooms: P.rooms, roofs: P.roofs, zones: P.zones, roads: P.roads, rails: [], regionSeeds: REGION_SEEDS,
    shallows, underDecks: [], cells,
    modes: ['gwtdm', 'gwdom'], large: true,
  };
}

export default build();
