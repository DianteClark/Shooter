// Shared helpers for the map files. A map is rectangles on the XZ plane so sim, bots and renderer all
// read one source. X runs east (right on screen), Z south (down on screen), origin at the north-west.
//
// Every wall blocks movement. Kinds differ in what else they stop:
//   solid (block sight and bullets)  building, container, wall, border, shop, adobe, rock, tent, hull, crane
//   low   (shoot and see over)       crate, barrier, stall, sandbag, boulder
//   water (shoot and see across)     water
const SOLID = new Set(['building', 'container', 'wall', 'border', 'shop', 'adobe', 'rock', 'tent', 'hull', 'crane']);

export function wall(x, z, w, d, h, kind, extra = {}) {
  const solid = SOLID.has(kind);
  return { x, z, w, d, h, kind, blocksMove: true, blocksBullet: solid, blocksVision: solid, ...extra };
}

// Adds a rect list and its 180-degree copy. Extras flagged `flip` (for example a ship's bow) negate.
export function rotated(walls, W, H, list) {
  for (const [x, z, w, d, h, kind, extra] of list) {
    walls.push(wall(x, z, w, d, h, kind, extra));
    const e = extra ? { ...extra } : undefined;
    if (e && e.bow) e.bow = -e.bow;
    // Rounded so float noise in the image never makes two touching walls overlap.
    walls.push(wall(+(W - x - w).toFixed(4), +(H - z - d).toFixed(4), w, d, h, kind, e));
  }
}

// Perimeter sits just outside the playable area so positions stay in [0,W]x[0,H].
export function perimeter(walls, W, H, bh = 4, t = 1.5) {
  walls.push(wall(-t, -t, W + 2 * t, t, bh, 'border'));
  walls.push(wall(-t, H, W + 2 * t, t, bh, 'border'));
  walls.push(wall(-t, 0, t, H, bh, 'border'));
  walls.push(wall(W, 0, t, H, bh, 'border'));
}

// Team 0 spawns on the west edge; team 1 is the 180-degree image, so both sides get the same picture.
export function edgeSpawns(W, H, x, zs) {
  return [
    zs.map(z => ({ x, z, aim: 0 })),
    zs.map(z => ({ x: W - x, z: H - z, aim: Math.PI })),
  ];
}

// Coarse waypoints; anything that lands inside a wall is dropped.
export function navGrid(walls, xs, zs) {
  const nav = [];
  for (const x of xs) {
    for (const z of zs) {
      if (!walls.some(w => w.kind !== 'border' && x > w.x - 1.4 && x < w.x + w.w + 1.4 && z > w.z - 1.4 && z < w.z + w.d + 1.4)) nav.push({ x, z });
    }
  }
  return nav;
}

// Domination: A on the west side, B dead centre (the only point a 180-degree map can hold fairly),
// C the image of A. Hardpoint alternates sides so no team owns the rotation.
export function symmetricPoints(W, H, a, b, hardPairs) {
  const image = p => ({ x: W - p.x, z: H - p.z, r: p.r });
  const c = image(a);
  const hard = [];
  hardPairs.forEach((p, i) => {
    hard.push({ id: `h${hard.length + 1}`, x: p.x, z: p.z, r: p.r });
    hard.push({ id: `h${hard.length + 1}`, ...image(p) });
  });
  return {
    dom: [{ id: 'A', ...a }, { id: 'B', ...b }, { id: 'C', ...c }],
    hard,
  };
}

// Search and Destroy: the two bomb sites, both on the east (team 1 spawn) half. Attackers always set out from the west
// spawns and defenders from the east; the teams trade ends at halftime, so each side attacks the same two sites from
// the same direction and the 180-degree map needs no second pair. A is the northern site, B the southern one.
export function bombSites(a, b, r = 3.2) {
  return [{ id: 'A', x: a.x, z: a.z, r: a.r ?? r }, { id: 'B', x: b.x, z: b.z, r: b.r ?? r }];
}
