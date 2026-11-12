// Graveyard Shift's undead (docs/ZOMBIES.md), in the operators' own parts kit (js/render/operator-kit.js): the same
// low-poly soldier, greyed and torn. They exist only in the renderer: js/render/characters.js appends them to its
// operator table after the roster's MAX_OPERATORS slots (five more uniform slots), so menus,
// progression and the bot pool never see them. A seat's look comes from the view each frame (`zk`: 1 shambler,
// 2 runner, 3 brute, 4 boss, 5 the Gravewarden), because one roster seat raises many zombies of different kinds.
export const ZM_OPERATORS = [
  { id: 'zm-shambler', name: 'Shambler', kit: { core: 'light', back: null, extra: null, gear: null, hair: 'long', face: 'plain' },
    look: { w: 0.96, h: 0.96, l: 0.97, sh: 0.92, hip: 1, head: 1.02, skin: 0x7d9468, hair: 0x2b2a22, sleeve: 0x4d463a, trouser: 0x37342c } },
  { id: 'zm-runner', name: 'Runner', kit: { core: 'light', back: null, extra: null, gear: null, hair: 'crop', face: 'plain' },
    look: { w: 0.9, h: 0.98, l: 0.92, sh: 0.88, hip: 0.98, head: 0.98, skin: 0x9aa886, hair: 0x1a1814, sleeve: 0x6a2c2a, trouser: 0x2c3240 } },
  { id: 'zm-brute', name: 'Brute', kit: { core: 'heavy', back: null, extra: 'belts', gear: null, hair: null, face: 'beard' },
    look: { w: 1.36, h: 1.12, l: 1.34, sh: 1.16, hip: 1.04, head: 0.94, skin: 0x5f7a52, hair: 0x14120e, sleeve: 0x3c3a32, trouser: 0x2c2a24 } },
  { id: 'zm-boss', name: 'Yardmaster', kit: { core: 'heavy', back: 'lantern', extra: 'belts', gear: 'beanie', hair: null, face: 'beard' },
    look: { w: 1.62, h: 1.34, l: 1.58, sh: 1.2, hip: 1.06, head: 0.9, skin: 0x4d6a44, hair: 0x0c0a08, sleeve: 0x2e2a26, trouser: 0x221f1c } },
  // The Gravewarden (ROADMAP item 36): the altar's quest raises it. Taller and leaner than the Yardmaster, long-haired,
  // in a sexton's black, with the lantern on its back burning violet.
  { id: 'zm-warden', name: 'Gravewarden', kit: { core: 'heavy', back: 'lantern', extra: 'belts', gear: null, hair: 'long', face: 'beard' },
    look: { w: 1.5, h: 1.52, l: 1.66, sh: 1.24, hip: 1.02, head: 0.94, skin: 0x6e6a86, hair: 0xd8d4e0, sleeve: 0x1a1620, trouser: 0x15121a } },
];
// Per-kind clothes for the instance data (skins carry sleeve and trouser colours; no gear recolour, the boss glows).
export const ZM_SKIN_LOOKS = ZM_OPERATORS.map((o, k) => ({ sleeve: o.look.sleeve, trouser: o.look.trouser, accent: k === 3 ? 0xff7a1a : k === 4 ? 0xb070ff : null, glow: k >= 3 ? 1 : 0 }));
