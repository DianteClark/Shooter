// Battle royale (docs/DISTRICTS.md): Sirocco Basin, 400 x 400 m, the second region, the desert at dusk with a
// sandstorm coming in from the west. Four districts, each a 6v6 map of its own built to fit the basin, are placed edge
// to edge along the Spice Road and joined by the basin's tracks, with the rest of the basin built round them:
//   Red Gulch (redgulch)         the canyon town, where the road comes in from the west between the cliffs
//   Caravanserai (caravanserai)  the walled caravan inn round its well, the middle of the basin
//   Signal Ridge (signalridge)   the dish array on its ridge, north-east of the inn, where the road forks north
//   Copperstep (copperstep)      the open-pit copper mine, south-east of the inn, where it forks south
// The Spice Road (z 200) runs from the west edge through the canyon, the gulch and the inn to the fork at x 256. Round
// them: the Rail Halt, the Citadel, the Fuel Stop and the Airstrip on the Highway across the north; the Necropolis and
// Gulch Mouth in the canyon; the Souk Quarter and Lower Town either side of the inn; the Pump Station, the Smelter and
// the Wreck Dunes in the east and south; the Date Grove, the Nomad Camp and the Saltworks in the south-west.
// The district files are the source of truth (js/shared/maps/region-kit.js placeDistrict); nothing here changes them.
// Contract: docs/BR.md. Dressed by the giant-world streamer (js/render/themes/frontier.js) with the basin's palette and
// extras (js/render/themes/basin.js); district pieces by their own 6v6 drawers (js/render/themes/sirocco.js).
import { wall } from './build.js';
import { Plan, mulberry, segDist } from './br-kit.js';
import { placeDistrict, cityBlock, pruneUnreachable } from './region-kit.js';
import caravanserai from './caravanserai.js';
import redgulch from './redgulch.js';
import copperstep from './copperstep.js';
import signalridge from './signalridge.js';

const W = 400, H = 400;

// Where each district sits (north-west corner, region metres). The gulch and the inn share the Spice Road at z 200
// (their middle lanes) with the 12 m Seam between them; the ridge and the mine sit east of the inn across the 12 m
// Fork Road (x 256), their middle lanes the road's two branches (z 151 and 249).
export const DISTRICTS = {
  redgulch: { x: 82, z: 182 },
  caravanserai: { x: 150, z: 168 },
  signalridge: { x: 262, z: 128 },
  copperstep: { x: 262, z: 224 },
};

// Ground regions for the renderer: [region, x, z, bias] (themes/basin.js colours them).
export const REGION_SEEDS = [
  ['dunes', 200, 200, 20], ['dunes', 200, 360], ['dunes', 300, 350], ['dunes', 120, 300], ['dunes', 330, 200], ['dunes', 200, 120],
  ['scrub', 90, 60], ['scrub', 330, 60], ['scrub', 200, 60], ['scrub', 40, 280], ['scrub', 380, 140],
  ['gulch', 50, 200, 10], ['gulch', 110, 200], ['gulch', 40, 160], ['gulch', 40, 240], ['gulch', 300, 151],
  ['saltpan', 70, 360, 10], ['saltpan', 20, 390],
  ['spoil', 302, 249, 6], ['spoil', 370, 280], ['spoil', 350, 330],
];

// Tracks: polylines with a width. They stop at the district edges: inside a district its own road zone is the track.
const ROADS = [
  // The Spice Road, west to east, and the Fork Road with its two branches.
  { pts: [[0, 200], [82, 200]], w: 8, kind: 'dirt' },
  { pts: [[138, 200], [150, 200]], w: 8, kind: 'dirt' },
  { pts: [[250, 200], [256, 200]], w: 8, kind: 'dirt' },
  { pts: [[256, 104], [256, 296]], w: 8, kind: 'dirt' },          // The Fork Road, from the Highway down past the mine.
  { pts: [[338, 151], [400, 151]], w: 7, kind: 'dirt' },          // The ridge track east to the Pump Station.
  { pts: [[342, 249], [400, 249]], w: 7, kind: 'dirt' },          // The mine's haul road east to the Smelter.
  // Round the inn: the Souk Lane north of it, the Well Lane south of it, the Seam between it and the gulch.
  { pts: [[144, 162], [256, 162]], w: 7, kind: 'dirt' },
  { pts: [[144, 238], [256, 238]], w: 7, kind: 'dirt' },
  { pts: [[144, 104], [144, 162]], w: 8, kind: 'dirt' },
  { pts: [[144, 238], [144, 300]], w: 8, kind: 'dirt' },
  // The Highway across the north, and the tracks off it.
  { pts: [[0, 104], [400, 104]], w: 9, kind: 'asphalt' },
  { pts: [[30, 104], [30, 400]], w: 7, kind: 'dirt' },            // The west track, through the canyon's two passes.
  { pts: [[200, 0], [200, 50]], w: 7, kind: 'dirt' },             // Up to the Citadel's north gate.
  { pts: [[200, 242], [200, 400]], w: 7, kind: 'dirt' },          // South through Lower Town into the dunes.
  { pts: [[256, 296], [330, 340]], w: 7, kind: 'dirt' },          // Down to the wreck.
];
// The railway across the north (renderer: horizontal lines, sleepers and two rails).
const RAILS = [{ pts: [[-30, 34], [270, 34]] }, { pts: [[-30, 39], [270, 39]] }, { pts: [[40, 23], [140, 23]] }];

function build() {
  const P = new Plan(W, H, 2211);
  const R = P.rnd;
  const B = (x, z, w, d, o) => P.building(x, z, w, d, o);
  const A = (x, z, w, d, h, kind, extra = {}) => P.add(x, z, w, d, h, kind, extra);
  P.roads = [...ROADS]; P.rails = RAILS;
  P.keepOut = [];
  P.doorPts = [];
  const building0 = P.building.bind(P);
  P.building = (...a) => { const r = building0(...a); P.doorPts.push(...r.doors); return r; };
  const onRoad = (x, z, w, d) => ROADS.some(rd => {
    for (let i = 1; i < rd.pts.length; i++) if (segDist(x + w / 2, z + d / 2, ...rd.pts[i - 1], ...rd.pts[i]) < rd.w / 2 + Math.max(w, d) / 2 + 0.5) return true;
    return false;
  });
  // Clutter, cover and rock: only where it leaves no narrow gap, keeps off every district (and its margin), the
  // landing zones and the ground in front of every door, and (unless it is a parked vehicle) off the tracks.
  const fits = (x, z, w, d, extra = {}, m = 1.6) => !P.keepOut.some(k => x < k.x + k.w && x + w > k.x && z < k.z + k.d && z + d > k.z)
    && !P.doorPts.some(([dx, dz]) => dx > x - 3.2 && dx < x + w + 3.2 && dz > z - 3.2 && dz < z + d + 3.2)
    && (extra.car || extra.wagon || !onRoad(x, z, w, d)) && P.free(x, z, w, d, m);
  const T = (x, z, w, d, h, kind, extra = {}, m = 1.6) => (fits(x, z, w, d, extra, m) ? P.add(x, z, w, d, h, kind, extra) : null);
  // A named place (br.pois' region is the map card's, 'desert'); what is built while it is current stands in the basin's
  // own ground region `reg` (themes/basin.js colours and dresses them).
  const poi = (id, name, x, z, r, reg, tier) => { P.poi(id, name, x, z, r, 'desert', tier); P.region = reg; };
  const keep = (x, z, w, d, m = 3) => P.keepOut.push({ x: x - m, z: z - m, w: w + 2 * m, d: d + 2 * m });
  // A cliff wall of layered sandstone (the districts' own cliff drawer, themes/sirocco.js), cut into pieces no longer
  // than 16 m so each tile draws its own; the pieces touch end to end. Tested once, whole: it may run to the map's edge.
  const cliffWall = (x, z, w, d, h) => {
    if (P.keepOut.some(k => x < k.x + k.w && x + w > k.x && z < k.z + k.d && z + d > k.z) || P.near(x, z, w, d, 1.6).size) return false;
    const seg = 16, along = w >= d, L = along ? w : d;
    for (let s = 0; s < L - 0.01; s += seg) {
      const n = Math.min(seg, L - s);
      if (along) A(x + s, z, n, d, h, 'rock', { cliff: true, skin: 'sirocco' }); else A(x, z + s, w, n, h, 'rock', { cliff: true, skin: 'sirocco' });
    }
    return true;
  };
  // Extraction's landing zones, reserved before anything is placed so nothing lands on them (see br.exfils).
  const LZ_RING = [[334, 63], [74, 352], [186, 364], [56, 312], [100, 80], [378, 206], [338, 384]];
  const LZ_FINAL = [[144, 162], [256, 162], [144, 238], [256, 238]];
  for (const [x, z] of [...LZ_RING, ...LZ_FINAL]) keep(x - 9, z - 9, 18, 18, 0);
  const districts = [];
  const take = rec => {
    districts.push({ id: rec.id, name: rec.name, x: rec.x, z: rec.z, w: rec.w, h: rec.h });
    // A district's road zone becomes a track strip (painted like the basin's own), the rest stay zones.
    for (const zn of rec.zones) {
      if (zn.kind !== 'road') { P.zones.push(zn); continue; }
      const along = zn.w >= zn.d;
      P.roads.push(along ? { pts: [[zn.x, zn.z + zn.d / 2], [zn.x + zn.w, zn.z + zn.d / 2]], w: zn.d, kind: 'dirt' }
        : { pts: [[zn.x + zn.w / 2, zn.z], [zn.x + zn.w / 2, zn.z + zn.d]], w: zn.w, kind: 'dirt' });
    }
    return rec;
  };

  // ---- The districts ------------------------------------------------------------------------------------------
  // Each is its 6v6 map placed as it is (border dropped, blocks opened up into buildings to loot), with loot out round
  // its cover: the inn a tier 1 place, the other three tier 2 (docs/DISTRICTS.md: three tier 1 places side by side
  // geared every squad in Rebound's area too fast).
  const district = (id, map, name, r, tier, style, region) => {
    const at = DISTRICTS[id];
    poi(id, name, at.x + map.width / 2, at.z + map.height / 2, r, region, tier);
    take(placeDistrict(P, map, at.x, at.z, { skin: 'sirocco', id, name, style }));
    keep(at.x, at.z, map.width, map.height);
    P.outdoorLoot(at.x + map.width / 2, at.z + map.height / 2, Math.min(map.width, map.height) / 2, Math.round(map.width * map.height / 300), tier);
  };
  district('caravanserai', caravanserai, 'Caravanserai', 44, 1, 'mudbrick', 'dunes');
  district('redgulch', redgulch, 'Red Gulch', 26, 2, 'ksar', 'gulch');
  district('signalridge', signalridge, 'Signal Ridge', 34, 2, 'prefab', 'gulch');
  district('copperstep', copperstep, 'Copperstep', 36, 2, 'tinshed', 'spoil');

  // ---- The canyon: its two walls run west from the gulch to the edge, with a pass through each for the west track ----
  P.region = 'gulch'; P.tier = 3;
  // (The final landing zones at the Seam's two ends keep the walls 1-2 m short of it.)
  cliffWall(0, 163, 26, 16, 8); cliffWall(34, 163, 100, 16, 8);
  cliffWall(0, 221, 26, 16, 8); cliffWall(34, 221, 100, 16, 8);
  // Fallen rock at the cliff feet, where they meet the canyon floor.
  for (const [x, z, w, d] of [[8, 179, 6, 2.4], [44, 179, 9, 3], [66, 179, 5, 2], [16, 218.6, 7, 2.4], [52, 218, 6, 3], [72, 219, 5, 2]]) A(x, z, w, d, 3.4, 'rock', { crag: true });

  // ---- Gulch Mouth (the canyon floor west of Red Gulch): mud houses either side of the road -----------------------------
  poi('mouth', 'Gulch Mouth', 46, 200, 30, 'gulch', 3);
  const MUD = { style: 'ksar', tall: 0.12, yard: 0.15, lot: [8, 11], h: [3.4, 4.4], towerH: [5, 6.5], towerSkin: 'sirocco', rows: 1 };
  cityBlock(P, 36, 182.5, 40, 12, MUD);
  cityBlock(P, 36, 205.5, 40, 12, MUD);
  cityBlock(P, 4, 182.5, 20, 12, MUD);
  cityBlock(P, 4, 205.5, 20, 12, MUD);
  P.outdoorLoot(46, 200, 30, 4, 3);

  // ---- The Necropolis (the canyon's north wall, its north face): tombs cut into the rock -----------------------------
  poi('tombs', 'Necropolis', 70, 146, 32, 'gulch', 2);
  for (const [x, w] of [[38, 10], [54, 12], [72, 10], [88, 14], [108, 10]]) {
    B(x, 151, w, 12, { h: 4.4, style: 'tomb', split: false, furnish: 1, loot: 3, chest: w >= 14, doors: [['n', 0.5, 2.6]], windows: false });
  }
  P.skin = 'sirocco';
  for (const [x, z] of [[46, 140], [64, 138], [84, 140], [102, 138], [120, 141]]) T(x, z, 1.2, 1.2, 3.6, 'wall', { obelisk: true }, 1.4);
  for (const [x, z] of [[40, 132], [96, 130], [76, 128]]) T(x, z, 2.2, 1.2, 1.0, 'barrier', { sarcophagus: true }, 1.4);
  P.skin = null;
  P.outdoorLoot(70, 140, 30, 6, 2);

  // ---- Rail Halt (north-west): the station, its platform, a water tower, the goods shed, wagons on the sidings ---------
  poi('halt', 'Rail Halt', 86, 52, 40, 'scrub', 2);
  P.zones.push({ x: 0, z: 30, w: 300, d: 13, kind: 'ballast' }, { x: 40, z: 19, w: 100, d: 8, kind: 'ballast' }, { x: 52, z: 43, w: 48, d: 3, kind: 'platform' });
  B(56, 46, 34, 12, { h: 4.6, style: 'station', furnish: 2, chest: true, loot: 7, doors: [['n', 0.25], ['n', 0.75], ['s', 0.3], ['s', 0.7], ['w', 0.5], ['e', 0.5]] });
  B(100, 50, 20, 14, { h: 5.4, style: 'tinshed', split: false, furnish: 2, loot: 6, doors: [['n', 0.5, 3.2], ['s', 0.5, 3.2], ['w', 0.5], ['e', 0.5]] });
  B(20, 50, 12, 9, { style: 'mudbrick', h: 3.6 });
  B(122, 6, 12, 9, { style: 'tinshed', h: 3.8, doors: [['s', 0.3], ['s', 0.75], ['w', 0.5]] });
  P.skin = 'sirocco';
  A(40, 52, 3, 3, 7.5, 'crane', { watertower: true });
  for (const [x, z] of [[14, 32.7], [38, 32.7], [110, 37.7], [150, 32.7], [180, 37.7], [62, 21.7], [92, 21.7]]) T(x, z, 10, 2.6, 2.8, 'container', { wagon: true, boxcar: true }, 1.2);
  for (const [x, z, w, d] of [[30, 66, 6, 2.5], [70, 70, 2.5, 6], [116, 72, 6, 2.5], [10, 8, 6, 2.5]]) T(x, z, w, d, 2.6, 'container', {});
  for (const [x, z] of [[48, 66], [96, 74], [130, 60], [24, 74]]) T(x, z, 1.6, 1.6, 1.1, 'crate', {});
  P.skin = null;
  P.outdoorLoot(86, 52, 40, 12, 2);

  // ---- The Citadel (north): the old fort's walls and towers, the keep and barracks inside, gates on all four sides -----
  poi('citadel', 'The Citadel', 205, 74, 40, 'scrub', 1);
  P.zones.push({ x: 170, z: 54, w: 70, d: 40, kind: 'serai' });
  {
    const x0 = 168, z0 = 52, x1 = 242, z1 = 96, t = 1.6, hh = 4.4;
    P.skin = 'sirocco';
    const rw = (x, z, w, d) => A(x, z, w, d, hh, 'wall', { rampart: true, landmark: true });
    // North and south walls with a 5 m gate in the middle of each; west and east with a 5 m gate.
    rw(x0, z0, 34.5, t); rw(x0 + 39.5, z0, x1 - x0 - 39.5, t);
    rw(x0, z1 - t, 34.5, t); rw(x0 + 39.5, z1 - t, x1 - x0 - 39.5, t);
    rw(x0, z0 + t, t, 18.6); rw(x0, z0 + t + 23.6, t, z1 - z0 - 2 * t - 23.6);
    rw(x1 - t, z0 + t, t, 18.6); rw(x1 - t, z0 + t + 23.6, t, z1 - z0 - 2 * t - 23.6);
    for (const [x, z] of [[x0 - 2, z0 - 2], [x1 - 4, z0 - 2], [x0 - 2, z1 - 4], [x1 - 4, z1 - 4]]) A(x, z, 6, 6, 7, 'adobe', { ksar: true, landmark: true });
    P.skin = null;
    B(192, 60, 26, 15, { h: 6, style: 'ksar', furnish: 2, chest: true, loot: 8, doors: [['s', 0.3], ['s', 0.7], ['n', 0.5], ['w', 0.5], ['e', 0.5]] });
    B(174, 80, 18, 9, { h: 4, style: 'mudbrick', furnish: 2, doors: [['n', 0.3], ['n', 0.75], ['e', 0.5]] });
    B(218, 80, 18, 9, { h: 4, style: 'mudbrick', furnish: 2, doors: [['n', 0.25], ['n', 0.7], ['w', 0.5]] });
    B(174, 57, 10, 9, { h: 3.8, style: 'mudbrick', doors: [['e', 0.5], ['s', 0.5]] });
    B(226, 57, 10, 9, { h: 3.8, style: 'mudbrick', doors: [['w', 0.5], ['s', 0.5]] });
    P.skin = 'sirocco';
    A(203.5, 85, 3, 3, 1.0, 'barrier', { well: true });
    for (const [x, z] of [[196, 78], [212, 90], [186, 92]]) T(x, z, 2.2, 1, 1.0, 'sandbag', { sacks: true }, 1.4);
    // Fallen stones round the outside.
    for (const [x, z] of [[160, 60], [252, 84], [232, 44], [156, 88], [248, 58]]) T(x, z, 2.4, 1.8, 1.2, 'boulder', { redrock: true }, 1.4);
    P.skin = null;
  }
  P.outdoorLoot(205, 74, 40, 10, 1);

  // ---- Fuel Stop (on the Highway, west of the Souk Quarter): pumps under a canopy, the diner, the motel ----------------
  poi('fuel', 'Fuel Stop', 104, 124, 24, 'scrub', 3);
  P.zones.push({ x: 84, z: 110, w: 46, d: 26, kind: 'forecourt' });
  B(86, 126, 14, 9, { h: 3.6, style: 'diner', furnish: 2, chest: true, doors: [['n', 0.5], ['e', 0.5]] });
  B(108, 128, 22, 8, { h: 3.4, style: 'diner', furnish: 1, doors: [['n', 0.2], ['n', 0.5], ['n', 0.8]] });
  P.skin = 'sirocco';
  for (const x of [92, 100]) A(x, 115, 1.4, 1.4, 1.3, 'barrier', { pump: true });
  A(106, 114, 4.2, 1.9, 1.4, 'barrier', { car: true, pickup: true });
  P.skin = null;
  P.outdoorLoot(104, 122, 22, 4, 3);

  // ---- Souk Quarter (north of the inn, between the Highway and the Souk Lane) and Lower Town (south of it) ----------
  poi('soukq', 'Souk Quarter', 198, 134, 30, 'dunes', 2);
  const QTR = { style: 'mudbrick', tall: 0.2, yard: 0.12, lot: [9, 13], h: [3.6, 4.6], towerH: [5.5, 7.5], towerSkin: 'sirocco' };
  cityBlock(P, 150, 110, 46, 47, QTR);
  cityBlock(P, 204, 110, 46, 47, QTR);
  P.outdoorLoot(198, 134, 30, 4, 2);
  poi('lowtown', 'Lower Town', 198, 268, 30, 'dunes', 2);
  cityBlock(P, 150, 243, 46, 50, { ...QTR, style: 'ksar' });
  cityBlock(P, 204, 243, 46, 50, { ...QTR, style: 'ksar' });
  P.outdoorLoot(198, 268, 30, 4, 2);

  // ---- Airstrip (north-east): the runway, two hangars, the tower, the fuel tanks -----------------------------------------
  poi('airstrip', 'Airstrip', 330, 62, 44, 'scrub', 2);
  P.zones.push({ x: 276, z: 56, w: 118, d: 14, kind: 'runway' }, { x: 280, z: 14, w: 92, d: 38, kind: 'apron' });
  B(282, 18, 26, 18, { h: 6.4, style: 'hangar', split: false, furnish: 2, chest: true, loot: 8, doors: [['s', 0.5, 6], ['n', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(316, 20, 22, 16, { h: 6, style: 'hangar', split: false, furnish: 2, loot: 7, doors: [['s', 0.5, 5], ['n', 0.5], ['e', 0.5]] });
  B(352, 22, 9, 9, { h: 5.2, style: 'tower', doors: [['s', 0.5], ['w', 0.5]] });
  B(368, 80, 14, 9, { h: 3.6, style: 'prefab', doors: [['n', 0.5], ['w', 0.5]] });
  P.skin = 'sirocco';
  for (const [x, z] of [[372, 26], [380, 26], [372, 36]]) T(x, z, 3.4, 3.4, 3.2, 'container', { tank: true, fueltank: true }, 1.2);
  // A light plane parked on the apron, and a fuel bowser.
  T(296, 42, 6, 2.2, 1.6, 'barrier', { plane: true }, 1.6);
  T(330, 44, 4.6, 2, 2.2, 'container', { bowser: true }, 1.2);
  for (const [x, z] of [[300, 76], [340, 78], [286, 82], [356, 50]]) T(x, z, 1.6, 1.6, 1.1, 'crate', {});
  P.skin = null;
  P.outdoorLoot(330, 56, 44, 10, 2);

  // ---- Pump Station (east, at the end of the ridge track): the pump house, tanks, the pipeline ---------------------------
  poi('pumps', 'Pump Station', 372, 160, 26, 'scrub', 2);
  P.zones.push({ x: 348, z: 120, w: 48, d: 60, kind: 'apron' });
  B(352, 126, 20, 12, { h: 5, style: 'tinshed', split: false, furnish: 2, chest: true, loot: 6, doors: [['s', 0.3, 3], ['s', 0.75], ['n', 0.5], ['w', 0.5]] });
  B(378, 160, 14, 10, { h: 4, style: 'prefab', furnish: 1, doors: [['w', 0.5], ['n', 0.5]] });
  P.skin = 'sirocco';
  for (const [x, z] of [[352, 162], [360, 170], [378, 128]]) T(x, z, 4, 4, 3.6, 'container', { tank: true }, 1.4);
  for (const [x, z] of [[350, 182], [362, 182], [374, 182]]) T(x, z, 8, 1, 1.0, 'barrier', { pipe: true }, 1.4);
  P.skin = null;
  P.outdoorLoot(372, 156, 26, 5, 2);

  // ---- Date Grove (south-west): palm beds round the spring pools, mud houses ------------------------------------------
  poi('grove', 'Date Grove', 56, 278, 34, 'scrub', 2);
  P.region = 'scrub';
  P.skin = 'sirocco';
  A(40, 268, 16, 9, 0, 'water', { spring: true });
  A(66, 290, 10, 7, 0, 'water', { spring: true });
  P.skin = null;
  B(14, 290, 12, 9, { style: 'mudbrick', h: 3.6, chest: true });
  B(72, 254, 11, 9, { style: 'mudbrick', h: 3.6 });
  B(78, 302, 12, 8, { style: 'ksar', h: 4 });
  B(36, 298, 9, 7, { style: 'mudbrick', h: 3.4 });
  // Palms in their stone beds, wherever they leave room round the pools and houses.
  P.skin = 'sirocco';
  for (let k = 0; k < 40; k++) T(8 + R() * 74, 246 + R() * 64, 1.4, 1.4, 1.0, 'boulder', { palm: true }, 1.8);
  P.skin = null;
  P.outdoorLoot(56, 278, 34, 8, 2);

  // ---- Nomad Camp (south of the canyon, west of Lower Town): big tents round a fire, camel lines -----------------------
  poi('camp', 'Nomad Camp', 108, 272, 24, 'dunes', 3);
  B(92, 256, 14, 9, { h: 3.2, style: 'tentcloth', split: false, doors: [['s', 0.5], ['e', 0.5]], windows: false });
  B(114, 260, 12, 8, { h: 3.2, style: 'tentcloth', split: false, doors: [['s', 0.5], ['w', 0.5]], windows: false });
  B(100, 282, 16, 9, { h: 3.4, style: 'tentcloth', split: false, chest: true, doors: [['n', 0.5], ['e', 0.5]], windows: false });
  P.skin = 'sirocco';
  A(108, 272, 2, 2, 0.5, 'barrier', { fire: true });
  for (const [x, z, al] of [[124, 274, 1], [124, 280, 1], [126, 286, 0], [90, 270, 0]]) T(x, z, al ? 2.2 : 0.9, al ? 0.9 : 2.2, 1.7, 'barrier', { camel: true }, 1.4);
  for (const [x, z] of [[118, 292], [88, 294]]) T(x, z, 2.2, 1, 1.0, 'sandbag', { sacks: true }, 1.4);
  P.skin = null;
  P.outdoorLoot(108, 272, 24, 6, 3);

  // ---- Saltworks (south-west): the salt pans, the sheds, heaps of salt -------------------------------------------------
  poi('salt', 'Saltworks', 86, 360, 40, 'saltpan', 3);
  P.zones.push({ x: 40, z: 326, w: 92, d: 22, kind: 'saltpan' }, { x: 100, z: 352, w: 40, d: 40, kind: 'saltpan' });
  B(48, 370, 24, 12, { h: 5, style: 'tinshed', split: false, furnish: 2, chest: true, loot: 6, doors: [['n', 0.3, 3], ['n', 0.75], ['s', 0.5], ['e', 0.5]] });
  B(14, 352, 12, 9, { h: 3.6, style: 'prefab', doors: [['e', 0.5], ['n', 0.5]] });
  B(84, 384, 12, 9, { h: 3.6, style: 'tinshed' });
  P.skin = 'sirocco';
  for (const [x, z] of [[50, 334], [64, 338], [80, 332], [96, 338], [112, 334], [108, 362], [122, 374]]) T(x, z, 4, 3, 2.2, 'rock', { saltheap: true }, 1.6);
  P.skin = null;
  P.outdoorLoot(86, 356, 40, 8, 3);

  // ---- Wreck Dunes (south-east): a cargo plane down in the dunes, broken in two ---------------------------------------
  poi('wreck', 'Wreck Dunes', 290, 352, 42, 'dunes', 2);
  P.skin = 'sirocco';
  {
    // The fuselage: two hull sides and a floor you can walk along, the cockpit and tail sections apart from it.
    const fx = 270, fz = 344;
    A(fx, fz, 26, 0.6, 3.6, 'hull', { fuselage: true, landmark: true });
    A(fx, fz + 4.4, 9, 0.6, 3.6, 'hull', { fuselage: true, landmark: true });
    A(fx + 12.4, fz + 4.4, 13.6, 0.6, 3.6, 'hull', { fuselage: true, landmark: true });
    P.rooms.push({ x: fx, z: fz + 0.6, w: 26, d: 3.8, floor: 'deck' });
    A(fx + 30, fz - 1, 6, 5.6, 3, 'hull', { cockpit: true, landmark: true });
    A(fx - 12, fz + 0.6, 7, 3.8, 4.2, 'hull', { tail: true, landmark: true });
    A(fx + 6, fz - 12, 10, 1.4, 1.2, 'barrier', { wing: true });
    A(fx + 8, fz + 16, 10, 1.4, 1.2, 'barrier', { wing: true });
    for (const [x, z] of [[fx + 2, fz + 9], [fx + 18, fz - 6], [fx + 22, fz + 10], [fx - 4, fz - 6]]) T(x, z, 1.8, 1.8, 1.2, 'crate', { cargo: true }, 1.2);
    B(248, 322, 12, 9, { style: 'prefab', h: 3.4, chest: true });
    B(300, 374, 14, 9, { style: 'prefab', h: 3.4 });
    B(300, 300, 10, 8, { style: 'tentcloth', h: 3, windows: false, doors: [['s', 0.5], ['w', 0.5]] });
    for (const [x, z] of [[fx + 6, fz + 1.6], [fx + 18, fz + 1.6]]) P.loot.push({ x: x + 1, z: z + 0.6, tier: 2, indoor: true });
  }
  P.skin = null;
  P.outdoorLoot(290, 352, 40, 10, 2);

  // ---- Smelter (east, at the end of the haul road): the furnace hall, the stacks, slag heaps -------------------------------
  poi('smelter', 'Smelter', 368, 284, 32, 'spoil', 2);
  P.zones.push({ x: 344, z: 256, w: 52, d: 60, kind: 'slag' });
  B(348, 258, 30, 16, { h: 6.4, style: 'industrial', split: false, furnish: 2, chest: true, loot: 8, doors: [['s', 0.3, 3], ['s', 0.75, 3], ['n', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(352, 290, 16, 10, { h: 4.2, style: 'tinshed', furnish: 2, doors: [['n', 0.5], ['w', 0.5], ['e', 0.5]] });
  A(384, 262, 3, 3, 16, 'building', { stack: true, skin: 'foundry' });
  A(384, 270, 3, 3, 13, 'building', { stack: true, skin: 'foundry' });
  P.skin = 'sirocco';
  for (const [x, z, w, d] of [[350, 306, 8, 5], [366, 310, 6, 4], [380, 300, 7, 5], [376, 318, 9, 4]]) T(x, z, w, d, 2.4, 'rock', { slag: true }, 1.6);
  for (const [x, z] of [[372, 286], [344, 284], [388, 290]]) T(x, z, 2.6, 1.4, 1.3, 'barrier', { orecart: true }, 1.2);
  P.skin = null;
  P.outdoorLoot(368, 284, 32, 8, 2);

  // ---- The Fork's trading post (between the ridge and the mine, east of the Fork Road): a walled yard of mud stores
  // round a well, wagons drawn up outside. No place of its own (it is Conquest's flag E, "The Fork").
  P.region = 'dunes'; P.tier = 3;
  B(270, 184, 14, 10, { style: 'mudbrick', h: 3.8, furnish: 2, doors: [['s', 0.3], ['s', 0.75], ['w', 0.5]] });
  B(296, 183, 12, 9, { style: 'ksar', h: 4.6, chest: true, doors: [['s', 0.5], ['e', 0.5]] });
  B(318, 185, 14, 10, { style: 'mudbrick', h: 3.8, doors: [['s', 0.5], ['w', 0.5]] });
  B(274, 207, 12, 9, { style: 'ksar', h: 4.2, doors: [['n', 0.5], ['e', 0.5]] });
  B(306, 206, 16, 10, { style: 'mudbrick', h: 3.8, furnish: 2, doors: [['n', 0.3], ['n', 0.75], ['e', 0.5]] });
  P.skin = 'sirocco';
  A(292.6, 197.2, 2.8, 2.8, 1.0, 'barrier', { well: true });
  T(334, 198, 5, 2.2, 2.4, 'container', { wagon: true }, 1.4);
  T(262.6, 199, 2.2, 5, 2.4, 'container', { wagon: true }, 1.4);
  for (const [x, z, al] of [[322, 199, 1], [282, 199, 0]]) T(x, z, al ? 2.2 : 0.9, al ? 0.9 : 2.2, 1.7, 'barrier', { camel: true }, 1.4);
  P.skin = null;
  P.outdoorLoot(298, 200, 26, 6, 3);

  // ---- The open desert: outcrops, boulders and dunes where nothing else stands -------------------------------------------
  P.region = 'dunes'; P.tier = 3;
  const srnd = mulberry(3301);
  let rocks = 0;
  for (let tries = 0; tries < 4000 && rocks < 130; tries++) {
    const x = 6 + srnd() * (W - 12), z = 6 + srnd() * (H - 12);
    if (P.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.r * 0.85)) continue;
    const r = srnd();
    if (r < 0.35) { if (crag1(x, z, 4 + srnd() * 7, 3 + srnd() * 5, 3 + srnd() * 3)) rocks++; }
    else if (r < 0.7) { if (T(x, z, 1.8 + srnd(), 1.4 + srnd() * 0.8, 1.1, 'boulder', { redrock: true, skin: 'sirocco' }, 1.8)) rocks++; }
    else { const along = srnd() < 0.6; if (T(x, z, along ? 9 + srnd() * 6 : 3, along ? 3 : 9 + srnd() * 6, 1.8, 'rock', { dune: true, skin: 'sirocco' }, 1.8)) rocks++; }
  }
  function crag1(x, z, w, d, h) { return T(x, z, w, d, h, 'rock', { crag: true }, 1.8); }

  // The edge of the basin: border walls in tile-sized lengths (the renderer streams them): mountains past them.
  for (let s = 0; s < W; s += 32) {
    const len = Math.min(32, W - s);
    for (const [x, z, w, d] of [[s, -1.5, len, 1.5], [s, H, len, 1.5], [-1.5, s, 1.5, len], [W, s, 1.5, len]]) {
      P.walls.push(wall(x, z, w, d, 4, 'border', { region: 'gulch' }));
    }
  }

  // ---- Extraction's landing zones (docs/EXTRACT.md; js/sim/extract.js reads br.exfils): named and reserved (LZ_RING,
  // LZ_FINAL): the runway, the salt pans, the dune sea, the grove, the halt yard, the pump station's yard and the quarry
  // flats for the ring, the final out at one of the four junctions round the inn; squads come in round the edge.
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

  // Nothing a bot cannot walk to (a corner pocket behind furniture): flooded from the Spice Road by the Seam.
  pruneUnreachable(P, 144, 200);

  // Supply caches out in the open desert, by cover, away from the places.
  P.region = 'dunes';
  const crnd = mulberry(77);
  let caches = 0;
  for (let tries = 0; tries < 4000 && caches < 10; tries++) {
    const x = 20 + crnd() * (W - 40), z = 20 + crnd() * (H - 40);
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
  const lanes = [{ id: 'north', z: 104 }, { id: 'souk', z: 162 }, { id: 'mid', z: 200 }, { id: 'well', z: 238 }, { id: 'south', z: 300 }];

  const circleBias = P.pois.map(p => ({ x: p.x, z: p.z, w: p.tier === 1 ? 1 : p.tier === 2 ? 0.8 : 0.5 }))
    .concat([[144, 162], [256, 238], [144, 300], [256, 104], [30, 130]].map(([x, z]) => ({ x, z, w: 0.4 })));
  // Rebound's compact areas: over the districts, leaning west (the canyon), east (the fork) and north (the quarter).
  const reboundAreas = [{ x: 210, z: 200, r: 150 }, { x: 186, z: 200, r: 150 }, { x: 232, z: 200, r: 150 }, { x: 210, z: 184, r: 150 }];

  // Conquest and Breakthrough (docs/MODES.md "Layout format"): the Spice Road and the places on it. Every point is
  // moved onto open ground round its place.
  const pt = (x, z, extra = {}) => ({ ...spot(x, z), ...extra });
  const bf = {
    conquest: [{
      id: 'spiceroad', name: 'Sirocco: Spice Road', area: { x: 24, z: 108, w: 352, h: 186 },
      hq: [pt(58, 200, { r: 10 }), pt(372, 200, { r: 10 })],
      flags: [
        pt(110, 200, { id: 'A', name: 'Red Gulch' }), pt(198, 136, { id: 'B', name: 'Souk Quarter' }), pt(200, 200, { id: 'C', name: 'Caravanserai' }),
        pt(198, 266, { id: 'D', name: 'Lower Town' }), pt(304, 200, { id: 'E', name: 'The Fork' }),
      ],
    }],
    breakthrough: [{
      id: 'caravanrun', name: 'Sirocco: Caravan Run', area: { x: 14, z: 118, w: 372, h: 164 }, tickets: 260, refill: 210,
      hq: [pt(30, 200, { r: 10 }), pt(372, 200, { r: 10 })],
      sectors: [
        { name: 'Red Gulch', objs: [pt(98, 196), pt(122, 205)] },
        { name: 'Caravanserai', objs: [pt(182, 190), pt(220, 212)] },
        { name: 'The Fork', objs: [pt(292, 151), pt(294, 249)] },
      ],
    }],
  };

  return {
    id: 'sirocco', name: 'Sirocco Basin', theme: 'basin', size: 'giant', region: 'desert', width: W, height: H,
    walls: P.walls, spawns, lanes, nav, points: { dom: [], hard: [] },
    rooms: P.rooms, roofs: P.roofs, zones: P.zones, roads: P.roads, rails: P.rails, regionSeeds: REGION_SEEDS,
    districts, modes: ['br'], large: true, bf,
    br: { pois: P.pois, loot: P.loot, chests: P.chests, drop: null, circleBias, reboundAreas, exfils },
  };
}

export default build();
