// Square icons for the maps drawn after the first set (the rewards pass gives every map a calling card, and each card
// wears its map's icon). Same 32 grid and vocabulary as SQUARE in icons.js (f solid, h holes, a accent, b faded, s
// stroke); icons.js passes its shape helpers in and merges the result, with an alias per map id.
export function mapIcons({ P, R, O, bar }) {
  return {
    // Turnstile: a tunnel mouth over the rails, the train's two lamps.
    'map:turnstile': { f: [P(2, 29.5, 2, 13, 6, 6, 16, 3, 26, 6, 30, 13, 30, 29.5)], h: [P(7, 29.5, 7, 14, 10, 9.5, 16, 8, 22, 9.5, 25, 14, 25, 29.5)], b: [R(10, 18, 12, 11.5, [2, 2, 0, 0])], a: [O(12.5, 22, 1.8), O(19.5, 22, 1.8)] },
    // Overpass: a deck on two piers, a lamp on the rail.
    'map:overpass': { f: [R(1, 9, 30, 5, 1), P(6, 14, 11, 14, 10, 29.5, 7, 29.5), P(21, 14, 26, 14, 25, 29.5, 22, 29.5), R(15, 3, 1.8, 6)], b: [R(1, 26, 30, 3)], a: [R(15, 2, 5, 2.4, 0.6), R(3, 24, 6, 1.6), R(22, 27.5, 7, 1.6)] },
    // Downtown: three towers, the tallest with a spire, windows cut out.
    'map:downtown': { f: [R(2, 14, 8, 15.5), R(11, 4, 10, 25.5), R(22, 10, 8, 19.5), R(15.2, 1, 1.6, 3)], h: [R(4, 17, 1.6, 2), R(7, 17, 1.6, 2), R(4, 22, 1.6, 2), R(13.5, 8, 2, 2.4), R(17, 8, 2, 2.4), R(13.5, 13, 2, 2.4), R(17, 18, 2, 2.4), R(24, 14, 1.6, 2), R(27, 19, 1.6, 2)], a: [R(13.5, 18, 2, 2.4), R(24, 24, 1.6, 2), O(16, 1, 1.2)] },
    // Oasis: a palm leaning over a pool.
    'map:oasis': { f: [bar(14, 28, 17, 10, 2.6), P(17, 10, 8, 6, 3, 9, 9, 8.5), P(17, 10, 22, 3, 29, 5, 22, 7), P(17, 10, 26, 11, 29, 16, 22, 12.5), P(17, 10, 11, 13, 6, 18, 10, 12)], a: [R(2, 26.5, 28, 3.5, 1.5)] },
    // Canyon: two mesas with a sun between them.
    'map:canyon': { f: [P(1, 29.5, 3, 18, 4, 11, 12, 11, 13, 18, 15, 29.5), P(17, 29.5, 20, 21, 21, 15, 28, 15, 29, 21, 31, 29.5)], h: [P(3.4, 18, 12.6, 18, 13, 20, 3, 20), P(20.3, 21, 28.7, 21, 29.1, 23, 19.9, 23)], a: [O(16, 6, 3.4)] },
    // Ruins: a broken lintel on two columns, vines hanging.
    'map:ruins': { f: [R(4, 12, 5, 17.5), R(23, 15, 5, 14.5), P(2, 8, 20, 8, 17, 12, 2, 12), R(1.5, 27, 29, 2.5)], b: [P(22, 8, 30, 8, 30, 12, 24, 12)], a: [R(12, 12, 1.6, 7), R(15.5, 12, 1.6, 4), R(26, 6, 1.6, 9)] },
    // Canopy: three crowns on trunks, a rope bridge between two.
    'map:canopy': { f: [O(8, 11, 6), O(24, 9, 6.5), R(7, 16, 2.4, 13.5), R(23, 15, 2.4, 14.5), R(1.5, 27.5, 29, 2)], b: [O(16, 17, 5)], s: [P(10, 18, 16, 21, 22, 18)], sw: 1.6, a: [O(8, 11, 2), O(24, 9, 2)] },
    // Riverbend: an S of river between banks.
    'map:riverbend': { f: [R(1, 3, 30, 26, 2)], h: [P(1, 22, 9, 18, 16, 12, 24, 10, 31, 8, 31, 14, 24, 16, 17, 19, 9, 25, 1, 28)], a: [P(1, 23.5, 9, 19.5, 16, 13.5, 24, 11.5, 31, 9.5, 31, 12.5, 24, 14.5, 17, 17.5, 9, 23.5, 1, 26.5)] },
    // Expedition: a peak with a snowcap and a flag on a lower shoulder.
    'map:expedition': { f: [P(1, 29.5, 13, 6, 18, 14, 22, 10, 31, 29.5), R(23.6, 4, 1.6, 8)], h: [P(13, 6, 9.5, 13, 12, 12, 13.5, 14, 15.5, 11)], a: [P(25.2, 4, 30, 6, 25.2, 8)] },
    // Icebreaker: a bow riding up over floes, its bridge and stack.
    'map:icebreaker': { f: [P(1, 18, 22, 18, 30, 11, 27, 24, 4, 24), R(7, 11, 9, 7, [1, 1, 0, 0]), R(18, 7, 3.4, 11)], h: [R(9, 13, 2, 2), R(12.5, 13, 2, 2)], a: [P(2, 27, 9, 26, 12, 29.5, 1, 29.5), P(15, 27, 24, 26, 29, 29.5, 13, 29.5)] },
    // Millbrook: a stone mill with a pitched roof, its waterwheel turning in the race below.
    // Jadefall: the stepped pyramid, its jade crown lit, the lagoon's swell below.
    'map:jadefall': { f: [R(5, 21, 22, 4.5), R(8.5, 16.5, 15, 4.5), R(12, 12, 8, 4.5)], h: [R(14.5, 21, 3, 4.5), R(14.8, 16.5, 2.4, 4.5)], s: [P(1, 29, 6, 26.5, 11, 29, 16, 26.5, 21, 29, 26, 26.5, 31, 29)], sw: 2, a: [P(13.5, 12, 16, 4, 18.5, 12)] },
    // Meridian City: a skyline of four districts, the El's deck across the front on its columns, a lit window.
    'map:meridian': { f: [R(1, 12, 7, 12), R(9, 5, 7, 19), R(17, 9, 6, 15), R(24, 14, 7, 10), R(1, 24, 30, 3), R(4, 27, 2, 3), R(15, 27, 2, 3), R(26, 27, 2, 3)], h: [R(3, 15, 1.6, 2), R(11, 8, 1.6, 2), R(13.5, 12, 1.6, 2), R(19, 12, 1.6, 2), R(26, 17, 1.6, 2)], a: [R(11, 16, 1.6, 2), R(19, 18, 1.6, 2), R(3, 20, 1.6, 2)] },
    // Tidebreak: a causeway on its piers over the waves, the shrine's broken arch on it.
    'map:tidebreak': { f: [R(1, 16, 30, 4), R(4, 20, 3, 6), R(14.5, 20, 3, 6), R(25, 20, 3, 6), R(10, 5, 3, 11), R(19, 8, 3, 8), R(9, 3, 9, 3, [1, 0, 0, 1])], as: [P(1, 29.5, 5.5, 27, 10, 29.5, 14.5, 27, 19, 29.5, 23.5, 27, 28, 29.5)], sw: 2 },
    // Coral Quarter: the church tower over two roofs, its bell lit.
    'map:coral': { f: [R(12, 8, 8, 21.5), P(11, 8, 16, 1.5, 21, 8), R(1, 19, 9, 10.5), P(0.5, 19, 5.5, 14.5, 10.5, 19), R(22, 21, 9, 8.5), P(21.5, 21, 26.5, 16.5, 31.5, 21)], h: [R(13.8, 10.5, 4.4, 5, [2, 2, 0, 0]), R(14.5, 22, 3, 7.5, [1.5, 1.5, 0, 0])], a: [O(16, 14, 1.5)] },
    'map:millbrook': { f: [R(15, 12, 15, 17.5), P(13, 12.5, 22.5, 4, 32, 12.5), O(9, 20, 7.5)], h: [O(9, 20, 5.4), R(20.5, 20, 4, 9.5, [2, 2, 0, 0])], a: [O(9, 20, 1.8), bar(3.4, 20, 14.6, 20, 1.4), bar(9, 14.4, 9, 25.6, 1.4), R(1, 28.5, 30, 2)] },
    // Launchpad: the rocket on its pad beside the service tower, flame under it.
    'map:launchpad': { f: [R(13, 7, 6, 19), P(13, 7.2, 16, 1, 19, 7.2), P(13, 19, 9, 26.5, 13, 25), P(19, 19, 23, 26.5, 19, 25), R(3.5, 4, 3, 24), R(1, 27.5, 30, 2.5)], h: [R(4.3, 7, 1.4, 2.6), R(4.3, 12, 1.4, 2.6), R(4.3, 17, 1.4, 2.6), R(4.3, 22, 1.4, 2.6)], b: [R(6.5, 9, 6.5, 1.4), R(6.5, 15, 6.5, 1.4)], a: [P(14, 26, 16, 31.5, 18, 26), R(13, 12, 6, 1.6)] },
    // Observatory: the domed drum on the summit with its slit open, a star over it.
    'map:observatory': { f: [R(6, 18, 20, 10), O(16, 18, 10), P(1, 30, 9, 26, 23, 26, 31, 30)], h: [R(14.4, 8.5, 3.2, 9.5)], b: [R(13.5, 22, 5, 6)], a: [O(26.5, 5, 1.7), R(5, 17.2, 22, 1.6)] },
    // Pagoda: four flared roofs stacked over their storeys, the finial with its rings.
    'map:pagoda': { f: [P(2.0, 26.0, 30.0, 26.0, 26.6, 23.4, 5.4, 23.4), P(4.8, 19.8, 27.2, 19.8, 23.8, 17.2, 8.2, 17.2), P(7.6, 13.6, 24.4, 13.6, 21.0, 11.0, 11.0, 11.0), P(10.4, 7.4, 21.6, 7.4, 18.2, 4.8, 13.8, 4.8), R(15.3, 1.5, 1.4, 7)], b: [R(7.0, 26.0, 18.0, 3.6), R(9.8, 19.8, 12.4, 3.6), R(12.6, 13.6, 6.8, 3.6), R(15.4, 7.4, 1.2, 3.6)], a: [O(16, 3, 1.6), O(16, 5.6, 1.3)] },
  };
}
