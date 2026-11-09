// Turns a weapon definition into the stat bars of the gunsmith. Every score is 0..1 against fixed caps, so a
// single bar compares guns as well as attachments. `raw` is the real number the delta label is computed from.
import { WEAPONS } from '../shared/weapons.js';
import { applyAttachments } from '../shared/attachments.js';

const clamp01 = v => Math.max(0.02, Math.min(1, v));

const recoilOf = w => ((w.pattern?.amp ?? 0) / 0.02) * 0.6 + ((w.bloomPerShot ?? 0) / 0.3) * 0.4;
const reloadOf = w => (w.shellReload ? w.reload * w.magazine * 0.5 : w.reload);
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

// The numbers behind the bars, as the player thinks about them.
export function weaponFacts(weaponId, kit) {
  const w = applyAttachments(WEAPONS[weaponId], kit);
  const f = w.falloff;
  const hasFalloff = f && f.start < (w.range ?? Infinity);
  return [
    ['Damage', w.pellets > 1 ? `${w.damage}x${w.pellets}` : `${w.damage}`],
    ['RPM', `${Math.round(w.rpm)}`],
    ['Mag', `${w.magazine}`],
    ['Reload', `${(w.shellReload ? w.reload * w.magazine * 0.5 : w.reload).toFixed(1)}s`],
    ['Falloff', hasFalloff ? `${Math.round(f.start)}-${Math.round(f.end)}m` : 'None'],
    ['Max', `${Math.round(w.maxRange ?? w.range)}m`],
  ];
}
