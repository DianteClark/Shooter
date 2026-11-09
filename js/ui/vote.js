// The map vote and the solo picker. Both show the same map and mode facts; the vote is rendered once and then
// patched, because it repaints every second and on every ballot, and rebuilding it would flash the map art.
import { MAPS, MAP_IDS } from '../shared/map.js';
import { MODES, MODE_IDS } from '../shared/modes.js';
import { esc } from './widgets.js';
import { mapImage } from './mapthumb.js';

// options: [{mapId, mode}]. state: { options, counts:[n,n,n], left, mine (index|null), winner (index|null), total }
export function voteMarkup(state) {
  const cards = state.options.map((o, i) => {
    const map = MAPS[o.mapId], mode = MODES[o.mode];
    return `<button class="vote-card" data-act="voteCast" data-i="${i}">
      <span class="vc-art" style="background-image:url(${mapImage(map)})"></span>
      <span class="vc-shade"></span>
      <b class="vc-map">${esc(map.name)}</b>
      <span class="vc-mode"><em>${esc(mode.short)}</em>${esc(mode.name)}</span>
      <small class="vc-desc">${esc(mode.desc)}</small>
      <span class="vc-votes"></span>
    </button>`;
  }).join('');
  return `
    <header class="bar">
      <button class="back" data-act="voteLeave">Leave</button>
      <h2 class="vote-title">Vote for the next match</h2>
      <div class="vote-clock">
        <span class="vote-num"></span>
        <i class="vote-bar"><i></i></i>
      </div>
    </header>
    <div class="vote-cards">${cards}</div>
    <p class="vote-foot"></p>`;
}

export function paintVote(root, state) {
  root.querySelector('.vote-num').textContent = state.winner === null ? Math.max(0, state.left) : '';
  root.querySelector('.vote-bar i').style.transform = `scaleX(${state.winner === null ? Math.max(0, state.left / state.seconds) : 0})`;
  const title = root.querySelector('.vote-title');
  const foot = root.querySelector('.vote-foot');
  if (state.winner === null) {
    title.textContent = 'Vote for the next match';
    foot.textContent = state.mine === null ? 'Tap a card. You can change your mind until the timer runs out.' : 'Vote cast. Tap another card to change it.';
  } else {
    const o = state.options[state.winner];
    title.textContent = `${MODES[o.mode].name} on ${MAPS[o.mapId].name}`;
    foot.textContent = 'Starting...';
  }
  root.querySelectorAll('.vote-card').forEach((card, i) => {
    const n = state.counts[i] ?? 0;
    card.classList.toggle('mine', state.mine === i);
    card.classList.toggle('winner', state.winner === i);
    card.classList.toggle('lost', state.winner !== null && state.winner !== i);
    card.disabled = state.winner !== null;
    const votes = card.querySelector('.vc-votes');
    const html = Array.from({ length: state.total }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('') + `<b>${n}</b>`;
    if (votes.innerHTML !== html) votes.innerHTML = html;
  });
}

// Solo: every map and mode, chosen directly. Maps the map data offers no points for hide the modes that need them.
export function soloMarkup({ mapId, mode }) {
  const map = MAPS[mapId];
  return `
    <header class="bar">
      <button class="back" data-act="soloBack">Back</button>
      <h2>Play vs bots</h2>
      <span class="eyebrow solo-hint">Pick a map and a mode</span>
    </header>
    <div class="solo enter">
      <div class="solo-maps">${MAP_IDS.map(id => {
        const m = MAPS[id];
        return `<button class="solo-map${id === mapId ? ' on' : ''}" data-act="soloMap" data-id="${id}">
          <span class="vc-art" style="background-image:url(${mapImage(m)})"></span>
          <span class="vc-shade"></span>
          <b>${esc(m.name)}</b>
        </button>`;
      }).join('')}</div>
      <div class="solo-foot">
        <div class="solo-modes">${MODE_IDS.map(id => {
          const m = MODES[id], usable = modeFits(map, id);
          return `<button class="solo-mode${id === mode ? ' on' : ''}" data-act="soloMode" data-id="${id}" ${usable ? '' : 'disabled'}>
            <em>${esc(m.short)}</em><b>${esc(m.name)}</b><small>${esc(m.desc)}</small>
          </button>`;
        }).join('')}</div>
        <button class="route primary solo-start" data-act="soloStart"><i class="lamp"></i><b>Start</b></button>
      </div>
    </div>`;
}

// Domination and Hardpoint need a map to define their points.
export function modeFits(map, mode) {
  if (mode === 'dom') return !!map.points?.dom?.length;
  if (mode === 'hard') return !!map.points?.hard?.length;
  return true;
}

// Three distinct map and mode pairs, spreading across maps and modes before repeating either.
export function voteOptions(random = Math.random) {
  const pairs = [];
  for (const mapId of MAP_IDS) for (const mode of MODE_IDS) if (modeFits(MAPS[mapId], mode)) pairs.push({ mapId, mode });
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  const out = [], usedMaps = new Set(), usedModes = new Set();
  const pick = test => {
    for (const p of pairs) {
      if (out.length === 3) return;
      if (!out.includes(p) && test(p)) { out.push(p); usedMaps.add(p.mapId); usedModes.add(p.mode); }
    }
  };
  pick(p => !usedMaps.has(p.mapId) && !usedModes.has(p.mode));
  pick(p => !usedMaps.has(p.mapId));
  pick(() => true);
  return out;
}

// Most votes wins; ties and a silent room are settled by chance, by whoever is hosting.
export function tallyWinner(counts, random = Math.random) {
  const top = Math.max(...counts);
  const tied = counts.flatMap((n, i) => (n === top ? [i] : []));
  return tied[Math.floor(random() * tied.length)];
}
