// Seasons and ranked (docs/ROADMAP.md items 21 and 22, docs/SEASONS.md): the schedule and everything each season brings,
// as plain data. No imports, so the cosmetic catalogues (camos.js, operators.js, emblems.js, cardbook.js) can read it
// without a cycle; js/shared/seasons.js resolves dates and keeps the save's season state, js/shared/ranked.js the rating.
//
// A season (SEASON_DEFS, append only, never reorder: ids and reward ids are in saves):
//   id, n, name, start ('YYYY-MM-DD', the local calendar day it opens), days (SEASON_DAYS)
//   theme [ground, mid, light, accent]   the title panel, the track and the season's calling cards
//   event { id, name, from, to (days into the season, to exclusive), mode, mods, desc }   the limited-time playlist
//   paths { weapon, operator }   existing locked items the track opens early (tiers PATH_TIERS); level and challenge
//                                 unlocks keep working as before
//   content [{ kind: 'map'|'mode'|'weapon'|'operator', id }]   optional date-locked content: hidden until the start
//   camos [slug, name, pattern, colors, scale, animated?, tint?]   10, ids `s<n>-<slug>`, appended to CAMOS
//   skins [operator, name, [gear, sleeve, trouser, accent, glow]]  8, ids `skin:<operator>-s<n>`, appended to SKINS
//   cards [adjectives x 10, nouns x 10], emblems [adjectives x 10, nouns x 10]   40 each, named from the pairs
// Everything a season grants is cosmetic or an early unlock; nothing is bought and nothing boosts XP.

export const SEASON_DAYS = 42;
export const SEASON_WEEKS = 6;
export const TRACK_TIERS = 100;
// Tiers with a fixed kind of reward; the rest alternate calling card and emblem.
export const PATH_TIERS = { weapon: 25, operator: 75 };
const SKIN_TIERS = [10, 20, 30, 40, 50, 60, 85, 95];
const CAMO_TIERS = [5, 15, 35, 45, 55, 65, 70, 80, 90, 100];

export const SEASON_DEFS = [
  {
    id: 'S1', n: 1, name: 'Cold Iron', start: '2026-11-16', days: SEASON_DAYS,
    tagline: 'Frost on the rails',
    theme: ['#0d1822', '#2a5674', '#e2f4ff', '#7cd8ff'],
    palettes: [
      ['#0e1a24', '#2e5a78', '#dff4ff', '#7cd8ff'], ['#141a22', '#3c4a5c', '#e6ecf2', '#9fe8ff'],
      ['#101820', '#24485e', '#cfeefa', '#ffcf6a'], ['#18141e', '#3a3050', '#e8e0ff', '#a8c8ff'],
      ['#0c1418', '#1e3a40', '#c8fff0', '#4dffd0'],
    ],
    event: { id: 'coldsnap', name: 'Cold Snap', from: 14, to: 28, mode: 'inf', mods: ['hardcore'], desc: 'Hardcore Infected for two weeks. One bite and you turn.' },
    paths: { weapon: 'rotary', operator: 'ghoul' },
    content: [],
    camos: [
      ['rime', 'Rime', 'digital', [0xdfeef6, 0x8fb4c8, 0x3c5a6e, 0x182634], 9.0],
      ['sleet', 'Sleet Line', 'splinter', [0xb8c8d2, 0x6e8494, 0x2c3a46, 0xe8f4fa], 3.2],
      ['hoar', 'Hoarfrost', 'hex', [0xeaf6ff, 0x9cc8e0, 0x40708e, 0x10202c], 8.0],
      ['coldsteel', 'Cold Steel', 'carbon', [0x2a3440, 0x10161c, 0x7cd8ff], 11.0],
      ['icebound', 'Icebound', 'tiger', [0x9ad8ff, 0x0e2030, 0xe8f8ff], 3.4],
      ['boreal', 'Boreal', 'splinter', [0x2e4a3a, 0x1a2a22, 0xd8eee4, 0x6aa88a], 3.2],
      ['lampblack', 'Lampblack', 'digital', [0x1a1c22, 0x0a0b0e, 0xffcf6a, 0x3a3e48], 9.0],
      ['thaw', 'Thaw', 'hex', [0x5a8aa8, 0x2a4a62, 0xffffff, 0x0e1a26], 8.0],
      ['polarwire', 'Polar Current', 'livewire', [0x0a1420, 0x7cd8ff, 0xf2fbff], 5.0, true, 0x8ae0ff],
      ['deepwinter', 'Deep Winter', 'aurora', [0x050a18, 0x7cd8ff, 0x3a6aff, 0xf4fbff], 4.0, true, 0x9ad8ff],
    ],
    skins: [
      ['trooper', 'Rimeguard', [0xc8d4dc, 0x9aa8b2, 0x5a6670, 0x7cd8ff, 1]],
      ['anvil', 'Cold Forge', [0x3a4450, 0x2a323c, 0x1c2228, 0x9fe8ff, 1]],
      ['wisp', 'Snowdrift', [0xeef4f8, 0xd2dce2, 0x9aa6ae, 0x4dc8ff, 0]],
      ['sparrow', 'Winter Ward', [0xdfe6ea, 0x4a6a80, 0x2c3e4c, 0xff5a4a, 0]],
      ['harrow', 'Whitecap', [0xf2f6f8, 0xbcc8d0, 0x6a7a86, 0x7cd8ff, 1]],
      ['ox', 'Iron Frost', [0x5a6a78, 0x404c58, 0x262e36, 0xcfeefa, 0]],
      ['nyx', 'Polar Dark', [0x141c28, 0x1c2636, 0x0e141c, 0x7cd8ff, 2]],
      ['ronin', 'Glacier Blade', [0x2a4a62, 0x1e3648, 0x14222e, 0xe2f4ff, 3]],
    ],
    cards: [['Rime', 'Frozen', 'Pale', 'Hoar', 'Sleet', 'Boreal', 'Bitter', 'Silent', 'Frostbound', 'Northern'],
      ['Siding', 'Junction', 'Gantry', 'Coupling', 'Ballast', 'Sleeper', 'Points', 'Turntable', 'Buffer', 'Water Tower']],
    emblems: [['Ice', 'Snow', 'Winter', 'Cold', 'Glacial', 'Polar', 'Frost', 'Arctic', 'Chill', 'White'],
      ['Spur', 'Bolt', 'Rivet', 'Lantern', 'Crest', 'Mark', 'Seal', 'Token', 'Plate', 'Badge']],
  },
  {
    id: 'S2', n: 2, name: 'Signal Fire', start: '2026-12-28', days: SEASON_DAYS,
    tagline: 'Flares over the yard',
    theme: ['#1c0e0a', '#7a2a12', '#ffe0c0', '#ff7a2a'],
    palettes: [
      ['#1c0e0a', '#7a2a12', '#ffe0c0', '#ff7a2a'], ['#1a1208', '#6a4a14', '#fff0c8', '#ffcf40'],
      ['#160c14', '#5a1e3a', '#ffd0e4', '#ff4a6a'], ['#0e1014', '#2e3440', '#e8ecf2', '#ff9f1c'],
      ['#1a0a06', '#8a200a', '#ffd23f', '#ff4a0a'],
    ],
    event: { id: 'lightsout', name: 'Lights Out', from: 7, to: 21, mode: 'ko', mods: ['hardcore'], desc: 'Hardcore Kill Order for two weeks. Guard the VIP in the dark.' },
    paths: { weapon: 'antimat', operator: 'mako' },
    content: [],
    camos: [
      ['flare', 'Flare', 'tiger', [0xff6a1a, 0x1a0c08, 0xffd08a], 3.4],
      ['cinder', 'Firebox Grey', 'digital', [0x3a2a24, 0x1a1210, 0xff7a2a, 0x6a4a3a], 9.0],
      ['beacon', 'Beacon', 'hex', [0xffcf40, 0xb27616, 0x3a2408, 0x120c04], 8.0],
      ['soot', 'Coal Dust', 'splinter', [0x2a2624, 0x14120f, 0x6a625a, 0xff9f1c], 3.2],
      ['emberfall', 'Emberfall', 'splinter', [0x8a2a10, 0x3a140a, 0xffb06a, 0x1a0a06], 3.2],
      ['nightsignal', 'Night Signal', 'carbon', [0x14161c, 0x08090c, 0xff4a2a], 11.0],
      ['redlamp', 'Red Lamp', 'digital', [0xc8261a, 0x5a0e0a, 0xffd0c0, 0x1a0606], 9.0],
      ['brasswork', 'Brasswork', 'hex', [0xc9a240, 0x6a5420, 0xfff0c0, 0x2a2010], 8.0],
      ['wildfire', 'Wildfire', 'molten', [0x140806, 0xff6a10, 0xffe060], 3.0, true, 0xff7a20],
      ['lastsignal', 'Last Signal', 'singularity', [0x08040a, 0xff4a1a, 0xffe8c0, 0xff2b8a], 7.0, true, 0xff6a3a],
    ],
    skins: [
      ['marshal', 'Flagman', [0x2a1c18, 0x3a2620, 0x1c1210, 0xff7a2a, 1]],
      ['flint', 'Flarehand', [0x5a2a14, 0x3a1c10, 0x24140c, 0xffcf40, 1]],
      ['coyote', 'Ember Trail', [0x8a5a3a, 0x6a4430, 0x3a2618, 0xff6a2a, 0]],
      ['vesper', 'Dusk Watch', [0x1c1418, 0x2a1c22, 0x140e10, 0xff4a6a, 2]],
      ['relay', 'Beacon Crew', [0x2e3440, 0x262c36, 0x181c24, 0xff9f1c, 1]],
      ['morse', 'Night Wire', [0x1a1a22, 0x24242e, 0x121218, 0xffd659, 1]],
      ['seraph', 'Flareborn', [0xffe0c0, 0xd8b898, 0x8a6a4a, 0xff7a2a, 2]],
      ['monarch', 'Bonfire King', [0x3a1408, 0x5a2410, 0x24100a, 0xffd23f, 3]],
    ],
    cards: [['Signal', 'Flare', 'Ember', 'Cinder', 'Night', 'Redline', 'Smoke', 'Torch', 'Kindled', 'Bright'],
      ['Tower', 'Beacon', 'Watch', 'Lookout', 'Crossing', 'Platform', 'Semaphore', 'Lamp Room', 'Firebox', 'Footplate']],
    emblems: [['Fire', 'Burning', 'Blaze', 'Glow', 'Spark', 'Coal', 'Ash', 'Heat', 'Flash', 'Scorch'],
      ['Sigil', 'Pin', 'Star', 'Shield', 'Wheel', 'Key', 'Ring', 'Chevron', 'Medal', 'Wing']],
  },
];

// Cosmetic id helpers, so every module spells them alike.
export const camoId = (def, slug) => `s${def.n}-${slug}`;
export const seasonSkinId = (def, op) => `skin:${op}-s${def.n}`;
export const cardId = (def, i) => `s${def.n}-card-${String(i + 1).padStart(2, '0')}`;
export const emblemId = (def, i) => `s${def.n}-emb-${String(i + 1).padStart(2, '0')}`;

const PAIR = k => [k % 10, (k + Math.floor(k / 10) * 3) % 10];
const CARD_PATTERNS = ['shards', 'rails', 'frost', 'chevrons', 'rings', 'speed', 'waves', 'rays', 'circuit', 'facets', 'arc', 'signals'];
const CARD_ICONS = ['ui:star', 'ui:flag', 'ui:crown', 'ui:aim', 'ui:skull', 'ui:cup', 'ui:rank', 'ui:camo', 'medal:longshot', 'medal:headshot',
  'uav', 'strike', 'frag', 'smoke', 'flash', 'mode:dom', 'mode:hard', 'mode:snd', 'ar', 'sniper'];
const EMBLEM_PLATES = ['hex', 'shield', 'diamond', 'cut', 'oct'];
const EMBLEM_GLYPHS = ['rivet', 'chevron', 'lamp', 'gear', 'spike', 'bolt', 'fang', 'scope', 'wave', 'anchor', 'flake', 'sun', 'pennant', 'tag', 'crown', 'wing', 'star', 'gem', 'rails', 'bomb'];

// A season's 40 calling cards: [{ id, name, art }] (art as js/ui/cards.js draws it). The first one is the season's own
// card (tier 1) and the last ones are animated.
export function seasonCards(def) {
  return Array.from({ length: 40 }, (_, k) => {
    const [a, b] = PAIR(k), pal = def.palettes[k % def.palettes.length];
    const anim = k >= 36 ? (k % 2 ? 'prism' : 'gold') : null;
    return {
      id: cardId(def, k), name: k === 0 ? def.name : `${def.cards[0][a]} ${def.cards[1][b]}`,
      art: { p: CARD_PATTERNS[(k * 7 + def.n) % CARD_PATTERNS.length], c: k === 0 ? def.theme : pal, e: CARD_ICONS[(k * 3 + def.n) % CARD_ICONS.length], ...(k === 0 || anim ? { gold: true } : {}), ...(anim ? { anim } : {}) },
    };
  });
}

// A season's 40 emblems: [id, name, plate, rim, [glyph colours], glyph] rows like js/ui/emblems.js ROWS.
export function seasonEmblems(def) {
  return Array.from({ length: 40 }, (_, k) => {
    const [a, b] = PAIR(k), pal = def.palettes[(k + 2) % def.palettes.length];
    return [emblemId(def, k), `${def.emblems[0][a]} ${def.emblems[1][b]}`, EMBLEM_PLATES[(k + def.n) % EMBLEM_PLATES.length], pal[3], [pal[2], pal[3]],
      EMBLEM_GLYPHS[(k * 7 + def.n * 3) % EMBLEM_GLYPHS.length]];
  });
}

// The season's camos as CAMOS rows (tier 2, animated ones 3): `season` names the season, so the gunsmith can say where
// it comes from and progress.js can read ownership from the season grants.
export function seasonCamos(def) {
  return def.camos.map(([slug, name, pattern, colors, scale, animated, tint]) => ({
    id: camoId(def, slug), name, pattern, colors, scale, ...(animated ? { animated: true, tint } : {}), tier: animated ? 3 : 2, season: def.id,
  }));
}

// The 100 tiers: [{ tier, kind: 'card'|'emblem'|'camo'|'skin'|'weapon'|'operator', id, own }] where `own` is the id the
// save keeps once claimed ('card:..', 'emblem:..', 'camo:..', 'skin:..', 'weapon:..', 'operator:..').
const trackCache = new Map();
export function trackRewards(def) {
  if (trackCache.has(def.id)) return trackCache.get(def.id);
  const out = [], cards = seasonCards(def), embs = seasonEmblems(def), camos = seasonCamos(def);
  let ci = 0, ei = 0;
  for (let tier = 1; tier <= TRACK_TIERS; tier++) {
    let r;
    const camoAt = CAMO_TIERS.indexOf(tier), skinAt = SKIN_TIERS.indexOf(tier);
    if (tier === PATH_TIERS.weapon) r = { kind: 'weapon', id: def.paths.weapon };
    else if (tier === PATH_TIERS.operator) r = { kind: 'operator', id: def.paths.operator };
    else if (camoAt >= 0) r = { kind: 'camo', id: camos[camoAt].id };
    else if (skinAt >= 0) r = { kind: 'skin', id: seasonSkinId(def, def.skins[skinAt][0]) };
    else if (tier === 1 || (ci <= ei && ci < cards.length)) r = { kind: 'card', id: cards[ci++].id };
    else r = { kind: 'emblem', id: embs[ei++][0] };
    r.tier = tier;
    r.own = r.kind === 'skin' ? r.id : `${r.kind}:${r.id}`;
    out.push(r);
  }
  trackCache.set(def.id, out);
  return out;
}

/* ---------- Ranked divisions (js/shared/ranked.js) ---------- */
// Skill rating (SR) bands. Bronze to Master have three tiers each (I, II, III: I is the lowest), Champion none.
export const DIVISION_SPAN = 900;
export const DIVISIONS = [
  { id: 'bronze', name: 'Bronze', color: '#c27a44', light: '#ffc89a', dark: '#2a160c' },
  { id: 'silver', name: 'Silver', color: '#b8c4ce', light: '#f2f6fa', dark: '#1c2228' },
  { id: 'gold', name: 'Gold', color: '#f2c23a', light: '#fff0b8', dark: '#2a2008' },
  { id: 'platinum', name: 'Platinum', color: '#4ad8c8', light: '#d0fff8', dark: '#0c2624' },
  { id: 'diamond', name: 'Diamond', color: '#6aa8ff', light: '#dce8ff', dark: '#0e1a34' },
  { id: 'master', name: 'Master', color: '#c46aff', light: '#f0d8ff', dark: '#22103a' },
  { id: 'champion', name: 'Champion', color: '#ff4a5a', light: '#ffe0b0', dark: '#2a0a0e' },
];
// End-of-season rewards: a calling card and an emblem per division per season ('card:rk-s1-gold', 'emblem:rk-s1-gold').
export const rankRewardId = (def, div) => `rk-s${def.n}-${DIVISIONS[div].id}`;
const RANK_PATTERNS = ['plates', 'rails', 'chevrons', 'facets', 'rays', 'rays', 'rays'];
const RANK_GLYPHS = ['chevron', 'chevron', 'star', 'gem', 'gem', 'crown', 'crown'];
export function rankedCards(def) {
  return DIVISIONS.map((d, i) => ({
    id: rankRewardId(def, i), name: `${def.name} ${d.name}`, division: i,
    art: { p: RANK_PATTERNS[i], c: [d.dark, d.color, d.light, d.color], e: i >= 5 ? 'ui:crown' : 'ui:rank', gold: i >= 2, ...(i >= 5 ? { anim: i === 6 ? 'prism' : 'gold' } : {}) },
  }));
}
export function rankedEmblems(def) {
  return DIVISIONS.map((d, i) => [rankRewardId(def, i), `${def.name} ${d.name} Crest`, i >= 5 ? 'shield' : 'hex', d.color, [d.light, d.color], RANK_GLYPHS[i]]);
}
