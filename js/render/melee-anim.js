// Melee swings as gun-pose offsets (js/render/characters.js adds them to the held weapon's pose while a swing runs).
// One function per kind of swing; each reads u, 0..1 through the swing (a wind-up, a fast strike through the target,
// a slow recovery), and the side the swing comes from, and writes { x, y, yaw, pitch, roll } into a scratch object, so
// a swing allocates nothing.
//
//   slash     across the body, wide to one side and through to the other, alternating sides (Gaff, Bushwhack)
//   overhead  up over the shoulder and down in front (Maul, Kindling)
//   level     cocked behind the right shoulder, flat round at waist height, wrists rolling over (Slugger, Spade)
//   thrust    drawn back to the hip, then driven straight out along the aim, the blade flat (Kagero)
//   double    two short hooked cuts per pull, forehand then back (Gleaner: a two-round burst, a swing per round)
//   jab       a short spinning jab, the baton rolling round the forearm as it goes out (Nightstick)
// The Gaff, Slugger and Maul keep their old timings exactly.

const smooth01 = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

const KINDS = new Set(['slash', 'overhead', 'level', 'thrust', 'double', 'jab']);
export const swingKindOf = def => (KINDS.has(def?.swing) ? def.swing : 'slash');

// Seconds a swing's pose takes. The older three keep their numbers; the rest scale with the weapon's pace.
const DUR = { overhead: 0.62, level: 0.44, slash: 0.26, thrust: 0.34, double: 0.17, jab: 0.2 };
const OWN = { fireaxe: 0.5, shovel: 0.5, machete: 0.28 };
export const swingDurOf = def => OWN[def?.id] ?? DUR[swingKindOf(def)];

// Which side the next swing comes from: the one-sided kinds always 1, the rest alternate.
export function swingSideNext(def, side) {
  const k = swingKindOf(def);
  return k === 'overhead' || k === 'level' || k === 'thrust' ? 1 : -(side || 1);
}

export function swingPose(kind, u, side, o) {
  o.x = o.y = o.yaw = o.pitch = o.roll = 0;
  const wind = u < 0.32 ? smooth01(u / 0.32) : 1;
  const hit = u < 0.32 ? 0 : u < 0.5 ? smooth01((u - 0.32) / 0.18) : 1;
  const back = u < 0.5 ? 0 : smooth01((u - 0.5) / 0.5);
  switch (kind) {
    case 'overhead': {
      // Up over the shoulder, then down in front: the head travels an arc over the operator's head.
      const lift = wind * (1 - hit), drive = hit * (1 - back);
      o.pitch = lift * 1.9 - drive * 0.9; o.y = lift * 0.42 - drive * 0.1; o.x = -lift * 0.22 + drive * 0.2;
      o.yaw = lift * 0.5 - drive * 0.15; o.roll = lift * 0.25;
      break;
    }
    case 'level': {
      // A two-handed swing: cocked up behind the right shoulder, then flat round through the front at waist height and on
      // past the left side, the wrists rolling over in the follow-through.
      const cock = wind * (1 - hit), through = hit * (1 - back);
      o.yaw = cock * 1.7 - hit * 1.5 * (1 - back * 0.85); o.pitch = cock * 1.1 - through * 0.15;
      o.y = cock * 0.3 - through * 0.12; o.x = -cock * 0.16 + through * 0.18; o.roll = cock * 0.4 - through * 0.9;
      break;
    }
    case 'thrust': {
      // Back to the hip with the point up, then straight out along the aim, blade flat, and a slow draw back.
      const draw = wind * (1 - hit), drive = hit * (1 - back);
      o.x = -draw * 0.3 + drive * 0.55; o.y = -draw * 0.12 + drive * 0.06; o.pitch = draw * 0.45 - drive * 0.08;
      o.yaw = draw * 0.35 - drive * 0.05; o.roll = drive * 1.45 + draw * 0.2;
      break;
    }
    case 'double': {
      // A short hooked cut: the blade comes round from one side, tip first, and snaps back. Two of these per pull.
      const sweep = wind * (1 - hit) - hit * (1 - back);
      o.yaw = sweep * 1.0 * side; o.x = hit * (1 - back) * 0.2 - wind * (1 - hit) * 0.06;
      o.roll = sweep * 0.9 * side; o.pitch = -hit * (1 - back) * 0.35;
      break;
    }
    case 'jab': {
      // Out and back along the aim with a full turn of the baton round the forearm.
      const out = hit * (1 - back), cock = wind * (1 - hit);
      o.x = -cock * 0.12 + out * 0.42; o.y = out * 0.04; o.yaw = side * (cock * 0.3 - out * 0.12);
      o.roll = u * Math.PI * 2 * side; o.pitch = -out * 0.1;
      break;
    }
    default: {
      // Across the body, wide to one side and through to the other.
      const sweep = wind * (1 - hit) - hit * (1 - back);
      o.yaw = sweep * 1.25 * side; o.x = hit * (1 - back) * 0.14; o.roll = sweep * 0.5 * side;
    }
  }
  return o;
}
