// Calling cards and the Veteran / Recruit tag. Cards are drawn here from the data in js/shared/progression.js (CARDS):
// a procedural SVG ground in the card's pattern and colours, an emblem plate (perk or UI icon, prestige badge, or a camo
// swatch) and a stencil name. No images, no ids or defs in the SVG, so one card can appear many times on a page.
//
//   cardHtml(id, {size, title, sub, locked, equipped})  markup for one card. size 's' 160 / 'm' 230 / 'l' 300 px wide,
//                                    or a number. title replaces the card's name (the killer card puts the player there).
//   cardsSheet(menu, {onClose, onChange})   the full-screen picker; equips through Progress.setCard.
//   setRosterIdentity(roster) / identityOf(id)   who carries which card and who is a Veteran, for HUD and results.
//   vetOf(entry)  Veteran rule for a roster or lobby entry ({badge, loadout:{pro}}).  vetTag(vet, {short})  the chip.
import { CARDS, CARD_GROUPS, getCard, isVeteran, badgeSvg } from '../shared/progression.js';
import { getCamo } from '../shared/camos.js';
import { icon } from './icons.js';
import { esc, swatchCss } from './widgets.js';
import { Progress } from './progress.js';
import { stagger, pop } from './motion.js';

const W = 300, H = 80;           // Design box of every card; CSS scales it.
const SIZES = { s: 160, m: 230, l: 300 };

/* ---------- Identity ---------- */
const roster = new Map();        // Player id -> {card, vet}

export function vetOf(entry) {
  const b = entry?.badge ?? {};
  return isVeteran({ prestige: b.prestige ?? 0, level: b.level ?? 1, pro: entry?.loadout?.pro ?? [] });
}

// Called by the HUD as each match is prepared; results read the same map after the match.
export function setRosterIdentity(list = []) {
  roster.clear();
  for (const r of list) roster.set(r.id, { card: r.loadout?.card ?? r.card ?? null, vet: vetOf(r) });
}

export const identityOf = id => roster.get(id) ?? null;

// `level` folds the player's level into the chip ("Vet 34"), where a row has no room for both.
export function vetTag(vet, { short = false, level = null } = {}) {
  const word = vet ? (short ? 'Vet' : 'Veteran') : (short ? 'Rct' : 'Recruit');
  const lv = level != null ? ` <u>${Number(level) || 1}</u>` : '';
  return `<i class="vet-tag${vet ? ' vet' : ''}${short ? ' short' : ''}" title="${vet ? 'Veteran' : 'Recruit'}">${vet ? VET_CHEVRON : ''}${word}${lv}</i>`;
}
const VET_CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true"><polygon points="0,4 5,0 10,4 10,7 5,3 0,7" fill="currentColor"/><polygon points="0,8 5,4.5 10,8 10,10 5,6.5 0,10" fill="currentColor" opacity=".6"/></svg>';

/* ---------- Drawing ---------- */
// Small seeded generator, so a card always draws the same and two cards of one pattern still differ.
function seeded(id) {
  let a = 2166136261;
  for (const ch of id) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f1 = v => Math.round(v * 10) / 10;
const poly = (pts, fill, extra = '') => `<polygon points="${pts.map(p => `${f1(p[0])},${f1(p[1])}`).join(' ')}" fill="${fill}"${extra}/>`;
const line = (x1, y1, x2, y2, stroke, w, extra = '') => `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${stroke}" stroke-width="${w}"${extra}/>`;
const circ = (x, y, r, fill, extra = '') => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${fill}"${extra}/>`;
const path = (d, stroke, w, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}"${extra}/>`;

// Each pattern fills the 300x80 box over a flat ground. c: [ground, mid, light, accent].
const PATTERNS = {
  hazard(c, r) {
    let s = '';
    for (let x = 150; x < W + 40; x += 22) s += poly([[x, 0], [x + 11, 0], [x - 29, H], [x - 40, H]], c[3], ' opacity=".85"');
    s += poly([[0, H - 10], [W, H - 10], [W, H], [0, H]], c[1]);
    return s + line(0, 12, W * (0.5 + r() * 0.3), 12, c[2], 1.5, ' opacity=".4"');
  },
  rails(c, r) {
    let s = '';
    for (let i = 0; i < 16; i++) { const x = i * 21 + r() * 4; s += poly([[x, 46], [x + 9, 46], [x + 14, 80], [x + 3, 80]], c[1]); }
    s += line(0, 54, W, 54, c[2], 3) + line(0, 70, W, 70, c[2], 4);
    for (let i = 0; i < 5; i++) s += line(110 + i * 40, 6 + i * 3, 300, 6 + i * 3, c[1], 1, ' opacity=".6"');
    return s;
  },
  plates(c, r) {
    let s = '';
    for (let y = 0; y < H; y += 27) for (let x = (y / 27 % 2) * -24; x < W; x += 48) {
      s += poly([[x + 2, y + 2], [x + 46, y + 2], [x + 46, y + 25], [x + 2, y + 25]], r() < 0.2 ? c[3] : c[1], ' opacity=".55"');
      s += circ(x + 6, y + 6, 1.4, c[2]) + circ(x + 42, y + 21, 1.4, c[2]);
    }
    return s;
  },
  cross(c, r) {
    let s = '';
    for (let i = 0; i < 9; i++) {
      const x = 110 + r() * 190, y = r() * H, k = 4 + r() * 6;
      s += poly([[x - k, y - k / 3], [x + k, y - k / 3], [x + k, y + k / 3], [x - k, y + k / 3]], c[1]) + poly([[x - k / 3, y - k], [x + k / 3, y - k], [x + k / 3, y + k], [x - k / 3, y + k]], c[1]);
    }
    return s + poly([[262, 16], [278, 16], [278, 32], [294, 32], [294, 48], [278, 48], [278, 64], [262, 64], [262, 48], [246, 48], [246, 32], [262, 32]], c[3], ' opacity=".8"');
  },
  hex(c) {
    let s = '';
    for (let row = 0; row < 6; row++) for (let col = 0; col < 18; col++) {
      const x = col * 18 + (row % 2) * 9, y = row * 15.6, k = 9;
      const pts = Array.from({ length: 6 }, (_, i) => [x + Math.cos(Math.PI / 6 + i * Math.PI / 3) * k, y + Math.sin(Math.PI / 6 + i * Math.PI / 3) * k]);
      s += poly(pts, 'none', ` stroke="${(row * 7 + col) % 11 === 0 ? c[3] : c[1]}" stroke-width="1.4"`);
    }
    return s;
  },
  pulse(c, r) {
    let d = 'M0 48', x = 0;
    while (x < W) {
      x += 18 + r() * 12;
      if (r() < 0.45) d += ` L${f1(x)} 48 L${f1(x + 5)} 20 L${f1(x + 10)} 70 L${f1(x + 15)} 42 L${f1(x + 19)} 48`, x += 19;
      else d += ` L${f1(x)} 48`;
    }
    return path(d, c[1], 6, ' opacity=".7" stroke-linejoin="round"') + path(d, c[3], 2, ' stroke-linejoin="round"');
  },
  crates(c, r) {
    let s = '';
    for (let x = 100; x < W; x += 34) {
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const y = H - 30 * (k + 1);
        s += poly([[x, y], [x + 30, y], [x + 30, y + 28], [x, y + 28]], c[1]) + line(x + 3, y + 3, x + 27, y + 25, c[2], 1.5, ' opacity=".5"') + line(x + 27, y + 3, x + 3, y + 25, c[2], 1.5, ' opacity=".5"');
      }
    }
    return s;
  },
  speed(c, r) {
    let s = '';
    for (let i = 0; i < 22; i++) {
      const y = 4 + r() * (H - 8), x = 90 + r() * 140, len = 30 + r() * 120;
      s += line(x, y, Math.min(W, x + len), y, i % 5 === 0 ? c[3] : i % 2 ? c[2] : c[1], 1 + r() * 2.5, ' opacity=".7" stroke-linecap="round"');
    }
    return s;
  },
  arc(c, r) {
    let s = '';
    for (let i = 0; i < 3; i++) {
      const x0 = 96 + i * 18, x1 = 240 + r() * 40, top = 4 + i * 10;
      s += path(`M${x0} 74 Q${f1((x0 + x1) / 2)} ${f1(top - 30)} ${f1(x1)} 66`, i === 0 ? c[2] : c[1], 2, ' stroke-dasharray="5 4"');
    }
    return s + circ(262, 64, 15, 'none', ` stroke="${c[3]}" stroke-width="2"`) + circ(262, 64, 25, 'none', ` stroke="${c[3]}" stroke-width="1" opacity=".5"`);
  },
  belts(c) {
    let s = '';
    for (let k = 0; k < 2; k++) {
      const off = k * 70;
      s += poly([[100 + off, 0], [128 + off, 0], [208 + off, H], [180 + off, H]], c[1]);
      for (let i = 0; i < 8; i++) { const t = i / 8; s += poly([[110 + off + t * 80, t * H + 2], [118 + off + t * 80, t * H + 2], [122 + off + t * 80, t * H + 9], [114 + off + t * 80, t * H + 9]], c[2]); }
    }
    return s;
  },
  chevrons(c) {
    let s = '';
    for (let i = 0; i < 9; i++) {
      const x = 96 + i * 24;
      s += poly([[x, 10], [x + 12, 10], [x + 30, 40], [x + 12, 70], [x, 70], [x + 18, 40]], i === 6 ? c[3] : c[1], ` opacity="${(0.35 + i * 0.07).toFixed(2)}"`);
    }
    return s;
  },
  fog(c, r) {
    let s = '';
    for (let i = 0; i < 14; i++) s += circ(80 + r() * 230, r() * H, 12 + r() * 26, i % 3 ? c[1] : c[2], ` opacity="${(0.08 + r() * 0.16).toFixed(2)}"`);
    return s;
  },
  frost(c, r) {
    let s = '';
    for (let i = 0; i < 7; i++) {
      const x = 110 + r() * 180, y = r() * H, k = 8 + r() * 14;
      for (let a = 0; a < 6; a++) {
        const t = a * Math.PI / 3, ex = x + Math.cos(t) * k, ey = y + Math.sin(t) * k;
        s += line(x, y, ex, ey, c[2], 1.2, ' opacity=".7"');
        s += line(x + Math.cos(t) * k * 0.55, y + Math.sin(t) * k * 0.55, x + Math.cos(t + 0.5) * k * 0.8, y + Math.sin(t + 0.5) * k * 0.8, c[1], 1);
      }
    }
    return s;
  },
  waves(c, r) {
    let s = '';
    for (let k = 0; k < 6; k++) {
      let d = `M90 ${40}`, amp = 4 + k * 4.5, ph = r() * 6;
      for (let x = 90; x <= W; x += 6) d += ` L${x} ${f1(40 + Math.sin(x / (10 + k * 2) + ph) * amp)}`;
      s += path(d, k === 2 ? c[3] : c[1], 1.4, ` opacity="${(0.9 - k * 0.12).toFixed(2)}"`);
    }
    return s;
  },
  prints(c, r) {
    let s = '', x = 92, y = 62 + r() * 6, a = -0.25;
    for (let i = 0; i < 12; i++) {
      a += (r() - 0.5) * 0.4;
      x += Math.cos(a) * 17; y += Math.sin(a) * 17;
      const side = i % 2 ? 1 : -1, px = x + Math.cos(a + Math.PI / 2) * 4 * side, py = y + Math.sin(a + Math.PI / 2) * 4 * side;
      s += `<ellipse cx="${f1(px)}" cy="${f1(py)}" rx="4.4" ry="2.4" transform="rotate(${f1(a * 180 / Math.PI)} ${f1(px)} ${f1(py)})" fill="${c[2]}" opacity="${(0.25 + i * 0.06).toFixed(2)}"/>`;
      if (y < 10) a += 0.8; else if (y > 70) a -= 0.8;
    }
    return s;
  },
  circuit(c, r) {
    let s = '';
    for (let i = 0; i < 10; i++) {
      let x = 96 + r() * 60, y = 6 + i * 7.4;
      const x2 = x + 40 + r() * 100, x3 = Math.min(W - 6, x2 + 20 + r() * 50), y2 = y + (r() - 0.5) * 20;
      s += path(`M${f1(x)} ${f1(y)} L${f1(x2)} ${f1(y)} L${f1(x2 + Math.abs(y2 - y))} ${f1(y2)} L${f1(x3)} ${f1(y2)}`, c[1], 1.6);
      s += circ(x3, y2, 2.4, i % 3 ? c[2] : c[3]);
    }
    return s;
  },
  rays(c) {
    let s = '';
    for (let i = 0; i < 18; i++) {
      const a0 = -Math.PI / 2 + (i / 18) * Math.PI * 2;
      s += poly([[40, 40], [40 + Math.cos(a0) * 330, 40 + Math.sin(a0) * 330], [40 + Math.cos(a0 + 0.17) * 330, 40 + Math.sin(a0 + 0.17) * 330]], i % 2 ? c[1] : c[3], ` opacity="${i % 2 ? 0.5 : 0.22}"`);
    }
    return s;
  },
  rings(c) {
    let s = '';
    for (let k = 1; k <= 7; k++) s += circ(250, 40, k * 11, 'none', ` stroke="${k === 3 ? c[3] : c[1]}" stroke-width="${k === 3 ? 2.4 : 1.4}"`);
    return s + line(250, 0, 250, 80, c[2], 1, ' opacity=".5"') + line(170, 40, 300, 40, c[2], 1, ' opacity=".5"');
  },
};

const CUT = 10;
const HOUSE = `${CUT},0 ${W},0 ${W},${H - CUT} ${W - CUT},${H} 0,${H} 0,${CUT}`;
const ground = new Map();       // Card id -> SVG ground markup, drawn once.

function groundSvg(card) {
  let s = ground.get(card.id);
  if (s) return s;
  const { p, c, gold } = card.art;
  const r = seeded(card.id);
  // Ground, the pattern, a dark wash behind the text, and the frame (gold for Pro and mastery).
  s = `<svg class="cc-bg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`
    + poly([[0, 0], [W, 0], [W, H], [0, H]], c[0]) + (PATTERNS[p] ?? PATTERNS.hazard)(c, r)
    + poly([[60, 0], [215, 0], [185, H], [60, H]], c[0], ' opacity=".55"')
    + `<polygon points="${HOUSE}" fill="none" stroke="${gold ? '#ffd659' : 'rgba(231,234,228,.28)'}" stroke-width="${gold ? 4 : 2}"/>`
    + (gold ? `<polygon points="${CUT + 4},4 ${W - 4},4 ${W - 4},${H - CUT - 2} ${W - CUT - 2},${H - 4} 4,${H - 4} 4,${CUT + 2}" fill="none" stroke="#ffd659" stroke-width="1" opacity=".45"/>` : '')
    + '</svg>';
  ground.set(card.id, s);
  return s;
}

function emblem(card, px) {
  const e = card.art.e, [, , light, accent] = card.art.c;
  if (e.startsWith('badge:')) return badgeSvg(Number(e.slice(6)), px);
  if (e.startsWith('camo:')) return `<i class="cc-swatch" style="background:${swatchCss(getCamo(e.slice(5)))}"></i>`;
  return icon(e, { size: Math.round(px * 0.78), color: light, accent });
}

// Markup for one card. Sizes are px widths; everything inside scales with --cw.
export function cardHtml(id, { size = 'm', title, sub, locked = false, equipped = false, cls = '' } = {}) {
  const card = getCard(id);
  const w = typeof size === 'number' ? size : SIZES[size] ?? SIZES.m;
  const name = title ?? card.name;
  const line2 = sub ?? card.group;
  return `<span class="ccard${card.art.gold ? ' gold' : ''}${locked ? ' locked' : ''}${equipped ? ' equipped' : ''}${cls ? ' ' + cls : ''}" style="--cw:${w}px" data-card="${esc(card.id)}">
    ${groundSvg(card)}
    <span class="cc-em">${emblem(card, Math.round(w * 0.2))}</span>
    <span class="cc-tx"><b>${esc(name)}</b>${line2 ? `<small>${esc(line2)}</small>` : ''}</span>
    ${locked ? `<span class="cc-lock">${icon('ui:lock', { size: Math.max(12, Math.round(w * 0.06)) })}</span>` : ''}
    ${equipped ? `<span class="cc-on">${icon('ui:check', { size: Math.max(10, Math.round(w * 0.05)), accent: 'currentColor' })}</span>` : ''}
  </span>`;
}

/* ---------- Picker ---------- */
// Full-screen sheet over whatever screen opened it. Tap an earned card to equip it; a locked one says what earns it.
export function cardsSheet(menu, { onClose, onChange } = {}) {
  let group = 'All';
  const render = () => {
    const list = Progress.cards();
    const shown = group === 'All' ? list : list.filter(x => x.card.group === group);
    const have = list.filter(x => x.unlocked).length;
    const on = list.find(x => x.equipped)?.card ?? CARDS[0];
    menu.overlay(`
      <div class="cards-sheet">
        <div class="cs-head">
          <div class="cs-title"><b>Calling cards</b><small>${have} of ${list.length} earned</small></div>
          <div class="cs-now">${cardHtml(on.id, { size: 's', sub: 'Equipped' })}</div>
          <button class="btn is-primary cs-done" data-act="csDone" data-sound="confirm">${icon('ui:check', { size: 18, accent: 'currentColor' })}<b>Done</b></button>
        </div>
        <nav class="cs-tabs">${['All', ...CARD_GROUPS].map(g => {
          const n = g === 'All' ? have : list.filter(x => x.card.group === g && x.unlocked).length;
          const of = g === 'All' ? list.length : list.filter(x => x.card.group === g).length;
          return `<button class="cs-tab${g === group ? ' on' : ''}" data-act="csGroup" data-g="${g}" data-sound="tab"><b>${g}</b><small>${n}/${of}</small></button>`;
        }).join('')}</nav>
        <div class="cs-grid">${shown.map(x => `
          <button class="cs-cell${x.unlocked ? '' : ' locked'}${x.equipped ? ' on' : ''}" data-act="csPick" data-id="${x.card.id}" ${x.unlocked ? '' : 'data-sound="deny"'}>
            ${cardHtml(x.card.id, { size: 228, locked: !x.unlocked, equipped: x.equipped, sub: x.card.req })}
          </button>`).join('')}</div>
      </div>`);
    stagger(menu.overlayEl.querySelectorAll('.cs-cell'), 'up', { step: 18, max: 14 });
  };
  menu.on({
    csDone: () => { menu.overlay(''); onClose?.(); },
    csGroup: ({ g }) => { group = g; render(); },
    csPick: ({ id }) => {
      const card = getCard(id);
      if (!Progress.setCard(id)) { menu.toast(`${card.name}: ${card.req}`); return; }
      onChange?.(id);
      render();
      pop(menu.overlayEl.querySelector('.cs-now .ccard'));
    },
  });
  render();
}

/* ---------- Results ---------- */
// A player's card with their name on it, for the MVP chip and anywhere else results name someone.
export function playerBanner(id, name, { size = 150, sub = '' } = {}) {
  return cardHtml(identityOf(id)?.card ?? 'yard', { size, title: name, sub });
}

// Pro steps this match moved, for the results screen: perk icon, name, one bar per step. At most `max` perks.
export function proProgressHtml(list = [], max = 2) {
  if (!list.length) return '';
  return `<div class="rs-pro"><small class="rs-pro-h">Pro challenges</small>${list.slice(0, max).map(p => `
    <div class="rs-pro-row${p.done ? ' done' : ''}">${icon(p.perk, { size: 16 })}<b>${esc(p.name)}</b>
      <span class="rs-pro-bars">${p.steps.map(c => `<i style="--a:${(c.before / c.goal).toFixed(3)};--f:${(c.value / c.goal).toFixed(3)}"></i>`).join('')}</span>
    </div>`).join('')}</div>`;
}

// The ceremony card for a Pro perk or a calling card earned this match, or null for every other unlock.
export function unlockStamp(u) {
  if (u.kind === 'pro') {
    return `<div class="rx-card rx-unlock rx-pro">
      <span class="rx-mark rx-pro-mark">${icon(u.id, { size: 84, accent: '#fff4bf' })}<i class="pro-chip">Pro</i></span>
      <span class="rx-kick">Pro perk unlocked</span>
      <h2>${esc(u.name)}</h2>
      <small>${esc(u.desc ?? '')}</small>
    </div>`;
  }
  if (u.kind === 'card') {
    return `<div class="rx-card rx-unlock rx-cardwin">
      <span class="rx-kick">New calling card</span>
      <span class="rx-mark">${cardHtml(u.id, { size: 360, sub: u.req })}</span>
      <small>Equip it from your loadout or service record</small>
    </div>`;
  }
  return null;
}
