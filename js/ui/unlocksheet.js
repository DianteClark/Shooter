// Unlock previews (the rewards pass, docs/UNLOCKS-AUDIT-2026-11-12.md): tap any locked item anywhere and a sheet says
// exactly how to get it, how far along you are (bar and numbers) and, where a playlist counts for it, offers Play now.
//
//   unlockInfo(kind, id, {weapon, operator}) -> { kind, id, name, label, how, value, goal, unlocked, play, art }
//       kind: card | emblem | camo | tracer | killFx | operator | skin | finisher | emote | attachment | weapon | perk |
//             tactical | lethal | streak. `play` is { tab, playlist?, modes? } (js/ui/matchmaking.js) or null.
//   unlockSheet(menu, kind, id, opts)   the sheet, layered over whatever is open (a picker overlay or a screen).
//   setPlayNow(fn)                      main.js: fn({tab, playlist, modes}) opens Multiplayer on that pick.
import { getCard, itemUnlockLevel, MAX_WEAPON_LEVEL, MAX_LEVEL, MAX_PRESTIGE, VETERAN, MASTERY_TRACKS, CARDS } from '../shared/progression.js';
import { PERKS as PERK_DEFS } from '../shared/catalog.js';
import { SEASON_DEFS, TRACK_TIERS } from '../shared/season-items.js';
import { PLACES } from '../shared/tourney-items.js';
import { division } from '../shared/ranked.js';
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

// A weekly event's reward (js/shared/events.js) while its event runs: the challenges done so far, as the bar.
function eventBar(info, eventId) {
  const ev = eventId && !info.unlocked ? Progress.weeklyEvent?.() : null;
  return ev && ev.info.id === eventId ? { ...info, ...pair(ev.done, ev.list.length), noBar: false } : info;
}

export function unlockInfo(kind, id, opts = {}) {
  const info = unlockInfo0(kind, id, opts);
  try { return eventBar(info, kind === 'card' ? getCard(id)?.event : kind === 'emblem' ? getEmblem(id)?.event : null); } catch { return info; }
}

function unlockInfo0(kind, id, { weapon = null, operator = null } = {}) {
  const base = { kind, id, label: KIND[kind] ?? kind, play: QUICK, art: '' };
  try {
    if (kind === 'card') {
      const c = getCard(id), x = Progress.cards().find(e => e.card.id === id);
      const r = cardRequirement(c, x);
      return { ...base, name: c.name, how: r.how, steps: r.steps, status: r.status, unlocked: !!x?.unlocked, ...r.bar, noBar: r.noBar,
        play: 'play' in c ? c.play : (c.group === 'Season' || c.group === 'Ranked' || c.group === 'Tournament' ? null : QUICK),
        art: cardHtml(id, { size: 300, sub: c.group }) };
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
      const p = u.level ? pair(ctx.level, u.level) : u.opTier ? pair(ctx.opTier, u.opTier) : u.season ? pair(ctx.season, u.season) : u.sig ? pair(ctx.ops?.[u.sig] ?? 0, u.tier) : { value: 1, goal: 1 };
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

/* ---------- Calling cards: what each one really asks, and how far along you are ---------- */
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const TRACK_OF_CARD = new Map();
for (const t of MASTERY_TRACKS) for (const tier of t.tiers) for (const r of tier.rewards) if (r.kind === 'card') TRACK_OF_CARD.set(r.id.slice(5), { track: t, tier: tier.tier });
const KIND_USE = { tactical: 'Equip it and use it in matches', lethal: 'Equip it and use it in matches',
  streak: 'Equip it and call it in during matches', operator: 'Play matches as this operator' };
const dayText = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const MASTER_HOW = 'A gun is mastered once every camo challenge on it is done (the Gunsmith\'s camo list shows each one).';

// cardRequirement(card, row) -> { how, steps?: [{label, value, goal, done}], status?, bar: {value, goal}, noBar }
// `row` is Progress.cards()'s entry ({unlocked, progress}); every card id gives a specific, non-empty `how`.
export function cardRequirement(c, row = null) {
  const unlocked = !!row?.unlocked;
  const prog = row?.progress ?? null;
  let how = c.req ?? '', steps = null, status = '', bar = prog ? { value: prog.value, goal: prog.goal } : null;
  const id = c.id, art = c.art ?? {};
  const tierWord = t => (t ? ` This is tier ${t} of 3.` : '');
  try {
    if (id === 'yard') how = 'Every player starts with it: equip it any time from Calling cards.';
    else if (c.group === 'Pro' && PERK_DEFS[id.slice(4)]) {
      const perk = id.slice(4), st = Progress.proStatus(perk), name = PERK_DEFS[perk].name;
      how = `Earn ${name} Pro: with the ${name} perk in your loadout, finish ${st.steps.length === 2 ? 'both' : `all ${st.steps.length}`} of its Pro challenges (they count in any mode).`;
      steps = st.steps.map(x => ({ label: x.label, value: x.value, goal: x.goal, done: x.done }));
      bar = { value: st.steps.filter(x => x.done).length, goal: st.steps.length };
    } else if (/^prestige-\d+$/.test(id)) {
      const n = Number(id.slice(9)), now = Progress.prestige ?? 0;
      how = `Reach Prestige ${n}: get to level ${MAX_LEVEL}, then Prestige on the Prestige screen${n > 1 ? `, ${n} times in all` : ''}.`;
      status = `You are ${now ? `Prestige ${now}` : 'not prestiged yet'}, level ${Progress.level ?? 1}.`;
      bar = { value: Math.min(now, n), goal: n };
    } else if (c.group === 'Prestige') {
      const lv = Number(/Master level (\d+)/.exec(c.req)?.[1] ?? 0), now = Progress.master ?? 0;
      how = `Reach Master level ${fmt(lv)}: after Prestige ${MAX_PRESTIGE} every level you gain past ${MAX_LEVEL} counts as a Master level.`;
      status = `Master level now: ${fmt(now)}${(Progress.prestige ?? 0) < MAX_PRESTIGE ? ` (Prestige ${MAX_PRESTIGE} first; you are Prestige ${Progress.prestige ?? 0})` : ''}.`;
      bar = { value: Math.min(now, lv), goal: lv };
    } else if (/^camo-(gold|molten|prism)$/.test(id)) {
      const cm = getCamo(id.slice(5));
      how = `Unlock the ${cm.name} camo on any one gun: it is a mastery camo, so master the gun (every camo challenge and its mastery ladder after weapon level ${MAX_WEAPON_LEVEL})${cm.masteryKills ? ` and get ${fmt(cm.masteryKills)} kills with it` : ''}.`;
      bar = { value: 0, goal: 1 };
    } else if (/^(gilt-10|prism-5|molten-5)$/.test(id)) {
      const n = Number(id.split('-')[1]);
      how = `${c.req}: unlock that mastery camo on ${n} different guns (master each gun${id === 'gilt-10' ? '' : ` and reach its kill count`}). ${MASTER_HOW}`;
    } else if (id === 'mastery-5') how = `Master 5 different guns. ${MASTER_HOW}`;
    else if (/^master-/.test(id)) how = `${c.req} in the category: master each one. ${MASTER_HOW}`;
    else if (/^gun-/.test(id)) {
      const w = id.slice(4), list = Progress.challenges(w) ?? [];
      how = `Master the ${WEAPONS[w]?.name ?? w}: finish every camo challenge on it, or its mastery ladder after weapon level ${MAX_WEAPON_LEVEL}.`;
      if (list.length) { steps = list.slice(0, 8).map(x => ({ label: x.label, value: x.value, goal: x.goal, done: x.done })); bar = { value: list.filter(x => x.done).length, goal: list.length }; }
    } else if (TRACK_OF_CARD.has(id)) {
      const { track, tier } = TRACK_OF_CARD.get(id), st = Progress.mastery(track.id);
      how = `Reach tier ${tier} of the ${track.name} mastery track (Mastery screen). ${KIND_USE[track.kind] ?? 'Use it in matches'}: each tier has its own goal.`;
      steps = (st?.tiers ?? track.tiers).slice(0, tier).map(x => ({ label: `Tier ${x.tier}: ${x.label}`, value: x.value ?? 0, goal: x.goal, done: !!x.done }));
      bar = { value: Math.min(tier, st?.tier ?? 0), goal: tier };
    } else if (id === 'veteran') {
      how = `Become a Veteran: reach Prestige ${VETERAN.prestige}, or reach level ${VETERAN.level} and earn ${VETERAN.pro} Pro perks.`;
    } else if (id === 'pro-5' || id === 'pro-all') how = `${c.req}: each perk turns Pro once you finish its Pro challenges with it equipped (see each perk in the loadout).`;
    else if (c.group === 'Career') how = `${c.req}, added up over all your matches in any mode.`;
    else if (c.group === 'Arms') how = `${c.req}, added up over all your matches: every gun of that class counts.`;
    else if (c.group === 'Maps') how = `${c.req}, in any mode played there.${tierWord(art.tier)}`;
    else if (id === 'zm-warden') {
      how = 'In Graveyard Shift, finish the hidden quest on a map and put down the Gravewarden it raises (any map but Polestar Relay and Wrenfield Fair).';
      status = 'Not done yet.';
    } else if (id === 'zm-listener') {
      how = 'In Graveyard Shift on Polestar Relay, wake the radios and put down the Listener they raise.';
      status = 'Not done yet.';
    } else if (id === 'zm-barker') {
      how = 'In Graveyard Shift on Wrenfield Fair, light the lanterns in the Oracle\'s order, ring the bell and put down the Barker.';
      status = 'Not done yet.';
    } else if (id === 'zm-escape' || id === 'zm-escape25') {
      const best = Math.max(0, ...Object.values(Progress.zmFeatsAll?.() ?? {}).map(v => (Array.isArray(v) ? v[0] ?? 0 : 0)));
      how = `${c.req}: call the helicopter once the round allows it and get aboard alive.`;
      status = best ? `Your latest escape: round ${best}.` : 'No escape yet.';
    } else if (c.group === 'Zombies') {
      const best = Math.max(0, ...Object.values(Progress.zmBestAll?.() ?? {}));
      how = `${c.req}.${tierWord(art.tier)}`;
      status = `Your best round in Graveyard Shift: ${best || 'none yet'}.`;
    } else if (c.group === 'Modes') how = `${c.req}, added up over all your matches of that mode.${tierWord(art.tier)}`;
    else if (c.group === 'Season') {
      const def = SEASON_DEFS.find(d => d.id === c.season), tier = Number(/tier (\d+)/.exec(c.req)?.[1] ?? 0), s = Progress.season?.();
      how = `Reach tier ${tier} of ${TRACK_TIERS} on the Season ${def?.n ?? ''} (${def?.name ?? ''}) reward track: every match you finish earns season XP, then claim the tier on the Season screen.`;
      if (s?.info?.def?.id === c.season) { status = `You are on tier ${s.tier}. ${plural(s.info.daysLeft ?? 0, 'day')} left in the season.`; bar = { value: Math.min(tier, s.tier), goal: tier }; }
      else status = s?.info?.def && (s.info.def.n ?? 0) > (def?.n ?? 0) ? `Season ${def?.n} is over: its track comes back only if the season is replayed.` : `Season ${def?.n} has not started yet.`;
    } else if (c.group === 'Ranked') {
      const def = SEASON_DEFS.find(d => d.id === c.season), div = /Reach (.+?) in Season/.exec(c.req)?.[1] ?? '', rk = Progress.ranked?.();
      how = `Reach ${div} in Season ${def?.n ?? ''} Ranked (the Ranked playlist in Multiplayer): play your ${rk?.placements ?? 5} placement matches, then win to climb. It is awarded when the season ends, for the best rank you reached in it (a later drop does not take it away).`;
      status = rk && Progress.season?.()?.info?.def?.id === c.season ? (rk.placed ? `Your rank now: ${rk.division?.name ?? 'unranked'}; best this season: ${division(rk.peak ?? 0)?.name ?? 'none'}.` : `Placement matches played: ${rk.pm ?? 0} of ${rk.placements}.`) : `Only in Season ${def?.n ?? ''}.`;
    } else if (c.group === 'Tournament') {
      const place = PLACES.findIndex(x => x?.card === c.name), t = Progress.tourney?.();
      how = `${c.req}. Weekend tournaments open on Friday evening and close at the end of Sunday (from Multiplayer): win rounds in your bracket to go further.`;
      status = t ? `${t.info.live ? 'A tournament is open now.' : t.info.opensAt ? `Next one opens ${dayText(t.info.opensAt)}.` : ''} Your best: ${PLACES[t.best]?.name ?? 'not entered yet'}.`.trim() : '';
      if (place > 0 && t) bar = { value: Math.min(place, t.best ?? 0), goal: place };
    } else if (c.group === 'Events') {
      how = `${c.req}. The challenges only count while the event is on (Play now opens it).`;
      status = /\(on now\)/.test(c.req) ? 'On this week: your progress is the bar below.' : 'Not on this week: the date it comes back is above.';
    }
    else if (!how || how === c.name) how = `${c.group} card: ${c.req || c.name}`;
  } catch (err) { console.error('card requirement', id, err); }
  if (unlocked) status = 'Unlocked: equip it from Calling cards.';
  const noBar = !bar;
  if (!bar) bar = { value: unlocked ? 1 : 0, goal: 1 };
  if (unlocked) bar = { value: bar.goal, goal: bar.goal };
  return { how, steps, status, bar, noBar };
}
export const CARD_REQ_IDS = () => CARDS.map(c => c.id);

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
        ${info.steps?.length ? `<ul class="ul-steps">${info.steps.map(x => (typeof x === 'string' ? `<li><span>${esc(x)}</span></li>` : `<li class="${x.done ? 'ok' : ''}"><span>${esc(x.label)}</span><em>${x.done ? 'Done' : `${fmt(Math.min(x.value ?? 0, x.goal))} / ${fmt(x.goal)}`}</em></li>`)).join('')}</ul>` : ''}
        ${info.status ? `<p class="ul-status">${esc(info.status)}</p>` : ''}
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
