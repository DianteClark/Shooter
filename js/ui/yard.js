// Chrome shared by every screen outside a match: the header bar, back buttons, icon lookup, and the drawn yard
// silhouette that stands in for the live backdrop until its first frame (or for good, if WebGL is unavailable).
import * as Icons from './icons.js';
import { esc } from './widgets.js';

// ---- Icons --------------------------------------------------------------------------------------------------------
// One lookup for every menu glyph, so the screens name an action ('host', 'gunsmith') and never care which drawing in
// js/ui/icons.js stands for it. Item ids (weapons, perks, 'mode:tdm', 'map:dust', 'cat:SMG') pass straight through.
const ACTION = {
  back: 'ui:back', next: 'ui:next', close: 'ui:close', check: 'ui:check', equip: 'ui:check', play: 'ui:play', bots: 'ui:bot',
  host: 'ui:home', rejoin: 'ui:refresh', retry: 'ui:refresh', range: 'ui:aim', loadout: 'ui:loadout', gunsmith: 'ui:gunsmith',
  operator: 'ui:operator', stats: 'ui:stats', options: 'ui:settings', help: 'ui:info', save: 'ui:download', copy: 'ui:copy',
  load: 'ui:download', export: 'ui:share', share: 'ui:share', trash: 'ui:trash', edit: 'ui:edit', crown: 'ui:star',
  team: 'ui:party', swapteam: 'swap', ready: 'ui:ready', wait: 'ui:clock', signal: 'ui:signal', warn: 'ui:warning',
  plus: 'ui:plus', minus: 'ui:minus', map: 'ui:map', sound: 'ui:volume', graphics: 'ui:eye', controls: 'ui:aim',
  rank: 'ui:rank', lock: 'ui:lock', unlock: 'ui:unlock', camo: 'ui:camo', prestige: 'ui:prestige', timer: 'ui:timer',
  user: 'ui:user', skull: 'ui:skull', cup: 'ui:cup', flag: 'ui:flag', voice: 'ui:headset', new: 'ui:new', star: 'ui:star',
  info: 'ui:info', menu: 'ui:menu', exit: 'ui:exit', settings: 'ui:settings',
};

// The few actions the set has no drawing for, drawn to its rules: solid, chamfered, details cut out.
const SOLID = {
  quick: '<path d="M19 2L6 18h8l-3 12 15-18h-8l4-10z"/>',
  join: '<path d="M16 3h12v26H16v-4h8V7h-8z M4 13h9V8l8 8-8 8v-5H4z"/>',
  random: '<path fill-rule="evenodd" d="M7 4h18l3 3v18l-3 3H7l-3-3V7zM10 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM22 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM16 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM10 20a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM22 20a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>',
  phone: '<path fill-rule="evenodd" d="M10 2h12l3 3v22l-3 3H10l-3-3V5zM11 6v18h10V6zM14 26h4v2h-4z"/>',
  paste: '<path fill-rule="evenodd" d="M11 2h10v3h4l2 2v21l-2 2H7l-2-2V7l2-2h4zM13 4v4h6V4zM10 14h12v3H10zM10 20h8v3h-8z"/>',
};

// An icon as markup: `ico('back')`, `ico('ar')`, `ico('mode:kc', 'big')`. CSS sizes it by height; width follows.
export function ico(name, cls = '', size = 20) {
  if (SOLID[name]) {
    return `<svg class="ico ico-${name}${cls ? ' ' + cls : ''}" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false"><g fill="currentColor">${SOLID[name]}</g></svg>`;
  }
  return Icons.icon(ACTION[name] ?? name, { size, cls });
}

// ---- Headers --------------------------------------------------------------------------------------------------------
// Every screen opens with the same bar: a back plate on the left, the screen's name in stencil, then whatever the
// screen puts on the right. `back` is the data-act of the back button; `label` what it says (Back, Done, Leave).
export function backButton(act, label = 'Back') {
  return `<button class="back" data-act="${esc(act)}">${ico('back')}<b>${esc(label)}</b></button>`;
}

export function header({ back, label = 'Back', title, cls = '', extra = '' }) {
  return `<header class="bar${cls ? ' ' + cls : ''}" data-in="down">
    ${backButton(back, label)}
    <h2 class="bar-title">${esc(title)}</h2>
    ${extra}
  </header>`;
}

// ---- The drawn yard ------------------------------------------------------------------------------------------------
// A low-poly dusk sky over container stacks and a gantry crane, generated rather than shipped as an image.
const VIEW_W = 844, VIEW_H = 390, HORIZON = 178;

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Dusk runs from sodium orange at the horizon, through bruised mauve, to steel night overhead.
const STOPS = [[0, [24, 26, 40]], [0.5, [60, 50, 80]], [0.82, [130, 78, 78]], [1, [214, 136, 68]]];

function sky(t) {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const f = (t - a) / (b - a);
      return ca.map((v, c) => v + (cb[c] - v) * f);
    }
  }
  return STOPS[STOPS.length - 1][1];
}

const css = ([r, g, b]) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

function skyPolys(rand) {
  const cols = 15, rows = 6, jitter = 0.34;
  const cw = VIEW_W / cols, ch = HORIZON / rows;
  const pts = [];
  for (let r = 0; r <= rows; r++) {
    pts[r] = [];
    for (let c = 0; c <= cols; c++) {
      const edge = c === 0 || c === cols || r === 0 || r === rows;
      pts[r][c] = [c * cw + (edge ? 0 : (rand() - 0.5) * cw * jitter * 2), r * ch + (edge ? 0 : (rand() - 0.5) * ch * jitter * 2)];
    }
  }
  const tri = (a, b, c) => {
    const cy = (a[1] + b[1] + c[1]) / 3, cx = (a[0] + b[0] + c[0]) / 3;
    const t = Math.min(1, Math.max(0, cy / HORIZON * (0.82 + (cx / VIEW_W) * 0.28) + (rand() - 0.5) * 0.09));
    const fill = css(sky(t));
    return `<polygon points="${a} ${b} ${c}" fill="${fill}" stroke="${fill}" stroke-width=".6"/>`;
  };
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = pts[r][c], b = pts[r][c + 1], d = pts[r + 1][c], e = pts[r + 1][c + 1];
      out += rand() > 0.5 ? tri(a, b, d) + tri(b, e, d) : tri(a, b, e) + tri(a, e, d);
    }
  }
  return out;
}

function containerStacks(rand) {
  const colors = ['#232b34', '#29323c', '#20272f', '#2d353d', '#332f39'];
  let out = '', x = -10;
  while (x < VIEW_W + 40) {
    const width = 54 + rand() * 40, high = 1 + Math.floor(rand() * 4), h = 21;
    for (let i = 0; i < high; i++) {
      out += `<rect x="${x.toFixed(1)}" y="${HORIZON + 8 - (i + 1) * h}" width="${width.toFixed(1)}" height="${h - 1}" fill="${colors[Math.floor(rand() * colors.length)]}"/>`;
    }
    x += width + (rand() < 0.2 ? 10 + rand() * 30 : 1);
  }
  return out;
}

function gantry() {
  const c = '#161b22';
  return `<g transform="translate(0 -58)">
    <path fill="${c}" d="M664 240 L672 96 L680 96 L676 240 Z M742 240 L738 96 L746 96 L754 240 Z"/>
    <path fill="${c}" d="M620 96 H806 V106 H620 Z M660 80 H770 V96 H660 Z M702 62 H728 V80 H702 Z"/>
    <path fill="none" stroke="${c}" stroke-width="2.4" d="M672 112 L744 168 M744 112 L672 168 M676 170 L750 226 M750 170 L676 226"/>
    <rect x="688" y="150" width="34" height="14" fill="${c}"/></g>`;
}

export function yardBackdrop() {
  const rand = rng(90417);
  return `<svg class="yard" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${skyPolys(rand)}${containerStacks(rand)}
    <rect y="${HORIZON + 8}" width="${VIEW_W}" height="${VIEW_H - HORIZON - 8}" fill="#1b2128"/>
    <rect y="${HORIZON + 8}" width="${VIEW_W}" height="3" fill="#ad6a3e" opacity=".5"/>
    ${gantry()}
  </svg>`;
}
