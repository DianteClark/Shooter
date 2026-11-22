// Region kit (docs/DISTRICTS.md): what a region, a giant map assembled from district maps, is built with. Runs in node
// (sim, validator) and the browser (renderer), on top of the battle royale kit (br-kit.js).
//   placeDistrict   a district (an ordinary 6v6 or Ground War map, built from its own file) placed into a Plan at an
//                   offset: its pieces translated, its border dropped, its solid blocks opened up into enterable
//                   buildings with doors onto clear ground, its map-level art and any carried lists translated
//   doorSpots       where a building on a footprint can have doors that open onto clear ground
//   cityBlock       a block of region fill: lots of enterable shops and flats and solid towers, split by alleys
// The district file stays the source of truth: nothing here changes the district's own map object.
import { DOOR, WALL_T } from './br-kit.js';

// Top-level lists of rects or points on a map that a region carries over by the district's offset (docs/DISTRICTS.md).
// Destruction (docs/DESTRUCTION.md, branch destruct) needs nothing here: its kind rules read each wall, which comes
// along with its flags, and map.breakables is resolved per map (the region gets its own). A district's own entry in
// that builder's BREAKABLES side table can be offset into the region's with `offsetPicks`.
export const CARRY = ['debris'];

// Destruction's per-map picks ([x, z, material], docs/DESTRUCTION.md), moved by a district's offset; a `mirror` table
// (a 180-degree map) is unrolled first, since the district's image point is not the region's.
export function offsetPicks(entry, map, ox, oz) {
  if (!entry?.pick) return [];
  const all = entry.mirror ? entry.pick.flatMap(([x, z, m]) => [[x, z, m], [map.width - x, map.height - z, m]]) : entry.pick;
  return all.map(([x, z, m]) => [x + ox, z + oz, m]);
}

// Piece flags that mark a block as a landmark or a fitting, never opened up into a building.
const KEEP = ['metro', 'newsstand', 'booth', 'kiosk', 'vending', 'ticket', 'landmark', 'stairs', 'keep', 'el', 'bus', 'materials'];
const HOLLOW_KINDS = new Set(['building', 'shop']);
export const MIN_HOLLOW = 4.5;      // Short side, metres: narrower blocks stay solid (a room under 3.5 m wide is a corridor).

const shift = (o, ox, oz) => ({ ...o, x: +(o.x + ox).toFixed(2), z: +(o.z + oz).toFixed(2) });

// Door sides for a building on (x, z, w, d): for each side, the first spot along it (middle first) whose apron, the
// ground just outside the door, passes `clear(x, z, w, d)`. Mirrors Plan.building's own placement (the clamp and the
// shift off the inside wall's end), so the door lands where it was tested. Returns up to `want` [side, t] pairs on
// different sides, in `prefer` order; a second door on the same side when only one side is open; [] when none is.
export function doorSpots(x, z, w, d, clear, { want = 2, prefer = ['s', 'n', 'w', 'e'], split = true } = {}) {
  const T = WALL_T, len = DOOR;
  const isSplit = split && Math.max(w, d) >= 11;
  const found = new Map();
  for (const side of prefer) {
    const horiz = side === 'n' || side === 's';
    const a = horiz ? x : z + T, b = horiz ? x + w : z + d - T, L = b - a;
    if (L < len + 2) continue;
    const spots = [];
    for (let t of [0.5, 0.3, 0.7, 0.18, 0.82]) {
      const across = w >= d ? horiz : !horiz;
      if (isSplit && across && Math.abs(t - 0.5) * Math.max(w, d) < len / 2 + 0.8) t = t < 0.5 ? 0.27 : 0.73;
      const c = Math.max(a + 0.9 + len / 2, Math.min(b - 0.9 - len / 2, a + t * L));
      if (spots.some(s => Math.abs(s.c - c) < len + 1.5)) continue;
      const s0 = c - len / 2 - 0.35, sw = len + 0.7, D = 2.6;
      const r = side === 'n' ? [s0, z - D, sw, D] : side === 's' ? [s0, z + d, sw, D] : side === 'w' ? [x - D, s0, D, sw] : [x + w, s0, D, sw];
      if (clear(...r)) spots.push({ t, c });
    }
    if (spots.length) found.set(side, spots);
  }
  const out = [];
  for (const side of prefer) if (found.has(side) && out.length < want) out.push([side, found.get(side)[0].t]);
  if (out.length === 1 && want > 1 && found.get(out[0][0]).length > 1) out.push([out[0][0], found.get(out[0][0])[1].t]);
  return out;
}

// Rect overlap test against a list, with a margin.
const hits = (list, x, z, w, d, m = 0) => list.some(o => x - m < o.x + o.w && x + w + m > o.x && z - m < o.z + o.d && z + d + m > o.z);

// Places district `map` into Plan P with its north-west corner at (ox, oz). o: { id, name, skin, style, hollow
// (false: keep every block solid), shell (walls added round the rect where the border was, see the City's
// Turnstile), keep (fn(w) -> true keeps a block solid), floorH }. Returns the district record for the region's
// `districts` list plus its translated art: { id, name, x, z, w, h, buildings, el, strings, crossings, trains, zones }.
export function placeDistrict(P, map, ox, oz, o = {}) {
  const W = map.width, H = map.height;
  const pieces = map.walls.filter(w => w.kind !== 'border');
  const skin = o.skin ?? null;
  const prevSkin = P.skin;
  const solid = [], open = [];
  for (const w of pieces) {
    const short = Math.min(w.w, w.d);
    const keep = o.hollow === false || !HOLLOW_KINDS.has(w.kind) || short < MIN_HOLLOW || KEEP.some(k => w[k]) || o.keep?.(w);
    (keep ? solid : open).push(w);
  }
  // Ground the district stands on, in region metres, for the door tests: every one of its pieces, plus anything
  // already in the plan round it (another district's shell, region pieces) found through the plan's index.
  const local = pieces.map(w => shift(w, ox, oz));
  const inBounds = (x, z, w, d) => x > 1.5 && z > 1.5 && x + w < P.W - 1.5 && z + d < P.H - 1.5;
  P.skin = skin;
  for (const w of solid) {
    const { x, z, w: ww, d, h, kind, blocksMove, blocksBullet, blocksVision, region, skin: s0, ...extra } = w;
    P.add(x + ox, z + oz, ww, d, h, kind, { ...extra, district: o.id ?? map.id, ...(s0 ? { skin: s0 } : {}) });
  }
  if (o.shell) o.shell(P, ox, oz);
  const buildings = [];
  for (const w of open) {
    const bx = w.x + ox, bz = w.z + oz;
    const others = local.filter(q => !(Math.abs(q.x - bx) < 0.01 && Math.abs(q.z - bz) < 0.01 && q.w === w.w && q.d === w.d));
    const clear = (x, z, ww, d) => inBounds(x, z, ww, d) && !hits(others, x, z, ww, d, 0.45) && P.near(x, z, ww, d, 0.45).size === 0;
    const doors = doorSpots(bx, bz, w.w, w.d, clear, { want: Math.max(w.w, w.d) >= 12 ? 3 : 2 });
    if (!doors.length) {
      const { x, z, w: ww, d, h, kind, blocksMove, blocksBullet, blocksVision, region, ...extra } = w;
      P.add(bx, bz, ww, d, h, kind, { ...extra, district: o.id ?? map.id });
      continue;
    }
    P.skin = null;
    const b = P.building(bx, bz, w.w, w.d, { h: Math.max(3.2, w.h), style: o.style ?? 'metro', doors, furnish: w.w * w.d > 70 ? 2 : 1 });
    P.skin = skin;
    for (const k of [b.id]) P.roofs[k].district = o.id ?? map.id;
    buildings.push(b.id);
  }
  P.skin = prevSkin;
  // Art the renderer reads off the map object, translated.
  const out = { id: o.id ?? map.id, name: o.name ?? map.name, x: ox, z: oz, w: W, h: H, buildings };
  if (map.el) out.el = { x0: ox, x1: ox + W, z0: map.el.z0 + oz, z1: map.el.z1 + oz, y: map.el.y };
  if (map.strings) out.strings = map.strings.map(([x, z0, z1]) => [x + ox, z0 + oz, z1 + oz]);
  if (map.crossings) out.crossings = map.crossings.map(([x, z]) => [x + ox, z + oz]);
  if (map.trains) out.trains = map.trains.map(t => shift(t, ox, oz));
  out.zones = (map.zones ?? []).map(z => shift(z, ox, oz));
  for (const k of CARRY) if (Array.isArray(map[k])) out[k] = map[k].map(e => (e && typeof e === 'object' && 'x' in e && 'z' in e ? shift(e, ox, oz) : e));
  return out;
}

// One block of region fill on (x, z, w, d), inside its own pavement (`inset` from the block edge). Lots run along the
// long side, one row deep (two, back to back with a service alley, when the block is deep enough); every few lots an
// alley cuts through. Each lot is an enterable building (shop, flats; doors onto the street or the alley), a solid
// tower, or an open yard with some cover. o: { style, tall (share of towers), yard (share of yards), lot [min, max],
// h [min, max], towerH [min, max], alleyEvery, tier, rows, loot (spots a room, default 2, 3 on lots over 180 m^2), windowEvery (default 6.5) }. Returns { built: [ids], towers, yards: [rects] }.
export function cityBlock(P, x, z, w, d, o = {}) {
  const R = P.rnd;
  const inset = o.inset ?? 1.6, alley = 3.6;
  const along = w >= d;
  const L = (along ? w : d) - 2 * inset, S = (along ? d : w) - 2 * inset;
  const rows = o.rows ?? (S >= 24 ? 2 : 1);
  const depth = rows === 2 ? (S - alley) / 2 : S;
  const [lotMin, lotMax] = o.lot ?? [8, 13];
  const out = { built: [], towers: 0, yards: [] };
  const lots = [];
  for (let row = 0; row < rows; row++) {
    let s = 0, since = 0;
    const every = o.alleyEvery ?? 3;
    while (s < L - lotMin + 0.01) {
      let len = lotMin + R() * (lotMax - lotMin);
      if (L - s - len < lotMin) len = L - s;
      const a0 = s, a1 = s + len;
      const off = row * (depth + alley);
      lots.push(along ? { x: x + inset + a0, z: z + inset + off, w: a1 - a0, d: depth, row } : { x: x + inset + off, z: z + inset + a0, w: depth, d: a1 - a0, row });
      s = a1;
      since++;
      if (since >= every && s < L - lotMin - alley) { s += alley; since = 0; }
    }
  }
  // Decide each lot first, so a door test can see the lots built after it.
  for (const lot of lots) {
    const r = R();
    lot.kind = r < (o.yard ?? 0.1) ? 'yard' : r < (o.yard ?? 0.1) + (o.tall ?? 0.25) ? 'tower' : 'shop';
  }
  const pending = lots.filter(l => l.kind !== 'yard');
  const [h0, h1] = o.h ?? [3.6, 4.6], [t0, t1] = o.towerH ?? [6, 10];
  const inBounds = (px, pz, pw, pd) => px > 1.5 && pz > 1.5 && px + pw < P.W - 1.5 && pz + pd < P.H - 1.5;
  for (const lot of lots) {
    if (lot.kind === 'yard') { out.yards.push(lot); continue; }
    if (lot.kind === 'tower') {
      P.add(lot.x, lot.z, lot.w, lot.d, t0 + R() * (t1 - t0), 'building', { tower: true, skin: o.towerSkin ?? 'metro' });
      out.towers++;
      continue;
    }
    const others = pending.filter(q => q !== lot);
    const clear = (px, pz, pw, pd) => inBounds(px, pz, pw, pd) && !hits(others, px, pz, pw, pd, 0.45) && P.near(px, pz, pw, pd, 0.45).size === 0
      && !(P.keepOut ?? []).some(k => hits([k], px, pz, pw, pd));
    const prefer = along ? (lot.row ? ['s', 'n', 'w', 'e'] : ['n', 's', 'w', 'e']) : (lot.row ? ['e', 'w', 'n', 's'] : ['w', 'e', 'n', 's']);
    const doors = doorSpots(lot.x, lot.z, lot.w, lot.d, clear, { prefer, want: 2 });
    if (!doors.length) { P.add(lot.x, lot.z, lot.w, lot.d, t0, 'building', { tower: true, skin: o.towerSkin ?? 'metro' }); out.towers++; continue; }
    const b = P.building(lot.x, lot.z, lot.w, lot.d, { h: h0 + R() * (h1 - h0), style: o.style ?? 'metro', doors, furnish: lot.w * lot.d > 80 ? 2 : 1, tier: o.tier, loot: o.loot ?? (lot.w * lot.d < 180 ? 2 : 3), windowEvery: o.windowEvery ?? 6.5 });
    out.built.push(b.id);
  }
  return out;
}

// A shell round a district's rect, where its 6v6 border was (outside the rect and touching it, so every gap along the
// inside is the one the 6v6 map has), with gates: for each side, `gates[side]` openings `gate` wide, spread along it,
// each where the ground just inside and just outside is clear. o: { t, h, kind, extra, gate, gates: { n, s, w, e } }.
// Returns the gate centres as [x, z] points (outside the shell), for the region's paths and nav.
export function shellWalls(P, x, z, w, d, o = {}) {
  const t = o.t ?? 0.6, h = o.h ?? 3.4, kind = o.kind ?? 'wall', extra = o.extra ?? {}, gw = o.gate ?? 3.2;
  const gates = { n: 2, s: 2, w: 1, e: 1, ...(o.gates ?? {}) };
  const D = 2.6;
  const free = (rx, rz, rw, rd) => rx > 1.5 && rz > 1.5 && rx + rw < P.W - 1.5 && rz + rd < P.H - 1.5 && P.near(rx, rz, rw, rd, 0.45).size === 0;
  const out = [];
  for (const side of ['n', 's', 'w', 'e']) {
    const horiz = side === 'n' || side === 's';
    const a0 = horiz ? x - t : z, a1 = horiz ? x + w + t : z + d;
    const L = horiz ? w : d;
    const ok = [];
    for (let c = 2.6; c <= L - 2.6; c += 0.5) {
      const s = (horiz ? x : z) + c - gw / 2 - 0.3, sw = gw + 0.6;
      const inner = side === 'n' ? [s, z, sw, D] : side === 's' ? [s, z + d - D, sw, D] : side === 'w' ? [x, s, D, sw] : [x + w - D, s, D, sw];
      const outer = side === 'n' ? [s, z - t - D, sw, D] : side === 's' ? [s, z + d + t, sw, D] : side === 'w' ? [x - t - D, s, D, sw] : [x + w + t, s, D, sw];
      if (free(...inner) && free(...outer)) ok.push(c);
    }
    const k = gates[side], picked = [];
    for (let i = 0; i < k; i++) {
      const want = (L * (i + 1)) / (k + 1);
      let best = null;
      for (const c of ok) if (!picked.some(p => Math.abs(p - c) < gw + 4) && (best === null || Math.abs(c - want) < Math.abs(best - want))) best = c;
      if (best !== null) picked.push(best);
    }
    picked.sort((p, q) => p - q);
    let at = a0;
    const seg = (s0, s1) => {
      if (s1 - s0 < 0.05) return;
      if (side === 'n') P.add(s0, z - t, s1 - s0, t, h, kind, extra);
      else if (side === 's') P.add(s0, z + d, s1 - s0, t, h, kind, extra);
      else if (side === 'w') P.add(x - t, s0, t, s1 - s0, h, kind, extra);
      else P.add(x + w, s0, t, s1 - s0, h, kind, extra);
    };
    for (const c of picked) {
      const g0 = (horiz ? x : z) + c - gw / 2;
      seg(at, g0);
      at = g0 + gw;
      const m = (horiz ? x : z) + c;
      out.push(side === 'n' ? [m, z - t - 1.5] : side === 's' ? [m, z + d + t + 1.5] : side === 'w' ? [x - t - 1.5, m] : [x + w + t + 1.5, m]);
    }
    seg(at, a1);
  }
  return out;
}

// Floor loot inside a rect (a shell's inside, a hall): `n` spots on a 1.8 m lattice clear of every piece, spread apart.
export function floorLoot(P, x, z, w, d, n, tier, indoor = true) {
  const cand = [];
  for (let pz = z + 1.2; pz <= z + d - 1.2; pz += 1.8) for (let px = x + 1.2; px <= x + w - 1.2; px += 1.8) if (P.open(px, pz, 1.0)) cand.push([px, pz]);
  if (!cand.length) return [];
  const taken = [cand[Math.floor(P.rnd() * cand.length)]];
  while (taken.length < n) {
    let best = null, bd = -1;
    for (const c of cand) {
      let m = Infinity;
      for (const t of taken) m = Math.min(m, Math.hypot(c[0] - t[0], c[1] - t[1]));
      if (m > bd) { bd = m; best = c; }
    }
    if (bd < 2.5) break;
    taken.push(best);
  }
  const got = taken.map(([px, pz]) => ({ x: +px.toFixed(2), z: +pz.toFixed(2), tier, indoor }));
  P.loot.push(...got);
  return got;
}

// Loot and caches a bot could never walk to (a corner pocket between furniture, on the nav grid's 1 m cells) are
// dropped: the same blocked-cell rule as js/sim/nav.js (cell centres within PLAYER_RADIUS + 0.2 of a movement-blocking
// piece) and the same reach test as dev/map-validate.mjs, flooded from (sx, sz). Returns how many were dropped.
export function pruneUnreachable(P, sx, sz, clearance = 0.65) {
  const w = Math.ceil(P.W), h = Math.ceil(P.H), blocked = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const cx = i + 0.5, cz = j + 0.5;
    if (cx < clearance || cz < clearance || cx > P.W - clearance || cz > P.H - clearance) blocked[j * w + i] = 1;
  }
  for (const r of P.walls) {
    if (!r.blocksMove) continue;
    const i0 = Math.max(0, Math.floor(r.x - clearance) - 1), i1 = Math.min(w - 1, Math.floor(r.x + r.w + clearance) + 1);
    const j0 = Math.max(0, Math.floor(r.z - clearance) - 1), j1 = Math.min(h - 1, Math.floor(r.z + r.d + clearance) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = i + 0.5, cz = j + 0.5;
      const dx = cx - Math.max(r.x, Math.min(cx, r.x + r.w)), dz = cz - Math.max(r.z, Math.min(cz, r.z + r.d));
      if (dx * dx + dz * dz < clearance * clearance) blocked[j * w + i] = 1;
    }
  }
  const reach = new Uint8Array(w * h);
  const start = Math.floor(sz) * w + Math.floor(sx);
  const stack = [start];
  reach[start] = 1;
  while (stack.length) {
    const k = stack.pop(), i = k % w, j = (k - i) / w;
    for (const n of [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, j > 0 ? k - w : -1, j < h - 1 ? k + w : -1]) {
      if (n >= 0 && !blocked[n] && !reach[n]) { reach[n] = 1; stack.push(n); }
    }
  }
  const ok = l => {
    for (let dz = -0.6; dz <= 0.6; dz += 0.5) for (let dx = -0.6; dx <= 0.6; dx += 0.5) {
      const cx = l.x + dx, cz = l.z + dz;
      if (cx >= 0 && cz >= 0 && cx < w && cz < h && reach[Math.floor(cz) * w + Math.floor(cx)]) return true;
    }
    return false;
  };
  const before = P.loot.length + P.chests.length;
  P.loot = P.loot.filter(ok);
  P.chests = P.chests.filter(ok);
  return before - P.loot.length - P.chests.length;
}
