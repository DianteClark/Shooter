// The look of the attachments wave 2 parts (js/shared/attachments-w2.js). Same conventions as guns.js: model space in
// metres, +X muzzle, +Y up, +Z to the shooter's right, origin at the firing hand; attachments in dark / metal /
// accent / grip parts so camos stay on the gun's own body; every part has to read from directly above.
// guns.js calls these from its shared fitters (optic rail, muzzle, rear grip, magazine look), and the few guns that
// build a slot their own way (shotguns' shells, launchers' tubes and rockets, the Lodestone's yoke, the Magpies'
// two grips) call the helpers at the bottom.

const OCT = Math.PI / 8;

// ---- Optics: on the rail at (x, y), scaled by s for small guns. Returns true when the id is a wave 2 optic. ----
export function fitOpticW2(k, id, x, y, s = 1) {
  const b = k.b;
  if (id === 'irons') {
    // Folding iron sights: a notched rear leaf with two ears and a winged front post, each on a hinge block.
    k.metal().box(x - 0.18 * s, y + 0.03 * s, 0, 0.1 * s, 0.06 * s, 0.18 * s);
    k.dark();
    for (const z of [-0.055, 0.055]) b.box(x - 0.18 * s, y + 0.13 * s, z * s, 0.04 * s, 0.15 * s, 0.05 * s);
    k.metal().box(x + 0.22 * s, y + 0.03 * s, 0, 0.1 * s, 0.06 * s, 0.16 * s);
    k.dark().box(x + 0.22 * s, y + 0.14 * s, 0, 0.035 * s, 0.17 * s, 0.035 * s);
    k.metal(); for (const z of [-0.07, 0.07]) b.box(x + 0.22 * s, y + 0.12 * s, z * s, 0.05 * s, 0.13 * s, 0.025 * s);
    k.accent().box(x + 0.22 * s, y + 0.235 * s, 0, 0.04 * s, 0.03 * s, 0.045 * s);
    k.accent(); for (const z of [-0.055, 0.055]) b.box(x - 0.18 * s, y + 0.2 * s, z * s, 0.045 * s, 0.025 * s, 0.03 * s);
    return true;
  }
  if (id === 'prism') {
    // A boxy prism sight: a wedge body sloping down to the front lens, a round eyepiece and a flat top turret.
    k.dark().extrude([[x - 0.18 * s, y], [x + 0.18 * s, y], [x + 0.18 * s, y + 0.13 * s], [x + 0.06 * s, y + 0.26 * s], [x - 0.18 * s, y + 0.26 * s]], -0.12 * s, 0.12 * s);
    k.dark().prismX(x - 0.29 * s, x - 0.18 * s, y + 0.16 * s, 0, 0.075 * s, 0.09 * s, 8, OCT);
    k.accent().box(x + 0.185 * s, y + 0.075 * s, 0, 0.015 * s, 0.1 * s, 0.17 * s);
    k.metal().box(x - 0.04 * s, y + 0.285 * s, 0, 0.16 * s, 0.05 * s, 0.13 * s);
    k.metal().box(x - 0.04 * s, y + 0.15 * s, 0.135 * s, 0.1 * s, 0.08 * s, 0.03 * s);
    return true;
  }
  if (id === 'rangefinder') {
    // A short tube with a laser rangefinding box riding on top, its bright window facing forward.
    const cy = y + 0.15 * s;
    k.dark().prismX(x - 0.28 * s, x + 0.26 * s, cy, 0, 0.075 * s, 0.075 * s, 8, OCT);
    k.dark().prismX(x + 0.2 * s, x + 0.32 * s, cy, 0, 0.075 * s, 0.11 * s, 8, OCT);
    k.accent().prismX(x + 0.32 * s, x + 0.335 * s, cy, 0, 0.1 * s, 0.1 * s, 8, OCT);
    k.metal().box(x - 0.02 * s, cy + 0.14 * s, 0, 0.3 * s, 0.11 * s, 0.15 * s, 0.02);
    k.accent().box(x + 0.135 * s, cy + 0.14 * s, 0, 0.015 * s, 0.06 * s, 0.09 * s);
    k.metal().box(x - 0.12 * s, y + 0.04 * s, 0, 0.08 * s, 0.08 * s, 0.1 * s);
    k.metal().box(x + 0.12 * s, y + 0.04 * s, 0, 0.08 * s, 0.08 * s, 0.1 * s);
    return true;
  }
  if (id === 'laserbox') {
    // A laser module slung low off the right side on a short arm (the Canted Dot sits higher, on a longer arm): a long
    // cylinder with a bright lens, the one optic that reaches forward of the rail.
    const z = 0.24 * s;
    k.dark().box(x, y + 0.035 * s, 0.08 * s, 0.14 * s, 0.07 * s, 0.22 * s);
    k.dark().prismX(x - 0.16 * s, x + 0.2 * s, y + 0.07 * s, z, 0.065 * s, 0.065 * s, 8, OCT);
    k.accent().prismX(x + 0.2 * s, x + 0.215 * s, y + 0.07 * s, z, 0.05 * s, 0.05 * s, 8, OCT);
    k.metal().box(x - 0.06 * s, y + 0.14 * s, z, 0.09 * s, 0.04 * s, 0.07 * s);
    return true;
  }
  return false;
}

// ---- Barrels: from the muzzle (x, y, z) outward, r the barrel's radius. Returns the new muzzle x, or null. ----
export function fitBarrelW2(k, id, x, y, z, r, len = 0.5) {
  const b = k.b;
  if (id === 'flashhider') {
    // A birdcage: four bars in an X around the bore, closed by a ring at the front.
    k.dark().prismX(x - 0.02, x + 0.05, y, z, r * 0.95, r * 0.95, 6);
    k.metal();
    for (const [dy, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.box(x + 0.12, y + dy * r * 0.62, z + dz * r * 0.62, 0.16, r * 0.32, r * 0.32);
    k.dark().prismX(x + 0.19, x + 0.23, y, z, r, r, 6);
    k.accent().prismX(x + 0.05, x + 0.07, y, z, r * 0.5, r * 0.5, 6);
    return x + 0.23;
  }
  if (id === 'muzzlebrake') {
    // A tank-style brake: a square core with three wide baffle plates, the widest thing on the gun from above.
    k.metal().box(x + 0.13, y, z, 0.26, r * 1.6, r * 1.6, 0.02);
    k.dark(); for (const dx of [0.05, 0.13, 0.21]) b.box(x + dx, y, z, 0.04, r * 1.9, r * 4.2, 0.01);
    k.accent().box(x + 0.265, y, z, 0.015, r * 1.1, r * 1.1);
    return x + 0.27;
  }
  if (id === 'ventrib') return fitVentRib(k, x, y, [z], r, y + r);
  return null;
}

// Vent Rib: each tube runs on a little, under one raised rib on posts with a bright bead at the front. zs lists the
// tubes side by side at height y (radius r); the rib sits at ribY. Returns the muzzle x.
export function fitVentRib(k, x, y, zs, r, ribY) {
  const b = k.b, len = 0.22;
  for (const z of zs) k.metal().prismX(x - 0.01, x + len, y, z, r * 0.92, r * 0.92, 8, OCT);
  const zc = zs.reduce((a, z) => a + z, 0) / zs.length;
  k.dark().box(x - 0.08, ribY + 0.05, zc, 0.6, 0.025, 0.09);
  k.metal(); for (let i = 0; i < 5; i++) b.box(x - 0.34 + i * 0.13, ribY + 0.02, zc, 0.03, 0.05, 0.06);
  k.accent().box(x + 0.2, ribY + 0.08, zc, 0.035, 0.035, 0.035);
  return x + len + 0.01;
}

// ---- Rear-grip parts, wrapped round a grip at x that drops `drop` below y = oy, `w` wide, centred on z. ----
export const W2_WRAPS = new Set(['rubber', 'thumbrest', 'beavertail']);
export function fitWrapW2(k, x, drop, w, id, z = 0, oy = 0) {
  const b = k.b;
  if (id === 'rubber') {
    // A fat rubber sleeve over the grip, with dark finger ridges down the front.
    k.grip().box(x - 0.03, oy - drop * 0.52, z, 0.24, drop * 0.66, w + 0.05, 0.04);
    k.dark(); for (const f of [0.32, 0.52, 0.72]) b.box(x + 0.09 - 0.07 * f, oy - drop * f, z, 0.05, 0.035, w + 0.07);
    return true;
  }
  if (id === 'thumbrest') {
    // A shelf sticking out of the grip's right side, edged bright: it shows from above and on the bench.
    k.grip().box(x, oy - drop * 0.18, z + w / 2 + 0.06, 0.24, 0.05, 0.13, 0.02);
    k.accent().box(x, oy - drop * 0.18 + 0.03, z + w / 2 + 0.115, 0.2, 0.015, 0.02);
    return true;
  }
  if (id === 'beavertail') {
    // A metal tail sweeping back over the web of the hand from the top of the grip.
    k.metal().extrude([[x - 0.08, oy + 0.03], [x - 0.3, oy + 0.08], [x - 0.34, oy + 0.03], [x - 0.13, oy - 0.07]], z - w / 2, z + w / 2);
    k.accent().box(x - 0.24, oy + 0.075, z, 0.1, 0.02, w * 0.6);
    return true;
  }
  return false;
}

// ---- Magazines: the shared look (guns.js MAG_LOOK) for guns that build their magazine from it. ----
export const W2_MAG_LOOK = {
  subsonic: { len: 1, part: 'grip', tab: true },     // A dark polymer mag with a bright base tab.
  magnum:   { len: 1.25, part: 'grip', tab: true },  // Fewer but fatter shells: a bigger, darker magazine.
  flitewad: { len: 0.92, part: 'metal' },
};

// Shotguns that keep their shells on the stock (Thresher, Doublet, Railspike, Thistle): a cuff at (x, y) on the side z.
// Magnum Shells: three fat shells in a dark cuff. Flite Wads: a metal strip of four small bright wads.
export function fitShellCuff(k, id, x, y, z) {
  const b = k.b, side = Math.sign(z) || 1;
  if (id === 'magnum') {
    k.dark().box(x, y, z, 0.36, 0.17, 0.05, 0.01);
    k.accent(); for (let i = 0; i < 3; i++) b.prismZ(Math.min(z, z + side * 0.05), Math.max(z, z + side * 0.05), x - 0.11 + i * 0.11, y, 0.05, 0.05, 6);
    return true;
  }
  if (id === 'flitewad') {
    k.metal().box(x, y, z, 0.34, 0.08, 0.04, 0.01);
    k.accent(); for (let i = 0; i < 4; i++) b.prismZ(Math.min(z, z + side * 0.04), Math.max(z, z + side * 0.04), x - 0.12 + i * 0.08, y, 0.028, 0.028, 6);
    return true;
  }
  return false;
}

// ---- Launchers. Guide Rail: a sighting rail along the tube's right side on two brackets. ----
export function fitGuideRail(k, x0, x1, y, r) {
  const z = r + 0.05;
  k.metal().box((x0 + x1) / 2, y, z, x1 - x0, 0.075, 0.06, 0.01);
  k.dark().box(x0 + 0.1, y, z - 0.03, 0.06, 0.07, 0.07);
  k.dark().box(x1 - 0.1, y, z - 0.03, 0.06, 0.07, 0.07);
  k.accent().box(x1 - 0.02, y + 0.05, z, 0.03, 0.06, 0.03);
}
// Venturi Nozzle: a flared bell `len` long at a tube's end (x, facing dir +1 forward or -1 back), radius r widening by `flare`.
export function fitVenturi(k, x, y, z, r, dir = -1, len = 0.22, flare = 1.75) {
  const x1 = x + dir * len;
  k.dark().prismX(Math.min(x, x1), Math.max(x, x1), y, z, dir < 0 ? r * flare : r, dir < 0 ? r : r * flare, 8, OCT);
  k.accent().prismX(Math.min(x1, x1 - dir * 0.03), Math.max(x1, x1 - dir * 0.03), y, z, r * flare * 1.03, r * flare * 1.03, 8, OCT);
  k.metal().prismX(Math.min(x, x - dir * 0.05), Math.max(x, x - dir * 0.05), y, z, r * 1.1, r * 1.1, 8, OCT);
}
