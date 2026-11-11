// Battle royale feasibility only (docs/BR-PERF.md): a procedural giant test map. Not registered, never shipped.
// A city grid of 24 m blocks between 8 m streets; each block is built up (buildings, containers, crates, barriers),
// a park (low cover) or a pond. `density` scales how much stands in each block, so the wall count can be swept.
// Runs in node (dev/br-perf.mjs) and the browser (dev/br-render.html).
import { wall, perimeter, navGrid } from '../js/shared/maps/build.js';

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `spawnArea`: 'spread' puts the 32 spawn points over the whole city (a battle royale drop); 'dense' packs them into
// the middle 120 m, so every bot is in a fight (the worst case for line-of-sight and combat).
export function brMap({ size = 400, density = 1, seed = 7, spawnArea = 'spread' } = {}) {
  const rnd = mulberry(seed);
  const PITCH = 32, STREET = 8, BLOCK = PITCH - STREET;
  const n = Math.floor((size - STREET) / PITCH), off = (size - n * PITCH) / 2 + STREET / 2;
  const walls = [];
  const clear = (x, z, w, d, m = 1.4) => !walls.some(o => x < o.x + o.w + m && x + w + m > o.x && z < o.z + o.d + m && z + d + m > o.z);
  for (let by = 0; by < n; by++) for (let bx = 0; bx < n; bx++) {
    const x0 = off + bx * PITCH, z0 = off + by * PITCH;
    const roll = rnd();
    if (roll < 0.08) {
      walls.push(wall(x0 + 4, z0 + 4, BLOCK - 8, BLOCK - 8, 0, 'water'));
      continue;
    }
    const park = roll < 0.22;
    const items = Math.max(1, Math.round((park ? 5 : 9 + rnd() * 6) * density));
    for (let k = 0, tries = 0; k < items && tries < items * 12; tries++) {
      const t = rnd();
      let w, d, h, kind;
      if (!park && t < 0.32) { w = 4 + rnd() * 6; d = 4 + rnd() * 6; h = 3 + rnd() * 2.5; kind = 'building'; }
      else if (!park && t < 0.52) { w = rnd() < 0.5 ? 6 : 2.5; d = w === 6 ? 2.5 : 6; h = 2.7; kind = 'container'; }
      else if (t < 0.78) { w = 1.6 + rnd() * 0.8; d = w; h = 1.1; kind = 'crate'; }
      else { w = rnd() < 0.5 ? 3 : 0.8; d = w === 3 ? 0.8 : 3; h = 0.9; kind = 'barrier'; }
      const x = x0 + rnd() * (BLOCK - w), z = z0 + rnd() * (BLOCK - d);
      if (!clear(x, z, w, d)) continue;
      walls.push(wall(+x.toFixed(2), +z.toFixed(2), +w.toFixed(2), +d.toFixed(2), h, kind));
      k++;
    }
  }
  perimeter(walls, size, size);

  // Street crossings: where spawns, lanes and waypoints go.
  const lines = [];
  for (let i = 0; i <= n; i++) lines.push(off + i * PITCH - STREET / 2);
  const crossings = [];
  for (const x of lines) for (const z of lines) {
    if (spawnArea === 'dense' && (Math.abs(x - size / 2) > 60 || Math.abs(z - size / 2) > 60)) continue;
    crossings.push({ x, z });
  }
  for (let i = crossings.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [crossings[i], crossings[j]] = [crossings[j], crossings[i]]; }
  const spawns = [[], []];
  for (let i = 0; i < 32; i++) {
    const c = crossings[i % crossings.length];
    // Squads of four land together: a little spread around their crossing.
    const s = { x: c.x + ((i % 4) - 1.5) * 1.6, z: c.z + (i % 2 ? 1.2 : -1.2), aim: rnd() * Math.PI * 2 };
    spawns[Math.floor(i / 4) % 2].push(s);
  }
  const lanes = lines.map((z, i) => ({ id: `s${i}`, z }));
  const nav = navGrid(walls, lines, lines);
  return {
    id: 'brtest', name: 'BR test', theme: 'railyard', width: size, height: size, walls, spawns, lanes, nav,
    points: { dom: [], hard: [] }, modes: ['gwtdm'], large: true, hidden: true,
  };
}
