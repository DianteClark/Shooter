// Weapons visual pass (ROADMAP item 51, docs/WEAPONS-OVERHAUL.md "Visual pass"): the small parts that make a low-poly
// gun read as a machine from the top-down camera, added to every gun model after its own factory has drawn it.
// guns.js calls detailGun(id, k, a, g) just before the gun's geometry is built, with the gun's kit (k), its fitted
// attachments (a) and what the factory returns (muzzle, fore, eject), so every part lands on the gun's own surfaces:
//
//   probes     the factory's triangles are ray-cast (straight down for a top surface, from the right for a side), so a
//              rail sits on the receiver and a port on its flank whatever shape the gun is
//   every gun  an ejection port with a bright case in it on the receiver's right side (not the blades, launchers,
//              revolvers or the bolt-less crossbow), and a sling swivel under the stock
//   by class   Assault / SMG / Marksman / Sniper / LMG: a toothed top rail along the flat of the receiver and vent slots
//              down the handguard. Sniper: a bolt handle with a ball knob standing out on the right, the tell from
//              above. LMG: a cartridge belt looping from the feed tray into the box on the left. Shotgun: a
//              side-saddle of shells on the receiver's left. Pistol: rear slide serrations and a bright front sight.
//              Launcher: a folding sight frame and a bright warhead band.
// Every part is metal, dark or accent (never body), so camos stay on the gun's own body and nothing here takes a team
// stripe. Budget: about 60 to 200 triangles a gun (DETAIL_BUDGET), well inside one gun's draw call.

export const DETAIL_BUDGET = 220;      // Triangles a gun may gain here (dev/sim-attachments.mjs holds it).
export const GUN_TRI_CAP = 1000;       // And the most any stock gun model may have in all.

// Guns whose own shape already says it, or that have no receiver to dress.
const SKIP = new Set(['golden', 'zw-coil', 'zw-rime']);
const NO_PORT = new Set(['revolver', 'crossbow', 'scatter', 'coach', 'nailer', 'rail', 'akimbo', 'launcher', 'thumper', 'salvo', 'lever']);
const NO_RAIL = new Set(['lever', 'crossbow', 'twinshot', 'akimbo', 'rail']);

// ---- Probes over the factory's triangles (MeshBuilder.pos, flat xyz triples, three per triangle). ----

// Highest surface straight down through (x, z), or -Infinity.
function topAt(pos, x, z, below = Infinity) {
  let best = -Infinity;
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], az = pos[i + 2], bx = pos[i + 3], bz = pos[i + 5], cx = pos[i + 6], cz = pos[i + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * pos[i + 1] + l2 * pos[i + 4] + l3 * pos[i + 7];
    if (y > best && y < below) best = y;
  }
  return best;
}
// Lowest surface straight up through (x, z), or Infinity.
function bottomAt(pos, x, z) {
  let best = Infinity;
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], az = pos[i + 2], bx = pos[i + 3], bz = pos[i + 5], cx = pos[i + 6], cz = pos[i + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * pos[i + 1] + l2 * pos[i + 4] + l3 * pos[i + 7];
    if (y < best) best = y;
  }
  return best;
}
// Furthest surface out to the side (sign +1 right, -1 left) through (x, y), or null.
function sideAt(pos, x, y, sign = 1) {
  let best = null;
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], bx = pos[i + 3], by = pos[i + 4], cx = pos[i + 6], cy = pos[i + 7];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const z = (l1 * pos[i + 2] + l2 * pos[i + 5] + l3 * pos[i + 8]) * sign;
    if (best === null || z > best) best = z;
  }
  return best === null ? null : best * sign;
}
// The flat run of the receiver's top around x0: how far each way the top stays within `tol` of its height at x0.
function flatRun(pos, x0, tol = 0.025, step = 0.04, max = 0.9) {
  const y0 = topAt(pos, x0, 0);
  if (!Number.isFinite(y0)) return null;
  let a = x0, b = x0;
  while (b + step < x0 + max && Math.abs(topAt(pos, b + step, 0) - y0) < tol) b += step;
  while (a - step > x0 - max && Math.abs(topAt(pos, a - step, 0) - y0) < tol) a -= step;
  return { a, b, y: y0 };
}

// ---- Parts ----

// A toothed rail along the flat top from x0 to x1 at height y: a low dark base and cross teeth every ~7 cm (at most 7).
function rail(k, x0, x1, y, w = 0.1) {
  const len = x1 - x0;
  if (len < 0.14) return;
  k.dark().box((x0 + x1) / 2, y + 0.012, 0, len, 0.024, w);
  const n = Math.min(7, Math.max(2, Math.floor(len / 0.07)));
  const m = k.metal();
  for (let i = 0; i < n; i++) m.box(x0 + (i + 0.5) * len / n, y + 0.03, 0, 0.026, 0.014, w + 0.02);
}

// The ejection port on the right flank at (x, y): a dark slot, the bolt face showing and a bright brass case in it.
function port(k, pos, x, y, len = 0.16) {
  const z = sideAt(pos, x, y, 1);
  if (z === null || z <= 0.02) return;
  k.dark().box(x, y, z + 0.006, len, 0.06, 0.014);
  k.metal().box(x - len * 0.18, y, z + 0.012, len * 0.4, 0.04, 0.008);
  k.accent().box(x + len * 0.18, y + 0.005, z + 0.014, len * 0.3, 0.03, 0.01);
}

// Vent slots down both flanks of a handguard between x0 and x1 around height y.
function vents(k, pos, x0, x1, y, n = 3) {
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * (x1 - x0) / n;
    for (const s of [1, -1]) {
      const z = sideAt(pos, x, y, s);
      if (z === null || Math.abs(z) < 0.03) continue;
      k.dark().box(x, y, z + s * 0.004, 0.06, 0.035, 0.01);
    }
  }
}

// A sling swivel under the stock near the butt: a small loop.
function swivel(k, pos, x) {
  const y = bottomAt(pos, x, 0);
  if (!Number.isFinite(y)) return;
  k.metal().box(x, y - 0.025, 0, 0.07, 0.05, 0.022);
  k.dark().box(x, y - 0.025, 0, 0.035, 0.022, 0.026);
}

// A sniper's bolt handle: a stalk out of the right side and a ball knob, readable from straight above.
function bolt(k, pos, x, y) {
  const z = sideAt(pos, x, y, 1) ?? 0.1;
  k.metal().box(x, y, z + 0.07, 0.035, 0.035, 0.14);
  k.metal().prismY(y - 0.04, y + 0.04, x - 0.02, z + 0.15, 0.045, 0.045, 8, Math.PI / 8);
  k.accent().box(x - 0.02, y + 0.041, z + 0.15, 0.03, 0.004, 0.03);
}

// An LMG's belt: brass rounds looping from the feed tray at (x, y) on the left flank down and back into the box.
function belt(k, pos, x, y) {
  const z0 = sideAt(pos, x, y, -1);
  if (z0 === null) return;
  const m = k.accent();
  for (let i = 0; i < 6; i++) {
    const t = i / 5, a = t * Math.PI * 0.9;
    const bx = x - 0.04 + Math.sin(a) * 0.06, by = y - 0.02 - (1 - Math.cos(a)) * 0.13, bz = z0 - 0.035 - Math.sin(a) * 0.07;
    m.box(bx, by, bz, 0.035, 0.032, 0.07);
  }
  k.dark().box(x - 0.01, y - 0.09, z0 - 0.07, 0.03, 0.18, 0.05);      // The link strip behind them.
}

// A shotgun's side-saddle: four shells on a carrier on the left of the receiver at (x, y).
function saddle(k, pos, x, y) {
  const z = sideAt(pos, x, y, -1);
  if (z === null) return;
  k.dark().box(x, y, z - 0.012, 0.26, 0.1, 0.022);
  const m = k.accent();
  for (let i = 0; i < 4; i++) m.prismY(y - 0.045, y + 0.045, x - 0.09 + i * 0.06, z - 0.035, 0.024, 0.024, 6);
}

// Pistol slide: serrations at the rear of the top and a bright front sight dot at the nose.
function slide(k, pos, xBack, xFront) {
  const yb = topAt(pos, xBack + 0.06, 0), yf = topAt(pos, xFront - 0.04, 0);
  if (Number.isFinite(yb)) {
    const zr = sideAt(pos, xBack + 0.06, yb - 0.05, 1), zl = sideAt(pos, xBack + 0.06, yb - 0.05, -1);
    const m = k.dark();
    for (let i = 0; i < 3; i++) {
      const x = xBack + 0.03 + i * 0.035;
      if (zr !== null) m.box(x, yb - 0.05, zr + 0.003, 0.012, 0.07, 0.008);
      if (zl !== null) m.box(x, yb - 0.05, zl - 0.003, 0.012, 0.07, 0.008);
    }
  }
  if (Number.isFinite(yf)) k.accent().box(xFront - 0.04, yf + 0.018, 0, 0.025, 0.036, 0.025);
}

// A launcher's folding sight frame and a warhead band.
function tubeSight(k, pos, x) {
  const y = topAt(pos, x, 0);
  if (!Number.isFinite(y)) return;
  k.dark().box(x, y + 0.08, 0, 0.03, 0.16, 0.04);
  k.dark().box(x, y + 0.16, 0, 0.03, 0.03, 0.14);
  k.accent().box(x, y + 0.13, 0, 0.032, 0.03, 0.03);
}

// ---- The pass ----

// `cls` the gun's category, `a` its (model) kit, `g` { muzzle, fore, eject } as the factory will return them.
export function detailGun(id, cls, k, a, g) {
  if (SKIP.has(id) || cls === 'Melee' || !g?.eject) return;
  const pos = k.b.pos, start = pos.length;
  const [ex, ey] = g.eject, [mx, my] = g.muzzle;
  const rifle = cls === 'Assault' || cls === 'SMG' || cls === 'Marksman' || cls === 'Sniper' || cls === 'LMG';
  if (!NO_PORT.has(id) && cls !== 'Launcher') port(k, pos, ex, ey - 0.04, cls === 'Pistol' ? 0.12 : 0.16);
  if (rifle && cls !== 'Sniper' && !NO_RAIL.has(id) && !a.optic) {
    // Along the flat of the receiver around the port, stopping short of any sight fin (and never up on a scope).
    const run = flatRun(pos, ex);
    if (run && run.y < ey + 0.16) rail(k, run.a + 0.02, Math.min(run.b - 0.02, run.a + 0.62), run.y, cls === 'SMG' ? 0.08 : 0.1);
  }
  if (rifle || cls === 'Shotgun') {
    const xs = ex + 0.25, xe = Math.min(mx - 0.25, g.fore[0] + 0.3);
    if (xe - xs > 0.12) vents(k, pos, xs, xe, my - 0.01, cls === 'SMG' ? 2 : 3);
  }
  if (cls !== 'Pistol' && cls !== 'Launcher') {
    const minX = k.b.pos.reduce((m, v, i) => (i % 3 === 0 && i < start ? Math.min(m, v) : m), Infinity);
    if (minX < -0.45) swivel(k, pos, minX + 0.22);
  }
  if (cls === 'Sniper' && id !== 'rail') bolt(k, pos, ex - 0.12, ey - 0.03);
  if (cls === 'LMG') belt(k, pos, ex + 0.06, ey - 0.02);
  if (cls === 'Shotgun' && id !== 'coach') saddle(k, pos, ex + 0.06, ey - 0.06);
  if (cls === 'Pistol' && id !== 'revolver' && id !== 'scatter' && id !== 'akimbo' && id !== 'nailer') slide(k, pos, -0.2, Math.min(mx, 0.62));
  if (cls === 'Launcher') tubeSight(k, pos, ex + 0.2);
}
