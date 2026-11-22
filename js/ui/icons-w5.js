// Icons for weapons wave 5 (js/shared/weapons-w5.js), its perks and its scorestreaks, in the same vocabulary as icons.js
// (f solid, h holes, a accent, b faded, s strokes). Weapons are side-on on the 60x24 strip; perks and streaks are on
// the 32 grid. icons.js passes its shape helpers in and merges both tables.
export function w5Icons({ P, R, O, grip }) {
  return {
    // Gadfly: tail fins, a square receiver, a ringed shroud, the stinger barrel and its eye ring; a raked stick mag.
    hipsmg: {
      f: [P(1, 5, 12, 8.5, 12, 11.5, 1, 15), R(12, 5, 18, 7, [1, 0, 0, 0]), R(30, 5.2, 10, 6.6, 1), R(40, 7.4, 6, 2.2), R(46, 5.8, 2, 5.4, 0.5),
        grip(15.5, 11.5), P(22.5, 11.5, 27, 11.5, 30, 20.5, 25.8, 21), R(15, 3.2, 8, 1.8, 0.4)],
      h: [R(32, 7.4, 1.3, 2.2), R(34.8, 7.4, 1.3, 2.2), R(37.6, 7.4, 1.3, 2.2)],
      a: [R(48, 6.6, 1.2, 3.8)],
    },
    // Carousel: a club butt, the fat ribbed jacket, a pan lying flat on top (the long thin slab) and its spindle.
    panlmg: {
      f: [P(1, 8, 12, 7, 12, 12.5, 2, 15.5), R(12, 6.5, 12, 6.5, [1, 0, 0, 0]), R(24, 6, 25, 7.5, 1.5), R(49, 8.4, 7, 2.2), R(55.5, 7.6, 2, 3.8, 0.4),
        R(15.5, 4.3, 2, 2.2), grip(15, 12.5), bar0(40, 13, 37, 21), bar0(41, 13, 44, 21)],
      a: [R(6, 1.5, 22, 2.8, 1.2)],
      h: [R(27, 8.6, 1.4, 2.4), R(31, 8.6, 1.4, 2.4), R(35, 8.6, 1.4, 2.4), R(39, 8.6, 1.4, 2.4), R(43, 8.6, 1.4, 2.4)],
    },
    // Vigil: skeleton butt, receiver, scope, handguard under a gas tube to its block, a long barrel, a three-port brake.
    autosniper: {
      f: [P(1, 7, 11, 7, 11, 12, 2, 15.5), R(11, 6.5, 13, 6, [1, 0, 0, 0]), R(24, 7, 12, 4.5, 0.8), R(36, 8.2, 18, 1.8), R(54, 7.2, 4, 3.8, 0.6),
        R(13, 1.8, 14, 3.4, 1), R(17, 5.2, 2, 1.4), R(23, 5.2, 2, 1.4), R(24, 5.4, 14, 1), R(37, 5, 2.4, 3.2), grip(13.5, 12),
        P(19, 12.3, 24, 12.3, 23.8, 19, 19.5, 19)],
      h: [R(3.5, 9.2, 5.5, 2, 0.5), R(55, 8, 0.8, 2.2), R(56.6, 8, 0.8, 2.2)],
      a: [R(26.6, 2.2, 0.8, 2.6)],
    },
    // Fusee: a fat short barrel on a hinge, the hammer spur, a round grip and the lit star in the muzzle.
    flare: {
      f: [R(8, 6, 8, 7, [1, 0, 0, 0]), R(16, 4.4, 20, 8, 1.2), R(35.5, 4, 2.6, 8.8, 0.6), P(5, 4, 8.5, 2.5, 10, 6, 8, 7.5), P(8, 13, 14, 13, 13.5, 21.5, 7, 21.5, 6.5, 16)],
      h: [R(19, 6.2, 12, 1.2), O(10, 9.5, 1.2)],
      a: [R(38, 5.6, 1.6, 5.6, 0.5)],
    },
    // Skyhook: two tubes (the back one faded, a little higher), a seeker box with its lens and fins, a shoulder pad.
    lockon: {
      b: [R(4, 3.5, 40, 5.5, [0.8, 0, 0, 0.8]), P(44, 3.5, 50, 3.5, 55, 6.25, 50, 9, 44, 9)],
      f: [P(0, 7, 4, 8, 4, 14, 0, 15), R(4, 8, 38, 6, [0.8, 0, 0, 0.8]), R(27, 1.2, 7, 4, 0.6), R(14, 14, 6, 3.5), grip(14, 13.5, 3.4, 6, 1.4), grip(26, 13.5, 3.4, 6, 1.4)],
      a: [P(42, 8, 48, 8, 56, 11, 48, 14, 42, 14), R(34, 2, 1.2, 2.4)],
      h: [R(8, 10.2, 7, 1.4), R(31, 10.2, 7, 1.4)],
    },
  };
  function bar0(x1, y1, x2, y2) { const w = 1.6, dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2; return [x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny]; }
}

// Perks and scorestreaks (32 grid). `mini` is icons.js's weapon-in-a-square, `merge`/`back` its layer helpers.
export function w5Square({ P, R, O, bar, star, mini, merge, back, rotSpec }) {
  return {
    // ---- Perks ----
    // Overkill: two long guns crossed, the second one lit.
    overkill: merge(back(mini('ar', -32)), mini('smg', 32, true)),
    // Amped: the swap arrows with a bolt through them.
    amped: { f: [R(3, 7, 14, 4.2), P(15, 3, 22, 9.1, 15, 15.2), R(15, 21, 14, 4.2), P(17, 16.8, 10, 23.1, 17, 29.2)], a: [P(20, 1.5, 12, 15, 17, 15, 14, 30, 25, 13, 19.5, 13, 23.5, 1.5)] },
    // Double Time: two chevrons driving forward over a stride line.
    doubletime: { f: [P(3, 6, 9, 6, 17, 16, 9, 26, 3, 26, 11, 16), P(14, 6, 20, 6, 28, 16, 20, 26, 14, 26, 22, 16)], a: [R(2, 28, 28, 2.5)] },
    // High Alert: an eye wide open, an alarm mark lit above it.
    highalert: { f: [P(1.5, 20, 9, 13, 23, 13, 30.5, 20, 23, 27, 9, 27), O(16, 20, 2.6)], h: [O(16, 20, 5.2)], a: [R(14.4, 1.5, 3.2, 7.5), R(14.4, 10, 3.2, 2.6)] },
    // Skywatch: a ring sight on a plane overhead.
    skywatch: { f: [O(16, 16, 13.5), P(16, 6, 18, 10, 18, 14, 27, 18, 27, 20, 18, 18.5, 18, 23, 21, 25.5, 21, 27, 16, 26, 11, 27, 11, 25.5, 14, 23, 14, 18.5, 5, 20, 5, 18, 14, 14, 14, 10)], h: [O(16, 16, 11)], a: [O(16, 16, 1.6)] },

    // ---- Scorestreaks ----
    // VTOL Jet: a delta jet from above with a lift fan in each wing and its nose gun lit.
    vtol: { f: [P(16, 1.5, 19, 8, 19, 13, 30, 22, 30, 25, 19, 22, 19, 26, 23, 29.5, 9, 29.5, 13, 26, 13, 22, 2, 25, 2, 22, 13, 13, 13, 8)], h: [O(9, 21, 2.4), O(23, 21, 2.4)], a: [R(15, 0.5, 2, 3.5), O(9, 21, 1.2), O(23, 21, 1.2)] },
    // SAM Turret: a pod of four tubes on a turntable and tripod, a missile leaving it.
    sam: { f: [rotSpec({ f: [R(5, 9, 16, 9, 1.5)] }, -30).f[0], R(10, 20, 12, 3.5, 1), bar(16, 23, 8, 30, 2.6), bar(16, 23, 24, 30, 2.6), R(14.6, 22, 2.8, 8)], h: rotSpec({ h: [O(9, 11.5, 1.4), O(9, 15.5, 1.4), O(14, 11.5, 1.4), O(14, 15.5, 1.4)] }, -30).h, a: [rotSpec({ f: [R(22, 2, 7, 2.6, 1.3)] }, -30).f[0], P(25, 8, 27.5, 9.5, 24, 11)] },
    // Napalm Strike: a jet's swept wing over a line of flames.
    napalm: { f: [P(16, 1, 18.5, 6, 30, 12, 30, 14.5, 18.5, 12, 18, 16, 21, 18.5, 11, 18.5, 14, 16, 13.5, 12, 2, 14.5, 2, 12, 13.5, 6)], a: [P(2, 30, 4, 24, 6, 27, 8, 22, 10, 30), P(12, 30, 14, 23, 16, 26.5, 18, 21.5, 20, 30), P(22, 30, 24, 24, 26, 27, 28, 22, 30, 30)] },
  };
}
