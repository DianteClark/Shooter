// Side-on icons for weapons wave 4's melee weapons (js/shared/weapons-w4.js), on the same 60x24 grid and with the same
// vocabulary as WEAPON_SPECS in icons.js (f solid, h holes, a accent). icons.js passes its shape helpers in and merges them.
export function w4Icons({ P, R }) {
  return {
    // Kagero: a wrapped two-hand grip, an oval guard, a long blade rising gently to an angled tip.
    katana: {
      f: [R(1, 10.4, 14, 3.2, 1), R(15, 7.6, 1.8, 8.8, 0.6), P(17, 10.2, 40, 9.6, 52, 7.6, 58, 5.6, 52, 9.6, 40, 12.6, 17, 13.2)],
      a: [R(3, 10.4, 1.2, 3.2), R(6, 10.4, 1.2, 3.2), R(9, 10.4, 1.2, 3.2), R(12, 10.4, 1.2, 3.2)],
    },
    // Kindling: a long haft, a broad wedge below and a pick above.
    fireaxe: {
      f: [R(2, 10.6, 44, 2.8, 1), P(43, 9, 49, 9, 52, 22, 40, 22, 43, 15), P(44, 9, 48, 9, 46, 1.5, 44.5, 1.5)],
      a: [R(10, 10.6, 3, 2.8), P(40, 20.4, 52, 20.4, 52, 22, 40, 22)],
    },
    // Spade: a D grip, a long haft, a square-shouldered blade with a rounded point.
    shovel: {
      f: [R(1, 7, 2, 10), R(3, 7, 5, 1.6), R(3, 15.4, 5, 1.6), R(7, 10.8, 30, 2.4, 0.8), R(36, 10.2, 3, 3.6), P(39, 5.5, 50, 5.5, 57, 9, 58, 12, 57, 15, 50, 18.5, 39, 18.5)],
      h: [R(42, 11.2, 9, 1.6)],
      a: [R(18, 10.8, 3, 2.4)],
    },
    // Gleaner: a short ribbed handle and a hooked blade at right angles, curling back.
    kama: {
      f: [R(4, 13, 24, 3.4, 1.2), R(28, 12.6, 3, 4.2), P(30, 12.6, 32.5, 12.6, 33, 7, 30.5, 3, 25, 1.5, 19, 2, 25, 3.8, 29, 6.5)],
      a: [R(28, 12.6, 3, 4.2)],
      h: [R(10, 13, 1, 3.4), R(15, 13, 1, 3.4), R(20, 13, 1, 3.4)],
    },
    // Bushwhack: a riveted grip, a bolster and a blade widening to a clipped tip.
    machete: {
      f: [R(2, 10, 15, 4, 1.4), R(17, 9, 1.6, 6), P(18.6, 9.8, 50, 8.2, 57, 9.4, 55, 15.6, 18.6, 13.6)],
      h: [R(6, 11.4, 1.2, 1.2), R(11, 11.4, 1.2, 1.2)],
      a: [R(24, 9.4, 22, 0.8)],
    },
    // Nightstick: a long baton with a knob at each end and the side handle hanging under the grip.
    tonfa: {
      f: [R(4, 8, 46, 3.4, 1.2), R(1.5, 7.4, 2.8, 4.6, 1), R(49.5, 7.4, 2.8, 4.6, 1), R(15, 11.4, 3, 8), R(14.2, 18.4, 4.6, 2.4, 0.8)],
      a: [R(13.5, 8, 6, 3.4), R(42, 8, 2, 3.4)],
    },
  };
}
