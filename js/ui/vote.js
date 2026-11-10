// The map vote and the solo picker. Both show the same map and mode facts; the vote is rendered once and then
// patched, because it repaints every second and on every ballot, and rebuilding it would flash the map art.
//
// Random: either half of a pick (or both) may be RANDOM. Whoever is hosting turns it into a real map and mode with
// resolvePick before the match starts, and only that resolved pair is ever sent, so every phone plays the same map.
import { MAPS, MAP_IDS, DEFAULT_MAP } from '../shared/map.js';
import { MODES, MODE_IDS } from '../shared/modes.js';
import { esc } from './widgets.js';
import { mapImage, followMapArt } from './mapthumb.js';
import { ico, header } from './yard.js';
import { sweep, flash, enter } from './motion.js';

export const RANDOM = 'random';
const RANDOM_MODE = { short: '?', name: 'Random', desc: 'Any mode the map can host.' };
const modeIcon = id => ico(MODES[id] ? `mode:${id}` : 'random');

// A tile of four maps' art under a big question mark: the Random card in the vote and the solo picker.
function mixArt() {
  const tiles = MAP_IDS.slice(0, 4).map(id => `<span class="vc-art" data-map="${esc(id)}" style="background-image:url(${mapImage(MAPS[id])})"></span>`).join('');
  return `<span class="vc-mix" aria-hidden="true">${tiles}</span><i class="vc-q" aria-hidden="true">${ico('random')}</i>`;
}

// Every playable map and mode pair.
function allPairs() {
  const pairs = [];
  for (const mapId of MAP_IDS) for (const mode of MODE_IDS) if (modeFits(MAPS[mapId], mode)) pairs.push({ mapId, mode });
  return pairs;
}

// A pick whose map, mode or both are RANDOM, made real. The map is drawn first and evenly, so a map that hosts every
// mode is no likelier than one that hosts two; then a mode that map can host. A fixed half is kept as it is.
export function resolvePick({ mapId, mode }, random = Math.random) {
  const fits = allPairs().filter(p => (mapId === RANDOM || p.mapId === mapId) && (mode === RANDOM || p.mode === mode));
  if (!fits.length) return { mapId: MAPS[mapId] ? mapId : DEFAULT_MAP, mode: 'tdm' };
  const maps = [...new Set(fits.map(p => p.mapId))];
  const map = maps[Math.floor(random() * maps.length)];
  const modes = fits.filter(p => p.mapId === map);
  return modes[Math.floor(random() * modes.length)];
}

export const isRandom = pick => pick?.mapId === RANDOM || pick?.mode === RANDOM;

// options: [{mapId, mode}], the last may be the Random card. state: { options, counts, left, mine (index|null),
// winner (index|null), resolved ({mapId, mode} once a Random winner is rolled), total }
export function voteMarkup(state) {
  const cards = state.options.map((o, i) => {
    if (isRandom(o)) {
      return `<button class="vote-card random" data-act="voteCast" data-i="${i}" data-in="up">
      ${mixArt()}
      <span class="vc-shade"></span>
      <span class="vc-top"><span class="vc-votes"></span></span>
      <b class="vc-map">Random</b>
      <span class="vc-mode">${ico('random')}<span class="vc-mode-name">Any mode</span></span>
      <small class="vc-desc">Any map, any mode. Rolled when the vote closes.</small>
    </button>`;
    }
    const map = MAPS[o.mapId], mode = MODES[o.mode];
    return `<button class="vote-card" data-act="voteCast" data-i="${i}" data-in="up">
      <span class="vc-art" data-map="${esc(map.id)}" style="background-image:url(${mapImage(map)})"></span>
      <span class="vc-shade"></span>
      <span class="vc-top"><span class="vc-votes"></span></span>
      <b class="vc-map">${esc(map.name)}</b>
      <span class="vc-mode">${modeIcon(o.mode)}<span class="vc-mode-name">${esc(mode.name)}</span></span>
      <small class="vc-desc">${esc(mode.desc)}</small>
    </button>`;
  }).join('');
  return `
    ${header({ back: 'voteLeave', label: 'Leave', title: 'Vote for the next match', extra: `
      <div class="vote-clock">
        ${ico('timer')}
        <span class="vote-num"></span>
        <i class="vote-bar"><i></i></i>
      </div>` })}
    <div class="vote-cards${state.options.some(isRandom) ? ' with-random' : ''}">${cards}</div>
    <p class="vote-foot" data-in="fade"></p>`;
}

export function paintVote(root, state) {
  root.querySelector('.vote-num').textContent = state.winner === null ? Math.max(0, state.left) : '';
  root.querySelector('.vote-bar i').style.transform = `scaleX(${state.winner === null ? Math.max(0, state.left / state.seconds) : 0})`;
  const title = root.querySelector('.bar-title');
  const foot = root.querySelector('.vote-foot');
  if (state.winner === null) {
    title.textContent = 'Vote for the next match';
    foot.textContent = state.mine === null ? 'Tap a card. You can change your mind until the timer runs out.' : 'Vote cast. Tap another card to change it.';
  } else {
    const o = state.options[state.winner];
    const r = isRandom(o) ? state.resolved : o;
    title.textContent = r ? `${isRandom(o) ? 'Random: ' : ''}${MODES[r.mode].name} on ${MAPS[r.mapId].name}` : 'Random';
    foot.textContent = 'Loading the match';
    // The Random card turns into what it rolled.
    const card = isRandom(o) && r && root.querySelectorAll('.vote-card')[state.winner];
    if (card && !card.classList.contains('rolled')) {
      card.classList.add('rolled');
      card.querySelector('.vc-map').textContent = MAPS[r.mapId].name;
      card.querySelector('.vc-mode .ico').outerHTML = modeIcon(r.mode);
      card.querySelector('.vc-mode-name').textContent = MODES[r.mode].name;
      card.querySelector('.vc-desc').textContent = MODES[r.mode].desc;
      card.querySelector('.vc-q')?.remove();
      card.querySelector('.vc-mix').outerHTML = `<span class="vc-art" data-map="${esc(r.mapId)}" style="background-image:url(${mapImage(MAPS[r.mapId])})"></span>`;
      followMapArt(card);
    }
    // The winner's moment: one flash of lamp light and a sweep across the card.
    const won = root.querySelectorAll('.vote-card')[state.winner];
    if (won && !won.classList.contains('lit')) {
      won.classList.add('lit');
      flash(won, { color: 'var(--c-sodium-hi)', peak: 0.5 });
      sweep(won, { delay: 120 });
      root.querySelector('.vote-foot').classList.add('go');
    }
  }
  root.querySelectorAll('.vote-card').forEach((card, i) => {
    const n = state.counts[i] ?? 0;
    card.classList.toggle('mine', state.mine === i);
    card.classList.toggle('winner', state.winner === i);
    card.classList.toggle('lost', state.winner !== null && state.winner !== i);
    card.disabled = state.winner !== null;
    const votes = card.querySelector('.vc-votes');
    const html = Array.from({ length: state.total }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('') + `<b>${n}</b>`;
    if (votes.dataset.n !== String(n)) {
      if (votes.dataset.n !== undefined && n > Number(votes.dataset.n)) enter(votes, 'stamp', { duration: 260 });
      votes.dataset.n = n;
    }
    if (votes.innerHTML !== html) votes.innerHTML = html;
  });
}

// Solo: every map and mode, chosen directly, each with a Random choice. Maps the map data offers no points for hide the
// modes that need them; with a Random map every mode stays open and the roll keeps to maps that can host it.
export function soloMarkup({ mapId, mode }) {
  const map = MAPS[mapId];
  const cards = MAP_IDS.length + 1;
  return `
    ${header({ back: 'soloBack', title: 'Play vs bots', extra: `<button class="btn solo-quick" data-act="quickPlay">${ico('quick')}<b>Quick play</b></button>` })}
    <div class="solo">
      <div class="solo-maps" style="--cols:${Math.min(4, Math.ceil(cards / (cards > 4 ? 2 : 1)))}">${MAP_IDS.map(id => {
        const m = MAPS[id];
        return `<button class="solo-map${id === mapId ? ' on' : ''}" data-act="soloMap" data-id="${id}" data-in="up">
          <span class="vc-art" data-map="${esc(m.id)}" style="background-image:url(${mapImage(m)})"></span>
          <span class="vc-shade"></span>
          <span class="sm-tick">${ico('check')}</span>
          <span class="sm-name">${ico(`map:${id}`)}<b>${esc(m.name)}</b></span>
        </button>`;
      }).join('')}
        <button class="solo-map random${mapId === RANDOM ? ' on' : ''}" data-act="soloMap" data-id="${RANDOM}" data-in="up">
          ${mixArt()}
          <span class="vc-shade"></span>
          <span class="sm-tick">${ico('check')}</span>
          <span class="sm-name">${ico('random')}<b>Random</b></span>
        </button></div>
      <div class="solo-foot" data-in="up">
        <div class="solo-modes">${[...MODE_IDS, RANDOM].map(id => {
          const m = MODES[id] ?? RANDOM_MODE, usable = modeFits(map, id);
          return `<button class="solo-mode${id === mode ? ' on' : ''}" data-act="soloMode" data-id="${id}" ${usable ? '' : 'disabled'}>
            ${modeIcon(id)}<b>${esc(m.name)}</b>
          </button>`;
        }).join('')}</div>
        <button class="btn is-primary solo-start" data-sound="confirm" data-act="soloStart">${ico('play')}<span><b>Start</b><small class="solo-pick">${esc(pickLine(mapId, mode))}</small></span></button>
      </div>
    </div>`;
}

// What Start will launch, in words: "Domination on Dust", "Any mode on Harbor".
function pickLine(mapId, mode) {
  const m = mode === RANDOM ? 'Any mode' : MODES[mode]?.name ?? '';
  return `${m} on ${mapId === RANDOM ? 'any map' : MAPS[mapId]?.name ?? ''}`;
}

// A tap updates the marks in place. Rebuilding the screen replayed its entrance and re-decoded every map's art, so the whole
// picker flashed on each tap while the selection itself was invisible.
export function paintSolo(root, { mapId, mode }) {
  const map = MAPS[mapId];
  const line = root.querySelector('.solo-pick');
  if (line) line.textContent = pickLine(mapId, mode);
  for (const b of root.querySelectorAll('.solo-map')) b.classList.toggle('on', b.dataset.id === mapId);
  for (const b of root.querySelectorAll('.solo-mode')) {
    const usable = modeFits(map, b.dataset.id);
    b.classList.toggle('on', b.dataset.id === mode);
    b.disabled = !usable;

  }
}

// Domination and Hardpoint need a map to define their points. A Random map or mode always fits: the roll sees to it.
export function modeFits(map, mode) {
  if (!map || mode === RANDOM) return true;
  if (mode === 'dom') return !!map.points?.dom?.length;
  if (mode === 'hard') return !!map.points?.hard?.length;
  return true;
}

// Three distinct map and mode pairs, spreading across maps and modes before repeating either, then the Random card.
export function voteOptions(random = Math.random) {
  const pairs = allPairs();
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
  out.push({ mapId: RANDOM, mode: RANDOM });
  return out;
}

// Most votes wins; ties and a silent room are settled by chance, by whoever is hosting.
export function tallyWinner(counts, random = Math.random) {
  const top = Math.max(...counts);
  const tied = counts.flatMap((n, i) => (n === top ? [i] : []));
  return tied[Math.floor(random() * tied.length)];
}
