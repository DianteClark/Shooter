// Saltmere Abbey (coast, medium; Graveyard Shift only, docs/ZOMBIES.md "Saltmere Abbey"). A drowned abbey town on the
// salt marsh: the spring tide came over the sea wall one night and never went back out. Knee-deep brine in the
// streets, the abbey church's roof fallen into its nave, candles still burning in the windows and the bell in the
// tower silent. Built for the zombies mode, not for 6v6: hidden from every other playlist, no modes of its own
// (MODES.zm.maps puts it in Graveyard Shift).
//
// The story, as the crew walks it (x east, z south; the camera looks north):
//   Fish Quay        (start, south-centre)  the sea wall, the fish market hall, a moored smack, the harbour office.
//   Market Row       (south-west)           shops along a flooded street, the market cross; the chandlery (a dead end:
//                                            a crate spot, the first font).
//   The Cloister     (north-west)           the cloister walk round the garth and its lavabo; the chapter house (a dead
//                                            end: a crate spot, the second font).
//   Cathedral Close  (north)                the west front and its steps, the upgrade bench at the tower's foot.
//   The Pump House   (centre)               the marsh pumps and the POWER switch: walled in, reached from Market Row or
//                                            the Nave.
//   The Drowned Nave (north-east)           the roofless nave between its piers: the boss arena, the bell tower.
//   Lifeboat Slip    (south-east)           the lifeboat house, the hard (the exfil), the slipway (a dead end: a crate
//                                            spot, the third font).
// Gates make one loop (Fish Quay, Market Row, the Cloister, Cathedral Close, the Nave, Lifeboat Slip, back to the Quay)
// with the Pump House off Market Row and the Nave. The hidden quest is the fonts: with the power on the pumps fill
// the three dry fonts; a filled font wakes and drinks the drowned killed beside it; three full fonts, then toll the
// bell in the tower and the Ferryman comes up the nave.
// js/shared/zombies.js (zmLayout) reads the `zm` block below.
import { wall, perimeter, navGrid } from './build.js';

const W = 80, H = 52;
// Rubble-stone walls between the areas (the town's old walls and the abbey precinct); houses and the abbey are
// 'building'.
const stone = (x, z, w, d, h = 3.2, extra = {}) => wall(x, z, w, d, h, 'wall', { stone: true, ...extra });
const pier = (x, z, h = 7.5, extra = {}) => wall(x, z, 1, 1, h, 'crane', { pier: true, ...extra });
const pots = (x, z, w = 1.6, d = 1.2, extra = {}) => wall(x, z, w, d, 1.1, 'crate', { pots: true, ...extra });

function build() {
  const walls = [];
  walls.push(
    // ---- The walls between the areas (openings are the gates, see zm.gates).
    stone(25, 0, 1, 6), stone(25, 10, 1, 19), stone(25, 33, 1, 9), stone(25, 46, 1, 6),       // West line: gates at z 6, 29, 42.
    stone(54, 0, 1, 6), stone(54, 10, 1, 11), stone(54, 25, 1, 18), stone(54, 47, 1, 5),      // East line: gates at z 6, 21, 43.
    stone(0, 25, 10, 1), stone(14, 25, 11, 1),                                                 // Market Row / the Cloister, gate at x 10.
    stone(26, 16, 28, 1, 3.2, { precinct: true }),                                             // The Close / the Pump House.
    stone(26, 37, 28, 1, 3.2, { seawall: true }),                                              // The Pump House / the Quay.
    stone(55, 30, 11, 1), stone(70, 30, 10, 1),                                                // The Nave / Lifeboat Slip, gate at x 66.

    // ---- Fish Quay (start): the fish market hall, the harbour office, a moored smack, lobster pots.
    wall(29, 46, 6, 4, 3.4, 'building', { fishhall: true, landmark: true }),
    wall(47, 47, 5, 3.5, 3.2, 'building', { office: true }),
    wall(38.5, 50.2, 5.5, 1.8, 1.4, 'crate', { smack: true }),
    pots(28.5, 41, 1.2, 2), pots(51, 40.5),

    // ---- Market Row: shops on a flooded street; the chandlery in the south-west corner (one doorway, north).
    wall(3, 29, 7, 3, 3.6, 'building', { shop: 'baker', landmark: true }),
    wall(14, 33, 6, 3, 3.6, 'building', { shop: 'inn' }),
    wall(4, 37, 6, 3, 3.6, 'building', { shop: 'draper' }),
    stone(9, 44, 1, 8, 3, { chandlery: true }), stone(0, 44, 5, 1, 3, { chandlery: true }),
    wall(16.6, 41.6, 1.4, 1.4, 1.6, 'barrier', { cross: true }), pots(14, 48, 1.6, 1.6),

    // ---- The Cloister: the lavabo in the garth, the walk's piers; the chapter house in the north-west corner (one
    // doorway, south).
    wall(11, 12, 6, 6, 2.4, 'building', { lavabo: true, landmark: true }),
    pier(19.5, 5, 3.2, { arcade: true }), pier(19.5, 11.5, 3.2, { arcade: true }), pier(19.5, 18, 3.2, { arcade: true }),
    pier(6, 20.5, 3.2, { arcade: true }), pier(13, 20.5, 3.2, { arcade: true }),
    stone(9, 0, 1, 9, 3, { chapter: true }), stone(0, 8, 5, 1, 3, { chapter: true }),

    // ---- Cathedral Close: the west front and its tower base against the north wall, a fallen statue, yew stumps.
    wall(36, 0, 8, 4, 4.4, 'building', { westfront: true, landmark: true }),
    wall(29, 7, 2.2, 1.2, 1.2, 'crate', { statue: true }), wall(48, 9, 1.6, 1.6, 1.4, 'crate', { yew: true }),

    // ---- The Pump House (power): two marsh pumps, the engine house with the switch, a sluice gate box.
    wall(30, 20, 6, 2.6, 2.8, 'container', { pump: true }),
    wall(44, 21, 6, 2.6, 2.8, 'container', { pump: true }),
    wall(36, 26, 7, 4, 3.6, 'building', { enginehouse: true, landmark: true }),
    wall(30, 31.5, 3, 2, 1.6, 'crate', { sluice: true }),

    // ---- The Drowned Nave (boss arena): two rows of piers down the aisles, the high altar, a fallen pier, the bell
    // tower in the south-east corner (the bell rope on its west face).
    pier(59.5, 5.5), pier(59.5, 12.5), pier(59.5, 19.5),
    pier(74.5, 5.5), pier(74.5, 12.5), pier(74.5, 19.5),
    wall(64, 0, 7, 1.8, 1.4, 'barrier', { altar: true }),
    wall(62.5, 24, 4.2, 1.2, 1, 'barrier', { fallen: true }),
    wall(77, 22, 3, 4, 9, 'building', { belltower: true }),

    // ---- Lifeboat Slip: the lifeboat house against the south wall; the slipway in the south-east corner (one doorway,
    // north).
    wall(58, 46, 12, 6, 4.4, 'building', { lifeboat: true, landmark: true }),
    stone(73, 42, 1, 10, 3, { slipway: true }), stone(73, 41, 4, 1, 3, { slipway: true }),
    pots(76, 33, 1.6, 1.6),
  );
  perimeter(walls, W, H, 4);

  // Spawns only matter to tools (thumbnails, the validator): the zombies rules place everyone themselves.
  const spawns = [
    [{ x: 38, z: 42, aim: 0 }, { x: 41, z: 42, aim: 0 }, { x: 38, z: 45, aim: 0 }, { x: 41, z: 45, aim: 0 }],
    [{ x: 67, z: 16, aim: Math.PI }, { x: 64, z: 37, aim: Math.PI }, { x: 40, z: 10, aim: Math.PI }, { x: 14, z: 40, aim: Math.PI }],
  ];
  const lanes = [{ id: 'north', z: 9 }, { id: 'mid', z: 26 }, { id: 'south', z: 42 }];
  const nav = navGrid(walls, [4, 12, 21, 30, 40, 50, 62, 68, 72], [4, 10, 15, 27, 34, 41, 48]);

  // ---- Graveyard Shift layout (zmLayout's graph form, docs/ZOMBIES.md). Areas are found by flooding from `seed` with
  // every gate shut; everything else names a floor spot (x, z) and, for things on a wall, which side the wall is on
  // (`wall`: n, s, e, w).
  const zm = {
    areas: [
      { id: 'quay', name: 'Fish Quay', seed: { x: 40, z: 43 } },
      { id: 'market', name: 'Market Row', seed: { x: 13, z: 30 } },
      { id: 'cloister', name: 'The Cloister', seed: { x: 6, z: 14 } },
      { id: 'close', name: 'Cathedral Close', seed: { x: 40, z: 10 } },
      { id: 'pump', name: 'The Pump House', seed: { x: 40, z: 34 } },
      { id: 'nave', name: 'The Drowned Nave', seed: { x: 67, z: 14 } },
      { id: 'slip', name: 'Lifeboat Slip', seed: { x: 64, z: 38 } },
    ],
    start: 'quay',
    gates: [
      { x: 25, z: 42, w: 1, d: 4, a: 'quay', b: 'market', cost: 750 },
      { x: 54, z: 43, w: 1, d: 4, a: 'quay', b: 'slip', cost: 750 },
      { x: 10, z: 25, w: 4, d: 1, a: 'market', b: 'cloister', cost: 1000 },
      { x: 25, z: 29, w: 1, d: 4, a: 'market', b: 'pump', cost: 1250 },
      { x: 66, z: 30, w: 4, d: 1, a: 'slip', b: 'nave', cost: 1500 },
      { x: 54, z: 21, w: 1, d: 4, a: 'nave', b: 'pump', cost: 1250 },
      { x: 25, z: 6, w: 1, d: 4, a: 'cloister', b: 'close', cost: 1250 },
      { x: 54, z: 6, w: 1, d: 4, a: 'close', b: 'nave', cost: 1500 },
    ],
    wallBuys: [
      { x: 32, z: 45.3, wall: 's', gun: 'smg', cost: 1000 },            // Fish Quay: the fish hall's front.
      { x: 40, z: 38.7, wall: 'n', gun: 'shotgun', cost: 900 },         // Fish Quay: the pump house wall.
      { x: 6.5, z: 32.7, wall: 'n', gun: 'ar', cost: 1200 },            // Market Row: the baker's back.
      { x: 20.7, z: 34.5, wall: 'w', gun: 'dmr', cost: 1000 },          // Market Row: the inn.
      { x: 14, z: 18.7, wall: 'n', gun: 'pdw', cost: 1100 },            // The Cloister: the lavabo's south side.
      { x: 24.3, z: 14, wall: 'e', gun: 'heavysmg', cost: 1400 },       // The Cloister: the precinct wall.
      { x: 47, z: 24.3, wall: 'n', gun: 'heavyar', cost: 1500 },        // The Pump House: the east pump.
      { x: 30, z: 15.3, wall: 's', gun: 'autoshot', cost: 1500 },       // Cathedral Close: the precinct wall.
      { x: 50, z: 15.3, wall: 's', gun: 'battle', cost: 1600 },         // Cathedral Close: the precinct wall, east end.
      { x: 61, z: 29.3, wall: 's', gun: 'lmg', cost: 1800 },            // The Nave: the south aisle wall.
      { x: 55.7, z: 15, wall: 'w', gun: 'saw', cost: 1800 },            // The Nave: the west wall.
      { x: 67, z: 45.3, wall: 's', gun: 'carbine', cost: 1300 },        // Lifeboat Slip: the boathouse's front.
      { x: 60, z: 31.7, wall: 'n', gun: 'burstsmg', cost: 1400 },       // Lifeboat Slip: the nave wall.
    ],
    // Mystery crate spots: the first two are where it can start.
    boxes: [
      { x: 8.3, z: 48, wall: 'e' },         // Market Row: the chandlery (dead end).
      { x: 74.7, z: 48, wall: 'w' },        // Lifeboat Slip: the slipway (dead end).
      { x: 8.3, z: 3, wall: 'e' },          // The Cloister: the chapter house (dead end).
      { x: 78.5, z: 3.5, wall: 'e' },       // The Nave: the north-east chapel.
    ],
    machines: [
      { x: 46.3, z: 49, wall: 'e', perk: 'mercy' },      // Fish Quay: the harbour office.
      { x: 7, z: 40.7, wall: 'n', perk: 'stride' },      // Market Row: the draper's.
      { x: 17.7, z: 15, wall: 'w', perk: 'quick' },      // The Cloister: the lavabo's east side.
      { x: 40, z: 30.7, wall: 'n', perk: 'hammer' },     // The Pump House: the engine house's front.
      { x: 61, z: 45.3, wall: 's', perk: 'iron' },       // Lifeboat Slip: the boathouse's front, west end.
      { x: 55.7, z: 26, wall: 'w', perk: 'breath' },     // The Nave: the west wall, south end.
    ],
    // The power switch on the engine house's west side: free, but someone has to get there.
    power: { x: 35.3, z: 28, wall: 'e' },
    // Boss rounds (and the quest's Ferryman): up the nave when it is open.
    boss: { area: 'nave', spots: [{ x: 67, z: 5 }, { x: 67, z: 21 }, { x: 57.5, z: 9 }, { x: 77.5, z: 15 }] },
    // Spawn windows: where the drowned climb out of the flood, per area (over the walls, up out of the drains).
    risers: [
      { x: 27, z: 50.5 }, { x: 53, z: 50.5 }, { x: 44, z: 46 }, { x: 52.5, z: 39.5 }, { x: 51, z: 44 }, { x: 35, z: 44 }, { x: 27, z: 39 },
      { x: 1.5, z: 27 }, { x: 23.5, z: 27 }, { x: 1.5, z: 42 }, { x: 23.5, z: 50.5 }, { x: 12, z: 50.5 }, { x: 23.5, z: 38 },
      { x: 1.5, z: 23.5 }, { x: 23.5, z: 1.5 }, { x: 14, z: 1.5 }, { x: 1.5, z: 12 }, { x: 23.5, z: 23.5 }, { x: 4, z: 17 },
      { x: 27.5, z: 1.5 }, { x: 52.5, z: 1.5 }, { x: 27.5, z: 14.5 }, { x: 52.5, z: 14.5 }, { x: 34, z: 11 }, { x: 46, z: 4 },
      { x: 27.5, z: 18.5 }, { x: 52.5, z: 18.5 }, { x: 27.5, z: 35.5 }, { x: 52.5, z: 35.5 }, { x: 40, z: 18 }, { x: 47, z: 33 },
      { x: 57, z: 1.5 }, { x: 78.5, z: 8 }, { x: 78.5, z: 18 }, { x: 72, z: 28.5 }, { x: 56, z: 11.5 }, { x: 64, z: 28.5 },
      { x: 78.5, z: 32.5 }, { x: 78.5, z: 38.5 }, { x: 56.5, z: 34 }, { x: 71.5, z: 50.5 }, { x: 56, z: 50.5 }, { x: 72, z: 36 },
    ],
    // The crew starts together on the quay, in front of the fish hall.
    starts: [{ x: 38, z: 42 }, { x: 41, z: 42 }, { x: 38, z: 45 }, { x: 41, z: 45 }],
    // The zombies economy's pieces (js/shared/zombies.js graphLayout reads them). Each is open floor in its area; `wall`
    // says which side a bench stands against; traps cover a chokepoint (`r` metres round x, z).
    reserved: {
      bench: { x: 44.7, z: 2, wall: 'w', note: 'upgrade bench: the west front, at the tower\'s foot' },
      terminal: { x: 47, z: 38.7, wall: 'n', note: 'supply terminal: Fish Quay, on the pump house wall' },
      armour: { x: 10.7, z: 30.5, wall: 'w', note: 'armour bench: the baker\'s side' },
      traps: [
        { x: 27.6, z: 31, r: 1.8, note: 'the Market Row gate into the Pump House' },
        { x: 27.6, z: 8, r: 1.8, note: 'the Cloister gate into the Close' },
        { x: 68, z: 28.2, r: 1.8, note: 'the Lifeboat Slip gate into the Nave' },
      ],
      exfil: { x: 63, z: 37.5, r: 3, note: 'exfil pad: the lifeboat hard' },
    },
    // The hidden quest: the fonts. With the power on the pumps fill each dry font (FILL THE FONT, free); a filled font
    // drinks the drowned killed within ZE.quest.fontR of it until it is full (ZE.quest.souls), and drains back if it
    // goes thirsty. Three full fonts, then toll the bell on the tower's west face: the Ferryman comes up the nave.
    // Fonts: the chandlery, the chapter house, the slipway.
    quest: {
      kind: 'font',
      bell: { x: 76.3, z: 24, wall: 'e' },
      fonts: [{ x: 3, z: 49 }, { x: 3, z: 3 }, { x: 77.5, z: 49.5 }],
    },
  };

  return {
    id: 'saltmere', name: 'Saltmere Abbey', theme: 'saltmere', size: 'medium', region: 'coast',
    hidden: true, modes: [], zmOnly: true,
    width: W, height: H, walls, spawns, lanes, nav, points: { dom: [], hard: [] },     // No flags: zombies only.
    decor: [{ type: 'abbey', x: 67.5, z: 0 }, { type: 'seawall', x: 40, z: 52 }, { type: 'pad', x: 63, z: 37.5, r: 3 }],
    zm,
  };
}

export default build();
