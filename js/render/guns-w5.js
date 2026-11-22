// Weapons wave 5's models (js/shared/weapons-w5.js). Same conventions as guns.js and guns-w3.js: model space in metres,
// +X muzzle, +Y up, +Z to the shooter's right, origin at the firing hand; parts tagged body / grip / metal / accent,
// camos on body only; every silhouette unmistakable from directly above. guns.js hands its shared part builders in
// (`h`), so this file imports nothing from it. The visual pass (guns-detail.js) adds ports, rails and per-class detail
// over these as it does for every gun. Every part each gun can take is fitted where the gun's own shape puts it
// (dev/sim-attachments.mjs checks every pair is drawn, differs from stock and stays inside the gun's reach).

const OCT = Math.PI / 8;

export function w5Factories(h) {
  const { kit, pistolGrip, fitOptic, fitBarrel, fitForegrip, fitWrap, isWrap, fitStock, fitDrum, magLook, fitGuideRail, fitVenturi } = h;
  const under = id => id === 'angled' || id === 'vertical' || id === 'handstop';

  // Gadfly: a stubby square receiver with a ringed "eye" shroud at the muzzle, a short stinger barrel through it and
  // a forward-raked stick mag. Two swept fins fold out behind the grip as the stock. From above: a dart with tail fins.
  function hipsmg(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.24, 0], [0.34, 0], [0.4, 0.06], [0.4, 0.24], [0.3, 0.28], [-0.18, 0.28], [-0.24, 0.2]], -0.12, 0.12);
    k.body2().prismX(0.4, 0.7, 0.14, 0, 0.12, 0.1, 8, OCT);                                  // Shroud.
    k.dark(); for (let i = 0; i < 3; i++) b.prismX(0.45 + i * 0.08, 0.48 + i * 0.08, 0.14, 0, 0.13, 0.13, 8, OCT);
    k.metal().prismX(0.7, 0.86, 0.14, 0, 0.045, 0.04, 6);                                     // Stinger barrel.
    let mx = fitBarrel(k, a.barrel, 0.86, 0.14, 0, 0.075, 0.32);
    if (mx === null) {
      // The eye: a bright ring standing proud of the barrel tip.
      k.dark().prismX(0.84, 0.92, 0.14, 0, 0.1, 0.1, 8, OCT);
      k.accent().prismX(0.92, 0.94, 0.14, 0, 0.085, 0.085, 8, OCT);
      mx = 0.95;
    }
    if (a.optic) fitOptic(k, a.optic, 0.04, 0.28, 0.8);
    else { k.dark().box(-0.1, 0.32, 0, 0.08, 0.08, 0.12); k.accent().box(0.3, 0.31, 0, 0.05, 0.05, 0.05); }
    // Forward-raked stick.
    k[m.part]().extrude([[0.14, 0.0], [0.28, 0.0], [0.34 + 0.06 * f, -0.4 * f], [0.2 + 0.06 * f, -0.42 * f]], -0.05, 0.05);
    if (m.tab) k.accent().box(0.27 + 0.06 * f, -0.43 * f, 0, 0.16, 0.04, 0.12);
    if (m.drum) fitDrum(k, 0.22, -0.1, 0.2);
    pistolGrip(k, -0.04, 0.3, 0.12);
    if (isWrap(a.grip)) fitWrap(k, -0.04, 0.3, 0.12, a.grip);
    else fitForegrip(k, a.grip, 0.56, 0.02);
    if (a.grip === 'skelstock' || a.grip === 'heavystock') fitStock(k, a.grip, -0.72, 0.12);
    else {
      // Tail fins: two swept blades either side of a short spine, their tips lit.
      k.metal().box(-0.42, 0.14, 0, 0.36, 0.05, 0.05);
      for (const s of [-1, 1]) {
        k.body2().extrude([[-0.3, 0.1], [-0.58, 0.04], [-0.66, 0.2], [-0.36, 0.2]], s > 0 ? 0.03 : -0.07, s > 0 ? 0.07 : -0.03);
        k.body2().box(-0.56, 0.12, s * 0.15, 0.14, 0.04, 0.18);
        k.accent().box(-0.62, 0.12, s * 0.245, 0.06, 0.035, 0.03);
      }
      k.grip().box(-0.68, 0.12, 0, 0.05, 0.22, 0.16, 0.015);
    }
    const fore = under(a.grip) ? [0.56, -0.12, 0] : [0.56, 0.02, 0];
    return { geometry: b.build(), muzzle: [mx, 0.14, 0], fore, eject: [0.06, 0.26, 0.12], length: mx + 0.7 };
  }

  // Carousel: a fat round cooling jacket the length of the barrel, a flat pan of 47 lying on top of the receiver
  // (the widest disc on any gun), a spade grip and a wooden club butt. From above: a long tube under a round plate.
  function panlmg(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.36, -0.02], [0.42, -0.02], [0.48, 0.04], [0.48, 0.22], [0.36, 0.28], [-0.26, 0.28], [-0.36, 0.18]], -0.13, 0.13);
    k.body2().prismX(0.48, 1.36, 0.12, 0, 0.16, 0.16, 8, OCT);                                // The jacket.
    k.dark(); for (let i = 0; i < 6; i++) b.prismX(0.56 + i * 0.13, 0.59 + i * 0.13, 0.12, 0, 0.17, 0.17, 8, OCT);
    k.dark().prismX(1.34, 1.42, 0.12, 0, 0.1, 0.07, 8, OCT);                                  // Jacket mouth.
    k.metal().prismX(1.42, 1.56, 0.12, 0, 0.05, 0.045, 6);
    let mx = fitBarrel(k, a.barrel, 1.56, 0.12, 0, 0.09, 0.46);
    if (mx === null) { k.metal().prismX(1.56, 1.62, 0.12, 0, 0.07, 0.07, 6); mx = 1.63; }
    // The pan: a flat drum on a spindle, ribbed like a gramophone record; a bigger pan for the long mags.
    const pr = Math.min(0.42, 0.3 * Math.max(0.75, f)), ph = m.part === 'body2' ? 0.06 : 0.09;
    k[m.part]().prismY(0.3, 0.3 + ph, 0.12, 0, pr, pr, 12);
    k.metal().prismY(0.3 + ph, 0.34 + ph, 0.12, 0, 0.05, 0.05, 6);                            // Spindle.
    k.dark(); b.box(0.12, 0.3 + ph + 0.004, 0, pr * 1.7, 0.012, 0.035); b.box(0.12, 0.3 + ph + 0.004, 0, 0.035, 0.012, pr * 1.7);   // Ribs.
    k.accent(); for (let i = 0; i < 8; i++) { const t = i * Math.PI / 4; b.box(0.12 + Math.cos(t) * pr * 0.9, 0.3 + ph * 0.5, Math.sin(t) * pr * 0.9, 0.05, ph + 0.012, 0.05); }   // Round counters on the rim.
    if (m.tab) k.accent().box(0.12 + pr, 0.3 + ph / 2, 0, 0.05, ph, 0.08);
    if (m.drum || f > 1.2) k.dark().prismY(0.3 + ph, 0.34 + ph, 0.12, 0, pr * 0.7, pr * 0.7, 12);   // A second layer on a big pan.
    // Sights sit behind the pan, on a raised block.
    k.dark().box(-0.2, 0.32, 0, 0.18, 0.08, 0.12);
    if (a.optic) fitOptic(k, a.optic, -0.2, 0.36, 0.8);
    else { k.dark().box(-0.24, 0.42, 0, 0.04, 0.12, 0.1); k.accent().box(1.3, 0.3, 0, 0.04, 0.06, 0.04); }
    // Club butt and the spade grip under it.
    k.body().extrude([[-0.36, 0.22], [-0.36, 0.0], [-0.66, -0.14], [-1.0, -0.18], [-1.04, 0.0], [-1.0, 0.18], [-0.66, 0.22]], -0.12, 0.12);
    k.grip().box(-1.06, 0.0, 0, 0.06, 0.34, 0.26, 0.02);
    // Bipod legs folded under the jacket.
    k.metal(); b.box(1.12, -0.08, -0.07, 0.05, 0.24, 0.035); b.box(1.12, -0.08, 0.07, 0.05, 0.24, 0.035);
    pistolGrip(k, -0.06, 0.34, 0.14);
    if (isWrap(a.grip)) fitWrap(k, -0.06, 0.34, 0.14, a.grip);
    else fitForegrip(k, a.grip, 0.82, -0.04);
    fitStock(k, a.grip, -1.06, 0.02);
    const fore = under(a.grip) ? [0.82, -0.18, 0] : [0.82, -0.04, 0];
    return { geometry: b.build(), muzzle: [mx, 0.12, 0], fore, eject: [0.1, 0.2, 0.15], length: mx + 1.08 };
  }

  // Vigil: a long semi-automatic rifle with a gas tube riding over the barrel to a squared gas block, a fat seven-round
  // box under the receiver and a three-port brake. From above: the sniper's length with a second line (the gas tube)
  // along the front half, ending in a block.
  function autosniper(a) {
    const k = kit(), b = k.b, m = magLook(a.mag), f = m.len;
    k.body().extrude([[-0.3, 0.0], [0.5, 0.0], [0.6, 0.07], [0.6, 0.2], [0.46, 0.25], [-0.22, 0.25], [-0.3, 0.16]], -0.12, 0.12);
    k.body2().box(0.88, 0.12, 0, 0.56, 0.18, 0.2, 0.03);                                       // Handguard.
    k.dark(); for (let i = 0; i < 4; i++) b.box(0.68 + i * 0.12, 0.215, 0, 0.06, 0.02, 0.16);
    const end = a.barrel === 'fluted' ? 1.64 : 1.9;
    k.metal().prismX(1.16, end, 0.12, 0, 0.05, 0.045, 6);
    k.dark().prismX(0.6, 1.36, 0.26, 0, 0.025, 0.025, 6);                                      // Gas tube.
    k.metal().box(1.38, 0.2, 0, 0.08, 0.16, 0.1);                                               // Gas block.
    let mx = fitBarrel(k, a.barrel, end, 0.12, 0, 0.085, 0.56);
    if (a.barrel === 'fluted') {
      k.dark(); for (let i = 0; i < 3; i++) b.box(1.24 + i * 0.12, 0.12, 0, 0.05, 0.13, 0.13);
      if (mx === null) mx = end + 0.02;
    } else if (mx === null) {
      // Three-port brake: a block with three bright slots through it, wider than the barrel from above.
      k.dark().box(end + 0.1, 0.12, 0, 0.2, 0.12, 0.2, 0.02);
      k.accent(); for (let i = 0; i < 3; i++) b.box(end + 0.04 + i * 0.06, 0.12, 0, 0.025, 0.13, 0.22);
      mx = end + 0.2;
    }
    if (a.optic) fitOptic(k, a.optic, 0.22, 0.25);
    else {
      // A mid-length scope with a square hood: shorter than the Lancet's.
      k.dark().prismX(-0.1, 0.56, 0.37, 0, 0.09, 0.09, 8, OCT);
      k.dark().box(0.62, 0.37, 0, 0.14, 0.2, 0.2, 0.02);
      k.dark().prismX(-0.22, -0.08, 0.37, 0, 0.12, 0.09, 8, OCT);
      k.accent().box(0.695, 0.37, 0, 0.012, 0.15, 0.15);
      k.metal().box(0.08, 0.28, 0, 0.1, 0.08, 0.1);
      k.metal().box(0.38, 0.28, 0, 0.1, 0.08, 0.1);
    }
    // The box: deep and square, canted a touch forward.
    k[m.part]().extrude([[0.1, 0.0], [0.36, 0.0], [0.38, -0.34 * f], [0.12, -0.36 * f]], -0.075, 0.075);
    if (m.tab) k.accent().box(0.25, -0.36 * f, 0, 0.22, 0.04, 0.12);
    if (m.drum) fitDrum(k, 0.24, -0.08, 0.18);
    k.body().extrude([[-0.3, 0.2], [-0.3, 0.02], [-0.58, -0.1], [-1.0, -0.14], [-1.0, 0.18], [-0.58, 0.2]], -0.09, 0.09);
    k.body2().box(-0.68, 0.22, 0, 0.36, 0.05, 0.16);                                            // Cheek rest.
    k.grip().box(-1.03, 0.02, 0, 0.07, 0.32, 0.2, 0.02);
    pistolGrip(k, -0.04, 0.3, 0.11);
    if (isWrap(a.grip)) fitWrap(k, -0.04, 0.3, 0.11, a.grip);
    else fitForegrip(k, a.grip, 0.86, 0.03);
    fitStock(k, a.grip, -1.04, 0.02);
    const fore = under(a.grip) ? [0.86, -0.12, 0] : [0.86, 0.03, 0];
    return { geometry: b.build(), muzzle: [mx, 0.12, 0], fore, eject: [0.1, 0.24, 0.12], length: mx + 1.1 };
  }

  // Fusee: a brass-bodied break-open flare pistol, a short wide-bored barrel with a lit flare star in the muzzle, the
  // hinge and a big hammer spur, and a fat round grip. From above: a short fat tube, its bright bore the tell.
  function flare(a) {
    const k = kit(), b = k.b, m = magLook(a.mag);
    k.body().extrude([[-0.2, 0.04], [0.16, 0.04], [0.2, 0.1], [0.2, 0.3], [-0.14, 0.32], [-0.2, 0.26]], -0.11, 0.11);
    k.metal().prismZ(-0.12, 0.12, 0.18, 0.07, 0.045, 0.045, 8, OCT);                           // Hinge.
    k.body2().prismX(0.18, 0.62, 0.21, 0, 0.13, 0.13, 10);                                      // Wide barrel.
    k.dark().prismX(0.3, 0.36, 0.21, 0, 0.14, 0.14, 10);
    k.dark().box(0.4, 0.345, 0, 0.42, 0.025, 0.05);                                             // Rib.
    let mx = fitBarrel(k, a.barrel, 0.62, 0.21, 0, 0.13, 0.3);
    if (mx === null) {
      k.metal().prismX(0.6, 0.68, 0.21, 0, 0.14, 0.15, 10);                                    // Muzzle ring.
      k.accent().prismX(0.66, 0.69, 0.21, 0, 0.09, 0.09, 10);                                  // The lit star.
      mx = 0.7;
    }
    k.metal().extrude([[-0.22, 0.3], [-0.16, 0.3], [-0.19, 0.37], [-0.25, 0.38]], -0.025, 0.025);   // Hammer spur.
    if (a.optic) fitOptic(k, a.optic, 0.02, 0.33, 0.66);
    else k.accent().box(0.5, 0.36, 0, 0.04, 0.04, 0.04);
    // A round grip, and the spare flares in a cuff on its right; a speed or light mag changes the cuff.
    k.grip().prismY(-0.36, 0.02, -0.09, 0, 0.075, 0.085, 8, OCT);
    k.grip().box(-0.12, -0.36, 0, 0.18, 0.04, 0.17);
    const n = a.mag === 'speedmag' ? 3 : a.mag === 'lightmag' ? 1 : 2;
    k[m.part]().box(-0.1, -0.18, 0.1, 0.14, 0.08 * n + 0.02, 0.03);
    k.accent(); for (let i = 0; i < n; i++) b.prismZ(0.1, 0.15, -0.1, -0.12 - i * 0.08, 0.03, 0.03, 6);
    if (m.tab) k.accent().box(-0.1, -0.4, 0, 0.12, 0.03, 0.1);
    if (m.part === 'metal') k.metal().box(0.36, 0.08, 0, 0.12, 0.05, 0.12);
    if (isWrap(a.grip)) fitWrap(k, -0.06, 0.34, 0.15, a.grip);
    return { geometry: b.build(), muzzle: [mx, 0.21, 0], fore: [-0.1, -0.2, -0.05], eject: [0.1, 0.34, 0.1], length: 1.0 };
  }

  // Skyhook: two tubes side by side on a shoulder frame, a seeker head on the front of the frame with a bright lens
  // and four little fins, and a padded shoulder rest. From above: two parallel tubes, the only twin tube in the game.
  function lockon(a) {
    const k = kit(), b = k.b;
    const r = 0.13, ext = a.barrel === 'longtube' ? 0.36 : 0, zs = [-0.15, 0.15];
    for (const z of zs) {
      k.body().prismX(-0.72, 0.86, 0.19, z, r, r, 8, OCT);
      if (ext) { k.dark().prismX(0.86, 0.86 + ext, 0.19, z, r * 0.95, r * 0.95, 8, OCT); k.accent().prismX(0.84, 0.9, 0.19, z, r + 0.02, r + 0.02, 8, OCT); }
      k.accent().prismX(-0.5, -0.44, 0.19, z, r + 0.012, r + 0.012, 8, OCT);
      if (a.barrel === 'venturi') fitVenturi(k, -0.72, 0.19, z, r, -1, 0.36, 1.7);
      else { k.dark().prismX(-0.9, -0.72, 0.19, z, 0.17, r, 8, OCT); }
    }
    k.metal().box(0.06, 0.19, 0, 1.2, 0.08, 0.1);                                               // Frame between the tubes.
    if (a.barrel === 'guiderail') fitGuideRail(k, -0.4, 0.8 + ext, 0.19, r + 0.15);
    // Rocket noses: the warhead's fat bulbs, shaped charges' spikes, light rockets' finned slim bulbs.
    const blast = a.mag === 'warhead', shaped = a.mag === 'shaped', light = a.mag === 'lightrocket', bag = a.mag === 'satchel';
    const hr = blast ? 0.17 : shaped ? 0.09 : light ? 0.11 : 0.13, tip = shaped ? 0.32 : light ? 0.24 : 0.18, wx = 0.86 + ext;
    for (const z of zs) {
      k.dark().prismX(wx, wx + 0.18, 0.19, z, hr, hr, 8, OCT);
      k.accent().prismX(wx + 0.18, wx + 0.18 + tip, 0.19, z, hr, 0.03, 8, OCT);
      if (light) { k.metal(); for (const dy of [-1, 1]) b.box(wx + 0.08, 0.19 + dy * hr, z, 0.08, 0.06, 0.02); }
    }
    if (bag) { k.dark().box(-0.4, -0.06, 0.24, 0.34, 0.2, 0.08, 0.02); k.accent().box(-0.4, 0.02, 0.285, 0.26, 0.03, 0.02); }
    // The seeker head on the front of the frame: a box with a big lens and four fins. An optic takes its place.
    if (a.optic) fitOptic(k, a.optic, 0.2, 0.33, 0.9);
    else {
      k.dark().box(0.5, 0.42, 0, 0.26, 0.16, 0.16, 0.02);
      k.accent().box(0.635, 0.42, 0, 0.015, 0.12, 0.12);
      k.metal(); for (const [dy, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) b.box(0.42, 0.42 + dy * 0.11, dz * 0.11, 0.1, dy ? 0.06 : 0.02, dz ? 0.06 : 0.02);
      k.metal().box(0.5, 0.3, 0, 0.06, 0.1, 0.06);
    }
    // Shoulder rest behind the tubes.
    k.grip().box(-0.7, 0.04, 0, 0.18, 0.14, 0.42, 0.03);
    k.dark().box(-0.1, -0.02, 0, 0.36, 0.08, 0.16);
    pistolGrip(k, -0.1, 0.34, 0.14);
    if (isWrap(a.grip)) fitWrap(k, -0.1, 0.34, 0.14, a.grip);
    else if (a.grip === 'angled') fitForegrip(k, a.grip, 0.44, -0.02);
    else k.grip().box(0.44, -0.15, 0, 0.12, 0.28, 0.11, 0.03);
    const fore = a.grip === 'angled' ? [0.44, -0.16, 0] : [0.44, -0.17, 0];
    return { geometry: b.build(), muzzle: [wx + 0.18 + tip, 0.19, 0.15], fore, eject: [-1, 0.2, 0], length: 2.4 + ext };
  }

  return { hipsmg, panlmg, autosniper, flare, lockon };
}
