// Icebreaker (arctic, large). A polar research station at each end of a field of pack ice, and between them the
// expedition's icebreaker, frozen in. The ship is the middle: board it through the gangway gaps in its sides and
// fight over the open well deck between the two deckhouses. North and south of it the ice is wide open, broken by
// pressure ridges you can shoot over, upended floes you cannot, and open leads of black water nobody can cross.
import { wall, rotated, perimeter, edgeSpawns, navGrid, symmetricPoints, bombSites, flagBases } from './build.js';
import { module_, tank, dome, iceBlock, ridge, stack, snowcat, hull, deckhouse, hatch, crate } from './jungle-kit.js';

const water = (x, z, w, d) => [x, z, w, d, 0, 'water', { lead: true }];

function build() {
  const W = 104, H = 64;
  const walls = [];
  rotated(walls, W, H, [
    // ---- The ship (x 34..70, z 26..38). The stern listed; the bow is its image. Gangway gaps in each side.
    hull(34, 26, 3, 12, 3.6, { bow: 1, end: true }),
    hull(37, 26, 6, 0.9), hull(46, 26, 8, 0.9), hull(57, 26, 10, 0.9),
    deckhouse(40, 29.7, 4.8, 4.6),
    hatch(47.6, 28.6),

    // ---- West station: modules on stilts, the radar dome, fuel tanks, the garage, stacked containers.
    module_(9, 3.6, 10, 4.6), module_(10, 14, 4.6, 7.4), dome(21, 12, 5), tank(22, 1.6, 3), tank(25, 1.6, 3),
    module_(9.4, 46, 9, 5.6, 4.2), stack(21.6, 50.4, 6, 2.6), stack(24.4, 56.4, 2.6, 6),
    snowcat(15.4, 37.6), crate(20.4, 25.6), crate(6.6, 29.4, 1.6, 1.6),
    stack(7.4, 18.4, 2.6, 5.6),                              // Spawn screen.

    // ---- The pack ice north of the ship: an open lead, upended floes, pressure ridges.
    water(36, 14.6, 12, 2.6),
    iceBlock(30, 5, 3, 3), iceBlock(44, 5.6, 2.6, 3.4), iceBlock(55.6, 9.6, 3.2, 2.6), iceBlock(29.6, 21.6, 2.8, 2.8),
    iceBlock(66, 2, 3.4, 2.6), iceBlock(70.4, 16.4, 2.6, 3),
    ridge(34, 9.6, 6, 1), ridge(49.6, 20.2, 7, 1), ridge(61, 13.2, 1, 5), ridge(24.6, 30.6, 1, 5),
    snowcat(39.6, 21), crate(51.6, 3.4), iceBlock(40.6, 0, 3.4, 2.4), iceBlock(48.6, 10, 2.8, 3), iceBlock(33, 53.6, 3, 2.6),
  ]);
  perimeter(walls, W, H, 3.6);

  const spawns = edgeSpawns(W, H, 3.4, [3.5, 10, 16.5, 23, 41, 47.5, 54, 60.5]);
  const lanes = [{ id: 'north', z: 10.5 }, { id: 'mid', z: 32 }, { id: 'south', z: 53.5 }];
  const nav = navGrid(walls, [4, 14, 26, 34, 45, 52, 59, 70, 78, 90, 100], [3, 10.5, 22, 32, 42, 53.5, 61]);
  const points = symmetricPoints(W, H,
    { x: 21, z: 41, r: 4.2 },
    { x: 52, z: 32, r: 4.6 },
    [{ x: 32, z: 11, r: 4 }, { x: 52, z: 21, r: 4 }]);
  // Search and Destroy: both in the east station, by the dome and by the garage.
  points.snd = bombSites({ x: 75, z: 13 }, { x: 75, z: 54 });
  // Capture the Flag: on the ice in front of the spawns.
  points.ctf = flagBases(W, H, { x: 12.6, z: 32 });

  // Floors for the renderer: the ship's deck.
  const rooms = [{ x: 34, z: 26, w: 36, d: 12, floor: 'deck' }];

  return { id: 'icebreaker', name: 'Icebreaker', theme: 'arctic', size: 'large', region: 'arctic', width: W, height: H, walls, spawns, lanes, nav, points, rooms };
}

export default build();
