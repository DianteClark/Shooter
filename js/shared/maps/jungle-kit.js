// Pieces for the jungle and arctic maps, by what they are. Each returns one entry for `rotated` (see build.js): a wall
// kind that says what it blocks, plus a flag the renderer (js/render/themes/jungle.js, arctic.js) dresses it by.
// Landmarks are functions returning lists, so the battle royale map can drop the same buildings in.

// ---- Jungle --------------------------------------------------------------------------------------------------
export const tree = (x, z, s = 2.2) => [x, z, s, s, 4.6, 'rock', { tree: true }];           // Buttressed trunk, canopy.
export const thicket = (x, z, w, d) => [x, z, w, d, 2.6, 'rock', { thicket: true }];       // Dense growth: solid.
export const ruin = (x, z, w, d, h = 3.1) => [x, z, w, d, h, 'rock', { ruin: true }];      // Temple masonry.
export const pillar = (x, z, s = 1.2) => [x, z, s, s, 3.4, 'rock', { ruin: 'pillar' }];
export const statue = (x, z, s = 1.2) => [x, z, s, s, 2.8, 'rock', { ruin: 'statue' }];
export const fern = (x, z, w, d) => [x, z, w, d, 1.0, 'boulder', { fern: true }];          // Waist-high: see over.
export const block = (x, z, w, d) => [x, z, w, d, 1.0, 'boulder', { fallen: true }];       // Fallen masonry, low.
export const log = (x, z, w, d) => [x, z, w, d, 0.9, 'boulder', { log: true }];
export const hut = (x, z, w, d, h = 3.6) => [x, z, w, d, h, 'building', { hut: true }];   // Thatched, on stilts.
export const lab = (x, z, w, d, h = 3.4) => [x, z, w, d, h, 'building', { lab: true }];   // Research cabin, tin roof.
export const tent = (x, z, w, d) => [x, z, w, d, 2.6, 'tent', { camp: true }];
export const crate = (x, z, w = 1.6, d = 1.6) => [x, z, w, d, 1.1, 'crate'];
export const sandbag = (x, z, w, d) => [x, z, w, d, 1.0, 'sandbag'];
export const canoe = (x, z, w, d) => [x, z, w, d, 0.7, 'crate', { canoe: true }];
export const bamboo = (x, z, w, d) => [x, z, w, d, 2.5, 'wall', { bamboo: true }];        // Bamboo screen, solid.
export const crops = (x, z, w, d) => [x, z, w, d, 1.1, 'barrier', { crop: true }];         // Coffee row: see over.
export const banana = (x, z, w, d) => [x, z, w, d, 3.2, 'rock', { banana: true }];        // Banana grove: solid.
export const truck = (x, z, w, d) => [x, z, w, d, 2.4, 'container', { truck: true }];
export const drums = (x, z, w, d) => [x, z, w, d, 1.1, 'barrier', { drums: true }];
export const tin = (x, z, w, d) => [x, z, w, d, 3.4, 'wall', { tin: true }];             // Hangar and shed walls.

// ---- Arctic --------------------------------------------------------------------------------------------------
export const module_ = (x, z, w, d, h = 3.6) => [x, z, w, d, h, 'building', { module: true }];   // Station module.
export const tank = (x, z, s = 3) => [x, z, s, s, 4.2, 'building', { tank: true }];
export const dome = (x, z, s = 5) => [x, z, s, s, 4.8, 'building', { dome: true }];
export const iceBlock = (x, z, w, d, h = 2.6) => [x, z, w, d, h, 'rock', { ice: true }];  // Upended floe: solid.
export const ridge = (x, z, w, d) => [x, z, w, d, 1.0, 'sandbag', { ridge: true }];       // Pressure ridge: see over.
export const stack = (x, z, w, d) => [x, z, w, d, 2.8, 'container', { box: true }];
export const snowcat = (x, z, w = 3.6, d = 2) => [x, z, w, d, 2.3, 'container', { snowcat: true }];
export const hull = (x, z, w, d, h = 3.4, extra = {}) => [x, z, w, d, h, 'hull', { plate: true, ...extra }];
export const deckhouse = (x, z, w, d) => [x, z, w, d, 5.2, 'building', { deckhouse: true }];
export const hatch = (x, z, w = 2.4, d = 2.4) => [x, z, w, d, 1.0, 'crate', { hatch: true }];

// ---- Landmarks -----------------------------------------------------------------------------------------------

// Walled temple court, its corner at (x, z), w x d outside. Gates in the middle of each side, `gate` wide, each
// split by a statue or a broken pillar. Returns the walls of the whole square (it is its own 180-degree image only
// when centred; list it outside `rotated` then).
export function templeCourt(x, z, w, d, gate = 7, t = 1.2, h = 3.2) {
  const hw = (w - gate) / 2, hd = (d - gate) / 2;
  return [
    [x, z, hw, t, h, 'rock', { ruin: true }], [x + w - hw, z, hw, t, h, 'rock', { ruin: true }],
    [x, z + d - t, hw, t, h, 'rock', { ruin: true }], [x + w - hw, z + d - t, hw, t, h, 'rock', { ruin: true }],
    [x, z + t, t, hd - t, h, 'rock', { ruin: true }], [x, z + d - hd, t, hd - t, h, 'rock', { ruin: true }],
    [x + w - t, z + t, t, hd - t, h, 'rock', { ruin: true }], [x + w - t, z + d - hd, t, hd - t, h, 'rock', { ruin: true }],
    statue(x + w / 2 - 0.6, z), statue(x + w / 2 - 0.6, z + d - 1.2),
    pillar(x, z + d / 2 - 0.6), pillar(x + w - 1.2, z + d / 2 - 0.6),
  ];
}
