// Weekly events (docs/SEASONS.md "Weekly events"): one event a week, Monday 00:00 local to the next Monday, a twist
// playlist with three or four challenges of its own and a reward (a calling card or an emblem, paid once ever).
// Date-driven like the seasons and the featured playlist: the week is counted from EVENT_EPOCH by the local calendar
// day, so every phone on the same date runs the same event and the rotation goes on forever without an update.
//
// Pure: no DOM, no storage. The save keeps the state in the season block (save.season.ev, js/shared/seasons.js):
//   { k: 'w<week>' the week the progress belongs to, c: {challengeId: progress} that week, got: [event ids paid] }
// Event challenges move only in matches played from the event's playlist (main.js tags them: MatchAwards.event), which
// also pay EVENT_XP_BONUS on top of the match's XP.
//
// An event (EVENTS, append only: ids are in saves; the rotation is the list order, so appending changes which event a
// future week gets, never a past one's id):
//   id, name, tab (where the matchmaking plays it: lobby size and maps), mode, mods, desc, icon,
//   reward { kind: 'card'|'emblem', id, name, art (cards: js/ui/cards.js art) | row (emblems: [plate, rim, [colours], glyph]) },
//   challenges [{ key, stat (ChallengeTally counts, plus 'zm:rounds'), goal, icon, label }]
const DAY = 86400000;
const dayOf = (date = new Date()) => { const d = new Date(date); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); };
const startOf = n => { const u = new Date(n * DAY); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime(); };

export const EVENT_EPOCH = '2026-11-16';          // A Monday: week 0.
const EPOCH_DAY = (() => { const [y, m, d] = EVENT_EPOCH.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; })();
export const EVENT_XP_BONUS = 0.1;                // Event matches: +10% of the match's XP.
export const EVENT_CHALLENGE_XP = 1500;           // Each event challenge pays this once a week.

const C = (key, stat, goal, icon, label) => ({ key, stat, goal, icon, label });
export const EVENTS = [
  {
    id: 'gloves', name: 'Gloves Only', tab: 'br', mode: 'rb', mods: ['gloves'], icon: 'mode:rb',
    desc: 'Rebound with no guns on the map: boxing gloves, plates and whatever you can throw.',
    reward: { kind: 'card', id: 'ev-gloves', name: 'Glass Jaw', art: { p: 'rings', c: ['#1c0a0a', '#a8201a', '#ffe0d0', '#ff4a3a'], e: 'ui:skull', gold: true } },
    challenges: [
      C('play', 'played:br', 3, 'mode:rb', 'Play 3 Gloves Only matches'),
      C('fists', 'gun:knife', 8, 'ui:skull', 'Get 8 knockouts with the gloves'),
      C('top5', 'rb:top5', 2, 'ui:cup', 'Finish in the top 5 twice'),
    ],
  },
  {
    id: 'sniperrb', name: 'Snipers Only Rebound', tab: 'br', mode: 'rb', mods: ['snipers'], icon: 'sniper',
    desc: 'Rebound where every gun on the floor is a sniper rifle. Your sidearm still rides along.',
    reward: { kind: 'emblem', id: 'ev-sniperrb', name: 'Long Watch', row: ['oct', '#38b6ff', ['#e6ecf2', '#38b6ff'], 'scope'] },
    challenges: [
      C('play', 'played:br', 3, 'mode:rb', 'Play 3 Snipers Only Rebound matches'),
      C('snipe', 'cat:Sniper', 10, 'sniper', 'Get 10 kills with sniper rifles'),
      C('head', 'head', 4, 'medal:headshot', 'Get 4 headshot kills'),
      C('top5', 'rb:top5', 1, 'ui:cup', 'Finish in the top 5'),
    ],
  },
  {
    id: 'nightshift', name: 'Night Graveyard', tab: 'zombies', mode: 'zm', mods: ['night'], icon: 'mode:zm',
    desc: 'Graveyard Shift with the fog in every round, and every point paid double.',
    reward: { kind: 'card', id: 'ev-nightshift', name: 'Lantern Hour', art: { p: 'waves', c: ['#06080e', '#1c2a3a', '#d8e8ff', '#7cff9a'], e: 'mode:zm', gold: true } },
    challenges: [
      C('play', 'played:zm', 2, 'mode:zm', 'Play 2 Night Graveyard matches'),
      C('kills', 'zm:kills', 150, 'ui:skull', 'Kill 150 zombies'),
      C('head', 'zm:head', 30, 'medal:headshot', 'Get 30 zombie headshots'),
      C('rounds', 'zm:rounds', 12, 'ui:timer', 'Survive 12 rounds in total'),
    ],
  },
  {
    id: 'pistols', name: 'Pistols at Dawn', tab: 'standard', mode: 'tdm', mods: ['pistols'], icon: 'pistol',
    desc: 'Team Deathmatch with sidearms only: every primary becomes a pistol.',
    reward: { kind: 'emblem', id: 'ev-pistols', name: 'High Noon Duel', row: ['shield', '#ffb03a', ['#fff0c0', '#ff8a2a'], 'sun'] },
    challenges: [
      C('play', 'played:tdm', 3, 'mode:tdm', 'Play 3 Pistols at Dawn matches'),
      C('pistol', 'cat:Pistol', 25, 'pistol', 'Get 25 kills with pistols'),
      C('head', 'head', 8, 'medal:headshot', 'Get 8 headshot kills'),
      C('win', 'won:tdm', 2, 'ui:cup', 'Win 2 Pistols at Dawn matches'),
    ],
  },
  {
    id: 'gauntlet', name: 'Gun Game Gauntlet', tab: 'standard', mode: 'gun', mods: ['hardcore'], icon: 'mode:gun',
    desc: 'Hardcore Gun Game: a third of the health, so every rung is one or two shots.',
    reward: { kind: 'card', id: 'ev-gauntlet', name: 'Every Rung', art: { p: 'chevrons', c: ['#14100a', '#6a4a14', '#fff0c8', '#ffcf40'], e: 'ui:crown', gold: true } },
    challenges: [
      C('play', 'played:gun', 3, 'mode:gun', 'Play 3 Gun Game Gauntlet matches'),
      C('kills', 'kills', 25, 'ui:skull', 'Get 25 kills'),
      C('top3', 'top3:gun', 2, 'ui:cup', 'Finish in the top 3 twice'),
    ],
  },
  {
    id: 'overrun', name: 'Infected Overrun', tab: 'groundwar', mode: 'gwinf', mods: [], icon: 'mode:inf',
    desc: 'Ground War Infected: 32 players, two start infected, and the clock is long.',
    reward: { kind: 'emblem', id: 'ev-overrun', name: 'Patient Zero', row: ['hex', '#4dff8a', ['#d8ffe4', '#2ac060'], 'fang'] },
    challenges: [
      C('play', 'played:inf', 3, 'mode:inf', 'Play 3 Infected Overrun matches'),
      C('kills', 'kills', 20, 'ui:skull', 'Get 20 kills'),
      C('survive', 'inf:survived', 1, 'ui:timer', 'Survive to the end once'),
    ],
  },
  {
    id: 'shuffle', name: 'Showdown Shuffle', tab: 'standard', mode: 'gf', mods: [], icon: 'mode:gf',
    desc: 'Showdown all week: 2 v 2 rounds, the same random kit for everyone.',
    reward: { kind: 'card', id: 'ev-shuffle', name: 'Dealt In', art: { p: 'facets', c: ['#100a18', '#3a2a5a', '#e8e0ff', '#c46aff'], e: 'mode:gf', gold: true } },
    challenges: [
      C('play', 'played:gf', 3, 'mode:gf', 'Play 3 Showdown Shuffle matches'),
      C('kills', 'kills', 12, 'ui:skull', 'Get 12 kills'),
      C('win', 'won:gf', 2, 'ui:cup', 'Win 2 Showdown Shuffle matches'),
    ],
  },
  {
    id: 'blades', name: 'Blade Brawl', tab: 'standard', mode: 'tdm', mods: ['melee'], icon: 'knife',
    desc: 'Team Deathmatch with blades and Hatchets only. No guns, no streaks.',
    reward: { kind: 'emblem', id: 'ev-blades', name: 'Cold Edge', row: ['cut', '#ff4d3d', ['#f2ead8', '#ff4d3d'], 'spike'] },
    challenges: [
      C('play', 'played:tdm', 3, 'mode:tdm', 'Play 3 Blade Brawl matches'),
      C('melee', 'cat:Melee', 15, 'knife', 'Get 15 kills with blades'),
      C('hatchet', 'equipKills', 3, 'frag', 'Get 3 Hatchet kills'),
    ],
  },
  {
    id: 'ironhill', name: 'Iron Hill', tab: 'standard', mode: 'hard', mods: ['hardcore', 'nostreaks'], icon: 'mode:hard',
    desc: 'Hardcore Hardpoint with no scorestreaks: hold the hill with what you carry.',
    reward: { kind: 'card', id: 'ev-ironhill', name: 'King of the Hill', art: { p: 'plates', c: ['#101418', '#3a4a5c', '#e6ecf2', '#ff9f1c'], e: 'mode:hard', gold: true } },
    challenges: [
      C('play', 'played:hard', 3, 'mode:hard', 'Play 3 Iron Hill matches'),
      C('captures', 'captures', 6, 'medal:capture', 'Capture 6 zones'),
      C('kills', 'kills', 30, 'ui:skull', 'Get 30 kills'),
    ],
  },
  // Appended after the first rotation, so every week already announced keeps its event.
  {
    id: 'derby', name: 'Home Run Derby', tab: 'standard', mode: 'ffa', mods: ['bats'], icon: 'bat',
    desc: 'Free-for-All where everyone swings the Slugger. No guns, no streaks: knock them out of the park.',
    reward: { kind: 'card', id: 'ev-derby', name: 'Out of the Park', art: { p: 'rings', c: ['#0c1a10', '#2f6a3a', '#f4ead0', '#ffd23a'], e: 'ui:cup', gold: true } },
    challenges: [
      C('play', 'played:ffa', 3, 'mode:ffa', 'Play 3 Home Run Derby matches'),
      C('bat', 'gun:bat', 15, 'bat', 'Get 15 kills with the Slugger'),
      C('podium', 'top3:ffa', 2, 'mode:ffa', 'Finish top 3 in Home Run Derby twice'),
    ],
  },
];
export const EVENT_IDS = EVENTS.map(e => e.id);
export const eventById = id => EVENTS.find(e => e.id === id) ?? null;
// Every event challenge gets a stable id: '<event>.<key>'.
for (const e of EVENTS) for (const c of e.challenges) c.id = `${e.id}.${c.key}`;

// The week number of a date (0 = the week of EVENT_EPOCH; negative before it).
export const eventWeek = (date = new Date()) => Math.floor((dayOf(date) - EPOCH_DAY) / 7);
export const eventKey = week => `w${week}`;
// The event of week `week`: the list in order, round and round.
export const eventOfWeek = week => EVENTS[((week % EVENTS.length) + EVENTS.length) % EVENTS.length];

// The event running on a date: { def, id, name, week, key, startsAt, endsAt (ms, local midnight), daysLeft }.
export function weeklyEventAt(date = new Date()) {
  const week = eventWeek(date), def = eventOfWeek(week);
  const startDay = EPOCH_DAY + week * 7, endDay = startDay + 7;
  return { def, id: def.id, name: def.name, week, key: eventKey(week), startsAt: startOf(startDay), endsAt: startOf(endDay), daysLeft: endDay - dayOf(date) };
}
// When an event next runs from a date (this week counts): { week, startsAt } or null for an unknown id.
export function nextRun(id, date = new Date()) {
  const i = EVENT_IDS.indexOf(id);
  if (i < 0) return null;
  const w0 = eventWeek(date), n = EVENTS.length;
  const week = w0 + ((i - (w0 % n) + n * 2) % n);
  return { week, startsAt: startOf(EPOCH_DAY + week * 7) };
}

/* ---------- The save's state (save.season.ev) ---------- */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const blankEventState = () => ({ k: '', c: {}, got: [] });
export function cleanEventState(raw) {
  const s = blankEventState();
  if (!isObj(raw)) return s;
  const m = /^w(-?\d{1,6})$/.exec(raw.k ?? '');
  if (m) {
    s.k = raw.k;
    const def = eventOfWeek(Number(m[1]));
    if (isObj(raw.c)) for (const c of def.challenges) {
      const v = raw.c[c.id];
      if (Number.isFinite(v) && v > 0) s.c[c.id] = Math.min(c.goal, Math.floor(v));
    }
  }
  if (Array.isArray(raw.got)) s.got = EVENT_IDS.filter(id => raw.got.includes(id));
  return s;
}
export const eventStateEmpty = s => !s || (!s.got?.length && !Object.keys(s.c ?? {}).length);
// The reward ids an event state owns ('card:ev-..', 'emblem:ev-..').
export const eventOwned = s => (s?.got ?? []).map(id => eventById(id)).filter(Boolean).map(e => `${e.reward.kind}:${e.reward.id}`);

// Brings the state to the week of `now` (progress of another week starts over; rewards stay).
export function eventRoll(s, now = new Date()) {
  const ev = weeklyEventAt(now);
  if (s.k !== ev.key) { s.k = ev.key; s.c = {}; return true; }
  return false;
}

// The event's challenges for a state on a date: [{ ...challenge, value, done }].
export function eventStatus(s, now = new Date()) {
  const ev = weeklyEventAt(now), mine = s?.k === ev.key;
  return ev.def.challenges.map(c => ({ ...c, xp: EVENT_CHALLENGE_XP, value: mine ? Math.min(c.goal, s.c[c.id] ?? 0) : 0, done: mine && (s.c[c.id] ?? 0) >= c.goal }));
}

// One event match into the state (already rolled to `now`). `eventId` is the event the match was played under: a match
// from last week's playlist that ends after midnight on Monday counts for nothing. counts: ChallengeTally counts (and
// 'zm:rounds'). Returns { event, moved: [{...challenge, before, value, done, fresh, period: 'event', xp}], xp, reward }
// where reward is { kind, id, name, fresh } once every challenge is done (fresh: owned for the first time now).
export function applyEventMatch(s, eventId, counts = {}, now = new Date()) {
  const ev = weeklyEventAt(now);
  if (!eventId || ev.id !== eventId) return null;
  eventRoll(s, now);
  const moved = [];
  for (const c of ev.def.challenges) {
    const gain = counts?.[c.stat] ?? 0, before = s.c[c.id] ?? 0;
    if (!(gain > 0) || before >= c.goal) continue;
    const value = Math.min(c.goal, before + Math.round(gain));
    s.c[c.id] = value;
    moved.push({ ...c, before, value, done: value >= c.goal, fresh: value >= c.goal, period: 'event', xp: EVENT_CHALLENGE_XP });
  }
  const allDone = ev.def.challenges.every(c => (s.c[c.id] ?? 0) >= c.goal);
  let reward = null;
  if (allDone && moved.some(c => c.fresh)) {
    const fresh = !s.got.includes(ev.id);
    if (fresh) s.got = EVENT_IDS.filter(id => id === ev.id || s.got.includes(id));
    reward = { kind: ev.def.reward.kind, id: ev.def.reward.id, name: ev.def.reward.name, fresh, event: ev.id };
  }
  return { event: ev.id, moved, xp: moved.filter(c => c.fresh).length * EVENT_CHALLENGE_XP, reward };
}

// For the unlock sheets: how an event's reward is earned (with when the event is on), and where to play it now.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function rewardHow(id, now = new Date()) {
  const e = eventById(id);
  if (!e) return '';
  const on = weeklyEventAt(now).id === id, next = nextRun(id, now), d = new Date(next.startsAt);
  return `Weekly event ${e.name}: finish all ${e.challenges.length} of its challenges${on ? ' (on now)' : ` (next on ${MONTHS[d.getMonth()]} ${d.getDate()})`}`;
}
export const rewardPlay = (id, now = new Date()) => (weeklyEventAt(now).id === id ? { tab: 'standard', playlist: 'wkevent' } : null);
