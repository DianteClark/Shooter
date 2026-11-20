// What Jadefall's maps share (docs/BR.md "Jadefall"): the land/water lattice and the pieces built from it. The battle
// royale island (br-jadefall.js) and the Ground War maps cut from its coast (gw-tidebreak.js, gw-coral.js) all keep a
// `cells` lattice ({ size, n, nz, cls }) that the renderer (js/render/themes/jadefall.js) reads for beaches, banks and
// the shallow-water sheet, deep water as 'water' walls, and shallow water as `shallows` (js/shared/geometry.js).
import { wall } from './build.js';

export const CELL = 2;
export const DEEP = 0, SHALLOW = 1, LAND = 2, STEEP = 3;   // STEEP: deep water with earth banks (channels, pools).

// The lattice for a W x H map from fn(x, z) -> class, at each cell's centre. `sym`: 180-degree symmetric (the west
// half is the truth; the east half copies its image), as every Ground War map is.
export function lattice(W, H, fn, sym = false) {
  const n = Math.round(W / CELL), nz = Math.round(H / CELL), cls = new Uint8Array(n * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < n; i++) cls[j * n + i] = fn((i + 0.5) * CELL, (j + 0.5) * CELL);
  if (sym) for (let j = 0; j < nz; j++) for (let i = 0; i < n; i++) if (i * 2 < n) cls[(nz - 1 - j) * n + (n - 1 - i)] = cls[j * n + i];
  return { size: CELL, n, nz, cls };
}

// Rects covering every cell of class `c` (runs along each row, merged down while the next row has the same run).
export function rectsOf(cells, c, mask = null) {
  const { n, nz, cls, size: S } = cells;
  const out = [], open = new Map();
  for (let j = 0; j <= nz; j++) {
    const runs = new Set();
    if (j < nz) {
      for (let i = 0; i < n;) {
        if (cls[j * n + i] !== c || (mask && !mask(i, j))) { i++; continue; }
        let k = i;
        while (k < n && cls[j * n + k] === c && (!mask || mask(k, j))) k++;
        runs.add(`${i},${k}`);
        i = k;
      }
    }
    for (const [key, r] of open) if (!runs.has(key)) { out.push(r); open.delete(key); }
    for (const key of runs) {
      if (open.has(key)) open.get(key).d += S;
      else { const [a, b] = key.split(',').map(Number); open.set(key, { x: a * S, z: j * S, w: (b - a) * S, d: S }); }
    }
  }
  return out;
}

// Paints rect r on the lattice with f(old class) -> new class.
export function paint(cells, r, f) {
  const { n, nz, cls, size: S } = cells;
  for (let j = Math.max(0, Math.floor(r.z / S)); j < Math.min(nz, Math.ceil((r.z + r.d) / S)); j++) {
    for (let i = Math.max(0, Math.floor(r.x / S)); i < Math.min(n, Math.ceil((r.x + r.w) / S)); i++) cls[j * n + i] = f(cls[j * n + i]);
  }
}

export const cellAt = (cells, x, z) => {
  const i = Math.floor(x / cells.size), j = Math.floor(z / cells.size);
  return i < 0 || j < 0 || i >= cells.n || j >= cells.nz ? DEEP : cells.cls[j * cells.n + i];
};

// Deep water as walls on the plan (sea: touching the map's edge; channel: steep banks), shallow water as rects.
export function water(P, cells) {
  const W = cells.n * cells.size, H = cells.nz * cells.size;
  for (const r of rectsOf(cells, DEEP)) {
    const edge = r.x <= 0 || r.z <= 0 || r.x + r.w >= W || r.z + r.d >= H;
    P.add(r.x, r.z, r.w, r.d, 0, 'water', edge ? { sea: true } : {});
  }
  for (const r of rectsOf(cells, STEEP)) P.add(r.x, r.z, r.w, r.d, 0, 'water', { channel: true });
  return rectsOf(cells, SHALLOW);
}

// Twin placement for a 180-degree symmetric map: every call places the piece and its image. Buildings get their doors
// turned with them (n <-> s, w <-> e, t -> 1 - t).
export function twins(P) {
  const W = P.W, H = P.H;
  const flip = { n: 's', s: 'n', w: 'e', e: 'w' };
  const img = (x, z, w, d) => [+(W - x - w).toFixed(2), +(H - z - d).toFixed(2)];
  return {
    B(x, z, w, d, o = {}) {
      P.building(x, z, w, d, o);
      const [ix, iz] = img(x, z, w, d);
      P.building(ix, iz, w, d, { ...o, ...(o.doors ? { doors: o.doors.map(([s, t, len]) => [flip[s], 1 - t, len]) } : {}) });
    },
    A(x, z, w, d, h, kind, extra = {}) {
      P.add(x, z, w, d, h, kind, extra);
      const [ix, iz] = img(x, z, w, d);
      const e = { ...extra };
      if (e.bow) e.bow = -e.bow;
      P.add(ix, iz, w, d, h, kind, e);
    },
    room(r) {
      P.rooms.push({ ...r });
      const [ix, iz] = img(r.x, r.z, r.w, r.d);
      P.rooms.push({ ...r, x: ix, z: iz });
    },
    img,
  };
}

// The map's edge for a Ground War cut of the island: border walls in tile-sized lengths (the streamer builds them
// with the tile they fall in); `open` where the sea runs past the edge.
export function edges(P, W, H, seaAt) {
  for (let s = 0; s < Math.max(W, H); s += 32) {
    for (const [x, z, w, d] of [[s, -1.5, Math.min(32, W - s), 1.5], [s, H, Math.min(32, W - s), 1.5], [-1.5, s, 1.5, Math.min(32, H - s)], [W, s, 1.5, Math.min(32, H - s)]]) {
      if (w <= 0 || d <= 0) continue;
      P.walls.push(wall(x, z, w, d, 3.2, 'border', { region: P.region, ...(seaAt(x + w / 2, z + d / 2) ? { open: true } : {}) }));
    }
  }
}
