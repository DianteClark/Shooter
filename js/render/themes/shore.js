// Kittiwake Bay (docs/DISTRICTS.md "The Coast"): the third region's palette and pieces, for the giant-world streamer in
// themes/frontier.js (which builds every tile; this module adds its tables, the bay's own piece drawers as the `shore`
// skin, the tile decor and the edge of the bay). A bright, windy morning: a low sun out of the east, a pale washed sky,
// spray and sand on the wind, a cold green-grey sea with white water on the shallows. Its districts (Fish Market,
// Shipyard, Boardwalk, Stilt Row) are drawn by the same streamer and the same drawers, so they look like themselves on
// their own and in the bay.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, mix } from './kit.js';

const H = hexRGB;
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));

THEMES.shore = {
  id: 'shore', giant: true,
  // Morning: the sun low in the east-south-east, a big pale sky doing most of the lighting.
  light: { dir: norm([0.75, 0.62, 0.25]), sun: [0.7, 0.66, 0.58], sky: [0.4, 0.46, 0.53], amb: [0.29, 0.31, 0.35] },
  clear: 0x9cb4c4,
  fog: [0.62, 0.7, 0.76], fogSeam: [0.16, 0.2, 0.24], desatTint: [0.86, 0.9, 0.94],
  shadow: { col: [0.42, 0.5, 0.6], strength: 0.42, len: 1.05 },
  lamp: [0.1, 0.08, 0.05],
  wet: 0.22, sheen: norm([0.6, 0.7, 0.3]), sheenCol: [0.6, 0.66, 0.7],
  water: { deep: [0.07, 0.19, 0.22], shallow: [0.3, 0.44, 0.42], glint: [0.95, 0.96, 0.92] },
  ink: ink({
    ground: 0x8c8f7e, asphalt: 0x55585c, dirt: 0x8a7c62, gravel: 0x8e8a80,
    roof: 0x4a5058, wall: 0xd8d2c2, wallB: 0xb8b0a0, trim: 0x2e3a44,
    concrete: 0x9a9890, crate: 0x8a7656, crateD: 0x54462f,
    rail: 0x8a929a, tie: 0x3c342c, hazardY: 0xd0a030, hazardK: 0x24282c,
    paint: 0xe8e4d8, glow: 0xffe4b0, glowCool: 0xe0f0ff,
    rock: 0x7e7c74, rockD: 0x5e5c56, rockL: 0x9a988e,
  }),
  containers: [0x2f6a8a, 0xb84a32, 0xd8a838, 0x3e7a5a, 0xe0e0d8],
  weather: { fields: [
    // Spray and sand on an onshore wind (from the east), the odd big drift of mist off the sea.
    { kind: 'mote', count: 90, box: [44, 5, 34], vel: [-3.2, 0.2, 0.6], size: 0.07, col: [1.0, 1.0, 0.96], alpha: 0.4 },
    { kind: 'mote', count: 40, box: [44, 1.2, 34], vel: [-2.4, 0.05, 0.4], size: 0.05, col: [0.9, 0.84, 0.7], alpha: 0.35 },
    { kind: 'mote', count: 10, box: [50, 3, 38], vel: [-1.6, 0.02, 0.3], size: 5, col: [0.9, 0.94, 0.98], alpha: 0.05 },
  ] },
};

export const thumb = { ground: '#8c8f7e', solid: '#d8d2c2', low: '#a49478', water: '#23434a', shallow: '#5c7c78', edge: '#3c4a44' };

// ---- Tables merged into the streamer's (themes/frontier.js) -----------------------------------------------------------

export const SKIN = { kwtown: 'shore', kwheath: 'shore', kwquay: 'shore', kwyard: 'shore', kwflat: 'shore', kwdune: 'shore', kwsea: 'shore' };
export const GROUND = {
  kwtown: { a: H(0x7e8a5e), b: H(0x74805a), c: H(0x8a9468), amp: 0.06 },     // Town greens and verges.
  kwheath: { a: H(0x7a7a4e), b: H(0x6e6a48), c: H(0x8a8458), amp: 0.12 },    // Heather and gorse on the headland.
  kwquay: { a: H(0x8a8a84), b: H(0x7e7e78), c: H(0x96948c), amp: 0.02 },     // Granite and setts.
  kwyard: { a: H(0x7e7c76), b: H(0x72706a), c: H(0x8a8478), amp: 0.03 },     // Yard concrete, rust stains.
  kwflat: { a: H(0x8a826a), b: H(0x7a725c), c: H(0x968e76), amp: 0.05 },     // Mud and sand at low water.
  kwdune: { a: H(0xcab894), b: H(0xbca986), c: H(0xd4c4a0), amp: 0.08 },     // Pale dune sand.
};
export const ROCK = {
  kwheath: { cols: [H(0x6e6c62), H(0x5a5850)], cap: H(0x7a7a50) },
  kwtown: { cols: [H(0x7e7c72), H(0x66645c)], cap: H(0x7e8a5e) },
  kwdune: { cols: [H(0x8a8270), H(0x726a5a)], cap: H(0xa8a070) },
  kwsea: { cols: [H(0x6a6a66), H(0x52524e)], cap: H(0x7a7a6e) },
};
export const BANK = {
  kwsea: { face: H(0x6a6a66), lip: H(0xa8a69c) }, kwquay: { face: H(0x6a6a66), lip: H(0xb4b0a4) }, kwyard: { face: H(0x5e5e5c), lip: H(0xa0a09a) },
  kwdune: { face: H(0x8a8270), lip: H(0xc8b890) }, kwflat: { face: H(0x5a5444), lip: H(0x7a725c) }, kwtown: { face: H(0x6a6a66), lip: H(0xa8a69c) },
};
export const ROAD = { kwsetts: H(0x7a7672), kwboards: H(0x9a8262) };
export const ZONE = {
  kwsetts: H(0x7a7672), kwmarket: H(0xa8a294), kwquayside: H(0x9a968c), kwdock: H(0x5e6062), kwconcrete: H(0x8e8c86),
  kwstock: H(0x7e7a70), kwsand: H(0xd2c29c), kwboards: H(0x9a8262), kwshingle: H(0x9a948a), kwslip: H(0x8a8680),
  kwgrass: H(0x7a8a54), kwtiles: H(0xd8dcd4),
};
// Building styles for the opened-up district blocks and the bay's own buildings.
export const STYLE = {
  kwcottage: { wall: [0xe8e2d2, 0xd8e0e0, 0xe8d8c0, 0xc8d4dc, 0xe0c8b8], trim: 0x2e3a44, roof: 0x4a5058, floor: 0x8a7458, floorB: 0x7a664c, roofKind: 'gable', planks: true },
  kwbrick: { wall: [0x8a4a38, 0x9a5a44, 0x7a4234], trim: 0xd8d2c2, roof: 0x4a5058, floor: 0x7a766e, floorB: 0x6e6a62, roofKind: 'gable' },
  kwshed: { wall: [0x6a7e8a, 0x7a8a8e, 0x5a6e7a], trim: 0xd0a030, roof: 0x8a9298, floor: 0x6a6862, floorB: 0x625f5a, roofKind: 'ridged' },
  kwresort: { wall: [0xf0e6d0, 0xe8d0d8, 0xd0e4e8, 0xf0dca8, 0xd8ecd8], trim: 0x3a7a9a, roof: 0x5a8aa0, floor: 0xc8b898, floorB: 0xb8a888, roofKind: 'hip' },
  kwtimber: { wall: [0x2e2c2a, 0x3a3632, 0x34302c], trim: 0xd8d2c2, roof: 0x5a5e62, floor: 0x7c6a52, floorB: 0x6a5a44, roofKind: 'gable', planks: true },
  kwstation: { wall: [0xe8e8e0], trim: 0x2a4a6a, roof: 0x3e4e5e, floor: 0x9a968a, floorB: 0x8a867a, roofKind: 'flat', parapet: true },
  kwchurch: { wall: [0x9a968a, 0x8e8a7e], trim: 0x5e5a52, roof: 0x4a5058, floor: 0x8a8070, floorB: 0x7a7060, roofKind: 'gable' },
  kwbunker: { wall: [0x8e8c84, 0x82807a], trim: 0x6a6862, roof: 0x7a786e, floor: 0x6a6862, floorB: 0x625f5a, roofKind: 'flat', parapet: true },
  kwglass: { wall: [0xe8ece8], trim: 0x3e6a5a, roof: 0x9ab8b4, floor: 0xb8b4a4, floorB: 0xa8a494, roofKind: 'ridged' },
  kwpavilion: { wall: [0xf0ead8], trim: 0x3a7a9a, roof: 0x5a8aa0, floor: 0xc8b898, floorB: 0xb8a888, roofKind: 'hip' },
};

// ---- Little helpers ----------------------------------------------------------------------------------------------

const hash = w => Math.abs(Math.round(w.x * 7.31 + w.z * 3.17 + w.w * 1.7));
const pick = (w, list) => H(list[hash(w) % list.length]);
const PASTEL = [0xe8b4b0, 0xa8d0d8, 0xf0dc98, 0xb8dcb0, 0xd8c0e0, 0xf4f0e4];
const BRIGHT = [0xd04a3a, 0x2f7aa8, 0xe0b030, 0x3e9a6a, 0xd86a9a];
const along = w => w.w >= w.d;

// A pitched roof over (x, z, w, d) from eave height y, ridge along the long side; `rise` metres.
function gable(b, x, z, w, d, y, rise, col, ov = 0.3) {
  const X0 = x - ov, X1 = x + w + ov, Z0 = z - ov, Z1 = z + d + ov, cx = x + w / 2, cz = z + d / 2;
  if (w >= d) {
    b.setColor(col); b.quad([X0, y, Z0], [X0, y + rise, cz], [X1, y + rise, cz], [X1, y, Z0], [cx, -10, cz]);
    b.setColor(scale(col, 0.8)); b.quad([X0, y, Z1], [X1, y, Z1], [X1, y + rise, cz], [X0, y + rise, cz], [cx, -10, cz]);
    b.setColor(scale(col, 0.9)); b.tri([x, y, z], [x, y, z + d], [x, y + rise, cz], [cx, y, cz]); b.tri([x + w, y, z], [x + w, y + rise, cz], [x + w, y, z + d], [cx, y, cz]);
  } else {
    b.setColor(scale(col, 0.8)); b.quad([X0, y, Z0], [X0, y, Z1], [cx, y + rise, Z1], [cx, y + rise, Z0], [cx, -10, cz]);
    b.setColor(col); b.quad([X1, y, Z0], [cx, y + rise, Z0], [cx, y + rise, Z1], [X1, y, Z1], [cx, -10, cz]);
    b.setColor(scale(col, 0.9)); b.tri([x, y, z], [cx, y + rise, z], [x + w, y, z], [cx, y, cz]); b.tri([x, y, z + d], [x + w, y, z + d], [cx, y + rise, z + d], [cx, y, cz]);
  }
}
// Windows along every face: dark panes in a light frame, `every` metres apart.
function windows(b, w, y0, h, every = 2.6, pane = H(0x34414a), frame = H(0xf0ece0)) {
  for (const [ax, az, L, nx, nz] of [[w.x, w.z, w.w, 0, -1], [w.x, w.z + w.d, w.w, 0, 1], [w.x, w.z, w.d, -1, 0], [w.x + w.w, w.z, w.d, 1, 0]]) {
    const n = Math.floor((L - 1) / every);
    for (let k = 1; k <= n; k++) {
      const s = (L * k) / (n + 1);
      const px = nz ? ax + s : ax, pz = nz ? az : az + s, o = 0.03;
      const fx = nz ? px - 0.45 : nx < 0 ? px - o : px, fz = nz ? (nz < 0 ? pz - o : pz) : pz - 0.45;
      b.setColor(frame); box3(b, fx - (nz ? 0.06 : 0), y0 - 0.06, fz - (nz ? 0 : 0.06), nz ? 1.02 : o + 0.02, h + 0.12, nz ? o + 0.02 : 1.02);
      b.setColor(pane); box3(b, fx, y0, fz, nz ? 0.9 : o + 0.04, h, nz ? o + 0.04 : 0.9);
    }
  }
}
const plinth = (b, w, col) => { b.setColor(col); box3(b, w.x - 0.04, 0, w.z - 0.04, w.w + 0.08, 0.3, w.d + 0.08); };

// ---- Buildings (kind 'building') ----------------------------------------------------------------------------------

function building(ctx, w) {
  const { b, glow } = ctx;
  if (w.spire) return spire(ctx, w);
  if (w.windmill) return windmill(ctx, w);
  if (w.chimney) { b.setColor(H(0x8a4a38)); b.prismY(0, w.h, w.x + w.w / 2, w.z + w.d / 2, w.w / 2, w.w / 2.6, 8); b.setColor(H(0x2a2a2a)); b.prismY(w.h, w.h + 0.6, w.x + w.w / 2, w.z + w.d / 2, w.w / 2.5, w.w / 2.5, 8); return; }
  if (w.mast) return mast(ctx, w);
  if (w.lighthouse2) return lighthouse(ctx, w);
  const h = w.h;
  if (w.stilt) {
    // A tarred hut on its plank platform: the piles at the corners, weatherboards, a tin roof, a net hung by the door.
    b.setColor(H(0x3a342e));
    for (const [px, pz] of [[w.x - 0.3, w.z - 0.3], [w.x + w.w, w.z - 0.3], [w.x - 0.3, w.z + w.d], [w.x + w.w, w.z + w.d]]) box3(b, px, -0.6, pz, 0.3, h + 0.6, 0.3);
    b.setColor(pick(w, [0x2e2c2a, 0x3a3632, 0x4a3e34])); box3(b, w.x, 0, w.z, w.w, h, w.d);
    b.setColor(H(0x5a5248)); for (let y = 0.5; y < h; y += 0.45) box3(b, w.x - 0.02, y, w.z - 0.02, w.w + 0.04, 0.04, w.d + 0.04);
    windows(b, w, 1.3, 0.9, 3.2, H(0x2a3238), H(0xd8d2c2));
    gable(b, w.x, w.z, w.w, w.d, h, Math.min(w.w, w.d) * 0.3, H(0x8a8e8a));
    b.setColor(H(0x4a6a5a)); box3(b, w.x + w.w * 0.6, 0.6, w.z + w.d + 0.02, 1.2, 1.6, 0.06);
    return;
  }
  if (w.netshed) {
    // The tall black net shops of the hamlet: narrow, tarred, a steep roof and a loft door.
    b.setColor(H(0x24221f)); box3(b, w.x, 0, w.z, w.w, h + 1.2, w.d);
    b.setColor(H(0x3a3632)); for (let y = 0.5; y < h + 1.2; y += 0.4) box3(b, w.x - 0.02, y, w.z - 0.02, w.w + 0.04, 0.035, w.d + 0.04);
    b.setColor(H(0x8a3a2a)); box3(b, w.x + w.w / 2 - 0.6, h - 0.2, w.z + w.d + 0.01, 1.2, 1.2, 0.05);
    gable(b, w.x, w.z, w.w, w.d, h + 1.2, Math.min(w.w, w.d) * 0.55, H(0x2e2c2a));
    return;
  }
  if (w.shed || w.winch || w.paintstore) {
    // Corrugated yard sheds: cladding ribs, a band of roof lights, the big doors in hazard paint.
    const col = w.paintstore ? H(0x8a4a38) : pick(w, [0x6a7e8a, 0x7a8a8e, 0x5a6e7a]);
    plinth(b, w, H(0x6a6862));
    b.setColor(col); box3(b, w.x, 0.3, w.z, w.w, h - 0.3, w.d);
    b.setColor(scale(col, 1.15));
    if (!w.paintstore) for (let s = 0.4; s < Math.max(w.w, w.d); s += 0.8) along(w) ? box3(b, w.x + s, 0.3, w.z - 0.03, 0.12, h - 0.3, w.d + 0.06) : box3(b, w.x - 0.03, 0.3, w.z + s, w.w + 0.06, h - 0.3, 0.12);
    b.setColor(H(0xd0a030)); box3(b, w.x - 0.04, h - 0.3, w.z - 0.04, w.w + 0.08, 0.3, w.d + 0.08);
    for (const end of [w.x - 0.05, w.x + w.w - 0.05]) { b.setColor(H(0x3a4a52)); box3(b, end, 0.3, w.z + w.d / 2 - 1.6, 0.1, Math.min(3.4, h - 0.8), 3.2); }
    gable(b, w.x, w.z, w.w, w.d, h, Math.min(w.w, w.d) * 0.12, H(0x8a9298), 0.2);
    b.setColor(H(0xc8dce4)); if (along(w)) box3(b, w.x + 1, h + 0.25, w.z + w.d / 2 - 0.4, w.w - 2, 0.06, 0.8); else box3(b, w.x + w.w / 2 - 0.4, h + 0.25, w.z + 1, 0.8, 0.06, w.d - 2);
    return;
  }
  if (w.icehouse || w.smokehouse) {
    const col = w.icehouse ? H(0xece8dc) : H(0x2e2c2a);
    plinth(b, w, H(0x5a5a56));
    b.setColor(col); box3(b, w.x, 0.3, w.z, w.w, h - 0.3, w.d);
    b.setColor(w.icehouse ? H(0x2f6a8a) : H(0x8a3a2a));
    for (const t of [0.3, 0.7]) box3(b, w.x + w.w * t - 0.7, 0.3, w.z + w.d + 0.01, 1.4, 2.4, 0.06);
    if (w.icehouse) { windows(b, w, 2.2, 0.8, 3, H(0x34414a), H(0x2f6a8a)); b.setColor(H(0x4a5058)); box3(b, w.x - 0.1, h, w.z - 0.1, w.w + 0.2, 0.3, w.d + 0.2); b.setColor(H(0x2f6a8a)); box3(b, w.x + 0.4, h + 0.3, w.z + 0.4, w.w * 0.3, 0.9, w.d * 0.3); }
    else { gable(b, w.x, w.z, w.w, w.d, h, Math.min(w.w, w.d) * 0.45, H(0x5a5048)); b.setColor(H(0x3a3430)); const cx = w.x + w.w / 2, cz = w.z + w.d / 2; box3(b, cx - 0.8, h + Math.min(w.w, w.d) * 0.45 - 0.3, cz - 0.8, 1.6, 1.0, 1.6); }
    return;
  }
  if (w.arcade || w.tearoom || w.chippy) return arcade(ctx, w);
  // Anything else (the town's tall terraces from the region fill): a painted terrace with a slate roof.
  const col = pick(w, [0xe8e2d2, 0xd8e0e0, 0xe8d8c0, 0xc8d4dc]);
  plinth(b, w, H(0x5e5a52));
  b.setColor(col); box3(b, w.x, 0.3, w.z, w.w, h - 0.3, w.d);
  for (let y = 1.2; y < h - 1; y += 2.6) windows(b, w, y, 1.1);
  gable(b, w.x, w.z, w.w, w.d, h, Math.min(w.w, w.d) * 0.35, H(0x4a5058));
  void glow;
}

// The resort's fronts: pastel stucco, a lit sign band and bulbs on the promenade side, striped awnings.
function arcade(ctx, w) {
  const { b, glow } = ctx;
  const h = w.h, col = pick(w, PASTEL), acc = pick({ x: w.z, z: w.x, w: w.d }, BRIGHT);
  // The front faces the map's middle (the promenade): north row faces south, south row north.
  const mid = (ctx.full?.promenade?.find(p => w.x < p.x + p.w && w.x + w.w > p.x)) ?? { z: ctx.H / 2 - 8, d: 16 };
  const front = w.z + w.d / 2 < mid.z + mid.d / 2 ? 1 : -1;
  const fz = front > 0 ? w.z + w.d : w.z;
  plinth(b, w, H(0x8a8478));
  b.setColor(col); box3(b, w.x, 0.3, w.z, w.w, h - 0.3, w.d);
  b.setColor(H(0xf4f0e4)); box3(b, w.x - 0.05, h - 0.25, w.z - 0.05, w.w + 0.1, 0.3, w.d + 0.1);
  // Shop windows along the front.
  b.setColor(H(0x3a4650)); box3(b, w.x + 0.6, 0.6, front > 0 ? fz : fz - 0.05, w.w - 1.2, 1.8, 0.05);
  if (w.arcade) {
    emissive(b, () => {
      b.setColor(acc); box3(b, w.x + 0.8, h - 1.3, front > 0 ? fz + 0.02 : fz - 0.1, w.w - 1.6, 0.8, 0.08);
      b.setColor([1, 0.92, 0.6]); for (let x = w.x + 0.6; x < w.x + w.w - 0.4; x += 0.9) box3(b, x, h - 0.2, front > 0 ? fz + 0.04 : fz - 0.12, 0.12, 0.12, 0.08);
    });
    glow.halo(w.x + w.w / 2, fz + front * 1.4, Math.min(5, w.w * 0.4), scale(acc, 0.1), 0.12);
  } else {
    // An awning in stripes over the door.
    for (let x = w.x + 0.4, i = 0; x < w.x + w.w - 0.4; x += 0.6, i++) {
      b.setColor(i % 2 ? H(0xf4f0e4) : (w.chippy ? H(0x2f7aa8) : H(0xd04a3a)));
      const z0 = front > 0 ? fz : fz - 1.2;
      b.quad([x, 2.6, front > 0 ? z0 : z0 + 1.2], [x + 0.6, 2.6, front > 0 ? z0 : z0 + 1.2], [x + 0.6, 2.2, front > 0 ? z0 + 1.2 : z0], [x, 2.2, front > 0 ? z0 + 1.2 : z0], [x + 0.3, 5, w.z + w.d / 2]);
    }
  }
  gable(b, w.x, w.z, w.w, w.d, h, Math.min(w.w, w.d) * 0.25, w.tearoom ? H(0x5a8aa0) : H(0x6a6e74));
}

function spire(ctx, w) {
  const { b } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  b.setColor(H(0x9a968a)); box3(b, w.x, 0, w.z, w.w, w.h * 0.55, w.d);
  b.setColor(H(0x34414a)); box3(b, cx - 0.5, w.h * 0.4, w.z - 0.03, 1, 1.4, 0.05); box3(b, cx - 0.5, w.h * 0.4, w.z + w.d - 0.02, 1, 1.4, 0.05);
  b.setColor(H(0x4a5058)); b.prismY(w.h * 0.55, w.h + 3, cx, cz, w.w * 0.62, 0.05, 4, Math.PI / 4);
  b.setColor(H(0xc8a040)); box3(b, cx - 0.06, w.h + 3, cz - 0.06, 0.12, 0.8, 0.12);
}

function windmill(ctx, w) {
  const { b } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2, r = w.w / 2;
  b.setColor(H(0xe8e2d2)); b.prismY(0, w.h, cx, cz, r, r * 0.65, 8);
  b.setColor(H(0x3a3430)); b.prismY(w.h, w.h + 1.8, cx, cz, r * 0.7, 0.2, 8);
  // Four sails on the east face, turned to the wind.
  b.setColor(H(0x6a5040));
  const hx = cx + r * 0.8, hy = w.h + 0.6;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + 0.4, ca = Math.cos(a), sa = Math.sin(a);
    b.quad([hx, hy, cz], [hx + 0.15, hy + sa * 6, cz + ca * 6], [hx + 0.15, hy + sa * 6 + ca * 1.1, cz + ca * 6 - sa * 1.1], [hx, hy + ca * 0.4, cz - sa * 0.4], [hx - 3, hy, cz]);
  }
}

function mast(ctx, w) {
  const { b, glow } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  b.setColor(H(0x8a9298));
  for (let k = 0; k < 6; k++) b.prismY((w.h / 6) * k, (w.h / 6) * (k + 1), cx, cz, 0.9 * (1 - k / 7), 0.9 * (1 - (k + 1) / 7), 3);
  b.setColor(H(0xd04a3a)); box3(b, cx - 0.5, w.h * 0.7, cz - 0.5, 1, 0.4, 1);
  emissive(b, () => { b.setColor([1, 0.25, 0.2]); box3(b, cx - 0.15, w.h, cz - 0.15, 0.3, 0.3, 0.3); });
  glow.halo(cx, cz, 2, [0.1, 0.02, 0.01], w.h + 0.2);
}

// Lantern Point's lighthouse: white tower with red bands on a granite base, the gallery and the lantern lit.
function lighthouse(ctx, w) {
  const { b, glow } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2, r = w.w / 2;
  b.setColor(H(0x7e7c74)); b.prismY(0, 1.2, cx, cz, r + 0.6, r + 0.4, 10);
  const bands = 6;
  for (let k = 0; k < bands; k++) {
    const y0 = 1.2 + (w.h - 1.2) * k / bands, y1 = 1.2 + (w.h - 1.2) * (k + 1) / bands;
    b.setColor(k % 2 ? H(0xc83a2e) : H(0xf2f0e8));
    b.prismY(y0, y1, cx, cz, r * (1 - 0.35 * k / bands), r * (1 - 0.35 * (k + 1) / bands), 12);
  }
  const rt = r * 0.65;
  b.setColor(H(0x2a2a2a)); b.prismY(w.h, w.h + 0.25, cx, cz, rt + 0.6, rt + 0.6, 12);
  emissive(b, () => { b.setColor([1, 0.95, 0.7]); b.prismY(w.h + 0.25, w.h + 1.6, cx, cz, rt * 0.75, rt * 0.75, 10); });
  b.setColor(H(0xc83a2e)); b.prismY(w.h + 1.6, w.h + 2.6, cx, cz, rt * 0.85, 0.15, 10);
  glow.halo(cx, cz, 5, [0.2, 0.18, 0.1], w.h + 1);
  ctx.lamps.push({ x: cx, z: cz, r: 10, col: [0.2, 0.18, 0.1] });
}

// ---- Shops (kind 'shop'): kiosks, beach huts, the rides, caravans, the bandstand -------------------------------

function shop(ctx, w) {
  const { b, glow } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  if (w.beachhuts) {
    const n = w.beachhuts, horiz = along(w), L = (horiz ? w.w : w.d) / n;
    for (let k = 0; k < n; k++) {
      const x = horiz ? w.x + k * L : w.x, z = horiz ? w.z : w.z + k * L, ww = horiz ? L - 0.08 : w.w, dd = horiz ? w.d : L - 0.08;
      b.setColor(H(PASTEL[(hash(w) + k * 3) % PASTEL.length])); box3(b, x, 0.2, z, ww, w.h - 0.6, dd);
      b.setColor(H(0xf4f0e4)); for (let y = 0.5; y < w.h - 0.6; y += 0.5) box3(b, x - 0.02, y, z - 0.02, ww + 0.04, 0.03, dd + 0.04);
      gable(b, x, z, ww, dd, w.h - 0.4, 0.7, H(0xf4f0e4), 0.12);
      b.setColor(H(0x5a4a3a)); box3(b, x - 0.05, 0, z - 0.05, ww + 0.1, 0.2, dd + 0.1);
    }
    return;
  }
  if (w.kiosk) {
    b.setColor(H(0xf4f0e4)); b.prismY(0, w.h - 0.6, cx, cz, w.w / 2, w.w / 2, 8);
    b.setColor(H(0xd86a9a)); b.prismY(w.h - 0.6, w.h + 0.5, cx, cz, w.w / 2 + 0.4, 0.2, 8);
    b.setColor(H(0x3a4650)); b.prismY(1.0, 1.9, cx, cz, w.w / 2 + 0.02, w.w / 2 + 0.02, 8);
    b.setColor(H(0xf0dc98)); b.prismY(w.h + 0.5, w.h + 1.3, cx, cz, 0.05, 0.35, 6);   // The cone on top.
    b.setColor(H(0xe8b4b0)); b.prismY(w.h + 1.3, w.h + 1.6, cx, cz, 0.38, 0.1, 6);
    return;
  }
  if (w.carousel || w.bandstand) {
    // A round platform, brass poles, a striped canopy (the bandstand's in green, open sides).
    const r = w.w / 2;
    b.setColor(w.bandstand ? H(0x9a968a) : H(0xd8c8a0)); b.prismY(0, 0.5, cx, cz, r, r, 12);
    b.setColor(H(0xc8a040)); for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; b.prismY(0.5, w.h - 0.4, cx + Math.cos(a) * r * 0.8, cz + Math.sin(a) * r * 0.8, 0.06, 0.06, 4); }
    if (w.carousel) {
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + 0.2; b.setColor(H(PASTEL[k % PASTEL.length])); box3(b, cx + Math.cos(a) * r * 0.62 - 0.3, 1.0, cz + Math.sin(a) * r * 0.62 - 0.15, 0.6, 0.5, 0.3); }
      b.setColor(H(0xe8e0c8)); b.prismY(0.5, w.h - 0.4, cx, cz, 0.7, 0.7, 8);
    }
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2;
      b.setColor(w.bandstand ? (k % 2 ? H(0x3e6a5a) : H(0x2e5a4a)) : (k % 2 ? H(0xf4f0e4) : H(0xd04a3a)));
      b.tri([cx + Math.cos(a0) * (r + 0.3), w.h - 0.4, cz + Math.sin(a0) * (r + 0.3)], [cx, w.h + 1.2, cz], [cx + Math.cos(a1) * (r + 0.3), w.h - 0.4, cz + Math.sin(a1) * (r + 0.3)], [cx, -5, cz]);
    }
    b.setColor(H(0xc8a040)); box3(b, cx - 0.08, w.h + 1.2, cz - 0.08, 0.16, 0.6, 0.16);
    if (w.carousel) emissive(b, () => { b.setColor([1, 0.9, 0.6]); for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; box3(b, cx + Math.cos(a) * (r + 0.25) - 0.06, w.h - 0.5, cz + Math.sin(a) * (r + 0.25) - 0.06, 0.12, 0.12, 0.12); } });
    glow.halo(cx, cz, r + 1, [0.06, 0.05, 0.02], 0.12);
    return;
  }
  if (w.helter) {
    // The helter-skelter: a striped tower, the slide winding round it, a flag on top.
    const r = w.w / 2 - 0.6, top = w.h + 4;
    for (let k = 0; k < 7; k++) { b.setColor(k % 2 ? H(0xf4f0e4) : H(0x2f7aa8)); b.prismY((top / 7) * k, (top / 7) * (k + 1), cx, cz, r * 0.55, r * 0.5, 10); }
    b.setColor(H(0xd04a3a)); b.prismY(top, top + 1.4, cx, cz, r * 0.75, 0.1, 10);
    b.setColor(H(0xf0dc98));
    for (let s = 0; s < 40; s++) {
      const a = s * 0.42, y = top - 0.5 - s * (top - 0.8) / 40, rr = r * 0.95;
      box3(b, cx + Math.cos(a) * rr - 0.35, y, cz + Math.sin(a) * rr - 0.35, 0.7, 0.12, 0.7);
    }
    b.setColor(H(0xd8c8a0)); b.prismY(0, 0.3, cx, cz, w.w / 2, w.w / 2, 12);
    return;
  }
  if (w.caravan) {
    b.setColor(H(0xece8dc)); box3(b, w.x, 0.35, w.z, w.w, w.h - 0.5, w.d);
    b.setColor(pick(w, [0x2f7aa8, 0x3e9a6a, 0xd04a3a])); box3(b, w.x - 0.02, 1.1, w.z - 0.02, w.w + 0.04, 0.3, w.d + 0.04);
    b.setColor(H(0xdedad0)); box3(b, w.x + 0.1, w.h - 0.15, w.z + 0.1, w.w - 0.2, 0.15, w.d - 0.2);
    b.setColor(H(0x2a2a2a)); box3(b, w.x - 0.1, 0, w.z + w.d * 0.4, w.w + 0.2, 0.4, 0.5);
    return;
  }
  // Anything else: a small painted shed.
  b.setColor(pick(w, PASTEL)); box3(b, w.x, 0, w.z, w.w, w.h, w.d);
  gable(b, w.x, w.z, w.w, w.d, w.h, 0.6, H(0x4a5058), 0.15);
}

// ---- Low cover: counters, boxes, the yard's pieces, beach things ----------------------------------------------------

function stall(ctx, w) {
  const { b, rnd } = ctx;
  b.setColor(H(0x8a8e92)); box3(b, w.x, 0, w.z, w.w, w.h - 0.15, w.d);
  b.setColor(H(0xe8eef0)); box3(b, w.x - 0.04, w.h - 0.15, w.z - 0.04, w.w + 0.08, 0.12, w.d + 0.08);
  // Fish on ice.
  for (let k = 0; k < Math.round(w.w * w.d * 2); k++) {
    b.setColor(rnd() < 0.6 ? H(0x8a96a0) : rnd() < 0.5 ? H(0xc87a5a) : H(0x5a6a74));
    const fx = w.x + 0.1 + rnd() * (w.w - 0.5), fz = w.z + 0.1 + rnd() * (w.d - 0.5);
    box3(b, fx, w.h - 0.03, fz, along(w) ? 0.4 : 0.14, 0.06, along(w) ? 0.14 : 0.4);
  }
}

function crate(ctx, w) {
  const { b, rnd } = ctx;
  if (w.fishbox) {
    // Stacks of plastic fish boxes, mixed colours.
    const n = 3, s = w.w / 2;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < n; k++) {
      if (k === n - 1 && rnd() < 0.4) continue;
      b.setColor(H(BRIGHT[Math.floor(rnd() * BRIGHT.length)]));
      box3(b, w.x + i * s + 0.03, k * (w.h / n), w.z + j * s + 0.03, s - 0.06, w.h / n - 0.04, s - 0.06);
    }
    return;
  }
  if (w.pots) {
    for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) {
      const x = w.x + 0.05 + i * w.w / 2, z = w.z + 0.05 + k * w.d / 2, s = w.w / 2 - 0.1;
      b.setColor(H(0x3e5a4a)); box3(b, x, 0, z, s, 0.08, s); box3(b, x, w.h * 0.5, z, s, 0.06, s);
      b.setColor(H(0x6a5a44)); for (const [px, pz] of [[x, z], [x + s - 0.06, z], [x, z + s - 0.06], [x + s - 0.06, z + s - 0.06]]) box3(b, px, 0, pz, 0.06, w.h * 0.55, 0.06);
      b.setColor(H(0xd86a3a)); box3(b, x + s / 2 - 0.1, w.h * 0.55, z + s / 2 - 0.1, 0.2, 0.2, 0.2);
    }
    return;
  }
  if (w.ice) { b.setColor(H(0xf0f2f0)); box3(b, w.x, 0, w.z, w.w, w.h, w.d); b.setColor(H(0x2f6a8a)); box3(b, w.x - 0.02, w.h - 0.12, w.z - 0.02, w.w + 0.04, 0.14, w.d + 0.04); return; }
  ctx.kit.crate(b, w, rnd);
}

function barrier(ctx, w) {
  const { b, rnd } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2, horiz = along(w);
  if (w.car || w.van) {
    const col = w.van ? H(0xece8dc) : pick(w, [0x2f6a8a, 0xb84a32, 0xd8d2c2, 0x3e5a4a, 0x8a8e92]);
    b.setColor(H(0x222222)); box3(b, w.x + 0.1, 0, w.z + 0.1, w.w - 0.2, 0.4, w.d - 0.2);
    b.setColor(col); box3(b, w.x, 0.3, w.z, w.w, 0.6, w.d);
    const L = horiz ? w.w : w.d, cab = w.van ? 0.8 : 0.55;
    b.setColor(w.van ? col : scale(col, 0.95));
    if (horiz) box3(b, w.x + (w.van ? 0.2 : L * 0.22), 0.9, w.z + 0.15, L * cab, w.h - 0.9, w.d - 0.3);
    else box3(b, w.x + 0.15, 0.9, w.z + (w.van ? 0.2 : L * 0.22), w.w - 0.3, w.h - 0.9, L * cab);
    b.setColor(H(0x34414a));
    if (horiz) box3(b, w.x + L * 0.25, w.h - 0.45, w.z + 0.12, L * 0.45, 0.32, w.d - 0.24); else box3(b, w.x + 0.12, w.h - 0.45, w.z + L * 0.25, w.w - 0.24, 0.32, L * 0.45);
    if (w.van) { b.setColor(H(0x2f7aa8)); horiz ? box3(b, w.x + 0.4, 0.95, w.z - 0.02, L * 0.6, 0.35, w.d + 0.04) : box3(b, w.x - 0.02, 0.95, w.z + 0.4, w.w + 0.04, 0.35, L * 0.6); }
    return;
  }
  if (w.forklift) {
    b.setColor(H(0xd0a030)); box3(b, w.x, 0.2, w.z, w.w * 0.7, 0.9, w.d);
    b.setColor(H(0x2a2a2a)); box3(b, w.x + 0.2, 1.1, w.z + 0.2, w.w * 0.4, 0.06, w.d - 0.4); box3(b, w.x + w.w * 0.7, 0, w.z + 0.2, 0.12, w.h + 0.6, 0.12); box3(b, w.x + w.w * 0.7, 0, w.z + w.d - 0.32, 0.12, w.h + 0.6, 0.12);
    b.setColor(H(0x6a6a6a)); box3(b, w.x + w.w * 0.72, 0.1, w.z + 0.25, w.w * 0.28, 0.06, w.d - 0.5);
    return;
  }
  if (w.bollard) { b.setColor(H(0x2a2a2a)); b.prismY(0, w.h, cx, cz, w.w / 2, w.w / 2.6, 8); b.setColor(H(0x3a3a3a)); b.prismY(w.h - 0.15, w.h, cx, cz, w.w / 1.8, w.w / 1.8, 8); return; }
  if (w.dockedge) {
    b.setColor(H(0x9a968c)); box3(b, w.x, 0, w.z, w.w, w.h, w.d);
    b.setColor(H(0xd0a030)); box3(b, w.x - 0.02, w.h - 0.1, w.z - 0.02, w.w + 0.04, 0.1, w.d + 0.04);
    b.setColor(H(0x5a5a58)); for (let s = 0.8; s < Math.max(w.w, w.d) - 0.4; s += 3) horiz ? box3(b, w.x + s, w.h, w.z + w.d / 2 - 0.12, 0.08, 1.0, 0.08) : box3(b, w.x + w.w / 2 - 0.04, w.h, w.z + s, 0.08, 1.0, 0.08);
    return;
  }
  if (w.timber || w.keel) {
    const n = w.keel ? 3 : 5;
    for (let k = 0; k < n; k++) {
      b.setColor(scale(w.keel ? H(0x6a5040) : H(0xa8885a), 0.85 + rnd() * 0.25));
      const y = (w.h / n) * k, t = w.h / n - 0.03;
      if (w.keel) box3(b, w.x + k * (w.w / n), 0, w.z, w.w / n - 0.1, w.h, w.d);
      else box3(b, w.x, y, w.z, w.w, t, w.d);
    }
    return;
  }
  if (w.shoring) { b.setColor(H(0x8a6a44)); box3(b, w.x, 0, w.z, w.w, w.h, w.d); b.setColor(H(0x6a5040)); box3(b, w.x + w.w / 2 - 0.1, w.h, w.z + w.d / 2 - 0.1, 0.2, 1.8, 0.2); return; }
  if (w.boat) {
    // A clinker rowing boat, upturned on the beach (afloat: sitting on the mud the right way up).
    const col = pick(w, [0x2f6a8a, 0xb84a32, 0x3e7a5a, 0xf0ece0]);
    if (w.afloat) {
      b.setColor(col); horiz ? b.prismY(0, w.h * 0.6, cx, cz, w.w / 2, w.w / 2 - 0.2, 4) : b.prismY(0, w.h * 0.6, cx, cz, w.d / 2, w.d / 2 - 0.2, 4);
      b.setColor(H(0x8a6a44)); horiz ? box3(b, w.x + 0.4, w.h * 0.45, w.z + 0.25, w.w - 0.8, 0.1, w.d - 0.5) : box3(b, w.x + 0.25, w.h * 0.45, w.z + 0.4, w.w - 0.5, 0.1, w.d - 0.8);
    } else {
      b.setColor(col); horiz ? box3(b, w.x + 0.2, 0, w.z, w.w - 0.4, w.h * 0.7, w.d) : box3(b, w.x, 0, w.z + 0.2, w.w, w.h * 0.7, w.d - 0.4);
      b.setColor(scale(col, 0.8)); horiz ? box3(b, w.x + 0.5, w.h * 0.7, w.z + 0.3, w.w - 1, w.h * 0.3, w.d - 0.6) : box3(b, w.x + 0.3, w.h * 0.7, w.z + 0.5, w.w - 0.6, w.h * 0.3, w.d - 1);
    }
    return;
  }
  if (w.bench) { b.setColor(H(0x2e4a3a)); box3(b, w.x, 0, w.z, w.w, 0.45, w.d); b.setColor(H(0x9a7a52)); box3(b, w.x - 0.05, 0.45, w.z - 0.05, w.w + 0.1, 0.08, w.d + 0.1); box3(b, horiz ? w.x : w.x + w.w - 0.1, 0.5, horiz ? w.z + w.d - 0.1 : w.z, horiz ? w.w : 0.1, 0.4, horiz ? 0.1 : w.d); return; }
  if (w.shelter) {
    b.setColor(H(0x2e4a3a)); for (const px of [w.x, w.x + w.w - 0.15]) box3(b, px, 0, w.z, 0.15, w.h, 0.15);
    b.setColor(H(0xc8dce4)); box3(b, w.x, 0.3, w.z, w.w, w.h - 0.4, 0.05);
    b.setColor(H(0x3e6a5a)); box3(b, w.x - 0.2, w.h, w.z - 0.3, w.w + 0.4, 0.12, w.d + 0.4);
    b.setColor(H(0x9a7a52)); box3(b, w.x + 0.2, 0.45, w.z + 0.2, w.w - 0.4, 0.08, w.d - 0.6);
    return;
  }
  if (w.windbreak) {
    for (let s = 0, i = 0; s < (horiz ? w.w : w.d); s += 0.5, i++) {
      b.setColor(i % 2 ? H(0xf4f0e4) : H(BRIGHT[hash(w) % BRIGHT.length]));
      horiz ? box3(b, w.x + s, 0, w.z + w.d / 2 - 0.03, 0.5, w.h, 0.06) : box3(b, w.x + w.w / 2 - 0.03, 0, w.z + s, 0.06, w.h, 0.5);
    }
    b.setColor(H(0x8a6a44)); for (let s = 0; s <= (horiz ? w.w : w.d); s += 1) horiz ? box3(b, w.x + s - 0.04, 0, w.z + w.d / 2 - 0.04, 0.08, w.h + 0.1, 0.08) : box3(b, w.x + w.w / 2 - 0.04, 0, w.z + s - 0.04, 0.08, w.h + 0.1, 0.08);
    return;
  }
  if (w.deckchairs) {
    const n = Math.max(2, Math.round((horiz ? w.w : w.d) / 0.8));
    for (let k = 0; k < n; k++) {
      const x = horiz ? w.x + k * (w.w / n) : w.x, z = horiz ? w.z : w.z + k * (w.d / n), s = (horiz ? w.w : w.d) / n - 0.1;
      b.setColor(H(0x8a6a44)); box3(b, x, 0, z, horiz ? s : w.w, 0.3, horiz ? w.d : s);
      b.setColor(H(BRIGHT[(hash(w) + k) % BRIGHT.length]));
      horiz ? b.quad([x, 0.3, z + 0.1], [x + s, 0.3, z + 0.1], [x + s, w.h, z + w.d - 0.1], [x, w.h, z + w.d - 0.1], [x + s / 2, 5, z]) : b.quad([x + 0.1, 0.3, z], [x + w.w - 0.1, w.h, z], [x + w.w - 0.1, w.h, z + s], [x + 0.1, 0.3, z + s], [x, 5, z + s / 2]);
    }
    return;
  }
  if (w.groyne) {
    b.setColor(H(0x5a4a3a)); box3(b, w.x, -0.4, w.z, w.w, w.h + 0.4, w.d);
    b.setColor(H(0x3a3028)); for (let s = 0; s < (horiz ? w.w : w.d); s += 1.6) horiz ? box3(b, w.x + s, -0.4, w.z - 0.1, 0.2, w.h + 0.6, w.d + 0.2) : box3(b, w.x - 0.1, -0.4, w.z + s, w.w + 0.2, w.h + 0.6, 0.2);
    b.setColor(H(0x3a5a3a)); horiz ? box3(b, w.x, -0.4, w.z - 0.02, w.w, 0.5, w.d + 0.04) : box3(b, w.x - 0.02, -0.4, w.z, w.w + 0.04, 0.5, w.d);
    return;
  }
  if (w.nets) {
    b.setColor(H(0x6a5040)); for (const [px, pz] of horiz ? [[w.x, w.z], [w.x + w.w - 0.12, w.z]] : [[w.x, w.z], [w.x, w.z + w.d - 0.12]]) box3(b, px, 0, pz, 0.12, w.h + 0.3, w.d > 0.6 && horiz ? 0.12 : 0.12);
    b.setColor(H(0x4a6a5a)); horiz ? b.quad([w.x, 0.3, cz], [w.x + w.w, 0.3, cz], [w.x + w.w, w.h + 0.2, cz], [w.x, w.h + 0.2, cz], [cx, 0, cz - 2]) : b.quad([cx, 0.3, w.z], [cx, w.h + 0.2, w.z], [cx, w.h + 0.2, w.z + w.d], [cx, 0.3, w.z + w.d], [cx - 2, 0, cz]);
    b.setColor(H(0xd86a3a)); for (let s = 0.4; s < (horiz ? w.w : w.d); s += 0.9) horiz ? box3(b, w.x + s, w.h + 0.1, cz - 0.08, 0.16, 0.16, 0.16) : box3(b, cx - 0.08, w.h + 0.1, w.z + s, 0.16, 0.16, 0.16);
    return;
  }
  if (w.capstan) { b.setColor(H(0x3a3a3a)); b.prismY(0, w.h, cx, cz, w.w / 2, w.w / 2.4, 8); b.setColor(H(0x8a6a44)); box3(b, cx - 1, w.h - 0.3, cz - 0.06, 2, 0.12, 0.12); box3(b, cx - 0.06, w.h - 0.3, cz - 1, 0.12, 0.12, 2); return; }
  if (w.post) { b.setColor(H(0x4a3e30)); box3(b, w.x, -0.4, w.z, w.w, w.h + 0.4, w.d); b.setColor(H(0xd0a030)); box3(b, w.x - 0.02, w.h - 0.2, w.z - 0.02, w.w + 0.04, 0.2, w.d + 0.04); return; }
  if (w.headstone) { b.setColor(scale(H(0x9a968a), 0.8 + rnd() * 0.3)); box3(b, w.x, 0, w.z, w.w, w.h, w.d); return; }
  if (w.hay) { b.setColor(H(0xc8a860)); b.prismY(0, w.h, cx, cz, w.w / 2, w.w / 2, 10); return; }
  if (w.lifebuoy) { b.setColor(H(0x3e6a5a)); box3(b, cx - 0.06, 0, cz - 0.06, 0.12, 1.6, 0.12); b.setColor(H(0xd86a3a)); b.prismY(0.9, 1.5, cx, cz + 0.08, 0.3, 0.3, 8); return; }
  if (w.gun) { b.setColor(H(0x5a6052)); b.prismY(0, 0.8, cx, cz, w.w / 2, w.w / 2.4, 8); box3(b, cx, 0.7, cz - 0.12, 3.2, 0.24, 0.24); return; }
  ctx.kit.barrier(b, w);
}

function container(ctx, w) {
  const { b, rnd } = ctx;
  if (w.plates) {
    const n = 7;
    for (let k = 0; k < n; k++) { b.setColor(scale(k % 3 ? H(0x5a5e62) : H(0x8a5a3a), 0.85 + rnd() * 0.25)); box3(b, w.x + rnd() * 0.15, (w.h / n) * k, w.z + rnd() * 0.15, w.w - 0.15, w.h / n - 0.03, w.d - 0.15); }
    b.setColor(H(0x3a3a3a)); box3(b, w.x - 0.05, 0, w.z + w.d * 0.2, w.w + 0.1, 0.2, 0.25); box3(b, w.x - 0.05, 0, w.z + w.d * 0.7, w.w + 0.1, 0.2, 0.25);
    return;
  }
  ctx.kit.container(b, w, rnd);
}

function wallPiece(ctx, w) {
  const { b, rnd } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  if (w.column) {
    b.setColor(H(0x2e5a4a)); box3(b, w.x, 0, w.z, w.w, w.h, w.d);
    b.setColor(H(0x3e6a5a)); box3(b, w.x - 0.1, 0, w.z - 0.1, w.w + 0.2, 0.5, w.d + 0.2); box3(b, w.x - 0.15, w.h - 0.3, w.z - 0.15, w.w + 0.3, 0.3, w.d + 0.3);
    return;
  }
  if (w.boxwall) {
    for (let y = 0; y < w.h - 0.01; y += w.h / 4) for (let s = 0; s < Math.max(w.w, w.d) - 0.01; s += 0.9) {
      b.setColor(H(BRIGHT[Math.floor(rnd() * BRIGHT.length)]));
      along(w) ? box3(b, w.x + s + 0.02, y, w.z + 0.02, 0.86, w.h / 4 - 0.04, w.d - 0.04) : box3(b, w.x + 0.02, y, w.z + s + 0.02, w.w - 0.04, w.h / 4 - 0.04, 0.86);
    }
    return;
  }
  if (w.lifeguard) {
    b.setColor(H(0xf4f0e4)); for (const [px, pz] of [[w.x, w.z], [w.x + w.w - 0.12, w.z], [w.x, w.z + w.d - 0.12], [w.x + w.w - 0.12, w.z + w.d - 0.12]]) box3(b, px, 0, pz, 0.12, w.h - 0.8, 0.12);
    b.setColor(H(0xd04a3a)); box3(b, w.x - 0.1, w.h - 0.9, w.z - 0.1, w.w + 0.2, 0.9, w.d + 0.2);
    b.setColor(H(0xf0dc98)); box3(b, w.x - 0.3, w.h, w.z - 0.3, w.w + 0.6, 0.1, w.d + 0.6);
    return;
  }
  if (w.pierarch) { b.setColor(H(0xf4f0e4)); box3(b, w.x, 0, w.z, w.w, w.h, w.d); b.setColor(H(0x3a7a9a)); box3(b, w.x - 0.1, w.h - 0.4, w.z - 0.1, w.w + 0.2, 0.4, w.d + 0.2); b.setColor(H(0xc8a040)); b.prismY(w.h, w.h + 0.9, cx, cz, 0.45, 0.05, 6); return; }
  if (w.tree) {
    // Wind-bent coastal pines: the crown pushed west by the wind off the sea.
    b.setColor(H(0x5a4636)); b.prismY(0, w.h * 0.7, cx, cz, 0.22, 0.14, 5);
    b.setColor(H(0x3e5a3a)); b.prismY(w.h * 0.55, w.h, cx - 0.6, cz, 1.9, 0.9, 7, rnd());
    b.setColor(H(0x4e6a44)); b.prismY(w.h * 0.8, w.h + 0.5, cx - 0.9, cz, 1.2, 0.3, 6, rnd());
    return;
  }
  if (w.wheel) return wheel(ctx, w);
  ctx.kit.concreteWall(b, w);
}

// The big wheel on the pier head: its A-frame stands on the piece, the wheel (art only) turns over the sea.
function wheel(ctx, w) {
  const { b, glow } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2, R = 7, hub = R + 1.4;
  b.setColor(H(0xf4f0e4));
  for (const dz of [-1.6, 1.6]) {
    b.quad([cx - 0.15, 0, cz + dz - 2.6], [cx - 0.15, hub, cz + dz * 0.3], [cx + 0.15, hub, cz + dz * 0.3], [cx + 0.15, 0, cz + dz - 2.6], [cx + 3, 0, cz]);
    b.quad([cx - 0.15, 0, cz + dz + 2.6], [cx + 0.15, 0, cz + dz + 2.6], [cx + 0.15, hub, cz + dz * 0.3], [cx - 0.15, hub, cz + dz * 0.3], [cx - 3, 0, cz]);
  }
  const n = 16;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    const p = a => [cz + Math.cos(a) * R, hub + Math.sin(a) * R];
    const [z0, y0] = p(a0), [z1, y1] = p(a1);
    b.setColor(H(0xf4f0e4)); b.quad([cx - 0.2, y0, z0], [cx - 0.2, y1, z1], [cx + 0.2, y1, z1], [cx + 0.2, y0, z0], [cx, hub, cz]);
    b.setColor(H(0xc8c4b8)); b.quad([cx - 0.04, hub, cz], [cx - 0.04, y0, z0], [cx + 0.04, y0, z0], [cx + 0.04, hub, cz], [cx + 2, hub, cz]);
    b.setColor(H(BRIGHT[k % BRIGHT.length])); box3(b, cx - 0.6, y0 - 1.1, z0 - 0.5, 1.2, 0.9, 1.0);
  }
  emissive(b, () => { b.setColor([1, 0.9, 0.6]); for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; box3(b, cx + 0.2, hub + Math.sin(a) * R - 0.08, cz + Math.cos(a) * R - 0.08, 0.06, 0.16, 0.16); } });
  glow.halo(cx, cz, 4, [0.06, 0.05, 0.02], 0.12);
}

// Ship hulls: the trawler tied up in the market's basin, the coaster in the wet basin, the hulls building in the dock.
function hull(ctx, w) {
  const { b } = ctx;
  const horiz = along(w), L = horiz ? w.w : w.d, B = horiz ? w.d : w.w, bow = w.bow ?? 1;
  const yard = !!w.yardship, top = w.h, low = yard ? 0 : -0.6;
  const keel = yard ? H(0x8a2a24) : H(0x2a2e34);
  const side = yard ? H(0x5a6066) : w.coaster ? H(0x2f4a6a) : pick(w, [0x2f6a8a, 0x3e7a5a, 0xb84a32]);
  // Local frame: s along the hull (0 stern .. L bow), t across (0..B).
  const P = (s, y, t) => {
    const ss = bow > 0 ? s : L - s;
    return horiz ? [w.x + ss, y, w.z + t] : [w.x + t, y, w.z + ss];
  };
  const prow = L - B * 0.9;
  const ring = [[0, 0], [prow, 0], [L, B / 2], [prow, B], [0, B]];
  for (const [y0, y1, col] of [[low, top * 0.45, keel], [top * 0.45, top, side]]) {
    for (let k = 0; k < ring.length; k++) {
      const [s0, t0] = ring[k], [s1, t1] = ring[(k + 1) % ring.length];
      const inset = y0 === low ? 0.35 : 0;
      const q = (s, t, y, ins) => P(s + (s === 0 ? ins : s >= prow ? -ins : 0), y, t + (t === 0 ? ins : t === B ? -ins : 0));
      b.setColor(col); b.quad(q(s0, t0, y0, inset), q(s1, t1, y0, inset), q(s1, t1, y1, 0), q(s0, t0, y1, 0), P(L / 2, top / 2, B / 2));
    }
  }
  // The deck.
  b.setColor(yard ? H(0x6a6e72) : H(0x8a7a62));
  b.tri(P(0, top, 0), P(prow, top, 0), P(prow, top, B), P(L / 2, top - 5, B / 2)); b.tri(P(0, top, 0), P(prow, top, B), P(0, top, B), P(L / 2, top - 5, B / 2));
  b.tri(P(prow, top, 0), P(L, top, B / 2), P(prow, top, B), P(prow, top - 5, B / 2));
  if (yard) {
    // Building: scaffold along the sides, a half-built deckhouse, keel blocks under her.
    b.setColor(H(0x9a968c)); for (let s = 1; s < L - 1; s += 2.5) for (const t of [-0.7, B + 0.3]) { const [x, , z] = P(s, 0, t); box3(b, x - 0.05, 0, z - 0.05, 0.1, top + 0.8, 0.1); }
    b.setColor(H(0xa8885a)); for (const t of [-0.75, B + 0.25]) { const a = P(0.5, top + 0.1, t), c = P(L - 1, top + 0.1, t); box3(b, Math.min(a[0], c[0]), top + 0.1, Math.min(a[2], c[2]), Math.abs(c[0] - a[0]) || 0.5, 0.08, Math.abs(c[2] - a[2]) || 0.5); }
    b.setColor(H(0xd8d4c8)); const d0 = P(1.5, top, 1), d1 = P(5.5, top, B - 1); box3(b, Math.min(d0[0], d1[0]), top, Math.min(d0[2], d1[2]), Math.abs(d1[0] - d0[0]), 2.2, Math.abs(d1[2] - d0[2]));
    return;
  }
  // Afloat: a wheelhouse aft, a mast (and the coaster's hatch covers), a red waterline.
  b.setColor(H(0xc83a2e)); for (let k = 0; k < 2; k++) { const a = P(0, top * 0.45, k * B), c = P(prow, top * 0.45, k * B); box3(b, Math.min(a[0], c[0]) - 0.02, top * 0.42, Math.min(a[2], c[2]) - 0.02, Math.abs(c[0] - a[0]) + 0.04 || 0.04, 0.12, Math.abs(c[2] - a[2]) + 0.04 || 0.04); }
  const h0 = P(0.8, top, B * 0.2), h1 = P(L * (w.coaster ? 0.22 : 0.35), top, B * 0.8);
  b.setColor(H(0xf0ece0)); box3(b, Math.min(h0[0], h1[0]), top, Math.min(h0[2], h1[2]), Math.abs(h1[0] - h0[0]), 2.0, Math.abs(h1[2] - h0[2]));
  b.setColor(H(0x34414a)); box3(b, Math.min(h0[0], h1[0]) - 0.02, top + 1.2, Math.min(h0[2], h1[2]) - 0.02, Math.abs(h1[0] - h0[0]) + 0.04, 0.5, Math.abs(h1[2] - h0[2]) + 0.04);
  if (w.coaster) { b.setColor(H(0x3e5a4a)); for (let s = L * 0.3; s < prow - 2; s += 4.2) { const a = P(s, top, 1), c = P(s + 3.6, top, B - 1); box3(b, Math.min(a[0], c[0]), top, Math.min(a[2], c[2]), Math.abs(c[0] - a[0]), 0.7, Math.abs(c[2] - a[2])); } }
  else { const m = P(L * 0.62, top, B / 2); b.setColor(H(0xe8e4d8)); box3(b, m[0] - 0.08, top, m[2] - 0.08, 0.16, 5, 0.16); b.setColor(H(0x8a8e92)); const g = P(L * 0.62, top + 3.6, 0); const g2 = P(L * 0.62 - 3, top + 1, B / 2); box3(b, Math.min(g[0], g2[0]), top + 1, Math.min(g[2], g2[2]), Math.abs(g2[0] - g[0]) || 0.1, 0.1, Math.abs(g2[2] - g[2]) || 0.1); }
}

// Crane legs: the dock's gantry legs (the girder between each pair is decor), the Freight Quay's level-luffing cranes.
function crane(ctx, w) {
  const { b } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  b.setColor(H(0xd0a030)); box3(b, w.x, 0, w.z, w.w, w.h, w.d);
  b.setColor(H(0x2a2a2a)); for (let y = 2; y < w.h; y += 3) box3(b, w.x - 0.02, y, w.z - 0.02, w.w + 0.04, 0.2, w.d + 0.04);
  b.setColor(H(0x5a5a58)); box3(b, w.x - 0.4, 0, w.z - 0.4, w.w + 0.8, 0.6, w.d + 0.8);
  if (w.quaycrane) {
    b.setColor(H(0x2f6a8a)); box3(b, cx - 1.4, w.h, cz - 1.4, 2.8, 2.2, 2.8);
    b.setColor(H(0xd0a030)); box3(b, cx - 0.2, w.h + 1.2, cz, 0.4, 0.4, 12);
    b.setColor(H(0x2a2a2a)); box3(b, cx - 0.03, w.h - 4, cz + 11.5, 0.06, 5.4, 0.06);
  }
}

function rock(ctx, w) {
  const { b, rnd } = ctx;
  const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
  if (w.gorse) { b.setColor(H(0x4e5a2e)); b.prismY(0, w.h * 0.8, cx, cz, w.w / 2, w.w / 3, 7, rnd()); b.setColor(H(0xd8b030)); for (let k = 0; k < 6; k++) box3(b, w.x + rnd() * w.w * 0.8, w.h * 0.5 + rnd() * 0.4, w.z + rnd() * w.d * 0.8, 0.16, 0.16, 0.16); return; }
  if (w.marram) { b.setColor(H(0x9a9a5a)); for (let k = 0; k < 9; k++) { const a = rnd() * 6.28, r = rnd() * w.w / 2.4, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; b.tri([x - 0.1, 0, z], [x + 0.1, 0, z], [x - 0.5 - rnd() * 0.3, w.h + rnd() * 0.3, z + (rnd() - 0.5) * 0.3]); } b.setColor(H(0xc8b890)); b.prismY(0, 0.25, cx, cz, w.w / 2, w.w / 2.5, 7); return; }
  b.setColor(H(0x6e6c64)); b.prismY(0, w.h * 0.6, cx, cz, w.w / 2, w.w / 2.6, 6, rnd());
  b.setColor(H(0x8a887e)); b.prismY(w.h * 0.6, w.h, cx, cz, w.w / 2.6, w.w / 6, 6, rnd());
}

function sandbag(ctx, w) {
  const { b, rnd } = ctx;
  b.setColor(H(0x8e8c84)); box3(b, w.x, 0, w.z, w.w, w.h, w.d);
  b.setColor(H(0x7a786e)); box3(b, w.x - 0.05, w.h - 0.12, w.z - 0.05, w.w + 0.1, 0.12, w.d + 0.1);
  b.setColor(H(0x6a7a4a)); for (let k = 0; k < 3; k++) box3(b, w.x + rnd() * (w.w - 0.4), w.h, w.z + rnd() * (w.d - 0.4), 0.4, 0.1, 0.4);
}

export const dress = { building, shop, stall, crate, barrier, container, wall: wallPiece, hull, crane, rock, boulder: rock, sandbag };

// ---- Ground: planks, setts, sand ripples, the market's tiles, the dock floor -----------------------------------------

export function zoneColour(zn, x, z, c) {
  const k = zn.kind;
  if (k === 'kwboards') {
    const lx = x - zn.x;
    return Math.floor(lx / 0.4) % 9 === 0 ? scale(c, 0.7) : Math.floor(lx / 0.4) % 3 ? c : scale(c, 1.08);
  }
  if (k === 'kwsetts' || k === 'kwquayside') return (Math.floor(x / 0.9) + Math.floor(z / 0.6)) % 2 ? c : scale(c, 0.92);
  if (k === 'kwmarket' || k === 'kwtiles') return (Math.floor(x / 1.2) + Math.floor(z / 1.2)) % 2 ? c : scale(c, k === 'kwtiles' ? 0.9 : 0.86);
  if (k === 'kwsand') return scale(c, 0.96 + 0.06 * Math.sin(x * 0.9 + Math.sin(z * 0.4) * 2));
  if (k === 'kwdock') return (Math.floor(x / 6) % 2) ? c : scale(c, 0.93);
  if (k === 'kwshingle') return scale(c, 0.88 + 0.2 * (((Math.floor(x * 3.1) * 7 + Math.floor(z * 2.7) * 13) % 10) / 10));
  if (k === 'kwslip') return Math.floor(z / 1.5) % 2 ? c : scale(c, 0.9);
  return c;
}

// ---- Decor per tile: the market hall's frame, the dock's walls, the gantry girders, promenade lamps, beach litter ----

export function decor(ctx, t, TILE) {
  const { b, rnd, full } = ctx;
  const x0 = t.x0, z0 = t.z0, x1 = x0 + TILE, z1 = z0 + TILE;
  const inT = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
  for (const hl of full.halls ?? []) if (inT(hl.x + hl.w / 2, hl.z + hl.d / 2)) hallFrame(ctx, hl);
  for (const dk of full.docks ?? []) if (inT(dk.x + dk.w / 2, dk.z + dk.d / 2)) dockWalls(ctx, dk);
  // Gantry girders: legs that share an x pair up across the dock.
  const legs = (full._gantry ??= full.walls.filter(w => w.gantry));
  for (const a of legs) for (const c of legs) {
    if (c === a || Math.abs(c.x - a.x) > 0.01 || c.z <= a.z || !inT(a.x, (a.z + c.z) / 2)) continue;
    b.setColor(H(0xd0a030)); box3(b, a.x - 0.2, a.h, a.z, a.w + 0.4, 1.4, c.z + c.d - a.z);
    b.setColor(H(0x2f6a8a)); box3(b, a.x - 0.6, a.h + 1.4, (a.z + c.z) / 2 - 1.2, a.w + 1.2, 1.8, 2.4);
    b.setColor(H(0x2a2a2a)); box3(b, a.x + a.w / 2 - 0.03, 2, (a.z + c.z) / 2, 0.06, a.h - 2, 0.06);
  }
  // Pier gates: the arch between each pair of posts.
  const arches = (full._arch ??= full.walls.filter(w => w.pierarch));
  for (const a of arches) for (const c of arches) {
    if (c === a || Math.abs(c.x - a.x) > 0.01 || c.z <= a.z || !inT(a.x, (a.z + c.z) / 2)) continue;
    b.setColor(H(0xf4f0e4)); box3(b, a.x, a.h - 0.2, a.z + a.d, a.w, 0.5, c.z - a.z - a.d);
    b.setColor(H(0x3a7a9a)); box3(b, a.x - 0.05, a.h + 0.3, (a.z + c.z) / 2 - 3, a.w + 0.1, 1.2, 6.5);
    emissive(b, () => { b.setColor([1, 0.92, 0.6]); for (let s = -2.6; s < 3.2; s += 0.65) box3(b, a.x - 0.1, a.h + 1.55, (a.z + c.z) / 2 + s, 0.12, 0.12, 0.12); });
  }
  // Lamp posts along the promenade's edges (the Boardwalk's and the bay's planked roads), with bunting between.
  const proms = [...(full.promenade ?? []), ...(full.roads ?? []).filter(r => r.kind === 'kwboards').map(r => ({ x: r.pts[0][0], z: r.pts[0][1] - r.w / 2, w: r.pts[1][0] - r.pts[0][0], d: r.w }))];
  for (const p of proms) {
    for (const ez of [p.z + 0.4, p.z + p.d - 0.4]) for (let x = Math.ceil((p.x + 4) / 12) * 12; x < p.x + p.w - 2; x += 12) {
      if (!inT(x, ez) || ctx.blocked(x, ez, 0.4)) continue;
      b.setColor(H(0x2e4a3a)); b.prismY(0, 3.4, x, ez, 0.08, 0.06, 6);
      b.setColor(H(0xf4f0e4)); b.prismY(3.4, 3.8, x, ez, 0.2, 0.12, 6);
      if (ctx.blocked(x + 12, ez, 0.4)) continue;
      for (let s = 0; s < 12; s += 0.8) { const sag = 0.6 * Math.sin((s / 12) * Math.PI); b.setColor(H(BRIGHT[Math.floor(s / 0.8) % BRIGHT.length])); b.tri([x + s, 3.3 - sag, ez], [x + s + 0.5, 3.3 - sag, ez], [x + s + 0.25, 2.95 - sag, ez]); }
    }
  }
  // Shells, weed and grit on the open ground.
  for (let k = 0; k < 14; k++) {
    const x = x0 + rnd() * TILE, z = z0 + rnd() * TILE;
    if (x < 1 || z < 1 || x > ctx.W - 1 || z > ctx.H - 1 || ctx.wet(x, z) || ctx.blocked(x, z, 0.3)) continue;
    b.setColor(rnd() < 0.5 ? scale(H(0xe8e2d2), 0.8 + rnd() * 0.2) : scale(H(0x4a5a34), 0.8 + rnd() * 0.3));
    b.prismY(0, 0.06 + rnd() * 0.08, x, z, 0.1 + rnd() * 0.18, 0.05, 5, rnd());
  }
}

// The market hall: iron girders on the columns, a glazed ridge, high over the floor (nobody under it is hidden).
function hallFrame(ctx, hl) {
  const { b } = ctx;
  const y = 4.2;
  b.setColor(H(0x2e5a4a));
  for (const zz of [hl.z, hl.z + hl.d - 0.3]) box3(b, hl.x, y, zz, hl.w + 0.6, 0.3, 0.3);
  for (const xx of [hl.x, hl.x + hl.w - 0.3]) box3(b, xx, y, hl.z, 0.3, 0.3, hl.d + 0.6);
  for (let x = hl.x + 5.8; x < hl.x + hl.w; x += 5.8) {
    box3(b, x, y, hl.z, 0.18, 0.18, hl.d + 0.6);
    b.quad([x, y, hl.z], [x + 0.18, y, hl.z], [x + 0.18, y + 2.2, hl.z + hl.d / 2], [x, y + 2.2, hl.z + hl.d / 2], [x, -5, hl.z]);
    b.quad([x, y + 2.2, hl.z + hl.d / 2], [x + 0.18, y + 2.2, hl.z + hl.d / 2], [x + 0.18, y, hl.z + hl.d + 0.3], [x, y, hl.z + hl.d + 0.3], [x, -5, hl.z + hl.d]);
  }
  b.setColor(H(0xc8dce4)); box3(b, hl.x, y + 2.2, hl.z + hl.d / 2 - 0.6, hl.w + 0.6, 0.12, 1.2);
  b.setColor(H(0xf4f0e4)); box3(b, hl.x + hl.w / 2 - 0.6, y + 0.4, hl.z - 0.1, 1.2, 1.2, 0.1);     // The clock.
  b.setColor(H(0x2a2a2a)); box3(b, hl.x + hl.w / 2 - 0.04, y + 0.6, hl.z - 0.14, 0.08, 0.5, 0.04);
}

// The dry dock's walls: the drop from the rim to the dock floor, stepped, with stairs at the gaps in the rim.
function dockWalls(ctx, dk) {
  const { b } = ctx;
  b.setColor(H(0x4e5052));
  box3(b, dk.x, -0.6, dk.z, dk.w, 0.6, 0.3); box3(b, dk.x, -0.6, dk.z + dk.d - 0.3, dk.w, 0.6, 0.3);
  b.setColor(H(0x3e4042));
  for (let x = dk.x + 2; x < dk.x + dk.w - 2; x += 4) { box3(b, x, 0.02, dk.z + dk.d / 2 - 3.6, 1.2, 0.3, 0.8); box3(b, x, 0.02, dk.z + dk.d / 2 + 2.8, 1.2, 0.3, 0.8); }
  b.setColor(H(0x8a6a44));
  for (let x = dk.x + 1.5; x < dk.x + dk.w - 1.5; x += 3) box3(b, x, 0.02, dk.z + dk.d / 2 - 0.6, 1.4, 0.4, 1.2);   // Keel blocks.
}

// ---- The edge of the bay on land: dry-stone walls and heath past it; open sea needs nothing -------------------------

export function edge(ctx, w) {
  if (w.open) return;
  const { b, rnd } = ctx;
  const long = w.w > w.d, out = long ? (w.z < 0 ? -1 : 1) : (w.x < 0 ? -1 : 1);
  const L = long ? w.w : w.d;
  b.setColor(H(0x7e7c72));
  if (long) box3(b, w.x, 0, w.z, w.w, 1.1, w.d); else box3(b, w.x, 0, w.z, w.w, 1.1, w.d);
  b.setColor(H(0x9a988e)); if (long) box3(b, w.x, 1.1, w.z + 0.2, w.w, 0.15, w.d - 0.4); else box3(b, w.x + 0.2, 1.1, w.z, w.w - 0.4, 0.15, w.d);
  for (let s = 1; s < L - 1; s += 3 + rnd() * 4) {
    const off = 3 + rnd() * 14, x = long ? w.x + s : out < 0 ? w.x - off : w.x + w.w + off, z = long ? (out < 0 ? w.z - off : w.z + w.d + off) : w.z + s;
    b.setColor(rnd() < 0.5 ? H(0x4e5a2e) : H(0x6a5a4a)); b.prismY(0, 0.6 + rnd() * 1.1, x, z, 0.8 + rnd() * 1.2, 0.3, 6, rnd());
  }
  void mix;
}

// Region lights: none to speak of in daylight (the lighthouse and the arcades bring their own).
export function lights() {}
