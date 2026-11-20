// Ground War on Jadefall's coast (docs/BR.md "Jadefall"): Tidebreak, 140 x 84 m. Where the island's lagoon breaks out
// to the sea: a warm shallow lagoon runs north to south through the middle with a ruined shrine on its islet (flag C)
// and two stone causeways across it; the open sea bites in at the north and south. Each side has a stilt village
// (flag A), a ruined temple by the water (flag B), palm groves and a fishing beach. Wading the lagoon is slow; the
// causeways are fast and watched. Half is placed; the other half is its 180-degree image (isle-kit.js twins).
// Drawn by the giant-world streamer with the island's palette (themes/jadefall.js).
import { Plan, valueNoise } from './br-kit.js';
import { lattice, paint, water, twins, edges, cellAt, DEEP, SHALLOW, LAND, STEEP } from './isle-kit.js';
import { edgeSpawns, navGrid } from './build.js';

const W = 140, H = 84;
const REGION_SEEDS = [['jungle', 20, 42], ['beach', 50, 76], ['ruins', 40, 12], ['ruins', 70, 42, 6], ['jungle', 120, 42], ['beach', 90, 8], ['ruins', 100, 72]];

function build() {
  const P = new Plan(W, H, 3301);
  const n1 = valueNoise(77);
  const cells = lattice(W, H, (x, z) => {
    const wob = (n1(x * 0.12, z * 0.12) - 0.5) * 6;
    if (z < 7 + wob * 0.5 && x > 30 && x < 104) return DEEP;                       // The sea, north (south is its image).
    if (z < 13 + wob * 0.5 && x > 26 && x < 108) return SHALLOW;                   // Surf.
    if (Math.hypot(x - 70, z - 42) < 9 + wob * 0.3) return LAND;                   // The shrine's islet.
    if (Math.hypot(x - 61, z - 22) < 4.5) return STEEP;                            // A blue hole.
    if (Math.abs(x - 70) < 17 + wob) return SHALLOW;                               // The lagoon.
    return LAND;
  }, true);
  const T = twins(P);
  // Causeways across the lagoon (and the shrine's islet between them).
  const causeway = { x: 50, z: 25, w: 40, d: 5 };
  paint(cells, causeway, () => LAND);
  paint(cells, { x: W - causeway.x - causeway.w, z: H - causeway.z - causeway.d, w: causeway.w, d: causeway.d }, () => LAND);
  T.room({ ...causeway, floor: 'causeway' });
  P.region = 'beach';
  const shallows = water(P, cells);
  const dry = (x, z) => cellAt(cells, x, z) === LAND;
  void dry;

  // ---- The shrine on the islet (flag C): broken walls and pillars round an open court ------------------------------
  P.region = 'ruins';
  T.A(62, 35, 5, 1.2, 3.0, 'rock', { ruin: true, skin: 'jungle' });
  T.A(62, 36.2, 1.2, 3.5, 3.0, 'rock', { ruin: true, skin: 'jungle' });
  T.A(73, 35, 1.2, 1.2, 3.4, 'rock', { ruin: 'pillar', skin: 'jungle' });
  T.A(64.5, 44, 2.4, 1.4, 1.0, 'boulder', { fallen: true, skin: 'jungle' });
  T.A(69.4, 33.6, 1.2, 1.2, 3.6, 'rock', { ruin: 'statue', skin: 'jungle' });

  // ---- West shore of the lagoon: a pier, reeds, the ruined temple (flag B, north) --------------------------------------
  P.region = 'ruins';
  T.B(32, 12, 12, 9, { h: 3.8, style: 'temple', split: false, furnish: 1, doors: [['s', 0.5], ['e', 0.5], ['w', 0.5]] });
  T.A(46, 14, 1.2, 6, 3.0, 'rock', { ruin: true, skin: 'jungle' });
  T.A(28, 25, 6, 1.2, 3.0, 'rock', { ruin: true, skin: 'jungle' });
  T.A(46, 25, 1.2, 1.2, 3.4, 'rock', { ruin: 'pillar', skin: 'jungle' });
  T.A(22, 14, 2.2, 2.2, 4.6, 'rock', { tree: true, skin: 'jungle' });
  P.region = 'jungle';
  T.room({ x: 45, z: 46, w: 10, d: 3.2, floor: 'pier' });
  T.A(44, 34, 2.6, 1.3, 1.0, 'boulder', { fern: true, skin: 'jungle' });
  T.A(46, 54, 3.4, 3, 2.6, 'rock', { thicket: true, skin: 'jungle' });

  // ---- The stilt village (flag A) ---------------------------------------------------------------------------------
  P.region = 'jungle';
  T.B(16, 32, 7, 6, { style: 'thatch', h: 3.4, doors: [['e', 0.5], ['n', 0.5]] });
  T.B(30, 36, 8, 6, { style: 'thatch', h: 3.4, doors: [['w', 0.5], ['e', 0.5]] });
  T.B(16, 48, 7, 6, { style: 'thatch', h: 3.4, doors: [['e', 0.5], ['s', 0.5]] });
  T.B(32, 50, 7, 6, { style: 'thatch', h: 3.4, doors: [['n', 0.5], ['w', 0.5]] });
  T.A(25, 43, 1.8, 1.8, 1.1, 'crate', { altar: true });
  T.A(10, 40, 1, 3.4, 0.7, 'crate', { canoe: true, skin: 'jungle' });
  T.A(38, 44, 2.4, 1.6, 1.1, 'barrier', { drums: true, skin: 'jungle' });
  T.A(7.5, 26, 1, 5.5, 2.5, 'wall', { bamboo: true, skin: 'jungle' });           // Spawn screens.
  T.A(7.5, 54, 1, 5.5, 2.5, 'wall', { bamboo: true, skin: 'jungle' });

  // ---- The fishing beach and palm grove (south) ------------------------------------------------------------------------
  P.region = 'beach';
  T.B(14, 66, 9, 7, { style: 'coast', h: 3.4, doors: [['n', 0.5], ['e', 0.5]] });
  T.B(30, 70, 8, 6, { style: 'thatch', h: 3.2, doors: [['n', 0.5], ['w', 0.5]] });
  for (const [x, z] of [[24, 62], [40, 64], [8, 76], [44, 74], [22, 78]]) T.A(x, z, 2.4, 2.4, 1.0, 'boulder', { palm: true, skin: 'desert' });
  T.A(34, 60, 3.2, 1.6, 0.9, 'barrier', { dinghy: true, skin: 'pier' });
  T.A(18, 58, 4, 1, 1.0, 'barrier', { nets: true, skin: 'pier' });
  T.A(46, 62, 1.6, 1.6, 1.15, 'crate', { pots: true, skin: 'pier' });

  // ---- North-west: jungle between the temple and the spawn ----------------------------------------------------------
  P.region = 'jungle';
  for (const [x, z] of [[12, 8], [14, 20], [8, 14]]) T.A(x, z, 2.2, 2.2, 4.6, 'rock', { tree: true, skin: 'jungle' });
  T.A(22, 4, 3.4, 3, 3.2, 'rock', { banana: true, skin: 'jungle' });
  T.A(52, 32, 2.8, 1, 0.9, 'boulder', { log: true, skin: 'jungle' });

  P.region = 'beach';
  edges(P, W, H, (x, z) => cellAt(cells, Math.max(1, Math.min(W - 1, x)), Math.max(1, Math.min(H - 1, z))) !== LAND);

  const spawns = edgeSpawns(W, H, 3.5, [3, 7, 11, 15, 19.5, 23.5, 29.5, 33.5, 38.5, 43, 47, 51, 57, 61, 66, 70]);
  const lanes = [{ id: 'north', z: 16 }, { id: 'northmid', z: 27 }, { id: 'mid', z: 42 }, { id: 'southmid', z: 57 }, { id: 'south', z: 68 }];
  const nav = navGrid(P.walls, [4, 14, 24, 34, 46, 60, 74, 86, 96, 106, 116, 126, 136], lanes.map(l => l.z));
  const image = p => ({ x: W - p.x, z: H - p.z, r: p.r });
  const A = { x: 24, z: 42, r: 4.5 }, B = { x: 38, z: 26, r: 4.5 }, C = { x: 70, z: 42, r: 5 };
  const points = { dom: [{ id: 'A', ...A }, { id: 'B', ...B }, { id: 'C', ...C }, { id: 'D', ...image(B) }, { id: 'E', ...image(A) }], hard: [] };

  return {
    id: 'tidebreak', name: 'Tidebreak', theme: 'jadefall', giantWorld: true, size: 'huge', region: 'jungle', width: W, height: H,
    walls: P.walls, spawns, lanes, nav, points, rooms: P.rooms, roofs: P.roofs, zones: P.zones, roads: [], rails: [], regionSeeds: REGION_SEEDS,
    shallows, underDecks: [], cells,
    modes: ['gwtdm', 'gwdom'], large: true,
  };
}

export default build();
