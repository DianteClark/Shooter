// Finishing moves and emotes as pose layers for js/render/characters.js (docs/FINISHERS.md). Each pose writes offsets
// into one reusable object that the rig adds to the pose it already computes: body lean, roll, twist, height and
// travel; the gun's offsets and whether it is put away; free-hand targets in body space; and two lying states.
//
// Body space is the rig's: x forward along the aim, y up from the ground, z to the right. Lean is forward (+) or back
// (-); twist turns the upper body with the aim (+ is to the left, as the rig's yaw runs). `lie` 0..1 lowers the body to
// the ground, face down when lieUp is 0 and on the back when it is 1. Hands: lw/rw weights of the left/right hand
// targets (lx, ly, lz)/(rx, ry, rz); the right hand otherwise holds the gun, the left its fore grip.
// `hit` is 1 on the frames a blow lands (flinch and sound cues read it once per crossing).

import { getFinisher } from '../shared/finishers.js';

const sm = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const seg = (u, a, b) => sm((u - a) / (b - a));
// Up over [a, m], held, down over [n, b].
const hold = (u, a, m, n, b) => (u < m ? seg(u, a, m) : u < n ? 1 : 1 - seg(u, n, b));
const strike = (u, at, w = 0.08) => Math.max(0, 1 - Math.abs(u - at) / w);

export function blankPose() {
  return { lean: 0, roll: 0, twist: 0, drop: 0, push: 0, side: 0, kneel: 0, lie: 0, lieUp: 0,
    gx: 0, gy: 0, gz: 0, groll: 0, gyaw: 0, gpitch: 0, hide: 0,
    lw: 0, lx: 0, ly: 0, lz: 0, rw: 0, rx: 0, ry: 0, rz: 0, head: 0 };
}
export function clearPose(o) {
  o.lean = o.roll = o.twist = o.drop = o.push = o.side = o.kneel = o.lie = o.lieUp = 0;
  o.gx = o.gy = o.gz = o.groll = o.gyaw = o.gpitch = o.hide = 0;
  o.lw = o.lx = o.ly = o.lz = o.rw = o.rx = o.ry = o.rz = o.head = 0;
  return o;
}

// The attacker stands FIN.stand (0.85 m) behind or over the target; the target's head is about 1.5 m up, its back at
// about x 0.85 in the attacker's body space.
const ATTACKER = {
  // Two stock blows to the back of the head, then a step back.
  lights(u, o) {
    const up1 = hold(u, 0.05, 0.25, 0.3, 0.38), up2 = hold(u, 0.4, 0.52, 0.58, 0.66);
    const hit = strike(u, 0.36) + strike(u, 0.64);
    const wind = Math.max(up1, up2) * (1 - hit);
    o.gpitch = wind * 1.1 - hit * 0.5; o.gy = wind * 0.32; o.gx = hit * 0.32 - wind * 0.08; o.groll = wind * 0.6;
    o.push = hit * 0.22 + seg(u, 0.05, 0.3) * 0.08 - seg(u, 0.8, 1) * 0.1;
    o.lean = hit * 0.25 + wind * -0.08;
    o.twist = wind * 0.35;
  },
  // Spin them by the collar, then a knee: the gun goes to the hip while both hands work.
  switchback(u, o) {
    const grab = hold(u, 0.05, 0.18, 0.5, 0.62), knee = hold(u, 0.48, 0.58, 0.64, 0.78);
    o.lw = grab; o.lx = 0.78; o.ly = 1.25; o.lz = -0.05;
    o.hide = hold(u, 0.05, 0.15, 0.75, 0.92) * 0.7;
    o.twist = -grab * 0.45 + knee * 0.2;
    o.lean = knee * 0.3 - grab * 0.05;
    o.push = knee * 0.25 + grab * 0.06;
    o.drop = -knee * 0.06;
    o.gy = -grab * 0.2;
  },
  // Hook the arm, turn the hip under them, throw, then a heel on the way down.
  coupling(u, o) {
    const grab = hold(u, 0.04, 0.16, 0.52, 0.64), throwK = hold(u, 0.25, 0.42, 0.5, 0.62), stomp = hold(u, 0.66, 0.76, 0.8, 0.92);
    o.lw = grab; o.lx = 0.7 - throwK * 0.4; o.ly = 1.2 + throwK * 0.3; o.lz = -0.2 - throwK * 0.3;
    o.hide = hold(u, 0.04, 0.12, 0.8, 0.95) * 0.75;
    o.twist = throwK * 1.2 - grab * 0.2;
    o.lean = throwK * 0.55 + stomp * 0.25;
    o.kneel = throwK * 0.35;
    o.push = grab * 0.12 - stomp * 0.05;
    o.drop = -stomp * 0.12;
  },
  // Both hands up, one hammer blow straight down.
  railspike(u, o) {
    const raise = hold(u, 0.05, 0.38, 0.46, 0.56), slam = hold(u, 0.46, 0.55, 0.72, 0.95);
    o.gy = raise * 0.75 - slam * 0.28; o.gpitch = raise * 1.5 - slam * 0.9; o.gx = -raise * 0.15 + slam * 0.35;
    o.lean = -raise * 0.18 + slam * 0.6; o.kneel = slam * 0.55;
    o.rw = 0; o.push = slam * 0.18;
    o.head = -raise * 0.3;
  },
  // A hand over the mouth from behind and a sharp twist.
  lastcall(u, o) {
    const grab = hold(u, 0.04, 0.22, 0.72, 0.86), snap = strike(u, 0.55, 0.06);
    o.lw = grab; o.lx = 0.82; o.ly = 1.48; o.lz = 0.05;
    o.hide = grab * 0.5;
    o.push = grab * 0.2;
    o.twist = -grab * 0.15 + snap * 0.5;
    o.lean = grab * 0.12;
    o.gy = -grab * 0.15;
  },
  // Both arms round the waist, lift clean off the ground, slam into the ballast.
  derail(u, o) {
    const grab = hold(u, 0.04, 0.16, 0.66, 0.8), lift = hold(u, 0.18, 0.42, 0.5, 0.6), slam = hold(u, 0.52, 0.62, 0.74, 0.92);
    o.hide = hold(u, 0.03, 0.12, 0.85, 0.98) * 0.9;
    o.lw = grab; o.lx = 0.72; o.ly = 1.0 + lift * 0.45 - slam * 0.5; o.lz = -0.18;
    o.rw = grab; o.rx = 0.72; o.ry = 1.0 + lift * 0.45 - slam * 0.5; o.rz = 0.18;
    o.lean = -lift * 0.25 + slam * 0.75; o.kneel = slam * 0.6 + grab * 0.1;
    o.push = grab * 0.3 + slam * 0.1;
    o.drop = -lift * 0.05;
  },
};

// The target. Standing targets go down face first (away from the attacker), except where the move turns them.
const TARGET = {
  lights(u, o) {
    const h1 = seg(u, 0.34, 0.42), h2 = seg(u, 0.62, 0.72);
    o.lean = h1 * 0.4 - h2 * 0.1; o.kneel = h1 * 0.7 * (1 - h2);
    o.lie = seg(u, 0.64, 0.92); o.head = h1 * 0.4;
    o.hide = h1;
  },
  switchback(u, o) {
    const spin = seg(u, 0.12, 0.42), knee = seg(u, 0.56, 0.66);
    o.twist = spin * Math.PI;         // Turned to face the attacker (the rig turns the whole body by twist).
    o.lean = -spin * 0.1 + knee * 0.65; o.kneel = knee * 0.8 * (1 - seg(u, 0.75, 0.9));
    o.push = knee * 0.15;
    o.lie = seg(u, 0.72, 0.95);
    o.hide = seg(u, 0.1, 0.3);
  },
  coupling(u, o) {
    const lift = hold(u, 0.3, 0.46, 0.5, 0.6), over = seg(u, 0.36, 0.6), stomp = strike(u, 0.78, 0.06);
    o.drop = -lift * 0.7;
    o.push = -over * 1.25;              // Over the attacker's hip: back past them onto the ground.
    o.side = -over * 0.45;
    o.lean = -over * 1.2;
    o.lie = seg(u, 0.5, 0.62); o.lieUp = 1;
    o.head = stomp * 0.6;
    o.hide = seg(u, 0.05, 0.2);
  },
  railspike(u, o) {
    const cower = seg(u, 0.05, 0.4), slam = seg(u, 0.54, 0.62);
    o.kneel = cower * 0.8 * (1 - slam); o.lean = cower * 0.2 + slam * 0.6;
    o.lie = seg(u, 0.56, 0.78); o.head = slam * 0.7;
    o.hide = seg(u, 0.1, 0.35);
  },
  lastcall(u, o) {
    const grab = seg(u, 0.1, 0.22), snap = seg(u, 0.54, 0.6);
    o.lean = -grab * 0.25 + snap * 0.15; o.push = -grab * 0.12;
    o.kneel = snap * 0.75 * (1 - seg(u, 0.72, 0.9));
    o.lie = seg(u, 0.74, 0.98);
    o.head = snap * 0.9;
    o.hide = snap;
  },
  derail(u, o) {
    const lift = hold(u, 0.18, 0.42, 0.52, 0.62), slam = seg(u, 0.54, 0.64);
    o.drop = -lift * 0.75;
    o.lean = -lift * 0.5 - slam * 0.8;
    o.push = -lift * 0.25 - slam * 0.35;
    o.lie = slam; o.lieUp = 1;
    o.head = slam * 0.5;
    o.hide = seg(u, 0.1, 0.3);
  },
};

// A downed target is already flat: it only jolts with each blow (the finisher's own `hits`).
const blowTimes = k => getFinisher(k).hits ?? [0.5];

// `role` 'a' or 'v', `u` 0..1 through a finisher of id `k`; `downed` for a target already down (it stays flat).
export function finPose(k, role, u, downed, o) {
  clearPose(o);
  if (role === 'a') {
    (ATTACKER[k] ?? ATTACKER.lights)(u, o);
    // Over a body on the ground every move bends down to it.
    if (downed) { o.lean += 0.35; o.kneel = Math.max(o.kneel, 0.45); o.lw *= 0.8; o.ly -= 0.7; o.ry -= 0.7; }
    return o;
  }
  if (downed) { o.head = blowTimes(k).reduce((m, t) => Math.max(m, strike(u, t, 0.06)), 0) * 0.6; return o; }
  (TARGET[k] ?? TARGET.lights)(u, o);
  return o;
}

// Emotes: `t` seconds in, `dur` long. Weighted in and out so they start and stop cleanly.
const EMOTE = {
  wave(t, o) { const s = Math.sin(t * 11); o.lw = 1; o.lx = 0.2; o.ly = 2.08; o.lz = -0.5 + s * 0.2; o.twist = -0.15; o.head = -0.1; },
  salute(t, o) { o.lw = 1; o.lx = 0.34; o.ly = 1.74; o.lz = -0.1; o.lean = -0.08; o.head = -0.12; },
  point(t, o) { o.lw = 1; o.lx = 1.15; o.ly = 1.5; o.lz = -0.35; o.twist = -0.35; o.lean = 0.06; },
  thumbs(t, o) { o.lw = 1; o.lx = 0.7; o.ly = 1.4 + Math.abs(Math.sin(t * 5)) * 0.06; o.lz = -0.2; o.head = 0.08; },
  laugh(t, o) { const b = Math.sin(t * 15); o.lean = -0.22 + b * 0.07; o.drop = Math.abs(b) * 0.03; o.lw = 1; o.lx = 0.3; o.ly = 0.98; o.lz = -0.05; o.head = -0.35 + b * 0.1; },
  shuffle(t, o) {
    const s = Math.sin(t * 4.2), b = Math.abs(Math.sin(t * 8.4));
    o.drop = b * 0.08; o.twist = s * 0.45; o.side = s * 0.16; o.roll = s * 0.08; o.lean = 0.05;
    o.lw = 1; o.lx = 0.42; o.ly = 1.25 + b * 0.18; o.lz = -0.35 - s * 0.12; o.gpitch = b * 0.2; o.head = s * 0.15;
  },
  taunt(t, o) { const c = Math.sin(t * 7) ** 2; o.lw = 1; o.lx = 0.75 - c * 0.3; o.ly = 1.3 + c * 0.08; o.lz = -0.18; o.lean = -0.1; o.head = -0.15; o.twist = -0.12; },
  turntable(t, o, dur) { const u = Math.min(1, t / dur); o.twist = sm(u) * Math.PI * 2; o.lw = 1; o.lx = 0.2; o.ly = 1.8; o.lz = -0.4; o.drop = Math.abs(Math.sin(t * 8)) * 0.05; },
};
const TARGETS = new Set(['lx', 'ly', 'lz', 'rx', 'ry', 'rz']);
export function emotePose(id, t, dur, o) {
  clearPose(o);
  const f = EMOTE[id];
  if (!f) return o;
  f(t, o, dur);
  o.gpitch -= 0.7; o.gy -= 0.15;      // The gun hangs muzzle down while the free hand talks.
  const w = Math.max(0, Math.min(1, t / 0.18, (dur - t) / 0.22));
  for (const k in o) if (!TARGETS.has(k)) o[k] *= w;
  return o;
}
