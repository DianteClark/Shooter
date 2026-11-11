// Weapon feel, resolved from data. No three.js and no DOM in here: the renderer, the audio engine and the HUD all
// read it, and it runs in node.
//
// Every per-gun table in the game (shot effects in vfx.js, voices and foley in audio.js, reload tracks in anim.js,
// the hold in characters.js) is keyed by weapon id. A gun with no entry of its own used to fall back to the Halyard,
// or to silence. Now a missing entry is derived here from the gun's definition in js/shared/weapons.js:
//
//   def.category          picks the class skeleton (Assault, SMG, Shotgun, LMG, Marksman, Sniper, Pistol, Launcher).
//   def.kickCam, damage,  scale it: heavier guns flash bigger, sound lower and longer, kick further.
//     rpm, range, pellets,
//     explosive, heat,
//     shellReload
//   def.feel              optional, all of it optional:
//     like: 'lever'         borrow another gun's hand-made entries wholesale (sound, foley, effects, reload, hold)
//     fx: {...}             overrides merged over the shot-effect entry (fields of GUN_FX in vfx.js)
//     voice: {...}          overrides merged over the audio recipe (fields of GUNS in audio.js), plus `pitch`
//     foley: {...}          overrides merged over the reload foley entry (kind, pitch, mass, out, in, rack)
//     recoil: {...}         overrides merged over the visible recoil profile (back, climb, twist)
//
// So a new gun needs nothing here to look and sound like a member of its class, one field (`feel.like`) to take
// after a specific gun, and a few numbers to be itself.
import { WEAPONS } from '../shared/weapons.js';

export const CLASSES = ['Assault', 'SMG', 'Shotgun', 'LMG', 'Marksman', 'Sniper', 'Pistol', 'Launcher'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// A stable number in [-1, 1] per id, so two guns of one class never derive the same pitch.
export function idHash(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 2001) / 1000 - 1;
}

// The class a gun belongs to. Its category when it has one; otherwise what its numbers say it is.
export function classOf(id, def = WEAPONS[id]) {
  if (!def) return 'Assault';
  if (CLASSES.includes(def.category)) return def.category;
  if (def.explosive) return 'Launcher';
  if ((def.pellets || 1) > 1) return 'Shotgun';
  if (def.magazine >= 60) return 'LMG';
  if (def.range >= 70) return 'Sniper';
  if (def.rpm <= 320 && def.damage >= 45) return 'Marksman';
  if (def.range <= 24) return 'Pistol';
  if (def.rpm >= 760 && def.range <= 36) return 'SMG';
  return 'Assault';
}

// 0 (a pocket gun) .. 1.5 (an anti-materiel rifle): how much gun this is. kickCam is the balance owner's own
// statement of it; damage stands in when a def has none.
export function weightOf(id, def = WEAPONS[id]) {
  if (!def) return 0.5;
  if (Number.isFinite(def.kickCam)) return clamp(def.kickCam, 0.15, 1.6);
  return clamp(def.damage * (def.pellets || 1) / 70, 0.2, 1.5);
}

const likeOf = def => (def && def.feel && def.feel.like) || null;

// Fills the gaps of an id-keyed table for every weapon in WEAPONS: `feel.like` first, then `derive(id, def, cls)`.
// An entry the table already has always wins. `part` names the def.feel override block merged on top.
export function fillGaps(table, derive, part) {
  for (const id in WEAPONS) {
    const def = WEAPONS[id];
    const over = part && def.feel && def.feel[part];
    if (table[id] !== undefined) { if (over) table[id] = { ...table[id], ...over }; continue; }
    const like = likeOf(def);
    let entry = like && table[like] !== undefined ? table[like] : derive(id, def, classOf(id, def));
    if (entry === undefined) continue;
    if (over && entry && typeof entry === 'object' && !Array.isArray(entry)) entry = { ...entry, ...over };
    table[id] = entry;
  }
  return table;
}

// ---- Shot effects (vfx.js GUN_FX entries) ---------------------------------------------------------------------
// tail/linger/speed shape the tracer, flash is [size, length, width] of the muzzle star, shell the casing.
// The fields below the first line are the class traits every entry gets when it does not name its own:
//   shape   muzzle flash silhouette: 'star' one forward star, 'fan' a wide three-lobed blast, 'cross' a braked
//           plus-sign, 'jet' a long lance with a small collar, 'spit' a short flicker, 'none'
//   tint    [r, g, b, amount]: tracers lean this far toward the colour (the shooter's own colour still leads)
//   skip    on the Low steps, other players' rounds draw one tracer in this many (the sound and flash stay)
//   smoke   rounds of sustained fire before the barrel trails smoke once the trigger is let go
//   light   muzzle light radius multiplier
const CLASS_FX = {
  Assault:  { tail: 11,  linger: 0.075, speed: 230, flash: [1.5, 1.1, 1.0],   shell: 'rifle',  shape: 'star',  tint: [1, 0.86, 0.6, 0.12],  skip: 1, smoke: 14, light: 1 },
  SMG:      { tail: 6,   linger: 0.04,  speed: 205, flash: [1.1, 0.8, 1.2],   shell: 'pistol', shape: 'spit',  tint: [1, 0.92, 0.7, 0.08],  skip: 2, smoke: 14, light: 0.8, jitter: 1 },
  Shotgun:  { tail: 3.4, linger: 0.05,  speed: 170, flash: [2.2, 0.78, 1.9],  shell: 'hull',   shape: 'fan',   tint: [1, 0.6, 0.24, 0.3],   skip: 2, smoke: 1.5, light: 1.5, extra: 'blast' },
  LMG:      { tail: 12,  linger: 0.085, speed: 222, flash: [1.7, 1.0, 1.2],   shell: 'link',   shape: 'cross', tint: [1, 0.5, 0.22, 0.22],  skip: 2, smoke: 18, light: 1.2, every: 3 },
  Marksman: { tail: 16,  linger: 0.14,  speed: 290, flash: [1.8, 1.2, 0.85],  shell: 'rifle',  shape: 'jet',   tint: [1, 1, 0.92, 0.2],     skip: 1, smoke: 4,  light: 1.2 },
  Sniper:   { tail: 60,  linger: 0.42,  speed: 500, flash: [2.3, 1.5, 0.7],   shell: 'magnum', shape: 'cross', tint: [1, 1, 1, 0.34],       skip: 1, smoke: 1,  light: 1.7, extra: 'brake', contrail: 1 },
  Pistol:   { tail: 7,   linger: 0.05,  speed: 210, flash: [1.2, 0.9, 1.0],   shell: 'pistol', shape: 'spit',  tint: [1, 0.9, 0.66, 0.1],   skip: 1, smoke: 6,  light: 0.8 },
  Launcher: { tail: 0,   linger: 0,     speed: 92,  flash: [2.2, 0.5, 2.0],   shell: null,     shape: 'fan',   tint: [1, 1, 1, 0],          skip: 1, smoke: 1,  light: 1.6, extra: 'backblast' },
};
const TRAITS = ['shape', 'tint', 'skip', 'smoke', 'light'];

export function deriveFx(id, def, cls) {
  const C = CLASS_FX[cls] || CLASS_FX.Assault;
  const w = weightOf(id, def), k = 0.78 + 0.42 * w;
  const out = { ...C, flash: [C.flash[0] * k, C.flash[1], C.flash[2]] };
  if (cls === 'Shotgun' && (def.pellets || 1) === 1) {
    // One slug, not a cloud of shot: a rifle's streak out of a shotgun's blast.
    out.tail = 12; out.linger = 0.1; out.speed = 250; out.extra = undefined; out.shape = 'star';
  }
  if (cls === 'LMG') out.every = def.rpm >= 1000 ? 5 : def.rpm >= 760 ? 4 : 3;
  if (cls === 'Launcher' && def.explosive && def.range < 45) out.extra = undefined;   // A tube pop, not a rocket.
  if (cls !== 'Launcher' && cls !== 'Sniper') {
    // Reach shows in the streak: a long-barrelled gun throws a longer, faster one.
    const reach = clamp((def.range || 40) / 45, 0.7, 1.5);
    out.tail = C.tail * reach; out.speed = C.speed * (0.9 + 0.1 * reach);
  }
  if (def.shellReload && cls !== 'Shotgun') out.shell = cls === 'Marksman' ? 'rifle' : out.shell;
  return out;
}

// Gives every entry of a GUN_FX table its class traits (the hand-made ones predate them), then fills the gaps.
export function completeFx(table) {
  fillGaps(table, deriveFx, 'fx');
  for (const id in table) {
    const def = WEAPONS[id], G = table[id];
    const C = CLASS_FX[def ? classOf(id, def) : 'Assault'];
    for (const t of TRAITS) if (G[t] === undefined) G[t] = C[t];
    if (G.extra === 'brake' && G.shape === undefined) G.shape = 'cross';
    G.heatPerShot = 1 / Math.max(1, G.smoke);
    if (def && def.rpm >= 900 && G.skip < 2) G.skip = 2;
  }
  // Guns whose hand-made flash already says what they are keep a matching silhouette.
  const shapes = { revolver: 'star', crossbow: 'none', thumper: 'spit', golden: 'star', slug: 'star', coach: 'fan', scatter: 'fan', dmr: 'jet', battle: 'jet', lever: 'star', antimat: 'cross', semisnipe: 'jet', rotary: 'spit', pdw: 'spit' };
  for (const id in shapes) if (table[id] && !(WEAPONS[id] && WEAPONS[id].feel && WEAPONS[id].feel.fx && WEAPONS[id].feel.fx.shape)) table[id].shape = shapes[id];
  return table;
}

// ---- Visible recoil on the gun and the arms holding it (characters.js) ------------------------------------------
// back: how far the gun drives into the shoulder. climb: muzzle rise. twist: roll about the barrel, alternating.
const CLASS_RECOIL = {
  Assault:  { back: 1.0, climb: 1.0, twist: 0.25 },
  SMG:      { back: 0.7, climb: 0.55, twist: 0.8 },
  Shotgun:  { back: 1.8, climb: 1.6, twist: 0.2 },
  LMG:      { back: 1.15, climb: 0.45, twist: 0.55 },
  Marksman: { back: 1.35, climb: 1.4, twist: 0.15 },
  Sniper:   { back: 1.7, climb: 1.6, twist: 0.1 },
  Pistol:   { back: 0.5, climb: 2.3, twist: 0.35 },
  Launcher: { back: 1.6, climb: 0.5, twist: 0.3 },
};
const RECOIL = {};
export function recoilOf(id) {
  let r = RECOIL[id];
  if (r) return r;
  const def = WEAPONS[id];
  const like = likeOf(def);
  const base = CLASS_RECOIL[classOf(like && WEAPONS[like] ? like : id, like && WEAPONS[like] ? WEAPONS[like] : def)];
  r = RECOIL[id] = { ...base, ...(def && def.feel && def.feel.recoil) };
  return r;
}

// ---- How a gun sits in the hands and how it reloads (characters.js HOLD / GUN_SCALES, anim.js RELOADS) ------------
const CLASS_HOLD = {
  LMG: [-0.03, -0.09, 0.04], Sniper: [-0.02, 0.05, 0], Shotgun: [-0.02, -0.03, 0.02], Pistol: [0.14, 0.06, -0.08], Launcher: [-0.3, 0.3, 0.1],
};
export const deriveHold = (id, def, cls) => CLASS_HOLD[cls];
export const deriveScale = (id, def, cls) => (cls === 'Sniper' ? 0.88 : cls === 'Pistol' ? 1.05 : undefined);

// Which hand-made reload a class borrows when a gun brings none: the id of an existing RELOADS entry.
export function reloadLike(id, def, cls) {
  if (def.shellReload) return cls === 'Shotgun' ? 'shotgun' : 'lever';
  switch (cls) {
    case 'SMG': return 'tacsmg';
    case 'Shotgun': return 'autoshot';
    case 'LMG': return 'saw';
    case 'Marksman': return 'dmr';
    case 'Sniper': return 'sniper';
    case 'Pistol': return def.magazine <= 8 && def.rpm <= 220 ? 'revolver' : 'pistol';
    case 'Launcher': return 'launcher';
    default: return 'ar';
  }
}

// ---- Impact bus: the renderer knows what a round struck, the audio engine voices it ------------------------------
// A fixed ring written by vfx.js (wallHit, groundHit) and drained by audio.js once a frame. Nothing allocates.
// Materials: metal, concrete, wood, sand, snow, water, rock, cloth, dirt.
const BUS = 16;
export const impactBus = {
  live: false,                     // True once a renderer has written to it: audio then stops guessing by map theme.
  n: 0,
  mat: new Array(BUS).fill(''),
  x: new Float32Array(BUS), z: new Float32Array(BUS),
  push(mat, x, z) {
    this.live = true;
    if (this.n >= BUS) return;
    const i = this.n++;
    this.mat[i] = mat; this.x[i] = x; this.z[i] = z;
  },
};

// Reduced motion: the camera kick, hit punch and screen shake a gun adds are scaled by this (1 or a small number).
// The player's own Camera kick / Screen shake sliders (tuning.js) still multiply on top.
let motionScale = 1;
if (typeof matchMedia === 'function') {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const set = () => { motionScale = mq.matches ? 0.25 : 1; };
  set();
  if (mq.addEventListener) mq.addEventListener('change', set);
}
export const feelMotion = () => motionScale;
