// The wave 5 operators' showpiece suits (js/ui/operators.js: Juniper, Fenwick, Odessa, Calder), worn by their Mastery
// skins, in the remade style of operator-suits.js (docs/OPERATORS-ART.md section 2): same frames, same tags, a good
// share of team colour where the match camera sees it. operator-suits.js merges these into SUITS beside its own, so
// they are dealt into the suit banks in roster order like every other suit.
//
//   Juniper  tree frog    two great eye domes on top of the head, a pale belly, team spots down the back
//   Fenwick  crab         a carapace wider than the shoulders and two huge claws held out front: the widest outline
//   Odessa   jellyfish    a lit bell over the head with a team rim, frilled arms and long trailing tentacles
//   Calder   elk          broad palmate antlers (the read from above), a shaggy brown dewlap, a team scarf
import { ACC, KEEP, TONE, tag, seg, plate } from './operator-kit.js';

// The same small helpers operator-suits.js uses, kept local so this file only needs operator-kit.js.
function chain(b, pts, r0, r1 = r0, sides = 5) {
  for (let i = 0; i < pts.length - 1; i++) {
    const u = i / (pts.length - 1), v = (i + 1) / (pts.length - 1);
    seg(b, pts[i], pts[i + 1], r0 + (r1 - r0) * u, r0 + (r1 - r0) * v, sides);
  }
}
function roundBody(b, r = 0.34, top = 0.68) {
  b.prismY(-0.06, 0.18, 0, 0, r * 0.82, r, 8, Math.PI / 8);
  b.prismY(0.18, top - 0.2, 0, 0, r, r, 8, Math.PI / 8);
  b.prismY(top - 0.2, top, 0, 0, r, r * 0.66, 8, Math.PI / 8);
}
function harness(b, r = 0.36, y = 0.2) {
  b.setPart(1).prismY(y - 0.045, y + 0.045, 0, 0, r + 0.015, r + 0.015, 8, Math.PI / 8);
  b.box(r - 0.005, 0.47, 0.15, 0.04, 0.3, 0.07).box(r - 0.005, 0.47, -0.15, 0.04, 0.3, 0.07);
  b.box(-r + 0.005, 0.47, 0.15, 0.04, 0.3, 0.07).box(-r + 0.005, 0.47, -0.15, 0.04, 0.3, 0.07);
}

export const W5_SUITS = {};

// Juniper: a tree frog. Bright green, a pale belly and throat, team spots down the back, sticky toe pads on the hands,
// and the head: a wide flat skull under two great eye domes with lit pupils.
const FROG = 0x4fa83a, FROG_D = 0x2f7a28, FROG_B = 0xe8e4b0;
W5_SUITS.juniper = {
  limbs: { bulk: 1.24, hands: 0x6ac04a, feet: 0x3f8a30, sleeve: FROG, trouser: FROG_D },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(FROG);
      roundBody(b, 0.33, 0.64);
      b.setColor(FROG_B).box(0.26, 0.3, 0, 0.12, 0.5, 0.42, 0.06);                               // Belly.
      b.setColor(FROG_D);
      for (const s of [1, -1]) chain(b, [[-0.1, 0.1, s * 0.3], [-0.2, 0.0, s * 0.42], [-0.06, -0.06, s * 0.48]], 0.07, 0.05, 5);   // Haunches.
    });
    b.setPart(1);                                                                                  // Team spots down the back.
    for (const [x, y, z] of [[-0.31, 0.5, 0.1], [-0.31, 0.38, -0.12], [-0.31, 0.26, 0.06], [-0.22, 0.62, -0.02], [-0.26, 0.16, -0.08]]) b.prismX(x - 0.03, x + 0.02, y, z, 0.06, 0.06, 6);
    b.prismY(0.6, 0.66, 0, 0, 0.24, 0.22, 8, Math.PI / 8);                                       // Collar.
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xc8ff6a);
      for (const s of [1, -1]) b.box(0.02, 0.62, s * 0.27, 0.12, 0.03, 0.04);
    });
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(FROG).prismY(0.02, 0.24, 0, 0, 0.24, 0.25, 8, Math.PI / 8);        // Wide flat skull.
      b.prismY(0.24, 0.3, 0, 0, 0.25, 0.18, 8, Math.PI / 8);
      b.setColor(FROG_B).box(0.16, 0.06, 0, 0.12, 0.08, 0.36, 0.03);                             // Throat.
      b.setColor(0x1a3a12).box(0.235, 0.14, 0, 0.02, 0.02, 0.34);                                // The long mouth.
      for (const s of [1, -1]) {
        b.setColor(FROG).prismY(0.24, 0.42, 0.08, s * 0.14, 0.1, 0.11, 8, Math.PI / 8);          // Eye domes.
        b.setColor(0xf0e060).prismY(0.42, 0.46, 0.08, s * 0.14, 0.1, 0.06, 8, Math.PI / 8);
      }
    });
    tag(b, ACC, () => {
      b.setPart(0).setColor(0x101010);
      for (const s of [1, -1]) b.box(0.18, 0.37, s * 0.14, 0.02, 0.06, 0.09);                    // Lit pupils.
    });
    b.setPart(1).box(-0.18, 0.26, 0, 0.06, 0.04, 0.3);                                            // Team band behind.
  },
};

// Fenwick: a crab. A broad lacquered carapace that sits wider than the shoulders with a team rim, four walking legs a
// side, two huge claws held forward and out, and eye stalks on a squat head with mandibles.
const CRAB = 0xc8442a, CRAB_D = 0x8a2a1a, CRAB_L = 0xe8a070;
W5_SUITS.fenwick = {
  limbs: { bulk: 1.3, hands: CRAB, feet: CRAB_D, sleeve: CRAB, trouser: CRAB_D },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(CRAB_D).prismY(-0.06, 0.3, 0, 0, 0.26, 0.3, 8, Math.PI / 8);
      b.setColor(CRAB).prismY(0.3, 0.58, 0, 0, 0.44, 0.48, 8, Math.PI / 8);                     // The carapace.
      b.prismY(0.58, 0.7, 0, 0, 0.48, 0.3, 8, Math.PI / 8);
      b.setColor(CRAB_L).box(0.3, 0.44, 0, 0.1, 0.18, 0.4, 0.03);
      b.setColor(CRAB_D);
      for (const s of [1, -1]) for (let k = 0; k < 4; k++) {                                     // Walking legs.
        const x = 0.14 - k * 0.12, z = s * 0.46;
        chain(b, [[x, 0.38, z], [x - 0.04, 0.46, s * 0.62], [x - 0.08, 0.2, s * 0.7]], 0.03, 0.02, 4);
      }
      for (const s of [1, -1]) {                                                                   // Claws, forward and out.
        b.setColor(CRAB);
        chain(b, [[0.12, 0.5, s * 0.4], [0.32, 0.5, s * 0.56], [0.52, 0.48, s * 0.5]], 0.06, 0.07, 6);
        b.box(0.66, 0.48, s * 0.48, 0.26, 0.14, 0.18, 0.05);                                     // The palm.
        plate(b, [0.76, 0.52, s * 0.42], [0.96, 0.54, s * 0.36], 0.08, 0.06);                    // Fixed finger.
        plate(b, [0.76, 0.42, s * 0.54], [0.94, 0.44, s * 0.6], 0.07, 0.05);                     // The pincer.
      }
    });
    b.setPart(1).prismY(0.66, 0.71, 0, 0, 0.36, 0.33, 8, Math.PI / 8);                           // Team rim on top.
    for (const s of [1, -1]) b.box(0.66, 0.56, s * 0.48, 0.2, 0.025, 0.12);                       // Team bands on the claws.
    tag(b, ACC, () => b.setPart(0).setColor(0xffd08a).box(0.0, 0.715, 0, 0.3, 0.012, 0.06));
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(CRAB).prismY(0.0, 0.2, 0.02, 0, 0.2, 0.18, 8, Math.PI / 8);
      b.setColor(CRAB_D);
      for (const s of [1, -1]) { b.box(0.2, 0.06, s * 0.05, 0.08, 0.04, 0.04); seg(b, [0.1, 0.18, s * 0.08], [0.16, 0.38, s * 0.12], 0.025, 0.02, 4); }
      b.setColor(0x101010).prismY(0.38, 0.45, 0.16, 0.12, 0.04, 0.035, 6).prismY(0.38, 0.45, 0.16, -0.12, 0.04, 0.035, 6);
    });
    tag(b, ACC, () => b.setPart(0).setColor(0xffffff).box(0.2, 0.43, 0.12, 0.01, 0.02, 0.02).box(0.2, 0.43, -0.12, 0.01, 0.02, 0.02));
    b.setPart(1).box(-0.06, 0.2, 0, 0.12, 0.04, 0.32);
  },
};

// Odessa: a jellyfish. A great domed bell over the head, lit from inside (the accent) with a team rim, frilled oral
// arms round the shoulders and long tentacles trailing down the back. The suit underneath is a dark diving skin.
const JELLY = 0x8a7ad8, JELLY_D = 0x3a2e6a;
W5_SUITS.odessa = {
  limbs: { bulk: 1.08, hands: 0x2a2442, feet: 0x1e1a30, sleeve: 0x2a2442, trouser: 0x221e36 },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(0x2a2442).prismY(-0.06, 0.6, 0, 0, 0.26, 0.28, 8, Math.PI / 8);
      b.setColor(JELLY);
      for (let i = 0; i < 6; i++) {                                                                // Frilled arms round the collar.
        const a = (i / 6) * Math.PI * 2 + 0.3, ca = Math.cos(a), sa = Math.sin(a);
        chain(b, [[ca * 0.26, 0.66, sa * 0.26], [ca * 0.34, 0.5, sa * 0.36], [ca * 0.3, 0.3, sa * 0.34], [ca * 0.36, 0.12, sa * 0.38]], 0.05, 0.025, 4);
      }
      b.setColor(JELLY_D);
      for (const z of [-0.18, -0.06, 0.06, 0.18]) chain(b, [[-0.24, 0.62, z], [-0.42, 0.4, z * 1.2], [-0.5, 0.12, z * 1.4], [-0.62, -0.08, z * 1.5]], 0.025, 0.012, 4);   // Trailing tentacles.
    });
    b.setPart(1).prismY(0.58, 0.66, 0, 0, 0.3, 0.27, 8, Math.PI / 8);
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xb8a8ff);
      for (const z of [-0.12, 0.12]) b.prismX(0.27, 0.3, 0.36, z, 0.04, 0.04, 6);                // Lights down the front.
      b.prismX(0.27, 0.3, 0.2, 0, 0.04, 0.04, 6);
    });
  },
  head(b) {
    tag(b, TONE, () => b.setPart(0).setColor(0x7a5c43).box(0.12, 0.17, 0, 0.12, 0.16, 0.22));
    tag(b, ACC, () => {
      b.setPart(0).setColor(0xb8a8ff);
      b.prismY(0.1, 0.34, 0, 0, 0.3, 0.32, 10);                                                   // The bell, lit.
      b.prismY(0.34, 0.48, 0, 0, 0.32, 0.22, 10);
      b.prismY(0.48, 0.54, 0, 0, 0.22, 0.08, 10);
    });
    tag(b, KEEP, () => {
      b.setPart(0).setColor(JELLY_D);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; b.box(Math.cos(a) * 0.18, 0.4, Math.sin(a) * 0.18, 0.08, 0.1, 0.08); }   // Gonads inside the bell.
      b.setColor(0x0c0a10).box(0.2, 0.22, 0.05, 0.012, 0.025, 0.035).box(0.2, 0.22, -0.05, 0.012, 0.025, 0.035);
    });
    b.setPart(1).prismY(0.08, 0.13, 0, 0, 0.33, 0.33, 10);                                         // The team rim.
  },
};

// Calder: an elk. Brown fur on a heavy body with a shaggy dewlap, a team scarf and pack strap, and the head: a long
// muzzle, ears, and broad palmate antlers spread wide, the outline from above.
const ELK = 0x7a5232, ELK_D = 0x4a3020, ELK_L = 0xb08a5a, ANTLER = 0xd8c8a0;
W5_SUITS.calder = {
  limbs: { bulk: 1.34, hands: 0x2a1e16, feet: 0x2a1e16, sleeve: ELK, trouser: ELK_D },
  torso(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(ELK);
      roundBody(b, 0.34, 0.68);
      b.setColor(ELK_D);
      for (let i = 0; i < 7; i++) {                                                                // Shaggy dewlap and mane.
        const z = -0.18 + i * 0.06;
        seg(b, [0.24, 0.64, z], [0.36, 0.36 - (i % 2) * 0.06, z * 1.1], 0.035, 0.015, 4);
        seg(b, [-0.2, 0.68, z], [-0.34, 0.5 - (i % 3) * 0.04, z * 1.2], 0.035, 0.015, 4);
      }
      b.setColor(ELK_L).box(-0.32, 0.12, 0, 0.06, 0.16, 0.2);                                    // Pale rump.
    });
    harness(b, 0.35, 0.22);
    b.setPart(1).prismY(0.62, 0.72, 0, 0, 0.3, 0.26, 8, Math.PI / 8);                           // Team scarf...
    chain(b, [[0.2, 0.66, 0.14], [0.32, 0.5, 0.2], [0.3, 0.32, 0.24]], 0.05, 0.035, 4);           // ...and its tail.
  },
  head(b) {
    tag(b, KEEP, () => {
      b.setPart(0).setColor(ELK).prismY(0.04, 0.34, -0.02, 0, 0.2, 0.17, 8, Math.PI / 8);
      b.setColor(ELK_D).box(0.26, 0.18, 0, 0.26, 0.16, 0.18, 0.05);                              // Long muzzle.
      b.setColor(0x1a1210).box(0.395, 0.2, 0, 0.02, 0.06, 0.12);
      b.setColor(0x0c0a08).box(0.16, 0.27, 0.11, 0.03, 0.035, 0.012).box(0.16, 0.27, -0.11, 0.03, 0.035, 0.012);
      b.setColor(ELK);
      for (const s of [1, -1]) plate(b, [0.0, 0.32, s * 0.15], [-0.04, 0.4, s * 0.3], 0.08, 0.025);   // Ears.
      b.setColor(ANTLER);
      for (const s of [1, -1]) {
        chain(b, [[-0.02, 0.36, s * 0.1], [-0.04, 0.48, s * 0.24], [-0.08, 0.54, s * 0.36]], 0.03, 0.025, 4);
        b.box(-0.12, 0.58, s * 0.5, 0.34, 0.03, 0.3, 0.02);                                      // The palm.
        for (let k = 0; k < 4; k++) seg(b, [-0.24 + k * 0.08, 0.58, s * 0.62], [-0.27 + k * 0.09, 0.66, s * 0.7], 0.018, 0.01, 4);   // Tines.
      }
    });
    tag(b, ACC, () => b.setPart(0).setColor(0xffd08a).box(-0.12, 0.6, 0.5, 0.2, 0.012, 0.04).box(-0.12, 0.6, -0.5, 0.2, 0.012, 0.04));
    b.setPart(1).box(-0.02, 0.36, 0, 0.08, 0.04, 0.26);
  },
};
