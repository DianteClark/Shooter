// Pagoda's theme (mountain, medium; js/shared/maps/pagoda.js): a hillside temple on an autumn evening at blue hour.
// The sun just gone behind the ridge to the west: cool indigo light over everything, warm stone lanterns and paper
// lanterns in pools, maples in full red and orange, vermilion gates, white plaster and dark tiled roofs, raked pale
// gravel and moss. Clearly not Ashgrove (night, oil lamps, ash and yew), Millbrook (spring morning) or Harvest (gold
// morning fields): dusk blue against crimson leaves and lantern amber.
// world.js reads `pagoda` ({ dress, stage, thumb }) into its tables and hands every drawer ctx.kit.
import { THEMES, hexRGB } from '../art.js';
import { box3, emissive, scale, mix, rimPoints, skyRing, waterBanks, WATER_Y, mass } from './kit.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));
const sc = scale;

THEMES.pagoda = {
  id: 'pagoda',
  light: { dir: norm([-0.72, 0.5, 0.3]), sun: [0.62, 0.52, 0.62], sky: [0.34, 0.38, 0.58], amb: [0.3, 0.31, 0.43] },
  clear: 0x121628,
  fog: [0.3, 0.33, 0.48], fogSeam: [0.14, 0.08, 0.06], desatTint: [0.8, 0.82, 0.92],
  shadow: { col: [0.36, 0.38, 0.56], strength: 0.5, len: 0.9 },
  lamp: [0.56, 0.32, 0.12],
  groundAmp: 0.1,
  water: { deep: [0.04, 0.07, 0.12], shallow: [0.1, 0.16, 0.24], glint: [1.0, 0.72, 0.44] },
  ink: ink({
    ground: 0x56603e, asphalt: 0x585660, dirt: 0x5e5040, gravel: 0x9a98a0,
    roof: 0x3c4048, wall: 0xc4bcae, wallB: 0xaea89a, trim: 0x2a2626,
    concrete: 0x86848a, crate: 0x7a5a3a, crateD: 0x4a3626,
    rail: 0x8a8e96, tie: 0x3a302a, hazardY: 0xa8803a, hazardK: 0x262228,
    paint: 0xd0c8b8, glow: 0xffc070, glowCool: 0xc8d8ff,
    moss: 0x4e5a36, mossD: 0x3e4a2e, mossL: 0x5e6a3e, rake: 0xa8a6ae, rakeD: 0x8e8c96, step: 0x76727a, stepD: 0x5c5862,
    plaster: 0xd2cabc, plasterD: 0xb4ac9e, tile: 0x34383e, tileD: 0x26292e, timber: 0x4a3226, timberD: 0x30201a,
    vermilion: 0xa83a26, vermilionD: 0x7a2a1e, black: 0x1e1c20, gold: 0xb08a3a, stone: 0x7a7680, stoneD: 0x5a5662,
    maple: 0xb03a22, mapleO: 0xc0602a, mapleY: 0xb88a30, mapleD: 0x7e2a1c, bark: 0x3a2c26, bamboo: 0x8a8a52, bambooD: 0x6a6a3e,
    thatch: 0x7a6a4a, paper: 0xf0d8a8, cedar: 0x24302a, cedarD: 0x1c2620, koi: 0xd06a2a, lily: 0x3e5a36,
  }),
  containers: [0x5a3a2c, 0x3e4a3a, 0x4e4434],
  weather: { fields: [
    // Maple leaves coming down on the evening breeze, a little mist in the hollows, lantern moths.
    { kind: 'leaf', count: 46, box: [42, 7, 32], vel: [0.5, -0.45, 0.2], size: 0.2, col: [0.86, 0.32, 0.16], alpha: 0.9 },
    { kind: 'leaf', count: 18, box: [42, 7, 32], vel: [0.4, -0.4, 0.25], size: 0.18, col: [0.9, 0.62, 0.22], alpha: 0.85 },
    { kind: 'mote', count: 18, box: [46, 1.4, 34], vel: [0.25, 0.02, 0.08], size: 4.6, col: [0.5, 0.56, 0.72], alpha: 0.06 },
    { kind: 'mote', count: 30, box: [40, 4, 30], vel: [0.1, 0.2, 0.05], size: 0.07, col: [1, 0.82, 0.5], alpha: 0.45 },
  ] },
};

const near = (map, x, z, p = 0.3) => map.walls.some(w => w.kind !== 'border' && x > w.x - p && x < w.x + w.w + p && z > w.z - p && z < w.z + w.d + p);

// ---- Ground ----------------------------------------------------------------------------------------------------

function pagGround(ctx) {
  const { map, noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const lanes = map.lanes.map(l => l.z);
  const pag = map.walls.find(w => w.pagoda);
  const cx = pag ? pag.x + pag.w / 2 : W / 2, cz = pag ? pag.z + pag.d / 2 : H / 2;
  const gardens = map.walls.filter(w => w.garden);
  return p => {
    const [x, , z] = p;
    const k = 0.9 + noise(x * 0.7, z * 0.7) * 0.16 + (rnd() - 0.5) * 0.05;
    ctx.groundWet = 0.1;
    if (x < 0 || z < 0 || x > W || z > H) {
      const n = noise(x * 0.1, z * 0.1);
      return sc(n > 0.55 ? I.mapleD : n > 0.4 ? I.mossD : I.cedarD, k * 0.8);
    }
    // Raked gravel round the pagoda and in each garden.
    const garden = gardens.some(g => Math.hypot(x - g.x - g.w / 2, z - g.z - g.d / 2) < 4.2);
    if ((Math.abs(x - cx) < 9 && Math.abs(z - cz) < 6.5) || garden) {
      const r = Math.hypot(x - cx, z - cz);
      return sc(Math.floor((garden ? z : r) * 2.6) % 2 ? I.rake : I.rakeD, k * 1.02);
    }
    // Stepping-stone paths down the lanes.
    let dl = 99;
    for (const lz of lanes) dl = Math.min(dl, Math.abs(z - lz));
    if (dl < 1.1) return sc(I.stepD, k);
    // Moss, with drifts of fallen leaves.
    const n = noise(x * 0.16 + 9, z * 0.16);
    if (n > 0.66) return sc(I.mapleD, k);
    return sc(n > 0.52 ? I.mossL : n < 0.34 ? I.mossD : I.moss, k);
  };
}

function pagPaint(ctx) {
  const { b, map, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  // Stepping stones along each path.
  for (const lane of map.lanes) {
    for (let x = 0.6; x < W - 0.6; x += 1.15 + rnd() * 0.2) {
      const z = lane.z + (rnd() - 0.5) * 0.4;
      if (near(map, x, z, 0.4)) continue;
      b.setColor(sc(rnd() < 0.5 ? I.step : I.stone, 0.9 + rnd() * 0.15));
      b.prismY(0, 0.08, x, z, 0.5, 0.46, 6, rnd());
    }
  }
  // Plank bridges over the ponds, with vermilion rails.
  for (const r of map.rooms || []) {
    for (let z = r.z, i = 0; z < r.z + r.d; z += 0.36, i++) {
      b.setColor(sc(i % 2 ? I.timber : I.timberD, 1.1));
      b.groundRect(r.x - 0.1, z, r.w + 0.2, 0.32, 0.12);
    }
    b.setColor(I.vermilion);
    for (const x of [r.x - 0.12, r.x + r.w]) {
      box3(b, x, 0.75, r.z - 0.3, 0.12, 0.1, r.d + 0.6);
      for (let z = r.z - 0.3; z <= r.z + r.d + 0.3; z += (r.d + 0.6) / 3) box3(b, x, 0, z, 0.12, 0.85, 0.12);
    }
  }
  // Fallen maple leaves, thickest under the trees.
  const maples = map.walls.filter(w => w.maple);
  for (let i = 0; i < 260; i++) {
    const m = maples[i % maples.length], a = rnd() * Math.PI * 2, d = rnd() * 3.2;
    const x = m ? m.x + 0.5 + Math.cos(a) * d : rnd() * W, z = m ? m.z + 0.5 + Math.sin(a) * d : rnd() * H;
    if (x < 0 || z < 0 || x > W || z > H || near(map, x, z, 0.05)) continue;
    b.setColor(sc([I.maple, I.mapleO, I.mapleY][i % 3], 0.85 + rnd() * 0.2));
    b.groundRect(x, z, 0.16, 0.13, 0.03 + (i % 5) * 0.002);
  }
}

// Lanterns, the hall's doors and the bell tower: warm pools on the moss.
function pagLights(ctx) {
  const { map, lamps, glow } = ctx;
  for (const w of map.walls) {
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2;
    if (w.lantern) { lamps.push({ x: cx, z: cz, r: 5.5 }); glow.halo(cx, cz, 2.6, [0.14, 0.08, 0.02]); }
    if (w.hall) { const fz = w.z + w.d + 1.4; lamps.push({ x: cx, z: fz, r: 7 }); glow.halo(cx, fz - 0.6, 3.6, [0.12, 0.06, 0.02]); }
    if (w.teahouse) lamps.push({ x: cx, z: w.z - 1.2, r: 5.5 });
    if (w.kura) lamps.push({ x: cx, z: w.z + w.d + 1.2, r: 5, col: [0.4, 0.24, 0.1] });
    if (w.pagoda) { for (const [ox, oz] of [[-5, 0], [5, 0], [0, 4.2], [0, -4.2]]) lamps.push({ x: cx + ox, z: cz + oz, r: 5.5 }); }
  }
}

// ---- Drawers ---------------------------------------------------------------------------------------------------

// A tiled hip roof with up-turned corners: a frustum from the eave ring (wider, with the corners lifted) to the ridge.
function hipRoof(b, I, x, z, w, d, y, rise, over = 0.7, lift = 0.35) {
  const e = [[x - over, y + lift, z - over], [x + w * 0.5, y, z - over], [x + w + over, y + lift, z - over], [x + w + over, y, z + d * 0.5],
    [x + w + over, y + lift, z + d + over], [x + w * 0.5, y, z + d + over], [x - over, y + lift, z + d + over], [x - over, y, z + d * 0.5]];
  const inset = Math.min(w, d) * 0.42;
  const t = [[x + inset, y + rise, z + inset], [x + w * 0.5, y + rise, z + inset], [x + w - inset, y + rise, z + inset], [x + w - inset, y + rise, z + d * 0.5],
    [x + w - inset, y + rise, z + d - inset], [x + w * 0.5, y + rise, z + d - inset], [x + inset, y + rise, z + d - inset], [x + inset, y + rise, z + d * 0.5]];
  b.setColor(I.tile);
  b.loft([[...e, e[0]], [...t, t[0]]]);
  b.setColor(I.tileD);
  box3(b, x + inset - 0.05, y + rise - 0.02, z + inset - 0.05, w - 2 * inset + 0.1, 0.2, d - 2 * inset + 0.1);
  // Eave fascia, catching the lanterns.
  b.setColor(I.timberD);
  b.loft([[...e, e[0]].map(p => [p[0], p[1] - 0.18, p[2]]), [...e, e[0]]]);
}

function pagodaTower(ctx, w) {
  const { b, theme, glow } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd } = w;
  const cx = x + bw / 2, cz = z + bd / 2;
  // Stone podium, five storeys each a little narrower, a roof on each, the bronze finial with its nine rings.
  b.setColor(I.stone);
  box3(b, x - 0.4, 0, z - 0.4, bw + 0.8, 0.6, bd + 0.8);
  let y = 0.6;
  for (let k = 0; k < 5; k++) {
    const s = bw - 0.6 - k * 0.55, hh = k === 0 ? 2.4 : 1.6;
    const sx = cx - s / 2, sz = cz - s / 2;
    b.setColor(I.vermilion);
    for (const [ox, oz] of [[0, 0], [s - 0.25, 0], [0, s - 0.25], [s - 0.25, s - 0.25]]) box3(b, sx + ox, y, sz + oz, 0.25, hh, 0.25);
    b.setColor(k % 2 ? I.plasterD : I.plaster);
    box3(b, sx + 0.1, y, sz + 0.1, s - 0.2, hh, s - 0.2);
    b.setColor(I.vermilionD);
    box3(b, sx - 0.02, y + hh - 0.35, sz - 0.02, s + 0.04, 0.3, s + 0.04);
    if (k === 0) { b.setColor(I.black); box3(b, cx - 0.6, y, sz + s - 0.05, 1.2, 1.9, 0.08); }
    hipRoof(b, I, sx, sz, s, s, y + hh, 0.7, 0.9 - k * 0.06, 0.4);
    y += hh + 0.55;
  }
  b.setColor(I.gold);
  b.prismY(y - 0.2, y + 0.4, cx, cz, 0.35, 0.25, 8);
  b.prismY(y + 0.4, y + 3.2, cx, cz, 0.08, 0.06, 6);
  for (let i = 0; i < 9; i++) b.prismY(y + 0.6 + i * 0.25, y + 0.68 + i * 0.25, cx, cz, 0.26 - i * 0.012, 0.26 - i * 0.012, 8);
  b.prismY(y + 3.2, y + 3.6, cx, cz, 0.18, 0.02, 6);
  // Paper lanterns hung at the corners of the first roof.
  emissive(b, () => {
    b.setColor(I.paper);
    const s = bw - 0.6, r = s / 2 + 0.6;
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.prismY(1.9, 2.5, cx + ox * r, cz + oz * r, 0.2, 0.2, 6);
  });
  glow.halo(cx, cz, 7.5, [0.08, 0.05, 0.02]);
}

function hall(ctx, w) {
  const { b, theme, W } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const front = z + bd;     // The hall faces the middle lane (south for the west one, north for the east one).
  const facesSouth = x < W / 2;
  // Stone plinth with steps, a colonnade of vermilion posts round white walls, a great tiled hip roof.
  b.setColor(I.stone);
  box3(b, x - 0.3, 0, z - 0.3, bw + 0.6, 0.5, bd + 0.6);
  b.setColor(I.stoneD);
  box3(b, x + bw / 2 - 1.2, 0, facesSouth ? front + 0.3 : z - 0.9, 2.4, 0.25, 0.6);
  b.setColor(I.plaster);
  box3(b, x + 0.4, 0.5, z + 0.4, bw - 0.8, h - 1.9, bd - 0.8);
  b.setColor(I.vermilion);
  for (let s = 0; s <= bw - 0.25; s += (bw - 0.25) / 4) { box3(b, x + s, 0.5, z, 0.25, h - 1.9, 0.25); box3(b, x + s, 0.5, z + bd - 0.25, 0.25, h - 1.9, 0.25); }
  box3(b, x, h - 1.65, z, bw, 0.25, bd);
  b.setColor(I.timber);
  for (let s = x + 1.2; s < x + bw - 1.2; s += 1.2) box3(b, s, 0.5, facesSouth ? z + bd - 0.42 : z + 0.38, 0.9, h - 2.2, 0.06);
  hipRoof(b, I, x, z, bw, bd, h - 1.4, 2.2, 0.9, 0.45);
  emissive(b, () => {
    b.setColor(sc(I.glow, 0.6));
    for (let s = x + 1.3; s < x + bw - 1.2; s += 1.2) box3(b, s, 0.9, facesSouth ? z + bd - 0.38 : z + 0.37, 0.7, 1.3, 0.04);
    b.setColor(I.paper);
    for (const ox of [0.3, bw - 0.3]) b.prismY(h - 2.6, h - 1.9, x + ox, facesSouth ? front + 0.2 : z - 0.2, 0.22, 0.22, 6);
  });
}

function belfry(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  // A splayed stone base, an open timber frame, the bronze bell hanging under a hip roof, the striking log on ropes.
  b.setColor(I.stone);
  b.loft([[[x - 0.2, 0, z - 0.2], [x + bw + 0.2, 0, z - 0.2], [x + bw + 0.2, 0, z + bd + 0.2], [x - 0.2, 0, z + bd + 0.2], [x - 0.2, 0, z - 0.2]],
    [[x + 0.2, 1.6, z + 0.2], [x + bw - 0.2, 1.6, z + 0.2], [x + bw - 0.2, 1.6, z + bd - 0.2], [x + 0.2, 1.6, z + bd - 0.2], [x + 0.2, 1.6, z + 0.2]]]);
  b.setColor(I.vermilion);
  for (const [ox, oz] of [[0.3, 0.3], [bw - 0.55, 0.3], [0.3, bd - 0.55], [bw - 0.55, bd - 0.55]]) box3(b, x + ox, 1.6, z + oz, 0.25, h - 2.6, 0.25);
  b.setColor(I.gold);
  b.prismY(2.1, 3.3, x + bw / 2, z + bd / 2, 0.75, 0.55, 10);
  b.prismY(3.3, 3.5, x + bw / 2, z + bd / 2, 0.55, 0.2, 10);
  b.setColor(I.timber);
  b.prismX(x - 0.4, x + bw / 2 - 0.8, 2.8, z + bd / 2, 0.14, 0.14, 6);
  hipRoof(b, I, x, z, bw, bd, h - 1, 1.3, 0.6, 0.35);
}

function kura(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  // A storehouse: thick white plaster over a base of dark tiles set in a diagonal lattice, a heavy gabled roof.
  b.setColor(I.black);
  box3(b, x, 0, z, bw, 1.2, bd);
  b.setColor(I.plasterD);
  for (let s = 0.3; s < bw; s += 0.6) { box3(b, x + s, 0.1, z + bd, 0.05, 1, 0.03); box3(b, x + s, 0.1, z - 0.03, 0.05, 1, 0.03); }
  b.setColor(I.plaster);
  box3(b, x + 0.05, 1.2, z + 0.05, bw - 0.1, h - 1.9, bd - 0.1);
  b.setColor(I.tile);
  const zm = z + bd / 2;
  b.loft([[[x - 0.4, h - 0.8, z - 0.45], [x - 0.4, h + 0.7, zm], [x - 0.4, h - 0.8, z + bd + 0.45]], [[x + bw + 0.4, h - 0.8, z - 0.45], [x + bw + 0.4, h + 0.7, zm], [x + bw + 0.4, h - 0.8, z + bd + 0.45]]]);
  b.setColor(I.tileD);
  box3(b, x - 0.5, h + 0.62, zm - 0.15, bw + 1, 0.22, 0.3);
  b.setColor(I.black);
  box3(b, x + bw / 2 - 0.6, 1.2, z + bd - 0.02, 1.2, 1.6, 0.08);
  box3(b, x + bw / 2 - 0.6, 1.2, z - 0.06, 1.2, 1.6, 0.08);
}

function teahouse(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  // A small rustic tea house: posts, earth-plaster walls, lit paper screens, a steep thatched roof, a crawl-in door.
  b.setColor(I.stoneD);
  box3(b, x, 0, z, bw, 0.4, bd);
  b.setColor(I.plasterD);
  box3(b, x + 0.1, 0.4, z + 0.1, bw - 0.2, h - 1.5, bd - 0.2);
  b.setColor(I.timber);
  for (const [ox, oz] of [[0, 0], [bw - 0.18, 0], [0, bd - 0.18], [bw - 0.18, bd - 0.18]]) box3(b, x + ox, 0.4, z + oz, 0.18, h - 1.4, 0.18);
  emissive(b, () => {
    b.setColor(sc(I.paper, 0.75));
    for (let s = x + 0.5; s < x + bw - 0.6; s += 1.1) { box3(b, s, 0.8, z - 0.01, 0.8, 1.2, 0.04); box3(b, s, 0.8, z + bd - 0.03, 0.8, 1.2, 0.04); }
  });
  b.setColor(I.thatch);
  b.loft([[[x - 0.5, h - 1.1, z - 0.5], [x + bw / 2, h + 0.4, z + bd / 2 - 0.4], [x + bw / 2, h + 0.4, z + bd / 2 + 0.4], [x - 0.5, h - 1.1, z + bd + 0.5]],
    [[x + bw + 0.5, h - 1.1, z - 0.5], [x + bw / 2, h + 0.4, z + bd / 2 - 0.4], [x + bw / 2, h + 0.4, z + bd / 2 + 0.4], [x + bw + 0.5, h - 1.1, z + bd + 0.5]]]);
  b.setColor(sc(I.thatch, 0.8));
  b.loft([[[x - 0.5, h - 1.1, z - 0.5], [x + bw + 0.5, h - 1.1, z - 0.5]], [[x + bw / 2, h + 0.4, z + bd / 2 - 0.4], [x + bw / 2, h + 0.4, z + bd / 2 - 0.4]]]);
  b.loft([[[x + bw + 0.5, h - 1.1, z + bd + 0.5], [x - 0.5, h - 1.1, z + bd + 0.5]], [[x + bw / 2, h + 0.4, z + bd / 2 + 0.4], [x + bw / 2, h + 0.4, z + bd / 2 + 0.4]]]);
}

function pagBuilding(ctx, w) {
  if (w.pagoda) return pagodaTower(ctx, w);
  if (w.hall) return hall(ctx, w);
  if (w.belfry) return belfry(ctx, w);
  if (w.kura) return kura(ctx, w);
  if (w.teahouse) return teahouse(ctx, w);
  return ctx.kit.building(ctx.b, w, ctx.rnd, ctx.lamps);
}

function torii(ctx, w) {
  const { b, theme, map } = ctx;
  const I = theme.ink;
  const { x, z, w: pw, h } = w;
  const cx = x + pw / 2, cz = z + pw / 2;
  b.setColor(I.black);
  b.prismY(0, 0.5, cx, cz, 0.42, 0.42, 8);
  b.setColor(I.vermilion);
  b.prismY(0.5, h, cx, cz, 0.3, 0.26, 8);
  // The lintels span to the partner pillar (same x, further south): drawn once, from the northern pillar.
  const mate = map.walls.find(q => q.torii && q !== w && Math.abs(q.x - x) < 0.01 && q.z > z);
  if (!mate) return;
  const z0 = z - 0.9, z1 = mate.z + mate.d + 0.9;
  b.setColor(I.vermilion);
  box3(b, cx - 0.18, h - 0.75, z + 0.1, 0.36, 0.28, mate.z - z + 0.5);
  b.setColor(I.black);
  b.loft([[[cx - 0.26, h + 0.05, z0], [cx - 0.26, h + 0.35, z0 - 0.15], [cx + 0.26, h + 0.35, z0 - 0.15], [cx + 0.26, h + 0.05, z0]],
    [[cx - 0.26, h - 0.1, (z0 + z1) / 2], [cx - 0.26, h + 0.2, (z0 + z1) / 2], [cx + 0.26, h + 0.2, (z0 + z1) / 2], [cx + 0.26, h - 0.1, (z0 + z1) / 2]],
    [[cx - 0.26, h + 0.05, z1], [cx - 0.26, h + 0.35, z1 + 0.15], [cx + 0.26, h + 0.35, z1 + 0.15], [cx + 0.26, h + 0.05, z1]]]);
  b.setColor(I.vermilion);
  box3(b, cx - 0.22, h - 0.15, z0 + 0.1, 0.44, 0.22, z1 - z0 - 0.2);
  b.setColor(I.black);
  box3(b, cx - 0.2, h - 0.62, (z + mate.z) / 2 + 0.2, 0.42, 0.6, 0.5);
}

function mapleTree(ctx, x, z, hgt, cr) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  b.setColor(I.bark);
  b.prismY(0, hgt * 0.5, x, z, 0.24, 0.14, 6, rnd());
  // Layered, spreading crowns in red, orange and a little gold.
  const cols = [I.mapleD, I.maple, rnd() < 0.3 ? I.mapleY : I.mapleO];
  for (let i = 0; i < 3; i++) {
    const y0 = hgt * (0.42 + i * 0.17), r0 = cr * (1 - i * 0.24);
    b.setColor(cols[i]);
    b.prismY(y0, y0 + hgt * 0.2, x + (rnd() - 0.5) * 0.4, z + (rnd() - 0.5) * 0.4, r0, r0 * 0.55, 7, rnd() * 3);
  }
}

function plasterWall(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd;
  b.setColor(I.stoneD);
  box3(b, x - 0.05, 0, z - 0.05, bw + 0.1, 0.5, bd + 0.1);
  b.setColor(I.plaster);
  box3(b, x, 0.5, z, bw, h - 0.9, bd);
  b.setColor(I.timber);
  if (long) box3(b, x, h - 0.65, z - 0.02, bw, 0.12, bd + 0.04); else box3(b, x - 0.02, h - 0.65, z, bw + 0.04, 0.12, bd);
  b.setColor(I.tile);
  if (long) b.loft([[[x - 0.2, h - 0.4, z - 0.3], [x - 0.2, h, z + bd / 2], [x - 0.2, h - 0.4, z + bd + 0.3]], [[x + bw + 0.2, h - 0.4, z - 0.3], [x + bw + 0.2, h, z + bd / 2], [x + bw + 0.2, h - 0.4, z + bd + 0.3]]]);
  else b.loft([[[x + bw + 0.3, h - 0.4, z - 0.2], [x + bw / 2, h, z - 0.2], [x - 0.3, h - 0.4, z - 0.2]], [[x + bw + 0.3, h - 0.4, z + bd + 0.2], [x + bw / 2, h, z + bd + 0.2], [x - 0.3, h - 0.4, z + bd + 0.2]]]);
}

function pagWall(ctx, w) {
  if (w.torii) return torii(ctx, w);
  if (w.maple) return mapleTree(ctx, w.x + w.w / 2, w.z + w.d / 2, w.h + 0.6, 2.2);
  if (w.plaster) return plasterWall(ctx, w);
  return ctx.kit.concreteWall(ctx.b, w);
}

function stoneLantern(ctx, w) {
  const { b, theme } = ctx;
  const I = theme.ink;
  const { x, z, w: lw, h } = w;
  const cx = x + lw / 2, cz = z + lw / 2;
  // Toro: a base, a post, the fire box (lit), a wide cap with a jewel on top.
  b.setColor(I.stoneD);
  b.prismY(0, 0.2, cx, cz, 0.45, 0.4, 6);
  b.setColor(I.stone);
  b.prismY(0.2, h * 0.5, cx, cz, 0.16, 0.16, 6);
  b.prismY(h * 0.5, h * 0.58, cx, cz, 0.3, 0.3, 6);
  emissive(b, () => { b.setColor(I.paper); b.prismY(h * 0.58, h * 0.8, cx, cz, 0.24, 0.24, 6); });
  b.setColor(I.stone);
  b.prismY(h * 0.8, h * 0.92, cx, cz, 0.5, 0.2, 6);
  b.prismY(h * 0.92, h + 0.1, cx, cz, 0.1, 0.03, 6);
}

function pagCrate(ctx, w) {
  if (w.lantern) return stoneLantern(ctx, w);
  return ctx.kit.crate(ctx.b, w, ctx.rnd);
}

function gardenStone(ctx, w) {
  const I = ctx.theme.ink;
  mass(ctx, w.x, w.z, w.w, w.d, w.h, { cols: [I.stone, I.stoneD], levels: 2, taper: 0.3, jit: 0.15 });
  ctx.b.setColor(I.mossL);
  box3(ctx.b, w.x + 0.2, w.h - 0.12, w.z + 0.2, w.w * 0.4, 0.12, w.d * 0.4);
}

function bambooFence(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd, L = long ? bw : bd;
  // Upright canes lashed to two rails, black twine knots.
  for (let s = 0.05; s < L - 0.05; s += 0.12) {
    b.setColor(rnd() < 0.5 ? I.bamboo : I.bambooD);
    if (long) b.prismY(0, h - rnd() * 0.06, x + s, z + bd / 2, 0.05, 0.05, 4); else b.prismY(0, h - rnd() * 0.06, x + bw / 2, z + s, 0.05, 0.05, 4);
  }
  b.setColor(I.bambooD);
  for (const y of [0.35, 0.85]) { if (long) b.prismX(x, x + bw, y, z + bd / 2 + 0.06, 0.05, 0.05, 4); else b.prismZ(z, z + bd, x + bw / 2 + 0.06, y, 0.05, 0.05, 4); }
}

function pondBank(ctx, w) {
  const { b, theme, rnd } = ctx;
  const I = theme.ink;
  waterBanks(ctx, w, { face: sc(I.stoneD, 0.7), lip: I.stone, lip2: I.mossL, t: 0.32 });
  // Lily pads and koi just under the surface, the koi lit faintly so they read at dusk.
  for (let i = 0; i < 5; i++) {
    b.setColor(I.lily);
    b.prismY(WATER_Y + 0.03, WATER_Y + 0.05, w.x + 0.5 + rnd() * (w.w - 1), w.z + 0.5 + rnd() * (w.d - 1), 0.25 + rnd() * 0.15, 0.25, 7, rnd() * 3);
  }
  emissive(b, () => {
    for (let i = 0; i < 3; i++) {
      b.setColor(sc(i % 2 ? I.koi : I.paper, 0.55));
      const kx = w.x + 0.6 + rnd() * (w.w - 1.2), kz = w.z + 0.6 + rnd() * (w.d - 1.2), a = rnd() * 3;
      b.quad([kx - Math.cos(a) * 0.3, WATER_Y + 0.02, kz - Math.sin(a) * 0.3], [kx - Math.sin(a) * 0.08, WATER_Y + 0.02, kz + Math.cos(a) * 0.08], [kx + Math.cos(a) * 0.3, WATER_Y + 0.02, kz + Math.sin(a) * 0.3], [kx + Math.sin(a) * 0.08, WATER_Y + 0.02, kz - Math.cos(a) * 0.08]);
    }
  });
}

// Perimeter: the temple's enclosure wall, white plaster under a tiled cap.
function pagBorder(ctx, w) {
  plasterWall(ctx, { x: w.x, z: w.z, w: w.w, d: w.d, h: w.z > ctx.H ? 1.9 : 2.6 });
}

// ---- Decor -----------------------------------------------------------------------------------------------------

function pagDecor(ctx) {
  const { b, W, H, rnd, theme } = ctx;
  const I = theme.ink;
  // The hillside forest beyond the wall: dark cedars behind, maples in front, lower to the south (camera side).
  for (const [x, z] of rimPoints(ctx, 34, 4, 18)) {
    const south = z > H;
    if (rnd() < 0.45) mapleTree(ctx, x, z, (south ? 3.4 : 5) + rnd() * 2, 1.8 + rnd());
    else {
      b.setColor(rnd() < 0.5 ? I.cedar : I.cedarD);
      b.prismY(0, (south ? 5 : 9) + rnd() * 4, x, z, 1.4 + rnd() * 0.6, 0.1, 6, rnd() * 3);
    }
  }
  // A roofed temple gate in the north wall, out of reach, and distant ridges against the dusk.
  b.setColor(I.vermilion);
  for (const ox of [-1.6, 1.4]) box3(b, W * 0.3 + ox, 0, -2.6, 0.3, 3, 0.3);
  hipRoof(b, I, W * 0.3 - 2, -3.2, 4, 1.4, 3, 0.9, 0.5, 0.3);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2, R = 90 + rnd() * 30;
    b.setColor(mix([0.16, 0.18, 0.28], theme.fog, 0.4));
    b.prismY(-4, 10 + rnd() * 14, W / 2 + Math.cos(a) * R * 1.25, H / 2 + Math.sin(a) * R, 18 + rnd() * 10, 1.5, 5, rnd() * 3);
  }
  skyRing(ctx, { low: [0.18, 0.2, 0.32], mid: [0.26, 0.3, 0.5], warm: [0.78, 0.46, 0.4], high: [0.08, 0.1, 0.22], warmDir: [-1, 0.1], y0: -4, y1: 12, y2: 60 });
}

export const pagoda = {
  dress: {
    building: pagBuilding, wall: pagWall, crate: pagCrate, boulder: gardenStone, barrier: bambooFence, water: pondBank,
    border: pagBorder,
  },
  stage: { lights: pagLights, ground: pagGround, paint: pagPaint, decor: pagDecor },
  thumb: { ground: '#56603e', solid: '#c4bcae', low: '#8a8a52', water: '#18263c', edge: '#121628' },
};
