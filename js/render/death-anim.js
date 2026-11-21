// Deaths as a pose layer (ROADMAP item 62, docs/ANIMATION.md "Deaths"). A soldier killed where we can see them keeps
// their own body (operator, kit, Mastery suit, skin effects: all of it, since js/render/characters.js poses and draws it
// through the same meshes as the living) and falls: away from the shot, onto their face when hit from behind, sideways
// when hit from the side, straight down to the knees from a headshot, spun round by a melee blow, or thrown off their
// feet by a heavy round. Explosions still take a body apart (js/render/corpses.js), like the undead's gibs.
//
// The fall is authored as target curves over time; under-damped springs chase them (the same idea as the undead's
// limp-on-springs deaths in js/render/zm-bodies.js), so a body overshoots, bounces as it lands and settles. The output
// is the finisher pose shape (finisher-anim.js blankPose): lean, twist, kneel, lie, hand targets... `carry` 1 tells the
// rig the hand targets travel with the body's push. Everything writes into objects the rig owns: nothing is allocated.

const sm = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const seg = (t, a, b) => sm((t - a) / (b - a));
const strike = (t, at, w) => Math.max(0, 1 - Math.abs(t - at) / w);
const mix = (a, b, k) => a + (b - a) * k;

// Kinds. EXPLODE is not posed here: the rig is handed to Corpses and blown apart.
export const DIE = { BACK: 0, FRONT: 1, SIDE: 2, HEAD: 3, MELEE: 4, BLOWN: 5, DOWN: 6, FIN: 7, EXPLODE: 8 };
export const DIE_NAMES = ['back', 'front', 'side', 'head', 'melee', 'blown', 'down', 'fin', 'explode'];

// Seconds: falling and settling, lying still, then the dither fade.
export const DIE_LIE = 1.9, DIE_FADE = 0.55, DIE_LIFE = DIE_LIE + DIE_FADE;

// Spring channels on the rig (r.ds: positions then velocities).
const LEAN = 0, ROLL = 1, TWIST = 2, PUSH = 3, SIDE = 4, KNEEL = 5, LIE = 6, HEAD = 7, DROP = 8;
const LX = 9, LY = 10, LZ = 11, RX = 12, RY = 13, RZ = 14;
export const DIE_CH = 15;

const MELEE_IDS = new Set(['knife', 'bat']);     // The rest are told by their weapon definition (state.melee).

// Picks the fall. info: { dirX, dirZ, weapon, head, explosive }; aim the victim's facing; push the weapon's shove
// (corpses.js FORCE[0]); state: { downed, fin, calm, melee }. Returns a DIE kind; side (+1 / -1) lands in out.side.
export function pickDeath(info, aim, push, state, out) {
  const c = Math.cos(aim), s = Math.sin(aim);
  const fwd = info.dirX * c + info.dirZ * s;          // + pushed forward (shot from behind)
  const lat = -info.dirX * s + info.dirZ * c;         // + pushed to the right
  out.side = lat >= 0 ? 1 : -1;
  if (state.fin) return DIE.FIN;
  if (state.downed) return DIE.DOWN;
  if (info.explosive) return state.calm ? DIE.BACK : DIE.EXPLODE;
  if (state.melee || MELEE_IDS.has(info.weapon)) return push >= 15 && !state.calm ? DIE.BLOWN : DIE.MELEE;
  if (info.head) return DIE.HEAD;
  if (push >= 11 && fwd < 0.5 && !state.calm) return DIE.BLOWN;
  if (Math.abs(lat) > 0.72) return DIE.SIDE;
  return fwd > 0 ? DIE.FRONT : DIE.BACK;
}

// Target curves at t seconds since the death, into T (Float32Array(DIE_CH)). v: a 0..1 per-death variation; side +-1;
// dist how far a BLOWN body flies. Hand targets are in the body's own frame (x forward, y up, z right), from the ground.
function targets(kind, t, side, v, dist, T) {
  T.fill(0);
  let lieK = 0;
  switch (kind) {
    case DIE.BACK: {
      // A jolt back, the knees go, down onto the back; the arms fly up and out and land wide.
      const jolt = seg(t, 0, 0.1), buckle = seg(t, 0.12, 0.38), fall = seg(t, 0.28, 0.72);
      T[LEAN] = -0.35 * jolt * (1 - fall); T[HEAD] = -0.5 * jolt * (1 - fall) - 0.25 * strike(t, 0.74, 0.12);
      T[KNEEL] = 0.55 * buckle * (1 - fall); T[PUSH] = -0.18 * jolt - 0.42 * fall; T[ROLL] = side * 0.15 * jolt;
      lieK = fall;
      T[LX] = mix(0.15, -0.55 - v * 0.2, fall); T[LY] = mix(1.0 + 0.4 * jolt, 0.07, fall); T[LZ] = mix(-0.45, -0.7, fall);
      T[RX] = mix(0.2, -0.35 + v * 0.3, fall); T[RY] = mix(0.9 + 0.5 * jolt, 0.07, fall); T[RZ] = mix(0.45, 0.62 + v * 0.2, fall);
      T[LIE + 16] = 1;
      break;
    }
    case DIE.FRONT: {
      // Thrown forward: a stumble, a knee, flat on the face with the hands out to break it.
      const jolt = seg(t, 0, 0.12), buckle = seg(t, 0.12, 0.34), fall = seg(t, 0.26, 0.68);
      T[LEAN] = 0.55 * jolt * (1 - fall); T[HEAD] = 0.35 * jolt;
      T[KNEEL] = 0.6 * buckle * (1 - fall); T[PUSH] = 0.3 * jolt + 0.38 * fall; T[ROLL] = -side * 0.12 * jolt;
      lieK = fall;
      T[LX] = mix(0.55, 0.95 + v * 0.15, fall); T[LY] = mix(0.7, 0.07, fall); T[LZ] = mix(-0.32, -0.46, fall);
      T[RX] = mix(0.5, 0.7 - v * 0.3, fall); T[RY] = mix(0.75, 0.07, fall); T[RZ] = mix(0.3, 0.52, fall);
      break;
    }
    case DIE.SIDE: {
      // Spun half round by the hit, then down on the face the way it turned them: a fall to the side.
      const spin = seg(t, 0, 0.32), buckle = seg(t, 0.1, 0.34), fall = seg(t, 0.28, 0.72);
      T[TWIST] = -side * (1.25 + v * 0.35) * spin; T[ROLL] = side * 0.35 * spin * (1 - fall);
      T[SIDE] = side * 0.3 * spin; T[KNEEL] = 0.5 * buckle * (1 - fall); T[LEAN] = 0.3 * buckle * (1 - fall);
      T[PUSH] = 0.15 * fall; T[HEAD] = 0.3 * spin;
      lieK = fall;
      T[LX] = mix(0.1, 0.8, fall); T[LY] = mix(1.1, 0.07, fall); T[LZ] = mix(-0.6, -0.55, fall);
      T[RX] = mix(0.3, 0.35 + v * 0.4, fall); T[RY] = mix(0.5, 0.07, fall); T[RZ] = mix(0.35, 0.65, fall);
      break;
    }
    case DIE.HEAD: {
      // The head snaps back and the body drops where it stands, onto the knees, then folds forward onto the face.
      const snap = strike(t, 0.06, 0.1), drop = seg(t, 0.04, 0.24), fall = seg(t, 0.5, 0.86);
      T[HEAD] = -0.9 * snap + 0.45 * drop * (1 - fall); T[KNEEL] = drop * (1 - fall); T[LEAN] = -0.2 * snap + 0.35 * drop * (1 - fall);
      T[PUSH] = 0.25 * fall; T[ROLL] = side * 0.1 * drop;
      lieK = fall;
      T[LX] = mix(0.12, 0.6 + v * 0.3, fall); T[LY] = mix(0.42 - 0.2 * drop, 0.07, fall); T[LZ] = mix(-0.36, -0.5, fall);
      T[RX] = mix(0.16, 0.45, fall); T[RY] = mix(0.4 - 0.2 * drop, 0.07, fall); T[RZ] = mix(0.36, 0.48, fall);
      break;
    }
    case DIE.MELEE: {
      // Spun right round by the blow, a stagger, down onto the back.
      const spin = seg(t, 0, 0.5), buckle = seg(t, 0.25, 0.45), fall = seg(t, 0.4, 0.86);
      T[TWIST] = side * (2.4 + v * 0.6) * spin; T[ROLL] = -side * 0.3 * spin * (1 - fall);
      T[SIDE] = side * 0.35 * spin; T[KNEEL] = 0.6 * buckle * (1 - fall); T[LEAN] = -0.2 * spin * (1 - fall);
      T[PUSH] = -0.3 * fall; T[HEAD] = 0.5 * strike(t, 0.08, 0.12);
      lieK = fall;
      T[LX] = mix(0.3, -0.45, fall); T[LY] = mix(1.0, 0.07, fall); T[LZ] = mix(-0.75, -0.75, fall);
      T[RX] = mix(-0.1, -0.2, fall); T[RY] = mix(0.8, 0.07, fall); T[RZ] = mix(0.65, 0.7, fall);
      T[LIE + 16] = 1;
      break;
    }
    case DIE.BLOWN: {
      // Lifted off the feet and thrown back through the air, landing flat on the back a body length or two away.
      const fly = seg(t, 0, 0.5), arc = Math.sin(Math.PI * Math.min(1, t / 0.5));
      T[DROP] = -0.5 * arc; T[PUSH] = -dist * fly; T[LEAN] = -0.6 * seg(t, 0, 0.15) * (1 - fly);
      T[HEAD] = -0.6 * strike(t, 0.05, 0.1) - 0.2 * strike(t, 0.55, 0.1);
      lieK = seg(t, 0.04, 0.42);
      T[LX] = mix(-0.2, -0.75, fly); T[LY] = mix(1.3, 0.07, fly); T[LZ] = mix(-0.55, -0.6, fly);
      T[RX] = mix(-0.1, -0.6, fly); T[RY] = mix(1.4, 0.07, fly); T[RZ] = mix(0.55, 0.65, fly);
      T[LIE + 16] = 1;
      break;
    }
    case DIE.DOWN: default: {
      // Already on the ground (a downed crawl): a last shudder and the arms go out.
      lieK = 1;
      T[HEAD] = 0.3 * strike(t, 0.08, 0.12);
      T[LX] = 0.75; T[LY] = 0.07; T[LZ] = -0.55; T[RX] = 0.55 + v * 0.3; T[RY] = 0.07; T[RZ] = 0.5;
      break;
    }
  }
  T[LIE] = lieK;
}

// Scratch for the target curves: 15 channels, plus the on-the-back flag at LIE + 16 (index 22).
const _T = new Float32Array(32);

// Starts a death on rig state d (the rig's `die` object): springs from rest, the kind, its variation.
export function startDeath(d, kind, side, dist, calm) {
  d.kind = kind; d.side = side; d.dist = dist; d.t = 0; d.v = Math.random(); d.calm = calm ? 1 : 0;
  d.x.fill(0); d.vel.fill(0);
  if (kind === DIE.DOWN) d.x[LIE] = 1;
  // Hands start roughly where a carried gun holds them.
  d.x[LX] = 0.55; d.x[LY] = 1.15; d.x[LZ] = -0.1; d.x[RX] = 0.25; d.x[RY] = 1.05; d.x[RZ] = 0.2;
}

// Steps the springs dt and writes the pose layer into o (a finisher-anim.js pose object).
export function stepDeath(d, dt, o) {
  d.t += dt;
  targets(d.kind, d.t, d.side, d.v, d.dist, _T);
  // Under-damped (the overshoot and the bounce are the ragdoll); reduced motion settles them critically.
  const k = 130, c = d.calm ? 22.8 : 9 + Math.min(10, d.t * 5), kh = 95, ch = d.calm ? 19.5 : 6.5 + Math.min(10, d.t * 5);
  const x = d.x, v = d.vel, sub = dt > 1 / 45 ? 2 : 1, h = dt / sub;
  for (let s = 0; s < sub; s++) {
    for (let i = 0; i < DIE_CH; i++) {
      const kk = i >= LX ? kh : k, cc = i >= LX ? ch : c;
      v[i] += (-(x[i] - _T[i]) * kk - v[i] * cc) * h;
      x[i] += v[i] * h;
    }
  }
  // The lie overshoots a little into a bounce off the ground, never through it.
  if (x[LIE] > 1.06) { x[LIE] = 1.06; if (v[LIE] > 0) v[LIE] *= -0.3; }
  if (x[KNEEL] < 0) x[KNEEL] = 0;
  o.lean = x[LEAN]; o.roll = x[ROLL]; o.twist = x[TWIST]; o.push = x[PUSH]; o.side = x[SIDE];
  o.kneel = Math.min(1, x[KNEEL]); o.lie = Math.max(0, Math.min(1, x[LIE])); o.lieUp = _T[LIE + 16];
  o.head = x[HEAD]; o.drop = x[DROP];
  o.gx = o.gy = o.gz = o.groll = o.gyaw = o.gpitch = 0;
  o.hide = 1;
  o.lw = o.rw = 1;
  o.lx = x[LX]; o.ly = Math.max(0.05, x[LY]); o.lz = x[LZ];
  o.rx = x[RX]; o.ry = Math.max(0.05, x[RY]); o.rz = x[RZ];
  o.carry = 1;
  return o;
}

// The dither fade over the last DIE_FADE seconds.
export const deathFade = d => (d.t < DIE_LIE ? 1 : Math.max(0, 1 - (d.t - DIE_LIE) / DIE_FADE));
