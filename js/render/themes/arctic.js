// Arctic region (Frostline, Icebreaker): polar blue hour. The sun sits just under the southern horizon, so
// camera-facing faces catch a pink alpenglow while the snow goes blue in shadow, and an aurora hangs over the north.
// Frostline keeps its rail-depot dressing from world.js (passed in as `frost`) and gains the new sky and snowfield;
// Icebreaker's station, ship and pack ice are drawn here. Exported as { dress, stage, thumb }; registers its palette.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, mix, blockedAt, mass, skyRing, rimPoints, waterBanks, WATER_Y } from './kit.js';

const norm = v => { const l = Math.hypot(...v); return v.map(c => c / l); };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));

THEMES.arctic = {
  id: 'arctic',
  light: { dir: norm([0.32, 0.5, 0.8]), sun: [0.72, 0.5, 0.52], sky: [0.38, 0.46, 0.64], amb: [0.25, 0.29, 0.4] },
  clear: 0x0c1424,
  fog: [0.36, 0.44, 0.62], fogSeam: [0.1, 0.14, 0.26], desatTint: [0.8, 0.86, 0.98],
  shadow: { col: [0.42, 0.5, 0.74], strength: 0.5, len: 0.7 },
  lamp: [0.5, 0.32, 0.12],
  groundAmp: 0.22,
  water: { deep: [0.01, 0.03, 0.06], shallow: [0.04, 0.08, 0.13], glint: [0.6, 0.75, 0.9] },
  ink: ink({
    // Frostline's keys first: its rail-depot drawers in world.js read them.
    ground: 0xc4cedd, asphalt: 0x4c4f58, dirt: 0x8c97ab, gravel: 0x585d6b,
    roof: 0xc6d0de, wall: 0x7a5a50, wallB: 0x56606c, trim: 0x2c2e36,
    concrete: 0x8a909a, crate: 0x8a6e4c, crateD: 0x4e3e2c,
    rail: 0x9aa4b2, tie: 0x3b3431, hazardY: 0xb8962f, hazardK: 0x22252c,
    paint: 0xc0c6cc, glow: 0xffbe6c, glowCool: 0xc8e0ff,
    snow: 0xdde5f0, snowD: 0xaab8cc, ice: 0x8cc0dc, iceD: 0x5a8cb0, iceL: 0xbfe0f0, coal: 0x2a2a2e, timber: 0x4a3a2e,
    station: 0xb8452e, stationD: 0x8a3424, white: 0xd8dde4, steel: 0x6a7480, steelD: 0x3c434c,
    hull: 0x8a2a24, hullD: 0x241e22, deck: 0x6a6a5e, yellow: 0xd8a830, glass: 0x24344a, tyre: 0x1e2024,
    green: 0x3a5a4a,
  }),
  containers: [0x7a3a2e, 0x3e566a, 0x5f524a, 0x6a6236, 0x34503f],
  weather: { fields: [
    { kind: 'mote', count: 170, box: [40, 12, 32], vel: [1.2, -1.6, 0.4], size: 0.1, col: [0.94, 0.97, 1.0], alpha: 0.7 },
    { kind: 'streak', count: 90, box: [38, 1.2, 30], vel: [6.5, 0, 1.4], len: 1.6, width: 0.03, col: [0.9, 0.95, 1.0], alpha: 0.18 },
    { kind: 'mote', count: 40, box: [36, 4, 28], vel: [0.2, -0.1, 0.1], size: 0.05, col: [1.0, 0.92, 0.95], alpha: 0.9 },
    { kind: 'mote', count: 16, box: [44, 3, 34], vel: [2.6, 0.02, 0.5], size: 3.6, col: [0.8, 0.88, 1.0], alpha: 0.05 },
  ] },
};

let K = null;
const isDepot = ctx => ctx.tracks.length > 0;     // Frostline: its wagons lay tracks.

// ---- Station --------------------------------------------------------------------------------------------------

function snowTop(b, x, y, z, w, d) {
  b.setColor(K.snow);
  box3(b, x + 0.05, y, z + 0.05, w - 0.1, 0.12, d - 0.1, 0.04);
}

// A station module: a red box on stilts, white roof under snow, a band of lit windows, a door with steps.
function moduleBox(ctx, w) {
  const { b, glow, lamps } = ctx;
  const { x, z, w: mw, d: md, h } = w;
  const lift = 0.7;
  b.setColor(K.steelD);
  for (let u = 0.2; u < mw - 0.1; u += Math.max(1.5, (mw - 0.4) / Math.ceil((mw - 0.4) / 2.2))) {
    box3(b, x + u, 0, z + 0.2, 0.18, lift, 0.18); box3(b, x + u, 0, z + md - 0.38, 0.18, lift, 0.18);
  }
  b.setColor(K.station);
  box3(b, x, lift, z, mw, h - lift - 0.35, md);
  b.setColor(K.stationD);
  box3(b, x - 0.02, lift, z - 0.02, mw + 0.04, 0.25, md + 0.04);
  b.setColor(K.white);
  box3(b, x - 0.1, h - 0.35, z - 0.1, mw + 0.2, 0.25, md + 0.2);
  snowTop(b, x - 0.1, h - 0.1, z - 0.1, mw + 0.2, md + 0.2);
  const long = mw >= md, L = long ? mw : md;
  emissive(b, () => {
    b.setColor([1.0, 0.86, 0.58]);
    for (let u = 0.7; u < L - 0.8; u += 1.3) {
      if (long) box3(b, x + u, lift + 1.0, z + md + 0.01, 0.7, 0.5, 0.03); else box3(b, x + mw + 0.01, lift + 1.0, z + u, 0.03, 0.5, 0.7);
    }
  });
  for (let u = 1; u < L - 0.8; u += 2.6) {
    if (long) { lamps.push({ x: x + u, z: z + md + 1.4, r: 3, col: [0.3, 0.22, 0.1] }); glow.streak(x + u + 0.35, z + md + 0.1, 0.9, 2.2, [0.08, 0.06, 0.03], 0.1); }
    else lamps.push({ x: x + mw + 1.4, z: z + u, r: 3, col: [0.3, 0.22, 0.1] });
  }
  b.setColor(K.steelD);
  box3(b, x + mw * 0.15, lift, z + md + 0.02, 0.8, 1.7, 0.04);
  b.setColor(K.steel);
  box3(b, x + mw * 0.15 - 0.1, 0, z + md - 0.02, 1.0, 0.12, 0.02);
}

function tank(ctx, w) {
  const { b } = ctx;
  const { x, z, w: tw, d: td, h } = w;
  const cx = x + tw / 2, cz = z + td / 2, r = Math.min(tw, td) / 2 - 0.05;
  b.setColor(K.white);
  b.prismY(0, h - 0.4, cx, cz, r, r, 12, 0.1);
  b.setColor(K.steel);
  for (const y of [0.6, h * 0.5]) b.prismY(y, y + 0.1, cx, cz, r + 0.03, r + 0.03, 12, 0.1);
  b.setColor(K.snow);
  b.prismY(h - 0.4, h, cx, cz, r, r * 0.4, 12, 0.1);
  b.setColor(K.yellow);
  box3(b, cx - 0.4, 1.1, z + td - 0.08, 0.8, 0.3, 0.06);
}

// Radar dome on a square plinth.
function dome(ctx, w) {
  const { b } = ctx;
  const { x, z, w: dw, d: dd, h } = w;
  const cx = x + dw / 2, cz = z + dd / 2, r = Math.min(dw, dd) / 2 - 0.05, base = 1.2;
  b.setColor(K.steelD);
  box3(b, x + 0.3, 0, z + 0.3, dw - 0.6, base, dd - 0.6);
  const rings = 5;
  for (let i = 0; i < rings; i++) {
    const a0 = (i / rings) * Math.PI / 2, a1 = ((i + 1) / rings) * Math.PI / 2;
    b.setColor(i % 2 ? K.white : scale(K.white, 0.92));
    b.prismY(base + Math.sin(a0) * (h - base), base + Math.sin(a1) * (h - base), cx, cz, r * Math.cos(a0), Math.max(0.05, r * Math.cos(a1)), 10, i * 0.3);
  }
  emissive(b, () => { b.setColor([1, 0.2, 0.15]); box3(b, cx - 0.08, h, cz - 0.08, 0.16, 0.16, 0.16); });
}

// Snowcat: tracks, a cab, a cargo sled frame behind.
function snowcat(ctx, w) {
  const { b } = ctx;
  const { x, z, w: sw, d: sd, h } = w;
  const long = sw >= sd, L = long ? sw : sd, T = long ? sd : sw;
  const box = (u, y, v, lu, hy, lv) => long ? box3(b, x + u, y, z + v, lu, hy, lv) : box3(b, x + v, y, z + u, lv, hy, lu);
  b.setColor(K.tyre);
  box(0.1, 0, 0, L - 0.2, 0.7, T * 0.28); box(0.1, 0, T * 0.72, L - 0.2, 0.7, T * 0.28);
  b.setColor(0xd86a1e);
  box(L * 0.45, 0.55, 0.15, L * 0.5, h - 0.75, T - 0.3);
  b.setColor(K.glass);
  box(L * 0.92, 1.3, 0.25, 0.06, 0.5, T - 0.5);
  b.setColor(K.steel);
  box(0.15, 0.55, 0.2, L * 0.4, 0.4, T - 0.4);
  b.setColor(0xb85a18);
  box(L * 0.45, h - 0.2, 0.15, L * 0.5, 0.08, T - 0.3);
  b.setColor(K.snow);
  box(0.15, 0.95, 0.25, L * 0.38, 0.1, T - 0.5);
}

// A shipping box: corrugated faces, snow on top.
function box(ctx, w) {
  const { b, rnd } = ctx;
  const { x, z, w: cw, d: cd, h } = w;
  const base = hexRGB(ctx.theme.containers[Math.floor(rnd() * ctx.theme.containers.length)]);
  b.setColor(base);
  box3(b, x, 0, z, cw, h, cd);
  b.setColor(scale(base, 0.75));
  const long = cw >= cd;
  for (let u = 0.25; u < (long ? cw : cd) - 0.1; u += 0.4) {
    if (long) box3(b, x + u, 0.1, z + cd, 0.1, h - 0.2, 0.04); else box3(b, x + cw, 0.1, z + u, 0.04, h - 0.2, 0.1);
  }
  snowTop(b, x, h, z, cw, cd);
}

// ---- Ice --------------------------------------------------------------------------------------------------------

// An upended floe: sharp slabs leaning together, glassy blue faces, snow on the tops.
function iceBlock(ctx, w) {
  const { b, rnd } = ctx;
  mass(ctx, w.x, w.z, w.w, w.d, w.h, { cols: [K.iceL, K.ice, K.iceD], cap: K.snow, levels: 3, taper: 0.4, jit: 0.3, sides: 5 + Math.floor(rnd() * 3) });
}

// Pressure ridge: a line of broken ice rubble, waist high.
function ridge(ctx, w) {
  const { b, rnd } = ctx;
  const long = w.w >= w.d, L = long ? w.w : w.d, T = long ? w.d : w.w;
  b.setColor(K.snowD);
  box3(b, w.x + 0.05, 0, w.z + 0.05, w.w - 0.1, w.h * 0.4, w.d - 0.1);
  for (let s = 0.3; s < L - 0.1; s += 0.55) {
    const cx = long ? w.x + s : w.x + T / 2, cz = long ? w.z + T / 2 : w.z + s, top = w.h * (0.7 + rnd() * 0.3);
    b.setColor(rnd() < 0.5 ? K.iceL : K.ice);
    b.prismY(0, top, cx, cz, Math.min(T * 0.5, 0.45), 0.06, 4, rnd() * 3);
  }
}

function lead(ctx, w) {
  waterBanks(ctx, w, { face: K.iceD, lip: K.snow, lip2: K.iceL, t: 0.45 });
  const { b, rnd } = ctx;
  // Floating brash ice on the black water.
  for (let i = 0; i < w.w * w.d / 3; i++) {
    b.setColor(rnd() < 0.5 ? K.iceL : K.snowD);
    b.prismY(WATER_Y - 0.02, WATER_Y + 0.05, w.x + 0.3 + rnd() * (w.w - 0.6), w.z + 0.3 + rnd() * (w.d - 0.6), 0.15 + rnd() * 0.3, 0.12, 5, rnd() * 3);
  }
}

// ---- The ship -----------------------------------------------------------------------------------------------------

// Hull plating: red below the snowline, a black boot-top, white bulwark with a rail. The two end pieces are stern (west)
// and bow (east, pointed inside its footprint).
function hullPlate(ctx, w) {
  const { b, glow } = ctx;
  const { x, z, w: hw, d: hd, h } = w;
  if (w.end) {
    const bow = w.bow < 0;
    const cz = z + hd / 2;
    // Pointed (bow) or squared-off (stern) end, lofted from the deck-side edge to the tip.
    const inner = bow ? x : x + hw, outer = bow ? x + hw : x;
    const tip = bow ? 0.12 : 0.8;
    b.setColor(K.hull);
    b.loft([
      [[inner, 0, z], [inner, 0, z + hd], [outer, 0, cz + hd * tip / 2], [outer, 0, cz - hd * tip / 2]],
      [[inner, h - 1, z], [inner, h - 1, z + hd], [outer, h - 1, cz + hd * tip / 2], [outer, h - 1, cz - hd * tip / 2]],
    ]);
    b.setColor(K.white);
    b.loft([
      [[inner, h - 1, z], [inner, h - 1, z + hd], [outer, h - 1, cz + hd * tip / 2], [outer, h - 1, cz - hd * tip / 2]],
      [[inner, h, z], [inner, h, z + hd], [outer, h, cz + hd * tip / 2], [outer, h, cz - hd * tip / 2]],
    ]);
    b.setColor(K.deck);
    b.tri([inner, h + 0.01, z + 0.3], [inner, h + 0.01, z + hd - 0.3], [bow ? outer - 0.3 : outer + 0.3, h + 0.01, cz], [inner, 0, cz]);
    if (!bow) {
      // Helideck circle on the stern.
      emissive(b, () => { b.setColor([0.85, 0.75, 0.3]); b.prismY(h + 0.02, h + 0.04, x + hw * 0.45, cz, 0.9, 0.9, 10); });
    } else emissive(b, () => { b.setColor([0.3, 1, 0.4]); box3(b, x + hw - 0.5, h + 0.1, cz - 0.1, 0.2, 0.2, 0.2); });
    return;
  }
  b.setColor(K.hullD);
  box3(b, x, 0, z, hw, 0.6, hd);
  b.setColor(K.hull);
  box3(b, x, 0.6, z, hw, h - 1.6, hd);
  b.setColor(K.white);
  box3(b, x, h - 1, z, hw, 1, hd);
  b.setColor(K.steel);
  box3(b, x - 0.02, h, z + hd / 2 - 0.03, hw + 0.04, 0.06, 0.06);
  // Ice crushed up against the hull.
  b.setColor(K.iceL);
  const out = z < ctx.map.height / 2 ? -1 : 1;
  for (let u = 0.3; u < hw; u += 0.9) b.prismY(0, 0.4 + ctx.rnd() * 0.5, x + u, out < 0 ? z - 0.15 : z + hd + 0.15, 0.3, 0.05, 4, ctx.rnd() * 3);
  emissive(b, () => { b.setColor([1.0, 0.85, 0.5]); for (let u = 0.6; u < hw - 0.4; u += 1.6) box3(b, x + u, h - 0.7, out < 0 ? z - 0.02 : z + hd + 0.01, 0.25, 0.25, 0.02); });
  glow.streak(x + hw / 2, z + hd + 0.1, 0.6, out > 0 ? 1.2 : -1.2, [0.04, 0.035, 0.02], 0.1);
}

// Deckhouse: white superstructure, bridge windows lit, and a funnel with a red band on the aft one.
function deckhouse(ctx, w) {
  const { b, glow, lamps, map } = ctx;
  const { x, z, w: dw, d: dd, h } = w;
  const aft = x + dw / 2 < map.width / 2;
  b.setColor(K.white);
  box3(b, x, 0, z, dw, h - 1.6, dd);
  b.setColor(scale(K.white, 0.9));
  box3(b, x + 0.3, h - 1.6, z + 0.3, dw - 0.6, 1.3, dd - 0.6);
  emissive(b, () => {
    b.setColor([1.0, 0.88, 0.6]);
    box3(b, x + 0.5, h - 1.25, z + dd - 0.31, dw - 1, 0.5, 0.03);
    box3(b, x + 0.5, 1.2, z + dd + 0.01, dw - 1, 0.4, 0.03);
  });
  lamps.push({ x: x + dw / 2, z: z + dd + 1.2, r: 3.5, col: [0.3, 0.22, 0.12] });
  b.setColor(K.steelD);
  box3(b, x + 0.2, h - 0.3, z + 0.2, dw - 0.4, 0.12, dd - 0.4);
  snowTop(b, x + 0.3, h - 0.18, z + 0.3, dw - 0.6, dd - 0.6);
  if (aft) {
    const fx = x + dw * 0.45, fz = z + dd / 2;
    b.setColor(K.white); b.prismY(h - 0.3, h + 2.0, fx, fz, 0.8, 0.7, 8);
    b.setColor(K.hull); b.prismY(h + 1.0, h + 1.5, fx, fz, 0.76, 0.74, 8);
    b.setColor(K.hullD); b.prismY(h + 2.0, h + 2.2, fx, fz, 0.7, 0.6, 8);
  } else {
    b.setColor(K.steel);
    b.prismY(h - 0.3, h + 3.2, x + dw / 2, z + dd / 2, 0.08, 0.06, 4);
    box3(b, x + dw / 2 - 0.8, h + 2.2, z + dd / 2 - 0.05, 1.6, 0.08, 0.1);
    emissive(b, () => { b.setColor([1, 1, 0.9]); box3(b, x + dw / 2 - 0.08, h + 3.2, z + dd / 2 - 0.08, 0.16, 0.16, 0.16); });
  }
}

function hatch(ctx, w) {
  const { b } = ctx;
  b.setColor(K.green);
  box3(b, w.x, 0, w.z, w.w, w.h, w.d);
  b.setColor(scale(K.green, 0.75));
  for (let u = 0.3; u < w.w; u += 0.6) box3(b, w.x + u, w.h, w.z + 0.05, 0.08, 0.04, w.d - 0.1);
  snowTop(b, w.x + w.w * 0.5, w.h, w.z, w.w * 0.5, w.d);
}

// The pack-ice wall at the edge of Icebreaker's field: pressure ice heaped up, white and blue.
function iceBorder(ctx, w) {
  const { rnd } = ctx;
  const long = w.w > w.d, L = long ? w.w : w.d;
  for (let s = 0; s < L;) {
    const e = Math.min(L, s + 2.5 + rnd() * 3), hh = w.h + (rnd() - 0.4) * 1.4;
    if (long) mass(ctx, w.x + s, w.z, e - s, w.d, hh, { cols: [K.ice, K.iceL, K.snowD], cap: K.snow, levels: 2, taper: 0.35, jit: 0.3, sides: 5 });
    else mass(ctx, w.x, w.z + s, w.w, e - s, hh, { cols: [K.ice, K.iceL, K.snowD], cap: K.snow, levels: 2, taper: 0.35, jit: 0.3, sides: 5 });
    s = e;
  }
}

// ---- Ground, paint, lights, decor ---------------------------------------------------------------------------------

function ground(ctx) {
  const { map, noise, rnd, W, H } = ctx;
  const laneDist = z => { let d = 99; for (const l of map.lanes) d = Math.min(d, Math.abs(z - l.z)); return d; };
  const tracks = ctx.tracks;
  return p => {
    const [x, , z] = p;
    if (x < 0 || z < 0 || x > W || z > H) return scale(K.snow, 0.82 + noise(x * 0.15, z * 0.15) * 0.16);
    if (tracks.length) {
      let dT = 99;
      for (const tx of tracks) dT = Math.min(dT, Math.abs(x - tx));
      if (dT < 1.6) return scale(K.gravel, 0.84 + noise(x * 1.3, z * 1.3) * 0.26 + (rnd() - 0.5) * 0.06);
    }
    // Wind-scoured blue ice in patches, sastrugi ripples, ploughed tracks along the lanes.
    const scour = noise(x * 0.09 + 3, z * 0.09) > 0.64;
    const ploughed = laneDist(z) < 1.4 && noise(x * 0.2, z * 0.2) > 0.4;
    const rip = Math.sin((x * 0.8 + z * 0.3) + noise(x * 0.3, z * 0.3) * 5) * 0.03;
    const base = scour ? mix(K.ice, K.snow, 0.35) : ploughed ? K.dirt : K.ground;
    ctx.groundWet = scour ? 0.6 : 0;
    return scale(base, 0.93 + noise(x * 0.6, z * 0.6) * 0.1 + rip + (rnd() - 0.5) * 0.03);
  };
}

function stationLights(ctx) {
  const { lamps, glow, W, H } = ctx;
  const sodium = [1.0, 0.62, 0.26];
  // Floodlight masts at the station corners, just inside the border.
  ctx.masts = [];
  for (const [x, z] of [[1.2, 1.2], [1.2, H - 1.2], [W * 0.36, 1.2], [W * 0.36, H - 1.2]]) {
    for (const [mx, mz] of [[x, z], [W - x, H - z]]) {
      ctx.masts.push([mx, mz]);
      lamps.push({ x: mx, z: mz, r: 10, col: [0.4, 0.26, 0.1] });
      glow.halo(mx, mz, 7, scale(sodium, 0.12));
    }
  }
}

function snowPaint(ctx) {
  const { b, map, rnd, W, H } = ctx;
  // Drifts banked against the windward (west) faces.
  for (const w of map.walls) {
    if (!w.blocksMove || w.kind === 'border' || w.kind === 'water') continue;
    b.setColor(scale(K.snow, 0.95));
    for (let z = w.z; z < w.z + w.d; z += 0.9) if (rnd() < 0.8) b.groundRect(w.x - 0.6 - rnd() * 0.3, z, 0.6, 0.8, 0.05);
  }
  // Cracks in the sea ice.
  b.setColor(scale(K.iceD, 0.8));
  for (let i = 0; i < Math.round(W * H / 220); i++) {
    let x = rnd() * W, z = rnd() * H, a = rnd() * 6.28;
    for (let s = 0; s < 8; s++) {
      const nx = x + Math.cos(a) * 0.9, nz = z + Math.sin(a) * 0.9;
      if (!blockedAt(map, nx, nz, 0.1)) b.quad([x, 0.04, z], [nx, 0.04, nz], [nx + Math.sin(a) * 0.05, 0.04, nz - Math.cos(a) * 0.05], [x + Math.sin(a) * 0.07, 0.04, z - Math.cos(a) * 0.07]);
      x = nx; z = nz; a += (rnd() - 0.5) * 1.1;
    }
  }
  // Snowcat ruts out of the stations along the lanes.
  b.setColor(scale(K.snowD, 0.9));
  for (const lane of map.lanes) {
    for (let x = 1; x < W - 1; x += 0.8) {
      const zc = lane.z - 0.9 + Math.sin(x * 0.07) * 0.8;
      if (blockedAt(map, x, zc) || rnd() < 0.12) continue;
      b.groundRect(x, zc - 0.12, 0.7, 0.24, 0.04);
      b.groundRect(x, zc + 1.6, 0.7, 0.24, 0.04);
    }
  }
  // The ship's deck: plates and the well deck's walkways.
  for (const r of map.rooms || []) {
    if (r.floor !== 'deck') continue;
    b.setColor(K.deck);
    box3(b, r.x + 2.8, 0.01, r.z + 0.8, r.w - 5.6, 0.05, r.d - 1.6);
    b.setColor(scale(K.deck, 1.15));
    for (let x = r.x + 3; x < r.x + r.w - 3; x += 1.2) box3(b, x, 0.06, r.z + 0.9, 0.04, 0.01, r.d - 1.8);
    b.setColor(K.yellow);
    box3(b, r.x + 3, 0.06, r.z + r.d / 2 - 0.05, r.w - 6, 0.01, 0.1);
  }
}

// Aurora: ribbons of additive green and violet curtains over the northern horizon.
function aurora(ctx) {
  const { glow, W, H } = ctx;
  for (let k = 0; k < 3; k++) {
    const z0 = -34 - k * 9, y0 = 16 + k * 5, y1 = y0 + 14 + k * 3;
    const N = 26;
    for (let i = 0; i < N; i++) {
      const x0 = -40 + (i / N) * (W + 80), x1 = -40 + ((i + 1) / N) * (W + 80);
      const w0 = Math.sin(i * 0.55 + k * 2) * 6, w1 = Math.sin((i + 1) * 0.55 + k * 2) * 6;
      const f0 = 0.5 + 0.5 * Math.sin(i * 0.9 + k), f1 = 0.5 + 0.5 * Math.sin((i + 1) * 0.9 + k);
      const g = [0.05, 0.22, 0.13], v = [0.1, 0.04, 0.16], z = [0, 0, 0];
      glow.quad([x0, y0, z0 + w0], [x0, y1, z0 + w0 - 6], [x1, y1, z0 + w1 - 6], [x1, y0, z0 + w1], scale(g, f0), scale(v, f0 * 0.6), scale(v, f1 * 0.6), scale(g, f1));
      glow.quad([x0, y0 - 3, z0 + w0 + 2], [x0, y0, z0 + w0], [x1, y0, z0 + w1], [x1, y0 - 3, z0 + w1 + 2], z, scale(g, f0 * 0.8), scale(g, f1 * 0.8), z);
    }
  }
}

function polarDecor(ctx) {
  const { b, rnd, W, H } = ctx;
  for (const [x, z] of ctx.masts || []) {
    b.setColor(K.steelD);
    b.prismY(0, 7, x, z, 0.12, 0.09, 6);
    box3(b, x - 0.7, 6.9, z - 0.2, 1.4, 0.14, 0.4);
    emissive(b, () => { b.setColor([1.0, 0.75, 0.42]); box3(b, x - 0.6, 6.8, z - 0.15, 1.2, 0.06, 0.3); });
  }
  // Icebergs and pressure ice out on the frozen sea.
  for (const [x, z] of rimPoints(ctx, 40, 4, 26)) {
    const s = 3 + rnd() * 6;
    mass(ctx, x, z, s, s * (0.6 + rnd() * 0.5), 1.5 + rnd() * (s > 6 ? 6 : 2.5), { cols: [K.iceL, K.ice, K.snowD], cap: K.snow, levels: 3, taper: 0.38, jit: 0.3, sides: 6 });
  }
}

export default {
  // `frost` is world.js's rail-depot set for Frostline (wagons, depot buildings and walls).
  dress: (frost) => ({
    ...frost,
    building: (ctx, w) => { K = ctx.theme.ink; return w.module ? moduleBox(ctx, w) : w.tank ? tank(ctx, w) : w.dome ? dome(ctx, w) : w.deckhouse ? deckhouse(ctx, w) : frost.building(ctx, w); },
    container: (ctx, w) => w.snowcat ? snowcat(ctx, w) : w.box ? box(ctx, w) : frost.container(ctx, w),
    rock: (ctx, w) => iceBlock(ctx, w),
    sandbag: (ctx, w) => w.ridge ? ridge(ctx, w) : frost.sandbag(ctx, w),
    crate: (ctx, w) => w.hatch ? hatch(ctx, w) : frost.crate(ctx, w),
    hull: hullPlate,
    water: lead,
    border: (ctx, w) => isDepot(ctx) ? frost.border(ctx, w) : iceBorder(ctx, w),
  }),
  // `frost` is world.js's stage set for Frostline's yard lights, rails and freight-train backdrop.
  stage: (frost) => ({
    lights: (ctx) => { K = ctx.theme.ink; return isDepot(ctx) ? frost.lights(ctx) : stationLights(ctx); },
    ground: (ctx) => { K = ctx.theme.ink; return ground(ctx); },
    paint: (ctx) => isDepot(ctx) ? frost.paint(ctx) : snowPaint(ctx),
    decor: (ctx) => {
      if (isDepot(ctx)) frost.decor(ctx);
      else {
        polarDecor(ctx);
        skyRing(ctx, { low: [0.06, 0.09, 0.16], mid: [0.16, 0.22, 0.36], warm: [0.5, 0.32, 0.4], high: [0.03, 0.05, 0.12], warmDir: [0.2, 1], y0: -6, y1: 8, y2: 50 });
      }
      aurora(ctx);
    },
  }),
  thumb: { ground: '#c4cedd', solid: '#56606e', low: '#9ab8d0', water: '#0c1626', edge: '#151b26', hull: '#8a2a24' },
};
