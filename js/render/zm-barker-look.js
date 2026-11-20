// The Barker's look (Wrenfield Fair's quest boss, docs/ZOMBIES.md "Wrenfield Fair"), kept in its own file and hooked
// into js/render/zm-looks.js's table by one line, so the undead's art can change round it. The operators' parts kit
// (js/render/operator-kit.js), no new geometry: a showman gone wrong, tall and broad-shouldered in a red tailcoat
// with gold epaulettes and a peaked showman's cap, chalk-white face paint over grey skin, a shock of red hair. Its
// accent (the coat's trim and the glow) burns a fairground gold. Slot 11 of ZM_OPERATORS (view zk 12).
export const ZM_BARKER_OP = { id: 'zm-barker', name: 'Barker', kit: { core: 'coat', back: null, extra: 'epaulettes', gear: 'officer', hair: 'crop', face: 'plain' },
  look: { w: 1.42, h: 1.48, l: 1.56, sh: 1.3, hip: 1.0, head: 1.04, skin: 0xd8d0c8, hair: 0xd83a2a, sleeve: 0x8a1c22, trouser: 0x1a1418 } };
export const ZM_BARKER_ACCENT = 0xffc040;
