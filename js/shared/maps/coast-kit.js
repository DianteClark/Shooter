// The Coast's water (docs/DISTRICTS.md "The Coast"): Kittiwake Bay's districts and the region assembled from them keep
// the same land/water lattice Jadefall's maps do (js/shared/maps/isle-kit.js: `cells`, deep water as 'water' walls,
// wading water as `shallows`), so the giant-world streamer draws their beaches, banks and the shallow-water sheet.
// A district describes its water as rects (west half only: `mirror` adds the 180-degree images), the region as rects
// plus its own classifier; both come out the same way:
//   deep     open water, beach slopes along its shore (flag `quay`: a stone quay edge instead, js/render/themes/shore.js)
//   steep    a tidal creek: deep, with a steep mud bank (isle-kit STEEP)
//   shallow  wading water (slows, no slides)
//   deck     plank walkways and footbridges over any of them: dry footing, planks drawn, the water drawn under it
import { CELL, DEEP, SHALLOW, LAND, STEEP, rectsOf } from './isle-kit.js';

export { CELL, DEEP, SHALLOW, LAND, STEEP };

// The 180-degree images of a list of rects, appended (for a district's west-half lists).
export function mirror(W, H, list) {
  return [...list, ...list.map(r => ({ ...r, x: +(W - r.x - r.w).toFixed(2), z: +(H - r.z - r.d).toFixed(2) }))];
}

const inR = (r, x, z) => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d;

// The lattice for a W x H map. `w`: { deep, steep, shallow, deck } rect lists (later lists win: a deck over a creek
// is dry); `base(x, z)` (optional) classes every cell first (the region's sea and flats, its districts' own cells).
// `wallMask(i, j)` (optional): only these cells become water walls (a region leaves its districts' to the districts).
// Returns { cells, water: [[x, z, w, d, flags]], shallows, decks, underDecks }: the water as wall entries for the
// map's own list, `decks` as pier-floor rooms, `underDecks` the water to draw under them.
export function coastWater(W, H, w, base = null, wallMask = null) {
  const n = Math.round(W / CELL), nz = Math.round(H / CELL), cls = new Uint8Array(n * nz);
  const deck = new Uint8Array(n * nz);
  const quay = new Uint8Array(n * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL, k = j * n + i;
    let c = base ? base(x, z) : LAND;
    for (const r of w.shallow ?? []) if (inR(r, x, z)) c = SHALLOW;
    for (const r of w.deep ?? []) if (inR(r, x, z)) { c = DEEP; if (r.quay) quay[k] = 1; }
    for (const r of w.steep ?? []) if (inR(r, x, z)) c = STEEP;
    for (const r of w.deck ?? []) if (inR(r, x, z)) { if (c !== LAND) deck[k] = 1; c = LAND; }
    cls[k] = c;
  }
  const cells = { size: CELL, n, nz, cls };
  return { cells, ...waterOf(cells, W, H, quay, deck, w.deck ?? [], wallMask) };
}

// Walls, shallows and decks of a lattice (`mask(i, j)`: only these cells become walls; the shallows are every
// cell's). Deep rects touching the map's edge are `sea`; rects of quay cells are `quay`.
export function waterOf(cells, W, H, quay = null, deck = null, decks = [], mask = null) {
  const water = [];
  const m = f => (mask ? (i, j) => mask(i, j) && f(i, j) : f);
  const n = cells.n;
  for (const isQuay of [false, true]) {
    for (const r of rectsOf(cells, DEEP, m((i, j) => !!(quay?.[j * n + i]) === isQuay))) {
      const edge = r.x <= 0 || r.z <= 0 || r.x + r.w >= W || r.z + r.d >= H;
      water.push([r.x, r.z, r.w, r.d, { ...(edge ? { sea: true } : {}), ...(isQuay ? { quay: true } : {}) }]);
    }
  }
  for (const r of rectsOf(cells, STEEP, mask ?? null)) water.push([r.x, r.z, r.w, r.d, { channel: true }]);
  const shallows = rectsOf(cells, SHALLOW);
  const underDecks = deck ? rectsOf(cells, LAND, m((i, j) => deck[j * n + i] === 1)) : [];
  return { water, shallows, decks: decks.map(r => ({ x: r.x, z: r.z, w: r.w, d: r.d, floor: 'pier' })), underDecks };
}
