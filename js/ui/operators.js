// The operator roster: data only, shared by the renderer (js/render/characters.js) and the menus.
// `look` picks proportions and limb colours; the torso and head shapes are keyed by id in characters.js.
// `unlock` is null (always yours), {level}, {prestige}, or {stat, goal, label} against career weapon totals.
export const OPERATORS = [
  { id: 'trooper', name: 'Trooper', role: 'Line infantry, standard issue',
    unlock: null, look: { w: 1, h: 1, l: 1, sleeve: 0x3a3f47, trouser: 0x363a42 } },
  { id: 'wisp', name: 'Wisp', role: 'Lean scout in a boonie hat',
    unlock: null, look: { w: 0.88, h: 0.97, l: 0.84, sleeve: 0x6b6147, trouser: 0x4f4a3a } },
  { id: 'anvil', name: 'Anvil', role: 'Heavy plate and a drum on the back',
    unlock: { level: 4 }, look: { w: 1.18, h: 1.03, l: 1.22, sleeve: 0x2e3238, trouser: 0x272a30 } },
  { id: 'relay', name: 'Relay', role: 'Signals, radio mast and side cap',
    unlock: { level: 8 }, look: { w: 0.97, h: 1.01, l: 0.95, sleeve: 0x3f4a3a, trouser: 0x333b32 } },
  { id: 'yarddog', name: 'Yard Dog', role: 'Hard hat and hi-vis from the night shift',
    unlock: { level: 14 }, look: { w: 1.04, h: 0.98, l: 1.04, sleeve: 0x57503a, trouser: 0x2f3a4a } },
  { id: 'ronin', name: 'Ronin', role: 'Conical hat, cloak, no apologies',
    unlock: { level: 22 }, look: { w: 0.94, h: 1, l: 0.9, sleeve: 0x2b2a32, trouser: 0x24232b } },
  { id: 'ghoul', name: 'Ghoul', role: 'Hood and twin-filter gas mask',
    unlock: { stat: 'head', goal: 150, label: 'Headshots' }, look: { w: 0.92, h: 1.06, l: 0.88, sleeve: 0x2f3330, trouser: 0x25282a } },
  { id: 'ram', name: 'Ram', role: 'Breacher behind a full face shield',
    unlock: { stat: 'slide', goal: 60, label: 'Slide kills' }, look: { w: 1.12, h: 1.02, l: 1.14, sleeve: 0x384048, trouser: 0x2d343c } },
  { id: 'monarch', name: 'Monarch', role: 'Crested helm and cape, for prestige only',
    unlock: { prestige: 1 }, look: { w: 1.05, h: 1.05, l: 1, sleeve: 0x4a4358, trouser: 0x322d3d } },
];

export const OPERATOR_IDS = OPERATORS.map(o => o.id);
export const DEFAULT_OPERATOR = OPERATORS[0].id;
export const getOperator = id => OPERATORS.find(o => o.id === id) ?? OPERATORS[0];

// Peers on another version may send anything, so this is the only way an id reaches a roster.
export const cleanOperator = id => (OPERATOR_IDS.includes(id) ? id : DEFAULT_OPERATOR);

// `career` is { level (peak), prestige, kills, head, long, slide, clean }.
export function operatorUnlock(op, career) {
  const u = op.unlock;
  if (!u) return { unlocked: true, requirement: 'Available from the start', value: 1, goal: 1 };
  if (u.level) return { unlocked: career.level >= u.level, requirement: `Reach level ${u.level}`, value: Math.min(career.level, u.level), goal: u.level };
  if (u.prestige) return { unlocked: career.prestige >= u.prestige, requirement: `Reach prestige rank ${u.prestige}`, value: Math.min(career.prestige, u.prestige), goal: u.prestige };
  const value = Math.min(career[u.stat] ?? 0, u.goal);
  return { unlocked: value >= u.goal, requirement: `${u.goal} ${u.label}`, value, goal: u.goal };
}
