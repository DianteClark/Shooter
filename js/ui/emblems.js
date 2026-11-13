// Player-card emblems: small flat badges shown next to a name (lobby, scoreboard, killer card, service record).
// Drawn as flat polygons in a 32x32 box with no ids or defs, so one emblem can repeat anywhere on a page.
//   EMBLEMS, EMBLEM_IDS, getEmblem(id), cleanEmblem(id) (peers send anything), emblemSvg(id, size), emblemHtml(id, {size})
//   emblemUnlocked(emblem, career) -> {unlocked, requirement}. `career` is js/ui/cards.js careerNow().
// The player's pick is stored by js/ui/operators.js (equippedEmblem / setEmblemChoice); the picker is a tab of the
// calling card sheet (js/ui/cards.js), opened from the service record.

import { SEASON_DEFS, seasonEmblems, rankedEmblems } from '../shared/season-items.js';

const f1 = v => Math.round(v * 10) / 10;
const pts = list => list.map(p => `${f1(p[0])},${f1(p[1])}`).join(' ');
const poly = (list, fill, extra = '') => `<polygon points="${pts(list)}" fill="${fill}"${extra}/>`;
const ngon = (r, n, rot = -Math.PI / 2, cx = 16, cy = 16) => Array.from({ length: n }, (_, i) => [cx + Math.cos(rot + i * Math.PI * 2 / n) * r, cy + Math.sin(rot + i * Math.PI * 2 / n) * r]);
const star = (R, r, n, cx = 16, cy = 16, rot = -Math.PI / 2) => Array.from({ length: n * 2 }, (_, i) => [cx + Math.cos(rot + i * Math.PI / n) * (i % 2 ? r : R), cy + Math.sin(rot + i * Math.PI / n) * (i % 2 ? r : R)]);
const rect = (x, y, w, h, fill, extra) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], fill, extra);

// Back plates: a dark face inside a coloured rim. The rim colour carries the emblem's family at 16 px.
const PLATES = {
  hex: () => ngon(15, 6, 0),
  shield: () => [[3, 3], [29, 3], [29, 16], [16, 30], [3, 16]],
  diamond: () => [[16, 1], [31, 16], [16, 31], [1, 16]],
  cut: () => [[7, 2], [30, 2], [30, 25], [25, 30], [2, 30], [2, 7]],
  oct: () => ngon(15, 8, Math.PI / 8),
  // Feat emblems (the rewards pass): a twelve-point seal, so a feat reads as one at 16 px.
  seal: () => star(15.4, 13.2, 12, 16, 16, -Math.PI / 2),
};
// The drop shadow is drawn in (an offset copy of the plate), not a CSS filter: WebKit can leave a filtered inline SVG
// unpainted until something on the page repaints it (emblems that only appeared once the screen was tapped).
function plate(kind, rim, face = '#151a20') {
  const outer = PLATES[kind]();
  const inner = outer.map(([x, y]) => [16 + (x - 16) * 0.8, 16 + (y - 16) * 0.8]);
  return poly(outer.map(([x, y]) => [x, y + 1.6]), '#000', ' opacity=".5"') + poly(outer, rim) + poly(inner, face);
}

// Glyphs, each in the inner area (about 5..27). a: main colour, b: second colour.
const GLYPHS = {
  rivet: (a, b) => poly(ngon(6, 6, 0), a) + poly(ngon(3, 6, 0), b) + [[9, 9], [23, 9], [9, 23], [23, 23]].map(([x, y]) => poly(ngon(1.6, 6, 0, x, y), a)).join(''),
  chevron: (a, b) => poly([[8, 13], [16, 7], [24, 13], [24, 17], [16, 11], [8, 17]], a) + poly([[8, 20], [16, 14], [24, 20], [24, 24], [16, 18], [8, 24]], b),
  lamp: (a, b) => rect(14.5, 18, 3, 9, b) + poly(ngon(6.5, 10), b) + poly(ngon(4.6, 10), a) + rect(10, 26, 12, 2, b),
  gear: (a, b) => poly(star(10.5, 8, 8), a) + poly(ngon(4, 8), '#151a20') + poly(ngon(2, 8), b),
  spike: (a, b) => poly([[13, 6], [19, 6], [19, 9], [17.5, 9], [17.5, 24], [16, 28], [14.5, 24], [14.5, 9], [13, 9]], a) + rect(10, 6, 12, 2.4, b),
  bolt: (a, b) => poly([[18, 4], [9, 18], [15, 18], [12, 28], [23, 13], [17, 13], [20, 4]], a) + poly([[18, 4], [20, 4], [17, 13], [15.5, 13]], b),
  fang: (a, b) => poly([[8, 8], [24, 8], [24, 12], [20, 12], [18, 26], [16, 14], [14, 26], [12, 12], [8, 12]], a) + rect(8, 8, 16, 1.6, b),
  scope: (a, b) => poly(ngon(10, 16), a) + poly(ngon(8, 16), '#151a20') + rect(15, 5, 2, 9, a) + rect(15, 18, 2, 9, a) + rect(5, 15, 9, 2, a) + rect(18, 15, 9, 2, a) + poly(ngon(1.8, 8), b),
  wave: (a, b) => [10, 16, 22].map((y, i) => poly([[5, y], [9, y - 4], [13, y], [17, y - 4], [21, y], [25, y - 4], [27, y - 2], [25, y - 1], [21, y + 3], [17, y - 1], [13, y + 3], [9, y - 1], [5, y + 3]], i === 1 ? b : a)).join(''),
  anchor: (a, b) => rect(15, 8, 2, 16, a) + poly(ngon(2.6, 8, 0, 16, 7), b) + rect(11, 11, 10, 2, a) + poly([[6, 18], [9, 18], [12, 23], [16, 25], [20, 23], [23, 18], [26, 18], [22, 26], [16, 28], [10, 26]], a),
  flake: (a, b) => [0, 1, 2].map(k => { const t = k * Math.PI / 3, c = Math.cos(t), s = Math.sin(t); return poly([[16 + c * 11 - s, 16 + s * 11 + c], [16 + c * 11 + s, 16 + s * 11 - c], [16 - c * 11 + s, 16 - s * 11 - c], [16 - c * 11 - s, 16 - s * 11 + c]], a); }).join('') + poly(ngon(3, 6, 0), b),
  sun: (a, b) => poly(star(11, 6.5, 12), a) + poly(ngon(5, 12), b),
  bomb: (a, b) => poly(ngon(8, 12, 0, 15, 18), a) + rect(17, 7, 4, 4, a) + poly([[20, 7], [23, 4], [25, 5], [22, 8]], b) + poly(star(3, 1.2, 4, 25, 4.5), b),
  pennant: (a, b) => rect(9, 5, 2, 23, b) + poly([[11, 6], [26, 11], [11, 17]], a) + poly([[11, 11], [18, 13.4], [11, 15]], '#151a20', ' opacity=".35"'),
  tag: (a, b) => poly([[10, 9], [22, 9], [24, 12], [24, 24], [22, 27], [10, 27], [8, 24], [8, 12]], a) + poly(ngon(1.6, 8, 0, 16, 12), '#151a20') + rect(11, 17, 10, 1.4, b) + rect(11, 20, 7, 1.4, b),
  crown: (a, b) => poly([[6, 23], [6, 11], [11, 16], [16, 8], [21, 16], [26, 11], [26, 23]], a) + rect(6, 24, 20, 3, b) + [11, 16, 21].map(x => poly(ngon(1.4, 4, 0, x, 20), b)).join(''),
  wing: (a, b) => [0, 1, 2, 3].map(i => poly([[7, 10 + i * 4], [26 - i * 3, 7 + i * 4.5], [24 - i * 3, 10 + i * 4.5], [7, 13 + i * 4]], i % 2 ? b : a)).join(''),
  star: (a, b) => poly(star(11.5, 5, 5), a) + poly(star(5.5, 2.4, 5), b),
  gem: (a, b) => poly([[10, 9], [22, 9], [27, 14], [16, 27], [5, 14]], a) + poly([[10, 9], [16, 14], [22, 9]], b) + poly([[5, 14], [27, 14], [16, 27]], '#000', ' opacity=".18"'),
  prism: (a, b) => poly([[16, 5], [27, 25], [5, 25]], a) + poly([[16, 11], [22, 22], [10, 22]], '#151a20') + poly([[22, 17], [30, 13], [30, 15]], '#ff2bd6') + poly([[22, 18], [30, 17], [30, 19]], '#ffd659') + poly([[22, 19], [30, 21], [30, 23]], '#18e8ff') + rect(3, 16, 10, 1.4, b),
  oldguard: (a, b) => poly([[16, 5], [26, 10], [26, 18], [16, 27], [6, 18], [6, 10]], a) + poly([[9, 13], [16, 9], [23, 13], [23, 16], [16, 12], [9, 16]], '#151a20') + poly([[9, 19], [16, 15], [23, 19], [23, 22], [16, 18], [9, 22]], b),
  master: (a, b) => poly([[8, 25], [8, 8], [12, 8], [16, 15], [20, 8], [24, 8], [24, 25], [20.5, 25], [20.5, 15], [16, 22], [11.5, 15], [11.5, 25]], a) + rect(7, 26, 18, 2, b) + poly(ngon(1.8, 4, 0, 16, 5), b),
  rails: (a, b) => rect(9, 4, 2.4, 24, a) + rect(20.6, 4, 2.4, 24, a) + [8, 14, 20, 26].map(y => rect(6, y - 1, 20, 2, b)).join(''),
  // ---- Feats ----
  spade: (a, b) => poly([[16, 5.5], [23.5, 13], [25, 17], [23.5, 20.5], [20, 21.5], [17.2, 20], [18.6, 25.5], [13.4, 25.5], [14.8, 20], [12, 21.5], [8.5, 20.5], [7, 17], [8.5, 13]], a)
    + poly([[16, 11], [18, 14], [16, 17], [14, 14]], b),
  ten: (a, b) => poly([[7, 7], [11, 7], [25, 25], [21, 25]], a) + poly([[21, 7], [25, 7], [11, 25], [7, 25]], a)
    + poly([[14.5, 4], [16, 1.5], [17.5, 4], [16, 7]], b) + poly([[14.5, 28], [16, 25], [17.5, 28], [16, 30.5]], b),
  chute: (a, b) => poly([[5, 14], [7, 9], [11.5, 6], [16, 5], [20.5, 6], [25, 9], [27, 14], [21.5, 12.5], [16, 12], [10.5, 12.5]], a)
    + poly([[6, 14], [7.2, 14], [15.4, 22], [14.2, 22]], a) + poly([[26, 14], [24.8, 14], [16.6, 22], [17.8, 22]], a)
    + poly([[12, 20], [20, 20], [20, 22.5], [12, 22.5]], b) + poly([[12, 23], [14, 26.5], [16, 24], [18, 26.5], [20, 23]], b),
  lone: (a, b) => poly(ngon(11.5, 16), a) + poly(ngon(9.4, 16), '#151a20') + poly(ngon(2.6, 8, 0, 16, 11.5), b)
    + poly([[12.6, 15.5], [19.4, 15.5], [20, 22], [17.6, 22], [17.2, 25], [14.8, 25], [14.4, 22], [12, 22]], b),
  heli: (a, b) => rect(5, 7, 22, 2, a) + rect(15, 9, 2, 3, a) + poly([[8, 12], [20, 12], [24, 15], [22, 19], [10, 19], [7, 16]], a)
    + rect(22, 14, 7, 2, a) + rect(10, 20, 13, 1.6, a) + poly([[10.5, 13.5], [14.5, 13.5], [14.5, 16.5], [10.5, 16.5]], '#151a20')
    + poly([[11, 24], [13, 22.5], [15.5, 25], [21, 19.5], [23, 21], [15.5, 28.5]], b),
  tomb: (a, b) => poly([[10, 24], [10, 11], [12, 7.5], [16, 6], [20, 7.5], [22, 11], [22, 24]], a) + rect(8, 24, 16, 2.2, a)
    + [11.6, 15, 18.4].map(x => poly([[x, 13], [x + 1.2, 13], [x + 3, 20], [x + 1.8, 20]], b) + poly([[x + 1.8, 13], [x + 3, 13], [x + 1.2, 20], [x, 20]], b)).join(''),
  exit: (a, b) => rect(6, 10, 3, 18, a) + rect(23, 10, 3, 18, a) + poly([[6, 10], [16, 4], [26, 10], [26, 12], [16, 6.6], [6, 12]], a)
    + poly([[16, 9], [22, 16], [18.2, 16], [18.2, 26], [13.8, 26], [13.8, 16], [10, 16]], b),
  blades: (a, b) => poly([[7, 25], [22.5, 6.5], [25.5, 5], [24.5, 8.5], [9, 27]], a) + poly([[25, 25], [9.5, 6.5], [6.5, 5], [7.5, 8.5], [23, 27]], a)
    + poly([[9.5, 20.5], [13.5, 24.5], [12, 26], [8, 22]], b) + poly([[22.5, 20.5], [18.5, 24.5], [20, 26], [24, 22]], b),
  flawless: (a, b) => poly([[16, 7], [24, 10], [24, 17], [16, 25], [8, 17], [8, 10]], a) + poly([[11.5, 15], [14, 13], [15.5, 15.5], [20.5, 10.5], [22.5, 12.5], [15.5, 19.5]], '#151a20')
    + Array.from({ length: 6 }, (_, i) => { const t = -Math.PI / 2 + (i - 2.5) * 0.42; return poly(ngon(1.5, 6, 0, 16 + Math.cos(t + Math.PI) * 12.5, 18 + Math.sin(t + Math.PI) * -12.5 + 3), b); }).join(''),
  survivor: (a, b) => poly([[16, 6], [24, 9], [24, 16], [16, 26], [8, 16], [8, 9]], a) + rect(14.6, 10, 2.8, 11, b) + rect(10.5, 14, 11, 2.8, b)
    + [[5, 25], [27, 25], [5, 6]].map(([x, y]) => poly(ngon(2.4, 6, 0, x, y), '#7aff9a', ' opacity=".8"')).join(''),
  bullet: (a, b) => poly([[4, 18.4], [18, 18.4], [24, 16.6], [27.5, 16], [24, 15.4], [18, 13.6], [4, 13.6]], a) + rect(6, 13.6, 1.6, 4.8, '#151a20')
    + [[2, 9, 12], [4, 23, 10], [8, 27, 6]].map(([x, y, w]) => rect(x, y, w, 1.4, b)).join('') + poly(ngon(2, 8, 0, 27.5, 16), b),
  laurel: (a, b) => [-1, 1].map(side => Array.from({ length: 5 }, (_, i) => {
    const t = Math.PI / 2 + side * (0.5 + i * 0.42), x = 16 + Math.cos(t) * 10.5, y = 17 + Math.sin(t) * 10.5, k = 3;
    return poly([[x, y - k], [x + side * k * 0.9, y], [x, y + k * 0.7], [x - side * k * 0.6, y]], a);
  }).join('')).join('') + poly(star(6, 2.6, 5, 16, 15), b),
};

// [id, name, plate, rim, glyph colours, glyph, rule]. rule: {starter} | {level} | {prestige} | {stat, goal, label}
// against career weapon totals | {life, goal, label} against lifetime match counts | {pro} | {mastered} | {camo, goal}.
const ROWS = [
  ['rivet', 'Rivet', 'hex', '#5a6470', ['#c8ccd2', '#ff9f1c'], 'rivet', { starter: true }],
  ['chevron', 'Chevron', 'shield', '#38b6ff', ['#e6ecf2', '#38b6ff'], 'chevron', { starter: true }],
  ['lamp', 'Signal Lamp', 'cut', '#ff9f1c', ['#ffd9a0', '#5a6470'], 'lamp', { starter: true }],
  ['rails', 'Main Line', 'oct', '#7a6a50', ['#c8ccd2', '#8a6a40'], 'rails', { starter: true }],
  ['gear', 'Cog', 'oct', '#9aa4ad', ['#c8ccd2', '#ff9f1c'], 'gear', { level: 10 }],
  ['spike', 'Rail Spike', 'cut', '#8a6a40', ['#d0d4d8', '#ffb02a'], 'spike', { level: 25 }],
  ['bolt', 'Spark Gap', 'diamond', '#ffd659', ['#ffd659', '#fff4bf'], 'bolt', { stat: 'kills', goal: 500, label: 'gun kills' }],
  ['fang', 'Fang', 'shield', '#ff4d3d', ['#f2ead8', '#ff4d3d'], 'fang', { stat: 'head', goal: 100, label: 'headshots' }],
  ['scope', 'Crosshair', 'oct', '#ff3a3a', ['#e6ecf2', '#ff3a3a'], 'scope', { stat: 'long', goal: 50, label: 'longshots' }],
  ['wave', 'Undertow', 'hex', '#2ae0b0', ['#7cf8e0', '#2ae0b0'], 'wave', { stat: 'slide', goal: 50, label: 'slide kills' }],
  ['anchor', 'Anchor', 'shield', '#ffb03a', ['#bfe2f2', '#ffb03a'], 'anchor', { life: 'mapwon:harbor', goal: 5, label: 'wins on Harbor' }],
  ['flake', 'Frostbite', 'hex', '#7cd8ff', ['#eaf6ff', '#7cd8ff'], 'flake', { life: 'mapwon:frost', goal: 5, label: 'wins on Frostline' }],
  ['sun', 'High Noon', 'oct', '#ff8a2a', ['#ffb02a', '#fff0c0'], 'sun', { life: 'mapwon:dust', goal: 5, label: 'wins on Dust' }],
  ['bomb', 'Charge', 'cut', '#ff3a10', ['#2a2e36', '#ffb02a'], 'bomb', { life: 'plants', goal: 10, label: 'bomb plants' }],
  ['pennant', 'Pennant', 'shield', '#38b6ff', ['#38b6ff', '#e6ecf2'], 'pennant', { life: 'flagCaps', goal: 5, label: 'flag captures' }],
  ['tag', 'Dog Tag', 'diamond', '#c8ccd2', ['#c8ccd2', '#5a6470'], 'tag', { life: 'confirms', goal: 50, label: 'kills confirmed' }],
  ['star', 'Pro Star', 'hex', '#ffd659', ['#ffd659', '#fff4bf'], 'star', { pro: 5 }],
  ['crown', 'Crown', 'shield', '#ffd659', ['#ffd659', '#b27616'], 'crown', { prestige: 3 }],
  ['wing', 'Wing', 'diamond', '#d8d4ff', ['#d8d4ff', '#9a8cff'], 'wing', { prestige: 6 }],
  ['gem', 'Armorer Gem', 'oct', '#ff2bd6', ['#ff2bd6', '#ffd2f4'], 'gem', { mastered: 3 }],
  ['prism', 'Refraction', 'hex', '#18e8ff', ['#e8f8ff', '#18e8ff'], 'prism', { camo: 'prism', goal: 1, label: 'weapon in Prism' }],
  ['oldguard', 'Old Guard', 'shield', '#e5a536', ['#ffe39a', '#e5a536'], 'oldguard', { prestige: 10 }],
];

export const EMBLEMS = ROWS.map(([id, name, plateKind, rim, colours, glyph, rule]) => ({ id, name, plate: plateKind, rim, colours, glyph, rule }));
export const EMBLEM_IDS = EMBLEMS.map(e => e.id);
// Seasons (docs/SEASONS.md): each season's 40 track emblems and 7 ranked crests. Kept out of EMBLEMS, which the bot
// pool draws from by index (js/shared/botpool.js): appending there would change every bot's emblem.
const seasonRow = (season, track) => ([id, name, plateKind, rim, colours, glyph]) => ({ id, name, plate: plateKind, rim, colours, glyph,
  season, rule: { grant: true, label: track ? `${season} reward track` : `${season} ranked reward` } });
export const SEASON_EMBLEMS = SEASON_DEFS.flatMap(d => [...seasonEmblems(d).map(seasonRow(d.id, true)), ...rankedEmblems(d).map(seasonRow(d.id, false))]);
// Master Prestige (docs/PRESTIGE.md): kept out of EMBLEMS for the same reason as the season ones.
export const RANK_EMBLEMS = [['mastermark', 'Master Mark', 'diamond', '#e6ecf2', ['#ffffff', '#ffd659'], 'master', { master: 250 }]]
  .map(([id, name, plateKind, rim, colours, glyph, rule]) => ({ id, name, plate: plateKind, rim, colours, glyph, rule }));
// Feat emblems (the rewards pass, docs/UNLOCKS-AUDIT-2026-11-12.md): one-off deeds, each on the seal plate. Kept out of
// EMBLEMS for the bot pool's sake, like the season ones. Rules: {life, goal, label} a lifetime tally (js/shared/
// progression.js ChallengeTally feats), {zmround} the best Graveyard Shift round on any map, {zmescape} an escape,
// {ranked} the best ranked division reached (0 Bronze .. 6 Champion). `play`: where it counts (the unlock sheet).
const FEAT_ROWS = [
  ['feat-ace', 'Ace', '#ff4d3d', ['#f2ead8', '#ff4d3d'], 'spade', { life: 'ace', goal: 1, label: 'Take out the whole enemy side alone in one Search and Destroy or Showdown round' }, { tab: 'standard', modes: ['snd'] }],
  ['feat-streak10', 'Tenfold', '#ff9f1c', ['#ffd9a0', '#ff4a10'], 'ten', { life: 'streak10', goal: 1, label: 'Get a 10-kill streak' }, { tab: 'standard', playlist: 'qp' }],
  ['feat-brwin', 'Last Squad', '#ffd659', ['#ffd659', '#fff4bf'], 'chute', { life: 'br:won', goal: 1, label: 'Win a Battle Royale match' }, { tab: 'br', playlist: 'quads' }],
  ['feat-brlone', 'Lone Survivor', '#d8d4ff', ['#d8d4ff', '#ffd659'], 'lone', { life: 'br:lone', goal: 1, label: 'Win a squads or duos Battle Royale as the last of your squad standing' }, { tab: 'br', playlist: 'quads' }],
  ['feat-exclean', 'Full Manifest', '#ff5a2a', ['#f0ecd0', '#3fdc6a'], 'heli', { life: 'ex:clean', goal: 1, label: 'Extract with every contract your squad took, 4 or more' }, { tab: 'extraction', playlist: 'exquads' }],
  ['feat-zm30', 'Thirty Nights', '#9a8cff', ['#d8d0f0', '#7aff9a'], 'tomb', { zmround: 30, label: 'Survive to round 30 in Graveyard Shift' }, { tab: 'zombies', playlist: 'zmsolo' }],
  ['feat-zmescape', 'Way Out', '#7aff9a', ['#d8d0f0', '#7aff9a'], 'exit', { zmescape: 1, label: 'Escape Graveyard Shift on the helicopter' }, { tab: 'zombies', playlist: 'zmsolo' }],
  ['feat-finishers', 'Executioner', '#c8ccd2', ['#e6ecf2', '#ff4d3d'], 'blades', { life: 'finishers', goal: 25, label: 'Perform 25 finishers' }, { tab: 'standard', playlist: 'qp' }],
  ['feat-flawless', 'Flawless', '#38b6ff', ['#e6ecf2', '#ffd659'], 'flawless', { life: 'gf:flawless', goal: 1, label: 'Win a Showdown 6-0' }, { tab: 'standard', playlist: 'showdown' }],
  ['feat-survivor', 'Still Standing', '#8cff3a', ['#e6ecf2', '#ff4d3d'], 'survivor', { life: 'inf:survived', goal: 1, label: 'Survive the clock in Infected' }, { tab: 'standard', modes: ['inf'] }],
  ['feat-longshot', 'Over the Horizon', '#7cc8ff', ['#ffd659', '#7cc8ff'], 'bullet', { life: 'long40', goal: 1, label: 'Get a gun kill from 40 m or more' }, { tab: 'br', playlist: 'quads' }],
  ['feat-champion', 'Champion', '#ff4a5a', ['#ffe0b0', '#ff4a5a'], 'laurel', { ranked: 6, label: 'Reach Champion in Ranked' }, { tab: 'standard', playlist: 'ranked' }],
];
export const FEAT_EMBLEMS = FEAT_ROWS.map(([id, name, rim, colours, glyph, rule, play]) => ({ id, name, plate: 'seal', rim, colours, glyph, rule, feat: true, play }));
export const ALL_EMBLEMS = [...EMBLEMS, ...SEASON_EMBLEMS, ...RANK_EMBLEMS, ...FEAT_EMBLEMS];
const BY_ID = new Map(ALL_EMBLEMS.map(e => [e.id, e]));
export const getEmblem = id => BY_ID.get(id) ?? null;
export const cleanEmblem = id => (BY_ID.has(id) ? id : null);

const fmt = v => Number(v).toLocaleString('en-US');
export function emblemUnlocked(e, c) {
  const r = e.rule;
  if (c.granted?.(`emblem:${e.id}`)) return { unlocked: true, requirement: e.season ? r.label : 'Earned on a mastery track' };
  if (r.starter) return { unlocked: true, requirement: 'Starter emblem' };
  if (r.grant) return { unlocked: false, requirement: r.label };
  if (r.level) return { unlocked: c.level >= r.level, requirement: `Reach level ${r.level}` };
  if (r.prestige) return { unlocked: c.prestige >= r.prestige, requirement: `Reach prestige ${r.prestige}` };
  if (r.master) return { unlocked: (c.master ?? 0) >= r.master, requirement: `Reach Master level ${r.master}` };
  if (r.pro) return { unlocked: (c.pro?.length ?? 0) >= r.pro, requirement: `Earn ${r.pro} Pro perks` };
  if (r.mastered) return { unlocked: (c.mastered ?? 0) >= r.mastered, requirement: `Master ${r.mastered} weapons` };
  if (r.camo) return { unlocked: (c.camoOn?.[r.camo] ?? 0) >= r.goal, requirement: `${r.goal} ${r.label}` };
  if (e.feat) { const [v, g] = emblemProgress(e, c); return { unlocked: v >= g, requirement: r.label }; }
  if (r.life) return { unlocked: (c.life?.[r.life] ?? 0) >= r.goal, requirement: `${fmt(r.goal)} ${r.label}` };
  return { unlocked: (c[r.stat] ?? 0) >= r.goal, requirement: `${fmt(r.goal)} ${r.label}` };
}

// How far an emblem is: [value, goal] (value capped at goal), for the unlock sheet's bar. `c` as emblemUnlocked's.
const num = v => (Number.isFinite(v) ? v : 0);
export function emblemProgress(e, c) {
  const r = e.rule;
  const cap = (v, g) => [Math.max(0, Math.min(g, Math.floor(num(v)))), g];
  if (r.starter) return [1, 1];
  if (r.level) return cap(c.level, r.level);
  if (r.prestige) return cap(c.prestige, r.prestige);
  if (r.master) return cap(c.master, r.master);
  if (r.pro) return cap(c.pro?.length, r.pro);
  if (r.mastered) return cap(c.mastered, r.mastered);
  if (r.camo) return cap(c.camoOn?.[r.camo], r.goal);
  if (r.zmround) return cap(Math.max(0, ...Object.values(c.zmBest ?? {}).map(num)), r.zmround);
  if (r.zmescape) return cap(Object.values(c.zmFeats ?? {}).some(v => Array.isArray(v) && v[0] > 0) ? 1 : 0, 1);
  if (r.ranked) return cap(num(c.rankedBest ?? -1) + 1, r.ranked + 1);
  if (r.life) return cap(c.life?.[r.life], r.goal);
  if (r.stat) return cap(c[r.stat], r.goal);
  return [0, 1];
}

const cache = new Map();
export function emblemSvg(id, size = 18) {
  const e = getEmblem(id);
  if (!e) return '';
  const key = `${id}:${size}`;
  let s = cache.get(key);
  if (!s) {
    s = `<svg class="emb-svg" viewBox="0 0 32 32" width="${size}" height="${size}" overflow="visible" aria-hidden="true">${plate(e.plate, e.rim)}${GLYPHS[e.glyph](e.colours[0], e.colours[1])}</svg>`;
    cache.set(key, s);
  }
  return s;
}

// The chip next to a name. An unknown or empty id renders nothing, so callers can pass whatever a peer sent.
export const emblemHtml = (id, { size = 16, cls = '' } = {}) => {
  const e = getEmblem(id);
  return e ? `<i class="emb${cls ? ` ${cls}` : ''}" title="${e.name}">${emblemSvg(id, size)}</i>` : '';
};
