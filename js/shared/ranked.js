// Ranked (docs/ROADMAP.md item 21, docs/SEASONS.md): divisions, placements, skill rating (SR) and the seasonal reset.
// Pure math over the save's `season.rk` block; no DOM, no storage, no bot pool (the pool's ranks live in boards.js, which
// already reads the pool). Every phone works out its own player's rating from its own results: there is no server.
//
//   rk: { k: ranked season key (seasons.js seasonAt().key), sr, pm: placements played, pw: placement wins, pp: placement
//         performance sum (x100), w, l, d, peak (best SR this season once placed), base (SR carried from last season,
//         or -1), prot (1 while the division floor still protects), last (the last match's change) }
import { DIVISIONS, DIVISION_SPAN } from './season-items.js';

export const PLACEMENTS = 5;
export const SR_SCALE = 5100;          // A usual rating (botpool mu, 0..1) of 1 sits at 5100 SR: Master III.
export const PLACEMENT_CAP = 4 * DIVISION_SPAN + DIVISION_SPAN - 1;    // Placements land no higher than Diamond III.
export const CHAMPION = 6 * DIVISION_SPAN;   // 5400 SR and up.
export const SR_MAX = 9999;
export const CARRY = 0.75;             // The seasonal reset keeps three quarters of the SR, then placements again.
// Rating movement: a win and a loss at even strength, before performance and the lobby's strength.
export const MOVE = { win: 48, loss: 42, perfWin: 22, perfLoss: 18, draw: 10, gap: 25, gapCap: 16, min: 8 };
// The fixed ruleset of the Ranked playlist (Multiplayer, Standard): three modes, medium maps, no modifiers.
export const RANKED_RULES = { modes: ['hard', 'snd', 'ctl'], size: 'medium', mods: [] };
export const RANKED_PARTY = 12;        // A friend room plays ranked only when the host opts in and every seat is a human.

const num = (v, max = SR_MAX) => (Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0);
const ROMAN = ['I', 'II', 'III'];

export const blankRanked = (key = '') => ({ k: key, sr: 0, pm: 0, pw: 0, pp: 0, w: 0, l: 0, d: 0, peak: 0, base: -1, prot: 1, last: 0 });

export function cleanRanked(raw) {
  const r = blankRanked();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return r;
  r.k = typeof raw.k === 'string' && /^(pre|S\d{1,3}(R\d{1,4})?)$/.test(raw.k) ? raw.k : '';
  r.sr = num(raw.sr); r.pm = num(raw.pm, PLACEMENTS); r.pw = Math.min(r.pm, num(raw.pw)); r.pp = Math.min(r.pm * 100, num(raw.pp));
  r.w = num(raw.w, 1e6); r.l = num(raw.l, 1e6); r.d = num(raw.d, 1e6);
  r.peak = Math.max(r.pm >= PLACEMENTS ? r.sr : 0, num(raw.peak));
  r.base = Number.isFinite(raw.base) && raw.base >= 0 ? num(raw.base) : -1;
  r.prot = raw.prot === 0 ? 0 : 1;
  r.last = Number.isFinite(raw.last) ? Math.max(-500, Math.min(500, Math.round(raw.last))) : 0;
  return r;
}

export const placed = rk => (rk?.pm ?? 0) >= PLACEMENTS;

// SR to division: { div (index into DIVISIONS), tier (0..2, null for Champion), name ('Gold II'), code (0..18), floor }.
export function division(sr) {
  const s = num(sr);
  if (s >= CHAMPION) return { div: 6, tier: null, name: DIVISIONS[6].name, code: 18, floor: CHAMPION, next: null };
  const div = Math.floor(s / DIVISION_SPAN), into = s - div * DIVISION_SPAN, tier = Math.min(2, Math.floor(into / (DIVISION_SPAN / 3)));
  const floor = div * DIVISION_SPAN + tier * DIVISION_SPAN / 3;
  return { div, tier, name: `${DIVISIONS[div].name} ${ROMAN[tier]}`, code: div * 3 + tier, floor, next: floor + DIVISION_SPAN / 3 };
}
// The badge code a lobby shows (-1: unranked or in placements) back to a division.
export function fromCode(code) {
  if (!Number.isInteger(code) || code < 0 || code > 18) return null;
  if (code === 18) return { div: 6, tier: null, name: DIVISIONS[6].name, code };
  const div = Math.floor(code / 3), tier = code % 3;
  return { div, tier, name: `${DIVISIONS[div].name} ${ROMAN[tier]}`, code };
}
export const cleanCode = v => (Number.isInteger(v) && v >= 0 && v <= 18 ? v : -1);
export const codeOf = rk => (placed(rk) ? division(rk.sr).code : -1);
// A division code's middle SR, for a lobby whose other humans are known only by their badge.
export const codeSr = code => (code === 18 ? CHAMPION + 300 : code >= 0 ? Math.floor(code / 3) * DIVISION_SPAN + (code % 3) * 300 + 150 : null);

// The rating scale matchmaking uses (botpool mu, 0..1) and SR, both ways.
export const ratingToSr = r => num(Math.max(0, Math.min(1.2, Number(r) || 0)) * SR_SCALE);
export const srToRating = sr => Math.max(0, Math.min(1.2, num(sr) / SR_SCALE));

// Who a ranked search looks for: placements and the unranked by their usual rating, the placed by their SR.
export const rankedTarget = (rk, rating) => (placed(rk) ? srToRating(rk.sr) : rating);
export const RANKED_SPREAD = 0.11;     // Narrower than the normal search (0.17).

// Performance in a match, -1..1: where the player finished in their team's table by score (top +1, bottom -1), nudged
// by K/D. `rank` 1-based, `of` players on the team.
export function performance({ rank = 1, of = 1, kills = 0, deaths = 0 } = {}) {
  const place = of > 1 ? 1 - 2 * (Math.max(1, Math.min(of, rank)) - 1) / (of - 1) : 0;
  const kd = Math.max(-1, Math.min(1, (kills - deaths) / Math.max(6, kills + deaths)));
  return Math.max(-1, Math.min(1, 0.75 * place + 0.25 * kd));
}

// The SR a finished set of placements puts a player at: their base (last season's carried SR, or their rating) moved by
// how the five went. Never above Diamond III: Master and Champion are earned in play.
export function placementSr({ base, rating, wins, perf }) {
  const from = base >= 0 ? base : ratingToSr(rating) - 250;
  return num(Math.min(PLACEMENT_CAP, from + (wins - PLACEMENTS / 2) * 140 + perf * 30));
}

// One match's change for a placed player: win or loss, performance and the lobby's strength (its average SR against
// theirs). Wins always gain at least MOVE.min, losses always lose at least MOVE.min.
export function srDelta({ outcome, perf = 0, sr = 0, lobby = null }) {
  const gap = lobby === null ? 0 : Math.max(-MOVE.gapCap, Math.min(MOVE.gapCap, (lobby - sr) / MOVE.gap));
  if (outcome === 'win') return Math.max(MOVE.min, Math.round(MOVE.win + MOVE.perfWin * perf + gap));
  if (outcome === 'loss') return -Math.max(MOVE.min, Math.round(MOVE.loss - MOVE.perfLoss * perf - gap));
  return Math.round(MOVE.draw * perf + gap / 2);
}

// Applies one ranked match to rk (in place). m: { outcome: 'win'|'loss'|'draw', perf, lobby, rating }.
// Returns { before, after, delta, placement (1..5 while placing), placedNow, promoted, demoted, protectedLoss }.
export function applyRanked(rk, m) {
  const was = placed(rk), before = was ? division(rk.sr) : null, srBefore = rk.sr;
  const out = { before: was ? { sr: rk.sr, ...before } : null, delta: 0, placedNow: false, promoted: false, demoted: false, protectedLoss: false };
  if (m.outcome === 'win') rk.w++; else if (m.outcome === 'loss') rk.l++; else rk.d++;
  if (!was) {
    rk.pm++;
    if (m.outcome === 'win') rk.pw++;
    rk.pp += Math.round((Math.max(-1, Math.min(1, m.perf ?? 0)) + 1) * 50);
    out.placement = rk.pm;
    if (rk.pm >= PLACEMENTS) {
      rk.sr = placementSr({ base: rk.base, rating: m.rating ?? 0.27, wins: rk.pw, perf: rk.pp / 50 / PLACEMENTS - 1 });
      rk.peak = rk.sr; rk.prot = 1; out.placedNow = true; rk.last = 0;
    }
  } else {
    let delta = srDelta({ outcome: m.outcome, perf: m.perf ?? 0, sr: rk.sr, lobby: m.lobby ?? null });
    let next = num(rk.sr + delta);
    // The floor of a division (Silver I, Gold I, ...) holds once: the first loss that would drop below it stops on it.
    const floorDiv = Math.floor(rk.sr / DIVISION_SPAN) * DIVISION_SPAN;
    if (delta < 0 && next < floorDiv && rk.sr >= DIVISION_SPAN && rk.prot) {
      next = floorDiv; rk.prot = 0;
      out.protectedLoss = true;
    }
    if (delta > 0 && Math.floor(next / DIVISION_SPAN) > Math.floor(rk.sr / DIVISION_SPAN)) rk.prot = 1;
    rk.sr = next;
    rk.last = next - srBefore;
    rk.peak = Math.max(rk.peak, rk.sr);
  }
  const after = placed(rk) ? division(rk.sr) : null;
  out.after = after ? { sr: rk.sr, ...after } : null;
  out.delta = was ? rk.sr - srBefore : 0;
  if (was && after) { out.promoted = after.div > before.div; out.demoted = after.div < before.div; }
  return out;
}

// The seasonal reset, when rk belongs to another ranked season than `key`: the old season's best division (if they
// placed) is what end-of-season rewards are paid on; the new season starts from three quarters of the old SR, through
// placements again. Returns { rk, ended: { key, peakDiv } | null }.
export function rolloverRanked(rk, key) {
  if (rk.k === key) return { rk, ended: null };
  const ended = rk.k && placed(rk) ? { key: rk.k, peakDiv: division(rk.peak).div, sr: rk.sr } : null;
  const next = blankRanked(key);
  if (rk.k && placed(rk)) next.base = num(Math.min(PLACEMENT_CAP, rk.sr * CARRY));
  else if (rk.base >= 0) next.base = rk.base;
  return { rk: next, ended };
}
