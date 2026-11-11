// Calling cards, emblems, skins and the Veteran / Recruit tag. Cards are drawn here from the data in
// js/shared/progression.js (CARDS, which js/ui/cardbook.js extends): a procedural SVG ground in the card's pattern and
// colours, an emblem plate (perk or UI icon, prestige badge, or a camo swatch) and a stencil name. Mastery cards carry
// an animated tier (gold sweep, prism cycle, molten breath) drawn by CSS over the ground. No images, no ids or defs in
// the SVG, so one card can appear many times on a page.
//
//   cardHtml(id, {size, title, sub, locked, equipped})  markup for one card. size 's' 160 / 'm' 230 / 'l' 300 px wide,
//                                    or a number. title replaces the card's name (the killer card puts the player there).
//   cardsSheet(menu, {onClose, onChange, tab})   the full-screen picker (cards, then emblems); equips through Progress.
//   setRosterIdentity(roster) / identityOf(id)   who carries which card and emblem and who is a Veteran.
//   vetOf(entry)  Veteran rule for a roster or lobby entry ({badge, loadout:{pro}}).
//   vetTag(vet, {short, level, emblem})  the chip; `emblem` (an id) puts the player's emblem in front of it.
//   nameMark(idOrEntry, {size})  just the emblem for a roster id or a lobby entry ('' when none).
// Lookups and unlocked state (Progress-backed): getCard(id), getSkin(id), skinsFor(op), getEmblem(id),
//   careerNow(), cardUnlocked(id), skinStatus(op) -> [{skin, unlocked, requirement, value, goal, equipped}],
//   currentSkin(op), equipSkin(op, id), emblems() -> [{emblem, unlocked, requirement, equipped}], currentEmblem(),
//   setEmblem(id).
import { CARDS, CARD_GROUPS, getCard, isVeteran, badgeSvg } from '../shared/progression.js';
import { WEAPON_IDS, WEAPON_CATEGORY, GOLDEN_ID } from '../shared/constants.js';
import { getCamo } from '../shared/camos.js';
import { TACTICALS, LETHALS, STREAKS } from '../shared/catalog.js';
import { icon } from './icons.js';
import { esc, swatchCss } from './widgets.js';
import { Progress } from './progress.js';
import { stagger, pop } from './motion.js';
import { setCareerExtras, careerExtras } from './cardbook.js';
import { getSkin, skinsFor, skinUnlock, baseSkin, isGrantSkin, localSkin, setLocalSkin, equippedEmblem, setEmblemChoice, OPERATORS } from './operators.js';
import { EMBLEMS, getEmblem, cleanEmblem, emblemUnlocked, emblemHtml } from './emblems.js';

export { getCard, getSkin, skinsFor, getEmblem };

/* ---------- Career, for every unlock rule here ---------- */
// What Progress's own card career lacks: kills per weapon category, mastered guns, which mastery camos are owned
// where, mastery grants and lifetime match counts. Progress.lifetime() is optional (see cardbook.js).
const CAT_SIZE = {};
for (const w of WEAPON_IDS) if (w !== GOLDEN_ID) CAT_SIZE[WEAPON_CATEGORY[w]] = (CAT_SIZE[WEAPON_CATEGORY[w]] ?? 0) + 1;
setCareerExtras(() => {
  const cats = {}, masteredIn = {}, camoOn = { gold: 0, prism: 0, molten: 0 }, masteredSet = new Set();
  const c = { kills: 0, head: 0, long: 0, slide: 0, clean: 0 };
  for (const w of WEAPON_IDS) {
    const st = Progress.weaponStats(w), cat = WEAPON_CATEGORY[w];
    for (const k in c) c[k] += st[k] ?? 0;
    cats[cat] = (cats[cat] ?? 0) + (st.kills ?? 0);
    if (Progress.isMastered(w)) { masteredSet.add(w); masteredIn[cat] = (masteredIn[cat] ?? 0) + 1; }
    for (const k in camoOn) if (Progress.isUnlocked(w, k)) camoOn[k]++;
  }
  return {
    ...c, level: Progress.prestige > 0 ? 50 : Progress.level, prestige: Progress.prestige, pro: Progress.proPerks(),
    cats, masteredIn, masteredSet, mastered: masteredSet.size, catSize: CAT_SIZE, camoOn,
    chal: w => { const l = Progress.challenges(w); return [l.filter(c => c.done).length, l.length]; },
    life: Progress.lifetime?.() ?? {}, granted: id => !!Progress.hasReward?.(id),
  };
});
export const careerNow = () => careerExtras();
export const cardUnlocked = id => !!Progress.cards().find(x => x.card.id === id)?.unlocked;

/* ---------- Skins ---------- */
// Mastery skins go through Progress (operatorSkin / setOperatorSkin, and Progress.loadout() carries them to the
// roster). Field skins are earned from the career; Progress does not store them yet, so they are kept locally.
export function currentSkin(op) {
  const granted = Progress.operatorSkin?.(op);
  if (granted && getSkin(granted)?.operator === op) return getSkin(granted).id;
  const local = getSkin(localSkin(op));
  if (local && skinUnlock(local, careerNow()).unlocked) return local.id;
  return baseSkin(op);
}
export function skinStatus(op) {
  const c = careerNow(), on = currentSkin(op);
  return skinsFor(op).map(skin => ({ skin, ...skinUnlock(skin, c), equipped: skin.id === on }));
}
export function equipSkin(op, id) {
  const skin = getSkin(id);
  if (!skin || skin.operator !== op || !skinUnlock(skin, careerNow()).unlocked) return false;
  // The save holds every earned skin now (field skins included), so it is the one place a choice is written.
  const ok = Progress.setOperatorSkin?.(op, skin.tier === 'base' ? null : skin.id) ?? false;
  if (ok) setLocalSkin(op, null);
  else if (!isGrantSkin(skin) && skin.tier !== 'base') return setLocalSkin(op, skin.id);   // Older save code: keep it locally.
  return ok;
}

/* ---------- Emblems ---------- */
export function emblems() {
  const c = careerNow(), on = currentEmblem();
  return EMBLEMS.map(emblem => ({ emblem, ...emblemUnlocked(emblem, c), equipped: emblem.id === on }));
}
export function currentEmblem() {
  const e = getEmblem(equippedEmblem());
  return e && emblemUnlocked(e, careerNow()).unlocked ? e.id : null;
}
export function setEmblem(id) {
  if (id === null) return setEmblemChoice(null);
  const e = getEmblem(id);
  if (!e || !emblemUnlocked(e, careerNow()).unlocked) return false;
  return setEmblemChoice(id);
}

/* ---------- Identity ---------- */
const roster = new Map();        // Player id -> {card, vet, emblem}

export function vetOf(entry) {
  const b = entry?.badge ?? {};
  return isVeteran({ prestige: b.prestige ?? 0, level: b.level ?? 1, pro: entry?.loadout?.pro ?? [] });
}

// Bots wear an emblem about half the time, picked from their id so every client shows the same one.
function botEmblem(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h >>>= 0;
  return h % 2 ? EMBLEMS[(h >>> 3) % EMBLEMS.length].id : null;
}
const emblemOfEntry = r => (r?.isBot ? botEmblem(r.id) : cleanEmblem(r?.loadout?.emblem ?? r?.emblem));

// Called by the HUD as each match is prepared; results read the same map after the match.
export function setRosterIdentity(list = []) {
  roster.clear();
  for (const r of list) roster.set(r.id, { card: r.loadout?.card ?? r.card ?? null, vet: vetOf(r), emblem: emblemOfEntry(r) });
}

export const identityOf = id => roster.get(id) ?? null;

// The emblem alone, for a roster id (string) or a lobby/roster entry (object).
export const nameMark = (who, { size = 14 } = {}) => emblemHtml(typeof who === 'string' ? identityOf(who)?.emblem : emblemOfEntry(who), { size });

// `level` folds the player's level into the chip ("Vet 34"), where a row has no room for both.
export function vetTag(vet, { short = false, level = null, emblem = null } = {}) {
  const word = vet ? (short ? 'Vet' : 'Veteran') : (short ? 'Rct' : 'Recruit');
  const lv = level != null ? ` <u>${Number(level) || 1}</u>` : '';
  const em = emblem ? emblemHtml(emblem, { size: short ? 13 : 16 }) : '';
  return `${em}<i class="vet-tag${vet ? ' vet' : ''}${short ? ' short' : ''}" title="${vet ? 'Veteran' : 'Recruit'}">${vet ? VET_CHEVRON : ''}${word}${lv}</i>`;
}
const VET_CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true"><polygon points="0,4 5,0 10,4 10,7 5,3 0,7" fill="currentColor"/><polygon points="0,8 5,4.5 10,8 10,10 5,6.5 0,10" fill="currentColor" opacity=".6"/></svg>';

/* ---------- Drawing ---------- */
const W = 300, H = 80;           // Design box of every card; CSS scales it.
const SIZES = { s: 160, m: 230, l: 300 };

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

  /* ---- Maps ---- */
  signals(c, r) {          // Railyard: lamp masts against the dusk, one lit.
    let s = line(90, 70, W, 70, c[1], 3);
    for (let i = 0; i < 6; i++) {
      const x = 112 + i * 32 + r() * 6, h = 30 + r() * 26;
      s += line(x, 70, x, 70 - h, c[1], 3) + poly([[x - 6, 70 - h - 14], [x + 6, 70 - h - 14], [x + 6, 70 - h], [x - 6, 70 - h]], c[1]);
      s += circ(x, 70 - h - 9, 3, i === 3 ? c[3] : i % 2 ? '#3fdc6a' : c[2], i === 3 ? '' : ' opacity=".5"');
    }
    return s + circ(214, 22, 26, c[3], ' opacity=".08"');
  },
  cranes(c, r) {           // Harbor: gantry cranes over a waterline.
    let s = '';
    for (let k = 0; k < 3; k++) {
      const x = 120 + k * 60 + r() * 10, top = 10 + r() * 10;
      s += line(x, 62, x, top, c[1], 3) + line(x + 16, 62, x + 16, top, c[1], 3) + line(x - 24, top, x + 52, top, c[1], 3);
      for (let y = top + 8; y < 60; y += 10) s += line(x, y, x + 16, y + 8, c[1], 1);
      s += line(x + 44, top, x + 44, top + 14 + r() * 10, c[2], 1) + poly([[x + 40, top + 24], [x + 48, top + 24], [x + 48, top + 30], [x + 40, top + 30]], c[3]);
    }
    for (let y = 64; y < H; y += 4) s += line(90, y, W, y, y % 8 ? c[1] : c[2], 1, ' opacity=".5" stroke-dasharray="9 5"');
    return s;
  },
  neon(c, r) {             // Night Market: tube signs, a glow pass under a hard core.
    let s = '';
    const tube = (d, col) => path(d, col, 6, ' opacity=".28" stroke-linecap="round"') + path(d, col, 1.8, ' stroke-linecap="round"');
    s += tube('M120 18 h34 v18 h-34 z', c[3]) + tube('M170 52 q16 -26 32 0 t32 0', c[2]);
    s += tube('M246 14 l16 22 l16 -22', '#18e8ff') + tube('M132 60 h24', c[3]);
    for (let i = 0; i < 18; i++) s += circ(100 + r() * 200, r() * H, 0.9, c[2], ' opacity=".6"');
    return s;
  },
  dunes(c, r) {            // Dust: layered dunes under a big low sun.
    let s = circ(240, 30, 18, c[3], ' opacity=".55"') + circ(240, 30, 28, c[3], ' opacity=".12"');
    for (let k = 0; k < 4; k++) {
      const y0 = 40 + k * 11, ph = r() * 6;
      let d = `M90 ${H} L90 ${y0}`;
      for (let x = 90; x <= W; x += 10) d += ` L${x} ${f1(y0 + Math.sin(x / (26 + k * 6) + ph) * (5 + k))}`;
      s += `<path d="${d} L${W} ${H} Z" fill="${k % 2 ? c[1] : c[0]}" opacity="${(0.55 + k * 0.12).toFixed(2)}"/>`;
    }
    return s;
  },
  shards(c, r) {           // Frostline: ice shards breaking upward.
    let s = '';
    for (let i = 0; i < 12; i++) {
      const x = 100 + r() * 196, h = 16 + r() * 50, w = 5 + r() * 9;
      s += poly([[x - w, H], [x + (r() - 0.5) * 6, H - h], [x + w, H]], i % 4 ? c[1] : c[2], ` opacity="${(0.5 + r() * 0.4).toFixed(2)}"`);
    }
    return s + line(96, 8, W, 22, c[3], 1, ' opacity=".6"');
  },
  skyline(c, r) {          // Topside: roofs, water tanks and aerials.
    let s = '', x = 92;
    while (x < W) {
      const w = 16 + r() * 22, h = 18 + r() * 40;
      s += poly([[x, H], [x, H - h], [x + w, H - h], [x + w, H]], c[1]);
      if (r() < 0.4) s += line(x + w / 2, H - h, x + w / 2, H - h - 12, c[2], 1) + circ(x + w / 2, H - h - 12, 1.6, c[3]);
      if (r() < 0.3) s += poly([[x + 3, H - h], [x + 3, H - h - 8], [x + 11, H - h - 8], [x + 11, H - h]], c[2], ' opacity=".55"');
      for (let wy = H - h + 6; wy < H - 4; wy += 7) if (r() < 0.35) s += poly([[x + 4, wy], [x + 7, wy], [x + 7, wy + 3], [x + 4, wy + 3]], c[3], ' opacity=".8"');
      x += w + 2;
    }
    return s;
  },
  reeds(c, r) {            // Sunken: reeds and rising bubbles in green water.
    let s = '';
    for (let i = 0; i < 26; i++) {
      const x = 96 + r() * 204, h = 20 + r() * 50, bend = (r() - 0.5) * 16;
      s += path(`M${f1(x)} ${H} Q${f1(x + bend * 0.3)} ${f1(H - h / 2)} ${f1(x + bend)} ${f1(H - h)}`, i % 5 ? c[1] : c[3], 1.6, ' opacity=".8"');
    }
    for (let i = 0; i < 10; i++) s += circ(110 + r() * 180, r() * 60, 1.5 + r() * 2.5, 'none', ` stroke="${c[2]}" stroke-width="1" opacity=".6"`);
    return s;
  },
  wheat(c, r) {            // Harvest: a silo and stalks bowing in wind.
    let s = poly([[250, H], [250, 18], [262, 8], [274, 18], [274, H]], c[1]) + line(250, 30, 274, 30, c[2], 1, ' opacity=".5"');
    for (let i = 0; i < 30; i++) {
      const x = 96 + r() * 150, h = 26 + r() * 30, t = H - h, lean = 6 + r() * 6;
      s += line(x, H, x + lean, t, c[1], 1.2);
      for (let k = 0; k < 4; k++) s += `<ellipse cx="${f1(x + lean - k * 1.2)}" cy="${f1(t + k * 4)}" rx="1.8" ry="3" fill="${c[3]}" opacity=".85"/>`;
    }
    return s;
  },
  /* ---- Modes ---- */
  tally(c, r) {            // TDM: tally marks scratched in groups of five.
    let s = '';
    for (let g = 0; g < 6; g++) {
      const x = 104 + g * 32, y = 14 + (g % 2) * 26;
      for (let k = 0; k < 4; k++) s += line(x + k * 5, y, x + k * 5 + (r() - 0.5) * 2, y + 22, c[g === 4 ? 3 : 1], 2.4, ' stroke-linecap="round"');
      s += line(x - 3, y + 18, x + 20, y + 4, c[g === 4 ? 3 : 2], 2.4, ' stroke-linecap="round"');
    }
    return s;
  },
  tags(c, r) {             // Kill Confirmed: dog tags on a bead chain.
    let s = path('M96 10 Q190 52 300 14', c[2], 1, ' stroke-dasharray="1.5 2.5"');
    for (let i = 0; i < 5; i++) {
      const x = 120 + i * 36 + r() * 6, y = 24 + r() * 26, a = (r() - 0.5) * 40;
      s += `<g transform="rotate(${f1(a)} ${f1(x)} ${f1(y)})">` + poly([[x - 8, y - 12], [x + 8, y - 12], [x + 10, y - 9], [x + 10, y + 9], [x + 8, y + 12], [x - 8, y + 12], [x - 10, y + 9], [x - 10, y - 9]], i === 2 ? c[3] : c[1])
        + circ(x, y - 8, 1.4, c[0]) + line(x - 5, y, x + 5, y, c[2], 1, ' opacity=".6"') + line(x - 5, y + 4, x + 2, y + 4, c[2], 1, ' opacity=".6"') + '</g>';
    }
    return s;
  },
  radar(c) {               // Domination: a sweep with three flag blips.
    let s = '';
    for (let k = 1; k <= 4; k++) s += circ(240, 40, k * 14, 'none', ` stroke="${c[1]}" stroke-width="1"`);
    s += poly([[240, 40], [296, 6], [300, 30]], c[3], ' opacity=".35"') + line(240, 40, 296, 6, c[3], 1.5);
    return s + [[214, 28], [262, 58], [282, 22]].map(([x, y], i) => circ(x, y, 3, i === 2 ? c[3] : c[2])).join('');
  },
  zones(c) {               // Hardpoint: nested zone squares, the live one lit.
    let s = '';
    for (let k = 0; k < 5; k++) { const h = 8 + k * 8; s += poly([[240 - h, 40 - h], [240 + h, 40 - h], [240 + h, 40 + h], [240 - h, 40 + h]], 'none', ` stroke="${k === 1 ? c[3] : c[1]}" stroke-width="${k === 1 ? 2.4 : 1.2}"`); }
    for (let i = 0; i < 4; i++) s += poly([[110 + i * 26, 60], [126 + i * 26, 60], [126 + i * 26, 72], [110 + i * 26, 72]], 'none', ` stroke="${c[1]}" stroke-width="1" stroke-dasharray="3 2"`);
    return s;
  },
  grid(c, r) {             // Free-for-All: everyone a blip on a grid.
    let s = '';
    for (let x = 100; x <= W; x += 16) s += line(x, 0, x, H, c[1], 1, ' opacity=".5"');
    for (let y = 8; y < H; y += 16) s += line(96, y, W, y, c[1], 1, ' opacity=".5"');
    for (let i = 0; i < 9; i++) { const x = 104 + Math.floor(r() * 12) * 16, y = 8 + Math.floor(r() * 5) * 16; s += circ(x, y, i === 0 ? 4 : 2.4, i === 0 ? c[3] : c[2]); }
    return s;
  },
  ladder(c) {              // Gun Game: a rising ladder of rungs.
    let s = '';
    for (let i = 0; i < 12; i++) { const x = 100 + i * 17, h = 6 + i * 5.5; s += poly([[x, H - h], [x + 13, H - h], [x + 13, H], [x, H]], i === 11 ? c[3] : c[1], ` opacity="${(0.4 + i * 0.05).toFixed(2)}"`); }
    return s;
  },
  fuse(c, r) {             // S&D plant: a lit fuse burning to a charge.
    let d = 'M96 60', x = 96, y = 60;
    while (x < 236) { x += 12; y = 40 + r() * 30; d += ` Q${f1(x - 6)} ${f1(y + (r() - 0.5) * 30)} ${f1(x)} ${f1(y)}`; }
    let s = path(d, c[1], 2.4) + poly([[244, 26], [292, 26], [292, 66], [244, 66]], c[1]) + poly([[250, 34], [286, 34], [286, 46], [250, 46]], c[0]);
    for (let i = 0; i < 4; i++) s += poly([[254 + i * 8, 37], [259 + i * 8, 37], [259 + i * 8, 43], [254 + i * 8, 43]], c[3], i === 1 ? ' opacity=".35"' : '');
    return s + circ(x, y, 4, c[3]) + circ(x, y, 9, c[3], ' opacity=".25"');
  },
  wires(c) {               // S&D defuse: three wires, one cut.
    const cols = [c[3], c[2], '#ff4d3d'];
    let s = '';
    cols.forEach((col, i) => {
      const y = 18 + i * 20;
      s += i === 1 ? path(`M96 ${y} C150 ${y - 12} 180 ${y + 12} 206 ${y}`, col, 3) + path(`M220 ${y + 4} C250 ${y - 8} 270 ${y + 10} 300 ${y}`, col, 3)
        : path(`M96 ${y} C160 ${y + 14} 220 ${y - 14} 300 ${y}`, col, 3);
    });
    return s + poly([[206, 34], [214, 30], [222, 46], [214, 50]], c[2]);
  },
  spot(c) {                // S&D clutch: one figure in a spotlight.
    return poly([[230, 0], [252, 0], [300, H], [182, H]], c[2], ' opacity=".12"') + `<ellipse cx="241" cy="72" rx="34" ry="6" fill="${c[3]}" opacity=".35"/>`
      + poly([[236, 40], [246, 40], [248, 70], [234, 70]], c[1]) + circ(241, 34, 5, c[1]);
  },
  pennants(c, r) {         // CTF: a pennant line, two of them in play.
    let s = path('M90 8 Q195 40 300 10', c[2], 1);
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.5) / 9, x = 90 + t * 210, y = 8 + Math.sin(t * Math.PI) * 24 - t * 2;
      s += poly([[x - 7, y], [x + 7, y], [x, y + 16]], i === 3 || i === 6 ? c[3] : c[1], i === 3 || i === 6 ? '' : ' opacity=".7"');
    }
    return s + line(250, 80, 250, 34, c[2], 2) + poly([[250, 34], [280, 42], [250, 50]], c[3]);
  },
  /* ---- Arms ---- */
  brass(c) {               // Assault: a row of rounds standing in line.
    let s = '';
    for (let i = 0; i < 12; i++) { const x = 100 + i * 17; s += poly([[x, H - 6], [x, 30], [x + 4, 22], [x + 8, 30], [x + 8, H - 6]], i % 4 === 3 ? c[3] : c[1]) + line(x, 34, x + 8, 34, c[2], 1, ' opacity=".5"'); }
    return s;
  },
  shells(c, r) {           // Shotgun: spent shells scattered.
    let s = '';
    for (let i = 0; i < 9; i++) {
      const x = 110 + r() * 180, y = 10 + r() * 60, a = r() * 180;
      s += `<g transform="rotate(${f1(a)} ${f1(x)} ${f1(y)})">` + poly([[x - 12, y - 4], [x + 6, y - 4], [x + 6, y + 4], [x - 12, y + 4]], i % 3 ? c[1] : c[3]) + poly([[x + 6, y - 4.5], [x + 11, y - 4.5], [x + 11, y + 4.5], [x + 6, y + 4.5]], c[2]) + '</g>';
    }
    return s;
  },
  scope(c) {               // Marksman: a ranging reticle with mil dots.
    let s = circ(240, 40, 34, 'none', ` stroke="${c[1]}" stroke-width="2"`) + line(180, 40, 300, 40, c[2], 1) + line(240, 0, 240, 80, c[2], 1);
    for (let k = -3; k <= 3; k++) if (k) s += circ(240 + k * 8, 40, 1.4, c[3]) + circ(240, 40 + k * 8, 1.4, c[3]);
    return s + poly([[236, 46], [244, 46], [240, 56]], c[3]);
  },
  blast(c, r) {            // Launcher and equipment: a burst with debris.
    let s = poly(Array.from({ length: 22 }, (_, i) => { const a = i / 22 * Math.PI * 2, k = i % 2 ? 18 : 34 + r() * 10; return [240 + Math.cos(a) * k, 40 + Math.sin(a) * k * 0.8]; }), c[3], ' opacity=".55"');
    s += circ(240, 40, 12, c[2], ' opacity=".8"');
    for (let i = 0; i < 10; i++) { const a = r() * Math.PI * 2, d = 44 + r() * 20; s += poly([[240 + Math.cos(a) * d, 40 + Math.sin(a) * d * 0.7], [243 + Math.cos(a) * d, 42 + Math.sin(a) * d * 0.7], [240 + Math.cos(a) * d, 45 + Math.sin(a) * d * 0.7]], c[1]); }
    return s;
  },
  /* ---- Career and mastery ---- */
  burst(c) {               // Multi-kills: three stacked impact stars.
    const st = (x, y, R, col, o) => poly(Array.from({ length: 16 }, (_, i) => { const a = i / 16 * Math.PI * 2, k = i % 2 ? R * 0.45 : R; return [x + Math.cos(a) * k, y + Math.sin(a) * k]; }), col, ` opacity="${o}"`);
    return st(200, 44, 22, c[1], 0.7) + st(236, 30, 26, c[2], 0.35) + st(272, 46, 30, c[3], 0.75);
  },
  link(c) {                // Assists: chain links.
    let s = '';
    for (let i = 0; i < 6; i++) { const x = 110 + i * 32; s += `<rect x="${x}" y="${i % 2 ? 30 : 26}" width="36" height="${i % 2 ? 20 : 28}" rx="10" fill="none" stroke="${i === 3 ? c[3] : c[1]}" stroke-width="4"/>`; }
    return s;
  },
  podium(c) {              // Top three: a podium with the middle step lit.
    return poly([[180, 50], [214, 50], [214, H], [180, H]], c[1]) + poly([[214, 30], [250, 30], [250, H], [214, H]], c[3], ' opacity=".85"') + poly([[250, 58], [284, 58], [284, H], [250, H]], c[1], ' opacity=".7"')
      + poly(Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? 4 : 9; return [232 + Math.cos(a) * k, 16 + Math.sin(a) * k]; }), c[2]);
  },
  facets(c, r) {           // Category mastery: cut-gem facets.
    let s = '';
    for (let i = 0; i < 14; i++) {
      const x = 96 + i * 15, y = r() * 30;
      s += poly([[x, 0], [x + 26, y], [x + 8, H]], i % 3 === 0 ? c[3] : i % 2 ? c[1] : c[2], ` opacity="${(0.15 + r() * 0.35).toFixed(2)}"`);
    }
    return s;
  },
};

const CUT = 10;
const HOUSE = `${CUT},0 ${W},0 ${W},${H - CUT} ${W - CUT},${H} 0,${H} 0,${CUT}`;
const ground = new Map();       // Card id -> SVG ground markup, drawn once.

// Restyles for cards whose data lives elsewhere: the mastery-track cards (progression.js, docs/PROGRESSION.md) get
// their kind's pattern and an animated tier, and the V7 mastery camo cards animate like their camo.
const MASTERY_STYLE = {
  tactical: { p: 'radar', c: ['#0e1a20', '#24505e', '#d6f6ff', '#7ae8ff'], anim: 'gold' },
  lethal: { p: 'blast', c: ['#1e0e08', '#6a2a10', '#ffd8b0', '#ff6a1a'], anim: 'molten' },
  streak: { p: 'arc', c: ['#12142a', '#33387a', '#e0e2ff', '#ffcf40'], anim: 'gold' },
  operator: { p: 'facets', c: ['#140a22', '#4a2a8e', '#e8dcff', '#ff2bd6'], anim: 'prism' },
};
const LEGACY_ANIM = { 'camo-gold': 'gold', 'camo-molten': 'molten', 'camo-prism': 'prism', 'pro-all': 'gold', 'kills-1000': 'molten', 'prestige-10': 'gold' };
const OPERATOR_SET = new Set(OPERATORS.map(o => o.id));
const arts = new Map();
function artOf(card) {
  let a = arts.get(card.id);
  if (a) return a;
  a = card.art;
  const m = /^mastery-(\D.*)$/.exec(card.id);
  const kind = m && (TACTICALS[m[1]] ? 'tactical' : LETHALS[m[1]] ? 'lethal' : STREAKS[m[1]] ? 'streak' : OPERATOR_SET.has(m[1]) ? 'operator' : null);
  if (kind) a = { ...a, ...MASTERY_STYLE[kind], e: kind === 'operator' ? 'ui:operator' : a.e, gold: true };
  if (LEGACY_ANIM[card.id]) a = { ...a, anim: LEGACY_ANIM[card.id] };
  arts.set(card.id, a);
  return a;
}

function groundSvg(card) {
  let s = ground.get(card.id);
  if (s) return s;
  const { p, c, gold } = artOf(card);
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
  const art = artOf(card), e = art.e, [, , light, accent] = art.c;
  if (e.startsWith('badge:')) return badgeSvg(Number(e.slice(6)), px);
  if (e.startsWith('camo:')) return `<i class="cc-swatch" style="background:${swatchCss(getCamo(e.slice(5)))}"></i>`;
  return icon(e, { size: Math.round(px * 0.78), color: light, accent });
}

// Markup for one card. Sizes are px widths; everything inside scales with --cw.
export function cardHtml(id, { size = 'm', title, sub, locked = false, equipped = false, cls = '' } = {}) {
  const card = getCard(id), art = artOf(card);
  const w = typeof size === 'number' ? size : SIZES[size] ?? SIZES.m;
  const name = title ?? card.name;
  const line2 = sub ?? card.group;
  const anim = art.anim && !locked ? ` a-${art.anim}` : '';
  // A long name steps the title down a size rather than lose its end.
  const long = name.length > 18 ? ' long' : name.length > 14 ? ' longish' : '';
  return `<span class="ccard${long}${art.gold ? ' gold' : ''}${anim}${locked ? ' locked' : ''}${equipped ? ' equipped' : ''}${cls ? ' ' + cls : ''}" style="--cw:${w}px" data-card="${esc(card.id)}">
    ${groundSvg(card)}${anim ? '<i class="cc-fx" aria-hidden="true"></i>' : ''}
    <span class="cc-em">${emblem(card, Math.round(w * 0.2))}</span>
    <span class="cc-tx"><b>${esc(name)}</b>${line2 ? `<small>${esc(line2)}</small>` : ''}</span>
    ${locked ? `<span class="cc-lock">${icon('ui:lock', { size: Math.max(12, Math.round(w * 0.06)) })}</span>` : ''}
    ${equipped ? `<span class="cc-on">${icon('ui:check', { size: Math.max(10, Math.round(w * 0.05)), accent: 'currentColor' })}</span>` : ''}
  </span>`;
}

// The bar under a card still being earned, like every other progress bar in the game: sodium fill and value/goal.
const fmtN = v => v.toLocaleString('en-US');
export function cardProgressHtml({ value, goal }) {
  const f = Math.max(0, Math.min(1, value / goal));
  return `<span class="cc-prog"><i class="cc-bar"><i style="transform:scaleX(${f.toFixed(3)})"></i></i><small>${fmtN(value)}/${fmtN(goal)}</small></span>`;
}

// Locked cards nearest to done, for the results screen: [{card, progress}], the closest first.
export function cardsInReach(max = 3) {
  return Progress.cards().filter(x => x.progress && x.progress.value > 0)
    .sort((a, b) => b.progress.value / b.progress.goal - a.progress.value / a.progress.goal).slice(0, max);
}

/* ---------- Picker ---------- */
// Full-screen sheet over whatever screen opened it, with two views: calling cards by group, then emblems. Tap an
// earned item to equip it; a locked one says what earns it.
export function cardsSheet(menu, { onClose, onChange, tab = 'cards' } = {}) {
  let group = 'All', view = tab;
  const head = (title, count, now) => `
    <div class="cs-head">
      <div class="cs-title"><b>${title}</b><small>${count}</small></div>
      <nav class="cs-views"><button class="cs-tab${view === 'cards' ? ' on' : ''}" data-act="csView" data-v="cards" data-sound="tab"><b>Cards</b></button><button class="cs-tab${view === 'emblems' ? ' on' : ''}" data-act="csView" data-v="emblems" data-sound="tab"><b>Emblems</b></button></nav>
      <div class="cs-now">${now}</div>
      <button class="btn is-primary cs-done" data-act="csDone" data-sound="confirm">${icon('ui:check', { size: 18, accent: 'currentColor' })}<b>Done</b></button>
    </div>`;
  const renderCards = () => {
    const list = Progress.cards();
    const shown = group === 'All' ? list : list.filter(x => x.card.group === group);
    const have = list.filter(x => x.unlocked).length;
    const on = list.find(x => x.equipped)?.card ?? CARDS[0];
    return `${head('Calling cards', `${have} of ${list.length} earned`, cardHtml(on.id, { size: 's', sub: 'Equipped' }))}
        <nav class="cs-tabs scroll-x">${['All', ...CARD_GROUPS].map(g => {
          const n = g === 'All' ? have : list.filter(x => x.card.group === g && x.unlocked).length;
          const of = g === 'All' ? list.length : list.filter(x => x.card.group === g).length;
          return of ? `<button class="cs-tab${g === group ? ' on' : ''}" data-act="csGroup" data-g="${g}" data-sound="tab"><b>${g}</b><small>${n}/${of}</small></button>` : '';
        }).join('')}</nav>
        <div class="cs-grid scroll-y">${shown.map(x => `
          <button class="cs-cell${x.unlocked ? '' : ' locked'}${x.equipped ? ' on' : ''}" data-act="csPick" data-id="${x.card.id}" ${x.unlocked ? '' : 'data-sound="deny"'}>
            ${cardHtml(x.card.id, { size: 228, locked: !x.unlocked, equipped: x.equipped, sub: x.card.req })}${x.progress ? cardProgressHtml(x.progress) : ''}
          </button>`).join('')}</div>`;
  };
  const renderEmblems = () => {
    const list = emblems(), on = list.find(x => x.equipped);
    const have = list.filter(x => x.unlocked).length;
    const now = `<span class="es-now">${on ? emblemHtml(on.emblem.id, { size: 26 }) : '<i class="emb emb-none"></i>'}<b>${esc(Progress.name || 'Rookie')}</b></span>`;
    return `${head('Emblems', `${have} of ${list.length} earned`, now)}
        <div class="es-grid scroll-y">
          <button class="es-cell${on ? '' : ' on'}" data-act="esPick" data-id=""><i class="emb emb-none"></i><b>None</b><small>Name only</small></button>
          ${list.map(x => `
          <button class="es-cell${x.unlocked ? '' : ' locked'}${x.equipped ? ' on' : ''}" data-act="esPick" data-id="${x.emblem.id}" ${x.unlocked ? '' : 'data-sound="deny"'}>
            ${emblemHtml(x.emblem.id, { size: 40 })}<b>${esc(x.emblem.name)}</b><small>${esc(x.requirement)}</small>${x.unlocked ? '' : `<span class="es-lock">${icon('ui:lock', { size: 12 })}</span>`}
          </button>`).join('')}
        </div>`;
  };
  const render = () => {
    menu.overlay(`<div class="cards-sheet">${view === 'cards' ? renderCards() : renderEmblems()}</div>`);
    stagger(menu.overlayEl.querySelectorAll(view === 'cards' ? '.cs-cell' : '.es-cell'), 'up', { step: 18, max: 14 });
  };
  menu.on({
    csDone: () => { menu.overlay(''); onClose?.(); },
    csView: ({ v }) => { if (v !== view) { view = v; render(); } },
    csGroup: ({ g }) => { group = g; render(); },
    csPick: ({ id }) => {
      const card = getCard(id);
      if (!Progress.setCard(id)) { menu.toast(`${card.name}: ${card.req}`); return; }
      onChange?.(id);
      render();
      pop(menu.overlayEl.querySelector('.cs-now .ccard'));
    },
    esPick: ({ id }) => {
      const e = getEmblem(id);
      if (!setEmblem(e ? e.id : null)) { menu.toast(`${e.name}: ${emblemUnlocked(e, careerNow()).requirement}`); return; }
      onChange?.(id);
      render();
      pop(menu.overlayEl.querySelector('.es-now'));
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
      <small>Equip it from your service record</small>
    </div>`;
  }
  return null;
}
