// Scorestreak rules (docs/V4.md), as a small state machine with no dependency on the match:
//   1. As score rises, a slot that is not held and not blocked is granted when score reaches its cost.
//   2. If no slot is left that can still be earned above the current score, score is capped and stops.
//   3. Using a streak while capped: score resets to 0 and all blocks clear.
//   4. Using a streak while not capped: no reset. If score is already at or past that streak's cost,
//      that slot is blocked until the next reset.
//
// Invariant the rules rely on: an empty, unblocked slot always costs more than the current score.

import { STREAKS } from '../shared/catalog.js';

function bySlotCost(ids, table) {
  return [...ids].sort((a, b) => table[a].cost - table[b].cost);
}

function makeSlot(id, table) {
  return { kind: id, cost: table[id].cost, held: false, blocked: false };
}

// True when some slot can still be earned above the current score.
function hasEarnable(st) {
  for (let i = 0; i < st.slots.length; i++) {
    const s = st.slots[i];
    if (!s.held && !s.blocked && s.cost > st.score) return true;
  }
  return false;
}

export function createStreakState(ids, table = STREAKS) {
  return { score: 0, capped: false, slots: bySlotCost(ids, table).map(id => makeSlot(id, table)) };
}

// Adds points and grants whatever they reach, cheapest first. The points that land past the slot
// that caps the player are discarded, so the score sits exactly on that slot's cost.
// Returns the number of points actually added.
export function addScore(st, points, onGrant) {
  if (st.capped || !(points > 0)) return 0;
  const before = st.score;
  let target = before + points;
  for (let i = 0; i < st.slots.length; i++) {
    const s = st.slots[i];
    if (s.held || s.blocked || s.cost > target) continue;
    s.held = true;
    st.score = s.cost;
    if (onGrant) onGrant(s, i);
    if (!hasEarnable(st)) { st.capped = true; target = s.cost; break; }
  }
  st.score = target;
  return target - before;
}

// Spends the streak in `slot`. Returns false if that slot is empty or does not exist.
export function spendStreak(st, slot) {
  const s = st.slots[slot];
  if (!s || !s.held) return false;
  s.held = false;
  if (st.capped) {
    st.score = 0;
    st.capped = false;
    for (let i = 0; i < st.slots.length; i++) st.slots[i].blocked = false;
  } else if (st.score >= s.cost) {
    s.blocked = true;
  }
  return true;
}

// Swaps in a new set of streaks without resetting progress. A kept streak keeps its held and blocked
// state. A new streak the score has already passed starts blocked, so editing a loadout never pays out.
export function setStreakKinds(st, ids, table = STREAKS) {
  st.slots = bySlotCost(ids, table).map(id => {
    const old = st.slots.find(s => s.kind === id);
    if (old) return old;
    const s = makeSlot(id, table);
    s.blocked = st.score >= s.cost;
    return s;
  });
  st.capped = !hasEarnable(st);
}
