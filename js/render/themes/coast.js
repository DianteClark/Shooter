// Coast region: the shared shore pieces (sea, beach, palms, the lighthouse) and Pier's theme. world.js reads `pier`
// ({ dress, stage, thumb }) into its tables and hands every drawer ctx.kit (box3, emissive, scale and the shared
// railyard drawers), because this module cannot import world.js back.
import { THEMES, hexRGB } from '../art.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));

// Pier: a fishing pier on a grey, windy morning. Flat cool light from the north-west, salt haze, spray off the sea.
// Boats and boathouses wear faded paint (blue, oxblood, white) kept dull, so nothing reads as a team colour.
THEMES.pier = {
  id: 'pier',
  light: { dir: norm([-0.4, 0.78, 0.48]), sun: [0.62, 0.62, 0.6], sky: [0.38, 0.43, 0.5], amb: [0.29, 0.31, 0.35] },
  clear: 0x18202a,
  fog: [0.46, 0.52, 0.58], fogSeam: [0.1, 0.13, 0.16], desatTint: [0.82, 0.86, 0.9],
  shadow: { col: [0.36, 0.42, 0.52], strength: 0.5, len: 0.7 },
  lamp: [0.3, 0.22, 0.1],
  wet: 0.5, sheen: norm([0.1, 0.9, -0.4]), sheenCol: [0.4, 0.48, 0.56],
  water: { deep: [0.05, 0.1, 0.12], shallow: [0.12, 0.2, 0.22], glint: [0.62, 0.72, 0.78] },
  ink: ink({
    ground: 0x6c6f6e, asphalt: 0x5c605f, dirt: 0x5a554c, gravel: 0x777770,
    roof: 0x4a4e56, wall: 0x6a7c88, wallB: 0x8a6a5c, trim: 0x2e3236,
    concrete: 0x84837c, crate: 0x8a7656, crateD: 0x54462f,
    rail: 0x8a929a, tie: 0x3c342c, hazardY: 0xb08c34, hazardK: 0x24282c,
    paint: 0xc8c4b4, glow: 0xffd49a, glowCool: 0xd4e4f2,
    plank: 0x7c6a52, plankD: 0x5a4c3a, plankL: 0x91806a, pile: 0x3c362e, stone: 0x7a7a74, stoneD: 0x5e5e58,
    blue: 0x3f6a84, red: 0x8a3e34, white: 0xc4c2b8, green: 0x3e6650, net: 0x3c544a, buoy: 0xc8622c, rope: 0xa89470,
    sand: 0x9c9078, sandD: 0x857a64, steel: 0x7a828a, tar: 0x2a2a2c,
  }),
  containers: [0x3f6a84, 0x8a3e34, 0xa88a46, 0x4a6a5a],
  weather: { fields: [
    { kind: 'streak', count: 70, box: [36, 3, 26], vel: [7, 0.05, 2.2], len: 1.6, width: 0.016, col: [0.85, 0.92, 1.0], alpha: 0.16 },
    { kind: 'mote', count: 60, box: [36, 5, 26], vel: [2.2, 0.15, 0.7], size: 0.08, col: [0.9, 0.95, 1.0], alpha: 0.45 },
    { kind: 'mote', count: 18, box: [44, 2.5, 32], vel: [1.2, 0.02, 0.4], size: 4, col: [0.78, 0.84, 0.9], alpha: 0.06 },
  ] },
};

// ---- Shared shore pieces -----------------------------------------------------------------------------------------

// Open sea off one side of the map: a dark plane out to the horizon, a surf line where it meets the land and, if
// `beach`, a strip of sand between. `side` is 'north' | 'south' | 'west' | 'east'; `from` is the shore line's
// offset outside the map edge. Colours come from the theme's water.
export function sea(ctx, side, { from = 1.5, beach = 0, y = -0.5 } = {}) {
  const { b, glow, W, H, theme, kit } = ctx;
  const deep = theme.water?.deep ?? [0.04, 0.08, 0.1], glint = theme.water?.glint ?? [0.5, 0.6, 0.7];
  const far = 80;
  const rect = (x0, z0, x1, z1, yy) => kit.box3(b, x0, yy - 0.05, z0, x1 - x0, 0.05, z1 - z0);
  const span = { north: [-far, -far, W + far, -from], south: [-far, H + from, W + far, H + far], west: [-far, -far, -from, H + far], east: [W + from, -far, W + far, H + far] }[side];
  if (beach) {
    const I = theme.ink;
    b.setColor(I.sand ?? I.dirt);
    const sb = { north: [-far, -from - beach, W + far, -from], south: [-far, H + from, W + far, H + from + beach], west: [-from - beach, -far, -from, H + far], east: [W + from, -far, W + from + beach, H + far] }[side];
    rect(...sb, -0.05);
    if (side === 'north') span[3] -= beach; else if (side === 'south') span[1] += beach; else if (side === 'west') span[2] -= beach; else span[0] += beach;
  }
  b.setColor(deep.map(c => c * 1.4));
  rect(...span, y);
  // Surf: a broken bright line along the shore, as additive glow so it never lights up in the dark.
  const along = side === 'north' || side === 'south';
  const edge = side === 'north' ? span[3] : side === 'south' ? span[1] : side === 'west' ? span[2] : span[0];
  const L = along ? W + 40 : H + 40;
  for (let s = -20; s < L - 20; s += 2.2) {
    const k = 0.5 + 0.5 * Math.sin(s * 1.7);
    const c = glint.map(v => v * 0.09 * k);
    const len = 1.6 + k;
    if (along) glow.quad([s, y + 0.06, edge - 0.35], [s, y + 0.06, edge + 0.35], [s + len, y + 0.06, edge + 0.35], [s + len, y + 0.06, edge - 0.35], c, c, c, c);
    else glow.quad([edge - 0.35, y + 0.06, s], [edge + 0.35, y + 0.06, s], [edge + 0.35, y + 0.06, s + len], [edge - 0.35, y + 0.06, s + len], c, c, c, c);
  }
}

// A leaning coconut palm: trunk segments and a crown of drooping fronds `frond` metres long (keep it short over
// play space, so a crown never hides a player for long).
export function palm(ctx, x, z, hgt, lean = 0.3, frond = 1.6) {
  const { b, rnd, theme } = ctx;
  const I = theme.ink;
  const bark = I.bark ?? I.pile ?? hexRGB(0x5a4a38), leaf = I.leaf ?? hexRGB(0x4a6a34), leafD = I.leafD ?? hexRGB(0x34502a);
  const dir = rnd() * Math.PI * 2, dx = Math.cos(dir) * lean, dz = Math.sin(dir) * lean;
  const n = 4;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    b.setColor(i % 2 ? bark : bark.map(c => c * 0.85));
    b.prismY(hgt * t0, hgt * t1, x + dx * hgt * t0 * t0, z + dz * hgt * t0 * t0, 0.24 - t0 * 0.08, 0.22 - t1 * 0.08, 5);
  }
  const tx = x + dx * hgt, tz = z + dz * hgt;
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rnd() * 0.4, r = frond + rnd() * frond * 0.35;
    const ex = tx + Math.cos(a) * r, ez = tz + Math.sin(a) * r, side = 0.32;
    const px = -Math.sin(a) * side, pz = Math.cos(a) * side;
    b.setColor(k % 2 ? leaf : leafD);
    b.tri([tx + px, hgt + 0.1, tz + pz], [ex, hgt - 0.9, ez], [tx - px, hgt + 0.1, tz - pz]);
    b.tri([tx - px, hgt + 0.1, tz - pz], [ex, hgt - 0.9, ez], [tx + px, hgt + 0.1, tz + pz]);
  }
}

// A lighthouse on its rock, with a lit lantern: the coast's landmark on every horizon.
export function lighthouse(ctx, x, z, hgt = 13) {
  const { b, glow, kit } = ctx;
  const white = hexRGB(0xc8c6bc), red = hexRGB(0x8a3a32);
  b.setColor(hexRGB(0x55534e));
  b.prismY(-0.6, 1.2, x, z, 3.6, 2.6, 7);
  for (let i = 0; i < 4; i++) {
    const y0 = 1.2 + (i * (hgt - 1.2)) / 4, y1 = 1.2 + ((i + 1) * (hgt - 1.2)) / 4;
    b.setColor(i % 2 ? red : white);
    b.prismY(y0, y1, x, z, 1.25 - i * 0.18, 1.25 - (i + 1) * 0.18, 8);
  }
  b.setColor(hexRGB(0x2a2c30));
  b.prismY(hgt, hgt + 0.25, x, z, 0.95, 0.95, 8);
  kit.emissive(b, () => { b.setColor([1, 0.86, 0.55]); b.prismY(hgt + 0.25, hgt + 1.1, x, z, 0.5, 0.5, 8); });
  b.setColor(hexRGB(0x2a2c30));
  b.prismY(hgt + 1.1, hgt + 1.7, x, z, 0.65, 0.05, 8);
  glow.halo(x, z, 6, [0.1, 0.085, 0.05], hgt + 0.6, 12);
}

// A small fishing boat at anchor out at sea: hull, wheelhouse, mast.
function boat(ctx, x, z, L, colour, y = -0.5) {
  const { b, kit } = ctx;
  const T = L * 0.34;
  b.setColor(colour);
  b.loft([
    [[x, y - 0.3, z + T * 0.3], [x, y + 0.7, z], [x, y + 0.7, z + T], [x, y - 0.3, z + T * 0.7]],
    [[x + L * 0.75, y - 0.3, z + T * 0.25], [x + L * 0.75, y + 0.8, z - 0.05], [x + L * 0.75, y + 0.8, z + T + 0.05], [x + L * 0.75, y - 0.3, z + T * 0.75]],
    [[x + L, y + 0.2, z + T * 0.5], [x + L, y + 1.0, z + T * 0.45], [x + L, y + 1.0, z + T * 0.55], [x + L, y + 0.2, z + T * 0.5]],
  ]);
  b.setColor(hexRGB(0xbab6aa));
  kit.box3(b, x + L * 0.18, y + 0.7, z + T * 0.2, L * 0.24, 1.1, T * 0.6);
  b.setColor(hexRGB(0x3a3c40));
  b.prismY(y + 0.7, y + 4, x + L * 0.6, z + T / 2, 0.06, 0.04, 4);
}

// ---- Pier ---------------------------------------------------------------------------------------------------------

const box = (b, x, y, z, w, h, d) => b.box(x + w / 2, y + h / 2, z + d / 2, w, h, d);
const BOARDWALK = 7.6;       // Depth of the plank boardwalks along the north and south sea walls.

function pierGround(ctx) {
  const { map, noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const waters = map.walls.filter(w => w.kind === 'water');
  const nearWater = (x, z) => waters.some(w => x > w.x - 1.2 && x < w.x + w.w + 1.2 && z > w.z - 1.2 && z < w.z + w.d + 1.2);
  return p => {
    const [x, , z] = p;
    const k = 0.9 + noise(x * 0.7, z * 0.7) * 0.16 + (rnd() - 0.5) * 0.05;
    if (z < -1 || z > H + 1) { ctx.groundWet = 1; return I.stoneD.map(c => c * 0.6); }
    if (x < 0 || x > W) { ctx.groundWet = 0.4; return (noise(x * 0.3, z * 0.3) > 0.5 ? I.sandD : I.gravel).map(c => c * k * 0.8); }
    if (z < BOARDWALK || z > H - BOARDWALK) { ctx.groundWet = 0.35; return (noise(x * 0.15 + 3, z * 0.4) > 0.6 ? I.plankD : I.plank).map(c => c * k); }
    ctx.groundWet = nearWater(x, z) ? 0.9 : 0.55;
    const slab = (Math.floor(x / 4) + Math.floor(z / 4)) % 2 === 0;
    return (nearWater(x, z) ? I.asphalt : slab ? I.ground : I.gravel).map(c => c * k);
  };
}

function pierPaint(ctx) {
  const { b, map, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  // Gaps between the boardwalk planks: dark lines across the deck.
  b.setColor(I.plankD.map(c => c * 0.62));
  for (let x = 0.45; x < W; x += 0.9) {
    b.groundRect(x, 0, 0.06, BOARDWALK - 0.1, 0.05);
    b.groundRect(x, H - BOARDWALK + 0.1, 0.06, BOARDWALK - 0.1, 0.05);
  }
  // Plank decks over the footbridges: where two inlet basins nearly meet, the strip between them is a bridge.
  const waters = map.walls.filter(w => w.kind === 'water');
  for (const a of waters) for (const c of waters) {
    if (c === a || c.x <= a.x || Math.abs(c.z - a.z) > 0.01 || c.x - (a.x + a.w) > 4) continue;
    const x0 = a.x + a.w, x1 = c.x;
    b.setColor(I.plankL);
    b.groundRect(x0, a.z - 0.4, x1 - x0, a.d + 0.8, 0.06);
    b.setColor(I.plankD);
    for (let z = a.z - 0.35; z < a.z + a.d + 0.4; z += 0.5) b.groundRect(x0, z, x1 - x0, 0.05, 0.08);
    // Hand ropes on posts along both sides (the basin edges, which block anyway).
    for (const x of [x0 + 0.06, x1 - 0.06]) {
      b.setColor(I.pile);
      for (let z = a.z; z <= a.z + a.d + 0.01; z += a.d / 2) b.prismY(0, 1.05, x, z, 0.08, 0.07, 5);
      b.setColor(I.rope);
      box(b, x - 0.025, 0.95, a.z, 0.05, 0.05, a.d);
    }
  }
  // Mooring rings, tar stains and coiled ropes on the concrete.
  for (let i = 0; i < 26; i++) {
    const x = 2 + rnd() * (W - 4), z = BOARDWALK + 1 + rnd() * (H - 2 * BOARDWALK - 2);
    if (map.walls.some(w => x > w.x - 0.4 && x < w.x + w.w + 0.4 && z > w.z - 0.4 && z < w.z + w.d + 0.4)) continue;
    b.setColor(i % 3 ? I.tar : I.rope);
    b.groundRect(x, z, 0.5 + rnd() * 0.8, 0.4 + rnd() * 0.5, 0.04);
  }
}

function pierLights(ctx) {
  const { map, lamps, glow, W, H } = ctx;
  // Morning: a few lamps still burning over the hall and the boathouse doors.
  for (const w of map.walls) if (w.counter) { lamps.push({ x: W / 2, z: H / 2, r: 7 }); glow.halo(W / 2, H / 2, 4, [0.07, 0.05, 0.025]); }
  for (const w of map.walls) {
    if (!w.boathouse) continue;
    const x = w.x + w.w / 2, z = w.z + w.d + 0.6;
    lamps.push({ x, z, r: 4.5 });
  }
}

// Clapboard boathouse or shed: board-and-batten walls, a gabled roof along its long side, a big door to the water and a
// lit window facing the camera.
function pierHouse(ctx, w) {
  const { b, rnd, theme, kit } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const paint = [I.blue, I.red, I.white, I.green][Math.floor(rnd() * 4)];
  b.setColor(paint);
  kit.box3(b, x, 0, z, bw, h - 0.2, bd);
  b.setColor(I.trim);
  kit.box3(b, x - 0.06, 0, z - 0.06, bw + 0.12, 0.4, bd + 0.12);
  b.setColor(paint.map(c => c * 0.82));
  for (let i = 0.35; i < bw; i += 0.55) { kit.box3(b, x + i, 0.4, z + bd, 0.07, h - 0.7, 0.04); kit.box3(b, x + i, 0.4, z - 0.04, 0.07, h - 0.7, 0.04); }
  for (let i = 0.35; i < bd; i += 0.55) { kit.box3(b, x - 0.04, 0.4, z + i, 0.04, h - 0.7, 0.07); kit.box3(b, x + bw, 0.4, z + i, 0.04, h - 0.7, 0.07); }
  // Roof: ridge along the long axis.
  const y0 = h - 0.2, rise = Math.min(bw, bd) * 0.32, o = 0.3;
  b.setColor(I.roof);
  if (bw >= bd) {
    b.loft([
      [[x - o, y0, z - o], [x - o, y0 + rise, z + bd / 2], [x - o, y0, z + bd + o]],
      [[x + bw + o, y0, z - o], [x + bw + o, y0 + rise, z + bd / 2], [x + bw + o, y0, z + bd + o]],
    ]);
  } else {
    b.loft([
      [[x - o, y0, z - o], [x + bw / 2, y0 + rise, z - o], [x + bw + o, y0, z - o]],
      [[x - o, y0, z + bd + o], [x + bw / 2, y0 + rise, z + bd + o], [x + bw + o, y0, z + bd + o]],
    ]);
  }
  // Door and window on the south face (the one the camera sees), the boat door's frame on the north.
  b.setColor(I.trim);
  kit.box3(b, x + bw * 0.55, 0, z + bd + 0.03, Math.min(2.4, bw * 0.35), h * 0.62, 0.05);
  b.setColor(I.white);
  kit.box3(b, x + bw * 0.55 - 0.08, h * 0.62, z + bd + 0.03, Math.min(2.4, bw * 0.35) + 0.16, 0.1, 0.07);
  kit.emissive(b, () => {
    b.setColor(I.glow.map(c => c * 0.7));
    kit.box3(b, x + bw * 0.16, h * 0.42, z + bd + 0.03, 0.9, 0.6, 0.04);
  });
  // A life ring on the wall.
  b.setColor(I.buoy);
  b.prismZ(z + bd + 0.03, z + bd + 0.1, x + bw * 0.35, h * 0.5, 0.26, 0.26, 8);
}

function pierWall(ctx, w) {
  const { b, rnd, theme, kit } = ctx;
  const I = theme.ink;
  const { x, z, w: ww, d: wd, h } = w;
  const long = ww >= wd, L = Math.max(ww, wd);
  if (w.hall) {
    // Market hall: white clapboard on a tarred plinth, posts every two metres.
    b.setColor(I.tar);
    kit.box3(b, x, 0, z, ww, 0.5, wd);
    b.setColor(I.white);
    kit.box3(b, x, 0.5, z, ww, h - 0.5, wd);
    b.setColor(I.white.map(c => c * 0.84));
    for (let y = 0.8; y < h - 0.2; y += 0.42) kit.box3(b, x - 0.03, y, z - 0.03, ww + 0.06, 0.05, wd + 0.06);
    b.setColor(I.blue);
    kit.box3(b, x - 0.05, h - 0.18, z - 0.05, ww + 0.1, 0.22, wd + 0.1);
    for (let s = 0; s <= L + 0.01; s += Math.max(1, L / Math.ceil(L / 2))) {
      if (long) kit.box3(b, x + Math.min(s, ww - 0.2), 0, z - 0.06, 0.2, h, wd + 0.12);
      else kit.box3(b, x - 0.06, 0, z + Math.min(s, wd - 0.2), ww + 0.12, h, 0.2);
    }
    return;
  }
  // Spawn screen: tarred timber fence hung with drying nets.
  b.setColor(I.pile);
  kit.box3(b, x, 0, z, ww, h, wd);
  b.setColor(I.net);
  if (long) kit.box3(b, x + 0.2, 0.5, z + wd, ww - 0.4, h - 0.8, 0.05);
  else kit.box3(b, x + ww, 0.5, z + 0.2, 0.05, h - 0.8, wd - 0.4);
  b.setColor(I.buoy);
  for (let s = 0.6; s < L - 0.3; s += 1.1 + rnd() * 0.3) {
    if (long) kit.box3(b, x + s, h - 0.35, z + wd, 0.18, 0.18, 0.12);
    else kit.box3(b, x + ww, h - 0.35, z + s, 0.12, 0.18, 0.18);
  }
}

// Stacks of plastic fish boxes in a few faded colours, a little off square.
function fishBoxes(ctx, w) {
  const { b, rnd, theme, kit } = ctx;
  const I = theme.ink;
  if (!w.fishbox) return kit.container(b, w, rnd);
  const cols = [I.blue, I.red, I.white, I.buoy.map(c => c * 0.85), I.green];
  const bx = w.w / Math.max(1, Math.round(w.w / 1.05)), bz = w.d / Math.max(1, Math.round(w.d / 0.72)), bh = 0.42;
  for (let x = w.x; x < w.x + w.w - 0.01; x += bx) {
    for (let z = w.z; z < w.z + w.d - 0.01; z += bz) {
      const top = w.h - (rnd() < 0.3 ? bh : 0);
      for (let y = 0; y < top - 0.01; y += bh) {
        const c = cols[Math.floor(rnd() * cols.length)];
        const j = (rnd() - 0.5) * 0.08;
        b.setColor(c);
        kit.box3(b, x + 0.03 + j, y, z + 0.03, bx - 0.06, bh - 0.04, bz - 0.06);
        b.setColor(c.map(v => v * 0.7));
        kit.box3(b, x + 0.03 + j, y + bh - 0.06, z + 0.03, bx - 0.06, 0.03, bz - 0.06);
      }
    }
  }
}

// Lobster pots: a two-by-two stack of netted cages with a float tied on top.
function lobsterPots(ctx, w) {
  const { b, rnd, theme, kit } = ctx;
  const I = theme.ink;
  if (!w.pots) return kit.crate(b, w, rnd);
  const n = 2, cw = w.w / n, cd = w.d / n, ch = w.h / 2;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < 2; k++) {
    if (k === 1 && (i + j) % 3 === 2) continue;
    const x = w.x + i * cw, z = w.z + j * cd, y = k * ch;
    b.setColor(I.net);
    kit.box3(b, x + 0.05, y, z + 0.05, cw - 0.1, ch - 0.06, cd - 0.1);
    b.setColor(I.tar);
    kit.box3(b, x + 0.03, y, z + 0.03, cw - 0.06, 0.08, cd - 0.06);
    b.prismX(x + 0.05, x + cw - 0.05, y + ch - 0.12, z + cd / 2, 0.05, 0.05, 4);
  }
  b.setColor(I.buoy);
  b.prismY(w.h - 0.05, w.h + 0.3, w.x + w.w * 0.7, w.z + w.d * 0.3, 0.18, 0.18, 7);
}

function pierBarrier(ctx, w) {
  const { b, rnd, theme, kit } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd, L = Math.max(bw, bd);
  if (w.dinghy) {
    // An upturned dinghy on its trolley.
    b.setColor(I.tar);
    kit.box3(b, x + 0.2, 0, z + 0.25, bw - 0.4, 0.3, bd - 0.5);
    b.setColor(I.white);
    b.loft([
      [[x, 0.3, z + bd * 0.2], [x, h, z + bd * 0.35], [x, h, z + bd * 0.65], [x, 0.3, z + bd * 0.8]],
      [[x + bw * 0.7, 0.3, z], [x + bw * 0.7, h, z + 0.2], [x + bw * 0.7, h, z + bd - 0.2], [x + bw * 0.7, 0.3, z + bd]],
      [[x + bw, 0.3, z + bd * 0.45], [x + bw, h * 0.9, z + bd * 0.48], [x + bw, h * 0.9, z + bd * 0.52], [x + bw, 0.3, z + bd * 0.55]],
    ]);
    b.setColor(I.blue);
    kit.box3(b, x + 0.1, 0.5, z + bd * 0.12, bw * 0.85, 0.12, bd * 0.76);
    return;
  }
  if (w.counter) {
    // Steel gutting counter on legs, ice boxes underneath.
    b.setColor(I.steel);
    kit.box3(b, x, h - 0.12, z, bw, 0.12, bd);
    b.setColor(I.steel.map(c => c * 0.7));
    for (const [lx, lz] of [[x + 0.1, z + 0.1], [x + bw - 0.2, z + 0.1], [x + 0.1, z + bd - 0.2], [x + bw - 0.2, z + bd - 0.2]]) kit.box3(b, lx, 0, lz, 0.1, h - 0.12, 0.1);
    b.setColor(I.white);
    kit.box3(b, x + 0.3, 0, z + 0.12, bw * 0.35, 0.45, bd - 0.24);
    b.setColor(I.blue);
    kit.box3(b, x + bw * 0.55, 0, z + 0.12, bw * 0.35, 0.45, bd - 0.24);
    return;
  }
  if (w.nets) {
    // Net drying rack: posts and rails with the net hung over them, floats along the top.
    b.setColor(I.pile);
    for (let s = 0; s <= L + 0.01; s += L / Math.max(1, Math.round(L / 1.5))) {
      const sx = long ? x + Math.min(s, bw - 0.12) : x + bw / 2 - 0.06, sz = long ? z + bd / 2 - 0.06 : z + Math.min(s, bd - 0.12);
      kit.box3(b, sx, 0, sz, 0.12, h + 0.1, 0.12);
    }
    b.setColor(I.net);
    if (long) kit.box3(b, x, 0.25, z + bd / 2 - 0.1, bw, h - 0.25, 0.2);
    else kit.box3(b, x + bw / 2 - 0.1, 0.25, z, 0.2, h - 0.25, bd);
    b.setColor(I.buoy);
    for (let s = 0.3; s < L - 0.2; s += 0.6 + rnd() * 0.2) {
      if (long) kit.box3(b, x + s, h - 0.08, z + bd / 2 - 0.12, 0.16, 0.16, 0.24);
      else kit.box3(b, x + bw / 2 - 0.12, h - 0.08, z + s, 0.24, 0.16, 0.16);
    }
    return;
  }
  kit.barrier(b, w);
}

// Inlet edges: a tarred timber staithe down to the water, piles standing proud of the deck every metre and a half.
function pierWater(ctx, w) {
  const { b, theme, kit } = ctx;
  const I = theme.ink, y = kit.WATER_Y;
  b.setColor(I.pile);
  kit.box3(b, w.x - 0.25, y - 0.6, w.z - 0.25, w.w + 0.5, 0.62 - y, 0.25);
  kit.box3(b, w.x - 0.25, y - 0.6, w.z + w.d, w.w + 0.5, 0.62 - y, 0.25);
  kit.box3(b, w.x - 0.25, y - 0.6, w.z, 0.25, 0.62 - y, w.d);
  kit.box3(b, w.x + w.w, y - 0.6, w.z, 0.25, 0.62 - y, w.d);
  b.setColor(I.plankD);
  for (const zz of [w.z - 0.25, w.z + w.d]) for (let x = w.x; x < w.x + w.w; x += 1.5) b.prismY(0, 0.55, x + 0.2, zz + 0.12, 0.13, 0.11, 6);
  // Weed and a skiff tied up in the bigger basins.
  if (w.w > 7) {
    b.setColor(I.green);
    const L = Math.min(4, w.w * 0.45), T = Math.min(1.5, w.d * 0.45);
    b.loft([
      [[w.x + 0.8, y - 0.1, w.z + w.d / 2 - T * 0.3], [w.x + 0.8, y + 0.45, w.z + w.d / 2 - T / 2], [w.x + 0.8, y + 0.45, w.z + w.d / 2 + T / 2], [w.x + 0.8, y - 0.1, w.z + w.d / 2 + T * 0.3]],
      [[w.x + 0.8 + L, y + 0.1, w.z + w.d / 2], [w.x + 0.8 + L, y + 0.55, w.z + w.d / 2 - 0.05], [w.x + 0.8 + L, y + 0.55, w.z + w.d / 2 + 0.05], [w.x + 0.8 + L, y + 0.1, w.z + w.d / 2]],
    ]);
    b.setColor(I.plank);
    kit.box3(b, w.x + 1.2, y + 0.38, w.z + w.d / 2 - T * 0.35, L * 0.5, 0.06, T * 0.7);
  }
}

// Perimeter: on the sea sides a low stone sea wall with a rail; at the ends, tarred net sheds.
function pierBorder(ctx, w) {
  const { b, rnd, theme, kit, H } = ctx;
  const I = theme.ink;
  const long = w.w > w.d;
  if (long) {
    b.setColor(I.stoneD);
    kit.box3(b, w.x, -1.2, w.z, w.w, 2.2, w.d);
    b.setColor(I.stone);
    for (let x = w.x; x < w.x + w.w; x += 1.1) kit.box3(b, x + 0.03, 1.0, w.z + 0.05, 1.04, 0.18, w.d - 0.1);
    b.setColor(I.steel.map(c => c * 0.7));
    const zr = w.z < H / 2 ? w.z + w.d - 0.15 : w.z + 0.05;
    for (let x = w.x + 1; x < w.x + w.w; x += 2.4) b.prismY(1.0, 1.9, x, zr + 0.05, 0.05, 0.05, 4);
    kit.box3(b, w.x, 1.85, zr, w.w, 0.07, 0.1);
    return;
  }
  b.setColor(I.pile);
  kit.box3(b, w.x, 0, w.z, w.w, w.h, w.d);
  const n = Math.floor(w.d / 5);
  for (let i = 0; i < n; i++) {
    const z = w.z + i * 5 + 0.5, x = w.x < 0 ? w.x - 4 : w.x + w.w;
    b.setColor([I.blue, I.red, I.white][i % 3].map(c => c * 0.75));
    kit.box3(b, x, 0, z, 4, 2.6 + rnd() * 0.6, 4);
    b.setColor(I.roof);
    kit.box3(b, x - 0.2, 2.9, z - 0.2, 4.4, 0.25, 4.4);
  }
}

function pierDecor(ctx) {
  const { b, map, W, H, theme, kit, rnd } = ctx;
  const I = theme.ink;
  // The sea off both long sides, the pier legs under the sea walls, boats at anchor, the lighthouse.
  for (const d of map.decor || []) if (d.type === 'sea') for (const s of d.sides) sea(ctx, s, { from: 1.5, y: kit.WATER_Y });
  b.setColor(I.pile);
  for (let x = -4; x < W + 4; x += 2.2) { b.prismY(-3, 0, x, -1.9, 0.18, 0.16, 6); b.prismY(-3, 0, W - x, H + 1.9, 0.18, 0.16, 6); }
  boat(ctx, 6, -14, 7, I.blue, kit.WATER_Y);
  boat(ctx, 30, -22, 9, I.red, kit.WATER_Y);
  boat(ctx, 40, H + 12, 8, I.green, kit.WATER_Y);
  boat(ctx, 12, H + 20, 6, I.white, kit.WATER_Y);
  lighthouse(ctx, W + 18, -18);
  // Breakwater out to the lighthouse.
  b.setColor(I.stoneD);
  kit.box3(b, W - 4, -1, -19.5, 22, 1.2, 3);
  for (let i = 0; i < 9; i++) {
    b.setColor(i % 2 ? I.buoy : I.white);
    b.prismY(kit.WATER_Y - 0.1, kit.WATER_Y + 0.35, -6 + rnd() * (W + 12), i % 2 ? -5 - rnd() * 8 : H + 5 + rnd() * 8, 0.22, 0.12, 6);
  }
  kit.skyRing(ctx, { low: [0.12, 0.16, 0.2], mid: [0.3, 0.36, 0.42], warm: [0.48, 0.5, 0.5], high: [0.18, 0.22, 0.28], warmDir: [0.4, -1], y0: -4, y1: 8, y2: 46 });
}

export const pier = {
  dress: { building: pierHouse, wall: pierWall, container: fishBoxes, crate: lobsterPots, barrier: pierBarrier, water: pierWater, border: pierBorder },
  stage: { lights: pierLights, ground: pierGround, paint: pierPaint, decor: pierDecor },
  thumb: { ground: '#6c6f6e', solid: '#8a6a5c', low: '#4a6a7a', water: '#1d3440', edge: '#141a20' },
};
