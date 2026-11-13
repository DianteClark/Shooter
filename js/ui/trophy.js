// The Trophy Case (the rewards pass, docs/UNLOCKS-AUDIT-2026-11-12.md): a profile screen, opened from the service
// record, with the rarest things this player has earned, their personal bests and how complete each collection is.
//   trophyTotals() -> { cats: [{id, name, have, of}], have, of }   (the service record's button shows the total)
//   trophyScreen(menu, { onBack })
// Every tile opens the unlock sheet (js/ui/unlocksheet.js): earned things say how they were earned, locked ones how to.
import { WEAPON_IDS, GOLDEN_ID } from '../shared/constants.js';
import { MODES } from '../shared/modes.js';
import { MAPS } from '../shared/map.js';
import { DIVISIONS } from '../shared/season-items.js';
import { rankName } from '../shared/progression.js';
import { getCamo } from '../shared/camos.js';
import { Progress } from './progress.js';
import { cardHtml, emblems, skinStatus } from './cards.js';
import { emblemSvg } from './emblems.js';
import { OPERATORS } from './operators.js';
import { esc, swatchCss } from './widgets.js';
import { ico, header } from './yard.js';
import { icon } from './icons.js';
import { stagger, pop } from './motion.js';
import { unlockSheet } from './unlocksheet.js';

const GUNS = WEAPON_IDS.filter(w => w !== GOLDEN_ID);
const shown = x => !x.season || x.unlocked;           // A season's item counts once earned, or while it is on offer.

function collections() {
  const cards = Progress.cards().filter(x => shown({ season: x.card.season, unlocked: x.unlocked }));
  const camos = GUNS.flatMap(w => Progress.camos(w).filter(x => x.camo.id !== 'none' && shown({ season: x.camo.season, unlocked: x.unlocked })).map(x => ({ ...x, w })));
  const embl = emblems();
  const ops = Progress.operators();
  const skins = OPERATORS.flatMap(o => skinStatus(o.id).filter(s => s.skin.tier !== 'base' && shown({ season: s.skin.season, unlocked: s.unlocked })));
  const fins = [...Progress.finishers(), ...Progress.emotes()];
  return { cards, camos, embl, ops, skins, fins };
}

export function trophyTotals(c = collections()) {
  const n = list => list.filter(x => x.unlocked).length;
  const cats = [
    { id: 'cards', name: 'Calling cards', icon: 'ui:camo', have: n(c.cards), of: c.cards.length },
    { id: 'camos', name: 'Camos', icon: 'camo', have: n(c.camos), of: c.camos.length },
    { id: 'emblems', name: 'Emblems', icon: 'ui:star', have: n(c.embl), of: c.embl.length },
    { id: 'operators', name: 'Operators and skins', icon: 'ui:operator', have: n(c.ops) + n(c.skins), of: c.ops.length + c.skins.length },
    { id: 'finishers', name: 'Finishers and emotes', icon: 'ui:skull', have: n(c.fins), of: c.fins.length },
  ];
  const have = cats.reduce((a, x) => a + x.have, 0), of = cats.reduce((a, x) => a + x.of, 0);
  return { cats, have, of };
}

// How rare an earned thing is, roughly how long it takes: animated master cards, feat emblems, the top mastery camos,
// Specialist skins. Ties go to the order below.
const CAMO_RARITY = { prism: 9, molten: 8, gold: 7, horizon: 6, aurora: 5 };
function rarest(c, max = 8) {
  const out = [];
  for (const x of c.cards) if (x.unlocked && x.card.id !== 'yard') {
    const a = x.card.art ?? {};
    const score = (a.anim ? 6 : a.gold ? 4 : 1) + (a.tier === 3 ? 2 : a.tier === 2 ? 1 : 0) + (x.card.group === 'Ranked' ? 2 : 0);
    out.push({ kind: 'card', id: x.card.id, name: x.card.name, score, art: cardHtml(x.card.id, { size: 150, sub: '' }) });
  }
  for (const x of c.embl) if (x.unlocked && !x.emblem.rule?.starter) {
    const score = x.emblem.feat ? 8 : x.emblem.rule?.master || x.emblem.rule?.prestige >= 6 ? 7 : x.emblem.season ? 5 : 3;
    out.push({ kind: 'emblem', id: x.emblem.id, name: x.emblem.name, score, art: emblemSvg(x.emblem.id, 46) });
  }
  const bestCamo = new Map();
  for (const x of c.camos) if (x.unlocked && CAMO_RARITY[x.camo.id] && !bestCamo.has(x.camo.id)) bestCamo.set(x.camo.id, x);
  for (const [id, x] of bestCamo) out.push({ kind: 'camo', id, weapon: x.w, name: getCamo(id).name, score: CAMO_RARITY[id], art: `<i class="tc-sw" style="background:${swatchCss(getCamo(id))}"></i>` });
  for (const s of c.skins) if (s.unlocked && (s.skin.tier === 5 || s.skin.tier === 4)) out.push({ kind: 'skin', id: s.skin.id, name: s.skin.name, score: s.skin.tier === 5 ? 6 : 4, art: icon('ui:operator', { size: 40 }) });
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function records() {
  const r = Progress.records();
  const master = Progress.master, rank = master > 0 ? `Master ${master}` : rankName(Progress.prestige, 0);
  return [
    ['Best kill streak', r.streak ? String(r.streak) : '-', 'medal:streak5'],
    ['Longest kill', r.long ? `${r.long} m` : '-', 'medal:longshot'],
    ['Best battle royale finish', r.brPlace ? (r.brPlace === 1 ? 'Winner' : `#${r.brPlace}`) : '-', 'mode:br'],
    ['Fastest extraction', r.exSecs ? mmss(r.exSecs) : '-', 'mode:ex'],
    ['Rank', rank, 'ui:rank'],
    ['Best ranked division', r.rankedBest >= 0 ? DIVISIONS[r.rankedBest].name : 'Unranked', 'ui:cup'],
  ];
}

export function trophyScreen(menu, { onBack }) {
  const render = (fresh = false) => {
    menu.el.dataset.screen = 'trophy';
    const c = collections(), t = trophyTotals(c), pct = v => Math.floor((v.have / Math.max(1, v.of)) * 100);
    const rare = rarest(c);
    const zm = (MODES.zm?.maps ?? []).filter(id => MAPS[id]).map(id => [MAPS[id].name, Progress.zmBest(id), Progress.zmFeats(id)]);
    menu.el.innerHTML = `
      ${header({ back: 'tcBack', label: 'Back', title: 'Trophy case', extra: `<span class="hdr-tag">${ico('star')}${pct(t)}% complete</span>` })}
      <div class="tc-wrap scroll-y">
        <section class="tc-col tc-done" data-in="left">
          <div class="tc-total"><b class="t-num">${pct(t)}<small>%</small></b><span><small>Everything earned</small><i class="tc-bar"><i style="transform:scaleX(${(t.have / Math.max(1, t.of)).toFixed(3)})"></i></i><em>${t.have.toLocaleString('en-US')} of ${t.of.toLocaleString('en-US')}</em></span></div>
          ${t.cats.map(x => `<div class="tc-cat" data-cat="${x.id}">${icon(x.icon, { size: 18 })}<span><b>${esc(x.name)}</b><i class="tc-bar"><i style="transform:scaleX(${(x.have / Math.max(1, x.of)).toFixed(3)})"></i></i></span><em>${pct(x)}%<small>${x.have}/${x.of}</small></em></div>`).join('')}
        </section>
        <section class="tc-col tc-recs" data-in="up">
          <h4>${ico('stats')}Personal bests</h4>
          <div class="tc-rec-grid">${records().map(([label, value, ic]) => `<div class="tc-rec">${icon(ic, { size: 18 })}<b>${esc(value)}</b><small>${esc(label)}</small></div>`).join('')}</div>
          <h4>${icon('mode:zm', { size: 16 })}Graveyard Shift<small>best round</small></h4>
          <div class="tc-zm">${zm.map(([name, best, f]) => `<div><b>${best || '-'}</b><small>${esc(name)}</small>${f.escaped ? `<em>Escaped ${f.escaped}</em>` : ''}${f.boss ? '<em class="w">Warden</em>' : ''}</div>`).join('')}</div>
        </section>
        <section class="tc-rare" data-in="up">
          <h4>${ico('star')}Rarest unlocks</h4>
          ${rare.length ? `<div class="tc-rare-row scroll-x">${rare.map(x => `<button class="tc-tile k-${x.kind}" data-act="tcOpen" data-kind="${x.kind}" data-id="${esc(x.id)}"${x.weapon ? ` data-w="${x.weapon}"` : ''}><span class="tc-art">${x.art}</span><b>${esc(x.name)}</b></button>`).join('')}</div>`
            : '<p class="tc-none">Nothing rare yet. Gold calling cards, feat emblems and mastery camos land here.</p>'}
        </section>
      </div>`;
    if (fresh) stagger(menu.el.querySelectorAll('.tc-cat, .tc-rec, .tc-tile'), 'up', { step: 16, max: 14 });
  };
  menu.on({
    tcBack: () => onBack(),
    tcOpen: ({ kind, id, w }, el) => { pop(el); unlockSheet(menu, kind, id, { weapon: w ?? null }); },
  });
  render(true);
  menu.show();
}
