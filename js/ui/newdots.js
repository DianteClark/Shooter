// "New" dots (QoL): an unlock this phone has not looked at yet wears a small sodium dot, on the item and on every menu
// button that leads to it; seeing the item clears it. Nothing here names a reward: the providers below list what is
// unlocked of each kind straight from Progress (cards, emblems, camos, operators, skins, finishers, emotes,
// attachments, perks, ...), so an item added to any of those lists gets a dot the day it unlocks.
//
// Storage ('switchyard-seen' in localStorage, never the save code): the unlocks already known, each as a 5-character
// hash of its key, in one string. The first scan on a phone takes everything already unlocked as seen, so only what
// unlocks from then on is new. A key is `kind:id`, or `kind:weapon:id` for what belongs to one gun.
//
//   NewDots.install(menu)     decorate menu screens as they render (a MutationObserver, batched to a frame)
//   NewDots.refresh()         rescan after something may have unlocked (results, prestige, a season claim)
//   NewDots.fresh()           the Set of new keys (tests and the gallery)
import { Progress } from './progress.js';
import { ITEM_TABLES } from '../shared/progression.js';
import { WEAPON_IDS } from '../shared/constants.js';
import { ATTACHMENTS } from '../shared/attachments.js';
import { emblems } from './cards.js';
import { getSkin, OPERATOR_IDS } from './operators.js';
import { CATEGORIES, categoryOf, slotOf } from './armory.js';

const KEY = 'switchyard-seen';
const GUN_KINDS = ['attachment', 'camo', 'tracer', 'killFx'];

// ---- What is unlocked now, as keys -------------------------------------------------------------------------------
const PROVIDERS = [
  () => Object.keys(ITEM_TABLES).flatMap(kind => Object.keys(ITEM_TABLES[kind]).filter(id => Progress.isItemUnlocked(kind, id)).map(id => `${kind}:${id}`)),
  () => WEAPON_IDS.filter(w => Progress.isItemUnlocked('weapon', w)).flatMap(w => [
    ...Progress.attachments(w).filter(a => a.unlocked).map(a => `attachment:${w}:${a.id}`),
    ...Progress.camos(w).filter(c => c.unlocked && c.camo.id !== 'none').map(c => `camo:${w}:${c.camo.id}`),
    ...Progress.tracers(w).filter(c => c.unlocked && c.item.id !== 'none').map(c => `tracer:${w}:${c.item.id}`),
    ...Progress.killEffects(w).filter(c => c.unlocked && c.item.id !== 'none').map(c => `killFx:${w}:${c.item.id}`),
  ]),
  () => Progress.cards().filter(c => c.unlocked).map(c => `card:${c.card.id}`),
  () => emblems().filter(e => e.unlocked).map(e => `emblem:${e.emblem.id}`),
  () => Progress.operators().filter(o => o.unlocked).map(o => `operator:${o.op.id}`),
  () => OPERATOR_IDS.flatMap(op => Progress.skins(op).filter(k => k.unlocked).map(k => `skin:${k.id}`)),
  () => Progress.finishers().filter(f => f.unlocked).map(f => `finisher:${f.id}`),
  () => Progress.emotes().filter(e => e.unlocked).map(e => `emote:${e.id}`),
];

function hash(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 60466176).toString(36).padStart(5, '0');     // 36^5: five characters.
}

function unlockedNow() {
  const out = [];
  for (const p of PROVIDERS) { try { out.push(...p()); } catch (err) { console.error('new dots', err); } }
  return out;
}

let known = null;          // Set of hashes.
let fresh = new Set();     // Keys unlocked and not yet seen.
let dirty = true;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const set = new Set();
    for (let i = 0; i + 5 <= raw.length; i += 5) set.add(raw.slice(i, i + 5));
    return set;
  } catch { return null; }
}
function store() {
  try { localStorage.setItem(KEY, [...known].join('')); } catch { /* private mode: dots come back next visit */ }
}

function scan() {
  dirty = false;
  const now = unlockedNow();
  if (!known) {
    known = load();
    if (!known) { known = new Set(now.map(hash)); store(); }     // First run: everything already unlocked is old news.
  }
  fresh = new Set(now.filter(k => !known.has(hash(k))));
}

function see(keys) {
  let changed = false;
  for (const k of keys) {
    if (!fresh.delete(k)) continue;
    known.add(hash(k));
    changed = true;
  }
  if (changed) store();
}

// ---- Where the dots go ---------------------------------------------------------------------------------------------
// Items: the element stands for one key; seeing it (most of it on screen) clears that key.
// Leads: the element leads to keys; it is dotted while any of them is new, and never clears anything itself.
const LOADOUT_KIND = { perks: 'perk', streaks: 'streak', tactical: 'tactical', lethal: 'lethal' };
const startsAny = (...prefixes) => k => prefixes.some(p => k.startsWith(p));
const ofGun = w => startsAny(...GUN_KINDS.map(kind => `${kind}:${w}:`));
const kindOf = k => k.slice(0, k.indexOf(':'));

function rules(menu) {
  const gun = () => menu.screen?.weapon ?? null;
  return [
    // Items.
    ['[data-act="gsCamo"][data-id]', el => gun() && `camo:${gun()}:${el.dataset.id}`],
    ['[data-act="gsAtt"][data-id]', el => gun() && `attachment:${gun()}:${el.dataset.id}`],
    ['[data-act="gsFx"][data-id]', el => gun() && `${el.dataset.kind}:${gun()}:${el.dataset.id}`],
    ['[data-act="loChoose"][data-id]', el => LOADOUT_KIND[el.dataset.key] && `${LOADOUT_KIND[el.dataset.key]}:${el.dataset.id}`],
    ['[data-act="opSkin"][data-id]', el => `skin:${el.dataset.id}`],
    ['[data-act="opFin"][data-id]', el => `finisher:${el.dataset.id}`],
    ['[data-act="csPick"][data-id]', el => `card:${el.dataset.id}`],
    ['[data-act="esPick"][data-id]', el => el.dataset.id && `emblem:${el.dataset.id}`],
    ['[data-act="titleEmotePlay"][data-i]', el => { const e = Progress.emotes()[Number(el.dataset.i)]; return e ? `emote:${e.id}` : null; }],
    // Items that also lead somewhere: a gun (and what is new on it), an operator (and its skins).
    ['[data-act="gsWeapon"][data-id], [data-act="arBrowse"][data-id]', el => `weapon:${el.dataset.id}`, el => ofGun(el.dataset.id)],
    ['[data-act="opPick"][data-id]', el => `operator:${el.dataset.id}`, el => k => k.startsWith('skin:') && getSkin(k.slice(5))?.operator === el.dataset.id],
  ];
}

function leads(menu) {
  const gun = () => menu.screen?.weapon ?? null;
  const gear = startsAny('weapon:', 'perk:', 'streak:', 'tactical:', 'lethal:', ...GUN_KINDS.map(k => `${k}:`));
  return [
    ['[data-act="loadout"]', () => gear],
    ['[data-act="gunsmith"], [data-act="loGunsmith"], [data-act="arGunsmith"]', () => startsAny('weapon:', ...GUN_KINDS.map(k => `${k}:`))],
    ['[data-act="operators"], [data-act="loOperators"]', () => startsAny('operator:', 'skin:', 'finisher:')],
    ['[data-act="profile"], [data-act="pfCards"]', () => startsAny('card:', 'emblem:')],
    ['[data-act="csView"][data-v]', el => startsAny(el.dataset.v === 'emblems' ? 'emblem:' : 'card:')],
    ['[data-act="titleEmote"]', () => startsAny('emote:')],
    ['[data-act="gsTab"][data-tab]', el => {
      const w = gun(), kinds = { attach: ['attachment'], camo: ['camo'], fx: ['tracer', 'killFx'] }[el.dataset.tab];
      return w && kinds ? startsAny(...kinds.map(k => `${k}:${w}:`)) : null;
    }],
    ['[data-act="gsSlot"][data-slot]', el => { const w = gun(); return w ? k => k.startsWith(`attachment:${w}:`) && ATTACHMENTS[k.split(':')[2]]?.slot === el.dataset.slot : null; }],
    ['[data-act="gsCat"][data-cat], [data-act="arCat"][data-cat]', el => k => {
      const kind = kindOf(k), w = kind === 'weapon' ? k.slice(7) : GUN_KINDS.includes(kind) ? k.split(':')[1] : null;
      return !!w && CATEGORIES.includes(el.dataset.cat) && categoryOf(w) === el.dataset.cat;
    }],
    ['[data-act="loSlot"][data-key]', el => LOADOUT_KIND[el.dataset.key] ? startsAny(`${LOADOUT_KIND[el.dataset.key]}:`) : null],
    ['[data-act="loWeapon"][data-key]', el => k => { const kind = kindOf(k), w = kind === 'weapon' ? k.slice(7) : GUN_KINDS.includes(kind) ? k.split(':')[1] : null; return !!w && slotOf(w) === el.dataset.key; }],
  ];
}

const CSS = `
.nd-dot { position: absolute; top: 3px; right: 3px; width: 8px; height: 8px; border-radius: 50%; background: var(--c-sodium, #ffc23d);
  box-shadow: 0 0 0 2px rgba(16,20,26,.85), 0 0 8px var(--c-sodium-glow, rgba(255,194,61,.6)); pointer-events: none; z-index: 2; }
`;

let observer = null, seenObserver = null, queued = false;

function decorate(menu) {
  queued = false;
  if (dirty) scan();
  for (const root of [menu.el, menu.overlayEl]) if (root) decorateRoot(menu, root);
}

function decorateRoot(menu, root) {
  // Clear dots on elements whose key is no longer new (seen elsewhere, or a repaint reused the element).
  for (const dot of root.querySelectorAll('.nd-dot')) {
    const host = dot.parentElement;
    if (host?.dataset.nd && !host.dataset.ndKeep) { dot.remove(); delete host.dataset.nd; }
  }
  const all = [...fresh];
  const put = (el, keep) => {
    if (el.querySelector(':scope > .nd-dot')) return;
    const dot = document.createElement('i');
    dot.className = 'nd-dot';
    dot.setAttribute('aria-hidden', 'true');
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';     // The dot's anchor.
    el.appendChild(dot);
    el.dataset.nd = '1';
    if (keep) el.dataset.ndKeep = '1';
  };
  for (const [sel, keyOf, alsoFn] of rules(menu)) {
    for (const el of root.querySelectorAll(sel)) {
      const key = keyOf(el);
      const also = alsoFn?.(el);
      const own = !!key && fresh.has(key);
      if (own) { el.dataset.ndKey = key; seenObserver?.observe(el); }
      if (own || (also && all.some(also))) put(el, own);
    }
  }
  for (const [sel, testFn] of leads(menu)) {
    for (const el of root.querySelectorAll(sel)) {
      const test = testFn(el);
      if (test && all.some(test)) put(el, false);
    }
  }
}

export const NewDots = {
  install(menu) {
    if (observer || typeof MutationObserver !== 'function') return;
    if (!document.getElementById('nd-style')) {
      const st = document.createElement('style');
      st.id = 'nd-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    if (typeof IntersectionObserver === 'function') {
      seenObserver = new IntersectionObserver(entries => {
        const keys = [];
        for (const e of entries) if (e.isIntersecting && e.target.dataset.ndKey) { keys.push(e.target.dataset.ndKey); seenObserver.unobserve(e.target); }
        if (keys.length) see(keys);
      }, { threshold: 0.6 });
    }
    observer = new MutationObserver(muts => {
      // The dots' own insertions change nothing else: only a repaint by the screen schedules a pass.
      if (muts.every(m => [...m.addedNodes, ...m.removedNodes].every(n => n.classList?.contains('nd-dot')))) return;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => decorate(menu));
    });
    observer.observe(menu.el, { childList: true, subtree: true });
    if (menu.overlayEl) observer.observe(menu.overlayEl, { childList: true, subtree: true });     // The cards sheet.
    decorate(menu);
  },
  refresh() { dirty = true; },
  fresh() { if (dirty) scan(); return new Set(fresh); },
  // Tests: forget a key as seen, so it shows as new on the next scan.
  forget(key) { if (dirty) scan(); known.delete(hash(key)); store(); dirty = true; },
};
