// Weapons wave 3's models (js/shared/weapons-w3.js). Same conventions as guns.js and guns-v10.js: model space in metres,
// +X muzzle, +Y up, +Z to the shooter's right, origin at the firing hand; parts tagged body / grip / metal / accent,
// camos on body only; every silhouette unmistakable from directly above. guns.js hands its shared part builders in
// (`h`), so this file imports nothing from it. Every part each gun can take is fitted where the gun's own shape puts
// it (dev/sim-attachments.mjs checks every pair is drawn, differs from stock and stays inside the gun's reach).

const OCT = Math.PI / 8;

export function w3Factories(h) {
  const { kit, pistolGrip, fitOptic, fitBarrel, fitForegrip, fitWrap, isWrap, fitStock, fitDrum, magLook, fitShellCuff, fitVentRib } = h;
  const under = id => id === 'angled' || id === 'vertical' || id === 'handstop';

  // Clatter: a short square receiver under a tall flat rib with three bright burst studs, a slab jacket that ends in a
  // three-fin muzzle (one fin per round of the burst), a straight mag and a folding wire stock. From above: a long
  // flat box crossed by three bars at the front.
  function burstsmg(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.26, 0], [0.4, 0], [0.44, 0.05], [0.44, 0.25], [-0.2, 0.27], [-0.26, 0.2]], -0.12, 0.12);
    k.body2().box(0.7, 0.13, 0, 0.52, 0.18, 0.2, 0.03);                                         // Slab jacket.
    k.dark(); for (let i = 0; i < 3; i++) b.box(0.56 + i * 0.13, 0.13, 0, 0.06, 0.12, 0.215);    // Jacket slots.
    k.dark().box(0.18, 0.3, 0, 0.6, 0.04, 0.1);                                                 // Top rib.
    k.accent(); for (let i = 0; i < 3; i++) b.box(0.3 + i * 0.07, 0.33, 0, 0.035, 0.025, 0.06);  // Burst studs.
    k.metal().prismX(0.96, 1.04, 0.13, 0, 0.055, 0.055, 6);
    let mx = fitBarrel(k, a.barrel, 1.04, 0.13, 0, 0.085, 0.36);
    if (mx === null) {
      // Three-fin muzzle: a fin for each round of the burst, wider than the jacket from above.
      k.dark().prismX(1.02, 1.2, 0.13, 0, 0.07, 0.07, 6);
      k.metal(); for (let i = 0; i < 3; i++) b.box(1.06 + i * 0.055, 0.13, 0, 0.025, 0.2, 0.3);
      mx = 1.21;
    }
    if (a.optic) fitOptic(k, a.optic, 0.0, 0.32, 0.85);
    else { k.dark().box(-0.12, 0.35, 0, 0.06, 0.07, 0.12); k.accent().box(0.9, 0.25, 0, 0.04, 0.06, 0.04); }
    k[m.part]().box(0.2, -0.22 * f, 0, 0.13, 0.44 * f, 0.1, 0.02);                              // Straight stick.
    k.accent().box(0.2, -0.04, 0, 0.15, 0.025, 0.12);
    if (m.tab) k.accent().box(0.2, -0.44 * f - 0.02, 0, 0.16, 0.04, 0.12);
    if (m.drum) fitDrum(k, 0.2, -0.12, 0.2);
    if (m.part === 'body2' && m.tab) k.accent().box(0.2, -0.2 * f, 0.07, 0.08, 0.06, 0.03);     // Satchel strap.
    pistolGrip(k, -0.06, 0.3, 0.12);
    if (isWrap(a.grip)) fitWrap(k, -0.06, 0.3, 0.12, a.grip);
    else fitForegrip(k, a.grip, 0.66, 0.03);
    if (a.grip === 'skelstock') fitStock(k, a.grip, -0.78, 0.12);
    else {
      // Folding wire stock, open: two rods back to a bright-edged butt plate.
      k.metal().box(-0.5, 0.2, 0, 0.5, 0.035, 0.035);
      k.metal().box(-0.5, 0.04, 0, 0.5, 0.035, 0.035);
      k.grip().box(-0.77, 0.12, 0, 0.06, 0.26, 0.2, 0.015);
      k.accent().box(-0.8, 0.12, 0, 0.015, 0.16, 0.12);
    }
    const fore = under(a.grip) ? [0.66, -0.12, 0] : [0.66, 0.03, 0];
    return { geometry: b.build(), muzzle: [mx, 0.13, 0], fore, eject: [0.1, 0.26, 0.13], length: mx + 0.8 };
  }

  // Bullhead: one fat ten-gauge barrel over a full-length tube, a deep ribbed pump, a squared receiver and a heavy
  // butt with a bright recoil pad. The muzzle wears a thick ring collar. From above: a single wide barrel, wider than
  // any other shotgun's, with a collar at the end.
  function heavyshot(a) {
    const k = kit(), b = k.b;
    const sawn = a.barrel === 'sawnoff', end = sawn ? 1.0 : 1.4;
    k.body().extrude([[-0.28, -0.06], [0.44, -0.06], [0.5, 0.0], [0.5, 0.3], [0.38, 0.34], [-0.2, 0.34], [-0.28, 0.26]], -0.16, 0.16);
    k.metal().prismX(0.5, end, 0.21, 0, 0.115, 0.105, 8, OCT);                                 // The ten-gauge barrel.
    k.dark().box((0.5 + end) / 2, 0.33, 0, end - 0.5, 0.025, 0.07);                             // Plain top rib.
    const tube = a.mag === 'extmag' ? end - 0.02 : sawn ? end - 0.04 : 0.5 + (end - 0.5) * 0.75;
    k.dark().prismX(0.5, tube, 0.02, 0, 0.085, 0.085, 8, OCT);                                 // Magazine tube.
    if (a.mag === 'extmag') k.accent().prismX(tube - 0.04, tube, 0.02, 0, 0.095, 0.095, 8, OCT);
    k.body2().box(0.8, 0.03, 0, 0.42, 0.22, 0.27, 0.04);                                       // Deep pump.
    k.dark(); for (let i = 0; i < 4; i++) b.box(0.64 + i * 0.1, 0.03, 0, 0.04, 0.24, 0.285);
    let mx;
    if (a.barrel === 'choke') {
      k.dark().prismX(end, end + 0.18, 0.21, 0, 0.12, 0.075, 8, OCT); mx = end + 0.19;
    } else if (a.barrel === 'rifled') {
      k.metal().prismX(end, end + 0.32, 0.21, 0, 0.09, 0.09, 8, OCT);
      k.accent().prismX(end + 0.22, end + 0.27, 0.21, 0, 0.11, 0.11, 8, OCT); mx = end + 0.33;
    } else if (a.barrel === 'ventrib') {
      mx = fitVentRib(k, end, 0.21, [0], 0.115, 0.33);
    } else {
      mx = fitBarrel(k, a.barrel, end, 0.21, 0, 0.12, 0.5);
      if (mx === null) {
        // The bull ring: a thick collar with a bright band, the gun's tell from above.
        k.dark().prismX(end - 0.02, end + 0.1, 0.21, 0, 0.145, 0.145, 8, OCT);
        k.accent().prismX(end + 0.03, end + 0.05, 0.21, 0, 0.155, 0.155, 8, OCT);
        mx = end + 0.1;
      }
    }
    // Shells: a four-shell carrier on the receiver's right; the speed mag doubles it.
    const n = a.mag === 'speedmag' ? 8 : 4;
    k.dark().box(0.14, 0.14, 0.18, 0.07 * n + 0.04, 0.16, 0.04, 0.01);
    k.accent(); for (let i = 0; i < n; i++) b.prismY(0.08, 0.21, 0.14 - (n - 1) * 0.035 + i * 0.07, 0.205, 0.03, 0.03, 6);
    k.body().extrude([[-0.28, 0.28], [-0.28, 0.0], [-0.56, -0.14], [-1.02, -0.2], [-1.02, 0.16], [-0.56, 0.26]], -0.13, 0.13);
    k.grip().box(-1.06, -0.02, 0, 0.08, 0.4, 0.3, 0.02);                                       // Recoil pad.
    k.accent().box(-1.105, -0.02, 0, 0.015, 0.3, 0.2);
    if (a.mag === 'lightmag') k.body2().box(-0.56, 0.24, 0, 0.32, 0.06, 0.3);                  // Skeleton cheek rest.
    else if (a.mag === 'satchel') {
      k.body2().box(-0.64, 0.0, 0.16, 0.34, 0.22, 0.06, 0.02);                                  // Shell pouch on the stock.
      k.accent().box(-0.64, 0.1, 0.19, 0.26, 0.03, 0.02);
    } else fitShellCuff(k, a.mag, -0.62, 0.04, 0.155);
    if (a.optic) fitOptic(k, a.optic, 0.1, 0.34);
    else { k.accent().prismY(0.34, 0.39, end - 0.08, 0, 0.022, 0.022, 6); k.dark().box(0.0, 0.37, 0, 0.08, 0.05, 0.14); }
    pistolGrip(k, -0.06, 0.34, 0.14);
    if (isWrap(a.grip)) fitWrap(k, -0.06, 0.34, 0.14, a.grip);
    else fitForegrip(k, a.grip, 0.8, -0.08);
    const fore = under(a.grip) ? [0.8, -0.22, 0] : [0.8, -0.06, 0];
    return { geometry: b.build(), muzzle: [mx, 0.21, 0], fore, eject: [0.14, 0.32, 0.18], length: mx + 1.06 };
  }

  // Gavel: a long slab-sided battle pistol with a full-length vented top rib, a squared nose with an accessory rail
  // under it, a hump over the web of the hand and a magazine that shows below the grip. From above: the widest,
  // longest slide of the sidearms, square at both ends.
  function battlepistol(a) {
    const k = kit(), b = k.b, m = magLook(a.mag);
    k.body().box(0.22, 0.18, 0, 0.84, 0.2, 0.2, 0.02);                                          // Slide.
    k.dark().box(0.24, 0.3, 0, 0.74, 0.04, 0.08);                                               // Vented rib.
    k.metal(); for (let i = 0; i < 4; i++) b.box(0.0 + i * 0.16, 0.33, 0, 0.05, 0.03, 0.09);
    k.dark().box(0.32, 0.04, 0, 0.62, 0.1, 0.17, 0.02);                                         // Frame.
    k.metal().box(0.52, -0.03, 0, 0.26, 0.04, 0.12);                                            // Accessory rail.
    k.accent().box(0.62, 0.11, 0, 0.12, 0.02, 0.205);                                           // Bright band at the nose.
    k.dark(); for (let i = 0; i < 4; i++) b.box(-0.12 + i * 0.05, 0.2, 0, 0.022, 0.12, 0.21);  // Rear serrations.
    k.metal().box(-0.22, 0.18, 0, 0.08, 0.12, 0.16);                                            // Hump over the hand.
    k.metal().prismX(0.64, 0.72, 0.18, 0, 0.065, 0.065, 6);
    const mx = fitBarrel(k, a.barrel, 0.72, 0.18, 0, 0.09, 0.34);
    if (mx === null) k.metal().box(0.68, 0.18, 0, 0.06, 0.18, 0.18, 0.02);                    // Squared muzzle face.
    if (a.optic) fitOptic(k, a.optic, 0.2, 0.32, 0.72);
    else { k.accent().box(0.56, 0.35, 0, 0.04, 0.05, 0.03); k.accent().box(-0.08, 0.35, 0, 0.04, 0.05, 0.09); }
    const drop = 0.42 * Math.max(1, m.len * 0.85);
    pistolGrip(k, -0.04, drop, 0.17);
    k[m.part]().box(-0.07, -drop - 0.02, 0, 0.28, 0.06, 0.2);                                   // Magazine base plate.
    if (m.len > 1.05) k[m.part]().box(-0.06, -drop + 0.06, 0, 0.18, 0.12, 0.15);               // Extended: the mag shows.
    if (m.tab) k.accent().box(-0.07, -drop - 0.06, 0, 0.18, 0.04, 0.11);
    k.dark().box(0.12, -0.12, 0, 0.24, 0.035, 0.06);                                            // Squared trigger guard.
    k.dark().box(0.23, -0.07, 0, 0.035, 0.12, 0.06);
    if (isWrap(a.grip)) fitWrap(k, -0.04, 0.42, 0.17, a.grip);
    return { geometry: b.build(), muzzle: [mx === null ? 0.72 : mx, 0.18, 0], fore: [-0.1, -0.2, -0.05], eject: [0.12, 0.3, 0.1], length: 1.2 };
  }

  // Slugger: a hardwood bat. A flared knob, a taped handle, a long taper and a fat barrel with a cupped end; held in
  // both hands at the knob. From above: a long club, thin at the hands and wide at the far end.
  function bat() {
    const k = kit(), b = k.b, y = 0.08;
    k.dark().prismX(-0.3, -0.22, y, 0, 0.058, 0.04, 8, OCT);                                   // Knob.
    k.grip().prismX(-0.22, 0.32, y, 0, 0.034, 0.038, 8, OCT);                                  // Taped handle.
    k.accent(); for (let i = 0; i < 2; i++) b.prismX(-0.16 + i * 0.36, -0.12 + i * 0.36, y, 0, 0.041, 0.042, 8, OCT);
    k.body().prismX(0.32, 0.78, y, 0, 0.038, 0.074, 8, OCT);                                   // Taper (takes a camo).
    k.body().prismX(0.78, 1.12, y, 0, 0.074, 0.08, 8, OCT);                                    // Barrel.
    k.dark().prismX(1.12, 1.15, y, 0, 0.08, 0.06, 8, OCT);                                     // Cupped end.
    k.accent().prismX(0.86, 0.9, y, 0, 0.077, 0.077, 8, OCT);                                  // Maker's band.
    return { geometry: b.build(), muzzle: [1.15, y, 0], fore: [-0.12, y, 0], eject: [0.6, 0.2, 0], length: 1.5 };
  }

  return { burstsmg, heavyshot, battlepistol, bat };
}
