// Battle royale (docs/DISTRICTS.md "The North"): Kaldvik, 400 x 400 m, the fourth region. A fishing town on a frozen
// fjord under a blizzard dusk. Four districts, each a 6v6 map of its own built to fit, are placed into it and joined
// by its roads, with the rest of the north built round them:
//   Trawler Basin (trawler)   the frozen harbour on the north shore; its quay road is Kaldvik's Quay Street
//   Telemark (telemark)       the ski village under the slopes in the west; its village street is the Fjord Road
//   Ice Core (icecore)        the drilling camp out on the ice shelf in the east, the Fjord Road's far end
//   Spillway (spillway)       the hydro dam in the south, holding the reservoir back; the Dam Road crosses its crest
// Round them: Lighthouse Point, the Cannery and the Tank Farm on the shore, the Freight Depot and the Logging Camp in
// the west, Kaldvik Town with its church and square in the middle, Birchwood's houses south of it, the Radar Dome and
// the Shelf Airstrip on the ice shelf, the Ski Jump and the Summit Lodge on the mountain, the Ice Fishing Camp out on the
// reservoir, the Turbine Hall below the dam and the Hot Springs in the south-east. A frozen river runs from the dam's
// tailrace north to the sea. The district files are the source of truth (js/shared/maps/region-kit.js placeDistrict);
// nothing here changes them. Contract: docs/BR.md. Dressed by the giant-world streamer (js/render/themes/frontier.js)
// with the north's palette and extras (js/render/themes/north.js).
import { wall } from './build.js';
import { Plan, mulberry, segDist } from './br-kit.js';
import { placeDistrict, cityBlock, pruneUnreachable } from './region-kit.js';
import trawler from './trawler.js';
import telemark from './telemark.js';
import icecore from './icecore.js';
import spillway from './spillway.js';

const W = 400, H = 400;

// Where each district sits (north-west corner, region metres). Telemark's and Ice Core's middle lanes are the Fjord
// Road (z 220); Trawler Basin's is Quay Street (z 64); Spillway's is the Dam Road (z 318).
export const DISTRICTS = {
  trawler: { x: 160, z: 40 },
  telemark: { x: 34, z: 188 },
  icecore: { x: 290, z: 197 },
  spillway: { x: 192, z: 300 },
};

// Ground regions for the renderer: [region, x, z, bias] (themes/north.js colours them).
export const REGION_SEEDS = [
  ['kvice', 60, 14], ['kvice', 200, 12], ['kvice', 330, 16], ['kvice', 120, 24], ['kvice', 270, 24],
  ['kvquay', 100, 60], ['kvquay', 200, 70, 10], ['kvquay', 305, 62],
  ['kvtown', 205, 150, 24], ['kvtown', 205, 260], ['kvtown', 110, 125],
  ['kvsnow', 30, 120], ['kvsnow', 150, 300], ['kvsnow', 270, 320], ['kvsnow', 40, 60],
  ['kvforest', 30, 160], ['kvforest', 140, 175], ['kvforest', 20, 260], ['kvforest', 250, 380],
  ['kvpiste', 90, 300], ['kvpiste', 50, 360], ['kvpiste', 88, 220, 10],
  ['kvshelf', 330, 220, 20], ['kvshelf', 370, 130], ['kvshelf', 340, 290], ['kvshelf', 385, 380],
  ['kvlake', 145, 360], ['kvlake', 175, 380],
];

// Ploughed roads: polylines with a width. They stop at the district edges: inside a district its own street zones are
// the road.
const ROADS = [
  // East-west.
  { pts: [[14, 64], [160, 64]], w: 8, kind: 'asphalt' },                 // Quay Street, west of the harbour...
  { pts: [[240, 64], [388, 64]], w: 8, kind: 'asphalt' },                // ...and east of it.
  { pts: [[146, 92], [284, 92]], w: 8, kind: 'asphalt' },                // Front Street, behind the harbour.
  { pts: [[150, 150], [266, 150]], w: 9, kind: 'asphalt' },              // Church Street, through the square.
  { pts: [[0, 220], [34, 220]], w: 8, kind: 'asphalt' },                 // The Fjord Road, west of Telemark...
  { pts: [[142, 220], [290, 220]], w: 8, kind: 'asphalt' },              // ...through town to Ice Core...
  { pts: [[366, 220], [396, 220]], w: 8, kind: 'asphalt' },              // ...and out to the shelf's edge.
  { pts: [[4, 318], [192, 318]], w: 7, kind: 'asphalt' },                // The Dam Road along the reservoir...
  { pts: [[248, 318], [396, 318]], w: 7, kind: 'asphalt' },              // ...and on past the turbine hall.
  { pts: [[60, 112], [146, 112]], w: 6, kind: 'dirt' },                  // The depot yard road.
  // North-south.
  { pts: [[150, 64], [150, 318]], w: 8, kind: 'asphalt' },               // West Street.
  { pts: [[200, 88], [200, 300]], w: 8, kind: 'asphalt' },               // Harbour Road, through the square.
  { pts: [[284, 64], [284, 197]], w: 8, kind: 'asphalt' },               // Shelf Road, north of Ice Core...
  { pts: [[284, 243], [284, 318]], w: 8, kind: 'asphalt' },              // ...and south of it.
  { pts: [[60, 64], [60, 188]], w: 6, kind: 'dirt' },                    // The logging track.
  { pts: [[96, 252], [96, 318]], w: 6, kind: 'dirt' },                   // The piste road up to the summit.
];
// The ore line into the depot (renderer: horizontal lines, sleepers and two rails).
const RAILS = [{ pts: [[-30, 104], [146, 104]] }, { pts: [[-30, 120], [120, 120]] }];
// The frozen river: from the dam's tailrace east, then north to the sea (walkable ice; the open leads in it block).
const RIVER = [{ x: 248, z: 324, w: 26, d: 10 }, { x: 262, z: 36, w: 12, d: 298 }];

function build() {
  const P = new Plan(W, H, 4401);
  const R = P.rnd;
  const B = (x, z, w, d, o) => P.building(x, z, w, d, o);
  const A = (x, z, w, d, h, kind, extra = {}) => P.add(x, z, w, d, h, kind, extra);
  P.roads = [...ROADS]; P.rails = RAILS;
  P.keepOut = [];
  // Every doorway built (district buildings and region ones), so scatter never blocks one.
  P.doorPts = [];
  const building0 = P.building.bind(P);
  P.building = (...a) => { const r = building0(...a); P.doorPts.push(...r.doors); return r; };
  const onRoad = (x, z, w, d) => ROADS.some(rd => {
    for (let i = 1; i < rd.pts.length; i++) if (segDist(x + w / 2, z + d / 2, ...rd.pts[i - 1], ...rd.pts[i]) < rd.w / 2 + Math.max(w, d) / 2 + 0.5) return true;
    return false;
  });
  // Scatter and cover: only where it leaves no narrow gap, keeps off every district (and its margin), the ground in
  // front of every door, and (unless it is a parked vehicle) off the roads.
  const fits = (x, z, w, d, extra = {}, m = 1.6) => !P.keepOut.some(k => x < k.x + k.w && x + w > k.x && z < k.z + k.d && z + d > k.z)
    && !P.doorPts.some(([dx, dz]) => dx > x - 3.2 && dx < x + w + 3.2 && dz > z - 3.2 && dz < z + d + 3.2)
    && (extra.car || !onRoad(x, z, w, d)) && P.free(x, z, w, d, m);
  const T = (x, z, w, d, h, kind, extra = {}, m = 1.6) => (fits(x, z, w, d, extra, m) ? P.add(x, z, w, d, h, kind, extra) : null);
  // A place: its map tag (REGIONS, the card's region) is the arctic's, or the coast's on the shore; `reg` is the ground region its pieces stand in.
  const poi = (id, name, x, z, r, reg, tier) => { P.poi(id, name, x, z, r, reg === 'kvquay' ? 'coast' : 'arctic', tier); P.region = reg; };
  const keep = (x, z, w, d, m = 3) => P.keepOut.push({ x: x - m, z: z - m, w: w + 2 * m, d: d + 2 * m });
  const fir = (x, z, m = 2.2) => T(x, z, 1, 1, 5 + R() * 1.5, 'wall', { tree: true, fir: true }, m);
  const grove = (x0, z0, w, d, n, m = 2.2) => { for (let k = 0; k < n; k++) fir(x0 + R() * w, z0 + R() * d, m); };
  const drift = (x, z, along = true) => T(x, z, along ? 4 + R() * 2 : 1.1, along ? 1.1 : 4 + R() * 2, 1.1, 'sandbag', { drift: true });
  // Extraction's landing zones, reserved before anything is placed so scatter keeps off them (see br.exfils).
  const LZ_RING = [[110, 170], [36, 96], [330, 156], [352, 340], [120, 280], [240, 384], [330, 100]];
  const LZ_FINAL = [[150, 92], [284, 92], [150, 296], [284, 270]];
  for (const [x, z] of [...LZ_RING, ...LZ_FINAL]) keep(x - 9, z - 9, 18, 18, 0);
  // The river and the roads' junctions stay clear too.
  for (const r of RIVER) keep(r.x, r.z, r.w, r.d, 1);
  const districts = [];
  const take = rec => {
    districts.push({ id: rec.id, name: rec.name, x: rec.x, z: rec.z, w: rec.w, h: rec.h });
    // A district's street zones become ploughed road strips (painted like the region's own), the rest stay zones.
    for (const zn of rec.zones) {
      if (zn.kind !== 'road') { P.zones.push(zn); continue; }
      const along = zn.w >= zn.d;
      P.roads.push(along ? { pts: [[zn.x, zn.z + zn.d / 2], [zn.x + zn.w, zn.z + zn.d / 2]], w: zn.d, kind: 'asphalt' }
        : { pts: [[zn.x + zn.w / 2, zn.z], [zn.x + zn.w / 2, zn.z + zn.d]], w: zn.w, kind: 'asphalt' });
    }
    return rec;
  };

  // ---- The open sea along the north edge (in 32 m lengths, so the streamer draws its banks tile by tile) ------------
  P.region = 'kvice';
  for (let s = 0; s < W; s += 32) A(s, 0, Math.min(32, W - s), 8, 0, 'water', { sea: true });
  P.zones.push({ x: 0, z: 8, w: W, d: 30, kind: 'seaice' });
  for (const r of RIVER) P.zones.push({ ...r, kind: 'river' });

  // ---- The districts ------------------------------------------------------------------------------------------
  // Each is its 6v6 map placed as it is (border dropped, blocks opened up into buildings to loot), with loot out round
  // its cover. Telemark is the tier 1 district; the other three are tier 2.
  const district = (id, map, name, poiX, poiZ, r, tier, style) => {
    const at = DISTRICTS[id];
    poi(id, name, poiX, poiZ, r, 'kvtown', tier);
    take(placeDistrict(P, map, at.x, at.z, { skin: 'north', style, id, name }));
    keep(at.x, at.z, map.width, map.height);
    P.outdoorLoot(at.x + map.width / 2, at.z + map.height / 2, Math.min(map.width, map.height) / 2, Math.round(map.width * map.height / 300), tier);
  };
  district('telemark', telemark, 'Telemark', 88, 220, 40, 1, 'kvchalet');
  district('trawler', trawler, 'Trawler Basin', 200, 64, 30, 2, 'kvboathouse');
  district('icecore', icecore, 'Ice Core', 328, 220, 30, 2, 'kvlab');
  district('spillway', spillway, 'Spillway', 220, 318, 22, 2, 'kvplant');

  // ---- Kaldvik Town (the middle): the square and its tree, the church, the town hall, four blocks of shops and flats ---
  poi('town', 'Kaldvik Town', 205, 152, 36, 'kvtown', 1);
  P.zones.push({ x: 158, z: 140, w: 92, d: 20, kind: 'square' });
  const NORD = { style: 'kvnordic', tall: 0.18, yard: 0.08, lot: [9, 13], h: [3.8, 4.8], towerH: [5.4, 7], towerSkin: 'north', windowEvery: 5 };
  // The church (north-east of the square): nave and its steeple, which stays solid.
  B(214, 108, 26, 14, { h: 6, style: 'kvchurch', split: false, furnish: 2, chest: true, loot: 7, doors: [['s', 0.3], ['s', 0.7], ['w', 0.5], ['n', 0.5]] });
  A(242.5, 110, 5, 5, 13, 'building', { steeple: true, landmark: true, skin: 'north' });
  // The town hall (south-east of the square).
  B(212, 162, 30, 14, { h: 5.6, style: 'kvhall', furnish: 2, chest: true, loot: 8, doors: [['n', 0.2], ['n', 0.5], ['n', 0.8], ['s', 0.3], ['s', 0.7], ['e', 0.5]] });
  cityBlock(P, 154, 97, 42, 39, NORD);
  cityBlock(P, 154, 162, 42, 50, NORD);
  cityBlock(P, 206, 180, 56, 32, NORD);
  cityBlock(P, 206, 127, 52, 10, { ...NORD, lot: [9, 12], rows: 1 });
  // The square: the town's tree, benches, a frozen fountain, the market's stalls.
  P.skin = 'north';
  A(203.5, 147.5, 1.6, 1.6, 9, 'wall', { tree: true, fir: true, towntree: true, landmark: true });
  A(176, 143.5, 5, 4, 0, 'water', { fountain: true });
  for (const [x, z] of [[164, 142], [184, 156.4], [226, 142], [240, 156.4]]) A(x, z, 2.2, 0.6, 0.9, 'barrier', { bench: true });
  for (const [x, z] of [[214, 154], [220, 154], [232, 143]]) T(x, z, 3, 2, 2.2, 'barrier', { stall: true }, 1.4);
  P.skin = null;
  P.outdoorLoot(205, 150, 32, 6, 1);

  // ---- Birchwood (south of the Fjord Road): detached houses among the birches, a school -------------------------------
  poi('birchwood', 'Birchwood', 214, 262, 34, 'kvtown', 3);
  B(156, 232, 22, 12, { h: 4.4, style: 'kvnordic', furnish: 2, chest: true, doors: [['n', 0.3], ['n', 0.7], ['s', 0.5], ['w', 0.5]] });     // The school.
  for (const [x, z] of [[156, 254], [172, 256], [156, 274], [176, 276], [210, 232], [226, 234], [244, 230], [210, 254], [228, 256], [246, 252], [212, 276], [232, 278], [250, 272], [176, 236]]) {
    if (!P.free(x, z, 10, 8, 2.4)) continue;
    B(x, z, 9 + R() * 2, 7 + R() * 1.5, { h: 3.8 + R() * 0.6, style: 'kvnordic', doors: R() < 0.5 ? [['s', 0.5], ['n', 0.5]] : [['w', 0.5], ['e', 0.5]] });
  }
  P.skin = 'north';
  for (let k = 0; k < 26; k++) T(152 + R() * 108, 228 + R() * 66, 0.8, 0.8, 5, 'wall', { tree: true, birch: true }, 2.2);
  P.skin = null;
  P.outdoorLoot(214, 262, 34, 5, 3);

  // ---- Cannery (north-west shore, on Quay Street) ------------------------------------------------------------------
  poi('cannery', 'Cannery', 96, 64, 32, 'kvquay', 2);
  P.zones.push({ x: 56, z: 38, w: 92, d: 22, kind: 'quay' });
  B(64, 70, 36, 16, { h: 6, style: 'kvboathouse', split: true, furnish: 2, chest: true, loot: 9, doors: [['n', 0.2, 3], ['n', 0.8, 3], ['s', 0.3], ['s', 0.7], ['w', 0.5], ['e', 0.5]] });
  B(108, 72, 16, 12, { h: 4.6, style: 'kvboathouse', furnish: 2, doors: [['n', 0.5, 3], ['s', 0.5], ['w', 0.5]] });
  B(128, 72, 12, 10, { h: 4, style: 'kvnordic', doors: [['n', 0.5], ['e', 0.5]] });
  B(70, 42, 12, 10, { h: 4, style: 'kvboathouse', doors: [['s', 0.5, 3], ['e', 0.5]] });
  B(100, 42, 14, 10, { h: 4.2, style: 'kvboathouse', doors: [['s', 0.3, 3], ['s', 0.75], ['w', 0.5]] });
  P.skin = 'north';
  // Two boats frozen in at the cannery's quay, a crane.
  A(66, 24, 15, 4.6, 3.2, 'hull', { trawler: true, bow: -1 });
  A(108, 26, 13, 4.2, 3, 'hull', { trawler: true, bow: 1 });
  A(90, 33, 1.2, 1.2, 6.5, 'crane', { quaycrane: true });
  for (const [x, z] of [[86, 46], [122, 50], [60, 56], [134, 44]]) T(x, z, 1.6, 1.6, 1.1, 'crate', { fishbox: true });
  for (const [x, z] of [[118, 90], [88, 92]]) T(x, z, 2.5, 6, 2.6, 'container', {});
  P.skin = null;
  P.outdoorLoot(96, 60, 32, 9, 2);

  // ---- Lighthouse Point (north-west headland) ---------------------------------------------------------------------
  poi('lighthouse', 'Lighthouse Point', 28, 36, 22, 'kvquay', 3);
  A(20, 22, 4, 4, 11, 'building', { lighthouse: true });
  B(30, 34, 12, 9, { h: 3.8, style: 'kvnordic', chest: true, doors: [['s', 0.5], ['w', 0.5]] });
  B(10, 44, 9, 7, { h: 3.4, style: 'kvboathouse', doors: [['e', 0.5], ['n', 0.5]] });
  P.skin = 'north';
  for (const [x, z, w, d, h] of [[6, 14, 5, 4, 2.2], [40, 14, 6, 4, 2.6], [46, 50, 4, 3, 1.8]]) T(x, z, w, d, h, 'rock', { crag: true, snowcap: true });
  P.skin = null;
  P.outdoorLoot(28, 36, 22, 4, 3);

  // ---- Tank Farm (north-east shore, on Quay Street) ----------------------------------------------------------------
  poi('tankfarm', 'Tank Farm', 318, 62, 32, 'kvquay', 2);
  P.zones.push({ x: 290, z: 38, w: 66, d: 50, kind: 'lot' });
  P.skin = 'north';
  for (const [x, z] of [[294, 40], [308, 40], [322, 40], [294, 72], [308, 72]]) A(x, z, 9, 9, 7, 'building', { tank: true, keep: true });
  P.skin = null;
  B(326, 72, 18, 12, { h: 4.6, style: 'kvshed', furnish: 2, chest: true, loot: 7, doors: [['w', 0.5], ['n', 0.5], ['s', 0.5]] });
  B(342, 44, 12, 10, { h: 4, style: 'kvshed', doors: [['w', 0.5], ['s', 0.5]] });
  P.skin = 'north';
  for (const [x, z, w, d] of [[294, 54, 9, 1, 0], [308, 54, 9, 1, 0]]) T(x, z + 1.4, w, d, 0.95, 'barrier', { penstock: true }, 1.2);
  for (const [x, z] of [[338, 60], [350, 64], [300, 86]]) T(x, z, 1.5, 1.5, 1.1, 'crate', { drums: true });
  P.skin = null;
  P.outdoorLoot(318, 62, 30, 7, 2);

  // ---- Radar Dome (on the shelf, north-east) --------------------------------------------------------------------------
  poi('radar', 'Radar Dome', 360, 128, 26, 'kvshelf', 3);
  P.skin = 'north';
  A(354, 112, 10, 10, 8, 'building', { radome: true, keep: true });
  A(380, 134, 0.8, 0.8, 12, 'wall', { anemometer: true });
  P.skin = null;
  B(340, 132, 16, 9, { h: 3.8, style: 'kvlab', chest: true, doors: [['n', 0.5], ['e', 0.5], ['w', 0.5]] });
  B(366, 146, 12, 8, { h: 3.6, style: 'kvlab', doors: [['n', 0.5], ['w', 0.5]] });
  P.outdoorLoot(360, 128, 24, 4, 3);

  // ---- Freight Depot (west, on the ore line) ----------------------------------------------------------------------------
  poi('depot', 'Freight Depot', 104, 128, 30, 'kvtown', 2);
  P.zones.push({ x: 62, z: 98, w: 84, d: 28, kind: 'ballast' });
  P.skin = 'north';
  for (const [x, z] of [[70, 102.7], [92, 102.7], [116, 102.7], [80, 118.7], [100, 118.7]]) A(x, z, 9, 2.6, 2.8, 'container', { wagon: true, ore: true });
  P.skin = null;
  B(70, 130, 30, 14, { h: 6, style: 'kvshed', split: false, furnish: 2, chest: true, loot: 8, doors: [['n', 0.25, 3], ['n', 0.75, 3], ['s', 0.5, 3], ['w', 0.5], ['e', 0.5]] });
  B(108, 132, 16, 12, { h: 4.6, style: 'kvshed', doors: [['n', 0.5, 3], ['s', 0.5], ['e', 0.5]] });
  B(126, 152, 12, 10, { h: 4, style: 'kvnordic', doors: [['n', 0.5], ['e', 0.5], ['w', 0.5]] });
  P.skin = 'north';
  for (const [x, z] of [[132, 128], [76, 154], [100, 154]]) T(x, z, 2.5, 6, 2.6, 'container', {});
  P.skin = null;
  P.outdoorLoot(104, 128, 30, 8, 2);

  // ---- Logging Camp (west, in the forest) ---------------------------------------------------------------------------
  poi('logging', 'Logging Camp', 30, 146, 26, 'kvforest', 3);
  B(14, 132, 22, 12, { h: 5, style: 'kvshed', split: false, furnish: 2, chest: true, doors: [['e', 0.5, 3], ['n', 0.5], ['s', 0.5]] });      // The sawmill.
  B(36, 158, 10, 8, { h: 3.6, style: 'kvchalet', doors: [['w', 0.5], ['n', 0.5]] });
  B(12, 162, 9, 8, { h: 3.4, style: 'kvchalet', doors: [['e', 0.5], ['n', 0.5]] });
  P.skin = 'north';
  for (const [x, z, along] of [[42, 128, true], [42, 140, true], [14, 118, true], [30, 176, false]]) T(x, z, along ? 8 : 2.4, along ? 2.4 : 8, 1.6, 'container', { logs: true }, 1.6);
  grove(4, 84, 52, 30, 22);
  grove(4, 176, 26, 10, 6);
  grove(120, 160, 26, 24, 12);
  P.skin = null;
  P.outdoorLoot(30, 146, 26, 5, 3);

  // ---- Ski Jump and the slopes (south-west) -------------------------------------------------------------------------
  poi('skijump', 'Ski Jump', 30, 292, 24, 'kvpiste', 3);
  P.skin = 'north';
  A(22, 270, 6, 26, 9, 'building', { skijump: true, landmark: true });
  P.skin = null;
  B(36, 298, 12, 9, { h: 4, style: 'kvchalet', chest: true, doors: [['n', 0.5], ['e', 0.5]] });
  B(6, 300, 10, 8, { h: 3.6, style: 'kvchalet', doors: [['e', 0.5], ['n', 0.5]] });
  P.zones.push({ x: 12, z: 296, w: 26, d: 18, kind: 'piste' }, { x: 60, z: 256, w: 60, d: 54, kind: 'piste' });
  P.outdoorLoot(30, 292, 22, 4, 3);
  // The chairlift from Telemark up to the summit, on its pylons.
  P.skin = 'north';
  for (let z = 262; z < 352; z += 16) T(87.6, z, 0.8, 0.8, 7, 'wall', { pylon: true }, 1.4);
  grove(4, 254, 24, 14, 8);
  grove(46, 256, 12, 52, 10);
  grove(112, 256, 30, 54, 16);
  P.skin = null;

  // ---- Summit Lodge (south-west corner) ---------------------------------------------------------------------------
  poi('summit', 'Summit Lodge', 56, 364, 30, 'kvpiste', 2);
  B(34, 352, 28, 14, { h: 5.6, style: 'kvchalet', furnish: 2, chest: true, loot: 8, doors: [['n', 0.3], ['n', 0.7], ['s', 0.5], ['e', 0.5], ['w', 0.5]] });
  B(70, 370, 14, 10, { h: 4.2, style: 'kvchalet', doors: [['n', 0.5], ['w', 0.5]] });
  B(12, 376, 12, 9, { h: 3.8, style: 'kvchalet', doors: [['n', 0.5], ['e', 0.5]] });
  P.skin = 'north';
  A(84, 352, 6, 6, 4.2, 'building', { liftstation: true, landmark: true });
  for (const [x, z, w, d, h] of [[4, 330, 8, 6, 3], [70, 390, 10, 5, 3.5], [30, 390, 8, 6, 3]]) T(x, z, w, d, h, 'rock', { crag: true, snowcap: true });
  P.skin = null;
  P.outdoorLoot(56, 364, 28, 6, 2);

  // ---- Ice Fishing Camp (out on the reservoir, west of the dam) ------------------------------------------------------
  poi('icefish', 'Ice Fishing Camp', 150, 356, 30, 'kvlake', 3);
  P.zones.push({ x: 104, z: 326, w: 86, d: 66, kind: 'lake' });
  P.skin = 'north';
  for (const [x, z] of [[126, 340], [140, 352], [156, 344], [168, 362], [134, 372], [150, 380], [176, 344]]) T(x, z, 2.4, 2.4, 2.4, 'building', { shanty: true }, 2.4);
  for (const [x, z, w, d] of [[112, 360, 6, 2.4], [160, 330, 3, 5], [180, 384, 5, 2.6]]) T(x, z, w, d, 0, 'water', { lead: true }, 2.4);
  P.skin = null;
  B(110, 328, 12, 8, { h: 3.6, style: 'kvboathouse', chest: true, doors: [['s', 0.5, 3], ['n', 0.5]] });
  B(160, 306, 14, 8, { h: 3.8, style: 'kvnordic', doors: [['n', 0.5], ['s', 0.5]] });
  P.outdoorLoot(150, 356, 30, 6, 3);

  // ---- Turbine Hall (below the dam, east) ----------------------------------------------------------------------------
  poi('turbine', 'Turbine Hall', 290, 342, 30, 'kvsnow', 2);
  B(262, 340, 34, 16, { h: 6.4, style: 'kvplant', split: true, furnish: 2, chest: true, loot: 9, doors: [['n', 0.2, 3], ['n', 0.8, 3], ['s', 0.5, 3], ['w', 0.5], ['e', 0.5]] });
  B(302, 326, 12, 10, { h: 4, style: 'kvplant', doors: [['w', 0.5], ['s', 0.5]] });
  P.skin = 'north';
  for (const [x, z] of [[302, 344], [308, 344], [302, 352], [308, 352]]) T(x, z, 3, 3, 2.6, 'container', { transformer: true }, 1.2);
  for (const [x, z] of [[320, 330], [320, 360]]) T(x, z, 1.2, 1.2, 12, 'crane', { pylon: true, power: true }, 1.6);
  P.skin = null;
  P.outdoorLoot(290, 342, 28, 6, 2);

  // ---- Shelf Airstrip (south-east, on the shelf) ------------------------------------------------------------------
  poi('airstrip', 'Shelf Airstrip', 340, 276, 34, 'kvshelf', 2);
  P.zones.push({ x: 296, z: 252, w: 100, d: 16, kind: 'runway' });
  B(304, 276, 26, 14, { h: 6, style: 'hangar', split: false, furnish: 2, chest: true, loot: 8, doors: [['n', 0.5, 4], ['s', 0.3], ['s', 0.7], ['e', 0.5]] });
  B(340, 280, 10, 8, { h: 3.6, style: 'kvlab', doors: [['n', 0.5], ['w', 0.5]] });
  P.skin = 'north';
  A(352, 272, 4, 4, 9, 'building', { tower: true, controltower: true, keep: true });
  T(364, 278, 10, 3, 2.4, 'hull', { plane: true }, 1.6);
  for (const [x, z] of [[380, 278], [334, 296], [372, 296]]) T(x, z, 1.5, 1.5, 1.1, 'crate', { drums: true });
  P.skin = null;
  P.outdoorLoot(340, 278, 32, 6, 2);

  // ---- Hot Springs (south-east corner) -------------------------------------------------------------------------------
  poi('springs', 'Hot Springs', 340, 368, 28, 'kvsnow', 3);
  B(312, 372, 16, 10, { h: 4, style: 'kvchalet', chest: true, doors: [['n', 0.5], ['s', 0.5], ['e', 0.5]] });     // The bathhouse.
  B(366, 382, 8, 7, { h: 3.2, style: 'kvchalet', doors: [['w', 0.5], ['n', 0.5]] });                              // A sauna.
  P.skin = 'north';
  for (const [x, z, w, d] of [[340, 356, 8, 6], [354, 364, 6, 5], [342, 372, 7, 5]]) T(x, z, w, d, 0, 'water', { hotspring: true }, 2.4);
  for (const [x, z, w, d, h] of [[380, 352, 6, 5, 2.6], [298, 388, 6, 5, 2.2]]) T(x, z, w, d, h, 'rock', { crag: true, snowcap: true });
  P.skin = null;
  P.outdoorLoot(340, 368, 26, 5, 3);

  // ---- Ice Core's camp round it on the shelf: more pods, the balloon shed ----------------------------------------------
  P.region = 'kvshelf'; P.tier = 2;
  B(298, 164, 16, 7, { h: 3.8, style: 'kvlab', doors: [['s', 0.5], ['e', 0.5], ['w', 0.5]] });
  B(326, 166, 14, 7, { h: 3.8, style: 'kvlab', doors: [['s', 0.5], ['w', 0.5]] });
  B(372, 232, 14, 7, { h: 3.6, style: 'kvlab', doors: [['n', 0.5], ['w', 0.5]] });
  B(376, 196, 12, 10, { h: 5, style: 'hangar', doors: [['w', 0.5, 3], ['s', 0.5]] });     // The balloon shed.
  P.skin = 'north';
  for (const [x, z] of [[316, 180], [352, 182], [376, 240], [300, 250]]) T(x, z, 1.5, 1.5, 1.1, 'crate', { drums: true });
  for (const [x, z] of [[370, 170], [304, 186]]) T(x, z, 5.2, 2.6, 2.6, 'container', { snowcat: true });
  P.skin = null;

  // ---- The blocks along the Fjord Road between Telemark and town, and round the harbour --------------------------------
  P.region = 'kvtown'; P.tier = 2;
  B(242, 96, 16, 10, { h: 4.2, style: 'kvboathouse', doors: [['n', 0.5, 3], ['s', 0.5], ['w', 0.5]] });            // Harbour office.
  P.outdoorLoot(250, 100, 16, 2, 2);

  // ---- Forests, rock and drifts in the open; icebergs and pressure ridges out on the sea ice --------------------------
  P.skin = 'north';
  P.region = 'kvforest';
  grove(4, 196, 26, 54, 14);
  grove(120, 290, 60, 26, 10);
  grove(226, 290, 30, 30, 10, 2.4);
  grove(4, 64, 50, 18, 10);
  grove(248, 372, 52, 26, 14);
  grove(196, 340, 60, 50, 18);
  P.region = 'kvsnow';
  for (let k = 0; k < 40; k++) drift(8 + R() * 384, 90 + R() * 300, R() < 0.5);
  P.region = 'kvice';
  for (let k = 0; k < 18; k++) {
    const x = 6 + R() * 380, z = 10 + R() * 22, s = 3 + R() * 4;
    T(x, z, s, s * (0.6 + R() * 0.5), 2 + R() * 3, 'rock', { berg: true }, 2.4);
  }
  for (let k = 0; k < 16; k++) T(6 + R() * 380, 12 + R() * 22, 5 + R() * 4, 0.9, 1.1, 'sandbag', { ridge: true }, 2);
  for (let k = 0; k < 8; k++) T(10 + R() * 370, 14 + R() * 18, 4 + R() * 5, 2 + R() * 1.5, 0, 'water', { lead: true }, 2.4);
  // Leads in the river (open water the dam's outflow keeps from freezing): they block, so each leaves room both sides.
  P.region = 'kvice';
  for (const [x, z, w, d] of [[265, 130, 6, 8], [265, 250, 6, 10], [264, 170, 8, 5], [256, 326, 6, 6]]) {
    if (P.free(x, z, w, d, 2.4)) P.add(x, z, w, d, 0, 'water', { lead: true, skin: 'north' });
  }
  P.skin = null;

  // ---- Parked vehicles on the roads: cars and snowmobiles by the kerbs --------------------------------------------------
  P.region = 'kvtown'; P.skin = 'north';
  const rnd = mulberry(7771);
  for (const rd of ROADS) {
    if (rd.kind !== 'asphalt') continue;
    const [[ax, az], [bx, bz]] = [rd.pts[0], rd.pts[rd.pts.length - 1]];
    const horiz = Math.abs(bz - az) < Math.abs(bx - ax), L = Math.hypot(bx - ax, bz - az);
    for (let s = 8; s < L - 8; s += 12 + rnd() * 18) {
      if (rnd() < 0.45) continue;
      const side = rnd() < 0.5 ? -1 : 1, off = rd.w / 2 - 1.2;
      const px = horiz ? ax + s : ax + side * off, pz = horiz ? az + side * off : az + s;
      if (rnd() < 0.3) { T(horiz ? px - 1.2 : px - 0.6, horiz ? pz - 0.6 : pz - 1.2, horiz ? 2.4 : 1.2, horiz ? 1.2 : 2.4, 1.1, 'barrier', { sled: true, car: true }, 1.2); continue; }
      T(horiz ? px - 2.1 : px - 0.95, horiz ? pz - 0.95 : pz - 2.1, horiz ? 4.2 : 1.9, horiz ? 1.9 : 4.2, 1.4, 'barrier', { car: true }, 1.2);
    }
  }
  P.skin = null;

  // The edge: border walls in tile-sized lengths (the renderer streams them), open to the sea in the north.
  for (let s = 0; s < W; s += 32) {
    const len = Math.min(32, W - s);
    for (const [x, z, w, d, open, reg] of [[s, -1.5, len, 1.5, true, 'kvice'], [s, H, len, 1.5, false, 'kvsnow'], [-1.5, s, 1.5, len, s < 8, 'kvforest'], [W, s, 1.5, len, s < 8, 'kvshelf']]) {
      P.walls.push(wall(x, z, w, d, 4, 'border', { region: reg, ...(open ? { open: true } : {}) }));
    }
  }

  // ---- Extraction's landing zones (docs/EXTRACT.md; js/sim/extract.js reads br.exfils): named and reserved (LZ_RING,
  // LZ_FINAL): the logging clearing, the lighthouse meadow, the shelf by the radar, the springs' snowfield, the piste's
  // foot, the reservoir's south shore and the tank farm's yard for the ring; the final out at one of the four junctions
  // round town; squads come in round the edge.
  const clearSq = (x, z, r) => x > r + 2 && z > r + 2 && x < W - r - 2 && z < H - r - 2 && P.near(x - r, z - r, 2 * r, 2 * r).size === 0
    && !P.roofs.some(f => x > f.x - r && x < f.x + f.w + r && z > f.z - r && z < f.z + f.d + r);
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
    for (let r = 182; r > 140 && !got; r -= 3) for (const da of [0, 0.1, -0.1, 0.2, -0.2]) {
      if (got) break;
      got = clearSq(200 + Math.cos(a + da) * r, 200 + Math.sin(a + da) * r, 5) ? { x: Math.round(200 + Math.cos(a + da) * r), z: Math.round(200 + Math.sin(a + da) * r) } : null;
    }
    if (got) inserts.push(got);
  }
  const exfils = { ring, final, inserts };

  // Nothing a bot cannot walk to (a corner pocket behind furniture): flooded from the square.
  pruneUnreachable(P, 196, 150);

  // Supply caches out in the open, by cover, away from the places.
  P.region = 'kvsnow';
  const crnd = mulberry(4093);
  let caches = 0;
  for (let tries = 0; tries < 4000 && caches < 8; tries++) {
    const x = 20 + crnd() * (W - 40), z = 44 + crnd() * (H - 64);
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
  const lanes = [{ id: 'quay', z: 64 }, { id: 'front', z: 92 }, { id: 'church', z: 150 }, { id: 'fjord', z: 220 }, { id: 'dam', z: 318 }];

  const circleBias = P.pois.map(p => ({ x: p.x, z: p.z, w: p.tier === 1 ? 1 : p.tier === 2 ? 0.8 : 0.5 }))
    .concat([[150, 150], [284, 150], [150, 270], [200, 220], [96, 290]].map(([x, z]) => ({ x, z, w: 0.4 })));
  // Rebound's compact areas: over the town and the districts round it, kept off the open sea and the corners.
  const reboundAreas = [{ x: 200, z: 196, r: 150 }, { x: 176, z: 206, r: 150 }, { x: 226, z: 206, r: 150 }, { x: 200, z: 224, r: 150 }];

  // Conquest and Breakthrough (docs/MODES.md "Layout format"): the Fjord Road west to east, and the Harbour Road north
  // to south from the harbour to the dam. Every point is moved onto open ground round its place.
  const pt = (x, z, extra = {}) => ({ ...spot(x, z), ...extra });
  const bf = {
    conquest: [{
      id: 'fjord', name: 'Kaldvik: Fjord Road', area: { x: 20, z: 128, w: 364, h: 166 },
      hq: [pt(26, 220, { r: 10 }), pt(380, 220, { r: 10 })],
      flags: [
        pt(88, 220, { id: 'A', name: 'Telemark' }), pt(204, 160, { id: 'B', name: 'Kaldvik Town' }), pt(268, 220, { id: 'C', name: 'River Crossing' }),
        pt(214, 262, { id: 'D', name: 'Birchwood' }), pt(328, 220, { id: 'E', name: 'Ice Core' }),
      ],
    }],
    breakthrough: [{
      id: 'harbourrun', name: 'Kaldvik: Harbour Run', area: { x: 140, z: 20, w: 120, h: 336 }, tickets: 300, refill: 240,
      hq: [pt(200, 26, { r: 10 }), pt(226, 348, { r: 10 })],
      sectors: [
        { name: 'Trawler Basin', objs: [pt(190, 60), pt(212, 70)] },
        { name: 'Kaldvik Town', objs: [pt(186, 150), pt(214, 156)] },
        { name: 'Spillway', objs: [pt(206, 318), pt(232, 318)] },
      ],
    }],
  };

  return {
    id: 'kaldvik', name: 'Kaldvik', theme: 'kaldvik', size: 'giant', region: 'arctic', width: W, height: H,
    walls: P.walls, spawns, lanes, nav, points: { dom: [], hard: [] },
    rooms: P.rooms, roofs: P.roofs, zones: P.zones, roads: P.roads, rails: P.rails, regionSeeds: REGION_SEEDS,
    districts, modes: ['br'], large: true, bf,
    br: { pois: P.pois, loot: P.loot, chests: P.chests, drop: null, circleBias, reboundAreas, exfils },
  };
}

export default build();
