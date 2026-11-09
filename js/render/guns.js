// Twenty-four invented, deliberately oversized guns built from code. Model space, in metres: +X muzzle,
// +Y up, +Z to the shooter's right, origin at the firing hand. The game camera sees guns mostly from
// above, so each silhouette is designed to be unmistakable from the top as well as the side.
// Each factory takes a normalized attachment kit, and swaps the base part the attachment replaces.
import { MeshBuilder } from './meshbuild.js';
import { PART } from './camo-shader.js';
import { kitKey, normalizeKit, NO_ATTACHMENTS } from '../shared/attachments.js';

const C = {
  body:  0x424852,
  bodyL: 0x565d68,
  grip:  0x24262c,
  metal: 0x6d7682,
  dark:  0x2f333a,
  white: 0xffffff,
};

function kit() {
  const b = new MeshBuilder();
  return {
    b,
    body()   { b.setPart(PART.BODY).setColor(C.body);    return b; },
    body2()  { b.setPart(PART.BODY).setColor(C.bodyL);   return b; },
    grip()   { b.setPart(PART.GRIP).setColor(C.grip);    return b; },
    metal()  { b.setPart(PART.METAL).setColor(C.metal);  return b; },
    dark()   { b.setPart(PART.METAL).setColor(C.dark);   return b; },
    accent() { b.setPart(PART.ACCENT).setColor(C.white); return b; },
  };
}

// Heavy forward-canted pistol grip, shared so every gun holds the same in hand.
function pistolGrip(k, x = -0.02, drop = 0.34, w = 0.13) {
  k.grip().extrude([[x - 0.07, 0.02], [x + 0.11, 0.02], [x + 0.04, -drop], [x - 0.15, -drop], [x - 0.13, -0.08]], -w / 2, w / 2);
}

// ---- Attachments. All in dark/metal/accent parts, so camos stay on the gun's own body. ----

// Bracket and sight on the rail. x,y = rail centre and rail top. s scales it for small guns.
function fitOptic(k, id, x, y, s = 1) {
  if (id === 'reflex') {
    // An open square: the frame is what reads at phone size.
    k.dark().box(x, y + 0.035 * s, 0, 0.3 * s, 0.07 * s, 0.19 * s);
    k.dark().box(x - 0.12 * s, y + 0.14 * s, 0, 0.05 * s, 0.15 * s, 0.19 * s);
    k.dark().box(x + 0.12 * s, y + 0.14 * s, 0, 0.05 * s, 0.15 * s, 0.19 * s);
    k.dark().box(x, y + 0.23 * s, 0, 0.3 * s, 0.04 * s, 0.19 * s);
    k.accent().box(x, y + 0.14 * s, 0, 0.025 * s, 0.11 * s, 0.13 * s);
  } else if (id === 'holo') {
    // The widest optic from above: a big hooded window.
    k.dark().box(x, y + 0.035 * s, 0, 0.26 * s, 0.07 * s, 0.32 * s);
    k.dark().box(x - 0.1 * s, y + 0.17 * s, 0, 0.05 * s, 0.2 * s, 0.32 * s);
    k.dark().box(x + 0.1 * s, y + 0.17 * s, 0, 0.05 * s, 0.2 * s, 0.32 * s);
    k.metal().box(x, y + 0.29 * s, 0, 0.3 * s, 0.05 * s, 0.38 * s);
    k.accent().box(x, y + 0.165 * s, 0, 0.025 * s, 0.16 * s, 0.25 * s);
  } else if (id === 'longeye') {
    // The longest: a fat tube with a flared objective, like the Lancet's scope in miniature.
    const cy = y + 0.19 * s;
    k.dark().prismX(x - 0.3 * s, x + 0.22 * s, cy, 0, 0.09 * s, 0.09 * s, 8, Math.PI / 8);
    k.dark().prismX(x + 0.2 * s, x + 0.42 * s, cy, 0, 0.09 * s, 0.15 * s, 8, Math.PI / 8);
    k.dark().prismX(x - 0.42 * s, x - 0.28 * s, cy, 0, 0.13 * s, 0.09 * s, 8, Math.PI / 8);
    k.accent().prismX(x + 0.42 * s, x + 0.435 * s, cy, 0, 0.12 * s, 0.12 * s, 8, Math.PI / 8);
    k.metal().box(x - 0.14 * s, y + 0.05 * s, 0, 0.09 * s, 0.1 * s, 0.1 * s);
    k.metal().box(x + 0.12 * s, y + 0.05 * s, 0, 0.09 * s, 0.1 * s, 0.1 * s);
  } else if (id === 'canted') {
    // A dot sight hung off the right side on a long arm: from above it is the only optic that sticks out sideways.
    k.dark().box(x, y + 0.035 * s, 0.1 * s, 0.14 * s, 0.07 * s, 0.34 * s);
    k.dark().box(x, y + 0.12 * s, 0.26 * s, 0.2 * s, 0.14 * s, 0.12 * s);
    k.accent().box(x + 0.1 * s, y + 0.12 * s, 0.26 * s, 0.02 * s, 0.08 * s, 0.08 * s);
  } else if (id === 'pointdot') {
    // A slim laser box with a bright lens bar, low on the rail.
    k.dark().box(x, y + 0.06 * s, 0, 0.36 * s, 0.11 * s, 0.13 * s, 0.02);
    k.accent().box(x + 0.185 * s, y + 0.06 * s, 0, 0.02 * s, 0.07 * s, 0.1 * s);
    k.metal().box(x - 0.08 * s, y + 0.13 * s, 0, 0.1 * s, 0.03 * s, 0.13 * s);
  } else if (id === 'hunter') {
    // Bigger than the stock scope it replaces: a huge objective bell and turrets out both sides.
    const cy = y + 0.2 * s;
    k.dark().prismX(x - 0.36 * s, x + 0.3 * s, cy, 0, 0.1 * s, 0.1 * s, 8, Math.PI / 8);
    k.dark().prismX(x + 0.28 * s, x + 0.58 * s, cy, 0, 0.1 * s, 0.2 * s, 8, Math.PI / 8);
    k.dark().prismX(x - 0.5 * s, x - 0.34 * s, cy, 0, 0.15 * s, 0.1 * s, 8, Math.PI / 8);
    k.accent().prismX(x + 0.58 * s, x + 0.595 * s, cy, 0, 0.18 * s, 0.18 * s, 8, Math.PI / 8);
    k.metal().box(x, cy, 0, 0.1 * s, 0.1 * s, 0.34 * s);
    k.metal().box(x, cy + 0.12 * s, 0, 0.1 * s, 0.08 * s, 0.1 * s);
    k.metal().box(x - 0.18 * s, y + 0.05 * s, 0, 0.09 * s, 0.1 * s, 0.1 * s);
    k.metal().box(x + 0.18 * s, y + 0.05 * s, 0, 0.09 * s, 0.1 * s, 0.1 * s);
  } else if (id === 'reticle') {
    // A short square-bodied scope with a bright range ring: chunkier than Longeye, much shorter.
    k.dark().box(x, y + 0.17 * s, 0, 0.44 * s, 0.17 * s, 0.17 * s, 0.03);
    k.dark().box(x + 0.25 * s, y + 0.17 * s, 0, 0.08 * s, 0.23 * s, 0.23 * s);
    k.accent().box(x - 0.06 * s, y + 0.17 * s, 0, 0.04 * s, 0.19 * s, 0.19 * s);
    k.metal().box(x, y + 0.05 * s, 0, 0.26 * s, 0.08 * s, 0.1 * s);
  } else if (id === 'snapsight') {
    // Deliberately tiny next to the scope it replaces: the silhouette says "quick, not far".
    k.dark().box(x, y + 0.04 * s, 0, 0.34 * s, 0.08 * s, 0.14 * s, 0.02);
    k.dark().box(x + 0.1 * s, y + 0.16 * s, 0, 0.09 * s, 0.17 * s, 0.14 * s);
    k.accent().box(x + 0.1 * s, y + 0.175 * s, 0, 0.1 * s, 0.09 * s, 0.09 * s);
  }
}

// Fits a barrel attachment from x outward. Returns the new muzzle x, or null when the gun's own muzzle device stays.
function fitBarrel(k, id, x, y, z, r, len = 0.5) {
  const b = k.b;
  if (id === 'suppressor') {
    // A fat can reads as "suppressed" from any angle.
    k.dark().prismX(x, x + len, y, z, r * 1.05, r * 1.05, 8, Math.PI / 8);
    k.metal().prismX(x - 0.03, x + 0.05, y, z, r * 1.25, r * 1.25, 8, Math.PI / 8);
    k.accent().prismX(x + len * 0.72, x + len * 0.78, y, z, r * 1.12, r * 1.12, 8, Math.PI / 8);
    k.dark().prismX(x + len, x + len + 0.03, y, z, r * 1.05, r * 0.5, 8, Math.PI / 8);
    return x + len + 0.04;
  }
  if (id === 'longbarrel') {
    // A thin extra length and a small crown, so the gun gets visibly longer.
    k.metal().prismX(x, x + len, y, z, r * 0.62, r * 0.55, 6);
    b.box(x + len, y, z, 0.1, r * 1.5, r * 1.5, 0.02);
    return x + len + 0.06;
  }
  if (id === 'heavybarrel') {
    // A fat stepped bull barrel with a heavy crown: the gun gets longer and thicker.
    k.dark().prismX(x, x + len * 0.7, y, z, r * 0.95, r * 0.95, 8, Math.PI / 8);
    k.metal().prismX(x + len * 0.7, x + len, y, z, r * 0.8, r * 0.8, 8, Math.PI / 8);
    k.dark().prismX(x + len, x + len + 0.05, y, z, r * 1.05, r * 1.05, 8, Math.PI / 8);
    return x + len + 0.06;
  }
  if (id === 'stub') {
    // Barely anything: a short cone flash hider. The gun reads stubbier than its bare self.
    k.dark().prismX(x - 0.02, x + 0.1, y, z, r * 0.75, r * 1.05, 6);
    return x + 0.1;
  }
  if (id === 'ported') {
    // A blocky slide extension with three bright ports along the top.
    k.metal().box(x + 0.1, y, z, 0.2, r * 2.2, r * 2.2, 0.02);
    k.accent(); for (let i = 0; i < 3; i++) b.box(x + 0.04 + i * 0.06, y + r * 1.1, z, 0.025, 0.02, r * 1.4);
    return x + 0.2;
  }
  if (id === 'shroud') {
    // A ribbed cooling sleeve past the muzzle, wider than the shroud behind it.
    k.metal().prismX(x, x + len, y, z, r * 1.4, r * 1.3, 6, Math.PI / 6);
    k.dark(); for (let i = 0; i < 4; i++) b.prismX(x + 0.04 + i * len / 4, x + 0.08 + i * len / 4, y, z, r * 1.65, r * 1.65, 6, Math.PI / 6);
    k.accent().prismX(x + len - 0.03, x + len, y, z, r * 1.45, r * 1.45, 6, Math.PI / 6);
    return x + len + 0.02;
  }
  if (id === 'compensator') {
    // Blocky with side ports: wider than the barrel from above.
    k.metal().box(x + 0.09, y, z, 0.22, r * 2.1, r * 2.9, 0.02);
    k.dark().box(x + 0.05, y, z, 0.045, r * 2.25, r * 3.05);
    k.dark().box(x + 0.13, y, z, 0.045, r * 2.25, r * 3.05);
    return x + 0.21;
  }
  return null;
}

// Stubby angled grip, plain vertical post, or a wide swing brace sticking out to the side.
function fitForegrip(k, id, x, y) {
  if (id === 'angled') {
    k.grip().extrude([[x - 0.16, y], [x + 0.16, y], [x + 0.03, y - 0.22], [x - 0.09, y - 0.22]], -0.07, 0.07);
  } else if (id === 'vertical') {
    k.grip().box(x, y - 0.16, 0, 0.13, 0.32, 0.12, 0.03);
  } else if (id === 'brace') {
    // Reads from directly above, which a grip hanging under the gun cannot.
    k.metal().box(x, y - 0.03, -0.18, 0.08, 0.08, 0.28);
    k.grip().box(x, y - 0.03, -0.36, 0.16, 0.13, 0.15, 0.03);
  }
}

// Grip tape bands around the rear grip; the knurled frame is three dark rings instead.
function fitWrap(k, x, drop, w, id = 'wrap') {
  if (id === 'knurl') {
    for (const f of [0.25, 0.5, 0.75]) k.dark().box(x - 0.015 * f, -drop * f, 0, 0.18, 0.03, w + 0.03);
    return;
  }
  for (const f of [0.3, 0.62]) k.accent().box(x - 0.015 * f, -drop * f, 0, 0.19, 0.035, w + 0.03);
}
const isWrap = id => id === 'wrap' || id === 'knurl';

// Stock attachments, from the butt (x) forward. Skeleton: an open frame of rods. Recoil stock: a fat padded block.
function fitStock(k, id, x, y) {
  if (id === 'skelstock') {
    k.metal().box(x + 0.25, y + 0.1, 0, 0.5, 0.04, 0.05);
    k.metal().box(x + 0.25, y - 0.1, 0, 0.5, 0.04, 0.05);
    k.dark().box(x + 0.02, y, 0, 0.06, 0.32, 0.18);
    k.accent().box(x - 0.015, y, 0, 0.02, 0.2, 0.12);
  } else if (id === 'heavystock') {
    k.dark().box(x + 0.16, y, 0, 0.42, 0.3, 0.3, 0.04);
    k.grip().box(x - 0.06, y, 0, 0.1, 0.36, 0.34, 0.03);
    k.accent().box(x + 0.2, y + 0.155, 0, 0.18, 0.02, 0.2);
  }
}

// A saddle drum under the magazine well. Reads from above as a disc either side of the gun.
function fitDrum(k, x, y, r = 0.24) {
  k.dark().prismZ(-r * 0.9, r * 0.9, x, y - r * 0.6, r, r, 8, Math.PI / 8);
  k.accent().prismZ(-r * 0.92, -r * 0.9, x, y - r * 0.6, r * 0.45, r * 0.45, 8, Math.PI / 8);
  k.accent().prismZ(r * 0.9, r * 0.92, x, y - r * 0.6, r * 0.45, r * 0.45, 8, Math.PI / 8);
}

const MAG_LOOK = {
  extmag:   { len: 1.45, part: 'dark' },
  speedmag: { len: 0.85, part: 'dark', tab: true },
  lightmag: { len: 0.82, part: 'body2' },
  drummag:  { len: 0.45, part: 'dark', drum: true },
  apmag:    { len: 1, part: 'metal', tab: true },
};
const MAG_BASE = { len: 1, part: 'dark' };
const magLook = id => MAG_LOOK[id] || MAG_BASE;

// Assault rifle: long flat-top receiver, flared wedge handguard, tall sight fin, square brake.
function ar(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag);
  k.body().extrude([[-0.32, -0.02], [0.42, -0.02], [0.52, 0.04], [0.52, 0.2], [0.34, 0.28], [-0.22, 0.28], [-0.32, 0.18]], -0.15, 0.15);
  // Handguard flares wider toward the receiver, reading as a wedge from above.
  b.loft([
    [[0.5, -0.02, -0.2], [0.5, 0.24, -0.2], [0.5, 0.24, 0.2], [0.5, -0.02, 0.2]],
    [[1.04, 0.02, -0.1], [1.04, 0.19, -0.1], [1.04, 0.19, 0.1], [1.04, 0.02, 0.1]],
  ]);
  k.accent(); for (let i = 0; i < 3; i++) b.box(0.62 + i * 0.13, 0.235, 0, 0.07, 0.03, 0.24);
  k.metal().prismX(1.02, 1.2, 0.11, 0, 0.06, 0.055, 6);
  const mx = fitBarrel(k, a.barrel, 1.2, 0.11, 0, 0.1, 0.54);
  if (mx === null) {
    b.box(1.28, 0.11, 0, 0.2, 0.2, 0.28, 0.03);
    k.dark().box(1.28, 0.11, 0, 0.07, 0.22, 0.32);
  }
  k.body().extrude([[-0.32, 0.22], [-0.32, -0.02], [-0.58, -0.13], [-0.94, -0.13], [-0.94, 0.17], [-0.58, 0.24]], -0.11, 0.11);
  k.grip().box(-0.97, 0.02, 0, 0.08, 0.34, 0.25, 0.02);
  if (a.optic) fitOptic(k, a.optic, 0.2, 0.28);
  else {
    k.body2().extrude([[0.14, 0.28], [0.32, 0.28], [0.28, 0.5], [0.2, 0.5]], -0.05, 0.05);  // Sight fin.
    k.accent().box(0.24, 0.5, 0, 0.11, 0.03, 0.13);
  }
  const f = m.len;
  k[m.part]().extrude([[0.03, 0], [0.26, 0], [0.26 + 0.07 * f, -0.44 * f], [0.03 + 0.07 * f, -0.5 * f]], -0.095, 0.095);  // Forward-swept mag.
  if (m.tab) k.accent().box(0.03 + 0.14 * f, -0.5 * f, 0, 0.18, 0.05, 0.13);
  k.metal().box(-0.16, 0.21, -0.17, 0.18, 0.06, 0.07);                                      // Charging handle, sticks out left.
  if (m.drum) fitDrum(k, 0.18, -0.2);
  pistolGrip(k, -0.03, 0.34);
  if (a.grip === 'wrap') fitWrap(k, -0.03, 0.34, 0.13);
  else fitForegrip(k, a.grip, 0.74, 0.0);
  fitStock(k, a.grip, -0.98, 0.02);
  const fore = a.grip === 'angled' || a.grip === 'vertical' ? [0.74, -0.14, 0] : [0.74, 0.02, 0];
  return { geometry: b.build(), muzzle: [mx === null ? 1.36 : mx, 0.1, 0], fore, eject: [0.12, 0.22, 0.12], length: 2.3 };
}

// SMG: stubby brick with a long magazine jutting out the left side, a T shape from above.
function smg(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag);
  k.body().box(0.14, 0.12, 0, 0.72, 0.28, 0.24, 0.05);
  k.body2().loft([
    [[0.48, 0.0, -0.11], [0.48, 0.25, -0.11], [0.48, 0.25, 0.11], [0.48, 0.0, 0.11]],
    [[0.72, 0.05, -0.07], [0.72, 0.21, -0.07], [0.72, 0.21, 0.07], [0.72, 0.05, 0.07]],
  ]);
  k.metal().prismX(0.7, 0.92, 0.13, 0, 0.06, 0.06, 8);
  const mx = fitBarrel(k, a.barrel, 0.92, 0.13, 0, 0.08, 0.44);
  if (mx === null) k.metal().prismX(0.92, 1.02, 0.13, 0, 0.09, 0.075, 8);
  const magLen = 0.56 * m.len;
  k[m.part]().box(0.12, 0.13, -0.1 - magLen / 2, 0.17, 0.11, magLen, 0.02);   // Side magazine.
  k.accent().box(0.12, 0.2, -0.1 - magLen + 0.16, 0.18, 0.025, 0.14);
  if (m.tab) k.accent().box(0.12, 0.13, -0.1 - magLen, 0.2, 0.15, 0.05);
  k.accent().box(0.38, 0.27, 0, 0.26, 0.03, 0.06);                        // Top strip.
  if (a.grip === 'angled' || a.grip === 'vertical') fitForegrip(k, a.grip, 0.56, 0.02);
  else k.grip().box(0.56, -0.16, 0, 0.12, 0.34, 0.11, 0.03);              // Its own vertical foregrip.
  k.body().extrude([[-0.2, 0.24], [-0.2, 0.0], [-0.46, -0.08], [-0.62, -0.08], [-0.62, 0.12], [-0.46, 0.24]], -0.11, 0.11);
  k.grip().box(-0.65, 0.04, 0, 0.06, 0.28, 0.24, 0.015);
  k.dark().box(0.0, 0.3, 0, 0.3, 0.05, 0.13, 0.015);
  if (a.optic) fitOptic(k, a.optic, 0.04, 0.325, 0.9);
  if (m.drum) fitDrum(k, 0.2, -0.02, 0.22);
  pistolGrip(k, -0.04, 0.3);
  if (isWrap(a.grip)) fitWrap(k, -0.04, 0.3, 0.13, a.grip);
  fitStock(k, a.grip, -0.66, 0.04);
  return { geometry: b.build(), muzzle: [mx === null ? 1.04 : mx, 0.13, 0], fore: [0.56, -0.16, 0], eject: [0.05, 0.28, 0.14], length: 1.65 };
}

// Shotgun: two huge barrels side by side, a fat ribbed pump and a shell rack glowing on the stock.
function shotgun(a) {
  const k = kit(), b = k.b;
  const sawn = a.barrel === 'sawnoff';
  const end = sawn ? 0.98 : 1.26;                                           // Where the tubes stop.
  k.body().box(0.08, 0.1, 0, 0.56, 0.32, 0.46, 0.05);
  k.body().box(0.25 + (end - 0.52) / 2, 0.21, 0, end - 0.52, 0.1, 0.2, 0.02);   // Rib between the barrels carries camo.
  k.metal().prismX(0.34, end, 0.13, -0.12, 0.11, 0.1, 8, Math.PI / 8);
  k.metal().prismX(0.34, end, 0.13, 0.12, 0.11, 0.1, 8, Math.PI / 8);
  let mx = 1.36;
  if (a.barrel === 'suppressor') {
    // One broad can over both tubes.
    k.dark().box(end + 0.28, 0.13, 0, 0.56, 0.3, 0.56, 0.05);
    k.metal().box(end + 0.02, 0.13, 0, 0.08, 0.34, 0.62);
    k.accent().box(end + 0.44, 0.13, 0, 0.05, 0.32, 0.58);
    mx = end + 0.58;
  } else if (a.barrel === 'rifled') {
    // Longer tubes with a bright band: a slug barrel.
    for (const z of [-0.12, 0.12]) k.metal().prismX(end, end + 0.3, 0.13, z, 0.08, 0.08, 8, Math.PI / 8);
    k.accent().box(end + 0.22, 0.13, 0, 0.04, 0.2, 0.44);
    mx = end + 0.31;
  } else if (a.barrel === 'choke') {
    // Tubes neck down, so the muzzle end looks pinched.
    for (const z of [-0.12, 0.12]) k.dark().prismX(end, end + 0.16, 0.13, z, 0.1, 0.06, 8, Math.PI / 8);
    mx = end + 0.17;
  } else {
    k.dark().box(end + 0.04, 0.13, 0, 0.12, 0.26, 0.54, 0.03);              // Heavy muzzle collar.
    mx = end + 0.1;
  }
  k.body2().box(0.72, 0.0, 0, 0.46, 0.22, 0.52, 0.04);                     // Pump.
  k.dark(); for (let i = 0; i < 4; i++) b.box(0.57 + i * 0.1, -0.115, 0, 0.05, 0.03, 0.56);
  k.body().extrude([[-0.2, 0.22], [-0.2, -0.02], [-0.5, -0.18], [-0.96, -0.22], [-0.96, 0.1], [-0.5, 0.2]], -0.14, 0.14);
  k.grip().box(-0.99, -0.06, 0, 0.08, 0.36, 0.3, 0.02);
  k.accent(); for (let i = 0; i < 4; i++) b.prismZ(0.1, 0.15, -0.44 - i * 0.1, 0.09, 0.04, 0.04, 6);   // Spare shells.
  if (a.mag === 'extmag') {
    // A tube running forward under the barrels.
    k.dark().prismX(0.34, end - 0.06, -0.03, 0, 0.1, 0.1, 6, Math.PI / 6);
    k.accent(); for (let i = 0; i < 4; i++) b.prismZ(0.1, 0.15, -0.44 - i * 0.1, -0.08, 0.04, 0.04, 6);   // Second rack.
  } else if (a.mag === 'speedmag') {
    k.dark().box(0.14, 0.02, 0.27, 0.32, 0.16, 0.08, 0.02);                  // Side-saddle clip.
    k.accent(); for (let i = 0; i < 3; i++) b.prismZ(0.3, 0.34, 0.04 + i * 0.1, 0.02, 0.04, 0.04, 6);
  } else if (a.mag === 'lightmag') {
    k.body2().box(-0.5, 0.17, 0, 0.3, 0.06, 0.34);                           // Skeleton cheek rest.
  }
  if (a.optic) fitOptic(k, a.optic, 0.14, 0.26);
  else k.accent().box(0.14, 0.26, 0, 0.12, 0.04, 0.1);
  pistolGrip(k, -0.03, 0.32);
  if (a.grip === 'wrap') fitWrap(k, -0.03, 0.32, 0.13);
  else fitForegrip(k, a.grip, 0.72, -0.11);
  const fore = a.grip === 'angled' || a.grip === 'vertical' ? [0.72, -0.25, 0] : [0.72, -0.05, 0];
  return { geometry: b.build(), muzzle: [mx, 0.13, 0], fore, eject: [0.12, 0.26, 0.17], length: mx + 0.99 };
}

// LMG: fat perforated shroud, huge drum on the left, bipod folded under the muzzle.
function lmg(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().extrude([[-0.34, 0], [0.5, 0], [0.56, 0.06], [0.56, 0.24], [0.4, 0.3], [-0.24, 0.3], [-0.34, 0.2]], -0.13, 0.13);
  k.body2().prismX(0.54, 1.26, 0.13, 0, 0.14, 0.12, 6, Math.PI / 6);      // Hex shroud.
  k.dark(); for (let i = 0; i < 5; i++) b.box(0.66 + i * 0.13, 0.25, 0, 0.055, 0.03, 0.1);  // Cooling slots.
  k.metal().prismX(1.26, 1.48, 0.13, 0, 0.055, 0.05, 6);
  const mx = fitBarrel(k, a.barrel, 1.48, 0.13, 0, 0.09, 0.5);
  if (mx === null) k.metal().prismX(1.48, 1.62, 0.13, 0, 0.1, 0.085, 6, Math.PI / 6);
  if (a.barrel === 'heatsink') {
    // Stacked radiator fins around the shroud, unmistakably fatter from above, with a coolant line.
    k.dark(); for (let i = 0; i < 7; i++) b.box(0.62 + i * 0.1, 0.13, 0, 0.055, 0.36, 0.38);
    k.accent().box(0.92, 0.32, 0, 0.66, 0.03, 0.05);
  }
  // Drum: reads as a big disc from above and carries the gun's silhouette.
  const dr = 0.3 * f, dz = -0.3 * Math.max(1, f);
  k[m.part]().prismY(-0.14, 0.15, 0.14, dz, dr, dr, 8, Math.PI / 8);
  k.accent().prismY(0.15, 0.175, 0.14, dz, 0.14 * f, 0.14 * f, 8, Math.PI / 8);
  k.metal().box(0.14, 0.17, dz, 0.42 * f, 0.03, 0.06);
  k.metal().box(0.14, 0.17, dz, 0.06, 0.03, 0.42 * f);
  if (m.tab) k.accent().box(0.14, -0.17, dz, 0.2, 0.05, 0.08);
  k.body().extrude([[-0.34, 0.24], [-0.34, 0.0], [-0.62, -0.1], [-0.98, -0.12], [-0.98, 0.16], [-0.62, 0.24]], -0.13, 0.13);
  k.grip().box(-1.01, 0.03, 0, 0.08, 0.34, 0.3, 0.02);
  if (a.optic) fitOptic(k, a.optic, 0.24, 0.3);
  else {
    k.dark().extrude([[0.04, 0.3], [0.5, 0.3], [0.48, 0.38], [0.12, 0.42]], -0.05, 0.05);  // Carry handle.
    k.accent().box(0.28, 0.41, 0, 0.14, 0.03, 0.07);
  }
  k.metal(); b.box(1.18, -0.07, -0.08, 0.05, 0.26, 0.04); b.box(1.18, -0.07, 0.08, 0.05, 0.26, 0.04);   // Bipod.
  b.box(1.18, -0.21, 0, 0.09, 0.03, 0.26);
  pistolGrip(k, -0.05, 0.34, 0.15);
  if (a.grip === 'wrap') fitWrap(k, -0.05, 0.34, 0.15);
  else fitForegrip(k, a.grip, 0.82, -0.0);
  fitStock(k, a.grip, -1.02, 0.03);
  const fore = a.grip === 'angled' || a.grip === 'vertical' ? [0.82, -0.14, 0] : [0.82, -0.01, 0];
  return { geometry: b.build(), muzzle: [mx === null ? 1.64 : mx, 0.13, 0], fore, eject: [0.2, 0.28, 0.14], length: 2.6 };
}

// Sniper: extremely long and thin, massive top scope, T-shaped muzzle brake, skeleton stock.
function sniper(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag);
  k.body().extrude([[-0.28, 0.02], [0.52, 0.02], [0.62, 0.08], [0.62, 0.17], [0.46, 0.23], [-0.2, 0.23], [-0.28, 0.15]], -0.12, 0.12);
  k.body2().prismX(0.62, 1.14, 0.12, 0, 0.13, 0.08, 6, Math.PI / 6);
  // Fluted is a lighter, shorter barrel: visibly less gun out front.
  const barrelEnd = a.barrel === 'fluted' ? 1.62 : 1.96;
  k.metal().prismX(1.14, barrelEnd, 0.12, 0, 0.05, 0.045, 6);
  let mx = fitBarrel(k, a.barrel, 1.96, 0.12, 0, 0.09, 0.6);
  if (a.barrel === 'fluted') {
    k.dark(); for (let i = 0; i < 4; i++) b.box(1.22 + i * 0.11, 0.12, 0, 0.05, 0.14, 0.14);
    mx = 1.64;
  } else if (mx === null) {
    k.dark().box(2.05, 0.12, 0, 0.16, 0.09, 0.42, 0.02);                   // T brake.
    k.metal().box(2.05, 0.12, -0.21, 0.08, 0.13, 0.05);
    k.metal().box(2.05, 0.12, 0.21, 0.08, 0.13, 0.05);
    mx = 2.14;
  }
  // Skeleton stock: an open rear frame rather than a solid wedge.
  k.body().extrude([
    [-0.28, 0.19], [-0.28, 0.04], [-0.56, -0.08], [-1.0, -0.12], [-1.0, 0.16], [-0.56, 0.19],
    [-0.56, 0.11], [-0.9, 0.08], [-0.9, -0.03], [-0.56, 0.0],
  ], -0.085, 0.085);
  k.grip().box(-1.03, 0.02, 0, 0.07, 0.32, 0.2, 0.02);
  if (a.optic) fitOptic(k, a.optic, 0.28, 0.23);
  else {
    // Scope: longer and fatter than feels reasonable, front lens glows.
    k.dark().prismX(-0.12, 0.72, 0.36, 0, 0.1, 0.1, 8, Math.PI / 8);
    k.dark().prismX(0.5, 0.74, 0.36, 0, 0.1, 0.16, 8, Math.PI / 8);
    k.dark().prismX(-0.26, -0.1, 0.36, 0, 0.14, 0.1, 8, Math.PI / 8);
    k.accent().prismX(0.74, 0.755, 0.36, 0, 0.13, 0.13, 8, Math.PI / 8);
    k.metal().box(0.14, 0.26, 0, 0.1, 0.1, 0.1);
    k.metal().box(0.42, 0.26, 0, 0.1, 0.1, 0.1);
  }
  k.accent().box(0.3, 0.05, 0.095, 0.25, 0.04, 0.02);
  k.metal().box(0.08, 0.17, 0.12, 0.1, 0.04, 0.1);                          // Bolt handle.
  const f = m.len;
  k[m.part]().extrude([[0.08, 0.02], [0.3, 0.02], [0.3, -0.3 * f], [0.14, -0.3 * f]], -0.06, 0.06);
  if (m.tab) k.accent().box(0.22, -0.3 * f, 0, 0.18, 0.05, 0.1);
  pistolGrip(k, -0.02, 0.3, 0.11);
  if (a.grip === 'wrap') fitWrap(k, -0.02, 0.3, 0.11);
  else fitForegrip(k, a.grip, 0.8, 0.06);
  fitStock(k, a.grip, -1.04, 0.02);
  const fore = a.grip === 'angled' || a.grip === 'vertical' ? [0.8, -0.1, 0] : [0.8, 0.03, 0];
  return { geometry: b.build(), muzzle: [mx, 0.12, 0], fore, eject: [0.06, 0.24, 0.1], length: mx + 1.11 };
}

// Pistol: a hand cannon. Comically thick slide, stepped compensator, oversized grip.
function pistol(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag);
  k.body().extrude([[-0.2, 0.06], [0.52, 0.06], [0.56, 0.1], [0.56, 0.24], [0.4, 0.28], [-0.16, 0.28], [-0.2, 0.22]], -0.1, 0.1);
  k.dark().box(0.17, 0.02, 0, 0.74, 0.1, 0.16, 0.02);                      // Frame.
  k.metal().prismX(0.56, 0.66, 0.16, 0, 0.1, 0.1, 6);
  const mx = fitBarrel(k, a.barrel, 0.66, 0.16, 0, 0.09, 0.34);
  if (mx === null) {
    k.metal().box(0.72, 0.16, 0, 0.14, 0.24, 0.24, 0.03);
    k.dark().box(0.72, 0.16, 0, 0.05, 0.26, 0.28);
  }
  if (a.optic) fitOptic(k, a.optic, 0.12, 0.28, 0.72);
  else k.accent().box(0.12, 0.29, 0, 0.32, 0.025, 0.08);
  k.dark(); for (let i = 0; i < 3; i++) b.box(-0.12 + i * 0.07, 0.2, 0, 0.03, 0.09, 0.22);  // Serrations.
  const drop = 0.4 * Math.max(1, m.len * 0.85);
  pistolGrip(k, -0.02, drop, 0.16);
  // The magazine lives in the grip, so a deep mag makes the grip longer and the base plate carries the look.
  k[m.part]().box(-0.04, -drop - 0.02, 0, 0.26, 0.05, 0.19);
  if (m.tab) k.accent().box(-0.04, -drop - 0.05, 0, 0.16, 0.04, 0.1);
  if (isWrap(a.grip)) fitWrap(k, -0.02, 0.4, 0.16, a.grip);
  return { geometry: b.build(), muzzle: [mx === null ? 0.82 : mx, 0.16, 0], fore: [-0.1, -0.2, -0.05], eject: [0.1, 0.3, 0.1], length: 1.1 };
}

// Burst rifle: a flat-top with three stacked vents at the muzzle, a fat square handguard and a short stock.
// From above the three-pronged brake is the tell: nothing else ends in a fork.
function burst(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().extrude([[-0.3, -0.02], [0.5, -0.02], [0.56, 0.03], [0.56, 0.21], [0.42, 0.27], [-0.2, 0.27], [-0.3, 0.17]], -0.14, 0.14);
  k.body2().box(0.86, 0.1, 0, 0.62, 0.24, 0.27, 0.03);                       // Square handguard.
  k.dark(); for (let i = 0; i < 3; i++) b.box(0.68 + i * 0.18, 0.225, 0, 0.11, 0.03, 0.2);
  k.metal().prismX(1.15, 1.32, 0.1, 0, 0.055, 0.05, 6);
  const mx = fitBarrel(k, a.barrel, 1.32, 0.1, 0, 0.09, 0.5);
  if (mx === null) {
    // Three prongs, the middle one longest.
    k.metal().box(1.4, 0.1, 0, 0.3, 0.12, 0.09);
    k.metal().box(1.34, 0.1, -0.15, 0.2, 0.12, 0.09);
    k.metal().box(1.34, 0.1, 0.15, 0.2, 0.12, 0.09);
    k.dark().box(1.25, 0.1, 0, 0.05, 0.14, 0.42);
  }
  k.accent(); for (let i = 0; i < 3; i++) b.box(-0.08 + i * 0.1, 0.275, 0, 0.05, 0.02, 0.2);   // Three-pip marking, top of the receiver.
  k.body().extrude([[-0.3, 0.2], [-0.3, -0.02], [-0.72, -0.12], [-0.72, 0.2]], -0.1, 0.1);     // Short stock.
  k.grip().box(-0.75, 0.05, 0, 0.07, 0.34, 0.24, 0.02);
  if (a.optic) fitOptic(k, a.optic, 0.14, 0.27);
  else {
    k.dark().box(0.1, 0.31, 0, 0.26, 0.08, 0.16);                            // Low carry rail.
    k.accent().box(0.2, 0.36, 0, 0.1, 0.03, 0.1);
  }
  k[m.part]().extrude([[0.08, 0], [0.3, 0], [0.3 + 0.05 * f, -0.42 * f], [0.08 + 0.05 * f, -0.46 * f]], -0.09, 0.09);
  if (m.tab) k.accent().box(0.14 + 0.05 * f, -0.46 * f, 0, 0.18, 0.05, 0.13);
  if (m.drum) fitDrum(k, 0.2, -0.18);
  pistolGrip(k, -0.03, 0.34);
  if (a.grip === 'wrap') fitWrap(k, -0.03, 0.34, 0.13);
  else fitForegrip(k, a.grip, 0.84, -0.02);
  fitStock(k, a.grip, -0.76, 0.05);
  const fore = a.grip === 'angled' || a.grip === 'vertical' ? [0.84, -0.16, 0] : [0.84, 0, 0];
  return { geometry: b.build(), muzzle: [mx === null ? 1.56 : mx, 0.1, 0], fore, eject: [0.16, 0.23, 0.12], length: 2.05 };
}

// PDW: a stubby brick with its magazine lying flat along the top and a very short barrel: a wedge from above.
function pdw(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().extrude([[-0.24, 0], [0.42, 0], [0.5, 0.05], [0.5, 0.2], [0.34, 0.26], [-0.16, 0.26], [-0.24, 0.18]], -0.15, 0.15);
  // The top magazine is the silhouette: a long flat slab that overhangs the receiver at both ends.
  const magL = 0.62 * f;
  k[m.part]().box(0.14, 0.33, 0, magL, 0.14, 0.26, 0.03);
  k.accent().box(0.14 + magL / 2 - 0.05, 0.405, 0, 0.1, 0.02, 0.2);
  if (m.tab) k.accent().box(0.14 - magL / 2, 0.36, 0, 0.05, 0.12, 0.2);
  k.body2().loft([
    [[0.5, 0.02, -0.14], [0.5, 0.22, -0.14], [0.5, 0.22, 0.14], [0.5, 0.02, 0.14]],
    [[0.74, 0.07, -0.08], [0.74, 0.17, -0.08], [0.74, 0.17, 0.08], [0.74, 0.07, 0.08]],
  ]);
  k.metal().prismX(0.72, 0.86, 0.12, 0, 0.05, 0.05, 6);
  const mx = fitBarrel(k, a.barrel, 0.86, 0.12, 0, 0.08, 0.4);
  if (mx === null) k.dark().prismX(0.86, 0.96, 0.12, 0, 0.09, 0.07, 6);
  // No stock to speak of, just a pad bolted to the back of the grip frame.
  k.grip().box(-0.34, 0.1, 0, 0.14, 0.32, 0.28, 0.03);
  k.body2().box(-0.26, 0.1, 0, 0.1, 0.12, 0.34);
  if (a.optic) fitOptic(k, a.optic, 0.14, 0.4, 0.8);
  else k.accent().box(0.14, 0.42, 0, 0.06, 0.05, 0.05);
  if (a.grip === 'angled' || a.grip === 'vertical') fitForegrip(k, a.grip, 0.42, 0.0);
  if (m.drum) fitDrum(k, 0.14, 0.02, 0.2);
  pistolGrip(k, -0.04, 0.32, 0.14);
  if (isWrap(a.grip)) fitWrap(k, -0.04, 0.32, 0.14, a.grip);
  fitStock(k, a.grip, -0.42, 0.1);
  return { geometry: b.build(), muzzle: [mx === null ? 0.98 : mx, 0.12, 0], fore: [0.3, -0.05, 0], eject: [0.05, 0.1, 0.17], length: 1.35 };
}

// Auto shotgun: the biggest drum in the game hung right under the gun, on a single wide barrel with a flared end.
function autoshot(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  const sawn = a.barrel === 'sawnoff';
  const end = sawn ? 0.96 : 1.2;
  k.body().box(0.12, 0.13, 0, 0.72, 0.32, 0.36, 0.05);
  k.body2().box(0.28 + (end - 0.3) / 2, 0.15, 0, end - 0.3, 0.26, 0.32, 0.05);  // Heavy sleeve carries camo.
  k.dark(); for (let i = 0; i < 4; i++) b.box(0.46 + i * ((end - 0.5) / 4), 0.29, 0, 0.09, 0.03, 0.26);
  k.metal().prismX(end, end + 0.08, 0.15, 0, 0.13, 0.13, 8, Math.PI / 8);
  let mx = end + 0.09;
  if (a.barrel === 'suppressor') {
    k.dark().prismX(end + 0.02, end + 0.56, 0.15, 0, 0.2, 0.2, 8, Math.PI / 8);
    k.accent().prismX(end + 0.4, end + 0.45, 0.15, 0, 0.21, 0.21, 8, Math.PI / 8);
    mx = end + 0.58;
  } else if (a.barrel === 'choke') {
    k.dark().prismX(end + 0.02, end + 0.18, 0.15, 0, 0.13, 0.07, 8, Math.PI / 8);
    mx = end + 0.19;
  } else if (a.barrel === 'rifled') {
    k.metal().prismX(end + 0.02, end + 0.34, 0.15, 0, 0.1, 0.1, 8, Math.PI / 8);
    k.accent().prismX(end + 0.24, end + 0.28, 0.15, 0, 0.11, 0.11, 8, Math.PI / 8);
    mx = end + 0.35;
  } else {
    k.dark().prismX(end + 0.02, end + 0.17, 0.15, 0, 0.1, 0.19, 8, Math.PI / 8);   // Flared mouth.
    mx = end + 0.18;
  }
  // Drum: a thick puck below the receiver. A deep mag makes it a bigger puck; it is the gun.
  const dr = 0.33 * Math.sqrt(f);
  k[m.part]().prismY(-0.34, -0.03, 0.18, 0, dr, dr, 8, Math.PI / 8);
  k.accent().prismY(-0.355, -0.34, 0.18, 0, dr * 0.5, dr * 0.5, 8, Math.PI / 8);
  k.metal().box(0.18, -0.01, 0, 0.1, 0.04, dr * 2.1);
  if (m.tab) k.accent().box(0.18 + dr, -0.2, 0, 0.05, 0.1, 0.16);
  k.body().extrude([[-0.24, 0.27], [-0.24, 0.0], [-0.62, -0.08], [-0.76, -0.08], [-0.76, 0.2], [-0.62, 0.27]], -0.12, 0.12);
  k.grip().box(-0.79, 0.08, 0, 0.07, 0.32, 0.26, 0.02);
  if (a.optic) fitOptic(k, a.optic, 0.14, 0.29);
  else k.accent().box(0.14, 0.3, 0, 0.14, 0.04, 0.08);
  pistolGrip(k, -0.14, 0.32);
  if (a.grip === 'wrap') fitWrap(k, -0.14, 0.32, 0.13);
  else fitForegrip(k, a.grip, 0.72, 0.0);
  const fore = a.grip === 'angled' || a.grip === 'vertical' ? [0.72, -0.14, 0] : [0.72, 0, 0];
  return { geometry: b.build(), muzzle: [mx, 0.15, 0], fore, eject: [0.1, 0.3, 0.2], length: mx + 0.8 };
}

// Marksman rifle: long and narrow like the sniper, but two-tone with a heavy stepped barrel and a low, square scope.
function dmr(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().extrude([[-0.3, 0.0], [0.58, 0.0], [0.66, 0.06], [0.66, 0.19], [0.5, 0.25], [-0.22, 0.25], [-0.3, 0.17]], -0.115, 0.115);
  k.body2().box(1.0, 0.11, 0, 0.72, 0.17, 0.16, 0.03);                       // Slim fore-end.
  k.accent().box(1.0, 0.205, 0, 0.5, 0.02, 0.04);
  // Stepped barrel: three shoulders, each thinner, so the end of the gun reads as a taper.
  k.metal().prismX(1.34, 1.6, 0.11, 0, 0.07, 0.07, 6);
  k.metal().prismX(1.6, 1.82, 0.11, 0, 0.055, 0.055, 6);
  const mx = fitBarrel(k, a.barrel, 1.82, 0.11, 0, 0.08, 0.5);
  if (mx === null) {
    k.dark().prismX(1.82, 1.9, 0.11, 0, 0.1, 0.1, 6);
    k.metal().prismX(1.9, 1.96, 0.11, 0, 0.06, 0.06, 6);
  }
  k.body().extrude([[-0.3, 0.19], [-0.3, 0.0], [-0.6, -0.12], [-1.02, -0.14], [-1.02, 0.15], [-0.6, 0.19]], -0.095, 0.095);
  k.grip().box(-1.05, 0.0, 0, 0.07, 0.32, 0.22, 0.02);
  k.body2().box(-0.76, 0.17, 0, 0.3, 0.07, 0.15);                            // Cheek rest.
  if (a.optic) fitOptic(k, a.optic, 0.18, 0.25);
  else {
    // Low square-bodied scope: says "marksman" next to the Lancet's great tube.
    k.dark().box(0.18, 0.37, 0, 0.5, 0.15, 0.15, 0.02);
    k.dark().box(0.46, 0.37, 0, 0.1, 0.2, 0.2, 0.02);
    k.accent().box(0.515, 0.37, 0, 0.012, 0.16, 0.16);
    k.metal().box(0.05, 0.28, 0, 0.09, 0.08, 0.09);
    k.metal().box(0.32, 0.28, 0, 0.09, 0.08, 0.09);
  }
  k[m.part]().extrude([[0.14, 0.0], [0.42, 0.0], [0.42, -0.26 * f], [0.17, -0.26 * f]], -0.075, 0.075);
  if (m.tab) k.accent().box(0.28, -0.26 * f, 0, 0.18, 0.05, 0.1);
  k.metal().box(0.0, 0.2, 0.13, 0.12, 0.05, 0.08);
  pistolGrip(k, -0.04, 0.32, 0.12);
  if (a.grip === 'wrap') fitWrap(k, -0.04, 0.32, 0.12);
  else fitForegrip(k, a.grip, 0.96, 0.02);
  fitStock(k, a.grip, -1.06, 0.0);
  const fore = a.grip === 'angled' || a.grip === 'vertical' ? [0.96, -0.12, 0] : [0.96, 0.02, 0];
  return { geometry: b.build(), muzzle: [mx === null ? 1.98 : mx, 0.11, 0], fore, eject: [0.08, 0.22, 0.12], length: 3 };
}

// Revolver: a fat cylinder bulging out both sides of a long ribbed barrel, on a big curved butt.
function revolver(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag);
  k.body().extrude([[-0.26, 0.05], [0.14, 0.05], [0.14, 0.28], [-0.04, 0.32], [-0.2, 0.3], [-0.26, 0.2]], -0.09, 0.09);
  // The cylinder: wider than anything else on a sidearm, so it reads from above.
  const cr = m.len > 1 ? 0.23 : 0.2;                                         // A deep mag means a bigger cylinder.
  k[m.part]().prismX(-0.03, 0.27, 0.17, 0, cr, cr, 8, Math.PI / 8);
  k.accent().prismX(-0.045, -0.03, 0.17, 0, 0.12, 0.12, 8, Math.PI / 8);
  k.metal().box(0.12, 0.34, 0, 0.3, 0.03, 0.14);                             // Top strap.
  // Long barrel with a full-length rib on top.
  k.body2().box(0.56, 0.2, 0, 0.58, 0.15, 0.15, 0.02);
  k.dark().box(0.56, 0.3, 0, 0.58, 0.05, 0.07);
  k.metal().prismX(0.85, 0.93, 0.2, 0, 0.06, 0.06, 6);
  const mx = fitBarrel(k, a.barrel, 0.93, 0.2, 0, 0.09, 0.36);
  if (mx === null) k.metal().box(0.97, 0.2, 0, 0.09, 0.2, 0.2, 0.02);
  if (a.optic) fitOptic(k, a.optic, 0.5, 0.34, 0.68);
  else k.accent().box(0.8, 0.33, 0, 0.1, 0.05, 0.05);
  k.metal().box(-0.27, 0.27, 0, 0.1, 0.05, 0.06);                            // Hammer spur.
  // Big curved butt instead of the shared grip.
  k.grip().extrude([[-0.2, 0.06], [0.1, 0.06], [0.06, -0.14], [0.0, -0.38], [-0.28, -0.42], [-0.3, -0.2]], -0.09, 0.09);
  k.dark().box(-0.14, -0.42, 0, 0.3, 0.05, 0.2);
  if (m.tab) k.accent().box(0.13, 0.17, 0.2, 0.2, 0.05, 0.04);               // Speed-loader tab.
  if (isWrap(a.grip)) fitWrap(k, -0.06, 0.38, 0.17, a.grip);
  return { geometry: b.build(), muzzle: [mx === null ? 1.02 : mx, 0.2, 0], fore: [-0.12, -0.2, -0.05], eject: [0.05, 0.3, 0.05], length: 1.35 };
}

// Launcher: a huge tube with a bulbous warhead poking out the front and a flared exhaust at the rear.
function launcher(a) {
  const k = kit(), b = k.b;
  const blast = a.mag === 'warhead', shaped = a.mag === 'shaped';
  const tubeR = 0.19, ext = a.barrel === 'longtube' ? 0.42 : 0;
  k.body().prismX(-0.7, 0.9, 0.17, 0, tubeR, tubeR, 8, Math.PI / 8);
  if (ext) {
    // Long tube: a second section bolted on the front, with a bright collar at the joint.
    k.dark().prismX(0.9, 0.9 + ext, 0.17, 0, tubeR * 0.95, tubeR * 0.95, 8, Math.PI / 8);
    k.accent().prismX(0.88, 0.94, 0.17, 0, tubeR + 0.02, tubeR + 0.02, 8, Math.PI / 8);
  }
  k.accent(); for (const x of [-0.5, 0.72]) b.prismX(x, x + 0.07, 0.17, 0, tubeR + 0.012, tubeR + 0.012, 8, Math.PI / 8);
  k.dark().prismX(-0.96, -0.7, 0.17, 0, 0.29, tubeR, 8, Math.PI / 8);       // Flared exhaust.
  k.metal().prismX(-0.99, -0.96, 0.17, 0, 0.27, 0.29, 8, Math.PI / 8);
  // Warhead: the only thing in the game this shape. The wide warhead is obviously wider.
  // The shaped charge is a slim spike instead of a bulb.
  const hr = blast ? 0.34 : shaped ? 0.18 : 0.27, wx = 0.9 + ext, tip = shaped ? 0.4 : 0.24;
  k.metal().prismX(wx, wx + 0.1, 0.17, 0, tubeR, tubeR, 8, Math.PI / 8);
  k.dark().prismX(wx + 0.1, wx + 0.36, 0.17, 0, hr, hr, 8, Math.PI / 8);
  k.accent().prismX(wx + 0.36, wx + 0.36 + tip, 0.17, 0, hr, 0.05, 8, Math.PI / 8);
  k.metal().prismX(wx + 0.36 + tip, wx + 0.42 + tip, 0.17, 0, 0.05, 0.03, 8, Math.PI / 8);
  if (a.optic) fitOptic(k, a.optic, 0.1, 0.36, 0.9);
  else {
    k.dark().box(0.1, 0.42, 0, 0.3, 0.12, 0.1);                              // Box sight.
    k.accent().box(0.25, 0.42, 0, 0.012, 0.09, 0.07);
  }
  k.dark().box(-0.1, -0.02, 0, 0.36, 0.08, 0.16);
  pistolGrip(k, -0.1, 0.36, 0.14);
  if (a.grip === 'wrap') fitWrap(k, -0.1, 0.36, 0.14);
  else if (a.grip === 'angled') fitForegrip(k, a.grip, 0.46, -0.02);
  else k.grip().box(0.46, -0.16, 0, 0.12, 0.3, 0.11, 0.03);
  const fore = a.grip === 'angled' ? [0.46, -0.16, 0] : [0.46, -0.18, 0];
  return { geometry: b.build(), muzzle: [1.58 + ext + (shaped ? 0.16 : 0), 0.17, 0], fore, eject: [-1, 0.2, 0], length: 2.55 + ext };
}

// Shared tail for long guns: rear grip, wrap, foregrip slot and stock slot. Returns the support-hand point.
function longGunGrips(k, a, gx, drop, w, foreX, foreY, buttX, buttY) {
  pistolGrip(k, gx, drop, w);
  if (isWrap(a.grip)) fitWrap(k, gx, drop, w, a.grip);
  else fitForegrip(k, a.grip, foreX, foreY);
  fitStock(k, a.grip, buttX, buttY);
  return a.grip === 'angled' || a.grip === 'vertical' ? [foreX, foreY - 0.14, 0] : [foreX, foreY + 0.02, 0];
}

// Heavy rifle, bullpup: the magazine sits behind the grip, so the receiver is a fat slab at the back and the front
// is a short, square snout. From above: wide at the shoulder, narrow and blunt at the muzzle.
function heavyar(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().extrude([[-0.95, -0.06], [0.3, -0.06], [0.42, 0.02], [0.42, 0.24], [0.2, 0.32], [-0.8, 0.32], [-0.95, 0.22]], -0.17, 0.17);
  k.grip().box(-0.98, 0.12, 0, 0.08, 0.38, 0.32, 0.02);                                        // Butt pad.
  k.body2().box(0.66, 0.12, 0, 0.5, 0.22, 0.24, 0.03);                                        // Square snout.
  k.dark(); for (let i = 0; i < 2; i++) b.box(0.56 + i * 0.2, 0.24, 0, 0.1, 0.03, 0.2);
  k.metal().prismX(0.9, 1.06, 0.12, 0, 0.065, 0.06, 6);
  const mx = fitBarrel(k, a.barrel, 1.06, 0.12, 0, 0.1, 0.5);
  if (mx === null) {
    k.dark().box(1.12, 0.12, 0, 0.14, 0.24, 0.24, 0.02);                                      // Square brake.
    k.accent().box(1.12, 0.12, 0, 0.04, 0.26, 0.26);
  }
  // Magazine behind the grip, raked back.
  k[m.part]().extrude([[-0.62, 0], [-0.36, 0], [-0.36 - 0.06 * f, -0.46 * f], [-0.62 - 0.06 * f, -0.42 * f]], -0.1, 0.1);
  if (m.tab) k.accent().box(-0.5 - 0.06 * f, -0.45 * f, 0, 0.2, 0.05, 0.14);
  if (m.drum) fitDrum(k, -0.5, -0.2, 0.26);
  k.metal().box(-0.3, 0.26, 0.19, 0.3, 0.06, 0.06);                                           // Side charging rod.
  if (a.optic) fitOptic(k, a.optic, -0.1, 0.32);
  else {
    k.dark().box(-0.1, 0.4, 0, 0.5, 0.12, 0.2, 0.02);                                         // Long carry rail, fat from above.
    k.accent().box(0.14, 0.47, 0, 0.04, 0.04, 0.14);
  }
  const fore = longGunGrips(k, a, 0.08, 0.34, 0.14, 0.6, 0.0, -1.0, 0.12);
  return { geometry: b.build(), muzzle: [mx === null ? 1.2 : mx, 0.12, 0], fore, eject: [-0.2, 0.3, 0.18], length: 2.2 };
}

// Precision SMG: a tall, flat slab of a receiver that drops in a step to the barrel, a straight mag right under
// the step and a long rail down the top. From the side a staircase; from above a long narrow plank.
function tacsmg(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().extrude([[-0.3, -0.12], [0.36, -0.12], [0.36, 0.0], [0.62, 0.0], [0.62, 0.22], [0.2, 0.3], [-0.3, 0.3]], -0.12, 0.12);
  k.dark().box(0.18, 0.32, 0, 0.92, 0.04, 0.12);                                              // Full-length rail.
  k.metal().prismX(0.62, 0.86, 0.12, 0, 0.055, 0.055, 6);
  const mx = fitBarrel(k, a.barrel, 0.86, 0.12, 0, 0.08, 0.44);
  if (mx === null) k.dark().prismX(0.86, 0.98, 0.12, 0, 0.08, 0.08, 6);
  k.accent().box(0.48, 0.05, 0.13, 0.18, 0.06, 0.02);                                         // Laser window.
  k[m.part]().box(0.46, -0.12 - 0.26 * f, 0, 0.13, 0.52 * f, 0.1, 0.02);
  if (m.tab) k.accent().box(0.46, -0.13 - 0.52 * f, 0, 0.16, 0.05, 0.12);
  if (m.drum) fitDrum(k, 0.46, -0.16, 0.2);
  k.body2().extrude([[-0.3, 0.26], [-0.3, 0.04], [-0.72, -0.02], [-0.72, 0.2]], -0.08, 0.08);   // Slab stock.
  k.grip().box(-0.75, 0.09, 0, 0.06, 0.26, 0.2, 0.015);
  if (a.optic) fitOptic(k, a.optic, 0.08, 0.34, 0.9);
  else { k.accent().box(-0.18, 0.38, 0, 0.05, 0.08, 0.05); k.accent().box(0.5, 0.38, 0, 0.05, 0.08, 0.05); }
  const fore = longGunGrips(k, a, -0.04, 0.32, 0.12, 0.7, -0.02, -0.74, 0.1);
  return { geometry: b.build(), muzzle: [mx === null ? 1.0 : mx, 0.12, 0], fore, eject: [0.1, 0.26, 0.13], length: 1.75 };
}

// Break-action, over-under: two stacked tubes on a slim fore-end, exposed hammers, a long curved stock.
// Narrow from above where the Thresher is wide; its length and the hammers are the tell.
function coach(a) {
  const k = kit(), b = k.b;
  const end = a.barrel === 'sawnoff' ? 0.95 : 1.36;
  k.body().box(-0.02, 0.12, 0, 0.42, 0.3, 0.24, 0.04);                                         // Action block.
  k.metal().prismX(0.18, end, 0.22, 0, 0.085, 0.08, 8, Math.PI / 8);                           // Top tube.
  k.metal().prismX(0.18, end, 0.06, 0, 0.085, 0.08, 8, Math.PI / 8);                           // Bottom tube.
  k.dark().box(0.1 + (end - 0.1) / 2, 0.14, 0, end - 0.1, 0.04, 0.1);                          // Rib between them.
  let mx;
  if (a.barrel === 'suppressor') {
    k.dark().box(end + 0.26, 0.14, 0, 0.52, 0.42, 0.26, 0.05);
    k.accent().box(end + 0.4, 0.14, 0, 0.05, 0.44, 0.28);
    mx = end + 0.53;
  } else if (a.barrel === 'choke') {
    for (const y of [0.06, 0.22]) k.dark().prismX(end, end + 0.14, y, 0, 0.08, 0.05, 8, Math.PI / 8);
    mx = end + 0.15;
  } else if (a.barrel === 'rifled') {
    for (const y of [0.06, 0.22]) k.metal().prismX(end, end + 0.28, y, 0, 0.07, 0.07, 8, Math.PI / 8);
    k.accent().box(end + 0.2, 0.14, 0, 0.04, 0.36, 0.18);
    mx = end + 0.29;
  } else {
    k.dark().box(end + 0.02, 0.14, 0, 0.06, 0.38, 0.22);
    mx = end + 0.05;
  }
  k.body2().box(0.52, -0.02, 0, 0.5, 0.14, 0.2, 0.04);                                         // Fore-end.
  k.accent().box(-0.12, 0.3, -0.06, 0.08, 0.08, 0.05);                                         // Hammers.
  k.accent().box(-0.12, 0.3, 0.06, 0.08, 0.08, 0.05);
  k.body().extrude([[-0.2, 0.24], [-0.2, 0.0], [-0.5, -0.14], [-1.05, -0.26], [-1.05, 0.1], [-0.5, 0.2]], -0.11, 0.11);
  k.grip().box(-1.08, -0.08, 0, 0.07, 0.36, 0.24, 0.02);
  if (a.mag === 'speedmag') { k.dark().box(-0.6, 0.0, 0.13, 0.3, 0.14, 0.05); k.accent(); for (let i = 0; i < 3; i++) b.prismX(-0.72 + i * 0.1, -0.66 + i * 0.1, 0.0, 0.16, 0.035, 0.035, 6); }
  else if (a.mag === 'lightmag') k.body2().box(-0.62, 0.15, 0, 0.28, 0.05, 0.24);
  if (a.optic) fitOptic(k, a.optic, 0.4, 0.3, 0.85);
  else k.accent().box(end - 0.05, 0.32, 0, 0.05, 0.04, 0.04);                                 // Bead sight.
  pistolGrip(k, -0.06, 0.3, 0.12);
  if (a.grip === 'wrap') fitWrap(k, -0.06, 0.3, 0.12);
  else fitForegrip(k, a.grip, 0.52, -0.08);
  const fore = a.grip === 'angled' || a.grip === 'vertical' ? [0.52, -0.22, 0] : [0.52, -0.05, 0];
  return { geometry: b.build(), muzzle: [mx, 0.14, 0], fore, eject: [-0.1, 0.3, 0], length: mx + 1.08 };
}

// LMG fittings shared by the Drover and the Millrace: heat sink fins along the barrel.
function fitHeatsink(k, x0, x1, y) {
  const b = k.b, n = Math.max(3, Math.round((x1 - x0) / 0.1));
  k.dark(); for (let i = 0; i < n; i++) b.box(x0 + (i + 0.5) * (x1 - x0) / n, y, 0, 0.05, 0.34, 0.36);
  k.accent().box((x0 + x1) / 2, y + 0.19, 0, x1 - x0, 0.03, 0.05);
}

// Light LMG: slim body, a square box magazine hung low and to the left, a perforated round barrel jacket.
function saw(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().extrude([[-0.32, 0], [0.48, 0], [0.54, 0.06], [0.54, 0.22], [0.38, 0.28], [-0.24, 0.28], [-0.32, 0.18]], -0.12, 0.12);
  k.body2().prismX(0.52, 1.12, 0.13, 0, 0.1, 0.1, 8, Math.PI / 8);
  k.dark(); for (let i = 0; i < 4; i++) b.box(0.62 + i * 0.13, 0.22, 0, 0.06, 0.02, 0.1);
  k.metal().prismX(1.12, 1.34, 0.13, 0, 0.05, 0.045, 6);
  const mx = fitBarrel(k, a.barrel, 1.34, 0.13, 0, 0.08, 0.46);
  if (mx === null) k.dark().prismX(1.34, 1.44, 0.13, 0, 0.08, 0.06, 6);
  if (a.barrel === 'heatsink') fitHeatsink(k, 0.56, 1.1, 0.13);
  // Box magazine: a square block slung under and to the left, with a feed tab.
  const bs = 0.32 * Math.sqrt(f);
  k[m.part]().box(0.12, -0.08, -0.24, bs, bs, bs * 0.9, 0.02);
  k.accent().box(0.12, -0.08, -0.24 - bs * 0.46, bs * 0.6, 0.05, 0.02);
  if (m.tab) k.accent().box(0.12, -0.08 - bs / 2, -0.24, 0.16, 0.04, 0.12);
  k.body().extrude([[-0.32, 0.22], [-0.32, 0.0], [-0.6, -0.08], [-0.9, -0.08], [-0.9, 0.16], [-0.6, 0.22]], -0.1, 0.1);
  k.grip().box(-0.93, 0.04, 0, 0.07, 0.28, 0.24, 0.02);
  k.metal(); b.box(1.04, -0.05, -0.07, 0.04, 0.2, 0.04); b.box(1.04, -0.05, 0.07, 0.04, 0.2, 0.04);   // Folded bipod.
  if (a.optic) fitOptic(k, a.optic, 0.18, 0.28);
  else { k.dark().box(0.18, 0.33, 0, 0.36, 0.06, 0.12); k.accent().box(0.3, 0.38, 0, 0.06, 0.05, 0.06); }
  const fore = longGunGrips(k, a, -0.04, 0.32, 0.14, 0.78, -0.02, -0.94, 0.04);
  return { geometry: b.build(), muzzle: [mx === null ? 1.46 : mx, 0.13, 0], fore, eject: [0.2, 0.26, 0.14], length: 2.4 };
}

// Rotary: a ring of six barrels on a cluster, a fat motor housing behind, an ammo can hung on the right and a big
// carry handle on top. From above it is a cylinder and a box side by side: nothing else looks like it.
function rotary(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().box(-0.1, 0.12, 0, 0.8, 0.36, 0.34, 0.06);                                          // Motor housing.
  k.dark().prismX(0.3, 0.42, 0.13, 0, 0.2, 0.2, 8, Math.PI / 8);                               // Clamp ring.
  const end = 1.32;
  k.metal(); for (let i = 0; i < 6; i++) {
    const t = i / 6 * Math.PI * 2;
    b.prismX(0.4, end, 0.13 + Math.sin(t) * 0.11, Math.cos(t) * 0.11, 0.035, 0.035, 5);
  }
  k.dark().prismX(0.9, 0.98, 0.13, 0, 0.17, 0.17, 8, Math.PI / 8);                             // Mid clamp.
  let mx = end + 0.02;
  if (a.barrel === 'suppressor') { k.dark().prismX(end, end + 0.42, 0.13, 0, 0.2, 0.2, 8, Math.PI / 8); k.accent().prismX(end + 0.3, end + 0.34, 0.13, 0, 0.21, 0.21, 8, Math.PI / 8); mx = end + 0.44; }
  else if (a.barrel === 'longbarrel' || a.barrel === 'heavybarrel') { k.metal().prismX(end, end + 0.3, 0.13, 0, 0.16, 0.16, 6, Math.PI / 6); mx = end + 0.32; }
  else if (a.barrel === 'compensator') { k.metal().box(end + 0.08, 0.13, 0, 0.16, 0.3, 0.4, 0.02); mx = end + 0.17; }
  else if (a.barrel === 'shroud') { k.metal().prismX(0.98, end + 0.06, 0.13, 0, 0.18, 0.18, 6, Math.PI / 6); k.dark(); for (let i = 0; i < 3; i++) b.prismX(1.04 + i * 0.12, 1.08 + i * 0.12, 0.13, 0, 0.21, 0.21, 6, Math.PI / 6); mx = end + 0.07; }
  else { k.dark().prismX(end - 0.04, end + 0.02, 0.13, 0, 0.16, 0.16, 8, Math.PI / 8); }
  if (a.barrel === 'heatsink') fitHeatsink(k, 0.46, 0.88, 0.13);
  // Ammo can on the right, a feed chute running into the housing.
  const cl = 0.42 * f;
  k[m.part]().box(-0.12, -0.04, 0.36, cl, 0.34, 0.26, 0.03);
  k.accent().box(-0.12, 0.14, 0.36, cl * 0.7, 0.02, 0.2);
  k.dark().box(0.05, 0.08, 0.2, 0.12, 0.08, 0.14);
  if (m.tab) k.accent().box(-0.12 - cl / 2, -0.04, 0.36, 0.04, 0.16, 0.16);
  k.dark().box(-0.6, 0.1, 0, 0.22, 0.28, 0.3, 0.03);                                           // Rear battery.
  k.grip().box(-0.72, 0.1, 0, 0.04, 0.22, 0.24);
  if (a.optic) fitOptic(k, a.optic, -0.06, 0.3);
  else {
    k.dark().extrude([[-0.36, 0.3], [0.2, 0.3], [0.16, 0.5], [-0.32, 0.5]], -0.05, 0.05);     // Carry handle.
    k.accent().box(-0.08, 0.5, 0, 0.3, 0.03, 0.08);
  }
  const fore = longGunGrips(k, a, -0.2, 0.36, 0.15, 0.62, -0.06, -0.74, 0.1);
  return { geometry: b.build(), muzzle: [mx, 0.13, 0], fore, eject: [-0.1, 0.0, -0.2], length: mx + 0.75 };
}

// Battle rifle: long straight magazine, a tall front post on a long thin handguard, and a cage flash hider.
function battle(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().extrude([[-0.32, 0], [0.46, 0], [0.52, 0.05], [0.52, 0.22], [0.38, 0.27], [-0.24, 0.27], [-0.32, 0.18]], -0.13, 0.13);
  k.body2().box(0.92, 0.1, 0, 0.82, 0.18, 0.2, 0.03);                                          // Long thin handguard.
  k.dark(); for (let i = 0; i < 4; i++) b.box(0.62 + i * 0.18, 0.2, 0, 0.08, 0.025, 0.16);
  k.metal().prismX(1.32, 1.5, 0.1, 0, 0.05, 0.05, 6);
  const mx = fitBarrel(k, a.barrel, 1.5, 0.1, 0, 0.08, 0.5);
  if (mx === null) {
    k.dark(); for (let i = 0; i < 4; i++) { const t = i * Math.PI / 2 + Math.PI / 4; b.box(1.58, 0.1 + Math.sin(t) * 0.07, Math.cos(t) * 0.07, 0.18, 0.03, 0.03); }
    k.metal().box(1.5, 0.1, 0, 0.03, 0.18, 0.18);
  }
  k.metal().box(1.24, 0.27, 0, 0.05, 0.18, 0.04);                                             // Tall front post.
  k.accent().box(1.24, 0.37, 0, 0.06, 0.03, 0.06);
  // Straight, long magazine.
  k[m.part]().box(0.2, -0.27 * f, 0, 0.18, 0.54 * f, 0.13, 0.02);
  if (m.tab) k.accent().box(0.2, -0.54 * f - 0.02, 0, 0.2, 0.05, 0.15);
  k.body().extrude([[-0.32, 0.22], [-0.32, 0.0], [-0.62, -0.1], [-1.0, -0.12], [-1.0, 0.16], [-0.62, 0.22]], -0.11, 0.11);
  k.grip().box(-1.03, 0.02, 0, 0.07, 0.3, 0.24, 0.02);
  if (a.optic) fitOptic(k, a.optic, 0.12, 0.27);
  else { k.dark().box(-0.12, 0.31, 0, 0.12, 0.08, 0.1); k.accent().box(-0.12, 0.36, 0, 0.04, 0.04, 0.08); }
  const fore = longGunGrips(k, a, -0.06, 0.34, 0.13, 0.9, 0.0, -1.04, 0.02);
  return { geometry: b.build(), muzzle: [mx === null ? 1.68 : mx, 0.1, 0], fore, eject: [0.12, 0.24, 0.14], length: 2.75 };
}

// Lever action: a tube magazine under a long round barrel, a bright loop lever round the grip, a straight stock.
function lever(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().extrude([[-0.28, 0], [0.36, 0], [0.4, 0.05], [0.4, 0.22], [0.26, 0.26], [-0.2, 0.26], [-0.28, 0.16]], -0.11, 0.11);
  k.metal().prismX(0.4, 1.5, 0.17, 0, 0.065, 0.055, 8, Math.PI / 8);                          // Barrel.
  const tube = 0.4 + 0.86 * Math.min(1.15, f);
  k[m.part]().prismX(0.4, tube, 0.04, 0, 0.055, 0.055, 8, Math.PI / 8);                         // Tube magazine.
  k.dark().box(tube - 0.03, 0.105, 0, 0.06, 0.2, 0.1);
  if (m.tab) k.accent().prismX(tube - 0.06, tube, 0.04, 0, 0.065, 0.065, 8, Math.PI / 8);
  k.body2().box(0.62, 0.06, 0, 0.42, 0.18, 0.2, 0.04);                                         // Fore-end.
  const mx = fitBarrel(k, a.barrel, 1.5, 0.17, 0, 0.08, 0.46);
  if (mx === null) k.accent().box(1.47, 0.25, 0, 0.04, 0.06, 0.03);                            // Front bead.
  // The lever: an open bright loop below the grip.
  k.accent().box(0.0, -0.36, 0, 0.36, 0.04, 0.05);
  k.accent().box(0.17, -0.2, 0, 0.04, 0.3, 0.05);
  k.accent().box(-0.17, -0.25, 0, 0.04, 0.2, 0.05);
  k.body().extrude([[-0.28, 0.2], [-0.28, 0.0], [-0.6, -0.14], [-1.06, -0.18], [-1.06, 0.12], [-0.6, 0.18]], -0.1, 0.1);
  k.grip().box(-1.09, -0.03, 0, 0.07, 0.32, 0.22, 0.02);
  if (a.optic) fitOptic(k, a.optic, 0.08, 0.26);
  else k.dark().box(0.0, 0.29, 0, 0.1, 0.06, 0.12);
  const fore = longGunGrips(k, a, -0.06, 0.3, 0.12, 0.66, -0.04, -1.1, -0.03);
  return { geometry: b.build(), muzzle: [mx === null ? 1.5 : mx, 0.17, 0], fore, eject: [0.1, 0.3, 0.1], length: 2.6 };
}

// Anti-materiel: the biggest gun in the game. Boxy receiver, a barrel as thick as a pistol, a brake like a
// shovel head, a bipod and a monster scope. Its length alone is the silhouette.
function antimat(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().box(0.1, 0.12, 0, 1.0, 0.3, 0.28, 0.04);
  k.body2().box(0.95, 0.12, 0, 0.7, 0.22, 0.22, 0.04);                                         // Barrel jacket.
  const end = a.barrel === 'fluted' ? 1.9 : 2.3;
  k.metal().prismX(1.3, end, 0.12, 0, 0.08, 0.07, 8, Math.PI / 8);
  if (a.barrel === 'fluted') { k.dark(); for (let i = 0; i < 4; i++) b.box(1.4 + i * 0.12, 0.12, 0, 0.05, 0.18, 0.18); }
  let mx = fitBarrel(k, a.barrel, end, 0.12, 0, 0.12, 0.6);
  if (mx === null) {
    k.dark().box(end + 0.1, 0.12, 0, 0.2, 0.18, 0.52, 0.02);                                  // Shovel brake.
    k.metal().box(end + 0.1, 0.12, -0.26, 0.14, 0.24, 0.04);
    k.metal().box(end + 0.1, 0.12, 0.26, 0.14, 0.24, 0.04);
    mx = end + 0.21;
  }
  k.metal(); b.box(1.5, -0.08, -0.12, 0.05, 0.3, 0.05); b.box(1.5, -0.08, 0.12, 0.05, 0.3, 0.05);   // Bipod.
  b.box(1.5, -0.24, 0, 0.12, 0.04, 0.36);
  k[m.part]().box(0.3, -0.12 - 0.12 * f, 0, 0.3, 0.26 * f, 0.18, 0.02);
  if (m.tab) k.accent().box(0.3, -0.13 - 0.26 * f, 0, 0.22, 0.05, 0.14);
  k.metal().box(0.2, 0.2, 0.17, 0.14, 0.05, 0.14);                                            // Bolt knob.
  k.body().extrude([[-0.4, 0.26], [-0.4, -0.02], [-0.7, -0.14], [-1.15, -0.16], [-1.15, 0.22], [-0.7, 0.26]], -0.12, 0.12);
  k.grip().box(-1.18, 0.03, 0, 0.08, 0.4, 0.26, 0.02);
  k.dark().box(-0.95, -0.2, 0, 0.06, 0.12, 0.08);                                              // Monopod.
  if (a.optic) fitOptic(k, a.optic, 0.2, 0.27, 1.1);
  else {
    k.dark().prismX(-0.3, 0.7, 0.44, 0, 0.12, 0.12, 8, Math.PI / 8);
    k.dark().prismX(0.5, 0.82, 0.44, 0, 0.12, 0.2, 8, Math.PI / 8);
    k.dark().prismX(-0.46, -0.28, 0.44, 0, 0.16, 0.12, 8, Math.PI / 8);
    k.accent().prismX(0.82, 0.835, 0.44, 0, 0.18, 0.18, 8, Math.PI / 8);
    k.metal().box(0.0, 0.33, 0, 0.12, 0.12, 0.12);
    k.metal().box(0.45, 0.33, 0, 0.12, 0.12, 0.12);
  }
  const fore = longGunGrips(k, a, -0.08, 0.34, 0.14, 0.9, 0.0, -1.16, 0.04);
  return { geometry: b.build(), muzzle: [mx, 0.12, 0], fore, eject: [0.2, 0.3, 0.14], length: mx + 1.2 };
}

// Light bolt gun: a thumbhole stock (the hole reads from the side), a short fluted barrel, a compact scope.
function semisnipe(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().extrude([[-0.26, 0.02], [0.5, 0.02], [0.56, 0.07], [0.56, 0.18], [0.42, 0.23], [-0.18, 0.23], [-0.26, 0.15]], -0.11, 0.11);
  k.body2().box(0.8, 0.11, 0, 0.5, 0.16, 0.18, 0.03);
  const end = a.barrel === 'fluted' ? 1.3 : 1.56;
  k.metal().prismX(1.04, end, 0.11, 0, 0.05, 0.045, 6);
  k.dark(); for (let i = 0; i < 3; i++) b.box(1.12 + i * 0.1, 0.11, 0, 0.04, 0.12, 0.12);
  let mx = fitBarrel(k, a.barrel, end, 0.11, 0, 0.08, 0.5);
  if (mx === null) { k.dark().prismX(end, end + 0.1, 0.11, 0, 0.08, 0.06, 6); mx = end + 0.1; }
  // Thumbhole stock: a frame with a gap behind the grip.
  k.body().extrude([
    [-0.26, 0.2], [-0.26, 0.04], [-0.4, -0.3], [-0.9, -0.12], [-0.9, 0.18], [-0.5, 0.2],
    [-0.5, 0.08], [-0.78, 0.04], [-0.78, -0.06], [-0.44, -0.18], [-0.38, -0.02],
  ], -0.085, 0.085);
  k.grip().box(-0.93, 0.03, 0, 0.07, 0.3, 0.2, 0.02);
  k[m.part]().extrude([[0.12, 0.02], [0.32, 0.02], [0.32, -0.24 * f], [0.16, -0.24 * f]], -0.06, 0.06);
  if (m.tab) k.accent().box(0.24, -0.24 * f, 0, 0.18, 0.05, 0.1);
  k.metal().box(0.06, 0.17, 0.13, 0.08, 0.04, 0.12);
  if (a.optic) fitOptic(k, a.optic, 0.22, 0.23);
  else {
    k.dark().prismX(-0.02, 0.5, 0.34, 0, 0.08, 0.08, 8, Math.PI / 8);
    k.dark().prismX(0.48, 0.62, 0.34, 0, 0.08, 0.12, 8, Math.PI / 8);
    k.accent().prismX(0.62, 0.635, 0.34, 0, 0.1, 0.1, 8, Math.PI / 8);
    k.metal().box(0.12, 0.26, 0, 0.08, 0.08, 0.08);
    k.metal().box(0.38, 0.26, 0, 0.08, 0.08, 0.08);
  }
  const fore = longGunGrips(k, a, -0.02, 0.3, 0.11, 0.78, 0.04, -0.94, 0.04);
  return { geometry: b.build(), muzzle: [mx, 0.11, 0], fore, eject: [0.06, 0.22, 0.1], length: mx + 0.97 };
}

// Machine pistol: a long magazine stretching far below the grip and a folding front handle; a stubby slide.
function machpistol(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag), f = m.len;
  k.body().extrude([[-0.2, 0.06], [0.42, 0.06], [0.46, 0.1], [0.46, 0.24], [0.32, 0.28], [-0.16, 0.28], [-0.2, 0.22]], -0.1, 0.1);
  k.dark().box(0.12, 0.02, 0, 0.6, 0.1, 0.16, 0.02);
  k.metal().prismX(0.46, 0.56, 0.16, 0, 0.07, 0.07, 6);
  const mx = fitBarrel(k, a.barrel, 0.56, 0.16, 0, 0.08, 0.32);
  if (mx === null) k.dark().prismX(0.56, 0.64, 0.16, 0, 0.09, 0.08, 6);
  k.grip().box(0.34, -0.12, 0, 0.1, 0.24, 0.1, 0.02);                                         // Front handle.
  k.accent().box(0.34, -0.25, 0, 0.12, 0.03, 0.12);
  if (a.optic) fitOptic(k, a.optic, 0.1, 0.28, 0.7);
  else k.accent().box(0.1, 0.29, 0, 0.3, 0.025, 0.08);
  pistolGrip(k, -0.02, 0.36, 0.15);
  // The magazine runs out of the grip and on well past it.
  const ml = 0.32 * f;
  k[m.part]().box(-0.08, -0.36 - ml / 2, 0, 0.14, ml, 0.12, 0.02);
  k.accent().box(-0.08, -0.37 - ml, 0, 0.18, 0.04, 0.14);
  if (m.tab) k.accent().box(-0.08, -0.36 - ml * 0.5, 0.07, 0.1, 0.1, 0.02);
  if (isWrap(a.grip)) fitWrap(k, -0.02, 0.36, 0.15, a.grip);
  return { geometry: b.build(), muzzle: [mx === null ? 0.66 : mx, 0.16, 0], fore: [0.34, -0.14, 0], eject: [0.1, 0.3, 0.1], length: 1.0 };
}

// Double-tap pistol: two stacked barrels in a tall, flat-fronted slide; two bright muzzles you can count.
function deuce(a) {
  const k = kit(), b = k.b;
  const m = magLook(a.mag);
  k.body().extrude([[-0.22, 0.04], [0.54, 0.04], [0.58, 0.08], [0.58, 0.34], [0.42, 0.38], [-0.18, 0.38], [-0.22, 0.3]], -0.11, 0.11);
  k.dark().box(0.17, 0.0, 0, 0.74, 0.1, 0.17, 0.02);
  k.metal().prismX(0.58, 0.68, 0.13, 0, 0.065, 0.065, 6);
  k.metal().prismX(0.58, 0.68, 0.29, 0, 0.065, 0.065, 6);
  const mx = fitBarrel(k, a.barrel, 0.68, 0.21, 0, 0.11, 0.34);
  if (mx === null) {
    k.accent().prismX(0.68, 0.7, 0.13, 0, 0.05, 0.05, 6);
    k.accent().prismX(0.68, 0.7, 0.29, 0, 0.05, 0.05, 6);
  }
  k.accent(); for (let i = 0; i < 2; i++) b.box(-0.06 + i * 0.1, 0.385, 0, 0.05, 0.02, 0.16);   // Two pips.
  if (a.optic) fitOptic(k, a.optic, 0.14, 0.38, 0.72);
  const drop = 0.38 * Math.max(1, m.len * 0.85);
  pistolGrip(k, -0.02, drop, 0.16);
  k[m.part]().box(-0.04, -drop - 0.02, 0, 0.26, 0.05, 0.19);
  if (m.tab) k.accent().box(-0.04, -drop - 0.05, 0, 0.16, 0.04, 0.1);
  if (isWrap(a.grip)) fitWrap(k, -0.02, 0.38, 0.16, a.grip);
  return { geometry: b.build(), muzzle: [mx === null ? 0.72 : mx, 0.21, 0], fore: [-0.1, -0.2, -0.05], eject: [0.1, 0.4, 0.1], length: 1.1 };
}

// Revolving grenade launcher: a huge six-chamber cylinder, a short fat barrel, a skeleton folding stock.
function thumper(a) {
  const k = kit(), b = k.b;
  const blast = a.mag === 'warhead', shaped = a.mag === 'shaped';
  const cr = blast ? 0.3 : 0.26;
  k.body().prismX(-0.1, 0.36, 0.12, 0, cr, cr, 8, Math.PI / 8);                                 // Cylinder.
  k.dark(); for (let i = 0; i < 6; i++) { const t = i / 6 * Math.PI * 2; b.prismX(0.355, 0.37, 0.12 + Math.sin(t) * cr * 0.6, Math.cos(t) * cr * 0.6, 0.06, 0.06, 6); }
  k.accent().prismX(-0.12, -0.1, 0.12, 0, 0.1, 0.1, 8, Math.PI / 8);
  const ext = a.barrel === 'longtube' ? 0.36 : 0;
  const end = 0.86 + ext;
  k.body2().prismX(0.36, end, 0.14, 0, 0.13, 0.13, 8, Math.PI / 8);                              // Fat barrel.
  if (ext) k.accent().prismX(0.84, 0.9, 0.14, 0, 0.145, 0.145, 8, Math.PI / 8);
  k.dark().prismX(end, end + 0.08, 0.14, 0, shaped ? 0.1 : 0.16, shaped ? 0.1 : 0.16, 8, Math.PI / 8);
  k.metal().box(0.45, 0.31, 0, 0.42, 0.05, 0.1);                                                // Top strap.
  // Skeleton folding stock.
  k.metal().box(-0.48, 0.18, 0, 0.6, 0.04, 0.05);
  k.metal().box(-0.48, -0.02, 0, 0.6, 0.04, 0.05);
  k.grip().box(-0.8, 0.08, 0, 0.07, 0.3, 0.2, 0.02);
  if (a.optic) fitOptic(k, a.optic, 0.5, 0.34, 0.85);
  else { k.dark().box(0.66, 0.4, 0, 0.12, 0.14, 0.04); k.accent().box(0.66, 0.46, 0, 0.13, 0.03, 0.06); }   // Leaf sight.
  pistolGrip(k, -0.18, 0.34, 0.14);
  if (a.grip === 'wrap') fitWrap(k, -0.18, 0.34, 0.14);
  else if (a.grip === 'angled') fitForegrip(k, a.grip, 0.62, 0.02);
  else k.grip().box(0.62, -0.12, 0, 0.11, 0.26, 0.11, 0.03);
  const fore = a.grip === 'angled' ? [0.62, -0.12, 0] : [0.62, -0.14, 0];
  return { geometry: b.build(), muzzle: [end + 0.08, 0.14, 0], fore, eject: [0.1, 0.12, 0.25], length: end + 0.9 };
}

const FACTORIES = {
  ar, burst, heavyar, smg, pdw, tacsmg, shotgun, autoshot, coach, lmg, saw, rotary,
  dmr, battle, lever, sniper, antimat, semisnipe, pistol, revolver, machpistol, deuce, launcher, thumper,
};

// Built once per weapon+kit; the geometry is shared by every instance in every renderer.
const cache = new Map();
// Stable kit object -> Map(weaponId -> gun). Kits are canonical objects, so a per-frame call does no string work.
const byKit = new WeakMap();

function build(id, kit, key) {
  const make = FACTORIES[id] || FACTORIES.ar;
  const g = make(kit);
  g.geometry.computeBoundingBox();
  g.geometry.computeBoundingSphere();
  g.key = key;
  cache.set(key, g);
  return g;
}

// { geometry, muzzle:[x,y,z], fore:[x,y,z], eject:[x,y,z], length, key }
// `attachments` is a kit ({optic,barrel,mag,grip}), raw or normalized, optional. Variants are cached like base
// guns and carry `key`, one id per distinct model, for grouping instances. A gun with no kit is exactly the base.
export function getGun(id, attachments) {
  if (!attachments || attachments === NO_ATTACHMENTS) return cache.get(id) || build(id, NO_ATTACHMENTS, id);
  let perGun = byKit.get(attachments);
  let g = perGun && perGun.get(id);
  if (g) return g;
  const kit = normalizeKit(id, attachments);
  if (kit === NO_ATTACHMENTS) return getGun(id);
  const key = `${id}#${kitKey(kit)}`;
  g = cache.get(key) || build(id, kit, key);
  if (!perGun) byKit.set(attachments, perGun = new Map());
  perGun.set(id, g);
  return g;
}
