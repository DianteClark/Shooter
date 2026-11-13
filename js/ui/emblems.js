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
export const ALL_EMBLEMS = [...EMBLEMS, ...SEASON_EMBLEMS, ...RANK_EMBLEMS];
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
  if (r.life) return { unlocked: (c.life?.[r.life] ?? 0) >= r.goal, requirement: `${fmt(r.goal)} ${r.label}` };
  return { unlocked: (c[r.stat] ?? 0) >= r.goal, requirement: `${fmt(r.goal)} ${r.label}` };
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
