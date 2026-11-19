// Side-on icons for weapons wave 3 (js/shared/weapons-w3.js), on the same 60x24 grid and with the same vocabulary as
// WEAPON_SPECS in icons.js (f solid, h holes, a accent, b faded). icons.js passes its shape helpers in and merges them.
export function w3Icons({ P, R, grip }) {
  return {
    // Clatter: wire stock, square receiver under a studded rib, slotted jacket, three-fin muzzle.
    burstsmg: {
      f: [R(1, 6.5, 2.4, 7, 0.6), R(3, 7.2, 9, 1.4), R(3, 11.6, 9, 1.4), R(12, 5.5, 15, 7, [1, 0, 0, 0]), R(13, 3.4, 13, 1.8), R(27, 6.4, 14, 4.8, 0.6),
        R(41, 7.6, 4, 2.4), R(45, 4.6, 1.4, 8.4), R(47.4, 4.6, 1.4, 8.4), R(49.8, 4.6, 1.4, 8.4), grip(15, 12.3), R(20.5, 12.4, 3.6, 9, [0, 0, 0.8, 0.8])],
      a: [R(15.5, 1.8, 1.6, 1.4), R(18.5, 1.8, 1.6, 1.4), R(21.5, 1.8, 1.6, 1.4)],
      h: [R(29.5, 7.8, 2, 2), R(33, 7.8, 2, 2), R(36.5, 7.8, 2, 2)],
    },
    // Bullhead: heavy butt with a bright pad, one fat barrel over a tube, deep ribbed pump, ring collar at the muzzle.
    heavyshot: {
      f: [P(2, 7.5, 13, 6, 13, 12, 3, 16.5), R(13, 4.5, 11, 8, [1, 0, 0, 0]), R(24, 4.8, 28, 3.4), R(24, 8.8, 21, 2.2), R(30, 8.2, 11, 4.6, 1),
        R(52, 3.8, 3, 4.8, 0.6), grip(15, 12.4), R(17, 3, 1.4, 1.6)],
      a: [R(0.4, 8, 1.6, 8, 0.4), R(53, 3.6, 0.9, 5.2)],
      h: [R(32.5, 9.2, 1, 2.6), R(35, 9.2, 1, 2.6), R(37.5, 9.2, 1, 2.6)],
    },
    // Gavel: a long square slide with a vented rib, a rail under the nose, a hump over the hand and a squared guard.
    battlepistol: {
      f: [R(4, 4, 32, 6, [0.6, 0.6, 0, 0]), R(3, 3, 2.4, 4, 0.6), R(8, 10, 22, 2.4), R(24, 12.4, 8, 1.4), P(4, 12, 11, 12, 10, 21, 3, 20.5),
        P(11, 12, 17, 12, 17, 15, 11.5, 15), R(5, 2.2, 28, 1.4)],
      a: [R(31, 4.6, 1.2, 4.8)],
      h: [R(7, 2.4, 1.4, 1), R(13, 2.4, 1.4, 1), R(19, 2.4, 1.4, 1), R(25, 2.4, 1.4, 1), R(12.4, 12.2, 3.4, 1.6)],
    },
  };
}
