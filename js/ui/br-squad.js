// Battle royale squad size in a friend room (docs/BR.md "Squad size"): Quads, Duos or Solos. The host owns the choice;
// it rides along in the lobby state and the vote messages, shows on the lobby and on the vote whenever battle royale is
// on the table, and turns a winning BR card into the mode of that size (brMode). Kept out of vote.js and menu.js so
// those stay as they are apart from one call each.
import { MODES } from '../shared/modes.js';
import { ico } from './yard.js';

export const BR_SIZES = [[4, 'Quads'], [2, 'Duos'], [1, 'Solos']];
const SIZE_MODE = { 4: 'br', 2: 'brduo', 1: 'brsolo' };

export const cleanSquad = n => (SIZE_MODE[n] ? Number(n) : 4);
// The mode a battle royale pick plays at this squad size; any other mode passes through.
export const brMode = (mode, size) => (MODES[mode]?.br ? SIZE_MODE[cleanSquad(size)] : mode);

// The segmented control. The host taps it (data-act="brSquad"); a guest sees the choice, fixed.
export function squadMarkup(size, isHost) {
  size = cleanSquad(size);
  return `<div class="br-size${isHost ? '' : ' fixed'}" role="group" aria-label="Squad size">
    <span>${ico('party')}Squads</span>
    ${BR_SIZES.map(([n, label]) => isHost
      ? `<button class="seg${n === size ? ' on' : ''}" data-act="brSquad" data-n="${n}">${label}</button>`
      : n === size ? `<b class="seg on">${label}</b>` : '').join('')}
  </div>`;
}

// On the vote: the control under the cards while a battle royale card is up, and those cards' mode names to match.
export function paintVoteSquad(root, state) {
  const brCards = state.options.map((o, i) => (MODES[o.mode]?.br ? i : -1)).filter(i => i >= 0);
  const cards = root.querySelectorAll('.vote-card');
  for (const i of brCards) {
    const name = cards[i]?.querySelector('.vc-mode-name');
    const want = MODES[brMode(state.options[i].mode, state.brSquad)].name;
    if (name && name.textContent !== want) name.textContent = want;
  }
  let el = root.querySelector('.br-size');
  if (!brCards.length || state.brSquad === undefined) { el?.remove(); return; }
  const html = squadMarkup(state.brSquad, state.isHost && state.winner === null);
  if (el?.dataset.html === html) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const next = wrap.firstElementChild;
  next.dataset.html = html;
  if (el) el.replaceWith(next);
  else root.querySelector('.vote-cards')?.after(next);
}
