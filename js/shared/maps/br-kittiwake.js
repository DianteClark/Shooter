// Battle royale (docs/DISTRICTS.md "The Coast"): Kittiwake Bay, 400 x 400 m, the third region. Four districts, each a
// 6v6 map of its own built to fit the bay, are placed edge to edge and joined by the bay's roads, quays and causeways,
// with the rest of the coast built round them:
//   Fish Market (fishmarket)   the market hall on the harbour, west of the centre, on Harbour Road
//   Shipyard (shipyard)        the dry dock and its two hulls, the centre, on Harbour Road
//   Stilt Row (stiltrow)       the fishing hamlet out on the back bay's flats, east
//   Boardwalk (boardwalk)      the resort on the sand spit, south, its pleasure pier out to sea
// North to south: Kittiwake town on its hill (St Agnes, the Market Cross, the Harbour Office, Windmill Hill), the inner
// harbour and the Freight Quay's wet basin, Harbour Road (the Lifeboat Station, the two districts, the Cannery), the
// back bay (tidal flats you wade, a deep channel, the Causeway across), the spit (the Dune Camp, the Lido, the
// Boardwalk, the Winter Gardens) and the open sea. The headland in the east carries the Coastguard Station, the Gun
// Battery and, at its tip, the lighthouse on Lantern Point. The west and the south are open sea.
// The district files are the source of truth (js/shared/maps/region-kit.js placeDistrict); nothing here changes them.
// Water follows js/shared/maps/coast-kit.js (one lattice for the region, the districts' own cells stamped into it).
// Contract: docs/BR.md. Dressed by the giant-world streamer (js/render/themes/frontier.js) with the bay's palette and
// extras (js/render/themes/shore.js).
import { wall } from './build.js';
import { Plan, mulberry, segDist } from './br-kit.js';
import { placeDistrict, cityBlock, pruneUnreachable } from './region-kit.js';
import { cellAt } from './isle-kit.js';
import { coastWater, CELL, DEEP, SHALLOW, LAND } from './coast-kit.js';
import fishmarket from './fishmarket.js';
import shipyard from './shipyard.js';
import boardwalk from './boardwalk.js';
import stiltrow from './stiltrow.js';

const W = 400, H = 400;

// Where each district sits (north-west corner, region metres; even, so their 2 m cells line up with the bay's).
// Harbour Road (z 176) is the middle lane of the Fish Market and the Shipyard; Stilt Row's bank and the Boardwalk's
// promenade run east to west across the bay further south.
export const DISTRICTS = {
  fishmarket: { x: 40, z: 152 },
  shipyard: { x: 148, z: 146 },
  stiltrow: { x: 262, z: 220 },
  boardwalk: { x: 140, z: 272 },
};
const DMAP = { fishmarket, shipyard, stiltrow, boardwalk };
const DRECTS = Object.entries(DISTRICTS).map(([id, at]) => ({ id, x: at.x, z: at.z, w: DMAP[id].width, d: DMAP[id].height, map: DMAP[id] }));

// Ground regions for the renderer: [region, x, z, bias] (themes/shore.js colours them).
export const REGION_SEEDS = [
  ['kwtown', 90, 50, 20], ['kwtown', 220, 50, 20], ['kwtown', 150, 90], ['kwheath', 340, 30, 10], ['kwheath', 380, 120], ['kwheath', 372, 230],
  ['kwquay', 80, 176, 10], ['kwquay', 20, 150], ['kwquay', 130, 160], ['kwyard', 200, 176, 20], ['kwyard', 230, 120], ['kwyard', 290, 176],
  ['kwflat', 90, 236, 10], ['kwflat', 200, 230], ['kwflat', 300, 240, 10],
  ['kwdune', 60, 300, 10], ['kwdune', 190, 300, 20], ['kwdune', 290, 300], ['kwheath', 372, 330],
];

// Roads: polylines with a width. They stop at the district edges: inside a district its own zones are the ground.
const ROADS = [
  // Harbour Road, west to east (the Fish Market and the Shipyard carry it in between).
  { pts: [[12, 176], [40, 176]], w: 7, kind: 'asphalt' },
  { pts: [[120, 176], [148, 176]], w: 8, kind: 'asphalt' },
  { pts: [[252, 176], [394, 176]], w: 8, kind: 'asphalt' },
  // The town.
  { pts: [[6, 60], [330, 60]], w: 8, kind: 'asphalt' },                       // High Street.
  { pts: [[24, 108], [124, 108]], w: 6, kind: 'kwsetts' },                    // Harbour Street, on the north quay.
  { pts: [[60, 4], [60, 104]], w: 6, kind: 'kwsetts' },                       // Church Lane.
  { pts: [[134, 4], [134, 200]], w: 8, kind: 'asphalt' },                     // Slipway Lane: the town down to Harbour Road.
  { pts: [[200, 4], [200, 104]], w: 6, kind: 'kwsetts' },                     // Station Road.
  { pts: [[260, 64], [260, 140]], w: 6, kind: 'asphalt' },                    // Basin Road.
  { pts: [[12, 149], [92, 149]], w: 5, kind: 'kwsetts' },                     // North Quay, along the harbour's south side.
  // The headland road, Harbour Road to the lighthouse.
  { pts: [[350, 64], [350, 176]], w: 6, kind: 'asphalt' },
  { pts: [[350, 176], [354, 260], [366, 318]], w: 6, kind: 'kwsetts' },
  // The Causeway across the back bay, Harbour Road to the spit.
  { pts: [[130, 200], [130, 272]], w: 7, kind: 'kwsetts' },
  // The promenade along the spit (the Boardwalk district carries it between x 140 and 240).
  { pts: [[30, 300], [140, 300]], w: 9, kind: 'kwboards' },
  { pts: [[240, 300], [340, 300]], w: 9, kind: 'kwboards' },
];

// Where the bay's own water is (the districts bring theirs): the inner harbour and the Freight Quay's basin with stone
// quays, the pleasure pier and the bridges (decks), the back bay's channel. The rest (the open sea, the surf, the back
// bay's flats) comes from `seaBase`.
const QUAYS = [
  { x: 0, z: 120, w: 124, d: 26, quay: true },        // The inner harbour.
  { x: 92, z: 146, w: 22, d: 6, quay: true },         // Its arm to the Fish Market's basin.
  { x: 0, z: 140, w: 12, d: 72, quay: true },         // The harbour mouth's quay frontage.
  { x: 208, z: 116, w: 44, d: 30, quay: true },       // The Freight Quay's wet basin, on to the Shipyard's quay.
];
const DECKS = [
  { x: 60, z: 118, w: 8, d: 30 },                     // The swing bridge over the inner harbour.
  { x: 126, z: 220, w: 8, d: 24 },                    // The Causeway's bridge over the channel.
  { x: 187, z: 328, w: 6, d: 46 },                    // The pleasure pier...
  { x: 176, z: 374, w: 30, d: 20 },                   // ...and its pier head.
];
const CHANNEL = [[[170, 204], [162, 220], [134, 232], [104, 230], [76, 220], [57, 204]], [[76, 220], [48, 236], [14, 246]]];
const CAUSEWAY = { x: 126, z: 200, w: 8, d: 72 };

const westCoast = z => 22 + 2 * Math.round(Math.sin(z * 0.045) * 1.2 + Math.sin(z * 0.11) * 0.6);
const nearLine = (pts, x, z) => {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, z, ...pts[i - 1], ...pts[i]));
  return d;
};
const inRect = (r, x, z, m = 0) => x > r.x - m && x < r.x + r.w + m && z > r.z - m && z < r.z + r.d + m;
const district = (x, z) => DRECTS.find(r => inRect(r, x, z));

// Every cell's class before the bay's own rects: the districts' cells as they are, the open sea, the surf, the back
// bay and its channel, the spit and the land.
function seaBase(x, z) {
  const dr = district(x, z);
  if (dr) return cellAt(dr.map.cells, x - dr.x, z - dr.z);
  const point = x > 352 && x < 394 && z > 330 && z < 354;               // Lantern Point's rocks, out into the sea.
  if (z >= 336 + 2 * Math.round(Math.sin(x * 0.05))) return point ? LAND : (x > 344 && x < 402 && z < 362 ? SHALLOW : DEEP);
  if (z >= 100) {
    // The harbour mouth (z 140-212) is a quay frontage, deep right up to the wall; elsewhere surf off the beach.
    const mouth = z > 140 && z < 212, wc = mouth ? 12 : westCoast(z);
    if (x < wc) return DEEP;
    if (x < wc + 6 && !mouth && !(z > 116 && z < 150)) return SHALLOW;
  }
  if (z >= 328) return SHALLOW;                                          // The spit's surf, south.
  if (inRect(CAUSEWAY, x, z) && !CHANNEL.some(c => nearLine(c, x, z) < 5)) return LAND;
  // The back bay: flats from Harbour Road to the spit, the channel through them, the Saltings and the headland dry.
  if (z >= 200 && z < 270 && x < 342) {
    if (x >= 230 && x < 262 && z >= 240) return LAND;                    // The Saltings.
    if (z < 206 && x >= 148 && x < 262) return LAND;                     // The Cannery's foreshore.
    if (CHANNEL.some(c => nearLine(c, x, z) < 5)) return DEEP;
    return SHALLOW;
  }
  return LAND;
}

function build() {
  const P = new Plan(W, H, 3141);
  const R = P.rnd;
  const A = (x, z, w, d, h, kind, extra = {}) => P.add(x, z, w, d, h, kind, extra);
  P.roads = [...ROADS]; P.rails = [];
  P.keepOut = [];
  P.doorPts = [];
  const building0 = P.building.bind(P);
  P.building = (...a) => { const r = building0(...a); P.doorPts.push(...r.doors); return r; };

  // ---- Water: one lattice for the bay ---------------------------------------------------------------------------
  const inAnyDistrict = (i, j) => !!district((i + 0.5) * CELL, (j + 0.5) * CELL);
  const water = coastWater(W, H, { deep: QUAYS, deck: DECKS }, seaBase, (i, j) => !inAnyDistrict(i, j));
  const cells = water.cells;
  const cls = (x, z) => cellAt(cells, x, z);
  // Dry footing for a piece: every cell under it (and m round it) land, and no district.
  const dry = (x, z, w, d, m = 0) => {
    for (let zz = z - m; zz <= z + d + m + 0.01; zz += Math.min(2, d + 2 * m)) for (let xx = x - m; xx <= x + w + m + 0.01; xx += Math.min(2, w + 2 * m)) {
      const px = Math.min(xx, x + w + m - 0.01), pz = Math.min(zz, z + d + m - 0.01);
      if (cls(px, pz) !== LAND || district(px, pz)) return false;
    }
    return true;
  };
  const onDeck = (x, z) => DECKS.some(r => inRect(r, x, z));
  const onRoad = (x, z, w, d) => ROADS.some(rd => nearLine(rd.pts, x + w / 2, z + d / 2) < rd.w / 2 + Math.max(w, d) / 2 + 0.5);
  const fits = (x, z, w, d, extra = {}, m = 1.6) => !P.keepOut.some(k => x < k.x + k.w && x + w > k.x && z < k.z + k.d && z + d > k.z)
    && !P.doorPts.some(([dx, dz]) => dx > x - 3.2 && dx < x + w + 3.2 && dz > z - 3.2 && dz < z + d + 3.2)
    && (extra.car || !onRoad(x, z, w, d)) && P.free(x, z, w, d, m) && (extra.afloat || dry(x, z, w, d, 0.5));
  const T = (x, z, w, d, h, kind, extra = {}, m = 1.6) => (fits(x, z, w, d, extra, m) ? A(x, z, w, d, h, kind, extra) : null);
  const B = (x, z, w, d, o = {}) => (dry(x, z, w, d, 1) && !P.keepOut.some(k => x < k.x + k.w && x + w > k.x && z < k.z + k.d && z + d > k.z) ? P.building(x, z, w, d, o) : null);
  // A place: its record carries the map region (coast); its pieces the bay's own ground names (themes/shore.js).
  const poi = (id, name, x, z, r, reg, tier) => { P.poi(id, name, x, z, r, 'coast', tier); P.region = reg; };
  const keep = (x, z, w, d, m = 3) => P.keepOut.push({ x: x - m, z: z - m, w: w + 2 * m, d: d + 2 * m });
  // Extraction's landing zones, reserved before anything is placed (see br.exfils).
  const LZ_RING = [[30, 46], [300, 106], [376, 196], [300, 312], [60, 286], [30, 186], [230, 30]];
  const LZ_FINAL = [[134, 186], [134, 140], [262, 176], [130, 260]];
  for (const [x, z] of [...LZ_RING, ...LZ_FINAL]) keep(x - 9, z - 9, 18, 18, 0);

  P.region = 'kwsea'; P.skin = 'shore';
  for (const [x, z, w, d, f] of water.water) A(x, z, w, d, 0, 'water', f);
  P.skin = null;
  for (const r of water.decks) P.rooms.push(r);

  // ---- The districts ------------------------------------------------------------------------------------------
  // Each is its 6v6 map placed as it is (border dropped, blocks opened up into buildings to loot), with loot out round
  // its cover: the Shipyard a tier 1 place, the other three tier 2.
  const districts = [];
  const art = { halls: [], docks: [], promenade: [] };
  const STYLES = { fishmarket: 'kwbrick', shipyard: 'kwshed', boardwalk: 'kwresort', stiltrow: 'kwtimber' };
  const place = (id, name, poiX, poiZ, r, tier, region) => {
    const at = DISTRICTS[id], map = DMAP[id];
    poi(id, name, poiX, poiZ, r, region, tier);
    const rec = placeDistrict(P, map, at.x, at.z, { skin: 'shore', id, name, style: STYLES[id] });
    districts.push({ id: rec.id, name: rec.name, x: rec.x, z: rec.z, w: rec.w, h: rec.h });
    for (const zn of rec.zones) P.zones.push(zn);
    for (const k of ['halls', 'docks', 'promenade']) for (const q of map[k] ?? []) art[k].push({ ...q, x: q.x + at.x, z: q.z + at.z });
    for (const q of map.rooms ?? []) P.rooms.push({ ...q, x: q.x + at.x, z: q.z + at.z });
    for (const q of map.underDecks ?? []) water.underDecks.push({ ...q, x: q.x + at.x, z: q.z + at.z });
    keep(at.x, at.z, map.width, map.height);
    P.outdoorLoot(at.x + map.width / 2, at.z + map.height / 2, Math.min(map.width, map.height) / 2, Math.round(map.width * map.height / 300), tier);
  };
  place('shipyard', 'Shipyard', 200, 176, 40, 1, 'kwyard');
  place('fishmarket', 'Fish Market', 80, 176, 32, 2, 'kwquay');
  place('boardwalk', 'Boardwalk', 190, 300, 36, 2, 'kwdune');
  place('stiltrow', 'Stilt Row', 302, 245, 30, 2, 'kwflat');

  // ---- Kittiwake town (north): cottages and shops round its streets ------------------------------------------------
  const TOWN = { style: 'kwcottage', tall: 0.12, yard: 0.14, lot: [8, 12], h: [3.4, 4.2], towerH: [5.4, 6.6], towerSkin: 'shore', loot: 2 };
  poi('town', 'Market Cross', 168, 82, 36, 'kwtown', 2);
  cityBlock(P, 138, 66, 58, 34, { ...TOWN, rows: 1 });
  cityBlock(P, 204, 66, 52, 26, { ...TOWN, rows: 1 });
  cityBlock(P, 138, 4, 58, 52, TOWN);
  P.outdoorLoot(168, 82, 34, 4, 2);
  poi('harbouroffice', 'Harbour Office', 92, 86, 30, 'kwquay', 3);
  cityBlock(P, 64, 66, 66, 36, { ...TOWN, rows: 1, style: 'kwbrick' });
  cityBlock(P, 64, 4, 66, 52, { ...TOWN, tall: 0.2 });
  // The Harbour Office on the north quay, its clock over the water.
  B(96, 112, 16, 6, { h: 4.4, style: 'kwstation', furnish: 1, chest: true, doors: [['n', 0.3], ['n', 0.75], ['w', 0.5]] });
  P.zones.push({ x: 22, z: 112, w: 102, d: 8, kind: 'kwquayside' }, { x: 22, z: 146, w: 70, d: 6, kind: 'kwquayside' });
  P.outdoorLoot(92, 100, 30, 4, 3);

  // ---- St Agnes (north-west): the church, its yard of headstones, the vicarage ---------------------------------------
  poi('church', 'St Agnes', 30, 40, 26, 'kwtown', 3);
  B(14, 20, 24, 11, { h: 6, style: 'kwchurch', split: false, furnish: 2, chest: true, doors: [['w', 0.5, 3], ['s', 0.3], ['s', 0.7], ['n', 0.5]] });
  A(40, 22, 5, 5, 13, 'building', { spire: true, skin: 'shore', keep: true });
  P.zones.push({ x: 6, z: 34, w: 46, d: 20, kind: 'kwgrass' });
  P.skin = 'shore';
  for (let k = 0; k < 22; k++) T(8 + R() * 42, 36 + R() * 16, 0.8, 0.3, 0.9, 'barrier', { headstone: true }, 1.2);
  for (const [x, z] of [[8, 8], [48, 8], [6, 52], [50, 52]]) T(x, z, 1.2, 1.2, 4.5, 'wall', { tree: true });
  P.skin = null;
  B(8, 68, 12, 10, { style: 'kwcottage', h: 3.8 });
  B(26, 70, 12, 9, { style: 'kwcottage', h: 3.6 });
  B(8, 86, 14, 9, { style: 'kwcottage', h: 3.8 });
  B(36, 86, 12, 9, { style: 'kwbrick', h: 4 });
  P.outdoorLoot(30, 40, 26, 5, 3);

  // ---- Windmill Hill and the heath (north-east) ------------------------------------------------------------------
  poi('windmill', 'Windmill Hill', 330, 30, 30, 'kwheath', 3);
  A(326, 22, 7, 7, 9, 'building', { windmill: true, skin: 'shore', keep: true });
  B(300, 8, 12, 9, { style: 'kwcottage', h: 3.6 });
  B(344, 44, 12, 9, { style: 'kwtimber', h: 3.6 });
  B(264, 8, 30, 12, { h: 4.8, style: 'kwshed', split: false, furnish: 2, doors: [['s', 0.25, 3], ['s', 0.75, 3], ['w', 0.5], ['e', 0.5]] });   // The tithe barn.
  P.zones.push({ x: 300, z: 4, w: 96, d: 52, kind: 'kwgrass' });
  P.skin = 'shore';
  for (let k = 0; k < 26; k++) T(300 + R() * 94, 4 + R() * 52, 1.6, 1.6, 1.1, 'boulder', { gorse: true }, 2.4);
  for (const [x, z] of [[372, 12], [384, 30]]) T(x, z, 2.4, 2.4, 1.0, 'barrier', { hay: true });
  P.skin = null;
  P.outdoorLoot(330, 30, 30, 6, 3);
  // The old station yard (north, open: a landing zone) and the far end of the High Street.
  B(210, 8, 24, 10, { h: 4.6, style: 'kwbrick', split: true, furnish: 2, doors: [['s', 0.25], ['s', 0.75], ['w', 0.5], ['e', 0.5]] });
  cityBlock(P, 264, 66, 66, 30, { ...TOWN, rows: 1 });

  // ---- Freight Quay: the wet basin north of the Shipyard, a coaster tied up in it, warehouses -------------------------
  poi('freight', 'Freight Quay', 232, 110, 30, 'kwyard', 2);
  B(204, 96, 24, 12, { h: 5.4, style: 'kwshed', split: false, furnish: 2, chest: true, loot: 7, doors: [['s', 0.25, 3], ['s', 0.75, 3], ['n', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(232, 96, 22, 12, { h: 5.4, style: 'kwbrick', split: false, furnish: 2, loot: 6, doors: [['s', 0.3, 3], ['s', 0.75, 3], ['n', 0.5], ['e', 0.5]] });
  B(264, 112, 14, 22, { h: 4.6, style: 'kwshed', furnish: 2, doors: [['w', 0.3], ['w', 0.75], ['e', 0.5], ['n', 0.5]] });
  P.zones.push({ x: 202, z: 110, w: 54, d: 6, kind: 'kwquayside' }, { x: 252, z: 110, w: 6, d: 36, kind: 'kwquayside' });
  P.skin = 'shore';
  A(214, 124, 30, 7, 3.4, 'hull', { coaster: true, bow: 1 });
  for (const [x, z] of [[205, 111.4], [251, 111.4]]) A(x, z, 1.4, 1.4, 12, 'crane', { quaycrane: true });
  P.skin = null;
  P.outdoorLoot(232, 112, 28, 6, 2);

  // ---- Lifeboat Station (west, at the harbour mouth) -----------------------------------------------------------------
  poi('lifeboat', 'Lifeboat Station', 30, 170, 18, 'kwquay', 3);
  B(26, 154, 12, 14, { h: 5.4, style: 'kwstation', split: false, furnish: 1, chest: true, doors: [['w', 0.5, 3.2], ['e', 0.5], ['s', 0.5]] });
  P.zones.push({ x: 22, z: 168, w: 16, d: 4, kind: 'kwslip' });
  P.outdoorLoot(30, 174, 16, 3, 3);

  // ---- Slipway Lane between the Fish Market and the Shipyard: the chandlery, the net loft -------------------------
  P.region = 'kwquay'; P.tier = 2;
  B(123, 152, 6, 16, { style: 'kwbrick', h: 4.2, doors: [['n', 0.5], ['s', 0.5]] });
  B(138.5, 152, 6, 12, { style: 'kwtimber', h: 3.8, doors: [['n', 0.5], ['s', 0.5]] });
  B(139, 118, 8, 11, { style: 'kwbrick', h: 4 });

  // ---- The Cannery (east of the Shipyard, on Harbour Road) ------------------------------------------------------------
  poi('cannery', 'The Cannery', 290, 176, 30, 'kwyard', 2);
  B(264, 148, 36, 18, { h: 6, style: 'kwbrick', split: true, furnish: 2, chest: true, loot: 8, doors: [['s', 0.2, 3], ['s', 0.5], ['s', 0.8, 3], ['n', 0.3], ['n', 0.7], ['w', 0.5], ['e', 0.5]] });
  B(306, 148, 18, 14, { h: 4.6, style: 'kwshed', furnish: 2, doors: [['s', 0.3], ['s', 0.7], ['w', 0.5], ['n', 0.5]] });
  B(266, 186, 24, 12, { h: 4.6, style: 'kwshed', split: false, furnish: 2, doors: [['n', 0.3, 3], ['n', 0.7, 3], ['e', 0.5], ['w', 0.5]] });
  B(298, 186, 14, 10, { style: 'kwbrick', h: 4.2 });
  A(302, 140, 3, 3, 16, 'building', { chimney: true, skin: 'shore', keep: true });
  P.skin = 'shore';
  for (const [x, z] of [[316, 186], [322, 192], [256, 190]]) T(x, z, 2.4, 6, 2.6, 'container', {});
  for (const [x, z] of [[294, 170], [318, 170], [282, 200]]) T(x, z, 1.6, 1.6, 1.1, 'crate', { fishbox: true });
  P.skin = null;
  P.outdoorLoot(290, 176, 30, 8, 2);

  // ---- The headland: Coastguard Station, Gun Battery, Lantern Point --------------------------------------------------
  poi('coastguard', 'Coastguard Station', 368, 118, 26, 'kwheath', 2);
  B(358, 98, 22, 12, { h: 4.6, style: 'kwstation', furnish: 2, chest: true, loot: 6, doors: [['s', 0.3], ['s', 0.7], ['w', 0.5], ['n', 0.5]] });
  B(360, 124, 12, 10, { style: 'kwcottage', h: 3.8 });
  B(378, 124, 12, 10, { style: 'kwcottage', h: 3.8 });
  A(384, 142, 2, 2, 18, 'building', { mast: true, skin: 'shore', keep: true });
  P.zones.push({ x: 342, z: 64, w: 54, d: 96, kind: 'kwgrass' });
  P.outdoorLoot(368, 118, 24, 5, 2);

  poi('battery', 'Gun Battery', 372, 236, 26, 'kwheath', 2);
  // Concrete casemates sunk into the cliff top, gun pits in front of them.
  B(362, 212, 16, 8, { h: 3.2, style: 'kwbunker', split: false, furnish: 1, chest: true, doors: [['w', 0.5], ['e', 0.5], ['n', 0.5]] });
  B(362, 252, 16, 8, { h: 3.2, style: 'kwbunker', split: false, furnish: 1, doors: [['w', 0.5], ['e', 0.5], ['s', 0.5]] });
  B(380, 230, 10, 10, { h: 3.2, style: 'kwbunker', doors: [['w', 0.5], ['n', 0.5]] });
  P.skin = 'shore';
  for (const [x, z] of [[384, 206], [384, 262], [364, 232]]) {
    for (const [dx, dz, w, d] of [[0, 0, 6, 1], [0, 5, 6, 1], [0, 1, 1, 4]]) A(x + dx, z + dz, w, d, 1.0, 'sandbag', { gunpit: true });
    A(x + 2.4, z + 2.1, 1.4, 1.4, 1.2, 'barrier', { gun: true });
  }
  P.skin = null;
  P.outdoorLoot(372, 236, 24, 6, 2);

  poi('lighthouse', 'Lantern Point', 366, 326, 30, 'kwheath', 1);
  A(368, 336, 6, 6, 20, 'building', { lighthouse2: true, skin: 'shore', keep: true, landmark: true });
  B(350, 312, 14, 9, { h: 3.8, style: 'kwcottage', furnish: 2, chest: true, doors: [['n', 0.5], ['e', 0.5], ['w', 0.5]] });   // The keepers' cottages.
  B(376, 308, 12, 9, { h: 3.8, style: 'kwcottage', furnish: 1, doors: [['w', 0.5], ['n', 0.5]] });
  B(342, 286, 16, 10, { h: 4.2, style: 'kwstation', furnish: 2, doors: [['n', 0.3], ['n', 0.7], ['e', 0.5], ['s', 0.5]] });     // The fog-signal house.
  P.skin = 'shore';
  for (const [x, z, s] of [[356, 340, 3], [384, 344, 2.6], [392, 334, 2.2], [360, 348, 2]]) T(x, z, s, s, 1.4, 'rock', { boulder: true }, 1.4);
  P.skin = null;
  P.outdoorLoot(366, 322, 26, 8, 1);

  // ---- The spit, west: the Dune Camp and the Lido -------------------------------------------------------------------
  poi('dunes', 'Dune Camp', 50, 290, 24, 'kwdune', 3);
  P.skin = 'shore';
  for (let k = 0; k < 14; k++) {
    const x = 32 + (k % 7) * 10, z = k < 7 ? 278 : 310;
    T(x, z, 2.4, 5.4, 2.6, 'shop', { caravan: true }, 1.4);
  }
  for (let k = 0; k < 18; k++) T(28 + R() * 90, 276 + R() * 48, 2.2, 2.2, 1.0, 'boulder', { marram: true }, 2.2);
  P.skin = null;
  B(34, 286, 12, 7, { style: 'kwtimber', h: 3.6 });                                                             // The camp shop.
  P.outdoorLoot(50, 290, 22, 4, 3);
  poi('lido', 'The Lido', 108, 292, 22, 'kwdune', 3);
  P.skin = 'shore';
  A(96, 282, 24, 14, 0, 'water', { pool: true, quay: true });
  P.skin = null;
  B(94, 306, 28, 9, { h: 4, style: 'kwresort', split: true, furnish: 2, chest: true, doors: [['n', 0.25], ['n', 0.75], ['s', 0.5], ['w', 0.5], ['e', 0.5]] });   // The changing rooms and cafe.
  P.zones.push({ x: 92, z: 278, w: 32, d: 22, kind: 'kwtiles' });
  P.outdoorLoot(108, 292, 20, 4, 3);

  // ---- The spit, east: the Winter Gardens and the bandstand ------------------------------------------------------------
  poi('gardens', 'Winter Gardens', 288, 300, 28, 'kwdune', 3);
  B(262, 280, 30, 14, { h: 5.4, style: 'kwglass', split: true, furnish: 2, chest: true, loot: 6, doors: [['s', 0.25], ['s', 0.75], ['n', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(316, 310, 14, 10, { style: 'kwresort', h: 4 });
  B(250, 310, 12, 9, { style: 'kwresort', h: 3.8 });
  P.zones.push({ x: 296, z: 278, w: 40, d: 20, kind: 'kwgrass' });
  P.skin = 'shore';
  A(312, 284, 8, 8, 3.6, 'shop', { bandstand: true, keep: true });
  for (const [x, z] of [[300, 282], [328, 282], [300, 294], [328, 294]]) T(x, z, 1.2, 1.2, 4.5, 'wall', { tree: true });
  P.skin = null;
  P.outdoorLoot(288, 300, 26, 5, 3);

  // ---- The pleasure pier, out to sea from the Boardwalk's south beach -------------------------------------------------
  poi('pier', 'Pleasure Pier', 191, 382, 18, 'kwdune', 2);
  P.region = 'kwdune';
  B(178, 382, 16, 10, { h: 4.4, style: 'kwresort', split: false, furnish: 2, chest: true, loot: 5, doors: [['n', 0.3], ['n', 0.75], ['e', 0.5], ['w', 0.5]] });   // The pavilion.
  P.skin = 'shore';
  A(198, 378, 1.2, 6, 2, 'wall', { wheel: true, keep: true, landmark: true });       // The big wheel's frame (the wheel itself is art).
  A(187, 352, 1.2, 1.2, 1.0, 'barrier', { lifebuoy: true });
  A(192.4, 340, 0.6, 2.4, 0.9, 'barrier', { bench: true });
  A(187, 364, 0.6, 2.4, 0.9, 'barrier', { bench: true });
  P.skin = null;
  P.outdoorLoot(191, 380, 12, 5, 2);

  // ---- The back bay: boats on the mud, posts, a couple of stilt huts out on their platforms ---------------------------
  P.region = 'kwflat'; P.tier = 3; P.skin = 'shore';
  const brnd = mulberry(4417);
  let boats = 0;
  for (let tries = 0; tries < 400 && boats < 18; tries++) {
    const x = 30 + brnd() * 300, z = 208 + brnd() * 58;
    if (cls(x, z) !== SHALLOW || cls(x + 3.6, z + 1.6) !== SHALLOW || district(x, z) || district(x + 3.6, z + 1.6)) continue;
    if (T(x, z, 3.6, 1.6, 0.9, 'barrier', { boat: true, afloat: true }, 2.4)) boats++;
  }
  for (let k = 0; k < 30; k++) {
    const x = 30 + brnd() * 300, z = 208 + brnd() * 58;
    if (cls(x, z) === SHALLOW && !district(x, z)) T(x, z, 0.6, 0.6, 1.4, 'barrier', { post: true, afloat: true }, 2.4);
  }
  P.skin = null;
  P.outdoorLoot(200, 240, 60, 8, 3);

  // ---- Street clutter: parked cars along the roads, lobster pots on the quays, benches on the promenade -------------
  P.region = 'kwtown'; P.skin = 'shore';
  const rnd = mulberry(5150);
  for (const rd of ROADS) {
    if (rd.kind !== 'asphalt') continue;
    const [[ax, az], [bx, bz]] = [rd.pts[0], rd.pts[rd.pts.length - 1]];
    const horiz = Math.abs(bz - az) < Math.abs(bx - ax), L = Math.hypot(bx - ax, bz - az);
    for (let s = 6; s < L - 6; s += 10 + rnd() * 16) {
      if (rnd() < 0.45) continue;
      const side = rnd() < 0.5 ? -1 : 1, off = rd.w / 2 - 1.2;
      const px = horiz ? ax + s : ax + side * off, pz = horiz ? az + side * off : az + s;
      T(horiz ? px - 2.1 : px - 0.95, horiz ? pz - 0.95 : pz - 2.1, horiz ? 4.2 : 1.9, horiz ? 1.9 : 4.2, 1.4, 'barrier', { car: true }, 1.2);
    }
  }
  for (let k = 0; k < 24; k++) T(26 + rnd() * 96, 113 + rnd() * 5, 1.6, 1.6, 1.15, 'crate', { pots: true }, 1.4);
  for (let x = 36; x < 136; x += 14) T(x, 296.2 - 3.6, 2.4, 0.6, 0.9, 'barrier', { bench: true }, 1.2);
  for (let x = 246; x < 336; x += 14) T(x, 296.2 - 3.6, 2.4, 0.6, 0.9, 'barrier', { bench: true }, 1.2);
  P.skin = null;

  // The edge of the bay: border walls in tile-sized lengths (the renderer streams them), open where the sea runs past.
  for (let s = 0; s < W; s += 32) {
    const len = Math.min(32, W - s);
    for (const [x, z, w, d] of [[s, -1.5, len, 1.5], [s, H, len, 1.5], [-1.5, s, 1.5, len], [W, s, 1.5, len]]) {
      const mx = Math.max(1, Math.min(W - 1, x + w / 2)), mz = Math.max(1, Math.min(H - 1, z + d / 2));
      const sea = cls(mx, mz) !== LAND;
      P.walls.push(wall(x, z, w, d, 4, 'border', { region: 'kwheath', ...(sea ? { open: true } : {}) }));
    }
  }

  // ---- Extraction's landing zones (docs/EXTRACT.md; js/sim/extract.js reads br.exfils): named and reserved (LZ_RING,
  // LZ_FINAL): the town's north field, the heath, the headland road, the Winter Gardens, the Dune Camp, the harbour
  // mouth, the basin road; the final out at one of the junctions round the Shipyard. Inserts at eight points round the edge.
  const clearSq = (x, z, r) => x > r + 2 && z > r + 2 && x < W - r - 2 && z < H - r - 2 && P.near(x - r, z - r, 2 * r, 2 * r).size === 0
    && !P.roofs.some(f => x > f.x - r && x < f.x + f.w + r && z > f.z - r && z < f.z + f.d + r) && dry(x - r, z - r, 2 * r, 2 * r);
  const findClear = (x0, z0, r, reach = 26) => {
    for (let d = 0; d <= reach; d += 2) for (let a = 0; a < 6.28; a += 0.4) {
      const x = Math.round(x0 + Math.cos(a) * d), z = Math.round(z0 + Math.sin(a) * d);
      if (clearSq(x, z, r)) return { x, z };
    }
    return null;
  };
  const ring = LZ_RING.map(([x, z]) => findClear(x, z, 8)).filter(Boolean);
  const final = LZ_FINAL.map(([x, z]) => findClear(x, z, 7)).filter(Boolean);
  const inserts = [];
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) / 8 * Math.PI * 2;
    let got = null;
    for (let r = 182; r > 100 && !got; r -= 3) for (const da of [0, 0.1, -0.1, 0.2, -0.2]) {
      if (got) break;
      const x = Math.round(200 + Math.cos(a + da) * r), z = Math.round(200 + Math.sin(a + da) * r);
      got = clearSq(x, z, 5) ? { x, z } : null;
    }
    if (got) inserts.push(got);
  }
  const exfils = { ring, final, inserts };

  // Nothing a bot cannot walk to: flooded from Slipway Lane.
  pruneUnreachable(P, 134, 176);

  // Supply caches out in the open, by cover, away from the places.
  const crnd = mulberry(77);
  let caches = 0;
  for (let tries = 0; tries < 4000 && caches < 8; tries++) {
    const x = 20 + crnd() * (W - 40), z = 20 + crnd() * (H - 60);
    if (P.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 10) || P.chests.some(c => Math.hypot(c.x - x, c.z - z) < 50)) continue;
    if (cls(x, z) !== LAND || district(x, z) || !P.open(x, z, 1.0) || P.roofAt(x, z) || P.near(x - 0.01, z - 0.01, 0.02, 0.02, 2.2).size === 0) continue;
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
    for (let r = 0; r < 30; r += 0.5) for (let a = 0; a < 6.28; a += 0.4) {
      const px = +(x + Math.cos(a) * r).toFixed(1), pz = +(z + Math.sin(a) * r).toFixed(1);
      if (P.open(px, pz, 1.2) && !P.roofAt(px, pz) && cls(px, pz) === LAND) return { x: px, z: pz };
    }
    return { x, z };
  };
  const spawns = [[], []];
  for (const p of P.pois) {
    const team = p.x < 200 ? 0 : 1;
    for (const k of [0, 1]) { const s = spot(p.x + (k ? 5 : -5), p.z + p.r * 0.5); spawns[team].push({ ...s, aim: team ? Math.PI : 0 }); }
  }
  const nav = P.pois.map(p => spot(p.x, p.z));
  const lanes = [{ id: 'town', z: 60 }, { id: 'harbour', z: 176 }, { id: 'bay', z: 240 }, { id: 'spit', z: 300 }];

  const circleBias = P.pois.map(p => ({ x: p.x, z: p.z, w: p.tier === 1 ? 1 : p.tier === 2 ? 0.8 : 0.5 }))
    .concat([[134, 176], [134, 60], [260, 176], [350, 176], [130, 240]].map(([x, z]) => ({ x, z, w: 0.4 })));
  // Rebound's compact areas: over the harbour and the bay, leaning into the land (the sea west and south leaves too
  // little ground for an area centred on the map).
  const reboundAreas = [{ x: 210, z: 190, r: 150 }, { x: 236, z: 176, r: 150 }, { x: 200, z: 160, r: 150 }, { x: 226, z: 214, r: 150 }];

  // Conquest and Breakthrough (docs/MODES.md "Layout format"): the harbour, the bay and the spit; Harbour Road west to
  // east. Every point is moved onto dry open ground round its place.
  const pt = (x, z, extra = {}) => ({ ...spot(x, z), ...extra });
  const bf = {
    conquest: [{
      id: 'harbour', name: 'Kittiwake: Harbour', area: { x: 14, z: 120, w: 372, h: 210 },
      hq: [pt(28, 176, { r: 10 }), pt(370, 176, { r: 10 })],
      flags: [
        pt(80, 176, { id: 'A', name: 'Fish Market' }), pt(200, 176, { id: 'B', name: 'Shipyard' }), pt(130, 250, { id: 'C', name: 'The Causeway' }),
        pt(190, 300, { id: 'D', name: 'Boardwalk' }), pt(290, 176, { id: 'E', name: 'The Cannery' }), pt(302, 245, { id: 'F', name: 'Stilt Row' }),
      ],
    }],
    breakthrough: [{
      id: 'landing', name: 'Kittiwake: Harbour Road', area: { x: 14, z: 132, w: 372, h: 92 }, tickets: 300, refill: 240,
      hq: [pt(26, 176, { r: 10 }), pt(372, 176, { r: 10 })],
      sectors: [
        { name: 'Fish Market', objs: [pt(66, 166), pt(96, 188)] },
        { name: 'Shipyard', objs: [pt(182, 166), pt(222, 188)] },
        { name: 'The Cannery', objs: [pt(282, 168), pt(318, 186)] },
      ],
    }],
  };

  return {
    id: 'kittiwake', name: 'Kittiwake Bay', theme: 'shore', size: 'giant', region: 'coast', width: W, height: H,
    walls: P.walls, spawns, lanes, nav, points: { dom: [], hard: [] },
    rooms: P.rooms, roofs: P.roofs, zones: P.zones, roads: P.roads, rails: P.rails, regionSeeds: REGION_SEEDS,
    shallows: water.shallows, underDecks: water.underDecks, cells,
    districts, halls: art.halls, docks: art.docks, promenade: art.promenade,
    modes: ['br'], large: true, bf,
    br: { pois: P.pois, loot: P.loot, chests: P.chests, drop: null, circleBias, reboundAreas, exfils },
  };
}

export default build();
