// Custom bot match settings for the solo picker: bot difficulty (one for all modes), and per mode the bots per team,
// score limit and time limit. Saved on this device. Untouched values follow the mode's own defaults, so a fresh save
// plays exactly as before and a later change to a mode's defaults still reaches players who never customised it.
//
//   BotMatch.resolve(mode, map)      { skill, bots, players, scoreLimit, timeLimit } for launchSolo
//   botMatchSheet(menu, pick, {onChange})   the settings sheet over the solo picker
//   botMatchSummary(pick)            one short line for the picker's settings button
import { MODES, isFfa, playersFor } from '../shared/modes.js';
import { MAPS } from '../shared/map.js';
import { RANDOM } from './vote.js';
import { esc } from './widgets.js';
import { ico } from './yard.js';

const KEY = 'switchyard-botmatch';
export const SKILLS = [['recruit', 'Recruit'], ['regular', 'Regular'], ['veteran', 'Veteran'], ['elite', 'Elite'], ['mixed', 'Mixed']];
const SKILL_IDS = new Set(SKILLS.map(s => s[0]));
const DEFAULT_SKILL = 'mixed';

// Time limits offered around a mode's default: the usual match lengths, plus the default itself. A mode with a short
// clock (a round timer) gets multiples of its own default instead.
const MATCH_TIMES = [180, 300, 480, 600, 900, 1200, 1800];

let saved = load();

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && typeof v === 'object') return { skill: SKILL_IDS.has(v.skill) ? v.skill : DEFAULT_SKILL, modes: v.modes && typeof v.modes === 'object' ? v.modes : {} };
  } catch { /* unreadable: defaults */ }
  return { skill: DEFAULT_SKILL, modes: {} };
}

function store() {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode: settings last this session */ }
}

// Score limits offered for a mode: its default, and fractions and multiples of it rounded to a readable step.
export function scoreSteps(mode) {
  const m = MODES[mode];
  if (!m) return [];
  if (m.rules === 'gun') return [m.scoreLimit];                // The ladder is the limit.
  if (m.rounds) return [...new Set([2, 3, 4, 5, 6, 7, m.scoreLimit])].sort((a, b) => a - b);   // Rounds to win.
  const d = m.scoreLimit, unit = d >= 150 ? 50 : d >= 50 ? 25 : d >= 20 ? 5 : 1;
  const out = new Set([d]);
  for (const k of [1 / 3, 1 / 2, 2 / 3, 4 / 3, 5 / 3, 2]) out.add(Math.max(unit, Math.round(d * k / unit) * unit));
  return [...out].sort((a, b) => a - b);
}

export function timeSteps(mode) {
  const d = MODES[mode]?.timeLimit;
  if (!d) return [];
  const out = new Set([d]);
  if (MODES[mode].rounds) for (const t of [60, 90, 120, 150, 180, 240]) out.add(t);   // One round's clock.
  else if (d < 180) for (const k of [0.5, 0.75, 1.5, 2]) out.add(Math.round(d * k / 5) * 5);
  else for (const t of MATCH_TIMES) out.add(t);
  return [...out].sort((a, b) => a - b);
}

// Most bots a side can take. Teams: the mode's team size on the enemy side, and your side fills around you to the
// same size (so 0 is an empty yard, 1 a duel). Free-for-all: every other seat; a Ground War map seats more.
export function maxBots(mode, map = null) {
  const m = MODES[mode];
  if (!m) return 0;
  return isFfa(mode) ? Math.max(0, playersFor(mode, map) - 1) : m.teamSize;
}

// Fewest bots a side can take. Rounds end when a side is wiped out, so S&D needs someone to play against.
export const minBots = mode => (MODES[mode]?.rounds ? 1 : 0);

const nearest = (list, v) => list.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), list[0]);

// The settings for one mode on one map, clamped and snapped to what that pair offers.
export function resolve(mode, map = null) {
  const m = MODES[mode], own = saved.modes[mode] ?? {};
  const top = maxBots(mode, map);
  const bots = Math.max(minBots(mode), Math.min(top, Number.isFinite(own.bots) ? own.bots : top));
  const ss = scoreSteps(mode), ts = timeSteps(mode);
  return {
    skill: saved.skill,
    bots,
    // Free-for-all counts seats, not bots: you plus every bot.
    players: isFfa(mode) ? bots + 1 : null,
    scoreLimit: Number.isFinite(own.score) && ss.length ? nearest(ss, own.score) : m?.scoreLimit,
    timeLimit: Number.isFinite(own.time) && ts.length ? nearest(ts, own.time) : m?.timeLimit,
    custom: Object.keys(own).length > 0,
  };
}

export const BotMatch = { resolve, maxBots, scoreSteps, timeSteps, get skill() { return saved.skill; } };

function setSkill(skill) {
  if (!SKILL_IDS.has(skill)) return;
  saved.skill = skill;
  store();
}

// Stores a value only when it differs from the default, so defaults keep following the mode.
function setValue(mode, key, value, def) {
  const own = { ...(saved.modes[mode] ?? {}) };
  if (value === def) delete own[key]; else own[key] = value;
  if (Object.keys(own).length) saved.modes[mode] = own; else delete saved.modes[mode];
  store();
}

const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const skillName = id => SKILLS.find(s => s[0] === id)?.[1] ?? id;

function sideLine(mode, bots) {
  if (isFfa(mode)) return bots ? `You and ${bots} bot${bots === 1 ? '' : 's'}` : 'Just you';
  if (!bots) return 'No bots: an empty yard';
  return bots === 1 ? 'You v 1 bot' : `You + ${bots - 1} v ${bots}`;
}

export function botMatchSummary({ mapId, mode }) {
  if (mode === RANDOM || !MODES[mode]) return { top: skillName(saved.skill), sub: 'Mode defaults' };
  if (MODES[mode].br) return { top: skillName(saved.skill), sub: `${MODES[mode].players} players · ${MODES[mode].squad === 1 ? 'solos' : `squads of ${MODES[mode].squad}`}` };
  const r = resolve(mode, MAPS[mapId] ?? null);
  const sides = !r.bots ? 'No bots' : isFfa(mode) ? `${r.bots + 1} players` : `${Math.max(1, r.bots)}v${r.bots}`;
  const limit = MODES[mode].rounds ? `${r.scoreLimit} rds` : r.scoreLimit;
  const clock = MODES[mode].rounds ? `${mmss(r.timeLimit)}/rd` : mmss(r.timeLimit);
  return { top: skillName(r.skill), sub: `${sides} · ${limit} · ${clock}`, custom: r.custom };
}

/* ---------- Sheet ---------- */
export function botMatchSheet(menu, pick, { onChange } = {}) {
  const map = pick.mapId === RANDOM ? null : MAPS[pick.mapId] ?? null;
  const mode = MODES[pick.mode] ? pick.mode : null;

  const stepper = (key, label, value, sub, { canDown, canUp, locked = false }) => `
    <div class="bm-row" data-row="${key}">
      <span class="bm-lb"><b>${esc(label)}</b><small>${esc(sub)}</small></span>
      <span class="bm-step">
        <button class="bm-btn" data-act="bmStep" data-key="${key}" data-dir="-1" aria-label="Less" ${canDown && !locked ? '' : 'disabled'}>${ico('minus')}</button>
        <output class="bm-val">${esc(String(value))}</output>
        <button class="bm-btn" data-act="bmStep" data-key="${key}" data-dir="1" aria-label="More" ${canUp && !locked ? '' : 'disabled'}>${ico('plus')}</button>
      </span>
    </div>`;

  const paint = () => {
    let rows = '';
    if (mode && MODES[mode].br) rows = `<p class="bm-note">${MODES[mode].players} players: you, and bots in every other seat. The circle sets the length; difficulty is the only setting.</p>`;
    else if (mode) {
      const r = resolve(mode, map), top = maxBots(mode, map);
      const ss = scoreSteps(mode), ts = timeSteps(mode);
      const si = ss.indexOf(r.scoreLimit), ti = ts.indexOf(r.timeLimit);
      rows = stepper('bots', isFfa(mode) ? 'Bots' : 'Bots per team', r.bots, sideLine(mode, r.bots), { canDown: r.bots > minBots(mode), canUp: r.bots < top })
        + stepper('score', MODES[mode].rounds ? 'Rounds to win' : 'Score limit', r.scoreLimit, MODES[mode].rules === 'gun' ? 'Set by the gun ladder' : r.scoreLimit === MODES[mode].scoreLimit ? 'Default' : `Default ${MODES[mode].scoreLimit}`, { canDown: si > 0, canUp: si < ss.length - 1, locked: ss.length < 2 })
        + stepper('time', MODES[mode].rounds ? 'Round time' : 'Time limit', mmss(r.timeLimit), r.timeLimit === MODES[mode].timeLimit ? 'Default' : `Default ${mmss(MODES[mode].timeLimit)}`, { canDown: ti > 0, canUp: ti < ts.length - 1 });
    }
    menu.overlay(`
      <div class="sheet bm-sheet" role="dialog" aria-label="Bot match settings">
        <div class="bm-head">
          <span class="bm-title"><b>Bot match</b><small>${mode ? esc(MODES[mode].name) : 'Any mode'}</small></span>
          <button class="btn is-primary bm-done" data-act="bmDone" data-sound="confirm">${ico('check')}<b>Done</b></button>
        </div>
        <div class="bm-row bm-skill">
          <span class="bm-lb"><b>Difficulty</b><small>All modes</small></span>
          <span class="bm-segs">${SKILLS.map(([id, name]) => `<button class="bm-seg${id === saved.skill ? ' on' : ''}" data-act="bmSkill" data-skill="${id}" data-sound="tab">${name}</button>`).join('')}</span>
        </div>
        ${rows || '<p class="bm-note">A random mode plays with that mode\'s own settings. Pick a mode to change them.</p>'}
        ${mode ? `<button class="bm-reset" data-act="bmReset"${resolve(mode, map).custom ? '' : ' disabled'}>${ico('refresh')}<b>Defaults for ${esc(MODES[mode].short ?? MODES[mode].name)}</b></button>` : ''}
      </div>`);
  };

  const step = (key, dir) => {
    if (!mode) return;
    const r = resolve(mode, map);
    if (key === 'bots') {
      const top = maxBots(mode, map), v = Math.max(minBots(mode), Math.min(top, r.bots + dir));
      setValue(mode, 'bots', v, top);
    } else {
      const list = key === 'score' ? scoreSteps(mode) : timeSteps(mode);
      const cur = key === 'score' ? r.scoreLimit : r.timeLimit;
      const i = Math.max(0, Math.min(list.length - 1, list.indexOf(cur) + dir));
      setValue(mode, key, list[i], key === 'score' ? MODES[mode].scoreLimit : MODES[mode].timeLimit);
    }
    paint();
    onChange?.();
  };

  menu.on({
    bmDone: () => { menu.overlay(''); onChange?.(); },
    bmSkill: ({ skill }) => { setSkill(skill); paint(); onChange?.(); },
    bmStep: ({ key, dir }) => step(key, Number(dir)),
    bmReset: () => { if (mode) { delete saved.modes[mode]; store(); } paint(); onChange?.(); },
  });
  paint();
}
