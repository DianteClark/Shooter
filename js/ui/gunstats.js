// Turns a weapon definition into the stat bars of the gunsmith. Every score is 0..1 against fixed caps, so a
// single bar compares guns as well as attachments. `raw` is the real number the delta label is computed from.
import { WEAPONS, rangeBands } from '../shared/weapons.js';
import { applyAttachments } from '../shared/attachments.js';

const clamp01 = v => Math.max(0.02, Math.min(1, v));

const recoilOf = w => ((w.pattern?.amp ?? 0) / 0.02) * 0.6 + ((w.bloomPerShot ?? 0) / 0.3) * 0.4;
const reloadOf = w => (w.shellReload ? w.reload * Math.max(1, w.magazine * 0.5) : w.reload);
const handleOf = w => w.sprintToFire + w.swapTime * 0.5;
const moveOf = w => w.moveMult * 0.7 + w.adsMoveMult * 0.3;

const STATS = [
  { id: 'damage', label: 'Damage', raw: w => w.damage * (w.pellets ?? 1), score: r => Math.sqrt(r / 130), better: 1 },
  { id: 'rate', label: 'Fire rate', raw: w => w.rpm, score: r => r / 1000, better: 1 },
  { id: 'range', label: 'Range', raw: w => w.range, score: r => r / 90, better: 1 },
  { id: 'aimed', label: 'Aimed fire', raw: w => w.adsSpread, score: r => 1 - Math.log(r / 0.001) / Math.log(70), better: -1 },
  { id: 'hip', label: 'Hip fire', raw: w => w.hipSpread, score: r => 1 - (r - 0.02) / 0.2, better: -1 },
  { id: 'recoil', label: 'Recoil', raw: recoilOf, score: r => 1 - r, better: -1 },
  { id: 'aimspeed', label: 'Aim speed', raw: w => w.adsTime, score: r => 1 - (r - 0.06) / 0.5, better: -1 },
  { id: 'handling', label: 'Handling', raw: handleOf, score: r => 1 - (r - 0.1) / 0.75, better: -1 },
  { id: 'move', label: 'Mobility', raw: moveOf, score: r => (r - 0.55) / 0.55, better: 1 },
  { id: 'mag', label: 'Magazine', raw: w => w.magazine, score: r => Math.sqrt(r / 140), better: 1, whole: true },
  { id: 'reload', label: 'Reload', raw: reloadOf, score: r => 1 - (r - 0.8) / 5, better: -1 },
  { id: 'swing', label: 'Swing speed', only: w => w.turnCap !== undefined, raw: w => w.turnCap, score: r => Math.sqrt(r / 18), better: 1 },
  { id: 'heat', label: 'Heat', only: w => !!w.heat, raw: w => w.heat.rounds, score: r => r / 70, better: 1, whole: true },
  // Damage kept through a piece of waist-high cover. Light rounds have no row: cover simply stops them.
  { id: 'pen', label: 'Penetration', only: w => !!w.penetrate, raw: w => w.penetrate, score: r => r, better: 1 },
  { id: 'blast', label: 'Blast radius', only: w => !!w.explosive, raw: w => w.explosive.radius, score: r => r / 6, better: 1 },
];

// The rows a weapon shows: heavy-gun rows only exist on the guns they concern.
export function statsFor(weaponId) {
  const def = WEAPONS[weaponId];
  return STATS.filter(s => !s.only || s.only(def));
}

// { base, next, delta, better, whole, changed } per stat: base is the fitted kit, next the kit being tried.
export function compareStats(weaponId, fittedKit, tryKit) {
  const def = WEAPONS[weaponId];
  const a = applyAttachments(def, fittedKit), b = applyAttachments(def, tryKit ?? fittedKit);
  return statsFor(weaponId).map(s => {
    const ra = s.raw(a), rb = s.raw(b);
    const delta = s.whole ? rb - ra : ra ? (rb - ra) / ra : 0;
    const changed = Math.abs(delta) >= (s.whole ? 1 : 0.005);
    return {
      id: s.id, label: s.label, whole: !!s.whole,
      base: clamp01(s.score(ra)), next: clamp01(s.score(rb)),
      delta, changed, better: changed && (rb - ra) * s.better > 0,
    };
  });
}

// The text beside a bar: signed magnitude only, the arrow carries better or worse.
export function deltaText(row) {
  return row.whole ? `${Math.abs(Math.round(row.delta))}` : `${Math.round(Math.abs(row.delta) * 100)}%`;
}

// One gun alone, for cards and the armory: { id, label, score } per bar.
export function statBars(weaponId, kit) {
  const def = applyAttachments(WEAPONS[weaponId], kit);
  return statsFor(weaponId).map(s => ({ id: s.id, label: s.label, score: clamp01(s.score(s.raw(def))) }));
}

// The numbers behind the bars, as the player thinks about them. Range reads "full-fade/max": full damage to the
// first number, down to its minimum by the second, and the round simply ends at the last.
export function weaponFacts(weaponId, kit) {
  const w = applyAttachments(WEAPONS[weaponId], kit);
  const b = rangeBands(w);
  const falloff = b.full < b.max;
  return [
    ['Damage', w.pellets > 1 ? `${w.damage}x${w.pellets}` : `${w.damage}`],
    ['RPM', `${Math.round(w.rpm)}`],
    ['Mag', `${w.magazine}`],
    ['Reload', `${reloadOf(w).toFixed(1)}s`],
    ['Range', falloff ? `${Math.round(b.full)}-${Math.round(Math.min(b.fade, b.max))}/${Math.round(b.max)}m` : `${Math.round(b.max)}m`],
    coverFact(w),
  ];
}

// What waist-high cover does to this gun's round: a blast radius for explosives (they fly over it), the damage kept
// through one piece for penetrating rounds, and "None" for light rounds that cover stops.
function coverFact(w) {
  if (w.explosive) return ['Blast', `${w.explosive.radius.toFixed(1)}m`];
  return ['Pierce', w.penetrate ? `${Math.round(w.penetrate * 100)}%` : 'None'];
}

export const RANGE_AXIS = 90;   // Metres across the full width of a range strip, the same for every gun.

// The falloff curve as a strip: full damage, the fade, the floor out to the hard range, nothing past it.
// Fractions are of RANGE_AXIS so two guns' strips compare directly. minPct is the floor as a share of full damage.
export function rangeStrip(weaponId, kit) {
  const w = applyAttachments(WEAPONS[weaponId], kit);
  const b = rangeBands(w);
  const max = Math.min(b.max, RANGE_AXIS), full = Math.min(b.full, max), fade = Math.min(b.fade, max);
  return {
    full, fade, max, explosive: !!w.explosive,
    fullF: full / RANGE_AXIS, fadeF: fade / RANGE_AXIS, maxF: max / RANGE_AXIS,
    minPct: Math.round(100 * b.minDamage / w.damage),
  };
}
