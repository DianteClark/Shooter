// Battle royale (docs/BR.md): Frontier, 400 x 400 m. One world stitched from the regions of the 6v6 maps: the frozen
// bay and its icebreaker in the north-west, the steel mill and the freight yard along the north, the fishing port on
// the north-east coast, farmland in the west, downtown and its central station in the middle, a canyon with its dam,
// an oasis town and an airfield across the desert south, and over the river in the east the jungle village and temple.
// A river runs from the south edge to the sea in the north-east with six crossings; ridges and the canyon rims have
// passes; roads join every place to its neighbours, so a squad always has a way round the circle.
// Contract: docs/BR.md. Built by the kit in br-kit.js; dressed per region by js/render/themes/frontier.js.
import { wall } from './build.js';
import { Plan, regionField, segDist, mulberry } from './br-kit.js';
import { templeCourt } from './jungle-kit.js';

const W = 400, H = 400;

// Region seeds: [region, x, z, bias]. The renderer blends ground across the borders between them.
export const REGION_SEEDS = [
  ['arctic', 50, 40], ['arctic', 75, 112], ['arctic', 16, 100], ['arctic', 120, 20, -6],
  ['industrial', 190, 60], ['industrial', 250, 112], ['industrial', 150, 48], ['industrial', 240, 40],
  ['coast', 338, 40], ['coast', 375, 140], ['coast', 388, 80], ['coast', 380, 196], ['coast', 300, 16, 8],
  ['farmland', 60, 200], ['farmland', 125, 258], ['farmland', 135, 160], ['farmland', 16, 200], ['farmland', 90, 240],
  ['metro', 205, 182], ['metro', 200, 240], ['metro', 245, 196], ['metro', 168, 205],
  ['desert', 78, 322], ['desert', 152, 352], ['desert', 242, 330], ['desert', 28, 262], ['desert', 50, 385], ['desert', 205, 390],
  ['jungle', 348, 332], ['jungle', 305, 250], ['jungle', 372, 262], ['jungle', 340, 392], ['jungle', 296, 300, 6],
];

// The river's centre line, [z, x] pairs from the sea (north) to the south edge.
const RIVER = [[0, 280], [40, 284], [80, 290], [120, 286], [160, 292], [200, 291], [240, 299], [280, 306], [320, 312], [360, 306], [400, 300]];
export const riverX = z => {
  for (let i = 1; i < RIVER.length; i++) {
    if (z <= RIVER[i][0]) { const [z0, x0] = RIVER[i - 1], [z1, x1] = RIVER[i]; return x0 + (x1 - x0) * (z - z0) / (z1 - z0); }
  }
  return RIVER[RIVER.length - 1][1];
};
const RIVER_W = 9;
const BRIDGES = [70, 122, 200, 244, 324, 384];      // North edge of each crossing; each is 8 m long (north to south).

// Roads, for the renderer to paint and the scatter to keep off: polylines with a width and a surface.
const ROADS = [
  { pts: [[0, 205], [100, 205], [300, 204], [400, 202]], w: 8, kind: 'asphalt' },               // East-west highway.
  { pts: [[205, 92], [205, 262]], w: 7, kind: 'asphalt' },                                       // The avenue.
  { pts: [[205, 262], [199, 290], [198, 320], [200, 342]], w: 6, kind: 'asphalt' },               // To the airfield.
  { pts: [[188, 79], [205, 92], [250, 94], [289, 74], [330, 62]], w: 6, kind: 'asphalt' },         // Mill, freight, port.
  { pts: [[75, 95], [120, 82], [160, 77], [188, 79]], w: 6, kind: 'asphalt' },                    // Polar station to the mill.
  { pts: [[58, 56], [70, 80], [75, 95]], w: 4, kind: 'dirt' },                                   // Ship to the station.
  { pts: [[88, 124], [135, 152], [190, 170]], w: 6, kind: 'asphalt' },                           // Station, radio hill, downtown.
  { pts: [[72, 182], [135, 152]], w: 4, kind: 'dirt' },
  { pts: [[70, 180], [70, 150], [76, 128]], w: 4, kind: 'dirt' },                                 // Through the ridge pass.
  { pts: [[72, 212], [125, 258]], w: 4, kind: 'dirt' },
  { pts: [[125, 258], [175, 250], [205, 250]], w: 6, kind: 'asphalt' },
  { pts: [[125, 258], [109, 298], [124, 326], [152, 345]], w: 4, kind: 'dirt' },                   // Over the canyon's north pass.
  { pts: [[30, 268], [44, 297], [62, 318]], w: 4, kind: 'dirt' },                                 // Quarry to the dam.
  { pts: [[30, 262], [46, 214]], w: 4, kind: 'dirt' },
  { pts: [[86, 322], [152, 345]], w: 5, kind: 'dirt' },                                           // Along the riverbed.
  { pts: [[152, 345], [200, 342]], w: 6, kind: 'asphalt' },
  { pts: [[288, 342], [304, 328], [318, 328], [330, 332]], w: 5, kind: 'dirt' },                   // Airfield to the temple.
  { pts: [[205, 248], [300, 248], [322, 250]], w: 6, kind: 'asphalt' },                           // Station to the village.
  { pts: [[322, 250], [338, 288], [348, 312]], w: 4, kind: 'dirt' },
  { pts: [[255, 120], [286, 126], [330, 132], [370, 142]], w: 4, kind: 'dirt' },                   // Freight to the lighthouse.
  { pts: [[350, 60], [372, 100], [374, 132]], w: 4, kind: 'dirt' },
  { pts: [[300, 204], [340, 180], [366, 152]], w: 4, kind: 'dirt' },
  { pts: [[250, 384], [302, 388], [345, 368]], w: 3, kind: 'dirt' },                              // The ford.
];
const RAILS = [{ pts: [[108, 102], [282, 102]] }, { pts: [[108, 106.5], [282, 106.5]] }, { pts: [[140, 84.3], [190, 84.3]] }];

function build() {
  const P = new Plan(W, H, 2026);
  const R = P.rnd;
  const B = (x, z, w, d, o) => P.building(x, z, w, d, o);
  const A = (x, z, w, d, h, kind, extra) => P.add(x, z, w, d, h, kind, extra);
  // Adds a piece only where it leaves no narrow gap; for street clutter and cover.
  const T = (x, z, w, d, h, kind, extra, m = 1.6) => (P.free(x, z, w, d, m) ? P.add(x, z, w, d, h, kind, extra) : null);
  P.roads = ROADS; P.rails = RAILS;

  // ---- Water: the sea (north-east), the river with its crossings ---------------------------------------------------
  P.region = 'coast';
  A(262, 0, 38, 14, 0, 'water', { sea: true });
  A(300, 0, 4, 3, 0, 'water', { sea: true });                    // Off the end of the west pier.
  A(304, 0, 32, 14, 0, 'water', { sea: true });
  A(336, 0, 4, 3, 0, 'water', { sea: true });
  A(340, 0, 48, 14, 0, 'water', { sea: true });
  A(388, 0, 12, 176, 0, 'water', { sea: true });
  P.rooms.push({ x: 300, z: 3, w: 4, d: 11, floor: 'pier' }, { x: 336, z: 3, w: 4, d: 11, floor: 'pier' });
  const bridges = [];
  for (let z = 12; z < H; z += 4) {
    if (BRIDGES.some(b => z + 4 > b && z < b + 8)) continue;
    const cx = riverX(z + 2);
    P.region = regionOfRiver(z);
    A(+(cx - RIVER_W / 2).toFixed(1), z, RIVER_W, Math.min(4, H - z), 0, 'water', { river: true });
  }
  for (const b of BRIDGES) {
    const cx = riverX(b + 4);
    // The deck spans the widest of the river reaches either side, so no water corner pokes past it.
    const x0 = Math.min(riverX(b - 2), riverX(b + 10), cx) - RIVER_W / 2 - 1, x1 = Math.max(riverX(b - 2), riverX(b + 10), cx) + RIVER_W / 2 + 1;
    bridges.push({ x: +x0.toFixed(1), z: b, w: +(x1 - x0).toFixed(1), d: 8, floor: b === 384 ? 'ford' : 'bridge' });
  }
  P.rooms.push(...bridges);

  // ---- Downtown (metro, tier 1) -------------------------------------------------------------------------------
  P.poi('downtown', 'Downtown', 205, 182, 40, 'metro', 1);
  const cityBlock = (x0, z0, w, d, tall = 0.3) => {
    // Two lots split by an alley along the block's long side; each lot an office or shop you can enter, or a tower.
    const along = w >= d, gap = 3.4, inset = 1.4;
    const L = (along ? w : d) - 2 * inset, S = (along ? d : w) - 2 * inset;
    const a = (L - gap) * (0.4 + R() * 0.2), b = L - gap - a;
    for (const [off, len] of [[0, a], [a + gap, b]]) {
      const x = along ? x0 + inset + off : x0 + inset, z = along ? z0 + inset : z0 + inset + off;
      const lw = along ? len : S, ld = along ? S : len;
      if (R() < tall) A(x, z, lw, ld, 6 + R() * 4, 'building', { tower: true, skin: 'metro' });
      else B(x, z, lw, ld, { h: 4 + R() * 0.8, style: 'metro', doors: along ? [['n', 0.5], ['s', 0.5], [off ? 'w' : 'e', 0.5]] : [['w', 0.5], ['e', 0.5], [off ? 'n' : 's', 0.5]], furnish: 2 });
    }
  };
  cityBlock(168, 146, 30, 20, 0.25);
  cityBlock(212, 146, 30, 20, 0.25);
  cityBlock(168, 175, 30, 23, 0.2);
  cityBlock(168, 212, 30, 15, 0.2);
  cityBlock(212, 212, 30, 15, 0.2);
  cityBlock(146, 175, 16, 23, 0.4);
  cityBlock(248, 146, 16, 26, 0.4);
  // The park: fountain, trees, hedges and benches.
  P.zones.push({ x: 212, z: 175, w: 30, d: 23, kind: 'park' });
  A(224, 184, 6, 5, 0, 'water', { fountain: true, skin: 'metro' });
  for (const [x, z] of [[215, 178], [238, 178], [215, 194], [238, 194], [227, 177.5]]) A(x, z, 1, 1, 4.5, 'wall', { tree: true, skin: 'metro' });
  A(218, 183, 0.8, 5, 1.1, 'barrier', { hedge: true, skin: 'metro' });
  A(235, 183, 0.8, 5, 1.1, 'barrier', { hedge: true, skin: 'metro' });
  A(222, 192.5, 9, 0.8, 1.1, 'barrier', { hedge: true, skin: 'metro' });
  A(239, 186, 2, 1.6, 2.4, 'shop', { kiosk: true, skin: 'metro' });
  // Street clutter: parked cars, buses, kiosks and shelters on the streets.
  const cars = [[172, 168.6, 1], [190, 171.2, 1], [216, 168.6, 1], [234, 171.2, 1], [150, 203, 1], [180, 207, 1], [232, 201.6, 1], [258, 207, 1],
    [199.8, 150, 0], [209.6, 160, 0], [199.8, 186, 0], [209.6, 222, 0], [244.6, 152, 0], [164.4, 160, 0]];
  for (const [x, z, along] of cars) T(x, z, along ? 4.2 : 1.9, along ? 1.9 : 4.2, 1.4, 'barrier', { car: true, skin: 'metro' }, 1.2);
  T(186, 201.4, 9.5, 2.6, 3.2, 'container', { bus: true, skin: 'metro' }, 1.2);
  T(240, 207.6, 9.5, 2.6, 3.2, 'container', { bus: true, skin: 'metro' }, 1.2);
  T(160, 169.6, 3.6, 1.3, 2.4, 'barrier', { shelter: true, skin: 'metro' }, 1.2);
  T(246, 168.4, 2, 1.6, 2.4, 'shop', { newsstand: true, skin: 'metro' }, 1.2);
  P.outdoorLoot(205, 182, 40, 14, 1);

  // ---- Central Station (metro, tier 1) ------------------------------------------------------------------------
  P.poi('station', 'Central Station', 200, 241, 22, 'metro', 1);
  P.zones.push({ x: 180, z: 228, w: 40, d: 4, kind: 'plaza' });
  B(182, 232, 36, 18, {
    h: 5.2, style: 'station', split: false, furnish: 2, chest: true, loot: 10,
    doors: [['n', 0.2], ['n', 0.5], ['n', 0.8], ['s', 0.25], ['s', 0.75], ['w', 0.5], ['e', 0.5]],
    inside: () => {
      // The ticket line: turnstile banks across the hall, gaps between them to walk through.
      for (let x = 185.6; x + 2 < 215; x += 5.4) A(x, 240.2, 2.4, 0.7, 1.05, 'barrier', { turnstile: true, skin: 'metro' });
    },
  });
  A(170, 236, 5, 4, 3, 'shop', { metro: true, skin: 'metro' });
  A(225, 236, 5, 4, 3, 'shop', { metro: true, skin: 'metro' });
  B(170, 254, 10, 8, { style: 'metro', h: 4 });
  B(222, 254, 12, 8, { style: 'metro', h: 4 });
  P.outdoorLoot(200, 241, 24, 6, 1);

  // ---- Steel Mill (industrial, tier 1) ------------------------------------------------------------------------
  P.poi('mill', 'Steel Mill', 188, 56, 36, 'industrial', 1);
  P.skin = 'foundry';
  B(166, 36, 30, 18, {
    h: 6.2, style: 'industrial', split: false, furnish: 2, chest: true, loot: 9,
    doors: [['n', 0.3, 3], ['n', 0.75, 3], ['s', 0.3, 3], ['s', 0.75, 3], ['w', 0.5, 3], ['e', 0.5, 3]],
    inside: () => {
      A(176, 41.6, 6, 6, 6.6, 'building', { furnace: true });
      A(186.4, 43, 2.4, 2.2, 2.6, 'container', { ladle: true });
      A(169.6, 49.4, 3, 1.4, 1.0, 'barrier', { moulds: true });
    },
  });
  B(204, 40, 24, 12, {
    h: 5, style: 'industrial', split: false, furnish: 1, loot: 6,
    doors: [['w', 0.5, 3], ['e', 0.5, 3], ['n', 0.3], ['s', 0.7]],
    inside: () => { A(207.5, 45.4, 6.5, 1.2, 1.1, 'barrier', { conveyor: true }); A(217, 45.4, 7, 1.2, 1.1, 'barrier', { conveyor: true }); },
  });
  A(200, 22, 2.6, 2.6, 15, 'building', { stack: true });
  A(206, 22, 2.6, 2.6, 13, 'building', { stack: true });
  A(168, 64, 8, 3, 2.6, 'wall', { bunker: true });
  A(180, 64, 8, 3, 2.6, 'wall', { bunker: true });
  for (const [x, z] of [[206, 60], [226, 60], [206, 72], [226, 72]]) A(x, z, 1.2, 1.2, 6, 'crane', { gantry: true });
  A(210.4, 63.4, 2.6, 2.6, 2.5, 'container', { slab: true });
  A(216, 63.4, 2.6, 2.6, 2.5, 'container', { slab: true });
  A(221.6, 63.4, 2.6, 2.6, 2.5, 'container', { slab: true });
  A(211, 68.6, 1.8, 1.8, 1.3, 'crate', { coil: true });
  A(217.4, 68.6, 1.8, 1.8, 1.3, 'crate', { coil: true });
  A(150, 83, 9, 2.6, 2.8, 'container', { wagon: true });
  A(163, 83, 9, 2.6, 2.8, 'container', { wagon: true });
  B(146, 40, 12, 8, { style: 'industrial', h: 3.6 });
  B(148, 58, 9, 7, { style: 'industrial', h: 3.4 });
  P.skin = null;
  P.outdoorLoot(190, 58, 36, 10, 1);

  // ---- Freight Yard (industrial, tier 2) ----------------------------------------------------------------------
  P.poi('freight', 'Freight Yard', 248, 112, 26, 'industrial', 2);
  P.skin = 'foundry';
  for (const x of [222, 246]) A(x, 100.7, 9, 2.6, 2.8, 'container', { wagon: true });
  for (const x of [234, 258]) A(x, 105.2, 9, 2.6, 2.8, 'container', { wagon: true });
  P.skin = null;
  B(232, 114, 22, 10, { h: 4.6, style: 'industrial', split: false, furnish: 2, chest: true, doors: [['n', 0.25], ['n', 0.75], ['s', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(262, 88, 6, 5, { h: 4, style: 'industrial', doors: [['s', 0.5], ['w', 0.5]] });
  A(268, 113, 6, 2.5, 2.6, 'container', {});
  A(268, 118, 6, 2.5, 2.6, 'container', {});
  A(224, 120, 2.5, 6, 2.6, 'container', {});
  T(216, 112, 1.6, 1.6, 1.1, 'crate', {});
  T(259, 124, 1.6, 1.6, 1.1, 'crate', {});
  P.outdoorLoot(248, 110, 26, 6, 2);

  // ---- Fishing Port (coast, tier 2) ----------------------------------------------------------------------------
  P.poi('port', 'Fishing Port', 338, 40, 34, 'coast', 2);
  P.skin = 'pier';
  P.zones.push({ x: 290, z: 14, w: 98, d: 8, kind: 'quay' });
  B(314, 22, 20, 12, { h: 4, style: 'coast', split: false, furnish: 2, chest: true, doors: [['n', 0.3], ['n', 0.7], ['s', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(342, 18, 9, 8, { style: 'coast', doors: [['n', 0.5, 3], ['s', 0.5]] });
  B(356, 18, 9, 8, { style: 'coast', doors: [['n', 0.5, 3], ['s', 0.5]] });
  B(296, 38, 9, 7, { style: 'coast' });
  B(328, 44, 8, 7, { style: 'coast' });
  B(344, 44, 10, 7, { style: 'coast' });
  B(364, 34, 8, 8, { style: 'coast' });
  A(299, 24, 2.2, 3, 2.5, 'container', { fishbox: true });
  A(304.6, 24, 2.2, 3, 2.5, 'container', { fishbox: true });
  A(372, 22, 2.2, 3, 2.5, 'container', { fishbox: true });
  A(318, 38, 1.6, 1.6, 1.15, 'crate', { pots: true });
  A(322.4, 38, 1.6, 1.6, 1.15, 'crate', { pots: true });
  A(337, 34.6, 4, 1, 1.0, 'barrier', { nets: true });
  A(356, 30, 4, 1, 1.0, 'barrier', { nets: true });
  P.skin = 'arctic';
  // A trawler moored between the piers.
  A(350, 3, 3, 7, 3, 'hull', { plate: true, end: true, bow: 1 });
  A(353, 3, 20, 0.9, 3, 'hull', { plate: true });
  A(353, 9.1, 20, 0.9, 3, 'hull', { plate: true });
  A(373, 3, 3, 7, 3, 'hull', { plate: true, end: true, bow: -1 });
  A(359, 4.5, 5, 4, 4.4, 'building', { deckhouse: true });
  P.skin = null;
  P.outdoorLoot(338, 36, 32, 8, 2);

  // ---- Lighthouse Point (coast, tier 3) --------------------------------------------------------------------------
  P.poi('lighthouse', 'Lighthouse Point', 372, 142, 18, 'coast', 3);
  A(374, 128, 4, 4, 12, 'building', { lighthouse: true });
  B(356, 140, 9, 7, { style: 'coast' });
  B(376, 148, 7, 6, { style: 'coast', doors: [['w', 0.5], ['n', 0.5]] });
  for (const [x, z, s] of [[382, 124, 2.4], [383, 162, 2.8], [362, 128, 2.2]]) A(x, z, s, s * 0.8, 1.2, 'boulder', { crag: true });
  P.outdoorLoot(370, 142, 18, 4, 3);

  // ---- Frozen Ship (arctic, tier 2) -----------------------------------------------------------------------------
  P.poi('ship', 'Frozen Ship', 55, 41, 30, 'arctic', 2);
  P.zones.push({ x: 0, z: 0, w: 140, d: 30, kind: 'ice' });
  P.skin = 'arctic';
  A(30, 34, 3, 14, 3.6, 'hull', { plate: true, end: true, bow: 1 });
  A(77, 34, 3, 14, 3.6, 'hull', { plate: true, end: true, bow: -1 });
  for (const z of [34, 47.1]) for (const [x, w] of [[33, 14], [50, 10], [63, 14]]) A(x, z, w, 0.9, 3.4, 'hull', { plate: true });
  P.rooms.push({ x: 33, z: 34.9, w: 44, d: 12.2, floor: 'deck' });
  P.skin = null;
  B(36, 37.4, 9, 7.2, { h: 3.6, style: 'ship', doors: [['w', 0.5], ['e', 0.5]], chest: true });
  B(65, 37.4, 9, 7.2, { h: 3.6, style: 'ship', doors: [['w', 0.5], ['e', 0.5]] });
  P.skin = 'arctic';
  A(51.6, 38.6, 2.4, 2.4, 1.0, 'crate', { hatch: true });
  A(57, 42.4, 2.4, 2.4, 1.0, 'crate', { hatch: true });
  A(14, 18, 16, 3, 0, 'water', { lead: true });
  A(90, 22, 3, 16, 0, 'water', { lead: true });
  A(34, 62, 18, 3, 0, 'water', { lead: true });
  for (const [x, z, w, d] of [[22, 30, 3, 3], [44, 10, 2.6, 3.4], [70, 14, 3.2, 2.6], [98, 44, 2.8, 2.8], [18, 52, 3, 2.6], [76, 58, 3.4, 2.6], [110, 30, 3, 3]]) A(x, z, w, d, 2.6, 'rock', { ice: true });
  A(28, 44, 1, 5, 1.0, 'sandbag', { ridge: true });
  A(84, 38, 1, 6, 1.0, 'sandbag', { ridge: true });
  A(54, 54, 7, 1, 1.0, 'sandbag', { ridge: true });
  A(88, 50, 3.6, 2, 2.3, 'container', { snowcat: true });
  A(40, 26, 1.6, 1.6, 1.1, 'crate', {});
  P.skin = null;
  P.outdoorLoot(55, 42, 32, 6, 2);

  // ---- Polar Station (arctic, tier 2) ---------------------------------------------------------------------------
  P.poi('polar', 'Polar Station', 76, 114, 26, 'arctic', 2);
  B(56, 100, 12, 7, { style: 'arctic', h: 3.6 });
  B(74, 95, 10, 7, { style: 'arctic', h: 3.6 });
  B(90, 104, 8, 11, { style: 'arctic', h: 3.6 });
  B(58, 116, 8, 10, { style: 'arctic', h: 3.6 });
  B(71, 126, 12, 7, { style: 'arctic', h: 3.6, chest: true });
  P.skin = 'arctic';
  A(75, 108, 6, 6, 4.8, 'building', { dome: true });
  A(91, 120, 3, 3, 4.2, 'building', { tank: true });
  A(96.5, 120, 3, 3, 4.2, 'building', { tank: true });
  A(47, 110, 2.6, 5.6, 2.8, 'container', { box: true });
  A(86, 132, 3.6, 2, 2.3, 'container', { snowcat: true });
  P.skin = null;
  A(68, 110, 1.6, 1.6, 14, 'building', { mast: true });
  P.outdoorLoot(76, 114, 26, 6, 2);

  // ---- Ridge between the arctic and the farmland, two passes ---------------------------------------------------------
  P.region = 'arctic';
  ridgeLine(P, 2, 146, 100, 6, [[30, 38], [64, 72]], { ice: true, skin: 'arctic' }, 3.2);

  // ---- Harvest Farms (farmland, tier 2) --------------------------------------------------------------------------
  P.poi('farms', 'Harvest Farms', 60, 186, 32, 'farmland', 2);
  P.skin = 'harvest';
  B(34, 176, 10, 8, { style: 'farm', roof: 'gable' });
  B(52, 164, 16, 11, { h: 4.4, style: 'barn', roof: 'gable', split: false, furnish: 2, chest: true, doors: [['s', 0.5, 3.2], ['n', 0.5, 3.2], ['w', 0.5]] });
  B(78, 176, 12, 10, { h: 4, style: 'barn', roof: 'gable', doors: [['w', 0.5, 3], ['e', 0.5]] });
  A(74, 161, 3.4, 3.4, 7.5, 'building', { silo: true });
  A(77.4, 161, 3.4, 3.4, 7.5, 'building', { silo: true });
  A(46, 188, 2.4, 2.4, 2.7, 'container', { hay: true });
  A(52, 192, 1.6, 1.6, 1.25, 'crate', { bale: true });
  A(64, 184, 3.4, 1.9, 2.3, 'container', { tractor: true });
  A(90, 190, 4.6, 2.2, 2.4, 'container', { trailer: true });
  A(20, 166, 1.2, 24, 2.3, 'wall', { hedge: true });
  A(96, 158, 1.2, 12, 2.3, 'wall', { hedge: true });
  for (const z of [216, 219, 222, 225]) { A(36, z, 10, 0.5, 1.15, 'barrier', { vine: true }); A(50, z, 10, 0.5, 1.15, 'barrier', { vine: true }); }
  A(20, 214, 8, 5, 0, 'water', { pond: true });
  A(84, 214, 1.2, 10, 2.3, 'wall', { hedge: true });
  P.skin = null;
  P.zones.push({ x: 30, z: 214, w: 34, d: 14, kind: 'field' }, { x: 100, z: 160, w: 30, d: 30, kind: 'field' });
  P.outdoorLoot(60, 188, 32, 6, 2);

  // ---- Grain Co-op (farmland, tier 3) ---------------------------------------------------------------------------
  P.poi('coop', 'Grain Co-op', 128, 256, 18, 'farmland', 3);
  P.skin = 'harvest';
  A(116, 247, 6, 8, 9, 'building', { elevator: true });
  A(140, 250, 3.4, 3.4, 7.5, 'building', { silo: true });
  A(143.4, 250, 3.4, 3.4, 7.5, 'building', { silo: true });
  A(114, 262, 4.6, 2.2, 2.4, 'container', { trailer: true });
  P.skin = null;
  B(126, 244, 10, 7, { style: 'barn', roof: 'gable' });
  B(126, 260, 9, 7, { style: 'farm', roof: 'gable', chest: true });
  P.outdoorLoot(128, 256, 18, 4, 3);

  // ---- Radio Hill (farmland, tier 3) ----------------------------------------------------------------------------
  P.poi('radio', 'Radio Hill', 135, 152, 18, 'farmland', 3);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (k % 4 === 0) continue;                                     // Four ways up: north, east, south, west.
    A(135 + Math.cos(a) * 16 - 3.3, 152 + Math.sin(a) * 16 - 3.3, 6.6, 6.6, 3 + R() * 1.4, 'rock', { crag: true });
  }
  A(140, 146, 1.8, 1.8, 18, 'building', { mast: true });
  B(127, 150, 7, 6, { style: 'farm', doors: [['w', 0.5], ['e', 0.5]] });
  A(132, 160, 2.4, 1.6, 1.4, 'container', { generator: true });
  P.outdoorLoot(135, 152, 12, 3, 3);

  // ---- The canyon: rims with passes, the dam, the reservoir (desert, tier 2) ------------------------------------------
  P.poi('dam', 'Canyon Dam', 80, 322, 30, 'desert', 2);
  P.zones.push({ x: 0, z: 302, w: 150, d: 40, kind: 'riverbed' });
  ridgeLine(P, 0, 294, 134, 8, [[40, 48], [104, 112]], {}, 4.6, 302);
  ridgeLine(P, 0, 342, 140, 8, [[30, 38], [120, 128]], {}, 4.6, 'top');
  P.skin = 'desert';
  A(74, 302, 8, 14, 6, 'building', { dam: true });
  A(74, 319, 8, 6, 6, 'building', { dam: true, landmark: true });
  A(74, 328, 8, 14, 6, 'building', { dam: true });
  A(30, 310, 36, 22, 0, 'water', { reservoir: true });
  A(98, 322, 2.4, 2.4, 2.6, 'container', { tank: true });
  for (const [x, z] of [[56, 304], [24, 336], [110, 336], [128, 304], [140, 322]]) T(x, z, 1.8, 1.6, 1.1, 'boulder', {});
  P.skin = null;
  B(86, 306, 9, 7, { style: 'desert', chest: true });
  B(88, 330, 8, 7, { style: 'desert' });
  B(102, 310, 7, 6, { style: 'desert' });
  B(116, 326, 7, 6, { style: 'desert' });
  B(128, 310, 6, 6, { style: 'desert' });
  P.outdoorLoot(80, 322, 34, 6, 2);

  // ---- Quarry (desert, tier 3) ---------------------------------------------------------------------------------
  P.poi('quarry', 'Quarry', 26, 262, 18, 'desert', 3);
  A(4, 242, 26, 6, 5, 'rock', { crag: true });
  A(4, 248, 6, 26, 5, 'rock', { crag: true });
  B(16, 256, 10, 8, { style: 'industrial', h: 4 });
  B(36, 272, 7, 6, { style: 'industrial' });
  P.skin = 'foundry';
  A(28.6, 258, 8, 1.2, 1.1, 'barrier', { conveyor: true });
  P.skin = 'desert';
  A(36, 250, 3, 3, 1.4, 'boulder', {});
  A(41, 262, 3, 2.5, 1.4, 'boulder', {});
  P.skin = 'jungle';
  A(18, 270, 4.4, 2.2, 2.4, 'container', { truck: true });
  P.skin = null;
  P.outdoorLoot(26, 262, 18, 4, 3);

  // ---- Oasis Town (desert, tier 2) -----------------------------------------------------------------------------
  P.poi('oasis', 'Oasis Town', 154, 354, 28, 'desert', 2);
  P.skin = 'desert';
  A(147, 348, 10, 7, 0, 'water', { oasis: true });
  A(144.6, 348, 2.4, 2.4, 1.0, 'boulder', { palm: true });
  A(157, 352.6, 2.4, 2.4, 1.0, 'boulder', { palm: true });
  A(150, 340, 3, 2.4, 2.6, 'tent', {});
  A(158, 341, 1.8, 1.8, 1.4, 'rock', { landmark: true });
  P.skin = null;
  for (const [x, z, w, d] of [[136, 356, 8, 7], [134, 368, 9, 7], [148, 366, 8, 8], [160, 364, 9, 7], [166, 346, 8, 8], [162, 332, 8, 7], [148, 330, 9, 7], [177, 358, 7, 6], [174, 371, 8, 6]]) {
    B(x, z, w, d, { style: 'desert', h: 3.2 + R() * 0.6, chest: x === 148 && z === 366 });
  }
  P.skin = 'desert';
  T(140, 380, 6, 0.8, 1.2, 'barrier', {});
  T(186, 344, 0.8, 6, 1.2, 'barrier', {});
  P.skin = null;
  P.outdoorLoot(154, 354, 28, 6, 2);

  // ---- Airfield (desert, tier 2) -------------------------------------------------------------------------------
  P.poi('airfield', 'Airfield', 242, 326, 34, 'desert', 2);
  P.zones.push({ x: 196, z: 338, w: 96, d: 9, kind: 'runway' }, { x: 206, z: 318, w: 74, d: 20, kind: 'apron' });
  const hangar = { h: 6.2, style: 'hangar', split: false, furnish: 2, loot: 7, doors: [['s', 0.5, 6], ['n', 0.3], ['n', 0.7], ['w', 0.5], ['e', 0.5]] };
  B(208, 304, 22, 14, { ...hangar, chest: true });
  B(236, 304, 22, 14, hangar);
  B(266, 306, 7, 7, { h: 5.4, style: 'tower', doors: [['s', 0.5], ['w', 0.5]] });
  P.skin = 'desert';
  A(278, 298, 3, 3, 3, 'container', { tank: true });
  A(283.5, 298, 3, 3, 3, 'container', { tank: true });
  T(258, 326, 3, 1, 1.0, 'sandbag', {});
  T(226, 330, 1.6, 1.6, 1.1, 'crate', {});
  P.skin = 'jungle';
  A(214, 324, 6.4, 2.8, 2.8, 'container', { plane: true });
  A(244, 326, 6.4, 2.8, 2.8, 'container', { plane: true });
  P.skin = null;
  P.outdoorLoot(242, 326, 34, 8, 2);

  // ---- Jungle Temple (jungle, tier 1) --------------------------------------------------------------------------
  P.poi('temple', 'Jungle Temple', 348, 332, 30, 'jungle', 1);
  P.zones.push({ x: 329, z: 313, w: 38, d: 38, kind: 'court' });
  P.put(templeCourt(328, 312, 40, 40, 7));
  B(340, 324, 16, 16, {
    h: 4.4, style: 'temple', split: false, furnish: 0, chest: true, loot: 6,
    doors: [['n', 0.5], ['s', 0.5], ['w', 0.5], ['e', 0.5]],
    inside: () => { for (const [x, z] of [[344, 328], [350.8, 328], [344, 334.8], [350.8, 334.8]]) A(x, z, 1.2, 1.2, 3.4, 'rock', { ruin: 'pillar' }); },
  });
  B(372, 316, 7, 6, { style: 'temple', h: 3.6 });
  for (const [x, z] of [[333, 317], [362, 345], [334, 344.6], [361, 317]]) A(x, z, 2.4, 1.4, 1.0, 'boulder', { fallen: true });
  for (const [x, z] of [[322, 300], [376, 300], [380, 336], [322, 360], [372, 364], [352, 300]]) T(x, z, 2.2, 2.2, 4.6, 'rock', { tree: true });
  T(318, 340, 3.6, 3.4, 2.6, 'rock', { thicket: true });
  T(384, 352, 3.6, 3.4, 2.6, 'rock', { thicket: true });
  P.outdoorLoot(348, 332, 30, 8, 1);

  // ---- River Village (jungle, tier 2) --------------------------------------------------------------------------
  P.poi('village', 'River Village', 305, 250, 28, 'jungle', 2);
  for (const [x, z, w, d] of [[272, 228, 8, 6], [282, 236, 6, 5], [270, 256, 7, 6], [281, 262, 7, 6], [262, 240, 6, 6], [314, 228, 7, 6], [326, 234, 8, 6], [313, 258, 7, 6], [325, 262, 8, 6], [336, 248, 7, 6]]) {
    B(x, z, w, d, { style: 'jungle', h: 3.4, chest: x === 326 && z === 234 });
  }
  A(289.5, 230, 1, 3.4, 0.7, 'crate', { canoe: true });
  A(311.5, 266, 1, 3.4, 0.7, 'crate', { canoe: true });
  for (const z of [272, 275, 278]) A(330, z, 8, 1, 1.1, 'barrier', { crop: true });
  for (const [x, z] of [[264, 270], [300, 222], [342, 232], [340, 266]]) T(x, z, 2.2, 2.2, 4.6, 'rock', { tree: true });
  P.outdoorLoot(305, 250, 28, 6, 2);

  // ---- The rest: open fields between the places, with sparse cover and the odd cache ------------------------------
  const field = regionField(REGION_SEEDS);
  scatter(P, field);

  // The edge of the world, in tile-sized lengths so the renderer can stream it.
  P.region = 'farmland';
  for (let s = 0; s < W; s += 32) {
    const len = Math.min(32, W - s);
    for (const [x, z, w, d] of [[s, -1.5, len, 1.5], [s, H, len, 1.5], [-1.5, s, 1.5, len], [W, s, 1.5, len]]) {
      P.region = field(x + w / 2, z + d / 2)[0];
      P.walls.push(wall(x, z, w, d, 4, 'border', { region: P.region }));
    }
  }

  // Supply caches out in the open, by cover, away from the places.
  P.region = 'farmland';
  const rnd = mulberry(77);
  let caches = 0;
  for (let tries = 0; tries < 4000 && caches < 10; tries++) {
    const x = 20 + rnd() * (W - 40), z = 20 + rnd() * (H - 40);
    if (P.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 20) || P.chests.some(c => Math.hypot(c.x - x, c.z - z) < 50)) continue;
    if (!P.open(x, z, 1.0) || P.near(x - 0.01, z - 0.01, 0.02, 0.02, 2.2).size === 0) continue;
    P.chests.push({ x: +x.toFixed(2), z: +z.toFixed(2), tier: 3, indoor: false });
    caches++;
  }

  // Every place gets its supply caches (tier 1 three, tier 2 two, tier 3 one), from its indoor loot spots.
  for (const p of P.pois) {
    const want = 4 - p.tier;
    let have = P.chests.filter(c => Math.hypot(c.x - p.x, c.z - p.z) < p.r + 4).length;
    const pool = P.loot.filter(l => l.indoor && Math.hypot(l.x - p.x, l.z - p.z) < p.r + 4);
    while (have < want && pool.length) {
      const l = pool.splice(Math.floor(R() * pool.length), 1)[0];
      if (P.chests.some(c => Math.hypot(c.x - l.x, c.z - l.z) < 8)) continue;
      P.loot.splice(P.loot.indexOf(l), 1);
      P.chests.push({ x: l.x, z: l.z, tier: l.tier, indoor: true });
      have++;
    }
  }

  // ---- What every map has: spawns (a test Team Deathmatch on this map), lanes, waypoints -----------------------------
  const spot = (x, z) => {
    for (let r = 0; r < 20; r += 0.5) for (let a = 0; a < 6.28; a += 0.4) {
      const px = +(x + Math.cos(a) * r).toFixed(1), pz = +(z + Math.sin(a) * r).toFixed(1);
      if (P.open(px, pz, 1.2) && !P.roofAt(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  };
  const west = ['ship', 'polar', 'farms', 'quarry', 'dam', 'coop', 'radio', 'mill'];
  const spawns = [[], []];
  for (const p of P.pois) {
    const team = west.includes(p.id) ? 0 : 1;
    for (const k of [0, 1]) { const s = spot(p.x + (k ? 4 : -4), p.z + p.r * 0.5); spawns[team].push({ ...s, aim: team ? Math.PI : 0 }); }
  }
  const nav = P.pois.map(p => spot(p.x, p.z)).concat(bridges.map(b => ({ x: +(b.x + b.w / 2).toFixed(1), z: b.z + 4 })));
  const lanes = [{ id: 'north', z: 60 }, { id: 'northmid', z: 130 }, { id: 'mid', z: 205 }, { id: 'southmid', z: 270 }, { id: 'south', z: 345 }];

  // Where the final circles may end: the places, by tier, and some open ground between them.
  const circleBias = P.pois.map(p => ({ x: p.x, z: p.z, w: p.tier === 1 ? 1 : p.tier === 2 ? 0.8 : 0.5 }))
    .concat([[110, 120], [160, 290], [270, 160], [250, 370], [330, 190]].map(([x, z]) => ({ x, z, w: 0.4 })));

  return {
    id: 'frontier', name: 'Frontier', theme: 'frontier', size: 'giant', region: 'mixed', width: W, height: H,
    walls: P.walls, spawns, lanes, nav, points: { dom: [], hard: [] },
    rooms: P.rooms, roofs: P.roofs, zones: P.zones, roads: P.roads, rails: P.rails, regionSeeds: REGION_SEEDS,
    modes: ['br'], large: true,
    br: { pois: P.pois, loot: P.loot, chests: P.chests, drop: null, circleBias },
  };
}

function regionOfRiver(z) { return z < 30 ? 'coast' : z < 150 ? 'industrial' : z < 220 ? 'metro' : 'jungle'; }

// A ridge of rock from x0 to x1 along z (depth d), broken by passes [[a, b], ...]. Touching pieces of varied height;
// `flush` lines the pieces' far edge up on that z instead (a canyon rim with an even inner face).
function ridgeLine(P, x0, z, x1, d, passes, extra, h = 4.6, flush = null) {
  let x = x0;
  while (x < x1 - 0.5) {
    const pass = passes.find(([a, b]) => x >= a - 0.01 && x < b);
    if (pass) { x = pass[1]; continue; }
    const next = passes.filter(([a]) => a > x).reduce((m, [a]) => Math.min(m, a), x1);
    let len = Math.min(next - x, 8 + P.rnd() * 6);
    if (next - x - len < 3) len = next - x;
    const dd = d - P.rnd() * 2;
    const zz = flush === 'top' ? z : flush != null ? flush - dd : z + (d - dd) / 2;
    P.add(x, zz, len, dd, h + P.rnd() * 1.6, 'rock', { crag: true, ...extra });
    x += len;
  }
}

// Sparse cover in the open: a cluster every so often on a jittered grid, in the style of the region it falls in,
// kept off the roads, the rivers and the places themselves.
function scatter(P, field) {
  const rnd = mulberry(901);
  const STEP = 15;
  const near = (x, z) => P.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 4);
  const onRoad = (x, z, m) => P.roads.some(r => {
    for (let i = 1; i < r.pts.length; i++) if (segDist(x, z, ...r.pts[i - 1], ...r.pts[i]) < r.w / 2 + m) return true;
    return false;
  });
  const KIT = {
    arctic: [
      () => ['rock', 2.4 + rnd(), 2.4 + rnd(), 2.6, { ice: true, skin: 'arctic' }],
      () => (rnd() < 0.5 ? ['sandbag', 6, 1, 1.0, { ridge: true, skin: 'arctic' }] : ['sandbag', 1, 6, 1.0, { ridge: true, skin: 'arctic' }]),
      () => ['container', 2.6, 5.6, 2.8, { box: true, skin: 'arctic' }],
    ],
    industrial: [
      () => (rnd() < 0.5 ? ['container', 6, 2.5, 2.6, {}] : ['container', 2.5, 6, 2.6, {}]),
      () => ['crate', 1.6, 1.6, 1.1, {}],
      () => (rnd() < 0.5 ? ['barrier', 3, 0.8, 0.9, {}] : ['barrier', 0.8, 3, 0.9, {}]),
      () => ['container', 2.6, 2.6, 2.5, { slab: true, skin: 'foundry' }],
    ],
    coast: [
      () => ['boulder', 2 + rnd(), 1.6 + rnd(), 1.2, { crag: true }],
      () => ['rock', 3 + rnd() * 2, 3 + rnd() * 2, 2.8, { crag: true }],
      () => ['barrier', 3.2, 1.6, 0.9, { dinghy: true, skin: 'pier' }],
    ],
    farmland: [
      () => (rnd() < 0.5 ? ['wall', 7 + rnd() * 4, 1.2, 2.3, { hedge: true, skin: 'harvest' }] : ['wall', 1.2, 7 + rnd() * 4, 2.3, { hedge: true, skin: 'harvest' }]),
      () => ['crate', 1.6, 1.6, 1.25, { bale: true, skin: 'harvest' }],
      () => ['container', 2.4, 2.4, 2.7, { hay: true, skin: 'harvest' }],
      () => (rnd() < 0.5 ? ['barrier', 6, 0.7, 1.0, { stone: true, skin: 'harvest' }] : ['barrier', 0.7, 6, 1.0, { stone: true, skin: 'harvest' }]),
    ],
    metro: [
      () => ['barrier', 4.2, 1.9, 1.4, { car: true, skin: 'metro' }],
      () => ['barrier', 3, 0.8, 1.0, { jersey: true, skin: 'metro' }],
      () => ['wall', 1, 1, 4.5, { tree: true, skin: 'metro' }],
      () => ['container', 6, 2.5, 2.6, {}],
    ],
    desert: [
      () => ['rock', 4 + rnd() * 4, 3 + rnd() * 3, 3.6 + rnd() * 1.4, { skin: 'desert' }],
      () => ['boulder', 1.8, 1.6, 1.1, { skin: 'desert' }],
      () => ['sandbag', 3, 1, 1.0, { skin: 'desert' }],
    ],
    jungle: [
      () => ['rock', 2.2, 2.2, 4.6, { tree: true, skin: 'jungle' }],
      () => ['rock', 3.4, 3, 2.6, { thicket: true, skin: 'jungle' }],
      () => ['boulder', 2.6, 1.3, 1.0, { fern: true, skin: 'jungle' }],
      () => ['boulder', 2.8, 1, 0.9, { log: true, skin: 'jungle' }],
    ],
  };
  for (let gz = 8; gz < P.H - 8; gz += STEP) {
    for (let gx = 8; gx < P.W - 8; gx += STEP) {
      const cx = gx + rnd() * STEP * 0.8, cz = gz + rnd() * STEP * 0.8;
      if (near(cx, cz) || rnd() < 0.3) continue;
      const region = field(cx, cz)[0];
      P.region = region; P.tier = 3;
      const kit = KIT[region];
      const n = 1 + Math.floor(rnd() * 3);
      let placed = 0;
      for (let k = 0; k < n; k++) {
        const [kind, w, d, h, extra] = kit[Math.floor(rnd() * kit.length)]();
        const x = cx + (rnd() - 0.5) * 8, z = cz + (rnd() - 0.5) * 8;
        if (onRoad(x + w / 2, z + d / 2, Math.max(w, d) / 2 + 1)) continue;
        if (!P.free(x, z, w, d, 2.2)) continue;
        P.add(x, z, w, d, h, kind, extra);
        placed++;
      }
      if (placed && rnd() < 0.3) P.outdoorLoot(cx, cz, 5, 1, 3);
    }
  }
}

export default build();
