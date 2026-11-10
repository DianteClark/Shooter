// The operator roster and its skins: data only, shared by the renderer (js/render/characters.js) and the menus.
// `look` picks proportions and limb colours; the torso and head shapes are keyed by id in characters.js.
// `unlock` is null (always yours), {level}, {prestige}, or {stat, goal, label} against career weapon totals.
//
// Skins never add a draw call: each is a handful of per-instance numbers (gear recolour, limb colours, accent colour,
// glow mode and a gear slot that switches extra pieces merged into the operator meshes). See characters.js.
//   SKINS, getSkin(id), skinsFor(operator), cleanSkin(id, operator), skinUnlock(skin, career), botSkin(operator, id)
//   localSkin(operator) / setLocalSkin(operator, id|null)   field-skin pick, until Progress stores every skin
//   equippedEmblem() / setEmblemChoice(id)                  the player-card emblem (js/ui/emblems.js draws it)
// Mastery skins are equipped through Progress (operatorSkin / setOperatorSkin); js/ui/cards.js wraps both paths.
// The local picks live in their own small save (STORE_KEY) so this module needs nothing from Progress.
import './cardbook.js';     // Registers the extra calling cards before progress.js reads the save (it imports this file).

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

/* ---------- Skins ---------- */
// Ids follow the mastery reward ids (docs/PROGRESSION.md): `skin:<operator>-3` and `skin:<operator>-5` are granted by
// the operator's mastery track; `skin:<operator>-field` is earned by career numbers; `skin:<operator>-base` is the
// issue look (equipped as null in Progress). `slot` is the gear set a skin switches on in characters.js (0 none,
// 1 elite gear, 2 mastery trim and halo). `glow`: 0 accent lit like paint, 1 self-lit, 2 pulsing, 3 prism cycle.
export const SKIN_TIERS = {
  base:  { label: 'Issue', slot: 0, order: 0 },
  field: { label: 'Field', slot: 0, order: 1 },
  3:     { label: 'Elite', slot: 1, order: 2 },
  5:     { label: 'Mastery', slot: 2, order: 3 },
};
const STAT_LABEL = { kills: 'gun kills', head: 'headshots', long: 'longshots', slide: 'slide kills', clean: 'equipment-free kills' };

// One row per operator: [field, tier 3, tier 5], each [name, gear, sleeve, trouser, accent, glow, field rule].
// gear recolours the plain kit (not faces, not team armour); accent repaints visors, lenses, lamps and trims.
const SKIN_ROWS = {
  trooper: [
    ['Urban Grey', 0x8a9098, 0x6c7178, 0x4a4e55, 0x9fe8ff, 0, { stat: 'kills', goal: 200 }],
    ['Night Recon', 0x26332a, 0x2a3a2e, 0x1e2a22, 0x5dff7a, 1],
    ['Sovereign', 0xc9a240, 0x4a3c20, 0x2e2616, 0xffe08a, 2],
  ],
  wisp: [
    ['Drifter', 0xb59a6a, 0xa48a5e, 0x7d6a4a, 0xffd08a, 0, { stat: 'long', goal: 50 }],
    ['Veil', 0x4c5a32, 0x56643a, 0x3e4a2a, 0xc8ff6a, 1],
    ['Prism Wisp', 0x2a2440, 0x3a2f5a, 0x221c36, 0x18e8ff, 3],
  ],
  anvil: [
    ['Foundry', 0x8a4420, 0x5a2f1a, 0x3a2418, 0xffb14a, 0, { stat: 'kills', goal: 600 }],
    ['Bulwark', 0x3a4a66, 0x34405a, 0x252c3c, 0xff4a2a, 1],
    ['Molten', 0x2a1410, 0x3a1a12, 0x22100c, 0xff5a10, 2],
  ],
  relay: [
    ['Arctic Signal', 0xd8dee2, 0xc4ccd2, 0x8f9aa2, 0x4dc8ff, 0, { level: 20 }],
    ['Long Wave', 0x5a5a2e, 0x55553a, 0x3a3a28, 0xffcc33, 1],
    ['Carrier Wave', 0x1c2a3a, 0x22344a, 0x18222e, 0x7cf8ff, 3],
  ],
  yarddog: [
    ['Night Shift', 0x2e3440, 0x3a4250, 0x262c36, 0xff7a1a, 0, { stat: 'clean', goal: 150 }],
    ['Switch Tender', 0x5a4232, 0x4a3a2c, 0x2c3a2a, 0x39ff9a, 1],
    ['Golden Spike', 0xd0a640, 0x5c4a26, 0x3a2e18, 0xfff1a0, 2],
  ],
  ronin: [
    ['Ash', 0xb8b4ac, 0x9a968e, 0x6a6660, 0xd02a2a, 0, { stat: 'slide', goal: 80 }],
    ['Oni', 0x5a1a1c, 0x4a1618, 0x2a1012, 0xff3a2a, 1],
    ['Moonlit', 0x161a2a, 0x1c2236, 0x12141e, 0x9ad8ff, 2],
  ],
  ghoul: [
    ['Toxic', 0x3a4a22, 0x44542a, 0x2a3218, 0xc6ff2a, 1, { stat: 'head', goal: 300 }],
    ['Cyclops', 0x2a2c32, 0x30323a, 0x1e2026, 0xff2a3a, 1],
    ['Wraith', 0x1a1428, 0x241c36, 0x140f1e, 0xff2bd6, 3],
  ],
  ram: [
    ['Riot Blue', 0x2c3f5e, 0x2a3a56, 0x1e2a40, 0xbfe0ff, 0, { stat: 'slide', goal: 150 }],
    ['Siege', 0x6a6650, 0x56523e, 0x3a382a, 0xffb000, 1],
    ['Battering Gold', 0xc89a3a, 0x5a4422, 0x3a2c16, 0xfff0b0, 2],
  ],
  monarch: [
    ['Ivory Court', 0xe8e0cc, 0xd4ccb8, 0x8a8270, 0xd9b44a, 0, { prestige: 2 }],
    ['Usurper', 0x1c1420, 0x2a1e30, 0x161018, 0xb04aff, 1],
    ['Sovereign Prism', 0x2a2236, 0x3a2e4c, 0x221a2c, 0xffd659, 3],
  ],
};

const ROW_TIERS = ['field', 3, 5];
export const SKINS = OPERATORS.flatMap(op => [
  { id: `skin:${op.id}-base`, operator: op.id, tier: 'base', name: 'Standard issue', slot: 0, glow: 0,
    gear: null, sleeve: op.look.sleeve, trouser: op.look.trouser, accent: null, unlock: null },
  ...SKIN_ROWS[op.id].map(([name, gear, sleeve, trouser, accent, glow, rule], i) => ({
    id: `skin:${op.id}-${ROW_TIERS[i]}`, operator: op.id, tier: ROW_TIERS[i], name, slot: SKIN_TIERS[ROW_TIERS[i]].slot,
    glow, gear, sleeve, trouser, accent, unlock: rule ?? { grant: true },
  })),
]);
SKINS.forEach((s, i) => { s.index = i; });
const SKIN_BY_ID = new Map(SKINS.map(s => [s.id, s]));

// Takes 'skin:anvil-3' or 'anvil-3'.
export const getSkin = id => (typeof id === 'string' ? SKIN_BY_ID.get(id.startsWith('skin:') ? id : `skin:${id}`) ?? null : null);
export const skinsFor = operator => SKINS.filter(s => s.operator === operator);
export const baseSkin = operator => `skin:${cleanOperator(operator)}-base`;
// A skin id from a peer or a save only counts when it belongs to the operator it arrives with; null is the issue look.
export const cleanSkin = (id, operator) => (getSkin(id)?.operator === operator ? getSkin(id).id : baseSkin(operator));
export const isGrantSkin = skin => !!skin?.unlock?.grant;

// `career` is the operator career plus `granted(id)` (Progress.hasReward). Grant skins are unlocked only by their
// mastery tier; field skins by their career rule (or a grant, should one ever be given).
export function skinUnlock(skin, career) {
  const u = skin.unlock;
  if (!u) return { unlocked: true, requirement: 'Comes with the operator', value: 1, goal: 1 };
  if (career.granted?.(skin.id)) return { unlocked: true, requirement: 'Earned', value: 1, goal: 1 };
  if (u.grant) return { unlocked: false, requirement: `${getOperator(skin.operator).name} mastery tier ${skin.tier}`, value: 0, goal: 1 };
  if (u.stat) return { ...operatorUnlock({ unlock: { ...u, label: STAT_LABEL[u.stat] ?? u.stat } }, career), requirement: `${u.goal.toLocaleString('en-US')} ${STAT_LABEL[u.stat] ?? u.stat}` };
  return operatorUnlock({ unlock: u }, career);
}

// Bots dress from the same wardrobe, decided by their id so every client agrees: mostly issue kit, some field
// colours, a few elite sets and the odd mastery skin.
export function botSkin(operator, id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const u = ((h >>> 0) % 1000) / 1000;
  const tier = u < 0.45 ? 'base' : u < 0.75 ? 'field' : u < 0.93 ? 3 : 5;
  return `skin:${cleanOperator(operator)}-${tier}`;
}

/* ---------- The player's picks ---------- */
const STORE_KEY = 'switchyard.custom.v1';
const store = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
})();
store.skins = store.skins && typeof store.skins === 'object' ? store.skins : {};
const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode: picks last the session */ } };

// Field skins are kept here while Progress.setOperatorSkin accepts only mastery grants (see cards.js equipSkin).
export const localSkin = operator => (getSkin(store.skins[operator])?.operator === operator ? store.skins[operator] : null);
export function setLocalSkin(operator, id) {
  if (id !== null && getSkin(id)?.operator !== operator) return false;
  store.skins[operator] = id;
  persist();
  return true;
}
export const equippedEmblem = () => (typeof store.emblem === 'string' ? store.emblem : null);
export function setEmblemChoice(id) {
  store.emblem = typeof id === 'string' ? id : null;
  persist();
  return true;
}
