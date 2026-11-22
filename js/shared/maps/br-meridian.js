// Battle royale (docs/DISTRICTS.md): Meridian City, 400 x 400 m, the first region. Four districts, each a 6v6 map of
// its own built to fit the city, are placed edge to edge along the boulevard and joined by the city's streets, with
// the rest of the city built round them:
//   Old Quarter (oldquarter)   brownstones round Fountain Square, west of the centre
//   Midtown (midtown)          the centre: towers either side of Monument Plaza
//   Canal Row (canalrow)       warehouses either side of the canal and its three bridges, east of the centre
//   Union Square (unionsq)     the square and its bandstand, south of Midtown
// The middle lane of the first three is the city's boulevard (z 200), from the west edge to the waterfront. Round
// them: the Rail Depot, Uptown and Gallery Row (north), the Ferry Terminal and the Docks on the east shore, City Hall,
// The Exchange, Mercy Hospital, Meridian Park, Westgate, the Stadium, Southside and Chapel Row, the Power Station.
// The district files are the source of truth (js/shared/maps/region-kit.js placeDistrict); nothing here changes them.
// Contract: docs/BR.md. Dressed by the giant-world streamer (js/render/themes/frontier.js) with the city's palette and
// extras (js/render/themes/city.js).
import { wall } from './build.js';
import { Plan, mulberry, segDist } from './br-kit.js';
import { placeDistrict, cityBlock, pruneUnreachable } from './region-kit.js';
import midtown from './midtown.js';
import oldquarter from './oldquarter.js';
import canalrow from './canalrow.js';
import unionsq from './unionsq.js';

const W = 400, H = 400;

// Where each district sits (north-west corner, region metres). The first three share the boulevard at z 200 (their
// middle lanes), with 12 m streets between them; Union Square sits south of Midtown across Union Street.
export const DISTRICTS = {
  oldquarter: { x: 58, z: 177 },
  midtown: { x: 146, z: 168 },
  canalrow: { x: 266, z: 176 },
  unionsq: { x: 172, z: 258 },
};

// Ground regions for the renderer: [region, x, z, bias] (themes/city.js colours them).
export const REGION_SEEDS = [
  ['city', 200, 200, 30], ['city', 90, 200], ['city', 330, 200], ['city', 218, 44], ['city', 218, 350], ['city', 330, 124], ['city', 330, 276],
  ['city', 84, 124], ['city', 84, 300],
  ['yard', 70, 40], ['yard', 30, 60], ['yard', 70, 372], ['yard', 20, 380],
  ['quay', 378, 40], ['quay', 378, 140], ['quay', 378, 250], ['quay', 360, 360], ['quay', 385, 390],
];

// Streets: polylines with a width (asphalt). They stop at the district edges: inside a district its own street zones
// are the road. The boulevard (z 200) runs through all three of the middle districts.
const ROADS = [
  // East-west.
  { pts: [[0, 94], [366, 94]], w: 10, kind: 'asphalt' },                 // North Street.
  { pts: [[0, 154], [366, 154]], w: 10, kind: 'asphalt' },               // Park Row.
  { pts: [[0, 248], [366, 248]], w: 10, kind: 'asphalt' },               // Union Street.
  { pts: [[144, 304], [366, 304]], w: 10, kind: 'asphalt' },             // South Street.
  { pts: [[0, 200], [58, 200]], w: 7, kind: 'asphalt' },                 // The boulevard, west of the Old Quarter...
  { pts: [[134, 200], [146, 200]], w: 7, kind: 'asphalt' },              // ...across to Midtown...
  { pts: [[254, 200], [266, 200]], w: 7, kind: 'asphalt' },              // ...on to Canal Row...
  { pts: [[346, 200], [366, 200]], w: 7, kind: 'asphalt' },              // ...and out to the quay.
  { pts: [[149, 44], [288, 44]], w: 8, kind: 'asphalt' },                // Uptown's cross street.
  { pts: [[149, 352], [288, 352]], w: 8, kind: 'asphalt' },              // Southside's.
  // North-south.
  { pts: [[24, 0], [24, 400]], w: 10, kind: 'asphalt' },                 // West Avenue.
  { pts: [[140, 0], [140, 400]], w: 8, kind: 'asphalt' },                // Seam Street: between the Old Quarter and Midtown.
  { pts: [[260, 154], [260, 248]], w: 8, kind: 'asphalt' },              // Canal Street: between Midtown and Canal Row.
  { pts: [[292, 0], [292, 172]], w: 8, kind: 'asphalt' },                // East Avenue, north of Canal Row...
  { pts: [[292, 228], [292, 400]], w: 8, kind: 'asphalt' },              // ...and south of it.
  { pts: [[368, 0], [368, 400]], w: 8, kind: 'asphalt' },                // The quay road.
  { pts: [[218, 0], [218, 89]], w: 8, kind: 'asphalt' },                 // Uptown's avenue.
  { pts: [[218, 309], [218, 400]], w: 8, kind: 'asphalt' },              // Southside's.
];
// Rails into the depot (renderer: horizontal lines, sleepers and two rails).
const RAILS = [{ pts: [[-30, 28], [134, 28]] }, { pts: [[-30, 33], [134, 33]] }, { pts: [[-30, 70], [80, 70]] }];

function build() {
  const P = new Plan(W, H, 1122);
  const R = P.rnd;
  const B = (x, z, w, d, o) => P.building(x, z, w, d, o);
  const A = (x, z, w, d, h, kind, extra = {}) => P.add(x, z, w, d, h, kind, extra);
  P.roads = ROADS; P.rails = RAILS;
  P.keepOut = [];
  // Every doorway built (district buildings and region ones), so street clutter never blocks one.
  P.doorPts = [];
  const building0 = P.building.bind(P);
  P.building = (...a) => { const r = building0(...a); P.doorPts.push(...r.doors); return r; };
  const onRoad = (x, z, w, d) => ROADS.some(rd => {
    for (let i = 1; i < rd.pts.length; i++) if (segDist(x + w / 2, z + d / 2, ...rd.pts[i - 1], ...rd.pts[i]) < rd.w / 2 + Math.max(w, d) / 2 + 0.5) return true;
    return false;
  });
  // Street clutter and cover: only where it leaves no narrow gap, keeps off every district (and its margin) and the
  // ground in front of every door, and (unless it is a parked vehicle) off the roads.
  const fits = (x, z, w, d, extra = {}, m = 1.6) => !P.keepOut.some(k => x < k.x + k.w && x + w > k.x && z < k.z + k.d && z + d > k.z)
    && !P.doorPts.some(([dx, dz]) => dx > x - 3.2 && dx < x + w + 3.2 && dz > z - 3.2 && dz < z + d + 3.2)
    && (extra.car || extra.bus || !onRoad(x, z, w, d)) && P.free(x, z, w, d, m);
  const T = (x, z, w, d, h, kind, extra = {}, m = 1.6) => (fits(x, z, w, d, extra, m) ? P.add(x, z, w, d, h, kind, extra) : null);
  const keep = (x, z, w, d, m = 3) => P.keepOut.push({ x: x - m, z: z - m, w: w + 2 * m, d: d + 2 * m });
  const districts = [];
  const art = { el: [], strings: [], crossings: [], trains: [] };
  const take = rec => {
    districts.push({ id: rec.id, name: rec.name, x: rec.x, z: rec.z, w: rec.w, h: rec.h });
    for (const k of ['strings', 'crossings', 'trains']) if (rec[k]) art[k].push(...rec[k]);
    if (rec.el) art.el.push(rec.el);
    P.zones.push(...rec.zones);
    return rec;
  };

  // ---- The sea along the east shore, with the piers -----------------------------------------------------------
  P.region = 'coast';
  const PIERS = [[30, 6], [60, 6], [118, 5], [326, 6], [356, 6], [380, 5]];       // [z, width]: walkable decks over the sea.
  let wz = 0;
  for (const [pz, pw] of PIERS) {
    if (pz > wz) A(384, wz, 16, pz - wz, 0, 'water', { sea: true });
    A(396, pz, 4, pw, 0, 'water', { sea: true });                                 // Off the pier's end.
    P.rooms.push({ x: 384, z: pz, w: 12, d: pw, floor: 'pier' });
    wz = pz + pw;
  }
  A(384, wz, 16, H - wz, 0, 'water', { sea: true });
  P.zones.push({ x: 372, z: 0, w: 12, d: H, kind: 'quay' });

  // ---- The districts ------------------------------------------------------------------------------------------
  // Each is its 6v6 map placed as it is (border dropped, blocks opened up into buildings to loot), a tier 1 place
  // (Union Square, mostly open ground, tier 2) with loot out round its cover.
  const district = (id, map, name, poiX, poiZ, r, tier = 1) => {
    const at = DISTRICTS[id];
    P.poi(id, name, poiX, poiZ, r, 'metro', tier);
    take(placeDistrict(P, map, at.x, at.z, { skin: 'metro', id, name }));
    keep(at.x, at.z, map.width, map.height);
    P.outdoorLoot(at.x + map.width / 2, at.z + map.height / 2, Math.min(map.width, map.height) / 2, Math.round(map.width * map.height / 300), tier);
  };
  district('midtown', midtown, 'Midtown', 200, 200, 40);
  district('oldquarter', oldquarter, 'Old Quarter', 96, 200, 30);
  district('canalrow', canalrow, 'Canal Row', 306, 200, 30);
  district('unionsq', unionsq, 'Union Square', 200, 276, 22, 2);

  // ---- The Exchange (north of Midtown, between North Street and Park Row): the stock exchange and its blocks ----------
  P.poi('exchange', 'The Exchange', 218, 124, 30, 'metro', 2);
  B(196, 104, 44, 18, { h: 5.8, style: 'station', furnish: 2, chest: true, loot: 8, doors: [['s', 0.2], ['s', 0.5], ['s', 0.8], ['n', 0.3], ['n', 0.7], ['w', 0.5], ['e', 0.5]] });
  P.zones.push({ x: 184, z: 124, w: 68, d: 24, kind: 'plaza' });
  P.skin = 'metro';
  A(215, 132, 6, 5, 0, 'water', { fountain: true });
  for (const [x, z] of [[190, 128], [244, 128], [190, 142], [244, 142]]) A(x, z, 1, 1, 4.5, 'wall', { tree: true });
  for (const [x, z, w, d] of [[200, 140, 3.4, 1.2], [232, 140, 3.4, 1.2], [204, 128, 1.2, 3.4], [230, 128, 1.2, 3.4]]) A(x, z, w, d, 0.9, 'barrier', { planter: true });
  P.skin = null;
  cityBlock(P, 149, 99, 31, 50, { style: 'metro', tall: 0.45, rows: 1, lot: [10, 15] });
  cityBlock(P, 256, 99, 32, 50, { style: 'metro', tall: 0.45, rows: 1, lot: [10, 15] });
  P.outdoorLoot(218, 128, 28, 3, 2);

  // ---- Rail Depot (north-west) ----------------------------------------------------------------------------------
  P.poi('depot', 'Rail Depot', 78, 46, 40, 'industrial', 2);
  P.zones.push({ x: 0, z: 22, w: 139, d: 16, kind: 'ballast' }, { x: 0, z: 65, w: 84, d: 10, kind: 'ballast' });
  P.skin = 'foundry';
  for (const [x, z] of [[36, 26.7], [58, 26.7], [96, 31.7], [118, 26.7], [10, 31.7], [52, 68.7]]) A(x, z, 9, 2.6, 2.8, 'container', { wagon: true });
  P.skin = null;
  B(34, 42, 30, 16, { h: 6, style: 'industrial', split: false, furnish: 2, chest: true, loot: 9, doors: [['n', 0.25, 3], ['n', 0.75, 3], ['s', 0.3, 3], ['s', 0.75, 3], ['w', 0.5, 3], ['e', 0.5, 3]] });
  B(76, 42, 22, 14, { h: 5.4, style: 'industrial', split: false, furnish: 2, doors: [['n', 0.5, 3.5], ['s', 0.5, 3.5], ['w', 0.5], ['e', 0.5]] });
  B(106, 44, 12, 9, { style: 'industrial', h: 3.8 });
  B(112, 4, 14, 9, { style: 'industrial', h: 4, doors: [['s', 0.3], ['s', 0.75], ['w', 0.5]] });
  B(6, 44, 10, 12, { style: 'industrial', h: 3.8, doors: [['e', 0.5], ['n', 0.5]] });
  B(94, 72, 10, 8, { style: 'industrial', h: 3.6 });
  A(64, 6, 2.6, 2.6, 12, 'building', { stack: true, skin: 'foundry' });
  for (const [x, z, w, d] of [[40, 6, 6, 2.5], [40, 10, 6, 2.5], [88, 6, 2.5, 6], [6, 6, 6, 2.5], [120, 60, 2.5, 6], [36, 78, 6, 2.5], [60, 80, 6, 2.5]]) T(x, z, w, d, 2.6, 'container', {});
  for (const [x, z] of [[70, 12], [100, 16], [24, 62], [114, 72], [66, 60]]) T(x, z, 1.6, 1.6, 1.1, 'crate', {});
  P.outdoorLoot(78, 46, 40, 12, 2);

  // ---- Uptown (north): four blocks round its cross streets ------------------------------------------------------------
  const UP = { style: 'metro', tall: 0.45, yard: 0.1, lot: [10, 16] };
  P.poi('uptown', 'Uptown', 182, 46, 34, 'metro', 2);
  cityBlock(P, 149, 4, 65, 36, UP);
  cityBlock(P, 149, 48, 65, 41, UP);
  P.outdoorLoot(182, 46, 34, 3, 2);
  P.poi('gallery', 'Gallery Row', 255, 46, 34, 'metro', 2);
  cityBlock(P, 222, 4, 66, 36, UP);
  cityBlock(P, 222, 48, 66, 41, UP);
  P.outdoorLoot(255, 46, 34, 3, 2);

  // ---- Ferry Terminal (north-east shore) ------------------------------------------------------------------------
  P.poi('ferry', 'Ferry Terminal', 336, 46, 32, 'coast', 2);
  B(312, 26, 36, 16, { h: 5, style: 'station', split: true, furnish: 2, chest: true, loot: 8, doors: [['e', 0.3], ['e', 0.7], ['w', 0.5], ['n', 0.2], ['s', 0.2], ['s', 0.8]] });
  B(300, 6, 12, 9, { style: 'coast', h: 3.8 });
  B(348, 56, 12, 9, { style: 'coast', h: 3.8 });
  B(300, 60, 14, 10, { style: 'metro', h: 4.2 });
  P.zones.push({ x: 300, z: 46, w: 44, d: 10, kind: 'lot' });
  for (const x of [304, 310, 316, 328, 334]) T(x, 48, 1.9, 4.2, 1.4, 'barrier', { car: true, skin: 'metro' }, 1.2);
  // The ferry, moored along the pier at z 60.
  P.skin = 'arctic';
  A(386, 40, 9, 3, 3, 'hull', { plate: true, end: true, bow: 1 });
  A(386, 43, 0.9, 14, 3, 'hull', { plate: true });
  A(394.1, 43, 0.9, 14, 3, 'hull', { plate: true });
  A(388, 46, 5, 6, 4.2, 'building', { deckhouse: true });
  P.skin = 'pier';
  for (const [x, z] of [[358, 20], [362, 30], [356, 76]]) T(x, z, 2.2, 3, 2.5, 'container', { fishbox: true });
  for (const [x, z] of [[376, 12], [376, 84], [376, 104]]) T(x, z, 1.6, 1.6, 1.15, 'crate', { pots: true });
  P.skin = null;
  P.outdoorLoot(336, 46, 32, 8, 2);

  // ---- City Hall (east, between North Street and Park Row) ---------------------------------------------------------
  P.poi('cityhall', 'City Hall', 330, 124, 28, 'metro', 1);
  P.zones.push({ x: 298, z: 100, w: 66, d: 48, kind: 'plaza' });
  B(312, 102, 36, 18, { h: 5.6, style: 'station', furnish: 2, chest: true, loot: 8, doors: [['s', 0.2], ['s', 0.5], ['s', 0.8], ['n', 0.3], ['n', 0.7], ['w', 0.5], ['e', 0.5]] });
  B(300, 130, 12, 14, { style: 'metro', h: 4.4 });
  B(350, 130, 12, 14, { style: 'metro', h: 4.4 });
  P.skin = 'metro';
  A(327, 130, 6, 5, 0, 'water', { fountain: true });
  A(329, 136.5, 2, 2, 3, 'wall', { statue: true });
  for (const [x, z] of [[316, 126], [342, 126], [316, 142], [342, 142]]) A(x, z, 1, 1, 4.5, 'wall', { tree: true });
  for (const [x, z, w, d] of [[320, 124, 3.4, 1.2], [336, 124, 3.4, 1.2], [320, 144, 3.4, 1.2], [336, 144, 3.4, 1.2]]) A(x, z, w, d, 0.9, 'barrier', { planter: true });
  P.skin = null;
  P.outdoorLoot(330, 128, 26, 6, 1);

  // ---- Meridian Park (west, between North Street and Park Row) ---------------------------------------------------
  P.poi('park', 'Meridian Park', 80, 124, 36, 'metro', 3);
  P.zones.push({ x: 4, z: 100, w: 135, d: 48, kind: 'park' });
  B(94, 116, 10, 8, { style: 'coast', h: 3.6, chest: true, doors: [['e', 0.5], ['n', 0.5]] });      // The boathouse.
  B(30, 126, 9, 8, { style: 'metro', h: 3.6 });                                                       // The cafe.
  B(120, 102, 8, 7, { style: 'metro', h: 3.4 });
  P.skin = 'metro';
  A(64, 114, 26, 14, 0, 'water', { pond: true });
  for (let k = 0; k < 34; k++) {
    const x = 6 + R() * 130, z = 101 + R() * 44;
    T(x, z, 1, 1, 4.5, 'wall', { tree: true }, 2.2);
  }
  for (const [x, z, w, d] of [[40, 104, 0.8, 8], [104, 136, 0.8, 8], [44, 140, 9, 0.8], [96, 104, 9, 0.8], [20, 120, 0.8, 9], [124, 118, 0.8, 9]]) T(x, z, w, d, 1.1, 'barrier', { hedge: true });
  for (const [x, z] of [[58, 110], [92, 132], [60, 132], [94, 110]]) T(x, z, 2.2, 0.6, 0.9, 'barrier', { bench: true }, 1.2);
  P.skin = null;
  P.outdoorLoot(80, 124, 40, 5, 3);

  // ---- Westgate (west of the Old Quarter), and the blocks round the middle districts ---------------------------------
  P.poi('westgate', 'Westgate', 30, 200, 24, 'metro', 3);
  cityBlock(P, 2, 160, 17, 34, { style: 'metro', tall: 0.2, rows: 1 });
  cityBlock(P, 2, 206, 17, 37, { style: 'metro', tall: 0.2, rows: 1 });
  cityBlock(P, 31, 160, 24, 34, { style: 'brownstone', tall: 0.3, rows: 1, lot: [9, 13] });
  cityBlock(P, 31, 206, 24, 37, { style: 'brownstone', tall: 0.3, rows: 1, lot: [9, 13] });
  P.outdoorLoot(30, 200, 24, 2, 3);
  P.region = 'metro'; P.tier = 2;
  cityBlock(P, 58, 159, 76, 15, { style: 'brownstone', tall: 0.35, rows: 1, lot: [9, 13] });
  cityBlock(P, 58, 226, 76, 17, { style: 'brownstone', tall: 0.35, rows: 1, lot: [9, 13] });
  cityBlock(P, 266, 159, 22, 13.5, { style: 'industrial', tall: 0.3, rows: 1, lot: [9, 12] });
  cityBlock(P, 296, 159, 50, 13.5, { style: 'industrial', tall: 0.3, rows: 1, lot: [9, 12] });
  cityBlock(P, 266, 227.5, 22, 15.5, { style: 'industrial', tall: 0.3, rows: 1, lot: [9, 12] });
  cityBlock(P, 296, 227.5, 50, 15.5, { style: 'industrial', tall: 0.3, rows: 1, lot: [9, 12] });
  cityBlock(P, 349, 175, 15, 20, { style: 'coast', tall: 0.2, rows: 1, lot: [8, 11] });
  cityBlock(P, 349, 205, 15, 20, { style: 'coast', tall: 0.2, rows: 1, lot: [8, 11] });

  // ---- Union Square's flanking blocks -------------------------------------------------------------------------
  P.tier = 2;
  cityBlock(P, 149, 253, 20, 46, { style: 'metro', tall: 0.4, rows: 1, lot: [10, 15] });
  cityBlock(P, 231, 253, 57, 46, { style: 'metro', tall: 0.4, lot: [10, 15] });

  // ---- Mercy Hospital (south-east of Downtown) -----------------------------------------------------------------
  P.poi('hospital', 'Mercy Hospital', 330, 276, 26, 'metro', 2);
  B(302, 256, 22, 18, { h: 5.2, style: 'station', furnish: 2, chest: true, loot: 7, doors: [['s', 0.3], ['s', 0.7], ['n', 0.5], ['e', 0.5]] });
  B(334, 256, 18, 14, { h: 4.6, style: 'station', furnish: 2, doors: [['s', 0.5], ['w', 0.5], ['n', 0.5]] });
  B(334, 280, 24, 12, { h: 4.4, style: 'metro', doors: [['n', 0.3], ['n', 0.7], ['w', 0.5], ['s', 0.5]] });
  P.zones.push({ x: 300, z: 280, w: 26, d: 16, kind: 'helipad' });
  P.skin = 'metro';
  T(304, 286, 4.2, 1.9, 1.4, 'barrier', { car: true });
  T(316, 284, 4.2, 1.9, 1.4, 'barrier', { car: true });
  P.skin = null;
  P.outdoorLoot(330, 276, 26, 6, 2);

  // ---- Stadium (south-west) ----------------------------------------------------------------------------------------
  P.poi('stadium', 'Stadium', 84, 300, 44, 'metro', 2);
  // The stands are long buildings round the pitch (the concourse inside them), the corners and the middle of the
  // ends open for the tunnels.
  B(44, 262, 80, 9, { h: 5.4, style: 'station', furnish: 2, chest: true, doors: [['s', 0.2], ['s', 0.5], ['s', 0.8], ['n', 0.3], ['n', 0.7]] });
  B(44, 333, 80, 9, { h: 5.4, style: 'station', furnish: 2, doors: [['n', 0.2], ['n', 0.5], ['n', 0.8], ['s', 0.3], ['s', 0.7]] });
  B(34, 276, 9, 22, { h: 5, style: 'station', doors: [['e', 0.5], ['w', 0.3], ['w', 0.7]] });
  B(34, 306, 9, 22, { h: 5, style: 'station', doors: [['e', 0.5], ['w', 0.3], ['w', 0.7]] });
  B(125, 276, 9, 22, { h: 5, style: 'station', doors: [['w', 0.5], ['e', 0.3], ['e', 0.7]] });
  B(125, 306, 9, 22, { h: 5, style: 'station', doors: [['w', 0.5], ['e', 0.3], ['e', 0.7]] });
  P.zones.push({ x: 50, z: 276, w: 68, d: 52, kind: 'pitch' });
  P.skin = 'metro';
  for (const [x, z, w, d] of [[52, 298, 0.8, 7], [115.2, 298, 0.8, 7]]) A(x, z, w, d, 2.2, 'barrier', { goal: true, jersey: true });
  for (const [x, z, w, d] of [[70, 280, 6, 0.8], [92, 323, 6, 0.8], [66, 300, 3, 1.2], [99, 302, 3, 1.2], [82, 290, 1.2, 3], [84, 312, 1.2, 3]]) T(x, z, w, d, 1.0, 'barrier', { jersey: true }, 1.4);
  for (const [x, z] of [[78, 300], [88, 305]]) T(x, z, 2.4, 2.4, 2.6, 'container', { stage: true }, 1.4);
  P.skin = null;
  P.outdoorLoot(84, 302, 30, 10, 2);

  // ---- Southside and Chapel Row (south): brownstones round their cross streets ---------------------------------------------------------
  const OLD = { style: 'brownstone', tall: 0.35, yard: 0.15, lot: [9, 13], h: [3.6, 4.4], towerH: [4.6, 6], towerSkin: 'metro' };
  P.poi('southside', 'Southside', 182, 352, 34, 'metro', 2);
  cityBlock(P, 149, 309, 65, 39, OLD);
  cityBlock(P, 149, 356, 65, 40, OLD);
  P.outdoorLoot(182, 352, 34, 3, 2);
  P.poi('chapel', 'Chapel Row', 255, 352, 34, 'metro', 3);
  cityBlock(P, 222, 309, 66, 39, OLD);
  cityBlock(P, 222, 356, 66, 40, OLD);
  P.outdoorLoot(255, 352, 34, 3, 3);

  // ---- The Docks (south-east shore) ----------------------------------------------------------------------------------
  P.poi('docks', 'Waterfront Docks', 336, 354, 36, 'coast', 2);
  P.zones.push({ x: 296, z: 309, w: 88, d: 87, kind: 'dock' });
  B(300, 312, 26, 14, { h: 5.6, style: 'industrial', split: false, furnish: 2, chest: true, loot: 8, doors: [['s', 0.25, 3.5], ['s', 0.75, 3.5], ['n', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(334, 312, 26, 14, { h: 5.6, style: 'industrial', split: false, furnish: 2, loot: 8, doors: [['s', 0.25, 3.5], ['s', 0.75, 3.5], ['n', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(300, 372, 22, 12, { h: 5, style: 'industrial', split: false, furnish: 2, doors: [['n', 0.3, 3.5], ['n', 0.75, 3.5], ['e', 0.5], ['s', 0.5]] });
  B(330, 384, 10, 8, { style: 'coast', h: 3.6 });
  // A row of containers end to end (touching: no slot between them), placed only where the whole row fits.
  const stack = (x, z, along, n) => {
    const w = along ? 6 * n : 2.5, d = along ? 2.5 : 6 * n;
    if (!fits(x, z, w, d)) return;
    for (let k = 0; k < n; k++) A(along ? x + k * 6 : x, along ? z : z + k * 6, along ? 6 : 2.5, along ? 2.5 : 6, 2.6, 'container', {});
  };
  stack(304, 336, true, 3); stack(304, 342, true, 2); stack(332, 340, true, 3); stack(346, 362, false, 3); stack(302, 352, true, 2);
  P.skin = 'foundry';
  for (const [x, z] of [[372, 330], [378, 330], [372, 346], [378, 346]]) A(x, z, 1.2, 1.2, 6, 'crane', { gantry: true });
  P.skin = null;
  for (const [x, z] of [[328, 356], [356, 330], [316, 364], [340, 374]]) T(x, z, 1.6, 1.6, 1.1, 'crate', {});
  P.outdoorLoot(336, 352, 36, 10, 2);

  // ---- Power Station (south-west corner) -------------------------------------------------------------------------
  P.poi('power', 'Power Station', 74, 374, 30, 'industrial', 3);
  P.zones.push({ x: 2, z: 350, w: 137, d: 48, kind: 'ballast' });
  B(40, 360, 30, 16, { h: 6.2, style: 'industrial', split: false, furnish: 2, chest: true, loot: 8, doors: [['n', 0.3, 3], ['n', 0.75, 3], ['s', 0.5, 3], ['w', 0.5], ['e', 0.5]] });
  B(84, 362, 14, 10, { style: 'industrial', h: 4 });
  B(8, 356, 12, 10, { style: 'industrial', h: 3.8, doors: [['e', 0.5], ['s', 0.5]] });
  A(76, 382, 2.8, 2.8, 16, 'building', { stack: true, skin: 'foundry' });
  A(84, 382, 2.8, 2.8, 14, 'building', { stack: true, skin: 'foundry' });
  for (const [x, z] of [[106, 358], [114, 358], [106, 368], [114, 368], [122, 358], [122, 368]]) T(x, z, 2.4, 2.4, 2.4, 'container', { slab: true, skin: 'foundry' }, 1.4);
  for (const [x, z] of [[24, 380], [56, 384], [120, 386]]) T(x, z, 1.6, 1.6, 1.1, 'crate', {});
  P.outdoorLoot(74, 372, 30, 6, 3);

  // ---- The rest of the west: a strip of small blocks on West Avenue's far side -------------------------------------
  P.region = 'metro'; P.tier = 3;
  cityBlock(P, 2, 253, 17, 92, { style: 'brownstone', tall: 0.4, rows: 1, lot: [10, 14] });

  // ---- Street clutter: parked cars along the kerbs, kiosks, trees ----------------------------------------------------
  P.region = 'metro'; P.skin = 'metro';
  const rnd = mulberry(5150);
  for (const rd of ROADS) {
    const [[ax, az], [bx, bz]] = [rd.pts[0], rd.pts[rd.pts.length - 1]];
    const horiz = Math.abs(bz - az) < Math.abs(bx - ax), L = Math.hypot(bx - ax, bz - az);
    for (let s = 6; s < L - 6; s += 9 + rnd() * 14) {
      if (rnd() < 0.4) continue;
      const side = rnd() < 0.5 ? -1 : 1, off = rd.w / 2 - 1.3;
      const px = horiz ? ax + s : ax + side * off, pz = horiz ? az + side * off : az + s;
      if (rnd() < 0.12) { T(horiz ? px - 4.75 : px - 1.3, horiz ? pz - 1.3 : pz - 4.75, horiz ? 9.5 : 2.6, horiz ? 2.6 : 9.5, 3.2, 'container', { bus: true }, 1.2); continue; }
      T(horiz ? px - 2.1 : px - 0.95, horiz ? pz - 0.95 : pz - 2.1, horiz ? 4.2 : 1.9, horiz ? 1.9 : 4.2, 1.4, 'barrier', { car: true }, 1.2);
    }
  }
  P.skin = null;

  // The edge of the city: border walls in tile-sized lengths (the renderer streams them), open to the sea in the east.
  for (let s = 0; s < W; s += 32) {
    const len = Math.min(32, W - s);
    for (const [x, z, w, d, open] of [[s, -1.5, len, 1.5, s >= 384], [s, H, len, 1.5, s >= 384], [-1.5, s, 1.5, len, false], [W, s, 1.5, len, true]]) {
      P.walls.push(wall(x, z, w, d, 4, 'border', { region: 'metro', ...(open ? { open: true } : {}) }));
    }
  }

  // Nothing a bot cannot walk to (a corner pocket behind furniture): flooded from the boulevard by the Seam.
  pruneUnreachable(P, 144, 200);

  // Supply caches out on the streets, by cover, away from the places.
  P.region = 'metro';
  const crnd = mulberry(91);
  let caches = 0;
  for (let tries = 0; tries < 4000 && caches < 8; tries++) {
    const x = 20 + crnd() * (W - 60), z = 20 + crnd() * (H - 40);
    if (P.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 10) || P.chests.some(c => Math.hypot(c.x - x, c.z - z) < 50)) continue;
    if (!P.open(x, z, 1.0) || P.roofAt(x, z) || P.near(x - 0.01, z - 0.01, 0.02, 0.02, 2.2).size === 0) continue;
    P.chests.push({ x: +x.toFixed(2), z: +z.toFixed(2), tier: 3, indoor: false });
    caches++;
  }
  // Every place gets its caches (tier 1 three, tier 2 two, tier 3 one), from its indoor loot spots.
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

  // ---- What every map has: spawns (a test Team Deathmatch on this map), lanes, waypoints ---------------------------
  const spot = (x, z) => {
    for (let r = 0; r < 24; r += 0.5) for (let a = 0; a < 6.28; a += 0.4) {
      const px = +(x + Math.cos(a) * r).toFixed(1), pz = +(z + Math.sin(a) * r).toFixed(1);
      if (P.open(px, pz, 1.2) && !P.roofAt(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  };
  const spawns = [[], []];
  for (const p of P.pois) {
    const team = p.x < 200 ? 0 : 1;
    for (const k of [0, 1]) { const s = spot(p.x + (k ? 5 : -5), p.z + p.r * 0.5); spawns[team].push({ ...s, aim: team ? Math.PI : 0 }); }
  }
  const nav = P.pois.map(p => spot(p.x, p.z));
  const lanes = [{ id: 'north', z: 94 }, { id: 'park', z: 154 }, { id: 'mid', z: 200 }, { id: 'union', z: 248 }, { id: 'south', z: 304 }];

  const circleBias = P.pois.map(p => ({ x: p.x, z: p.z, w: p.tier === 1 ? 1 : p.tier === 2 ? 0.8 : 0.5 }))
    .concat([[144, 154], [292, 248], [144, 304], [292, 94], [24, 120]].map(([x, z]) => ({ x, z, w: 0.4 })));
  // Rebound's compact areas: over the middle districts, the north and the south of the city.
  const reboundAreas = [{ x: 200, z: 200, r: 150 }, { x: 150, z: 150, r: 150 }, { x: 250, z: 250, r: 150 }, { x: 250, z: 150, r: 150 }];

  // Large-mode hook (docs/DISTRICTS.md, Conquest and Breakthrough on branch bfmodes): a flag per district and per big
  // region place, grouped west to east into sectors for a push.
  const flag = (id, name, x, z, r, district) => ({ id, name, ...spot(x, z), r, district });
  const bf = {
    flags: [
      flag('A', 'Old Quarter', 96, 200, 5, 'oldquarter'), flag('B', 'Meridian Park', 80, 124, 6, null), flag('C', 'Stadium', 84, 300, 6, null),
      flag('D', 'The Exchange', 218, 128, 6, null), flag('E', 'Midtown', 200, 200, 6, 'midtown'), flag('F', 'Union Square', 200, 276, 5, 'unionsq'),
      flag('G', 'City Hall', 330, 128, 6, null), flag('H', 'Canal Row', 306, 200, 4, 'canalrow'), flag('I', 'Mercy Hospital', 330, 276, 6, null),
    ],
    sectors: [
      { id: 'west', name: 'West Side', flags: ['A', 'B', 'C'], rect: { x: 0, z: 89, w: 144, d: 260 } },
      { id: 'centre', name: 'Midtown', flags: ['D', 'E', 'F'], rect: { x: 144, z: 89, w: 148, d: 215 } },
      { id: 'east', name: 'Waterfront', flags: ['G', 'H', 'I'], rect: { x: 292, z: 89, w: 108, d: 215 } },
    ],
  };

  return {
    id: 'meridian', name: 'Meridian City', theme: 'city', size: 'giant', region: 'metro', width: W, height: H,
    walls: P.walls, spawns, lanes, nav, points: { dom: [], hard: [] },
    rooms: P.rooms, roofs: P.roofs, zones: P.zones, roads: P.roads, rails: P.rails, regionSeeds: REGION_SEEDS,
    districts, el: art.el, strings: art.strings, crossings: art.crossings, trains: art.trains,
    modes: ['br'], large: true, bf,
    br: { pois: P.pois, loot: P.loot, chests: P.chests, drop: null, circleBias, reboundAreas },
  };
}

export default build();
