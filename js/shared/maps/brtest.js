// Battle royale TEST map (dev stand-in, docs/BR.md): a procedural 400 x 400 m farmland grid that meets the map contract
// (br.pois, br.loot, br.chests, br.drop, br.circleBias) so the mode can be built and tested before the real giant map
// lands. Built from a fixed seed, so every phone builds the same world. Swap: register the real map with
// `modes: ['br', 'brduo', 'brsolo']` and drop this one from js/shared/map.js (see docs/BR.md, "Swapping the map").
//
// Layout: 9 x 9 blocks of 32 m between 8 m lanes. POI blocks are hamlets of roofless plank and stone shells (most loot
// is indoors, which is where fights happen); the rest are fields, paddocks, orchards, hay yards and ponds.
import { wall, perimeter, navGrid } from './build.js';

const SIZE = 400, PITCH = 40, STREET = 8, BLOCK = PITCH - STREET;
const N = Math.floor((SIZE - STREET) / PITCH);           // 9 blocks a side.
const OFF = (SIZE - N * PITCH) / 2 + STREET / 2;          // 24: first block's west edge.

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Named places: block column, row, tier (1 best loot, 3 sparse).
const POIS = [
  ['kettle', 'Kettle Yard', 4, 4, 1], ['ironworks', 'Ironworks', 1, 2, 1], ['dockside', 'Dockside', 7, 6, 1],
  ['mill', 'Old Mill', 2, 6, 2], ['signal', 'Signal Hill', 6, 1, 2], ['grain', 'Grainhouse', 1, 7, 2],
  ['lantern', 'Lantern Row', 7, 2, 2], ['chapel', 'Chapel Green', 4, 7, 2], ['depot', 'Depot', 4, 1, 2],
  ['pump', 'Pumpstation', 6, 4, 2], ['quarry', 'Quarry', 0, 0, 3], ['fair', 'Fairground', 8, 8, 3],
  ['salt', 'Saltmarsh', 8, 4, 3], ['crossing', 'Crossing', 1, 4, 3],
];
const SHELLS_BY_TIER = { 1: 4, 2: 3, 3: 2 };
const CHESTS_BY_TIER = { 1: 3, 2: 2, 3: 1 };

function build() {
  const rnd = mulberry(1111);
  const walls = [], rooms = [], loot = [], chests = [];
  const T = 0.5;                       // Shell wall thickness.

  for (let by = 0; by < N; by++) for (let bx = 0; bx < N; bx++) {
    const x0 = OFF + bx * PITCH, z0 = OFF + by * PITCH;
    const poi = POIS.find(p => p[2] === bx && p[3] === by);
    const local = [];                  // This block's footprints, for spacing.
    const free = (x, z, w, d, m = 1.2) => x >= x0 && z >= z0 && x + w <= x0 + BLOCK && z + d <= z0 + BLOCK
      && !local.some(o => x < o.x + o.w + m && x + w + m > o.x && z < o.z + o.d + m && z + d + m > o.z);
    const put = (x, z, w, d, h, kind, extra) => {
      const r = wall(+x.toFixed(2), +z.toFixed(2), +w.toFixed(2), +d.toFixed(2), h, kind, extra);
      walls.push(r); local.push(r); return r;
    };
    const spot = (tries = 30, m = 0.9) => {
      for (let i = 0; i < tries; i++) {
        const x = x0 + 1.5 + rnd() * (BLOCK - 3), z = z0 + 1.5 + rnd() * (BLOCK - 3);
        if (!local.some(o => x > o.x - m && x < o.x + o.w + m && z > o.z - m && z < o.z + o.d + m)) return { x: +x.toFixed(2), z: +z.toFixed(2) };
      }
      return null;
    };
    const tier = poi ? poi[4] : 3;

    // A roofless shell in one quarter of the block: four walls, two or three doorways, loot inside.
    const shell = (qx, qz, stone) => {
      const w = 9 + rnd() * 4, d = 8 + rnd() * 4;
      const x = x0 + qx * 16 + 1 + rnd() * (15 - w - 1), z = z0 + qz * 16 + 1 + rnd() * (15 - d - 1);
      const flag = stone ? { stone: true } : { plank: true }, h = stone ? 3 : 3.2;
      const doors = [rnd() < 0.7, rnd() < 0.7, rnd() < 0.7, rnd() < 0.7];
      if (doors.filter(Boolean).length < 2) { doors[0] = true; doors[2] = true; }
      const side = (horizontal, sx, sz, len, door) => {
        if (!door) { put(sx, sz, horizontal ? len : T, horizontal ? T : len, h, 'wall', flag); return; }
        const gap = 1.9, a = 1 + rnd() * (len - gap - 2);
        if (horizontal) { put(sx, sz, a, T, h, 'wall', flag); put(sx + a + gap, sz, len - a - gap, T, h, 'wall', flag); }
        else { put(sx, sz, T, a, h, 'wall', flag); put(sx, sz + a + gap, T, len - a - gap, h, 'wall', flag); }
      };
      side(true, x, z, w, doors[0]);                  // North.
      side(true, x, z + d - T, w, doors[2]);          // South.
      side(false, x, z + T, d - 2 * T, doors[3]);     // West.
      side(false, x + w - T, z + T, d - 2 * T, doors[1]);   // East.
      rooms.push({ x, z, w, d, floor: stone ? 'flags' : 'boards' });
      // Low cover inside, away from the walls so doorways stay open.
      if (rnd() < 0.7) put(x + w / 2 - 0.8 + (rnd() - 0.5) * 2, z + d / 2 - 0.8 + (rnd() - 0.5) * 2, 1.6, 1.6, 1.2, 'crate', { bale: true });
      const inner = [];
      for (let k = 0, want = 3 + Math.floor(rnd() * 3); k < 50 && inner.length < want; k++) {
        const px = x + 1.2 + rnd() * (w - 2.4), pz = z + 1.2 + rnd() * (d - 2.4);
        if (local.some(o => px > o.x - 0.8 && px < o.x + o.w + 0.8 && pz > o.z - 0.8 && pz < o.z + o.d + 0.8)) continue;
        if (inner.some(q => Math.hypot(q.x - px, q.z - pz) < 1.8)) continue;
        inner.push({ x: +px.toFixed(2), z: +pz.toFixed(2) });
      }
      for (const q of inner) loot.push({ x: q.x, z: q.z, tier, indoor: true });
      // The whole footprint counts as taken for what comes after.
      local.push({ x, z, w, d });
      return { x, z, w, d, inner };
    };

    let kind;
    if (poi) kind = 'hamlet';
    else {
      const r = rnd();
      kind = r < 0.08 ? 'pond' : r < 0.22 ? 'field' : r < 0.36 ? 'orchard' : r < 0.5 ? 'yard' : 'farm';
    }

    const shells = [];
    if (kind === 'hamlet') {
      const quarters = [[0, 0], [1, 0], [0, 1], [1, 1]].sort(() => rnd() - 0.5).slice(0, SHELLS_BY_TIER[tier]);
      for (const [qx, qz] of quarters) shells.push(shell(qx, qz, rnd() < 0.4));
      for (let k = 0; k < 6; k++) {
        const s = rnd() < 0.5 ? [2.4, 2.4, 2.7, 'container', { hay: true }] : [1.6, 1.6, 1.25, 'crate', { bale: true }];
        const x = x0 + rnd() * (BLOCK - s[0]), z = z0 + rnd() * (BLOCK - s[1]);
        if (free(x, z, s[0], s[1])) put(x, z, ...s);
      }
    } else if (kind === 'pond') {
      put(x0 + 5, z0 + 5, BLOCK - 10, BLOCK - 10, 0, 'water', { pond: true });
    } else if (kind === 'farm') {
      const q = Math.floor(rnd() * 4);
      shells.push(shell(q & 1, q >> 1, rnd() < 0.5));
      if (rnd() < 0.5) shells.push(shell(1 - (q & 1), 1 - (q >> 1), rnd() < 0.5));
      const x = x0 + 2 + rnd() * 10, z = z0 + 2 + rnd() * 10;
      if (free(x, z, 7, 6)) put(x, z, 7, 6, 4.2, 'building', { house: true });
      for (let k = 0; k < 4; k++) {
        const vx = x0 + 1 + rnd() * (BLOCK - 7), vz = z0 + 1 + rnd() * (BLOCK - 1);
        if (free(vx, vz, 6, 0.5, 1.5)) put(vx, vz, 6, 0.5, 1.15, 'barrier', { vine: true });
      }
    } else if (kind === 'orchard') {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        if (rnd() < 0.35) continue;
        const x = x0 + 3 + i * 7.5 + (rnd() - 0.5) * 2, z = z0 + 3 + j * 7.5 + (rnd() - 0.5) * 2;
        if (free(x, z, 1, 1, 1.5)) put(x, z, 1, 1, 4.5, 'wall', { tree: true });
      }
    } else if (kind === 'yard') {
      if (rnd() < 0.6) shells.push(shell(Math.floor(rnd() * 2), Math.floor(rnd() * 2), false));
      for (let k = 0; k < 10; k++) {
        const t = rnd();
        const s = t < 0.3 ? [2.4, 2.4, 2.7, 'container', { hay: true }] : t < 0.5 ? [3.4, 1.9, 2.3, 'container', { tractor: true }]
          : t < 0.8 ? [1.6, 1.6, 1.25, 'crate', { bale: true }] : [4.6, 2.2, 2.4, 'container', { trailer: true }];
        const x = x0 + rnd() * (BLOCK - s[0]), z = z0 + rnd() * (BLOCK - s[1]);
        if (free(x, z, s[0], s[1])) put(x, z, ...s);
      }
    } else {
      // Field: dry-stone dykes and a hedge, low cover to cross under fire.
      for (let k = 0; k < 5; k++) {
        const long = rnd() < 0.5, w = long ? 5 + rnd() * 6 : 0.7, d = long ? 0.7 : 5 + rnd() * 6;
        const x = x0 + rnd() * (BLOCK - w), z = z0 + rnd() * (BLOCK - d);
        if (free(x, z, w, d, 2)) put(x, z, w, d, 1, 'barrier', { stone: true });
      }
      if (rnd() < 0.5) {
        const x = x0 + rnd() * (BLOCK - 8), z = z0 + rnd() * (BLOCK - 1.2);
        if (free(x, z, 8, 1.2, 2)) put(x, z, 8, 1.2, 2.3, 'wall', { hedge: true });
      }
    }

    // Outdoor loot: a few spots in every block, more in a named place.
    const outdoor = kind === 'pond' ? 1 : poi ? 4 : 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < outdoor; k++) {
      const s = kind === 'pond' ? { x: x0 + 2, z: z0 + 2 + rnd() * (BLOCK - 4) } : spot();
      if (s) loot.push({ x: +s.x.toFixed(2), z: +s.z.toFixed(2), tier, indoor: false });
    }
    // Supply caches: inside a shell where there is one.
    const nChest = poi ? CHESTS_BY_TIER[tier] : (kind === 'farm' && rnd() < 0.25 ? 1 : 0);
    for (let k = 0; k < nChest; k++) {
      const sh = shells[k % Math.max(1, shells.length)];
      let s = null;
      if (sh) {
        for (let i = 0; i < 30 && !s; i++) {
          const px = sh.x + 1.4 + rnd() * (sh.w - 2.8), pz = sh.z + 1.4 + rnd() * (sh.d - 2.8);
          const near = walls.slice(-40).some(o => px > o.x - 1 && px < o.x + o.w + 1 && pz > o.z - 1 && pz < o.z + o.d + 1);
          if (!near && !sh.inner.some(q => Math.hypot(q.x - px, q.z - pz) < 1.5)) s = { x: +px.toFixed(2), z: +pz.toFixed(2) };
        }
      }
      s ??= spot();
      if (s) chests.push({ x: s.x, z: s.z, tier });
    }
  }
  perimeter(walls, SIZE, SIZE, 3.2);
  // Every spot has to be somewhere a player can stand.
  const clearOf = s => !walls.some(o => o.kind !== 'water' && s.x > o.x - 1 && s.x < o.x + o.w + 1 && s.z > o.z - 1 && s.z < o.z + o.d + 1)
    && !walls.some(o => o.kind === 'water' && s.x > o.x && s.x < o.x + o.w && s.z > o.z && s.z < o.z + o.d);
  for (const list of [loot, chests]) for (let i = list.length - 1; i >= 0; i--) if (!clearOf(list[i])) list.splice(i, 1);

  // Lanes between blocks: where the coarse waypoints and the old lane logic go.
  const lines = [];
  for (let i = 0; i <= N; i++) lines.push(OFF + i * PITCH - STREET / 2);
  const nav = navGrid(walls, lines, lines);
  // Spawn points at lane crossings: only used if something spawns players outside the battle royale rules.
  const spawns = [[], []];
  lines.forEach((x, i) => lines.forEach((z, j) => { if ((i + j) % 3 === 0) spawns[(i + j) % 2].push({ x, z, aim: 0 }); }));
  const lanes = lines.map((z, i) => ({ id: `l${i}`, z }));

  const pois = POIS.map(([id, name, bx, by, tier]) => ({
    id, name, x: OFF + bx * PITCH + BLOCK / 2, z: OFF + by * PITCH + BLOCK / 2, r: BLOCK * 0.7, region: 'farmland', tier,
  }));
  const circleBias = pois.map(p => ({ x: p.x, z: p.z, w: p.tier === 1 ? 2 : 1 }));

  return {
    id: 'brtest', name: 'Proving Grounds', theme: 'harvest', size: 'huge', hidden: true, region: 'mixed', width: SIZE, height: SIZE,
    walls, spawns, lanes, nav, rooms, points: { dom: [], hard: [] },
    modes: ['br', 'brduo', 'brsolo'], large: true, devMap: true,
    br: { pois, loot, chests, drop: null, circleBias },
  };
}

export default build();
