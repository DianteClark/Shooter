// Graveyard Shift's undead bodies (ROADMAP item 50, docs/ZOMBIES.md "Bodies"): a model of its own per kind
// (js/render/zm-models.js), posed here every frame, drawn one call per kind on screen.
//
// Skinning without a skeleton: every body is twelve rigid bones. The CPU works out each bone's world matrix and writes
// it, three texels a bone, into one float texture (a row per drawn body); the vertex shader reads its bone's rows by
// gl_InstanceID. So a horde of 24 is ~8 draw calls (a kind each) and a few hundred matrix products a frame.
//
// What happens to a body:
//   rise      a fresh zombie claws up out of the ground (dirt, a dark ring) in about a second
//   walk      a gait per kind: the shambler's limp and lurch, the runner's sprint, the brute's knuckle swing, the
//             crawler dragging itself, the bloater's waddle, the Gravewarden's glide, the Listener's stilts
//   attack    the view's swing flag winds up a kind's attack (claws up, a two-fisted slam, the Spitter's throat
//             swelling, the Bloater swelling, a shield shove) and its end strikes
//   hit       dark ichor (no blood), per kind: acid on a Spitter, violet on a Bloater, frost off the Listener, sparks off
//             the Yardmaster's iron, splinters off a Shieldbearer's door; a flash and a flinch
//   die       the body topples away from the shot and goes limp on springs (ragdoll-ish), lies a moment, sinks.
//             A headshot takes the head off, an explosive or a melee kill a limb or three (gibs tumble and bounce);
//             a Bloater bursts; a Shieldbearer drops its door
// Bosses (the Yardmaster, the Gravewarden, the Listener, the Barker) start the intro (js/ui/zm-intro.js) when they rise.
import * as THREE from 'three';
import { GLSL_DITHER } from './art.js';
import { ZM_MODELS, ZM_MATTER, NB, PEL, CH, HD, UAL, FAL, UAR, FAR, THL, SHL, THR, SHR, EX, buildModel } from './zm-models.js';
import { ZM_INTRO } from '../ui/zm-intro.js';

const ROWS = 80;                 // Bodies drawn at once: 24 up, the dying, the gibs.
const TW = NB * 3 + 2;           // Texels a row: three per bone, then fx (fade, flash, glow, lite) and tint (rgb, k).
const NCH = 30;                  // Pose channels (see pose()).
const RISE = 1.05, STRIKE = 0.32, LIE = 2.4, SINK = 0.8, GIB_LIFE = 3.2;
const BOSS = new Set([4, 5, 11, 12, 13]);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, k) => a + (b - a) * k;
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (k, dt) => 1 - Math.exp(-k * dt);

// Pose channels. Angles in radians; "pitch" turns about the bone's Z (a limb forward), "out" about X (a limb away
// from the body, signed per side in bones()), "yaw" about Y.
const C = {
  HIPY: 0, PPITCH: 1, PROLL: 2, PYAW: 3, CPITCH: 4, CROLL: 5, CYAW: 6, HPITCH: 7, HROLL: 8, HYAW: 9,
  LAP: 10, LAO: 11, LAT: 12, LFA: 13, RAP: 14, RAO: 15, RAT: 16, RFA: 17,
  LTP: 18, LTO: 19, LSH: 20, RTP: 21, RTO: 22, RSH: 23, EXS: 24, EXP: 25, RPITCH: 26, RROLL: 27, RFWD: 28, RY: 29,
};

const VERT = /* glsl */`
uniform sampler2D uBones;
uniform float uBase;
uniform float uTime;
attribute vec3 aCol;
attribute float aPart;
varying vec3 vCol;
varying vec2 vFx;
#include <sw_light>
vec4 bt(int x, int row) { return texelFetch(uBones, ivec2(x, row), 0); }
void main() {
  float p = aPart;
  float fine = step(63.5, p); p -= fine * 64.0;
  float glow = floor(p / 16.0 + 0.001);
  int bone = int(p - glow * 16.0 + 0.5);
  int row = int(uBase + 0.5) + gl_InstanceID;
  vec4 fx = bt(${NB * 3}, row), tint = bt(${NB * 3 + 1}, row);
  if (fine > 0.5 && fx.w > 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vCol = vec3(0.0); vFx = vec2(0.0); return; }
  vec4 r0 = bt(bone * 3, row), r1 = bt(bone * 3 + 1, row), r2 = bt(bone * 3 + 2, row);
  vec4 P = vec4(position, 1.0);
  vec3 wp = vec3(dot(r0, P), dot(r1, P), dot(r2, P));
  vec3 n = normalize(vec3(dot(r0.xyz, normal), dot(r1.xyz, normal), dot(r2.xyz, normal)) + vec3(0.0, 1e-5, 0.0));
  vec3 light = duskLight(n);
  vec3 base = mix(aCol, tint.rgb, tint.a);
  vec3 c = base * light;
  if (glow > 0.5) {
    // 1 eyes, steady; 2 a slow pulse (pustules, a throat sac, a radio); 3 a flame's flicker. fx.z scales them (dim in
    // death, brighter while a Bloater swells).
    float k = glow > 2.5 ? 0.8 + 0.25 * sin(uTime * 17.0 + wp.x * 5.0) * sin(uTime * 6.3 + wp.z * 3.0)
            : glow > 1.5 ? 0.75 + 0.45 * sin(uTime * 4.2 + position.y * 9.0 + position.z * 7.0) : 1.0;
    c = mix(c, aCol * 1.5 * k, clamp(fx.z, 0.0, 1.0)) + aCol * max(0.0, fx.z - 1.0) * 0.8;
  }
  vCol = c;
  vFx = fx.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const FRAG = /* glsl */`
varying vec3 vCol;
varying vec2 vFx;
${GLSL_DITHER}
void main() {
  if (vFx.x < 0.999 && vFx.x < screenDither(gl_FragCoord.xy)) discard;
  gl_FragColor = vec4(vCol + vFx.y * vec3(0.9, 0.95, 0.85), 1.0);
}`;

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _ax = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const ICHOR_SPLAT = [0.05, 0.06, 0.04], DIRT = [0.22, 0.18, 0.13], DIRT_D = [0.08, 0.07, 0.05], WOOD = [0.42, 0.29, 0.17], SPARK = [1, 0.82, 0.5];

// M = parent x T(x, y, z) x R(yaw, roll, pitch) x S(s).
function link(out, parent, x, y, z, rx, ry, rz, s = 1, sy = s) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _v.set(x, y, z); _s.set(s, sy, s);
  _m.compose(_v, _q, _s);
  return out.multiplyMatrices(parent, _m);
}

// The twelve bones' world matrices from a pose (A) and a root.
function bones(def, A, root, M) {
  const d = def.dims, ex = d.ex;
  link(M[PEL], root, 0, d.hip + A[C.HIPY], 0, A[C.PROLL], A[C.PYAW], A[C.PPITCH]);
  link(M[CH], M[PEL], 0, d.waist, 0, A[C.CROLL], A[C.CYAW], A[C.CPITCH]);
  link(M[HD], M[CH], d.headX ?? 0, d.chest + (d.neck ?? 0) + (d.headY ?? 0), 0, A[C.HROLL], A[C.HYAW], A[C.HPITCH]);
  link(M[UAL], M[CH], 0, d.chest - 0.05, -d.shW, A[C.LAO], A[C.LAT], A[C.LAP]);
  link(M[FAL], M[UAL], 0, -d.ua, 0, 0, 0, A[C.LFA]);
  link(M[UAR], M[CH], 0, d.chest - 0.05, d.shW, -A[C.RAO], -A[C.RAT], A[C.RAP]);
  link(M[FAR], M[UAR], 0, -d.ua, 0, 0, 0, A[C.RFA]);
  link(M[THL], M[PEL], 0, 0, -d.hipW, A[C.LTO], 0, A[C.LTP]);
  link(M[SHL], M[THL], 0, -d.th, 0, 0, 0, A[C.LSH]);
  link(M[THR], M[PEL], 0, 0, d.hipW, -A[C.RTO], 0, A[C.RTP]);
  link(M[SHR], M[THR], 0, -d.th, 0, 0, 0, A[C.RSH]);
  if (ex) link(M[EX], M[ex.parent], ex.at[0], ex.at[1], ex.at[2], 0, 0, A[C.EXP], A[C.EXS]);
  else M[EX].copy(ZERO);
}

// The root: feet on the ground at (x, y, z), facing aim, leant by the pose, scaled to the kind, toppled by `fall`.
function rootOf(out, def, x, y, z, aim, A, fall) {
  _v.set(x, y + A[C.RY], z);
  _e.set(A[C.RROLL], -aim, A[C.RPITCH], 'YXZ'); _q.setFromEuler(_e);
  if (fall) _q.premultiply(fall);
  const s = def.dims.s;
  _s.set(s, s, s);
  out.compose(_v, _q, _s);
  if (A[C.RFWD]) { _r.makeTranslation(A[C.RFWD] / s, 0, 0); out.multiply(_r); }
  return out;
}

// A living zombie's pose for this frame (kind, gait, attack, rise, flinch) into st.A.
function pose(st, def, t, dt) {
  const g = def.gait, A = st.A, d = def.dims;
  A.fill(0); A[C.EXS] = 1;
  const run = clamp(st.speed / (g.crawl ? 2.6 : g.stride > 2 ? 4.6 : 2.4), 0, 1);
  const ph = st.phase, seed = st.seed, side = seed > 50 ? 1 : -1;
  const sL = Math.sin(ph), sR = -sL, cL = Math.cos(ph), cR = -cL;
  const idle = Math.sin(t * 1.4 + seed) * (1 - run);
  const tw = (g.twitch ?? 0) * Math.sin(t * 11 + seed) * Math.max(0, Math.sin(t * 2.3 + seed * 3));
  const hunch = g.hunch ?? 0.3;
  // Windup (the view's swing flag) and the strike after it.
  const w = st.strikeT >= 0 ? Math.max(0, 1 - st.strikeT / STRIKE * 2.5) : sstep(0, 0.3, st.windT);
  const k = st.strikeT >= 0 ? Math.sin(Math.PI * Math.min(1, st.strikeT / STRIKE)) : 0;

  if (g.crawl) {
    // On its belly, propped on its arms: the torso flat, the head craned up, the arms reaching and pulling in turn.
    A[C.PPITCH] = -1.42 + 0.05 * Math.sin(ph * 2);
    A[C.PROLL] = 0.13 * Math.sin(ph) * run + idle * 0.03;
    A[C.HIPY] = -0.02 * Math.abs(Math.sin(ph)) * run + idle * 0.01;
    A[C.CPITCH] = 0.08; A[C.CROLL] = -0.08 * Math.sin(ph) * run;
    A[C.HPITCH] = 1.2 + 0.08 * Math.sin(ph * 2) + tw * 0.1; A[C.HROLL] = tw * 0.12 + idle * 0.05;
    const reach = 0.5 * Math.max(run, 0.25);
    A[C.LAP] = 1.75 + reach * Math.sin(ph); A[C.RAP] = 1.75 + reach * Math.sin(ph + Math.PI);
    A[C.LAO] = A[C.RAO] = 0.6;
    A[C.LFA] = 0.45 + 0.6 * Math.max(0, -Math.cos(ph)); A[C.RFA] = 0.45 + 0.6 * Math.max(0, Math.cos(ph));
    A[C.LTP] = -0.15 + 0.1 * Math.sin(ph * 0.5); A[C.RTP] = -0.1 - 0.08 * Math.sin(ph * 0.5);
    A[C.LTO] = A[C.RTO] = 0.12;
    A[C.EXP] = 0.15 * Math.sin(ph * 1.5 + 1);
    // Lunge: the front of it rears, the claws come up and slam.
    A[C.PPITCH] += 0.55 * w - 0.2 * k; A[C.LAP] += 0.9 * w - 0.8 * k; A[C.RAP] += 0.9 * w - 0.8 * k; A[C.RFWD] += 0.35 * k;
  } else {
    const limp = g.limp ?? 0, sw = g.swing ?? 0.4;
    // Legs: the thighs swing, a knee folds while its leg comes through; a limp drags the right leg.
    A[C.LTP] = sw * run * sL; A[C.RTP] = sw * run * sR * (1 - limp * 0.55);
    A[C.LSH] = -0.06 - (g.knee ?? 0.7) * run * Math.max(0, cL); A[C.RSH] = -0.06 - (g.knee ?? 0.7) * run * Math.max(0, cR) * (1 - limp * 0.6);
    A[C.LTO] = A[C.RTO] = g.waddle ? 0.2 : 0.04;
    A[C.HIPY] = -(g.bob ?? 0.05) * run * Math.abs(sL) - limp * 0.05 * run * Math.max(0, sR) + idle * 0.01;
    // The body rolls over the stance leg (a lurch), the pelvis turns with the stride, the chest counters both.
    const roll = (g.lurch ?? 0.1) * Math.max(run, 0.2) * sL;
    A[C.PROLL] = roll + idle * 0.02; A[C.PYAW] = 0.12 * run * sL;
    A[C.CPITCH] = -(hunch + 0.18 * run) - 0.05 * run * Math.cos(ph * 2) + idle * 0.03;
    A[C.CROLL] = -roll * 0.55; A[C.CYAW] = -A[C.PYAW] * 1.4;
    A[C.HPITCH] = hunch * 0.65 + 0.04 * Math.cos(ph * 2) * run + tw * 0.08;
    A[C.HROLL] = (g.headTilt ?? 0) * side + tw * 0.15 + idle * 0.04; A[C.HYAW] = tw * 0.1;
    // Arms hang (squared up against the hunch) and counter-swing; each kind's own carriage on top.
    const hang = hunch + 0.18 * run;
    A[C.LAP] = hang + 0.3 * run * sR; A[C.RAP] = hang + 0.3 * run * sL;
    A[C.LAO] = A[C.RAO] = 0.12; A[C.LFA] = A[C.RFA] = 0.25;
    if (g.reach) {
      // One arm out in front, groping; the other dangling.
      A[C.RAP] = hang + 1.2 + 0.08 * Math.sin(t * 2 + seed) + 0.08 * run * sL; A[C.RFA] = 0.25; A[C.RAO] = -0.02;
      A[C.LAP] = hang + 0.1 + 0.35 * run * sR; A[C.LFA] = 0.15;
    }
    if (g.pump) {
      // Sprinting: elbows bent, the arms pumping hard; slower, both arms come up and out in front.
      const pump = run;
      A[C.LAP] = lerp(hang + 1.1, hang - 0.1 + 1.0 * sR, pump); A[C.RAP] = lerp(hang + 1.15, hang - 0.1 + 1.0 * sL, pump);
      A[C.LFA] = A[C.RFA] = lerp(0.3, 1.45, pump);
      A[C.CPITCH] -= 0.25 * run; A[C.HPITCH] += 0.25 * run;
    }
    if (g.heavy) {
      // Arms like sacks, swinging wide off the shoulders; the head sunk; every step lands.
      A[C.LAP] = hang + 0.35 * run * sR; A[C.RAP] = hang + 0.35 * run * sL;
      A[C.LAO] = A[C.RAO] = 0.28; A[C.LFA] = A[C.RFA] = 0.35;
      A[C.PROLL] *= 1.4; A[C.HIPY] -= 0.04 * run * Math.abs(Math.cos(ph));
    }
    if (g.waddle) {
      // Arms held out from the belly, the whole body rocking side to side; the belly breathes and bounces.
      A[C.LAO] = A[C.RAO] = 0.75; A[C.LAP] = A[C.RAP] = 0.5; A[C.LFA] = A[C.RFA] = 0.6;
      A[C.PROLL] = 0.2 * Math.max(run, 0.3) * sL;
      A[C.EXS] = 1 + 0.04 * Math.sin(t * 2.4 + seed) + 0.03 * run * Math.abs(cL);
      A[C.EXP] = 0.04 * run * Math.sin(ph * 2);
    }
    if (g.spit) {
      // Head craned forward on the long neck, the sac under it breathing.
      A[C.HPITCH] = hunch * 0.85; A[C.EXS] = 1 + 0.07 * Math.sin(t * 3.1 + seed);
    }
    if (g.shield) {
      // The left arm braced behind the door.
      A[C.LAP] = hang + 0.95; A[C.LFA] = 0.75; A[C.LAO] = 0.05; A[C.LAT] = -0.3;
      A[C.EXP] = -A[C.CPITCH] * 0.9;
    }
    if (g.glide) {
      // The Gravewarden barely lifts its feet: the robe sways; the lantern held out on its chain, the spade low.
      A[C.LAP] = hang + 0.85; A[C.LFA] = 0.55;
      A[C.RAP] = hang + 0.3 + 0.1 * run * sL; A[C.RFA] = 0.6; A[C.RAT] = 0.4;
      A[C.EXP] = -(A[C.CPITCH] + A[C.LAP] + A[C.LFA]) + 0.25 * Math.sin(t * 2.2 + seed) + 0.2 * run * Math.sin(ph);
    }
    if (g.ferry) {
      // The Ferryman walks with its pole: planted ahead of it, the bell held out low on its chain in the other hand.
      A[C.RAP] = hang + 0.45 + 0.12 * run * sL; A[C.RFA] = 0.5; A[C.RAT] = 0.2; A[C.RAO] = 0.2;
      A[C.LAP] = hang + 0.6; A[C.LFA] = 0.4; A[C.LAO] = 0.25;
      A[C.EXP] = -(A[C.CPITCH] + A[C.LAP] + A[C.LFA]) + 0.3 * Math.sin(t * 1.8 + seed) + 0.2 * run * Math.sin(ph);
    }
    if (g.strut) {
      // The Barker struts: chest out, the trumpet arm swinging high, the free arm held out for the crowd; its tails flap.
      A[C.CPITCH] = -(hunch + 0.1 * run) + 0.06; A[C.HPITCH] = 0.1 + 0.08 * Math.cos(ph * 2) * run;
      A[C.RAP] = hang + 0.55 + 0.35 * run * sL; A[C.RFA] = 0.7;
      A[C.LAP] = hang + 0.25 + 0.3 * run * sR; A[C.LAO] = 0.45 + 0.1 * Math.sin(t * 1.7 + seed); A[C.LFA] = 0.45;
      A[C.EXP] = -0.2 * run - 0.12 * run * Math.abs(Math.sin(ph)) + 0.05 * Math.sin(t * 3);
    }
    if (g.stilt) {
      // The Listener: long slow strides, the head cocked and turning, scanning; arms dangling to its knees.
      A[C.HYAW] = 0.45 * Math.sin(t * 0.7 + seed); A[C.HROLL] = 0.42 * Math.sin(t * 0.35 + seed) + tw * 0.2;
      A[C.LAP] = hang + 0.05 + 0.2 * run * sR; A[C.RAP] = hang + 0.05 + 0.2 * run * sL;
      A[C.LFA] = A[C.RFA] = 0.15; A[C.LAO] = A[C.RAO] = 0.16;
      A[C.EXP] = -A[C.CPITCH] * 0.8 - 0.25 * run * Math.sin(ph * 2) + 0.06 * Math.sin(t * 5);
    }
    // The Barker's lane ('zcharge'): the trumpet up to its painted mouth while the lane is marked, then the run.
    if (g.strut && st.callT >= 0) {
      const wind = st.callT < st.callWind, kk = wind ? sstep(0, 0.25, st.callT) : 1 - sstep(0, 0.2, st.callT - st.callWind - st.callDash);
      if (wind) { A[C.RAP] = lerp(A[C.RAP], hang + 1.75, kk); A[C.RFA] = lerp(A[C.RFA], 1.75, kk); A[C.CPITCH] += 0.3 * kk; A[C.HPITCH] += 0.25 * kk; A[C.LAO] += 0.5 * kk; }
      else { A[C.CPITCH] -= 0.55 * kk; A[C.HPITCH] += 0.4 * kk; A[C.LAP] -= 0.8 * kk; A[C.RAP] -= 0.6 * kk; A[C.LFA] += 0.6 * kk; A[C.RFA] += 0.6 * kk; A[C.EXP] -= 0.5 * kk; }
    }
    // Attacks.
    if (w > 0 || k > 0) {
      if (g.strut) {
        // A backhand with the trumpet.
        A[C.RAP] = lerp(lerp(A[C.RAP], hang + 2.2, w), hang + 0.4, k); A[C.RAT] = lerp(0, 0.8, w) - 0.8 * k;
        A[C.CYAW] += 0.4 * w - 0.6 * k; A[C.CPITCH] += 0.2 * w - 0.35 * k;
      } else if (g.heavy || (g.boss && !g.stilt && !g.glide)) {
        // Both fists (or the fist and the spike) overhead, then slammed down.
        A[C.LAP] = lerp(lerp(A[C.LAP], hang + 2.9, w), hang + 0.5, k); A[C.RAP] = lerp(lerp(A[C.RAP], hang + 2.9, w), hang + 0.5, k);
        A[C.LFA] = lerp(A[C.LFA], 0.7, w); A[C.RFA] = lerp(A[C.RFA], 0.7, w);
        A[C.CPITCH] += 0.4 * w - 0.75 * k; A[C.HIPY] -= 0.12 * k; A[C.RFWD] += 0.15 * k;
      } else if (g.spit) {
        // Head back, the throat swelling green; then the head snaps forward and the sac empties.
        A[C.HPITCH] += 0.8 * w - 0.5 * k; A[C.CPITCH] += 0.3 * w - 0.35 * k;
        A[C.EXS] = 1 + 0.75 * w + 0.06 * Math.sin(t * 30) * w;
        A[C.LAP] += 0.5 * w; A[C.RAP] += 0.5 * w;
      } else if (g.waddle) {
        // Swelling to burst: the belly inflates and shudders, the arms flung up.
        A[C.EXS] *= 1 + 0.32 * w + 0.05 * Math.sin(t * 38) * w;
        A[C.PROLL] += 0.08 * Math.sin(t * 31) * w; A[C.LAP] += 1.1 * w; A[C.RAP] += 1.1 * w;
      } else if (g.shield) {
        // Draws back behind the door, then shoves it.
        A[C.CYAW] += 0.35 * w - 0.3 * k; A[C.CPITCH] += 0.15 * w - 0.35 * k; A[C.RFWD] += 0.35 * k - 0.1 * w;
        A[C.RAP] = lerp(A[C.RAP], hang + 2.2, w * (1 - k)) + 0.9 * k;
      } else if (g.glide) {
        // The spade comes up over the shoulder and down.
        A[C.RAP] = lerp(lerp(A[C.RAP], hang + 2.7, w), hang + 0.5, k); A[C.RFA] = lerp(A[C.RFA], 0.2, w);
        A[C.CPITCH] += 0.3 * w - 0.5 * k; A[C.CYAW] += 0.3 * w - 0.4 * k;
      } else if (g.stilt) {
        // Arms spread wide, then they close.
        A[C.LAO] = lerp(A[C.LAO], 1.35, w * (1 - k)); A[C.RAO] = lerp(A[C.RAO], 1.35, w * (1 - k));
        A[C.LAP] += 1.2 * w + 0.4 * k; A[C.RAP] += 1.2 * w + 0.4 * k; A[C.HPITCH] += 0.5 * w;
      } else {
        // Claws up, then raked down through the target, the body lunging after them.
        A[C.LAP] = lerp(lerp(A[C.LAP], hang + 2.1, w), hang + 0.6, k); A[C.RAP] = lerp(lerp(A[C.RAP], hang + 2.2, w), hang + 0.6, k);
        A[C.LFA] = lerp(A[C.LFA], 0.15, w) + 0.4 * k; A[C.RFA] = lerp(A[C.RFA], 0.15, w) + 0.4 * k;
        A[C.LAO] += 0.25 * w; A[C.RAO] += 0.25 * w;
        A[C.CPITCH] += 0.25 * w - 0.32 * k; A[C.RFWD] += 0.18 * k; A[C.HPITCH] += 0.2 * w + 0.2 * k;
      }
    }
  }
  // A hit: the chest and head thrown back or aside on a spring.
  A[C.CPITCH] += st.ff; A[C.CROLL] += st.fs; A[C.HPITCH] += st.ff * 0.7; A[C.HROLL] += st.fs * 0.6;
  // The Ferryman's undertow ('zdive'): it sinks into the flood, arms raised; under, nothing shows; then it bursts up
  // beneath its mark, pole first.
  if (st.diveT >= 0) {
    const deep = (d.hip + d.waist + d.chest + d.neck + 0.5) * d.s;
    const sink = st.diveSink, warn = st.diveWarn, u = st.diveT;
    const under = u < sink ? sstep(0, sink, u) : u < warn ? 1 : 1 - sstep(warn, warn + 0.45, u);
    A[C.RY] -= under * deep;
    A[C.LAP] = lerp(A[C.LAP], hunch + 2.6, under); A[C.RAP] = lerp(A[C.RAP], hunch + 2.9, under);
    A[C.CPITCH] -= 0.3 * under; A[C.HPITCH] -= 0.3 * under;
  }
  // Rising: from under the ground, reaching up out of it, the body tipped back.
  if (st.riseT < 1) {
    // The hands break the surface first, then the head, then it hauls itself out.
    const u = st.riseT, e = sstep(0.04, 0.9, u) * 0.88 + sstep(0.0, 0.25, u) * 0.12, up = 1 - sstep(0.6, 1, u);
    const deep = (d.hip + d.waist + d.chest + 0.3) * (g.crawl ? 0.7 : 1);
    A[C.RY] = -(1 - e) * deep * d.s;
    A[C.LAP] = lerp(A[C.LAP], hunch + 2.75 + 0.2 * Math.sin(t * 9), up); A[C.RAP] = lerp(A[C.RAP], hunch + 2.6 + 0.2 * Math.sin(t * 9 + 1), up);
    A[C.LFA] = lerp(A[C.LFA], 0.4, up); A[C.RFA] = lerp(A[C.RFA], 0.4, up);
    A[C.RPITCH] += 0.35 * (1 - e); A[C.HPITCH] += 0.4 * up;
  }
}

// ---------------------------------------------------------------------------------------------------------------

class Body {
  constructor(id) {
    this.id = id; this.zk = 0; this.alive = false; this.seen = false;
    this.x = 0; this.z = 0; this.aim = 0; this.speed = 0; this.phase = 0; this.seed = Math.random() * 100;
    this.flash = 0; this.ff = 0; this.fv = 0; this.fs = 0; this.fsv = 0;
    this.windT = 0; this.strikeT = -1; this.swing = false; this.riseT = 1; this.dirtT = 0;
    this.goneT = -1; this.shield = false; this.lite = false; this.dead = false; this.deadT = 0;
    this.callT = -1; this.callWind = 1.1; this.callDash = 0.45;
    this.diveT = -1; this.diveSink = 0.6; this.diveWarn = 1.7;
    this.A = new Float32Array(NCH);
    this.root = new THREE.Matrix4();
    this.M = Array.from({ length: NB }, () => new THREE.Matrix4());
  }
}

class Corpse {
  constructor() {
    this.A = new Float32Array(NCH); this.V = new Float32Array(NCH); this.T = new Float32Array(NCH);
    this.fall = new THREE.Quaternion(); this.root = new THREE.Matrix4();
    this.M = Array.from({ length: NB }, () => new THREE.Matrix4());
    this.on = false;
  }
}

class Gib {
  constructor() {
    this.M0 = Array.from({ length: NB }, () => new THREE.Matrix4());
    this.c0 = new THREE.Vector3(); this.c = new THREE.Vector3(); this.v = new THREE.Vector3(); this.axis = new THREE.Vector3();
    this.q = new THREE.Quaternion(); this.on = false;
    this.M = Array.from({ length: NB }, () => new THREE.Matrix4());
  }
}

export class ZmBodies {
  constructor(scene, vfx) {
    this.scene = scene; this.vfx = vfx;
    this.t = 0; this.ready = false;
    this.data = new Float32Array(TW * ROWS * 4);
    this.tex = new THREE.DataTexture(this.data, TW, ROWS, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.texU = { value: this.tex }; this.timeU = { value: 0 };
    this.meshes = new Map();          // zk -> Mesh (built the first time a kind shows)
    this.bodies = new Map();          // seat id -> Body
    this.corpses = Array.from({ length: 16 }, () => new Corpse());
    this.gibs = Array.from({ length: 18 }, () => new Gib());
    this.limit = 12;                  // Bodies lying at once (the quality step's corpse count).
    this.lists = new Map();           // zk -> draw list this frame
    this.drawn = 0;                   // Rows written last frame (dev/tests).
    this.introSeen = new Set();
  }

  _mesh(zk) {
    let m = this.meshes.get(zk);
    if (m) return m;
    const g = buildModel(zk), ig = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'normal', 'aCol', 'aPart']) ig.setAttribute(k, g.getAttribute(k));
    ig.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uBones: this.texU, uTime: this.timeU, uBase: { value: 0 } } });
    m = new THREE.Mesh(ig, mat);
    m.frustumCulled = false; m.visible = false; m.renderOrder = 1;
    m.userData.tris = g.getAttribute('position').count / 3;
    this.scene.add(m);
    this.meshes.set(zk, m);
    return m;
  }

  _body(id) { let b = this.bodies.get(id); if (!b) { b = new Body(id); this.bodies.set(id, b); } return b; }

  // A hit landed on a zombie (the renderer's 'hit' event): flash, flinch, and what flies off it.
  onHit(ev, r, dx, dz) {
    const b = this.bodies.get(ev.target);
    const zk = b?.zk || r.zk, def = ZM_MODELS[zk];
    if (!def) return;
    const s = def.dims.s, strength = Math.min(1, (ev.dmg || 25) / 40);
    if (b) {
      b.flash = 1;
      const c = Math.cos(b.aim), sn = Math.sin(b.aim);
      b.fv += (dx * c + dz * sn) * 5 * strength / (BOSS.has(zk) ? 3 : 1);
      b.fsv += (-dx * sn + dz * c) * 5 * strength / (BOSS.has(zk) ? 3 : 1);
    }
    const crawl = zk === 8, y = crawl ? 0.5 : (ev.head ? (def.dims.hip + def.dims.waist + def.dims.chest + 0.15) : (def.dims.hip + def.dims.waist + 0.25)) * s;
    this._ichor(ev.x, y, ev.z, dx, dz, zk, 1 + strength);
  }

  // Dark ichor flung along the shot, with each kind's own matter (acid, violet, frost, sparks off iron).
  _ichor(x, y, z, dx, dz, zk, k = 1) {
    const vfx = this.vfx, M = ZM_MATTER[zk] ?? ZM_MATTER[1];
    if (!vfx) return;
    const n = vfx._n(Math.round(5 * k * (M.heavy ? 1.4 : 1)));
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dz, dx) + rand(-0.8, 0.8), sp = rand(1.5, 4.5);
      vfx.spawn(x, y, z, Math.cos(a) * sp, rand(0.5, 3), Math.sin(a) * sp, rand(0.35, 0.6), rand(0.07, 0.12), 0.03, M.ichor, 1, 14, 1.5, 0.02);
    }
    vfx.spawn(x, y, z, dx * 0.6, 0.3, dz * 0.6, 0.25, 0.18, 0.4, M.ichor, 1, 0, 3);
    if (M.glow) vfx.sparks(x, y, z, dx, dz, M.glow, vfx._n(Math.round(3 * k)), 6);
    if (M.frost) for (let i = vfx._n(Math.round(2 * k)); i > 0; i--) vfx.shard(x, y, z, dx * rand(2, 5) + rand(-1.5, 1.5), rand(2, 5), dz * rand(2, 5) + rand(-1.5, 1.5), M.frost, rand(0.4, 0.7));
    if (M.spark && Math.random() < 0.5) vfx.sparks(x, y + 0.3, z, -dx, -dz, M.spark, vfx._n(4), 11);
  }

  // A Shieldbearer's door takes a round (or breaks: it falls off in pieces).
  onShield(ev) {
    const vfx = this.vfx;
    if (!vfx) return;
    const b = this.bodies.get(ev.id);
    const ax = b ? Math.cos(b.aim) : 1, az = b ? Math.sin(b.aim) : 0;
    const x = ev.x + ax * 0.6, z = ev.z + az * 0.6, y = 1.1;
    for (let i = vfx._n(ev.broke ? 14 : 5); i > 0; i--) {
      const a = Math.atan2(az, ax) + rand(-1, 1), sp = rand(2, ev.broke ? 7 : 4);
      vfx.spawn(x, y + rand(-0.4, 0.4), z, Math.cos(a) * sp, rand(1, 4), Math.sin(a) * sp, rand(0.4, 0.8), rand(0.05, 0.1), 0.03, WOOD, 1, 16, 1.2, 0.03);
    }
    vfx.sparks(x, y, z, ax, az, SPARK, vfx._n(ev.broke ? 8 : 3), 10);
    if (ev.broke && b && b.zk === 9 && b.seen) this._gib(9, b.M, 1 << EX, ax * 2.5, 2.5, az * 2.5);
  }

  // The Barker marks its lane ('zcharge', js/sim/zm-fair.js): whoever of the Barkers stands at its start.
  onCharge(ev) {
    let best = null, bd = 3;
    for (const b of this.bodies.values()) {
      if (!b.alive || b.zk !== 12) continue;
      const d = Math.hypot(b.x - ev.x, b.z - ev.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { best.callT = 0; best.callWind = ev.wind ?? 1.1; best.callDash = ev.dash ?? 0.45; }
  }

  // The Ferryman goes under ('zdive', js/sim/zm-abbey.js): whichever Ferryman stands where it went down.
  onDive(ev) {
    let best = null, bd = 3;
    for (const b of this.bodies.values()) {
      if (!b.alive || b.zk !== 13) continue;
      const d = Math.hypot(b.x - ev.x, b.z - ev.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { best.diveT = 0; best.diveSink = ev.sink ?? 0.6; best.diveWarn = ev.warn ?? 1.7; }
  }

  // A zombie died where we could see it (Characters.onKill hands it here): a body that falls and goes limp, gibs, ichor.
  onKill(r, info) {
    const b = this.bodies.get(r.id);
    if (!b || !b.zk || !ZM_MODELS[b.zk]) return false;
    b.alive = false; b.goneT = -1; b.dead = true; b.deadT = 0;
    const zk = b.zk, def = ZM_MODELS[zk], s = def.dims.s;
    let c = this.corpses.find(q => !q.on);
    if (!c) { c = this.corpses.reduce((a, q) => (q.age > a.age ? q : a)); }
    const live = this.corpses.filter(q => q.on).length;
    if (live >= this.limit) { const old = this.corpses.filter(q => q.on).reduce((a, q) => (q.age > a.age ? q : a)); old.age = Math.max(old.age, LIE); }
    c.on = true; c.zk = zk; c.age = 0; c.mask = 0;
    c.A.set(b.A); c.V.fill(0); c.A[C.RY] = Math.max(c.A[C.RY], -0.05); c.A[C.RFWD] = 0;
    c.x = b.x; c.z = b.z; c.y = 0; c.vy = 0; c.aim = b.aim;
    let dx = info?.dirX ?? 0, dz = info?.dirZ ?? 0;
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-3) { dx = -Math.cos(b.aim); dz = -Math.sin(b.aim); } else { dx /= dl; dz /= dl; }
    const boss = BOSS.has(zk), blast = !!info?.explosive, head = !!info?.head;
    const melee = info?.weapon === 'knife' || info?.weapon === 'bat' || info?.weapon === 'blade';
    c.dx = dx; c.dz = dz;
    c.push = (blast ? 5 : head ? 1.4 : 2.2) / (boss ? 3 : 1);
    if (blast && !boss) c.vy = rand(3, 5);
    c.fallAng = 0; c.fallV = (blast ? 3.2 : 1.1) / (boss ? 1.6 : 1); c.maxFall = zk === 8 ? 0 : Math.PI / 2;
    // The limp pose it flops toward (springs overshoot it: that's the ragdoll).
    const T = c.T; T.set(c.A);
    for (const [ch, a, bb] of [[C.LAP, -0.5, 1.8], [C.RAP, -0.5, 1.8], [C.LAO, 0.1, 1.3], [C.RAO, 0.1, 1.3], [C.LFA, 0, 1.4], [C.RFA, 0, 1.4],
      [C.LTP, -0.4, 0.7], [C.RTP, -0.4, 0.7], [C.LSH, -1.1, -0.05], [C.RSH, -1.1, -0.05], [C.HPITCH, -0.9, 0.9], [C.HROLL, -0.8, 0.8], [C.HYAW, -0.6, 0.6], [C.CPITCH, -0.4, 0.3], [C.CROLL, -0.3, 0.3]]) T[ch] = rand(a, bb);
    T[C.RPITCH] = 0; T[C.RROLL] = 0; T[C.PPITCH] = zk === 8 ? -1.57 : 0; T[C.PROLL] = 0; T[C.EXS] = c.A[C.EXS];
    if (zk === 8) { T[C.HPITCH] = rand(-0.3, 0.6); T[C.HIPY] = -0.3; }
    for (let i = 0; i < NCH; i++) c.V[i] = rand(-3, 3) * (blast ? 3 : 1);
    // Parts that come off. Bones are drawn from the body's last pose, so a gib starts exactly where it was.
    const off = [];
    // A Bloater bursts: the belly and chest are gone (the violet splash is the burst's), head and arms thrown off.
    if (zk === 7 && !boss) { off.push(1 << HD, (1 << UAL) | (1 << FAL), (1 << UAR) | (1 << FAR)); c.mask |= (1 << CH) | (1 << EX); }
    else {
      if (head && !boss) off.push(1 << HD);
      if (blast && !boss) {
        const pool = [(1 << UAL) | (1 << FAL), (1 << UAR) | (1 << FAR), (1 << THL) | (1 << SHL), (1 << THR) | (1 << SHR), 1 << HD, 1 << FAL, 1 << FAR];
        for (let n = 1 + Math.floor(Math.random() * 3); n > 0 && pool.length; n--) { const i = Math.floor(Math.random() * pool.length); if (!off.includes(pool[i])) off.push(pool[i]); pool.splice(i, 1); }
      } else if (melee && !boss && Math.random() < 0.6) off.push(Math.random() < 0.5 ? (1 << FAL) : (1 << FAR));
      if (zk === 9 && b.shield) off.push(1 << EX);
    }
    for (const m of off) {
      const bone = Math.log2(m & -m) | 0;
      // The burst Bloater's chunks blow outward; a limb leaves along the shot; the door just drops.
      const out = zk === 7 ? rand(3, 6) : blast ? rand(4, 7) : m === (1 << EX) ? 0.8 : head ? 3.2 : 2.2;
      const a = Math.atan2(dz, dx) + rand(-0.9, 0.9) * (zk === 7 || blast ? 2 : 1);
      this._gib(zk, b.M, m, Math.cos(a) * out, (m === (1 << EX) ? 1 : rand(2.5, 5.5)) * (blast ? 1.3 : 1), Math.sin(a) * out);
      c.mask |= m;
      // A stump spurts.
      if (this.vfx && bone !== EX) { _v.setFromMatrixPosition(b.M[bone]); this._ichor(_v.x, _v.y, _v.z, dx, dz, zk, 1.4); }
    }
    // Ichor on the ground and in the air.
    const vfx = this.vfx;
    if (vfx) {
      const M = ZM_MATTER[zk] ?? ZM_MATTER[1];
      const y = zk === 8 ? 0.4 : (def.dims.hip + def.dims.waist + 0.2) * s;
      this._ichor(b.x, y, b.z, dx, dz, zk, zk === 7 ? 4 : boss ? 3 : 2);
      vfx.groundMark(b.x + dx * 0.4, b.z + dz * 0.4, rand(0.45, 0.7) * Math.min(1.8, s), zk === 7 ? M.ichor : ICHOR_SPLAT, 0.85);
      if (zk === 7) vfx.pop(b.x, 1, b.z, 3.5, M.glow, 0.25);
      if (boss) { vfx.ring(b.x, b.z, 0.4, 3.2, 0.5, M.glow ?? M.frost ?? M.spark ?? [0.8, 0.8, 0.6], 0.8); }
    }
    return true;
  }

  // A part (or parts: `mask`) of a body flying off with its own tumble.
  _gib(zk, M, mask, vx, vy, vz) {
    let g = this.gibs.find(q => !q.on);
    if (!g) g = this.gibs.reduce((a, q) => (q.age > a.age ? q : a));
    g.on = true; g.zk = zk; g.mask = mask; g.age = 0; g.rest = false;
    let n = 0; g.c0.set(0, 0, 0);
    for (let i = 0; i < NB; i++) if (mask & (1 << i)) { g.M0[i].copy(M[i]); _v.setFromMatrixPosition(M[i]); g.c0.add(_v); n++; }
    g.c0.multiplyScalar(1 / Math.max(1, n));
    // The joint is at one end of a bone: centre the tumble a little down the limb.
    if (!(mask & (1 << EX))) { _v.set(0, -0.15, 0).transformDirection(M[Math.log2(mask & -mask) | 0]).multiplyScalar(0.15 * ZM_MODELS[zk].dims.s); g.c0.add(_v); }
    g.c.copy(g.c0); g.v.set(vx, vy, vz);
    g.axis.set(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).normalize();
    g.ang = 0; g.angV = mask & (1 << EX) ? rand(1.5, 2.5) : rand(7, 14);
    g.r = mask & (1 << EX) ? 0.04 : 0.07 * ZM_MODELS[zk].dims.s;
    g.trail = 0;
  }

  // Each frame, after the characters (which work out who is on screen: rigs' visible, reveal, lite) and the events.
  update(view, dt, chars, opts = {}) {
    this.t += dt; this.timeU.value = this.t;
    const t = this.t, vfx = this.vfx;
    this.limit = Math.max(3, Math.min(this.corpses.length, chars?.corpses?.limit ?? 12));
    for (const L of this.lists.values()) L.length = 0;
    const list = zk => { let L = this.lists.get(zk); if (!L) { L = []; this.lists.set(zk, L); } return L; };

    // The living.
    for (let i = 0; i < view.players.length; i++) {
      const p = view.players[i];
      const zk = p.zk | 0;
      if (!zk) {
        // Gone without a kill on screen (sunk away by the sim, or off camera): finish quietly.
        const b = this.bodies.get(p.id);
        if (b) b.dead = false;
        if (b?.alive) { b.alive = false; b.goneT = 0; }
        if (b && b.goneT >= 0 && b.seen && ZM_MODELS[b.zk]) {
          b.goneT += dt;
          if (b.goneT < 0.6) { b.A[C.RY] -= dt * 2.4; rootOf(b.root, ZM_MODELS[b.zk], b.x, 0, b.z, b.aim, b.A, null); bones(ZM_MODELS[b.zk], b.A, b.root, b.M); list(b.zk).push({ M: b.M, fade: 1 - b.goneT / 0.6, flash: 0, glow: 1, lite: b.lite, mask: b.shield ? 0 : 1 << EX, tint: 0 }); }
          else b.goneT = -1;
        }
        continue;
      }
      const draw = zk === 10 ? 9 : zk, def = ZM_MODELS[draw];
      if (!def) continue;
      const b = this._body(p.id);
      // Killed, and the interpolated view has not caught up with the kill yet: it is the corpse's now.
      if (b.dead) { b.deadT += dt; if (b.deadT < 1.5) continue; b.dead = false; }
      const fresh = !b.alive;
      if (fresh) {
        // A seat that comes up is a zombie rising (not on the first frame we see the horde: those were already up).
        b.riseT = this.ready ? 0 : 1; b.windT = 0; b.strikeT = -1; b.ff = b.fv = b.fs = b.fsv = 0; b.dirtT = 0; b.speed = 0;
        b.goneT = -1;
        if (BOSS.has(draw) && this.ready && !opts.cine && !this.introSeen.has(p.id + ':' + draw)) {
          this.introSeen.add(p.id + ':' + draw);
          ZM_INTRO.start(draw, p.x, p.z);
        }
      }
      b.alive = true; b.zk = draw; b.shield = draw === 9 && !!p.zshield;
      b.x = p.x; b.z = p.z; b.aim = p.aim;
      const vx = p.vx || 0, vz = p.vz || 0, sp = Math.hypot(vx, vz);
      b.speed += (sp - b.speed) * damp(10, dt);
      b.phase = (b.phase + b.speed * dt * (TAU / def.gait.stride)) % (TAU * 64);
      // Attack timing from the swing flag.
      if (p.zswing) { b.windT += dt; b.swing = true; }
      else { if (b.swing && b.windT > 0.05) b.strikeT = 0; b.swing = false; b.windT = 0; }
      if (b.strikeT >= 0) { b.strikeT += dt; if (b.strikeT > STRIKE) b.strikeT = -1; }
      // Flinch springs.
      b.fv += (-90 * b.ff - 10 * b.fv) * dt; b.ff += b.fv * dt;
      b.fsv += (-90 * b.fs - 10 * b.fsv) * dt; b.fs += b.fsv * dt;
      b.flash *= Math.exp(-dt * 14);
      if (b.callT >= 0) { b.callT += dt; if (b.callT > b.callWind + b.callDash + 0.3) b.callT = -1; }
      if (b.diveT >= 0) { b.diveT += dt; if (b.diveT > b.diveWarn + 0.5) b.diveT = -1; }
      if (b.riseT < 1) b.riseT = Math.min(1, b.riseT + dt / (draw === 8 ? 0.75 : BOSS.has(draw) ? 1.6 : RISE));
      const r = chars?.rigs.get(p.id);
      const seen = r ? r.visible : true;
      b.seen = seen; b.lite = !!r?.lite;
      if (!seen) continue;
      pose(b, def, t, dt);
      rootOf(b.root, def, b.x, 0, b.z, b.aim, b.A, null);
      bones(def, b.A, b.root, b.M);
      // Dirt thrown up while it claws out of the ground.
      if (b.riseT < 0.85 && vfx) {
        b.dirtT -= dt;
        if (b.dirtT <= 0) {
          b.dirtT = 0.07;
          const sc = def.dims.s;
          for (let k = vfx._n(3); k > 0; k--) { const a = rand(0, TAU), sp2 = rand(0.8, 2.5); vfx.spawn(b.x + Math.cos(a) * 0.3 * sc, 0.1, b.z + Math.sin(a) * 0.3 * sc, Math.cos(a) * sp2, rand(2, 4.5), Math.sin(a) * sp2, rand(0.4, 0.7), rand(0.06, 0.12) * sc, 0.03, Math.random() < 0.5 ? DIRT : DIRT_D, 1, 14, 1, 0.02); }
          if (b.riseT < 0.08) { vfx.groundMark(b.x, b.z, 0.6 * sc, DIRT_D, 0.85); vfx.ring(b.x, b.z, 0.2, 0.9 * sc, 0.3, DIRT, 0.5); }
        }
      }
      const fade = r ? r.reveal : 1;
      const glow = BOSS.has(draw) ? 1 + 0.25 * Math.sin(t * 3) : draw === 7 ? 1 + 0.9 * sstep(0, 0.3, b.windT) : 1;
      list(draw).push({ M: b.M, fade, flash: b.flash, glow, lite: b.lite, mask: draw === 9 && !b.shield ? 1 << EX : 0, tint: 0 });
    }
    this.ready = true;

    // The dying: fall, flop, lie, sink.
    for (const c of this.corpses) {
      if (!c.on) continue;
      const def = ZM_MODELS[c.zk];
      c.age += dt;
      if (c.age > LIE + SINK) { c.on = false; continue; }
      // Topple about the feet, away from the shot; bounce once on landing.
      if (c.fallAng < c.maxFall) {
        c.fallV += (2.5 + 9 * Math.sin(c.fallAng)) * dt;
        c.fallAng += c.fallV * dt;
        if (c.fallAng >= c.maxFall) { c.fallAng = c.maxFall - 0.02; c.fallV = -c.fallV * 0.22; if (Math.abs(c.fallV) < 0.4) c.fallV = 0; if (vfx && c.age < 1.5) { const s = def.dims.s; vfx.spawn(c.x + c.dx * def.dims.hip * s, 0.15, c.z + c.dz * def.dims.hip * s, 0, 0.4, 0, 0.4, 0.15 * s, 0.45 * s, DIRT, 0.45, 0, 1.5); } }
      }
      c.x += c.dx * c.push * dt; c.z += c.dz * c.push * dt; c.push *= Math.exp(-dt * 4);
      if (c.vy || c.y > 0) { c.vy -= 16 * dt; c.y += c.vy * dt; if (c.y <= 0) { c.y = 0; c.vy = 0; } }
      // Limbs on springs toward the limp pose: loose at first, settling.
      const kS = 70, kD = 7 + c.age * 6;
      for (let i = 0; i < NCH; i++) { c.V[i] += ((c.T[i] - c.A[i]) * kS - c.V[i] * kD) * dt; c.A[i] += c.V[i] * dt; }
      // Lying: lift the body by its half-thickness so it lies on the ground, not in it; then sink.
      const s = def.dims.s, lying = Math.sin(Math.max(0, c.fallAng));
      c.A[C.RY] = c.y + lying * 0.14 * s - (c.age > LIE ? (c.age - LIE) * 0.7 : 0);
      _ax.set(c.dz, 0, -c.dx);
      c.fall.setFromAxisAngle(_ax, c.fallAng);
      rootOf(c.root, def, c.x, 0, c.z, c.aim, c.A, c.fall);
      bones(def, c.A, c.root, c.M);
      const fade = c.age > LIE ? Math.max(0, 1 - (c.age - LIE) / SINK) : 1;
      list(c.zk).push({ M: c.M, fade, flash: Math.max(0, 1 - c.age * 8) * 0.8, glow: Math.max(0, 1 - c.age * 1.6), lite: false, mask: c.mask, tint: Math.min(0.45, c.age * 0.4) });
    }

    // Gibs: tumble, bounce, rest, sink.
    for (const g of this.gibs) {
      if (!g.on) continue;
      g.age += dt;
      if (g.age > GIB_LIFE + 0.6) { g.on = false; continue; }
      if (!g.rest) {
        g.v.y -= 16 * dt;
        g.c.addScaledVector(g.v, dt);
        g.ang += g.angV * dt;
        if (g.c.y < g.r) {
          g.c.y = g.r; g.v.y = -g.v.y * 0.3; g.v.x *= 0.55; g.v.z *= 0.55; g.angV *= 0.5;
          if (Math.abs(g.v.y) < 0.8 && Math.hypot(g.v.x, g.v.z) < 0.6) { g.rest = true; if (vfx) vfx.groundMark(g.c.x, g.c.z, rand(0.18, 0.3), ICHOR_SPLAT, 0.8); }
        }
        g.trail -= dt;
        if (vfx && g.trail <= 0 && g.age < 1 && !(g.mask & (1 << EX))) { g.trail = 0.05; vfx.spawn(g.c.x, g.c.y, g.c.z, rand(-0.3, 0.3), rand(0, 0.6), rand(-0.3, 0.3), 0.45, 0.07, 0.03, (ZM_MATTER[g.zk] ?? ZM_MATTER[1]).ichor, 1, 10, 1); }
      }
      const sink = g.age > GIB_LIFE ? (g.age - GIB_LIFE) * 0.5 : 0;
      g.q.setFromAxisAngle(g.axis, g.ang);
      // M = T(c - sink) R T(-c0) M0
      _m.makeRotationFromQuaternion(g.q); _m.setPosition(g.c.x, g.c.y - sink, g.c.z);
      _r.makeTranslation(-g.c0.x, -g.c0.y, -g.c0.z); _m.multiply(_r);
      for (let i = 0; i < NB; i++) { if (g.mask & (1 << i)) g.M[i].multiplyMatrices(_m, g.M0[i]); else g.M[i].copy(ZERO); }
      list(g.zk).push({ M: g.M, fade: g.age > GIB_LIFE ? Math.max(0, 1 - (g.age - GIB_LIFE) / 0.6) : 1, flash: 0, glow: Math.max(0, 1 - g.age * 2), lite: false, mask: ~g.mask, tint: 0.25 });
    }

    // Write the rows, a kind at a time.
    const D = this.data;
    let row = 0;
    for (const [zk, L] of this.lists) {
      const mesh = L.length ? this._mesh(zk) : this.meshes.get(zk);
      if (!mesh) continue;
      const n = Math.min(L.length, ROWS - row);
      mesh.material.uniforms.uBase.value = row;
      mesh.geometry.instanceCount = n;
      mesh.visible = n > 0;
      for (let j = 0; j < n; j++, row++) {
        const it = L[j], o = row * TW * 4;
        for (let bi = 0; bi < NB; bi++) {
          const e = (it.mask & (1 << bi)) ? ZERO.elements : it.M[bi].elements, q = o + bi * 12;
          D[q] = e[0]; D[q + 1] = e[4]; D[q + 2] = e[8]; D[q + 3] = e[12];
          D[q + 4] = e[1]; D[q + 5] = e[5]; D[q + 6] = e[9]; D[q + 7] = e[13];
          D[q + 8] = e[2]; D[q + 9] = e[6]; D[q + 10] = e[10]; D[q + 11] = e[14];
        }
        const f = o + NB * 12;
        D[f] = it.fade; D[f + 1] = it.flash; D[f + 2] = it.glow; D[f + 3] = it.lite ? 1 : 0;
        D[f + 4] = 0.04; D[f + 5] = 0.045; D[f + 6] = 0.035; D[f + 7] = it.tint;
      }
    }
    for (const [zk, m] of this.meshes) if (!(this.lists.get(zk)?.length)) { m.visible = false; m.geometry.instanceCount = 0; }
    this.drawn = row;
    if (row) this.tex.needsUpdate = true;
  }

  // Dev/tests: what is drawn, by kind.
  stats() {
    const out = { rows: this.drawn, kinds: {}, tris: 0 };
    for (const [zk, m] of this.meshes) if (m.visible) { out.kinds[zk] = m.geometry.instanceCount; out.tris += m.geometry.instanceCount * m.userData.tris; }
    out.corpses = this.corpses.filter(c => c.on).length; out.gibs = this.gibs.filter(g => g.on).length;
    return out;
  }

  clear() {
    for (const c of this.corpses) c.on = false;
    for (const g of this.gibs) g.on = false;
    for (const b of this.bodies.values()) { b.goneT = -1; }
  }

  dispose() {
    for (const m of this.meshes.values()) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.meshes.clear();
    this.tex.dispose();
  }
}
