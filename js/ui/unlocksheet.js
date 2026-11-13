// Unlock previews (the rewards pass, docs/UNLOCKS-AUDIT-2026-11-12.md): tap any locked item anywhere and a sheet says
// exactly how to get it, how far along you are (bar and numbers) and, where a playlist counts for it, offers Play now.
//
//   unlockInfo(kind, id, {weapon, operator}) -> { kind, id, name, label, how, value, goal, unlocked, play, art }
//       kind: card | emblem | camo | tracer | killFx | operator | skin | finisher | emote | attachment | weapon | perk |
//             tactical | lethal | streak. `play` is { tab, playlist?, modes? } (js/ui/matchmaking.js) or null.
//   unlockSheet(menu, kind, id, opts)   the sheet, layered over whatever is open (a picker overlay or a screen).
//   setPlayNow(fn)                      main.js: fn({tab, playlist, modes}) opens Multiplayer on that pick.
import { getCard, itemUnlockLevel, MAX_WEAPON_LEVEL } from '../shared/progression.js';
import { getCamo, TRACERS, KILL_EFFECTS } from '../shared/camos.js';
import { FINISHERS, EMOTES } from '../shared/finishers.js';
import { PERKS, TACTICALS, LETHALS, STREAKS } from '../shared/catalog.js';
import { WEAPONS } from '../shared/weapons.js';
import { EX_UNLOCKS, exUnlockStatus } from '../shared/extraction.js';
import { MODES } from '../shared/modes.js';
import { MAPS } from '../shared/map.js';
import { Progress } from './progress.js';
import { cardHtml, careerNow } from './cards.js';
import { getEmblem, emblemUnlocked, emblemProgress, emblemSvg } from './emblems.js';
import { getOperator, getSkin, skinUnlock } from './operators.js';
import { icon } from './icons.js';
import { esc, swatchCss } from './widgets.js';

let playNow = null;
export const setPlayNow = fn => { playNow = fn; };

const KIND = { card: 'Calling card', emblem: 'Emblem', camo: 'Camo', tracer: 'Tracer', killFx: 'Kill effect', operator: 'Operator', skin: 'Operator skin',
  finisher: 'Finisher', emote: 'Emote', attachment: 'Attachment', weapon: 'Weapon', perk: 'Perk', tactical: 'Tactical', lethal: 'Lethal', streak: 'Scorestreak' };
const GEAR = { weapon: WEAPONS, perk: PERKS, tactical: TACTICALS, lethal: LETHALS, streak: STREAKS };
const QUICK = { tab: 'standard', playlist: 'qp' };

// Where a lifetime tally counts: the playlist that moves it.
export function playForStat(key = '') {
  const k = String(key);
  if (k.startsWith('ex:')) return { tab: 'extraction', playlist: 'exquads' };
  if (k.startsWith('zm')) return { tab: 'zombies', playlist: 'zmsolo' };
  if (k.startsWith('rb:')) return { tab: 'br', playlist: 'rbquads' };
  if (k.startsWith('br:') || k === 'long40') return { tab: 'br', playlist: 'quads' };
  if (k === 'gf:flawless') return { tab: 'standard', playlist: 'showdown' };
  if (k === 'inf:survived') return { tab: 'standard', modes: ['inf'] };
  const m = /^(?:played|won|top3):(.+)$/.exec(k);
  if (m) {
    const id = Object.keys(MODES).find(x => MODES[x].rules === m[1]) ?? m[1];
    return id === 'br' ? { tab: 'br', playlist: 'quads' } : id === 'zm' ? { tab: 'zombies', playlist: 'zmsolo' } : id === 'gf' ? { tab: 'standard', playlist: 'showdown' }
      : MODES[id]?.ex ? { tab: 'extraction', playlist: 'exquads' } : { tab: 'standard', modes: [id] };
  }
  const map = /^map(?:won)?:(.+)$/.exec(k)?.[1];
  if (map) return map === 'frontier' ? { tab: 'br', playlist: 'quads' } : MAPS[map]?.zmOnly ? { tab: 'zombies', playlist: 'zmsolo' } : MAPS[map]?.size === 'huge' ? { tab: 'groundwar', playlist: 'gwqp' } : QUICK;
  const OBJ = { plants: 'snd', defuses: 'snd', clutches: 'snd', bombs: 'snd', sndRounds: 'snd', flagCaps: 'ctf', flagReturns: 'ctf', carrierKills: 'ctf', confirms: 'kc', captures: 'dom' };
  if (OBJ[k]) return { tab: 'standard', modes: [OBJ[k]] };
  return QUICK;
}

const level = () => Progress.unlockCtx?.().level ?? 1;
const pair = (v, g) => ({ value: Math.max(0, Math.min(g, Math.floor(Number.isFinite(v) ? v : 0))), goal: Math.max(1, g) });

export function unlockInfo(kind, id, { weapon = null, operator = null } = {}) {
  const base = { kind, id, label: KIND[kind] ?? kind, play: QUICK, art: '' };
  try {
    if (kind === 'card') {
      const c = getCard(id), x = Progress.cards().find(e => e.card.id === id);
      const p = x?.progress ?? (x?.unlocked ? { value: 1, goal: 1 } : null);
      return { ...base, name: c.name, how: c.req, unlocked: !!x?.unlocked, ...(p ?? { value: x?.unlocked ? 1 : 0, goal: 1 }), play: c.play ?? (c.group === 'Season' || c.group === 'Ranked' ? null : QUICK),
        art: cardHtml(id, { size: 300, sub: c.group }), noBar: !p };
    }
    if (kind === 'emblem') {
      const e = getEmblem(id), c = careerNow(), st = emblemUnlocked(e, c), [v, g] = emblemProgress(e, c);
      return { ...base, name: e.name, how: st.requirement, unlocked: st.unlocked, ...pair(st.unlocked ? g : v, g), play: e.play ?? (e.rule.grant ? null : e.rule.life ? playForStat(e.rule.life) : QUICK),
        art: emblemSvg(id, 96), noBar: !!e.rule.grant };
    }
    if (kind === 'camo') {
      const camo = getCamo(id), w = weapon, row = w ? Progress.camos(w).find(x => x.camo.id === id) : null;
      let p = { value: 0, goal: 1 }, play = QUICK, noBar = false;
      if (camo.exfil) { const u = EX_UNLOCKS.find(x => x.id === camo.exfil); const s = exUnlockStatus(u, Progress.lifetime()); p = pair(s.value, s.goal); play = playForStat(u.key); }
      else if (camo.pp) p = pair(Progress.prestige, camo.pp);
      else if (camo.mlv) p = pair(Progress.master, camo.mlv);
      else if (camo.prestige && w) p = pair(Progress.weaponPrestige(w), camo.prestige);
      else if (camo.mastery && w) { const l = Progress.challenges(w); p = pair(l.filter(c => c.done).length, l.length); }
      else if (camo.chal && w) p = pair(Progress.weaponStats(w)[camo.chal.track], camo.chal.goal);
      else if (camo.season) { noBar = true; play = null; }
      const unlocked = row ? row.unlocked : w ? Progress.isUnlocked(w, id) : false;
      return { ...base, name: camo.name, how: `${row?.requirement ?? ''}${w && (camo.prestige || camo.mastery || camo.chal) ? ` (${WEAPONS[w]?.name ?? w})` : camo.exfil || camo.pp || camo.mlv ? ' (every gun)' : ''}`.trim(), unlocked, ...(unlocked ? { value: p.goal, goal: p.goal } : p), play, noBar,
        art: `<i class="ul-swatch" style="background:${swatchCss(camo)}"></i>` };
    }
    if (kind === 'tracer' || kind === 'killFx') {
      const item = (kind === 'tracer' ? TRACERS : KILL_EFFECTS).find(x => x.id === id) ?? { name: id, prestige: 1 };
      const have = weapon ? Progress.weaponPrestige(weapon) : 0, goal = item.prestige ?? 1;
      return { ...base, name: item.name, how: `Weapon Prestige ${goal} on the ${WEAPONS[weapon]?.name ?? 'weapon'}: take it to level ${MAX_WEAPON_LEVEL} and prestige it`, unlocked: have >= goal, ...pair(have, goal),
        art: icon(weapon ?? 'ar', { size: 40 }) };
    }
    if (kind === 'operator') {
      const o = Progress.operators().find(x => x.op.id === id), op = getOperator(id), u = op.unlock ?? {};
      return { ...base, name: op.name, how: o?.requirement ?? '', unlocked: !!o?.unlocked, ...pair(o?.value, o?.goal ?? 1), play: u.life ? playForStat(u.life) : QUICK, art: icon('ui:operator', { size: 72 }) };
    }
    if (kind === 'skin') {
      const s = getSkin(id), st = skinUnlock(s, careerNow());
      return { ...base, name: s.name, how: st.requirement, unlocked: st.unlocked, ...pair(st.value, st.goal ?? 1), noBar: !!(s.unlock?.season), play: s.unlock?.season ? null : s.unlock?.life ? playForStat(s.unlock.life) : QUICK,
        art: `<i class="ul-swatch ul-skin" style="--a:${hex(s.gear ?? s.sleeve)};--b:${hex(s.sleeve)};--c:${hex(s.accent ?? s.trouser)}"></i>`, sub: getOperator(s.operator).name };
    }
    if (kind === 'finisher' || kind === 'emote') {
      const list = kind === 'finisher' ? Progress.finishers(operator) : Progress.emotes(), f = list.find(x => x.id === id) ?? (kind === 'finisher' ? FINISHERS : EMOTES).find(x => x.id === id);
      const ctx = Progress.unlockCtx?.() ?? {}, u = f.unlock ?? {};
      const p = u.level ? pair(ctx.level, u.level) : u.opTier ? pair(ctx.opTier, u.opTier) : u.season ? pair(ctx.season, u.season) : { value: 1, goal: 1 };
      return { ...base, name: f.name, how: f.requirement ?? '', unlocked: !!f.unlocked, ...p, play: u.season ? null : QUICK, art: icon(kind === 'finisher' ? 'ui:skull' : 'ui:chat', { size: 64 }), desc: f.desc };
    }
    if (kind === 'attachment') {
      const a = weapon ? Progress.attachments(weapon).find(x => x.id === id) : null;
      const now = weapon ? Progress.weaponLevel(weapon) : 1, goal = a?.unlockLevel ?? 1;
      return { ...base, name: a?.name ?? id, how: `Reach weapon level ${goal} with the ${WEAPONS[weapon]?.name ?? 'weapon'}`, unlocked: !!a?.unlocked, ...pair(now, goal), art: icon(a?.slot ?? 'optic', { size: 64 }), sub: WEAPONS[weapon]?.name };
    }
    if (GEAR[kind]) {
      const item = GEAR[kind][id], need = itemUnlockLevel(kind, id), peak = level(), ch = Progress.unlockChallenge(kind, id);
      const open = Progress.isItemUnlocked(kind, id);
      const p = peak < need || !ch ? pair(peak, need) : pair(ch.value, ch.goal);
      const key = Object.values(EX_UNLOCKS).find(u => u.kind === kind && u.item === id)?.key;
      return { ...base, name: item?.name ?? id, how: Progress.lockText(kind, id) || `Reach level ${need}`, unlocked: open, ...p, play: key ? playForStat(key) : QUICK,
        art: icon(id, { size: kind === 'weapon' ? 40 : 64 }), steps: ch && peak < need ? [`Reach level ${need}`, ch.label] : null };
    }
  } catch (err) { console.error('unlock info', kind, id, err); }
  return { ...base, name: id, how: '', unlocked: false, value: 0, goal: 1, noBar: true, play: null };
}

const hex = v => (typeof v === 'number' ? `#${(v >>> 0).toString(16).padStart(6, '0').slice(-6)}` : typeof v === 'string' ? v : '#5a6470');
const fmt = n => Number(n).toLocaleString('en-US');

export function unlockSheetHtml(info) {
  const f = info.goal > 0 ? Math.max(0, Math.min(1, info.value / info.goal)) : 0;
  const state = info.unlocked ? 'Unlocked' : 'Locked';
  return `<div class="ul-layer" data-act="ulClose" data-kind="${esc(info.kind)}" data-id="${esc(info.id)}">
    <div class="ul-sheet" role="dialog" aria-label="${esc(info.name)}: how to unlock" data-act="ulKeep">
      <div class="ul-art${info.kind === 'card' ? ' is-card' : ''}">${info.art}</div>
      <div class="ul-body">
        <span class="ul-kick">${esc(info.label)}${info.sub ? ` · ${esc(info.sub)}` : ''}<em class="${info.unlocked ? 'ok' : ''}">${state}</em></span>
        <h2>${esc(info.name)}</h2>
        ${info.desc ? `<p class="ul-desc">${esc(info.desc)}</p>` : ''}
        <p class="ul-how"><b>How to get it</b>${esc(info.how || 'Keep playing')}</p>
        ${info.noBar ? '' : `<div class="ul-prog"><i class="ul-bar"><i style="transform:scaleX(${f.toFixed(3)})"></i></i><small><b>${fmt(info.value)}</b> / ${fmt(info.goal)}</small></div>`}
        <div class="ul-btns">
          <button class="btn" data-act="ulClose" data-sound="back">${icon('ui:close', { size: 16 })}<b>Close</b></button>
          ${info.play && !info.unlocked && playNow ? `<button class="btn is-primary" data-act="ulPlay" data-sound="confirm">${icon('ui:play', { size: 16 })}<b>Play now</b></button>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

// The sheet as a layer on the overlay (so a picker sheet under it stays put). Tap outside or Close to dismiss.
export function unlockSheet(menu, kind, id, opts = {}) {
  const info = unlockInfo(kind, id, opts);
  const host = menu.overlayEl;
  host.querySelector('.ul-layer')?.remove();
  const wasShown = host.classList.contains('show');
  host.insertAdjacentHTML('beforeend', unlockSheetHtml(info));
  host.classList.add('show', 'has-ul');
  const close = () => {
    host.querySelector('.ul-layer')?.remove();
    host.classList.remove('has-ul');
    if (!wasShown && !host.children.length) host.classList.remove('show');
  };
  menu.on({
    ulKeep: () => {},
    ulClose: (_d, el) => { if (el?.classList?.contains('ul-layer') || el?.tagName === 'BUTTON') close(); },
    ulPlay: () => { close(); menu.overlay(''); playNow?.(info.play); },
  });
  return info;
}
