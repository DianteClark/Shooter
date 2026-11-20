// Wrenfield Fair (farmland, medium; Graveyard Shift only, docs/ZOMBIES.md "Wrenfield Fair"). A travelling fair left
// standing in a field outside the farm valley, the night it never packed up: string lights still burning, the big
// wheel stopped at the top, the Big Top's canvas burned off its poles. Built for the zombies mode, not for 6v6: hidden
// from every other playlist, no modes of its own (MODES.zm.maps puts it in Graveyard Shift).
//
// The story, as the crew walks it (x east, z south; the camera looks north):
//   Ticket Gate      (start, south-centre)  the entrance arch, the ticket booths and the Oracle (a fortune machine).
//   The Midway       (south-west)           game stalls along a sawdust lane; the prize tent (a dead end: a crate
//                                            spot, a lantern).
//   Carousel Green   (north-west)           the carousel, the organ shed (a dead end: a crate spot, a lantern).
//   Wheel Yard       (north)                the big wheel stopped at the top (a lantern on its boarding steps), the
//                                            upgrade bench on its base.
//   Generator Yard   (centre)               the show's generators and the POWER switch: walled in, reached from the
//                                            Midway or the Big Top.
//   The Big Top      (north-east)           the ring under the burned canvas: the boss arena, the high striker.
//   Ghost Train      (south-east)           the ghost train shed, the car park (the exfil), the tunnel exit (a dead end:
//                                            a crate spot, a lantern).
// Gates make one loop (Ticket Gate, Midway, Carousel Green, Wheel Yard, Big Top, Ghost Train, back to the Ticket Gate)
// with the Generator Yard off the Midway and the Big Top. The hidden quest is the lanterns: with the power on, ask the
// Oracle for the order, light the four coloured lanterns in that order before the first one burns down (a wrong one
// puts every lantern out), then ring the bell on the high striker and the Barker comes out to the ring.
// js/shared/zombies.js (zmLayout) reads the `zm` block below.
import { wall, perimeter, navGrid } from './build.js';

const W = 80, H = 52;
// Painted board hoardings between the areas; the fair's stalls and sheds are 'building'.
const hoard = (x, z, w, d, h = 3.2, extra = {}) => wall(x, z, w, d, h, 'wall', { hoard: true, ...extra });
const bale = (x, z, w = 2, d = 1.2, extra = {}) => wall(x, z, w, d, 1.1, 'crate', { hay: true, ...extra });

function build() {
  const walls = [];
  walls.push(
    // ---- The long hoardings between the areas (openings are the gates, see zm.gates).
    hoard(25, 0, 1, 6), hoard(25, 10, 1, 19), hoard(25, 33, 1, 9), hoard(25, 46, 1, 6),       // West line: gates at z 6, 29, 42.
    hoard(54, 0, 1, 6), hoard(54, 10, 1, 11), hoard(54, 25, 1, 18), hoard(54, 47, 1, 5),      // East line: gates at z 6, 21, 43.
    hoard(0, 25, 10, 1), hoard(14, 25, 11, 1),                                                 // Midway / Carousel Green, gate at x 10.
    hoard(26, 16, 28, 1),                                                                      // Wheel Yard / Generator Yard.
    hoard(26, 37, 28, 1),                                                                      // Generator Yard / Ticket Gate.
    hoard(55, 30, 11, 1), hoard(70, 30, 10, 1),                                                // Big Top / Ghost Train, gate at x 66.

    // ---- Ticket Gate (start): two ticket booths, hay bales.
    wall(29, 47, 5, 3.5, 3.2, 'building', { booth: true, landmark: true }),
    wall(47, 47, 5, 3.5, 3.2, 'building', { booth: true }),
    bale(37, 49.2), bale(28, 41, 1.2, 2),

    // ---- The Midway: game stalls on a sawdust lane; the prize tent in the south-west corner (one doorway, north).
    wall(3, 29, 7, 3, 2.8, 'building', { stall: 'gallery', landmark: true }),
    wall(14, 33, 6, 3, 2.8, 'building', { stall: 'hoopla' }),
    wall(4, 37, 6, 3, 2.8, 'building', { stall: 'shy' }),
    hoard(9, 44, 1, 8, 2.8, { tent: true }), hoard(0, 44, 5, 1, 2.8, { tent: true }),
    bale(17, 42), wall(14, 48, 1.6, 1.6, 1.2, 'crate', { barrels: true }),

    // ---- Carousel Green: the carousel; the organ shed in the north-west corner (one doorway, south).
    wall(11, 12, 8, 8, 4.2, 'building', { carousel: true, landmark: true }),
    hoard(9, 0, 1, 9, 2.8, { organ: true }), hoard(0, 8, 5, 1, 2.8, { organ: true }),
    bale(20, 4), bale(3, 18, 1.2, 2),

    // ---- Wheel Yard: the big wheel's base and boarding platform against the north fence (the wheel itself is decor).
    wall(36, 0, 8, 4, 2.4, 'building', { wheelbase: true, landmark: true }),
    wall(29, 7, 2.2, 1.2, 1.2, 'crate', { cars: true }), bale(48, 9),

    // ---- Generator Yard (power): two show generators on trailers, the power house, a fuel bowser.
    wall(30, 20, 6, 2.6, 2.8, 'container', { genset: true }),
    wall(44, 21, 6, 2.6, 2.8, 'container', { genset: true }),
    wall(36, 26, 7, 4, 3.4, 'building', { powerhouse: true, landmark: true }),
    wall(30, 31.5, 3, 2, 1.6, 'crate', { bowser: true }),

    // ---- The Big Top (boss arena): the king pole in the ring, the burned tent poles, two bleachers, the high striker.
    wall(67, 13.5, 1, 1, 7.5, 'crane', { kingpole: true, landmark: true }),
    wall(58.2, 13.7, 0.6, 0.6, 6, 'crane', { tentpole: true }), wall(76.4, 13.7, 0.6, 0.6, 6, 'crane', { tentpole: true }),
    wall(67.2, 4.6, 0.6, 0.6, 6, 'crane', { tentpole: true }), wall(67.2, 22.6, 0.6, 0.6, 6, 'crane', { tentpole: true }),
    wall(58, 0, 6, 2.6, 1.6, 'barrier', { bleacher: true }), wall(71, 0, 6, 2.6, 1.6, 'barrier', { bleacher: true }),
    wall(77, 26, 1.2, 1.2, 5, 'crane', { striker: true }),

    // ---- Ghost Train: the shed against the south fence; the tunnel exit in the south-east corner (one doorway, north).
    wall(58, 46, 12, 6, 4.4, 'building', { ghosttrain: true, landmark: true }),
    hoard(73, 42, 1, 10, 3, { tunnel: true }), hoard(73, 41, 4, 1, 3, { tunnel: true }),
    wall(76, 33, 1.6, 1.6, 1.2, 'crate', { barrels: true }),
  );
  perimeter(walls, W, H, 4);

  // Spawns only matter to tools (thumbnails, the validator): the zombies rules place everyone themselves.
  const spawns = [
    [{ x: 38, z: 42, aim: 0 }, { x: 41, z: 42, aim: 0 }, { x: 38, z: 45, aim: 0 }, { x: 41, z: 45, aim: 0 }],
    [{ x: 67, z: 20, aim: Math.PI }, { x: 64, z: 37, aim: Math.PI }, { x: 40, z: 10, aim: Math.PI }, { x: 14, z: 40, aim: Math.PI }],
  ];
  const lanes = [{ id: 'north', z: 9 }, { id: 'mid', z: 26 }, { id: 'south', z: 42 }];
  const nav = navGrid(walls, [4, 12, 21, 30, 40, 50, 60, 68, 76], [4, 10, 20, 27, 34, 41, 48]);

  // ---- Graveyard Shift layout (zmLayout's graph form, docs/ZOMBIES.md). Areas are found by flooding from `seed` with
  // every gate shut; everything else names a floor spot (x, z) and, for things on a wall, which side the wall is on
  // (`wall`: n, s, e, w).
  const zm = {
    areas: [
      { id: 'gate', name: 'Ticket Gate', seed: { x: 40, z: 43 } },
      { id: 'midway', name: 'The Midway', seed: { x: 13, z: 30 } },
      { id: 'carousel', name: 'Carousel Green', seed: { x: 6, z: 14 } },
      { id: 'wheel', name: 'Wheel Yard', seed: { x: 40, z: 10 } },
      { id: 'works', name: 'Generator Yard', seed: { x: 40, z: 34 } },
      { id: 'ring', name: 'The Big Top', seed: { x: 62, z: 20 } },
      { id: 'ghost', name: 'Ghost Train', seed: { x: 64, z: 38 } },
    ],
    start: 'gate',
    gates: [
      { x: 25, z: 42, w: 1, d: 4, a: 'gate', b: 'midway', cost: 750 },
      { x: 54, z: 43, w: 1, d: 4, a: 'gate', b: 'ghost', cost: 750 },
      { x: 10, z: 25, w: 4, d: 1, a: 'midway', b: 'carousel', cost: 1000 },
      { x: 25, z: 29, w: 1, d: 4, a: 'midway', b: 'works', cost: 1250 },
      { x: 66, z: 30, w: 4, d: 1, a: 'ghost', b: 'ring', cost: 1500 },
      { x: 54, z: 21, w: 1, d: 4, a: 'ring', b: 'works', cost: 1250 },
      { x: 25, z: 6, w: 1, d: 4, a: 'carousel', b: 'wheel', cost: 1250 },
      { x: 54, z: 6, w: 1, d: 4, a: 'wheel', b: 'ring', cost: 1500 },
    ],
    wallBuys: [
      { x: 31.5, z: 46.3, wall: 's', gun: 'smg', cost: 1000 },          // Ticket Gate: the west booth's window.
      { x: 40, z: 38.7, wall: 'n', gun: 'shotgun', cost: 900 },         // Ticket Gate: the generator fence.
      { x: 6.5, z: 32.7, wall: 'n', gun: 'ar', cost: 1200 },            // Midway: the shooting gallery's back.
      { x: 20.7, z: 34.5, wall: 'w', gun: 'dmr', cost: 1000 },          // Midway: the hoopla stall.
      { x: 13, z: 20.7, wall: 'n', gun: 'pdw', cost: 1100 },            // Carousel Green: the carousel's south side.
      { x: 24.3, z: 18, wall: 'e', gun: 'heavysmg', cost: 1400 },       // Carousel Green: the generator fence.
      { x: 47, z: 24.3, wall: 'n', gun: 'heavyar', cost: 1500 },        // Generator Yard: the east generator.
      { x: 30, z: 15.3, wall: 's', gun: 'autoshot', cost: 1500 },       // Wheel Yard: the generator fence.
      { x: 50, z: 15.3, wall: 's', gun: 'battle', cost: 1600 },         // Wheel Yard: the generator fence, east end.
      { x: 60, z: 29.3, wall: 's', gun: 'lmg', cost: 1800 },            // The Big Top: the ghost train fence.
      { x: 55.7, z: 17, wall: 'w', gun: 'saw', cost: 1800 },            // The Big Top: the west fence.
      { x: 67, z: 45.3, wall: 's', gun: 'carbine', cost: 1300 },        // Ghost Train: the shed's front.
      { x: 60, z: 31.7, wall: 'n', gun: 'burstsmg', cost: 1400 },       // Ghost Train: the Big Top fence.
    ],
    // Mystery crate spots: the first two are where it can start.
    boxes: [
      { x: 8.3, z: 48, wall: 'e' },         // Midway: the prize tent (dead end).
      { x: 74.7, z: 48, wall: 'w' },        // Ghost Train: the tunnel exit (dead end).
      { x: 8.3, z: 3, wall: 'e' },          // Carousel Green: the organ shed (dead end).
      { x: 74.5, z: 3.7, wall: 'n' },       // The Big Top: the east bleacher.
    ],
    machines: [
      { x: 46.3, z: 49, wall: 'e', perk: 'mercy' },      // Ticket Gate: the east booth.
      { x: 7, z: 40.7, wall: 'n', perk: 'stride' },      // Midway: the coconut shy.
      { x: 19.7, z: 15, wall: 'w', perk: 'quick' },      // Carousel Green: the carousel's east side.
      { x: 40, z: 30.7, wall: 'n', perk: 'hammer' },     // Generator Yard: the power house's front.
      { x: 61, z: 45.3, wall: 's', perk: 'iron' },       // Ghost Train: the shed's front, west end.
      { x: 55.7, z: 26, wall: 'w', perk: 'breath' },     // The Big Top: the west fence, south end.
    ],
    // The power switch on the power house's west side: free, but someone has to get there.
    power: { x: 35.3, z: 28, wall: 'e' },
    // Boss rounds (and the quest's Barker): out in the ring when the Big Top is open.
    boss: { area: 'ring', spots: [{ x: 62, z: 7 }, { x: 73, z: 7 }, { x: 61, z: 22 }, { x: 74, z: 20 }] },
    // Spawn windows: where the undead climb in, per area (over the hoardings, out from under the stalls).
    risers: [
      { x: 27, z: 50.5 }, { x: 53, z: 50.5 }, { x: 44, z: 50.5 }, { x: 52.5, z: 39.5 }, { x: 51, z: 44 }, { x: 35, z: 44 }, { x: 27, z: 39 },
      { x: 1.5, z: 27 }, { x: 23.5, z: 27 }, { x: 1.5, z: 42 }, { x: 23.5, z: 50.5 }, { x: 12, z: 50.5 }, { x: 23.5, z: 38 },
      { x: 1.5, z: 23.5 }, { x: 23.5, z: 1.5 }, { x: 14, z: 1.5 }, { x: 1.5, z: 12 }, { x: 23.5, z: 23.5 }, { x: 6, z: 23.5 },
      { x: 27.5, z: 1.5 }, { x: 52.5, z: 1.5 }, { x: 27.5, z: 14.5 }, { x: 52.5, z: 14.5 }, { x: 34, z: 11 }, { x: 46, z: 4 },
      { x: 27.5, z: 18.5 }, { x: 52.5, z: 18.5 }, { x: 27.5, z: 35.5 }, { x: 52.5, z: 35.5 }, { x: 40, z: 18 }, { x: 47, z: 33 },
      { x: 67.5, z: 1.5 }, { x: 78.5, z: 1.5 }, { x: 78.5, z: 14 }, { x: 78.5, z: 22 }, { x: 56, z: 11.5 }, { x: 64, z: 28.5 },
      { x: 78.5, z: 32.5 }, { x: 78.5, z: 38.5 }, { x: 56.5, z: 34 }, { x: 71.5, z: 50.5 }, { x: 56, z: 50.5 }, { x: 72, z: 36 },
    ],
    // The crew starts together under the entrance arch, in front of the booths.
    starts: [{ x: 38, z: 42 }, { x: 41, z: 42 }, { x: 38, z: 45 }, { x: 41, z: 45 }],
    // The zombies economy's pieces (js/shared/zombies.js graphLayout reads them). Each is open floor in its area; `wall`
    // says which side a bench stands against; traps cover a chokepoint (`r` metres round x, z).
    reserved: {
      bench: { x: 44.7, z: 2, wall: 'w', note: 'upgrade bench: the big wheel\'s base, east end' },
      terminal: { x: 47, z: 38.7, wall: 'n', note: 'supply terminal: the Ticket Gate, on the generator fence' },
      armour: { x: 10.7, z: 30.5, wall: 'w', note: 'armour bench: the shooting gallery\'s side' },
      traps: [
        { x: 27.6, z: 31, r: 1.8, note: 'the Midway gate into the Generator Yard' },
        { x: 27.6, z: 8, r: 1.8, note: 'the Carousel Green gate into the Wheel Yard' },
        { x: 68, z: 28.2, r: 1.8, note: 'the Ghost Train gate into the Big Top' },
      ],
      exfil: { x: 63, z: 37.5, r: 3, note: 'exfil pad: the Ghost Train car park' },
    },
    // The hidden quest: the lanterns. With the power on the Oracle (a fortune machine at the Ticket Gate) prints the
    // order; light the four in that order before the first burns down (a wrong one snuffs them all), then ring the bell
    // on the high striker in the Big Top (its south face, toward the camera): the Barker comes out to the ring.
    // Lanterns, by colour: red (the prize tent), green (the organ shed), blue (the wheel's steps), gold (the tunnel exit).
    quest: {
      kind: 'lantern',
      oracle: { x: 33, z: 38.7, wall: 'n' },
      striker: { x: 77.6, z: 27.9, wall: 'n' },
      lanterns: [{ x: 1.5, z: 51 }, { x: 1.5, z: 1.5 }, { x: 40, z: 5.2 }, { x: 78.5, z: 50.5 }],
    },
  };

  return {
    id: 'wrenfield', name: 'Wrenfield Fair', theme: 'wrenfield', size: 'medium', region: 'farmland',
    hidden: true, modes: [], zmOnly: true,
    width: W, height: H, walls, spawns, lanes, nav, points: { dom: [], hard: [] },     // No flags: zombies only.
    decor: [{ type: 'bigwheel', x: 40, z: 2, r: 7.5 }, { type: 'arch', x: 40, z: 51.6 }, { type: 'pad', x: 63, z: 37.5, r: 3 }, { type: 'ring', x: 67.5, z: 14, r: 7 }],
    zm,
  };
}

export default build();
