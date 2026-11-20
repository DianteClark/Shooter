// Weapons wave 4's models: six melee weapons (js/shared/weapons-w4.js). Same conventions as guns.js and guns-w3.js:
// model space in metres, +X along the weapon away from the hand, +Y up, +Z to the right, origin at the hand; parts
// tagged body (takes a camo) / grip / metal / accent. Blades and heads lie flat (wide in Z, thin in Y) so the camera
// sees their shape from above: every one has its own silhouette at a glance.
//   Kagero      a long gently curved blade, an oval guard and a wrapped two-hand grip: the longest thin line
//   Kindling    a wedge axe head on one side of the haft and a pick on the other: a lopsided T
//   Spade       a long haft with a D grip at the back and a flat rounded blade: a paddle
//   Gleaner     a short handle with a hooked blade at right angles: an L that curls back
//   Bushwhack   a blade that widens toward a clipped tip: a cleaver-ended paddle
//   Nightstick  a long baton with a side handle at the hand and a knob at each end: a short cross
// About 150 to 300 triangles each, under every gun (a melee weapon is drawn once per player like any gun).

const OCT = Math.PI / 8;

export function w4Factories(h) {
  const { kit } = h;

  // A flat blade along X: stations [x, zSpine, zEdge, halfThickness]; the spine half (zSpine..mid) is `spine` part, the
  // edge half bare metal, so a camo shows on the blade's back and the edge stays bright steel.
  function blade(k, y, stations, spine = 'body') {
    const ring = (x, z0, z1, t) => [[x, y - t, z0], [x, y + t, z0], [x, y + t, z1], [x, y - t, z1]];
    for (let i = 0; i < stations.length - 1; i++) {
      const [x0, s0, e0, t0] = stations[i], [x1, s1, e1, t1] = stations[i + 1];
      const m0 = s0 + (e0 - s0) * 0.55, m1 = s1 + (e1 - s1) * 0.55;
      k[spine]().loft([ring(x0, Math.min(s0, m0), Math.max(s0, m0), t0), ring(x1, Math.min(s1, m1), Math.max(s1, m1), t1)]);
      k.metal().loft([ring(x0, Math.min(m0, e0), Math.max(m0, e0), t0 * 0.7), ring(x1, Math.min(m1, e1), Math.max(m1, e1), t1 * 0.7)]);
    }
  }

  // Kagero: a two-hand wrapped grip with a bright cap, an oval guard, a collar, then a long blade curving gently to the
  // left with an angled tip; a hairline of accent along the spine (the temper line).
  function katana() {
    const k = kit(), b = k.b, y = 0.08;
    k.metal().prismX(-0.42, -0.38, y, 0, 0.042, 0.048, 8, OCT);                                 // Cap.
    k.grip().prismX(-0.38, 0.06, y, 0, 0.042, 0.04, 8, OCT);                                    // Wrapped grip.
    k.accent(); for (let i = 0; i < 5; i++) b.box(-0.33 + i * 0.08, y, 0, 0.03, 0.09, 0.088);  // Wrap diamonds.
    k.dark().prismX(0.06, 0.095, y, 0, 0.11, 0.11, 8, OCT);                                      // Guard...
    k.dark().box(0.078, y, 0, 0.035, 0.12, 0.3, 0.02);                                         // ...oval from above.
    k.metal().prismX(0.095, 0.15, y, 0, 0.045, 0.04, 6);                                        // Collar.
    // The blade: spine on the left (-Z), edge on the right, the whole thing bending a little left toward the tip.
    const st = [];
    for (let i = 0; i <= 5; i++) {
      const f = i / 5, x = 0.15 + f * 1.15, bend = -0.09 * f * f, w = 0.075 - 0.012 * f;
      st.push([x, bend - w * 0.45, bend + w * 0.55, 0.016 - f * 0.004]);
    }
    blade(k, y, st);
    // Tip: the edge sweeps up to meet the spine.
    const [xt, st0, et0, tt] = st[st.length - 1];
    k.metal().loft([
      [[xt, y - tt, st0], [xt, y + tt, st0], [xt, y + tt, et0], [xt, y - tt, et0]],
      [[xt + 0.16, y - 0.004, st0 - 0.03], [xt + 0.16, y + 0.004, st0 - 0.03], [xt + 0.16, y + 0.004, st0 - 0.02], [xt + 0.16, y - 0.004, st0 - 0.02]],
    ]);
    k.accent().box(0.7, y + 0.017, -0.045, 0.9, 0.006, 0.012);                                  // Temper line.
    return { geometry: b.build(), muzzle: [xt + 0.16, y, -0.1], fore: [-0.24, y, 0], eject: [0.6, 0.2, 0], length: 1.75 };
  }

  // Kindling: a long haft with a bright painted band and a heavy head across the end: a broad flat wedge to the right
  // (the edge bright steel) and a curved pick to the left. Painted head takes the camo.
  function fireaxe() {
    const k = kit(), b = k.b, y = 0.08;
    k.grip().prismX(-0.5, 0.86, y, 0, 0.045, 0.05, 8, OCT);                                    // Haft.
    k.dark().prismX(-0.56, -0.5, y, 0, 0.06, 0.055, 8, OCT);                                    // Butt knob.
    k.accent().prismX(-0.3, -0.18, y, 0, 0.052, 0.052, 8, OCT);                                 // Grip band.
    k.body().box(0.92, y, 0, 0.22, 0.14, 0.22, 0.03);                                           // Eye of the head.
    // The wedge: flat, flaring forward and right, to a long bright edge.
    k.body().loft([
      [[0.82, y - 0.045, 0.1], [0.82, y + 0.045, 0.1], [1.02, y + 0.045, 0.1], [1.02, y - 0.045, 0.1]],
      [[0.74, y - 0.03, 0.34], [0.74, y + 0.03, 0.34], [1.1, y + 0.03, 0.34], [1.1, y - 0.03, 0.34]],
    ]);
    k.metal().loft([
      [[0.74, y - 0.03, 0.34], [0.74, y + 0.03, 0.34], [1.1, y + 0.03, 0.34], [1.1, y - 0.03, 0.34]],
      [[0.7, y - 0.008, 0.42], [0.7, y + 0.008, 0.42], [1.14, y + 0.008, 0.42], [1.14, y - 0.008, 0.42]],
    ]);
    // The pick: tapering and curving back toward the hand.
    k.body().loft([
      [[0.86, y - 0.04, -0.1], [0.86, y + 0.04, -0.1], [0.98, y + 0.04, -0.1], [0.98, y - 0.04, -0.1]],
      [[0.86, y - 0.025, -0.3], [0.86, y + 0.025, -0.3], [0.94, y + 0.025, -0.3], [0.94, y - 0.025, -0.3]],
    ]);
    k.metal().loft([
      [[0.86, y - 0.025, -0.3], [0.86, y + 0.025, -0.3], [0.94, y + 0.025, -0.3], [0.94, y - 0.025, -0.3]],
      [[0.8, y - 0.006, -0.44], [0.8, y + 0.006, -0.44], [0.82, y + 0.006, -0.44], [0.82, y - 0.006, -0.44]],
    ]);
    k.accent().box(0.92, y + 0.072, 0, 0.12, 0.012, 0.18);                                      // Stencilled stripe.
    return { geometry: b.build(), muzzle: [1.1, y, 0.3], fore: [0.3, y, 0], eject: [0.6, 0.2, 0], length: 1.75 };
  }

  // Spade: a D grip at the back (a crossbar and two cheeks), a long haft, a socket and a flat blade with a rounded
  // bottom and a tread folded over its top edge. The blade takes the camo; its cutting edge is bright.
  function shovel() {
    const k = kit(), b = k.b, y = 0.08;
    k.grip().box(-0.48, y, 0, 0.05, 0.06, 0.2, 0.015);                                         // D grip crossbar.
    k.dark().box(-0.39, y, -0.09, 0.18, 0.05, 0.035); k.dark().box(-0.39, y, 0.09, 0.18, 0.05, 0.035);
    k.grip().prismX(-0.32, 0.86, y, 0, 0.04, 0.042, 8, OCT);                                   // Haft.
    k.accent().prismX(0.1, 0.2, y, 0, 0.046, 0.046, 8, OCT);                                    // Hand band.
    k.metal().prismX(0.84, 1.02, y, 0, 0.05, 0.06, 6);                                          // Socket.
    k.dark().box(1.04, y + 0.01, 0, 0.05, 0.05, 0.36, 0.01);                                    // Tread.
    // Blade: square shoulders, then the sides draw in to a rounded point.
    blade(k, y, [
      [1.04, -0.17, 0.0, 0.018], [1.3, -0.165, 0.0, 0.016], [1.42, -0.1, 0.0, 0.014], [1.48, -0.02, 0.0, 0.012],
    ]);
    blade(k, y, [
      [1.04, 0.17, 0.0, 0.018], [1.3, 0.165, 0.0, 0.016], [1.42, 0.1, 0.0, 0.014], [1.48, 0.02, 0.0, 0.012],
    ]);
    k.metal().box(1.46, y, 0, 0.05, 0.02, 0.1);                                                 // Worn point.
    return { geometry: b.build(), muzzle: [1.5, y, 0], fore: [0.36, y, 0], eject: [0.6, 0.2, 0], length: 1.98 };
  }

  // Gleaner: a short ribbed wooden handle, a bright ferrule, and the blade set at right angles to it, sweeping left and
  // curling back toward the hand like a hook. From above: an L with a curled foot.
  function kama() {
    const k = kit(), b = k.b, y = 0.08;
    k.dark().prismX(-0.24, -0.2, y, 0, 0.05, 0.045, 8, OCT);                                    // Butt.
    k.grip().prismX(-0.2, 0.32, y, 0, 0.042, 0.046, 8, OCT);                                   // Handle.
    k.dark(); for (let i = 0; i < 3; i++) b.prismX(-0.14 + i * 0.1, -0.11 + i * 0.1, y, 0, 0.05, 0.05, 8, OCT);
    k.accent().prismX(0.32, 0.4, y, 0, 0.055, 0.055, 8, OCT);                                   // Bright ferrule.
    // Blade: out to the left from the head, bending back; spine forward (+X), edge toward the hand.
    const pts = [[0.42, 0.02], [0.44, -0.08], [0.43, -0.17], [0.39, -0.25], [0.32, -0.3], [0.24, -0.32]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], w0 = 0.085 - i * 0.013, w1 = 0.085 - (i + 1) * 0.013;
      const t = 0.014;
      // Perpendicular to the curve, in XZ: spine on the outside (away from the hand).
      const d = (xa, za, xb, zb) => { const l = Math.hypot(xb - xa, zb - za) || 1; return [(zb - za) / l, -(xb - xa) / l]; };
      const [n0x, n0z] = d(x0, z0, x1, z1);
      // The edge on the inside of the curve, toward the hand: rings step from the spine line inward by the blade's width.
      const ring = (x, z, nx, nz, w, part) => (part === 'spine'
        ? [[x, y - t, z], [x, y + t, z], [x + nx * w * 0.5, y + t, z + nz * w * 0.5], [x + nx * w * 0.5, y - t, z + nz * w * 0.5]]
        : [[x + nx * w * 0.5, y - t * 0.7, z + nz * w * 0.5], [x + nx * w * 0.5, y + t * 0.7, z + nz * w * 0.5], [x + nx * w, y + t * 0.7, z + nz * w], [x + nx * w, y - t * 0.7, z + nz * w]]);
      k.body().loft([ring(x0, z0, n0x, n0z, w0, 'spine'), ring(x1, z1, n0x, n0z, w1, 'spine')]);
      k.metal().loft([ring(x0, z0, n0x, n0z, w0, 'edge'), ring(x1, z1, n0x, n0z, w1, 'edge')]);
    }
    return { geometry: b.build(), muzzle: [0.44, y, -0.16], fore: [-0.1, y, 0], eject: [0.4, 0.2, 0], length: 1.0 };
  }

  // Bushwhack: a slab grip with bright rivets and a lanyard hole, a short choil, then a long blade that widens to a
  // squared, clipped tip. Spine on the left takes the camo.
  function machete() {
    const k = kit(), b = k.b, y = 0.08;
    k.grip().box(-0.08, y, 0, 0.4, 0.07, 0.085, 0.02);                                          // Grip slabs.
    k.grip().box(-0.3, y, 0.01, 0.06, 0.075, 0.1, 0.015);                                       // Swelled butt.
    k.accent(); for (const x of [-0.18, 0.0]) b.prismY(y - 0.04, y + 0.04, x, 0, 0.016, 0.016, 6);   // Rivets.
    k.dark().box(0.13, y, 0.0, 0.03, 0.06, 0.12);                                               // Bolster.
    blade(k, y, [
      [0.14, -0.04, 0.045, 0.012], [0.5, -0.045, 0.06, 0.011], [0.86, -0.05, 0.085, 0.01], [1.02, -0.045, 0.095, 0.009],
    ]);
    // Clipped tip: the spine drops to meet the wide end of the edge.
    k.metal().loft([
      [[1.02, y - 0.009, -0.045], [1.02, y + 0.009, -0.045], [1.02, y + 0.009, 0.095], [1.02, y - 0.009, 0.095]],
      [[1.1, y - 0.004, 0.02], [1.1, y + 0.004, 0.02], [1.1, y + 0.004, 0.08], [1.1, y - 0.004, 0.08]],
    ]);
    k.accent().box(0.6, y + 0.012, -0.03, 0.5, 0.006, 0.01);                                    // Ground bevel line.
    return { geometry: b.build(), muzzle: [1.08, y, 0.03], fore: [-0.12, y, 0], eject: [0.4, 0.2, 0], length: 1.45 };
  }

  // Nightstick: held by the side handle (at the origin, pointing down), the long arm running forward past the fist and
  // a short one back along the forearm; a knob at each end and a bright band where it is gripped.
  function tonfa() {
    const k = kit(), b = k.b, y = 0.16;
    k.body().prismX(-0.22, 0.62, y, 0, 0.045, 0.045, 8, OCT);                                  // Baton.
    k.dark().prismX(0.62, 0.68, y, 0, 0.055, 0.04, 8, OCT);                                     // Front knob.
    k.dark().prismX(-0.28, -0.22, y, 0, 0.04, 0.055, 8, OCT);                                   // Back knob.
    k.grip().prismY(y - 0.16, y - 0.03, 0.0, 0, 0.032, 0.032, 8, OCT);                         // Side handle...
    k.dark().prismY(y - 0.2, y - 0.16, 0.0, 0, 0.042, 0.036, 8, OCT);                         // ...and its knob.
    k.accent().prismX(-0.05, 0.05, y, 0, 0.05, 0.05, 8, OCT);                                   // Grip band.
    k.accent().prismX(0.5, 0.54, y, 0, 0.049, 0.049, 8, OCT);                                   // Striking ring.
    return { geometry: b.build(), muzzle: [0.68, y, 0], fore: [-0.12, 0.0, -0.06], eject: [0.3, 0.2, 0], length: 1.0 };
  }

  return { katana, fireaxe, shovel, kama, machete, tonfa };
}
