// Calling card grounds for the rewards pass (docs/UNLOCKS-AUDIT-2026-11-12.md): every map not drawn in cards.js, the
// modes added after the first six, Graveyard Shift's own cards, and the tier marks. Same rules as cards.js PATTERNS:
// each draws the 300x80 box over a flat ground, mostly right of x 90 (the emblem and name sit left), seeded by the card
// id through `r`, with c = [ground, mid, light, accent]. No ids or defs, so a card can repeat on a page.
// cards.js merges REWARD_PATTERNS into its own table and calls tierMarks() for a card whose art carries `tier`.

const W = 300, H = 80;
const f1 = v => Math.round(v * 10) / 10;
const pts = list => list.map(p => `${f1(p[0])},${f1(p[1])}`).join(' ');
const poly = (list, fill, extra = '') => `<polygon points="${pts(list)}" fill="${fill}"${extra}/>`;
const line = (x1, y1, x2, y2, stroke, w, extra = '') => `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${stroke}" stroke-width="${w}"${extra}/>`;
const circ = (x, y, r, fill, extra = '') => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${fill}"${extra}/>`;
const path = (d, stroke, w, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}"${extra}/>`;
const fillPath = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;
const rect = (x, y, w, h, fill, extra = '') => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], fill, extra);
const op = v => ` opacity="${v}"`;

// A bare tree: trunk and forking branches, for groves and graveyards.
function bareTree(x, base, h, col, r, w = 2.4) {
  let s = line(x, base, x, base - h, col, w);
  const fork = (x0, y0, a, len, depth) => {
    if (depth <= 0 || len < 3) return;
    const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
    s += line(x0, y0, x1, y1, col, Math.max(0.8, depth * 0.5));
    fork(x1, y1, a - 0.45 - r() * 0.2, len * 0.66, depth - 1);
    fork(x1, y1, a + 0.45 + r() * 0.2, len * 0.62, depth - 1);
  };
  fork(x, base - h * 0.55, -Math.PI / 2 - 0.5, h * 0.35, 3);
  fork(x, base - h * 0.75, -Math.PI / 2 + 0.45, h * 0.32, 3);
  return s;
}
// A headstone: rounded top slab.
const stone = (x, base, w, h, col, extra = '') => fillPath(`M${f1(x)} ${f1(base)} L${f1(x)} ${f1(base - h + w / 2)} Q${f1(x)} ${f1(base - h)} ${f1(x + w / 2)} ${f1(base - h)} Q${f1(x + w)} ${f1(base - h)} ${f1(x + w)} ${f1(base - h + w / 2)} L${f1(x + w)} ${f1(base)} Z`, col, extra);
// A palm: curved trunk and five fronds.
function palm(x, base, h, lean, col, r) {
  const tx = x + lean, ty = base - h;
  let s = path(`M${f1(x)} ${f1(base)} Q${f1(x + lean * 0.2)} ${f1(base - h * 0.5)} ${f1(tx)} ${f1(ty)}`, col, 3, ' stroke-linecap="round"');
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI + i * Math.PI / 5 + (r() - 0.5) * 0.2, len = 16 + r() * 6;
    const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.6 + 6;
    s += fillPath(`M${f1(tx)} ${f1(ty)} Q${f1((tx + ex) / 2)} ${f1(Math.min(ty, ey) - 6)} ${f1(ex)} ${f1(ey)} Q${f1((tx + ex) / 2)} ${f1(Math.min(ty, ey) - 1)} ${f1(tx)} ${f1(ty + 2)} Z`, col);
  }
  return s;
}

export const REWARD_PATTERNS = {
  /* ---- Maps ---- */
  boardwalk(c, r) {        // Pier: planks on pilings over swell, a lamp at the end.
    let s = '';
    for (let y = 58; y < H; y += 5) s += path(`M90 ${y} q12 -3 24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0`, c[1], 1.2, op((0.4 + (y - 58) / 40).toFixed(2)));
    s += rect(96, 40, W - 96, 6, c[1]);
    for (let x = 100; x < W; x += 13) s += line(x, 41, x, 45, c[0], 1, op('.6'));
    for (let x = 106; x < W; x += 34) s += rect(x, 46, 4, 26 + r() * 6, c[1]);
    s += line(270, 40, 270, 10, c[2], 2) + line(270, 10, 280, 10, c[2], 2) + circ(281, 13, 3.4, c[3]) + circ(281, 13, 12, c[3], op('.16'));
    return s + circ(281, 60, 8, c[3], op('.12'));
  },
  furnace(c, r) {          // Foundry: stacks, a ladle pouring a bright stream into a mould.
    let s = '';
    for (const [x, h] of [[112, 52], [134, 64], [232, 46]]) s += rect(x, H - h, 12, h, c[1]) + rect(x - 2, H - h, 16, 4, c[1]);
    for (let i = 0; i < 5; i++) s += circ(140 + r() * 10 + i * 4, 8 - i, 6 + i * 2, c[2], op((0.08 + r() * 0.05).toFixed(2)));
    s += poly([[168, 22], [204, 22], [198, 40], [174, 40]], c[1]) + line(186, 22, 186, 6, c[1], 2);
    s += path('M198 34 Q214 36 216 54 L216 70', c[3], 4, ' stroke-linecap="round"') + path('M198 34 Q214 36 216 54 L216 70', '#fff4bf', 1.4);
    s += rect(196, 68, 46, 12, c[1]) + rect(200, 70, 38, 4, c[3], op('.85'));
    for (let i = 0; i < 9; i++) s += circ(206 + r() * 24, 52 + r() * 16, 0.9 + r(), c[3], op('.8'));
    return s + circ(216, 70, 26, c[3], op('.1'));
  },
  tunnel(c) {              // Turnstile: a subway mouth, rails running in, the train's lamps in the dark.
    let s = '';
    for (let k = 0; k < 4; k++) {
      const w = 92 - k * 20, h = 70 - k * 15, x = 220 - w / 2, y = H - h;
      s += fillPath(`M${x} ${H} L${x} ${y + w / 3} Q${x} ${y} ${x + w / 2} ${y} Q${x + w} ${y} ${x + w} ${y + w / 3} L${x + w} ${H} Z`, k % 2 ? c[0] : c[1], op((0.55 + k * 0.12).toFixed(2)));
    }
    s += line(140, H, 212, 60, c[2], 2, op('.7')) + line(300, H, 228, 60, c[2], 2, op('.7'));
    for (let i = 0; i < 5; i++) { const t = i / 5, y = H - t * 20; s += line(150 + t * 60, y, 290 - t * 60, y, c[2], 1, op('.35')); }
    s += circ(212, 54, 2.4, c[3]) + circ(228, 54, 2.4, c[3]) + circ(220, 54, 16, c[3], op('.12'));
    // Turnstile arms at the left of the mouth.
    return s + rect(120, 46, 4, 34, c[1]) + line(122, 52, 140, 48, c[2], 2) + line(122, 52, 138, 60, c[2], 2) + line(122, 52, 106, 56, c[2], 2);
  },
  overpass(c, r) {         // Overpass: a deck on piers, streetlamps, the long light of traffic under it.
    let s = rect(90, 28, W - 90, 7, c[1]) + rect(90, 35, W - 90, 2, c[0], op('.6'));
    for (let x = 118; x < W; x += 56) s += poly([[x, 37], [x + 10, 37], [x + 8, H], [x + 2, H]], c[1]);
    for (let x = 104; x < W; x += 40) s += line(x, 28, x, 12, c[2], 1.2) + line(x, 12, x + 7, 12, c[2], 1.2) + circ(x + 8, 13, 1.8, c[3]) + circ(x + 8, 13, 6, c[3], op('.15'));
    for (let i = 0; i < 9; i++) { const y = 56 + r() * 18, x = 96 + r() * 120; s += line(x, y, x + 40 + r() * 60, y, i % 3 ? '#ff4a3a' : c[2], 1.6, op('.75') + ' stroke-linecap="round"'); }
    return s;
  },
  towers(c, r) {           // Downtown: tall towers, lit windows, a spire with a beacon.
    let s = '', x = 94;
    while (x < W) {
      const w = 14 + r() * 18, h = 34 + r() * 44;
      s += rect(x, H - h, w, h, c[1]);
      for (let wy = H - h + 4; wy < H - 3; wy += 5) for (let wx = x + 2; wx < x + w - 3; wx += 4) if (r() < 0.3) s += rect(wx, wy, 2, 2.4, c[3], op('.75'));
      x += w + 3;
    }
    s += poly([[236, 6], [240, 0], [244, 6], [246, H], [234, H]], c[1]) + circ(240, 3, 2, '#ff4a3a');
    return s + line(90, H - 0.5, W, H - 0.5, c[2], 1, op('.4'));
  },
  palms(c, r) {            // Oasis: palms round a still pool under the haze.
    let s = circ(250, 22, 14, c[2], op('.35'));
    s += `<ellipse cx="200" cy="70" rx="80" ry="9" fill="${c[3]}" opacity=".55"/>` + `<ellipse cx="200" cy="70" rx="64" ry="5" fill="${c[2]}" opacity=".25"/>`;
    s += palm(130, 72, 46, 14, c[1], r) + palm(170, 66, 36, -10, c[1], r) + palm(268, 72, 50, -16, c[1], r);
    return s + poly([[90, H], [90, 74], [W, 76], [W, H]], c[1], op('.7'));
  },
  mesas(c, r) {            // Canyon: flat-topped mesas in bands, striated faces.
    let s = '';
    const layers = [[34, c[1], 0.55], [48, c[1], 0.85], [62, c[0], 1]];
    layers.forEach(([base, col, o], k) => {
      let d = `M90 ${H} L90 ${base}`, x = 90;
      while (x < W) { const w = 26 + r() * 40, top = base - 6 - r() * 16 + k * 4; d += ` L${f1(x + 6)} ${f1(top)} L${f1(x + w - 6)} ${f1(top)} L${f1(x + w)} ${base}`; x += w + r() * 10; d += ` L${f1(x)} ${base}`; }
      s += fillPath(`${d} L${W} ${H} Z`, col, op(o));
    });
    for (let i = 0; i < 6; i++) s += line(96, 40 + i * 6, W, 38 + i * 6.4, c[3], 1, op('.18'));
    return s + circ(276, 14, 7, c[3], op('.7'));
  },
  temple(c, r) {           // Ruins: a stepped temple behind broken columns, vines hanging.
    let s = '';
    for (let k = 0; k < 5; k++) { const w = 110 - k * 20, h = 9; s += rect(214 - w / 2, H - (k + 1) * h, w, h, c[1], op((0.6 + k * 0.08).toFixed(2))); }
    s += rect(206, H - 54, 16, 9, c[0]);
    for (const [x, h] of [[110, 44], [130, 30], [150, 52], [276, 38]]) s += rect(x, H - h, 9, h, c[1]) + rect(x - 2, H - h - 3, 13, 3, c[2], op('.5'));
    for (let i = 0; i < 8; i++) { const x = 100 + r() * 190; s += path(`M${f1(x)} 0 q${f1((r() - 0.5) * 10)} ${f1(12 + r() * 10)} 0 ${f1(22 + r() * 18)}`, c[3], 1.2, op('.6')); }
    return s + circ(214, H - 49, 2, c[3]);
  },
  crowns(c, r) {           // Canopy: overlapping crowns and a rope bridge slung between two.
    let s = '';
    for (let k = 0; k < 3; k++) for (let i = 0; i < 7; i++) {
      const x = 96 + i * 32 + r() * 14, y = 18 + k * 20 + r() * 6, rr = 14 + r() * 8;
      s += circ(x, y, rr, k === 1 ? c[1] : c[0], op((0.5 + k * 0.2).toFixed(2)));
    }
    s += path('M150 30 Q200 46 250 28', c[2], 1.4) + path('M150 34 Q200 50 250 32', c[2], 1, op('.6'));
    for (let i = 0; i < 9; i++) { const t = (i + 0.5) / 9, x = 150 + t * 100; s += line(x, 30 + Math.sin(t * Math.PI) * 14 - t * 2, x, 34 + Math.sin(t * Math.PI) * 14 - t * 2, c[3], 1.6); }
    return s;
  },
  river(c, r) {            // Riverbend: a river swinging through a bend, reeds on the banks.
    let s = fillPath('M90 80 C150 60 120 30 190 28 S270 50 300 10 L300 34 C280 66 230 46 196 50 S160 74 130 80 Z', c[3], op('.7'));
    s += path('M110 72 C150 56 130 36 190 34 S262 50 296 18', c[2], 1, op('.5') + ' stroke-dasharray="6 5"');
    for (let i = 0; i < 18; i++) { const x = 96 + r() * 200, y = 8 + r() * 70; s += line(x, y, x + (r() - 0.5) * 3, y - 6 - r() * 6, c[1], 1.2); }
    return s;
  },
  peaks(c, r) {            // Expedition: a snow ridge, tents and a flag at base camp.
    let s = poly([[90, H], [150, 18], [180, 40], [222, 4], [270, 46], [300, 30], [300, H]], c[1]);
    s += poly([[150, 18], [140, 30], [156, 28], [164, 32]], c[2]) + poly([[222, 4], [210, 20], [224, 16], [236, 22]], c[2]);
    for (const [x, k] of [[150, 1], [180, 0.8], [206, 1]]) s += poly([[x - 12 * k, H - 4], [x, H - 4 - 14 * k], [x + 12 * k, H - 4]], c[3], op('.85'));
    s += line(240, H - 4, 240, 46, c[2], 1.4) + poly([[240, 46], [256, 50], [240, 54]], c[3]);
    for (let i = 0; i < 12; i++) s += circ(96 + r() * 200, r() * 50, 0.8, c[2], op('.6'));
    return s;
  },
  icebow(c, r) {           // Icebreaker: a red bow shouldering through cracked floes.
    let s = '';
    for (let i = 0; i < 14; i++) {
      const x = 96 + r() * 200, y = 52 + r() * 26, w = 10 + r() * 16;
      s += poly([[x, y], [x + w, y - 2 + r() * 4], [x + w - 3, y + 5], [x + 2, y + 6]], c[2], op((0.5 + r() * 0.4).toFixed(2)));
    }
    s += poly([[300, 14], [214, 46], [204, 62], [300, 62]], c[3]) + poly([[300, 18], [222, 46], [300, 46]], '#000', op('.18'));
    s += rect(262, 0, 24, 18, c[1]) + rect(268, 4, 4, 4, c[2]) + rect(276, 4, 4, 4, c[2]);
    for (let i = 0; i < 3; i++) s += circ(244 + i * 16, 54, 2, c[2]);
    return s + path('M200 64 l14 -4 l-4 10 l12 -2', c[2], 1.2);
  },
  grove(c, r) {            // Ashgrove Halt: bare trees by a little platform lamp, ash falling.
    let s = rect(176, 64, 96, 6, c[1]) + line(250, 64, 250, 28, c[1], 2) + rect(244, 22, 12, 7, c[1]) + circ(250, 26, 2.4, c[3]) + circ(250, 26, 14, c[3], op('.15'));
    s += rect(196, 48, 34, 16, c[1]) + poly([[192, 48], [213, 38], [234, 48]], c[1]) + rect(209, 54, 6, 10, c[3], op('.5'));
    s += bareTree(120, H, 58, c[1], r) + bareTree(152, H, 44, c[1], r) + bareTree(290, H, 62, c[1], r);
    for (let i = 0; i < 20; i++) s += circ(96 + r() * 204, r() * H, 0.9, c[2], op('.55'));
    return s;
  },
  zone(c) {                // Frontier: the closing circle over the land, a plane's drop line across it.
    let s = '';
    for (let k = 0; k < 5; k++) s += path(`M${92 + k * 30} ${H} q30 -14 60 0`, c[1], 1, op('.6'));
    s += circ(222, 42, 52, 'none', ` stroke="${c[2]}" stroke-width="1.4" stroke-dasharray="5 4"`) + circ(236, 46, 26, 'none', ` stroke="${c[3]}" stroke-width="2.4"`);
    s += line(96, 8, 300, 30, c[2], 1, op('.6') + ' stroke-dasharray="2 4"') + poly([[262, 26], [276, 27.5], [262, 29]], c[2]);
    return s + circ(236, 46, 4, c[3]);
  },

  /* ---- Modes ---- */
  beacon(c) {              // Headquarters: a command post with a beacon pulsing out.
    let s = '';
    for (let k = 1; k <= 4; k++) s += circ(236, 30, k * 12, 'none', ` stroke="${c[3]}" stroke-width="${(2.6 - k * 0.5).toFixed(1)}" opacity="${(0.8 - k * 0.16).toFixed(2)}"`);
    s += rect(206, 48, 60, 32, c[1]) + rect(230, 60, 12, 20, c[0]) + line(236, 48, 236, 30, c[2], 2) + circ(236, 29, 3.4, c[3]);
    for (let i = 0; i < 3; i++) s += rect(212 + i * 18, 54, 8, 4, c[2], op('.5'));
    return s;
  },
  vip(c) {                 // Kill Order: a marked target with a crown over the sight.
    let s = circ(236, 44, 28, 'none', ` stroke="${c[1]}" stroke-width="2"`) + circ(236, 44, 16, 'none', ` stroke="${c[1]}" stroke-width="1.4"`);
    s += line(236, 8, 236, 30, c[2], 1.4) + line(236, 58, 236, 80, c[2], 1.4) + line(196, 44, 222, 44, c[2], 1.4) + line(250, 44, 280, 44, c[2], 1.4);
    s += poly([[222, 26], [222, 12], [229, 19], [236, 8], [243, 19], [250, 12], [250, 26]], c[3]);
    return s + circ(236, 44, 6, c[3]) + circ(236, 44, 2.4, c[0]);
  },
  lanes(c) {               // Control: two zones under siege, a row of lives ticking down.
    let s = '';
    for (const [x, on] of [[186, true], [260, false]]) {
      s += poly([[x - 22, 40], [x, 18], [x + 22, 40], [x, 62]], 'none', ` stroke="${on ? c[3] : c[1]}" stroke-width="${on ? 2.6 : 1.6}"`);
      s += poly([[x - 10, 40], [x, 30], [x + 10, 40], [x, 50]], on ? c[3] : c[1], op(on ? '.5' : '.4'));
    }
    for (let i = 0; i < 10; i++) s += rect(130 + i * 15, 70, 10, 5, i < 6 ? c[2] : c[1], op(i < 6 ? '.85' : '.4'));
    return s + line(223, 4, 223, 64, c[2], 1, op('.35') + ' stroke-dasharray="3 3"');
  },
  bank(c, r) {             // Grind: tags spilling toward a bank slot.
    let s = rect(240, 28, 46, 46, c[1]) + rect(250, 40, 26, 6, c[0]) + rect(252, 52, 22, 14, c[3], op('.25'));
    for (let i = 0; i < 9; i++) {
      const x = 110 + i * 14 + r() * 6, y = 30 + Math.sin(i * 0.9) * 14 + r() * 8, a = (r() - 0.5) * 60;
      s += `<g transform="rotate(${f1(a)} ${f1(x)} ${f1(y)})">` + poly([[x - 5, y - 7], [x + 5, y - 7], [x + 6, y - 5], [x + 6, y + 5], [x + 5, y + 7], [x - 5, y + 7], [x - 6, y + 5], [x - 6, y - 5]], i % 3 ? c[2] : c[3], op('.9')) + circ(x, y - 4, 1, c[0]) + '</g>';
    }
    return s + path('M226 43 l10 0 m-4 -4 l4 4 l-4 4', c[3], 2);
  },
  spread(c, r) {           // Infected: blots spreading through a crowd of dots.
    let s = '';
    for (let i = 0; i < 26; i++) { const x = 100 + r() * 196, y = 6 + r() * 68, d = Math.hypot(x - 250, y - 40); s += circ(x, y, 2.6, d < 46 ? c[3] : c[2], op(d < 46 ? '.9' : '.5')); }
    for (let k = 0; k < 3; k++) s += circ(250, 40, 18 + k * 14, c[3], op((0.16 - k * 0.04).toFixed(2)));
    return s;
  },
  chamber(c) {             // One in the Chamber: one round standing, three life pips.
    let s = '';
    for (let i = 0; i < 5; i++) { const x = 130 + i * 18; s += poly([[x, 72], [x, 40], [x + 4, 32], [x + 8, 40], [x + 8, 72]], c[1], op('.35')); }
    s += poly([[236, 74], [236, 30], [242, 16], [248, 30], [248, 74]], c[3]) + line(236, 36, 248, 36, c[2], 1.4, op('.6'));
    for (let i = 0; i < 3; i++) s += circ(272, 26 + i * 14, 4, i < 2 ? c[2] : 'none', i < 2 ? '' : ` stroke="${c[2]}" stroke-width="1.4"`);
    return s;
  },
  duel(c) {                // Showdown: two against two across a lit centre, the score in rounds.
    let s = poly([[226, 0], [246, 0], [256, H], [216, H]], c[2], op('.08'));
    for (const [x, y, col] of [[160, 30, c[2]], [176, 52, c[2]], [292, 30, c[3]], [276, 52, c[3]]]) s += circ(x, y - 6, 4, col) + poly([[x - 5, y - 1], [x + 5, y - 1], [x + 6, y + 14], [x - 6, y + 14]], col);
    for (let i = 0; i < 6; i++) s += rect(200 + i * 9, 6, 6, 6, c[3], op('.9'));
    return s + line(236, 16, 236, 76, c[2], 1.4, ' stroke-dasharray="4 4"');
  },
  chutes(c, r) {           // Battle royale: canopies drifting down inside the circle.
    let s = circ(240, 52, 40, 'none', ` stroke="${c[3]}" stroke-width="1.6" stroke-dasharray="5 4"`);
    for (let i = 0; i < 4; i++) {
      const x = 130 + i * 44 + r() * 10, y = 14 + r() * 26, w = 12 + r() * 4;
      s += fillPath(`M${f1(x - w)} ${f1(y)} Q${f1(x)} ${f1(y - w)} ${f1(x + w)} ${f1(y)} Z`, i === 2 ? c[3] : c[2], op(i === 2 ? '1' : '.7'));
      s += line(x - w, y, x, y + 14, c[2], 0.8) + line(x + w, y, x, y + 14, c[2], 0.8) + rect(x - 2, y + 13, 4, 5, c[1]);
    }
    return s;
  },
  redeploy(c, r) {         // Rebound: a fall and a second drop, arrows looping back up.
    let s = path('M120 74 C130 20 190 10 210 40', c[2], 2, ' stroke-dasharray="4 3"') + poly([[206, 34], [214, 42], [204, 44]], c[2]);
    for (let i = 0; i < 3; i++) {
      const x = 230 + i * 24, y = 16 + i * 14, w = 11;
      s += fillPath(`M${x - w} ${y} Q${x} ${y - w} ${x + w} ${y} Z`, c[3], op((1 - i * 0.25).toFixed(2))) + line(x - w, y, x, y + 12, c[2], 0.8) + line(x + w, y, x, y + 12, c[2], 0.8);
    }
    return s + circ(120, 74, 4, c[3]) + `<ellipse cx="200" cy="76" rx="${f1(70 + r() * 10)}" ry="4" fill="${c[1]}" opacity=".6"/>`;
  },
  exfil(c) {               // Extraction: a helicopter over the zone, smoke rising from the flare.
    let s = '';
    for (let i = 0; i < 6; i++) s += circ(170 + i * 4, 70 - i * 9, 6 + i * 2, c[3], op((0.4 - i * 0.05).toFixed(2)));
    s += circ(170, 74, 3, c[3]);
    s += poly([[214, 30], [262, 30], [276, 38], [270, 46], [222, 46], [208, 40]], c[1]) + rect(262, 34, 30, 3, c[1]) + rect(290, 28, 3, 14, c[1]);
    s += line(196, 24, 290, 24, c[2], 2) + rect(236, 24, 4, 6, c[1]) + rect(224, 34, 10, 6, c[2], op('.5'));
    return s + line(226, 46, 226, 52, c[1], 2) + line(258, 46, 258, 52, c[1], 2) + line(218, 52, 266, 52, c[1], 2);
  },
  graves(c, r) {           // Graveyard Shift: stones and a bare tree under a big moon, mist on the ground.
    let s = circ(262, 22, 14, c[2], op('.85')) + circ(262, 22, 26, c[2], op('.1'));
    s += bareTree(116, H, 56, c[1], r);
    for (let i = 0; i < 7; i++) { const x = 140 + i * 22 + r() * 6, h = 16 + r() * 12; s += i % 3 === 1 ? rect(x + 5, H - 8 - h, 3, h, c[1]) + rect(x, H - 8 - h * 0.72, 13, 3, c[1]) : stone(x, H - 6, 12, h, c[1]); }
    for (let i = 0; i < 6; i++) s += `<ellipse cx="${f1(100 + r() * 200)}" cy="${f1(72 + r() * 6)}" rx="${f1(20 + r() * 20)}" ry="3" fill="${c[3]}" opacity=".18"/>`;
    return s;
  },
  rescue(c, r) {           // First escape: a helicopter lifting off into the moon, the horde's hands below.
    let s = circ(250, 24, 18, c[2], op('.25'));
    s += poly([[220, 18], [258, 18], [270, 25], [264, 32], [226, 32], [214, 27]], c[1]) + rect(258, 22, 26, 3, c[1]) + line(204, 13, 284, 13, c[2], 1.6);
    s += line(240, 32, 236, 52, c[2], 1, op('.6')) + rect(233, 52, 6, 3, c[3]);
    for (let i = 0; i < 9; i++) { const x = 104 + i * 22 + r() * 6, h = 8 + r() * 10; s += line(x, H, x + 2, H - h, c[1], 3, ' stroke-linecap="round"') + line(x + 2, H - h, x - 1, H - h - 4, c[1], 1.4) + line(x + 2, H - h, x + 5, H - h - 4, c[1], 1.4); }
    return s;
  },
  dawn(c) {                // Escape on a late round: dawn breaking over the graves.
    let s = '';
    for (let k = 0; k < 9; k++) { const a = Math.PI + (k + 0.5) * Math.PI / 9; s += poly([[236, 70], [236 + Math.cos(a) * 200, 70 + Math.sin(a) * 200], [236 + Math.cos(a + 0.12) * 200, 70 + Math.sin(a + 0.12) * 200]], c[3], op('.16')); }
    s += circ(236, 72, 18, c[3]) + circ(236, 72, 30, c[3], op('.25'));
    for (let i = 0; i < 8; i++) { const x = 104 + i * 26; s += stone(x, H, 12, 14 + (i % 3) * 4, c[0]); }
    return s + rect(90, 72, W - 90, 8, c[0]);
  },
};

// Tier marks: the frame colour and pips in the bottom-right corner (1 bronze, 2 silver, 3 gold).
export const TIER_FRAME = { 1: '#c8834e', 2: '#d4dde6', 3: '#ffd659' };
export function tierMarks(tier) {
  const col = TIER_FRAME[tier] ?? TIER_FRAME[1];
  let s = '';
  for (let i = 0; i < tier; i++) {
    const x = W - 22 - i * 11, y = H - 13;
    s += poly([[x, y + 6], [x + 4.5, y], [x + 9, y + 6], [x + 9, y + 9], [x + 4.5, y + 3], [x, y + 9]], col);
  }
  return s;
}
