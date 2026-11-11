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

// The first nine are modelled by hand in characters.js (TORSOS / HEADS). Every operator after them is assembled from
// the parts kit (js/render/operator-kit.js): `kit` picks one part per slot, and `look` carries the build the shader
// applies (sh: shoulder width, hip: hip width, head: head size) and the skin and hair colours. `voice` is 'f' or 'm'
// for anything that speaks for an operator. Ids are saved and sent to peers: append, never reorder or rename.
const F = 'f', M = 'm';
export const OPERATORS = [
  { id: 'trooper', name: 'Trooper', role: 'Line infantry, standard issue', voice: M,
    bio: 'Signed up for the pay, stayed for the yard. Does the job the way the manual says, and the manual is usually right.',
    unlock: null, look: { w: 1, h: 1, l: 1, sleeve: 0x3a3f47, trouser: 0x363a42 } },
  { id: 'wisp', name: 'Wisp', role: 'Lean scout in a boonie hat', voice: M,
    bio: 'Walks point, talks little. Has been behind you for a while now.',
    unlock: null, look: { w: 0.88, h: 0.97, l: 0.84, sleeve: 0x6b6147, trouser: 0x4f4a3a } },
  { id: 'anvil', name: 'Anvil', role: 'Heavy plate and a drum on the back', voice: M,
    bio: 'Carries more steel than the rest of the squad together and complains about none of it.',
    unlock: { level: 4 }, look: { w: 1.18, h: 1.03, l: 1.22, sleeve: 0x2e3238, trouser: 0x272a30 } },
  { id: 'relay', name: 'Relay', role: 'Signals, radio mast and side cap', voice: M,
    bio: 'If the call goes out, it went through him. Can hear a jammer before the HUD can.',
    unlock: { level: 8 }, look: { w: 0.97, h: 1.01, l: 0.95, sleeve: 0x3f4a3a, trouser: 0x333b32 } },
  { id: 'yarddog', name: 'Yard Dog', role: 'Hard hat and hi-vis from the night shift', voice: M,
    bio: 'Twenty years coupling wagons in the dark. Knows every shortcut through every yard on the map.',
    unlock: { level: 14 }, look: { w: 1.04, h: 0.98, l: 1.04, sleeve: 0x57503a, trouser: 0x2f3a4a } },
  { id: 'ronin', name: 'Ronin', role: 'Conical hat, cloak, no apologies', voice: M,
    bio: 'Works alone, for whoever pays on time. The hat keeps the rain and the questions off.',
    unlock: { level: 22 }, look: { w: 0.94, h: 1, l: 0.9, sleeve: 0x2b2a32, trouser: 0x24232b } },
  { id: 'ghoul', name: 'Ghoul', role: 'Hood and twin-filter gas mask', voice: M,
    bio: 'Nobody has seen the face under the mask. The filters are changed daily; the jokes about it, never.',
    unlock: { stat: 'head', goal: 150, label: 'Headshots' }, look: { w: 0.92, h: 1.06, l: 0.88, sleeve: 0x2f3330, trouser: 0x25282a } },
  { id: 'ram', name: 'Ram', role: 'Breacher behind a full face shield', voice: M,
    bio: 'Opens doors for a living. Has never once knocked.',
    unlock: { stat: 'slide', goal: 60, label: 'Slide kills' }, look: { w: 1.12, h: 1.02, l: 1.14, sleeve: 0x384048, trouser: 0x2d343c } },
  { id: 'monarch', name: 'Monarch', role: 'Crested helm and cape, for prestige only', voice: M,
    bio: 'Earned the crest the long way round. Wears it so the other side knows who they are dealing with.',
    unlock: { prestige: 1 }, look: { w: 1.05, h: 1.05, l: 1, sleeve: 0x4a4358, trouser: 0x322d3d } },
  // Operators wave (roadmap 11): assembled from the kit.
  { id: 'sparrow', name: 'Sparrow', role: 'Field medic, runs toward the noise', voice: F,
    bio: 'Patched up half the yard crews in the district before she ever picked up a rifle. Still carries more bandages than magazines.',
    unlock: null, kit: { core: 'light', back: 'medpack', extra: 'armband', gear: 'helmet', hair: 'bun', face: 'plain' },
    look: { w: 0.9, h: 0.95, l: 0.86, sh: 0.9, hip: 1.02, head: 0.96, skin: 0x8d5a3b, hair: 0x1e1612, sleeve: 0x4a5244, trouser: 0x3a4036 } },
  { id: 'coyote', name: 'Coyote', role: 'Desert scout, cap and shades', voice: M,
    bio: 'Grew up on the salt flats past the end of the line. Can find water, shade and your flank, in that order.',
    unlock: { level: 3 }, kit: { core: 'light', back: 'canteen', extra: 'bandolier', gear: 'desertcap', hair: null, face: 'beard+shades' },
    look: { w: 0.96, h: 1.02, l: 0.94, sh: 1, hip: 1, head: 1, skin: 0xb27a52, hair: 0x2a1c12, sleeve: 0x8a7656, trouser: 0x6b5a40 } },
  { id: 'vesper', name: 'Vesper', role: 'Marksman with a long braid and a drag bag', voice: F,
    bio: 'Counts her breaths, not her shots. The braid is regulation length; she checked.',
    unlock: { level: 6 }, kit: { core: 'light', back: 'dragbag', extra: 'scrim', gear: 'cap', hair: 'braid', face: 'plain' },
    look: { w: 0.88, h: 1, l: 0.85, sh: 0.88, hip: 1, head: 0.95, skin: 0xe0b49a, hair: 0xa8743a, sleeve: 0x55603e, trouser: 0x434a32 } },
  { id: 'wren', name: 'Wren', role: 'Drone pilot, the drone rides on her back', voice: F,
    bio: 'Flew cargo drones over the yards until someone asked if they could carry anything louder. Ponytail out the back of the flight helmet.',
    unlock: { level: 10 }, kit: { core: 'plate', back: 'dronecase', extra: null, gear: 'flight', hair: 'pony', face: 'plain' },
    look: { w: 0.92, h: 0.97, l: 0.88, sh: 0.9, hip: 1.02, head: 0.96, skin: 0xc68e68, hair: 0x3a2418, sleeve: 0x3c4450, trouser: 0x2e343e } },
  { id: 'ox', name: 'Ox', role: 'Belt-fed and built like a boxcar', voice: M,
    bio: 'Was the yard\'s strongest loader before the yard became a front. Carries the ammo can because nobody else can lift it.',
    unlock: { life: 'cat:LMG', goal: 50, label: 'Get 50 LMG kills' }, kit: { core: 'heavy', back: 'ammobox', extra: 'belts', gear: 'beanie', hair: null, face: 'beard' },
    look: { w: 1.22, h: 1.04, l: 1.24, sh: 1.06, hip: 0.98, head: 1.02, skin: 0x5a3a28, hair: 0x0e0c0a, sleeve: 0x4a4636, trouser: 0x3a3a2e } },
  { id: 'morse', name: 'Morse', role: 'Signals clerk turned forward observer', voice: F,
    bio: 'Ran the switchboard at the depot. Now she calls the strikes, by radio, from the front, under a beret.',
    unlock: { level: 16 }, kit: { core: 'light', back: 'radio', extra: 'binos', gear: 'beret', hair: 'bob', face: 'plain' },
    look: { w: 0.9, h: 0.93, l: 0.86, sh: 0.9, hip: 1.03, head: 0.96, skin: 0x6b4630, hair: 0x120e0c, sleeve: 0x4a4a3a, trouser: 0x3a3a2e } },
  { id: 'cipher', name: 'Cipher', role: 'Electronic warfare, a dish on his back', voice: M,
    bio: 'Listens to the other side\'s radios for fun. The dish is homemade; it works better than the issued one.',
    unlock: { level: 20 }, kit: { core: 'light', back: 'dish', extra: null, gear: 'backcap', hair: 'crop', face: 'glasses' },
    look: { w: 0.94, h: 1, l: 0.9, sh: 0.98, hip: 1, head: 1, skin: 0xd8a888, hair: 0x3a2a1c, sleeve: 0x3a3f4a, trouser: 0x2e323a } },
  { id: 'harrow', name: 'Harrow', role: 'Mountain trooper under a fur hat', voice: M,
    bio: 'Came down from the high passes with a rope, an ice axe and a beard you could lose a grenade in.',
    unlock: { level: 25 }, kit: { core: 'plate', back: 'rope', extra: null, gear: 'furhat', hair: null, face: 'beard' },
    look: { w: 1.06, h: 1.03, l: 1.06, sh: 1.02, hip: 1, head: 1.02, skin: 0xe8c0a0, hair: 0x8a5a30, sleeve: 0x5a5048, trouser: 0x3e3a36 } },
  { id: 'sable', name: 'Sable', role: 'Desert raider, wrapped against the sand', voice: F,
    bio: 'Runs the convoys nobody else will drive. Her hair goes under the wrap, and her plans stay under it too.',
    unlock: { level: 28 }, kit: { core: 'light', back: 'bedroll', extra: 'shemagh', gear: 'wrap', hair: 'long', face: 'shades' },
    look: { w: 0.9, h: 0.99, l: 0.86, sh: 0.9, hip: 1.02, head: 0.96, skin: 0xa86f4c, hair: 0x221812, sleeve: 0x9a8460, trouser: 0x7a6a4c } },
  { id: 'marshal', name: 'Marshal', role: 'Old officer, peaked cap and long coat', voice: M,
    bio: 'Has commanded this yard through three wars and two owners. The moustache predates both.',
    unlock: { level: 40 }, kit: { core: 'coat', back: null, extra: 'epaulettes', gear: 'officer', hair: 'crop', face: 'moustache' },
    look: { w: 1, h: 1.05, l: 0.96, sh: 1.02, hip: 1, head: 1, skin: 0xe0b090, hair: 0x9a9a9a, sleeve: 0x3a3644, trouser: 0x2a2732 } },
  { id: 'flint', name: 'Flint', role: 'Sapper; brings her own door', voice: F,
    bio: 'Demolitions, first class. If a wall is in the way, she does not see a wall; she sees a schedule.',
    unlock: { life: 'plants', goal: 5, label: 'Plant 5 bombs in Search and Destroy' }, kit: { core: 'heavy', back: 'satchels', extra: 'bandolier', gear: 'beanie', hair: 'crop', face: 'goggles' },
    look: { w: 1.02, h: 0.98, l: 0.98, sh: 0.94, hip: 1.04, head: 0.97, skin: 0xf0c6a8, hair: 0xc8562a, sleeve: 0x4a4038, trouser: 0x3a332c } },
  { id: 'nyx', name: 'Nyx', role: 'Night raider behind four lit eyes', voice: F,
    bio: 'Works the late shift. All of it. The four green eyes are the last thing most of the yard ever sees.',
    unlock: { life: 'cat:SMG', goal: 50, label: 'Get 50 SMG kills' }, kit: { core: 'light', back: 'smallpack', extra: 'grenades', gear: 'nvg', hair: 'bun', face: 'balaclava' },
    look: { w: 0.86, h: 0.96, l: 0.84, sh: 0.88, hip: 1, head: 0.95, skin: 0x7a5038, hair: 0x0c0a0a, sleeve: 0x22262c, trouser: 0x1c1f24 } },
  { id: 'halcyon', name: 'Halcyon', role: 'Arctic ranger in a fur-ruffed hood', voice: F,
    bio: 'Spent four winters on the northern line keeping the points from freezing. Cold does not slow her; it slows you.',
    unlock: { life: 'sndRounds', goal: 10, label: 'Win 10 Search and Destroy rounds' }, kit: { core: 'parka', back: 'snowpack', extra: 'furcollar', gear: 'hood', hair: null, face: 'goggles+scarf' },
    look: { w: 0.98, h: 0.97, l: 0.9, sh: 0.94, hip: 1.02, head: 0.96, skin: 0xe8c0a8, hair: 0xe8dcc0, sleeve: 0xb8bec4, trouser: 0x6a7480 } },
  { id: 'tinker', name: 'Tinker', role: 'Rail mechanic, goggles up and tools out', voice: M,
    bio: 'Keeps the locomotives running and the sentries shooting. Will fix your gun if you stop talking.',
    unlock: { life: 'captures', goal: 25, label: 'Capture 25 objectives' }, kit: { core: 'plate', back: 'toolrack', extra: 'toolbelt', gear: 'weldband', hair: 'crop', face: 'moustache' },
    look: { w: 1, h: 0.96, l: 1, sh: 1, hip: 1, head: 1, skin: 0x9a6a48, hair: 0x5a5a5a, sleeve: 0x4a4e55, trouser: 0x34383e } },
  { id: 'rook', name: 'Rook', role: 'Urban breacher with a mohawk and ear defenders', voice: M,
    bio: 'Rooms, stairwells, signal boxes: if it has a door, he has cleared it. The mohawk is for morale.',
    unlock: { life: 'cat:Shotgun', goal: 50, label: 'Get 50 Shotgun kills' }, kit: { core: 'heavy', back: 'smallpack', extra: 'grenades', gear: 'earpro', hair: 'mohawk', face: 'plain' },
    look: { w: 1.1, h: 1, l: 1.1, sh: 1.04, hip: 1, head: 1, skin: 0xc8a080, hair: 0x1a1410, sleeve: 0x3a3e46, trouser: 0x2c3036 } },
  { id: 'mako', name: 'Mako', role: 'Combat diver, tanks and a hood', voice: M,
    bio: 'Comes in from the harbour side, under the pier, while everyone watches the road.',
    unlock: { life: 'cat:Marksman', goal: 50, label: 'Get 50 Marksman kills' }, kit: { core: 'wetsuit', back: 'tanks', extra: null, gear: 'divehood', hair: null, face: 'mask' },
    look: { w: 0.96, h: 1.01, l: 0.92, sh: 1, hip: 0.98, head: 1, skin: 0x8a5a3c, hair: 0x0e0c0a, sleeve: 0x1e2226, trouser: 0x1a1d22 } },
  { id: 'seraph', name: 'Seraph', role: 'Winged helm and a lit visor, for prestige only', voice: F,
    bio: 'Third time through the ranks and still the first one through the door. The wings were a gift from her squad.',
    unlock: { prestige: 3 }, kit: { core: 'plate', back: 'smallpack', extra: 'wings', gear: 'wingcrest', hair: 'braid', face: 'visor' },
    look: { w: 0.94, h: 1.04, l: 0.9, sh: 0.9, hip: 1, head: 0.96, skin: 0xc89878, hair: 0xe0d0a0, sleeve: 0x4a4458, trouser: 0x34303e } },
  { id: 'warden', name: 'Warden', role: 'Tower helm and a lantern, for prestige only', voice: M,
    bio: 'Keeps the last light on the line. Fifth prestige, and he has never once let it go out.',
    unlock: { prestige: 5 }, kit: { core: 'heavy', back: 'lantern', extra: null, gear: 'tower', hair: null, face: 'plain' },
    look: { w: 1.14, h: 1.07, l: 1.12, sh: 1.04, hip: 1, head: 1.02, skin: 0x6a4632, hair: 0x0e0c0a, sleeve: 0x3a3a40, trouser: 0x2a2a30 } },
];

export const OPERATOR_IDS = OPERATORS.map(o => o.id);
export const DEFAULT_OPERATOR = OPERATORS[0].id;
export const getOperator = id => OPERATORS.find(o => o.id === id) ?? OPERATORS[0];

// Peers on another version may send anything, so this is the only way an id reaches a roster.
export const cleanOperator = id => (OPERATOR_IDS.includes(id) ? id : DEFAULT_OPERATOR);

// `career` is { level (peak), prestige, kills, head, long, slide, clean, life }. `life` is the lifetime tally
// (Progress.lifetime(): 'cat:SMG' kills by class, 'plants', 'captures', 'sndRounds' won, ...) that operator challenges
// read; a save from before it existed simply starts counting.
export function operatorUnlock(op, career) {
  const u = op.unlock;
  if (!u) return { unlocked: true, requirement: 'Available from the start', value: 1, goal: 1 };
  if (u.level) return { unlocked: career.level >= u.level, requirement: `Reach level ${u.level}`, value: Math.min(career.level, u.level), goal: u.level };
  if (u.prestige) return { unlocked: career.prestige >= u.prestige, requirement: `Reach prestige rank ${u.prestige}`, value: Math.min(career.prestige, u.prestige), goal: u.prestige };
  if (u.life) {
    const value = Math.min(Math.floor(career.life?.[u.life] ?? 0), u.goal);
    return { unlocked: value >= u.goal, requirement: u.label, value, goal: u.goal, challenge: true };
  }
  const value = Math.min(career[u.stat] ?? 0, u.goal);
  return { unlocked: value >= u.goal, requirement: `${u.goal} ${u.label}`, value, goal: u.goal, challenge: true };
}
export const isFemale = op => getOperator(op?.id ?? op).voice === F;

/* ---------- Skins ---------- */
// Ids follow the mastery reward ids (docs/PROGRESSION.md): `skin:<operator>-2` .. `-5` are granted by the operator's
// mastery track at those tiers; `skin:<operator>-field` is earned by career numbers; `skin:<operator>-base` is the issue
// look (equipped as null in Progress). `slot` is the gear set a skin switches on in characters.js (0 none, 1 elite gear,
// 2 mastery trim and halo). `glow`: 0 accent lit like paint, 1 self-lit, 2 pulsing, 3 prism cycle.
// Tiers 2 and 4 came with the operators wave: every operator, old and new, has four mastery skins.
export const SKIN_TIERS = {
  base:  { label: 'Issue', slot: 0, order: 0 },
  field: { label: 'Field', slot: 0, order: 1 },
  2:     { label: 'Veteran', slot: 0, order: 2 },
  3:     { label: 'Elite', slot: 1, order: 3 },
  4:     { label: 'Specialist', slot: 1, order: 4 },
  5:     { label: 'Mastery', slot: 2, order: 5 },
};
const STAT_LABEL = { kills: 'gun kills', head: 'headshots', long: 'longshots', slide: 'slide kills', clean: 'equipment-free kills' };

// Palettes the generated rows draw from: [gear, sleeve, trouser, accent, glow].
const PAL = {
  urban: [0x8a9098, 0x6c7178, 0x4a4e55, 0x9fe8ff, 0], desert: [0xb59a6a, 0xa48a5e, 0x7d6a4a, 0xffd08a, 0],
  woodland: [0x4c5a32, 0x56643a, 0x3e4a2a, 0xc8ff6a, 0], arctic: [0xd8dee2, 0xc4ccd2, 0x8f9aa2, 0x4dc8ff, 0],
  night: [0x26332a, 0x2a3a2e, 0x1e2a22, 0x5dff7a, 1], navy: [0x2c3f5e, 0x2a3a56, 0x1e2a40, 0xbfe0ff, 0],
  rust: [0x8a4420, 0x5a2f1a, 0x3a2418, 0xffb14a, 0], crimson: [0x5a1a1c, 0x4a1618, 0x2a1012, 0xff3a2a, 1],
  olive: [0x5a5a2e, 0x55553a, 0x3a3a28, 0xffcc33, 1], ash: [0xb8b4ac, 0x9a968e, 0x6a6660, 0xd02a2a, 0],
  violet: [0x1c1420, 0x2a1e30, 0x161018, 0xb04aff, 1], teal: [0x1c3a3a, 0x22464a, 0x16282c, 0x3affd8, 1],
  slate: [0x3a4048, 0x343a42, 0x24282e, 0xff7a1a, 1], ivory: [0xe8e0cc, 0xd4ccb8, 0x8a8270, 0xd9b44a, 0],
  toxic: [0x3a4a22, 0x44542a, 0x2a3218, 0xc6ff2a, 1], ember: [0x3a2a24, 0x46302a, 0x2a1c18, 0xff6a2a, 1],
  sky: [0x6a8aa8, 0x5a7a98, 0x3a5068, 0xffffff, 0], moss: [0x5a6040, 0x4a5236, 0x343a26, 0xffd08a, 0],
  gold: [0xc9a240, 0x4a3c20, 0x2e2616, 0xffe08a, 2], molten: [0x2a1410, 0x3a1a12, 0x22100c, 0xff5a10, 2],
  moon: [0x161a2a, 0x1c2236, 0x12141e, 0x9ad8ff, 2], royal: [0x2a2236, 0x3a2e4c, 0x221a2c, 0xffd659, 2],
  prism: [0x2a2440, 0x3a2f5a, 0x221c36, 0x18e8ff, 3], wraith: [0x1a1428, 0x241c36, 0x140f1e, 0xff2bd6, 3],
  aurora: [0x142a2a, 0x1a3636, 0x101e1e, 0x5affb0, 3],
};
// One row per operator: [field, tier 2, tier 3, tier 4, tier 5], each [name, palette or [gear, sleeve, trouser, accent,
// glow], field rule]. gear recolours the plain kit (not faces, hair or team armour); accent repaints visors, lenses,
// lamps and trims. The first nine operators' field, 3 and 5 rows are their original skins, unchanged.
const SKIN_ROWS = {
  trooper: [
    ['Urban Grey', [0x8a9098, 0x6c7178, 0x4a4e55, 0x9fe8ff, 0], { stat: 'kills', goal: 200 }], ['Woodland', 'woodland'],
    ['Night Recon', [0x26332a, 0x2a3a2e, 0x1e2a22, 0x5dff7a, 1]], ['Blue Line', 'navy'], ['Sovereign', [0xc9a240, 0x4a3c20, 0x2e2616, 0xffe08a, 2]],
  ],
  wisp: [
    ['Drifter', [0xb59a6a, 0xa48a5e, 0x7d6a4a, 0xffd08a, 0], { stat: 'long', goal: 50 }], ['Fern', 'moss'],
    ['Veil', [0x4c5a32, 0x56643a, 0x3e4a2a, 0xc8ff6a, 1]], ['Will-o', 'teal'], ['Prism Wisp', [0x2a2440, 0x3a2f5a, 0x221c36, 0x18e8ff, 3]],
  ],
  anvil: [
    ['Foundry', [0x8a4420, 0x5a2f1a, 0x3a2418, 0xffb14a, 0], { stat: 'kills', goal: 600 }], ['Gunmetal', 'urban'],
    ['Bulwark', [0x3a4a66, 0x34405a, 0x252c3c, 0xff4a2a, 1]], ['Slag', 'ember'], ['Molten', [0x2a1410, 0x3a1a12, 0x22100c, 0xff5a10, 2]],
  ],
  relay: [
    ['Arctic Signal', [0xd8dee2, 0xc4ccd2, 0x8f9aa2, 0x4dc8ff, 0], { level: 20 }], ['Field Telephone', 'desert'],
    ['Long Wave', [0x5a5a2e, 0x55553a, 0x3a3a28, 0xffcc33, 1]], ['Static', 'violet'], ['Carrier Wave', [0x1c2a3a, 0x22344a, 0x18222e, 0x7cf8ff, 3]],
  ],
  yarddog: [
    ['Night Shift', [0x2e3440, 0x3a4250, 0x262c36, 0xff7a1a, 0], { stat: 'clean', goal: 150 }], ['Rust Belt', 'rust'],
    ['Switch Tender', [0x5a4232, 0x4a3a2c, 0x2c3a2a, 0x39ff9a, 1]], ['Signal Red', 'crimson'], ['Golden Spike', [0xd0a640, 0x5c4a26, 0x3a2e18, 0xfff1a0, 2]],
  ],
  ronin: [
    ['Ash', [0xb8b4ac, 0x9a968e, 0x6a6660, 0xd02a2a, 0], { stat: 'slide', goal: 80 }], ['Bamboo', 'moss'],
    ['Oni', [0x5a1a1c, 0x4a1618, 0x2a1012, 0xff3a2a, 1]], ['Lantern', 'ember'], ['Moonlit', [0x161a2a, 0x1c2236, 0x12141e, 0x9ad8ff, 2]],
  ],
  ghoul: [
    ['Toxic', [0x3a4a22, 0x44542a, 0x2a3218, 0xc6ff2a, 1], { stat: 'head', goal: 300 }], ['Bone', 'ash'],
    ['Cyclops', [0x2a2c32, 0x30323a, 0x1e2026, 0xff2a3a, 1]], ['Spore', 'teal'], ['Wraith', [0x1a1428, 0x241c36, 0x140f1e, 0xff2bd6, 3]],
  ],
  ram: [
    ['Riot Blue', [0x2c3f5e, 0x2a3a56, 0x1e2a40, 0xbfe0ff, 0], { stat: 'slide', goal: 150 }], ['Hazard', 'slate'],
    ['Siege', [0x6a6650, 0x56523e, 0x3a382a, 0xffb000, 1]], ['Furnace', 'ember'], ['Battering Gold', [0xc89a3a, 0x5a4422, 0x3a2c16, 0xfff0b0, 2]],
  ],
  monarch: [
    ['Ivory Court', [0xe8e0cc, 0xd4ccb8, 0x8a8270, 0xd9b44a, 0], { prestige: 2 }], ['Pretender', 'navy'],
    ['Usurper', [0x1c1420, 0x2a1e30, 0x161018, 0xb04aff, 1]], ['Regent', 'crimson'], ['Sovereign Prism', [0x2a2236, 0x3a2e4c, 0x221a2c, 0xffd659, 3]],
  ],
  sparrow: [['Field Hospital', 'ivory', { stat: 'kills', goal: 150 }], ['Hedgerow', 'woodland'], ['Night Ward', 'night'], ['Lifeline', 'teal'], ['Golden Hour', 'gold']],
  coyote: [['Salt Flat', 'ash', { stat: 'long', goal: 40 }], ['Dune', 'desert'], ['Mirage', 'ember'], ['Dust Devil', 'rust'], ['Sun Dog', 'molten']],
  vesper: [['Hide', 'moss', { stat: 'long', goal: 80 }], ['Frost Hide', 'arctic'], ['Dusk', 'violet'], ['Evening Star', 'navy'], ['Northern Lights', 'aurora']],
  wren: [['Grey Wing', 'urban', { stat: 'kills', goal: 300 }], ['High Desert', 'desert'], ['Night Flight', 'night'], ['Clear Sky', 'sky'], ['Prism Rotor', 'prism']],
  ox: [['Yard Brown', 'rust', { stat: 'kills', goal: 500 }], ['Drab', 'olive'], ['Furnace', 'ember'], ['Iron', 'slate'], ['Golden Yoke', 'gold']],
  morse: [['Dispatch', 'navy', { level: 24 }], ['Field Post', 'olive'], ['Dot Dash', 'violet'], ['Frequency', 'teal'], ['Carrier Gold', 'royal']],
  cipher: [['White Noise', 'ash', { stat: 'kills', goal: 300 }], ['Grid', 'urban'], ['Encrypted', 'toxic'], ['Black Box', 'night'], ['Prism Key', 'prism']],
  harrow: [['Snowline', 'arctic', { stat: 'kills', goal: 400 }], ['Scree', 'urban'], ['Pine', 'woodland'], ['Avalanche', 'sky'], ['Moonlit Peak', 'moon']],
  sable: [['Sandstorm', 'desert', { stat: 'slide', goal: 60 }], ['Oasis', 'teal'], ['Red Rock', 'rust'], ['Night Caravan', 'violet'], ['Sunfire', 'molten']],
  marshal: [['Dress Whites', 'ivory', { prestige: 1 }], ['Field Grey', 'urban'], ['Staff', 'crimson'], ['Old Guard', 'navy'], ['Field Marshal', 'royal']],
  flint: [['Quarry', 'ash', { stat: 'kills', goal: 300 }], ['Hazard', 'slate'], ['Fuse', 'ember'], ['Blast Door', 'olive'], ['Shaped Charge', 'molten']],
  nyx: [['Shadow', 'night', { stat: 'clean', goal: 100 }], ['City Night', 'navy'], ['Nightshade', 'violet'], ['Witching Hour', 'crimson'], ['Eclipse', 'wraith']],
  halcyon: [['Whiteout', 'arctic', { stat: 'kills', goal: 300 }], ['Tundra', 'urban'], ['Polar Night', 'night'], ['Glacier', 'sky'], ['Aurora', 'aurora']],
  tinker: [['Grease', 'slate', { stat: 'clean', goal: 120 }], ['Workshop', 'olive'], ['Arc Weld', 'teal'], ['Boiler', 'rust'], ['Brass Works', 'gold']],
  rook: [['Concrete', 'urban', { stat: 'slide', goal: 80 }], ['Brick', 'rust'], ['Riot', 'navy'], ['Firebreak', 'crimson'], ['Checkmate', 'moon']],
  mako: [['Reef', 'teal', { stat: 'long', goal: 40 }], ['Kelp', 'moss'], ['Deep Water', 'navy'], ['Bioluminescent', 'aurora'], ['Abyss', 'wraith']],
  seraph: [['Choir', 'ivory', { prestige: 4 }], ['Steel Feather', 'urban'], ['Fallen', 'crimson'], ['Dawn', 'sky'], ['Radiant', 'royal']],
  warden: [['Keeper', 'slate', { prestige: 6 }], ['Lamplighter', 'olive'], ['Watchfire', 'ember'], ['Last Light', 'night'], ['Eternal Flame', 'gold']],
};

const ROW_TIERS = ['field', 2, 3, 4, 5];
export const SKINS = OPERATORS.flatMap(op => [
  { id: `skin:${op.id}-base`, operator: op.id, tier: 'base', name: 'Standard issue', slot: 0, glow: 0,
    gear: null, sleeve: op.look.sleeve, trouser: op.look.trouser, accent: null, unlock: null },
  ...SKIN_ROWS[op.id].map(([name, pal, rule], i) => {
    const [gear, sleeve, trouser, accent, glow] = typeof pal === 'string' ? PAL[pal] : pal, tier = ROW_TIERS[i];
    // A Specialist skin wears the elite gear with its accent self-lit.
    return { id: `skin:${op.id}-${tier}`, operator: op.id, tier, name, slot: SKIN_TIERS[tier].slot,
      glow: tier === 4 ? Math.max(1, glow) : glow, gear, sleeve, trouser, accent, unlock: rule ?? { grant: true } };
  }),
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
  if (u.life) return operatorUnlock({ unlock: u }, career);
  if (u.stat) return { ...operatorUnlock({ unlock: { ...u, label: STAT_LABEL[u.stat] ?? u.stat } }, career), requirement: `${u.goal.toLocaleString('en-US')} ${STAT_LABEL[u.stat] ?? u.stat}` };
  return operatorUnlock({ unlock: u }, career);
}

// Bots dress from the same wardrobe, decided by their id so every client agrees: mostly issue kit, some field
// colours, a few elite sets and the odd mastery skin.
export function botSkin(operator, id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const u = ((h >>> 0) % 1000) / 1000;
  const tier = u < 0.4 ? 'base' : u < 0.6 ? 'field' : u < 0.75 ? 2 : u < 0.86 ? 3 : u < 0.95 ? 4 : 5;
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
