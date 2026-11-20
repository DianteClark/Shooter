// Battle royale (docs/BR.md "Jadefall"): Jadefall, 400 x 400 m, a jungle-ruins archipelago and the second battle royale
// island. Four islands make a ring round a warm shallow lagoon, cut apart by four deep channels on the diagonals; the
// Jade Pyramid stands on its own islet in the middle, joined to each island by a stone causeway. Shallow water (the
// lagoon, sandbars, the surf along the beaches, the fords) can be waded but slows you (js/shared/geometry.js
// inShallows); deep water (the channels, the blue holes, the open sea) is blocked. Each channel has a rope bridge and a
// ford, so a squad always has two ways off an island plus the slow way through the lagoon.
//   North, the highlands: Sky Temple, Cascade Falls (a waterfall over a cliff), Signal Peak.
//   East, the coral coast: Port Coral (the harbour town), Cannery Wharf, Lighthouse Key.
//   South: Fort Sentinel (a colonial star fort), Pearl Village on stilts, Shipwreck Cove; Coral Flats on the reef.
//   West, the deep jungle: Serpent Ruins, the Research Camp, the Plantation.
//   The lagoon: the Jade Pyramid and the Stilt Market on its piers.
// Built by the kit in br-kit.js; dressed by js/render/themes/frontier.js (the giant-world streamer) with the island's
// palette from js/render/themes/jadefall.js. The Ground War maps cut from the same coast are in jadefall-gw.js.
import { wall } from './build.js';
import { Plan, mulberry, valueNoise, segDist } from './br-kit.js';
import { templeCourt } from './jungle-kit.js';
import { CELL, DEEP, SHALLOW, LAND, STEEP, rectsOf as latticeRects } from './isle-kit.js';

const W = 400, H = 400;
const N = W / CELL;                           // Land/water lattice: CELL metres, N x N (isle-kit.js).
const CX = 200, CZ = 200;

// Region seeds for the renderer's ground and dressing: [region, x, z, bias].
export const REGION_SEEDS = [
  ['highland', 120, 80], ['highland', 280, 70], ['highland', 60, 110, -4],
  ['ruins', 200, 70], ['ruins', 200, 200, 8], ['ruins', 70, 200], ['ruins', 200, 120, -10],
  ['beach', 340, 200], ['beach', 330, 120], ['beach', 345, 290], ['beach', 350, 350, 6],
  ['jungle', 200, 330], ['jungle', 270, 320], ['jungle', 80, 150], ['jungle', 120, 230], ['jungle', 260, 250, -10],
  ['mangrove', 90, 280], ['mangrove', 120, 340], ['mangrove', 50, 340],
];

// The four channels: polylines [x, z] from the lagoon to the open sea, with a width, a bridge and a ford (each the
// index of the segment point it sits at: t along the line from 0 to 1).
export const CHANNELS = [
  { id: 'ne', pts: [[246, 154], [272, 128], [300, 104], [322, 84], [350, 50], [372, 22]], w: 13, bridge: 0.22, ford: 0.62 },
  { id: 'se', pts: [[246, 246], [270, 268], [298, 296], [318, 322], [340, 344]], w: 12, bridge: 0.55, ford: 0.2 },
  { id: 'sw', pts: [[154, 246], [130, 270], [106, 290], [84, 316], [56, 346], [28, 378]], w: 13, bridge: 0.25, ford: 0.6 },
  { id: 'nw', pts: [[154, 154], [128, 128], [104, 104], [80, 86], [50, 50], [26, 22]], w: 12, bridge: 0.6, ford: 0.24 },
];

// A point and the heading along a polyline at t (0..1 of its length).
function along(pts, t) {
  let total = 0;
  const lens = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(l); total += l; }
  let s = t * total;
  for (let i = 0; i < lens.length; i++) {
    if (s <= lens[i] || i === lens.length - 1) {
      const k = Math.min(1, s / lens[i]), [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, ux: (bx - ax) / lens[i], uz: (bz - az) / lens[i] };
    }
    s -= lens[i];
  }
  return { x: pts[0][0], z: pts[0][1], ux: 1, uz: 0 };
}
// Each polyline's bounding box, so the lattice skips the segment tests far from it.
const BOX = new WeakMap();
const boxOf = pts => {
  let b = BOX.get(pts);
  if (!b) BOX.set(pts, b = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]);
  return b;
};
// Distance to a polyline, or Infinity when (x, z) is further than m from its box.
const nearLine = (pts, x, z, m) => {
  const b = boxOf(pts);
  return x < b[0] - m || z < b[1] - m || x > b[2] + m || z > b[3] + m ? Infinity : polyDist(pts, x, z);
};
const polyDist = (pts, x, z) => {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return d;
};

// Crossings: a bridge (a deck, solid footing) and a ford (shallow) per channel, as axis-aligned rects over the channel.
export const CROSSINGS = CHANNELS.flatMap(c => ['bridge', 'ford'].map(kind => {
  const p = along(c.pts, c[kind]);
  const span = c.w + 10, wide = kind === 'bridge' ? 4.8 : 8;
  // Across the channel: the deck runs along the axis nearer the channel's normal.
  const ns = Math.abs(p.uz) < Math.abs(p.ux);       // Channel runs east-west-ish: the deck runs north-south.
  const w = ns ? wide : span, d = ns ? span : wide;
  const x = Math.round((p.x - w / 2) / 2) * 2, z = Math.round((p.z - d / 2) / 2) * 2;
  return { kind, ch: c.id, x, z, w, d };
}));

// Causeways from the pyramid islet out to each island (stone, solid footing over the lagoon).
const CAUSEWAYS = [
  { x: 197, z: 112, w: 6, d: 66 }, { x: 197, z: 222, w: 6, d: 66 },
  { x: 112, z: 197, w: 66, d: 6 }, { x: 222, z: 197, w: 66, d: 6 },
];
// Blue holes: deep pools in the lagoon.
const HOLES = [[160, 236, 9], [244, 160, 8], [232, 246, 7], [158, 170, 6]];
// The waterfall's pool and its stream to the lagoon (shallow).
const FALLS_POOL = { x: 120, z: 60, w: 16, d: 12 };
const STREAM = [[128, 72], [134, 96], [146, 116], [152, 130]];

// The island mask on the lattice: DEEP, SHALLOW or LAND per cell. Pure and cheap (100 x 100).
export function islandCells() {
  const n1 = valueNoise(5150), n2 = valueNoise(911);
  const cls = new Uint8Array(N * N);
  const at = (i, j) => cls[j * N + i];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL, dx = x - CX, dz = z - CZ;
      const ax = Math.abs(dx), az = Math.abs(dz), ring = Math.cbrt(ax * ax * ax + az * az * az);
      const rr = Math.hypot(dx, dz);
      // The noisy edges only matter in their bands (outer 148-188 m, inner 65-83 m, the islet 27-33 m): cheap
      // tests decide the rest (this runs on every phone at start-up).
      const outer = ring < 148 ? 1e9 : ring > 188 ? -1 : 168 + (n1(x * 0.03, z * 0.03) - 0.5) * 30 + Math.sin(Math.atan2(dz, dx) * 5 + 1) * 5;
      const inner = rr < 65 ? 1e9 : rr > 83 ? -1 : 74 + (n2(x * 0.035, z * 0.035) - 0.5) * 18;
      let c = DEEP;
      if (ring < outer && rr > inner) c = LAND;
      else if (rr <= inner) c = SHALLOW;                  // The lagoon.
      if (rr < 27 || (rr < 33 && rr < 30 + (n1(x * 0.1 + 9, z * 0.1) - 0.5) * 6)) c = LAND;   // The pyramid's islet.
      for (let h = 0; h < HOLES.length; h++) if (Math.hypot(x - HOLES[h][0], z - HOLES[h][1]) < HOLES[h][2]) c = STEEP;
      // The SE reef islet and its sandbars.
      const reef = Math.hypot((x - 352) / 30, (z - 352) / 22);
      if (reef < 1) c = LAND; else if (reef < 1.7 && c === DEEP) c = SHALLOW;
      cls[j * N + i] = c;
    }
  }
  // Channels, deep, edge to edge; the stream from the falls, shallow; the pool, deep.
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
      let wob = null;
      for (let k = 0; k < CHANNELS.length; k++) {
        const c = CHANNELS[k], d = nearLine(c.pts, x, z, c.w / 2 + 3);
        if (d === Infinity || d > c.w / 2 + 2) continue;
        wob ??= (n2(x * 0.06 + 3, z * 0.06) - 0.5) * 4;
        if (d < c.w / 2 + wob) cls[j * N + i] = STEEP;
      }
      if (cls[j * N + i] === LAND && nearLine(STREAM, x, z, 4) < 3) cls[j * N + i] = SHALLOW;
      if (x > FALLS_POOL.x && x < FALLS_POOL.x + FALLS_POOL.w && z > FALLS_POOL.z && z < FALLS_POOL.z + FALLS_POOL.d) cls[j * N + i] = STEEP;
    }
  }
  // A channel's mouth past the coast is open sea.
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL, dx = x - CX, dz = z - CZ;
    if (cls[j * N + i] === STEEP && Math.cbrt(Math.abs(dx) ** 3 + Math.abs(dz) ** 3) > 182) cls[j * N + i] = DEEP;
  }
  // Surf: open sea next to a beach is shallow (8 m out); channels keep their steep banks.
  // Land within `reach` cells (a square), by two running passes: along each row, then down each column.
  const reach = Math.round(8 / CELL), rowLand = new Uint8Array(N * N), landNear = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    for (let a = Math.max(0, i - reach), e = Math.min(N - 1, i + reach); a <= e; a++) if (cls[j * N + a] === LAND) { rowLand[j * N + i] = 1; break; }
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    for (let b = Math.max(0, j - reach), e = Math.min(N - 1, j + reach); b <= e; b++) if (rowLand[b * N + i]) { landNear[j * N + i] = 1; break; }
  }
  const near = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (at(i, j) !== DEEP || !landNear[j * N + i]) continue;
    const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
    if (CHANNELS.some(c => nearLine(c.pts, x, z, c.w / 2 + 6) < c.w / 2 + 6)) continue;
    if (HOLES.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + 2)) continue;
    if (x > FALLS_POOL.x - 4 && x < FALLS_POOL.x + FALLS_POOL.w + 4 && z > FALLS_POOL.z - 4 && z < FALLS_POOL.z + FALLS_POOL.d + 4) continue;
    near[j * N + i] = 1;
  }
  for (let k = 0; k < N * N; k++) if (near[k]) cls[k] = SHALLOW;
  // Crossings and causeways: fords shallow, decks and causeways solid.
  const paint = (r, c) => {
    for (let j = Math.floor(r.z / CELL); j < Math.ceil((r.z + r.d) / CELL); j++) for (let i = Math.floor(r.x / CELL); i < Math.ceil((r.x + r.w) / CELL); i++) {
      if (i >= 0 && j >= 0 && i < N && j < N) cls[j * N + i] = c(cls[j * N + i]);
    }
  };
  for (const r of CAUSEWAYS) paint(r, () => LAND);
  for (const r of CROSSINGS) paint(r, v => (r.kind === 'ford' ? (v === LAND ? LAND : SHALLOW) : LAND));
  // Speckle: a lone land cell in water, or a lone water cell on land, goes with its neighbours.
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const v = at(i, j), a = at(i - 1, j), b = at(i + 1, j), c = at(i, j - 1), d = at(i, j + 1);
      if (a !== v && b !== v && c !== v && d !== v) cls[j * N + i] = a === LAND || b === LAND || c === LAND || d === LAND ? LAND : Math.max(a, b, c, d);
    }
  }
  return cls;
}

const rectsOf = (cls, c, mask = null) => latticeRects({ size: CELL, n: N, nz: N, cls }, c, mask);

// Paths: dirt trails round each island and the stone causeways; the renderer paints them.
const ROADS = [
  { pts: [[112, 200], [76, 200]], w: 4, kind: 'stone' },
  { pts: [[288, 200], [330, 200]], w: 4, kind: 'stone' },
  { pts: [[200, 112], [200, 84]], w: 4, kind: 'stone' },
  { pts: [[200, 288], [200, 320]], w: 4, kind: 'stone' },
  { pts: [[132, 98], [168, 82], [200, 80], [236, 84], [272, 86]], w: 4, kind: 'dirt' },          // North trail.
  { pts: [[310, 120], [326, 160], [328, 200], [330, 240], [328, 272]], w: 4, kind: 'dirt' },      // East trail.
  { pts: [[258, 300], [228, 318], [200, 322], [168, 322], [126, 322]], w: 4, kind: 'dirt' },      // South trail.
  { pts: [[90, 260], [80, 230], [76, 200], [80, 170], [90, 142]], w: 4, kind: 'dirt' },           // West trail.
  { pts: [[90, 142], [100, 120], [114, 104]], w: 3, kind: 'dirt' },
  { pts: [[272, 86], [262, 98]], w: 3, kind: 'dirt' },
  { pts: [[272, 86], [298, 60]], w: 3, kind: 'dirt' },
  { pts: [[310, 120], [300, 108]], w: 3, kind: 'dirt' },
  { pts: [[328, 272], [312, 286]], w: 3, kind: 'dirt' },
  { pts: [[258, 300], [282, 288]], w: 3, kind: 'dirt' },
  { pts: [[126, 322], [108, 302]], w: 3, kind: 'dirt' },
  { pts: [[90, 260], [100, 282]], w: 3, kind: 'dirt' },
];

function build() {
  const P = new Plan(W, H, 7041);
  const R = P.rnd;
  const cls = islandCells();
  const cellAt = (x, z) => {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    return i < 0 || j < 0 || i >= N || j >= N ? DEEP : cls[j * N + i];
  };
  const dry = (x, z, w, d, m = 0) => {
    for (let zz = z - m; zz <= z + d + m + 0.01; zz += Math.min(2, d + 2 * m)) for (let xx = x - m; xx <= x + w + m + 0.01; xx += Math.min(2, w + 2 * m)) if (cellAt(Math.min(xx, x + w + m - 0.01), Math.min(zz, z + d + m - 0.01)) !== LAND) return false;
    return true;
  };
  const skipped = [];
  // Buildings and pieces only on dry land (a piece that would stand in water is left out and listed for the validator).
  const B = (x, z, w, d, o = {}) => (dry(x, z, w, d, 1) ? P.building(x, z, w, d, o) : (skipped.push(['bld', x, z]), null));
  const A = (x, z, w, d, h, kind, extra) => P.add(x, z, w, d, h, kind, extra);
  const T = (x, z, w, d, h, kind, extra, m = 1.6) => (dry(x, z, w, d) && P.free(x, z, w, d, m) ? P.add(x, z, w, d, h, kind, extra) : null);
  P.roads = ROADS;

  // ---- Water: deep water as walls, shallows as the list the movement code reads ----------------------------------
  P.region = 'beach';
  const crossingAt = (i, j) => CROSSINGS.some(r => r.kind === 'bridge' && (i + 0.5) * CELL > r.x && (i + 0.5) * CELL < r.x + r.w && (j + 0.5) * CELL > r.z && (j + 0.5) * CELL < r.z + r.d);
  for (const r of rectsOf(cls, DEEP)) {
    const edge = r.x <= 0 || r.z <= 0 || r.x + r.w >= W || r.z + r.d >= H;
    A(r.x, r.z, r.w, r.d, 0, 'water', edge ? { sea: true } : {});
  }
  for (const r of rectsOf(cls, STEEP)) A(r.x, r.z, r.w, r.d, 0, 'water', { channel: true });
  const shallows = rectsOf(cls, SHALLOW);
  // Bridges: plank decks over the channels, with water drawn under them (looks only).
  for (const c of CROSSINGS) if (c.kind === 'bridge') P.rooms.push({ x: c.x, z: c.z, w: c.w, d: c.d, floor: 'bridge' });
  const decked = new Uint8Array(N * N);
  for (const r of CROSSINGS) {
    if (r.kind !== 'bridge') continue;
    for (let j = Math.max(0, Math.floor(r.z / CELL)); j < Math.min(N, Math.ceil((r.z + r.d) / CELL)); j++) for (let i = Math.max(0, Math.floor(r.x / CELL)); i < Math.min(N, Math.ceil((r.x + r.w) / CELL)); i++) decked[j * N + i] = crossingAt(i, j) ? 1 : 0;
  }
  const underDecks = rectsOf(cls, LAND, (i, j) => decked[j * N + i] === 1);
  for (const r of CAUSEWAYS) P.rooms.push({ ...r, floor: 'causeway' });
  void underDecks;

  // ---- Jade Pyramid (centre, tier 1) ---------------------------------------------------------------------------
  P.poi('pyramid', 'Jade Pyramid', 200, 187, 26, 'jungle', 1);
  P.region = 'ruins';
  A(190, 190, 20, 20, 8.5, 'rock', { pyramid: true, landmark: true });
  // Four shrines at the foot of the stairs, enterable, the pyramid's loot.
  B(193, 174, 14, 10, { h: 3.8, style: 'temple', split: false, furnish: 1, chest: true, loot: 6, doors: [['n', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(193, 216, 14, 10, { h: 3.8, style: 'temple', split: false, furnish: 1, chest: true, loot: 6, doors: [['s', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(174, 193, 10, 14, { h: 3.8, style: 'temple', split: false, furnish: 1, loot: 6, doors: [['w', 0.5], ['n', 0.5], ['s', 0.5]] });
  B(216, 193, 10, 14, { h: 3.8, style: 'temple', split: false, furnish: 1, chest: true, loot: 6, doors: [['e', 0.5], ['n', 0.5], ['s', 0.5]] });
  for (const [x, z] of [[180, 180], [218.8, 180], [180, 218.8], [218.8, 218.8]]) A(x, z, 1.2, 1.2, 3.6, 'rock', { ruin: 'statue', skin: 'jungle' });
  for (const [x, z] of [[176, 214], [222, 178], [222, 216], [176, 178]]) T(x, z, 2.6, 1.4, 1.0, 'boulder', { fallen: true, skin: 'jungle' });
  P.outdoorLoot(200, 200, 28, 8, 1);

  // ---- Sky Temple (north, tier 1) -------------------------------------------------------------------------------
  P.poi('sky', 'Sky Temple', 200, 74, 34, 'jungle', 1);
  P.region = 'ruins';
  P.zones.push({ x: 178, z: 52, w: 44, d: 44, kind: 'court' });
  P.put(templeCourt(178, 52, 44, 44, 7));
  B(190, 64, 20, 20, {
    h: 5, style: 'temple', split: false, furnish: 0, chest: true, loot: 8,
    doors: [['n', 0.5], ['s', 0.5], ['w', 0.5], ['e', 0.5]],
    inside: () => { for (const [x, z] of [[194, 68], [204.8, 68], [194, 78.8], [204.8, 78.8]]) A(x, z, 1.2, 1.2, 4, 'rock', { ruin: 'pillar', skin: 'jungle' }); },
  });
  B(158, 60, 12, 9, { style: 'temple', h: 3.6 });
  B(230, 60, 12, 9, { style: 'temple', h: 3.6, chest: true });
  B(158, 86, 10, 8, { style: 'jungle', h: 3.4 });
  B(232, 86, 10, 8, { style: 'jungle', h: 3.4 });
  A(196, 38, 8, 6, 6, 'rock', { stonehead: true, landmark: true });
  for (const [x, z] of [[170, 52], [226, 98], [168, 100], [232, 48]]) T(x, z, 2.2, 2.2, 4.6, 'rock', { tree: true, skin: 'jungle' });
  P.outdoorLoot(200, 74, 34, 9, 1);

  // ---- Cascade Falls (north-west, tier 2) ------------------------------------------------------------------------
  P.poi('falls', 'Cascade Falls', 134, 84, 26, 'jungle', 2);
  P.region = 'highland';
  // The cliff the falls come over, north of the pool, with the falls' sheet on its face.
  A(104, 46, 16, 12, 7.5, 'rock', { crag: true, cliff: true });
  A(120, 46, 16, 12, 8.5, 'rock', { cliff: true, falls: true, landmark: true });
  A(136, 46, 14, 12, 7, 'rock', { crag: true, cliff: true });
  B(140, 66, 10, 8, { style: 'thatch', h: 3.4, chest: true });
  B(104, 70, 9, 8, { style: 'thatch', h: 3.4 });
  B(146, 84, 10, 8, { style: 'tin', h: 3.6, doors: [['n', 0.5], ['s', 0.5], ['w', 0.5]] });
  B(94, 60, 9, 7, { style: 'thatch', h: 3.2 });
  B(112, 84, 8, 7, { style: 'thatch', h: 3.2 });
  A(150, 80, 4, 2.2, 1.6, 'container', { waterwheel: true, skin: 'jungle' });
  for (const [x, z, s] of [[100, 84, 3], [156, 70, 2.6], [124, 104, 2.4]]) T(x, z, s, s * 0.8, 1.3, 'boulder', { crag: true });
  P.outdoorLoot(134, 84, 26, 6, 2);

  // ---- Signal Peak (north-east, tier 3) ------------------------------------------------------------------------
  P.poi('signal', 'Signal Peak', 262, 98, 20, 'jungle', 3);
  P.region = 'highland';
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    if (k % 7 === 0 || k % 7 === 3) continue;                   // Ways up.
    T(262 + Math.cos(a) * 15 - 3, 98 + Math.sin(a) * 15 - 3, 6, 6, 3 + R() * 1.4, 'rock', { crag: true }, 0.3);
  }
  A(266, 92, 1.8, 1.8, 18, 'building', { mast: true });
  B(256, 96, 8, 7, { style: 'tin', h: 3.2, doors: [['w', 0.5], ['e', 0.5]], chest: true });
  T(260, 106, 2.4, 1.6, 1.4, 'container', { generator: true });
  P.outdoorLoot(262, 98, 14, 3, 3);

  // ---- Port Coral (east, tier 1) --------------------------------------------------------------------------------
  P.poi('port', 'Port Coral', 330, 198, 38, 'coast', 1);
  P.region = 'beach';
  P.zones.push({ x: 318, z: 186, w: 22, d: 20, kind: 'plaza' });
  A(326, 193, 6, 6, 0, 'water', { fountain: true, skin: 'metro' });
  // The church on the plaza, the customs house, the market hall, and lanes of houses.
  B(320, 160, 14, 20, { h: 5.4, style: 'colonial', split: false, furnish: 1, chest: true, loot: 7, doors: [['s', 0.5, 3], ['w', 0.5], ['e', 0.5]] });
  A(324.6, 154, 4.8, 4.8, 13, 'building', { belltower: true, landmark: true });
  B(342, 184, 16, 12, { h: 4.6, style: 'colonial', furnish: 2, chest: true, doors: [['w', 0.5], ['e', 0.5], ['n', 0.25], ['s', 0.75]] });
  B(296, 186, 14, 12, { h: 4.4, style: 'colonial', furnish: 2 });
  B(318, 212, 18, 10, { h: 4.2, style: 'market', split: false, furnish: 2, loot: 6, doors: [['n', 0.25], ['n', 0.75], ['s', 0.5], ['w', 0.5], ['e', 0.5]] });
  for (const [x, z, w, d] of [[284, 200, 8, 8], [312, 240, 8, 7], [356, 176, 8, 8], [298, 166, 9, 8], [298, 206, 9, 8], [342, 164, 9, 9], [344, 206, 10, 8], [300, 224, 9, 8], [342, 222, 9, 8], [326, 232, 8, 7], [356, 196, 8, 8]]) {
    B(x, z, w, d, { style: 'colonial', h: 3.6 + R() * 0.8 });
  }
  for (const [x, z] of [[316, 184], [340, 178], [310, 204], [338, 202]]) T(x, z, 2.4, 2.4, 1.0, 'boulder', { palm: true, skin: 'desert' }, 1.2);
  T(334, 184, 4.2, 1.9, 1.4, 'barrier', { car: true, skin: 'metro' }, 1.2);
  T(312, 228, 3.2, 1.6, 0.9, 'barrier', { dinghy: true, skin: 'pier' }, 1.2);
  P.outdoorLoot(326, 198, 38, 12, 1);

  // ---- Cannery Wharf (north-east coast, tier 2) ----------------------------------------------------------------------
  P.poi('cannery', 'Cannery Wharf', 318, 128, 26, 'coast', 2);
  P.region = 'beach';
  B(306, 118, 24, 12, { h: 5, style: 'tin', split: false, furnish: 2, chest: true, loot: 8, doors: [['n', 0.3, 3], ['s', 0.3, 3], ['s', 0.75], ['w', 0.5], ['e', 0.5]],
    inside: () => { A(310, 123, 6.5, 1.2, 1.1, 'barrier', { conveyor: true, skin: 'foundry' }); A(320, 123, 6.5, 1.2, 1.1, 'barrier', { conveyor: true, skin: 'foundry' }); } });
  B(334, 132, 10, 8, { style: 'tin', h: 3.6 });
  B(300, 136, 9, 8, { style: 'coast', h: 3.4 });
  A(330, 112, 3, 3, 4.2, 'building', { tank: true, skin: 'arctic' });
  A(334, 112, 3, 3, 4.2, 'building', { tank: true, skin: 'arctic' });
  for (const [x, z] of [[300, 112], [338, 120]]) T(x, z, 2.2, 3, 2.5, 'container', { fishbox: true, skin: 'pier' }, 1.2);
  T(322, 140, 1.6, 1.6, 1.15, 'crate', { pots: true, skin: 'pier' }, 1.2);
  T(312, 142, 4, 1, 1.0, 'barrier', { nets: true, skin: 'pier' }, 1.2);
  P.outdoorLoot(318, 128, 26, 6, 2);

  // ---- Lighthouse Key (south-east coast, tier 3) -------------------------------------------------------------------
  P.poi('lighthouse', 'Lighthouse Key', 342, 268, 18, 'coast', 3);
  P.region = 'beach';
  A(352, 262, 4, 4, 13, 'building', { lighthouse: true });
  B(334, 262, 9, 7, { style: 'colonial', h: 3.4, chest: true });
  B(338, 276, 7, 6, { style: 'coast', h: 3.2 });
  for (const [x, z, s] of [[358, 276, 2.6], [326, 278, 2.2], [350, 252, 2.4]]) T(x, z, s, s * 0.8, 1.2, 'boulder', { crag: true });
  P.outdoorLoot(342, 268, 16, 4, 3);

  // ---- Coral Flats (the reef, tier 3) --------------------------------------------------------------------------
  P.poi('flats', 'Coral Flats', 352, 350, 22, 'coast', 3);
  P.region = 'beach';
  A(344, 344, 7, 2.8, 2.8, 'container', { plane: true, skin: 'jungle' });
  B(354, 352, 8, 7, { style: 'thatch', h: 3.2, chest: true });
  B(340, 356, 7, 6, { style: 'thatch', h: 3.0 });
  for (const [x, z] of [[362, 344], [346, 362], [334, 348]]) T(x, z, 2.4, 2.4, 1.0, 'boulder', { palm: true, skin: 'desert' }, 1.0);
  P.outdoorLoot(352, 350, 22, 5, 3);

  // ---- Fort Sentinel (south, tier 1) ------------------------------------------------------------------------------
  P.poi('fort', 'Fort Sentinel', 200, 330, 34, 'coast', 1);
  P.region = 'jungle';
  // A star fort: four bastions joined by curtain walls, gates north and south, a keep and barracks inside.
  fort(P, 200, 330);
  B(190, 322, 20, 14, { h: 4.8, style: 'colonial', furnish: 2, chest: true, loot: 8, doors: [['n', 0.5], ['s', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(174, 314, 10, 8, { style: 'colonial', h: 3.6 });
  B(216, 314, 10, 8, { style: 'colonial', h: 3.6, chest: true });
  B(174, 338, 10, 8, { style: 'colonial', h: 3.6 });
  B(186, 344, 10, 7, { style: 'colonial', h: 3.4, doors: [['w', 0.5], ['e', 0.5]] });
  B(204, 308, 10, 6, { style: 'colonial', h: 3.4, doors: [['w', 0.5], ['e', 0.5]] });
  B(216, 338, 10, 8, { style: 'colonial', h: 3.6 });
  for (const [x, z] of [[180, 300], [222, 300], [180, 358], [222, 358]]) T(x, z, 2.4, 1.2, 1.0, 'barrier', { cannon: true, skin: 'jungle' }, 0.6);
  P.outdoorLoot(200, 330, 34, 10, 1);

  // ---- Pearl Village (south-east lagoon shore, tier 2) ------------------------------------------------------------
  P.poi('pearl', 'Pearl Village', 258, 296, 26, 'jungle', 2);
  P.region = 'jungle';
  for (const [x, z, w, d] of [[244, 284, 8, 6], [256, 280, 7, 6], [268, 288, 8, 6], [246, 298, 7, 6], [260, 304, 8, 7], [272, 302, 7, 6], [250, 312, 8, 6], [264, 316, 7, 6]]) {
    B(x, z, w, d, { style: 'thatch', h: 3.4, chest: x === 260 && z === 304 });
  }
  for (const [x, z] of [[240, 292], [278, 296], [256, 322]]) T(x, z, 1, 3.4, 0.7, 'crate', { canoe: true, skin: 'jungle' }, 1.0);
  for (const z of [276, 279]) T(232, z, 8, 0.8, 1.1, 'barrier', { crop: true, skin: 'jungle' }, 1.0);
  P.outdoorLoot(258, 296, 26, 6, 2);

  // ---- Shipwreck Cove (south-west coast, tier 3) ------------------------------------------------------------------
  P.poi('wreck', 'Shipwreck Cove', 132, 342, 22, 'coast', 3);
  P.region = 'mangrove';
  P.skin = 'arctic';
  // A galleon on its side on the beach: the hull is cover, the deck between its sides walkable.
  A(118, 344, 3, 9, 3.6, 'hull', { plate: true, end: true, bow: 1, wreck: true });
  A(121, 344, 22, 0.9, 3.4, 'hull', { plate: true, wreck: true });
  A(121, 352.1, 10, 0.9, 3.4, 'hull', { plate: true, wreck: true });
  A(137, 352.1, 6, 0.9, 3.4, 'hull', { plate: true, wreck: true });
  A(143, 344, 3, 9, 3.6, 'hull', { plate: true, end: true, bow: -1, wreck: true });
  P.rooms.push({ x: 121, z: 344.9, w: 22, d: 7.2, floor: 'deck' });
  P.skin = null;
  B(126, 324, 9, 7, { style: 'thatch', h: 3.2, chest: true });
  B(142, 328, 8, 7, { style: 'thatch', h: 3.2 });
  for (const [x, z] of [[112, 332], [150, 340]]) T(x, z, 2.8, 1, 0.9, 'boulder', { log: true, skin: 'jungle' }, 1.0);
  P.outdoorLoot(132, 340, 22, 5, 3);

  // ---- Serpent Ruins (west, tier 1) -------------------------------------------------------------------------------
  P.poi('serpent', 'Serpent Ruins', 76, 200, 34, 'jungle', 1);
  P.region = 'ruins';
  P.zones.push({ x: 60, z: 184, w: 32, d: 32, kind: 'court' });
  // The serpent wall: a long carved wall winding north to south, broken where the paths cross.
  for (const [x, z, w, d] of [[48, 170, 1.4, 10], [48, 186, 1.4, 10], [48, 206, 1.4, 12], [48, 224, 1.4, 8], [104, 172, 1.4, 12], [104, 190, 1.4, 8], [104, 212, 1.4, 14]]) A(x, z, w, d, 3.2, 'rock', { ruin: true, serpent: true, skin: 'jungle' });
  B(64, 188, 24, 24, {
    h: 5.2, style: 'temple', split: false, furnish: 0, chest: true, loot: 9,
    doors: [['n', 0.5], ['s', 0.5], ['w', 0.5], ['e', 0.5]],
    inside: () => { for (const [x, z] of [[68, 192], [82.8, 192], [68, 206.8], [82.8, 206.8]]) A(x, z, 1.2, 1.2, 4.2, 'rock', { ruin: 'pillar', skin: 'jungle' }); A(74.4, 198.4, 2.2, 2.2, 1.2, 'crate', { altar: true, skin: 'jungle' }); },
  });
  B(56, 166, 12, 9, { style: 'temple', h: 3.6, chest: true });
  B(86, 166, 10, 9, { style: 'temple', h: 3.6 });
  B(56, 226, 12, 9, { style: 'temple', h: 3.6 });
  B(88, 226, 10, 9, { style: 'temple', h: 3.6 });
  for (const [x, z] of [[62, 182], [90, 182], [62, 216], [90, 216]]) T(x, z, 1.2, 1.2, 3.4, 'rock', { ruin: 'statue', skin: 'jungle' }, 0.8);
  for (const [x, z] of [[54, 240], [96, 160], [44, 200], [108, 204]]) T(x, z, 2.2, 2.2, 4.6, 'rock', { tree: true, skin: 'jungle' });
  P.outdoorLoot(76, 200, 34, 10, 1);

  // ---- Research Camp (south-west, tier 2) --------------------------------------------------------------------------
  P.poi('camp', 'Research Camp', 88, 268, 26, 'jungle', 2);
  P.region = 'mangrove';
  B(74, 258, 14, 9, { style: 'tin', h: 3.6, furnish: 2, chest: true, doors: [['n', 0.5], ['s', 0.5], ['e', 0.5]] });
  B(94, 254, 10, 8, { style: 'tin', h: 3.4 });
  B(80, 276, 12, 8, { style: 'tin', h: 3.4 });
  B(102, 266, 7, 6, { style: 'thatch', h: 3.2 });
  P.skin = 'jungle';
  T(66, 274, 4.4, 2.2, 2.4, 'container', { truck: true }, 1.2);
  T(96, 286, 3, 2.4, 2.6, 'tent', { camp: true }, 1.2);
  T(108, 260, 3, 2.4, 2.6, 'tent', { camp: true }, 1.2);
  T(86, 290, 2.4, 1.6, 1.1, 'barrier', { drums: true }, 1.2);
  P.skin = null;
  A(70, 246, 1.6, 1.6, 12, 'building', { mast: true });
  P.outdoorLoot(88, 268, 26, 6, 2);

  // ---- Plantation (north-west, tier 2) -----------------------------------------------------------------------------
  P.poi('plantation', 'Plantation', 90, 136, 28, 'jungle', 2);
  P.region = 'jungle';
  B(78, 122, 18, 12, { h: 5, style: 'colonial', furnish: 2, chest: true, doors: [['s', 0.5, 3], ['n', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(102, 128, 10, 8, { style: 'thatch', h: 3.4 });
  B(66, 146, 9, 8, { style: 'thatch', h: 3.4 });
  B(98, 146, 12, 8, { style: 'tin', h: 3.8, doors: [['n', 0.5, 3], ['s', 0.5]] });
  P.skin = 'jungle';
  for (const z of [156, 159.5, 163]) { T(72, z, 10, 0.8, 1.1, 'barrier', { crop: true }, 0.6); T(86, z, 10, 0.8, 1.1, 'barrier', { crop: true }, 0.6); }
  T(110, 136, 3.4, 3, 3.2, 'rock', { banana: true }, 1.2);
  T(62, 132, 3.4, 3, 3.2, 'rock', { banana: true }, 1.2);
  P.skin = null;
  P.outdoorLoot(90, 136, 28, 6, 2);

  // ---- Smugglers' Den (north-west corner, tier 3) ------------------------------------------------------------------
  P.poi('den', "Smugglers' Den", 60, 96, 20, 'coast', 3);
  P.region = 'highland';
  for (const [x, z, w, d] of [[42, 80, 12, 6], [42, 86, 6, 14], [72, 108, 10, 6]]) T(x, z, w, d, 4.2, 'rock', { crag: true }, 0.3);
  B(56, 88, 12, 8, { style: 'tin', h: 3.4, chest: true, doors: [['s', 0.5], ['e', 0.5]] });
  B(52, 104, 8, 7, { style: 'thatch', h: 3.2 });
  P.skin = 'jungle';
  T(70, 96, 2.4, 1.6, 1.1, 'barrier', { drums: true }, 1.2);
  T(64, 116, 3, 2.4, 2.6, 'tent', { camp: true }, 1.2);
  P.skin = null;
  T(46, 120, 3.2, 1.6, 0.9, 'barrier', { dinghy: true, skin: 'pier' }, 1.2);
  P.outdoorLoot(60, 96, 20, 4, 3);

  // ---- Turtle Bay (north-east corner, tier 2) ------------------------------------------------------------------------
  P.poi('turtle', 'Turtle Bay', 300, 52, 20, 'coast', 2);
  P.region = 'beach';
  B(284, 50, 14, 9, { style: 'tin', h: 3.8, furnish: 2, chest: true, doors: [['n', 0.5], ['w', 0.5], ['e', 0.5]] });
  B(302, 50, 9, 8, { style: 'thatch', h: 3.2 });
  B(288, 64, 8, 7, { style: 'thatch', h: 3.2 });
  B(306, 64, 8, 7, { style: 'coast', h: 3.2 });
  for (const [x, z] of [[318, 56], [278, 64], [314, 46]]) T(x, z, 2.4, 2.4, 1.0, 'boulder', { palm: true, skin: 'desert' }, 1.0);
  T(322, 46, 3.2, 1.6, 0.9, 'barrier', { dinghy: true, skin: 'pier' }, 1.2);
  P.outdoorLoot(300, 52, 20, 5, 2);

  // ---- Mangrove Maze (south-west corner, tier 3) -------------------------------------------------------------------
  P.poi('maze', 'Mangrove Maze', 54, 306, 22, 'jungle', 3);
  P.region = 'mangrove';
  B(46, 298, 9, 7, { style: 'thatch', h: 3.2, chest: true });
  B(60, 312, 8, 7, { style: 'thatch', h: 3.2 });
  B(58, 288, 7, 6, { style: 'thatch', h: 3.0 });
  for (const [x, z] of [[66, 296], [38, 306], [54, 326], [70, 322]]) T(x, z, 3.6, 3.2, 2.8, 'rock', { thicket: true, skin: 'jungle' }, 1.0);
  P.outdoorLoot(54, 306, 22, 5, 3);

  // ---- Stilt Market (the lagoon, tier 3) ---------------------------------------------------------------------------
  P.poi('market', 'Stilt Market', 148, 150, 18, 'jungle', 3);
  P.region = 'ruins';
  // Plank piers over the lagoon's shallows with stalls on them; the shallows round them still slow you.
  for (const r of [{ x: 136, z: 146, w: 26, d: 4 }, { x: 146, z: 136, w: 4, d: 26 }]) P.rooms.push({ ...r, floor: 'pier' });
  for (const [x, z] of [[138, 140], [154, 140], [138, 152], [154, 152]]) A(x, z, 3, 2.4, 2.4, 'shop', { stall: true, skin: 'jungle' });
  T(160, 158, 1, 3.4, 0.7, 'crate', { canoe: true, skin: 'jungle' }, 0.8);
  P.outdoorLoot(148, 150, 16, 5, 3);
  P.region = 'beach';

  // ---- Extraction's landing zones: six clearings round the ring between the places, kept free of scatter, and the
  // final exfil's choices on the causeways out in the lagoon (docs/EXTRACT.md; js/sim/extract.js reads br.exfils).
  const clear = (x, z, r) => dry(x - r, z - r, 2 * r, 2 * r) && P.near(x - r, z - r, 2 * r, 2 * r).size === 0 && !P.roofs.some(f => x > f.x - r - 1 && x < f.x + f.w + r + 1 && z > f.z - r - 1 && z < f.z + f.d + r + 1);
  const ring = [];
  for (const [x0, z0] of [[232, 112], [284, 160], [300, 262], [160, 290], [110, 236], [168, 112]]) {
    let got = null;
    for (let d = 0; d <= 24 && !got; d += 2) for (let a = 0; a < 6.28 && !got; a += 0.5) {
      const x = Math.round(x0 + Math.cos(a) * d), z = Math.round(z0 + Math.sin(a) * d);
      if (clear(x, z, 12) && !P.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 10)) got = { x, z };
    }
    if (got) ring.push(got); else skipped.push(['exfil', x0, z0]);
  }
  // Squads come ashore on the outer beaches: eight landing points round the coast, between the channel mouths.
  const inserts = [];
  for (let k = 0; k < 8; k++) {
    let got = null;
    for (const da of [0, 0.12, -0.12, 0.24, -0.24, 0.36, -0.36]) {
      const a = (k + 0.5) / 8 * Math.PI * 2 + da;
      for (let r = 176; r > 118 && !got; r -= 2) {
        const x = Math.round(CX + Math.cos(a) * r), z = Math.round(CZ + Math.sin(a) * r);
        if (clear(x, z, 5) && !P.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 12)) got = { x, z };
      }
      if (got) break;
    }
    if (got) inserts.push(got); else skipped.push(['insert', k]);
  }
  const exfils = { ring, final: [{ x: 248, z: 200 }, { x: 152, z: 200 }, { x: 200, z: 248 }, { x: 200, z: 152 }], inserts };

  // ---- Open ground: scatter by region --------------------------------------------------------------------------------
  scatter(P, cellAt, [...ring, ...inserts.map(p => ({ ...p, r: 9 }))]);

  // The edge of the world: a low line in tile-sized lengths (open sea all round, drawn as nothing).
  for (let s = 0; s < W; s += 32) {
    const len = Math.min(32, W - s);
    for (const [x, z, w, d] of [[s, -1.5, len, 1.5], [s, H, len, 1.5], [-1.5, s, 1.5, len], [W, s, 1.5, len]]) P.walls.push(wall(x, z, w, d, 4, 'border', { region: 'beach', open: true }));
  }

  // Supply caches out in the open, by cover, away from the places.
  const rnd = mulberry(4471);
  let caches = 0;
  for (let tries = 0; tries < 6000 && caches < 10; tries++) {
    const x = 30 + rnd() * (W - 60), z = 30 + rnd() * (H - 60);
    if (cellAt(x, z) !== LAND || P.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 18) || P.chests.some(c => Math.hypot(c.x - x, c.z - z) < 48)) continue;
    if (!P.open(x, z, 1.0) || P.near(x - 0.01, z - 0.01, 0.02, 0.02, 2.2).size === 0) continue;
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

  // ---- What every map has: spawns (a test Team Deathmatch), lanes, waypoints ---------------------------------------
  const spot = (x, z) => {
    for (let r = 0; r < 24; r += 0.5) for (let a = 0; a < 6.28; a += 0.4) {
      const px = +(x + Math.cos(a) * r).toFixed(1), pz = +(z + Math.sin(a) * r).toFixed(1);
      if (cellAt(px, pz) === LAND && P.open(px, pz, 1.2) && !P.roofAt(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  };
  const west = ['serpent', 'camp', 'plantation', 'falls', 'wreck', 'market', 'sky', 'fort'];
  const spawns = [[], []];
  for (const p of P.pois) {
    const team = west.includes(p.id) ? 0 : 1;
    for (const k of [0, 1]) { const s = spot(p.x + (k ? 4 : -4), p.z + p.r * 0.5); spawns[team].push({ ...s, aim: team ? Math.PI : 0 }); }
  }
  const nav = P.pois.map(p => spot(p.x, p.z)).concat(CROSSINGS.map(c => spot(c.x + c.w / 2, c.z + c.d / 2)));
  const lanes = [{ id: 'north', z: 80 }, { id: 'mid', z: 200 }, { id: 'south', z: 320 }];
  const circleBias = P.pois.map(p => ({ x: p.x, z: p.z, w: p.tier === 1 ? 1 : p.tier === 2 ? 0.8 : 0.5 }))
    .concat([[120, 200], [280, 200], [200, 130], [200, 270]].map(([x, z]) => ({ x, z, w: 0.3 })));
  // Rebound's compact areas: four, each an island, the lagoon next to it and the pyramid (148 m, about
  // Frontier's 150 m, so each stays on the map).
  const reboundAreas = [{ x: 200, z: 152, r: 148 }, { x: 248, z: 200, r: 148 }, { x: 200, z: 248, r: 148 }, { x: 152, z: 200, r: 148 }];

  return {
    id: 'jadefall', name: 'Jadefall', theme: 'jadefall', size: 'giant', region: 'mixed', width: W, height: H,
    walls: P.walls, spawns, lanes, nav, points: { dom: [], hard: [] },
    rooms: P.rooms, roofs: P.roofs, zones: P.zones, roads: P.roads, rails: [], regionSeeds: REGION_SEEDS,
    shallows, underDecks, cells: { size: CELL, n: N, nz: N, cls },
    modes: ['br'], large: true,
    br: { pois: P.pois, loot: P.loot, chests: P.chests, drop: null, circleBias, reboundAreas, exfils },
    skipped,
  };
}

// A star fort round (cx, cz): curtain walls with gates north and south, a bastion at each corner.
function fort(P, cx, cz) {
  const half = 30, t = 1.6, h = 3.6, gate = 8;
  const x0 = cx - half, x1 = cx + half, z0 = cz - half + 4, z1 = cz + half - 4;
  const e = { fortwall: true, skin: 'jungle' };
  // North and south: two lengths either side of a gate.
  for (const z of [z0, z1 - t]) {
    P.add(x0 + 6, z, half - gate / 2 - 6, t, h, 'rock', e);
    P.add(cx + gate / 2, z, half - gate / 2 - 6, t, h, 'rock', e);
  }
  // West and east: a wall with a postern in the middle.
  for (const x of [x0, x1 - t]) {
    P.add(x, z0 + 6, t, (z1 - z0) / 2 - 6 - 1.6, h, 'rock', e);
    P.add(x, cz + 1.6, t, (z1 - z0) / 2 - 6 - 1.6, h, 'rock', e);
  }
  // Bastions: a solid diamond-ish block at each corner.
  for (const [bx, bz] of [[x0 - 3, z0 - 3], [x1 - 6, z0 - 3], [x0 - 3, z1 - 6], [x1 - 6, z1 - 6]]) P.add(bx, bz, 9, 9, h + 0.4, 'rock', { bastion: true, skin: 'jungle' });
}

// Sparse cover in the open by region, on dry land and off the paths.
function scatter(P, cellAt, keep = []) {
  const rnd = mulberry(1907);
  const STEP = 14;
  const near = (x, z) => P.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 4);
  const onRoad = (x, z, m) => P.roads.some(r => {
    for (let i = 1; i < r.pts.length; i++) if (segDist(x, z, r.pts[i - 1][0], r.pts[i - 1][1], r.pts[i][0], r.pts[i][1]) < r.w / 2 + m) return true;
    return false;
  });
  const field = regionOf;
  const KIT = {
    jungle: [
      () => ['rock', 2.2, 2.2, 4.6, { tree: true, skin: 'jungle' }],
      () => ['rock', 3.4, 3, 2.6, { thicket: true, skin: 'jungle' }],
      () => ['boulder', 2.6, 1.3, 1.0, { fern: true, skin: 'jungle' }],
      () => (rnd() < 0.5 ? ['boulder', 2.8, 1, 0.9, { log: true, skin: 'jungle' }] : ['boulder', 1, 2.8, 0.9, { log: true, skin: 'jungle' }]),
      () => ['rock', 3.4, 3, 3.2, { banana: true, skin: 'jungle' }],
    ],
    ruins: [
      () => (rnd() < 0.5 ? ['rock', 5 + rnd() * 3, 1.2, 2.6 + rnd() * 0.8, { ruin: true, skin: 'jungle' }] : ['rock', 1.2, 5 + rnd() * 3, 2.6 + rnd() * 0.8, { ruin: true, skin: 'jungle' }]),
      () => ['rock', 1.2, 1.2, 3.4, { ruin: 'pillar', skin: 'jungle' }],
      () => ['boulder', 2.4, 1.4, 1.0, { fallen: true, skin: 'jungle' }],
      () => ['rock', 2.2, 2.2, 4.6, { tree: true, skin: 'jungle' }],
    ],
    beach: [
      () => ['boulder', 2.4, 2.4, 1.0, { palm: true, skin: 'desert' }],
      () => ['boulder', 2 + rnd(), 1.6 + rnd(), 1.2, { crag: true }],
      () => ['barrier', 3.2, 1.6, 0.9, { dinghy: true, skin: 'pier' }],
      () => ['boulder', 2.4, 2.4, 1.0, { palm: true, skin: 'desert' }],
    ],
    mangrove: [
      () => ['rock', 3.6, 3.2, 2.8, { thicket: true, skin: 'jungle' }],
      () => (rnd() < 0.5 ? ['boulder', 3, 1, 0.9, { log: true, skin: 'jungle' }] : ['boulder', 1, 3, 0.9, { log: true, skin: 'jungle' }]),
      () => ['rock', 2.2, 2.2, 4.6, { tree: true, skin: 'jungle' }],
      () => ['boulder', 2.6, 1.3, 1.0, { fern: true, skin: 'jungle' }],
    ],
    highland: [
      () => ['rock', 4 + rnd() * 3, 3 + rnd() * 3, 3.4 + rnd() * 1.4, { crag: true }],
      () => ['boulder', 1.8, 1.6, 1.1, { crag: true }],
      () => ['rock', 2.2, 2.2, 4.6, { tree: true, skin: 'jungle' }],
    ],
  };
  for (let gz = 10; gz < P.H - 10; gz += STEP) {
    for (let gx = 10; gx < P.W - 10; gx += STEP) {
      const cx = gx + rnd() * STEP * 0.8, cz = gz + rnd() * STEP * 0.8;
      if (near(cx, cz) || rnd() < 0.25 || cellAt(cx, cz) !== LAND || keep.some(k => Math.hypot(k.x - cx, k.z - cz) < (k.r ?? 19))) continue;
      const region = field(cx, cz);
      P.region = region; P.tier = 3;
      const kit = KIT[region];
      const n = 1 + Math.floor(rnd() * 3);
      let placed = 0;
      for (let k = 0; k < n; k++) {
        const [kind, w, d, h, extra] = kit[Math.floor(rnd() * kit.length)]();
        const x = cx + (rnd() - 0.5) * 8, z = cz + (rnd() - 0.5) * 8;
        if (onRoad(x + w / 2, z + d / 2, Math.max(w, d) / 2 + 1)) continue;
        if (cellAt(x, z) !== LAND || cellAt(x + w, z + d) !== LAND || cellAt(x + w, z) !== LAND || cellAt(x, z + d) !== LAND) continue;
        if (!P.free(x, z, w, d, 2.2) || P.loot.some(l => l.x > x - 2.4 && l.x < x + w + 2.4 && l.z > z - 2.4 && l.z < z + d + 2.4)) continue;
        P.add(x, z, w, d, h, kind, extra);
        placed++;
      }
      if (placed && rnd() < 0.42) P.outdoorLoot(cx, cz, 5, 1, 3);
    }
  }
}

// The dressing region of a point (nearest seed, no warping: the renderer's regionField blends the borders).
function regionOf(x, z) {
  let best = 'jungle', bd = Infinity;
  for (const [r, sx, sz, b] of REGION_SEEDS) { const d = Math.hypot(x - sx, z - sz) - (b ?? 0); if (d < bd) { bd = d; best = r; } }
  return best;
}

export default build();
