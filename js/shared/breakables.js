// Destruction side table (docs/DESTRUCTION.md "Map data"): per map id, what breaks beyond (or instead of) the kind
// rules in js/shared/destruction.js. Append-only data, kept out of the map files so whoever reworks or stitches maps
// carries it over as is: a pick is a point inside the wall it means, never a wall index.
//   pick:   [[x, z, material | null], ...]  the wall containing (x, z) gets that material ('glass' 'wood' 'light'
//           'heavy'), or never breaks (null), whatever the rules say
//   mirror: true                            each pick also applies at its 180-degree image (maps built with `rotated`)
//   off:    true                            nothing on this map breaks
export const BREAKABLES = {
  // Graveyard Shift's own maps: the mode keeps its barricades and gates (docs/ZOMBIES.md); nothing else breaks there.
  ashgrove: { off: true },
  polestar: { off: true },
  wrenfield: { off: true },
  range: { off: true },
  // The two small dockside tanks either side of the middle: steel, but thin enough for a launcher or a strike.
  harbor: { mirror: true, pick: [[32, 24, 'heavy'], [36.9, 26.9, 'heavy']] },
  // The water tanks by the huts.
  canyon: { mirror: true, pick: [[72.8, 20.8, 'heavy']] },
};
