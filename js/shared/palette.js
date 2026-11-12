// Colour modes (Options > Accessibility > Colour mode, docs/ACCESSIBILITY.md): the one place that decides which
// colours mean "your side", "the other side", the free-for-all and squad colours, success and danger, and battle royale
// rarity. applyPalette() swaps them in place, so every reader keeps working unchanged:
//  - TEAMS[i].color / .css (js/shared/constants.js), read at use time by the HUD, the minimap, the feed, the menus and
//    the world build;
//  - TEAM_RGB below, the [r, g, b] arrays the renderers share (characters' rings and tints, tracers, objective zones,
//    flags): they are rewritten in place, so a palette change shows on the next frame;
//  - BR.rarityCss / rarityHex (js/shared/modes.js);
//  - the CSS tokens --c-blue, --c-red, --c-go (and their -lo, -hi, -glow, --face-*) on the document root, which every
//    screen and the HUD read, plus html[data-cb] for the shape cues that only show in a colour mode.
// Modes keep the same two roles (team 0, team 1): they are tuned so the two sides differ for that kind of colour vision
// in hue and lightness, and danger never relies on red against green.
import { TEAMS, FFA_TEAM, FFA_MAX } from './constants.js';
import { BR } from './modes.js';

export const COLOR_MODES = [['off', 'Off'], ['protan', 'Protanopia'], ['deutan', 'Deuteranopia'], ['tritan', 'Tritanopia'], ['contrast', 'High contrast']];

const hex = n => '#' + n.toString(16).padStart(6, '0');
const num = css => parseInt(css.slice(1), 16);
const rgb = n => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
const mix = (a, b, t) => { const x = rgb(num(a)), y = rgb(num(b)); return hex(x.map((v, i) => Math.round((v + (y[i] - v) * t) * 255)).reduce((s, v) => (s << 8) | v, 0)); };
const rgba = (css, a) => { const [r, g, b] = rgb(num(css)); return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`; };

// The shipped colours, read once before any mode touches them.
const BASE = {
  teams: TEAMS.slice(0, FFA_TEAM + FFA_MAX).map(t => t.css),
  rarity: BR.rarityCss.slice(),
  go: '#4bd18a',
};

// Per mode: ally (team 0), enemy (team 1), go (ready, success, full health), the twelve free-for-all / squad colours,
// and the five rarities (common .. legendary). Danger and damage use the enemy colour in every colour mode.
const MODES = {
  off: { teams: BASE.teams.slice(0, 2), go: BASE.go, ffa: BASE.teams.slice(FFA_TEAM), rarity: BASE.rarity },
  // Red-weak: reds look dark and close to greens. Blue against a bright yellow, success in cyan.
  protan: {
    teams: ['#2f8fff', '#ffe02e'], go: '#5fd4f0',
    ffa: ['#ffe14d', '#9ec5ff', '#ff9a3c', '#2f6dff', '#f2f0e6', '#b48cff', '#ffc2e8', '#00b3ff', '#c9a400', '#6f7dff', '#ffd9a0', '#7fe0ff'],
    rarity: ['#c9cbc4', '#5fd4f0', '#2f6dff', '#e070ff', '#ffd400'],
  },
  // Green-weak: the same axis with a slightly warmer yellow.
  deutan: {
    teams: ['#3d9bff', '#ffd23a'], go: '#4fd8e8',
    ffa: ['#ffd23a', '#a8ccff', '#ff9a3c', '#2f6dff', '#f2f0e6', '#b48cff', '#ffc2e8', '#00b3ff', '#c9a400', '#6f7dff', '#ffd9a0', '#7fe0ff'],
    rarity: ['#c9cbc4', '#4fd8e8', '#2f6dff', '#e070ff', '#ffc21a'],
  },
  // Blue-weak: blue meets green and yellow meets violet. Teal against a rose red.
  tritan: {
    teams: ['#19d3c5', '#ff3d6e'], go: '#7cf0b0',
    ffa: ['#ff3d6e', '#19d3c5', '#ff9ccf', '#0a8f88', '#f2f0e6', '#ff7a3c', '#8a2be2', '#9ff7ef', '#c4002f', '#5c6cff', '#ffc9b0', '#b0b0b0'],
    rarity: ['#c9cbc4', '#19d3c5', '#5c6cff', '#ff7ad9', '#ff5a3c'],
  },
  // Low vision: the brightest pair, heavier outlines (css/game.css html[data-cb="contrast"]).
  contrast: {
    teams: ['#00e1ff', '#ff2e5b'], go: '#2bff88',
    ffa: ['#ffee00', '#00e1ff', '#ff8a00', '#2bff88', '#ffffff', '#c27bff', '#ff6fd8', '#7fb2ff', '#c8ff00', '#ffb3a8', '#00ffd5', '#ffd27a'],
    rarity: ['#e7eae4', '#2bff88', '#3f8bff', '#d26bff', '#ffd000'],
  },
};

// Shared [r, g, b] per TEAMS entry for the renderers. Rewritten in place by applyPalette.
export const TEAM_RGB = TEAMS.map(t => rgb(t.color));

let current = 'off';
const listeners = new Set();
export const colorMode = () => current;
export function onPalette(cb) { listeners.add(cb); return () => listeners.delete(cb); }

// The CSS tokens a mode sets on the document root (empty for Off, so css/tokens.css stands).
export function paletteTokens(id) {
  if (id === 'off' || !MODES[id]) return {};
  const m = MODES[id], [ally, enemy] = m.teams;
  return {
    '--c-blue': ally, '--c-blue-lo': mix(ally, '#000000', 0.45), '--c-blue-hi': mix(ally, '#ffffff', 0.3), '--c-blue-glow': rgba(ally, 0.45),
    '--c-red': enemy, '--c-red-lo': mix(enemy, '#000000', 0.45), '--c-red-hi': mix(enemy, '#ffffff', 0.3), '--c-red-glow': rgba(enemy, 0.45),
    '--c-go': m.go, '--c-go-lo': mix(m.go, '#000000', 0.45),
    '--face-blue': `linear-gradient(172deg, ${mix(ally, '#ffffff', 0.3)} 0%, ${ally} 48%, ${mix(ally, '#000000', 0.18)} 100%)`,
    '--face-red': `linear-gradient(172deg, ${mix(enemy, '#ffffff', 0.3)} 0%, ${enemy} 48%, ${mix(enemy, '#000000', 0.18)} 100%)`,
  };
}
const TOKEN_KEYS = Object.keys(paletteTokens('protan'));

export function applyPalette(id) {
  if (!MODES[id]) id = 'off';
  current = id;
  const m = MODES[id];
  for (let i = 0; i < TEAMS.length; i++) {
    const css = i < FFA_TEAM ? m.teams[i] : m.ffa[(i - FFA_TEAM) % FFA_MAX];
    TEAMS[i].css = css;
    TEAMS[i].color = num(css);
    const c = rgb(TEAMS[i].color);
    if (TEAM_RGB[i]) { TEAM_RGB[i][0] = c[0]; TEAM_RGB[i][1] = c[1]; TEAM_RGB[i][2] = c[2]; } else TEAM_RGB[i] = c;
  }
  for (let r = 0; r < BR.rarityCss.length; r++) { BR.rarityCss[r] = m.rarity[r]; BR.rarityHex[r] = num(m.rarity[r]); }
  if (typeof document !== 'undefined') {
    const root = document.documentElement, tokens = paletteTokens(id);
    for (const k of TOKEN_KEYS) root.style.removeProperty(k);
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
    if (id === 'off') delete root.dataset.cb; else root.dataset.cb = id;
  }
  for (const fn of listeners) fn(id);
}
