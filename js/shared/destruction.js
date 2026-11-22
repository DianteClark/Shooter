// Destruction (docs/DESTRUCTION.md): which pieces of a map break, what they are made of, and how a piece's stage
// (0 intact, 1 damaged, 2 broken) shows on its wall. Shared by the host sim, guests, the renderer and the validator.
// No DOM, no three.
import { BREAKABLES } from './breakables.js';

// Wire order fixed: the index is what events and snapshots carry. Append only.
export const MATERIALS = ['glass', 'wood', 'light', 'heavy'];
export const MAT = {
  glass: { hp: 20, bullet: 1, blast: 1 },
  wood: { hp: 260, bullet: 1, blast: 1 },
  light: { hp: 420, bullet: 0, blast: 1 },
  heavy: { hp: 1200, bullet: 0, blast: 1, light: 1 / 3 },   // `light`: what frag-class blasts do to it.
};
export const DAMAGED_AT = 0.55;           // Health fraction under which a piece shows as damaged.
const SPAWN_GUARD = 5, EDGE_GUARD = 0.6, SND_GUARD = 3;
const PILE_CLEAR = 1.5, PILE_MIN = 0.9, PILE_H = 0.85;

// Kinds the rules never break (a pick in js/shared/breakables.js still can; borders, water and landmarks never).
const NEVER = new Set(['border', 'water', 'container', 'rock', 'hull', 'crane', 'boulder']);

// The kind rules: a wall's own kind, size and flags give its material (null: stays). Only the wall is looked at, so a
// map built with `rotated` gets the same pieces on both halves.
export function ruleFor(w) {
  if (w.landmark) return null;
  const area = w.w * w.d, thin = Math.min(w.w, w.d), long = Math.max(w.w, w.d);
  // Jungle ruins: the crumbling stone walls go to big explosives, the thickets to anything (statues and pillars stay).
  if (w.kind === 'rock') return w.ruin === true && thin <= 1.3 && long <= 9 ? 'heavy' : w.thicket ? 'wood' : null;
  if (NEVER.has(w.kind)) return null;
  if (w.window) return 'glass';
  if (w.furn) return 'wood';
  if (w.bwall) return w.inner ? 'light' : null;          // Enterable buildings: inside walls go, outer walls stay.
  switch (w.kind) {
    case 'crate': case 'stall': case 'tent': return area <= 30 ? 'wood' : null;
    case 'barrier': return long <= 8 ? 'light' : null;
    case 'sandbag': return long <= 8 ? 'light' : null;
    case 'shop': return area <= 12 && w.h <= 3 ? 'wood' : null;
    case 'adobe': return area <= 24 ? 'light' : null;
    case 'building': return area <= 26 && w.h <= 4.6 ? 'light' : null;
    case 'wall':
      if (thin <= 1.3 && long <= 9) return 'light';
      if (thin <= 2 && long <= 16) return 'heavy';
      return null;
    default: return null;
  }
}

// The rubble pile a broken piece leaves, centred, at least PILE_CLEAR inside every side so nothing narrower than a
// player opens beside it; null when that leaves too little (the piece then simply goes).
function pileFor(w, mat) {
  if (mat !== 'light' && mat !== 'heavy') return null;
  if (Math.min(w.w, w.d) < 2.4) return null;              // Thin walls open right up.
  const ix = Math.max(PILE_CLEAR, w.w * 0.25), iz = Math.max(PILE_CLEAR, w.d * 0.25);
  const pw = w.w - 2 * ix, pd = w.d - 2 * iz;
  if (pw < PILE_MIN || pd < PILE_MIN) return null;
  return { x: +(w.x + ix).toFixed(4), z: +(w.z + iz).toFixed(4), w: +pw.toFixed(4), d: +pd.toFixed(4), h: PILE_H };
}

const inRect = (w, x, z) => x >= w.x && x <= w.x + w.w && z >= w.z && z <= w.z + w.d;
function rectDist(w, x, z) {
  const dx = Math.max(w.x - x, 0, x - w.x - w.w), dz = Math.max(w.z - z, 0, z - w.z - w.d);
  return Math.hypot(dx, dz);
}

// Resolves map.breakables once (see docs/DESTRUCTION.md "Resolved form"). Idempotent.
export function prepareBreakables(map) {
  if (!map || map.breakables) return map?.breakables ?? [];
  const table = BREAKABLES[map.id] ?? {};
  const list = [];
  map.breakables = list;
  map.brkVer = 0;
  if (table.off || map.zmOnly || !map.walls) return list;
  const W = map.width, H = map.height;
  // Picks: the wall containing each point (and its image on a mirrored map) gets that material, over the rules.
  const picked = new Map();
  for (const [x, z, mat] of table.pick ?? []) {
    const pts = table.mirror ? [[x, z], [W - x, H - z]] : [[x, z]];
    for (const [px, pz] of pts) {
      const w = map.walls.find(q => q.kind !== 'border' && inRect(q, px, pz));
      if (w) picked.set(w, mat);
    }
  }
  const spawns = (map.spawns ?? []).flat();
  const sites = map.points?.snd ?? [];
  map.walls.forEach((w, wi) => {
    if (w.zm || w.rubble) return;
    let mat = picked.has(w) ? picked.get(w) : ruleFor(w);
    if (!mat || w.kind === 'border' || w.kind === 'water' || w.landmark || (w.bwall && !w.inner)) return;
    if (w.x < EDGE_GUARD || w.z < EDGE_GUARD || w.x + w.w > W - EDGE_GUARD || w.z + w.d > H - EDGE_GUARD) return;
    if (spawns.some(s => rectDist(w, s.x, s.z) < SPAWN_GUARD)) return;
    const snd = sites.some(s => rectDist(w, s.x, s.z) < (s.r ?? 3.2) + SND_GUARD);
    list.push({
      id: list.length, wi, wall: w, mat, hp: MAT[mat].hp,
      x: w.x, z: w.z, w: w.w, d: w.d, h: w.h,
      flags: [w.blocksMove, w.blocksBullet, w.blocksVision],
      pile: pileFor(w, mat), snd,
    });
    w.brk = list.length - 1;
  });
  return list;
}

// Sets one piece's wall to how that stage stands. Returns true when its collision changed.
export function applyStage(map, id, stage) {
  const p = map.breakables?.[id];
  if (!p) return false;
  const w = p.wall, broken = stage >= 2, was = w._brk === 2;
  w._brk = stage;
  if (broken === was) return false;
  if (!broken) {
    w.x = p.x; w.z = p.z; w.w = p.w; w.d = p.d; w.h = p.h;
    [w.blocksMove, w.blocksBullet, w.blocksVision] = p.flags;
  } else if (p.pile) {
    w.x = p.pile.x; w.z = p.pile.z; w.w = p.pile.w; w.d = p.pile.d; w.h = p.pile.h;
    w.blocksMove = true; w.blocksBullet = false; w.blocksVision = false;
  } else {
    w.blocksMove = false; w.blocksBullet = false; w.blocksVision = false;
  }
  map.brkVer = (map.brkVer || 0) + 1;
  return true;
}

// Every piece back up (a new match on this shared map object).
export function resetBreakables(map) {
  const list = map?.breakables;
  if (!list) return;
  for (const p of list) if (p.wall._brk) applyStage(map, p.id, 0);
  for (const p of list) p.wall._brk = 0;
}

// The stage of every piece as one string: the pieces not intact, as (gap since the last one) * 4 + stage, each in
// 5-bit groups low first, one base64url character a group with bit 5 meaning "more groups follow". '' when all stand.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INV = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_INV[B64.charCodeAt(i)] = i;
export function encodeBreak(stages) {
  let s = '', last = -1;
  for (let i = 0; i < stages.length; i++) {
    if (!stages[i]) continue;
    let v = (i - last - 1) * 4 + stages[i];
    last = i;
    do { const g = v & 31; v = Math.floor(v / 32); s += B64[g | (v > 0 ? 32 : 0)]; } while (v > 0);
  }
  return s;
}

// The inverse, into `out` (a Uint8Array of n, zeroed first). Returns out, or null for a string that does not read.
export function decodeBreak(text, n, out = new Uint8Array(n)) {
  out.fill(0);
  if (!text) return out;
  let at = -1, v = 0, mul = 1;
  for (let k = 0; k < text.length; k++) {
    const c = text.charCodeAt(k), g = c < 128 ? B64_INV[c] : -1;
    if (g < 0) return null;
    v += (g & 31) * mul; mul *= 32;
    if (g & 32) continue;
    at += Math.floor(v / 4) + 1;
    if (at >= n) return null;
    out[at] = v & 3;
    v = 0; mul = 1;
  }
  return out;
}

// Applies a whole break string to the map's walls (a guest's snapshot, a replay frame). Returns how many pieces'
// collision changed.
const SCRATCH = { a: new Uint8Array(0) };
export function setBreakState(map, text) {
  const list = map?.breakables;
  if (!list || !list.length) return 0;
  if (SCRATCH.a.length < list.length) SCRATCH.a = new Uint8Array(list.length);
  const st = decodeBreak(text || '', list.length, SCRATCH.a.subarray(0, list.length));
  if (!st) return 0;
  let changed = 0;
  for (let i = 0; i < list.length; i++) {
    const w = list[i].wall;
    if ((w._brk || 0) === st[i]) continue;
    if (applyStage(map, i, st[i])) changed++;
  }
  return changed;
}

// Stage of every piece on this map as the walls stand now.
export function currentStages(map) {
  const list = map?.breakables ?? [];
  const out = new Uint8Array(list.length);
  for (let i = 0; i < list.length; i++) out[i] = list[i].wall._brk || 0;
  return out;
}

// Breaks every piece (the validator's "all broken" pass). Returns the count.
export function breakAll(map) {
  const list = prepareBreakables(map);
  for (const p of list) applyStage(map, p.id, 2);
  return list.length;
}
