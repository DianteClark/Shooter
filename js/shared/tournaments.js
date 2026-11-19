// Weekend tournaments (docs/TOURNAMENTS.md): the bracket. Eight squads, single elimination: the player's squad (solo
// with pool bots as teammates, or a friend party) against seven clans from the bot pool, fielding their real members.
// Everything is a function of the weekend key and the bracket owner's id, so a reload, or a friend in the owner's party,
// sees the same bracket, the same rounds and the same results of every bot-against-bot match.
//
//   bracketFor(key, owner, { name })   { key, cup, squads[8], rounds[3], ... } (see below)
//   resolveBracket(bracket, run)               every match with its two squads and its winner as far as it is known
//   roundPlan(key)                             the mode, map and limits each round plays that weekend
//   matchSides(bracket, round, { humans, target, date })   the pool picks for both sides of the player's match
//
// The player's squad is seed 1, so its quarter-final is against the weakest clan and the final (most weekends) against
// one of the strongest; on top of that the enemy plays up a step each round (ROUND_STEP).
import { CLANS, profileById, formRating, hash32, BOT_POOL, clanInfo, duoOf, careerAt, tierOf, HUMAN_BASE } from './botpool.js';
import { MAPS, MAP_IDS, sizeOf } from './map.js';
import { MODES, modeFitsMap } from './modes.js';
import { cupFor, ROUND_NAMES, dayIso } from './tourney-items.js';

const DAY = 86400000;
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const unit = (...parts) => hash32(...parts) / 4294967296;
const clamp01 = v => Math.max(0, Math.min(1, v));
const r3 = v => Math.round(v * 1000) / 1000;

// Seeds into bracket positions (quarter-finals pair positions 0-1, 2-3, 4-5, 6-7): 1v8, 4v5, 2v7, 3v6.
const SEED_ORDER = [1, 8, 4, 5, 2, 7, 3, 6];
// How much the enemy plays up, by round, over its blend of its own form and the player's level.
export const ROUND_STEP = [0.02, 0.06, 0.1];
// How much of the enemy's match rating is the members' own form (the rest is the player's level).
const ENEMY_FORM = 0.4;
// How strongly a squad's strength gap decides a bot-against-bot match (logistic slope on the 0..1 rating scale).
const SLOPE = 9;

/* ---------- The rounds ---------- */
const planCache = new Map();
// [{ round, name, mode, mapId, scoreLimit, timeLimit }] for a weekend.
export function roundPlan(key) {
  if (planCache.has(key)) return planCache.get(key);
  const cup = cupFor(key), used = new Set();
  const out = cup.rounds.map((modes, round) => {
    const mode = modes[Math.floor(unit('tn-mode', key, round) * modes.length)];
    let maps = MAP_IDS.filter(id => !MAPS[id].devMap && cup.maps.includes(sizeOf(MAPS[id])) && modeFitsMap(MAPS[id], mode));
    if (maps.some(id => !used.has(id))) maps = maps.filter(id => !used.has(id));
    const mapId = maps[Math.floor(unit('tn-map', key, round) * maps.length)];
    used.add(mapId);
    return { round, name: ROUND_NAMES[round], mode, mapId, scoreLimit: cup.limits[mode] ?? MODES[mode].scoreLimit, timeLimit: MODES[mode].timeLimit };
  });
  planCache.set(key, out);
  return out;
}

/* ---------- The squads ---------- */
// A clan's line-up for the weekend: its strongest `size` members, give or take who is around (a weekly jitter).
function lineUp(clan, key, size) {
  return clan.members.map(id => profileById(id)).filter(Boolean)
    .map(p => ({ p, v: p.skill.mu + (unit('tn-avail', key, p.id) - 0.5) * 0.18 }))
    .sort((a, b) => b.v - a.v).slice(0, size).map(x => x.p);
}
const meanMu = list => list.reduce((a, p) => a + p.skill.mu, 0) / Math.max(1, list.length);

// The player's bot teammates for the weekend: players with no clan, around a middling level (TEAMMATE_MU: they signed
// up for a cup), the same all weekend whatever the player's form does (the match blends their rating with the player's).
const TEAMMATE_MU = 0.4;
function teammates(key, owner, count, exclude) {
  if (count <= 0) return [];
  const want = TEAMMATE_MU;
  const cand = BOT_POOL.filter(p => !clanInfo(p) && !exclude.has(p.id))
    .map(p => ({ p, d: Math.abs(p.skill.mu - want) + unit('tn-mate', key, owner, p.id) * 0.12 }))
    .sort((a, b) => a.d - b.d);
  const out = [];
  for (const { p } of cand) {
    if (out.length >= count) break;
    if (out.some(q => duoOf(q) === p.id)) continue;
    out.push(p);
  }
  return out;
}

const cache = new Map();
// The bracket of a weekend for an owner. name: the owner's squad name (party guests pass the host's).
// { key, date ('YYYY-MM-DD' Friday), cup, owner, rounds: roundPlan, squads: [{ slot (0..7, bracket position), seed,
//   kind: 'you'|'clan', tag, name, members: [profile ids], strength (mean usual rating, clans), skill }] }
// clan: the owner's player clan ({ tag, name }, js/shared/clans.js), if any: the squad plays under its tag and name. It
// changes only the label, never the draw.
export function bracketFor(key, owner, { name = 'Your squad', clan = null } = {}) {
  const cl = clan && typeof clan.tag === 'string' && /^[A-Z0-9]{2,4}$/.test(clan.tag) && !CLANS.some(c => c.tag === clan.tag) && clan.name ? clan : null;
  const ck = `${key}|${owner}|${name}|${cl ? `${cl.tag}|${cl.name}` : ''}`;
  if (cache.has(ck)) return cache.get(ck);
  const cup = cupFor(key), size = cup.size;
  const rng = mulberry32(hash32('tn-bracket', key, owner));
  const ok = CLANS.filter(c => c.members.length >= size);
  const shuffle = list => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); [a[i], a[k]] = [a[k], a[i]]; } return a; };
  // A mix: two of the stacked clans, one of the weak ones, four of the rest (topped up from anything left).
  const by = s => shuffle(ok.filter(c => c.skill === s));
  const stacked = by('stacked'), weak = by('weak'), avg = by('average');
  const pick = [...stacked.slice(0, 2), ...weak.slice(0, 1), ...avg.slice(0, 4)];
  for (const c of shuffle(ok)) if (pick.length < 7 && !pick.includes(c)) pick.push(c);
  const clans = pick.map(c => {
    const members = lineUp(c, key, size);
    return { kind: 'clan', tag: c.tag, name: c.name, members: members.map(p => p.id), strength: r3(meanMu(members)), skill: c.skill };
  });
  // Seeds 2..8 by strength (ties by tag, so the order never depends on the draw).
  clans.sort((a, b) => b.strength - a.strength || (a.tag < b.tag ? -1 : 1));
  const taken = new Set(clans.flatMap(c => c.members));
  const mates = teammates(key, owner, size - 1, taken);
  const you = { kind: 'you', tag: cl ? cl.tag : null, name: cl ? String(cl.name) : name, members: mates.map(p => p.id), strength: null, skill: null };
  const bySeed = [you, ...clans];
  const squads = SEED_ORDER.map((seed, slot) => ({ ...bySeed[seed - 1], seed, slot }));
  const out = { key, date: dayIso(key), cup, owner, rounds: roundPlan(key), squads };
  cache.set(ck, out);
  return out;
}

// A squad's strength in one round of one weekend: its members' form that day (the same per-match form roll the pool
// uses), averaged.
function formOf(squad, key, round) {
  const list = squad.members.map(profileById).filter(Boolean);
  return list.reduce((a, p) => a + formRating(p, hash32('tn-form', key, round)), 0) / Math.max(1, list.length);
}

// Who wins a match between two clans: by their form that round, with a weekend-and-match roll (deterministic).
function botWinner(b, round, match, A, B) {
  const sa = formOf(A, b.key, round), sb = formOf(B, b.key, round);
  const pA = 1 / (1 + Math.exp(-(sa - sb) * SLOPE));
  return unit('tn-result', b.key, b.owner, round, match) < pA ? A : B;
}

// Every match of the bracket as far as it is known. run: { roundsWon, out (lost in round roundsWon) } for the player's
// squad (null: not entered). Returns { matches: [[{ a, b, winner, you }] x4, x2, x1], champion (squad or null),
//   next: { round, opponent } | null (the player's next match), reveal (rounds whose other results are shown) }.
// Other branches' results are revealed as the player goes: a round's other matches show once the player has played
// that round; everything shows once the player is out, is champion, or `all` is set (the weekend is over).
export function resolveBracket(b, run = null, { all = false } = {}) {
  const won = run?.roundsWon ?? 0, out = !!run?.out;
  let field = b.squads.slice();
  const matches = [];
  let next = null;
  for (let round = 0; round < 3; round++) {
    const list = [];
    const winners = [];
    for (let m = 0; m < field.length / 2; m++) {
      const A = field[2 * m], B = field[2 * m + 1];
      const you = A?.kind === 'you' ? A : B?.kind === 'you' ? B : null;
      let winner = null;
      if (A && B) {
        if (you) {
          const them = you === A ? B : A;
          if (won > round) winner = you;
          else if (out && won === round) winner = them;
          // Not decided yet: the player's next match (nothing past it is known).
          else if (!out) next = { round, opponent: them };
        } else winner = botWinner(b, round, m, A, B);
      }
      list.push({ a: A ?? null, b: B ?? null, winner, you: !!you, round, match: m });
      winners.push(winner);
    }
    matches.push(list);
    field = winners;
  }
  const final = matches[2][0];
  const reveal = all || out || won >= 3 ? 3 : won + (out ? 1 : 0);
  return { matches, champion: final.winner, next, reveal };
}

// The pool picks for the player's match in `round`: sides [[team 0 bots], [team 1 bots]] in the shape pickPoolBots
// returns (js/sim/sim.js buildPoolRoster `sides`). humans: how many people sit on the player's side (they take the
// first teammates' seats); target: the humans' rating (humanRating). The enemy's rating blends each member's form with
// the player's level (ENEMY_FORM), then plays up ROUND_STEP[round].
export function matchSides(b, round, opponent, { humans = 1, target = HUMAN_BASE, date = Date.now(), seed = 0 } = {}) {
  const size = b.cup.size;
  const pickOf = (p, rating) => {
    const c = careerAt(p, date);
    return { profile: p, rating: r3(clamp01(rating)), tier: tierOf(clamp01(rating)), badge: { prestige: c.prestige, level: c.level, master: c.master }, party: null };
  };
  const you = b.squads.find(s => s.kind === 'you');
  const mates = you.members.slice(0, Math.max(0, size - humans)).map(profileById).filter(Boolean)
    .map(p => pickOf(p, 0.5 * formRating(p, hash32('tn-form', b.key, round)) + 0.5 * clamp01(target + 0.04)));
  const them = opponent.members.map(profileById).filter(Boolean)
    .map(p => pickOf(p, ENEMY_FORM * formRating(p, hash32('tn-form', b.key, round)) + (1 - ENEMY_FORM) * target + ROUND_STEP[round]));
  // The clan queues as one party.
  for (const t of them) t.party = 0;
  return [mates, them];
}

// "Semi-final vs [VXN] Vexen"
export const roundTitle = (round, opponent) => `${ROUND_NAMES[round]} vs ${opponent?.tag ? `[${opponent.tag}] ` : ''}${opponent?.name ?? ''}`;
export { DAY };
