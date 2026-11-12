// The V10 arsenal's sixteen models and the look of the eight V10 attachments. Same conventions as guns.js (model
// space in metres, +X muzzle, +Y up, +Z to the shooter's right, origin at the firing hand; parts tagged body / grip /
// metal / accent, camos on body only) and the same rule: every silhouette has to be unmistakable from directly above.
// guns.js hands its shared part builders in (`h`), so this file imports nothing from it and the two cannot drift.

const OCT = Math.PI / 8;

// ---- Attachment looks. Each returns true (or a muzzle x) when the id is one of ours, so guns.js falls through. ----

// Steady Glass: a mid-length tube with a deep sunshade and a tall top turret. Ghost Ring: an open rear ring and a
// front post, the lowest sight there is.
export function fitOpticV10(k, id, x, y, s = 1) {
  if (id === 'steady') {
    const cy = y + 0.18 * s;
    k.dark().prismX(x - 0.3 * s, x + 0.3 * s, cy, 0, 0.085 * s, 0.085 * s, 8, OCT);
    k.metal().prismX(x + 0.3 * s, x + 0.52 * s, cy, 0, 0.125 * s, 0.125 * s, 8, OCT);       // Sunshade.
    k.accent().prismX(x + 0.3 * s, x + 0.315 * s, cy, 0, 0.14 * s, 0.14 * s, 8, OCT);
    k.metal().prismY(cy + 0.06 * s, cy + 0.2 * s, x, 0, 0.055 * s, 0.055 * s, 8);           // Turret.
    k.accent().prismY(cy + 0.2 * s, cy + 0.22 * s, x, 0, 0.06 * s, 0.06 * s, 8);
    k.dark().box(x - 0.14 * s, y + 0.05 * s, 0, 0.08 * s, 0.1 * s, 0.1 * s);
    k.dark().box(x + 0.14 * s, y + 0.05 * s, 0, 0.08 * s, 0.1 * s, 0.1 * s);
    return true;
  }
  if (id === 'ghostring') {
    const r = 0.1 * s;
    k.dark().box(x - 0.16 * s, y + 0.03 * s, 0, 0.07 * s, 0.06 * s, 0.26 * s);              // Rear ring, open in the middle.
    k.dark().box(x - 0.16 * s, y + 0.13 * s, -r, 0.07 * s, 0.2 * s, 0.05 * s);
    k.dark().box(x - 0.16 * s, y + 0.13 * s, r, 0.07 * s, 0.2 * s, 0.05 * s);
    k.dark().box(x - 0.16 * s, y + 0.23 * s, 0, 0.07 * s, 0.04 * s, 0.26 * s);
    k.metal().box(x + 0.18 * s, y + 0.1 * s, 0, 0.05 * s, 0.2 * s, 0.05 * s);                // Front post.
    k.accent().box(x + 0.18 * s, y + 0.21 * s, 0, 0.055 * s, 0.04 * s, 0.07 * s);
    return true;
  }
  return false;
}

// Breacher Muzzle: a fat crown of four teeth. Free-Float Barrel: a long slotted tube with the barrel just showing.
export function fitBarrelV10(k, id, x, y, z, r, len = 0.5) {
  const b = k.b;
  if (id === 'breacher') {
    k.dark().prismX(x - 0.02, x + 0.12, y, z, r * 1.35, r * 1.35, 8, OCT);
    k.metal();
    for (const [dy, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) b.box(x + 0.17, y + dy * r, z + dz * r, 0.12, r * 0.7, r * 0.7);
    k.accent().prismX(x + 0.1, x + 0.125, y, z, r * 1.45, r * 1.45, 8, OCT);
    return x + 0.22;
  }
  if (id === 'floated') {
    const l = len * 0.9;
    k.dark().prismX(x, x + l, y, z, r * 1.2, r * 1.2, 8, OCT);
    k.metal(); for (let i = 0; i < 3; i++) b.box(x + l * (0.2 + i * 0.28), y + r * 1.1, z, l * 0.16, 0.03, r * 1.3);
    k.accent().prismX(x + l - 0.03, x + l, y, z, r * 1.3, r * 1.3, 8, OCT);
    k.metal().prismX(x + l, x + l + 0.12, y, z, r * 0.6, r * 0.6, 6);
    return x + l + 0.13;
  }
  return null;
}

// Folding Bipod: two legs folded forward either side of the barrel, feet out past the gun's width. Hand Stop: a
// small hooked wedge under the handguard.
export function fitForegripV10(k, id, x, y) {
  if (id === 'bipod') {
    k.dark().box(x - 0.08, y - 0.03, 0, 0.1, 0.09, 0.34);
    for (const s of [-1, 1]) {
      k.metal().box(x + 0.2, y - 0.04, s * 0.17, 0.52, 0.04, 0.04);
      k.accent().box(x + 0.47, y - 0.04, s * 0.19, 0.06, 0.07, 0.09);
    }
    return true;
  }
  if (id === 'handstop') {
    k.grip().extrude([[x - 0.12, y], [x + 0.1, y], [x + 0.1, y - 0.14], [x + 0.02, y - 0.14], [x - 0.06, y - 0.05]], -0.06, 0.06);
    k.accent().box(x + 0.1, y - 0.07, 0, 0.02, 0.1, 0.13);
    return true;
  }
  return false;
}

// Ammo Satchel: the magazine in the gun's own colour with a tab. Taped Mags: a longer, bright pair.
export const V10_MAG_LOOK = {
  satchel:  { len: 1.1, part: 'body2', tab: true },
  tapedmag: { len: 1.2, part: 'metal' },
};

// ---- Guns ----
export function v10Factories(h) {
  const { kit, pistolGrip, fitOptic, fitBarrel, fitForegrip, fitWrap, isWrap, fitStock, fitDrum, magLook, longGunGrips } = h;
  const { fitShellCuff, fitGuideRail, fitVenturi } = h;   // Wave 2 (guns-w2.js).
  const under = id => id === 'angled' || id === 'vertical' || id === 'handstop';

  // A plain fixed stock: wedge from the receiver back to a padded butt at (bx, by).
  function stock(k, x0, y0, y1, bx, by, hw = 0.1) {
    k.body().extrude([[x0, y1], [x0, y0], [x0 - 0.24, y0 - 0.1], [bx, by - 0.14], [bx, by + 0.14], [x0 - 0.24, y1 - 0.02]], -hw, hw);
    k.grip().box(bx - 0.03, by, 0, 0.07, 0.32, hw * 2 + 0.04, 0.02);
  }

  // Flywheel: an ordinary rifle with a spinning mass housed in a drum that sticks out both sides of the receiver.
  // From above: a rifle with a fat disc through its middle.
  function rampar(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.3, -0.02], [0.46, -0.02], [0.5, 0.04], [0.5, 0.24], [0.36, 0.29], [-0.22, 0.29], [-0.3, 0.2]], -0.13, 0.13);
    k.body2().prismZ(-0.27, 0.27, 0.16, 0.13, 0.2, 0.2, 10);                                  // Flywheel housing.
    k.dark().prismZ(-0.29, -0.27, 0.16, 0.13, 0.15, 0.15, 10);
    k.dark().prismZ(0.27, 0.29, 0.16, 0.13, 0.15, 0.15, 10);
    k.accent().prismZ(-0.31, -0.29, 0.16, 0.13, 0.06, 0.06, 6);
    k.accent().prismZ(0.29, 0.31, 0.16, 0.13, 0.06, 0.06, 6);
    k.body().box(0.76, 0.12, 0, 0.52, 0.19, 0.19, 0.03);                                      // Square handguard.
    k.dark(); for (let i = 0; i < 4; i++) b.box(0.58 + i * 0.12, 0.12, 0, 0.035, 0.22, 0.22);
    k.metal().prismX(1.02, 1.2, 0.12, 0, 0.055, 0.055, 6);
    const mx = fitBarrel(k, a.barrel, 1.2, 0.12, 0, 0.1, 0.5);
    if (mx === null) k.dark().prismX(1.18, 1.36, 0.12, 0, 0.085, 0.11, 8, OCT);              // Flared cone.
    stock(k, -0.3, -0.02, 0.22, -0.92, 0.04);
    if (a.optic) fitOptic(k, a.optic, 0.02, 0.29);
    else { k.dark().box(-0.12, 0.33, 0, 0.1, 0.08, 0.12); k.accent().box(0.42, 0.31, 0, 0.05, 0.06, 0.04); }
    k[m.part]().extrude([[0.28, -0.02], [0.46, -0.02], [0.52 + 0.05 * f, -0.42 * f], [0.34 + 0.05 * f, -0.46 * f]], -0.085, 0.085);
    if (m.tab) k.accent().box(0.43 + 0.05 * f, -0.46 * f, 0, 0.18, 0.05, 0.12);
    if (m.drum) fitDrum(k, 0.38, -0.2);
    const fore = longGunGrips(k, a, -0.05, 0.34, 0.13, 0.78, 0.02, -0.95, 0.04);
    return { geometry: b.build(), muzzle: [mx === null ? 1.36 : mx, 0.12, 0], fore, eject: [0.1, 0.24, 0.14], length: 2.3 };
  }

  // Kiln: the barrel sits inside a stack of wide cooling fins with a glowing core strip, and the magazine is a fat
  // four-column casket. From above: a comb of fins twice the width of the gun.
  function heatar(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.32, -0.02], [0.44, -0.02], [0.44, 0.28], [-0.24, 0.28], [-0.32, 0.2]], -0.14, 0.14);
    k.body2().prismX(0.44, 1.16, 0.13, 0, 0.09, 0.09, 8, OCT);
    k.metal(); for (let i = 0; i < 7; i++) b.box(0.5 + i * 0.1, 0.13, 0, 0.035, 0.3, 0.44, 0.03);   // Fins.
    k.accent().box(0.8, 0.29, 0, 0.66, 0.02, 0.05);                                           // Core strip, top.
    k.metal().prismX(1.16, 1.26, 0.13, 0, 0.06, 0.06, 6);
    const mx = fitBarrel(k, a.barrel, 1.26, 0.13, 0, 0.1, 0.46);
    if (mx === null) k.dark().box(1.3, 0.13, 0, 0.1, 0.18, 0.18, 0.03);
    stock(k, -0.32, -0.02, 0.22, -0.96, 0.04, 0.11);
    if (a.optic) fitOptic(k, a.optic, 0.08, 0.28);
    else { k.body2().box(0.06, 0.33, 0, 0.36, 0.1, 0.08); k.accent().box(0.24, 0.39, 0, 0.04, 0.03, 0.1); }
    k[m.part]().box(0.2, -0.02 - 0.2 * f, 0, 0.24, 0.4 * f, 0.26, 0.03);                       // Casket magazine.
    if (m.tab) k.accent().box(0.2, -0.04 - 0.4 * f, 0, 0.2, 0.04, 0.28);
    if (m.drum) fitDrum(k, 0.2, -0.22, 0.26);
    const fore = longGunGrips(k, a, -0.05, 0.34, 0.14, 0.8, -0.03, -0.99, 0.04);
    return { geometry: b.build(), muzzle: [mx === null ? 1.36 : mx, 0.13, 0], fore, eject: [0.08, 0.26, 0.15], length: 2.35 };
  }

  // Murmur: more suppressor than gun. A short receiver, a folded wire stock along the right side and a fat integral
  // can for the whole front half. From above: a thick cigar with a thin wire beside it.
  function hushsmg(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.26, 0], [0.34, 0], [0.34, 0.26], [-0.2, 0.26], [-0.26, 0.2]], -0.11, 0.11);
    const bx = a.barrel === 'stub' || a.barrel === 'breacher' ? 0.86 : 1.12;
    k.dark().prismX(0.34, bx, 0.13, 0, 0.12, 0.12, 8, OCT);                                   // The can.
    k.body2(); for (let i = 0; i < 3; i++) b.prismX(0.42 + i * 0.2, 0.48 + i * 0.2, 0.13, 0, 0.13, 0.13, 8, OCT);
    k.accent().prismX(bx - 0.03, bx, 0.13, 0, 0.125, 0.125, 8, OCT);
    k.dark().prismX(bx, bx + 0.03, 0.13, 0, 0.12, 0.05, 8, OCT);
    const mx = fitBarrel(k, a.barrel, bx + 0.02, 0.13, 0, 0.09, 0.3);
    // Wire stock folded forward along the right side.
    k.metal().box(0.1, 0.2, 0.15, 0.78, 0.03, 0.03);
    k.metal().box(0.1, 0.06, 0.15, 0.78, 0.03, 0.03);
    k.grip().box(0.5, 0.13, 0.16, 0.05, 0.2, 0.05);
    k.metal().box(-0.3, 0.13, 0.08, 0.08, 0.2, 0.16);
    if (a.optic) fitOptic(k, a.optic, 0.04, 0.26, 0.85);
    else { k.dark().box(-0.14, 0.29, 0, 0.06, 0.06, 0.12); k.accent().box(0.26, 0.28, 0, 0.04, 0.05, 0.04); }
    k[m.part]().box(0.14, -0.22 * f, 0, 0.12, 0.44 * f, 0.09, 0.02);                           // Straight stick.
    if (m.tab) k.accent().box(0.14, -0.44 * f - 0.02, 0, 0.15, 0.04, 0.11);
    if (m.drum) fitDrum(k, 0.14, -0.1, 0.2);
    pistolGrip(k, -0.08, 0.3, 0.12);
    if (isWrap(a.grip)) fitWrap(k, -0.08, 0.3, 0.12, a.grip);
    else fitForegrip(k, a.grip, 0.62, 0.02);
    fitStock(k, a.grip, -0.32, 0.12);
    const fore = under(a.grip) ? [0.62, -0.12, 0] : [0.6, 0.02, 0];
    return { geometry: b.build(), muzzle: [mx === null ? bx + 0.04 : mx, 0.13, 0], fore, eject: [0.08, 0.26, 0.12], length: 1.6 };
  }

  // Hopper: a flat pan drum lying on top of the receiver, wider than the gun, over a slotted jacket and a stubby
  // wooden-shaped stock. From above the pan is the whole gun.
  function drumsmg(a) {
    const k = kit(), b = k.b, m = magLook(a.mag);
    const pan = 0.3 * Math.sqrt(m.len);
    k.body().extrude([[-0.28, -0.02], [0.4, -0.02], [0.4, 0.22], [-0.22, 0.22], [-0.28, 0.16]], -0.12, 0.12);
    k[m.part]().prismY(0.22, 0.34, 0.1, 0, pan, pan, 10);                                     // Pan drum.
    k.metal().prismY(0.34, 0.37, 0.1, 0, pan * 0.55, pan * 0.55, 10);
    k.accent().prismY(0.37, 0.39, 0.1, 0, pan * 0.2, pan * 0.2, 6);
    if (m.tab) k.accent().prismY(0.2, 0.22, 0.1, 0, pan * 1.04, pan * 1.04, 10);
    k.body2().prismX(0.4, 0.94, 0.11, 0, 0.1, 0.1, 8, OCT);                                    // Jacket.
    k.dark(); for (let i = 0; i < 4; i++) b.box(0.48 + i * 0.12, 0.11, 0, 0.06, 0.05, 0.23);
    k.metal().prismX(0.94, 1.02, 0.11, 0, 0.055, 0.055, 6);
    const mx = fitBarrel(k, a.barrel, 1.02, 0.11, 0, 0.09, 0.36);
    if (mx === null) k.dark().prismX(1.0, 1.1, 0.11, 0, 0.075, 0.095, 6);
    k.body().extrude([[-0.28, 0.16], [-0.28, -0.02], [-0.5, -0.1], [-0.84, -0.16], [-0.84, 0.1], [-0.5, 0.16]], -0.09, 0.09);
    k.grip().box(-0.87, -0.03, 0, 0.06, 0.28, 0.2, 0.02);
    // The pan covers the rail, so an optic rides forward on the jacket.
    if (a.optic) fitOptic(k, a.optic, 0.66, 0.2, 0.8);
    else k.accent().box(0.9, 0.24, 0, 0.04, 0.06, 0.04);
    pistolGrip(k, -0.06, 0.32, 0.13);
    if (isWrap(a.grip)) fitWrap(k, -0.06, 0.32, 0.13, a.grip);
    else if (under(a.grip) || a.grip) fitForegrip(k, a.grip, 0.64, 0.0);
    if (!under(a.grip)) k.grip().box(0.62, -0.03, 0, 0.3, 0.08, 0.14, 0.02);                  // Its own wooden fore-end.
    fitStock(k, a.grip, -0.88, -0.03);
    const fore = under(a.grip) ? [0.64, -0.14, 0] : [0.62, -0.03, 0];
    return { geometry: b.build(), muzzle: [mx === null ? 1.1 : mx, 0.11, 0], fore, eject: [0.2, 0.2, 0.14], length: 1.95 };
  }

  // Trammel: a slab-sided receiver on a thick straight box magazine, a square heat shield over the barrel and a
  // brick of a brake. From above: all rectangles, with the magazine's shoulders showing either side.
  function magshot(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    const sawn = a.barrel === 'sawnoff', end = sawn ? 0.96 : 1.24;
    k.body().extrude([[-0.3, -0.02], [0.44, -0.02], [0.44, 0.3], [-0.24, 0.3], [-0.3, 0.22]], -0.14, 0.14);
    k.metal().prismX(0.44, end, 0.13, 0, 0.075, 0.075, 8, OCT);
    k.body2().box((0.5 + end - 0.12) / 2, 0.23, 0, end - 0.62, 0.05, 0.22);                    // Heat shield.
    k.dark(); for (let x = 0.58; x < end - 0.16; x += 0.11) b.box(x, 0.235, 0, 0.05, 0.05, 0.16);
    k.grip().box(0.7, 0.04, 0, 0.36, 0.12, 0.2, 0.03);                                         // Fixed fore-end.
    let mx = fitBarrel(k, a.barrel, end, 0.13, 0, 0.1, 0.4);
    if (a.barrel === 'choke') { k.dark().prismX(end, end + 0.16, 0.13, 0, 0.1, 0.08, 8, OCT); mx = end + 0.16; }
    else if (a.barrel === 'rifled') { k.metal().prismX(end, end + 0.3, 0.13, 0, 0.07, 0.07, 6); k.accent().prismX(end + 0.26, end + 0.3, 0.13, 0, 0.09, 0.09, 6); mx = end + 0.3; }
    else if (mx === null) { k.dark().box(end + 0.07, 0.13, 0, 0.16, 0.2, 0.26, 0.02); k.metal().box(end + 0.07, 0.13, 0, 0.05, 0.22, 0.3); mx = end + 0.15; }
    stock(k, -0.3, -0.02, 0.24, -0.9, 0.02, 0.11);
    if (a.optic) fitOptic(k, a.optic, 0.06, 0.3);
    else k.accent().box(0.34, 0.33, 0, 0.05, 0.06, 0.05);
    k[m.part]().box(0.2, -0.02 - 0.19 * f, 0, 0.26, 0.38 * f, 0.2, 0.02);                      // Straight box magazine.
    k.accent().box(0.2, -0.05, 0, 0.28, 0.03, 0.22);
    if (m.tab) k.accent().box(0.2, -0.04 - 0.38 * f, 0, 0.2, 0.04, 0.16);
    pistolGrip(k, -0.06, 0.34, 0.14);
    if (isWrap(a.grip)) fitWrap(k, -0.06, 0.34, 0.14, a.grip);
    else fitForegrip(k, a.grip, 0.72, -0.02);
    fitStock(k, a.grip, -0.93, 0.02);
    const fore = under(a.grip) ? [0.72, -0.16, 0] : [0.7, 0.02, 0];
    return { geometry: b.build(), muzzle: [mx, 0.13, 0], fore, eject: [0.1, 0.26, 0.16], length: mx + 1 };
  }

  // Thistle: a long thin barrel that ends in a spiked choke, a ribbed pump under it and a row of bright darts in a
  // saddle on the right. From above: a needle with a burr on the end.
  function flechette(a) {
    const k = kit(), b = k.b;
    const sawn = a.barrel === 'sawnoff', end = sawn ? 1.08 : 1.5;
    k.body().extrude([[-0.28, 0], [0.36, 0], [0.4, 0.05], [0.4, 0.22], [-0.2, 0.22], [-0.28, 0.14]], -0.1, 0.1);
    k.metal().prismX(0.4, end, 0.15, 0, 0.045, 0.04, 6);                                       // Thin barrel.
    k.dark().prismX(0.4, end - 0.3, 0.05, 0, 0.045, 0.045, 6);                                 // Tube.
    k.grip().prismX(0.62, 0.98, 0.07, 0, 0.09, 0.09, 8, OCT);                                  // Pump.
    k.dark(); for (let i = 0; i < 3; i++) b.prismX(0.67 + i * 0.1, 0.71 + i * 0.1, 0.07, 0, 0.1, 0.1, 8, OCT);
    let mx = fitBarrel(k, a.barrel, end, 0.15, 0, 0.08, 0.4);
    if (a.barrel === 'rifled') { k.metal().prismX(end, end + 0.3, 0.15, 0, 0.06, 0.06, 6); mx = end + 0.3; }
    else if (mx === null) {
      // Spiked choke: a flared cup with four prongs. The Tight Choke closes the cup instead.
      const tight = a.barrel === 'choke';
      k.dark().prismX(end - 0.02, end + 0.14, 0.15, 0, 0.06, tight ? 0.07 : 0.12, 8, OCT);
      k.accent();
      const r = tight ? 0.07 : 0.12;
      for (const [dy, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) b.box(end + 0.18, 0.15 + dy * r, dz * r, 0.12, 0.03, 0.03);
      mx = end + 0.24;
    }
    k.accent(); for (let i = 0; i < 5; i++) b.box(-0.1 + i * 0.09, 0.12, 0.125, 0.04, 0.14, 0.035);   // Dart saddle.
    fitShellCuff(k, a.mag, -0.62, -0.02, -0.105);                                             // Wave 2 shells.
    k.body().extrude([[-0.28, 0.14], [-0.28, 0], [-0.52, -0.1], [-0.92, -0.18], [-0.92, 0.08], [-0.52, 0.16]], -0.08, 0.08);
    k.grip().box(-0.95, -0.05, 0, 0.06, 0.28, 0.18, 0.02);
    if (a.optic) fitOptic(k, a.optic, 0.04, 0.22, 0.9);
    else k.accent().box(end - 0.08, 0.21, 0, 0.04, 0.05, 0.03);
    pistolGrip(k, -0.08, 0.28, 0.11);
    if (isWrap(a.grip)) fitWrap(k, -0.08, 0.28, 0.11, a.grip);
    fitStock(k, a.grip, -0.96, -0.05);
    return { geometry: b.build(), muzzle: [mx, 0.15, 0], fore: [0.8, 0.0, 0], eject: [0.1, 0.22, 0.12], length: mx + 1 };
  }

  // Stanchion: a long belt gun with an ammunition box hung off its right side, a bright belt running over the top
  // cover into it, a carry handle and a quick-change barrel with a collar. From above: lopsided, box on one side.
  function beltlmg(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = Math.sqrt(m.len);
    k.body().extrude([[-0.34, -0.04], [0.56, -0.04], [0.6, 0.02], [0.6, 0.26], [-0.26, 0.26], [-0.34, 0.18]], -0.13, 0.13);
    k[m.part]().box(0.18, 0.02, 0.3 + 0.04 * f, 0.4 * f, 0.34, 0.26, 0.03);                    // Ammunition box, right.
    k.accent().box(0.18, 0.21, 0.3 + 0.04 * f, 0.3 * f, 0.03, 0.2);
    k.accent().box(0.18, 0.28, 0.1, 0.16, 0.035, 0.34);                                       // Belt over the top cover.
    if (m.tab) k.accent().box(0.18, -0.16, 0.3 + 0.04 * f, 0.2, 0.03, 0.28);
    k.body2().box(0.16, 0.29, -0.03, 0.56, 0.05, 0.2);                                          // Top cover.
    k.metal().prismX(0.6, 1.5, 0.12, 0, 0.065, 0.055, 8, OCT);                                 // Heavy barrel.
    k.dark().prismX(0.6, 0.74, 0.12, 0, 0.11, 0.11, 8, OCT);                                   // Barrel collar.
    k.dark().box(0.86, 0.3, 0, 0.3, 0.035, 0.05);                                              // Carry handle.
    k.dark().box(0.74, 0.22, 0, 0.04, 0.16, 0.05);
    k.dark().box(0.98, 0.22, 0, 0.04, 0.16, 0.05);
    k.body().box(0.92, 0.02, 0, 0.44, 0.1, 0.16, 0.02);                                        // Fore-end.
    const mx = fitBarrel(k, a.barrel, 1.5, 0.12, 0, 0.1, 0.5);
    if (mx === null) { k.dark().prismX(1.48, 1.64, 0.12, 0, 0.08, 0.08, 6); k.accent().prismX(1.56, 1.58, 0.12, 0, 0.09, 0.09, 6); }
    stock(k, -0.34, -0.04, 0.2, -1.0, 0.02, 0.1);
    if (a.optic) fitOptic(k, a.optic, -0.08, 0.31);
    else { k.dark().box(-0.2, 0.33, 0, 0.06, 0.1, 0.14); k.accent().box(1.44, 0.2, 0, 0.04, 0.07, 0.03); }
    const fore = longGunGrips(k, a, -0.08, 0.34, 0.14, 0.94, -0.03, -1.03, 0.02);
    return { geometry: b.build(), muzzle: [mx === null ? 1.64 : mx, 0.12, 0], fore, eject: [0.2, 0.2, -0.16], length: 2.7 };
  }

  // Tandem: two barrels side by side from a wide flat receiver, joined at the muzzle by a twin-port brake, with a
  // short scope and a straight stock. From above: a tuning fork closed at the end.
  function twinshot(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.3, 0], [0.5, 0], [0.54, 0.05], [0.54, 0.22], [-0.22, 0.22], [-0.3, 0.14]], -0.16, 0.16);
    const end = 1.4;
    for (const s of [-1, 1]) {
      k.metal().prismX(0.54, end, 0.12, s * 0.085, 0.05, 0.045, 6);
      k.body2().prismX(0.54, 0.9, 0.12, s * 0.085, 0.075, 0.065, 6);
    }
    k.dark().box(0.72, 0.12, 0, 0.3, 0.05, 0.06);                                              // Web between the barrels.
    const mx = fitBarrel(k, a.barrel, end, 0.12, 0, 0.13, 0.5);
    if (mx === null) {
      k.dark().box(end + 0.07, 0.12, 0, 0.18, 0.15, 0.36, 0.02);
      k.accent().box(end + 0.165, 0.12, -0.085, 0.01, 0.07, 0.07);
      k.accent().box(end + 0.165, 0.12, 0.085, 0.01, 0.07, 0.07);
    }
    stock(k, -0.3, 0, 0.16, -0.98, 0.0, 0.1);
    if (a.optic) fitOptic(k, a.optic, 0.12, 0.22);
    else {
      k.dark().prismX(-0.1, 0.4, 0.33, 0, 0.075, 0.075, 8, OCT);                               // Short scope.
      k.dark().prismX(0.34, 0.48, 0.33, 0, 0.075, 0.11, 8, OCT);
      k.accent().prismX(0.48, 0.495, 0.33, 0, 0.09, 0.09, 8, OCT);
      k.metal().box(0.14, 0.24, 0, 0.1, 0.08, 0.1);
    }
    k[m.part]().box(0.24, -0.16 * f, 0, 0.2, 0.32 * f, 0.22, 0.02);                            // Wide double-stack magazine.
    if (m.tab) k.accent().box(0.24, -0.32 * f - 0.02, 0, 0.16, 0.04, 0.24);
    if (m.drum) fitDrum(k, 0.24, -0.1);
    const fore = longGunGrips(k, a, -0.05, 0.32, 0.13, 0.86, 0.04, -1.01, 0.0);
    return { geometry: b.build(), muzzle: [mx === null ? end + 0.17 : mx, 0.12, 0], fore, eject: [0.1, 0.22, 0.17], length: 2.55 };
  }

  // Nightjar: a bullpup. The magazine sits behind the grip in a deep thumbhole butt, and a slim suppressor longer
  // than the fore-end carries on from it. From above: thick at the shoulder, a long thin stem in front.
  function hushdmr(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.86, -0.1], [-0.2, -0.1], [-0.12, 0], [0.5, 0], [0.56, 0.06], [0.56, 0.22], [-0.8, 0.26], [-0.86, 0.2]], -0.12, 0.12);
    k.grip().box(-0.89, 0.06, 0, 0.06, 0.34, 0.26, 0.02);
    k.dark().box(-0.5, 0.06, 0, 0.2, 0.1, 0.25);                                               // Thumbhole (reads as a slot).
    const bx = a.barrel === 'stub' ? 1.0 : 1.5;
    k.metal().prismX(0.56, 0.7, 0.12, 0, 0.05, 0.05, 6);
    k.dark().prismX(0.7, bx, 0.12, 0, 0.075, 0.075, 8, OCT);                                   // Slim suppressor.
    k.accent().prismX(0.7, 0.73, 0.12, 0, 0.085, 0.085, 8, OCT);
    k.accent().prismX(bx - 0.14, bx - 0.11, 0.12, 0, 0.085, 0.085, 8, OCT);
    const mx = fitBarrel(k, a.barrel, bx, 0.12, 0, 0.08, 0.36);
    if (a.optic) fitOptic(k, a.optic, 0.12, 0.23);
    else {
      k.dark().prismX(-0.08, 0.34, 0.34, 0, 0.07, 0.07, 8, OCT);
      k.accent().prismX(0.34, 0.355, 0.34, 0, 0.075, 0.075, 8, OCT);
      k.metal().box(0.12, 0.25, 0, 0.12, 0.08, 0.08);
    }
    k[m.part]().extrude([[-0.62, -0.1], [-0.42, -0.1], [-0.46, -0.1 - 0.3 * f], [-0.64, -0.1 - 0.3 * f]], -0.07, 0.07);   // Magazine behind the grip.
    if (m.tab) k.accent().box(-0.55, -0.12 - 0.3 * f, 0, 0.16, 0.04, 0.1);
    if (m.drum) fitDrum(k, -0.52, -0.22, 0.2);
    pistolGrip(k, 0.0, 0.32, 0.12);
    if (isWrap(a.grip)) fitWrap(k, 0.0, 0.32, 0.12, a.grip);
    else fitForegrip(k, a.grip, 0.38, 0.0);
    fitStock(k, a.grip, -0.9, 0.06);
    const fore = under(a.grip) ? [0.38, -0.14, 0] : [0.4, 0.02, 0];
    return { geometry: b.build(), muzzle: [mx === null ? bx + 0.02 : mx, 0.12, 0], fore, eject: [-0.5, 0.26, 0.13], length: bx + 0.95 };
  }

  // Harrier: a slim rifle with its scope mounted forward over the barrel instead of over the action, an open
  // skeleton butt and a pencil barrel. From above: the scope sits where no other rifle's does.
  function scout(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.28, 0.02], [0.44, 0.02], [0.5, 0.07], [0.5, 0.2], [-0.2, 0.2], [-0.28, 0.13]], -0.09, 0.09);
    k.body2().box(0.72, 0.09, 0, 0.46, 0.1, 0.14, 0.02);                                       // Slim fore-end.
    const end = a.barrel === 'fluted' ? 1.4 : 1.66;
    k.metal().prismX(0.5, end, 0.14, 0, 0.038, 0.034, 6);
    let mx = fitBarrel(k, a.barrel, end, 0.14, 0, 0.075, 0.5);
    if (a.barrel === 'fluted') { k.dark(); for (let i = 0; i < 3; i++) b.box(1.04 + i * 0.1, 0.14, 0, 0.04, 0.11, 0.11); mx = end; }
    else if (mx === null) { k.dark().prismX(end - 0.02, end + 0.1, 0.14, 0, 0.055, 0.055, 6); mx = end + 0.1; }
    // Skeleton butt: top and bottom rails and a pad, open between.
    k.body().box(-0.6, 0.15, 0, 0.66, 0.05, 0.1);
    k.body().extrude([[-0.28, 0.06], [-0.28, 0.01], [-0.9, -0.14], [-0.9, -0.08]], -0.05, 0.05);
    k.grip().box(-0.93, 0.02, 0, 0.06, 0.34, 0.16, 0.02);
    k.accent().box(-0.6, 0.185, 0, 0.3, 0.02, 0.11);                                           // Cheek rest.
    if (a.optic) fitOptic(k, a.optic, 0.72, 0.16, 0.9);
    else {
      k.dark().prismX(0.52, 1.02, 0.29, 0, 0.065, 0.065, 8, OCT);                              // Forward scope.
      k.dark().prismX(0.98, 1.12, 0.29, 0, 0.065, 0.1, 8, OCT);
      k.accent().prismX(1.12, 1.135, 0.29, 0, 0.085, 0.085, 8, OCT);
      k.metal().box(0.62, 0.2, 0, 0.07, 0.08, 0.08);
      k.metal().box(0.9, 0.2, 0, 0.07, 0.08, 0.08);
    }
    k.metal().box(0.02, 0.15, 0.11, 0.16, 0.04, 0.06);                                         // Straight-pull handle.
    k.accent().box(0.1, 0.15, 0.15, 0.05, 0.06, 0.05);
    k[m.part]().box(0.18, 0.02 - 0.11 * f, 0, 0.2, 0.22 * f, 0.1, 0.02);
    if (m.tab) k.accent().box(0.18, -0.22 * f, 0, 0.16, 0.04, 0.1);
    pistolGrip(k, -0.04, 0.28, 0.1);
    if (isWrap(a.grip)) fitWrap(k, -0.04, 0.28, 0.1, a.grip);
    else fitForegrip(k, a.grip, 0.76, 0.04);
    fitStock(k, a.grip, -0.94, 0.02);
    const fore = under(a.grip) ? [0.76, -0.1, 0] : [0.74, 0.05, 0];
    return { geometry: b.build(), muzzle: [mx, 0.14, 0], fore, eject: [0.08, 0.2, 0.1], length: mx + 1 };
  }

  // Lodestone: no barrel at all. Two long flat rails with a gap between them, bridged by bright coil blocks, and a
  // heavy capacitor pack where the action would be. From above: a two-pronged fork with glowing rungs.
  function rail(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.36, -0.04], [0.46, -0.04], [0.5, 0.02], [0.5, 0.28], [-0.28, 0.28], [-0.36, 0.2]], -0.16, 0.16);
    k.body2().box(0.02, 0.33, 0, 0.5, 0.1, 0.36, 0.03);                                        // Capacitor pack.
    k.accent(); for (let i = 0; i < 3; i++) b.box(-0.14 + i * 0.16, 0.385, 0, 0.07, 0.02, 0.3);
    const ext = a.barrel === 'heavybarrel' || a.barrel === 'floated' ? 0.3 : 0, end = (a.barrel === 'fluted' ? 1.6 : 1.9) + ext;
    for (const s of [-1, 1]) {
      k.metal().box((0.5 + end) / 2, 0.12, s * 0.1, end - 0.5, 0.12, 0.06);                    // Rails.
      k.dark().box((0.5 + end) / 2, 0.12, s * 0.145, end - 0.56, 0.05, 0.035);
    }
    k.accent(); for (let x = 0.66; x < end - 0.1; x += 0.24) b.box(x, 0.12, 0, 0.08, 0.14, 0.14);   // Coils.
    k.dark().box(end, 0.12, 0, 0.06, 0.2, 0.3, 0.02);                                          // Muzzle yoke.
    const brake = a.barrel === 'muzzlebrake' ? fitBarrel(k, 'muzzlebrake', end + 0.03, 0.12, 0, 0.1) : null;
    stock(k, -0.36, -0.04, 0.22, -1.04, 0.04, 0.11);
    if (a.optic) fitOptic(k, a.optic, 0.02, 0.38);
    else {
      k.dark().prismX(-0.3, 0.3, 0.5, 0, 0.08, 0.08, 8, OCT);
      k.dark().prismX(0.26, 0.42, 0.5, 0, 0.08, 0.12, 8, OCT);
      k.accent().prismX(0.42, 0.435, 0.5, 0, 0.1, 0.1, 8, OCT);
      k.metal().box(0.0, 0.41, 0, 0.1, 0.06, 0.1);
    }
    k[m.part]().box(0.22, -0.04 - 0.12 * f, 0, 0.3, 0.24 * f, 0.2, 0.03);                      // Battery.
    k.accent().box(0.22, -0.05 - 0.24 * f, 0, 0.2, 0.03, 0.12);
    const fore = longGunGrips(k, a, -0.06, 0.34, 0.14, 0.86, 0.04, -1.07, 0.04);
    return { geometry: b.build(), muzzle: [brake ?? end + 0.04, 0.12, 0], fore, eject: [0.1, 0.3, 0.17], length: (brake ?? end + 0.04) + 1.11 };
  }

  // Magpies: two compact pistols, one in each hand, a forearm's width apart. The off-hand one is held higher and
  // further back, so the pair reads from the side as well as from above.
  function akimbo(a) {
    const k = kit(), b = k.b, m = magLook(a.mag);
    const drop = 0.34 * Math.max(1, m.len * 0.85);
    let mx = null;
    for (const s of [-1, 1]) {
      const z = s * 0.24, x = s > 0 ? 0.08 : -0.16, oy = s > 0 ? 0 : 0.16;
      k.body().box(x + 0.16, oy + 0.18, z, 0.64, 0.17, 0.15, 0.03);                            // Slide.
      k.dark().box(x + 0.14, oy + 0.06, z, 0.56, 0.08, 0.13);                                  // Frame.
      k.dark(); for (let i = 0; i < 3; i++) b.box(x - 0.08 + i * 0.06, oy + 0.18, z, 0.025, 0.18, 0.165);
      k.metal().prismX(x + 0.48, x + 0.56, oy + 0.18, z, 0.05, 0.05, 6);
      const got = fitBarrel(k, a.barrel, x + 0.56, oy + 0.18, z, 0.07, 0.28);
      if (got !== null) mx = Math.max(mx ?? 0, got);
      else k.accent().box(x + 0.57, oy + 0.18, z, 0.02, 0.08, 0.08);
      k.accent().box(x + 0.38, oy + 0.28, z, 0.04, 0.03, 0.04);                                // No optics: nothing to sight down.
      k.grip().extrude([[x - 0.14, oy + 0.04], [x + 0.06, oy + 0.04], [x, oy - drop], [x - 0.2, oy - drop]], z - 0.07, z + 0.07);
      k[m.part]().box(x - 0.1, oy - drop - 0.02, z, 0.24, 0.04, 0.16);
      if (m.tab) k.accent().box(x - 0.1, oy - drop - 0.05, z, 0.14, 0.03, 0.1);
      if (a.grip === 'wrap' || a.grip === 'knurl') for (const g of [0.35, 0.7]) k.accent().box(x - 0.07 - 0.02 * g, oy - drop * g, z, 0.2, 0.03, 0.16);
      else if (isWrap(a.grip)) fitWrap(k, x - 0.05, drop, 0.14, a.grip, z, oy);                // Wave 2 grips.
    }
    return { geometry: b.build(), muzzle: [mx === null ? 0.66 : mx, 0.18, 0.24], fore: [-0.2, 0.1, -0.24], eject: [0.1, 0.28, 0.24], length: 1 };
  }

  // Tacker: a framing nailer. A tall motor housing over a short nose, a long nail magazine raked forward under it
  // to the tip and a bright safety foot at the muzzle. From above: a blunt wedge with a strip running to the nose.
  function nailer(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.22, 0.06], [0.26, 0.06], [0.34, 0.14], [0.34, 0.42], [0.2, 0.5], [-0.14, 0.5], [-0.22, 0.42]], -0.13, 0.13);   // Motor housing.
    k.dark(); for (let i = 0; i < 3; i++) b.box(-0.08 + i * 0.1, 0.4, 0, 0.04, 0.08, 0.28);    // Vents.
    k.metal().box(0.46, 0.14, 0, 0.26, 0.14, 0.12, 0.02);                                      // Nose.
    const mx = fitBarrel(k, a.barrel, 0.59, 0.14, 0, 0.07, 0.26);
    if (mx === null) k.accent().box(0.62, 0.12, 0, 0.06, 0.2, 0.16, 0.02);                     // Safety foot.
    // Nail magazine: a long strip raked from the grip's heel up to the nose.
    k[m.part]().extrude([[0.5, 0.08], [0.58, 0.02], [0.06 - 0.1 * (f - 1), -0.36 * f], [-0.02 - 0.1 * (f - 1), -0.3 * f]], -0.05, 0.05);
    k.accent(); for (let i = 0; i < 4; i++) b.box(0.46 - i * 0.1, -0.02 - i * 0.075, 0, 0.03, 0.03, 0.115);
    if (m.tab) k.accent().box(0.02, -0.34 * f, 0, 0.12, 0.05, 0.13);
    if (a.optic) fitOptic(k, a.optic, 0.04, 0.5, 0.7);
    else k.accent().box(0.06, 0.515, 0, 0.26, 0.02, 0.06);
    pistolGrip(k, -0.04, 0.36, 0.14);
    if (isWrap(a.grip)) fitWrap(k, -0.04, 0.36, 0.14, a.grip);
    k.dark().prismX(-0.3, -0.18, -0.34, 0, 0.07, 0.07, 6);                                     // Air fitting on the heel.
    return { geometry: b.build(), muzzle: [mx === null ? 0.66 : mx, 0.14, 0], fore: [-0.1, -0.2, -0.05], eject: [0.2, 0.3, 0.14], length: 1.05 };
  }

  // Ripple: three short tubes in a triangle, two low and one on top, bright warheads showing in all three, on a
  // light frame with two grips. From above: a pair of fat tubes, far wider than the Breaker and half its length.
  function salvo(a) {
    const k = kit(), b = k.b;
    const ext = a.barrel === 'longtube' ? 0.34 : 0, end = 0.94 + ext;
    const light = a.mag === 'lightrocket', big = a.mag === 'warhead' ? 1.2 : a.mag === 'shaped' ? 0.8 : light ? 0.75 : 1;
    const tubes = [[0.08, -0.15], [0.08, 0.15], [0.32, 0]];
    for (const [y, z] of tubes) {
      k.body().prismX(-0.5, end, y, z, 0.13, 0.13, 8, OCT);
      k.dark().prismX(end, end + 0.05, y, z, 0.145, 0.145, 8, OCT);
      k.accent().prismX(end + 0.05, end + 0.05 + 0.1 * big, y, z, 0.1 * big, 0.03, 8, OCT);    // Warhead tip.
      if (a.barrel === 'venturi') fitVenturi(k, -0.5, y, z, 0.13, -1, 0.2, 1.45);
      else k.dark().prismX(-0.56, -0.5, y, z, 0.15, 0.13, 8, OCT);                             // Exhaust bell.
      if (light) k.accent().prismX(end - 0.14, end - 0.1, y, z, 0.14, 0.14, 8, OCT);           // Light rockets: a bright band.
    }
    if (a.barrel === 'guiderail') fitGuideRail(k, -0.3, end, 0.32, 0.13);
    k.metal().box(0.2, 0.16, 0, 0.1, 0.34, 0.5, 0.02);                                         // Bands holding the tubes.
    k.metal().box(-0.3, 0.16, 0, 0.1, 0.34, 0.5, 0.02);
    if (a.mag === 'satchel') k.body2().box(-0.05, 0.16, -0.36, 0.34, 0.24, 0.14, 0.03);
    k.grip().box(-0.62, 0.02, 0, 0.08, 0.3, 0.34, 0.03);                                       // Shoulder pad.
    if (a.optic) fitOptic(k, a.optic, 0.0, 0.45);
    else { k.dark().box(0.0, 0.5, 0, 0.06, 0.1, 0.12); k.accent().box(0.0, 0.56, 0, 0.065, 0.03, 0.14); }
    pistolGrip(k, 0.0, 0.3, 0.12);
    if (isWrap(a.grip)) fitWrap(k, 0.0, 0.3, 0.12, a.grip);
    if (a.grip === 'angled') fitForegrip(k, 'angled', 0.5, -0.05);
    else k.grip().box(0.5, -0.17, 0, 0.11, 0.26, 0.11, 0.03);
    return { geometry: b.build(), muzzle: [end + 0.12, 0.16, 0], fore: [0.5, -0.17, 0], eject: [-0.56, 0.16, 0], length: 1.7 + ext };
  }

  // Gaff: a wrapped handle, a crossguard and a broad flat blade lying level, with the boat hook's spur curling back
  // off its right edge near the tip. Held like a pistol; from above a short dagger with a barb.
  function knife() {
    const k = kit(), b = k.b;
    k.grip().prismX(-0.24, 0.1, 0.1, 0, 0.065, 0.06, 8, OCT);                                  // Handle.
    k.accent(); for (let i = 0; i < 3; i++) b.prismX(-0.18 + i * 0.09, -0.15 + i * 0.09, 0.1, 0, 0.07, 0.07, 8, OCT);
    k.metal().prismX(-0.3, -0.24, 0.1, 0, 0.08, 0.08, 6);                                      // Pommel.
    k.dark().box(0.13, 0.1, 0, 0.06, 0.1, 0.3, 0.02);                                          // Guard.
    // Blade: flat and wide, tapering to the point. The spine is body (takes a camo), the edges bare metal.
    const ring = (x, hw, hh) => [[x, 0.1 - hh, -hw], [x, 0.1 + hh, -hw], [x, 0.1 + hh, hw], [x, 0.1 - hh, hw]];
    k.body().loft([ring(0.16, 0.085, 0.035), ring(0.7, 0.075, 0.03)]);
    k.metal().loft([ring(0.7, 0.075, 0.03), ring(0.98, 0.012, 0.012)]);
    k.metal().box(0.43, 0.1, -0.09, 0.54, 0.02, 0.03);                                         // Ground edges.
    k.metal().box(0.43, 0.1, 0.09, 0.54, 0.02, 0.03);
    k.accent().box(0.42, 0.137, 0, 0.44, 0.012, 0.03);                                         // Fuller.
    k.metal().box(0.72, 0.1, 0.13, 0.08, 0.05, 0.14);                                          // Hook spur...
    k.metal().box(0.62, 0.1, 0.2, 0.26, 0.05, 0.05);                                           // ...curling back.
    k.accent().box(0.49, 0.1, 0.2, 0.03, 0.055, 0.055);
    return { geometry: b.build(), muzzle: [0.98, 0.1, 0], fore: [-0.12, 0.04, -0.06], eject: [0.2, 0.2, 0], length: 1.3 };
  }

  // Maul: a long wrapped haft with a double-faced spike-driving head across the end. From above: a capital T, and the
  // only thing in the armory wider than it is thick.
  function maul() {
    const k = kit(), b = k.b;
    k.grip().prismX(-0.5, 0.86, 0.08, 0, 0.05, 0.045, 8, OCT);                                 // Haft.
    k.accent(); for (let i = 0; i < 2; i++) b.prismX(-0.3 + i * 0.36, -0.24 + i * 0.36, 0.08, 0, 0.056, 0.056, 8, OCT);
    k.dark().prismX(-0.56, -0.5, 0.08, 0, 0.065, 0.065, 8, OCT);
    k.metal().prismX(0.8, 0.88, 0.08, 0, 0.08, 0.08, 8, OCT);                                  // Collar.
    k.body().box(1.0, 0.08, 0, 0.26, 0.26, 0.46, 0.04);                                        // Head.
    k.metal().prismZ(-0.42, -0.23, 1.0, 0.08, 0.1, 0.13, 8, OCT);                              // Striking faces, tapered.
    k.metal().prismZ(0.23, 0.42, 1.0, 0.08, 0.13, 0.1, 8, OCT);
    k.accent().box(1.0, 0.08, 0, 0.275, 0.275, 0.08);                                          // Painted band.
    return { geometry: b.build(), muzzle: [1.12, 0.08, 0], fore: [0.4, 0.08, 0], eject: [0.6, 0.2, 0], length: 1.75 };
  }

  return { rampar, heatar, hushsmg, drumsmg, magshot, flechette, beltlmg, twinshot, hushdmr, scout, rail, akimbo, nailer, salvo, knife, maul };
}
