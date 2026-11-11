// Industrial region: the shared skyline (stacks, cooling towers, gas holders with their aviation lamps) and Foundry's
// theme. world.js reads `foundry` ({ dress, stage, thumb }) into its tables and hands every drawer ctx.kit (box3,
// emissive, scale and the shared railyard drawers), because this module cannot import world.js back.
import { THEMES, hexRGB } from '../art.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ink = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexRGB(v)]));

// Foundry: a steel mill at the end of the night shift. Cold blue moonlight from the north-east, sodium pools over the
// rail lanes and the furnace's orange in the middle. Rust and slag, never saturated: the team colours stay the brightest.
THEMES.foundry = {
  id: 'foundry',
  light: { dir: norm([0.45, 0.74, -0.5]), sun: [0.36, 0.42, 0.58], sky: [0.32, 0.34, 0.48], amb: [0.27, 0.27, 0.35] },
  clear: 0x0d0e14,
  fog: [0.3, 0.3, 0.42], fogSeam: [0.2, 0.08, 0.02], desatTint: [0.78, 0.76, 0.86],
  shadow: { col: [0.32, 0.32, 0.48], strength: 0.52, len: 0.8 },
  lamp: [0.44, 0.28, 0.1],
  ink: ink({
    ground: 0x58554f, asphalt: 0x48464a, dirt: 0x4a3e36, gravel: 0x5e5852,
    roof: 0x4a5058, wall: 0x6a6460, wallB: 0x5c6068, trim: 0x2e2c30,
    concrete: 0x7c7872, crate: 0x8a6a44, crateD: 0x54402a,
    rail: 0x8c929a, tie: 0x3c322a, hazardY: 0xc0922a, hazardK: 0x222228,
    paint: 0xc8b48a, glow: 0xffc27a, glowCool: 0xc4d8ff,
    rust: 0x7e4a30, rustD: 0x5a3424, steel: 0x6a7280, steelD: 0x40464f, crane: 0xc8961e, brick: 0x6e3c30,
    ore: 0x5e3e2e, coal: 0x2a282c, slag: 0x5a5048, belt: 0x26262a, hot: 0xff8a32, red: 0x8a3030, white: 0xc4c0b6,
  }),
  containers: [0x6e4232, 0x4a5a6a, 0x5a5444],
  weather: { fields: [
    { kind: 'mote', count: 70, box: [40, 8, 30], vel: [0.3, 0.9, 0.2], size: 0.08, col: [1.0, 0.6, 0.25], alpha: 0.6 },
    { kind: 'mote', count: 24, box: [48, 3, 36], vel: [0.6, 0.05, 0.2], size: 4.4, col: [0.5, 0.48, 0.56], alpha: 0.06 },
  ] },
};

// ---- Shared skyline ----------------------------------------------------------------------------------------------

// Works on the horizon: a ring of chimneys, cooling towers and gas holders well outside the map, each stack topped by
// a red aviation lamp. `y` is the ground they stand on (a rooftop map stands them far below), `dist` how far out.
export function skyline(ctx, { y = 0, dist = 26, count = 9, tint = 1 } = {}) {
  const { b, glow, W, H, rnd, kit } = ctx;
  const dark = [0.14 * tint, 0.14 * tint, 0.18 * tint], mid = [0.2 * tint, 0.19 * tint, 0.22 * tint];
  for (let i = 0; i < count; i++) {
    // Mostly north (top of the screen, where the camera looks), a few to the sides.
    const t = (i + 0.5) / count;
    const side = i % 4 === 3 ? (i % 8 === 3 ? 'west' : 'east') : 'north';
    const x = side === 'north' ? -20 + t * (W + 40) : side === 'west' ? -dist - rnd() * 10 : W + dist + rnd() * 10;
    const z = side === 'north' ? -dist - rnd() * 14 : rnd() * H;
    const kind = i % 3;
    if (kind === 0) {
      const hgt = 18 + rnd() * 10;
      b.setColor(mid);
      b.prismY(y, y + hgt, x, z, 1.3, 0.9, 7);
      b.setColor([0.42, 0.18, 0.15].map(c => c * tint));
      b.prismY(y + hgt - 2.4, y + hgt - 1.6, x, z, 0.96, 0.94, 7);
      kit.emissive(b, () => { b.setColor([1, 0.16, 0.12]); b.prismY(y + hgt + 0.1, y + hgt + 0.5, x, z, 0.3, 0.3, 5); });
      glow.halo(x, z, 2.2, [0.12, 0.02, 0.01], y + hgt + 0.3, 8);
    } else if (kind === 1) {
      const r = 5 + rnd() * 2, hgt = 14 + rnd() * 4;
      b.setColor(dark);
      b.loft([ring(x, y, z, r, 10), ring(x, y + hgt * 0.6, z, r * 0.68, 10), ring(x, y + hgt, z, r * 0.78, 10)]);
    } else {
      const r = 6 + rnd() * 2, hgt = 7 + rnd() * 4;
      b.setColor(dark);
      b.prismY(y, y + hgt, x, z, r, r, 12);
      b.setColor(mid);
      for (let k = 1; k < 4; k++) b.prismY(y + (hgt * k) / 4 - 0.15, y + (hgt * k) / 4 + 0.15, x, z, r + 0.15, r + 0.15, 12);
    }
  }
}

function ring(x, y, z, r, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r]); }
  return out;
}

// ---- Foundry -----------------------------------------------------------------------------------------------------

const HALL = { x0: 40, x1: 64, z0: 24, z1: 40 };      // The casting hall's footprint: steel floor plates inside.

function foundryGround(ctx) {
  const { map, noise, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const rails = (map.decor || []).find(d => d.type === 'rails')?.z ?? [];
  return p => {
    const [x, , z] = p;
    const k = 0.88 + noise(x * 0.7, z * 0.7) * 0.2 + (rnd() - 0.5) * 0.05;
    if (x < 0 || z < 0 || x > W || z > H) return I.slag.map(c => c * k * 0.7);
    if (rails.some(r => Math.abs(z - r) < 1.4)) return I.gravel.map(c => c * k * 0.92);
    if (x > HALL.x0 && x < HALL.x1 && z > HALL.z0 && z < HALL.z1) return ((Math.floor(x / 2) + Math.floor(z / 2)) % 2 ? I.steelD : I.asphalt).map(c => c * k);
    if (noise(x * 0.16 + 7, z * 0.16) > 0.62) return I.dirt.map(c => c * k);
    return I.ground.map(c => c * k);
  };
}

function foundryPaint(ctx) {
  const { b, map, rnd, W, H, theme } = ctx;
  const I = theme.ink;
  const rails = (map.decor || []).find(d => d.type === 'rails')?.z ?? [];
  // Track: sleepers then the two rails, the length of the map and out past both ends.
  for (const zc of rails) {
    b.setColor(I.tie);
    for (let x = -24; x < W + 24; x += 0.75) b.groundRect(x, zc - 1.05, 0.26, 2.1, 0.05);
    b.setColor(I.rail);
    for (const o of [-0.72, 0.65]) b.groundRect(-24, zc + o, W + 48, 0.08, 0.1);
  }
  // Yellow walkway lines either side of the conveyor and around the hall doors.
  for (const w of map.walls) {
    if (!w.conveyor) continue;
    b.setColor(I.hazardY.map(c => c * 0.75));
    for (let x = w.x; x < w.x + w.w; x += 0.9) { b.groundRect(x, w.z - 0.9, 0.5, 0.1, 0.06); b.groundRect(x, w.z + w.d + 0.8, 0.5, 0.1, 0.06); }
  }
  // Oil and scale patches.
  for (let i = 0; i < 30; i++) {
    const x = 2 + rnd() * (W - 4), z = 2 + rnd() * (H - 4);
    b.setColor(i % 2 ? I.coal : I.rustD);
    b.groundRect(x, z, 0.6 + rnd() * 1.2, 0.5 + rnd() * 0.9, 0.04);
  }
}

function foundryLights(ctx) {
  const { map, lamps, glow, W, H } = ctx;
  const sodium = [1, 0.62, 0.26];
  // Sodium lamps over the rail lanes and the yards, the furnace's glow in the middle.
  ctx.lampPosts = [];
  const free = (x, z) => !map.walls.some(w => x > w.x - 0.8 && x < w.x + w.w + 0.8 && z > w.z - 0.8 && z < w.z + w.d + 0.8);
  for (let x = 12; x < W - 6; x += 15) {
    for (const z of [0.7, H - 0.7]) {
      const xx = z < 1 ? x : W - x;
      if (!free(xx, z)) continue;
      ctx.lampPosts.push([xx, z]);
      lamps.push({ x: xx, z: z < 1 ? z + 3 : z - 3, r: 9 });
      glow.halo(xx, z < 1 ? z + 3 : z - 3, 5, sodium.map(c => c * 0.08));
    }
  }
  for (const w of map.walls) {
    if (w.furnace) {
      const cx = w.x + w.w / 2, cz = w.z + w.d;
      lamps.push({ x: cx, z: cz + 1.5, r: 9, col: [0.62, 0.3, 0.08] });
      glow.halo(cx, cz + 1.2, 6, [0.22, 0.09, 0.02]);
      lamps.push({ x: cx, z: w.z - 1.5, r: 7, col: [0.5, 0.24, 0.06] });
    }
    if (w.ladle) lamps.push({ x: w.x + w.w / 2, z: w.z + w.d / 2, r: 5, col: [0.5, 0.22, 0.05] });
    if (w.cabin) lamps.push({ x: w.x + w.w / 2, z: w.z + w.d + 1, r: 5 });
  }
  for (const [x, z] of [[27, 19.5], [W - 27, H - 19.5], [27, 44], [W - 27, H - 44]]) { lamps.push({ x, z, r: 8 }); glow.halo(x, z, 4, sodium.map(c => c * 0.06)); }
  // Yard lamps over both spawn ends, so a player's first look at the mill is not into the dark.
  for (const z of [16, 30, 46]) {
    for (const [x, zz] of [[6.5, z], [W - 6.5, H - z]]) {
      if (!free(x, zz)) continue;
      ctx.lampPosts.push([x, zz]);
      const into = zz < H / 2 ? 1 : -1;
      lamps.push({ x, z: zz + into * 2.6, r: 9 });
      glow.halo(x, zz + into * 2.6, 5, sodium.map(c => c * 0.08));
    }
  }
}

function foundryBuilding(ctx, w) {
  const { b, rnd, theme, kit, lamps } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  if (w.furnace) {
    // Brick hearth under a riveted steel shell, a glowing tap hole facing the camera and a flue up through the roof.
    b.setColor(I.brick);
    kit.box3(b, x, 0, z, bw, 1.6, bd);
    b.setColor(I.steelD);
    kit.box3(b, x + 0.3, 1.6, z + 0.3, bw - 0.6, h - 1.6, bd - 0.6);
    b.setColor(I.rust);
    for (let y = 2.4; y < h; y += 1) kit.box3(b, x + 0.25, y, z + 0.25, bw - 0.5, 0.12, bd - 0.5);
    b.setColor(I.steel);
    b.prismY(h, h + 5, x + bw * 0.3, z + bd * 0.5, 1.1, 0.9, 8);
    b.prismY(h, h + 3.2, x + bw * 0.72, z + bd * 0.4, 0.7, 0.6, 6);
    kit.emissive(b, () => {
      b.setColor(I.hot);
      kit.box3(b, x + bw / 2 - 0.9, 0.3, z + bd + 0.02, 1.8, 1.0, 0.05);
      kit.box3(b, x + bw / 2 - 0.7, 0.3, z - 0.07, 1.4, 0.8, 0.05);
      b.setColor(I.hot.map(c => c * 0.65));
      kit.box3(b, x + bw / 2 - 0.25, 0.02, z + bd + 0.05, 0.5, 0.03, 1.6);     // Runner channel.
      b.setColor([1, 0.2, 0.12]);
      b.prismY(h + 5, h + 5.3, x + bw * 0.3, z + bd * 0.5, 0.25, 0.25, 5);
    });
    ctx.glow.streak(x + bw / 2, z + bd + 0.2, 2.4, 4.5, [0.32, 0.12, 0.03], 0.12);
    return;
  }
  if (w.stack) {
    // The works chimney: round, banded, with lamps at the top. Solid, so it is a pillar to fight around.
    const cx = x + bw / 2, cz = z + bd / 2;
    b.setColor(I.brick);
    b.prismY(0, h + 10, cx, cz, bw * 0.5, bw * 0.36, 10);
    b.setColor(I.white);
    for (const y of [h + 4, h + 8]) b.prismY(y, y + 0.7, cx, cz, bw * 0.5 - (y / (h + 10)) * bw * 0.17 + 0.03, bw * 0.48 - (y / (h + 10)) * bw * 0.17 + 0.03, 10);
    b.setColor(I.concrete);
    kit.box3(b, x - 0.2, 0, z - 0.2, bw + 0.4, 0.9, bd + 0.4);
    kit.emissive(b, () => { b.setColor([1, 0.16, 0.12]); b.prismY(h + 10, h + 10.4, cx, cz, 0.3, 0.3, 5); });
    return;
  }
  if (w.cabin) {
    // Portable cabin on blocks, lit windows, a stair.
    b.setColor(I.white.map(c => c * 0.8));
    kit.box3(b, x, 0.25, z, bw, h - 0.45, bd);
    b.setColor(I.trim);
    kit.box3(b, x - 0.05, 0, z - 0.05, bw + 0.1, 0.25, bd + 0.1);
    b.setColor(I.roof);
    kit.box3(b, x - 0.1, h - 0.2, z - 0.1, bw + 0.2, 0.2, bd + 0.2);
    kit.emissive(b, () => {
      b.setColor(I.glow.map(c => c * 0.8));
      for (let i = 0.5; i < bw - 0.9; i += 1.6) kit.box3(b, x + i, h * 0.45, z + bd + 0.02, 0.9, 0.6, 0.04);
    });
    b.setColor(I.hazardY);
    kit.box3(b, x + bw - 0.9, 0, z + bd, 0.8, 0.25, 0.5);
    return;
  }
  kit.building(b, w, rnd, lamps);
}

function foundryContainer(ctx, w) {
  const { b, rnd, theme, kit } = ctx;
  const I = theme.ink;
  const { x, z, w: cw, d: cd, h } = w;
  if (w.wagon) {
    // Ore hopper wagon: a flared rusty body on two bogies, ore heaped in the top.
    b.setColor(I.coal);
    for (const bx of [x + 0.6, x + cw - 2.2]) kit.box3(b, bx, 0, z + 0.25, 1.6, 0.7, cd - 0.5);
    b.setColor(I.steelD);
    kit.box3(b, x, 0.7, z + 0.1, cw, 0.2, cd - 0.2);
    b.setColor(rnd() < 0.5 ? I.rust : I.rustD);
    b.loft([
      [[x, 0.9, z + 0.25], [x - 0.05, h - 0.1, z - 0.02], [x - 0.05, h - 0.1, z + cd + 0.02], [x, 0.9, z + cd - 0.25]],
      [[x + cw, 0.9, z + 0.25], [x + cw + 0.05, h - 0.1, z - 0.02], [x + cw + 0.05, h - 0.1, z + cd + 0.02], [x + cw, 0.9, z + cd - 0.25]],
    ]);
    b.setColor(I.rustD);
    for (let i = 0.8; i < cw - 0.4; i += 1.4) kit.box3(b, x + i, 1.0, z + cd - 0.02, 0.12, h - 1.2, 0.06);
    b.setColor(I.ore);
    b.loft([
      [[x + 0.2, h - 0.15, z + 0.15], [x + 0.2, h + 0.35, z + cd / 2], [x + 0.2, h - 0.15, z + cd - 0.15]],
      [[x + cw - 0.2, h - 0.15, z + 0.15], [x + cw - 0.2, h + 0.35, z + cd / 2], [x + cw - 0.2, h - 0.15, z + cd - 0.15]],
    ]);
    return;
  }
  if (w.slab) {
    // Stacked steel slabs, each a little off the one below; the top one still warm.
    const n = Math.max(3, Math.round(h / 0.42)), t = h / n;
    for (let i = 0; i < n; i++) {
      const j = (rnd() - 0.5) * 0.16;
      b.setColor(i % 2 ? I.steel : I.steelD);
      kit.box3(b, x + 0.05 + j, i * t, z + 0.05 - j, cw - 0.1, t - 0.04, cd - 0.1);
    }
    kit.emissive(b, () => { b.setColor(I.hot.map(c => c * 0.38)); kit.box3(b, x + 0.3, h - 0.02, z + 0.3, cw - 0.6, 0.03, cd - 0.6); });
    return;
  }
  if (w.ladle) {
    // Ladle car: a rail car carrying a big steel bucket of molten iron.
    b.setColor(I.coal);
    kit.box3(b, x, 0, z, cw, 0.6, cd);
    b.setColor(I.steelD);
    b.prismY(0.6, h - 0.1, x + cw / 2, z + cd / 2, Math.min(cw, cd) * 0.38, Math.min(cw, cd) * 0.5, 10);
    b.setColor(I.rust);
    b.prismY(h - 0.4, h - 0.1, x + cw / 2, z + cd / 2, Math.min(cw, cd) * 0.52, Math.min(cw, cd) * 0.52, 10);
    kit.emissive(b, () => { b.setColor(I.hot); b.prismY(h - 0.12, h - 0.08, x + cw / 2, z + cd / 2, Math.min(cw, cd) * 0.44, Math.min(cw, cd) * 0.44, 10); });
    ctx.glow.halo(x + cw / 2, z + cd / 2, 2.6, [0.16, 0.06, 0.01], h + 0.1, 10);
    return;
  }
  kit.container(b, w, rnd);
}

function foundryCrate(ctx, w) {
  const { b, rnd, theme, kit } = ctx;
  const I = theme.ink;
  if (!w.coil) return kit.crate(b, w, rnd);
  // Steel coils lying on their sides in a cradle, eyes facing east-west.
  const { x, z, w: cw, d: cd, h } = w;
  b.setColor(I.coal);
  kit.box3(b, x, 0, z, cw, 0.14, cd);
  const n = cd > 1.7 ? 2 : 1, r = Math.min(h / 2, cd / n / 2);
  for (let i = 0; i < n; i++) {
    const cz = z + (cd / n) * (i + 0.5);
    b.setColor(i % 2 ? I.steel : I.steel.map(c => c * 1.1));
    b.prismX(x + 0.05, x + cw - 0.05, r + 0.08, cz, r, r, 10);
    b.setColor(I.coal);
    b.prismX(x + 0.02, x + 0.06, r + 0.08, cz, r * 0.38, r * 0.38, 8);
    b.prismX(x + cw - 0.06, x + cw - 0.02, r + 0.08, cz, r * 0.38, r * 0.38, 8);
    b.setColor(I.rust);
    b.prismX(x + cw * 0.3, x + cw * 0.36, r + 0.08, cz, r + 0.02, r + 0.02, 10);
  }
}

function foundryBarrier(ctx, w) {
  const { b, rnd, theme, kit } = ctx;
  const I = theme.ink;
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd;
  if (w.conveyor) {
    // Belt conveyor: steel frame on legs, rollers, the belt and a scatter of ore on it.
    b.setColor(I.steelD);
    for (let s = 0.2; s < bw; s += 1.6) for (const zz of [z + 0.05, z + bd - 0.17]) kit.box3(b, x + s, 0, zz, 0.12, h - 0.25, 0.12);
    b.setColor(I.crane);
    kit.box3(b, x, h - 0.32, z, bw, 0.16, 0.12);
    kit.box3(b, x, h - 0.32, z + bd - 0.12, bw, 0.16, 0.12);
    b.setColor(I.belt);
    kit.box3(b, x, h - 0.2, z + 0.12, bw, 0.08, bd - 0.24);
    b.setColor(I.ore);
    for (let s = 0.3; s < bw - 0.3; s += 0.5 + rnd() * 0.6) kit.box3(b, x + s, h - 0.12, z + 0.25 + rnd() * (bd - 0.7), 0.25, 0.14, 0.22);
    b.setColor(I.steel);
    for (let s = 0.4; s < bw; s += 0.8) b.prismZ(z + 0.12, z + bd - 0.12, x + s, h - 0.32, 0.06, 0.06, 5);
    return;
  }
  if (w.moulds) {
    // Ingot moulds in a row, the last pour still glowing.
    b.setColor(I.coal);
    kit.box3(b, x, 0, z, bw, h - 0.2, bd);
    const n = Math.max(2, Math.round(bw / 0.7));
    for (let i = 0; i < n; i++) {
      const mx = x + (bw / n) * i + 0.08;
      if (i < n / 2) kit.emissive(b, () => { b.setColor(I.hot.map(c => c * 0.75)); kit.box3(b, mx, h - 0.2, z + 0.15, bw / n - 0.16, 0.05, bd - 0.3); });
      else { b.setColor(I.steel); kit.box3(b, mx, h - 0.2, z + 0.15, bw / n - 0.16, 0.05, bd - 0.3); }
    }
    return;
  }
  if (w.buffer) {
    // Buffer stop: a red and white sleeper frame with two buffers facing down the track.
    b.setColor(I.red);
    kit.box3(b, x, 0, z, bw, h, bd);
    b.setColor(I.white);
    for (let s = 0.2; s < bd; s += 0.6) kit.box3(b, x - 0.02, h * 0.55, z + s, bw + 0.04, 0.25, 0.3);
    b.setColor(I.steel);
    for (const zz of [z + 0.4, z + bd - 0.4]) b.prismX(x + bw, x + bw + 0.4, h * 0.6, zz, 0.18, 0.18, 6);
    return;
  }
  if (w.sleepers) {
    // A stack of timber sleepers, crossways in alternate layers.
    const n = Math.max(2, Math.round(h / 0.22));
    for (let i = 0; i < n; i++) {
      b.setColor(i % 2 ? I.tie : I.tie.map(c => c * 1.25));
      const y = i * (h / n), t = h / n - 0.02;
      if (i % 2) for (let s = 0.05; s < bw - 0.2; s += 0.42) kit.box3(b, x + s, y, z, 0.3, t, bd);
      else for (let s = 0.05; s < bd - 0.2; s += 0.42) kit.box3(b, x, y, z + s, bw, t, 0.3);
    }
    return;
  }
  kit.barrier(b, w);
  void long;
}

function foundryWall(ctx, w) {
  const { b, theme, kit, rnd } = ctx;
  const I = theme.ink;
  const { x, z, w: ww, d: wd, h } = w;
  const long = ww >= wd, L = Math.max(ww, wd);
  if (w.hall) {
    // Casting hall: corrugated steel cladding on a concrete plinth, I-beam columns, a hazard band at the door height.
    b.setColor(I.concrete.map(c => c * 0.8));
    kit.box3(b, x, 0, z, ww, 0.8, wd);
    b.setColor(I.wallB);
    kit.box3(b, x, 0.8, z, ww, h - 0.8, wd);
    b.setColor(I.wallB.map(c => c * 1.16));
    for (let s = 0.2; s < L; s += 0.5) {
      if (long) { kit.box3(b, x + s, 0.8, z - 0.04, 0.12, h - 1, 0.04); kit.box3(b, x + s, 0.8, z + wd, 0.12, h - 1, 0.04); }
      else { kit.box3(b, x - 0.04, 0.8, z + s, 0.04, h - 1, 0.12); kit.box3(b, x + ww, 0.8, z + s, 0.04, h - 1, 0.12); }
    }
    b.setColor(I.crane);
    for (const s of [0, L - 0.35]) {
      if (long) kit.box3(b, x + s, 0, z - 0.1, 0.35, h + 0.3, wd + 0.2);
      else kit.box3(b, x - 0.1, 0, z + s, ww + 0.2, h + 0.3, 0.35);
    }
    b.setColor(I.roof);
    kit.box3(b, x - 0.1, h - 0.1, z - 0.1, ww + 0.2, 0.2, wd + 0.2);
    return;
  }
  if (w.bunker) {
    // Ore bunker wall: thick concrete, stained, ore spilling at its foot (render only, inside the bay).
    b.setColor(I.concrete.map(c => c * 0.85));
    kit.box3(b, x, 0, z, ww, h, wd);
    b.setColor(I.rustD);
    kit.box3(b, x - 0.03, h - 0.5, z - 0.03, ww + 0.06, 0.12, wd + 0.06);
    b.setColor(I.ore);
    for (let s = 0.4; s < L - 0.4; s += 1.1) {
      const r = 0.3 + rnd() * 0.25;
      if (long) b.prismY(0, r, x + s, z + wd + r, r * 1.6, 0.05, 6);
      else b.prismY(0, r, x + ww + r, z + s, r * 1.6, 0.05, 6);
    }
    return;
  }
  kit.concreteWall(b, w);
}

// Gantry crane leg: a yellow steel box column on a footing, with a ladder.
function gantryLeg(ctx, w) {
  const { b, theme, kit } = ctx;
  const I = theme.ink;
  b.setColor(I.concrete.map(c => c * 0.8));
  kit.box3(b, w.x - 0.15, 0, w.z - 0.15, w.w + 0.3, 0.4, w.d + 0.3);
  b.setColor(I.crane);
  kit.box3(b, w.x + 0.1, 0.4, w.z + 0.1, w.w - 0.2, w.h - 0.4, w.d - 0.2);
  b.setColor(I.hazardK);
  for (let y = 0.6; y < 2.2; y += 0.5) kit.box3(b, w.x + 0.05, y, w.z + 0.05, w.w - 0.1, 0.2, w.d - 0.1);
  b.setColor(I.steelD);
  for (let y = 0.6; y < w.h; y += 0.35) kit.box3(b, w.x + w.w / 2 - 0.2, y, w.z + w.d, 0.4, 0.04, 0.12);
}

// Perimeter: a corrugated fence on steel posts, with shed bays beyond it.
function foundryBorder(ctx, w) {
  const { b, theme, kit, rnd } = ctx;
  const I = theme.ink;
  b.setColor(I.wall.map(c => c * 0.6));
  kit.box3(b, w.x, 0, w.z, w.w, w.h, w.d);
  const long = w.w > w.d, L = long ? w.w : w.d;
  b.setColor(I.steelD);
  for (let s = 0; s < L; s += 4) {
    if (long) kit.box3(b, w.x + s, 0, w.z - 0.15, 0.3, w.h + 0.3, w.d + 0.3);
    else kit.box3(b, w.x - 0.15, 0, w.z + s, w.w + 0.3, w.h + 0.3, 0.3);
  }
  // Mill sheds beyond the fence, low on the camera side (south) so they never hide the fight.
  b.setColor(I.wallB.map(c => c * 0.5));
  for (let s = 2; s < L - 6; s += 13) {
    const hh = w.z > ctx.H ? 3 : 8 + rnd() * 4;
    if (long) kit.box3(b, w.x + s, 0, w.z < 0 ? w.z - 10 : w.z + w.d + 1, 10, hh, 9);
    else kit.box3(b, w.x < 0 ? w.x - 10 : w.x + w.w + 1, 0, w.z + s, 9, Math.min(hh, 6), 10);
  }
}

function gantryBridge(ctx, d) {
  const { b, theme, kit, glow, lamps } = ctx;
  const I = theme.ink;
  const top = 6;
  b.setColor(I.crane);
  for (const z of [d.z0, d.z1]) kit.box3(b, d.x0 - 0.3, top, z - 0.35, d.x1 - d.x0 + 0.6, 0.8, 0.7);
  // The crab runs between the girders on two cross beams, its hook carrying a coil over the stacks.
  const cx = d.x0 + (d.x1 - d.x0) * 0.62;
  b.setColor(I.crane.map(c => c * 0.85));
  kit.box3(b, cx - 1.2, top + 0.1, d.z0, 0.5, 0.5, d.z1 - d.z0);
  kit.box3(b, cx + 0.7, top + 0.1, d.z0, 0.5, 0.5, d.z1 - d.z0);
  const hz = (d.z0 + d.z1) / 2;
  b.setColor(I.steelD);
  kit.box3(b, cx - 1.0, top + 0.3, hz - 1, 2, 0.9, 2);
  b.setColor(I.coal);
  kit.box3(b, cx - 0.03, 4.1, hz - 0.03, 0.06, top - 4.1, 0.06);
  b.setColor(I.steel);
  b.prismX(cx - 0.8, cx + 0.8, 3.6, hz, 0.55, 0.55, 10);
  kit.emissive(b, () => { b.setColor(I.glow); kit.box3(b, cx - 0.4, top - 0.06, hz - 0.4, 0.8, 0.05, 0.8); });
  lamps.push({ x: cx, z: hz, r: 6 });
  glow.halo(cx, hz, 3.5, [0.08, 0.05, 0.02]);
}

function foundryDecor(ctx) {
  const { b, map, W, H, theme, kit, glow } = ctx;
  const I = theme.ink;
  for (const d of map.decor || []) if (d.type === 'gantry') gantryBridge(ctx, d);
  // Lamp posts along the rail lanes.
  for (const [x, z] of ctx.lampPosts || []) {
    const into = z < H / 2 ? 1 : -1;
    b.setColor(I.steelD);
    b.prismY(0, 5.2, x, z, 0.12, 0.09, 6);
    kit.box3(b, x - 0.06, 5.1, Math.min(z, z + into * 2.6), 0.12, 0.1, 2.6);
    kit.emissive(b, () => { b.setColor([1, 0.74, 0.4]); kit.box3(b, x - 0.25, 4.98, z + into * 2.6 - 0.3, 0.5, 0.1, 0.6); });
  }
  // Ore heaps in the bunker bays, steam over the hall roof line.
  for (const w of map.walls) {
    if (!w.bunker) continue;
    const next = map.walls.find(o => o.bunker && o !== w && Math.abs(o.z - w.z) < 0.01 && o.x > w.x && o.x - w.x < 9);
    if (!next) continue;
    const cx = (w.x + w.w + next.x) / 2, cz = w.z < H / 2 ? w.z + 2.5 : w.z + w.d - 2.5;
    b.setColor(I.ore);
    b.prismY(0, 1.2, cx, cz, (next.x - w.x - w.w) / 2 - 0.4, 0.4, 7);
  }
  glow.halo(W / 2, H / 2, 9, [0.1, 0.04, 0.01], 0.15, 16);
  skyline(ctx, { dist: 30, count: 10 });
  kit.skyRing(ctx, { low: [0.06, 0.06, 0.1], mid: [0.14, 0.12, 0.18], warm: [0.36, 0.18, 0.08], high: [0.04, 0.04, 0.08], warmDir: [0, -1], y0: -4, y1: 10, y2: 60 });
}

export const foundry = {
  dress: { building: foundryBuilding, container: foundryContainer, crate: foundryCrate, barrier: foundryBarrier, wall: foundryWall, crane: gantryLeg, border: foundryBorder },
  stage: { lights: foundryLights, ground: foundryGround, paint: foundryPaint, decor: foundryDecor },
  thumb: { ground: '#58554f', solid: '#5c6068', low: '#8a6a44', edge: '#16161c' },
};
